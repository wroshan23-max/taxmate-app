// Invoice payments: PayHere (card / mobile wallets / internet banking) and bank transfer with a slip.
import { supabase } from './supabase';
import { compressImage, fmtBytes } from './documents';

export const PAY_STATUS = {
  pending:     { label: 'Processing', cls: 'bg-blue-100 text-blue-700', emoji: '⏳' },
  review:      { label: 'Slip sent — checking', cls: 'bg-amber-100 text-amber-800', emoji: '🔎' },
  paid:        { label: 'Paid', cls: 'bg-green-100 text-green-700', emoji: '✅' },
  failed:      { label: 'Failed', cls: 'bg-red-100 text-red-700', emoji: '❌' },
  cancelled:   { label: 'Cancelled', cls: 'bg-gray-100 text-gray-600', emoji: '↩️' },
  rejected:    { label: 'Slip not accepted', cls: 'bg-red-100 text-red-700', emoji: '⚠️' },
  chargedback: { label: 'Charged back', cls: 'bg-red-100 text-red-700', emoji: '⚠️' },
};
const errMsg = (e) => (e?.message || String(e)).replace(/^.*?ERROR:\s*/, '');

export async function paymentOptions() {
  const { data, error } = await supabase.rpc('my_payment_options');
  if (error) throw new Error(errMsg(error));
  return data ?? { payhere: false, bank: false, accounts: [] };
}

/** Ask the server for a signed PayHere checkout, then post the browser to PayHere. */
export async function startPayHere(invoiceId) {
  const { data, error } = await supabase.functions.invoke('payhere', { body: { action: 'checkout', invoice_id: invoiceId } });
  if (error) throw new Error(errMsg(error));
  if (data?.error) throw new Error(data.error);
  const form = document.createElement('form');
  form.method = 'POST';
  form.action = data.action_url;
  for (const [k, v] of Object.entries(data.fields)) {
    const i = document.createElement('input');
    i.type = 'hidden'; i.name = k; i.value = v;
    form.appendChild(i);
  }
  document.body.appendChild(form);
  form.submit();
}

export async function payhereStatus() {
  const { data, error } = await supabase.functions.invoke('payhere', { body: { action: 'status' } });
  if (error) throw new Error(errMsg(error));
  return data;
}

const SLIP_TYPES = ['image/jpeg', 'image/png', 'image/webp', 'application/pdf'];
export async function submitBankPayment({ clientId, invoiceId, amount, reference, paidOn, file, note }) {
  if (!file) throw new Error('Please attach a photo or PDF of the payment slip.');
  const f = await compressImage(file);
  if (!SLIP_TYPES.includes(f.type)) throw new Error('Slip must be a photo (JPG/PNG) or a PDF.');
  if (f.size > 5 * 1024 * 1024) throw new Error(`The slip is ${fmtBytes(f.size)} — please send a smaller photo (max 5 MB).`);
  const ext = f.type === 'application/pdf' ? 'pdf' : f.type.split('/')[1].replace('jpeg', 'jpg');
  const path = `${clientId}/${Date.now()}-${Math.random().toString(36).slice(2, 8)}-slip.${ext}`;
  const { error: upErr } = await supabase.storage.from('payment-slips').upload(path, f, { contentType: f.type, upsert: false });
  if (upErr) throw new Error(upErr.message);
  const { error } = await supabase.rpc('submit_bank_payment', {
    p_invoice: invoiceId, p_amount: Number(amount), p_reference: reference || '', p_paid_on: paidOn || null, p_slip_path: path, p_note: note || '',
  });
  if (error) throw new Error(errMsg(error));
}

export async function slipUrl(path) {
  const { data, error } = await supabase.storage.from('payment-slips').createSignedUrl(path, 300);
  if (error) throw error;
  return data.signedUrl;
}
