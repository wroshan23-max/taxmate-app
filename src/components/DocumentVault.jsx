import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import toast from 'react-hot-toast';
import {
  UploadCloud, Camera, FolderOpen, FileText, FileSpreadsheet, FileImage, File as FileIcon, Download, Eye, Trash2,
  Loader2, X, CheckCircle2, AlertCircle, Lock, Search, Sparkles, MessageCircle,
} from 'lucide-react';
import { FIRM, waNumber } from '../lib/firm';
import { supabase } from '../lib/supabase';
import {
  DOC_CATS, CLIENT_CATS, ACCEPT, docYears, defaultDocYear, uploadDocument, signedUrl, previewUrl, deleteDocuments,
  fmtBytes, isImage, isPdf, extOf,
} from '../lib/documents';
import { logActivity } from '../lib/activity';

const fileIcon = (mime = '', name = '') => {
  if (isImage(mime)) return FileImage;
  if (isPdf(mime)) return FileText;
  if (/sheet|excel|csv/.test(mime) || /xlsx?|csv/.test(extOf(name))) return FileSpreadsheet;
  return FileIcon;
};
const iconTone = (mime = '') => (isImage(mime) ? 'from-pink-500 to-rose-500' : isPdf(mime) ? 'from-red-500 to-orange-500' : /sheet|excel|csv/.test(mime) ? 'from-emerald-500 to-green-600' : 'from-indigo-500 to-blue-600');

/**
 * Shared document vault.
 *  role: 'client' | 'admin'
 *  clientId: the client's id   userId: auth user id
 *  client (admin only, optional): { full_name, mobile } for the "Send on WhatsApp" message
 */
// Documents TaxMate sends to the client → offer a ready WhatsApp message after uploading
const SHARE_CATS = ['ack', 'voucher', 'return', 'ird'];
function shareMessage(client, cat, year, count) {
  const first = String(client?.full_name || '').trim().split(/\s+/)[0] || 'there';
  const what = { ack: 'IRD acknowledgment', voucher: 'IRD payment voucher', return: 'filed return / receipt', ird: 'IRD letter' }[cat] || 'document';
  return [
    `Hi ${first} 👋`,
    '',
    `Your *${what}${count > 1 ? 's' : ''}*${year ? ` for Y/A ${year}` : ''} ${count > 1 ? 'are' : 'is'} ready in your TaxMate portal 📄`,
    `ඔබගේ ${what} TaxMate portal එකේ ඇත.`,
    '',
    `👉 ${window.location.origin}/client/documents`,
    '',
    `_${FIRM.name}_`,
  ].join('\n');
}

export default function DocumentVault({ clientId, role, userId, onChange, client }) {
  const years = useMemo(() => docYears(), []);
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);
  const [year, setYear] = useState('all');
  const [q, setQ] = useState('');
  const [upYear, setUpYear] = useState(defaultDocYear());
  const [upCat, setUpCat] = useState(role === 'admin' ? 'ack' : 'salary');
  const [shared, setShared] = useState(null);   // { cat, year, count } after TaxMate uploads an IRD document
  const [note, setNote] = useState('');
  const [queue, setQueue] = useState([]);   // {id,name,size,state,msg}
  const [drag, setDrag] = useState(false);
  const [preview, setPreview] = useState(null); // {row,url}
  const [confirm, setConfirm] = useState(null); // rows to delete
  const fileRef = useRef(), camRef = useRef();
  const busy = queue.some(f => f.state === 'compress' || f.state === 'upload');

  const load = useCallback(async () => {
    const { data, error } = await supabase.from('client_documents').select('*').eq('client_id', clientId).order('created_at', { ascending: false });
    if (error) toast.error(error.message);
    setRows(data ?? []);
    setLoading(false);
  }, [clientId]);
  useEffect(() => { load(); }, [load]);

  // admin opening this tab = new client uploads are seen
  useEffect(() => {
    if (role !== 'admin' || loading) return;
    const unseen = rows.filter(r => r.uploaded_role === 'client' && !r.seen_at).map(r => r.id);
    if (unseen.length) supabase.from('client_documents').update({ seen_at: new Date().toISOString() }).in('id', unseen).then(() => onChange?.());
  }, [role, loading]); // eslint-disable-line react-hooks/exhaustive-deps

  const addFiles = async (list) => {
    const files = Array.from(list || []);
    if (!files.length) return;
    const items = files.map((f, i) => ({ id: `${Date.now()}-${i}`, name: f.name, size: f.size, state: 'wait', file: f }));
    setQueue(qu => [...items, ...qu.filter(x => x.state !== 'done')].slice(0, 20));
    let ok = 0;
    for (const it of items) {
      const set = (patch) => setQueue(qu => qu.map(x => (x.id === it.id ? { ...x, ...patch } : x)));
      try {
        const row = await uploadDocument({
          clientId, file: it.file, year: upYear || null, category: upCat, title: it.file.name.replace(/\.[^.]+$/, ''),
          note: note.trim(), role, userId, onStage: (s) => set({ state: s }),
        });
        set({ state: 'done', size: row.size, saved: row.saved });
        setRows(rs => [row, ...rs]);
        ok++;
      } catch (e) {
        set({ state: 'error', msg: e.message });
      }
    }
    if (ok) {
      toast.success(`${ok} file${ok > 1 ? 's' : ''} uploaded`); setNote(''); onChange?.();
      if (role === 'client') logActivity('upload', '/client/documents', `${ok} file${ok > 1 ? 's' : ''}`);
      if (role === 'admin' && SHARE_CATS.includes(upCat)) setShared({ cat: upCat, year: upYear || null, count: ok });
    }
  };

  const open = async (row) => {
    try {
      if (isImage(row.mime) || isPdf(row.mime)) {
        setPreview({ row, url: null });
        const p = await previewUrl(row);
        setPreview(cur => { if (cur?.row?.id !== row.id) { p.revoke(); return cur; } return { row, url: p.url, revoke: p.revoke }; });
      } else window.open(await signedUrl(row), '_blank', 'noopener');
    } catch (e) { setPreview(null); toast.error(e.message); }
  };
  const closePreview = () => { preview?.revoke?.(); setPreview(null); };
  const download = async (row) => {
    try {
      const url = await signedUrl(row, `${row.title}.${extOf(row.path)}`);
      if (role === 'client') logActivity('download', '/client/documents', row.title);
      const a = document.createElement('a'); a.href = url; a.rel = 'noopener'; document.body.appendChild(a); a.click(); a.remove();
    } catch (e) { toast.error(e.message); }
  };
  const canDelete = (r) => role === 'admin' || (r.uploaded_role === 'client' && r.uploaded_by === userId);
  const doDelete = async () => {
    try {
      await deleteDocuments(confirm.rows);
      const ids = new Set(confirm.rows.map(r => r.id));
      setRows(rs => rs.filter(r => !ids.has(r.id)));
      toast.success(`${confirm.rows.length} file${confirm.rows.length > 1 ? 's' : ''} deleted`);
      setConfirm(null); closePreview(); onChange?.();
    } catch (e) { toast.error(e.message); }
  };

  const shown = rows.filter(r => (year === 'all' || (year === 'general' ? !r.year : r.year === year))
    && (!q || `${r.title} ${DOC_CATS[r.category]?.label}`.toLowerCase().includes(q.toLowerCase())));
  const byCat = Object.keys(DOC_CATS).map(k => [k, shown.filter(r => r.category === k)]).filter(([, l]) => l.length);
  const total = rows.reduce((s, r) => s + Number(r.size || 0), 0);
  const yearCount = (y) => rows.filter(r => (y === 'general' ? !r.year : r.year === y)).length;
  const catOptions = role === 'admin' ? Object.keys(DOC_CATS) : CLIENT_CATS;

  return (
    <div className="space-y-4">
      {/* Upload card */}
      <div className="card overflow-hidden">
        <div className="grid md:grid-cols-[1fr_1.2fr]">
          <div className="p-5 space-y-3 border-b md:border-b-0 md:border-r border-gray-100 bg-gradient-to-br from-primary-50/60 to-white">
            <div className="font-bold text-primary-800 flex items-center gap-2"><UploadCloud size={18} /> {role === 'admin' ? 'Add files for this client' : 'Send documents to TaxMate'}</div>
            <div className="grid grid-cols-2 gap-2">
              <label className="text-xs font-semibold text-gray-600">Year of assessment
                <select className="input mt-1 text-sm" value={upYear} onChange={e => setUpYear(e.target.value)}>
                  {years.map(y => <option key={y} value={y}>Y/A {y}</option>)}
                  <option value="">General (not year-specific)</option>
                </select>
              </label>
              <label className="text-xs font-semibold text-gray-600">Type of document
                <select className="input mt-1 text-sm" value={upCat} onChange={e => setUpCat(e.target.value)}>
                  {catOptions.map(k => <option key={k} value={k}>{DOC_CATS[k].emoji} {DOC_CATS[k].label}</option>)}
                </select>
              </label>
            </div>
            <input className="input text-sm" maxLength={500} placeholder="Note (optional) — e.g. Sampath Bank interest certificate" value={note} onChange={e => setNote(e.target.value)} />
            <p className="text-[11px] text-gray-500 flex items-start gap-1.5"><Lock size={12} className="mt-0.5 flex-shrink-0 text-primary-500" /> Private &amp; secure — only you and TaxMate can see these files. Photos are resized automatically to save space.</p>
          </div>

          <div className="p-5">
            <div
              onDragOver={e => { e.preventDefault(); setDrag(true); }} onDragLeave={() => setDrag(false)}
              onDrop={e => { e.preventDefault(); setDrag(false); if (!busy) addFiles(e.dataTransfer.files); }}
              className={`rounded-2xl border-2 border-dashed transition-all p-5 text-center ${drag ? 'border-gold-500 bg-gold-500/10 scale-[1.01]' : 'border-primary-200 bg-primary-50/40'}`}>
              <div className="w-14 h-14 mx-auto rounded-2xl bg-gradient-to-br from-primary-600 to-indigo-600 text-white flex items-center justify-center shadow-lg shadow-primary-600/20">
                {busy ? <Loader2 size={26} className="animate-spin" /> : <UploadCloud size={26} />}
              </div>
              <div className="mt-2 font-semibold text-gray-800 text-sm">{busy ? 'Uploading…' : 'Drop files here'}</div>
              <div className="text-xs text-gray-500">PDF, photo, Excel, Word or CSV</div>
              <div className="mt-3 flex gap-2 justify-center flex-wrap">
                <button type="button" disabled={busy} onClick={() => camRef.current?.click()} className="btn-primary text-sm"><Camera size={15} /> Take photo</button>
                <button type="button" disabled={busy} onClick={() => fileRef.current?.click()} className="btn-secondary text-sm"><FolderOpen size={15} /> Choose files</button>
              </div>
              <input ref={camRef} type="file" accept="image/*" capture="environment" className="hidden" onChange={e => { addFiles(e.target.files); e.target.value = ''; }} />
              <input ref={fileRef} type="file" accept={ACCEPT} multiple className="hidden" onChange={e => { addFiles(e.target.files); e.target.value = ''; }} />
            </div>

            {queue.length > 0 && (
              <div className="mt-3 space-y-1.5 max-h-48 overflow-y-auto">
                {queue.map(f => (
                  <div key={f.id} className="flex items-center gap-2 text-xs rounded-lg bg-gray-50 px-2.5 py-1.5">
                    {f.state === 'done' ? <CheckCircle2 size={14} className="text-green-600 flex-shrink-0" /> : f.state === 'error' ? <AlertCircle size={14} className="text-red-500 flex-shrink-0" /> : <Loader2 size={14} className="animate-spin text-primary-500 flex-shrink-0" />}
                    <span className="truncate flex-1 font-medium text-gray-700">{f.name}</span>
                    <span className={`whitespace-nowrap ${f.state === 'error' ? 'text-red-600' : 'text-gray-400'}`}>
                      {f.state === 'error' ? 'Failed' : f.state === 'compress' ? 'Optimising…' : f.state === 'upload' ? 'Uploading…' : f.state === 'wait' ? 'Waiting' : `${fmtBytes(f.size)}${f.saved > 50000 ? ` · saved ${fmtBytes(f.saved)}` : ''}`}
                    </span>
                  </div>
                ))}
                {queue.filter(f => f.state === 'error').map(f => <div key={`e${f.id}`} className="text-[11px] text-red-600 px-1">{f.msg}</div>)}
              </div>
            )}
            {shared && role === 'admin' && (
              <div className="mt-3 rounded-xl border border-emerald-200 bg-emerald-50 p-3 text-sm">
                <div className="flex items-start gap-2">
                  <CheckCircle2 size={18} className="text-emerald-600 flex-shrink-0 mt-0.5" />
                  <div className="flex-1 text-emerald-900"><b>{DOC_CATS[shared.cat]?.label}</b> shared — {client?.full_name?.split(' ')[0] || 'the client'} sees it in My Documents and gets a 🔔 notification.</div>
                  <button onClick={() => setShared(null)} className="text-emerald-700/60 hover:text-emerald-800"><X size={15} /></button>
                </div>
                <a href={`https://wa.me/${waNumber(client?.mobile || '')}?text=${encodeURIComponent(shareMessage(client, shared.cat, shared.year, shared.count))}`} target="_blank" rel="noreferrer"
                  onClick={() => setShared(null)}
                  className="mt-2 inline-flex items-center gap-1.5 rounded-lg bg-[#25D366] hover:brightness-95 text-white font-semibold px-3 py-1.5 text-sm"><MessageCircle size={15} /> Send on WhatsApp{client?.mobile ? '' : ' (choose contact)'}</a>
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Filters */}
      <div className="flex items-center gap-2 flex-wrap">
        <div className="flex gap-1.5 overflow-x-auto pb-1 -mb-1 w-full sm:w-auto sm:flex-1 min-w-0">
          {[['all', 'All', rows.length], ...years.map(y => [y, `Y/A ${y}`, yearCount(y)]), ['general', 'General', yearCount('general')]]
            .filter(([k, , n]) => k === 'all' || n > 0 || k === upYear)
            .map(([k, label, n]) => (
              <button key={k} onClick={() => setYear(k)}
                className={`whitespace-nowrap text-xs font-semibold px-3 py-1.5 rounded-full border transition-colors ${year === k ? 'bg-primary-700 text-white border-primary-700' : 'bg-white text-gray-600 border-gray-200 hover:border-primary-300'}`}>
                {label} <span className={year === k ? 'text-primary-200' : 'text-gray-400'}>{n}</span>
              </button>
            ))}
        </div>
        <div className="relative flex-1 sm:flex-none">
          <Search size={14} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-gray-400" />
          <input className="input text-sm pl-8 py-1.5 w-full sm:w-44" placeholder="Search files" value={q} onChange={e => setQ(e.target.value)} />
        </div>
        {role === 'admin' && year !== 'all' && shown.length > 0 && (
          <button onClick={() => setConfirm({ rows: shown, label: year === 'general' ? 'all general files' : `all files for Y/A ${year}` })}
            className="text-xs font-semibold text-red-600 hover:bg-red-50 px-2.5 py-1.5 rounded-lg flex items-center gap-1"><Trash2 size={13} /> Delete year</button>
        )}
      </div>

      {/* Files */}
      {loading ? (
        <div className="card p-10 text-center text-gray-400 text-sm"><Loader2 className="animate-spin mx-auto mb-2" /> Loading documents…</div>
      ) : shown.length === 0 ? (
        <div className="card p-10 text-center">
          <div className="w-16 h-16 rounded-3xl bg-primary-50 mx-auto flex items-center justify-center text-3xl">🗂️</div>
          <div className="mt-3 font-semibold text-gray-700">{rows.length ? 'No files here' : 'No documents yet'}</div>
          <p className="text-sm text-gray-500 mt-1">{role === 'client' ? 'Upload your salary slips, bank certificates and other papers — we will take it from there.' : 'Files the client uploads will appear here.'}</p>
        </div>
      ) : (
        <div className="space-y-4">
          {byCat.map(([cat, list]) => (
            <div key={cat}>
              <div className="flex items-center gap-2 mb-2">
                <span className={`text-xs font-bold px-2.5 py-1 rounded-full ${DOC_CATS[cat].color}`}>{DOC_CATS[cat].emoji} {DOC_CATS[cat].label}</span>
                <span className="text-xs text-gray-400">{list.length}</span>
              </div>
              <div className="grid sm:grid-cols-2 xl:grid-cols-3 gap-2.5">
                {list.map(r => {
                  const Icon = fileIcon(r.mime, r.path);
                  const isNew = role === 'admin' && r.uploaded_role === 'client' && !r.seen_at;
                  return (
                    <div key={r.id} onClick={() => open(r)} role="button" tabIndex={0} onKeyDown={e => e.key === 'Enter' && open(r)}
                      className="group card p-3 flex items-center gap-3 cursor-pointer hover:shadow-md hover:-translate-y-0.5 hover:border-primary-200 transition-all">
                      <div className={`w-11 h-11 rounded-xl bg-gradient-to-br ${iconTone(r.mime)} text-white flex items-center justify-center flex-shrink-0 shadow-sm`}><Icon size={20} /></div>
                      <div className="flex-1 min-w-0">
                        <div className="text-sm font-semibold text-gray-800 flex items-center gap-1.5 min-w-0">
                          <span className="truncate">{r.title}</span>{isNew && <span className="flex-shrink-0 text-[9px] font-black uppercase bg-gold-500 text-primary-900 rounded px-1.5 py-0.5 flex items-center gap-0.5"><Sparkles size={9} />New</span>}
                        </div>
                        <div className="text-[11px] text-gray-400 truncate">
                          {r.year ? `Y/A ${r.year}` : 'General'} · {fmtBytes(r.size)} · {new Date(r.created_at).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })} · {r.uploaded_role === 'admin' ? 'from TaxMate' : role === 'admin' ? 'client' : 'you'}
                        </div>
                        {r.note && <div className="text-[11px] text-gray-500 truncate italic">{r.note}</div>}
                      </div>
                      <div className="flex items-center gap-0.5 opacity-70 group-hover:opacity-100" onClick={e => e.stopPropagation()}>
                        <button title="Download" onClick={() => download(r)} className="p-1.5 rounded-lg text-gray-500 hover:bg-primary-50 hover:text-primary-700"><Download size={15} /></button>
                        {canDelete(r) && <button title="Delete" onClick={() => setConfirm({ rows: [r], label: `"${r.title}"` })} className="p-1.5 rounded-lg text-gray-400 hover:bg-red-50 hover:text-red-600"><Trash2 size={15} /></button>}
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          ))}
        </div>
      )}
      {rows.length > 0 && <p className="text-[11px] text-gray-400 text-right">{rows.length} file{rows.length > 1 ? 's' : ''} · {fmtBytes(total)}{rows.some(r => r.storage === 'onedrive') && role === 'admin' ? ' · stored in OneDrive' : ''}</p>}

      {/* Preview */}
      {preview && (
        <div className="fixed inset-0 z-50 bg-black/70 backdrop-blur-sm flex items-center justify-center p-3" onClick={closePreview}>
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-4xl max-h-[92vh] flex flex-col overflow-hidden" onClick={e => e.stopPropagation()}>
            <div className="flex items-center gap-2 px-4 py-3 border-b border-gray-100">
              <Eye size={16} className="text-primary-600" />
              <div className="font-semibold text-gray-800 truncate flex-1">{preview.row.title}</div>
              <button onClick={() => download(preview.row)} className="btn-secondary text-xs py-1.5"><Download size={14} /> Download</button>
              {canDelete(preview.row) && <button onClick={() => setConfirm({ rows: [preview.row], label: `"${preview.row.title}"` })} className="p-2 rounded-lg text-red-500 hover:bg-red-50"><Trash2 size={15} /></button>}
              <button onClick={closePreview} className="p-2 rounded-lg text-gray-500 hover:bg-gray-100"><X size={18} /></button>
            </div>
            <div className="flex-1 bg-gray-100 overflow-auto flex items-center justify-center min-h-[50vh]">
              {!preview.url ? <div className="text-gray-400 text-sm flex items-center gap-2"><Loader2 size={18} className="animate-spin" /> Opening…</div>
                : isImage(preview.row.mime)
                ? <img src={preview.url} alt={preview.row.title} className="max-w-full max-h-[80vh] object-contain" />
                : <iframe src={preview.url} title={preview.row.title} className="w-full h-[80vh] bg-white" />}
            </div>
          </div>
        </div>
      )}

      {/* Delete confirm */}
      {confirm && (
        <div className="fixed inset-0 z-[60] bg-black/50 flex items-center justify-center p-4" onClick={() => setConfirm(null)}>
          <div className="bg-white rounded-2xl shadow-2xl max-w-sm w-full p-5 space-y-3" onClick={e => e.stopPropagation()}>
            <div className="w-12 h-12 rounded-2xl bg-red-50 text-red-600 flex items-center justify-center"><Trash2 size={22} /></div>
            <div className="font-bold text-gray-800">Delete {confirm.label}?</div>
            <p className="text-sm text-gray-500">{confirm.rows.length > 1 ? `${confirm.rows.length} files` : 'This file'} will be removed permanently. This cannot be undone.</p>
            <div className="flex gap-2 justify-end">
              <button onClick={() => setConfirm(null)} className="btn-secondary text-sm">Cancel</button>
              <button onClick={doDelete} className="btn-primary text-sm !bg-red-600 hover:!bg-red-700"><Trash2 size={14} /> Delete</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
