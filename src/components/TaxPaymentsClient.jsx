// V57/V58 — Client: APIT & quarterly instalments TaxMate worked out · "I've paid" with receipt · undo before TaxMate checks
import { useEffect, useState } from 'react';
import toast from 'react-hot-toast';
import { Wallet, Paperclip } from 'lucide-react';
import { fmtRs, fmtDate, VIEW_AS, PREVIEW_MSG } from '../lib/supabase';
import { loadPayments, periodLabel, irdCodesOf, isOverdue, undoMyPaid, receiptUrl } from '../lib/taxPayments';
import { MarkTaxPaidForm } from './TaxPaymentsDue';

export default function TaxPaymentsClient({ clientId }) {
  const [rows, setRows] = useState([]);
  const [openId, setOpenId] = useState(null);
  const load = () => loadPayments(clientId).then(setRows).catch(() => setRows([]));
  useEffect(() => { load(); }, [clientId]); // eslint-disable-line react-hooks/exhaustive-deps
  if (!rows.length) return null;
  const years = [...new Set(rows.map(r => r.year))];
  const openReceipt = async (r) => {
    const w = window.open('', '_blank');
    try { const u = await receiptUrl(r.receipt_path); if (w) w.location.href = u; else window.open(u, '_blank'); } catch (e) { w?.close(); toast.error(e.message); }
  };
  const undo = async (r) => {
    if (VIEW_AS) return toast.error(PREVIEW_MSG);
    if (!window.confirm(`Undo "paid" for ${periodLabel(r)}?`)) return;
    try { await undoMyPaid(r.id); toast.success('Marked as not paid'); load(); } catch (e) { toast.error(e.message); }
  };
  return (
    <div className="card">
      <div className="card-header"><Wallet size={16} /> Tax payments — APIT &amp; instalments <span className="font-normal text-gray-400 text-xs">· බදු ගෙවීම්</span></div>
      <div className="p-4 space-y-4">
        {years.map(y => {
          const list = rows.filter(r => r.year === y).sort((a, b) => (a.kind === b.kind ? a.period.localeCompare(b.period) : a.kind === 'instalment' ? -1 : 1));
          const paid = list.filter(r => r.status === 'paid').reduce((a, r) => a + Number(r.paid_amount ?? r.amount), 0);
          return (
            <div key={y}>
              <div className="flex items-center text-sm font-semibold text-gray-700 mb-1">Y/A {y}<span className="ml-auto text-xs font-normal text-gray-500">Paid so far: <b className="text-green-700">{fmtRs(paid)}</b> — counted in your tax return</span></div>
              <div className="divide-y divide-gray-50">
                {list.map(r => {
                  const late = isOverdue(r), c = irdCodesOf(r), mine = r.status === 'paid' && r.paid_by_role === 'client';
                  return (
                    <div key={r.id} className="py-1.5">
                      <div className="flex items-center gap-2 text-sm flex-wrap">
                        <span className="flex-1 min-w-[160px] text-gray-700">{periodLabel(r)}
                          {c && r.status !== 'paid' && <span className="block text-[10px] text-gray-400">Tax Type {c.typeCode} · Period {c.periodCode} · Category {c.category}</span>}</span>
                        <span className="tabular-nums font-semibold w-28 text-right">{fmtRs(r.status === 'paid' ? (r.paid_amount ?? r.amount) : r.amount)}</span>
                        <span className={`text-xs w-44 text-right ${r.status === 'paid' ? 'text-green-700' : late ? 'text-red-600 font-semibold' : 'text-amber-700'}`}>
                          {r.status === 'paid' ? `✓ Paid${r.paid_on ? ` ${fmtDate(r.paid_on)}` : ''}${mine ? (r.checked_at ? ' · checked' : ' · TaxMate checking') : ''}` : `${late ? 'Overdue — was due' : 'Due'} ${fmtDate(r.due_date)}`}
                        </span>
                        <span className="w-24 text-right whitespace-nowrap">
                          {r.status !== 'paid' && openId !== r.id && Number(r.amount) > 0 && <button onClick={() => setOpenId(r.id)} className="text-xs font-semibold text-green-700 hover:underline">I've paid</button>}
                          {mine && r.receipt_path && <button onClick={() => openReceipt(r)} title="View receipt" className="text-gray-400 hover:text-primary-700 p-1"><Paperclip size={13} /></button>}
                          {mine && !r.checked_at && <button onClick={() => undo(r)} className="text-[11px] text-gray-400 hover:text-amber-700">undo</button>}
                        </span>
                      </div>
                      {r.status !== 'paid' && r.note && <div className="text-[11px] text-red-700">TaxMate: {r.note}</div>}
                      {openId === r.id && <MarkTaxPaidForm row={r} onCancel={() => setOpenId(null)} onDone={() => { setOpenId(null); load(); }} />}
                    </div>
                  );
                })}
              </div>
            </div>
          );
        })}
        <p className="text-[11px] text-gray-500">Worked out by TaxMate. After you pay, tap <b>I've paid</b> and upload the receipt — the paid amount is deducted from the tax in your annual return.</p>
      </div>
    </div>
  );
}
