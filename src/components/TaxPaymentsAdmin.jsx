// V57/V58 — Admin: a client's Monthly APIT & quarterly IIT instalments for one Y/A
// (mark paid, check client receipts, remind the client, remove, open calculators)
import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import toast from 'react-hot-toast';
import { Wallet, CalendarClock, Check, X, Trash2, Loader2, Undo2, Paperclip, BellRing, ThumbsDown } from 'lucide-react';
import MessageMenu from './MessageMenu';
import { VoucherEditor, VoucherInfo } from './TaxVoucher';
import { NoticeButton } from './TaxNotice';
import { ensureNoticeToken, noticeUrl } from '../lib/taxNotice';
import { recipientsOf, greetName } from '../lib/contacts';
import { fmtRs, fmtDate } from '../lib/supabase';
import { yaOf, yaList, yaMonths, instalmentDue, loadPayments, updatePayment, deletePayment, QUARTER_MONTHS, periodLabel, isOverdue, receiptUrl, checkPayment, remindPayments, reminderText, paymentShareText } from '../lib/taxPayments';

const today = () => new Date().toISOString().slice(0, 10);

function PayRow({ label, sub, row, due, onChange, client }) {
  const [form, setForm] = useState(null);
  const [busy, setBusy] = useState(false);
  const run = async (fn, ok) => { setBusy(true); try { await fn(); if (ok) toast.success(ok); setForm(null); onChange(); } catch (e) { toast.error(e.message); } setBusy(false); };
  if (!row) return (
    <tr className="text-gray-400"><td className="py-1.5 pr-2">{label}<span className="block text-[10px]">{sub}</span></td><td className="text-right pr-2">—</td><td className="pr-2 text-xs">{fmtDate(due)}</td><td colSpan={2} className="text-xs">not worked out</td></tr>
  );
  const overdue = row.status !== 'paid' && row.due_date && row.due_date < today();
  const byClient = row.status === 'paid' && row.paid_by_role === 'client';
  const openReceipt = async () => {
    const w = window.open('', '_blank');
    try { const u = await receiptUrl(row.receipt_path); if (w) w.location.href = u; else window.open(u, '_blank'); } catch (e) { w?.close(); toast.error(e.message); }
  };
  const reject = () => {
    const note = window.prompt(`Why is the receipt for ${label} not accepted? (the client will see this)`, 'Please upload the correct receipt.');
    if (note !== null) run(() => checkPayment(row.id, false, note.trim()), 'Sent back to the client as not paid');
  };
  return (
    <>
      <tr className="border-t border-gray-50">
        <td className="py-1.5 pr-2 text-gray-800">{label}<span className="block text-[10px] text-gray-400">{sub}</span></td>
        <td className="text-right pr-2 tabular-nums font-semibold">{fmtRs(row.amount)}</td>
        <td className={`pr-2 text-xs ${overdue ? 'text-red-600 font-semibold' : 'text-gray-500'}`}>{fmtDate(row.due_date)}</td>
        <td className="pr-2 text-xs">
          {row.status === 'paid'
            ? <span className="text-green-700">✓ Paid {fmtRs(row.paid_amount ?? row.amount)}{row.paid_on ? ` · ${fmtDate(row.paid_on)}` : ''}{row.reference ? ` · ${row.reference}` : ''}
                {byClient && <span className={`ml-1 text-[10px] font-semibold rounded px-1 ${row.checked_at ? 'bg-green-100 text-green-800' : 'bg-amber-100 text-amber-800'}`}>{row.checked_at ? 'by client · checked' : 'by client — check receipt'}</span>}</span>
            : <span className={overdue ? 'text-red-600' : 'text-amber-700'}>{overdue ? 'Overdue' : 'Not paid'}
                {row.reminded_at && <span className="block text-[10px] text-gray-400">reminded {fmtDate(row.reminded_at)}{row.reminder_count > 1 ? ` (${row.reminder_count}×)` : ''}</span>}
                {row.note && <span className="block text-[10px] text-red-600">receipt not accepted: {row.note}</span>}</span>}
          <div className="mt-0.5">{row.status === 'due' ? <VoucherEditor row={row} onSaved={onChange} compact /> : <VoucherInfo row={row} />}</div>
        </td>
        <td className="text-right whitespace-nowrap">
          {row.status === 'due' && client && Number(row.amount) > 0 && (
            <MessageMenu label="Share" className="mr-1 align-middle" phone={client.mobile} email={client.email} recipients={recipientsOf(client)}
              subject={`${label} — tax payment`} getText={async () => paymentShareText(greetName(client), row, noticeUrl(await ensureNoticeToken(row)))} />
          )}
          {client && Number(row.amount) > 0 && <NoticeButton row={row} client={client} className="mr-1 align-middle" label="" />}
          {row.receipt_path && <button title="View receipt" onClick={openReceipt} className="text-gray-400 hover:text-primary-700 p-1"><Paperclip size={13} /></button>}
          {busy ? <Loader2 size={14} className="animate-spin inline text-gray-400" /> : byClient && !row.checked_at
            ? <>
                <button title="Receipt checked" onClick={() => run(() => checkPayment(row.id, true), 'Receipt checked ✓')} className="text-xs font-semibold text-green-700 hover:underline px-1">✓ Checked</button>
                <button title="Not accepted — back to not paid" onClick={reject} className="text-gray-400 hover:text-red-600 p-1"><ThumbsDown size={13} /></button>
              </>
            : row.status === 'paid'
            ? <button title="Mark as not paid" onClick={() => run(() => updatePayment(row.id, { status: 'due', paid_amount: null, paid_on: null, reference: null, paid_by_role: null, checked_at: null, checked_by: null }), 'Marked as not paid')} className="text-gray-400 hover:text-amber-600 p-1"><Undo2 size={14} /></button>
            : <button onClick={() => setForm({ amount: String(Math.round(row.amount)), on: today(), ref: '' })} className="text-xs font-semibold text-primary-700 hover:underline px-1">Mark paid</button>}
          <button title="Remove" onClick={() => { if (window.confirm(`Remove ${label}?`)) run(() => deletePayment(row.id), 'Removed'); }} className="text-gray-300 hover:text-red-600 p-1"><Trash2 size={13} /></button>
        </td>
      </tr>
      {form && (
        <tr><td colSpan={5} className="pb-2">
          <div className="flex flex-wrap items-end gap-2 bg-green-50 rounded-lg p-2">
            <label className="text-[11px] text-gray-600">Amount paid<input className="input py-1 w-32 text-right mt-0.5" inputMode="numeric" value={form.amount} onChange={e => setForm(f => ({ ...f, amount: e.target.value.replace(/[^\d.]/g, '') }))} /></label>
            <label className="text-[11px] text-gray-600">Paid on<input type="date" className="input py-1 mt-0.5" value={form.on} onChange={e => setForm(f => ({ ...f, on: e.target.value }))} /></label>
            <label className="text-[11px] text-gray-600 flex-1 min-w-[120px]">Reference<input className="input py-1 mt-0.5" maxLength={100} value={form.ref} onChange={e => setForm(f => ({ ...f, ref: e.target.value }))} /></label>
            <button onClick={() => run(() => updatePayment(row.id, { status: 'paid', paid_amount: Number(form.amount) || 0, paid_on: form.on || null, reference: form.ref.trim() || null, paid_by_role: 'admin', checked_at: new Date().toISOString(), note: null }), 'Recorded as paid')} className="btn-primary text-xs py-1.5"><Check size={13} /> Save</button>
            <button onClick={() => setForm(null)} className="text-gray-400 hover:text-gray-600 p-1"><X size={15} /></button>
          </div>
        </td></tr>
      )}
    </>
  );
}

export default function TaxPaymentsAdmin({ client }) {
  const navigate = useNavigate();
  const [ya, setYa] = useState(yaOf());
  const [rows, setRows] = useState(null);
  const [years, setYears] = useState([]);
  const [all, setAll] = useState([]);
  const [remind, setRemind] = useState(null);   // Set of row ids picked for a reminder
  const load = async () => {
    try {
      const all = await loadPayments(client.id);
      setAll(all);
      setYears([...new Set(all.map(r => r.year))]);
      setRows(all.filter(r => r.year === ya));
    } catch (e) { toast.error(e.message); setRows([]); }
  };
  useEffect(() => { load(); }, [client.id, ya]); // eslint-disable-line react-hooks/exhaustive-deps
  if (rows === null) return null;

  const apit = Object.fromEntries(rows.filter(r => r.kind === 'apit').map(r => [r.period, r]));
  const inst = Object.fromEntries(rows.filter(r => r.kind === 'instalment').map(r => [r.period, r]));
  const sum = (list, paidOnly) => list.filter(r => !paidOnly || r.status === 'paid').reduce((a, r) => a + Number(paidOnly ? (r.paid_amount ?? r.amount) : r.amount), 0);
  const apitRows = Object.values(apit), instRows = Object.values(inst);
  const open = (tab) => navigate('/admin/calculator', { state: { tab, clientId: client.id, ya } });
  const due = all.filter(r => r.status === 'due' && Number(r.amount) > 0).sort((a, b) => String(a.due_date).localeCompare(String(b.due_date)));
  const soon = new Date(Date.now() + 45 * 86400000).toISOString().slice(0, 10);
  const startRemind = () => {
    const pick = due.filter(r => isOverdue(r) || (r.due_date && r.due_date <= soon));
    setRemind(new Set((pick.length ? pick : due).map(r => r.id)));
  };
  const picked = remind ? due.filter(r => remind.has(r.id)) : [];
  const toCheck = all.filter(r => r.status === 'paid' && r.paid_by_role === 'client' && !r.checked_at);
  const sendInApp = async () => {
    try { const n = await remindPayments(client.id, picked.map(r => r.id)); toast.success(`Reminder sent in the portal (${n})`); setRemind(null); load(); } catch (e) { toast.error(e.message); }
  };
  const reminderMsg = async () => {
    const links = {};
    for (const r of picked) { try { links[r.id] = noticeUrl(await ensureNoticeToken(r)); } catch { /* message still goes */ } }
    const text = reminderText(greetName(client), picked, links);
    try { await remindPayments(client.id, picked.map(r => r.id)); } catch { /* the message still goes */ }
    setTimeout(() => { setRemind(null); load(); }, 400);
    return text;
  };

  return (
    <div className="card">
      <div className="card-header flex-wrap gap-2"><Wallet size={16} /> Tax payments — APIT &amp; instalments
        <select className="ml-auto input w-auto py-1 text-sm" value={ya} onChange={e => setYa(e.target.value)} aria-label="Year of assessment">
          {yaList(years).map(y => <option key={y} value={y}>Y/A {y}</option>)}
        </select>
      </div>
      <div className="p-4 space-y-4">
        {toCheck.length > 0 && (
          <div className="rounded-xl bg-amber-50 border border-amber-200 px-3 py-2 text-xs text-amber-900">
            🔎 The client marked {toCheck.length} payment{toCheck.length > 1 ? 's' : ''} as paid with a receipt: {toCheck.map(r => `${periodLabel(r)} (Y/A ${r.year})`).join(', ')}. Open the 📎 receipt, then press <b>✓ Checked</b> or 👎 if it is not right.
          </div>
        )}
        {due.length > 0 && (
          <div className="rounded-xl border border-primary-100 bg-white">
            <div className="flex items-center gap-2 px-3 py-2 flex-wrap">
              <BellRing size={15} className="text-primary-600" />
              <span className="text-sm text-gray-700"><b>{due.length}</b> payment{due.length > 1 ? 's' : ''} not paid yet{due.some(r => isOverdue(r)) ? <> · <b className="text-red-600">{due.filter(r => isOverdue(r)).length} overdue</b></> : ''}</span>
              {!remind && <button onClick={startRemind} className="ml-auto btn-secondary text-xs py-1">Remind client</button>}
              {remind && <button onClick={() => setRemind(null)} className="ml-auto text-gray-400 hover:text-gray-600 p-1" aria-label="Close"><X size={15} /></button>}
            </div>
            {remind && (
              <div className="border-t border-gray-100 px-3 py-2 space-y-2">
                <div className="space-y-1">
                  {due.map(r => (
                    <label key={r.id} className="flex items-center gap-2 text-sm">
                      <input type="checkbox" checked={remind.has(r.id)} onChange={() => setRemind(s => { const n = new Set(s); if (n.has(r.id)) n.delete(r.id); else n.add(r.id); return n; })} />
                      <span className="flex-1">{periodLabel(r)} <span className="text-gray-400 text-xs">· Y/A {r.year}</span></span>
                      <span className="tabular-nums font-semibold">{fmtRs(r.amount)}</span>
                      <span className={`text-xs w-40 text-right ${isOverdue(r) ? 'text-red-600 font-semibold' : 'text-gray-500'}`}>{isOverdue(r) ? 'overdue ' : 'due '}{fmtDate(r.due_date)}</span>
                    </label>
                  ))}
                </div>
                <div className="flex items-center gap-2 flex-wrap">
                  {picked.length > 0 ? <>
                    <MessageMenu label={`Send reminder (${picked.length})`} phone={client.mobile} email={client.email} recipients={recipientsOf(client)} subject="Tax payment reminder — TaxMate" getText={reminderMsg} />
                    <button onClick={sendInApp} className="btn-secondary text-xs py-1.5">Portal notice only</button>
                  </> : <span className="text-xs text-gray-400">Tick at least one payment</span>}
                  <span className="text-[11px] text-gray-500 flex-1 min-w-[200px]">The message lists the amounts, due dates and IRD codes (Tax Type · Period · Category S). The client also gets a notice in the portal.</span>
                </div>
              </div>
            )}
          </div>
        )}
        <div className="grid sm:grid-cols-2 gap-2 text-sm">
          <div className="rounded-xl bg-primary-50 p-3"><div className="text-xs text-gray-500">APIT paid / deducted (→ cage 903)</div><div className="text-lg font-black text-primary-800">{fmtRs(sum(apitRows, true))}</div><div className="text-[11px] text-gray-500">{apitRows.filter(r => r.status === 'paid').length} of {apitRows.length} month(s) · worked out {fmtRs(sum(apitRows))}</div></div>
          <div className="rounded-xl bg-primary-50 p-3"><div className="text-xs text-gray-500">Instalments paid (→ cage 911)</div><div className="text-lg font-black text-primary-800">{fmtRs(sum(instRows, true))}</div><div className="text-[11px] text-gray-500">{instRows.filter(r => r.status === 'paid').length} of {instRows.length} quarter(s) · worked out {fmtRs(sum(instRows))}</div></div>
        </div>

        <div>
          <div className="flex items-center gap-2 mb-1"><CalendarClock size={15} className="text-primary-600" /><span className="font-semibold text-sm text-gray-800">Quarterly instalments</span>
            <button onClick={() => open('quarterly')} className="ml-auto text-xs font-semibold text-primary-700 hover:underline">+ Calculate &amp; allocate</button></div>
          <table className="w-full text-sm"><tbody>
            {['Q1', 'Q2', 'Q3', 'Q4'].map(q => <PayRow key={q} label={q} sub={QUARTER_MONTHS[q]} row={inst[q]} due={instalmentDue(ya, q)} onChange={load} client={client} />)}
          </tbody></table>
        </div>

        <div>
          <div className="flex items-center gap-2 mb-1"><Wallet size={15} className="text-primary-600" /><span className="font-semibold text-sm text-gray-800">Monthly APIT</span>
            <button onClick={() => open('apit')} className="ml-auto text-xs font-semibold text-primary-700 hover:underline">+ Calculate &amp; allocate</button></div>
          {apitRows.length === 0 ? <p className="text-xs text-gray-400">No APIT worked out for Y/A {ya}.</p> : (
            <table className="w-full text-sm"><tbody>
              {yaMonths(ya).filter(m => apit[m.period]).map(m => <PayRow key={m.period} label={m.label} sub="" row={apit[m.period]} due={m.due} onChange={load} client={client} />)}
            </tbody></table>
          )}
        </div>
        <p className="text-[11px] text-gray-500">Only payments marked <b>paid</b> are counted (also those the client marked with a receipt — check them). When you prepare this client's IIT Return for Y/A {ya} in the calculator, they fill <b>Tax already paid</b> automatically. The client sees this schedule on their Tax Returns page.</p>
      </div>
    </div>
  );
}
