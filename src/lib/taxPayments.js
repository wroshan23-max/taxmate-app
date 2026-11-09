// V57 — Monthly APIT & quarterly IIT instalments allocated to a client (table tax_payments).
// Paid amounts fill "Tax already paid" in the IIT Return (APIT → 903, instalments → 911).
import { supabase, fmtRs, fmtDate } from './supabase';
import { compressImage, fmtBytes } from './documents';
import { lookup, CATEGORY_S } from './irdCodes';
import { FIRM } from './firm';

const MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const pad = (n) => String(n).padStart(2, '0');
const iso = (y, m, d) => `${y}-${pad(m)}-${pad(d)}`;

/** Y/A (1 April – 31 March) that a date falls in, e.g. "2026/27" */
export function yaOf(d = new Date()) {
  const ys = d.getMonth() >= 3 ? d.getFullYear() : d.getFullYear() - 1;
  return `${ys}/${String(ys + 1).slice(2)}`;
}
export const yaStart = (ya) => parseInt(ya, 10);
export function yaList(extra = []) {
  const cur = yaStart(yaOf());
  const set = new Set([`${cur + 1}/${String(cur + 2).slice(2)}`, yaOf(), ...[1, 2, 3].map(k => `${cur - k}/${String(cur - k + 1).slice(2)}`), ...extra]);
  return [...set].sort().reverse();
}

/** The 12 months of a Y/A: { period: 'YYYY-MM', label: 'Apr 2025', due: 'YYYY-MM-15' (APIT is paid by the 15th of the next month) } */
export function yaMonths(ya) {
  const s = yaStart(ya);
  return Array.from({ length: 12 }, (_, i) => {
    const m = ((3 + i) % 12) + 1, y = i < 9 ? s : s + 1;
    const nm = (m % 12) + 1, ny = m === 12 ? y + 1 : y;
    return { period: `${y}-${pad(m)}`, label: `${MON[m - 1]} ${y}`, due: iso(ny, nm, 15) };
  });
}
export const monthLabelOf = (period) => { const [y, m] = String(period).split('-').map(Number); return y && m ? `${MON[m - 1]} ${y}` : period; };

/** Quarterly instalment due dates: Q1 15 Aug · Q2 15 Nov · Q3 15 Feb · Q4 15 May */
export function instalmentDue(ya, q) {
  const s = yaStart(ya);
  return [iso(s, 8, 15), iso(s, 11, 15), iso(s + 1, 2, 15), iso(s + 1, 5, 15)][Number(String(q).replace('Q', '')) - 1];
}
export const QUARTER_MONTHS = { Q1: 'Apr–Jun', Q2: 'Jul–Sep', Q3: 'Oct–Dec', Q4: 'Jan–Mar' };
export const periodLabel = (p) => (p.kind === 'instalment' ? `${p.period} instalment (${QUARTER_MONTHS[p.period]})` : `APIT ${monthLabelOf(p.period)}`);

export async function loadPayments(clientId, year) {
  let q = supabase.from('tax_payments').select('*').eq('client_id', clientId);
  if (year) q = q.eq('year', year);
  const { data, error } = await q.order('year', { ascending: false }).order('kind').order('period');
  if (error) throw new Error(error.message);
  return data ?? [];
}

/** Save several rows at once (one per month / quarter). Existing rows for the same period are replaced. */
export async function savePayments(rows) {
  const { data, error } = await supabase.from('tax_payments')
    .upsert(rows.map(r => ({ ...r, updated_at: new Date().toISOString() })), { onConflict: 'client_id,year,kind,period' }).select();
  if (error) throw new Error(error.message);
  return data ?? [];
}
export async function updatePayment(id, patch) {
  const { error } = await supabase.from('tax_payments').update({ ...patch, updated_at: new Date().toISOString() }).eq('id', id);
  if (error) throw new Error(error.message);
}
export async function deletePayment(id) {
  const { error } = await supabase.from('tax_payments').delete().eq('id', id);
  if (error) throw new Error(error.message);
}

/** Paid totals for the IIT Return: { apit, instalments, apitCount, instCount, rows } */
export async function paidTotals(clientId, year) {
  const rows = (await loadPayments(clientId, year)).filter(r => r.status === 'paid');
  const amt = (r) => Number(r.paid_amount ?? r.amount) || 0;
  const apit = rows.filter(r => r.kind === 'apit'), inst = rows.filter(r => r.kind === 'instalment');
  return { apit: Math.round(apit.reduce((a, r) => a + amt(r), 0)), instalments: Math.round(inst.reduce((a, r) => a + amt(r), 0)),
    apitCount: apit.length, instCount: inst.length, unchecked: rows.filter(r => r.paid_by_role === 'client' && !r.checked_at).length, rows };
}

// ─── V58 — client marks paid with a receipt · admin checks & reminds ───

/** IRD codes to write on the paying-in slip / OTPP: { typeCode, typeName, periodCode, category } */
export function irdCodesOf(r) {
  try {
    const res = r.kind === 'instalment'
      ? lookup('iit', { ya: yaStart(r.year), instalment: Number(String(r.period).replace('Q', '')) })
      : (() => { const [y, m] = String(r.period).split('-').map(Number); return lookup('apit', { year: y, month: m }); })();
    return res ? { typeCode: res.type.code, typeName: res.type.name, periodCode: res.periodCode, category: CATEGORY_S.code } : null;
  } catch { return null; }
}
export const isOverdue = (r, today = new Date().toISOString().slice(0, 10)) => r.status !== 'paid' && !!r.due_date && r.due_date < today;

const RECEIPT_TYPES = ['image/jpeg', 'image/png', 'image/webp', 'application/pdf'];
/** Client: upload the receipt (bucket payment-slips, own folder) and mark the payment paid */
export async function markMyPaid({ row, amount, paidOn, reference, file }) {
  if (!file) throw new Error('Please attach the payment receipt (photo or PDF).');
  const f = await compressImage(file);
  if (!RECEIPT_TYPES.includes(f.type)) throw new Error('The receipt must be a photo (JPG / PNG) or a PDF.');
  if (f.size > 5 * 1024 * 1024) throw new Error(`The receipt is ${fmtBytes(f.size)} — please send a smaller copy (max 5 MB).`);
  const ext = f.type === 'application/pdf' ? 'pdf' : f.type.split('/')[1].replace('jpeg', 'jpg');
  const path = `${row.client_id}/tax-${row.id.slice(0, 8)}-${Date.now()}-${Math.random().toString(36).slice(2, 6)}.${ext}`;
  const { error: upErr } = await supabase.storage.from('payment-slips').upload(path, f, { contentType: f.type, upsert: false });
  if (upErr) throw new Error(upErr.message);
  const { error } = await supabase.rpc('mark_my_tax_payment_paid', {
    p_id: row.id, p_amount: Number(amount), p_paid_on: paidOn || null, p_reference: reference || '', p_receipt_path: path, p_receipt_name: (file.name || '').slice(0, 200),
  });
  if (error) { supabase.storage.from('payment-slips').remove([path]).catch(() => {}); throw new Error(error.message.replace(/^.*?ERROR:\s*/, '')); }
}
export async function undoMyPaid(id) {
  const { error } = await supabase.rpc('undo_my_tax_payment_paid', { p_id: id });
  if (error) throw new Error(error.message);
}
export async function receiptUrl(path) {
  const { data, error } = await supabase.storage.from('payment-slips').createSignedUrl(path, 300);
  if (error) throw new Error(error.message);
  return data.signedUrl;
}
/** Admin: receipt checked (ok) or not accepted (back to due; the client is told why) */
export async function checkPayment(id, ok, note = '') {
  const { error } = await supabase.rpc('admin_check_tax_payment', { p_id: id, p_ok: ok, p_note: note || null });
  if (error) throw new Error(error.message);
}
/** Admin: stamp the reminder + in-app notice for the client. Returns how many were reminded. */
export async function remindPayments(clientId, ids) {
  const { data, error } = await supabase.rpc('admin_remind_tax_payments', { p_client: clientId, p_ids: ids });
  if (error) throw new Error(error.message);
  return data ?? 0;
}
/** WhatsApp / email text for a reminder */
export function reminderText(name, rows) {
  const today = new Date().toISOString().slice(0, 10);
  const total = rows.reduce((a, r) => a + Number(r.amount || 0), 0);
  const lines = [`Dear ${name || 'Sir/Madam'},`, '', `This is a friendly reminder from ${FIRM.name}. The following tax payment${rows.length > 1 ? 's are' : ' is'} due:`, ''];
  rows.forEach((r, i) => {
    const c = irdCodesOf(r);
    lines.push(`${i + 1}. ${periodLabel(r)} — ${fmtRs(r.amount)}`);
    lines.push(`   ${isOverdue(r, today) ? '⚠️ Overdue — was due' : 'Pay on or before'} ${fmtDate(r.due_date)}`);
    if (c) lines.push(`   Tax Type ${c.typeCode} · Period ${c.periodCode} · Category ${c.category}`);
  });
  if (rows.length > 1) lines.push('', `Total: ${fmtRs(total)}`);
  lines.push('', 'Pay online through IRD OTPP, or at Bank of Ceylon / People\'s Bank with a paying-in slip (write your TIN on the slip).',
    '', `After paying, open your TaxMate portal → Dashboard → "I've paid" and upload the receipt: ${window.location.origin}/client`,
    '', 'ගෙවීමෙන් පසු TaxMate portal එකේ Dashboard එකෙන් "I\'ve paid" ඔබා රිසිට්පත upload කරන්න.',
    '', 'Thank you,', FIRM.name, ...(FIRM.whatsapp ? [`WhatsApp ${FIRM.whatsapp}`] : []));
  return lines.join('\n');
}
