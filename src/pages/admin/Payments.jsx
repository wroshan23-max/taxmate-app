import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import toast from 'react-hot-toast';
import { CreditCard, Landmark, Eye, Check, X, Loader2, Settings as Cog, Search } from 'lucide-react';
import { supabase, fmtRs, fmtDate } from '../../lib/supabase';
import { PAY_STATUS, slipUrl } from '../../lib/payments';

const FILTERS = [['review', '🔎 To confirm'], ['paid', '✅ Paid'], ['payhere', '💳 PayHere'], ['bank', '🏦 Bank'], ['all', 'All']];

export default function Payments() {
  const [rows, setRows] = useState(null);
  const [filter, setFilter] = useState('review');
  const [q, setQ] = useState('');
  const [preview, setPreview] = useState(null);   // { row, url, pdf }
  const [busy, setBusy] = useState(null);
  const [note, setNote] = useState('');

  const load = async () => {
    const { data, error } = await supabase.from('payments')
      .select('*, invoices(invoice_no, total_amount, status), clients(full_name, mobile)')
      .order('created_at', { ascending: false }).limit(300);
    if (error) toast.error(error.message);
    setRows(data ?? []);
  };
  useEffect(() => { load(); }, []);

  const open = async (r) => {
    try { setNote(''); setPreview({ row: r, url: await slipUrl(r.slip_path), pdf: /\.pdf$/i.test(r.slip_path) }); }
    catch (e) { toast.error(e.message); }
  };
  const review = async (r, ok) => {
    setBusy(r.id);
    const { error } = await supabase.rpc('admin_review_payment', { p_payment: r.id, p_ok: ok, p_note: note });
    setBusy(null);
    if (error) return toast.error(error.message);
    toast.success(ok ? `Confirmed — ${r.invoices?.invoice_no} is now Paid` : 'Slip rejected');
    setPreview(null); load();
  };

  const shown = (rows ?? []).filter(r => (filter === 'all' || (['payhere', 'bank'].includes(filter) ? r.method === filter : r.status === filter))
    && (!q || `${r.clients?.full_name} ${r.invoices?.invoice_no} ${r.reference ?? ''} ${r.order_id ?? ''}`.toLowerCase().includes(q.toLowerCase())));
  const count = (k) => (rows ?? []).filter(r => (['payhere', 'bank'].includes(k) ? r.method === k : k === 'all' || r.status === k)).length;
  const month = new Date().toISOString().slice(0, 7);
  const received = (rows ?? []).filter(r => r.status === 'paid' && (r.confirmed_at || r.created_at).slice(0, 7) === month).reduce((t, r) => t + Number(r.amount), 0);

  return (
    <div className="space-y-5">
      <div className="flex items-end gap-3 flex-wrap">
        <div>
          <h1 className="text-2xl font-bold text-primary-800">💳 Payments</h1>
          <p className="text-sm text-gray-500">Online (PayHere) and bank-slip payments from clients · received this month <b className="text-emerald-700">{fmtRs(received)}</b></p>
        </div>
        <Link to="/admin/settings?tab=payments" className="ml-auto btn-secondary text-sm"><Cog size={15} /> Payment settings</Link>
      </div>

      <div className="flex items-center gap-2 flex-wrap">
        {FILTERS.map(([k, l]) => (
          <button key={k} onClick={() => setFilter(k)} className={`px-3 py-1.5 rounded-full text-xs font-semibold ${filter === k ? 'bg-primary-700 text-white' : 'bg-white border border-gray-200 text-gray-600 hover:border-primary-300'}`}>
            {l} <span className="opacity-60">{count(k)}</span>
          </button>
        ))}
        <div className="relative ml-auto"><Search size={14} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-gray-400" />
          <input className="input pl-8 py-1.5 text-sm w-52" placeholder="Client, invoice, reference" value={q} onChange={e => setQ(e.target.value)} /></div>
      </div>

      <div className="card overflow-hidden">
        {rows === null ? <div className="p-10 text-center text-gray-400"><Loader2 className="animate-spin mx-auto" /></div>
          : shown.length === 0 ? <div className="p-10 text-center text-gray-400 text-sm">{filter === 'review' ? '✅ No bank slips waiting for you.' : 'No payments yet.'}</div> : (
          <div className="divide-y divide-gray-50">
            {shown.map(r => (
              <div key={r.id} className="px-4 py-3 flex items-center gap-3 flex-wrap">
                <div className={`w-10 h-10 rounded-xl flex items-center justify-center flex-shrink-0 ${r.method === 'payhere' ? 'bg-indigo-50 text-indigo-600' : 'bg-emerald-50 text-emerald-600'}`}>{r.method === 'payhere' ? <CreditCard size={18} /> : <Landmark size={18} />}</div>
                <div className="flex-1 min-w-[200px]">
                  <div className="text-sm font-semibold text-gray-800">{r.clients?.full_name ?? '—'} · <span className="font-mono">{r.invoices?.invoice_no}</span></div>
                  <div className="text-[11px] text-gray-500">
                    {r.method === 'payhere' ? `PayHere${r.card ? ` · ${r.card}` : ''}${r.gateway_ref ? ` · #${r.gateway_ref}` : ''}` : `Bank${r.reference ? ` · ref ${r.reference}` : ''}${r.paid_on ? ` · paid ${fmtDate(r.paid_on)}` : ''}`}
                    {' · '}{fmtDate(r.created_at)}{r.note ? ` · “${r.note}”` : ''}
                  </div>
                </div>
                <div className="font-black text-primary-800 tabular-nums">{fmtRs(r.amount)}</div>
                <span className={`text-[11px] font-semibold px-2 py-0.5 rounded-md ${PAY_STATUS[r.status]?.cls}`}>{PAY_STATUS[r.status]?.emoji} {PAY_STATUS[r.status]?.label}</span>
                {r.slip_path && <button onClick={() => open(r)} className="btn-secondary text-xs py-1"><Eye size={13} /> {r.status === 'review' ? 'Check slip' : 'Slip'}</button>}
              </div>
            ))}
          </div>
        )}
      </div>

      {preview && (
        <div className="fixed inset-0 z-50 bg-black/60 flex items-center justify-center p-3" onClick={() => setPreview(null)}>
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-3xl max-h-[94vh] flex flex-col overflow-hidden" onClick={e => e.stopPropagation()}>
            <div className="px-4 py-3 border-b flex items-center gap-2">
              <div className="flex-1 text-sm"><b>{preview.row.clients?.full_name}</b> · {preview.row.invoices?.invoice_no} · invoice {fmtRs(preview.row.invoices?.total_amount)} · slip says <b>{fmtRs(preview.row.amount)}</b></div>
              <button onClick={() => setPreview(null)} className="p-1.5 rounded-lg hover:bg-gray-100"><X size={17} /></button>
            </div>
            <div className="flex-1 bg-gray-100 overflow-auto flex items-center justify-center min-h-[40vh]">
              {preview.pdf ? <iframe src={preview.url} title="Slip" className="w-full h-[65vh] bg-white" /> : <img src={preview.url} alt="Payment slip" className="max-w-full max-h-[65vh] object-contain" />}
            </div>
            {preview.row.status === 'review' && (
              <div className="p-3 border-t flex items-center gap-2 flex-wrap">
                <input className="input flex-1 min-w-[180px] text-sm" placeholder="Note (optional, e.g. reason if rejected)" value={note} onChange={e => setNote(e.target.value)} />
                <button onClick={() => review(preview.row, false)} disabled={!!busy} className="btn-secondary text-sm !text-red-600"><X size={15} /> Reject</button>
                <button onClick={() => review(preview.row, true)} disabled={!!busy} className="btn-primary text-sm">{busy ? <Loader2 size={15} className="animate-spin" /> : <Check size={15} />} Confirm — mark invoice paid</button>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
