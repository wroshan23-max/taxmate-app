// ═══════════════════════════════════════════════════════════════════════════
//  V72 — Business & Freelance tool: TaxMate's office working for one Y/A
//  Gross business income (local + foreign-currency services)
//    − expenses × work-use %            (IRA 2017 s.11: only to the extent incurred in producing the income;
//                                         s.10: domestic / personal expenses are not deductible)
//    − capital allowances on equipment  (s.16 & Fourth Schedule: straight line, depreciation basis ÷ years;
//                                         full allowance in the year of acquisition if still used at 31 March;
//                                         none in the year of disposal — balancing allowance / charge instead;
//                                         no allowance for road vehicles other than commercial / goods vehicles)
//    = net income from business → IIT Return (foreign part = Cage 20 foreign-currency business, max 15%)
//  Sources: IRD "Guide to sources of income (Inland Revenue Act No. 24 of 2017)" ch. 4.4 & 4.8 (ird.gov.lk);
//  Inland Revenue (Amendment) Act No. 02 of 2025 (foreign-currency service income taxed from 1 April 2025).
// ═══════════════════════════════════════════════════════════════════════════
import { supabase } from './supabase';
import { BIZ_EXPENSES, rowTotal } from './incomeSheet';

const num = (v) => { const n = Number(String(v ?? '').replace(/,/g, '')); return Number.isFinite(n) ? n : 0; };
const r2 = (n) => Math.round((n + Number.EPSILON) * 100) / 100;

/** Fourth Schedule classes (years = straight-line life). c5: intangible — years = its useful life (enter). */
export const CA_CLASSES = [
  { key: 'c1', short: 'Class 1', label: 'Class 1 — Computers, data handling equipment & peripherals', years: 5 },
  { key: 'c2', short: 'Class 2', label: 'Class 2 — Buses, goods / commercial vehicles, heavy trucks, plant & machinery', years: 5 },
  { key: 'c3', short: 'Class 3', label: 'Class 3 — Office furniture, fixtures & equipment; any other depreciable asset', years: 5 },
  { key: 'c4', short: 'Class 4', label: 'Class 4 — Buildings & permanent structures', years: 20 },
  { key: 'c5', short: 'Class 5', label: 'Class 5 — Intangible assets (not goodwill) — over useful life', years: null },
  { key: 'rv', short: 'No allowance', label: 'Road vehicle (car / van / motor cycle) — no capital allowance', years: 0 },
  { key: 'na', short: 'No allowance', label: 'Not used in the business — no allowance', years: 0 },
];
export const classOf = (k) => CA_CLASSES.find((c) => c.key === k);

/** First guess from the item name (TaxMate confirms) */
export function guessClass(item = '') {
  const s = item.toLowerCase();
  if (/(car|van|jeep|motor ?cycle|bike|scooter|vehicle)/.test(s)) return 'rv';
  if (/(laptop|computer|\bpc\b|desktop|macbook|monitor|printer|scanner|router|modem|starlink|server|tablet|ipad|keyboard|mouse|hard ?disk|ssd|ups|network|camera)/.test(s)) return 'c1';
  if (/(software|licen[cs]e|patent|trademark|copyright)/.test(s)) return 'c5';
  if (/(building|house|office construction|extension)/.test(s)) return 'c4';
  return 'c3';
}

/** Default work-use %: costs that are clearly for the business = 100; shared home bills must be set by TaxMate (null). */
export const DEFAULT_PCT = {
  bizPurchases: 100, bizSalaries: 100, bizRent: 100, exSoftware: 100, bizTransport: 100, exBank: 100, exStationery: 100,
  exRepairs: 100, exTraining: 100, exProfFees: 100, exAdvert: 100, bizOtherExp: 100,
  exMobile: null, exInternet: null, exInternet2: null, exElectricity: null, exWater: null, bizUtilities: null,
};
export const EXPENSE_ROWS = [...BIZ_EXPENSES.rows, { key: 'bizUtilities', en: 'Electricity, water, phone, internet (combined — old entry)' }];

/** Y/A (1 Apr – 31 Mar) start year of a date "YYYY-MM-DD" */
export const yaStartOf = (d) => { const [y, m] = String(d).split('-').map(Number); return y ? (m >= 4 ? y : y - 1) : null; };
const yaLabel = (s) => `${s}/${String(s + 1).slice(2)}`;

/** One asset's capital allowance for the Y/A. a = client entry, o = office settings {cls, pct, years, prior} */
export function assetAllowance(a, o = {}, year) {
  const Y = parseInt(year, 10);
  const cost = num(a.cost);
  const cls = classOf(o.cls || guessClass(a.item));
  const pct = o.pct === undefined || o.pct === null || o.pct === '' ? (a.work === 'partly' ? null : 100) : Math.min(100, Math.max(0, num(o.pct)));
  const acq = yaStartOf(a.date);
  const res = { cost, cls, pct, acqYA: acq ? yaLabel(acq) : '', basis: 0, years: 0, annual: 0, prior: 0, priorAuto: 0, allowance: 0, wdv: 0, balancing: 0, charge: 0, note: '', issue: '' };
  if (!cost) { res.issue = 'No cost'; return res; }
  if (!acq) { res.issue = 'Date bought missing'; return res; }
  if (acq > Y) { res.note = 'Bought after 31 March — next year'; return res; }
  if (pct === null) { res.issue = 'Set the work-use %'; return res; }
  const years = cls.key === 'c5' ? Math.max(0, Math.round(num(o.years))) : cls.years;
  if (!years) { res.note = cls.key === 'c5' ? '' : 'No capital allowance for this asset'; if (cls.key === 'c5') res.issue = 'Enter the useful life (years)'; return res; }
  const basis = r2(cost * pct / 100);
  const annual = r2(basis / years);
  const priorAuto = r2(Math.min(basis, annual * Math.max(0, Y - acq)));
  const prior = o.prior === undefined || o.prior === null || o.prior === '' ? priorAuto : Math.min(basis, Math.max(0, num(o.prior)));
  Object.assign(res, { basis, years, annual, priorAuto, prior });
  const dispYA = a.disposed ? (a.disposedOn ? yaStartOf(a.disposedOn) : Y) : null;
  if (dispYA !== null && dispYA < Y) { res.note = `Disposed in Y/A ${yaLabel(dispYA)}`; res.wdv = 0; return res; }
  if (dispYA === Y) {
    // year of disposal: no allowance; written-down value vs. the business share of the sale price
    const wdv = r2(basis - prior);
    const proceeds = r2(num(a.proceeds) * pct / 100);
    const diff = r2(wdv - proceeds);
    if (diff > 0) res.balancing = diff; else res.charge = -diff;
    res.note = `Disposed this year — ${diff >= 0 ? 'balancing allowance' : 'balancing charge (income)'}`;
    return res;
  }
  res.allowance = r2(Math.max(0, Math.min(annual, basis - prior)));
  res.wdv = r2(basis - prior - res.allowance);
  if (acq === Y) res.note = 'Bought this year — full year allowance';
  else if (!res.allowance) res.note = 'Fully claimed in earlier years';
  return res;
}

/**
 * The full working. data = client's sheet data, office = { pct: {row: %}, remarks: {row: text}, assets: {id: {...}},
 * fxOtherIsBiz, alloc: 'prop' | 'fx' | 'local' }
 */
export function computeWorking(data, office = {}, year) {
  const pctOf = (k) => { const v = office.pct?.[k]; return v === undefined || v === null || v === '' ? (k in DEFAULT_PCT ? DEFAULT_PCT[k] : 100) : Math.min(100, Math.max(0, num(v))); };
  const expenses = EXPENSE_ROWS.map((r) => {
    const total = r2(rowTotal(data, r.key));
    const pct = pctOf(r.key);
    return { key: r.key, en: r.en, total, pct, claim: pct === null ? 0 : r2(total * pct / 100), remark: office.remarks?.[r.key] || '' };
  }).filter((x) => x.total || x.key !== 'bizUtilities');
  const assets = (data?.assets ?? []).map((a) => ({ a, o: office.assets?.[a.id] || {}, r: assetAllowance(a, office.assets?.[a.id] || {}, year) }));

  const fxServices = r2(rowTotal(data, 'fxServices'));
  const fxOther = office.fxOtherIsBiz ? r2(rowTotal(data, 'fxOther')) : 0;
  const grossFx = r2(fxServices + fxOther);
  const grossLocal = r2(rowTotal(data, 'bizSales') + rowTotal(data, 'bizOtherIncome'));
  const gross = r2(grossFx + grossLocal);
  const expClaim = r2(expenses.reduce((s, x) => s + x.claim, 0));
  const capAllow = r2(assets.reduce((s, x) => s + x.r.allowance + x.r.balancing, 0));
  const charges = r2(assets.reduce((s, x) => s + x.r.charge, 0));
  const deductions = r2(expClaim + capAllow);
  const net = r2(gross + charges - deductions);

  // share the deductions (and any balancing charge) between foreign-currency and local business income
  const alloc = office.alloc || 'prop';
  const fxShare = alloc === 'fx' ? 1 : alloc === 'local' ? 0 : gross > 0 ? grossFx / gross : (grossFx > 0 ? 1 : 0);
  let netFx = r2(grossFx + charges * fxShare - deductions * fxShare);
  let netLocal = r2(grossLocal + charges * (1 - fxShare) - deductions * (1 - fxShare));
  // one business: a shortfall in one part reduces the other part first
  if (netFx < 0 && netLocal > 0) { const m = Math.min(-netFx, netLocal); netFx = r2(netFx + m); netLocal = r2(netLocal - m); }
  if (netLocal < 0 && netFx > 0) { const m = Math.min(-netLocal, netFx); netLocal = r2(netLocal + m); netFx = r2(netFx - m); }
  const loss = r2(Math.max(0, -(netFx + netLocal)));
  netFx = Math.max(0, netFx); netLocal = Math.max(0, netLocal);

  const issues = [
    ...expenses.filter((x) => x.total && x.pct === null).map((x) => `${x.en}: set the work-use %`),
    ...assets.filter((x) => x.r.issue).map((x) => `${x.a.item || 'Asset'}: ${x.r.issue}`),
    ...(fxServices === 0 && rowTotal(data, 'fxOther') > 0 && !office.fxOtherIsBiz ? ['Foreign income is under "Other foreign income" — tick "treat as freelance / business income" if it is for services'] : []),
  ];
  return { expenses, assets, grossFx, grossLocal, gross, expClaim, capAllow, charges, deductions, net, netFx, netLocal, loss, fxShare, alloc, fxOtherIsBiz: !!office.fxOtherIsBiz, issues };
}

// ── storage: admin-only office working (income_sheet_office) ──
const notSetUp = (e) => /income_sheet_office|biz_mode|schema cache|does not exist/.test(e?.message || '');
export async function loadOffice(sheetId) {
  const { data, error } = await supabase.from('income_sheet_office').select('data, updated_at').eq('sheet_id', sheetId).maybeSingle();
  if (error) { if (notSetUp(error)) return { data: {}, missing: true }; throw new Error(error.message); }
  return { data: data?.data || {}, updated_at: data?.updated_at };
}
export async function saveOffice(sheet, office) {
  const { error } = await supabase.from('income_sheet_office')
    .upsert({ sheet_id: sheet.id, client_id: sheet.client_id, data: office, updated_at: new Date().toISOString() }, { onConflict: 'sheet_id' });
  if (error) throw new Error(notSetUp(error) ? 'Run the V72 script in Supabase first.' : error.message);
}
export async function setBizMode(sheetId, on) {
  const { error } = await supabase.from('income_sheets').update({ biz_mode: on, updated_at: new Date().toISOString() }).eq('id', sheetId);
  if (error) throw new Error(notSetUp(error) ? 'Run the V72 script in Supabase first.' : error.message);
}
