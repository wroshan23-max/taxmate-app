import { useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { supabase, fmtDate } from '../../lib/supabase';
import { useAuth } from '../../contexts/AuthContext';
import toast from 'react-hot-toast';
import { Plus, Search, X, User, Mail, Phone, CreditCard, Link2, UserRound, Trash2, Archive, RotateCcw, Gift } from 'lucide-react';
import DeleteClientDialog from '../../components/DeleteClientDialog';
import ContactPersonFields, { contactPatch } from '../../components/ContactPersonFields';
import RegistrationLinks from '../../components/RegistrationLinks';
import { hasContact, contactLabel } from '../../lib/contacts';

const EMPTY = { full_name: '', tin: '', nic: '', email: '', mobile: '', address: '', employer: '', resident_status: 'resident', contact_name: '', contact_relation: '', contact_mobile: '', contact_email: '', contact_preferred: false };

export default function Clients() {
  const { user } = useAuth();
  const navigate = useNavigate();
  // Click anywhere on a row to open the client (buttons/links keep their own action; Ctrl/⌘ or middle-click = new tab)
  const openRow = (e, id) => {
    if (e.target.closest('a,button,input,select,textarea,label')) return;
    if (window.getSelection()?.toString()) return;   // user is selecting text
    if (e.ctrlKey || e.metaKey || e.button === 1) window.open(`/admin/clients/${id}`, '_blank', 'noopener');
    else navigate(`/admin/clients/${id}`);
  };
  const [clients, setClients] = useState([]);
  const [search, setSearch] = useState('');
  const [loading, setLoading] = useState(true);
  const [modal, setModal] = useState(false);
  const [form, setForm] = useState(EMPTY);
  const [saving, setSaving] = useState(false);
  const [regOpen, setRegOpen] = useState(false);
  const [onlyNew, setOnlyNew] = useState(false);
  const [showArchived, setShowArchived] = useState(false);
  const [removing, setRemoving] = useState(null);

  useEffect(() => { loadClients(); }, []);

  const loadClients = async () => {
    const { data } = await supabase.from('clients').select('*').order('full_name');
    setClients(data ?? []);
    setLoading(false);
  };

  const isNew = (c) => c.source === 'self_registration' && !c.reviewed_at && !c.archived_at;
  const newCount = clients.filter(isNew).length;
  const archivedCount = clients.filter(c => c.archived_at).length;
  const active = clients.filter(c => !c.archived_at);
  const nameOf = Object.fromEntries(clients.map(c => [c.id, c.full_name]));
  const restore = async (c) => {
    const { error } = await supabase.from('clients').update({ archived_at: null }).eq('id', c.id);
    if (error) return toast.error(error.message);
    toast.success(`${c.full_name} restored`);
    loadClients();
  };
  const filtered = clients.filter(c =>
    (showArchived ? !!c.archived_at : !c.archived_at) &&
    (!onlyNew || isNew(c)) &&
    [c.full_name, c.tin, c.email, c.mobile, c.nic, c.contact_name, c.contact_mobile].some(f => f?.toLowerCase().includes(search.toLowerCase()))
  );

  const openAdd = () => { setForm(EMPTY); setModal(true); };
  const closeModal = () => { setModal(false); setForm(EMPTY); };

  const save = async (e) => {
    e.preventDefault();
    if (!form.full_name.trim()) return toast.error('Name required');
    setSaving(true);
    const { error } = await supabase.from('clients').insert({ ...form, ...contactPatch(form), created_by: user.id });
    setSaving(false);
    if (error) { toast.error('Error: ' + error.message); return; }
    toast.success('Client added!');
    closeModal();
    loadClients();
  };

  return (
    <div className="space-y-5">
      <div className="flex items-center gap-3 flex-wrap">
        <div>
          <h1 className="text-2xl font-bold text-primary-800">Clients</h1>
          <p className="text-sm text-gray-500">{active.length} clients
            {archivedCount > 0 && <button onClick={() => setShowArchived(v => !v)} className={`ml-2 text-xs font-semibold px-2 py-0.5 rounded-full ${showArchived ? 'bg-gray-700 text-white' : 'bg-gray-100 text-gray-600'}`}><Archive size={11} className="inline -mt-0.5" /> {archivedCount} archived{showArchived ? ' ✕' : ''}</button>}
            {newCount > 0 && <button onClick={() => setOnlyNew(v => !v)} className={`ml-2 text-xs font-semibold px-2 py-0.5 rounded-full ${onlyNew ? 'bg-amber-500 text-white' : 'bg-amber-100 text-amber-800'}`}>{newCount} new registration{newCount > 1 ? 's' : ''}{onlyNew ? ' ✕' : ''}</button>}
          </p>
        </div>
        <div className="ml-auto flex items-center gap-3 flex-wrap">
          <div className="relative">
            <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
            <input
              className="input pl-9 w-56"
              placeholder="Search name, TIN, mobile..."
              value={search}
              onChange={e => setSearch(e.target.value)}
            />
          </div>
          <button onClick={() => setRegOpen(true)} className="btn-secondary" title="Send a link so the client fills in their own details">
            <Link2 size={16} /> Registration link
          </button>
          <button onClick={openAdd} className="btn-primary">
            <Plus size={16} /> Add Client
          </button>
        </div>
      </div>

      {/* Table */}
      <div className="card overflow-hidden">
        {loading ? (
          <div className="p-8 text-center text-gray-400">Loading...</div>
        ) : filtered.length === 0 ? (
          <div className="p-12 text-center">
            <User size={40} className="mx-auto text-gray-200 mb-3" />
            <div className="text-gray-400">{search ? 'No clients match your search' : 'No clients yet — add your first one!'}</div>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead className="bg-gray-50 border-b border-gray-100">
                <tr>
                  <th className="table-th">Client</th>
                  <th className="table-th">TIN</th>
                  <th className="table-th hidden sm:table-cell">NIC</th>
                  <th className="table-th hidden md:table-cell">Mobile</th>
                  <th className="table-th hidden lg:table-cell">Added</th>
                  <th className="table-th">Portal</th>
                  <th className="table-th">Action</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-50">
                {filtered.map(c => (
                  <tr key={c.id} className="group cursor-pointer hover:bg-primary-50/50 transition-colors"
                    onClick={(e) => openRow(e, c.id)} onAuxClick={(e) => e.button === 1 && openRow(e, c.id)}>
                    <td className="table-td">
                      <div className="flex items-center gap-3">
                        <div className="w-8 h-8 rounded-full bg-primary-100 flex items-center justify-center text-primary-700 font-bold text-sm flex-shrink-0">
                          {c.full_name?.[0] ?? '?'}
                        </div>
                        <div>
                          <div className="font-semibold text-gray-800 flex items-center gap-1.5 flex-wrap">{c.full_name}
                            {isNew(c) && <span className="text-[10px] font-bold px-1.5 py-0.5 rounded bg-amber-100 text-amber-800">NEW · {c.registration?.via && c.registration.via !== 'personal link' ? `via ${c.registration.via}` : 'self-registered'}</span>}</div>
                          <div className="text-xs text-gray-400">{c.email ?? '—'}</div>
                          {c.referred_by && <div className="text-[11px] text-purple-700 flex items-center gap-1 mt-0.5"><Gift size={11} /> Referred by {nameOf[c.referred_by] ?? 'a client'}</div>}
                          {hasContact(c) && (
                            <div className={`text-xs mt-0.5 flex items-center gap-1 ${c.contact_preferred ? 'text-primary-700 font-medium' : 'text-gray-500'}`}>
                              <UserRound size={11} /> {contactLabel(c) || 'Contact'}{c.contact_mobile && <> · {c.contact_mobile}</>}{c.contact_preferred && <span title="Coordinate with this person"> ★</span>}
                            </div>
                          )}
                        </div>
                      </div>
                    </td>
                    <td className="table-td">
                      <span className="font-mono text-xs bg-gray-100 px-2 py-0.5 rounded">
                        {c.tin ?? '—'}
                      </span>
                    </td>
                    <td className="table-td hidden sm:table-cell text-gray-600">{c.nic ?? '—'}</td>
                    <td className="table-td hidden md:table-cell text-gray-600">{c.mobile ?? '—'}</td>
                    <td className="table-td hidden lg:table-cell text-gray-400 text-xs">{fmtDate(c.created_at)}</td>
                    <td className="table-td">
                      {c.profile_id
                        ? <span className="text-xs font-semibold px-2 py-0.5 rounded-full bg-green-100 text-green-700">Active</span>
                        : <Link to={`/admin/clients/${c.id}`} className="text-xs text-primary-600 hover:underline">Invite</Link>}
                    </td>
                    <td className="table-td">
                      <Link
                        to={`/admin/clients/${c.id}`}
                        className="text-primary-600 hover:text-primary-800 text-xs font-semibold hover:underline"
                      >
                        View <span className="inline-block transition-transform group-hover:translate-x-0.5">→</span>
                      </Link>
                      {c.archived_at
                        ? <button onClick={() => restore(c)} title="Restore" className="ml-3 text-xs text-green-700 hover:underline inline-flex items-center gap-1"><RotateCcw size={12} /> Restore</button>
                        : null}
                      <button onClick={() => setRemoving(c)} title="Archive or delete" className="ml-2 p-1 rounded-md text-gray-300 hover:text-red-600 hover:bg-red-50 align-middle"><Trash2 size={14} /></button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {removing && <DeleteClientDialog client={removing} onClose={() => setRemoving(null)} onDone={() => { setRemoving(null); loadClients(); }} />}
      {regOpen && <RegistrationLinks onClose={() => { setRegOpen(false); loadClients(); }} />}

      {/* Add Client Modal */}
      {modal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50">
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-lg max-h-[90vh] overflow-y-auto">
            <div className="flex items-center justify-between p-5 border-b">
              <h3 className="font-bold text-primary-800">Add New Client</h3>
              <button onClick={closeModal} className="text-gray-400 hover:text-gray-600"><X size={20} /></button>
            </div>
            <form onSubmit={save} className="p-5 space-y-4">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div className="sm:col-span-2">
                  <label className="block text-xs font-semibold text-gray-500 mb-1">Full Name *</label>
                  <input className="input" placeholder="Nimal Perera" value={form.full_name}
                    onChange={e => setForm({...form, full_name: e.target.value})} required />
                </div>
                <div>
                  <label className="block text-xs font-semibold text-gray-500 mb-1">TIN</label>
                  <input className="input" placeholder="123456789-0000" value={form.tin}
                    onChange={e => setForm({...form, tin: e.target.value})} />
                </div>
                <div>
                  <label className="block text-xs font-semibold text-gray-500 mb-1">NIC</label>
                  <input className="input" placeholder="123456789V" value={form.nic}
                    onChange={e => setForm({...form, nic: e.target.value})} />
                </div>
                <div>
                  <label className="block text-xs font-semibold text-gray-500 mb-1">Email</label>
                  <input className="input" type="email" placeholder="email@example.com" value={form.email}
                    onChange={e => setForm({...form, email: e.target.value})} />
                </div>
                <div>
                  <label className="block text-xs font-semibold text-gray-500 mb-1">Mobile</label>
                  <input className="input" placeholder="07X XXXXXXX" value={form.mobile}
                    onChange={e => setForm({...form, mobile: e.target.value})} />
                </div>
                <div className="sm:col-span-2">
                  <label className="block text-xs font-semibold text-gray-500 mb-1">Employer</label>
                  <input className="input" placeholder="Company / Organization" value={form.employer}
                    onChange={e => setForm({...form, employer: e.target.value})} />
                </div>
                <div className="sm:col-span-2">
                  <label className="block text-xs font-semibold text-gray-500 mb-1">Address</label>
                  <textarea className="input resize-none" rows={2} placeholder="Full address..." value={form.address}
                    onChange={e => setForm({...form, address: e.target.value})} />
                </div>
                <div>
                  <label className="block text-xs font-semibold text-gray-500 mb-1">Resident Status</label>
                  <select className="input" value={form.resident_status}
                    onChange={e => setForm({...form, resident_status: e.target.value})}>
                    <option value="resident">Resident Individual</option>
                    <option value="nrcitizen">Non-Resident Citizen</option>
                    <option value="nonresident">Non-Resident</option>
                  </select>
                </div>
              </div>
              <ContactPersonFields form={form} setForm={setForm} />
              <div className="flex gap-3 pt-2">
                <button type="button" onClick={closeModal} className="btn-secondary flex-1 justify-center">Cancel</button>
                <button type="submit" disabled={saving} className="btn-primary flex-1 justify-center">
                  {saving ? 'Saving...' : 'Add Client'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
