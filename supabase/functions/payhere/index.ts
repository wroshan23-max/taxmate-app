// ═══════════════════════════════════════════════════════════
//  TaxMate — PayHere online payments for invoices
//  POST JSON  { action: 'status' }                      → is PayHere set up? (any signed-in user)
//  POST JSON  { action: 'checkout', invoice_id }        → form fields for PayHere checkout (signed-in client)
//  POST form  (from PayHere servers, notify_url)        → verifies md5sig, marks the invoice paid
//  Secrets (Supabase → Edge Functions → Secrets):
//    PAYHERE_MERCHANT_ID, PAYHERE_MERCHANT_SECRET, PAYHERE_SANDBOX ("true" for testing)
//  Deploy with "Verify JWT" OFF — PayHere cannot send a login token; checkout checks the token itself.
// ═══════════════════════════════════════════════════════════
import { createClient } from 'npm:@supabase/supabase-js@2.49.4';
import md5 from 'npm:md5@2.3.0';

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { ...cors, 'Content-Type': 'application/json' } });
// Customers come back to the address they paid from (only these are allowed).
const APP_URLS = ['https://app.taxmatesolutions.com', 'https://taxmate-app.vercel.app'];
const appUrlFor = (req: Request) => {
  const o = (req.headers.get('origin') ?? '').replace(/\/$/, '');
  return APP_URLS.includes(o) ? o : APP_URLS[1];
};
const MD5U = (s: string) => md5(s).toUpperCase();
const money = (n: number) => (Math.round(n * 100) / 100).toFixed(2);

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors });
  if (req.method !== 'POST') return json({ error: 'POST only' }, 405);

  const URL_ = Deno.env.get('SUPABASE_URL')!;
  const admin = createClient(URL_, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!, { auth: { persistSession: false, autoRefreshToken: false } });
  const MID = (Deno.env.get('PAYHERE_MERCHANT_ID') ?? '').trim();
  const SECRET = (Deno.env.get('PAYHERE_MERCHANT_SECRET') ?? '').trim();
  const SANDBOX = (Deno.env.get('PAYHERE_SANDBOX') ?? '').toLowerCase() === 'true';
  const ctype = req.headers.get('content-type') ?? '';

  // ── 1. Notification from PayHere (form-encoded) ──
  if (ctype.includes('application/x-www-form-urlencoded') || ctype.includes('multipart/form-data')) {
    try {
      const f = await req.formData();
      const g = (k: string) => String(f.get(k) ?? '');
      const orderId = g('order_id'), amount = g('payhere_amount'), currency = g('payhere_currency'), code = g('status_code');
      if (!MID || !SECRET) return new Response('not configured', { status: 500 });
      const local = MD5U(g('merchant_id') + orderId + amount + currency + code + MD5U(SECRET));
      if (g('merchant_id') !== MID || local !== g('md5sig')) return new Response('bad signature', { status: 400 });

      const { data: p } = await admin.from('payments').select('*').eq('order_id', orderId).maybeSingle();
      if (!p) return new Response('unknown order', { status: 404 });
      const statusMap: Record<string, string> = { '2': 'paid', '0': 'pending', '-1': 'cancelled', '-2': 'failed', '-3': 'chargedback' };
      let status = statusMap[code] ?? 'failed';
      // never trust an amount that differs from what we asked for
      if (status === 'paid' && (currency !== p.currency || Math.abs(Number(amount) - Number(p.amount)) > 0.01)) status = 'failed';
      if (p.status === 'paid' && status !== 'chargedback') return new Response('ok');   // already settled
      const card = g('card_no') ? `${g('method')} ${g('card_no')}` : g('method');
      await admin.from('payments').update({
        status, status_code: Number(code), gateway_ref: g('payment_id') || null, card: card || null,
        raw: Object.fromEntries([...f.entries()].filter(([k]) => !['md5sig', 'card_holder_name', 'card_expiry'].includes(k)).map(([k, v]) => [k, String(v)])),
        updated_at: new Date().toISOString(), confirmed_at: status === 'paid' ? new Date().toISOString() : null,
      }).eq('id', p.id);
      if (status === 'paid') {
        await admin.from('invoices').update({ status: 'paid', paid_date: new Date().toISOString().slice(0, 10) }).eq('id', p.invoice_id).neq('status', 'paid');
      }
      return new Response('ok');
    } catch (e) {
      return new Response((e as Error).message, { status: 500 });
    }
  }

  // ── 2. App calls (JSON, signed-in user) ──
  try {
    const body = await req.json();
    const jwt = (req.headers.get('Authorization') ?? '').replace(/^Bearer\s+/i, '');
    const { data: who } = await admin.auth.getUser(jwt);
    if (!who?.user) return json({ error: 'Please sign in again.' });

    if (body?.action === 'status') {
      const { data: s } = await admin.from('app_settings').select('value').eq('key', 'payments').maybeSingle();
      return json({ configured: !!(MID && SECRET), sandbox: SANDBOX, enabled: !!s?.value?.payhere, merchant: MID ? `${MID.slice(0, 3)}•••${MID.slice(-2)}` : null });
    }

    if (body?.action === 'checkout') {
      if (!MID || !SECRET) return json({ error: 'Online payment is not set up yet. Please use bank transfer.' });
      const { data: s } = await admin.from('app_settings').select('value').eq('key', 'payments').maybeSingle();
      if (!s?.value?.payhere) return json({ error: 'Online payment is switched off right now.' });

      // read the invoice AS THE CALLER, so RLS decides whether it is theirs (and not a draft)
      const asCaller = createClient(URL_, Deno.env.get('SUPABASE_ANON_KEY')!, {
        global: { headers: { Authorization: `Bearer ${jwt}` } }, auth: { persistSession: false, autoRefreshToken: false },
      });
      const { data: inv } = await asCaller.from('invoices').select('id, invoice_no, total_amount, status, client_id').eq('id', String(body.invoice_id ?? '')).maybeSingle();
      if (!inv) return json({ error: 'Invoice not found.' });
      if (!['unpaid', 'overdue'].includes(inv.status)) return json({ error: 'This invoice is already paid.' });
      const amount = Number(inv.total_amount);
      if (!(amount > 0)) return json({ error: 'Nothing to pay on this invoice.' });

      const { data: c } = await admin.from('clients').select('full_name, email, mobile, address').eq('id', inv.client_id).single();
      const [first, ...rest] = String(c?.full_name || 'TaxMate Client').trim().split(/\s+/);
      const orderId = `${inv.invoice_no || 'INV'}-${crypto.randomUUID().slice(0, 6).toUpperCase()}`.replace(/[^A-Za-z0-9-]/g, '');
      const amt = money(amount);
      const { error: insErr } = await admin.from('payments').insert({
        invoice_id: inv.id, client_id: inv.client_id, method: 'payhere', amount: Number(amt), status: 'pending', order_id: orderId, created_by: who.user.id,
      });
      if (insErr) return json({ error: insErr.message });

      const fields: Record<string, string> = {
        merchant_id: MID,
        return_url: `${appUrlFor(req)}/client/invoices?payment=${encodeURIComponent(orderId)}`,
        cancel_url: `${appUrlFor(req)}/client/invoices?payment=${encodeURIComponent(orderId)}&cancelled=1`,
        notify_url: `${URL_}/functions/v1/payhere`,
        order_id: orderId,
        items: `TaxMate invoice ${inv.invoice_no ?? ''}`.trim(),
        currency: 'LKR',
        amount: amt,
        first_name: first || 'Client',
        last_name: rest.join(' ') || '-',
        email: c?.email || who.user.email || 'client@taxmate.lk',
        phone: c?.mobile || '0000000000',
        address: c?.address || 'Sri Lanka',
        city: 'Sri Lanka',
        country: 'Sri Lanka',
        custom_1: inv.id,
      };
      fields.hash = MD5U(MID + orderId + amt + 'LKR' + MD5U(SECRET));
      return json({ ok: true, action_url: SANDBOX ? 'https://sandbox.payhere.lk/pay/checkout' : 'https://www.payhere.lk/pay/checkout', fields });
    }
    return json({ error: 'Unknown action.' });
  } catch (e) {
    return json({ error: (e as Error).message ?? 'Unexpected error' });
  }
});
