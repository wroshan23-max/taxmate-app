// ═══════════════════════════════════════════════════════════
//  RAMIS filing draft (ADMIN ONLY)
//  Lays out an individual's return like the RAMIS "Individual income tax
//  filing summary" (Part A–D, Schedules 1–10, Statement of Assets &
//  Liabilities, Declaration) so TaxMate can key it into RAMIS.
//
//  Figures come from the FINAL IIT computation (single source of truth:
//  computeReturn). Line items are pre-filled from the Monthly Income sheet,
//  the Assets & Liabilities statement and the client record, then edited
//  by the admin. checkDraft() lists everything that does not reconcile.
//
//  Y/A 2025/26 rules (IRD guide Asmt_IIT_004_2025_2026 / IR (Amendment)
//  Act No. 02 of 2025): personal relief Rs.1,800,000 (cage 80), solar relief
//  max Rs.600,000 (cage 70 / Sch. 5C), rent relief 25% (cage 60 / 316),
//  progressive 6% (first Rs.1M) · 18% · 24% · 30% · 36%; foreign-currency
//  income remitted through a bank max 15% (cage 809.B); AIT on interest 10%
//  from 1 April 2025 (Sch. 7A, credit in cage 908).
// ═══════════════════════════════════════════════════════════
import { computeReturn, yearCfg } from './iitCalc';
import { rowsOf, num as anum, totals as alTotals } from './assets';
import { rowTotal, sheetTotals } from './incomeSheet';
import { FIRM } from './iitStatement';

export const DRAFT_YEARS = ['2025/26', '2026/27'];
export const DRAFT_STATUS = {
  draft:   { label: 'Draft',   cls: 'bg-amber-100 text-amber-800' },
  checked: { label: 'Checked', cls: 'bg-blue-100 text-blue-700' },
  filed:   { label: 'Filed',   cls: 'bg-green-100 text-green-700' },
};
// Activity code seen on RAMIS for bank interest. Other codes: pick in RAMIS (ISIC-based list).
export const ACTIVITY_INTEREST = '000121';

const n = (v) => { const x = Number(String(v ?? '').replace(/,/g, '')); return Number.isFinite(x) ? x : 0; };
export const r2 = (v) => Math.round(n(v) * 100) / 100;
export const fmt2 = (v) => (v === '' || v === null || v === undefined) ? '' : n(v).toLocaleString('en-LK', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const sum = (rows, k) => r2((rows ?? []).reduce((a, r) => a + n(r[k]), 0));
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

// Year helpers — '2025/26' → 1 Apr 2025 … 31 Mar 2026
export const yearStart = (y) => parseInt(y, 10);
export const yearEndLabel = (y) => `31.03.${yearStart(y) + 1}`;
export const fullYear = (y) => `${yearStart(y)}/${yearStart(y) + 1}`;
export const instalmentDates = (y) => { const s = yearStart(y); return [`${s}-08-15`, `${s}-11-15`, `${s + 1}-02-15`, `${s + 1}-05-15`]; };
export const finalPaymentDate = (y) => `${yearStart(y) + 1}-09-30`;
export const returnDueDate = (y) => `${yearStart(y) + 1}-11-30`;

// NIC → birth year (old 9-digit + V/X, or new 12-digit)
export function nicBirthYear(nic) {
  const s = String(nic ?? '').trim().toUpperCase();
  if (/^\d{12}$/.test(s)) return parseInt(s.slice(0, 4), 10);
  if (/^\d{9}[VX]$/.test(s)) return 1900 + parseInt(s.slice(0, 2), 10);
  return null;
}

// Tax at RAMIS precision (cents), from the same rules as computeReturn
function prog2(taxable, slabs) {
  let rem = Math.max(0, taxable), tax = 0;
  for (const s of slabs) { if (rem <= 0) break; const t = Math.min(rem, s.limit); tax += t * s.rate; rem -= t; }
  return r2(tax);
}
function fx2(taxLocal, taxFx) {
  const tf = Math.max(0, taxFx); if (!tf) return 0;
  const at6 = Math.min(tf, Math.max(0, 1_000_000 - Math.max(0, taxLocal)));
  return r2(at6 * 0.06 + (tf - at6) * 0.15);
}
function term2(a) {
  const b1 = Math.min(a, 10_000_000), b2 = Math.min(Math.max(0, a - 10_000_000), 10_000_000), b3 = Math.max(0, a - 20_000_000);
  return { b1, b2, b3, t2: r2(b2 * 0.06), t3: r2(b3 * 0.12) };
}

// ─── Cages (always recomputed from the computation inputs) ────────
export function draftCages(year, calcInput, draft = {}) {
  const r = computeReturn(year, calcInput || {});
  const cfg = yearCfg(year);
  const t = term2(r.f.termBen || 0);
  const tax809A = prog2(r.taxableLocal, cfg.slabs);
  const tax809B = fx2(r.taxableLocal, r.taxableFx);
  const tax806 = r2((r.f.invGain || 0) * 0.10);
  const cage130 = r2(t.t2 + t.t3);
  const cage150 = r2(tax809A + tax809B);
  const credit = Object.fromEntries(r.credits.map(c => [c.cage, r2(c.amt)]));
  const cage170 = r2(cage130 + tax806 + cage150);
  const cage180 = r2(r.credits.reduce((a, c) => a + c.amt, 0));
  const bal = r2(cage170 - cage180);
  const fxRemit = {
    a: r2(r.f.empFx || 0), b: r2(r.f.bizFx || 0), c: 0, d: r2(r.f.forFx || 0),
  };
  return {
    r,
    c10: r2(r.cage10), c20: r2(r.cage20), c30: r2(r.cage30), c40: r2(r.cage40), c50: r2(r.cage50),
    c60: r2(r.rentRelief), c70: r2(r.solarUsed), c80: r2(r.prUsed), c90: r2(r.reliefs),
    c100: r2(r.cage100), c110: r2(r.reliefs + r.cage100), c120: r2(r.cage120),
    c130: cage130, c140: tax806, c150: cage150, c160: 0, c170: cage170, c180: cage180,
    c190: bal > 0 ? bal : 0, c200: bal < 0 ? -bal : 0,
    c210: r2(r.cage210), c210A: r2(fxRemit.a + fxRemit.b + fxRemit.c + fxRemit.d), fxRemit,
    c801: r2(r.cage120), c802: r2(r.f.termBen || 0),
    c803a: r2(t.b1), c803b: r2(t.b2), c803b3: t.t2, c803c: r2(t.b3), c803c3: t.t3, c805: cage130,
    c806: r2(r.f.invGain || 0), c806_3: tax806,
    c809A1: r2(r.taxableLocal), c809A3: tax809A, c809B1: r2(r.taxableFx), c809B3: tax809B, c810: cage150,
    credit, // { '901': , '903': , ... }
    c912: cage180,
    calcTax: r.cage170, calcBalance: r.balance,
  };
}

// ─── Build a fresh draft from the app's data ─────────────────────
export function buildDraft({ year, calc, client = {}, sheet = null, al = null, docs = [] }) {
  const input = calc?.input_data || {};
  const C = draftCages(year, input);
  const f = C.r.f;
  const sh = sheet?.data;
  const shTot = sh ? sheetTotals(sh) : null;
  const ald = al?.data || {};
  const by = nicBirthYear(client.nic);
  const ageAtEnd = by ? (yearStart(year) + 1) - by : null;

  const emp = [];
  const primary = r2((f.empPrimary || 0) + (f.empBenefits || 0) + (f.empBonus || 0));
  if (primary) emp.push({ type: 'Primary', employer: client.employer || '', tin: '', amount: primary });
  if (f.empSecondary) emp.push({ type: 'Secondary', employer: '', tin: '', amount: r2(f.empSecondary) });
  if (f.empFx) emp.push({ type: 'Foreign (FC via bank)', employer: '', tin: '', amount: r2(f.empFx) });
  const term = f.termBen ? [{ type: 'Primary', employer: client.employer || '', tin: '', amount: r2(f.termBen) }] : [];

  const bizRows = rowsOf(ald, 'business');
  const turnover = shTot ? r2(rowTotal(sh, 'bizSales') + rowTotal(sh, 'bizOtherIncome')) : '';
  const sole = [];
  if (f.bizProfit) sole.push({ code: '', nature: (bizRows[0]?.name || '').toUpperCase(), profit: r2(f.bizProfit), turnover: turnover || r2(f.bizProfit) });
  if (f.bizFx) sole.push({ code: '', nature: 'SERVICES TO FOREIGN CLIENTS (FOREIGN CURRENCY)', profit: r2(f.bizFx), turnover: r2(f.bizFx) });
  const partner = f.bizPartner ? [{ code: '', name: '', tin: '', profit: r2(f.bizPartner), turnover: '' }] : [];

  const inv = [];
  if (f.interest) inv.push({ code: ACTIVITY_INTEREST, type: 'Interest', amount: r2(f.interest) });
  if (f.rentGross) inv.push({ code: '', type: 'Rent', amount: r2(f.rentGross) });
  if (f.othInv) inv.push({ code: '', type: 'Other investment income', amount: r2(f.othInv) });

  const other = [];
  if (f.othInc) other.push({ type: 'Other income', amount: r2(f.othInc), turnover: r2(f.othInc) });
  if (f.forTaxable) other.push({ type: 'Foreign income (not remitted through a bank)', amount: r2(f.forTaxable), turnover: r2(f.forTaxable) });
  if (f.forFx && !C.r.fxExempt) other.push({ type: 'Foreign currency income remitted through a bank', amount: r2(f.forFx), turnover: r2(f.forFx) });

  const wht = [];
  if (f.whtInterest) wht.push({ source: 'I-INTEREST', agentTin: '', cert: '', amount: r2(f.interest || ''), date: '', wht: r2(f.whtInterest) });
  if (f.whtRent) wht.push({ source: 'I-RENT', agentTin: '', cert: '', amount: r2(f.rentGross || ''), date: '', wht: r2(f.whtRent) });
  if (f.whtService) wht.push({ source: 'B-SERVICE FEES', agentTin: '', cert: '', amount: '', date: '', wht: r2(f.whtService) });
  if (f.whtOther) wht.push({ source: 'OTHER', agentTin: '', cert: '', amount: '', date: '', wht: r2(f.whtOther) });

  const inst = instalmentDates(year).map((d, i) => ({ label: ['1st installment', '2nd installment', '3rd installment', '4th installment'][i], date: '', due: d, amount: '' }));
  if (f.instalments) inst.push({ label: 'Final Payment', date: '', due: finalPaymentDate(year), amount: '' });
  else inst.push({ label: 'Final Payment', date: '', due: finalPaymentDate(year), amount: '' });

  // Statement of assets & liabilities (from the client's A&L sheet)
  const alv = (k) => rowsOf(ald, k);
  const assets = {
    immovable: alv('immovable').map(x => ({ situation: [x.type, x.location, x.situated === 'Outside Sri Lanka' ? '(outside Sri Lanka)' : ''].filter(Boolean).join(' — ').toUpperCase(), acquired: x.acquired || '', cost: '', value: r2(x.value) })),
    vehicles: alv('vehicles').map(x => ({ description: [x.type, x.make].filter(Boolean).join(' ').toUpperCase(), regno: (x.regno || '').toUpperCase(), acquired: x.acquired || '', value: r2(x.value) })),
    deposits: alv('deposits').map(x => ({ bank: (x.bank || '').toUpperCase(), acno: x.acno || '', invested: '', interest: '', balance: r2(x.value) })),
    shares: alv('shares').map(x => ({ company: (x.company || '').toUpperCase(), units: x.units || '', acquired: '', value: r2(x.value), dividend: '' })),
    c1019: r2(alv('cash').reduce((a, x) => a + anum(x.value), 0)),
    c1020: r2(alv('loans_given').reduce((a, x) => a + anum(x.value), 0)),
    c1021: r2(alv('jewellery').reduce((a, x) => a + anum(x.value), 0)),
    otherMovable: alv('other').map(x => ({ description: (x.description || '').toUpperCase(), value: r2(x.value) })),
    business: bizRows.map(x => ({ name: (x.name || '').toUpperCase(), current: r2(x.current), capital: r2(x.capital) })),
    liabilities: alv('liabilities').map(x => ({ description: [x.type, x.lender].filter(Boolean).join(' — ').toUpperCase(), security: '', commenced: '', original: '', amount: r2(x.value), repaid: '' })),
    acquired: alv('acquired').map(x => ({ description: (x.description || '').toUpperCase(), mode: x.mode || '', date: x.date || '', value: r2(x.value) })),
    disposed: alv('disposed').map(x => ({ description: (x.description || '').toUpperCase(), date: x.date || '', proceeds: r2(x.value), acquired: '', cost: '' })),
  };

  const today = new Date().toISOString().slice(0, 10);
  return {
    v: 1,
    built_at: new Date().toISOString(),
    sources: {
      calc: calc ? { id: calc.id, label: calc.label || 'IIT computation', status: calc.status || 'draft', created_at: calc.created_at } : null,
      sheet: sheet ? { id: sheet.id, status: sheet.status } : null,
      al: al ? { id: al.id, status: al.status } : null,
      docs: docs.map(d => ({ category: d.category, title: d.title, year: d.year, by: d.uploaded_role })),
    },
    header: {
      tin: String(client.tin ?? '').replace(/\D/g, ''),
      name: String(client.full_name ?? '').toUpperCase(),
      resident: (client.resident_status || 'resident') !== 'non-resident',
      senior: ageAtEnd !== null ? ageAtEnd >= 60 : false,
      birthYear: by,
    },
    sch1: { emp, term, exempt: [] },
    sch2: { sole, partner },
    sch3: { inv },
    sch4: { other },
    sch5: {
      charityPaid: r2(f.donCharity || 0), govt: r2(f.donGovt || 0), otherQP: r2(f.qpOther || 0),
      solarExp: r2(f.solar || 0), solarCF: r2(Math.max(0, (f.solar || 0) - C.r.solarUsed)),
    },
    sch7: { wht, bf: '' },
    sch9b: { inst },
    sch10: { lossUsed: r2(C.r.bizLossUsed || 0), lossBF: r2(f.bizLossBF || 0) },
    assets,
    decl: {
      preparedByOther: true,
      preparer: { name: FIRM.name, designation: 'Tax Consultant', phone: FIRM.phone, mobile: FIRM.whatsapp || FIRM.phone, email: FIRM.email, date: today },
      declarant: { name: String(client.full_name ?? '').toUpperCase(), phone: client.mobile || '', mobile: client.mobile || '', email: client.email || '', nic: String(client.nic ?? '').toUpperCase(), date: today },
    },
    notes: '',
  };
}

// ─── Accuracy checks ─────────────────────────────────────────────
// level: 'error' (must fix) · 'warn' (check) · 'ok'
export function checkDraft(year, calc, d, ctx = {}) {
  const out = [];
  const add = (level, msg) => out.push({ level, msg });
  if (!calc) { add('error', 'No IIT computation selected.'); return out; }
  const C = draftCages(year, calc.input_data || {});
  const f = C.r.f;
  const near = (a, b, tol = 1) => Math.abs(n(a) - n(b)) <= tol;

  if (calc.status !== 'final') add('error', 'The computation is still a DRAFT — mark it FINAL before filing.');
  else add('ok', 'Using the FINAL computation.');
  if (!DRAFT_YEARS.includes(year)) add('warn', `Y/A ${year} — this draft follows the Y/A 2025/26 return layout.`);
  if (year !== calc.year) add('error', `The computation is for Y/A ${calc.year}, not ${year}.`);

  // Header
  if (!/^\d{9}$/.test(d.header?.tin || '')) add('error', 'TIN is missing or not 9 digits.');
  if (!d.header?.name) add('error', 'Name of taxpayer is missing.');
  if (!d.decl?.declarant?.nic) add('warn', 'Declarant NIC is missing (Declaration Part B).');
  if (d.header?.birthYear && !near(d.header.senior ? 1 : 0, (yearStart(year) + 1 - d.header.birthYear) >= 60 ? 1 : 0, 0)) add('warn', 'Senior citizen tick does not match the age from the NIC.');

  // Schedules reconcile with the computation
  const s1 = sum(d.sch1?.emp, 'amount'); const s1t = sum(d.sch1?.term, 'amount');
  if (!near(s1, C.c10)) add('error', `Schedule 1 employment rows total Rs. ${fmt2(s1)} but cage 10 is Rs. ${fmt2(C.c10)}.`);
  if (!near(s1t, C.c802)) add('error', `Terminal benefit rows total Rs. ${fmt2(s1t)} but the computation has Rs. ${fmt2(C.c802)}.`);
  (d.sch1?.emp ?? []).forEach((e, i) => { if (n(e.amount) && !e.employer) add('warn', `Schedule 1 row ${i + 1}: employer name is empty.`); if (n(e.amount) && /primary|secondary/i.test(e.type) && !/^\d{9}$/.test(String(e.tin || '').replace(/\D/g, ''))) add('warn', `Schedule 1 row ${i + 1}: employer TIN is missing (see the T-10 certificate).`); });

  const s2 = r2(sum(d.sch2?.sole, 'profit') + sum(d.sch2?.partner, 'profit') - n(d.sch10?.lossUsed));
  if (!near(s2, C.c20)) add('error', `Schedule 2 business rows (less loss used) total Rs. ${fmt2(s2)} but cage 20 is Rs. ${fmt2(C.c20)}.`);
  (d.sch2?.sole ?? []).forEach((b, i) => { if (!b.code) add('warn', `Schedule 2 row ${i + 1}: activity code is empty (choose it in RAMIS).`); if (!b.nature) add('warn', `Schedule 2 row ${i + 1}: nature of the business is empty.`); if (n(b.turnover) < n(b.profit)) add('warn', `Schedule 2 row ${i + 1}: turnover is lower than the profit.`); });

  const s3 = sum(d.sch3?.inv, 'amount');
  if (!near(s3, C.c30)) add('error', `Schedule 3 investment rows total Rs. ${fmt2(s3)} but cage 30 is Rs. ${fmt2(C.c30)}.`);
  const s4 = sum(d.sch4?.other, 'amount');
  if (!near(s4, C.c40)) add('error', `Schedule 4 other-income rows total Rs. ${fmt2(s4)} but cage 40 is Rs. ${fmt2(C.c40)}.`);

  const s7 = sum(d.sch7?.wht, 'wht');
  if (!near(s7, C.credit['908'] || 0)) add('error', `Schedule 7A AIT/WHT rows total Rs. ${fmt2(s7)} but cage 908 is Rs. ${fmt2(C.credit['908'] || 0)}.`);
  (d.sch7?.wht ?? []).forEach((w, i) => { if (n(w.wht) && !w.cert) add('warn', `Schedule 7 row ${i + 1}: certificate number is empty (from the bank / payer WHT certificate).`); if (n(w.wht) && !/^\d{9}$/.test(String(w.agentTin || '').replace(/\D/g, ''))) add('warn', `Schedule 7 row ${i + 1}: withholding agent TIN is empty.`); });

  // AIT on interest is 10% from 1 April 2025
  if (f.interest > 0 && yearStart(year) >= 2025) {
    const exp = f.interest * 0.10;
    if (!f.whtInterest) add('warn', `Interest Rs. ${fmt2(f.interest)} has no AIT credit — banks deduct 10% from 1 April 2025 unless the client gave a self-declaration. Check the bank certificates.`);
    else if (Math.abs(f.whtInterest - exp) > Math.max(50, exp * 0.03)) add('warn', `AIT on interest is Rs. ${fmt2(f.whtInterest)}; 10% of the interest would be Rs. ${fmt2(exp)}. Check the certificates (part of the year may have had no AIT).`);
  }

  const s9b = sum(d.sch9b?.inst, 'amount');
  if (!near(s9b, C.credit['911'] || 0)) add('error', `Schedule 9B instalments total Rs. ${fmt2(s9b)} but cage 911 is Rs. ${fmt2(C.credit['911'] || 0)}.`);
  if ((C.credit['903'] || 0) > 0 && !(ctx.docs ?? []).some(x => x.category === 'salary')) add('warn', 'APIT credit claimed — no Salary / T-10 document uploaded for this year. Attach the APIT T-10 certificate.');
  if (C.c70 > 0 && !(ctx.docs ?? []).some(x => /solar/i.test(x.title || ''))) add('warn', 'Solar relief claimed — keep the solar invoice / CEB agreement (Schedule 5C).');
  if (C.c100 > 0 && f.donCharity > 0) add('warn', `Charity donation: deductible amount is Rs. ${fmt2(C.r.donUsed)} (max Rs. 75,000 and 1/3 of taxable income). Keep the receipts — the charity must be IRD-approved.`);
  if (C.c210A > 0) add('ok', `Foreign currency remitted Rs. ${fmt2(C.c210A)} — fill cage 210A / 404–406 and keep the bank remittance letters.`);

  // Monthly income sheet vs computation
  const sh = ctx.sheet?.data;
  if (!ctx.sheet) add('warn', 'No Monthly Income sheet for this year (optional, but useful as backup).');
  else {
    const chk = [['salary', (f.empPrimary || 0), 'Salary'], ['interest', f.interest || 0, 'Interest'], ['rent', f.rentGross || 0, 'Rent'],
      ['fxEmployment', f.empFx || 0, 'Foreign salary'], ['fxServices', f.bizFx || 0, 'Foreign services'], ['apit', f.apitPrimary || 0, 'APIT'], ['whtInterest', f.whtInterest || 0, 'AIT on interest']];
    for (const [k, v, label] of chk) {
      const s = rowTotal(sh, k);
      if ((s || v) && Math.abs(s - v) > Math.max(1, v * 0.01)) add('warn', `${label}: Monthly Income sheet Rs. ${fmt2(s)} vs computation Rs. ${fmt2(v)}.`);
    }
    if (ctx.sheet.status === 'open') add('warn', 'Monthly Income sheet is not submitted yet.');
  }

  // Assets & liabilities
  if (!ctx.al) add('warn', 'No Assets & Liabilities statement for this year — the RAMIS return needs one.');
  else {
    if (ctx.al.status === 'open') add('warn', 'Assets & Liabilities statement is not submitted yet.');
    const deps = d.assets?.deposits ?? [];
    if (f.interest > 0 && deps.length === 0) add('warn', 'Interest income declared but no bank deposits in the A&L statement.');
    if (deps.length && !f.interest) add('warn', 'Bank deposits listed but no interest income in the computation — check (current accounts earn none).');
    const depInt = sum(deps, 'interest');
    if (depInt && !near(depInt, f.interest || 0, 5)) add('warn', `Interest column in the A&L deposits totals Rs. ${fmt2(depInt)} vs Rs. ${fmt2(f.interest || 0)} in Schedule 3.`);
    const t = alTotals(ctx.al.data || {});
    const prev = ctx.al.data?._meta?.prev_totals;
    if (prev) {
      const growth = (t.net || 0) - (prev.net || 0);
      const income = C.c50 + C.c210 - C.c170;
      if (growth > income + 100_000) add('warn', `Net worth grew by Rs. ${fmt2(growth)} but income after tax is about Rs. ${fmt2(income)} — be ready to explain the source (gift, loan, sale of asset…).`);
    }
  }

  if (C.c190 > 0) add('ok', `Balance tax payable Rs. ${fmt2(C.c190)} — pay by ${finalPaymentDate(year)} (final payment). Return due ${returnDueDate(year)}.`);
  if (C.c200 > 0) add('ok', `Refund Rs. ${fmt2(C.c200)} — make sure bank details are up to date in RAMIS.`);
  if (Math.abs(C.calcTax - C.c170) > 2) add('warn', `Tax at RAMIS precision is Rs. ${fmt2(C.c170)}; the saved computation shows Rs. ${fmt2(C.calcTax)} (rupee rounding). RAMIS calculates its own figure.`);
  return out;
}

// ─── Printable HTML (RAMIS layout) ───────────────────────────────
export function buildDraftHtml({ year, d, calc, client = {}, checks = [] }) {
  const C = draftCages(year, calc?.input_data || {}, d);
  const Y = fullYear(year);
  const cage = (no, label, val, bold) => `<div class="cg${bold ? ' b' : ''}"><div class="lb">${label}</div><div class="no">${no}</div><div class="v cp" title="Click to copy">${fmt2(val)}</div></div>`;
  const tbl = (head, rows, cols, totalRow) => `<table><thead><tr>${head.map(h => `<th>${esc(h)}</th>`).join('')}</tr></thead><tbody>${rows.length ? rows.map((r, i) => `<tr>${cols.map(c => c === '#' ? `<td>${i + 1}</td>` : (typeof c === 'function' ? c(r) : `<td class="${['amount', 'profit', 'turnover', 'wht', 'value', 'balance', 'invested', 'interest', 'cost', 'proceeds', 'original', 'repaid', 'current', 'capital', 'dividend'].includes(c) ? 'r cp' : 'cp'}">${['amount', 'profit', 'turnover', 'wht', 'value', 'balance', 'invested', 'interest', 'cost', 'proceeds', 'original', 'repaid', 'current', 'capital', 'dividend'].includes(c) ? fmt2(r[c]) : esc(r[c])}</td>`)).join('')}</tr>`).join('') : `<tr><td colspan="${cols.length}" class="mut">—</td></tr>`}${totalRow ? `<tr class="tot"><td colspan="${cols.length - 1}">${totalRow[0]}</td><td class="r cp">${fmt2(totalRow[1])}</td></tr>` : ''}</tbody></table>`;
  const H = (t) => `<h2>${t}</h2>`;
  const S = (t) => `<h3>${t}</h3>`;
  const errs = checks.filter(c => c.level === 'error'), warns = checks.filter(c => c.level === 'warn');
  const a = d.assets ?? {};
  const s5 = d.sch5 ?? {};
  const cr = C.credit;

  return `<!doctype html><html><head><meta charset="utf-8"><title>RAMIS draft — ${esc(d.header?.name)} — Y/A ${esc(Y)}</title>
<style>
*{box-sizing:border-box} body{font-family:Arial,Helvetica,sans-serif;color:#1f2937;margin:0;background:#f3f4f6;font-size:12.5px}
.page{max-width:900px;margin:0 auto;background:#fff;padding:28px 34px}
.bar{position:sticky;top:0;background:#12294A;color:#fff;padding:10px 16px;display:flex;gap:10px;align-items:center;z-index:5}
.bar button{background:#C9A227;border:0;color:#12294A;font-weight:700;padding:7px 14px;border-radius:8px;cursor:pointer}
.ban{border:2px dashed #b45309;background:#fffbeb;color:#92400e;padding:10px 12px;border-radius:8px;margin-bottom:14px;font-size:12px}
h1{font-size:17px;margin:0 0 4px;color:#12294A} h2{font-size:14px;margin:22px 0 6px;padding-bottom:5px;border-bottom:1.5px solid #9ca3af;color:#111}
h3{font-size:12.5px;margin:14px 0 6px;color:#111}
.hd{display:grid;grid-template-columns:230px 1fr;gap:6px 14px;margin:10px 0 6px;font-size:14px}.hd b{text-align:right}
.cg{display:grid;grid-template-columns:1fr 46px 170px;align-items:center;gap:0;margin:3px 0}.cg .lb{text-align:right;padding-right:10px;font-weight:600}
.cg .no{border:1px solid #d1d5db;border-right:0;font-size:10.5px;font-weight:700;padding:5px 4px;height:28px;background:#fafafa}
.cg .v{border:1px solid #d1d5db;text-align:right;padding:5px 8px;height:28px;font-weight:700}.cg.b .lb{font-size:13.5px}
table{width:100%;border-collapse:collapse;margin:6px 0 4px;font-size:11.5px} th,td{border:1px solid #c9c3a9;padding:5px 6px;text-align:left;vertical-align:top} th{background:#faf8ef;font-weight:600}
td.r{text-align:right} tr.tot td{font-weight:700;background:#fafafa} .mut{color:#9ca3af;text-align:center}
.grid5{display:grid;grid-template-columns:110px repeat(5,1fr);gap:4px;align-items:center;font-size:11.5px}.grid5 div{border:1px solid #e5e7eb;padding:4px;text-align:right}.grid5 .h{border:0;font-weight:700;text-align:center}.grid5 .l{border:0;text-align:left;font-weight:600}
.chk{margin:0 0 14px;padding:10px 12px;border-radius:8px;font-size:12px}.chk.e{background:#fef2f2;border:1px solid #fecaca;color:#991b1b}.chk.w{background:#fffbeb;border:1px solid #fde68a;color:#92400e}
.chk li{margin:2px 0}.decl{border:1px solid #9ca3af;padding:8px;font-style:italic;margin:12px 0}
.kv{display:grid;grid-template-columns:200px 1fr;gap:5px 10px}.kv div:nth-child(odd){font-weight:700}
.cp{cursor:copy}.cp:hover{background:#ecfdf5}.copied{background:#bbf7d0!important}
.foot{margin-top:24px;font-size:10.5px;color:#6b7280;border-top:1px solid #e5e7eb;padding-top:8px}
@media print{.bar,.noprint{display:none}body{background:#fff}.page{padding:0;max-width:none}h2{break-after:avoid}table,.cg{break-inside:avoid}}
</style></head><body>
<div class="bar noprint"><b>RAMIS filing draft</b><span style="opacity:.8">Click any figure to copy it · ${esc(d.header?.name)} · Y/A ${esc(Y)}</span><span style="flex:1"></span><button onclick="window.print()">Print / Save PDF</button></div>
<div class="page">
<div class="ban"><b>DRAFT — for TaxMate review before keying into RAMIS. Not a filed return.</b> Built from the ${calc?.status === 'final' ? 'FINAL' : 'DRAFT'} computation "${esc(calc?.label || 'IIT computation')}"${calc?.created_at ? ` (${esc(String(calc.created_at).slice(0, 10))})` : ''}, the Monthly Income sheet, the Assets &amp; Liabilities statement and the client's documents. RAMIS calculates most cages itself — compare its totals with this draft.</div>
${errs.length ? `<div class="chk e noprint"><b>Fix before filing (${errs.length})</b><ul>${errs.map(c => `<li>${esc(c.msg)}</li>`).join('')}</ul></div>` : ''}
${warns.length ? `<div class="chk w noprint"><b>Check (${warns.length})</b><ul>${warns.map(c => `<li>${esc(c.msg)}</li>`).join('')}</ul></div>` : ''}

<h1>Individual income tax — Confirmation (draft)</h1>
<div class="hd"><b>Taxpayer Identification Number (TIN)</b><span class="cp">${esc(d.header?.tin)}</span><b>Name of taxpayer</b><span class="cp">${esc(d.header?.name)}</span><b>Year of assessment</b><span>${esc(Y)}</span><b>Residency</b><span>${d.header?.resident ? '◉ Resident ○ Non-resident' : '○ Resident ◉ Non-resident'}</span><b>Senior citizen</b><span>${d.header?.senior ? '◉ Yes ○ No' : '○ Yes ◉ No'}</span></div>

${H('Part A - Income liable to tax')}
${cage(10, 'Employment income (Rs.)', C.c10)}${cage(20, 'Business income (Rs.)', C.c20)}${cage(30, 'Investment income (Rs.)', C.c30)}${cage(40, 'Other income (Rs.)', C.c40)}${cage(50, 'Assessable income (10+20+30+40) (Rs.)', C.c50, true)}
${H('Part B - Deductions from assessable income')}
${cage(60, 'Relief for rent income (Rs.)', C.c60)}${cage(70, "Relief on resident's Solar panel (Rs.)", C.c70)}${cage(80, 'Personal relief (Rs.)', C.c80)}${cage(90, 'Total reliefs (60 + 70 + 80) (Rs.)', C.c90, true)}${cage(100, 'Qualifying payments (Rs.)', C.c100)}${cage(110, 'Total deductions from assessable income (90 + 100) (Rs.)', C.c110, true)}${cage(120, 'Taxable income (50 - 110) (Rs.)', C.c120, true)}
${H('Part C - Calculation of tax payable')}
${cage(130, 'Tax on terminal benefits (Rs.)', C.c130)}${cage(140, 'Tax on gain on realization of investment assets (Rs.)', C.c140)}${cage(150, 'Tax on balance taxable income (Rs.)', C.c150)}${cage(160, 'Tax on final withholding payments (WHT not deducted) (Rs.)', C.c160)}${cage(170, 'Total tax payable (130+140+150+160) (Rs.)', C.c170, true)}${cage(180, 'Less: tax credits (Rs.)', C.c180)}${cage(190, 'Balance tax payable (If 170 > 180, Then 170 - 180) (Rs.)', C.c190, true)}${cage(200, 'Refund claimed (If 170 < 180, Then 180 - 170) (Rs.)', C.c200, true)}
${H('Part D - Exempt income')}
${cage(210, 'Total exempt/excluded income (115+216+317+407) (Rs.)', C.c210)}${cage('210A', 'Foreign Currency Remitted Amounts (406.5)', C.c210A)}

${H('Schedule 1 — Employment income')}
${S('Part I - Details of employment income (Both local & foreign)')}
${tbl(['S/N', 'Type', 'Employer/company name', 'TIN of the employer', 'Remuneration (Rs.)'], d.sch1?.emp ?? [], ['#', 'type', 'employer', 'tin', 'amount'], ['Total Remuneration (Cage 105)', sum(d.sch1?.emp, 'amount')])}
${tbl(['S/N', 'Type', 'Employer/company name', 'TIN of the employer', 'Terminal benefits (Rs.)'], d.sch1?.term ?? [], ['#', 'type', 'employer', 'tin', 'amount'], ['Total terminal benefits (Cage 110)', sum(d.sch1?.term, 'amount')])}
${cage(111, 'Total employment income (cage 105 + cage 110)', r2(sum(d.sch1?.emp, 'amount') + sum(d.sch1?.term, 'amount')))}

${H('Schedule 2 — Business income')}
${S('A. Business income from sole proprietorship (Both local & foreign)')}
${tbl(['S/N', 'Activity code', 'Nature of the business', 'Gains and profits (Rs.)', 'Turnover (Rs.)'], d.sch2?.sole ?? [], ['#', 'code', 'nature', 'profit', 'turnover'])}
<table><tbody><tr class="tot"><td>Total business income from sole proprietorship (Cage 204)</td><td class="r cp">${fmt2(sum(d.sch2?.sole, 'profit'))}</td></tr><tr class="tot"><td>Total business turnover from proprietorship (Cage 204A)</td><td class="r cp">${fmt2(sum(d.sch2?.sole, 'turnover'))}</td></tr></tbody></table>
${S("B. Partner's business income from partnership")}
${tbl(['S/N', 'Activity code', 'Partnership name', 'TIN of the partnership', 'Gains and profits (Rs.)'], d.sch2?.partner ?? [], ['#', 'code', 'name', 'tin', 'profit'], ["Partner's total business income from partnership (Cage 209)", sum(d.sch2?.partner, 'profit')])}
${cage(215, 'Total Business income (cage 204 + cage 209 + cage 214)', r2(sum(d.sch2?.sole, 'profit') + sum(d.sch2?.partner, 'profit')))}

${H('Schedule 3 — Investment income')}
${tbl(['S/N', 'Activity code', 'Type of income', 'Gains and profits (Rs.)'], d.sch3?.inv ?? [], ['#', 'code', 'type', 'amount'], ['Total investment income (Cage 304)', sum(d.sch3?.inv, 'amount')])}
${cage(315, 'Total investment income (cage 304 + cage 309 + cage 314)', sum(d.sch3?.inv, 'amount'))}${cage(316, 'Relief for rent income (25% of rent)', C.c60)}

${H('Schedule 4 — Other income')}
${tbl(['S/N', 'Type of income', 'Gains and profits (Rs.)', 'Turnover (Rs.)'], d.sch4?.other ?? [], ['#', 'type', 'amount', 'turnover'], null)}
<table><tbody><tr class="tot"><td>Total of other income (Cage 403)</td><td class="r cp">${fmt2(sum(d.sch4?.other, 'amount'))}</td></tr></tbody></table>
${S('210A Summary of foreign currency remitted amounts in to Sri Lanka during the year')}
<div class="grid5"><div class="h"></div><div class="h">Employment a</div><div class="h">Business b</div><div class="h">Investment c</div><div class="h">Other d</div><div class="h">Total e</div>
${['Turnover / Income Rs. (404)', 'Gain / Profit Rs. (405)', 'Remitted Amount Rs. (406)'].map(l => `<div class="l">${l}</div>${['a', 'b', 'c', 'd'].map(k => `<div class="cp">${fmt2(C.fxRemit[k])}</div>`).join('')}<div class="cp"><b>${fmt2(C.c210A)}</b></div>`).join('')}</div>

${H('Schedule 5 — Qualifying payments & reliefs')}
<table><thead><tr><th>Donation made</th><th>Amount paid (Rs.)</th><th>Deductible amount (Rs.)</th></tr></thead><tbody>
<tr><td>To approved charity (502.1 / 503.1) — max Rs.75,000 or 1/3 of taxable income</td><td class="r cp">${fmt2(s5.charityPaid)}</td><td class="r cp">${fmt2(C.r.donUsed)}</td></tr>
<tr><td>To the Government (502.2 / 503.2)</td><td class="r cp">${fmt2(s5.govt)}</td><td class="r cp">${fmt2(s5.govt)}</td></tr>
<tr><td>Other qualifying payments (502.3–502.5)</td><td class="r cp">${fmt2(s5.otherQP)}</td><td class="r cp">${fmt2(s5.otherQP)}</td></tr>
<tr class="tot"><td colspan="2">Total qualifying payments (504) → cage 100</td><td class="r cp">${fmt2(C.c100)}</td></tr></tbody></table>
${S('C - Expenditure on solar panel fixing on his premises by resident individual')}
<table><thead><tr><th>Type</th><th>Total expenditure (511)</th><th>Claimable amount (512) → cage 70</th><th>Carried forward (513)</th></tr></thead><tbody><tr><td>Expenditure on solar panel</td><td class="r cp">${fmt2(s5.solarExp)}</td><td class="r cp">${fmt2(C.c70)}</td><td class="r cp">${fmt2(s5.solarCF)}</td></tr></tbody></table>

${H('Schedule 7 — Withholding tax')}
${S('A - Advance income tax / withholding tax deducted by the withholding agent')}
${tbl(['S/N', 'Source/type', 'TIN of the Withholding Agent', 'AIT/WHT certificate No.', 'Amount received (Rs.)', 'Date of payment', 'AIT/WHT deducted (Rs.)'], d.sch7?.wht ?? [], ['#', 'source', 'agentTin', 'cert', 'amount', 'date', 'wht'], ['Total AIT/WHT deducted (Total of Cage 706)', sum(d.sch7?.wht, 'wht')])}
${cage(707, 'Total AIT/WHT deducted (Total of Cage 706)', sum(d.sch7?.wht, 'wht'))}${cage(708, 'AIT/WHT B/F on advance receipts', n(d.sch7?.bf))}${cage(710, `AIT/WHT claimed for the Y/A ${Y}`, cr['908'] || 0)}

${H('Schedule 8 — Tax calculation')}
${cage(801, 'Taxable income from cage 120 of the Return', C.c801)}
<table><thead><tr><th></th><th>Income (Rs.)</th><th>Rate</th><th>Tax (Rs.)</th></tr></thead><tbody>
<tr><td>Total terminal benefits (802)</td><td class="r cp">${fmt2(C.c802)}</td><td></td><td></td></tr>
<tr><td>Terminal benefits under special rate (803a / 803b / 803c)</td><td class="r cp">${fmt2(C.c803a)} / ${fmt2(C.c803b)} / ${fmt2(C.c803c)}</td><td>0% / 6% / 12%</td><td class="r cp">0.00 / ${fmt2(C.c803b3)} / ${fmt2(C.c803c3)}</td></tr>
<tr><td>Total tax on terminal benefits (805)</td><td></td><td></td><td class="r cp">${fmt2(C.c805)}</td></tr>
<tr><td>Tax on gain on realization of investment assets (806)</td><td class="r cp">${fmt2(C.c806)}</td><td>10%</td><td class="r cp">${fmt2(C.c806_3)}</td></tr>
<tr><td>Taxable income at progressive rates (809.A)</td><td class="r cp">${fmt2(C.c809A1)}</td><td>${esc(yearCfg(year).slabText)}</td><td class="r cp">${fmt2(C.c809A3)}</td></tr>
<tr><td>Any other taxable income — foreign currency remitted, max 15% (809.B)</td><td class="r cp">${fmt2(C.c809B1)}</td><td>6% / 15%</td><td class="r cp">${fmt2(C.c809B3)}</td></tr>
<tr class="tot"><td colspan="3">Tax on total taxable income (810)</td><td class="r cp">${fmt2(C.c810)}</td></tr>
<tr><td colspan="3">Tax on final withholding payments (WHT not deducted) (811)</td><td class="r cp">0.00</td></tr></tbody></table>

${H('Schedule 9 — Tax credit')}
${cage(901, 'Foreign tax credit', cr['901'] || 0)}${cage('903A', 'APIT paid on Employment Income - Primary Employment (T-10)', cr['903'] || 0)}${cage('904A', 'APIT paid on Employment Income - Secondary Employment (T-10)', cr['904'] || 0)}${cage(905, 'Tax paid for terminal benefits (T-13)', cr['905'] || 0)}${cage(908, 'Advance income tax credit (Cage 710 of Schedule 7A)', cr['908'] || 0)}${cage(909, 'Tax paid on gain on realization of investment assets (CGT)', cr['909/910'] || 0)}${cage(911, 'Installment payments and AIT/WHT paid by withholdee (Cage 934)', cr['911'] || 0)}${cage(912, 'Total tax credits (Total of cage No. 901 to 911)', C.c912, true)}
${S('Schedule 9B - Instalment payment and AIT/WHT paid by withholdee')}
${tbl(['Instalment', 'Due date', 'Payment date', 'Amount paid (Rs.)'], d.sch9b?.inst ?? [], ['label', 'due', 'date', 'amount'], ['Total self-assessment payment (932)', sum(d.sch9b?.inst, 'amount')])}

${H('Schedule 10 — Loss adjustment')}
<p>${n(d.sch10?.lossBF) ? `Business loss brought forward Rs. ${fmt2(d.sch10.lossBF)}; deducted this year Rs. ${fmt2(d.sch10.lossUsed)}; carried forward Rs. ${fmt2(n(d.sch10.lossBF) - n(d.sch10.lossUsed))}. Enter year-wise in Part IB.` : 'No losses.'}</p>

${H(`Statement of assets &amp; liabilities — as at ${yearEndLabel(year)}`)}
${S('A. Immovable properties')}
${tbl(['S/N', 'Situation of property', 'Date of acquisition', 'Cost (Rs.)', 'Market value (Rs.)'], a.immovable ?? [], ['#', 'situation', 'acquired', 'cost', 'value'])}
${S('B. i. Motor vehicles')}
${tbl(['S/N', 'Description', 'Registration No.', 'Date of acquisition', 'Cost/market value (Rs.)'], a.vehicles ?? [], ['#', 'description', 'regno', 'acquired', 'value'])}
${S(`ii. Bank balances including term deposits as at ${yearEndLabel(year)}`)}
${tbl(['S/N', 'Name of bank/financial institution', 'Account No.', 'Amount invested (Rs.)', 'Interest (Rs.)', 'Balance (Rs.)'], a.deposits ?? [], ['#', 'bank', 'acno', 'invested', 'interest', 'balance'])}
${S('iii. Shares/stocks/securities')}
${tbl(['S/N', 'Name of company/institution', 'No. of shares', 'Date of acquisition', 'Cost / market value (Rs.)', 'Net dividend income (Rs.)'], a.shares ?? [], ['#', 'company', 'units', 'acquired', 'value', 'dividend'])}
${cage(1019, `iv. Cash in hand as at ${yearEndLabel(year)}`, a.c1019)}${cage(1020, `v. Loans given &amp; amount receivable as at ${yearEndLabel(year)}`, a.c1020)}${cage(1021, `vi. Value of gold, silver, gems, jewellery etc. as at ${yearEndLabel(year)}`, a.c1021)}
${(a.otherMovable ?? []).length ? `${S('Other movable assets (declare under the closest RAMIS heading)')}${tbl(['S/N', 'Description', 'Value (Rs.)'], a.otherMovable, ['#', 'description', 'value'])}` : ''}
${S('C. Properties held as a part of business')}
${tbl(['S/N', 'Name of business', 'Current account balance (Rs.)', 'Capital account balance (Rs.)'], a.business ?? [], ['#', 'name', 'current', 'capital'])}
${S(`D. All liabilities as of ${yearEndLabel(year)}`)}
${tbl(['S/N', 'Description of liability', 'Security on liability', 'Date of commencement', 'Original amount (Rs.)', `Amount of liability as at ${yearEndLabel(year)}`, 'Amount repaid during the Y/A (Rs.)'], a.liabilities ?? [], ['#', 'description', 'security', 'commenced', 'original', 'amount', 'repaid'])}
${S('Part 2 — A. Any other assets acquired or gifts received during the year')}
${tbl(['S/N', 'Description of asset', 'Gift/exchange/purchase', 'Date of acquisition', 'Cost / market value (Rs.)'], a.acquired ?? [], ['#', 'description', 'mode', 'date', 'value'])}
${S('B. Disposal of assets including shares (sale/transfer/gift) during the year')}
${tbl(['S/N', 'Description', 'Date of disposal', 'Sales proceed (Rs.)', 'Date acquired', 'Cost (Rs.)'], a.disposed ?? [], ['#', 'description', 'date', 'proceeds', 'acquired', 'cost'])}

<div class="decl">I declare to the best of my knowledge and belief that all particulars furnished in this return and schedules are true, correct and complete. I am aware that making an incorrect or false statement or giving false information is an offence.</div>
<p><b>Did return or part of the return prepare by other person:</b> ${d.decl?.preparedByOther ? '◉ Yes ○ No' : '○ Yes ◉ No'}</p>
${d.decl?.preparedByOther ? `${S('Part A — Approved accountant / other authorized person')}<div class="kv"><div>Name</div><div class="cp">${esc(d.decl.preparer?.name)}</div><div>Designation</div><div class="cp">${esc(d.decl.preparer?.designation)}</div><div>Telephone</div><div class="cp">${esc(d.decl.preparer?.phone)}</div><div>Mobile</div><div class="cp">${esc(d.decl.preparer?.mobile)}</div><div>Email</div><div class="cp">${esc(d.decl.preparer?.email)}</div><div>Date of the certification</div><div class="cp">${esc(d.decl.preparer?.date)}</div></div>` : ''}
${S('Part B — Declarant')}
<div class="kv"><div>Full name of the declarant</div><div class="cp">${esc(d.decl?.declarant?.name)}</div><div>Telephone</div><div class="cp">${esc(d.decl?.declarant?.phone)}</div><div>Mobile</div><div class="cp">${esc(d.decl?.declarant?.mobile)}</div><div>Email</div><div class="cp">${esc(d.decl?.declarant?.email)}</div><div>NIC of declarant</div><div class="cp">${esc(d.decl?.declarant?.nic)}</div><div>Date</div><div class="cp">${esc(d.decl?.declarant?.date)}</div></div>

${(d.sources?.docs ?? []).length ? `${H('Supporting documents on file (TaxMate document vault)')}<table><thead><tr><th>Type</th><th>Title</th><th>Y/A</th><th>From</th></tr></thead><tbody>${d.sources.docs.map(x => `<tr><td>${esc(x.category)}</td><td>${esc(x.title)}</td><td>${esc(x.year || 'general')}</td><td>${esc(x.by)}</td></tr>`).join('')}</tbody></table>` : ''}
${d.notes ? `${H('TaxMate notes')}<p style="white-space:pre-wrap">${esc(d.notes)}</p>` : ''}
<div class="foot">Prepared by ${esc(FIRM.name)} · ${esc(FIRM.phone)} · ${esc(FIRM.email)} — internal draft for client ${esc(client.full_name || '')}. Return due ${returnDueDate(year)}; balance tax payable by ${finalPaymentDate(year)}. Figures follow the IRD guide for Y/A ${esc(Y)}; RAMIS is the final authority.</div>
</div>
<script>document.addEventListener('click',function(e){var t=e.target.closest('.cp');if(!t)return;var s=(t.innerText||'').trim();if(!s)return;var v=/^[\\d,.\\s/-]+$/.test(s)&&/\\d/.test(s)?s.replace(/,/g,''):s;(navigator.clipboard?navigator.clipboard.writeText(v):Promise.reject()).catch(function(){}).finally(function(){t.classList.add('copied');setTimeout(function(){t.classList.remove('copied')},700)})});</script>
</body></html>`;
}

export function openDraft(args, win = null) {
  const w = win || window.open('', '_blank', 'width=1000,height=1100');
  if (!w) return false;
  w.document.open(); w.document.write(buildDraftHtml(args)); w.document.close();
  return true;
}
