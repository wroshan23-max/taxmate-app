// ═══════════════════════════════════════════════════════════
//  TaxMate — Individual Income Tax Computation Statement (PDF)
//  Same layout as the V16 desktop tool: opens a print window,
//  client uses "Print / Save as PDF".
// ═══════════════════════════════════════════════════════════
import {
  calcKind, computeAnnual, computeQuarterly, computeReturn2425, yearCfg, SLABS_2425,
} from './iitCalc';

// Firm profile used on every statement, invoice and message.
// Defaults below; Settings → Firm Profile overrides them (loaded at app start).
export const FIRM_DEFAULTS = {
  name: 'TaxMate Solutions',
  tagline: 'Your Trusted Tax & Accounting Partner in Sri Lanka',
  email: 'info@taxmatesolutions.com',
  phone: '0719 404 604',
  whatsapp: '0719 404 604',
  web: 'www.taxmatesolutions.com',
  facebook: 'TaxMateSolutions.lk',
  address: '',
  regNo: '',
};
export const FIRM = { ...FIRM_DEFAULTS };
export function applyFirm(v) {
  Object.assign(FIRM, FIRM_DEFAULTS);
  if (v) for (const [k, val] of Object.entries(v)) if (k in FIRM_DEFAULTS && val !== null && val !== undefined && String(val).trim() !== '') FIRM[k] = String(val).trim();
}

const esc = (s) => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const m = (n) => Number(n || 0).toLocaleString('en-LK', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const neg = (n) => `(${m(n)})`;
const pct = (r) => `${Math.round(r * 100)}%`;
const RES = { resident: 'Resident Individual', nrcitizen: 'Non-Resident Citizen', nonresident: 'Non-Resident' };

const CSS = `<style>
*{box-sizing:border-box;margin:0;padding:0}
body{font-family:'Segoe UI',Arial,sans-serif;font-size:12px;color:#2c3e50;background:#fff;padding:0 8mm;-webkit-print-color-adjust:exact;print-color-adjust:exact}
@page{size:A4;margin:12mm 14mm}
@media print{.no-print{display:none!important}body{padding:0}}
.sh{display:flex;justify-content:space-between;align-items:flex-start;padding:12px 0 10px;border-bottom:2.5px solid #1B4F72;margin-bottom:12px}
.bn{font-size:20px;font-weight:900;color:#1B4F72}.bn span{color:#E67E22}
.bt{font-size:9px;color:#777;margin-top:2px}
.sc{text-align:right;font-size:9px;color:#555;line-height:1.8}
.tb{background:linear-gradient(135deg,#1B4F72 0%,#2980B9 100%);color:#fff;padding:10px 16px;border-radius:7px;margin-bottom:12px;display:flex;justify-content:space-between;align-items:center;gap:10px}
.tt{font-size:16px;font-weight:900;letter-spacing:.3px}.ts{font-size:9.5px;opacity:.85;margin-top:2px}
.yb{background:rgba(255,255,255,.2);border:1px solid rgba(255,255,255,.4);border-radius:18px;padding:5px 14px;font-size:12px;font-weight:900;white-space:nowrap}
.ct{width:100%;border-collapse:collapse;margin-bottom:12px;border:1px solid #ddd}
.ct td{padding:5px 12px;border-bottom:1px solid #eee;vertical-align:top}.ct tr:last-child td{border-bottom:none}
.lb{font-size:8px;text-transform:uppercase;letter-spacing:.7px;color:#888;font-weight:700}
.vl{font-size:11.5px;font-weight:700;color:#1B4F72}
.ph{background:#1B4F72;color:#fff;padding:6px 12px;font-size:10px;font-weight:900;letter-spacing:.4px;margin:10px 0 0;border-radius:3px 3px 0 0;page-break-after:avoid}
.st{width:100%;border-collapse:collapse;border:1px solid #ddd;border-top:none}
.st td{padding:4.5px 12px;border-bottom:1px solid #f0f0f0;font-size:11px}
.st .r{text-align:right;font-weight:600;white-space:nowrap}
.st .c{width:60px;color:#888;font-size:9.5px;white-space:nowrap}
.st .sub td{padding-left:26px;color:#666;font-style:italic;font-size:10px}.st .sub .r{color:#c0392b}
.st .det td{color:#555;font-size:10.5px}.st .det td:nth-child(2){padding-left:26px}
.st .ex td{color:#8a6d00;font-size:10px;background:#FEF9E7}
.st .tot td{font-weight:900;color:#1B4F72;border-top:2px solid #1B4F72;background:#EBF5FB}
.st .hd td{background:#f7f9fb;font-weight:800;font-size:10px;color:#555}
.sl{width:100%;border-collapse:collapse;border:1px solid #ddd;border-top:none}
.sl th{background:#2980B9;color:#fff;padding:5px 10px;font-size:10px;font-weight:700;text-align:left}
.sl th.r,.sl td.r{text-align:right}.sl td{padding:4.5px 10px;border-bottom:1px solid #f0f0f0;font-size:11px}
.sl .off td{color:#bbb}.sl .on td{font-weight:700}
.sl .tot td{font-weight:900;border-top:2px solid #1B4F72;background:#EBF5FB;color:#1B4F72}
.sw{display:flex;gap:12px;margin-top:12px;align-items:flex-start;flex-wrap:wrap;page-break-inside:avoid}
.pb{flex:0 0 200px;text-align:center;padding:13px;border-radius:9px}
.pb.pay{background:#c0392b;color:#fff}.pb.ref{background:#27ae60;color:#fff}.pb.nil{background:#7f8c8d;color:#fff}.pb.ins{background:#1B4F72;color:#fff}
.pl{font-size:10px;font-weight:800;opacity:.9;margin-bottom:3px}.pa{font-size:21px;font-weight:900;line-height:1.2}
.pn{font-size:8.5px;opacity:.9;margin-top:4px;line-height:1.5}
.sm{flex:1;border-collapse:collapse;min-width:220px}.sm td{padding:3px 8px;font-size:10px;border-bottom:1px dotted #e0e0e0}
.sm .k{color:#666}.sm .v{font-weight:800;text-align:right;white-space:nowrap}.sm .v.neg{color:#c0392b}
.dc{background:#FEF9E7;border:1px solid #F0E68C;border-radius:5px;padding:8px 12px;font-size:9px;color:#7D6608;margin-top:12px;line-height:1.6}
.pr{display:flex;justify-content:space-between;align-items:flex-end;margin-top:14px;border-top:1px dashed #ccc;padding-top:10px;page-break-inside:avoid}
.sg{border-top:1px solid #999;width:150px;padding-top:3px;font-size:9px;color:#777;margin-top:26px}
.fb{text-align:right;font-size:9px;color:#1B4F72}.fb strong{font-size:12px;font-weight:900;display:block}
.bar{position:sticky;top:0;background:#fff;padding:10px 0;display:flex;gap:8px;justify-content:center;border-bottom:1px solid #eee;margin-bottom:8px}
.pbt{background:#1B4F72;color:#fff;border:none;border-radius:6px;padding:9px 26px;font-size:12px;font-weight:700;cursor:pointer;font-family:inherit}
</style>`;

const today = () => {
  const d = new Date();
  return `${String(d.getDate()).padStart(2, '0')}/${String(d.getMonth() + 1).padStart(2, '0')}/${d.getFullYear()}`;
};

const yearInfo = (year) => {
  const s = parseInt(String(year).slice(0, 4), 10) || new Date().getFullYear();
  const due = new Date(s + 1, 10, 30, 23, 59); // 30 November of the following year
  return { start: s, label: `${s}/${s + 1}`, returnDue: `30 November ${s + 1}`, overdue: Date.now() > due.getTime() };
};

function header(title, sub, year) {
  return `<div class="sh">
    <div><div class="bn">Tax<span>Mate</span> Solutions</div><div class="bt">${esc(FIRM.tagline)}</div></div>
    <div class="sc">&#128231; ${FIRM.email}<br>&#128222; ${FIRM.phone}<br>&#127758; ${FIRM.web}</div></div>
  <div class="tb"><div><div class="tt">${esc(title)}</div><div class="ts">${esc(sub)}</div></div>
    ${year ? `<div class="yb">Y/A ${esc(year)}</div>` : ''}</div>`;
}

function clientTable(c = {}, year) {
  const td = (lb, vl, span) => `<td${span ? ` colspan="${span}"` : ''}><div class="lb">${lb}</div><div class="vl">${esc(vl) || '&mdash;'}</div></td>`;
  return `<table class="ct">
    <tr>${td('Full Name', c.full_name)}${td('TIN Number', c.tin)}${td('NIC / Passport', c.nic)}</tr>
    <tr>${td('Address', c.address, 2)}${td('Resident Status', RES[c.resident_status] ?? (c.resident_status || 'Resident Individual'))}</tr>
    <tr>${td('Employer / Occupation', c.employer, 2)}${td('Year of Assessment', year ? year.replace('/', ' / ') : '')}</tr>
  </table>`;
}

function slabTable(slabs, detail, title = 'Standard Tax') {
  let used = 0;
  const rows = slabs.map((s, idx) => {
    const label = s.limit === Infinity ? 'Balance' : `${idx === 0 ? 'First' : 'Next'} Rs. ${s.limit.toLocaleString('en-LK')}`;
    const d = detail[idx];
    if (d && d.taxed > 0) { used += d.tax; return `<tr class="on"><td>${label}</td><td class="r">${pct(s.rate)}</td><td class="r">${m(d.taxed)}</td><td class="r">${m(d.tax)}</td></tr>`; }
    return `<tr class="off"><td>${label}</td><td class="r">${pct(s.rate)}</td><td class="r">&mdash;</td><td class="r">&mdash;</td></tr>`;
  }).join('');
  const nilRow = detail.every(d => !d.taxed)
    ? '<tr><td colspan="4" style="text-align:center;color:#27ae60;font-weight:700;padding:8px">Taxable income is NIL — within reliefs</td></tr>' : '';
  return `<table class="sl"><tr><th>Income Slab</th><th class="r">Rate</th><th class="r">Amount Taxed (Rs.)</th><th class="r">Tax (Rs.)</th></tr>
    ${nilRow}${rows}<tr class="tot"><td colspan="3">${title}</td><td class="r">${m(used)}</td></tr></table>`;
}

function resultBox(balance, status, note) {
  const cls = status === 'payable' ? 'pay' : status === 'refund' ? 'ref' : 'nil';
  const lbl = status === 'payable' ? '&#9888; Tax Payable' : status === 'refund' ? '&#10004; Refund Claimable' : '&#10003; Nil &mdash; Fully Settled';
  return `<div class="pb ${cls}"><div class="pl">${lbl}</div><div class="pa">Rs. ${m(Math.abs(balance))}</div><div class="pn">${note}</div></div>`;
}

function payNote(status, year) {
  const y = yearInfo(year);
  if (status === 'payable') {
    return `Pay the balance via RAMIS / approved bank and file the return by ${y.returnDue}.${y.overdue ? ' Due date has passed — IRD penalty &amp; interest may apply.' : ''}`;
  }
  if (status === 'refund') return 'Claim the refund in the IIT return. Refund is subject to IRD verification.';
  return 'Tax credits fully cover the liability. Return must still be filed.';
}

function footer(sourceNote) {
  return `<div class="dc">&#9888;&#65039; This computation is prepared from information provided by the client and IRD guidelines (${sourceNote}).
    It is for guidance only and is not a formal IRD assessment. Final liability is as assessed by the Inland Revenue Department.</div>
  <div class="pr"><div><div>Prepared by: <strong>${FIRM.name}</strong></div>
    <div style="margin-top:2px;font-size:9.5px;color:#555">Date: ${today()}</div><div class="sg">Authorised Signature</div></div>
    <div class="fb"><strong>${FIRM.name}</strong>${FIRM.email}<br>${FIRM.phone}<br>${FIRM.web}</div></div>`;
}

// ─── Annual IIT statement (2024/25, 2025/26, 2026/27) ────
function annualBody(calc, client) {
  const a = computeAnnual(calc.year, calc.input_data);
  const i = a.inputs, cfg = yearCfg(calc.year);
  const row = (label, val, cls = '') => `<tr class="${cls}"><td>${label}</td><td class="r">${val}</td></tr>`;

  const income = [
    i.emp > 0 && row('Employment Income (Salary &amp; Allowances)', m(i.emp)),
    i.bonus > 0 && row('Bonus / Gratuity / Lump-sum', m(i.bonus)),
    i.biz > 0 && row('Business Net Profit', m(i.biz)),
    i.cons > 0 && row('Consulting / Professional Fees', m(i.cons)),
    i.rentGross > 0 && row('Rental Income (Gross)', m(i.rentGross)) + row('Less: Rent Relief (25%)', neg(a.rentRel), 'sub') + row('<b>Net Rental Income</b>', `<b>${m(a.rentNet)}</b>`, 'sub'),
    i.forOth > 0 && row('Other Foreign Income (not via bank)', m(i.forOth)),
    i.othInc > 0 && row('Other Income', m(i.othInc)),
  ].filter(Boolean).join('') || row('No income entered', m(0));

  const fbRows = a.forBankTx > 0
    ? row('<b>Standard Assessable Income</b>', `<b>${m(a.stdIncome)}</b>`) + row('Foreign Income Remitted via Bank (6% / 15%)', m(a.forBankTx))
    : '';
  const exRow = a.fbExempt && i.forBank > 0 ? row(`Foreign income remitted via bank — EXEMPT for Y/A ${calc.year} (declared, not taxed)`, m(i.forBank), 'ex') : '';

  const ded = [
    row(`Personal Relief (Y/A ${calc.year})`, neg(a.prUsed), 'sub'),
    a.donAllowed > 0 && row('Approved Charitable Donations (max Rs. 75,000)', neg(a.donAllowed), 'sub'),
    a.solarAllow > 0 && row('Solar Panel Relief (max Rs. 600,000)', neg(a.solarAllow), 'sub'),
    i.govtDon > 0 && row('Donations to Government / Specified Funds', neg(i.govtDon), 'sub'),
  ].filter(Boolean).join('');

  const fbTable = a.fbResult.bands.length
    ? `<div class="ph">PART IV-B &mdash; FOREIGN INCOME REMITTED VIA BANK</div>
       <table class="sl"><tr><th>Band</th><th class="r">Rate</th><th class="r">Amount Taxed (Rs.)</th><th class="r">Tax (Rs.)</th></tr>
       ${a.fbResult.bands.map(b => `<tr class="on"><td>${b.label}</td><td class="r">${pct(b.rate)}</td><td class="r">${m(b.taxed)}</td><td class="r">${m(b.tax)}</td></tr>`).join('')}
       <tr class="tot"><td colspan="3">Foreign Income Tax</td><td class="r">${m(a.fbResult.tax)}</td></tr></table>` : '';

  const credits = [
    i.whtApit > 0 && row('APIT Deducted by Employer (T10)', neg(i.whtApit)),
    i.whtRent > 0 && row('WHT on Rental Income', neg(i.whtRent)),
    i.whtProf > 0 && row('WHT on Professional / Service Fees', neg(i.whtProf)),
    i.whtOth > 0 && row('Other WHT / AIT / Instalments Paid', neg(i.whtOth)),
  ].filter(Boolean).join('') || row('No tax credits', m(0));

  return header('Individual Income Tax Computation Statement', 'Prepared under Inland Revenue Act No. 24 of 2017 (as amended)', calc.year)
    + clientTable(client, calc.year)
    + `<div class="ph">PART I &mdash; INCOME STATEMENT</div><table class="st"><tr class="hd"><td>Description</td><td class="r">Amount (Rs.)</td></tr>${income}${fbRows}
       <tr class="tot"><td>Total Assessable Income</td><td class="r">${m(a.totalAss)}</td></tr>${exRow}</table>`
    + `<div class="ph">PART II &mdash; RELIEFS &amp; QUALIFYING PAYMENTS</div><table class="st">${ded}
       <tr class="tot"><td>Total Deductions</td><td class="r">${neg(a.prUsed + a.totalQP)}</td></tr></table>`
    + `<div class="ph">PART III &mdash; TAXABLE INCOME</div><table class="st">
       ${row('Standard Assessable Income', m(a.stdIncome))}${row('Less: Reliefs &amp; Qualifying Payments', neg(Math.min(a.stdIncome, a.prUsed + a.totalQP)), 'sub')}
       <tr class="tot"><td>Taxable Income</td><td class="r">${a.taxableStd > 0 ? m(a.taxableStd) : 'NIL'}</td></tr>
       ${a.taxableFB > 0 ? row('Taxable Foreign Bank Income (taxed separately)', m(a.taxableFB)) : ''}</table>`
    + `<div class="ph">PART IV &mdash; TAX COMPUTATION (GRADUATED RATES &mdash; Y/A ${calc.year})</div>${slabTable(cfg.slabs, a.stdResult.detail)}${fbTable}`
    + `<div class="ph">PART V &mdash; TAX CREDITS (APIT / WHT / AIT)</div><table class="st">${row('Gross Tax Liability', m(a.grossTax))}${credits}
       <tr class="tot"><td>Total Tax Credits</td><td class="r">${neg(a.totalWHT)}</td></tr></table>`
    + `<div class="sw">${resultBox(a.netTax, a.taxStatus, payNote(a.taxStatus, calc.year))}
       <table class="sm">
        <tr><td class="k">Total Assessable Income</td><td class="v">Rs. ${m(a.totalAss)}</td></tr>
        <tr><td class="k">Personal Relief</td><td class="v neg">(Rs. ${m(a.prUsed)})</td></tr>
        <tr><td class="k">Qualifying Payments</td><td class="v neg">${a.totalQP > 0 ? `(Rs. ${m(a.totalQP)})` : 'Nil'}</td></tr>
        <tr><td class="k">Taxable Income</td><td class="v">Rs. ${m(a.taxableStd + a.taxableFB)}</td></tr>
        <tr><td class="k">Gross Tax</td><td class="v">Rs. ${m(a.grossTax)}</td></tr>
        <tr><td class="k">Tax Credits</td><td class="v neg">(Rs. ${m(a.totalWHT)})</td></tr>
        <tr><td class="k">Effective Rate</td><td class="v">${a.effRate}%</td></tr>
       </table></div>`
    + footer(`ird.gov.lk — Y/A ${calc.year}: Personal Relief Rs. ${cfg.pr.toLocaleString('en-LK')}, rates ${cfg.slabText}`);
}

// ─── IIT Return Y/A 2024/25 (cage-wise) ──────────────────
function return2425Body(calc, client) {
  const r = computeReturn2425(calc.input_data);
  const f = r.f;
  const row = (cage, label, val, cls = '') => `<tr class="${cls}"><td class="c">${cage}</td><td>${label}</td><td class="r">${val}</td></tr>`;
  const opt = (k, cage, label, cls) => (f[k] > 0 ? row(cage, label, m(f[k]), cls) : '');

  const sched = `
    <tr class="hd"><td class="c">Cage</td><td>Schedule 1 — Employment Income</td><td class="r">Rs.</td></tr>
    ${opt('empPrimary', '', 'Primary employment — salary &amp; allowances', 'det')}${opt('empSecondary', '', 'Secondary employment', 'det')}
    ${opt('empBenefits', '', 'Non-cash benefits', 'det')}${opt('empBonus', '', 'Bonus / other lump sums', 'det')}
    ${row('10', '<b>Employment income</b>', `<b>${m(r.cage10)}</b>`)}
    <tr class="hd"><td class="c"></td><td>Schedule 2 — Business Income</td><td></td></tr>
    ${opt('bizProfit', '', 'Sole proprietorship net profit', 'det')}${opt('bizPartner', '', 'Share of partnership income', 'det')}
    ${r.bizLossUsed > 0 ? row('', 'Less: business loss brought forward', neg(r.bizLossUsed), 'sub') : ''}
    ${row('20', '<b>Business income</b>', `<b>${m(r.cage20)}</b>`)}
    <tr class="hd"><td class="c"></td><td>Schedule 3 — Investment Income</td><td></td></tr>
    ${opt('interest', '', 'Interest income (gross)', 'det')}${opt('rentGross', '', 'Rental income (gross)', 'det')}${opt('othInv', '', 'Other investment income', 'det')}
    ${row('30', '<b>Investment income</b>', `<b>${m(r.cage30)}</b>`)}
    <tr class="hd"><td class="c"></td><td>Schedule 4 — Other Income</td><td></td></tr>
    ${opt('othInc', '', 'Other income', 'det')}${opt('forTaxable', '', 'Foreign income not remitted via bank', 'det')}
    ${row('40', '<b>Other income</b>', `<b>${m(r.cage40)}</b>`)}
    <tr class="tot"><td class="c">50</td><td>Total Assessable Income</td><td class="r">${m(r.cage50)}</td></tr>`;

  const ded = `
    ${row('60', 'Rent relief (25% of gross rent)', neg(r.rentRelief), 'sub')}
    ${row('', 'Personal relief (Y/A 2024/25)', neg(r.prUsed), 'sub')}
    ${r.solarUsed > 0 ? row('', 'Solar panel relief', neg(r.solarUsed), 'sub') : ''}
    ${r.donUsed > 0 ? row('', 'Approved charitable donations', neg(r.donUsed), 'sub') : ''}
    ${f.donGovt > 0 ? row('', 'Donations to Government / specified funds', neg(f.donGovt), 'sub') : ''}
    ${f.qpOther > 0 ? row('', 'Other qualifying payments', neg(f.qpOther), 'sub') : ''}
    ${row('100', 'Total qualifying payments', neg(r.cage100))}
    <tr class="tot"><td class="c">120</td><td>Taxable Income</td><td class="r">${r.cage120 > 0 ? m(r.cage120) : 'NIL'}</td></tr>`;

  const other = (r.term.tax > 0 || r.gainTax > 0 || f.termBen > 0 || f.invGain > 0) ? `<table class="st">
    ${f.termBen > 0 ? row('130', `Terminal benefits Rs. ${m(f.termBen)} (0% / 6% / 12%)`, m(r.term.tax)) : ''}
    ${f.invGain > 0 ? row('140', `Gains on investment assets Rs. ${m(f.invGain)} @ 10%`, m(r.gainTax)) : ''}</table>` : '';

  const credits = r.credits.filter(x => x.amt > 0).map(x => row(x.cage, x.label, neg(x.amt))).join('') || row('', 'No tax credits', m(0));
  const exempt = r.cage210 > 0 ? `<table class="st">${row('210', 'Exempt income — foreign income remitted via bank / other exempt (declared, not taxed)', m(r.cage210), 'ex')}</table>` : '';

  return header('Individual Income Tax Return — Computation Statement', 'Return of Income Y/A 2024/2025 | Inland Revenue Act No. 24 of 2017 (as amended)', '2024/25')
    + clientTable(client, '2024/25')
    + `<div class="ph">PART A &mdash; ASSESSABLE INCOME (SCHEDULES 1&ndash;4)</div><table class="st">${sched}</table>`
    + `<div class="ph">PART B &mdash; RELIEFS &amp; QUALIFYING PAYMENTS</div><table class="st">${ded}</table>`
    + `<div class="ph">PART C &mdash; TAX ON TAXABLE INCOME (Y/A 2024/25 RATES)</div>${slabTable(SLABS_2425, r.prog.detail, 'Tax at progressive rates')}${other}`
    + `<div class="ph">PART D &mdash; TAX PAYABLE &amp; CREDITS (SCHEDULE 9)</div><table class="st">
       <tr class="tot"><td class="c">170</td><td>Total Tax Payable</td><td class="r">${m(r.cage170)}</td></tr>${credits}
       <tr class="tot"><td class="c">180</td><td>Total Tax Credits</td><td class="r">${neg(r.cage180)}</td></tr></table>${exempt}`
    + `<div class="sw">${resultBox(r.balance, r.taxStatus, (r.balance >= 0 ? 'Cage 190 &mdash; ' : 'Cage 200 &mdash; ') + payNote(r.taxStatus, '2024/25'))}
       <table class="sm">
        <tr><td class="k">Total Assessable Income (50)</td><td class="v">Rs. ${m(r.cage50)}</td></tr>
        <tr><td class="k">Reliefs</td><td class="v neg">(Rs. ${m(r.reliefs)})</td></tr>
        <tr><td class="k">Qualifying Payments (100)</td><td class="v neg">${r.cage100 > 0 ? `(Rs. ${m(r.cage100)})` : 'Nil'}</td></tr>
        <tr><td class="k">Taxable Income (120)</td><td class="v">Rs. ${m(r.cage120)}</td></tr>
        <tr><td class="k">Total Tax Payable (170)</td><td class="v">Rs. ${m(r.cage170)}</td></tr>
        <tr><td class="k">Tax Credits (180)</td><td class="v neg">(Rs. ${m(r.cage180)})</td></tr>
        <tr><td class="k">Income Sources</td><td class="v">${esc(r.sources.join(', ') || '—')}</td></tr>
       </table></div>`
    + footer('IRD Guide to the Return of Income Y/A 2024/2025 — Personal Relief Rs. 1,200,000, rates 6% to 36%');
}

// ─── Quarterly instalment notice ─────────────────────────
function quarterlyBody(calc, client) {
  const q = computeQuarterly(calc.input_data);
  const y = yearInfo(calc.year);
  const dues = [`15 August ${y.start}`, `15 November ${y.start}`, `15 February ${y.start + 1}`, `15 May ${y.start + 1}`];
  const row = (l, v, cls = '') => `<tr class="${cls}"><td>${l}</td><td class="r">${v}</td></tr>`;
  return header('Quarterly Income Tax Instalment Notice', 'Self-assessment instalment — Formula (A − C) ÷ B', calc.year)
    + clientTable(client, calc.year)
    + `<div class="ph">INSTALMENT COMPUTATION &mdash; Q${q.quarter}</div><table class="st">
       ${row('A — Preceding year gross tax', m(q.A))}${row('C — Credits &amp; prior instalments paid', neg(q.C), 'sub')}
       ${row('B — Remaining quarters', q.B)}<tr class="tot"><td>Instalment Due (A − C) ÷ B</td><td class="r">${m(q.instalment)}</td></tr></table>`
    + `<div class="sw"><div class="pb ins"><div class="pl">Q${q.quarter} Instalment Due</div><div class="pa">Rs. ${m(q.instalment)}</div>
       <div class="pn">Pay on or before ${dues[parseInt(q.quarter, 10) - 1] ?? dues[0]} via RAMIS / approved bank.</div></div>
       <table class="sm">${dues.map((d, k) => `<tr><td class="k">Q${k + 1} due date</td><td class="v">${d}</td></tr>`).join('')}</table></div>`
    + footer(`ird.gov.lk — quarterly instalments Y/A ${calc.year}`);
}

// Build the full statement HTML document for a saved (or unsaved) calculation.
// calc: { year, calc_type, input_data }  client: { full_name, tin, nic, address, employer, resident_status }
export function buildStatementHtml(calc, client = {}, { withToolbar = true } = {}) {
  const kind = calcKind(calc);
  const body = kind === 'return2425' ? return2425Body(calc, client) : kind === 'quarterly' ? quarterlyBody(calc, client) : annualBody(calc, client);
  const title = `IIT_Computation_${String(calc.year || '').replace('/', '-')}_${(client.full_name || 'Client').trim().replace(/\s+/g, '_')}`;
  const bar = withToolbar
    ? '<div class="bar no-print"><button class="pbt" onclick="window.print()">&#128424; Print / Save as PDF</button></div>' : '';
  // Anything not explicitly finalised (including unsaved previews) prints as a DRAFT
  const isFinal = calc.status === 'final';
  const statusStrip = isFinal
    ? `<div class="vs fin">&#10004; FINAL computation${calc.label ? ` &mdash; ${esc(calc.label)}` : ''}</div>`
    : `<div class="wm">DRAFT</div><div class="vs drf">&#9998; DRAFT${calc.label ? ` &mdash; ${esc(calc.label)}` : ''} &mdash; prepared for your verification. Figures may change before the final return is filed.</div>`;
  const extraCss = '<style>.wm{position:fixed;top:45%;left:50%;transform:translate(-50%,-50%) rotate(-30deg);font-size:120px;font-weight:900;color:rgba(192,57,43,.07);pointer-events:none;white-space:nowrap;z-index:0;letter-spacing:8px}.vs{border-radius:6px;padding:6px 12px;font-size:10px;font-weight:700;margin:0 0 10px}.vs.drf{background:#FDEDEC;border:1px solid #F5B7B1;color:#922B21}.vs.fin{background:#E9F7EF;border:1px solid #A9DFBF;color:#1E8449}</style>';
  return `<!DOCTYPE html><html lang="en"><head><meta charset="UTF-8"><title>${esc(title)}${isFinal ? '' : '_DRAFT'}</title>${CSS}${extraCss}</head><body>${bar}${statusStrip}${body}</body></html>`;
}

// Open the statement in a new window ready to print / save as PDF.
export function openStatement(calc, client = {}) {
  const w = window.open('', '_blank', 'width=920,height=900');
  if (!w) return false;
  w.document.open();
  w.document.write(buildStatementHtml(calc, client));
  w.document.close();
  w.focus();
  return true;
}
