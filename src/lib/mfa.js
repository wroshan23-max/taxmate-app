// ═══════════════════════════════════════════════════════════
//  Two-factor login with an authenticator app (TOTP) — free on Supabase.
//  Google Authenticator / Microsoft Authenticator / Authy show a 6-digit
//  code that changes every 30 seconds.
// ═══════════════════════════════════════════════════════════
import { supabase } from './supabase';

export async function mfaStatus() {
  const [{ data: aal }, { data: f }] = await Promise.all([
    supabase.auth.mfa.getAuthenticatorAssuranceLevel(),
    supabase.auth.mfa.listFactors(),
  ]);
  const verified = (f?.totp ?? []).filter(x => x.status === 'verified');
  return { current: aal?.currentLevel ?? 'aal1', next: aal?.nextLevel ?? 'aal1', factors: verified, all: f?.all ?? [] };
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

export const deviceName = () => {
  const ua = navigator.userAgent;
  const os = /Android/i.test(ua) ? 'Android' : /iPhone|iPad|iPod/i.test(ua) ? 'iPhone' : /Windows/i.test(ua) ? 'Windows' : /Mac OS/i.test(ua) ? 'Mac' : /Linux/i.test(ua) ? 'Linux' : 'Device';
  const br = /Edg\//.test(ua) ? 'Edge' : /OPR\//.test(ua) ? 'Opera' : /SamsungBrowser/.test(ua) ? 'Samsung' : /Chrome\//.test(ua) ? 'Chrome' : /Firefox\//.test(ua) ? 'Firefox' : /Safari\//.test(ua) ? 'Safari' : '';
  return br ? `${os} · ${br}` : os;
};
