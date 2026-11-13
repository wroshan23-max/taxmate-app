// V64 — products & services master (default price, unit, VAT treatment)
import { useState } from 'react';
import toast from 'react-hot-toast';
import { Package, Plus, Search, Pencil } from 'lucide-react';
import { saveItem } from '../../lib/vat/api';
import { money } from '../../lib/vat/format';
import { Modal, Field, Empty, Badge } from './ui';

const blank = { sku: '', name: '', description: '', supply_kind: 'goods', unit: 'Nos', price: '', rate_code: 'VAT_STD', category: '', active: true };

export default function Items({ app }) {
  const { data, can, clientId, reload } = app;
  const [q, setQ] = useState('');
  const [edit, setEdit] = useState(null);
  const [busy, setBusy] = useState(false);
  const codes = [...new Set(data.rates.map((r) => r.code))];
  const rateLabel = (code) => { const r = data.rates.filter((x) => x.code === code && !x.effective_to).slice(-1)[0] || data.rates.find((x) => x.code === code); return r ? (r.treatment === 'standard' ? `${Number(r.rate)}% VAT` : r.treatment === 'zero' ? 'Zero-rated' : 'Exempt') : code; };
  const list = data.items.filter((i) => !q || [i.sku, i.name, i.description, i.category].filter(Boolean).join(' ').toLowerCase().includes(q.toLowerCase()));
  const save = async () => {
    setBusy(true);
    try { await saveItem(clientId, edit); toast.success('Saved'); await reload(['items']); setEdit(null); } catch (e) { toast.error(e.message); } finally { setBusy(false); }
  };
  const s = (k) => (e) => setEdit({ ...edit, [k]: e.target.type === 'checkbox' ? e.target.checked : e.target.value });
  return (
    <div className="space-y-3">
      <div className="card flex flex-wrap items-center gap-2 p-3">
        <div className="relative min-w-[200px] flex-1"><Search size={14} className="absolute left-2.5 top-2.5 text-gray-400" /><input className="input pl-8" placeholder="SKU, name, category…" value={q} onChange={(e) => setQ(e.target.value)} /></div>
        {can('customers') && <button type="button" className="btn-primary px-3 py-1.5 text-sm" onClick={() => setEdit(blank)}><Plus size={14} /> Product / service</button>}
      </div>
      {list.length === 0 ? <Empty icon={Package} title="No products or services yet">Save what you sell with its price, unit and VAT treatment — then pick it on an invoice line.</Empty> : (
        <div className="card overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-gray-50"><tr><th className="table-th">Item</th><th className="table-th hidden sm:table-cell">Unit</th><th className="table-th text-right">Price</th><th className="table-th">VAT</th><th className="table-th" /></tr></thead>
            <tbody className="divide-y divide-gray-50">
              {list.map((i) => (
                <tr key={i.id} className={i.active ? '' : 'opacity-50'}>
                  <td className="table-td"><div className="font-semibold">{i.name}</div><div className="text-[11px] text-gray-500">{i.sku && <span className="font-mono">{i.sku} · </span>}{i.supply_kind}{i.category && ` · ${i.category}`}</div></td>
                  <td className="table-td hidden sm:table-cell">{i.unit}</td><td className="table-td text-right tabular-nums">{money(i.price)}</td>
                  <td className="table-td"><Badge>{rateLabel(i.rate_code)}</Badge></td>
                  <td className="table-td text-right">{can('customers') && <button type="button" className="p-1 text-gray-400 hover:text-primary-700" onClick={() => setEdit({ ...blank, ...Object.fromEntries(Object.entries(i).map(([k, v]) => [k, v ?? ''])) })} aria-label="Edit"><Pencil size={14} /></button>}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {edit && (
        <Modal title={edit.id ? 'Edit product / service' : 'New product / service'} onClose={() => setEdit(null)} footer={<><button type="button" className="btn-secondary border text-sm" onClick={() => setEdit(null)}>Cancel</button><button type="button" disabled={busy || !edit.name.trim()} className="btn-primary text-sm" onClick={save}>Save</button></>}>
          <div className="grid gap-2 sm:grid-cols-2">
            <Field label="Name"><input className="input" value={edit.name} onChange={s('name')} autoFocus /></Field>
            <Field label="SKU / code"><input className="input" value={edit.sku} onChange={s('sku')} /></Field>
            <Field label="Description (printed)" className="sm:col-span-2"><input className="input" value={edit.description} onChange={s('description')} /></Field>
            <Field label="Goods or services"><select className="input" value={edit.supply_kind} onChange={s('supply_kind')}><option value="goods">Goods</option><option value="services">Services</option></select></Field>
            <Field label="Unit"><input className="input" maxLength={20} value={edit.unit} onChange={s('unit')} /></Field>
            <Field label="Default price (Rs.)"><input className="input text-right" inputMode="decimal" value={edit.price} onChange={(e) => setEdit({ ...edit, price: e.target.value.replace(/[^\d.]/g, '') })} /></Field>
            <Field label="VAT treatment"><select className="input" value={edit.rate_code} onChange={s('rate_code')}>{codes.map((c) => <option key={c} value={c}>{rateLabel(c)}</option>)}</select></Field>
            <Field label="Category"><input className="input" value={edit.category} onChange={s('category')} /></Field>
            <label className="mt-5 flex items-center gap-2 text-sm"><input type="checkbox" checked={!!edit.active} onChange={s('active')} /> Active</label>
          </div>
        </Modal>
      )}
    </div>
  );
}
