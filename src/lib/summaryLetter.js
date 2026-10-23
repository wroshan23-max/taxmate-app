// Income & Tax summary letter (visa / bank loan). Figures come from the client's FINAL
// IIT computation, snapshotted when the letter is issued, so the PDF never changes later.
import { supabase } from './supabase';
import { computeReturn, annualToReturnInput, calcKind } from './iitCalc';
import { FIRM } from './iitStatement';
import { INVOICE_CFG, nextInvoiceNo, todayISO, addDaysISO } from './invoice';

export const PURPOSES = {
  visa:       { label: 'Visa application', si: 'වීසා', emoji: '✈️' },
  bank_loan:  { label: 'Bank loan / credit card', si: 'බැංකු ණය', emoji: '🏦' },
  employment: { label: 'Employment / tender', si: 'රැකියා', emoji: '💼' },
  other:      { label: 'Other', si: 'වෙනත්', emoji: '📄' },
};
export const LETTER_STATUS = {
  requested: { label: 'Requested', cls: 'bg-amber-100 text-amber-800' },
  issued:    { label: 'Ready', cls: 'bg-emerald-100 text-emerald-700' },
  rejected:  { label: 'Not issued', cls: 'bg-red-100 text-red-700' },
  cancelled: { label: 'Cancelled', cls: 'bg-gray-100 text-gray-600' },
};
export const APP_URL = 'https://app.taxmatesolutions.com';
const errMsg = (e) => (e?.message || String(e)).replace(/^.*?ERROR:\s*/, '');

const yaRange = (ya) => { const s = parseInt(ya, 10); return `1 April ${s} – 31 March ${s + 1}`; };

/** Build the figures snapshot from a saved calculation (return or old annual). */
export function buildLetterData(calc, client, { filedAt, signature } = {}) {
  const src = calcKind(calc) === 'return' ? calc.input_data : annualToReturnInput(calc.input_data);
  const r = computeReturn(calc.year, src);
  const income = [
    ['Employment income', r.cage10],
    ['Business income', r.cage20],
    ['Investment income (interest, rent, etc.)', r.cage30],
    ['Other income', r.cage40],
  ].filter(([, v]) => Math.round(v) !== 0).map(([label, amount]) => ({ label, amount: Math.round(amount) }));
  return {
    client: { name: client.full_name || '', nic: client.nic || '', tin: client.tin || '', address: client.address || '' },
    income,
    totals: {
      income: Math.round(r.cage50),
      reliefs: Math.round(r.reliefs + (r.cage100 || 0)),
      taxable: Math.round(r.cage120),
      tax: Math.round(r.cage170),
      paid: Math.round(r.credits || 0),
      foreign: Math.round(r.fxTotal || 0),
    },
    filed: !!filedAt, filed_at: filedAt || null,
    firm: { name: FIRM.name, tagline: FIRM.tagline, email: FIRM.email, phone: FIRM.phone, web: FIRM.web, address: FIRM.address, regNo: FIRM.regNo },
    signature: signature || null,
  };
}

const esc = (s) => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const m = (n) => `Rs. ${Number(n || 0).toLocaleString('en-LK', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const PURPOSE_LINE = { visa: 'visa application', bank_loan: 'loan / credit facility application', employment: 'employment / tender application', other: 'official purposes' };

export function buildLetterHtml(d) {
  const f = d.firm || {};
  const issued = new Date(d.issued_at || Date.now()).toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' });
  const verify = `${APP_URL.replace(/^https?:\/\//, '')}/verify/${d.ref}`;
  const rows = d.income.map(x => `<tr><td>${esc(x.label)}</td><td class="n">${m(x.amount)}</td></tr>`).join('');
  return `<!DOCTYPE html><html lang="en"><head><meta charset="UTF-8"><title>Income_Tax_Summary_${esc(String(d.year).replace('/', '-'))}_${esc((d.client.name || '').replace(/\s+/g, '_'))}</title>
<style>
*{box-sizing:border-box;margin:0;padding:0}body{font-family:'Segoe UI',Arial,sans-serif;color:#1f2d3d;font-size:11.5pt;background:#fff;-webkit-print-color-adjust:exact;print-color-adjust:exact}
.page{max-width:190mm;margin:0 auto;padding:14mm 12mm}.head{display:flex;justify-content:space-between;align-items:flex-end;border-bottom:3px solid #1e3a8a;padding-bottom:10px}
.brand{font-size:24pt;font-weight:900;color:#1e3a8a}.brand span{color:#d4a017}.tag{font-size:9pt;color:#555}.contact{text-align:right;font-size:8.5pt;color:#555;line-height:1.5}
.meta{display:flex;justify-content:space-between;margin:18px 0 12px;font-size:10pt}.to{margin-bottom:12px;line-height:1.5}
h1{font-size:13pt;color:#1e3a8a;margin:10px 0;text-decoration:underline}p{line-height:1.6;margin:8px 0}
table{width:100%;border-collapse:collapse;margin:10px 0}td{padding:7px 10px;border-bottom:1px solid #e5e7eb}td.n{text-align:right;font-variant-numeric:tabular-nums;white-space:nowrap}
tr.t td{font-weight:800;background:#eef2ff;border-top:2px solid #1e3a8a}tr.k td{font-weight:700}
.id{display:grid;grid-template-columns:auto 1fr;gap:3px 14px;background:#f8fafc;border:1px solid #e5e7eb;border-radius:6px;padding:10px 14px;font-size:10.5pt}
.st{display:inline-block;padding:3px 10px;border-radius:12px;font-weight:700;font-size:9.5pt}.st.ok{background:#dcfce7;color:#166534}.st.no{background:#fef3c7;color:#92400e}
.sign{margin-top:26px}.sign img{max-height:70px;max-width:230px;display:block;margin-bottom:4px}.foot{margin-top:24px;border-top:1px solid #e5e7eb;padding-top:8px;font-size:8.5pt;color:#6b7280;line-height:1.5}
.ver{background:#1e3a8a;color:#fff;border-radius:6px;padding:8px 12px;font-size:9.5pt;margin-top:14px}.ver b{color:#fcd34d}
.bar{position:fixed;top:10px;right:10px}.bar button{background:#1e3a8a;color:#fff;border:0;border-radius:8px;padding:10px 16px;font-weight:700;cursor:pointer;font-size:11pt}
@media print{.bar{display:none}.page{padding:8mm 6mm}}
</style></head><body>
<div class="bar"><button onclick="window.print()">&#128424; Print / Save as PDF</button></div>
<div class="page">
  <div class="head"><div><div class="brand">${esc((f.name || 'TaxMate Solutions').replace(/Mate/, 'Mate')).replace('TaxMate', 'Tax<span>Mate</span>')}</div><div class="tag">${esc(f.tagline || '')}</div></div>
  <div class="contact">${[f.address, f.phone, f.email, f.web].filter(Boolean).map(esc).join('<br>')}${f.regNo ? `<br>Reg. No: ${esc(f.regNo)}` : ''}</div></div>
  <div class="meta"><div>Ref: <b>${esc(d.ref)}</b></div><div>Date: <b>${issued}</b></div></div>
  <div class="to">${esc(d.addressed_to || 'To whom it may concern').replace(/\n/g, '<br>')}</div>
  <h1>Income &amp; Tax Summary — Year of Assessment ${esc(d.year)}</h1>
  <div class="id"><span>Taxpayer</span><b>${esc(d.client.name)}</b>${d.client.nic ? `<span>NIC</span><b>${esc(d.client.nic)}</b>` : ''}${d.client.tin ? `<span>TIN</span><b>${esc(d.client.tin)}</b>` : ''}${d.client.address ? `<span>Address</span><span>${esc(d.client.address)}</span>` : ''}<span>Period</span><span>${yaRange(d.year)}</span></div>
  <p>We, ${esc(f.name || 'TaxMate Solutions')}, act as tax advisors to the above taxpayer. Based on the income tax computation prepared by us for the Year of Assessment ${esc(d.year)}, we confirm the following:</p>
  <table>
    ${rows}
    <tr class="t"><td>Total assessable income</td><td class="n">${m(d.totals.income)}</td></tr>
    <tr><td>Reliefs and qualifying payments</td><td class="n">(${m(d.totals.reliefs)})</td></tr>
    <tr class="k"><td>Taxable income</td><td class="n">${m(d.totals.taxable)}</td></tr>
    <tr class="k"><td>Income tax liability</td><td class="n">${m(d.totals.tax)}</td></tr>
    ${d.totals.paid ? `<tr><td>Tax deducted / paid during the year (APIT, WHT, instalments)</td><td class="n">${m(d.totals.paid)}</td></tr>` : ''}
  </table>
  ${d.totals.foreign ? `<p style="font-size:10pt">Total assessable income includes foreign-currency income of ${m(d.totals.foreign)} remitted to Sri Lanka.</p>` : ''}
  <p>Income tax return status: ${d.filed ? `<span class="st ok">Filed with the Inland Revenue Department (RAMIS)${d.filed_at ? ` on ${new Date(d.filed_at).toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' })}` : ''}</span>` : '<span class="st no">Computation prepared — return not yet filed</span>'}</p>
  <p>This letter is issued at the request of the taxpayer for ${PURPOSE_LINE[d.purpose] || 'official purposes'}.</p>
  <div class="sign">${d.signature ? `<img src="${d.signature}" alt="Signature">` : '<div style="height:50px"></div>'}<b>For ${esc(f.name || 'TaxMate Solutions')}</b><br><span style="font-size:9.5pt;color:#555">Tax &amp; Accounting Advisors</span></div>
  <div class="ver">&#128274; Verify this letter online: <b>${esc(verify)}</b></div>
  <div class="foot">This summary is prepared by ${esc(f.name || 'TaxMate Solutions')} from the taxpayer's income tax computation and supporting documents provided to us. It is not a document issued by the Inland Revenue Department. Figures are in Sri Lankan Rupees.</div>
</div></body></html>`;
}

export function openLetter(d, win) {
  const w = win || window.open('', '_blank', 'width=900,height=1000');
  if (!w) return false;
  w.document.open(); w.document.write(buildLetterHtml(d)); w.document.close(); w.focus();
  return true;
}

// ── client ──
export async function requestLetter({ year, purpose, addressedTo, note }) {
  const { error } = await supabase.rpc('request_summary_letter', { p_year: year, p_purpose: purpose, p_addressed_to: addressedTo || '', p_note: note || '' });
  if (error) throw new Error(errMsg(error));
}
export async function myLetter(id) {
  const { data, error } = await supabase.rpc('my_summary_letter', { p_id: id });
  if (error) throw new Error(errMsg(error));
  return data;
}
export async function cancelLetter(id) {
  const { error } = await supabase.rpc('cancel_my_summary_letter', { p_id: id });
  if (error) throw new Error(errMsg(error));
}

// ── admin ──
/** Create a simple unpaid invoice (used for the letter fee). */
export async function createFeeInvoice(client, description, amount, userId) {
  const { data: nos } = await supabase.from('invoices').select('invoice_no');
  const invoice_no = nextInvoiceNo((nos ?? []).map(r => r.invoice_no), todayISO());
  const amt = Math.round(Number(amount) * 100) / 100;
  const { data: inv, error } = await supabase.from('invoices').insert({
    invoice_no, issue_date: todayISO(), due_date: addDaysISO(todayISO(), INVOICE_CFG.dueDays), client_id: client.id,
    client_snapshot: { name: client.full_name || '', tin: client.tin || '', nic: client.nic || '', phone: client.mobile || '', email: client.email || '', address: client.address || '' },
    subtotal: amt, discount_pct: 0, discount_amt: 0, total_amount: amt, notes: INVOICE_CFG.defaultNote, status: 'unpaid', created_by: userId,
  }).select().single();
  if (error) throw new Error(error.message);
  const { error: e2 } = await supabase.from('invoice_items').insert({ invoice_id: inv.id, description, quantity: 1, unit_price: amt, discount_pct: 0, amount: amt, sort_order: 0 });
  if (e2) throw new Error(e2.message);
  return inv;
}

export async function issueLetter({ letter, calc, client, filedAt, fee, userId }) {
  const { data: sig } = await supabase.from('app_settings').select('value').eq('key', 'firm_signature').maybeSingle();
  const signature = typeof sig?.value === 'string' ? sig.value : sig?.value?.image || sig?.value?.dataUrl || null;
  const data = buildLetterData(calc, client, { filedAt, signature });
  let invoiceId = letter.invoice_id || null;
  if (Number(fee) > 0 && !invoiceId) {
    const inv = await createFeeInvoice(client, `Income & Tax summary letter — Y/A ${letter.year} (${PURPOSES[letter.purpose]?.label ?? 'letter'})`, fee, userId);
    invoiceId = inv.id;
  }
  const { data: ref, error } = await supabase.rpc('admin_issue_summary_letter', { p_id: letter.id, p_calc: calc.id, p_data: data, p_fee: Number(fee) || 0, p_invoice: invoiceId });
  if (error) throw new Error(errMsg(error));
  return { ref, data };
}

export async function adminLetterData(id) {
  const [{ data: l }, { data: d }] = await Promise.all([
    supabase.from('summary_letters').select('*').eq('id', id).single(),
    supabase.from('summary_letter_data').select('data').eq('letter_id', id).maybeSingle(),
  ]);
  return { ...(d?.data ?? {}), ref: l.ref, issued_at: l.issued_at, purpose: l.purpose, addressed_to: l.addressed_to, year: l.year };
}
