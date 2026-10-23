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
import { PORTAL_FEATURES } from './Settings';
import { invoiceMessage } from '../../lib/share';
import ContactPersonFields, { contactPatch } from '../../components/ContactPersonFields';
import { hasContact, contactLabel, recipientsOf } from '../../lib/contacts';
import { UserRound, Sparkles, CheckCircle2, FolderLock, ShieldCheck, MessageCircle, RotateCcw } from 'lucide-react';
import DocumentVault from '../../components/DocumentVault';
import IrdDetailsAdmin from '../../components/IrdDetailsAdmin';
import SummaryLettersAdmin from '../../components/SummaryLettersAdmin';
import RamisDraftAdmin from '../../components/RamisDraftAdmin';
import { ReturnStepper, StartTracking, setReturnStage } from '../../components/ReturnTracker';

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
  const [newDocs, setNewDocs] = useState(0);
  const countNewDocs = () => supabase.from('client_documents').select('id', { count: 'exact', head: true })
    .eq('client_id', id).eq('uploaded_role', 'client').is('seen_at', null).then(({ count }) => setNewDocs(count ?? 0));
  useEffect(() => { countNewDocs(); }, [id]); // eslint-disable-line react-hooks/exhaustive-deps

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
        {[['overview', 'Overview'], ['calculations', 'Calculations'], ['returns', 'Returns'], ['income', 'Monthly Income'], ['assets', 'Assets & Liabilities'], ['documents', 'Documents'], ['invoices', 'Invoices']].map(([t, label]) => (
          <button
            key={t}
            onClick={() => setTab(t)}
            className={`px-4 py-1.5 rounded-lg text-sm font-medium transition-all whitespace-nowrap ${
              tab === t ? 'bg-white text-primary-700 shadow-sm' : 'text-gray-500 hover:text-gray-700'
            }`}
          >
            {label}{t === 'documents' && newDocs > 0 && <span className="ml-1.5 text-[10px] font-black bg-gold-500 text-primary-900 rounded-full px-1.5">{newDocs}</span>}
          </button>
        ))}
      </div>

      {client.archived_at && (
        <div className="card p-3 flex items-center gap-3 bg-gray-50 border-gray-300 text-sm">
          <span className="flex-1 text-gray-700">📦 This client is <b>archived</b> (hidden from lists) since {fmtDate(client.archived_at)}.</span>
          <button onClick={async () => { const { error } = await supabase.from('clients').update({ archived_at: null }).eq('id', id); if (error) return toast.error(error.message); setClient(c => ({ ...c, archived_at: null })); toast.success('Restored'); }}
            className="btn-secondary text-xs py-1">Restore</button>
        </div>
      )}

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
      {tab === 'overview' && <IrdDetailsAdmin client={client} onClientChange={(p) => { setClient(c => ({ ...c, ...p })); setForm(fm => ({ ...fm, ...p })); }} />}
      {tab === 'overview' && <PortalAccess client={client} onChange={loadAll} />}
      {tab === 'overview' && client.profile_id && (
        <div className="card p-4 flex items-center gap-3 flex-wrap">
          <ShieldCheck size={18} className="text-primary-600" />
          <div className="flex-1 min-w-48">
            <div className="text-sm font-semibold text-gray-800">Two-step login (PIN / authenticator app)</div>
            <div className="text-xs text-gray-500">If the client forgot their PIN or lost their phone, reset it here. They sign in with their password and set it up again.</div>
          </div>
          <Link to={`/admin/messages?client=${id}`} className="btn-secondary text-xs py-1.5"><MessageCircle size={13} /> Message</Link>
          <button className="btn-secondary text-xs py-1.5" onClick={async () => {
            if (!window.confirm(`Reset two-step login for ${client.full_name}?`)) return;
            const { data, error } = await supabase.rpc('admin_reset_mfa', { p_client: id });
            if (error) return toast.error(error.message);
            toast.success(data ? 'Two-step login reset — PIN / authenticator removed' : 'This client did not have two-step login on');
          }}><RotateCcw size={13} /> Reset PIN / 2FA</button>
        </div>
      )}
      {tab === 'overview' && (
        <div className="card p-5">
          <div className="font-semibold text-primary-800 text-sm">Portal features for this client</div>
          <div className="text-xs text-gray-500 mb-3">"Default" follows Settings → Client Portal.</div>
          <div className="grid sm:grid-cols-2 gap-3">
            {PORTAL_FEATURES.map(([k, emo, title]) => {
              const ov = client.feature_overrides?.[k];
              const val = ov === true ? 'on' : ov === false ? 'off' : 'default';
              return (
                <label key={k} className="flex items-center gap-2 text-sm">
                  <span className="text-lg">{emo}</span><span className="flex-1 text-gray-700">{title}</span>
                  <select className="input w-auto py-1.5 text-sm" value={val} onChange={async (e) => {
                    const next = { ...(client.feature_overrides ?? {}) };
                    if (e.target.value === 'default') delete next[k]; else next[k] = e.target.value === 'on';
                    const { error } = await supabase.from('clients').update({ feature_overrides: next }).eq('id', id);
                    if (error) return toast.error(error.message);
                    setClient(c => ({ ...c, feature_overrides: next }));
                    toast.success(`${title}: ${e.target.value === 'default' ? 'default' : e.target.value.toUpperCase()}`);
                  }}>
                    <option value="default">Default</option><option value="on">ON</option><option value="off">OFF</option>
                  </select>
                </label>
              );
            })}
          </div>
          {client.referred_by && <div className="text-xs text-purple-700 mt-3">🎁 Joined through a friend's invite link.</div>}
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
          <div className="card-header flex-wrap gap-2"><FileText size={16} /> Tax Returns — progress
            <div className="ml-auto"><StartTracking clientId={id} userId={user?.id} existing={returns.map(r => r.year)} onCreated={(r) => setReturns(rs => [r, ...rs])} /></div>
          </div>
          {returns.length === 0 ? (
            <div className="p-8 text-center text-gray-400 text-sm">No returns yet — pick a Y/A above and click <b>Start tracking</b>.</div>
          ) : (
            <div className="divide-y divide-gray-100">
              {returns.map(r => {
                const forYear = calculations.filter(c => c.year === r.year && c.calc_type === 'annual');
                const calc = forYear.find(c => c.status === 'final') ?? forYear[0];   // final wins, else latest draft
                const sm = calc ? summarizeCalc(calc) : null;
                return (
                  <div key={r.id} className="px-5 py-4 space-y-3">
                    <div className="flex items-center gap-3 flex-wrap">
                      <div className="flex-1 min-w-48">
                        <div className="text-sm font-bold text-gray-800">Y/A {r.year}</div>
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
                    </div>
                    <div className="rounded-xl bg-gray-50/70 border border-gray-100 p-3">
                      <ReturnStepper ret={r} onSet={async (stage) => { const d = await setReturnStage(r.id, stage); setReturns(rs => rs.map(x => (x.id === r.id ? d : x))); }} />
                      <div className="text-[10px] text-gray-400 text-center mt-1.5">Click a step to update — the client sees it on their dashboard.</div>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}

      {tab === 'returns' && <RamisDraftAdmin client={client} calculations={calculations} />}
      {tab === 'returns' && <SummaryLettersAdmin client={client} calculations={calculations} returns={returns} userId={user?.id} />}

      {tab === 'income' && <IncomeSheetsAdmin client={client} />}

      {/* Assets & Liabilities Tab */}
      {tab === 'assets' && <AssetStatementsAdmin client={client} />}

      {/* Documents Tab */}
      {tab === 'documents' && (
        <div className="space-y-3">
          {client.feature_overrides?.documents === false && (
            <div className="card p-3 text-sm bg-amber-50 border-amber-200 text-amber-800 flex items-center gap-2"><FolderLock size={15} /> Document vault is switched off for this client — they can't see or upload files. Turn it on in Overview → Portal features.</div>)}
          <DocumentVault clientId={id} role="admin" userId={user?.id} onChange={countNewDocs} />
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
