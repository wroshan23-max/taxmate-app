import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { Users, UserCheck, Activity as ActivityIcon, Wifi, RefreshCw, ShieldCheck, Search, UserPlus, Loader2 } from 'lucide-react';
import { supabase } from '../../lib/supabase';
import { areaLabel, EVENT_LABEL, ago } from '../../lib/activity';

const PERIODS = [[7, '7 days'], [30, '30 days'], [90, '90 days']];

function Kpi({ icon: Icon, label, value, sub, tone }) {
  return (
    <div className="card p-4 flex items-center gap-3">
      <div className={`w-11 h-11 rounded-xl flex items-center justify-center flex-shrink-0 text-white ${tone}`}><Icon size={20} /></div>
      <div className="min-w-0">
        <div className="text-2xl font-black text-gray-900 tabular-nums leading-none">{value}</div>
        <div className="text-xs text-gray-500 mt-1">{label}</div>
        {sub && <div className="text-[11px] text-gray-400 truncate">{sub}</div>}
      </div>
    </div>
  );
}

/** Daily active clients — single series, one hue; hover shows the day's numbers. */
function DailyChart({ daily }) {
  const [hover, setHover] = useState(null);
  const max = Math.max(1, ...daily.map(d => d.users));
  const ticks = max <= 4 ? Array.from({ length: max + 1 }, (_, i) => i) : [0, Math.round(max / 2), max];
  const fmt = (d) => new Date(`${d}T00:00:00`).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' });
  const h = hover !== null ? daily[hover] : null;
  return (
    <div className="relative">
      <div className="flex gap-2">
        <div className="flex flex-col justify-between text-[10px] text-gray-400 tabular-nums h-40 py-0.5 text-right w-5">
          {[...ticks].reverse().map(t => <span key={t}>{t}</span>)}
        </div>
        <div className="relative flex-1 h-40">
          {ticks.map(t => <div key={t} className="absolute left-0 right-0 border-t border-gray-100" style={{ bottom: `${(t / max) * 100}%` }} />)}
          <div className="absolute inset-0 flex items-end gap-[2px]" onMouseLeave={() => setHover(null)}>
            {daily.map((d, i) => (
              <div key={d.day} className="flex-1 h-full flex items-end cursor-default" onMouseEnter={() => setHover(i)} onTouchStart={() => setHover(i)}>
                <div className={`w-full rounded-t-[4px] transition-colors ${hover === i ? 'bg-primary-700' : 'bg-primary-500'} ${d.users === 0 ? 'opacity-0' : ''}`}
                  style={{ height: `${Math.max(d.users ? 3 : 0, (d.users / max) * 100)}%` }} />
              </div>
            ))}
          </div>
          {h && (
            <div className="absolute -top-2 z-10 pointer-events-none -translate-x-1/2 -translate-y-full bg-gray-900 text-white text-xs rounded-lg px-2.5 py-1.5 shadow-lg whitespace-nowrap"
              style={{ left: `${((hover + 0.5) / daily.length) * 100}%` }}>
              <div className="font-semibold">{fmt(h.day)}</div>
              <div><span className="font-bold tabular-nums">{h.users}</span> client{h.users === 1 ? '' : 's'} · <span className="tabular-nums">{h.events}</span> actions</div>
            </div>
          )}
        </div>
      </div>
      <div className="flex justify-between text-[10px] text-gray-400 mt-1 pl-7">
        <span>{fmt(daily[0].day)}</span><span>{fmt(daily[Math.floor(daily.length / 2)].day)}</span><span>Today</span>
      </div>
    </div>
  );
}

export default function Activity() {
  const [days, setDays] = useState(30);
  const [s, setS] = useState(null);
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);
  const [q, setQ] = useState('');
  const [sort, setSort] = useState('recent');

  const load = async (d = days) => {
    setBusy(true);
    const { data, error } = await supabase.rpc('admin_usage_stats', { p_days: d });
    setBusy(false);
    if (error) setErr(error.message); else { setS(data); setErr(''); }
  };
  useEffect(() => { load(days); }, [days]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { const t = setInterval(() => load(), 60000); return () => clearInterval(t); }, [days]); // eslint-disable-line react-hooks/exhaustive-deps

  const users = useMemo(() => {
    if (!s) return [];
    let u = s.users.filter(x => !q || (x.name || '').toLowerCase().includes(q.toLowerCase()));
    if (sort === 'busy') u = [...u].sort((a, b) => (b.views + b.actions) - (a.views + a.actions));
    if (sort === 'inactive') u = [...u].sort((a, b) => new Date(a.last_seen || 0) - new Date(b.last_seen || 0));
    return u;
  }, [s, q, sort]);

  if (err) return <div className="card p-6 text-red-600 text-sm">{err}</div>;
  if (!s) return <div className="flex items-center justify-center h-64 text-gray-400"><Loader2 className="animate-spin" /></div>;

  const featMax = Math.max(1, ...s.features.map(f => f.views));
  const onlineClients = s.online.filter(o => o.role === 'client');
  const pctActive = s.clients_portal ? Math.round((s.active_period / s.clients_portal) * 100) : 0;

  return (
    <div className="space-y-5">
      <div className="flex items-end gap-3 flex-wrap">
        <div>
          <h1 className="text-2xl font-bold text-primary-800">📊 Activity &amp; Users</h1>
          <p className="text-sm text-gray-500">Who uses the client portal, and what they use most · admin only</p>
        </div>
        <div className="ml-auto flex items-center gap-2">
          <div className="flex gap-1 bg-gray-100 p-1 rounded-xl">
            {PERIODS.map(([d, l]) => (
              <button key={d} onClick={() => setDays(d)} className={`px-3 py-1.5 rounded-lg text-xs font-semibold ${days === d ? 'bg-white text-primary-700 shadow-sm' : 'text-gray-500'}`}>{l}</button>
            ))}
          </div>
          <button onClick={() => load()} title="Refresh" className="p-2 rounded-lg text-gray-500 hover:bg-gray-100"><RefreshCw size={16} className={busy ? 'animate-spin' : ''} /></button>
        </div>
      </div>

      <div className="grid grid-cols-2 lg:grid-cols-5 gap-3">
        <Kpi icon={Users} label="Registered clients" value={s.clients_total} sub={`+${s.clients_new} in ${days} days · ${s.self_registered} self-registered`} tone="bg-primary-600" />
        <Kpi icon={UserPlus} label="On the portal" value={s.clients_portal} sub={`${s.clients_total ? Math.round((s.clients_portal / s.clients_total) * 100) : 0}% of clients have a login`} tone="bg-indigo-500" />
        <Kpi icon={UserCheck} label={`Active (${days} days)`} value={s.active_period} sub={`${pctActive}% of portal users · ${s.active_7} this week`} tone="bg-emerald-600" />
        <Kpi icon={ActivityIcon} label="Active today" value={s.active_today} sub="clients who opened the portal" tone="bg-amber-500" />
        <Kpi icon={Wifi} label="Online now" value={onlineClients.length} sub={s.online.length > onlineClients.length ? `+ ${s.online.length - onlineClients.length} staff` : 'last 3 minutes'} tone="bg-pink-500" />
      </div>

      <div className="grid lg:grid-cols-[minmax(0,1.6fr)_minmax(0,1fr)] gap-4 items-start">
        <div className="card">
          <div className="card-header"><ActivityIcon size={16} /> Daily active clients <span className="text-xs font-normal text-gray-400">last 30 days</span></div>
          <div className="p-4"><DailyChart daily={s.daily} /></div>
        </div>

        <div className="card">
          <div className="card-header"><Wifi size={16} /> Online now
            <span className="ml-auto flex items-center gap-1.5 text-[11px] font-semibold text-emerald-600"><span className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse" /> live</span>
          </div>
          {s.online.length === 0 ? <div className="p-6 text-center text-sm text-gray-400">Nobody is online right now</div> : (
            <div className="divide-y divide-gray-50 max-h-56 overflow-y-auto">
              {s.online.map((o, i) => {
                const [emo, label] = areaLabel(o.area);
                const row = (
                  <div className="flex items-center gap-3 px-4 py-2.5">
                    <span className="relative"><span className="w-8 h-8 rounded-full bg-primary-100 text-primary-700 font-bold text-xs flex items-center justify-center">{(o.name || '?')[0]}</span>
                      <span className="absolute -bottom-0.5 -right-0.5 w-2.5 h-2.5 rounded-full bg-emerald-500 ring-2 ring-white" /></span>
                    <div className="flex-1 min-w-0">
                      <div className="text-sm font-semibold text-gray-800 truncate">{o.name} {o.role !== 'client' && <span className="text-[10px] font-bold text-gray-400 uppercase">staff</span>}</div>
                      <div className="text-[11px] text-gray-500 truncate">{emo} {label}{o.device ? ` · ${o.device}` : ''}</div>
                    </div>
                    <span className="text-[10px] text-gray-400">{ago(o.last_seen)}</span>
                  </div>
                );
                return o.client_id ? <Link key={i} to={`/admin/clients/${o.client_id}`} className="block hover:bg-gray-50">{row}</Link> : <div key={i}>{row}</div>;
              })}
            </div>
          )}
        </div>
      </div>

      <div className="grid lg:grid-cols-2 gap-4 items-start">
        <div className="card">
          <div className="card-header">🏆 Most used features <span className="text-xs font-normal text-gray-400">{days} days · clients</span></div>
          {s.features.length === 0 ? <div className="p-6 text-center text-sm text-gray-400">No client activity yet. Activity is recorded from today.</div> : (
            <div className="p-4 space-y-2.5">
              {s.features.map(f => {
                const [emo, label] = areaLabel(f.area);
                return (
                  <div key={f.area} className="group" title={`${label}: ${f.views} opens by ${f.users} client${f.users === 1 ? '' : 's'}`}>
                    <div className="flex items-baseline gap-2 text-sm">
                      <span className="w-5 text-center">{emo}</span>
                      <span className="font-medium text-gray-700 flex-1 truncate">{label}</span>
                      <span className="text-xs text-gray-500 tabular-nums">{f.users} client{f.users === 1 ? '' : 's'}</span>
                      <span className="text-sm font-bold text-gray-800 tabular-nums w-10 text-right">{f.views}</span>
                    </div>
                    <div className="ml-7 mt-1 h-2 rounded-full bg-gray-100 overflow-hidden">
                      <div className="h-full rounded-full bg-primary-500 group-hover:bg-primary-700 transition-colors" style={{ width: `${(f.views / featMax) * 100}%` }} />
                    </div>
                  </div>
                );
              })}
              {Object.keys(s.events).length > 0 && (
                <div className="flex flex-wrap gap-1.5 pt-2 border-t border-gray-50">
                  {Object.entries(s.events).filter(([k]) => k !== 'view').map(([k, n]) => (
                    <span key={k} className="text-[11px] bg-gray-50 border border-gray-100 rounded-full px-2 py-0.5 text-gray-600">{EVENT_LABEL[k]?.[0]} {n} {k === 'login' ? 'sign-ins' : `${k}s`}</span>
                  ))}
                </div>
              )}
            </div>
          )}
        </div>

        <div className="card">
          <div className="card-header">🕒 Recent activity</div>
          <div className="divide-y divide-gray-50 max-h-[360px] overflow-y-auto">
            {s.recent.length === 0 ? <div className="p-6 text-center text-sm text-gray-400">Nothing yet</div> : s.recent.map((r, i) => {
              const [emo, verb] = EVENT_LABEL[r.event] ?? ['•', r.event];
              const [, place] = areaLabel(r.area);
              return (
                <div key={i} className="flex items-start gap-2.5 px-4 py-2 text-sm">
                  <span className="w-5 text-center">{emo}</span>
                  <div className="flex-1 min-w-0">
                    <span className="font-semibold text-gray-800">{r.name}</span>{r.role !== 'client' && <span className="text-[10px] text-gray-400 uppercase ml-1">staff</span>}{' '}
                    <span className="text-gray-500">{verb}{r.event === 'view' || r.event === 'login' ? '' : ' ·'} {r.event === 'login' ? '' : r.event === 'view' ? place : r.detail || place}</span>
                  </div>
                  <span className="text-[10px] text-gray-400 whitespace-nowrap">{ago(r.at)}</span>
                </div>
              );
            })}
          </div>
        </div>
      </div>

      <div className="card overflow-hidden">
        <div className="card-header flex-wrap gap-2">👥 Portal users
          <span className="text-xs font-normal text-gray-400 flex items-center gap-1"><ShieldCheck size={12} /> 2FA: {s.mfa.clients_on} client{s.mfa.clients_on === 1 ? '' : 's'} · {s.mfa.admins_on}/{s.mfa.admins} admin{s.mfa.admins === 1 ? '' : 's'}</span>
          <div className="ml-auto flex items-center gap-2">
            <select className="input py-1 text-xs w-auto" value={sort} onChange={e => setSort(e.target.value)}>
              <option value="recent">Recently active</option><option value="busy">Most active</option><option value="inactive">Inactive first</option>
            </select>
            <div className="relative"><Search size={13} className="absolute left-2 top-1/2 -translate-y-1/2 text-gray-400" />
              <input className="input py-1 pl-7 text-xs w-36" placeholder="Search" value={q} onChange={e => setQ(e.target.value)} /></div>
          </div>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-gray-50 border-b border-gray-100">
              <tr><th className="table-th">Client</th><th className="table-th">Last seen</th><th className="table-th hidden sm:table-cell">Last sign-in</th>
                <th className="table-th text-right">Days active</th><th className="table-th text-right hidden md:table-cell">Pages</th><th className="table-th text-right hidden md:table-cell">Actions</th>
                <th className="table-th hidden lg:table-cell">Uses most</th><th className="table-th">2FA</th></tr>
            </thead>
            <tbody className="divide-y divide-gray-50">
              {users.map(u => {
                const online = u.last_seen && Date.now() - new Date(u.last_seen) < 180000;
                const [emo, label] = areaLabel(u.top);
                return (
                  <tr key={u.client_id} className="hover:bg-primary-50/40">
                    <td className="table-td"><Link to={`/admin/clients/${u.client_id}`} className="font-semibold text-gray-800 hover:text-primary-700 flex items-center gap-1.5">
                      {online && <span className="w-2 h-2 rounded-full bg-emerald-500" title="Online now" />}{u.name}</Link></td>
                    <td className={`table-td text-xs ${online ? 'text-emerald-600 font-semibold' : 'text-gray-500'}`}>{online ? 'Online now' : ago(u.last_seen)}</td>
                    <td className="table-td text-xs text-gray-500 hidden sm:table-cell">{ago(u.last_login)}</td>
                    <td className="table-td text-right tabular-nums">{u.days}</td>
                    <td className="table-td text-right tabular-nums hidden md:table-cell">{u.views}</td>
                    <td className="table-td text-right tabular-nums hidden md:table-cell">{u.actions}</td>
                    <td className="table-td text-xs text-gray-500 hidden lg:table-cell">{u.top ? `${emo} ${label}` : '—'}</td>
                    <td className="table-td">{u.mfa ? <span className="text-[11px] font-semibold text-emerald-700 bg-emerald-50 rounded-full px-2 py-0.5">ON</span> : <span className="text-[11px] text-gray-400">off</span>}</td>
                  </tr>
                );
              })}
              {users.length === 0 && <tr><td colSpan={8} className="p-6 text-center text-gray-400 text-sm">No portal users{q ? ' match' : ' yet'}</td></tr>}
            </tbody>
          </table>
        </div>
      </div>
      <p className="text-[11px] text-gray-400">Recorded from 23 Oct 2026. Page opens are counted once per minute per page; history older than 180 days is cleared automatically to keep the free database small.</p>
    </div>
  );
}
