import { useMemo, useState } from 'react';
import TopUpCalc from '../../components/TopUpCalc';
import { useOutletContext, Link } from 'react-router-dom';
import {
  Calculator, Globe2, MapPin, Shuffle, ChevronDown, ChevronUp, Info, AlertTriangle, CheckCircle2, MessageCircle, RotateCcw,
} from 'lucide-react';
import { computePersonal, apitTable1, TAX_YEARS } from '../../lib/iitCalc';
import TaxSavingTips from '../../components/TaxSavingTips';
import { FIRM } from '../../lib/iitStatement';
import { waNumber } from '../../lib/share';

const YEARS = ['2025/26', '2026/27'];
const CURRENCIES = ['LKR', 'USD', 'EUR', 'GBP', 'AUD', 'CAD', 'AED', 'SAR', 'QAR', 'KWD', 'JPY', 'SGD', 'NZD', 'INR'];
const MODES = [
  { key: 'local', icon: MapPin, en: 'Local income', si: 'දේශීය ආදායම', hint: 'Salary, business, rent, interest in Sri Lanka' },
  { key: 'foreign', icon: Globe2, en: 'Foreign income', si: 'විදේශීය ආදායම', hint: 'Paid in foreign currency, sent to Sri Lanka through a bank' },
  { key: 'mixed', icon: Shuffle, en: 'Local + Foreign', si: 'මිශ්‍ර ආදායම', hint: 'Both together' },
];
const rs = (n) => `Rs. ${Math.round(n || 0).toLocaleString('en-LK')}`;
const pct = (r) => `${Math.round(r * 100)}%`;
const toNum = (v) => { const n = Number(String(v ?? '').replace(/,/g, '')); return Number.isFinite(n) ? Math.max(0, n) : 0; };
const filingDeadline = (year) => `30 November ${parseInt(year, 10) + 1}`;

function Money({ value, onChange, placeholder = '0', suffix }) {
  const [focus, setFocus] = useState(false);
  const shown = focus || value === '' ? value : toNum(value).toLocaleString('en-LK');
  return (
    <div className="relative">
      <span className="absolute left-3 top-1/2 -translate-y-1/2 text-xs font-semibold text-gray-400">{suffix ?? 'Rs.'}</span>
      <input className="input pl-11 pr-9 text-right tabular-nums text-base" inputMode="decimal" placeholder={placeholder} value={shown}
        onFocus={() => setFocus(true)} onBlur={() => setFocus(false)}
        onChange={e => onChange(e.target.value.replace(/[^\d.]/g, ''))} />
      <TopUpCalc value={value} onUse={onChange} />
    </div>
  );
}

function Field({ label, si, hint, children }) {
  return (
    <div>
      <label className="block text-sm font-semibold text-gray-700 leading-tight">{label}</label>
      {si && <div className="text-xs text-gray-400 mb-1">{si}</div>}
      {children}
      {hint && <div className="text-[11px] text-gray-500 mt-1">{hint}</div>}
    </div>
  );
}

function Row({ l, v, cls = '', sub }) {
  return (
    <div className={`flex justify-between gap-3 py-1.5 ${cls}`}>
      <span>{l}{sub && <span className="block text-[11px] text-gray-400 font-normal">{sub}</span>}</span>
      <span className="tabular-nums whitespace-nowrap">{v}</span>
    </div>
  );
}

export default function ClientTaxCalculator() {
  const [year, setYear] = useState('2025/26');
  const [period, setPeriod] = useState('monthly');   // monthly | annual
  const [mode, setMode] = useState('local');
  const [f, setF] = useState({
    salary: '', business: '', rent: '', interest: '', otherLocal: '',
    fxAmount: '', fxCur: 'USD', fxRate: '', foreignOther: '',
    residency: 'resident', solar: '', donCharity: '', donGovt: '', apitPaid: '', otherTaxPaid: '', whtInterestAuto: true,
  });
  const [more, setMore] = useState(false);
  const features = useOutletContext() ?? { tax_calculator: true };
  const set = (k) => (v) => setF(s => ({ ...s, [k]: v }));
  const mult = period === 'monthly' ? 12 : 1;
  const per = period === 'monthly' ? 'per month' : 'per year';
  const perSi = period === 'monthly' ? 'මාසිකව' : 'වාර්ෂිකව';
  const showLocal = mode !== 'foreign';
  const showForeign = mode !== 'local';

  const fxLKR = f.fxCur === 'LKR' ? toNum(f.fxAmount) : toNum(f.fxAmount) * toNum(f.fxRate);
  const needRate = showForeign && f.fxCur !== 'LKR' && toNum(f.fxAmount) > 0 && !toNum(f.fxRate);

  const px = useMemo(() => ({
    residency: f.residency,
    salary: showLocal ? toNum(f.salary) * mult : 0,
    business: showLocal ? toNum(f.business) * mult : 0,
    rent: showLocal ? toNum(f.rent) * mult : 0,
    interest: showLocal ? toNum(f.interest) * mult : 0,
    otherLocal: showLocal ? toNum(f.otherLocal) * mult : 0,
    foreignFx: showForeign ? fxLKR * mult : 0,
    foreignOther: showForeign ? toNum(f.foreignOther) * mult : 0,
    solar: toNum(f.solar), donCharity: toNum(f.donCharity), donGovt: toNum(f.donGovt),
    apitPaid: period === 'annual' ? toNum(f.apitPaid) : 0,
    otherTaxPaid: period === 'annual' ? toNum(f.otherTaxPaid) : 0,
    whtInterestAuto: period === 'annual' && f.whtInterestAuto,
  }), [f, mult, showLocal, showForeign, fxLKR, period]);
  const r = useMemo(() => computePersonal(year, px), [year, px]);

  const d = (n) => n / mult;    // show in the chosen period
  const hasIncome = r.totalAss > 0;
  const takeHomePct = hasIncome ? Math.max(0, Math.min(100, (r.afterTax / r.totalAss) * 100)) : 100;
  const salaryOnly = period === 'monthly' && mode === 'local' && toNum(f.salary) > 0
    && !toNum(f.business) && !toNum(f.rent) && !toNum(f.interest) && !toNum(f.otherLocal);
  const reset = () => setF(s => ({ ...s, salary: '', business: '', rent: '', interest: '', otherLocal: '', fxAmount: '', fxRate: '', foreignOther: '', solar: '', donCharity: '', donGovt: '', apitPaid: '', otherTaxPaid: '' }));
  const bands = [...r.local.detail.map(b => ({ ...b, kind: 'local' })), ...r.foreign.bands.map(b => ({ ...b, kind: 'foreign' }))];
  const maxBandTax = Math.max(1, ...bands.map(b => b.tax));

  if (features.loaded && !features.tax_calculator) return (
    <div className="card p-8 text-center space-y-3">
      <Calculator size={36} className="mx-auto text-gray-300" />
      <p className="text-gray-600">The Tax Calculator is not available right now.</p>
      <p className="text-sm text-gray-400">Please contact TaxMate for help with your tax.</p>
      <Link to="/client" className="btn-secondary text-sm inline-flex">Back to dashboard</Link>
    </div>
  );

  return (
    <div className="space-y-5 pb-6">
      {/* Header */}
      <div className="rounded-2xl bg-gradient-to-br from-primary-700 to-primary-900 text-white p-5 sm:p-6 shadow-lg">
        <div className="flex items-start gap-3 flex-wrap">
          <div className="w-11 h-11 rounded-xl bg-white/15 flex items-center justify-center"><Calculator size={22} /></div>
          <div className="flex-1 min-w-[200px]">
            <h1 className="text-xl sm:text-2xl font-bold">Income Tax Calculator</h1>
            <p className="text-sm text-primary-200">ආදායම් බදු ගණකය · Estimate your Sri Lankan income tax in seconds</p>
          </div>
        </div>
        <div className="mt-4 flex flex-wrap gap-3">
          <div className="flex bg-white/10 rounded-xl p-1">
            {YEARS.map(y => (
              <button key={y} onClick={() => setYear(y)} className={`px-3 py-1.5 rounded-lg text-sm font-semibold ${year === y ? 'bg-white text-primary-800' : 'text-primary-100 hover:bg-white/10'}`}>Y/A {y}</button>
            ))}
          </div>
          <div className="flex bg-white/10 rounded-xl p-1">
            {[['monthly', 'Monthly · මාසික'], ['annual', 'Annual · වාර්ෂික']].map(([k, l]) => (
              <button key={k} onClick={() => setPeriod(k)} className={`px-3 py-1.5 rounded-lg text-sm font-semibold ${period === k ? 'bg-gold-500 text-primary-900' : 'text-primary-100 hover:bg-white/10'}`}>{l}</button>
            ))}
          </div>
        </div>
      </div>

      {/* Income type */}
      <div className="grid grid-cols-3 gap-2 sm:gap-3">
        {MODES.map(({ key, icon: Icon, en, si, hint }) => (
          <button key={key} onClick={() => setMode(key)}
            className={`text-left rounded-2xl border-2 p-3 sm:p-4 transition-all ${mode === key ? 'border-primary-500 bg-primary-50 shadow-sm' : 'border-gray-200 bg-white hover:border-primary-200'}`}>
            <Icon size={20} className={mode === key ? 'text-primary-600' : 'text-gray-400'} />
            <div className="font-bold text-sm text-gray-800 mt-1.5 leading-tight">{en}</div>
            <div className="text-[11px] text-gray-500">{si}</div>
            <div className="text-[11px] text-gray-400 mt-1 hidden sm:block">{hint}</div>
          </button>
        ))}
      </div>

      <div className="grid lg:grid-cols-[1fr_380px] gap-5 items-start">
        {/* Inputs */}
        <div className="space-y-4">
          {showLocal && (
            <div className="card p-4 sm:p-5 space-y-4">
              <div className="flex items-center gap-2"><MapPin size={17} className="text-green-600" />
                <h2 className="font-bold text-gray-800">Income in Sri Lanka <span className="font-normal text-gray-400 text-sm">· {per} / {perSi}</span></h2></div>
              <div className="grid sm:grid-cols-2 gap-4">
                <Field label="Salary & allowances" si="වැටුප හා දීමනා" hint="Gross, before APIT/EPF. Include bonus spread over the year."><Money value={f.salary} onChange={set('salary')} /></Field>
                <Field label="Business / professional profit" si="ව්‍යාපාරික / වෘත්තීය ලාභය" hint="Net profit after business expenses."><Money value={f.business} onChange={set('business')} /></Field>
                <Field label="Rent received" si="ලැබෙන කුලිය" hint="Gross rent — 25% rent relief is applied automatically."><Money value={f.rent} onChange={set('rent')} /></Field>
                <Field label="Bank interest" si="බැංකු පොලිය" hint="Gross interest (before 10% WHT)."><Money value={f.interest} onChange={set('interest')} /></Field>
                <Field label="Other income" si="වෙනත් ආදායම්"><Money value={f.otherLocal} onChange={set('otherLocal')} /></Field>
              </div>
            </div>
          )}

          {showForeign && (
            <div className="card p-4 sm:p-5 space-y-4">
              <div className="flex items-center gap-2"><Globe2 size={17} className="text-blue-600" />
                <h2 className="font-bold text-gray-800">Foreign income <span className="font-normal text-gray-400 text-sm">· {per} / {perSi}</span></h2></div>
              <Field label="Paid in foreign currency & sent to Sri Lanka through a bank" si="විදේශ මුදලින් ලැබී බැංකුවක් හරහා ශ්‍රී ලංකාවට එවූ ආදායම"
                hint="Remote job for a foreign employer, freelancing, IT/BPO services, consulting for foreign clients, foreign-source income. Taxed at a maximum of 15%.">
                <div className="flex gap-2">
                  <select className="input w-24 flex-shrink-0" value={f.fxCur} onChange={e => set('fxCur')(e.target.value)}>
                    {CURRENCIES.map(c => <option key={c}>{c}</option>)}
                  </select>
                  <div className="flex-1"><Money value={f.fxAmount} onChange={set('fxAmount')} suffix={f.fxCur} /></div>
                </div>
              </Field>
              {f.fxCur !== 'LKR' && (
                <div className="grid sm:grid-cols-2 gap-4 items-end">
                  <Field label={`Exchange rate (Rs. per 1 ${f.fxCur})`} si="විනිමය අනුපාතය" hint="Use the rate your bank converted at."><Money value={f.fxRate} onChange={set('fxRate')} placeholder="e.g. 300" /></Field>
                  <div className={`rounded-xl px-3 py-2.5 text-sm ${needRate ? 'bg-amber-50 text-amber-800' : 'bg-blue-50 text-blue-900'}`}>
                    {needRate ? 'Enter the exchange rate to convert to rupees.' : <>= <b className="tabular-nums">{rs(fxLKR)}</b> {per}</>}
                  </div>
                </div>
              )}
              <Field label="Foreign income NOT sent through a bank" si="බැංකුවක් හරහා නොඑවූ විදේශීය ආදායම" hint="Taxed at the normal rates (up to 36%) — the 15% maximum applies only to money remitted through a bank.">
                <Money value={f.foreignOther} onChange={set('foreignOther')} />
              </Field>
            </div>
          )}

          {/* More options */}
          <div className="card overflow-hidden">
            <button onClick={() => setMore(m => !m)} className="w-full flex items-center gap-2 px-4 sm:px-5 py-3.5 text-left hover:bg-gray-50">
              <span className="font-semibold text-gray-800 flex-1">More options <span className="font-normal text-gray-400 text-sm">· residency, reliefs, tax already paid</span></span>
              {more ? <ChevronUp size={18} className="text-gray-400" /> : <ChevronDown size={18} className="text-gray-400" />}
            </button>
            {more && (
              <div className="px-4 sm:px-5 pb-5 pt-1 grid sm:grid-cols-2 gap-4 border-t border-gray-100">
                <Field label="Residency" si="පදිංචිය">
                  <select className="input" value={f.residency} onChange={e => set('residency')(e.target.value)}>
                    <option value="resident">Resident in Sri Lanka</option>
                    <option value="nrcitizen">Non-resident Sri Lankan citizen</option>
                    <option value="nonresident">Non-resident (not a citizen)</option>
                  </select>
                </Field>
                <Field label="Solar panels (per year)" si="සූර්ය පැනල" hint="Cost / loan repayments this year — relief up to Rs. 600,000."><Money value={f.solar} onChange={set('solar')} /></Field>
                <Field label="Donations to approved charities (per year)" si="අනුමත පරිත්‍යාග" hint="Deductible up to Rs. 75,000 (and 1/3 of taxable income)."><Money value={f.donCharity} onChange={set('donCharity')} /></Field>
                <Field label="Donations to the Government (per year)" si="රජයට පරිත්‍යාග"><Money value={f.donGovt} onChange={set('donGovt')} /></Field>
                {period === 'annual' ? (
                  <>
                    <Field label="APIT deducted by employer (this year)" si="සේවා යෝජකයා අඩු කළ APIT"><Money value={f.apitPaid} onChange={set('apitPaid')} /></Field>
                    <Field label="Other tax already paid (WHT / instalments)" si="දැනටමත් ගෙවූ බදු"><Money value={f.otherTaxPaid} onChange={set('otherTaxPaid')} /></Field>
                    <label className="sm:col-span-2 flex items-center gap-2 text-sm text-gray-700">
                      <input type="checkbox" checked={f.whtInterestAuto} onChange={e => set('whtInterestAuto')(e.target.checked)} />
                      My bank already deducted 10% WHT from the interest (credit it automatically)
                    </label>
                  </>
                ) : (
                  <div className="sm:col-span-2 text-xs text-gray-500 bg-gray-50 rounded-lg p-2.5">Switch to <b>Annual</b> to enter tax you have already paid and see the balance payable or refundable.</div>
                )}
              </div>
            )}
          </div>
          <button onClick={reset} className="text-xs text-gray-500 hover:text-gray-700 flex items-center gap-1"><RotateCcw size={12} /> Clear all</button>
        </div>

        {/* Result */}
        <div id="tax-result" className="lg:sticky lg:top-6 space-y-3 scroll-mt-4">
          <div className="card overflow-hidden">
            <div className="bg-gradient-to-br from-gold-500 to-amber-500 p-5 text-primary-900">
              <div className="text-xs font-bold uppercase tracking-wider opacity-80">Your income tax {per}</div>
              <div className="text-3xl sm:text-4xl font-black tabular-nums mt-1">{rs(d(r.tax))}</div>
              <div className="text-sm font-semibold opacity-80 mt-1">
                {period === 'monthly' ? <>= {rs(r.tax)} per year</> : <>≈ {rs(r.tax / 12)} per month</>}
              </div>
            </div>
            <div className="p-4 space-y-3">
              {/* take-home bar */}
              <div>
                <div className="flex h-3 rounded-full overflow-hidden bg-gray-100">
                  <div className="bg-green-500" style={{ width: `${takeHomePct}%` }} />
                  <div className="bg-red-400 flex-1" />
                </div>
                <div className="flex justify-between text-xs mt-1.5">
                  <span className="text-green-700 font-semibold">Take-home {rs(d(r.afterTax))}</span>
                  <span className="text-red-600 font-semibold">Tax {rs(d(r.tax))}</span>
                </div>
              </div>
              <div className="grid grid-cols-2 gap-2">
                <div className="rounded-xl bg-gray-50 p-2.5 text-center"><div className="text-lg font-black text-primary-700">{r.effRate.toFixed(1)}%</div><div className="text-[11px] text-gray-500">Effective rate</div></div>
                <div className="rounded-xl bg-gray-50 p-2.5 text-center"><div className="text-lg font-black text-primary-700">{pct(r.marginal)}</div><div className="text-[11px] text-gray-500">Top rate you pay</div></div>
              </div>

              <div className="text-sm border-t border-gray-100 pt-2">
                <Row l="Total income" v={rs(d(r.totalAss))} />
                {r.prUsed > 0 && <Row l="Personal relief" sub={`Rs. ${(r.cfg.pr).toLocaleString('en-LK')} a year, tax-free`} v={`− ${rs(d(r.prUsed))}`} cls="text-green-700" />}
                {r.rentRelief > 0 && <Row l="Rent relief (25%)" v={`− ${rs(d(r.rentRelief))}`} cls="text-green-700" />}
                {r.solarUsed > 0 && <Row l="Solar panel relief" v={`− ${rs(d(r.solarUsed))}`} cls="text-green-700" />}
                {r.qp > 0 && <Row l="Donations" v={`− ${rs(d(r.qp))}`} cls="text-green-700" />}
                <Row l={<b>Taxable income</b>} v={<b>{rs(d(r.taxable))}</b>} cls="border-t border-gray-100 mt-1" />
              </div>

              {bands.length > 0 && (
                <div className="space-y-1.5">
                  <div className="text-xs font-semibold text-gray-500 uppercase tracking-wide">How it adds up ({per})</div>
                  {bands.map((b, i) => (
                    <div key={i} className="text-xs">
                      <div className="flex justify-between gap-2">
                        <span className="text-gray-600">{b.kind === 'foreign' ? '🌍 ' : ''}{rs(d(b.taxed))} @ {pct(b.rate)}</span>
                        <span className="tabular-nums font-semibold">{rs(d(b.tax))}</span>
                      </div>
                      <div className="h-1.5 rounded-full bg-gray-100 mt-0.5 overflow-hidden">
                        <div className={`h-full rounded-full ${b.kind === 'foreign' ? 'bg-blue-500' : 'bg-primary-500'}`} style={{ width: `${Math.max(2, (b.tax / maxBandTax) * 100)}%` }} />
                      </div>
                    </div>
                  ))}
                </div>
              )}

              {period === 'annual' && r.credits > 0 && (
                <div className="text-sm border-t border-gray-100 pt-2">
                  <Row l="Total tax for the year" v={rs(r.tax)} />
                  <Row l="Already paid (APIT / WHT)" sub={r.whtInterest > 0 ? `incl. interest WHT ${rs(r.whtInterest)}` : null} v={`− ${rs(r.credits)}`} cls="text-green-700" />
                  <Row l={<b>{r.status === 'refund' ? 'Refund due to you' : 'Balance to pay'}</b>} v={<b className={r.status === 'refund' ? 'text-green-700' : 'text-red-600'}>{rs(Math.abs(r.balance))}</b>} cls="border-t border-gray-100 mt-1" />
                </div>
              )}

              {salaryOnly && (
                <div className="text-xs rounded-lg bg-primary-50 text-primary-900 p-2.5">
                  Your employer should deduct about <b>{rs(apitTable1(toNum(f.salary)))}</b> APIT a month (IRD APIT Tax Table 01).
                </div>
              )}
            </div>
          </div>

          {hasIncome && (
            r.mustFile ? (
              <div className="rounded-xl border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900 flex gap-2">
                <AlertTriangle size={17} className="flex-shrink-0 mt-0.5" />
                <div>Your income is above Rs. 1,800,000 a year — you must file an Income Tax Return for Y/A {year} by <b>{filingDeadline(year)}</b>.
                  <div className="text-xs mt-0.5">ඔබගේ වාර්ෂික ආදායම රු. 1,800,000 ඉක්මවන නිසා {filingDeadline(year)}ට පෙර ආදායම් බදු ප්‍රකාශය ඉදිරිපත් කළ යුතුයි.</div></div>
              </div>
            ) : (
              <div className="rounded-xl border border-green-200 bg-green-50 p-3 text-sm text-green-900 flex gap-2">
                <CheckCircle2 size={17} className="flex-shrink-0 mt-0.5" /> Your income is within the Rs. 1,800,000 tax-free relief — no income tax.
              </div>
            )
          )}

          <a href={`https://wa.me/${waNumber(FIRM.whatsapp)}?text=${encodeURIComponent(`Hi TaxMate, I used the tax calculator for Y/A ${year}. Estimated tax: ${rs(r.tax)} a year. Can you help me file my return?`)}`}
            target="_blank" rel="noreferrer" className="w-full flex items-center justify-center gap-2 rounded-xl bg-green-600 hover:bg-green-700 text-white font-semibold py-3">
            <MessageCircle size={17} /> Ask TaxMate to file it for you
          </a>
        </div>
      </div>

      {hasIncome && <TaxSavingTips year={year} x={px} mode="client" />}

      {/* Phone: live total pinned at the bottom while typing */}
      {hasIncome && (
        <button onClick={() => document.getElementById('tax-result')?.scrollIntoView({ behavior: 'smooth' })}
          className="lg:hidden fixed bottom-4 left-4 right-4 z-30 rounded-2xl bg-primary-800 text-white shadow-xl px-4 py-3 flex items-center gap-3">
          <span className="text-xs text-primary-200 flex-1 text-left">Your tax {per}</span>
          <span className="font-black tabular-nums text-gold-500">{rs(d(r.tax))}</span>
          <ChevronDown size={16} className="text-primary-200" />
        </button>
      )}

      <div className="text-[11px] text-gray-500 flex gap-1.5 leading-relaxed pb-16 lg:pb-0">
        <Info size={13} className="flex-shrink-0 mt-0.5" />
        <span>
          Estimate for Y/A {year} under the Inland Revenue Act No. 24 of 2017 as amended by Act No. 02 of 2025: personal relief Rs. {TAX_YEARS[year].pr.toLocaleString('en-LK')}; rates {TAX_YEARS[year].slabText};
          foreign-currency income remitted through a bank taxed at a maximum of 15% (6% only on any part of the first Rs. 1,000,000 band not used by local income).
          Monthly figures assume the same income every month — your employer's APIT (cumulative tables) may differ month to month. Not included: gains on investment assets, terminal benefits, dividends (15% final WHT), betting/gaming.
          This is a guide, not tax advice — TaxMate will confirm your exact tax before filing.
        </span>
      </div>
    </div>
  );
}
