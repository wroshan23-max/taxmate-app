// ═══════════════════════════════════════════════════════════
//  TaxMate IIT calculation engine — single source of truth
//  Used by the Calculator, saved-calculation viewer and PDF statements.
// ═══════════════════════════════════════════════════════════

// Y/A 2025/26 & 2026/27
export const PR = 1_800_000;
export const SLABS = [
  { limit: 1_000_000, rate: 0.06 },
  { limit:   500_000, rate: 0.18 },
  { limit:   500_000, rate: 0.24 },
  { limit:   500_000, rate: 0.30 },
  { limit: Infinity,  rate: 0.36 },
];

// Y/A 2024/25 — IRD Asmt_IIT_004_2024_2025 Annexure 7
export const PR_2425 = 1_200_000;
export const SLABS_2425 = [
  { limit: 500_000, rate: 0.06 },
  { limit: 500_000, rate: 0.12 },
  { limit: 500_000, rate: 0.18 },
  { limit: 500_000, rate: 0.24 },
  { limit: 500_000, rate: 0.30 },
  { limit: Infinity, rate: 0.36 },
];

export const TAX_YEARS = {
  '2024/25': { pr: PR_2425, slabs: SLABS_2425, foreignBankExempt: true,  slabText: '6% · 12% · 18% · 24% · 30% · 36% (Rs.500,000 bands)' },
  '2025/26': { pr: PR,      slabs: SLABS,      foreignBankExempt: false, slabText: '6% (first Rs.1M) · 18% · 24% · 30% · 36%' },
  '2026/27': { pr: PR,      slabs: SLABS,      foreignBankExempt: false, slabText: '6% (first Rs.1M) · 18% · 24% · 30% · 36%' },
};

export const yearCfg = (year) => TAX_YEARS[year] ?? TAX_YEARS['2026/27'];

export const num = (s) => parseFloat(s) || 0;

// Progressive graduated tax
export function graduatedTax(taxable, slabs = SLABS) {
  let remaining = Math.max(0, taxable), tax = 0;
  const detail = [];
  for (const s of slabs) {
    if (remaining <= 0) break;
    const taxed = Math.min(remaining, s.limit);
    const t = Math.round(taxed * s.rate);
    detail.push({ rate: s.rate, taxed, tax: t });
    tax += t;
    remaining -= taxed;
  }
  return { tax, detail };
}

// Foreign-currency income remitted through a bank (Y/A 2025/26+), IRA First Schedule para 1(6):
// taxed at the progressive rates but at a MAXIMUM of 15%. The foreign income sits on top of the
// local taxable income in the bands (IRD guide Asmt_IIT_004_2025_2026 examples 2, 3, 6; APIT Table 08):
// whatever is left of the first Rs.1,000,000 band (6%) after local taxable income, then 15%.
export function foreignStackTax(taxableLocal, taxableForeign) {
  const tf = Math.max(0, taxableForeign);
  if (tf <= 0) return { tax: 0, bands: [] };
  const room6 = Math.max(0, 1_000_000 - Math.max(0, taxableLocal));
  const at6 = Math.min(tf, room6);
  const at15 = tf - at6;
  const bands = [];
  if (at6 > 0) bands.push({ label: `Rs.${Math.round(at6).toLocaleString()} @ 6% (rest of first Rs.1,000,000 band)`, taxed: at6, rate: 0.06, tax: Math.round(at6 * 0.06) });
  if (at15 > 0) bands.push({ label: `Rs.${Math.round(at15).toLocaleString()} @ 15% (maximum rate)`, taxed: at15, rate: 0.15, tax: Math.round(at15 * 0.15) });
  return { tax: bands.reduce((t, x) => t + x.tax, 0), bands };
}

// Foreign bank income alone (no local taxable income): 6% on first Rs.1,000,000 taxable; 15% on balance
export function calcForeignTax(taxable) {
  if (taxable <= 0) return { tax: 0, bands: [] };
  if (taxable <= 1_000_000) {
    const t = Math.round(taxable * 0.06);
    return { tax: t, bands: [{ label: `First Rs.${Math.round(taxable).toLocaleString()} @ 6%`, taxed: taxable, rate: 0.06, tax: t }] };
  }
  const t1 = Math.round(1_000_000 * 0.06);
  const t2 = Math.round((taxable - 1_000_000) * 0.15);
  return {
    tax: t1 + t2,
    bands: [
      { label: 'First Rs.1,000,000 @ 6%', taxed: 1_000_000, rate: 0.06, tax: t1 },
      { label: `Balance Rs.${Math.round(taxable - 1_000_000).toLocaleString()} @ 15%`, taxed: taxable - 1_000_000, rate: 0.15, tax: t2 },
    ],
  };
}

// Concessionary terminal benefits: 0% first Rs.10M, 6% next Rs.10M, 12% balance
export function terminalBenefitTax(amount) {
  const a = Math.max(0, amount);
  const b1 = Math.min(a, 10_000_000);
  const b2 = Math.min(Math.max(0, a - 10_000_000), 10_000_000);
  const b3 = Math.max(0, a - 20_000_000);
  const bands = [
    { label: 'First Rs.10,000,000 @ 0%', taxed: b1, tax: 0 },
    { label: 'Next Rs.10,000,000 @ 6%', taxed: b2, tax: Math.round(b2 * 0.06) },
    { label: 'Balance @ 12%', taxed: b3, tax: Math.round(b3 * 0.12) },
  ].filter(x => x.taxed > 0);
  return { tax: bands.reduce((s, x) => s + x.tax, 0), bands };
}

// ─── Annual IIT (IIT Calculator tab) ─────────────────────
export const ANNUAL_KEYS = ['emp', 'bonus', 'biz', 'cons', 'rentGross', 'forBank', 'forOth', 'othInc',
  'donations', 'solar', 'govtDon', 'whtApit', 'whtRent', 'whtProf', 'whtOth'];

export function computeAnnual(year, raw = {}) {
  const i = Object.fromEntries(ANNUAL_KEYS.map(k => [k, num(raw[k])]));
  const cfg = yearCfg(year);
  const fbExempt  = cfg.foreignBankExempt;
  const forBankTx = fbExempt ? 0 : i.forBank;

  const rentRel    = Math.round(i.rentGross * 0.25);
  const rentNet    = i.rentGross - rentRel;
  const stdIncome  = i.emp + i.bonus + i.biz + i.cons + rentNet + i.forOth + i.othInc;
  const totalAss   = stdIncome + forBankTx;
  const donAllowed = Math.min(i.donations, 75000, stdIncome > 0 ? stdIncome / 3 : 0);
  const solarAllow = Math.min(i.solar, 600000);
  const totalQP    = donAllowed + solarAllow + i.govtDon;
  const totalDed   = cfg.pr + totalQP;
  const taxableStd = Math.max(0, stdIncome - totalDed);
  const unusedDed  = Math.max(0, totalDed - stdIncome);
  const taxableFB  = Math.max(0, forBankTx - unusedDed);
  const stdResult  = graduatedTax(taxableStd, cfg.slabs);
  const fbResult   = foreignStackTax(taxableStd, taxableFB);
  const grossTax   = stdResult.tax + fbResult.tax;
  const totalWHT   = i.whtApit + i.whtRent + i.whtProf + i.whtOth;
  const netTax     = grossTax - totalWHT;

  return {
    year, cfg, inputs: i, fbExempt, forBankTx, rentRel, rentNet, stdIncome, totalAss,
    donAllowed, solarAllow, totalQP, prUsed: Math.min(cfg.pr, stdIncome),
    taxableStd, taxableFB, stdResult, fbResult, grossTax, totalWHT, netTax,
    effRate: totalAss > 0 ? (grossTax / totalAss * 100).toFixed(2) : '0.00',
    taxStatus: netTax > 0.5 ? 'payable' : netTax < -0.5 ? 'refund' : 'nil',
  };
}

// ─── Quarterly instalment: (A − C) ÷ B ───────────────────
export function computeQuarterly(raw = {}) {
  const quarter = String(raw.quarter ?? '1');
  const A = num(raw.prevTax), C = num(raw.paid);
  const B = [4, 3, 2, 1][parseInt(quarter, 10) - 1] ?? 4;
  return { quarter, A, C, B, instalment: Math.max(0, Math.round((A - C) / B)) };
}

// ─── IIT Return (cage-wise, mixed income) — Y/A 2024/25, 2025/26, 2026/27 ────
// Sources: IRD guides Asmt_IIT_004_2024_2025 & Asmt_IIT_004_2025_2026; Inland Revenue
// (Amendment) Act No. 02 of 2025 (rates, Rs.1.8M relief, 15% max on foreign-currency income).
// Foreign-currency income remitted through a bank ("Fx"):
//   2024/25  → exempt (Cage 210)
//   2025/26+ → declared under its own schedule (employment / business / other) but taxed at a
//              maximum of 15%, stacked on top of local taxable income (Cage 809B).
export const RETURN_YEARS = ['2024/25', '2025/26', '2026/27'];
// Income fields that are monthly amounts when the return is entered "per month" (×12)
export const RETURN_MONTHLY_KEYS = ['empPrimary', 'empSecondary', 'empBenefits', 'empFx', 'bizProfit', 'bizPartner', 'bizFx',
  'interest', 'rentGross', 'othInv', 'othInc', 'forTaxable', 'forFx'];
export const fxExemptYear = (year) => yearCfg(year).foreignBankExempt;

export function computeReturn(year, f = {}) {
  const cfg = yearCfg(year);
  const monthly = f.period === 'monthly';
  const n = (k) => Math.max(0, num(f[k])) * (monthly && RETURN_MONTHLY_KEYS.includes(k) ? 12 : 1);
  const fxExempt = cfg.foreignBankExempt;

  // Schedule 1 — employment
  const empLocal = n('empPrimary') + n('empSecondary') + n('empBenefits') + n('empBonus');
  const empFx = n('empFx');
  // Schedule 2 — business (loss b/f set off against local business first)
  const bizLocal = n('bizProfit') + n('bizPartner');
  const bizFxGross = n('bizFx');
  const bizLossBF = n('bizLossBF');
  const lossLocal = Math.min(bizLossBF, bizLocal);
  const lossFx = fxExempt ? 0 : Math.min(bizLossBF - lossLocal, bizFxGross);
  const bizLossUsed = lossLocal + lossFx;
  const bizFx = bizFxGross - lossFx;
  // Schedule 3 / 4 — investment & other
  const investLocal = n('interest') + n('rentGross') + n('othInv');
  const otherLocal = n('othInc') + n('forTaxable');
  const forFx = n('forFx');

  const fxTotal = fxExempt ? 0 : empFx + bizFx + forFx;          // taxable foreign-currency income
  const fxExemptAmt = fxExempt ? empFx + bizFxGross + forFx : 0;  // 2024/25: goes to Cage 210

  const cage10 = empLocal + (fxExempt ? 0 : empFx);
  const cage20 = bizLocal - lossLocal + (fxExempt ? 0 : bizFx);
  const bizGross = bizLocal + (fxExempt ? 0 : bizFxGross);
  const cage30 = investLocal;
  const cage40 = otherLocal + (fxExempt ? 0 : forFx);
  const cage50 = cage10 + cage20 + cage30 + cage40;
  const localAss = cage50 - fxTotal;

  // Cage 60 — reliefs
  const rentRelief = Math.min(Math.round(n('rentGross') * 0.25), cage50);
  const prUsed     = Math.min(cfg.pr, Math.max(0, cage50 - rentRelief));
  const solarUsed  = Math.min(n('solar'), 600_000, Math.max(0, cage50 - rentRelief - prUsed));
  const reliefs    = rentRelief + prUsed + solarUsed;
  const afterRel   = Math.max(0, cage50 - reliefs);

  // Cage 100 — qualifying payments (approved charity ≤ Rs.75,000 and ≤ 1/3 of taxable income)
  const donCap  = Math.min(75_000, afterRel / 3);
  const donUsed = Math.min(n('donCharity'), donCap);
  const qpRaw   = donUsed + n('donGovt') + n('qpOther');
  const cage100 = Math.min(qpRaw, afterRel);

  // Cage 120 — taxable income; reliefs & QP set off against local income first
  const cage120 = Math.max(0, afterRel - cage100);
  const taxableLocal = Math.max(0, localAss - reliefs - cage100);
  const taxableFx = Math.max(0, cage120 - taxableLocal);

  const prog    = graduatedTax(taxableLocal, cfg.slabs);
  const fx      = foreignStackTax(taxableLocal, taxableFx);
  const term    = terminalBenefitTax(n('termBen'));
  const gainTax = Math.round(n('invGain') * 0.10);
  const cage170 = prog.tax + fx.tax + term.tax + gainTax;

  const credits = [
    { cage: '901', label: 'Foreign tax credit', amt: n('ftc') },
    { cage: '903', label: 'APIT — primary employment', amt: n('apitPrimary') },
    { cage: '904', label: 'APIT — secondary employment', amt: n('apitSecondary') },
    { cage: '905', label: 'Tax deducted on terminal benefits', amt: n('termTaxDed') },
    { cage: '908', label: 'AIT/WHT deducted (interest, rent, fees, other)', amt: n('whtInterest') + n('whtRent') + n('whtService') + n('whtOther') },
    { cage: '909/910', label: 'Investment gain tax paid', amt: n('gainTaxPaid') },
    { cage: '911', label: 'Self-assessment instalments paid', amt: n('instalments') },
  ];
  // Foreign tax credit cannot exceed the Sri Lankan tax on that foreign income (s.80/81; IRD guide 2025/26).
  // Applied from Y/A 2025/26 (earlier saved returns keep their original figures).
  if (!fxExempt) {
    const forShare = localAss > 0 ? prog.tax * (n('forTaxable') / localAss) : 0;
    credits[0].amt = Math.min(credits[0].amt, Math.round(fx.tax + forShare));
  }
  const cage180 = credits.reduce((s, x) => s + x.amt, 0);
  const balance = cage170 - cage180;

  const sources = [
    empLocal > 0 && 'Employment', bizLocal > 0 && 'Business', n('interest') > 0 && 'Interest',
    n('rentGross') > 0 && 'Rent', n('othInv') > 0 && 'Other investment', otherLocal > 0 && 'Other',
    (empFx + bizFxGross + forFx) > 0 && (fxExempt ? 'Foreign (exempt)' : 'Foreign currency (15% max)'),
    n('termBen') > 0 && 'Terminal benefits', n('invGain') > 0 && 'Capital gains',
    n('forExempt') > 0 && 'Foreign (exempt)',
  ].filter(Boolean);

  return {
    year, cfg, monthly, fxExempt,
    f: Object.fromEntries(Object.keys(f).filter(k => k !== 'form' && k !== 'period').map(k => [k, n(k)])),
    empLocal, empFx, bizLocal, bizFx, forFx, fxTotal, fxExemptAmt, localAss,
    cage10, cage20, bizGross, bizLossUsed, cage30, cage40, cage50, rentRelief, prUsed, solarUsed, reliefs,
    donUsed, donCap, cage100, cage120, taxableLocal, taxableFx, prog, fx, term, gainTax, cage170, credits, cage180, balance,
    cage210: n('forExempt') + n('othExempt') + fxExemptAmt, sources,
    effRate: cage50 > 0 ? (cage170 / cage50 * 100).toFixed(2) : '0.00',
    taxStatus: balance > 0.5 ? 'payable' : balance < -0.5 ? 'refund' : 'nil',
  };
}

// Legacy name (saved Y/A 2024/25 returns)
export const computeReturn2425 = (f = {}) => computeReturn('2024/25', f);

// Map an old "Annual IIT" saved calculation onto the return fields
export function annualToReturnInput(a = {}) {
  const g = (k) => num(a[k]);
  const out = {
    empPrimary: g('emp'), empBonus: g('bonus'), bizProfit: g('biz') + g('cons'), rentGross: g('rentGross'),
    forFx: g('forBank'), forTaxable: g('forOth'), othInc: g('othInc'),
    donCharity: g('donations'), solar: g('solar'), donGovt: g('govtDon'),
    apitPrimary: g('whtApit'), whtRent: g('whtRent'), whtService: g('whtProf'), whtOther: g('whtOth'),
  };
  return Object.fromEntries(Object.entries(out).filter(([, val]) => val));
}

// What kind of saved calculation is this?
export function calcKind(calc) {
  const form = calc?.input_data?.form;
  if (form === 'IIT_RETURN' || form === 'IIT_RETURN_2425') return 'return';
  if (calc?.calc_type === 'quarterly') return 'quarterly';
  return 'annual';
}

export const KIND_LABEL = {
  annual: 'Annual IIT Computation',
  return: 'IIT Return Computation',
  return2425: 'IIT Return Computation',
  quarterly: 'Quarterly Instalment',
};

// Headline figures for any saved calculation, recomputed from its inputs
export function summarizeCalc(calc) {
  const kind = calcKind(calc);
  if (kind === 'quarterly') {
    const q = computeQuarterly(calc.input_data);
    return { kind, amount: q.instalment, status: 'instalment', assessable: null, grossTax: null };
  }
  if (kind === 'return') {
    const r = computeReturn(calc.year || '2024/25', calc.input_data);
    return { kind, amount: r.balance, status: r.taxStatus, assessable: r.cage50, grossTax: r.cage170 };
  }
  const a = computeAnnual(calc.year, calc.input_data);
  return { kind, amount: a.netTax, status: a.taxStatus, assessable: a.totalAss, grossTax: a.grossTax };
}

// ═══════════════════════════════════════════════════════════
//  Client self-service calculator (Y/A 2025/26 onwards)
//  Sources: Inland Revenue (Amendment) Act No. 02 of 2025 (First Schedule
//  para 1(1D) rates, para 1(6) 15% max for foreign-currency income remitted
//  through a bank; Fifth Schedule personal relief Rs.1,800,000), IRD Tax Chart
//  2025/26, IRD guide Asmt_IIT_004_2025_2026, APIT Tables 01 & 08.
// ═══════════════════════════════════════════════════════════
export const SOLAR_MAX = 600_000;
export const DONATION_MAX = 75_000;
export const INTEREST_WHT = 0.10;

/**
 * All amounts are ANNUAL rupees.
 * x: { residency: 'resident'|'nrcitizen'|'nonresident',
 *      salary, business, rent, interest, otherLocal,          // Sri Lankan income
 *      foreignFx,                                              // foreign-currency income remitted through a bank (15% max)
 *      foreignOther,                                           // foreign income NOT remitted through a bank (normal rates)
 *      solar, donCharity, donGovt,                             // reliefs / qualifying payments
 *      apitPaid, whtInterestAuto (bool), otherTaxPaid }        // tax already paid
 */
export function computePersonal(year, x = {}) {
  const n = (k) => Math.max(0, num(x[k]));
  const cfg = yearCfg(year);
  const residency = x.residency || 'resident';
  const resident = residency === 'resident';
  const getsPR = residency !== 'nonresident';                       // residents + non-resident citizens
  const foreignTaxable = residency !== 'nonresident';               // non-residents: only Sri Lankan-source income

  const salary = n('salary'), business = n('business'), rent = n('rent'), interest = n('interest'), otherLocal = n('otherLocal');
  const foreignFx = foreignTaxable ? n('foreignFx') : 0;
  const foreignOther = foreignTaxable ? n('foreignOther') : 0;

  const localAss = salary + business + rent + interest + otherLocal + foreignOther;   // normal progressive rates
  const totalAss = localAss + foreignFx;

  // Reliefs (Cage 60) — personal relief limited to assessable income
  const rentRelief = resident ? Math.round(rent * 0.25) : 0;
  const prUsed = getsPR ? Math.min(cfg.pr, Math.max(0, totalAss - rentRelief)) : 0;
  const solarUsed = resident ? Math.min(n('solar'), SOLAR_MAX, Math.max(0, totalAss - rentRelief - prUsed)) : 0;
  const reliefs = rentRelief + prUsed + solarUsed;
  const afterRel = Math.max(0, totalAss - reliefs);

  // Qualifying payments (Cage 100): approved charity ≤ min(Rs.75,000, 1/3 of taxable income); Govt donations in full
  const donUsed = Math.min(n('donCharity'), DONATION_MAX, afterRel / 3);
  const qp = Math.min(Math.round(donUsed) + n('donGovt'), afterRel);
  const deductions = reliefs + qp;

  // Deduct against Sri Lankan / normal-rate income first (higher rates), balance against foreign-currency income
  const taxableLocal = Math.max(0, localAss - deductions);
  const unused = Math.max(0, deductions - localAss);
  const taxableForeign = Math.max(0, foreignFx - unused);
  const taxable = taxableLocal + taxableForeign;

  const local = graduatedTax(taxableLocal, cfg.slabs);
  const foreign = foreignStackTax(taxableLocal, taxableForeign);
  const tax = local.tax + foreign.tax;

  const whtInterest = x.whtInterestAuto ? Math.round(interest * INTEREST_WHT) : 0;
  const credits = n('apitPaid') + whtInterest + n('otherTaxPaid');
  const balance = tax - credits;

  return {
    year, cfg, residency, salary, business, rent, interest, otherLocal, foreignFx, foreignOther,
    localAss, totalAss, rentRelief, prUsed, solarUsed, reliefs, donUsed: Math.round(donUsed), qp, deductions,
    taxableLocal, taxableForeign, taxable, local, foreign, tax, whtInterest, credits, balance,
    afterTax: totalAss - tax,
    effRate: totalAss > 0 ? (tax / totalAss) * 100 : 0,
    marginal: Math.max(0, ...local.detail.map(b => b.rate), ...foreign.bands.map(b => b.rate)),
    mustFile: totalAss > cfg.pr,
    status: balance > 0.5 ? 'payable' : balance < -0.5 ? 'refund' : 'nil',
  };
}

// APIT Tax Table 01 (2025/26): monthly tax on regular profits from primary employment
export function apitTable1(monthly) {
  const m = Math.max(0, num(monthly));
  const rows = [[150_000, 0, 0], [233_333, 0.06, 9_000], [275_000, 0.18, 37_000], [316_667, 0.24, 53_500], [358_333, 0.30, 72_500], [Infinity, 0.36, 94_000]];
  const [, rate, less] = rows.find(([lim]) => m <= lim);
  return Math.max(0, Math.round(m * rate - less));
}
