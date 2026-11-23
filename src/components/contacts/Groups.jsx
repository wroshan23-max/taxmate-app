// V75 — Groups: your own groups (clients + leads) and smart groups that keep themselves up to date
import { useMemo, useState } from 'react';
import toast from 'react-hot-toast';
import { Plus, Send, Users, Pencil, Trash2, Loader2, Search, CheckSquare, Square, Zap, Sparkles, X } from 'lucide-react';
import { Modal } from '../vat/ui';
import { Avatar, GroupDot, EMOJIS, GROUP_COLORS } from './ui';
import { colorOf } from '../../lib/clientFlags';
import { allGroups, membersOf, saveGroup, deleteGroup, addToGroup, removeFromGroup } from '../../lib/contactsHub';

const RING = { red: 'from-red-500 to-rose-600', orange: 'from-orange-500 to-amber-500', amber: 'from-amber-400 to-yellow-500', green: 'from-green-500 to-emerald-600', teal: 'from-teal-500 to-cyan-600', blue: 'from-blue-500 to-indigo-600', indigo: 'from-indigo-500 to-violet-600', purple: 'from-purple-500 to-fuchsia-600', pink: 'from-pink-500 to-rose-500', gray: 'from-slate-400 to-slate-600' };

export default function Groups({ book, reload, onOpenGroup, onMessageGroup }) {
  const [edit, setEdit] = useState(null);     // {} new · group
  const groups = useMemo(() => allGroups(book), [book]);
  const mine = groups.filter((g) => !g.smart), smart = groups.filter((g) => g.smart);
  const del = async (g) => {
    if (!window.confirm(`Delete the group "${g.name}"? The contacts stay in your phone book.`)) return;
    try { await deleteGroup(g.id); toast.success('Group deleted'); reload(); } catch (e) { toast.error(e.message); }
  };

  const card = (g) => {
    const people = membersOf(book, g.ref);
    return (
      <div key={g.ref} className="card group relative flex flex-col overflow-hidden transition hover:-translate-y-0.5 hover:shadow-lg">
        <div className={`h-1.5 bg-gradient-to-r ${RING[g.color] || RING.blue}`} />
        <div className="flex flex-1 flex-col p-4">
          <div className="flex items-start gap-3">
            <div className={`flex h-12 w-12 flex-shrink-0 items-center justify-center rounded-2xl bg-gradient-to-br ${RING[g.color] || RING.blue} text-2xl shadow-md`}>{g.emoji}</div>
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-1.5"><span className="truncate font-bold text-gray-800">{g.name}</span>{g.smart && <span className="flex items-center gap-0.5 rounded-full bg-violet-100 px-1.5 text-[10px] font-bold text-violet-700"><Zap size={9} /> auto</span>}</div>
              <div className="line-clamp-2 text-xs text-gray-500">{g.desc || 'Your group'}</div>
            </div>
            {!g.smart && (
              <div className="flex gap-0.5 opacity-100 transition sm:opacity-0 sm:group-hover:opacity-100">
                <button type="button" onClick={() => setEdit(book.groups.find((x) => x.id === g.id))} className="rounded-lg p-1.5 text-gray-400 hover:bg-gray-100 hover:text-primary-700" aria-label={`Edit ${g.name}`}><Pencil size={14} /></button>
                <button type="button" onClick={() => del(g)} className="rounded-lg p-1.5 text-gray-400 hover:bg-red-50 hover:text-red-600" aria-label={`Delete ${g.name}`}><Trash2 size={14} /></button>
              </div>
            )}
          </div>
          <div className="mt-4 flex items-center gap-3">
            <div className="flex -space-x-2">
              {people.slice(0, 5).map((c) => <Avatar key={c.key} c={c} size="h-8 w-8 text-[10px]" ring="ring-2 ring-white" />)}
              {people.length > 5 && <div className="flex h-8 w-8 items-center justify-center rounded-full bg-gray-100 text-[10px] font-bold text-gray-600 ring-2 ring-white">+{people.length - 5}</div>}
            </div>
            <div className="ml-auto text-right"><div className="text-2xl font-black leading-none text-primary-800">{people.length}</div><div className="text-[10px] uppercase tracking-wide text-gray-400">member{people.length === 1 ? '' : 's'}</div></div>
          </div>
          <div className="mt-4 flex gap-2">
            <button type="button" onClick={() => onOpenGroup(g.ref)} className="btn-secondary flex-1 justify-center text-xs"><Users size={13} /> View</button>
            <button type="button" disabled={!people.length} onClick={() => onMessageGroup(g.ref)} className="btn-primary flex-1 justify-center text-xs"><Send size={13} /> Message</button>
          </div>
        </div>
      </div>
    );
  };

  return (
    <div className="space-y-6">
      <section>
        <div className="mb-3 flex flex-wrap items-center gap-2">
          <h2 className="flex items-center gap-2 text-lg font-bold text-primary-800"><Sparkles size={18} className="text-gold-500" /> Your groups</h2>
          <span className="text-xs text-gray-500">Mix clients and Call Log leads — e.g. “Freelancers”, “Companies”, “VIP”, “Seminar Nov 2026”.</span>
          <button type="button" disabled={book.groupsOff} onClick={() => setEdit({})} className="btn-primary ml-auto text-sm"><Plus size={15} /> New group</button>
        </div>
        {book.groupsOff ? (
          <div className="card border-amber-200 bg-amber-50 p-4 text-sm text-amber-900">Your own groups need the <b>V75 script</b> — run it in the Supabase SQL Editor. Smart groups below already work.</div>
        ) : mine.length === 0 ? (
          <button type="button" onClick={() => setEdit({})} className="flex w-full flex-col items-center gap-2 rounded-2xl border-2 border-dashed border-primary-200 bg-primary-50/40 p-8 text-center hover:border-primary-400">
            <div className="text-4xl">🗂️</div><div className="font-bold text-primary-800">Create your first group</div><div className="text-xs text-gray-500">Then message the whole group in one go.</div>
          </button>
        ) : <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">{mine.map(card)}</div>}
      </section>
      <section>
        <div className="mb-3 flex items-center gap-2">
          <h2 className="flex items-center gap-2 text-lg font-bold text-primary-800"><Zap size={18} className="text-violet-500" /> Smart groups</h2>
          <span className="text-xs text-gray-500">Built automatically from portal logins, labels, packages and the Call Log.</span>
        </div>
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">{smart.map(card)}</div>
      </section>
      {edit && <GroupEditor book={book} group={edit} onClose={() => setEdit(null)} onSaved={() => { setEdit(null); reload(); }} />}
    </div>
  );
}

function GroupEditor({ book, group, onClose, onSaved }) {
  const [f, setF] = useState({ name: group.name || '', emoji: group.emoji || '⭐', color: group.color || 'blue', description: group.description || '' });
  const [q, setQ] = useState('');
  const [add, setAdd] = useState(() => new Set());
  const [drop, setDrop] = useState(() => new Set());
  const [busy, setBusy] = useState(false);
  const set = (p) => setF((x) => ({ ...x, ...p }));
  const live = book.contacts.filter((c) => !c.archived);
  const isIn = (c) => group.id && c.groups.includes(group.id);
  const ql = q.trim().toLowerCase(), qd = q.replace(/\D/g, '');
  const shown = live.filter((c) => !ql || c.name.toLowerCase().includes(ql) || (c.client_no || '').toLowerCase().includes(ql) || (qd.length >= 3 && (c.phone || '').replace(/\D/g, '').includes(qd)));
  const checked = (c) => (isIn(c) ? !drop.has(c.key) : add.has(c.key));
  const flip = (c) => {
    const s = isIn(c) ? drop : add, fn = isIn(c) ? setDrop : setAdd;
    const n = new Set(s); if (n.has(c.key)) n.delete(c.key); else n.add(c.key); fn(n);
  };
  const total = live.filter(checked).length;

  const save = async () => {
    setBusy(true);
    try {
      const g = await saveGroup({ id: group.id, ...f });
      const adds = live.filter((c) => add.has(c.key));
      if (adds.length) await addToGroup(g.id, adds);
      for (const c of live.filter((x) => drop.has(x.key))) await removeFromGroup(g.id, c);
      toast.success(group.id ? 'Group saved' : `Group "${g.name}" created`);
      onSaved();
    } catch (e) { toast.error(e.message); }
    setBusy(false);
  };
  return (
    <Modal wide title={group.id ? `Edit group — ${group.name}` : 'New group'} onClose={onClose}
      footer={<><button type="button" onClick={onClose} className="btn-secondary text-sm">Cancel</button><button type="button" disabled={busy || !f.name.trim()} onClick={save} className="btn-primary text-sm">{busy ? <Loader2 size={14} className="animate-spin" /> : null} {group.id ? 'Save group' : `Create group${total ? ` with ${total}` : ''}`}</button></>}>
      <div className="grid gap-5 md:grid-cols-[minmax(0,1fr)_minmax(0,1.2fr)]">
        <div className="space-y-3">
          <div className={`flex items-center gap-3 rounded-2xl bg-gradient-to-br ${RING[f.color] || RING.blue} p-4 text-white shadow`}>
            <span className="text-4xl drop-shadow">{f.emoji}</span>
            <div className="min-w-0"><div className="truncate text-lg font-bold">{f.name || 'Group name'}</div><div className="text-xs text-white/80">{total} member{total === 1 ? '' : 's'}</div></div>
          </div>
          <label className="block text-xs font-semibold text-gray-600">Name<input className="input mt-1" maxLength={40} autoFocus value={f.name} onChange={(e) => set({ name: e.target.value })} placeholder="e.g. Freelancers" /></label>
          <div><div className="text-xs font-semibold text-gray-600">Icon</div><div className="mt-1 flex flex-wrap gap-1">{EMOJIS.map((e) => <button key={e} type="button" onClick={() => set({ emoji: e })} className={`h-9 w-9 rounded-lg text-lg ${f.emoji === e ? 'bg-primary-100 ring-2 ring-primary-500' : 'hover:bg-gray-100'}`}>{e}</button>)}</div></div>
          <div><div className="text-xs font-semibold text-gray-600">Colour</div><div className="mt-1 flex flex-wrap gap-2">{GROUP_COLORS.map((c) => <button key={c} type="button" onClick={() => set({ color: c })} aria-label={colorOf(c).name} className={`h-7 w-7 rounded-full ${colorOf(c).dot} ${f.color === c ? 'ring-2 ring-primary-700 ring-offset-2' : ''}`} />)}</div></div>
          <label className="block text-xs font-semibold text-gray-600">Description (optional)<input className="input mt-1" maxLength={200} value={f.description} onChange={(e) => set({ description: e.target.value })} placeholder="Who is in this group?" /></label>
        </div>
        <div className="flex min-h-0 flex-col">
          <div className="mb-2 flex items-center gap-2 text-xs font-semibold text-gray-600">Members <span className="rounded-full bg-primary-100 px-2 text-primary-800">{total}</span>
            {(add.size > 0 || drop.size > 0) && <span className="text-[11px] font-normal text-gray-400">+{add.size} / −{drop.size}</span>}</div>
          <div className="relative mb-2"><Search size={14} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-gray-400" /><input className="input py-2 pl-8 text-sm" placeholder="Find clients or leads…" value={q} onChange={(e) => setQ(e.target.value)} />
            {q && <button type="button" onClick={() => setQ('')} className="absolute right-2 top-1/2 -translate-y-1/2 text-gray-400" aria-label="Clear"><X size={14} /></button>}</div>
          <div className="flex gap-2 pb-2 text-[11px]">
            <button type="button" onClick={() => { const n = new Set(add); const d = new Set(drop); shown.forEach((c) => (isIn(c) ? d.delete(c.key) : n.add(c.key))); setAdd(n); setDrop(d); }} className="font-semibold text-primary-700">Tick all shown ({shown.length})</button>
            <button type="button" onClick={() => { const n = new Set(add); const d = new Set(drop); shown.forEach((c) => (isIn(c) ? d.add(c.key) : n.delete(c.key))); setAdd(n); setDrop(d); }} className="text-gray-500">Untick shown</button>
          </div>
          <div className="max-h-[46vh] flex-1 divide-y divide-gray-50 overflow-y-auto rounded-xl border border-gray-100">
            {shown.slice(0, 400).map((c) => {
              const on = checked(c);
              return (
                <button key={c.key} type="button" onClick={() => flip(c)} className={`flex w-full items-center gap-2.5 px-3 py-2 text-left ${on ? 'bg-primary-50/70' : 'hover:bg-gray-50'}`}>
                  {on ? <CheckSquare size={16} className="text-primary-600" /> : <Square size={16} className="text-gray-300" />}
                  <Avatar c={c} size="h-7 w-7 text-[10px]" />
                  <span className="min-w-0 flex-1"><span className="block truncate text-sm font-medium text-gray-800">{c.name}</span><span className="text-[11px] text-gray-400">{c.kind === 'lead' ? 'Lead · ' : c.client_no ? `${c.client_no} · ` : ''}{c.phone}</span></span>
                  {c.groups.filter((id) => id !== group.id).slice(0, 3).map((id) => { const g = book.groups.find((x) => x.id === id); return g ? <GroupDot key={id} color={g.color} /> : null; })}
                </button>
              );
            })}
            {shown.length > 400 && <div className="p-2 text-center text-[11px] text-gray-400">Showing 400 of {shown.length} — search to narrow down</div>}
          </div>
        </div>
      </div>
    </Modal>
  );
}
