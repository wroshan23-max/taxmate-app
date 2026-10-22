// ═══════════════════════════════════════════════════════════
//  Monthly Income & Business sheet (client fills, admin imports into the IIT Return)
//  One sheet per client per Y/A. Months run April → March.
// ═══════════════════════════════════════════════════════════

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
export const ROWS = GROUPS.flatMap(g => g.rows);
export const ROW = Object.fromEntries(ROWS.map(r => [r.key, r]));

const num = (v) => { const n = Number(String(v ?? '').replace(/,/g, '')); return Number.isFinite(n) ? n : 0; };
export const emptySheet = () => ({ rows: Object.fromEntries(ROWS.map(r => [r.key, Array(12).fill('')])), note: '' });
export const cell = (data, key, i) => data?.rows?.[key]?.[i] ?? '';

export function rowTotal(data, key) { return (data?.rows?.[key] ?? []).reduce((a, v) => a + num(v), 0); }
export function monthTotals(data, i) {
  const t = { income: 0, fx: 0, bizIncome: 0, bizExpense: 0, credit: 0 };
  for (const r of ROWS) t[r.kind] += num(cell(data, r.key, i));
  t.bizProfit = t.bizIncome - t.bizExpense;
  return t;
}
export function sheetTotals(data) {
  const t = { income: 0, fx: 0, bizIncome: 0, bizExpense: 0, credit: 0 };
  for (const r of ROWS) t[r.kind] += rowTotal(data, r.key);
  t.bizProfit = t.bizIncome - t.bizExpense;
  t.total = t.income + t.fx + Math.max(0, t.bizProfit);
  t.monthsFilled = MONTHS.filter((_, i) => ROWS.some(r => num(cell(data, r.key, i)) !== 0)).length;
  return t;
}

// Map a sheet onto IIT Return inputs (annual amounts)
export function sheetToReturnInput(data) {
  const s = (k) => Math.round(rowTotal(data, k));
  const t = sheetTotals(data);
  const out = {
    empPrimary: s('salary'), empBonus: s('bonus'), rentGross: s('rent'), interest: s('interest'), othInc: s('otherIncome'),
    empFx: s('fxEmployment'), bizFx: s('fxServices'), forFx: s('fxOther'),
    bizProfit: Math.max(0, Math.round(t.bizProfit)),
    apitPrimary: s('apit'), whtInterest: s('whtInterest'), whtOther: s('whtOther'),
  };
  return { input: Object.fromEntries(Object.entries(out).filter(([, v]) => v > 0)), bizLoss: t.bizProfit < 0 ? Math.round(-t.bizProfit) : 0 };
}

export function cleanSheet(data) {
  const rows = {};
  for (const r of ROWS) rows[r.key] = Array.from({ length: 12 }, (_, i) => { const v = String(cell(data, r.key, i)).replace(/[^\d.-]/g, ''); return v === '' ? '' : v; });
  return { rows, note: String(data?.note ?? '').slice(0, 2000) };
}

export const SHEET_STATUS = {
  open: { label: 'Waiting for client', cls: 'bg-amber-100 text-amber-800' },
  submitted: { label: 'Submitted — review', cls: 'bg-blue-100 text-blue-800' },
  reviewed: { label: 'Reviewed', cls: 'bg-green-100 text-green-700' },
};
