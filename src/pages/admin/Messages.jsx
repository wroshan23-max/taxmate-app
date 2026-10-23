import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import toast from 'react-hot-toast';
import {
  MessageCircle, Megaphone, Search, Plus, ArrowLeft, ExternalLink, Send, Loader2, Trash2, Eye, Users, X, AlertTriangle,
} from 'lucide-react';
import { supabase } from '../../lib/supabase';
import { useAuth } from '../../contexts/AuthContext';
import ChatThread from '../../components/ChatThread';
import LinkifiedText from '../../components/LinkifiedText';
import { useMessageFeed, timeLabel } from '../../lib/messages';
import { whatsappLink } from '../../lib/share';

const initials = (n = '?') => n.trim().split(/\s+/).slice(0, 2).map(w => w[0]).join('').toUpperCase();
const TONES = ['from-pink-500 to-rose-500', 'from-indigo-500 to-blue-600', 'from-emerald-500 to-teal-600', 'from-amber-500 to-orange-500', 'from-purple-500 to-fuchsia-500', 'from-sky-500 to-cyan-600'];
const tone = (id = '') => TONES[[...id].reduce((a, c) => a + c.charCodeAt(0), 0) % TONES.length];
const Avatar = ({ c, size = 'w-10 h-10 text-sm' }) => (
  <div className={`${size} rounded-full bg-gradient-to-br ${tone(c?.id)} text-white font-bold flex items-center justify-center flex-shrink-0`}>{initials(c?.full_name)}</div>
);

export default function Messages() {
  const { user } = useAuth();
  const [params, setParams] = useSearchParams();
  const [tab, setTab] = useState(params.get('tab') === 'announcements' ? 'announcements' : 'chats');
  const [clients, setClients] = useState([]);
  const [msgs, setMsgs] = useState([]);
  const [q, setQ] = useState('');
  const [picker, setPicker] = useState(false);
  const [globalOff, setGlobalOff] = useState(false);
  const sel = params.get('client');

  const load = useCallback(async () => {
    const [{ data: cl }, { data: m }, { data: st }] = await Promise.all([
      supabase.from('clients').select('id, full_name, mobile, email, profile_id, contact_name, contact_mobile, contact_preferred, feature_overrides').is('archived_at', null).order('full_name'),
      supabase.from('messages').select('id, client_id, sender_role, body, created_at, read_at').not('client_id', 'is', null).order('created_at', { ascending: false }).limit(1500),
      supabase.from('app_settings').select('value').eq('key', 'client_tools').maybeSingle(),
    ]);
    setClients(cl ?? []); setMsgs(m ?? []); setGlobalOff(st?.value?.messages === false);
  }, []);
  useEffect(() => { load(); }, [load]);
  useMessageFeed(() => setTimeout(load, 300), null, 'admin-inbox');

  const byId = useMemo(() => Object.fromEntries(clients.map(c => [c.id, c])), [clients]);
  const threads = useMemo(() => {
    const m = {};
    for (const x of msgs) {
      const t = (m[x.client_id] ??= { client_id: x.client_id, last: x, unread: 0, count: 0 });
      t.count++;
      if (x.sender_role === 'client' && !x.read_at) t.unread++;
    }
    return Object.values(m).filter(t => byId[t.client_id])
      .filter(t => !q || `${byId[t.client_id].full_name} ${byId[t.client_id].mobile ?? ''}`.toLowerCase().includes(q.toLowerCase()));
  }, [msgs, byId, q]);
  const unreadTotal = msgs.filter(x => x.sender_role === 'client' && !x.read_at).length;
  const open = (id) => { setParams(id ? { client: id } : {}); setPicker(false); };
  const current = sel ? byId[sel] : null;

  return (
    <div className="space-y-4">
      <div className="flex items-end gap-3 flex-wrap">
        <div>
          <h1 className="text-2xl font-bold text-primary-800">💬 Messages</h1>
          <p className="text-sm text-gray-500">Private chats with clients and announcements to everyone</p>
        </div>
        <div className="ml-auto flex gap-1 bg-gray-100 p-1 rounded-xl">
          {[['chats', MessageCircle, 'Chats', unreadTotal], ['announcements', Megaphone, 'Announcements', 0]].map(([k, Icon, label, n]) => (
            <button key={k} onClick={() => { setTab(k); setParams(k === 'announcements' ? { tab: k } : {}); }}
              className={`px-3.5 py-1.5 rounded-lg text-sm font-semibold flex items-center gap-1.5 transition-all ${tab === k ? 'bg-white text-primary-700 shadow-sm' : 'text-gray-500 hover:text-gray-700'}`}>
              <Icon size={15} /> {label}{n > 0 && <span className="text-[10px] font-black bg-red-500 text-white rounded-full px-1.5 min-w-[18px]">{n}</span>}
            </button>
          ))}
        </div>
      </div>

      {globalOff && (
        <div className="card p-3 text-sm bg-amber-50 border-amber-200 text-amber-800 flex items-center gap-2"><AlertTriangle size={15} /> Messages are switched OFF for clients (Settings → Client Portal). They can't see or reply until you turn it on.</div>
      )}

      {tab === 'chats' ? (
        <div className="card overflow-hidden grid md:grid-cols-[320px_1fr] min-h-[70vh]">
          {/* Thread list */}
          <div className={`border-r border-gray-100 flex flex-col min-h-0 ${current ? 'hidden md:flex' : 'flex'}`}>
            <div className="p-3 border-b border-gray-100 flex gap-2">
              <div className="relative flex-1">
                <Search size={14} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-gray-400" />
                <input className="input pl-8 py-2 text-sm" placeholder={picker ? 'Find a client…' : 'Search chats'} value={q} onChange={e => setQ(e.target.value)} autoFocus={picker} />
              </div>
              <button onClick={() => { setPicker(p => !p); setQ(''); }} title={picker ? 'Close' : 'New message'}
                className={`w-10 h-10 rounded-xl flex items-center justify-center flex-shrink-0 ${picker ? 'bg-gray-100 text-gray-600' : 'bg-primary-600 text-white hover:bg-primary-700'}`}>{picker ? <X size={18} /> : <Plus size={18} />}</button>
            </div>
            <div className="flex-1 overflow-y-auto max-h-[70vh]">
              {picker ? (
                <>
                  <div className="px-4 pt-3 pb-1 text-[11px] font-bold uppercase text-gray-400">Start a chat with…</div>
                  {clients.filter(c => !q || `${c.full_name} ${c.mobile ?? ''}`.toLowerCase().includes(q.toLowerCase())).slice(0, 100).map(c => (
                    <button key={c.id} onClick={() => open(c.id)} className="w-full flex items-center gap-3 px-4 py-2.5 hover:bg-primary-50 text-left">
                      <Avatar c={c} size="w-8 h-8 text-xs" />
                      <div className="flex-1 min-w-0"><div className="text-sm font-semibold text-gray-800 truncate">{c.full_name}</div>
                        <div className="text-[11px] text-gray-400">{c.profile_id ? '🟢 On the portal' : 'Not on the portal yet'}</div></div>
                    </button>
                  ))}
                </>
              ) : threads.length === 0 ? (
                <div className="p-8 text-center text-sm text-gray-400">
                  <MessageCircle size={32} className="mx-auto text-gray-200 mb-2" />No chats yet.<br />Tap <b>+</b> to message a client.
                </div>
              ) : threads.map(t => {
                const c = byId[t.client_id];
                const active = sel === t.client_id;
                return (
                  <button key={t.client_id} onClick={() => open(t.client_id)}
                    className={`w-full flex items-center gap-3 px-4 py-3 text-left border-l-4 transition-colors ${active ? 'bg-primary-50 border-primary-600' : 'border-transparent hover:bg-gray-50'}`}>
                    <Avatar c={c} />
                    <div className="flex-1 min-w-0">
                      <div className="flex items-baseline gap-2">
                        <span className={`text-sm truncate flex-1 ${t.unread ? 'font-black text-gray-900' : 'font-semibold text-gray-800'}`}>{c.full_name}</span>
                        <span className={`text-[10px] flex-shrink-0 ${t.unread ? 'text-primary-600 font-bold' : 'text-gray-400'}`}>{timeLabel(t.last.created_at)}</span>
                      </div>
                      <div className="flex items-center gap-2">
                        <span className={`text-xs truncate flex-1 ${t.unread ? 'text-gray-800 font-medium' : 'text-gray-500'}`}>{t.last.sender_role === 'admin' ? 'You: ' : ''}{t.last.body}</span>
                        {t.unread > 0 && <span className="text-[10px] font-black bg-gold-500 text-primary-900 rounded-full px-1.5 min-w-[18px] text-center">{t.unread}</span>}
                      </div>
                    </div>
                  </button>
                );
              })}
            </div>
          </div>

          {/* Conversation */}
          <div className={`flex flex-col min-h-0 ${current ? 'flex' : 'hidden md:flex'}`}>
            {current ? (
              <>
                <div className="flex items-center gap-3 px-4 py-3 border-b border-gray-100 bg-white">
                  <button onClick={() => open(null)} className="md:hidden p-1 -ml-1 text-gray-500"><ArrowLeft size={20} /></button>
                  <Avatar c={current} size="w-9 h-9 text-xs" />
                  <div className="flex-1 min-w-0">
                    <div className="font-bold text-gray-800 truncate">{current.full_name}</div>
                    <div className="text-[11px] text-gray-400">{current.profile_id ? (current.feature_overrides?.messages === false ? '⚠️ Messages switched off for this client' : '🟢 Sees this in the portal') : '⚠️ Not on the portal — send a WhatsApp too'}</div>
                  </div>
                  {(() => {
                    const phone = current.contact_preferred && current.contact_mobile ? current.contact_mobile : current.mobile || current.contact_mobile;
                    return phone ? (
                      <a href={whatsappLink(phone, `Hi ${current.full_name.split(' ')[0]}, you have a new message from TaxMate 📩\nPlease open: ${window.location.origin}/client/messages`)} target="_blank" rel="noreferrer"
                        title="Tell the client on WhatsApp" className="btn-secondary text-xs py-1.5 !text-[#128C7E]"><Send size={13} /> <span className="hidden sm:inline">Notify on WhatsApp</span></a>
                    ) : null;
                  })()}
                  <Link to={`/admin/clients/${current.id}`} title="Open client" className="p-2 rounded-lg text-gray-500 hover:bg-gray-100"><ExternalLink size={16} /></Link>
                </div>
                <ChatThread key={current.id} clientId={current.id} role="admin" userId={user?.id} height="h-[58vh]" clientName={current.full_name}
                  emptyHint={`Write to ${current.full_name.split(' ')[0]}. Only they will see it.`} onSent={() => load()} />
              </>
            ) : (
              <div className="flex-1 flex flex-col items-center justify-center text-center p-8 text-gray-400">
                <div className="w-20 h-20 rounded-3xl bg-primary-50 flex items-center justify-center text-4xl">💬</div>
                <div className="mt-3 font-semibold text-gray-600">Choose a chat</div>
                <div className="text-sm">or tap <b>+</b> to message a client privately</div>
              </div>
            )}
          </div>
        </div>
      ) : <Announcements userId={user?.id} clients={clients} />}
    </div>
  );
}

function Announcements({ userId, clients }) {
  const [list, setList] = useState([]);
  const [title, setTitle] = useState('');
  const [body, setBody] = useState('');
  const [busy, setBusy] = useState(false);
  const [confirm, setConfirm] = useState(false);
  const portal = clients.filter(c => c.profile_id).length;

  const load = async () => {
    const { data } = await supabase.from('messages').select('*, message_reads(count)').is('client_id', null).order('created_at', { ascending: false }).limit(100);
    setList(data ?? []);
  };
  useEffect(() => { load(); }, []);

  const send = async () => {
    setBusy(true);
    const { error } = await supabase.from('messages').insert({ client_id: null, sender_role: 'admin', sender_id: userId, title: title.trim() || null, body: body.trim() });
    setBusy(false); setConfirm(false);
    if (error) return toast.error(error.message);
    toast.success('Announcement sent to all clients 📣');
    setTitle(''); setBody(''); load();
  };
  const del = async (m) => {
    if (!window.confirm('Delete this announcement for everyone?')) return;
    const { error } = await supabase.from('messages').delete().eq('id', m.id);
    if (error) return toast.error(error.message);
    setList(l => l.filter(x => x.id !== m.id));
  };

  return (
    <div className="grid lg:grid-cols-[minmax(0,1fr)_minmax(0,1.2fr)] gap-4 items-start">
      <div className="card overflow-hidden">
        <div className="bg-gradient-to-br from-primary-700 to-indigo-800 text-white px-5 py-4">
          <div className="font-bold flex items-center gap-2"><Megaphone size={18} /> New announcement</div>
          <div className="text-xs text-primary-200">Every client sees this in Messages and on their dashboard. If they reply, it comes to your private chat with them.</div>
        </div>
        <div className="p-5 space-y-3">
          <input className="input" maxLength={120} placeholder="Title (optional) — e.g. Income tax return deadline 30 Nov" value={title} onChange={e => setTitle(e.target.value)} />
          <textarea className="input resize-none" rows={6} maxLength={2000} placeholder="Message to all clients… (links are clickable)" value={body} onChange={e => setBody(e.target.value)} />
          <div className="flex items-center gap-2">
            <span className="text-[11px] text-gray-400 flex items-center gap-1"><Users size={12} /> {portal} clients on the portal · {body.length}/2000</span>
            {!confirm
              ? <button disabled={!body.trim()} onClick={() => setConfirm(true)} className="btn-primary ml-auto text-sm"><Send size={14} /> Send to all</button>
              : <div className="ml-auto flex gap-2"><button onClick={() => setConfirm(false)} className="btn-secondary text-sm">Cancel</button>
                  <button disabled={busy} onClick={send} className="btn-primary text-sm !bg-gold-500 !text-primary-900">{busy ? <Loader2 size={14} className="animate-spin" /> : <Megaphone size={14} />} Yes, send to {portal}</button></div>}
          </div>
        </div>
      </div>

      <div className="space-y-3">
        {list.length === 0 ? <div className="card p-10 text-center text-sm text-gray-400"><Megaphone size={32} className="mx-auto text-gray-200 mb-2" />No announcements yet</div>
          : list.map(m => {
            const seen = m.message_reads?.[0]?.count ?? 0;
            const pct = portal ? Math.min(100, Math.round((seen / portal) * 100)) : 0;
            return (
              <div key={m.id} className="card p-4">
                <div className="flex items-start gap-3">
                  <div className="w-9 h-9 rounded-xl bg-gold-500/20 text-amber-700 flex items-center justify-center flex-shrink-0"><Megaphone size={17} /></div>
                  <div className="flex-1 min-w-0">
                    {m.title && <div className="font-bold text-gray-800">{m.title}</div>}
                    <LinkifiedText text={m.body} className="text-sm text-gray-700 whitespace-pre-wrap break-words" />
                    <div className="mt-2 flex items-center gap-2 text-[11px] text-gray-400">
                      <span>{timeLabel(m.created_at)}</span>
                      <span className="flex items-center gap-1"><Eye size={11} /> Seen by {seen}{portal ? ` of ${portal}` : ''}</span>
                      <div className="flex-1 max-w-[120px] h-1.5 rounded-full bg-gray-100 overflow-hidden"><div className="h-full bg-emerald-500 rounded-full" style={{ width: `${pct}%` }} /></div>
                    </div>
                  </div>
                  <button onClick={() => del(m)} title="Delete" className="p-1.5 rounded-lg text-gray-300 hover:text-red-600 hover:bg-red-50"><Trash2 size={14} /></button>
                </div>
              </div>
            );
          })}
      </div>
    </div>
  );
}
