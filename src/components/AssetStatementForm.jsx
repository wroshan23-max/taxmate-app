import { useState } from 'react';
import TopUpCalc from './TopUpCalc';
import { ChevronDown, ChevronRight, Plus, Trash2, History, ArrowRightLeft, Info, AlertCircle } from 'lucide-react';
import {
  SECTIONS, SECTION, newRow, rowsOf, totals, yearInfo, fmtMoney, num, moneyCols, isRowEmpty,
} from '../lib/assets';

// Sections where an asset carried from last year can be moved to "disposed during the year"
const DISPOSABLE = ['immovable', 'vehicles', 'shares', 'jewellery', 'other', 'business'];

function MoneyInput({ value, onChange, negative, disabled, invalid }) {
  const [focus, setFocus] = useState(false);
  const show = focus || value === '' || value === null || value === undefined
    ? (value ?? '')
    : (Number.isFinite(Number(String(value).replace(/,/g, ''))) ? Number(String(value).replace(/,/g, '')).toLocaleString('en-LK', { maximumFractionDigits: 2 }) : value);
  return (
    <div className="relative">
      <span className="absolute left-3 top-1/2 -translate-y-1/2 text-xs text-gray-400">Rs.</span>
      <input
        className={`input pl-10 pr-8 text-right tabular-nums ${invalid ? 'border-red-400 bg-red-50' : ''}`}
        inputMode="decimal" disabled={disabled} value={show} placeholder="0"
        onFocus={() => setFocus(true)} onBlur={() => setFocus(false)}
        onChange={e => {
          let v = e.target.value.replace(/[^\d.,-]/g, '').replace(/,/g, '');
          if (!negative) v = v.replace(/-/g, '');
          onChange(v);
        }}
      />
      <TopUpCalc value={value} onUse={onChange} disabled={disabled} allowNegative={negative} />
    </div>
  );
}

function Field({ col, value, onChange, readOnly, invalid }) {
  const label = (
    <label className="block text-[11px] font-semibold text-gray-600 mb-1 leading-tight">
      {col.en}{col.required && <span className="text-red-500"> *</span>}
      <span className="block font-normal text-gray-400">{col.si}</span>
    </label>
  );
  const bad = invalid ? 'border-red-400 bg-red-50' : '';
  let input;
  if (col.type === 'money') input = <MoneyInput value={value} onChange={onChange} negative={col.negative} disabled={readOnly} invalid={invalid} />;
  else if (col.type === 'select') {
    const opts = col.options.includes(value) || !value ? col.options : [value, ...col.options];
    input = (
      <select className={`input ${bad}`} value={value ?? ''} disabled={readOnly} onChange={e => onChange(e.target.value)}>
        <option value="">Select…</option>
        {opts.map(o => <option key={o} value={o}>{o}</option>)}
      </select>
    );
  } else if (col.type === 'date') {
    input = <input type="date" className={`input ${bad}`} value={value ?? ''} disabled={readOnly} onChange={e => onChange(e.target.value)} />;
  } else if (col.type === 'year') {
    input = <input className={`input tabular-nums ${bad}`} inputMode="numeric" maxLength={4} placeholder={col.placeholder} value={value ?? ''} disabled={readOnly}
      onChange={e => onChange(e.target.value.replace(/\D/g, '').slice(0, 4))} />;
  } else {
    input = <input className={`input ${bad}`} placeholder={col.placeholder} maxLength={col.maxLength ?? 200} value={value ?? ''} disabled={readOnly}
      onChange={e => onChange(col.upper ? e.target.value.toUpperCase() : e.target.value)} />;
  }
  return <div className={col.wide ? 'sm:col-span-2' : ''}>{label}{input}</div>;
}

function RowCard({ section, row, index, readOnly, errors, onChange, onRemove, onDispose }) {
  const title = section.title(row) || `${section.en.split(' ')[0]} ${index + 1}`;
  const errFields = new Set(errors.map(e => e.col));
  return (
    <div className={`rounded-xl border p-3 sm:p-4 ${errors.length ? 'border-red-300 bg-red-50/40' : row._cf ? 'border-blue-100 bg-blue-50/30' : 'border-gray-200 bg-white'}`}>
      <div className="flex items-start gap-2 mb-3">
        <span className="w-6 h-6 rounded-full bg-primary-100 text-primary-700 text-xs font-bold flex items-center justify-center flex-shrink-0">{index + 1}</span>
        <div className="flex-1 min-w-0">
          <div className="font-semibold text-sm text-gray-800 truncate">{title}</div>
          {row._cf && <div className="text-[11px] text-blue-700 flex items-center gap-1"><History size={11} /> Carried from Y/A {row._cf} — check it's still correct</div>}
        </div>
        {!readOnly && (
          <div className="flex gap-1 flex-shrink-0">
            {row._cf && DISPOSABLE.includes(section.key) && (
              <button type="button" onClick={onDispose} title="Sold / no longer owned" className="text-xs px-2 py-1 rounded-lg border border-amber-200 text-amber-800 bg-amber-50 hover:bg-amber-100 flex items-center gap-1">
                <ArrowRightLeft size={12} /> <span className="hidden sm:inline">Sold / disposed</span><span className="sm:hidden">Sold</span>
              </button>
            )}
            <button type="button" onClick={onRemove} title="Remove" className="p-1.5 rounded-lg text-gray-400 hover:text-red-600 hover:bg-red-50"><Trash2 size={15} /></button>
          </div>
        )}
      </div>
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
        {section.cols.map(c => (
          <div key={c.key} className={c.wide ? 'sm:col-span-2' : ''}>
            <Field col={{ ...c, wide: false }} value={row[c.key]} readOnly={readOnly} invalid={errFields.has(c.key)}
              onChange={v => onChange({ ...row, [c.key]: v })} />
            {c.type === 'money' && row._prev && row._prev[c.key] !== undefined && (
              <div className="text-[11px] text-gray-500 mt-1">Last year: Rs. {fmtMoney(row._prev[c.key])}
                {num(row[c.key]) !== row._prev[c.key] && String(row[c.key] ?? '') !== '' && <span className="text-blue-700"> · changed</span>}
              </div>
            )}
          </div>
        ))}
      </div>
      {errors.length > 0 && (
        <ul className="mt-2 text-xs text-red-700 space-y-0.5">{errors.map((e, k) => <li key={k} className="flex items-center gap-1"><AlertCircle size={11} /> {e.msg}</li>)}</ul>
      )}
    </div>
  );
}

function ReadRows({ section, rows }) {
  const money = moneyCols(section);
  const text = section.cols.filter(c => c.type !== 'money');
  return (
    <div className="overflow-x-auto -mx-1">
      <table className="w-full text-sm">
        <thead><tr className="text-left text-[11px] text-gray-500 uppercase">
          <th className="px-2 py-1">#</th>{text.map(c => <th key={c.key} className="px-2 py-1 font-semibold">{c.en}</th>)}
          {money.map(c => <th key={c.key} className="px-2 py-1 font-semibold text-right">{c.en}</th>)}
        </tr></thead>
        <tbody>{rows.map((r, i) => (
          <tr key={r._id ?? i} className="border-t border-gray-100 align-top">
            <td className="px-2 py-1.5 text-gray-400">{i + 1}</td>
            {text.map(c => <td key={c.key} className="px-2 py-1.5">{r[c.key] || <span className="text-gray-300">—</span>}</td>)}
            {money.map(c => <td key={c.key} className="px-2 py-1.5 text-right tabular-nums font-medium whitespace-nowrap">{String(r[c.key] ?? '') === '' ? '—' : fmtMoney(num(r[c.key]))}
              {r._prev?.[c.key] !== undefined && <div className="text-[10px] text-gray-400 font-normal">last yr {fmtMoney(r._prev[c.key])}</div>}</td>)}
          </tr>
        ))}</tbody>
      </table>
    </div>
  );
}

function Section({ section, data, setRows, readOnly, errors, open, toggle, onDispose }) {
  const rows = rowsOf(data, section.key);
  const t = totals(data);
  const total = section.key === 'business' ? t.business : t[section.key];
  const errCount = errors.length;
  const update = (i, r) => setRows(rows.map((x, k) => k === i ? r : x));
  const remove = (i) => {
    const r = rows[i];
    if (!isRowEmpty(section, r) && !window.confirm('Remove this entry?')) return;
    setRows(rows.filter((_, k) => k !== i));
  };
  return (
    <div className={`card overflow-hidden ${errCount ? 'ring-1 ring-red-300' : ''}`}>
      <button type="button" onClick={toggle} className="w-full flex items-center gap-3 px-4 py-3 text-left hover:bg-gray-50">
        <span className="text-[11px] font-bold px-2 py-0.5 rounded bg-primary-50 text-primary-700 flex-shrink-0">{section.code}</span>
        <div className="flex-1 min-w-0">
          <div className="font-semibold text-gray-800 text-sm leading-tight">{section.en}</div>
          <div className="text-xs text-gray-400 leading-tight">{section.si}</div>
        </div>
        <div className="text-right flex-shrink-0">
          <div className={`text-sm font-bold tabular-nums ${rows.length ? 'text-primary-700' : 'text-gray-300'}`}>{rows.length ? `Rs. ${fmtMoney(total)}` : 'None'}</div>
          <div className="text-[11px] text-gray-400">{rows.length} {rows.length === 1 ? 'entry' : 'entries'}{errCount ? <span className="text-red-600"> · {errCount} to fix</span> : ''}</div>
        </div>
        {open ? <ChevronDown size={18} className="text-gray-400" /> : <ChevronRight size={18} className="text-gray-400" />}
      </button>
      {open && (
        <div className="px-4 pb-4 space-y-3 border-t border-gray-100 pt-3">
          {section.help && !readOnly && (
            <p className="text-xs text-gray-500 flex gap-1.5"><Info size={13} className="flex-shrink-0 mt-0.5 text-primary-400" />
              <span>{section.help}<span className="block text-gray-400">{section.helpSi}</span></span></p>
          )}
          {readOnly
            ? (rows.length ? <ReadRows section={section} rows={rows} /> : <p className="text-sm text-gray-400 italic">Nil</p>)
            : rows.map((r, i) => (
              <RowCard key={r._id ?? i} section={section} row={r} index={i} readOnly={readOnly}
                errors={errors.filter(e => e.index === i)}
                onChange={(nr) => update(i, nr)} onRemove={() => remove(i)} onDispose={() => onDispose(section, i)} />
            ))}
          {!readOnly && !(section.single && rows.length >= 1) && (
            <button type="button" onClick={() => setRows([...rows, newRow(section)])}
              className="w-full border-2 border-dashed border-gray-200 rounded-xl py-2.5 text-sm font-semibold text-primary-600 hover:border-primary-300 hover:bg-primary-50/40 flex items-center justify-center gap-1.5">
              <Plus size={15} /> {section.add}
            </button>
          )}
          {!readOnly && rows.length === 0 && <p className="text-[11px] text-gray-400 text-center">Nothing to declare here? Leave it empty.</p>}
        </div>
      )}
    </div>
  );
}

export function AssetSummary({ data, year }) {
  const t = totals(data);
  const y = yearInfo(year);
  const prev = data?._meta?.prev_totals;
  const L = ({ l, v, cls = '' }) => <div className={`flex justify-between gap-3 py-1 ${cls}`}><span>{l}</span><span className="tabular-nums whitespace-nowrap">{v}</span></div>;
  return (
    <div className="card p-4 text-sm">
      <div className="font-semibold text-primary-800 mb-2">Summary — Net worth as at {y.asAt}</div>
      <L l="Total assets · මුළු වත්කම්" v={`Rs. ${fmtMoney(t.assets)}`} />
      <L l="Total liabilities · මුළු බැරකම්" v={`(Rs. ${fmtMoney(t.liabilities_total)})`} cls="text-red-600" />
      <L l={<b>Net worth · ශුද්ධ වත්කම</b>} v={<b>Rs. {fmtMoney(t.net)}</b>} cls="border-t border-gray-200 mt-1 pt-2 text-primary-800" />
      {prev && <L l={`Last year (Y/A ${data._meta.prev_year})`} v={`Rs. ${fmtMoney(prev.net)}`} cls="text-gray-500 text-xs" />}
      {prev && <L l="Change" v={`${t.net - prev.net >= 0 ? '+' : ''}Rs. ${fmtMoney(t.net - prev.net)}`} cls="text-gray-500 text-xs" />}
      <div className="border-t border-gray-100 mt-2 pt-2 text-xs text-gray-500">
        <L l="Acquired / gifts received during the year" v={`Rs. ${fmtMoney(t.acquired)}`} />
        <L l="Disposed / sold during the year" v={`Rs. ${fmtMoney(t.disposed)}`} />
      </div>
    </div>
  );
}

/**
 * The full A&L form. data: statement JSON; onChange(next) when editable.
 * errors: [{ section, index, msg }] from validate()
 */
export default function AssetStatementForm({ data, onChange, year, readOnly = false, errors = [] }) {
  const [open, setOpen] = useState(() => {
    // open sections that have entries (or errors) — or the first one if the form is empty
    const o = {};
    SECTIONS.forEach(s => { if (rowsOf(data, s.key).length) o[s.key] = true; });
    if (!Object.keys(o).length) o.immovable = true;
    return o;
  });
  const y = yearInfo(year);
  const setRows = (key) => (rows) => onChange({ ...data, [key]: rows });
  const dispose = (section, i) => {
    const r = rowsOf(data, section.key)[i];
    const label = section.title(r) || section.en;
    if (!window.confirm(`Move "${label}" to "Assets disposed / sold during the year"? You can then enter the sale date and value.`)) return;
    const disp = { ...newRow(SECTION.disposed), description: `${section.en.replace(/ \(.*\)/, '')}: ${label}`, mode: 'Sale' };
    onChange({ ...data, [section.key]: rowsOf(data, section.key).filter((_, k) => k !== i), disposed: [...rowsOf(data, 'disposed'), disp] });
    setOpen(o => ({ ...o, disposed: true }));
  };
  const toggle = (k) => setOpen(o => ({ ...o, [k]: !o[k] }));
  const errsFor = (k) => errors.filter(e => e.section === k);
  // make sure sections with errors are visible
  const isOpen = (k) => open[k] || errsFor(k).length > 0;

  const part = (n) => SECTIONS.filter(s => s.part === n).map(s => (
    <Section key={s.key} section={s} data={data} setRows={setRows(s.key)} readOnly={readOnly}
      errors={errsFor(s.key)} open={isOpen(s.key)} toggle={() => toggle(s.key)} onDispose={dispose} />
  ));

  return (
    <div className="space-y-3">
      {!readOnly && data?._meta?.prev_year && (
        <div className="rounded-xl border border-blue-200 bg-blue-50 p-3 text-sm text-blue-900 flex gap-2">
          <History size={16} className="flex-shrink-0 mt-0.5" />
          <div>
            We've filled in what you declared for <b>Y/A {data._meta.prev_year}</b>. Update each value to <b>{y.asAt}</b>, press <b>Sold / disposed</b> for anything you no longer own, and add anything new.
            <div className="text-blue-700 text-xs mt-1">පසුගිය වසරේ විස්තර පුරවා ඇත. {y.asAt} දිනට වටිනාකම් යාවත්කාලීන කරන්න, නැති දේ ඉවත් කරන්න, අලුත් දේ එකතු කරන්න.</div>
          </div>
        </div>
      )}
      <div className="flex items-baseline justify-between pt-1">
        <h3 className="font-bold text-primary-800">Part 1 — What you owned & owed on {y.asAt}</h3>
      </div>
      {part(1)}
      <div className="pt-2"><h3 className="font-bold text-primary-800">Part 2 — Changes during the year</h3>
        <p className="text-xs text-gray-500">{y.period} · වර්ෂය තුළ වූ වෙනස්කම්</p></div>
      {part(2)}
    </div>
  );
}
