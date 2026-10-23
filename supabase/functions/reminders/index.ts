// ═══════════════════════════════════════════════════════════
//  TaxMate — automatic email reminders
//  Called daily by pg_cron (header x-cron-key) and by admins (Settings → Email reminders):
//    { action: 'cron' | 'run' }  → send today's reminders      { action: 'test' } → test email to me
//    { action: 'status' }        → which email provider is set up
//  Provider secrets (Supabase → Edge Functions → Secrets): BREVO_API_KEY  or  RESEND_API_KEY
//  Deploy with "Verify JWT" OFF (the daily job has no login); admin calls are checked here.
// ═══════════════════════════════════════════════════════════
import { createClient } from 'npm:@supabase/supabase-js@2.49.4';

const cors = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-cron-key', 'Access-Control-Allow-Methods': 'POST, OPTIONS' };
const json = (b: unknown, s = 200) => new Response(JSON.stringify(b), { status: s, headers: { ...cors, 'Content-Type': 'application/json' } });
const APP = 'https://app.taxmatesolutions.com';
const MAX_PER_RUN = 250;
const esc = (s: unknown) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]!));
const rs = (n: number) => `Rs. ${Number(n || 0).toLocaleString('en-LK', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

// Sri Lanka date helpers (UTC+5:30)
const slToday = () => new Date(Date.now() + 5.5 * 3600e3).toISOString().slice(0, 10);
const addDays = (iso: string, n: number) => { const d = new Date(`${iso}T00:00:00Z`); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); };
const nice = (iso: string) => new Date(`${iso}T00:00:00Z`).toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC' });

function layout(firm: string, title: string, bodyHtml: string, cta?: { label: string; url: string }) {
  return `<!doctype html><html><body style="margin:0;background:#f3f4f6;font-family:Segoe UI,Arial,sans-serif;color:#1f2937">
<table width="100%" cellpadding="0" cellspacing="0" style="padding:24px 12px"><tr><td align="center">
<table width="560" cellpadding="0" cellspacing="0" style="max-width:560px;width:100%;background:#fff;border-radius:16px;overflow:hidden">
<tr><td style="background:linear-gradient(135deg,#1e3a8a,#312e81);background-color:#1e3a8a;padding:20px 24px;color:#fff;font-size:22px;font-weight:900">Tax<span style="color:#eab308">Mate</span>
<div style="font-size:12px;font-weight:400;color:#c7d2fe">${esc(firm)}</div></td></tr>
<tr><td style="padding:24px"><div style="font-size:18px;font-weight:800;color:#1e3a8a;margin-bottom:10px">${esc(title)}</div>
<div style="font-size:14px;line-height:1.6">${bodyHtml}</div>
${cta ? `<div style="margin-top:20px"><a href="${cta.url}" style="display:inline-block;background:#eab308;color:#1e3a8a;font-weight:800;text-decoration:none;padding:12px 20px;border-radius:10px">${esc(cta.label)}</a></div>` : ''}
</td></tr>
<tr><td style="padding:14px 24px;background:#f9fafb;font-size:11px;color:#6b7280">You receive this because you are a client of ${esc(firm)}. To stop email reminders, open your portal → Security → Email reminders.</td></tr>
</table></td></tr></table></body></html>`;
}

async function send(to: string, subject: string, html: string, cfg: Record<string, string>) {
  const brevo = Deno.env.get('BREVO_API_KEY'), resend = Deno.env.get('RESEND_API_KEY');
  const fromName = cfg.from_name || 'TaxMate Solutions', fromEmail = cfg.from_email;
  if (!fromEmail) throw new Error('Sender email not set (Settings → Email reminders).');
  if (brevo) {
    const r = await fetch('https://api.brevo.com/v3/smtp/email', {
      method: 'POST', headers: { 'api-key': brevo, 'Content-Type': 'application/json', accept: 'application/json' },
      body: JSON.stringify({ sender: { name: fromName, email: fromEmail }, to: [{ email: to }], subject, htmlContent: html, ...(cfg.reply_to ? { replyTo: { email: cfg.reply_to } } : {}) }),
    });
    if (!r.ok) throw new Error(`Brevo ${r.status}: ${(await r.text()).slice(0, 200)}`);
    return;
  }
  if (resend) {
    const r = await fetch('https://api.resend.com/emails', {
      method: 'POST', headers: { Authorization: `Bearer ${resend}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ from: `${fromName} <${fromEmail}>`, to: [to], subject, html, ...(cfg.reply_to ? { reply_to: cfg.reply_to } : {}) }),
    });
    if (!r.ok) throw new Error(`Resend ${r.status}: ${(await r.text()).slice(0, 200)}`);
    return;
  }
  throw new Error('No email provider key (add BREVO_API_KEY or RESEND_API_KEY in Supabase secrets).');
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors });
  if (req.method !== 'POST') return json({ error: 'POST only' }, 405);
  const db = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!, { auth: { persistSession: false, autoRefreshToken: false } });
  let body: Record<string, unknown> = {};
  try { body = await req.json(); } catch { /* empty */ }
  const action = String(body.action ?? '');

  // who is calling?
  let isCron = false, adminEmail: string | null = null;
  const cronKey = req.headers.get('x-cron-key');
  if (cronKey) {
    const { data: ok } = await db.rpc('check_cron_key', { p_key: cronKey });
    isCron = ok === true;
  }
  if (!isCron) {
    const jwt = (req.headers.get('Authorization') ?? '').replace(/^Bearer\s+/i, '');
    const asCaller = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_ANON_KEY')!, { global: { headers: { Authorization: `Bearer ${jwt}` } }, auth: { persistSession: false, autoRefreshToken: false } });
    const { data: isAdmin } = await asCaller.rpc('is_admin');          // includes the 2FA / PIN step
    if (isAdmin !== true) return json({ error: 'Admins only.' }, 403);
    const { data: u } = await db.auth.getUser(jwt);
    adminEmail = u?.user?.email ?? null;
  }

  const { data: st } = await db.from('app_settings').select('value').eq('key', 'email').maybeSingle();
  const cfg = (st?.value ?? {}) as Record<string, any>;
  const types = { due_dates: true, invoices: true, documents: true, reminders: true, messages: true, ...(cfg.types ?? {}) };
  const { data: firmRow } = await db.from('app_settings').select('value').eq('key', 'firm').maybeSingle();
  const firm = (firmRow?.value as any)?.name || 'TaxMate Solutions';

  if (action === 'status') {
    const { data: log } = await db.from('email_log').select('kind, status, created_at').order('created_at', { ascending: false }).limit(1);
    return json({ provider: Deno.env.get('BREVO_API_KEY') ? 'brevo' : Deno.env.get('RESEND_API_KEY') ? 'resend' : null, enabled: !!cfg.enabled, from: cfg.from_email || null, last: log?.[0] ?? null });
  }

  if (action === 'test') {
    const to = String(body.to || adminEmail || '');
    if (!to) return json({ error: 'No email address to send to.' });
    try {
      await send(to, `Test email from ${firm}`, layout(firm, 'Email reminders are working ✅', `<p>This is a test from your TaxMate app. Clients will receive reminders like this one.</p>`, { label: 'Open TaxMate', url: APP }), cfg);
      await db.from('email_log').insert({ kind: 'test', ref: `test-${Date.now()}`, to_email: to, subject: 'Test email', status: 'sent' });
      return json({ ok: true, to });
    } catch (e) { return json({ error: (e as Error).message }); }
  }

  if (action !== 'cron' && action !== 'run') return json({ error: 'Unknown action.' });
  if (!cfg.enabled) return json({ ok: true, sent: 0, note: 'Email reminders are switched off.' });

  const today = slToday();
  const results = { sent: 0, failed: 0, skipped: 0, errors: [] as string[] };
  const { data: clients } = await db.from('clients').select('id, full_name, email, profile_id, email_opt_out, feature_overrides').is('archived_at', null);
  const byId = new Map((clients ?? []).map((c: any) => [c.id, c]));
  const okClient = (c: any) => c && c.email && /@/.test(c.email) && !c.email_opt_out;
  const first = (c: any) => String(c.full_name || '').trim().split(/\s+/)[0] || 'there';

  // already sent?
  const { data: sentRows } = await db.from('email_log').select('kind, ref, client_id').eq('status', 'sent').gte('created_at', new Date(Date.now() - 400 * 864e5).toISOString());
  const sentKey = new Set((sentRows ?? []).map((r: any) => `${r.kind}|${r.ref}|${r.client_id}`));

  const queue: { c: any; kind: string; ref: string; subject: string; html: string }[] = [];
  const add = (c: any, kind: string, ref: string, subject: string, title: string, html: string, cta?: { label: string; url: string }) => {
    if (!okClient(c) || sentKey.has(`${kind}|${ref}|${c.id}`) || queue.some(q => q.c.id === c.id && q.kind === kind && q.ref === ref)) return;
    queue.push({ c, kind, ref, subject, html: layout(firm, title, html, cta) });
  };

  // 1. Income tax deadlines (portal clients whose return for that year isn't filed)
  if (types.due_dates) {
    const Y = Number(today.slice(0, 4));
    const deadlines = [
      { date: `${Y}-11-30`, ya: `${Y - 1}/${String(Y % 100).padStart(2, '0')}`, what: 'last day to file your Income Tax Return', before: [7, 1] },
      { date: `${Y}-09-30`, ya: `${Y - 1}/${String(Y % 100).padStart(2, '0')}`, what: 'last day to pay any balance income tax', before: [7] },
    ];
    const { data: filed } = await db.from('tax_returns').select('client_id, year').eq('stage', 'filed');
    const isFiled = new Set((filed ?? []).map((r: any) => `${r.client_id}|${r.year}`));
    for (const d of deadlines) for (const b of d.before) {
      if (addDays(today, b) !== d.date) continue;
      for (const c of clients ?? []) {
        if (!c.profile_id || isFiled.has(`${c.id}|${d.ya}`)) continue;
        add(c, 'due_dates', `iit-${d.date}-d${b}`, `Reminder: ${nice(d.date)} — ${d.what}`, `${b === 1 ? 'Tomorrow' : `In ${b} days`}: ${d.what}`,
          `<p>Hi ${esc(first(c))},</p><p><b>${nice(d.date)}</b> is the ${esc(d.what)} for the Year of Assessment <b>${d.ya}</b>.</p><p>Please send any documents we still need so we can complete it on time.</p>`,
          { label: 'Open my portal', url: `${APP}/client/tax-returns` });
      }
    }
  }

  // 2. Unpaid invoices: 3 days before due, on the due date, 7 days overdue
  if (types.invoices) {
    const { data: invs } = await db.from('invoices').select('id, client_id, invoice_no, total_amount, due_date, status').in('status', ['unpaid', 'overdue']).not('due_date', 'is', null);
    for (const i of invs ?? []) {
      const c = byId.get(i.client_id);
      const stage = i.due_date === addDays(today, 3) ? 'd-3' : i.due_date === today ? 'd0' : i.due_date === addDays(today, -7) ? 'd+7' : null;
      if (!stage) continue;
      const title = stage === 'd-3' ? `Invoice ${i.invoice_no} is due in 3 days` : stage === 'd0' ? `Invoice ${i.invoice_no} is due today` : `Invoice ${i.invoice_no} is overdue`;
      add(c, 'invoices', `${i.id}-${stage}`, `${title} — ${rs(i.total_amount)}`, title,
        `<p>Hi ${esc(first(c))},</p><p>Your invoice <b>${esc(i.invoice_no)}</b> for <b>${rs(i.total_amount)}</b> ${stage === 'd+7' ? `was due on ${nice(i.due_date)}` : `is due on ${nice(i.due_date)}`}.</p><p>You can pay online or upload a bank slip in your portal.</p>`,
        { label: 'Pay now', url: `${APP}/client/invoices` });
    }
  }

  // 3. Documents: return started but nothing uploaded after 7 and 21 days
  if (types.documents) {
    const { data: rets } = await db.from('tax_returns').select('id, client_id, year, stage, created_at').eq('stage', 'docs');
    const { data: docs } = await db.from('client_documents').select('client_id, year');
    const has = new Set((docs ?? []).map((d: any) => `${d.client_id}|${d.year}`));
    for (const r of rets ?? []) {
      const c = byId.get(r.client_id);
      if (!c?.profile_id || has.has(`${r.client_id}|${r.year}`)) continue;
      const age = Math.floor((Date.parse(`${today}T00:00:00Z`) - Date.parse(r.created_at)) / 864e5);
      const step = age === 7 ? 'd7' : age === 21 ? 'd21' : null;
      if (!step) continue;
      add(c, 'documents', `${r.id}-${step}`, `Documents needed for your ${r.year} tax return`, 'We need a few documents',
        `<p>Hi ${esc(first(c))},</p><p>To prepare your Income Tax Return for Y/A <b>${esc(r.year)}</b>, please upload your salary certificate (T-10 / APIT), bank interest certificates and any other income records.</p><p>Snap a photo with your phone — it takes a minute.</p>`,
        { label: 'Upload documents', url: `${APP}/client/documents` });
    }
  }

  // 4. Reminders due tomorrow (for one client, all clients, or the client's own)
  if (types.reminders) {
    const tomorrow = addDays(today, 1);
    const { data: rems } = await db.from('reminders').select('id, title, note, due_date, audience, client_id').eq('due_date', tomorrow).is('done_at', null).in('audience', ['client', 'all', 'personal']);
    for (const r of rems ?? []) {
      const targets = r.audience === 'all' ? (clients ?? []).filter((c: any) => c.profile_id) : [byId.get(r.client_id)];
      for (const c of targets) add(c, 'reminders', `${r.id}`, `Reminder for tomorrow: ${r.title}`, `Tomorrow: ${r.title}`,
        `<p>Hi ${esc(first(c))},</p><p>A reminder for <b>${nice(r.due_date)}</b>:</p><p style="background:#f3f4f6;border-radius:8px;padding:10px 12px"><b>${esc(r.title)}</b>${r.note ? `<br>${esc(r.note)}` : ''}</p>`,
        { label: 'Open my calendar', url: `${APP}/client/calendar` });
    }
  }

  // 5. Unread messages from TaxMate older than 24 hours (one email per day)
  if (types.messages) {
    const { data: msgs } = await db.from('messages').select('client_id, created_at').eq('sender_role', 'admin').is('read_at', null).not('client_id', 'is', null).lt('created_at', new Date(Date.now() - 864e5).toISOString());
    const counts = new Map<string, number>();
    for (const m of msgs ?? []) counts.set(m.client_id, (counts.get(m.client_id) ?? 0) + 1);
    for (const [cid, n] of counts) {
      const c = byId.get(cid);
      if (!c?.profile_id) continue;
      add(c, 'messages', `${cid}-${today}`, `You have ${n} unread message${n > 1 ? 's' : ''} from ${firm}`, `${n} new message${n > 1 ? 's' : ''} waiting for you`,
        `<p>Hi ${esc(first(c))},</p><p>${esc(firm)} sent you ${n > 1 ? `${n} messages` : 'a message'} in your client portal.</p>`, { label: 'Read messages', url: `${APP}/client/messages` });
    }
  }

  for (const q of queue.slice(0, MAX_PER_RUN)) {
    try {
      await send(q.c.email, q.subject, q.html, cfg);
      await db.from('email_log').insert({ client_id: q.c.id, kind: q.kind, ref: q.ref, to_email: q.c.email, subject: q.subject, status: 'sent' });
      results.sent++;
    } catch (e) {
      const msg = (e as Error).message;
      await db.from('email_log').insert({ client_id: q.c.id, kind: q.kind, ref: q.ref, to_email: q.c.email, subject: q.subject, status: 'failed', error: msg.slice(0, 300) });
      results.failed++; if (results.errors.length < 3) results.errors.push(msg);
    }
  }
  results.skipped = Math.max(0, queue.length - MAX_PER_RUN);
  return json({ ok: true, by: isCron ? 'daily job' : 'admin', date: today, queued: queue.length, ...results });
});
