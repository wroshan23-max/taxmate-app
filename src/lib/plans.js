// Subscription plans (monthly) — settings, client requests, admin billing
import { supabase } from './supabase';

export const DEFAULT_PLANS = [
  { key: 'basic', name: 'Basic', price: 2500, active: true, includes_review: false, tagline: 'For salaried & simple returns',
    features: ['Annual income tax return (IIT) filing', 'TIN / RAMIS account support', 'Tax calendar & deadline reminders', 'Client portal & document vault', 'WhatsApp support'] },
  { key: 'standard', name: 'Standard', price: 6500, active: true, includes_review: false, tagline: 'For freelancers & small businesses',
    features: ['Everything in Basic', 'Monthly bookkeeping (up to 50 transactions)', 'Monthly APIT / payroll tax computation', 'Quarterly instalment calculation', 'Income & Tax summary letter (1 per year)'] },
  { key: 'premium', name: 'Premium', price: 15000, active: true, includes_review: true, tagline: 'Complete tax & accounting care',
    features: ['Everything in Standard', 'Payroll, EPF / ETF returns', 'VAT / SSCL returns (if registered)', 'Annual Tax Review report — free', 'Quarterly review call & priority WhatsApp'] },
];
export const PLAN_STYLE = {
  basic: { emoji: '🌱', ring: 'ring-emerald-200', head: 'from-emerald-500 to-teal-600' },
  standard: { emoji: '📘', ring: 'ring-primary-200', head: 'from-primary-600 to-indigo-700' },
  premium: { emoji: '👑', ring: 'ring-gold-500/60', head: 'from-amber-500 to-orange-600' },
};
export const planStyle = (key) => PLAN_STYLE[key] ?? { emoji: '⭐', ring: 'ring-gray-200', head: 'from-gray-600 to-gray-800' };
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
    active: p.active !== false, includes_review: !!p.includes_review,
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
export const monthly = (subs) => (subs ?? []).filter(s => s.status === 'active').reduce((a, s) => a + Number(s.price || 0), 0);
