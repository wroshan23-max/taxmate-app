import { useEffect, useState, useMemo } from 'react';
import TopUpCalc from '../../components/TopUpCalc';
import { useLocation, useNavigate } from 'react-router-dom';
import { supabase, fmtRs } from '../../lib/supabase';
import { useAuth } from '../../contexts/AuthContext';
import { Calculator as CalcIcon, FileSpreadsheet, FolderOpen, CalendarClock, Wallet } from 'lucide-react';

// Tax rules live in src/lib/iitCalc.js (shared with the client calculator, saved-calc viewer & PDF)
import { PR, graduatedTax, calcKind } from '../../lib/iitCalc';
import SavedCalculations from '../../components/SavedCalculations';
import ReturnCalculator from '../../components/ReturnCalculator';

const v = (s) => parseFloat(s) || 0;

const TABS = [
  { id: 'return', icon: FileSpreadsheet, label: 'IIT Return', sub: 'Y/A 2024/25 · 2025/26 · 2026/27' },
  { id: 'saved', icon: FolderOpen, label: 'Saved calculations', sub: 'Drafts, finals, send to client' },
  { id: 'apit', icon: Wallet, label: 'Monthly APIT', sub: 'Employer deduction (Table 01)' },
  { id: 'quarterly', icon: CalendarClock, label: 'Quarterly instalment', sub: '(A − C) ÷ B' },
];

// ─── Main Component ───────────────────────────────────────
export default function Calculator() {
  const { user } = useAuth();
  const location = useLocation();
  const navigate = useNavigate();
  const [clients, setClients] = useState([]);
  const [tab, setTab] = useState('return');
  const [loaded, setLoaded] = useState(null);   // { calc, nonce } — a saved calc opened for editing

  useEffect(() => {
    supabase.from('clients').select('id, full_name, tin, nic, address, employer, resident_status').is('archived_at', null).order('full_name').then(({ data }) => setClients(data ?? []));
  }, []);

  // Open a saved calculation (returns and older annual calculations open in the IIT Return)
  const openSaved = (calc) => {
    if (calcKind(calc) === 'quarterly') { setTab('quarterly'); return; }
    setTab('return');
    setLoaded({ calc, nonce: Date.now() });
  };
  const startNew = () => setLoaded({ calc: null, nonce: Date.now() });

  // Arriving from Client Detail → "Open in calculator"
  useEffect(() => {
    const c = location.state?.loadCalc;
    const fresh = location.state?.newReturn;     // e.g. from a client's income sheet → unsaved return
    if (c) openSaved(c);
    else if (fresh) { setTab('return'); setLoaded({ calc: fresh, nonce: Date.now() }); }
    if (c || fresh) navigate(location.pathname, { replace: true, state: null });
  }, [location.state]); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <div className="space-y-5">
      <div className="flex items-center gap-3">
        <div className="w-11 h-11 rounded-xl bg-primary-100 text-primary-700 flex items-center justify-center"><CalcIcon size={22} /></div>
        <div>
          <h1 className="text-2xl font-bold text-primary-800">Tax Calculator</h1>
          <p className="text-sm text-gray-500">IRD Sri Lanka · Y/A 2024/25 (relief Rs. 1,200,000) · 2025/26 &amp; 2026/27 (relief Rs. 1,800,000, foreign currency 15% max)</p>
        </div>
      </div>

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-2">
        {TABS.map(({ id, icon: Icon, label, sub }) => (
          <button key={id} onClick={() => setTab(id)}
            className={`text-left rounded-xl border-2 px-3 py-2.5 transition-all ${tab === id ? 'border-primary-500 bg-primary-50 shadow-sm' : 'border-gray-200 bg-white hover:border-primary-200'}`}>
            <div className="flex items-center gap-2"><Icon size={16} className={tab === id ? 'text-primary-600' : 'text-gray-400'} /><span className="font-semibold text-sm text-gray-800">{label}</span></div>
            <div className="text-[11px] text-gray-400 mt-0.5">{sub}</div>
          </button>
        ))}
      </div>

      {tab === 'return' && <ReturnCalculator key={`ret-${loaded?.nonce ?? 0}`} clients={clients} user={user} initial={loaded?.calc ?? null} onNew={startNew} persistDraft={persistDraft} />}
      {tab === 'saved' && <SavedCalculations onOpen={openSaved} />}
      {tab === 'apit' && <MonthlyAPIT />}
      {tab === 'quarterly' && <QuarterlyIIT />}
    </div>
  );
}

// Save a calculation as a DRAFT version.
//  - editing a draft + asNew=false → update that draft
//  - otherwise (new, "save as new version", or editing a FINAL) → insert a new draft
// Final versions are never overwritten; they are set in 🗂 Saved Calculations after the client confirms.
async function persistDraft({ rec, editingId, editingStatus, asNew, userId }) {
  const now = new Date().toISOString();
  if (editingId && !asNew && editingStatus !== 'final') {
    return supabase.from('iit_calculations').update({ ...rec, updated_at: now }).eq('id', editingId).select('id, status').single();
  }
  return supabase.from('iit_calculations')
    .insert({ ...rec, status: 'draft', created_by: userId }).select('id, status').single();
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
        <SectionHead>Monthly APIT — IRD APIT Tax Table 01 (from 1 April 2025)</SectionHead>
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
            📌 Table 01: regular monthly profits from primary employment. Lump-sum payments → Table 02 · once-and-for-all payments → Table 03 · joining / leaving mid-year, or cumulative pay over Rs. 1,800,000 → Table 05 · foreign employer paying in foreign currency → Table 08.
          </div>
          <div className="bg-green-50 border border-green-200 rounded p-2 text-xs text-green-700 mt-2">
            ✅ IRD has not issued separate 2026/27 tables; the 2025/26 tables continue. Personal relief Rs. 1,800,000 a year (Rs. 150,000 a month).
          </div>
        </div>
      </div>
    </div>
  );
}

// ─── Quarterly IIT Instalment Calculator ─────────────────
function QuarterlyIIT() {
  // Current Y/A (1 April – 31 March) and its instalment due dates
  const now = new Date();
  const ys = now.getMonth() >= 3 ? now.getFullYear() : now.getFullYear() - 1;
  const ya = `${ys}/${String(ys + 1).slice(2)}`;
  const prevYa = `${ys - 1}/${String(ys).slice(2)}`;
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
        <SectionHead>Quarterly IIT Instalment Calculator — Y/A {ya}</SectionHead>
        <div className="bg-blue-50 border border-blue-200 rounded-lg p-3 text-xs text-blue-700 mb-4">
          <strong>Formula: Instalment = (A − C) ÷ B</strong><br />
          A = Preceding year gross tax &nbsp;|&nbsp; C = Tax already paid this year &nbsp;|&nbsp; B = Remaining quarters including current<br />
        </div>

        <div className="mb-4">
          <label className="text-xs font-semibold text-gray-500 mb-1 block">Current Quarter</label>
          <select className="input max-w-sm" value={qNo} onChange={e => setQNo(e.target.value)}>
            <option value="1">Q1 — Due 15 August {ys} (Apr · May · Jun)</option>
            <option value="2">Q2 — Due 15 November {ys} (Jul · Aug · Sep)</option>
            <option value="3">Q3 — Due 15 February {ys + 1} (Oct · Nov · Dec)</option>
            <option value="4">Q4 — Due 15 May {ys + 1} (Jan · Feb · Mar)</option>
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
            <RsField label={`Preceding Year Gross Tax (A) — Y/A ${prevYa}`} hint="Gross IIT before credits from the 2025/26 return" value={prevTax} onChange={setPrevTax} required />
            <RsField label="Credits & Prior Instalments Paid (C)" hint={`APIT/WHT deducted + quarterly instalments already paid this Y/A ${ya}`} value={paid} onChange={setPaid} />
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
          ⚠️ Method 1 applies when the client had taxable income in the previous Y/A. Method 2 estimates from current quarter income — suitable for new clients or significantly changed income. Interest & penalties for non-payment cannot be waived.
        </div>
      </div>
    </div>
  );
}

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
        <input type="number" className="input pl-9 pr-9" placeholder="0" value={value} onChange={e => onChange(e.target.value)} min="0" />
        <TopUpCalc value={value} onUse={onChange} />
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
