import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import toast from 'react-hot-toast';
import { Wallet, Plus, Eye, EyeOff, Trash2, RotateCcw, CheckCircle2, FileSpreadsheet, ChevronDown, ChevronUp, MessageSquare, AlertTriangle, PencilLine } from 'lucide-react';
import IncomeSheetEditor from './IncomeSheetEditor';
import { supabase, fmtDate } from '../lib/supabase';
import { useAuth } from '../contexts/AuthContext';
import { filingYear, alYears } from '../lib/assets';
import { GROUPS, MONTHS, cell, rowTotal, monthTotals, sheetTotals, sheetToReturnInput, emptySheet, SHEET_STATUS } from '../lib/incomeSheet';
import { recipientsOf } from '../lib/contacts';
import { FIRM } from '../lib/iitStatement';
import MessageMenu from './MessageMenu';

const rs = (n) => `Rs. ${Math.round(n || 0).toLocaleString('en-LK')}`;
const n0 = (v) => { const n = Number(String(v ?? '').replace(/,/g, '')); return Number.isFinite(n) ? n : 0; };

function Pill({ s, enabled }) {
  if (!enabled) return <span className="text-[11px] font-semibold px-2 py-0.5 rounded-full bg-gray-100 text-gray-500">Hidden from client</span>;
  const st = SHEET_STATUS[s] ?? SHEET_STATUS.open;
  return <span className={`text-[11px] font-semibold px-2 py-0.5 rounded-full ${st.cls}`}>{st.label}</span>;
}

function YearTable({ data }) {
  const t = sheetTotals(data);
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-xs">
        <thead className="bg-gray-50"><tr>
          <th className="text-left px-3 py-2 min-w-[170px]">Item</th>
          {MONTHS.map(m => <th key={m} className="px-2 py-2 text-right">{m}</th>)}
          <th className="px-3 py-2 text-right bg-primary-50">Total</th>
        </tr></thead>
        <tbody>
          {GROUPS.map(g => [
            <tr key={g.key} className="bg-gray-50/60"><td colSpan={14} className="px-3 py-1 font-bold text-gray-700">{g.en}</td></tr>,
            ...g.rows.map(r => (
              <tr key={r.key} className="border-t border-gray-100">
                <td className="px-3 py-1">{r.en}</td>
                {MONTHS.map((_, i) => <td key={i} className="px-2 py-1 text-right tabular-nums text-gray-600">{n0(cell(data, r.key, i)) ? n0(cell(data, r.key, i)).toLocaleString('en-LK') : ''}</td>)}
                <td className="px-3 py-1 text-right tabular-nums font-semibold bg-primary-50/50">{rowTotal(data, r.key) ? rowTotal(data, r.key).toLocaleString('en-LK') : '—'}</td>
              </tr>
            )),
          ])}
          <tr className="border-t-2 border-primary-200 font-bold"><td className="px-3 py-1.5">Business profit / (loss)</td>
            {MONTHS.map((_, i) => { const p = monthTotals(data, i).bizProfit; return <td key={i} className={`px-2 py-1.5 text-right tabular-nums ${p < 0 ? 'text-red-600' : ''}`}>{p ? p.toLocaleString('en-LK') : ''}</td>; })}
            <td className={`px-3 py-1.5 text-right tabular-nums bg-primary-50 ${t.bizProfit < 0 ? 'text-red-600' : ''}`}>{t.bizProfit.toLocaleString('en-LK')}</td></tr>
        </tbody>
      </table>
    </div>
  );
}

/** "Income sheet" tab on a client's page (admin). */
export default function IncomeSheetsAdmin({ client }) {
  const { user } = useAuth();
  const navigate = useNavigate();
  const [list, setList] = useState([]);
  const [loading, setLoading] = useState(true);
  const [year, setYear] = useState(filingYear());
  const [openId, setOpenId] = useState(null);
  const [editId, setEditId] = useState(null);

  const load = async () => {
    const { data, error } = await supabase.from('income_sheets').select('*').eq('client_id', client.id).order('year', { ascending: false });
    if (error) toast.error(error.message);
    setList(data ?? []); setLoading(false);
  };
  useEffect(() => { load(); }, [client.id]); // eslint-disable-line react-hooks/exhaustive-deps
  const have = new Set(list.map(s => s.year));

  // forClient = the client fills it in the portal; otherwise TaxMate enters it (hidden from the client)
  const enable = async (forClient = true) => {
    const { data: row, error } = await supabase.from('income_sheets').insert({ client_id: client.id, year, data: emptySheet(), enabled: forClient, created_by: user.id }).select().single();
    if (error) return toast.error(/duplicate|unique/i.test(error.message) ? `A Y/A ${year} sheet already exists` : error.message);
    toast.success(forClient ? `Monthly income sheet enabled for Y/A ${year}` : `Y/A ${year} sheet ready — enter the figures`);
    await load();
    if (!forClient && row) { setOpenId(null); setEditId(row.id); }
  };
  const patch = async (s, fields, msg) => {
    const { error } = await supabase.from('income_sheets').update({ ...fields, updated_at: new Date().toISOString() }).eq('id', s.id);
    if (error) return toast.error(error.message);
    if (msg) toast.success(msg);
    load();
  };
  const reopen = (s) => {
    const note = window.prompt('Reopen for the client to edit. Message to the client (optional):', s.admin_note ?? '');
    if (note === null) return;
    patch(s, { status: 'open', admin_note: note.trim() || null, reviewed_at: null }, 'Reopened for the client');
  };
  const remove = async (s) => {
    if (!window.confirm(`Delete the Y/A ${s.year} income sheet and everything entered in it?`)) return;
    const { error } = await supabase.from('income_sheets').delete().eq('id', s.id);
    if (error) return toast.error(error.message);
    toast.success('Deleted'); load();
  };
  const toReturn = (s) => {
    const { input, bizLoss } = sheetToReturnInput(s.data);
    if (bizLoss) toast(`Business shows a loss of ${rs(bizLoss)} — check before filing`, { icon: '⚠️' });
    navigate('/admin/calculator', { state: { newReturn: { client_id: client.id, year: s.year, label: `From income sheet ${s.year}`, input_data: { form: 'IIT_RETURN', ...input } } } });
  };
  const msg = (s) => async () => {
    if (!client.profile_id) throw new Error('This client has no portal login yet. Invite them from the Overview tab first.');
    if (!s.enabled) await patch(s, { enabled: true });
    const first = (client.contact_preferred && client.contact_name ? client.contact_name : client.full_name || '').trim().split(/\s+/).slice(-1)[0];
    return `Dear ${first || 'Sir/Madam'},

Please enter your monthly income${' '}and business income & expenses for Y/A ${s.year} in your TaxMate portal. It helps us prepare an accurate Income Tax Return.
${window.location.origin}/client/income?year=${encodeURIComponent(s.year)}

කරුණාකර ${s.year} වර්ෂයේ මාසික ආදායම හා ව්‍යාපාරික ආදායම/වියදම් ඔබගේ portal එකේ ඇතුළත් කර Submit කරන්න.

Thank you,
${FIRM.name}
WhatsApp ${FIRM.whatsapp}`;
  };

  return (
    <div className="card">
      <div className="card-header"><Wallet size={16} /> Monthly Income &amp; Business sheet</div>
      <div className="p-5 space-y-3">
        {!client.profile_id && (
          <div className="text-xs text-amber-800 bg-amber-50 border border-amber-200 rounded-lg p-2.5 flex gap-2"><AlertTriangle size={14} className="flex-shrink-0 mt-0.5" />
            {client.full_name} has no portal login yet, so they can't fill it online. Invite them from the Overview tab.</div>
        )}
        <div className="flex flex-wrap items-end gap-3">
          <div>
            <label className="block text-xs font-semibold text-gray-500 mb-1">Year of Assessment</label>
            <select className="input w-36" value={year} onChange={e => setYear(e.target.value)}>
              {alYears().map(y => <option key={y} value={y} disabled={have.has(y)}>{y}{have.has(y) ? ' ✓' : ''}</option>)}
            </select>
          </div>
          <button onClick={() => enable(true)} disabled={have.has(year) || !client.profile_id} title={client.profile_id ? '' : 'No portal login yet'} className="btn-primary text-sm"><Plus size={15} /> Enable for client · Y/A {year}</button>
          <button onClick={() => enable(false)} disabled={have.has(year)} className="btn-secondary text-sm"><PencilLine size={15} /> I'll enter it myself</button>
        </div>
        <p className="text-xs text-gray-400">The client enters each month's salary, rent, interest, foreign income and business income &amp; expenses, then submits — or you enter / correct the figures yourself with <b>Edit</b> (e.g. from bank statements or a WhatsApp photo). Use <b>Open in IIT Return</b> to turn it into a computation.</p>
      </div>
      {loading ? <div className="p-6 text-sm text-gray-400">Loading…</div> : list.length === 0 ? (
        <div className="p-8 text-center text-gray-400 text-sm border-t border-gray-100">No income sheets yet</div>
      ) : (
        <div className="divide-y divide-gray-50 border-t border-gray-100">
          {list.map(s => {
            const t = sheetTotals(s.data);
            const isOpen = openId === s.id;
            return (
              <div key={s.id}>
                <div className="px-5 py-3 flex flex-wrap items-center gap-3">
                  <div className="w-20 font-bold text-primary-700">Y/A {s.year}</div>
                  <div className="flex-1 min-w-[200px]">
                    <Pill s={s.status} enabled={s.enabled} />
                    <div className="text-xs text-gray-500 mt-0.5">{t.monthsFilled}/12 months · income {rs(t.income + t.fx)} · business {rs(t.bizProfit)}{s.submitted_at && ` · submitted ${fmtDate(s.submitted_at)}`}</div>
                    {s.client_note && <div className="text-xs text-blue-800 mt-0.5 flex gap-1"><MessageSquare size={11} className="mt-0.5" /> {s.client_note}</div>}
                  </div>
                  <div className="flex gap-1.5 flex-wrap">
                    <button onClick={() => { setEditId(editId === s.id ? null : s.id); setOpenId(null); }} className={`text-xs py-1 px-2.5 ${editId === s.id ? 'btn-primary' : 'btn-secondary'}`}><PencilLine size={13} /> Edit</button>
                    <button onClick={() => { setOpenId(isOpen ? null : s.id); setEditId(null); }} className="btn-secondary text-xs py-1 px-2.5">{isOpen ? <ChevronUp size={13} /> : <ChevronDown size={13} />} View</button>
                    <button onClick={() => toReturn(s)} className="btn-primary text-xs py-1 px-2.5"><FileSpreadsheet size={13} /> Open in IIT Return</button>
                    {s.status === 'open' && <MessageMenu label="Send" phone={client.mobile} email={client.email} recipients={recipientsOf(client)} subject={`Monthly income Y/A ${s.year} — TaxMate`} getText={msg(s)} />}
                    {s.status === 'submitted' && <button onClick={() => patch(s, { status: 'reviewed', reviewed_at: new Date().toISOString() }, 'Marked reviewed')} className="btn-secondary text-xs py-1 px-2.5"><CheckCircle2 size={13} /> Reviewed</button>}
                    {s.status !== 'open' && <button onClick={() => reopen(s)} className="btn-secondary text-xs py-1 px-2.5"><RotateCcw size={13} /> Reopen</button>}
                    <button onClick={() => patch(s, { enabled: !s.enabled }, s.enabled ? 'Hidden from client' : 'Visible to client')} title={s.enabled ? 'Hide from client' : 'Show to client'} className="btn-secondary text-xs py-1 px-2">{s.enabled ? <EyeOff size={13} /> : <Eye size={13} />}</button>
                    <button onClick={() => remove(s)} title="Delete" className="btn-secondary text-xs py-1 px-2 text-red-600"><Trash2 size={13} /></button>
                  </div>
                </div>
                {isOpen && <div className="px-2 pb-4"><YearTable data={s.data} /></div>}
                {editId === s.id && <IncomeSheetEditor key={s.id} sheet={s} client={client} onClose={() => setEditId(null)} onSaved={load} />}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
