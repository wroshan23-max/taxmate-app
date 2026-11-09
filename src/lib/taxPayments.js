// V57 — Monthly APIT & quarterly IIT instalments allocated to a client (table tax_payments).
// Paid amounts fill "Tax already paid" in the IIT Return (APIT → 903, instalments → 911).
import { supabase } from './supabase';

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
    apitCount: apit.length, instCount: inst.length, rows };
}
