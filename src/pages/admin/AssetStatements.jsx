import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import toast from 'react-hot-toast';
import { Landmark, Printer, CheckCircle2, Users, Search, Zap } from 'lucide-react';
import { supabase, fmtDate } from '../../lib/supabase';
import { useAuth } from '../../contexts/AuthContext';
import {
  alYears, filingYear, createStatement, totals, fmtMoney, openAssetStatement, alRequestMessage, portalAssetsUrl,
} from '../../lib/assets';
import { StatusPill } from '../../components/AssetStatementsAdmin';
import MessageMenu from '../../components/MessageMenu';
import { recipientsOf } from '../../lib/contacts';

// All clients' Assets & Liabilities sheets for one Y/A
export default function AssetStatements() {
  const { user } = useAuth();
  const [year, setYear] = useState(filingYear());
  const [clients, setClients] = useState([]);
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState('all');
  const [q, setQ] = useState('');
  const [busy, setBusy] = useState(false);

  const load = async () => {
    setLoading(true);
    const [{ data: c }, { data: s, error }] = await Promise.all([
      supabase.from('clients').select('id, full_name, tin, nic, address, mobile, email, profile_id, contact_name, contact_relation, contact_mobile, contact_email, contact_preferred').order('full_name'),
      supabase.from('asset_statements').select('*').eq('year', year),
    ]);
    if (error) toast.error(error.message);
    setClients(c ?? []); setRows(s ?? []); setLoading(false);
  };
  useEffect(() => { load(); }, [year]); // eslint-disable-line react-hooks/exhaustive-deps

  const byClient = useMemo(() => Object.fromEntries(rows.map(r => [r.client_id, r])), [rows]);
  const portalNoSheet = clients.filter(c => c.profile_id && !byClient[c.id]);
  const count = (st) => rows.filter(r => r.enabled && r.status === st).length;

  const list = clients
    .map(c => ({ c, s: byClient[c.id] }))
    .filter(({ c, s }) => {
      if (q && ![c.full_name, c.tin, c.mobile].some(f => f?.toLowerCase().includes(q.toLowerCase()))) return false;
      if (filter === 'all') return !!s;
      if (filter === 'none') return !s;
      return s && s.enabled && s.status === filter;
    })
    .sort((a, b) => (a.s?.status === 'submitted' ? -1 : 0) - (b.s?.status === 'submitted' ? -1 : 0));

  const enableOne = async (c) => {
    try {
      const row = await createStatement(supabase, { clientId: c.id, year, userId: user.id });
      setRows(r => [...r, row]);
      toast.success(`Enabled for ${c.full_name}`);
    } catch (e) { toast.error(e.message); }
  };

  const enableAll = async () => {
    if (!portalNoSheet.length) return;
    if (!window.confirm(`Enable the Y/A ${year} Assets & Liabilities sheet for ${portalNoSheet.length} portal client(s)? Each one is prefilled from their previous year's sheet where there is one.`)) return;
    setBusy(true);
    let ok = 0;
    for (const c of portalNoSheet) {
      try { await createStatement(supabase, { clientId: c.id, year, userId: user.id }); ok++; } catch { /* skip */ }
    }
    setBusy(false);
    toast.success(`Enabled for ${ok} client(s). Now send each one the link.`);
    load();
  };

  const markReviewed = async (s) => {
    const { error } = await supabase.from('asset_statements').update({ status: 'reviewed', reviewed_at: new Date().toISOString(), updated_at: new Date().toISOString() }).eq('id', s.id);
    if (error) return toast.error(error.message);
    toast.success('Marked as reviewed');
    load();
  };

  const pdf = (s, c) => {
    const w = window.open('', '_blank', 'width=920,height=900');
    if (!openAssetStatement(s, c, w)) toast.error('Pop-up blocked — allow pop-ups for this site');
  };

  const tabs = [
    ['all', `All sheets (${rows.length})`], ['open', `Waiting for client (${count('open')})`],
    ['submitted', `Submitted (${count('submitted')})`], ['reviewed', `Reviewed (${count('reviewed')})`], ['none', 'No sheet'],
  ];

  return (
    <div className="space-y-5">
      <div className="flex items-center gap-3 flex-wrap">
        <div className="flex-1">
          <h1 className="text-2xl font-bold text-primary-800 flex items-center gap-2"><Landmark size={22} /> Assets &amp; Liabilities</h1>
          <p className="text-sm text-gray-500">Statements of Assets &amp; Liabilities for the Income Tax Return — one per client per Y/A.</p>
        </div>
        <select className="input w-36" value={year} onChange={e => setYear(e.target.value)}>
          {alYears().map(y => <option key={y} value={y}>Y/A {y}</option>)}
        </select>
      </div>

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        {[['Waiting for client', count('open'), 'text-amber-700'], ['Submitted — to review', count('submitted'), 'text-blue-700'],
          ['Reviewed', count('reviewed'), 'text-green-700'], ['Portal clients without a sheet', portalNoSheet.length, 'text-gray-700']].map(([l, v, cls]) => (
          <div key={l} className="card p-4"><div className={`text-2xl font-black ${cls}`}>{v}</div><div className="text-xs text-gray-500">{l}</div></div>
        ))}
      </div>

      {portalNoSheet.length > 0 && (
        <div className="card p-4 flex flex-wrap items-center gap-3 bg-primary-50/40">
          <Zap size={18} className="text-primary-600" />
          <div className="flex-1 text-sm text-gray-700"><b>{portalNoSheet.length}</b> client(s) with a portal login don't have a Y/A {year} sheet yet.</div>
          <button onClick={enableAll} disabled={busy} className="btn-primary text-sm"><Users size={14} /> {busy ? 'Enabling…' : 'Enable for all of them'}</button>
        </div>
      )}

      <div className="card">
        <div className="p-3 flex flex-wrap gap-2 items-center border-b border-gray-100">
          <div className="flex gap-1 bg-gray-100 p-1 rounded-xl max-w-full overflow-x-auto">
            {tabs.map(([k, l]) => (
              <button key={k} onClick={() => setFilter(k)} className={`px-3 py-1.5 rounded-lg text-xs font-medium whitespace-nowrap ${filter === k ? 'bg-white text-primary-700 shadow-sm' : 'text-gray-500'}`}>{l}</button>
            ))}
          </div>
          <div className="relative ml-auto">
            <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
            <input className="input pl-8 py-1.5 text-sm w-56" placeholder="Search client…" value={q} onChange={e => setQ(e.target.value)} />
          </div>
        </div>
        {loading ? <div className="p-8 text-center text-gray-400 text-sm">Loading…</div> : list.length === 0 ? (
          <div className="p-8 text-center text-gray-400 text-sm">Nothing here</div>
        ) : (
          <div className="divide-y divide-gray-50">
            {list.map(({ c, s }) => {
              const t = s ? totals(s.data) : null;
              return (
                <div key={c.id} className="px-5 py-3 flex flex-wrap items-center gap-3">
                  <div className="flex-1 min-w-[200px]">
                    <Link to={`/admin/clients/${c.id}?tab=assets`} className="font-semibold text-sm text-primary-700 hover:underline">{c.full_name}</Link>
                    <div className="text-xs text-gray-400">{c.tin ? `TIN ${c.tin}` : 'No TIN'}{!c.profile_id && ' · no portal login'}</div>
                  </div>
                  {s ? (
                    <>
                      <div className="text-xs text-gray-500 min-w-[170px]">
                        <StatusPill s={s.status} enabled={s.enabled} />
                        <div className="mt-0.5">{t.count} entries · Net Rs. {fmtMoney(t.net)}{s.submitted_at && ` · ${fmtDate(s.submitted_at)}`}</div>
                      </div>
                      <div className="flex gap-1.5">
                        <button onClick={() => pdf(s, c)} className="btn-secondary text-xs py-1 px-2.5"><Printer size={13} /> PDF</button>
                        {s.status === 'submitted' && <button onClick={() => markReviewed(s)} className="btn-primary text-xs py-1 px-2.5"><CheckCircle2 size={13} /> Reviewed</button>}
                        {s.status === 'open' && c.profile_id && (
                          <MessageMenu label="Send" phone={c.mobile} email={c.email} recipients={recipientsOf(c)} subject={`Assets & Liabilities Y/A ${year} — TaxMate`}
                            getText={async () => alRequestMessage({ name: c.full_name, year, url: portalAssetsUrl(year), prefilled: !!s.prefilled_from })} />
                        )}
                      </div>
                    </>
                  ) : (
                    <button onClick={() => enableOne(c)} className="btn-secondary text-xs py-1 px-2.5">Enable Y/A {year}</button>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
