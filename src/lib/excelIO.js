// ═══════════════════════════════════════════════════════════════════════════
//  V78 — Excel export · blank template · import, for:
//    1. Monthly Income & Business sheet      incomeBook / importIncome
//    2. Statement of Assets & Liabilities     alBook / importAL
//    3. Business accounts (sole / partnership) bizBook / importBiz
//    4. IIT Return computation               returnBook / importReturn
//  Column A holds a code the import uses to find each line — "don't change column A".
//  Imports also work on files without the codes (matched by the item name / column heading).
// ═══════════════════════════════════════════════════════════════════════════
import { downloadXlsx, colName, toIsoDate } from './xlsx';
import { parseAmount } from './numParse';
import { MONTHS, ROWS as INCOME_ROWS, groupsFor, cleanAssets } from './incomeSheet';
import { SECTIONS as AL_SECTIONS, yearInfo, rowsOf, fxAllowed, isFx, applyFx, CURRENCIES } from './assets';
import { INCOME_TYPES, normalize as bizNormalize, newLine, newAsset, newPartner, lineAmt } from './bizAccounts';

const H = (v) => ({ v, s: 'h' });
const T = (v) => ({ v, s: 't' });
const SUB = (v) => ({ v, s: 'sub' });
const M = (v) => { const s = parseAmount(v); return s === '' ? '' : { v: Number(s), s: 'm' }; };
const norm = (s) => String(s ?? '').toLowerCase().replace(/\[[^\]]*\]|\([^)]*\)/g, ' ').replace(/[^a-z0-9]+/g, ' ').trim();
const safe = (s) => String(s || '').trim().replace(/[\\/:*?"<>|]+/g, '').replace(/\s+/g, '_').slice(0, 60);
const who = (c) => (c?.full_name ? `_${safe(c.full_name)}` : '');
const yfile = (y) => String(y || '').replace('/', '-');
const monthHead = (year) => { const s = parseInt(year, 10); return MONTHS.map((m, i) => `${m} ${i < 9 ? s : s + 1}`); };
const cellStr = (v) => (v === null || v === undefined ? '' : typeof v === 'number' ? String(v) : String(v).trim());
const KEEP = "Don't change column A (code) — the import uses it. Type amounts as numbers (decimals with a dot: 139877.23).";

/** the rows of the first sheet whose name starts with one of the names (or the first sheet) */
function sheetNamed(sheets, ...names) {
  const n = names.map((x) => x.toLowerCase());
  return sheets.find((s) => n.some((x) => s.name.toLowerCase().startsWith(x))) || null;
}
/** index of the header row: the first row where ≥ min of the labels appear */
function headerRow(rows, labels, min = 2) {
  const want = labels.map(norm);
  for (let i = 0; i < Math.min(rows.length, 15); i++) {
    const r = (rows[i] || []).map(norm);
    if (want.filter((w) => w && r.includes(w)).length >= min) return i;
  }
  return -1;
}

// ─── 1. Monthly Income & Business sheet ──────────────────
export function incomeBook({ year, data, biz, client = {}, template = false }) {
  const months = monthHead(year);
  const rows = [
    [T(`Monthly Income & Business sheet — Y/A ${year}`)],
    [`${client.full_name || ''}${client.tin ? ` · TIN ${client.tin}` : ''}`, `1 April ${parseInt(year, 10)} – 31 March ${parseInt(year, 10) + 1} · ${KEEP}`],
    [],
    [H('Code'), H('Item'), ...months.map(H), H('Total')],
  ];
  const bizRows = { inc: [], exp: [] };
  for (const g of groupsFor(biz, data)) {
    rows.push(['', SUB(g.en)]);
    for (const r of g.rows) {
      const n = rows.length + 1;
      const vals = Array.from({ length: 12 }, (_, i) => (template ? '' : M(data?.rows?.[r.key]?.[i])));
      rows.push([r.key, r.en, ...vals, { f: `SUM(C${n}:N${n})`, s: 'mb' }]);
      const kind = biz && r.key === 'fxServices' ? 'bizIncome' : r.kind;
      if (kind === 'bizIncome') bizRows.inc.push(n); else if (kind === 'bizExpense') bizRows.exp.push(n);
    }
  }
  if (bizRows.inc.length || bizRows.exp.length) {
    const f = (c) => [...bizRows.inc.map((x) => `${c}${x}`), ...bizRows.exp.map((x) => `-${c}${x}`)].join('+').replace(/\+-/g, '-') || '0';
    rows.push(['', { v: 'Business profit / (loss)', s: 'b' }, ...Array.from({ length: 13 }, (_, i) => ({ f: f(colName(i + 2)), s: 'mb' }))]);
  }
  rows.push([], ['note', 'Note to TaxMate', template ? '' : (data?.note || '')]);
  const sheets = [{ name: 'Monthly income', rows, freeze: 4, widths: [13, 44, ...Array(12).fill(12), 14] }];
  if (biz) {
    const eq = [[T(`Equipment used for work — Y/A ${year}`)], ['', 'Bought this year or earlier and still used for work. Dates as YYYY-MM-DD.'], [],
      ['ID', 'Item', 'Date bought', 'Cost (Rs.)', 'Used for (Only for work / Partly)', 'Sold? (Yes / No)', 'Date sold', 'Sold for (Rs.)', 'Note'].map(H)];
    for (const a of template ? [] : (data?.assets || [])) eq.push([a.id, a.item, a.date, M(a.cost), a.work === 'partly' ? 'Partly' : 'Only for work', a.disposed ? 'Yes' : 'No', a.disposedOn, M(a.proceeds), a.note]);
    sheets.push({ name: 'Equipment', rows: eq, freeze: 4, widths: [10, 34, 13, 14, 24, 14, 13, 14, 30] });
  }
  return sheets;
}
export const downloadIncome = (opts) => downloadXlsx(`${opts.template ? 'Template_' : ''}Monthly_Income_${yfile(opts.year)}${who(opts.client)}.xlsx`, incomeBook(opts));

/** → { data, rowsDone, cells, assets } (rows not in the file keep their figures) */
export function importIncome(sheets, current, { biz } = {}) {
  const sh = sheetNamed(sheets, 'monthly income') || sheets[0];
  if (!sh) throw new Error('The file is empty.');
  const byKey = Object.fromEntries(INCOME_ROWS.map((r) => [r.key.toLowerCase(), r]));
  const byName = Object.fromEntries(INCOME_ROWS.map((r) => [norm(r.en), r]));
  for (const g of groupsFor(true, current)) for (const r of g.rows) byName[norm(r.en)] = INCOME_ROWS.find((x) => x.key === r.key) || r;
  const hi = headerRow(sh.rows, ['Code', 'Item', 'Total'], 2);
  // month columns: from the header ("Apr 2025" / "Apr"), else C..N
  let mcol = Array.from({ length: 12 }, (_, i) => i + 2);
  if (hi >= 0) {
    const hr = sh.rows[hi].map((x) => String(x || '').toLowerCase().slice(0, 3));
    const found = MONTHS.map((m) => hr.indexOf(m.toLowerCase()));
    if (found.every((x) => x >= 0)) mcol = found;
  }
  const rows = { ...(current?.rows || {}) };
  let rowsDone = 0, cells = 0, note = current?.note || '';
  sh.rows.forEach((r, ri) => {
    if (ri <= hi) return;
    const code = cellStr(r[0]).toLowerCase();
    if (code === 'note') { note = cellStr(r[2] ?? r[1]).slice(0, 2000); return; }
    const def = byKey[code] || (!code && byName[norm(r[1])]) || null;
    if (!def) return;
    rows[def.key] = mcol.map((c) => { const v = parseAmount(r[c]); if (v !== '') cells++; return v; });
    rowsDone++;
  });
  if (!rowsDone) throw new Error('No sheet lines found — use the TaxMate template (column A must keep the codes).');
  let assets = current?.assets || [];
  const eq = sheetNamed(sheets, 'equipment');
  if (biz && eq) {
    const h = headerRow(eq.rows, ['Item', 'Date bought', 'Cost (Rs.)'], 2);
    if (h >= 0) {
      const col = (label) => eq.rows[h].findIndex((x) => norm(x).startsWith(norm(label)));
      const c = { id: col('ID'), item: col('Item'), date: col('Date bought'), cost: col('Cost'), work: col('Used for'), sold: col('Sold?'), dsold: col('Date sold'), pr: col('Sold for'), note: col('Note') };
      const g = (r, k) => (c[k] >= 0 ? r[c[k]] : '');
      assets = cleanAssets(eq.rows.slice(h + 1).map((r) => ({
        id: cellStr(g(r, 'id')) || undefined, item: cellStr(g(r, 'item')), date: toIsoDate(g(r, 'date')), cost: parseAmount(g(r, 'cost'), false),
        work: /part/i.test(cellStr(g(r, 'work'))) ? 'partly' : 'yes', disposed: /^y/i.test(cellStr(g(r, 'sold'))), disposedOn: toIsoDate(g(r, 'dsold')),
        proceeds: parseAmount(g(r, 'pr'), false), note: cellStr(g(r, 'note')),
      })));
    }
  }
  return { data: { ...(current || {}), rows, note, assets }, rowsDone, cells, assets: assets.length };
}

// ─── 2. Statement of Assets & Liabilities ────────────────
const alSheetName = (s) => `${s.code} ${s.en}`.replace(/[[\]:*?/\\]/g, ' ').slice(0, 31);
const alLabel = (c) => `${c.en}${c.cage ? ` [${c.cage}]` : ''}${c.required ? ' *' : ''}`;
export function alBook({ year, data, client = {}, template = false }) {
  const y = yearInfo(year);
  const info = [[T(`Statement of Assets & Liabilities — Y/A ${year}`)], [`${client.full_name || ''}${client.tin ? ` · TIN ${client.tin}` : ''}`],
    [`Part 1: what you owned and owed on ${y.asAt}. Part 2: changes during ${y.period}.`], ['One sheet per section — fill a line per item. * = required. Dates as YYYY-MM-DD. Amounts as numbers.'], [],
    [H('Sheet'), H('Section'), H('Entries')]];
  const sheets = [];
  for (const s of AL_SECTIONS) {
    const list = template ? [] : rowsOf(data, s.key);
    info.push([alSheetName(s), s.en, list.length]);
    // V79: foreign-currency columns — Currency, Rate (Rs. per 1) and each amount in that currency; the Rs. column = amount × rate
    const fxc = fxAllowed(s) ? s.cols.filter((c) => c.type === 'money') : [];
    const fxHead = fxc.length ? ['Currency (LKR / USD …)', 'Rate (Rs. per 1 unit)', ...fxc.map((c) => `${c.en.replace(/\s*\(Rs\.\)/, '')} — in currency`)] : [];
    const rows = [[T(`${s.code}. ${s.en}`)], [s.help || (s.part === 2 ? `During ${y.period}` : `As at ${y.asAt}`)], [], [...s.cols.map((c) => H(alLabel(c))), ...fxHead.map(H)]];
    for (const r of list) {
      rows.push([...s.cols.map((c) => (c.type === 'money' ? M(r[c.key]) : cellStr(r[c.key]))),
        ...(fxc.length ? (isFx(r) ? [r.cur, M(r.rate), ...fxc.map((c) => M(r[`fx_${c.key}`]))] : ['LKR']) : [])]);
    }
    if (!list.length && s.cols.some((c) => c.type === 'select')) rows.push([...s.cols.map((c) => (c.type === 'select' ? `(${c.options.join(' / ')})` : '')), ...(fxc.length ? [`(${CURRENCIES.slice(0, 6).join(' / ')} …)`] : [])]);
    sheets.push({ name: alSheetName(s), rows, freeze: 4, widths: [...s.cols.map((c) => (c.wide ? 40 : c.type === 'money' ? 18 : 22)), ...fxHead.map(() => 18)] });
  }
  return [{ name: 'Read me', rows: info, widths: [30, 50, 10] }, ...sheets];
}
export const downloadAL = (opts) => downloadXlsx(`${opts.template ? 'Template_' : ''}Assets_Liabilities_${yfile(opts.year)}${who(opts.client)}.xlsx`, alBook(opts));

/** → { data, sections, rows } — sections found in the file replace the current entries */
export function importAL(sheets, current) {
  const out = { ...(current || {}) };
  let sections = 0, count = 0;
  for (const s of AL_SECTIONS) {
    const sh = sheets.find((x) => x.name === alSheetName(s)) || sheets.find((x) => x.name.toLowerCase().startsWith(`${s.code.toLowerCase()} `));
    if (!sh) continue;
    const h = headerRow(sh.rows, s.cols.map((c) => c.en), Math.min(2, s.cols.length));
    if (h < 0) continue;
    const head = sh.rows[h].map(norm);
    const idx = Object.fromEntries(s.cols.map((c, i) => { const k = head.indexOf(norm(c.en)); return [c.key, k >= 0 ? k : i]; }));
    const list = [];
    for (const r of sh.rows.slice(h + 1)) {
      if (!r || r.every((x) => cellStr(x) === '')) continue;
      const filled = r.filter((x) => cellStr(x) !== '');
      if (filled.every((x) => /^\(.*\)$/.test(cellStr(x)))) continue;       // the template's options hint line
      const row = { _id: Math.random().toString(36).slice(2, 10) };
      for (const c of s.cols) {
        const v = r[idx[c.key]];
        if (c.type === 'money') row[c.key] = parseAmount(v, !!c.negative);
        else if (c.type === 'date') row[c.key] = toIsoDate(v);
        else if (c.type === 'year') row[c.key] = (cellStr(v).match(/\d{4}/) || [''])[0];
        else if (c.type === 'select') { const t = cellStr(v); row[c.key] = c.options.find((o) => o.toLowerCase() === t.toLowerCase()) || t; }
        else row[c.key] = cellStr(v).slice(0, c.maxLength ?? 200);
      }
      // V79: foreign currency
      if (fxAllowed(s)) {
        const ci = head.findIndex((x) => x.startsWith('currency'));
        const cur = ci >= 0 ? cellStr(r[ci]).toUpperCase().replace(/[^A-Z]/g, '').slice(0, 3) : '';
        if (cur && cur !== 'LKR') {
          const ri2 = head.findIndex((x) => x.startsWith('rate'));
          row.cur = cur; row.rate = ri2 >= 0 ? parseAmount(r[ri2], false) : '';
          for (const c of s.cols.filter((x) => x.type === 'money')) {
            const k = head.findIndex((x) => x === norm(`${c.en.replace(/\s*\(Rs\.\)/, '')} — in currency`) || x === `${norm(c.en)} in currency`);
            row[`fx_${c.key}`] = k >= 0 ? parseAmount(r[k], !!c.negative) : '';
          }
          const fxGiven = s.cols.some((c) => c.type === 'money' && row[`fx_${c.key}`] !== '');
          if (fxGiven && Number(row.rate) > 0) Object.assign(row, applyFx(s, row));
          else if (!fxGiven) for (const c of s.cols.filter((x) => x.type === 'money')) row[`fx_${c.key}`] = '';
        }
      }
      if (s.cols.every((c) => !row[c.key] || row[c.key] === c.default)) continue;
      list.push(row);
    }
    out[s.key] = list; sections++; count += list.length;
  }
  if (!sections) throw new Error('No sections found — use the TaxMate template (keep the sheet names like "A Immovable Property").');
  return { data: out, sections, rows: count };
}

// ─── 3. Business accounts ────────────────────────────────
const lineSheet = (title, sub, lines, mode, year, { types = false, note = false, template, pre = [] }) => {
  const months = monthHead(year);
  const head = ['Code', 'Item', ...(types ? ['Type'] : []), ...(mode === 'monthly' ? [...months, 'Total'] : ['Amount (Rs.) — year']), ...(note ? ['Note'] : [])];
  const rows = [[T(title)], [sub, KEEP], [], head.map(H), ...pre];
  const a0 = 2 + (types ? 1 : 0);
  for (const ln of lines) {
    const n = rows.length + 1;
    const base = [ln.key || '+', ln.label, ...(types ? [INCOME_TYPES[ln.type || 'business']?.short || 'Business'] : [])];
    const amts = mode === 'monthly'
      ? [...Array.from({ length: 12 }, (_, i) => (template ? '' : M(ln.m?.[i]))), { f: `SUM(${colName(a0)}${n}:${colName(a0 + 11)}${n})`, s: 'mb' }]
      : [template ? '' : M(ln.a)];
    rows.push([...base, ...amts, ...(note ? [template ? '' : (ln.note || '')] : [])]);
  }
  for (let i = 0; i < 3; i++) rows.push(['+', '', ...(types ? ['Business'] : [])]);   // room for own lines
  return { rows, widths: [12, 46, ...(types ? [16] : []), ...(mode === 'monthly' ? [...Array(12).fill(12), 14] : [18]), ...(note ? [30] : [])] };
};
export function bizBook({ acc, data, mode, c = null, template = false }) {
  const d = bizNormalize(data, acc.kind);
  const y = acc.year;
  const sheets = [];
  const sub = `${acc.name} · ${acc.kind === 'partnership' ? 'Partnership' : 'Sole proprietor'}${acc.tin ? ` · TIN ${acc.tin}` : ''} · ${mode === 'monthly' ? 'month by month' : 'annual totals'}`;
  const inc = lineSheet(`Income — Y/A ${y}`, sub, d.income, mode, y, { types: true, template });
  sheets.push({ name: 'Income', rows: inc.rows, freeze: 4, widths: inc.widths });
  const cos = lineSheet(`Cost of sales — Y/A ${y}`, sub, d.cos, mode, y, { template,
    pre: [['stock.opening', 'Opening stock (1 April)', template ? '' : M(d.stock.opening)], ['stock.closing', 'Closing stock (31 March)', template ? '' : M(d.stock.closing)]] });
  sheets.push({ name: 'Cost of sales', rows: cos.rows, freeze: 4, widths: cos.widths });
  const ex = lineSheet(`Expenses — Y/A ${y}`, sub, d.expenses, mode, y, { note: true, template });
  sheets.push({ name: 'Expenses', rows: ex.rows, freeze: 4, widths: ex.widths });
  const as = [[T(`Assets used in the business — Y/A ${y}`)], ['', 'Dates as YYYY-MM-DD. Used for: Business only / Business + personal.'], [],
    ['ID', 'Asset', 'Date bought', 'Cost (Rs.)', 'Used for', 'Sold? (Yes / No)', 'Date sold', 'Sale price (Rs.)', 'Depreciation rate % (accounts)'].map(H)];
  for (const a of template ? [] : d.assets) as.push([a.id, a.item, a.date, M(a.cost), a.work === 'partly' ? 'Business + personal' : 'Business only', a.disposed ? 'Yes' : 'No', a.disposedOn, M(a.proceeds), a.depRate ? Number(a.depRate) : '']);
  sheets.push({ name: 'Assets', rows: as, freeze: 4, widths: [10, 34, 13, 15, 20, 14, 13, 15, 16] });
  if (acc.kind === 'partnership') {
    const ps = [[T(`Partners — ${acc.name}`)], ['', 'Profit-sharing % must add up to 100.'], [], ['ID', 'Partner name', 'NIC', 'TIN', 'Profit share %', 'Salary (Rs.)', 'Interest on capital (Rs.)'].map(H)];
    for (const p of template ? [] : d.partners) ps.push([p.id, p.name, p.nic, p.tin, p.share ? Number(p.share) : '', M(p.salary), M(p.interest)]);
    sheets.push({ name: 'Partners', rows: ps, freeze: 4, widths: [10, 30, 14, 14, 13, 15, 18] });
  }
  if (c && !template) {
    const L = (l, v, b) => [l, b ? { v: Math.round(v * 100) / 100, s: 'mb' } : { v: Math.round(v * 100) / 100, s: 'm' }];
    const rows = [[T(`Computation — Y/A ${y}`)], [], [H('Item'), H('Rs.')],
      L('Business income (turnover)', c.turnover), L('Other income in the accounts', c.nonBiz), L('Cost of sales', c.cogs), L('Expenses', c.expTotal), L('Net profit per the accounts', c.netProfit, true),
      L('Add: expenses not allowed & add-backs', c.addTotal), L('Less: non-business income & capital allowances', c.lessTotal), L('Adjusted business income', c.adjusted, true)];
    if (acc.kind === 'partnership') rows.push(L('Taxable income of the partnership', c.taxable || 0), L('Partnership tax (0% first Rs. 1,000,000, 6% balance)', c.tax || 0, true));
    else rows.push(L('To the return — Schedule 2', c.bizProfit || 0, true));
    sheets.push({ name: 'Computation', rows, widths: [52, 18] });
  }
  return sheets;
}
export const downloadBiz = (opts) => downloadXlsx(`${opts.template ? 'Template_' : ''}Business_${safe(opts.acc.name) || 'accounts'}_${yfile(opts.acc.year)}.xlsx`, bizBook(opts));

function readLines(sh, existing, mode, { types = false, note = false } = {}) {
  const h = headerRow(sh.rows, ['Code', 'Item'], 2);
  if (h < 0) return null;
  const head = sh.rows[h].map((x) => String(x || '').toLowerCase());
  const monthly = MONTHS.every((m) => head.some((x) => x.startsWith(m.toLowerCase())));
  const mcol = MONTHS.map((m) => head.findIndex((x) => x.startsWith(m.toLowerCase())));
  const acol = head.findIndex((x) => x.startsWith('amount'));
  const tcol = types ? head.findIndex((x) => x.startsWith('type')) : -1;
  const ncol = note ? head.findIndex((x) => x.startsWith('note')) : -1;
  const lines = existing.map((l) => ({ ...l, m: [...(l.m || Array(12).fill(''))] }));
  const extra = {};
  let n = 0;
  for (const r of sh.rows.slice(h + 1)) {
    const code = cellStr(r[0]); const label = cellStr(r[1]);
    if (code.startsWith('stock.')) { extra[code.slice(6)] = parseAmount(r[2]); continue; }
    if (!label && (!code || code === '+')) continue;
    let ln = code && code !== '+' ? lines.find((l) => l.key === code) : null;
    if (!ln) ln = lines.find((l) => norm(l.label) === norm(label));
    const vals = monthly ? mcol.map((c) => parseAmount(r[c])) : null;
    const a = monthly ? '' : parseAmount(r[acol >= 0 ? acol : 2 + (types ? 1 : 0)]);
    if (!ln) {
      if ((monthly ? vals.every((v) => v === '') : a === '') || !label) continue;
      ln = newLine(label.slice(0, 120), types ? { type: 'business' } : {}); lines.push(ln);
    }
    if (monthly) ln.m = vals; else ln.a = a;
    if (tcol >= 0) { const t = norm(r[tcol]); const k = Object.entries(INCOME_TYPES).find(([key, v]) => norm(v.short) === t || key === t)?.[0]; if (k && !ln.key) ln.type = k; }
    if (ncol >= 0 && cellStr(r[ncol])) ln.note = cellStr(r[ncol]).slice(0, 200);
    n++;
  }
  return { lines, monthly, n, extra };
}
/** → { data, mode, lines, assets, partners } */
export function importBiz(sheets, acc, data, mode) {
  const d = bizNormalize(data, acc.kind);
  let newMode = mode, lines = 0;
  const modes = [];
  for (const [name, key, opt] of [['income', 'income', { types: true }], ['cost of sales', 'cos', {}], ['expenses', 'expenses', { note: true }]]) {
    const sh = sheetNamed(sheets, name); if (!sh) continue;
    const res = readLines(sh, d[key], mode, opt); if (!res) continue;
    d[key] = res.lines; lines += res.n; modes.push(res.monthly);
    if (key === 'cos') for (const [k, v] of Object.entries(res.extra)) if (k in d.stock) d.stock[k] = v;
  }
  if (modes.length) {
    newMode = modes.some(Boolean) ? 'monthly' : 'annual';
    if (newMode === 'annual') for (const k of ['income', 'cos', 'expenses']) for (const ln of d[k]) if (ln.a === '' && (ln.m || []).some((v) => v !== '')) ln.a = String(lineAmt(ln, 'monthly'));
  }
  let assets = null, partners = null;
  const as = sheetNamed(sheets, 'assets');
  if (as) {
    const h = headerRow(as.rows, ['Asset', 'Date bought', 'Cost (Rs.)'], 2);
    if (h >= 0) {
      const head = as.rows[h].map(norm); const col = (l) => head.findIndex((x) => x.startsWith(norm(l)));
      const c = { id: col('ID'), item: col('Asset'), date: col('Date bought'), cost: col('Cost'), work: col('Used for'), sold: col('Sold'), ds: col('Date sold'), pr: col('Sale price'), dep: col('Depreciation rate') };
      const g = (r, k) => (c[k] >= 0 ? r[c[k]] : '');
      d.assets = as.rows.slice(h + 1).filter((r) => cellStr(g(r, 'item')) || parseAmount(g(r, 'cost'))).map((r) => ({
        ...newAsset(), ...(cellStr(g(r, 'id')) ? { id: cellStr(g(r, 'id')).slice(0, 20) } : {}),
        item: cellStr(g(r, 'item')).slice(0, 120), date: toIsoDate(g(r, 'date')), cost: parseAmount(g(r, 'cost'), false),
        work: /personal|part/i.test(cellStr(g(r, 'work'))) ? 'partly' : 'full', disposed: /^y/i.test(cellStr(g(r, 'sold'))), disposedOn: toIsoDate(g(r, 'ds')),
        proceeds: parseAmount(g(r, 'pr'), false), depRate: parseAmount(g(r, 'dep'), false).slice(0, 5),
      }));
      assets = d.assets.length;
    }
  }
  const ps = acc.kind === 'partnership' ? sheetNamed(sheets, 'partners') : null;
  if (ps) {
    const h = headerRow(ps.rows, ['Partner name', 'Profit share %'], 2);
    if (h >= 0) {
      const head = ps.rows[h].map(norm); const col = (l) => head.findIndex((x) => x.startsWith(norm(l)));
      const c = { id: col('ID'), name: col('Partner name'), nic: col('NIC'), tin: col('TIN'), share: col('Profit share'), sal: col('Salary'), int: col('Interest on capital') };
      const g = (r, k) => (c[k] >= 0 ? r[c[k]] : '');
      d.partners = ps.rows.slice(h + 1).filter((r) => cellStr(g(r, 'name'))).map((r) => ({
        ...newPartner(), ...(cellStr(g(r, 'id')) ? { id: cellStr(g(r, 'id')).slice(0, 20) } : {}),
        name: cellStr(g(r, 'name')).slice(0, 120), nic: cellStr(g(r, 'nic')).toUpperCase().slice(0, 12), tin: cellStr(g(r, 'tin')).slice(0, 20),
        share: parseAmount(g(r, 'share'), false).slice(0, 6), salary: parseAmount(g(r, 'sal'), false), interest: parseAmount(g(r, 'int'), false),
      }));
      partners = d.partners.length;
    }
  }
  if (!lines && assets === null && partners === null) throw new Error('Nothing found to import — use the TaxMate template for this business.');
  return { data: d, mode: newMode, lines, assets, partners };
}

// ─── 4. IIT Return computation ───────────────────────────
/** fields: [{ key, label, section, cage }] */
export function returnBook({ year, f = {}, r = null, fields, client = {}, label = '', template = false }) {
  const rows = [[T(`IIT Return computation — Y/A ${year}`)], [`${client.full_name || ''}${client.tin ? ` · TIN ${client.tin}` : ''}${label ? ` · ${label}` : ''}`, `Y/A ${year}`, 'Annual amounts. Don\'t change column A.'], [],
    [H('Code'), H('Item'), H('Section / cage'), H('Amount (Rs.)')]];
  let sec = '';
  for (const x of fields) {
    if (x.section !== sec) { sec = x.section; rows.push(['', SUB(x.section)]); }
    rows.push([x.key, x.label, x.cage || '', template ? '' : M(f[x.key])]);
  }
  const sheets = [{ name: 'Inputs', rows, freeze: 4, widths: [14, 62, 24, 18] }];
  if (r && !template) {
    const L = (c, l, v, b) => [c, l, { v: Math.round((v || 0) * 100) / 100, s: b ? 'mb' : 'm' }];
    const out = [[T(`Computation — Y/A ${year}`)], [], [H('Cage'), H('Item'), H('Rs.')],
      L('10', 'Employment income', r.cage10), L('20', 'Business income', r.cage20), L('30', 'Investment income', r.cage30), L('40', 'Other income', r.cage40),
      L('50', 'Total assessable income', r.cage50, true), L('60', 'Rent relief', r.rentRelief), L('70', 'Solar relief', r.solarUsed), L('80', 'Personal relief', r.prUsed),
      L('100', 'Qualifying payments', r.cage100), L('120', 'Taxable income', r.cage120, true),
      ...r.prog.detail.filter((b) => b.taxed > 0).map((b) => ['', `Rs. ${Math.round(b.taxed).toLocaleString('en-LK')} @ ${Math.round(b.rate * 100)}%`, { v: b.tax, s: 'm' }]),
      ...r.fx.bands.map((b) => ['', b.label, { v: b.tax, s: 'm' }]),
      L('130', 'Tax on terminal benefits', r.term.tax), L('140', 'Tax on gains on investment assets', r.gainTax), L('170', 'Total tax payable', r.cage170, true),
      ...r.credits.filter((x) => x.amt > 0).map((x) => [x.cage, x.label, { v: Math.round(x.amt * 100) / 100, s: 'm' }]),
      L('180', 'Total tax credits', r.cage180, true), L(r.balance >= 0 ? '190' : '200', r.balance >= 0 ? 'Balance tax payable' : 'Refund claimed', Math.abs(r.balance), true),
      L('210', 'Exempt / excluded income', r.cage210)];
    sheets.push({ name: 'Computation', rows: out, widths: [10, 60, 18] });
  }
  return sheets;
}
export const downloadReturn = (opts) => downloadXlsx(`${opts.template ? 'Template_' : ''}IIT_Return_${yfile(opts.year)}${who(opts.client)}.xlsx`, returnBook(opts));

/** → { f (strings), year, n } */
export function importReturn(sheets, fields) {
  const sh = sheetNamed(sheets, 'inputs') || sheets[0];
  if (!sh) throw new Error('The file is empty.');
  const keys = new Set(fields.map((x) => x.key));
  const byName = Object.fromEntries(fields.map((x) => [norm(x.label), x.key]));
  const h = headerRow(sh.rows, ['Code', 'Item', 'Amount (Rs.)'], 2);
  const acol = h >= 0 ? Math.max(3, sh.rows[h].findIndex((x) => norm(x).startsWith('amount'))) : 3;
  const f = {}; let n = 0, year = null;
  for (const r of sh.rows.slice(0, 4)) for (const x of r || []) { const m = /Y\/A\s*(\d{4}\/\d{2})/.exec(cellStr(x)); if (m) year = m[1]; }
  for (const r of sh.rows.slice(h + 1)) {
    const code = cellStr(r[0]);
    const k = keys.has(code) ? code : byName[norm(r[1])];
    if (!k) continue;
    const v = parseAmount(r[acol], false);
    if (v !== '' && Number(v) !== 0) { f[k] = v; n++; }
  }
  if (!n && !Object.keys(f).length) throw new Error('No amounts found — use the TaxMate IIT Return template (column A keeps the codes).');
  return { f, year, n };
}
