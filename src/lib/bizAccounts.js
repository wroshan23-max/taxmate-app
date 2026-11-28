// ═══════════════════════════════════════════════════════════════════════════
//  V76 — Business income computation: sole proprietor & partnership (one Y/A)
//
//  Net profit per the accounts
//    + expenses not allowed            IRA 2017 s.10(1)(b): domestic / private (s.197), income tax, penalties
//                                       & fines, entertainment, provisions for losses not yet incurred,
//                                       donations (claimed as qualifying payments instead); depreciation
//                                       (replaced by capital allowances, s.16); partners' salaries & interest
//                                       (part of the partner's share, s.53(7))
//    + balancing charges                Fourth Schedule — sale price above written-down value
//    − income that is not business      interest / rent (investment income, s.7), dividends (final WHT),
//                                       profit on sale of fixed assets (balancing charge used instead)
//    − capital allowances               s.16 & Fourth Schedule — straight line: Class 1, 2, 3 = 5 years;
//                                       Class 4 buildings = 20 years; Class 5 intangibles = useful life;
//                                       full year in the year of acquisition, none in the year of disposal
//                                       (balancing allowance / charge); no allowance on road vehicles other
//                                       than commercial / goods vehicles; total never above cost (s.16(3A))
//    = gains and profits from the business (Schedule 2 of the return)
//
//  Partnership (s.53(1A), from 1 January 2020): the partnership pays income tax on its taxable income —
//  0% on the first Rs.1,000,000 and 6% on the balance (IRD SET guide, partnership example). Qualifying
//  payments: approved charities up to 1/5 of taxable income or Rs.500,000. Each partner includes his share
//  of the partnership income (s.55: salary & interest to that partner first, the rest by profit-sharing %)
//  and takes his share of the partnership tax as a credit — cage 906, no refund, unused part carried
//  forward (s.55(4)); AIT deducted from the partnership's income → cage 907.
// ═══════════════════════════════════════════════════════════════════════════
import { supabase } from './supabase';
import { amountNum } from './numParse';
import { CA_CLASSES, classOf, guessClass, assetAllowance, yaStartOf } from './bizWorking';

export { CA_CLASSES, classOf, guessClass };
const num = (v) => amountNum(v);   // V78: decimal comma safe
export const r2 = (n) => Math.round((Number(n) + Number.EPSILON) * 100) / 100;
const rid = () => Math.random().toString(36).slice(2, 10);
export const MONTHS = ['Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec', 'Jan', 'Feb', 'Mar'];

export const PARTNERSHIP_FREE = 1_000_000;
export const PARTNERSHIP_RATE = 0.06;

// ─── Line catalogue ──────────────────────────────────────
export const INCOME_TYPES = {
  business:  { en: 'Business income', short: 'Business', taxed: 'business' },
  interest:  { en: 'Interest — investment income (Schedule 3)', short: 'Interest', taxed: 'investment' },
  rent:      { en: 'Rent — investment income (Schedule 3)', short: 'Rent', taxed: 'investment' },
  other_inv: { en: 'Other investment income (Schedule 3)', short: 'Other investment', taxed: 'investment' },
  capital:   { en: 'Profit on sale of business assets — not taxed (balancing charge instead)', short: 'Asset sale profit', taxed: 'none' },
  exempt:    { en: 'Exempt / final WHT income (e.g. dividends)', short: 'Exempt / final WHT', taxed: 'none' },
};
export const INCOME_DEFAULTS = [
  { key: 'sales', en: 'Sales / turnover (fees received)', si: 'විකුණුම් / පිරිවැටුම', type: 'business' },
  { key: 'otherbiz', en: 'Other business income (commission, discounts received)', si: 'වෙනත් ව්‍යාපාරික ආදායම', type: 'business' },
  { key: 'interest', en: 'Interest income', si: 'පොලී ආදායම', type: 'interest' },
  { key: 'rent', en: 'Rent income', si: 'කුලී ආදායම', type: 'rent' },
  { key: 'assetsale', en: 'Profit on sale of fixed assets', si: 'ස්ථාවර වත්කම් විකිණීමේ ලාභය', type: 'capital' },
  { key: 'dividend', en: 'Dividends received', si: 'ලාභාංශ', type: 'exempt' },
];
export const COS_DEFAULTS = [
  { key: 'purchases', en: 'Purchases (goods for resale / raw materials)', si: 'මිලදී ගැනීම් (විකිණීමට / අමුද්‍රව්‍ය)' },
  { key: 'direct', en: 'Direct costs (carriage in, direct wages, sub-contract)', si: 'සෘජු පිරිවැය' },
];
// pct = default allowable %; law = why
export const EXPENSE_DEFAULTS = [
  { key: 'salaries', en: 'Salaries & wages', si: 'වැටුප් හා වේතන', pct: 100 },
  { key: 'epf', en: 'EPF / ETF (employer contribution)', si: 'EPF / ETF (සේවා යෝජක දායකත්වය)', pct: 100 },
  { key: 'rent', en: 'Rent & rates (business premises)', si: 'කුලිය හා වරිපනම්', pct: 100 },
  { key: 'utilities', en: 'Electricity & water', si: 'විදුලිය හා ජලය', pct: 100 },
  { key: 'telephone', en: 'Telephone & internet', si: 'දුරකථන හා අන්තර්ජාල', pct: 100 },
  { key: 'transport', en: 'Transport & delivery', si: 'ප්‍රවාහන හා බෙදාහැරීම', pct: 100 },
  { key: 'vehicle', en: 'Vehicle running — fuel, repairs, insurance', si: 'වාහන නඩත්තුව — ඉන්ධන, අලුත්වැඩියා', pct: 100, hint: 'Private use part is not allowed — TaxMate sets the business %.' },
  { key: 'repairs', en: 'Repairs & maintenance', si: 'අලුත්වැඩියා හා නඩත්තු', pct: 100, hint: 'Improvements: up to 20% of written-down value (5% for buildings) — s.14.' },
  { key: 'advert', en: 'Advertising & marketing', si: 'දැන්වීම් හා අලෙවිකරණය', pct: 100, law: 's.15A' },
  { key: 'stationery', en: 'Stationery, printing & postage', si: 'ලිපි ද්‍රව්‍ය හා මුද්‍රණ', pct: 100 },
  { key: 'bank', en: 'Bank charges', si: 'බැංකු ගාස්තු', pct: 100 },
  { key: 'interest', en: 'Loan / lease / overdraft interest', si: 'ණය / ලීසිං පොලිය', pct: 100, hint: 'Only on money used in the business (s.12).' },
  { key: 'insurance', en: 'Insurance (business)', si: 'රක්ෂණ (ව්‍යාපාරික)', pct: 100 },
  { key: 'prof', en: 'Accounting, audit & legal fees', si: 'ගිණුම් / විගණන / නීති ගාස්තු', pct: 100 },
  { key: 'licences', en: 'Licences, trade fees & business taxes', si: 'බලපත්‍ර හා ව්‍යාපාරික ගාස්තු', pct: 100, hint: 'Not income tax (see below).' },
  { key: 'travel', en: 'Travelling (business)', si: 'ගමන් වියදම් (ව්‍යාපාරික)', pct: 100 },
  { key: 'welfare', en: 'Staff welfare & training', si: 'කාර්ය මණ්ඩල සුභසාධන හා පුහුණු', pct: 100 },
  { key: 'baddebts', en: 'Bad debts written off', si: 'අය කරගත නොහැකි ණය (කපා හැරි)', pct: 100 },
  { key: 'depreciation', en: 'Depreciation (in the accounts)', si: 'ක්ෂය (ගිණුම්වල)', pct: 0, law: 'Added back — capital allowances are given instead (s.16)', fixed: true },
  { key: 'entertainment', en: 'Entertainment', si: 'විනෝදාස්වාද වියදම්', pct: 0, law: 'Not allowed — s.10(1)(b)(vii)', fixed: true },
  { key: 'provisions', en: 'Provisions (doubtful debts, other)', si: 'ප්‍රතිපාදන (සැක සහිත ණය ආදිය)', pct: 0, law: 'Not allowed — s.10(1)(b)(viii)', fixed: true },
  { key: 'taxes', en: 'Income tax, penalties & fines', si: 'ආදායම් බදු, දඩ', pct: 0, law: 'Not allowed — s.10(1)(b)(ii), (iii)', fixed: true },
  { key: 'donations', en: 'Donations', si: 'පරිත්‍යාග', pct: 0, law: 'Not a business expense — approved charities are a qualifying payment', fixed: true },
  { key: 'drawings', en: 'Personal / household expenses & drawings', si: 'පුද්ගලික / ගෘහ වියදම් හා ලබාගැනීම්', pct: 0, law: 'Not allowed — domestic expenditure, s.10(1)(b)(i), s.197', fixed: true },
  { key: 'lossassets', en: 'Loss on sale of fixed assets', si: 'ස්ථාවර වත්කම් විකිණීමේ අලාභය', pct: 0, law: 'Added back — balancing allowance is given instead', fixed: true },
  { key: 'partnerpay', en: "Partners' salaries & interest on capital", si: 'හවුල්කරුවන්ගේ වැටුප් හා ප්‍රාග්ධන පොලිය', pct: 0, law: "Part of the partner's share — s.53(7)", fixed: true, only: 'partnership' },
  { key: 'other', en: 'Other expenses (explain in the note)', si: 'වෙනත් වියදම් (සටහනේ පැහැදිලි කරන්න)', pct: 100 },
];
const EXP_DEF = Object.fromEntries(EXPENSE_DEFAULTS.map((e) => [e.key, e]));
export const expenseDefault = (line) => (line.key ? EXP_DEF[line.key] : null);

const line = (d, extra = {}) => ({ id: rid(), key: d.key, label: d.en, ...extra, a: '', m: Array(12).fill('') });
export function emptyData(kind = 'sole') {
  return {
    income: INCOME_DEFAULTS.map((d) => line(d, { type: d.type })),
    stock: { opening: '', closing: '' },
    cos: COS_DEFAULTS.map((d) => line(d)),
    expenses: EXPENSE_DEFAULTS.filter((d) => !d.only || d.only === kind).map((d) => line(d)),
    assets: [],
    partners: kind === 'partnership' ? [{ id: rid(), name: '', nic: '', tin: '', share: '', salary: '', interest: '' }, { id: rid(), name: '', nic: '', tin: '', share: '', salary: '', interest: '' }] : [],
    bs: emptyBS(),
    notes: '',
  };
}

// ─── V84: Balance sheet (statement of financial position) inputs — 1 April (opening) and 31 March (closing) ───
// Stock comes from the Cost of sales tab; fixed assets from the asset register; capital is worked out.
// cage = Schedule 07 of the partnership return (Asmt_PIT_002, Y/A 2025/26)
export const BS_ASSETS = [
  { key: 'receivables', en: 'Trade receivables (debtors)', si: 'ලැබිය යුතු මුදල් (ණයගැතියන්)', cage: '257' },
  { key: 'related_recv', en: 'Due from related parties', si: 'සම්බන්ධිත පාර්ශ්ව වලින් ලැබිය යුතු', cage: '258' },
  { key: 'other_ca', en: 'Deposits, advances & prepayments', si: 'තැන්පතු, අත්තිකාරම් හා පෙරගෙවීම්' },
  { key: 'bank', en: 'Cash at bank (business accounts)', si: 'බැංකුවේ මුදල්' },
  { key: 'cash', en: 'Cash in hand', si: 'අතැති මුදල්' },
];
export const BS_LIABS = [
  { key: 'payables', en: 'Trade payables (creditors)', si: 'ගෙවිය යුතු මුදල් (ණයහිමියන්)', cage: '259' },
  { key: 'related_pay', en: 'Payable to related parties', si: 'සම්බන්ධිත පාර්ශ්වවලට ගෙවිය යුතු', cage: '260' },
  { key: 'accruals', en: 'Accrued expenses & other payables', si: 'උපචිත වියදම් හා වෙනත් ගෙවිය යුතු' },
  { key: 'overdraft', en: 'Bank overdraft', si: 'බැංකු අයිරාව' },
  { key: 'loans', en: 'Bank loans & leases', si: 'බැංකු ණය හා ලීසිං' },
];
const BS_KEYS = [...BS_ASSETS, ...BS_LIABS].map((x) => x.key);
export const emptyBS = () => ({ open: {}, close: {}, raw: { open: '', close: '' }, wip: { open: '', close: '' }, capIn: '', drawings: '', partnerCap: {} });
export const bsUsed = (bs) => !!bs && (BS_KEYS.some((k) => num(bs.open?.[k]) || num(bs.close?.[k])) || !!num(bs.capIn) || !!num(bs.drawings)
  || Object.values(bs.partnerCap || {}).some((p) => num(p?.open) || num(p?.in) || num(p?.drawings)));
export const newLine = (label = '', extra = {}) => ({ id: rid(), key: null, label, ...extra, a: '', m: Array(12).fill('') });
export const newAsset = () => ({ id: rid(), item: '', date: '', cost: '', work: 'full', disposed: false, disposedOn: '', proceeds: '', depRate: '' });
export const newPartner = () => ({ id: rid(), name: '', nic: '', tin: '', share: '', salary: '', interest: '' });

/** Fill missing default lines (older data) */
export function normalize(data, kind) {
  const d = { ...emptyData(kind), ...(data || {}) };
  for (const k of ['income', 'cos', 'expenses', 'assets', 'partners']) d[k] = Array.isArray(d[k]) ? d[k] : [];
  d.stock = { opening: '', closing: '', ...(d.stock || {}) };
  const b = d.bs || {};
  d.bs = { ...emptyBS(), ...b, open: { ...(b.open || {}) }, close: { ...(b.close || {}) }, raw: { open: '', close: '', ...(b.raw || {}) }, wip: { open: '', close: '', ...(b.wip || {}) }, partnerCap: { ...(b.partnerCap || {}) } };
  for (const ln of [...d.income, ...d.cos, ...d.expenses]) { if (!Array.isArray(ln.m) || ln.m.length !== 12) ln.m = Array(12).fill(''); }
  return d;
}

/** Amount of a line for the year */
export const lineAmt = (ln, mode) => r2(mode === 'monthly' ? (ln.m || []).reduce((s, v) => s + num(v), 0) : num(ln.a));

// ─── Accounting depreciation from the asset register (straight line, by months held) ───
const ymd = (s) => { const [y, m, d] = String(s || '').split('-').map(Number); return y ? new Date(Date.UTC(y, (m || 1) - 1, d || 1)) : null; };
const monthsBetween = (a, b) => Math.max(0, (b.getUTCFullYear() - a.getUTCFullYear()) * 12 + (b.getUTCMonth() - a.getUTCMonth()) + (b.getUTCDate() >= a.getUTCDate() ? 0 : -1) + 1);
export function bookDepreciation(a, year) {
  const rate = num(a.depRate) / 100, cost = num(a.cost);
  const bought = ymd(a.date);
  if (!rate || !cost || !bought) return 0;
  const S = parseInt(year, 10);
  const ys = new Date(Date.UTC(S, 3, 1)), ye = new Date(Date.UTC(S + 1, 2, 31));
  const sold = a.disposed ? (ymd(a.disposedOn) || ye) : null;
  if (bought > ye || (sold && sold < ys)) return 0;
  const from = bought > ys ? bought : ys;
  const to = sold && sold < ye ? sold : ye;
  const before = bought < ys ? monthsBetween(bought, new Date(Date.UTC(S, 2, 31))) : 0;
  const yearly = cost * rate;
  const done = Math.min(cost, (yearly * before) / 12);
  return r2(Math.max(0, Math.min(cost - done, (yearly * monthsBetween(from, to)) / 12)));
}

/** V84: accumulated book depreciation at 1 April (before this year) — same straight-line method as bookDepreciation */
export function bookAccumulatedBefore(a, year) {
  const rate = num(a.depRate) / 100, cost = num(a.cost), bought = ymd(a.date);
  if (!rate || !cost || !bought) return 0;
  const S = parseInt(year, 10);
  const ys = new Date(Date.UTC(S, 3, 1));
  if (bought >= ys) return 0;
  return r2(Math.min(cost, (cost * rate * monthsBetween(bought, new Date(Date.UTC(S, 2, 31)))) / 12));
}

/** V84: statement of financial position, fixed-asset movement and capital account(s) */
export function computeBalanceSheet(c, d, year) {
  const bs = d.bs || emptyBS();
  const S = parseInt(year, 10);
  const ys = new Date(Date.UTC(S, 3, 1)), ye = new Date(Date.UTC(S + 1, 2, 31));
  // fixed assets (asset register): cost & accumulated depreciation b/f, additions, disposals; charge = P&L depreciation line
  const fa = { costOpen: 0, additions: 0, disposalsCost: 0, accOpen: 0, accDisposals: 0, rows: [] };
  for (const a of d.assets) {
    const cost = r2(num(a.cost)), bought = ymd(a.date);
    if (!cost || !bought || bought > ye) continue;
    const sold = a.disposed ? (ymd(a.disposedOn) || ye) : null;
    if (sold && sold < ys) continue;                                   // gone before this year
    const acc = bookAccumulatedBefore(a, year);
    const isNew = bought >= ys, isSold = !!sold && sold <= ye;
    if (isNew) fa.additions += cost; else { fa.costOpen += cost; fa.accOpen += acc; }
    if (isSold) { fa.disposalsCost += cost; fa.accDisposals += acc; }
    fa.rows.push({ id: a.id, item: a.item, date: a.date, cost, accOpen: isNew ? 0 : acc, isNew, isSold, depRate: num(a.depRate) });
  }
  const deprLine = c.expenses.filter((x) => x.key === 'depreciation').reduce((s, x) => s + x.amount, 0);
  fa.charge = r2(deprLine);
  for (const k of ['costOpen', 'additions', 'disposalsCost', 'accOpen', 'accDisposals']) fa[k] = r2(fa[k]);
  fa.costClose = r2(fa.costOpen + fa.additions - fa.disposalsCost);
  fa.accClose = r2(fa.accOpen + fa.charge - fa.accDisposals);
  fa.nbvOpen = r2(fa.costOpen - fa.accOpen);
  fa.nbvClose = r2(fa.costClose - fa.accClose);

  const side = (w) => {
    const v = Object.fromEntries(BS_KEYS.map((k) => [k, r2(num(bs[w]?.[k]))]));
    const stock = w === 'open' ? c.opening : c.closing;
    const raw = r2(num(bs.raw?.[w])), wip = r2(num(bs.wip?.[w]));
    const nbv = w === 'open' ? fa.nbvOpen : fa.nbvClose;
    const ca = r2(stock + BS_ASSETS.reduce((s, x) => s + v[x.key], 0));
    const assets = r2(nbv + ca);
    const liabs = r2(BS_LIABS.reduce((s, x) => s + v[x.key], 0));
    return { ...v, stock, raw, wip, stockTrade: r2(Math.max(0, stock - raw - wip)), nbv, ca, assets, cl: r2(v.payables + v.related_pay + v.accruals + v.overdraft), ncl: v.loans, liabs, net: r2(assets - liabs) };
  };
  const open = side('open'), close = side('close');
  const part = c.kind === 'partnership';
  const out = { fa, open, close, used: bsUsed(bs) || !!c.opening || !!c.closing || d.assets.length > 0 };
  if (part) {
    // appropriation: profit per the accounts + partners' pay charged as an expense → salaries & interest first, balance by ratio
    const ps = d.partners.filter((p) => p.name || num(p.share));
    const shareSum = ps.reduce((s, p) => s + num(p.share), 0);
    const charged = r2(c.expenses.filter((x) => x.key === 'partnerpay').reduce((s, x) => s + x.amount, 0));
    const available = r2(c.netProfit + charged);
    const pays = r2(ps.reduce((s, p) => s + num(p.salary) + num(p.interest), 0));
    const residual = r2(available - pays);
    const pc = bs.partnerCap || {};
    const anyOpen = ps.some((p) => String(pc[p.id]?.open ?? '').trim() !== '');
    const partners = ps.map((p) => {
      const sh = shareSum ? num(p.share) / shareSum : 0;
      const capOpen = anyOpen ? r2(num(pc[p.id]?.open)) : r2(open.net * sh);
      const capIn = r2(num(pc[p.id]?.in)), drawings = r2(num(pc[p.id]?.drawings));
      const profit = r2(num(p.salary) + num(p.interest) + residual * sh);
      return { id: p.id, name: p.name, share: num(p.share), salary: r2(num(p.salary)), interest: r2(num(p.interest)), residual: r2(residual * sh), profit, capOpen, capIn, drawings, capClose: r2(capOpen + capIn + profit - drawings) };
    });
    const sum = (k) => r2(partners.reduce((s, p) => s + p[k], 0));
    Object.assign(out, { charged, available, pays, residual, partners, capOpen: sum('capOpen'), capIn: sum('capIn'), drawings: sum('drawings'), profit: sum('profit'), capClose: sum('capClose') });
    out.openDiff = r2(open.net - out.capOpen);
  } else {
    out.capOpen = open.net; out.capIn = r2(num(bs.capIn)); out.drawings = r2(num(bs.drawings)); out.profit = c.netProfit;
    out.capClose = r2(out.capOpen + out.capIn + c.netProfit - out.drawings);
    out.openDiff = 0;
  }
  out.diff = r2(close.net - out.capClose);          // ≠ 0 → the balance sheet does not balance
  out.balanced = Math.abs(out.diff) < 0.5 && Math.abs(out.openDiff) < 0.5;
  return out;
}

// ─── The computation ─────────────────────────────────────
/**
 * acc = { kind, mode, data, year }, office = TaxMate adjustments
 * office: { pct: {lineId: %}, remarks: {lineId: text}, incType: {lineId: type}, assets: {assetId: {cls, pct, years, prior}},
 *           addBacks: [{id,label,amount}], deducts: [{id,label,amount}], lossBF, qpCharity, qpGovt,
 *           ait, wht, instalments, links: {partnerId: clientId} }
 */
export function computeBusiness(acc, office = {}) {
  const kind = acc.kind || 'sole', mode = acc.mode || 'annual', year = acc.year;
  const d = normalize(acc.data, kind);
  const pctOf = (ln, def) => { const v = office.pct?.[ln.id]; return v === undefined || v === null || v === '' ? def : Math.min(100, Math.max(0, num(v))); };

  const income = d.income.map((ln) => {
    const type = office.incType?.[ln.id] || ln.type || 'business';
    return { id: ln.id, label: ln.label, type, amount: lineAmt(ln, mode) };
  }).filter((x) => x.amount || x.type === 'business');
  const byType = (t) => r2(income.filter((x) => x.type === t).reduce((s, x) => s + x.amount, 0));
  const turnover = byType('business');
  const nonBiz = r2(income.filter((x) => x.type !== 'business').reduce((s, x) => s + x.amount, 0));
  const investment = { interest: byType('interest'), rent: byType('rent'), other: byType('other_inv') };
  const invTotal = r2(investment.interest + investment.rent + investment.other);

  const opening = r2(num(d.stock.opening)), closing = r2(num(d.stock.closing));
  const cos = d.cos.map((ln) => { const amount = lineAmt(ln, mode); const pct = pctOf(ln, 100); return { id: ln.id, label: ln.label, amount, pct, disallowed: r2(amount * (100 - pct) / 100), remark: office.remarks?.[ln.id] || '' }; });
  const cosLines = r2(cos.reduce((s, x) => s + x.amount, 0));
  const cogs = r2(opening + cosLines - closing);
  const grossProfit = r2(turnover - cogs);

  const expenses = d.expenses.map((ln) => {
    const def = expenseDefault(ln);
    const amount = lineAmt(ln, mode);
    const pct = def?.fixed ? def.pct : pctOf(ln, def ? def.pct : 100);
    return { id: ln.id, key: ln.key, label: ln.label, amount, pct, disallowed: r2(amount * (100 - pct) / 100), law: def?.law || '', fixed: !!def?.fixed, remark: office.remarks?.[ln.id] || '', note: ln.note || '' };
  });
  const expTotal = r2(expenses.reduce((s, x) => s + x.amount, 0));
  const netProfit = r2(turnover + nonBiz - cogs - expTotal);      // per the accounts

  const assets = d.assets.map((a) => ({ a, o: office.assets?.[a.id] || {}, r: assetAllowance(a, office.assets?.[a.id] || {}, year), book: bookDepreciation(a, year) }));
  const capAllow = r2(assets.reduce((s, x) => s + x.r.allowance, 0));
  const balAllow = r2(assets.reduce((s, x) => s + x.r.balancing, 0));
  const charges = r2(assets.reduce((s, x) => s + x.r.charge, 0));
  const bookDep = r2(assets.reduce((s, x) => s + x.book, 0));

  const disallowed = r2(expenses.reduce((s, x) => s + x.disallowed, 0) + cos.reduce((s, x) => s + x.disallowed, 0));
  const addBacks = (office.addBacks || []).filter((x) => num(x.amount)).map((x) => ({ ...x, amount: r2(num(x.amount)) }));
  const deducts = (office.deducts || []).filter((x) => num(x.amount)).map((x) => ({ ...x, amount: r2(num(x.amount)) }));
  const addTotal = r2(disallowed + addBacks.reduce((s, x) => s + x.amount, 0) + charges);
  const lessTotal = r2(nonBiz + capAllow + balAllow + deducts.reduce((s, x) => s + x.amount, 0));
  const adjusted = r2(netProfit + addTotal - lessTotal);           // gains & profits from the business (may be a loss)

  const issues = [];
  if (!turnover && !expTotal) issues.push('No income or expenses entered yet.');
  for (const x of assets) if (x.r.issue && x.r.cls?.years !== 0) issues.push(`${x.a.item || 'Asset'}: ${x.r.issue}`);   // no-allowance assets need no %
  const deprLine = expenses.find((x) => x.key === 'depreciation');
  if (bookDep && deprLine && !deprLine.amount) issues.push(`The asset register gives depreciation of Rs. ${bookDep.toLocaleString('en-LK')} but the Depreciation line is empty — it does not change the tax (it is added back), but the accounts profit will differ.`);
  if (closing > opening + cosLines + turnover && closing) issues.push('Closing stock looks too high — check it.');

  const out = {
    kind, mode, year, turnover, nonBiz, income, investment, invTotal, opening, closing, cos, cosLines, cogs, grossProfit,
    expenses, expTotal, netProfit, assets, capAllow, balAllow, charges, bookDep, disallowed, addBacks, deducts, addTotal, lessTotal, adjusted, issues,
    lossBF: r2(Math.max(0, num(office.lossBF))),
  };
  if (kind === 'partnership') Object.assign(out, partnershipTax(out, d, office));
  else Object.assign(out, soleResult(out));
  out.bs = computeBalanceSheet(out, d, year);
  out.exemptIncome = r2(income.filter((x) => x.type === 'exempt').reduce((s, x) => s + x.amount, 0));
  if (out.bs.used && bsUsed(d.bs) && !out.bs.balanced) out.issues = [...out.issues, `The balance sheet does not balance — difference Rs. ${Math.abs(out.bs.diff).toLocaleString('en-LK')}${Math.abs(out.bs.openDiff) >= 0.5 ? ` (opening partners' capital differs by Rs. ${Math.abs(out.bs.openDiff).toLocaleString('en-LK')})` : ''}. Check the Balance sheet tab.`];
  return out;
}

function soleResult(c) {
  // the individual return sets the loss brought forward off against all business income (bizLossBF)
  return { bizProfit: r2(Math.max(0, c.adjusted)), loss: r2(Math.max(0, -c.adjusted)) };
}

function partnershipTax(c, d, office) {
  const lossUsed = r2(Math.min(c.lossBF, Math.max(0, c.adjusted)));
  const bizIncome = r2(Math.max(0, c.adjusted) - lossUsed);
  const lossCF = r2(c.lossBF - lossUsed + Math.max(0, -c.adjusted));
  const assessable = r2(bizIncome + c.invTotal);
  const charity = num(office.qpCharity), govt = num(office.qpGovt);
  const charityUsed = r2(Math.min(charity, 500_000, assessable / 5));
  const qp = r2(Math.min(assessable, charityUsed + govt));
  const taxable = r2(Math.max(0, assessable - qp));
  const tax = r2(Math.max(0, taxable - PARTNERSHIP_FREE) * PARTNERSHIP_RATE);
  const ait = r2(num(office.ait)), wht = r2(num(office.wht)), inst = r2(num(office.instalments));
  const balance = r2(tax - ait - wht - inst);

  // partners: salary & interest to that partner first, then the rest by profit-sharing %
  const ps = d.partners.filter((p) => p.name || num(p.share));
  const shareSum = r2(ps.reduce((s, p) => s + num(p.share), 0));
  const pays = r2(ps.reduce((s, p) => s + num(p.salary) + num(p.interest), 0));
  const rest = r2(bizIncome - pays);
  const partners = ps.map((p) => {
    const sh = shareSum ? num(p.share) / shareSum : 0;
    const biz = r2(num(p.salary) + num(p.interest) + rest * sh);
    const inv = { interest: r2(c.investment.interest * sh), rent: r2(c.investment.rent * sh), other: r2(c.investment.other * sh) };
    const invTotal = r2(inv.interest + inv.rent + inv.other);
    return { id: p.id, name: p.name, nic: p.nic, tin: p.tin, share: num(p.share), salary: r2(num(p.salary)), interest: r2(num(p.interest)), biz, inv, invTotal, total: r2(biz + invTotal), client_id: office.links?.[p.id] || null };
  });
  const totalAlloc = r2(partners.reduce((s, p) => s + Math.max(0, p.total), 0));
  for (const p of partners) {
    const w = totalAlloc > 0 ? Math.max(0, p.total) / totalAlloc : (shareSum ? p.share / shareSum : 0);
    p.tax = r2(tax * w);
    p.ait = r2((ait + wht) * (shareSum ? p.share / shareSum : 0));
  }
  // rounding: last partner takes the cents difference
  if (partners.length) {
    const dt = r2(tax - partners.reduce((s, p) => s + p.tax, 0)); partners[partners.length - 1].tax = r2(partners[partners.length - 1].tax + dt);
  }
  const pIssues = [];
  if (!ps.length) pIssues.push('Add the partners and their profit-sharing %.');
  else if (Math.abs(shareSum - 100) > 0.01) pIssues.push(`Profit-sharing % adds up to ${shareSum}% — it should be 100%.`);
  if (pays && !c.expenses.some((x) => x.key === 'partnerpay' && x.amount)) pIssues.push("Partners' salaries / interest are entered for partners, but not as an expense in the accounts — check (they are added back either way).");
  if (rest < 0 && bizIncome > 0) pIssues.push("Partners' salaries & interest are more than the business income — the rest is shared as a loss.");
  return { lossUsed, bizIncome, lossCF, assessable, charity, charityUsed, govt, qp, taxable, tax, ait, wht, inst, balance, partners, shareSum, pays, issues: [...c.issues, ...pIssues] };
}

/** What is saved as the account's result when TaxMate finalises (also shown to the client) */
export function resultOf(c) {
  const base = { v: 1, kind: c.kind, year: c.year, turnover: c.turnover, cogs: c.cogs, grossProfit: c.grossProfit, expTotal: c.expTotal, netProfit: c.netProfit,
    addTotal: c.addTotal, lessTotal: c.lessTotal, capAllow: r2(c.capAllow + c.balAllow), charges: c.charges, adjusted: c.adjusted, investment: c.investment, lossBF: c.lossBF, at: new Date().toISOString() };
  if (c.kind === 'partnership') {
    return { ...base, bizIncome: c.bizIncome, lossUsed: c.lossUsed, lossCF: c.lossCF, assessable: c.assessable, qp: c.qp, taxable: c.taxable, tax: c.tax, balance: c.balance,
      partners: c.partners.map((p) => ({ id: p.id, name: p.name, nic: p.nic, tin: p.tin, share: p.share, biz: p.biz, inv: p.inv, invTotal: p.invTotal, tax: p.tax, ait: p.ait, client_id: p.client_id })) };
  }
  return { ...base, bizProfit: c.bizProfit, loss: c.loss };
}

// ─── Into the individual return (admin) ──────────────────
/** FINAL computations for a client & Y/A → return input fields */
export async function businessForReturn(clientId, year) {
  const { data, error } = await supabase.from('business_accounts').select('id, client_id, kind, name, status, result').eq('year', year).eq('status', 'final');
  if (error) throw new Error(/business_accounts|schema cache/.test(error.message) ? 'Run the V76 script in Supabase first.' : error.message);
  return collectForReturn(data || [], clientId);
}
export function collectForReturn(rows, clientId) {
  const input = { bizProfit: 0, bizPartner: 0, ptnTax: 0, ptnAit: 0, interest: 0, rentGross: 0, othInv: 0, bizLossBF: 0 };
  const items = [];
  for (const b of rows) {
    const R = b.result || {};
    if (b.kind === 'sole' && b.client_id === clientId) {
      input.bizProfit += num(R.bizProfit); input.interest += num(R.investment?.interest); input.rentGross += num(R.investment?.rent); input.othInv += num(R.investment?.other);
      input.bizLossBF += num(R.lossBF);
      items.push({ label: `${b.name} (sole proprietor)`, amount: num(R.bizProfit) });
    } else if (b.kind === 'partnership') {
      const p = (R.partners || []).find((x) => x.client_id === clientId);
      if (!p) continue;
      input.bizPartner += Math.max(0, num(p.biz)); input.ptnTax += num(p.tax); input.ptnAit += num(p.ait); input.othInv += Math.max(0, num(p.invTotal));
      items.push({ label: `${b.name} (partner ${p.share}%)`, amount: num(p.biz) });
    }
  }
  for (const k of Object.keys(input)) input[k] = r2(input[k]);
  return { items, input };
}

// ─── Storage ─────────────────────────────────────────────
const notSetUp = (e) => /business_account|schema cache|does not exist/.test(e?.message || '');
const fail = (e) => { throw new Error(notSetUp(e) ? 'Run the V76 script in Supabase first.' : e.message); };
const COLS = 'id, client_id, year, kind, name, tin, activity_code, mode, data, status, result, client_note, created_at, updated_at, submitted_at, finalized_at';
export async function listAccounts(clientId) {
  let q = supabase.from('business_accounts').select(COLS).order('year', { ascending: false }).order('created_at');
  if (clientId) q = q.eq('client_id', clientId);
  const { data, error } = await q;
  if (error) { if (notSetUp(error)) return { rows: [], missing: true }; fail(error); }
  return { rows: data || [] };
}
export async function createAccount({ clientId, year, kind, name, tin, mode }) {
  if (!String(name || '').trim()) throw new Error('Type the business name');
  const { data, error } = await supabase.from('business_accounts')
    .insert({ client_id: clientId, year, kind, name: String(name).trim().slice(0, 160), tin: String(tin || '').trim() || null, mode: mode || 'annual', data: emptyData(kind) })
    .select(COLS).single();
  if (error) fail(error);
  return data;
}
export async function saveAccount(id, patch) {
  const { data, error } = await supabase.from('business_accounts').update(patch).eq('id', id).select(COLS).single();
  if (error) fail(error);
  if (!data) throw new Error('This business account is locked (already submitted). Ask TaxMate to re-open it.');
  return data;
}
export async function deleteAccount(id) { const { error } = await supabase.from('business_accounts').delete().eq('id', id); if (error) fail(error); }
export async function loadBizOffice(id) {
  const { data, error } = await supabase.from('business_account_office').select('data, updated_at').eq('account_id', id).maybeSingle();
  if (error) { if (notSetUp(error)) return { data: {}, missing: true }; fail(error); }
  return { data: data?.data || {}, updated_at: data?.updated_at };
}
export async function saveBizOffice(acc, office) {
  const { error } = await supabase.from('business_account_office').upsert({ account_id: acc.id, client_id: acc.client_id, data: office }, { onConflict: 'account_id' });
  if (error) fail(error);
}

export const STATUS = {
  open: { en: 'Open — client filling', short: 'Open', cls: 'bg-amber-100 text-amber-800' },
  submitted: { en: 'Submitted — TaxMate to check', short: 'Submitted', cls: 'bg-blue-100 text-blue-800' },
  final: { en: 'Final', short: 'Final', cls: 'bg-emerald-100 text-emerald-800' },
};
export const KIND = { sole: { en: 'Sole proprietor', emoji: '🏪' }, partnership: { en: 'Partnership', emoji: '🤝' } };
export { yaStartOf };
