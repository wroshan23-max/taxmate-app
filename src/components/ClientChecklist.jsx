// V68 — Client portal: "Documents TaxMate needs from you" (My Documents page)
import { useEffect, useRef, useState } from 'react';
import toast from 'react-hot-toast';
import { CheckCircle2, Circle, MinusCircle, UploadCloud, Loader2, ListChecks, Undo2 } from 'lucide-react';
import { ACCEPT, uploadDocument } from '../lib/documents';
import { progressOf, loadChecklists, clientItem } from '../lib/docChecklist';

const dmy = (d) => (d ? new Date(`${d}T00:00:00`).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' }) : '');

function Item({ i, clientId, userId, onDone }) {
  const [busy, setBusy] = useState(false);
  const fileRef = useRef(null);
  const upload = async (files) => {
    if (!files?.length) return;
    setBusy(true);
    try {
      let last;
      for (const f of files) last = await uploadDocument({ clientId, file: f, year: i.year, category: i.category, title: `${i.label} — ${f.name}`.slice(0, 150), role: 'client', userId });
      if (last?.id) await clientItem(i.id, 'attach', last.id);
      toast.success('Uploaded — thank you!');
      onDone();
    } catch (e) { toast.error(e.message, { duration: 7000 }); } finally { setBusy(false); if (fileRef.current) fileRef.current.value = ''; }
  };
  const na = async () => {
    const note = window.prompt(`"${i.label}"\n\nYou don't have this document? Tell us why (optional) — e.g. "No rent income this year".\nඔබට මෙම ලේඛනය නැත්නම් හේතුව සඳහන් කරන්න:`, '');
    if (note === null) return;
    try { await clientItem(i.id, 'na', null, note); toast.success('Noted — TaxMate will check'); onDone(); } catch (e) { toast.error(e.message); }
  };
  const undo = async () => { try { await clientItem(i.id, 'undo'); onDone(); } catch (e) { toast.error(e.message); } };
  return (
    <li className="flex flex-wrap items-start gap-2.5 px-3 py-2.5 sm:px-4">
      {i.status === 'received' ? <CheckCircle2 size={20} className="mt-0.5 shrink-0 text-green-600" /> : i.status === 'na' ? <MinusCircle size={20} className="mt-0.5 shrink-0 text-gray-400" /> : <Circle size={20} className="mt-0.5 shrink-0 text-amber-500" />}
      <div className="min-w-0 flex-1">
        <div className={`text-sm font-medium ${i.status === 'na' ? 'text-gray-400 line-through' : 'text-gray-900'}`}>{i.label}</div>
        {i.label_si && <div className="text-xs text-gray-500">{i.label_si}</div>}
        {i.hint && i.status === 'needed' && <div className="text-[11px] text-gray-400">{i.hint}</div>}
        {i.status === 'received' && <div className="text-[11px] font-semibold text-green-700">Received ✓ ලැබුණා</div>}
        {i.status === 'na' && <div className="text-[11px] text-gray-500">{i.na_by === 'client' ? `You said you don't have this${i.client_note ? `: ${i.client_note}` : ''}` : 'Not needed — TaxMate'}</div>}
      </div>
      {i.status === 'needed' && (
        <div className="flex w-full items-center gap-1.5 pl-7 sm:w-auto sm:pl-0">
          <input ref={fileRef} type="file" accept={ACCEPT} multiple hidden onChange={(e) => upload([...e.target.files])} />
          <button type="button" disabled={busy} onClick={() => fileRef.current?.click()} className="btn-primary px-3 py-1.5 text-xs">{busy ? <Loader2 size={13} className="animate-spin" /> : <UploadCloud size={13} />} Upload</button>
          <button type="button" disabled={busy} onClick={na} className="rounded-lg border px-2.5 py-1.5 text-xs text-gray-600 hover:bg-gray-50">I don't have this</button>
        </div>
      )}
      {i.status === 'na' && i.na_by === 'client' && <button type="button" onClick={undo} className="inline-flex items-center gap-1 text-[11px] text-gray-500 underline"><Undo2 size={11} /> Undo</button>}
    </li>
  );
}

export default function ClientChecklist({ clientId, userId, onUploaded }) {
  const [lists, setLists] = useState(null);
  const load = () => loadChecklists(clientId).then(setLists).catch(() => setLists([]));
  useEffect(() => { if (clientId) load(); }, [clientId]); // eslint-disable-line react-hooks/exhaustive-deps
  if (!lists?.length) return null;
  const shown = lists.filter((l, k) => l.items.length && (k === 0 || progressOf(l.items).missing.length));   // latest year + any year still missing something
  return (
    <div className="space-y-3">
      {shown.map((l) => {
        const p = progressOf(l.items);
        return (
          <div key={l.id} className={`card overflow-hidden ${p.missing.length ? 'border-amber-200' : 'border-green-200'}`}>
            <div className={`flex flex-wrap items-center gap-2 px-4 py-3 ${p.missing.length ? 'bg-amber-50/70' : 'bg-green-50/70'}`}>
              <ListChecks size={18} className={p.missing.length ? 'text-amber-700' : 'text-green-700'} />
              <div className="min-w-0 flex-1">
                <div className="font-bold text-gray-900">{p.missing.length ? `Documents we need — Y/A ${l.year}` : `All documents received — Y/A ${l.year}`}</div>
                <div className="text-xs text-gray-600">{p.missing.length ? `${p.missing.length} still needed · අවශ්‍ය ලේඛන ${p.missing.length}ක්${l.due_date ? ` · please send by ${dmy(l.due_date)}` : ''}` : 'Thank you! We\'ll start your return. ස්තූතියි!'}</div>
              </div>
              <div className="flex w-full items-center gap-2 sm:w-auto"><div className="h-2 flex-1 overflow-hidden rounded bg-white sm:w-24 sm:flex-none"><div className={`h-2 ${p.missing.length ? 'bg-amber-500' : 'bg-green-500'}`} style={{ width: `${p.pct}%` }} /></div><span className="text-xs font-semibold text-gray-700">{p.done}/{p.total}</span></div>
            </div>
            {l.note && <div className="border-b px-4 py-2 text-sm text-gray-700">💬 {l.note}</div>}
            <ul className="divide-y">{l.items.map((i) => <Item key={i.id} i={i} clientId={clientId} userId={userId} onDone={() => { load(); onUploaded?.(); }} />)}</ul>
            {p.missing.length > 0 && <div className="border-t bg-gray-50 px-4 py-2 text-[11px] text-gray-500">Photos or PDFs are fine. Your files stay private — only you and TaxMate can open them.</div>}
          </div>
        );
      })}
    </div>
  );
}
