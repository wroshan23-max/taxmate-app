// V56 — Small .xlsx writer for exports (no big library).
// A sheet: { name, rows: [[cell, …], …], widths?: [chars, …], freeze?: rowsToFreeze }
// A cell: string | number | boolean | null | { v, s } where s is one of the styles below.
import { zipSync, unzipSync, strToU8, strFromU8 } from 'fflate';

// style → cellXfs index (see styles.xml below)
const STYLE = { n: 0, h: 1, b: 2, m: 3, mb: 4, t: 5, w: 6, sub: 7 };

const esc = (v) => String(v).replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f￾￿]/g, '')
  .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
export const colName = (i) => { let out = ''; let n = i + 1; while (n > 0) { const m = (n - 1) % 26; out = String.fromCharCode(65 + m) + out; n = Math.floor((n - 1) / 26); } return out; };

function cellXml(c, ref) {
  const { v, s, f } = c !== null && typeof c === 'object' && !(c instanceof Date) ? c : { v: c, s: undefined };
  const st = STYLE[s] ?? 0;
  const sa = st ? ` s="${st}"` : '';
  // V78: formula cell { f: 'SUM(C5:N5)', v: cachedValue } — Excel recalculates when the file is opened
  if (f) return `<c r="${ref}"${sa}><f>${esc(f)}</f>${typeof v === 'number' && Number.isFinite(v) ? `<v>${v}</v>` : ''}</c>`;
  if (v === null || v === undefined || v === '') return st ? `<c r="${ref}"${sa}/>` : '';
  if (typeof v === 'number' && Number.isFinite(v)) return `<c r="${ref}"${sa}><v>${v}</v></c>`;
  if (typeof v === 'boolean') return `<c r="${ref}"${sa} t="b"><v>${v ? 1 : 0}</v></c>`;
  let t = typeof v === 'object' ? JSON.stringify(v) : String(v);
  if (t.length > 32000) t = `${t.slice(0, 32000)}…`;
  return `<c r="${ref}"${sa} t="inlineStr"><is><t xml:space="preserve">${esc(t)}</t></is></c>`;
}

export function buildXlsx(sheets) {
  const used = new Set();
  const names = sheets.map((sh) => {
    let nm = String(sh.name || 'Sheet').replace(/[[\]:*?/\\]/g, ' ').slice(0, 31).trim() || 'Sheet'; let k = 2;
    while (used.has(nm.toLowerCase())) nm = `${nm.slice(0, 28)} ${k++}`;
    used.add(nm.toLowerCase()); return nm;
  });
  const files = {};
  sheets.forEach((sh, si) => {
    const rows = sh.rows.map((r, ri) => `<row r="${ri + 1}">${(r || []).map((c, ci) => cellXml(c, `${colName(ci)}${ri + 1}`)).join('')}</row>`).join('');
    const cols = sh.widths?.length ? `<cols>${sh.widths.map((w, i) => `<col min="${i + 1}" max="${i + 1}" width="${w}" customWidth="1"/>`).join('')}</cols>` : '';
    const pane = sh.freeze ? `<pane ySplit="${sh.freeze}" topLeftCell="A${sh.freeze + 1}" activePane="bottomLeft" state="frozen"/>` : '';
    files[`xl/worksheets/sheet${si + 1}.xml`] = strToU8(`<?xml version="1.0" encoding="UTF-8" standalone="yes"?><worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetViews><sheetView workbookViewId="0">${pane}</sheetView></sheetViews>${cols}<sheetData>${rows}</sheetData></worksheet>`);
  });
  files['[Content_Types].xml'] = strToU8(`<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>${sheets.map((_, i) => `<Override PartName="/xl/worksheets/sheet${i + 1}.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>`).join('')}</Types>`);
  files['_rels/.rels'] = strToU8(`<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>`);
  files['xl/workbook.xml'] = strToU8(`<?xml version="1.0" encoding="UTF-8" standalone="yes"?><workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets>${names.map((nm, i) => `<sheet name="${esc(nm)}" sheetId="${i + 1}" r:id="rId${i + 1}"/>`).join('')}</sheets><calcPr calcId="191029" fullCalcOnLoad="1"/></workbook>`);
  files['xl/_rels/workbook.xml.rels'] = strToU8(`<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${sheets.map((_, i) => `<Relationship Id="rId${i + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet${i + 1}.xml"/>`).join('')}<Relationship Id="rId${sheets.length + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships>`);
  // fonts: 0 normal, 1 bold, 2 bold white, 3 title (bold 14 navy), 4 grey small
  // fills: 0 none, 1 gray125, 2 navy (header), 3 light (section)
  // cellXfs: 0 n · 1 h header · 2 b bold · 3 m money · 4 mb money bold · 5 t title · 6 w wrap · 7 sub section row
  files['xl/styles.xml'] = strToU8(`<?xml version="1.0" encoding="UTF-8" standalone="yes"?><styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><numFmts count="1"><numFmt numFmtId="164" formatCode="#,##0.00"/></numFmts><fonts count="5"><font><sz val="11"/><name val="Calibri"/></font><font><b/><sz val="11"/><name val="Calibri"/></font><font><b/><sz val="11"/><color rgb="FFFFFFFF"/><name val="Calibri"/></font><font><b/><sz val="14"/><color rgb="FF0E2040"/><name val="Calibri"/></font><font><sz val="10"/><color rgb="FF5B6B85"/><name val="Calibri"/></font></fonts><fills count="4"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill><fill><patternFill patternType="solid"><fgColor rgb="FF1A3C6E"/><bgColor indexed="64"/></patternFill></fill><fill><patternFill patternType="solid"><fgColor rgb="FFEEF2F9"/><bgColor indexed="64"/></patternFill></fill></fills><borders count="1"><border><left/><right/><top/><bottom/><diagonal/></border></borders><cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs><cellXfs count="8"><xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/><xf numFmtId="0" fontId="2" fillId="2" borderId="0" xfId="0" applyFont="1" applyFill="1"/><xf numFmtId="0" fontId="1" fillId="0" borderId="0" xfId="0" applyFont="1"/><xf numFmtId="164" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/><xf numFmtId="164" fontId="1" fillId="0" borderId="0" xfId="0" applyNumberFormat="1" applyFont="1"/><xf numFmtId="0" fontId="3" fillId="0" borderId="0" xfId="0" applyFont="1"/><xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0" applyAlignment="1"><alignment wrapText="1" vertical="top"/></xf><xf numFmtId="0" fontId="1" fillId="3" borderId="0" xfId="0" applyFont="1" applyFill="1"/></cellXfs><cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles></styleSheet>`);
  return zipSync(files, { level: 6 });
}

export function downloadXlsx(filename, sheets) {
  const blob = new Blob([buildXlsx(sheets)], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob); a.download = filename;
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 3000);
}

// ═══ V78 — reading .xlsx / .csv files (templates filled in Excel, Google Sheets, LibreOffice) ═══
export const colIndex = (ref) => { const m = /^([A-Z]+)/.exec(ref || ''); if (!m) return -1; let n = 0; for (const ch of m[1]) n = n * 26 + ch.charCodeAt(0) - 64; return n - 1; };
const textOf = (el) => (el ? [...el.getElementsByTagName('t')].map((t) => t.textContent).join('') : '');

/** → [{ name, rows: [[value, …], …] }] — values are numbers, booleans or strings (formulas: their last result) */
export async function readSpreadsheet(file) {
  const name = String(file?.name || '').toLowerCase();
  const buf = new Uint8Array(await file.arrayBuffer());
  if (name.endsWith('.csv') || name.endsWith('.txt')) return [{ name: 'Sheet1', rows: parseCsv(strFromU8(buf)) }];
  if (name.endsWith('.xls')) throw new Error('Old .xls files are not supported — in Excel use File → Save As → Excel Workbook (.xlsx).');
  let files;
  try { files = unzipSync(buf); } catch { throw new Error('This is not an Excel (.xlsx) file.'); }
  const xml = (p) => (files[p] ? new DOMParser().parseFromString(strFromU8(files[p]), 'application/xml') : null);
  const wb = xml('xl/workbook.xml');
  if (!wb) throw new Error('This is not an Excel (.xlsx) file.');
  const rels = xml('xl/_rels/workbook.xml.rels');
  const target = {};
  for (const r of rels ? [...rels.getElementsByTagName('Relationship')] : []) target[r.getAttribute('Id')] = r.getAttribute('Target');
  const ss = xml('xl/sharedStrings.xml');
  const shared = ss ? [...ss.getElementsByTagName('si')].map(textOf) : [];
  const out = [];
  for (const sh of [...wb.getElementsByTagName('sheet')]) {
    const rid = sh.getAttribute('r:id') || sh.getAttributeNS('http://schemas.openxmlformats.org/officeDocument/2006/relationships', 'id');
    let t = target[rid] || ''; t = t.replace(/^\//, ''); if (!t.startsWith('xl/')) t = `xl/${t}`;
    const doc = xml(t); if (!doc) continue;
    const rows = [];
    for (const r of [...doc.getElementsByTagName('row')]) {
      const ri = (parseInt(r.getAttribute('r'), 10) || rows.length + 1) - 1;
      const arr = [];
      let ci = 0;
      for (const c of [...r.getElementsByTagName('c')]) {
        const ref = c.getAttribute('r'); if (ref) ci = colIndex(ref);
        const ty = c.getAttribute('t');
        const v = c.getElementsByTagName('v')[0]?.textContent;
        let val = '';
        if (ty === 's') val = shared[parseInt(v, 10)] ?? '';
        else if (ty === 'inlineStr') val = textOf(c.getElementsByTagName('is')[0]);
        else if (ty === 'str') val = v ?? '';
        else if (ty === 'b') val = v === '1';
        else if (ty === 'e') val = '';
        else if (v !== undefined && v !== null && v !== '') val = Number(v);
        arr[ci] = val; ci += 1;
      }
      rows[ri] = Array.from(arr, (x) => (x === undefined ? '' : x));
    }
    out.push({ name: sh.getAttribute('name') || `Sheet${out.length + 1}`, rows: Array.from(rows, (x) => x || []) });
  }
  return out;
}

export function parseCsv(text) {
  const rows = []; let row = []; let cur = ''; let q = false;
  const s = text.replace(/^\uFEFF/, '');
  const delim = (s.split('\n')[0].match(/;/g) || []).length > (s.split('\n')[0].match(/,/g) || []).length ? ';' : ',';
  for (let i = 0; i < s.length; i++) {
    const ch = s[i];
    if (q) { if (ch === '"') { if (s[i + 1] === '"') { cur += '"'; i++; } else q = false; } else cur += ch; continue; }
    if (ch === '"') q = true;
    else if (ch === delim) { row.push(cur); cur = ''; }
    else if (ch === '\n' || ch === '\r') { if (ch === '\r' && s[i + 1] === '\n') i++; row.push(cur); rows.push(row); row = []; cur = ''; }
    else cur += ch;
  }
  if (cur !== '' || row.length) { row.push(cur); rows.push(row); }
  return rows;
}

/** Excel date serial (or text like 2024-03-31 / 31/03/2024 / 31.03.2024) → "YYYY-MM-DD" ('' if not a date) */
export function toIsoDate(v) {
  if (v === '' || v === null || v === undefined) return '';
  if (typeof v === 'number' && v > 59 && v < 2958466) {
    const d = new Date(Date.UTC(1899, 11, 30) + Math.round(v) * 86400000);
    return d.toISOString().slice(0, 10);
  }
  const s = String(v).trim();
  let m = /^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})/.exec(s);
  if (m) return `${m[1]}-${m[2].padStart(2, '0')}-${m[3].padStart(2, '0')}`;
  m = /^(\d{1,2})[-/.](\d{1,2})[-/.](\d{4})/.exec(s);          // Sri Lanka: day first
  if (m) return `${m[3]}-${m[2].padStart(2, '0')}-${m[1].padStart(2, '0')}`;
  return '';
}

/** pick a file from the user (resolves null when cancelled) */
export function pickFile(accept = '.xlsx,.csv') {
  return new Promise((resolve) => {
    const inp = Object.assign(document.createElement('input'), { type: 'file', accept });
    inp.onchange = () => resolve(inp.files?.[0] || null);
    inp.click();
  });
}
