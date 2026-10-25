import { useEffect, useState } from 'react';
import { Link, useLocation, useOutletContext } from 'react-router-dom';
import toast from 'react-hot-toast';
import { Crown, Check, Loader2, Clock, X, Receipt, MessageCircle } from 'lucide-react';
import { supabase, fmtRs, fmtDate } from '../../lib/supabase';
import { myPlans, requestPlan, cancelPlanRequest, planStyle, rsPlan, myAddons, requestAddon, cancelAddonRequest, addonEmoji } from '../../lib/plans';
import { FIRM } from '../../lib/iitStatement';
import { waNumber } from '../../lib/share';

// IIT filing is covered only after the plan is 3 months old
const IIT_NOTE = 'If your plan is less than 3 months old when your Annual Income Tax Return (IIT) is filed, the relevant IIT filing charges apply.';
const IIT_NOTE_SI = 'සැලසුම ආරම්භ කර මාස 3කට අඩු නම්, වාර්ෂික ආදායම් බදු වාර්තාව (IIT) ගොනු කිරීමට අදාළ ගාස්තු අය කෙරේ.';
const plus3m = (d) => { const x = new Date(d); x.setMonth(x.getMonth() + 3); return x; };

export default function ClientPlan() {
  const features = useOutletContext() ?? {};
  const [d, setD] = useState(null);
  const [invs, setInvs] = useState([]);
  const [pick, setPick] = useState(null);
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [ad, setAd] = useState(null);          // add-on services
  const [pickAd, setPickAd] = useState(null);

  const load = async () => {
    try { setD(await myPlans()); } catch (e) { toast.error(e.message); setD({ plans: [], current: null, request: null }); }
    const { data } = await supabase.from('invoices').select('id, invoice_no, period, total_amount, status, due_date').not('subscription_id', 'is', null).order('created_at', { ascending: false }).limit(12);
    setInvs(data ?? []);
    myAddons().then(setAd).catch(() => setAd({ addons: [], mine: [], payroll: {} }));
  };
  useEffect(() => { load(); }, []);
  const loc = useLocation();
  useEffect(() => { if (ad && loc.hash === '#addons') setTimeout(() => document.getElementById('addons')?.scrollIntoView({ behavior: 'smooth' }), 100); }, [ad, loc.hash]);

  if (features.loaded && features.plans === false) return (
    <div className="card p-8 text-center space-y-3"><Crown size={36} className="mx-auto text-gray-300" /><p className="text-gray-600">Monthly plans are not available right now.</p><Link to="/client" className="btn-secondary text-sm inline-flex">Back to dashboard</Link></div>
  );
  if (!d) return <div className="card p-10 text-center"><Loader2 className="animate-spin mx-auto text-gray-400" /></div>;

  const send = async () => {
    setBusy(true);
    try { await requestPlan(pick.key, note); toast.success(`Request sent — TaxMate will confirm your ${pick.name} plan`); setPick(null); setNote(''); load(); }
    catch (e) { toast.error(e.message); }
    setBusy(false);
  };
  const cur = d.current, req = d.request;
  const iitFrom = cur?.start_date ? plus3m(cur.start_date) : null;
  const iitPending = iitFrom && iitFrom > new Date() && cur.plan_key !== 'starter';   // Starter doesn't include IIT filing

  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-2xl font-bold text-primary-800 flex items-center gap-2"><Crown size={24} className="text-gold-500" /> My Plan</h1>
        <p className="text-sm text-gray-500">One simple monthly fee — your tax and accounts looked after all year · මාසික සැලසුම්</p>
      </div>

      {cur && (
        <div className="card p-4 flex items-center gap-3 flex-wrap bg-gradient-to-r from-primary-50 to-white">
          <div className="text-3xl">{planStyle(cur.plan_key).emoji}</div>
          <div className="flex-1"><div className="font-bold text-gray-800">You're on the {cur.plan_name} plan</div><div className="text-xs text-gray-500">{rsPlan(cur.price)} / month · since {fmtDate(cur.start_date)}{cur.status === 'paused' ? ' · paused' : cur.next_bill_date ? ` · next invoice ${fmtDate(cur.next_bill_date)}` : ''}</div></div>
          <Link to="/client/invoices" className="btn-secondary text-xs py-1.5"><Receipt size={13} /> My invoices</Link>
        </div>
      )}
      {req && (
        <div className="card p-4 flex items-center gap-3 flex-wrap border border-amber-200 bg-amber-50">
          <Clock size={20} className="text-amber-600" />
          <div className="flex-1 text-sm">You asked for the <b>{req.plan_name}</b> plan ({rsPlan(req.price)}/month) on {fmtDate(req.created_at)}. TaxMate will confirm and send the first invoice.</div>
          <button onClick={async () => { try { await cancelPlanRequest(); load(); } catch (e) { toast.error(e.message); } }} className="text-xs text-gray-600 hover:text-red-600">Cancel request</button>
        </div>
      )}

      <div className={`grid gap-4 ${d.plans.length >= 4 ? 'sm:grid-cols-2 xl:grid-cols-4' : 'md:grid-cols-3'}`}>
        {d.plans.map(p => {
          const st = planStyle(p.key); const mine = cur?.plan_key === p.key; const asked = req?.plan_key === p.key;
          return (
            <div key={p.key} className={`card overflow-hidden flex flex-col ${mine ? `ring-2 ${st.ring}` : ''} ${p.key === 'standard' ? 'md:-translate-y-1 shadow-lg' : ''}`}>
              <div className={`bg-gradient-to-br ${st.head} text-white p-5`}>
                <div className="flex items-center gap-2"><span className="text-2xl">{st.emoji}</span><span className="text-lg font-bold">{p.name}</span>{p.key === 'standard' && <span className="ml-auto text-[10px] font-bold uppercase bg-white/20 rounded-full px-2 py-0.5 whitespace-nowrap">★ Popular</span>}</div>
                <div className="text-3xl xl:text-[1.65rem] 2xl:text-3xl font-black mt-3 whitespace-nowrap">{rsPlan(p.price)}<span className="text-sm font-normal opacity-80"> / month</span></div>
                <div className="text-xs opacity-90 mt-1">{p.tagline}</div>
              </div>
              <ul className="p-5 space-y-2 text-sm flex-1">
                {(p.features ?? []).map((x, i) => <li key={i} className="flex gap-2"><Check size={16} className="text-emerald-600 flex-shrink-0 mt-0.5" /><span>{x}</span></li>)}
              </ul>
              <div className="p-5 pt-0">
                {mine ? <div className="text-center text-sm font-semibold text-emerald-700 py-2">✓ Your current plan</div>
                  : asked ? <div className="text-center text-sm font-semibold text-amber-700 py-2">Requested</div>
                  : <button onClick={() => setPick(p)} className="btn-primary w-full justify-center">{cur ? `Switch to ${p.name}` : `Choose ${p.name}`}</button>}
              </div>
            </div>
          );
        })}
      </div>

      <p className="text-[11px] leading-relaxed text-gray-400 px-1">
        * {IIT_NOTE} <span className="block sm:inline">{IIT_NOTE_SI}</span>
        {iitPending && <span className="block mt-0.5">Your plan covers IIT filing from {fmtDate(iitFrom.toISOString())}.</span>}
      </p>

      {pick && (
        <div className="fixed inset-0 bg-black/40 z-50 flex items-end sm:items-center justify-center p-4" onClick={() => setPick(null)}>
          <div className="bg-white rounded-2xl w-full max-w-md p-5 space-y-3" onClick={e => e.stopPropagation()}>
            <div className="flex items-center gap-2"><div className="text-2xl">{planStyle(pick.key).emoji}</div><div className="font-bold text-lg flex-1">{pick.name} plan · {rsPlan(pick.price)}/month</div><button onClick={() => setPick(null)} className="p-1"><X size={18} /></button></div>
            <p className="text-sm text-gray-600">TaxMate will confirm your plan and send a monthly invoice. Pay online or by bank transfer. You can change or cancel any time.</p>
            <p className="text-[11px] text-gray-400 -mt-1">* {IIT_NOTE}</p>
            <textarea className="input text-sm resize-none" rows={2} maxLength={500} placeholder="Anything we should know? (optional — e.g. I have 2 employees)" value={note} onChange={e => setNote(e.target.value)} />
            <button onClick={send} disabled={busy} className="btn-primary w-full justify-center">{busy ? <Loader2 size={15} className="animate-spin" /> : <Crown size={15} />} Send request</button>
          </div>
        </div>
      )}

      {ad?.addons?.length > 0 && (
        <div id="addons" className="space-y-3 scroll-mt-4">
          <div>
            <h2 className="text-lg font-bold text-primary-800">Add-on services <span className="text-sm font-normal text-gray-500">· අමතර සේවා</span></h2>
            <p className="text-xs text-gray-500">Add a service on its own — no need to change your plan.</p>
          </div>
          <div className="grid md:grid-cols-2 gap-4">
            {ad.addons.map(a => {
              const mine = ad.mine.find(m => m.addon_key === a.key && m.status !== 'requested');
              const asked = ad.mine.find(m => m.addon_key === a.key && m.status === 'requested');
              const inPlan = a.key === 'payroll' && ad.payroll?.plan;
              const link = a.key === 'payroll' ? '/client/payroll' : null;
              return (
                <div key={a.key} className={`card p-5 flex flex-col gap-3 ${mine || inPlan ? 'ring-2 ring-emerald-200' : ''}`}>
                  <div className="flex items-start gap-3">
                    <div className="text-3xl">{addonEmoji(a.key)}</div>
                    <div className="flex-1"><div className="font-bold text-gray-800">{a.name}</div><div className="text-xs text-gray-500">{a.tagline}</div></div>
                    {!inPlan && <div className="text-right"><div className="font-black text-primary-800">{rsPlan(mine?.price ?? a.price)}</div><div className="text-[10px] text-gray-400">/ month</div></div>}
                  </div>
                  <ul className="space-y-1 text-sm flex-1">{(a.features ?? []).map((x, i) => <li key={i} className="flex gap-2"><Check size={15} className="text-emerald-600 flex-shrink-0 mt-0.5" /><span>{x}</span></li>)}</ul>
                  {inPlan ? (
                    <div className="flex items-center gap-2 flex-wrap"><span className="text-sm font-semibold text-emerald-700">✓ Included in your {ad.payroll.plan} plan</span>{link && <Link to={link} className="ml-auto btn-secondary text-xs py-1.5">Open {a.name.split(' ')[0]} →</Link>}</div>
                  ) : mine ? (
                    <div className="flex items-center gap-2 flex-wrap"><span className="text-sm font-semibold text-emerald-700">{mine.status === 'paused' ? '⏸ Paused' : `✓ Active since ${fmtDate(mine.start_date)}`}</span>{link && mine.status === 'active' && <Link to={link} className="ml-auto btn-secondary text-xs py-1.5">Open {a.name.split(' ')[0]} →</Link>}</div>
                  ) : asked ? (
                    <div className="flex items-center gap-2 flex-wrap text-sm"><Clock size={15} className="text-amber-600" /><span className="text-amber-800">Requested on {fmtDate(asked.created_at)} — TaxMate will confirm.</span>
                      <button onClick={async () => { try { await cancelAddonRequest(a.key); load(); } catch (e) { toast.error(e.message); } }} className="ml-auto text-xs text-gray-500 hover:text-red-600">Cancel request</button></div>
                  ) : (
                    <button onClick={() => { setPickAd(a); setNote(''); }} className="btn-primary w-full justify-center">Request {a.name}</button>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      )}

      {pickAd && (
        <div className="fixed inset-0 bg-black/40 z-50 flex items-end sm:items-center justify-center p-4" onClick={() => setPickAd(null)}>
          <div className="bg-white rounded-2xl w-full max-w-md p-5 space-y-3" onClick={e => e.stopPropagation()}>
            <div className="flex items-center gap-2"><div className="text-2xl">{addonEmoji(pickAd.key)}</div><div className="font-bold text-lg flex-1">{pickAd.name} · {rsPlan(pickAd.price)}/month</div><button onClick={() => setPickAd(null)} className="p-1"><X size={18} /></button></div>
            <p className="text-sm text-gray-600">TaxMate will confirm and add it to your monthly invoice. You can stop it any time.</p>
            <textarea className="input text-sm resize-none" rows={2} maxLength={500} placeholder={pickAd.key === 'payroll' ? 'How many staff do you have? (optional)' : 'Anything we should know? (optional)'} value={note} onChange={e => setNote(e.target.value)} />
            <button disabled={busy} onClick={async () => { setBusy(true); try { await requestAddon(pickAd.key, note); toast.success(`Request sent — TaxMate will confirm ${pickAd.name}`); setPickAd(null); setNote(''); load(); } catch (e) { toast.error(e.message); } setBusy(false); }}
              className="btn-primary w-full justify-center">{busy ? <Loader2 size={15} className="animate-spin" /> : <Check size={15} />} Send request</button>
          </div>
        </div>
      )}

      {invs.length > 0 && (
        <div className="card">
          <div className="card-header"><Receipt size={16} /> Plan invoices</div>
          <div className="divide-y divide-gray-50 text-sm">
            {invs.map(i => (
              <Link key={i.id} to="/client/invoices" className="flex items-center gap-3 px-5 py-2.5 hover:bg-gray-50">
                <span className="font-mono text-xs">{i.invoice_no}</span><span className="text-gray-500 text-xs">{i.period}</span>
                <span className="ml-auto font-semibold">{fmtRs(i.total_amount)}</span>
                <span className={`text-xs font-semibold ${i.status === 'paid' ? 'text-emerald-700' : 'text-amber-700'}`}>{i.status === 'paid' ? 'Paid' : 'Pay now →'}</span>
              </Link>
            ))}
          </div>
        </div>
      )}

      <p className="text-xs text-gray-400 text-center">Questions? <a className="text-primary-700 hover:underline inline-flex items-center gap-1" href={`https://wa.me/${waNumber(FIRM.whatsapp)}?text=${encodeURIComponent('Hi TaxMate, I have a question about the monthly plans.')}`} target="_blank" rel="noreferrer"><MessageCircle size={12} /> WhatsApp us</a></p>
    </div>
  );
}
