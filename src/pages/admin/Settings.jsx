import { useEffect, useState } from 'react';
import { payhereStatus } from '../../lib/payments';
import { TwoFactorCard, PinCard } from '../../components/TwoFactor';
import toast from 'react-hot-toast';
import { Crown, Cloud } from 'lucide-react';
import { loadPlans, savePlans, DEFAULT_PLANS, planStyle } from '../../lib/plans';
import { Building2, Receipt, Landmark, Users, UserCog, Save, Plus, Trash2, ArrowUp, ArrowDown, RotateCcw, ShieldCheck, Shield, UserX, XCircle, RefreshCw, AlertTriangle, MonitorSmartphone, Calculator as CalcIcon, CreditCard, ExternalLink, Mail, Send, Play } from 'lucide-react';
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
import StorageSettings from '../../components/StorageSettings';

const TABS = [
  ['firm', Building2, 'Firm Profile'],
  ['invoice', Receipt, 'Invoices'],
  ['bank', Landmark, 'Bank & Signature'],
  ['users', Users, 'Users & Access'],
  ['portal', MonitorSmartphone, 'Client Portal'],
  ['payments', CreditCard, 'Payments'],
  ['plans', Crown, 'Plans'],
  ['storage', Cloud, 'File storage'],
  ['email', Mail, 'Email reminders'],
  ['me', UserCog, 'My Account'],
];

export default function Settings() {
  // ?code=… means we are back from the Microsoft (OneDrive) sign-in
  const [tab, setTab] = useState(() => { const q = new URLSearchParams(window.location.search); return q.get('code') || q.get('error') ? 'storage' : (q.get('tab') || 'firm'); });
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
      {tab === 'payments' && <PaymentsTab />}
      {tab === 'plans' && <PlansTab />}
      {tab === 'storage' && <StorageSettings />}
      {tab === 'email' && <EmailTab />}
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
      <LoginSecurityCard />
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

// ─── Login security: PIN option on/off ───────────────────
function LoginSecurityCard() {
  const { refreshMfa } = useAuth();
  const [o, setO] = useState(null);
  const [busy, setBusy] = useState(false);
  const load = () => supabase.rpc('admin_security_overview').then(({ data }) => data && setO(data));
  useEffect(() => { load(); }, []);
  if (!o) return null;

  const toggle = async () => {
    const next = !o.pin_login;
    if (!next && (o.clients_pin > 0 || o.admins_pin_only > 0) && !window.confirm(
      `Switch OFF the login PIN?\n\n• ${o.clients_pin} client(s) using a PIN will sign in with password only (unless they also use the app).` +
      (o.admins_pin_only ? `\n• ${o.admins_pin_only} admin(s) using only a PIN must set up the authenticator app at their next visit.` : ''))) return;
    setBusy(true);
    const { data: cur } = await supabase.from('app_settings').select('value').eq('key', 'security').maybeSingle();
    const { error } = await supabase.from('app_settings').upsert({ key: 'security', value: { ...(cur?.value ?? {}), pin_login: next } });
    setBusy(false);
    if (error) return toast.error(error.message);
    toast.success(`Login PIN option ${next ? 'ON' : 'OFF'}`);
    await load(); refreshMfa();
  };

  return (
    <div className="card overflow-hidden">
      <div className="card-header"><ShieldCheck size={16} /> Login security</div>
      <div className="p-5 grid md:grid-cols-[1fr_auto] gap-4 items-center">
        <div>
          <div className="font-semibold text-gray-800">🔢 Allow a fixed login PIN</div>
          <p className="text-sm text-gray-500 mt-0.5">When ON, admins and clients can choose a secret 6-digit PIN as their second step instead of the authenticator app. When OFF, only the authenticator app counts.</p>
          <div className="flex flex-wrap gap-2 mt-3 text-[11px]">
            <span className="px-2 py-1 rounded-full bg-gray-100 text-gray-700">Admins: {o.admins_app} app · {o.admins_pin} PIN (of {o.admins})</span>
            <span className="px-2 py-1 rounded-full bg-gray-100 text-gray-700">Clients: {o.clients_app} app · {o.clients_pin} PIN</span>
          </div>
          <p className="text-[11px] text-gray-400 mt-2">The authenticator app is stronger (the code changes every 30 seconds). A PIN is simpler; it is stored only as a secure hash and locks after 5 wrong tries.</p>
        </div>
        <button onClick={toggle} disabled={busy} role="switch" aria-checked={o.pin_login}
          className={`relative w-16 h-9 rounded-full transition-colors ${o.pin_login ? 'bg-emerald-500' : 'bg-gray-300'} disabled:opacity-50`}>
          <span className={`absolute top-1 left-1 w-7 h-7 rounded-full bg-white shadow transition-transform ${o.pin_login ? 'translate-x-7' : ''}`} />
          <span className="sr-only">{o.pin_login ? 'ON' : 'OFF'}</span>
        </button>
      </div>
    </div>
  );
}

// ─── Payments: PayHere + bank transfer ───────────────────
function PaymentsTab() {
  const [cfg, setCfg] = useState(null);
  const [ph, setPh] = useState(null);
  const [note, setNote] = useState('');
  const load = async () => {
    const { data } = await supabase.from('app_settings').select('value').eq('key', 'payments').maybeSingle();
    const v = { payhere: false, bank: true, bank_note: '', ...(data?.value ?? {}) };
    setCfg(v); setNote(v.bank_note || '');
    payhereStatus().then(setPh).catch(() => setPh({ configured: false }));
  };
  useEffect(() => { load(); }, []);
  const save = async (patch, msg) => {
    const next = { ...cfg, ...patch };
    const { error } = await supabase.from('app_settings').upsert({ key: 'payments', value: next });
    if (error) return toast.error(error.message);
    setCfg(next); toast.success(msg);
  };
  if (!cfg) return <div className="card p-6 text-gray-400 text-sm">Loading…</div>;
  const Switch = ({ on, onClick, disabled }) => (
    <button onClick={onClick} disabled={disabled} role="switch" aria-checked={on}
      className={`relative w-14 h-8 rounded-full transition-colors flex-shrink-0 ${on ? 'bg-emerald-500' : 'bg-gray-300'} disabled:opacity-40`}>
      <span className={`absolute top-1 left-1 w-6 h-6 rounded-full bg-white shadow transition-transform ${on ? 'translate-x-6' : ''}`} />
    </button>
  );
  const notify = 'https://qipehxixvulvrubjifvi.supabase.co/functions/v1/payhere';
  return (
    <div className="grid lg:grid-cols-2 gap-5 items-start">
      <div className="card overflow-hidden">
        <div className="card-header"><CreditCard size={16} /> PayHere — card, eZ Cash, mCash, internet banking
          {ph?.configured && <span className={`ml-auto text-[10px] font-bold px-2 py-0.5 rounded-full ${ph.sandbox ? 'bg-amber-100 text-amber-800' : 'bg-emerald-100 text-emerald-700'}`}>{ph.sandbox ? 'SANDBOX (test)' : 'LIVE'}</span>}
        </div>
        <div className="p-5 space-y-4">
          <div className="flex items-center gap-3">
            <div className="flex-1">
              <div className="font-semibold text-gray-800">Clients can pay invoices online</div>
              <p className="text-sm text-gray-500">A "Pay now" button on every unpaid invoice. Paid invoices update automatically.</p>
            </div>
            <Switch on={cfg.payhere} disabled={!ph?.configured && !cfg.payhere} onClick={() => save({ payhere: !cfg.payhere }, `Online payment ${!cfg.payhere ? 'ON' : 'OFF'}`)} />
          </div>
          {ph === null ? <div className="text-xs text-gray-400">Checking PayHere setup…</div> : ph.configured ? (
            <div className="rounded-xl bg-emerald-50 border border-emerald-200 text-emerald-800 text-sm p-3">✓ PayHere is connected (merchant {ph.merchant}). {ph.sandbox && 'Test mode — no real money moves. Remove PAYHERE_SANDBOX to go live.'}</div>
          ) : (
            <div className="rounded-xl bg-amber-50 border border-amber-200 p-4 text-sm text-amber-900 space-y-2">
              <div className="font-bold">One-time setup (5 minutes)</div>
              <ol className="list-decimal ml-4 space-y-1.5">
                <li>PayHere → <b>Integrations → Add Domain/App</b> → domain <code className="bg-white px-1 rounded">taxmatesolutions.com</code> (PayHere does not accept vercel.app). After PayHere approves it, copy its <b>Merchant Secret</b>. Clients pay from <code className="bg-white px-1 rounded">app.taxmatesolutions.com</code>.</li>
                <li>Supabase → <b>Edge Functions → Secrets</b> → add <code className="bg-white px-1 rounded">PAYHERE_MERCHANT_ID</code> (your Merchant ID) and <code className="bg-white px-1 rounded">PAYHERE_MERCHANT_SECRET</code> (the secret from step 1). To test first, also add <code className="bg-white px-1 rounded">PAYHERE_SANDBOX</code> = <code>true</code> with sandbox credentials.</li>
                <li>Come back here and switch online payment ON.</li>
              </ol>
              <div className="text-xs">Payment notifications go to <code className="bg-white px-1 rounded break-all">{notify}</code> (sent automatically with each payment).</div>
              <div className="flex gap-2 flex-wrap">
                <a href="https://www.payhere.lk/merchant/" target="_blank" rel="noreferrer" className="btn-secondary text-xs"><ExternalLink size={13} /> Open PayHere</a>
                <a href="https://supabase.com/dashboard/project/qipehxixvulvrubjifvi/settings/functions" target="_blank" rel="noreferrer" className="btn-secondary text-xs"><ExternalLink size={13} /> Open Supabase secrets</a>
                <button onClick={load} className="btn-secondary text-xs"><RefreshCw size={13} /> Check again</button>
              </div>
            </div>
          )}
          <p className="text-[11px] text-gray-400">PayHere charges its own fee per payment (see your PayHere plan). The secret never reaches the browser — prices are signed on the server.</p>
        </div>
      </div>

      <div className="card overflow-hidden">
        <div className="card-header"><Landmark size={16} /> Bank transfer with slip</div>
        <div className="p-5 space-y-4">
          <div className="flex items-center gap-3">
            <div className="flex-1">
              <div className="font-semibold text-gray-800">Clients can upload a bank slip</div>
              <p className="text-sm text-gray-500">They see your bank accounts (Settings → Bank &amp; Signature), pay, and upload the slip. You confirm it in <b>Payments</b>.</p>
            </div>
            <Switch on={cfg.bank} onClick={() => save({ bank: !cfg.bank }, `Bank transfer ${!cfg.bank ? 'ON' : 'OFF'}`)} />
          </div>
          <label className="block text-xs font-semibold text-gray-600">Extra note for clients (optional)
            <div className="flex gap-2 mt-1">
              <input className="input flex-1" maxLength={200} placeholder="e.g. CDM / online transfer accepted. Use the invoice number as reference." value={note} onChange={e => setNote(e.target.value)} />
              <button onClick={() => save({ bank_note: note.trim() }, 'Note saved')} className="btn-secondary text-sm">Save</button>
            </div>
          </label>
          <Link to="/admin/payments" className="btn-primary text-sm inline-flex"><CreditCard size={14} /> Open Payments</Link>
        </div>
      </div>
    </div>
  );
}

// ─── Email reminders ─────────────────────────────────────
const EMAIL_TYPES = [
  ['due_dates', '📅', 'Income tax deadlines', '7 days and 1 day before 30 Nov (return) and 7 days before 30 Sep (payment) — only clients whose return is not filed yet.'],
  ['invoices', '🧾', 'Unpaid invoices', '3 days before the due date, on the due date, and 7 days late.'],
  ['documents', '📤', 'Documents needed', 'Return started but nothing uploaded after 7 and 21 days.'],
  ['reminders', '🔔', 'Your reminders', 'Reminders you add for a client or all clients — the day before.'],
  ['messages', '💬', 'Unread messages', 'When your message is unread for 24 hours (once a day).'],
];
function EmailTab() {
  const [cfg, setCfg] = useState(null);
  const [status, setStatus] = useState(null);
  const [log, setLog] = useState([]);
  const [busy, setBusy] = useState(null);
  const call = async (action) => {
    const { data, error } = await supabase.functions.invoke('reminders', { body: { action } });
    if (error) throw new Error(error.message);
    if (data?.error) throw new Error(data.error);
    return data;
  };
  const load = async () => {
    const { data } = await supabase.from('app_settings').select('value').eq('key', 'email').maybeSingle();
    setCfg({ enabled: false, from_email: '', from_name: 'TaxMate Solutions', reply_to: '', types: {}, ...(data?.value ?? {}) });
    call('status').then(setStatus).catch(() => setStatus({ provider: null }));
    const { data: l } = await supabase.from('email_log').select('*, clients(full_name)').order('created_at', { ascending: false }).limit(25);
    setLog(l ?? []);
  };
  useEffect(() => { load(); }, []);
  const save = async (patch, msg) => {
    const next = { ...cfg, ...patch };
    const { error } = await supabase.from('app_settings').upsert({ key: 'email', value: next });
    if (error) return toast.error(error.message);
    setCfg(next); if (msg) toast.success(msg);
  };
  const run = async (action) => {
    setBusy(action);
    try {
      const r = await call(action);
      toast.success(action === 'test' ? `Test email sent to ${r.to}` : `Done — ${r.sent} sent${r.failed ? `, ${r.failed} failed` : ''}${r.note ? ` (${r.note})` : ''}`);
      if (r.errors?.length) toast.error(r.errors[0]);
      load();
    } catch (e) { toast.error(e.message); }
    setBusy(null);
  };
  if (!cfg) return <div className="card p-6 text-gray-400 text-sm">Loading…</div>;
  const types = { due_dates: true, invoices: true, documents: true, reminders: true, messages: true, ...(cfg.types ?? {}) };
  const ready = status?.provider && cfg.from_email;
  return (
    <div className="grid lg:grid-cols-[1.2fr_1fr] gap-5 items-start">
      <div className="space-y-5">
        <div className="card overflow-hidden">
          <div className="card-header"><Mail size={16} /> Automatic email reminders
            {status?.provider && <span className="ml-auto text-[10px] font-bold px-2 py-0.5 rounded-full bg-emerald-100 text-emerald-700 uppercase">{status.provider} connected</span>}
          </div>
          <div className="p-5 space-y-4">
            <div className="flex items-center gap-3">
              <div className="flex-1"><div className="font-semibold text-gray-800">Send reminders every morning (8:37 am)</div>
                <p className="text-sm text-gray-500">Clients can switch emails off in their portal (Security). Max 250 emails a day.</p></div>
              <button onClick={() => save({ enabled: !cfg.enabled }, `Email reminders ${!cfg.enabled ? 'ON' : 'OFF'}`)} disabled={!ready && !cfg.enabled} role="switch" aria-checked={cfg.enabled}
                className={`relative w-14 h-8 rounded-full transition-colors flex-shrink-0 ${cfg.enabled ? 'bg-emerald-500' : 'bg-gray-300'} disabled:opacity-40`}>
                <span className={`absolute top-1 left-1 w-6 h-6 rounded-full bg-white shadow transition-transform ${cfg.enabled ? 'translate-x-6' : ''}`} />
              </button>
            </div>
            <div className="grid sm:grid-cols-2 gap-3">
              <label className="text-xs font-semibold text-gray-600">Sender email (verified in Brevo / Resend)
                <input className="input mt-1" type="email" placeholder="taxmatesolutions@gmail.com" value={cfg.from_email} onChange={e => setCfg({ ...cfg, from_email: e.target.value })} onBlur={() => save({ from_email: cfg.from_email.trim() })} />
              </label>
              <label className="text-xs font-semibold text-gray-600">Sender name
                <input className="input mt-1" value={cfg.from_name} onChange={e => setCfg({ ...cfg, from_name: e.target.value })} onBlur={() => save({ from_name: cfg.from_name.trim() })} />
              </label>
            </div>
            <div className="divide-y divide-gray-50 rounded-xl border border-gray-100">
              {EMAIL_TYPES.map(([k, e, t, d]) => (
                <label key={k} className="flex items-start gap-3 px-3 py-2.5 cursor-pointer">
                  <input type="checkbox" className="mt-1" checked={types[k] !== false} onChange={ev => save({ types: { ...types, [k]: ev.target.checked } })} />
                  <span className="text-lg">{e}</span>
                  <span className="flex-1"><span className="block text-sm font-semibold text-gray-800">{t}</span><span className="block text-xs text-gray-500">{d}</span></span>
                </label>
              ))}
            </div>
            <div className="flex gap-2 flex-wrap">
              <button onClick={() => run('test')} disabled={!ready || !!busy} className="btn-secondary text-sm">{busy === 'test' ? <RefreshCw size={14} className="animate-spin" /> : <Send size={14} />} Send me a test email</button>
              <button onClick={() => run('run')} disabled={!ready || !cfg.enabled || !!busy} className="btn-primary text-sm">{busy === 'run' ? <RefreshCw size={14} className="animate-spin" /> : <Play size={14} />} Run today's reminders now</button>
            </div>
          </div>
        </div>
        {!status?.provider && status !== null && (
          <div className="card p-5 text-sm text-amber-900 bg-amber-50 border-amber-200 space-y-2">
            <div className="font-bold">One-time setup — free (Brevo: 300 emails a day)</div>
            <ol className="list-decimal ml-4 space-y-1.5">
              <li>Create a free account at <b>brevo.com</b> and verify your sender email (Senders &amp; IP → Senders → Add a sender).</li>
              <li>Brevo → <b>SMTP &amp; API → API keys</b> → Generate a new API key.</li>
              <li>Supabase → <b>Edge Functions → Secrets</b> → add <code className="bg-white px-1 rounded">BREVO_API_KEY</code> with that key.</li>
              <li>Come back, enter the sender email above, send a test, then switch reminders ON.</li>
            </ol>
            <div className="flex gap-2 flex-wrap pt-1">
              <a href="https://app.brevo.com/settings/keys/api" target="_blank" rel="noreferrer" className="btn-secondary text-xs"><ExternalLink size={13} /> Brevo API keys</a>
              <a href="https://supabase.com/dashboard/project/qipehxixvulvrubjifvi/settings/functions" target="_blank" rel="noreferrer" className="btn-secondary text-xs"><ExternalLink size={13} /> Supabase secrets</a>
              <button onClick={load} className="btn-secondary text-xs"><RefreshCw size={13} /> Check again</button>
            </div>
          </div>
        )}
      </div>
      <div className="card overflow-hidden">
        <div className="card-header">📬 Recent emails</div>
        {log.length === 0 ? <div className="p-6 text-center text-sm text-gray-400">Nothing sent yet.</div> : (
          <div className="divide-y divide-gray-50 max-h-[520px] overflow-y-auto">
            {log.map(l => (
              <div key={l.id} className="px-4 py-2 text-xs">
                <div className="flex items-center gap-2"><span className={`font-bold ${l.status === 'sent' ? 'text-emerald-700' : 'text-red-600'}`}>{l.status === 'sent' ? '✓' : '✗'}</span>
                  <span className="font-semibold text-gray-800 truncate flex-1">{l.subject}</span><span className="text-gray-400">{fmtDate(l.created_at)}</span></div>
                <div className="text-gray-500 truncate">{l.clients?.full_name ?? l.to_email}{l.error ? ` — ${l.error}` : ''}</div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

// ─── My account ──────────────────────────────────────────
function MyAccountTab() {
  return (
    <div className="grid grid-cols-1 lg:grid-cols-2 gap-5 items-start">
      <ChangePassword />
      <div className="space-y-5">
        <PinCard required />
        <TwoFactorCard required />
      </div>
    </div>
  );
}


// ─── Client Portal: features clients can use ─────────────
export const PORTAL_FEATURES = [
  ['quick_tax', '⚡', 'Quick Tax Check', 'Simple calculator — clients type their local / foreign income and see the tax instantly.'],
  ['tax_calculator', '🧮', 'Tax Calculator (detailed)', 'Full calculator — monthly / annual, local, foreign or mixed income, with reliefs.'],
  ['tax_calendar', '📅', 'Tax Calendar & due dates', 'IRD due dates on their dashboard and a full calendar.'],
  ['ird_codes', '#️⃣', 'IRD Payment Codes', 'Clients pick a tax (APIT, VAT, SSCL, income tax…) and month and see the Tax Type Code, Payment Period Code, category and due date.'],
  ['reminders', '🔔', 'Reminders', 'Clients see your reminders and can add their own.'],
  ['documents', '🗂️', 'Document vault', 'Clients upload salary slips, bank certificates etc. and download files you share.'],
  ['return_tracker', '🚦', 'Return progress tracker', 'Clients see where their return is: Documents received → Computing → Ready to review → Filed in RAMIS.'],
  ['messages', '💬', 'Messages', 'Clients read your announcements and chat privately with TaxMate (only with you, never with other clients).'],
  ['services', '📅', 'Book a service', 'Clients request services (VAT, TIN, company return…) and pick a preferred date & time.'],
  ['summary_letters', '📄', 'Income & Tax summary letters', 'Clients request a letter for visa / bank loans; you issue it (free or with a fee).'],
  ['tax_reviews', '📈', 'Annual Tax Review', 'Clients request a yearly review report (this year vs last, how to save); you set the fee when issuing.'],
  ['plans', '👑', 'Monthly plans', 'Clients see the Basic / Standard / Premium plans and can request one.'],
  ['referrals', '🎁', 'Invite friends', 'Each client gets a personal invite link; friends who register are linked to them.'],
];

function PortalTab() {
  const [cfg, setCfg] = useState(null);
  const [reward, setReward] = useState('');
  const [overrides, setOverrides] = useState([]);

  const load = async () => {
    const [{ data: st }, { data: cl }] = await Promise.all([
      supabase.from('app_settings').select('value').eq('key', 'client_tools').maybeSingle(),
      supabase.from('clients').select('id, full_name, feature_overrides').neq('feature_overrides', '{}').order('full_name'),
    ]);
    const v = st?.value ?? {};
    setCfg(v); setReward(v.referral_reward ?? '');
    setOverrides((cl ?? []).filter(c => c.feature_overrides && Object.keys(c.feature_overrides).length));
  };
  useEffect(() => { load(); }, []);

  const saveCfg = async (patch, msg) => {
    const value = { ...cfg, ...patch };
    const { error } = await supabase.from('app_settings').upsert({ key: 'client_tools', value, updated_at: new Date().toISOString() });
    if (error) return toast.error(error.message);
    setCfg(value);
    if (msg) toast.success(msg);
  };
  const clearOverrides = async (c) => {
    const { error } = await supabase.from('clients').update({ feature_overrides: {} }).eq('id', c.id);
    if (error) return toast.error(error.message);
    load();
  };

  if (!cfg) return <div className="card p-6 text-gray-400 text-sm">Loading…</div>;
  const isOn = (k) => cfg[k] !== false;
  return (
    <div className="space-y-4">
      <div className="card divide-y divide-gray-100">
        <div className="px-5 py-3 text-sm text-gray-500">Switch features on or off for <b>all clients</b>. To change one client, open their page → Overview → <b>Portal features</b>.</div>
        {PORTAL_FEATURES.map(([k, emo, title, desc]) => (
          <div key={k} className="px-5 py-4 flex items-start gap-3">
            <div className="text-2xl w-9 text-center">{emo}</div>
            <div className="flex-1">
              <div className="font-semibold text-gray-800">{title}</div>
              <p className="text-sm text-gray-500">{desc}</p>
              {k === 'referrals' && isOn('referrals') && (
                <div className="mt-2 flex gap-2 flex-wrap">
                  <input className="input flex-1 min-w-[220px]" maxLength={160} placeholder="Reward shown to clients (optional) — e.g. Rs. 1,000 off your next return for every friend who files with us"
                    value={reward} onChange={e => setReward(e.target.value)} />
                  <button onClick={() => saveCfg({ referral_reward: reward.trim() }, 'Reward text saved')} className="btn-secondary text-sm">Save</button>
                </div>
              )}
            </div>
            <button onClick={() => saveCfg({ [k]: !isOn(k) }, `${title} ${isOn(k) ? 'OFF' : 'ON'} for clients`)} className={`relative w-12 h-6 rounded-full transition-colors flex-shrink-0 ${isOn(k) ? 'bg-green-500' : 'bg-gray-300'}`} aria-label={`Toggle ${title}`}>
              <span className={`absolute top-0.5 w-5 h-5 bg-white rounded-full shadow transition-transform ${isOn(k) ? 'translate-x-6' : 'translate-x-0.5'}`} />
            </button>
          </div>
        ))}
        <div className="px-5 py-3 text-xs text-gray-400">Monthly Income sheets and Assets &amp; Liabilities appear only when you enable them for a client.</div>
      </div>
      <div className="card">
        <div className="card-header">Clients with their own settings</div>
        {overrides.length === 0 ? <div className="p-5 text-sm text-gray-400">None — every client follows the switches above.</div> : (
          <div className="divide-y divide-gray-50">
            {overrides.map(c => (
              <div key={c.id} className="px-5 py-2.5 flex items-center gap-3 text-sm flex-wrap">
                <Link to={`/admin/clients/${c.id}`} className="flex-1 font-medium text-primary-700 hover:underline">{c.full_name}</Link>
                {Object.entries(c.feature_overrides).map(([k, v]) => (
                  <span key={k} className={`text-[11px] font-semibold px-2 py-0.5 rounded-full ${v ? 'bg-green-100 text-green-700' : 'bg-gray-100 text-gray-600'}`}>{PORTAL_FEATURES.find(f => f[0] === k)?.[2] ?? k}: {v ? 'ON' : 'OFF'}</span>
                ))}
                <button onClick={() => clearOverrides(c)} className="text-xs text-gray-500 hover:underline">Reset</button>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}


// ─── Plans (monthly subscriptions) ───────────────────────
function PlansTab() {
  const [plans, setPlans] = useState(null);
  const [busy, setBusy] = useState(false);
  useEffect(() => { loadPlans().then(p => setPlans(p.map(x => ({ ...x, featuresText: (x.features || []).join('\n') })))); }, []);
  if (!plans) return <div className="card p-8 text-center text-gray-400">Loading…</div>;
  const upd = (i, patch) => setPlans(plans.map((p, j) => (j === i ? { ...p, ...patch } : p)));
  const save = async () => {
    setBusy(true);
    try {
      const saved = await savePlans(plans.map(p => ({ ...p, features: String(p.featuresText || '').split('\n') })));
      setPlans(saved.map(x => ({ ...x, featuresText: x.features.join('\n') })));
      toast.success('Plans saved — clients see the new prices; existing plans keep their own price');
    } catch (e) { toast.error(e.message); }
    setBusy(false);
  };
  return (
    <div className="space-y-4">
      <div className="card p-4 text-sm text-gray-600">
        Monthly plans clients can request from their portal (<b>My Plan</b>). Changing a price here does not change clients already on a plan —
        edit their price on the client page. Assign plans and see monthly income under <Link to="/admin/subscriptions" className="text-primary-700 font-semibold hover:underline">Subscriptions</Link>.
      </div>
      <div className="grid md:grid-cols-2 xl:grid-cols-4 gap-4">
        {plans.map((p, i) => (
          <div key={i} className={`card overflow-hidden ${p.active === false ? 'opacity-60' : ''}`}>
            <div className={`bg-gradient-to-r ${planStyle(p.key).head} text-white px-4 py-2 flex items-center gap-2`}>
              <span className="text-xl">{planStyle(p.key).emoji}</span><b className="flex-1">{p.name || 'Plan'}</b>
              <label className="text-xs inline-flex items-center gap-1"><input type="checkbox" checked={p.active !== false} onChange={e => upd(i, { active: e.target.checked })} /> Show</label>
            </div>
            <div className="p-4 space-y-2">
              <div className="grid grid-cols-2 gap-2">
                <label className="text-[11px] font-semibold text-gray-500">Name<input className="input mt-0.5 py-1 text-sm" value={p.name} maxLength={60} onChange={e => upd(i, { name: e.target.value })} /></label>
                <label className="text-[11px] font-semibold text-gray-500">Price / month (Rs.)<input className="input mt-0.5 py-1 text-sm text-right" inputMode="numeric" value={p.price} onChange={e => upd(i, { price: e.target.value.replace(/[^\d]/g, '') })} /></label>
              </div>
              <label className="text-[11px] font-semibold text-gray-500 block">Short line<input className="input mt-0.5 py-1 text-sm" value={p.tagline || ''} maxLength={80} onChange={e => upd(i, { tagline: e.target.value })} /></label>
              <label className="text-[11px] font-semibold text-gray-500 block">What's included (one per line)<textarea className="input mt-0.5 text-sm" rows={6} value={p.featuresText || ''} onChange={e => upd(i, { featuresText: e.target.value })} /></label>
              <label className="text-xs inline-flex items-center gap-1.5"><input type="checkbox" checked={!!p.includes_review} onChange={e => upd(i, { includes_review: e.target.checked })} /> Annual Tax Review included (fee 0)</label>
              <div className="flex items-center gap-2 text-[11px] text-gray-400"><span>Code: {p.key}</span>
                {plans.length > 1 && <button onClick={() => setPlans(plans.filter((_, j) => j !== i))} className="ml-auto text-red-500 hover:underline inline-flex items-center gap-1"><Trash2 size={11} /> Remove</button>}</div>
            </div>
          </div>
        ))}
      </div>
      <div className="flex gap-2 flex-wrap">
        {plans.length < 6 && <button onClick={() => setPlans([...plans, { key: `plan${plans.length + 1}`, name: 'New plan', price: 0, active: true, includes_review: false, tagline: '', featuresText: '' }])} className="btn-secondary text-sm"><Plus size={14} /> Add plan</button>}
        <button onClick={() => setPlans(DEFAULT_PLANS.map(x => ({ ...x, featuresText: x.features.join('\n') })))} className="btn-secondary text-sm"><RotateCcw size={14} /> Suggested plans</button>
        <button onClick={save} disabled={busy} className="btn-primary text-sm ml-auto"><Save size={14} /> Save plans</button>
      </div>
    </div>
  );
}
