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

// Foreign bank income (2025/26+): 6% on first Rs.1,000,000 taxable; 15% on balance
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
  const fbResult   = calcForeignTax(taxableFB);
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

// ─── IIT Return Y/A 2024/25 (cage-wise, mixed income) ────
export function computeReturn2425(f = {}) {
  const n = (k) => num(f[k]);

  const cage10 = n('empPrimary') + n('empSecondary') + n('empBenefits') + n('empBonus');
  const bizGross    = n('bizProfit') + n('bizPartner');
  const bizLossUsed = Math.min(n('bizLossBF'), bizGross);
  const cage20      = bizGross - bizLossUsed;
  const cage30 = n('interest') + n('rentGross') + n('othInv');
  const cage40 = n('othInc') + n('forTaxable');
  const cage50 = cage10 + cage20 + cage30 + cage40;

  const rentRelief = Math.min(Math.round(n('rentGross') * 0.25), cage50);
  const prUsed     = Math.min(PR_2425, Math.max(0, cage50 - rentRelief));
  const solarUsed  = Math.min(n('solar'), 600_000, Math.max(0, cage50 - rentRelief - prUsed));
  const reliefs    = rentRelief + prUsed + solarUsed;
  const afterRel   = Math.max(0, cage50 - reliefs);

  const donCap  = Math.min(75_000, afterRel / 3);
  const donUsed = Math.min(n('donCharity'), donCap);
  const qpRaw   = donUsed + n('donGovt') + n('qpOther');
  const cage100 = Math.min(qpRaw, afterRel);

  const cage120 = Math.max(0, afterRel - cage100);
  const prog    = graduatedTax(cage120, SLABS_2425);
  const term    = terminalBenefitTax(n('termBen'));
  const gainTax = Math.round(n('invGain') * 0.10);
  const cage170 = prog.tax + term.tax + gainTax;

  const credits = [
    { cage: '901', label: 'Foreign tax credit', amt: n('ftc') },
    { cage: '903', label: 'APIT — primary employment', amt: n('apitPrimary') },
    { cage: '904', label: 'APIT — secondary employment', amt: n('apitSecondary') },
    { cage: '905', label: 'Tax deducted on terminal benefits', amt: n('termTaxDed') },
    { cage: '908', label: 'AIT/WHT deducted (interest, rent, fees, other)', amt: n('whtInterest') + n('whtRent') + n('whtService') + n('whtOther') },
    { cage: '909/910', label: 'Investment gain tax paid', amt: n('gainTaxPaid') },
    { cage: '911', label: 'Self-assessment instalments paid', amt: n('instalments') },
  ];
  const cage180 = credits.reduce((s, x) => s + x.amt, 0);
  const balance = cage170 - cage180;

  const sources = [
    cage10 > 0 && 'Employment', cage20 > 0 && 'Business', n('interest') > 0 && 'Interest',
    n('rentGross') > 0 && 'Rent', n('othInv') > 0 && 'Other investment', cage40 > 0 && 'Other',
    n('termBen') > 0 && 'Terminal benefits', n('invGain') > 0 && 'Capital gains',
    n('forExempt') > 0 && 'Foreign (exempt)',
  ].filter(Boolean);

  return {
    f: Object.fromEntries(Object.keys(f).map(k => [k, n(k)])),
    cage10, cage20, bizGross, bizLossUsed, cage30, cage40, cage50, rentRelief, prUsed, solarUsed, reliefs,
    donUsed, donCap, cage100, cage120, prog, term, gainTax, cage170, credits, cage180, balance,
    cage210: n('forExempt') + n('othExempt'), sources,
    effRate: cage50 > 0 ? (cage170 / cage50 * 100).toFixed(2) : '0.00',
    taxStatus: balance > 0.5 ? 'payable' : balance < -0.5 ? 'refund' : 'nil',
  };
}

// What kind of saved calculation is this?
export function calcKind(calc) {
  if (calc?.input_data?.form === 'IIT_RETURN_2425') return 'return2425';
  if (calc?.calc_type === 'quarterly') return 'quarterly';
  return 'annual';
}

export const KIND_LABEL = {
  annual: 'Annual IIT Computation',
  return2425: 'IIT Return Y/A 2024/25',
  quarterly: 'Quarterly Instalment',
};

// Headline figures for any saved calculation, recomputed from its inputs
export function summarizeCalc(calc) {
  const kind = calcKind(calc);
  if (kind === 'quarterly') {
    const q = computeQuarterly(calc.input_data);
    return { kind, amount: q.instalment, status: 'instalment', assessable: null, grossTax: null };
  }
  if (kind === 'return2425') {
    const r = computeReturn2425(calc.input_data);
    return { kind, amount: r.balance, status: r.taxStatus, assessable: r.cage50, grossTax: r.cage170 };
  }
  const a = computeAnnual(calc.year, calc.input_data);
  return { kind, amount: a.netTax, status: a.taxStatus, assessable: a.totalAss, grossTax: a.grossTax };
}
