// ═══════════════════════════════════════════════════════════
//  "Invite friends" messages — WhatsApp formatting (*bold*, _italic_)
//  Three styles the client can pick from. Benefits listed are real app
//  features (free calculator, RAMIS filing, reminders, portal, WhatsApp help).
// ═══════════════════════════════════════════════════════════
import { FIRM } from './iitStatement';

const first = (name) => String(name || '').trim().split(/\s+/)[0] || '';

export const INVITE_STYLES = [
  { key: 'si', label: 'සිංහල + English', hint: 'Best for most friends' },
  { key: 'en', label: 'English', hint: 'For English speakers' },
  { key: 'short', label: 'Short', hint: 'Quick & simple' },
];

/** Build the invite message. style: 'si' | 'en' | 'short' */
export function inviteMessage({ style = 'si', name = '', url = '' } = {}) {
  const me = first(name);
  const firm = FIRM.name || 'TaxMate Solutions';
  if (style === 'en') return [
    `👋 Hi!${me ? ` It's *${me}*.` : ''}`,
    '',
    `I use *${firm}* for my income tax — simple, reliable and done right. Thought you'd find it useful too! 🙌`,
    '',
    '✨ *What you get with the TaxMate app:*',
    '✅ *Free tax calculator* — see your tax in seconds',
    '✅ Tax return prepared & filed in *RAMIS* by experts',
    '✅ *Reminders* before every IRD due date',
    '✅ Your own *secure portal* — documents, computations & invoices on your phone',
    '✅ Friendly *WhatsApp support* when you have a question',
    '',
    '👇 *Register in 2 minutes (free):*',
    url,
    '',
    `_${firm} · Your trusted tax partner in Sri Lanka 🇱🇰_`,
  ].join('\n');

  if (style === 'short') return [
    `Hi! 👋 I sort out my income tax with *${firm}* — easy & trustworthy 👌`,
    '',
    '🧮 Free tax calculator  ·  📲 Own client portal  ·  ⏰ IRD reminders',
    '',
    '👇 Register in 2 minutes:',
    url,
  ].join('\n');

  // default: Sinhala + English
  return [
    `👋 Hi!${me ? ` මම *${me}*.` : ''}`,
    '',
    `මම මගේ income tax වැඩ කරගන්නේ *${firm}* එකෙන්. ලේසියි, විශ්වාසයි 👌 ඔයාටත් ගොඩක් වැදගත් වෙයි කියලා හිතුණා!`,
    '',
    '✨ *TaxMate app එකෙන් ඔයාට ලැබෙන දේ:*',
    '✅ *Free tax calculator* — ඔයාගේ බද්ද තත්පර කිහිපයෙන් බලාගන්න',
    '✅ Tax return එක *RAMIS* එකේ expert කෙනෙක් හදලා file කරනවා',
    '✅ IRD due dates වලට කලින් *reminders*',
    '✅ ඔයාගේම *secure portal* එකක් — documents, computations, invoices phone එකෙන්ම',
    '✅ ප්‍රශ්නයක් ආවොත් *WhatsApp* එකෙන් කෙලින්ම උදව්',
    '',
    '👇 *මිනිත්තු 2න් free register වෙන්න:*',
    url,
    '',
    `_${firm} · Your trusted tax partner in Sri Lanka 🇱🇰_`,
  ].join('\n');
}

/** Same text without WhatsApp markers — for email / other apps that don't format. */
export const plainText = (msg) => msg.replace(/\*([^*\n]+)\*/g, '$1').replace(/(^|\s)_([^_\n]+)_(?=\s|$)/g, '$1$2');

export const inviteSubject = (name) => `${first(name) ? `${first(name)} invited you to ` : 'Try '}${FIRM.name || 'TaxMate Solutions'} — your income tax, sorted`;
