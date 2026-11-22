// V74 — Settings → Packages: price list the client portal shows (full admins only)
import { useEffect, useState } from 'react';
import toast from 'react-hot-toast';
import { Package, Save, RotateCcw, Loader2 } from 'lucide-react';
import { supabase } from '../lib/supabase';
import { DEFAULT_PACKAGES, pkgMeta } from '../lib/packages';

const toRow = (p) => ({ key: p.key, name: p.key === 'personal_local' || p.key === 'personal_fx' ? `${pkgMeta(p.key).name} — ${pkgMeta(p.key).sub}` : p.name, price: p.price, from: p.from, active: p.active !== false });

export default function PackagesSettings() {
  const [list, setList] = useState(null);
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    supabase.from('app_settings').select('value').eq('key', 'packages').maybeSingle().then(({ data }) => {
      const saved = Array.isArray(data?.value?.list) ? data.value.list : null;
      setList(DEFAULT_PACKAGES.map((d) => { const s = saved?.find((x) => x.key === d.key); return s ? { ...toRow(d), ...s } : toRow(d); }));
    });
  }, []);
  const set = (k, p) => setList((l) => l.map((x) => (x.key === k ? { ...x, ...p } : x)));
  const save = async () => {
    setBusy(true);
    const clean = list.map((x) => ({ key: x.key, name: String(x.name || '').trim().slice(0, 120) || toRow(pkgMeta(x.key)).name, price: x.price === '' || x.price == null ? null : Math.max(0, Number(x.price) || 0), from: !!x.from, active: !!x.active }));
    const { error } = await supabase.from('app_settings').upsert({ key: 'packages', value: { list: clean }, updated_at: new Date().toISOString() });
    setBusy(false);
    if (error) return toast.error(/row-level|42501/.test(error.message) ? 'Only a full admin can change prices.' : error.message);
    toast.success('Packages saved — clients see the new prices now');
  };
  if (!list) return <div className="card p-6 text-gray-400"><Loader2 className="animate-spin" /></div>;
  return (
    <div className="card">
      <div className="card-header"><Package size={16} /> Tax &amp; Accounting service packages</div>
      <div className="space-y-3 p-5">
        <p className="text-xs text-gray-500">Clients choose one of these in the portal (menu <b>Tax Packages</b>) for each year of assessment. Switch off a package to hide it. A Nil return moves to the suitable package automatically when the client's computation shows income tax.</p>
        <div className="overflow-x-auto">
          <table className="w-full min-w-[640px] text-sm">
            <thead className="bg-gray-50 text-xs text-gray-500"><tr><th className="px-2 py-2 text-left">Package name (as clients see it)</th><th className="px-2 py-2 text-right">Price (LKR)</th><th className="px-2 py-2">“From”</th><th className="px-2 py-2">Show</th></tr></thead>
            <tbody>
              {list.map((x) => (
                <tr key={x.key} className={`border-t border-gray-100 ${x.active ? '' : 'opacity-50'}`}>
                  <td className="px-2 py-1.5"><input className="input" maxLength={120} value={x.name} onChange={(e) => set(x.key, { name: e.target.value })} /></td>
                  <td className="px-2 py-1.5"><input className="input w-32 text-right tabular-nums" inputMode="numeric" value={x.price ?? ''} placeholder="quote" onChange={(e) => set(x.key, { price: e.target.value.replace(/[^\d]/g, '') })} /></td>
                  <td className="px-2 py-1.5 text-center"><input type="checkbox" checked={!!x.from} onChange={(e) => set(x.key, { from: e.target.checked })} title="Show “From LKR …”" /></td>
                  <td className="px-2 py-1.5 text-center"><input type="checkbox" checked={!!x.active} onChange={(e) => set(x.key, { active: e.target.checked })} /></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <div className="flex gap-2">
          <button type="button" disabled={busy} onClick={save} className="btn-primary text-sm">{busy ? <Loader2 size={14} className="animate-spin" /> : <Save size={14} />} Save packages</button>
          <button type="button" onClick={() => { if (window.confirm('Reset to the default prices? (Save to apply)')) setList(DEFAULT_PACKAGES.map(toRow)); }} className="btn-secondary text-sm"><RotateCcw size={14} /> Defaults</button>
        </div>
      </div>
    </div>
  );
}
