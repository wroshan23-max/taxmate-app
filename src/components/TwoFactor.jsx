import { useEffect, useRef, useState } from 'react';
import toast from 'react-hot-toast';
import { ShieldCheck, ShieldAlert, Smartphone, Copy, Loader2, Trash2, KeyRound, LogOut, CheckCircle2, Plus } from 'lucide-react';
import { useAuth } from '../contexts/AuthContext';
import { startEnroll, verifyCode, removeFactor } from '../lib/mfa';
import { logActivity } from '../lib/activity';

/** Six separate boxes for the code; works with typing, paste and phone autofill. */
export function CodeInput({ value, onChange, onComplete, autoFocus = true, disabled }) {
  const refs = useRef([]);
  useEffect(() => { if (autoFocus) refs.current[0]?.focus(); }, [autoFocus]);
  const commit = (nv, focusAt) => {
    nv = nv.replace(/\D/g, '').slice(0, 6);
    onChange(nv);
    refs.current[Math.min(focusAt ?? nv.length, 5)]?.focus();
    if (nv.length === 6) onComplete?.(nv);
  };
  return (
    <div className="flex gap-2 justify-center" onPaste={e => {
      const t = e.clipboardData.getData('text').replace(/\D/g, '').slice(0, 6);
      if (t) { e.preventDefault(); commit(t); }
    }}>
      {Array.from({ length: 6 }, (_, i) => (
        <input key={i} ref={el => (refs.current[i] = el)} disabled={disabled}
          inputMode="numeric" autoComplete={i === 0 ? 'one-time-code' : 'off'} value={value[i] ?? ''}
          aria-label={`Digit ${i + 1}`}
          className="w-11 h-14 sm:w-12 text-center text-2xl font-black text-primary-800 rounded-xl border-2 border-gray-200 focus:border-primary-500 focus:ring-4 focus:ring-primary-100 outline-none transition-all bg-white"
          onFocus={e => e.target.select()}
          onChange={e => {
            const prev = value[i] ?? '';
            let v = e.target.value.replace(/\D/g, '');
            if (!v) return commit(value.slice(0, i) + value.slice(i + 1), i);
            if (prev && v.length === 2) v = v.startsWith(prev) ? v.slice(1) : v.slice(0, 1);
            if (v.length > 1) return commit(value.slice(0, i) + v);          // autofill / paste into one box
            const pos = Math.min(i, value.length);
            commit(value.slice(0, pos) + v + value.slice(pos + 1), pos + 1);
          }}
          onKeyDown={e => {
            if (e.key === 'Backspace' && !value[i] && i > 0) { e.preventDefault(); commit(value.slice(0, i - 1) + value.slice(i), i - 1); }
            if (e.key === 'ArrowLeft' && i > 0) refs.current[i - 1]?.focus();
            if (e.key === 'ArrowRight' && i < 5) refs.current[i + 1]?.focus();
          }} />
      ))}
    </div>
  );
}

/** Turn on / manage 2FA. Used in admin Settings → My Account and client Profile. */
export function TwoFactorCard({ required = false, onDone }) {
  const { mfa, refreshMfa, needsCode } = useAuth();
  const [setup, setSetup] = useState(null);   // { factorId, qr, secret }
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);
  const [removing, setRemoving] = useState(null);
  const on = mfa.factors.length > 0;

  const begin = async () => {
    setBusy(true);
    try { setSetup(await startEnroll(navigator.userAgent.includes('Mobile') ? 'Phone' : 'Authenticator')); setCode(''); }
    catch (e) { toast.error(e.message); }
    setBusy(false);
  };
  const finish = async (c = code) => {
    if (busy) return;
    setBusy(true);
    try {
      await verifyCode(setup.factorId, c);
      await refreshMfa();
      toast.success('Two-step login is ON 🔐');
      logActivity('submit', '/security', '2FA turned on');
      setSetup(null); setCode('');
      onDone?.();
    } catch (e) { toast.error(e.message); setCode(''); }
    setBusy(false);
  };
  const remove = async (f) => {
    if (needsCode) return toast.error('Sign in with your code first');
    setBusy(true);
    try { await removeFactor(f.id); await refreshMfa(); toast.success('Authenticator removed'); setRemoving(null); }
    catch (e) { toast.error(/aal2|assurance/i.test(e.message) ? 'For safety, sign out and sign in again with your code, then remove it.' : e.message); }
    setBusy(false);
  };

  return (
    <div className="card overflow-hidden">
      <div className={`px-5 py-4 flex items-start gap-3 ${on ? 'bg-gradient-to-r from-emerald-50 to-white' : 'bg-gradient-to-r from-amber-50 to-white'}`}>
        <div className={`w-11 h-11 rounded-2xl flex items-center justify-center flex-shrink-0 ${on ? 'bg-emerald-500 text-white' : 'bg-amber-400 text-white'}`}>
          {on ? <ShieldCheck size={22} /> : <ShieldAlert size={22} />}
        </div>
        <div className="flex-1">
          <div className="font-bold text-gray-800">Two-step login (2FA) {on ? <span className="text-emerald-600">· ON</span> : <span className="text-amber-600">· OFF</span>}</div>
          <p className="text-sm text-gray-500">{on
            ? 'When you sign in, we also ask for the 6-digit code from your authenticator app.'
            : required ? 'Admin accounts must use two-step login. It takes 1 minute.' : 'Protect your tax information: after your password, enter a 6-digit code from a free app on your phone.'}</p>
          <p className="text-xs text-gray-400 mt-0.5">දෙපියවර පිවිසුම — Password එකට අමතරව phone එකේ app එකෙන් එන code එක.</p>
        </div>
      </div>

      <div className="p-5 space-y-4">
        {on && (
          <div className="space-y-2">
            {mfa.factors.map(f => (
              <div key={f.id} className="flex items-center gap-3 rounded-xl border border-gray-100 bg-gray-50 px-3 py-2.5">
                <Smartphone size={18} className="text-primary-600" />
                <div className="flex-1 min-w-0">
                  <div className="text-sm font-semibold text-gray-800 truncate">{(f.friendly_name || 'Authenticator').split(' · ')[0]}</div>
                  <div className="text-[11px] text-gray-400">Added {new Date(f.created_at).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })}</div>
                </div>
                {removing === f.id ? (
                  <div className="flex items-center gap-1.5">
                    <span className="text-xs text-red-600 hidden sm:inline">Remove?</span>
                    <button onClick={() => remove(f)} disabled={busy || (required && mfa.factors.length === 1)} className="text-xs font-bold text-white bg-red-600 rounded-lg px-2.5 py-1 disabled:opacity-40">Yes</button>
                    <button onClick={() => setRemoving(null)} className="text-xs font-semibold text-gray-600 px-2 py-1">No</button>
                  </div>
                ) : (
                  <button title={required && mfa.factors.length === 1 ? 'Admins must keep at least one' : 'Remove'} disabled={required && mfa.factors.length === 1}
                    onClick={() => setRemoving(f.id)} className="p-1.5 rounded-lg text-gray-400 hover:text-red-600 hover:bg-red-50 disabled:opacity-30"><Trash2 size={15} /></button>
                )}
              </div>
            ))}
            {!setup && <button onClick={begin} disabled={busy} className="text-sm font-semibold text-primary-700 hover:underline flex items-center gap-1"><Plus size={14} /> Add a backup phone</button>}
            <p className="text-[11px] text-gray-400">Tip: add a second phone as a backup. If you lose your phone, {required ? 'remove the factor from Supabase → Authentication → Users' : 'contact TaxMate to reset it'}.</p>
          </div>
        )}

        {!on && !setup && (
          <>
            <ol className="text-sm text-gray-600 space-y-1.5">
              <li className="flex gap-2"><span className="w-5 h-5 rounded-full bg-primary-100 text-primary-700 text-xs font-bold flex items-center justify-center flex-shrink-0">1</span>Install <b>Google Authenticator</b> or <b>Microsoft Authenticator</b> (free) on your phone.</li>
              <li className="flex gap-2"><span className="w-5 h-5 rounded-full bg-primary-100 text-primary-700 text-xs font-bold flex items-center justify-center flex-shrink-0">2</span>Tap the button below and scan the QR code with the app.</li>
              <li className="flex gap-2"><span className="w-5 h-5 rounded-full bg-primary-100 text-primary-700 text-xs font-bold flex items-center justify-center flex-shrink-0">3</span>Type the 6-digit code the app shows.</li>
            </ol>
            <button onClick={begin} disabled={busy} className="btn-primary w-full justify-center py-2.5">{busy ? <Loader2 size={16} className="animate-spin" /> : <KeyRound size={16} />} Turn on two-step login</button>
          </>
        )}

        {setup && (
          <div className="grid sm:grid-cols-[auto_1fr] gap-5 items-center">
            <div className="mx-auto">
              <div className="p-3 rounded-2xl bg-white border-2 border-primary-100 shadow-sm">
                <img src={setup.qr} alt="QR code for your authenticator app" className="w-44 h-44" />
              </div>
              <a href={setup.uri} className="sm:hidden mt-2 block text-center text-xs font-semibold text-primary-700 underline">On this phone? Tap to open the app</a>
            </div>
            <div className="space-y-3">
              <div className="text-sm text-gray-700"><b>Scan this QR</b> in your authenticator app (tap <b>+</b> → Scan a QR code).</div>
              <div>
                <div className="text-[11px] text-gray-400">Can't scan? Enter this key:</div>
                <button onClick={() => { navigator.clipboard?.writeText(setup.secret); toast.success('Key copied'); }}
                  className="mt-0.5 font-mono text-xs bg-gray-50 border border-gray-200 rounded-lg px-2 py-1.5 break-all text-left hover:bg-gray-100 flex items-center gap-1.5 w-full">
                  <Copy size={12} className="flex-shrink-0 text-gray-400" /> {setup.secret}
                </button>
              </div>
              <div className="text-sm font-semibold text-gray-700">Then type the 6-digit code:</div>
              <CodeInput value={code} onChange={setCode} onComplete={finish} disabled={busy} />
              <div className="flex gap-2">
                <button onClick={() => { setSetup(null); setCode(''); }} className="btn-secondary flex-1 justify-center text-sm">Cancel</button>
                <button onClick={() => finish()} disabled={busy || code.length !== 6} className="btn-primary flex-1 justify-center text-sm">{busy ? <Loader2 size={15} className="animate-spin" /> : <CheckCircle2 size={15} />} Verify &amp; turn on</button>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

function Shell({ children }) {
  return (
    <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-primary-600 via-primary-700 to-indigo-900 p-4">
      <div className="w-full max-w-lg">
        <div className="text-center mb-6">
          <div className="text-3xl font-black text-white">Tax<span className="text-gold-500">Mate</span></div>
          <div className="text-primary-200 text-xs mt-1">Secure sign-in</div>
        </div>
        {children}
      </div>
    </div>
  );
}

/** Shown after the password when the account has 2FA on. */
export function MfaChallengeScreen() {
  const { mfa, refreshMfa, signOut, profile } = useAuth();
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);
  const factor = mfa.factors[0];

  const submit = async (c = code) => {
    if (busy || !factor) return;
    setBusy(true);
    let ok = false;
    for (const f of mfa.factors) {     // any of their phones
      try { await verifyCode(f.id, c); ok = true; break; } catch { /* try next */ }
    }
    if (ok) { await refreshMfa(); logActivity('login'); toast.success(`Welcome${profile?.full_name ? `, ${profile.full_name.split(' ')[0]}` : ''}!`); }
    else { toast.error('Wrong or expired code — try the newest code in the app'); setCode(''); }
    setBusy(false);
  };

  return (
    <Shell>
      <div className="bg-white rounded-3xl shadow-2xl p-7 text-center space-y-5">
        <div className="w-16 h-16 mx-auto rounded-2xl bg-gradient-to-br from-primary-600 to-indigo-600 text-white flex items-center justify-center shadow-lg"><Smartphone size={30} /></div>
        <div>
          <h2 className="text-xl font-black text-primary-800">Enter your 6-digit code</h2>
          <p className="text-sm text-gray-500 mt-1">Open your authenticator app and type the code for <b>TaxMate Solutions</b>.</p>
          <p className="text-xs text-gray-400">Authenticator app එකේ තියෙන code එක ඇතුළත් කරන්න</p>
        </div>
        <CodeInput value={code} onChange={setCode} onComplete={submit} disabled={busy} />
        <button onClick={() => submit()} disabled={busy || code.length !== 6} className="btn-primary w-full justify-center py-3 text-base">
          {busy ? <Loader2 size={18} className="animate-spin" /> : <ShieldCheck size={18} />} Verify
        </button>
        <button onClick={signOut} className="text-xs text-gray-500 hover:text-gray-700 inline-flex items-center gap-1"><LogOut size={12} /> Use a different account</button>
        <p className="text-[11px] text-gray-400">Lost your phone? Contact TaxMate to reset two-step login.</p>
      </div>
    </Shell>
  );
}

/** Admins without 2FA: must set it up before using the admin portal. */
export function MfaSetupScreen() {
  const { signOut } = useAuth();
  return (
    <Shell>
      <div className="space-y-3">
        <div className="bg-white/10 text-white rounded-2xl px-4 py-3 text-sm">
          🔐 <b>One-time security step.</b> Admin accounts can see every client's tax data, so two-step login is required.
        </div>
        <TwoFactorCard required />
        <button onClick={signOut} className="w-full text-xs text-primary-200 hover:text-white inline-flex items-center justify-center gap-1"><LogOut size={12} /> Sign out</button>
      </div>
    </Shell>
  );
}
