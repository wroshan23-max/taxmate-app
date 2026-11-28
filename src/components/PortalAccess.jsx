import { useEffect, useState } from 'react';
import toast from 'react-hot-toast';
import { KeyRound, ShieldCheck, Clock, UserX, XCircle, Globe, Link2, LockKeyhole } from 'lucide-react';
import { supabase, fmtDate } from '../lib/supabase';
import { useAuth } from '../contexts/AuthContext';
import { callPortal, inviteUrl, resetUrl, inviteMessage, resetMessage, tempLoginMessage } from '../lib/portal';
import { logActivity } from '../lib/activity';
import MessageMenu from './MessageMenu';
import { recipientsOf } from '../lib/contacts';

/**
 * Client portal access for one client: invite → active login → reset / remove.
 * client: clients row (id, full_name, email, mobile, profile_id); onChange(): reload the client
 */
export default function PortalAccess({ client, onChange }) {
  const { user } = useAuth();
  const [login, setLogin]     = useState(null);   // profiles row of the linked login
  const [invites, setInvites] = useState([]);
  const [loading, setLoading] = useState(true);
  // V86: how the client signs in the first time — 'link' (creates own password) or 'temp' (one-time password)
  const [method, setMethod] = useState(() => { try { return localStorage.getItem('tm_invite_method') || 'link'; } catch { return 'link'; } });
  const pickMethod = (m) => { setMethod(m); try { localStorage.setItem('tm_invite_method', m); } catch { /* private mode */ } };

  const load = async () => {
    const [{ data: inv }, prof] = await Promise.all([
      supabase.from('portal_invites').select('*').eq('client_id', client.id).order('created_at', { ascending: false }),
      client.profile_id ? supabase.from('profiles').select('id, email, full_name, role').eq('id', client.profile_id).maybeSingle() : Promise.resolve({ data: null }),
    ]);
    setInvites(inv ?? []);
    setLogin(prof.data ?? null);
    setLoading(false);
  };
  useEffect(() => { load(); }, [client.id, client.profile_id]); // eslint-disable-line react-hooks/exhaustive-deps

  const now = new Date();
  const pending = invites.find(i => !i.accepted_at && !i.revoked_at && new Date(i.expires_at) > now);

  // Create a fresh invite (older open ones are cancelled) and return the message text
  const newInviteText = async () => {
    if (!client.email) throw new Error("Add the client's email first (Edit → Email). It becomes their sign-in name.");
    await supabase.from('portal_invites').update({ revoked_at: new Date().toISOString() })
      .eq('client_id', client.id).is('accepted_at', null).is('revoked_at', null);
    const { data, error } = await supabase.from('portal_invites')
      .insert({ email: client.email.trim().toLowerCase(), full_name: client.full_name, client_id: client.id, role: 'client', created_by: user.id })
      .select('token').single();
    if (error) throw error;
    load();
    return inviteMessage({ name: client.full_name, url: inviteUrl(data.token) });
  };

  const resendText = async () => inviteMessage({ name: client.full_name, url: inviteUrl(pending.token) });

  // V86: create the login now with a one-time password (Edge Function) and return the message
  const tempLoginText = async () => {
    if (!client.email) throw new Error("Add the client's email first (Edit → Email). It becomes their sign-in name.");
    const r = await callPortal('create_temp_login', { client_id: client.id });
    logActivity('share', undefined, `portal one-time password (new login) — ${client.full_name}`);
    toast.success('Login created — send the message now (the password is shown only once)', { duration: 6000 });
    setTimeout(() => onChange?.(), 1500);
    return tempLoginMessage({ name: client.full_name, email: r.email, password: r.password });
  };
  const tempResetText = async () => {
    const r = await callPortal('reset_temp_password', { client_id: client.id });
    logActivity('share', undefined, `portal one-time password (reset) — ${client.full_name}`);
    return tempLoginMessage({ name: client.full_name, email: r.email, password: r.password, reset: true });
  };
  const methodPicker = (
    <div className="grid gap-2 sm:grid-cols-2" role="radiogroup" aria-label="How the client signs in the first time">
      {[['link', Link2, 'Invite link', 'Client opens the link and creates their own password (valid 14 days).'],
        ['temp', LockKeyhole, 'Link + one-time password', 'Login is ready now. At the first sign-in the client sets a new password or keeps this one.']].map(([k, I, t, d]) => (
        <button key={k} type="button" role="radio" aria-checked={method === k} onClick={() => pickMethod(k)}
          className={`flex items-start gap-2 rounded-xl border-2 p-2.5 text-left ${method === k ? 'border-primary-500 bg-primary-50' : 'border-gray-200 hover:border-gray-300'}`}>
          <I size={16} className={`mt-0.5 flex-shrink-0 ${method === k ? 'text-primary-700' : 'text-gray-400'}`} />
          <span><b className="block text-xs text-gray-800">{t}</b><span className="text-[11px] leading-tight text-gray-500">{d}</span></span>
        </button>
      ))}
    </div>
  );

  const cancelInvite = async () => {
    if (!window.confirm('Cancel this invitation? The link will stop working.')) return;
    const { error } = await supabase.from('portal_invites').update({ revoked_at: new Date().toISOString() }).eq('id', pending.id);
    if (error) return toast.error(error.message);
    toast.success('Invitation cancelled');
    load();
  };

  const resetText = async () => {
    const { data, error } = await supabase.from('password_resets').insert({ user_id: client.profile_id, created_by: user.id }).select('token').single();
    if (error) throw error;
    return resetMessage({ name: client.full_name, url: resetUrl(data.token) });
  };

  const removeAccess = async () => {
    if (!window.confirm(`Remove portal access for ${client.full_name}? Their login is deleted; their tax records stay. You can invite them again later.`)) return;
    try {
      await callPortal('delete_user', { user_id: client.profile_id });
      toast.success('Portal access removed');
      onChange?.();
    } catch (e) { toast.error(e.message); }
  };

  return (
    <div className="card p-5">
      <div className="flex items-center gap-2 mb-3">
        <Globe size={16} className="text-primary-600" />
        <h3 className="font-semibold text-primary-800">Client Portal Access</h3>
        {!loading && (
          client.profile_id
            ? <span className="ml-auto text-xs font-semibold px-2 py-0.5 rounded-full bg-green-100 text-green-700 flex items-center gap-1"><ShieldCheck size={12} /> Active</span>
            : pending
              ? <span className="ml-auto text-xs font-semibold px-2 py-0.5 rounded-full bg-amber-100 text-amber-800 flex items-center gap-1"><Clock size={12} /> Invited</span>
              : <span className="ml-auto text-xs font-semibold px-2 py-0.5 rounded-full bg-gray-100 text-gray-500">No access</span>
        )}
      </div>

      {loading ? <div className="text-sm text-gray-400">Loading…</div> : client.profile_id ? (
        <div className="space-y-3">
          <p className="text-sm text-gray-600">
            Signs in as <strong>{login?.email ?? '—'}</strong>. They see calculations you put on the portal, their tax returns and invoices.
            {login?.role === 'admin' && <span className="block text-amber-700 text-xs mt-1">⚠️ This login has the admin role.</span>}
          </p>
          <div className="flex gap-2 flex-wrap">
            <MessageMenu label="Send password reset link" phone={client.mobile} email={client.email} recipients={recipientsOf(client)}
              subject={`Reset your portal password — ${client.full_name}`} getText={resetText} />
            {login?.role !== 'admin' && <MessageMenu label="Send new one-time password" phone={client.mobile} email={client.email} recipients={recipientsOf(client)}
              subject={`Your TaxMate portal — new one-time password`} getText={tempResetText} />}
            <button onClick={removeAccess} className="btn-secondary text-sm text-red-600 border-red-200"><UserX size={14} /> Remove access</button>
          </div>
        </div>
      ) : pending ? (
        <div className="space-y-3">
          <p className="text-sm text-gray-600">
            Invitation sent to <strong>{pending.email}</strong> on {fmtDate(pending.created_at)} · link valid until {fmtDate(pending.expires_at)}.
            The client opens the link and creates their own password.
          </p>
          <div className="flex gap-2 flex-wrap">
            <MessageMenu label="Send invite again" phone={client.mobile} email={pending.email} recipients={recipientsOf(client, { email: pending.email })}
              subject="Your TaxMate client portal" getText={resendText} />
            <MessageMenu label="Send a one-time password instead" phone={client.mobile} email={pending.email} recipients={recipientsOf(client, { email: pending.email })}
              subject="Your TaxMate client portal" getText={tempLoginText} />
            <button onClick={cancelInvite} className="btn-secondary text-sm"><XCircle size={14} /> Cancel invite</button>
          </div>
        </div>
      ) : (
        <div className="space-y-3">
          <p className="text-sm text-gray-600">
            Invite {client.full_name?.split(' ').slice(-1)[0] || 'the client'} to the portal by WhatsApp or email. They can then see and confirm their tax calculations. Choose how they sign in the first time:
          </p>
          {methodPicker}
          {!client.email && <p className="text-xs text-amber-700 bg-amber-50 border border-amber-200 rounded p-2">Add the client's email first (Edit at the top). It becomes their sign-in name.</p>}
          <MessageMenu label={method === 'temp' ? 'Create login & send one-time password' : 'Invite to portal'} phone={client.mobile} email={client.email} recipients={recipientsOf(client)}
            subject="Your TaxMate client portal" getText={method === 'temp' ? tempLoginText : newInviteText} />
          {method === 'temp' && <p className="text-[11px] text-gray-500">The password is made by the server and shown only in this message — TaxMate does not keep it. Send it straight away; if it is lost, use "Send new one-time password".</p>}
        </div>
      )}
      <p className="text-[11px] text-gray-400 mt-3 flex items-center gap-1"><KeyRound size={11} /> Links are private — send them only to the client.</p>
    </div>
  );
}
