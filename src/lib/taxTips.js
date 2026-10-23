// Personalised tax-saving tips: re-runs the same IRD engine with one change at a time
// and shows how much tax that change would save. Resident individuals, Y/A 2025/26 onwards.
import { computePersonal, SOLAR_MAX, DONATION_MAX } from './iitCalc';

const n = (v) => Math.max(0, parseFloat(v) || 0);
const rs = (v) => `Rs. ${Math.round(v).toLocaleString('en-LK')}`;

/** x = computePersonal input (annual figures). Returns { base, tips: [{ key, emoji, title, si, save, body }] } */
export function taxSavingTips(year, x = {}) {
  const base = computePersonal(year, x);
  const tips = [];
  const resident = (x.residency || 'resident') === 'resident';
  const save = (alt) => Math.max(0, base.tax - computePersonal(year, { ...x, ...alt }).tax);

  if (base.tax > 0 && resident) {
    const room = SOLAR_MAX - n(x.solar);
    if (room > 0) {
      const s = save({ solar: SOLAR_MAX });
      if (s > 0) tips.push({
        key: 'solar', emoji: '☀️', save: s,
        title: 'Solar panel relief', si: 'සූර්ය පැනල සහනය',
        body: `Money spent this year on installing solar panels (or the loan repaid for them) is deductible up to ${rs(SOLAR_MAX)}. Using the full relief would cut your tax by about ${rs(s)}.`,
      });
    }
    const donRoom = DONATION_MAX - n(x.donCharity);
    if (donRoom > 0) {
      const s = save({ donCharity: DONATION_MAX });
      if (s > 0) tips.push({
        key: 'donation', emoji: '🤝', save: s,
        title: 'Donations to approved charities', si: 'අනුමත පරිත්‍යාග',
        body: `Donations to IRD-approved charities are deductible up to ${rs(DONATION_MAX)} (and one-third of taxable income). Giving ${rs(donRoom)} more would save about ${rs(s)} in tax — keep the receipts.`,
      });
    }
  }
  if (base.tax > 0 && n(x.foreignOther) > 0) {
    const s = save({ foreignFx: n(x.foreignFx) + n(x.foreignOther), foreignOther: 0 });
    if (s > 0) tips.push({
      key: 'fx', emoji: '🏦', save: s,
      title: 'Send foreign earnings through a bank', si: 'විදේශ ආදායම බැංකුවක් හරහා එවන්න',
      body: `Foreign-currency income sent to Sri Lanka through a bank is taxed at a maximum of 15% (instead of up to 36%). That could save about ${rs(s)}.`,
    });
  }
  if (n(x.rent) > 0 && resident) tips.push({
    key: 'rent', emoji: '🏠', save: 0, info: true,
    title: '25% rent relief already counted', si: 'කුලී සහනය',
    body: `We already deducted 25% of your rent income (${rs(base.rentRelief)}) — keep your rent agreement and receipts as proof.`,
  });
  if (n(x.salary) > 0 && !n(x.apitPaid)) tips.push({
    key: 'apit', emoji: '🧾', save: 0, info: true,
    title: 'APIT your employer deducted counts', si: 'අඩු කළ APIT',
    body: 'Tax your employer already deducted (APIT) is taken off this amount. If too much was deducted, you can claim a refund — ask your employer for the APIT certificate.',
  });
  if (n(x.interest) > 0 && !x.whtInterestAuto) tips.push({
    key: 'wht', emoji: '💰', save: 0, info: true,
    title: '10% tax on bank interest is a credit', si: 'පොලී WHT',
    body: 'Banks deduct 10% tax from interest. That amount is credited against your income tax — get the WHT certificate from your bank.',
  });

  tips.sort((a, b) => b.save - a.save);
  // all money-saving tips together (not a simple sum — reliefs interact)
  const all = {};
  if (tips.some(t => t.key === 'solar')) all.solar = SOLAR_MAX;
  if (tips.some(t => t.key === 'donation')) all.donCharity = DONATION_MAX;
  if (tips.some(t => t.key === 'fx')) { all.foreignFx = n(x.foreignFx) + n(x.foreignOther); all.foreignOther = 0; }
  const combined = Object.keys(all).length ? save(all) : 0;
  return { base, tips, combined };
}
