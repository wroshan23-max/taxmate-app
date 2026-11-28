// ═══════════════════════════════════════════════════════════
//  TaxMate — portal-admin Edge Function
//  Creates / manages logins with the official Supabase Admin API.
//  The service-role key is provided automatically by Supabase to
//  Edge Functions and never reaches the browser.
//
//  Public actions (token based):  accept_invite, reset_password
//  Admin actions (caller must be an admin): list_users, set_role, delete_user
//  V70: set_role / delete_user need a full admin (not staff)
//  V86: create_temp_login / reset_temp_password — client login with a one-time (temporary) password;
//       the client chooses at the first sign-in to set a new password or keep it (profiles.temp_password_at)
// ═══════════════════════════════════════════════════════════
import { createClient } from 'npm:@supabase/supabase-js@2.49.4';

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};
// Always 200 so the app can show our message; failures carry { error }
const reply = (body: unknown) => new Response(JSON.stringify(body), { headers: { ...cors, 'Content-Type': 'application/json' } });
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// V86: readable random password, e.g. "Kx7m-Q4tz-9Wpe" (no 0/O, 1/l/I); crypto-strong, ~70 bits
function tempPassword(): string {
  const A = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789';
  const groups: string[] = [];
  for (let g = 0; g < 3; g++) {
    const b = crypto.getRandomValues(new Uint32Array(4));
    let x = '';
    for (const v of b) x += A[v % A.length];
    groups.push(x);
  }
  // make sure it has a digit, an upper and a lower case letter (some password policies require them)
  const p = groups.join('-');
  return /\d/.test(p) && /[A-Z]/.test(p) && /[a-z]/.test(p) ? p : tempPassword();
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors });
  if (req.method !== 'POST') return reply({ error: 'POST only' });

  const admin = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  try {
    const body = await req.json();
    const action = String(body?.action ?? '');

    // ── Public: client sets a password from an invite link ──
    if (action === 'accept_invite') {
      const { token, password } = body;
      if (!UUID_RE.test(token ?? '')) return reply({ error: 'This invitation link is not valid.' });
      if (typeof password !== 'string' || password.length < 8) return reply({ error: 'Password must be at least 8 characters.' });

      const { data: inv } = await admin.from('portal_invites').select('*').eq('token', token).maybeSingle();
      if (!inv || inv.revoked_at) return reply({ error: 'This invitation link is not valid.' });
      if (inv.accepted_at) return reply({ error: 'This invitation was already used. Please sign in.' });
      if (new Date(inv.expires_at) < new Date()) return reply({ error: 'This invitation has expired. Please ask TaxMate for a new link.' });

      let fullName = inv.full_name;
      if (inv.client_id) {
        const { data: c } = await admin.from('clients').select('full_name, profile_id').eq('id', inv.client_id).single();
        if (c?.profile_id) return reply({ error: 'This client already has a portal login. Please sign in.' });
        fullName = c?.full_name ?? fullName;
      }

      const email = String(inv.email).trim().toLowerCase();
      const { data: created, error } = await admin.auth.admin.createUser({
        email, password, email_confirm: true, user_metadata: { full_name: fullName ?? email },
      });
      if (error || !created?.user) {
        const exists = /already|registered|exists/i.test(error?.message ?? '');
        return reply({ error: exists ? 'An account with this email already exists. Please sign in.' : (error?.message ?? 'Could not create the login.') });
      }
      const uid = created.user.id;

      // profile row is created as 'client' by the database trigger
      const patch: Record<string, unknown> = { full_name: fullName ?? email };
      if (inv.role === 'admin') patch.role = 'admin';
      await admin.from('profiles').update(patch).eq('id', uid);
      if (inv.client_id) await admin.from('clients').update({ profile_id: uid }).eq('id', inv.client_id);
      await admin.from('portal_invites').update({ accepted_at: new Date().toISOString(), accepted_user_id: uid }).eq('id', inv.id);
      return reply({ ok: true, email, role: inv.role });
    }

    // ── Public: set a new password from a reset link ──
    if (action === 'reset_password') {
      const { token, password } = body;
      if (!UUID_RE.test(token ?? '')) return reply({ error: 'This reset link is not valid.' });
      if (typeof password !== 'string' || password.length < 8) return reply({ error: 'Password must be at least 8 characters.' });
      const { data: r } = await admin.from('password_resets').select('*').eq('token', token).maybeSingle();
      if (!r) return reply({ error: 'This reset link is not valid.' });
      if (r.used_at) return reply({ error: 'This reset link was already used.' });
      if (new Date(r.expires_at) < new Date()) return reply({ error: 'This reset link has expired. Please ask TaxMate for a new one.' });

      const { data: u, error } = await admin.auth.admin.updateUserById(r.user_id, { password });
      if (error) return reply({ error: error.message });
      await admin.from('password_resets').update({ used_at: new Date().toISOString() }).eq('user_id', r.user_id).is('used_at', null);
      return reply({ ok: true, email: u.user?.email });
    }

    // ── Everything below: caller must be a signed-in admin ──
    const jwt = (req.headers.get('Authorization') ?? '').replace(/^Bearer\s+/i, '');
    const { data: caller } = await admin.auth.getUser(jwt);
    if (!caller?.user) return reply({ error: 'Please sign in again.' });
    const { data: me } = await admin.from('profiles').select('*').eq('id', caller.user.id).single();
    if (me?.role !== 'admin') return reply({ error: 'Admins only.' });
    // V70: staff (limited admins) cannot change anyone's access or delete logins
    const isOwner = me?.staff_level !== 'staff';
    // Two-step login: an admin with an authenticator app or login PIN must have completed that step
    // (the database decides: my_second_step_ok() runs as the caller)
    const asCaller = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_ANON_KEY')!, {
      global: { headers: { Authorization: `Bearer ${jwt}` } }, auth: { persistSession: false, autoRefreshToken: false },
    });
    const { data: stepOk } = await asCaller.rpc('my_second_step_ok');
    if (stepOk !== true) return reply({ error: 'Please sign in again with your PIN or 6-digit code.' });
    const myId = caller.user.id;

    if (action === 'list_users') {
      const { data: list, error } = await admin.auth.admin.listUsers({ page: 1, perPage: 1000 });
      if (error) return reply({ error: error.message });
      const [{ data: profiles }, { data: clients }] = await Promise.all([
        admin.from('profiles').select('*'),
        admin.from('clients').select('id, full_name, tin, mobile, profile_id').not('profile_id', 'is', null),
      ]);
      const users = list.users.map((u) => {
        const p = profiles?.find((x) => x.id === u.id);
        const c = clients?.find((x) => x.profile_id === u.id);
        return {
          id: u.id, email: u.email, role: p?.role ?? 'client', full_name: p?.full_name ?? '', staff: p?.staff_level === 'staff',
          created_at: u.created_at, last_sign_in_at: u.last_sign_in_at ?? null,
          client_id: c?.id ?? null, client_name: c?.full_name ?? null, client_tin: c?.tin ?? null, client_mobile: c?.mobile ?? null,
          is_me: u.id === myId,
        };
      });
      return reply({ ok: true, users });
    }

    // ── V86: client login with a one-time password (any admin, like sending an invite) ──
    if (action === 'create_temp_login' || action === 'reset_temp_password') {
      const { client_id } = body;
      if (!UUID_RE.test(client_id ?? '')) return reply({ error: 'Invalid request.' });
      const { error: colErr } = await admin.from('profiles').select('temp_password_at').limit(1);
      if (colErr) return reply({ error: 'Run the V86 script (temporary password) in Supabase first.' });
      const { data: c } = await admin.from('clients').select('id, full_name, email, profile_id').eq('id', client_id).maybeSingle();
      if (!c) return reply({ error: 'Client not found.' });
      const password = tempPassword();
      const now = new Date().toISOString();

      if (action === 'create_temp_login') {
        if (c.profile_id) return reply({ error: 'This client already has a portal login — send a new one-time password instead.' });
        const email = String(c.email ?? '').trim().toLowerCase();
        if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return reply({ error: "Add the client's email first (Edit → Email). It becomes their sign-in name." });
        const { data: created, error } = await admin.auth.admin.createUser({ email, password, email_confirm: true, user_metadata: { full_name: c.full_name ?? email } });
        if (error || !created?.user) {
          const exists = /already|registered|exists/i.test(error?.message ?? '');
          return reply({ error: exists ? 'A login with this email already exists. Link it in Settings → Users, or use a different email.' : (error?.message ?? 'Could not create the login.') });
        }
        const uid = created.user.id;
        await admin.from('profiles').update({ full_name: c.full_name ?? email, temp_password_at: now }).eq('id', uid);
        await admin.from('clients').update({ profile_id: uid }).eq('id', c.id);
        await admin.from('portal_invites').update({ revoked_at: now }).eq('client_id', c.id).is('accepted_at', null).is('revoked_at', null);
        await admin.from('portal_invites').insert({ email, full_name: c.full_name, client_id: c.id, role: 'client', created_by: myId, accepted_at: now, accepted_user_id: uid, method: 'temp_password' });
        return reply({ ok: true, email, password });
      }

      // reset_temp_password: only for a client login (never an admin's)
      if (!c.profile_id) return reply({ error: 'This client has no portal login yet — invite them first.' });
      const { data: prof } = await admin.from('profiles').select('role').eq('id', c.profile_id).maybeSingle();
      if (prof?.role !== 'client') return reply({ error: 'This login is not a client login.' });
      const { data: u, error } = await admin.auth.admin.updateUserById(c.profile_id, { password });
      if (error) return reply({ error: error.message });
      await admin.from('profiles').update({ temp_password_at: now }).eq('id', c.profile_id);
      await admin.from('password_resets').update({ used_at: now }).eq('user_id', c.profile_id).is('used_at', null);
      return reply({ ok: true, email: u.user?.email, password });
    }

    if ((action === 'set_role' || action === 'delete_user') && !isOwner) return reply({ error: 'Only a full admin can change access or remove logins.' });

    if (action === 'set_role') {
      const { user_id, role } = body;
      if (!UUID_RE.test(user_id ?? '') || !['admin', 'client'].includes(role)) return reply({ error: 'Invalid request.' });
      if (user_id === myId) return reply({ error: 'You cannot change your own role.' });
      const { error } = await admin.from('profiles').update({ role }).eq('id', user_id);
      return reply(error ? { error: error.message } : { ok: true });
    }

    if (action === 'delete_user') {
      const { user_id } = body;
      if (!UUID_RE.test(user_id ?? '')) return reply({ error: 'Invalid request.' });
      if (user_id === myId) return reply({ error: 'You cannot remove your own login.' });
      await admin.from('clients').update({ profile_id: null }).eq('profile_id', user_id);
      const { error } = await admin.auth.admin.deleteUser(user_id);
      return reply(error ? { error: error.message } : { ok: true });
    }

    return reply({ error: 'Unknown action.' });
  } catch (e) {
    return reply({ error: (e as Error).message ?? 'Unexpected error' });
  }
});
