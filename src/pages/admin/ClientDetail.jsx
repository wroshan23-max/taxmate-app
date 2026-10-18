import { useEffect, useState } from 'react';
import { useParams, Link, useNavigate } from 'react-router-dom';
import { supabase, fmtRs, fmtDate } from '../../lib/supabase';
import { useAuth } from '../../contexts/AuthContext';
import toast from 'react-hot-toast';
import { ArrowLeft, Edit2, Save, X, Calculator, FileText, Receipt, Printer } from 'lucide-react';
import SavedCalculations from '../../components/SavedCalculations';
import { summarizeCalc, KIND_LABEL } from '../../lib/iitCalc';
import { openStatement } from '../../lib/iitStatement';
import { loadInvoiceForPrint, openInvoice, STATUS_LABEL } from '../../lib/invoice';

export default function ClientDetail() {
  const { id } = useParams();
  const { user } = useAuth();
  const navigate = useNavigate();
  const [client, setClient] = useState(null);
  const [calculations, setCalculations] = useState([]);
  const [returns, setReturns] = useState([]);
  const [invoices, setInvoices] = useState([]);
  const [loading, setLoading] = useState(true);
  const [editing, setEditing] = useState(false);
  const [form, setForm] = useState({});
  const [saving, setSaving] = useState(false);
  const [tab, setTab] = useState('overview');

  useEffect(() => { loadAll(); }, [id]);

  const loadAll = async () => {
    const [{ data: c }, { data: calcs }, { data: rets }, { data: invs }] = await Promise.all([
      supabase.from('clients').select('*').eq('id', id).single(),
      supabase.from('iit_calculations').select('*').eq('client_id', id).order('created_at', { ascending: false }),
      supabase.from('tax_returns').select('*').eq('client_id', id).order('created_at', { ascending: false }),
      supabase.from('invoices').select('*').eq('client_id', id).order('created_at', { ascending: false }),
    ]);
    setClient(c); setForm(c ?? {}); setCalculations(calcs ?? []); setReturns(rets ?? []); setInvoices(invs ?? []);
    setLoading(false);
  };

  const saveClient = async () => {
    setSaving(true);
    const { error } = await supabase.from('clients').update({
      full_name: form.full_name, tin: form.tin, nic: form.nic,
      email: form.email, mobile: form.mobile, address: form.address,
      employer: form.employer, resident_status: form.resident_status,
    }).eq('id', id);
    setSaving(false);
    if (error) { toast.error(error.message); return; }
    toast.success('Client updated!');
    setClient(form); setEditing(false);
  };

  const printInvoice = async (invoiceId) => {
    const w = window.open('', '_blank', 'width=900,height=900');   // open now so the pop-up isn't blocked
    try {
      const { inv, items, bank } = await loadInvoiceForPrint(supabase, invoiceId);
      if (!openInvoice(inv, items, bank, {}, w)) toast.error('Pop-up blocked — allow pop-ups for this site');
    } catch (e) { if (w) w.close(); toast.error(e.message); }
  };

  const statusBadge = (s) => {
    const map = { pending: 'badge-yellow', in_progress: 'badge-blue', submitted: 'badge-gray', completed: 'badge-green', unpaid: 'badge-red', paid: 'badge-green', overdue: 'badge-red' };
    return <span className={map[s] ?? 'badge-gray'}>{s?.replace('_', ' ') ?? '—'}</span>;
  };

  if (loading) return <div className="flex items-center justify-center h-64 text-gray-400">Loading...</div>;
  if (!client) return <div className="text-center py-20 text-gray-400">Client not found</div>;

  return (
    <div className="space-y-5">
      {/* Header */}
      <div className="flex items-center gap-4 flex-wrap">
        <Link to="/admin/clients" className="text-gray-400 hover:text-gray-600">
          <ArrowLeft size={20} />
        </Link>
        <div className="w-12 h-12 rounded-full bg-primary-100 flex items-center justify-center text-primary-700 font-bold text-xl">
          {client.full_name?.[0]}
        </div>
        <div>
          <h1 className="text-2xl font-bold text-primary-800">{client.full_name}</h1>
          <div className="text-sm text-gray-500">TIN: {client.tin ?? '—'} · {client.email ?? '—'}</div>
        </div>
        <div className="ml-auto">
          {!editing ? (
            <button onClick={() => setEditing(true)} className="btn-secondary">
              <Edit2 size={15} /> Edit
            </button>
          ) : (
            <div className="flex gap-2">
              <button onClick={() => setEditing(false)} className="btn-secondary"><X size={15} /> Cancel</button>
              <button onClick={saveClient} disabled={saving} className="btn-primary">
                <Save size={15} /> {saving ? 'Saving...' : 'Save'}
              </button>
            </div>
          )}
        </div>
      </div>

      {/* Tabs */}
      <div className="flex gap-1 bg-gray-100 p-1 rounded-xl w-fit overflow-x-auto">
        {['overview', 'calculations', 'returns', 'invoices'].map(t => (
          <button
            key={t}
            onClick={() => setTab(t)}
            className={`px-4 py-1.5 rounded-lg text-sm font-medium capitalize transition-all whitespace-nowrap ${
              tab === t ? 'bg-white text-primary-700 shadow-sm' : 'text-gray-500 hover:text-gray-700'
            }`}
          >
            {t}
          </button>
        ))}
      </div>

      {/* Overview Tab */}
      {tab === 'overview' && (
        <div className="card p-5">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            {[
              { label: 'Full Name', key: 'full_name' },
              { label: 'TIN', key: 'tin' },
              { label: 'NIC', key: 'nic' },
              { label: 'Email', key: 'email' },
              { label: 'Mobile', key: 'mobile' },
              { label: 'Employer', key: 'employer' },
            ].map(({ label, key }) => (
              <div key={key}>
                <div className="text-xs font-semibold text-gray-400 uppercase tracking-wider mb-1">{label}</div>
                {editing ? (
                  <input className="input" value={form[key] ?? ''} onChange={e => setForm({...form, [key]: e.target.value})} />
                ) : (
                  <div className="text-sm text-gray-800 font-medium">{client[key] ?? <span className="text-gray-300">—</span>}</div>
                )}
              </div>
            ))}
            <div className="sm:col-span-2">
              <div className="text-xs font-semibold text-gray-400 uppercase tracking-wider mb-1">Address</div>
              {editing ? (
                <textarea className="input resize-none" rows={2} value={form.address ?? ''} onChange={e => setForm({...form, address: e.target.value})} />
              ) : (
                <div className="text-sm text-gray-800">{client.address ?? <span className="text-gray-300">—</span>}</div>
              )}
            </div>
            <div>
              <div className="text-xs font-semibold text-gray-400 uppercase tracking-wider mb-1">Resident Status</div>
              {editing ? (
                <select className="input" value={form.resident_status} onChange={e => setForm({...form, resident_status: e.target.value})}>
                  <option value="resident">Resident Individual</option>
                  <option value="nrcitizen">Non-Resident Citizen</option>
                  <option value="nonresident">Non-Resident</option>
                </select>
              ) : (
                <div className="text-sm text-gray-800 capitalize">{client.resident_status ?? '—'}</div>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Calculations Tab */}
      {tab === 'calculations' && (
        <div className="space-y-3">
          <div className="flex justify-end">
            <Link to="/admin/calculator" className="btn-primary text-sm py-1.5">
              <Calculator size={14} /> New Calculation
            </Link>
          </div>
          <SavedCalculations
            clientId={id}
            compact
            onOpen={(calc) => navigate('/admin/calculator', { state: { loadCalc: calc } })}
          />
        </div>
      )}

      {/* Returns Tab */}
      {tab === 'returns' && (
        <div className="card">
          <div className="card-header"><FileText size={16} /> Tax Returns</div>
          {returns.length === 0 ? (
            <div className="p-8 text-center text-gray-400 text-sm">No returns</div>
          ) : (
            <div className="divide-y divide-gray-50">
              {returns.map(r => {
                const calc = calculations.find(c => c.year === r.year && c.calc_type === 'annual');
                const sm = calc ? summarizeCalc(calc) : null;
                return (
                  <div key={r.id} className="flex items-center gap-3 px-5 py-3 flex-wrap">
                    <div className="flex-1 min-w-48">
                      <div className="text-sm font-semibold">Y/A {r.year}</div>
                      <div className="text-xs text-gray-400">Due: {fmtDate(r.due_date)}{r.notes ? ` · ${r.notes}` : ''}</div>
                      {sm ? (
                        <div className="text-xs text-gray-600 mt-0.5">
                          {KIND_LABEL[sm.kind]} · Assessable {fmtRs(sm.assessable)} · Gross tax {fmtRs(sm.grossTax)} ·{' '}
                          <span className={sm.status === 'refund' ? 'text-green-700 font-semibold' : 'text-red-700 font-semibold'}>
                            {sm.status === 'refund' ? 'Refund' : 'Payable'} {fmtRs(Math.abs(sm.amount))}
                          </span>
                        </div>
                      ) : (
                        <div className="text-xs text-amber-600 mt-0.5">No saved calculation for Y/A {r.year} yet</div>
                      )}
                    </div>
                    {calc && (
                      <button onClick={() => openStatement(calc, client)} className="btn-secondary text-xs py-1 px-2.5">
                        <Printer size={13} /> PDF
                      </button>
                    )}
                    {statusBadge(r.status)}
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}

      {/* Invoices Tab */}
      {tab === 'invoices' && (
        <div className="card">
          <div className="card-header"><Receipt size={16} /> Invoices
            <Link to="/admin/invoices" className="ml-auto btn-primary text-xs py-1"><Receipt size={13} /> New Invoice</Link></div>
          {invoices.length === 0 ? (
            <div className="p-8 text-center text-gray-400 text-sm">No invoices</div>
          ) : (
            <div className="divide-y divide-gray-50">
              {invoices.map(inv => (
                <div key={inv.id} className="flex items-center gap-3 px-5 py-3">
                  <div className="flex-1">
                    <div className="text-sm font-semibold">{inv.invoice_no}</div>
                    <div className="text-xs text-gray-400">{fmtDate(inv.issue_date)} · Due: {fmtDate(inv.due_date)}</div>
                  </div>
                  <div className="text-sm font-bold text-primary-700 mr-3">{fmtRs(inv.total_amount)}</div>
                  <span className="text-xs font-semibold px-2 py-0.5 rounded-md bg-gray-100 text-gray-700">{STATUS_LABEL[inv.status] ?? inv.status}</span>
                  <button onClick={() => printInvoice(inv.id)} className="btn-secondary text-xs py-1 px-2.5"><Printer size={13} /> Print</button>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
