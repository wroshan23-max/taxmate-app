import { useEffect, useState } from 'react';
import { supabase, fmtRs, fmtDate } from '../../lib/supabase';
import { useAuth } from '../../contexts/AuthContext';
import toast from 'react-hot-toast';
import { Plus, FileText, X, Search, Printer } from 'lucide-react';
import { summarizeCalc } from '../../lib/iitCalc';
import { openStatement } from '../../lib/iitStatement';

const STATUSES = ['pending', 'in_progress', 'submitted', 'completed'];

const statusBadge = (s) => {
  const map = { pending: 'badge-yellow', in_progress: 'badge-blue', submitted: 'badge-gray', completed: 'badge-green' };
  const labels = { pending: 'Pending', in_progress: 'In Progress', submitted: 'Submitted', completed: 'Completed' };
  return <span className={map[s] ?? 'badge-gray'}>{labels[s] ?? s}</span>;
};

export default function TaxReturns() {
  const { user } = useAuth();
  const [returns, setReturns] = useState([]);
  const [calcs, setCalcs] = useState({});   // latest annual calc per `${client_id}|${year}`
  const [clients, setClients] = useState([]);
  const [filter, setFilter] = useState('all');
  const [search, setSearch] = useState('');
  const [modal, setModal] = useState(false);
  const [form, setForm] = useState({ client_id: '', year: '2026/27', status: 'pending', due_date: '', gross_income: '', total_tax: '', notes: '' });
  const [saving, setSaving] = useState(false);
  const [loading, setLoading] = useState(true);

  useEffect(() => { loadAll(); }, []);

  const loadAll = async () => {
    const [{ data: rets }, { data: cls }, { data: cs }] = await Promise.all([
      supabase.from('tax_returns').select('*, clients(full_name, tin, nic, address, employer, resident_status)').order('created_at', { ascending: false }),
      supabase.from('clients').select('id, full_name, tin').is('archived_at', null).order('full_name'),
      supabase.from('iit_calculations').select('id, client_id, year, calc_type, input_data, created_at, status, label').eq('calc_type', 'annual').order('created_at', { ascending: false }),
    ]);
    const latest = {};
    // FINAL version wins; otherwise the latest draft
    for (const c of cs ?? []) { const k = `${c.client_id}|${c.year}`; if (!latest[k] || (c.status === 'final' && latest[k].status !== 'final')) latest[k] = c; }
    setReturns(rets ?? []); setClients(cls ?? []); setCalcs(latest); setLoading(false);
  };

  const filtered = returns.filter(r => {
    const matchStatus = filter === 'all' || r.status === filter;
    const matchSearch = !search || r.clients?.full_name?.toLowerCase().includes(search.toLowerCase()) || r.clients?.tin?.includes(search);
    return matchStatus && matchSearch;
  });

  const save = async (e) => {
    e.preventDefault();
    if (!form.client_id) return toast.error('Select a client');
    setSaving(true);
    const { error } = await supabase.from('tax_returns').insert({ ...form, created_by: user.id, gross_income: parseFloat(form.gross_income) || null, total_tax: parseFloat(form.total_tax) || null });
    setSaving(false);
    if (error) { toast.error(error.message); return; }
    toast.success('Tax return added!');
    setModal(false);
    loadAll();
  };

  const updateStatus = async (id, status) => {
    await supabase.from('tax_returns').update({ status, updated_at: new Date().toISOString() }).eq('id', id);
    toast.success('Status updated!');
    loadAll();
  };

  return (
    <div className="space-y-5">
      <div className="flex items-center gap-3 flex-wrap">
        <div>
          <h1 className="text-2xl font-bold text-primary-800">Tax Returns</h1>
          <p className="text-sm text-gray-500">{returns.length} total returns</p>
        </div>
        <div className="ml-auto flex items-center gap-3 flex-wrap">
          <div className="relative">
            <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
            <input className="input pl-9 w-48" placeholder="Search client..." value={search} onChange={e => setSearch(e.target.value)} />
          </div>
          <button onClick={() => setModal(true)} className="btn-primary"><Plus size={16} /> Add Return</button>
        </div>
      </div>

      {/* Status filter */}
      <div className="flex gap-2 flex-wrap">
        {['all', ...STATUSES].map(s => (
          <button key={s} onClick={() => setFilter(s)}
            className={`px-3 py-1 rounded-full text-xs font-semibold capitalize transition-all ${filter === s ? 'bg-primary-700 text-white' : 'bg-gray-100 text-gray-600 hover:bg-gray-200'}`}>
            {s === 'all' ? 'All' : s.replace('_', ' ')}
          </button>
        ))}
      </div>

      <div className="card overflow-hidden">
        {loading ? <div className="p-8 text-center text-gray-400">Loading...</div> : filtered.length === 0 ? (
          <div className="p-12 text-center">
            <FileText size={40} className="mx-auto text-gray-200 mb-3" />
            <div className="text-gray-400">No tax returns found</div>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead className="bg-gray-50 border-b border-gray-100">
                <tr>
                  <th className="table-th">Client</th>
                  <th className="table-th">Y/A</th>
                  <th className="table-th hidden sm:table-cell">Due Date</th>
                  <th className="table-th hidden md:table-cell">Gross Income</th>
                  <th className="table-th hidden md:table-cell">Tax</th>
                  <th className="table-th">Status</th>
                  <th className="table-th">Statement / Status</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-50">
                {filtered.map(r => {
                  const calc = calcs[`${r.client_id}|${r.year}`];
                  const sm = calc ? summarizeCalc(calc) : null;
                  const gross = r.gross_income ?? sm?.assessable;
                  const tax = r.total_tax ?? sm?.grossTax;
                  return (
                  <tr key={r.id} className="hover:bg-gray-50">
                    <td className="table-td">
                      <div className="font-semibold text-sm">{r.clients?.full_name ?? '—'}</div>
                      <div className="text-xs text-gray-400">{r.clients?.tin ?? '—'}</div>
                    </td>
                    <td className="table-td text-sm">{r.year}</td>
                    <td className="table-td hidden sm:table-cell text-xs text-gray-500">{fmtDate(r.due_date)}</td>
                    <td className="table-td hidden md:table-cell text-sm">{gross != null ? fmtRs(gross) : '—'}</td>
                    <td className="table-td hidden md:table-cell text-sm font-semibold text-primary-700">
                      {tax != null ? fmtRs(tax) : '—'}
                      {sm && <div className={`text-xs font-normal ${sm.status === 'refund' ? 'text-green-700' : 'text-red-600'}`}>{sm.status === 'refund' ? 'Refund' : 'Balance'} {fmtRs(Math.abs(sm.amount))}</div>}
                      {calc && <div className={`text-[10px] font-bold ${calc.status === 'final' ? 'text-green-700' : 'text-amber-600'}`}>{calc.status === 'final' ? '✅ FINAL' : '📝 DRAFT'}</div>}
                    </td>
                    <td className="table-td">{statusBadge(r.status)}</td>
                    <td className="table-td">
                      <div className="flex items-center gap-2">
                      {calc ? (
                        <button onClick={() => openStatement(calc, r.clients ?? {})} title="Print / PDF computation statement"
                          className="flex items-center gap-1 text-xs px-2 py-1 rounded-lg border border-primary-200 text-primary-700 hover:bg-primary-50">
                          <Printer size={12} /> PDF
                        </button>
                      ) : <span className="text-xs text-gray-300" title="No saved calculation for this year">no calc</span>}
                      <select
                        value={r.status}
                        onChange={e => updateStatus(r.id, e.target.value)}
                        className="text-xs border border-gray-200 rounded-lg px-2 py-1 focus:outline-none focus:ring-1 focus:ring-primary-500"
                      >
                        {STATUSES.map(s => <option key={s} value={s}>{s.replace('_', ' ')}</option>)}
                      </select>
                      </div>
                    </td>
                  </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {modal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50">
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-md">
            <div className="flex items-center justify-between p-5 border-b">
              <h3 className="font-bold text-primary-800">Add Tax Return</h3>
              <button onClick={() => setModal(false)} className="text-gray-400 hover:text-gray-600"><X size={20} /></button>
            </div>
            <form onSubmit={save} className="p-5 space-y-4">
              <div>
                <label className="block text-xs font-semibold text-gray-500 mb-1">Client *</label>
                <select className="input" value={form.client_id} onChange={e => setForm({...form, client_id: e.target.value})} required>
                  <option value="">— Select —</option>
                  {clients.map(c => <option key={c.id} value={c.id}>{c.full_name}</option>)}
                </select>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-semibold text-gray-500 mb-1">Year of Assessment</label>
                  <select className="input" value={form.year} onChange={e => setForm({...form, year: e.target.value})}>
                    <option>2025/26</option><option>2026/27</option>
                  </select>
                </div>
                <div>
                  <label className="block text-xs font-semibold text-gray-500 mb-1">Status</label>
                  <select className="input" value={form.status} onChange={e => setForm({...form, status: e.target.value})}>
                    {STATUSES.map(s => <option key={s} value={s}>{s.replace('_', ' ')}</option>)}
                  </select>
                </div>
                <div>
                  <label className="block text-xs font-semibold text-gray-500 mb-1">Due Date</label>
                  <input type="date" className="input" value={form.due_date} onChange={e => setForm({...form, due_date: e.target.value})} />
                </div>
                <div>
                  <label className="block text-xs font-semibold text-gray-500 mb-1">Gross Income</label>
                  <input type="number" className="input" placeholder="Rs." value={form.gross_income} onChange={e => setForm({...form, gross_income: e.target.value})} />
                </div>
                <div>
                  <label className="block text-xs font-semibold text-gray-500 mb-1">Total Tax</label>
                  <input type="number" className="input" placeholder="Rs." value={form.total_tax} onChange={e => setForm({...form, total_tax: e.target.value})} />
                </div>
              </div>
              <div>
                <label className="block text-xs font-semibold text-gray-500 mb-1">Notes</label>
                <textarea className="input resize-none" rows={2} value={form.notes} onChange={e => setForm({...form, notes: e.target.value})} />
              </div>
              <div className="flex gap-3">
                <button type="button" onClick={() => setModal(false)} className="btn-secondary flex-1 justify-center">Cancel</button>
                <button type="submit" disabled={saving} className="btn-primary flex-1 justify-center">{saving ? 'Saving...' : 'Add Return'}</button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
