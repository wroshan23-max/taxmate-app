import { Fragment, useCallback, useEffect, useRef, useState } from 'react';
import toast from 'react-hot-toast';
import { Send, Loader2, CheckCheck, Check, Lock } from 'lucide-react';
import { supabase } from '../lib/supabase';
import { useMessageFeed, timeLabel, dayLabel } from '../lib/messages';
import { logActivity } from '../lib/activity';
import LinkifiedText from './LinkifiedText';

/**
 * Private chat between TaxMate and one client.
 *  role: who is looking ('admin' | 'client')
 */
export default function ChatThread({ clientId, role, userId, onSent, emptyHint, height = 'h-[60vh]', clientName, draft }) {
  const [msgs, setMsgs] = useState([]);
  const [loading, setLoading] = useState(true);
  const [text, setText] = useState('');
  const [sending, setSending] = useState(false);
  const end = useRef(), box = useRef(), ta = useRef();
  const other = role === 'admin' ? 'client' : 'admin';

  const markRead = useCallback(async () => {
    if (role === 'admin') await supabase.from('messages').update({ read_at: new Date().toISOString() }).eq('client_id', clientId).eq('sender_role', 'client').is('read_at', null);
    else await supabase.rpc('mark_my_messages_read');
  }, [clientId, role]);

  const load = useCallback(async () => {
    const { data, error } = await supabase.from('messages').select('*').eq('client_id', clientId).order('created_at', { ascending: true }).limit(500);
    if (error) toast.error(error.message);
    setMsgs(data ?? []);
    setLoading(false);
    markRead();
  }, [clientId, markRead]);
  useEffect(() => { setLoading(true); setMsgs([]); load(); }, [load]);

  useMessageFeed((p) => {
    const m = p.new;
    if (!m || m.client_id !== clientId) return;
    setMsgs(list => {
      const i = list.findIndex(x => x.id === m.id);
      if (i >= 0) { const c = [...list]; c[i] = m; return c; }
      return p.eventType === 'INSERT' ? [...list, m] : list;
    });
    if (p.eventType === 'INSERT' && m.sender_role === other) markRead();
  }, `client_id=eq.${clientId}`, `thread-${clientId}`);

  useEffect(() => { end.current?.scrollIntoView({ block: 'end' }); }, [msgs.length, loading]);
  // Prefill (e.g. "Reply privately" to an announcement)
  useEffect(() => {
    if (!draft?.text) return;
    setText(draft.text);
    setTimeout(() => { const el = ta.current; if (!el) return; el.focus(); el.setSelectionRange(el.value.length, el.value.length); el.style.height = 'auto'; el.style.height = `${Math.min(el.scrollHeight, 160)}px`; }, 50);
  }, [draft?.key]); // eslint-disable-line react-hooks/exhaustive-deps

  const send = async () => {
    const body = text.trim();
    if (!body || sending) return;
    if (body.length > 2000) return toast.error('Message is too long (2,000 characters max)');
    setSending(true);
    const { data, error } = await supabase.from('messages').insert({ client_id: clientId, sender_role: role, sender_id: userId, body }).select().single();
    setSending(false);
    if (error) return toast.error(/row-level/.test(error.message) ? 'Could not send — please try again later' : error.message);
    setMsgs(list => (list.some(x => x.id === data.id) ? list : [...list, data]));
    setText('');
    if (ta.current) ta.current.style.height = '';
    if (role === 'client') logActivity('message', '/client/messages');
    onSent?.(data);
  };

  return (
    <div className="flex flex-col min-h-0">
      <div ref={box} className={`${height} overflow-y-auto px-3 sm:px-5 py-4 space-y-1.5 bg-[radial-gradient(circle_at_1px_1px,rgba(30,58,138,0.06)_1px,transparent_0)] [background-size:18px_18px] bg-gray-50/60`}>
        {loading ? <div className="h-full flex items-center justify-center text-gray-400"><Loader2 className="animate-spin" /></div>
          : msgs.length === 0 ? (
            <div className="h-full flex flex-col items-center justify-center text-center px-6">
              <div className="text-4xl">💬</div>
              <div className="mt-2 font-semibold text-gray-700">No messages yet</div>
              <div className="text-sm text-gray-500 max-w-xs">{emptyHint ?? 'Send a message to start the conversation.'}</div>
            </div>
          ) : msgs.map((m, i) => {
            const mine = m.sender_role === role;
            const newDay = i === 0 || new Date(m.created_at).toDateString() !== new Date(msgs[i - 1].created_at).toDateString();
            const grouped = i > 0 && msgs[i - 1].sender_role === m.sender_role && !newDay && (new Date(m.created_at) - new Date(msgs[i - 1].created_at)) < 5 * 60000;
            return (
              <Fragment key={m.id}>
                {newDay && <div className="flex justify-center py-2"><span className="text-[11px] font-semibold text-gray-500 bg-white border border-gray-200 rounded-full px-3 py-0.5 shadow-sm">{dayLabel(m.created_at)}</span></div>}
                <div className={`flex ${mine ? 'justify-end' : 'justify-start'} ${grouped ? '' : 'pt-1.5'}`}>
                  <div className={`max-w-[82%] sm:max-w-[70%] px-3.5 py-2 shadow-sm text-[15px] leading-snug whitespace-pre-wrap break-words
                    ${mine ? 'bg-gradient-to-br from-primary-600 to-primary-700 text-white rounded-2xl rounded-br-md' : 'bg-white text-gray-800 border border-gray-100 rounded-2xl rounded-bl-md'}`}>
                    {!mine && !grouped && <div className={`text-[11px] font-bold mb-0.5 ${role === 'client' ? 'text-amber-600' : 'text-primary-700'}`}>{m.sender_role === 'admin' ? 'TaxMate' : (clientName?.split(' ')[0] || 'Client')}</div>}
                    <LinkifiedText text={m.body} linkClassName={mine ? 'underline text-white' : 'underline text-primary-700'} />
                    <div className={`flex items-center justify-end gap-1 mt-0.5 text-[10px] ${mine ? 'text-primary-200' : 'text-gray-400'}`}>
                      {timeLabel(m.created_at)}
                      {mine && (m.read_at ? <CheckCheck size={13} className="text-sky-300" title="Seen" /> : <Check size={13} title="Sent" />)}
                    </div>
                  </div>
                </div>
              </Fragment>
            );
          })}
        <div ref={end} />
      </div>

      <div className="border-t border-gray-100 bg-white p-2.5 sm:p-3">
        <div className="flex items-end gap-2">
          <textarea ref={ta} rows={1} value={text} maxLength={2000}
            placeholder={role === 'client' ? 'Message TaxMate… · පණිවිඩයක් ලියන්න' : 'Write a reply…'}
            className="input flex-1 resize-none py-2.5 max-h-40 leading-snug"
            onChange={e => { setText(e.target.value); e.target.style.height = 'auto'; e.target.style.height = `${Math.min(e.target.scrollHeight, 160)}px`; }}
            onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing && window.innerWidth >= 640) { e.preventDefault(); send(); } }} />
          <button onClick={send} disabled={!text.trim() || sending} title="Send"
            className="h-11 w-11 flex-shrink-0 rounded-full bg-gold-500 text-primary-900 flex items-center justify-center shadow-md hover:brightness-95 disabled:opacity-40 transition-all active:scale-95">
            {sending ? <Loader2 size={18} className="animate-spin" /> : <Send size={18} />}
          </button>
        </div>
        {role === 'client' && <div className="text-[10px] text-gray-400 mt-1.5 flex items-center gap-1"><Lock size={10} /> Private — only you and TaxMate can see this chat.</div>}
      </div>
    </div>
  );
}
