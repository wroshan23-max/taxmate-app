import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { supabase, VIEW_AS, FAMILY_AS, exitViewAs } from '../lib/supabase';
import { unlinkPush } from '../lib/push';
import { mfaStatus } from '../lib/mfa';

const AuthContext = createContext({});

const NO_PIN = { pin_allowed: false, has_pin: false, pin_ok: false, second_step_ok: true };
const NO_MFA = { current: 'aal1', next: 'aal1', factors: [], pin: NO_PIN, loaded: false };

export function AuthProvider({ children }) {
  const [user, setUser] = useState(null);
  const [profile, setProfile] = useState(null);
  const [loading, setLoading] = useState(true);
  // Two-factor state: needsCode = password done, authenticator code still required
  const [mfa, setMfa] = useState(NO_MFA);

  const refreshMfa = useCallback(async () => {
    try { const s = await mfaStatus(); setMfa({ ...s, loaded: true }); return s; }
    catch { setMfa({ ...NO_MFA, loaded: true }); return NO_MFA; }
  }, []);

  useEffect(() => {
    supabase.auth.getSession().then(async ({ data: { session } }) => {
      setUser(session?.user ?? null);
      // two-step status and profile load at the same time (faster start on phones)
      if (session?.user) await Promise.all([refreshMfa(), fetchProfile(session.user.id)]);
      else setLoading(false);
    });

    const { data: listener } = supabase.auth.onAuthStateChange((event, session) => {
      setUser(session?.user ?? null);
      if (event === 'INITIAL_SESSION') return;   // already handled by getSession() above
      if (session?.user) {
        // run outside the auth callback (Supabase recommends not awaiting inside it)
        setTimeout(async () => {
          await refreshMfa();
          if (event === 'SIGNED_IN' || event === 'MFA_CHALLENGE_VERIFIED' || event === 'USER_UPDATED') fetchProfile(session.user.id);
        }, 0);
      } else { setProfile(null); setMfa(NO_MFA); setLoading(false); }
    });

    return () => listener.subscription.unsubscribe();
  }, [refreshMfa]);

  const fetchProfile = async (userId) => {
    const { data } = await supabase
      .from('profiles')
      .select('*')
      .eq('id', userId)
      .single();
    let p = data;
    if (VIEW_AS && data && data.role !== 'admin') {
      // only admins can preview — anyone else just gets their own portal
      try { sessionStorage.removeItem('tm_view_as'); } catch { /* ignore */ }
      window.location.replace(window.location.pathname);
      return;
    }
    if (p?.role === 'admin' && VIEW_AS) {
      // V53 preview: the admin sees the portal as this client (read only; the database checks it is a real admin)
      const { data: c } = await supabase.from('clients').select('id, profile_id, full_name, email, client_no').eq('id', VIEW_AS).maybeSingle();
      p = c?.profile_id
        ? { id: c.profile_id, role: 'client', full_name: c.full_name, email: c.email, client_id: c.id, client_no: c.client_no, viewAs: true, adminName: p.full_name }
        : { ...p, viewAsError: c ? 'This client has no portal login yet.' : 'Client not found.' };
    } else if (p?.role === 'client' && FAMILY_AS) {
      // V55: the main applicant is managing a family member in this tab (the database checks the link)
      const [{ data: m }, { data: fam }] = await Promise.all([
        supabase.from('clients').select('id, full_name, email, client_no').eq('id', FAMILY_AS).maybeSingle(),
        supabase.rpc('my_family'),
      ]);
      const link = fam?.members?.find(x => x.id === m?.id);
      if (!m || !link) {   // not (or no longer) this person's family member → back to own account
        try { sessionStorage.removeItem('tm_family'); } catch { /* ignore */ }
        window.location.replace('/client');
        return;
      }
      p = { ...p, own_client_id: fam.me?.id ?? null, client_id: m.id, full_name: m.full_name, email: m.email, client_no: m.client_no,
            family: { memberId: m.id, relation: link.relation, headName: fam.me?.full_name || p.full_name } };
    } else if (p?.role === 'client') {
      const { data: c } = await supabase.from('clients').select('id, client_no').eq('profile_id', userId).maybeSingle();
      p = { ...p, client_id: c?.id ?? null, own_client_id: c?.id ?? null, client_no: c?.client_no ?? p.client_no };
    }
    setProfile(p);
    setLoading(false);
  };

  const signIn = (email, password) =>
    supabase.auth.signInWithPassword({ email, password });

  // in a preview tab, "Sign out" only leaves the preview (the admin stays signed in)
  const signOut = () => {
    if (VIEW_AS) return Promise.resolve(exitViewAs());
    try { sessionStorage.removeItem('tm_family'); } catch { /* ignore */ }
    return unlinkPush().finally(() => supabase.auth.signOut());
  };

  const viewAs = !!profile?.viewAs;
  // the client pages look a client up by user.id — in a preview that is the client's login id
  const shownUser = useMemo(() => (viewAs && user ? { ...user, id: profile.id, email: profile.email ?? user.email } : user),
    [viewAs, user, profile?.id, profile?.email]); // eslint-disable-line react-hooks/exhaustive-deps
  const isAdmin = profile?.role === 'admin';
  const isClient = profile?.role === 'client';
  // Second step still needed (authenticator code or PIN) — decided by the database
  const needsCode = !!user && mfa.loaded && mfa.pin?.second_step_ok === false;
  const hasPin = !!(mfa.pin?.pin_allowed && mfa.pin?.has_pin);
  const has2fa = mfa.factors.length > 0 || hasPin;

  return (
    <AuthContext.Provider value={{ user: shownUser, realUser: user, viewAs, profile, loading, isAdmin, isClient, signIn, signOut, mfa, refreshMfa, needsCode, has2fa, hasPin }}>
      {children}
    </AuthContext.Provider>
  );
}

export const useAuth = () => useContext(AuthContext);
