// ═══════════════════════════════════════════════════════════
//  Send reports & invoices by WhatsApp / Email via a secure link
//  The link (/share/<token>) shows ONE document without login.
// ═══════════════════════════════════════════════════════════
import { summarizeCalc, KIND_LABEL } from './iitCalc';
import { billTo } from './invoice';
import { FIRM } from './iitStatement';

const rs = (v) => 'Rs. ' + Math.round(Math.abs(v || 0)).toLocaleString('en-LK');

export const shareUrl = (token) => `${window.location.origin}/share/${token}`;

// Sri Lankan numbers → international format for wa.me (0771234567 → 94771234567)
export function waNumber(phone) {
  let d = String(phone || '').replace(/\D/g, '');
  if (!d) return '';
  if (d.startsWith('00')) d = d.slice(2);
  if (d.startsWith('0')) d = '94' + d.slice(1);
  if (d.length === 9) d = '94' + d;
  return d;
}

// Return the record's share token, creating one if needed
export async function ensureShareToken(supabase, table, row) {
  if (row.share_token) return row.share_token;
  const token = crypto.randomUUID();
  const { error } = await supabase.from(table).update({ share_token: token }).eq('id', row.id);
  if (error) throw error;
  return token;
}

export async function disableShareLink(supabase, table, id) {
  const { error } = await supabase.from(table).update({ share_token: null }).eq('id', id);
  if (error) throw error;
}

export function calcMessage(calc, client, url) {
  const sm = summarizeCalc(calc);
  const isFinal = calc.status === 'final';
  const first = (client?.full_name || '').trim().split(/\s+/).slice(-1)[0] || 'Sir/Madam';
  const lines = [
    `Dear ${first},`,
    '',
    isFinal
      ? `Please find your FINAL ${KIND_LABEL[sm.kind]} for Y/A ${calc.year}.`
      : `Please find the DRAFT ${KIND_LABEL[sm.kind]} for Y/A ${calc.year}${calc.label ? ` (${calc.label})` : ''} for your review.`,
    '',
  ];
  if (sm.assessable != null) lines.push(`Total assessable income: ${rs(sm.assessable)}`);
  if (sm.status === 'instalment') lines.push(`Instalment due: ${rs(sm.amount)}`);
  else lines.push(`${sm.status === 'refund' ? 'Refund due' : 'Tax payable'}: ${rs(sm.amount)}`);
  lines.push('', `View / download PDF: ${url}`, '');
  if (!isFinal) lines.push('Please check the figures and tap "Confirm" or "Request changes" on that page.', '');
  lines.push('Thank you,', FIRM.name, FIRM.phone);
  return lines.join('\n');
}

export function invoiceMessage(inv, url) {
  const c = billTo(inv);
  const first = (c.name || '').trim().split(/\s+/).slice(-1)[0] || 'Sir/Madam';
  return [
    `Dear ${first},`,
    '',
    `Invoice ${inv.invoice_no} dated ${inv.issue_date} for ${rs(inv.total_amount)}${inv.due_date ? ` (due ${inv.due_date})` : ''}.`,
    '',
    `View / download PDF: ${url}`,
    '',
    'Bank transfer details are on the invoice.',
    '',
    'Thank you,', FIRM.name, FIRM.phone,
  ].join('\n');
}

export const whatsappLink = (phone, text) => {
  const n = waNumber(phone);
  return `https://wa.me/${n}?text=${encodeURIComponent(text)}`;
};

export const emailLink = (email, subject, body) =>
  `mailto:${encodeURIComponent(email || '')}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`;
