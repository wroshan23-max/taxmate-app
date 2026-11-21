// V70 — Work Board: every client job (IIT, VAT, bookkeeping…) as a card moving To do → Done
import { useEffect, useMemo, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import toast from 'react-hot-toast';
import { KanbanSquare, Plus, Search, Loader2, ChevronLeft, ChevronRight, Flag, AlertTriangle, RefreshCw } from 'lucide-react';
import { supabase } from '../../lib/supabase';
import { STAGES, KINDS, kindOf, loadWork, loadTeam, moveWork, dueState, dueLabel, DUE_STYLE, initials, nextStage } from '../../lib/work';
import WorkItemModal from '../../components/WorkItemModal';

const PRI = (w) => (w.priority === 'high' ? 0 : 1);
const DUE_RANK = { overdue: 0, today: 1, soon: 2, later: 3 };
const sortCards = (a, b) => (DUE_RANK[dueState(a)] ?? 4) - (DUE_RANK[dueState(b)] ?? 4) || PRI(a) - PRI(b) || (a.due_date || '9').localeCompare(b.due_date || '9') || b.created_at.localeCompare(a.created_at);

export default function WorkBoard() {
  const [params, setParams] = useSearchParams();
  const [rows, setRows] = useState(null);
  const [team, setTeam] = useState([]);
  const [clients, setClients] = useState([]);
  const [err, setErr] = useState(null);
  const [who, setWho] = useState(params.get('who') || 'all');      // all | me | none | <user id>
  const [kind, setKind] = useState('');
  const [q, setQ] = useState('');
  const [showDone, setShowDone] = useState(false);
  const [mobileStage, setMobileStage] = useState('todo');
  const [edit, setEdit] = useState(null);
  const [dragId, setDragId] = useState(null);
  const [overStage, setOverStage] = useState(null);

  const load = () => {
    setErr(null);
    Promise.all([loadWork(), loadTeam()]).then(([w, t]) => { setRows(w); setTeam(t); }).catch((e) => setErr(e.message));
  };
  useEffect(() => {
    load();
    supabase.from('clients').select('id, client_no, full_name, tin, nic, mobile').is('archived_at', null).order('full_name').then(({ data }) => setClients(data ?? []));
  }, []);
  useEffect(() => { const id = params.get('task'); if (id && rows) { const w = rows.find((x) => x.id === id); if (w) setEdit(w); } }, [rows]); // eslint-disable-line react-hooks/exhaustive-deps

  const me = team.find((t) => t.me)?.id;
  const nameOf = (id) => team.find((t) => t.id === id)?.full_name || 'Team member';
  const ql = q.trim().toLowerCase();
  const shown = useMemo(() => (rows || []).filter((w) =>
    (who === 'all' || (who === 'me' ? w.assignee === me : who === 'none' ? !w.assignee : w.assignee === who))
    && (!kind || w.kind === kind)
    && (!ql || [w.title, w.period, w.notes, w.clients?.full_name, w.clients?.client_no, w.clients?.mobile].some((x) => x?.toLowerCase().includes(ql)))), [rows, who, kind, ql, me]);
  const byStage = useMemo(() => Object.fromEntries(STAGES.map((s) => [s.key, shown.filter((w) => w.stage === s.key).sort(sortCards)])), [shown]);
  const open = (rows || []).filter((w) => w.stage !== 'done');
  const stats = {
    open: open.length,
    overdue: open.filter((w) => dueState(w) === 'overdue').length,
    today: open.filter((w) => dueState(w) === 'today').length,
    mine: open.filter((w) => w.assignee && w.assignee === me).length,
    none: open.filter((w) => !w.assignee).length,
  };
  const stages = STAGES.filter((s) => showDone || s.key !== 'done');

  const upsert = (w) => setRows((r) => { const i = r.findIndex((x) => x.id === w.id); return i < 0 ? [w, ...r] : r.map((x) => (x.id === w.id ? w : x)); });
  const move = async (w, stage) => {
    if (!stage || stage === w.stage) return;
    const before = w;
    upsert({ ...w, stage });
    try { upsert(await moveWork(w.id, stage)); if (stage === 'done') toast.success('Done ✓'); }
    catch (e) { upsert(before); toast.error(e.message); }
  };
  const closeEdit = () => { setEdit(null); if (params.get('task')) { params.delete('task'); setParams(params, { replace: true }); } };
  const pickWho = (v) => { setWho(v); if (v === 'all') params.delete('who'); else params.set('who', v); setParams(params, { replace: true }); };

  // plain render functions (not components) so cards are not re-mounted mid-drag
  const card = (w) => {
    const ds = dueState(w);
    return (
      <div key={w.id} draggable onDragStart={(e) => { setDragId(w.id); e.dataTransfer.effectAllowed = 'move'; }} onDragEnd={() => { setDragId(null); setOverStage(null); }}
        className={`group rounded-lg border bg-white p-2.5 shadow-sm transition hover:border-primary-300 ${dragId === w.id ? 'opacity-40' : ''} ${w.priority === 'high' && w.stage !== 'done' ? 'border-l-4 border-l-red-400' : ''}`}>
        <button type="button" onClick={() => setEdit(w)} className="block w-full text-left">
          <div className="flex items-start gap-1.5">
            <span className="text-sm leading-5">{kindOf(w.kind).emoji}</span>
            <span className={`min-w-0 flex-1 text-sm font-semibold leading-5 ${w.stage === 'done' ? 'text-gray-500 line-through' : 'text-gray-900'}`}>{w.title}</span>
            {w.priority === 'high' && w.stage !== 'done' && <Flag size={13} className="mt-1 shrink-0 text-red-500" />}
          </div>
          {w.clients && <div className="mt-0.5 truncate text-xs text-primary-700">{w.clients.full_name}{w.clients.client_no ? ` · ${w.clients.client_no}` : ''}</div>}
          {w.notes && <div className="mt-1 line-clamp-2 text-[11px] text-gray-500">{w.notes}</div>}
        </button>
        <div className="mt-2 flex items-center gap-1.5">
          {ds && <span className={`whitespace-nowrap rounded px-1.5 py-0.5 text-[10px] font-semibold ${DUE_STYLE[ds]}`}>{dueLabel(w)}</span>}
          <div className="flex-1" />
          <button type="button" disabled={w.stage === 'todo'} onClick={() => move(w, nextStage(w.stage, -1))} className="rounded p-1 text-gray-400 hover:bg-gray-100 hover:text-gray-700 disabled:opacity-20" title="Move back" aria-label="Move back"><ChevronLeft size={15} /></button>
          <span title={w.assignee ? nameOf(w.assignee) : 'Unassigned'} className={`flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-[10px] font-bold ${w.assignee ? (w.assignee === me ? 'bg-primary-600 text-white' : 'bg-primary-100 text-primary-700') : 'border border-dashed border-gray-300 text-gray-300'}`}>{w.assignee ? initials(nameOf(w.assignee)) : '?'}</span>
          <button type="button" disabled={w.stage === 'done'} onClick={() => move(w, nextStage(w.stage, 1))} className="rounded p-1 text-gray-400 hover:bg-gray-100 hover:text-gray-700 disabled:opacity-20" title="Move forward" aria-label="Move forward"><ChevronRight size={15} /></button>
        </div>
      </div>
    );
  };

  const column = (s, mobile = false) => (
    <div key={s.key} onDragOver={(e) => { if (dragId) { e.preventDefault(); setOverStage(s.key); } }} onDragLeave={() => setOverStage((o) => (o === s.key ? null : o))}
      onDrop={(e) => { e.preventDefault(); const w = rows.find((x) => x.id === dragId); setDragId(null); setOverStage(null); if (w) move(w, s.key); }}
      className={`flex min-w-0 flex-col rounded-xl border bg-gray-50/70 ${overStage === s.key ? 'ring-2 ring-primary-300' : ''}`}>
      {!mobile && <div className={`flex items-center gap-2 rounded-t-xl px-3 py-2 text-sm font-semibold ${s.head}`}><span className={`h-2 w-2 rounded-full ${s.dot}`} /> <span className="flex-1 truncate">{s.label}</span><span className="text-xs opacity-70">{byStage[s.key].length}</span></div>}
      <div className={`space-y-2 p-2 ${mobile ? '' : 'max-h-[calc(100vh-300px)] min-h-[120px] overflow-y-auto'}`}>
        {byStage[s.key].map(card)}
        {!byStage[s.key].length && <div className="py-6 text-center text-xs text-gray-400">{s.key === 'done' ? 'Finished tasks (last 30 days) show here' : 'No tasks'}</div>}
      </div>
    </div>
  );

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-3">
        <div className="min-w-0 flex-1">
          <h1 className="flex items-center gap-2 whitespace-nowrap text-2xl font-bold text-primary-800"><KanbanSquare size={22} className="text-gold-500" /> Work Board</h1>
          <p className="hidden text-sm text-gray-500 sm:block">Every client job in one place — who is doing what, and what is late.</p>
        </div>
        <button type="button" onClick={load} className="btn-secondary border" title="Refresh" aria-label="Refresh"><RefreshCw size={15} /></button>
        <button type="button" onClick={() => setEdit({ assignee: me || null })} className="btn-primary"><Plus size={16} /> New task</button>
      </div>

      {err && <div className="card flex items-center gap-2 border-amber-200 bg-amber-50 p-4 text-sm text-amber-900"><AlertTriangle size={16} /> {err}</div>}

      <div className="grid grid-cols-3 gap-2 sm:grid-cols-5">
        {[['Open tasks', stats.open, 'all', 'text-gray-900'], ['Overdue', stats.overdue, null, 'text-red-600'], ['Due today', stats.today, null, 'text-orange-600'], ['Mine', stats.mine, 'me', 'text-primary-700'], ['Unassigned', stats.none, 'none', 'text-gray-600']].map(([l, n, w, c]) => (
          <button key={l} type="button" disabled={!w} onClick={() => w && pickWho(w)} className={`card p-2.5 text-left sm:p-3 ${w && who === w ? 'ring-2 ring-primary-300' : ''} ${w ? 'hover:border-primary-200' : 'cursor-default'}`}>
            <div className={`text-lg font-bold sm:text-xl ${c}`}>{n}</div><div className="truncate text-[11px] text-gray-500 sm:text-xs">{l}</div>
          </button>
        ))}
      </div>

      <div className="card flex flex-wrap items-center gap-2 p-3">
        <div className="relative min-w-[180px] flex-1">
          <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
          <input className="input pl-9" placeholder="Search task, client, TM no., phone…" value={q} onChange={(e) => setQ(e.target.value)} />
        </div>
        <select className="input w-auto" value={who} onChange={(e) => pickWho(e.target.value)} aria-label="Assigned to">
          <option value="all">Everyone</option><option value="me">My tasks</option><option value="none">Unassigned</option>
          {team.filter((t) => !t.me).map((t) => <option key={t.id} value={t.id}>{t.full_name}</option>)}
        </select>
        <select className="input w-auto" value={kind} onChange={(e) => setKind(e.target.value)} aria-label="Type">
          <option value="">All types</option>{KINDS.map((k) => <option key={k.key} value={k.key}>{k.emoji} {k.label}</option>)}
        </select>
        <label className="hidden items-center gap-1.5 whitespace-nowrap text-sm text-gray-600 lg:flex"><input type="checkbox" checked={showDone} onChange={(e) => setShowDone(e.target.checked)} /> Show done</label>
      </div>

      {rows === null && !err ? <div className="card flex justify-center p-12 text-gray-400"><Loader2 className="animate-spin" /></div> : rows && (
        <>
          {/* phone / tablet: one stage at a time */}
          <div className="lg:hidden">
            <div className="-mx-1 mb-2 flex gap-1.5 overflow-x-auto px-1 pb-1">
              {STAGES.map((s) => (
                <button key={s.key} type="button" onClick={() => setMobileStage(s.key)}
                  className={`flex shrink-0 items-center gap-1.5 whitespace-nowrap rounded-full border px-3 py-1.5 text-xs font-semibold ${mobileStage === s.key ? 'border-primary-600 bg-primary-600 text-white' : 'bg-white text-gray-600'}`}>
                  <span className={`h-2 w-2 rounded-full ${s.dot}`} /> {s.label} <span className="opacity-70">{byStage[s.key].length}</span>
                </button>
              ))}
            </div>
            {column(STAGES.find((s) => s.key === mobileStage), true)}
          </div>
          {/* computer: the whole board, drag cards between columns */}
          <div className={`hidden gap-3 lg:grid ${showDone ? 'lg:grid-cols-5' : 'lg:grid-cols-4'}`}>
            {stages.map((s) => column(s))}
          </div>
          <p className="text-xs text-gray-400">Tip: when a client finishes sending all documents in their checklist, “Prepare IIT return” is added here automatically. On a computer you can drag cards between columns. <Link to="/admin/doc-checklist" className="text-primary-700 hover:underline">Docs Checklist →</Link></p>
        </>
      )}

      {edit && <WorkItemModal item={edit} clients={clients} team={team} onClose={closeEdit} onSaved={(w) => { upsert(w); closeEdit(); }} onDeleted={(id) => { setRows((r) => r.filter((x) => x.id !== id)); closeEdit(); }} />}
    </div>
  );
}
