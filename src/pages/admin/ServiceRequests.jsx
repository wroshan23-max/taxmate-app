import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import toast from 'react-hot-toast';
import { CalendarCheck, Loader2, MessageCircle, Phone, Save, ExternalLink, Search } from 'lucide-react';
import { supabase, fmtDate } from '../../lib/supabase';
import { cardFor, TIMES, CONTACTS, SR_STATUS } from '../../lib/services';
import { waNumber } from '../../lib/share';

const toLocalInput = (iso) => (iso ? new Date(new Date(iso).getTime() - new Date().getTimezoneOffset() * 60000).toISOString().slice(0, 16) : '');

export default function ServiceRequests() {
  const [rows, setRows] = useState(null);
  const [filter, setFilter] = useState('open');
  const [q, setQ] = useState('');
  const [edit, setEdit] = useState({});   // id -> { status, scheduled, note }
  const [busy, setBusy] = useState(null);

  const load = async () => {
    const { data, error } = await supabase.from('service_requests').select('*, clients(full_name, mobile, email)').order('created_at', { ascending: false }).limit(300);
    if (error) toast.error(error.message);
    setRows(data ?? []);
  };
  useEffect(() => { load(); }, []);

  const isOpen = (s) => !['done', 'cancelled'].includes(s);
  const shown = (rows ?? []).filter(r => (filter === 'open' ? isOpen(r.status) : filter === 'all' || r.status === filter)
    && (!q || `${r.clients?.full_name} ${r.service} ${r.details ?? ''}`.toLowerCase().includes(q.toLowerCase())));
  const get = (r) => edit[r.id] ?? { status: r.status, scheduled: toLocalInput(r.scheduled_at), note: r.admin_note ?? '' };
  const set = (r, patch) => setEdit(e => ({ ...e, [r.id]: { ...get(r), ...patch } }));
  const save = async (r) => {
    const v = get(r);
    setBusy(r.id);
    const status = v.scheduled && v.status === 'new' ? 'scheduled' : v.status;
    const { error } = await supabase.from('service_requests').update({
      status, scheduled_at: v.scheduled ? new Date(v.scheduled).toISOString() : null, admin_note: v.note.trim() || null, updated_at: new Date().toISOString(),
    }).eq('id', r.id);
    setBusy(null);
    if (error) return toast.error(error.message);
    toast.success('Saved — the client sees the update in their portal');
    setEdit(e => { const c = { ...e }; delete c[r.id]; return c; });
    load();
  };
  const waText = (r) => `Hi ${r.clients?.full_name?.split(' ')[0] ?? ''}, this is TaxMate about your request for "${r.service}".`;
  const count = (k) => (rows ?? []).filter(r => (k === 'open' ? isOpen(r.status) : k === 'all' || r.status === k)).length;

  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-2xl font-bold text-primary-800 flex items-center gap-2"><CalendarCheck size={24} /> Service Requests</h1>
        <p className="text-sm text-gray-500">Services and appointments clients booked from their portal</p>
      </div>
      <div className="flex items-center gap-2 flex-wrap">
        {[['open', 'Open'], ...Object.entries(SR_STATUS).map(([k, s]) => [k, s.label]), ['all', 'All']].map(([k, l]) => (
          <button key={k} onClick={() => setFilter(k)} className={`px-3 py-1.5 rounded-full text-xs font-semibold ${filter === k ? 'bg-primary-700 text-white' : 'bg-white border border-gray-200 text-gray-600 hover:border-primary-300'}`}>{l} <span className="opacity-60">{count(k)}</span></button>
        ))}
        <div className="relative ml-auto"><Search size={14} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-gray-400" />
          <input className="input pl-8 py-1.5 text-sm w-52" placeholder="Search" value={q} onChange={e => setQ(e.target.value)} /></div>
      </div>

      {rows === null ? <div className="card p-10 text-center text-gray-400"><Loader2 className="animate-spin mx-auto" /></div>
        : shown.length === 0 ? <div className="card p-10 text-center text-gray-400 text-sm">No requests here.</div> : (
        <div className="grid lg:grid-cols-2 gap-4">
          {shown.map(r => {
            const v = get(r);
            const dirty = !!edit[r.id];
            return (
              <div key={r.id} className={`card overflow-hidden ${r.status === 'new' ? 'ring-2 ring-gold-500/50' : ''}`}>
                <div className="px-4 py-3 flex items-start gap-3 border-b border-gray-50">
                  <div className="text-3xl">{cardFor(r.service).emoji}</div>
                  <div className="flex-1 min-w-0">
                    <div className="font-bold text-gray-800">{r.service}</div>
                    <Link to={`/admin/clients/${r.client_id}`} className="text-sm text-primary-700 hover:underline inline-flex items-center gap-1">{r.clients?.full_name} <ExternalLink size={11} /></Link>
                    <div className="text-[11px] text-gray-500">Requested {fmtDate(r.created_at)} · prefers {r.preferred_date ? fmtDate(r.preferred_date) : 'any day'}, {TIMES[r.preferred_time ?? 'any']} · {CONTACTS[r.contact_method]?.join(' ')}</div>
                  </div>
                  <span className={`text-[11px] font-semibold px-2 py-0.5 rounded-md ${SR_STATUS[r.status]?.cls}`}>{SR_STATUS[r.status]?.label}</span>
                </div>
                {r.details && <div className="px-4 py-2 text-sm text-gray-700 bg-gray-50/60 whitespace-pre-wrap">“{r.details}”</div>}
                <div className="p-4 space-y-2">
                  <div className="grid grid-cols-2 gap-2">
                    <select className="input text-sm" value={v.status} onChange={e => set(r, { status: e.target.value })}>
                      {Object.entries(SR_STATUS).map(([k, s]) => <option key={k} value={k}>{s.label}</option>)}
                    </select>
                    <input type="datetime-local" className="input text-sm" value={v.scheduled} onChange={e => set(r, { scheduled: e.target.value })} title="Appointment" />
                  </div>
                  <input className="input text-sm" maxLength={1000} placeholder="Note for the client (e.g. Please bring your T-10 and bank statements)" value={v.note} onChange={e => set(r, { note: e.target.value })} />
                  <div className="flex items-center gap-2 flex-wrap">
                    {r.clients?.mobile && <a href={`https://wa.me/${waNumber(r.clients.mobile)}?text=${encodeURIComponent(waText(r))}`} target="_blank" rel="noreferrer" className="btn-secondary text-xs py-1"><MessageCircle size={13} /> WhatsApp</a>}
                    {r.clients?.mobile && <a href={`tel:${r.clients.mobile}`} className="btn-secondary text-xs py-1"><Phone size={13} /> Call</a>}
                    <button onClick={() => save(r)} disabled={!dirty || busy === r.id} className="ml-auto btn-primary text-xs py-1.5">{busy === r.id ? <Loader2 size={13} className="animate-spin" /> : <Save size={13} />} Save</button>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
