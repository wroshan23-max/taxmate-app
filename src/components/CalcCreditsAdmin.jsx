// V53 — Admin: one client's Tax Calculator credits (balance, packs to approve, add / remove, history)
import { useEffect, useState } from 'react';
import toast from 'react-hot-toast';
import { Sparkles, Check, X, Plus, Minus, ChevronDown, ChevronUp, Infinity as InfinityIcon } from 'lucide-react';
import { fmtRs } from '../lib/supabase';
import { adminCalcCredits, adminCalcAdjust, adminCalcApprove, adminCalcCancel, CREDIT_KIND, TOOL_LABEL } from '../lib/calcCredits';

const when = (d) => new Date(d).toLocaleString('en-LK', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' });

export default function CalcCreditsAdmin({ client }) {
  const [st, setSt] = useState(null);
  const [n, setN] = useState('10');
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [hist, setHist] = useState(false);

  const load = () => adminCalcCredits(client.id).then(setSt).catch(e => toast.error(e.message));
  useEffect(() => { load(); }, [client.id]); // eslint-disable-line react-hooks/exhaustive-deps

  const run = async (fn, ok) => { setBusy(true); try { const r = await fn(); toast.success(typeof ok === 'function' ? ok(r) : ok); await load(); } catch (e) { toast.error(e.message); } setBusy(false); };
  const adjust = (sign) => {
    const v = Math.round(Number(n));
    if (!v || v < 1) return toast.error('Enter how many credits');
    run(() => adminCalcAdjust(client.id, sign * v, note.trim()), (bal) => `${sign > 0 ? 'Added' : 'Removed'} ${v} · balance ${bal}`).then(() => setNote(''));
  };

  if (!st) return null;
  const waiting = st.orders.filter(o => o.status === 'pending' || o.status === 'paid');

  return (
    <div className="card">
      <div className="card-header"><Sparkles size={16} /> Tax Calculator credits
        <span className="ml-auto text-xs font-normal text-gray-500">
          {st.plan ? <span className="inline-flex items-center gap-1 text-emerald-700 font-semibold"><InfinityIcon size={13} /> Unlimited ({st.plan} plan)</span>
            : st.charge === false ? 'Charging is off (Settings → Plans)' : `Auto-add after payment: ${st.auto_credit ? 'on' : 'off'}`}
        </span>
      </div>
      <div className="p-4 space-y-3">
        <div className="grid grid-cols-3 gap-2 text-center">
          <div className="rounded-xl bg-primary-50 p-2.5"><div className="text-2xl font-black text-primary-800">{st.balance}</div><div className="text-[11px] text-gray-500">credits left</div></div>
          <div className="rounded-xl bg-gray-50 p-2.5"><div className="text-2xl font-black text-gray-700">{st.free_left}<span className="text-sm text-gray-400">/{st.free_quick}</span></div><div className="text-[11px] text-gray-500">free Quick checks left</div></div>
          <div className="rounded-xl bg-gray-50 p-2.5"><div className="text-2xl font-black text-gray-700">{st.used_total}</div><div className="text-[11px] text-gray-500">calculations done</div></div>
        </div>

        {waiting.map(o => (
          <div key={o.id} className={`rounded-xl border p-3 text-sm flex items-center gap-2 flex-wrap ${o.status === 'paid' ? 'border-green-300 bg-green-50' : 'border-amber-200 bg-amber-50'}`}>
            <span className="flex-1 min-w-[180px]">
              <b>{o.credits} calculations</b> · {fmtRs(o.price)} · invoice {o.invoice_no ?? '—'}
              <span className="block text-xs text-gray-600">{o.status === 'paid' ? '✅ Paid — approve to add the credits' : `Waiting for payment · ordered ${when(o.created_at)}`}</span>
            </span>
            <button disabled={busy} onClick={() => {
              if (o.status === 'pending' && !window.confirm('This invoice is not paid yet. Add the credits anyway?')) return;
              run(() => adminCalcApprove(o.id), `${o.credits} credits added`);
            }} className="btn-primary text-xs py-1.5"><Check size={13} /> {o.status === 'paid' ? 'Approve' : 'Add now'}</button>
            {o.status === 'pending' && (
              <button disabled={busy} onClick={() => { if (window.confirm('Cancel this pack? Its unpaid invoice will be deleted.')) run(() => adminCalcCancel(o.id), 'Pack cancelled'); }}
                className="text-xs text-gray-500 hover:text-red-600 inline-flex items-center gap-0.5"><X size={12} /> Cancel</button>
            )}
          </div>
        ))}

        <div className="flex flex-wrap items-end gap-2">
          <label className="text-xs text-gray-500 flex flex-col">Credits
            <input className="input w-24 mt-1" inputMode="numeric" value={n} onChange={e => setN(e.target.value.replace(/\D/g, '').slice(0, 5))} />
          </label>
          <label className="text-xs text-gray-500 flex-1 min-w-[160px] flex flex-col">Note (optional)
            <input className="input mt-1" maxLength={300} placeholder="e.g. Paid in cash · welcome gift" value={note} onChange={e => setNote(e.target.value)} />
          </label>
          <button disabled={busy} onClick={() => adjust(1)} className="btn-secondary text-sm"><Plus size={14} /> Add</button>
          <button disabled={busy || st.balance < 1} onClick={() => adjust(-1)} className="btn-secondary text-sm"><Minus size={14} /> Remove</button>
        </div>

        {st.history.length > 0 && (
          <div>
            <button onClick={() => setHist(h => !h)} className="text-xs font-semibold text-primary-700 inline-flex items-center gap-1">
              History ({st.history.length}) {hist ? <ChevronUp size={13} /> : <ChevronDown size={13} />}
            </button>
            {hist && (
              <div className="mt-2 max-h-64 overflow-y-auto divide-y divide-gray-50 text-xs">
                {st.history.map((h, i) => {
                  const [ic, lb] = CREDIT_KIND[h.kind] ?? ['•', h.kind];
                  return (
                    <div key={i} className="flex items-center gap-2 py-1.5">
                      <span>{ic}</span>
                      <span className="flex-1 text-gray-700">{lb}{h.tool ? ` · ${TOOL_LABEL[h.tool]}` : ''}{h.note ? <span className="text-gray-400"> — {h.note}</span> : ''}</span>
                      <span className="text-gray-400 whitespace-nowrap">{when(h.at)}</span>
                      <span className={`w-10 text-right font-bold tabular-nums ${h.delta > 0 ? 'text-green-700' : h.delta < 0 ? 'text-red-600' : 'text-gray-400'}`}>{h.delta > 0 ? `+${h.delta}` : h.delta || '0'}</span>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
