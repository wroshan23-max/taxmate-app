import { createContext, useCallback, useContext, useEffect, useState } from 'react';
import { supabase } from '../lib/supabase';
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
      if (session?.user) { await refreshMfa(); fetchProfile(session.user.id); }
      else setLoading(false);
    });

    const { data: listener } = supabase.auth.onAuthStateChange((event, session) => {
      setUser(session?.user ?? null);
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
    setProfile(data);
    setLoading(false);
  };

  const signIn = (email, password) =>
    supabase.auth.signInWithPassword({ email, password });

  const signOut = () => supabase.auth.signOut();

  const isAdmin = profile?.role === 'admin';
  const isClient = profile?.role === 'client';
  // Second step still needed (authenticator code or PIN) — decided by the database
  const needsCode = !!user && mfa.loaded && mfa.pin?.second_step_ok === false;
  const hasPin = !!(mfa.pin?.pin_allowed && mfa.pin?.has_pin);
  const has2fa = mfa.factors.length > 0 || hasPin;

  return (
    <AuthContext.Provider value={{ user, profile, loading, isAdmin, isClient, signIn, signOut, mfa, refreshMfa, needsCode, has2fa, hasPin }}>
      {children}
    </AuthContext.Provider>
  );
}

export const useAuth = () => useContext(AuthContext);
