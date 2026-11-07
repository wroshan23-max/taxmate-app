// V53 — Tax calculator credits (Quick Tax Check: 5 free uses; Advanced Tax Calculator: 1 credit per calculation;
// Standard / Premium plans unlimited). The database keeps the balance and decides every charge.
import { supabase } from './supabase';

async function rpc(name, args) {
  const { data, error } = await supabase.rpc(name, args);
  if (error) throw new Error(error.message);
  return data;
}

export const myCalcCredits = () => rpc('my_calc_credits');
/** One calculation → { ok, charged, reason: plan | off | repeat | free | credit | none, balance, free_left } */
export const spendCalc = (tool, hash) => rpc('use_calc', { p_tool: tool, p_hash: hash });
export const buyCalcPack = (i) => rpc('buy_calc_pack', { p_pack: i });
export const cancelCalcOrder = (id) => rpc('cancel_my_calc_order', { p_order: id });

// admin
export const adminCalcCredits = (clientId) => rpc('admin_calc_credits', { p_client: clientId });
export const adminCalcAdjust = (clientId, delta, note) => rpc('admin_calc_adjust', { p_client: clientId, p_delta: delta, p_note: note || null });
export const adminCalcApprove = (orderId) => rpc('admin_calc_approve', { p_order: orderId });
export const adminCalcCancel = (orderId) => rpc('admin_calc_cancel', { p_order: orderId });

/** Short fingerprint of the figures — the same figures again within 24 hours are not charged again */
export function figuresHash(obj) {
  const s = JSON.stringify(obj);
  let h1 = 0x811c9dc5, h2 = 0x01000193;
  for (let i = 0; i < s.length; i++) {
    const c = s.charCodeAt(i);
    h1 = Math.imul(h1 ^ c, 0x01000193) >>> 0;
    h2 = Math.imul(h2 ^ c, 0x5bd1e995) >>> 0;
  }
  return h1.toString(16).padStart(8, '0') + h2.toString(16).padStart(8, '0') + s.length.toString(16);
}

export const DEFAULT_CALC_SETTINGS = {
  charge: true, auto_credit: true, free_quick: 5,
  packs: [{ credits: 10, price: 500 }, { credits: 25, price: 1000 }, { credits: 60, price: 2000 }],
};

export const CREDIT_KIND = {
  purchase: ['🛒', 'Pack bought'], grant: ['🎁', 'Added by TaxMate'], remove: ['➖', 'Removed by TaxMate'],
  use: ['🧮', 'Calculation'], free: ['⚡', 'Free Quick Tax Check'], plan: ['♾️', 'Included in plan'],
};
export const TOOL_LABEL = { advanced: 'Tax Calculator', quick: 'Quick Tax Check' };
