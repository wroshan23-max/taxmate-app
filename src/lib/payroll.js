// ═══════════════════════════════════════════════════════════
//  Payroll / APIT — monthly salary run for employer clients
//  APIT Tax Table 01 (from 1 April 2025), EPF 8% + 12%, ETF 3%
// ═══════════════════════════════════════════════════════════
import { FIRM, waNumber } from './firm';

export const EPF_EE = 0.08;   // employee's share, deducted from pay
export const EPF_ER = 0.12;   // employer's share
export const ETF_ER = 0.03;   // employer only

const n = (v) => { const x = Number(String(v ?? '').replace(/,/g, '')); return Number.isFinite(x) ? x : 0; };
const r2 = (v) => Math.round(n(v) * 100) / 100;

// APIT Tax Table 01: monthly tax on regular profits from primary employment (residents & non-resident citizens)
export function apitTable1(monthly) {
  const m = Math.max(0, n(monthly));
  const rows = [[150_000, 0, 0], [233_333, 0.06, 9_000], [275_000, 0.18, 37_000], [316_667, 0.24, 53_500], [358_333, 0.30, 72_500], [Infinity, 0.36, 94_000]];
  const [, rate, less] = rows.find(([lim]) => m <= lim);
  return Math.max(0, Math.round(m * rate - less));
}

// Variable items entered each month (fixed salary items come from the employee record)
export const VAR_EARN = [['overtime', 'Overtime'], ['bonus', 'Bonus / incentive'], ['other_earn', 'Other earnings']];
export const VAR_DED = [['no_pay', 'No-pay (absence)'], ['advance', 'Salary advance'], ['loan', 'Loan instalment'], ['other_ded', 'Other deductions']];

/** One employee's pay for the month. line = employee snapshot + this month's items. */
export function calcLine(line) {
  const basic = n(line.basic), allowEpf = n(line.allow_epf), allowOther = n(line.allow_other);
  const overtime = n(line.overtime), bonus = n(line.bonus), otherEarn = n(line.other_earn);
  const noPay = n(line.no_pay), advance = n(line.advance), loan = n(line.loan), otherDed = n(line.other_ded);
  const epfBase = Math.max(0, basic + allowEpf - noPay);                         // "total earnings" for EPF / ETF
  const gross = Math.max(0, basic + allowEpf + allowOther + overtime + bonus + otherEarn - noPay);
  const member = line.epf_member !== false;
  const epfEe = member ? r2(epfBase * EPF_EE) : 0;
  const epfEr = member ? r2(epfBase * EPF_ER) : 0;
  const etf = member ? r2(epfBase * ETF_ER) : 0;
  const apitAuto = line.apit_mode === 'none' ? 0 : apitTable1(gross);
  const manual = line.apit_manual !== null && line.apit_manual !== undefined && String(line.apit_manual).trim() !== '';
  const apit = manual ? r2(line.apit_manual) : apitAuto;
  const deductions = r2(epfEe + apit + advance + loan + otherDed);
  return {
    epfBase: r2(epfBase), gross: r2(gross), epfEe, epfEr, etf, apit, apitAuto, apitManual: manual,
    deductions, net: r2(gross - deductions), cost: r2(gross + epfEr + etf),
    bonusHint: bonus > 0 && line.apit_mode !== 'none' && !manual,   // lump sums may need APIT Table 03
  };
}

export function totalsOf(lines) {
  const t = { count: 0, gross: 0, epfBase: 0, epfEe: 0, epfEr: 0, etf: 0, apit: 0, deductions: 0, net: 0, cost: 0 };
  for (const l of lines ?? []) {
    const c = calcLine(l); t.count++;
    for (const k of ['gross', 'epfBase', 'epfEe', 'epfEr', 'etf', 'apit', 'deductions', 'net', 'cost']) t[k] = r2(t[k] + c[k]);
  }
  t.epfTotal = r2(t.epfEe + t.epfEr);
  return t;
}

const EMP_FIELDS = ['emp_no', 'full_name', 'nic', 'designation', 'epf_no', 'mobile', 'email', 'bank_name', 'bank_branch', 'bank_account', 'basic', 'allow_epf', 'allow_other', 'epf_member', 'apit_mode'];
/** Line for a month from an employee record (keeps this month's items when refreshing). */
export function lineFromEmployee(e, keep = {}) {
  const l = { employee_id: e.id };
  for (const k of EMP_FIELDS) l[k] = e[k] ?? (k === 'epf_member' ? true : '');
  l.basic = n(e.basic); l.allow_epf = n(e.allow_epf); l.allow_other = n(e.allow_other);
  for (const [k] of [...VAR_EARN, ...VAR_DED]) l[k] = keep[k] ?? 0;
  l.apit_manual = keep.apit_manual ?? null;
  l.note = keep.note ?? '';
  return l;
}

// ── Labels & formatting ──────────────────────────────────
export const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
export const periodLabel = (p) => { const [y, m] = String(p || '').split('-').map(Number); return y && m ? `${MONTHS[m - 1]} ${y}` : p; };
export const nextPeriod = (p) => { const [y, m] = p.split('-').map(Number); return m === 12 ? `${y + 1}-01` : `${y}-${String(m + 1).padStart(2, '0')}`; };
export const thisPeriod = () => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`; };
export const rsx = (v) => 'Rs. ' + n(v).toLocaleString('en-LK', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const amt = (v) => n(v).toLocaleString('en-LK', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

// When the month's payments are due (paid in the following month)
export function dueDates(period) {
  const nx = periodLabel(nextPeriod(period));
  return { apit: `15 ${nx}`, epf: `end of ${nx}`, etf: `end of ${nx}` };
}

// ── Payslips (print / PDF) ───────────────────────────────
const CSS = `*{box-sizing:border-box}body{font-family:'Segoe UI',Arial,sans-serif;color:#1f2937;margin:0;background:#f3f4f6}
.bar{position:sticky;top:0;background:#1a3c6e;color:#fff;padding:10px 16px;display:flex;gap:10px;align-items:center;z-index:5}
.bar button{background:#e8a020;color:#0e2040;border:0;border-radius:8px;padding:8px 14px;font-weight:700;cursor:pointer}
.page{max-width:820px;margin:16px auto;padding:0 12px}
.slip{background:#fff;border:1px solid #d1d5db;border-radius:10px;padding:18px 22px;margin-bottom:16px;page-break-inside:avoid}
.hd{display:flex;justify-content:space-between;gap:12px;border-bottom:2px solid #1a3c6e;padding-bottom:8px;margin-bottom:10px}
.hd h2{margin:0;font-size:15pt;color:#0e2040}.hd .t{font-size:11pt;font-weight:800;color:#1a3c6e;text-align:right}
.muted{color:#6b7280;font-size:8.5pt}.info{display:grid;grid-template-columns:1fr 1fr;gap:2px 18px;font-size:9pt;margin-bottom:10px}
.cols{display:grid;grid-template-columns:1fr 1fr;gap:14px}table{width:100%;border-collapse:collapse;font-size:9pt}
th{text-align:left;background:#eef2f9;color:#142e55;padding:5px 6px;font-size:8.5pt}td{padding:4px 6px;border-bottom:1px solid #f1f5f9}
td.r,th.r{text-align:right;white-space:nowrap}.tot td{font-weight:700;border-top:1px solid #9ca3af}
.net{margin-top:10px;background:#0e2040;color:#fff;border-radius:8px;padding:9px 14px;display:flex;justify-content:space-between;font-size:12pt;font-weight:800}
.er{margin-top:8px;font-size:8.5pt;color:#4b5563}.ft{margin-top:8px;font-size:7.5pt;color:#9ca3af;display:flex;justify-content:space-between}
h1{font-size:15pt;color:#0e2040;margin:0 0 4px}.card{background:#fff;border:1px solid #d1d5db;border-radius:10px;padding:16px 18px;margin-bottom:14px}
.big td{font-size:8.5pt}.kp{display:grid;grid-template-columns:repeat(4,1fr);gap:8px;margin:10px 0}.kp div{background:#eef2f9;border-radius:8px;padding:8px}
.kp b{display:block;font-size:11pt;color:#0e2040}
@media print{body{background:#fff}.bar{display:none}.page{margin:0;max-width:none;padding:0}.slip{border-color:#9ca3af;margin-bottom:10mm}.card{border:0;padding:0}
@page{size:A4;margin:12mm}}`;

function slipHtml(l, run, emp) {
  const c = calcLine(l);
  const earn = [['Basic salary', l.basic], ['Allowances (EPF)', l.allow_epf], ['Other allowances', l.allow_other], ...VAR_EARN.map(([k, lb]) => [lb, l[k]])].filter(([, v]) => n(v));
  const ded = [[`EPF employee ${EPF_EE * 100}%`, c.epfEe], ['APIT (PAYE tax)', c.apit], ...VAR_DED.filter(([k]) => k !== 'no_pay').map(([k, lb]) => [lb, l[k]])].filter(([, v]) => n(v));
  if (n(l.no_pay)) earn.push(['Less: no-pay', -n(l.no_pay)]);
  return `<div class="slip"><div class="hd"><div><h2>${esc(emp.name)}</h2><div class="muted">${esc(emp.address || '')}${emp.epf ? ` · EPF Reg. ${esc(emp.epf)}` : ''}</div></div>
<div class="t">PAYSLIP<br><span style="font-weight:600;font-size:10pt">${esc(periodLabel(run.period))}</span></div></div>
<div class="info"><div><b>${esc(l.full_name)}</b>${l.emp_no ? ` · ${esc(l.emp_no)}` : ''}</div><div>${l.designation ? esc(l.designation) : ''}</div>
<div class="muted">NIC: ${esc(l.nic || '—')}</div><div class="muted">EPF No: ${esc(l.epf_no || '—')}</div>
${l.bank_account ? `<div class="muted" style="grid-column:span 2">Paid to: ${esc([l.bank_name, l.bank_branch].filter(Boolean).join(' – '))} · ${esc(l.bank_account)}</div>` : ''}</div>
<div class="cols"><table><tr><th>Earnings</th><th class="r">Rs.</th></tr>${earn.map(([a, v]) => `<tr><td>${esc(a)}</td><td class="r">${amt(v)}</td></tr>`).join('')}
<tr class="tot"><td>Gross pay</td><td class="r">${amt(c.gross)}</td></tr></table>
<table><tr><th>Deductions</th><th class="r">Rs.</th></tr>${ded.map(([a, v]) => `<tr><td>${esc(a)}</td><td class="r">${amt(v)}</td></tr>`).join('') || '<tr><td colspan="2" class="muted">—</td></tr>'}
<tr class="tot"><td>Total deductions</td><td class="r">${amt(c.deductions)}</td></tr></table></div>
<div class="net"><span>NET PAY</span><span>Rs. ${amt(c.net)}</span></div>
${l.epf_member !== false ? `<div class="er">Paid by employer (not deducted): EPF ${EPF_ER * 100}% Rs. ${amt(c.epfEr)} · ETF ${ETF_ER * 100}% Rs. ${amt(c.etf)} · EPF/ETF earnings Rs. ${amt(c.epfBase)}</div>` : ''}
${l.note ? `<div class="er">Note: ${esc(l.note)}</div>` : ''}
<div class="ft"><span>Computer-generated payslip — no signature required.</span><span>Prepared with ${esc(FIRM.name)}</span></div></div>`;
}

function openDoc(title, body, win) {
  const w = win ?? window.open('', '_blank', 'width=900,height=1000');
  if (!w) return false;
  w.document.open();
  w.document.write(`<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${esc(title)}</title><style>${CSS}</style></head><body>
<div class="bar"><b>${esc(title)}</b><span style="flex:1"></span><button onclick="window.print()">&#128424; Print / Save as PDF</button></div><div class="page">${body}</div></body></html>`);
  w.document.close(); w.focus();
  return true;
}

/** emp = { name, address, epf, etf, tin } (employer). lines: one employee or all. */
export function openPayslips(run, lines, emp, win) {
  const one = lines.length === 1;
  return openDoc(one ? `Payslip — ${lines[0].full_name} — ${periodLabel(run.period)}` : `Payslips — ${periodLabel(run.period)}`,
    lines.map(l => slipHtml(l, run, emp)).join(''), win);
}

/** Month summary: pay sheet, EPF/ETF contributions, APIT schedule, amounts to pay. */
export function openSummary(run, emp, win) {
  const lines = run.lines ?? []; const t = totalsOf(lines); const due = dueDates(run.period);
  const rows = lines.map(l => ({ l, c: calcLine(l) }));
  const body = `<div class="card"><h1>Payroll summary — ${esc(periodLabel(run.period))}</h1>
<div class="muted">${esc(emp.name)}${emp.epf ? ` · EPF Reg. ${esc(emp.epf)}` : ''}${emp.etf ? ` · ETF Reg. ${esc(emp.etf)}` : ''}${emp.tin ? ` · TIN ${esc(emp.tin)}` : ''} · ${t.count} employee${t.count === 1 ? '' : 's'} · ${run.status === 'final' ? 'Final' : 'DRAFT'}</div>
<div class="kp"><div>Net pay to staff<b>Rs. ${amt(t.net)}</b></div><div>APIT to IRD<b>Rs. ${amt(t.apit)}</b><span class="muted">by ${esc(due.apit)}</span></div>
<div>EPF (8% + 12%)<b>Rs. ${amt(t.epfTotal)}</b><span class="muted">by ${esc(due.epf)}</span></div><div>ETF (3%)<b>Rs. ${amt(t.etf)}</b><span class="muted">by ${esc(due.etf)}</span></div></div>
<div class="muted">Total cost to employer: Rs. ${amt(t.cost)} (gross pay + EPF 12% + ETF 3%)</div></div>
<div class="card"><b>Pay sheet</b><table class="big"><tr><th>Employee</th><th class="r">Gross</th><th class="r">EPF 8%</th><th class="r">APIT</th><th class="r">Other ded.</th><th class="r">Net pay</th><th class="r">EPF 12%</th><th class="r">ETF 3%</th></tr>
${rows.map(({ l, c }) => `<tr><td>${esc(l.full_name)}${l.emp_no ? ` <span class="muted">${esc(l.emp_no)}</span>` : ''}</td><td class="r">${amt(c.gross)}</td><td class="r">${amt(c.epfEe)}</td><td class="r">${amt(c.apit)}</td><td class="r">${amt(c.deductions - c.epfEe - c.apit)}</td><td class="r"><b>${amt(c.net)}</b></td><td class="r">${amt(c.epfEr)}</td><td class="r">${amt(c.etf)}</td></tr>`).join('')}
<tr class="tot"><td>Total</td><td class="r">${amt(t.gross)}</td><td class="r">${amt(t.epfEe)}</td><td class="r">${amt(t.apit)}</td><td class="r">${amt(t.deductions - t.epfEe - t.apit)}</td><td class="r">${amt(t.net)}</td><td class="r">${amt(t.epfEr)}</td><td class="r">${amt(t.etf)}</td></tr></table></div>
<div class="card"><b>EPF contributions (C-Form details)</b><table class="big"><tr><th>Name</th><th>NIC</th><th>Member No</th><th class="r">Total earnings</th><th class="r">Employer 12%</th><th class="r">Employee 8%</th><th class="r">Total 20%</th></tr>
${rows.filter(({ l }) => l.epf_member !== false).map(({ l, c }) => `<tr><td>${esc(l.full_name)}</td><td>${esc(l.nic)}</td><td>${esc(l.epf_no)}</td><td class="r">${amt(c.epfBase)}</td><td class="r">${amt(c.epfEr)}</td><td class="r">${amt(c.epfEe)}</td><td class="r">${amt(c.epfEr + c.epfEe)}</td></tr>`).join('')}
<tr class="tot"><td colspan="3">Total</td><td class="r">${amt(t.epfBase)}</td><td class="r">${amt(t.epfEr)}</td><td class="r">${amt(t.epfEe)}</td><td class="r">${amt(t.epfTotal)}</td></tr></table>
<div class="muted" style="margin-top:6px">ETF 3% on the same earnings: Rs. ${amt(t.etf)}</div></div>
<div class="card"><b>APIT schedule</b><table class="big"><tr><th>Name</th><th>NIC</th><th class="r">Gross pay</th><th class="r">APIT deducted</th></tr>
${rows.map(({ l, c }) => `<tr><td>${esc(l.full_name)}</td><td>${esc(l.nic)}</td><td class="r">${amt(c.gross)}</td><td class="r">${amt(c.apit)}</td></tr>`).join('')}
<tr class="tot"><td colspan="2">Total</td><td class="r">${amt(t.gross)}</td><td class="r">${amt(t.apit)}</td></tr></table>
<div class="muted" style="margin-top:6px">APIT worked out with Tax Table 01 (primary employment). Check lump-sum payments (bonus) against Table 03.</div></div>
<div class="ft"><span>Prepared with ${esc(FIRM.name)} · ${esc(FIRM.phone)}</span><span>${new Date().toLocaleDateString('en-GB')}</span></div>`;
  return openDoc(`Payroll summary — ${periodLabel(run.period)}`, body, win);
}

// ── CSV downloads ────────────────────────────────────────
const q = (s) => `"${String(s ?? '').replace(/"/g, '""')}"`;
function download(name, rows) {
  const blob = new Blob(['﻿' + rows.map(r => r.join(',')).join('\r\n')], { type: 'text/csv;charset=utf-8' });
  const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = name;
  document.body.appendChild(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(a.href), 2000);
}
export function csvEpf(run) {
  download(`EPF-ETF-${run.period}.csv`, [['Name', 'NIC', 'EPF Member No', 'Total Earnings', 'Employer 12%', 'Employee 8%', 'Total EPF', 'ETF 3%'],
    ...(run.lines ?? []).filter(l => l.epf_member !== false).map(l => { const c = calcLine(l); return [q(l.full_name), q(l.nic), q(l.epf_no), c.epfBase.toFixed(2), c.epfEr.toFixed(2), c.epfEe.toFixed(2), (c.epfEr + c.epfEe).toFixed(2), c.etf.toFixed(2)]; })]);
}
export function csvApit(run) {
  download(`APIT-${run.period}.csv`, [['Name', 'NIC', 'Employee No', 'Gross Pay', 'APIT Deducted'],
    ...(run.lines ?? []).map(l => { const c = calcLine(l); return [q(l.full_name), q(l.nic), q(l.emp_no), c.gross.toFixed(2), c.apit.toFixed(2)]; })]);
}
export function csvBank(run) {
  download(`Salary-transfers-${run.period}.csv`, [['Name', 'Bank', 'Branch', 'Account No', 'Net Pay'],
    ...(run.lines ?? []).map(l => [q(l.full_name), q(l.bank_name), q(l.bank_branch), q(l.bank_account), calcLine(l).net.toFixed(2)])]);
}

// ── WhatsApp payslip (text) ──────────────────────────────
export function payslipText(l, run, empName) {
  const c = calcLine(l); const lines = [`*Payslip — ${periodLabel(run.period)}*`, empName, '', `${l.full_name}${l.emp_no ? ` (${l.emp_no})` : ''}`, ''];
  const add = (label, v) => { if (n(v)) lines.push(`${label}: Rs. ${amt(v)}`); };
  add('Basic salary', l.basic); add('Allowances', n(l.allow_epf) + n(l.allow_other));
  for (const [k, lb] of VAR_EARN) add(lb, l[k]);
  if (n(l.no_pay)) lines.push(`No-pay: -Rs. ${amt(l.no_pay)}`);
  lines.push(`*Gross pay: Rs. ${amt(c.gross)}*`, '');
  add(`EPF ${EPF_EE * 100}%`, c.epfEe); add('APIT', c.apit);
  for (const [k, lb] of VAR_DED) if (k !== 'no_pay') add(lb, l[k]);
  lines.push(`Total deductions: Rs. ${amt(c.deductions)}`, '', `*NET PAY: Rs. ${amt(c.net)}*`);
  if (l.epf_member !== false) lines.push('', `Employer paid: EPF 12% Rs. ${amt(c.epfEr)} · ETF 3% Rs. ${amt(c.etf)}`);
  return lines.join('\n');
}
export const payslipWhatsApp = (l, run, empName) => `https://wa.me/${waNumber(l.mobile)}?text=${encodeURIComponent(payslipText(l, run, empName))}`;

// ── Staff CSV import ─────────────────────────────────────
export const IMPORT_COLUMNS = ['emp_no', 'full_name', 'nic', 'designation', 'epf_no', 'mobile', 'basic', 'allow_epf', 'allow_other', 'bank_name', 'bank_branch', 'bank_account'];
export function importTemplate() {
  download('staff-list-template.csv', [IMPORT_COLUMNS, ['E001', 'Kasun Perera', '199012345678', 'Accounts Assistant', '101', '0771234567', '85000', '5000', '7500', 'BOC', 'Colombo', '1234567']]);
}
function splitCsv(line) {
  const out = []; let cur = ''; let inQ = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (inQ) { if (ch === '"') { if (line[i + 1] === '"') { cur += '"'; i++; } else inQ = false; } else cur += ch; }
    else if (ch === '"') inQ = true; else if (ch === ',') { out.push(cur); cur = ''; } else cur += ch;
  }
  out.push(cur); return out.map(s => s.trim());
}
/** CSV text → employee rows (header row with the template column names). */
export function parseStaffCsv(text) {
  const rows = String(text || '').replace(/^﻿/, '').split(/\r?\n/).filter(r => r.trim());
  if (rows.length < 2) throw new Error('The file has no staff rows.');
  const head = splitCsv(rows[0]).map(h => h.toLowerCase().replace(/[^a-z_]/g, ''));
  if (!head.includes('full_name')) throw new Error('Use the template — the first row must have a full_name column.');
  return rows.slice(1).map(r => {
    const v = splitCsv(r); const o = {};
    head.forEach((h, i) => { if (IMPORT_COLUMNS.includes(h)) o[h] = v[i] ?? ''; });
    for (const k of ['basic', 'allow_epf', 'allow_other']) o[k] = Math.max(0, n(o[k]));
    return o;
  }).filter(o => String(o.full_name || '').trim()).slice(0, 500);
}
