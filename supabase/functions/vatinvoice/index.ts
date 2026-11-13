// ═══════════════════════════════════════════════════════════
//  TaxMate V64 — vatinvoice Edge Function (VAT Invoice & RAMIS add-on)
//
//  pg_cron (header x-cron-key):
//    ramis_cron      — process the RAMIS submission queue (every 10 min, only when something waits)
//    reminders_cron  — automatic payment-reminder emails of businesses' invoices (09:11 Sri Lanka time)
//  Signed-in users:
//    email_document  — email an invoice / note (or a reminder) to the customer with its secure link
//  TaxMate admins:
//    ramis_now       — process the RAMIS queue now
//
//  RAMIS: the integration is a versioned adapter (v1, v2 …). IRD's VAT Web API (Quick Guide v0.1) signs in
//  with the taxpayer's SSID + password and returns a JWT; the endpoint URLs, request fields and responses are
//  NOT public. So adapter v1 below never sends anything: every submission is answered "pending_config"
//  (RAMIS Integration Pending Configuration) until a TaxMate developer implements the adapter from IRD's
//  official specification and TaxMate admin activates it. Nothing is ever reported as submitted / accepted
//  unless the IRD API itself answered. Passwords / tokens are only held in memory, never logged.
//
//  Secrets (Supabase → Edge Functions → Secrets): BREVO_API_KEY or RESEND_API_KEY (same as reminders).
//  Deploy with "Verify JWT" OFF (the cron calls have no login; user / admin calls are checked here).
// ═══════════════════════════════════════════════════════════
import { createClient, type SupabaseClient } from 'npm:@supabase/supabase-js@2.49.4';

const cors = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-cron-key', 'Access-Control-Allow-Methods': 'POST, OPTIONS' };
const json = (b: unknown, s = 200) => new Response(JSON.stringify(b), { status: s, headers: { ...cors, 'Content-Type': 'application/json' } });
const APP = 'https://app.taxmatesolutions.com';
const esc = (s: unknown) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]!));
const rs = (n: unknown) => `Rs. ${Number(n || 0).toLocaleString('en-LK', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const nice = (iso?: string | null) => (iso ? new Date(`${iso}T00:00:00Z`).toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC' }) : '');
const TITLE: Record<string, string> = { tax: 'Tax Invoice', nontax: 'Invoice', credit: 'Credit Note', debit: 'Debit Note' };

// ── email (same providers as the reminders function) ──
async function sendEmail(to: string, subject: string, html: string, from: { name: string; email: string }, replyTo?: string | null) {
  const brevo = Deno.env.get('BREVO_API_KEY'), resend = Deno.env.get('RESEND_API_KEY');
  if (!from.email) throw new Error('Sender email not set (Admin → Settings → Email reminders).');
  if (brevo) {
    const r = await fetch('https://api.brevo.com/v3/smtp/email', {
      method: 'POST', headers: { 'api-key': brevo, 'Content-Type': 'application/json', accept: 'application/json' },
      body: JSON.stringify({ sender: { name: from.name, email: from.email }, to: [{ email: to }], subject, htmlContent: html, ...(replyTo ? { replyTo: { email: replyTo } } : {}) }),
    });
    if (!r.ok) throw new Error(`Brevo ${r.status}: ${(await r.text()).slice(0, 200)}`);
    return;
  }
  if (resend) {
    const r = await fetch('https://api.resend.com/emails', {
      method: 'POST', headers: { Authorization: `Bearer ${resend}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ from: `${from.name} <${from.email}>`, to: [to], subject, html, ...(replyTo ? { reply_to: replyTo } : {}) }),
    });
    if (!r.ok) throw new Error(`Resend ${r.status}: ${(await r.text()).slice(0, 200)}`);
    return;
  }
  throw new Error('No email provider key (BREVO_API_KEY or RESEND_API_KEY).');
}

function docEmail(j: Record<string, any>, kind: 'document' | 'reminder', ruleDays?: number) {
  const title = TITLE[j.doc_type] || 'Invoice';
  const url = `${APP}/i/${j.token || j.share_token}`;
  const cust = j.customer?.name || 'Sir / Madam';
  const overdue = j.due_date && ruleDays != null ? ruleDays > 0 : false;
  const lead = kind === 'reminder'
    ? (overdue ? `This is a reminder that ${title} <b>${esc(j.doc_no)}</b> was due on <b>${esc(nice(j.due_date))}</b>. The balance is <b>${esc(rs(j.balance))}</b>.`
      : `This is a friendly reminder that ${title} <b>${esc(j.doc_no)}</b> for <b>${esc(rs(j.balance))}</b> is due on <b>${esc(nice(j.due_date))}</b>.`)
    : `Please find ${title} <b>${esc(j.doc_no)}</b> for <b>${esc(rs(j.total))}</b>${j.due_date && (j.doc_type === 'tax' || j.doc_type === 'nontax') ? `, due on <b>${esc(nice(j.due_date))}</b>` : ''}.`;
  const pay = [j.payment_instructions, j.bank_details].filter(Boolean).map((x) => esc(x).replace(/\n/g, '<br>')).join('<br>');
  const biz = j.business || j.legal_name || j.trading_name || '';
  const html = `<!doctype html><html><body style="margin:0;background:#f3f4f6;font-family:Segoe UI,Arial,sans-serif;color:#1f2937">
<table width="100%" cellpadding="0" cellspacing="0" style="padding:24px 12px"><tr><td align="center">
<table width="560" cellpadding="0" cellspacing="0" style="max-width:560px;width:100%;background:#fff;border-radius:14px;overflow:hidden">
<tr><td style="background:#1e3a8a;padding:18px 22px;color:#fff;font-size:19px;font-weight:800">${esc(biz)}</td></tr>
<tr><td style="padding:22px;font-size:14px;line-height:1.6">Dear ${esc(cust)},<br><br>${lead}<br><br>
<a href="${url}" style="display:inline-block;background:#eab308;color:#1e3a8a;font-weight:800;text-decoration:none;padding:11px 18px;border-radius:9px">View / download ${esc(title)}</a>
${pay ? `<div style="margin-top:16px;padding:10px 12px;background:#f9fafb;border-left:3px solid #1e3a8a;font-size:13px">${pay}</div>` : ''}
<div style="margin-top:16px">Thank you,<br>${esc(biz)}${j.biz_phone ? `<br>${esc(j.biz_phone)}` : ''}</div></td></tr>
<tr><td style="padding:12px 22px;background:#f9fafb;font-size:11px;color:#6b7280">Sent by TaxMate Solutions on behalf of ${esc(biz)}. The link is secure and expires automatically. Reply to this email to contact ${esc(biz)}.</td></tr>
</table></td></tr></table></body></html>`;
  const subject = kind === 'reminder' ? `Payment reminder — ${title} ${j.doc_no}` : `${title} ${j.doc_no} from ${biz}`;
  return { subject, html };
}

// ── RAMIS adapters ──
type Outcome = { outcome: 'accepted' | 'submitted' | 'rejected' | 'retry' | 'unknown' | 'pending_config'; http?: number; ramis_status?: string; ref?: string; code?: string; message?: string; detail?: Record<string, unknown> };
type Sub = { id: string; client_id: string; doc_id: string; submission_no: string; kind: string; adapter_version: string; environment: 'sandbox' | 'production'; payload: Record<string, unknown>; attempt: number; check_first: boolean; poll_only: boolean };
type AdapterCfg = { status?: string; spec_version?: string; auth_method?: string; sandbox?: Record<string, string>; production?: Record<string, string>; field_map?: Record<string, unknown> };
interface Adapter {
  ready: (cfg: AdapterCfg) => boolean;                        // implemented for IRD's official spec?
  submit: (s: Sub, cfg: AdapterCfg, login: { ssid: string; password: string }) => Promise<Outcome>;
  status: (s: Sub, cfg: AdapterCfg, login: { ssid: string; password: string }) => Promise<Outcome>;
}
const PENDING: Outcome = { outcome: 'pending_config', message: 'RAMIS Integration Pending Configuration — IRD Web API specification not configured; nothing was sent to IRD.' };

// Adapter v1 — placeholder until IRD's official VAT Web API specification is available to TaxMate.
// Implement submit()/status() from that document (token call with SSID + password → JWT, invoice / note
// payload mapped from the canonical payload in public._vi_ramis_payload), then return true from ready().
const adapterV1: Adapter = {
  ready: () => false,
  submit: async () => PENDING,
  status: async () => PENDING,
};
const ADAPTERS: Record<string, Adapter> = { v1: adapterV1 };

async function runQueue(db: SupabaseClient) {
  const { data: apiRow } = await db.from('app_settings').select('value').eq('key', 'vi_ramis_api').maybeSingle();
  const api = (apiRow?.value ?? {}) as { adapters?: Record<string, AdapterCfg> };
  const { data: claimed, error } = await db.rpc('_vi_ramis_claim', { p_limit: 20 });
  if (error) throw new Error(error.message);
  const subs = (claimed ?? []) as Sub[];
  let processed = 0;
  for (const s of subs) {
    let out: Outcome;
    try {
      const cfg = api.adapters?.[s.adapter_version] ?? {};
      const ad = ADAPTERS[s.adapter_version];
      if (!ad || cfg.status !== 'active' || !ad.ready(cfg)) out = PENDING;
      else {
        const { data: login } = await db.rpc('_vi_ramis_login', { p_client: s.client_id });
        if (!login?.ssid || !login?.password) out = { outcome: 'retry', code: 'NO_LOGIN', message: 'RAMIS SSID / password not saved or not allowed for Web API use.' };
        else if (s.check_first || s.poll_only) {
          // timed out before (or waiting for the final answer): ask RAMIS first — never send twice
          out = await ad.status(s, cfg, login);
          if (out.outcome === 'unknown' && !s.poll_only) out = await ad.submit(s, cfg, login);
        } else out = await ad.submit(s, cfg, login);
      }
    } catch (e) {
      out = { outcome: 'unknown', code: 'EXCEPTION', message: (e as Error).message.slice(0, 300) };
    }
    const { error: e2 } = await db.rpc('_vi_ramis_result', {
      p_sub: s.id, p_outcome: out.outcome, p_http: out.http ?? null, p_ramis_status: out.ramis_status ?? null, p_ref: out.ref ?? null,
      p_code: out.code ?? null, p_message: out.message ?? null, p_detail: out.detail ?? null,
    });
    if (!e2) processed++;
  }
  return { processed, claimed: subs.length };
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors });
  if (req.method !== 'POST') return json({ error: 'POST only' }, 405);
  const URL_ = Deno.env.get('SUPABASE_URL')!;
  const db = createClient(URL_, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!, { auth: { persistSession: false, autoRefreshToken: false } });
  let body: Record<string, unknown> = {};
  try { body = await req.json(); } catch { /* empty */ }
  const action = String(body.action ?? '');

  try {
    // ── scheduled jobs ──
    const cronKey = req.headers.get('x-cron-key');
    if (cronKey) {
      const { data: ok } = await db.rpc('check_cron_key', { p_key: cronKey });
      if (ok !== true) return json({ error: 'Not allowed.' }, 403);
      if (action === 'ramis_cron') return json(await runQueue(db));
      if (action === 'reminders_cron') {
        const { data: st } = await db.from('app_settings').select('value').eq('key', 'email').maybeSingle();
        const cfg = (st?.value ?? {}) as Record<string, string>;
        const { data: due, error } = await db.rpc('_vi_due_reminders', { p_limit: 300 });
        if (error) throw new Error(error.message);
        const res = { sent: 0, failed: 0 };
        for (const j of (due ?? []) as Record<string, any>[]) {
          const to = String(j.customer?.email || '');
          let token = j.share_token;
          if (!token || !j.share_expires_at || new Date(j.share_expires_at) < new Date()) {
            token = crypto.randomUUID();
            await db.from('vi_documents').update({ share_token: token, share_expires_at: new Date(Date.now() + 90 * 864e5).toISOString() }).eq('id', j.id);
          }
          const { subject, html } = docEmail({ ...j, token, business: j.trading_name || j.legal_name }, 'reminder', Number(j.days));
          try {
            await sendEmail(to, subject, html, { name: `${j.trading_name || j.legal_name || 'Invoice'} via TaxMate`, email: cfg.from_email }, j.biz_email);
            if (j.reminder_cc_me && j.biz_email) await sendEmail(j.biz_email, `Copy: ${subject}`, html, { name: 'TaxMate', email: cfg.from_email }).catch(() => {});
            await db.rpc('_vi_reminder_done', { p_doc: j.id, p_rule: j.rule_key, p_channel: 'email', p_recipient: to, p_message: subject, p_ok: true, p_error: null, p_auto: true, p_user: null });
            res.sent++;
          } catch (e) {
            await db.rpc('_vi_reminder_done', { p_doc: j.id, p_rule: j.rule_key, p_channel: 'email', p_recipient: to, p_message: subject, p_ok: false, p_error: (e as Error).message.slice(0, 300), p_auto: true, p_user: null });
            res.failed++;
          }
        }
        return json(res);
      }
      return json({ error: 'Unknown action.' });
    }

    // ── signed-in callers ──
    const jwt = (req.headers.get('Authorization') ?? '').replace(/^Bearer\s+/i, '');
    if (!jwt) return json({ error: 'Please sign in.' }, 401);
    const asCaller = createClient(URL_, Deno.env.get('SUPABASE_ANON_KEY')!, { global: { headers: { Authorization: `Bearer ${jwt}` } }, auth: { persistSession: false, autoRefreshToken: false } });

    if (action === 'ramis_now') {
      const { data: isAdmin } = await asCaller.rpc('is_admin');
      if (isAdmin !== true) return json({ error: 'Admins only.' }, 403);
      return json(await runQueue(db));
    }

    if (action === 'email_document') {
      const docId = String(body.doc_id ?? '');
      if (!/^[0-9a-f-]{36}$/i.test(docId)) return json({ error: 'Document missing.' });
      const kind = body.kind === 'reminder' ? 'reminder' : 'document';
      const { data: j, error } = await asCaller.rpc('vi_email_job', { p_doc: docId });   // checks the caller's permission
      if (error) return json({ error: error.message });
      const { data: st } = await db.from('app_settings').select('value').eq('key', 'email').maybeSingle();
      const cfg = (st?.value ?? {}) as Record<string, string>;
      const to = String(j.customer?.email || '');
      const { subject, html } = docEmail(j, kind, kind === 'reminder' && j.due_date ? Math.round((Date.now() - new Date(`${j.due_date}T00:00:00Z`).getTime()) / 864e5) : undefined);
      try {
        await sendEmail(to, subject, html, { name: `${j.business || 'Invoice'} via TaxMate`, email: cfg.from_email }, j.biz_email);
        await db.rpc('_vi_reminder_done', { p_doc: docId, p_rule: kind === 'reminder' ? 'manual' : 'send', p_channel: 'email', p_recipient: to, p_message: subject, p_ok: true, p_error: null, p_auto: false, p_user: j.user });
        return json({ ok: true, to });
      } catch (e) {
        await db.rpc('_vi_reminder_done', { p_doc: docId, p_rule: kind === 'reminder' ? 'manual' : 'send', p_channel: 'email', p_recipient: to, p_message: subject, p_ok: false, p_error: (e as Error).message.slice(0, 300), p_auto: false, p_user: j.user });
        return json({ error: (e as Error).message });
      }
    }
    return json({ error: 'Unknown action.' });
  } catch (e) {
    return json({ error: (e as Error).message || 'Something went wrong.' });
  }
});
