// V75 — Contacts hub: one phone book of clients + Call Log leads, groups, and broadcasts
import { useCallback, useEffect, useState } from 'react';
import { supabase } from './supabase';
import { waNumber, FIRM } from './firm';
import { filingYear } from './assets';

export const phoneKey = (p) => { const d = String(p || '').replace(/\D/g, ''); return d ? d.slice(-9) : ''; };
const clean = (s) => String(s ?? '').trim();
const TITLES = /^(mr|mrs|ms|miss|dr|rev|prof|hon)\.?$/i;
/** "Mr. A.B. Kasun Perera" → "Kasun" (same rule as the database) */
export function firstName(n) {
  const w = clean(n).split(/\s+/).find((x) => !TITLES.test(x) && !/^([A-Za-z]\.)+$/.test(x) && x.length > 1);
  return w ? w[0].toUpperCase() + w.slice(1).toLowerCase() : 'Sir/Madam';
}
export const personalize = (text, name) => String(text || '').replaceAll('{name}', firstName(name));

export const smsLink = (phone, text) => `sms:${waNumber(phone) ? `+${waNumber(phone)}` : clean(phone)}${text ? `?body=${encodeURIComponent(text)}` : ''}`;
export const mailLink = (to, subject, body, bcc) =>
  `mailto:${to ? encodeURIComponent(to) : ''}?${[bcc && `bcc=${encodeURIComponent(bcc)}`, subject && `subject=${encodeURIComponent(subject)}`, body && `body=${encodeURIComponent(body)}`].filter(Boolean).join('&')}`;

// ─── Avatars ─────────────────────────────────────────────
const TONES = ['from-pink-500 to-rose-500', 'from-indigo-500 to-blue-600', 'from-emerald-500 to-teal-600', 'from-amber-500 to-orange-500', 'from-purple-500 to-fuchsia-500', 'from-sky-500 to-cyan-600', 'from-lime-500 to-green-600', 'from-red-500 to-pink-600'];
export const toneOf = (k = '') => TONES[[...String(k)].reduce((a, c) => a + c.charCodeAt(0), 0) % TONES.length];
export const initialsOf = (n = '?') => {
  const ws = clean(n).split(/\s+/).filter((w) => !TITLES.test(w) && !/^([A-Za-z]\.)+$/.test(w));
  return (ws.length ? ws : [clean(n) || '?']).slice(0, 2).map((w) => w[0]).join('').toUpperCase() || '#';
};
/** name without titles / initials, for A–Z sorting ("Mr. A.B. Sunil Silva" → "Sunil Silva") */
export const sortName = (n) => { const ws = clean(n).split(/\s+/); const i = ws.findIndex((x) => !TITLES.test(x) && !/^([A-Za-z]\.)+$/.test(x)); return (i < 0 ? ws : ws.slice(i)).join(' '); };
const byName = (a, b) => (letterOf(a.name) === '#') - (letterOf(b.name) === '#') || sortName(a.name).localeCompare(sortName(b.name), 'en', { sensitivity: 'base' });
/** A–Z index letter ("#" for numbers / no name) */
export const letterOf = (n) => { const w = clean(n).split(/\s+/).find((x) => !TITLES.test(x) && !/^([A-Za-z]\.)+$/.test(x)) || ''; const c = w[0]?.toUpperCase(); return c && c >= 'A' && c <= 'Z' ? c : '#'; };

// ─── Load everything the phone book needs ────────────────
const CLIENT_COLS = 'id, client_no, full_name, tin, nic, email, mobile, address, employer, client_type, created_at, profile_id, archived_at, contact_name, contact_relation, contact_mobile, contact_email, contact_preferred, source, feature_overrides';
const CALL_COLS = 'id, called_at, channel, phone, phone_key, name, email, location, client_id, services, source, status, follow_up_at, notes';

async function safe(p, fallback) { try { const { data, error } = await p; return error ? { data: fallback, error } : { data: data ?? fallback }; } catch (e) { return { data: fallback, error: e }; } }

export async function loadPhoneBook() {
  const [cl, calls, flags, labels, groups, members, pk] = await Promise.all([
    safe(supabase.from('clients').select(CLIENT_COLS).order('full_name').limit(5000), []),
    safe(supabase.from('call_logs').select(CALL_COLS).order('called_at', { ascending: false }).limit(4000), []),
    safe(supabase.from('client_flags').select('client_id, pinned_at, label_ids'), []),
    safe(supabase.from('client_labels').select('*').order('sort').order('name'), []),
    safe(supabase.from('contact_groups').select('*').order('sort').order('name'), []),
    safe(supabase.from('contact_group_members').select('id, group_id, client_id, name, phone, email, phone_key, added_at').limit(20000), []),
    safe(supabase.from('client_packages').select('client_id, year, package_key, package_name').eq('year', filingYear()), []),
  ]);
  if (cl.error) throw new Error(cl.error.message);
  return buildBook({ clients: cl.data, calls: calls.data, flags: flags.data, labels: labels.data, groups: groups.data, members: members.data, packages: pk.data, groupsOff: !!groups.error });
}

/** Pure: raw rows → contacts + lookups (unit-tested) */
export function buildBook({ clients = [], calls = [], flags = [], labels = [], groups = [], members = [], packages = [], groupsOff = false }) {
  const flagOf = Object.fromEntries(flags.map((f) => [f.client_id, f]));
  const pkgOf = Object.fromEntries(packages.map((p) => [p.client_id, p]));
  const byPhone = {};                                   // phone key → client ids
  for (const c of clients) for (const p of [c.mobile, c.contact_mobile]) { const k = phoneKey(p); if (k) (byPhone[k] ??= new Set()).add(c.id); }

  const callsOfClient = {}, leadCalls = {};
  for (const x of calls) {
    const k = x.phone_key || phoneKey(x.phone);
    const cids = x.client_id ? [x.client_id] : [...(byPhone[k] || [])];
    if (cids.length) for (const id of cids) (callsOfClient[id] ??= []).push(x);
    else if (k) (leadCalls[k] ??= []).push(x);
  }
  const groupsOfClient = {}, groupsOfPhone = {};
  for (const m of members) {
    if (m.client_id) (groupsOfClient[m.client_id] ??= new Set()).add(m.group_id);
    else if (m.phone_key) (groupsOfPhone[m.phone_key] ??= new Set()).add(m.group_id);
  }

  const contacts = [];
  for (const c of clients) {
    const cs = callsOfClient[c.id] || [];
    const f = flagOf[c.id];
    const gs = new Set(groupsOfClient[c.id] || []);
    for (const p of [c.mobile, c.contact_mobile]) for (const g of groupsOfPhone[phoneKey(p)] || []) gs.add(g);
    contacts.push({
      key: `c:${c.id}`, kind: 'client', id: c.id, client_id: c.id, name: clean(c.full_name) || 'Client',
      phone: clean(c.mobile) || clean(c.contact_mobile), mobile: clean(c.mobile), email: clean(c.email) || clean(c.contact_email),
      client_no: c.client_no, tin: c.tin, nic: c.nic, address: c.address, employer: c.employer, client_type: c.client_type,
      portal: !!c.profile_id, archived: !!c.archived_at, created_at: c.created_at, source: c.source,
      messagesOff: c.feature_overrides?.messages === false,
      contact: c.contact_name || c.contact_mobile || c.contact_email ? { name: c.contact_name, relation: c.contact_relation, mobile: c.contact_mobile, email: c.contact_email, preferred: !!c.contact_preferred } : null,
      pinned: !!f?.pinned_at, labels: f?.label_ids || [], groups: [...gs], package: pkgOf[c.id] || null,
      calls: cs.length, lastCall: cs[0]?.called_at || null, followUp: cs.find((x) => x.status === 'follow_up') || null, callRows: cs.slice(0, 8),
    });
  }
  for (const [k, cs] of Object.entries(leadCalls)) {
    const last = cs[0];
    const named = cs.find((x) => clean(x.name));
    contacts.push({
      key: `l:${k}`, kind: 'lead', id: k, client_id: null, name: clean(named?.name) || clean(last.phone), unnamed: !named,
      phone: clean(last.phone), email: clean(cs.find((x) => clean(x.email))?.email), location: clean(cs.find((x) => clean(x.location))?.location),
      created_at: cs[cs.length - 1].called_at, source: cs.find((x) => x.source)?.source, services: [...new Set(cs.flatMap((x) => x.services || []))],
      leadStatus: last.status, pinned: false, labels: [], groups: [...(groupsOfPhone[k] || [])], portal: false, archived: false,
      calls: cs.length, lastCall: last.called_at, followUp: cs.find((x) => x.status === 'follow_up') || null, callRows: cs.slice(0, 8), lastCallId: last.id,
    });
  }
  contacts.sort(byName);
  // members whose phone isn't a client or a call (added by hand)
  const known = new Set(contacts.flatMap((c) => [c.kind === 'lead' ? c.id : null, phoneKey(c.mobile), phoneKey(c.contact?.mobile)]).filter(Boolean));
  const extra = {};
  for (const m of members) if (!m.client_id && m.phone_key && !known.has(m.phone_key)) {
    const e = (extra[m.phone_key] ??= { key: `l:${m.phone_key}`, kind: 'lead', id: m.phone_key, client_id: null, name: clean(m.name) || clean(m.phone), unnamed: !clean(m.name), phone: clean(m.phone), email: clean(m.email), created_at: m.added_at, groups: [], labels: [], pinned: false, portal: false, archived: false, calls: 0, lastCall: null, followUp: null, callRows: [], manual: true });
    e.groups.push(m.group_id);
  }
  contacts.push(...Object.values(extra));
  if (Object.keys(extra).length) contacts.sort(byName);

  const counts = {}; for (const c of contacts) for (const g of c.groups) counts[g] = (counts[g] || 0) + 1;
  return { contacts, labels, groups: groups.map((g) => ({ ...g, count: counts[g.id] || 0 })), members, groupsOff };
}

export function usePhoneBook() {
  const [book, setBook] = useState(null);
  const [error, setError] = useState(null);
  const reload = useCallback(() => loadPhoneBook().then((b) => { setBook(b); setError(null); }).catch((e) => setError(e.message)), []);
  useEffect(() => { reload(); }, [reload]);
  return { book, error, reload, setBook };
}

// ─── Smart groups (always up to date) ────────────────────
export function smartGroups(book) {
  const live = (book?.contacts || []).filter((c) => !c.archived);
  const cl = live.filter((c) => c.kind === 'client');
  const out = [
    { ref: 'all', name: 'All clients', emoji: '👥', color: 'blue', desc: 'Every active client', test: (c) => c.kind === 'client' },
    { ref: 'portal', name: 'On the portal', emoji: '🟢', color: 'green', desc: 'Clients who can log in', test: (c) => c.kind === 'client' && c.portal },
    { ref: 'no_portal', name: 'No portal login', emoji: '🔒', color: 'gray', desc: 'Reach them on WhatsApp / SMS', test: (c) => c.kind === 'client' && !c.portal },
    { ref: 'leads', name: 'Call Log leads', emoji: '📞', color: 'orange', desc: 'Callers who are not clients yet', test: (c) => c.kind === 'lead' && c.leadStatus !== 'lost' },
    { ref: 'follow', name: 'Follow-ups open', emoji: '⏰', color: 'amber', desc: 'Calls waiting for a call back', test: (c) => !!c.followUp },
    { ref: 'pinned', name: 'Pinned clients', emoji: '📌', color: 'red', desc: 'Pinned on the client list', test: (c) => c.pinned },
    { ref: 'no_pkg', name: `No package for ${filingYear()}`, emoji: '📦', color: 'purple', desc: 'Has not chosen a tax package yet', test: (c) => c.kind === 'client' && !c.package },
  ];
  for (const l of book?.labels || []) out.push({ ref: `label:${l.id}`, name: l.name, emoji: '🏷️', color: l.color, desc: 'Client label', test: (c) => c.labels.includes(l.id) });
  const pk = {}; for (const c of cl) if (c.package) pk[c.package.package_key] = c.package.package_name;
  for (const [k, n] of Object.entries(pk)) out.push({ ref: `pkg:${k}`, name: n, emoji: '📦', color: 'indigo', desc: `Tax package ${filingYear()}`, test: (c) => c.package?.package_key === k });
  return out.map((g) => ({ ...g, smart: true, count: live.filter(g.test).length }));
}
/** Every group (smart + yours) by ref: 'all' … or 'g:<uuid>' */
export function allGroups(book) {
  return [...smartGroups(book), ...(book?.groups || []).map((g) => ({ ref: `g:${g.id}`, id: g.id, name: g.name, emoji: g.emoji || '⭐', color: g.color, desc: g.description, smart: false, count: g.count, test: (c) => c.groups.includes(g.id) }))];
}
export const membersOf = (book, ref) => { const g = allGroups(book).find((x) => x.ref === ref); return g ? (book?.contacts || []).filter((c) => !c.archived && g.test(c)) : []; };

// ─── Your groups ─────────────────────────────────────────
const fail = (e) => { if (e) throw new Error(/contact_groups_name_uq|duplicate/.test(e.message) ? 'There is already a group with that name' : /relation|schema cache/.test(e.message) ? 'Run the V75 script in Supabase first' : e.message); };
export async function saveGroup({ id, name, color, emoji, description }) {
  const row = { name: clean(name).slice(0, 40), color: color || 'blue', emoji: clean(emoji).slice(0, 8) || null, description: clean(description).slice(0, 200) || null };
  if (!row.name) throw new Error('Type a name for the group');
  const { data, error } = id ? await supabase.from('contact_groups').update(row).eq('id', id).select().single() : await supabase.from('contact_groups').insert(row).select().single();
  fail(error);
  return data;
}
export async function deleteGroup(id) { const { error } = await supabase.from('contact_groups').delete().eq('id', id); fail(error); }
/** add contacts to a group (skips ones already in it) → number added */
export async function addToGroup(groupId, contacts) {
  const rows = contacts.filter((c) => !c.groups?.includes(groupId))
    .map((c) => (c.kind === 'client' ? { group_id: groupId, client_id: c.client_id } : { group_id: groupId, phone: c.phone, name: c.unnamed ? null : c.name, email: c.email || null }))
    .filter((r) => r.client_id || phoneKey(r.phone));
  if (!rows.length) return 0;
  const { error } = await supabase.from('contact_group_members').insert(rows);
  if (!error) return rows.length;
  if (!/duplicate|unique/i.test(error.message)) fail(error);
  let n = 0;                                   // someone added a few meanwhile — one by one
  for (const r of rows) { const { error: e } = await supabase.from('contact_group_members').insert(r); if (!e) n++; else if (!/duplicate|unique/i.test(e.message)) fail(e); }
  return n;
}
export async function removeFromGroup(groupId, c) {
  let q = supabase.from('contact_group_members').delete().eq('group_id', groupId);
  q = c.kind === 'client' ? q.eq('client_id', c.client_id) : q.is('client_id', null).eq('phone_key', c.id);
  const { error } = await q; fail(error);
}

// ─── Broadcasts ──────────────────────────────────────────
export const CHANNEL_INFO = {
  portal:   { emoji: '🔔', label: 'Portal + phone alert', short: 'Portal', hint: 'Sent now — appears in the client\'s Messages with a phone notification' },
  whatsapp: { emoji: '💬', label: 'WhatsApp', short: 'WhatsApp', hint: 'Opens WhatsApp for each person — tap send, then next' },
  sms:      { emoji: '✉️', label: 'SMS', short: 'SMS', hint: 'Opens your phone\'s SMS app for each person' },
  email:    { emoji: '📧', label: 'Email', short: 'Email', hint: 'Opens your email app — one by one, or all at once in BCC' },
};
export const recipientOf = (c) => (c.kind === 'client' ? { client_id: c.client_id } : { phone: c.phone, name: c.unnamed ? null : c.name, email: c.email || null });
/** greeting name used for {name}: the contact person when they coordinate */
export const greetOf = (c) => (c.kind === 'client' && c.contact?.preferred && c.contact?.name ? c.contact.name : c.unnamed ? '' : c.name);
export const reachOf = (c) => ({ phone: c.kind === 'client' && c.contact?.preferred && c.contact?.mobile ? c.contact.mobile : c.phone, email: c.kind === 'client' && c.contact?.preferred && c.contact?.email ? c.contact.email : c.email });

export async function sendBroadcast({ title, body, channels, audience, contacts }) {
  const { data, error } = await supabase.rpc('admin_send_broadcast', { p_title: title || null, p_body: body, p_channels: channels, p_audience: audience || null, p_recipients: contacts.map(recipientOf) });
  if (error) throw new Error(/admin_send_broadcast|schema cache/.test(error.message) ? 'Run the V75 script in Supabase first' : error.message.replace(/^.*?ERROR:\s*/, ''));
  return data;
}
export async function loadBroadcasts() {
  const { data, error } = await supabase.from('broadcasts').select('*, broadcast_recipients(id, wa_sent_at, sms_sent_at, email_sent_at, portal_status)').order('created_at', { ascending: false }).limit(60);
  if (error) throw new Error(error.message);
  return data ?? [];
}
export async function loadRecipients(id) {
  const { data, error } = await supabase.from('broadcast_recipients').select('*').eq('broadcast_id', id).order('name');
  if (error) throw new Error(error.message);
  return data ?? [];
}
export async function markSent(rid, channel, on = true) {
  const col = { whatsapp: 'wa_sent_at', sms: 'sms_sent_at', email: 'email_sent_at' }[channel];
  const { data, error } = await supabase.from('broadcast_recipients').update({ [col]: on ? new Date().toISOString() : null }).eq('id', rid).select().single();
  if (error) throw new Error(error.message);
  return data;
}
export async function deleteBroadcast(id) { const { error } = await supabase.from('broadcasts').delete().eq('id', id); if (error) throw new Error(error.message); }

// Ready-made messages ({name} = first name). Sinhala + English.
export const TEMPLATES = [
  { key: 'iit_deadline', emoji: '⏰', name: 'IIT return deadline', title: 'Income tax return — 30 November deadline',
    body: `Dear {name},\n\nA friendly reminder: the Income Tax Return for Y/A ${filingYear()} must be filed by 30 November. Please send us any pending documents (salary/APIT certificates, bank interest/WHT certificates, rent details) so we can file on time.\n\nආයුබෝවන් {name}, ${filingYear()} ආදායම් බදු ප්‍රකාශය නොවැම්බර් 30 ට පෙර ගොනු කළ යුතුයි. කරුණාකර ඉතිරි ලියකියවිලි ඉක්මනින් එවන්න.\n\nThank you,\n${FIRM.name} · WhatsApp ${FIRM.whatsapp}` },
  { key: 'docs', emoji: '📄', name: 'Documents needed', title: 'Documents needed for your tax file',
    body: `Dear {name},\n\nTo complete your tax file we still need a few documents. You can upload them in the TaxMate portal (Documents) or send them here on WhatsApp.\n\nආයුබෝවන් {name}, ඔබගේ බදු ගොනුව සම්පූර්ණ කිරීමට තවත් ලියකියවිලි කිහිපයක් අවශ්‍යයි. Portal එකේ Documents වෙත upload කරන්න හෝ WhatsApp කරන්න.\n\nThank you,\n${FIRM.name}` },
  { key: 'payment', emoji: '💳', name: 'Payment reminder', title: 'Friendly payment reminder',
    body: `Dear {name},\n\nThis is a gentle reminder that your TaxMate service invoice is due. You can view and pay it in the portal (Invoices). Please ignore this if you have already paid — thank you!\n\nආයුබෝවන් {name}, ඔබගේ TaxMate සේවා ගාස්තු බිල්පත ගෙවීමට නියමිතයි. Portal එකේ Invoices හරහා බලා ගෙවිය හැක. දැනටමත් ගෙවා ඇත්නම් ස්තූතියි!\n\n${FIRM.name}` },
  { key: 'instalment', emoji: '🏦', name: 'Tax instalment due', title: 'Quarterly income tax instalment',
    body: `Dear {name},\n\nYour quarterly income tax instalment is due on the 15th. Please make the payment through your bank or the IRD payment portal and send us the receipt.\n\nආයුබෝවන් {name}, ඔබගේ කාර්තුමය ආදායම් බදු වාරිකය 15 වන දිනට ගෙවිය යුතුයි. ගෙවීමෙන් පසු රිසිට්පත අපට එවන්න.\n\n${FIRM.name}` },
  { key: 'update', emoji: '📢', name: 'New tax update', title: 'Important tax update',
    body: `Dear {name},\n\nThere is a new tax update that may affect you. Please read the details in the TaxMate portal (Tax Updates) or reply here and we will explain.\n\nආයුබෝවන් {name}, ඔබට බලපාන නව බදු යාවත්කාලීනයක් ඇත. විස්තර Portal එකේ Tax Updates වල බලන්න.\n\n${FIRM.name}` },
  { key: 'holiday', emoji: '🗓️', name: 'Office closed', title: 'Office closed notice',
    body: `Dear {name},\n\nPlease note our office will be closed on ____. You can still message us on WhatsApp and we will reply when we are back.\n\nආයුබෝවන් {name}, ____ දින අපගේ කාර්යාලය වසා ඇත. WhatsApp පණිවිඩ එවන්න, අපි නැවත පැමිණි පසු පිළිතුරු දෙන්නෙමු.\n\n${FIRM.name}` },
  { key: 'greeting', emoji: '🎉', name: 'Festival greeting', title: 'Warm wishes from TaxMate',
    body: `Dear {name},\n\nWishing you and your family a happy and prosperous season! Thank you for trusting ${FIRM.name}.\n\nඔබට සහ ඔබේ පවුලේ සැමට සුබ සහ සමෘද්ධිමත් කාලයක් වේවා! 🙏\n\n${FIRM.name}` },
  { key: 'review', emoji: '⭐', name: 'Ask for a Google review', title: 'Could you leave us a review?',
    body: `Dear {name},\n\nThank you for choosing ${FIRM.name}! If you were happy with our service, a short Google review would mean a lot to us:\nhttps://g.page/r/CRFScdrka6WBEBM/review\n\nඔබ අපගේ සේවාවට සතුටු නම්, කෙටි Google review එකක් ලබා දෙන්න. ස්තූතියි! 🙏` },
];

// ─── Export ──────────────────────────────────────────────
const vEsc = (s) => String(s ?? '').replace(/\\/g, '\\\\').replace(/\n/g, '\\n').replace(/([,;])/g, '\\$1');
/** vCard 3.0 file — import into a phone's Contacts */
export function toVcf(contacts) {
  return contacts.map((c) => {
    const tel = (p) => { const n = waNumber(p); return n ? `+${n}` : clean(p); };
    const lines = ['BEGIN:VCARD', 'VERSION:3.0', `FN:${vEsc(c.name)}`, `N:${vEsc(c.name)};;;;`];
    if (c.mobile || c.phone) lines.push(`TEL;TYPE=CELL:${tel(c.mobile || c.phone)}`);
    if (c.contact?.mobile && phoneKey(c.contact.mobile) !== phoneKey(c.mobile)) lines.push(`TEL;TYPE=OTHER:${tel(c.contact.mobile)}`);
    if (c.email) lines.push(`EMAIL:${vEsc(c.email)}`);
    lines.push(`ORG:${vEsc(c.kind === 'client' ? `TaxMate client${c.client_no ? ` ${c.client_no}` : ''}` : 'TaxMate lead')}`);
    const note = [c.client_no && `Client no ${c.client_no}`, c.tin && `TIN ${c.tin}`, c.contact?.name && `Contact: ${c.contact.name}${c.contact.relation ? ` (${c.contact.relation})` : ''}`].filter(Boolean).join(' · ');
    if (note) lines.push(`NOTE:${vEsc(note)}`);
    lines.push('END:VCARD');
    return lines.join('\r\n');
  }).join('\r\n');
}
export function downloadText(name, text, type) {
  const url = URL.createObjectURL(new Blob([text], { type }));
  const a = Object.assign(document.createElement('a'), { href: url, download: name });
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}
const HEAD = ['Type', 'Client no', 'Name', 'Mobile', 'Email', 'Contact person', 'Contact mobile', 'TIN', 'NIC', 'Portal', 'Calls'];
/** rows for downloadXlsx (header row first) */
export const exportRows = (contacts) => [HEAD.map((h) => ({ v: h, s: 'h' })), ...contacts.map((c) => [
  c.kind === 'client' ? 'Client' : 'Lead', c.client_no || '', c.name, c.mobile || c.phone || '', c.email || '',
  c.contact?.name ? `${c.contact.name}${c.contact.relation ? ` (${c.contact.relation})` : ''}` : '', c.contact?.mobile || '',
  c.tin || '', c.nic || '', c.kind === 'client' ? (c.portal ? 'Yes' : 'No') : '', c.calls || 0,
])];
export const EXPORT_WIDTHS = [8, 10, 32, 16, 28, 28, 16, 14, 14, 8, 7];
