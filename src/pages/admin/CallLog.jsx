// V66 — Call Log: record calls / enquiries, follow-ups, call back / WhatsApp, link or convert to a client, reports & Excel
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import toast from 'react-hot-toast';
import { PhoneCall, Plus, Search, Phone, MessageCircle, Pencil, Trash2, UserPlus, UserCheck, CalendarClock, CheckCircle2, Loader2, X, FileSpreadsheet,
  BarChart3, ListChecks, History, AlertTriangle, ChevronDown } from 'lucide-react';
import { Modal } from '../../components/vat/ui';
import FloatingMenu from '../../components/FloatingMenu';
import {
  SERVICES, SERVICE, SOURCES, SOURCE, CHANNELS, STATUS, slDate, slTime, slDay, fromLocal, toLocal, followUpAt, dueState, telLink, waLink, waMessage, WA_KINDS,
  loadCalls, loadOpenFollowUps, saveCall, patchCall, deleteCall, matchPhone, callToClient, callStats, exportCalls,
} from '../../lib/callLog';

const PERIODS = [['today', 'Today'], ['7d', 'Last 7 days'], ['month', 'This month'], ['last_month', 'Last month'], ['90d', 'Last 3 months'], ['year', 'This year'], ['all', 'All time']];
function periodRange(p) {
  const today = slDate();
  const d0 = (iso) => new Date(`${iso}T00:00:00+05:30`).toISOString();
  const addDays = (iso, n) => { const x = new Date(`${iso}T00:00:00Z`); x.setUTCDate(x.getUTCDate() + n); return x.toISOString().slice(0, 10); };
  const [y, m] = today.split('-').map(Number);
  if (p === 'today') return { from: d0(today) };
  if (p === '7d') return { from: d0(addDays(today, -6)) };
  if (p === 'month') return { from: d0(`${today.slice(0, 7)}-01`) };
  if (p === 'last_month') { const lm = m === 1 ? `${y - 1}-12` : `${y}-${String(m - 1).padStart(2, '0')}`; return { from: d0(`${lm}-01`), to: d0(`${today.slice(0, 7)}-01`) }; }
  if (p === '90d') return { from: d0(addDays(today, -89)) };
  if (p === 'year') return { from: d0(`${y}-01-01`) };
  return {};
}
const rs = (v) => `Rs. ${Math.round(Number(v) || 0).toLocaleString('en-LK')}`;
const EMPTY = () => ({ phone: '', name: '', channel: 'incoming', services: [], source: '', notes: '', status: 'new', follow_up_at: null, quoted_fee: '', email: '', location: '', called_at: null, client_id: null });

function Chip({ on, onClick, children, tone = 'primary' }) {
  const t = on ? (tone === 'amber' ? 'bg-amber-500 border-amber-500 text-white' : 'bg-primary-700 border-primary-700 text-white') : 'bg-white border-gray-200 text-gray-700 hover:border-primary-300';
  return <button type="button" onClick={onClick} aria-pressed={on} className={`rounded-full border px-2.5 py-1 text-xs font-semibold transition ${t}`}>{children}</button>;
}

// ─── Add / edit a call ────────────────────────────────────
function CallForm({ initial, onClose, onSaved }) {
  const [f, setF] = useState(() => ({ ...EMPTY(), ...initial, quoted_fee: initial?.quoted_fee ?? '' }));
  const [match, setMatch] = useState(null);
  const [busy, setBusy] = useState(false);
  const [more, setMore] = useState(!!(initial?.email || initial?.location || initial?.id));
  const phoneRef = useRef(null);
  const set = (p) => setF((x) => ({ ...x, ...p }));
  useEffect(() => { if (!initial?.id) setTimeout(() => phoneRef.current?.focus(), 50); }, [initial?.id]);

  // look up the number (debounced)
  useEffect(() => {
    const digits = f.phone.replace(/\D/g, '');
    if (digits.length < 9) { setMatch(null); return undefined; }
    const t = setTimeout(() => matchPhone(f.phone, f.id).then((m) => {
      setMatch(m);
      const one = m?.clients?.filter((c) => !c.archived) || [];
      setF((x) => {
        const p = {};
        if (!x.id && !x.client_id && one.length === 1 && one[0].via === 'client') { p.client_id = one[0].id; if (!x.name) p.name = one[0].full_name; }
        if (!x.name && !one.length && m?.calls?.[0]?.name) p.name = m.calls[0].name;
        return Object.keys(p).length ? { ...x, ...p } : x;
      });
    }).catch(() => setMatch(null)), 350);
    return () => clearTimeout(t);
  }, [f.phone, f.id]);

  const linked = match?.clients?.find((c) => c.id === f.client_id) || (f.client_id && f.clients ? { id: f.client_id, full_name: f.clients.full_name, client_no: f.clients.client_no } : null);
  const toggleSvc = (k) => set({ services: f.services.includes(k) ? f.services.filter((x) => x !== k) : [...f.services, k] });
  const pickFollow = (kind) => set({ status: 'follow_up', follow_up_at: followUpAt(kind) });

  const save = async (after) => {
    if (f.phone.replace(/\D/g, '').length < 7) { toast.error('Type the phone number'); phoneRef.current?.focus(); return; }
    if (f.status === 'follow_up' && !f.follow_up_at) { toast.error('Choose when to follow up'); return; }
    setBusy(true);
    try {
      const row = await saveCall({ ...f, quoted_fee: f.quoted_fee === '' ? null : Number(f.quoted_fee), called_at: f.called_at || (f.id ? undefined : new Date().toISOString()) });
      toast.success(f.id ? 'Call updated' : 'Call saved');
      onSaved(row, after);
    } catch (e) { toast.error(e.message); } finally { setBusy(false); }
  };

  const footer = (
    <>
      <button type="button" className="btn-secondary border text-sm" onClick={onClose}>Cancel</button>
      {!f.id && <button type="button" disabled={busy} className="btn-secondary border text-sm" onClick={() => save('wa')}><MessageCircle size={15} className="text-green-600" /> Save &amp; WhatsApp</button>}
      <button type="button" disabled={busy} className="btn-primary text-sm" onClick={() => save()}>{busy ? <Loader2 size={15} className="animate-spin" /> : <CheckCircle2 size={15} />} Save</button>
    </>
  );

  return (
    <Modal title={f.id ? 'Edit call' : 'Log a call'} onClose={onClose} footer={footer}>
      <div className="space-y-4">
        <div className="flex flex-wrap gap-1.5">
          {Object.entries(CHANNELS).filter(([k]) => k !== 'web' || f.channel === 'web').map(([k, [e, l]]) => <Chip key={k} on={f.channel === k} onClick={() => set({ channel: k })}>{e} {l}</Chip>)}
        </div>
        <div className="grid gap-3 sm:grid-cols-2">
          <label className="block text-xs font-semibold text-gray-600">Phone number *
            <input ref={phoneRef} type="tel" inputMode="tel" autoComplete="off" className="input mt-1 text-base font-semibold tracking-wide" placeholder="07X XXX XXXX" value={f.phone} onChange={(e) => set({ phone: e.target.value.slice(0, 30) })} />
          </label>
          <label className="block text-xs font-semibold text-gray-600">Name
            <input className="input mt-1" maxLength={120} placeholder="Caller's name" value={f.name || ''} onChange={(e) => set({ name: e.target.value })} />
          </label>
        </div>

        {match && (match.clients.length > 0 || match.count > 0) && (
          <div className="space-y-2 rounded-xl border border-primary-100 bg-primary-50/50 p-3 text-sm">
            {match.clients.map((c) => (
              <div key={c.id} className="flex flex-wrap items-center gap-2">
                <UserCheck size={15} className="text-green-700" />
                <span className="font-semibold text-gray-800">{c.full_name}</span>
                {c.client_no && <span className="rounded bg-white px-1.5 font-mono text-[11px] text-gray-600">{c.client_no}</span>}
                <span className="text-xs text-gray-500">{c.via === 'contact' ? `contact person${c.contact_name ? ` (${c.contact_name})` : ''}` : 'existing client'}{c.archived ? ' · archived' : ''}</span>
                {f.client_id === c.id
                  ? <button type="button" className="ml-auto text-xs font-semibold text-gray-500 underline" onClick={() => set({ client_id: null })}>Unlink</button>
                  : <button type="button" className="ml-auto rounded-lg bg-white px-2 py-0.5 text-xs font-semibold text-primary-700 shadow-sm" onClick={() => set({ client_id: c.id, name: f.name || c.full_name })}>Link this call</button>}
              </div>
            ))}
            {match.count > 0 && (
              <div className="text-xs text-gray-600">
                <History size={13} className="-mt-0.5 mr-1 inline" />Called <b>{match.count}</b> time{match.count > 1 ? 's' : ''} before
                {match.calls.slice(0, 2).map((c) => <div key={c.id} className="ml-4 truncate">· {slDay(c.called_at)} — {STATUS[c.status]?.label}{c.services?.length ? ` · ${c.services.map((k) => SERVICE[k] || k).join(', ')}` : ''}{c.notes ? ` · ${c.notes}` : ''}</div>)}
              </div>
            )}
          </div>
        )}
        {linked && <div className="text-xs font-semibold text-green-700">✓ Linked to client {linked.full_name}</div>}

        <div>
          <div className="mb-1 text-xs font-semibold text-gray-600">What do they need?</div>
          <div className="flex flex-wrap gap-1.5">{SERVICES.map(([k, l]) => <Chip key={k} on={f.services.includes(k)} onClick={() => toggleSvc(k)}>{l}</Chip>)}</div>
        </div>

        <label className="block text-xs font-semibold text-gray-600">Notes
          <textarea className="input mt-1 resize-y" rows={3} maxLength={3000} placeholder="e.g. Salary + rent income, needs Y/A 2025/26 return. Asked about fees. Will send T-10." value={f.notes || ''} onChange={(e) => set({ notes: e.target.value })} />
        </label>

        <div>
          <div className="mb-1 text-xs font-semibold text-gray-600">Status</div>
          <div className="flex flex-wrap gap-1.5">
            {Object.entries(STATUS).map(([k, s]) => <Chip key={k} tone={k === 'follow_up' ? 'amber' : 'primary'} on={f.status === k} onClick={() => set({ status: k, ...(k === 'follow_up' && !f.follow_up_at ? { follow_up_at: followUpAt('tomorrow') } : {}) })}>{s.label}</Chip>)}
          </div>
        </div>

        {f.status === 'follow_up' && (
          <div className="rounded-xl border border-amber-200 bg-amber-50 p-3">
            <div className="mb-1.5 flex items-center gap-1 text-xs font-semibold text-amber-900"><CalendarClock size={14} /> Call back / follow up</div>
            <div className="flex flex-wrap gap-1.5">
              {[['later', 'In 3 hours'], ['tomorrow', 'Tomorrow 10 AM'], ['3days', 'In 3 days'], ['week', 'Next week']].map(([k, l]) => <Chip key={k} tone="amber" on={false} onClick={() => pickFollow(k)}>{l}</Chip>)}
            </div>
            <input type="datetime-local" className="input mt-2 w-auto" value={toLocal(f.follow_up_at)} onChange={(e) => set({ follow_up_at: fromLocal(e.target.value) })} aria-label="Follow-up date and time" />
            {f.follow_up_at && <div className="mt-1 text-xs text-amber-900">{slDay(f.follow_up_at)}, {slTime(f.follow_up_at)}</div>}
          </div>
        )}

        <div className="grid gap-3 sm:grid-cols-2">
          <label className="block text-xs font-semibold text-gray-600">How did they find us?
            <select className="input mt-1" value={f.source || ''} onChange={(e) => set({ source: e.target.value })}>
              <option value="">—</option>{SOURCES.map(([k, l]) => <option key={k} value={k}>{l}</option>)}
            </select>
          </label>
          <label className="block text-xs font-semibold text-gray-600">Fee quoted (Rs.)
            <input className="input mt-1" inputMode="numeric" placeholder="optional" value={f.quoted_fee} onChange={(e) => set({ quoted_fee: e.target.value.replace(/[^\d.]/g, '').slice(0, 12) })} />
          </label>
        </div>

        <button type="button" className="text-xs font-semibold text-primary-700" onClick={() => setMore((v) => !v)}>{more ? '− Fewer details' : '+ More details (email, town, date & time of the call)'}</button>
        {more && (
          <div className="grid gap-3 sm:grid-cols-3">
            <label className="block text-xs font-semibold text-gray-600">Email<input type="email" className="input mt-1" maxLength={160} value={f.email || ''} onChange={(e) => set({ email: e.target.value })} /></label>
            <label className="block text-xs font-semibold text-gray-600">Town / area<input className="input mt-1" maxLength={120} value={f.location || ''} onChange={(e) => set({ location: e.target.value })} /></label>
            <label className="block text-xs font-semibold text-gray-600">Call date &amp; time<input type="datetime-local" className="input mt-1" value={toLocal(f.called_at || new Date().toISOString())} onChange={(e) => set({ called_at: fromLocal(e.target.value) })} /></label>
          </div>
        )}
      </div>
    </Modal>
  );
}

// ─── Link to an existing client / make a new client ───────
function ConvertDialog({ call, onClose, onDone }) {
  const [match, setMatch] = useState(null);
  const [name, setName] = useState(call.name || '');
  const [busy, setBusy] = useState(false);
  const navigate = useNavigate();
  useEffect(() => { matchPhone(call.phone, call.id).then(setMatch).catch(() => setMatch({ clients: [] })); }, [call.phone, call.id]);
  const go = async (clientId) => {
    setBusy(true);
    try {
      const cid = await callToClient(call.id, clientId, name.trim());
      toast.success(clientId ? 'Call linked to the client' : 'New client created');
      onDone();
      if (!clientId) navigate(`/admin/clients/${cid}`);
    } catch (e) { toast.error(e.message); } finally { setBusy(false); }
  };
  return (
    <Modal title="Make this caller a client" onClose={onClose}>
      {!match ? <div className="py-6 text-center"><Loader2 className="mx-auto animate-spin text-gray-400" /></div> : (
        <div className="space-y-4 text-sm">
          {match.clients.length > 0 && (
            <div className="space-y-2">
              <div className="text-xs font-semibold text-gray-600">This number already belongs to:</div>
              {match.clients.map((c) => (
                <div key={c.id} className="flex flex-wrap items-center gap-2 rounded-lg border p-2">
                  <UserCheck size={15} className="text-green-700" /><b>{c.full_name}</b>{c.client_no && <span className="font-mono text-xs text-gray-500">{c.client_no}</span>}
                  <span className="text-xs text-gray-500">{c.via === 'contact' ? 'contact person' : 'client'}</span>
                  <button type="button" disabled={busy} className="btn-secondary ml-auto border py-1 text-xs" onClick={() => go(c.id)}>Link to this client</button>
                </div>
              ))}
            </div>
          )}
          <div className="space-y-2 rounded-xl border border-green-200 bg-green-50/60 p-3">
            <div className="text-xs font-semibold text-green-900">Create a new client</div>
            <label className="block text-xs font-semibold text-gray-600">Full name (as in NIC)
              <input className="input mt-1" maxLength={120} value={name} onChange={(e) => setName(e.target.value)} />
            </label>
            <div className="text-xs text-gray-500">Mobile {call.phone}{call.email ? ` · ${call.email}` : ''} will be saved. Add TIN, NIC and the rest on the client page.</div>
            <button type="button" disabled={busy || !name.trim()} className="btn-primary text-sm" onClick={() => go(null)}>{busy ? <Loader2 size={15} className="animate-spin" /> : <UserPlus size={15} />} Create client &amp; open</button>
          </div>
        </div>
      )}
    </Modal>
  );
}

function WaButton({ call }) {
  const [open, setOpen] = useState(false);
  const ref = useRef(null);
  const close = useCallback(() => setOpen(false), []);
  return (
    <>
      <button ref={ref} type="button" onClick={() => setOpen((o) => !o)} className="inline-flex items-center gap-1 rounded-lg bg-green-600 px-2.5 py-1 text-xs font-semibold text-white hover:bg-green-700" aria-haspopup="menu" aria-expanded={open}>
        <MessageCircle size={13} /> WhatsApp <ChevronDown size={12} />
      </button>
      {open && (
        <FloatingMenu anchorRef={ref} onClose={close} align="right" width={240}>
          <a href={waLink(call.phone)} target="_blank" rel="noreferrer" onClick={close} className="block px-3 py-2 text-sm hover:bg-gray-50">Open chat (no message)</a>
          {WA_KINDS.map(([k, l]) => <a key={k} href={waLink(call.phone, waMessage(k, call))} target="_blank" rel="noreferrer" onClick={close} className="block px-3 py-2 text-sm hover:bg-gray-50">{l}</a>)}
        </FloatingMenu>
      )}
    </>
  );
}

function CallCard({ c, onEdit, onConvert, onPatch, onDelete }) {
  const due = dueState(c);
  const [ch, chLabel] = CHANNELS[c.channel] || ['📞', c.channel];
  return (
    <div className={`card p-3 sm:p-4 ${due === 'overdue' ? 'border-red-200 bg-red-50/30' : due === 'today' ? 'border-amber-200 bg-amber-50/30' : ''}`}>
      <div className="flex flex-wrap items-start gap-2">
        <div className="text-2xl leading-none" title={chLabel}>{ch}</div>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5">
            <span className="font-bold text-gray-900">{c.name || 'Unknown caller'}</span>
            <a href={telLink(c.phone)} className="font-mono text-sm text-primary-700 hover:underline">{c.phone}</a>
            {c.clients
              ? <Link to={`/admin/clients/${c.client_id}`} className="rounded-full bg-green-100 px-2 py-0.5 text-[11px] font-semibold text-green-800 hover:underline">✓ {c.clients.client_no || 'Client'}{c.clients.full_name !== c.name ? ` · ${c.clients.full_name}` : ''}</Link>
              : <span className="rounded-full bg-blue-50 px-2 py-0.5 text-[11px] font-semibold text-blue-700">New caller</span>}
          </div>
          <div className="text-xs text-gray-500">{slDay(c.called_at)}, {slTime(c.called_at)} · {chLabel}{c.source ? ` · via ${SOURCE[c.source] || c.source}` : ''}{c.location ? ` · ${c.location}` : ''}{c.quoted_fee != null ? ` · quoted ${rs(c.quoted_fee)}` : ''}</div>
          {c.services?.length > 0 && <div className="mt-1 flex flex-wrap gap-1">{c.services.map((k) => <span key={k} className="rounded bg-primary-50 px-1.5 py-0.5 text-[11px] font-medium text-primary-800">{SERVICE[k] || k}</span>)}</div>}
          {c.notes && <p className="mt-1 whitespace-pre-line text-sm text-gray-700">{c.notes}</p>}
          {c.status === 'follow_up' && c.follow_up_at && (
            <div className={`mt-1 inline-flex items-center gap-1 rounded-lg px-2 py-0.5 text-xs font-semibold ${due === 'overdue' ? 'bg-red-100 text-red-800' : due === 'today' ? 'bg-amber-100 text-amber-900' : 'bg-gray-100 text-gray-700'}`}>
              <CalendarClock size={12} /> {due === 'overdue' ? 'Overdue — ' : ''}Follow up {slDay(c.follow_up_at)}, {slTime(c.follow_up_at)}
            </div>
          )}
        </div>
        <span className={`rounded-full px-2 py-0.5 text-[11px] font-semibold ${STATUS[c.status]?.cls}`}>{STATUS[c.status]?.label}</span>
      </div>
      <div className="mt-2 flex flex-wrap items-center gap-1.5 border-t border-gray-100 pt-2">
        <a href={telLink(c.phone)} className="inline-flex items-center gap-1 rounded-lg border px-2.5 py-1 text-xs font-semibold text-gray-700 hover:bg-gray-50"><Phone size={13} /> Call</a>
        <WaButton call={c} />
        {c.status === 'follow_up' && <>
          <button type="button" onClick={() => onPatch(c, { status: 'done' })} className="inline-flex items-center gap-1 rounded-lg border border-green-200 px-2.5 py-1 text-xs font-semibold text-green-700 hover:bg-green-50"><CheckCircle2 size={13} /> Followed up</button>
          <button type="button" onClick={() => onPatch(c, { follow_up_at: followUpAt('tomorrow') })} className="rounded-lg border px-2.5 py-1 text-xs text-gray-600 hover:bg-gray-50">Tomorrow</button>
        </>}
        {!c.client_id && <button type="button" onClick={() => onConvert(c)} className="inline-flex items-center gap-1 rounded-lg border border-primary-200 px-2.5 py-1 text-xs font-semibold text-primary-700 hover:bg-primary-50"><UserPlus size={13} /> Make client</button>}
        <button type="button" onClick={() => onEdit(c)} className="ml-auto inline-flex items-center gap-1 rounded-lg px-2 py-1 text-xs text-gray-600 hover:bg-gray-100"><Pencil size={13} /> Edit</button>
        <button type="button" onClick={() => onDelete(c)} className="rounded-lg px-2 py-1 text-gray-400 hover:bg-red-50 hover:text-red-600" aria-label="Delete call"><Trash2 size={13} /></button>
      </div>
    </div>
  );
}

function Bar({ label, value, max, sub }) {
  return (
    <div className="text-xs">
      <div className="flex justify-between gap-2"><span className="truncate text-gray-700">{label}</span><span className="tabular-nums text-gray-500">{value}{sub ? ` · ${sub}` : ''}</span></div>
      <div className="h-1.5 rounded bg-gray-100"><div className="h-1.5 rounded bg-primary-700" style={{ width: `${max ? (value / max) * 100 : 0}%` }} /></div>
    </div>
  );
}

function Reports({ rows, label }) {
  const s = useMemo(() => callStats(rows), [rows]);
  const top = (o, names) => Object.entries(o).sort((a, b) => b[1] - a[1]).map(([k, v]) => ({ k, label: names?.[k] || (k === 'unknown' ? 'Not recorded' : k), v }));
  const svc = top(s.services, SERVICE), src = top(s.sources, SOURCE);
  const dayKeys = Object.keys(s.days).sort().slice(-31);
  const dmax = Math.max(1, ...dayKeys.map((k) => s.days[k]));
  const hours = Array.from({ length: 16 }, (_, i) => i + 6).map((h) => ({ h, v: s.hours[h] || 0 }));
  const hmax = Math.max(1, ...hours.map((x) => x.v));
  const wonBy = (key) => rows.filter((r) => r.status === 'won' && (key.startsWith('src:') ? (r.source || 'unknown') === key.slice(4) : (r.services || []).includes(key))).length;
  const K = ({ l, v, sub, tone = 'text-gray-900' }) => <div className="card p-3"><div className="text-[11px] font-semibold uppercase tracking-wide text-gray-500">{l}</div><div className={`text-xl font-black ${tone}`}>{v}</div>{sub && <div className="text-[11px] text-gray-500">{sub}</div>}</div>;
  if (!rows.length) return <div className="card p-8 text-center text-sm text-gray-500">No calls in {label.toLowerCase()}.</div>;
  return (
    <div className="space-y-3">
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <K l="Calls / enquiries" v={s.total} sub={`${s.newCallers} new callers · ${s.missed} missed`} />
        <K l="Became clients" v={s.won} tone="text-green-700" sub={s.conversion == null ? 'no decisions yet' : `${s.conversion}% of decided enquiries`} />
        <K l="Fees quoted — won" v={rs(s.quoted)} tone="text-green-700" sub={`${s.lost} not interested`} />
        <K l="Open pipeline" v={rs(s.pipeline)} tone="text-amber-700" sub={`${(s.status.new || 0) + (s.status.follow_up || 0)} enquiries still open`} />
      </div>
      <div className="grid gap-3 lg:grid-cols-2">
        <div className="card p-4">
          <div className="mb-2 text-sm font-bold text-primary-800">Calls per day</div>
          <div className="flex h-32 items-end gap-0.5">
            {dayKeys.map((k) => <div key={k} className="flex-1 rounded-t bg-primary-700" style={{ height: `${(s.days[k] / dmax) * 100}%`, minHeight: 2 }} title={`${k}: ${s.days[k]}`} />)}
          </div>
          <div className="mt-1 flex justify-between text-[10px] text-gray-400"><span>{dayKeys[0]}</span><span>{dayKeys[dayKeys.length - 1]}</span></div>
        </div>
        <div className="card p-4">
          <div className="mb-2 text-sm font-bold text-primary-800">Busiest hours</div>
          <div className="flex h-32 items-end gap-1">
            {hours.map((x) => <div key={x.h} className="flex flex-1 flex-col items-center justify-end gap-0.5"><div className="w-full rounded-t bg-gold-500" style={{ height: `${(x.v / hmax) * 100}%`, minHeight: x.v ? 2 : 0 }} title={`${x.h}:00 — ${x.v}`} /><span className="text-[9px] text-gray-400">{x.h > 12 ? x.h - 12 : x.h}</span></div>)}
          </div>
        </div>
        <div className="card space-y-1.5 p-4">
          <div className="mb-1 text-sm font-bold text-primary-800">Services asked about</div>
          {svc.length ? svc.map((x) => <Bar key={x.k} label={x.label} value={x.v} max={svc[0].v} sub={`${wonBy(x.k)} won`} />) : <div className="text-xs text-gray-400">Tick services when you log calls.</div>}
        </div>
        <div className="card space-y-1.5 p-4">
          <div className="mb-1 text-sm font-bold text-primary-800">How they found us</div>
          {src.map((x) => <Bar key={x.k} label={x.label} value={x.v} max={src[0].v} sub={`${wonBy(`src:${x.k}`)} won`} />)}
        </div>
      </div>
    </div>
  );
}

// ─── Page ─────────────────────────────────────────────────
export default function CallLog() {
  const [sp, setSp] = useSearchParams();
  const tab = sp.get('tab') || 'today';
  const [period, setPeriod] = useState('month');
  const [rows, setRows] = useState(null);
  const [follow, setFollow] = useState([]);
  const [err, setErr] = useState(null);
  const [q, setQ] = useState('');
  const [fStatus, setFStatus] = useState('');
  const [fSvc, setFSvc] = useState('');
  const [form, setForm] = useState(sp.get('new') ? {} : null);
  const [conv, setConv] = useState(null);

  const range = useMemo(() => periodRange(tab === 'today' ? 'today' : period), [tab, period]);
  const load = useCallback(() => {
    setErr(null);
    Promise.all([loadCalls(range), loadOpenFollowUps()]).then(([r, f]) => { setRows(r); setFollow(f); })
      .catch((e) => setErr(/call_logs|relation|schema cache/i.test(e.message) ? 'The Call Log database is not set up yet — run the V66 migration in Supabase.' : e.message));
  }, [range]);
  useEffect(() => { load(); }, [load]);
  useEffect(() => { if (sp.get('new')) { const n = new URLSearchParams(sp); n.delete('new'); setSp(n, { replace: true }); } }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const setTab = (t) => { const n = new URLSearchParams(sp); n.set('tab', t); setSp(n, { replace: true }); };
  const upsert = (row) => {
    setRows((rs0) => { if (!rs0) return rs0; const i = rs0.findIndex((x) => x.id === row.id); const inRange = (!range.from || row.called_at >= range.from) && (!range.to || row.called_at < range.to); if (i >= 0) return inRange ? rs0.map((x) => (x.id === row.id ? row : x)) : rs0.filter((x) => x.id !== row.id); return inRange ? [row, ...rs0].sort((a, b) => b.called_at.localeCompare(a.called_at)) : rs0; });
    setFollow((f) => { const o = f.filter((x) => x.id !== row.id); return row.status === 'follow_up' ? [...o, row].sort((a, b) => String(a.follow_up_at).localeCompare(String(b.follow_up_at))) : o; });
  };
  const onSaved = (row, after) => { upsert(row); setForm(null); if (after === 'wa') window.open(waLink(row.phone, waMessage(row.channel === 'missed' ? 'missed' : 'thanks', row)), '_blank', 'noopener'); };
  const onPatch = async (c, patch) => { try { upsert(await patchCall(c.id, patch)); toast.success(patch.status === 'done' ? 'Marked as followed up' : 'Updated'); } catch (e) { toast.error(e.message); } };
  const onDelete = async (c) => { if (!window.confirm(`Delete this call from ${c.name || c.phone}?`)) return; try { await deleteCall(c.id); setRows((r) => r.filter((x) => x.id !== c.id)); setFollow((f) => f.filter((x) => x.id !== c.id)); toast.success('Deleted'); } catch (e) { toast.error(e.message); } };

  const now = Date.now();
  const dueNow = follow.filter((c) => ['overdue', 'today'].includes(dueState(c, now)));
  const todayRows = tab === 'today' ? rows || [] : (rows || []).filter((r) => slDate(r.called_at) === slDate());
  const ql = q.trim().toLowerCase(), qd = q.replace(/\D/g, '');
  const list = (tab === 'follow' ? follow : rows || []).filter((r) => (!fStatus || r.status === fStatus) && (!fSvc || (r.services || []).includes(fSvc)) &&
    (!ql || [r.name, r.notes, r.location, r.email, r.clients?.full_name, r.clients?.client_no].some((x) => x?.toLowerCase().includes(ql)) || (qd.length >= 3 && r.phone.replace(/\D/g, '').includes(qd))));
  const periodLabel = tab === 'today' ? 'Today' : PERIODS.find(([k]) => k === period)?.[1];
  const card = { onEdit: (c) => setForm(c), onConvert: setConv, onPatch, onDelete };

  const TABS = [['today', 'Today', ListChecks, todayRows.length], ['follow', 'Follow-ups', CalendarClock, follow.length], ['all', 'All calls', History], ['reports', 'Reports', BarChart3]];
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-3">
        <div className="min-w-0 flex-1">
          <h1 className="flex items-center gap-2 text-2xl font-bold text-primary-800"><PhoneCall size={22} className="text-gold-500" /> Call Log</h1>
          <p className="text-sm text-gray-500">Every call and enquiry — who called, what they need, and when to call back.</p>
        </div>
        <button type="button" onClick={() => setForm({})} className="btn-primary px-4 py-2.5 text-base shadow-md"><Plus size={18} /> Log a call</button>
      </div>

      {dueNow.length > 0 && tab !== 'follow' && (
        <button type="button" onClick={() => setTab('follow')} className="flex w-full items-center gap-2 rounded-xl border border-amber-300 bg-amber-50 p-3 text-left text-sm text-amber-900">
          <AlertTriangle size={16} /> <b>{dueNow.length}</b> follow-up{dueNow.length > 1 ? 's' : ''} due today or overdue — <span className="underline">open</span>
        </button>
      )}

      <div className="flex gap-1 overflow-x-auto rounded-xl bg-gray-100 p-1">
        {TABS.map(([k, l, I, n]) => (
          <button key={k} type="button" onClick={() => setTab(k)} className={`flex shrink-0 items-center gap-1.5 rounded-lg px-3 py-1.5 text-sm font-semibold ${tab === k ? 'bg-white text-primary-800 shadow-sm' : 'text-gray-600'}`}>
            <I size={15} /> {l}{n ? <span className={`rounded-full px-1.5 text-[11px] ${k === 'follow' && dueNow.length ? 'bg-amber-500 text-white' : 'bg-gray-200 text-gray-700'}`}>{n}</span> : null}
          </button>
        ))}
      </div>

      {err ? <div className="card border-red-200 bg-red-50 p-4 text-sm text-red-800">{err}</div> : rows === null ? <div className="py-16 text-center"><Loader2 className="mx-auto animate-spin text-gray-400" /></div> : (
        <>
          {tab !== 'today' && tab !== 'follow' && (
            <div className="flex flex-wrap items-center gap-2">
              <select className="input w-auto py-1.5 text-sm" value={period} onChange={(e) => setPeriod(e.target.value)} aria-label="Period">{PERIODS.map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select>
              {tab === 'all' && <>
                <select className="input w-auto py-1.5 text-sm" value={fStatus} onChange={(e) => setFStatus(e.target.value)} aria-label="Status"><option value="">Any status</option>{Object.entries(STATUS).map(([k, s]) => <option key={k} value={k}>{s.label}</option>)}</select>
                <select className="input w-auto py-1.5 text-sm" value={fSvc} onChange={(e) => setFSvc(e.target.value)} aria-label="Service"><option value="">Any service</option>{SERVICES.map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select>
              </>}
              <button type="button" onClick={() => exportCalls(tab === 'all' ? list : rows, periodLabel)} disabled={!rows.length} className="btn-secondary ml-auto border py-1.5 text-sm"><FileSpreadsheet size={15} className="text-green-700" /> Excel</button>
            </div>
          )}
          {tab !== 'reports' && (
            <div className="relative">
              <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
              <input className="input pl-9" placeholder="Search name, phone, notes, client…" value={q} onChange={(e) => setQ(e.target.value)} />
              {q && <button type="button" onClick={() => setQ('')} className="absolute right-2 top-1/2 -translate-y-1/2 p-1 text-gray-400" aria-label="Clear"><X size={15} /></button>}
            </div>
          )}

          {tab === 'reports' ? <Reports rows={rows} label={periodLabel} /> : list.length === 0 ? (
            <div className="card p-10 text-center">
              <PhoneCall size={36} className="mx-auto text-gray-200" />
              <div className="mt-2 font-semibold text-gray-700">{tab === 'follow' ? 'No follow-ups waiting' : q || fStatus || fSvc ? 'Nothing matches' : tab === 'today' ? 'No calls logged today' : 'No calls in this period'}</div>
              {tab !== 'follow' && !q && <button type="button" onClick={() => setForm({})} className="btn-primary mt-3 text-sm"><Plus size={15} /> Log a call</button>}
            </div>
          ) : (
            <div className="space-y-2">
              {tab === 'follow'
                ? [['overdue', 'Overdue'], ['today', 'Today'], ['upcoming', 'Coming up']].map(([k, l]) => {
                  const g = list.filter((c) => (dueState(c, now) || 'upcoming') === k);
                  return g.length ? <div key={k} className="space-y-2"><div className={`pt-1 text-xs font-bold uppercase tracking-wide ${k === 'overdue' ? 'text-red-700' : k === 'today' ? 'text-amber-700' : 'text-gray-500'}`}>{l} · {g.length}</div>{g.map((c) => <CallCard key={c.id} c={c} {...card} />)}</div> : null;
                })
                : list.map((c) => <CallCard key={c.id} c={c} {...card} />)}
              {tab === 'all' && list.length >= 3000 && <div className="text-center text-xs text-gray-500">Showing the latest 3,000 — choose a shorter period.</div>}
            </div>
          )}
        </>
      )}

      {form && <CallForm initial={form} onClose={() => setForm(null)} onSaved={onSaved} />}
      {conv && <ConvertDialog call={conv} onClose={() => setConv(null)} onDone={() => { setConv(null); load(); }} />}
    </div>
  );
}
