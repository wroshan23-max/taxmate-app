// V62 — IRD payment voucher on a tax payment: admin editor (number + PDF) and a small view for clients
import { useRef, useState } from 'react';
import toast from 'react-hot-toast';
import { Receipt, Paperclip, Loader2, Check, X, Upload, Pencil } from 'lucide-react';
import { useAuth } from '../contexts/AuthContext';
import { uploadDocument } from '../lib/documents';
import { setVoucher, voucherUrl, periodLabel, VOUCHER_RE } from '../lib/taxPayments';

const openVoucher = async (docId) => {
  const w = window.open('', '_blank');
  try { const u = await voucherUrl(docId); if (w) w.location.href = u; else window.open(u, '_blank'); }
  catch (e) { w?.close(); toast.error(e.message); }
};

/** Client view: "🧾 Voucher No. … · 📄 PDF" */
export function VoucherInfo({ row, className = '' }) {
  if (!row?.voucher_no && !row?.voucher_doc_id) return null;
  return (
    <span className={`inline-flex items-center gap-1.5 flex-wrap text-[11px] ${className}`}>
      {row.voucher_no && <span className="font-semibold text-rose-700 bg-rose-50 border border-rose-100 rounded px-1.5 py-0.5">🧾 Voucher No. <span className="font-mono">{row.voucher_no}</span></span>}
      {row.voucher_doc_id && <button type="button" onClick={(e) => { e.stopPropagation(); openVoucher(row.voucher_doc_id); }} className="font-semibold text-primary-700 hover:underline inline-flex items-center gap-0.5"><Paperclip size={11} /> Voucher PDF</button>}
    </span>
  );
}

/** Admin: add / change the voucher number and attach the voucher PDF (saved in the client's Documents) */
export function VoucherEditor({ row, onSaved, compact = false }) {
  const { user } = useAuth();
  const [open, setOpen] = useState(false);
  const [no, setNo] = useState(row.voucher_no ?? '');
  const [file, setFile] = useState(null);
  const [busy, setBusy] = useState(false);
  const fileRef = useRef(null);
  const start = () => { setNo(row.voucher_no ?? ''); setFile(null); setOpen(true); };

  const save = async () => {
    const v = no.trim().replace(/\s+/g, ' ');
    if (v && !VOUCHER_RE.test(v)) return toast.error('Voucher number: letters, numbers, spaces and - / . only');
    setBusy(true);
    try {
      let docId;
      if (file) {
        const doc = await uploadDocument({ clientId: row.client_id, file, year: row.year, category: 'voucher', role: 'admin', userId: user?.id,
          title: `Payment voucher — ${periodLabel(row)}${v ? ` (${v})` : ''}`, note: v ? `Voucher No. ${v}` : null });
        docId = doc.id;
      }
      await setVoucher(row.id, { voucher_no: v, ...(docId ? { voucher_doc_id: docId } : {}) });
      toast.success(v ? `Voucher ${v} saved${row.status === 'due' ? ' — the client is notified' : ''}` : 'Voucher saved');
      setOpen(false); onSaved?.();
    } catch (e) { toast.error(e.message); }
    setBusy(false);
  };
  const clear = async () => {
    if (!window.confirm('Remove the voucher number and unlink the PDF? (The PDF stays in the client\'s Documents.)')) return;
    setBusy(true);
    try { await setVoucher(row.id, { voucher_no: '', voucher_doc_id: null }); toast.success('Voucher removed'); setOpen(false); onSaved?.(); } catch (e) { toast.error(e.message); }
    setBusy(false);
  };

  if (!open) return (
    <span className="inline-flex items-center gap-1.5 flex-wrap" onClick={e => e.stopPropagation()}>
      {row.voucher_no || row.voucher_doc_id ? <>
        <VoucherInfo row={row} />
        <button type="button" onClick={start} title="Change voucher" className="p-0.5 text-gray-400 hover:text-primary-700"><Pencil size={11} /></button>
      </> : (
        <button type="button" onClick={start} className={`inline-flex items-center gap-1 font-semibold text-rose-700 hover:bg-rose-50 rounded px-1.5 py-0.5 ${compact ? 'text-[11px]' : 'text-xs'}`}><Receipt size={12} /> + Voucher no.</button>
      )}
    </span>
  );

  return (
    <div className="mt-1 rounded-lg border border-rose-200 bg-rose-50/60 p-2 space-y-1.5 text-left" onClick={e => e.stopPropagation()}>
      <div className="text-[11px] font-semibold text-rose-800 flex items-center gap-1"><Receipt size={12} /> IRD payment voucher — {periodLabel(row)}</div>
      <div className="flex items-center gap-1.5 flex-wrap">
        <input autoFocus className="input py-1 text-sm font-mono w-48" maxLength={40} placeholder="Voucher number" value={no}
          onChange={e => setNo(e.target.value)} onKeyDown={e => { if (e.key === 'Enter') save(); if (e.key === 'Escape') setOpen(false); }} />
        <input ref={fileRef} type="file" accept="application/pdf,image/*" className="hidden" onChange={e => setFile(e.target.files?.[0] ?? null)} />
        <button type="button" onClick={() => fileRef.current?.click()} className="btn-secondary text-xs py-1 px-2"><Upload size={12} /> {file ? 'Change PDF' : row.voucher_doc_id ? 'Replace PDF' : 'Attach PDF'}</button>
        {file && <span className="text-[11px] text-gray-600 truncate max-w-[140px]">{file.name}</span>}
      </div>
      <div className="flex items-center gap-1.5">
        <button type="button" disabled={busy} onClick={save} className="btn-primary text-xs py-1 px-2.5">{busy ? <Loader2 size={12} className="animate-spin" /> : <Check size={12} />} Save</button>
        <button type="button" disabled={busy} onClick={() => setOpen(false)} className="text-gray-400 hover:text-gray-600 p-1"><X size={14} /></button>
        {(row.voucher_no || row.voucher_doc_id) && <button type="button" disabled={busy} onClick={clear} className="ml-auto text-[11px] text-gray-500 hover:text-red-600">Remove</button>}
      </div>
      <div className="text-[10px] text-gray-500">The PDF is saved in the client's Documents → IRD payment voucher. The client sees the number on their dashboard.</div>
    </div>
  );
}
