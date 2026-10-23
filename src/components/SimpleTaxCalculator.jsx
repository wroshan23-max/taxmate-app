import { useMemo, useState } from 'react';
import { Globe2, Landmark, CalendarRange, ChevronDown, Info, PartyPopper, ArrowRightLeft } from 'lucide-react';
import { computePersonal, TAX_YEARS } from '../lib/iitCalc';
import TopUpCalc from './TopUpCalc';
import TaxSavingTips from './TaxSavingTips';

const YEARS = ['2025/26', '2026/27'];
const rs = (v) => Math.round(v || 0).toLocaleString('en-LK');
const toNum = (s) => parseFloat(String(s ?? '').replace(/,/g, '')) || 0;
const BAND_COLORS = { 0.06: 'bg-sky-400', 0.18: 'bg-indigo-400', 0.24: 'bg-violet-500', 0.30: 'bg-fuchsia-500', 0.36: 'bg-rose-500', 0.12: 'bg-blue-400', 0.15: 'bg-amber-500' };

function BigMoney({ value, onChange, autoFocus }) {
  const [focus, setFocus] = useState(false);
  const shown = focus || value === '' ? value : toNum(value).toLocaleString('en-LK');
  return (
    <div className="relative">
      <span className="absolute left-4 top-1/2 -translate-y-1/2 text-sm font-bold text-gray-400">Rs.</span>
      <input autoFocus={autoFocus} inputMode="decimal" placeholder="0" value={shown}
        className="w-full rounded-2xl border-2 border-gray-200 bg-white pl-14 pr-11 py-4 text-right text-2xl sm:text-3xl font-black text-primary-800 tabular-nums outline-none focus:border-primary-500 focus:ring-4 focus:ring-primary-100 transition-all placeholder:text-gray-300"
        onFocus={() => setFocus(true)} onBlur={() => setFocus(false)} onChange={e => onChange(e.target.value.replace(/[^\d.]/g, ''))} />
      <TopUpCalc value={value} onUse={onChange} className="!right-3" />
    </div>
  );
}

/** Simple income-tax estimate: local + foreign income → tax. mode: 'public' | 'client' */
export default function SimpleTaxCalculator({ mode = 'public' }) {
  const [year, setYear] = useState('2025/26');
  const [period, setPeriod] = useState('monthly');
  const [local, setLocal] = useState('');
  const [foreign, setForeign] = useState('');
  const [fxOpen, setFxOpen] = useState(false);
  const [fx, setFx] = useState({ amount: '', rate: '', cur: 'USD' });

  const k = period === 'monthly' ? 12 : 1;
  const x = useMemo(() => ({ salary: toNum(local) * k, foreignFx: toNum(foreign) * k }), [local, foreign, k]);
  const r = useMemo(() => computePersonal(year, x), [year, x]);
  const income = r.totalAss;
  const hasIncome = income > 0;
  const per = (v) => (period === 'monthly' ? v / 12 : v);
  const rate = income > 0 ? (r.tax / income) * 100 : 0;

  // income bar: tax-free part + each band
  const segs = [];
  if (r.prUsed > 0) segs.push({ key: 'pr', w: r.prUsed, cls: 'bg-emerald-400', label: 'Tax-free allowance', amt: r.prUsed, tax: 0 });
  r.local.detail.forEach((d, i) => d.taxed > 0 && segs.push({ key: `l${i}`, w: d.taxed, cls: BAND_COLORS[d.rate] ?? 'bg-gray-400', label: `Local @ ${Math.round(d.rate * 100)}%`, amt: d.taxed, tax: d.tax }));
  r.foreign.bands.forEach((b, i) => segs.push({ key: `f${i}`, w: b.taxed, cls: b.rate === 0.15 ? 'bg-amber-500' : 'bg-sky-300', label: `Foreign @ ${Math.round(b.rate * 100)}%`, amt: b.taxed, tax: b.tax }));
  const totalW = segs.reduce((t, s) => t + s.w, 0) || 1;

  const useFx = () => {
    const v = toNum(fx.amount) * toNum(fx.rate);
    if (v > 0) { setForeign(String(Math.round(v))); setFxOpen(false); }
  };

  return (
    <div className="space-y-5">
      {/* Controls */}
      <div className="flex flex-wrap items-center gap-2">
        <div className="inline-flex rounded-2xl bg-white border border-gray-200 p-1 shadow-sm">
          {['monthly', 'annual'].map(p => (
            <button key={p} onClick={() => setPeriod(p)}
              className={`px-4 py-2 rounded-xl text-sm font-bold transition-all ${period === p ? 'bg-primary-700 text-white shadow' : 'text-gray-500 hover:text-gray-800'}`}>
              {p === 'monthly' ? 'Per month · මාසිකව' : 'Per year · වාර්ෂිකව'}
            </button>
          ))}
        </div>
        <div className="inline-flex items-center gap-1 rounded-2xl bg-white border border-gray-200 p-1 shadow-sm">
          <CalendarRange size={15} className="text-gray-400 ml-2" />
          {YEARS.map(y => (
            <button key={y} onClick={() => setYear(y)}
              className={`px-3 py-2 rounded-xl text-sm font-bold transition-all ${year === y ? 'bg-gold-500 text-primary-900 shadow' : 'text-gray-500 hover:text-gray-800'}`}>Y/A {y}</button>
          ))}
        </div>
      </div>

      <div className="grid lg:grid-cols-[1fr_1.05fr] gap-5 items-start">
        {/* Inputs */}
        <div className="space-y-4">
          <div className="card p-5 space-y-3">
            <div className="flex items-center gap-3">
              <div className="w-11 h-11 rounded-2xl bg-gradient-to-br from-primary-600 to-indigo-600 text-white flex items-center justify-center shadow"><Landmark size={20} /></div>
              <div>
                <div className="font-bold text-gray-800">Sri Lankan income</div>
                <div className="text-xs text-gray-500">Salary, business profit, rent, interest — total {period === 'monthly' ? 'per month' : 'per year'} · දේශීය ආදායම</div>
              </div>
            </div>
            <BigMoney value={local} onChange={setLocal} autoFocus={mode === 'public'} />
          </div>

          <div className="card p-5 space-y-3">
            <div className="flex items-center gap-3">
              <div className="w-11 h-11 rounded-2xl bg-gradient-to-br from-amber-400 to-orange-500 text-white flex items-center justify-center shadow"><Globe2 size={20} /></div>
              <div className="flex-1">
                <div className="font-bold text-gray-800">Foreign income sent through a bank</div>
                <div className="text-xs text-gray-500">Paid in foreign currency (e.g. freelancing, remote job) — in rupees · විදේශ ආදායම</div>
              </div>
            </div>
            <BigMoney value={foreign} onChange={setForeign} />
            <button onClick={() => setFxOpen(o => !o)} className="text-xs font-semibold text-primary-700 flex items-center gap-1 hover:underline">
              <ArrowRightLeft size={13} /> I know it in USD / other currency <ChevronDown size={13} className={`transition-transform ${fxOpen ? 'rotate-180' : ''}`} />
            </button>
            {fxOpen && (
              <div className="rounded-xl bg-gray-50 border border-gray-100 p-3 grid grid-cols-[1fr_auto_1fr_auto] gap-2 items-end">
                <label className="text-[11px] font-semibold text-gray-500">Amount
                  <input className="input mt-1 text-right" inputMode="decimal" placeholder="1,000" value={fx.amount} onChange={e => setFx({ ...fx, amount: e.target.value.replace(/[^\d.]/g, '') })} />
                </label>
                <select className="input w-20 text-sm" value={fx.cur} onChange={e => setFx({ ...fx, cur: e.target.value })}>
                  {['USD', 'GBP', 'EUR', 'AUD', 'CAD', 'AED', 'INR', 'JPY'].map(c => <option key={c}>{c}</option>)}
                </select>
                <label className="text-[11px] font-semibold text-gray-500">Rate (Rs. per 1 {fx.cur})
                  <input className="input mt-1 text-right" inputMode="decimal" placeholder="e.g. 300" value={fx.rate} onChange={e => setFx({ ...fx, rate: e.target.value.replace(/[^\d.]/g, '') })} />
                </label>
                <button onClick={useFx} className="btn-primary text-sm py-2.5">Use</button>
              </div>
            )}
          </div>
          <p className="text-[11px] text-gray-400 flex items-start gap-1.5"><Info size={12} className="mt-px flex-shrink-0" /> For a Sri Lankan resident individual. Rates: {TAX_YEARS[year].slabText}; foreign income through a bank — maximum 15%. Tax-free allowance Rs. 1,800,000 a year.</p>
        </div>

        {/* Result */}
        <div className="space-y-4 lg:sticky lg:top-4">
          <div className="relative overflow-hidden rounded-3xl bg-gradient-to-br from-primary-700 via-primary-800 to-indigo-900 text-white p-6 shadow-xl">
            <div className="absolute -right-10 -top-10 w-48 h-48 rounded-full bg-gold-500/20 blur-2xl" />
            <div className="relative">
              <div className="text-xs font-bold uppercase tracking-wider text-primary-200">Your income tax {period === 'monthly' ? 'per month' : 'for the year'}</div>
              {hasIncome && r.tax === 0 ? (
                <div className="mt-2 flex items-center gap-3">
                  <PartyPopper size={36} className="text-gold-500" />
                  <div>
                    <div className="text-4xl font-black">Rs. 0</div>
                    <div className="text-sm text-primary-200">No tax — your income is within the Rs. 1.8M tax-free allowance 🎉</div>
                  </div>
                </div>
              ) : (
                <div className="mt-1 text-5xl sm:text-6xl font-black tabular-nums tracking-tight"><span className="text-2xl text-gold-500 mr-1">Rs.</span>{rs(per(r.tax))}</div>
              )}
              <div className="mt-4 grid grid-cols-3 gap-2 text-center">
                <div className="rounded-2xl bg-white/10 py-2.5"><div className="text-[10px] uppercase text-primary-200 font-bold">{period === 'monthly' ? 'Per year' : 'Per month'}</div><div className="font-black tabular-nums">Rs. {rs(period === 'monthly' ? r.tax : r.tax / 12)}</div></div>
                <div className="rounded-2xl bg-white/10 py-2.5"><div className="text-[10px] uppercase text-primary-200 font-bold">Effective rate</div><div className="font-black tabular-nums">{rate.toFixed(rate < 10 ? 1 : 0)}%</div></div>
                <div className="rounded-2xl bg-white/10 py-2.5"><div className="text-[10px] uppercase text-primary-200 font-bold">You keep</div><div className="font-black tabular-nums">Rs. {rs(per(income - r.tax))}</div></div>
              </div>
            </div>
          </div>

          {hasIncome && (
            <div className="card p-5 space-y-3">
              <div className="text-sm font-bold text-gray-700">How your {period === 'monthly' ? 'yearly ' : ''}income is taxed <span className="font-normal text-gray-400">(Rs. {rs(income)} a year)</span></div>
              <div className="flex h-5 rounded-full overflow-hidden bg-gray-100">
                {segs.map(s => <div key={s.key} className={`${s.cls} transition-all duration-500`} style={{ width: `${(s.w / totalW) * 100}%` }} title={s.label} />)}
              </div>
              <div className="divide-y divide-gray-50">
                {segs.map(s => (
                  <div key={s.key} className="flex items-center gap-2 py-1.5 text-sm">
                    <span className={`w-3 h-3 rounded-full ${s.cls}`} />
                    <span className="flex-1 text-gray-700">{s.label}</span>
                    <span className="text-gray-500 tabular-nums">Rs. {rs(s.amt)}</span>
                    <span className={`w-28 text-right font-semibold tabular-nums ${s.tax ? 'text-primary-800' : 'text-emerald-600'}`}>{s.tax ? `Rs. ${rs(s.tax)}` : 'No tax'}</span>
                  </div>
                ))}
                <div className="flex items-center gap-2 pt-2 text-sm font-black text-primary-800">
                  <span className="flex-1">Total tax for the year</span><span className="tabular-nums">Rs. {rs(r.tax)}</span>
                </div>
              </div>
            </div>
          )}
        </div>
      </div>

      {hasIncome && <TaxSavingTips year={year} x={x} mode={mode} />}
    </div>
  );
}
