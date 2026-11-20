// V66.2 — searchable client picker: type a name, TIN, NIC, phone or TM number and pick from the list.
// Keyboard: ↑ ↓ to move, Enter to choose, Esc to close. Works on phones (the list stays open while the keyboard shows).
import { useEffect, useMemo, useRef, useState } from 'react';
import { Search, X, ChevronDown, UserRound } from 'lucide-react';

const norm = (s) => String(s ?? '').toLowerCase();
const digits = (s) => String(s ?? '').replace(/\D/g, '');

export default function ClientPicker({ clients, value, onChange, placeholder = 'Search client — name, TIN, NIC, phone or TM no.', className = '', limit = 50 }) {
  const [q, setQ] = useState('');
  const [open, setOpen] = useState(false);
  const [hi, setHi] = useState(0);
  const boxRef = useRef(null), inputRef = useRef(null), listRef = useRef(null);
  const selected = clients.find((c) => c.id === value) || null;

  const matches = useMemo(() => {
    const words = norm(q).trim().split(/\s+/).filter(Boolean);
    const qd = digits(q);
    if (!words.length) return clients.slice(0, limit);
    const scored = [];
    for (const c of clients) {
      const name = norm(c.full_name);
      const hay = [name, norm(c.tin), norm(c.nic), norm(c.client_no), norm(c.email), norm(c.mobile)].join(' ');
      const textOk = words.every((w) => hay.includes(w));
      const numOk = qd.length >= 3 && [c.tin, c.nic, c.mobile, c.client_no].some((x) => digits(x).includes(qd));
      if (!textOk && !numOk) continue;
      const exact = norm(c.client_no) === norm(q).trim() || (qd.length >= 6 && [c.tin, c.nic, c.mobile].some((x) => digits(x) === qd || digits(x).endsWith(qd.slice(-9)) && qd.length >= 9));
      scored.push([exact ? -1 : name.startsWith(words[0]) ? 0 : name.split(/\s+/).some((p) => p.startsWith(words[0])) ? 1 : 2, c]);
    }
    return scored.sort((a, b) => a[0] - b[0]).slice(0, limit).map((x) => x[1]);
  }, [clients, q, limit]);

  useEffect(() => { setHi(0); }, [q]);
  useEffect(() => {
    if (!open) return undefined;
    const away = (e) => { if (!boxRef.current?.contains(e.target)) { setOpen(false); setQ(''); } };
    document.addEventListener('mousedown', away);
    document.addEventListener('touchstart', away, { passive: true });
    return () => { document.removeEventListener('mousedown', away); document.removeEventListener('touchstart', away); };
  }, [open]);
  useEffect(() => { listRef.current?.querySelector(`[data-i="${hi}"]`)?.scrollIntoView({ block: 'nearest' }); }, [hi]);

  const choose = (c) => { onChange(c ? c.id : ''); setOpen(false); setQ(''); inputRef.current?.blur(); };
  const key = (e) => {
    if (e.key === 'ArrowDown') { e.preventDefault(); setOpen(true); setHi((h) => Math.min(h + 1, matches.length - 1)); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); setHi((h) => Math.max(h - 1, 0)); }
    else if (e.key === 'Enter') { if (open && matches[hi]) { e.preventDefault(); choose(matches[hi]); } }
    else if (e.key === 'Escape') { setOpen(false); setQ(''); }
  };

  const label = (c) => `${c.full_name}${c.tin ? ` | TIN: ${c.tin}` : ''}`;
  return (
    <div ref={boxRef} className={`relative ${className}`}>
      <Search size={15} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
      <input
        ref={inputRef} type="text" role="combobox" aria-expanded={open} aria-autocomplete="list" aria-controls="client-picker-list"
        className={`input pl-9 pr-16 ${selected && !open ? 'font-medium text-gray-900' : ''}`}
        placeholder={selected ? label(selected) : placeholder}
        value={open ? q : selected ? label(selected) : ''}
        onFocus={() => { setOpen(true); setQ(''); }}
        onChange={(e) => { setQ(e.target.value); setOpen(true); }}
        onKeyDown={key}
      />
      <div className="absolute right-2 top-1/2 flex -translate-y-1/2 items-center gap-0.5">
        {selected && <button type="button" onClick={() => choose(null)} className="rounded p-1 text-gray-400 hover:bg-gray-100 hover:text-gray-700" aria-label="Clear client" title="Clear"><X size={15} /></button>}
        <button type="button" tabIndex={-1} onClick={() => { if (open) { setOpen(false); setQ(''); } else inputRef.current?.focus(); }} className="rounded p-1 text-gray-400" aria-label="Show clients"><ChevronDown size={16} /></button>
      </div>
      {open && (
        <div ref={listRef} id="client-picker-list" role="listbox" className="absolute left-0 right-0 z-40 mt-1 max-h-72 overflow-y-auto rounded-xl border border-gray-200 bg-white py-1 shadow-lg">
          {matches.length === 0 ? <div className="px-3 py-3 text-sm text-gray-500">No client matches “{q}”. Type the details below instead.</div>
            : matches.map((c, i) => (
              <button key={c.id} type="button" data-i={i} role="option" aria-selected={c.id === value}
                onMouseEnter={() => setHi(i)} onMouseDown={(e) => e.preventDefault()} onClick={() => choose(c)}
                className={`flex w-full items-start gap-2 px-3 py-2 text-left text-sm ${i === hi ? 'bg-primary-50' : ''} ${c.id === value ? 'font-semibold' : ''}`}>
                <UserRound size={15} className="mt-0.5 shrink-0 text-gray-400" />
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-gray-900">{c.full_name}</span>
                  <span className="block truncate text-xs text-gray-500">{[c.client_no, c.tin && `TIN ${c.tin}`, c.nic && `NIC ${c.nic}`, c.mobile].filter(Boolean).join(' · ') || '—'}</span>
                </span>
              </button>
            ))}
          {!q && clients.length > limit && <div className="px-3 py-1.5 text-[11px] text-gray-400">Showing {limit} of {clients.length} — type to search</div>}
        </div>
      )}
    </div>
  );
}
