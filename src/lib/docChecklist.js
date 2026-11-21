// V68 — Document checklist per client and Y/A: templates, data, reminder messages
import { supabase } from './supabase';
import { FIRM } from './firm';

/** Ready-made lists for Sri Lankan individual income tax. category = document vault category (an upload there ticks the item). */
export const TEMPLATES = [
  { key: 'basic', name: 'Basic (every client)', emoji: '🪪', items: [
    { label: 'NIC copy (both sides)', label_si: 'හැඳුනුම්පතේ පිටපත (දෙපැත්තම)', category: 'id' },
    { label: 'Last year\'s tax return / IRD assessment notice', label_si: 'පසුගිය වසරේ බදු ප්‍රකාශය / IRD තක්සේරු දැන්වීම', category: 'ird', hint: 'If filed by someone else' },
  ] },
  { key: 'salary', name: 'Employment income', emoji: '💼', items: [
    { label: 'T-10 / APIT certificate from each employer', label_si: 'සෑම සේවා ස්ථානයකින්ම T-10 / APIT සහතිකය', category: 'salary' },
    { label: 'Pay slips for the year (if no T-10)', label_si: 'වර්ෂයේ වැටුප් පත්‍රිකා (T-10 නොමැති නම්)', category: 'salary', hint: 'April to March' },
  ] },
  { key: 'bank', name: 'Interest income', emoji: '🏦', items: [
    { label: 'Interest & AIT/WHT certificates for every bank account / FD', label_si: 'සෑම ගිණුමකටම / FD එකකටම පොලී සහ AIT/WHT සහතික', category: 'bank' },
  ] },
  { key: 'rent', name: 'Rent income', emoji: '🏠', items: [
    { label: 'Rent agreement(s)', label_si: 'කුලී ගිවිසුම', category: 'rent' },
    { label: 'Rent received for the year (receipts or bank credits)', label_si: 'වර්ෂයේ ලැබුණු කුලිය (රිසිට් / බැංකු)', category: 'rent' },
    { label: 'Rates and repair bills paid', label_si: 'වරිපනම් සහ අලුත්වැඩියා බිල්පත්', category: 'rent' },
  ] },
  { key: 'business', name: 'Business income', emoji: '📊', items: [
    { label: 'Sales / income records for the year', label_si: 'වර්ෂයේ විකුණුම් / ආදායම් වාර්තා', category: 'business' },
    { label: 'Expense bills and records', label_si: 'වියදම් බිල්පත් සහ වාර්තා', category: 'business' },
    { label: 'Business bank statements (April – March)', label_si: 'ව්‍යාපාරික බැංකු ප්‍රකාශ (අප්‍රේල් – මාර්තු)', category: 'business' },
    { label: 'Stock value at 31 March', label_si: 'මාර්තු 31 තොග වටිනාකම', category: 'business' },
  ] },
  { key: 'foreign', name: 'Foreign income', emoji: '🌍', items: [
    { label: 'Bank credit advices / remittance statements', label_si: 'බැංකු බැර පණිවිඩ / ප්‍රේෂණ ප්‍රකාශ', category: 'foreign' },
    { label: 'Foreign employment contract or salary certificate', label_si: 'විදේශ රැකියා ගිවිසුම හෝ වැටුප් සහතිකය', category: 'foreign' },
  ] },
  { key: 'assets', name: 'Assets & liabilities', emoji: '🚗', items: [
    { label: 'Bank balances at 31 March (all accounts)', label_si: 'මාර්තු 31 බැංකු ශේෂ (සියලු ගිණුම්)', category: 'bank' },
    { label: 'Vehicles / land / house bought or sold this year', label_si: 'මෙම වසරේ මිලදී ගත් / විකුණූ වාහන / ඉඩම් / නිවාස', category: 'assets' },
    { label: 'Loan statements (balance at 31 March)', label_si: 'ණය ප්‍රකාශ (මාර්තු 31 ශේෂය)', category: 'assets' },
  ] },
  { key: 'paid', name: 'Tax already paid', emoji: '🧾', items: [
    { label: 'Quarterly instalment / tax payment receipts', label_si: 'කාර්තුමය වාරික / බදු ගෙවීම් රිසිට්', category: 'ird' },
  ] },
];

export const STATUS = {
  needed:   { label: 'Needed',            si: 'අවශ්‍යයි',     cls: 'bg-amber-100 text-amber-800' },
  received: { label: 'Received',          si: 'ලැබුණා',       cls: 'bg-green-100 text-green-800' },
  na:       { label: "Doesn't apply",     si: 'අදාළ නැත',     cls: 'bg-gray-100 text-gray-600' },
};

export const progressOf = (items = []) => {
  const need = items.filter((i) => i.status !== 'na');
  const done = need.filter((i) => i.status === 'received').length;
  return { done, total: need.length, missing: items.filter((i) => i.status === 'needed'), pct: need.length ? Math.round((done / need.length) * 100) : 100 };
};

const err = (e) => new Error(String(e?.message || e).replace(/^.*?ERROR:\s*/, ''));
export async function loadChecklists(clientId) {
  const q = supabase.from('doc_checklists').select('*, doc_checklist_items(*)').order('year', { ascending: false });
  const { data, error } = clientId ? await q.eq('client_id', clientId) : await q;
  if (error) throw err(error);
  return (data ?? []).map((l) => ({ ...l, items: (l.doc_checklist_items ?? []).sort((a, b) => a.sort - b.sort) }));
}
export async function loadSeason(year) {
  const { data, error } = await supabase.from('doc_checklists')
    .select('*, doc_checklist_items(id, label, label_si, status, category, sort, client_note, na_by), clients(id, full_name, client_no, mobile, email, profile_id, contact_name, contact_mobile, contact_email, contact_preferred, contact_relation)')
    .eq('year', year).order('created_at', { ascending: false });
  if (error) throw err(error);
  return (data ?? []).map((l) => ({ ...l, items: (l.doc_checklist_items ?? []).sort((a, b) => a.sort - b.sort) }));
}
export async function createChecklist({ clientId, year, items, note, due, notify = true }) {
  const { data, error } = await supabase.rpc('admin_checklist_create', { p_client: clientId, p_year: year, p_items: items, p_note: note || null, p_due: due || null, p_notify: notify });
  if (error) throw err(error);
  return data;
}
export async function setItem(id, patch) {
  const { error } = await supabase.from('doc_checklist_items').update(patch).eq('id', id);
  if (error) throw err(error);
}
export async function deleteItem(id) {
  const { error } = await supabase.from('doc_checklist_items').delete().eq('id', id);
  if (error) throw err(error);
}
export async function updateList(id, patch) {
  const { error } = await supabase.from('doc_checklists').update({ ...patch, updated_at: new Date().toISOString() }).eq('id', id);
  if (error) throw err(error);
}
export async function deleteList(id) {
  const { error } = await supabase.from('doc_checklists').delete().eq('id', id);
  if (error) throw err(error);
}
export async function remind(ids, portal = true) {
  const { data, error } = await supabase.rpc('admin_checklist_remind', { p_ids: ids, p_portal: portal });
  if (error) throw err(error);
  return data;
}
export async function clientItem(itemId, action, docId, note) {
  const { error } = await supabase.rpc('my_checklist_item', { p_item: itemId, p_action: action, p_doc: docId || null, p_note: note || null });
  if (error) throw err(error);
}

/** WhatsApp / email reminder listing only the missing documents (English + Sinhala) */
export function reminderText(client, list) {
  const first = String((client?.contact_preferred && client?.contact_name) || client?.full_name || '').trim().split(/\s+/)[0] || 'Sir/Madam';
  const miss = (list.items || []).filter((i) => i.status === 'needed');
  const due = list.due_date ? new Date(`${list.due_date}T00:00:00`).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' }) : null;
  const portal = !!client?.profile_id;
  return [
    `Dear ${first},`,
    '',
    `To prepare your Income Tax Return for Y/A ${list.year}, we still need ${miss.length === 1 ? 'this document' : `these ${miss.length} documents`}${due ? ` by ${due}` : ''}:`,
    ...miss.map((i) => `• ${i.label}`),
    '',
    `Y/A ${list.year} ආදායම් බදු ප්‍රකාශය සඳහා පහත ලේඛන අවශ්‍යයි${due ? ` (${due} ට පෙර)` : ''}:`,
    ...miss.map((i) => `• ${i.label_si || i.label}`),
    '',
    portal ? `Upload them here (photo or PDF): ${window.location.origin}/client/documents` : 'Please WhatsApp clear photos or PDFs to this number.',
    portal ? 'ඔබගේ portal එකේ "My Documents" හි upload කරන්න, නැතහොත් WhatsApp කරන්න.' : 'පැහැදිලි ඡායාරූප හෝ PDF මෙම අංකයට WhatsApp කරන්න.',
    '',
    'Thank you,', FIRM.name, `WhatsApp ${FIRM.whatsapp}`,
  ].join('\n');
}
