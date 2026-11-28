// V86 — first sign-in with a one-time password from TaxMate: set a new password, or keep the one received.
import { useState } from 'react';
import toast from 'react-hot-toast';
import { KeyRound, Eye, EyeOff, Loader2, ShieldCheck, Check } from 'lucide-react';
import { supabase } from '../lib/supabase';
import { logActivity } from '../lib/activity';

export function passwordProblem(pw, again) {
  if (pw.length < 8) return 'At least 8 characters · අවම අක්ෂර 8ක්';
  if (!/[A-Za-z]/.test(pw) || !/\d/.test(pw)) return 'Use letters and numbers · අකුරු සහ ඉලක්කම් දෙකම';
  if (again !== undefined && pw !== again) return 'The two passwords are not the same · Password දෙක සමාන නැහැ';
  return '';
}

export default function TempPasswordPrompt({ profile }) {
  const [done, setDone] = useState(false);
  const [mode, setMode] = useState(null);           // null | 'new'
  const [pw, setPw] = useState('');
  const [again, setAgain] = useState('');
  const [show, setShow] = useState(false);
  const [busy, setBusy] = useState(false);
  if (done || !profile?.temp_password_at || profile.viewAs) return null;

  const finish = async (kept) => {
    const { error } = await supabase.rpc('my_temp_password_done', { p_kept: kept });
    if (error) throw error;
    logActivity('submit', undefined, kept ? 'kept the one-time password' : 'set a new password');
    setDone(true);
  };
  const keep = async () => {
    setBusy(true);
    try { await finish(true); toast.success('OK — keep using this password'); } catch (e) { toast.error(e.message); }
    setBusy(false);
  };
  const save = async (e) => {
    e.preventDefault();
    const p = passwordProblem(pw, again);
    if (p) return toast.error(p);
    setBusy(true);
    try {
      const { error } = await supabase.auth.updateUser({ password: pw });
      if (error) throw new Error(/same|different/i.test(error.message) ? 'Choose a password different from the one-time password.' : error.message);
      await finish(false);
      toast.success('New password saved ✓');
    } catch (err) { toast.error(err.message); }
    setBusy(false);
  };
  const problem = pw ? passwordProblem(pw, again || undefined) : '';

  return (
    <div className="fixed inset-0 z-[60] flex items-end justify-center bg-black/50 p-0 sm:items-center sm:p-4">
      <div className="w-full overflow-hidden rounded-t-2xl bg-white shadow-2xl sm:max-w-md sm:rounded-2xl">
        <div className="bg-gradient-to-br from-primary-800 to-primary-700 px-5 py-4 text-white">
          <div className="flex items-center gap-2 text-lg font-bold"><KeyRound size={20} className="text-gold-500" /> Welcome{profile.full_name ? `, ${String(profile.full_name).trim().split(/\s+/)[0]}` : ''}!</div>
          <p className="mt-1 text-sm text-primary-100">You signed in with the one-time password from TaxMate. Would you like your own password?</p>
          <p className="text-xs text-primary-200">TaxMate එවූ තාවකාලික password එකෙන් ඔබ ඇතුළු වුණා. ඔබේම password එකක් දාන්න කැමතිද?</p>
        </div>
        {mode !== 'new' ? (
          <div className="space-y-2 p-5">
            <button type="button" onClick={() => setMode('new')} className="flex w-full items-start gap-3 rounded-xl border-2 border-primary-200 bg-primary-50 p-3 text-left hover:border-primary-400">
              <KeyRound size={18} className="mt-0.5 text-primary-700" />
              <span><b className="block text-sm text-primary-900">Set a new password (recommended)</b><span className="text-xs text-gray-600">Only you will know it · අලුත් password එකක් දාන්න (නිර්දේශිතයි)</span></span>
            </button>
            <button type="button" onClick={keep} disabled={busy} className="flex w-full items-start gap-3 rounded-xl border border-gray-200 p-3 text-left hover:bg-gray-50 disabled:opacity-60">
              {busy ? <Loader2 size={18} className="mt-0.5 animate-spin text-gray-500" /> : <Check size={18} className="mt-0.5 text-gray-500" />}
              <span><b className="block text-sm text-gray-800">Keep this password</b><span className="text-xs text-gray-500">Use the password I received from now on · ලැබුණු password එකම දිගටම පාවිච්චි කරන්න</span></span>
            </button>
            <p className="flex items-start gap-1.5 pt-1 text-[11px] text-gray-400"><ShieldCheck size={12} className="mt-0.5 flex-shrink-0" /> If you keep it, delete the message with the password from your phone. You can change it any time by asking TaxMate for a reset link.</p>
          </div>
        ) : (
          <form onSubmit={save} className="space-y-3 p-5">
            <label className="block text-xs font-semibold text-gray-600">New password · අලුත් password එක
              <div className="relative mt-1">
                <input type={show ? 'text' : 'password'} autoComplete="new-password" autoFocus value={pw} onChange={(e) => setPw(e.target.value)} className="input pr-10" placeholder="At least 8 characters, letters + numbers" />
                <button type="button" onClick={() => setShow((s) => !s)} className="absolute right-2 top-1/2 -translate-y-1/2 p-1 text-gray-400" aria-label={show ? 'Hide' : 'Show'}>{show ? <EyeOff size={16} /> : <Eye size={16} />}</button>
              </div>
            </label>
            <label className="block text-xs font-semibold text-gray-600">Type it again · නැවත ටයිප් කරන්න
              <input type={show ? 'text' : 'password'} autoComplete="new-password" value={again} onChange={(e) => setAgain(e.target.value)} className="input mt-1" />
            </label>
            {problem && <p className="text-xs text-amber-700">{problem}</p>}
            <div className="flex gap-2">
              <button type="button" onClick={() => setMode(null)} className="btn-secondary flex-1 justify-center">Back</button>
              <button type="submit" disabled={busy || !!passwordProblem(pw, again)} className="btn-primary flex-1 justify-center">{busy ? <Loader2 size={15} className="animate-spin" /> : <KeyRound size={15} />} Save password</button>
            </div>
          </form>
        )}
      </div>
    </div>
  );
}
