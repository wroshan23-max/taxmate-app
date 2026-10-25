// Subscription plans (monthly) — settings, client requests, admin billing
import { supabase } from './supabase';

export const DEFAULT_PLANS = [
  { key: 'starter', name: 'Starter', price: 500, active: true, includes_review: false, includes_payroll: false, tagline: 'For self-filers & basic tax support',
    features: ['TaxMate client portal access', 'Tax calendar & deadline reminders', 'Annual income & expense checklist', 'Tax document checklist', 'Basic TIN / RAMIS guidance', 'Basic tax guidance', 'WhatsApp support – basic queries'] },
  { key: 'basic', name: 'Basic', price: 2500, active: true, includes_review: false, includes_payroll: false, tagline: 'For salaried & simple returns',
    features: ['Annual income tax return (IIT) filing', 'TIN / RAMIS account support', 'Tax calendar & deadline reminders', 'Client portal & document vault', 'WhatsApp support'] },
  { key: 'standard', name: 'Standard', price: 6500, active: true, includes_review: false, includes_payroll: true, tagline: 'For freelancers & small businesses',
    features: ['Everything in Basic', 'Monthly bookkeeping (up to 50 transactions)', 'Monthly APIT / payroll tax computation', 'Quarterly instalment calculation', 'Income & Tax summary letter (1 per year)'] },
  { key: 'premium', name: 'Premium', price: 15000, active: true, includes_review: true, includes_payroll: true, tagline: 'Complete tax & accounting care',
    features: ['Everything in Standard', 'Payroll, EPF / ETF returns', 'VAT / SSCL returns (if registered)', 'Annual Tax Review report — free', 'Quarterly review call & priority WhatsApp'] },
];
// Look of each plan. avatar/badge/row are used to highlight subscribers (admin lists + client portal).
export const PLAN_STYLE = {
  starter: { emoji: '🌱', ring: 'ring-lime-200', head: 'from-lime-500 to-green-600', tier: 1,
    avatar: 'bg-gradient-to-br from-lime-400 to-green-600 text-white ring-2 ring-lime-200',
    badge: 'bg-lime-50 text-lime-800 border border-lime-200', row: '' },
  basic: { emoji: '🌿', ring: 'ring-emerald-200', head: 'from-emerald-500 to-teal-600', tier: 2,
    avatar: 'bg-gradient-to-br from-emerald-400 to-teal-600 text-white ring-2 ring-emerald-200',
    badge: 'bg-emerald-50 text-emerald-800 border border-emerald-200', row: '' },
  standard: { emoji: '📘', ring: 'ring-primary-200', head: 'from-primary-600 to-indigo-700', tier: 3,
    avatar: 'bg-gradient-to-br from-primary-500 to-indigo-700 text-white ring-2 ring-indigo-200 shadow-sm shadow-indigo-200',
    badge: 'bg-gradient-to-r from-primary-600 to-indigo-600 text-white', row: 'bg-indigo-50/30' },
  premium: { emoji: '👑', ring: 'ring-gold-500/60', head: 'from-amber-500 to-orange-600', tier: 4,
    avatar: 'bg-gradient-to-br from-amber-300 via-gold-500 to-orange-500 text-white ring-2 ring-amber-300 shadow-md shadow-amber-200',
    badge: 'bg-gradient-to-r from-amber-400 via-gold-500 to-orange-500 text-white shadow-sm shadow-amber-200', row: 'bg-amber-50/40' },
};
export const planStyle = (key) => PLAN_STYLE[key] ?? { emoji: '⭐', ring: 'ring-gray-200', head: 'from-gray-600 to-gray-800', tier: 1,
  avatar: 'bg-gradient-to-br from-gray-500 to-gray-700 text-white ring-2 ring-gray-200', badge: 'bg-gray-100 text-gray-700 border border-gray-200', row: '' };
export const SUB_STATUS = {
  requested: { label: 'Requested', cls: 'bg-amber-100 text-amber-800' },
  active:    { label: 'Active',    cls: 'bg-green-100 text-green-700' },
  paused:    { label: 'Paused',    cls: 'bg-gray-100 text-gray-600' },
  cancelled: { label: 'Cancelled', cls: 'bg-red-50 text-red-600' },
};
export const rsPlan = (n) => `Rs. ${Number(n || 0).toLocaleString('en-LK')}`;
const errMsg = (e) => (e?.message || String(e)).replace(/^.*?:\s*/, '');

export async function loadPlans() {
  const { data } = await supabase.from('app_settings').select('value').eq('key', 'plans').maybeSingle();
  const plans = Array.isArray(data?.value?.plans) && data.value.plans.length ? data.value.plans : DEFAULT_PLANS;
  return plans;
}
export async function savePlans(plans) {
  const clean = plans.map(p => ({
    key: String(p.key || '').toLowerCase().replace(/[^a-z0-9_-]/g, '').slice(0, 30) || 'plan',
    name: String(p.name || '').trim().slice(0, 60) || 'Plan',
    price: Math.max(0, Math.round(Number(p.price) || 0)),
    active: p.active !== false, includes_review: !!p.includes_review, includes_payroll: !!p.includes_payroll,
    tagline: String(p.tagline || '').trim().slice(0, 80),
    features: (p.features || []).map(f => String(f).trim()).filter(Boolean).slice(0, 12),
  }));
  const keys = clean.map(p => p.key);
  if (new Set(keys).size !== keys.length) throw new Error('Each plan needs a different code');
  const { error } = await supabase.from('app_settings').upsert({ key: 'plans', value: { currency: 'LKR', plans: clean } });
  if (error) throw new Error(error.message);
  return clean;
}

// Client
export async function myPlans() {
  const { data, error } = await supabase.rpc('my_plans');
  if (error) throw new Error(errMsg(error));
  return data ?? { plans: [], current: null, request: null };
}
export async function requestPlan(key, note) {
  const { error } = await supabase.rpc('request_plan', { p_plan: key, p_note: note || '' });
  if (error) throw new Error(errMsg(error));
}
export async function cancelPlanRequest() {
  const { error } = await supabase.rpc('cancel_my_plan_request');
  if (error) throw new Error(errMsg(error));
}

// Admin
export async function activateRequest(sub, { price, start, auto }) {
  const { error } = await supabase.rpc('admin_activate_subscription', { p_sub: sub.id, p_price: Number(price), p_start: start || null, p_auto: !!auto });
  if (error) throw new Error(errMsg(error));
}
export async function billNow(sub) {
  const { data, error } = await supabase.rpc('admin_bill_subscription', { p_sub: sub.id });
  if (error) throw new Error(errMsg(error));
  return data;
}
// Active plan per client (admin) → { [client_id]: { plan_key, plan_name, start_date } }
export async function activePlansByClient() {
  const { data } = await supabase.from('subscriptions').select('client_id, plan_key, plan_name, start_date').eq('status', 'active');
  return Object.fromEntries((data ?? []).map(s => [s.client_id, s]));
}
// The signed-in client's active plan (RLS: own rows only)
export async function myActivePlan() {
  const { data } = await supabase.from('subscriptions').select('plan_key, plan_name, start_date').eq('status', 'active').maybeSingle();
  return data ?? null;
}
export const monthly = (subs) => (subs ?? []).filter(s => s.status === 'active').reduce((a, s) => a + Number(s.price || 0), 0);

// ─── Add-on services (monthly, without changing plan) ─────
export const DEFAULT_ADDONS = [
  { key: 'payroll', name: 'Payroll & APIT', price: 1500, active: true, tagline: 'Staff list, monthly APIT, EPF / ETF and payslips',
    features: ['Staff list with salary & allowances', 'Monthly APIT (Tax Table 01) worked out automatically', 'EPF 8% + 12% and ETF 3%', 'Payslips — PDF or WhatsApp', 'EPF / ETF, APIT and bank transfer reports'] },
];
export const ADDON_EMOJI = { payroll: '👥' };
export const addonEmoji = (k) => ADDON_EMOJI[k] ?? '🧩';
export async function loadAddons() {
  const { data } = await supabase.from('app_settings').select('value').eq('key', 'addons').maybeSingle();
  return Array.isArray(data?.value?.addons) ? data.value.addons : DEFAULT_ADDONS;
}
export async function saveAddons(addons) {
  const clean = addons.map(a => ({
    key: String(a.key || '').toLowerCase().replace(/[^a-z0-9_-]/g, '').slice(0, 30) || 'service',
    name: String(a.name || '').trim().slice(0, 60) || 'Service',
    price: Math.max(0, Math.round(Number(a.price) || 0)), active: a.active !== false,
    tagline: String(a.tagline || '').trim().slice(0, 100),
    features: (a.features || []).map(f => String(f).trim()).filter(Boolean).slice(0, 10),
  }));
  const keys = clean.map(a => a.key);
  if (new Set(keys).size !== keys.length) throw new Error('Each service needs a different code');
  const { error } = await supabase.from('app_settings').upsert({ key: 'addons', value: { addons: clean } });
  if (error) throw new Error(error.message);
  return clean;
}
export async function myAddons() {
  const { data, error } = await supabase.rpc('my_addons');
  if (error) throw new Error(errMsg(error));
  return data ?? { addons: [], mine: [], payroll: { on: false } };
}
export async function requestAddon(key, note) {
  const { error } = await supabase.rpc('request_addon', { p_key: key, p_note: note || '' });
  if (error) throw new Error(errMsg(error));
}
export async function cancelAddonRequest(key) {
  const { error } = await supabase.rpc('cancel_my_addon_request', { p_key: key });
  if (error) throw new Error(errMsg(error));
}
export async function myPayrollAccess() {
  const { data } = await supabase.rpc('my_payroll_access');
  return data ?? { on: false };
}
export async function billAddonNow(a) {
  const { data, error } = await supabase.rpc('admin_bill_addon', { p_id: a.id });
  if (error) throw new Error(errMsg(error));
  return data;
}
