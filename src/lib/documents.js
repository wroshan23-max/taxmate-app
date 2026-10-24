// ═══════════════════════════════════════════════════════════
//  Document vault
//  • OneDrive (V45, when connected in Settings → File storage): files go straight from the
//    browser to the firm's OneDrive through the "onedrive" Edge Function. Up to 25 MB.
//  • Otherwise the private Supabase bucket "client-docs" (free plan 1 GB, 10 MB per file):
//    <client_id>/<2025-26 | general>/<random>-<safe-name>
//  Photos are shrunk in the browser before upload either way.
// ═══════════════════════════════════════════════════════════
import { supabase } from './supabase';

export const BUCKET = 'client-docs';
export const MAX_BYTES = 10 * 1024 * 1024;          // Supabase storage
export const MAX_DRIVE_BYTES = 25 * 1024 * 1024;   // OneDrive
export const FREE_LIMIT = 1024 * 1024 * 1024;

export const DOC_CATS = {
  salary:   { label: 'Salary / T-10 / APIT', si: 'වැටුප් / T-10', emoji: '💼', color: 'bg-blue-50 text-blue-700' },
  bank:     { label: 'Bank interest / WHT',  si: 'බැංකු පොලී',    emoji: '🏦', color: 'bg-emerald-50 text-emerald-700' },
  rent:     { label: 'Rent income',          si: 'කුලී ආදායම',     emoji: '🏠', color: 'bg-orange-50 text-orange-700' },
  business: { label: 'Business records',     si: 'ව්‍යාපාර',        emoji: '📊', color: 'bg-indigo-50 text-indigo-700' },
  foreign:  { label: 'Foreign income',       si: 'විදේශ ආදායම',   emoji: '🌍', color: 'bg-cyan-50 text-cyan-700' },
  assets:   { label: 'Assets & loans',       si: 'වත්කම් / ණය',    emoji: '🚗', color: 'bg-amber-50 text-amber-800' },
  id:       { label: 'NIC / ID / TIN',       si: 'හැඳුනුම්පත',     emoji: '🪪', color: 'bg-gray-100 text-gray-700' },
  ird:      { label: 'IRD letters',          si: 'IRD ලිපි',        emoji: '✉️', color: 'bg-red-50 text-red-700' },
  return:   { label: 'Filed return / receipt', si: 'ගොනු කළ ලේඛන', emoji: '✅', color: 'bg-green-50 text-green-700' },
  ack:      { label: 'IRD acknowledgment',   si: 'IRD පිළිගැනීම',  emoji: '📨', color: 'bg-teal-50 text-teal-700' },
  voucher:  { label: 'IRD payment voucher',  si: 'ගෙවීම් වවුචරය',  emoji: '🧾', color: 'bg-rose-50 text-rose-700' },
  other:    { label: 'Other',                si: 'වෙනත්',           emoji: '📎', color: 'bg-purple-50 text-purple-700' },
};
// What a client usually uploads (admin-only ones last)
export const CLIENT_CATS = ['salary', 'bank', 'rent', 'business', 'foreign', 'assets', 'id', 'ird', 'other'];

export const ACCEPT = '.pdf,.jpg,.jpeg,.png,.webp,.xlsx,.xls,.docx,.doc,.csv,image/*';
const MIME_BY_EXT = {
  pdf: 'application/pdf', jpg: 'image/jpeg', jpeg: 'image/jpeg', png: 'image/png', webp: 'image/webp',
  xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', xls: 'application/vnd.ms-excel',
  docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', doc: 'application/msword', csv: 'text/csv',
};
export const extOf = (name = '') => (name.split('.').pop() || '').toLowerCase();
const OK_MIMES = Object.values(MIME_BY_EXT);
export const mimeOf = (file) => (OK_MIMES.includes(file.type) ? file.type : MIME_BY_EXT[extOf(file.name)] || file.type);
export const allowed = (file) => OK_MIMES.includes(mimeOf(file)) || /^image\/hei[cf]$/.test(file.type) || /\.hei[cf]$/i.test(file.name);

export const fmtBytes = (b = 0) => (b < 1024 ? `${b} B` : b < 1048576 ? `${(b / 1024).toFixed(0)} KB` : b < 1073741824 ? `${(b / 1048576).toFixed(1)} MB` : `${(b / 1073741824).toFixed(2)} GB`);
export const isImage = (mime = '') => mime.startsWith('image/');
export const isPdf = (mime = '') => mime === 'application/pdf';

/** Y/A list: current filing year first, then 4 back and 1 forward. */
export function docYears() {
  const d = new Date();
  const start = d.getMonth() >= 3 ? d.getFullYear() : d.getFullYear() - 1; // Y/A starts 1 April
  const ys = [];
  for (let s = start + 1; s >= start - 4; s--) ys.push(`${s}/${String((s + 1) % 100).padStart(2, '0')}`);
  return ys;
}
/** The year most clients are filing for right now: Apr–Nov → last Y/A, Dec–Mar → current Y/A. */
export function defaultDocYear() {
  const d = new Date(), m = d.getMonth(), y = d.getFullYear();
  const s = m === 11 ? y : y - 1;
  return `${s}/${String((s + 1) % 100).padStart(2, '0')}`;
}

/**
 * Shrink phone photos: max 1600 px, JPEG ~0.75 → usually 150–400 KB.
 * PDFs / Excel / Word are uploaded as they are.
 */
export async function compressImage(file, { maxSide = 1600, quality = 0.75 } = {}) {
  const heic = /^image\/hei[cf]$/.test(file.type) || /\.hei[cf]$/i.test(file.name);
  if (!heic && (!/^image\/(jpeg|png|webp)$/.test(file.type) || file.size < 250 * 1024)) return file;
  try {
    const bmp = await createImageBitmap(file).catch(() => null);
    let src = bmp, w, h;
    if (bmp) { w = bmp.width; h = bmp.height; } else {
      const url = URL.createObjectURL(file);
      src = await new Promise((res, rej) => { const im = new Image(); im.onload = () => res(im); im.onerror = rej; im.src = url; });
      w = src.naturalWidth; h = src.naturalHeight; URL.revokeObjectURL(url);
    }
    const k = Math.min(1, maxSide / Math.max(w, h));
    const c = document.createElement('canvas');
    c.width = Math.round(w * k); c.height = Math.round(h * k);
    const ctx = c.getContext('2d');
    ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, c.width, c.height);  // PNG transparency → white
    ctx.drawImage(src, 0, 0, c.width, c.height);
    const blob = await new Promise(res => c.toBlob(res, 'image/jpeg', quality));
    if (!blob || (!heic && blob.size >= file.size)) return file;
    const name = file.name.replace(/\.[^.]+$/, '') + '.jpg';
    return new File([blob], name, { type: 'image/jpeg', lastModified: Date.now() });
  } catch { return file; }
}

const safeName = (n) => n.normalize('NFKD').replace(/[^\w.-]+/g, '_').replace(/_+/g, '_').slice(-80) || 'file';
const rand = () => Math.random().toString(36).slice(2, 10);
export const yearFolder = (year) => (year ? year.replace('/', '-') : 'general');

// Call the OneDrive Edge Function; failures come back as { error }
async function drive(action, payload = {}) {
  const { data, error } = await supabase.functions.invoke('onedrive', { body: { action, ...payload } });
  if (error) throw new Error(error.message || 'Could not reach the file service.');
  if (data?.error) throw new Error(data.error);
  return data;
}
export const driveStatus = () => drive('status');
export const driveAuthUrl = (redirect_uri) => drive('auth_url', { redirect_uri });
export const driveExchange = (code, state, redirect_uri) => drive('exchange', { code, state, redirect_uri });
export const driveDisconnect = () => drive('disconnect');

/** Upload one file + register it. Returns the inserted row. */
export async function uploadDocument({ clientId, file, year, category, title, note, role, userId, onStage }) {
  if (!allowed(file)) throw new Error(`${file.name}: this file type is not allowed (PDF, photo, Excel, Word or CSV only).`);
  onStage?.('compress');
  const f = await compressImage(file);
  if (f.size > MAX_DRIVE_BYTES) throw new Error(`${file.name} is ${fmtBytes(f.size)} — the limit is 25 MB. Please send a smaller copy.`);
  const mime = mimeOf(f);
  if (!OK_MIMES.includes(mime)) throw new Error(`${file.name}: this photo format could not be converted. Please send it as JPG or a screenshot.`);
  const docTitle = (title || file.name).slice(0, 150);

  // 1) OneDrive (if connected): get an upload link, send the file straight there, then register it
  onStage?.('upload');
  const start = await drive('start_upload', { client_id: clientId, year: year || null, category, title: docTitle, note: note || null, file_name: f.name, size: f.size, mime });
  if (start.provider === 'onedrive') {
    let item;
    try {
      const r = await fetch(start.upload_url, { method: 'PUT', headers: { 'Content-Range': `bytes 0-${f.size - 1}/${f.size}` }, body: f });
      item = await r.json().catch(() => ({}));
      if (!r.ok || !item?.id) throw new Error(item?.error?.message || `OneDrive answered ${r.status}`);
    } catch (e) {
      fetch(start.upload_url, { method: 'DELETE' }).catch(() => {});
      throw new Error(`${file.name}: upload to OneDrive failed (${e.message}). Please check your internet and try again.`);
    }
    const { row } = await drive('finish_upload', { upload_id: start.upload_id, item_id: item.id });
    return { ...row, saved: file.size - f.size };
  }

  // 2) Old storage (Supabase) — used until OneDrive is connected
  if (f.size > MAX_BYTES) throw new Error(`${file.name} is ${fmtBytes(f.size)} — the limit is 10 MB. Please send a smaller copy.`);
  const path = `${clientId}/${yearFolder(year)}/${rand()}-${safeName(f.name)}`;
  onStage?.('upload');
  const { error: upErr } = await supabase.storage.from(BUCKET).upload(path, f, { contentType: mime, upsert: false, cacheControl: '3600' });
  if (upErr) throw new Error(upErr.message?.includes('row-level') ? 'Upload not allowed (storage limit reached or documents switched off).' : upErr.message);
  const { data, error } = await supabase.from('client_documents').insert({
    client_id: clientId, year: year || null, category, title: docTitle, path, size: f.size, mime,
    note: note || null, uploaded_by: userId, uploaded_role: role,
  }).select().single();
  if (error) { await supabase.storage.from(BUCKET).remove([path]); throw new Error(error.message.includes('row-level') ? 'Your document space is full (150 MB / 300 files). Please contact TaxMate.' : error.message); }
  return { ...data, saved: file.size - f.size };
}

/** Short-lived link to view / download a document (row from client_documents). */
export async function signedUrl(row, download) {
  if (row.storage === 'onedrive') return (await drive('download', { doc_id: row.id })).url;
  const { data, error } = await supabase.storage.from(BUCKET).createSignedUrl(row.path, 300, download ? { download } : undefined);
  if (error) throw error;
  return data.signedUrl;
}

/** For previews: OneDrive links download instead of showing — fetch the file and show it from memory. */
export async function previewUrl(row) {
  const url = await signedUrl(row);
  if (row.storage !== 'onedrive') return { url, revoke: () => {} };
  try {
    const r = await fetch(url);
    if (!r.ok) throw new Error(String(r.status));
    const blob = new Blob([await r.blob()], { type: row.mime || 'application/octet-stream' });
    const obj = URL.createObjectURL(blob);
    return { url: obj, revoke: () => URL.revokeObjectURL(obj) };
  } catch { return { url, revoke: () => {} }; }
}

export async function deleteDocuments(rows) {
  if (!rows.length) return;
  const drv = rows.filter(r => r.storage === 'onedrive'), old = rows.filter(r => r.storage !== 'onedrive');
  if (drv.length) await drive('delete', { doc_ids: drv.map(r => r.id) });
  if (old.length) {
    const { error: e1 } = await supabase.storage.from(BUCKET).remove(old.map(r => r.path));
    if (e1) throw e1;
    const { error: e2 } = await supabase.from('client_documents').delete().in('id', old.map(r => r.id));
    if (e2) throw e2;
  }
}

/** Remove every stored file for a client (used before permanent delete). OneDrive folder → recycle bin. */
export async function purgeClientFiles(clientId) {
  const { data } = await supabase.from('client_documents').select('path, storage').eq('client_id', clientId);
  const rows = data ?? [];
  if (rows.some(r => r.storage === 'onedrive')) await drive('purge_client', { client_id: clientId });
  const paths = rows.filter(r => r.storage !== 'onedrive').map(r => r.path);
  for (let i = 0; i < paths.length; i += 100) await supabase.storage.from(BUCKET).remove(paths.slice(i, i + 100));
  return rows.length;
}

// ── Return progress tracker ──────────────────────────────
export const STAGES = [
  { key: 'docs',      label: 'Documents received', si: 'ලේඛන ලැබුණා',    emoji: '📥', hint: 'We have your documents.' },
  { key: 'computing', label: 'Computing',          si: 'ගණනය කරමින්',     emoji: '🧮', hint: 'We are calculating your tax.' },
  { key: 'review',    label: 'Ready to review',    si: 'පරීක්ෂාවට සූදානම්', emoji: '👀', hint: 'Please check and confirm the figures.' },
  { key: 'filed',     label: 'Filed in RAMIS',     si: 'RAMIS හි ගොනු කළා', emoji: '✅', hint: 'Your return is filed with the IRD. All done!' },
];
export const stageIndex = (k) => Math.max(0, STAGES.findIndex(s => s.key === k));
