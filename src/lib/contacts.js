// Contact person (e.g. a son / daughter who coordinates a parent's tax work)
// and client self-registration links.
import { FIRM } from './iitStatement';

export const RELATIONS = ['Son', 'Daughter', 'Spouse', 'Father', 'Mother', 'Brother', 'Sister', 'Relative', 'Friend', 'Accountant / Agent', 'Other'];

export const hasContact = (c) => !!(c?.contact_name || c?.contact_mobile || c?.contact_email);
export const contactLabel = (c) => [c?.contact_name, c?.contact_relation && `(${c.contact_relation})`].filter(Boolean).join(' ');

// Who to message, preferred first. Pass to <MessageMenu recipients=…> / <SendMenu recipients=…>
export function recipientsOf(c, { phone, email } = {}) {
  if (!c) return undefined;
  const client = { key: 'client', label: `Client — ${c.full_name ?? ''}`.trim(), phone: phone ?? c.mobile, email: email ?? c.email };
  if (!hasContact(c)) return undefined;   // only the client → plain menu
  const contact = { key: 'contact', label: `Contact — ${contactLabel(c)}${c.contact_preferred ? ' ★' : ''}`, phone: c.contact_mobile, email: c.contact_email };
  return c.contact_preferred ? [contact, client] : [client, contact];
}

// Greeting name for messages: the contact person when they coordinate
export const greetName = (c) => (c?.contact_preferred && c?.contact_name) ? c.contact_name : c?.full_name;

// ─── Registration links ──────────────────────────────────
export const registerUrl = (token) => `${window.location.origin}/register/${token}`;
export const joinUrl = (code) => `${window.location.origin}/join/${code}`;

export function registrationMessage({ name, url }) {
  const first = (name || '').trim().split(/\s+/).slice(-1)[0];
  return [
    `Dear ${first || 'Sir/Madam'},`, '',
    `Thank you for choosing ${FIRM.name}. Please fill in your details using this secure link (valid for 14 days):`,
    url, '',
    `If you are filling it for a family member (e.g. your father or mother), you can add your own name and number as the contact person.`, '',
    `ඔබගේ විස්තර මෙම link එක හරහා පුරවා එවන්න. දෙමාපියන් වෙනුවෙන් පුරවනවා නම්, ඔබගේ නම සහ දුරකථන අංකය "contact person" ලෙස එකතු කරන්න.`, '',
    'Thank you,', FIRM.name, `WhatsApp ${FIRM.whatsapp}`,
  ].join('\n');
}

export const SERVICES = [
  'Individual Income Tax Return', 'TIN Registration', 'Company Tax Return', 'VAT', 'PAYE / APIT',
  'RAMIS account help', 'Accounting & Bookkeeping', 'Financial Statements', 'Tax Consultation',
  'Payroll & EPF/ETF', 'Other',
];
