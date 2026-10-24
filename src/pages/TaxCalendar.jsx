import { useEffect, useMemo, useState } from 'react';
import { Link, useOutletContext } from 'react-router-dom';
import toast from 'react-hot-toast';
import { CalendarDays, ChevronLeft, ChevronRight, List, LayoutGrid, Plus, Bell, X, Check, Trash2, Info, Users, User, Lock, Hash } from 'lucide-react';
import { supabase } from '../lib/supabase';
import { useAuth } from '../contexts/AuthContext';
import { CATS, IRD_CATS, CLIENT_DEFAULT_CATS, irdBetween, iso, todayIso, daysUntil, dueLabel, fmtDay, reminderEvent } from '../lib/taxCalendar';
import MessageMenu from '../components/MessageMenu';
import { recipientsOf } from '../lib/contacts';
import { FIRM } from '../lib/iitStatement';

const WD = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
const AUD = {
  admin: { label: 'Only TaxMate (private)', icon: Lock },
  client: { label: 'One client', icon: User },
  all: { label: 'All clients', icon: Users },
  personal: { label: 'My reminder', icon: Bell },
};

function AddReminder({ role, clients, defaultDate, onClose, onSaved, myClientId }) {
  const { user } = useAuth();
  const [f, setF] = useState({ title: '', due_date: defaultDate, note: '', audience: role === 'admin' ? 'admin' : 'personal', client_id: '' });
  const [busy, setBusy] = useState(false);
  const save = async (e) => {
    e.preventDefault();
    if (!f.title.trim()) return toast.error('Add a title');
    if (f.audience === 'client' && !f.client_id) return toast.error('Choose the client');
    setBusy(true);
    const row = {
      title: f.title.trim().slice(0, 120), note: f.note.trim() || null, due_date: f.due_date, audience: f.audience, created_by: user.id,
      client_id: role === 'client' ? myClientId : (f.audience === 'client' || (f.audience === 'admin' && f.client_id) ? f.client_id || null : null),
    };
    const { error } = await supabase.from('reminders').insert(row);
    setBusy(false);
    if (error) return toast.error(error.message);
    toast.success('Reminder added');
    onSaved();
  };
  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center p-0 sm:p-4 bg-black/40" onClick={onClose}>
      <form onSubmit={save} className="bg-white w-full sm:max-w-md rounded-t-2xl sm:rounded-2xl p-5 space-y-3" onClick={e => e.stopPropagation()}>
        <div className="flex items-center gap-2"><Bell size={18} className="text-purple-600" /><h3 className="font-bold text-primary-800 flex-1">New reminder</h3><button type="button" onClick={onClose} className="text-gray-400"><X size={18} /></button></div>
        <input className="input" placeholder="e.g. Send salary slips to TaxMate" maxLength={120} value={f.title} onChange={e => setF({ ...f, title: e.target.value })} autoFocus />
        <input type="date" className="input" value={f.due_date} onChange={e => setF({ ...f, due_date: e.target.value })} required />
        <textarea className="input resize-none" rows={2} maxLength={1000} placeholder="Note (optional)" value={f.note} onChange={e => setF({ ...f, note: e.target.value })} />
        {role === 'admin' && (
          <>
            <div className="grid grid-cols-3 gap-2">
              {['admin', 'client', 'all'].map(a => {
                const A = AUD[a]; const Icon = A.icon;
                return (
                  <button type="button" key={a} onClick={() => setF({ ...f, audience: a })}
                    className={`rounded-xl border-2 p-2 text-xs font-semibold flex flex-col items-center gap-1 ${f.audience === a ? 'border-primary-500 bg-primary-50 text-primary-800' : 'border-gray-200 text-gray-600'}`}>
                    <Icon size={15} /> {A.label}
                  </button>
                );
              })}
            </div>
            {(f.audience === 'client' || f.audience === 'admin') && (
              <select className="input" value={f.client_id} onChange={e => setF({ ...f, client_id: e.target.value })}>
                <option value="">{f.audience === 'admin' ? '— About a client (optional) —' : '— Choose client —'}</option>
                {clients.map(c => <option key={c.id} value={c.id}>{c.full_name}</option>)}
              </select>
            )}
            <p className="text-[11px] text-gray-400">{f.audience === 'admin' ? 'Only you and your staff see it.' : f.audience === 'all' ? 'Every client sees it on their dashboard and calendar.' : 'This client sees it on their dashboard and calendar.'}</p>
          </>
        )}
        <button disabled={busy} className="btn-primary w-full justify-center"><Plus size={15} /> Add reminder</button>
      </form>
    </div>
  );
}

/** IRD tax calendar + reminders. role: 'admin' | 'client' */
export default function TaxCalendar({ role = 'admin' }) {
  const features = useOutletContext() ?? {};
  const isClient = role === 'client';
  const canRemind = !isClient || features.reminders !== false;
  const now = new Date();
  const [ym, setYm] = useState({ y: now.getFullYear(), m: now.getMonth() + 1 });
  const [view, setView] = useState('month');
  const [cats, setCats] = useState(isClient ? CLIENT_DEFAULT_CATS : [...IRD_CATS.filter(c => !['bg', 'vatfs'].includes(c)), 'reminder']);
  const [sel, setSel] = useState(todayIso());
  const [rems, setRems] = useState([]);
  const [clients, setClients] = useState([]);
  const [myClient, setMyClient] = useState(null);
  const [adding, setAdding] = useState(false);

  const first = iso(ym.y, ym.m, 1);
  const last = iso(ym.y, ym.m, new Date(ym.y, ym.m, 0).getDate());

  const loadRems = async () => {
    let q = supabase.from('reminders').select('*, clients(id, full_name, mobile, email, contact_name, contact_relation, contact_mobile, contact_email, contact_preferred)').order('due_date');
    if (!isClient) q = q.neq('audience', 'personal');
    const { data, error } = await q;
    if (error) toast.error(error.message);
    setRems(data ?? []);
  };
  useEffect(() => {
    loadRems();
    if (!isClient) supabase.from('clients').select('id, full_name').is('archived_at', null).order('full_name').then(({ data }) => setClients(data ?? []));
    else {
      supabase.auth.getUser().then(async ({ data }) => {
        if (!data?.user) return;
        const { data: c } = await supabase.from('clients').select('id').eq('profile_id', data.user.id).maybeSingle();
        setMyClient(c?.id ?? null);
      });
    }
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const events = useMemo(() => {
    const ird = irdBetween(first, last, cats.filter(c => c !== 'reminder'));
    const r = cats.includes('reminder') && canRemind ? rems.filter(x => x.due_date >= first && x.due_date <= last).map(reminderEvent) : [];
    return [...r, ...ird].sort((a, b) => a.date.localeCompare(b.date));
  }, [first, last, cats, rems, canRemind]);
  const byDay = useMemo(() => events.reduce((m, e) => { (m[e.date] ||= []).push(e); return m; }, {}), [events]);

  const toggleCat = (c) => setCats(cs => (cs.includes(c) ? cs.filter(x => x !== c) : [...cs, c]));
  const shift = (d) => setYm(({ y, m }) => { const t = new Date(y, m - 1 + d, 1); return { y: t.getFullYear(), m: t.getMonth() + 1 }; });

  const markDone = async (r) => {
    const { error } = await supabase.from('reminders').update({ done_at: r.done_at ? null : new Date().toISOString() }).eq('id', r.id);
    if (error) return toast.error(error.message);
    loadRems();
  };
  const del = async (r) => {
    if (!window.confirm('Delete this reminder?')) return;
    const { error } = await supabase.from('reminders').delete().eq('id', r.id);
    if (error) return toast.error(error.message);
    loadRems();
  };
  const canEdit = (r) => !isClient || r.audience === 'personal';

  // month grid (Mon-first)
  const startOffset = (new Date(ym.y, ym.m - 1, 1).getDay() + 6) % 7;
  const dim = new Date(ym.y, ym.m, 0).getDate();
  const cells = [...Array(startOffset).fill(null), ...Array.from({ length: dim }, (_, i) => i + 1)];
  while (cells.length % 7) cells.push(null);
  const today = todayIso();
  const selEvents = byDay[sel] ?? [];
  const catList = [...(isClient ? ['iit'] : IRD_CATS), ...(canRemind ? ['reminder'] : [])];
  const extraCats = isClient ? IRD_CATS.filter(c => c !== 'iit') : [];

  const EventRow = ({ e }) => {
    const r = e.reminder; const cat = CATS[e.cat];
    return (
      <div className={`flex items-start gap-3 rounded-xl border p-3 ${r?.done_at ? 'opacity-50' : ''} ${cat.soft}`}>
        <span className={`w-2 h-2 rounded-full mt-1.5 flex-shrink-0 ${cat.color}`} />
        <div className="flex-1 min-w-0">
          <div className={`text-sm font-semibold text-gray-800 ${r?.done_at ? 'line-through' : ''}`}>{e.title}</div>
          <div className="text-xs text-gray-600">{e.detail || cat.who}</div>
          {r && !isClient && (
            <div className="text-[11px] text-gray-500 mt-0.5 flex items-center gap-1">{(() => { const I = AUD[r.audience].icon; return <I size={11} />; })()} {r.audience === 'client' ? r.clients?.full_name : AUD[r.audience].label}{r.audience === 'admin' && r.clients ? ` · about ${r.clients.full_name}` : ''}</div>
          )}
          {r && isClient && r.audience !== 'personal' && <div className="text-[11px] text-gray-500 mt-0.5">From {FIRM.name}</div>}
        </div>
        <div className="flex items-center gap-1 flex-shrink-0">
          <span className="text-[11px] font-semibold text-gray-500 hidden sm:inline">{dueLabel(e.date)}</span>
          {r && !isClient && r.audience === 'client' && r.clients && (
            <MessageMenu label="" phone={r.clients.mobile} email={r.clients.email} recipients={recipientsOf(r.clients)} subject={r.title}
              getText={async () => `Dear ${(r.clients.contact_preferred && r.clients.contact_name ? r.clients.contact_name : r.clients.full_name).split(' ').slice(-1)[0]},\n\nReminder from ${FIRM.name}: ${r.title} — by ${fmtDay(r.due_date, { day: 'numeric', month: 'long', year: 'numeric' })}.${r.note ? `\n${r.note}` : ''}\n\nThank you,\n${FIRM.name}\nWhatsApp ${FIRM.whatsapp}`} />
          )}
          {r && canEdit(r) && <button onClick={() => markDone(r)} title={r.done_at ? 'Mark not done' : 'Mark done'} className={`p-1.5 rounded-lg ${r.done_at ? 'bg-green-100 text-green-700' : 'bg-white/70 text-gray-500 hover:text-green-700'}`}><Check size={14} /></button>}
          {r && canEdit(r) && <button onClick={() => del(r)} title="Delete" className="p-1.5 rounded-lg bg-white/70 text-gray-400 hover:text-red-600"><Trash2 size={14} /></button>}
        </div>
      </div>
    );
  };

  if (isClient && features.loaded && features.tax_calendar === false) return (
    <div className="card p-8 text-center space-y-3"><CalendarDays size={36} className="mx-auto text-gray-300" /><p className="text-gray-600">The Tax Calendar is not available right now.</p><Link to="/client" className="btn-secondary text-sm inline-flex">Back to dashboard</Link></div>
  );

  return (
    <div className="space-y-4">
      <div className="rounded-2xl bg-gradient-to-br from-primary-700 to-primary-900 text-white p-5 shadow-lg">
        <div className="flex items-start gap-3 flex-wrap">
          <div className="w-11 h-11 rounded-xl bg-white/15 flex items-center justify-center"><CalendarDays size={22} /></div>
          <div className="flex-1 min-w-[200px]">
            <h1 className="text-xl sm:text-2xl font-bold">Tax Calendar</h1>
            <p className="text-sm text-primary-200">බදු දින දර්ශනය · Due dates from the IRD Tax Calendar{canRemind ? ' + your reminders' : ''}</p>
          </div>
          {(!isClient || features.ird_codes !== false) && <Link to={isClient ? '/client/ird-codes' : '/admin/ird-codes'} className="px-3 py-2 rounded-xl bg-white/10 hover:bg-white/20 font-semibold text-sm flex items-center gap-1.5"><Hash size={15} /> Payment codes</Link>}
          {canRemind && <button onClick={() => setAdding(true)} className="px-3 py-2 rounded-xl bg-gold-500 text-primary-900 font-semibold text-sm flex items-center gap-1.5"><Plus size={15} /> Reminder</button>}
        </div>
        <div className="mt-4 flex items-center gap-2 flex-wrap">
          <button onClick={() => shift(-1)} className="p-2 rounded-lg bg-white/10 hover:bg-white/20"><ChevronLeft size={16} /></button>
          <div className="font-bold text-lg min-w-[150px] text-center">{fmtDay(first, { month: 'long', year: 'numeric' })}</div>
          <button onClick={() => shift(1)} className="p-2 rounded-lg bg-white/10 hover:bg-white/20"><ChevronRight size={16} /></button>
          <button onClick={() => { setYm({ y: now.getFullYear(), m: now.getMonth() + 1 }); setSel(today); }} className="px-3 py-1.5 rounded-lg bg-white/10 hover:bg-white/20 text-sm">Today</button>
          <div className="ml-auto flex bg-white/10 rounded-xl p-1">
            <button onClick={() => setView('month')} className={`px-2.5 py-1 rounded-lg text-sm flex items-center gap-1 ${view === 'month' ? 'bg-white text-primary-800 font-semibold' : 'text-primary-100'}`}><LayoutGrid size={14} /> Month</button>
            <button onClick={() => setView('list')} className={`px-2.5 py-1 rounded-lg text-sm flex items-center gap-1 ${view === 'list' ? 'bg-white text-primary-800 font-semibold' : 'text-primary-100'}`}><List size={14} /> List</button>
          </div>
        </div>
      </div>

      {/* Category filters */}
      <div className="flex flex-wrap gap-1.5">
        {[...catList, ...extraCats].map(c => (
          <button key={c} onClick={() => toggleCat(c)}
            className={`text-xs font-semibold px-2.5 py-1 rounded-full border flex items-center gap-1.5 ${cats.includes(c) ? CATS[c].soft : 'bg-white text-gray-400 border-gray-200'}`}>
            <span className={`w-2 h-2 rounded-full ${cats.includes(c) ? CATS[c].color : 'bg-gray-300'}`} />{CATS[c].label}
          </button>
        ))}
      </div>
      {isClient && <p className="text-[11px] text-gray-500 -mt-2">Showing dates for individuals. Tap VAT, APIT, SSCL… if you run a business or employ staff.</p>}

      {view === 'month' ? (
        <div className="grid lg:grid-cols-[1fr_340px] gap-4 items-start">
          <div className="card p-2 sm:p-3">
            <div className="grid grid-cols-7 text-center text-[11px] font-semibold text-gray-400 mb-1">{WD.map(d => <div key={d}>{d}</div>)}</div>
            <div className="grid grid-cols-7 gap-1">
              {cells.map((d, i) => {
                if (!d) return <div key={i} />;
                const key = iso(ym.y, ym.m, d); const ev = byDay[key] ?? [];
                const isSel = key === sel, isToday = key === today, past = key < today;
                return (
                  <button key={i} onClick={() => setSel(key)}
                    className={`min-h-[56px] sm:min-h-[76px] rounded-xl p-1 text-left flex flex-col border transition ${isSel ? 'border-primary-500 bg-primary-50' : 'border-transparent hover:bg-gray-50'} ${past ? 'opacity-60' : ''}`}>
                    <span className={`text-xs font-bold w-6 h-6 rounded-full flex items-center justify-center ${isToday ? 'bg-primary-600 text-white' : 'text-gray-700'}`}>{d}</span>
                    <div className="flex flex-wrap gap-0.5 mt-auto">
                      {[...new Set(ev.map(e => e.cat))].slice(0, 4).map(c => <span key={c} className={`w-1.5 h-1.5 sm:w-auto sm:h-auto sm:px-1 rounded-full sm:rounded text-[9px] font-bold text-white ${CATS[c].color}`}><span className="hidden sm:inline">{CATS[c].short}</span></span>)}
                    </div>
                  </button>
                );
              })}
            </div>
          </div>
          <div className="space-y-2 lg:sticky lg:top-4">
            <div className="font-bold text-primary-800">{fmtDay(sel, { weekday: 'long', day: 'numeric', month: 'long' })} <span className="text-xs font-semibold text-gray-400">· {dueLabel(sel)}</span></div>
            {selEvents.length === 0 ? <div className="card p-5 text-sm text-gray-400 text-center">No due dates on this day.</div> : selEvents.map(e => <EventRow key={e.id} e={e} />)}
            {canRemind && <button onClick={() => setAdding(true)} className="w-full border-2 border-dashed border-gray-200 rounded-xl py-2 text-sm font-semibold text-primary-600 hover:bg-primary-50/40 flex items-center justify-center gap-1"><Plus size={14} /> Reminder on this day</button>}
          </div>
        </div>
      ) : (
        <div className="space-y-4">
          {Object.keys(byDay).length === 0 ? <div className="card p-8 text-center text-gray-400 text-sm">Nothing this month.</div> :
            Object.entries(byDay).map(([day, ev]) => (
              <div key={day} className="flex gap-3">
                <div className={`w-14 flex-shrink-0 text-center rounded-xl py-2 h-fit ${day === today ? 'bg-primary-600 text-white' : daysUntil(day) < 0 ? 'bg-gray-100 text-gray-400' : 'bg-white border border-gray-200 text-gray-800'}`}>
                  <div className="text-[10px] font-semibold uppercase">{fmtDay(day, { weekday: 'short' })}</div>
                  <div className="text-xl font-black leading-tight">{fmtDay(day, { day: 'numeric' })}</div>
                </div>
                <div className="flex-1 space-y-2">{ev.map(e => <EventRow key={e.id} e={e} />)}</div>
              </div>
            ))}
        </div>
      )}

      <p className="text-[11px] text-gray-500 flex gap-1.5"><Info size={12} className="flex-shrink-0 mt-0.5" />
        Dates follow the Inland Revenue Department Tax Calendar 2026 (ird.gov.lk → Publications → Tax Calendar); later years use the same pattern. Always confirm with IRD if a date falls on a holiday.</p>

      {adding && <AddReminder role={role} clients={clients} myClientId={myClient} defaultDate={sel >= today ? sel : today} onClose={() => setAdding(false)} onSaved={() => { setAdding(false); loadRems(); }} />}
    </div>
  );
}
