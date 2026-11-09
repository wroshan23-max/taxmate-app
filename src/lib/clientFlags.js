// V60 — Pin clients to the top + coloured client labels (admin only; tables client_flags, client_labels)
import { supabase } from './supabase';

// Full class names written out so Tailwind keeps them
export const LABEL_COLORS = {
  red:    { name: 'Red',    chip: 'bg-red-100 text-red-800 border-red-200',          dot: 'bg-red-500' },
  orange: { name: 'Orange', chip: 'bg-orange-100 text-orange-800 border-orange-200', dot: 'bg-orange-500' },
  amber:  { name: 'Yellow', chip: 'bg-amber-100 text-amber-800 border-amber-200',    dot: 'bg-amber-400' },
  green:  { name: 'Green',  chip: 'bg-green-100 text-green-800 border-green-200',    dot: 'bg-green-500' },
  teal:   { name: 'Teal',   chip: 'bg-teal-100 text-teal-800 border-teal-200',       dot: 'bg-teal-500' },
  blue:   { name: 'Blue',   chip: 'bg-blue-100 text-blue-800 border-blue-200',       dot: 'bg-blue-500' },
  indigo: { name: 'Indigo', chip: 'bg-indigo-100 text-indigo-800 border-indigo-200', dot: 'bg-indigo-500' },
  purple: { name: 'Purple', chip: 'bg-purple-100 text-purple-800 border-purple-200', dot: 'bg-purple-500' },
  pink:   { name: 'Pink',   chip: 'bg-pink-100 text-pink-800 border-pink-200',       dot: 'bg-pink-500' },
  gray:   { name: 'Grey',   chip: 'bg-gray-100 text-gray-700 border-gray-200',       dot: 'bg-gray-500' },
};
export const colorOf = (c) => LABEL_COLORS[c] ?? LABEL_COLORS.gray;

const err = (e) => { if (e) throw new Error(e.message); };

export async function loadLabels() {
  const { data, error } = await supabase.from('client_labels').select('*').order('sort').order('name');
  err(error);
  return data ?? [];
}
/** { client_id: { pinned_at, pin_note, label_ids } } — all clients, or one */
export async function loadFlags(clientId) {
  let q = supabase.from('client_flags').select('client_id, pinned_at, pin_note, label_ids');
  if (clientId) q = q.eq('client_id', clientId);
  const { data, error } = await q;
  err(error);
  return Object.fromEntries((data ?? []).map(f => [f.client_id, f]));
}
async function upsertFlag(clientId, patch) {
  const { data: u } = await supabase.auth.getUser();
  const { data, error } = await supabase.from('client_flags')
    .upsert({ client_id: clientId, ...patch, updated_at: new Date().toISOString(), updated_by: u?.user?.id ?? null }, { onConflict: 'client_id' })
    .select('client_id, pinned_at, pin_note, label_ids').single();
  err(error);
  return data;
}
export const setPin = (clientId, pinned, note = '') =>
  upsertFlag(clientId, { pinned_at: pinned ? new Date().toISOString() : null, pin_note: pinned ? (note.trim().slice(0, 120) || null) : null });
export const setPinNote = (clientId, note) => upsertFlag(clientId, { pin_note: note.trim().slice(0, 120) || null });
export const setLabels = (clientId, ids) => upsertFlag(clientId, { label_ids: ids.slice(0, 10) });

export async function saveLabel({ id, name, color, sort }) {
  const row = { name: name.trim().slice(0, 30), color, ...(sort != null ? { sort } : {}) };
  if (!row.name) throw new Error('Type a name for the label');
  const { error } = id ? await supabase.from('client_labels').update(row).eq('id', id) : await supabase.from('client_labels').insert(row);
  if (error) throw new Error(/client_labels_name_uq|duplicate/.test(error.message) ? `There is already a label called "${row.name}"` : error.message);
}
export async function deleteLabel(id) {
  const { error } = await supabase.from('client_labels').delete().eq('id', id);
  err(error);
}
