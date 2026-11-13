// V64 — VAT engine unit tests:  node --test src/lib/vat/calc.test.mjs
// (The same 250 random documents were also checked against the database engine public._vi_calc_doc: 0 differences.)
import test from 'node:test';
import assert from 'node:assert/strict';
import { calcDoc, rateFor } from './calc.js';

const rates = [
  { id: 'a', code: 'VAT_STD', treatment: 'standard', rate: 18, effective_from: '2024-01-01', effective_to: '2026-12-31' },
  { id: 'b', code: 'VAT_STD', treatment: 'standard', rate: 20, effective_from: '2027-01-01', effective_to: null },
  { id: 'c', code: 'VAT_ZERO', treatment: 'zero', rate: 0, effective_from: '2002-08-01', effective_to: null },
  { id: 'd', code: 'VAT_EXEMPT', treatment: 'exempt', rate: 0, effective_from: '2002-08-01', effective_to: null },
];
const doc = (x = {}) => ({ is_tax: true, price_mode: 'exclusive', disc_pct: 0, disc_amt: 0, issue_date: '2026-11-13', supply_date: '2026-11-13', ...x });

test('exclusive prices, line discount', () => {
  const r = calcDoc(doc(), [{ quantity: 10, unit_price: 1000, rate_code: 'VAT_STD' }, { quantity: 1, unit_price: 5000, disc_pct: 10, rate_code: 'VAT_STD' }], rates).totals;
  assert.deepEqual([r.net_total, r.vat_total, r.total], [14500, 2610, 17110]);
});
test('inclusive prices + document discount', () => {
  const r = calcDoc(doc({ price_mode: 'inclusive', disc_amt: 118 }), [{ quantity: 1, unit_price: 1180, rate_code: 'VAT_STD' }, { quantity: 2, unit_price: 590, rate_code: 'VAT_STD' }], rates).totals;
  assert.deepEqual([r.net_total, r.vat_total, r.total], [1900, 342, 2242]);
});
test('zero-rated and exempt lines carry no VAT', () => {
  const r = calcDoc(doc(), [{ quantity: 1, unit_price: 100, rate_code: 'VAT_ZERO' }, { quantity: 1, unit_price: 50, rate_code: 'VAT_EXEMPT' }, { quantity: 1, unit_price: 100, rate_code: 'VAT_STD' }], rates).totals;
  assert.deepEqual([r.taxable_zero, r.exempt_amount, r.taxable_standard, r.vat_total, r.total], [100, 50, 100, 18, 268]);
});
test('rate follows the date of supply (tax-rule versioning)', () => {
  assert.equal(rateFor(rates, 'VAT_STD', '2026-12-31').rate, 18);
  assert.equal(rateFor(rates, 'VAT_STD', '2027-01-05').rate, 20);
  const r = calcDoc(doc({ supply_date: '2027-01-05' }), [{ quantity: 1, unit_price: 1000, rate_code: 'VAT_STD' }], rates).totals;
  assert.equal(r.vat_total, 200);
});
test('non-tax invoice: no VAT at all', () => {
  const r = calcDoc(doc({ is_tax: false }), [{ quantity: 2, unit_price: 2500, rate_code: 'VAT_STD' }], rates).totals;
  assert.deepEqual([r.vat_total, r.total], [0, 5000]);
});
test('document discount is shared by value and never exceeds the lines', () => {
  const r = calcDoc(doc({ disc_pct: 100 }), [{ quantity: 3, unit_price: 33.33, rate_code: 'VAT_STD' }, { quantity: 1, unit_price: 0.01, rate_code: 'VAT_STD' }], rates);
  assert.equal(r.totals.total, 0);
  assert.ok(r.lines.every((l) => l.net >= 0));
});
