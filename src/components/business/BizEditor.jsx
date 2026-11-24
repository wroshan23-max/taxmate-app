// V76 — Business accounts editor (sole proprietor / partnership), used by the client portal and TaxMate.
// Client: income, cost of sales, expenses (own lines), assets, partners — annual totals or month by month.
// TaxMate (role "admin"): + allowable %, capital allowance classes, add-backs, loss b/f, partnership
// credits, partner ↔ client links, the computation, Finalise → result → IIT return.
import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import toast from 'react-hot-toast';
import {
  Save, Loader2, Plus, Trash2, Printer, Send, Lock, Unlock, CheckCircle2, AlertTriangle, Info, X, CalendarDays, CalendarRange,
  TrendingUp, Package, Receipt, Monitor, Users, SlidersHorizontal, Calculator, FileSpreadsheet, Wand2,
} from 'lucide-react';
import TopUpCalc from '../TopUpCalc';
import {
  MONTHS, INCOME_TYPES, CA_CLASSES, guessClass, normalize, lineAmt, newLine, newAsset, newPartner, computeBusiness, resultOf,
  collectForReturn, saveAccount, loadBizOffice, saveBizOffice, STATUS, KIND, expenseDefault,
} from '../../lib/bizAccounts';
import { openBizStatement } from '../../lib/bizStatement';
import { supabase } from '../../lib/supabase';

const num = (v) => { const n = Number(String(v ?? '').replace(/,/g, '')); return Number.isFinite(n) ? n : 0; };
const fm = (n) => (Math.round((Number(n) || 0) * 100) / 100).toLocaleString('en-LK', { minimumFractionDigits: 0, maximumFractionDigits: 2 });
const rs = (n) => `Rs. ${(Math.round((Number(n) || 0) * 100) / 100).toLocaleString('en-LK', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const clean = (v, neg) => String(v ?? '').replace(neg ? /[^\d.-]/g : /[^\d.]/g, '');

/** amount box: 1,234,567 when not typing */
function Amt({ value, onChange, disabled, small, neg, calc = true }) {
  const [focus, setFocus] = useState(false);
  const shown = focus || value === '' || value === undefined || value === null ? (value ?? '') : (num(value) ? fm(num(value)) : value);
  return (
    <div className="relative">
      <input inputMode="decimal" disabled={disabled} value={shown} placeholder="0"
        onFocus={(e) => { setFocus(true); requestAnimationFrame(() => e.target.select()); }} onBlur={() => setFocus(false)}
        onChange={(e) => onChange(clean(e.target.value, neg))}
        className={`w-full rounded-lg border border-gray-200 bg-white text-right tabular-nums focus:border-primary-400 focus:outline-none focus:ring-2 focus:ring-primary-100 disabled:bg-gray-50 disabled:text-gray-500 ${small ? 'px-1.5 py-1 text-xs' : `px-2.5 py-2 text-sm ${calc && !disabled ? 'pr-8' : ''}`}`} />
      {!small && calc && !disabled && <TopUpCalc value={value} onUse={onChange} />}
    </div>
  );
}

const TABS = [
  ['income', 'Income', TrendingUp], ['cos', 'Cost of sales', Package], ['expenses', 'Expenses', Receipt], ['assets', 'Assets', Monitor],
  ['partners', 'Partners', Users, 'partnership'], ['adjust', 'TaxMate adjustments', SlidersHorizontal, 'admin'], ['result', 'Computation', Calculator],
];

export default function BizEditor({ acc: acc0, role = 'client', client = {}, clients = [], onSaved, onClose }) {
  const admin = role === 'admin';
  const navigate = useNavigate();
  const [acc, setAcc] = useState(acc0);
  const [data, setData] = useState(() => normalize(acc0.data, acc0.kind));
  const [mode, setMode] = useState(acc0.mode || 'annual');
  const [meta, setMeta] = useState({ name: acc0.name, tin: acc0.tin || '', activity_code: acc0.activity_code || '', client_note: acc0.client_note || '' });
  const [office, setOffice] = useState(admin ? null : {});
  const [dirty, setDirty] = useState(false);
  const [odirty, setODirty] = useState(false);
  const [busy, setBusy] = useState(false);
  const [tab, setTab] = useState('income');
  const locked = !admin && acc.status !== 'open';
  const part = acc.kind === 'partnership';

  useEffect(() => { if (admin) loadBizOffice(acc0.id).then((r) => setOffice(r.data || {})).catch((e) => { toast.error(e.message); setOffice({}); }); }, [admin, acc0.id]);
  useEffect(() => {
    const h = (e) => { if (dirty || odirty) { e.preventDefault(); e.returnValue = ''; } };
    window.addEventListener('beforeunload', h); return () => window.removeEventListener('beforeunload', h);
  }, [dirty, odirty]);

  const c = useMemo(() => computeBusiness({ ...acc, mode, data }, office || {}), [acc, mode, data, office]);
  const upd = (fn) => { setData((d) => fn({ ...d })); setDirty(true); };
  const setO = (fn) => { setOffice((o) => fn({ ...(o || {}) })); setODirty(true); };
  const setMap = (k, id, v) => setO((o) => ({ ...o, [k]: { ...(o[k] || {}), [id]: v } }));

  const save = async (extra = {}) => {
    setBusy(true);
    try {
      let row = acc;
      if (dirty || Object.keys(extra).length) {
        row = await saveAccount(acc.id, { data, mode, name: meta.name.trim() || acc.name, tin: meta.tin.trim() || null, activity_code: meta.activity_code.trim() || null, client_note: meta.client_note.trim() || null, ...extra });
        setAcc(row); setDirty(false);
      }
      if (admin && odirty) { await saveBizOffice(acc, office); setODirty(false); }
      onSaved?.(row);
      return row;
    } catch (e) { toast.error(e.message); return null; } finally { setBusy(false); }
  };
  const doSave = async () => { if (await save()) toast.success('Saved'); };
  const submit = async () => {
    if (!c.turnover && !c.expTotal) return toast.error('Enter the income and expenses first');
    if (part && c.partners?.length && Math.abs(c.shareSum - 100) > 0.01) return toast.error('Profit-sharing % must add up to 100%');
    if (!window.confirm('Send these business accounts to TaxMate? You cannot change them after sending (TaxMate can re-open them).')) return;
    if (await save({ status: 'submitted' })) toast.success('Sent to TaxMate ✅');
  };
  const finalise = async () => {
    if (c.issues.length && !window.confirm(`Check first:\n• ${c.issues.join('\n• ')}\n\nFinalise anyway?`)) return;
    if (await save({ status: 'final', result: resultOf(c) })) toast.success('Finalised — the client was told');
  };
  const reopen = async () => { if (await save({ status: 'open', result: null })) toast.success('Re-opened — the client can change the figures'); };
  const print = () => { if (!openBizStatement({ ...acc, ...meta, mode }, c, client, { status: acc.status })) toast.error('Allow pop-ups to print'); };
  const toReturn = async (clientId, label) => {
    const { data: rows, error } = await supabase.from('business_accounts').select('id, client_id, kind, name, status, result').eq('year', acc.year).eq('status', 'final');
    if (error) return toast.error(error.message);
    const { input, items } = collectForReturn(rows || [], clientId);
    if (!items.length) return toast.error('Finalise first');
    const f = Object.fromEntries(Object.entries(input).filter(([, v]) => v));
    navigate('/admin/calculator', { state: { newReturn: { client_id: clientId, year: acc.year, label, input_data: { form: 'IIT_RETURN', ...f } } } });
  };

  const tabs = TABS.filter(([, , , only]) => !only || (only === 'admin' ? admin : only === acc.kind));
  const st = STATUS[acc.status] || STATUS.open;

  if (admin && !office) return <div className="card p-8 text-center text-gray-400"><Loader2 className="mx-auto animate-spin" /></div>;

  return (
    <div className="card overflow-hidden">
      {/* Header */}
      <div className="relative bg-gradient-to-br from-primary-800 via-primary-700 to-indigo-800 px-4 py-4 text-white sm:px-5">
        <div className="pointer-events-none absolute -right-10 -top-12 h-40 w-40 rounded-full bg-gold-500/20 blur-2xl" />
        <div className="relative flex flex-wrap items-start gap-3">
          <div className="flex h-12 w-12 flex-shrink-0 items-center justify-center rounded-2xl bg-white/15 text-2xl">{KIND[acc.kind]?.emoji}</div>
          <div className="min-w-0 flex-1">
            <input value={meta.name} disabled={locked} onChange={(e) => { setMeta((m) => ({ ...m, name: e.target.value.slice(0, 160) })); setDirty(true); }}
              className="w-full rounded-lg bg-transparent text-lg font-bold text-white placeholder:text-primary-200 hover:bg-white/10 focus:bg-white/10 focus:outline-none disabled:hover:bg-transparent" />
            <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-primary-100">
              <span>{KIND[acc.kind]?.en}</span><span className="font-semibold text-gold-300">Y/A {acc.year}</span>
              <span className={`rounded-full px-2 py-0.5 text-[11px] font-semibold ${st.cls}`}>{st.short}</span>
              <label className="flex items-center gap-1">TIN <input value={meta.tin} disabled={locked} onChange={(e) => { setMeta((m) => ({ ...m, tin: e.target.value.slice(0, 30) })); setDirty(true); }} placeholder="—" className="w-28 rounded bg-white/10 px-1.5 py-0.5 text-white placeholder:text-primary-300 focus:outline-none" /></label>
              {admin && <label className="flex items-center gap-1">Activity code <input value={meta.activity_code} onChange={(e) => { setMeta((m) => ({ ...m, activity_code: e.target.value.replace(/\D/g, '').slice(0, 6) })); setDirty(true); }} placeholder="—" className="w-20 rounded bg-white/10 px-1.5 py-0.5 text-white placeholder:text-primary-300 focus:outline-none" /></label>}
            </div>
          </div>
          {onClose && <button type="button" onClick={() => { if ((dirty || odirty) && !window.confirm('Close without saving?')) return; onClose(); }} className="rounded-lg p-1.5 text-primary-100 hover:bg-white/10" aria-label="Close"><X size={18} /></button>}
        </div>
        <div className="relative mt-3 flex flex-wrap items-center gap-2">
          <div className="flex rounded-xl bg-white/10 p-1">
            {[['annual', 'Annual totals', CalendarDays], ['monthly', 'Month by month', CalendarRange]].map(([k, l, I]) => (
              <button key={k} type="button" disabled={locked} onClick={() => { if (k === mode) return; if (k === 'annual' && [...data.income, ...data.cos, ...data.expenses].some((x) => (x.m || []).some((v) => num(v))) && !window.confirm('Switch to annual totals? The annual box is used (monthly figures are kept but not counted).')) return; setMode(k); setDirty(true); }}
                className={`flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-semibold ${mode === k ? 'bg-gold-500 text-primary-900' : 'text-primary-100 hover:bg-white/10'}`}><I size={13} /> {l}</button>
            ))}
          </div>
          <div className="ml-auto flex flex-wrap gap-2">
            {!locked && <button type="button" disabled={busy || (!dirty && !odirty)} onClick={doSave} className="flex items-center gap-1.5 rounded-lg bg-white px-3 py-1.5 text-xs font-bold text-primary-800 disabled:opacity-50">{busy ? <Loader2 size={13} className="animate-spin" /> : <Save size={13} />} Save</button>}
            {!admin && acc.status === 'open' && <button type="button" disabled={busy} onClick={submit} className="flex items-center gap-1.5 rounded-lg bg-gold-500 px-3 py-1.5 text-xs font-bold text-primary-900"><Send size={13} /> Send to TaxMate</button>}
            {admin && <button type="button" onClick={print} className="flex items-center gap-1.5 rounded-lg bg-white/10 px-3 py-1.5 text-xs font-semibold hover:bg-white/20"><Printer size={13} /> Print</button>}
            {admin && acc.status !== 'final' && <button type="button" disabled={busy} onClick={finalise} className="flex items-center gap-1.5 rounded-lg bg-emerald-500 px-3 py-1.5 text-xs font-bold text-white hover:bg-emerald-600"><Lock size={13} /> Finalise</button>}
            {admin && acc.status !== 'open' && <button type="button" disabled={busy} onClick={reopen} className="flex items-center gap-1.5 rounded-lg bg-white/10 px-3 py-1.5 text-xs font-semibold hover:bg-white/20"><Unlock size={13} /> Re-open</button>}
          </div>
        </div>
      </div>

      {locked && <div className="flex items-center gap-2 border-b border-blue-100 bg-blue-50 px-4 py-2 text-xs text-blue-900"><Lock size={13} /> {acc.status === 'final' ? 'TaxMate has finalised this computation.' : 'Sent to TaxMate — they will check it. Ask TaxMate if you need to change something.'}</div>}

      {/* Tabs */}
      <div className="flex gap-1 overflow-x-auto border-b border-gray-100 bg-gray-50 px-2 py-1.5">
        {tabs.map(([k, l, I], i) => (
          <button key={k} type="button" onClick={() => setTab(k)} className={`flex shrink-0 items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-semibold ${tab === k ? 'bg-white text-primary-800 shadow-sm' : 'text-gray-600 hover:bg-white/60'}`}>
            <span className={`flex h-4 w-4 items-center justify-center rounded-full text-[9px] ${tab === k ? 'bg-primary-700 text-white' : 'bg-gray-200 text-gray-600'}`}>{i + 1}</span><I size={13} /> {l}
          </button>
        ))}
      </div>

      <div className="p-3 sm:p-4">
        {tab === 'income' && (
          <Lines title="Income" hint="Money earned by the business in the year. Interest, rent and dividends are listed here too — TaxMate takes them out of business income." lines={data.income} mode={mode} locked={locked} year={acc.year}
            onChange={(l) => upd((d) => ({ ...d, income: l }))} addLabel="Add income line" newExtra={{ type: 'business' }}
            extra={(ln) => {
              const t = office?.incType?.[ln.id] || ln.type || 'business';
              const canSet = admin || (!ln.key && !locked);
              return canSet ? (
                <select value={t} onChange={(e) => (admin ? setMap('incType', ln.id, e.target.value) : upd((d) => ({ ...d, income: d.income.map((x) => (x.id === ln.id ? { ...x, type: e.target.value } : x)) })))} className="w-full rounded-lg border border-gray-200 px-1.5 py-1.5 text-[11px]">
                  {Object.entries(INCOME_TYPES).map(([k, v]) => <option key={k} value={k}>{v.short}</option>)}
                </select>
              ) : <span className="text-[11px] text-gray-500">{INCOME_TYPES[t]?.short}</span>;
            }} extraHead="Type" total={c.turnover + c.nonBiz} totalLabel={`Total income · business ${fm(c.turnover)}`} />
        )}

        {tab === 'cos' && (
          <div className="space-y-4">
            <div className="grid gap-3 sm:grid-cols-2">
              {[['opening', 'Opening stock (1 April)'], ['closing', 'Closing stock (31 March)']].map(([k, l]) => (
                <label key={k} className="block text-xs font-semibold text-gray-600">{l}
                  <div className="mt-1"><Amt value={data.stock[k]} disabled={locked} onChange={(v) => upd((d) => ({ ...d, stock: { ...d.stock, [k]: v } }))} /></div>
                  <span className="text-[10px] font-normal text-gray-400">Value at cost or market value, whichever is lower (s.13).</span>
                </label>
              ))}
            </div>
            <Lines title="Purchases & direct costs" lines={data.cos} mode={mode} locked={locked} year={acc.year} onChange={(l) => upd((d) => ({ ...d, cos: l }))} addLabel="Add cost line"
              extra={admin ? (ln) => <PctBox ln={ln} office={office} setMap={setMap} def={100} /> : null} extraHead={admin ? 'Allowed %' : null}
              total={c.cosLines} totalLabel="Total purchases & direct costs" />
            <div className="grid grid-cols-3 gap-2 rounded-xl bg-primary-50 p-3 text-center text-xs">
              <div><div className="text-gray-500">Cost of sales</div><div className="text-base font-black text-primary-800">{fm(c.cogs)}</div></div>
              <div><div className="text-gray-500">Business income</div><div className="text-base font-black text-primary-800">{fm(c.turnover)}</div></div>
              <div><div className="text-gray-500">Gross profit</div><div className={`text-base font-black ${c.grossProfit < 0 ? 'text-red-600' : 'text-emerald-700'}`}>{fm(c.grossProfit)}</div></div>
            </div>
          </div>
        )}

        {tab === 'expenses' && (
          <Lines title="Expenses" hint="Running costs of the business for the year. Add your own lines if something is missing. TaxMate decides what is allowed for tax." lines={data.expenses} mode={mode} locked={locked} year={acc.year}
            onChange={(l) => upd((d) => ({ ...d, expenses: l }))} addLabel="Add expense line" withNote
            extra={(ln) => {
              const def = expenseDefault(ln);
              if (admin) return <PctBox ln={ln} office={office} setMap={setMap} def={def ? def.pct : 100} fixed={def?.fixed} law={def?.law} />;
              return def?.fixed ? <span className="text-[10px] leading-tight text-amber-700" title={def.law}>{def.law?.split('—')[0] || 'Not allowed'}</span> : def?.hint ? <span className="text-[10px] leading-tight text-gray-400">{def.hint}</span> : null;
            }} extraHead={admin ? 'Allowed %' : 'Tax note'}
            footer={!locked && c.bookDep > 0 && (() => {
              const dl = data.expenses.find((x) => x.key === 'depreciation');
              return dl && Math.abs(lineAmt(dl, mode) - c.bookDep) > 0.5 ? (
                <button type="button" onClick={() => upd((d) => ({ ...d, expenses: d.expenses.map((x) => (x.key === 'depreciation' ? (mode === 'monthly' ? { ...x, m: Array(12).fill('').map((_, i) => (i === 11 ? String(c.bookDep) : '')) } : { ...x, a: String(c.bookDep) }) : x)) }))}
                  className="flex items-center gap-1.5 rounded-lg bg-violet-50 px-3 py-1.5 text-xs font-semibold text-violet-700 hover:bg-violet-100"><Wand2 size={13} /> Use depreciation from the asset register: {fm(c.bookDep)}</button>
              ) : null;
            })()}
            total={c.expTotal} totalLabel="Total expenses" />
        )}

        {tab === 'assets' && <Assets data={data} upd={upd} locked={locked} admin={admin} office={office} setMap={setMap} c={c} year={acc.year} />}
        {tab === 'partners' && part && <Partners data={data} upd={upd} locked={locked} admin={admin} office={office} setMap={setMap} c={c} clients={clients} onReturn={toReturn} final={acc.status === 'final'} />}
        {tab === 'adjust' && admin && <Adjust office={office} setO={setO} part={part} c={c} />}
        {tab === 'result' && <Result c={c} admin={admin} acc={acc} part={part} onPrint={print} onReturn={() => toReturn(acc.client_id, `From ${acc.name} ${acc.year}`)} />}

        {!locked && (
          <label className="mt-4 block text-xs font-semibold text-gray-600">{admin ? 'Client note' : 'Note to TaxMate (optional)'}
            <textarea rows={2} maxLength={2000} value={meta.client_note} onChange={(e) => { setMeta((m) => ({ ...m, client_note: e.target.value })); setDirty(true); }} className="input mt-1 resize-y text-sm" placeholder="Anything TaxMate should know — e.g. 'vehicle used 30% privately'" />
          </label>
        )}
      </div>
      {(dirty || odirty) && !locked && (
        <div className="sticky bottom-0 flex items-center gap-2 border-t border-amber-200 bg-amber-50 px-4 py-2 text-xs text-amber-900">
          <Info size={13} /> Unsaved changes <button type="button" disabled={busy} onClick={doSave} className="ml-auto rounded-lg bg-primary-700 px-3 py-1.5 font-bold text-white">{busy ? 'Saving…' : 'Save now'}</button>
        </div>
      )}
    </div>
  );
}

function PctBox({ ln, office, setMap, def, fixed, law }) {
  const v = office?.pct?.[ln.id];
  if (fixed) return <span className="block text-[10px] leading-tight text-red-700" title={law}>0% · {law?.replace(/^Not allowed — /, '').replace(/^Added back — /, '') || 'not allowed'}</span>;
  return (
    <div className="flex items-center gap-1">
      <input inputMode="numeric" value={v ?? ''} placeholder={String(def)} onChange={(e) => setMap('pct', ln.id, e.target.value === '' ? null : Math.min(100, Math.max(0, num(e.target.value.replace(/\D/g, '')))))}
        className={`w-14 rounded-lg border px-1.5 py-1 text-right text-xs tabular-nums focus:outline-none ${v !== undefined && v !== null && v !== def ? 'border-amber-400 bg-amber-50' : 'border-gray-200'}`} /><span className="text-[10px] text-gray-400">%</span>
    </div>
  );
}

/** Income / cost / expense lines — annual box or 12 months */
function Lines({ title, hint, lines, mode, locked, onChange, addLabel, newExtra = {}, extra, extraHead, total, totalLabel, withNote, footer, year }) {
  const set = (id, p) => onChange(lines.map((x) => (x.id === id ? { ...x, ...p } : x)));
  const del = (id) => { if (window.confirm('Remove this line?')) onChange(lines.filter((x) => x.id !== id)); };
  const add = () => onChange([...lines, newLine('', newExtra)]);
  const S = parseInt(year, 10);
  const monthName = (i) => `${MONTHS[i]} ${i < 9 ? S : S + 1}`;
  return (
    <div className="space-y-2">
      <div><div className="font-bold text-primary-800">{title}</div>{hint && <div className="text-xs text-gray-500">{hint}</div>}</div>
      {mode === 'annual' ? (
        <div className="divide-y divide-gray-100 rounded-xl border border-gray-100">
          {lines.map((ln) => (
            <div key={ln.id} className="grid grid-cols-[minmax(0,1fr)_130px] items-center gap-2 px-3 py-2 sm:grid-cols-[minmax(0,1fr)_120px_150px_28px]">
              <div className="min-w-0">
                {ln.key ? <div className="text-sm text-gray-800">{ln.label}</div>
                  : <input value={ln.label} disabled={locked} onChange={(e) => set(ln.id, { label: e.target.value.slice(0, 120) })} placeholder="Describe the item" className="w-full rounded-lg border border-dashed border-gray-300 px-2 py-1 text-sm focus:border-primary-400 focus:outline-none" />}
                {withNote && (ln.note || !locked) && <input value={ln.note || ''} disabled={locked} onChange={(e) => set(ln.id, { note: e.target.value.slice(0, 200) })} placeholder="note (optional)" className="mt-0.5 w-full bg-transparent text-[11px] text-gray-500 placeholder:text-gray-300 focus:outline-none" />}
              </div>
              <div className="order-last col-span-2 sm:order-none sm:col-span-1">{extra ? extra(ln) : null}</div>
              <Amt value={ln.a} disabled={locked} onChange={(v) => set(ln.id, { a: v })} />
              {!ln.key && !locked ? <button type="button" onClick={() => del(ln.id)} className="hidden p-1 text-gray-300 hover:text-red-600 sm:block" aria-label="Remove"><Trash2 size={14} /></button> : <span className="hidden sm:block" />}
            </div>
          ))}
        </div>
      ) : (
        <div className="overflow-x-auto rounded-xl border border-gray-100">
          <table className="w-full text-xs">
            <thead className="bg-gray-50 text-gray-500"><tr>
              <th className="sticky left-0 z-[1] min-w-[180px] bg-gray-50 px-2 py-1.5 text-left">Item</th>
              {extraHead && <th className="min-w-[110px] px-1 py-1.5 text-left">{extraHead}</th>}
              {MONTHS.map((_, i) => <th key={i} className="min-w-[88px] px-1 py-1.5 text-right">{monthName(i)}</th>)}
              <th className="min-w-[100px] bg-primary-50 px-2 py-1.5 text-right text-primary-800">Total</th><th />
            </tr></thead>
            <tbody>
              {lines.map((ln) => (
                <tr key={ln.id} className="border-t border-gray-100">
                  <td className="sticky left-0 z-[1] bg-white px-2 py-1">{ln.key ? ln.label : <input value={ln.label} disabled={locked} onChange={(e) => set(ln.id, { label: e.target.value.slice(0, 120) })} placeholder="Describe the item" className="w-full rounded border border-dashed border-gray-300 px-1.5 py-0.5 focus:outline-none" />}</td>
                  {extraHead && <td className="px-1 py-1">{extra ? extra(ln) : null}</td>}
                  {MONTHS.map((_, i) => <td key={i} className="px-0.5 py-0.5"><Amt small value={ln.m?.[i] ?? ''} disabled={locked} onChange={(v) => set(ln.id, { m: (ln.m || Array(12).fill('')).map((x, k) => (k === i ? v : x)) })} /></td>)}
                  <td className="bg-primary-50/50 px-2 py-1 text-right font-semibold tabular-nums">{fm(lineAmt(ln, 'monthly'))}</td>
                  <td>{!ln.key && !locked && <button type="button" onClick={() => del(ln.id)} className="p-1 text-gray-300 hover:text-red-600" aria-label="Remove"><Trash2 size={13} /></button>}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <div className="flex flex-wrap items-center gap-2">
        {!locked && <button type="button" onClick={add} className="flex items-center gap-1 rounded-lg border border-dashed border-primary-300 px-3 py-1.5 text-xs font-semibold text-primary-700 hover:bg-primary-50"><Plus size={13} /> {addLabel}</button>}
        {footer}
        <div className="ml-auto rounded-lg bg-primary-50 px-3 py-1.5 text-xs"><span className="text-gray-600">{totalLabel}: </span><b className="tabular-nums text-primary-800">{rs(total)}</b></div>
      </div>
    </div>
  );
}

function Assets({ data, upd, locked, admin, office, setMap, c, year }) {
  const set = (id, p) => upd((d) => ({ ...d, assets: d.assets.map((a) => (a.id === id ? { ...a, ...p } : a)) }));
  const res = Object.fromEntries(c.assets.map((x) => [x.a.id, x]));
  return (
    <div className="space-y-3">
      <div><div className="font-bold text-primary-800">Assets used in the business</div>
        <div className="text-xs text-gray-500">Machinery, computers, furniture, buildings, commercial vehicles… bought this year or earlier and still used — and any sold this year. Capital allowance (tax depreciation) is worked out from this list.</div></div>
      {data.assets.length === 0 && <div className="rounded-xl border-2 border-dashed border-gray-200 p-6 text-center text-sm text-gray-400">No assets yet.</div>}
      {data.assets.map((a) => {
        const x = res[a.id]; const o = office?.assets?.[a.id] || {};
        const setA = (p) => setMap('assets', a.id, { ...o, ...p });
        return (
          <div key={a.id} className="rounded-xl border border-gray-200 p-3">
            <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
              <label className="text-[11px] font-semibold text-gray-600 lg:col-span-2">Asset<input value={a.item} disabled={locked} onChange={(e) => set(a.id, { item: e.target.value.slice(0, 120) })} placeholder="e.g. Delivery lorry, Laptop, Shop building" className="input mt-0.5 py-1.5 text-sm" /></label>
              <label className="text-[11px] font-semibold text-gray-600">Date bought<input type="date" value={a.date} disabled={locked} onChange={(e) => set(a.id, { date: e.target.value })} className="input mt-0.5 py-1.5 text-sm" /></label>
              <label className="text-[11px] font-semibold text-gray-600">Cost (Rs.)<div className="mt-0.5"><Amt value={a.cost} disabled={locked} onChange={(v) => set(a.id, { cost: v })} calc={false} /></div></label>
              <label className="text-[11px] font-semibold text-gray-600">Used for<select value={a.work === 'partly' ? 'partly' : 'full'} disabled={locked} onChange={(e) => set(a.id, { work: e.target.value })} className="input mt-0.5 py-1.5 text-sm"><option value="full">Business only</option><option value="partly">Business + personal</option></select></label>
              <label className="text-[11px] font-semibold text-gray-600">Depreciation rate in the accounts % (optional)<input inputMode="decimal" value={a.depRate} disabled={locked} onChange={(e) => set(a.id, { depRate: e.target.value.replace(/[^\d.]/g, '').slice(0, 5) })} placeholder="e.g. 20" className="input mt-0.5 py-1.5 text-sm" /></label>
              <label className="flex items-center gap-2 self-end pb-2 text-xs text-gray-700"><input type="checkbox" checked={!!a.disposed} disabled={locked} onChange={(e) => set(a.id, { disposed: e.target.checked })} /> Sold / disposed</label>
              {a.disposed && <>
                <label className="text-[11px] font-semibold text-gray-600">Date sold<input type="date" value={a.disposedOn} disabled={locked} onChange={(e) => set(a.id, { disposedOn: e.target.value })} className="input mt-0.5 py-1.5 text-sm" /></label>
                <label className="text-[11px] font-semibold text-gray-600">Sale price (Rs.)<div className="mt-0.5"><Amt value={a.proceeds} disabled={locked} onChange={(v) => set(a.id, { proceeds: v })} calc={false} /></div></label>
              </>}
            </div>
            {admin && (
              <div className="mt-2 grid gap-2 rounded-lg bg-primary-50/60 p-2 sm:grid-cols-2 lg:grid-cols-5">
                <label className="text-[11px] font-semibold text-primary-800 lg:col-span-2">Fourth Schedule class<select value={o.cls || guessClass(a.item)} onChange={(e) => setA({ cls: e.target.value })} className="input mt-0.5 py-1 text-xs">{CA_CLASSES.map((k) => <option key={k.key} value={k.key}>{k.label}{k.years ? ` (${k.years} yrs)` : ''}</option>)}</select></label>
                <label className="text-[11px] font-semibold text-primary-800">Business use %<input inputMode="numeric" value={o.pct ?? ''} placeholder={a.work === 'partly' ? 'set' : '100'} onChange={(e) => setA({ pct: e.target.value === '' ? null : Math.min(100, num(e.target.value.replace(/\D/g, ''))) })} className={`input mt-0.5 py-1 text-xs ${a.work === 'partly' && (o.pct === undefined || o.pct === null) ? 'border-amber-400 bg-amber-50' : ''}`} /></label>
                {(o.cls || guessClass(a.item)) === 'c5' && <label className="text-[11px] font-semibold text-primary-800">Useful life (years)<input inputMode="numeric" value={o.years ?? ''} onChange={(e) => setA({ years: e.target.value.replace(/\D/g, '').slice(0, 2) })} className="input mt-0.5 py-1 text-xs" /></label>}
                <label className="text-[11px] font-semibold text-primary-800">Claimed in earlier years<input inputMode="decimal" value={o.prior ?? ''} placeholder={x ? fm(x.r.priorAuto) : 'auto'} onChange={(e) => setA({ prior: e.target.value === '' ? null : e.target.value.replace(/[^\d.]/g, '') })} className="input mt-0.5 py-1 text-xs" /></label>
              </div>
            )}
            {x && (
              <div className="mt-2 flex flex-wrap items-center gap-2 text-[11px]">
                {admin && <span className="rounded bg-gray-100 px-2 py-0.5">{x.r.cls.short}{x.r.years ? ` · ${x.r.years} yrs` : ''}</span>}
                {admin && <span className="rounded bg-emerald-50 px-2 py-0.5 font-semibold text-emerald-800">Capital allowance {year}: {fm(x.r.allowance)}</span>}
                {admin && x.r.balancing > 0 && <span className="rounded bg-emerald-50 px-2 py-0.5 text-emerald-800">Balancing allowance {fm(x.r.balancing)}</span>}
                {admin && x.r.charge > 0 && <span className="rounded bg-red-50 px-2 py-0.5 text-red-700">Balancing charge {fm(x.r.charge)}</span>}
                {admin && <span className="text-gray-500">Tax WDV c/f {fm(x.r.wdv)}</span>}
                {x.book > 0 && <span className="rounded bg-violet-50 px-2 py-0.5 text-violet-700">Accounts depreciation {fm(x.book)}</span>}
                {(x.r.note || x.r.issue) && <span className={x.r.issue ? 'font-semibold text-amber-700' : 'text-gray-500'}>{x.r.issue || x.r.note}</span>}
                {!locked && <button type="button" onClick={() => { if (window.confirm('Remove this asset?')) upd((d) => ({ ...d, assets: d.assets.filter((y) => y.id !== a.id) })); }} className="ml-auto flex items-center gap-1 text-gray-400 hover:text-red-600"><Trash2 size={12} /> Remove</button>}
              </div>
            )}
          </div>
        );
      })}
      <div className="flex flex-wrap items-center gap-2">
        {!locked && <button type="button" onClick={() => upd((d) => ({ ...d, assets: [...d.assets, newAsset()] }))} className="flex items-center gap-1 rounded-lg border border-dashed border-primary-300 px-3 py-1.5 text-xs font-semibold text-primary-700 hover:bg-primary-50"><Plus size={13} /> Add asset</button>}
        <div className="ml-auto flex flex-wrap gap-2 text-xs">
          {c.bookDep > 0 && <span className="rounded-lg bg-violet-50 px-3 py-1.5 text-violet-800">Depreciation (accounts): <b>{rs(c.bookDep)}</b></span>}
          {admin && <span className="rounded-lg bg-emerald-50 px-3 py-1.5 text-emerald-900">Capital allowances: <b>{rs(c.capAllow + c.balAllow)}</b>{c.charges ? <> · charges <b>{rs(c.charges)}</b></> : null}</span>}
        </div>
      </div>
      <p className="flex gap-1.5 text-[11px] text-gray-500"><Info size={12} className="mt-0.5 flex-shrink-0" /> Capital allowance (s.16, Fourth Schedule): straight line — Class 1 computers, Class 2 commercial vehicles & plant, Class 3 furniture & other: 5 years; Class 4 buildings: 20 years; Class 5 intangibles: useful life. Full year in the year bought; none in the year sold (balancing allowance / charge). Cars, vans and motor cycles (not commercial) get no allowance.</p>
    </div>
  );
}

function Partners({ data, upd, locked, admin, office, setMap, c, clients, onReturn, final }) {
  const set = (id, p) => upd((d) => ({ ...d, partners: d.partners.map((x) => (x.id === id ? { ...x, ...p } : x)) }));
  const res = Object.fromEntries((c.partners || []).map((p) => [p.id, p]));
  return (
    <div className="space-y-3">
      <div><div className="font-bold text-primary-800">Partners</div>
        <div className="text-xs text-gray-500">Each partner's profit-sharing % (must add up to 100%). Salary or interest on capital paid to a partner is part of that partner's share.</div></div>
      {data.partners.map((p, i) => {
        const r = res[p.id];
        return (
          <div key={p.id} className="rounded-xl border border-gray-200 p-3">
            <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-6">
              <label className="text-[11px] font-semibold text-gray-600 lg:col-span-2">Partner {i + 1} — name<input value={p.name} disabled={locked} onChange={(e) => set(p.id, { name: e.target.value.slice(0, 120) })} className="input mt-0.5 py-1.5 text-sm" /></label>
              <label className="text-[11px] font-semibold text-gray-600">NIC<input value={p.nic} disabled={locked} onChange={(e) => set(p.id, { nic: e.target.value.toUpperCase().slice(0, 12) })} className="input mt-0.5 py-1.5 text-sm" /></label>
              <label className="text-[11px] font-semibold text-gray-600">TIN<input value={p.tin} disabled={locked} onChange={(e) => set(p.id, { tin: e.target.value.slice(0, 20) })} className="input mt-0.5 py-1.5 text-sm" /></label>
              <label className="text-[11px] font-semibold text-gray-600">Profit share %<input inputMode="decimal" value={p.share} disabled={locked} onChange={(e) => set(p.id, { share: e.target.value.replace(/[^\d.]/g, '').slice(0, 6) })} className="input mt-0.5 py-1.5 text-sm" /></label>
              <div className="grid grid-cols-2 gap-2 sm:col-span-2 lg:col-span-1 lg:grid-cols-1">
                <label className="text-[11px] font-semibold text-gray-600">Salary (year)<div className="mt-0.5"><Amt small value={p.salary} disabled={locked} onChange={(v) => set(p.id, { salary: v })} /></div></label>
                <label className="text-[11px] font-semibold text-gray-600">Interest on capital<div className="mt-0.5"><Amt small value={p.interest} disabled={locked} onChange={(v) => set(p.id, { interest: v })} /></div></label>
              </div>
            </div>
            {admin && (
              <div className="mt-2 flex flex-wrap items-center gap-2 rounded-lg bg-primary-50/60 p-2 text-[11px]">
                <label className="flex items-center gap-1 font-semibold text-primary-800">TaxMate client
                  <select value={office?.links?.[p.id] || ''} onChange={(e) => setMap('links', p.id, e.target.value || null)} className="input w-56 py-1 text-xs"><option value="">— not a TaxMate client —</option>{clients.map((cl) => <option key={cl.id} value={cl.id}>{cl.full_name}{cl.client_no ? ` · ${cl.client_no}` : ''}</option>)}</select></label>
                {r && <><span className="rounded bg-white px-2 py-0.5">Business share <b>{fm(r.biz)}</b></span>{r.invTotal > 0 && <span className="rounded bg-white px-2 py-0.5">Investment share <b>{fm(r.invTotal)}</b></span>}<span className="rounded bg-white px-2 py-0.5">Tax credit (906) <b>{fm(r.tax)}</b></span>{r.ait > 0 && <span className="rounded bg-white px-2 py-0.5">AIT (907) <b>{fm(r.ait)}</b></span>}</>}
                {final && office?.links?.[p.id] && <button type="button" onClick={() => onReturn(office.links[p.id], `Partner share — ${p.name}`)} className="ml-auto flex items-center gap-1 rounded-lg bg-primary-700 px-2.5 py-1 font-semibold text-white"><FileSpreadsheet size={12} /> Open partner's return</button>}
              </div>
            )}
            {!locked && data.partners.length > 1 && <div className="mt-1 text-right"><button type="button" onClick={() => { if (window.confirm('Remove this partner?')) upd((d) => ({ ...d, partners: d.partners.filter((x) => x.id !== p.id) })); }} className="text-[11px] text-gray-400 hover:text-red-600"><Trash2 size={11} className="mr-0.5 inline" /> Remove</button></div>}
          </div>
        );
      })}
      <div className="flex flex-wrap items-center gap-2">
        {!locked && <button type="button" onClick={() => upd((d) => ({ ...d, partners: [...d.partners, newPartner()] }))} className="flex items-center gap-1 rounded-lg border border-dashed border-primary-300 px-3 py-1.5 text-xs font-semibold text-primary-700 hover:bg-primary-50"><Plus size={13} /> Add partner</button>}
        <span className={`ml-auto rounded-lg px-3 py-1.5 text-xs font-semibold ${Math.abs((c.shareSum || 0) - 100) < 0.01 ? 'bg-emerald-50 text-emerald-800' : 'bg-amber-50 text-amber-800'}`}>Shares total {c.shareSum || 0}%</span>
      </div>
    </div>
  );
}

function ListEdit({ title, items = [], onChange, placeholder }) {
  const set = (id, p) => onChange(items.map((x) => (x.id === id ? { ...x, ...p } : x)));
  return (
    <div className="space-y-1.5">
      <div className="text-xs font-bold text-gray-700">{title}</div>
      {items.map((x) => (
        <div key={x.id} className="grid grid-cols-[minmax(0,1fr)_130px_24px] items-center gap-2">
          <input value={x.label} onChange={(e) => set(x.id, { label: e.target.value.slice(0, 160) })} placeholder={placeholder} className="input py-1.5 text-sm" />
          <Amt value={x.amount} onChange={(v) => set(x.id, { amount: v })} calc={false} />
          <button type="button" onClick={() => onChange(items.filter((y) => y.id !== x.id))} className="text-gray-300 hover:text-red-600" aria-label="Remove"><Trash2 size={14} /></button>
        </div>
      ))}
      <button type="button" onClick={() => onChange([...items, { id: Math.random().toString(36).slice(2, 10), label: '', amount: '' }])} className="flex items-center gap-1 text-xs font-semibold text-primary-700"><Plus size={12} /> Add</button>
    </div>
  );
}

function Adjust({ office, setO, part, c }) {
  const setK = (k) => (v) => setO((o) => ({ ...o, [k]: v }));
  const F = ({ k, l, hint }) => <label className="block text-xs font-semibold text-gray-600">{l}<div className="mt-1"><Amt value={office[k] ?? ''} onChange={setK(k)} calc={false} /></div>{hint && <span className="text-[10px] font-normal text-gray-400">{hint}</span>}</label>;
  return (
    <div className="space-y-5">
      <div className="rounded-xl bg-amber-50 p-3 text-xs text-amber-900">Set the allowed % for each expense on the <b>Expenses</b> tab (private use, mixed bills) and the asset classes on <b>Assets</b>. Use this page for anything else.</div>
      <div className="grid gap-5 lg:grid-cols-2">
        <ListEdit title="Other add-backs (not allowed)" items={office.addBacks} onChange={setK('addBacks')} placeholder="e.g. Private telephone use, fine paid to RDA" />
        <ListEdit title="Other deductions (allowed, not in the accounts)" items={office.deducts} onChange={setK('deducts')} placeholder="e.g. R&D expense s.15, unclaimed bank charges" />
      </div>
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {F({ k: 'lossBF', l: part ? 'Partnership business loss brought forward' : 'Business loss brought forward (to the return)', hint: part ? 'Set off against this year\'s business income (s.19).' : 'Goes to the return (bizLossBF) — set off there.' })}
        {part && F({ k: 'qpCharity', l: 'Donations to approved charities', hint: 'Allowed up to 1/5 of taxable income or Rs. 500,000.' })}
        {part && F({ k: 'qpGovt', l: 'Donations to the Government / specified funds' })}
        {part && F({ k: 'ait', l: 'AIT deducted from the partnership\'s income', hint: 'Shared to partners → cage 907.' })}
        {part && F({ k: 'wht', l: 'Other WHT deducted (partnership)' })}
        {part && F({ k: 'instalments', l: 'Partnership tax instalments paid' })}
      </div>
      {c.issues.length > 0 && <div className="rounded-xl border border-amber-200 bg-amber-50 p-3 text-xs text-amber-900"><b className="flex items-center gap-1"><AlertTriangle size={13} /> Check</b><ul className="ml-4 mt-1 list-disc">{c.issues.map((x, i) => <li key={i}>{x}</li>)}</ul></div>}
    </div>
  );
}

function Result({ c, admin, acc, part, onPrint, onReturn }) {
  const R = acc.result;
  if (!admin && acc.status !== 'final') {
    return (
      <div className="space-y-3">
        <div className="grid gap-2 sm:grid-cols-4">
          <Card l="Business income" v={c.turnover} /><Card l="Cost of sales" v={c.cogs} /><Card l="Expenses" v={c.expTotal} /><Card l="Profit per your figures" v={c.netProfit} strong />
        </div>
        <p className="flex gap-1.5 text-xs text-gray-500"><Info size={13} className="mt-0.5 flex-shrink-0" /> TaxMate will adjust these figures for tax (private use, depreciation → capital allowance, items not allowed) and send you the final computation.</p>
      </div>
    );
  }
  const v = admin ? c : R || {};
  const Row = ({ l, x, b, neg, sub }) => (x || b) ? <div className={`flex justify-between gap-3 py-1.5 ${b ? 'border-t border-gray-200 font-bold text-primary-900' : 'text-gray-700'}`}><span>{l}{sub && <span className="block text-[11px] font-normal text-gray-400">{sub}</span>}</span><span className="tabular-nums">{neg && x ? `(${fm(x)})` : fm(x)}</span></div> : null;
  return (
    <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_320px]">
      <div className="rounded-xl border border-gray-100 p-4 text-sm">
        <Row l="Net profit / (loss) per the accounts" x={v.netProfit} b />
        <Row l="Add: expenses not allowed & add-backs" x={v.addTotal} sub={admin ? 'depreciation, entertainment, private use, provisions, income tax…' : null} />
        <Row l="Less: interest, rent, dividends & asset-sale profit" x={admin ? c.nonBiz : null} neg />
        <Row l="Less: capital allowances" x={v.capAllow + (admin ? c.balAllow : 0)} neg />
        {admin && <Row l="Less: other deductions" x={c.deducts.reduce((s, d) => s + d.amount, 0)} neg />}
        <Row l={v.adjusted >= 0 ? 'Adjusted business income' : 'Adjusted business loss'} x={v.adjusted} b />
        {part ? <>
          {v.lossUsed > 0 && <Row l="Less: loss brought forward" x={v.lossUsed} neg />}
          <Row l="Business income" x={v.bizIncome} />
          <Row l="Investment income (interest, rent)" x={(v.investment?.interest || 0) + (v.investment?.rent || 0) + (v.investment?.other || 0)} />
          {v.qp > 0 && <Row l="Less: qualifying payments" x={v.qp} neg />}
          <Row l="Taxable income of the partnership" x={v.taxable} b />
          <Row l="Partnership tax (0% first Rs. 1,000,000 · 6% balance)" x={v.tax} b />
        </> : <>
          <Row l="To the return — Schedule 2 business income" x={v.bizProfit} b />
          {v.loss > 0 && <Row l="Business loss (carried forward)" x={v.loss} />}
        </>}
        {admin && <div className="mt-3 flex flex-wrap gap-2">
          <button type="button" onClick={onPrint} className="btn-secondary text-xs"><Printer size={13} /> Print computation</button>
          {!part && acc.status === 'final' && <button type="button" onClick={onReturn} className="btn-primary text-xs"><FileSpreadsheet size={13} /> Open in IIT return</button>}
        </div>}
      </div>
      <div className="space-y-3">
        <div className={`rounded-2xl p-4 text-white shadow ${(part ? v.tax : v.bizProfit) > 0 ? 'bg-gradient-to-br from-primary-700 to-indigo-800' : 'bg-gradient-to-br from-gray-600 to-gray-700'}`}>
          <div className="text-[11px] font-bold uppercase tracking-wide opacity-80">{part ? 'Partnership tax' : 'Taxable business income'}</div>
          <div className="text-3xl font-black tabular-nums">{rs(part ? v.tax : v.bizProfit)}</div>
          <div className="text-xs opacity-80">Y/A {acc.year}{part ? ` · taxable income ${rs(v.taxable)}` : ` · turnover ${rs(v.turnover)}`}</div>
        </div>
        {part && (v.partners || []).length > 0 && (
          <div className="rounded-xl border border-gray-100 p-3 text-xs">
            <div className="mb-1 font-bold text-gray-700">Partners' shares</div>
            {(v.partners || []).map((p) => <div key={p.id} className="flex justify-between gap-2 border-t border-gray-50 py-1"><span>{p.name || '—'} <span className="text-gray-400">{p.share}%</span></span><span className="text-right tabular-nums">{fm(p.biz)}<span className="block text-[10px] text-gray-400">tax credit {fm(p.tax)}</span></span></div>)}
          </div>
        )}
        {admin && c.issues.length > 0 && <div className="rounded-xl border border-amber-200 bg-amber-50 p-3 text-xs text-amber-900"><b className="flex items-center gap-1"><AlertTriangle size={13} /> Check</b><ul className="ml-4 mt-1 list-disc">{c.issues.map((x, i) => <li key={i}>{x}</li>)}</ul></div>}
        {acc.status === 'final' && <div className="flex items-center gap-2 rounded-xl bg-emerald-50 p-3 text-xs text-emerald-800"><CheckCircle2 size={15} /> Final{acc.finalized_at ? ` · ${new Date(acc.finalized_at).toLocaleDateString('en-GB')}` : ''}</div>}
        {admin && acc.status === 'final' && R && Math.abs((R.adjusted || 0) - c.adjusted) > 0.5 && <div className="rounded-xl bg-red-50 p-3 text-xs text-red-800">The figures changed after finalising (saved {fm(R.adjusted)} → now {fm(c.adjusted)}). Re-open and finalise again.</div>}
      </div>
    </div>
  );
}
function Card({ l, v, strong }) { return <div className={`rounded-xl p-3 ${strong ? 'bg-primary-700 text-white' : 'bg-gray-50'}`}><div className={`text-[11px] ${strong ? 'text-primary-100' : 'text-gray-500'}`}>{l}</div><div className="text-lg font-black tabular-nums">{fm(v)}</div></div>; }
