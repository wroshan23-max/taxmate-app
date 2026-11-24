// V76 — client page → "Business" tab (TaxMate): sole proprietor / partnership accounts per Y/A
import { useEffect, useState } from 'react';
import toast from 'react-hot-toast';
import { Plus, Store, Loader2, Trash2, ChevronRight, AlertTriangle, Handshake } from 'lucide-react';
import BizEditor from './BizEditor';
import { supabase, fmtDate } from '../../lib/supabase';
import { filingYear } from '../../lib/assets';
import { listAccounts, createAccount, deleteAccount, STATUS, KIND } from '../../lib/bizAccounts';

const YEARS = (() => { const f = parseInt(filingYear(), 10); const out = []; for (let s = f + 1; s >= 2022; s--) out.push(`${s}/${String(s + 1).slice(2)}`); return out; })();
const fm = (n) => Math.round(Number(n) || 0).toLocaleString('en-LK');

export default function BizAccountsAdmin({ client }) {
  const [rows, setRows] = useState(null);
  const [missing, setMissing] = useState(false);
  const [openId, setOpenId] = useState(null);
  const [form, setForm] = useState(null);
  const [busy, setBusy] = useState(false);
  const [clients, setClients] = useState([]);
  const [partnerOf, setPartnerOf] = useState([]);

  const load = async () => {
    try {
      const r = await listAccounts(client.id); setRows(r.rows); setMissing(!!r.missing);
      // partnerships (any client) where this client is a linked partner
      const { data: links } = await supabase.from('business_account_office').select('account_id, data').neq('client_id', client.id);
      const ids = (links || []).filter((l) => Object.values(l.data?.links || {}).includes(client.id)).map((l) => l.account_id);
      if (ids.length) { const { data: ps } = await supabase.from('business_accounts').select('id, client_id, year, name, status, result, clients(full_name)').in('id', ids); setPartnerOf(ps || []); } else setPartnerOf([]);
    } catch (e) { toast.error(e.message); setRows([]); }
  };
  useEffect(() => { load(); }, [client.id]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { supabase.from('clients').select('id, full_name, client_no').is('archived_at', null).order('full_name').then(({ data }) => setClients(data || [])); }, []);

  const create = async () => {
    setBusy(true);
    try { const row = await createAccount({ clientId: client.id, ...form }); toast.success('Created — the client can fill it in the portal'); setForm(null); await load(); setOpenId(row.id); } catch (e) { toast.error(e.message); }
    setBusy(false);
  };
  const del = async (r) => {
    if (!window.confirm(`Delete "${r.name}" (Y/A ${r.year}) and all its figures? This cannot be undone.`)) return;
    try { await deleteAccount(r.id); toast.success('Deleted'); if (openId === r.id) setOpenId(null); load(); } catch (e) { toast.error(e.message); }
  };
  const open = rows?.find((r) => r.id === openId);

  if (rows === null) return <div className="card p-6 text-gray-400"><Loader2 className="animate-spin" /></div>;
  if (open) return <BizEditor key={open.id} acc={open} role="admin" client={client} clients={clients} onClose={() => { setOpenId(null); load(); }} onSaved={(row) => setRows((rs) => rs.map((x) => (x.id === row.id ? row : x)))} />;

  return (
    <div className="space-y-4">
      <div className="card overflow-hidden">
        <div className="flex flex-wrap items-center gap-3 bg-gradient-to-r from-primary-800 to-indigo-800 px-4 py-4 text-white">
          <div className="flex h-11 w-11 items-center justify-center rounded-2xl bg-white/15"><Store size={20} /></div>
          <div className="min-w-0 flex-1"><div className="font-bold">Business income — sole proprietor &amp; partnership</div>
            <div className="text-xs text-primary-100">The client fills income, expenses &amp; assets (annual or monthly); you adjust, finalise and send it to the IIT return.</div></div>
          <button type="button" disabled={missing} onClick={() => setForm({ year: filingYear(), kind: 'sole', name: '', tin: '', mode: 'annual' })} className="flex items-center gap-1.5 rounded-xl bg-gold-500 px-3 py-2 text-sm font-bold text-primary-900 disabled:opacity-50"><Plus size={15} /> New business</button>
        </div>
        {missing && <div className="flex items-center gap-2 bg-amber-50 p-3 text-sm text-amber-900"><AlertTriangle size={15} /> Run the V76 script in Supabase first.</div>}
        {form && (
          <div className="grid gap-3 border-b border-gray-100 bg-gray-50 p-4 sm:grid-cols-2 lg:grid-cols-6">
            <label className="text-xs font-semibold text-gray-600 lg:col-span-2">Business name<input autoFocus className="input mt-1" maxLength={160} value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="e.g. Perera Hardware" /></label>
            <label className="text-xs font-semibold text-gray-600">Type<select className="input mt-1" value={form.kind} onChange={(e) => setForm({ ...form, kind: e.target.value })}><option value="sole">🏪 Sole proprietor</option><option value="partnership">🤝 Partnership</option></select></label>
            <label className="text-xs font-semibold text-gray-600">Y/A<select className="input mt-1" value={form.year} onChange={(e) => setForm({ ...form, year: e.target.value })}>{YEARS.map((y) => <option key={y}>{y}</option>)}</select></label>
            <label className="text-xs font-semibold text-gray-600">{form.kind === 'partnership' ? 'Partnership TIN' : 'Business TIN (optional)'}<input className="input mt-1" maxLength={30} value={form.tin} onChange={(e) => setForm({ ...form, tin: e.target.value })} /></label>
            <label className="text-xs font-semibold text-gray-600">Figures<select className="input mt-1" value={form.mode} onChange={(e) => setForm({ ...form, mode: e.target.value })}><option value="annual">Annual totals</option><option value="monthly">Month by month</option></select></label>
            <div className="flex gap-2 sm:col-span-2 lg:col-span-6">
              <button type="button" disabled={busy || !form.name.trim()} onClick={create} className="btn-primary text-sm">{busy ? <Loader2 size={14} className="animate-spin" /> : <Plus size={14} />} Create</button>
              <button type="button" onClick={() => setForm(null)} className="btn-secondary text-sm">Cancel</button>
              {form.kind === 'partnership' && <span className="self-center text-[11px] text-gray-500">Create it under the precedent partner. Link the other partners to their TaxMate client records on the Partners tab.</span>}
            </div>
          </div>
        )}
        {rows.length === 0 && !form ? (
          <div className="p-8 text-center text-sm text-gray-400"><Store size={34} className="mx-auto mb-2 text-gray-200" />No business accounts yet. Press <b>New business</b> — the client then sees <b>Business Accounts</b> in the portal.</div>
        ) : (
          <div className="divide-y divide-gray-100">
            {rows.map((r) => {
              const st = STATUS[r.status] || STATUS.open; const R = r.result;
              return (
                <div key={r.id} className="group flex items-center gap-3 px-4 py-3 hover:bg-gray-50">
                  <button type="button" onClick={() => setOpenId(r.id)} className="flex min-w-0 flex-1 items-center gap-3 text-left">
                    <span className="text-2xl">{KIND[r.kind]?.emoji}</span>
                    <span className="min-w-0 flex-1">
                      <span className="flex flex-wrap items-center gap-2"><b className="truncate text-gray-800">{r.name}</b><span className="rounded bg-primary-50 px-1.5 text-[11px] font-bold text-primary-700">Y/A {r.year}</span><span className={`rounded-full px-2 py-0.5 text-[10px] font-semibold ${st.cls}`}>{st.short}</span></span>
                      <span className="block text-[11px] text-gray-500">{KIND[r.kind]?.en} · {r.mode === 'monthly' ? 'monthly' : 'annual'} figures · updated {fmtDate(r.updated_at)}{r.submitted_at ? ` · sent ${fmtDate(r.submitted_at)}` : ''}</span>
                    </span>
                    {R && <span className="text-right text-xs"><span className="block text-gray-400">{r.kind === 'partnership' ? 'Partnership tax' : 'Business income'}</span><b className="tabular-nums text-primary-800">Rs. {fm(r.kind === 'partnership' ? R.tax : R.bizProfit)}</b></span>}
                    <ChevronRight size={16} className="text-gray-300" />
                  </button>
                  <button type="button" onClick={() => del(r)} className="rounded p-1 text-gray-300 opacity-0 hover:text-red-600 group-hover:opacity-100" aria-label="Delete"><Trash2 size={14} /></button>
                </div>
              );
            })}
          </div>
        )}
      </div>
      {partnerOf.length > 0 && (
        <div className="card p-4">
          <div className="mb-2 flex items-center gap-2 text-sm font-bold text-primary-800"><Handshake size={16} /> Partner in</div>
          {partnerOf.map((p) => { const me = (p.result?.partners || []).find((x) => x.client_id === client.id); return (
            <div key={p.id} className="flex flex-wrap items-center gap-2 border-t border-gray-50 py-1.5 text-sm"><b>{p.name}</b><span className="text-xs text-gray-500">Y/A {p.year} · under {p.clients?.full_name}</span>
              <span className="ml-auto text-xs">{me ? <>share <b>Rs. {fm(me.biz)}</b> · tax credit <b>Rs. {fm(me.tax)}</b></> : <span className="text-gray-400">{p.status === 'final' ? 'not linked in the result — re-finalise' : 'not final yet'}</span>}</span></div>); })}
          <p className="mt-1 text-[11px] text-gray-500">Use <b>Import business computation</b> in this client's IIT return to bring the share and the tax credit (cage 906) in.</p>
        </div>
      )}
    </div>
  );
}
