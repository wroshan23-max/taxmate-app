// ═══════════════════════════════════════════════════════════
//  TaxMate — Statement of Assets & Liabilities (per client, per Y/A)
//  Sections follow the TaxMate A&L client form (Excel) and the IRD
//  Return of Income headings: immovable property (in / outside Sri
//  Lanka), motor vehicles, deposits, shares, cash, loans given,
//  jewellery, other movables, business interests, liabilities, and
//  assets acquired / disposed during the year.
//  Values are for disclosure to the IRD only — not used to compute tax.
// ═══════════════════════════════════════════════════════════
import { FIRM } from './iitStatement';

// ─── Years ───────────────────────────────────────────────
// Y/A runs 1 April → 31 March. '2025/26' = 1 Apr 2025 – 31 Mar 2026.
export function yearInfo(year) {
  const start = parseInt(String(year || '').slice(0, 4), 10) || new Date().getFullYear();
  return {
    start, end: start + 1,
    asAt: `31 March ${start + 1}`,
    period: `1 April ${start} – 31 March ${start + 1}`,
    periodShort: `1 Apr ${start} – 31 Mar ${start + 1}`,
  };
}
export const yearLabel = (start) => `${start}/${String(start + 1).slice(2)}`;
export const prevYearOf = (year) => yearLabel(yearInfo(year).start - 1);
// The Y/A whose return is being filed now (ended on the last 31 March)
export function filingYear(d = new Date()) {
  const y = d.getFullYear();
  return yearLabel(d.getMonth() >= 3 ? y - 1 : y - 2);
}
export function alYears(d = new Date()) {
  const cur = yearInfo(filingYear(d)).start + 1;      // current (running) Y/A
  const out = [];
  for (let s = cur; s >= 2022; s--) out.push(yearLabel(s));
  return out;
}

// ─── Section definitions ─────────────────────────────────
// col.type: text | select | money | year | date ; col.wide spans 2 columns on wide screens
const VALUE = { key: 'value', en: 'Cost or market value (Rs.)', si: 'පිරිවැය / වෙළඳපොළ වටිනාකම (රු.)', type: 'money', required: true };

export const SECTIONS = [
  {
    key: 'immovable', part: 1, group: 'asset', code: 'A',
    en: 'Immovable Property', si: 'නිශ්චල දේපල',
    help: 'Land, houses, apartments, buildings and estates you owned on 31 March — in or outside Sri Lanka.',
    helpSi: 'මාර්තු 31 දිනට ඔබ සතු ඉඩම්, නිවාස, මහල් නිවාස, ගොඩනැගිලි, වතු (ශ්‍රී ලංකාව තුළ හෝ පිටත).',
    add: 'Add property', title: (r) => [r.type, r.location].filter(Boolean).join(' — '),
    cols: [
      { key: 'type', en: 'Type', si: 'වර්ගය', type: 'select', required: true, options: ['Land', 'House & land', 'House', 'Apartment / Condominium', 'Building', 'Estate / Plantation', 'Other'] },
      { key: 'situated', en: 'Situated', si: 'පිහිටා ඇත්තේ', type: 'select', options: ['Sri Lanka', 'Outside Sri Lanka'], default: 'Sri Lanka' },
      { key: 'location', en: 'Location / address', si: 'පිහිටීම / ලිපිනය', type: 'text', required: true, wide: true, placeholder: 'No. 12, Temple Rd, Nugegoda' },
      { key: 'extent', en: 'Extent (perches / acres)', si: 'ප්‍රමාණය', type: 'text', placeholder: '10 perches' },
      { key: 'deed', en: 'Deed / Reg. No.', si: 'ඔප්පු අංකය', type: 'text', placeholder: 'B 4521' },
      { key: 'ownership', en: 'Ownership %', si: 'හිමිකම %', type: 'text', default: '100%' },
      { key: 'acquired', en: 'Date acquired', si: 'අත්පත් කරගත් දිනය', type: 'date' },
      VALUE,
    ],
  },
  {
    key: 'vehicles', part: 1, group: 'asset', code: 'B1',
    en: 'Motor Vehicles', si: 'මෝටර් වාහන',
    help: 'Cars, vans, cabs, motorcycles, three-wheelers, lorries etc. registered in your name.',
    helpSi: 'ඔබගේ නමින් ලියාපදිංචි මෝටර් රථ, වෑන්, කැබ්, යතුරුපැදි, ත්‍රීරෝද රථ, ලොරි ආදිය.',
    add: 'Add vehicle', title: (r) => [r.make, r.regno].filter(Boolean).join(' · ') || r.type,
    cols: [
      { key: 'type', en: 'Type', si: 'වර්ගය', type: 'select', required: true, options: ['Car', 'Van', 'SUV / Jeep', 'Double cab / Single cab', 'Motorcycle', 'Three-wheeler', 'Lorry', 'Bus', 'Tractor', 'Other'] },
      { key: 'make', en: 'Make & model', si: 'නිෂ්පාදකයා හා මාදිලිය', type: 'text', required: true, placeholder: 'Toyota Axio' },
      { key: 'regno', en: 'Registration No.', si: 'ලියාපදිංචි අංකය', type: 'text', required: true, placeholder: 'CAB-1234', upper: true },
      { key: 'mfg_year', en: 'Year of manufacture', si: 'නිෂ්පාදිත වර්ෂය', type: 'year', required: true, placeholder: '2019' },
      { key: 'acquired', en: 'Date acquired', si: 'මිලදී ගත් දිනය', type: 'date' },
      { ...VALUE, en: 'Cost or value (Rs.)', si: 'පිරිවැය / වටිනාකම (රු.)' },
    ],
  },
  {
    key: 'deposits', part: 1, group: 'asset', code: 'B2',
    en: 'Bank & Financial Institution Deposits', si: 'බැංකු හා මූල්‍ය ආයතන තැන්පතු',
    help: 'Savings, current, fixed and foreign-currency accounts — balance on 31 March.',
    helpSi: 'ඉතිරි කිරීම්, ජංගම, ස්ථාවර හා විදේශ මුදල් ගිණුම් — මාර්තු 31 ශේෂය.',
    add: 'Add account', title: (r) => [r.bank, r.type, r.acno && `…${r.acno}`].filter(Boolean).join(' · '),
    cols: [
      { key: 'bank', en: 'Bank / institution', si: 'බැංකුව / ආයතනය', type: 'text', required: true, placeholder: 'Bank of Ceylon' },
      { key: 'type', en: 'Account type', si: 'ගිණුම් වර්ගය', type: 'select', required: true, options: ['Savings', 'Current', 'Fixed deposit', 'Foreign currency', 'Other'] },
      { key: 'acno', en: 'A/C No. (last 4 digits)', si: 'ගිණුම් අංකය (අවසන් ඉලක්කම් 4)', type: 'text', placeholder: '4587', maxLength: 6 },
      { ...VALUE, en: 'Balance on 31 March (Rs.)', si: 'මාර්තු 31 ශේෂය (රු.)' },
    ],
  },
  {
    key: 'shares', part: 1, group: 'asset', code: 'B3',
    en: 'Shares, Unit Trusts, Securities & Debentures', si: 'කොටස්, ඒකක භාර, සුරැකුම්පත් හා ණයකර',
    add: 'Add investment', title: (r) => r.company,
    cols: [
      { key: 'company', en: 'Company / instrument', si: 'සමාගම / උපකරණය', type: 'text', required: true, wide: true, placeholder: 'John Keells Holdings PLC' },
      { key: 'units', en: 'No. of shares / units', si: 'කොටස් / ඒකක ගණන', type: 'text', placeholder: '1,000' },
      { ...VALUE, en: 'Value (Rs.)', si: 'වටිනාකම (රු.)' },
    ],
  },
  {
    key: 'cash', part: 1, group: 'asset', code: 'B4',
    en: 'Cash in Hand', si: 'අත ඉතිරි මුදල්',
    help: 'Total cash you held (not in a bank) on 31 March.',
    helpSi: 'මාර්තු 31 දිනට අත ඇති මුළු මුදල (බැංකුවේ නොවන).',
    add: 'Add cash', single: true, title: () => 'Cash in hand',
    cols: [
      { key: 'note', en: 'Note (optional)', si: 'සටහන', type: 'text', wide: true, placeholder: 'Cash at home' },
      { ...VALUE, en: 'Amount (Rs.)', si: 'මුදල (රු.)' },
    ],
  },
  {
    key: 'loans_given', part: 1, group: 'asset', code: 'B5',
    en: 'Loans Given & Amounts Receivable', si: 'ලබා දුන් ණය හා ලැබිය යුතු මුදල්',
    add: 'Add loan given', title: (r) => r.party,
    cols: [
      { key: 'party', en: 'Name of person / party', si: 'පුද්ගලයාගේ / පාර්ශවයේ නම', type: 'text', required: true, placeholder: 'K. Perera' },
      { key: 'nature', en: 'Nature', si: 'ස්වභාවය', type: 'text', placeholder: 'Personal loan given' },
      { ...VALUE, en: 'Amount receivable (Rs.)', si: 'ලැබිය යුතු මුදල (රු.)' },
    ],
  },
  {
    key: 'jewellery', part: 1, group: 'asset', code: 'B6',
    en: 'Gold, Silver, Gems & Jewellery', si: 'රන්, රිදී, මැණික් හා ස්වර්ණාභරණ',
    add: 'Add item', title: (r) => r.description,
    cols: [
      { key: 'description', en: 'Description', si: 'විස්තරය', type: 'text', required: true, wide: true, placeholder: 'Gold jewellery ~50g' },
      { ...VALUE, en: 'Estimated value (Rs.)', si: 'ඇස්තමේන්තු වටිනාකම (රු.)' },
    ],
  },
  {
    key: 'other', part: 1, group: 'asset', code: 'B7',
    en: 'Other Movable Assets', si: 'වෙනත් චංචල වත්කම්',
    add: 'Add asset', title: (r) => r.description,
    cols: [
      { key: 'description', en: 'Description', si: 'විස්තරය', type: 'text', required: true, wide: true, placeholder: 'Machinery / equipment' },
      { ...VALUE, en: 'Value (Rs.)', si: 'වටිනාකම (රු.)' },
    ],
  },
  {
    key: 'business', part: 1, group: 'asset', code: 'C',
    en: 'Business Interests', si: 'ව්‍යාපාරික දේපල',
    help: 'Your capital and current account balances in a business or partnership on 31 March. Please also send us the latest balance sheet.',
    helpSi: 'ව්‍යාපාරයක් / හවුල් ව්‍යාපාරයක ප්‍රාග්ධන හා ජංගම ගිණුම් ශේෂ. නවතම ශේෂ පත්‍රයද එවන්න.',
    add: 'Add business', title: (r) => r.name,
    cols: [
      { key: 'name', en: 'Business name', si: 'ව්‍යාපාරයේ නම', type: 'text', required: true, placeholder: 'ABC Traders' },
      { key: 'nature', en: 'Nature', si: 'ස්වභාවය', type: 'select', options: ['Sole proprietor', 'Partnership', 'Other'] },
      { key: 'capital', en: 'Capital A/C balance (Rs.)', si: 'ප්‍රාග්ධන ගිණුම් ශේෂය (රු.)', type: 'money', required: true, negative: true },
      { key: 'current', en: 'Current A/C balance (Rs.)', si: 'ජංගම ගිණුම් ශේෂය (රු.)', type: 'money', negative: true },
    ],
  },
  {
    key: 'liabilities', part: 1, group: 'liability', code: 'D',
    en: 'Liabilities', si: 'බැරකම්',
    help: 'All money you owed on 31 March — bank loans, leases, mortgages, personal loans, credit cards, pawning etc.',
    helpSi: 'මාර්තු 31 දිනට ඔබ ගෙවිය යුතු සියලු ණය — බැංකු ණය, ලීසිං, උකස්, පුද්ගලික ණය, ණය පත් ආදිය.',
    add: 'Add liability', title: (r) => [r.type, r.lender].filter(Boolean).join(' — '),
    cols: [
      { key: 'type', en: 'Type', si: 'වර්ගය', type: 'select', required: true, options: ['Bank loan', 'Housing loan', 'Lease', 'Mortgage', 'Personal loan', 'Credit card', 'Pawning', 'Other'] },
      { key: 'lender', en: 'Lender / institution', si: 'ණය දෙන්නා / ආයතනය', type: 'text', required: true, placeholder: 'Sampath Bank' },
      { key: 'purpose', en: 'Purpose', si: 'අරමුණ', type: 'text', placeholder: 'Housing loan' },
      { ...VALUE, en: 'Outstanding on 31 March (Rs.)', si: 'මාර්තු 31 ගෙවීමට ඇති ශේෂය (රු.)' },
    ],
  },
  {
    key: 'acquired', part: 2, group: 'change', code: '2A',
    en: 'Assets Acquired or Gifts Received during the year', si: 'වර්ෂය තුළ අත්පත් කරගත් වත්කම් / ලැබූ තෑගි',
    help: 'Anything you bought, built, inherited or received as a gift during the year.',
    helpSi: 'වර්ෂය තුළ ඔබ මිලදී ගත්, ඉදිකළ, උරුම වූ හෝ තෑග්ගක් ලෙස ලැබූ ඕනෑම දෙයක්.',
    add: 'Add acquisition', title: (r) => r.description,
    cols: [
      { key: 'description', en: 'Description of asset', si: 'වත්කමේ විස්තරය', type: 'text', required: true, wide: true, placeholder: 'Land 15 perches' },
      { key: 'date', en: 'Date', si: 'දිනය', type: 'date', required: true },
      { key: 'mode', en: 'Acquired how?', si: 'ලැබුණු ආකාරය', type: 'select', required: true, options: ['Purchased', 'Built / constructed', 'Gift received', 'Inherited', 'Other'] },
      { ...VALUE, en: 'Value (Rs.)', si: 'වටිනාකම (රු.)' },
      { key: 'source', en: 'Source of funds', si: 'අරමුදල් මූලාශ්‍රය', type: 'text', wide: true, placeholder: 'Bank loan + savings' },
    ],
  },
  {
    key: 'disposed', part: 2, group: 'change', code: '2B',
    en: 'Assets Disposed / Sold during the year (incl. shares)', si: 'වර්ෂය තුළ බැහැර කළ / විකුණූ වත්කම් (කොටස් ඇතුළුව)',
    help: 'Anything you sold, exchanged or gave away during the year.',
    helpSi: 'වර්ෂය තුළ ඔබ විකුණූ, හුවමාරු කළ හෝ තෑගි කළ ඕනෑම දෙයක්.',
    add: 'Add disposal', title: (r) => r.description,
    cols: [
      { key: 'description', en: 'Description of asset', si: 'වත්කමේ විස්තරය', type: 'text', required: true, wide: true, placeholder: 'Motorbike' },
      { key: 'date', en: 'Date', si: 'දිනය', type: 'date', required: true },
      { key: 'mode', en: 'Mode', si: 'ආකාරය', type: 'select', required: true, options: ['Sale', 'Exchange', 'Gift given', 'Other'] },
      { ...VALUE, en: 'Sale / disposal value (Rs.)', si: 'විකුණූ / බැහැර කළ වටිනාකම (රු.)' },
    ],
  },
];
export const SECTION = Object.fromEntries(SECTIONS.map(s => [s.key, s]));
export const moneyCols = (s) => s.cols.filter(c => c.type === 'money');

// ─── Numbers ─────────────────────────────────────────────
export const num = (v) => {
  if (v === null || v === undefined || v === '') return 0;
  const n = Number(String(v).replace(/[,\s]/g, ''));
  return Number.isFinite(n) ? n : 0;
};
export const fmtMoney = (n) => Number(n || 0).toLocaleString('en-LK', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

// ─── Rows ────────────────────────────────────────────────
const rid = () => Math.random().toString(36).slice(2, 10);
export function newRow(section) {
  const r = { _id: rid() };
  for (const c of section.cols) r[c.key] = c.default ?? '';
  return r;
}
export function isRowEmpty(section, row) {
  return section.cols.every(c => {
    const v = row?.[c.key];
    return v === undefined || v === null || String(v).trim() === '' || (c.default && v === c.default);
  });
}
export const rowsOf = (data, key) => Array.isArray(data?.[key]) ? data[key] : [];

export function emptyData() {
  return Object.fromEntries(SECTIONS.map(s => [s.key, []]));
}

// Totals for every section + summary
export function totals(data) {
  const t = {};
  for (const s of SECTIONS) {
    const rows = rowsOf(data, s.key);
    if (s.key === 'business') {
      t.business_capital = rows.reduce((a, r) => a + num(r.capital), 0);
      t.business_current = rows.reduce((a, r) => a + num(r.current), 0);
      t.business = t.business_capital + t.business_current;
    } else {
      t[s.key] = rows.reduce((a, r) => a + num(r.value), 0);
    }
  }
  t.assets = SECTIONS.filter(s => s.group === 'asset').reduce((a, s) => a + (t[s.key] || 0), 0);
  t.liabilities_total = t.liabilities || 0;
  t.net = t.assets - t.liabilities_total;
  t.count = SECTIONS.reduce((a, s) => a + rowsOf(data, s.key).filter(r => !isRowEmpty(s, r)).length, 0);
  return t;
}

// Next year's sheet starts from last year's Part 1 (assets & liabilities owned on 31 March).
// Part 2 (bought / sold during the year) always starts empty.
export function carryForward(prevData, prevYear) {
  const out = emptyData();
  if (!prevData) return out;
  for (const s of SECTIONS) {
    if (s.part !== 1) continue;
    out[s.key] = rowsOf(prevData, s.key).filter(r => !isRowEmpty(s, r)).map(r => {
      const prev = {};
      for (const c of moneyCols(s)) prev[c.key] = num(r[c.key]);
      const copy = { ...r, _id: rid(), _cf: prevYear, _prev: prev };
      return copy;
    });
  }
  const pt = totals(prevData);
  out._meta = { prev_year: prevYear, prev_totals: { assets: pt.assets, liabilities: pt.liabilities_total, net: pt.net } };
  return out;
}

// Remove blank rows before saving
export function cleanData(data) {
  const out = { ...data };
  for (const s of SECTIONS) out[s.key] = rowsOf(data, s.key).filter(r => !isRowEmpty(s, r));
  return out;
}

// Check before submit. Returns [{ section, index, msg }]
export function validate(data, year) {
  const errs = [];
  const { end } = yearInfo(year);
  for (const s of SECTIONS) {
    rowsOf(data, s.key).forEach((r, i) => {
      if (isRowEmpty(s, r)) return;
      for (const c of s.cols) {
        const v = r[c.key];
        const blank = v === undefined || v === null || String(v).trim() === '';
        if (c.required && blank) { errs.push({ section: s.key, index: i, col: c.key, msg: `${c.en} is required` }); continue; }
        if (blank) continue;
        if (c.type === 'money') {
          const n = Number(String(v).replace(/[,\s]/g, ''));
          if (!Number.isFinite(n)) errs.push({ section: s.key, index: i, col: c.key, msg: `${c.en}: enter a number` });
          else if (n < 0 && !c.negative) errs.push({ section: s.key, index: i, col: c.key, msg: `${c.en} cannot be negative` });
        }
        if (c.type === 'year') {
          const y = parseInt(v, 10);
          if (!/^\d{4}$/.test(String(v).trim()) || y < 1940 || y > end) errs.push({ section: s.key, index: i, col: c.key, msg: `${c.en}: enter a 4-digit year (1940–${end})` });
        }
      }
    });
  }
  return errs;
}

// ─── Print / PDF ─────────────────────────────────────────
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const fmtD = (d) => d ? new Date(d).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' }) : '';

const CSS = `<style>
*{box-sizing:border-box;margin:0;padding:0}
body{font-family:'Segoe UI','Iskoola Pota','Noto Sans Sinhala',Arial,sans-serif;font-size:11px;color:#2c3e50;background:#fff;padding:0 8mm;-webkit-print-color-adjust:exact;print-color-adjust:exact}
@page{size:A4;margin:11mm 12mm}
@media print{.no-print{display:none!important}body{padding:0}}
.sh{display:flex;justify-content:space-between;align-items:flex-start;padding:12px 0 10px;border-bottom:2.5px solid #1B4F72;margin-bottom:10px}
.bn{font-size:20px;font-weight:900;color:#1B4F72}.bn span{color:#E67E22}.bt{font-size:9px;color:#777;margin-top:2px}
.sc{text-align:right;font-size:9px;color:#555;line-height:1.7}
.tb{background:linear-gradient(135deg,#1B4F72 0%,#2980B9 100%);color:#fff;padding:9px 16px;border-radius:7px;margin-bottom:10px;display:flex;justify-content:space-between;align-items:center;gap:10px}
.tt{font-size:15px;font-weight:900}.ts{font-size:9px;opacity:.85;margin-top:2px}
.yb{background:rgba(255,255,255,.2);border:1px solid rgba(255,255,255,.4);border-radius:18px;padding:5px 14px;font-size:12px;font-weight:900;white-space:nowrap}
.ct{width:100%;border-collapse:collapse;margin-bottom:8px;border:1px solid #ddd}
.ct td{padding:4px 10px;border-bottom:1px solid #eee;vertical-align:top;width:25%}
.lb{font-size:7.5px;text-transform:uppercase;letter-spacing:.6px;color:#888;font-weight:700}.vl{font-size:11px;font-weight:700;color:#1B4F72}
.pt{font-size:11px;font-weight:900;color:#1B4F72;margin:12px 0 4px;letter-spacing:.3px}
.ph{background:#1B4F72;color:#fff;padding:5px 10px;font-size:9.5px;font-weight:800;margin:8px 0 0;border-radius:3px 3px 0 0;page-break-after:avoid;display:flex;justify-content:space-between}
.ph i{font-style:normal;opacity:.75;font-weight:600}
table.d{width:100%;border-collapse:collapse;border:1px solid #ddd;border-top:none;page-break-inside:auto}
table.d th{background:#EBF5FB;color:#1B4F72;padding:4px 7px;font-size:8.5px;font-weight:800;text-align:left;border-bottom:1px solid #d6e4f0}
table.d td{padding:4px 7px;border-bottom:1px solid #f0f0f0;font-size:10px;vertical-align:top}
table.d tr{page-break-inside:avoid}
table.d .r{text-align:right;white-space:nowrap}table.d .n{width:22px;color:#999}
table.d .tot td{font-weight:900;color:#1B4F72;border-top:1.5px solid #1B4F72;background:#f7fbfe}
table.d .nil td{color:#aaa;font-style:italic}
.cf{font-size:8px;color:#888}
.sum{width:100%;border-collapse:collapse;border:1px solid #ddd;margin-top:8px}
.sum td{padding:4px 10px;border-bottom:1px solid #f0f0f0;font-size:10.5px}.sum .r{text-align:right;font-weight:700;white-space:nowrap}
.sum .hd td{background:#1B4F72;color:#fff;font-weight:800;font-size:9.5px}
.sum .tot td{font-weight:900;color:#1B4F72;border-top:2px solid #1B4F72;background:#EBF5FB;font-size:11.5px}
.sum .nw td{font-weight:900;color:#fff;background:#E67E22;font-size:12.5px}
.nt{background:#f7f9fb;border:1px solid #e3e8ee;border-radius:5px;padding:7px 10px;font-size:10px;margin-top:8px;white-space:pre-wrap}
.dc{background:#FEF9E7;border:1px solid #F0E68C;border-radius:5px;padding:7px 10px;font-size:8.5px;color:#7D6608;margin-top:10px;line-height:1.6}
.pr{display:flex;justify-content:space-between;align-items:flex-end;margin-top:12px;border-top:1px dashed #ccc;padding-top:8px;page-break-inside:avoid}
.sg{border-top:1px solid #999;width:170px;padding-top:3px;font-size:8.5px;color:#777;margin-top:24px}
.fb{text-align:right;font-size:9px;color:#1B4F72}.fb strong{font-size:12px;font-weight:900;display:block}
.vs{border-radius:6px;padding:6px 12px;font-size:9.5px;font-weight:700;margin:0 0 8px}
.vs.drf{background:#FDEDEC;border:1px solid #F5B7B1;color:#922B21}.vs.sub{background:#EBF5FB;border:1px solid #AED6F1;color:#1B4F72}.vs.fin{background:#E9F7EF;border:1px solid #A9DFBF;color:#1E8449}
.bar{position:sticky;top:0;background:#fff;padding:10px 0;display:flex;gap:8px;justify-content:center;border-bottom:1px solid #eee;margin-bottom:8px}
.pbt{background:#1B4F72;color:#fff;border:none;border-radius:6px;padding:9px 26px;font-size:12px;font-weight:700;cursor:pointer;font-family:inherit}
</style>`;

function cell(c, r) {
  const v = r[c.key];
  if (c.type === 'money') return `<td class="r">${String(v ?? '').trim() === '' ? '—' : fmtMoney(num(v))}</td>`;
  if (c.type === 'date') return `<td>${esc(fmtD(v))}</td>`;
  return `<td>${esc(v)}</td>`;
}

function sectionTable(s, data, clean = false) {
  const rows = rowsOf(data, s.key).filter(r => !isRowEmpty(s, r));
  const t = totals(data);
  const money = moneyCols(s);
  const textCols = s.cols.filter(c => c.type !== 'money');
  const total = s.key === 'business' ? t.business : t[s.key];
  const head = `<div class="ph"><span>${esc(s.code)}. ${esc(s.en)}</span>${clean ? '' : `<i>${esc(s.si)}</i>`}</div>`;
  const th = `<tr><th class="n">#</th>${textCols.map(c => `<th>${esc(c.en)}</th>`).join('')}${money.map(c => `<th class="r">${esc(c.en)}</th>`).join('')}</tr>`;
  if (!rows.length) return `${head}<table class="d">${th}<tr class="nil"><td class="n"></td><td colspan="${textCols.length + money.length}">Nil</td></tr></table>`;
  const body = rows.map((r, i) => `<tr><td class="n">${i + 1}</td>${textCols.map(c => cell(c, r)).join('')}${money.map(c => cell(c, r)).join('')}</tr>`).join('');
  const totRow = s.key === 'business'
    ? `<tr class="tot"><td></td><td colspan="${textCols.length}">Total</td><td class="r">${fmtMoney(t.business_capital)}</td><td class="r">${fmtMoney(t.business_current)}</td></tr>`
    : `<tr class="tot"><td></td><td colspan="${textCols.length}">Total</td><td class="r">${fmtMoney(total)}</td></tr>`;
  return `${head}<table class="d">${th}${body}${totRow}</table>`;
}

// stmt: { year, status, data, client_note, submitted_at, reviewed_at, updated_at }
// client: { full_name, tin, nic, address, mobile, email }
// clean: plain statement for uploading to IRD with the return — no TaxMate branding, status strip,
// client note, Sinhala headings or firm footer (admin only).
const CLEAN_CSS = `<style>
.sh{display:none}
.tb{background:#fff!important;color:#111;border:1.5px solid #111;border-radius:0}
.tb .yb{background:#fff;border-color:#111;color:#111}.tb .ts{opacity:1;color:#333}
.vl,.pt,.fb,table.d .tot td,.sum .tot td{color:#111!important}
.ph,.sum .hd td{background:#333!important}
table.d th{background:#f2f2f2;color:#111;border-bottom-color:#ccc}
table.d .tot td{border-top-color:#111;background:#f7f7f7}
.sum .tot td{border-top-color:#111;background:#f2f2f2}
.sum .nw td{background:#111!important;color:#fff}
.dc{background:#fff;border-color:#ccc;color:#444}
.pbt{background:#111}
</style>`;

export function buildAssetStatementHtml(stmt, client = {}, { withToolbar = true, clean = false } = {}) {
  const data = stmt.data || {};
  const y = yearInfo(stmt.year);
  const t = totals(data);
  const title = `${clean ? 'Statement_of_Assets_and_Liabilities' : 'Assets_Liabilities'}_${String(stmt.year || '').replace('/', '-')}_${(client.full_name || 'Client').trim().replace(/\s+/g, '_')}`;
  const strip = stmt.status === 'reviewed'
    ? `<div class="vs fin">&#10004; Reviewed by ${esc(FIRM.name)}${stmt.reviewed_at ? ` on ${fmtD(stmt.reviewed_at)}` : ''}</div>`
    : stmt.status === 'submitted'
      ? `<div class="vs sub">&#10004; Submitted by the client${stmt.submitted_at ? ` on ${fmtD(stmt.submitted_at)}` : ''} — pending review by ${esc(FIRM.name)}</div>`
      : `<div class="vs drf">&#9998; DRAFT — not yet submitted. Figures may change.</div>`;
  const header = `${clean ? '' : `<div class="sh"><div><div class="bn">Tax<span>Mate</span> Solutions</div><div class="bt">${esc(FIRM.tagline)}</div></div>
    <div class="sc">${esc(FIRM.email)}<br>${esc(FIRM.phone)}${FIRM.whatsapp && FIRM.whatsapp !== FIRM.phone ? ` · WhatsApp ${esc(FIRM.whatsapp)}` : ''}<br>${esc(FIRM.web)}${FIRM.address ? `<br>${esc(FIRM.address)}` : ''}</div></div>`}
    <div class="tb"><div><div class="tt">Statement of Assets &amp; Liabilities</div><div class="ts">${clean ? '' : 'වත්කම් හා බැරකම් ප්‍රකාශය &nbsp;|&nbsp; '}As at ${y.asAt} &nbsp;|&nbsp; Return of Income — Inland Revenue Act No. 24 of 2017</div></div><div class="yb">Y/A ${esc(stmt.year)}</div></div>`;
  const ct = `<table class="ct"><tr>
      <td><div class="lb">Name</div><div class="vl">${esc(client.full_name || '—')}</div></td>
      <td><div class="lb">TIN</div><div class="vl">${esc(client.tin || '—')}</div></td>
      <td><div class="lb">NIC</div><div class="vl">${esc(client.nic || '—')}</div></td>
      <td><div class="lb">Values as at</div><div class="vl">${y.asAt}</div></td></tr>
    <tr><td colspan="2"><div class="lb">Address</div><div class="vl">${esc(client.address || '—')}</div></td>
      <td><div class="lb">Mobile</div><div class="vl">${esc(client.mobile || '—')}</div></td>
      <td><div class="lb">Email</div><div class="vl">${esc(client.email || '—')}</div></td></tr></table>`;

  const part1 = SECTIONS.filter(s => s.part === 1).map(s => sectionTable(s, data, clean)).join('');
  const part2 = SECTIONS.filter(s => s.part === 2).map(s => sectionTable(s, data, clean)).join('');
  const prev = data._meta?.prev_totals;
  const line = (l, v, cls = '') => `<tr class="${cls}"><td>${l}</td><td class="r">${v}</td></tr>`;
  const summary = `<table class="sum">
    <tr class="hd"><td>SUMMARY — NET WORTH${clean ? '' : ' &nbsp;·&nbsp; සාරාංශය — ශුද්ධ වත්කම'}</td><td class="r">Rs.</td></tr>
    ${SECTIONS.filter(s => s.group === 'asset' && s.key !== 'business').map(s => line(`${esc(s.code)}. ${esc(s.en)}`, fmtMoney(t[s.key]))).join('')}
    ${line('C. Business — capital account', fmtMoney(t.business_capital))}
    ${line('C. Business — current account', fmtMoney(t.business_current))}
    ${line(clean ? 'TOTAL ASSETS' : 'TOTAL ASSETS · මුළු වත්කම්', fmtMoney(t.assets), 'tot')}
    ${line(clean ? 'D. TOTAL LIABILITIES' : 'D. TOTAL LIABILITIES · මුළු බැරකම්', `(${fmtMoney(t.liabilities_total)})`, 'tot')}
    ${line(`NET WORTH as at ${y.asAt}`, fmtMoney(t.net), 'nw')}
    ${prev ? line(`Net worth as at 31 March ${y.start} (Y/A ${esc(data._meta.prev_year)})`, fmtMoney(prev.net)) + line('Change in net worth', fmtMoney(t.net - prev.net)) : ''}
    ${line(`During the year — assets acquired / gifts received`, fmtMoney(t.acquired))}
    ${line(`During the year — assets disposed / sold`, fmtMoney(t.disposed))}
  </table>`;
  const note = stmt.client_note && !clean ? `<div class="nt"><b>Client note:</b> ${esc(stmt.client_note)}</div>` : '';
  const bar = withToolbar ? '<div class="bar no-print"><button class="pbt" onclick="window.print()">&#128424; Print / Save as PDF</button></div>' : '';
  return `<!DOCTYPE html><html lang="en"><head><meta charset="UTF-8"><title>${esc(title)}</title>${CSS}${clean ? CLEAN_CSS : ''}</head><body>${bar}${clean ? '' : strip}${header}${ct}
    <div class="pt">PART 1 — ASSETS &amp; LIABILITIES AS AT ${y.asAt.toUpperCase()}</div>${part1}
    ${summary}
    <div class="pt">PART 2 — CHANGES DURING THE YEAR (${y.period.toUpperCase()})</div>${part2}
    ${note}
    <div class="dc">Values are cost or market value in Sri Lankan Rupees, as declared by the taxpayer, of assets held in or outside Sri Lanka. This statement is for disclosure with the Return of Income to the Inland Revenue Department and is not used to compute income tax.</div>
    <div class="pr"><div><div class="sg">Signature of taxpayer &nbsp;·&nbsp; Date</div></div>
    ${clean ? '' : `<div class="fb"><strong>${esc(FIRM.name)}</strong>${esc(FIRM.web)} · ${esc(FIRM.phone)}</div>`}</div>
    </body></html>`;
}

export function openAssetStatement(stmt, client = {}, win = null, opts = {}) {
  const w = win || window.open('', '_blank', 'width=920,height=900');
  if (!w) return false;
  w.document.open();
  w.document.write(buildAssetStatementHtml(stmt, client, opts));
  w.document.close();
  w.focus();
  return true;
}

// ─── Messages ────────────────────────────────────────────
export function alRequestMessage({ name, year, url, prefilled = false }) {
  const first = (name || '').trim().split(/\s+/).slice(-1)[0] || '';
  const y = yearInfo(year);
  const en = prefilled
    ? "Please sign in, check last year's details we have already filled in, update any changes and press Submit:"
    : 'Please sign in, fill in your assets and liabilities and press Submit:';
  const si = prefilled
    ? 'පසුගිය වසරේ විස්තර දැනටමත් පුරවා ඇත — වෙනස්කම් යාවත්කාලීන කර Submit කරන්න.'
    : 'කරුණාකර ඔබගේ වත්කම් හා බැරකම් පුරවා Submit කරන්න.';
  return `Dear ${first || 'Sir/Madam'},

Your Assets & Liabilities form for Y/A ${year} (as at ${y.asAt}) is ready in your TaxMate client portal. We need it for your Income Tax Return.

${en}
${url}

ඔබගේ ${year} තක්සේරු වර්ෂයේ වත්කම් හා බැරකම් පත්‍රය client portal එකේ සූදානම්. ${si}

Thank you,
${FIRM.name}
WhatsApp ${FIRM.whatsapp}`;
}

// ─── Database helpers (pass the supabase client) ─────────
// Enable a sheet for a client + Y/A. Prefills Part 1 from the latest earlier year's statement.
export async function createStatement(supabase, { clientId, year, userId, blank = false }) {
  let data = emptyData();
  let prefilledFrom = null;
  if (!blank) {
    const { data: prev } = await supabase.from('asset_statements')
      .select('id, year, data').eq('client_id', clientId).lt('year', year)
      .order('year', { ascending: false }).limit(1).maybeSingle();
    if (prev) { data = carryForward(prev.data, prev.year); prefilledFrom = prev.id; }
  }
  const { data: row, error } = await supabase.from('asset_statements')
    .insert({ client_id: clientId, year, data, prefilled_from: prefilledFrom, created_by: userId })
    .select('*').single();
  if (error) throw new Error(/duplicate|unique/i.test(error.message) ? `A Y/A ${year} sheet already exists for this client.` : error.message);
  return row;
}

export const AL_STATUS = {
  open: { label: 'Waiting for client', cls: 'bg-amber-100 text-amber-800' },
  submitted: { label: 'Submitted — review', cls: 'bg-blue-100 text-blue-800' },
  reviewed: { label: 'Reviewed', cls: 'bg-green-100 text-green-700' },
};
export const portalAssetsUrl = (year) => `${window.location.origin}/client/assets${year ? `?year=${encodeURIComponent(year)}` : ''}`;
