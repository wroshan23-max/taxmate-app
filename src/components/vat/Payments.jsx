// V64 — payments received: list, filters, record, export
import { useEffect, useMemo, useState } from 'react';
import toast from 'react-hot-toast';
import { Wallet, Plus, Search, Download, Paperclip } from 'lucide-react';
import { loadPayments, loadAllocations, voidPayment, vatFileUrl } from '../../lib/vat/api';
import { rs, money, dmy, slToday, METHODS } from '../../lib/vat/format';
import { downloadXlsx } from '../../lib/xlsx';
import { Empty, downloadCsv, Spinner } from './ui';
import PaymentForm from './PaymentForm';

export default function Payments({ app }) {
  const { clientId, data, can, openDoc, tick, reload } = app;
  const [list, setList] = useState(null);
  const [alloc, setAlloc] = useState([]);
  const [q, setQ] = useState('');
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [method, setMethod] = useState('');
  const [open, setOpen] = useState(false);
  const load = () => Promise.all([loadPayments(clientId), loadAllocations(clientId)]).then(([p, a]) => { setList(p); setAlloc(a); }).catch((e) => toast.error(e.message));
  useEffect(() => { load(); }, [clientId, tick]); // eslint-disable-line react-hooks/exhaustive-deps
  const custName = useMemo(() => Object.fromEntries(data.customers.map((c) => [c.id, c.name])), [data.customers]);
  const docNo = useMemo(() => Object.fromEntries(data.docs.map((d) => [d.id, d.doc_no])), [data.docs]);
  if (!list) return <Spinner />;
  const rows = list.filter((p) => (!from || p.paid_on >= from) && (!to || p.paid_on <= to) && (!method || p.method === method)
    && (!q || [p.receipt_no, p.reference, custName[p.customer_id], p.bank].filter(Boolean).join(' ').toLowerCase().includes(q.toLowerCase())));
  const allocOf = (pid) => alloc.filter((a) => a.payment_id === pid);
  const total = rows.filter((p) => !p.voided_at).reduce((a, p) => a + Number(p.amount), 0);
  const sheet = () => [['Receipt', 'Date', 'Customer', 'Method', 'Reference', 'Bank', 'Amount', 'Applied to', 'Unapplied', 'Void reason'],
    ...rows.map((p) => { const a = allocOf(p.id); const used = a.reduce((x, y) => x + Number(y.amount), 0);
      return [p.receipt_no, p.paid_on, custName[p.customer_id] || '', METHODS[p.method], p.reference, p.bank, Number(p.amount), a.map((x) => `${docNo[x.doc_id]} (${money(x.amount)})`).join('; '), Number(p.amount) - used, p.void_reason || '']; })];

  return (
    <div className="space-y-3">
      <div className="card space-y-2 p-3">
        <div className="flex flex-wrap items-center gap-2">
          <div className="relative min-w-[200px] flex-1"><Search size={14} className="absolute left-2.5 top-2.5 text-gray-400" /><input className="input pl-8" placeholder="Receipt, reference, customer, bank…" value={q} onChange={(e) => setQ(e.target.value)} /></div>
          {can('payment') && <button type="button" className="btn-primary px-3 py-1.5 text-sm" onClick={() => setOpen(true)}><Plus size={14} /> Customer payment</button>}
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <input type="date" className="input w-auto py-1.5" value={from} onChange={(e) => setFrom(e.target.value)} aria-label="From" />
          <input type="date" className="input w-auto py-1.5" value={to} onChange={(e) => setTo(e.target.value)} aria-label="To" />
          <select className="input w-auto py-1.5" value={method} onChange={(e) => setMethod(e.target.value)} aria-label="Method"><option value="">All methods</option>{Object.entries(METHODS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select>
          <span className="flex-1 text-right text-xs text-gray-500">{rows.length} payments · {rs(total)}</span>
          <button type="button" className="text-xs font-semibold text-primary-700" onClick={() => downloadCsv(`payments-${slToday()}.csv`, sheet())}><Download size={12} className="inline" /> CSV</button>
          <button type="button" className="text-xs font-semibold text-primary-700" onClick={() => downloadXlsx(`payments-${slToday()}.xlsx`, [{ name: 'Payments', rows: sheet(), freeze: 1, widths: [14, 12, 28, 14, 16, 14, 14, 40, 12, 20] }])}><Download size={12} className="inline" /> Excel</button>
        </div>
      </div>
      {rows.length === 0 ? <Empty icon={Wallet} title="No payments">Record payments from an invoice, or a customer payment here.</Empty> : (
        <div className="card overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-gray-50"><tr><th className="table-th">Receipt</th><th className="table-th">Customer</th><th className="table-th hidden md:table-cell">Applied to</th><th className="table-th text-right">Amount</th><th className="table-th" /></tr></thead>
            <tbody className="divide-y divide-gray-50">
              {rows.map((p) => { const a = allocOf(p.id); const used = a.reduce((x, y) => x + Number(y.amount), 0); return (
                <tr key={p.id} className={p.voided_at ? 'text-gray-400 line-through' : ''}>
                  <td className="table-td"><div className="font-mono text-xs font-semibold">{p.receipt_no}</div><div className="text-[11px] text-gray-500">{dmy(p.paid_on)} · {METHODS[p.method]}{p.reference && ` · ${p.reference}`}</div></td>
                  <td className="table-td">{custName[p.customer_id] || '—'}</td>
                  <td className="table-td hidden text-xs md:table-cell">{a.map((x) => <button key={x.doc_id} type="button" className="mr-2 font-mono text-primary-700 hover:underline" onClick={() => openDoc(x.doc_id)}>{docNo[x.doc_id]} ({money(x.amount)})</button>)}
                    {Number(p.amount) - used > 0.004 && <span className="text-violet-700">credit {money(Number(p.amount) - used)}</span>}</td>
                  <td className="table-td text-right font-semibold tabular-nums">{rs(p.amount)}</td>
                  <td className="table-td whitespace-nowrap text-right text-xs">
                    {p.attachment_path && <button type="button" className="mr-2 text-primary-700" onClick={async () => { const w = window.open('', '_blank'); try { w.location.href = await vatFileUrl(p.attachment_path); } catch (e) { w?.close(); toast.error(e.message); } }} aria-label="Attachment"><Paperclip size={13} /></button>}
                    {!p.voided_at && can('payment') && <button type="button" className="text-red-600" onClick={async () => { const r = window.prompt('Reason for voiding this payment (it stays on record):'); if (!r) return; try { await voidPayment(p.id, r); toast.success('Voided'); load(); reload(['docs']); } catch (e) { toast.error(e.message); } }}>void</button>}
                    {p.voided_at && <span className="no-underline">void</span>}
                  </td>
                </tr>); })}
            </tbody>
          </table>
        </div>
      )}
      {open && <PaymentForm app={app} onClose={() => setOpen(false)} onDone={() => { setOpen(false); load(); reload(['docs']); }} />}
    </div>
  );
}
