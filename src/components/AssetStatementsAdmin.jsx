import { useEffect, useState } from 'react';
import toast from 'react-hot-toast';
import { Landmark, Plus, Printer, Save, X, RotateCcw, CheckCircle2, Eye, EyeOff, Trash2, Edit2, AlertTriangle, MessageSquare } from 'lucide-react';
import { supabase, fmtDate } from '../lib/supabase';
import { useAuth } from '../contexts/AuthContext';
import {
  alYears, filingYear, createStatement, totals, fmtMoney, AL_STATUS, openAssetStatement,
  alRequestMessage, portalAssetsUrl, cleanData, validate,
} from '../lib/assets';
import AssetStatementForm, { AssetSummary } from './AssetStatementForm';
import MessageMenu from './MessageMenu';

export function StatusPill({ s, enabled = true }) {
  if (!enabled) return <span className="text-[11px] font-semibold px-2 py-0.5 rounded-full bg-gray-100 text-gray-500">Hidden from client</span>;
  const st = AL_STATUS[s] ?? AL_STATUS.open;
  return <span className={`text-[11px] font-semibold px-2 py-0.5 rounded-full whitespace-nowrap ${st.cls}`}>{st.label}</span>;
}

/** Assets & Liabilities tab inside a client's page (admin). */
export default function AssetStatementsAdmin({ client }) {
  const { user } = useAuth();
  const [list, setList] = useState([]);
  const [loading, setLoading] = useState(true);
  const [year, setYear] = useState(filingYear());
  const [blank, setBlank] = useState(false);
  const [busy, setBusy] = useState(false);
  const [edit, setEdit] = useState(null);       // statement being viewed / edited
  const [draft, setDraft] = useState(null);     // editable copy of edit.data
  const [errors, setErrors] = useState([]);

  const load = async () => {
    const { data, error } = await supabase.from('asset_statements').select('*').eq('client_id', client.id).order('year', { ascending: false });
    if (error) toast.error(error.message);
    setList(data ?? []);
    setLoading(false);
    return data ?? [];
  };
  useEffect(() => { load(); }, [client.id]); // eslint-disable-line react-hooks/exhaustive-deps

  const existingYears = new Set(list.map(s => s.year));
  const years = alYears();

  const enable = async () => {
    setBusy(true);
    try {
      const row = await createStatement(supabase, { clientId: client.id, year, userId: user.id, blank });
      toast.success(row.prefilled_from ? `Y/A ${year} sheet enabled — prefilled from last year` : `Y/A ${year} sheet enabled`);
      await load();
    } catch (e) { toast.error(e.message); }
    setBusy(false);
  };

  const patch = async (s, fields, msg) => {
    const { error } = await supabase.from('asset_statements').update({ ...fields, updated_at: new Date().toISOString() }).eq('id', s.id);
    if (error) return toast.error(error.message);
    if (msg) toast.success(msg);
    const fresh = await load();
    if (edit?.id === s.id) { const n = fresh.find(x => x.id === s.id); setEdit(n ?? null); }
  };

  const reopen = (s) => {
    const note = window.prompt('Reopen for the client to edit. Message to the client (what to fix) — optional:', s.admin_note ?? '');
    if (note === null) return;
    patch(s, { status: 'open', admin_note: note.trim() || null, reviewed_at: null }, 'Reopened — the client can edit and submit again');
  };
  const markReviewed = (s) => patch(s, { status: 'reviewed', reviewed_at: new Date().toISOString() }, 'Marked as reviewed');
  const toggleEnabled = (s) => patch(s, { enabled: !s.enabled }, s.enabled ? 'Hidden from the client portal' : 'Visible in the client portal again');
  const remove = async (s) => {
    if (!window.confirm(`Delete the Y/A ${s.year} Assets & Liabilities sheet? Everything entered in it is lost.`)) return;
    const { error } = await supabase.from('asset_statements').delete().eq('id', s.id);
    if (error) return toast.error(error.message);
    toast.success('Deleted');
    if (edit?.id === s.id) { setEdit(null); setDraft(null); }
    load();
  };

  const openEditor = (s) => { setEdit(s); setDraft(s.data ?? {}); setErrors([]); setTimeout(() => document.getElementById('al-editor')?.scrollIntoView({ behavior: 'smooth' }), 50); };

  const saveEditor = async () => {
    const clean = cleanData(draft);
    const errs = validate(clean, edit.year);
    setErrors(errs);
    if (errs.length && !window.confirm(`${errs.length} item(s) look incomplete. Save anyway?`)) return;
    setBusy(true);
    await patch(edit, { data: clean }, 'Saved');
    setDraft(clean);
    setBusy(false);
  };

  const pdf = (s, data) => {
    const w = window.open('', '_blank', 'width=920,height=900');
    if (!openAssetStatement({ ...s, data: data ?? s.data }, client, w)) toast.error('Pop-up blocked — allow pop-ups for this site');
  };

  const requestText = (s) => async () => {
    if (!client.profile_id) throw new Error('This client has no portal login yet. Invite them from the Overview tab first.');
    if (!s.enabled) await patch(s, { enabled: true });
    return alRequestMessage({ name: client.full_name, year: s.year, url: portalAssetsUrl(s.year), prefilled: !!s.prefilled_from });
  };

  return (
    <div className="space-y-4">
      <div className="card">
        <div className="card-header"><Landmark size={16} /> Statement of Assets &amp; Liabilities</div>
        <div className="p-5 space-y-4">
          {!client.profile_id && (
            <div className="text-xs text-amber-800 bg-amber-50 border border-amber-200 rounded-lg p-2.5 flex gap-2">
              <AlertTriangle size={14} className="flex-shrink-0 mt-0.5" />
              <span>{client.full_name} has no portal login yet, so they can't fill the form online. Invite them from the Overview tab — or open the sheet here and fill it in yourself.</span>
            </div>
          )}
          <div className="flex flex-wrap items-end gap-3">
            <div>
              <label className="block text-xs font-semibold text-gray-500 mb-1">Year of Assessment</label>
              <select className="input w-36" value={year} onChange={e => setYear(e.target.value)}>
                {years.map(y => <option key={y} value={y} disabled={existingYears.has(y)}>{y}{existingYears.has(y) ? ' ✓' : ''}</option>)}
              </select>
            </div>
            <label className="flex items-center gap-2 text-sm text-gray-600 pb-2">
              <input type="checkbox" checked={blank} onChange={e => setBlank(e.target.checked)} /> Start blank (don't copy last year)
            </label>
            <button onClick={enable} disabled={busy || existingYears.has(year)} className="btn-primary text-sm"><Plus size={15} /> Enable sheet for Y/A {year}</button>
          </div>
          <p className="text-xs text-gray-400">The client then sees the sheet in their portal (Assets &amp; Liabilities), fills it and submits it to you. If they have an earlier year's sheet, Part 1 is filled in from it so they only update the changes.</p>
        </div>

        {loading ? <div className="p-6 text-sm text-gray-400">Loading…</div> : list.length === 0 ? (
          <div className="p-8 text-center text-gray-400 text-sm border-t border-gray-100">No Assets &amp; Liabilities sheets yet</div>
        ) : (
          <div className="divide-y divide-gray-50 border-t border-gray-100">
            {list.map(s => {
              const t = totals(s.data);
              return (
                <div key={s.id} className={`px-5 py-3 flex flex-wrap items-center gap-3 ${edit?.id === s.id ? 'bg-primary-50/40' : ''}`}>
                  <div className="w-20 font-bold text-primary-700">Y/A {s.year}</div>
                  <div className="flex-1 min-w-[180px]">
                    <div className="flex items-center gap-2 flex-wrap"><StatusPill s={s.status} enabled={s.enabled} />
                      {s.prefilled_from && <span className="text-[11px] text-gray-400">prefilled from last year</span>}</div>
                    <div className="text-xs text-gray-500 mt-0.5">
                      {t.count} entries · Net worth Rs. {fmtMoney(t.net)}
                      {s.submitted_at && ` · submitted ${fmtDate(s.submitted_at)}`}{s.reviewed_at && ` · reviewed ${fmtDate(s.reviewed_at)}`}
                    </div>
                    {s.client_note && <div className="text-xs text-blue-800 mt-0.5 flex gap-1"><MessageSquare size={11} className="mt-0.5" /> {s.client_note}</div>}
                  </div>
                  <div className="flex gap-1.5 flex-wrap">
                    <button onClick={() => openEditor(s)} className="btn-secondary text-xs py-1 px-2.5"><Edit2 size={13} /> Open</button>
                    <button onClick={() => pdf(s)} className="btn-secondary text-xs py-1 px-2.5"><Printer size={13} /> PDF</button>
                    {s.status === 'open' && (
                      <MessageMenu label="Send to client" phone={client.mobile} email={client.email}
                        subject={`Assets & Liabilities Y/A ${s.year} — TaxMate`} getText={requestText(s)} />
                    )}
                    {s.status === 'submitted' && <button onClick={() => markReviewed(s)} className="btn-primary text-xs py-1 px-2.5"><CheckCircle2 size={13} /> Mark reviewed</button>}
                    {s.status !== 'open' && <button onClick={() => reopen(s)} className="btn-secondary text-xs py-1 px-2.5"><RotateCcw size={13} /> Reopen</button>}
                    <button onClick={() => toggleEnabled(s)} title={s.enabled ? 'Hide from client' : 'Show to client'} className="btn-secondary text-xs py-1 px-2">{s.enabled ? <EyeOff size={13} /> : <Eye size={13} />}</button>
                    <button onClick={() => remove(s)} title="Delete" className="btn-secondary text-xs py-1 px-2 text-red-600"><Trash2 size={13} /></button>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {edit && draft && (
        <div id="al-editor" className="space-y-3">
          <div className="card p-4 flex flex-wrap items-center gap-3 sticky top-0 z-10">
            <div className="flex-1 min-w-[200px]">
              <div className="font-bold text-primary-800">Y/A {edit.year} — {client.full_name}</div>
              <div className="flex items-center gap-2 mt-0.5"><StatusPill s={edit.status} enabled={edit.enabled} />
                <span className="text-xs text-gray-400">Changes you save here are visible to the client.</span></div>
            </div>
            <button onClick={() => pdf(edit, draft)} className="btn-secondary text-sm"><Printer size={14} /> PDF</button>
            <button onClick={saveEditor} disabled={busy} className="btn-primary text-sm"><Save size={14} /> Save</button>
            <button onClick={() => { setEdit(null); setDraft(null); }} className="btn-secondary text-sm"><X size={14} /> Close</button>
          </div>
          {edit.admin_note && <div className="text-sm bg-amber-50 border border-amber-200 text-amber-900 rounded-lg p-3"><b>Your note to the client:</b> {edit.admin_note}</div>}
          {edit.client_note && <div className="text-sm bg-blue-50 border border-blue-200 text-blue-900 rounded-lg p-3"><b>Client's note:</b> {edit.client_note}</div>}
          <div className="grid lg:grid-cols-[1fr_300px] gap-4 items-start">
            <AssetStatementForm key={edit.id} data={draft} onChange={setDraft} year={edit.year} errors={errors} />
            <div className="lg:sticky lg:top-24"><AssetSummary data={draft} year={edit.year} /></div>
          </div>
        </div>
      )}
    </div>
  );
}
