import { useEffect, useMemo, useState } from 'react';
import { supabase, fmtRs, fmtDate } from '../lib/supabase';
import toast from 'react-hot-toast';
import { Eye, EyeOff, Printer, Pencil, Trash2, Search, FolderOpen, Lock, Unlock, CheckCircle2, MessageSquareWarning, Link2, Globe } from 'lucide-react';
import { summarizeCalc, KIND_LABEL, calcKind } from '../lib/iitCalc';
import { buildStatementHtml, openStatement } from '../lib/iitStatement';
import { calcMessage } from '../lib/share';
import SendMenu from './SendMenu';
import { recipientsOf } from '../lib/contacts';

const AMT_STYLE = { payable: 'text-red-700', refund: 'text-green-700', nil: 'text-gray-500', instalment: 'text-primary-700' };
const AMT_LABEL = { payable: 'Payable', refund: 'Refund', nil: 'Nil', instalment: 'Instalment' };
const groupKey = (r) => `${r.client_id}|${r.year}|${calcKind(r)}`;

// Keep the client's Tax Return row (same Y/A) in step with the FINAL calculation
async function syncTaxReturn(calc) {
  const sm = summarizeCalc(calc);
  if (sm.assessable == null) return;
  await supabase.from('tax_returns')
    .update({ gross_income: Math.round(sm.assessable), total_tax: Math.round(sm.grossTax), updated_at: new Date().toISOString() })
    .eq('client_id', calc.client_id).eq('year', calc.year);
}

/**
 * Saved IIT calculations grouped by client + period, each with its draft/final versions.
 *  clientId (optional) — only this client's calculations
 *  onOpen(calc)        — open a version in the calculator
 *  compact             — hide the search/filter bar
 */
export default function SavedCalculations({ clientId, onOpen, compact = false }) {
  const [rows, setRows]       = useState([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch]   = useState('');
  const [year, setYear]       = useState('all');
  const [show, setShow]       = useState('all');
  const [openId, setOpenId]   = useState(null);

  const load = async () => {
    setLoading(true);
    let q = supabase.from('iit_calculations')
      .select('*, clients(id, full_name, tin, nic, address, employer, resident_status, mobile, email, contact_name, contact_relation, contact_mobile, contact_email, contact_preferred)')
      .order('created_at', { ascending: true })
      .limit(500);
    if (clientId) q = q.eq('client_id', clientId);
    const { data, error } = await q;
    if (error) toast.error(error.message);
    setRows(data ?? []);
    setLoading(false);
  };
  useEffect(() => { load(); }, [clientId]); // eslint-disable-line react-hooks/exhaustive-deps

  const patchRow = (id, patch) => setRows(rs => rs.map(x => (x.id === id ? { ...x, ...patch } : x)));
  const years = useMemo(() => [...new Set(rows.map(r => r.year))].sort().reverse(), [rows]);
  const attention = rows.filter(r => r.client_status === 'changes_requested' && r.status !== 'final').length;

  // version number = order of creation within the period
  const versionNo = useMemo(() => {
    const seen = {}, map = {};
    for (const r of rows) { const k = groupKey(r); seen[k] = (seen[k] ?? 0) + 1; map[r.id] = seen[k]; }
    return map;
  }, [rows]);

  const groups = useMemo(() => {
    const g = new Map();
    for (const r of rows) {
      if (year !== 'all' && r.year !== year) continue;
      if (search) {
        const s = search.toLowerCase();
        if (!r.clients?.full_name?.toLowerCase().includes(s) && !(r.clients?.tin ?? '').includes(search)) continue;
      }
      const k = groupKey(r);
      if (!g.has(k)) g.set(k, []);
      g.get(k).push(r);
    }
    let list = [...g.values()].map(vs => {
      const sorted = [...vs].sort((a, b) => new Date(b.created_at) - new Date(a.created_at));
      return { key: groupKey(vs[0]), versions: sorted, final: vs.find(v => v.status === 'final'), latest: sorted[0] };
    });
    if (show === 'attention') list = list.filter(gr => gr.versions.some(v => v.client_status === 'changes_requested' && v.status !== 'final'));
    if (show === 'final') list = list.filter(gr => gr.final);
    if (show === 'nofinal') list = list.filter(gr => !gr.final);
    const activity = (gr) => Math.max(...gr.versions.map(v => new Date(v.client_responded_at || v.updated_at || v.created_at).getTime()));
    return list.sort((a, b) => activity(b) - activity(a));
  }, [rows, year, search, show]);

  const markFinal = async (r) => {
    const others = rows.filter(x => groupKey(x) === groupKey(r) && x.id !== r.id && x.status === 'final');
    const msg = `Mark version ${versionNo[r.id]}${r.label ? ` (${r.label})` : ''} as FINAL for ${r.clients?.full_name ?? 'this client'} — Y/A ${r.year}?`
      + (r.client_status !== 'approved' ? '\n\nNote: the client has not confirmed this version yet.' : '')
      + (others.length ? '\n\nThe current final version will go back to draft.' : '');
    if (!window.confirm(msg)) return;
    const now = new Date().toISOString();
    if (others.length) {
      const { error } = await supabase.from('iit_calculations').update({ status: 'draft', finalized_at: null }).in('id', others.map(o => o.id));
      if (error) return toast.error(error.message);
      others.forEach(o => patchRow(o.id, { status: 'draft', finalized_at: null }));
    }
    const { error } = await supabase.from('iit_calculations').update({ status: 'final', finalized_at: now }).eq('id', r.id);
    if (error) return toast.error(error.message);
    patchRow(r.id, { status: 'final', finalized_at: now });
    await syncTaxReturn(r);
    toast.success('Marked as FINAL — tax return figures updated');
  };

  const reopen = async (r) => {
    if (!window.confirm('Move this final version back to draft?')) return;
    const { error } = await supabase.from('iit_calculations').update({ status: 'draft', finalized_at: null }).eq('id', r.id);
    if (error) return toast.error(error.message);
    patchRow(r.id, { status: 'draft', finalized_at: null });
  };

  const togglePortal = async (r) => {
    const { error } = await supabase.from('iit_calculations').update({ shared_with_client: !r.shared_with_client }).eq('id', r.id);
    if (error) return toast.error(error.message);
    patchRow(r.id, { shared_with_client: !r.shared_with_client });
    toast.success(!r.shared_with_client ? 'Visible on client portal' : 'Hidden from client portal');
  };

  const remove = async (r) => {
    if (!window.confirm(`Delete version ${versionNo[r.id]} (${r.status === 'final' ? 'FINAL' : 'draft'}) for ${r.clients?.full_name ?? 'client'} — Y/A ${r.year}? This cannot be undone.`)) return;
    const { error } = await supabase.from('iit_calculations').delete().eq('id', r.id);
    if (error) return toast.error(error.message);
    setRows(rs => rs.filter(x => x.id !== r.id));
    toast.success('Version deleted');
  };

  const print = (r) => { if (!openStatement(r, r.clients ?? {})) toast.error('Pop-up blocked — allow pop-ups for this site to print'); };

  return (
    <div className="space-y-3">
      {attention > 0 && (
        <button onClick={() => setShow('attention')} className="w-full text-left flex items-center gap-2 bg-amber-50 border border-amber-200 text-amber-800 rounded-lg px-4 py-2 text-sm">
          <MessageSquareWarning size={16} /> {attention} draft{attention > 1 ? 's' : ''} where the client asked for changes — tap to view
        </button>
      )}
      <div className="card overflow-hidden">
        <div className="card-header flex-wrap gap-3">
          <FolderOpen size={16} /> Saved Calculations
          <span className="text-xs text-gray-400 font-normal">{groups.length} period{groups.length !== 1 ? 's' : ''} · {rows.length} versions</span>
          <div className="ml-auto flex gap-2 flex-wrap">
            {!compact && (
              <div className="relative">
                <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
                <input className="input pl-8 py-1.5 text-sm w-48" placeholder="Search name or TIN…" value={search} onChange={e => setSearch(e.target.value)} />
              </div>
            )}
            <select className="input py-1.5 text-sm w-32" value={year} onChange={e => setYear(e.target.value)}>
              <option value="all">All years</option>
              {years.map(y => <option key={y} value={y}>Y/A {y}</option>)}
            </select>
            <select className="input py-1.5 text-sm w-44" value={show} onChange={e => setShow(e.target.value)}>
              <option value="all">All periods</option>
              <option value="attention">✏️ Client asked for changes</option>
              <option value="nofinal">📝 Not finalised yet</option>
              <option value="final">✅ Has final version</option>
            </select>
          </div>
        </div>

        {loading ? (
          <div className="p-8 text-center text-gray-400 text-sm">Loading…</div>
        ) : groups.length === 0 ? (
          <div className="p-10 text-center text-gray-400 text-sm">No saved calculations{search || year !== 'all' || show !== 'all' ? ' match this filter' : ' yet'}.</div>
        ) : (
          <div className="divide-y divide-gray-200">
            {groups.map(gr => {
              const c = gr.latest.clients ?? {};
              return (
                <div key={gr.key} className="bg-white">
                  {/* Period header */}
                  <div className="flex items-center gap-2 px-5 py-2.5 bg-gray-50 flex-wrap">
                    {!clientId && <span className="text-sm font-bold text-gray-800">{c.full_name ?? '—'}</span>}
                    {!clientId && c.tin && <span className="text-xs text-gray-400">TIN {c.tin}</span>}
                    <span className="text-xs font-semibold px-2 py-0.5 rounded bg-primary-100 text-primary-700">Y/A {gr.latest.year}</span>
                    <span className="text-xs text-gray-500">{KIND_LABEL[calcKind(gr.latest)]}</span>
                    <span className="ml-auto text-xs">
                      {gr.final
                        ? <span className="font-semibold text-green-700">✅ Final: version {versionNo[gr.final.id]}</span>
                        : <span className="font-semibold text-amber-700">📝 {gr.versions.length} draft{gr.versions.length > 1 ? 's' : ''} — not final yet</span>}
                    </span>
                  </div>

                  {/* Versions */}
                  {gr.versions.map(r => {
                    const sm = summarizeCalc(r);
                    const isFinal = r.status === 'final';
                    const isOpen = openId === r.id;
                    return (
                      <div key={r.id} className={isFinal ? 'bg-green-50/40' : ''}>
                        <div className="flex items-center gap-3 px-5 py-3 flex-wrap border-t border-gray-100">
                          <div className="flex-1 min-w-56">
                            <div className="flex items-center gap-2 flex-wrap">
                              <span className={`text-[11px] font-black px-1.5 py-0.5 rounded ${isFinal ? 'bg-green-600 text-white' : 'bg-gray-200 text-gray-700'}`}>
                                {isFinal ? 'FINAL' : 'DRAFT'}
                              </span>
                              <span className="text-sm font-semibold text-gray-800">v{versionNo[r.id]}{r.label ? ` · ${r.label}` : ''}</span>
                              {r.shared_with_client && <span title="Visible on client portal" className="text-[11px] px-1.5 py-0.5 rounded bg-blue-50 text-blue-700 flex items-center gap-1"><Globe size={10} /> Portal</span>}
                              {r.share_token && <span title="Share link is active" className="text-[11px] px-1.5 py-0.5 rounded bg-green-50 text-green-700 flex items-center gap-1"><Link2 size={10} /> Link sent</span>}
                            </div>
                            <div className="text-xs text-gray-400 mt-0.5">
                              Saved {fmtDate(r.created_at)}{r.updated_at ? ` · edited ${fmtDate(r.updated_at)}` : ''}{isFinal && r.finalized_at ? ` · finalised ${fmtDate(r.finalized_at)}` : ''}
                              {sm.assessable != null ? ` · Assessable ${fmtRs(sm.assessable)}` : ''}
                            </div>
                            {r.client_status === 'approved' && (
                              <div className="text-xs text-green-700 font-semibold mt-1 flex items-center gap-1"><CheckCircle2 size={12} /> Client confirmed {fmtDate(r.client_responded_at)}{r.client_note ? ` — “${r.client_note}”` : ''}</div>
                            )}
                            {r.client_status === 'changes_requested' && (
                              <div className="text-xs text-amber-800 bg-amber-50 border border-amber-200 rounded px-2 py-1 mt-1">
                                ✏️ Client asked for changes ({fmtDate(r.client_responded_at)}){r.client_note ? `: “${r.client_note}”` : ''}
                              </div>
                            )}
                          </div>
                          <div className="text-right mr-1">
                            <div className={`font-bold text-sm ${AMT_STYLE[sm.status] ?? ''}`}>{fmtRs(Math.abs(sm.amount))}</div>
                            <div className="text-xs text-gray-400">{AMT_LABEL[sm.status]}</div>
                          </div>
                          <div className="flex gap-1.5 flex-wrap items-center">
                            <button onClick={() => setOpenId(isOpen ? null : r.id)} className="btn-secondary text-xs py-1 px-2.5" title="View statement">
                              {isOpen ? <EyeOff size={13} /> : <Eye size={13} />} {isOpen ? 'Hide' : 'View'}
                            </button>
                            <button onClick={() => print(r)} className="btn-secondary text-xs py-1 px-2.5" title="Print / save as PDF"><Printer size={13} /> PDF</button>
                            {onOpen && <button onClick={() => onOpen(r)} className="btn-secondary text-xs py-1 px-2.5" title={isFinal ? 'Open (changes save as a new draft)' : 'Edit this draft'}><Pencil size={13} /> {isFinal ? 'Open' : 'Edit'}</button>}
                            <SendMenu
                              table="iit_calculations" row={r} phone={c.mobile} email={c.email} recipients={recipientsOf(c)}
                              subject={`${isFinal ? 'Final' : 'Draft'} Income Tax Computation — Y/A ${r.year} — TaxMate Solutions`}
                              buildMessage={(url) => calcMessage(r, c, url)}
                              onChange={(patch) => patchRow(r.id, patch)}
                            />
                            {isFinal
                              ? <button onClick={() => reopen(r)} title="Move back to draft" className="text-xs px-2.5 py-1 rounded-lg bg-gray-100 text-gray-600 hover:bg-gray-200 flex items-center gap-1"><Unlock size={12} /> Reopen</button>
                              : <button onClick={() => markFinal(r)} title="Lock this version as the final computation" className="text-xs font-semibold px-2.5 py-1 rounded-lg bg-primary-600 text-white hover:bg-primary-700 flex items-center gap-1"><Lock size={12} /> Mark Final</button>}
                            <button onClick={() => togglePortal(r)} title={r.shared_with_client ? 'Hide from client portal' : 'Show on client portal'}
                              className={`text-xs px-2 py-1 rounded-lg ${r.shared_with_client ? 'bg-blue-100 text-blue-700' : 'bg-gray-100 text-gray-500 hover:bg-blue-50'}`}>
                              <Globe size={13} />
                            </button>
                            <button onClick={() => remove(r)} className="text-xs px-2 py-1 rounded-lg text-gray-400 hover:text-red-600 hover:bg-red-50" title="Delete version"><Trash2 size={13} /></button>
                          </div>
                        </div>
                        {isOpen && (
                          <div className="bg-gray-50 border-t border-gray-100 p-3">
                            <iframe title={`Statement ${r.id}`} srcDoc={buildStatementHtml(r, c, { withToolbar: false })}
                              className="w-full bg-white rounded-lg border border-gray-200" style={{ height: 820 }} />
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
