// App usage tracking (admin-only reports). Fire-and-forget: never blocks the UI.
import { supabase } from './supabase';
import { deviceName } from './mfa';

let device;
export function logActivity(event, path = window.location.pathname, detail = null) {
  device ??= deviceName();
  supabase.rpc('log_activity', { p_event: event, p_path: path, p_detail: detail ? String(detail).slice(0, 200) : null, p_device: device })
    .then(() => {}, () => {});
}

/** Page labels for the usage report */
export const AREAS = {
  'client': ['🏠', 'Dashboard'],
  'client/calculations': ['🧾', 'My Calculations'],
  'client/tax-calculator': ['🧮', 'Tax Calculator'],
  'client/income': ['💰', 'Monthly Income'],
  'client/calendar': ['📅', 'Tax Calendar'],
  'client/invite': ['🎁', 'Invite Friends'],
  'client/documents': ['🗂️', 'My Documents'],
  'client/messages': ['💬', 'Messages'],
  'client/tax-returns': ['🚦', 'Tax Returns'],
  'client/assets': ['🏦', 'Assets & Liabilities'],
  'client/invoices': ['🧾', 'Invoices'],
  'client/updates': ['📣', 'Tax Updates'],
  'client/profile': ['👤', 'My Profile'],
  'client/security': ['🔐', 'Security'],
  'admin': ['🛠️', 'Admin'],
};
export const areaLabel = (a) => {
  if (!a) return ['•', 'App'];
  if (AREAS[a]) return AREAS[a];
  if (a.startsWith('admin')) return ['🛠️', `Admin · ${a.split('/')[1] || 'dashboard'}`];
  return ['•', a];
};
export const EVENT_LABEL = {
  login: ['🔑', 'signed in'], view: ['👀', 'opened'], upload: ['📤', 'uploaded'], download: ['📥', 'downloaded'],
  message: ['💬', 'sent a message'], calc: ['🧮', 'used the calculator'], submit: ['✅', 'submitted'], share: ['🔗', 'shared'],
};

export const ago = (iso) => {
  if (!iso) return 'never';
  const s = Math.round((Date.now() - new Date(iso)) / 1000);
  if (s < 60) return 'just now';
  if (s < 3600) return `${Math.floor(s / 60)} min ago`;
  if (s < 86400) return `${Math.floor(s / 3600)} h ago`;
  if (s < 86400 * 7) return `${Math.floor(s / 86400)} d ago`;
  return new Date(iso).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' });
};
