// V72 — TaxMate office working for the Business & Freelance tool (staff only)
// Work-use % per expense, equipment class & capital allowance, net business income → IIT Return.
import { useEffect, useMemo, useRef, useState } from 'react';
import toast from 'react-hot-toast';
import { Save, Loader2, Plus, Trash2, Printer, AlertTriangle, FileSpreadsheet, Info } from 'lucide-react';
import { supabase } from '../lib/supabase';
import { cleanAssets } from '../lib/incomeSheet';
import { CA_CLASSES, DEFAULT_PCT, computeWorking, guessClass, loadOffice, saveOffice } from '../lib/bizWorking';

const rs = (n) => `Rs. ${(Math.round((n || 0) * 100) / 100).toLocaleString('en-LK', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const r0 = (n) => Math.round(n || 0).toLocaleString('en-LK');
const pctIn = 'w-16 rounded border border-gray-200 px-1.5 py-1 text-right text-xs tabular-nums focus:border-primary-400 focus:outline-none';

export default function BizWorkingPanel({ sheet, client, onSheetChanged, onOpenReturn }) {
  const [office, setOffice] = useState(null);
  const [assets, setAssets] = useState(() => cleanAssets(sheet.data?.assets));
  const [dirty, setDirty] = useState(false);
  const [assetsDirty, setAssetsDirty] = useState(false);
  const [busy, setBusy] = useState(false);
  const [missing, setMissing] = useState(false);
  const base = useRef(sheet.updated_at);

  useEffect(() => { loadOffice(sheet.id).then((r) => { setOffice(r.data || {}); setMissing(!!r.missing); }).catch((e) => toast.error(e.message)); }, [sheet.id]);
  useEffect(() => { setAssets(cleanAssets(sheet.data?.assets)); base.current = sheet.updated_at; setAssetsDirty(false); }, [sheet.id, sheet.updated_at]); // eslint-disable-line react-hooks/exhaustive-deps

  const data = useMemo(() => ({ ...sheet.data, assets }), [sheet.data, assets]);
  const w = useMemo(() => (office ? computeWorking(data, office, sheet.year) : null), [data, office, sheet.year]);

  const setO = (fn) => { setOffice((o) => fn({ ...o })); setDirty(true); };
  const setPct = (k, v) => setO((o) => ({ ...o, pct: { ...(o.pct || {}), [k]: v === '' ? null : Math.min(100, Math.max(0, Number(v))) } }));
  const setRemark = (k, v) => setO((o) => ({ ...o, remarks: { ...(o.remarks || {}), [k]: v.slice(0, 200) } }));
  const setA = (id, p) => setO((o) => ({ ...o, assets: { ...(o.assets || {}), [id]: { ...(o.assets?.[id] || {}), ...p } } }));
  const editAsset = (id, p) => { setAssets((l) => l.map((a) => (a.id === id ? { ...a, ...p } : a))); setAssetsDirty(true); };
  const addAsset = () => { setAssets((l) => [...l, { id: Math.random().toString(36).slice(2, 10), item: '', date: '', cost: '', work: 'yes', disposed: false, disposedOn: '', proceeds: '', note: '' }]); setAssetsDirty(true); };
  const delAsset = (id) => { if (!window.confirm('Remove this asset from the list?')) return; setAssets((l) => l.filter((a) => a.id !== id)); setAssetsDirty(true); };

  const save = async () => {
    setBusy(true);
    try {
      if (assetsDirty) {
        const { data: now } = await supabase.from('income_sheets').select('updated_at, data').eq('id', sheet.id).single();
        if (now && base.current && new Date(now.updated_at).getTime() !== new Date(base.current).getTime()
          && !window.confirm('The client changed this sheet after you opened it. Save your equipment list anyway (their other figures are kept)?')) { setBusy(false); return; }
        const ts = new Date().toISOString();
        const { error } = await supabase.from('income_sheets').update({ data: { ...(now?.data || sheet.data), assets: cleanAssets(assets) }, updated_at: ts }).eq('id', sheet.id);
        if (error) throw new Error(error.message);
        base.current = ts; setAssetsDirty(false);
      }
      if (dirty) { await saveOffice(sheet, office); setDirty(false); }
      toast.success('Working saved');
      onSheetChanged?.();
    } catch (e) { toast.error(e.message); }
    setBusy(false);
  };

  const print = () => {
    if (!w) return;
    const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
    const m = (n) => (Math.round((n || 0) * 100) / 100).toLocaleString('en-LK', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
    const html = `<!doctype html><html><head><meta charset="utf-8"><title>Business income working — ${esc(client.full_name)} — Y/A ${sheet.year}</title>
<style>body{font:12px/1.45 system-ui,Segoe UI,Arial;margin:28px;color:#111}h1{font-size:17px;margin:0}h2{font-size:13px;margin:18px 0 6px;border-bottom:1px solid #ccc;padding-bottom:3px}
table{border-collapse:collapse;width:100%}td,th{border:1px solid #ddd;padding:4px 6px;text-align:left}th{background:#f3f4f6}.r{text-align:right;font-variant-numeric:tabular-nums}.t td{font-weight:700;background:#f9fafb}.s{color:#555;font-size:11px}</style></head><body>
<h1>Income from business / profession — working</h1><div class="s">${esc(client.full_name)}${client.tin ? ` · TIN ${esc(client.tin)}` : ''} · Year of assessment ${sheet.year} (1 April ${parseInt(sheet.year, 10)} – 31 March ${parseInt(sheet.year, 10) + 1})</div>
<h2>1. Gross income</h2><table><tr><td>Foreign-currency service / freelance income received through a bank</td><td class="r">${m(w.grossFx)}</td></tr><tr><td>Business income in Sri Lanka</td><td class="r">${m(w.grossLocal)}</td></tr><tr class="t"><td>Total gross income</td><td class="r">${m(w.gross)}</td></tr></table>
<h2>2. Expenses (s.11 — only the share incurred in producing the income)</h2><table><tr><th>Expense</th><th class="r">Annual total</th><th class="r">Work-use %</th><th class="r">Claimable</th><th>Basis</th></tr>
${w.expenses.filter((x) => x.total).map((x) => `<tr><td>${esc(x.en)}</td><td class="r">${m(x.total)}</td><td class="r">${x.pct === null ? '—' : `${x.pct}%`}</td><td class="r">${m(x.claim)}</td><td>${esc(x.remark)}</td></tr>`).join('')}
<tr class="t"><td>Total claimable expenses</td><td></td><td></td><td class="r">${m(w.expClaim)}</td><td></td></tr></table>
<h2>3. Capital allowances (s.16, Fourth Schedule — straight line)</h2><table><tr><th>Asset</th><th>Bought</th><th class="r">Cost</th><th>Class / years</th><th class="r">Work %</th><th class="r">Depreciation basis</th><th class="r">Claimed before</th><th class="r">Allowance ${sheet.year}</th><th class="r">Tax WDV c/f</th><th>Remarks</th></tr>
${w.assets.map(({ a, r }) => `<tr><td>${esc(a.item)}</td><td>${esc(a.date)}</td><td class="r">${m(r.cost)}</td><td>${esc(r.cls.short)}${r.years ? ` · ${r.years} yrs` : ''}</td><td class="r">${r.pct ?? '—'}${r.pct !== null ? '%' : ''}</td><td class="r">${m(r.basis)}</td><td class="r">${m(r.prior)}</td><td class="r">${m(r.allowance + r.balancing - r.charge)}</td><td class="r">${m(r.wdv)}</td><td>${esc(r.note || r.issue)}</td></tr>`).join('')}
<tr class="t"><td colspan="7">Total capital allowance${w.charges ? ' (net of balancing charges)' : ''}</td><td class="r">${m(w.capAllow - w.charges)}</td><td></td><td></td></tr></table>
<h2>4. Net income from business</h2><table><tr><td>Total gross income</td><td class="r">${m(w.gross)}</td></tr><tr><td>Less: claimable expenses</td><td class="r">(${m(w.expClaim)})</td></tr><tr><td>Less: capital allowances</td><td class="r">(${m(w.capAllow)})</td></tr>${w.charges ? `<tr><td>Add: balancing charges</td><td class="r">${m(w.charges)}</td></tr>` : ''}
<tr class="t"><td>Net income from business / profession</td><td class="r">${m(w.net)}</td></tr><tr><td>— of which foreign-currency service income (taxed at a maximum of 15%)</td><td class="r">${m(w.netFx)}</td></tr><tr><td>— of which local business income</td><td class="r">${m(w.netLocal)}</td></tr>${w.loss ? `<tr><td>Business loss to carry forward (cannot be set off against employment income)</td><td class="r">${m(w.loss)}</td></tr>` : ''}</table>
<p class="s">Expenses and capital allowances are deducted only from business income (they do not reduce employment income). Personal / domestic expenses are not deductible. Road vehicles (other than commercial / goods vehicles) do not qualify for capital allowances. Prepared by TaxMate Solutions.</p>
<script>window.onload=()=>setTimeout(()=>window.print(),300)</script></body></html>`;
    const win = window.open('', '_blank'); if (!win) return toast.error('Allow pop-ups to print');
    win.document.write(html); win.document.close();
  };

  if (!office || !w) return <div className="p-6 text-sm text-gray-400"><Loader2 size={15} className="mr-1 inline animate-spin" /> Loading working…</div>;
  if (missing) return <div className="m-4 rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900">The Business &amp; Freelance tool is not set up yet — run the V72 script in Supabase.</div>;

  return (
    <div className="space-y-4 border-t-2 border-emerald-200 bg-emerald-50/20 p-4">
      <div className="flex flex-wrap items-center gap-2">
        <div className="min-w-[220px] flex-1">
          <div className="font-bold text-emerald-900">Business &amp; Freelance working — Y/A {sheet.year} <span className="text-xs font-normal text-gray-500">· TaxMate only</span></div>
          <div className="text-[11px] text-gray-500">Client enters full bills &amp; equipment. Set the work-use % and asset classes here — the client does not see this working.</div>
        </div>
        <span className="text-xs text-gray-500">{busy ? 'Saving…' : dirty || assetsDirty ? 'Unsaved changes' : 'Saved'}</span>
        <button type="button" onClick={print} className="btn-secondary text-xs py-1.5"><Printer size={13} /> Print working</button>
        <button type="button" onClick={save} disabled={busy || (!dirty && !assetsDirty)} className="btn-primary text-xs py-1.5">{busy ? <Loader2 size={13} className="animate-spin" /> : <Save size={13} />} Save</button>
        <button type="button" onClick={() => onOpenReturn?.(w)} disabled={dirty || assetsDirty} title={dirty || assetsDirty ? 'Save first' : ''} className="btn-primary bg-emerald-600 text-xs py-1.5 hover:bg-emerald-700"><FileSpreadsheet size={13} /> Open in IIT Return</button>
      </div>

      {w.issues.length > 0 && (
        <div className="rounded-lg border border-amber-200 bg-amber-50 p-2.5 text-xs text-amber-900"><AlertTriangle size={13} className="mr-1 inline" /><b>To check:</b>
          <ul className="ml-5 list-disc">{w.issues.map((x) => <li key={x}>{x}</li>)}</ul></div>
      )}

      {/* 1. Income */}
      <div className="card p-3">
        <div className="mb-2 text-sm font-semibold text-gray-800">1. Gross business income</div>
        <div className="grid gap-2 text-sm sm:grid-cols-3">
          <div className="rounded-lg bg-blue-50 p-2"><div className="text-[11px] text-blue-800">Foreign-currency services (through a bank)</div><div className="font-bold tabular-nums text-blue-900">{rs(w.grossFx)}</div></div>
          <div className="rounded-lg bg-orange-50 p-2"><div className="text-[11px] text-orange-800">Business income in Sri Lanka</div><div className="font-bold tabular-nums text-orange-900">{rs(w.grossLocal)}</div></div>
          <div className="rounded-lg bg-gray-50 p-2"><div className="text-[11px] text-gray-600">Total</div><div className="font-bold tabular-nums">{rs(w.gross)}</div></div>
        </div>
        <label className="mt-2 flex items-start gap-2 text-xs text-gray-700"><input type="checkbox" className="mt-0.5" checked={!!office.fxOtherIsBiz} onChange={(e) => setO((o) => ({ ...o, fxOtherIsBiz: e.target.checked }))} />
          <span>Treat <b>“Other foreign income”</b> (Rs. {r0((sheet.data?.rows?.fxOther || []).reduce((t, v) => t + (Number(v) || 0), 0))}) as freelance / business income — tick when it is payment for services, so expenses can be deducted from it.</span></label>
      </div>

      {/* 2. Expenses */}
      <div className="card overflow-x-auto">
        <div className="flex items-center gap-2 px-3 pt-3 text-sm font-semibold text-gray-800">2. Expenses — work-use share <span className="text-[11px] font-normal text-gray-500">(s.11: only the part incurred to earn the income · personal / household costs are not deductible)</span></div>
        <table className="mt-2 w-full text-xs">
          <thead className="bg-gray-50"><tr><th className="px-3 py-1.5 text-left">Expense</th><th className="px-2 py-1.5 text-right">Annual total</th><th className="px-2 py-1.5 text-right">Work-use %</th><th className="px-2 py-1.5 text-right">Claimable</th><th className="px-2 py-1.5 text-left">Basis / remark</th></tr></thead>
          <tbody>
            {w.expenses.map((x) => (
              <tr key={x.key} className={`border-t border-gray-100 ${x.total ? '' : 'text-gray-400'}`}>
                <td className="px-3 py-1">{x.en}</td>
                <td className="px-2 py-1 text-right tabular-nums">{x.total ? r0(x.total) : '—'}</td>
                <td className="px-2 py-1 text-right"><input className={`${pctIn} ${x.total && x.pct === null ? 'border-amber-400 bg-amber-50' : ''}`} inputMode="decimal" placeholder={DEFAULT_PCT[x.key] === null ? 'set' : '100'} value={office.pct?.[x.key] ?? ''} onChange={(e) => setPct(x.key, e.target.value.replace(/[^\d.]/g, ''))} />%</td>
                <td className="px-2 py-1 text-right font-semibold tabular-nums">{x.claim ? r0(x.claim) : '—'}</td>
                <td className="px-2 py-1"><input className="w-full min-w-[160px] rounded border border-transparent px-1.5 py-1 text-xs hover:border-gray-200 focus:border-primary-400 focus:outline-none" placeholder={x.total ? 'e.g. 2 of 6 rooms used as office' : ''} value={office.remarks?.[x.key] || ''} onChange={(e) => setRemark(x.key, e.target.value)} /></td>
              </tr>
            ))}
            <tr className="border-t-2 border-gray-200 font-bold"><td className="px-3 py-1.5">Total claimable expenses</td><td /><td /><td className="px-2 py-1.5 text-right tabular-nums">{r0(w.expClaim)}</td><td /></tr>
          </tbody>
        </table>
      </div>

      {/* 3. Equipment */}
      <div className="card overflow-x-auto">
        <div className="flex flex-wrap items-center gap-2 px-3 pt-3">
          <div className="flex-1 text-sm font-semibold text-gray-800">3. Equipment — capital allowance <span className="text-[11px] font-normal text-gray-500">(s.16 &amp; Fourth Schedule · straight line · full allowance in the year bought if used at 31 March · none in the year sold)</span></div>
          <button type="button" onClick={addAsset} className="btn-secondary py-1 text-xs"><Plus size={13} /> Add asset</button>
        </div>
        <table className="mt-2 w-full min-w-[1100px] text-xs">
          <thead className="bg-gray-50"><tr>
            <th className="px-2 py-1.5 text-left">Item</th><th className="px-2 py-1.5 text-left">Bought</th><th className="px-2 py-1.5 text-right">Cost (Rs.)</th><th className="px-2 py-1.5 text-left">Class</th>
            <th className="px-2 py-1.5 text-right">Work %</th><th className="px-2 py-1.5 text-right">Claimed before</th><th className="px-2 py-1.5 text-right">Allowance {sheet.year}</th><th className="px-2 py-1.5 text-right">WDV c/f</th><th className="px-2 py-1.5 text-left">Sold / remarks</th><th />
          </tr></thead>
          <tbody>
            {w.assets.length === 0 && <tr><td colSpan={10} className="px-3 py-4 text-center text-gray-400">No equipment listed. The client adds it in the portal, or use “Add asset”.</td></tr>}
            {w.assets.map(({ a, o, r }) => (
              <tr key={a.id} className="border-t border-gray-100 align-top">
                <td className="px-2 py-1"><input className="w-40 rounded border border-gray-200 px-1.5 py-1" value={a.item} placeholder="e.g. Laptop" onChange={(e) => editAsset(a.id, { item: e.target.value })} />
                  {a.note && <div className="mt-0.5 max-w-[160px] text-[10px] text-gray-500">{a.note}</div>}</td>
                <td className="px-2 py-1"><input type="date" className="rounded border border-gray-200 px-1 py-1" value={a.date} onChange={(e) => editAsset(a.id, { date: e.target.value })} />
                  <div className="text-[10px] text-gray-500">{r.acqYA && `Y/A ${r.acqYA}`}</div></td>
                <td className="px-2 py-1 text-right"><input className="w-24 rounded border border-gray-200 px-1.5 py-1 text-right tabular-nums" inputMode="decimal" value={a.cost} onChange={(e) => editAsset(a.id, { cost: e.target.value.replace(/[^\d.]/g, '') })} /></td>
                <td className="px-2 py-1">
                  <select className="w-48 rounded border border-gray-200 px-1 py-1" value={o.cls || guessClass(a.item)} onChange={(e) => setA(a.id, { cls: e.target.value })}>
                    {CA_CLASSES.map((c) => <option key={c.key} value={c.key}>{c.label}</option>)}
                  </select>
                  {(o.cls || guessClass(a.item)) === 'c5' && <div className="mt-1 flex items-center gap-1 text-[11px]">Useful life <input className={pctIn} inputMode="numeric" value={o.years ?? ''} onChange={(e) => setA(a.id, { years: e.target.value.replace(/\D/g, '') })} /> yrs</div>}
                  {!o.cls && <div className="text-[10px] text-amber-700">Suggested — confirm</div>}
                </td>
                <td className="px-2 py-1 text-right"><input className={`${pctIn} ${r.pct === null ? 'border-amber-400 bg-amber-50' : ''}`} inputMode="decimal" placeholder={a.work === 'partly' ? 'set' : '100'} value={o.pct ?? ''} onChange={(e) => setA(a.id, { pct: e.target.value.replace(/[^\d.]/g, '') })} />%
                  {a.work === 'partly' && <div className="text-[10px] text-gray-500">client: partly for work</div>}</td>
                <td className="px-2 py-1 text-right"><input className="w-24 rounded border border-gray-200 px-1.5 py-1 text-right tabular-nums" inputMode="decimal" placeholder={r0(r.priorAuto)} value={o.prior ?? ''} onChange={(e) => setA(a.id, { prior: e.target.value.replace(/[^\d.]/g, '') })} />
                  <div className="text-[10px] text-gray-400">{o.prior === undefined || o.prior === null || o.prior === '' ? 'auto' : 'entered'}</div></td>
                <td className="px-2 py-1 text-right font-semibold tabular-nums">{r.charge ? <span className="text-red-600">−{r0(r.charge)}</span> : r0(r.allowance + r.balancing)}</td>
                <td className="px-2 py-1 text-right tabular-nums">{r0(r.wdv)}</td>
                <td className="px-2 py-1">
                  <label className="flex items-center gap-1"><input type="checkbox" checked={a.disposed} onChange={(e) => editAsset(a.id, { disposed: e.target.checked })} /> Sold / disposed</label>
                  {a.disposed && <div className="mt-1 flex gap-1"><input type="date" className="rounded border border-gray-200 px-1 py-0.5" value={a.disposedOn} onChange={(e) => editAsset(a.id, { disposedOn: e.target.value })} /><input className="w-20 rounded border border-gray-200 px-1 py-0.5 text-right" placeholder="Sold for" inputMode="decimal" value={a.proceeds} onChange={(e) => editAsset(a.id, { proceeds: e.target.value.replace(/[^\d.]/g, '') })} /></div>}
                  <div className={`mt-0.5 text-[10px] ${r.issue ? 'font-semibold text-amber-700' : 'text-gray-500'}`}>{r.issue || r.note}</div>
                </td>
                <td className="px-1 py-1"><button type="button" onClick={() => delAsset(a.id)} className="rounded p-1 text-gray-300 hover:bg-red-50 hover:text-red-600" aria-label="Remove asset"><Trash2 size={13} /></button></td>
              </tr>
            ))}
            <tr className="border-t-2 border-gray-200 font-bold"><td colSpan={6} className="px-2 py-1.5">Total capital allowance{w.charges ? ' (balancing charges shown as −)' : ''}</td><td className="px-2 py-1.5 text-right tabular-nums">{r0(w.capAllow - w.charges)}</td><td colSpan={3} /></tr>
          </tbody>
        </table>
        <p className="flex gap-1 px-3 pb-3 pt-2 text-[11px] text-gray-500"><Info size={12} className="mt-0.5 flex-shrink-0" /> “Claimed before” is worked out automatically (one full allowance for each earlier year of assessment since it was bought). Change it if allowances were not claimed in earlier returns. Cars, vans and motor cycles get no capital allowance; commercial / goods vehicles are Class 2.</p>
      </div>

      {/* 4. Summary */}
      <div className="card p-3">
        <div className="mb-2 flex flex-wrap items-center gap-2"><div className="flex-1 text-sm font-semibold text-gray-800">4. Net income from business</div>
          <label className="text-xs text-gray-600">Share deductions between foreign &amp; local income:
            <select className="ml-1 rounded border border-gray-200 px-1 py-0.5 text-xs" value={office.alloc || 'prop'} onChange={(e) => setO((o) => ({ ...o, alloc: e.target.value }))}>
              <option value="prop">In proportion to gross income</option><option value="fx">All against foreign income</option><option value="local">All against local income</option>
            </select></label></div>
        <div className="grid gap-x-6 text-sm sm:grid-cols-2">
          <div className="space-y-1">
            <div className="flex justify-between"><span>Gross business income</span><b className="tabular-nums">{rs(w.gross)}</b></div>
            <div className="flex justify-between text-gray-600"><span>Less: claimable expenses</span><span className="tabular-nums">({rs(w.expClaim)})</span></div>
            <div className="flex justify-between text-gray-600"><span>Less: capital allowances</span><span className="tabular-nums">({rs(w.capAllow)})</span></div>
            {w.charges > 0 && <div className="flex justify-between text-gray-600"><span>Add: balancing charges</span><span className="tabular-nums">{rs(w.charges)}</span></div>}
            <div className={`flex justify-between border-t pt-1 font-bold ${w.net < 0 ? 'text-red-700' : 'text-emerald-800'}`}><span>Net income from business</span><span className="tabular-nums">{rs(w.net)}</span></div>
          </div>
          <div className="mt-2 space-y-1 rounded-lg bg-gray-50 p-2 text-xs sm:mt-0">
            <div className="flex justify-between"><span>→ Foreign-currency business (Cage 20, max 15%)</span><b className="tabular-nums">{rs(w.netFx)}</b></div>
            <div className="flex justify-between"><span>→ Local business income</span><b className="tabular-nums">{rs(w.netLocal)}</b></div>
            {w.loss > 0 && <div className="flex justify-between text-red-700"><span>Business loss — carry forward (not against employment income)</span><b className="tabular-nums">{rs(w.loss)}</b></div>}
          </div>
        </div>
      </div>
    </div>
  );
}
