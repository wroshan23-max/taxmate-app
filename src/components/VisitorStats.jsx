import { useEffect, useState } from 'react';
import toast from 'react-hot-toast';
import { Eye, Users, Wifi, UserPlus, CalendarDays, Link2, Copy, ExternalLink, Smartphone, Monitor, Tablet, Loader2, RefreshCw, Info } from 'lucide-react';
import { supabase } from '../lib/supabase';
import { ago } from '../lib/activity';
import { sourceLabel, pageLabel, trackingLink, SOURCES } from '../lib/visits';

const PERIODS = [[7, '7 days'], [30, '30 days'], [90, '90 days']];
const n = (v) => Number(v || 0).toLocaleString('en-LK');
const DEV = { mobile: [Smartphone, 'Phone'], tablet: [Tablet, 'Tablet'], desktop: [Monitor, 'Computer'] };

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

/** Visitors per day — one series, one hue; hover shows the day's numbers. */
function DailyVisitors({ daily }) {
  const [hover, setHover] = useState(null);
  const max = Math.max(1, ...daily.map(d => d.visitors));
  const fmt = (d) => new Date(`${d}T00:00:00`).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' });
  const h = hover !== null ? daily[hover] : null;
  return (
    <div className="relative">
      <div className="relative h-40">
        {[0, 0.5, 1].map(t => <div key={t} className="absolute left-0 right-0 border-t border-gray-100" style={{ bottom: `${t * 100}%` }} />)}
        <div className="absolute right-0 -top-1 text-[10px] text-gray-400 tabular-nums">{max}</div>
        <div className="absolute inset-0 flex items-end gap-[2px]" onMouseLeave={() => setHover(null)}>
          {daily.map((d, i) => (
            <div key={d.day} className="flex-1 h-full flex items-end" onMouseEnter={() => setHover(i)} onTouchStart={() => setHover(i)}>
              <div className={`w-full rounded-t-[4px] ${hover === i ? 'bg-primary-700' : 'bg-primary-500'} ${d.visitors === 0 ? 'opacity-0' : ''}`}
                style={{ height: `${Math.max(d.visitors ? 3 : 0, (d.visitors / max) * 100)}%` }} />
            </div>
          ))}
        </div>
        {h && (
          <div className="absolute -top-2 z-10 pointer-events-none -translate-x-1/2 -translate-y-full bg-gray-900 text-white text-xs rounded-lg px-2.5 py-1.5 shadow-lg whitespace-nowrap"
            style={{ left: `${((hover + 0.5) / daily.length) * 100}%` }}>
            <div className="font-semibold">{fmt(h.day)}</div>
            <div><b className="tabular-nums">{h.visitors}</b> visitor{h.visitors === 1 ? '' : 's'} · <span className="tabular-nums">{h.visits}</span> page views</div>
          </div>
        )}
      </div>
      <div className="flex justify-between text-[10px] text-gray-400 mt-1"><span>{fmt(daily[0].day)}</span><span>{fmt(daily[Math.floor(daily.length / 2)].day)}</span><span>Today</span></div>
    </div>
  );
}

function LinkBuilder() {
  const [codes, setCodes] = useState([]);
  const [page, setPage] = useState('/login');
  const [src, setSrc] = useState('facebook');
  const [camp, setCamp] = useState('');
  useEffect(() => {
    supabase.from('client_registrations').select('code, label, active').eq('multi_use', true).is('revoked_at', null).is('referrer_client_id', null)
      .then(({ data }) => setCodes((data ?? []).filter(r => r.active !== false && r.code)));
  }, []);
  const url = trackingLink(page, src, camp);
  const copy = () => navigator.clipboard?.writeText(url).then(() => toast.success('Link copied'), () => toast.error('Copy failed'));
  return (
    <div className="card">
      <div className="card-header"><Link2 size={16} /> Make a tracking link</div>
      <div className="p-4 space-y-3">
        <p className="text-xs text-gray-500">Use a different link for each post, ad, flyer or WhatsApp message. Clicks and sign-ups then show under <b>Campaigns</b>, so you can see which one works.</p>
        <div className="grid sm:grid-cols-3 gap-2">
          <label className="text-[11px] font-semibold text-gray-500">Page they open
            <select className="input mt-0.5 py-1.5 text-sm" value={page} onChange={e => setPage(e.target.value)}>
              <option value="/login">Login page</option>
              {codes.map(c => <option key={c.code} value={`/join/${c.code}`}>Registration · /join/{c.code}{c.label ? ` (${c.label})` : ''}</option>)}
              <option value="/ird-codes">IRD payment codes (free tool)</option>
              <option value="/tax-calculator">Tax calculator (free tool)</option>
            </select>
          </label>
          <label className="text-[11px] font-semibold text-gray-500">Where you post it
            <select className="input mt-0.5 py-1.5 text-sm" value={src} onChange={e => setSrc(e.target.value)}>
              {SOURCES.map(s => <option key={s} value={s}>{sourceLabel(s)[0]} {sourceLabel(s)[1]}</option>)}
            </select>
          </label>
          <label className="text-[11px] font-semibold text-gray-500">Campaign name (optional)
            <input className="input mt-0.5 py-1.5 text-sm" maxLength={40} placeholder="e.g. iit-deadline" value={camp} onChange={e => setCamp(e.target.value)} />
          </label>
        </div>
        <div className="flex items-center gap-2">
          <code className="flex-1 min-w-0 truncate text-xs bg-gray-50 border border-gray-200 rounded-lg px-2.5 py-2">{url}</code>
          <button onClick={copy} className="btn-primary text-xs py-2"><Copy size={13} /> Copy</button>
          <a href={url} target="_blank" rel="noreferrer" className="btn-secondary text-xs py-2" title="Open"><ExternalLink size={13} /></a>
        </div>
      </div>
    </div>
  );
}

/** Activity & Users → Website visitors: everyone who opens the app, signed in or not. */
export default function VisitorStats() {
  const [days, setDays] = useState(30);
  const [s, setS] = useState(null);
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);
  const load = async (d = days) => {
    setBusy(true);
    const { data, error } = await supabase.rpc('admin_visitor_stats', { p_days: d });
    setBusy(false);
    if (error) setErr(/admin_visitor_stats|function/i.test(error.message) ? 'Visitor tracking is not set up yet (database update needed).' : error.message);
    else { setS(data); setErr(''); }
  };
  useEffect(() => { load(days); }, [days]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { const t = setInterval(() => load(), 60000); return () => clearInterval(t); }, [days]); // eslint-disable-line react-hooks/exhaustive-deps

  if (err) return <div className="card p-6 text-red-600 text-sm">{err}</div>;
  if (!s) return <div className="flex items-center justify-center h-64 text-gray-400"><Loader2 className="animate-spin" /></div>;
  const srcMax = Math.max(1, ...s.sources.map(x => x.visitors));
  const pageMax = Math.max(1, ...s.pages.map(x => x.visitors));
  const devTotal = Object.values(s.devices).reduce((a, v) => a + v, 0);
  const empty = !s.visits && !s.recent.length;

  return (
    <div className="space-y-5">
      <div className="flex items-center gap-2 flex-wrap">
        <p className="text-sm text-gray-500 flex-1 min-w-[240px]">Everyone who opens the app — also people who are not signed in (registration links, free tools, login page). Anonymous; TaxMate admins are not counted.</p>
        <div className="flex gap-1 bg-gray-100 p-1 rounded-xl">
          {PERIODS.map(([d, l]) => <button key={d} onClick={() => setDays(d)} className={`px-3 py-1.5 rounded-lg text-xs font-semibold ${days === d ? 'bg-white text-primary-700 shadow-sm' : 'text-gray-500'}`}>{l}</button>)}
        </div>
        <button onClick={() => load()} title="Refresh" className="p-2 rounded-lg text-gray-500 hover:bg-gray-100"><RefreshCw size={16} className={busy ? 'animate-spin' : ''} /></button>
      </div>

      <div className="grid grid-cols-2 lg:grid-cols-5 gap-3">
        <Kpi icon={Users} label={`Visitors (${days} days)`} value={n(s.visitors)} sub={`${n(s.new_visitors)} new · ${n(s.guests)} not signed in`} tone="bg-primary-600" />
        <Kpi icon={Eye} label="Page views" value={n(s.visits)} sub={s.visitors ? `${(s.visits / s.visitors).toFixed(1)} pages per visitor` : '—'} tone="bg-indigo-500" />
        <Kpi icon={CalendarDays} label="Today" value={n(s.today_visitors)} sub={`visitors · ${n(s.today_visits)} page views`} tone="bg-amber-500" />
        <Kpi icon={Wifi} label="On the app now" value={n(s.live)} sub="last 5 minutes" tone="bg-pink-500" />
        <Kpi icon={UserPlus} label="Sign-ups from links" value={n(s.registrations)} sub={s.guests ? `${((s.registrations / s.guests) * 100).toFixed(1)}% of guests registered` : 'registration form sent'} tone="bg-emerald-600" />
      </div>

      {empty && <div className="card p-4 text-sm text-gray-600 flex gap-2"><Info size={16} className="flex-shrink-0 mt-0.5 text-primary-600" /> No visits counted yet. Counting starts from today — share a tracking link below and check back.</div>}

      <div className="grid lg:grid-cols-[minmax(0,1.6fr)_minmax(0,1fr)] gap-4 items-start">
        <div className="card">
          <div className="card-header"><Users size={16} /> Visitors per day <span className="text-xs font-normal text-gray-400">last 30 days</span></div>
          <div className="p-4"><DailyVisitors daily={s.daily} /></div>
        </div>
        <div className="card">
          <div className="card-header">Where they come from</div>
          <div className="p-4 space-y-2.5">
            {s.sources.length === 0 && <div className="text-sm text-gray-400 text-center py-4">No visits yet</div>}
            {s.sources.map(x => { const [ic, lb] = sourceLabel(x.source); return (
              <div key={x.source}>
                <div className="flex items-center gap-2 text-sm"><span>{ic}</span><span className="flex-1 truncate">{lb}</span>
                  <b className="tabular-nums">{n(x.visitors)}</b>{x.registrations > 0 && <span className="text-[11px] font-semibold text-emerald-700 bg-emerald-50 rounded px-1.5">{x.registrations} sign-up{x.registrations > 1 ? 's' : ''}</span>}</div>
                <div className="h-1.5 bg-gray-100 rounded-full mt-1"><div className="h-full bg-primary-500 rounded-full" style={{ width: `${(x.visitors / srcMax) * 100}%` }} /></div>
              </div>
            ); })}
            {devTotal > 0 && (
              <div className="pt-2 border-t border-gray-100 flex gap-3 flex-wrap text-xs text-gray-600">
                {Object.entries(s.devices).sort((a, b) => b[1] - a[1]).map(([k, v]) => { const [I, l] = DEV[k] ?? [Monitor, k]; return <span key={k} className="inline-flex items-center gap-1"><I size={13} className="text-gray-400" /> {l} <b>{Math.round((v / devTotal) * 100)}%</b></span>; })}
              </div>
            )}
          </div>
        </div>
      </div>

      <div className="grid lg:grid-cols-2 gap-4 items-start">
        <div className="card">
          <div className="card-header">Most opened pages</div>
          <div className="p-4 space-y-2.5">
            {s.pages.length === 0 && <div className="text-sm text-gray-400 text-center py-4">No visits yet</div>}
            {s.pages.map(x => (
              <div key={x.path}>
                <div className="flex items-center gap-2 text-sm"><span className="flex-1 truncate" title={x.path}>{pageLabel(x.path)}</span><b className="tabular-nums">{n(x.visitors)}</b><span className="text-[11px] text-gray-400 tabular-nums w-16 text-right">{n(x.visits)} views</span></div>
                <div className="h-1.5 bg-gray-100 rounded-full mt-1"><div className="h-full bg-indigo-400 rounded-full" style={{ width: `${(x.visitors / pageMax) * 100}%` }} /></div>
              </div>
            ))}
          </div>
        </div>
        <div className="card">
          <div className="card-header">Campaigns <span className="text-xs font-normal text-gray-400">from tracking links</span></div>
          {s.campaigns.length === 0 ? <div className="p-6 text-sm text-gray-400 text-center">No campaign clicks yet — make a tracking link below.</div> : (
            <table className="w-full text-sm">
              <thead><tr className="text-left text-xs text-gray-500 border-b border-gray-100"><th className="px-4 py-2">Campaign</th><th className="px-2">Source</th><th className="px-2 text-right">Visitors</th><th className="px-4 text-right">Sign-ups</th></tr></thead>
              <tbody className="divide-y divide-gray-50">
                {s.campaigns.map(c => (
                  <tr key={c.campaign}><td className="px-4 py-2 font-semibold text-gray-800">{c.campaign}</td><td className="px-2 text-xs">{sourceLabel(c.source)[0]} {sourceLabel(c.source)[1]}</td>
                    <td className="px-2 text-right tabular-nums">{n(c.visitors)}</td><td className="px-4 text-right tabular-nums font-semibold text-emerald-700">{n(c.registrations)}</td></tr>
                ))}
              </tbody>
            </table>
          )}
          {s.referrers.length > 0 && <div className="px-4 py-3 border-t border-gray-100 text-xs text-gray-500">Referring sites: {s.referrers.map(r => `${r.referrer} (${r.visitors})`).join(' · ')}</div>}
        </div>
      </div>

      <LinkBuilder />

      <div className="card">
        <div className="card-header"><Eye size={16} /> Latest visits <span className="text-xs font-normal text-gray-400">newest first</span></div>
        {s.recent.length === 0 ? <div className="p-6 text-sm text-gray-400 text-center">No visits yet</div> : (
          <div className="divide-y divide-gray-50">
            {s.recent.map((r, i) => { const [ic, lb] = sourceLabel(r.source); const [DevI] = DEV[r.device] ?? [Monitor]; return (
              <div key={i} className="px-4 py-2 flex items-center gap-3 text-sm">
                <span className="text-xs text-gray-400 w-20 flex-shrink-0">{ago(r.created_at)}</span>
                <DevI size={14} className="text-gray-400 flex-shrink-0" />
                <span className="flex-1 min-w-0 truncate">{r.event === 'register' ? <b className="text-emerald-700">✅ Registered · </b> : null}{pageLabel(r.path)}</span>
                <span className="text-xs text-gray-500 hidden sm:inline whitespace-nowrap">{ic} {lb}{r.campaign ? ` · ${r.campaign}` : ''}</span>
                <span className={`text-[10px] font-semibold px-1.5 py-0.5 rounded ${r.signed_in ? 'bg-primary-50 text-primary-700' : 'bg-gray-100 text-gray-500'}`}>{r.signed_in ? 'client' : `guest #${r.who}`}</span>
              </div>
            ); })}
          </div>
        )}
      </div>
    </div>
  );
}
