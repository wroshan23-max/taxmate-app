// V64 — record a payment: against one invoice, or a customer payment shared across open invoices
import { useMemo, useState } from 'react';
import toast from 'react-hot-toast';
import { Loader2, Paperclip } from 'lucide-react';
import { recordPayment, uploadVatFile } from '../../lib/vat/api';
import { rs, money, dmy, slToday, METHODS } from '../../lib/vat/format';
import { Modal, Field } from './ui';

export default function PaymentForm({ app, doc, customerId, onClose, onDone }) {
  const { clientId, data } = app;
  const [cust, setCust] = useState(doc?.customer_id || customerId || '');
  const [f, setF] = useState({ amount: doc ? String(Math.max(0, Number(doc.balance))) : '', paid_on: slToday(), method: 'bank_transfer', reference: '', bank: '', notes: '' });
  const [alloc, setAlloc] = useState({});
  const [file, setFile] = useState(null);
  const [busy, setBusy] = useState(false);
  const open = useMemo(() => data.docs.filter((d) => d.status === 'issued' && (d.doc_type === 'tax' || d.doc_type === 'nontax') && Number(d.balance) > 0 && d.customer_id === cust)
    .sort((a, b) => (a.due_date || a.issue_date).localeCompare(b.due_date || b.issue_date)), [data.docs, cust]);
  const allocSum = Object.values(alloc).reduce((a, v) => a + (Number(v) || 0), 0);
  const amt = Number(f.amount) || 0;

  const autoFill = () => {
    let left = amt; const next = {};
    for (const d of open) { if (left <= 0) break; const take = Math.min(left, Number(d.balance)); next[d.id] = String(Math.round(take * 100) / 100); left -= take; }
    setAlloc(next);
  };
  const save = async () => {
    if (amt <= 0) return toast.error('Enter the amount received.');
    if (!doc && allocSum > amt + 0.001) return toast.error('The amounts given to invoices are more than the payment.');
    setBusy(true);
    try {
      const attachment_path = file ? await uploadVatFile(clientId, 'payments', file) : null;
      const allocs = doc ? [] : Object.entries(alloc).filter(([, v]) => Number(v) > 0).map(([doc_id, v]) => ({ doc_id, amount: Number(v) }));
      const r = await recordPayment(clientId, { ...f, amount: amt, doc_id: doc?.id || null, customer_id: cust || null, attachment_path }, allocs);
      toast.success(`Payment recorded — receipt ${r.receipt_no}${Number(r.unallocated) > 0 ? ` · ${rs(r.unallocated)} kept as customer credit` : ''}`);
      onDone?.(r);
    } catch (e) { toast.error(e.message); } finally { setBusy(false); }
  };

  return (
    <Modal title={doc ? `Record payment — ${doc.doc_no}` : 'Record a customer payment'} onClose={onClose} wide={!doc}
      footer={<><button type="button" className="btn-secondary border text-sm" onClick={onClose}>Cancel</button>
        <button type="button" disabled={busy} className="btn-primary text-sm" onClick={save}>{busy && <Loader2 size={14} className="animate-spin" />} Save payment</button></>}>
      <div className="space-y-3">
        {doc && <div className="rounded-lg bg-gray-50 p-2 text-sm">{doc.customer?.name} · total {rs(doc.total)} · paid {rs(doc.paid)} · <b>balance {rs(doc.balance)}</b></div>}
        {!doc && (
          <Field label="Customer">
            <select className="input" value={cust} onChange={(e) => { setCust(e.target.value); setAlloc({}); }}>
              <option value="">Choose…</option>{data.customers.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
            </select>
          </Field>
        )}
        <div className="grid gap-2 sm:grid-cols-3">
          <Field label="Amount received (Rs.)"><input className="input text-right" inputMode="decimal" value={f.amount} onChange={(e) => setF({ ...f, amount: e.target.value.replace(/[^\d.]/g, '') })} autoFocus /></Field>
          <Field label="Date"><input type="date" className="input" max={slToday()} value={f.paid_on} onChange={(e) => setF({ ...f, paid_on: e.target.value })} /></Field>
          <Field label="Method"><select className="input" value={f.method} onChange={(e) => setF({ ...f, method: e.target.value })}>{Object.entries(METHODS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select></Field>
          <Field label="Reference / cheque no."><input className="input" maxLength={120} value={f.reference} onChange={(e) => setF({ ...f, reference: e.target.value })} /></Field>
          <Field label="Bank"><input className="input" maxLength={80} value={f.bank} onChange={(e) => setF({ ...f, bank: e.target.value })} /></Field>
          <Field label="Attachment (slip)">
            <label className="input flex cursor-pointer items-center gap-1 truncate text-xs text-gray-600"><Paperclip size={13} />{file ? file.name : 'Photo / PDF'}<input type="file" accept="image/*,application/pdf" className="hidden" onChange={(e) => setFile(e.target.files?.[0] || null)} /></label>
          </Field>
        </div>
        <Field label="Notes"><input className="input" maxLength={500} value={f.notes} onChange={(e) => setF({ ...f, notes: e.target.value })} /></Field>
        {!doc && cust && (
          <div className="rounded-lg border p-2">
            <div className="mb-1 flex items-center text-xs font-semibold text-gray-600">Apply to open invoices
              <button type="button" className="ml-auto text-primary-700" onClick={autoFill}>Oldest first</button></div>
            {open.length === 0 ? <div className="text-xs text-gray-400">No open invoices — the payment is kept as customer credit.</div> : open.map((d) => (
              <div key={d.id} className="flex items-center gap-2 py-0.5 text-xs">
                <span className="w-40 truncate font-mono">{d.doc_no}</span><span className="flex-1 text-gray-500">{dmy(d.issue_date)} · balance {money(d.balance)}</span>
                <input className="input w-28 py-1 text-right" inputMode="decimal" value={alloc[d.id] || ''} onChange={(e) => setAlloc({ ...alloc, [d.id]: e.target.value.replace(/[^\d.]/g, '') })} aria-label={`Amount for ${d.doc_no}`} />
              </div>
            ))}
            <div className="mt-1 text-right text-xs text-gray-500">{allocSum === 0 ? 'Nothing entered — it goes to the oldest open invoices automatically.' : <>Applied {rs(allocSum)} · {amt - allocSum > 0.004 ? `${rs(amt - allocSum)} left as customer credit` : 'all applied'}</>}</div>
          </div>
        )}
      </div>
    </Modal>
  );
}
