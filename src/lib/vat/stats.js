// V64 — VAT Invoice: figures for the dashboard, RAMIS dashboard and reports (from issued documents only)
import { slToday, daysBetween } from './format';

export const issued = (docs) => docs.filter((d) => d.status === 'issued');
export const sign = (d) => (d.doc_type === 'credit' ? -1 : 1);
export const isInvoice = (d) => d.doc_type === 'tax' || d.doc_type === 'nontax';
export const inRange = (date, from, to) => (!from || date >= from) && (!to || date <= to);
const r2 = (x) => Math.round(x * 100) / 100;

export function periodRange(key, today = slToday()) {
  const [y, m] = today.split('-').map(Number);
  const iso = (yy, mm, dd) => `${yy}-${String(mm).padStart(2, '0')}-${String(dd).padStart(2, '0')}`;
  const lastDay = (yy, mm) => new Date(Date.UTC(yy, mm, 0)).getUTCDate();
  const dow = (new Date(`${today}T00:00:00Z`).getUTCDay() + 6) % 7;     // Monday = 0
  switch (key) {
    case 'today': return [today, today];
    case 'week': { const d = new Date(`${today}T00:00:00Z`); d.setUTCDate(d.getUTCDate() - dow); return [d.toISOString().slice(0, 10), today]; }
    case 'month': return [iso(y, m, 1), iso(y, m, lastDay(y, m))];
    case 'prev_month': { const pm = m === 1 ? 12 : m - 1, py = m === 1 ? y - 1 : y; return [iso(py, pm, 1), iso(py, pm, lastDay(py, pm))]; }
    case 'quarter': { const q0 = Math.floor((m - 1) / 3) * 3 + 1; return [iso(y, q0, 1), iso(y, q0 + 2, lastDay(y, q0 + 2))]; }
    case 'ya': { const s = m >= 4 ? y : y - 1; return [iso(s, 4, 1), iso(s + 1, 3, 31)]; }   // Sri Lankan year of assessment
    case 'year': return [iso(y, 1, 1), iso(y, 12, 31)];
    default: return [null, null];
  }
}
export const PERIODS = [['today', 'Today'], ['week', 'This week'], ['month', 'This month'], ['prev_month', 'Previous month'], ['quarter', 'This quarter'], ['ya', 'Year of assessment'], ['custom', 'Custom range']];

/** Sales of a period: invoices + debit notes − credit notes */
export function salesSummary(docs, from, to) {
  const ds = issued(docs).filter((d) => inRange(d.issue_date, from, to));
  const sum = (pred, f) => r2(ds.filter(pred).reduce((a, d) => a + sign(d) * Number(d[f] || 0), 0));
  return {
    invoices: ds.filter(isInvoice).length,
    tax: ds.filter((d) => d.doc_type === 'tax').length,
    nontax: ds.filter((d) => d.doc_type === 'nontax').length,
    credits: ds.filter((d) => d.doc_type === 'credit').length,
    debits: ds.filter((d) => d.doc_type === 'debit').length,
    credit_total: r2(ds.filter((d) => d.doc_type === 'credit').reduce((a, d) => a + Number(d.total), 0)),
    debit_total: r2(ds.filter((d) => d.doc_type === 'debit').reduce((a, d) => a + Number(d.total), 0)),
    net: sum(() => true, 'net_total'),
    taxable: sum((d) => d.is_tax, 'taxable_standard'),
    zero: sum((d) => d.is_tax, 'taxable_zero'),
    exempt: sum((d) => d.is_tax, 'exempt_amount'),
    vat: sum((d) => d.is_tax, 'vat_total'),
    total: sum(() => true, 'total'),
    gross_invoiced: r2(ds.filter(isInvoice).reduce((a, d) => a + Number(d.total), 0)),
  };
}

export function receivables(docs, asOf = slToday()) {
  const open = issued(docs).filter((d) => isInvoice(d) && Number(d.balance) > 0);
  const b = { current: 0, d1_30: 0, d31_60: 0, d61_90: 0, d91_120: 0, d120: 0 };
  let overdue = 0, overdueN = 0;
  for (const d of open) {
    const age = daysBetween(d.due_date || d.issue_date, asOf);
    const v = Number(d.balance);
    if (age <= 0) b.current += v; else if (age <= 30) b.d1_30 += v; else if (age <= 60) b.d31_60 += v; else if (age <= 90) b.d61_90 += v; else if (age <= 120) b.d91_120 += v; else b.d120 += v;
    if (age > 0) { overdue += v; overdueN += 1; }
  }
  Object.keys(b).forEach((k) => { b[k] = r2(b[k]); });
  return { buckets: b, outstanding: r2(open.reduce((a, d) => a + Number(d.balance), 0)), open: open.length, overdue: r2(overdue), overdueN };
}
export const AGING = [['current', 'Current'], ['d1_30', '1–30'], ['d31_60', '31–60'], ['d61_90', '61–90'], ['d91_120', '91–120'], ['d120', '120+']];

export function lastMonths(n = 12, today = slToday()) {
  const [y, m] = today.split('-').map(Number);
  return Array.from({ length: n }, (_, i) => {
    const d = new Date(Date.UTC(y, m - 1 - (n - 1 - i), 1));
    return { key: d.toISOString().slice(0, 7), label: d.toLocaleDateString('en-GB', { month: 'short', timeZone: 'UTC' }) };
  });
}

export const RAMIS_PENDING = ['ready', 'queued', 'submitting', 'submitted'];
export function ramisCounts(docs, from, to) {
  const ds = issued(docs).concat(docs.filter((d) => d.status === 'cancelled' && d.ramis_status === 'rejected')).filter((d) => d.is_tax && inRange(d.issue_date, from, to));
  const c = (pred) => ds.filter(pred).length;
  return {
    total: ds.length,
    submitted: c((d) => ['submitted', 'accepted', 'locked'].includes(d.ramis_status)),
    accepted: c((d) => ['accepted', 'locked'].includes(d.ramis_status)),
    rejected: c((d) => d.ramis_status === 'rejected'),
    failed: c((d) => d.ramis_status === 'failed'),
    pending: c((d) => RAMIS_PENDING.includes(d.ramis_status)),
    not_sent: c((d) => d.ramis_status === 'draft'),
    credits: c((d) => d.doc_type === 'credit'),
    debits: c((d) => d.doc_type === 'debit'),
    taxable: r2(ds.filter((d) => d.status === 'issued').reduce((a, d) => a + sign(d) * Number(d.net_total), 0)),
    vat: r2(ds.filter((d) => d.status === 'issued').reduce((a, d) => a + sign(d) * Number(d.vat_total), 0)),
    value: r2(ds.filter((d) => d.status === 'issued').reduce((a, d) => a + sign(d) * Number(d.total), 0)),
  };
}
