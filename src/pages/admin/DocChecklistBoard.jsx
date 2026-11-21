// V68 — Season board: every client's document checklist for one Y/A (who still owes what, remind in one click)
import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import toast from 'react-hot-toast';
import { ListChecks, Search, Loader2, Bell, CheckCircle2, AlertTriangle, ExternalLink, X } from 'lucide-react';
import { docYears, defaultDocYear } from '../../lib/documents';
import { loadSeason, progressOf, remind, reminderText } from '../../lib/docChecklist';
import { recipientsOf } from '../../lib/contacts';
import MessageMenu from '../../components/MessageMenu';

const dmy = (d) => (d ? new Date(d).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' }) : '');
const daysAgo = (d) => (d ? Math.floor((Date.now() - new Date(d).getTime()) / 86400000) : null);

export default function DocChecklistBoard() {
  const years = useMemo(() => docYears(), []);
  const [year, setYear] = useState(defaultDocYear());
  const [rows, setRows] = useState(null);
  const [err, setErr] = useState(null);
  const [filter, setFilter] = useState('missing');
  const [q, setQ] = useState('');
  const [busy, setBusy] = useState(false);
  const load = () => { setErr(null); loadSeason(year).then(setRows).catch((e) => setErr(/doc_checklists|schema cache/.test(e.message) ? 'The document checklist database is not set up yet — run the V68 script in Supabase.' : e.message)); };
  useEffect(() => { setRows(null); load(); }, [year]); // eslint-disable-line react-hooks/exhaustive-deps

  const all = (rows || []).map((l) => ({ ...l, p: progressOf(l.items) }));
  const today = new Date().toISOString().slice(0, 10);
  const stats = {
    total: all.length,
    complete: all.filter((l) => !l.p.missing.length).length,
    missing: all.filter((l) => l.p.missing.length).length,
    overdue: all.filter((l) => l.p.missing.length && l.due_date && l.due_date < today).length,
    never: all.filter((l) => l.p.missing.length && !l.reminded_at).length,
    clientNa: all.filter((l) => l.items.some((i) => i.status === 'na' && i.na_by === 'client')).length,
  };
  const ql = q.trim().toLowerCase();
  const shown = all.filter((l) => (filter === 'all' || (filter === 'missing' ? l.p.missing.length : filter === 'complete' ? !l.p.missing.length : filter === 'overdue' ? l.p.missing.length && l.due_date && l.due_date < today : filter === 'never' ? l.p.missing.length && !l.reminded_at : l.items.some((i) => i.status === 'na' && i.na_by === 'client')))
    && (!ql || [l.clients?.full_name, l.clients?.client_no, ...l.items.map((i) => i.label)].some((x) => x?.toLowerCase().includes(ql))))
    .sort((a, b) => (b.p.missing.length > 0) - (a.p.missing.length > 0) || (a.reminded_at || '').localeCompare(b.reminded_at || '') || a.p.pct - b.p.pct);

  const remindAll = async () => {
    const ids = shown.filter((l) => l.p.missing.length).map((l) => l.id);
    if (!ids.length) return;
    if (!window.confirm(`Send a portal reminder (and phone notification) to ${ids.length} client${ids.length > 1 ? 's' : ''} listing their missing documents?`)) return;
    setBusy(true);
    try { const n = await remind(ids, true); toast.success(`Reminder sent to ${n} client${n === 1 ? '' : 's'}`); load(); } catch (e) { toast.error(e.message); } finally { setBusy(false); }
  };

  const CHIPS = [['missing', 'Missing documents', stats.missing, 'amber'], ['overdue', 'Past due date', stats.overdue, 'red'], ['never', 'Never reminded', stats.never, 'gray'], ['client_na', 'Client says "don\'t have"', stats.clientNa, 'blue'], ['complete', 'All received', stats.complete, 'green'], ['all', 'All', stats.total, 'gray']];
  const tone = { amber: 'bg-amber-500 border-amber-500', red: 'bg-red-600 border-red-600', gray: 'bg-gray-700 border-gray-700', blue: 'bg-blue-600 border-blue-600', green: 'bg-green-600 border-green-600' };
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-3">
        <div className="min-w-0 flex-1">
          <h1 className="flex items-center gap-2 text-2xl font-bold text-primary-800"><ListChecks size={22} className="text-gold-500" /> Documents Checklist</h1>
          <p className="text-sm text-gray-500">Who still has to send what for the return season. Create a checklist on a client's page → Documents tab.</p>
        </div>
        <select className="input w-36" value={year} onChange={(e) => setYear(e.target.value)} aria-label="Year of assessment">{years.map((y) => <option key={y} value={y}>Y/A {y}</option>)}</select>
      </div>

      {err ? <div className="card border-red-200 bg-red-50 p-4 text-sm text-red-800">{err}</div> : rows === null ? <div className="py-16 text-center"><Loader2 className="mx-auto animate-spin text-gray-400" /></div> : (
        <>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            {[['Checklists', stats.total, 'text-gray-900'], ['All received', stats.complete, 'text-green-700'], ['Still missing', stats.missing, 'text-amber-700'], ['Past due date', stats.overdue, 'text-red-700']].map(([l, v, c]) => (
              <div key={l} className="card p-3"><div className="text-[11px] font-semibold uppercase tracking-wide text-gray-500">{l}</div><div className={`text-2xl font-black ${c}`}>{v}</div></div>
            ))}
          </div>
          <div className="flex flex-wrap items-center gap-1.5">
            {CHIPS.map(([k, l, n, t]) => <button key={k} type="button" onClick={() => setFilter(k)} className={`rounded-full border px-3 py-1 text-xs font-semibold ${filter === k ? `${tone[t]} text-white` : 'border-gray-200 bg-white text-gray-700'}`}>{l} · {n}</button>)}
            <button type="button" disabled={busy || !shown.some((l) => l.p.missing.length)} onClick={remindAll} className="btn-secondary ml-auto border py-1.5 text-sm"><Bell size={14} /> Portal reminder to all shown</button>
          </div>
          <div className="relative">
            <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
            <input className="input pl-9" placeholder="Search client or document…" value={q} onChange={(e) => setQ(e.target.value)} />
            {q && <button type="button" onClick={() => setQ('')} className="absolute right-2 top-1/2 -translate-y-1/2 p-1 text-gray-400" aria-label="Clear"><X size={15} /></button>}
          </div>

          {shown.length === 0 ? (
            <div className="card p-10 text-center text-sm text-gray-500">{all.length ? 'No clients in this group.' : <>No checklists for Y/A {year} yet. Open a client → <b>Documents</b> tab → <b>Document checklist</b>.</>}</div>
          ) : (
            <div className="space-y-2">
              {shown.map((l) => {
                const c = l.clients || {};
                const late = l.p.missing.length && l.due_date && l.due_date < today;
                const ago = daysAgo(l.reminded_at);
                return (
                  <div key={l.id} className={`card p-3 sm:p-4 ${late ? 'border-red-200' : ''}`}>
                    <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
                      <Link to={`/admin/clients/${l.client_id}?tab=documents`} className="font-bold text-gray-900 hover:text-primary-700 hover:underline">{c.full_name}</Link>
                      {c.client_no && <span className="font-mono text-xs text-gray-500">{c.client_no}</span>}
                      {!c.profile_id && <span className="rounded bg-gray-100 px-1.5 text-[10px] font-semibold text-gray-500" title="No portal login — reminders go by WhatsApp">no portal</span>}
                      <div className="ml-auto flex items-center gap-2">
                        <div className="h-2 w-28 overflow-hidden rounded bg-gray-100"><div className={`h-2 ${l.p.missing.length ? 'bg-amber-500' : 'bg-green-500'}`} style={{ width: `${l.p.pct}%` }} /></div>
                        <span className="text-xs font-semibold text-gray-700">{l.p.done}/{l.p.total}</span>
                      </div>
                    </div>
                    {l.p.missing.length ? (
                      <div className="mt-1.5 flex flex-wrap gap-1">{l.p.missing.map((i) => <span key={i.id} className="rounded bg-amber-50 px-1.5 py-0.5 text-[11px] text-amber-900">{i.label}</span>)}</div>
                    ) : <div className="mt-1 text-xs font-semibold text-green-700"><CheckCircle2 size={13} className="-mt-0.5 inline" /> All documents received{l.completed_at ? ` · ${dmy(l.completed_at)}` : ''} — ready to start the return</div>}
                    {l.items.filter((i) => i.status === 'na' && i.na_by === 'client').map((i) => <div key={i.id} className="mt-1 text-xs text-blue-800">💬 Doesn't have “{i.label}”{i.client_note ? `: ${i.client_note}` : ''}</div>)}
                    <div className="mt-2 flex flex-wrap items-center gap-2 text-xs text-gray-500">
                      {l.due_date && <span className={late ? 'font-semibold text-red-700' : ''}>{late && <AlertTriangle size={12} className="-mt-0.5 mr-0.5 inline" />}Due {dmy(l.due_date)}</span>}
                      <span>{l.reminded_at ? `Reminded ${ago === 0 ? 'today' : `${ago} day${ago > 1 ? 's' : ''} ago`} (${l.reminder_count}×)` : 'Not reminded yet'}</span>
                      <div className="ml-auto flex items-center gap-1.5">
                        {l.p.missing.length > 0 && <MessageMenu label="Remind" phone={c.mobile} email={c.email} recipients={recipientsOf(c)} subject={`Documents needed — Y/A ${l.year} — TaxMate`}
                          getText={async () => { remind([l.id], false).then(load).catch(() => {}); return reminderText(c, l); }} />}
                        <Link to={`/admin/clients/${l.client_id}?tab=documents`} className="btn-secondary border py-1 text-xs"><ExternalLink size={12} /> Open</Link>
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </>
      )}
    </div>
  );
}
