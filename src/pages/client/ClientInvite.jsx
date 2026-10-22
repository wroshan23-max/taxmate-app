import { useEffect, useState } from 'react';
import { Link, useOutletContext } from 'react-router-dom';
import toast from 'react-hot-toast';
import { Gift, Copy, Share2, MessageCircle, Mail, Users, CheckCircle2, Sparkles, Loader2, Heart } from 'lucide-react';
import { supabase, fmtDate } from '../../lib/supabase';
import { FIRM } from '../../lib/iitStatement';

// Facebook "f" mark (brand icons are not in lucide)
const Facebook = ({ size = 22 }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M13.5 22v-8.2h2.8l.4-3.2h-3.2V8.5c0-.9.3-1.6 1.6-1.6h1.7V4.1c-.3 0-1.3-.1-2.5-.1-2.5 0-4.2 1.5-4.2 4.3v2.4H7.3v3.2h2.8V22h3.4z" /></svg>
);

const steps = [
  ['Share your link', 'ඔබේ link එක යවන්න', 'WhatsApp, Facebook or any app'],
  ['Friend registers', 'යාළුවා ලියාපදිංචි වෙනවා', 'Takes 2 minutes on their phone'],
  ['We take care of them', 'අපි බලාගන්නම්', 'Same trusted TaxMate service you get'],
];

export default function ClientInvite() {
  const features = useOutletContext() ?? {};
  const [url, setUrl] = useState('');
  const [friends, setFriends] = useState([]);
  const [err, setErr] = useState('');
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    (async () => {
      const [{ data, error }, { data: refs }] = await Promise.all([supabase.rpc('my_referral_link'), supabase.rpc('my_referrals')]);
      if (error) setErr(error.message); else setUrl(`${window.location.origin}/join/${data.code}`);
      setFriends(Array.isArray(refs) ? refs : []);
      setLoading(false);
    })();
  }, []);

  if (features.loaded && features.referrals === false) return (
    <div className="card p-8 text-center space-y-3"><Gift size={36} className="mx-auto text-gray-300" /><p className="text-gray-600">Invites are not available right now.</p><Link to="/client" className="btn-secondary text-sm inline-flex">Back to dashboard</Link></div>
  );

  const reward = (features.referral_reward || '').trim();
  const message = `Hi! I use ${FIRM.name} for my income tax — they make it really easy and they're trustworthy. 👍\n\nRegister here in 2 minutes and they'll help you with your tax return:\n${url}\n\nමම මගේ බදු වැඩ ${FIRM.name} එකෙන් කරගන්නවා. ඔයත් මේ link එකෙන් register වෙන්න 👆`;
  const copy = async (t, m) => { try { await navigator.clipboard.writeText(t); toast.success(m); } catch { toast.error('Could not copy'); } };
  const share = async () => { try { await navigator.share({ title: FIRM.name, text: message }); } catch { /* cancelled */ } };

  return (
    <div className="space-y-5">
      {/* Hero */}
      <div className="relative overflow-hidden rounded-3xl bg-gradient-to-br from-primary-700 via-primary-800 to-indigo-900 text-white p-6 sm:p-8 shadow-xl">
        <div className="absolute -right-10 -top-10 w-48 h-48 rounded-full bg-gold-500/20 blur-2xl" />
        <div className="absolute -left-12 -bottom-16 w-56 h-56 rounded-full bg-pink-500/20 blur-3xl" />
        <div className="relative">
          <div className="inline-flex items-center gap-1.5 text-xs font-bold uppercase tracking-wider bg-white/15 rounded-full px-3 py-1"><Sparkles size={13} /> Invite friends</div>
          <h1 className="text-2xl sm:text-3xl font-black mt-3 leading-tight">Help your friends &amp; family<br />sort out their tax — stress-free</h1>
          <p className="text-primary-200 mt-2 text-sm sm:text-base">ඔබේ යාළුවන්ට සහ පවුලේ අයට TaxMate හඳුන්වා දෙන්න</p>
          {reward && (
            <div className="mt-4 inline-flex items-start gap-2 bg-gold-500 text-primary-900 rounded-2xl px-4 py-3 font-semibold shadow-lg max-w-xl">
              <Gift size={20} className="flex-shrink-0 mt-0.5" /> <span>{reward}</span>
            </div>
          )}
        </div>
      </div>

      {/* Link + share */}
      <div className="card p-5 space-y-4">
        <div className="text-sm font-semibold text-gray-700">Your personal invite link</div>
        {loading ? <div className="flex items-center gap-2 text-gray-400 text-sm"><Loader2 size={15} className="animate-spin" /> Creating your link…</div> : err ? (
          <div className="text-sm text-red-600">{err}</div>
        ) : (
          <>
            <div className="flex gap-2">
              <div className="flex-1 min-w-0 rounded-xl bg-gray-50 border border-gray-200 px-3 py-2.5 font-mono text-sm text-primary-800 truncate">{url}</div>
              <button onClick={() => copy(url, 'Link copied')} className="btn-secondary flex-shrink-0"><Copy size={15} /> <span className="hidden sm:inline">Copy</span></button>
            </div>
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
              <a href={`https://wa.me/?text=${encodeURIComponent(message)}`} target="_blank" rel="noreferrer"
                className="rounded-2xl bg-[#25D366] hover:brightness-95 text-white font-semibold py-3 flex flex-col items-center gap-1 text-sm shadow-sm"><MessageCircle size={22} /> WhatsApp</a>
              <a href={`https://www.facebook.com/sharer/sharer.php?u=${encodeURIComponent(url)}`} target="_blank" rel="noreferrer"
                className="rounded-2xl bg-[#1877F2] hover:brightness-95 text-white font-semibold py-3 flex flex-col items-center gap-1 text-sm shadow-sm"><Facebook size={22} /> Facebook</a>
              <a href={`mailto:?subject=${encodeURIComponent(`Try ${FIRM.name} for your tax`)}&body=${encodeURIComponent(message)}`}
                className="rounded-2xl bg-gray-800 hover:bg-gray-900 text-white font-semibold py-3 flex flex-col items-center gap-1 text-sm shadow-sm"><Mail size={22} /> Email</a>
              {typeof navigator !== 'undefined' && navigator.share
                ? <button onClick={share} className="rounded-2xl bg-primary-600 hover:bg-primary-700 text-white font-semibold py-3 flex flex-col items-center gap-1 text-sm shadow-sm"><Share2 size={22} /> More apps</button>
                : <button onClick={() => copy(message, 'Message copied')} className="rounded-2xl bg-primary-600 hover:bg-primary-700 text-white font-semibold py-3 flex flex-col items-center gap-1 text-sm shadow-sm"><Copy size={22} /> Copy message</button>}
            </div>
            <details className="text-xs text-gray-500">
              <summary className="cursor-pointer font-semibold text-gray-600">Preview the message</summary>
              <pre className="whitespace-pre-wrap font-sans mt-2 bg-gray-50 rounded-xl p-3 text-gray-700">{message}</pre>
            </details>
          </>
        )}
      </div>

      {/* How it works */}
      <div className="grid sm:grid-cols-3 gap-3">
        {steps.map(([en, si, sub], i) => (
          <div key={en} className="card p-4 flex gap-3">
            <div className="w-9 h-9 rounded-full bg-gold-500 text-primary-900 font-black flex items-center justify-center flex-shrink-0">{i + 1}</div>
            <div><div className="font-semibold text-gray-800 text-sm">{en}</div><div className="text-xs text-gray-400">{si}</div><div className="text-xs text-gray-500 mt-0.5">{sub}</div></div>
          </div>
        ))}
      </div>

      {/* Friends */}
      <div className="card overflow-hidden">
        <div className="card-header"><Users size={16} /> Friends who joined <span className="ml-auto text-2xl font-black text-primary-700">{friends.length}</span></div>
        {friends.length === 0 ? (
          <div className="p-6 text-center text-sm text-gray-500"><Heart size={28} className="mx-auto text-pink-300 mb-2" />No one yet — share your link and be the first to help a friend!</div>
        ) : (
          <div className="divide-y divide-gray-50">
            {friends.map((f, i) => (
              <div key={i} className="flex items-center gap-3 px-5 py-3">
                <div className="w-9 h-9 rounded-full bg-gradient-to-br from-pink-400 to-purple-500 text-white font-bold flex items-center justify-center">{(f.name || '?')[0]}</div>
                <div className="flex-1"><div className="font-semibold text-sm text-gray-800">{f.name || 'Friend'}</div><div className="text-xs text-gray-400">Joined {fmtDate(f.joined)}</div></div>
                {f.active && <span className="text-[11px] font-semibold px-2 py-0.5 rounded-full bg-green-100 text-green-700 flex items-center gap-1"><CheckCircle2 size={11} /> Using the portal</span>}
              </div>
            ))}
          </div>
        )}
      </div>
      <p className="text-[11px] text-gray-400 text-center">We only show your friends' first names. Their details stay private with {FIRM.name}.</p>
    </div>
  );
}
