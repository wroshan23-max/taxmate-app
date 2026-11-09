// V56 — Admin: export everything a client has entered to one Excel workbook
// Sheets: Client details · Monthly income (one per Y/A) · Assets & liabilities (one per Y/A) · Payroll staff · Payroll months
import { supabase } from './supabase';
import { downloadXlsx } from './xlsx';
import { GROUPS as INC_GROUPS, monthLabel, rowTotal, sheetTotals, cell as incCell, SHEET_STATUS } from './incomeSheet';
import { SECTIONS, rowsOf, isRowEmpty, totals as alTotals, num } from './assets';
import { calcLine, periodLabel } from './payroll';

const h = (v) => ({ v, s: 'h' });
const b = (v) => ({ v, s: 'b' });
const m = (v) => ({ v: Number.isFinite(Number(v)) ? Number(v) : v, s: 'm' });
const mb = (v) => ({ v: Number(v) || 0, s: 'mb' });
const t = (v) => ({ v, s: 't' });
const sub = (v) => ({ v, s: 'sub' });
const w = (v) => ({ v, s: 'w' });
const n = (v) => { const x = Number(String(v ?? '').replace(/[,\s]/g, '')); return Number.isFinite(x) ? x : 0; };
const dt = (d) => (d ? new Date(d).toLocaleString('en-LK', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' }) : '');
const day = (d) => (d ? new Date(d).toLocaleDateString('en-LK', { day: '2-digit', month: 'short', year: 'numeric' }) : '');
const RESIDENCY = { resident: 'Resident in Sri Lanka', nrcitizen: 'Non-resident Sri Lankan citizen', nonresident: 'Non-resident' };
const statusLabel = (s) => SHEET_STATUS[s]?.label ?? s ?? '';

// ── Client details (field / value) ──────────────────────────
const SHOWN = new Set(['id', 'profile_id', 'created_by', 'full_name', 'client_no', 'nic', 'tin', 'mobile', 'email', 'address', 'employer', 'resident_status',
  'contact_name', 'contact_relation', 'contact_mobile', 'contact_email', 'contact_preferred', 'registration', 'source', 'registered_at', 'reviewed_at',
  'created_at', 'updated_at', 'archived_at', 'feature_overrides', 'email_opt_out']);
function detailsSheet(c, fam, who) {
  const reg = c.registration || {};
  const rows = [
    [t(`Client details — ${c.full_name}`)],
    [{ v: `Exported ${dt(new Date())} by ${who || 'TaxMate'} · TaxMate Solutions`, s: 'n' }],
    [],
    [h('Field'), h('Value')],
    [sub('Taxpayer')],
    ['Client No.', c.client_no], ['Full name', c.full_name], ['NIC', c.nic], ['TIN', c.tin], ['Mobile / WhatsApp', c.mobile], ['Email', c.email],
    ['Address', w(c.address)], ['Employer / business / occupation', c.employer], ['Residency', RESIDENCY[c.resident_status] ?? c.resident_status],
    ['Portal login', c.profile_id ? 'Yes' : 'No'], ['Client since', day(c.created_at)], ['Last updated', dt(c.updated_at)],
    c.archived_at ? ['Archived on', day(c.archived_at)] : null,
    [sub('Contact person')],
    ['Name', c.contact_name], ['Relationship', c.contact_relation], ['Mobile', c.contact_mobile], ['Email', c.contact_email],
    ['Messages go to the contact person', c.contact_preferred ? 'Yes' : 'No'],
  ];
  if (c.source || c.registered_at || Object.keys(reg).length) {
    rows.push([sub('Online registration')],
      ['Came from', c.source === 'self_registration' ? 'Registered online' : c.source], ['Registered on', dt(c.registered_at)], ['Via link', reg.via],
      ['Filled in by', reg.filled_by === 'contact' ? 'Contact person' : reg.filled_by ? 'Taxpayer' : ''],
      ['Services asked for', w(Array.isArray(reg.services) ? reg.services.join(', ') : reg.services)], ['Note from client', w(reg.note)],
      ['Agreed to terms', reg.consent === undefined ? '' : reg.consent ? 'Yes' : 'No'], ['Reviewed by TaxMate', dt(c.reviewed_at)]);
    for (const [k, v] of Object.entries(reg)) if (!['via', 'filled_by', 'services', 'note', 'consent'].includes(k) && v !== null && v !== '') rows.push([`Registration · ${k}`, w(typeof v === 'object' ? JSON.stringify(v) : v)]);
  }
  if (fam.head || fam.members.length) {
    rows.push([sub('Family')]);
    if (fam.head) rows.push(['Main applicant', `${fam.head.full_name}${fam.head.client_no ? ` (${fam.head.client_no})` : ''}`], ['Relation', fam.relation]);
    for (const x of fam.members) rows.push([`Family member${x.relation ? ` (${x.relation})` : ''}`, `${x.member?.full_name ?? ''}${x.member?.client_no ? ` (${x.member.client_no})` : ''}`]);
  }
  const other = Object.entries(c).filter(([k, v]) => !SHOWN.has(k) && v !== null && v !== '' && typeof v !== 'object');
  if (other.length) { rows.push([sub('Other saved fields')]); for (const [k, v] of other) rows.push([k, v]); }
  return { name: 'Client details', rows: rows.filter(Boolean), widths: [36, 70], freeze: 4 };
}

// ── Monthly income (April → March) ──────────────────────────
function incomeSheet(c, s) {
  const d = s.data || {};
  const months = Array.from({ length: 12 }, (_, i) => monthLabel(s.year, i));
  const rows = [
    [t(`Monthly income — Y/A ${s.year} — ${c.full_name}${c.client_no ? ` (${c.client_no})` : ''}`)],
    [`Status: ${statusLabel(s.status)}${s.submitted_at ? ` · submitted ${dt(s.submitted_at)}` : ''}${s.updated_at ? ` · last change ${dt(s.updated_at)}` : ''}`],
    [],
    [h('Item (Rs.)'), ...months.map(h), h('Total')],
  ];
  for (const g of INC_GROUPS) {
    rows.push([sub(g.en)]);
    for (const r of g.rows) {
      const vals = Array.from({ length: 12 }, (_, i) => { const v = incCell(d, r.key, i); return v === '' ? '' : m(n(v)); });
      rows.push([r.en, ...vals, mb(rowTotal(d, r.key))]);
    }
  }
  const tt = sheetTotals(d);
  rows.push([], [sub('Totals for the year')],
    [b('Income in Sri Lanka'), ...Array(12).fill(''), mb(tt.income)],
    [b('Foreign-currency income (Rs.)'), ...Array(12).fill(''), mb(tt.fx)],
    [b('Business income'), ...Array(12).fill(''), mb(tt.bizIncome)],
    [b('Business expenses'), ...Array(12).fill(''), mb(tt.bizExpense)],
    [b('Business profit / (loss)'), ...Array(12).fill(''), mb(tt.bizProfit)],
    [b('Tax already deducted'), ...Array(12).fill(''), mb(tt.credit)],
    [b('Months filled'), ...Array(12).fill(''), b(tt.monthsFilled)]);
  if (d.note || s.client_note) rows.push([], ['Client note', w(d.note || s.client_note)]);
  if (s.admin_note) rows.push(['TaxMate note', w(s.admin_note)]);
  return { name: `Income ${s.year.replace('/', '-')}`, rows, widths: [38, ...Array(12).fill(12), 15], freeze: 4 };
}

// ── Assets & liabilities ────────────────────────────────────
function assetSheet(c, s) {
  const d = s.data || {};
  const tt = alTotals(d);
  const rows = [
    [t(`Assets & liabilities — Y/A ${s.year} (as at 31 March) — ${c.full_name}${c.client_no ? ` (${c.client_no})` : ''}`)],
    [`Status: ${statusLabel(s.status)}${s.submitted_at ? ` · submitted ${dt(s.submitted_at)}` : ''}${s.updated_at ? ` · last change ${dt(s.updated_at)}` : ''}`],
    [],
    [b('Total assets'), mb(tt.assets)], [b('Total liabilities'), mb(tt.liabilities_total)], [b('Net worth'), mb(tt.net)],
  ];
  for (const sec of SECTIONS) {
    const list = rowsOf(d, sec.key).filter(r => !isRowEmpty(sec, r));
    if (!list.length) continue;
    rows.push([], [sub(`${sec.code}. ${sec.en}${sec.part === 2 ? ' (during the year)' : ''}`)], sec.cols.map(col => h(col.en)));
    for (const r of list) rows.push(sec.cols.map(col => (col.type === 'money' ? (r[col.key] === '' || r[col.key] == null ? '' : m(num(r[col.key]))) : (r[col.key] ?? ''))));
    rows.push(sec.cols.map((col, i) => (col.type === 'money' ? mb(list.reduce((a, r) => a + num(r[col.key]), 0)) : i === 0 ? b('Total') : '')));
  }
  if (s.client_note) rows.push([], ['Client note', w(s.client_note)]);
  if (s.admin_note) rows.push(['TaxMate note', w(s.admin_note)]);
  return { name: `Assets ${s.year.replace('/', '-')}`, rows, widths: [28, 22, 30, 20, 18, 16, 18, 22, 18], freeze: 0 };
}

// ── Payroll ─────────────────────────────────────────────────
function payrollStaff(c, set, emps) {
  const rows = [[t(`Payroll staff — ${set?.employer_name || c.full_name}`)]];
  if (set) rows.push([`EPF reg. ${set.epf_reg_no || '—'} · ETF reg. ${set.etf_reg_no || '—'} · TIN ${set.tin || '—'}${set.address ? ` · ${set.address}` : ''}`]);
  rows.push([], ['Emp No', 'Name', 'NIC', 'Designation', 'EPF No', 'Join date', 'Mobile', 'Email', 'Bank', 'Branch', 'Account', 'Basic', 'Allowances (EPF)', 'Other allowances', 'EPF member', 'APIT', 'Active', 'Left on', 'Notes'].map(h));
  for (const e of emps) rows.push([e.emp_no, e.full_name, e.nic, e.designation, e.epf_no, e.join_date, e.mobile, e.email, e.bank_name, e.bank_branch, e.bank_account,
    m(n(e.basic)), m(n(e.allow_epf)), m(n(e.allow_other)), e.epf_member ? 'Yes' : 'No', e.apit_mode === 'none' ? 'Not deducted' : 'Table 01', e.active ? 'Yes' : 'No', e.left_date, e.notes]);
  return { name: 'Payroll staff', rows, widths: [9, 26, 14, 18, 9, 11, 13, 22, 14, 14, 15, 13, 13, 13, 9, 12, 7, 11, 24], freeze: rows.length - emps.length };
}
function payrollMonths(c, runs) {
  const rows = [[t(`Payroll months — ${c.full_name}`)], [],
    ['Month', 'Status', 'Emp No', 'Name', 'NIC', 'Basic', 'Allowances (EPF)', 'Other allowances', 'Overtime', 'Bonus', 'Other earnings', 'No-pay',
      'Gross pay', 'EPF 8%', 'APIT', 'Advance', 'Loan', 'Other deductions', 'Net pay', 'EPF 12% (employer)', 'ETF 3%', 'Employer cost'].map(h)];
  for (const r of [...runs].sort((a, z) => a.period.localeCompare(z.period))) {
    for (const l of r.lines ?? []) {
      const x = calcLine(l);
      rows.push([periodLabel(r.period), r.status === 'final' ? 'Final' : 'Draft', l.emp_no, l.full_name, l.nic, m(n(l.basic)), m(n(l.allow_epf)), m(n(l.allow_other)),
        m(n(l.overtime)), m(n(l.bonus)), m(n(l.other_earn)), m(n(l.no_pay)), m(x.gross), m(x.epfEe), m(x.apit), m(n(l.advance)), m(n(l.loan)), m(n(l.other_ded)),
        m(x.net), m(x.epfEr), m(x.etf), m(x.cost)]);
    }
  }
  return { name: 'Payroll months', rows, widths: [15, 7, 8, 24, 14, ...Array(17).fill(13)], freeze: 3 };
}

/** Build and download the workbook for one client. Returns a summary of what went in. */
export async function exportClientExcel(clientId, who) {
  const [cl, inc, al, ps, pe, pr, fam] = await Promise.all([
    supabase.from('clients').select('*').eq('id', clientId).single(),
    supabase.from('income_sheets').select('*').eq('client_id', clientId).order('year'),
    supabase.from('asset_statements').select('*').eq('client_id', clientId).order('year'),
    supabase.from('payroll_settings').select('*').eq('client_id', clientId).maybeSingle(),
    supabase.from('payroll_employees').select('*').eq('client_id', clientId).order('active', { ascending: false }).order('full_name'),
    supabase.from('payroll_runs').select('period, status, lines').eq('client_id', clientId),
    supabase.from('client_family').select('member_id, head_id, relation, member:clients!client_family_member_id_fkey(full_name, client_no), head:clients!client_family_head_id_fkey(full_name, client_no)')
      .or(`head_id.eq.${clientId},member_id.eq.${clientId}`),
  ]);
  if (cl.error) throw new Error(cl.error.message);
  const c = cl.data;
  const links = fam.data ?? [];
  const asMember = links.find(x => x.member_id === clientId);
  const famInfo = { head: asMember?.head ?? null, relation: asMember?.relation, members: links.filter(x => x.head_id === clientId) };

  const sheets = [detailsSheet(c, famInfo, who)];
  for (const s of inc.data ?? []) sheets.push(incomeSheet(c, s));
  for (const s of al.data ?? []) sheets.push(assetSheet(c, s));
  if ((pe.data ?? []).length || ps.data) sheets.push(payrollStaff(c, ps.data, pe.data ?? []));
  if ((pr.data ?? []).length) sheets.push(payrollMonths(c, pr.data));

  const safe = (x) => String(x || '').replace(/[^A-Za-z0-9-]+/g, '_').replace(/^_+|_+$/g, '').slice(0, 40);
  const file = `TaxMate_${safe(c.client_no) || 'client'}_${safe(c.full_name)}_${new Date().toISOString().slice(0, 10)}.xlsx`;
  downloadXlsx(file, sheets);
  return { file, income: (inc.data ?? []).length, assets: (al.data ?? []).length, staff: (pe.data ?? []).length, months: (pr.data ?? []).length };
}
