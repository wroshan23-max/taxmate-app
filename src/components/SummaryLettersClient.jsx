import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import toast from 'react-hot-toast';
import { FileBadge2, Download, Loader2, Plus, X, CreditCard, Clock } from 'lucide-react';
import { supabase, fmtRs, fmtDate } from '../lib/supabase';
import { PURPOSES, LETTER_STATUS, requestLetter, myLetter, cancelLetter, openLetter } from '../lib/summaryLetter';
import { docYears, defaultDocYear } from '../lib/documents';

/** Client: request and download an "Income & Tax summary" letter (visa / bank loan). */
export default function SummaryLettersClient({ clientId }) {
  const [rows, setRows] = useState([]);
  const [open, setOpen] = useState(false);
  const [f, setF] = useState({ year: defaultDocYear(), purpose: 'visa', addressedTo: '', note: '' });
  const [busy, setBusy] = useState(null);

  const load = () => supabase.from('summary_letters').select('*, invoices(id, invoice_no, status, total_amount)').eq('client_id', clientId).order('created_at', { ascending: false })
    .then(({ data }) => setRows(data ?? []));
  useEffect(() => { if (clientId) load(); }, [clientId]); // eslint-disable-line react-hooks/exhaustive-deps

  const submit = async () => {
    setBusy('new');
    try { await requestLetter(f); toast.success('Request sent — TaxMate will prepare your letter'); setOpen(false); load(); }
    catch (e) { toast.error(e.message); }
    setBusy(null);
  };
  const download = async (l) => {
    const w = window.open('', '_blank', 'width=900,height=1000');   // open now so the pop-up isn't blocked
    setBusy(l.id);
    try { const d = await myLetter(l.id); if (!openLetter(d, w)) toast.error('Pop-up blocked — allow pop-ups for this site'); }
    catch (e) { if (w) w.close(); toast.error(e.message); }
    setBusy(null);
  };
  const cancel = async (l) => { try { await cancelLetter(l.id); load(); } catch (e) { toast.error(e.message); } };

  return (
    <div className="card overflow-hidden">
      <div className="px-5 py-4 bg-gradient-to-r from-indigo-50 via-white to-amber-50 border-b border-gray-100 flex items-start gap-3">
        <div className="w-11 h-11 rounded-2xl bg-gradient-to-br from-indigo-600 to-primary-700 text-white flex items-center justify-center flex-shrink-0 shadow"><FileBadge2 size={22} /></div>
        <div className="flex-1">
          <div className="font-bold text-gray-800">Income &amp; Tax summary letter</div>
          <p className="text-sm text-gray-500">An official letter from TaxMate showing your income and tax — for visa applications, bank loans and more. Banks can verify it online.</p>
          <p className="text-xs text-gray-400">වීසා / බැංකු ණය සඳහා ආදායම් හා බදු සාරාංශ ලිපිය</p>
        </div>
        {!open && <button onClick={() => setOpen(true)} className="btn-primary text-xs py-1.5"><Plus size={13} /> Request</button>}
      </div>

      {open && (
        <div className="p-5 border-b border-gray-100 space-y-3 bg-gray-50/50">
          <div className="grid sm:grid-cols-2 gap-3">
            <label className="text-xs font-semibold text-gray-600">Year of assessment
              <select className="input mt-1" value={f.year} onChange={e => setF({ ...f, year: e.target.value })}>{docYears().map(y => <option key={y} value={y}>Y/A {y}</option>)}</select>
            </label>
            <label className="text-xs font-semibold text-gray-600">What is it for?
              <select className="input mt-1" value={f.purpose} onChange={e => setF({ ...f, purpose: e.target.value })}>
                {Object.entries(PURPOSES).map(([k, p]) => <option key={k} value={k}>{p.emoji} {p.label} · {p.si}</option>)}
              </select>
            </label>
          </div>
          <input className="input" maxLength={200} placeholder="Addressed to (optional) — e.g. The Visa Officer, Australian High Commission" value={f.addressedTo} onChange={e => setF({ ...f, addressedTo: e.target.value })} />
          <input className="input" maxLength={500} placeholder="Note (optional) — e.g. needed by 15 November" value={f.note} onChange={e => setF({ ...f, note: e.target.value })} />
          <div className="flex gap-2">
            <button onClick={() => setOpen(false)} className="btn-secondary flex-1 justify-center text-sm"><X size={14} /> Cancel</button>
            <button onClick={submit} disabled={busy === 'new'} className="btn-primary flex-1 justify-center text-sm">{busy === 'new' ? <Loader2 size={14} className="animate-spin" /> : <FileBadge2 size={14} />} Send request</button>
          </div>
        </div>
      )}

      {rows.length > 0 && (
        <div className="divide-y divide-gray-50">
          {rows.map(l => {
            const unpaid = l.status === 'issued' && l.invoices && l.invoices.status !== 'paid';
            return (
              <div key={l.id} className="px-5 py-3 flex items-center gap-3 flex-wrap">
                <div className="text-2xl">{PURPOSES[l.purpose]?.emoji}</div>
                <div className="flex-1 min-w-[180px]">
                  <div className="text-sm font-semibold text-gray-800">Y/A {l.year} · {PURPOSES[l.purpose]?.label}</div>
                  <div className="text-[11px] text-gray-500">{l.status === 'issued' ? `Ready ${fmtDate(l.issued_at)}${l.ref ? ` · Ref ${l.ref}` : ''}` : `Requested ${fmtDate(l.created_at)}`}</div>
                </div>
                <span className={`text-[11px] font-semibold px-2 py-0.5 rounded-md ${LETTER_STATUS[l.status]?.cls}`}>{l.status === 'requested' && <Clock size={10} className="inline -mt-0.5 mr-0.5" />}{LETTER_STATUS[l.status]?.label}</span>
                {l.status === 'requested' && <button onClick={() => cancel(l)} className="text-xs text-gray-500 hover:text-red-600">Cancel</button>}
                {unpaid && <Link to="/client/invoices" className="btn-primary text-xs py-1.5"><CreditCard size={13} /> Pay {fmtRs(l.invoices.total_amount)} to download</Link>}
                {l.status === 'issued' && !unpaid && <button onClick={() => download(l)} disabled={busy === l.id} className="btn-primary text-xs py-1.5">{busy === l.id ? <Loader2 size={13} className="animate-spin" /> : <Download size={13} />} Download PDF</button>}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
