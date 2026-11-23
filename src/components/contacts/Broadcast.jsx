// V75 — Broadcast: one message to a group / selection — portal + phone alert now,
// WhatsApp · SMS · email one by one from a tick-off queue
import { useEffect, useMemo, useRef, useState } from 'react';
import toast from 'react-hot-toast';
import {
  Send, Loader2, CheckCircle2, ArrowLeft, Search, Megaphone, MessageCircle, MessageSquare, Mail, Bell, ChevronRight,
  Trash2, Wand2, UserPlus, History, Square, CheckSquare, RotateCcw, Copy,
} from 'lucide-react';
import { Modal } from '../vat/ui';
import { Avatar } from './ui';
import { useAuth } from '../../contexts/AuthContext';
import { waLink } from '../../lib/callLog';
import {
  allGroups, membersOf, CHANNEL_INFO, TEMPLATES, personalize, greetOf, reachOf, sendBroadcast, loadBroadcasts, loadRecipients, markSent, deleteBroadcast,
  smsLink, mailLink,
} from '../../lib/contactsHub';
import { timeLabel } from '../../lib/messages';

const ICON = { portal: Bell, whatsapp: MessageCircle, sms: MessageSquare, email: Mail };
const smsParts = (t) => { const u = /[^ -~\n\r]/.test(t); const len = [...t].length; if (!len) return 0; const one = u ? 70 : 160, multi = u ? 67 : 153; return len <= one ? 1 : Math.ceil(len / multi); };

const Step = ({ n, title: t, children, right }) => (
  <div className="card overflow-hidden">
    <div className="flex items-center gap-3 border-b border-gray-100 px-4 py-3">
      <span className="flex h-7 w-7 items-center justify-center rounded-full bg-primary-700 text-xs font-black text-white">{n}</span>
      <span className="font-bold text-primary-800">{t}</span><span className="ml-auto">{right}</span>
    </div>
    <div className="p-4">{children}</div>
  </div>
);

export default function Broadcast({ book, preset, clearPreset, onChat }) {
  const { user } = useAuth();
  const [refs, setRefs] = useState(() => new Set());
  const [picked, setPicked] = useState([]);          // contact keys added one by one
  const [skip, setSkip] = useState(() => new Set());
  const [channels, setChannels] = useState(() => new Set(['portal', 'whatsapp']));
  const [title, setTitle] = useState('');
  const [body, setBody] = useState('');
  const [pick, setPick] = useState(false);
  const [confirm, setConfirm] = useState(false);
  const [busy, setBusy] = useState(false);
  const [queue, setQueue] = useState(null);           // broadcast row
  const [hist, setHist] = useState(null);
  const [showList, setShowList] = useState(false);
  const ta = useRef(null);
  const groups = useMemo(() => allGroups(book), [book]);

  // arriving from the phone book / groups ("Message selected" / "Message group")
  useEffect(() => {
    if (!preset) return;
    if (preset.refs) { setRefs(new Set(preset.refs)); setPicked([]); }
    if (preset.keys) { setPicked(preset.keys); setRefs(new Set()); }
    setSkip(new Set());
    clearPreset();
  }, [preset, clearPreset]);
  const loadHist = () => loadBroadcasts().then(setHist).catch(() => setHist([]));
  useEffect(() => { loadHist(); }, []);

  const people = useMemo(() => {
    const m = new Map();
    for (const r of refs) for (const c of membersOf(book, r)) m.set(c.key, c);
    for (const k of picked) { const c = book.contacts.find((x) => x.key === k); if (c) m.set(k, c); }
    return [...m.values()].sort((a, b) => a.name.localeCompare(b.name));
  }, [refs, picked, book]);
  const to = people.filter((c) => !skip.has(c.key));
  const stat = {
    portal: to.filter((c) => c.kind === 'client' && c.portal && !c.messagesOff).length,
    whatsapp: to.filter((c) => reachOf(c).phone).length,
    sms: to.filter((c) => reachOf(c).phone).length,
    email: to.filter((c) => reachOf(c).email).length,
  };
  const ch = [...channels];
  const sample = to[0];
  const previewText = personalize(body || 'Type your message…', sample ? greetOf(sample) : 'Kasun');
  const audienceLabel = [...[...refs].map((r) => groups.find((g) => g.ref === r)?.name).filter(Boolean), picked.length ? `${picked.length} picked` : null].filter(Boolean).join(' + ');

  const toggleCh = (k) => setChannels((s) => { const n = new Set(s); if (n.has(k)) n.delete(k); else n.add(k); return n; });
  const insertName = () => {
    const el = ta.current; const s = el?.selectionStart ?? body.length, e = el?.selectionEnd ?? body.length;
    const next = `${body.slice(0, s)}{name}${body.slice(e)}`; setBody(next.slice(0, 1900));
    setTimeout(() => { el?.focus(); el?.setSelectionRange(s + 6, s + 6); }, 0);
  };
  const applyTemplate = (t) => { if (body.trim() && !window.confirm('Replace the message with this template?')) return; setTitle(t.title); setBody(t.body); };

  const send = async () => {
    setBusy(true);
    try {
      const r = await sendBroadcast({ title, body, channels: ch, audience: audienceLabel, contacts: to });
      toast.success(channels.has('portal') ? `Sent to ${r.portal_sent} portal inbox${r.portal_sent === 1 ? '' : 'es'} 🔔` : 'Message list ready');
      setConfirm(false);
      await loadHist();
      if (ch.some((k) => k !== 'portal')) setQueue({ id: r.id, title, body, channels: ch, total: r.total, portal_sent: r.portal_sent, created_at: new Date().toISOString(), audience: audienceLabel });
      setTitle(''); setBody(''); setRefs(new Set()); setPicked([]); setSkip(new Set());
    } catch (e) { toast.error(e.message); }
    setBusy(false);
  };

  if (queue) return <Queue b={queue} onBack={() => { setQueue(null); loadHist(); }} onChat={onChat} />;

  return (
    <div className="grid items-start gap-4 xl:grid-cols-[minmax(0,1fr)_380px]">
      <div className="space-y-4">
        {/* 1 · Who */}
        <Step n="1" title="Who gets it?" right={<span className="rounded-full bg-primary-50 px-2.5 py-0.5 text-xs font-bold text-primary-800">{to.length} {to.length === 1 ? 'person' : 'people'}</span>}>
          <div className="flex flex-wrap gap-1.5">
            {groups.filter((g) => g.count > 0).map((g) => {
              const on = refs.has(g.ref);
              return (
                <button key={g.ref} type="button" onClick={() => setRefs((s) => { const n = new Set(s); if (n.has(g.ref)) n.delete(g.ref); else n.add(g.ref); return n; })}
                  className={`flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs font-semibold transition ${on ? 'border-primary-600 bg-primary-600 text-white shadow' : 'border-gray-200 bg-white text-gray-700 hover:border-primary-300'}`}>
                  <span>{g.emoji}</span>{g.name}<span className={`rounded-full px-1.5 text-[10px] ${on ? 'bg-white/20' : 'bg-gray-100 text-gray-500'}`}>{g.count}</span>
                </button>
              );
            })}
            <button type="button" onClick={() => setPick(true)} className="flex items-center gap-1 rounded-full border border-dashed border-primary-300 px-2.5 py-1 text-xs font-semibold text-primary-700 hover:bg-primary-50"><UserPlus size={13} /> Pick people{picked.length ? ` (${picked.length})` : ''}</button>
            {(refs.size > 0 || picked.length > 0) && <button type="button" onClick={() => { setRefs(new Set()); setPicked([]); setSkip(new Set()); }} className="px-2 text-xs text-gray-400 hover:text-red-600">Clear</button>}
          </div>
          {people.length > 0 && (
            <div className="mt-3 rounded-xl bg-gray-50 p-3">
              <div className="flex items-center gap-2">
                <div className="flex -space-x-2">{to.slice(0, 8).map((c) => <Avatar key={c.key} c={c} size="h-7 w-7 text-[10px]" ring="ring-2 ring-white" />)}</div>
                <span className="text-xs text-gray-600">{to.slice(0, 3).map((c) => c.name.split(' ')[0]).join(', ')}{to.length > 3 ? ` and ${to.length - 3} more` : ''}</span>
                <button type="button" onClick={() => setShowList((v) => !v)} className="ml-auto text-xs font-semibold text-primary-700">{showList ? 'Hide list' : 'Review list'}</button>
              </div>
              {skip.size > 0 && <div className="mt-1 text-[11px] text-amber-700">{skip.size} unticked — they won’t get it.</div>}
              {showList && (
                <div className="mt-2 max-h-64 divide-y divide-gray-100 overflow-y-auto rounded-lg border border-gray-100 bg-white">
                  {people.map((c) => { const off = skip.has(c.key); const r = reachOf(c); return (
                    <button key={c.key} type="button" onClick={() => setSkip((s) => { const n = new Set(s); if (n.has(c.key)) n.delete(c.key); else n.add(c.key); return n; })} className={`flex w-full items-center gap-2 px-3 py-1.5 text-left text-xs ${off ? 'opacity-50' : ''}`}>
                      {off ? <Square size={14} className="text-gray-300" /> : <CheckSquare size={14} className="text-primary-600" />}
                      <span className="min-w-0 flex-1 truncate font-medium text-gray-800">{c.name}</span>
                      <span title="Portal" className={c.kind === 'client' && c.portal && !c.messagesOff ? '' : 'opacity-20'}>🔔</span>
                      <span title="Phone" className={r.phone ? '' : 'opacity-20'}>📱</span>
                      <span title="Email" className={r.email ? '' : 'opacity-20'}>📧</span>
                    </button>); })}
                </div>
              )}
            </div>
          )}
        </Step>

        {/* 2 · How */}
        <Step n="2" title="How to send">
          <div className="grid gap-2 sm:grid-cols-2">
            {Object.entries(CHANNEL_INFO).map(([k, v]) => {
              const on = channels.has(k); const I = ICON[k];
              return (
                <button key={k} type="button" onClick={() => toggleCh(k)} className={`flex items-start gap-3 rounded-xl border-2 p-3 text-left transition ${on ? 'border-primary-600 bg-primary-50/60' : 'border-gray-100 hover:border-gray-300'}`}>
                  <span className={`flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-xl ${on ? 'bg-primary-600 text-white' : 'bg-gray-100 text-gray-500'}`}><I size={18} /></span>
                  <span className="min-w-0 flex-1"><span className="flex items-center gap-2 text-sm font-bold text-gray-800">{v.label}<span className={`ml-auto rounded-full px-1.5 text-[10px] font-bold ${on ? 'bg-primary-600 text-white' : 'bg-gray-100 text-gray-500'}`}>{stat[k]}</span></span>
                    <span className="block text-[11px] leading-snug text-gray-500">{v.hint}</span></span>
                </button>
              );
            })}
          </div>
          {channels.has('portal') && to.length > 0 && stat.portal < to.length && <p className="mt-2 text-[11px] text-amber-700">🔔 {to.length - stat.portal} of them can’t open the portal — add WhatsApp or SMS so they get it too.</p>}
        </Step>

        {/* 3 · What */}
        <Step n="3" title="Message" right={<span className="text-[11px] text-gray-400">{body.length}/1900{channels.has('sms') && body ? ` · SMS ${smsParts(personalize(body, 'Kasun'))} part${smsParts(personalize(body, 'Kasun')) > 1 ? 's' : ''}` : ''}</span>}>
          <div className="-mx-1 mb-3 flex gap-1.5 overflow-x-auto px-1 pb-1">
            {TEMPLATES.map((t) => <button key={t.key} type="button" onClick={() => applyTemplate(t)} className="flex shrink-0 items-center gap-1 rounded-lg border border-gray-200 bg-white px-2.5 py-1.5 text-xs font-medium text-gray-700 hover:border-gold-400 hover:bg-amber-50"><span>{t.emoji}</span>{t.name}</button>)}
          </div>
          {channels.has('portal') && <input className="input mb-2" maxLength={110} placeholder="Title (portal & notification) — e.g. IIT deadline 30 Nov" value={title} onChange={(e) => setTitle(e.target.value)} />}
          <textarea ref={ta} className="input min-h-[190px] resize-y font-[inherit] leading-relaxed" maxLength={1900} placeholder={'Dear {name},\n\nWrite your message…  (English / සිංහල)'} value={body} onChange={(e) => setBody(e.target.value)} />
          <div className="mt-2 flex flex-wrap items-center gap-2">
            <button type="button" onClick={insertName} className="flex items-center gap-1 rounded-lg bg-violet-50 px-2.5 py-1.5 text-xs font-semibold text-violet-700 hover:bg-violet-100"><Wand2 size={13} /> Insert {'{name}'}</button>
            <span className="text-[11px] text-gray-400">{'{name}'} becomes each person’s first name (or their contact person’s).</span>
          </div>
        </Step>
      </div>

      {/* Preview + send */}
      <div className="space-y-4 xl:sticky xl:top-4">
        <div className="card overflow-hidden">
          <div className="bg-gradient-to-br from-primary-800 to-indigo-900 p-5">
            <div className="mx-auto w-full max-w-[300px] rounded-[2rem] border-[6px] border-gray-900 bg-[#ECE5DD] shadow-2xl">
              <div className="flex items-center gap-2 rounded-t-[1.6rem] bg-[#075E54] px-3 py-2 text-white">
                <div className="flex h-7 w-7 items-center justify-center rounded-full bg-gold-500 text-[11px] font-black text-primary-900">TM</div>
                <div className="min-w-0 flex-1"><div className="truncate text-xs font-bold">TaxMate Solutions</div><div className="text-[9px] opacity-80">to {sample ? greetOf(sample) || sample.name : 'your client'}</div></div>
              </div>
              <div className="max-h-[320px] space-y-2 overflow-y-auto p-3">
                {channels.has('portal') && (
                  <div className="rounded-xl bg-white/95 p-2 shadow-sm"><div className="flex items-center gap-1 text-[10px] font-bold text-gray-500"><Bell size={10} /> TaxMate portal · now</div><div className="truncate text-xs font-bold text-gray-800">💬 {personalize(title, sample ? greetOf(sample) : 'Kasun') || 'New message from TaxMate'}</div><div className="line-clamp-2 text-[11px] text-gray-600">{previewText}</div></div>
                )}
                <div className="ml-auto max-w-[92%] whitespace-pre-wrap break-words rounded-lg rounded-tr-none bg-[#DCF8C6] px-2.5 py-1.5 text-[12px] leading-snug text-gray-900 shadow-sm">{previewText}<div className="mt-0.5 text-right text-[9px] text-gray-500">now ✓✓</div></div>
              </div>
            </div>
          </div>
          <div className="space-y-3 p-4">
            <div className="grid grid-cols-4 gap-2 text-center">
              {Object.keys(CHANNEL_INFO).map((k) => { const I = ICON[k]; const on = channels.has(k); return (
                <div key={k} className={`rounded-xl p-2 ${on ? 'bg-primary-50' : 'bg-gray-50 opacity-40'}`}><I size={15} className="mx-auto text-primary-700" /><div className="text-lg font-black text-primary-800">{on ? stat[k] : '–'}</div><div className="text-[9px] uppercase text-gray-500">{CHANNEL_INFO[k].short}</div></div>); })}
            </div>
            <button type="button" disabled={!to.length || !body.trim() || !ch.length} onClick={() => setConfirm(true)} className="btn-primary w-full justify-center py-3 text-base shadow-lg !bg-gradient-to-r from-primary-700 to-indigo-700 disabled:opacity-40">
              <Send size={17} /> Send to {to.length || '…'} {to.length === 1 ? 'person' : 'people'}
            </button>
            {!to.length && <p className="text-center text-[11px] text-gray-400">Choose a group or pick people first.</p>}
          </div>
        </div>
        <HistoryList hist={hist} onOpen={setQueue} onDeleted={loadHist} />
      </div>

      {pick && <PickPeople book={book} picked={picked} onClose={() => setPick(false)} onDone={(keys) => { setPicked(keys); setPick(false); }} />}
      {confirm && (
        <Modal title="Send this message?" onClose={() => setConfirm(false)}
          footer={<><button type="button" onClick={() => setConfirm(false)} className="btn-secondary text-sm">Back</button><button type="button" disabled={busy} onClick={send} className="btn-primary text-sm !bg-gold-500 !text-primary-900">{busy ? <Loader2 size={14} className="animate-spin" /> : <Send size={14} />} Yes, send</button></>}>
          <div className="space-y-3 text-sm">
            <p><b>{to.length}</b> {to.length === 1 ? 'person' : 'people'}{audienceLabel ? <> · <span className="text-gray-500">{audienceLabel}</span></> : null}</p>
            <ul className="space-y-1.5">
              {ch.map((k) => (
                <li key={k} className="flex items-start gap-2"><span>{CHANNEL_INFO[k].emoji}</span>
                  <span>{k === 'portal' ? <><b>{stat.portal}</b> get it now in their portal Messages, with a phone notification.</> : <><b>{stat[k]}</b> by {CHANNEL_INFO[k].label} — a tick-off list opens next; you press send for each one.</>}</span></li>
              ))}
            </ul>
            <div className="max-h-40 overflow-y-auto whitespace-pre-wrap rounded-lg bg-gray-50 p-3 text-xs text-gray-700">{previewText}</div>
            <p className="text-[11px] text-gray-400">Sent by {user?.email ? 'you' : 'TaxMate'}. A portal message can’t be unsent, but replies come to your Messages tab.</p>
          </div>
        </Modal>
      )}
    </div>
  );
}

function PickPeople({ book, picked, onClose, onDone }) {
  const [sel, setSel] = useState(() => new Set(picked));
  const [q, setQ] = useState('');
  const ql = q.trim().toLowerCase(), qd = q.replace(/\D/g, '');
  const shown = book.contacts.filter((c) => !c.archived && (!ql || c.name.toLowerCase().includes(ql) || (c.client_no || '').toLowerCase().includes(ql) || (qd.length >= 3 && (c.phone || '').replace(/\D/g, '').includes(qd))));
  return (
    <Modal title="Pick people" onClose={onClose} footer={<><span className="mr-auto self-center text-xs text-gray-500">{sel.size} picked</span><button type="button" onClick={onClose} className="btn-secondary text-sm">Cancel</button><button type="button" onClick={() => onDone([...sel])} className="btn-primary text-sm">Done</button></>}>
      <div className="relative mb-2"><Search size={14} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-gray-400" /><input autoFocus className="input py-2 pl-8 text-sm" placeholder="Name, phone or client no…" value={q} onChange={(e) => setQ(e.target.value)} /></div>
      <div className="max-h-[55vh] divide-y divide-gray-50 overflow-y-auto rounded-xl border border-gray-100">
        {shown.slice(0, 300).map((c) => { const on = sel.has(c.key); return (
          <button key={c.key} type="button" onClick={() => setSel((s) => { const n = new Set(s); if (n.has(c.key)) n.delete(c.key); else n.add(c.key); return n; })} className={`flex w-full items-center gap-2.5 px-3 py-2 text-left ${on ? 'bg-primary-50/70' : 'hover:bg-gray-50'}`}>
            {on ? <CheckSquare size={16} className="text-primary-600" /> : <Square size={16} className="text-gray-300" />}
            <Avatar c={c} size="h-7 w-7 text-[10px]" />
            <span className="min-w-0 flex-1"><span className="block truncate text-sm font-medium">{c.name}</span><span className="text-[11px] text-gray-400">{c.kind === 'lead' ? 'Lead · ' : ''}{c.phone}</span></span>
          </button>); })}
      </div>
    </Modal>
  );
}

function HistoryList({ hist, onOpen, onDeleted }) {
  if (hist === null) return <div className="card h-24 animate-pulse" />;
  return (
    <div className="card overflow-hidden">
      <div className="card-header"><History size={15} /> Sent messages</div>
      {hist.length === 0 ? <p className="p-4 text-sm text-gray-400">Nothing sent yet.</p> : (
        <div className="max-h-[420px] divide-y divide-gray-100 overflow-y-auto">
          {hist.map((b) => {
            const rs = b.broadcast_recipients || [];
            const q = b.channels.filter((k) => k !== 'portal');
            const done = (k) => rs.filter((r) => r[{ whatsapp: 'wa_sent_at', sms: 'sms_sent_at', email: 'email_sent_at' }[k]]).length;
            return (
              <div key={b.id} className="group flex items-start gap-2 px-4 py-3 hover:bg-gray-50">
                <button type="button" onClick={() => onOpen(b)} className="min-w-0 flex-1 text-left">
                  <div className="flex items-center gap-1.5 text-sm font-semibold text-gray-800"><Megaphone size={13} className="flex-shrink-0 text-gold-500" /><span className="truncate">{b.title || b.body.split('\n').find((l) => l.trim())?.replace('{name}', '…')}</span></div>
                  <div className="text-[11px] text-gray-500">{timeLabel(b.created_at)} · {b.total} people{b.audience ? ` · ${b.audience}` : ''}</div>
                  <div className="mt-1 flex flex-wrap gap-1">
                    {b.channels.includes('portal') && <span className="rounded bg-emerald-50 px-1.5 text-[10px] font-semibold text-emerald-700">🔔 {b.portal_sent} sent</span>}
                    {q.map((k) => { const d = done(k); return <span key={k} className={`rounded px-1.5 text-[10px] font-semibold ${d >= b.total ? 'bg-emerald-50 text-emerald-700' : 'bg-amber-50 text-amber-800'}`}>{CHANNEL_INFO[k].emoji} {d}/{b.total}</span>; })}
                  </div>
                </button>
                <button type="button" onClick={async () => { if (!window.confirm('Delete this from the history? (Portal messages already sent stay with the clients.)')) return; try { await deleteBroadcast(b.id); onDeleted(); } catch (e) { toast.error(e.message); } }} className="rounded p-1 text-gray-300 opacity-0 hover:text-red-600 group-hover:opacity-100" aria-label="Delete"><Trash2 size={13} /></button>
                <ChevronRight size={15} className="mt-1 text-gray-300" />
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

// ─── Tick-off queue (WhatsApp / SMS / email one by one) ───
const COL = { whatsapp: 'wa_sent_at', sms: 'sms_sent_at', email: 'email_sent_at' };
function Queue({ b, onBack, onChat }) {
  const [rows, setRows] = useState(null);
  const [q, setQ] = useState('');
  const qch = b.channels.filter((k) => k !== 'portal');
  const [active, setActive] = useState(qch[0] || null);
  useEffect(() => { loadRecipients(b.id).then(setRows).catch((e) => { toast.error(e.message); setRows([]); }); }, [b.id]);
  const has = (r, k) => (k === 'email' ? !!r.email : !!r.phone);
  const link = (r, k) => (k === 'whatsapp' ? waLink(r.phone, r.body) : k === 'sms' ? smsLink(r.phone, r.body) : mailLink(r.email, personalize(b.title || 'TaxMate Solutions', r.name), r.body));
  const tick = async (r, k, on = true) => {
    setRows((rs) => rs.map((x) => (x.id === r.id ? { ...x, [COL[k]]: on ? new Date().toISOString() : null } : x)));
    try { await markSent(r.id, k, on); } catch (e) { toast.error(e.message); }
  };
  const go = (r, k) => {
    const href = link(r, k);
    if (k === 'whatsapp') window.open(href, '_blank', 'noopener'); else window.location.href = href;
    tick(r, k);
  };
  if (!rows) return <div className="card flex h-64 items-center justify-center"><Loader2 className="animate-spin text-primary-600" /></div>;
  const able = active ? rows.filter((r) => has(r, active)) : [];
  const done = able.filter((r) => r[COL[active]]).length;
  const next = able.find((r) => !r[COL[active]]);
  const pct = able.length ? Math.round((done / able.length) * 100) : 0;
  const ql = q.trim().toLowerCase();
  const list = rows.filter((r) => !ql || `${r.name} ${r.phone || ''}`.toLowerCase().includes(ql));
  const emails = rows.filter((r) => r.email).map((r) => r.email);
  const chunks = []; for (let i = 0; i < emails.length; i += 40) chunks.push(emails.slice(i, i + 40));

  return (
    <div className="space-y-4">
      <div className="card overflow-hidden">
        <div className="flex flex-wrap items-center gap-3 bg-gradient-to-r from-primary-800 to-indigo-800 px-4 py-4 text-white">
          <button type="button" onClick={onBack} className="rounded-lg p-1.5 hover:bg-white/10" aria-label="Back"><ArrowLeft size={18} /></button>
          <div className="min-w-0 flex-1">
            <div className="truncate font-bold">{b.title || 'Message'}</div>
            <div className="text-xs text-primary-100">{timeLabel(b.created_at)} · {rows.length} people{b.audience ? ` · ${b.audience}` : ''}{b.channels.includes('portal') ? ` · 🔔 ${b.portal_sent} in portal` : ''}</div>
          </div>
          <div className="flex gap-1 rounded-xl bg-white/10 p-1">
            {qch.map((k) => <button key={k} type="button" onClick={() => setActive(k)} className={`rounded-lg px-3 py-1.5 text-xs font-bold ${active === k ? 'bg-white text-primary-800' : 'text-white/80'}`}>{CHANNEL_INFO[k].emoji} {CHANNEL_INFO[k].short}</button>)}
          </div>
        </div>
        {active ? (
          <div className="grid gap-4 p-4 md:grid-cols-[minmax(0,1fr)_auto] md:items-center">
            <div>
              <div className="flex items-baseline gap-2"><span className="text-3xl font-black text-primary-800">{done}</span><span className="text-sm text-gray-500">of {able.length} sent by {CHANNEL_INFO[active].label}</span>{rows.length > able.length && <span className="text-[11px] text-gray-400">({rows.length - able.length} have no {active === 'email' ? 'email' : 'phone'})</span>}</div>
              <div className="mt-2 h-2.5 overflow-hidden rounded-full bg-gray-100"><div className="h-full rounded-full bg-gradient-to-r from-emerald-500 to-teal-500 transition-all" style={{ width: `${pct}%` }} /></div>
              {active === 'sms' && <p className="mt-2 text-[11px] text-gray-500">SMS opens your phone’s messages app — use this on your phone.</p>}
              {active === 'whatsapp' && <p className="mt-2 text-[11px] text-gray-500">Each tap opens WhatsApp with the message typed in — press send there, come back, tap next.</p>}
            </div>
            {next ? (
              <button type="button" onClick={() => go(next, active)} className="flex items-center justify-center gap-2 rounded-2xl bg-gradient-to-r from-[#25D366] to-[#128C7E] px-5 py-3.5 text-left font-bold text-white shadow-lg hover:brightness-105">
                <Send size={18} /><span><span className="block text-[10px] font-semibold uppercase opacity-80">Send next</span>{next.name}</span>
              </button>
            ) : <div className="flex items-center gap-2 rounded-2xl bg-emerald-50 px-5 py-3.5 font-bold text-emerald-700"><CheckCircle2 size={20} /> All done</div>}
          </div>
        ) : <p className="p-4 text-sm text-gray-500">Portal only — everything was sent. Replies arrive in the Messages tab.</p>}
        {active === 'email' && chunks.length > 0 && (
          <div className="flex flex-wrap items-center gap-2 border-t border-gray-100 px-4 py-3 text-xs">
            <span className="text-gray-500">Or email everyone at once (BCC, without names):</span>
            {chunks.map((c, i) => <a key={i} href={mailLink('', b.title || 'TaxMate Solutions', personalize(b.body, ''), c.join(','))} className="rounded-lg bg-rose-50 px-2.5 py-1 font-semibold text-rose-700 hover:bg-rose-100">📧 {chunks.length > 1 ? `Batch ${i + 1} (${c.length})` : `All ${c.length}`}</a>)}
            <button type="button" onClick={() => navigator.clipboard?.writeText(emails.join(', ')).then(() => toast.success('Emails copied'))} className="flex items-center gap-1 text-gray-500 hover:text-primary-700"><Copy size={12} /> Copy addresses</button>
          </div>
        )}
      </div>

      <div className="card overflow-hidden">
        <div className="flex items-center gap-2 border-b border-gray-100 p-3">
          <div className="relative flex-1"><Search size={14} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-gray-400" /><input className="input py-2 pl-8 text-sm" placeholder="Find…" value={q} onChange={(e) => setQ(e.target.value)} /></div>
        </div>
        <div className="divide-y divide-gray-50">
          {list.map((r) => (
            <div key={r.id} className="flex flex-wrap items-center gap-2 px-4 py-2.5">
              <Avatar c={{ key: r.client_id || r.phone, name: r.name, kind: r.client_id ? 'client' : 'lead' }} size="h-8 w-8 text-[10px]" />
              <div className="min-w-0 flex-1">
                <div className="truncate text-sm font-semibold text-gray-800">{r.name}</div>
                <div className="text-[11px] text-gray-400">{[r.phone, r.email].filter(Boolean).join(' · ') || 'no phone or email'}
                  {r.portal_status === 'sent' && <span className="ml-1 text-emerald-600">· 🔔 in portal</span>}
                  {r.portal_status === 'no_portal' && b.channels.includes('portal') && <span className="ml-1 text-amber-600">· no portal</span>}
                  {r.portal_status === 'off' && <span className="ml-1 text-amber-600">· messages off</span>}</div>
              </div>
              <div className="flex gap-1">
                {qch.map((k) => {
                  const I = ICON[k]; const sent = r[COL[k]];
                  if (!has(r, k)) return <span key={k} className="flex h-8 w-8 items-center justify-center rounded-lg bg-gray-50 text-gray-200" title={`No ${k === 'email' ? 'email' : 'phone'}`}><I size={14} /></span>;
                  return sent ? (
                    <button key={k} type="button" onClick={() => tick(r, k, false)} title={`Sent ${timeLabel(sent)} — tap to untick`} className="flex h-8 items-center gap-1 rounded-lg bg-emerald-100 px-2 text-[11px] font-bold text-emerald-700"><CheckCircle2 size={13} /><RotateCcw size={10} className="opacity-50" /></button>
                  ) : (
                    <button key={k} type="button" onClick={() => go(r, k)} title={`Send by ${CHANNEL_INFO[k].label}`} className={`flex h-8 items-center gap-1 rounded-lg px-2.5 text-[11px] font-bold text-white ${k === 'whatsapp' ? 'bg-[#25D366]' : k === 'sms' ? 'bg-sky-500' : 'bg-rose-500'}`}><I size={13} /> {CHANNEL_INFO[k].short}</button>
                  );
                })}
                {r.client_id && r.portal_status === 'sent' && <button type="button" onClick={() => onChat(r.client_id)} className="flex h-8 w-8 items-center justify-center rounded-lg text-gray-400 hover:bg-gray-100" title="Open chat"><Bell size={14} /></button>}
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

