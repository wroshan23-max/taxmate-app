// ═══════════════════════════════════════════════════════════════════════════
//  V84 — IRD attachments built from a business account (one Y/A)
//
//  1. Statement of Accounts (RAMIS "Verification of attachment" item 4) — sole proprietor or partnership:
//     statement of profit or loss, statement of financial position (with the prior 31 March as comparative),
//     statement of changes in capital / partners' capital & appropriation, notes (basis, property, plant &
//     equipment movement). Unbranded, for uploading to RAMIS; optional signature block.
//
//  2. Statement of Partnership Income with Schedules (item 8) — laid out like the IRD forms
//     Asmt_PIT_001_E (Return of Income – Partnership) and Asmt_PIT_002_E (Schedules 01–07), Y/A 2025/26:
//     cages 10–130; Schedules 01, 02A, 02B, 03A, 03B, 03C, 04A, 04B, 05A, 05B, 06, 07.
//     Partnership tax (s.53(1A)): 0% on the first Rs. 1,000,000 and 6% on the balance (Schedule 04A).
// ═══════════════════════════════════════════════════════════════════════════
import { INCOME_TYPES, PARTNERSHIP_FREE, PARTNERSHIP_RATE, r2 } from './bizAccounts';

const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
export const m2 = (n) => { const v = r2(Number(n) || 0); const s = Math.abs(v).toLocaleString('en-LK', { minimumFractionDigits: 2, maximumFractionDigits: 2 }); return v < 0 ? `(${s})` : s; };
const yEnd = (y) => `31 March ${parseInt(y, 10) + 1}`;
const yPrev = (y) => `31 March ${parseInt(y, 10)}`;
const fullY = (y) => `${parseInt(y, 10)}/${parseInt(y, 10) + 1}`;

// Expense groups used by both the accounts and Schedule 07 (cages 249–252)
export const EXP_GROUP = {
  admin: { en: 'Administration & establishment expenses', cage: '249' },
  selling: { en: 'Selling & distribution expenses', cage: '250' },
  finance: { en: 'Finance expenses', cage: '251' },
  other: { en: 'Other expenses', cage: '252' },
};
const GROUP_OF = {
  salaries: 'admin', epf: 'admin', rent: 'admin', utilities: 'admin', telephone: 'admin', repairs: 'admin', stationery: 'admin', insurance: 'admin',
  prof: 'admin', licences: 'admin', welfare: 'admin', depreciation: 'admin', partnerpay: 'admin', travel: 'admin', vehicle: 'admin',
  advert: 'selling', transport: 'selling', entertainment: 'selling',
  bank: 'finance', interest: 'finance',
};
export const expenseGroup = (x) => GROUP_OF[x.key] || 'other';
export function groupedExpenses(c) {
  const g = { admin: [], selling: [], finance: [], other: [] };
  for (const x of c.expenses) if (x.amount) g[expenseGroup(x)].push(x);
  const tot = Object.fromEntries(Object.entries(g).map(([k, l]) => [k, r2(l.reduce((s, x) => s + x.amount, 0))]));
  return { g, tot };
}

const CSS = `<style>*{box-sizing:border-box}body{font:11.5px/1.45 Arial,Helvetica,sans-serif;margin:22px;color:#111}
h1{font-size:16px;margin:0 0 2px;text-transform:uppercase;letter-spacing:.3px}h2{font-size:13px;margin:18px 0 6px;padding-bottom:3px;border-bottom:1.5px solid #111;text-transform:uppercase}
h3{font-size:12px;margin:12px 0 4px}.sub{color:#374151}.s{color:#6b7280;font-size:10.5px}
table{border-collapse:collapse;width:100%;margin:4px 0}td,th{padding:3px 6px;text-align:left;vertical-align:top}th{font-size:10.5px;border-bottom:1px solid #111}
.r{text-align:right;white-space:nowrap;font-variant-numeric:tabular-nums}.w{width:130px}.in{padding-left:18px}.in2{padding-left:32px}
.u td.r{border-bottom:1px solid #111}.dbl td.r{border-top:1px solid #111;border-bottom:3px double #111;font-weight:700}.b td{font-weight:700}
.grid td,.grid th{border:1px solid #9ca3af}.wide td,.wide th{font-size:9.5px;padding:3px 4px}.wide td:first-child{min-width:90px}.grid th.r{white-space:normal}.grid th{background:#f3f4f6;border-bottom:1px solid #9ca3af}.cg{font-size:9.5px;color:#374151;font-weight:700}
.cage{display:grid;grid-template-columns:1fr 54px 160px;align-items:center;margin:2px 0}.cage .l{padding-right:8px;text-align:right}.cage .n{border:1px solid #6b7280;border-right:0;padding:4px;font-size:10px;font-weight:700;text-align:center;background:#f9fafb}
.cage .v{border:1px solid #6b7280;padding:4px 8px;text-align:right;font-weight:700;font-variant-numeric:tabular-nums}.cage.t .l{font-weight:700}
.hd{text-align:center;margin-bottom:10px}.box{border:1px solid #9ca3af;padding:8px 10px;margin:8px 0}.warn{border:1px solid #f59e0b;background:#fffbeb;color:#92400e;padding:6px 8px;margin:6px 0}
.sig{display:grid;grid-template-columns:repeat(auto-fill,minmax(200px,1fr));gap:26px 30px;margin-top:34px}.sig div{border-top:1px solid #111;padding-top:4px;font-size:10.5px}
.pb{break-before:page}.np{text-align:right;margin-bottom:8px}.np button{background:#12294A;color:#fff;border:0;border-radius:6px;padding:8px 18px;font-weight:700;cursor:pointer}
@media print{.np{display:none}body{margin:0}}@page{size:A4;margin:13mm}</style>`;
const toolbar = (on) => (on ? '<div class="np"><button onclick="window.print()">Print / Save as PDF</button></div>' : '');
const sigBlock = (names, date = true) => `<div class="sig">${names.map((n) => `<div>${esc(n)}</div>`).join('')}${date ? '<div>Date</div>' : ''}</div>`;

// ─── 1. Statement of Accounts ─────────────────────────────
export function buildAccountsHtml(acc, c, client = {}, { sign = true, withToolbar = true } = {}) {
  const part = c.kind === 'partnership';
  const b = c.bs;
  const Y = acc.year;
  const row = (l, v, cls = '', w = '') => `<tr class="${cls}"><td class="${w}">${l}</td><td class="r w">${v === '' ? '' : m2(v)}</td></tr>`;
  const row2 = (l, a, z, cls = '', w = '') => `<tr class="${cls}"><td class="${w}">${l}</td><td class="r w">${a === '' ? '' : m2(a)}</td><td class="r w">${z === '' ? '' : m2(z)}</td></tr>`;
  const { g, tot } = groupedExpenses(c);
  const bizInc = c.income.filter((x) => x.type === 'business' && x.amount);
  const otherInc = c.income.filter((x) => x.type !== 'business' && x.amount);
  const owner = part ? c.partners?.map((p) => p.name).filter(Boolean) : [client.full_name].filter(Boolean);

  // Statement of profit or loss
  const pl = `<table><tr><th></th><th class="r w">Rs.</th><th class="r w">Rs.</th></tr>
    ${row2('<b>Revenue</b>', '', '')}${bizInc.map((x) => row2(esc(x.label), x.amount, '', '', 'in')).join('') || row2('Sales / turnover', 0, '', '', 'in')}
    ${row2('Total revenue', '', c.turnover, 'b u')}
    ${row2('<b>Less: cost of sales</b>', '', '')}${row2('Opening stock', c.opening, '', '', 'in')}${c.cos.filter((x) => x.amount).map((x) => row2(esc(x.label), x.amount, '', '', 'in')).join('')}
    ${row2('Less: closing stock', -c.closing, '', 'u', 'in')}${row2('Cost of sales', '', -c.cogs, 'u')}
    ${row2('GROSS PROFIT', '', c.grossProfit, 'b')}
    ${otherInc.length ? row2('<b>Add: other income</b>', '', '') + otherInc.map((x) => row2(`${esc(x.label)} <span class="s">— ${esc(INCOME_TYPES[x.type]?.short || '')}</span>`, x.amount, '', '', 'in')).join('') + row2('', '', c.nonBiz, 'u') : ''}
    ${Object.entries(g).filter(([, l]) => l.length).map(([k, l]) => row2(`<b>Less: ${EXP_GROUP[k].en.toLowerCase()}</b>`, '', '') + l.map((x) => row2(esc(x.label), x.amount, '', '', 'in')).join('') + row2('', '', -tot[k], 'u')).join('')}
    ${row2(c.netProfit >= 0 ? 'NET PROFIT FOR THE YEAR' : 'NET LOSS FOR THE YEAR', '', c.netProfit, 'dbl')}</table>`;

  // Statement of financial position (31 March this year, comparative 31 March last year)
  const ca = (s) => [['Inventories (stock)', s.stock], ['Trade receivables', s.receivables], ['Due from related parties', s.related_recv], ['Deposits, advances & prepayments', s.other_ca], ['Cash at bank', s.bank], ['Cash in hand', s.cash]];
  const cl = (s) => [['Trade payables', s.payables], ['Payable to related parties', s.related_pay], ['Accrued expenses & other payables', s.accruals], ['Bank overdraft', s.overdraft]];
  const caRows = ca(b.close).map(([l, v], k) => [l, v, ca(b.open)[k][1]]).filter(([, v, o]) => v || o);
  const clRows = cl(b.close).map(([l, v], k) => [l, v, cl(b.open)[k][1]]).filter(([, v, o]) => v || o);
  const diff = b.diff, openDiff = b.openDiff;
  const capClose = r2(b.capClose + diff), capOpen = r2(b.capOpen + openDiff);       // balancing figure shown separately below
  const sofp = `<table><tr><th></th><th class="r w">${yEnd(Y)}<br>Rs.</th><th class="r w">${yPrev(Y)}<br>Rs.</th></tr>
    ${row2('<b>ASSETS</b>', '', '')}${row2('<b>Non-current assets</b>', '', '')}${row2('Property, plant & equipment (Note 2)', b.fa.nbvClose, b.fa.nbvOpen, '', 'in')}
    ${row2('<b>Current assets</b>', '', '')}${caRows.map(([l, v, o]) => row2(l, v, o, '', 'in')).join('') || row2('—', 0, 0, '', 'in')}
    ${row2('', b.close.ca, b.open.ca, 'u')}${row2('TOTAL ASSETS', b.close.assets, b.open.assets, 'dbl')}
    ${row2(`<b>${part ? "PARTNERS' CAPITAL" : "OWNER'S CAPITAL"} & LIABILITIES</b>`, '', '')}
    ${row2(part ? "Partners' capital accounts (Note 3)" : 'Capital account (Note 3)', b.capClose, b.capOpen, '', 'in')}
    ${Math.abs(diff) >= 0.5 || Math.abs(openDiff) >= 0.5 ? row2('Difference to be reconciled', diff, openDiff, '', 'in') : ''}
    ${row2('', capClose, capOpen, 'u')}
    ${b.close.loans || b.open.loans ? row2('<b>Non-current liabilities</b>', '', '') + row2('Bank loans & leases', b.close.loans, b.open.loans, '', 'in') : ''}
    ${row2('<b>Current liabilities</b>', '', '')}${clRows.map(([l, v, o]) => row2(l, v, o, '', 'in')).join('') || row2('—', 0, 0, '', 'in')}
    ${row2('', b.close.cl, b.open.cl, 'u')}
    ${row2('TOTAL CAPITAL & LIABILITIES', r2(capClose + b.close.liabs), r2(capOpen + b.open.liabs), 'dbl')}</table>
    ${Math.abs(diff) >= 0.5 || Math.abs(openDiff) >= 0.5 ? `<div class="warn">The figures given do not fully reconcile — the difference of Rs. ${m2(diff)} is shown separately and is to be explained by the ${part ? 'partners' : 'proprietor'}.</div>` : ''}`;

  // Capital
  const cap = part
    ? `<table class="grid"><tr><th>Partner</th><th class="r">Ratio</th><th class="r">Capital b/f</th><th class="r">Introduced</th><th class="r">Salary</th><th class="r">Interest on capital</th><th class="r">Share of balance</th><th class="r">Drawings</th><th class="r">Capital c/f</th></tr>
      ${b.partners.map((p) => `<tr><td>${esc(p.name)}</td><td class="r">${p.share}%</td><td class="r">${m2(p.capOpen)}</td><td class="r">${m2(p.capIn)}</td><td class="r">${m2(p.salary)}</td><td class="r">${m2(p.interest)}</td><td class="r">${m2(p.residual)}</td><td class="r">(${m2(p.drawings)})</td><td class="r">${m2(p.capClose)}</td></tr>`).join('')}
      <tr class="b"><td colspan="2">Total</td><td class="r">${m2(b.capOpen)}</td><td class="r">${m2(b.capIn)}</td><td class="r">${m2(b.partners.reduce((s, p) => s + p.salary, 0))}</td><td class="r">${m2(b.partners.reduce((s, p) => s + p.interest, 0))}</td><td class="r">${m2(b.residual)}</td><td class="r">(${m2(b.drawings)})</td><td class="r">${m2(b.capClose)}</td></tr></table>
      <h3>Appropriation of profit</h3><table>${row('Net profit per the statement of profit or loss', c.netProfit, '')}${b.charged ? row("Add: partners' salaries & interest charged as expenses", b.charged, 'u') : ''}${row('Profit available for appropriation', b.available, 'b')}
      ${row("Less: partners' salaries & interest on capital", -b.pays, 'u')}${row('Balance shared in the profit-sharing ratio', b.residual, 'dbl')}</table>`
    : `<table>${row(`Capital as at ${yPrev(Y)}`, b.capOpen)}${b.capIn ? row('Add: capital introduced', b.capIn) : ''}${row(`Add: net ${c.netProfit >= 0 ? 'profit' : 'loss'} for the year`, c.netProfit)}${row('Less: drawings', -b.drawings, 'u')}${row(`Capital as at ${yEnd(Y)}`, b.capClose, 'dbl')}</table>`;

  const fa = b.fa;
  const ppe = `<table class="grid"><tr><th></th><th class="r">Rs.</th></tr>
    <tr><td><b>Cost</b> — as at ${yPrev(Y)}</td><td class="r">${m2(fa.costOpen)}</td></tr><tr><td class="in">Additions during the year</td><td class="r">${m2(fa.additions)}</td></tr><tr><td class="in">Disposals during the year</td><td class="r">(${m2(fa.disposalsCost)})</td></tr>
    <tr class="b"><td>Cost as at ${yEnd(Y)}</td><td class="r">${m2(fa.costClose)}</td></tr>
    <tr><td><b>Accumulated depreciation</b> — as at ${yPrev(Y)}</td><td class="r">${m2(fa.accOpen)}</td></tr><tr><td class="in">Charge for the year</td><td class="r">${m2(fa.charge)}</td></tr><tr><td class="in">On disposals</td><td class="r">(${m2(fa.accDisposals)})</td></tr>
    <tr class="b"><td>Accumulated depreciation as at ${yEnd(Y)}</td><td class="r">${m2(fa.accClose)}</td></tr>
    <tr class="b"><td>Net book value as at ${yEnd(Y)}</td><td class="r">${m2(fa.nbvClose)}</td></tr><tr><td>Net book value as at ${yPrev(Y)}</td><td class="r">${m2(fa.nbvOpen)}</td></tr></table>
    ${fa.rows.length ? `<table class="grid"><tr><th>Asset</th><th>Date acquired</th><th class="r">Cost (Rs.)</th><th class="r">Depreciation rate</th><th>Note</th></tr>${fa.rows.map((x) => `<tr><td>${esc(x.item)}</td><td>${esc(x.date)}</td><td class="r">${m2(x.cost)}</td><td class="r">${x.depRate ? `${x.depRate}%` : '—'}</td><td>${x.isNew ? 'Acquired during the year' : ''}${x.isSold ? 'Disposed of during the year' : ''}</td></tr>`).join('')}</table>` : ''}`;

  const title = `${part ? 'Partnership' : 'Sole proprietorship'} — financial statements for the year ended ${yEnd(Y)}`;
  return `<!doctype html><html><head><meta charset="utf-8"><title>Statement_of_Accounts_${esc(fullY(Y).replace('/', '-'))}_${esc((acc.name || '').replace(/\s+/g, '_'))}</title>${CSS}</head><body>${toolbar(withToolbar)}
<div class="hd"><h1>${esc(acc.name)}</h1><div class="sub">${esc(title)}</div>
<div class="s">${acc.tin ? `TIN ${esc(acc.tin)} · ` : ''}${!part && client.full_name ? `Proprietor: ${esc(client.full_name)}${client.tin ? ` (TIN ${esc(client.tin)})` : ''} · ` : ''}Year of assessment ${esc(fullY(Y))}</div></div>
<h2>Statement of profit or loss for the year ended ${yEnd(Y)}</h2>${pl}
<h2>Statement of financial position as at ${yEnd(Y)}</h2>${sofp}
<h2>Notes to the financial statements</h2>
<h3>1. Basis of preparation</h3><p>These financial statements have been prepared on the historical cost basis from the books and records maintained by the ${part ? 'partnership' : 'proprietor'}, in Sri Lanka Rupees. Inventories are valued at the lower of cost and net realisable value. Property, plant and equipment are stated at cost less accumulated depreciation (straight-line).</p>
<h3>2. Property, plant & equipment</h3>${ppe}
<h3>3. ${part ? "Partners' capital accounts" : 'Capital account'}</h3>${cap}
${sign ? `<p style="margin-top:26px">${part ? 'We, the partners,' : 'I'} certify that these financial statements are true and correct to the best of ${part ? 'our' : 'my'} knowledge and belief.</p>${sigBlock(part ? (owner.length ? owner.map((n) => `${n} — Partner`) : ['Partner', 'Partner']) : [`${owner[0] || 'Proprietor'} — Proprietor`])}` : ''}
</body></html>`;
}

// ─── 2. Statement of Partnership Income with Schedules (Asmt_PIT_001_E / 002_E) ───
export function pitFigures(c) {
  const ps = c.partners || [];
  const shareSum = ps.reduce((s, p) => s + (Number(p.share) || 0), 0);
  const split = (total) => {                                  // by profit ratio; last partner takes the cents
    const out = ps.map((p) => r2(shareSum ? total * (Number(p.share) || 0) / shareSum : 0));
    if (out.length) out[out.length - 1] = r2(out[out.length - 1] + r2(total - out.reduce((s, v) => s + v, 0)));
    return out;
  };
  const exempt = c.exemptIncome || 0;
  const credits = r2((c.ait || 0) + (c.wht || 0));
  const instSplit = split(c.inst || 0), qpSplit = split(c.qp || 0), exSplit = split(exempt);
  const rows = ps.map((p, i) => {
    const c205 = r2(p.salary), c206 = r2(p.interest), c208 = r2(p.biz), c207 = r2(c208 - c205 - c206), c209 = r2(p.invTotal), c210 = 0, c212 = 0;
    return { ...p, c205, c206, c207, c208, c209, c210, c211: r2(c208 + c209 + c210), c212, c213: exSplit[i], c239: instSplit[i], c240: 0, c241: qpSplit[i], c242: r2(p.ait) };
  });
  const T = (k) => r2(rows.reduce((s, x) => s + x[k], 0));
  const first = r2(Math.min(c.taxable || 0, PARTNERSHIP_FREE)), bal = r2(Math.max(0, (c.taxable || 0) - PARTNERSHIP_FREE));
  const f = {
    rows, T,
    c10: T('c208'), c20: T('c209'), c30: 0, c40: 0,
    c60: r2(c.qp || 0),
    c230_1: first, c231_1: bal, c231_3: r2(bal * PARTNERSHIP_RATE), c233_3: 0,
    c234: 0, c235: 0, c236: credits, c237: r2(c.inst || 0),
    c130: r2(exempt),
  };
  f.c50 = r2(f.c10 + f.c20 + f.c30 + f.c40);
  f.c70 = r2(Math.max(0, f.c50 - f.c60));
  f.c229 = f.c70; f.c232_3 = r2(f.c231_3); f.c80 = f.c232_3; f.c90 = f.c233_3; f.c100 = r2(f.c80 + f.c90);
  f.c238 = r2(f.c234 + f.c235 + f.c236 + f.c237); f.c110 = f.c238;
  f.c120 = r2(Math.max(0, f.c100 - f.c110)); f.excess = r2(Math.max(0, f.c110 - f.c100));
  const { tot } = groupedExpenses(c);
  f.c246 = r2(c.turnover); f.c247 = 0; f.c248 = r2(f.c246 + f.c247);
  f.c249 = tot.admin; f.c250 = tot.selling; f.c251 = tot.finance; f.c252 = r2(tot.other + c.cogs); f.c253 = r2(c.netProfit);
  f.otherIncome = r2(c.nonBiz); f.cogs = r2(c.cogs);
  // checks against the computation
  f.checks = [];
  if (Math.abs(f.c50 - (c.assessable || 0)) > 0.5) f.checks.push(`Assessable income ${m2(f.c50)} differs from the computation ${m2(c.assessable)}.`);
  if (Math.abs(f.c80 - (c.tax || 0)) > 0.5) f.checks.push(`Tax ${m2(f.c80)} differs from the computation ${m2(c.tax)}.`);
  return f;
}

export function buildPitHtml(acc, c, { sign = true, withToolbar = true, office = {} } = {}) {
  const f = pitFigures(c);
  const Y = acc.year, b = c.bs;
  const cage = (no, l, v, t) => `<div class="cage${t ? ' t' : ''}"><div class="l">${l}</div><div class="n">${no}</div><div class="v">${m2(v)}</div></div>`;
  const letters = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';
  const pr = f.rows;
  // cols: [label, cage, 'l' = left-aligned text column]; amounts are right-aligned
  let al = [];
  const head = (cols) => { al = cols.map(([, , a], i) => (i === 0 || a === 'l' ? '' : 'r')); return `<tr>${cols.map(([l, cg], i) => `<th class="${al[i]}">${l}${cg ? `<div class="cg">${cg}</div>` : ''}</th>`).join('')}</tr>`; };
  const tr = (cells, cls = '') => `<tr class="${cls}">${cells.map((x, i) => `<td class="${al[i] ?? (i ? 'r' : '')}">${x}</td>`).join('')}</tr>`;
  const prow = (fn) => pr.map((p, i) => fn(p, letters[i] || i + 1)).join('');
  const sigNames = (c.partners || []).map((p) => p.name).filter(Boolean);
  const aitRows = (office.aitRows || []).filter((x) => Number(String(x.ait ?? '').replace(/,/g, '')));

  return `<!doctype html><html><head><meta charset="utf-8"><title>PIT_${esc(fullY(Y).replace('/', '-'))}_${esc((acc.name || '').replace(/\s+/g, '_'))}</title>${CSS}</head><body>${toolbar(withToolbar)}
<div class="hd"><h1>Statement of Partnership Income</h1><div class="sub">Return of Income — Partnership · Year of assessment ${esc(fullY(Y))} (1 April ${parseInt(Y, 10)} – ${yEnd(Y)})</div>
<div class="s">Laid out as IRD forms Asmt_PIT_001_E and Asmt_PIT_002_E · Inland Revenue Act No. 24 of 2017 (as amended)</div></div>
<div class="box"><b>Name of the partnership:</b> ${esc(acc.name)} &nbsp; · &nbsp; <b>TIN:</b> ${esc(acc.tin || '—')}${acc.activity_code ? ` &nbsp; · &nbsp; <b>Activity code:</b> ${esc(acc.activity_code)}` : ''} &nbsp; · &nbsp; <b>Status:</b> Resident</div>
${f.checks.length ? `<div class="warn">${f.checks.map(esc).join('<br>')}</div>` : ''}

<h2>Section 01 — Part A: Income liable to tax</h2>
${cage(10, 'Business income (Cage 208.5 of Schedule 2A)', f.c10)}${cage(20, 'Investment income (other than gain from realization of investment assets) (Cage 209.5 of Schedule 2A)', f.c20)}
${cage(30, 'Other income (Cage 210.5 of Schedule 2A)', f.c30)}${cage(40, 'Gains from realization of investment assets (Cage 212.5 of Schedule 2A)', f.c40)}${cage(50, 'ASSESSABLE INCOME (10+20+30+40)', f.c50, 1)}
<h2>Part B: Deductions from assessable income</h2>${cage(60, 'Qualifying payments', f.c60)}${cage(70, 'TAXABLE INCOME (50 − 60)', f.c70, 1)}
<h2>Part C: Calculation of tax payable</h2>
${cage(80, 'Tax on partnership income (Cage 232.3 of Schedule 4A)', f.c80)}${cage(90, 'Tax on gain from realization of investment assets (Cage 233.3 of Schedule 4A)', f.c90)}
${cage(100, 'Total tax payable (80 + 90)', f.c100, 1)}${cage(110, 'Less: tax credits (Cage 238 of Schedule 4B)', f.c110)}${cage(120, 'Balance tax payable (if 100 > 110, then 100 − 110)', f.c120, 1)}
${f.excess ? `<p class="s">Tax credits exceed the tax payable by Rs. ${m2(f.excess)}.</p>` : ''}
<h2>Part D: Exempt income</h2>${cage(130, 'Total exempt income (Cage 213.5 of Schedule 2B)', f.c130)}

<h2 class="pb">Schedule 01 — Details of partners and share of profit</h2>
<table class="grid">${head([['Partner'], ['Name of the partner', '201', 'l'], ['TIN', '202', 'l'], ['NIC No.', '203', 'l'], ['Profit ratio', '204']])}
${prow((p, L) => `<tr><td>${L}</td><td>${esc(p.name)}</td><td>${esc(p.tin)}</td><td>${esc(p.nic)}</td><td class="r">${p.share}%</td></tr>`)}</table>

<h2>Schedule 02A — Distribution of partnership income and gain from realization of investment assets (CG)</h2>
<table class="grid wide">${head([['Partner'], ['Salaries / wages / fees for services to partners', '205'], ['Interest on capital / loan balance', '206'], ['Income from business', '207'], ['Business income (205+206+207)', '208'], ['Investment income', '209'], ['Other income', '210'], ['Total partnership income (208+209+210)', '211'], ['Gain on realization of investment assets', '212']])}
${prow((p, L) => tr([`${L}. ${esc(p.name)}`, m2(p.c205), m2(p.c206), m2(p.c207), m2(p.c208), m2(p.c209), m2(p.c210), m2(p.c211), m2(p.c212)]))}
${tr(['Total (.5)', m2(f.T('c205')), m2(f.T('c206')), m2(f.T('c207')), m2(f.T('c208')), m2(f.T('c209')), m2(f.T('c210')), m2(f.T('c211')), m2(f.T('c212'))], 'b')}</table>
<p class="s">208.5 → cage 10 · 209.5 → cage 20 · 210.5 → cage 30 · 212.5 → cage 40. Salaries and interest are allocated to the partner concerned first; the balance by the profit ratio (s.53, s.55).</p>

<h2>Schedule 02B — Distribution of partnership exempt amounts</h2>
<table class="grid">${head([['Partner'], ['Exempt amount (Rs.)', '213'], ['Description of exempted income', '213 A', 'l']])}
${prow((p, L) => tr([`${L}. ${esc(p.name)}`, m2(p.c213), p.c213 ? 'Dividends / exempt income' : '']))}${tr(['Total (.5) → cage 130', m2(f.c130), ''], 'b')}</table>

<h2>Schedule 03A — Details of capital gains tax payment</h2>
<table class="grid">${head([['S/N'], ['Date of realization of capital gains income', '214', 'l'], ['Date of payment', '215', 'l'], ['Capital gain tax (Rs.)', '216']])}${tr(['—', '', '', m2(0)])}${tr(['Total (216.5) → cage 235', '', '', m2(0)], 'b')}</table>

<h2>Schedule 03B — Details of advance income tax deducted by the agent</h2>
<table class="grid">${head([['S/N'], ['Source / type of income', '217', 'l'], ['TIN of WHT agent', '218', 'l'], ['Certificate No.', '219', 'l'], ['Date of payment', '220', 'l'], ['Amount of income received (Rs.)', '221'], ['AIT paid by WHT agent (Rs.)', '222']])}
${aitRows.length ? aitRows.map((x, i) => tr([i + 1, esc(x.source), esc(x.agentTin), esc(x.cert), esc(x.date), m2(Number(String(x.amount ?? '').replace(/,/g, '')) || 0), m2(Number(String(x.ait ?? '').replace(/,/g, '')) || 0)])).join('')
    : f.c236 ? tr([1, 'AIT / WHT deducted (per certificates attached)', '', '', '', '', m2(f.c236)]) : tr(['—', '', '', '', '', '', m2(0)])}
${tr(['Total (222.5) → cage 236', '', '', '', '', '', m2(f.c236)], 'b')}</table>

<h2>Schedule 03C — Self-assessed tax payment details (other than capital gains tax)</h2>
<table class="grid">${head([['Payment', ''], ['Date of payment', '.1', 'l'], ['Amount (Rs.)', '.2']])}
${[['1st instalment', 223], ['2nd instalment', 224], ['3rd instalment', 225], ['4th instalment', 226], ['Final payment', 227]].map(([l, cg]) => tr([`${l} <span class="cg">${cg}</span>`, '', ''])).join('')}
${tr(['Total instalment payment <span class="cg">228</span> → cage 237', '', m2(f.c237)], 'b')}</table>

<h2>Schedule 04A — Calculation of tax liability</h2>
<table class="grid">${head([['', ''], ['Income (Rs.)', '.1'], ['Rate', '.2'], ['Tax (Rs.)', '.3']])}
${tr(['Partnership taxable income <span class="cg">229</span>', m2(f.c229), '', ''])}
${tr(['First Rs. 1,000,000 <span class="cg">230</span>', m2(f.c230_1), '0%', m2(0)])}${tr(['Balance <span class="cg">231</span>', m2(f.c231_1), '6%', m2(f.c231_3)])}
${tr(['Tax on partnership income (230.3 + 231.3) <span class="cg">232</span> → cage 80', '', '', m2(f.c232_3)], 'b')}
${tr(['Tax on gain on realization of investment assets <span class="cg">233</span> → cage 90', m2(0), '10%', m2(0)])}</table>

<h2>Schedule 04B — Tax credit</h2>
${cage(234, 'Foreign tax credit', f.c234)}${cage(235, 'Tax paid on realization of investment assets (216.5)', f.c235)}${cage(236, 'Advance income tax (222.5)', f.c236)}${cage(237, 'Instalment payments (228.2)', f.c237)}${cage(238, 'TOTAL TAX CREDITS (234 to 237) → cage 110', f.c238, 1)}

<h2>Schedule 05A — Allocation of self-assessed tax payments and capital gains tax</h2>
<table class="grid">${head([['Partner'], ['Self-assessed tax (Rs.)', '239'], ['Capital gains tax (Rs.)', '240']])}${prow((p, L) => tr([`${L}. ${esc(p.name)}`, m2(p.c239), m2(p.c240)]))}${tr(['TOTAL (239.5 = 228.2 · 240.5 = 216.5)', m2(f.T('c239')), m2(f.T('c240'))], 'b')}</table>

<h2>Schedule 05B — Allocation of qualifying payments and advance income tax (AIT)</h2>
<table class="grid">${head([['Partner'], ['Qualifying payments (Rs.)', '241'], ['Advance income tax (Rs.)', '242']])}${prow((p, L) => tr([`${L}. ${esc(p.name)}`, m2(p.c241), m2(p.c242)]))}${tr(['TOTAL (242.5 = 222.5)', m2(f.T('c241')), m2(f.T('c242'))], 'b')}</table>
<p class="s">Each partner's share of the partnership tax (cage 906 of the partner's own return): ${pr.map((p) => `${esc(p.name)} Rs. ${m2(p.tax)}`).join(' · ')}.</p>

<h2>Schedule 06 — Details of partnership loss adjustment</h2>
<table class="grid">${head([['', ''], ['Y/A', '.1', 'l'], ['Loss (Rs.)', '.2'], ['Business income', '.3'], ['Investment income', '.4'], ['Capital gain', '.5'], ['Exempt income', '.6'], ['Total deduction', '.7']])}
${tr(['Business losses <span class="cg">243</span>', c.lossBF ? 'Brought forward' : esc(fullY(Y)), m2(c.lossBF || 0), m2(c.lossUsed || 0), m2(0), m2(0), m2(0), m2(c.lossUsed || 0)])}
${tr(['Investment losses <span class="cg">244</span>', esc(fullY(Y)), m2(0), m2(0), m2(0), m2(0), m2(0), m2(0)])}${tr(['Exempt losses <span class="cg">245</span>', esc(fullY(Y)), m2(0), m2(0), m2(0), m2(0), m2(0), m2(0)])}</table>
${c.lossCF ? `<p class="s">Business loss carried forward to the next year: Rs. ${m2(c.lossCF)}.</p>` : ''}

<h2>Schedule 07 — Details of partnership business</h2>
${cage(246, 'Business turnover — liable', f.c246)}${cage(247, 'Business turnover — exempt', f.c247)}${cage(248, 'TOTAL TURNOVER (246 + 247)', f.c248, 1)}
${cage(249, 'Administration & establishment expenses', f.c249)}${cage(250, 'Selling & distribution expenses', f.c250)}${cage(251, 'Finance expenses', f.c251)}${cage(252, `Other expenses${f.cogs ? ` (incl. cost of sales Rs. ${m2(f.cogs)})` : ''}`, f.c252)}
${cage(253, 'NET PROFIT / COMPREHENSIVE INCOME', f.c253, 1)}
${f.otherIncome ? `<p class="s">Net profit includes other income of Rs. ${m2(f.otherIncome)} (interest, rent, dividends, profit on sale of assets) shown in the statement of accounts.</p>` : ''}
<table class="grid">${head([['', ''], [`As at ${yPrev(Y)}`, '.1'], [`As at ${yEnd(Y)}`, '.2']])}
${[['Stock in trade', 254, 'stockTrade'], ['Raw materials', 255, 'raw'], ['Work in progress', 256, 'wip'], ['Trade receivables', 257, 'receivables'], ['Due from related parties', 258, 'related_recv'], ['Trade payables', 259, 'payables'], ['Payable to related parties', 260, 'related_pay']]
    .map(([l, cg, k]) => tr([`${l} <span class="cg">${cg}</span>`, m2(b.open[k]), m2(b.close[k])])).join('')}</table>

<h2>Section 02 — Declaration</h2>
<p>Whether the return or part of the return is prepared by an approved accountant or any other person for a payment? ☐ Yes ☐ No</p>
<div class="box">I declare to the best of my knowledge and belief that all particulars furnished in this Return of Income are true, correct and complete. I am aware that making an incorrect, false or misleading statement is an offence.</div>
${sign ? sigBlock([`Full name of the declarant${sigNames[0] ? `: ${sigNames[0]}` : ''}`, 'Designation: Precedent partner', 'NIC / Passport No.', 'Signature']) : ''}
<p class="s" style="margin-top:14px">Attach: financial statements (statement of accounts), tax computation and AIT / WHT certificates. RAMIS (ird.gov.lk e-Services) is the final authority — key these figures into the partnership return there.</p>
</body></html>`;
}

/** Open any generated document in a new window. */
export function openHtml(html, win = null) {
  const w = win || window.open('', '_blank');
  if (!w) return false;
  w.document.open(); w.document.write(html); w.document.close();
  return true;
}
