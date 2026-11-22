// V74 — client page (admin): the client's tax package per Y/A — confirm, change, or set
import { useEffect, useState } from 'react';
import toast from 'react-hot-toast';
import { Package, Check, Loader2, AlertTriangle } from 'lucide-react';
import { supabase, fmtDate } from '../lib/supabase';
import { filingYear } from '../lib/assets';
import { loadPackages, adminSetPackage, adminConfirmPackage, priceText, fullName, packageFit, bestCalcFor } from '../lib/packages';

const nextYear = (y) => { const s = parseInt(y, 10) + 1; return `${s}/${String(s + 1).slice(2)}`; };
const BY = { client: 'chosen by the client', admin: 'set by TaxMate', auto: 'moved automatically' };

export default function ClientPackageAdmin({ client }) {
  const [rows, setRows] = useState(null);
  const [pkgs, setPkgs] = useState([]);
  const [calcs, setCalcs] = useState([]);
  const [year, setYear] = useState(filingYear());
  const [key, setKey] = useState('');
  const [busy, setBusy] = useState(false);
  const [off, setOff] = useState(false);

  const load = async () => {
    const [{ data, error }, p, { data: cs }] = await Promise.all([
      supabase.from('client_packages').select('*').eq('client_id', client.id).order('year', { ascending: false }),
      loadPackages(),
      supabase.from('iit_calculations').select('*').eq('client_id', client.id).order('created_at', { ascending: false }).limit(50),
    ]);
    if (error) { setOff(true); return; }
    setRows(data ?? []); setPkgs(p); setCalcs(cs ?? []);
  };
  useEffect(() => { load(); }, [client.id]); // eslint-disable-line react-hooks/exhaustive-deps
  if (off) return null;   // before the V74 script

  const years = [...new Set([nextYear(filingYear()), filingYear(), ...(rows || []).map((r) => r.year)])].sort().reverse();
  const run = async (fn, ok) => { setBusy(true); try { await fn(); toast.success(ok); await load(); } catch (e) { toast.error(e.message); } setBusy(false); };
  const cur = (rows || []).find((r) => r.year === year);
  const fit = packageFit(bestCalcFor(calcs, year), client);

  return (
    <div className="card">
      <div className="card-header"><Package size={16} /> Tax package</div>
      <div className="space-y-3 p-4">
        {rows === null ? <div className="h-10 animate-pulse rounded bg-gray-100" /> : rows.length === 0 ? <p className="text-sm text-gray-500">No package chosen yet. The client can choose one in the portal (Tax Packages), or set it here.</p> : (
          <div className="divide-y rounded-lg border">
            {rows.map((r) => (
              <div key={r.id} className="flex flex-wrap items-center gap-2 px-3 py-2 text-sm">
                <span className="w-16 font-bold text-primary-700">{r.year}</span>
                <span className="min-w-0 flex-1">
                  <b>{r.package_name}</b> <span className="text-gray-500">· {priceText({ price: r.price, from: r.price_from, key: r.package_key })}</span>
                  <span className="block text-xs text-gray-500">{BY[r.selected_by]} {fmtDate(r.updated_at)}{r.previous_name ? ` · was ${r.previous_name}` : ''}{r.change_reason ? ` — ${r.change_reason}` : ''}{r.client_note ? ` · note: “${r.client_note}”` : ''}</span>
                </span>
                {r.confirmed_at ? <span className="rounded-full bg-emerald-100 px-2 py-0.5 text-[11px] font-semibold text-emerald-800">Confirmed</span>
                  : <button type="button" disabled={busy} onClick={() => run(() => adminConfirmPackage(r.id), 'Confirmed — the client was told')} className="rounded-lg bg-emerald-600 px-2.5 py-1 text-xs font-semibold text-white hover:bg-emerald-700"><Check size={12} className="mr-1 inline" />Confirm</button>}
              </div>
            ))}
          </div>
        )}
        {cur?.package_key === 'nil' && fit?.liable && (
          <div className="flex gap-2 rounded-lg border border-amber-200 bg-amber-50 p-2 text-xs text-amber-900"><AlertTriangle size={14} className="mt-0.5 flex-shrink-0" />
            <span className="flex-1">Y/A {year} computation shows income tax Rs. {fit.tax.toLocaleString('en-LK')} — a Nil return is not suitable.</span>
            <button type="button" disabled={busy} onClick={() => run(() => adminSetPackage(client.id, year, fit.suggested, `Computation shows income tax of Rs. ${fit.tax.toLocaleString('en-LK')} (${fit.why}).`, true), 'Package changed — the client was told')} className="font-semibold underline">Move to {fullName(pkgs.find((p) => p.key === fit.suggested) || { name: fit.suggested })}</button></div>
        )}
        <div className="flex flex-wrap items-end gap-2">
          <label className="text-xs font-semibold text-gray-600">Y/A<select className="input mt-1 w-28" value={year} onChange={(e) => setYear(e.target.value)}>{years.map((y) => <option key={y}>{y}</option>)}</select></label>
          <label className="min-w-[220px] flex-1 text-xs font-semibold text-gray-600">Package<select className="input mt-1" value={key} onChange={(e) => setKey(e.target.value)}>
            <option value="">— Choose —</option>{pkgs.map((p) => <option key={p.key} value={p.key}>{fullName(p)} · {priceText(p)}{fit?.suggested === p.key ? ' ★ fits the computation' : ''}</option>)}
          </select></label>
          <button type="button" disabled={busy || !key} onClick={() => run(() => adminSetPackage(client.id, year, key), cur ? 'Package changed — the client was told' : 'Package set — the client was told')} className="btn-primary text-sm">{busy ? <Loader2 size={14} className="animate-spin" /> : <Check size={14} />} {cur ? 'Change' : 'Set'} for {year}</button>
        </div>
      </div>
    </div>
  );
}
