import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import toast from 'react-hot-toast';
import { Crown, Loader2, Receipt, Play, Pause, XCircle, Check, Save, Plus } from 'lucide-react';
import { supabase, fmtRs, fmtDate } from '../lib/supabase';
import { loadPlans, SUB_STATUS, planStyle, rsPlan, activateRequest, billNow } from '../lib/plans';

const todayISO = () => new Date().toISOString().slice(0, 10);

/** Admin: the client's monthly plan — assign, approve requests, bill, pause / cancel. */
export default function SubscriptionAdmin({ client, userId }) {
  const [plans, setPlans] = useState([]);
  const [subs, setSubs] = useState(null);
  const [invs, setInvs] = useState([]);
  const [f, setF] = useState(null);           // new plan form
  const [edit, setEdit] = useState(null);     // edit live plan
  const [busy, setBusy] = useState(false);

  const load = async () => {
    const [p, { data: s }, { data: i }] = await Promise.all([
      loadPlans(),
      supabase.from('subscriptions').select('*').eq('client_id', client.id).order('created_at', { ascending: false }),
      supabase.from('invoices').select('id, invoice_no, period, total_amount, status, due_date').eq('client_id', client.id).not('subscription_id', 'is', null).order('created_at', { ascending: false }).limit(6),
    ]);
    setPlans(p); setSubs(s ?? []); setInvs(i ?? []);
  };
  useEffect(() => { load(); }, [client.id]); // eslint-disable-line react-hooks/exhaustive-deps

  const live = subs?.find(s => s.status === 'active' || s.status === 'paused');
  const req = subs?.find(s => s.status === 'requested');
  const run = async (fn, ok) => { setBusy(true); try { await fn(); if (ok) toast.success(ok); await load(); } catch (e) { toast.error(e.message || String(e)); } setBusy(false); };

  const start = () => run(async () => {
    const p = plans.find(x => x.key === f.plan);
    if (!p) throw new Error('Choose a plan');
    if (live) {
      const { error: e1 } = await supabase.from('subscriptions').update({ status: 'cancelled', cancelled_at: new Date().toISOString(), updated_at: new Date().toISOString() }).eq('id', live.id);
      if (e1) throw e1;
    }
    const { data: created, error } = await supabase.from('subscriptions').insert({
      client_id: client.id, plan_key: p.key, plan_name: p.name, price: Number(f.price) || 0, status: 'active',
      auto_invoice: f.auto, start_date: f.start, next_bill_date: f.start, created_by: userId,
    }).select().single();
    if (error) throw error;
    if (f.auto && f.start <= todayISO() && Number(f.price) > 0) await billNow(created);   // first month's invoice now
    setF(null);
  }, f?.auto && f?.start <= todayISO() ? 'Plan started — first invoice created' : 'Plan started');
  const saveEdit = () => run(async () => {
    const { error } = await supabase.from('subscriptions').update({ price: Number(edit.price) || 0, next_bill_date: edit.next || null, auto_invoice: edit.auto, admin_note: edit.note || null, updated_at: new Date().toISOString() }).eq('id', live.id);
    if (error) throw error;
    setEdit(null);
  }, 'Saved');
  const setStatus = (s, status, ok) => run(async () => {
    const patch = { status, updated_at: new Date().toISOString(), ...(status === 'cancelled' ? { cancelled_at: new Date().toISOString() } : {}) };
    const { error } = await supabase.from('subscriptions').update(patch).eq('id', s.id);
    if (error) throw error;
  }, ok);

  if (subs === null) return <div className="card p-5 text-center"><Loader2 className="animate-spin mx-auto text-gray-300" /></div>;
  const st = live ? planStyle(live.plan_key) : null;

  return (
    <div className="card">
      <div className="card-header"><Crown size={16} /> Monthly plan
        {live && <span className={`text-[11px] font-semibold px-2 py-0.5 rounded-md ${SUB_STATUS[live.status].cls}`}>{SUB_STATUS[live.status].label}</span>}
        {!f && <button onClick={() => setF({ plan: (req?.plan_key ?? plans.find(p => p.active !== false)?.key) || '', price: req?.price ?? plans[0]?.price ?? 0, start: todayISO(), auto: true })} className="ml-auto btn-secondary text-xs py-1"><Plus size={13} /> {live ? 'Change plan' : 'Start a plan'}</button>}
      </div>
      <div className="p-4 space-y-3">
        {req && (
          <div className="rounded-xl border border-amber-200 bg-amber-50 p-3 text-sm space-y-2">
            <div><b>{client.full_name?.split(' ')[0]}</b> asked for the <b>{req.plan_name}</b> plan ({rsPlan(req.price)}/month) on {fmtDate(req.created_at)}{req.client_note ? ` — “${req.client_note}”` : ''}.</div>
            <div className="flex gap-2 flex-wrap">
              <button disabled={busy} onClick={() => run(async () => { await activateRequest(req, { price: req.price, start: todayISO(), auto: true }); if (Number(req.price) > 0) await billNow(req); }, `${req.plan_name} plan is active — first invoice created`)} className="btn-primary text-xs py-1"><Check size={13} /> Approve (auto monthly invoice)</button>
              <button disabled={busy} onClick={() => run(() => activateRequest(req, { price: req.price, start: todayISO(), auto: false }), `${req.plan_name} plan is active — bill it manually`)} className="btn-secondary text-xs py-1">Approve (I invoice manually)</button>
              <button disabled={busy} onClick={() => setStatus(req, 'cancelled', 'Request declined')} className="text-xs text-gray-500 hover:text-red-600">Decline</button>
            </div>
          </div>
        )}

        {live ? (
          <div className={`rounded-2xl ring-2 ${st.ring} overflow-hidden`}>
            <div className={`bg-gradient-to-r ${st.head} text-white px-4 py-3 flex items-center gap-3`}>
              <div className="text-2xl">{st.emoji}</div>
              <div className="flex-1"><div className="font-bold">{live.plan_name} plan</div><div className="text-xs opacity-90">Since {fmtDate(live.start_date)} · {live.auto_invoice ? 'Auto monthly invoice' : 'Invoiced manually'}</div></div>
              <div className="text-right"><div className="text-xl font-black">{rsPlan(live.price)}</div><div className="text-[11px] opacity-90">per month</div></div>
            </div>
            <div className="p-3 space-y-2">
              <div className="text-xs text-gray-600">Next invoice: <b>{live.status === 'paused' ? 'paused' : live.next_bill_date ? fmtDate(live.next_bill_date) : '—'}</b></div>
              {edit ? (
                <div className="grid sm:grid-cols-4 gap-2 items-end">
                  <label className="text-[11px] font-semibold text-gray-500">Price / month<input className="input mt-0.5 py-1 text-xs text-right" inputMode="decimal" value={edit.price} onChange={e => setEdit({ ...edit, price: e.target.value.replace(/[^\d.]/g, '') })} /></label>
                  <label className="text-[11px] font-semibold text-gray-500">Next invoice date<input type="date" className="input mt-0.5 py-1 text-xs" value={edit.next ?? ''} onChange={e => setEdit({ ...edit, next: e.target.value })} /></label>
                  <label className="text-xs inline-flex items-center gap-1.5 pb-1.5"><input type="checkbox" checked={edit.auto} onChange={e => setEdit({ ...edit, auto: e.target.checked })} /> Auto monthly invoice</label>
                  <button onClick={saveEdit} disabled={busy} className="btn-primary text-xs py-1.5 justify-center"><Save size={13} /> Save</button>
                  <input className="input py-1 text-xs sm:col-span-4" maxLength={1000} placeholder="Private note (e.g. 10% loyalty discount)" value={edit.note ?? ''} onChange={e => setEdit({ ...edit, note: e.target.value })} />
                </div>
              ) : (
                <div className="flex gap-2 flex-wrap">
                  {live.status === 'active' && <button disabled={busy} onClick={() => run(() => billNow(live), 'Invoice created for this month')} className="btn-primary text-xs py-1"><Receipt size={13} /> Bill now</button>}
                  <button onClick={() => setEdit({ price: live.price, next: live.next_bill_date, auto: live.auto_invoice, note: live.admin_note })} className="btn-secondary text-xs py-1">Edit</button>
                  {live.status === 'active'
                    ? <button disabled={busy} onClick={() => setStatus(live, 'paused', 'Plan paused — no invoices until resumed')} className="btn-secondary text-xs py-1"><Pause size={13} /> Pause</button>
                    : <button disabled={busy} onClick={() => setStatus(live, 'active', 'Plan resumed')} className="btn-secondary text-xs py-1"><Play size={13} /> Resume</button>}
                  <button disabled={busy} onClick={() => { if (window.confirm(`Cancel the ${live.plan_name} plan? No more invoices will be created.`)) setStatus(live, 'cancelled', 'Plan cancelled'); }} className="text-xs text-gray-500 hover:text-red-600 inline-flex items-center gap-1"><XCircle size={13} /> Cancel plan</button>
                </div>
              )}
              {live.admin_note && !edit && <div className="text-[11px] text-gray-500 whitespace-pre-wrap">📝 {live.admin_note}</div>}
            </div>
          </div>
        ) : !req && !f && <p className="text-sm text-gray-400 text-center py-2">No plan. Monthly plans give TaxMate steady income — start one, or the client can request one from their portal.</p>}

        {f && (
          <div className="rounded-xl border border-primary-200 bg-primary-50/40 p-3 space-y-2">
            <div className="grid sm:grid-cols-2 gap-2">
              {plans.filter(p => p.active !== false).map(p => (
                <button key={p.key} onClick={() => setF({ ...f, plan: p.key, price: p.price })} className={`text-left rounded-xl border-2 p-2.5 ${f.plan === p.key ? 'border-primary-600 bg-white' : 'border-transparent bg-white/60 hover:border-primary-200'}`}>
                  <div className="font-bold text-sm">{planStyle(p.key).emoji} {p.name} <span className="font-normal text-gray-500">· {rsPlan(p.price)}/m</span></div>
                  <div className="text-[11px] text-gray-500">{p.tagline}</div>
                </button>
              ))}
            </div>
            <div className="grid sm:grid-cols-3 gap-2 items-end">
              <label className="text-[11px] font-semibold text-gray-500">Price / month (Rs.)<input className="input mt-0.5 py-1 text-xs text-right" inputMode="decimal" value={f.price} onChange={e => setF({ ...f, price: e.target.value.replace(/[^\d.]/g, '') })} /></label>
              <label className="text-[11px] font-semibold text-gray-500">Start / first invoice<input type="date" className="input mt-0.5 py-1 text-xs" value={f.start} onChange={e => setF({ ...f, start: e.target.value })} /></label>
              <label className="text-xs inline-flex items-center gap-1.5 pb-1.5"><input type="checkbox" checked={f.auto} onChange={e => setF({ ...f, auto: e.target.checked })} /> Auto monthly invoice</label>
            </div>
            <p className="text-[11px] text-gray-500">{f.auto ? 'Every month on this date the app creates the invoice; the client gets a reminder email before it is due and can pay online or by bank slip.' : 'No automatic invoices — use “Bill now” each month.'}{live ? ` The current ${live.plan_name} plan will be cancelled.` : ''}</p>
            <div className="flex gap-2">
              <button onClick={() => setF(null)} className="btn-secondary text-xs py-1.5 flex-1 justify-center">Cancel</button>
              <button onClick={start} disabled={busy || !f.plan} className="btn-primary text-xs py-1.5 flex-1 justify-center">{busy ? <Loader2 size={13} className="animate-spin" /> : <Crown size={13} />} Start plan</button>
            </div>
          </div>
        )}

        {invs.length > 0 && (
          <div>
            <div className="text-xs font-semibold text-gray-500 mb-1">Plan invoices</div>
            <div className="divide-y divide-gray-50 text-xs">
              {invs.map(i => (
                <Link key={i.id} to="/admin/invoices" className="flex items-center gap-2 py-1.5 hover:bg-gray-50 rounded px-1">
                  <span className="font-mono">{i.invoice_no}</span><span className="text-gray-500">{i.period}</span>
                  <span className="ml-auto">{fmtRs(i.total_amount)}</span>
                  <span className={`font-semibold ${i.status === 'paid' ? 'text-emerald-700' : 'text-amber-700'}`}>{i.status}</span>
                </Link>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
