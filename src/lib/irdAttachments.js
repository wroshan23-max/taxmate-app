// ═══════════════════════════════════════════════════════════════════════════
//  V84 — IRD attachments pack for an individual's return (RAMIS "Verification of Attachment / Documents")
//
//  RAMIS asks two check-lists before submitting the IIT return:
//   A. Verification of return  — Return of Income, Schedule 1 … 10, Schedule for Withholding Tax Credit
//   B. Verification of attachment / documents — Statement of Assets & Liabilities, T-10 certificate, T-10D,
//      Statement of Accounts, WHT certificates, copy of the rental agreement, Tax Computation,
//      Statement of Partnership Income (PIT) with schedules, Trust return with schedules, other documents.
//  This module decides which items are relevant from the computation, the draft and the business accounts,
//  and builds one printable pack (each document on its own pages).
// ═══════════════════════════════════════════════════════════════════════════

const n = (v) => { const x = Number(String(v ?? '').replace(/,/g, '')); return Number.isFinite(x) ? x : 0; };

export const RETURN_ITEMS = [
  { key: 'return', sn: 1, en: 'Return of Income', sections: ['return', 'decl'] },
  { key: 'sch1', sn: 2, en: 'Schedule 1', hint: 'Employment income', sections: ['sch1'] },
  { key: 'sch2', sn: 3, en: 'Schedule 2', hint: 'Business income', sections: ['sch2'] },
  { key: 'sch3', sn: 4, en: 'Schedule 3', hint: 'Investment income', sections: ['sch3'] },
  { key: 'sch4', sn: 5, en: 'Schedule 4', hint: 'Other income & foreign currency remitted', sections: ['sch4'] },
  { key: 'sch5', sn: 6, en: 'Schedule 5', hint: 'Qualifying payments & reliefs (donations, solar)', sections: ['sch5'] },
  { key: 'sch6', sn: 7, en: 'Schedule 6', hint: 'Final WHT payments (lottery, winnings…) — enter in RAMIS if any', sections: null },
  { key: 'sch7', sn: 8, en: 'Schedule 7', hint: 'AIT / WHT deducted', sections: ['sch7'] },
  { key: 'sch8', sn: 9, en: 'Schedule 8', hint: 'Tax calculation', sections: ['sch8'] },
  { key: 'sch9', sn: 10, en: 'Schedule 9', hint: 'Tax credits', sections: ['sch9'] },
  { key: 'sch10', sn: 11, en: 'Schedule 10', hint: 'Loss adjustment', sections: ['sch10'] },
  { key: 'whtSch', sn: 12, en: 'Schedule for Withholding Tax Credit', hint: 'Schedule 7A certificates', sections: ['sch7'] },
];
export const DOC_ITEMS = [
  { key: 'al', sn: 1, en: 'Statement of Assets & Liabilities', gen: true },
  { key: 't10', sn: 2, en: 'T- 10 Certificate', vault: (d) => d.category === 'salary' || /t[\s-]*10(?!\s*d)/i.test(d.title || '') },
  { key: 't10d', sn: 3, en: 'T-10D', vault: (d) => /t[\s-]*10\s*d/i.test(d.title || '') },
  { key: 'accounts', sn: 4, en: 'Statement of Accounts', gen: true },
  { key: 'whtCert', sn: 5, en: 'WHT Certificates', vault: (d) => /wht|ait|withholding|interest cert/i.test(`${d.title} ${d.category}`) || d.category === 'bank' },
  { key: 'rental', sn: 6, en: 'Copy of the Rental Agreement', vault: (d) => d.category === 'rent' || /rent|lease agreement/i.test(d.title || '') },
  { key: 'computation', sn: 7, en: 'Tax Computation', gen: true },
  { key: 'pit', sn: 8, en: 'Statement of Partnership Income (PIT) With Schedules', gen: true },
  { key: 'trust', sn: 9, en: 'Trust Return with Schedules' },
  { key: 'other', sn: 10, en: 'Other relevant Documents' },
];

/**
 * Auto-ticks. C = draftCages(), d = filing draft data, biz = { sole: [...], partnerships: [...] }, al = A&L statement row
 * → { key: { on: bool, why: string } }
 */
export function relevance({ C, d = {}, biz = { sole: [], partnerships: [] }, al = null, docs = [] }) {
  const cr = C?.credit || {}, f = C?.r?.f || {};
  const R = {};
  const set = (k, on, why) => { R[k] = { on: !!on, why }; };
  set('return', true, 'Always');
  set('sch1', C?.c10 > 0 || C?.c802 > 0 || (d.sch1?.exempt ?? []).length, C?.c10 > 0 ? `Employment income Rs. ${fmt(C.c10)}` : 'No employment income');
  set('sch2', C?.c20 > 0 || (d.sch2?.partner ?? []).length || n(f.bizPartner), C?.c20 > 0 ? `Business income Rs. ${fmt(C.c20)}` : 'No business income');
  set('sch3', C?.c30 > 0 || C?.c60 > 0, C?.c30 > 0 ? `Investment income Rs. ${fmt(C.c30)}` : 'No investment income');
  set('sch4', C?.c40 > 0 || C?.c210A > 0, C?.c40 > 0 ? `Other income Rs. ${fmt(C.c40)}` : C?.c210A > 0 ? 'Foreign currency remitted (210A)' : 'No other income');
  set('sch5', C?.c100 > 0 || C?.c70 > 0, C?.c100 > 0 || C?.c70 > 0 ? 'Qualifying payments / solar relief claimed' : 'No qualifying payments');
  set('sch6', false, 'Final withholding payments are not entered in the app');
  set('sch7', cr['908'] > 0 || cr['907'] > 0 || (d.sch7?.wht ?? []).length, cr['908'] > 0 ? `AIT/WHT credit Rs. ${fmt(cr['908'])}` : cr['907'] > 0 ? 'AIT from the partnership (7C)' : 'No AIT/WHT');
  set('sch8', C?.c120 > 0 || C?.c802 > 0 || C?.c806 > 0, C?.c120 > 0 ? `Taxable income Rs. ${fmt(C.c120)}` : 'No taxable income');
  set('sch9', C?.c180 > 0, C?.c180 > 0 ? `Tax credits Rs. ${fmt(C.c180)}` : 'No tax credits');
  set('sch10', n(d.sch10?.lossBF) > 0 || n(C?.r?.bizLoss) > 0, n(d.sch10?.lossBF) > 0 ? 'Loss brought forward' : 'No losses');
  set('whtSch', cr['908'] > 0, cr['908'] > 0 ? `${(d.sch7?.wht ?? []).length} certificate row(s)` : 'No AIT/WHT');

  const has = (it) => docs.filter(it.vault || (() => false)).length;
  set('al', true, al ? `A&L statement (${al.status || 'open'})` : 'Required with every return — no statement yet');
  set('t10', cr['903'] > 0 || cr['904'] > 0, cr['903'] > 0 || cr['904'] > 0 ? `APIT credit Rs. ${fmt((cr['903'] || 0) + (cr['904'] || 0))} · ${has(DOC_ITEMS[1])} file(s) in Documents` : 'No APIT credit');
  set('t10d', has(DOC_ITEMS[2]) > 0, `${has(DOC_ITEMS[2])} file(s) in Documents`);
  set('accounts', biz.sole.length > 0, biz.sole.length ? biz.sole.map((a) => a.name).join(', ') : 'No sole proprietor business account');
  set('whtCert', cr['908'] > 0, cr['908'] > 0 ? `AIT/WHT credit Rs. ${fmt(cr['908'])} · ${has(DOC_ITEMS[4])} file(s) in Documents` : 'No AIT/WHT');
  set('rental', n(f.rentGross) > 0, n(f.rentGross) > 0 ? `Rent income Rs. ${fmt(f.rentGross)} · ${has(DOC_ITEMS[5])} file(s) in Documents` : 'No rent income');
  set('computation', true, 'Recommended with every return');
  set('pit', biz.partnerships.length > 0 || n(f.bizPartner) > 0, biz.partnerships.length ? biz.partnerships.map((a) => a.name).join(', ') : n(f.bizPartner) > 0 ? 'Partner income — no partnership account in the app' : 'Not a partner');
  set('trust', false, '');
  set('other', false, '');
  return R;
}
const fmt = (v) => n(v).toLocaleString('en-LK', { maximumFractionDigits: 2 });

// ─── One printable pack: each document in its own shadow root (styles stay separate), page break between ───
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
/** html document → { css, body } for embedding */
export function splitDoc(html) {
  const css = [...html.matchAll(/<style[^>]*>([\s\S]*?)<\/style>/gi)].map((x) => x[1]).join('\n')
    .replace(/(^|[}\s,])body(\s*[{,])/g, '$1.docbody$2').replace(/(^|[}\s,])html(\s*[{,])/g, '$1:host$2').replace(/@page\s*\{[^}]*\}/g, '');
  const bm = html.match(/<body[^>]*>([\s\S]*)<\/body>/i);
  const body = (bm ? bm[1] : html).replace(/<script[\s\S]*?<\/script>/gi, '');
  return { css, body };
}
/**
 * docs = [{ title, html }] — html built WITHOUT a toolbar. cover = { name, tin, year, lists: [{ title, items: [{ sn, en, on }] }] }
 */
export function buildPackHtml(docs, cover, { sign = true } = {}) {
  const payload = JSON.stringify(docs.map((x) => ({ title: x.title, ...splitDoc(x.html) }))).replace(/</g, '\\u003c');
  const lists = (cover.lists || []).map((l) => `<h3>${esc(l.title)}</h3><table><tr><th>S/N</th><th>Description</th><th>Relevant</th></tr>${l.items.map((x) => `<tr><td>${x.sn}</td><td>${esc(x.en)}</td><td style="text-align:center">${x.on ? '☑' : '☐'}</td></tr>`).join('')}</table>`).join('');
  return `<!doctype html><html><head><meta charset="utf-8"><title>IRD_Attachments_${esc(String(cover.year).replace('/', '-'))}_${esc(String(cover.name || '').replace(/\s+/g, '_'))}${sign ? '' : '_without_signature'}</title>
<style>*{box-sizing:border-box}body{margin:0;background:#e5e7eb;font:12px Arial,Helvetica,sans-serif;color:#111}
.bar{position:sticky;top:0;z-index:5;background:#12294A;color:#fff;padding:10px 16px;display:flex;gap:10px;align-items:center}.bar button{background:#C9A227;color:#12294A;border:0;border-radius:8px;padding:7px 14px;font-weight:700;cursor:pointer}
.sheet{background:#fff;max-width:900px;margin:14px auto;padding:22px 30px;box-shadow:0 1px 4px rgba(0,0,0,.15)}.doc{display:block}
.cover h1{font-size:18px;margin:0 0 4px}.cover table{border-collapse:collapse;width:100%;margin:6px 0 12px}.cover td,.cover th{border:1px solid #c9c3a9;padding:5px 8px;text-align:left}.cover th{background:#faf8ef}
.cover h3{margin:14px 0 4px;font-size:13px}.toc li{margin:2px 0}
@media print{body{background:#fff}.bar{display:none}.sheet{box-shadow:none;margin:0;max-width:none;padding:0}.sheet+.sheet{break-before:page}}@page{size:A4;margin:12mm}</style></head><body>
<div class="bar"><b>IRD attachments</b><span style="opacity:.85">${esc(cover.name)} · Y/A ${esc(cover.year)} · ${docs.length} document${docs.length === 1 ? '' : 's'} · ${sign ? 'with signature lines' : 'without signature'}</span><span style="flex:1"></span><button onclick="window.print()">Print / Save as PDF</button></div>
<div class="sheet cover"><h1>Documents attached to the return of income</h1><div>${esc(cover.name)}${cover.tin ? ` · TIN ${esc(cover.tin)}` : ''} · Year of assessment ${esc(cover.year)}</div>
${lists}<h3>Documents in this file</h3><ol class="toc">${docs.map((x) => `<li>${esc(x.title)}</li>`).join('')}</ol></div>
<div id="docs"></div>
<script type="application/json" id="pack">${payload}</script>
<script>(function(){var docs=JSON.parse(document.getElementById('pack').textContent);var box=document.getElementById('docs');
docs.forEach(function(d){var s=document.createElement('div');s.className='sheet';var h=document.createElement('div');h.className='doc';s.appendChild(h);box.appendChild(s);
var r=h.attachShadow({mode:'open'});r.innerHTML='<style>:host{display:block}.docbody{margin:0!important}'+d.css+'</style><div class="docbody">'+d.body+'</div>';});})();</script>
</body></html>`;
}
