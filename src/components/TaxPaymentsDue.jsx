// V58 — Client dashboard: APIT / instalments still to pay. "I've paid" → receipt upload → it leaves the list.
import { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import toast from 'react-hot-toast';
import { Landmark, Upload, Loader2, X, ChevronRight, AlertTriangle } from 'lucide-react';
import { supabase, fmtRs, fmtDate, VIEW_AS, PREVIEW_MSG } from '../lib/supabase';
import { periodLabel, irdCodesOf, isOverdue, markMyPaid } from '../lib/taxPayments';
import { VoucherInfo } from './TaxVoucher';
import { ClientNoticeButton } from './TaxNotice';

const today = () => new Date().toISOString().slice(0, 10);

/** The "I've paid" form — used on the dashboard and on the Tax Returns page */
export function MarkTaxPaidForm({ row, onDone, onCancel }) {
  const [f, setF] = useState({ amount: String(Math.round(Number(row.amount) || 0)), on: today(), ref: '', file: null });
  const [busy, setBusy] = useState(false);
  const fileRef = useRef(null);
  const save = async () => {
    if (VIEW_AS) return toast.error(PREVIEW_MSG);
    if (!(Number(f.amount) > 0)) return toast.error('Enter the amount you paid');
    if (!f.file) return toast.error('Attach the payment receipt');
    setBusy(true);
    try {
      await markMyPaid({ row, amount: f.amount, paidOn: f.on, reference: f.ref.trim(), file: f.file });
      toast.success('Thank you — marked as paid. TaxMate will check the receipt.');
      onDone?.();
    } catch (e) { toast.error(e.message); }
    setBusy(false);
  };
  return (
    <div className="mt-2 rounded-xl bg-green-50 border border-green-200 p-3 space-y-2">
      <div className="text-xs font-semibold text-green-900">I've paid {periodLabel(row)} · ගෙවීම කළා</div>
      <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
        <label className="text-[11px] text-gray-600">Amount paid (Rs.)
          <input className="input py-1.5 mt-0.5 text-right tabular-nums" inputMode="decimal" value={f.amount} onChange={e => setF(x => ({ ...x, amount: e.target.value.replace(/[^\d.]/g, '') }))} /></label>
        <label className="text-[11px] text-gray-600">Paid on
          <input type="date" className="input py-1.5 mt-0.5" max={today()} value={f.on} onChange={e => setF(x => ({ ...x, on: e.target.value }))} /></label>
        <label className="text-[11px] text-gray-600 col-span-2 sm:col-span-1">Reference (optional)
          <input className="input py-1.5 mt-0.5" maxLength={100} placeholder="Receipt / txn no." value={f.ref} onChange={e => setF(x => ({ ...x, ref: e.target.value }))} /></label>
      </div>
      <div className="flex items-center gap-2 flex-wrap">
        <input ref={fileRef} type="file" accept="image/*,application/pdf" className="hidden" onChange={e => setF(x => ({ ...x, file: e.target.files?.[0] ?? null }))} />
        <button type="button" onClick={() => fileRef.current?.click()} className="btn-secondary text-xs py-1.5"><Upload size={13} /> {f.file ? 'Change receipt' : 'Attach receipt'}</button>
        <span className="text-xs text-gray-600 truncate max-w-[200px]">{f.file ? f.file.name : 'Photo or PDF of the bank / OTPP receipt'}</span>
        <div className="ml-auto flex gap-1.5">
          <button type="button" onClick={onCancel} className="text-gray-400 hover:text-gray-600 p-1" aria-label="Cancel"><X size={16} /></button>
          <button type="button" onClick={save} disabled={busy} className="btn-primary text-xs py-1.5">{busy ? <Loader2 size={13} className="animate-spin" /> : null} Mark as paid</button>
        </div>
      </div>
    </div>
  );
}

export default function TaxPaymentsDue({ clientId }) {
  const [rows, setRows] = useState([]);
  const [openId, setOpenId] = useState(null);
  const load = () => {
    if (!clientId) return;
    supabase.from('tax_payments').select('*').eq('client_id', clientId).eq('status', 'due').gt('amount', 0).order('due_date')
      .then(({ data }) => setRows(data ?? []));
  };
  useEffect(load, [clientId]); // eslint-disable-line react-hooks/exhaustive-deps
  if (!rows.length) return null;
  const late = rows.filter(r => isOverdue(r));
  const total = rows.reduce((a, r) => a + Number(r.amount || 0), 0);

  return (
    <div className={`card overflow-hidden border-2 ${late.length ? 'border-red-200' : 'border-amber-200'}`}>
      <div className={`card-header ${late.length ? 'bg-red-50' : 'bg-amber-50'}`}><Landmark size={16} /> Tax payments to make <span className="font-normal text-xs text-gray-500">· ගෙවිය යුතු බදු</span>
        <span className={`ml-auto text-xs font-bold ${late.length ? 'text-red-700' : 'text-amber-800'}`}>{fmtRs(total)}{late.length ? ` · ${late.length} overdue` : ''}</span>
      </div>
      <div className="divide-y divide-gray-100">
        {rows.map(r => {
          const c = irdCodesOf(r), od = isOverdue(r);
          return (
            <div key={r.id} className="px-4 sm:px-5 py-3">
              <div className="flex items-start gap-3 flex-wrap">
                <div className="flex-1 min-w-[180px]">
                  <div className="font-semibold text-gray-800 text-sm">{periodLabel(r)} <span className="text-gray-400 font-normal">· Y/A {r.year}</span></div>
                  <div className={`text-xs ${od ? 'text-red-600 font-semibold' : 'text-amber-700'}`}>{od ? <><AlertTriangle size={11} className="inline -mt-0.5" /> Overdue — was due</> : 'Pay on or before'} {fmtDate(r.due_date)}</div>
                  {c && <div className="text-[11px] text-gray-500 mt-0.5">IRD codes: Tax Type <b className="font-mono text-gray-700">{c.typeCode}</b> · Period <b className="font-mono text-gray-700">{c.periodCode}</b> · Category <b className="font-mono text-gray-700">{c.category}</b></div>}
                  <div className="flex items-center gap-2 flex-wrap mt-1"><VoucherInfo row={r} /><ClientNoticeButton row={r} /></div>
                  {r.note && <div className="text-[11px] text-red-700 mt-0.5">TaxMate: {r.note}</div>}
                </div>
                <div className="text-right">
                  <div className="font-black text-primary-800 tabular-nums">{fmtRs(r.amount)}</div>
                  {openId !== r.id && <button onClick={() => setOpenId(r.id)} className="mt-1 text-xs font-bold bg-green-600 hover:bg-green-700 text-white rounded-lg px-2.5 py-1">I've paid ✓</button>}
                </div>
              </div>
              {openId === r.id && <MarkTaxPaidForm row={r} onCancel={() => setOpenId(null)} onDone={() => { setOpenId(null); setRows(x => x.filter(y => y.id !== r.id)); }} />}
            </div>
          );
        })}
      </div>
      <div className="px-4 sm:px-5 py-2 bg-gray-50 text-[11px] text-gray-500 flex items-center gap-2 flex-wrap">
        <span className="flex-1">Worked out by TaxMate. Pay through IRD OTPP or at BOC / People's Bank, then tap <b>I've paid</b> and upload the receipt. Paid amounts count in your tax return.</span>
        <Link to="/client/tax-returns" className="text-primary-700 font-semibold inline-flex items-center">All payments <ChevronRight size={12} /></Link>
      </div>
    </div>
  );
}
