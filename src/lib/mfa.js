// ═══════════════════════════════════════════════════════════
//  Two-factor login with an authenticator app (TOTP) — free on Supabase.
//  Google Authenticator / Microsoft Authenticator / Authy show a 6-digit
//  code that changes every 30 seconds.
// ═══════════════════════════════════════════════════════════
import { supabase } from './supabase';

export async function mfaStatus() {
  const [{ data: aal }, { data: f }, { data: sec, error: secErr }] = await Promise.all([
    supabase.auth.mfa.getAuthenticatorAssuranceLevel(),
    supabase.auth.mfa.listFactors(),
    supabase.rpc('my_login_security'),
  ]);
  const verified = (f?.totp ?? []).filter(x => x.status === 'verified');
  const current = aal?.currentLevel ?? 'aal1', next = aal?.nextLevel ?? 'aal1';
  // The database decides whether this login has passed the second step (authenticator code OR PIN)
  const s = secErr || !sec ? { pin_allowed: false, has_pin: false, pin_ok: false, second_step_ok: !(next === 'aal2' && current !== 'aal2') } : sec;
  return { current, next, factors: verified, all: f?.all ?? [], pin: s };
}

/** Start setup: returns { factorId, qr (svg data url), secret, uri } */
export async function startEnroll(label = 'Phone') {
  // clear half-finished setups first (Supabase refuses duplicates)
  const { data: f } = await supabase.auth.mfa.listFactors();
  for (const x of (f?.all ?? []).filter(x => x.status !== 'verified')) await supabase.auth.mfa.unenroll({ factorId: x.id });
  const { data, error } = await supabase.auth.mfa.enroll({
    factorType: 'totp', issuer: 'TaxMate Solutions',
    friendlyName: `${label} · ${new Date().toLocaleDateString('en-GB')} ${Math.random().toString(36).slice(2, 6)}`,
  });
  if (error) throw error;
  return { factorId: data.id, qr: data.totp.qr_code, secret: data.totp.secret, uri: data.totp.uri };
}

export async function verifyCode(factorId, code) {
  const clean = String(code).replace(/\D/g, '');
  if (clean.length !== 6) throw new Error('Enter the 6-digit code');
  const { error } = await supabase.auth.mfa.challengeAndVerify({ factorId, code: clean });
  if (error) throw new Error(/invalid|expired/i.test(error.message) ? 'Wrong or expired code — try the newest code in the app' : error.message);
}

export async function removeFactor(factorId) {
  const { error } = await supabase.auth.mfa.unenroll({ factorId });
  if (error) throw error;
  await supabase.auth.refreshSession();
}

// ── Fixed login PIN (6 digits, admin can switch the option on/off) ──
export async function setPin(pin) {
  const { error } = await supabase.rpc('set_my_pin', { p_pin: String(pin) });
  if (error) throw new Error(error.message);
}
/** Returns { ok, left, lockedUntil, error } */
export async function verifyPin(pin) {
  const { data, error } = await supabase.rpc('verify_my_pin', { p_pin: String(pin) });
  if (error) return { ok: false, error: error.message };
  return { ok: !!data?.ok, left: data?.left, lockedUntil: data?.locked_until, error: data?.error };
}
export async function removePin() {
  const { error } = await supabase.rpc('remove_my_pin');
  if (error) throw new Error(error.message);
}
export const lockText = (iso) => {
  const m = Math.max(1, Math.ceil((new Date(iso) - Date.now()) / 60000));
  return m >= 60 ? `${Math.ceil(m / 60)} hour${m >= 120 ? 's' : ''}` : `${m} minute${m === 1 ? '' : 's'}`;
};

export const deviceName = () => {
  const ua = navigator.userAgent;
  const os = /Android/i.test(ua) ? 'Android' : /iPhone|iPad|iPod/i.test(ua) ? 'iPhone' : /Windows/i.test(ua) ? 'Windows' : /Mac OS/i.test(ua) ? 'Mac' : /Linux/i.test(ua) ? 'Linux' : 'Device';
  const br = /Edg\//.test(ua) ? 'Edge' : /OPR\//.test(ua) ? 'Opera' : /SamsungBrowser/.test(ua) ? 'Samsung' : /Chrome\//.test(ua) ? 'Chrome' : /Firefox\//.test(ua) ? 'Firefox' : /Safari\//.test(ua) ? 'Safari' : '';
  return br ? `${os} · ${br}` : os;
};
