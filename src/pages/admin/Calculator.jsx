import { useEffect, useState } from 'react';
import { supabase, fmtRs } from '../../lib/supabase';
import { useAuth } from '../../contexts/AuthContext';
import toast from 'react-hot-toast';
import { Calculator as CalcIcon, Save, Share2, Users } from 'lucide-react';

const PR = 1800000;
const SLABS = [
  { limit: 500000, rate: 0.06 },
  { limit: 500000, rate: 0.18 },
  { limit: 500000, rate: 0.24 },
  { limit: 500000, rate: 0.30 },
  { limit: Infinity, rate: 0.36 },
];

function calcForeignTax(taxable) {
  if (taxable <= 0) return { tax: 0, bands: [] };
  if (taxable <= 1000000) {
    const t = Math.round(taxable * 0.06);
    return { tax: t, bands: [{ label: `First Rs.${taxable.toLocaleString()} @ 6%`, tax: t }] };
  }
  const t1 = Math.round(1000000 * 0.06);
  const t2 = Math.round((taxable - 1000000) * 0.15);
  return { tax: t1 + t2, bands: [{ label: 'First Rs.1,000,000 @ 6%', tax: t1 }, { label: `Balance Rs.${(taxable - 1000000).toLocaleString()} @ 15%`, tax: t2 }] };
}

function graduatedTax(taxable) {
  let remaining = taxable, tax = 0, detail = [];
  for (const s of SLABS) {
    const taxed = Math.min(remaining, s.limit);
    const t = Math.round(taxed * s.rate);
    detail.push({ rate: s.rate, taxed, tax: t, label: `Up to Rs.${s.limit === Infinity ? '∞' : s.limit.toLocaleString()}` });
    tax += t;
    remaining -= taxed;
    if (remaining <= 0) break;
  }
  return { tax, detail };
}

export default function Calculator() {
  const { user } = useAuth();
  const [clients, setClients] = useState([]);
  const [clientId, setClientId] = useState('');
  const [year, setYear] = useState('2026/27');
  const [shareWithClient, setShareWithClient] = useState(false);
  const [saving, setSaving] = useState(false);
  const [mode, setMode] = useState('annual'); // annual | quarterly

  // Annual inputs
  const [emp, setEmp] = useState('');
  const [biz, setBiz] = useState('');
  const [rentGross, setRentGross] = useState('');
  const [forBank, setForBank] = useState('');
  const [othInc, setOthInc] = useState('');
  const [donations, setDonations] = useState('');
  const [solar, setSolar] = useState('');
  const [whtApit, setWhtApit] = useState('');
  const [whtOth, setWhtOth] = useState('');

  // Quarterly inputs
  const [qPrevTax, setQPrevTax] = useState('');
  const [qPaid, setQPaid] = useState('');
  const [qNo, setQNo] = useState('1');

  useEffect(() => {
    supabase.from('clients').select('id, full_name, tin').order('full_name').then(({ data }) => setClients(data ?? []));
  }, []);

  const v = (s) => parseFloat(s) || 0;

  // Annual calculation
  const rentRel = Math.round(v(rentGross) * 0.25);
  const rentNet = v(rentGross) - rentRel;
  const stdIncome = v(emp) + v(biz) + rentNet + v(othInc);
  const totalAssessable = stdIncome + v(forBank);
  const donAllowed = Math.min(v(donations), 75000, stdIncome / 3);
  const solarAllowed = Math.min(v(solar), 600000);
  const totalQP = donAllowed + solarAllowed;
  const totalDed = PR + totalQP;
  const taxableStd = Math.max(0, stdIncome - totalDed);
  const unusedDed = Math.max(0, totalDed - stdIncome);
  const taxableFB = Math.max(0, v(forBank) - unusedDed);
  const stdResult = graduatedTax(taxableStd);
  const fbResult = calcForeignTax(taxableFB);
  const grossTax = stdResult.tax + fbResult.tax;
  const totalWHT = v(whtApit) + v(whtOth);
  const netTax = grossTax - totalWHT;
  const effRate = totalAssessable > 0 ? (grossTax / totalAssessable * 100).toFixed(2) : '0.00';

  // Quarterly calculation
  const B = [4, 3, 2, 1][parseInt(qNo) - 1];
  const qInstalment = Math.max(0, Math.round((v(qPrevTax) - v(qPaid)) / B));

  const saveCalc = async () => {
    if (!clientId) return toast.error('Select a client first');
    setSaving(true);
    const inputData = mode === 'annual'
      ? { emp: v(emp), biz: v(biz), rentGross: v(rentGross), forBank: v(forBank), othInc: v(othInc), donations: v(donations), solar: v(solar), whtApit: v(whtApit), whtOth: v(whtOth) }
      : { prevTax: v(qPrevTax), paid: v(qPaid), quarter: qNo };
    const resultData = mode === 'annual'
      ? { gross_tax: grossTax, net_tax: netTax, eff_rate: effRate, total_assessable: totalAssessable }
      : { instalment: qInstalment, quarter: qNo, b: B };

    const { error } = await supabase.from('iit_calculations').insert({
      client_id: clientId, year, calc_type: mode, input_data: inputData,
      result_data: resultData, shared_with_client: shareWithClient, created_by: user.id,
    });
    setSaving(false);
    if (error) { toast.error(error.message); return; }
    toast.success(shareWithClient ? 'Saved & shared with client!' : 'Calculation saved!');
  };

  const taxStatus = netTax > 0.5 ? 'payable' : netTax < -0.5 ? 'refund' : 'nil';

  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-2xl font-bold text-primary-800">IIT Calculator</h1>
        <p className="text-sm text-gray-500">Y/A 2025/26 · 2026/27 | IRD Sri Lanka | Personal Relief Rs. 1,800,000</p>
      </div>

      {/* Mode & Year */}
      <div className="card p-5 flex flex-wrap gap-4">
        <div className="flex-1 min-w-48">
          <label className="block text-xs font-semibold text-gray-500 mb-1">Client</label>
          <div className="relative">
            <Users size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
            <select className="input pl-9" value={clientId} onChange={e => setClientId(e.target.value)}>
              <option value="">— Select Client —</option>
              {clients.map(c => <option key={c.id} value={c.id}>{c.full_name} {c.tin ? `(${c.tin})` : ''}</option>)}
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
            <button onClick={() => setMode('annual')} className={`px-4 py-2 text-sm font-medium ${mode==='annual' ? 'bg-primary-600 text-white' : 'bg-white text-gray-600 hover:bg-gray-50'}`}>Annual</button>
            <button onClick={() => setMode('quarterly')} className={`px-4 py-2 text-sm font-medium ${mode==='quarterly' ? 'bg-primary-600 text-white' : 'bg-white text-gray-600 hover:bg-gray-50'}`}>Quarterly</button>
          </div>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
        {/* Input Panel */}
        {mode === 'annual' ? (
          <div className="space-y-4">
            <div className="card p-5">
              <div className="text-xs font-bold text-primary-700 uppercase tracking-wider border-b border-gray-100 pb-2 mb-4">Income</div>
              <div className="space-y-3">
                {[['Employment Income', emp, setEmp], ['Business / Professional', biz, setBiz], ['Rental Income (Gross)', rentGross, setRentGross], ['Foreign Bank Remitted', forBank, setForBank], ['Other Income', othInc, setOthInc]].map(([label, val, setter]) => (
                  <div key={label} className="flex items-center gap-2">
                    <label className="text-sm text-gray-600 w-48 flex-shrink-0">{label}</label>
                    <div className="flex-1 relative">
                      <span className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400 text-xs">Rs.</span>
                      <input type="number" className="input pl-9" placeholder="0" value={val} onChange={e => setter(e.target.value)} min="0" />
                    </div>
                  </div>
                ))}
              </div>
            </div>

            <div className="card p-5">
              <div className="text-xs font-bold text-primary-700 uppercase tracking-wider border-b border-gray-100 pb-2 mb-4">Deductions & Credits</div>
              <div className="space-y-3">
                {[['Donations (IRD Approved)', donations, setDonations], ['Solar Panel Relief', solar, setSolar], ['APIT / WHT Credit', whtApit, setWhtApit], ['Other WHT Credits', whtOth, setWhtOth]].map(([label, val, setter]) => (
                  <div key={label} className="flex items-center gap-2">
                    <label className="text-sm text-gray-600 w-48 flex-shrink-0">{label}</label>
                    <div className="flex-1 relative">
                      <span className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400 text-xs">Rs.</span>
                      <input type="number" className="input pl-9" placeholder="0" value={val} onChange={e => setter(e.target.value)} min="0" />
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </div>
        ) : (
          <div className="card p-5 space-y-4">
            <div className="text-xs font-bold text-primary-700 uppercase tracking-wider border-b border-gray-100 pb-2 mb-2">Quarterly Instalment — Formula: (A − C) ÷ B</div>
            <div className="bg-blue-50 border border-blue-200 rounded-lg p-3 text-xs text-blue-700">
              <strong>A</strong> = Preceding year gross tax &nbsp;|&nbsp; <strong>C</strong> = Credits + prior instalments paid &nbsp;|&nbsp; <strong>B</strong> = Remaining quarters
            </div>
            <div>
              <label className="text-xs font-semibold text-gray-500 mb-1 block">Current Quarter (Q{qNo})</label>
              <select className="input" value={qNo} onChange={e => setQNo(e.target.value)}>
                <option value="1">Q1 — Due 15 August (B=4)</option>
                <option value="2">Q2 — Due 15 November (B=3)</option>
                <option value="3">Q3 — Due 15 February (B=2)</option>
                <option value="4">Q4 — Due 15 May (B=1)</option>
              </select>
            </div>
            <div>
              <label className="text-xs font-semibold text-gray-500 mb-1 block">Preceding Year Gross Tax (A)</label>
              <div className="relative">
                <span className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400 text-xs">Rs.</span>
                <input type="number" className="input pl-9" placeholder="0" value={qPrevTax} onChange={e => setQPrevTax(e.target.value)} min="0" />
              </div>
            </div>
            <div>
              <label className="text-xs font-semibold text-gray-500 mb-1 block">Credits & Prior Instalments Paid (C)</label>
              <div className="relative">
                <span className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400 text-xs">Rs.</span>
                <input type="number" className="input pl-9" placeholder="0" value={qPaid} onChange={e => setQPaid(e.target.value)} min="0" />
              </div>
              <p className="text-xs text-gray-400 mt-1">Include APIT/WHT deducted + quarterly instalments already paid</p>
            </div>
          </div>
        )}

        {/* Results Panel */}
        <div className="space-y-4">
          {mode === 'annual' ? (
            <div className="card overflow-hidden">
              <div className="bg-primary-700 text-white px-5 py-3 text-sm font-semibold flex items-center gap-2">
                <CalcIcon size={15} /> Tax Computation
              </div>
              <div className="p-5 space-y-2 text-sm">
                <div className="flex justify-between"><span className="text-gray-500">Total Assessable Income</span><span className="font-semibold">{fmtRs(totalAssessable)}</span></div>
                <div className="flex justify-between text-green-700"><span>Less: Personal Relief</span><span>({fmtRs(Math.min(PR, stdIncome + v(forBank)))})</span></div>
                {totalQP > 0 && <div className="flex justify-between text-green-700"><span>Less: Qualifying Payments</span><span>({fmtRs(totalQP)})</span></div>}
                {rentGross > 0 && <div className="flex justify-between text-green-700"><span>Rental Relief (25%)</span><span>({fmtRs(rentRel)})</span></div>}
                <div className="flex justify-between font-semibold border-t border-gray-100 pt-2"><span>Taxable Standard Income</span><span>{fmtRs(taxableStd)}</span></div>
                {taxableFB > 0 && <div className="flex justify-between text-blue-700"><span>Taxable Foreign Bank Income</span><span>{fmtRs(taxableFB)}</span></div>}
                <div className="border-t border-gray-100 pt-2 mt-2">
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
                </div>
                <div className="flex justify-between font-semibold border-t border-gray-100 pt-2"><span>Gross Tax</span><span>{fmtRs(grossTax)}</span></div>
                {totalWHT > 0 && <div className="flex justify-between text-green-700"><span>Less: WHT / APIT Credits</span><span>({fmtRs(totalWHT)})</span></div>}
                <div className={`flex justify-between font-bold text-base border-t-2 pt-3 mt-2 ${taxStatus === 'payable' ? 'text-red-700 border-red-200' : taxStatus === 'refund' ? 'text-green-700 border-green-200' : 'text-gray-700 border-gray-200'}`}>
                  <span>{taxStatus === 'payable' ? '⚠️ Tax Payable' : taxStatus === 'refund' ? '✅ Tax Refundable' : '✅ Nil Tax'}</span>
                  <span>{fmtRs(Math.abs(netTax))}</span>
                </div>
                <div className="text-xs text-gray-400 pt-1">Effective Rate: {effRate}%</div>
              </div>
            </div>
          ) : (
            <div className="card overflow-hidden">
              <div className="bg-primary-700 text-white px-5 py-3 text-sm font-semibold flex items-center gap-2">
                <CalcIcon size={15} /> Q{qNo} Instalment
              </div>
              <div className="p-5 space-y-3 text-sm">
                <div className="flex justify-between"><span className="text-gray-500">Preceding Year Tax (A)</span><span className="font-semibold">{fmtRs(v(qPrevTax))}</span></div>
                <div className="flex justify-between text-green-700"><span>Credits & Prior Instalments (C)</span><span>({fmtRs(v(qPaid))})</span></div>
                <div className="flex justify-between"><span className="text-gray-500">Remaining Quarters (B)</span><span className="font-semibold">{B}</span></div>
                <div className="border-t-2 pt-3 mt-2">
                  <div className="text-xs text-gray-400 mb-1">= (A − C) ÷ B</div>
                  <div className="text-3xl font-black text-primary-700">{fmtRs(qInstalment)}</div>
                  <div className="text-xs text-gray-400 mt-1">Q{qNo} Instalment Due</div>
                </div>
              </div>
            </div>
          )}

          {/* Save & Share */}
          <div className="card p-4 space-y-3">
            <label className="flex items-center gap-3 cursor-pointer">
              <div className={`relative w-10 h-5 rounded-full transition-colors ${shareWithClient ? 'bg-green-500' : 'bg-gray-200'}`}
                onClick={() => setShareWithClient(!shareWithClient)}>
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
