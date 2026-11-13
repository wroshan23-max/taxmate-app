// V64 — VAT calculation (preview in the browser). It mirrors public._vi_calc_doc exactly;
// the database recalculates on every save and at issue, so stored figures never depend on this file.
//   per line: gross = qty × price (2 dp); line discount = gross × % (2 dp) + amount (≤ gross)
//   document discount = (sum after line discounts) × % + amount, shared by value (last line takes the rest)
//   exclusive: value = amount, VAT = value × rate (2 dp) · inclusive: VAT = amount × rate ÷ (100 + rate) (2 dp), value = amount − VAT
const r2 = (x) => Math.round((Number(x) + Number.EPSILON) * 100) / 100;
// round half away from zero to 2 dp, like PostgreSQL round(numeric, 2)
export function round2(x) {
  const v = Number(x) || 0;
  const s = Math.sign(v) || 1;
  return s * Math.round((Math.abs(v) * 100) + 1e-9) / 100;
}

/** The rate row for a code on a date (rates: [{id, code, treatment, rate, effective_from, effective_to}]) */
export function rateFor(rates, code, onDate) {
  const d = String(onDate || '').slice(0, 10);
  return (rates || [])
    .filter((r) => r.code === code && r.effective_from <= d && (!r.effective_to || r.effective_to >= d))
    .sort((a, b) => (a.effective_from < b.effective_from ? 1 : -1))[0] || null;
}

/**
 * doc: { is_tax, price_mode, disc_pct, disc_amt, supply_date, issue_date }
 * lines: [{ quantity, unit_price, disc_pct, disc_amt, rate_code }]
 * → { lines: [{...line, gross, discount, rate, treatment, net, vat, total, rateMissing}], totals }
 */
export function calcDoc(doc, lines, rates) {
  const onDate = doc.supply_date || doc.issue_date;
  const pass1 = (lines || []).map((l) => {
    const g = round2((Number(l.quantity) || 0) * (Number(l.unit_price) || 0));
    const ld = Math.min(g, round2(g * (Number(l.disc_pct) || 0) / 100) + (Number(l.disc_amt) || 0));
    let rate = 0, treatment = 'none', rateMissing = false;
    if (doc.is_tax) {
      const rr = rateFor(rates, l.rate_code || 'VAT_STD', onDate);
      if (rr) { rate = Number(rr.rate); treatment = rr.treatment; } else rateMissing = true;
    }
    return { ...l, gross: g, discount: ld, rate, treatment, rateMissing };
  });
  const sAfter = pass1.reduce((a, l) => a + (l.gross - l.discount), 0);
  const invDisc = Math.min(sAfter, round2(sAfter * (Number(doc.disc_pct) || 0) / 100) + (Number(doc.disc_amt) || 0));
  let remaining = invDisc;
  const out = pass1.map((l, i) => {
    const base = r2(l.gross - l.discount);
    let alloc = sAfter === 0 ? 0 : i === pass1.length - 1 ? remaining : round2(invDisc * base / sAfter);
    alloc = Math.max(0, Math.min(alloc, base, remaining));
    remaining = r2(remaining - alloc);
    const amt = r2(base - alloc);
    let net, vat;
    if (l.rate > 0 && doc.price_mode === 'inclusive') { vat = round2(amt * l.rate / (100 + l.rate)); net = r2(amt - vat); }
    else { net = amt; vat = round2(net * l.rate / 100); }
    return { ...l, discount: r2(l.discount + alloc), net, vat, total: r2(net + vat) };
  });
  const sum = (f, pred = () => true) => r2(out.filter(pred).reduce((a, l) => a + l[f], 0));
  return {
    lines: out,
    totals: {
      gross: sum('gross'), discount_total: sum('discount'),
      taxable_standard: sum('net', (l) => l.treatment === 'standard'), taxable_zero: sum('net', (l) => l.treatment === 'zero'),
      exempt_amount: sum('net', (l) => l.treatment === 'exempt'),
      net_total: sum('net'), vat_total: sum('vat'), total: sum('total'),
    },
  };
}
