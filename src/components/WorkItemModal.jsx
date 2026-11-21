// V70 — create / edit one work-board task (used by the Work Board and the client page)
import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import toast from 'react-hot-toast';
import { X, Loader2, Trash2, ExternalLink, Flag } from 'lucide-react';
import ClientPicker from './ClientPicker';
import { STAGES, KINDS, saveWork, deleteWork, suggestTitle } from '../lib/work';

export default function WorkItemModal({ item, clients, team, fixedClient = null, onClose, onSaved, onDeleted }) {
  const [f, setF] = useState(() => ({ kind: 'iit', stage: 'todo', priority: 'normal', ...item, client_id: item?.client_id || fixedClient?.id || '' }));
  const [autoTitle, setAutoTitle] = useState(!item?.id);
  const [busy, setBusy] = useState(false);
  const set = (p) => setF((o) => ({ ...o, ...p }));
  useEffect(() => { if (autoTitle) set({ title: suggestTitle(f.kind, f.period) }); }, [f.kind, f.period, autoTitle]);
  useEffect(() => { const k = (e) => e.key === 'Escape' && !busy && onClose(); window.addEventListener('keydown', k); return () => window.removeEventListener('keydown', k); }, [busy, onClose]);

  const save = async () => {
    if (!(f.title || '').trim()) return toast.error('Give the task a title');
    setBusy(true);
    try { const w = await saveWork(f); toast.success(item?.id ? 'Task saved' : 'Task added'); onSaved(w); }
    catch (e) { toast.error(e.message.replace(/^.*?ERROR:\s*/, '')); }
    setBusy(false);
  };
  const remove = async () => {
    if (!window.confirm('Delete this task?')) return;
    setBusy(true);
    try { await deleteWork(item.id); toast.success('Task deleted'); onDeleted?.(item.id); }
    catch (e) { toast.error(e.message); setBusy(false); }
  };
  const cid = f.client_id || null;

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/50 sm:items-center sm:p-4" onMouseDown={(e) => e.target === e.currentTarget && !busy && onClose()}>
      <div className="max-h-[92vh] w-full max-w-lg overflow-y-auto rounded-t-2xl bg-white shadow-xl sm:rounded-2xl">
        <div className="sticky top-0 z-10 flex items-center gap-2 border-b bg-white px-4 py-3">
          <h3 className="flex-1 font-semibold text-primary-800">{item?.id ? 'Edit task' : 'New task'}</h3>
          <button type="button" onClick={onClose} className="rounded p-1 text-gray-400 hover:bg-gray-100" aria-label="Close"><X size={18} /></button>
        </div>
        <div className="space-y-3 p-4">
          {fixedClient
            ? <div className="rounded-lg bg-gray-50 px-3 py-2 text-sm"><span className="text-gray-500">Client:</span> <b>{fixedClient.full_name}</b></div>
            : <div><div className="mb-1 text-xs font-semibold text-gray-600">Client (optional)</div><ClientPicker clients={clients} value={cid || ''} onChange={(v) => set({ client_id: v })} /></div>}
          <div className="grid grid-cols-2 gap-2">
            <label className="block text-xs font-semibold text-gray-600">Type
              <select className="input mt-1" value={f.kind} onChange={(e) => set({ kind: e.target.value })}>{KINDS.map((k) => <option key={k.key} value={k.key}>{k.emoji} {k.label}</option>)}</select>
            </label>
            <label className="block text-xs font-semibold text-gray-600">Period
              <input className="input mt-1" maxLength={30} placeholder="Y/A 2025/26, Oct 2026…" value={f.period || ''} onChange={(e) => set({ period: e.target.value })} />
            </label>
          </div>
          <label className="block text-xs font-semibold text-gray-600">Title *
            <input className="input mt-1" maxLength={150} value={f.title || ''} onChange={(e) => { setAutoTitle(false); set({ title: e.target.value }); }} />
          </label>
          <div className="grid grid-cols-2 gap-2">
            <label className="block text-xs font-semibold text-gray-600">Stage
              <select className="input mt-1" value={f.stage} onChange={(e) => set({ stage: e.target.value })}>{STAGES.map((s) => <option key={s.key} value={s.key}>{s.label}</option>)}</select>
            </label>
            <label className="block text-xs font-semibold text-gray-600">Assigned to
              <select className="input mt-1" value={f.assignee || ''} onChange={(e) => set({ assignee: e.target.value || null })}>
                <option value="">— Unassigned —</option>
                {team.map((t) => <option key={t.id} value={t.id}>{t.full_name}{t.me ? ' (me)' : ''}</option>)}
              </select>
            </label>
            <label className="block text-xs font-semibold text-gray-600">Due date
              <input type="date" className="input mt-1" value={f.due_date || ''} onChange={(e) => set({ due_date: e.target.value || null })} />
            </label>
            <div className="text-xs font-semibold text-gray-600">Priority
              <button type="button" onClick={() => set({ priority: f.priority === 'high' ? 'normal' : 'high' })}
                className={`mt-1 flex w-full items-center justify-center gap-1.5 rounded-lg border px-3 py-2 text-sm ${f.priority === 'high' ? 'border-red-300 bg-red-50 text-red-700' : 'bg-white text-gray-600'}`}>
                <Flag size={14} /> {f.priority === 'high' ? 'High priority' : 'Normal'}
              </button>
            </div>
          </div>
          <label className="block text-xs font-semibold text-gray-600">Notes
            <textarea className="input mt-1 resize-y" rows={3} maxLength={3000} placeholder="What is needed, what the client said…" value={f.notes || ''} onChange={(e) => set({ notes: e.target.value })} />
          </label>
          {item?.source === 'checklist' && <p className="text-xs text-gray-500">Added automatically when the client finished sending documents.</p>}
        </div>
        <div className="sticky bottom-0 flex flex-wrap items-center gap-2 border-t bg-white px-4 py-3">
          {item?.id && <button type="button" disabled={busy} onClick={remove} className="rounded-lg p-2 text-red-600 hover:bg-red-50" title="Delete task" aria-label="Delete task"><Trash2 size={16} /></button>}
          {cid && !fixedClient && <Link to={`/admin/clients/${cid}`} className="flex items-center gap-1 text-sm text-primary-700 hover:underline"><ExternalLink size={14} /> Open client</Link>}
          <div className="flex-1" />
          <button type="button" onClick={onClose} className="btn-secondary border">Cancel</button>
          <button type="button" disabled={busy} onClick={save} className="btn-primary">{busy && <Loader2 size={15} className="animate-spin" />} Save</button>
        </div>
      </div>
    </div>
  );
}
