// Invoice settings (Settings → Invoices). Small on purpose: loaded at app start.
export const SERVICE_CATALOG = [
  { name: 'IIT Return – Employed',         price: 2500 },
  { name: 'IIT Return – Self-Employed',    price: 5000 },
  { name: 'IIT Return – Complex',          price: 8000 },
  { name: 'TIN Registration',              price: 2000 },
  { name: 'Company Tax Return',            price: 15000 },
  { name: 'VAT Return (Monthly)',          price: 3500 },
  { name: 'VAT Return (Quarterly)',        price: 5000 },
  { name: 'VAT Registration',              price: 5000 },
  { name: 'PAYE / APIT Filing',            price: 3000 },
  { name: 'RAMIS Account Handling',        price: 2000 },
  { name: 'Accounting & Bookkeeping',      price: 8000 },
  { name: 'Financial Statements',          price: 12000 },
  { name: 'Tax Consultation (1 hr)',       price: 3000 },
  { name: 'Payroll & EPF/ETF Support',     price: 5000 },
  { name: 'Financial Advisory',            price: 5000 },
  { name: 'Digital Bookkeeping Setup',     price: 10000 },
];

export const DEFAULT_NOTE = 'Thank you for choosing TaxMate Solutions. Please make payment within the due date.';

// Invoice settings (Settings → Invoices). Defaults match V16.
export const INVOICE_DEFAULTS = { prefix: 'TM-INV', dueDays: 14, defaultNote: DEFAULT_NOTE, catalog: SERVICE_CATALOG };
export const INVOICE_CFG = { ...INVOICE_DEFAULTS, catalog: [...SERVICE_CATALOG] };
export function applyInvoiceSettings(v) {
  Object.assign(INVOICE_CFG, INVOICE_DEFAULTS, { catalog: [...SERVICE_CATALOG] });
  if (!v) return;
  if (typeof v.prefix === 'string' && /^[A-Za-z0-9-]{1,16}$/.test(v.prefix.trim())) INVOICE_CFG.prefix = v.prefix.trim().toUpperCase();
  const d = parseInt(v.dueDays, 10); if (d >= 0 && d <= 365) INVOICE_CFG.dueDays = d;
  if (typeof v.defaultNote === 'string' && v.defaultNote.trim()) INVOICE_CFG.defaultNote = v.defaultNote.trim();
  if (Array.isArray(v.catalog)) INVOICE_CFG.catalog = v.catalog.filter(x => x && String(x.name || '').trim()).map(x => ({ name: String(x.name).trim(), price: Number(x.price) || 0 }));
}
