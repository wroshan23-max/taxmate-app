import { useEffect, useMemo, useState } from 'react';
import { supabase, fmtRs, fmtDate } from '../lib/supabase';
import toast from 'react-hot-toast';
import { Eye, EyeOff, Printer, Pencil, Share2, CheckCircle, Trash2, Search, FolderOpen } from 'lucide-react';
import { summarizeCalc, KIND_LABEL } from '../lib/iitCalc';
import { buildStatementHtml, openStatement } from '../lib/iitStatement';

const STATUS_STYLE = {
  payable:    { label: 'Payable',    cls: 'text-red-700' },
  refund:     { label: 'Refund',     cls: 'text-green-700' },
  nil:        { label: 'Nil',        cls: 'text-gray-500' },
  instalment: { label: 'Instalment', cls: 'text-primary-700' },
};

/**
 * List of saved IIT calculations with inline statement preview, PDF, reopen/edit, share and delete.
 * Props:
 *  - clientId (optional): show only this client's calculations
 *  - onOpen(calc) (optional): open the calculation in the calculator for editing
 *  - compact: hide the search/filter bar (used inside Client Detail)
 */
export default function SavedCalculations({ clientId, onOpen, compact = false }) {
  const [rows, setRows]       = useState([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch]   = useState('');
  const [year, setYear]       = useState('all');
  const [openId, setOpenId]   = useState(null);

  const load = async () => {
    setLoading(true);
    let q = supabase.from('iit_calculations')
      .select('*, clients(id, full_name, tin, nic, address, employer, resident_status)')
      .order('created_at', { ascending: false })
      .limit(300);
    if (clientId) q = q.eq('client_id', clientId);
    const { data, error } = await q;
    if (error) toast.error(error.message);
    setRows(data ?? []);
    setLoading(false);
  };

  useEffect(() => { load(); }, [clientId]); // eslint-disable-line react-hooks/exhaustive-deps

  const years = useMemo(() => [...new Set(rows.map(r => r.year))].sort().reverse(), [rows]);

  const filtered = rows.filter(r => {
    if (year !== 'all' && r.year !== year) return false;
    if (!search) return true;
    const s = search.toLowerCase();
    return r.clients?.full_name?.toLowerCase().includes(s) || r.clients?.tin?.includes(search);
  });

  const toggleShare = async (r) => {
    const { error } = await supabase.from('iit_calculations').update({ shared_with_client: !r.shared_with_client }).eq('id', r.id);
    if (error) return toast.error(error.message);
    toast.success(!r.shared_with_client ? 'Shared with client portal' : 'Hidden from client portal');
    setRows(rs => rs.map(x => (x.id === r.id ? { ...x, shared_with_client: !x.shared_with_client } : x)));
  };

  const remove = async (r) => {
    if (!window.confirm(`Delete this ${r.year} calculation for ${r.clients?.full_name ?? 'client'}? This cannot be undone.`)) return;
    const { error } = await supabase.from('iit_calculations').delete().eq('id', r.id);
    if (error) return toast.error(error.message);
    toast.success('Calculation deleted');
    setRows(rs => rs.filter(x => x.id !== r.id));
  };

  const print = (r) => {
    if (!openStatement(r, r.clients ?? {})) toast.error('Pop-up blocked — allow pop-ups for this site to print');
  };

  return (
    <div className="card overflow-hidden">
      <div className="card-header flex-wrap gap-3">
        <FolderOpen size={16} /> Saved Calculations
        <span className="text-xs text-gray-400 font-normal">{filtered.length} of {rows.length}</span>
        {!compact && (
          <div className="ml-auto flex gap-2 flex-wrap">
            <div className="relative">
              <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
              <input className="input pl-8 py-1.5 text-sm w-52" placeholder="Search name or TIN…" value={search} onChange={e => setSearch(e.target.value)} />
            </div>
            <select className="input py-1.5 text-sm w-32" value={year} onChange={e => setYear(e.target.value)}>
              <option value="all">All years</option>
              {years.map(y => <option key={y} value={y}>Y/A {y}</option>)}
            </select>
          </div>
        )}
      </div>

      {loading ? (
        <div className="p-8 text-center text-gray-400 text-sm">Loading…</div>
      ) : filtered.length === 0 ? (
        <div className="p-10 text-center text-gray-400 text-sm">No saved calculations{search || year !== 'all' ? ' match this filter' : ' yet'}.</div>
      ) : (
        <div className="divide-y divide-gray-100">
          {filtered.map(r => {
            const sm = summarizeCalc(r);
            const st = STATUS_STYLE[sm.status] ?? STATUS_STYLE.nil;
            const isOpen = openId === r.id;
            return (
              <div key={r.id}>
                <div className="flex items-center gap-3 px-5 py-3 flex-wrap hover:bg-gray-50">
                  <div className="flex-1 min-w-52">
                    {!clientId && (
                      <div className="text-sm font-semibold text-gray-800">
                        {r.clients?.full_name ?? '—'} <span className="text-xs text-gray-400 font-normal">{r.clients?.tin ? `TIN ${r.clients.tin}` : ''}</span>
                      </div>
                    )}
                    <div className={clientId ? 'text-sm font-semibold text-gray-800' : 'text-xs text-gray-500'}>
                      {KIND_LABEL[sm.kind]} · Y/A {r.year}
                    </div>
                    <div className="text-xs text-gray-400">
                      Saved {fmtDate(r.created_at)}{sm.assessable != null ? ` · Assessable ${fmtRs(sm.assessable)}` : ''}{sm.grossTax != null ? ` · Gross tax ${fmtRs(sm.grossTax)}` : ''}
                    </div>
                  </div>
                  <div className="text-right mr-2">
                    <div className={`font-bold text-sm ${st.cls}`}>{fmtRs(Math.abs(sm.amount))}</div>
                    <div className="text-xs text-gray-400">{st.label}</div>
                  </div>
                  <div className="flex gap-1.5 flex-wrap">
                    <button onClick={() => setOpenId(isOpen ? null : r.id)} className="btn-secondary text-xs py-1 px-2.5" title="View statement">
                      {isOpen ? <EyeOff size={13} /> : <Eye size={13} />} {isOpen ? 'Hide' : 'View'}
                    </button>
                    <button onClick={() => print(r)} className="btn-secondary text-xs py-1 px-2.5" title="Print / save as PDF">
                      <Printer size={13} /> PDF
                    </button>
                    {onOpen && (
                      <button onClick={() => onOpen(r)} className="btn-secondary text-xs py-1 px-2.5" title="Open in calculator to edit">
                        <Pencil size={13} /> Edit
                      </button>
                    )}
                    <button onClick={() => toggleShare(r)} title="Show / hide on client portal"
                      className={`flex items-center gap-1 text-xs px-2.5 py-1 rounded-lg transition-colors ${r.shared_with_client ? 'bg-green-100 text-green-700' : 'bg-gray-100 text-gray-500 hover:bg-blue-50 hover:text-blue-600'}`}>
                      {r.shared_with_client ? <><CheckCircle size={12} /> Shared</> : <><Share2 size={12} /> Share</>}
                    </button>
                    <button onClick={() => remove(r)} className="text-xs px-2 py-1 rounded-lg text-gray-400 hover:text-red-600 hover:bg-red-50" title="Delete">
                      <Trash2 size={13} />
                    </button>
                  </div>
                </div>
                {isOpen && (
                  <div className="bg-gray-50 border-t border-gray-100 p-3">
                    <iframe
                      title={`Statement ${r.id}`}
                      srcDoc={buildStatementHtml(r, r.clients ?? {}, { withToolbar: false })}
                      className="w-full bg-white rounded-lg border border-gray-200"
                      style={{ height: 820 }}
                    />
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
