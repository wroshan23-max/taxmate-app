// V61 — Password-protected share links for client documents (/d/<token>)
import { supabase } from './supabase';
import { FIRM } from './firm';

const errMsg = (e) => (e?.message || String(e)).replace(/^.*?ERROR:\s*/, '');
export const shareFilesUrl = (token) => `${window.location.origin}/d/${token}`;

// Easy to read & type: no 0/O, 1/I/L. 8 characters → e.g. "K7QM-4TXP"
const ALPHA = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
export function genPassword() {
  const b = crypto.getRandomValues(new Uint32Array(8));
  const s = Array.from(b, n => ALPHA[n % ALPHA.length]).join('');
  return `${s.slice(0, 4)}-${s.slice(4)}`;
}
export const EXPIRY = [[1, '1 day'], [3, '3 days'], [7, '7 days'], [14, '14 days'], [30, '30 days'], [0, 'No expiry']];

export async function createShare({ clientId, docIds, password, days, title }) {
  const { data, error } = await supabase.rpc('admin_create_doc_share', { p_client: clientId, p_doc_ids: docIds, p_password: password, p_days: days, p_title: title || null });
  if (error) throw new Error(errMsg(error));
  return data;   // { id, token, expires_at }
}
export async function listShares(clientId) {
  const { data, error } = await supabase.from('doc_shares')
    .select('id, token, doc_ids, title, expires_at, revoked_at, created_at, pw_changed_at, open_count, download_count, last_opened_at, locked_until')
    .eq('client_id', clientId).order('created_at', { ascending: false });
  if (error) throw new Error(errMsg(error));
  return data ?? [];
}
export async function newSharePassword(id, password) {
  const { error } = await supabase.rpc('admin_doc_share_password', { p_id: id, p_password: password });
  if (error) throw new Error(errMsg(error));
}
export async function updateShare(id, action, days = null) {
  const { error } = await supabase.rpc('admin_doc_share_update', { p_id: id, p_action: action, p_days: days });
  if (error) throw new Error(errMsg(error));
}
export const shareState = (s, now = new Date()) =>
  s.revoked_at ? 'off' : s.expires_at && new Date(s.expires_at) < now ? 'expired' : 'active';

const first = (c) => String(c?.contact_preferred && c?.contact_name ? c.contact_name : c?.full_name || '').trim().split(/\s+/)[0] || 'Sir/Madam';
const when = (iso) => new Date(iso).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });

/** Message 1: the link (send the password separately) */
export function linkMessage(client, url, count, expiresAt) {
  return [
    `Dear ${first(client)},`, '',
    `${FIRM.name} has shared ${count} document${count > 1 ? 's' : ''} with you securely.`,
    `👉 ${url}`, '',
    'The link opens with a password — we are sending the password in a separate message.',
    expiresAt ? `The link works until ${when(expiresAt)}.` : '',
    '', 'ලේඛන බලාගැනීමට ඉහත link එක විවෘත කර, වෙනම එවන password එක ඇතුළත් කරන්න.', '',
    'Thank you,', FIRM.name, ...(FIRM.whatsapp ? [`WhatsApp ${FIRM.whatsapp}`] : []),
  ].filter((l, i, a) => l !== '' || a[i - 1] !== '').join('\n');
}
/** Message 2: the password */
export function passwordMessage(client, password) {
  return [`Dear ${first(client)},`, '', `Password for the documents link from ${FIRM.name}:`, '', `🔑 ${password}`, '', '(Capital letters, as shown. Please do not share it.)', '', FIRM.name].join('\n');
}

// ─── Public page (no login): the "onedrive" Edge Function checks link + password ───
async function call(action, body) {
  const { data, error } = await supabase.functions.invoke('onedrive', { body: { action, ...body } });
  if (error) throw new Error('Could not reach TaxMate — please check your internet and try again.');
  if (data?.error) { const e = new Error(data.error); e.locked = data.locked; e.expired = data.expired; e.triesLeft = data.tries_left; throw e; }
  return data;
}
export const openShare = (token, password) => call('share_open', { token, password });
export const downloadShared = (token, password, docId) => call('share_download', { token, password, doc_id: docId });
