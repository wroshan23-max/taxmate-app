// V83 — quick client search in the admin top bar (next to the date).
// Type a name, TM no., TIN, NIC, phone, email or contact person → open the client in one click / Enter.
// Shortcuts: "/" or Ctrl+K focuses it from anywhere; ↑ ↓ move; Enter opens; Esc closes.
import { useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Search, X, Loader2, Phone, MessageCircle, ChevronRight, Users } from 'lucide-react';
import { supabase } from '../lib/supabase';
import { telLink, waLink } from '../lib/callLog';

const norm = (s) => String(s ?? '').toLowerCase();
const digits = (s) => String(s ?? '').replace(/\D/g, '');
const COLS = 'id, full_name, client_no, tin, nic, mobile, email, contact_name, contact_mobile, archived_at';

let cache = null, cacheAt = 0;               // shared for the session; refreshed after 2 minutes
async function loadClients(force = false) {
  if (!force && cache && Date.now() - cacheAt < 120000) return cache;
  const { data, error } = await supabase.from('clients').select(COLS).order('full_name').limit(5000);
  if (error) throw error;
  cache = data ?? []; cacheAt = Date.now();
  return cache;
}

/** Best matches first: exact TM no. / ID / phone, then names starting with the first word, then the rest. */
export function searchClients(clients, q, limit = 8) {
  const words = norm(q).trim().split(/\s+/).filter(Boolean);
  const qd = digits(q);
  if (!words.length) return [];
  const out = [];
  for (const c of clients) {
    const name = norm(c.full_name);
    const hay = [name, norm(c.client_no), norm(c.tin), norm(c.nic), norm(c.email), norm(c.mobile), norm(c.contact_name), norm(c.contact_mobile)].join(' ');
    const textOk = words.every((w) => hay.includes(w));
    const numOk = qd.length >= 3 && [c.tin, c.nic, c.mobile, c.contact_mobile, c.client_no].some((x) => digits(x).includes(qd));
    if (!textOk && !numOk) continue;
    const exact = norm(c.client_no) === norm(q).trim()
      || (qd.length >= 6 && [c.tin, c.nic, c.mobile, c.contact_mobile].some((x) => digits(x) === qd || (qd.length >= 9 && digits(x).endsWith(qd.slice(-9)))));
    let rank = exact ? 0 : name.startsWith(words[0]) ? 1 : name.split(/\s+/).some((p) => p.replace(/[^a-z]/g, '').startsWith(words[0])) ? 2 : 3;
    if (c.archived_at) rank += 4;
    out.push([rank, c]);
  }
  return out.sort((a, b) => a[0] - b[0] || norm(a[1].full_name).localeCompare(norm(b[1].full_name))).slice(0, limit).map((x) => x[1]);
}

const Hi = ({ text, q }) => {
  const w = norm(q).trim().split(/\s+/)[0];
  const t = String(text ?? ''); const i = w ? t.toLowerCase().indexOf(w) : -1;
  if (i < 0) return t;
  return <>{t.slice(0, i)}<mark className="rounded bg-gold-500/30 px-0 text-inherit">{t.slice(i, i + w.length)}</mark>{t.slice(i + w.length)}</>;
};

export default function QuickClientSearch() {
  const navigate = useNavigate();
  const [q, setQ] = useState('');
  const [open, setOpen] = useState(false);
  const [clients, setClients] = useState(cache || []);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const [hi, setHi] = useState(0);
  const box = useRef(null), input = useRef(null);

  const warm = async () => {
    if (cache && Date.now() - cacheAt < 120000) { setClients(cache); return; }
    setBusy(true); setErr('');
    try { setClients(await loadClients(true)); } catch (e) { setErr(e.message || 'Could not load clients'); }
    setBusy(false);
  };

  // "/" or Ctrl/⌘+K → focus the box (not while typing in another field)
  useEffect(() => {
    const k = (e) => {
      const typing = /^(INPUT|TEXTAREA|SELECT)$/.test(e.target?.tagName) || e.target?.isContentEditable;
      if ((e.key === 'k' && (e.ctrlKey || e.metaKey)) || (e.key === '/' && !typing)) { e.preventDefault(); input.current?.focus(); input.current?.select(); }
    };
    document.addEventListener('keydown', k);
    return () => document.removeEventListener('keydown', k);
  }, []);
  useEffect(() => {
    if (!open) return undefined;
    const away = (e) => { if (!box.current?.contains(e.target)) setOpen(false); };
    document.addEventListener('mousedown', away);
    document.addEventListener('touchstart', away, { passive: true });
    return () => { document.removeEventListener('mousedown', away); document.removeEventListener('touchstart', away); };
  }, [open]);

  const list = useMemo(() => searchClients(clients, q), [clients, q]);
  useEffect(() => { setHi(0); }, [q]);

  const go = (c) => { setOpen(false); setQ(''); input.current?.blur(); navigate(`/admin/clients/${c.id}`); };
  const all = () => { setOpen(false); input.current?.blur(); navigate(`/admin/clients?q=${encodeURIComponent(q.trim())}`); setQ(''); };
  const key = (e) => {
    if (e.key === 'ArrowDown') { e.preventDefault(); setOpen(true); setHi((h) => Math.min(h + 1, Math.max(0, list.length - 1))); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); setHi((h) => Math.max(h - 1, 0)); }
    else if (e.key === 'Enter') { e.preventDefault(); if (list[hi]) go(list[hi]); else if (q.trim()) all(); }
    else if (e.key === 'Escape') { setOpen(false); setQ(''); input.current?.blur(); }
  };
  const show = open && q.trim().length > 0;
  const phone = (c) => c.mobile || c.contact_mobile;

  return (
    <div ref={box} className="relative w-full max-w-md">
      <Search size={15} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
      <input ref={input} type="search" value={q} role="combobox" aria-expanded={show} aria-label="Search clients"
        placeholder="Search clients — name, TM no., TIN, NIC, phone"
        onFocus={() => { setOpen(true); warm(); }} onChange={(e) => { setQ(e.target.value); setOpen(true); }} onKeyDown={key}
        className="w-full rounded-xl border border-gray-200 bg-gray-50 py-2 pl-9 pr-14 text-sm text-gray-800 placeholder:text-gray-400 focus:border-primary-300 focus:bg-white focus:outline-none focus:ring-2 focus:ring-primary-100 [&::-webkit-search-cancel-button]:hidden" />
      <span className="absolute right-2 top-1/2 flex -translate-y-1/2 items-center gap-1">
        {busy && <Loader2 size={14} className="animate-spin text-gray-400" />}
        {q ? <button type="button" onClick={() => { setQ(''); input.current?.focus(); }} className="rounded p-0.5 text-gray-400 hover:text-gray-600" aria-label="Clear"><X size={14} /></button>
          : <kbd className="hidden rounded border border-gray-200 bg-white px-1.5 text-[10px] font-semibold text-gray-400 lg:inline">Ctrl K</kbd>}
      </span>

      {show && (
        <div className="absolute left-0 right-0 top-full z-50 mt-1.5 overflow-hidden rounded-xl border border-gray-100 bg-white shadow-xl sm:min-w-[26rem]">
          {err ? <div className="p-3 text-sm text-red-600">{err}</div>
            : !list.length ? <div className="p-4 text-center text-sm text-gray-500">{busy ? 'Loading clients…' : <>No client matches “{q.trim()}”</>}</div>
            : (
              <ul className="max-h-[60vh] overflow-y-auto py-1" role="listbox">
                {list.map((c, i) => (
                  <li key={c.id} role="option" aria-selected={i === hi} onMouseEnter={() => setHi(i)}
                    className={`flex items-center gap-2.5 px-3 py-2 ${i === hi ? 'bg-primary-50' : ''}`}>
                    <button type="button" onClick={() => go(c)} className="flex min-w-0 flex-1 items-center gap-2.5 text-left">
                      <span className="flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-full bg-primary-100 text-xs font-bold text-primary-700">
                        {String(c.full_name || '?').replace(/^(mr|mrs|ms|miss|dr|rev)\.?\s+/i, '').trim().charAt(0).toUpperCase()}
                      </span>
                      <span className="min-w-0">
                        <span className="block truncate text-sm font-semibold text-gray-800"><Hi text={c.full_name} q={q} />{c.archived_at && <span className="ml-1.5 rounded bg-gray-100 px-1 text-[10px] font-semibold text-gray-500">archived</span>}</span>
                        <span className="block truncate text-[11px] text-gray-500">{[c.client_no, c.tin && `TIN ${c.tin}`, phone(c), !c.tin && c.nic && `NIC ${c.nic}`].filter(Boolean).join(' · ') || c.email || '—'}</span>
                      </span>
                    </button>
                    {phone(c) && <>
                      <a href={telLink(phone(c))} title={`Call ${phone(c)}`} className="hidden rounded-lg p-1.5 text-gray-400 hover:bg-white hover:text-primary-700 sm:block"><Phone size={14} /></a>
                      <a href={waLink(phone(c))} target="_blank" rel="noopener noreferrer" title="WhatsApp" className="hidden rounded-lg p-1.5 text-gray-400 hover:bg-white hover:text-green-600 sm:block"><MessageCircle size={14} /></a>
                    </>}
                    <ChevronRight size={14} className="flex-shrink-0 text-gray-300" />
                  </li>
                ))}
              </ul>
            )}
          {q.trim() && !err && (
            <button type="button" onClick={all} className="flex w-full items-center gap-2 border-t border-gray-100 px-3 py-2 text-left text-xs font-semibold text-primary-700 hover:bg-primary-50">
              <Users size={13} /> See all matches in Clients <span className="ml-auto text-[10px] font-normal text-gray-400">↑ ↓ · Enter to open</span>
            </button>
          )}
        </div>
      )}
    </div>
  );
}
