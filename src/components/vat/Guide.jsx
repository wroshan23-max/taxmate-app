// V64.2 — VAT Invoice user guide (English / Sinhala), with live quick-start ticks, search and print
import { Fragment, useMemo, useState } from 'react';
import { BookOpen, Printer, Search, CheckCircle2, Circle, ArrowRight, Info, LogIn, Building2, Palette, Hash, CalendarClock, Users, Package, FileText, FileMinus,
  Wallet, Undo2, Landmark, Inbox, BarChart3, UserCog, Crown, ShieldCheck, HelpCircle, Lightbulb } from 'lucide-react';
import { GUIDE, GUIDE_UI, QUICK } from '../../lib/vat/guide';
import { openPrintWindow, writePrint } from '../../lib/vat/printDoc';

const ICONS = { Info, LogIn, Building2, Palette, Hash, CalendarClock, Users, Package, FileText, FileMinus, Wallet, Undo2, Landmark, Inbox, BarChart3, UserCog, Crown, ShieldCheck, HelpCircle };
const LS = 'tm_vat_guide_lang';
const getLang = () => { try { return localStorage.getItem(LS) === 'si' ? 'si' : 'en'; } catch { return 'en'; } };

/** "**bold**" → <b> */
function Rich({ text }) {
  const parts = String(text).split(/\*\*(.+?)\*\*/g);
  return parts.map((p, i) => (i % 2 ? <b key={i} className="font-semibold text-gray-900">{p}</b> : <Fragment key={i}>{p}</Fragment>));
}
const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const richHtml = (s) => esc(s).replace(/\*\*(.+?)\*\*/g, '<b>$1</b>');

export default function Guide({ app }) {
  const { go } = app;
  const [lang, setLangState] = useState(getLang);
  const [q, setQ] = useState('');
  const setLang = (l) => { setLangState(l); try { localStorage.setItem(LS, l); } catch { /* private mode */ } };
  const ui = GUIDE_UI[lang];

  const sections = useMemo(() => {
    const needle = q.trim().toLowerCase();
    if (!needle) return GUIDE;
    return GUIDE.filter((s) => {
      const c = s[lang];
      return [c.t, ...c.steps, ...c.tips, s.en.t].join(' ').toLowerCase().includes(needle);
    });
  }, [q, lang]);
  const quick = QUICK.map((x) => ({ ...x, ok: !!x.check(app) }));
  const doneN = quick.filter((x) => x.ok).length;
  const jump = (id) => document.getElementById(`g-${id}`)?.scrollIntoView({ behavior: 'smooth', block: 'start' });

  const print = () => {
    const w = openPrintWindow();
    const body = GUIDE.map((s) => {
      const c = s[lang];
      return `<section><h2>${esc(c.t)}</h2><ol>${c.steps.map((x) => `<li>${richHtml(x)}</li>`).join('')}</ol>${c.tips.length ? `<div class="tip"><b>${esc(ui.tips)}:</b><ul>${c.tips.map((x) => `<li>${richHtml(x)}</li>`).join('')}</ul></div>` : ''}</section>`;
    }).join('');
    const quickHtml = `<section class="quick"><h2>${esc(ui.quick)}</h2><ol>${QUICK.map((x) => `<li>${richHtml(x[lang])}</li>`).join('')}</ol></section>`;
    writePrint(w, `<!doctype html><html lang="${lang}"><head><meta charset="utf-8"><title>${esc(ui.title)}</title><style>
      @page{size:A4;margin:14mm} body{font:12.5px/1.55 'Noto Sans Sinhala','Iskoola Pota',Arial,sans-serif;color:#1f2937;margin:0}
      h1{color:#1e3a8a;font-size:22px;margin:0 0 2px} .sub{color:#6b7280;margin:0 0 14px} h2{color:#1e3a8a;font-size:15px;margin:16px 0 6px;border-bottom:1px solid #e5e7eb;padding-bottom:3px}
      section{break-inside:avoid-page} ol{margin:0;padding-left:20px} li{margin:2px 0} .tip{background:#fffbeb;border:1px solid #fde68a;border-radius:6px;padding:6px 10px;margin-top:6px}
      .tip ul{margin:2px 0 0;padding-left:18px} .quick{background:#eff6ff;border:1px solid #bfdbfe;border-radius:8px;padding:4px 12px 8px} .foot{margin-top:18px;color:#6b7280;font-size:11px}
      .bar{position:sticky;top:0;background:#fff;padding:8px 0;text-align:right} .bar button{font:600 13px Arial;background:#1e3a8a;color:#fff;border:0;border-radius:6px;padding:7px 14px;cursor:pointer}
      @media screen{body{max-width:860px;margin:0 auto;padding:0 18px 30px}} @media print{.bar{display:none}}</style></head><body><div class="bar"><button onclick="print()">${esc(ui.print)}</button></div>
      <h1>${esc(ui.title)}</h1><p class="sub">${esc(ui.sub)} · TaxMate Solutions</p>${quickHtml}${body}<p class="foot">${esc(ui.help)}</p></body></html>`);
  };

  return (
    <div className="space-y-3">
      <div className="card overflow-hidden">
        <div className="bg-gradient-to-br from-primary-700 to-primary-900 p-4 text-white sm:p-5">
          <div className="flex flex-wrap items-start gap-3">
            <BookOpen size={28} className="shrink-0 text-gold-400" />
            <div className="min-w-0 flex-1">
              <h2 className="text-lg font-black sm:text-xl">{ui.title}</h2>
              <p className="text-sm text-primary-100">{ui.sub}</p>
            </div>
            <div className="flex rounded-full bg-white/15 p-0.5 text-xs font-bold" role="group" aria-label="Language">
              {[['en', 'English'], ['si', 'සිංහල']].map(([k, l]) => (
                <button key={k} type="button" onClick={() => setLang(k)} aria-pressed={lang === k}
                  className={`rounded-full px-3 py-1 ${lang === k ? 'bg-white text-primary-800' : 'text-white'}`}>{l}</button>
              ))}
            </div>
          </div>
          <div className="mt-3 flex flex-col gap-2 sm:flex-row">
            <div className="relative min-w-0 flex-1">
              <Search size={14} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-gray-400" />
              <input className="input w-full py-1.5 pl-8 text-sm text-gray-800" placeholder={ui.search} value={q} onChange={(e) => setQ(e.target.value)} aria-label={ui.search} />
            </div>
            <button type="button" onClick={print} className="inline-flex items-center justify-center gap-1.5 rounded-lg bg-white/15 px-3 py-1.5 text-sm font-semibold hover:bg-white/25"><Printer size={15} /> {ui.print}</button>
          </div>
        </div>

        {!q && (
          <div className="p-4">
            <div className="mb-2 flex items-center gap-2 text-sm font-bold text-primary-800">{ui.quick}<span className="ml-auto whitespace-nowrap rounded-full bg-primary-50 px-2 py-0.5 text-xs text-primary-700">{doneN}/{quick.length} {ui.done}</span></div>
            <div className="h-1.5 overflow-hidden rounded bg-gray-100"><div className="h-1.5 rounded bg-green-500 transition-all" style={{ width: `${(doneN / quick.length) * 100}%` }} /></div>
            <ol className="mt-3 space-y-1.5">
              {quick.map((x, i) => (
                <li key={x.id}>
                  <button type="button" onClick={() => go(...x.go)} className="flex w-full items-start gap-2 rounded-lg border px-3 py-2 text-left text-sm hover:border-primary-200 hover:bg-primary-50/40">
                    {x.ok ? <CheckCircle2 size={17} className="mt-0.5 shrink-0 text-green-600" /> : <Circle size={17} className="mt-0.5 shrink-0 text-gray-300" />}
                    <span className={`flex-1 ${x.ok ? 'text-gray-500 line-through decoration-gray-300' : 'text-gray-700'}`}>{i + 1}. <Rich text={x[lang]} /></span>
                    <ArrowRight size={15} className="mt-0.5 shrink-0 text-primary-600" />
                  </button>
                </li>
              ))}
            </ol>
          </div>
        )}
      </div>

      {!q && (
        <div className="card p-3">
          <div className="mb-1.5 text-xs font-bold uppercase tracking-wide text-gray-500">{ui.contents}</div>
          <div className="flex flex-wrap gap-1.5">
            {GUIDE.map((s) => <button key={s.id} type="button" onClick={() => jump(s.id)} className="rounded-full border bg-white px-2.5 py-1 text-xs text-gray-700 hover:border-primary-300 hover:text-primary-700">{s[lang].t}</button>)}
          </div>
        </div>
      )}

      {sections.length === 0 && <div className="card p-6 text-center text-sm text-gray-500">{ui.none}</div>}
      {sections.map((s) => {
        const c = s[lang]; const Icon = ICONS[s.icon] || Info;
        return (
          <section key={s.id} id={`g-${s.id}`} className="card scroll-mt-4 p-4">
            <div className="mb-2 flex flex-wrap items-center gap-2">
              <Icon size={18} className="text-primary-700" />
              <h3 className="flex-1 font-bold text-primary-800">{c.t}</h3>
              {s.go && <button type="button" onClick={() => go(...s.go)} className="inline-flex items-center gap-1 rounded-lg border border-primary-200 px-2.5 py-1 text-xs font-semibold text-primary-700 hover:bg-primary-50">{ui.open} <ArrowRight size={13} /></button>}
            </div>
            <ol className="list-decimal space-y-1.5 pl-5 text-sm leading-relaxed text-gray-700 marker:font-semibold marker:text-primary-600">
              {c.steps.map((x, i) => <li key={i}><Rich text={x} /></li>)}
            </ol>
            {c.tips.length > 0 && (
              <div className="mt-3 rounded-lg border border-amber-200 bg-amber-50 p-3 text-xs leading-relaxed text-amber-900">
                <div className="mb-1 flex items-center gap-1 font-semibold"><Lightbulb size={13} /> {ui.tips}</div>
                <ul className="list-disc space-y-0.5 pl-4">{c.tips.map((x, i) => <li key={i}><Rich text={x} /></li>)}</ul>
              </div>
            )}
          </section>
        );
      })}
      <div className="card bg-primary-50/50 p-3 text-sm text-primary-900">{ui.help}</div>
    </div>
  );
}
