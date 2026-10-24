// Firm profile (Settings → Firm Profile). Small on purpose: loaded at app start.
// Firm profile used on every statement, invoice and message.
// Defaults below; Settings → Firm Profile overrides them (loaded at app start).
export const FIRM_DEFAULTS = {
  name: 'TaxMate Solutions',
  tagline: 'Your Trusted Tax & Accounting Partner in Sri Lanka',
  email: 'info@taxmatesolutions.com',
  phone: '0719 404 604',
  whatsapp: '0719 404 604',
  web: 'www.taxmatesolutions.com',
  facebook: 'TaxMateSolutions.lk',
  address: '',
  regNo: '',
};
export const FIRM = { ...FIRM_DEFAULTS };
// Full link to the firm website (Firm Profile → Web), e.g. https://www.taxmatesolutions.com
export const websiteUrl = () => { const w = String(FIRM.web || FIRM_DEFAULTS.web).trim(); return /^https?:\/\//i.test(w) ? w : `https://${w}`; };
export const websiteLabel = () => websiteUrl().replace(/^https?:\/\//i, '').replace(/\/$/, '');
export function applyFirm(v) {
  Object.assign(FIRM, FIRM_DEFAULTS);
  if (v) for (const [k, val] of Object.entries(v)) if (k in FIRM_DEFAULTS && val !== null && val !== undefined && String(val).trim() !== '') FIRM[k] = String(val).trim();
}

// Sri Lankan numbers → international format for wa.me (0771234567 → 94771234567)
export function waNumber(phone) {
  let d = String(phone || '').replace(/\D/g, '');
  if (!d) return '';
  if (d.startsWith('00')) d = d.slice(2);
  if (d.startsWith('0')) d = '94' + d.slice(1);
  if (d.length === 9) d = '94' + d;
  return d;
}

