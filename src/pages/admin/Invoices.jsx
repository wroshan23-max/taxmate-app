import { useEffect, useState } from 'react';
import { supabase, fmtRs, fmtDate } from '../../lib/supabase';
import { useAuth } from '../../contexts/AuthContext';
import toast from 'react-hot-toast';
import { Plus, Receipt, X, Trash2, Search } from 'lucide-react';

const statusBadge = (s) => {
  const map = { unpaid: 'badge-red', paid: 'badge-green', overdue: 'badge-yellow' };
  return <span className={map[s] ?? 'badge-gray'}>{s}</span>;
};

const TODAY = new Date().toISOString().split('T')[0];

export default function Invoices() {
  const { user } = useAuth();
  const [invoices, setInvoices] = useState([]);
  const [clients, setClients] = useState([]);
  const [filter, setFilter] = useState('all');
  const [search, setSearch] = useState('');
  const [modal, setModal] = useState(false);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [form, setForm] = useState({ client_id: '', invoice_no: '', issue_date: TODAY, due_date: '', notes: '', status: 'unpaid' });
  const [items, setItems] = useState([{ description: '', quantity: '1', unit_price: '' }]);

  useEffect(() => { loadAll(); }, []);

  const loadAll = async () => {
    const [{ data: invs }, { data: cls }] = await Promise.all([
      supabase.from('invoices').select('*, clients(full_name)').order('created_at', { ascending: false }),
      supabase.from('clients').select('id, full_name').order('full_name'),
    ]);
    setInvoices(invs ?? []); setClients(cls ?? []); setLoading(false);
  };

  const filtered = invoices.filter(inv => {
    const matchStatus = filter === 'all' || inv.status === filter;
    const matchSearch = !search || inv.clients?.full_name?.toLowerCase().includes(search.toLowerCase()) || inv.invoice_no?.includes(search);
    return matchStatus && matchSearch;
  });

  const total = items.reduce((s, it) => s + (parseFloat(it.quantity || 1) * parseFloat(it.unit_price || 0)), 0);

  const addItem = () => setItems([...items, { description: '', quantity: '1', unit_price: '' }]);
  const removeItem = (i) => setItems(items.filter((_, idx) => idx !== i));
  const updateItem = (i, field, val) => setItems(items.map((it, idx) => idx === i ? {...it, [field]: val} : it));

  const save = async (e) => {
    e.preventDefault();
    if (!form.client_id) return toast.error('Select a client');
    if (items.some(it => !it.description || !it.unit_price)) return toast.error('Fill all item details');
    setSaving(true);
    const { data: inv, error } = await supabase.from('invoices').insert({
      ...form, total_amount: total, created_by: user.id
    }).select().single();
    if (error) { setSaving(false); toast.error(error.message); return; }

    const { error: itemErr } = await supabase.from('invoice_items').insert(
      items.map(it => ({
        invoice_id: inv.id,
        description: it.description,
        quantity: parseFloat(it.quantity),
        unit_price: parseFloat(it.unit_price),
        amount: parseFloat(it.quantity) * parseFloat(it.unit_price),
      }))
    );
    setSaving(false);
    if (itemErr) { toast.error(itemErr.message); return; }
    toast.success('Invoice created!');
    setModal(false);
    setForm({ client_id: '', invoice_no: '', issue_date: TODAY, due_date: '', notes: '', status: 'unpaid' });
    setItems([{ description: '', quantity: '1', unit_price: '' }]);
    loadAll();
  };

  const updateStatus = async (id, status) => {
    await supabase.from('invoices').update({ status }).eq('id', id);
    toast.success('Status updated!');
    loadAll();
  };

  const totalUnpaid = invoices.filter(i => i.status === 'unpaid').reduce((s, i) => s + (i.total_amount || 0), 0);

  return (
    <div className="space-y-5">
      <div className="flex items-center gap-3 flex-wrap">
        <div>
          <h1 className="text-2xl font-bold text-primary-800">Invoices</h1>
          <p className="text-sm text-gray-500">Unpaid: <strong className="text-red-600">{fmtRs(totalUnpaid)}</strong></p>
        </div>
        <div className="ml-auto flex items-center gap-3 flex-wrap">
          <div className="relative">
            <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
            <input className="input pl-9 w-48" placeholder="Search..." value={search} onChange={e => setSearch(e.target.value)} />
          </div>
          <button onClick={() => setModal(true)} className="btn-primary"><Plus size={16} /> New Invoice</button>
        </div>
      </div>

      <div className="flex gap-2">
        {['all', 'unpaid', 'paid', 'overdue'].map(s => (
          <button key={s} onClick={() => setFilter(s)}
            className={`px-3 py-1 rounded-full text-xs font-semibold capitalize transition-all ${filter === s ? 'bg-primary-700 text-white' : 'bg-gray-100 text-gray-600 hover:bg-gray-200'}`}>
            {s}
          </button>
        ))}
      </div>

      <div className="card overflow-hidden">
        {loading ? <div className="p-8 text-center text-gray-400">Loading...</div> : filtered.length === 0 ? (
          <div className="p-12 text-center">
            <Receipt size={40} className="mx-auto text-gray-200 mb-3" />
            <div className="text-gray-400">No invoices found</div>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead className="bg-gray-50 border-b border-gray-100">
                <tr>
                  <th className="table-th">Invoice #</th>
                  <th className="table-th">Client</th>
                  <th className="table-th hidden sm:table-cell">Issue Date</th>
                  <th className="table-th hidden md:table-cell">Due Date</th>
                  <th className="table-th">Amount</th>
                  <th className="table-th">Status</th>
                  <th className="table-th">Action</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-50">
                {filtered.map(inv => (
                  <tr key={inv.id} className="hover:bg-gray-50">
                    <td className="table-td font-mono text-xs">{inv.invoice_no}</td>
                    <td className="table-td text-sm font-semibold">{inv.clients?.full_name ?? '—'}</td>
                    <td className="table-td hidden sm:table-cell text-xs text-gray-500">{fmtDate(inv.issue_date)}</td>
                    <td className="table-td hidden md:table-cell text-xs text-gray-500">{fmtDate(inv.due_date)}</td>
                    <td className="table-td font-bold text-primary-700">{fmtRs(inv.total_amount)}</td>
                    <td className="table-td">{statusBadge(inv.status)}</td>
                    <td className="table-td">
                      <select value={inv.status} onChange={e => updateStatus(inv.id, e.target.value)}
                        className="text-xs border border-gray-200 rounded-lg px-2 py-1 focus:outline-none focus:ring-1 focus:ring-primary-500">
                        <option value="unpaid">Unpaid</option>
                        <option value="paid">Paid</option>
                        <option value="overdue">Overdue</option>
                      </select>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {modal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50">
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-xl max-h-[90vh] overflow-y-auto">
            <div className="flex items-center justify-between p-5 border-b">
              <h3 className="font-bold text-primary-800">New Invoice</h3>
              <button onClick={() => setModal(false)} className="text-gray-400 hover:text-gray-600"><X size={20} /></button>
            </div>
            <form onSubmit={save} className="p-5 space-y-4">
              <div className="grid grid-cols-2 gap-3">
                <div className="col-span-2">
                  <label className="block text-xs font-semibold text-gray-500 mb-1">Client *</label>
                  <select className="input" value={form.client_id} onChange={e => setForm({...form, client_id: e.target.value})} required>
                    <option value="">— Select —</option>
                    {clients.map(c => <option key={c.id} value={c.id}>{c.full_name}</option>)}
                  </select>
                </div>
                <div>
                  <label className="block text-xs font-semibold text-gray-500 mb-1">Invoice No.</label>
                  <input className="input" placeholder="INV-001" value={form.invoice_no} onChange={e => setForm({...form, invoice_no: e.target.value})} />
                </div>
                <div>
                  <label className="block text-xs font-semibold text-gray-500 mb-1">Status</label>
                  <select className="input" value={form.status} onChange={e => setForm({...form, status: e.target.value})}>
                    <option value="unpaid">Unpaid</option><option value="paid">Paid</option><option value="overdue">Overdue</option>
                  </select>
                </div>
                <div>
                  <label className="block text-xs font-semibold text-gray-500 mb-1">Issue Date</label>
                  <input type="date" className="input" value={form.issue_date} onChange={e => setForm({...form, issue_date: e.target.value})} />
                </div>
                <div>
                  <label className="block text-xs font-semibold text-gray-500 mb-1">Due Date</label>
                  <input type="date" className="input" value={form.due_date} onChange={e => setForm({...form, due_date: e.target.value})} />
                </div>
              </div>

              {/* Items */}
              <div>
                <div className="text-xs font-semibold text-gray-500 mb-2">Invoice Items</div>
                {items.map((it, i) => (
                  <div key={i} className="flex gap-2 mb-2 items-center">
                    <input className="input flex-1" placeholder="Description" value={it.description} onChange={e => updateItem(i, 'description', e.target.value)} required />
                    <input className="input w-16" type="number" placeholder="Qty" value={it.quantity} onChange={e => updateItem(i, 'quantity', e.target.value)} min="1" />
                    <div className="relative w-28">
                      <span className="absolute left-2 top-1/2 -translate-y-1/2 text-xs text-gray-400">Rs.</span>
                      <input className="input pl-7" type="number" placeholder="0" value={it.unit_price} onChange={e => updateItem(i, 'unit_price', e.target.value)} required />
                    </div>
                    {items.length > 1 && <button type="button" onClick={() => removeItem(i)} className="text-red-400 hover:text-red-600"><Trash2 size={15} /></button>}
                  </div>
                ))}
                <button type="button" onClick={addItem} className="text-xs text-primary-600 hover:underline">+ Add item</button>
                <div className="text-right font-bold text-primary-700 mt-2">Total: {fmtRs(total)}</div>
              </div>

              <div>
                <label className="block text-xs font-semibold text-gray-500 mb-1">Notes</label>
                <textarea className="input resize-none" rows={2} value={form.notes} onChange={e => setForm({...form, notes: e.target.value})} />
              </div>
              <div className="flex gap-3">
                <button type="button" onClick={() => setModal(false)} className="btn-secondary flex-1 justify-center">Cancel</button>
                <button type="submit" disabled={saving} className="btn-primary flex-1 justify-center">{saving ? 'Creating...' : 'Create Invoice'}</button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
