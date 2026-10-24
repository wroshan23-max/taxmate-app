// ═══════════════════════════════════════════════════════════
//  IRD payment codes — Tax Type Code, Payment Period Code, Payment Category
//  Source: IRD Tax Calendar 2026 (ird.gov.lk → Publications → Tax Calendar),
//  IRD "How to pay your taxes" quick guide, and IRD payment notices
//  (e.g. APIT / AIT July 2026: codes 03 / 43 / 44, period 26070, category S).
//  The period-code rules below reproduce every payment row of the 2026 calendar.
//  Check the new IRD Tax Calendar each January.
// ═══════════════════════════════════════════════════════════

export const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
const MON = MONTHS.map(m => m.slice(0, 3));
const pad = (n) => String(n).padStart(2, '0');
const yy = (y) => pad(y % 100);
const lastDay = (y, m) => new Date(y, m, 0).getDate();
const nextMonth = (y, m) => (m === 12 ? { y: y + 1, m: 1 } : { y, m: m + 1 });
const qOf = (m) => Math.ceil(m / 3);                 // calendar quarter 1..4
const mInQ = (m) => ((m - 1) % 3) + 1;               // month within quarter 1..3
const QLBL = { 1: 'Jan–Mar', 2: 'Apr–Jun', 3: 'Jul–Sep', 4: 'Oct–Dec' };
export const quarterLabel = (q, y) => `Q${q} ${y} (${QLBL[q]})`;
export const yaLabel = (s) => `${s}/${String(s + 1).slice(2)}`;
const iso = (y, m, d) => `${y}-${pad(m)}-${pad(d)}`;

export const PAY_CHANNELS = 'Online: IRD Online Tax Payment Platform (OTPP). At the bank: Bank of Ceylon or People\'s Bank with a paying-in slip — no pre-printed slip? Get a DIN from eservices.ird.gov.lk (Payment → Paying-in Slip).';
export const CATEGORY_S = { code: 'S', label: 'Self assessment', note: 'Use S for normal monthly / quarterly / instalment / final payments you work out yourself.' };
export const ASSESSMENT_NOTE = 'Paying an IRD assessment, penalty or arrears? Use the Assessment No. and Charge No. printed on the IRD notice, and check the payment category on that notice or on the back of the paying-in slip.';

// kind: monthly | quarterly | instalment | annual | vatm | vatq | ssclq | stampq
export const TAX_TYPES = [
  // ── Payments ──
  { key: 'apit', group: 'pay', code: '03', name: 'APIT', full: 'Advance Personal Income Tax (APIT / PAYE)', si: 'වැටුප් බද්ද (APIT)', who: 'Employers — tax deducted from salaries', kind: 'monthly', fmt: 'YY MM 0', dueDay: 15, emoji: '👔' },
  { key: 'wht43', group: 'pay', code: '43', name: 'AIT / WHT on Interest', full: 'Advance Income Tax / WHT on interest', si: 'පොලී මත AIT/WHT', who: 'Banks & others paying interest', kind: 'monthly', fmt: 'YY MM 0', dueDay: 15, emoji: '🏦' },
  { key: 'wht44', group: 'pay', code: '44', name: 'AIT / WHT on Fees & Others', full: 'Advance Income Tax / WHT on service fees, rent & other payments', si: 'ගාස්තු/කුලී මත AIT/WHT', who: 'Withholding agents', kind: 'monthly', fmt: 'YY MM 0', dueDay: 15, emoji: '🧾' },
  { key: 'iit', group: 'pay', code: '05', name: 'Individual Income Tax', full: 'Individual Income Tax (IIT) — quarterly instalments & final payment', si: 'පුද්ගල ආදායම් බද්ද', who: 'Individuals', kind: 'instalment', fmt: 'YY YY i', emoji: '🙋' },
  { key: 'cit', group: 'pay', code: '02', name: 'Corporate Income Tax', full: 'Corporate Income Tax (CIT) — quarterly instalments & final payment', si: 'සමාගම් ආදායම් බද්ද', who: 'Companies', kind: 'instalment', fmt: 'YY YY i', emoji: '🏢' },
  { key: 'pit', group: 'pay', code: '09', name: 'Partnership Income Tax', full: 'Partnership Income Tax (PIT) — quarterly instalments & final payment', si: 'හවුල් ව්‍යාපාර ආදායම් බද්ද', who: 'Partnerships', kind: 'instalment', fmt: 'YY YY i', emoji: '🤝' },
  { key: 'vat', group: 'pay', code: '70', name: 'VAT', full: 'Value Added Tax (VAT) — monthly payment', si: 'එකතු කළ අගය මත බද්ද (VAT)', who: 'VAT-registered businesses', kind: 'vatm', fmt: 'YY Q M 0', dueDay: 20, emoji: '🛒' },
  { key: 'sscl', group: 'pay', code: '32', name: 'SSCL', full: 'Social Security Contribution Levy (SSCL) — monthly payment', si: 'සමාජ ආරක්ෂණ දායක බද්ද (SSCL)', who: 'SSCL-registered businesses', kind: 'ssclm', fmt: 'YY Q 0 M', dueDay: 20, emoji: '🛡️' },
  { key: 'vatfs', group: 'pay', code: '75', name: 'VAT on Financial Services', full: 'VAT on Financial Services — monthly payment', si: 'මූල්‍ය සේවා මත VAT', who: 'Banks & financial institutions', kind: 'monthly', fmt: 'YY MM 0', dueDay: 20, emoji: '💹' },
  { key: 'stamp', group: 'pay', code: '60', name: 'Stamp Duty (compounded)', full: 'Stamp Duty compounded — quarterly payment', si: 'මුද්දර ගාස්තු (සංයුක්ත)', who: 'Approved compounded stamp duty payers', kind: 'stampq', fmt: 'YY MM 0 (last month of quarter)', emoji: '📮' },
  // ── Returns & statements (no payment) ──
  { key: 'r_it', group: 'ret', code: '02 / 05 / 09', name: 'Income Tax Return', full: 'Return of Income — individuals, companies, partnerships', si: 'ආදායම් බදු වාර්තාව', who: 'All income tax payers', kind: 'r_annual', fmt: 'YY YY', emoji: '📑' },
  { key: 'r_set', group: 'ret', code: '—', name: 'Statement of Estimated Tax (SET)', full: 'Statement of Estimated Tax (SET)', si: 'ඇස්තමේන්තුගත බදු ප්‍රකාශය', who: 'Income tax payers who must pay instalments', kind: 'r_set', fmt: 'YY YY', emoji: '📝' },
  { key: 'r_apit', group: 'ret', code: '—', name: 'APIT Annual Statement', full: 'APIT Annual Statement of Employers', si: 'APIT වාර්ෂික ප්‍රකාශය', who: 'Employers', kind: 'r_stmt', fmt: 'YY YY', emoji: '📋' },
  { key: 'r_wht', group: 'ret', code: '—', name: 'AIT / WHT Annual Statement', full: 'AIT / WHT Annual Statement', si: 'AIT/WHT වාර්ෂික ප්‍රකාශය', who: 'Withholding agents', kind: 'r_stmt', fmt: 'YY YY', emoji: '📋' },
  { key: 'r_vatm', group: 'ret', code: '—', name: 'VAT Return — monthly', full: 'VAT Return — monthly filers', si: 'මාසික VAT වාර්තාව', who: 'Monthly VAT filers', kind: 'r_vatm', fmt: 'YY Q M', emoji: '📗' },
  { key: 'r_vatq', group: 'ret', code: '—', name: 'VAT Return — quarterly', full: 'VAT Return — quarterly filers', si: 'කාර්තුමය VAT වාර්තාව', who: 'Quarterly VAT filers', kind: 'r_q', qDue: 'last', fmt: 'YY Q 0', emoji: '📗' },
  { key: 'r_sscl', group: 'ret', code: '—', name: 'SSCL Return', full: 'SSCL Return — quarterly', si: 'SSCL කාර්තුමය වාර්තාව', who: 'SSCL-registered businesses', kind: 'r_q', qDue: 20, fmt: 'YY Q 0', emoji: '📙' },
  { key: 'r_stamp', group: 'ret', code: '—', name: 'Stamp Duty Statement', full: 'Statement of Stamp Duty Compounded — quarterly', si: 'මුද්දර ගාස්තු ප්‍රකාශය', who: 'Compounded stamp duty payers', kind: 'r_q', qDue: 15, fmt: 'YY Q 0', emoji: '📙' },
];
export const typeByKey = (k) => TAX_TYPES.find(t => t.key === k);

// What the period picker needs for each kind
export const pickerFor = (t) => ({
  monthly: 'month', vatm: 'month', ssclm: 'month', r_vatm: 'month',
  stampq: 'quarter', r_q: 'quarter',
  instalment: 'instalment',
  r_annual: 'ya', r_set: 'ya', r_stmt: 'ya',
}[t.kind]);

export const INSTALMENTS = [
  { i: 1, label: '1st instalment', covers: 'April–June' },
  { i: 2, label: '2nd instalment', covers: 'July–September' },
  { i: 3, label: '3rd instalment', covers: 'October–December' },
  { i: 4, label: '4th instalment', covers: 'January–March' },
  { i: 0, label: 'Final payment (balance)', covers: 'whole year' },
];

/**
 * Work out the codes for one tax type and period.
 * sel: { year, month } (month 1..12) | { year, quarter } | { ya, instalment } | { ya }
 * Returns { type, periodCode, periodLabel, due (ISO), dueText, parts[], category, isPayment }
 */
export function lookup(key, sel = {}) {
  const t = typeof key === 'string' ? typeByKey(key) : key;
  if (!t) return null;
  const isPayment = t.group === 'pay';
  let periodCode = '', periodLabel = '', due = '', parts = [];
  const { year, month, quarter } = sel;
  const s = Number(sel.ya);

  switch (t.kind) {
    case 'monthly': {                         // YY MM 0  (APIT, AIT/WHT, VAT on FS)
      periodCode = `${yy(year)}${pad(month)}0`;
      periodLabel = `${MONTHS[month - 1]} ${year}`;
      const n = nextMonth(year, month); due = iso(n.y, n.m, t.dueDay);
      parts = [[yy(year), `year ${year}`], [pad(month), MONTHS[month - 1]], ['0', 'always 0 for a monthly payment']];
      break;
    }
    case 'vatm': {                            // YY Q M 0  (VAT payment)
      periodCode = `${yy(year)}${qOf(month)}${mInQ(month)}0`;
      periodLabel = `${MONTHS[month - 1]} ${year}`;
      const n = nextMonth(year, month); due = iso(n.y, n.m, t.dueDay);
      parts = [[yy(year), `year ${year}`], [String(qOf(month)), `quarter ${qOf(month)} (${QLBL[qOf(month)]})`], [String(mInQ(month)), `month ${mInQ(month)} of the quarter`], ['0', 'always 0']];
      break;
    }
    case 'ssclm': {                           // YY Q 0 M  (SSCL payment)
      periodCode = `${yy(year)}${qOf(month)}0${mInQ(month)}`;
      periodLabel = `${MONTHS[month - 1]} ${year}`;
      const n = nextMonth(year, month); due = iso(n.y, n.m, t.dueDay);
      parts = [[yy(year), `year ${year}`], [String(qOf(month)), `quarter ${qOf(month)} (${QLBL[qOf(month)]})`], ['0', 'always 0'], [String(mInQ(month)), `month ${mInQ(month)} of the quarter`]];
      break;
    }
    case 'stampq': {                          // YY MM 0 with MM = last month of the quarter
      const lm = quarter * 3;
      periodCode = `${yy(year)}${pad(lm)}0`;
      periodLabel = quarterLabel(quarter, year);
      const n = nextMonth(year, lm); due = iso(n.y, n.m, 15);
      parts = [[yy(year), `year ${year}`], [pad(lm), `${MONTHS[lm - 1]} — last month of the quarter`], ['0', 'always 0']];
      break;
    }
    case 'instalment': {                      // YY YY i  (i = 1..4, 0 = final)
      const i = Number(sel.instalment ?? 1);
      periodCode = `${yy(s)}${yy(s + 1)}${i}`;
      const ins = INSTALMENTS.find(x => x.i === i);
      periodLabel = `Y/A ${yaLabel(s)} — ${ins.label}`;
      due = { 1: iso(s, 8, 15), 2: iso(s, 11, 15), 3: iso(s + 1, 2, 15), 4: iso(s + 1, 5, 15), 0: iso(s + 1, 9, 30) }[i];
      parts = [[yy(s), `Y/A starts ${s}`], [yy(s + 1), `ends ${s + 1}`], [String(i), i === 0 ? '0 = final payment' : `instalment ${i}`]];
      break;
    }
    case 'r_annual': case 'r_stmt': case 'r_set': {
      periodCode = `${yy(s)}${yy(s + 1)}`;
      periodLabel = `Y/A ${yaLabel(s)}`;
      due = t.kind === 'r_annual' ? iso(s + 1, 11, 30) : t.kind === 'r_set' ? iso(s, 8, 15) : iso(s + 1, 4, 30);
      parts = [[yy(s), `Y/A starts ${s}`], [yy(s + 1), `ends ${s + 1}`]];
      break;
    }
    case 'r_vatm': {                          // YY Q M
      periodCode = `${yy(year)}${qOf(month)}${mInQ(month)}`;
      periodLabel = `${MONTHS[month - 1]} ${year}`;
      const n = nextMonth(year, month); due = iso(n.y, n.m, lastDay(n.y, n.m));
      parts = [[yy(year), `year ${year}`], [String(qOf(month)), `quarter ${qOf(month)}`], [String(mInQ(month)), `month ${mInQ(month)} of the quarter`]];
      break;
    }
    case 'r_q': {                             // YY Q 0
      periodCode = `${yy(year)}${quarter}0`;
      periodLabel = quarterLabel(quarter, year);
      const n = nextMonth(year, quarter * 3);
      due = iso(n.y, n.m, t.qDue === 'last' ? lastDay(n.y, n.m) : t.qDue);
      parts = [[yy(year), `year ${year}`], [String(quarter), `quarter ${quarter} (${QLBL[quarter]})`], ['0', 'always 0']];
      break;
    }
    default: return null;
  }
  const wd = new Date(`${due}T00:00:00`).getDay();
  return { type: t, periodCode, periodLabel, due, dueText: fmtDue(due), weekend: wd === 0 || wd === 6, parts, category: isPayment ? CATEGORY_S : null, isPayment };
}

export function fmtDue(isoDate) {
  if (!isoDate) return '';
  const [y, m, d] = isoDate.split('-').map(Number);
  const wd = new Date(y, m - 1, d).toLocaleDateString('en-GB', { weekday: 'short' });
  return `${wd}, ${d} ${MONTHS[m - 1]} ${y}`;
}

/** Days from today (Sri Lanka) to an ISO date; negative = overdue. */
export function daysUntil(isoDate, today = new Date()) {
  const [y, m, d] = isoDate.split('-').map(Number);
  const t = new Date(today.getFullYear(), today.getMonth(), today.getDate());
  return Math.round((new Date(y, m - 1, d) - t) / 86400000);
}

/** Sensible default period for a tax type (the payment that is due next). */
export function defaultSel(t, today = new Date()) {
  const y = today.getFullYear(), m = today.getMonth() + 1, d = today.getDate();
  const prev = m === 1 ? { year: y - 1, month: 12 } : { year: y, month: m - 1 };
  const curYA = m >= 4 ? y : y - 1;           // Y/A starts 1 April
  const todayIso = iso(y, m, d);
  switch (pickerFor(t)) {
    // the month whose payment / return is due next (last month until its due date passes, then this month)
    case 'month': return lookup(t, prev).due >= todayIso ? prev : { year: y, month: m };
    case 'quarter': {
      const pq = qOf(m) - 1, last = pq === 0 ? { year: y - 1, quarter: 4 } : { year: y, quarter: pq };
      return lookup(t, last).due >= todayIso ? last : { year: y, quarter: qOf(m) };
    }
    case 'instalment': {
      // next instalment due from today
      const opts = [[curYA, 1, iso(curYA, 8, 15)], [curYA - 1, 0, iso(curYA, 9, 30)], [curYA, 2, iso(curYA, 11, 15)], [curYA, 3, iso(curYA + 1, 2, 15)], [curYA, 4, iso(curYA + 1, 5, 15)]];
      const nx = opts.find(o => o[2] >= todayIso) ?? opts[0];
      return { ya: nx[0], instalment: nx[1] };
    }
    case 'ya': return { ya: t.kind === 'r_set' ? curYA : curYA - 1 };
    default: return {};
  }
}

/** Every payment due in calendar month (Y, M) with its codes — for "Due this month". */
export function paymentsDueIn(Y, M) {
  const out = [];
  const p = M === 1 ? { y: Y - 1, m: 12 } : { y: Y, m: M - 1 };
  for (const k of ['apit', 'wht43', 'wht44', 'sscl', 'vat', 'vatfs']) out.push(lookup(k, { year: p.y, month: p.m }));
  if ([1, 4, 7, 10].includes(M)) out.push(lookup('stamp', { year: p.y, quarter: qOf(p.m) }));
  const ins = { 8: [Y, 1], 11: [Y, 2], 2: [Y - 1, 3], 5: [Y - 1, 4], 9: [Y - 1, 0] }[M];
  if (ins) for (const k of ['iit', 'cit', 'pit']) out.push(lookup(k, { ya: ins[0], instalment: ins[1] }));
  return out.filter(Boolean).sort((a, b) => a.due.localeCompare(b.due));
}

/** Plain text to paste into WhatsApp / email for a client. */
export function shareText(r, name = '') {
  const t = r.type;
  const lines = [
    `${t.full}${name ? ` — ${name}` : ''}`,
    `Period: ${r.periodLabel}`,
    ...(t.group === 'pay' ? [`Tax Type Code: ${t.code}`] : []),
    `${t.group === 'pay' ? 'Payment Period Code' : 'Period Code'}: ${r.periodCode}`,
    ...(r.category ? [`Payment Category: ${r.category.code} (${r.category.label})`] : []),
    `${t.group === 'pay' ? 'Pay on or before' : 'Due'}: ${r.dueText}`,
  ];
  if (t.group === 'pay') lines.push('', 'Pay online through IRD OTPP, or at Bank of Ceylon / People\'s Bank with a paying-in slip (write your TIN on the slip).');
  return lines.join('\n');
}

// Full code list (IRD). "current" = in the IRD Tax Calendar 2026.
export const CODE_LIST = [
  { code: '02', name: 'Corporate Income Tax (CIT)', current: true },
  { code: '03', name: 'APIT / PAYE', current: true },
  { code: '05', name: 'Individual Income Tax (IIT)', current: true },
  { code: '09', name: 'Partnership Income Tax (PIT)', current: true },
  { code: '32', name: 'Social Security Contribution Levy (SSCL)', current: true },
  { code: '43', name: 'AIT / WHT on Interest', current: true },
  { code: '44', name: 'AIT / WHT on Fees & Other payments', current: true },
  { code: '60', name: 'Stamp Duty (compounded)', current: true },
  { code: '70', name: 'Value Added Tax (VAT)', current: true },
  { code: '75', name: 'VAT on Financial Services', current: true },
  { code: '04', name: 'Dividend Tax' },
  { code: '08', name: 'Tax on Distributable Profit (Deemed Dividend Tax)' },
  { code: '12', name: 'WHT on Non-Residents' },
  { code: '13', name: 'Remittance Tax' },
  { code: '16', name: 'Vehicle Entitlement Levy' },
  { code: '18', name: 'NGO Tax' },
  { code: '23', name: 'Capital Gains Tax' },
  { code: '26', name: 'Debt Repayment Levy' },
  { code: '29', name: 'Surcharge Tax' },
  { code: '80', name: 'Economic Service Charge (ESC)' },
  { code: '90', name: 'Nation Building Tax (NBT)' },
];

export const FORMAT_GUIDE = [
  ['APIT, AIT/WHT (43, 44), VAT on FS', 'YY MM 0', '26100 = October 2026'],
  ['VAT payment', 'YY Q M 0', '26410 = October 2026 (Q4, 1st month)'],
  ['SSCL payment', 'YY Q 0 M', '26401 = October 2026 (Q4, 1st month)'],
  ['Stamp Duty compounded payment', 'YY MM 0 (last month of the quarter)', '26090 = Jul–Sep 2026'],
  ['Income tax instalment (02, 05, 09)', 'YY YY i  (i = 1–4)', '26272 = Y/A 2026/27, 2nd instalment'],
  ['Income tax final payment', 'YY YY 0', '25260 = Y/A 2025/26 final'],
  ['Income tax return, SET, annual statements', 'YY YY', '2526 = Y/A 2025/26'],
  ['VAT return (monthly)', 'YY Q M', '2641 = October 2026'],
  ['VAT / SSCL return, Stamp Duty statement (quarterly)', 'YY Q 0', '2630 = Jul–Sep 2026'],
];

export const SOURCES = [
  ['IRD Tax Calendar 2026', 'https://www.ird.gov.lk/en/publications/Tax%20Calendar_Documents/Tax_Calendar_2026_E.pdf'],
  ['IRD — How to pay your taxes', 'https://www.ird.gov.lk/en/eServices/Lists/PaymentRefund/Attachments/5/Quick_Guide_-_Tax_Payment_V_026a.pdf'],
  ['IRD e-Services — Paying-in slip / DIN', 'https://eservices.ird.gov.lk/Payment/PayingInSlip/Index'],
];

export { MON };
