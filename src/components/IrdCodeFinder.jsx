import { useMemo, useRef, useState } from 'react';
import toast from 'react-hot-toast';
import { Copy, MessageCircle, CalendarClock, Info, AlertTriangle, Hash, ListChecks, BookOpen, ExternalLink, Landmark, Search } from 'lucide-react';
import {
  TAX_TYPES, typeByKey, pickerFor, lookup, defaultSel, daysUntil, paymentsDueIn, shareText,
  MONTHS, INSTALMENTS, yaLabel, quarterLabel, CODE_LIST, FORMAT_GUIDE, SOURCES, PAY_CHANNELS, ASSESSMENT_NOTE, CATEGORY_S,
} from '../lib/irdCodes';

const copy = async (text, what = 'Copied') => {
  try { await navigator.clipboard.writeText(text); toast.success(what); }
  catch { toast.error('Could not copy — select and copy manually'); }
};

function DueBadge({ due, soft = false }) {
  const d = daysUntil(due);
  const [cls, txt] = d < 0 && soft ? ['bg-gray-100 text-gray-500', 'Date passed']
    : d < 0 ? ['bg-red-100 text-red-700', `Overdue by ${-d} day${d === -1 ? '' : 's'}`]
    : d === 0 ? ['bg-red-100 text-red-700', 'Due today']
    : d <= 7 ? ['bg-amber-100 text-amber-800', `In ${d} day${d === 1 ? '' : 's'}`]
    : ['bg-emerald-100 text-emerald-700', `In ${d} days`];
  return <span className={`text-[11px] font-bold rounded-full px-2 py-0.5 whitespace-nowrap ${cls}`}>{txt}</span>;
}

function CodeBox({ label, sub, value, accent }) {
  return (
    <button onClick={() => copy(value, `${label} ${value} copied`)} title="Click to copy"
      className={`group rounded-2xl border-2 p-3 sm:p-4 text-left transition hover:shadow-md ${accent}`}>
      <div className="text-[10px] font-bold uppercase tracking-wider opacity-70 flex items-center gap-1">{label}<Copy size={11} className="ml-auto opacity-40 group-hover:opacity-100" /></div>
      <div className="text-3xl sm:text-4xl font-black font-mono tracking-wider mt-1">{value}</div>
      {sub && <div className="text-[11px] opacity-75 mt-0.5 leading-tight">{sub}</div>}
    </button>
  );
}

function PeriodPicker({ type, sel, setSel }) {
  const kind = pickerFor(type);
  const now = new Date().getFullYear();
  const years = [now + 1, now, now - 1, now - 2, now - 3];
  const yas = [now, now - 1, now - 2, now - 3, now - 4];
  if (kind === 'month') return (
    <div className="grid grid-cols-2 gap-2">
      <label className="text-xs text-gray-500">Month the tax relates to
        <select className="input mt-1" value={sel.month} onChange={e => setSel({ ...sel, month: Number(e.target.value) })}>
          {MONTHS.map((m, i) => <option key={m} value={i + 1}>{m}</option>)}
        </select></label>
      <label className="text-xs text-gray-500">Year
        <select className="input mt-1" value={sel.year} onChange={e => setSel({ ...sel, year: Number(e.target.value) })}>
          {years.map(y => <option key={y} value={y}>{y}</option>)}
        </select></label>
    </div>
  );
  if (kind === 'quarter') return (
    <div className="grid grid-cols-2 gap-2">
      <label className="text-xs text-gray-500">Quarter
        <select className="input mt-1" value={sel.quarter} onChange={e => setSel({ ...sel, quarter: Number(e.target.value) })}>
          {[1, 2, 3, 4].map(q => <option key={q} value={q}>{quarterLabel(q, sel.year).replace(` ${sel.year}`, '')}</option>)}
        </select></label>
      <label className="text-xs text-gray-500">Year
        <select className="input mt-1" value={sel.year} onChange={e => setSel({ ...sel, year: Number(e.target.value) })}>
          {years.map(y => <option key={y} value={y}>{y}</option>)}
        </select></label>
    </div>
  );
  if (kind === 'instalment') return (
    <div className="grid grid-cols-2 gap-2">
      <label className="text-xs text-gray-500">Year of Assessment
        <select className="input mt-1" value={sel.ya} onChange={e => setSel({ ...sel, ya: Number(e.target.value) })}>
          {yas.map(s => <option key={s} value={s}>{yaLabel(s)}</option>)}
        </select></label>
      <label className="text-xs text-gray-500">Payment
        <select className="input mt-1" value={sel.instalment} onChange={e => setSel({ ...sel, instalment: Number(e.target.value) })}>
          {INSTALMENTS.map(x => <option key={x.i} value={x.i}>{x.label} · {x.covers}</option>)}
        </select></label>
    </div>
  );
  return (
    <label className="text-xs text-gray-500 block">Year of Assessment
      <select className="input mt-1" value={sel.ya} onChange={e => setSel({ ...sel, ya: Number(e.target.value) })}>
        {yas.map(s => <option key={s} value={s}>{yaLabel(s)}</option>)}
      </select></label>
  );
}

function Finder({ mode }) {
  const [key, setKey] = useState('apit');
  const type = typeByKey(key);
  const [sels, setSels] = useState({});
  const sel = sels[key] ?? defaultSel(type);
  const setSel = (s) => setSels(x => ({ ...x, [key]: s }));
  const [q, setQ] = useState('');
  const resultRef = useRef(null);
  const pick = (k) => {
    setKey(k);
    // phones: the result is below the list — bring it into view
    if (window.innerWidth < 1024) setTimeout(() => resultRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' }), 50);
  };
  const r = useMemo(() => lookup(type, sel), [type, sel]);
  const ql = q.trim().toLowerCase();
  const match = (t) => !ql || `${t.name} ${t.full} ${t.code} ${t.si} ${t.who}`.toLowerCase().includes(ql);
  const pays = TAX_TYPES.filter(t => t.group === 'pay' && match(t));
  const rets = TAX_TYPES.filter(t => t.group === 'ret' && match(t));

  const Tile = ({ t }) => (
    <button onClick={() => pick(t.key)}
      className={`text-left rounded-xl border px-3 py-2 transition ${key === t.key ? 'border-primary-500 bg-primary-50 ring-2 ring-primary-200' : 'border-gray-200 bg-white hover:border-primary-300 hover:bg-gray-50'}`}>
      <div className="flex items-center gap-1.5"><span>{t.emoji}</span><span className="font-semibold text-sm text-gray-800 leading-tight">{t.name}</span>
        {t.group === 'pay' && <span className="ml-auto font-mono text-[11px] font-bold text-primary-700 bg-primary-100 rounded px-1.5">{t.code}</span>}</div>
      <div className="text-[11px] text-gray-500 mt-0.5 truncate">{t.si}</div>
    </button>
  );

  return (
    <div className="grid lg:grid-cols-[minmax(0,1fr)_minmax(0,1.15fr)] gap-5 items-start">
      <div className="card p-4 space-y-3">
        <div className="relative">
          <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
          <input className="input pl-9" placeholder="Search — APIT, VAT, SSCL, 03, ආදායම්…" value={q} onChange={e => setQ(e.target.value)} />
        </div>
        {pays.length > 0 && <>
          <div className="text-[11px] font-bold uppercase tracking-wider text-gray-400">Payments · ගෙවීම්</div>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">{pays.map(t => <Tile key={t.key} t={t} />)}</div>
        </>}
        {rets.length > 0 && <>
          <div className="text-[11px] font-bold uppercase tracking-wider text-gray-400 pt-1">Returns & statements · වාර්තා</div>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">{rets.map(t => <Tile key={t.key} t={t} />)}</div>
        </>}
        {!pays.length && !rets.length && <div className="text-sm text-gray-400 text-center py-6">Nothing matches “{q}”.</div>}
      </div>

      <div ref={resultRef} className="space-y-4 lg:sticky lg:top-4 scroll-mt-3">
        <div className="card overflow-hidden">
          <div className="bg-gradient-to-r from-primary-700 to-primary-600 text-white px-4 py-3">
            <div className="flex items-center gap-2"><span className="text-xl">{type.emoji}</span><div className="font-bold leading-tight">{type.full}</div></div>
            <div className="text-xs text-primary-100 mt-0.5">{type.who}</div>
          </div>
          <div className="p-4 space-y-4">
            <PeriodPicker type={type} sel={sel} setSel={setSel} />
            {r && <>
              <div className={`grid gap-2 ${r.isPayment ? 'grid-cols-1 sm:grid-cols-3' : 'grid-cols-1 sm:grid-cols-2'}`}>
                {r.isPayment && <CodeBox label="Tax Type Code" value={type.code} sub={type.name} accent="border-primary-200 bg-primary-50 text-primary-800" />}
                <CodeBox label={r.isPayment ? 'Payment Period Code' : 'Period Code'} value={r.periodCode} sub={r.periodLabel} accent="border-amber-300 bg-amber-50 text-amber-900" />
                {r.isPayment && <CodeBox label="Payment Category" value={CATEGORY_S.code} sub={CATEGORY_S.label} accent="border-emerald-200 bg-emerald-50 text-emerald-800" />}
                {!r.isPayment && <div className="rounded-2xl border-2 border-gray-200 bg-gray-50 p-3 sm:p-4 text-gray-600 text-sm flex items-center">
                  <span>This is a <b>return / statement</b> — filed in RAMIS, no payment slip. Pay any tax due with the payment codes.</span></div>}
              </div>

              <div className="flex items-center gap-2 flex-wrap rounded-xl bg-gray-50 border border-gray-100 px-3 py-2.5">
                <CalendarClock size={18} className="text-primary-600" />
                <div className="text-sm"><span className="text-gray-500">{r.isPayment ? 'Pay on or before' : 'File on or before'}</span> <b className="text-gray-800">{r.dueText}</b></div>
                <DueBadge due={r.due} />
              </div>
              {r.weekend && <div className="text-xs text-amber-800 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2 flex gap-2"><AlertTriangle size={14} className="flex-shrink-0 mt-0.5" /> This date falls on a weekend — pay online or on the working day before to be safe.</div>}

              <div>
                <div className="text-[11px] font-bold uppercase tracking-wider text-gray-400 mb-1.5 flex items-center gap-1"><Hash size={11} /> How {r.periodCode} is built · format {type.fmt}</div>
                <div className="flex flex-wrap gap-1.5">
                  {r.parts.map(([v, why], i) => <div key={i} className="rounded-lg border border-gray-200 bg-white px-2.5 py-1 text-center"><div className="font-mono font-black text-primary-700">{v}</div><div className="text-[10px] text-gray-500 leading-tight">{why}</div></div>)}
                </div>
              </div>

              <div className="flex gap-2 flex-wrap">
                <button onClick={() => copy(shareText(r), 'All details copied')} className="btn-primary text-sm"><Copy size={14} /> Copy all</button>
                <a href={`https://wa.me/?text=${encodeURIComponent(shareText(r))}`} target="_blank" rel="noreferrer" className="btn-secondary text-sm"><MessageCircle size={14} className="text-[#25D366]" /> {mode === 'admin' ? 'Send to client' : 'Share on WhatsApp'}</a>
              </div>
            </>}
          </div>
        </div>

        {r?.isPayment && (
          <div className="card p-4 space-y-2 text-sm">
            <div className="font-semibold text-gray-800 flex items-center gap-1.5"><Landmark size={15} className="text-primary-600" /> On the paying-in slip / OTPP</div>
            <ol className="list-decimal list-inside text-gray-600 space-y-0.5 text-[13px]">
              <li>Your <b>TIN</b> (Taxpayer Identification Number)</li>
              <li>Tax Type Code <b className="font-mono">{type.code}</b></li>
              <li>Payment Period Code <b className="font-mono">{r.periodCode}</b> and Payment Category <b className="font-mono">S</b></li>
              <li>Tax amount (and penalty, if any) — total in figures and words</li>
              <li>Name, address, phone · cheque details if paying by cheque (TIN on the back)</li>
            </ol>
            <p className="text-xs text-gray-500">{PAY_CHANNELS}</p>
            <p className="text-xs text-gray-500 flex gap-1.5"><Info size={13} className="flex-shrink-0 mt-0.5" />{ASSESSMENT_NOTE}</p>
          </div>
        )}
      </div>
    </div>
  );
}

function DueThisMonth() {
  const now = new Date();
  const [ym, setYm] = useState({ y: now.getFullYear(), m: now.getMonth() + 1 });
  const rows = useMemo(() => paymentsDueIn(ym.y, ym.m), [ym]);
  const shift = (d) => setYm(({ y, m }) => { const t = new Date(y, m - 1 + d, 1); return { y: t.getFullYear(), m: t.getMonth() + 1 }; });
  return (
    <div className="card">
      <div className="card-header flex-wrap gap-2">
        <ListChecks size={16} /> IRD payments due in
        <div className="flex items-center gap-1 ml-auto">
          <button onClick={() => shift(-1)} className="btn-secondary text-xs py-1 px-2">‹</button>
          <span className="font-bold text-primary-800 min-w-[130px] text-center">{MONTHS[ym.m - 1]} {ym.y}</span>
          <button onClick={() => shift(1)} className="btn-secondary text-xs py-1 px-2">›</button>
        </div>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead><tr className="text-left text-[11px] uppercase tracking-wider text-gray-400 border-b border-gray-100">
            <th className="px-4 py-2">Due</th><th className="px-2 py-2">Tax</th><th className="px-2 py-2">For</th><th className="px-2 py-2 text-center">Type code</th><th className="px-2 py-2 text-center">Period code</th><th className="px-2 py-2 text-center">Cat.</th><th className="px-2 py-2" />
          </tr></thead>
          <tbody className="divide-y divide-gray-50">
            {rows.map((r, i) => (
              <tr key={i} className="hover:bg-gray-50">
                <td className="px-4 py-2 whitespace-nowrap"><div className="font-semibold text-gray-800">{r.dueText.replace(/ \d{4}$/, '')}</div><DueBadge due={r.due} soft /></td>
                <td className="px-2 py-2"><span className="mr-1">{r.type.emoji}</span>{r.type.name}</td>
                <td className="px-2 py-2 text-gray-500 text-xs">{r.periodLabel}</td>
                <td className="px-2 py-2 text-center font-mono font-bold text-primary-700">{r.type.code}</td>
                <td className="px-2 py-2 text-center"><button onClick={() => copy(r.periodCode, `${r.periodCode} copied`)} className="font-mono font-black text-amber-800 bg-amber-50 border border-amber-200 rounded px-2 py-0.5 hover:bg-amber-100">{r.periodCode}</button></td>
                <td className="px-2 py-2 text-center font-mono font-bold text-emerald-700">S</td>
                <td className="px-2 py-2"><button onClick={() => copy(shareText(r), 'Details copied')} className="text-gray-400 hover:text-primary-700" title="Copy details"><Copy size={14} /></button></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="text-[11px] text-gray-400 px-4 py-2 border-t border-gray-50">Monthly payments are for the previous month. VAT and SSCL returns, annual statements and the income tax return have their own dates — see Find codes → Returns.</p>
    </div>
  );
}

function AllCodes() {
  return (
    <div className="grid lg:grid-cols-2 gap-5 items-start">
      <div className="card">
        <div className="card-header"><Hash size={16} /> IRD Tax Type Codes</div>
        <table className="w-full text-sm">
          <tbody className="divide-y divide-gray-50">
            {CODE_LIST.map(c => (
              <tr key={c.code} className={c.current ? '' : 'text-gray-400'}>
                <td className="px-4 py-1.5 w-16"><button onClick={() => copy(c.code, `${c.code} copied`)} className={`font-mono font-black rounded px-2 py-0.5 ${c.current ? 'text-primary-700 bg-primary-50' : 'bg-gray-50'}`}>{c.code}</button></td>
                <td className="px-2 py-1.5">{c.name}</td>
                <td className="px-4 py-1.5 text-right">{c.current ? <span className="text-[10px] font-bold text-emerald-700 bg-emerald-50 rounded-full px-2 py-0.5">in use</span> : <span className="text-[10px]">older</span>}</td>
              </tr>
            ))}
          </tbody>
        </table>
        <p className="text-[11px] text-gray-400 px-4 py-2 border-t border-gray-50">“In use” codes appear in the IRD Tax Calendar 2026. Older codes are for past taxes / arrears — confirm with IRD (hotline 1944) before paying.</p>
      </div>
      <div className="space-y-5">
        <div className="card">
          <div className="card-header"><BookOpen size={16} /> Period code formats</div>
          <table className="w-full text-sm">
            <tbody className="divide-y divide-gray-50">
              {FORMAT_GUIDE.map(([what, fmt, ex]) => (
                <tr key={what}><td className="px-4 py-2 text-gray-700">{what}</td><td className="px-2 py-2 font-mono text-xs font-bold text-primary-700 whitespace-nowrap">{fmt}</td><td className="px-4 py-2 text-xs text-gray-500">{ex}</td></tr>
              ))}
            </tbody>
          </table>
          <p className="text-[11px] text-gray-400 px-4 py-2 border-t border-gray-50">YY = last 2 digits of the year · MM = month · Q = calendar quarter (1 = Jan–Mar … 4 = Oct–Dec) · M = month in the quarter (1–3) · i = instalment (0 = final). Payment Category <b>S</b> = self assessment.</p>
        </div>
        <div className="card p-4 text-sm space-y-1.5">
          <div className="font-semibold text-gray-800">Official sources</div>
          {SOURCES.map(([t, u]) => <a key={u} href={u} target="_blank" rel="noreferrer" className="flex items-center gap-1.5 text-primary-700 hover:underline text-[13px]"><ExternalLink size={12} /> {t}</a>)}
          <p className="text-[11px] text-gray-400 pt-1">Codes follow the IRD Tax Calendar 2026. IRD can change codes — check the new calendar each January.</p>
        </div>
      </div>
    </div>
  );
}

/** IRD Payment Code finder — mode: 'admin' | 'client' | 'public' */
export default function IrdCodeFinder({ mode = 'admin' }) {
  const [tab, setTab] = useState('find');
  const tabs = [['find', Search, 'Find codes'], ['month', ListChecks, 'Due this month'], ['all', Hash, 'All codes']];
  return (
    <div className="space-y-4">
      <div className="grid grid-cols-3 sm:flex gap-1 bg-white rounded-xl border border-gray-100 p-1 sm:w-fit shadow-sm">
        {tabs.map(([k, I, l]) => (
          <button key={k} onClick={() => setTab(k)} className={`flex items-center justify-center gap-1 sm:gap-1.5 px-1.5 sm:px-3 py-1.5 rounded-lg text-xs sm:text-sm font-semibold whitespace-nowrap ${tab === k ? 'bg-primary-600 text-white' : 'text-gray-600 hover:bg-gray-50'}`}><I size={14} /> {l}</button>
        ))}
      </div>
      {tab === 'find' && <Finder mode={mode} />}
      {tab === 'month' && <DueThisMonth />}
      {tab === 'all' && <AllCodes />}
    </div>
  );
}
