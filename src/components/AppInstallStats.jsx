// V59 — Activity & Users → 📱 App installs: how many phones / computers installed the TaxMate app
import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { Smartphone, BellRing, UserCheck, Sparkles, RefreshCw, Loader2 } from 'lucide-react';
import { supabase, fmtDate } from '../lib/supabase';

const PLATFORM = { android: '🤖 Android', ios: '🍎 iPhone / iPad', windows: '🪟 Windows', mac: '💻 Mac', linux: '🐧 Linux', other: '❔ Other' };

/** Small hook so the tab label can show the count */
export function useAppInstalls() {
  const [s, setS] = useState(null);
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);
  const load = async () => {
    setBusy(true);
    const { data, error } = await supabase.rpc('admin_app_installs');
    setBusy(false);
    if (error) setErr(error.message); else { setS(data); setErr(''); }
  };
  useEffect(() => { load(); }, []);
  return { s, err, busy, load };
}

function Card({ icon: Icon, label, value, sub, tone }) {
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

export default function AppInstallStats({ data }) {
  const { s, err, busy, load } = data;
  if (err) return <div className="card p-6 text-sm text-red-600">{err.includes('admin_app_installs') ? 'Run the V59 database update first.' : err}</div>;
  if (!s) return <div className="card p-6 text-gray-400 text-sm flex items-center gap-2"><Loader2 size={15} className="animate-spin" /> Loading…</div>;
  const plat = Object.entries(s.by_platform ?? {}).sort((a, b) => b[1] - a[1]);
  const max = Math.max(1, ...plat.map(p => p[1]));
  const days = (() => {
    const m = Object.fromEntries((s.per_day ?? []).map(d => [d.day, d.n]));
    return Array.from({ length: 30 }, (_, i) => { const d = new Date(Date.now() - (29 - i) * 864e5).toLocaleDateString('en-CA', { timeZone: 'Asia/Colombo' }); return { day: d, n: m[d] ?? 0 }; });
  })();
  const dmax = Math.max(1, ...days.map(d => d.n));

  return (
    <div className="space-y-5">
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <Card icon={Smartphone} label="App installs" value={s.total ?? 0} sub={`+${s.new_7 ?? 0} this week · +${s.new_30 ?? 0} in 30 days`} tone="bg-emerald-600" />
        <Card icon={UserCheck} label="Clients with the app" value={s.clients ?? 0} sub={`${s.guests ?? 0} not signed in yet`} tone="bg-primary-600" />
        <Card icon={Sparkles} label="Used in 30 days" value={s.active_30 ?? 0} sub="opened from the home screen" tone="bg-amber-500" />
        <Card icon={BellRing} label="Notifications on" value={s.push_clients ?? 0} sub={`${s.push_devices ?? 0} client devices${s.push_ready ? '' : ' · not set up yet'}`} tone="bg-pink-500" />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
        <div className="card p-4">
          <div className="text-sm font-semibold text-gray-700 mb-2">New installs — last 30 days</div>
          <div className="flex items-end gap-[3px] h-24">
            {days.map(d => <div key={d.day} title={`${d.day}: ${d.n}`} className="flex-1 rounded-t bg-emerald-500/80" style={{ height: `${Math.max(d.n ? 8 : 2, (d.n / dmax) * 100)}%`, opacity: d.n ? 1 : 0.25 }} />)}
          </div>
          <div className="flex justify-between text-[10px] text-gray-400 mt-1"><span>{fmtDate(days[0].day)}</span><span>Today</span></div>
        </div>
        <div className="card p-4">
          <div className="text-sm font-semibold text-gray-700 mb-2">Phone / computer</div>
          {plat.length === 0 ? <div className="text-sm text-gray-400">No installs yet.</div> : plat.map(([k, n]) => (
            <div key={k} className="flex items-center gap-2 text-sm mb-1.5">
              <span className="w-32 text-gray-600">{PLATFORM[k] ?? k}</span>
              <div className="flex-1 h-3 rounded-full bg-gray-100 overflow-hidden"><div className="h-full bg-primary-500" style={{ width: `${(n / max) * 100}%` }} /></div>
              <span className="w-8 text-right tabular-nums font-semibold">{n}</span>
            </div>
          ))}
        </div>
      </div>

      <div className="card overflow-hidden">
        <div className="card-header"><Smartphone size={16} /> Latest installs
          <button onClick={load} className="ml-auto text-gray-400 hover:text-primary-700 p-1" title="Refresh">{busy ? <Loader2 size={15} className="animate-spin" /> : <RefreshCw size={15} />}</button></div>
        {(s.latest ?? []).length === 0 ? <div className="p-6 text-sm text-gray-400 text-center">No installs yet.</div> : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-gray-50"><tr><th className="table-th">Who</th><th className="table-th">Device</th><th className="table-th">Installed</th><th className="table-th hidden sm:table-cell">Last opened</th><th className="table-th hidden sm:table-cell">Opens</th><th className="table-th">🔔</th></tr></thead>
              <tbody className="divide-y divide-gray-50">
                {s.latest.map((r, i) => (
                  <tr key={i}>
                    <td className="table-td">{r.client_id ? <Link to={`/admin/clients/${r.client_id}`} className="font-semibold text-primary-700 hover:underline">{r.name ?? 'Client'}</Link> : <span className="text-gray-400">Not signed in</span>}
                      {r.client_no && <span className="ml-1 font-mono text-[10px] text-gray-400">{r.client_no}</span>}</td>
                    <td className="table-td text-gray-600">{PLATFORM[r.platform] ?? r.platform}</td>
                    <td className="table-td text-gray-600">{fmtDate(r.at)}</td>
                    <td className="table-td text-gray-500 hidden sm:table-cell">{r.last_open ? fmtDate(r.last_open) : '—'}</td>
                    <td className="table-td text-gray-500 hidden sm:table-cell tabular-nums">{r.opens}</td>
                    <td className="table-td">{r.push ? '✅' : ''}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
      <p className="text-[11px] text-gray-500">Counted when the browser installs the app (Android / computer) or when it is opened from the home screen icon (all phones, iPhone included). A random device number is used — no personal data. If someone deletes the app, the browser does not tell us, so "Last opened" shows who still uses it. TaxMate admins' own devices are not counted ({s.admin_devices ?? 0}).</p>
    </div>
  );
}
