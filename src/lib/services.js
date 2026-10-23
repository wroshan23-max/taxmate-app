// Services clients can request / book from the portal
export const SERVICE_CARDS = [
  { name: 'Individual Income Tax Return', emoji: '🧾', desc: 'Prepare & file your IIT return in RAMIS', si: 'පුද්ගල ආදායම් බදු ප්‍රකාශය' },
  { name: 'TIN Registration', emoji: '🆔', desc: 'Get your Taxpayer Identification Number', si: 'TIN ලියාපදිංචිය' },
  { name: 'Company Tax Return', emoji: '🏢', desc: 'Corporate income tax return & compliance', si: 'සමාගම් බදු ප්‍රකාශය' },
  { name: 'VAT', emoji: '🧮', desc: 'VAT registration & monthly / quarterly returns', si: 'වැට් බදු' },
  { name: 'PAYE / APIT', emoji: '👥', desc: 'Employee tax (APIT) calculations & filing', si: 'APIT' },
  { name: 'RAMIS account help', emoji: '🔐', desc: 'RAMIS login, PIN reset, e-services', si: 'RAMIS සහාය' },
  { name: 'Accounting & Bookkeeping', emoji: '📚', desc: 'Monthly books, ledgers & management accounts', si: 'ගිණුම් තැබීම' },
  { name: 'Financial Statements', emoji: '📊', desc: 'P&L, balance sheet & cash-flow statements', si: 'මූල්‍ය ප්‍රකාශන' },
  { name: 'Payroll & EPF/ETF', emoji: '💼', desc: 'Monthly payroll with EPF / ETF', si: 'වැටුප් ලේඛන' },
  { name: 'Tax Consultation', emoji: '💡', desc: 'One-to-one tax planning & advice', si: 'බදු උපදෙස්' },
  { name: 'Other', emoji: '✨', desc: 'Something else? Tell us what you need', si: 'වෙනත්' },
];
export const cardFor = (name) => SERVICE_CARDS.find(s => s.name === name) ?? { name, emoji: '📌', desc: '' };

export const TIMES = { morning: 'Morning (9–12)', afternoon: 'Afternoon (12–4)', evening: 'Evening (4–7)', any: 'Any time' };
export const CONTACTS = { whatsapp: ['💬', 'WhatsApp'], call: ['📞', 'Phone call'], office: ['🏢', 'Visit the office'], online: ['💻', 'Online meeting'] };
export const SR_STATUS = {
  new:         { label: 'New', cls: 'bg-amber-100 text-amber-800', si: 'ලැබුණා' },
  contacted:   { label: 'Contacted', cls: 'bg-blue-100 text-blue-700', si: 'සම්බන්ධ කළා' },
  scheduled:   { label: 'Scheduled', cls: 'bg-indigo-100 text-indigo-700', si: 'වේලාව යොදා ඇත' },
  in_progress: { label: 'In progress', cls: 'bg-violet-100 text-violet-700', si: 'කරමින්' },
  done:        { label: 'Done', cls: 'bg-emerald-100 text-emerald-700', si: 'අවසන්' },
  cancelled:   { label: 'Cancelled', cls: 'bg-gray-100 text-gray-600', si: 'අවලංගුයි' },
};
