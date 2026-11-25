// ═══════════════════════════════════════════════════════════
//  Monthly Income & Business sheet (client fills, admin imports into the IIT Return)
//  One sheet per client per Y/A. Months run April → March.
// ═══════════════════════════════════════════════════════════

import { parseAmount, amountNum } from './numParse';

export const MONTHS = ['Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec', 'Jan', 'Feb', 'Mar'];
export const monthLabel = (year, i) => {
  const s = parseInt(year, 10) || new Date().getFullYear();
  return `${MONTHS[i]} ${i < 9 ? s : s + 1}`;
};

// kind: income | credit | fx | bizIncome | bizExpense
export const GROUPS = [
  {
    key: 'local', en: 'Income in Sri Lanka', si: 'දේශීය ආදායම', rows: [
      { key: 'salary', en: 'Salary & allowances', si: 'වැටුප හා දීමනා', kind: 'income', hint: 'Gross, before APIT / EPF' },
      { key: 'bonus', en: 'Bonus / lump sums', si: 'බෝනස්', kind: 'income' },
      { key: 'rent', en: 'Rent received (gross)', si: 'ලැබුණු කුලිය', kind: 'income' },
      { key: 'interest', en: 'Bank interest (gross)', si: 'බැංකු පොලිය', kind: 'income' },
      { key: 'otherIncome', en: 'Other income', si: 'වෙනත් ආදායම්', kind: 'income' },
    ],
  },
  {
    key: 'foreign', en: 'Foreign-currency income sent through a bank (in Rs.)', si: 'විදේශ මුදලින් ලැබී බැංකුව හරහා ආ ආදායම (රු.)', rows: [
      { key: 'fxEmployment', en: 'Salary from a foreign employer', si: 'විදේශ සේවා යෝජකයාගෙන් වැටුප', kind: 'fx' },
      { key: 'fxServices', en: 'Services / freelance for foreign clients', si: 'විදේශ ගනුදෙනුකරුවන්ට සේවා', kind: 'fx' },
      { key: 'fxOther', en: 'Other foreign income', si: 'වෙනත් විදේශ ආදායම', kind: 'fx' },
    ],
  },
  {
    key: 'business', en: 'Business — income', si: 'ව්‍යාපාරික ආදායම', rows: [
      { key: 'bizSales', en: 'Sales / fees received', si: 'විකුණුම් / ලැබුණු ගාස්තු', kind: 'bizIncome' },
      { key: 'bizOtherIncome', en: 'Other business income', si: 'වෙනත් ව්‍යාපාරික ආදායම', kind: 'bizIncome' },
    ],
  },
  {
    key: 'expenses', en: 'Business — expenses', si: 'ව්‍යාපාරික වියදම්', rows: [
      { key: 'bizPurchases', en: 'Purchases / cost of sales', si: 'මිලදී ගැනීම් / විකුණුම් පිරිවැය', kind: 'bizExpense' },
      { key: 'bizSalaries', en: 'Staff salaries & EPF/ETF', si: 'කාර්ය මණ්ඩල වැටුප්', kind: 'bizExpense' },
      { key: 'bizRent', en: 'Shop / office rent', si: 'කුලිය', kind: 'bizExpense' },
      { key: 'bizUtilities', en: 'Electricity, water, phone, internet', si: 'විදුලිය, ජලය, දුරකථන', kind: 'bizExpense' },
      { key: 'bizTransport', en: 'Transport & fuel', si: 'ප්‍රවාහන හා ඉන්ධන', kind: 'bizExpense' },
      { key: 'bizOtherExp', en: 'Other expenses', si: 'වෙනත් වියදම්', kind: 'bizExpense' },
    ],
  },
  {
    key: 'credits', en: 'Tax already deducted', si: 'දැනටමත් අඩු කළ බදු', rows: [
      { key: 'apit', en: 'APIT deducted by employer', si: 'සේවා යෝජකයා අඩු කළ APIT', kind: 'credit' },
      { key: 'whtInterest', en: 'WHT deducted from interest', si: 'පොලියෙන් අඩු කළ WHT', kind: 'credit' },
      { key: 'whtOther', en: 'Other WHT / AIT', si: 'වෙනත් WHT / AIT', kind: 'credit' },
    ],
  },
];
// V72 — Business & Freelance tool (switched on per client/sheet by TaxMate): detailed expenses + equipment list.
// The client enters FULL bill amounts; TaxMate sets the work-use % and asset classes (office working, lib/bizWorking.js).
export const BIZ_EXPENSES = {
  key: 'expenses', en: 'Business / freelance — expenses (full bill amounts)', si: 'ව්‍යාපාරික / freelance වියදම් (සම්පූර්ණ බිල්පත් මුදල)', rows: [
    { key: 'bizPurchases', en: 'Purchases / cost of sales', si: 'මිලදී ගැනීම් / විකුණුම් පිරිවැය', kind: 'bizExpense' },
    { key: 'bizSalaries', en: 'Staff salaries & EPF/ETF', si: 'කාර්ය මණ්ඩල වැටුප්', kind: 'bizExpense' },
    { key: 'bizRent', en: 'Office / workspace / shop rent', si: 'කාර්යාල / වැඩ කරන ස්ථානයේ කුලිය', kind: 'bizExpense' },
    { key: 'exMobile', en: 'Mobile bill', si: 'ජංගම දුරකථන බිල', kind: 'bizExpense' },
    { key: 'exInternet', en: 'Broadband / internet bill', si: 'Broadband / අන්තර්ජාල බිල', kind: 'bizExpense' },
    { key: 'exInternet2', en: 'StarLink / other internet', si: 'StarLink / වෙනත් අන්තර්ජාල', kind: 'bizExpense' },
    { key: 'exElectricity', en: 'Electricity bill', si: 'විදුලි බිල', kind: 'bizExpense' },
    { key: 'exWater', en: 'Water bill', si: 'ජල බිල', kind: 'bizExpense' },
    { key: 'exSoftware', en: 'Software & online subscriptions', si: 'Software / Online subscriptions', kind: 'bizExpense' },
    { key: 'bizTransport', en: 'Transport & fuel (work)', si: 'ප්‍රවාහන හා ඉන්ධන (වැඩ සඳහා)', kind: 'bizExpense' },
    { key: 'exBank', en: 'Bank charges & remittance fees', si: 'බැංකු / Remittance ගාස්තු', kind: 'bizExpense' },
    { key: 'exStationery', en: 'Stationery & printing', si: 'ලිපි ද්‍රව්‍ය හා මුද්‍රණ', kind: 'bizExpense' },
    { key: 'exRepairs', en: 'Repairs & maintenance (equipment)', si: 'උපකරණ අලුත්වැඩියා', kind: 'bizExpense' },
    { key: 'exTraining', en: 'Training, courses & books', si: 'පුහුණු / පාඨමාලා / පොත්', kind: 'bizExpense' },
    { key: 'exProfFees', en: 'Professional fees (accountant, legal)', si: 'වෘත්තීය ගාස්තු', kind: 'bizExpense' },
    { key: 'exAdvert', en: 'Advertising & marketing', si: 'දැන්වීම් හා අලෙවිකරණ', kind: 'bizExpense' },
    { key: 'bizOtherExp', en: 'Other expenses (explain in the note)', si: 'වෙනත් වියදම් (සටහනේ සඳහන් කරන්න)', kind: 'bizExpense' },
  ],
};
const LEGACY_UTIL = GROUPS.find(g => g.key === 'expenses').rows.find(r => r.key === 'bizUtilities');

/** Every row that can hold figures (normal + business tool) — used for saving */
export const ROWS = [...GROUPS.flatMap(g => g.rows), ...BIZ_EXPENSES.rows.filter(r => !GROUPS.some(g => g.rows.some(x => x.key === r.key)))];
export const ROW = Object.fromEntries(ROWS.map(r => [r.key, r]));

/** Groups shown for a sheet. biz = Business & Freelance tool on (TaxMate switches it on per sheet). */
export function groupsFor(biz, data) {
  if (!biz) return GROUPS;
  const hasUtil = (data?.rows?.bizUtilities ?? []).some(v => num(v));
  return GROUPS.map(g => {
    if (g.key === 'foreign') return { ...g, rows: g.rows.map(r => (r.key === 'fxServices' ? { ...r, en: 'Services / freelance for foreign clients (business income)', hint: 'Received in foreign currency through a bank' } : r)) };
    if (g.key === 'expenses') return { ...BIZ_EXPENSES, rows: hasUtil ? [...BIZ_EXPENSES.rows, { ...LEGACY_UTIL, en: 'Electricity, water, phone, internet (combined — old entry)' }] : BIZ_EXPENSES.rows };
    return g;
  });
}

const num = (v) => amountNum(v);   // V78: "139877,23" = 139,877.23 (not 13,987,723)
export const emptySheet = () => ({ rows: Object.fromEntries(ROWS.map(r => [r.key, Array(12).fill('')])), note: '', assets: [] });
export const cell = (data, key, i) => data?.rows?.[key]?.[i] ?? '';

export function rowTotal(data, key) { return (data?.rows?.[key] ?? []).reduce((a, v) => a + num(v), 0); }
// biz: freelance income for foreign clients counts as business income (expenses are deducted from it)
const kindOf = (r, biz) => (biz && r.key === 'fxServices' ? 'bizIncome' : r.kind);
export function monthTotals(data, i, biz = false) {
  const t = { income: 0, fx: 0, bizIncome: 0, bizExpense: 0, credit: 0 };
  for (const r of ROWS) t[kindOf(r, biz)] += num(cell(data, r.key, i));
  t.bizProfit = t.bizIncome - t.bizExpense;
  return t;
}
export function sheetTotals(data, biz = false) {
  const t = { income: 0, fx: 0, bizIncome: 0, bizExpense: 0, credit: 0 };
  for (const r of ROWS) t[kindOf(r, biz)] += rowTotal(data, r.key);
  t.bizProfit = t.bizIncome - t.bizExpense;
  t.total = t.income + t.fx + Math.max(0, t.bizProfit);
  t.monthsFilled = MONTHS.filter((_, i) => ROWS.some(r => num(cell(data, r.key, i)) !== 0)).length;
  return t;
}

// Map a sheet onto IIT Return inputs (annual amounts).
// With the Business & Freelance tool, pass the office working result (lib/bizWorking.js → computeWorking):
// net foreign business profit → bizFx, net local business profit → bizProfit.
export function sheetToReturnInput(data, working = null) {
  const s = (k) => Math.round(rowTotal(data, k));
  const t = sheetTotals(data);
  const out = {
    empPrimary: s('salary'), empBonus: s('bonus'), rentGross: s('rent'), interest: s('interest'), othInc: s('otherIncome'),
    empFx: s('fxEmployment'), bizFx: s('fxServices'), forFx: s('fxOther'),
    bizProfit: Math.max(0, Math.round(t.bizProfit)),
    apitPrimary: s('apit'), whtInterest: s('whtInterest'), whtOther: s('whtOther'),
  };
  let bizLoss = t.bizProfit < 0 ? Math.round(-t.bizProfit) : 0;
  if (working) {
    out.bizFx = Math.round(working.netFx);
    out.bizProfit = Math.round(working.netLocal);
    if (working.fxOtherIsBiz) out.forFx = 0;
    bizLoss = Math.round(working.loss);
  }
  return { input: Object.fromEntries(Object.entries(out).filter(([, v]) => v > 0)), bizLoss };
}

// Equipment the client lists (Business & Freelance tool). TaxMate sets class / work-use % in the office working.
export const MAX_ASSETS = 40;
const str = (v, n) => String(v ?? '').trim().slice(0, n);
export function cleanAssets(list) {
  return (Array.isArray(list) ? list : []).slice(0, MAX_ASSETS).map((a) => ({
    id: str(a.id, 20) || Math.random().toString(36).slice(2, 10),
    item: str(a.item, 120),
    date: /^\d{4}-\d{2}-\d{2}$/.test(a.date || '') ? a.date : '',
    cost: parseAmount(a.cost, false).slice(0, 15),
    work: a.work === 'partly' ? 'partly' : 'yes',
    disposed: !!a.disposed,
    disposedOn: /^\d{4}-\d{2}-\d{2}$/.test(a.disposedOn || '') ? a.disposedOn : '',
    proceeds: parseAmount(a.proceeds, false).slice(0, 15),
    note: str(a.note, 200),
  })).filter((a) => a.item || num(a.cost));
}

export function cleanSheet(data) {
  const rows = {};
  for (const r of ROWS) rows[r.key] = Array.from({ length: 12 }, (_, i) => parseAmount(cell(data, r.key, i)));
  return { rows, note: String(data?.note ?? '').slice(0, 2000), assets: cleanAssets(data?.assets) };
}

export const SHEET_STATUS = {
  open: { label: 'Waiting for client', cls: 'bg-amber-100 text-amber-800' },
  submitted: { label: 'Submitted — review', cls: 'bg-blue-100 text-blue-800' },
  reviewed: { label: 'Reviewed', cls: 'bg-green-100 text-green-700' },
};
