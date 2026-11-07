// V53 — Calculator credits for clients: balance pill, "Calculate" gate, buy packs.
import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import toast from 'react-hot-toast';
import { Loader2, Lock, Sparkles, Infinity as InfinityIcon, ShoppingCart, Clock, X, Crown, Calculator } from 'lucide-react';
import { fmtRs, VIEW_AS, PREVIEW_MSG } from '../lib/supabase';
import { myCalcCredits, spendCalc, buyCalcPack, cancelCalcOrder, figuresHash } from '../lib/calcCredits';
import { useAuth } from '../contexts/AuthContext';
import PayInvoiceDialog from './PayInvoiceDialog';

export function useCalcCredits(enabled = true) {
  const [st, setSt] = useState(null);
  const [err, setErr] = useState(null);
  const reload = useCallback(() => myCalcCredits().then(s => { setSt(s); setErr(null); return s; }).catch(e => { setErr(e.message); setSt(null); }), []);
  useEffect(() => { if (enabled) reload(); }, [reload, enabled]);
  return { st, setSt, err, reload };
}

/**
 * Gate one calculator. `figures` = everything that changes the answer.
 * unlocked = the answer for these figures may be shown (plan / switch off / already calculated / free use).
 */
export function useCalcGate(tool, figures, enabled = true) {
  const { st, setSt, err, reload } = useCalcCredits(enabled);
  const [paid, setPaid] = useState(() => new Set());
  const [busy, setBusy] = useState(false);
  const key = useMemo(() => figuresHash({ tool, ...figures }), [tool, figures]);
  const unlimited = !!st && (!!st.plan || st.charge === false);
  const unlocked = !enabled || unlimited || paid.has(key);
  const changed = !unlocked && paid.size > 0;
  const canFree = tool === 'quick' && (st?.free_left ?? 0) > 0;
  const canPay = canFree || (st?.balance ?? 0) > 0;

  const calculate = useCallback(async () => {
    if (!enabled || busy) return false;
    if (VIEW_AS) { setPaid(p => new Set(p).add(key)); toast('Preview — shown without using a credit', { icon: '👁' }); return true; }
    setBusy(true);
    try {
      const r = await spendCalc(tool, key);
      setSt(s => (s ? { ...s, balance: r.balance ?? s.balance, free_left: r.free_left ?? s.free_left, free_used: r.reason === 'free' ? (s.free_used ?? 0) + 1 : s.free_used } : s));
      if (!r.ok) { toast.error(tool === 'quick' ? 'Your free checks are used up — buy calculation credits to continue.' : 'No calculation credits left — buy a pack to continue.'); return false; }
      setPaid(p => new Set(p).add(key));
      if (r.reason === 'free') toast.success(r.free_left > 0 ? `Free check used · ${r.free_left} left` : 'That was your last free check');
      else if (r.reason === 'credit') toast.success(`1 credit used · ${r.balance} left`);
      return true;
    } catch (e) { toast.error(e.message); return false; }
    finally { setBusy(false); }
  }, [enabled, busy, tool, key, setSt]);

  return { st, err, reload, unlocked, unlimited, changed, busy, calculate, canPay, canFree };
}

/** Small line: "12 calculations left · Buy more" / "Unlimited — Standard plan" */
export function CreditPill({ gate, tool, dark = false }) {
  const { st } = gate;
  if (!st) return null;
  const base = `inline-flex items-center gap-1.5 text-xs font-semibold rounded-full px-2.5 py-1 ${dark ? 'bg-white/15 text-white' : 'bg-primary-50 text-primary-800 border border-primary-100'}`;
  if (st.plan) return <span className={base}><InfinityIcon size={13} /> Unlimited · {st.plan} plan</span>;
  if (st.charge === false) return <span className={base}><InfinityIcon size={13} /> Free for now</span>;
  return (
    <span className={base}>
      <Sparkles size={13} />
      {tool === 'quick' && st.free_left > 0 ? `${st.free_left} free check${st.free_left === 1 ? '' : 's'} left` : `${st.balance} calculation${st.balance === 1 ? '' : 's'} left`}
      {tool === 'quick' && st.free_left > 0 && st.balance > 0 && <span className="opacity-70">· +{st.balance} credits</span>}
      <a href="#buy-credits" className="underline underline-offset-2 opacity-90 hover:opacity-100">Buy</a>
    </span>
  );
}

/** Shown instead of the answer until the client presses Calculate */
export function CalcGateCard({ gate, tool, ready, readyHint }) {
  const { st, err, busy, calculate, changed, canPay, canFree } = gate;
  if (err) return <div className="card p-5 text-sm text-red-600">{err}</div>;
  if (!st) return <div className="card p-8 text-center"><Loader2 className="animate-spin mx-auto text-gray-400" /></div>;
  return (
    <div className="card overflow-hidden" id="calc-gate">
      <div className="bg-gradient-to-br from-primary-700 to-primary-900 text-white p-5 text-center space-y-2">
        <div className="w-12 h-12 rounded-2xl bg-white/15 mx-auto flex items-center justify-center">{canPay ? <Calculator size={24} /> : <Lock size={22} />}</div>
        <div className="text-lg font-bold">{changed ? 'Your figures changed' : canPay ? 'Ready to calculate' : 'Buy calculation credits'}</div>
        <div className="text-sm text-primary-200">
          {!ready ? (readyHint || 'Enter your income to calculate your tax.')
            : canPay ? (canFree ? `Uses 1 of your ${st.free_left} free check${st.free_left === 1 ? '' : 's'}.` : `Uses 1 credit · you have ${st.balance}.`)
            : tool === 'quick' ? `You have used your ${st.free_quick} free checks.` : 'Each calculation uses 1 credit.'}
        </div>
        {canPay && (
          <button onClick={calculate} disabled={busy || !ready}
            className="mt-1 w-full rounded-xl bg-gold-500 hover:bg-gold-400 disabled:opacity-50 text-primary-900 font-bold py-3 inline-flex items-center justify-center gap-2">
            {busy ? <Loader2 size={18} className="animate-spin" /> : <Calculator size={18} />} {changed ? 'Recalculate' : 'Calculate my tax'}
          </button>
        )}
        <div className="text-[11px] text-primary-300">The same figures again within 24 hours are free.</div>
      </div>
      {!canPay && <div className="p-4"><BuyPacks st={st} reload={gate.reload} compact /></div>}
    </div>
  );
}

/** Packs to buy + packs waiting for payment */
export function BuyPacks({ st, reload, compact = false }) {
  const { profile } = useAuth();
  const [busy, setBusy] = useState(null);
  const [paying, setPaying] = useState(null);
  const waiting = (st?.orders ?? []).filter(o => o.status === 'pending' || o.status === 'paid');
  if (!st) return null;

  if (st.plan) return (
    <div className="text-sm text-gray-600 flex items-center gap-2"><Crown size={16} className="text-gold-500" /> Unlimited calculations are included in your <b>{st.plan}</b> plan.</div>
  );

  const buy = async (p) => {
    if (VIEW_AS) return toast(PREVIEW_MSG, { icon: '👁' });
    setBusy(p.i);
    try {
      const r = await buyCalcPack(p.i);
      toast.success(`Invoice ${r.invoice_no} created — pay to add ${r.credits} calculations`);
      await reload();
      setPaying({ id: r.invoice_id, invoice_no: r.invoice_no, total_amount: r.total });
    } catch (e) { toast.error(e.message); }
    setBusy(null);
  };
  const cancel = async (o) => {
    if (VIEW_AS) return toast(PREVIEW_MSG, { icon: '👁' });
    if (!window.confirm(`Cancel the ${o.credits}-calculation pack and its invoice ${o.invoice_no ?? ''}?`)) return;
    try { await cancelCalcOrder(o.id); toast.success('Pack cancelled'); reload(); } catch (e) { toast.error(e.message); }
  };

  return (
    <div id="buy-credits" className="space-y-3 scroll-mt-4">
      {!compact && (
        <div>
          <div className="font-bold text-gray-800 flex items-center gap-2"><ShoppingCart size={17} className="text-primary-600" /> Calculation credits</div>
          <div className="text-xs text-gray-500">1 credit = 1 calculation in the Tax Calculator or Quick Tax Check · credits do not expire</div>
        </div>
      )}
      {waiting.map(o => (
        <div key={o.id} className={`rounded-xl border p-3 text-sm flex items-center gap-2 flex-wrap ${o.status === 'paid' ? 'border-green-200 bg-green-50' : 'border-amber-200 bg-amber-50'}`}>
          <Clock size={15} className={o.status === 'paid' ? 'text-green-700' : 'text-amber-700'} />
          <span className="flex-1 min-w-[160px]">
            <b>{o.credits} calculations</b> · {fmtRs(o.price)}
            <span className="block text-xs text-gray-600">{o.status === 'paid' ? 'Paid — TaxMate will add the credits shortly' : `Invoice ${o.invoice_no ?? ''} · waiting for payment`}</span>
          </span>
          {o.status === 'pending' && o.invoice_id && (
            <>
              <button onClick={() => (VIEW_AS ? toast(PREVIEW_MSG, { icon: '👁' }) : setPaying({ id: o.invoice_id, invoice_no: o.invoice_no, total_amount: o.price }))} className="btn-primary text-xs py-1.5">Pay now</button>
              <button onClick={() => cancel(o)} className="text-xs text-gray-500 hover:text-red-600 inline-flex items-center gap-0.5"><X size={12} /> Cancel</button>
            </>
          )}
        </div>
      ))}
      <div className="grid grid-cols-3 gap-2">
        {st.packs.map((p, n) => (
          <button key={p.i} onClick={() => buy(p)} disabled={busy !== null}
            className={`relative rounded-2xl border-2 p-3 text-center transition-all hover:shadow-md disabled:opacity-60 ${n === 1 ? 'border-gold-500 bg-amber-50' : 'border-gray-200 bg-white hover:border-primary-300'}`}>
            {n === 1 && <span className="absolute -top-2 left-1/2 -translate-x-1/2 text-[9px] font-black uppercase tracking-wide bg-gold-500 text-primary-900 rounded-full px-2 py-0.5 whitespace-nowrap">Best value</span>}
            <div className="text-2xl font-black text-primary-800">{p.credits}</div>
            <div className="text-[11px] text-gray-500 -mt-0.5">calculations</div>
            <div className="text-sm font-bold text-gray-800 mt-1">{fmtRs(p.price)}</div>
            <div className="text-[10px] text-gray-400">{fmtRs(p.price / p.credits)} each</div>
            {busy === p.i && <Loader2 size={14} className="animate-spin absolute top-2 right-2 text-gray-400" />}
          </button>
        ))}
      </div>
      <div className="text-[11px] text-gray-500">
        Or get <b>unlimited</b> calculations with a monthly plan that includes them — <Link to="/client/plan" className="text-primary-700 underline">see plans</Link>.
      </div>
      {paying && profile?.client_id && (
        <PayInvoiceDialog invoice={paying} clientId={profile.client_id} onClose={() => setPaying(null)} onSubmitted={reload} />
      )}
    </div>
  );
}
