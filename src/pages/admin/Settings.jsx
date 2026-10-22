import { useEffect, useState } from 'react';
import toast from 'react-hot-toast';
import { Building2, Receipt, Landmark, Users, UserCog, Save, Plus, Trash2, ArrowUp, ArrowDown, RotateCcw, ShieldCheck, Shield, UserX, XCircle, RefreshCw, AlertTriangle, MonitorSmartphone, Calculator as CalcIcon } from 'lucide-react';
import { Link } from 'react-router-dom';
import { supabase, fmtDate } from '../../lib/supabase';
import { useAuth } from '../../contexts/AuthContext';
import { useSettings } from '../../contexts/SettingsContext';
import { FIRM, FIRM_DEFAULTS } from '../../lib/iitStatement';
import { INVOICE_CFG, INVOICE_DEFAULTS, SERVICE_CATALOG } from '../../lib/invoice';
import { callPortal, inviteUrl, resetUrl, inviteMessage, resetMessage } from '../../lib/portal';
import { InvoiceSettings } from './Invoices';
import MessageMenu from '../../components/MessageMenu';
import ChangePassword from '../../components/ChangePassword';

const TABS = [
  ['firm', Building2, 'Firm Profile'],
  ['invoice', Receipt, 'Invoices'],
  ['bank', Landmark, 'Bank & Signature'],
  ['users', Users, 'Users & Access'],
  ['portal', MonitorSmartphone, 'Client Portal'],
  ['me', UserCog, 'My Account'],
];

export default function Settings() {
  const [tab, setTab] = useState('firm');
  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-2xl font-bold text-primary-800">⚙️ Settings</h1>
        <p className="text-sm text-gray-500">Firm details, invoices, bank accounts, who can sign in, and your own account</p>
      </div>
      <div className="flex gap-1 bg-gray-100 rounded-xl p-1 overflow-x-auto">
        {TABS.map(([id, Icon, label]) => (
          <button key={id} onClick={() => setTab(id)}
            className={`flex-1 whitespace-nowrap flex items-center justify-center gap-1.5 px-3 py-2 text-sm font-medium rounded-lg transition-colors ${tab === id ? 'bg-white text-primary-700 shadow-sm' : 'text-gray-500 hover:text-gray-700'}`}>
            <Icon size={15} /> {label}
          </button>
        ))}
      </div>
      {tab === 'firm' && <FirmTab />}
      {tab === 'invoice' && <InvoiceTab />}
      {tab === 'bank' && <BankTab />}
      {tab === 'users' && <UsersTab />}
      {tab === 'portal' && <PortalTab />}
      {tab === 'me' && <MyAccountTab />}
    </div>
  );
}

async function saveSetting(key, value) {
  const { error } = await supabase.from('app_settings').upsert({ key, value, updated_at: new Date().toISOString() });
  if (error) throw error;
}

// ─── Firm profile ────────────────────────────────────────
const FIRM_FIELDS = [
  ['name', 'Firm name', 'Shown on every statement, invoice and message'],
  ['tagline', 'Tagline', ''],
  ['email', 'Email', ''],
  ['phone', 'Phone', ''],
  ['whatsapp', 'WhatsApp number', 'Used for "Contact us on WhatsApp" links'],
  ['web', 'Website', ''],
  ['facebook', 'Facebook page', 'e.g. TaxMateSolutions.lk'],
  ['regNo', 'Business registration / TIN', 'Optional'],
  ['address', 'Address', 'Optional'],
];

function FirmTab() {
  const { reload } = useSettings();
  const [f, setF] = useState({ ...FIRM });
  const [busy, setBusy] = useState(false);
  const save = async () => {
    if (!f.name?.trim()) return toast.error('Firm name is required');
    setBusy(true);
    try {
      await saveSetting('firm', Object.fromEntries(FIRM_FIELDS.map(([k]) => [k, (f[k] ?? '').trim()])));
      await reload();
      toast.success('Firm profile saved — new statements and invoices use it');
    } catch (e) { toast.error(e.message); }
    setBusy(false);
  };
  return (
    <div className="card p-5 space-y-4 max-w-3xl">
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        {FIRM_FIELDS.map(([k, label, hint]) => (
          <div key={k} className={k === 'address' || k === 'tagline' ? 'sm:col-span-2' : ''}>
            <label className="block text-xs font-semibold text-gray-500 mb-1">{label}</label>
            <input className="input" value={f[k] ?? ''} placeholder={FIRM_DEFAULTS[k]} onChange={e => setF({ ...f, [k]: e.target.value })} />
            {hint && <p className="text-[11px] text-gray-400 mt-0.5">{hint}</p>}
          </div>
        ))}
      </div>
      <div className="flex gap-2">
        <button onClick={save} disabled={busy} className="btn-primary"><Save size={15} /> {busy ? 'Saving…' : 'Save firm profile'}</button>
        <button onClick={() => setF({ ...FIRM_DEFAULTS })} className="btn-secondary"><RotateCcw size={14} /> Restore defaults</button>
      </div>
    </div>
  );
}

// ─── Invoice settings + service catalog ─────────────────
function InvoiceTab() {
  const { reload } = useSettings();
  const [prefix, setPrefix] = useState(INVOICE_CFG.prefix);
  const [dueDays, setDueDays] = useState(String(INVOICE_CFG.dueDays));
  const [note, setNote] = useState(INVOICE_CFG.defaultNote);
  const [catalog, setCatalog] = useState(INVOICE_CFG.catalog.map(c => ({ ...c, price: String(c.price) })));
  const [busy, setBusy] = useState(false);

  const upd = (i, patch) => setCatalog(cs => cs.map((c, k) => (k === i ? { ...c, ...patch } : c)));
  const move = (i, d) => setCatalog(cs => { const a = [...cs]; const j = i + d; if (j < 0 || j >= a.length) return a; [a[i], a[j]] = [a[j], a[i]]; return a; });

  const save = async () => {
    if (!/^[A-Za-z0-9-]{1,16}$/.test(prefix.trim())) return toast.error('Prefix: letters, numbers and dashes only (max 16)');
    setBusy(true);
    try {
      await saveSetting('invoice', {
        prefix: prefix.trim().toUpperCase(), dueDays: parseInt(dueDays, 10) || 0, defaultNote: note.trim(),
        catalog: catalog.filter(c => c.name.trim()).map(c => ({ name: c.name.trim(), price: parseFloat(c.price) || 0 })),
      });
      await reload();
      toast.success('Invoice settings saved');
    } catch (e) { toast.error(e.message); }
    setBusy(false);
  };

  return (
    <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
      <div className="card p-5 space-y-3 self-start">
        <h3 className="font-semibold text-primary-800">Numbering &amp; defaults</h3>
        <div>
          <label className="block text-xs font-semibold text-gray-500 mb-1">Invoice number prefix</label>
          <input className="input font-mono" value={prefix} onChange={e => setPrefix(e.target.value)} />
          <p className="text-[11px] text-gray-400 mt-0.5">Next invoice looks like <span className="font-mono">{(prefix || 'TM-INV').toUpperCase()}-{new Date().getFullYear()}-0006</span>. The running number continues from your existing invoices.</p>
        </div>
        <div>
          <label className="block text-xs font-semibold text-gray-500 mb-1">Default days until due</label>
          <input type="number" min="0" max="365" className="input w-32" value={dueDays} onChange={e => setDueDays(e.target.value)} />
        </div>
        <div>
          <label className="block text-xs font-semibold text-gray-500 mb-1">Default payment note (when an invoice has no note)</label>
          <textarea className="input resize-none" rows={3} value={note} onChange={e => setNote(e.target.value)} />
        </div>
      </div>

      <div className="card p-5 space-y-3">
        <div className="flex items-center gap-2">
          <h3 className="font-semibold text-primary-800">Service catalog</h3>
          <span className="text-xs text-gray-400">quick-add buttons on new invoices</span>
          <button onClick={() => setCatalog(SERVICE_CATALOG.map(c => ({ ...c, price: String(c.price) })))} className="ml-auto text-xs text-gray-500 hover:underline">Reset to V16 list</button>
        </div>
        <div className="space-y-1.5 max-h-[460px] overflow-y-auto pr-1">
          {catalog.map((c, i) => (
            <div key={i} className="flex gap-1.5 items-center">
              <input className="input py-1.5 flex-1" value={c.name} placeholder="Service name" onChange={e => upd(i, { name: e.target.value })} />
              <div className="relative w-28">
                <span className="absolute left-2 top-1/2 -translate-y-1/2 text-xs text-gray-400">Rs.</span>
                <input type="number" min="0" step="100" className="input py-1.5 pl-8 text-right" value={c.price} onChange={e => upd(i, { price: e.target.value })} />
              </div>
              <button onClick={() => move(i, -1)} className="p-1 text-gray-400 hover:text-gray-700" title="Move up"><ArrowUp size={14} /></button>
              <button onClick={() => move(i, 1)} className="p-1 text-gray-400 hover:text-gray-700" title="Move down"><ArrowDown size={14} /></button>
              <button onClick={() => setCatalog(cs => cs.filter((_, k) => k !== i))} className="p-1 text-gray-300 hover:text-red-500" title="Remove"><Trash2 size={14} /></button>
            </div>
          ))}
        </div>
        <button onClick={() => setCatalog(cs => [...cs, { name: '', price: '' }])} className="text-sm text-primary-600 hover:underline flex items-center gap-1"><Plus size={14} /> Add service</button>
      </div>

      <div className="lg:col-span-2 flex gap-2">
        <button onClick={save} disabled={busy} className="btn-primary"><Save size={15} /> {busy ? 'Saving…' : 'Save invoice settings'}</button>
        <button onClick={() => { setPrefix(INVOICE_DEFAULTS.prefix); setDueDays(String(INVOICE_DEFAULTS.dueDays)); setNote(INVOICE_DEFAULTS.defaultNote); }} className="btn-secondary"><RotateCcw size={14} /> Restore defaults</button>
      </div>
    </div>
  );
}

// ─── Bank accounts & signature (same as on the Invoices page) ─
function BankTab() {
  const [banks, setBanks] = useState([]);
  const [sig, setSig] = useState('');
  const load = async () => {
    const [bk, st] = await Promise.all([
      supabase.from('bank_accounts').select('*').order('created_at'),
      supabase.from('app_settings').select('value').eq('key', 'firm_signature').maybeSingle(),
    ]);
    setBanks(bk.data ?? []);
    setSig(st.data?.value?.image ?? '');
  };
  useEffect(() => { load(); }, []);
  return <InvoiceSettings banks={banks} firmSig={sig} reload={load} />;
}

// ─── Users & access (admin panel) ───────────────────────
function UsersTab() {
  const { user } = useAuth();
  const [users, setUsers] = useState(null);
  const [invites, setInvites] = useState([]);
  const [err, setErr] = useState('');
  const [staff, setStaff] = useState({ name: '', email: '' });

  const load = async () => {
    setErr('');
    const { data: inv } = await supabase.from('portal_invites').select('*, clients(full_name, mobile)')
      .is('accepted_at', null).is('revoked_at', null).order('created_at', { ascending: false });
    setInvites((inv ?? []).filter(i => new Date(i.expires_at) > new Date()));
    try { setUsers((await callPortal('list_users')).users); }
    catch (e) { setErr(e.message); setUsers([]); }
  };
  useEffect(() => { load(); }, []);

  const setRole = async (u, role) => {
    const warn = role === 'admin'
      ? `Make ${u.email} an ADMIN? They will see and change ALL clients, calculations, invoices and settings.`
      : `Change ${u.email} to a normal client login? They lose admin access.`;
    if (!window.confirm(warn)) return;
    try { await callPortal('set_role', { user_id: u.id, role }); toast.success('Role updated'); load(); }
    catch (e) { toast.error(e.message); }
  };
  const remove = async (u) => {
    if (!window.confirm(`Delete the login ${u.email}? They can no longer sign in. Client records stay.`)) return;
    try { await callPortal('delete_user', { user_id: u.id }); toast.success('Login removed'); load(); }
    catch (e) { toast.error(e.message); }
  };
  const cancelInvite = async (i) => {
    const { error } = await supabase.from('portal_invites').update({ revoked_at: new Date().toISOString() }).eq('id', i.id);
    if (error) return toast.error(error.message);
    load();
  };
  const resetText = (u) => async () => {
    const { data, error } = await supabase.from('password_resets').insert({ user_id: u.id, created_by: user.id }).select('token').single();
    if (error) throw error;
    return resetMessage({ name: u.client_name || u.full_name, url: resetUrl(data.token) });
  };
  const staffInviteText = async () => {
    const email = staff.email.trim().toLowerCase();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new Error('Enter a valid email for the staff member');
    const { data, error } = await supabase.from('portal_invites')
      .insert({ email, full_name: staff.name.trim() || null, role: 'admin', created_by: user.id }).select('token').single();
    if (error) throw error;
    setStaff({ name: '', email: '' });
    load();
    return inviteMessage({ name: staff.name, url: inviteUrl(data.token), role: 'admin' });
  };

  const admins = (users ?? []).filter(u => u.role === 'admin');
  const clientsU = (users ?? []).filter(u => u.role !== 'admin');

  return (
    <div className="space-y-5">
      {err && (
        <div className="bg-red-50 border border-red-200 text-red-700 rounded-lg p-4 text-sm flex gap-2">
          <AlertTriangle size={18} className="flex-shrink-0" />
          <div><strong>Login management is not available yet.</strong> {err}<br />
            Deploy the <code>portal-admin</code> Edge Function in Supabase (Edge Functions → Deploy new function), then reload this page.</div>
        </div>
      )}

      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        {[['Admins', admins.length], ['Client logins', clientsU.length], ['Pending invites', invites.length], ['Total logins', (users ?? []).length]].map(([l, v]) => (
          <div key={l} className="card p-3"><div className="text-xl font-black text-primary-700">{users === null ? '…' : v}</div><div className="text-xs text-gray-500">{l}</div></div>
        ))}
      </div>

      <UserTable title="Admins" icon={Shield} rows={admins} onRole={setRole} onRemove={remove} resetText={resetText} />
      <UserTable title="Client portal logins" icon={Users} rows={clientsU} onRole={setRole} onRemove={remove} resetText={resetText} />

      <div className="card overflow-hidden">
        <div className="card-header">⏳ Pending invitations <button onClick={load} className="ml-auto text-xs text-gray-500 flex items-center gap-1 hover:underline"><RefreshCw size={12} /> Refresh</button></div>
        {invites.length === 0 ? <div className="p-6 text-center text-sm text-gray-400">No pending invitations. Invite clients from their page (Clients → client → Portal Access).</div> : (
          <div className="divide-y divide-gray-100">
            {invites.map(i => (
              <div key={i.id} className="flex items-center gap-3 px-5 py-3 flex-wrap">
                <div className="flex-1 min-w-48">
                  <div className="text-sm font-semibold">{i.clients?.full_name ?? i.full_name ?? i.email} <span className={`ml-1 text-[11px] px-1.5 py-0.5 rounded ${i.role === 'admin' ? 'bg-purple-100 text-purple-700' : 'bg-gray-100 text-gray-600'}`}>{i.role}</span></div>
                  <div className="text-xs text-gray-400">{i.email} · sent {fmtDate(i.created_at)} · valid until {fmtDate(i.expires_at)}</div>
                </div>
                <MessageMenu label="Send again" phone={i.clients?.mobile} email={i.email} subject="Your TaxMate portal invitation"
                  getText={async () => inviteMessage({ name: i.clients?.full_name ?? i.full_name, url: inviteUrl(i.token), role: i.role })} />
                <button onClick={() => cancelInvite(i)} className="btn-secondary text-xs py-1.5"><XCircle size={13} /> Cancel</button>
              </div>
            ))}
          </div>
        )}
      </div>

      <div className="card p-5 space-y-3 max-w-2xl">
        <h3 className="font-semibold text-primary-800 flex items-center gap-2"><ShieldCheck size={16} /> Invite a staff member as admin</h3>
        <p className="text-xs text-gray-500">Admins can see and change everything. Only invite people you fully trust. To give a <strong>client</strong> access, open the client's page instead.</p>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
          <input className="input" placeholder="Name" value={staff.name} onChange={e => setStaff({ ...staff, name: e.target.value })} />
          <input className="input" placeholder="Email (their sign-in name)" value={staff.email} onChange={e => setStaff({ ...staff, email: e.target.value })} />
        </div>
        <MessageMenu label="Create & send admin invite" email={staff.email} subject="Your TaxMate admin invitation" getText={staffInviteText} />
      </div>
    </div>
  );
}

function UserTable({ title, icon: Icon, rows, onRole, onRemove, resetText }) {
  return (
    <div className="card overflow-hidden">
      <div className="card-header"><Icon size={16} /> {title} <span className="text-xs text-gray-400 font-normal">{rows.length}</span></div>
      {rows.length === 0 ? <div className="p-6 text-center text-sm text-gray-400">None yet.</div> : (
        <div className="overflow-x-auto">
          <table className="w-full">
            <thead className="bg-gray-50 border-b border-gray-100"><tr>
              <th className="table-th">Login</th><th className="table-th">Client record</th><th className="table-th">Created</th><th className="table-th">Last sign-in</th><th className="table-th text-right">Actions</th>
            </tr></thead>
            <tbody className="divide-y divide-gray-50">
              {rows.map(u => (
                <tr key={u.id}>
                  <td className="table-td"><div className="text-sm font-semibold">{u.full_name || u.email}{u.is_me && <span className="ml-1 text-[11px] px-1.5 py-0.5 rounded bg-primary-100 text-primary-700">you</span>}</div><div className="text-xs text-gray-400">{u.email}</div></td>
                  <td className="table-td text-sm">{u.client_name ? <a href={`/admin/clients/${u.client_id}`} className="text-primary-600 hover:underline">{u.client_name}</a> : <span className="text-gray-300">—</span>}{u.client_tin && <div className="text-xs text-gray-400">TIN {u.client_tin}</div>}</td>
                  <td className="table-td text-xs text-gray-500">{fmtDate(u.created_at)}</td>
                  <td className="table-td text-xs text-gray-500">{u.last_sign_in_at ? fmtDate(u.last_sign_in_at) : 'Never'}</td>
                  <td className="table-td">
                    {u.is_me ? <div className="text-right text-xs text-gray-400">Change your password in My Account</div> : (
                      <div className="flex gap-1.5 justify-end flex-wrap">
                        <MessageMenu label="Reset link" phone={u.client_mobile} email={u.email} subject="Reset your TaxMate portal password" getText={resetText(u)} />
                        {u.role === 'admin'
                          ? <button onClick={() => onRole(u, 'client')} className="btn-secondary text-xs py-1.5">Remove admin</button>
                          : <button onClick={() => onRole(u, 'admin')} className="btn-secondary text-xs py-1.5">Make admin</button>}
                        <button onClick={() => onRemove(u)} className="text-xs px-2 py-1.5 rounded-lg text-red-600 hover:bg-red-50 flex items-center gap-1"><UserX size={13} /> Remove</button>
                      </div>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

// ─── My account ──────────────────────────────────────────
function MyAccountTab() {
  return (
    <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
      <ChangePassword />
    </div>
  );
}


// ─── Client Portal: features clients can use ─────────────
function PortalTab() {
  const [on, setOn] = useState(true);
  const [loading, setLoading] = useState(true);
  const [overrides, setOverrides] = useState([]);

  const load = async () => {
    const [{ data: st }, { data: cl }] = await Promise.all([
      supabase.from('app_settings').select('value').eq('key', 'client_tools').maybeSingle(),
      supabase.from('clients').select('id, full_name, tax_calc').neq('tax_calc', 'default').order('full_name'),
    ]);
    setOn(st?.value?.tax_calculator !== false);
    setOverrides(cl ?? []);
    setLoading(false);
  };
  useEffect(() => { load(); }, []);

  const toggle = async () => {
    const next = !on;
    const { error } = await supabase.from('app_settings').upsert({ key: 'client_tools', value: { tax_calculator: next }, updated_at: new Date().toISOString() });
    if (error) return toast.error(error.message);
    setOn(next);
    toast.success(next ? 'Tax Calculator is ON for clients' : 'Tax Calculator is OFF for clients');
  };
  const clearOverride = async (c) => {
    const { error } = await supabase.from('clients').update({ tax_calc: 'default' }).eq('id', c.id);
    if (error) return toast.error(error.message);
    load();
  };

  if (loading) return <div className="card p-6 text-gray-400 text-sm">Loading…</div>;
  return (
    <div className="space-y-4">
      <div className="card p-5">
        <div className="flex items-start gap-3">
          <div className="w-10 h-10 rounded-xl bg-gold-500/20 text-amber-700 flex items-center justify-center"><CalcIcon size={20} /></div>
          <div className="flex-1">
            <div className="font-semibold text-gray-800">Tax Calculator in the client portal</div>
            <p className="text-sm text-gray-500">Clients can estimate their monthly / annual tax (local, foreign, mixed). Switch it off for everyone here, or for one client on their page (Overview → Client portal).</p>
          </div>
          <button onClick={toggle} className={`relative w-12 h-6 rounded-full transition-colors flex-shrink-0 ${on ? 'bg-green-500' : 'bg-gray-300'}`} aria-label="Toggle tax calculator">
            <span className={`absolute top-0.5 w-5 h-5 bg-white rounded-full shadow transition-transform ${on ? 'translate-x-6' : 'translate-x-0.5'}`} />
          </button>
        </div>
        <div className={`mt-3 text-sm font-semibold ${on ? 'text-green-700' : 'text-gray-500'}`}>{on ? 'ON — all clients see it (except those switched off below)' : 'OFF — hidden for all clients (except those switched on below)'}</div>
      </div>
      <div className="card">
        <div className="card-header">Client-specific settings</div>
        {overrides.length === 0 ? <div className="p-5 text-sm text-gray-400">No exceptions — every client follows the switch above.</div> : (
          <div className="divide-y divide-gray-50">
            {overrides.map(c => (
              <div key={c.id} className="px-5 py-2.5 flex items-center gap-3 text-sm">
                <Link to={`/admin/clients/${c.id}`} className="flex-1 font-medium text-primary-700 hover:underline">{c.full_name}</Link>
                <span className={`text-xs font-semibold px-2 py-0.5 rounded-full ${c.tax_calc === 'on' ? 'bg-green-100 text-green-700' : 'bg-gray-100 text-gray-600'}`}>Calculator always {c.tax_calc.toUpperCase()}</span>
                <button onClick={() => clearOverride(c)} className="text-xs text-gray-500 hover:underline">Follow main switch</button>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
