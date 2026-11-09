// ═══════════════════════════════════════════════════════════
//  TaxMate — push Edge Function (V59): phone / computer notifications (Web Push)
//  No outside library and no secret to type in: the VAPID keys are made here
//  on first "setup" and kept in public.push_config (service role only).
//
//  pg_cron / database triggers (header x-cron-key):  send {to: 'client'|'admin', client_id, title, body, url, tag}
//  Signed-in admin:   setup (make the keys once), status
//  Signed-in user:    test (sends a test to this user's own devices)
// ═══════════════════════════════════════════════════════════
import { createClient } from 'npm:@supabase/supabase-js@2.49.4';

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-cron-key',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};
const reply = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { ...cors, 'Content-Type': 'application/json' } });
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
// Only real push services (same rule as the database)
const ENDPOINT_RE = /^https:\/\/(fcm\.googleapis\.com|updates\.push\.services\.mozilla\.com|[a-z0-9.-]+\.notify\.windows\.com|web\.push\.apple\.com|[a-z0-9.-]+\.push\.apple\.com)\//;

// ─── Web Push crypto (RFC 8291 aes128gcm + RFC 8292 VAPID) ───
const enc = new TextEncoder();
export const b64u = (b: Uint8Array) => btoa(String.fromCharCode(...b)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
export const unb64u = (s: string) => Uint8Array.from(atob(s.replace(/-/g, '+').replace(/_/g, '/') + '==='.slice((s.length + 3) % 4)), (c) => c.charCodeAt(0));
const cat = (...a: Uint8Array[]) => { const o = new Uint8Array(a.reduce((n, x) => n + x.length, 0)); let i = 0; for (const x of a) { o.set(x, i); i += x.length; } return o; };
async function hmac(key: Uint8Array, data: Uint8Array) {
  const k = await crypto.subtle.importKey('raw', key, { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  return new Uint8Array(await crypto.subtle.sign('HMAC', k, data));
}

export async function makeVapidKeys() {
  const kp = await crypto.subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, true, ['sign', 'verify']) as CryptoKeyPair;
  const pub = new Uint8Array(await crypto.subtle.exportKey('raw', kp.publicKey));
  const jwk = await crypto.subtle.exportKey('jwk', kp.privateKey);
  return { public_key: b64u(pub), private_jwk: jwk };
}

export async function vapidHeader(endpoint: string, publicKey: string, privateJwk: JsonWebKey, subject: string) {
  const aud = new URL(endpoint).origin;
  const header = b64u(enc.encode(JSON.stringify({ typ: 'JWT', alg: 'ES256' })));
  const claims = b64u(enc.encode(JSON.stringify({ aud, exp: Math.floor(Date.now() / 1000) + 12 * 3600, sub: subject })));
  const key = await crypto.subtle.importKey('jwk', privateJwk, { name: 'ECDSA', namedCurve: 'P-256' }, false, ['sign']);
  const sig = new Uint8Array(await crypto.subtle.sign({ name: 'ECDSA', hash: 'SHA-256' }, key, enc.encode(`${header}.${claims}`)));
  return `vapid t=${header}.${claims}.${b64u(sig)}, k=${publicKey}`;
}

/** Encrypt a payload for one subscription (aes128gcm, one record) */
export async function encryptPayload(p256dh: string, authSecret: string, payload: Uint8Array) {
  const uaPublic = unb64u(p256dh), auth = unb64u(authSecret);
  const local = await crypto.subtle.generateKey({ name: 'ECDH', namedCurve: 'P-256' }, true, ['deriveBits']) as CryptoKeyPair;
  const asPublic = new Uint8Array(await crypto.subtle.exportKey('raw', local.publicKey));
  const uaKey = await crypto.subtle.importKey('raw', uaPublic, { name: 'ECDH', namedCurve: 'P-256' }, false, []);
  const ecdh = new Uint8Array(await crypto.subtle.deriveBits({ name: 'ECDH', public: uaKey }, local.privateKey, 256));
  const prkKey = await hmac(auth, ecdh);
  const ikm = await hmac(prkKey, cat(enc.encode('WebPush: info\0'), uaPublic, asPublic, new Uint8Array([1])));
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const prk = await hmac(salt, ikm);
  const cek = (await hmac(prk, cat(enc.encode('Content-Encoding: aes128gcm\0'), new Uint8Array([1])))).slice(0, 16);
  const nonce = (await hmac(prk, cat(enc.encode('Content-Encoding: nonce\0'), new Uint8Array([1])))).slice(0, 12);
  const aes = await crypto.subtle.importKey('raw', cek, 'AES-GCM', false, ['encrypt']);
  const ct = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv: nonce }, aes, cat(payload, new Uint8Array([2]))));
  const rs = new Uint8Array([0, 0, 0x10, 0]);   // record size 4096
  return cat(salt, rs, new Uint8Array([asPublic.length]), asPublic, ct);
}

type Sub = { id: string; endpoint: string; p256dh: string; auth: string; fail_count: number };
type Cfg = { public_key: string; private_jwk: JsonWebKey; subject: string };

async function sendOne(cfg: Cfg, s: Sub, msg: Record<string, unknown>) {
  if (!ENDPOINT_RE.test(s.endpoint)) return { status: 0, gone: true, error: 'endpoint not allowed' };
  const body = await encryptPayload(s.p256dh, s.auth, enc.encode(JSON.stringify(msg)));
  const res = await fetch(s.endpoint, {
    method: 'POST',
    headers: {
      Authorization: await vapidHeader(s.endpoint, cfg.public_key, cfg.private_jwk, cfg.subject),
      'Content-Encoding': 'aes128gcm', 'Content-Type': 'application/octet-stream', TTL: '86400', Urgency: 'high',
      ...(msg.tag ? { Topic: String(msg.tag).replace(/[^A-Za-z0-9_-]/g, '').slice(0, 32) || 'tm' } : {}),
    },
    body,
  });
  const text = res.ok ? '' : (await res.text().catch(() => '')).slice(0, 200);
  return { status: res.status, ok: res.ok, gone: res.status === 404 || res.status === 410, error: text };
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors });
  const svc = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!, { auth: { persistSession: false } });

  const loadCfg = async () => (await svc.from('push_config').select('public_key, private_jwk, subject').eq('id', 1).maybeSingle()).data as Cfg | null;

  async function deliver(subs: Sub[], msg: Record<string, unknown>) {
    const cfg = await loadCfg();
    if (!cfg) return { sent: 0, failed: 0, removed: 0, note: 'not set up' };
    let sent = 0, failed = 0, removed = 0;
    for (let i = 0; i < subs.length; i += 10) {
      await Promise.all(subs.slice(i, i + 10).map(async (s) => {
        try {
          const r = await sendOne(cfg, s, msg);
          if (r.ok) { sent++; await svc.from('push_subscriptions').update({ last_ok_at: new Date().toISOString(), fail_count: 0, last_error: null }).eq('id', s.id); }
          else if (r.gone || s.fail_count >= 9) { removed++; await svc.from('push_subscriptions').delete().eq('id', s.id); }
          else { failed++; await svc.from('push_subscriptions').update({ fail_count: s.fail_count + 1, last_error: `${r.status} ${r.error}`.slice(0, 300) }).eq('id', s.id); }
        } catch (e) {
          failed++;
          await svc.from('push_subscriptions').update({ fail_count: s.fail_count + 1, last_error: String((e as Error)?.message ?? e).slice(0, 300) }).eq('id', s.id);
        }
      }));
    }
    return { sent, failed, removed };
  }
  const message = (b: Record<string, unknown>) => ({
    title: String(b.title ?? 'TaxMate').slice(0, 120), body: String(b.body ?? '').slice(0, 240),
    url: /^\/(client|admin)(\/|\?|$)/.test(String(b.url ?? '')) ? String(b.url) : '/', tag: b.tag ? String(b.tag).slice(0, 40) : undefined,
  });
  const SUB_COLS = 'id, endpoint, p256dh, auth, fail_count';

  try {
    const body = await req.json().catch(() => ({}));
    const action = String(body?.action ?? '');

    // ── From the database (secret cron key) ──
    const cronKey = req.headers.get('x-cron-key');
    if (cronKey) {
      const { data: okKey } = await svc.rpc('check_cron_key', { p_key: cronKey });
      if (okKey !== true) return reply({ error: 'Not allowed.' }, 403);
      if (action !== 'send') return reply({ error: 'Unknown action.' }, 400);
      let q = svc.from('push_subscriptions').select(SUB_COLS).limit(50);
      if (body.to === 'admin') q = q.eq('is_admin', true);
      else if (body.to === 'client' && UUID_RE.test(String(body.client_id ?? ''))) q = q.eq('client_id', body.client_id).eq('is_admin', false);
      else return reply({ error: 'Bad target.' }, 400);
      const { data: subs } = await q;
      return reply(await deliver((subs ?? []) as Sub[], message(body)));
    }

    // ── Signed-in user ──
    const jwt = (req.headers.get('Authorization') ?? '').replace(/^Bearer\s+/i, '');
    const { data: caller } = await svc.auth.getUser(jwt);
    if (!caller?.user) return reply({ error: 'Please sign in again.' }, 401);
    const asCaller = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_ANON_KEY')!, { global: { headers: { Authorization: `Bearer ${jwt}` } }, auth: { persistSession: false } });

    if (action === 'test') {
      const { data: subs } = await svc.from('push_subscriptions').select(SUB_COLS).eq('user_id', caller.user.id).limit(10);
      if (!subs?.length) return reply({ error: 'Notifications are not switched on for this account yet.' });
      return reply(await deliver(subs as Sub[], { title: 'TaxMate notifications are on ✅', body: 'You will see TaxMate updates here.', url: '/', tag: 'test' }));
    }

    const { data: admin } = await asCaller.rpc('is_admin');
    if (admin !== true) return reply({ error: 'Admins only.' }, 403);
    if (action === 'status') {
      const cfg = await loadCfg();
      return reply({ ready: !!cfg });
    }
    if (action === 'setup') {
      const cfg = await loadCfg();
      if (cfg) return reply({ ready: true, public_key: cfg.public_key });
      const keys = await makeVapidKeys();
      const { error } = await svc.from('push_config').insert({ id: 1, ...keys });
      if (error) return reply({ error: error.message });
      return reply({ ready: true, public_key: keys.public_key });
    }
    return reply({ error: 'Unknown action.' }, 400);
  } catch (e) {
    return reply({ error: String((e as Error)?.message ?? e) }, 500);
  }
});
