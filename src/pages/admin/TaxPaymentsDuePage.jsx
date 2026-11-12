// V62 — Admin: every client's unpaid APIT / instalments in one place — voucher numbers, WhatsApp share, reminders
import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import toast from 'react-hot-toast';
import { Landmark, Search, BellRing, Loader2, RefreshCw, AlertTriangle, CalendarClock, Receipt, Paperclip, ThumbsDown } from 'lucide-react';
import MessageMenu from '../../components/MessageMenu';
import { VoucherEditor } from '../../components/TaxVoucher';
import { NoticeButton } from '../../components/TaxNotice';
import { ensureNoticeToken, noticeUrl } from '../../lib/taxNotice';
import { recipientsOf, greetName } from '../../lib/contacts';
import { fmtRs, fmtDate } from '../../lib/supabase';
import { loadDuePayments, periodLabel, irdCodesOf, isOverdue, reminderText, paymentShareText, remindPayments, receiptUrl, checkPayment } from '../../lib/taxPayments';

const TABS = [['overdue', '⚠️ Overdue'], ['soon', '📅 Due in 30 days'], ['due', 'All unpaid'], ['novoucher', '🧾 No voucher yet'], ['check', '🔎 Receipts to check']];

function Kpi({ icon: Icon, label, value, sub, tone, onClick }) {
  return (
    <button type="button" onClick={onClick} className="card p-4 flex items-center gap-3 text-left hover:shadow-md transition-shadow">
      <div className={`w-11 h-11 rounded-xl flex items-center justify-center flex-shrink-0 text-white ${tone}`}><Icon size={20} /></div>
      <div className="min-w-0"><div className="text-xl font-black text-gray-900 tabular-nums leading-none">{value}</div>
        <div className="text-xs text-gray-500 mt-1">{label}</div>{sub && <div className="text-[11px] text-gray-400 truncate">{sub}</div>}</div>
    </button>
  );
}

export default function TaxPaymentsDuePage() {
  const [rows, setRows] = useState(null);
  const [tab, setTab] = useState('overdue');
  const [q, setQ] = useState('');
  const [kind, setKind] = useState('');
  const [busy, setBusy] = useState(false);
  const load = () => loadDuePayments().then(setRows).catch(e => { toast.error(e.message); setRows([]); });
  useEffect(() => { load(); }, []);

  const today = new Date().toISOString().slice(0, 10);
  const in30 = new Date(Date.now() + 30 * 864e5).toISOString().slice(0, 10);
  const due = useMemo(() => (rows ?? []).filter(r => r.status === 'due' && Number(r.amount) > 0), [rows]);
  const toCheck = useMemo(() => (rows ?? []).filter(r => r.status === 'paid'), [rows]);
  const sets = {
    overdue: due.filter(r => isOverdue(r, today)),
    soon: due.filter(r => !isOverdue(r, today) && r.due_date && r.due_date <= in30),
    due, novoucher: due.filter(r => !r.voucher_no), check: toCheck,
  };
  const sum = (l) => l.reduce((a, r) => a + Number(r.amount || 0), 0);
  const shown = sets[tab].filter(r => (!kind || r.kind === kind)
    && (!q || [r.clients?.full_name, r.clients?.client_no, r.clients?.tin, r.voucher_no, periodLabel(r)].some(f => String(f ?? '').toLowerCase().includes(q.toLowerCase()))));
  const groups = Object.values(shown.reduce((m, r) => { (m[r.client_id] ??= { client: r.clients ?? { id: r.client_id }, items: [] }).items.push(r); return m; }, {}))
    .sort((a, b) => String(a.items[0].due_date).localeCompare(String(b.items[0].due_date)));

  const remindAllOverdue = async () => {
    const byClient = Object.values(sets.overdue.reduce((m, r) => { (m[r.client_id] ??= []).push(r.id); return m; }, {}));
    if (!byClient.length) return;
    if (!window.confirm(`Send a portal notice (and phone notification) to ${byClient.length} client${byClient.length > 1 ? 's' : ''} with overdue payments?`)) return;
    setBusy(true);
    let n = 0;
    for (const ids of byClient) { try { await remindPayments(sets.overdue.find(r => r.id === ids[0]).client_id, ids); n++; } catch { /* next */ } }
    toast.success(`Portal reminder sent to ${n} client${n === 1 ? '' : 's'}`);
    setBusy(false); load();
  };

  return (
    <div className="space-y-5">
      <div className="flex items-center gap-3 flex-wrap">
        <div>
          <h1 className="text-2xl font-bold text-primary-800 flex items-center gap-2"><Landmark size={24} /> Tax Payments Due</h1>
          <p className="text-sm text-gray-500">Clients' APIT & quarterly instalments TaxMate worked out — add the IRD voucher number, share on WhatsApp, remind.</p>
        </div>
        <div className="ml-auto flex gap-2">
          <button onClick={load} className="btn-secondary text-sm"><RefreshCw size={14} /> Refresh</button>
          {sets.overdue.length > 0 && <button onClick={remindAllOverdue} disabled={busy} className="btn-secondary text-sm text-red-700">{busy ? <Loader2 size={14} className="animate-spin" /> : <BellRing size={14} />} Portal reminder to all overdue</button>}
        </div>
      </div>

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <Kpi icon={AlertTriangle} label="Overdue" value={sets.overdue.length} sub={fmtRs(sum(sets.overdue))} tone="bg-red-500" onClick={() => setTab('overdue')} />
        <Kpi icon={CalendarClock} label="Due in 30 days" value={sets.soon.length} sub={fmtRs(sum(sets.soon))} tone="bg-amber-500" onClick={() => setTab('soon')} />
        <Kpi icon={Receipt} label="No voucher yet" value={sets.novoucher.length} sub="add the IRD voucher number" tone="bg-rose-500" onClick={() => setTab('novoucher')} />
        <Kpi icon={Paperclip} label="Receipts to check" value={sets.check.length} sub="marked paid by clients" tone="bg-emerald-600" onClick={() => setTab('check')} />
      </div>

      <div className="flex items-center gap-2 flex-wrap">
        <div className="flex gap-1 bg-gray-100 p-1 rounded-xl overflow-x-auto max-w-full">
          {TABS.map(([k, l]) => (
            <button key={k} onClick={() => setTab(k)} className={`px-3 py-1.5 rounded-lg text-sm font-medium whitespace-nowrap ${tab === k ? 'bg-white text-primary-700 shadow-sm' : 'text-gray-500 hover:text-gray-700'}`}>{l} <span className="text-gray-400">{sets[k].length}</span></button>
          ))}
        </div>
        <select className="input w-auto py-1.5 text-sm" value={kind} onChange={e => setKind(e.target.value)}>
          <option value="">APIT + instalments</option><option value="instalment">Instalments only</option><option value="apit">APIT only</option>
        </select>
        <div className="relative ml-auto">
          <Search size={14} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-gray-400" />
          <input className="input pl-8 py-1.5 text-sm w-56" placeholder="Client, TIN, voucher no…" value={q} onChange={e => setQ(e.target.value)} />
        </div>
      </div>

      {rows === null ? <div className="card p-10 text-center text-gray-400"><Loader2 className="animate-spin mx-auto" /></div>
        : groups.length === 0 ? <div className="card p-10 text-center text-gray-400 text-sm">Nothing here 🎉</div> : (
        <div className="space-y-3">
          {groups.map(({ client: c, items }) => {
            const unpaid = items.filter(r => r.status === 'due');
            return (
              <div key={c.id} className="card overflow-hidden">
                <div className="px-4 py-2.5 bg-gray-50 border-b border-gray-100 flex items-center gap-2 flex-wrap">
                  <Link to={`/admin/clients/${c.id}?tab=returns`} className="font-bold text-primary-800 hover:underline">{c.full_name ?? 'Client'}</Link>
                  {c.client_no && <span className="font-mono text-[10px] font-bold px-1.5 py-0.5 rounded bg-primary-50 text-primary-700 border border-primary-100">{c.client_no}</span>}
                  <span className="text-xs text-gray-500">{c.contact_preferred && c.contact_name ? `via ${c.contact_name} · ${c.contact_mobile ?? ''}` : c.mobile ?? 'no mobile saved'}</span>
                  {unpaid.length > 0 && (
                    <div className="ml-auto flex items-center gap-2">
                      <span className="text-sm font-black text-primary-800 tabular-nums">{fmtRs(sum(unpaid))}</span>
                      <MessageMenu label={`Remind${unpaid.length > 1 ? ` (${unpaid.length})` : ''}`} phone={c.mobile} email={c.email} recipients={recipientsOf(c)} subject="Tax payment reminder — TaxMate"
                        getText={async () => { const links = {}; for (const r of unpaid) links[r.id] = noticeUrl(await ensureNoticeToken(r)); const t = reminderText(greetName(c), unpaid, links); remindPayments(c.id, unpaid.map(r => r.id)).then(() => setTimeout(load, 400)).catch(() => {}); return t; }} />
                    </div>
                  )}
                </div>
                <div className="divide-y divide-gray-50">
                  {items.map(r => <Row key={r.id} r={r} c={c} today={today} onChange={load} />)}
                </div>
              </div>
            );
          })}
        </div>
      )}
      <p className="text-[11px] text-gray-500">Each WhatsApp message lists the amount, due date, IRD codes (Tax Type · Period · Category S) and the voucher number when added. <b>Remind</b> also sends a portal notice + phone notification and stamps "reminded". Add a voucher → the client is told on their dashboard.</p>
    </div>
  );
}

function Row({ r, c, today, onChange }) {
  const codes = irdCodesOf(r);
  const late = r.status === 'due' && isOverdue(r, today);
  const [busy, setBusy] = useState(false);
  const openReceipt = async () => { const w = window.open('', '_blank'); try { const u = await receiptUrl(r.receipt_path); if (w) w.location.href = u; } catch (e) { w?.close(); toast.error(e.message); } };
  const check = async (ok) => {
    let note = '';
    if (!ok) { note = window.prompt('Why is the receipt not accepted? (the client will see this)', 'Please upload the correct receipt.'); if (note === null) return; }
    setBusy(true);
    try { await checkPayment(r.id, ok, note); toast.success(ok ? 'Receipt checked ✓' : 'Sent back to the client'); onChange(); } catch (e) { toast.error(e.message); }
    setBusy(false);
  };
  return (
    <div className="px-4 py-2.5 flex items-start gap-3 flex-wrap">
      <div className="flex-1 min-w-[220px]">
        <div className="text-sm font-semibold text-gray-800">{periodLabel(r)} <span className="text-gray-400 font-normal">· Y/A {r.year}</span></div>
        {r.status === 'paid'
          ? <div className="text-xs text-emerald-700">Client marked paid {fmtRs(r.paid_amount ?? r.amount)}{r.paid_on ? ` on ${fmtDate(r.paid_on)}` : ''}{r.reference ? ` · ref ${r.reference}` : ''}</div>
          : <div className={`text-xs ${late ? 'text-red-600 font-semibold' : 'text-amber-700'}`}>{late ? 'Overdue — was due' : 'Due'} {fmtDate(r.due_date)}
              {r.reminded_at && <span className="text-gray-400 font-normal"> · reminded {fmtDate(r.reminded_at)}{r.reminder_count > 1 ? ` (${r.reminder_count}×)` : ''}</span>}</div>}
        {codes && <div className="text-[11px] text-gray-400">Tax Type {codes.typeCode} · Period {codes.periodCode} · Category {codes.category}</div>}
        {r.note && r.status === 'due' && <div className="text-[11px] text-red-600">Receipt not accepted: {r.note}</div>}
        <div className="mt-0.5"><VoucherEditor row={r} onSaved={onChange} compact /></div>
      </div>
      <div className="text-right">
        <div className="font-black text-primary-800 tabular-nums">{fmtRs(r.amount)}</div>
        <div className="mt-1 flex items-center gap-1 justify-end">
          {r.status === 'due'
            ? <>
                <NoticeButton row={r} client={c} />
                <MessageMenu label="Share" phone={c.mobile} email={c.email} recipients={recipientsOf(c)} subject={`${periodLabel(r)} — tax payment`}
                  getText={async () => paymentShareText(greetName(c), r, noticeUrl(await ensureNoticeToken(r)))} />
              </>
            : <>
                {r.receipt_path && <button onClick={openReceipt} className="btn-secondary text-xs py-1 px-2"><Paperclip size={12} /> Receipt</button>}
                <button onClick={() => check(true)} disabled={busy} className="btn-primary text-xs py-1 px-2">✓ Checked</button>
                <button onClick={() => check(false)} disabled={busy} title="Not accepted" className="p-1 text-gray-400 hover:text-red-600"><ThumbsDown size={14} /></button>
              </>}
        </div>
      </div>
    </div>
  );
}
