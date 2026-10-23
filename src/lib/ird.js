// IRD / RAMIS filing details (TIN, RAMIS PIN, SSID). The PIN and SSID are encrypted in the
// database and only come back through admin_reveal_ird (each reveal is logged).
import { supabase } from './supabase';

export const CLIENT_TYPES = {
  individual:  { label: 'Individual', si: 'පුද්ගලයා', emoji: '👤' },
  company:     { label: 'Company', si: 'සමාගම', emoji: '🏢' },
  partnership: { label: 'Partnership', si: 'හවුල් ව්‍යාපාරය', emoji: '🤝' },
  other:       { label: 'Other entity', si: 'වෙනත්', emoji: '🏛️' },
};
export const needsSsid = (type) => type && type !== 'individual';
export const cleanTin = (t) => String(t ?? '').replace(/[\s\-/]/g, '');
export const tinOk = (t) => !cleanTin(t) || /^\d{9,12}$/.test(cleanTin(t));
export const fmtTin = (t) => { const d = cleanTin(t); return d.length === 9 ? `${d.slice(0, 3)} ${d.slice(3, 6)} ${d.slice(6)}` : d; };

const msg = (e) => (e?.message || '').replace(/^.*?ERROR:\s*/, '');
export async function myIrd() {
  const { data, error } = await supabase.rpc('my_ird_details');
  if (error) throw new Error(msg(error));
  return data;
}
/** pin / ssid: undefined = keep, '' = clear, text = set */
export async function saveMyIrd({ tin, pin, ssid, type, consent }) {
  const { error } = await supabase.rpc('save_my_ird_details', { p_tin: tin ?? null, p_pin: pin ?? null, p_ssid: ssid ?? null, p_client_type: type ?? null, p_consent: !!consent });
  if (error) throw new Error(msg(error));
}
export async function adminIrd(clientId) {
  const { data, error } = await supabase.rpc('admin_ird_details', { p_client: clientId });
  if (error) throw new Error(msg(error));
  return data;
}
export async function adminSaveIrd(clientId, { tin, pin, ssid, type }) {
  const { error } = await supabase.rpc('admin_save_ird', { p_client: clientId, p_tin: tin ?? null, p_pin: pin ?? null, p_ssid: ssid ?? null, p_client_type: type ?? null });
  if (error) throw new Error(msg(error));
}
export async function revealIrd(clientId, field) {
  const { data, error } = await supabase.rpc('admin_reveal_ird', { p_client: clientId, p_field: field });
  if (error) throw new Error(msg(error));
  return data;
}
export const LOG_LABEL = (a = '') => {
  if (a === 'view_pin') return 'viewed the RAMIS PIN';
  if (a === 'view_ssid') return 'viewed the SSID';
  const parts = a.replace(/^update:/, '').split(',').filter(Boolean).map(p => ({ tin: 'TIN', pin: 'PIN', ssid: 'SSID', clear_pin: 'removed PIN', clear_ssid: 'removed SSID' }[p] || p));
  return parts.length ? `updated ${parts.join(', ')}` : 'updated details';
};
