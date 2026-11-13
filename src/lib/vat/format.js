// V64 — VAT Invoice: formatting, labels, status colours, amount in words
import { t } from './i18n';

const n2 = (x) => Number(x || 0);
/** 12,345.67 (always 2 decimals — VAT amounts are shown to the cent) */
export const money = (x) => n2(x).toLocaleString('en-LK', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
export const rs = (x) => `Rs. ${money(x)}`;
export const qty = (x) => {
  const v = n2(x);
  return Number.isInteger(v) ? v.toLocaleString('en-LK') : v.toLocaleString('en-LK', { maximumFractionDigits: 4 });
};
export const dmy = (d) => (d ? new Date(`${String(d).slice(0, 10)}T00:00:00`).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' }) : '—');
export const dmyNum = (d) => (d ? String(d).slice(0, 10).split('-').reverse().join('.') : '—');
export const dt = (d) => (d ? new Date(d).toLocaleString('en-GB', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' }) : '—');
/** Today in Sri Lanka (UTC+5:30) as YYYY-MM-DD */
export const slToday = () => new Date(Date.now() + 5.5 * 3600e3).toISOString().slice(0, 10);
export const addDays = (iso, days) => { const d = new Date(`${iso}T00:00:00Z`); d.setUTCDate(d.getUTCDate() + Number(days || 0)); return d.toISOString().slice(0, 10); };
export const daysBetween = (a, b) => Math.round((new Date(`${b}T00:00:00Z`) - new Date(`${a}T00:00:00Z`)) / 86400000);

export const DOC_TYPES = {
  tax: { key: 'tax', label: () => t('doc.tax'), title: 'TAX INVOICE', short: 'Tax invoice', prefix: 'TI' },
  nontax: { key: 'nontax', label: () => t('doc.nontax'), title: 'NON-TAX INVOICE', short: 'Invoice', prefix: 'NT' },
  credit: { key: 'credit', label: () => t('doc.credit'), title: 'CREDIT NOTE', short: 'Credit note', prefix: 'CN' },
  debit: { key: 'debit', label: () => t('doc.debit'), title: 'DEBIT NOTE', short: 'Debit note', prefix: 'DN' },
};
export const docTitle = (d) => {
  if (d.doc_type === 'credit') return d.is_tax ? 'TAX CREDIT NOTE' : 'CREDIT NOTE';
  if (d.doc_type === 'debit') return d.is_tax ? 'TAX DEBIT NOTE' : 'DEBIT NOTE';
  return DOC_TYPES[d.doc_type]?.title || 'INVOICE';
};

// colours: green done · red problem · orange waiting · grey draft
export const RAMIS = {
  na: { label: 'Not for RAMIS', cls: 'bg-gray-50 text-gray-400 border-gray-200' },
  draft: { label: 'RAMIS off', cls: 'bg-gray-100 text-gray-600 border-gray-200' },
  ready: { label: 'Ready for RAMIS', cls: 'bg-sky-50 text-sky-700 border-sky-200' },
  validating: { label: 'Validating', cls: 'bg-amber-50 text-amber-700 border-amber-200' },
  queued: { label: 'Queued', cls: 'bg-amber-50 text-amber-700 border-amber-200' },
  submitting: { label: 'Submitting', cls: 'bg-amber-50 text-amber-700 border-amber-200' },
  submitted: { label: 'Submitted to RAMIS', cls: 'bg-green-50 text-green-700 border-green-200' },
  accepted: { label: 'RAMIS accepted · Locked', cls: 'bg-green-100 text-green-800 border-green-300' },
  locked: { label: 'Locked', cls: 'bg-green-100 text-green-800 border-green-300' },
  rejected: { label: 'RAMIS rejected', cls: 'bg-red-50 text-red-700 border-red-200' },
  failed: { label: 'RAMIS failed', cls: 'bg-red-50 text-red-700 border-red-200' },
};
export const SUB_STATUS = {
  pending_config: { label: 'Pending configuration', cls: 'bg-amber-50 text-amber-800 border-amber-200' },
  queued: { label: 'Queued', cls: 'bg-amber-50 text-amber-700 border-amber-200' },
  submitting: { label: 'Submitting', cls: 'bg-amber-50 text-amber-700 border-amber-200' },
  retrying: { label: 'Retrying', cls: 'bg-orange-50 text-orange-700 border-orange-200' },
  submitted: { label: 'Submitted', cls: 'bg-green-50 text-green-700 border-green-200' },
  accepted: { label: 'Accepted', cls: 'bg-green-100 text-green-800 border-green-300' },
  rejected: { label: 'Rejected', cls: 'bg-red-50 text-red-700 border-red-200' },
  failed: { label: 'Failed', cls: 'bg-red-50 text-red-700 border-red-200' },
  cancelled: { label: 'Withdrawn', cls: 'bg-gray-50 text-gray-500 border-gray-200' },
};
export const PAY = {
  unpaid: { label: 'Unpaid', cls: 'bg-amber-50 text-amber-800 border-amber-200' },
  partial: { label: 'Partly paid', cls: 'bg-sky-50 text-sky-700 border-sky-200' },
  paid: { label: 'Paid', cls: 'bg-green-50 text-green-700 border-green-200' },
  overpaid: { label: 'Overpaid', cls: 'bg-violet-50 text-violet-700 border-violet-200' },
  cancelled: { label: 'Cancelled', cls: 'bg-gray-100 text-gray-500 border-gray-200' },
  na: { label: '—', cls: 'bg-gray-50 text-gray-400 border-gray-200' },
};
export const DOC_STATUS = {
  draft: { label: 'Draft', cls: 'bg-gray-100 text-gray-600 border-gray-200' },
  issued: { label: 'Issued', cls: 'bg-primary-50 text-primary-700 border-primary-200' },
  cancelled: { label: 'Cancelled', cls: 'bg-gray-100 text-gray-500 border-gray-300 line-through' },
};
export const APPROVAL = {
  pending: { label: 'Pending review', cls: 'bg-amber-50 text-amber-800 border-amber-200' },
  approved: { label: 'Approved', cls: 'bg-green-50 text-green-700 border-green-200' },
  matched: { label: 'Matched', cls: 'bg-green-100 text-green-800 border-green-300' },
  rejected: { label: 'Rejected', cls: 'bg-red-50 text-red-700 border-red-200' },
  disputed: { label: 'Disputed', cls: 'bg-orange-50 text-orange-700 border-orange-200' },
};
export const SUBSCRIPTION = {
  none: { label: 'Not active', cls: 'bg-gray-100 text-gray-600 border-gray-200' },
  trial: { label: 'Trial', cls: 'bg-sky-50 text-sky-700 border-sky-200' },
  active: { label: 'Active', cls: 'bg-green-50 text-green-700 border-green-200' },
  past_due: { label: 'Payment overdue', cls: 'bg-orange-50 text-orange-700 border-orange-200' },
  paused: { label: 'Paused', cls: 'bg-gray-100 text-gray-600 border-gray-200' },
  suspended: { label: 'Suspended', cls: 'bg-red-50 text-red-700 border-red-200' },
  expired: { label: 'Expired', cls: 'bg-red-50 text-red-700 border-red-200' },
  cancelled: { label: 'Cancelled', cls: 'bg-gray-100 text-gray-600 border-gray-200' },
};
export const METHODS = { cash: 'Cash', bank_transfer: 'Bank transfer', cheque: 'Cheque', card: 'Card', mobile: 'Mobile payment', online: 'Online payment', other: 'Other' };
export const CREDIT_REASONS = { return: 'Sales return', overcharge: 'Overcharged amount', quantity: 'Incorrect quantity', vat_error: 'Incorrect VAT', cancellation: 'Invoice cancellation / adjustment', discount: 'Discount after sale', other: 'Other' };
export const DEBIT_REASONS = { undercharge: 'Undercharged amount', additional: 'Additional supply', price: 'Price adjustment', vat_under: 'VAT understatement', charge: 'Additional charge', other: 'Other' };
export const ROLES = {
  owner: 'Owner', taxmate: 'TaxMate', admin: 'Admin', accountant: 'Accountant', invoice_operator: 'Invoice operator',
  viewer: 'Viewer', purchaser: 'Purchaser', approver: 'Approver',
};
export const TERMS = [[0, 'Due immediately'], [7, '7 days'], [14, '14 days'], [30, '30 days'], [45, '45 days'], [60, '60 days']];
export const TEMPLATES = [
  { key: 'classic', name: 'Template 01 – Classic Professional' },
  { key: 'modern', name: 'Template 02 – Modern Business' },
  { key: 'minimal', name: 'Template 03 – Minimal' },
  { key: 'corporate', name: 'Template 04 – Corporate' },
  { key: 'compliance', name: 'Template 05 – Tax Compliance' },
];

// ── Amount in words (Sri Lankan Rupees) ──
const ONES = ['', 'One', 'Two', 'Three', 'Four', 'Five', 'Six', 'Seven', 'Eight', 'Nine', 'Ten', 'Eleven', 'Twelve', 'Thirteen', 'Fourteen', 'Fifteen', 'Sixteen', 'Seventeen', 'Eighteen', 'Nineteen'];
const TENS = ['', '', 'Twenty', 'Thirty', 'Forty', 'Fifty', 'Sixty', 'Seventy', 'Eighty', 'Ninety'];
function below1000(n) {
  const h = Math.floor(n / 100), r = n % 100;
  const rest = r < 20 ? ONES[r] : `${TENS[Math.floor(r / 10)]}${r % 10 ? ` ${ONES[r % 10]}` : ''}`;
  return [h ? `${ONES[h]} Hundred` : '', rest].filter(Boolean).join(' ');
}
function words(n) {
  if (n === 0) return 'Zero';
  const parts = [];
  for (const [v, w] of [[1e12, 'Trillion'], [1e9, 'Billion'], [1e6, 'Million'], [1e3, 'Thousand']]) {
    if (n >= v) { parts.push(`${below1000(Math.floor(n / v) % 1000 || Math.floor(n / v))} ${w}`); n %= v; }
  }
  if (n) parts.push(below1000(n));
  return parts.join(' ');
}
export function amountInWords(x) {
  const v = Math.round(Math.abs(n2(x)) * 100);
  const rupees = Math.floor(v / 100), cents = v % 100;
  return `${words(rupees)} Rupees${cents ? ` and ${words(cents)} Cents` : ''} Only`;
}
