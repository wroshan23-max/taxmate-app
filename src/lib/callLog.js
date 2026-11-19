// V66 — Call Log: every call / enquiry with follow-ups, link or convert to a client, reports
import { supabase } from './supabase';
import { FIRM, waNumber } from './firm';
import { downloadXlsx } from './xlsx';

export const SERVICES = [
  ['iit', 'Individual Income Tax (IIT)'], ['tin', 'TIN registration'], ['company', 'Company tax return'], ['vat', 'VAT'],
  ['apit', 'PAYE / APIT'], ['ramis', 'RAMIS account help'], ['bookkeeping', 'Accounting & bookkeeping'], ['fs', 'Financial statements'],
  ['payroll', 'Payroll & EPF/ETF'], ['consult', 'Tax consultation'], ['digital', 'Digital / cloud bookkeeping'], ['other', 'Other'],
];
export const SERVICE = Object.fromEntries(SERVICES);

export const SOURCES = [
  ['facebook', 'Facebook'], ['whatsapp', 'WhatsApp'], ['google', 'Google / website'], ['referral', 'Friend / referral'],
  ['existing', 'Existing client'], ['tiktok', 'TikTok / YouTube'], ['flyer', 'Flyer / banner'], ['walk_in', 'Walk-in'], ['other', 'Other'],
];
export const SOURCE = Object.fromEntries(SOURCES);

export const CHANNELS = { incoming: ['📞', 'Incoming call'], outgoing: ['📲', 'Outgoing call'], missed: ['📵', 'Missed call'], whatsapp: ['💬', 'WhatsApp'], walk_in: ['🚶', 'Walk-in'] };

export const STATUS = {
  new:       { label: 'New enquiry',    cls: 'bg-blue-100 text-blue-800' },
  follow_up: { label: 'Follow up',      cls: 'bg-amber-100 text-amber-800' },
  won:       { label: 'Became client',  cls: 'bg-green-100 text-green-800' },
  lost:      { label: 'Not interested', cls: 'bg-gray-200 text-gray-600' },
  done:      { label: 'Done / info only', cls: 'bg-slate-100 text-slate-600' },
};

/** Colombo date (YYYY-MM-DD) of a timestamp */
export const slDate = (t = new Date()) => new Date(new Date(t).getTime() + 5.5 * 3600e3).toISOString().slice(0, 10);
export const slTime = (t) => new Date(t).toLocaleTimeString('en-LK', { hour: 'numeric', minute: '2-digit', timeZone: 'Asia/Colombo' });
export const slDay = (t) => new Date(t).toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short', timeZone: 'Asia/Colombo' });
/** "YYYY-MM-DDTHH:mm" (Colombo) → ISO; and back for <input type="datetime-local"> */
export const fromLocal = (s) => (s ? new Date(`${s}:00+05:30`).toISOString() : null);
export const toLocal = (t) => (t ? new Date(new Date(t).getTime() + 5.5 * 3600e3).toISOString().slice(0, 16) : '');
/** quick follow-up choices → Colombo time */
export function followUpAt(kind) {
  const d = new Date(Date.now() + 5.5 * 3600e3);   // Colombo "now" as UTC fields
  const at = (days, h) => { const x = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate() + days, h, 0)); return new Date(x.getTime() - 5.5 * 3600e3).toISOString(); };
  if (kind === 'later') { const x = new Date(Date.now() + 3 * 3600e3); x.setUTCMinutes(0, 0, 0); return x.toISOString(); }
  if (kind === 'tomorrow') return at(1, 10);
  if (kind === '3days') return at(3, 10);
  if (kind === 'week') return at(7, 10);
  return null;
}
/** follow-up state: overdue · today · upcoming */
export function dueState(c, now = Date.now()) {
  if (c.status !== 'follow_up' || !c.follow_up_at) return null;
  const t = new Date(c.follow_up_at).getTime();
  if (t < now) return slDate(t) === slDate(now) ? 'today' : 'overdue';
  return slDate(t) === slDate(now) ? 'today' : 'upcoming';
}

const clean = (s) => String(s ?? '').trim();
export const telLink = (phone) => `tel:${clean(phone).replace(/[^\d+]/g, '')}`;
export const waLink = (phone, text) => `https://wa.me/${waNumber(phone)}${text ? `?text=${encodeURIComponent(text)}` : ''}`;

/** WhatsApp messages after a call (English + Sinhala) */
export function waMessage(kind, c) {
  const first = clean(c.name).split(/\s+/)[0] || '';
  const hi = `Dear ${first || 'Sir / Madam'},`;
  const svc = (c.services || []).map((k) => SERVICE[k]).filter(Boolean).join(', ');
  const sign = ['', 'Thank you,', FIRM.name, `📞 ${FIRM.phone}${FIRM.web ? ` · ${FIRM.web}` : ''}`];
  if (kind === 'missed') return [hi, '', `Sorry we missed your call. How can we help you? Please reply here or we will call you back shortly.`, '',
    'ඔබගේ ඇමතුමට පිළිතුරු දීමට නොහැකි වූයේ කනගාටුවෙනි. ඔබට අවශ්‍ය සේවාව මෙහි සඳහන් කරන්න, නැතහොත් අපි ඉක්මනින් නැවත අමතන්නෙමු.', ...sign].join('\n');
  if (kind === 'docs') return [hi, '', `Thank you for calling ${FIRM.name}.${svc ? ` For ${svc}` : ''} please send us the documents below (photo or PDF is fine):`, '',
    '• NIC copy', '• Salary slips / employer certificate (APIT)', '• Bank interest certificates', '• Any other income details', '',
    'අවශ්‍ය ලේඛන (ඡායාරූප හෝ PDF) මෙම WhatsApp අංකයට එවන්න.', ...sign].join('\n');
  if (kind === 'follow') return [hi, '', `Following up on our call${svc ? ` about ${svc}` : ''}. Would you like us to go ahead? We are happy to answer any questions.`, '',
    'අපගේ කතාබහට අනුව, ඉදිරියට කටයුතු කරමුද? ඕනෑම ප්‍රශ්නයක් ඇත්නම් විමසන්න.', ...sign].join('\n');
  return [hi, '', `Thank you for calling ${FIRM.name}.${svc ? ` We noted your enquiry about ${svc}.` : ''}`,
    c.quoted_fee ? `Our fee: Rs. ${Number(c.quoted_fee).toLocaleString('en-LK')}.` : '', 'Save this number — you can WhatsApp us any time.', '',
    `${FIRM.name} අමතා සම්බන්ධ වූවාට ස්තූතියි. ඕනෑම වේලාවක මෙම අංකයට WhatsApp කරන්න.`, ...sign].filter((x, i, a) => x !== '' || a[i - 1] !== '').join('\n');
}
export const WA_KINDS = [['thanks', 'Thank you for calling'], ['docs', 'Send documents list'], ['follow', 'Follow-up message'], ['missed', 'Missed call — sorry']];

// ─── data ───
const SEL = 'id, called_at, channel, phone, phone_key, name, email, location, client_id, services, source, notes, status, quoted_fee, follow_up_at, followed_up_at, created_at, updated_at, clients(id, full_name, client_no)';
export async function loadCalls({ from, to, limit = 3000 } = {}) {
  let q = supabase.from('call_logs').select(SEL).order('called_at', { ascending: false }).limit(limit);
  if (from) q = q.gte('called_at', from);
  if (to) q = q.lt('called_at', to);
  const { data, error } = await q;
  if (error) throw new Error(error.message);
  return data ?? [];
}
/** open follow-ups (any date) — always loaded so none are missed */
export async function loadOpenFollowUps() {
  const { data, error } = await supabase.from('call_logs').select(SEL).eq('status', 'follow_up').order('follow_up_at', { ascending: true, nullsFirst: false }).limit(500);
  if (error) throw new Error(error.message);
  return data ?? [];
}
const FIELDS = ['called_at', 'channel', 'phone', 'name', 'email', 'location', 'client_id', 'services', 'source', 'notes', 'status', 'quoted_fee', 'follow_up_at'];
export async function saveCall(c) {
  const row = Object.fromEntries(FIELDS.filter((k) => k in c).map((k) => [k, c[k] === '' ? null : c[k]]));
  const q = c.id ? supabase.from('call_logs').update(row).eq('id', c.id) : supabase.from('call_logs').insert(row);
  const { data, error } = await q.select(SEL).single();
  if (error) throw new Error(error.message.includes('phone') ? 'Check the phone number.' : error.message);
  return data;
}
export async function patchCall(id, patch) {
  const { data, error } = await supabase.from('call_logs').update(patch).eq('id', id).select(SEL).single();
  if (error) throw new Error(error.message);
  return data;
}
export async function deleteCall(id) {
  const { error } = await supabase.from('call_logs').delete().eq('id', id);
  if (error) throw new Error(error.message);
}
export async function matchPhone(phone, except) {
  const { data, error } = await supabase.rpc('admin_call_match', { p_phone: phone, p_except: except || null });
  if (error) throw new Error(error.message);
  return data;
}
export async function callToClient(callId, clientId, name) {
  const { data, error } = await supabase.rpc('admin_call_to_client', { p_call: callId, p_client: clientId || null, p_name: name || null });
  if (error) throw new Error(error.message.replace(/^.*?ERROR:\s*/, ''));
  return data;
}

// ─── reports ───
export function callStats(rows) {
  const by = (f) => rows.reduce((m, r) => { for (const k of [].concat(f(r) ?? [])) m[k] = (m[k] || 0) + 1; return m; }, {});
  const decided = rows.filter((r) => r.status === 'won' || r.status === 'lost');
  const won = rows.filter((r) => r.status === 'won').length;
  const days = by((r) => slDate(r.called_at));
  const hours = by((r) => new Date(new Date(r.called_at).getTime() + 5.5 * 3600e3).getUTCHours());   // Colombo hour 0–23
  return {
    total: rows.length,
    newCallers: new Set(rows.filter((r) => !r.client_id).map((r) => r.phone_key || r.phone)).size,
    won, lost: rows.filter((r) => r.status === 'lost').length,
    conversion: decided.length ? Math.round((won / decided.length) * 100) : null,
    missed: rows.filter((r) => r.channel === 'missed').length,
    quoted: rows.filter((r) => r.status === 'won').reduce((a, r) => a + Number(r.quoted_fee || 0), 0),
    pipeline: rows.filter((r) => r.status === 'new' || r.status === 'follow_up').reduce((a, r) => a + Number(r.quoted_fee || 0), 0),
    services: by((r) => r.services), sources: by((r) => r.source || 'unknown'), status: by((r) => r.status), channels: by((r) => r.channel), days, hours,
  };
}

export function exportCalls(rows, label) {
  const head = ['Date', 'Time', 'Type', 'Phone', 'Name', 'Client', 'Client no.', 'Services', 'How they found us', 'Status', 'Follow-up', 'Fee quoted (Rs.)', 'Email', 'Location', 'Notes'];
  const data = rows.map((r) => [slDate(r.called_at), slTime(r.called_at), CHANNELS[r.channel]?.[1] || r.channel, r.phone, r.name || '', r.clients?.full_name || '', r.clients?.client_no || '',
    (r.services || []).map((k) => SERVICE[k] || k).join(', '), SOURCE[r.source] || r.source || '', STATUS[r.status]?.label || r.status,
    r.follow_up_at ? `${slDate(r.follow_up_at)} ${slTime(r.follow_up_at)}` : '', r.quoted_fee != null ? { v: Number(r.quoted_fee), s: 'm' } : '', r.email || '', r.location || '', r.notes || '']);
  const s = callStats(rows);
  const sum = [['TaxMate Solutions — Call Log', ''], ['Period', label], ['', ''], ['Calls / enquiries', s.total], ['New callers (not clients)', s.newCallers], ['Missed calls', s.missed],
    ['Became clients', s.won], ['Not interested', s.lost], ['Conversion (won ÷ decided)', s.conversion == null ? '—' : `${s.conversion}%`],
    ['Fees quoted — won (Rs.)', { v: s.quoted, s: 'm' }], ['Fees quoted — still open (Rs.)', { v: s.pipeline, s: 'm' }], ['', ''], [{ v: 'Service asked about', s: 'h' }, { v: 'Calls', s: 'h' }],
    ...Object.entries(s.services).sort((a, b) => b[1] - a[1]).map(([k, n]) => [SERVICE[k] || k, n]), ['', ''], [{ v: 'How they found us', s: 'h' }, { v: 'Calls', s: 'h' }],
    ...Object.entries(s.sources).sort((a, b) => b[1] - a[1]).map(([k, n]) => [SOURCE[k] || (k === 'unknown' ? 'Not recorded' : k), n])];
  downloadXlsx(`TaxMate_Call_Log_${label.replace(/[^\w-]+/g, '_')}.xlsx`, [
    { name: 'Calls', rows: [head.map((v) => ({ v, s: 'h' })), ...data], widths: [11, 9, 13, 15, 22, 22, 10, 30, 16, 15, 17, 14, 22, 14, 50], freeze: 1 },
    { name: 'Summary', rows: sum, widths: [34, 16] },
  ]);
}
