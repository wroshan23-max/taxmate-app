// V70 — client page: this client's open tasks on the Work Board
import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { KanbanSquare, Plus, Flag } from 'lucide-react';
import { loadWork, loadTeam, stageOf, kindOf, dueState, dueLabel, DUE_STYLE, initials } from '../lib/work';
import WorkItemModal from './WorkItemModal';

export default function ClientWorkCard({ client }) {
  const [rows, setRows] = useState(null);
  const [team, setTeam] = useState([]);
  const [edit, setEdit] = useState(null);
  const [off, setOff] = useState(false);
  const load = () => Promise.all([loadWork({ clientId: client.id, doneDays: 60 }), loadTeam()]).then(([w, t]) => { setRows(w); setTeam(t); }).catch(() => setOff(true));
  useEffect(() => { load(); }, [client.id]); // eslint-disable-line react-hooks/exhaustive-deps
  if (off) return null;   // database not set up yet

  const open = (rows || []).filter((w) => w.stage !== 'done');
  const done = (rows || []).filter((w) => w.stage === 'done');
  const me = team.find((t) => t.me)?.id;
  const nameOf = (id) => team.find((t) => t.id === id)?.full_name || '';

  return (
    <div className="card p-4">
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <h3 className="flex flex-1 items-center gap-2 font-semibold text-primary-800"><KanbanSquare size={17} className="text-gold-500" /> Work in progress <span className="text-xs font-normal text-gray-400">{open.length} open</span></h3>
        <Link to="/admin/work" className="text-xs text-primary-700 hover:underline">Work Board →</Link>
        <button type="button" onClick={() => setEdit({ assignee: me || null })} className="btn-secondary border py-1.5 text-xs"><Plus size={14} /> Add task</button>
      </div>
      {rows === null ? <div className="h-10 animate-pulse rounded bg-gray-100" />
        : !open.length ? <p className="text-sm text-gray-500">No open tasks for this client.{done.length ? ` ${done.length} finished recently.` : ''}</p>
        : (
          <div className="divide-y rounded-lg border">
            {open.map((w) => {
              const ds = dueState(w), st = stageOf(w.stage);
              return (
                <button key={w.id} type="button" onClick={() => setEdit(w)} className="flex w-full flex-wrap items-center gap-2 px-3 py-2 text-left hover:bg-gray-50">
                  <span>{kindOf(w.kind).emoji}</span>
                  <span className="min-w-0 flex-1 truncate text-sm font-medium text-gray-900">{w.title}</span>
                  {w.priority === 'high' && <Flag size={13} className="text-red-500" />}
                  {ds && <span className={`whitespace-nowrap rounded px-1.5 py-0.5 text-[10px] font-semibold ${DUE_STYLE[ds]}`}>{dueLabel(w)}</span>}
                  <span className={`whitespace-nowrap rounded px-1.5 py-0.5 text-[11px] font-semibold ${st.head}`}>{st.label}</span>
                  {w.assignee && <span title={nameOf(w.assignee)} className="flex h-6 w-6 items-center justify-center rounded-full bg-primary-100 text-[10px] font-bold text-primary-700">{initials(nameOf(w.assignee))}</span>}
                </button>
              );
            })}
          </div>
        )}
      {edit && <WorkItemModal item={edit} clients={[]} team={team} fixedClient={client} onClose={() => setEdit(null)} onSaved={() => { setEdit(null); load(); }} onDeleted={() => { setEdit(null); load(); }} />}
    </div>
  );
}
