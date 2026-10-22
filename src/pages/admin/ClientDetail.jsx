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
import SendMenu from '../../components/SendMenu';
import PortalAccess from '../../components/PortalAccess';
import AssetStatementsAdmin from '../../components/AssetStatementsAdmin';
import IncomeSheetsAdmin from '../../components/IncomeSheetsAdmin';
import { invoiceMessage } from '../../lib/share';
import ContactPersonFields, { contactPatch } from '../../components/ContactPersonFields';
import { hasContact, contactLabel, recipientsOf } from '../../lib/contacts';
import { UserRound, Sparkles, CheckCircle2 } from 'lucide-react';

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
  const [tab, setTab] = useState(() => new URLSearchParams(window.location.search).get('tab') || 'overview');

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
      ...contactPatch(form),
    }).eq('id', id);
    setSaving(false);
    if (error) { toast.error(error.message); return; }
    toast.success('Client updated!');
    setClient({ ...form, ...contactPatch(form) }); setEditing(false);
  };

  // Self-registered clients: show what they sent + possible duplicates until reviewed
  const [dupes, setDupes] = useState([]);
  useEffect(() => {
    if (!client || client.source !== 'self_registration' || client.reviewed_at) return;
    const q = (v) => `"${String(v).replace(/["\\]/g, '')}"`;   // quote for PostgREST or()
    const ors = [client.nic && `nic.eq.${q(client.nic)}`, client.mobile && `mobile.eq.${q(client.mobile)}`, client.tin && `tin.eq.${q(client.tin)}`].filter(Boolean);
    if (!ors.length) return;
    supabase.from('clients').select('id, full_name, nic, mobile, tin').or(ors.join(',')).neq('id', client.id).limit(5)
      .then(({ data }) => setDupes(data ?? []));
  }, [client?.id, client?.reviewed_at]); // eslint-disable-line react-hooks/exhaustive-deps

  const markReviewed = async () => {
    const { error } = await supabase.from('clients').update({ reviewed_at: new Date().toISOString() }).eq('id', id);
    if (error) return toast.error(error.message);
    toast.success('Marked as reviewed');
    setClient(c => ({ ...c, reviewed_at: new Date().toISOString() }));
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
          {hasContact(client) && (
            <div className="text-xs text-primary-700 mt-0.5 flex items-center gap-1"><UserRound size={12} /> Contact: {contactLabel(client)}{client.contact_mobile && ` · ${client.contact_mobile}`}{client.contact_preferred && ' ★ coordinates'}</div>
          )}
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
      <div className="flex gap-1 bg-gray-100 p-1 rounded-xl w-fit max-w-full overflow-x-auto">
        {[['overview', 'Overview'], ['calculations', 'Calculations'], ['returns', 'Returns'], ['income', 'Monthly Income'], ['assets', 'Assets & Liabilities'], ['invoices', 'Invoices']].map(([t, label]) => (
          <button
            key={t}
            onClick={() => setTab(t)}
            className={`px-4 py-1.5 rounded-lg text-sm font-medium transition-all whitespace-nowrap ${
              tab === t ? 'bg-white text-primary-700 shadow-sm' : 'text-gray-500 hover:text-gray-700'
            }`}
          >
            {label}
          </button>
        ))}
      </div>

      {/* New self-registration */}
      {tab === 'overview' && client.source === 'self_registration' && !client.reviewed_at && (
        <div className="card p-4 border-amber-300 bg-amber-50/60 space-y-2">
          <div className="flex items-center gap-2 flex-wrap">
            <Sparkles size={16} className="text-amber-600" />
            <div className="font-semibold text-amber-900 flex-1">New client — registered online on {fmtDate(client.registered_at)}{client.registration?.via && ` via ${client.registration.via}`}
              {client.registration?.filled_by === 'contact' && <span className="font-normal text-amber-800"> · filled in by {contactLabel(client) || 'a contact person'}</span>}</div>
            <button onClick={markReviewed} className="btn-primary text-xs py-1"><CheckCircle2 size={13} /> Mark reviewed</button>
          </div>
          {client.registration?.services?.length > 0 && (
            <div className="flex flex-wrap gap-1.5">{client.registration.services.map(sv => <span key={sv} className="text-xs px-2 py-0.5 rounded-full bg-white border border-amber-200 text-amber-900">{sv}</span>)}</div>
          )}
          {client.registration?.note && <div className="text-sm text-amber-900 whitespace-pre-line">“{client.registration.note}”</div>}
          {dupes.length > 0 && (
            <div className="text-xs text-red-700">⚠️ Possible duplicate of: {dupes.map((d, i) => <span key={d.id}>{i > 0 && ', '}<Link to={`/admin/clients/${d.id}`} className="underline font-semibold">{d.full_name}</Link></span>)} (same NIC / TIN / mobile)</div>
          )}
          <div className="text-xs text-amber-800">Check the details below, fix anything with Edit, then mark it reviewed.</div>
        </div>
      )}

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
            <div className="sm:col-span-2">
              {editing ? <ContactPersonFields form={form} setForm={setForm} /> : (
                <div>
                  <div className="text-xs font-semibold text-gray-400 uppercase tracking-wider mb-1">Contact person</div>
                  {hasContact(client) ? (
                    <div className="text-sm text-gray-800 flex flex-wrap gap-x-4 gap-y-1">
                      <span className="font-medium flex items-center gap-1"><UserRound size={14} className="text-primary-600" /> {contactLabel(client) || '—'}</span>
                      {client.contact_mobile && <a href={`tel:${client.contact_mobile}`} className="text-primary-700 hover:underline">{client.contact_mobile}</a>}
                      {client.contact_email && <span className="text-gray-600">{client.contact_email}</span>}
                      {client.contact_preferred && <span className="text-xs font-semibold px-2 py-0.5 rounded-full bg-primary-50 text-primary-700">★ Coordinate with this person</span>}
                    </div>
                  ) : <div className="text-sm text-gray-300">— <span className="text-xs">(Edit to add a son / daughter or other person who coordinates)</span></div>}
                </div>
              )}
            </div>
          </div>
        </div>
      )}
      {tab === 'overview' && <PortalAccess client={client} onChange={loadAll} />}
      {tab === 'overview' && (
        <div className="card p-5 flex flex-wrap items-center gap-3">
          <div className="flex-1 min-w-[220px]">
            <div className="font-semibold text-primary-800 text-sm">Tax Calculator in this client's portal</div>
            <div className="text-xs text-gray-500">"Default" follows Settings → Client Portal.</div>
          </div>
          <select className="input w-auto" value={client.tax_calc ?? 'default'} onChange={async (e) => {
            const val = e.target.value;
            const { error } = await supabase.from('clients').update({ tax_calc: val }).eq('id', id);
            if (error) return toast.error(error.message);
            setClient(c => ({ ...c, tax_calc: val }));
            toast.success(val === 'default' ? 'Follows the main setting' : `Tax Calculator ${val.toUpperCase()} for this client`);
          }}>
            <option value="default">Default (Settings)</option>
            <option value="on">Always ON</option>
            <option value="off">OFF for this client</option>
          </select>
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
                const forYear = calculations.filter(c => c.year === r.year && c.calc_type === 'annual');
                const calc = forYear.find(c => c.status === 'final') ?? forYear[0];   // final wins, else latest draft
                const sm = calc ? summarizeCalc(calc) : null;
                return (
                  <div key={r.id} className="flex items-center gap-3 px-5 py-3 flex-wrap">
                    <div className="flex-1 min-w-48">
                      <div className="text-sm font-semibold">Y/A {r.year}</div>
                      <div className="text-xs text-gray-400">Due: {fmtDate(r.due_date)}{r.notes ? ` · ${r.notes}` : ''}</div>
                      {sm ? (
                        <div className="text-xs text-gray-600 mt-0.5">
                          <span className={`font-bold ${calc.status === 'final' ? 'text-green-700' : 'text-amber-600'}`}>{calc.status === 'final' ? '✅ FINAL' : '📝 DRAFT'}</span> · {KIND_LABEL[sm.kind]} · Assessable {fmtRs(sm.assessable)} · Gross tax {fmtRs(sm.grossTax)} ·{' '}
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

      {tab === 'income' && <IncomeSheetsAdmin client={client} />}

      {/* Assets & Liabilities Tab */}
      {tab === 'assets' && <AssetStatementsAdmin client={client} />}

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
                  <SendMenu
                    table="invoices" row={inv}
                    phone={inv.client_snapshot?.phone || client.mobile} email={inv.client_snapshot?.email || client.email}
                    recipients={recipientsOf(client, { phone: inv.client_snapshot?.phone || client.mobile, email: inv.client_snapshot?.email || client.email })}
                    subject={`Invoice ${inv.invoice_no} — TaxMate Solutions`}
                    buildMessage={(url) => invoiceMessage({ ...inv, clients: client }, url)}
                    beforeSend={async () => {
                      if (inv.status !== 'draft') return null;
                      const { error } = await supabase.from('invoices').update({ status: 'unpaid' }).eq('id', inv.id);
                      if (error) throw error;
                      return { status: 'unpaid' };
                    }}
                    onChange={(p) => setInvoices(list => list.map(x => (x.id === inv.id ? { ...x, ...p } : x)))}
                  />
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
