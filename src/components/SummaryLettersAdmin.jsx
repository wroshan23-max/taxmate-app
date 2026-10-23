import { useEffect, useState } from 'react';
import toast from 'react-hot-toast';
import { FileBadge2, Plus, Printer, Loader2, X, Check, Ban, Receipt } from 'lucide-react';
import { supabase, fmtRs, fmtDate } from '../lib/supabase';
import { PURPOSES, LETTER_STATUS, issueLetter, openLetter, adminLetterData } from '../lib/summaryLetter';
import { docYears } from '../lib/documents';

/** Admin: Income & Tax summary letters for one client (requests from the portal + issue new). */
export default function SummaryLettersAdmin({ client, calculations, returns, userId }) {
  const [rows, setRows] = useState([]);
  const [issuing, setIssuing] = useState(null);    // letter being issued (or new draft)
  const [f, setF] = useState({});
  const [busy, setBusy] = useState(false);

  const load = () => supabase.from('summary_letters').select('*, invoices(invoice_no, status)').eq('client_id', client.id).order('created_at', { ascending: false })
    .then(({ data }) => setRows(data ?? []));
  useEffect(() => { load(); }, [client.id]); // eslint-disable-line react-hooks/exhaustive-deps

  const calcsFor = (year) => calculations.filter(c => c.year === year && c.calc_type !== 'quarterly')
    .sort((a, b) => (b.status === 'final') - (a.status === 'final') || new Date(b.created_at) - new Date(a.created_at));
  const startIssue = (l) => {
    const cs = calcsFor(l.year);
    setF({ calcId: cs[0]?.id ?? '', fee: l.fee ? String(l.fee) : '', addressedTo: l.addressed_to ?? '', purpose: l.purpose, year: l.year });
    setIssuing(l);
  };
  const newLetter = () => startIssue({ id: null, year: docYears().find(y => calcsFor(y).length) ?? docYears()[1], purpose: 'visa', fee: 0 });

  const issue = async () => {
    const calc = calculations.find(c => c.id === f.calcId);
    if (!calc) return toast.error('Choose the computation to use');
    if (calc.status !== 'final' && !window.confirm('This computation is still a DRAFT. Issue the letter anyway?')) return;
    setBusy(true);
    try {
      let letter = issuing;
      if (!letter.id || letter.year !== f.year || letter.purpose !== f.purpose || (letter.addressed_to ?? '') !== f.addressedTo) {
        const patch = { client_id: client.id, year: f.year, purpose: f.purpose, addressed_to: f.addressedTo.trim() || null };
        const { data, error } = letter.id
          ? await supabase.from('summary_letters').update(patch).eq('id', letter.id).select().single()
          : await supabase.from('summary_letters').insert({ ...patch, requested_by: userId }).select().single();
        if (error) throw error;
        letter = data;
      }
      const ret = returns.find(r => r.year === f.year && r.stage === 'filed');
      await issueLetter({ letter, calc, client, filedAt: ret ? (ret.stage_at?.filed ?? ret.updated_at) : null, fee: f.fee, userId });
      toast.success(Number(f.fee) > 0 ? 'Letter issued — fee invoice created; the client can download after paying' : 'Letter issued — the client can download it now');
      setIssuing(null); load();
      if (!openLetter(await adminLetterData(letter.id))) toast('Click PDF to open the letter');
    } catch (e) { toast.error(e.message); }
    setBusy(false);
  };
  const reject = async (l) => {
    const note = window.prompt('Reason (shown to you only):', '');
    if (note === null) return;
    const { error } = await supabase.from('summary_letters').update({ status: 'rejected', admin_note: note || null }).eq('id', l.id);
    if (error) return toast.error(error.message);
    load();
  };
  const view = async (l) => { const w = window.open('', '_blank', 'width=900,height=1000'); try { if (!openLetter(await adminLetterData(l.id), w)) toast.error('Pop-up blocked'); } catch (e) { if (w) w.close(); toast.error(e.message); } };

  return (
    <div className="card">
      <div className="card-header"><FileBadge2 size={16} /> Income &amp; Tax summary letters
        <span className="text-xs font-normal text-gray-400">for visa / bank loans</span>
        <button onClick={newLetter} className="ml-auto btn-primary text-xs py-1"><Plus size={13} /> New letter</button>
      </div>
      {rows.length === 0 && !issuing ? <div className="p-6 text-center text-sm text-gray-400">No letters yet. Clients can request one from their portal.</div> : (
        <div className="divide-y divide-gray-50">
          {rows.map(l => (
            <div key={l.id} className="px-5 py-3 flex items-center gap-3 flex-wrap">
              <div className="text-2xl">{PURPOSES[l.purpose]?.emoji}</div>
              <div className="flex-1 min-w-[200px]">
                <div className="text-sm font-semibold text-gray-800">Y/A {l.year} · {PURPOSES[l.purpose]?.label}{l.ref && <span className="font-mono text-xs text-gray-500"> · {l.ref}</span>}</div>
                <div className="text-[11px] text-gray-500">{l.addressed_to ? `To: ${l.addressed_to} · ` : ''}{l.status === 'issued' ? `Issued ${fmtDate(l.issued_at)}` : `Requested ${fmtDate(l.created_at)}`}{l.client_note ? ` · “${l.client_note}”` : ''}</div>
                {l.invoices && <div className="text-[11px] mt-0.5 flex items-center gap-1"><Receipt size={11} /> Fee {fmtRs(l.fee)} · {l.invoices.invoice_no} · <b className={l.invoices.status === 'paid' ? 'text-emerald-700' : 'text-amber-700'}>{l.invoices.status === 'paid' ? 'paid' : 'unpaid — client can download after paying'}</b></div>}
              </div>
              <span className={`text-[11px] font-semibold px-2 py-0.5 rounded-md ${LETTER_STATUS[l.status]?.cls}`}>{LETTER_STATUS[l.status]?.label}</span>
              {l.status === 'requested' && <>
                <button onClick={() => startIssue(l)} className="btn-primary text-xs py-1"><Check size={13} /> Issue</button>
                <button onClick={() => reject(l)} className="btn-secondary text-xs py-1"><Ban size={13} /></button>
              </>}
              {l.status === 'issued' && <button onClick={() => view(l)} className="btn-secondary text-xs py-1"><Printer size={13} /> PDF</button>}
            </div>
          ))}
        </div>
      )}

      {issuing && (
        <div className="m-4 rounded-2xl border border-primary-200 bg-primary-50/40 p-4 space-y-3">
          <div className="flex items-center gap-2"><div className="font-bold text-primary-800 text-sm flex-1">{issuing.id ? 'Issue requested letter' : 'New letter'}</div><button onClick={() => setIssuing(null)} className="p-1 rounded hover:bg-white"><X size={15} /></button></div>
          <div className="grid sm:grid-cols-2 gap-3">
            <label className="text-xs font-semibold text-gray-600">Year of assessment
              <select className="input mt-1" value={f.year} onChange={e => setF({ ...f, year: e.target.value, calcId: calcsFor(e.target.value)[0]?.id ?? '' })}>
                {docYears().map(y => <option key={y} value={y}>Y/A {y}</option>)}
              </select>
            </label>
            <label className="text-xs font-semibold text-gray-600">Purpose
              <select className="input mt-1" value={f.purpose} onChange={e => setF({ ...f, purpose: e.target.value })}>
                {Object.entries(PURPOSES).map(([k, p]) => <option key={k} value={k}>{p.emoji} {p.label}</option>)}
              </select>
            </label>
            <label className="text-xs font-semibold text-gray-600 sm:col-span-2">Computation to use
              <select className="input mt-1" value={f.calcId} onChange={e => setF({ ...f, calcId: e.target.value })}>
                {calcsFor(f.year).length === 0 && <option value="">No saved computation for Y/A {f.year}</option>}
                {calcsFor(f.year).map(c => <option key={c.id} value={c.id}>{c.status === 'final' ? '✅ FINAL' : '📝 DRAFT'} · {c.label || 'IIT computation'} · {fmtDate(c.created_at)}</option>)}
              </select>
            </label>
            <label className="text-xs font-semibold text-gray-600 sm:col-span-2">Addressed to (optional)
              <textarea className="input mt-1 resize-none" rows={2} maxLength={200} placeholder={'e.g. The Visa Officer\nHigh Commission of …'} value={f.addressedTo} onChange={e => setF({ ...f, addressedTo: e.target.value })} />
            </label>
            <label className="text-xs font-semibold text-gray-600">Fee (Rs.) — 0 = free
              <input className="input mt-1 text-right" inputMode="decimal" placeholder="0" value={f.fee} onChange={e => setF({ ...f, fee: e.target.value.replace(/[^\d.]/g, '') })} />
            </label>
            <div className="text-[11px] text-gray-500 self-end pb-2">{Number(f.fee) > 0 ? 'An unpaid invoice is created; the client downloads the letter after paying (online or bank slip).' : 'The client can download the letter straight away.'}</div>
          </div>
          <button onClick={issue} disabled={busy || !f.calcId} className="btn-primary w-full justify-center">{busy ? <Loader2 size={15} className="animate-spin" /> : <FileBadge2 size={15} />} Issue letter</button>
        </div>
      )}
    </div>
  );
}
