// ═══════════════════════════════════════════════════════════
//  TaxMate — portal-admin Edge Function
//  Creates / manages logins with the official Supabase Admin API.
//  The service-role key is provided automatically by Supabase to
//  Edge Functions and never reaches the browser.
//
//  Public actions (token based):  accept_invite, reset_password
//  Admin actions (caller must be an admin): list_users, set_role, delete_user
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
    const { data: me } = await admin.from('profiles').select('role').eq('id', caller.user.id).single();
    if (me?.role !== 'admin') return reply({ error: 'Admins only.' });
    // Two-step login: an admin who has 2FA on must have entered the code (aal2)
    let aal = 'aal1';
    try { aal = JSON.parse(atob(jwt.split('.')[1].replace(/-/g, '+').replace(/_/g, '/'))).aal ?? 'aal1'; } catch { /* keep aal1 */ }
    const has2fa = (caller.user.factors ?? []).some((f: { status: string }) => f.status === 'verified');
    if (has2fa && aal !== 'aal2') return reply({ error: 'Please sign in again with your 6-digit code.' });
    const myId = caller.user.id;

    if (action === 'list_users') {
      const { data: list, error } = await admin.auth.admin.listUsers({ page: 1, perPage: 1000 });
      if (error) return reply({ error: error.message });
      const [{ data: profiles }, { data: clients }] = await Promise.all([
        admin.from('profiles').select('id, role, full_name'),
        admin.from('clients').select('id, full_name, tin, mobile, profile_id').not('profile_id', 'is', null),
      ]);
      const users = list.users.map((u) => {
        const p = profiles?.find((x) => x.id === u.id);
        const c = clients?.find((x) => x.profile_id === u.id);
        return {
          id: u.id, email: u.email, role: p?.role ?? 'client', full_name: p?.full_name ?? '',
          created_at: u.created_at, last_sign_in_at: u.last_sign_in_at ?? null,
          client_id: c?.id ?? null, client_name: c?.full_name ?? null, client_tin: c?.tin ?? null, client_mobile: c?.mobile ?? null,
          is_me: u.id === myId,
        };
      });
      return reply({ ok: true, users });
    }

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
