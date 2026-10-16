import { useEffect, useState, useMemo } from 'react';
import { supabase, fmtRs } from '../../lib/supabase';
import { useAuth } from '../../contexts/AuthContext';
import toast from 'react-hot-toast';
import { Calculator as CalcIcon, Save, Users } from 'lucide-react';

// ─── Tax Constants ────────────────────────────────────────
const PR = 1_800_000; // Personal Relief
// IRD Y/A 2025/26 & 2026/27 tax slabs
const SLABS = [
  { limit: 1_000_000, rate: 0.06 },
  { limit:   500_000, rate: 0.18 },
  { limit:   500_000, rate: 0.24 },
  { limit:   500_000, rate: 0.30 },
  { limit: Infinity,  rate: 0.36 },
];

// Foreign bank income: 6% on first Rs.1,000,000 taxable; 15% on balance (IRD Table 08)
function calcForeignTax(taxable) {
  if (taxable <= 0) return { tax: 0, bands: [] };
  if (taxable <= 1_000_000) {
    const t = Math.round(taxable * 0.06);
    return { tax: t, bands: [{ label: `First Rs.${taxable.toLocaleString()} @ 6%`, tax: t }] };
  }
  const t1 = Math.round(1_000_000 * 0.06);
  const t2 = Math.round((taxable - 1_000_000) * 0.15);
  return {
    tax: t1 + t2,
    bands: [
      { label: 'First Rs.1,000,000 @ 6%', tax: t1 },
      { label: `Balance Rs.${(taxable - 1_000_000).toLocaleString()} @ 15%`, tax: t2 },
    ],
  };
}

// Progressive graduated tax
function graduatedTax(taxable) {
  let remaining = Math.max(0, taxable), tax = 0, detail = [];
  for (const s of SLABS) {
    if (remaining <= 0) break;
    const taxed = Math.min(remaining, s.limit);
    const t = Math.round(taxed * s.rate);
    detail.push({ rate: s.rate, taxed, tax: t });
    tax += t;
    remaining -= taxed;
  }
  return { tax, detail };
}

const v = (s) => parseFloat(s) || 0;

// Sri Lanka YOA months: April → March
const MONTHS = ['Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec', 'Jan', 'Feb', 'Mar'];

const MONTHLY_ROWS = [
  { id: 'sal',     label: '💼 Salary & Allowances' },
  { id: 'bon',     label: '🎁 Bonus / Gratuity' },
  { id: 'biz',     label: '🏪 Business Net Profit' },
  { id: 'cons',    label: '🤝 Consulting / Prof. Fee' },
  { id: 'rent',    label: '🏠 Rental Income (Gross)' },
  { id: 'forBank', label: '🌏 Foreign Bank Remitted' },
  { id: 'forOth',  label: '🌐 Other Foreign Income' },
  { id: 'oth',     label: '💰 Other Income' },
];

// ─── Main Component ───────────────────────────────────────
export default function Calculator() {
  const { user } = useAuth();
  const [clients, setClients] = useState([]);
  const [mainTab, setMainTab] = useState('iit');

  useEffect(() => {
    supabase.from('clients').select('id, full_name, tin').order('full_name').then(({ data }) => setClients(data ?? []));
  }, []);

  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-2xl font-bold text-primary-800">Tax Calculator</h1>
        <p className="text-sm text-gray-500">IRD Sri Lanka | Y/A 2025/26 &amp; 2026/27 | Personal Relief Rs. 1,800,000</p>
      </div>

      {/* Main tab bar */}
      <div className="flex gap-0 border-b border-gray-200">
        {[
          { id: 'iit',     label: '🧮 IIT Calculator' },
          { id: 'apit',    label: '📊 APIT/IIT 2026/27' },
          { id: 'monthly', label: '📅 Monthly Income' },
        ].map(t => (
          <button
            key={t.id}
            onClick={() => setMainTab(t.id)}
            className={`px-5 py-2.5 text-sm font-medium border-b-2 transition-colors -mb-px ${
              mainTab === t.id
                ? 'border-primary-600 text-primary-700 bg-primary-50'
                : 'border-transparent text-gray-500 hover:text-gray-700 hover:bg-gray-50'
            }`}
          >
            {t.label}
          </button>
        ))}
      </div>

      {mainTab === 'iit'     && <IITTab clients={clients} user={user} />}
      {mainTab === 'apit'    && <APitTab />}
      {mainTab === 'monthly' && <MonthlyTab />}
    </div>
  );
}

// ═══════════════════════════════════════════════════════════
//  TAB 1 — IIT Calculator (Annual & Quarterly)
// ═══════════════════════════════════════════════════════════
function IITTab({ clients, user }) {
  const [clientId, setClientId]       = useState('');
  const [year, setYear]               = useState('2026/27');
  const [shareWithClient, setShare]   = useState(false);
  const [saving, setSaving]           = useState(false);
  const [mode, setMode]               = useState('annual');

  // Annual — income
  const [emp,      setEmp]      = useState('');
  const [bonus,    setBonus]    = useState('');
  const [biz,      setBiz]      = useState('');
  const [cons,     setCons]     = useState('');
  const [rentGross,setRentG]    = useState('');
  const [forBank,  setForBank]  = useState('');
  const [forOth,   setForOth]   = useState('');
  const [othInc,   setOthInc]   = useState('');

  // Annual — deductions
  const [donations, setDon]    = useState('');
  const [solar,     setSolar]  = useState('');
  const [govtDon,   setGovt]   = useState('');

  // Annual — WHT credits
  const [whtApit,  setWhtApit]  = useState('');
  const [whtRent,  setWhtRent]  = useState('');
  const [whtProf,  setWhtProf]  = useState('');
  const [whtOth,   setWhtOth]   = useState('');

  // Quarterly
  const [qPrevTax, setQPrevTax] = useState('');
  const [qPaid,    setQPaid]    = useState('');
  const [qNo,      setQNo]      = useState('1');

  // ── Annual calculation ──
  const rentRel    = Math.round(v(rentGross) * 0.25);
  const rentNet    = v(rentGross) - rentRel;
  const stdIncome  = v(emp) + v(bonus) + v(biz) + v(cons) + rentNet + v(forOth) + v(othInc);
  const totalAss   = stdIncome + v(forBank);
  const donAllowed = Math.min(v(donations), 75000, stdIncome > 0 ? stdIncome / 3 : 0);
  const solarAllow = Math.min(v(solar), 600000);
  const totalQP    = donAllowed + solarAllow + v(govtDon);
  const totalDed   = PR + totalQP;
  const taxableStd = Math.max(0, stdIncome - totalDed);
  const unusedDed  = Math.max(0, totalDed - stdIncome);
  const taxableFB  = Math.max(0, v(forBank) - unusedDed);
  const stdResult  = graduatedTax(taxableStd);
  const fbResult   = calcForeignTax(taxableFB);
  const grossTax   = stdResult.tax + fbResult.tax;
  const totalWHT   = v(whtApit) + v(whtRent) + v(whtProf) + v(whtOth);
  const netTax     = grossTax - totalWHT;
  const effRate    = totalAss > 0 ? (grossTax / totalAss * 100).toFixed(2) : '0.00';
  const taxStatus  = netTax > 0.5 ? 'payable' : netTax < -0.5 ? 'refund' : 'nil';

  // ── Quarterly calculation ──
  const B = [4, 3, 2, 1][parseInt(qNo) - 1];
  const qInstalment = Math.max(0, Math.round((v(qPrevTax) - v(qPaid)) / B));

  const saveCalc = async () => {
    if (!clientId) return toast.error('Select a client first');
    setSaving(true);
    const inputData = mode === 'annual'
      ? { emp: v(emp), bonus: v(bonus), biz: v(biz), cons: v(cons), rentGross: v(rentGross), forBank: v(forBank), forOth: v(forOth), othInc: v(othInc), donations: v(donations), solar: v(solar), govtDon: v(govtDon), whtApit: v(whtApit), whtRent: v(whtRent), whtProf: v(whtProf), whtOth: v(whtOth) }
      : { prevTax: v(qPrevTax), paid: v(qPaid), quarter: qNo };
    const resultData = mode === 'annual'
      ? { gross_tax: grossTax, net_tax: netTax, eff_rate: effRate, total_assessable: totalAss }
      : { instalment: qInstalment, quarter: qNo, b: B };

    const { error } = await supabase.from('iit_calculations').insert({
      client_id: clientId, year, calc_type: mode, input_data: inputData,
      result_data: resultData, shared_with_client: shareWithClient, created_by: user.id,
    });
    setSaving(false);
    if (error) return toast.error(error.message);
    toast.success(shareWithClient ? 'Saved & shared with client!' : 'Calculation saved!');
  };

  return (
    <div className="space-y-4">
      {/* Client / Year / Mode */}
      <div className="card p-5 flex flex-wrap gap-4">
        <div className="flex-1 min-w-48">
          <label className="block text-xs font-semibold text-gray-500 mb-1">Client</label>
          <div className="relative">
            <Users size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
            <select className="input pl-9" value={clientId} onChange={e => setClientId(e.target.value)}>
              <option value="">— Select Client —</option>
              {clients.map(c => <option key={c.id} value={c.id}>{c.full_name}{c.tin ? ` (${c.tin})` : ''}</option>)}
            </select>
          </div>
        </div>
        <div>
          <label className="block text-xs font-semibold text-gray-500 mb-1">Year of Assessment</label>
          <select className="input" value={year} onChange={e => setYear(e.target.value)}>
            <option value="2025/26">2025/26</option>
            <option value="2026/27">2026/27</option>
          </select>
        </div>
        <div>
          <label className="block text-xs font-semibold text-gray-500 mb-1">Mode</label>
          <div className="flex rounded-lg overflow-hidden border border-gray-200">
            <button onClick={() => setMode('annual')}    className={`px-4 py-2 text-sm font-medium ${mode==='annual'    ? 'bg-primary-600 text-white' : 'bg-white text-gray-600 hover:bg-gray-50'}`}>Annual IIT</button>
            <button onClick={() => setMode('quarterly')} className={`px-4 py-2 text-sm font-medium ${mode==='quarterly' ? 'bg-primary-600 text-white' : 'bg-white text-gray-600 hover:bg-gray-50'}`}>Quarterly IIT</button>
          </div>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
        {/* ── Input Panel ── */}
        {mode === 'annual' ? (
          <div className="space-y-4">
            {/* Employment */}
            <div className="card p-5">
              <SectionHead>💼 Employment Income</SectionHead>
              <div className="space-y-3">
                <RsField label="Salary & Allowances" hint="Basic + allowances (per T10)" value={emp} onChange={setEmp} />
                <RsField label="Bonus / Gratuity" hint="Total annual bonus — not multiplied by 12" value={bonus} onChange={setBonus} tag="One-time Annual" tagColor="amber" />
              </div>
            </div>

            {/* Business */}
            <div className="card p-5">
              <SectionHead>🏪 Business / Professional Income</SectionHead>
              <div className="space-y-3">
                <RsField label="Business Net Profit" hint="After allowable business expenses" value={biz} onChange={setBiz} />
                <RsField label="Consulting / Professional Fees" hint="Professional / freelance income (5% WHT usually deducted)" value={cons} onChange={setCons} />
              </div>
            </div>

            {/* Rental */}
            <div className="card p-5">
              <SectionHead>🏠 Rental Income</SectionHead>
              <div className="space-y-3">
                <RsField label="Gross Rental Income" hint="25% auto-relief applied per IRA §6(3)" value={rentGross} onChange={setRentG} tag="25% Auto Relief" tagColor="green" />
                {v(rentGross) > 0 && (
                  <div className="bg-green-50 border border-green-100 rounded p-2 text-xs text-green-700">
                    Relief: {fmtRs(rentRel)} | Net taxable: {fmtRs(rentNet)}
                  </div>
                )}
              </div>
            </div>

            {/* Foreign */}
            <div className="card p-5">
              <SectionHead>🌏 Foreign Income</SectionHead>
              <div className="bg-blue-50 border border-blue-200 rounded-lg p-3 text-xs text-blue-700 mb-3">
                <strong>Two separate categories — taxed differently:</strong><br />
                ① Foreign Bank Remitted → 6% on first Rs.1,000,000 taxable; 15% on balance (IRD Table 08)<br />
                ② Other foreign income (not via bank) → Normal graduated rates 6%–36%
              </div>
              <div className="space-y-3">
                <RsField label="① Foreign Bank Remitted" hint="Remitted to SL bank in foreign currency (IRD APIT Table 08)" value={forBank} onChange={setForBank} tag="6%+15% Tiered" tagColor="blue" />
                <RsField label="② Other Foreign Income" hint="Not in foreign currency / not via bank — graduated rates apply" value={forOth} onChange={setForOth} tag="Graduated Rates" tagColor="red" />
              </div>
            </div>

            {/* Other income */}
            <div className="card p-5">
              <SectionHead>💰 Other Income</SectionHead>
              <div className="space-y-3">
                <RsField label="Other Taxable Income" hint="Dividends (15% WHT final) & bank interest (10% AIT) usually excluded" value={othInc} onChange={setOthInc} />
              </div>
            </div>

            {/* Qualifying Payments */}
            <div className="card p-5">
              <SectionHead>📋 Qualifying Payments &amp; Reliefs</SectionHead>
              <div className="bg-red-50 border border-red-200 rounded p-2 text-xs text-red-700 mb-3">
                🚫 Life Insurance, EPF, Rent Payments — NOT qualifying payments for Y/A 2025/26 (IRD SET 2025/26 confirmed)
              </div>
              <div className="space-y-3">
                <RsField label="Approved Donations" hint="IRD-approved charitable / religious institutions" value={donations} onChange={setDon} tag="Max Rs.75,000" tagColor="amber" />
                <RsField label="Solar Panel Relief" hint="Annual expenditure / bank loan for solar panels connected to national grid" value={solar} onChange={setSolar} tag="Max Rs.600,000" tagColor="green" />
                <RsField label="Government / President's Fund Donations" hint="Donations to Consolidated Fund / President's Fund (fully deductible, no cap)" value={govtDon} onChange={setGovt} />
              </div>
            </div>

            {/* WHT Credits */}
            <div className="card p-5">
              <SectionHead>🏦 WHT / APIT Credits (Already Withheld)</SectionHead>
              <div className="space-y-3">
                <RsField label="APIT by Employer" hint="Per T10 Form — full year total" value={whtApit} onChange={setWhtApit} />
                <RsField label="WHT on Rental Income" hint="10% WHT deducted by commercial tenants" value={whtRent} onChange={setWhtRent} />
                <RsField label="WHT on Professional Fees" hint="5% WHT on consulting income" value={whtProf} onChange={setWhtProf} />
                <RsField label="Other WHT Credits" hint="Any other advance tax paid" value={whtOth} onChange={setWhtOth} />
              </div>
            </div>
          </div>
        ) : (
          <div className="card p-5 space-y-4">
            <SectionHead>Quarterly Instalment — Formula: (A − C) ÷ B</SectionHead>
            <div className="bg-blue-50 border border-blue-200 rounded-lg p-3 text-xs text-blue-700">
              <strong>A</strong> = Preceding year gross tax &nbsp;|&nbsp;
              <strong>C</strong> = Credits + prior instalments paid &nbsp;|&nbsp;
              <strong>B</strong> = Remaining quarters<br />
              <span className="opacity-80 mt-1 block">Statement of Estimated Tax (SET) abolished effective Y/A 2026/27</span>
            </div>
            <div>
              <label className="text-xs font-semibold text-gray-500 mb-1 block">Current Quarter (Q{qNo})</label>
              <select className="input" value={qNo} onChange={e => setQNo(e.target.value)}>
                <option value="1">Q1 — Due 15 August 2026 (Apr · May · Jun)</option>
                <option value="2">Q2 — Due 15 November 2026 (Jul · Aug · Sep)</option>
                <option value="3">Q3 — Due 15 February 2027 (Oct · Nov · Dec)</option>
                <option value="4">Q4 — Due 15 May 2027 (Jan · Feb · Mar)</option>
              </select>
            </div>
            <RsField label="Preceding Year Gross Tax (A) — Y/A 2025/26" hint="Gross IIT before credits from the 2025/26 return" value={qPrevTax} onChange={setQPrevTax} required />
            <RsField label="Credits & Prior Instalments Paid (C)" hint="Include APIT/WHT deducted + quarterly instalments already paid this Y/A" value={qPaid} onChange={setQPaid} />
          </div>
        )}

        {/* ── Results Panel ── */}
        <div className="space-y-4">
          {mode === 'annual' ? (
            <div className="card overflow-hidden">
              <div className="bg-primary-700 text-white px-5 py-3 text-sm font-semibold flex items-center gap-2">
                <CalcIcon size={15} /> Live Tax Computation
                <span className="ml-auto text-xs opacity-70">IRD 2025/26 | PR Rs.1,800,000</span>
              </div>
              <div className="p-5 space-y-2 text-sm">
                <div className="text-xs font-semibold text-gray-400 uppercase tracking-wider mb-2">Assessable Income</div>
                {(v(emp) + v(bonus)) > 0 && <Row label="Employment Income" value={fmtRs(v(emp) + v(bonus))} />}
                {(v(biz) + v(cons)) > 0 && <Row label="Business / Professional" value={fmtRs(v(biz) + v(cons))} />}
                {v(rentGross) > 0 && <>
                  <Row label="Rental Income (Gross)" value={fmtRs(v(rentGross))} />
                  <Row label="  Less: Rental Relief (25%)" value={`(${fmtRs(rentRel)})`} className="text-green-700 text-xs" />
                </>}
                {v(forOth) > 0 && <Row label="Other Foreign Income" value={fmtRs(v(forOth))} />}
                {v(othInc) > 0 && <Row label="Other Income" value={fmtRs(v(othInc))} />}
                <Row label="Standard Assessable Income" value={fmtRs(stdIncome)} bold />
                {v(forBank) > 0 && <Row label="+ Foreign Bank Income (6%+15%)" value={fmtRs(v(forBank))} className="text-blue-700" />}
                <Row label="Total Assessable Income" value={fmtRs(totalAss)} bold className="border-t border-gray-100 pt-2 mt-1" />

                <div className="text-xs font-semibold text-gray-400 uppercase tracking-wider mb-2 mt-3">Deductions</div>
                <Row label="Personal Relief (Resident)" value={`(${fmtRs(Math.min(PR, stdIncome))})`} className="text-green-700" />
                {totalQP > 0 && <Row label="Qualifying Payments" value={`(${fmtRs(totalQP)})`} className="text-green-700" />}
                <Row label="Taxable Standard Income" value={fmtRs(taxableStd)} bold />
                {taxableFB > 0 && <Row label="Taxable Foreign Bank Income" value={fmtRs(taxableFB)} className="text-blue-700" />}

                <div className="text-xs font-semibold text-gray-400 uppercase tracking-wider mb-2 mt-3">Tax Computation</div>
                {stdResult.detail.filter(s => s.taxed > 0).map((s, i) => (
                  <div key={i} className="flex justify-between text-xs text-gray-500 py-0.5">
                    <span>{fmtRs(s.taxed)} @ {(s.rate * 100).toFixed(0)}%</span>
                    <span>{fmtRs(s.tax)}</span>
                  </div>
                ))}
                {fbResult.bands.map((b, i) => (
                  <div key={i} className="flex justify-between text-xs text-blue-600 py-0.5">
                    <span>Foreign: {b.label}</span>
                    <span>{fmtRs(b.tax)}</span>
                  </div>
                ))}

                <Row label="Gross Tax Liability" value={fmtRs(grossTax)} bold className="border-t border-gray-100 pt-2 mt-1 text-orange-700" />
                {totalWHT > 0 && <Row label="Less: WHT / APIT Credits" value={`(${fmtRs(totalWHT)})`} className="text-green-700" />}

                <div className={`border-t-2 pt-3 mt-3 rounded-lg p-3 ${
                  taxStatus === 'payable' ? 'bg-red-50 border-red-200' :
                  taxStatus === 'refund'  ? 'bg-green-50 border-green-200' : 'bg-gray-50 border-gray-200'
                }`}>
                  <div className={`text-xs font-bold mb-1 ${taxStatus === 'payable' ? 'text-red-600' : taxStatus === 'refund' ? 'text-green-600' : 'text-gray-500'}`}>
                    {taxStatus === 'payable' ? '⚠️ TAX PAYABLE' : taxStatus === 'refund' ? '✅ TAX REFUNDABLE' : '✅ NIL TAX'}
                  </div>
                  <div className={`text-3xl font-black ${taxStatus === 'payable' ? 'text-red-700' : taxStatus === 'refund' ? 'text-green-700' : 'text-gray-700'}`}>
                    {fmtRs(Math.abs(netTax))}
                  </div>
                  <div className="text-xs text-gray-400 mt-1">Effective rate: {effRate}% on total income</div>
                </div>
              </div>
            </div>
          ) : (
            <div className="card overflow-hidden">
              <div className="bg-primary-700 text-white px-5 py-3 text-sm font-semibold flex items-center gap-2">
                <CalcIcon size={15} /> Q{qNo} Instalment Result
              </div>
              <div className="p-5 space-y-3 text-sm">
                <Row label="Preceding Year Tax (A)" value={fmtRs(v(qPrevTax))} />
                <Row label="Credits & Prior Instalments (C)" value={`(${fmtRs(v(qPaid))})`} className="text-green-700" />
                <Row label="Remaining Quarters (B)" value={B} />
                <div className="bg-primary-50 border border-primary-200 rounded-lg p-4 mt-2 text-center">
                  <div className="text-xs text-primary-600 mb-1">= (A − C) ÷ B</div>
                  <div className="text-3xl font-black text-primary-700">{fmtRs(qInstalment)}</div>
                  <div className="text-xs text-gray-400 mt-1">Q{qNo} Instalment Due</div>
                </div>
              </div>
            </div>
          )}

          {/* Save panel */}
          <div className="card p-4 space-y-3">
            <label className="flex items-center gap-3 cursor-pointer">
              <div
                className={`relative w-10 h-5 rounded-full transition-colors ${shareWithClient ? 'bg-green-500' : 'bg-gray-200'}`}
                onClick={() => setShare(!shareWithClient)}
              >
                <div className={`absolute top-0.5 w-4 h-4 bg-white rounded-full shadow transition-transform ${shareWithClient ? 'translate-x-5' : 'translate-x-0.5'}`} />
              </div>
              <span className="text-sm text-gray-700">Share with client immediately</span>
            </label>
            <button onClick={saveCalc} disabled={saving || !clientId} className="btn-primary w-full justify-center">
              <Save size={15} />
              {saving ? 'Saving...' : shareWithClient ? 'Save & Share with Client' : 'Save Calculation'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════
//  TAB 2 — APIT / IIT 2026/27 (4 sub-tabs)
// ═══════════════════════════════════════════════════════════
function APitTab() {
  const [subTab, setSubTab] = useState('monthly-apit');

  const subTabs = [
    { id: 'monthly-apit', label: '🗓 Monthly APIT' },
    { id: 'quarterly',    label: '📅 Quarterly IIT' },
    { id: 'final',        label: '📋 Final IIT Return' },
    { id: 'mixed',        label: '🌍 Mixed Income' },
  ];

  return (
    <div className="space-y-4">
      <div className="bg-blue-50 border border-blue-200 rounded-lg p-3 text-xs text-blue-700">
        🏛 IRD Sri Lanka | APIT Table 01 | PN/IT/2025-01 | Circular SEC/2026/E/06 |
        Personal Relief: Rs. 1,800,000/year (Rs. 150,000/month) |
        Quarterly IIT Due Dates: 15 Aug · 15 Nov · 15 Feb · 15 May
      </div>
      <div className="flex gap-1 bg-gray-100 rounded-xl p-1">
        {subTabs.map(t => (
          <button
            key={t.id}
            onClick={() => setSubTab(t.id)}
            className={`flex-1 px-3 py-2 text-xs font-medium rounded-lg transition-colors ${
              subTab === t.id ? 'bg-white text-primary-700 shadow-sm' : 'text-gray-500 hover:text-gray-700'
            }`}
          >
            {t.label}
          </button>
        ))}
      </div>
      {subTab === 'monthly-apit' && <MonthlyAPIT />}
      {subTab === 'quarterly'    && <QuarterlyIIT />}
      {subTab === 'final'        && <FinalIIT />}
      {subTab === 'mixed'        && <MixedIncome />}
    </div>
  );
}

// ─── APIT Monthly Calculator (Table 01) ──────────────────
function MonthlyAPIT() {
  const [salary, setSalary] = useState('');
  const [perks, setPerks]   = useState('');

  const result = useMemo(() => {
    const total = v(salary) + v(perks);
    if (total <= 0) return null;
    const annualEq      = total * 12;
    const taxableAnnual = Math.max(0, annualEq - PR);
    const { tax: annualTax, detail } = graduatedTax(taxableAnnual);
    return { annualEq, taxableAnnual, annualTax, monthlyAPIT: Math.round(annualTax / 12), detail };
  }, [salary, perks]);

  const APIT_SLABS_REF = [
    { range: '≤ Rs. 150,000/month',             rate: '0%',  note: 'Below personal relief threshold' },
    { range: 'Rs. 150,001 – 233,333/month',      rate: '6%',  note: '6% × (monthly − 150,000)' },
    { range: 'Rs. 233,334 – 275,000/month',      rate: '18%', note: '6% × 83,333 + 18% × excess over 233,333' },
    { range: 'Rs. 275,001 – 316,667/month',      rate: '24%', note: 'As above + 24% × excess over 275,000' },
    { range: 'Rs. 316,668 – 358,333/month',      rate: '30%', note: 'As above + 30% × excess over 316,667' },
    { range: '> Rs. 358,333/month',              rate: '36%', note: 'As above + 36% × excess over 358,333' },
  ];

  return (
    <div className="space-y-4">
      <div className="card p-5">
        <SectionHead>Monthly APIT Calculator — APIT Table 01 | Y/A 2025/26 (applies 2026/27)</SectionHead>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 mb-4">
          <RsField label="Monthly Gross Employment Income" hint="Salary + allowances + cash benefits" value={salary} onChange={setSalary} required />
          <RsField label="Non-Cash Benefits / Perquisites" hint="Company car, housing, etc. (added to taxable income)" value={perks} onChange={setPerks} />
        </div>

        {result && (
          <div className="bg-primary-50 border border-primary-200 rounded-xl p-4 space-y-2 text-sm">
            <div className="text-xs font-bold text-primary-700 mb-3">APIT Calculation</div>
            <Row label="Monthly Gross Income" value={fmtRs(v(salary) + v(perks))} />
            <Row label="Annual Equivalent (×12)" value={fmtRs(result.annualEq)} />
            <Row label="Less: Personal Relief (Rs.1,800,000)" value={`(${fmtRs(Math.min(PR, result.annualEq))})`} className="text-green-700" />
            <Row label="Taxable Annual Income" value={fmtRs(result.taxableAnnual)} bold />
            <div className="text-xs text-gray-400 mt-2">Graduated Tax Breakdown:</div>
            {result.detail.filter(d => d.taxed > 0).map((d, i) => (
              <div key={i} className="flex justify-between text-xs text-gray-500 py-0.5">
                <span>{fmtRs(d.taxed)} @ {(d.rate * 100).toFixed(0)}%</span>
                <span>{fmtRs(d.tax)}</span>
              </div>
            ))}
            <Row label="Annual APIT" value={fmtRs(result.annualTax)} bold className="border-t border-primary-200 pt-2 mt-1" />
            <div className="bg-primary-600 text-white rounded-xl p-4 mt-3 text-center">
              <div className="text-xs opacity-75 mb-1">Monthly APIT to Deduct (Annual ÷ 12)</div>
              <div className="text-3xl font-black">{fmtRs(result.monthlyAPIT)}</div>
            </div>
          </div>
        )}

        {/* Reference table */}
        <div className="mt-5">
          <div className="text-xs font-bold text-gray-500 uppercase tracking-wider mb-2">APIT Table 01 Reference — Monthly Employment Income</div>
          <div className="overflow-x-auto">
            <table className="w-full text-xs border-collapse">
              <thead>
                <tr className="bg-primary-50">
                  <th className="border border-gray-200 p-2 text-left">Monthly Income Range</th>
                  <th className="border border-gray-200 p-2 text-left">Tax Formula</th>
                  <th className="border border-gray-200 p-2 text-center">Rate</th>
                </tr>
              </thead>
              <tbody>
                {APIT_SLABS_REF.map((s, i) => (
                  <tr key={i} className={i % 2 === 0 ? 'bg-white' : 'bg-gray-50'}>
                    <td className="border border-gray-200 p-2 font-medium">{s.range}</td>
                    <td className="border border-gray-200 p-2 text-gray-600">{s.note}</td>
                    <td className="border border-gray-200 p-2 text-center font-bold text-primary-700">{s.rate}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="bg-blue-50 border border-blue-200 rounded p-2 text-xs text-blue-700 mt-2">
            📌 Table 01 covers primary employment income (regular monthly). Lump-sum payments → Table 02; Secondary employment → Table 03.
          </div>
          <div className="bg-green-50 border border-green-200 rounded p-2 text-xs text-green-700 mt-2">
            ✅ These rates apply for Y/A 2026/27. No changes to APIT slabs were announced. Personal relief remains Rs. 1,800,000/year.
          </div>
        </div>
      </div>
    </div>
  );
}

// ─── Quarterly IIT Instalment Calculator ─────────────────
function QuarterlyIIT() {
  const [qNo,    setQNo]    = useState('1');
  const [method, setMethod] = useState('m1');
  const [prevTax,setPrevTax]= useState('');
  const [paid,   setPaid]   = useState('');

  // Method 2: income grid for 3 months
  const emptyGrid = () => ({ sal: ['','',''], biz: ['','',''], rent: ['','',''], oth: ['','',''] });
  const [m2, setM2]         = useState(emptyGrid);
  const [m2Credits,setM2Cr] = useState('');

  const B = [4, 3, 2, 1][parseInt(qNo) - 1];
  const QUARTER_MONTHS = [
    ['Apr','May','Jun'],['Jul','Aug','Sep'],['Oct','Nov','Dec'],['Jan','Feb','Mar']
  ][parseInt(qNo) - 1];

  const m1Inst = Math.max(0, Math.round((v(prevTax) - v(paid)) / B));

  const m2Total  = Object.values(m2).flat().reduce((a, b) => a + v(b), 0);
  const m2Rent   = m2.rent.reduce((a, b) => a + v(b), 0);
  const m2StdInc = m2Total - Math.round(m2Rent * 0.25);
  const m2AnnEq  = m2StdInc * 4;
  const m2TaxAnn = graduatedTax(Math.max(0, m2AnnEq - PR)).tax;
  const m2Inst   = Math.max(0, Math.round((m2TaxAnn - v(m2Credits)) / B));

  const updateM2 = (type, idx, val) => setM2(prev => {
    const n = { ...prev }; n[type] = [...n[type]]; n[type][idx] = val; return n;
  });

  return (
    <div className="space-y-4">
      <div className="card p-5">
        <SectionHead>Quarterly IIT Instalment Calculator — IRD Circular SEC/2026/E/06 | Y/A 2026/27</SectionHead>
        <div className="bg-blue-50 border border-blue-200 rounded-lg p-3 text-xs text-blue-700 mb-4">
          <strong>Formula: Instalment = (A − C) ÷ B</strong><br />
          A = Preceding year gross tax &nbsp;|&nbsp; C = Tax already paid this year &nbsp;|&nbsp; B = Remaining quarters including current<br />
          <span className="opacity-80 mt-1 block">SET abolished effective Y/A 2026/27 (Inland Revenue Amendment Act 2026)</span>
        </div>

        <div className="mb-4">
          <label className="text-xs font-semibold text-gray-500 mb-1 block">Current Quarter</label>
          <select className="input max-w-sm" value={qNo} onChange={e => setQNo(e.target.value)}>
            <option value="1">Q1 — Due 15 August 2026 (Apr · May · Jun)</option>
            <option value="2">Q2 — Due 15 November 2026 (Jul · Aug · Sep)</option>
            <option value="3">Q3 — Due 15 February 2027 (Oct · Nov · Dec)</option>
            <option value="4">Q4 — Due 15 May 2027 (Jan · Feb · Mar)</option>
          </select>
        </div>

        {/* Method selector */}
        <div className="flex gap-3 mb-4">
          {[
            { id: 'm1', title: '📋 Method 1 — Standard', sub: 'Enter preceding year\'s gross tax (A)' },
            { id: 'm2', title: '📅 Method 2 — Income Entry', sub: 'Enter monthly income for the quarter' },
          ].map(m => (
            <button key={m.id} onClick={() => setMethod(m.id)}
              className={`flex-1 p-3 rounded-xl border-2 text-left transition-colors ${method === m.id ? 'border-primary-500 bg-primary-50' : 'border-gray-200 hover:border-gray-300'}`}>
              <div className="text-xs font-bold text-primary-700">{m.title}</div>
              <div className="text-xs text-gray-500 mt-0.5">{m.sub}</div>
            </button>
          ))}
        </div>

        {method === 'm1' ? (
          <div className="space-y-3">
            <RsField label="Preceding Year Gross Tax (A) — Y/A 2025/26" hint="Gross IIT before credits from the 2025/26 return" value={prevTax} onChange={setPrevTax} required />
            <RsField label="Credits & Prior Instalments Paid (C)" hint="APIT/WHT deducted + quarterly instalments already paid this Y/A 2026/27" value={paid} onChange={setPaid} />
            {v(prevTax) > 0 && (
              <div className="bg-primary-50 border border-primary-200 rounded-xl p-4 space-y-2 text-sm">
                <Row label="Preceding Year Tax (A)" value={fmtRs(v(prevTax))} />
                <Row label="Credits & Prior Instalments (C)" value={`(${fmtRs(v(paid))})`} className="text-green-700" />
                <Row label="Remaining Quarters (B)" value={B} />
                <div className="bg-primary-600 text-white rounded-xl p-3 mt-2 text-center">
                  <div className="text-xs opacity-75 mb-1">Q{qNo} Instalment Due = (A − C) ÷ B</div>
                  <div className="text-2xl font-black">{fmtRs(m1Inst)}</div>
                </div>
              </div>
            )}
          </div>
        ) : (
          <div className="space-y-3">
            <p className="text-xs text-gray-500">Enter income for each month in Q{qNo} ({QUARTER_MONTHS.join(', ')}). The total is annualised (×4), personal relief deducted, then tax slabs applied to estimate annual tax (A).</p>
            <div className="overflow-x-auto">
              <table className="w-full text-xs border-collapse">
                <thead>
                  <tr className="bg-gray-50">
                    <th className="border border-gray-200 p-2 text-left">Income Type</th>
                    {QUARTER_MONTHS.map(m => <th key={m} className="border border-gray-200 p-2">{m}</th>)}
                    <th className="border border-gray-200 p-2 bg-primary-50 text-primary-700">Q Total</th>
                  </tr>
                </thead>
                <tbody>
                  {[
                    { id: 'sal', label: '💼 Salary' },
                    { id: 'biz', label: '🏪 Business/Prof.' },
                    { id: 'rent', label: '🏠 Rental (Gross)' },
                    { id: 'oth', label: '💰 Other' },
                  ].map(row => {
                    const tot = m2[row.id].reduce((a, b) => a + v(b), 0);
                    return (
                      <tr key={row.id}>
                        <td className="border border-gray-200 p-2 font-medium bg-gray-50">{row.label}</td>
                        {m2[row.id].map((val, idx) => (
                          <td key={idx} className="border border-gray-200 p-1">
                            <input type="number" min="0" placeholder="0" value={val}
                              onChange={e => updateM2(row.id, idx, e.target.value)}
                              className="w-full px-2 py-1 text-xs border border-gray-200 rounded focus:outline-none focus:border-primary-400" />
                          </td>
                        ))}
                        <td className="border border-gray-200 p-2 text-center font-semibold text-primary-700 bg-primary-50">{tot > 0 ? fmtRs(tot) : '—'}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
            <RsField label="Credits & Prior Instalments Paid (C)" hint="APIT/WHT + quarterly instalments paid before this quarter" value={m2Credits} onChange={setM2Cr} />
            {m2Total > 0 && (
              <div className="bg-primary-50 border border-primary-200 rounded-xl p-4 space-y-1.5 text-sm">
                <Row label="Q Total Income" value={fmtRs(m2Total)} />
                {Math.round(m2Rent * 0.25) > 0 && <Row label="Rental Relief (25%)" value={`(${fmtRs(Math.round(m2Rent * 0.25))})`} className="text-green-700" />}
                <Row label="Annualised (×4)" value={fmtRs(m2AnnEq)} />
                <Row label="Less: Personal Relief" value={`(${fmtRs(Math.min(PR, m2AnnEq))})`} className="text-green-700" />
                <Row label="Taxable Annual Estimate" value={fmtRs(Math.max(0, m2AnnEq - PR))} bold />
                <Row label="Estimated Annual Tax (A)" value={fmtRs(m2TaxAnn)} bold />
                <Row label="Credits (C)" value={`(${fmtRs(v(m2Credits))})`} className="text-green-700" />
                <Row label="Remaining Quarters (B)" value={B} />
                <div className="bg-primary-600 text-white rounded-xl p-3 mt-2 text-center">
                  <div className="text-xs opacity-75 mb-1">Q{qNo} Instalment Due</div>
                  <div className="text-2xl font-black">{fmtRs(m2Inst)}</div>
                </div>
              </div>
            )}
          </div>
        )}
        <div className="bg-amber-50 border border-amber-200 rounded p-2 text-xs text-amber-700 mt-3">
          ⚠️ Method 1 applies when the client had taxable income in Y/A 2025/26. Method 2 estimates from current quarter income — suitable for new clients or significantly changed income. Interest & penalties for non-payment cannot be waived.
        </div>
      </div>
    </div>
  );
}

// ─── Final IIT Return Calculator ──────────────────────────
function FinalIIT() {
  const [sal,  setSal]  = useState('');
  const [bon,  setBon]  = useState('');
  const [biz,  setBiz]  = useState('');
  const [cons, setCons] = useState('');
  const [int_, setInt]  = useState('');
  const [div_, setDiv]  = useState('');
  const [rent, setRent] = useState('');
  const [oth,  setOth]  = useState('');
  const [apit, setApit] = useState('');
  const [qpd,  setQpd]  = useState('');
  const [wht,  setWht]  = useState('');

  const rentRel   = Math.round(v(rent) * 0.25);
  const rentNet   = v(rent) - rentRel;
  const stdInc    = v(sal) + v(bon) + v(biz) + v(cons) + v(int_) + v(div_) + rentNet + v(oth);
  const taxable   = Math.max(0, stdInc - PR);
  const { tax: grossTax, detail } = graduatedTax(taxable);
  const aitInt    = Math.round(v(int_) * 0.10);
  const aitDiv    = Math.round(v(div_) * 0.15);
  const totalCr   = v(apit) + v(qpd) + v(wht) + aitInt + aitDiv;
  const netTax    = grossTax - totalCr;
  const taxStatus = netTax > 0.5 ? 'payable' : netTax < -0.5 ? 'refund' : 'nil';

  return (
    <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
      <div className="space-y-4">
        <div className="card p-5">
          <SectionHead>Final IIT Return Calculator — Y/A 2026/27</SectionHead>

          <div className="text-xs font-semibold text-gray-400 uppercase tracking-wider mb-2">💼 Employment</div>
          <div className="space-y-3 mb-4">
            <RsField label="Annual Salary & Allowances" value={sal} onChange={setSal} />
            <RsField label="Bonus / Gratuity / Lump-sum" value={bon} onChange={setBon} />
          </div>

          <div className="text-xs font-semibold text-gray-400 uppercase tracking-wider mb-2">🏪 Business / Professional</div>
          <div className="space-y-3 mb-4">
            <RsField label="Business Net Profit" hint="After allowable expenses" value={biz} onChange={setBiz} />
            <RsField label="Consulting / Professional Fees" value={cons} onChange={setCons} />
          </div>

          <div className="text-xs font-semibold text-gray-400 uppercase tracking-wider mb-2">💰 Investment & Other</div>
          <div className="space-y-3 mb-4">
            <RsField label="Interest Income (gross)" hint="10% AIT auto-included as credit" value={int_} onChange={setInt} tag="10% AIT auto" tagColor="blue" />
            <RsField label="Dividend Income (gross)" hint="15% AIT auto-included as credit" value={div_} onChange={setDiv} tag="15% AIT auto" tagColor="blue" />
            <RsField label="Rental Income (Gross)" hint="25% auto-relief applied" value={rent} onChange={setRent} tag="25% Relief Auto" tagColor="green" />
            <RsField label="Other Assessable Income" value={oth} onChange={setOth} />
          </div>

          <div className="text-xs font-semibold text-gray-400 uppercase tracking-wider mb-2">🏦 Tax Credits</div>
          <div className="space-y-3">
            <RsField label="APIT Deducted by Employer" hint="From T10 certificate" value={apit} onChange={setApit} />
            <RsField label="Quarterly IIT Instalments Paid" value={qpd} onChange={setQpd} />
            <RsField label="WHT / Other AIT Paid" value={wht} onChange={setWht} />
            {(v(int_) > 0 || v(div_) > 0) && (
              <div className="bg-blue-50 border border-blue-200 rounded p-2 text-xs text-blue-700">
                💡 Auto-included: AIT on Interest: {fmtRs(aitInt)} | AIT on Dividends: {fmtRs(aitDiv)}
              </div>
            )}
          </div>
        </div>
      </div>

      <div className="card overflow-hidden">
        <div className="bg-primary-700 text-white px-5 py-3 text-sm font-semibold flex items-center gap-2">
          <CalcIcon size={15} /> IIT Computation Summary
        </div>
        {stdInc === 0 ? (
          <div className="p-5 text-xs text-gray-400 text-center py-12">Enter income details to see computation →</div>
        ) : (
          <div className="p-5 space-y-2 text-sm">
            <Row label="Total Assessable Income" value={fmtRs(stdInc)} bold />
            <Row label="Less: Personal Relief" value={`(${fmtRs(Math.min(PR, stdInc))})`} className="text-green-700" />
            {rentRel > 0 && <Row label="Rental Relief (25%)" value={`(${fmtRs(rentRel)})`} className="text-green-700" />}
            <Row label="Taxable Income" value={fmtRs(taxable)} bold />
            <div className="text-xs text-gray-400 mt-2">Graduated Tax:</div>
            {detail.filter(d => d.taxed > 0).map((d, i) => (
              <div key={i} className="flex justify-between text-xs text-gray-500 py-0.5">
                <span>{fmtRs(d.taxed)} @ {(d.rate * 100).toFixed(0)}%</span>
                <span>{fmtRs(d.tax)}</span>
              </div>
            ))}
            <Row label="Gross Tax" value={fmtRs(grossTax)} bold className="border-t border-gray-100 pt-2" />
            {totalCr > 0 && <Row label="Less: All Tax Credits" value={`(${fmtRs(totalCr)})`} className="text-green-700" />}
            <div className={`border-t-2 pt-3 mt-2 rounded-xl p-3 ${
              taxStatus === 'payable' ? 'bg-red-50 border-red-200' :
              taxStatus === 'refund'  ? 'bg-green-50 border-green-200' : 'bg-gray-50 border-gray-200'
            }`}>
              <div className={`text-xs font-bold mb-1 ${taxStatus === 'payable' ? 'text-red-600' : taxStatus === 'refund' ? 'text-green-600' : 'text-gray-500'}`}>
                {taxStatus === 'payable' ? '⚠️ TAX PAYABLE' : taxStatus === 'refund' ? '✅ TAX REFUNDABLE' : '✅ NIL TAX'}
              </div>
              <div className={`text-3xl font-black ${taxStatus === 'payable' ? 'text-red-700' : taxStatus === 'refund' ? 'text-green-700' : 'text-gray-700'}`}>
                {fmtRs(Math.abs(netTax))}
              </div>
            </div>
            <div className="bg-amber-50 border border-amber-200 rounded p-2 text-xs text-amber-700 mt-3">
              ⚠️ Special rates: Foreign income capped at 15%; Betting/gaming at 45%; Capital gains 15% (from 03.06.2026). Consult IRD for complex cases.
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

// ─── Mixed Income Calculator ──────────────────────────────
function MixedIncome() {
  const [year,   setYear]   = useState('2026/27');
  const [lSal,   setLSal]   = useState('');
  const [lBon,   setLBon]   = useState('');
  const [lBiz,   setLBiz]   = useState('');
  const [lRent,  setLRent]  = useState('');
  const [lOth,   setLOth]   = useState('');
  const [fBank,  setFBank]  = useState('');
  const [fOther, setFOther] = useState('');
  const [credits,setCreds]  = useState('');

  const lRentRel = Math.round(v(lRent) * 0.25);
  const lRentNet = v(lRent) - lRentRel;
  const localStd = v(lSal) + v(lBon) + v(lBiz) + lRentNet + v(lOth);
  const totalAss = localStd + v(fBank) + v(fOther);
  const taxableL = Math.max(0, localStd - PR);
  const unusedPR = Math.max(0, PR - localStd);
  const taxableFB  = Math.max(0, v(fBank) - unusedPR);
  const taxableFO  = Math.max(0, v(fOther) - Math.max(0, unusedPR - v(fBank)));
  const { tax: localTax, detail: localDetail } = graduatedTax(taxableL + taxableFO);
  const { tax: fbTax, bands: fbBands } = calcForeignTax(taxableFB);
  const grossTax   = localTax + fbTax;
  const netTax     = grossTax - v(credits);
  const taxStatus  = netTax > 0.5 ? 'payable' : netTax < -0.5 ? 'refund' : 'nil';

  return (
    <div className="space-y-4">
      <div className="flex gap-2 items-center">
        <span className="text-xs font-semibold text-gray-500">Year of Assessment:</span>
        {['2025/26', '2026/27'].map(y => (
          <button key={y} onClick={() => setYear(y)}
            className={`px-3 py-1 text-xs rounded-full border font-medium transition-colors ${year === y ? 'bg-primary-600 text-white border-primary-600' : 'border-gray-200 text-gray-600 hover:border-primary-300'}`}
          >{y}</button>
        ))}
      </div>
      <div className="bg-blue-50 border border-blue-200 rounded-lg p-3 text-xs text-blue-700">
        Local income: Progressive 6%→18%→24%→30%→36% (after Rs.1,800,000 relief) |
        Foreign income: 6% on first Rs.1,000,000 taxable → 15% MAX cap |
        Personal relief applied to local income first, balance to foreign income
      </div>
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
        <div className="card p-5">
          <SectionHead className="text-green-700">🇱🇰 Local Income (Sri Lanka)</SectionHead>
          <div className="space-y-3">
            <RsField label="Employment — Salary & Allowances" value={lSal} onChange={setLSal} />
            <RsField label="Bonus / Gratuity (always annual)" value={lBon} onChange={setLBon} />
            <RsField label="Business / Professional Net Profit" value={lBiz} onChange={setLBiz} />
            <RsField label="Rental Income (Gross)" hint="25% auto-relief applied" value={lRent} onChange={setLRent} tag="25% Relief" tagColor="green" />
            <RsField label="Other Local Income" value={lOth} onChange={setLOth} />
          </div>
        </div>
        <div className="card p-5">
          <SectionHead className="text-blue-700">🌏 Foreign Income</SectionHead>
          <div className="space-y-3 mb-4">
            <RsField label="Foreign Bank Remitted" hint="6% on first Rs.1M taxable; 15% on balance (IRD Table 08)" value={fBank} onChange={setFBank} tag="6%+15% Tiered" tagColor="blue" />
            <RsField label="Other Foreign Income" hint="Not via bank — normal graduated rates apply" value={fOther} onChange={setFOther} tag="Graduated Rates" tagColor="red" />
          </div>
          <SectionHead>🏦 Tax Credits</SectionHead>
          <div className="space-y-3">
            <RsField label="APIT / WHT / Prior Instalments" value={credits} onChange={setCreds} />
          </div>
        </div>
      </div>

      {totalAss > 0 && (
        <div className="card p-5">
          <div className="text-sm font-bold text-primary-700 border-b border-gray-100 pb-2 mb-4">Mixed Income Tax Computation — Y/A {year}</div>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-5 text-sm">
            <div className="space-y-1.5">
              <Row label="Local Standard Income" value={fmtRs(localStd)} />
              {lRentRel > 0 && <Row label="Rental Relief (25%)" value={`(${fmtRs(lRentRel)})`} className="text-green-700" />}
              {v(fBank) > 0 && <Row label="Foreign Bank Income" value={fmtRs(v(fBank))} className="text-blue-700" />}
              {v(fOther) > 0 && <Row label="Other Foreign Income" value={fmtRs(v(fOther))} />}
              <Row label="Total Assessable Income" value={fmtRs(totalAss)} bold className="border-t border-gray-100 pt-2" />
              <Row label="Less: Personal Relief" value={`(${fmtRs(Math.min(PR, localStd))})`} className="text-green-700" />
              <Row label="Taxable Local + Other Foreign" value={fmtRs(taxableL + taxableFO)} bold />
              {taxableFB > 0 && <Row label="Taxable Foreign Bank" value={fmtRs(taxableFB)} className="text-blue-700" />}
            </div>
            <div className="space-y-1.5">
              {localDetail.filter(d => d.taxed > 0).map((d, i) => (
                <div key={i} className="flex justify-between text-xs text-gray-500 py-0.5">
                  <span>Local {fmtRs(d.taxed)} @ {(d.rate * 100).toFixed(0)}%</span><span>{fmtRs(d.tax)}</span>
                </div>
              ))}
              {fbBands.map((b, i) => (
                <div key={i} className="flex justify-between text-xs text-blue-600 py-0.5">
                  <span>Foreign: {b.label}</span><span>{fmtRs(b.tax)}</span>
                </div>
              ))}
              <Row label="Gross Tax" value={fmtRs(grossTax)} bold className="border-t border-gray-100 pt-2" />
              {v(credits) > 0 && <Row label="Less: Tax Credits" value={`(${fmtRs(v(credits))})`} className="text-green-700" />}
              <div className={`border-t-2 pt-3 mt-2 rounded-xl p-3 ${
                taxStatus === 'payable' ? 'bg-red-50 border-red-200' :
                taxStatus === 'refund'  ? 'bg-green-50 border-green-200' : 'bg-gray-50 border-gray-200'
              }`}>
                <div className={`text-xs font-bold mb-1 ${taxStatus === 'payable' ? 'text-red-600' : taxStatus === 'refund' ? 'text-green-600' : 'text-gray-500'}`}>
                  {taxStatus === 'payable' ? '⚠️ TAX PAYABLE' : taxStatus === 'refund' ? '✅ TAX REFUNDABLE' : '✅ NIL TAX'}
                </div>
                <div className={`text-2xl font-black ${taxStatus === 'payable' ? 'text-red-700' : taxStatus === 'refund' ? 'text-green-700' : 'text-gray-700'}`}>
                  {fmtRs(Math.abs(netTax))}
                </div>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// ═══════════════════════════════════════════════════════════
//  TAB 3 — Monthly Income Breakdown (Apr → Mar)
// ═══════════════════════════════════════════════════════════
function MonthlyTab() {
  const [data, setData] = useState(() => {
    const d = {};
    MONTHLY_ROWS.forEach(r => { d[r.id] = Array(12).fill(''); });
    return d;
  });

  const update = (rowId, mi, val) => setData(prev => {
    const n = { ...prev }; n[rowId] = [...n[rowId]]; n[rowId][mi] = val; return n;
  });

  const rowTotal = (id) => data[id].reduce((a, b) => a + v(b), 0);
  const colTotal = (mi) => MONTHLY_ROWS.reduce((a, r) => a + v(data[r.id][mi]), 0);
  const grandTotal = MONTHLY_ROWS.reduce((a, r) => a + rowTotal(r.id), 0);

  const clearAll = () => {
    const d = {};
    MONTHLY_ROWS.forEach(r => { d[r.id] = Array(12).fill(''); });
    setData(d);
  };

  return (
    <div className="space-y-4">
      <div className="card p-4">
        <div className="flex items-center justify-between mb-2">
          <div>
            <div className="text-sm font-bold text-primary-800">Monthly Income Entry — April to March (Y/A 2025/26)</div>
            <div className="text-xs text-gray-500">Enter each month's income separately for a full annual breakdown</div>
          </div>
          <button onClick={clearAll} className="text-xs text-gray-500 border border-gray-200 rounded-lg px-3 py-1.5 hover:bg-gray-50 transition-colors">↺ Clear All</button>
        </div>
        <div className="bg-blue-50 border border-blue-200 rounded p-2 text-xs text-blue-700 mb-3">
          ℹ️ Enter each month's income. Annual totals are calculated automatically. Use the IIT Calculator tab to enter these totals for tax computation.
        </div>

        <div className="overflow-x-auto">
          <table className="text-xs border-collapse" style={{ minWidth: '1100px', width: '100%' }}>
            <thead>
              <tr className="bg-primary-700 text-white">
                <th className="border border-primary-600 p-2 text-left sticky left-0 bg-primary-700 z-10" style={{ minWidth: '150px' }}>Income Type</th>
                {MONTHS.map(m => <th key={m} className="border border-primary-600 p-1.5 text-center" style={{ minWidth: '75px' }}>{m}</th>)}
                <th className="border border-primary-600 p-2 bg-green-700 text-right" style={{ minWidth: '110px' }}>Annual Total</th>
              </tr>
            </thead>
            <tbody>
              {MONTHLY_ROWS.map((row, ri) => {
                const total = rowTotal(row.id);
                return (
                  <tr key={row.id} className={ri % 2 === 0 ? 'bg-white' : 'bg-gray-50'}>
                    <td className="border border-gray-200 p-2 font-medium sticky left-0 z-10 text-xs" style={{ background: ri % 2 === 0 ? '#fff' : '#f9fafb' }}>
                      {row.label}
                    </td>
                    {data[row.id].map((val, mi) => (
                      <td key={mi} className="border border-gray-200 p-0.5">
                        <input
                          type="number" min="0" placeholder="0" value={val}
                          onChange={e => update(row.id, mi, e.target.value)}
                          className="w-full px-1 py-1 text-xs border-0 bg-transparent text-right focus:outline-none focus:bg-blue-50 rounded"
                        />
                      </td>
                    ))}
                    <td className="border border-gray-200 p-2 text-right font-bold bg-green-50 text-green-800">
                      {total > 0 ? fmtRs(total) : '—'}
                    </td>
                  </tr>
                );
              })}
            </tbody>
            <tfoot>
              <tr className="bg-gray-800 text-white font-bold">
                <td className="border border-gray-600 p-2 sticky left-0 bg-gray-800 z-10 text-xs">📊 Monthly Total</td>
                {MONTHS.map((_, mi) => {
                  const tot = colTotal(mi);
                  return (
                    <td key={mi} className="border border-gray-600 p-1.5 text-center text-xs">
                      {tot > 0 ? fmtRs(tot) : '—'}
                    </td>
                  );
                })}
                <td className="border border-gray-600 p-2 text-right bg-green-700 text-sm">{fmtRs(grandTotal)}</td>
              </tr>
            </tfoot>
          </table>
        </div>

        {/* Summary cards */}
        {grandTotal > 0 && (
          <div className="mt-4">
            <div className="text-xs font-semibold text-gray-500 uppercase tracking-wider mb-2">Annual Income Summary</div>
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
              {MONTHLY_ROWS.filter(r => rowTotal(r.id) > 0).map(r => (
                <div key={r.id} className="bg-primary-50 border border-primary-100 rounded-lg p-2.5 text-center">
                  <div className="text-xs text-primary-600 mb-1">{r.label}</div>
                  <div className="text-sm font-bold text-primary-800">{fmtRs(rowTotal(r.id))}</div>
                </div>
              ))}
            </div>
            <div className="bg-green-600 text-white rounded-xl p-3 text-center mt-3">
              <div className="text-xs opacity-80 mb-1">Grand Total Annual Income</div>
              <div className="text-2xl font-black">{fmtRs(grandTotal)}</div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

// ─── Shared UI helpers ────────────────────────────────────
function SectionHead({ children, className = '' }) {
  return (
    <div className={`text-xs font-bold text-primary-700 uppercase tracking-wider border-b border-gray-100 pb-2 mb-3 ${className}`}>
      {children}
    </div>
  );
}

function RsField({ label, hint, value, onChange, tag, tagColor, required }) {
  const colors = {
    amber: 'bg-amber-100 text-amber-700',
    green: 'bg-green-100 text-green-700',
    blue:  'bg-blue-100 text-blue-700',
    red:   'bg-red-100 text-red-700',
  };
  return (
    <div>
      <label className="flex items-center gap-2 text-sm text-gray-600 mb-1 flex-wrap">
        {label}
        {tag && <span className={`text-xs px-1.5 py-0.5 rounded font-medium ${colors[tagColor] || 'bg-gray-100 text-gray-600'}`}>{tag}</span>}
        {required && <span className="text-red-500 text-xs font-bold">*</span>}
      </label>
      <div className="relative">
        <span className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400 text-xs">Rs.</span>
        <input type="number" className="input pl-9" placeholder="0" value={value} onChange={e => onChange(e.target.value)} min="0" />
      </div>
      {hint && <p className="text-xs text-gray-400 mt-0.5 leading-relaxed">{hint}</p>}
    </div>
  );
}

function Row({ label, value, bold, className = '' }) {
  return (
    <div className={`flex justify-between ${className}`}>
      <span className={bold ? 'font-semibold text-gray-700' : 'text-gray-500'}>{label}</span>
      <span className={bold ? 'font-semibold' : ''}>{value}</span>
    </div>
  );
}
