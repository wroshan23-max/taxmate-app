import { useEffect, useRef, useState } from 'react';
import toast from 'react-hot-toast';
import { Save, X, Loader2, ArrowRightToLine, Eraser, ClipboardPaste, AlertTriangle, CheckCircle2 } from 'lucide-react';
import { supabase } from '../lib/supabase';
import { GROUPS, ROWS, MONTHS, monthLabel, cell, rowTotal, monthTotals, sheetTotals, cleanSheet, emptySheet } from '../lib/incomeSheet';

const toNum = (v) => { const n = Number(String(v ?? '').replace(/,/g, '')); return Number.isFinite(n) ? n : 0; };
const fmt = (v) => (toNum(v) ? toNum(v).toLocaleString('en-LK') : '');
const rs = (n) => `Rs. ${Math.round(n || 0).toLocaleString('en-LK')}`;
const clean = (v) => String(v ?? '').replace(/[^\d.-]/g, '');

/** One editable amount in the grid: shows 1,234,567 — plain digits while typing. */
function Cell({ value, onChange, onPaste, onKey, id }) {
  const [focus, setFocus] = useState(false);
  return (
    <input id={id} inputMode="decimal" value={focus ? value : fmt(value)} placeholder="·"
      className="w-full min-w-[84px] bg-transparent px-1.5 py-1 text-right tabular-nums text-xs rounded focus:bg-white focus:outline-none focus:ring-2 focus:ring-primary-400 placeholder:text-gray-200 hover:bg-primary-50/60"
      onFocus={(e) => { setFocus(true); requestAnimationFrame(() => e.target.select()); }} onBlur={() => setFocus(false)}
      onChange={e => onChange(clean(e.target.value))} onPaste={onPaste} onKeyDown={onKey} />
  );
}

/**
 * Admin: enter / correct a client's monthly income sheet (all 12 months at once, like a spreadsheet).
 * Works whatever the sheet's status, and also for clients without a portal login.
 */
export default function IncomeSheetEditor({ sheet, client, onClose, onSaved }) {
  const [data, setData] = useState(() => (sheet.data?.rows ? cleanSheet(sheet.data) : emptySheet()));
  const [dirty, setDirty] = useState(false);
  const [busy, setBusy] = useState(false);
  const base = useRef(sheet.updated_at);
  const clientMayEdit = sheet.enabled && sheet.status === 'open' && !!client.profile_id;

  useEffect(() => {
    const h = (e) => { if (dirty) { e.preventDefault(); e.returnValue = ''; } };
    window.addEventListener('beforeunload', h);
    return () => window.removeEventListener('beforeunload', h);
  }, [dirty]);

  const setRow = (key, fn) => { setData(d => ({ ...d, rows: { ...d.rows, [key]: fn(d.rows[key] ?? Array(12).fill('')) } })); setDirty(true); };
  const setCell = (key, i, v) => setRow(key, arr => arr.map((x, k) => (k === i ? v : x)));
  const fillRow = (key) => setRow(key, arr => {
    const first = arr.find(v => toNum(v)); if (!first) return arr;
    return arr.map(v => (String(v ?? '').trim() === '' ? first : v));
  });
  const clearRow = (key) => setRow(key, () => Array(12).fill(''));

  // Paste from Excel / Google Sheets: tabs = next month, new lines = next item
  const paste = (ri, mi) => (e) => {
    const text = e.clipboardData.getData('text');
    if (!/[\t\n]/.test(text.trim())) return;   // a single value: normal paste
    e.preventDefault();
    const lines = text.replace(/\r/g, '').split('\n').filter((l, i, a) => l !== '' || i < a.length - 1);
    const cells = [];   // [rowKey, month, value]
    lines.forEach((line, dr) => {
      const r = ROWS[ri + dr]; if (!r) return;
      line.split('\t').forEach((v, dc) => { if (mi + dc < 12) cells.push([r.key, mi + dc, clean(v)]); });
    });
    const n = cells.length;
    setData(d => {
      const rows = { ...d.rows };
      for (const [k, m, v] of cells) { rows[k] = [...(rows[k] ?? Array(12).fill(''))]; rows[k][m] = v; }
      return { ...d, rows };
    });
    setDirty(true);
    toast.success(`Pasted ${n} figure${n === 1 ? '' : 's'}`);
  };
  // Enter / arrow keys move like a spreadsheet
  const key = (ri, mi) => (e) => {
    const go = (r, m) => { const el = document.getElementById(`isc-${r}-${m}`); if (el) { e.preventDefault(); el.focus(); } };
    if (e.key === 'Enter' || e.key === 'ArrowDown') go(ri + (e.shiftKey && e.key === 'Enter' ? -1 : 1), mi);
    else if (e.key === 'ArrowUp') go(ri - 1, mi);
    else if (e.key === 'ArrowRight' && e.target.selectionStart === e.target.value.length) go(ri, mi + 1);
    else if (e.key === 'ArrowLeft' && e.target.selectionStart === 0) go(ri, mi - 1);
    else if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 's') { e.preventDefault(); save(); }
  };

  const save = async (extra = {}) => {
    setBusy(true);
    // someone (e.g. the client) saved after we opened it?
    const { data: now } = await supabase.from('income_sheets').select('updated_at, status').eq('id', sheet.id).single();
    if (now && base.current && new Date(now.updated_at).getTime() !== new Date(base.current).getTime()
      && !window.confirm('This sheet was changed after you opened it (maybe by the client). Save anyway and replace those changes?')) { setBusy(false); return; }
    const ts = new Date().toISOString();
    const payload = { data: { ...cleanSheet(data), note: sheet.data?.note ?? '' }, updated_at: ts, ...extra };
    const { error } = await supabase.from('income_sheets').update(payload).eq('id', sheet.id);
    setBusy(false);
    if (error) return toast.error(error.message);
    base.current = ts; setDirty(false);
    toast.success(extra.status === 'reviewed' ? 'Saved and marked reviewed' : 'Saved');
    onSaved?.();
    if (extra.status) onClose?.();
  };
  const close = () => { if (dirty && !window.confirm('Close without saving your changes?')) return; onClose?.(); };

  const t = sheetTotals(data);
  let ri = -1;

  return (
    <div className="border-t-2 border-primary-200 bg-white">
      <div className="px-4 py-3 flex items-center gap-2 flex-wrap bg-primary-50/60">
        <div className="flex-1 min-w-[220px]">
          <div className="font-bold text-primary-800">Enter figures — Y/A {sheet.year}</div>
          <div className="text-[11px] text-gray-500">Type in any month · Enter / arrows to move · paste a row or block straight from Excel · <ArrowRightToLine size={11} className="inline" /> fills empty months with the first figure</div>
        </div>
        <span className="text-xs text-gray-500">{busy ? 'Saving…' : dirty ? 'Unsaved changes' : 'Saved'}</span>
        <button onClick={close} className="btn-secondary text-xs py-1.5"><X size={13} /> Close</button>
        <button onClick={() => save()} disabled={busy || !dirty} className="btn-primary text-xs py-1.5">{busy ? <Loader2 size={13} className="animate-spin" /> : <Save size={13} />} Save</button>
        {sheet.status !== 'reviewed' && <button onClick={() => save({ status: 'reviewed', reviewed_at: new Date().toISOString() })} disabled={busy} className="btn-secondary text-xs py-1.5 !text-emerald-700"><CheckCircle2 size={13} /> Save &amp; mark reviewed</button>}
      </div>

      {clientMayEdit && (
        <div className="mx-4 mt-3 text-xs text-amber-800 bg-amber-50 border border-amber-200 rounded-lg p-2 flex gap-2"><AlertTriangle size={14} className="flex-shrink-0 mt-0.5" />
          {client.full_name?.split(' ')[0]} can still edit this sheet in the portal. If you both edit at the same time, the last save wins — the app warns you before replacing their changes.</div>
      )}

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-2 px-4 pt-3">
        {[['Income (Sri Lanka)', t.income, 'text-green-700'], ['Foreign income', t.fx, 'text-blue-700'], ['Business profit', t.bizProfit, t.bizProfit < 0 ? 'text-red-600' : 'text-orange-600'], ['Tax already deducted', t.credit, 'text-teal-700']].map(([l, v, c]) => (
          <div key={l} className="rounded-xl border border-gray-100 p-2.5"><div className={`font-black tabular-nums ${c}`}>{rs(v)}</div><div className="text-[11px] text-gray-500">{l} · {t.monthsFilled}/12 months</div></div>
        ))}
      </div>

      <div className="overflow-x-auto p-2 pb-4">
        <table className="w-full text-xs border-separate border-spacing-0">
          <thead><tr className="bg-gray-50">
            <th className="text-left px-3 py-2 sticky left-0 z-10 bg-gray-50 min-w-[190px]">Item</th>
            {MONTHS.map((m, i) => <th key={m} className="px-1.5 py-2 text-right font-semibold" title={monthLabel(sheet.year, i)}>{m}</th>)}
            <th className="px-3 py-2 text-right bg-primary-50 text-primary-800">Total</th>
            <th className="px-1" />
          </tr></thead>
          <tbody>
            {GROUPS.map(g => [
              <tr key={g.key}><td className="px-3 pt-3 pb-1 font-bold text-gray-700 sticky left-0 z-10 bg-white whitespace-nowrap">{g.en}</td><td colSpan={14} /></tr>,
              ...g.rows.map(r => {
                ri += 1; const rIdx = ri;
                return (
                  <tr key={r.key} className="group">
                    <td className="px-3 py-0.5 sticky left-0 z-10 bg-white border-t border-gray-100" title={r.hint || r.si}>{r.en}</td>
                    {MONTHS.map((_, i) => (
                      <td key={i} className="p-0.5 border-t border-gray-100">
                        <Cell id={`isc-${rIdx}-${i}`} value={cell(data, r.key, i)} onChange={(v) => setCell(r.key, i, v)} onPaste={paste(rIdx, i)} onKey={key(rIdx, i)} />
                      </td>
                    ))}
                    <td className="px-3 py-0.5 text-right tabular-nums font-semibold bg-primary-50/50 border-t border-gray-100">{rowTotal(data, r.key) ? rowTotal(data, r.key).toLocaleString('en-LK') : '—'}</td>
                    <td className="px-1 border-t border-gray-100 whitespace-nowrap opacity-40 group-hover:opacity-100">
                      <button onClick={() => fillRow(r.key)} title="Fill empty months with the first figure" className="p-1 text-primary-700 hover:bg-primary-50 rounded"><ArrowRightToLine size={13} /></button>
                      <button onClick={() => clearRow(r.key)} title="Clear this row" className="p-1 text-gray-400 hover:text-red-600 hover:bg-red-50 rounded"><Eraser size={13} /></button>
                    </td>
                  </tr>
                );
              }),
            ])}
            <tr className="font-bold"><td className="px-3 py-2 sticky left-0 bg-white border-t-2 border-primary-200">Business profit / (loss)</td>
              {MONTHS.map((_, i) => { const p = monthTotals(data, i).bizProfit; return <td key={i} className={`px-1.5 py-2 text-right tabular-nums border-t-2 border-primary-200 ${p < 0 ? 'text-red-600' : ''}`}>{p ? p.toLocaleString('en-LK') : ''}</td>; })}
              <td className={`px-3 py-2 text-right tabular-nums bg-primary-50 border-t-2 border-primary-200 ${t.bizProfit < 0 ? 'text-red-600' : 'text-primary-800'}`}>{t.bizProfit.toLocaleString('en-LK')}</td><td className="border-t-2 border-primary-200" /></tr>
          </tbody>
        </table>
        <p className="text-[11px] text-gray-400 px-2 pt-2 flex items-center gap-1"><ClipboardPaste size={12} /> Tip: copy 12 months of salary from Excel, click the April cell of Salary and paste — all months fill in.</p>
      </div>
    </div>
  );
}
