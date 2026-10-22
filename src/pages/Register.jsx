import { useEffect, useState } from 'react';
import { useParams } from 'react-router-dom';
import { Loader2, CheckCircle2, UserRound, User, ShieldCheck } from 'lucide-react';
import { supabase } from '../lib/supabase';
import { FIRM } from '../lib/iitStatement';
import { waNumber } from '../lib/share';
import { RELATIONS, SERVICES } from '../lib/contacts';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const NIC_RE = /^(\d{9}[VX]|\d{12})$/i;
const MOBILE_RE = /^(\+?94|0)?7\d{8}$/;
const cleanPhone = (v) => String(v || '').replace(/[\s-]/g, '');
const STATUS_MSG = {
  used: 'This link was already used — your details have been received. Thank you!',
  expired: 'This link has expired. Please ask TaxMate for a new one.',
  revoked: 'This link was cancelled. Please ask TaxMate for a new one.',
  missing: 'This link is not valid. Please check you opened the full link, or ask TaxMate for a new one.',
  closed: 'Online registration is closed right now. Please WhatsApp TaxMate and we will help you.',
};
const CODE_RE = /^[a-z0-9][a-z0-9-]{1,29}$/i;

const EMPTY = {
  filled_by: 'self', full_name: '', nic: '', tin: '', mobile: '', email: '', address: '', employer: '', resident_status: 'resident',
  contact_name: '', contact_relation: '', contact_mobile: '', contact_email: '', contact_preferred: true,
  services: ['Individual Income Tax Return'], note: '', consent: false, website: '',
};

function F({ label, si, required, children, wide, hint }) {
  return (
    <div className={wide ? 'sm:col-span-2' : ''}>
      <label className="block text-xs font-semibold text-gray-600 mb-1">{label}{required && <span className="text-red-500"> *</span>}
        {si && <span className="block font-normal text-gray-400">{si}</span>}</label>
      {children}
      {hint && <div className="text-[11px] text-amber-700 mt-1">{hint}</div>}
    </div>
  );
}

// /register/:token = one-time personal link · /join/:code = reusable public link (Facebook, flyers…)
export default function Register() {
  const { token, code } = useParams();
  const isPublic = !!code;
  const [state, setState] = useState('loading');
  const [f, setF] = useState(EMPTY);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const [done, setDone] = useState(null);
  const [invitedBy, setInvitedBy] = useState(null);

  useEffect(() => {
    const valid = isPublic ? CODE_RE.test(code || '') : UUID_RE.test(token || '');
    if (!valid) { setState('missing'); return; }
    const call = isPublic
      ? supabase.rpc('get_public_registration', { p_code: code.toLowerCase() })
      : supabase.rpc('get_registration', { p_token: token });
    call.then(({ data, error }) => {
      if (error || !data) return setState('missing');
      if (data.invited_by) setInvitedBy(data.invited_by);
      setState(data.status);
    });
  }, [token, code, isPublic]);

  const set = (k) => (e) => setF({ ...f, [k]: e.target.type === 'checkbox' ? e.target.checked : e.target.value });
  const forOther = f.filled_by === 'contact';
  const toggleService = (s) => setF({ ...f, services: f.services.includes(s) ? f.services.filter(x => x !== s) : [...f.services, s] });

  const submit = async (e) => {
    e.preventDefault();
    setErr('');
    if (f.full_name.trim().length < 3) return setErr("Please enter the taxpayer's full name.");
    if (!forOther && !f.mobile.trim()) return setErr('Please enter your mobile number.');
    if (forOther && (!f.contact_name.trim() || !f.contact_mobile.trim())) return setErr('Please enter your own name and mobile number (contact person).');
    if (f.mobile && !MOBILE_RE.test(cleanPhone(f.mobile))) return setErr('Please check the mobile number (e.g. 0771234567).');
    if (forOther && f.contact_mobile && !MOBILE_RE.test(cleanPhone(f.contact_mobile))) return setErr('Please check your mobile number (e.g. 0771234567).');
    if (!f.consent) return setErr('Please tick the consent box to continue.');
    setBusy(true);
    const payload = {
      ...f,
      mobile: cleanPhone(f.mobile), contact_mobile: forOther ? cleanPhone(f.contact_mobile) : '',
      contact_name: forOther ? f.contact_name : '', contact_relation: forOther ? f.contact_relation : '',
      contact_email: forOther ? f.contact_email : '', contact_preferred: forOther && f.contact_preferred,
    };
    const { data, error } = isPublic
      ? await supabase.rpc('submit_public_registration', { p_code: code.toLowerCase(), p: payload })
      : await supabase.rpc('submit_registration', { p_token: token, p: payload });
    setBusy(false);
    if (error) return setErr(error.message);
    setDone(data?.name ?? f.full_name);
  };

  const nicHint = f.nic && !NIC_RE.test(f.nic.trim()) ? 'NIC is usually 12 digits, or 9 digits + V/X' : null;

  return (
    <div className="min-h-screen bg-gradient-to-br from-primary-600 to-primary-800 py-8 px-4">
      <div className="max-w-2xl mx-auto">
        <div className="text-center mb-6">
          <div className="text-4xl font-black text-white">Tax<span className="text-gold-500">Mate</span></div>
          <div className="text-primary-200 text-sm font-medium">New client registration · නව සේවාලාභී ලියාපදිංචිය</div>
        </div>
        <div className="bg-white rounded-2xl shadow-2xl p-5 sm:p-8">
          {state === 'loading' && <div className="flex items-center justify-center py-10 text-gray-400"><Loader2 className="animate-spin mr-2" size={18} /> Checking link…</div>}

          {state !== 'loading' && state !== 'ok' && !done && (
            <div className="text-center space-y-3 py-6">
              <div className="text-4xl">{state === 'used' ? '✅' : '🔒'}</div>
              <p className="text-sm text-gray-600">{STATUS_MSG[state] ?? STATUS_MSG.missing}</p>
              <a href={`https://wa.me/${waNumber(FIRM.whatsapp)}`} target="_blank" rel="noreferrer" className="btn-primary text-sm inline-flex">WhatsApp TaxMate</a>
            </div>
          )}

          {done && (
            <div className="text-center space-y-3 py-6">
              <CheckCircle2 size={48} className="mx-auto text-green-600" />
              <h2 className="text-xl font-bold text-primary-800">Thank you!</h2>
              <p className="text-sm text-gray-600">We have received the details of <b>{done}</b>. {FIRM.name} will contact you soon.</p>
              <p className="text-sm text-gray-500">ඔබගේ විස්තර ලැබුණා. අපි ඉක්මනින් ඔබව සම්බන්ධ කරගන්නෙමු.</p>
              <a href={`https://wa.me/${waNumber(FIRM.whatsapp)}`} target="_blank" rel="noreferrer" className="btn-secondary text-sm inline-flex">WhatsApp {FIRM.whatsapp}</a>
            </div>
          )}

          {state === 'ok' && !done && invitedBy && (
            <div className="mb-4 rounded-xl bg-gradient-to-r from-gold-500/20 to-pink-100 border border-gold-500/40 px-4 py-3 text-sm text-primary-900 flex items-center gap-2">
              <span className="text-xl">🎉</span> <span><b>{invitedBy}</b> invited you to {FIRM.name}. <span className="text-gray-600">ඔබට ආරාධනා කළේ {invitedBy}.</span></span>
            </div>
          )}
          {state === 'ok' && !done && (
            <form onSubmit={submit} className="space-y-5">
              {/* Honeypot: hidden from people, bots fill it */}
              <div aria-hidden="true" style={{ position: 'absolute', left: '-10000px', width: 1, height: 1, overflow: 'hidden' }}>
                <label>Website<input tabIndex={-1} autoComplete="off" value={f.website} onChange={set('website')} /></label>
              </div>
              <div>
                <h2 className="text-lg font-bold text-primary-800">Your details for {FIRM.name}</h2>
                <p className="text-sm text-gray-500">Takes about 2 minutes · මිනිත්තු 2ක් පමණ ගතවේ</p>
              </div>

              {/* Who is filling */}
              <div>
                <div className="text-xs font-semibold text-gray-600 mb-2">Who is filling this form? · මෙම පෝරමය පුරවන්නේ කවුද?</div>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                  {[['self', User, 'I am the taxpayer', 'මම බදු ගෙවන්නා'], ['contact', UserRound, "I'm filling it for someone", 'වෙනත් අයෙකු වෙනුවෙන් (උදා: දෙමාපියන්)']].map(([k, Icon, en, si]) => (
                    <button type="button" key={k} onClick={() => setF({ ...f, filled_by: k })}
                      className={`text-left rounded-xl border-2 p-3 flex gap-2 ${f.filled_by === k ? 'border-primary-500 bg-primary-50' : 'border-gray-200 hover:border-gray-300'}`}>
                      <Icon size={18} className="text-primary-600 mt-0.5" />
                      <span className="text-sm font-semibold text-gray-800">{en}<span className="block text-xs font-normal text-gray-500">{si}</span></span>
                    </button>
                  ))}
                </div>
              </div>

              {forOther && (
                <div className="rounded-xl border border-primary-100 bg-primary-50/50 p-4 space-y-3">
                  <div className="text-sm font-semibold text-primary-800">Your details (contact person) · ඔබගේ විස්තර</div>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                    <F label="Your name" si="ඔබගේ නම" required><input className="input" maxLength={150} value={f.contact_name} onChange={set('contact_name')} /></F>
                    <F label="Relationship to the taxpayer" si="බදු ගෙවන්නාට ඇති සම්බන්ධය">
                      <select className="input" value={f.contact_relation} onChange={set('contact_relation')}>
                        <option value="">Select…</option>{RELATIONS.map(r => <option key={r}>{r}</option>)}
                      </select>
                    </F>
                    <F label="Your mobile / WhatsApp" si="ඔබගේ දුරකථන අංකය" required><input className="input" inputMode="tel" placeholder="07X XXXXXXX" maxLength={20} value={f.contact_mobile} onChange={set('contact_mobile')} /></F>
                    <F label="Your email" si="ඊමේල්"><input className="input" type="email" maxLength={150} value={f.contact_email} onChange={set('contact_email')} /></F>
                  </div>
                  <label className="flex items-center gap-2 text-sm text-gray-700">
                    <input type="checkbox" checked={f.contact_preferred} onChange={set('contact_preferred')} />
                    Please contact me (not the taxpayer) about this · මා හා සම්බන්ධ වන්න
                  </label>
                </div>
              )}

              <div className="space-y-3">
                <div className="text-sm font-semibold text-primary-800">{forOther ? "Taxpayer's details · බදු ගෙවන්නාගේ විස්තර" : 'Your details · ඔබගේ විස්තර'}</div>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <F label="Full name (as in NIC)" si="සම්පූර්ණ නම" required wide><input className="input" maxLength={150} value={f.full_name} onChange={set('full_name')} /></F>
                  <F label="NIC number" si="ජා.හැ. අංකය" hint={nicHint}><input className="input uppercase" maxLength={12} value={f.nic} onChange={set('nic')} /></F>
                  <F label="TIN (if you have one)" si="බදු හැඳුනුම් අංකය"><input className="input" maxLength={20} value={f.tin} onChange={set('tin')} /></F>
                  <F label="Mobile / WhatsApp" si="දුරකථන අංකය" required={!forOther}><input className="input" inputMode="tel" placeholder="07X XXXXXXX" maxLength={20} value={f.mobile} onChange={set('mobile')} /></F>
                  <F label="Email" si="ඊමේල්"><input className="input" type="email" maxLength={150} value={f.email} onChange={set('email')} /></F>
                  <F label="Address" si="ලිපිනය" wide><textarea className="input resize-none" rows={2} maxLength={400} value={f.address} onChange={set('address')} /></F>
                  <F label="Employer / business / occupation" si="රැකියාව / ව්‍යාපාරය"><input className="input" maxLength={150} value={f.employer} onChange={set('employer')} /></F>
                  <F label="Residency" si="පදිංචිය">
                    <select className="input" value={f.resident_status} onChange={set('resident_status')}>
                      <option value="resident">Living in Sri Lanka (resident)</option>
                      <option value="nrcitizen">Sri Lankan living abroad</option>
                      <option value="nonresident">Non-resident (foreigner)</option>
                    </select>
                  </F>
                </div>
              </div>

              <div>
                <div className="text-xs font-semibold text-gray-600 mb-2">What do you need help with? · ඔබට අවශ්‍ය සේවාව</div>
                <div className="flex flex-wrap gap-2">
                  {SERVICES.map(s => (
                    <button type="button" key={s} onClick={() => toggleService(s)}
                      className={`text-xs px-3 py-1.5 rounded-full border ${f.services.includes(s) ? 'bg-primary-600 text-white border-primary-600' : 'bg-white text-gray-700 border-gray-200 hover:border-primary-300'}`}>{s}</button>
                  ))}
                </div>
              </div>

              <F label="Anything else we should know?" si="වෙනත් විස්තර"><textarea className="input resize-none" rows={3} maxLength={2000} value={f.note} onChange={set('note')}
                placeholder="e.g. My father is retired and has rent income and fixed deposits." /></F>

              <label className="flex gap-2 text-sm text-gray-700 bg-gray-50 rounded-xl p-3">
                <input type="checkbox" className="mt-1" checked={f.consent} onChange={set('consent')} />
                <span>I agree that {FIRM.name} may keep these details and contact {forOther ? 'me / the taxpayer' : 'me'} to provide tax and accounting services.
                  <span className="block text-xs text-gray-400 mt-0.5">බදු හා ගිණුම් සේවා සඳහා මෙම තොරතුරු භාවිතා කිරීමට සහ සම්බන්ධ වීමට එකඟ වෙමි.</span></span>
              </label>

              {err && <div className="text-sm text-red-600 bg-red-50 border border-red-100 rounded-lg p-2">{err}</div>}
              <button type="submit" disabled={busy} className="btn-primary w-full justify-center">
                {busy ? <><Loader2 className="animate-spin" size={16} /> Sending…</> : 'Send my details'}
              </button>
              <p className="text-[11px] text-gray-400 text-center flex items-center justify-center gap-1"><ShieldCheck size={12} /> Your details go only to {FIRM.name}.</p>
            </form>
          )}
        </div>
      </div>
    </div>
  );
}
