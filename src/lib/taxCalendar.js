// ═══════════════════════════════════════════════════════════
//  Sri Lanka tax due dates — built from the IRD Tax Calendar 2026
//  (ird.gov.lk → Publications → Tax Calendar). Every date in the 2026
//  calendar follows the monthly / quarterly / annual pattern below, so the
//  same rules produce later years too. Check IRD's calendar each January.
// ═══════════════════════════════════════════════════════════

export const CATS = {
  iit:      { label: 'Income Tax',             short: 'Income Tax', color: 'bg-red-500',     soft: 'bg-red-50 text-red-700 border-red-200',       who: 'Individuals, partnerships & companies' },
  apit:     { label: 'APIT (PAYE)',            short: 'APIT',       color: 'bg-blue-500',    soft: 'bg-blue-50 text-blue-700 border-blue-200',    who: 'Employers' },
  wht:      { label: 'AIT / WHT',              short: 'WHT',        color: 'bg-indigo-500',  soft: 'bg-indigo-50 text-indigo-700 border-indigo-200', who: 'Withholding agents' },
  vat:      { label: 'VAT',                    short: 'VAT',        color: 'bg-emerald-500', soft: 'bg-emerald-50 text-emerald-700 border-emerald-200', who: 'VAT-registered businesses' },
  sscl:     { label: 'SSCL',                   short: 'SSCL',       color: 'bg-amber-500',   soft: 'bg-amber-50 text-amber-800 border-amber-200', who: 'SSCL-registered businesses' },
  stamp:    { label: 'Stamp Duty',             short: 'Stamp',      color: 'bg-pink-500',    soft: 'bg-pink-50 text-pink-700 border-pink-200',    who: 'Compounded stamp duty payers' },
  vatfs:    { label: 'VAT on Financial Services', short: 'VAT-FS',  color: 'bg-teal-500',    soft: 'bg-teal-50 text-teal-700 border-teal-200',    who: 'Financial institutions' },
  bg:       { label: 'Betting & Gaming',       short: 'B&G',        color: 'bg-gray-500',    soft: 'bg-gray-50 text-gray-700 border-gray-200',    who: 'Betting & gaming businesses' },
  reminder: { label: 'Reminder',               short: 'Reminder',   color: 'bg-purple-500',  soft: 'bg-purple-50 text-purple-700 border-purple-200', who: '' },
};
export const IRD_CATS = ['iit', 'apit', 'wht', 'vat', 'sscl', 'stamp', 'vatfs', 'bg'];
// What individual clients see by default
export const CLIENT_DEFAULT_CATS = ['iit', 'reminder'];

const MONTH_NAMES = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
const pad = (n) => String(n).padStart(2, '0');
export const iso = (y, m, d) => `${y}-${pad(m)}-${pad(d)}`;          // m = 1..12
const lastDay = (y, m) => new Date(y, m, 0).getDate();
const prevMonth = (y, m) => (m === 1 ? { y: y - 1, m: 12 } : { y, m: m - 1 });
const monthName = (y, m) => `${MONTH_NAMES[m - 1]} ${y}`;
const ya = (s) => `${s}/${s + 1}`;
const QNAMES = { 1: 'Q4 (Oct–Dec)', 4: 'Q1 (Jan–Mar)', 7: 'Q2 (Apr–Jun)', 10: 'Q3 (Jul–Sep)' };
const qYear = (y, m) => (m === 1 ? y - 1 : y);

/** All IRD due dates in calendar year Y. */
export function irdDates(Y) {
  const out = [];
  const add = (m, d, cat, title, detail = '') => out.push({ id: `ird-${Y}-${m}-${d}-${cat}-${out.length}`, date: iso(Y, m, d), cat, title, detail, ird: true });
  for (let m = 1; m <= 12; m++) {
    const p = prevMonth(Y, m), pm = monthName(p.y, p.m);
    // Monthly
    add(m, 7, 'bg', 'Betting & Gaming — gross collection payment', pm);
    add(m, 15, 'apit', 'APIT payment', `Tax deducted from employees — ${pm}`);
    add(m, 15, 'wht', 'AIT / WHT payment', `Interest, fees & other — ${pm}`);
    add(m, 20, 'sscl', 'SSCL payment', pm);
    add(m, 20, 'vat', 'VAT payment', pm);
    add(m, 20, 'vatfs', 'VAT on Financial Services payment', pm);
    add(m, lastDay(Y, m), 'vat', 'VAT monthly return', pm);
    // Quarterly (Jan, Apr, Jul, Oct)
    if ([1, 4, 7, 10].includes(m)) {
      const q = `${QNAMES[m]} ${qYear(Y, m)}`;
      add(m, 1, 'bg', 'Betting & Gaming — annual levy (quarterly)', '');
      add(m, 15, 'stamp', 'Stamp duty — compounded statement & payment', q);
      add(m, 20, 'sscl', 'SSCL quarterly return', q);
      add(m, 20, 'bg', 'Betting & Gaming — gross collection return', '');
      add(m, lastDay(Y, m), 'vat', 'VAT quarterly return', q);
    }
  }
  // Income tax (individuals, partnerships, companies)
  add(2, 15, 'iit', `Income tax — 3rd quarterly instalment`, `Y/A ${ya(Y - 1)}`);
  add(5, 15, 'iit', `Income tax — 4th quarterly instalment`, `Y/A ${ya(Y - 1)}`);
  add(8, 15, 'iit', `Income tax — 1st quarterly instalment`, `Y/A ${ya(Y)} · and Statement of Estimated Tax`);
  add(11, 15, 'iit', `Income tax — 2nd quarterly instalment`, `Y/A ${ya(Y)}`);
  add(9, 30, 'iit', `Income tax — final (balance) payment`, `Y/A ${ya(Y - 1)}`);
  add(11, 30, 'iit', `Income Tax Return — last day to file`, `Y/A ${ya(Y - 1)} · individuals, partnerships & companies`);
  // Annual statements
  add(4, 30, 'apit', 'APIT annual statement of employers', `Y/A ${ya(Y - 1)}`);
  add(4, 30, 'wht', 'AIT / WHT annual statement', `Y/A ${ya(Y - 1)}`);
  // VAT on Financial Services — interim / final
  add(1, 20, 'vatfs', 'VAT on FS — 2nd interim estimate', `${ya(Y - 1)} (calendar-year basis)`);
  add(4, 20, 'vatfs', 'VAT on FS — 2nd interim estimate', `${ya(Y - 1)} (assessment-year basis)`);
  add(6, 30, 'vatfs', 'VAT on FS — final payment & return', `${ya(Y - 1)} (calendar-year basis)`);
  add(7, 20, 'vatfs', 'VAT on FS — 1st interim estimate', `${ya(Y)} (calendar-year basis)`);
  add(9, 30, 'vatfs', 'VAT on FS — final payment & return', `${ya(Y - 1)} (assessment-year basis)`);
  add(10, 20, 'vatfs', 'VAT on FS — 1st interim estimate', `${ya(Y)} (assessment-year basis)`);
  return out.sort((a, b) => a.date.localeCompare(b.date));
}

/** IRD dates between two ISO dates (inclusive), for the chosen categories. */
export function irdBetween(fromIso, toIso, cats = IRD_CATS) {
  const y0 = parseInt(fromIso, 10), y1 = parseInt(toIso, 10);
  const all = [];
  for (let y = y0; y <= y1; y++) all.push(...irdDates(y));
  return all.filter(e => e.date >= fromIso && e.date <= toIso && cats.includes(e.cat));
}

export const todayIso = () => { const d = new Date(); return iso(d.getFullYear(), d.getMonth() + 1, d.getDate()); };
export const addDays = (isoDate, n) => { const d = new Date(`${isoDate}T00:00:00`); d.setDate(d.getDate() + n); return iso(d.getFullYear(), d.getMonth() + 1, d.getDate()); };
export const daysUntil = (isoDate) => Math.round((new Date(`${isoDate}T00:00:00`) - new Date(`${todayIso()}T00:00:00`)) / 86400000);
export const fmtDay = (isoDate, opts = { day: 'numeric', month: 'short' }) => new Date(`${isoDate}T00:00:00`).toLocaleDateString('en-GB', opts);
export function dueLabel(isoDate) {
  const n = daysUntil(isoDate);
  if (n === 0) return 'Today';
  if (n === 1) return 'Tomorrow';
  if (n < 0) return `${-n} day${n === -1 ? '' : 's'} ago`;
  return `in ${n} days`;
}

// Reminders (database rows) → calendar events
export const reminderEvent = (r) => ({ id: `rem-${r.id}`, date: r.due_date, cat: 'reminder', title: r.title, detail: r.note ?? '', reminder: r });
