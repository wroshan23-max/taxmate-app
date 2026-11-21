// V69 — Engagement letters: default template, data, printable letter, messages
import { supabase } from './supabase';
import { FIRM } from './firm';

export const BASIS = { once: 'one-time', year: 'per year', month: 'per month', return: 'per return', hour: 'per hour' };

/** Default text. {{client}} {{firm}} are filled in when the letter is made. Review with your lawyer before using. */
export const DEFAULT_TEMPLATE = {
  sections: [
    { h: 'Purpose of this letter', p: 'This letter confirms the services {{firm}} ("we", "us") will provide to {{client}} ("you"), our fees, and how we will work together.' },
    { h: 'Fees and payment', p: 'Our fees are listed above. Invoices are payable within 14 days unless agreed otherwise. Work outside the listed services will be quoted and agreed with you before we start. Taxes, penalties and interest charged by the Inland Revenue Department (IRD) are payable by you.' },
    { h: 'What we need from you', p: 'Please give us complete and accurate information and documents on time, tell us about all your income, assets and any changes, and review and approve drafts before we file. You remain responsible for the accuracy and completeness of the information you give us and for the returns filed in your name.' },
    { h: 'What we will do', p: 'We will prepare your computations and returns from the information you provide, explain them to you, and file them on your instruction before the due date, provided we receive everything in time. We will remind you of deadlines that affect you.' },
    { h: 'Deadlines and penalties', p: 'If information reaches us late or is incomplete, we cannot guarantee filing on time. We are not responsible for penalties or interest that result from late, incomplete or incorrect information.' },
    { h: 'Access to your IRD (RAMIS) account', p: 'If you share your RAMIS login details with us, we will use them only to handle your tax affairs and keep them encrypted. You may change your password at any time.' },
    { h: 'Confidentiality and your information', p: 'We keep your information confidential and store it securely. We share it only with the IRD or others when needed to provide the service, when required by law, or with your consent. You may ask for a copy of your documents at any time.' },
    { h: 'Ending the engagement', p: 'Either of us may end this engagement by written notice (WhatsApp or email is fine). Fees for work already done remain payable.' },
    { h: 'සාරාංශය (සිංහලෙන්)', p: 'මෙම ලිපියෙන් {{firm}} ඔබට ලබා දෙන සේවා, ගාස්තු සහ අප එකට කටයුතු කරන ආකාරය තහවුරු කෙරේ. නිවැරදි තොරතුරු සහ ලේඛන නියමිත වේලාවට ලබා දීම ඔබේ වගකීමයි. ප්‍රමාද වූ හෝ අසම්පූර්ණ තොරතුරු නිසා ඇතිවන දඩ හෝ පොලී සඳහා අප වගකිව යුතු නොවේ. ඔබේ තොරතුරු රහසිගතව සහ ආරක්ෂිතව තබා ගනු ලැබේ. ඕනෑම පාර්ශවයකට ලිඛිතව (WhatsApp / email) දැනුම් දී මෙම එකඟතාව අවසන් කළ හැක.' },
  ],
  consents: [
    { key: 'terms', text: 'I have read and agree to this engagement letter, including the services and fees.', required: true },
    { key: 'data', text: 'TaxMate may keep my documents and information securely and contact me by WhatsApp, phone and email about my tax affairs.', required: true },
    { key: 'ramis', text: 'I authorise TaxMate to use my RAMIS (IRD) login to prepare and file my returns.', required: false },
  ],
};

const fill = (s, client) => String(s || '').replaceAll('{{client}}', client?.full_name || 'the client').replaceAll('{{firm}}', FIRM.name);
export function makeContent({ services, sections, consents, intro, client }) {
  return {
    intro: fill(intro, client),
    services: services.filter((x) => String(x.name || '').trim()).map((x) => ({ name: String(x.name).trim().slice(0, 120), fee: Number(x.fee) || 0, basis: x.basis || 'once', note: String(x.note || '').trim().slice(0, 200) })),
    sections: sections.filter((x) => String(x.p || '').trim()).map((x) => ({ h: String(x.h || '').trim().slice(0, 120), p: fill(x.p, client).slice(0, 4000) })),
    consents: consents.filter((x) => String(x.text || '').trim()).map((x, i) => ({ key: x.key || `c${i + 1}`, text: String(x.text).trim().slice(0, 300), required: !!x.required })),
    firm: { name: FIRM.name, tagline: FIRM.tagline, phone: FIRM.phone, email: FIRM.email, web: FIRM.web, address: FIRM.address, regNo: FIRM.regNo },
  };
}

export async function loadTemplate() {
  const { data } = await supabase.from('app_settings').select('value').eq('key', 'engagement_template').maybeSingle();
  const v = data?.value;
  return v?.sections?.length ? { sections: v.sections, consents: v.consents?.length ? v.consents : DEFAULT_TEMPLATE.consents } : DEFAULT_TEMPLATE;
}
export async function saveTemplate(t) {
  const { error } = await supabase.from('app_settings').upsert({ key: 'engagement_template', value: { sections: t.sections, consents: t.consents }, updated_at: new Date().toISOString() });
  if (error) throw new Error(/row-level security|42501/.test(`${error.code} ${error.message}`) ? 'Only a full admin can change the default template.' : error.message);
}

const err = (e) => new Error(String(e?.message || e).replace(/^.*?ERROR:\s*/, ''));
export async function loadLetters(clientId) {
  const { data, error } = await supabase.from('engagement_letters').select('*').eq('client_id', clientId).order('created_at', { ascending: false });
  if (error) throw err(error);
  return data ?? [];
}
export async function saveDraft(row) {
  const { id, ...r } = row;
  const q = id ? supabase.from('engagement_letters').update(r).eq('id', id) : supabase.from('engagement_letters').insert(r);
  const { data, error } = await q.select().single();
  if (error) throw err(error);
  return data;
}
export async function sendLetter(id) {
  const { data, error } = await supabase.rpc('admin_engagement_send', { p_id: id });
  if (error) throw err(error);
  return data;
}
export async function setLetter(id, patch) {
  const { error } = await supabase.from('engagement_letters').update(patch).eq('id', id);
  if (error) throw err(error);
}
export async function deleteLetter(id) {
  const { error } = await supabase.from('engagement_letters').delete().eq('id', id);
  if (error) throw err(error);
}
export const letterUrl = (token) => `${window.location.origin}/e/${token}`;

export function letterMessage(client, letter, url) {
  const first = String((client?.contact_preferred && client?.contact_name) || client?.full_name || '').trim().split(/\s+/)[0] || 'Sir/Madam';
  return [
    `Dear ${first},`, '',
    `Thank you for choosing ${FIRM.name}. Please read and sign our engagement letter (${letter.letter_no || letter.title}) — it lists the services, fees and how we work together. It takes about a minute:`,
    url, '',
    'කරුණාකර අපගේ සේවා එකඟතා ලිපිය කියවා link එක හරහා online අත්සන් කරන්න.', '',
    'Thank you,', FIRM.name, `WhatsApp ${FIRM.whatsapp}`,
  ].join('\n');
}

// ─── printable letter (also shown on the signing page) ───
const esc = (v) => String(v ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const rs = (v) => `Rs. ${Number(v || 0).toLocaleString('en-LK', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const dt = (d) => (d ? new Date(d).toLocaleString('en-GB', { day: 'numeric', month: 'long', year: 'numeric', hour: 'numeric', minute: '2-digit', timeZone: 'Asia/Colombo' }) : '');
const day = (d) => (d ? new Date(`${String(d).slice(0, 10)}T00:00:00`).toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' }) : '');

/** letter: { letter_no, title, content, status, sent_at, signed_at, signer_name, signer_capacity, signature, consents, valid_until, client } */
export function buildLetterHtml(letter, { toolbar = false, embed = false } = {}) {
  const c = letter.content || {}, f = c.firm || {}, cl = letter.client || {};
  const signed = letter.status === 'signed';
  const svc = c.services || [];
  const total = svc.reduce((a, x) => a + (Number(x.fee) || 0), 0);
  const sameBasis = svc.length && svc.every((x) => x.basis === svc[0].basis);
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${esc(letter.letter_no || letter.title)}</title><style>
  @page{size:A4;margin:16mm} *{box-sizing:border-box} body{font:13px/1.6 'Noto Sans Sinhala','Iskoola Pota',Arial,sans-serif;color:#1f2937;margin:0;${embed ? 'padding:22px;' : ''}}
  ${embed ? '' : '@media screen{body{max-width:820px;margin:0 auto;padding:24px}}'}
  .head{display:flex;justify-content:space-between;gap:16px;border-bottom:3px solid #1e3a8a;padding-bottom:10px;margin-bottom:16px}
  .brand{font:900 22px Arial;color:#1e3a8a}.brand b{color:#d4a017}.tag{font-size:11px;color:#6b7280}.firm{font-size:11px;color:#4b5563;text-align:right}
  h1{font-size:18px;color:#1e3a8a;margin:0 0 2px}.meta{font-size:12px;color:#6b7280;margin-bottom:14px}
  .to{background:#f8fafc;border:1px solid #e5e7eb;border-radius:8px;padding:10px 12px;margin-bottom:14px;font-size:12.5px}
  h2{font-size:14px;color:#1e3a8a;margin:16px 0 4px}p{margin:0 0 6px;white-space:pre-line}
  table{width:100%;border-collapse:collapse;margin:6px 0 4px}th,td{border:1px solid #e5e7eb;padding:6px 8px;text-align:left;font-size:12.5px;vertical-align:top}th{background:#eef2ff;color:#1e3a8a}td.n{text-align:right;white-space:nowrap}
  .cons{margin:14px 0 0;padding:0;list-style:none}.cons li{margin:3px 0}.sig{display:flex;gap:24px;margin-top:18px;page-break-inside:avoid}.sig>div{flex:1;border-top:1px solid #9ca3af;padding-top:6px;font-size:12px}
  .sig img{max-height:70px;max-width:100%;display:block;margin-bottom:4px}.stamp{display:inline-block;border:2px solid #15803d;color:#15803d;font-weight:800;border-radius:6px;padding:2px 10px;transform:rotate(-3deg);margin-bottom:6px}
  .foot{margin-top:20px;font-size:10.5px;color:#9ca3af;border-top:1px solid #e5e7eb;padding-top:6px}
  .bar{position:sticky;top:0;background:#fff;padding:8px 0;text-align:right}.bar button{font:600 13px Arial;background:#1e3a8a;color:#fff;border:0;border-radius:6px;padding:7px 14px;cursor:pointer}
  @media (max-width:560px){body{font-size:14px}.head{flex-direction:column}.firm{text-align:left}.sig{flex-direction:column}}
  @media print{.bar{display:none}}
  </style></head><body>${toolbar ? '<div class="bar"><button onclick="print()">Print / Save as PDF</button></div>' : ''}
  <div class="head"><div><div class="brand">${esc((f.name || FIRM.name).replace(/Mate/, '§')).replace('§', '<b>Mate</b>')}</div><div class="tag">${esc(f.tagline || '')}</div></div>
  <div class="firm">${[f.address, f.phone, f.email, f.web, f.regNo && `Reg. ${f.regNo}`].filter(Boolean).map(esc).join('<br>')}</div></div>
  <h1>${esc(letter.title)}</h1>
  <div class="meta">${[letter.letter_no, letter.sent_at && `Date: ${day(letter.sent_at)}`, letter.valid_until && !signed && `Please sign by ${day(letter.valid_until)}`].filter(Boolean).map(esc).join(' · ')}</div>
  <div class="to"><b>To:</b> ${esc(cl.full_name)}${cl.client_no ? ` (${esc(cl.client_no)})` : ''}${cl.tin ? ` · TIN ${esc(cl.tin)}` : ''}${cl.nic ? ` · NIC ${esc(cl.nic)}` : ''}${cl.address ? `<br>${esc(cl.address)}` : ''}</div>
  ${c.intro ? `<p>${esc(c.intro)}</p>` : ''}
  ${svc.length ? `<h2>Services and fees</h2><table><tr><th>Service</th><th>Basis</th><th style="text-align:right">Fee</th></tr>${svc.map((x) => `<tr><td>${esc(x.name)}${x.note ? `<br><span style="color:#6b7280;font-size:11.5px">${esc(x.note)}</span>` : ''}</td><td>${esc(BASIS[x.basis] || x.basis)}</td><td class="n">${Number(x.fee) ? rs(x.fee) : 'Included / to be quoted'}</td></tr>`).join('')}${svc.length > 1 && sameBasis ? `<tr><th colspan="2">Total ${esc(BASIS[svc[0].basis] || '')}</th><th class="n" style="text-align:right">${rs(total)}</th></tr>` : ''}</table>` : ''}
  ${(c.sections || []).map((s) => `${s.h ? `<h2>${esc(s.h)}</h2>` : ''}<p>${esc(s.p)}</p>`).join('')}
  ${(c.consents || []).length ? `<h2>Confirmations</h2><ul class="cons">${c.consents.map((k) => `<li>${signed ? (letter.consents?.[k.key] ? '☑' : '☐') : '☐'} ${esc(k.text)}${k.required ? '' : ' <i style="color:#9ca3af">(optional)</i>'}</li>`).join('')}</ul>` : ''}
  <div class="sig">
    <div>${signed ? `<div class="stamp">SIGNED ONLINE</div>${letter.signature ? `<img src="${esc(letter.signature)}" alt="signature">` : ''}<b>${esc(letter.signer_name)}</b>${letter.signer_capacity ? ` — ${esc(letter.signer_capacity)}` : ''}<br>${esc(dt(letter.signed_at))}` : '<br><br>Client signature'}<br><span style="color:#6b7280">For ${esc(cl.full_name)}</span></div>
    <div>${letter.content?.firm_signature ? `<img src="${esc(letter.content.firm_signature)}" alt="">` : '<br><br>'}<b>${esc(f.name || FIRM.name)}</b><br><span style="color:#6b7280">Authorised signatory</span></div>
  </div>
  <div class="foot">${signed ? `Signed online through the ${esc(f.name || FIRM.name)} client portal on ${esc(dt(letter.signed_at))}. ` : ''}${esc(letter.letter_no || '')}</div>
  </body></html>`;
}
export function openLetter(letter) {
  const w = window.open('', '_blank');
  const html = buildLetterHtml(letter, { toolbar: true });
  if (!w) { const b = new Blob([html], { type: 'text/html' }); window.open(URL.createObjectURL(b), '_blank'); return; }
  w.document.open(); w.document.write(html); w.document.close();
}
