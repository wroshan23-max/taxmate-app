// V54 — RAMIS Economic Activity Code finder (admin, client portal and public page)
import { useEffect, useMemo, useState } from 'react';
import toast from 'react-hot-toast';
import { Search, Copy, Loader2, Star, ListTree, ExternalLink, Info, MessageCircle, X } from 'lucide-react';
import { FIRM } from '../lib/firm';
import { waNumber } from '../lib/share';

const copy = async (code, what) => {
  try { await navigator.clipboard.writeText(code); toast.success(`${code} copied${what ? ` — ${what}` : ''}`); }
  catch { toast.error('Could not copy — select the code and copy it'); }
};
// Official text is in CAPITALS — show it as a sentence, keep the code exact
const nice = (s) => { const t = String(s || '').toLowerCase(); return t.charAt(0).toUpperCase() + t.slice(1); };
const norm = (s) => String(s || '').toLowerCase().replace(/[^a-z0-9඀-෿]+/g, ' ').trim();

function CodeRow({ c, path, label }) {
  return (
    <div className="flex items-start gap-3 py-2.5">
      <button onClick={() => copy(c.code, label)} title="Click to copy"
        className="group flex-shrink-0 font-mono font-black text-primary-800 bg-primary-50 hover:bg-primary-100 border border-primary-100 rounded-lg px-2.5 py-1 text-sm tracking-wider inline-flex items-center gap-1.5">
        {c.code}<Copy size={12} className="opacity-40 group-hover:opacity-100" />
      </button>
      <div className="min-w-0 flex-1">
        <div className="text-sm text-gray-800 leading-snug">{nice(c.desc)}</div>
        {c.code === '000000' && <div className="text-[11px] text-amber-700 mt-0.5">⚠ RAMIS placeholder — it means no activity code is set yet. Don't choose it; pick the code for the real business.</div>}
        {path && <div className="text-[11px] text-gray-400 mt-0.5 truncate">{path}</div>}
      </div>
    </div>
  );
}

/** mode: 'admin' | 'client' | 'public' */
export default function ActivityCodeFinder({ mode = 'admin' }) {
  const [data, setData] = useState(null);
  const [q, setQ] = useState('');
  const [div, setDiv] = useState('');
  const [limit, setLimit] = useState(60);

  useEffect(() => { import('../lib/activityCodes').then(setData).catch(() => toast.error('Could not load the code list — refresh the page')); }, []);
  useEffect(() => { setLimit(60); }, [q, div]);

  const all = useMemo(() => {
    if (!data) return [];
    const common = new Map(data.COMMON.map(c => [c.code, c]));
    return data.CODES.map(([code, desc, gi]) => {
      const [di, group] = data.GROUPS[gi];
      const division = data.DIVISIONS[di];
      const cm = common.get(code);
      return { code, desc, group, division, di, common: cm, hay: norm(`${code} ${desc} ${group} ${division} ${cm ? `${cm.en} ${cm.si}` : ''}`) };
    });
  }, [data]);

  const words = norm(q).split(' ').filter(Boolean);
  const results = useMemo(() => {
    if (!words.length) return [];
    const digits = /^\d+$/.test(q.trim()) ? q.trim() : null;
    const hit = all.filter(r => (digits ? r.code.startsWith(digits) : words.every(w => r.hay.includes(w))));
    // codes TaxMate clients use most, then exact code / description starts first
    return hit.sort((a, b) => (!!b.common - !!a.common) || a.code.localeCompare(b.code));
  }, [all, q]); // eslint-disable-line react-hooks/exhaustive-deps

  const divGroups = useMemo(() => {
    if (div === '') return [];
    const m = new Map();
    for (const r of all) if (String(r.di) === div) { if (!m.has(r.group)) m.set(r.group, []); m.get(r.group).push(r); }
    return [...m.entries()];
  }, [all, div]);

  if (!data) return <div className="card p-10 text-center"><Loader2 className="animate-spin mx-auto text-gray-400" /><div className="text-xs text-gray-400 mt-2">Loading the IRD codes…</div></div>;

  const wa = `https://wa.me/${waNumber(FIRM.whatsapp)}?text=${encodeURIComponent('Hi TaxMate, which RAMIS activity code should I use for my business?')}`;

  return (
    <div className="space-y-4">
      <div className="card p-4 sm:p-5 space-y-3">
        <div className="relative">
          <Search size={18} className="absolute left-3.5 top-1/2 -translate-y-1/2 text-gray-400" />
          <input className="input pl-11 pr-10 py-3 text-base" autoFocus={mode !== 'client'} value={q} onChange={e => setQ(e.target.value)}
            placeholder="Search a business — e.g. tuition, taxi, software, 692010, ටියුෂන්" aria-label="Search activity codes" />
          {q && <button onClick={() => setQ('')} className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600" aria-label="Clear"><X size={18} /></button>}
        </div>
        <div className="text-xs text-gray-500 flex items-start gap-1.5">
          <Info size={13} className="flex-shrink-0 mt-0.5" />
          <span>{data.SOURCE.count.toLocaleString('en-LK')} official 6-digit codes from the IRD list. Choose the code that best matches your main business or professional activity — click a code to copy it into RAMIS. ව්‍යාපාරයට ගැළපෙන කේතය තෝරන්න.</span>
        </div>
      </div>

      {words.length > 0 ? (
        <div className="card p-4 sm:p-5">
          <div className="text-sm font-semibold text-gray-700 mb-1">{results.length ? `${results.length} code${results.length === 1 ? '' : 's'} found` : 'No code found'}</div>
          {!results.length && <p className="text-sm text-gray-500">Try another word (e.g. “shop”, “repair”, “growing”, “retail”) or browse by category below.</p>}
          <div className="divide-y divide-gray-50">
            {results.slice(0, limit).map(r => (
              <div key={r.code}>
                {r.common && <div className="text-[11px] font-semibold text-gold-600 mt-2 -mb-1 flex items-center gap-1"><Star size={11} /> Common: {r.common.en} · {r.common.si}</div>}
                <CodeRow c={r} path={`${nice(r.division)} › ${nice(r.group)}`} label={r.common?.en} />
              </div>
            ))}
          </div>
          {results.length > limit && <button onClick={() => setLimit(l => l + 100)} className="btn-secondary text-sm w-full justify-center mt-2">Show more ({results.length - limit} left)</button>}
        </div>
      ) : (
        <div className="card p-4 sm:p-5">
          <div className="font-bold text-gray-800 flex items-center gap-2"><Star size={16} className="text-gold-500" /> Commonly used codes <span className="font-normal text-gray-400 text-sm">· බහුලව භාවිතා වන කේත</span></div>
          <div className="grid sm:grid-cols-2 xl:grid-cols-3 gap-2 mt-3">
            {data.COMMON.map(c => (
              <button key={c.code} onClick={() => copy(c.code, c.en)} title="Click to copy"
                className="group text-left rounded-xl border border-gray-200 hover:border-primary-300 hover:shadow-sm bg-white p-3 flex items-center gap-3">
                <span className="font-mono font-black text-primary-800 bg-primary-50 rounded-lg px-2 py-1 text-sm tracking-wider">{c.code}</span>
                <span className="min-w-0 flex-1">
                  <span className="block text-sm font-semibold text-gray-800 leading-tight">{c.en}</span>
                  <span className="block text-[11px] text-gray-500 leading-tight">{c.si}</span>
                </span>
                <Copy size={13} className="text-gray-300 group-hover:text-primary-600 flex-shrink-0" />
              </button>
            ))}
          </div>
        </div>
      )}

      <div className="card p-4 sm:p-5 space-y-3">
        <div className="font-bold text-gray-800 flex items-center gap-2"><ListTree size={16} className="text-primary-600" /> Browse all codes by category</div>
        <select className="input" value={div} onChange={e => setDiv(e.target.value)} aria-label="Category (division)">
          <option value="">Choose a category ({data.DIVISIONS.length} divisions)…</option>
          {data.DIVISIONS.map((d, i) => <option key={i} value={String(i)}>{nice(d)}</option>)}
        </select>
        {divGroups.map(([g, list]) => (
          <details key={g} className="rounded-xl border border-gray-100 open:bg-gray-50/50" open={divGroups.length <= 3}>
            <summary className="cursor-pointer px-3 py-2.5 text-sm font-semibold text-primary-800 flex items-center gap-2">
              <span className="flex-1">{nice(g)}</span><span className="text-[11px] text-gray-400 font-normal">{list.length} codes</span>
            </summary>
            <div className="px-3 pb-2 divide-y divide-gray-100">{list.map(r => <CodeRow key={r.code} c={r} />)}</div>
          </details>
        ))}
      </div>

      <div className="text-[11px] text-gray-500 flex flex-wrap items-center gap-x-3 gap-y-1">
        <span>Source: Inland Revenue Department — “Economic Activity Codes” (RAMIS) and “Business Activity Code” list (2018). IRD can update the lists; if RAMIS shows a different wording, follow RAMIS.</span>
        <a href={data.SOURCE.url} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 font-semibold text-primary-700 hover:underline">RAMIS list PDF <ExternalLink size={11} /></a>
        <a href={data.SOURCE.url2018} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 font-semibold text-primary-700 hover:underline">2018 list PDF <ExternalLink size={11} /></a>
        {mode !== 'admin' && <a href={wa} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 font-semibold text-green-700 hover:underline"><MessageCircle size={12} /> Not sure? Ask TaxMate</a>}
      </div>
    </div>
  );
}
