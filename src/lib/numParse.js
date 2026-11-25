// V78 — read an amount the way people type or paste it.
// "139,877.23" · "1,39,877.23" · "139877,23" (decimal comma) · "139.877,23" (European) · "Rs. 1,500" · "(2,500)" → plain "139877.23"
// The old cleaners dropped every comma, so "139877,23" became 13,987,723 (100 × too big).

/** → normalised string ('' when empty / not a number). neg: allow negative amounts */
export function parseAmount(input, neg = true) {
  if (typeof input === 'number') return Number.isFinite(input) ? String(neg ? input : Math.abs(input)) : '';
  let s = String(input ?? '').trim();
  if (!s) return '';
  let minus = false;
  if (/^\(.*\)$/.test(s)) { minus = true; s = s.slice(1, -1); }
  s = s.replace(/rs\.?|lkr|\s|'/gi, '');
  if (s.startsWith('-')) { minus = true; s = s.slice(1); }
  if (s.endsWith('-')) { minus = true; s = s.slice(0, -1); }
  s = s.replace(/[^\d.,]/g, '');
  if (!/\d/.test(s)) return '';
  const lastDot = s.lastIndexOf('.'), lastComma = s.lastIndexOf(',');
  if (lastDot >= 0 && lastComma >= 0) {
    // both: the one that comes last is the decimal mark
    s = lastComma > lastDot ? s.replace(/\./g, '').replace(',', '.') : s.replace(/,/g, '');
  } else if (lastComma >= 0) {
    const parts = s.split(',');
    // "1,500" / "1,39,877" / "12,345,678" → thousands; "139877,23" / "1,5" → decimal comma
    const thousands = parts.length > 2 ? parts.slice(1).every((p) => p.length === 3 || p.length === 2) && parts[parts.length - 1].length === 3
      : parts[1].length === 3;
    s = thousands ? parts.join('') : `${parts.slice(0, -1).join('')}.${parts[parts.length - 1]}`;
  } else if (lastDot >= 0) {
    const parts = s.split('.');
    // "1.234.567" → thousands (European); one dot = decimal point
    if (parts.length > 2) s = parts.slice(1).every((p) => p.length === 3) ? parts.join('') : `${parts.slice(0, -1).join('')}.${parts[parts.length - 1]}`;
  }
  s = s.replace(/^0+(?=\d)/, '');
  if (s.startsWith('.')) s = `0${s}`;
  if (s.endsWith('.')) s = s.slice(0, -1);
  if (!s || !Number.isFinite(Number(s))) return '';
  return minus && neg && Number(s) !== 0 ? `-${s}` : s;
}
export const amountNum = (v) => { const s = parseAmount(v); return s === '' ? 0 : Number(s); };

/** While typing: keep digits, one minus, dots and commas (normalised on blur / paste) */
export const typingAmount = (v, neg = true) => String(v ?? '').replace(neg ? /[^\d.,-]/g : /[^\d.,]/g, '').slice(0, 24);

/**
 * A month far out of line with the rest of the row (e.g. decimal point lost).
 * values: 12 numbers → [{ i, value, median, suggest }] — suggest = value / 100 when that fits the row
 */
export function outliers(values, factor = 20) {
  const xs = values.map((v) => amountNum(v));
  const nz = xs.filter((x) => x > 0);
  if (nz.length < 4) return [];
  const out = [];
  xs.forEach((x, i) => {
    if (x <= 0) return;
    const others = xs.filter((y, k) => k !== i && y > 0).sort((a, b) => a - b);
    const med = others[Math.floor(others.length / 2)];
    if (med > 0 && x >= med * factor) {
      const fix = Math.round((x / 100) * 100) / 100;
      out.push({ i, value: x, median: med, suggest: fix >= med / 3 && fix <= med * 3 ? fix : null });
    }
  });
  return out;
}
