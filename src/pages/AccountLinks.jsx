import { useEffect, useState } from 'react';
import { useNavigate, useParams, Link } from 'react-router-dom';
import { supabase } from '../lib/supabase';
import { callPortal } from '../lib/portal';
import { FIRM } from '../lib/iitStatement';
import { waNumber } from '../lib/share';
import { Eye, EyeOff, Loader2, KeyRound } from 'lucide-react';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const STATUS_MSG = {
  used: 'This link was already used. Please sign in with your email and password.',
  expired: 'This link has expired. Please ask TaxMate for a new one.',
  revoked: 'This link was cancelled. Please ask TaxMate for a new one.',
  missing: 'This link is not valid. Please check you opened the full link, or ask TaxMate for a new one.',
};

// /invite/:token — client (or staff) creates their password
export function InvitePage() {
  return <SetPassword kind="invite" />;
}

// /reset/:token — set a new password from a link sent by the admin
export function ResetPasswordPage() {
  return <SetPassword kind="reset" />;
}

function SetPassword({ kind }) {
  const { token } = useParams();
  const navigate = useNavigate();
  const [info, setInfo] = useState(null);
  const [state, setState] = useState('loading');
  const [pw, setPw] = useState('');
  const [pw2, setPw2] = useState('');
  const [show, setShow] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');

  useEffect(() => {
    if (!UUID_RE.test(token || '')) { setState('missing'); return; }
    supabase.rpc(kind === 'invite' ? 'get_invite' : 'get_reset', { p_token: token }).then(({ data, error }) => {
      if (error || !data) setState('missing');
      else { setInfo(data); setState(data.status === 'ok' ? 'ok' : data.status); }
    });
  }, [token, kind]);

  const submit = async (e) => {
    e.preventDefault();
    setErr('');
    if (pw.length < 8) return setErr('Password must be at least 8 characters.');
    if (pw !== pw2) return setErr('The two passwords do not match.');
    setBusy(true);
    try {
      const res = await callPortal(kind === 'invite' ? 'accept_invite' : 'reset_password', { token, password: pw });
      const { error } = await supabase.auth.signInWithPassword({ email: res.email ?? info.email, password: pw });
      if (error) { setBusy(false); return setErr('Password saved. Please sign in on the login page.'); }
      navigate(res.role === 'admin' ? '/admin' : '/', { replace: true });
    } catch (e2) {
      setErr(e2.message);
      setBusy(false);
    }
  };

  const title = kind === 'invite' ? 'Create your portal password' : 'Set a new password';
  return (
    <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-primary-600 to-primary-800 p-4">
      <div className="w-full max-w-md">
        <div className="text-center mb-6">
          <div className="text-4xl font-black text-white">Tax<span className="text-gold-500">Mate</span></div>
          <div className="text-primary-200 text-sm font-medium">{kind === 'invite' ? 'Client Portal' : 'Password reset'}</div>
        </div>
        <div className="bg-white rounded-2xl shadow-2xl p-8">
          {state === 'loading' && <div className="flex items-center justify-center py-8 text-gray-400"><Loader2 className="animate-spin mr-2" size={18} /> Checking link…</div>}

          {state !== 'loading' && state !== 'ok' && (
            <div className="text-center space-y-3">
              <div className="text-4xl">🔒</div>
              <p className="text-sm text-gray-600">{STATUS_MSG[state] ?? STATUS_MSG.missing}</p>
              <div className="flex gap-2 justify-center">
                <Link to="/login" className="btn-primary text-sm">Go to sign in</Link>
                <a href={`https://wa.me/${waNumber(FIRM.whatsapp)}`} target="_blank" rel="noreferrer" className="btn-secondary text-sm">WhatsApp TaxMate</a>
              </div>
            </div>
          )}

          {state === 'ok' && (
            <form onSubmit={submit} className="space-y-4">
              <div className="flex items-center gap-2 text-primary-700"><KeyRound size={18} /><h2 className="text-lg font-bold">{title}</h2></div>
              {kind === 'invite' && info.full_name && <p className="text-sm text-gray-600">Welcome, <strong>{info.full_name}</strong>.</p>}
              <div>
                <label className="block text-xs font-semibold text-gray-500 uppercase tracking-wider mb-1">Email (your sign-in name)</label>
                <input className="input bg-gray-50" value={info.email} readOnly />
              </div>
              <div>
                <label className="block text-xs font-semibold text-gray-500 uppercase tracking-wider mb-1">New password</label>
                <div className="relative">
                  <input type={show ? 'text' : 'password'} className="input pr-10" placeholder="At least 8 characters" value={pw} onChange={e => setPw(e.target.value)} autoComplete="new-password" required />
                  <button type="button" onClick={() => setShow(!show)} className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400">{show ? <EyeOff size={16} /> : <Eye size={16} />}</button>
                </div>
              </div>
              <div>
                <label className="block text-xs font-semibold text-gray-500 uppercase tracking-wider mb-1">Repeat password</label>
                <input type={show ? 'text' : 'password'} className="input" value={pw2} onChange={e => setPw2(e.target.value)} autoComplete="new-password" required />
              </div>
              {err && <div className="text-sm text-red-600 bg-red-50 border border-red-100 rounded-lg p-2">{err}</div>}
              <button type="submit" disabled={busy} className="btn-primary w-full justify-center">
                {busy ? <><Loader2 className="animate-spin" size={16} /> Saving…</> : kind === 'invite' ? 'Create password & open my portal' : 'Save new password & sign in'}
              </button>
              <p className="text-xs text-gray-400 text-center">Next time, sign in at <strong>{window.location.host}/login</strong> with this email and password.</p>
            </form>
          )}
        </div>
      </div>
    </div>
  );
}
