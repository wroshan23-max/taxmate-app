import { useMemo, useState } from 'react';
import toast from 'react-hot-toast';
import {
  Briefcase, Store, Landmark, Globe2, Sparkles, HeartHandshake, Receipt, ShieldOff, ChevronDown, ChevronRight,
  Save, Printer, Copy, Users, FileDown, RotateCcw, Info,
} from 'lucide-react';
import { supabase } from '../lib/supabase';
import { computeReturn, RETURN_YEARS, RETURN_MONTHLY_KEYS, annualToReturnInput, calcKind } from '../lib/iitCalc';
import { openStatement } from '../lib/iitStatement';
import { sheetToReturnInput } from '../lib/incomeSheet';

const rs = (n) => `Rs. ${Math.round(n || 0).toLocaleString('en-LK')}`;
const pct = (r) => `${Math.round(r * 100)}%`;
const toNum = (v) => { const n = Number(String(v ?? '').replace(/,/g, '')); return Number.isFinite(n) ? Math.max(0, n) : 0; };

// Field groups (cage-wise). fx: foreign-currency income remitted through a bank.
const SECTIONS = [
  { key: 'emp', icon: Briefcase, color: 'text-green-600', en: 'Employment income', si: 'රැකියා ආදායම', cage: 'Schedule 1 · Cage 10', fields: [
    ['empPrimary', 'Primary employment — salary & allowances'], ['empSecondary', 'Secondary employment'],
    ['empBenefits', 'Non-cash benefits'], ['empBonus', 'Bonus / lump sums', { annual: true }],
    ['empFx', 'Foreign employer — paid in foreign currency through a bank', { fx: true }],
  ] },
  { key: 'biz', icon: Store, color: 'text-orange-600', en: 'Business income', si: 'ව්‍යාපාරික ආදායම', cage: 'Schedule 2 · Cage 20', fields: [
    ['bizProfit', 'Sole proprietor / professional net profit'], ['bizPartner', 'Share of partnership income'],
    ['bizFx', 'Services to foreign clients — foreign currency through a bank', { fx: true }],
    ['bizLossBF', 'Business loss brought forward', { annual: true }],
  ] },
  { key: 'inv', icon: Landmark, color: 'text-indigo-600', en: 'Investment income', si: 'ආයෝජන ආදායම', cage: 'Schedule 3 · Cage 30', fields: [
    ['interest', 'Interest (gross, before WHT)'], ['rentGross', 'Rent received (gross) — 25% relief auto'], ['othInv', 'Other investment income'],
  ] },
  { key: 'oth', icon: Globe2, color: 'text-blue-600', en: 'Other & foreign income', si: 'වෙනත් / විදේශ ආදායම', cage: 'Schedule 4 · Cage 40', fields: [
    ['othInc', 'Other income'], ['forTaxable', 'Foreign income NOT remitted through a bank (normal rates)'],
    ['forFx', 'Other foreign-source income — foreign currency through a bank', { fx: true }],
  ] },
  { key: 'spec', icon: Sparkles, color: 'text-purple-600', en: 'Special rates', si: 'විශේෂ අනුපාත', cage: 'Cages 130 / 140', fields: [
    ['termBen', 'Terminal benefits (0% / 6% / 12%)', { annual: true }], ['invGain', 'Gains on investment assets (10%)', { annual: true }],
  ] },
  { key: 'rel', icon: HeartHandshake, color: 'text-pink-600', en: 'Reliefs & qualifying payments', si: 'සහන හා සුදුසුකම් ලත් ගෙවීම්', cage: 'Cages 60 / 100', fields: [
    ['solar', 'Solar panels (max Rs. 600,000)', { annual: true }], ['donCharity', 'Approved charities (max Rs. 75,000)', { annual: true }],
    ['donGovt', 'Donations to Government / specified funds', { annual: true }], ['qpOther', 'Other qualifying payments', { annual: true }],
  ] },
  { key: 'cr', icon: Receipt, color: 'text-teal-600', en: 'Tax already paid', si: 'දැනටමත් ගෙවූ බදු', cage: 'Schedule 9 · Cage 180', fields: [
    ['apitPrimary', 'APIT — primary employment (903)', { annual: true }], ['apitSecondary', 'APIT — secondary employment (904)', { annual: true }],
    ['whtInterest', 'WHT / AIT on interest (908)', { annual: true }], ['whtRent', 'WHT on rent (908)', { annual: true }],
    ['whtService', 'AIT on service fees (908)', { annual: true }], ['whtOther', 'Other WHT (908)', { annual: true }],
    ['instalments', 'Quarterly instalments paid (911)', { annual: true }], ['ftc', 'Foreign tax credit (901)', { annual: true }],
    ['termTaxDed', 'Tax deducted on terminal benefits (905)', { annual: true }], ['gainTaxPaid', 'Investment gain tax paid (909/910)', { annual: true }],
  ] },
  { key: 'ex', icon: ShieldOff, color: 'text-gray-500', en: 'Exempt income (declared only)', si: 'නිදහස් ආදායම', cage: 'Cage 210', fields: [
    ['forExempt', 'Exempt foreign income', { annual: true }], ['othExempt', 'Other exempt income', { annual: true }],
  ] },
];
const ALL_KEYS = SECTIONS.flatMap(s => s.fields.map(f => f[0]));

function Money({ value, onChange }) {
  const [focus, setFocus] = useState(false);
  const shown = focus || value === '' || value === undefined ? (value ?? '') : toNum(value).toLocaleString('en-LK');
  return (
    <div className="relative">
      <span className="absolute left-3 top-1/2 -translate-y-1/2 text-[11px] font-semibold text-gray-400">Rs.</span>
      <input className="input pl-10 py-2 text-right tabular-nums" inputMode="decimal" placeholder="0" value={shown}
        onFocus={() => setFocus(true)} onBlur={() => setFocus(false)} onChange={e => onChange(e.target.value.replace(/[^\d.]/g, ''))} />
    </div>
  );
}

function fromInitial(initial) {
  if (!initial?.input_data) return { f: {}, period: 'annual', year: '2025/26' };
  const d = initial.input_data;
  const src = calcKind(initial) === 'return' ? d : annualToReturnInput(d);   // old "Annual IIT" calcs open here too
  const f = Object.fromEntries(Object.entries(src).filter(([k, v]) => ALL_KEYS.includes(k) && v).map(([k, v]) => [k, String(v)]));
  return { f, period: d.period === 'monthly' ? 'monthly' : 'annual', year: RETURN_YEARS.includes(initial.year) ? initial.year : '2025/26' };
}

/** Cage-wise IIT Return computation (admin). */
export default function ReturnCalculator({ clients, user, initial, onNew, persistDraft }) {
  const ini = useMemo(() => fromInitial(initial), [initial]);
  const converted = initial && calcKind(initial) !== 'return';
  const [editingId, setEditingId] = useState(converted ? null : initial?.id ?? null);
  const [editingStatus, setEditingStatus] = useState(converted ? 'draft' : initial?.status ?? 'draft');
  const [label, setLabel] = useState(initial?.label ?? '');
  const [clientId, setClientId] = useState(initial?.client_id ?? '');
  const [share, setShare] = useState(initial?.shared_with_client ?? false);
  const [year, setYear] = useState(ini.year);
  const [period, setPeriod] = useState(ini.period);
  const [f, setF] = useState(ini.f);
  const [open, setOpen] = useState(() => {
    const o = { emp: true };
    SECTIONS.forEach(s => { if (s.fields.some(([k]) => ini.f[k])) o[s.key] = true; });
    return o;
  });
  const [saving, setSaving] = useState(false);

  const input = useMemo(() => ({ ...Object.fromEntries(Object.entries(f).map(([k, v]) => [k, toNum(v)])), period }), [f, period]);
  const r = useMemo(() => computeReturn(year, input), [year, input]);
  const client = clients.find(c => c.id === clientId);
  const monthly = period === 'monthly';
  const set = (k) => (v) => setF(p => ({ ...p, [k]: v }));
  const secTotal = (s) => s.fields.reduce((a, [k]) => a + toNum(f[k]) * (monthly && RETURN_MONTHLY_KEYS.includes(k) ? 12 : 1), 0);
  const ystart = parseInt(year, 10);

  const record = () => ({
    year, calc_type: 'annual',
    input_data: { form: 'IIT_RETURN', ...input },
    result_data: {
      totalAssessable: r.cage50, totalQP: r.cage100, taxableStd: r.cage120, grossTax: r.cage170,
      totalWHT: r.cage180, netTax: r.balance, effRate: r.effRate,
      net_tax: r.balance, gross_tax: r.cage170, total_assessable: r.cage50,
      stdResult: { slabs: [
        ...r.prog.detail.filter(s => s.taxed > 0).map(s => ({ label: `${rs(s.taxed)} @ ${pct(s.rate)}`, tax: s.tax })),
        ...r.fx.bands.map(b => ({ label: `Foreign ${rs(b.taxed)} @ ${pct(b.rate)}`, tax: b.tax })),
        ...(r.term.tax > 0 ? [{ label: 'Terminal benefits tax', tax: r.term.tax }] : []),
        ...(r.gainTax > 0 ? [{ label: 'Investment gains @ 10%', tax: r.gainTax }] : []),
      ] },
      cages: { 10: r.cage10, 20: r.cage20, 30: r.cage30, 40: r.cage40, 50: r.cage50, 60: r.reliefs, 100: r.cage100, 120: r.cage120, 130: r.term.tax, 140: r.gainTax, 170: r.cage170, 180: r.cage180, 190: Math.max(0, r.balance), 200: Math.max(0, -r.balance), 210: r.cage210 },
      personalRelief: r.prUsed, solarRelief: r.solarUsed, foreignTax: r.fx.tax, sources: r.sources,
    },
  });

  const save = async (asNew) => {
    if (!clientId) return toast.error('Select a client first');
    setSaving(true);
    const rec = { ...record(), client_id: clientId, shared_with_client: share, label: label.trim() || null };
    const res = await persistDraft({ rec, editingId, editingStatus, asNew, userId: user.id });
    setSaving(false);
    if (res.error) return toast.error(res.error.message);
    const updated = editingId === res.data.id;
    setEditingId(res.data.id); setEditingStatus('draft');
    toast.success(updated ? 'Draft updated' : 'Saved as a new draft version');
  };

  const pdf = () => {
    const rec = { ...record(), label: label.trim() || null, status: editingId ? editingStatus : 'draft' };
    if (!openStatement(rec, client ?? {})) toast.error('Pop-up blocked — allow pop-ups for this site');
  };

  const copyCages = async () => {
    const L = [
      `TaxMate Solutions — IIT Return Y/A ${year}${client ? ` — ${client.full_name}` : ''}`,
      `Cage 10  Employment income: ${rs(r.cage10)}`, `Cage 20  Business income: ${rs(r.cage20)}`,
      `Cage 30  Investment income: ${rs(r.cage30)}`, `Cage 40  Other income: ${rs(r.cage40)}`,
      `Cage 50  Total assessable income: ${rs(r.cage50)}`, `Cage 60  Reliefs: ${rs(r.reliefs)} (personal ${rs(r.prUsed)}, rent ${rs(r.rentRelief)}, solar ${rs(r.solarUsed)})`,
      `Cage 100 Qualifying payments: ${rs(r.cage100)}`, `Cage 120 Taxable income: ${rs(r.cage120)}`,
      `         Tax at progressive rates (809A): ${rs(r.prog.tax)}`,
      ...(r.fx.tax > 0 ? [`         Foreign-currency income tax (809B): ${rs(r.fx.tax)}`] : []),
      `Cage 130 Terminal benefits: ${rs(r.term.tax)}`, `Cage 140 Investment gains: ${rs(r.gainTax)}`,
      `Cage 170 Total tax payable: ${rs(r.cage170)}`, `Cage 180 Total credits: ${rs(r.cage180)}`,
      ...r.credits.filter(x => x.amt > 0).map(x => `         ${x.cage} ${x.label}: ${rs(x.amt)}`),
      r.balance >= 0 ? `Cage 190 Balance tax payable: ${rs(r.balance)}` : `Cage 200 Refund: ${rs(-r.balance)}`,
      `Cage 210 Exempt income: ${rs(r.cage210)}`,
    ];
    try { await navigator.clipboard.writeText(L.join('\n')); toast.success('Cage summary copied'); } catch { toast.error('Could not copy'); }
  };

  const importSheet = async () => {
    if (!clientId) return toast.error('Select a client first');
    const { data, error } = await supabase.from('income_sheets').select('*').eq('client_id', clientId).eq('year', year).maybeSingle();
    if (error) return toast.error(error.message);
    if (!data) return toast.error(`No monthly income sheet for Y/A ${year}. Enable one on the client's page.`);
    const { input: imp, bizLoss } = sheetToReturnInput(data.data);
    if (Object.keys(f).some(k => toNum(f[k])) && !window.confirm('Replace the income & tax-paid figures with the client\'s sheet? Reliefs and other fields you entered stay.')) return;
    const keep = Object.fromEntries(Object.entries(f).filter(([k]) => ['solar', 'donCharity', 'donGovt', 'qpOther', 'bizLossBF', 'termBen', 'invGain', 'forExempt', 'othExempt', 'ftc', 'instalments', 'termTaxDed', 'gainTaxPaid', 'apitSecondary', 'empSecondary', 'empBenefits', 'bizPartner', 'othInv', 'forTaxable'].includes(k)));
    setPeriod('annual');
    setF({ ...keep, ...Object.fromEntries(Object.entries(imp).map(([k, v]) => [k, String(v)])) });
    setOpen(o => ({ ...o, emp: true, biz: true, inv: true, oth: true, cr: true }));
    toast.success(`Imported ${data.status === 'open' ? 'draft ' : ''}sheet${bizLoss ? ` — note: business shows a loss of ${rs(bizLoss)}` : ''}`);
  };

  const status = r.taxStatus;
  const bands = [...r.prog.detail.filter(b => b.taxed > 0).map(b => ({ ...b, k: 'l' })), ...r.fx.bands.map(b => ({ ...b, k: 'f' }))];
  const maxTax = Math.max(1, ...bands.map(b => b.tax));
  const isDraftEdit = editingId && editingStatus !== 'final';

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="rounded-2xl bg-gradient-to-br from-primary-700 to-primary-900 text-white p-5 shadow-lg space-y-4">
        <div className="flex flex-wrap items-end gap-3">
          <div className="flex-1 min-w-[220px]">
            <label className="block text-xs text-primary-200 mb-1">Client</label>
            <div className="relative">
              <Users size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
              <select className="input pl-9 text-gray-800" value={clientId} onChange={e => setClientId(e.target.value)}>
                <option value="">— Select client —</option>
                {clients.map(c => <option key={c.id} value={c.id}>{c.full_name}{c.tin ? ` (${c.tin})` : ''}</option>)}
              </select>
            </div>
          </div>
          <button onClick={importSheet} className="px-3 py-2 rounded-lg bg-white/10 hover:bg-white/20 text-sm font-semibold flex items-center gap-1.5" title="Fill from the client's Monthly Income & Business sheet">
            <FileDown size={15} /> Import client's income sheet
          </button>
        </div>
        <div className="flex flex-wrap gap-3">
          <div className="flex bg-white/10 rounded-xl p-1">
            {RETURN_YEARS.map(y => <button key={y} onClick={() => setYear(y)} className={`px-3 py-1.5 rounded-lg text-sm font-semibold ${year === y ? 'bg-white text-primary-800' : 'text-primary-100 hover:bg-white/10'}`}>Y/A {y}</button>)}
          </div>
          <div className="flex bg-white/10 rounded-xl p-1">
            {[['annual', 'Annual amounts'], ['monthly', 'Monthly amounts']].map(([k, l]) => <button key={k} onClick={() => setPeriod(k)} className={`px-3 py-1.5 rounded-lg text-sm font-semibold ${period === k ? 'bg-gold-500 text-primary-900' : 'text-primary-100 hover:bg-white/10'}`}>{l}</button>)}
          </div>
        </div>
        <div className="text-xs text-primary-200 leading-relaxed">
          Y/A {year} (1 Apr {ystart} – 31 Mar {ystart + 1}) · Personal relief {rs(r.cfg.pr)} · Rates {r.cfg.slabText} ·
          Foreign currency via bank: {r.fxExempt ? <b className="text-white">exempt</b> : <b className="text-white">15% maximum</b>} ·
          Balance tax due 30 Sep {ystart + 1} · Return due 30 Nov {ystart + 1}
        </div>
      </div>

      {editingId && (
        <div className={`flex items-center gap-3 rounded-xl px-4 py-2 text-xs border ${editingStatus === 'final' ? 'bg-green-50 border-green-200 text-green-800' : 'bg-primary-50 border-primary-200 text-primary-800'}`}>
          {editingStatus === 'final' ? <>🔒 FINAL version open — saving creates a new draft.</> : <>✏️ Editing a draft.</>}
          <button onClick={onNew} className="ml-auto px-3 py-1 rounded-md bg-white border border-primary-200 hover:bg-primary-100 font-medium">+ New calculation</button>
        </div>
      )}
      {converted && <div className="rounded-xl px-4 py-2 text-xs border bg-amber-50 border-amber-200 text-amber-800">Opened an older "Annual IIT" calculation in the new return layout — saving creates a new draft.</div>}

      <div className="grid xl:grid-cols-[1fr_400px] gap-5 items-start">
        {/* Inputs */}
        <div className="space-y-3">
          {SECTIONS.map(s => {
            const tot = secTotal(s), isOpen = open[s.key];
            const Icon = s.icon;
            return (
              <div key={s.key} className="card overflow-hidden">
                <button onClick={() => setOpen(o => ({ ...o, [s.key]: !o[s.key] }))} className="w-full flex items-center gap-3 px-4 py-3 text-left hover:bg-gray-50">
                  <Icon size={18} className={s.color} />
                  <div className="flex-1 min-w-0">
                    <div className="font-semibold text-gray-800 text-sm">{s.en} <span className="font-normal text-gray-400">· {s.si}</span></div>
                    <div className="text-[11px] text-gray-400">{s.cage}</div>
                  </div>
                  <span className={`text-sm font-bold tabular-nums ${tot ? 'text-primary-700' : 'text-gray-300'}`}>{tot ? rs(tot) : '—'}</span>
                  {isOpen ? <ChevronDown size={17} className="text-gray-400" /> : <ChevronRight size={17} className="text-gray-400" />}
                </button>
                {isOpen && (
                  <div className="px-4 pb-4 pt-1 grid sm:grid-cols-2 gap-3 border-t border-gray-100">
                    {s.fields.map(([k, lbl, o = {}]) => {
                      const perMonth = monthly && RETURN_MONTHLY_KEYS.includes(k);
                      return (
                        <div key={k} className={o.fx ? 'sm:col-span-2' : ''}>
                          <label className="block text-xs font-semibold text-gray-600 mb-1">
                            {lbl}
                            {o.fx && <span className={`ml-1.5 text-[10px] font-bold px-1.5 py-0.5 rounded ${r.fxExempt ? 'bg-gray-100 text-gray-500' : 'bg-blue-100 text-blue-700'}`}>{r.fxExempt ? 'EXEMPT 2024/25' : '15% MAX'}</span>}
                            <span className="ml-1 font-normal text-gray-400">{perMonth ? '/ month' : monthly ? '/ year' : ''}</span>
                          </label>
                          <Money value={f[k] ?? ''} onChange={set(k)} />
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            );
          })}
          <button onClick={() => { if (window.confirm('Clear all figures?')) setF({}); }} className="text-xs text-gray-500 hover:text-gray-700 flex items-center gap-1"><RotateCcw size={12} /> Clear all</button>
        </div>

        {/* Result */}
        <div className="xl:sticky xl:top-4 space-y-3">
          <div className="card overflow-hidden">
            <div className={`p-5 ${status === 'payable' ? 'bg-gradient-to-br from-red-600 to-red-700 text-white' : status === 'refund' ? 'bg-gradient-to-br from-green-600 to-green-700 text-white' : 'bg-gradient-to-br from-gray-600 to-gray-700 text-white'}`}>
              <div className="text-xs font-bold uppercase tracking-wider opacity-80">{status === 'payable' ? 'Balance tax payable · Cage 190' : status === 'refund' ? 'Refund · Cage 200' : 'Nil — fully settled'}</div>
              <div className="text-3xl font-black tabular-nums mt-1">{rs(Math.abs(r.balance))}</div>
              <div className="text-xs opacity-80 mt-1">Total tax {rs(r.cage170)} · credits {rs(r.cage180)} · effective {r.effRate}%</div>
            </div>
            <div className="p-4 text-sm space-y-0.5">
              {[
                ['10', 'Employment', r.cage10], ['20', 'Business', r.cage20], ['30', 'Investment', r.cage30], ['40', 'Other', r.cage40],
              ].map(([c, l, v]) => v > 0 && <div key={c} className="flex justify-between text-gray-600"><span><span className="text-[10px] text-gray-400 w-8 inline-block">{c}</span>{l}</span><span className="tabular-nums">{rs(v)}</span></div>)}
              <div className="flex justify-between font-bold border-t border-gray-100 pt-1.5 mt-1"><span><span className="text-[10px] text-gray-400 w-8 inline-block">50</span>Assessable income</span><span className="tabular-nums">{rs(r.cage50)}</span></div>
              <div className="flex justify-between text-green-700"><span><span className="text-[10px] text-gray-400 w-8 inline-block">60</span>Reliefs</span><span className="tabular-nums">− {rs(r.reliefs)}</span></div>
              {r.cage100 > 0 && <div className="flex justify-between text-green-700"><span><span className="text-[10px] text-gray-400 w-8 inline-block">100</span>Qualifying payments</span><span className="tabular-nums">− {rs(r.cage100)}</span></div>}
              <div className="flex justify-between font-bold border-t border-gray-100 pt-1.5 mt-1"><span><span className="text-[10px] text-gray-400 w-8 inline-block">120</span>Taxable income</span><span className="tabular-nums">{rs(r.cage120)}</span></div>
              {r.taxableFx > 0 && <div className="text-[11px] text-gray-500 pl-8">local {rs(r.taxableLocal)} · foreign currency {rs(r.taxableFx)}</div>}
            </div>
            {bands.length > 0 && (
              <div className="px-4 pb-3 space-y-1.5">
                <div className="text-[11px] font-semibold text-gray-500 uppercase tracking-wide">Tax by band</div>
                {bands.map((b, i) => (
                  <div key={i} className="text-xs">
                    <div className="flex justify-between"><span className="text-gray-600">{b.k === 'f' ? '🌍 ' : ''}{rs(b.taxed)} @ {pct(b.rate)}</span><span className="font-semibold tabular-nums">{rs(b.tax)}</span></div>
                    <div className="h-1.5 rounded-full bg-gray-100 mt-0.5"><div className={`h-full rounded-full ${b.k === 'f' ? 'bg-blue-500' : 'bg-primary-500'}`} style={{ width: `${Math.max(2, b.tax / maxTax * 100)}%` }} /></div>
                  </div>
                ))}
                {(r.term.tax > 0 || r.gainTax > 0) && <div className="text-xs text-gray-600 pt-1">{r.term.tax > 0 && <>Terminal benefits {rs(r.term.tax)} · </>}{r.gainTax > 0 && <>Investment gains {rs(r.gainTax)}</>}</div>}
              </div>
            )}
            {r.cage180 > 0 && (
              <div className="px-4 pb-4 text-xs space-y-0.5 border-t border-gray-100 pt-2">
                {r.credits.filter(x => x.amt > 0).map(x => <div key={x.cage} className="flex justify-between text-gray-600"><span>{x.cage} {x.label}</span><span className="tabular-nums">− {rs(x.amt)}</span></div>)}
              </div>
            )}
          </div>

          {/* Save */}
          <div className="card p-4 space-y-3">
            <input className="input" placeholder="Version name (optional) — e.g. Draft 1" value={label} onChange={e => setLabel(e.target.value)} maxLength={80} />
            <label className="flex items-center gap-2 text-sm text-gray-700 cursor-pointer">
              <input type="checkbox" checked={share} onChange={e => setShare(e.target.checked)} /> Show on client portal (client can review &amp; confirm)
            </label>
            {isDraftEdit ? (
              <div className="grid grid-cols-2 gap-2">
                <button onClick={() => save(false)} disabled={saving || !clientId} className="btn-primary justify-center text-sm"><Save size={14} /> {saving ? 'Saving…' : 'Update draft'}</button>
                <button onClick={() => save(true)} disabled={saving || !clientId} className="btn-secondary justify-center text-sm"><Save size={14} /> Save as new</button>
              </div>
            ) : (
              <button onClick={() => save(true)} disabled={saving || !clientId} className="btn-primary w-full justify-center"><Save size={15} /> {saving ? 'Saving…' : 'Save as draft'}</button>
            )}
            <div className="grid grid-cols-2 gap-2">
              <button onClick={pdf} className="btn-secondary justify-center text-sm"><Printer size={14} /> PDF statement</button>
              <button onClick={copyCages} className="btn-secondary justify-center text-sm"><Copy size={14} /> Copy cages</button>
            </div>
            {!clientId && <p className="text-xs text-amber-600">Select a client to save.</p>}
          </div>
          <p className="text-[11px] text-gray-500 flex gap-1.5"><Info size={12} className="flex-shrink-0 mt-0.5" />
            Reliefs and qualifying payments are set off against local income first; foreign-currency income uses only the unused part of the first Rs. 1,000,000 band at 6%, then 15% (IRD guide {year} examples).
            Verified against IRD guide 2025/26 examples 1, 2 &amp; 6.</p>
        </div>
      </div>
    </div>
  );
}
