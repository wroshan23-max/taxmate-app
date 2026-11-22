// V74 — Tax & Accounting service packages (client picks one per Y/A; Nil return moves to the suitable
// package when the computation shows income tax)
import { supabase } from './supabase';
import { summarizeCalc, calcKind } from './iitCalc';

/** Defaults (same as the database's). Prices / on-off are edited in Settings → Packages. */
export const DEFAULT_PACKAGES = [
  { key: 'personal_local', name: 'Personal Tax File', sub: 'Local income only', si: 'පුද්ගල බදු ගොනුව — දේශීය ආදායම', price: 10000, from: true, active: true, group: 'individual',
    includes: ['Income tax computation', 'Return filed in RAMIS', 'Reliefs & APIT/WHT credits claimed', 'IRD acknowledgment in your portal'] },
  { key: 'personal_fx', name: 'Personal Tax File', sub: 'Local + Foreign income', si: 'පුද්ගල බදු ගොනුව — දේශීය + විදේශ ආදායම', price: 15000, from: true, active: true, group: 'individual',
    includes: ['Local and foreign-currency income', '15% maximum on foreign income through a bank', 'Foreign tax credit check', 'Return filed in RAMIS'] },
  { key: 'freelancer', name: 'Freelancer / Service Exporter', sub: 'Services to foreign clients', si: 'Freelancer / සේවා අපනයනකරු', price: 15000, from: true, active: true, group: 'individual',
    includes: ['Business income & expenses', 'Equipment capital allowances', '15% maximum on foreign-currency service income', 'Return filed in RAMIS'] },
  { key: 'senior', name: 'Senior Citizen Tax File', sub: '60 years and above', si: 'ජ්‍යෙෂ්ඨ පුරවැසි බදු ගොනුව', price: 10000, from: true, active: true, group: 'individual',
    includes: ['Interest, rent & pension income', 'WHT / AIT refunds claimed', 'Written or online filing', 'Return filed with the IRD'] },
  { key: 'sole', name: 'Sole Proprietor', sub: 'Business in your own name', si: 'තනි හිමිකරු ව්‍යාපාරය', price: 25000, from: true, active: true, group: 'business',
    includes: ['Business profit computation', 'Capital allowances', 'Owner\'s income tax return', 'Quarterly instalment advice'] },
  { key: 'partnership', name: 'Partnership', sub: 'Partnership tax return', si: 'හවුල් ව්‍යාපාරය', price: 25000, from: true, active: true, group: 'business',
    includes: ['Partnership income tax return', 'Partners\' share of profit', 'Statement of accounts review', 'Filed in RAMIS'] },
  { key: 'company', name: 'Private Limited Company', sub: 'Company income tax', si: 'පුද්ගලික සමාගම', price: 80000, from: true, active: true, group: 'business',
    includes: ['Company income tax return', 'Tax computation from financial statements', 'Capital allowances & deferred items', 'Filed in RAMIS'] },
  { key: 'nil', name: 'Nil Return File', sub: 'No taxable income', si: 'ශුන්‍ය බදු ප්‍රකාශය', price: 3000, from: false, active: true, group: 'individual',
    includes: ['For income within the tax-free relief', 'Return filed in RAMIS', 'Keeps your IRD record clean'] },
];
const META = Object.fromEntries(DEFAULT_PACKAGES.map((p) => [p.key, p]));
export const pkgMeta = (key) => META[key] || { key, name: key, includes: [], group: 'individual' };
/** Merge the saved price list (key, name, price, from, active) with the display details */
export const mergePackages = (list) => (Array.isArray(list) && list.length ? list : DEFAULT_PACKAGES)
  .map((p) => ({ ...pkgMeta(p.key), ...p, name: p.name ? String(p.name).split(' — ')[0] : pkgMeta(p.key).name }));
export const fullName = (p) => (p.sub && ['personal_local', 'personal_fx'].includes(p.key) ? `${p.name} — ${p.sub}` : p.name);
export const priceText = (p) => (p.price == null || p.price === '' ? 'Ask for a quote' : `${p.from ? 'From ' : ''}LKR ${Number(p.price).toLocaleString('en-LK')}${p.key === 'nil' ? '' : ' / year'}`);

export async function loadPackages() {
  const { data, error } = await supabase.rpc('package_list');
  if (error) return DEFAULT_PACKAGES;          // before the V74 script: show the defaults
  return mergePackages(data);
}
export async function loadMyPackages() {
  const { data, error } = await supabase.from('client_packages').select('*').order('year', { ascending: false });
  if (error) return [];
  return data ?? [];
}
const clean = (e) => new Error(String(e?.message || e).replace(/^.*?ERROR:\s*/, ''));
export async function selectPackage(year, key, note) {
  const { data, error } = await supabase.rpc('my_select_package', { p_year: year, p_key: key, p_note: note || null });
  if (error) throw clean(error);
  return data;
}
export async function autoUpgrade(year, key, reason) {
  const { data, error } = await supabase.rpc('my_package_auto_upgrade', { p_year: year, p_key: key, p_reason: reason });
  if (error) throw clean(error);
  return data;
}
export async function adminSetPackage(clientId, year, key, reason, auto = false) {
  const { data, error } = await supabase.rpc('admin_set_package', { p_client: clientId, p_year: year, p_key: key, p_reason: reason || null, p_auto: auto });
  if (error) throw clean(error);
  return data;
}
export async function adminConfirmPackage(id) {
  const { error } = await supabase.rpc('admin_confirm_package', { p_id: id });
  if (error) throw clean(error);
}

// ── Which package fits a computation ──────────────────────────────────────
const n = (v) => Math.max(0, Number(String(v ?? '').replace(/,/g, '')) || 0);
/** Age at the end of the Y/A from a Sri Lankan NIC (old 9 digits + V/X, or new 12 digits) */
export function ageFromNic(nic, year) {
  const s = String(nic || '').trim().toUpperCase();
  let y = null;
  if (/^\d{9}[VX]$/.test(s)) y = 1900 + Number(s.slice(0, 2));
  else if (/^\d{12}$/.test(s)) y = Number(s.slice(0, 4));
  if (!y) return null;
  return parseInt(year, 10) + 1 - y;
}

/**
 * The computation's tax and income mix → { liable, tax, suggested, why }
 * liable = income tax before credits > 0 (a Nil return is then not suitable)
 */
export function packageFit(calc, client = {}) {
  if (!calc) return null;
  const kind = calcKind(calc);
  if (kind === 'quarterly') return null;
  let sm; try { sm = summarizeCalc(calc); } catch { return null; }
  const f = calc.input_data || {};
  const tax = Math.round(n(sm.grossTax));
  const biz = n(f.bizProfit) + n(f.bizPartner) + n(f.biz) + n(f.cons);
  const freelance = n(f.bizFx);
  const foreign = n(f.empFx) + n(f.forFx) + n(f.forTaxable) + n(f.forBank) + n(f.forOth);
  const age = ageFromNic(client.nic, calc.year);
  let suggested = 'personal_local', why = 'local income';
  if (biz > 0) { suggested = 'sole'; why = 'business income'; }
  else if (freelance > 0) { suggested = 'freelancer'; why = 'freelance / service export income'; }
  else if (foreign > 0) { suggested = 'personal_fx'; why = 'foreign income'; }
  else if (age !== null && age >= 60) { suggested = 'senior'; why = 'senior citizen'; }
  return { liable: tax > 0, tax, suggested, why, assessable: Math.round(n(sm.assessable)) };
}

/** The latest computation for a Y/A (final first) from a list */
export function bestCalcFor(calcs, year) {
  const list = (calcs || []).filter((c) => c.year === year && calcKind(c) !== 'quarterly');
  return list.find((c) => c.status === 'final') || list.sort((a, b) => String(b.created_at).localeCompare(String(a.created_at)))[0] || null;
}
export const upgradeReason = (fit, year) => `Your Y/A ${year} computation shows income tax of Rs. ${fit.tax.toLocaleString('en-LK')} (${fit.why}) — a Nil return is not suitable.`;
