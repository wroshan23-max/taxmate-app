import { useEffect, useMemo, useState } from 'react';
import toast from 'react-hot-toast';
import { TrendingDown, Plus, Printer, Loader2, X, Check, Ban, Receipt, Eye, Trash2, Crown } from 'lucide-react';
import { supabase, fmtRs, fmtDate } from '../lib/supabase';
import { REVIEW_STATUS, prevYearOf, buildReviewData, defaultRecommendations, yearSummary, personalInput, nextYearOf, issueReview, openReview, adminReviewData } from '../lib/taxReview';
import { taxSavingTips } from '../lib/taxTips';
import { loadPlans } from '../lib/plans';
import { docYears } from '../lib/documents';

const isReturnCalc = (c) => c.calc_type !== 'quarterly';

/** Admin: Annual Tax Review reports for one client (paid upsell; fee set when issuing). */
export default function TaxReviewsAdmin({ client, calculations, userId }) {
  const [rows, setRows] = useState([]);
  const [issuing, setIssuing] = useState(null);
  const [f, setF] = useState({});
  const [recs, setRecs] = useState([]);
  const [busy, setBusy] = useState(false);
  const [freePlan, setFreePlan] = useState(null);     // client's plan includes a free review

  const load = () => supabase.from('tax_reviews').select('*, invoices(invoice_no, status)').eq('client_id', client.id).order('created_at', { ascending: false })
    .then(({ data }) => setRows(data ?? []));
  useEffect(() => {
    load();
    Promise.all([loadPlans(), supabase.from('subscriptions').select('plan_key, plan_name').eq('client_id', client.id).eq('status', 'active').maybeSingle()])
      .then(([plans, { data: sub }]) => setFreePlan(sub && plans.find(p => p.key === sub.plan_key)?.includes_review ? sub.plan_name : null));
  }, [client.id]); // eslint-disable-line react-hooks/exhaustive-deps

  const calcsFor = (year) => calculations.filter(c => c.year === year && isReturnCalc(c))
    .sort((a, b) => (b.status === 'final') - (a.status === 'final') || new Date(b.created_at) - new Date(a.created_at));
  const calc = calculations.find(c => c.id === f.calcId);
  const prevCalc = calculations.find(c => c.id === f.prevId) ?? null;

  const defaultsFor = (cId, pId) => {
    const c = calculations.find(x => x.id === cId); if (!c) return [];
    const p = calculations.find(x => x.id === pId) ?? null;
    const cur = yearSummary(c); const prev = p ? yearSummary(p) : null;
    return defaultRecommendations(cur, prev, c, taxSavingTips(nextYearOf(c.year), personalInput(c)));
  };
  const startIssue = (r) => {
    const cId = calcsFor(r.year)[0]?.id ?? '';
    const pId = calcsFor(prevYearOf(r.year))[0]?.id ?? '';
    setF({ year: r.year, calcId: cId, prevId: pId, fee: freePlan ? '0' : (r.fee ? String(r.fee) : '') });
    setRecs(defaultsFor(cId, pId));
    setIssuing(r);
  };
  const newReview = () => startIssue({ id: null, year: docYears().find(y => calcsFor(y).length) ?? docYears()[1], fee: 0 });

  const preview = () => {
    if (!calc) return toast.error('Choose the computation');
    openReview({ ...buildReviewData({ calc, prevCalc, client, recommendations: recs }), issued_at: new Date().toISOString() });
  };
  const issue = async () => {
    if (!calc) return toast.error('Choose the computation for this year');
    if (f.fee === '' || f.fee === undefined) return toast.error('Enter the fee (0 = free)');
    if (calc.status !== 'final' && !window.confirm('This computation is still a DRAFT. Issue the review anyway?')) return;
    setBusy(true);
    try {
      let review = issuing;
      if (!review.id || review.year !== f.year) {
        const patch = { client_id: client.id, year: f.year };
        const { data, error } = review.id
          ? await supabase.from('tax_reviews').update(patch).eq('id', review.id).select().single()
          : await supabase.from('tax_reviews').insert({ ...patch, requested_by: userId }).select().single();
        if (error) throw error;
        review = data;
      }
      await issueReview({ review, calc, prevCalc, client, fee: f.fee, recommendations: recs, userId });
      toast.success(Number(f.fee) > 0 ? 'Review issued — fee invoice created; the client downloads it after paying' : 'Review issued — the client can download it now');
      setIssuing(null); load();
    } catch (e) { toast.error(e.message); }
    setBusy(false);
  };
  const reject = async (r) => {
    const { error } = await supabase.from('tax_reviews').update({ status: 'rejected' }).eq('id', r.id);
    if (error) return toast.error(error.message);
    load();
  };
  const view = async (r) => { const w = window.open('', '_blank', 'width=900,height=1000'); try { if (!openReview(await adminReviewData(r.id), w)) toast.error('Pop-up blocked'); } catch (e) { if (w) w.close(); toast.error(e.message); } };
  const yearsWithCalcs = useMemo(() => docYears().filter(y => calcsFor(y).length), [calculations]); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <div className="card">
      <div className="card-header"><TrendingDown size={16} /> Annual Tax Review reports
        <span className="text-xs font-normal text-gray-400">this year vs last · how to save next year</span>
        <button onClick={newReview} className="ml-auto btn-primary text-xs py-1"><Plus size={13} /> New review</button>
      </div>
      {freePlan && <div className="px-5 py-2 text-xs bg-amber-50 text-amber-800 flex items-center gap-1.5 border-b border-amber-100"><Crown size={13} /> {freePlan} plan — the review is included (fee 0).</div>}
      {rows.length === 0 && !issuing ? <div className="p-6 text-center text-sm text-gray-400">No reviews yet. Clients can request one from their portal, or start one here.</div> : (
        <div className="divide-y divide-gray-50">
          {rows.map(r => (
            <div key={r.id} className="px-5 py-3 flex items-center gap-3 flex-wrap">
              <div className="text-2xl">📈</div>
              <div className="flex-1 min-w-[200px]">
                <div className="text-sm font-semibold text-gray-800">Annual Tax Review · Y/A {r.year}</div>
                <div className="text-[11px] text-gray-500">{r.status === 'issued' ? `Issued ${fmtDate(r.issued_at)}` : `Requested ${fmtDate(r.created_at)}`}{r.client_note ? ` · “${r.client_note}”` : ''}</div>
                {r.invoices && <div className="text-[11px] mt-0.5 flex items-center gap-1"><Receipt size={11} /> Fee {fmtRs(r.fee)} · {r.invoices.invoice_no} · <b className={r.invoices.status === 'paid' ? 'text-emerald-700' : 'text-amber-700'}>{r.invoices.status === 'paid' ? 'paid' : 'unpaid — client downloads after paying'}</b></div>}
              </div>
              <span className={`text-[11px] font-semibold px-2 py-0.5 rounded-md ${REVIEW_STATUS[r.status]?.cls}`}>{REVIEW_STATUS[r.status]?.label}</span>
              {r.status === 'requested' && <>
                <button onClick={() => startIssue(r)} className="btn-primary text-xs py-1"><Check size={13} /> Prepare</button>
                <button onClick={() => reject(r)} className="btn-secondary text-xs py-1" title="Not issued"><Ban size={13} /></button>
              </>}
              {r.status === 'issued' && <button onClick={() => view(r)} className="btn-secondary text-xs py-1"><Printer size={13} /> PDF</button>}
            </div>
          ))}
        </div>
      )}

      {issuing && (
        <div className="m-4 rounded-2xl border border-primary-200 bg-primary-50/40 p-4 space-y-3">
          <div className="flex items-center gap-2"><div className="font-bold text-primary-800 text-sm flex-1">{issuing.id ? 'Prepare requested review' : 'New Annual Tax Review'}</div><button onClick={() => setIssuing(null)} className="p-1 rounded hover:bg-white"><X size={15} /></button></div>
          <div className="grid sm:grid-cols-2 gap-3">
            <label className="text-xs font-semibold text-gray-600">Year of assessment
              <select className="input mt-1" value={f.year} onChange={e => { const y = e.target.value; const cId = calcsFor(y)[0]?.id ?? ''; const pId = calcsFor(prevYearOf(y))[0]?.id ?? ''; setF({ ...f, year: y, calcId: cId, prevId: pId }); setRecs(defaultsFor(cId, pId)); }}>
                {(yearsWithCalcs.length ? yearsWithCalcs : docYears()).map(y => <option key={y} value={y}>Y/A {y}</option>)}
              </select>
            </label>
            <label className="text-xs font-semibold text-gray-600">Fee (Rs.) — 0 = free
              <input className="input mt-1 text-right" inputMode="decimal" placeholder="e.g. 2500" value={f.fee ?? ''} onChange={e => setF({ ...f, fee: e.target.value.replace(/[^\d.]/g, '') })} />
            </label>
            <label className="text-xs font-semibold text-gray-600">This year's computation
              <select className="input mt-1" value={f.calcId} onChange={e => { setF({ ...f, calcId: e.target.value }); setRecs(defaultsFor(e.target.value, f.prevId)); }}>
                {calcsFor(f.year).length === 0 && <option value="">No computation for Y/A {f.year}</option>}
                {calcsFor(f.year).map(c => <option key={c.id} value={c.id}>{c.status === 'final' ? '✅ FINAL' : '📝 DRAFT'} · {c.label || 'IIT computation'} · {fmtDate(c.created_at)}</option>)}
              </select>
            </label>
            <label className="text-xs font-semibold text-gray-600">Compare with (Y/A {prevYearOf(f.year)})
              <select className="input mt-1" value={f.prevId} onChange={e => { setF({ ...f, prevId: e.target.value }); setRecs(defaultsFor(f.calcId, e.target.value)); }}>
                <option value="">No comparison</option>
                {calcsFor(prevYearOf(f.year)).map(c => <option key={c.id} value={c.id}>{c.status === 'final' ? '✅ FINAL' : '📝 DRAFT'} · {c.label || 'IIT computation'} · {fmtDate(c.created_at)}</option>)}
              </select>
            </label>
          </div>
          <div>
            <div className="text-xs font-semibold text-gray-600 mb-1">Recommendations (edit freely — printed in the report)</div>
            <div className="space-y-2">
              {recs.map((r, i) => (
                <div key={i} className="flex gap-2 items-start">
                  <div className="flex-1 space-y-1">
                    <input className="input py-1 text-xs font-semibold" value={r.title} maxLength={80} onChange={e => setRecs(recs.map((x, j) => j === i ? { ...x, title: e.target.value } : x))} placeholder="Title" />
                    <textarea className="input py-1 text-xs resize-none" rows={2} maxLength={500} value={r.body} onChange={e => setRecs(recs.map((x, j) => j === i ? { ...x, body: e.target.value } : x))} placeholder="Advice" />
                  </div>
                  <button onClick={() => setRecs(recs.filter((_, j) => j !== i))} className="p-1 text-gray-400 hover:text-red-600 mt-1"><Trash2 size={14} /></button>
                </div>
              ))}
              {recs.length < 10 && <button onClick={() => setRecs([...recs, { title: '', body: '' }])} className="text-xs font-semibold text-primary-700 hover:underline inline-flex items-center gap-1"><Plus size={12} /> Add recommendation</button>}
            </div>
          </div>
          <div className="flex gap-2">
            <button onClick={preview} disabled={!f.calcId} className="btn-secondary flex-1 justify-center text-sm"><Eye size={15} /> Preview</button>
            <button onClick={issue} disabled={busy || !f.calcId} className="btn-primary flex-1 justify-center text-sm">{busy ? <Loader2 size={15} className="animate-spin" /> : <TrendingDown size={15} />} Issue review</button>
          </div>
          <p className="text-[11px] text-gray-500">{Number(f.fee) > 0 ? 'An unpaid invoice is created; the client downloads the PDF after paying (online or bank slip).' : 'The client can download the PDF straight away.'}</p>
        </div>
      )}
    </div>
  );
}
