import { useEffect, useMemo, useState } from 'react';
import toast from 'react-hot-toast';
import { FileSpreadsheet, Loader2, RefreshCw, Save, Printer, Plus, Trash2, AlertTriangle, CheckCircle2, XCircle, ChevronDown, Lock } from 'lucide-react';
import { supabase, fmtDate } from '../lib/supabase';
import { DRAFT_YEARS, DRAFT_STATUS, buildDraft, checkDraft, draftCages, openDraft, fmt2, r2 } from '../lib/ramisDraft';

// ─── Column sets for the editable tables ─────────────────────────
const T = {
  emp:      [['type', 'Type', 'w-32'], ['employer', 'Employer / company name'], ['tin', 'Employer TIN', 'w-32'], ['amount', 'Remuneration (Rs.)', 'w-36', 'money']],
  term:     [['type', 'Type', 'w-32'], ['employer', 'Employer / company name'], ['tin', 'Employer TIN', 'w-32'], ['amount', 'Terminal benefits (Rs.)', 'w-36', 'money']],
  sole:     [['code', 'Activity code', 'w-28'], ['nature', 'Nature of the business'], ['profit', 'Gains & profits (Rs.)', 'w-36', 'money'], ['turnover', 'Turnover (Rs.)', 'w-36', 'money']],
  partner:  [['code', 'Activity code', 'w-28'], ['name', 'Partnership name'], ['tin', 'Partnership TIN', 'w-32'], ['profit', 'Gains & profits (Rs.)', 'w-36', 'money']],
  inv:      [['code', 'Activity code', 'w-28'], ['type', 'Type of income'], ['amount', 'Gains & profits (Rs.)', 'w-36', 'money']],
  other:    [['type', 'Type of income'], ['amount', 'Gains & profits (Rs.)', 'w-36', 'money'], ['turnover', 'Turnover (Rs.)', 'w-36', 'money']],
  wht:      [['source', 'Source / type', 'w-32'], ['agentTin', 'Agent TIN', 'w-28'], ['cert', 'Certificate No.', 'w-28'], ['amount', 'Amount received (Rs.)', 'w-32', 'money'], ['date', 'Date of payment', 'w-32', 'date'], ['wht', 'AIT/WHT (Rs.)', 'w-28', 'money']],
  inst:     [['label', 'Instalment', 'w-32', 'ro'], ['due', 'Due date', 'w-28', 'ro'], ['date', 'Payment date', 'w-36', 'date'], ['amount', 'Amount paid (Rs.)', 'w-36', 'money']],
  immovable:[['situation', 'Situation of property'], ['acquired', 'Date acquired', 'w-32', 'date'], ['cost', 'Cost (Rs.)', 'w-32', 'money'], ['value', 'Market value (Rs.)', 'w-32', 'money']],
  vehicles: [['description', 'Description'], ['regno', 'Reg. No.', 'w-28'], ['acquired', 'Date acquired', 'w-32', 'date'], ['value', 'Cost / market value (Rs.)', 'w-32', 'money']],
  deposits: [['bank', 'Bank / institution'], ['acno', 'Account No.', 'w-28'], ['invested', 'Amount invested (Rs.)', 'w-32', 'money'], ['interest', 'Interest (Rs.)', 'w-28', 'money'], ['balance', 'Balance (Rs.)', 'w-32', 'money']],
  shares:   [['company', 'Company / institution'], ['units', 'No. of shares', 'w-24'], ['acquired', 'Date acquired', 'w-32', 'date'], ['value', 'Cost / market value (Rs.)', 'w-32', 'money'], ['dividend', 'Net dividend (Rs.)', 'w-28', 'money']],
  otherMovable: [['description', 'Description'], ['value', 'Value (Rs.)', 'w-32', 'money']],
  business: [['name', 'Name of business'], ['current', 'Current A/C (Rs.)', 'w-32', 'money'], ['capital', 'Capital A/C (Rs.)', 'w-32', 'money']],
  liabilities: [['description', 'Description of liability'], ['security', 'Security', 'w-28'], ['commenced', 'Commenced', 'w-32', 'date'], ['original', 'Original (Rs.)', 'w-28', 'money'], ['amount', 'Outstanding (Rs.)', 'w-28', 'money'], ['repaid', 'Repaid in Y/A (Rs.)', 'w-28', 'money']],
  acquired: [['description', 'Description of asset'], ['mode', 'Gift / exchange / purchase', 'w-36'], ['date', 'Date', 'w-32', 'date'], ['value', 'Cost / value (Rs.)', 'w-32', 'money']],
  disposed: [['description', 'Description'], ['date', 'Date of disposal', 'w-32', 'date'], ['proceeds', 'Sale proceeds (Rs.)', 'w-32', 'money'], ['acquired', 'Date acquired', 'w-32', 'date'], ['cost', 'Cost (Rs.)', 'w-28', 'money']],
};

const get = (o, path) => path.split('.').reduce((a, k) => a?.[k], o);
const setIn = (o, path, val) => {
  const keys = path.split('.'); const copy = structuredClone(o ?? {}); let cur = copy;
  keys.slice(0, -1).forEach(k => { cur[k] = cur[k] ?? {}; cur = cur[k]; });
  cur[keys.at(-1)] = val; return copy;
};
const total = (rows, k) => (rows ?? []).reduce((a, r) => a + (Number(String(r[k] ?? '').replace(/,/g, '')) || 0), 0);

function RowTable({ cols, rows = [], onChange, target, note, totalKey }) {
  const upd = (i, k, v) => onChange(rows.map((r, j) => (j === i ? { ...r, [k]: v } : r)));
  const moneyCol = totalKey ?? cols.find(c => c[3] === 'money' && ['amount', 'profit', 'wht', 'value', 'balance'].includes(c[0]))?.[0];
  const tot = moneyCol ? r2(total(rows, moneyCol)) : null;
  const fixed = cols.some(c => c[3] === 'ro');
  return (
    <div className="space-y-1.5">
      <div className="overflow-x-auto">
        <table className="w-full text-xs">
          <thead><tr className="text-gray-500 text-left">{cols.map(([k, l, w]) => <th key={k} className={`font-semibold px-1 py-1 ${w ?? ''}`}>{l}</th>)}{!fixed && <th className="w-8" />}</tr></thead>
          <tbody>
            {rows.map((r, i) => (
              <tr key={i}>
                {cols.map(([k, , w, kind]) => (
                  <td key={k} className={`px-1 py-0.5 ${w ?? ''}`}>
                    {kind === 'ro' ? <span className="text-gray-600">{r[k]}</span> :
                      <input className={`input py-1 px-2 text-xs ${kind === 'money' ? 'text-right' : ''}`} type={kind === 'date' ? 'date' : 'text'}
                        inputMode={kind === 'money' ? 'decimal' : undefined} value={r[k] ?? ''}
                        onChange={e => upd(i, k, kind === 'money' ? e.target.value.replace(/[^\d.,-]/g, '') : e.target.value)} />}
                  </td>
                ))}
                {!fixed && <td className="px-1"><button onClick={() => onChange(rows.filter((_, j) => j !== i))} className="p-1 text-gray-400 hover:text-red-600" title="Remove row"><Trash2 size={13} /></button></td>}
              </tr>
            ))}
            {rows.length === 0 && <tr><td colSpan={cols.length + 1} className="text-center text-gray-400 py-2">No rows</td></tr>}
          </tbody>
        </table>
      </div>
      <div className="flex items-center gap-2 text-[11px]">
        {!fixed && <button onClick={() => onChange([...rows, Object.fromEntries(cols.map(([k]) => [k, '']))])} className="inline-flex items-center gap-1 text-primary-700 font-semibold hover:underline"><Plus size={12} /> Add row</button>}
        {note && <span className="text-gray-400">{note}</span>}
        {tot !== null && <span className="ml-auto text-gray-600">Total <b>Rs. {fmt2(tot)}</b>{target !== undefined && <span className={Math.abs(tot - target) <= 1 ? ' text-emerald-700' : ' text-red-600'}> {Math.abs(tot - target) <= 1 ? '✓ matches' : `≠ Rs. ${fmt2(target)}`}</span>}</span>}
      </div>
    </div>
  );
}

function Section({ title, children, open: o = false, badge }) {
  const [open, setOpen] = useState(o);
  return (
    <div className="border border-gray-100 rounded-xl">
      <button onClick={() => setOpen(!open)} className="w-full flex items-center gap-2 px-3 py-2 text-sm font-semibold text-gray-800 hover:bg-gray-50 rounded-xl">
        <ChevronDown size={15} className={`transition-transform ${open ? '' : '-rotate-90'}`} />{title}{badge}
      </button>
      {open && <div className="px-3 pb-3 space-y-3">{children}</div>}
    </div>
  );
}

const Field = ({ label, value, onChange, w = '', type = 'text', money }) => (
  <label className={`text-[11px] font-semibold text-gray-500 ${w}`}>{label}
    <input className={`input mt-0.5 py-1 px-2 text-xs ${money ? 'text-right' : ''}`} type={type} value={value ?? ''} onChange={e => onChange(money ? e.target.value.replace(/[^\d.,-]/g, '') : e.target.value)} />
  </label>
);

/** Admin only: RAMIS "Individual income tax filing summary" draft for one client & Y/A. */
export default function RamisDraftAdmin({ client, calculations }) {
  const [year, setYear] = useState(DRAFT_YEARS[0]);
  const calcsFor = useMemo(() => calculations.filter(c => c.year === year && c.calc_type !== 'quarterly' && (c.input_data?.form === 'IIT_RETURN' || c.input_data?.form === 'IIT_RETURN_2425'))
    .sort((a, b) => (b.status === 'final') - (a.status === 'final') || new Date(b.created_at) - new Date(a.created_at)), [calculations, year]);
  const [calcId, setCalcId] = useState('');
  const [row, setRow] = useState(null);            // saved filing_drafts row
  const [data, setData] = useState(null);          // draft being edited
  const [ctx, setCtx] = useState({ sheet: null, al: null, docs: [] });
  const [busy, setBusy] = useState(false);
  const [dirty, setDirty] = useState(false);
  const [loading, setLoading] = useState(true);

  const calc = calculations.find(c => c.id === calcId) ?? null;

  const load = async () => {
    setLoading(true);
    const [d, s, a, docs] = await Promise.all([
      supabase.from('filing_drafts').select('*').eq('client_id', client.id).eq('year', year).maybeSingle(),
      supabase.from('income_sheets').select('id, status, data').eq('client_id', client.id).eq('year', year).maybeSingle(),
      supabase.from('asset_statements').select('id, status, data').eq('client_id', client.id).eq('year', year).maybeSingle(),
      supabase.from('client_documents').select('category, title, year, uploaded_role').eq('client_id', client.id).or(`year.eq.${year},year.is.null`).order('created_at'),
    ]);
    if (d.error && d.error.code !== 'PGRST116') toast.error(d.error.message);
    setRow(d.data ?? null); setData(d.data?.data ?? null); setDirty(false);
    setCtx({ sheet: s.data ?? null, al: a.data ?? null, docs: docs.data ?? [] });
    setCalcId(d.data?.calc_id && calculations.some(c => c.id === d.data.calc_id) ? d.data.calc_id : (calcsFor[0]?.id ?? ''));
    setLoading(false);
  };
  useEffect(() => { load(); }, [client.id, year]); // eslint-disable-line react-hooks/exhaustive-deps

  const checks = useMemo(() => (data && calc ? checkDraft(year, calc, data, ctx) : []), [data, calc, ctx, year]);
  const C = useMemo(() => (calc ? draftCages(year, calc.input_data || {}) : null), [calc, year]);
  const errs = checks.filter(c => c.level === 'error').length;
  const warns = checks.filter(c => c.level === 'warn').length;

  const generate = async () => {
    if (!calc) return toast.error('Choose the IIT return computation first');
    if (data && !window.confirm('Rebuild the draft from the latest data? Your edits in this draft will be replaced.')) return;
    const fresh = buildDraft({ year, calc, client, sheet: ctx.sheet, al: ctx.al, docs: ctx.docs });
    setBusy(true);
    const payload = { client_id: client.id, year, calc_id: calc.id, data: fresh, status: 'draft' };
    const { data: saved, error } = row
      ? await supabase.from('filing_drafts').update(payload).eq('id', row.id).select().single()
      : await supabase.from('filing_drafts').insert(payload).select().single();
    setBusy(false);
    if (error) return toast.error(error.message);
    setRow(saved); setData(saved.data); setDirty(false);
    toast.success('Draft built — review the checks, then fill certificate numbers, TINs and activity codes');
  };
  const save = async (status) => {
    if (!row) return;
    setBusy(true);
    const { data: saved, error } = await supabase.from('filing_drafts').update({ data, calc_id: calcId || null, ...(status ? { status } : {}) }).eq('id', row.id).select().single();
    setBusy(false);
    if (error) return toast.error(error.message);
    setRow(saved); setDirty(false); toast.success(status ? `Marked ${DRAFT_STATUS[status].label}` : 'Draft saved');
  };
  const open = () => {
    if (!data || !calc) return;
    if (!openDraft({ year, d: data, calc, client, checks })) toast.error('Pop-up blocked — allow pop-ups for this site');
  };
  const ed = (path) => (v) => { setData(d => setIn(d, path, v)); setDirty(true); };

  return (
    <div className="card">
      <div className="card-header flex-wrap gap-2"><FileSpreadsheet size={16} /> RAMIS filing draft
        <span className="text-[10px] font-bold uppercase tracking-wide bg-gray-800 text-white rounded px-1.5 py-0.5 inline-flex items-center gap-1"><Lock size={9} /> Admin only</span>
        {row && <span className={`text-[11px] font-semibold px-2 py-0.5 rounded-md ${DRAFT_STATUS[row.status]?.cls}`}>{DRAFT_STATUS[row.status]?.label}</span>}
        <select className="input w-auto py-1 text-xs ml-auto" value={year} onChange={e => setYear(e.target.value)}>{DRAFT_YEARS.map(y => <option key={y} value={y}>Y/A {y}</option>)}</select>
      </div>
      <div className="p-4 space-y-3">
        <p className="text-xs text-gray-500">Builds the RAMIS "Individual income tax filing summary" from the <b>final computation</b>, the client's <b>Monthly Income sheet</b>, <b>Assets &amp; Liabilities</b> and <b>documents</b>. Check it, fill certificate numbers / TINs / activity codes, then key it into RAMIS. Clients never see this.</p>
        {loading ? <div className="text-center py-4"><Loader2 className="animate-spin mx-auto text-gray-400" /></div> : <>
          <div className="grid sm:grid-cols-2 gap-3">
            <label className="text-xs font-semibold text-gray-600">IIT return computation
              <select className="input mt-1 text-sm" value={calcId} onChange={e => { setCalcId(e.target.value); setDirty(true); }}>
                {calcsFor.length === 0 && <option value="">No IIT return computation for Y/A {year}</option>}
                {calcsFor.map(c => <option key={c.id} value={c.id}>{c.status === 'final' ? '✅ FINAL' : '📝 DRAFT'} · {c.label || 'IIT computation'} · {fmtDate(c.created_at)}</option>)}
              </select>
            </label>
            <div className="text-xs text-gray-600 grid grid-cols-2 gap-1 self-end">
              <span>{ctx.sheet ? '✅' : '➖'} Monthly Income {ctx.sheet ? `(${ctx.sheet.status})` : ''}</span>
              <span>{ctx.al ? '✅' : '⚠️'} Assets &amp; Liabilities {ctx.al ? `(${ctx.al.status})` : ''}</span>
              <span>📎 {ctx.docs.length} document{ctx.docs.length === 1 ? '' : 's'}</span>
              {C && <span>Tax Rs. {fmt2(C.c170)} · {C.c190 ? `Pay Rs. ${fmt2(C.c190)}` : `Refund Rs. ${fmt2(C.c200)}`}</span>}
            </div>
          </div>
          <div className="flex gap-2 flex-wrap">
            <button onClick={generate} disabled={busy || !calc} className="btn-primary text-xs py-1.5">{busy ? <Loader2 size={13} className="animate-spin" /> : data ? <RefreshCw size={13} /> : <FileSpreadsheet size={13} />} {data ? 'Rebuild from data' : 'Build draft'}</button>
            {data && <>
              <button onClick={() => save()} disabled={busy || !dirty} className="btn-secondary text-xs py-1.5"><Save size={13} /> Save</button>
              <button onClick={open} disabled={!calc} className="btn-secondary text-xs py-1.5"><Printer size={13} /> Open / Print</button>
              <select className="input w-auto py-1 text-xs" value={row?.status ?? 'draft'} onChange={e => { if (e.target.value === 'filed' && errs && !window.confirm(`${errs} check(s) still need fixing. Mark as filed anyway?`)) return; save(e.target.value); }}>
                {Object.entries(DRAFT_STATUS).map(([k, s]) => <option key={k} value={k}>{s.label}</option>)}
              </select>
              {row?.updated_at && <span className="text-[11px] text-gray-400 self-center">Saved {fmtDate(row.updated_at)}</span>}
            </>}
          </div>

          {data && calc && <>
            <div className={`rounded-xl p-3 text-xs ${errs ? 'bg-red-50 border border-red-100' : warns ? 'bg-amber-50 border border-amber-100' : 'bg-emerald-50 border border-emerald-100'}`}>
              <div className="font-bold mb-1">{errs ? `${errs} to fix` : 'No blocking issues'}{warns ? ` · ${warns} to check` : ''}</div>
              <ul className="space-y-0.5">
                {checks.map((c, i) => (
                  <li key={i} className="flex gap-1.5">{c.level === 'error' ? <XCircle size={13} className="text-red-600 flex-shrink-0 mt-0.5" /> : c.level === 'warn' ? <AlertTriangle size={13} className="text-amber-600 flex-shrink-0 mt-0.5" /> : <CheckCircle2 size={13} className="text-emerald-600 flex-shrink-0 mt-0.5" />}<span>{c.msg}</span></li>
                ))}
              </ul>
            </div>

            <div className="space-y-2">
              <Section title="Taxpayer & declaration" open>
                <div className="grid sm:grid-cols-4 gap-2">
                  <Field label="TIN" value={data.header?.tin} onChange={ed('header.tin')} />
                  <Field label="Name of taxpayer" value={data.header?.name} onChange={ed('header.name')} w="sm:col-span-2" />
                  <div className="flex gap-3 items-end text-xs pb-1.5">
                    <label className="inline-flex items-center gap-1"><input type="checkbox" checked={!!data.header?.resident} onChange={e => ed('header.resident')(e.target.checked)} /> Resident</label>
                    <label className="inline-flex items-center gap-1"><input type="checkbox" checked={!!data.header?.senior} onChange={e => ed('header.senior')(e.target.checked)} /> Senior citizen</label>
                  </div>
                </div>
                <div className="grid sm:grid-cols-3 gap-2">
                  <Field label="Declarant full name" value={data.decl?.declarant?.name} onChange={ed('decl.declarant.name')} w="sm:col-span-2" />
                  <Field label="Declarant NIC" value={data.decl?.declarant?.nic} onChange={ed('decl.declarant.nic')} />
                  <Field label="Telephone" value={data.decl?.declarant?.phone} onChange={ed('decl.declarant.phone')} />
                  <Field label="Mobile" value={data.decl?.declarant?.mobile} onChange={ed('decl.declarant.mobile')} />
                  <Field label="Email" value={data.decl?.declarant?.email} onChange={ed('decl.declarant.email')} />
                </div>
                <label className="text-xs inline-flex items-center gap-1.5"><input type="checkbox" checked={!!data.decl?.preparedByOther} onChange={e => ed('decl.preparedByOther')(e.target.checked)} /> Return prepared by another person (Part A — TaxMate)</label>
                {data.decl?.preparedByOther && <div className="grid sm:grid-cols-3 gap-2">
                  <Field label="Preparer name" value={data.decl?.preparer?.name} onChange={ed('decl.preparer.name')} />
                  <Field label="Designation" value={data.decl?.preparer?.designation} onChange={ed('decl.preparer.designation')} />
                  <Field label="Date of certification" type="date" value={data.decl?.preparer?.date} onChange={ed('decl.preparer.date')} />
                </div>}
              </Section>
              <Section title="Schedule 1 — Employment income" badge={C?.c10 ? <span className="text-[11px] text-gray-400 font-normal">cage 10: Rs. {fmt2(C.c10)}</span> : null}>
                <RowTable cols={T.emp} rows={data.sch1?.emp} onChange={ed('sch1.emp')} target={C?.c10} note="Type: Primary / Secondary / Foreign. TIN from the T-10." />
                <RowTable cols={T.term} rows={data.sch1?.term} onChange={ed('sch1.term')} target={C?.c802} />
              </Section>
              <Section title="Schedule 2 — Business income" badge={C?.c20 ? <span className="text-[11px] text-gray-400 font-normal">cage 20: Rs. {fmt2(C.c20)}</span> : null}>
                <RowTable cols={T.sole} rows={data.sch2?.sole} onChange={ed('sch2.sole')} note="Sole proprietorship. Pick the activity code in RAMIS." />
                <RowTable cols={T.partner} rows={data.sch2?.partner} onChange={ed('sch2.partner')} />
              </Section>
              <Section title="Schedule 3 — Investment income" badge={C?.c30 ? <span className="text-[11px] text-gray-400 font-normal">cage 30: Rs. {fmt2(C.c30)}</span> : null}>
                <RowTable cols={T.inv} rows={data.sch3?.inv} onChange={ed('sch3.inv')} target={C?.c30} note="Tip: one row per bank certificate (interest code 000121), like RAMIS." />
              </Section>
              <Section title="Schedule 4 — Other income & 210A" badge={C?.c40 ? <span className="text-[11px] text-gray-400 font-normal">cage 40: Rs. {fmt2(C.c40)}</span> : null}>
                <RowTable cols={T.other} rows={data.sch4?.other} onChange={ed('sch4.other')} target={C?.c40} />
                {C?.c210A > 0 && <p className="text-[11px] text-gray-500">Foreign currency remitted (cage 210A / 404–406) is taken from the computation: Rs. {fmt2(C.c210A)}.</p>}
              </Section>
              <Section title="Schedule 5 — Donations & solar">
                <div className="grid sm:grid-cols-4 gap-2">
                  <Field label="Approved charity — paid" money value={data.sch5?.charityPaid} onChange={ed('sch5.charityPaid')} />
                  <Field label="Government — paid" money value={data.sch5?.govt} onChange={ed('sch5.govt')} />
                  <Field label="Solar — total expenditure (511)" money value={data.sch5?.solarExp} onChange={ed('sch5.solarExp')} />
                  <Field label="Solar — carried forward (513)" money value={data.sch5?.solarCF} onChange={ed('sch5.solarCF')} />
                </div>
                <p className="text-[11px] text-gray-400">Deductible amounts (cage 100 / 70) come from the computation.</p>
              </Section>
              <Section title="Schedule 7 — AIT / WHT certificates" badge={C?.credit?.['908'] ? <span className="text-[11px] text-gray-400 font-normal">cage 908: Rs. {fmt2(C.credit['908'])}</span> : null}>
                <RowTable cols={T.wht} rows={data.sch7?.wht} onChange={ed('sch7.wht')} totalKey="wht" target={C?.credit?.['908'] ?? 0} note="One row per certificate. Source: I-INTEREST, I-RENT, B-… (business)." />
              </Section>
              <Section title="Schedule 9B — Instalments paid" badge={C?.credit?.['911'] ? <span className="text-[11px] text-gray-400 font-normal">cage 911: Rs. {fmt2(C.credit['911'])}</span> : null}>
                <RowTable cols={T.inst} rows={data.sch9b?.inst} onChange={ed('sch9b.inst')} target={C?.credit?.['911'] ?? 0} />
              </Section>
              <Section title="Statement of assets & liabilities">
                {[['immovable', 'A. Immovable properties'], ['vehicles', 'B i. Motor vehicles'], ['deposits', 'B ii. Bank balances & term deposits'], ['shares', 'B iii. Shares / securities'], ['otherMovable', 'Other movable assets'], ['business', 'C. Properties held as part of business'], ['liabilities', 'D. Liabilities'], ['acquired', 'Part 2 A. Acquired / gifts received'], ['disposed', 'Part 2 B. Disposals']].map(([k, l]) => (
                  <div key={k}><div className="text-xs font-semibold text-gray-700 mb-1">{l}</div><RowTable cols={T[k]} rows={get(data, `assets.${k}`)} onChange={ed(`assets.${k}`)} /></div>
                ))}
                <div className="grid sm:grid-cols-3 gap-2">
                  <Field label="iv. Cash in hand (1019)" money value={data.assets?.c1019} onChange={ed('assets.c1019')} />
                  <Field label="v. Loans given (1020)" money value={data.assets?.c1020} onChange={ed('assets.c1020')} />
                  <Field label="vi. Gold, gems, jewellery (1021)" money value={data.assets?.c1021} onChange={ed('assets.c1021')} />
                </div>
              </Section>
              <Section title="TaxMate notes (printed at the end)">
                <textarea className="input text-xs" rows={3} maxLength={3000} value={data.notes ?? ''} onChange={e => ed('notes')(e.target.value)} placeholder="e.g. Interest certificates from BOC received 12 Oct; client to confirm vehicle value." />
              </Section>
            </div>
          </>}
        </>}
      </div>
    </div>
  );
}
