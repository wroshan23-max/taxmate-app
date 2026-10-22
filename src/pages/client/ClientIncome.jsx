import { useCallback, useEffect, useRef, useState } from 'react';
import TopUpCalc from '../../components/TopUpCalc';
import { useSearchParams } from 'react-router-dom';
import toast from 'react-hot-toast';
import { Wallet, Save, Send, Loader2, CheckCircle2, Clock, AlertTriangle, Copy, X, Table2, CalendarDays } from 'lucide-react';
import { supabase, fmtDate } from '../../lib/supabase';
import {
  GROUPS, MONTHS, monthLabel, emptySheet, cell, rowTotal, monthTotals, sheetTotals, cleanSheet,
} from '../../lib/incomeSheet';

const rs = (n) => `Rs. ${Math.round(n || 0).toLocaleString('en-LK')}`;
const toNum = (v) => { const n = Number(String(v ?? '').replace(/,/g, '')); return Number.isFinite(n) ? n : 0; };
const time = (d) => d.toLocaleTimeString('en-LK', { hour: '2-digit', minute: '2-digit' });

function Money({ value, onChange, disabled }) {
  const [focus, setFocus] = useState(false);
  const shown = focus || value === '' ? value : toNum(value).toLocaleString('en-LK');
  return (
    <div className="relative">
      <span className="absolute left-3 top-1/2 -translate-y-1/2 text-[11px] font-semibold text-gray-400">Rs.</span>
      <input className="input pl-10 pr-8 text-right tabular-nums" inputMode="decimal" placeholder="0" value={shown} disabled={disabled}
        onFocus={() => setFocus(true)} onBlur={() => setFocus(false)} onChange={e => onChange(e.target.value.replace(/[^\d.]/g, ''))} />
      <TopUpCalc value={value} onUse={onChange} disabled={disabled} />
    </div>
  );
}

export default function ClientIncome() {
  const [params, setParams] = useSearchParams();
  const [list, setList] = useState([]);
  const [loading, setLoading] = useState(true);
  const [sel, setSel] = useState(null);
  const [data, setData] = useState(emptySheet());
  const [note, setNote] = useState('');
  const [month, setMonth] = useState(0);
  const [view, setView] = useState('month');
  const [dirty, setDirty] = useState(false);
  const [saving, setSaving] = useState(false);
  const [savedAt, setSavedAt] = useState(null);
  const [confirm, setConfirm] = useState(false);
  const [declared, setDeclared] = useState(false);
  const timer = useRef(null);
  const latest = useRef({ data, note });
  latest.current = { data, note };
  const selRef = useRef(null);
  selRef.current = sel;

  const pick = (s) => {
    clearTimeout(timer.current); timer.current = null;
    setSel(s);
    setData(s?.data?.rows ? s.data : emptySheet());
    setNote(s?.client_note ?? '');
    setDirty(false); setSavedAt(null);
    // start on the current month of the Y/A if it is running, else April
    const now = new Date(); const ys = parseInt(s?.year, 10);
    const idx = (now.getFullYear() - ys) * 12 + now.getMonth() - 3;
    setMonth(idx >= 0 && idx < 12 ? idx : 0);
  };

  const load = useCallback(async (keepYear) => {
    const { data: rows, error } = await supabase.from('income_sheets').select('*').order('year', { ascending: false });
    if (error) toast.error(error.message);
    setList(rows ?? []); setLoading(false);
    const want = keepYear || params.get('year');
    pick((rows ?? []).find(r => r.year === want) ?? (rows ?? []).find(r => r.status === 'open') ?? rows?.[0] ?? null);
  }, []); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { load(); }, [load]);

  useEffect(() => {
    const h = (e) => { if (dirty) { e.preventDefault(); e.returnValue = ''; } };
    window.addEventListener('beforeunload', h);
    return () => window.removeEventListener('beforeunload', h);
  }, [dirty]);

  // Save any pending auto-save when leaving the page
  useEffect(() => () => {
    if (!timer.current) return;
    clearTimeout(timer.current);
    const s = selRef.current, cur = latest.current;
    if (s?.status === 'open') supabase.rpc('save_my_income_sheet', { p_id: s.id, p_data: cleanSheet(cur.data), p_note: cur.note, p_submit: false });
  }, []);

  const editable = sel?.status === 'open';

  const save = async ({ submit = false, quiet = false } = {}) => {
    if (!sel) return false;
    clearTimeout(timer.current); timer.current = null;
    setSaving(true);
    const cur = latest.current;
    const { error } = await supabase.rpc('save_my_income_sheet', { p_id: sel.id, p_data: cleanSheet(cur.data), p_note: cur.note, p_submit: submit });
    setSaving(false);
    if (error) { toast.error(error.message); return false; }
    setDirty(false); setSavedAt(new Date());
    if (!quiet) toast.success(submit ? 'Submitted to TaxMate — thank you!' : 'Saved');
    if (submit) await load(sel.year);
    return true;
  };
  const schedule = () => { clearTimeout(timer.current); timer.current = setTimeout(() => save({ quiet: true }), 4000); };

  const setCell = (key, i, v) => {
    setData(d => ({ ...d, rows: { ...d.rows, [key]: (d.rows[key] ?? Array(12).fill('')).map((x, k) => (k === i ? v : x)) } }));
    setDirty(true); schedule();
  };
  const copyPrev = () => {
    if (month === 0) return;
    if (!window.confirm(`Copy all figures from ${monthLabel(sel.year, month - 1)} into ${monthLabel(sel.year, month)}?`)) return;
    setData(d => ({ ...d, rows: Object.fromEntries(Object.entries(d.rows).map(([k, arr]) => [k, arr.map((x, i) => (i === month ? arr[month - 1] : x))])) }));
    setDirty(true); schedule();
  };

  if (loading) return <div className="flex items-center justify-center h-64 text-gray-400">Loading...</div>;
  if (!sel) return (
    <div className="space-y-4">
      <h1 className="text-2xl font-bold text-primary-800 flex items-center gap-2"><Wallet size={22} /> Monthly Income</h1>
      <div className="card p-8 text-center text-gray-500 text-sm">TaxMate has not opened a monthly income sheet for you yet.</div>
    </div>
  );

  const t = sheetTotals(data);
  const mt = monthTotals(data, month);
  const monthly = MONTHS.map((_, i) => { const x = monthTotals(data, i); return x.income + x.fx + Math.max(0, x.bizProfit); });
  const maxM = Math.max(1, ...monthly);
  const ys = parseInt(sel.year, 10);

  return (
    <div className="space-y-4 pb-24">
      <div className="flex items-start gap-3 flex-wrap">
        <div className="flex-1 min-w-[220px]">
          <h1 className="text-2xl font-bold text-primary-800 flex items-center gap-2"><Wallet size={22} /> Monthly Income &amp; Business</h1>
          <p className="text-sm text-gray-500">Y/A {sel.year} · 1 April {ys} – 31 March {ys + 1} · මාසික ආදායම හා ව්‍යාපාරික විස්තර</p>
        </div>
        {list.length > 1 && (
          <div className="flex gap-1 bg-gray-100 p-1 rounded-xl max-w-full overflow-x-auto">
            {list.map(s => (
              <button key={s.id} onClick={() => { if (dirty && !window.confirm('You have unsaved changes. Switch year?')) return; pick(s); setParams({ year: s.year }); }}
                className={`px-3 py-1.5 rounded-lg text-xs font-semibold whitespace-nowrap ${sel.id === s.id ? 'bg-white text-primary-700 shadow-sm' : 'text-gray-500'}`}>Y/A {s.year}</button>
            ))}
          </div>
        )}
      </div>

      {sel.status === 'open' && sel.admin_note && (
        <div className="rounded-xl border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900 flex gap-2"><AlertTriangle size={16} className="flex-shrink-0 mt-0.5" /><div><b>TaxMate asked for a change:</b> {sel.admin_note}</div></div>
      )}
      {sel.status === 'submitted' && <div className="rounded-xl border border-blue-200 bg-blue-50 p-3 text-sm text-blue-900 flex gap-2 items-center"><Clock size={16} /> Submitted on {fmtDate(sel.submitted_at)}. TaxMate is reviewing it. Message us if you need to change something.</div>}
      {sel.status === 'reviewed' && <div className="rounded-xl border border-green-200 bg-green-50 p-3 text-sm text-green-900 flex gap-2 items-center"><CheckCircle2 size={16} /> Reviewed by TaxMate on {fmtDate(sel.reviewed_at)}. Thank you!</div>}

      {/* Year summary */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        {[['Income (Sri Lanka)', t.income, 'text-green-700'], ['Foreign income', t.fx, 'text-blue-700'], ['Business profit', t.bizProfit, t.bizProfit < 0 ? 'text-red-600' : 'text-orange-600'], ['Tax already deducted', t.credit, 'text-teal-700']].map(([l, v, c]) => (
          <div key={l} className="card p-3"><div className={`text-lg font-black tabular-nums ${c}`}>{rs(v)}</div><div className="text-[11px] text-gray-500">{l} · year so far</div></div>
        ))}
      </div>

      {/* Month strip with mini bars */}
      <div className="card p-3">
        <div className="flex items-center gap-2 mb-2">
          <div className="text-xs font-semibold text-gray-500 flex-1">{t.monthsFilled}/12 months filled</div>
          <div className="flex bg-gray-100 rounded-lg p-0.5">
            <button onClick={() => setView('month')} className={`px-2.5 py-1 rounded-md text-xs font-semibold flex items-center gap-1 ${view === 'month' ? 'bg-white shadow-sm text-primary-700' : 'text-gray-500'}`}><CalendarDays size={13} /> Month</button>
            <button onClick={() => setView('year')} className={`px-2.5 py-1 rounded-md text-xs font-semibold flex items-center gap-1 ${view === 'year' ? 'bg-white shadow-sm text-primary-700' : 'text-gray-500'}`}><Table2 size={13} /> Whole year</button>
          </div>
        </div>
        <div className="grid grid-cols-12 gap-1">
          {MONTHS.map((m, i) => (
            <button key={m} onClick={() => { setMonth(i); setView('month'); }}
              className={`rounded-lg pt-1 pb-1.5 flex flex-col items-center ${view === 'month' && month === i ? 'bg-primary-600 text-white' : 'hover:bg-gray-100 text-gray-600'}`}>
              <div className="h-8 w-full flex items-end justify-center px-0.5">
                <div className={`w-full max-w-[14px] rounded-sm ${view === 'month' && month === i ? 'bg-gold-500' : monthly[i] ? 'bg-primary-300' : 'bg-gray-200'}`} style={{ height: `${Math.max(8, (monthly[i] / maxM) * 100)}%` }} />
              </div>
              <span className="text-[10px] font-semibold mt-0.5">{m}</span>
            </button>
          ))}
        </div>
      </div>

      {view === 'month' ? (
        <div className="space-y-3">
          <div className="flex items-center gap-2 flex-wrap">
            <h2 className="font-bold text-primary-800 text-lg flex-1">{monthLabel(sel.year, month)}</h2>
            {editable && month > 0 && <button onClick={copyPrev} className="btn-secondary text-xs py-1.5"><Copy size={13} /> Same as {MONTHS[month - 1]}</button>}
          </div>
          {GROUPS.map(g => (
            <div key={g.key} className="card p-4">
              <div className="font-semibold text-gray-800 text-sm">{g.en}</div>
              <div className="text-xs text-gray-400 mb-3">{g.si}</div>
              <div className="grid sm:grid-cols-2 gap-3">
                {g.rows.map(r => (
                  <div key={r.key}>
                    <label className="block text-xs font-semibold text-gray-600 leading-tight">{r.en}</label>
                    <div className="text-[11px] text-gray-400 mb-1">{r.si}{r.hint ? ` · ${r.hint}` : ''}</div>
                    <Money value={cell(data, r.key, month)} onChange={(v) => setCell(r.key, month, v)} disabled={!editable} />
                  </div>
                ))}
              </div>
              {g.key === 'expenses' && (mt.bizIncome > 0 || mt.bizExpense > 0) && (
                <div className={`mt-3 rounded-lg px-3 py-2 text-sm font-semibold flex justify-between ${mt.bizProfit < 0 ? 'bg-red-50 text-red-700' : 'bg-orange-50 text-orange-800'}`}>
                  <span>Business {mt.bizProfit < 0 ? 'loss' : 'profit'} for {MONTHS[month]}</span><span className="tabular-nums">{rs(Math.abs(mt.bizProfit))}</span>
                </div>
              )}
            </div>
          ))}
          {editable && (
            <div className="flex gap-2">
              {month > 0 && <button onClick={() => setMonth(month - 1)} className="btn-secondary flex-1 justify-center">← {MONTHS[month - 1]}</button>}
              {month < 11 && <button onClick={() => setMonth(month + 1)} className="btn-primary flex-1 justify-center">Next: {MONTHS[month + 1]} →</button>}
            </div>
          )}
        </div>
      ) : (
        <div className="card overflow-x-auto">
          <table className="w-full text-xs">
            <thead className="bg-gray-50"><tr>
              <th className="text-left px-3 py-2 sticky left-0 bg-gray-50 min-w-[180px]">Item</th>
              {MONTHS.map(m => <th key={m} className="px-2 py-2 text-right">{m}</th>)}
              <th className="px-3 py-2 text-right bg-primary-50 text-primary-800">Total</th>
            </tr></thead>
            <tbody>
              {GROUPS.map(g => [
                <tr key={g.key} className="bg-gray-50/60"><td colSpan={14} className="px-3 py-1.5 font-bold text-gray-700">{g.en}</td></tr>,
                ...g.rows.map(r => (
                  <tr key={r.key} className="border-t border-gray-100">
                    <td className="px-3 py-1.5 sticky left-0 bg-white">{r.en}</td>
                    {MONTHS.map((_, i) => <td key={i} className="px-2 py-1.5 text-right tabular-nums text-gray-600">{toNum(cell(data, r.key, i)) ? toNum(cell(data, r.key, i)).toLocaleString('en-LK') : ''}</td>)}
                    <td className="px-3 py-1.5 text-right tabular-nums font-semibold bg-primary-50/50">{rowTotal(data, r.key) ? rowTotal(data, r.key).toLocaleString('en-LK') : '—'}</td>
                  </tr>
                )),
              ])}
              <tr className="border-t-2 border-primary-200 font-bold"><td className="px-3 py-2 sticky left-0 bg-white">Business profit / (loss)</td>
                {MONTHS.map((_, i) => { const p = monthTotals(data, i).bizProfit; return <td key={i} className={`px-2 py-2 text-right tabular-nums ${p < 0 ? 'text-red-600' : ''}`}>{p ? p.toLocaleString('en-LK') : ''}</td>; })}
                <td className={`px-3 py-2 text-right tabular-nums bg-primary-50 ${t.bizProfit < 0 ? 'text-red-600' : 'text-primary-800'}`}>{t.bizProfit.toLocaleString('en-LK')}</td></tr>
            </tbody>
          </table>
          <p className="text-[11px] text-gray-400 px-3 py-2">To change a figure, tap a month above.</p>
        </div>
      )}

      {(editable || note) && (
        <div className="card p-4">
          <label className="block text-sm font-semibold text-gray-700 mb-1">Anything else we should know? <span className="font-normal text-gray-400">(optional)</span></label>
          <textarea className="input min-h-[70px]" maxLength={2000} disabled={!editable} value={note} placeholder="e.g. My salary increased from July. I received a bonus in December."
            onChange={e => { setNote(e.target.value); setDirty(true); schedule(); }} />
        </div>
      )}

      {editable && (
        <div className="fixed bottom-0 left-0 right-0 md:left-56 lg:left-64 bg-white/95 backdrop-blur border-t border-gray-200 px-4 py-3 flex items-center gap-2 z-30">
          <div className="flex-1 text-xs text-gray-500 min-w-0 truncate">
            {saving ? <span className="flex items-center gap-1"><Loader2 size={12} className="animate-spin" /> Saving…</span> : dirty ? 'Unsaved changes' : savedAt ? `Saved at ${time(savedAt)}` : `Last saved ${fmtDate(sel.updated_at)}`}
          </div>
          <button onClick={() => save()} disabled={saving || !dirty} className="btn-secondary text-sm"><Save size={14} /> Save</button>
          <button onClick={() => { setDeclared(false); setConfirm(true); }} disabled={saving} className="btn-primary text-sm"><Send size={14} /> Submit to TaxMate</button>
        </div>
      )}

      {confirm && (
        <div className="fixed inset-0 bg-black/40 z-50 flex items-end sm:items-center justify-center p-0 sm:p-4" onClick={() => setConfirm(false)}>
          <div className="bg-white w-full sm:max-w-md rounded-t-2xl sm:rounded-2xl p-5 space-y-4" onClick={e => e.stopPropagation()}>
            <div className="flex items-center gap-2"><Send size={18} className="text-primary-600" /><h3 className="font-bold text-primary-800 flex-1">Submit Y/A {sel.year}</h3><button onClick={() => setConfirm(false)} className="text-gray-400"><X size={18} /></button></div>
            <div className="text-sm bg-gray-50 rounded-lg p-3 space-y-1">
              <div className="flex justify-between"><span>Income in Sri Lanka</span><b>{rs(t.income)}</b></div>
              <div className="flex justify-between"><span>Foreign income</span><b>{rs(t.fx)}</b></div>
              <div className="flex justify-between"><span>Business profit / (loss)</span><b>{rs(t.bizProfit)}</b></div>
              <div className="flex justify-between"><span>Tax already deducted</span><b>{rs(t.credit)}</b></div>
              {t.monthsFilled < 12 && <div className="text-amber-700 text-xs pt-1">Only {t.monthsFilled} of 12 months have figures. Submit anyway if the other months had no income.</div>}
            </div>
            <label className="flex gap-2 text-sm text-gray-700 cursor-pointer">
              <input type="checkbox" className="mt-1" checked={declared} onChange={e => setDeclared(e.target.checked)} />
              <span>I confirm these figures are true and complete to the best of my knowledge.<span className="block text-xs text-gray-400 mt-0.5">මෙම තොරතුරු සත්‍ය හා සම්පූර්ණ බව තහවුරු කරමි.</span></span>
            </label>
            <button onClick={async () => { if (declared && await save({ submit: true })) setConfirm(false); }} disabled={!declared || saving} className="btn-primary w-full justify-center">
              {saving ? <><Loader2 size={15} className="animate-spin" /> Submitting…</> : 'Submit to TaxMate'}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
