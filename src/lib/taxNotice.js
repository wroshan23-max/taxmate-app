// ═══════════════════════════════════════════════════════════
//  V63 — Payment notice (A4, print / save as PDF) for a quarterly IIT instalment or monthly APIT
//  Facts used (checked against the IRD's own documents, Nov 2026):
//   • IRD Circular No. SEC/2026/E/06 (Re-Revised) dated 12 August 2026 —
//     "Calculating Quarterly Income Tax Instalments (Section 90 of the Inland Revenue Act, No. 24 of 2017 (as amended))":
//     instalment = (A − C) ÷ B; A = gross income tax payable before any tax credit for the immediately
//     preceding Y/A; B = instalments remaining incl. the current one (4, 3, 2, 1); C = tax paid during the Y/A
//     before the due date (previous instalments, WHT / AIT withheld or to be withheld); APIT / AIT deducted by
//     the employer may be subtracted. Due dates: 15 Aug, 15 Nov, 15 Feb, 15 May (next Y/A).
//   • IRD Notice to Taxpayers — Payment of Income Tax for Y/A 2026/2027: IIT Tax Type Code 05, Payment Period
//     Code 26271 (1st instalment), Payment Category S; pay through OTPP or at any Bank of Ceylon branch; DIN for
//     a non-preprinted paying-in slip from eservices.ird.gov.lk or 0112134780; interest and penalty for
//     non-payment / late payment, "The interest cannot be waived-off or reduced"; a bank draft / pay order
//     realised after the due date is a late payment; hotline 1944.
// ═══════════════════════════════════════════════════════════
import { supabase } from './supabase';
import { FIRM, websiteLabel } from './firm';
import { irdCodesOf, periodLabel, yaStart, monthLabelOf } from './taxPayments';

const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const rs = (n) => 'Rs. ' + Math.round(Number(n) || 0).toLocaleString('en-LK');
const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
const longDate = (iso) => { if (!iso) return '—'; const [y, m, d] = String(iso).slice(0, 10).split('-').map(Number); return `${d} ${MONTHS[m - 1]} ${y}`; };
const dmy = (d = new Date()) => `${String(d.getDate()).padStart(2, '0')}/${String(d.getMonth() + 1).padStart(2, '0')}/${d.getFullYear()}`;
const ORD = { Q1: 'First', Q2: 'Second', Q3: 'Third', Q4: 'Fourth' };
const B_OF = { Q1: 4, Q2: 3, Q3: 2, Q4: 1 };

export const OTPP_URL = 'https://www.ird.gov.lk/en/publications/SitePages/Online_Pay_OTP.aspx?menuid=141601';
export const DIN_URL = 'https://eservices.ird.gov.lk/Payment/PayingInSlip/Index';
export const DIN_PHONE = '011 213 4780';
export const IRD_HOTLINE = '1944';
export const CIRCULAR = { no: 'SEC/2026/E/06 (Re-Revised)', date: '12 August 2026', ya: '2026/27' };

export const noticeUrl = (token) => `${window.location.origin}/notice/${token}`;
export const noticeRef = (p, c = {}) => {
  const who = String(c.client_no || (c.tin ? `T${String(c.tin).slice(-4)}` : 'CL')).replace(/[^A-Za-z0-9-]/g, '');
  const ya = String(p.year).replace(/\D/g, '');   // 202627
  return p.kind === 'instalment' ? `QIIT-${ya.slice(2)}-${p.period}-${who}` : `APIT-${String(p.period).replace('-', '')}-${who}`;
};

/** Make (or reuse) the secret link of a payment notice — admin only (RLS) */
export async function ensureNoticeToken(row) {
  if (row.share_token) return row.share_token;
  const token = crypto.randomUUID();
  const { error } = await supabase.from('tax_payments').update({ share_token: token }).eq('id', row.id);
  if (error) throw new Error(error.message);
  row.share_token = token;
  return token;
}
export async function disableNoticeLink(id) {
  const { error } = await supabase.from('tax_payments').update({ share_token: null }).eq('id', id);
  if (error) throw new Error(error.message);
}
export async function sharedNotice(token) {
  const { data, error } = await supabase.rpc('get_shared_tax_notice', { p_token: token });
  if (error || !data) return null;
  return data;
}

const CSS = `<style>
*{box-sizing:border-box;margin:0;padding:0}
body{font-family:'Segoe UI',Arial,sans-serif;font-size:12px;color:#2c3e50;background:#fff;padding:0 8mm;-webkit-print-color-adjust:exact;print-color-adjust:exact;line-height:1.5}
@page{size:A4;margin:12mm 14mm}
@media print{.no-print{display:none!important}body{padding:0}}
.sh{display:flex;justify-content:space-between;align-items:flex-start;padding:12px 0 10px;border-bottom:2.5px solid #1B4F72;margin-bottom:12px;gap:12px}
.bn{font-size:21px;font-weight:900;color:#1B4F72}.bt{font-size:9.5px;color:#777;margin-top:2px}
.sc{text-align:right;font-size:9.5px;color:#555;line-height:1.8}
.ti{text-align:center;margin:6px 0 10px}.ti h1{font-size:17px;letter-spacing:1.5px;color:#1B4F72;font-weight:900}
.ti div{font-size:10px;color:#666;margin-top:3px}
.rf{display:flex;justify-content:space-between;font-size:10.5px;margin-bottom:10px}
.bx{border:1.5px solid #1B4F72;border-radius:8px;padding:10px 14px;margin-bottom:12px}
.bx h3{font-size:10.5px;color:#1B4F72;letter-spacing:.8px;margin-bottom:6px}
.kv{width:100%;border-collapse:collapse}.kv td{padding:2.5px 0;vertical-align:top;font-size:11px}
.kv .k{color:#777;font-weight:700;width:30%}.kv .v{font-weight:600}
.bx .kv .k{width:17%}.bx .kv .v{width:33%;padding-right:10px}
.pp{margin:8px 0 12px;font-size:11.5px}
.am{border:2px solid #1B4F72;border-radius:10px;text-align:center;padding:12px;margin-bottom:12px;page-break-inside:avoid}
.am .l{font-size:10px;letter-spacing:1px;color:#666}.am .a{font-size:30px;font-weight:900;color:#1B4F72;line-height:1.2}
.am .d{font-size:11px;color:#444}.am .vn{display:inline-block;margin-top:6px;background:#FDEDEC;border:1px solid #F5B7B1;color:#922B21;border-radius:6px;padding:3px 10px;font-weight:800;font-size:12px}
.cs{border:1.5px solid #E5A100;background:#FFFBEF;border-radius:8px;padding:10px 14px;margin-bottom:12px;page-break-inside:avoid}
.cs h3{font-size:11px;color:#8a6d00;margin-bottom:6px}.cs .k{color:#8a6d00;font-weight:700;width:46%}
.cs .tot td{border-top:1.5px solid #E5A100;padding-top:5px;font-weight:900;color:#8a6d00;font-size:12.5px}
.cs .n{font-size:9px;color:#8a6d00;margin-top:5px}
.pi{border:1.5px solid #1B4F72;border-radius:8px;padding:10px 14px;margin-bottom:12px;page-break-inside:avoid}
.pi h3{font-size:11px;color:#1B4F72;margin-bottom:6px}
.cd{width:100%;border-collapse:collapse;margin-bottom:8px}.cd td{border:1px solid #d6e0ea;padding:5px 9px;font-size:11px}
.cd .k{background:#EBF5FB;color:#1B4F72;font-weight:800;width:38%}.cd .v{font-weight:800;font-size:12.5px;letter-spacing:.5px}
.ul{margin:4px 0 0 16px;font-size:10.5px}.ul li{margin:2px 0}
.wn{border:1.5px solid #C0392B;border-radius:8px;padding:9px 14px;color:#922B21;font-size:10.5px;margin-bottom:12px;page-break-inside:avoid}
.af{background:#E9F7EF;border:1px solid #A9DFBF;border-radius:8px;padding:8px 14px;color:#1E8449;font-size:10.5px;margin-bottom:12px}
.pd{background:#E9F7EF;border:2px solid #27ae60;border-radius:8px;padding:8px 14px;color:#1E8449;font-weight:800;text-align:center;margin-bottom:12px}
.sg{display:flex;justify-content:space-between;margin-top:26px;page-break-inside:avoid}
.sg div{width:190px;text-align:center;font-size:10px;color:#555;border-top:1px solid #555;padding-top:4px}
.ft{border-top:1px solid #ccc;margin-top:14px;padding-top:6px;text-align:center;font-size:9px;color:#666;line-height:1.6}
.bar{position:sticky;top:0;background:#fff;padding:10px 0;display:flex;gap:8px;justify-content:center;border-bottom:1px solid #eee;margin-bottom:8px}
.pbt{background:#1B4F72;color:#fff;border:none;border-radius:6px;padding:9px 26px;font-size:12px;font-weight:700;cursor:pointer;font-family:inherit}
</style>`;

/** The calculation box from the calculator inputs saved with the payment (V57 basis) */
function calcBox(p) {
  const b = p.basis || {};
  if (p.kind !== 'instalment' || !b || !b.method) return '';
  const q = p.period, B = Number(b.B) || B_OF[q];
  const prevYa = b.prev_year || `${yaStart(p.year) - 1}/${String(yaStart(p.year)).slice(2)}`;
  if (b.method === 'A-C/B') {
    const A = Number(b.A) || 0, C = Number(b.C) || 0;
    const calc = Math.max(0, Math.round((A - C) / B));
    return `<div class="cs"><h3>&#128202; Calculation of the instalment</h3><table class="kv">
      <tr><td class="k">Formula</td><td class="v">Instalment = (A &minus; C) &divide; B</td></tr>
      <tr><td class="k">A &mdash; Gross income tax payable for Y/A ${esc(prevYa)} (before tax credits)</td><td class="v">${rs(A)}</td></tr>
      <tr><td class="k">C &mdash; Tax paid / credits for Y/A ${esc(p.year)} before this due date</td><td class="v">${rs(C)}</td></tr>
      <tr><td class="k">B &mdash; Instalments remaining (including ${esc(q)})</td><td class="v">${B}</td></tr>
      <tr class="tot"><td>${esc(q)} instalment = (${rs(A).replace('Rs. ', '')} &minus; ${rs(C).replace('Rs. ', '')}) &divide; ${B}</td><td>${rs(calc)}</td></tr></table>
      ${Math.round(Number(p.amount)) !== calc ? `<div class="n">Amount payable as advised by ${esc(FIRM.name)}: <b>${rs(p.amount)}</b>.</div>` : ''}
      <div class="n">C includes previous instalments and WHT / AIT credits withheld or to be withheld; APIT / AIT deducted by an employer may also be deducted. Rounded to the nearest rupee.</div></div>`;
  }
  if (b.method === 'income') {
    const A = Number(b.annual_tax_estimate) || 0, C = Number(b.credits) || 0;
    return `<div class="cs"><h3>&#128202; Calculation of the instalment (estimated basis)</h3><table class="kv">
      <tr><td class="k">Formula</td><td class="v">Instalment = (A &minus; C) &divide; B</td></tr>
      <tr><td class="k">A &mdash; Estimated income tax for Y/A ${esc(p.year)}</td><td class="v">${rs(A)}</td></tr>
      <tr><td class="k">C &mdash; Tax paid / credits before this due date</td><td class="v">${rs(C)}</td></tr>
      <tr><td class="k">B &mdash; Instalments remaining (including ${esc(q)})</td><td class="v">${B}</td></tr>
      <tr class="tot"><td>${esc(q)} instalment</td><td>${rs(p.amount)}</td></tr></table>
      <div class="n">An estimated basis may be used only where the conditions of the IRD circular are met (no taxable income in the preceding year, an expected lower income, or a newly registered taxpayer); the statement required by the circular must then be submitted to the IRD.</div></div>`;
  }
  return '';
}

/**
 * Full HTML of the payment notice.
 * payment: tax_payments row · client: { full_name, tin, nic, client_no }
 */
export function buildTaxNoticeHtml(payment, client = {}, { withToolbar = true, issued = new Date() } = {}) {
  const p = payment, c = client, inst = p.kind === 'instalment';
  const s = yaStart(p.year), yaFull = `${s}/${s + 1}`;
  const codes = irdCodesOf(p);
  const name = (c.full_name || 'Client').trim();
  const isCurrentCircular = inst && p.year === CIRCULAR.ya;
  const title = inst ? 'QUARTERLY INCOME TAX INSTALMENT NOTICE' : 'MONTHLY APIT PAYMENT NOTICE';
  const sub = inst
    ? `Individual Income Tax (IIT) &nbsp;|&nbsp; Y/A ${esc(yaFull)} &nbsp;|&nbsp; Section 90 of the Inland Revenue Act, No. 24 of 2017 (as amended)`
      + (isCurrentCircular ? `<br>Computed as per IRD Circular No. ${CIRCULAR.no} dated ${CIRCULAR.date}` : '')
    : `Advance Personal Income Tax (APIT) &nbsp;|&nbsp; ${esc(monthLabelOf(p.period))} &nbsp;|&nbsp; Y/A ${esc(yaFull)}`;
  const what = inst ? `${ORD[p.period] ?? p.period} Quarterly Instalment of Individual Income Tax (IIT) for the Year of Assessment <b>${esc(yaFull)}</b>`
                    : `Advance Personal Income Tax (APIT) for <b>${esc(MONTHS[Number(String(p.period).slice(5)) - 1] ?? '')} ${esc(String(p.period).slice(0, 4))}</b>`;
  const paid = p.status === 'paid';

  const rows = [
    ['Taxpayer TIN', esc(c.tin) || '<i style="color:#999;font-weight:400">— write your TIN —</i>'],
    ['Tax Type Code', codes ? `${esc(codes.typeCode)} &mdash; ${inst ? 'Individual Income Tax (IIT)' : 'APIT'}` : '—'],
    ['Payment Period Code', codes ? esc(codes.periodCode) : '—'],
    ['Payment Category', codes ? `${esc(codes.category)} (Self assessment)` : 'S'],
    ...(p.voucher_no ? [['Payment Voucher No.', esc(p.voucher_no)]] : []),
    ['Amount', rs(p.amount)],
  ];

  const body = `
  <div class="sh"><div><div class="bn">${esc(FIRM.name)}</div><div class="bt">${esc(FIRM.tagline)}</div>${FIRM.address ? `<div class="bt">${esc(FIRM.address)}</div>` : ''}</div>
    <div class="sc">&#9993; ${esc(FIRM.email)}<br>&#128222; ${esc(FIRM.phone)}<br>&#127760; ${esc(websiteLabel())}</div></div>
  <div class="ti"><h1>${title}</h1><div>${sub}</div></div>
  <div class="rf"><div><b>Ref:</b> ${esc(noticeRef(p, c))}</div><div><b>Issued:</b> ${dmy(issued)}</div></div>
  <div class="bx"><h3>CLIENT DETAILS</h3><table class="kv">
    <tr><td class="k">Name</td><td class="v">${esc(name)}</td><td class="k">TIN</td><td class="v">${esc(c.tin) || '—'}</td></tr>
    <tr><td class="k">NIC</td><td class="v">${esc(c.nic) || '—'}</td><td class="k">Year of Assessment</td><td class="v">${esc(yaFull)} (01.04.${s} &ndash; 31.03.${s + 1})</td></tr>
    ${c.client_no ? `<tr><td class="k">Client No.</td><td class="v">${esc(c.client_no)}</td><td class="k">Payment</td><td class="v">${esc(periodLabel(p))}</td></tr>` : ''}
  </table></div>
  ${paid ? `<div class="pd">&#10004; Recorded as PAID${p.paid_on ? ` on ${longDate(p.paid_on)}` : ''}${p.paid_amount ? ` &mdash; ${rs(p.paid_amount)}` : ''}</div>` : ''}
  <p class="pp">Dear <b>${esc(name)}</b>,</p>
  <p class="pp">This is to inform you that your ${what} is ${paid ? 'recorded below' : 'now due'}. Please make the payment <b>on or before the due date</b> using the details below.</p>
  <div class="am"><div class="l">${inst ? `${esc(p.period)} INSTALMENT AMOUNT DUE` : 'APIT AMOUNT DUE'}</div><div class="a">${rs(p.amount)}</div>
    <div class="d">Due on or before <b>${longDate(p.due_date)}</b></div>
    ${p.voucher_no ? `<div class="vn">Payment Voucher No. ${esc(p.voucher_no)}</div>` : ''}</div>
  ${calcBox(p)}
  <div class="pi"><h3>&#127974; Payment details</h3>
    <table class="cd">${rows.map(([k, v]) => `<tr><td class="k">${k}</td><td class="v">${v}</td></tr>`).join('')}</table>
    <ul class="ul">
      <li><b>Online:</b> IRD Online Tax Payment Platform (OTPP) &mdash; ${OTPP_URL} (see the OTPP user guide on that page).</li>
      ${inst ? '<li><b>At a bank:</b> any branch of <b>Bank of Ceylon</b>.</li>' : '<li><b>At a bank:</b> Bank of Ceylon or People&#39;s Bank, with an IRD paying-in slip.</li>'}
      <li>If you do not use a pre-printed paying-in slip, write the <b>DIN</b> on the slip &mdash; get it from ${DIN_URL} or by calling ${DIN_PHONE}.</li>
      <li>A bank draft or pay order realised after the due date is treated as a late payment.</li>
      <li>IRD hotline: ${IRD_HOTLINE}.</li>
    </ul></div>
  <div class="wn">&#9888; <b>Important:</b> As stated by the Inland Revenue Department, interest and penalty are imposed for non-payment or late payment of taxes, and <b>the interest cannot be waived or reduced</b>.</div>
  <div class="af">&#10004; <b>After paying:</b> please send the bank / OTPP receipt to ${esc(FIRM.name)} &mdash; or open your TaxMate portal &rarr; Dashboard &rarr; <b>I&#39;ve paid</b> and upload it. Paid amounts are deducted from the tax in your annual return.</div>
  <div class="sg"><div>Authorised Signatory<br>${esc(FIRM.name)}</div><div>Client Acknowledgement<br>${esc(name)}</div></div>
  <div class="ft">${esc(FIRM.name)}${FIRM.address ? ` | ${esc(FIRM.address)}` : ''} | ${esc(FIRM.email)} | ${esc(FIRM.phone)} | ${esc(websiteLabel())}<br>
    Sources: ${inst ? `Inland Revenue Act, No. 24 of 2017 (as amended), Section 90${isCurrentCircular ? `; IRD Circular No. ${CIRCULAR.no}, ${CIRCULAR.date}` : ''}; ` : ''}IRD Notice to Taxpayers on income tax payments (tax type, payment period code, payment methods).<br>
    Prepared by ${esc(FIRM.name)} from the information available to us. Please keep this notice for your records.</div>`;

  const fileName = `${inst ? `${p.period}_Instalment` : `APIT_${p.period}`}_${String(p.year).replace('/', '-')}_${name.replace(/\s+/g, '_')}`;
  const bar = withToolbar ? '<div class="bar no-print"><button class="pbt" onclick="window.print()">&#128424; Print / Save as PDF</button></div>' : '';
  return `<!DOCTYPE html><html lang="en"><head><meta charset="UTF-8"><title>${esc(fileName)}</title>${CSS}</head><body>${bar}${body}</body></html>`;
}

/** Open the notice in a new window ready to print / save as PDF */
export function openTaxNotice(payment, client) {
  const w = window.open('', '_blank', 'width=920,height=900');
  if (!w) return false;
  w.document.open(); w.document.write(buildTaxNoticeHtml(payment, client)); w.document.close(); w.focus();
  return true;
}
