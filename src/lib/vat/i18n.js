// V64 — VAT Invoice labels. English is primary; Sinhala / Tamil fall back to English for any
// label not translated yet, so new labels can be added here without touching the screens.
const en = {
  'app.title': 'VAT Invoice & Billing',
  'nav.dashboard': 'Dashboard', 'nav.invoices': 'Invoices', 'nav.all': 'All documents', 'nav.tax': 'Tax invoices', 'nav.nontax': 'Non-tax invoices',
  'nav.credit': 'Credit notes', 'nav.debit': 'Debit notes', 'nav.customers': 'Customers', 'nav.items': 'Products & services', 'nav.payments': 'Payments',
  'nav.vat': 'VAT / RAMIS', 'nav.ramis': 'RAMIS dashboard', 'nav.schedules': 'VAT schedules', 'nav.purchases': 'Purchaser VAT inbox',
  'nav.history': 'Submission history', 'nav.failed': 'Failed submissions', 'nav.reports': 'Reports', 'nav.settings': 'Settings',
  'nav.subscription': 'Subscription', 'nav.audit': 'Audit trail', 'nav.guide': 'User guide',
  'doc.tax': 'Tax Invoice', 'doc.nontax': 'Non-Tax Invoice', 'doc.credit': 'Credit Note', 'doc.debit': 'Debit Note',
  'act.new_tax': 'New Tax Invoice', 'act.new_nontax': 'New Non-Tax Invoice', 'act.new_credit': 'New Credit Note', 'act.new_debit': 'New Debit Note',
  'act.issue': 'Issue', 'act.save_draft': 'Save draft', 'act.share': 'Share', 'act.remind': 'Remind', 'act.pay': 'Record payment',
  'act.submit_ramis': 'Submit to RAMIS', 'act.pdf': 'PDF / Print', 'act.cancel': 'Cancel document', 'act.copy': 'Duplicate',
  'locked': 'Submitted to IRD/RAMIS – Locked',
  'locked.msg': 'This invoice has already been submitted to RAMIS and cannot be edited or deleted. Create a Credit Note or Debit Note to correct the transaction.',
  'disclaimer': 'TaxMate provides invoicing and RAMIS integration functionality based on the applicable IRD specifications and available API documentation. Users remain responsible for the accuracy of invoice information and tax treatment.',
  'ramis.pending': 'RAMIS Integration Pending Configuration',
};
const si = {
  'app.title': 'VAT ඉන්වොයිස් සහ බිල්පත්', 'nav.dashboard': 'උපකරණ පුවරුව', 'nav.invoices': 'ඉන්වොයිස්', 'nav.customers': 'ගනුදෙනුකරුවන්',
  'nav.payments': 'ගෙවීම්', 'nav.reports': 'වාර්තා', 'nav.settings': 'සැකසුම්', 'nav.guide': 'භාවිත මාර්ගෝපදේශය', 'doc.tax': 'බදු ඉන්වොයිසිය', 'doc.credit': 'ණය සටහන', 'doc.debit': 'හර සටහන',
};
const ta = {
  'app.title': 'VAT விலைப்பட்டியல்', 'nav.dashboard': 'முகப்பு', 'nav.invoices': 'விலைப்பட்டியல்கள்', 'nav.customers': 'வாடிக்கையாளர்கள்',
  'nav.payments': 'கொடுப்பனவுகள்', 'nav.reports': 'அறிக்கைகள்', 'nav.settings': 'அமைப்புகள்', 'nav.guide': 'பயனர் வழிகாட்டி', 'doc.tax': 'வரி விலைப்பட்டியல்',
};
const DICT = { en, si, ta };
let locale = 'en';
export const setLocale = (l) => { locale = DICT[l] ? l : 'en'; };
export const getLocale = () => locale;
export const t = (key) => DICT[locale]?.[key] ?? en[key] ?? key;
