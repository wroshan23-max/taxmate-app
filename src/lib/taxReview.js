// Annual Tax Review report — this year vs last year, where the tax went, and how to
// save next year. Built from the client's FINAL IIT computations and snapshotted
// when issued (paid upsell: the client downloads it after the fee invoice is paid).
import { supabase } from './supabase';
import { computeReturn, annualToReturnInput, calcKind, yearCfg } from './iitCalc';
import { taxSavingTips } from './taxTips';
import { FIRM } from './iitStatement';
import { createFeeInvoice } from './summaryLetter';

export const REVIEW_STATUS = {
  requested: { label: 'Requested', cls: 'bg-amber-100 text-amber-800' },
  issued:    { label: 'Ready', cls: 'bg-emerald-100 text-emerald-700' },
  rejected:  { label: 'Not issued', cls: 'bg-red-100 text-red-700' },
  cancelled: { label: 'Cancelled', cls: 'bg-gray-100 text-gray-600' },
};
const errMsg = (e) => (e?.message || String(e)).replace(/^.*?ERROR:\s*/, '');
export const prevYearOf = (y) => { const s = parseInt(y, 10) - 1; return `${s}/${String(s + 1).slice(2)}`; };
export const nextYearOf = (y) => { const s = parseInt(y, 10) + 1; return `${s}/${String(s + 1).slice(2)}`; };
const R = (v) => Math.round(Number(v) || 0);

const inputOf = (calc) => (calcKind(calc) === 'return' ? calc.input_data : annualToReturnInput(calc.input_data)) || {};

/** Headline figures of one year from a saved computation */
export function yearSummary(calc) {
  if (!calc) return null;
  const r = computeReturn(calc.year, inputOf(calc));
  return {
    year: calc.year,
    income: { employment: R(r.cage10), business: R(r.cage20), investment: R(r.cage30), other: R(r.cage40) },
    foreign: R(r.fxTotal), assessable: R(r.cage50), reliefs: R(r.reliefs), qp: R(r.cage100), taxable: R(r.cage120),
    tax: R(r.cage170), credits: R(r.cage180), balance: R(r.balance),
    effRate: r.cage50 > 0 ? Math.round((r.cage170 / r.cage50) * 1000) / 10 : 0,
    bands: [...(r.prog?.detail ?? []).map(b => ({ label: `${Math.round(b.rate * 100)}%`, taxed: R(b.taxed), tax: R(b.tax) })),
      ...(r.fx?.bands ?? []).map(b => ({ label: `${Math.round(b.rate * 100)}% (foreign)`, taxed: R(b.taxed), tax: R(b.tax) }))].filter(b => b.taxed > 0),
    reliefParts: { personal: R(r.prUsed), rent: R(r.rentRelief), solar: R(r.solarUsed), donations: R(r.cage100) },
    credParts: r.credits.filter(c => c.amt > 0).map(c => ({ label: c.label, amt: R(c.amt) })),
    cfgText: yearCfg(calc.year).slabText,
  };
}

/** Map a return computation onto the personal-calculator input used by the savings tips */
export function personalInput(calc) {
  const f = computeReturn(calc.year, inputOf(calc)).f;
  return {
    residency: 'resident',
    salary: (f.empPrimary || 0) + (f.empSecondary || 0) + (f.empBenefits || 0) + (f.empBonus || 0),
    business: Math.max(0, (f.bizProfit || 0) + (f.bizPartner || 0) - (f.bizLossBF || 0)),
    rent: f.rentGross || 0, interest: f.interest || 0, otherLocal: (f.othInv || 0) + (f.othInc || 0),
    foreignFx: (f.empFx || 0) + (f.bizFx || 0) + (f.forFx || 0), foreignOther: f.forTaxable || 0,
    solar: 0, donCharity: 0, donGovt: f.donGovt || 0,                 // next year starts fresh
    apitPaid: f.apitPrimary || 0, whtInterestAuto: !!f.whtInterest,
  };
}

/** Recommendations the admin can edit before issuing */
export function defaultRecommendations(cur, prev, calc, tipsRes) {
  const out = [];
  const nxt = nextYearOf(cur.year);
  const f = computeReturn(calc.year, inputOf(calc)).f;
  // (money-saving tips are shown in their own section, so they are not repeated here)
  if (cur.balance > 50_000) out.push({ title: 'Pay quarterly instalments', body: `You had Rs. ${cur.balance.toLocaleString('en-LK')} left to pay at year end. Paying in four instalments (15 Aug, 15 Nov, 15 Feb, 15 May) avoids penalties and a big bill — we can calculate them for Y/A ${nxt}.` });
  if (cur.balance < -5_000) out.push({ title: 'Reduce over-deducted tax', body: `Tax deducted during the year was Rs. ${(-cur.balance).toLocaleString('en-LK')} more than your liability. If your income stays below Rs. 1.8 million, you can give your bank a self-declaration so no AIT is deducted from interest.` });
  if (f.interest > 0 && cur.taxable === 0) out.push({ title: 'Bank interest self-declaration', body: 'Your taxable income is nil — banks still deduct 10% AIT from interest unless you submit the self-declaration form. Ask us for help.' });
  if ((f.empFx || f.bizFx || f.forFx) > 0) out.push({ title: 'Keep foreign income going through a bank', body: 'Foreign-currency income remitted through a bank is capped at 15%. Keep your bank remittance letters / inward remittance certificates for every month.' });
  if (prev && cur.tax > prev.tax * 1.2 && cur.tax - prev.tax > 25_000) out.push({ title: 'Plan for higher tax', body: `Your tax rose by Rs. ${(cur.tax - prev.tax).toLocaleString('en-LK')} compared with Y/A ${prev.year}. Setting aside about Rs. ${Math.round(cur.tax / 12).toLocaleString('en-LK')} a month keeps you ready.` });
  out.push({ title: 'Keep your records monthly', body: `Upload salary slips, bank certificates and receipts to your TaxMate portal as you get them — it makes the Y/A ${nxt} return faster and more accurate.` });
  return out.slice(0, 8);
}

export function buildReviewData({ calc, prevCalc, client, recommendations }) {
  const cur = yearSummary(calc);
  const prev = prevCalc ? yearSummary(prevCalc) : null;
  const nxt = nextYearOf(calc.year);
  const tipsRes = taxSavingTips(nxt, personalInput(calc));
  return {
    client: { name: client.full_name || '', tin: client.tin || '' },
    year: calc.year, prevYear: prev?.year ?? null, nextYear: nxt,
    current: cur, previous: prev,
    tips: tipsRes.tips.map(t => ({ emoji: t.emoji, title: t.title, save: R(t.save), body: t.body, info: !!t.info })),
    combinedSave: R(tipsRes.combined),
    nextBase: { tax: R(tipsRes.base.tax), effRate: Math.round(tipsRes.base.effRate * 10) / 10 },
    recommendations: (recommendations ?? defaultRecommendations(cur, prev, calc, tipsRes)).filter(x => x && (x.title || x.body)),
    firm: { name: FIRM.name, tagline: FIRM.tagline, email: FIRM.email, phone: FIRM.phone, web: FIRM.web },
  };
}

const esc = (s) => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const rs = (n) => `Rs. ${Math.round(Number(n) || 0).toLocaleString('en-LK')}`;
const pct = (a, b) => (b ? Math.round(((a - b) / Math.abs(b)) * 1000) / 10 : null);

export function buildReviewHtml(d) {
  const c = d.current, p = d.previous, f = d.firm || {};
  const issued = new Date(d.issued_at || Date.now()).toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' });
  const ch = p ? pct(c.tax, p.tax) : null;
  const arrow = (a, b, goodDown = true) => { if (b === null || b === undefined) return ''; const d0 = a - b; if (Math.abs(d0) < 1) return '<span class="chg">no change</span>'; const up = d0 > 0; const good = goodDown ? !up : up; return `<span class="chg ${good ? 'g' : 'b'}">${up ? '▲' : '▼'} ${rs(Math.abs(d0))}</span>`; };
  // [label, this year, last year, bold?, lower-is-better?]
  const rows = [
    ['Employment income', c.income.employment, p?.income.employment, '', false],
    ['Business income', c.income.business, p?.income.business, '', false],
    ['Investment income (interest, rent…)', c.income.investment, p?.income.investment, '', false],
    ['Other income', c.income.other, p?.income.other, '', false],
    ['Total assessable income', c.assessable, p?.assessable, 'b', false],
    ['Reliefs (personal, rent, solar)', c.reliefs, p?.reliefs, '', false],
    ['Qualifying payments (donations)', c.qp, p?.qp, '', false],
    ['Taxable income', c.taxable, p?.taxable, 'b', true],
    ['Income tax for the year', c.tax, p?.tax, 'b', true],
    ['Tax already paid / deducted', c.credits, p?.credits, '', false],
    c.balance >= 0 ? ['Balance paid with the return', c.balance, p ? Math.max(0, p.balance) : null, '', true] : ['Refund due', -c.balance, p ? Math.max(0, -p.balance) : null, '', false],
  ].filter(r => r[1] || r[2]);
  const maxBar = Math.max(c.assessable, p?.assessable || 0, 1);
  const bar = (label, inc, tax) => `<div class="bar"><div class="bl">${esc(label)}</div><div class="bt"><div class="bi" style="width:${(inc / maxBar) * 100}%"></div><div class="bx" style="width:${(tax / maxBar) * 100}%"></div></div><div class="bv">${rs(inc)} · tax ${rs(tax)}</div></div>`;
  const tips = d.tips.filter(t => t.save > 0);
  return `<!doctype html><html><head><meta charset="utf-8"><title>Annual Tax Review — ${esc(d.client.name)} — Y/A ${esc(d.year)}</title>
<style>
*{box-sizing:border-box}body{font-family:Arial,Helvetica,sans-serif;color:#1f2937;margin:0;background:#eef1f6;font-size:13px}
.pg{max-width:820px;margin:0 auto;background:#fff}.bar0{position:sticky;top:0;background:#12294A;color:#fff;padding:9px 16px;display:flex;align-items:center;gap:8px;z-index:2}.bar0 button{margin-left:auto;background:#C9A227;color:#12294A;border:0;border-radius:8px;padding:7px 14px;font-weight:700;cursor:pointer}
.cov{background:linear-gradient(135deg,#12294A,#1e3a8a 60%,#312e81);color:#fff;padding:34px 40px 30px}.brand{font-weight:900;font-size:22px}.brand span{color:#C9A227}
.cov h1{font-size:28px;margin:22px 0 4px}.cov .sub{opacity:.85}.kp{display:grid;grid-template-columns:repeat(4,1fr);gap:10px;margin-top:22px}.k{background:rgba(255,255,255,.1);border-radius:12px;padding:12px}.k .l{font-size:11px;opacity:.8;text-transform:uppercase;letter-spacing:.04em}.k .v{font-size:19px;font-weight:800;margin-top:4px}
.sec{padding:22px 40px}.sec h2{font-size:16px;color:#12294A;margin:0 0 10px;padding-bottom:6px;border-bottom:2px solid #C9A227;display:inline-block}
table{width:100%;border-collapse:collapse}th,td{padding:7px 8px;border-bottom:1px solid #eef0f3;text-align:left}th{font-size:11px;text-transform:uppercase;color:#6b7280;letter-spacing:.04em}td.n,th.n{text-align:right}tr.b td{font-weight:700;background:#fafbfc}
.chg{font-size:11px;font-weight:700;margin-left:6px}.chg.g{color:#047857}.chg.b{color:#b91c1c}
.bar{display:grid;grid-template-columns:90px 1fr 210px;gap:10px;align-items:center;margin:8px 0}.bt{position:relative;height:22px;background:#f1f5f9;border-radius:6px;overflow:hidden}.bi{position:absolute;inset:0 auto 0 0;background:#c7d2fe}.bx{position:absolute;inset:0 auto 0 0;background:#C9A227}.bl{font-weight:700}.bv{font-size:11.5px;color:#4b5563}
.lg{font-size:11px;color:#6b7280}.lg i{display:inline-block;width:10px;height:10px;border-radius:2px;margin:0 4px -1px 10px}
.tip{display:flex;gap:12px;border:1px solid #fde68a;background:#fffbeb;border-radius:12px;padding:12px 14px;margin:8px 0}.tip .e{font-size:24px}.tip b{color:#12294A}.tip .s{margin-left:auto;font-weight:800;color:#047857;white-space:nowrap}
.save{background:#ecfdf5;border:1px solid #a7f3d0;color:#065f46;border-radius:12px;padding:12px 14px;margin-top:10px;font-weight:700}
.rec{border-left:4px solid #12294A;padding:6px 12px;margin:10px 0;background:#f8fafc}.rec b{display:block;color:#12294A;margin-bottom:2px}
.dates{display:grid;grid-template-columns:repeat(3,1fr);gap:8px}.dt{border:1px solid #e5e7eb;border-radius:10px;padding:10px}.dt b{display:block;color:#12294A}
.foot{padding:16px 40px 28px;font-size:10.5px;color:#6b7280;border-top:1px solid #eef0f3}
@media print{.bar0{display:none}body{background:#fff}.sec,.cov{break-inside:avoid}}
</style></head><body><div class="bar0"><b>Annual Tax Review</b><button onclick="window.print()">Print / Save PDF</button></div>
<div class="pg">
<div class="cov"><div class="brand">Tax<span>Mate</span> <span style="color:#fff;font-weight:400;font-size:13px;opacity:.8">${esc(f.tagline || '')}</span></div>
<h1>Annual Tax Review</h1><div class="sub">Year of assessment ${esc(d.year)}${p ? ` compared with ${esc(p.year)}` : ''} · prepared for <b>${esc(d.client.name)}</b>${d.client.tin ? ` (TIN ${esc(d.client.tin)})` : ''} · ${esc(issued)}</div>
<div class="kp"><div class="k"><div class="l">Income tax ${esc(d.year)}</div><div class="v">${rs(c.tax)}</div></div>
<div class="k"><div class="l">${p ? `vs ${esc(p.year)}` : 'Effective rate'}</div><div class="v">${p ? (ch === null ? '—' : `${ch > 0 ? '+' : ''}${ch}%`) : `${c.effRate}%`}</div></div>
<div class="k"><div class="l">Effective tax rate</div><div class="v">${c.effRate}%</div></div>
<div class="k"><div class="l">Possible saving ${esc(d.nextYear)}</div><div class="v">${rs(d.combinedSave)}</div></div></div></div>

<div class="sec"><h2>Your year at a glance</h2>
<table><thead><tr><th></th><th class="n">Y/A ${esc(d.year)}</th>${p ? `<th class="n">Y/A ${esc(p.year)}</th>` : ''}</tr></thead><tbody>
${rows.map(([l, a, b, cls, lowGood]) => `<tr class="${cls || ''}"><td>${esc(l)}</td><td class="n">${rs(a)}${p ? arrow(a, b, lowGood) : ''}</td>${p ? `<td class="n">${b === null || b === undefined ? '—' : rs(b)}</td>` : ''}</tr>`).join('')}
</tbody></table>
<div style="margin-top:16px">${bar(d.year, c.assessable, c.tax)}${p ? bar(p.year, p.assessable, p.tax) : ''}<div class="lg"><i style="background:#c7d2fe"></i>Income <i style="background:#C9A227"></i>Tax</div></div></div>

<div class="sec"><h2>Where your tax came from</h2>
<table><thead><tr><th>Band</th><th class="n">Income taxed</th><th class="n">Tax</th></tr></thead><tbody>
${c.bands.length ? c.bands.map(b => `<tr><td>${esc(b.label)}</td><td class="n">${rs(b.taxed)}</td><td class="n">${rs(b.tax)}</td></tr>`).join('') : '<tr><td colspan="3">No tax — your income was within the reliefs.</td></tr>'}
</tbody></table><p class="lg">Rates for Y/A ${esc(d.year)}: ${esc(c.cfgText)}. Reliefs used: personal ${rs(c.reliefParts.personal)}${c.reliefParts.rent ? `, rent ${rs(c.reliefParts.rent)}` : ''}${c.reliefParts.solar ? `, solar ${rs(c.reliefParts.solar)}` : ''}${c.reliefParts.donations ? `, donations ${rs(c.reliefParts.donations)}` : ''}.</p></div>

<div class="sec"><h2>How to save in Y/A ${esc(d.nextYear)}</h2>
<p class="lg">If your income stays the same, your Y/A ${esc(d.nextYear)} tax would be about <b>${rs(d.nextBase.tax)}</b>. These steps could reduce it:</p>
${tips.length ? tips.map(t => `<div class="tip"><div class="e">${esc(t.emoji)}</div><div><b>${esc(t.title)}</b><div>${esc(t.body)}</div></div><div class="s">save ${rs(t.save)}</div></div>`).join('') : '<p>Your return already uses the main reliefs. 👏</p>'}
${d.combinedSave > 0 ? `<div class="save">All of these together could save about ${rs(d.combinedSave)} (reliefs interact, so this is not a simple sum).</div>` : ''}</div>

${d.recommendations.length ? `<div class="sec"><h2>Our recommendations</h2>${d.recommendations.map(x => `<div class="rec"><b>${esc(x.title)}</b>${esc(x.body)}</div>`).join('')}</div>` : ''}

<div class="sec"><h2>Key dates for Y/A ${esc(d.nextYear)}</h2><div class="dates">
${(() => { const s = parseInt(d.nextYear, 10); return [[`15 Aug ${s}`, '1st instalment'], [`15 Nov ${s}`, '2nd instalment'], [`15 Feb ${s + 1}`, '3rd instalment'], [`15 May ${s + 1}`, '4th instalment'], [`30 Sep ${s + 1}`, 'Final tax payment'], [`30 Nov ${s + 1}`, 'Return deadline']].map(([a, b]) => `<div class="dt"><b>${a}</b>${b}</div>`).join(''); })()}
</div></div>

<div class="foot">Prepared by ${esc(f.name)} · ${esc(f.phone)} · ${esc(f.email)} · ${esc(f.web)}. Based on your final IIT computation${p ? 's' : ''} and the Inland Revenue rules for Y/A ${esc(d.year)}; savings for Y/A ${esc(d.nextYear)} assume the same income and current law. This review is guidance, not a filed return — talk to us before acting.</div>
</div></body></html>`;
}

export function openReview(d, win) {
  const w = win || window.open('', '_blank', 'width=900,height=1000');
  if (!w) return false;
  w.document.open(); w.document.write(buildReviewHtml(d)); w.document.close(); w.focus();
  return true;
}

// ── client ──
export async function requestReview({ year, note }) {
  const { error } = await supabase.rpc('request_tax_review', { p_year: year, p_note: note || '' });
  if (error) throw new Error(errMsg(error));
}
export async function myReview(id) {
  const { data, error } = await supabase.rpc('my_tax_review', { p_id: id });
  if (error) throw new Error(errMsg(error));
  return data;
}
export async function cancelReview(id) {
  const { error } = await supabase.rpc('cancel_my_tax_review', { p_id: id });
  if (error) throw new Error(errMsg(error));
}

// ── admin ──
export async function issueReview({ review, calc, prevCalc, client, fee, recommendations, userId }) {
  const data = buildReviewData({ calc, prevCalc, client, recommendations });
  let invoiceId = review.invoice_id || null;
  if (Number(fee) > 0 && !invoiceId) {
    const inv = await createFeeInvoice(client, `Annual Tax Review report — Y/A ${review.year}`, fee, userId);
    invoiceId = inv.id;
  }
  const { error } = await supabase.rpc('admin_issue_tax_review', { p_id: review.id, p_calc: calc.id, p_prev: prevCalc?.id ?? null, p_data: data, p_fee: Number(fee) || 0, p_invoice: invoiceId });
  if (error) throw new Error(errMsg(error));
  return data;
}
export async function adminReviewData(id) {
  const [{ data: r }, { data: d }] = await Promise.all([
    supabase.from('tax_reviews').select('*').eq('id', id).single(),
    supabase.from('tax_review_data').select('data').eq('review_id', id).maybeSingle(),
  ]);
  return { ...(d?.data ?? {}), issued_at: r?.issued_at, year: r?.year };
}
