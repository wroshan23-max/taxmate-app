// V71 — Final tax balance (from the FINAL computation) marked as paid, with an optional receipt.
// The receipt is a normal client document (type "Filed return / receipt"), so it also shows in Documents.
import { supabase } from './supabase';
import { uploadDocument, signedUrl } from './documents';

const clean = (e) => new Error(String(e?.message || e).replace(/^.*?ERROR:\s*/, ''));
const missing = (e) => /tax_balance_payments|schema cache|does not exist/.test(e?.message || '');

/** { 'client|year': row } — quietly empty until the V71 script has been run */
export async function loadBalancePayments(clientId = null) {
  let q = supabase.from('tax_balance_payments').select('*').limit(2000);
  if (clientId) q = q.eq('client_id', clientId);
  const { data, error } = await q;
  if (error) { if (missing(error)) return {}; throw clean(error); }
  return Object.fromEntries((data ?? []).map((r) => [`${r.client_id}|${r.year}`, r]));
}

/** Upload the receipt into the client's Documents and return the document id */
export async function uploadReceipt({ clientId, year, file, role, userId, amount }) {
  const title = `Tax payment receipt — Y/A ${year}`;
  const note = amount ? `Income tax paid: Rs. ${Number(amount).toLocaleString('en-LK')}` : null;
  // a client may only upload into their own types; the database re-files it as "Filed return / receipt"
  const doc = await uploadDocument({ clientId, file, year, category: role === 'admin' ? 'return' : 'ird', title, note, role, userId });
  return doc.id;
}

export async function markMyBalancePaid({ calcId, amount, paidOn, reference, docId }) {
  const { error } = await supabase.rpc('mark_my_tax_balance_paid', { p_calc: calcId, p_amount: Number(amount), p_paid_on: paidOn, p_reference: reference || '', p_doc: docId || null });
  if (error) throw clean(error);
}
export async function addMyReceipt(id, docId) {
  const { error } = await supabase.rpc('my_tax_balance_receipt', { p_id: id, p_doc: docId });
  if (error) throw clean(error);
}
export async function undoMyBalancePaid(id) {
  const { error } = await supabase.rpc('undo_my_tax_balance_paid', { p_id: id });
  if (error) throw clean(error);
}
export async function adminBalancePaid({ clientId, year, calcId, amountDue, amount, paidOn, reference, docId }) {
  const { error } = await supabase.rpc('admin_tax_balance_paid', {
    p_client: clientId, p_year: year, p_calc: calcId || null, p_amount_due: amountDue ?? null, p_amount: Number(amount), p_paid_on: paidOn, p_reference: reference || '', p_doc: docId || null,
  });
  if (error) throw clean(error);
}
export async function checkBalancePayment(id, ok, note = '') {
  const { error } = await supabase.rpc('admin_check_tax_balance', { p_id: id, p_ok: ok, p_note: note || null });
  if (error) throw clean(error);
}
export async function removeBalancePayment(id) {
  const { error } = await supabase.from('tax_balance_payments').delete().eq('id', id);
  if (error) throw clean(error);
}
/** Open the receipt (admin or the client — the database checks access) */
export async function openReceipt(docId) {
  const w = window.open('', '_blank');
  try {
    const { data: doc, error } = await supabase.from('client_documents').select('id, path, storage, title, mime').eq('id', docId).maybeSingle();
    if (error || !doc) throw new Error('The receipt file was not found.');
    const url = await signedUrl(doc);
    if (w) w.location.href = url; else window.location.href = url;
  } catch (e) { w?.close(); throw e; }
}
export const todayLK = () => new Date(Date.now() + 5.5 * 3600e3).toISOString().slice(0, 10);
