import { useCallback, useEffect, useRef, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import toast from 'react-hot-toast';
import { Landmark, Save, Send, Printer, CheckCircle2, AlertTriangle, Loader2, History, X, Clock } from 'lucide-react';
import { supabase, fmtDate } from '../../lib/supabase';
import { useAuth } from '../../contexts/AuthContext';
import AssetStatementForm, { AssetSummary } from '../../components/AssetStatementForm';
import {
  yearInfo, totals, cleanData, validate, carryForward, openAssetStatement, SECTION,
} from '../../lib/assets';

const time = (d) => d.toLocaleTimeString('en-LK', { hour: '2-digit', minute: '2-digit' });

export default function ClientAssets() {
  const { user } = useAuth();
  const [params, setParams] = useSearchParams();
  const [client, setClient] = useState(null);
  const [list, setList] = useState([]);
  const [loading, setLoading] = useState(true);
  const [sel, setSel] = useState(null);
  const [data, setData] = useState(null);
  const [note, setNote] = useState('');
  const [dirty, setDirty] = useState(false);
  const [saving, setSaving] = useState(false);
  const [savedAt, setSavedAt] = useState(null);
  const [errors, setErrors] = useState([]);
  const [confirm, setConfirm] = useState(false);
  const [declared, setDeclared] = useState(false);
  const timer = useRef(null);
  const latest = useRef({ data: null, note: '' });
  latest.current = { data, note };

  const pick = (s) => {
    clearTimeout(timer.current); timer.current = null;
    setSel(s); setData(s?.data ?? null); setNote(s?.client_note ?? ''); setDirty(false); setErrors([]); setSavedAt(null);
  };

  const load = useCallback(async (keepYear) => {
    const [{ data: c }, { data: s, error }] = await Promise.all([
      supabase.from('clients').select('id, full_name, tin, nic, address, mobile, email').eq('profile_id', user.id).maybeSingle(),
      supabase.from('asset_statements').select('*').order('year', { ascending: false }),
    ]);
    if (error) toast.error(error.message);
    const rows = s ?? [];
    setClient(c); setList(rows); setLoading(false);
    const want = keepYear || params.get('year');
    pick(rows.find(r => r.year === want) ?? rows.find(r => r.status === 'open') ?? rows[0] ?? null);
  }, [user.id]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { load(); }, [load]);

  // Warn before closing the tab with unsaved changes
  useEffect(() => {
    const h = (e) => { if (dirty) { e.preventDefault(); e.returnValue = ''; } };
    window.addEventListener('beforeunload', h);
    return () => window.removeEventListener('beforeunload', h);
  }, [dirty]);

  const editable = sel?.status === 'open';

  const save = async ({ submit = false, quiet = false } = {}) => {
    if (!sel) return false;
    clearTimeout(timer.current); timer.current = null;
    setSaving(true);
    const cur = latest.current;   // newest values (auto-save runs from an older render)
    const clean = submit ? cleanData(cur.data) : cur.data;
    const { error } = await supabase.rpc('save_my_asset_statement', { p_id: sel.id, p_data: clean, p_note: cur.note, p_submit: submit });
    setSaving(false);
    if (error) { toast.error(error.message); return false; }
    setDirty(false); setSavedAt(new Date());
    if (!quiet) toast.success(submit ? 'Submitted to TaxMate — thank you!' : 'Saved');
    if (submit) await load(sel.year);
    return true;
  };

  // Auto-save a few seconds after the last change
  const change = (next) => {
    setData(next); setDirty(true);
    clearTimeout(timer.current);
    timer.current = setTimeout(() => save({ quiet: true }), 4000);
  };
  // Leaving the page with an auto-save still pending → save it now
  const selRef = useRef(null);
  selRef.current = sel;
  useEffect(() => () => {
    if (!timer.current) return;
    clearTimeout(timer.current);
    const s = selRef.current, cur = latest.current;
    if (s?.status === 'open' && cur.data) supabase.rpc('save_my_asset_statement', { p_id: s.id, p_data: cur.data, p_note: cur.note, p_submit: false });
  }, []);

  const startSubmit = () => {
    const clean = cleanData(data);
    const errs = validate(clean, sel.year);
    setData(clean); setErrors(errs);
    if (errs.length) {
      toast.error(`Please complete ${errs.length} item(s) marked in red`);
      setTimeout(() => document.querySelector('.ring-red-300')?.scrollIntoView({ behavior: 'smooth', block: 'start' }), 100);
      return;
    }
    setDeclared(false); setConfirm(true);
  };

  const doSubmit = async () => {
    if (!declared) return;
    const ok = await save({ submit: true });
    if (ok) setConfirm(false);
  };

  const prevStatement = sel ? list.find(s => s.year < sel.year) : null;
  const copyLastYear = () => {
    if (!prevStatement) return;
    if (!window.confirm(`Fill this form with what you declared for Y/A ${prevStatement.year}? Anything already entered here is replaced.`)) return;
    change(carryForward(prevStatement.data, prevStatement.year));
  };

  const pdf = () => {
    const w = window.open('', '_blank', 'width=920,height=900');
    if (!openAssetStatement({ ...sel, data, client_note: note }, client ?? {}, w)) toast.error('Pop-up blocked — allow pop-ups for this site');
  };

  if (loading) return <div className="flex items-center justify-center h-64 text-gray-400">Loading...</div>;

  if (!sel) return (
    <div className="space-y-4">
      <h1 className="text-2xl font-bold text-primary-800 flex items-center gap-2"><Landmark size={22} /> Assets &amp; Liabilities</h1>
      <div className="card p-8 text-center text-gray-500 text-sm">
        No Assets &amp; Liabilities form for you yet. TaxMate will open one when your Income Tax Return is being prepared.
        <div className="text-xs text-gray-400 mt-2">ඔබගේ ආදායම් බදු ප්‍රතිලාභය සකස් කරන විට TaxMate විසින් මෙම පත්‍රය විවෘත කරනු ඇත.</div>
      </div>
    </div>
  );

  const y = yearInfo(sel.year);
  const t = totals(data);
  const isEmpty = t.count === 0 && !data?._meta;

  return (
    <div className="space-y-4 pb-24">
      <div className="flex items-start gap-3 flex-wrap">
        <div className="flex-1 min-w-[220px]">
          <h1 className="text-2xl font-bold text-primary-800 flex items-center gap-2"><Landmark size={22} /> Assets &amp; Liabilities</h1>
          <p className="text-sm text-gray-500">Y/A {sel.year} · values as at {y.asAt} · වත්කම් හා බැරකම් ප්‍රකාශය</p>
        </div>
        {list.length > 1 && (
          <div className="flex gap-1 bg-gray-100 p-1 rounded-xl max-w-full overflow-x-auto">
            {list.map(s => (
              <button key={s.id} onClick={() => { if (dirty && !window.confirm('You have unsaved changes. Switch year anyway?')) return; pick(s); setParams({ year: s.year }); }}
                className={`px-3 py-1.5 rounded-lg text-xs font-semibold whitespace-nowrap ${sel.id === s.id ? 'bg-white text-primary-700 shadow-sm' : 'text-gray-500'}`}>
                Y/A {s.year}{s.status === 'open' ? ' •' : ''}
              </button>
            ))}
          </div>
        )}
      </div>

      {/* Status */}
      {sel.status === 'open' && sel.admin_note && (
        <div className="rounded-xl border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900 flex gap-2">
          <AlertTriangle size={16} className="flex-shrink-0 mt-0.5" />
          <div><b>TaxMate asked for a change:</b> {sel.admin_note}<div className="text-xs mt-0.5">Please update the form and submit it again.</div></div>
        </div>
      )}
      {sel.status === 'submitted' && (
        <div className="rounded-xl border border-blue-200 bg-blue-50 p-3 text-sm text-blue-900 flex gap-2 items-center flex-wrap">
          <Clock size={16} /> <span className="flex-1">Submitted on {fmtDate(sel.submitted_at)}. TaxMate is reviewing it. Need to change something? Message us on WhatsApp and we'll reopen it.</span>
        </div>
      )}
      {sel.status === 'reviewed' && (
        <div className="rounded-xl border border-green-200 bg-green-50 p-3 text-sm text-green-900 flex gap-2 items-center">
          <CheckCircle2 size={16} /> Reviewed by TaxMate on {fmtDate(sel.reviewed_at)}. Thank you!
        </div>
      )}

      {/* Your details */}
      <div className="card p-4">
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 text-sm">
          {[['Name', client?.full_name], ['TIN', client?.tin], ['NIC', client?.nic], ['Mobile', client?.mobile]].map(([l, v]) => (
            <div key={l}><div className="text-[11px] uppercase tracking-wide text-gray-400 font-semibold">{l}</div><div className="font-semibold text-gray-800 truncate">{v || '—'}</div></div>
          ))}
        </div>
        <div className="text-xs text-gray-400 mt-2">Details wrong? <Link to="/client/profile" className="text-primary-600 hover:underline">Ask us to update your profile</Link>.</div>
      </div>

      {editable && (
        <div className="rounded-xl border border-gray-200 bg-white p-3 text-xs text-gray-600 space-y-1">
          <p>Enter everything you owned and owed on <b>{y.asAt}</b> (in or outside Sri Lanka), at cost or market value in rupees. Leave a section empty if it doesn't apply.</p>
          <p className="text-gray-400">{y.asAt} දිනට ඔබ සතු සියලු වත්කම් හා ණය පිරිවැය හෝ වෙළඳපොළ වටිනාකමින් ඇතුළත් කරන්න. අදාළ නොවන කොටස් හිස්ව තබන්න.</p>
          <p className="text-gray-400">These values are for disclosure to the IRD only — they are not used to calculate your tax.</p>
        </div>
      )}

      {editable && isEmpty && prevStatement && (
        <button onClick={copyLastYear} className="w-full card p-3 text-sm font-semibold text-primary-700 hover:bg-primary-50 flex items-center justify-center gap-2">
          <History size={15} /> Start from what I declared for Y/A {prevStatement.year}
        </button>
      )}

      <div className="grid lg:grid-cols-[1fr_300px] gap-4 items-start">
        <div className="space-y-3">
          <AssetStatementForm key={sel.id} data={data} onChange={change} year={sel.year} readOnly={!editable} errors={errors} />
          {(editable || note) && (
            <div className="card p-4">
              <label className="block text-sm font-semibold text-gray-700 mb-1">Anything else we should know? <span className="font-normal text-gray-400">(optional)</span></label>
              <textarea className="input min-h-[70px]" maxLength={2000} disabled={!editable} value={note}
                placeholder="e.g. The land in Kandy is jointly owned with my wife. I'll send the loan statement on WhatsApp."
                onChange={e => { setNote(e.target.value); setDirty(true); clearTimeout(timer.current); timer.current = setTimeout(() => save({ quiet: true }), 4000); }} />
            </div>
          )}
        </div>
        <div className="lg:sticky lg:top-6 space-y-3">
          <AssetSummary data={data} year={sel.year} />
          <button onClick={pdf} className="btn-secondary w-full justify-center text-sm"><Printer size={14} /> View / print PDF</button>
        </div>
      </div>

      {/* Sticky action bar */}
      {editable && (
        <div className="fixed bottom-0 left-0 right-0 md:left-56 lg:left-64 bg-white/95 backdrop-blur border-t border-gray-200 px-4 py-3 flex items-center gap-2 z-30">
          <div className="flex-1 text-xs text-gray-500 min-w-0 truncate">
            {saving ? <span className="flex items-center gap-1"><Loader2 size={12} className="animate-spin" /> Saving…</span>
              : dirty ? 'Unsaved changes' : savedAt ? `Saved at ${time(savedAt)}` : `Last saved ${fmtDate(sel.updated_at)}`}
          </div>
          <button onClick={() => save()} disabled={saving || !dirty} className="btn-secondary text-sm"><Save size={14} /> <span className="hidden sm:inline">Save draft</span><span className="sm:hidden">Save</span></button>
          <button onClick={startSubmit} disabled={saving} className="btn-primary text-sm"><Send size={14} /> Submit to TaxMate</button>
        </div>
      )}

      {/* Declaration */}
      {confirm && (
        <div className="fixed inset-0 bg-black/40 z-50 flex items-end sm:items-center justify-center p-0 sm:p-4" onClick={() => setConfirm(false)}>
          <div className="bg-white w-full sm:max-w-md rounded-t-2xl sm:rounded-2xl p-5 space-y-4" onClick={e => e.stopPropagation()}>
            <div className="flex items-center gap-2"><Send size={18} className="text-primary-600" /><h3 className="font-bold text-primary-800 flex-1">Submit Y/A {sel.year}</h3>
              <button onClick={() => setConfirm(false)} className="text-gray-400"><X size={18} /></button></div>
            <div className="text-sm bg-gray-50 rounded-lg p-3 space-y-1">
              <div className="flex justify-between"><span>Total assets</span><b>Rs. {t.assets.toLocaleString('en-LK')}</b></div>
              <div className="flex justify-between"><span>Total liabilities</span><b>Rs. {t.liabilities_total.toLocaleString('en-LK')}</b></div>
              <div className="flex justify-between text-primary-800"><span>Net worth</span><b>Rs. {t.net.toLocaleString('en-LK')}</b></div>
              {t.count === 0 && <div className="text-amber-700 text-xs pt-1">You have not entered any assets or liabilities. Submit only if you have nothing to declare.</div>}
              {(data?.[SECTION.vehicles.key] ?? []).length > 0 && <div className="text-xs text-gray-500 pt-1">{data.vehicles.length} vehicle(s) with year of manufacture.</div>}
            </div>
            <label className="flex gap-2 text-sm text-gray-700 cursor-pointer">
              <input type="checkbox" className="mt-1" checked={declared} onChange={e => setDeclared(e.target.checked)} />
              <span>I confirm that this information is true and complete to the best of my knowledge.
                <span className="block text-xs text-gray-400 mt-0.5">මෙම තොරතුරු මා දන්නා තරමින් සත්‍ය හා සම්පූර්ණ බව තහවුරු කරමි.</span></span>
            </label>
            <p className="text-xs text-gray-400">After you submit you can't edit it. If something changes, message TaxMate and we'll reopen it.</p>
            <button onClick={doSubmit} disabled={!declared || saving} className="btn-primary w-full justify-center">
              {saving ? <><Loader2 size={15} className="animate-spin" /> Submitting…</> : 'Submit to TaxMate'}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
