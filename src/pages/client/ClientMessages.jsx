import { useEffect, useRef, useState } from 'react';
import { Link, useOutletContext } from 'react-router-dom';
import { MessageCircle, Megaphone, Loader2, Sparkles, Reply } from 'lucide-react';
import { supabase } from '../../lib/supabase';
import { useAuth } from '../../contexts/AuthContext';
import ChatThread from '../../components/ChatThread';
import LinkifiedText from '../../components/LinkifiedText';
import { timeLabel } from '../../lib/messages';

export default function ClientMessages() {
  const features = useOutletContext() ?? {};
  const { user } = useAuth();
  const [clientId, setClientId] = useState(null);
  const [news, setNews] = useState(null);     // announcements with isNew
  const [showAll, setShowAll] = useState(false);
  const [draft, setDraft] = useState(null);
  const chatRef = useRef();
  const replyTo = (m) => {
    const about = (m.title || m.body).replace(/\s+/g, ' ').slice(0, 70);
    setDraft({ key: Date.now(), text: `Re: "${about}${(m.title || m.body).length > 70 ? '…' : ''}"\n` });
    chatRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  };

  useEffect(() => {
    if (!user?.id) return;
    (async () => {
      const [{ data: c }, { data: a }, { data: r }] = await Promise.all([
        supabase.from('clients').select('id').eq('profile_id', user.id).maybeSingle(),
        supabase.from('messages').select('*').is('client_id', null).order('created_at', { ascending: false }).limit(50),
        supabase.from('message_reads').select('message_id'),
      ]);
      const seen = new Set((r ?? []).map(x => x.message_id));
      setClientId(c?.id ?? null);
      setNews((a ?? []).map(m => ({ ...m, isNew: !seen.has(m.id) })));
    })();
  }, [user?.id]);

  if (features.loaded && features.messages === false) return (
    <div className="card p-8 text-center space-y-3"><MessageCircle size={36} className="mx-auto text-gray-300" /><p className="text-gray-600">Messages are not available right now. Please WhatsApp TaxMate.</p><Link to="/client" className="btn-secondary text-sm inline-flex">Back to dashboard</Link></div>
  );
  if (news === null) return <div className="card p-10 text-center text-gray-400"><Loader2 className="animate-spin mx-auto" /></div>;

  const shown = showAll ? news : news.slice(0, 4);
  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-2xl font-bold text-primary-800">Messages</h1>
        <p className="text-sm text-gray-500">Chat privately with TaxMate · TaxMate සමඟ කතා කරන්න</p>
      </div>

      <div className="grid lg:grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)] gap-4 items-start">
        <div ref={chatRef} className="card overflow-hidden scroll-mt-4">
          <div className="flex items-center gap-3 px-4 py-3 border-b border-gray-100 bg-gradient-to-r from-primary-700 to-indigo-800 text-white">
            <div className="w-10 h-10 rounded-full bg-gold-500 text-primary-900 font-black flex items-center justify-center">TM</div>
            <div className="flex-1">
              <div className="font-bold">TaxMate Solutions</div>
              <div className="text-[11px] text-primary-200">We usually reply within one working day</div>
            </div>
          </div>
          {clientId
            ? <ChatThread clientId={clientId} role="client" userId={user.id} height="h-[55vh]" draft={draft}
                emptyHint="Ask us anything about your tax return, documents or payments. Only TaxMate can read this." />
            : <div className="p-8 text-center text-sm text-gray-500">Your client profile is not linked yet. Please contact TaxMate.</div>}
        </div>

        <div className="space-y-3">
          <div className="flex items-center gap-2 text-sm font-bold text-gray-700"><Megaphone size={16} className="text-amber-600" /> Announcements</div>
          {news.length === 0 ? <div className="card p-6 text-center text-sm text-gray-400">No announcements yet</div>
            : shown.map(m => (
              <div key={m.id} className={`card p-4 relative overflow-hidden ${m.isNew ? 'border-gold-500 ring-2 ring-gold-500/30' : ''}`}>
                {m.isNew && <span className="absolute top-3 right-3 text-[9px] font-black uppercase bg-gold-500 text-primary-900 rounded px-1.5 py-0.5 flex items-center gap-0.5"><Sparkles size={9} /> New</span>}
                {m.title && <div className="font-bold text-gray-800 pr-12">{m.title}</div>}
                <LinkifiedText text={m.body} className="text-sm text-gray-700 whitespace-pre-wrap break-words mt-0.5" />
                <div className="flex items-center gap-2 mt-2">
                  <div className="text-[11px] text-gray-400 flex-1">📣 TaxMate · {timeLabel(m.created_at)}</div>
                  {clientId && <button onClick={() => replyTo(m)} className="text-xs font-semibold text-primary-700 hover:bg-primary-50 rounded-lg px-2 py-1 flex items-center gap-1"><Reply size={13} /> Reply privately</button>}
                </div>
              </div>
            ))}
          {news.length > 4 && <button onClick={() => setShowAll(s => !s)} className="text-xs font-semibold text-primary-700 hover:underline">{showAll ? 'Show less' : `Show all ${news.length}`}</button>}
        </div>
      </div>
    </div>
  );
}
