// V71 — "Tax payable" on a FINAL computation → mark as paid (client or TaxMate), optional receipt
import { useRef, useState } from 'react';
import toast from 'react-hot-toast';
import { CheckCircle2, Loader2, Paperclip, Receipt, Undo2, X, Clock, Trash2, Pencil } from 'lucide-react';
import { fmtRs, fmtDate } from '../lib/supabase';
import { useAuth } from '../contexts/AuthContext';
import { uploadReceipt, markMyBalancePaid, addMyReceipt, undoMyBalancePaid, adminBalancePaid, checkBalancePayment, removeBalancePayment, openReceipt, todayLK } from '../lib/taxBalance';
import { supabase } from '../lib/supabase';

const RECEIPT_ACCEPT = '.pdf,.jpg,.jpeg,.png,.webp,image/*';

export default function TaxBalancePayment({ role, calc, clientId, amountDue, payment, onChange }) {
  const { user } = useAuth();
  const isAdmin = role === 'admin';
  const [form, setForm] = useState(null);          // { amount, paidOn, reference, file }
  const [busy, setBusy] = useState(false);
  const [rejecting, setRejecting] = useState(false);
  const [why, setWhy] = useState('');
  const fileRef = useRef(null), addRef = useRef(null);
  const due = Math.round(Number(amountDue) || 0);
  const year = calc.year;

  const start = (p) => setForm({ amount: p ? String(p.paid_amount) : String(due || ''), paidOn: p?.paid_on || todayLK(), reference: p?.reference || '', file: null });
  const run = async (fn, ok) => { setBusy(true); try { await fn(); if (ok) toast.success(ok); onChange?.(); return true; } catch (e) { toast.error(e.message); return false; } finally { setBusy(false); } };

  const save = () => run(async () => {
    const amt = Number(String(form.amount).replace(/,/g, ''));
    if (!(amt > 0)) throw new Error('Please enter the amount paid.');
    if (!form.paidOn) throw new Error('Please enter the payment date.');
    let docId = null;
    if (form.file) docId = await uploadReceipt({ clientId, year, file: form.file, role, userId: user?.id, amount: amt });
    if (isAdmin) await adminBalancePaid({ clientId, year, calcId: calc.id, amountDue: due, amount: amt, paidOn: form.paidOn, reference: form.reference, docId });
    else await markMyBalancePaid({ calcId: calc.id, amount: amt, paidOn: form.paidOn, reference: form.reference, docId });
    setForm(null);
  }, isAdmin ? 'Recorded as paid — the client was notified' : 'Thank you! TaxMate will check your payment.');

  const attach = (file) => file && run(async () => {
    const docId = await uploadReceipt({ clientId, year, file, role, userId: user?.id, amount: payment.paid_amount });
    if (isAdmin) {
      const { error } = await supabase.from('tax_balance_payments').update({ receipt_doc_id: docId, updated_at: new Date().toISOString() }).eq('id', payment.id);
      if (error) throw new Error(error.message);
    } else await addMyReceipt(payment.id, docId);
  }, 'Receipt attached — it is also in Documents');

  const showReceipt = () => openReceipt(payment.receipt_doc_id).catch((e) => toast.error(e.message));

  // ── Paid ──
  if (payment && !form) {
    const waiting = payment.paid_by_role === 'client' && !payment.checked_at;
    const short = due > 0 && Number(payment.paid_amount) + 1 < due;
    return (
      <div className={`rounded-lg border px-3 py-2 text-sm ${waiting ? 'border-amber-200 bg-amber-50' : 'border-green-200 bg-green-50'}`}>
        <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
          {waiting ? <Clock size={15} className="text-amber-600" /> : <CheckCircle2 size={15} className="text-green-600" />}
          <b className={waiting ? 'text-amber-900' : 'text-green-800'}>Paid {fmtRs(payment.paid_amount)}</b>
          <span className="text-gray-600">on {fmtDate(payment.paid_on)}{payment.reference ? ` · Ref ${payment.reference}` : ''}</span>
          <span className="text-xs text-gray-500">· {payment.paid_by_role === 'client' ? (isAdmin ? 'marked by the client' : 'marked by you') : 'recorded by TaxMate'}</span>
          {payment.receipt_doc_id
            ? <button type="button" onClick={showReceipt} className="inline-flex items-center gap-1 text-xs font-semibold text-primary-700 hover:underline"><Receipt size={13} /> Receipt</button>
            : <span className="text-xs text-gray-500">· no receipt</span>}
        </div>
        {waiting && <div className="mt-0.5 text-xs text-amber-800">{isAdmin ? 'The client marked this as paid — please check the receipt.' : 'Waiting for TaxMate to check · TaxMate පරීක්ෂා කරමින්'}</div>}
        {!waiting && payment.paid_by_role === 'client' && <div className="mt-0.5 text-xs text-green-700">✓ Checked by TaxMate{payment.checked_at ? ` ${fmtDate(payment.checked_at)}` : ''}</div>}
        {short && <div className="mt-0.5 text-xs font-semibold text-red-700">Balance still due: {fmtRs(due - Number(payment.paid_amount))}</div>}
        <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
          {!payment.receipt_doc_id && <>
            <input ref={addRef} type="file" accept={RECEIPT_ACCEPT} className="hidden" onChange={(e) => { attach(e.target.files?.[0]); e.target.value = ''; }} />
            <button type="button" disabled={busy} onClick={() => addRef.current?.click()} className="btn-secondary border bg-white py-1 px-2 text-xs"><Paperclip size={12} /> Attach receipt</button>
          </>}
          {isAdmin && waiting && !rejecting && <>
            <button type="button" disabled={busy} onClick={() => run(() => checkBalancePayment(payment.id, true), 'Checked ✓ — the client was told')} className="rounded-lg bg-green-600 px-2 py-1 text-xs font-semibold text-white hover:bg-green-700"><CheckCircle2 size={12} className="mr-1 inline" />Checked</button>
            <button type="button" disabled={busy} onClick={() => setRejecting(true)} className="rounded-lg bg-white px-2 py-1 text-xs text-red-700 border border-red-200 hover:bg-red-50">Not accepted</button>
          </>}
          {!isAdmin && waiting && <>
            <button type="button" disabled={busy} onClick={() => start(payment)} className="btn-secondary border bg-white py-1 px-2 text-xs"><Pencil size={12} /> Change</button>
            <button type="button" disabled={busy} onClick={() => window.confirm('Undo “I\'ve paid”? (The receipt stays in your Documents.)') && run(() => undoMyBalancePaid(payment.id), 'Undone')} className="text-xs text-gray-500 underline"><Undo2 size={11} className="mr-0.5 inline" />Undo</button>
          </>}
          {isAdmin && !waiting && <button type="button" disabled={busy} onClick={() => start(payment)} className="btn-secondary border bg-white py-1 px-2 text-xs"><Pencil size={12} /> Edit</button>}
          {isAdmin && <button type="button" disabled={busy} onClick={() => window.confirm('Remove this payment record? (The receipt stays in Documents.)') && run(() => removeBalancePayment(payment.id), 'Payment record removed')} className="ml-auto rounded p-1 text-gray-400 hover:bg-red-50 hover:text-red-600" title="Remove payment record" aria-label="Remove payment record"><Trash2 size={13} /></button>}
          {busy && <Loader2 size={14} className="animate-spin text-gray-400" />}
        </div>
        {rejecting && (
          <div className="mt-2 flex flex-wrap gap-1.5">
            <input className="input flex-1 min-w-[180px] bg-white py-1 text-xs" maxLength={300} placeholder="Why? (the client will see this)" value={why} onChange={(e) => setWhy(e.target.value)} />
            <button type="button" disabled={busy} onClick={async () => { if (await run(() => checkBalancePayment(payment.id, false, why), 'Not accepted — the client was told')) { setRejecting(false); setWhy(''); } }} className="rounded-lg bg-red-600 px-2 py-1 text-xs font-semibold text-white">Send</button>
            <button type="button" onClick={() => setRejecting(false)} className="text-xs text-gray-500">Cancel</button>
          </div>
        )}
      </div>
    );
  }

  // ── Form ──
  if (form) {
    return (
      <div className="space-y-2 rounded-lg border border-primary-200 bg-white p-3 text-sm">
        <div className="flex items-center gap-2 font-semibold text-primary-800"><CheckCircle2 size={15} /> {isAdmin ? 'Record the tax payment' : 'I\'ve paid my tax · මම බද්ද ගෙව්වා'} <span className="font-normal text-gray-500">· Y/A {year}</span>
          <button type="button" onClick={() => setForm(null)} className="ml-auto text-gray-400 hover:text-gray-600" aria-label="Close"><X size={16} /></button></div>
        <div className="grid gap-2 sm:grid-cols-3">
          <label className="block text-xs font-semibold text-gray-600">Amount paid (Rs.) *
            <input className="input mt-1 tabular-nums" inputMode="decimal" value={form.amount} onChange={(e) => setForm({ ...form, amount: e.target.value.replace(/[^\d.,]/g, '') })} />
          </label>
          <label className="block text-xs font-semibold text-gray-600">Date paid *
            <input type="date" className="input mt-1" max={todayLK()} value={form.paidOn} onChange={(e) => setForm({ ...form, paidOn: e.target.value })} />
          </label>
          <label className="block text-xs font-semibold text-gray-600">Reference (optional)
            <input className="input mt-1" maxLength={100} placeholder="OTPP / bank ref." value={form.reference} onChange={(e) => setForm({ ...form, reference: e.target.value })} />
          </label>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <input ref={fileRef} type="file" accept={RECEIPT_ACCEPT} className="hidden" onChange={(e) => { setForm({ ...form, file: e.target.files?.[0] || null }); e.target.value = ''; }} />
          <button type="button" onClick={() => fileRef.current?.click()} className="btn-secondary border py-1.5 text-xs"><Paperclip size={13} /> {form.file ? 'Change receipt' : 'Attach receipt (optional)'}</button>
          {form.file ? <span className="flex min-w-0 items-center gap-1 text-xs text-gray-600"><span className="max-w-[200px] truncate">{form.file.name}</span><button type="button" onClick={() => setForm({ ...form, file: null })} className="text-gray-400 hover:text-red-600" aria-label="Remove file"><X size={13} /></button></span>
            : <span className="text-[11px] text-gray-400">Photo or PDF · saved in Documents too{isAdmin ? '' : ' · රිසිට්පත'}</span>}
        </div>
        <div className="flex items-center gap-2">
          <button type="button" disabled={busy} onClick={save} className="btn-primary text-sm">{busy ? <Loader2 size={15} className="animate-spin" /> : <CheckCircle2 size={15} />} {isAdmin ? 'Save as paid' : 'Send to TaxMate'}</button>
          <button type="button" onClick={() => setForm(null)} className="btn-secondary border text-sm">Cancel</button>
        </div>
      </div>
    );
  }

  // ── Not paid yet ──
  if (isAdmin) {
    return (
      <button type="button" onClick={() => start(null)} className="inline-flex items-center gap-1 rounded-lg border border-green-300 bg-white px-2.5 py-1 text-xs font-semibold text-green-700 hover:bg-green-50">
        <CheckCircle2 size={13} /> Mark tax paid
      </button>
    );
  }
  return (
    <div className="flex flex-wrap items-center gap-2 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm">
      <span className="flex-1 min-w-[180px] text-red-800"><b>Tax payable {fmtRs(due)}</b> · Y/A {year}<span className="block text-xs text-red-700">After paying, tap “I've paid” and attach the receipt · ගෙවීමෙන් පසු “I've paid” ඔබන්න</span></span>
      <button type="button" onClick={() => start(null)} className="btn-primary bg-green-600 text-sm hover:bg-green-700"><CheckCircle2 size={15} /> I've paid</button>
    </div>
  );
}

