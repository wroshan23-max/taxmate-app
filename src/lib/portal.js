// Client-portal access: invites, password resets, user admin (via the portal-admin Edge Function)
import { supabase } from './supabase';
import { FIRM } from './iitStatement';

export async function callPortal(action, payload = {}) {
  const { data, error } = await supabase.functions.invoke('portal-admin', { body: { action, ...payload } });
  if (error) {
    const msg = /Failed to send|fetch/i.test(error.message ?? '')
      ? 'The portal service is not reachable. Is the "portal-admin" Edge Function deployed in Supabase?'
      : error.message;
    throw new Error(msg);
  }
  if (data?.error) throw new Error(data.error);
  return data;
}

export const inviteUrl = (token) => `${window.location.origin}/invite/${token}`;
export const resetUrl  = (token) => `${window.location.origin}/reset/${token}`;

const firstName = (name) => (name || '').trim().split(/\s+/).slice(-1)[0] || 'Sir/Madam';

export function inviteMessage({ name, url, role = 'client' }) {
  return role === 'admin'
    ? [`Hi ${firstName(name)},`, '', `You have been invited as a staff admin on the ${FIRM.name} portal.`, '',
       `Set your password here (valid for 14 days): ${url}`, '', 'Thank you,', FIRM.name].join('\n')
    : [`Dear ${firstName(name)},`, '',
       `Your ${FIRM.name} client portal is ready. You can see your tax calculations, returns and invoices, and confirm drafts online.`, '',
       `1. Open this link (valid for 14 days): ${url}`,
       '2. Create your password',
       `3. Next time, sign in at ${window.location.origin}/login with your email`, '',
       'Thank you,', FIRM.name, FIRM.phone].join('\n');
}

// V86: login created with a one-time password — link + email + password in one message
export const loginUrl = (email) => `${window.location.origin}/login${email ? `?email=${encodeURIComponent(email)}` : ''}`;
export function tempLoginMessage({ name, email, password, reset = false }) {
  return [`Dear ${firstName(name)},`, '',
    reset ? `Here is a new one-time password for your ${FIRM.name} client portal.`
      : `Your ${FIRM.name} client portal is ready. You can see your tax calculations, returns and invoices, and confirm drafts online.`, '',
    `1. Open: ${loginUrl(email)}`,
    `2. Email: ${email}`,
    `3. One-time password: ${password}`, '',
    'When you sign in you can set your own password, or keep this one.',
    'ඇතුළු වූ පසු ඔබේම password එකක් දාන්න හෝ මෙම password එකම දිගටම පාවිච්චි කරන්න පුළුවන්.', '',
    'Please keep this password private.', '', 'Thank you,', FIRM.name, FIRM.phone].join('\n');
}

export function resetMessage({ name, url }) {
  return [`Dear ${firstName(name)},`, '', `Use this link to set a new password for your ${FIRM.name} portal (valid for 3 days):`, url, '',
    'If you did not ask for this, you can ignore this message.', '', 'Thank you,', FIRM.name].join('\n');
}
