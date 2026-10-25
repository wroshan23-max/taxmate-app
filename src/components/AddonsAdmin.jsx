import { useEffect, useState } from 'react';
import toast from 'react-hot-toast';
import { Puzzle, Loader2, Receipt, Play, Pause, XCircle, Check, Save, Plus } from 'lucide-react';
import { supabase, fmtDate } from '../lib/supabase';
import { loadAddons, loadPlans, addonEmoji, rsPlan, SUB_STATUS, billAddonNow } from '../lib/plans';

const todayISO = () => new Date().toISOString().slice(0, 10);

/** Admin: add-on services for one client (e.g. Payroll & APIT) — approve requests, start, bill, pause / cancel. */
export default function AddonsAdmin({ client, userId, onChange }) {
  const [catalog, setCatalog] = useState([]);
  const [rows, setRows] = useState(null);
  const [payrollPlan, setPayrollPlan] = useState(null);
  const [f, setF] = useState(null);
  const [edit, setEdit] = useState(null);
  const [busy, setBusy] = useState(false);

  const load = async () => {
    const [cat, plans, { data: a }, { data: sub }] = await Promise.all([
      loadAddons(), loadPlans(),
      supabase.from('service_addons').select('*').eq('client_id', client.id).in('status', ['requested', 'active', 'paused']).order('created_at', { ascending: false }),
      supabase.from('subscriptions').select('plan_key, plan_name').eq('client_id', client.id).eq('status', 'active').maybeSingle(),
    ]);
    setCatalog(cat); setRows(a ?? []);
    setPayrollPlan(sub && plans.find(p => p.key === sub.plan_key)?.includes_payroll ? sub.plan_name : null);
  };
  useEffect(() => { load(); }, [client.id]); // eslint-disable-line react-hooks/exhaustive-deps

  const run = async (fn, ok) => { setBusy(true); try { await fn(); if (ok) toast.success(ok); await load(); onChange?.(); } catch (e) { toast.error(e.message || String(e)); } setBusy(false); };
  const upd = async (id, patch) => { const { error } = await supabase.from('service_addons').update({ ...patch, updated_at: new Date().toISOString() }).eq('id', id); if (error) throw error; };

  const approve = (r, auto) => run(async () => {
    await upd(r.id, { status: 'active', start_date: todayISO(), next_bill_date: todayISO(), auto_invoice: auto, created_by: userId });
    if (auto && Number(r.price) > 0) await billAddonNow(r);
  }, auto ? `${r.addon_name} is active — first invoice created` : `${r.addon_name} is active — bill it manually`);
  const start = () => run(async () => {
    const a = catalog.find(x => x.key === f.key); if (!a) throw new Error('Choose a service');
    const { data, error } = await supabase.from('service_addons').insert({
      client_id: client.id, addon_key: a.key, addon_name: a.name, price: Number(f.price) || 0, status: 'active',
      auto_invoice: f.auto, start_date: f.start, next_bill_date: f.start, created_by: userId,
    }).select().single();
    if (error) throw error.code === '23505' ? new Error(`${a.name} is already active for this client`) : error;
    if (f.auto && f.start <= todayISO() && Number(f.price) > 0) await billAddonNow(data);
    setF(null);
  }, 'Service started');

  if (rows === null) return null;
  const reqs = rows.filter(r => r.status === 'requested');
  const live = rows.filter(r => r.status !== 'requested');
  const available = catalog.filter(a => a.active !== false && !live.some(r => r.addon_key === a.key));

  return (
    <div className="card">
      <div className="card-header"><Puzzle size={16} /> Add-on services
        {!f && available.length > 0 && <button onClick={() => { const a = available[0]; setF({ key: a.key, price: a.price, start: todayISO(), auto: true }); }} className="ml-auto btn-secondary text-xs py-1"><Plus size={13} /> Add a service</button>}
      </div>
      <div className="p-4 space-y-3">
        {payrollPlan && <div className="text-xs text-emerald-700 bg-emerald-50 rounded-lg px-3 py-2">👥 Payroll & APIT is included in the client's <b>{payrollPlan}</b> plan — no add-on needed.</div>}

        {reqs.map(r => (
          <div key={r.id} className="rounded-xl border border-amber-200 bg-amber-50 p-3 text-sm space-y-2">
            <div><b>{client.full_name?.split(' ')[0]}</b> asked for <b>{addonEmoji(r.addon_key)} {r.addon_name}</b> ({rsPlan(r.price)}/month) on {fmtDate(r.created_at)}{r.client_note ? ` — “${r.client_note}”` : ''}.</div>
            <div className="flex gap-2 flex-wrap items-center">
              <label className="text-[11px] font-semibold text-gray-600">Price / month <input className="input inline-block w-24 py-0.5 text-xs text-right ml-1" inputMode="decimal" defaultValue={r.price}
                onBlur={e => { const v = Number(e.target.value.replace(/[^\d.]/g, '')) || 0; if (v !== Number(r.price)) run(() => upd(r.id, { price: v })); }} /></label>
              <button disabled={busy} onClick={() => approve(r, true)} className="btn-primary text-xs py-1"><Check size={13} /> Approve (auto monthly invoice)</button>
              <button disabled={busy} onClick={() => approve(r, false)} className="btn-secondary text-xs py-1">Approve (I invoice manually)</button>
              <button disabled={busy} onClick={() => run(() => upd(r.id, { status: 'cancelled', cancelled_at: new Date().toISOString() }), 'Request declined')} className="text-xs text-gray-500 hover:text-red-600">Decline</button>
            </div>
          </div>
        ))}

        {live.map(r => (
          <div key={r.id} className="rounded-xl border border-gray-200 p-3 space-y-2">
            <div className="flex items-center gap-2 flex-wrap">
              <span className="text-xl">{addonEmoji(r.addon_key)}</span>
              <div className="flex-1 min-w-0"><div className="font-semibold text-sm">{r.addon_name} <span className={`text-[11px] font-semibold px-2 py-0.5 rounded-md ${SUB_STATUS[r.status].cls}`}>{SUB_STATUS[r.status].label}</span></div>
                <div className="text-xs text-gray-500">Since {fmtDate(r.start_date)} · {r.auto_invoice ? 'auto monthly invoice' : 'invoiced manually'} · next {r.status === 'paused' ? 'paused' : r.next_bill_date ? fmtDate(r.next_bill_date) : '—'}</div></div>
              <div className="font-black text-primary-800">{rsPlan(r.price)}<span className="text-xs font-normal text-gray-400">/m</span></div>
            </div>
            {edit?.id === r.id ? (
              <div className="grid sm:grid-cols-4 gap-2 items-end">
                <label className="text-[11px] font-semibold text-gray-500">Price / month<input className="input mt-0.5 py-1 text-xs text-right" inputMode="decimal" value={edit.price} onChange={e => setEdit({ ...edit, price: e.target.value.replace(/[^\d.]/g, '') })} /></label>
                <label className="text-[11px] font-semibold text-gray-500">Next invoice date<input type="date" className="input mt-0.5 py-1 text-xs" value={edit.next ?? ''} onChange={e => setEdit({ ...edit, next: e.target.value })} /></label>
                <label className="text-xs inline-flex items-center gap-1.5 pb-1.5"><input type="checkbox" checked={edit.auto} onChange={e => setEdit({ ...edit, auto: e.target.checked })} /> Auto monthly invoice</label>
                <button disabled={busy} onClick={() => run(async () => { await upd(r.id, { price: Number(edit.price) || 0, next_bill_date: edit.next || null, auto_invoice: edit.auto }); setEdit(null); }, 'Saved')} className="btn-primary text-xs py-1.5 justify-center"><Save size={13} /> Save</button>
              </div>
            ) : (
              <div className="flex gap-2 flex-wrap">
                {r.status === 'active' && <button disabled={busy} onClick={() => run(() => billAddonNow(r), 'Invoice created for this month')} className="btn-primary text-xs py-1"><Receipt size={13} /> Bill now</button>}
                <button onClick={() => setEdit({ id: r.id, price: r.price, next: r.next_bill_date, auto: r.auto_invoice })} className="btn-secondary text-xs py-1">Edit</button>
                {r.status === 'active'
                  ? <button disabled={busy} onClick={() => run(() => upd(r.id, { status: 'paused' }), 'Paused — no invoices until resumed')} className="btn-secondary text-xs py-1"><Pause size={13} /> Pause</button>
                  : <button disabled={busy} onClick={() => run(() => upd(r.id, { status: 'active' }), 'Resumed')} className="btn-secondary text-xs py-1"><Play size={13} /> Resume</button>}
                <button disabled={busy} onClick={() => { if (window.confirm(`Stop ${r.addon_name}? No more invoices will be created.`)) run(() => upd(r.id, { status: 'cancelled', cancelled_at: new Date().toISOString() }), 'Service stopped'); }} className="text-xs text-gray-500 hover:text-red-600 inline-flex items-center gap-1"><XCircle size={13} /> Stop</button>
              </div>
            )}
          </div>
        ))}

        {!rows.length && !f && <p className="text-sm text-gray-400 text-center py-1">No add-on services. Clients can request them from My Plan, or add one here.</p>}

        {f && (
          <div className="rounded-xl border border-primary-200 bg-primary-50/40 p-3 space-y-2">
            <div className="grid sm:grid-cols-2 gap-2">
              {available.map(a => (
                <button key={a.key} onClick={() => setF({ ...f, key: a.key, price: a.price })} className={`text-left rounded-xl border-2 p-2.5 ${f.key === a.key ? 'border-primary-600 bg-white' : 'border-transparent bg-white/60 hover:border-primary-200'}`}>
                  <div className="font-bold text-sm">{addonEmoji(a.key)} {a.name} <span className="font-normal text-gray-500">· {rsPlan(a.price)}/m</span></div>
                  <div className="text-[11px] text-gray-500">{a.tagline}</div>
                </button>
              ))}
            </div>
            <div className="grid sm:grid-cols-3 gap-2 items-end">
              <label className="text-[11px] font-semibold text-gray-500">Price / month (Rs.)<input className="input mt-0.5 py-1 text-xs text-right" inputMode="decimal" value={f.price} onChange={e => setF({ ...f, price: e.target.value.replace(/[^\d.]/g, '') })} /></label>
              <label className="text-[11px] font-semibold text-gray-500">Start / first invoice<input type="date" className="input mt-0.5 py-1 text-xs" value={f.start} onChange={e => setF({ ...f, start: e.target.value })} /></label>
              <label className="text-xs inline-flex items-center gap-1.5 pb-1.5"><input type="checkbox" checked={f.auto} onChange={e => setF({ ...f, auto: e.target.checked })} /> Auto monthly invoice</label>
            </div>
            <div className="flex gap-2">
              <button onClick={() => setF(null)} className="btn-secondary text-xs py-1.5 flex-1 justify-center">Cancel</button>
              <button onClick={start} disabled={busy || !f.key} className="btn-primary text-xs py-1.5 flex-1 justify-center">{busy ? <Loader2 size={13} className="animate-spin" /> : <Puzzle size={13} />} Start service</button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
