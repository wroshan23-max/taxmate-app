// V75 — Phone Book: every client + every Call Log caller, search, A–Z, groups, quick actions
import { useEffect, useMemo, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import toast from 'react-hot-toast';
import {
  Search, Phone, MessageCircle, Mail, MessageSquare, PhoneCall, ExternalLink, X, Users, Send, Download, CheckSquare, Square,
  Copy, Pin, FolderPlus, Contact, ChevronDown, Loader2, Smartphone, UserRound, CalendarClock, ArrowLeft, Archive,
} from 'lucide-react';
import { Modal } from '../vat/ui';
import { Avatar, GroupChip, GroupDot } from './ui';
import { telLink, waLink, CHANNELS, STATUS, SOURCE, SERVICE, slDay, slTime } from '../../lib/callLog';
import { downloadXlsx } from '../../lib/xlsx';
import {
  allGroups, letterOf, phoneKey, smsLink, mailLink, firstName, greetOf, reachOf, addToGroup, removeFromGroup, toVcf, downloadText, exportRows, EXPORT_WIDTHS,
} from '../../lib/contactsHub';

const KINDS = [
  ['all', 'Everyone'], ['client', 'Clients'], ['lead', 'Leads'], ['portal', '🟢 On portal'], ['no_portal', '🔒 No portal'], ['follow', '⏰ Follow-up'], ['pinned', '📌 Pinned'],
];
const SORTS = [['az', 'A → Z'], ['recent', 'Newest first'], ['calls', 'Most calls'], ['lastcall', 'Last call']];
const LETTERS = [...'ABCDEFGHIJKLMNOPQRSTUVWXYZ', '#'];

export default function PhoneBook({ book, reload, onMessage, onChat, onLogCall, groupRef, setGroupRef }) {
  const [q, setQ] = useState('');
  const [kind, setKind] = useState('all');
  const [sort, setSort] = useState('az');
  const [archived, setArchived] = useState(false);
  const [sel, setSel] = useState(() => new Set());
  const [openKey, setOpenKey] = useState(null);
  const [addOpen, setAddOpen] = useState(null);      // contacts to add to a group
  const listRef = useRef(null);
  const groups = useMemo(() => allGroups(book), [book]);
  const group = groups.find((g) => g.ref === groupRef) || null;

  const list = useMemo(() => {
    const ql = q.trim().toLowerCase(), qd = q.replace(/\D/g, '');
    let xs = book.contacts.filter((c) => (archived ? c.archived : !c.archived));
    if (kind === 'client' || kind === 'lead') xs = xs.filter((c) => c.kind === kind);
    if (kind === 'portal') xs = xs.filter((c) => c.kind === 'client' && c.portal);
    if (kind === 'no_portal') xs = xs.filter((c) => c.kind === 'client' && !c.portal);
    if (kind === 'follow') xs = xs.filter((c) => c.followUp);
    if (kind === 'pinned') xs = xs.filter((c) => c.pinned);
    if (group) xs = xs.filter(group.test);
    if (ql) xs = xs.filter((c) => [c.name, c.client_no, c.email, c.tin, c.nic, c.contact?.name, c.employer, c.location].some((x) => x && String(x).toLowerCase().includes(ql))
      || (qd.length >= 3 && [c.phone, c.mobile, c.contact?.mobile].some((p) => p && p.replace(/\D/g, '').includes(qd))));
    const by = {
      az: null,
      recent: (a, b) => String(b.created_at || '').localeCompare(String(a.created_at || '')),
      calls: (a, b) => (b.calls || 0) - (a.calls || 0) || a.name.localeCompare(b.name),
      lastcall: (a, b) => String(b.lastCall || '').localeCompare(String(a.lastCall || '')),
    }[sort];
    return by ? [...xs].sort(by) : xs;
  }, [book, q, kind, sort, group, archived]);

  const letters = useMemo(() => new Set(sort === 'az' ? list.map((c) => letterOf(c.name)) : []), [list, sort]);
  const open = book.contacts.find((c) => c.key === openKey) || null;
  const chosen = book.contacts.filter((c) => sel.has(c.key));
  const toggle = (k) => setSel((s) => { const n = new Set(s); if (n.has(k)) n.delete(k); else n.add(k); return n; });
  const allOn = list.length > 0 && list.every((c) => sel.has(c.key));
  const jump = (L) => listRef.current?.querySelector(`[data-letter="${L}"]`)?.scrollIntoView({ block: 'start', behavior: 'smooth' });
  useEffect(() => { if (openKey && !open) setOpenKey(null); }, [openKey, open]);

  const exportList = (xs, how) => {
    if (!xs.length) return toast.error('Nothing to export');
    const stamp = new Date().toISOString().slice(0, 10);
    if (how === 'vcf') downloadText(`TaxMate-contacts-${stamp}.vcf`, toVcf(xs), 'text/vcard');
    else downloadXlsx(`TaxMate-phone-book-${stamp}.xlsx`, [{ name: 'Phone book', rows: exportRows(xs), freeze: 1, widths: EXPORT_WIDTHS }]);
    toast.success(`${xs.length} contact${xs.length > 1 ? 's' : ''} exported`);
  };

  let lastLetter = null;
  return (
    <div className="grid min-h-[70vh] gap-4 lg:grid-cols-[minmax(0,430px)_minmax(0,1fr)]">
      {/* ── List ── */}
      <div className={`card flex min-h-0 flex-col overflow-hidden ${open ? 'hidden lg:flex' : 'flex'}`}>
        <div className="space-y-2 border-b border-gray-100 p-3">
          <div className="relative">
            <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
            <input className="input py-2.5 pl-9 pr-9" placeholder="Search name, phone, client no, TIN, NIC…" value={q} onChange={(e) => setQ(e.target.value)} />
            {q && <button type="button" onClick={() => setQ('')} className="absolute right-2 top-1/2 -translate-y-1/2 p-1 text-gray-400" aria-label="Clear"><X size={15} /></button>}
          </div>
          <div className="-mx-3 flex gap-1.5 overflow-x-auto px-3 pb-0.5">
            {KINDS.map(([k, l]) => (
              <button key={k} type="button" onClick={() => setKind(k)} className={`shrink-0 rounded-full border px-2.5 py-1 text-xs font-semibold transition ${kind === k ? 'border-primary-600 bg-primary-600 text-white' : 'border-gray-200 bg-white text-gray-600 hover:border-primary-300'}`}>{l}</button>
            ))}
          </div>
          <div className="flex items-center gap-2">
            <div className="relative min-w-0 flex-1">
              <select className="input appearance-none py-1.5 pl-7 pr-7 text-xs" value={groupRef || ''} onChange={(e) => setGroupRef(e.target.value || null)} aria-label="Group">
                <option value="">All groups</option>
                <optgroup label="Your groups">{groups.filter((g) => !g.smart).map((g) => <option key={g.ref} value={g.ref}>{g.emoji} {g.name} ({g.count})</option>)}</optgroup>
                <optgroup label="Smart groups">{groups.filter((g) => g.smart).map((g) => <option key={g.ref} value={g.ref}>{g.emoji} {g.name} ({g.count})</option>)}</optgroup>
              </select>
              <Users size={13} className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-gray-400" />
              <ChevronDown size={13} className="pointer-events-none absolute right-2.5 top-1/2 -translate-y-1/2 text-gray-400" />
            </div>
            <select className="input w-auto py-1.5 text-xs" value={sort} onChange={(e) => setSort(e.target.value)} aria-label="Sort">{SORTS.map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select>
          </div>
          <div className="flex items-center gap-2 text-[11px] text-gray-500">
            <button type="button" onClick={() => setSel(allOn ? new Set() : new Set(list.map((c) => c.key)))} className="flex items-center gap-1 font-semibold text-primary-700">
              {allOn ? <CheckSquare size={14} /> : <Square size={14} />} {allOn ? 'Clear' : 'Select all'}
            </button>
            <span className="flex-1">{list.length.toLocaleString()} contact{list.length === 1 ? '' : 's'}{group ? ` in ${group.name}` : ''}</span>
            <button type="button" onClick={() => setArchived((a) => !a)} className={`flex items-center gap-1 ${archived ? 'font-semibold text-amber-700' : ''}`} title="Archived clients"><Archive size={12} /> {archived ? 'Archived' : 'Archive'}</button>
            <button type="button" onClick={() => exportList(list, 'xlsx')} className="flex items-center gap-1 hover:text-primary-700" title="Excel"><Download size={12} /> Excel</button>
          </div>
        </div>

        <div className="relative flex min-h-0 flex-1">
          <div ref={listRef} className="max-h-[66vh] min-h-[40vh] flex-1 overflow-y-auto overscroll-contain lg:max-h-[calc(100vh-330px)]">
            {list.length === 0 ? (
              <div className="p-10 text-center text-sm text-gray-400"><Contact size={36} className="mx-auto mb-2 text-gray-200" />No contacts match.</div>
            ) : list.map((c) => {
              const L = letterOf(c.name);
              const head = sort === 'az' && L !== lastLetter; lastLetter = L;
              const on = sel.has(c.key);
              const g = c.groups.map((id) => book.groups.find((x) => x.id === id)).filter(Boolean);
              return (
                <div key={c.key}>
                  {head && <div data-letter={L} className="sticky top-0 z-[1] scroll-mt-0 border-b border-gray-100 bg-gray-50/95 px-4 py-1 text-[11px] font-black tracking-widest text-primary-700 backdrop-blur">{L}</div>}
                  <div className={`group flex items-center gap-2 border-l-4 pl-2 pr-3 transition-colors [contain-intrinsic-size:auto_64px] [content-visibility:auto] ${openKey === c.key ? 'border-primary-600 bg-primary-50' : on ? 'border-gold-500 bg-amber-50/60' : 'border-transparent hover:bg-gray-50'}`}>
                    <button type="button" onClick={() => toggle(c.key)} className={`p-1 ${on ? 'text-primary-600' : 'text-gray-300 hover:text-gray-500'}`} aria-label={on ? 'Unselect' : 'Select'}>{on ? <CheckSquare size={16} /> : <Square size={16} />}</button>
                    <button type="button" onClick={() => setOpenKey(c.key)} className="flex min-w-0 flex-1 items-center gap-3 py-2.5 text-left">
                      <Avatar c={c} />
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-1.5">
                          <span className="truncate text-sm font-semibold text-gray-800">{c.name}</span>
                          {c.pinned && <Pin size={11} className="flex-shrink-0 text-red-500" />}
                          {g.slice(0, 4).map((x) => <GroupDot key={x.id} color={x.color} />)}
                        </div>
                        <div className="flex items-center gap-1.5 overflow-hidden whitespace-nowrap text-[11px] text-gray-500">
                          {c.kind === 'client'
                            ? <>{c.client_no && <span className="rounded bg-primary-50 px-1 font-mono font-semibold text-primary-700">{c.client_no}</span>}<span className={c.portal ? 'text-emerald-600' : 'text-gray-400'}>{c.portal ? '● portal' : '○ no portal'}</span></>
                            : <span className="rounded bg-orange-100 px-1 font-semibold text-orange-700">Lead · {STATUS[c.leadStatus]?.label || (c.manual ? 'added by hand' : 'call')}</span>}
                          <span className="truncate tabular-nums">{c.phone || 'no phone'}</span>
                          {c.followUp && <CalendarClock size={11} className="flex-shrink-0 text-amber-600" />}
                        </div>
                      </div>
                    </button>
                    {c.phone && (
                      <div className="flex gap-0.5 opacity-100 transition lg:opacity-0 lg:group-hover:opacity-100">
                        <a href={telLink(c.phone)} className="rounded-lg p-2 text-primary-600 hover:bg-primary-100" title="Call" aria-label={`Call ${c.name}`}><Phone size={15} /></a>
                        <a href={waLink(reachOf(c).phone, `Dear ${firstName(greetOf(c))},\n\n`)} target="_blank" rel="noreferrer" className="rounded-lg p-2 text-[#128C7E] hover:bg-emerald-50" title="WhatsApp" aria-label={`WhatsApp ${c.name}`}><MessageCircle size={15} /></a>
                      </div>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
          {sort === 'az' && list.length > 25 && (
            <div className="flex w-6 flex-col items-center justify-center py-1 text-[9px] font-bold leading-[1.45] text-gray-400 sm:text-[10px]">
              {LETTERS.map((L) => <button key={L} type="button" disabled={!letters.has(L)} onClick={() => jump(L)} className={letters.has(L) ? 'text-primary-600 hover:scale-125' : 'opacity-30'}>{L}</button>)}
            </div>
          )}
        </div>

        {chosen.length > 0 && (
          <div className="flex flex-wrap items-center gap-2 border-t border-gray-100 bg-primary-900 px-3 py-2.5 text-white">
            <span className="text-sm font-bold">{chosen.length} selected</span>
            <button type="button" onClick={() => setSel(new Set())} className="text-xs text-primary-200 underline">clear</button>
            <div className="ml-auto flex flex-wrap gap-1.5">
              <button type="button" onClick={() => setAddOpen(chosen)} className="flex items-center gap-1 rounded-lg bg-white/10 px-2.5 py-1.5 text-xs font-semibold hover:bg-white/20"><FolderPlus size={13} /> Group</button>
              <button type="button" onClick={() => exportList(chosen, 'vcf')} className="flex items-center gap-1 rounded-lg bg-white/10 px-2.5 py-1.5 text-xs font-semibold hover:bg-white/20" title="Save to phone contacts (vCard)"><Smartphone size={13} /> vCard</button>
              <button type="button" onClick={() => onMessage(chosen, `${chosen.length} selected contact${chosen.length > 1 ? 's' : ''}`)} className="flex items-center gap-1 rounded-lg bg-gold-500 px-3 py-1.5 text-xs font-bold text-primary-900 hover:bg-gold-400"><Send size={13} /> Message</button>
            </div>
          </div>
        )}
      </div>

      {/* ── Detail ── */}
      <div className={`${open ? 'block' : 'hidden lg:block'} min-w-0`}>
        {open
          ? <ContactDetail c={open} book={book} reload={reload} onClose={() => setOpenKey(null)} onChat={onChat} onLogCall={onLogCall} onMessage={onMessage} onAddGroup={() => setAddOpen([open])} />
          : <EmptyDetail book={book} />}
      </div>

      {addOpen && <AddToGroup book={book} contacts={addOpen} onClose={() => setAddOpen(null)} onDone={() => { setAddOpen(null); setSel(new Set()); reload(); }} />}
    </div>
  );
}

function EmptyDetail({ book }) {
  const cl = book.contacts.filter((c) => c.kind === 'client' && !c.archived);
  const withPhone = cl.filter((c) => c.phone).length, withEmail = cl.filter((c) => c.email).length;
  const pct = (n) => (cl.length ? Math.round((n / cl.length) * 100) : 0);
  return (
    <div className="card flex h-full min-h-[50vh] flex-col items-center justify-center p-8 text-center">
      <div className="flex h-20 w-20 items-center justify-center rounded-3xl bg-gradient-to-br from-primary-600 to-indigo-700 text-4xl shadow-lg">📇</div>
      <div className="mt-4 text-lg font-bold text-primary-800">Choose a contact</div>
      <p className="max-w-sm text-sm text-gray-500">Call, WhatsApp, SMS or email in one tap, see their calls and groups, or tick several people and press <b>Message</b>.</p>
      <div className="mt-6 grid w-full max-w-md grid-cols-2 gap-3 text-left">
        {[['📱 Mobile number', withPhone, pct(withPhone)], ['📧 Email address', withEmail, pct(withEmail)]].map(([l, n, p]) => (
          <div key={l} className="rounded-xl border border-gray-100 bg-gray-50 p-3">
            <div className="text-xs text-gray-500">{l}</div>
            <div className="text-lg font-bold text-gray-800">{n}<span className="text-xs font-normal text-gray-400"> / {cl.length} clients</span></div>
            <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-gray-200"><div className="h-full rounded-full bg-emerald-500" style={{ width: `${p}%` }} /></div>
          </div>
        ))}
      </div>
    </div>
  );
}

function Row({ icon: I, label, children, copy }) {
  if (!children) return null;
  return (
    <div className="flex items-start gap-3 px-4 py-2.5">
      <I size={15} className="mt-0.5 flex-shrink-0 text-gray-400" />
      <div className="min-w-0 flex-1"><div className="text-[11px] text-gray-400">{label}</div><div className="break-words text-sm text-gray-800">{children}</div></div>
      {copy && <button type="button" onClick={() => { navigator.clipboard?.writeText(copy).then(() => toast.success('Copied')).catch(() => {}); }} className="p-1 text-gray-300 hover:text-primary-600" aria-label={`Copy ${label}`}><Copy size={13} /></button>}
    </div>
  );
}

function ContactDetail({ c, book, reload, onClose, onChat, onLogCall, onMessage, onAddGroup }) {
  const [busy, setBusy] = useState(false);
  const top = useRef(null);
  useEffect(() => { if (window.innerWidth < 1024) top.current?.scrollIntoView({ block: 'start' }); }, [c.key]);
  const reach = reachOf(c);
  const hi = `Dear ${firstName(greetOf(c))},\n\n`;
  const mine = c.groups.map((id) => book.groups.find((x) => x.id === id)).filter(Boolean);
  const remove = async (g) => { setBusy(true); try { await removeFromGroup(g.id, c); toast.success(`Removed from ${g.name}`); await reload(); } catch (e) { toast.error(e.message); } setBusy(false); };
  const ACTIONS = [
    { k: 'call', icon: Phone, label: 'Call', href: reach.phone && telLink(reach.phone), cls: 'from-primary-600 to-primary-700' },
    { k: 'wa', icon: MessageCircle, label: 'WhatsApp', href: reach.phone && waLink(reach.phone, hi), ext: true, cls: 'from-[#25D366] to-[#128C7E]' },
    { k: 'sms', icon: MessageSquare, label: 'SMS', href: reach.phone && smsLink(reach.phone, hi), cls: 'from-sky-500 to-blue-600' },
    { k: 'mail', icon: Mail, label: 'Email', href: reach.email && mailLink(reach.email, 'TaxMate Solutions', hi), cls: 'from-rose-500 to-pink-600' },
    { k: 'chat', icon: Send, label: 'Portal chat', on: c.kind === 'client' ? () => onChat(c.client_id) : null, cls: 'from-indigo-500 to-purple-600' },
    { k: 'log', icon: PhoneCall, label: 'Log a call', on: () => onLogCall(c), cls: 'from-amber-500 to-orange-500' },
  ];
  return (
    <div ref={top} className="card scroll-mt-16 overflow-hidden">
      <div className="relative bg-gradient-to-br from-primary-800 via-primary-700 to-indigo-800 px-5 pb-5 pt-4 text-white">
        <div className="pointer-events-none absolute -right-10 -top-10 h-40 w-40 rounded-full bg-gold-500/20 blur-2xl" />
        <div className="flex items-center gap-2">
          <button type="button" onClick={onClose} className="-ml-1 rounded-lg p-1 text-primary-100 hover:bg-white/10 lg:hidden" aria-label="Back"><ArrowLeft size={20} /></button>
          <span className="rounded-full bg-white/15 px-2 py-0.5 text-[11px] font-semibold">{c.kind === 'client' ? (c.client_type === 'company' ? '🏢 Company client' : '👤 Client') : '📞 Call Log lead'}</span>
          {c.archived && <span className="rounded-full bg-amber-400/30 px-2 py-0.5 text-[11px] font-semibold">Archived</span>}
          <button type="button" onClick={onClose} className="ml-auto hidden rounded-lg p-1 text-primary-100 hover:bg-white/10 lg:block" aria-label="Close"><X size={18} /></button>
        </div>
        <div className="mt-3 flex items-center gap-4">
          <Avatar c={c} size="h-16 w-16 text-xl" ring="ring-4 ring-white/20" />
          <div className="min-w-0 flex-1">
            <div className="truncate text-xl font-bold">{c.name}</div>
            <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-primary-100">
              {c.client_no && <span className="font-mono font-semibold text-gold-300">{c.client_no}</span>}
              {c.kind === 'client' && <span>{c.portal ? (c.messagesOff ? '🟡 portal · messages off' : '🟢 on the portal') : '🔒 no portal login'}</span>}
              {c.kind === 'lead' && <span>{STATUS[c.leadStatus]?.label || 'Lead'}</span>}
              {c.calls > 0 && <span>📞 {c.calls} call{c.calls > 1 ? 's' : ''}</span>}
              {c.package && <span>📦 {c.package.package_name}</span>}
            </div>
          </div>
        </div>
        <div className="mt-4 grid grid-cols-3 gap-2 sm:grid-cols-6">
          {ACTIONS.map((a) => {
            const dis = !a.href && !a.on;
            const inner = <><span className={`flex h-10 w-10 items-center justify-center rounded-2xl bg-gradient-to-br ${a.cls} shadow-md`}><a.icon size={18} /></span><span className="text-[11px] font-semibold">{a.label}</span></>;
            const cls = `flex flex-col items-center gap-1 rounded-xl p-1.5 transition ${dis ? 'pointer-events-none opacity-35' : 'hover:bg-white/10'}`;
            return a.href ? <a key={a.k} href={a.href} target={a.ext ? '_blank' : undefined} rel="noreferrer" className={cls}>{inner}</a>
              : <button key={a.k} type="button" disabled={dis} onClick={a.on || undefined} className={cls}>{inner}</button>;
          })}
        </div>
      </div>

      {c.contact?.preferred && c.contact?.name && (
        <div className="flex items-center gap-2 border-b border-amber-100 bg-amber-50 px-4 py-2 text-xs text-amber-900"><UserRound size={14} /> Calls & messages go to the contact person <b>{c.contact.name}</b>{c.contact.relation ? ` (${c.contact.relation})` : ''}.</div>
      )}

      <div className="grid gap-0 divide-y divide-gray-100 lg:grid-cols-2 lg:divide-x lg:divide-y-0">
        <div className="divide-y divide-gray-50">
          <Row icon={Phone} label="Mobile" copy={c.mobile || c.phone}>{c.mobile || c.phone}</Row>
          <Row icon={UserRound} label="Contact person" copy={c.contact?.mobile}>{c.contact && [c.contact.name, c.contact.relation && `(${c.contact.relation})`, c.contact.mobile && `· ${c.contact.mobile}`, c.contact.email && `· ${c.contact.email}`].filter(Boolean).join(' ')}</Row>
          <Row icon={Mail} label="Email" copy={c.email}>{c.email}</Row>
          <Row icon={Contact} label="TIN / NIC">{[c.tin && `TIN ${c.tin}`, c.nic && `NIC ${c.nic}`].filter(Boolean).join(' · ')}</Row>
          <Row icon={Contact} label="Address / employer">{[c.address, c.employer].filter(Boolean).join(' · ') || c.location}</Row>
          <Row icon={Users} label="How they found us">{SOURCE[c.source] || (c.source && c.source !== 'admin' ? c.source.replace(/_/g, ' ') : null)}</Row>
          {c.services?.length > 0 && <Row icon={PhoneCall} label="Asked about">{c.services.map((s) => SERVICE[s] || s).join(', ')}</Row>}
        </div>
        <div className="space-y-4 p-4">
          <div>
            <div className="mb-2 flex items-center gap-2 text-xs font-bold uppercase tracking-wide text-gray-400">Groups {busy && <Loader2 size={12} className="animate-spin" />}</div>
            <div className="flex flex-wrap gap-1.5">
              {mine.map((g) => <GroupChip key={g.id} g={g} onRemove={() => remove(g)} />)}
              {book.groupsOff ? <span className="text-xs text-gray-400">Run the V75 script to use groups.</span>
                : <button type="button" onClick={onAddGroup} className="inline-flex items-center gap-1 rounded-full border border-dashed border-primary-300 px-2 py-0.5 text-[11px] font-semibold text-primary-700 hover:bg-primary-50"><FolderPlus size={11} /> Add to group</button>}
            </div>
            {allGroups(book).filter((g) => g.smart && g.ref !== 'all' && g.test(c)).length > 0 && (
              <div className="mt-2 flex flex-wrap gap-1">{allGroups(book).filter((g) => g.smart && g.ref !== 'all' && g.test(c)).map((g) => <span key={g.ref} className="rounded-full bg-gray-100 px-2 py-0.5 text-[10px] text-gray-600">{g.emoji} {g.name}</span>)}</div>
            )}
          </div>
          <div>
            <div className="mb-2 text-xs font-bold uppercase tracking-wide text-gray-400">Recent calls</div>
            {c.callRows.length === 0 ? <p className="text-xs text-gray-400">No calls logged yet.</p> : (
              <ol className="relative space-y-2 border-l-2 border-gray-100 pl-4">
                {c.callRows.slice(0, 5).map((x) => (
                  <li key={x.id} className="relative">
                    <span className="absolute -left-[23px] top-0.5 flex h-4 w-4 items-center justify-center rounded-full bg-white text-[10px]">{CHANNELS[x.channel]?.[0] || '📞'}</span>
                    <div className="text-xs font-semibold text-gray-700">{slDay(x.called_at)} · {slTime(x.called_at)} <span className={`ml-1 rounded px-1 text-[10px] ${STATUS[x.status]?.cls || ''}`}>{STATUS[x.status]?.label}</span></div>
                    {x.notes && <div className="line-clamp-2 text-xs text-gray-500">{x.notes}</div>}
                  </li>
                ))}
              </ol>
            )}
          </div>
          <div className="flex flex-wrap gap-2 pt-1">
            {c.kind === 'client' && <Link to={`/admin/clients/${c.client_id}`} className="btn-secondary text-xs"><ExternalLink size={13} /> Client profile</Link>}
            <button type="button" onClick={() => onMessage([c], c.name)} className="btn-secondary text-xs"><Send size={13} /> Broadcast to {c.kind === 'client' ? 'client' : 'lead'}</button>
            <button type="button" onClick={() => { downloadText(`${c.name.replace(/[^\w]+/g, '_')}.vcf`, toVcf([c]), 'text/vcard'); }} className="btn-secondary text-xs"><Smartphone size={13} /> Save to phone</button>
          </div>
        </div>
      </div>
    </div>
  );
}

export function AddToGroup({ book, contacts, onClose, onDone, onNewGroup }) {
  const [busy, setBusy] = useState(null);
  const mine = book.groups;
  const add = async (g) => {
    setBusy(g.id);
    try { const n = await addToGroup(g.id, contacts); toast.success(n ? `${n} added to ${g.name}` : `Already in ${g.name}`); onDone(); } catch (e) { toast.error(e.message); }
    setBusy(null);
  };
  return (
    <Modal title={`Add ${contacts.length === 1 ? contacts[0].name : `${contacts.length} contacts`} to a group`} onClose={onClose}>
      {book.groupsOff ? <p className="text-sm text-amber-700">Run the V75 script in Supabase first.</p> : mine.length === 0 ? (
        <p className="text-sm text-gray-500">No groups yet — open the <b>Groups</b> tab and press <b>New group</b>.{onNewGroup && <button type="button" onClick={onNewGroup} className="ml-1 underline">Create one</button>}</p>
      ) : (
        <div className="grid gap-2 sm:grid-cols-2">
          {mine.map((g) => {
            const already = contacts.every((c) => c.groups.includes(g.id));
            return (
              <button key={g.id} type="button" disabled={!!busy || already} onClick={() => add(g)} className={`flex items-center gap-3 rounded-xl border p-3 text-left transition ${already ? 'border-emerald-200 bg-emerald-50' : 'border-gray-200 hover:border-primary-400 hover:bg-primary-50'}`}>
                <span className="text-2xl">{g.emoji || '⭐'}</span>
                <span className="min-w-0 flex-1"><span className="flex items-center gap-1.5 text-sm font-semibold text-gray-800"><GroupDot color={g.color} /> {g.name}</span><span className="text-[11px] text-gray-500">{already ? 'already in this group' : `${g.count} member${g.count === 1 ? '' : 's'}`}</span></span>
                {busy === g.id && <Loader2 size={16} className="animate-spin text-primary-600" />}
              </button>
            );
          })}
        </div>
      )}
    </Modal>
  );
}

export const samePhone = (a, b) => phoneKey(a) && phoneKey(a) === phoneKey(b);
