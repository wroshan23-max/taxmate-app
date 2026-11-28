// V76 — printable "Computation of income from business" (sole proprietor / partnership) for one Y/A
import { FIRM } from './firm';
import { INCOME_TYPES } from './bizAccounts';

const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const m = (n) => { const v = Math.round((Number(n) || 0) * 100) / 100; const s = Math.abs(v).toLocaleString('en-LK', { minimumFractionDigits: 2, maximumFractionDigits: 2 }); return v < 0 ? `(${s})` : s; };

export function buildBizStatementHtml(acc, c, client = {}, { status, clean = false, sign = true, withToolbar = true } = {}) {
  const S = parseInt(acc.year, 10);
  const row = (l, v, cls = '') => `<tr class="${cls}"><td>${l}</td><td class="r">${v === '' ? '' : m(v)}</td></tr>`;
  const row2 = (l, v, w, cls = '') => `<tr class="${cls}"><td>${l}</td><td class="r">${v === '' ? '' : m(v)}</td><td class="r">${w === '' ? '' : m(w)}</td></tr>`;
  const part = c.kind === 'partnership';

  const incomeRows = c.income.filter((x) => x.amount).map((x) => row2(`${esc(x.label)} <span class="s">— ${esc(INCOME_TYPES[x.type]?.short || x.type)}</span>`, x.amount, '')).join('');
  const pl = `<table>${row2('<b>Income</b>', '', '')}${incomeRows || row2('No income entered', 0, '')}
    ${row2('Total income', '', c.turnover + c.nonBiz, 't')}
    ${row2('<b>Less: cost of sales</b>', '', '')}${row2('Opening stock', c.opening, '')}${c.cos.filter((x) => x.amount).map((x) => row2(esc(x.label), x.amount, '')).join('')}${row2('Less: closing stock', -c.closing, '')}
    ${row2('Cost of sales', '', -c.cogs, 't')}
    ${row2('<b>Less: expenses</b>', '', '')}${c.expenses.filter((x) => x.amount).map((x) => row2(esc(x.label), x.amount, '')).join('')}
    ${row2('Total expenses', '', -c.expTotal, 't')}
    ${row2('NET PROFIT / (LOSS) PER THE ACCOUNTS', '', c.netProfit, 'g')}</table>`;

  const adds = [...c.expenses, ...c.cos].filter((x) => x.disallowed).map((x) => row(`${esc(x.label)}${x.pct ? ` (${100 - x.pct}% not allowed)` : ''}${x.law ? ` <span class="s">— ${esc(x.law)}</span>` : x.remark ? ` <span class="s">— ${esc(x.remark)}</span>` : ''}`, x.disallowed)).join('')
    + c.addBacks.map((x) => row(esc(x.label || 'Other add-back'), x.amount)).join('')
    + (c.charges ? row('Balancing charges on assets sold (Fourth Schedule)', c.charges) : '');
  const lessInc = c.income.filter((x) => x.type !== 'business' && x.amount).map((x) => row(`${esc(x.label)} <span class="s">— ${esc(INCOME_TYPES[x.type]?.short || '')}${INCOME_TYPES[x.type]?.taxed === 'investment' ? ', taxed as investment income' : ', not business income'}</span>`, x.amount)).join('');
  const less = lessInc + (c.capAllow ? row('Capital allowances (s.16, Fourth Schedule — see schedule)', c.capAllow) : '') + (c.balAllow ? row('Balancing allowances on assets sold', c.balAllow) : '')
    + c.deducts.map((x) => row(esc(x.label || 'Other deduction'), x.amount)).join('');
  const adj = `<table>${row('Net profit / (loss) per the accounts', c.netProfit, 't')}
    ${row('<b>Add: expenses not allowed & other add-backs</b>', '')}${adds || row('— none', 0)}${row('Total added back', c.addTotal, 't')}
    ${row('<b>Less: income not part of business income & allowances</b>', '')}${less || row('— none', 0)}${row('Total deducted', c.lessTotal, 't')}
    ${row(c.adjusted >= 0 ? 'ADJUSTED BUSINESS INCOME (gains and profits from the business)' : 'ADJUSTED BUSINESS LOSS', c.adjusted, 'g')}</table>`;

  const ca = c.assets.length ? `<h2>Schedule — capital allowances (s.16, Fourth Schedule, straight line)</h2><table class="sm"><tr><th>Asset</th><th>Acquired</th><th class="r">Cost</th><th>Class</th><th class="r">Business %</th><th class="r">Basis</th><th class="r">Claimed before</th><th class="r">Allowance</th><th class="r">Bal. allow. / (charge)</th><th class="r">Tax WDV c/f</th><th>Note</th></tr>
    ${c.assets.map(({ a, r }) => `<tr><td>${esc(a.item)}</td><td>${esc(a.date)}</td><td class="r">${m(r.cost)}</td><td>${esc(r.cls.short)}${r.years ? ` · ${r.years} yrs` : ''}</td><td class="r">${r.pct ?? '—'}${r.pct !== null ? '%' : ''}</td><td class="r">${m(r.basis)}</td><td class="r">${m(r.prior)}</td><td class="r">${m(r.allowance)}</td><td class="r">${r.balancing ? m(r.balancing) : r.charge ? `(${m(r.charge)})` : ''}</td><td class="r">${m(r.wdv)}</td><td>${esc(r.note || r.issue)}</td></tr>`).join('')}
    <tr class="t"><td colspan="7">Total</td><td class="r">${m(c.capAllow)}</td><td class="r">${c.balAllow || c.charges ? m(c.balAllow - c.charges) : ''}</td><td></td><td></td></tr></table>
    ${c.bookDep ? `<p class="s">Depreciation in the accounts from the asset register (straight line, months held): Rs. ${m(c.bookDep)} — added back; the capital allowance above is claimed instead.</p>` : ''}` : '';

  let tail = '';
  if (part) {
    tail = `<h2>Partnership income tax — s.53(1A)</h2><table>
      ${row('Adjusted business income', Math.max(0, c.adjusted))}${c.lossUsed ? row('Less: business loss brought forward', -c.lossUsed) : ''}${row('Business income', c.bizIncome, 't')}
      ${c.investment.interest ? row('Interest income', c.investment.interest) : ''}${c.investment.rent ? row('Rent income', c.investment.rent) : ''}${c.investment.other ? row('Other investment income', c.investment.other) : ''}
      ${row('Assessable income', c.assessable, 't')}${c.qp ? row(`Less: qualifying payments (charity ${m(c.charityUsed)} — max 1/5 or Rs. 500,000; Government ${m(c.govt)})`, -c.qp) : ''}
      ${row('TAXABLE INCOME OF THE PARTNERSHIP', c.taxable, 'g')}
      ${row(`Tax: first Rs. 1,000,000 @ 0%; balance Rs. ${m(Math.max(0, c.taxable - 1_000_000))} @ 6%`, c.tax, 't')}
      ${c.ait ? row('Less: AIT deducted', -c.ait) : ''}${c.wht ? row('Less: WHT deducted', -c.wht) : ''}${c.inst ? row('Less: instalments paid', -c.inst) : ''}
      ${row(c.balance >= 0 ? 'Balance tax payable by the partnership' : 'Excess paid', c.balance, 'g')}
      ${c.lossCF ? row('Business loss carried forward', c.lossCF) : ''}</table>
      <h2>Partners' shares — s.55 (to each partner's own return)</h2><table class="sm"><tr><th>Partner</th><th>NIC / TIN</th><th class="r">Share %</th><th class="r">Salary + interest</th><th class="r">Business income share (Sch. 2, cage 209)</th><th class="r">Investment income share</th><th class="r">Partnership tax credit (cage 906)</th><th class="r">AIT credit (907)</th></tr>
      ${c.partners.map((p) => `<tr><td>${esc(p.name)}</td><td>${esc([p.nic, p.tin].filter(Boolean).join(' / '))}</td><td class="r">${p.share}%</td><td class="r">${m(p.salary + p.interest)}</td><td class="r">${m(p.biz)}</td><td class="r">${m(p.invTotal)}</td><td class="r">${m(p.tax)}</td><td class="r">${m(p.ait)}</td></tr>`).join('')}
      <tr class="t"><td colspan="4">Total</td><td class="r">${m(c.partners.reduce((s, p) => s + p.biz, 0))}</td><td class="r">${m(c.partners.reduce((s, p) => s + p.invTotal, 0))}</td><td class="r">${m(c.partners.reduce((s, p) => s + p.tax, 0))}</td><td class="r">${m(c.partners.reduce((s, p) => s + p.ait, 0))}</td></tr></table>
      <p class="s">Partnership tax is treated as paid by the partners — no refund; any part not used in a partner's return is carried forward (s.55(4)).</p>`;
  } else {
    tail = `<h2>To the individual income tax return — Schedule 2 (sole proprietorship)</h2><table>
      ${row('Gains and profits from the business (cage 201 → 204)', c.bizProfit, 'g')}${row('Turnover (cage 204A)', c.turnover)}
      ${c.loss ? row('Business loss for the year (carried forward)', c.loss) : ''}${c.lossBF ? row('Business loss brought forward (set off in the return)', c.lossBF) : ''}
      ${c.invTotal ? row('Investment income in the accounts — to Schedule 3 (interest / rent / other)', c.invTotal) : ''}</table>`;
  }

  // V84: clean = unbranded IRD attachment ("Tax computation"), optional signature block
  const strip = clean ? (status === 'final' ? '' : '<div class="st drf">DRAFT</div>') : status === 'final' ? '<div class="st fin">FINAL — computed by TaxMate</div>' : '<div class="st drf">DRAFT — figures may change</div>';
  const firm = clean ? '' : `<div style="text-align:right" class="s"><b style="color:#12294A;font-size:13px">${esc(FIRM.name)}</b><br>${esc(FIRM.phone)}<br>${esc(FIRM.email)}<br>${esc(FIRM.web)}</div>`;
  const signer = part ? (c.partners || []).map((p) => p.name).filter(Boolean) : [client.full_name || 'Proprietor'];
  const sigHtml = clean && sign ? `<div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(200px,1fr));gap:26px 30px;margin-top:34px">${[...signer.map((n) => `${esc(n)} — ${part ? 'Partner' : 'Proprietor'}`), 'Date'].map((x) => `<div style="border-top:1px solid #111;padding-top:4px;font-size:10.5px">${x}</div>`).join('')}</div>` : '';
  return `<!doctype html><html><head><meta charset="utf-8"><title>Business income ${esc(acc.year)} — ${esc(acc.name)}</title>
<style>*{box-sizing:border-box}body{font:12px/1.45 'Segoe UI',Arial,sans-serif;margin:24px;color:#1f2937}h1{font-size:18px;margin:0;color:#12294A}h2{font-size:13px;margin:18px 0 6px;color:#12294A;border-bottom:1.5px solid #12294A;padding-bottom:3px}
table{border-collapse:collapse;width:100%;margin-bottom:4px}td,th{border-bottom:1px solid #e5e7eb;padding:4px 6px;text-align:left;vertical-align:top}th{background:#f3f4f6;font-size:11px}.r{text-align:right;white-space:nowrap;font-variant-numeric:tabular-nums}
.t td{font-weight:700;background:#f9fafb}.g td{font-weight:800;background:#12294A;color:#fff}.s{color:#6b7280;font-size:10.5px}.sm td,.sm th{font-size:10.5px}
.hd{display:flex;justify-content:space-between;gap:12px;border-bottom:3px solid #C9A227;padding-bottom:10px;margin-bottom:10px}.st{display:inline-block;padding:3px 10px;border-radius:6px;font-weight:700;font-size:11px;margin:6px 0}.fin{background:#dcfce7;color:#166534}.drf{background:#fee2e2;color:#991b1b}
@media print{.np{display:none}body{margin:0}}@page{size:A4;margin:12mm}</style></head><body>
${withToolbar ? '' : '<!--'}<div class="np" style="text-align:right;margin-bottom:8px"><button onclick="window.print()" style="background:#12294A;color:#fff;border:0;border-radius:6px;padding:8px 18px;font-weight:700;cursor:pointer">Print / Save as PDF</button></div>${withToolbar ? '' : '-->'}
<div class="hd"><div><h1>Computation of income from business${part ? ' — partnership' : ''}</h1>
<div>${esc(acc.name)}${acc.tin ? ` · TIN ${esc(acc.tin)}` : ''}${!part && client.full_name ? ` · Proprietor: ${esc(client.full_name)}${client.tin ? ` (TIN ${esc(client.tin)})` : ''}` : ''}</div>
<div class="s">Year of assessment ${esc(acc.year)} — 1 April ${S} to 31 March ${S + 1} · Inland Revenue Act No. 24 of 2017 (as amended) · figures ${acc.mode === 'monthly' ? 'entered month by month' : 'entered as annual totals'}</div></div>
${firm}</div>${strip}
<h2>1. Income statement (as per the accounts)</h2>${pl}
<h2>2. Adjustments for income tax</h2>${adj}
${ca}${tail}
<p class="s" style="margin-top:14px">Not allowed: domestic / private expenses, income tax, penalties & fines, entertainment, provisions for losses not yet incurred (s.10). Depreciation is replaced by capital allowances (s.16). Interest and rent are investment income (s.7). ${clean ? '' : `Prepared by ${esc(FIRM.name)} from the figures given by the ${part ? 'partnership' : 'proprietor'}.`}</p>${sigHtml}
</body></html>`;
}

export function openBizStatement(acc, c, client, opts) {
  const win = window.open('', '_blank');
  if (!win) return false;
  win.document.write(buildBizStatementHtml(acc, c, client, opts));
  win.document.close();
  return true;
}
