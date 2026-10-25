import { useEffect, useMemo, useRef, useState } from 'react';
import toast from 'react-hot-toast';
import {
  Users, Plus, Save, Lock, Unlock, Trash2, MessageCircle, Printer, Building2, Upload, Download, ChevronDown, ChevronUp,
  Loader2, RefreshCw, Pencil, FileSpreadsheet, CalendarPlus, X, Check, Info,
} from 'lucide-react';
import { supabase } from '../lib/supabase';
import {
  calcLine, totalsOf, lineFromEmployee, VAR_EARN, VAR_DED, periodLabel, nextPeriod, thisPeriod, rsx, dueDates,
  openPayslips, openSummary, csvEpf, csvApit, csvBank, payslipWhatsApp, importTemplate, parseStaffCsv, EPF_EE, EPF_ER, ETF_ER,
} from '../lib/payroll';

const EMPTY_EMP = { emp_no: '', full_name: '', nic: '', designation: '', epf_no: '', join_date: '', mobile: '', email: '', bank_name: '', bank_branch: '', bank_account: '', basic: '', allow_epf: '', allow_other: '', epf_member: true, apit_mode: 'table1', active: true, notes: '' };
const num = (v) => String(v ?? '').replace(/[^\d.]/g, '');
const errText = (e) => e?.message || String(e);

/**
 * Payroll for one employer client: staff list, monthly run (APIT / EPF / ETF / net pay), payslips and reports.
 * Used on the client portal (/client/payroll) and on the admin client page (Payroll tab).
 */
export default function PayrollModule({ clientId, clientName, isAdmin = false, canEdit = true, userId }) {
  const [tab, setTab] = useState('run');
  const [emps, setEmps] = useState(null);
  const [settings, setSettings] = useState(null);
  const [runs, setRuns] = useState([]);
  const [run, setRun] = useState(null);
  const [loadingRun, setLoadingRun] = useState(false);

  const loadEmps = async () => {
    const { data, error } = await supabase.from('payroll_employees').select('*').eq('client_id', clientId).order('active', { ascending: false }).order('full_name');
    if (error) toast.error(error.message);
    setEmps(data ?? []);
  };
  const loadRuns = async () => {
    const { data } = await supabase.from('payroll_runs').select('id, period, status, totals, updated_at, finalized_at').eq('client_id', clientId).order('period', { ascending: false });
    setRuns(data ?? []);
    return data ?? [];
  };
  const openRun = async (id) => {
    setLoadingRun(true);
    const { data, error } = await supabase.from('payroll_runs').select('*').eq('id', id).single();
    setLoadingRun(false);
    if (error) return toast.error(error.message);
    setRun(data);
  };
  useEffect(() => {
    (async () => {
      const [, { data: st }, list] = await Promise.all([loadEmps(), supabase.from('payroll_settings').select('*').eq('client_id', clientId).maybeSingle(), loadRuns()]);
      setSettings(st ?? { client_id: clientId, employer_name: clientName || '' });
      if (list[0]) openRun(list[0].id);
    })();
  }, [clientId]); // eslint-disable-line react-hooks/exhaustive-deps

  const employer = useMemo(() => ({
    name: settings?.employer_name || clientName || 'Employer', address: settings?.address || '', epf: settings?.epf_reg_no || '', etf: settings?.etf_reg_no || '', tin: settings?.tin || '',
  }), [settings, clientName]);

  if (emps === null || settings === null) return <div className="card p-10 text-center"><Loader2 className="animate-spin mx-auto text-gray-300" /></div>;
  const activeEmps = emps.filter(e => e.active);

  return (
    <div className="space-y-4">
      <div className="flex gap-1 bg-gray-100 p-1 rounded-xl w-fit max-w-full overflow-x-auto">
        {[['run', 'Monthly payroll', FileSpreadsheet], ['staff', `Staff (${activeEmps.length})`, Users], ['employer', 'Employer details', Building2]].map(([k, l, I]) => (
          <button key={k} onClick={() => setTab(k)} className={`px-3 sm:px-4 py-1.5 rounded-lg text-sm font-medium whitespace-nowrap inline-flex items-center gap-1.5 ${tab === k ? 'bg-white text-primary-700 shadow-sm' : 'text-gray-500 hover:text-gray-700'}`}><I size={14} /> {l}</button>
        ))}
      </div>

      {!canEdit && <div className="card p-3 text-sm bg-amber-50 border-amber-200 text-amber-900 flex gap-2"><Info size={16} className="flex-shrink-0 mt-0.5" /> Payroll is not active on your account — you can view and download past months. Ask TaxMate to switch it on again to make changes.</div>}

      {tab === 'run' && (
        <RunTab {...{ clientId, isAdmin, canEdit, userId, runs, run, setRun, loadRuns, openRun, loadingRun, activeEmps, employer }} goStaff={() => setTab('staff')} />
      )}
      {tab === 'staff' && <StaffTab {...{ clientId, emps, canEdit, reload: loadEmps }} />}
      {tab === 'employer' && <EmployerTab {...{ settings, setSettings, canEdit, userId, clientId }} />}
    </div>
  );
}

// ─── Monthly run ─────────────────────────────────────────
function RunTab({ clientId, isAdmin, canEdit, userId, runs, run, setRun, loadRuns, openRun, loadingRun, activeEmps, employer, goStaff }) {
  const [newP, setNewP] = useState(null);
  const [busy, setBusy] = useState(false);
  const [dirty, setDirty] = useState(false);
  const [saving, setSaving] = useState(false);
  const [open, setOpen] = useState(null);
  const timer = useRef(null);
  const editable = canEdit && run?.status === 'draft';

  const save = async (r = run, quiet = true) => {
    if (!r) return;
    setSaving(true);
    const totals = totalsOf(r.lines);
    const { error } = await supabase.from('payroll_runs').update({ lines: r.lines, totals, note: r.note || null, updated_by: userId, updated_at: new Date().toISOString() }).eq('id', r.id);
    setSaving(false);
    if (error) { toast.error(errText(error)); return false; }
    setDirty(false); if (!quiet) toast.success('Saved');
    loadRuns();
    return true;
  };
  // auto-save shortly after each change
  useEffect(() => {
    if (!dirty || !editable) return;
    clearTimeout(timer.current);
    timer.current = setTimeout(() => save(run), 1200);
    return () => clearTimeout(timer.current);
  }, [run, dirty]); // eslint-disable-line react-hooks/exhaustive-deps

  const setLine = (i, patch) => { setRun(r => ({ ...r, lines: r.lines.map((l, j) => (j === i ? { ...l, ...patch } : l)) })); setDirty(true); };

  const start = async () => {
    if (!activeEmps.length) { toast.error('Add your staff first'); goStaff(); return; }
    if (runs.some(r => r.period === newP)) { toast.error(`${periodLabel(newP)} is already started`); return; }
    setBusy(true);
    const prev = runs[0] ? (await supabase.from('payroll_runs').select('lines').eq('id', runs[0].id).single()).data : null;
    const keepLoans = Object.fromEntries((prev?.lines ?? []).map(l => [l.employee_id, { loan: l.loan || 0 }]));   // loan instalments usually repeat
    const lines = activeEmps.map(e => lineFromEmployee(e, keepLoans[e.id] ?? {}));
    const { data, error } = await supabase.from('payroll_runs').insert({ client_id: clientId, period: newP, status: 'draft', lines, totals: totalsOf(lines), created_by: userId, updated_by: userId }).select().single();
    setBusy(false);
    if (error) return toast.error(errText(error));
    toast.success(`${periodLabel(newP)} payroll started`);
    setNewP(null); setRun(data); setDirty(false); loadRuns();
  };
  const sync = () => {
    const keep = Object.fromEntries(run.lines.map(l => [l.employee_id, l]));
    const lines = activeEmps.map(e => lineFromEmployee(e, keep[e.id] ?? {}));
    const added = lines.filter(l => !keep[l.employee_id]).length; const removed = run.lines.filter(l => !activeEmps.some(e => e.id === l.employee_id)).length;
    setRun({ ...run, lines }); setDirty(true);
    toast.success(`Updated from staff list${added ? ` · ${added} added` : ''}${removed ? ` · ${removed} removed` : ''}`);
  };
  const setStatus = async (status) => {
    if (status === 'final' && !window.confirm(`Finalise ${periodLabel(run.period)}? The month will be locked.${isAdmin ? '' : ' TaxMate can reopen it if a change is needed.'}`)) return;
    setBusy(true);
    if (dirty && !(await save(run))) { setBusy(false); return; }
    const patch = status === 'final' ? { status, finalized_at: new Date().toISOString(), finalized_by: userId, totals: totalsOf(run.lines) } : { status, finalized_at: null, finalized_by: null };
    const { data, error } = await supabase.from('payroll_runs').update(patch).eq('id', run.id).select().single();
    setBusy(false);
    if (error) return toast.error(errText(error));
    setRun(data); loadRuns();
    toast.success(status === 'final' ? 'Month finalised — payslips are ready' : 'Month reopened for changes');
  };
  const remove = async () => {
    if (!window.confirm(`Delete the ${periodLabel(run.period)} draft?`)) return;
    const { error } = await supabase.from('payroll_runs').delete().eq('id', run.id);
    if (error) return toast.error(errText(error));
    setRun(null); const list = await loadRuns(); if (list[0]) openRun(list[0].id);
  };

  const t = run ? totalsOf(run.lines) : null;
  const due = run ? dueDates(run.period) : null;
  const suggested = runs[0] ? nextPeriod(runs[0].period) : thisPeriod();

  return (
    <div className="space-y-4">
      <div className="card p-3 flex items-center gap-2 flex-wrap">
        <span className="text-sm font-semibold text-gray-600">Month</span>
        <select className="input py-1.5 text-sm w-auto" value={run?.id ?? ''} onChange={e => { if (e.target.value) { if (dirty) save(run); openRun(e.target.value); } }}>
          {!runs.length && <option value="">No months yet</option>}
          {runs.map(r => <option key={r.id} value={r.id}>{periodLabel(r.period)} {r.status === 'final' ? '✓' : '· draft'}</option>)}
        </select>
        {canEdit && (newP === null
          ? <button onClick={() => setNewP(suggested)} className="btn-primary text-sm py-1.5"><CalendarPlus size={15} /> Start a month</button>
          : <div className="flex items-center gap-2 flex-wrap">
              <input type="month" className="input py-1.5 text-sm w-auto" value={newP} onChange={e => setNewP(e.target.value)} />
              <button onClick={start} disabled={busy || !newP} className="btn-primary text-sm py-1.5">{busy ? <Loader2 size={14} className="animate-spin" /> : <Check size={14} />} Start {newP ? periodLabel(newP) : ''}</button>
              <button onClick={() => setNewP(null)} className="p-1.5 text-gray-400 hover:text-gray-600"><X size={16} /></button>
            </div>)}
        {run && <span className="ml-auto text-xs text-gray-400">{saving ? 'Saving…' : dirty ? 'Unsaved changes' : run.status === 'final' ? `Final · ${new Date(run.finalized_at || run.updated_at).toLocaleDateString('en-GB')}` : 'Saved'}</span>}
      </div>

      {loadingRun && <div className="card p-8 text-center"><Loader2 className="animate-spin mx-auto text-gray-300" /></div>}

      {!run && !loadingRun && (
        <div className="card p-8 text-center space-y-3">
          <FileSpreadsheet size={40} className="mx-auto text-gray-200" />
          <div className="text-gray-600 font-semibold">{activeEmps.length ? 'Start your first payroll month' : 'Add your staff to get started'}</div>
          <p className="text-sm text-gray-500 max-w-md mx-auto">Each month the app works out <b>APIT</b> (Tax Table 01), <b>EPF</b> {EPF_EE * 100}% + {EPF_ER * 100}%, <b>ETF</b> {ETF_ER * 100}% and net pay, then makes payslips and the EPF / APIT reports.</p>
          {canEdit && newP === null && (activeEmps.length
            ? <button onClick={() => setNewP(suggested)} className="btn-primary text-sm inline-flex"><CalendarPlus size={15} /> Start {periodLabel(suggested)}</button>
            : <button onClick={goStaff} className="btn-primary text-sm inline-flex"><Plus size={15} /> Add staff</button>)}
        </div>
      )}

      {run && !loadingRun && (
        <>
          <div className="grid grid-cols-2 lg:grid-cols-5 gap-3">
            <Stat label="Gross pay" v={t.gross} sub={`${t.count} employee${t.count === 1 ? '' : 's'}`} />
            <Stat label="Net pay to staff" v={t.net} strong />
            <Stat label="APIT to IRD" v={t.apit} sub={`pay by ${due.apit}`} />
            <Stat label="EPF 8% + 12%" v={t.epfTotal} sub={`pay by ${due.epf}`} />
            <Stat label="ETF 3%" v={t.etf} sub={`cost to employer ${rsx(t.cost)}`} />
          </div>

          <div className="card p-3 flex gap-2 flex-wrap items-center">
            <button onClick={() => openPayslips(run, run.lines, employer)} disabled={!run.lines.length} className="btn-primary text-sm py-1.5"><Printer size={14} /> All payslips (PDF)</button>
            <button onClick={() => openSummary(run, employer)} className="btn-secondary text-sm py-1.5"><FileSpreadsheet size={14} /> Summary & reports</button>
            <button onClick={() => csvEpf(run)} className="btn-secondary text-sm py-1.5"><Download size={14} /> EPF/ETF</button>
            <button onClick={() => csvApit(run)} className="btn-secondary text-sm py-1.5"><Download size={14} /> APIT</button>
            <button onClick={() => csvBank(run)} className="btn-secondary text-sm py-1.5"><Download size={14} /> Bank transfers</button>
            <span className="flex-1" />
            {editable && <button onClick={sync} className="btn-secondary text-sm py-1.5" title="Add new staff and take the latest salaries"><RefreshCw size={14} /> Update from staff list</button>}
            {editable && dirty && <button onClick={() => save(run, false)} className="btn-secondary text-sm py-1.5"><Save size={14} /> Save</button>}
            {editable && <button onClick={() => setStatus('final')} disabled={busy || !run.lines.length} className="btn-primary text-sm py-1.5 !bg-emerald-700 hover:!bg-emerald-800"><Lock size={14} /> Finalise month</button>}
            {isAdmin && run.status === 'final' && <button onClick={() => setStatus('draft')} disabled={busy} className="btn-secondary text-sm py-1.5"><Unlock size={14} /> Reopen</button>}
            {editable && <button onClick={remove} className="p-2 text-gray-400 hover:text-red-600" title="Delete this draft"><Trash2 size={15} /></button>}
          </div>

          <div className="space-y-2">
            {run.lines.length === 0 && <div className="card p-6 text-center text-sm text-gray-400">No staff in this month. Use “Update from staff list”.</div>}
            {run.lines.map((l, i) => <LineCard key={l.employee_id || i} l={l} i={i} open={open === i} setOpen={setOpen} editable={editable} setLine={setLine} run={run} employer={employer} />)}
          </div>
          <p className="text-[11px] text-gray-400 px-1">APIT uses Tax Table 01 (primary employment) on each month's gross pay. For a one-off bonus or a second job, type the APIT figure yourself (Table 02 / 03). EPF and ETF are worked out on basic salary + EPF allowances, less no-pay.</p>
        </>
      )}
    </div>
  );
}

function Stat({ label, v, sub, strong }) {
  return (
    <div className={`card p-3 ${strong ? 'bg-primary-800 text-white' : ''}`}>
      <div className={`text-[11px] ${strong ? 'text-primary-200' : 'text-gray-500'}`}>{label}</div>
      <div className={`text-lg font-black mt-0.5 ${strong ? '' : 'text-primary-800'}`}>{rsx(v)}</div>
      {sub && <div className={`text-[10px] ${strong ? 'text-primary-200' : 'text-gray-400'}`}>{sub}</div>}
    </div>
  );
}

function LineCard({ l, i, open, setOpen, editable, setLine, run, employer }) {
  const c = calcLine(l);
  const inp = (k, label) => (
    <label key={k} className="text-[11px] font-semibold text-gray-500">{label}
      <input className="input mt-0.5 py-1 text-sm text-right" inputMode="decimal" disabled={!editable} value={l[k] === 0 || l[k] === '0' ? '' : l[k] ?? ''} placeholder="0"
        onChange={e => setLine(i, { [k]: num(e.target.value) })} />
    </label>
  );
  return (
    <div className="card overflow-hidden">
      <button type="button" onClick={() => setOpen(open ? null : i)} className="w-full text-left px-4 py-3 flex items-center gap-3 hover:bg-gray-50">
        <div className="w-9 h-9 rounded-full bg-primary-100 text-primary-700 font-bold flex items-center justify-center flex-shrink-0">{l.full_name?.[0] ?? '?'}</div>
        <div className="flex-1 min-w-0">
          <div className="font-semibold text-gray-800 truncate">{l.full_name} {l.emp_no && <span className="text-xs text-gray-400 font-normal">{l.emp_no}</span>}</div>
          <div className="text-xs text-gray-500 truncate">{l.designation || '—'} · Gross {rsx(c.gross)} · APIT {rsx(c.apit)}{c.apitManual ? ' (typed)' : ''} · EPF {rsx(c.epfEe)}</div>
        </div>
        <div className="text-right"><div className="text-[10px] text-gray-400">Net pay</div><div className="font-black text-primary-800">{rsx(c.net)}</div></div>
        {open ? <ChevronUp size={16} className="text-gray-400" /> : <ChevronDown size={16} className="text-gray-400" />}
      </button>
      {open && (
        <div className="px-4 pb-4 pt-1 border-t border-gray-100 space-y-3">
          <div className="text-xs text-gray-500">Fixed: basic {rsx(l.basic)} · EPF allowances {rsx(l.allow_epf)} · other allowances {rsx(l.allow_other)}{l.epf_member === false ? ' · not in EPF' : ''}{l.apit_mode === 'none' ? ' · no APIT' : ''} <span className="text-gray-400">(change in Staff)</span></div>
          <div>
            <div className="text-xs font-bold text-emerald-700 mb-1">This month — extra earnings</div>
            <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">{VAR_EARN.map(([k, lb]) => inp(k, lb))}</div>
          </div>
          <div>
            <div className="text-xs font-bold text-red-700 mb-1">This month — deductions</div>
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">{VAR_DED.map(([k, lb]) => inp(k, lb))}</div>
          </div>
          <div className="grid sm:grid-cols-2 gap-2 items-end">
            <label className="text-[11px] font-semibold text-gray-500">APIT (leave empty for Table 01 = {rsx(c.apitAuto)})
              <input className="input mt-0.5 py-1 text-sm text-right" inputMode="decimal" disabled={!editable} value={l.apit_manual ?? ''} placeholder={String(c.apitAuto)}
                onChange={e => setLine(i, { apit_manual: e.target.value === '' ? null : num(e.target.value) })} />
            </label>
            <label className="text-[11px] font-semibold text-gray-500">Note on payslip (optional)
              <input className="input mt-0.5 py-1 text-sm" maxLength={120} disabled={!editable} value={l.note ?? ''} onChange={e => setLine(i, { note: e.target.value })} />
            </label>
          </div>
          {c.bonusHint && <div className="text-[11px] text-amber-700 bg-amber-50 rounded-lg px-2 py-1">Bonus included in Table 01. For a one-off bonus IRD uses Table 03 — type the APIT if it differs.</div>}
          <div className="rounded-xl bg-gray-50 p-3 grid grid-cols-2 sm:grid-cols-4 gap-2 text-xs">
            <div>Gross pay<b className="block text-sm">{rsx(c.gross)}</b></div>
            <div>Deductions<b className="block text-sm">{rsx(c.deductions)}</b></div>
            <div>EPF 12% + ETF 3%<b className="block text-sm">{rsx(c.epfEr + c.etf)}</b></div>
            <div>Net pay<b className="block text-sm text-primary-800">{rsx(c.net)}</b></div>
          </div>
          <div className="flex gap-2 flex-wrap">
            <button onClick={() => openPayslips(run, [l], employer)} className="btn-secondary text-xs py-1"><Printer size={13} /> Payslip PDF</button>
            {l.mobile
              ? <a href={payslipWhatsApp(l, run, employer.name)} target="_blank" rel="noreferrer" className="btn-secondary text-xs py-1 !text-emerald-700"><MessageCircle size={13} /> Send on WhatsApp</a>
              : <span className="text-[11px] text-gray-400 self-center">Add a mobile number in Staff to send on WhatsApp</span>}
          </div>
        </div>
      )}
    </div>
  );
}

// ─── Staff list ──────────────────────────────────────────
function StaffTab({ clientId, emps, canEdit, reload }) {
  const [form, setForm] = useState(null);
  const [busy, setBusy] = useState(false);
  const [showLeft, setShowLeft] = useState(false);
  const fileRef = useRef(null);
  const list = emps.filter(e => (showLeft ? !e.active : e.active));
  const leftCount = emps.filter(e => !e.active).length;

  const save = async () => {
    if (!form.full_name.trim()) return toast.error('Name is required');
    setBusy(true);
    const row = { ...form, client_id: clientId, basic: Number(form.basic) || 0, allow_epf: Number(form.allow_epf) || 0, allow_other: Number(form.allow_other) || 0, join_date: form.join_date || null, updated_at: new Date().toISOString() };
    for (const k of ['emp_no', 'nic', 'designation', 'epf_no', 'mobile', 'email', 'bank_name', 'bank_branch', 'bank_account', 'notes']) row[k] = String(row[k] ?? '').trim() || null;
    delete row.id; delete row.created_at;
    const { error } = form.id ? await supabase.from('payroll_employees').update(row).eq('id', form.id) : await supabase.from('payroll_employees').insert(row);
    setBusy(false);
    if (error) return toast.error(errText(error));
    toast.success(form.id ? 'Saved' : `${form.full_name} added`);
    setForm(null); reload();
  };
  const setActive = async (e, active) => {
    const { error } = await supabase.from('payroll_employees').update({ active, left_date: active ? null : new Date().toISOString().slice(0, 10), updated_at: new Date().toISOString() }).eq('id', e.id);
    if (error) return toast.error(errText(error));
    toast.success(active ? `${e.full_name} is back on the payroll` : `${e.full_name} marked as left`); reload();
  };
  const del = async (e) => {
    if (!window.confirm(`Delete ${e.full_name}? Past payslips stay, but the record is removed. (Use “Left” to keep it.)`)) return;
    const { error } = await supabase.from('payroll_employees').delete().eq('id', e.id);
    if (error) return toast.error(errText(error));
    setForm(null); reload();
  };
  const importFile = async (f) => {
    if (!f) return;
    try {
      const rows = parseStaffCsv(await f.text());
      const { error } = await supabase.from('payroll_employees').insert(rows.map(r => ({ ...r, client_id: clientId, ...Object.fromEntries(['emp_no', 'nic', 'designation', 'epf_no', 'mobile', 'bank_name', 'bank_branch', 'bank_account'].map(k => [k, String(r[k] ?? '').trim() || null])) })));
      if (error) throw error;
      toast.success(`${rows.length} staff imported`); reload();
    } catch (e) { toast.error(errText(e)); }
    if (fileRef.current) fileRef.current.value = '';
  };

  return (
    <div className="space-y-3">
      <div className="flex gap-2 flex-wrap items-center">
        {canEdit && <button onClick={() => setForm({ ...EMPTY_EMP })} className="btn-primary text-sm"><Plus size={15} /> Add employee</button>}
        {canEdit && <button onClick={() => fileRef.current?.click()} className="btn-secondary text-sm"><Upload size={14} /> Import CSV</button>}
        {canEdit && <button onClick={importTemplate} className="text-xs text-primary-700 hover:underline">Download CSV template</button>}
        <input ref={fileRef} type="file" accept=".csv,text/csv" className="hidden" onChange={e => importFile(e.target.files?.[0])} />
        {leftCount > 0 && <button onClick={() => setShowLeft(v => !v)} className={`ml-auto text-xs font-semibold px-2.5 py-1 rounded-full ${showLeft ? 'bg-gray-700 text-white' : 'bg-gray-100 text-gray-600'}`}>{leftCount} left{showLeft ? ' ✕' : ''}</button>}
      </div>

      {list.length === 0 ? (
        <div className="card p-8 text-center text-sm text-gray-400"><Users size={36} className="mx-auto text-gray-200 mb-2" />{showLeft ? 'No former staff.' : 'No staff yet — add employees one by one or import the CSV template.'}</div>
      ) : (
        <div className="card overflow-x-auto">
          <table className="w-full text-sm">
            <thead><tr className="text-left text-xs text-gray-500 border-b border-gray-100"><th className="px-4 py-2">Employee</th><th className="px-2 hidden sm:table-cell">NIC / EPF No</th><th className="px-2 text-right">Basic</th><th className="px-2 text-right hidden md:table-cell">Allowances</th><th className="px-2 hidden md:table-cell">EPF / APIT</th><th className="px-2" /></tr></thead>
            <tbody className="divide-y divide-gray-50">
              {list.map(e => (
                <tr key={e.id} className="hover:bg-gray-50/60">
                  <td className="px-4 py-2"><div className="font-semibold text-gray-800">{e.full_name} {e.emp_no && <span className="text-xs text-gray-400 font-normal">{e.emp_no}</span>}</div><div className="text-xs text-gray-500">{e.designation || '—'}{e.mobile ? ` · ${e.mobile}` : ''}</div></td>
                  <td className="px-2 text-xs text-gray-600 hidden sm:table-cell">{e.nic || '—'}<div className="text-gray-400">EPF {e.epf_no || '—'}</div></td>
                  <td className="px-2 text-right font-semibold">{rsx(e.basic)}</td>
                  <td className="px-2 text-right text-xs hidden md:table-cell">{rsx(Number(e.allow_epf) + Number(e.allow_other))}</td>
                  <td className="px-2 text-xs hidden md:table-cell">{e.epf_member ? 'EPF ✓' : 'No EPF'} · {e.apit_mode === 'none' ? 'No APIT' : 'Table 01'}</td>
                  <td className="px-2 text-right whitespace-nowrap">
                    {canEdit && <button onClick={() => setForm({ ...EMPTY_EMP, ...Object.fromEntries(Object.entries(e).map(([k, v]) => [k, v ?? ''])) })} className="p-1.5 text-gray-400 hover:text-primary-700" title="Edit"><Pencil size={14} /></button>}
                    {canEdit && (e.active
                      ? <button onClick={() => setActive(e, false)} className="text-xs text-gray-500 hover:text-amber-700 px-1">Left</button>
                      : <button onClick={() => setActive(e, true)} className="text-xs text-primary-700 hover:underline px-1">Rejoin</button>)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {form && (
        <div className="fixed inset-0 bg-black/40 z-50 flex items-end sm:items-center justify-center p-3" onClick={() => setForm(null)}>
          <div className="bg-white rounded-2xl w-full max-w-2xl max-h-[92vh] overflow-y-auto p-5 space-y-3" onClick={e => e.stopPropagation()}>
            <div className="flex items-center gap-2"><Users size={18} className="text-primary-700" /><b className="flex-1 text-lg">{form.id ? 'Edit employee' : 'Add employee'}</b><button onClick={() => setForm(null)} className="p-1"><X size={18} /></button></div>
            <div className="grid sm:grid-cols-3 gap-2">
              <F label="Full name *" span={2}><input className="input py-1.5 text-sm" maxLength={120} value={form.full_name} onChange={e => setForm({ ...form, full_name: e.target.value })} /></F>
              <F label="Employee No"><input className="input py-1.5 text-sm" maxLength={20} value={form.emp_no} onChange={e => setForm({ ...form, emp_no: e.target.value })} /></F>
              <F label="NIC"><input className="input py-1.5 text-sm" maxLength={20} value={form.nic} onChange={e => setForm({ ...form, nic: e.target.value })} /></F>
              <F label="Designation"><input className="input py-1.5 text-sm" maxLength={80} value={form.designation} onChange={e => setForm({ ...form, designation: e.target.value })} /></F>
              <F label="EPF member No"><input className="input py-1.5 text-sm" maxLength={20} value={form.epf_no} onChange={e => setForm({ ...form, epf_no: e.target.value })} /></F>
              <F label="Mobile (for WhatsApp payslip)"><input className="input py-1.5 text-sm" maxLength={20} inputMode="tel" value={form.mobile} onChange={e => setForm({ ...form, mobile: e.target.value })} /></F>
              <F label="Joined"><input type="date" className="input py-1.5 text-sm" value={form.join_date || ''} onChange={e => setForm({ ...form, join_date: e.target.value })} /></F>
              <F label="Email"><input className="input py-1.5 text-sm" maxLength={120} value={form.email} onChange={e => setForm({ ...form, email: e.target.value })} /></F>
            </div>
            <div className="rounded-xl bg-primary-50/50 p-3 space-y-2">
              <div className="text-xs font-bold text-primary-800">Monthly salary (fixed)</div>
              <div className="grid grid-cols-3 gap-2">
                <F label="Basic salary"><input className="input py-1.5 text-sm text-right" inputMode="decimal" value={form.basic} onChange={e => setForm({ ...form, basic: num(e.target.value) })} /></F>
                <F label="Allowances for EPF"><input className="input py-1.5 text-sm text-right" inputMode="decimal" value={form.allow_epf} onChange={e => setForm({ ...form, allow_epf: num(e.target.value) })} /></F>
                <F label="Other allowances"><input className="input py-1.5 text-sm text-right" inputMode="decimal" value={form.allow_other} onChange={e => setForm({ ...form, allow_other: num(e.target.value) })} /></F>
              </div>
              <p className="text-[11px] text-gray-500">“Allowances for EPF” count for EPF/ETF (e.g. cost of living). “Other allowances” are paid and taxed but not in EPF (e.g. travel, fuel).</p>
              <div className="flex gap-4 flex-wrap text-sm">
                <label className="inline-flex items-center gap-1.5"><input type="checkbox" checked={form.epf_member !== false} onChange={e => setForm({ ...form, epf_member: e.target.checked })} /> EPF / ETF member</label>
                <label className="inline-flex items-center gap-1.5">APIT
                  <select className="input py-1 text-sm w-auto" value={form.apit_mode} onChange={e => setForm({ ...form, apit_mode: e.target.value })}>
                    <option value="table1">Table 01 — main job</option><option value="none">Not liable</option>
                  </select></label>
              </div>
            </div>
            <div className="grid sm:grid-cols-3 gap-2">
              <F label="Bank"><input className="input py-1.5 text-sm" maxLength={60} value={form.bank_name} onChange={e => setForm({ ...form, bank_name: e.target.value })} /></F>
              <F label="Branch"><input className="input py-1.5 text-sm" maxLength={60} value={form.bank_branch} onChange={e => setForm({ ...form, bank_branch: e.target.value })} /></F>
              <F label="Account No"><input className="input py-1.5 text-sm" maxLength={30} value={form.bank_account} onChange={e => setForm({ ...form, bank_account: e.target.value })} /></F>
            </div>
            <div className="flex gap-2 pt-1">
              {form.id && <button onClick={() => del(form)} className="text-xs text-gray-400 hover:text-red-600 inline-flex items-center gap-1"><Trash2 size={13} /> Delete</button>}
              <span className="flex-1" />
              <button onClick={() => setForm(null)} className="btn-secondary text-sm">Cancel</button>
              <button onClick={save} disabled={busy} className="btn-primary text-sm">{busy ? <Loader2 size={14} className="animate-spin" /> : <Save size={14} />} Save</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
const F = ({ label, span, children }) => <label className={`text-[11px] font-semibold text-gray-500 block ${span === 2 ? 'sm:col-span-2' : ''}`}>{label}<div className="mt-0.5">{children}</div></label>;

// ─── Employer details ────────────────────────────────────
function EmployerTab({ settings, setSettings, canEdit, userId, clientId }) {
  const [f, setF] = useState(settings);
  const [busy, setBusy] = useState(false);
  const save = async () => {
    setBusy(true);
    const row = { client_id: clientId, updated_by: userId, updated_at: new Date().toISOString() };
    for (const k of ['employer_name', 'address', 'epf_reg_no', 'etf_reg_no', 'tin']) row[k] = String(f[k] ?? '').trim() || null;
    const { data, error } = await supabase.from('payroll_settings').upsert(row).select().single();
    setBusy(false);
    if (error) return toast.error(errText(error));
    setSettings(data); toast.success('Employer details saved');
  };
  return (
    <div className="card p-5 space-y-3 max-w-2xl">
      <div className="text-sm text-gray-600">Shown on payslips and the EPF / APIT reports.</div>
      <div className="grid sm:grid-cols-2 gap-2">
        <F label="Employer / business name" span={2}><input className="input py-1.5 text-sm" maxLength={120} disabled={!canEdit} value={f.employer_name ?? ''} onChange={e => setF({ ...f, employer_name: e.target.value })} /></F>
        <F label="Address" span={2}><input className="input py-1.5 text-sm" maxLength={300} disabled={!canEdit} value={f.address ?? ''} onChange={e => setF({ ...f, address: e.target.value })} /></F>
        <F label="EPF employer registration No"><input className="input py-1.5 text-sm" maxLength={40} disabled={!canEdit} value={f.epf_reg_no ?? ''} onChange={e => setF({ ...f, epf_reg_no: e.target.value })} /></F>
        <F label="ETF employer registration No"><input className="input py-1.5 text-sm" maxLength={40} disabled={!canEdit} value={f.etf_reg_no ?? ''} onChange={e => setF({ ...f, etf_reg_no: e.target.value })} /></F>
        <F label="Employer TIN (for APIT)"><input className="input py-1.5 text-sm" maxLength={40} disabled={!canEdit} value={f.tin ?? ''} onChange={e => setF({ ...f, tin: e.target.value })} /></F>
      </div>
      {canEdit && <button onClick={save} disabled={busy} className="btn-primary text-sm">{busy ? <Loader2 size={14} className="animate-spin" /> : <Save size={14} />} Save</button>}
    </div>
  );
}
