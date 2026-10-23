import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import toast from 'react-hot-toast';
import { TrendingDown, Download, Loader2, Plus, X, CreditCard, Clock } from 'lucide-react';
import { supabase, fmtRs, fmtDate } from '../lib/supabase';
import { REVIEW_STATUS, requestReview, myReview, cancelReview, openReview } from '../lib/taxReview';
import { docYears, defaultDocYear } from '../lib/documents';

/** Client: request & download the Annual Tax Review report. */
export default function TaxReviewsClient({ clientId }) {
  const [rows, setRows] = useState([]);
  const [open, setOpen] = useState(false);
  const [f, setF] = useState({ year: defaultDocYear(), note: '' });
  const [busy, setBusy] = useState(null);

  const load = () => supabase.from('tax_reviews').select('*, invoices(id, invoice_no, status, total_amount)').eq('client_id', clientId).neq('status', 'cancelled').order('created_at', { ascending: false })
    .then(({ data }) => setRows(data ?? []));
  useEffect(() => { if (clientId) load(); }, [clientId]); // eslint-disable-line react-hooks/exhaustive-deps

  const submit = async () => {
    setBusy('new');
    try { await requestReview(f); toast.success('Request sent — TaxMate will prepare your review'); setOpen(false); load(); }
    catch (e) { toast.error(e.message); }
    setBusy(null);
  };
  const download = async (r) => {
    const w = window.open('', '_blank', 'width=900,height=1000');
    setBusy(r.id);
    try { const d = await myReview(r.id); if (!openReview(d, w)) toast.error('Pop-up blocked — allow pop-ups for this site'); }
    catch (e) { if (w) w.close(); toast.error(e.message); }
    setBusy(null);
  };

  return (
    <div className="card overflow-hidden">
      <div className="px-5 py-4 bg-gradient-to-r from-emerald-50 via-white to-amber-50 border-b border-gray-100 flex items-start gap-3">
        <div className="w-11 h-11 rounded-2xl bg-gradient-to-br from-emerald-600 to-teal-700 text-white flex items-center justify-center flex-shrink-0 shadow"><TrendingDown size={22} /></div>
        <div className="flex-1">
          <div className="font-bold text-gray-800">Annual Tax Review</div>
          <p className="text-sm text-gray-500">A personal report: your tax this year vs last year, where it came from, and how much you could save next year.</p>
          <p className="text-xs text-gray-400">වාර්ෂික බදු සමාලෝචනය — ලබන වසරේ බදු ඉතිරි කරගන්නා ආකාරය</p>
        </div>
        {!open && <button onClick={() => setOpen(true)} className="btn-primary text-xs py-1.5"><Plus size={13} /> Request</button>}
      </div>
      {open && (
        <div className="p-5 border-b border-gray-100 space-y-3 bg-gray-50/50">
          <label className="text-xs font-semibold text-gray-600 block">Year of assessment
            <select className="input mt-1" value={f.year} onChange={e => setF({ ...f, year: e.target.value })}>{docYears().map(y => <option key={y} value={y}>Y/A {y}</option>)}</select>
          </label>
          <input className="input" maxLength={500} placeholder="Anything you want us to look at? (optional)" value={f.note} onChange={e => setF({ ...f, note: e.target.value })} />
          <div className="flex gap-2">
            <button onClick={() => setOpen(false)} className="btn-secondary flex-1 justify-center text-sm"><X size={14} /> Cancel</button>
            <button onClick={submit} disabled={busy === 'new'} className="btn-primary flex-1 justify-center text-sm">{busy === 'new' ? <Loader2 size={14} className="animate-spin" /> : <TrendingDown size={14} />} Send request</button>
          </div>
        </div>
      )}
      {rows.length > 0 && (
        <div className="divide-y divide-gray-50">
          {rows.map(r => {
            const unpaid = r.status === 'issued' && r.invoices && r.invoices.status !== 'paid';
            return (
              <div key={r.id} className="px-5 py-3 flex items-center gap-3 flex-wrap">
                <div className="text-2xl">📈</div>
                <div className="flex-1 min-w-[160px]">
                  <div className="text-sm font-semibold text-gray-800">Y/A {r.year}</div>
                  <div className="text-[11px] text-gray-500">{r.status === 'issued' ? `Ready ${fmtDate(r.issued_at)}` : `Requested ${fmtDate(r.created_at)}`}</div>
                </div>
                <span className={`text-[11px] font-semibold px-2 py-0.5 rounded-md ${REVIEW_STATUS[r.status]?.cls}`}>{r.status === 'requested' && <Clock size={10} className="inline -mt-0.5 mr-0.5" />}{REVIEW_STATUS[r.status]?.label}</span>
                {r.status === 'requested' && <button onClick={async () => { try { await cancelReview(r.id); load(); } catch (e) { toast.error(e.message); } }} className="text-xs text-gray-500 hover:text-red-600">Cancel</button>}
                {unpaid && <Link to="/client/invoices" className="btn-primary text-xs py-1.5"><CreditCard size={13} /> Pay {fmtRs(r.invoices.total_amount)} to download</Link>}
                {r.status === 'issued' && !unpaid && <button onClick={() => download(r)} disabled={busy === r.id} className="btn-primary text-xs py-1.5">{busy === r.id ? <Loader2 size={13} className="animate-spin" /> : <Download size={13} />} Download PDF</button>}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
