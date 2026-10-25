import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import toast from 'react-hot-toast';
import { Crown, Loader2, Search, ExternalLink, TrendingUp, Users, Clock, Receipt, Settings as SettingsIcon } from 'lucide-react';
import { supabase, fmtRs, fmtDate } from '../../lib/supabase';
import { SUB_STATUS, planStyle, rsPlan, monthly, billNow, billAddonNow, addonEmoji } from '../../lib/plans';

export default function Subscriptions() {
  const [rows, setRows] = useState(null);
  const [paid, setPaid] = useState(null);
  const [filter, setFilter] = useState('live');
  const [q, setQ] = useState('');
  const [busy, setBusy] = useState(null);
  const [addons, setAddons] = useState([]);

  const load = async () => {
    const month = new Date().toISOString().slice(0, 7);
    const [{ data, error }, { data: inv }, { data: ad }] = await Promise.all([
      supabase.from('subscriptions').select('*, clients(full_name, mobile)').order('created_at', { ascending: false }),
      supabase.from('invoices').select('total_amount, status, period').or('subscription_id.not.is.null,addon_id.not.is.null').eq('period', month),
      supabase.from('service_addons').select('*, clients(full_name)').in('status', ['requested', 'active', 'paused']).order('created_at', { ascending: false }),
    ]);
    setAddons(ad ?? []);
    if (error) toast.error(error.message);
    setRows(data ?? []);
    const v = inv ?? [];
    setPaid({ billed: v.reduce((a, x) => a + Number(x.total_amount || 0), 0), paid: v.filter(x => x.status === 'paid').reduce((a, x) => a + Number(x.total_amount || 0), 0) });
  };
  useEffect(() => { load(); }, []);

  const list = useMemo(() => (rows ?? []).filter(s => (filter === 'live' ? ['active', 'paused'].includes(s.status) : filter === 'all' || s.status === filter)
    && (!q || `${s.clients?.full_name} ${s.plan_name}`.toLowerCase().includes(q.toLowerCase()))), [rows, filter, q]);
  const addonMrr = monthly(addons);
  const mrr = monthly(rows) + addonMrr;
  const active = (rows ?? []).filter(s => s.status === 'active');
  const byPlan = Object.values(active.reduce((m, s) => { (m[s.plan_key] ??= { key: s.plan_key, name: s.plan_name, n: 0, sum: 0 }); m[s.plan_key].n++; m[s.plan_key].sum += Number(s.price || 0); return m; }, {}));
  const reqs = (rows ?? []).filter(s => s.status === 'requested').length + addons.filter(a => a.status === 'requested').length;
  const count = (k) => (rows ?? []).filter(s => (k === 'live' ? ['active', 'paused'].includes(s.status) : k === 'all' || s.status === k)).length;

  const billAddon = async (a) => { setBusy(a.id); try { await billAddonNow(a); toast.success(`Invoice created for ${a.clients?.full_name}`); load(); } catch (e) { toast.error(e.message); } setBusy(null); };
  const bill = async (s) => { setBusy(s.id); try { await billNow(s); toast.success(`Invoice created for ${s.clients?.full_name}`); load(); } catch (e) { toast.error(e.message); } setBusy(null); };

  return (
    <div className="space-y-5">
      <div className="flex items-end gap-3 flex-wrap">
        <div>
          <h1 className="text-2xl font-bold text-primary-800 flex items-center gap-2"><Crown size={24} /> Subscriptions</h1>
          <p className="text-sm text-gray-500">Monthly plans — steady income every month</p>
        </div>
        <Link to="/admin/settings?tab=plans" className="ml-auto btn-secondary text-sm"><SettingsIcon size={14} /> Edit plans & prices</Link>
      </div>

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <div className="card p-4"><div className="text-xs text-gray-500 flex items-center gap-1"><TrendingUp size={13} /> Monthly recurring income</div><div className="text-2xl font-black text-primary-800 mt-1">{fmtRs(mrr)}</div><div className="text-[11px] text-gray-400">{fmtRs(mrr * 12)} a year{addonMrr ? ` · add-ons ${fmtRs(addonMrr)}` : ''}</div></div>
        <div className="card p-4"><div className="text-xs text-gray-500 flex items-center gap-1"><Users size={13} /> Active plans</div><div className="text-2xl font-black text-primary-800 mt-1">{active.length}</div><div className="text-[11px] text-gray-400">{byPlan.map(p => `${p.name} ${p.n}`).join(' · ') || '—'}</div></div>
        <div className="card p-4"><div className="text-xs text-gray-500 flex items-center gap-1"><Receipt size={13} /> This month billed / paid</div><div className="text-2xl font-black text-primary-800 mt-1">{fmtRs(paid?.paid ?? 0)}</div><div className="text-[11px] text-gray-400">of {fmtRs(paid?.billed ?? 0)} invoiced</div></div>
        <div className={`card p-4 ${reqs ? 'ring-2 ring-gold-500/50' : ''}`}><div className="text-xs text-gray-500 flex items-center gap-1"><Clock size={13} /> Requests waiting</div><div className="text-2xl font-black text-primary-800 mt-1">{reqs}</div><div className="text-[11px] text-gray-400">approve on the client page</div></div>
      </div>

      <div className="flex items-center gap-2 flex-wrap">
        {[['live', 'Active & paused'], ['requested', 'Requests'], ['cancelled', 'Cancelled'], ['all', 'All']].map(([k, l]) => (
          <button key={k} onClick={() => setFilter(k)} className={`px-3 py-1.5 rounded-full text-xs font-semibold ${filter === k ? 'bg-primary-700 text-white' : 'bg-white border border-gray-200 text-gray-600 hover:border-primary-300'}`}>{l} <span className="opacity-60">{count(k)}</span></button>
        ))}
        <div className="relative ml-auto"><Search size={14} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-gray-400" />
          <input className="input pl-8 py-1.5 text-sm w-52" placeholder="Search" value={q} onChange={e => setQ(e.target.value)} /></div>
      </div>

      {rows === null ? <div className="card p-10 text-center"><Loader2 className="animate-spin mx-auto text-gray-400" /></div>
        : list.length === 0 ? <div className="card p-10 text-center text-gray-400 text-sm">No subscriptions here yet. Open a client → Overview → Monthly plan → Start a plan.</div> : (
        <div className="card overflow-x-auto">
          <table className="w-full text-sm">
            <thead><tr className="text-left text-xs text-gray-500 border-b border-gray-100"><th className="px-4 py-2">Client</th><th className="px-2">Plan</th><th className="px-2 text-right">Price / month</th><th className="px-2">Status</th><th className="px-2">Next invoice</th><th className="px-2">Billing</th><th className="px-2" /></tr></thead>
            <tbody className="divide-y divide-gray-50">
              {list.map(s => (
                <tr key={s.id} className="hover:bg-gray-50/60">
                  <td className="px-4 py-2"><Link to={`/admin/clients/${s.client_id}`} className="font-semibold text-primary-700 hover:underline inline-flex items-center gap-1">{s.clients?.full_name} <ExternalLink size={11} /></Link></td>
                  <td className="px-2">{planStyle(s.plan_key).emoji} {s.plan_name}</td>
                  <td className="px-2 text-right font-semibold">{rsPlan(s.price)}</td>
                  <td className="px-2"><span className={`text-[11px] font-semibold px-2 py-0.5 rounded-md ${SUB_STATUS[s.status]?.cls}`}>{SUB_STATUS[s.status]?.label}</span></td>
                  <td className="px-2 text-xs">{s.status === 'active' && s.next_bill_date ? fmtDate(s.next_bill_date) : '—'}</td>
                  <td className="px-2 text-xs">{s.auto_invoice ? 'Auto' : 'Manual'}</td>
                  <td className="px-2 text-right">{s.status === 'active' && <button onClick={() => bill(s)} disabled={busy === s.id} className="btn-secondary text-xs py-1">{busy === s.id ? <Loader2 size={12} className="animate-spin" /> : <Receipt size={12} />} Bill now</button>}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {addons.length > 0 && (
        <div className="card overflow-x-auto">
          <div className="card-header">🧩 Add-on services <span className="text-xs font-normal text-gray-400">{addons.filter(a => a.status === 'active').length} active · {fmtRs(addonMrr)} / month</span></div>
          <table className="w-full text-sm">
            <thead><tr className="text-left text-xs text-gray-500 border-b border-gray-100"><th className="px-4 py-2">Client</th><th className="px-2">Service</th><th className="px-2 text-right">Price / month</th><th className="px-2">Status</th><th className="px-2">Next invoice</th><th className="px-2" /></tr></thead>
            <tbody className="divide-y divide-gray-50">
              {addons.map(a => (
                <tr key={a.id} className="hover:bg-gray-50/60">
                  <td className="px-4 py-2"><Link to={`/admin/clients/${a.client_id}`} className="font-semibold text-primary-700 hover:underline inline-flex items-center gap-1">{a.clients?.full_name} <ExternalLink size={11} /></Link></td>
                  <td className="px-2">{addonEmoji(a.addon_key)} {a.addon_name}</td>
                  <td className="px-2 text-right font-semibold">{rsPlan(a.price)}</td>
                  <td className="px-2"><span className={`text-[11px] font-semibold px-2 py-0.5 rounded-md ${SUB_STATUS[a.status]?.cls}`}>{SUB_STATUS[a.status]?.label}</span>{a.status === 'requested' && <span className="text-[11px] text-gray-400 ml-1">approve on the client page</span>}</td>
                  <td className="px-2 text-xs">{a.status === 'active' && a.next_bill_date ? fmtDate(a.next_bill_date) : '—'}</td>
                  <td className="px-2 text-right">{a.status === 'active' && <button onClick={() => billAddon(a)} disabled={busy === a.id} className="btn-secondary text-xs py-1">{busy === a.id ? <Loader2 size={12} className="animate-spin" /> : <Receipt size={12} />} Bill now</button>}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
