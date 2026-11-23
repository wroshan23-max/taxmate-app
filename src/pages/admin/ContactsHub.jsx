// V75 — Contacts hub: Phone Book · Groups · Broadcast · Call Log · Messages in one place
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { BookUser, Users, Send, PhoneCall, MessageCircle, Loader2, AlertTriangle, RefreshCw } from 'lucide-react';
import PhoneBook from '../../components/contacts/PhoneBook';
import Groups from '../../components/contacts/Groups';
import Broadcast from '../../components/contacts/Broadcast';
import CallLog from './CallLog';
import Messages from './Messages';
import { usePhoneBook, allGroups } from '../../lib/contactsHub';
import { useUnreadMessages } from '../../lib/messages';

const VIEWS = [
  ['book', 'Phone Book', BookUser],
  ['groups', 'Groups', Users],
  ['broadcast', 'Broadcast', Send],
  ['calls', 'Call Log', PhoneCall],
  ['messages', 'Messages', MessageCircle],
];

export default function ContactsHub() {
  const [sp, setSp] = useSearchParams();
  const view = VIEWS.some(([k]) => k === sp.get('view')) ? sp.get('view') : 'book';
  const { book, error, reload } = usePhoneBook();
  const unread = useUnreadMessages('admin');
  const [preset, setPreset] = useState(null);
  const prev = useRef(view);
  // the Call Log / chats may have changed the numbers — refresh when coming back
  useEffect(() => { if (['calls', 'messages'].includes(prev.current) && !['calls', 'messages'].includes(view)) reload(); prev.current = view; }, [view, reload]);

  const go = useCallback((v, extra = {}) => setSp({ view: v, ...extra }), [setSp]);
  const groupRef = sp.get('group');
  const clearPreset = useCallback(() => setPreset(null), []);
  const onMessage = useCallback((contacts) => { setPreset({ keys: contacts.map((c) => c.key) }); go('broadcast'); }, [go]);
  const onMessageGroup = useCallback((ref) => { setPreset({ refs: [ref] }); go('broadcast'); }, [go]);
  const onChat = useCallback((clientId) => go('messages', { client: clientId }), [go]);
  const onLogCall = useCallback((c) => go('calls', { new: '1', phone: c.phone || '', ...(c.unnamed ? {} : { name: c.name }) }), [go]);

  const stats = useMemo(() => {
    const live = (book?.contacts || []).filter((c) => !c.archived);
    const now = Date.now(), endToday = new Date(new Date(now + 5.5 * 3600e3).toISOString().slice(0, 10) + 'T23:59:59+05:30').getTime();
    return {
      clients: live.filter((c) => c.kind === 'client').length,
      portal: live.filter((c) => c.kind === 'client' && c.portal).length,
      leads: live.filter((c) => c.kind === 'lead').length,
      groups: allGroups(book).filter((g) => !g.smart).length,
      due: live.filter((c) => c.followUp?.follow_up_at && new Date(c.followUp.follow_up_at).getTime() <= endToday).length,
    };
  }, [book]);
  const badge = { messages: unread, calls: stats.due };

  return (
    <div className="space-y-4">
      {/* Hero */}
      <div className="relative overflow-hidden rounded-2xl bg-gradient-to-br from-primary-900 via-primary-800 to-indigo-900 px-4 py-4 text-white shadow-lg sm:px-6 sm:py-5">
        <div className="pointer-events-none absolute -right-16 -top-20 h-56 w-56 rounded-full bg-gold-500/25 blur-3xl" />
        <div className="pointer-events-none absolute -bottom-24 left-1/3 h-48 w-48 rounded-full bg-sky-400/20 blur-3xl" />
        <div className="relative flex items-center gap-3 sm:gap-4">
          <div className="flex h-11 w-11 flex-shrink-0 items-center justify-center rounded-2xl bg-gradient-to-br from-gold-400 to-gold-600 text-2xl shadow-lg sm:h-14 sm:w-14 sm:text-3xl">📇</div>
          <div className="min-w-0 flex-1">
            <h1 className="text-2xl font-bold tracking-tight">Contacts</h1>
            <p className="hidden text-sm text-primary-100 sm:block">Phone book, groups, broadcasts, calls and chats — all in one place.</p>
          </div>
          <button type="button" onClick={reload} className="rounded-xl bg-white/10 p-2 text-primary-100 hover:bg-white/20" title="Refresh" aria-label="Refresh"><RefreshCw size={16} /></button>
        </div>
        <div className="relative -mx-4 mt-3 flex gap-2 overflow-x-auto px-4 pb-1 sm:mx-0 sm:mt-4 sm:grid sm:grid-cols-5 sm:overflow-visible sm:px-0 sm:pb-0">
          {[['👥', 'Clients', stats.clients, 'book'], ['🟢', 'On portal', stats.portal, 'book'], ['📞', 'Leads', stats.leads, 'book'], ['🗂️', 'Groups', stats.groups, 'groups'], ['⏰', 'Call backs', stats.due, 'calls']].map(([e, l, n, v]) => (
            <button key={l} type="button" onClick={() => go(v, v === 'calls' ? { tab: 'follow' } : {})} className="min-w-[96px] shrink-0 rounded-xl bg-white/10 px-3 py-2 text-left backdrop-blur transition hover:bg-white/20 sm:min-w-0">
              <div className="whitespace-nowrap text-[11px] text-primary-100">{e} {l}</div>
              <div className="text-xl font-black tabular-nums">{book ? n.toLocaleString() : '—'}</div>
            </button>
          ))}
        </div>
      </div>

      {/* Tabs */}
      <div className="sticky top-0 z-20 -mx-1 overflow-x-auto px-1 py-1">
        <div className="flex w-max min-w-full gap-1 rounded-2xl border border-gray-100 bg-white/95 p-1 shadow-sm backdrop-blur">
          {VIEWS.map(([k, l, I]) => {
            const on = view === k; const n = badge[k];
            return (
              <button key={k} type="button" onClick={() => go(k)} aria-current={on ? 'page' : undefined}
                className={`relative flex flex-1 items-center justify-center gap-1.5 whitespace-nowrap rounded-xl px-3.5 py-2 text-sm font-semibold transition ${on ? 'bg-gradient-to-r from-primary-700 to-indigo-700 text-white shadow-md' : 'text-gray-600 hover:bg-gray-50 hover:text-primary-700'}`}>
                <I size={16} /> {l}
                {n > 0 && <span className={`min-w-[18px] rounded-full px-1.5 text-center text-[10px] font-black ${on ? 'bg-gold-400 text-primary-900' : k === 'messages' ? 'bg-red-500 text-white' : 'bg-amber-500 text-white'}`}>{n}</span>}
              </button>
            );
          })}
        </div>
      </div>

      {view === 'calls' ? <CallLog embedded />
        : view === 'messages' ? <Messages embedded />
        : error ? (
          <div className="card flex items-center gap-2 border-red-200 bg-red-50 p-4 text-sm text-red-800"><AlertTriangle size={16} /> {error} <button type="button" onClick={reload} className="ml-auto underline">Try again</button></div>
        ) : !book ? (
          <div className="card flex h-64 items-center justify-center gap-2 text-gray-400"><Loader2 className="animate-spin" /> Loading contacts…</div>
        ) : view === 'groups' ? <Groups book={book} reload={reload} onOpenGroup={(ref) => go('book', { group: ref })} onMessageGroup={onMessageGroup} />
        : view === 'broadcast' ? <Broadcast book={book} preset={preset} clearPreset={clearPreset} onChat={onChat} />
        : <PhoneBook book={book} reload={reload} onMessage={onMessage} onChat={onChat} onLogCall={onLogCall} groupRef={groupRef}
            setGroupRef={(ref) => setSp(ref ? { view: 'book', group: ref } : { view: 'book' }, { replace: true })} />}
    </div>
  );
}

