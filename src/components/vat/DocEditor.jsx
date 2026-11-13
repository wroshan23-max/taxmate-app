// V64 — create / edit a draft: Tax Invoice, Non-Tax Invoice, Credit Note, Debit Note
// Steps: type & dates → customer → items → VAT → terms → preview → validation → issue → RAMIS → status
import { useEffect, useMemo, useState } from 'react';
import toast from 'react-hot-toast';
import { Plus, Trash2, Loader2, CheckCircle2, XCircle, AlertTriangle, Eye, Send, Save, ChevronLeft, ChevronRight, UserPlus, Landmark, FileText } from 'lucide-react';
import { saveDraft, loadDoc, loadLines, issueDoc, validateDoc, docJson, saveCustomer, submitRamis, previewNo } from '../../lib/vat/api';
import { calcDoc } from '../../lib/vat/calc';
import { rs, money, dmy, slToday, addDays, TERMS, TEMPLATES, METHODS, CREDIT_REASONS, DEBIT_REASONS, DOC_TYPES } from '../../lib/vat/format';
import { buildDocHtml, openPrintWindow, writePrint } from '../../lib/vat/printDoc';
import { t } from '../../lib/vat/i18n';
import { Field, Modal, Spinner, Badge } from './ui';

const STEPS = ['Details', 'Customer', 'Items', 'Terms', 'Review & issue'];
const blankLine = (rate = 'VAT_STD') => ({ key: crypto.randomUUID(), description: '', quantity: 1, unit: 'Nos', unit_price: '', disc_pct: '', disc_amt: '', rate_code: rate, supply_kind: 'goods', item_id: null, original_line_id: null });

export default function DocEditor({ app, type: initialType, originalId, draftId }) {
  const { clientId, data, reload, go, openDoc, can } = app;
  const st = data.settings || {};
  const [loading, setLoading] = useState(!!(draftId || originalId));
  const [step, setStep] = useState(0);
  const [id, setId] = useState(draftId || null);
  const [type, setType] = useState(initialType || 'tax');
  const [orig, setOrig] = useState(null);
  const [origLines, setOrigLines] = useState([]);
  const [doc, setDoc] = useState({
    issue_date: slToday(), supply_date: slToday(), branch_id: data.branches.find((b) => b.is_default && b.active)?.id || '',
    customer_id: '', customer: { name: '', tin: '', vat_registered: false, address: '', phone: '', email: '' },
    price_mode: st.price_mode || 'exclusive', disc_pct: '', disc_amt: '', terms_days: st.default_terms_days ?? 30, due_date: '', customDue: false,
    place_of_supply: '', payment_mode: '', notes: '', terms: '', template_key: '', reason_code: '', reason: '',
  });
  const [lines, setLines] = useState([blankLine(st.default_rate_code || 'VAT_STD')]);
  const [busy, setBusy] = useState(false);
  const [check, setCheck] = useState(null);
  const [result, setResult] = useState(null);
  const [nextNo, setNextNo] = useState('');
  const [addCust, setAddCust] = useState(false);
  const isNote = type === 'credit' || type === 'debit';
  const isTax = isNote ? !!orig?.is_tax : type === 'tax';

  // load a draft, or the original invoice of a new note
  useEffect(() => {
    (async () => {
      try {
        let oid = originalId;
        if (draftId) {
          const d = await loadDoc(draftId);
          if (!d || d.status !== 'draft') { toast.error('This document is issued — it cannot be edited.'); openDoc(draftId); return; }
          const ls = await loadLines(draftId);
          setType(d.doc_type); oid = d.original_id;
          setDoc((x) => ({ ...x, ...Object.fromEntries(Object.entries(d).filter(([k]) => k in x).map(([k, v]) => [k, v ?? ''])), customer: d.customer || x.customer,
            customDue: !!d.due_date && d.terms_days != null && d.due_date !== addDays(d.issue_date, d.terms_days) }));
          setLines(ls.map((l) => ({ ...l, key: l.id, rate_code: l.rate_code === 'NONE' ? (st.default_rate_code || 'VAT_STD') : l.rate_code })));
          setStep(2);
        }
        if (oid) {
          const o = await loadDoc(oid);
          setOrig(o); setOrigLines(await loadLines(oid));
          if (!draftId) {
            setDoc((x) => ({ ...x, customer_id: o.customer_id || '', customer: o.customer, branch_id: o.branch_id || '', price_mode: o.price_mode, supply_date: '' }));
            setLines([]);
          }
        }
      } catch (e) { toast.error(e.message); }
      setLoading(false);
    })();
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const branchCode = data.branches.find((b) => b.id === doc.branch_id)?.code || 'MAIN';
  useEffect(() => { previewNo(clientId, type, branchCode, doc.issue_date).then(setNextNo).catch(() => setNextNo('')); }, [clientId, type, branchCode, doc.issue_date]);

  const calc = useMemo(() => calcDoc({ is_tax: isTax, price_mode: doc.price_mode, disc_pct: doc.disc_pct, disc_amt: doc.disc_amt, supply_date: doc.supply_date, issue_date: doc.issue_date },
    lines, data.rates), [isTax, doc.price_mode, doc.disc_pct, doc.disc_amt, doc.supply_date, doc.issue_date, lines, data.rates]);
  const codes = useMemo(() => [...new Set(data.rates.map((r) => r.code))], [data.rates]);
  const set = (patch) => setDoc((d) => ({ ...d, ...patch }));
  const setLine = (key, patch) => setLines((ls) => ls.map((l) => (l.key === key ? { ...l, ...patch } : l)));
  const cust = data.customers.find((c) => c.id === doc.customer_id);
  const due = doc.customDue ? doc.due_date : addDays(doc.issue_date, doc.terms_days || 0);
  const roomToCredit = orig ? Number(orig.total) + Number(orig.debited) - Number(orig.credited) : 0;

  const payload = () => ({
    id, doc_type: type, original_id: orig?.id || null, branch_id: doc.branch_id || null, issue_date: doc.issue_date, supply_date: doc.supply_date || null,
    terms_days: isNote ? null : Number(doc.terms_days || 0), due_date: isNote ? null : due, place_of_supply: doc.place_of_supply, payment_mode: doc.payment_mode,
    customer_id: doc.customer_id || null, customer: doc.customer_id ? null : doc.customer, price_mode: doc.price_mode, disc_pct: doc.disc_pct || 0, disc_amt: doc.disc_amt || 0,
    notes: doc.notes, terms: doc.terms, template_key: doc.template_key || null, reason_code: doc.reason_code || null, reason: doc.reason,
  });
  const linePayload = () => lines.map((l) => ({
    description: l.description, quantity: Number(l.quantity), unit: l.unit, unit_price: Number(l.unit_price || 0), disc_pct: Number(l.disc_pct || 0), disc_amt: Number(l.disc_amt || 0),
    rate_code: l.rate_code, supply_kind: l.supply_kind, item_id: l.item_id, original_line_id: l.original_line_id,
  }));

  const save = async (quiet) => {
    if (!lines.length) { toast.error('Add at least one line.'); return null; }
    setBusy(true);
    try {
      const nid = await saveDraft(clientId, payload(), linePayload());
      setId(nid);
      if (!quiet) toast.success('Draft saved');
      reload(['docs']);
      return nid;
    } catch (e) { toast.error(e.message, { duration: 6000 }); return null; } finally { setBusy(false); }
  };
  const runCheck = async () => {
    const nid = await save(true);
    if (!nid) return;
    try { setCheck(await validateDoc(nid, false)); } catch (e) { toast.error(e.message); }
  };
  const preview = async () => {
    const w = openPrintWindow();
    const nid = await save(true);
    if (!nid) { w?.close(); return; }
    try { writePrint(w, buildDocHtml(await docJson(nid), { toolbar: true, draftPreview: true })); } catch (e) { w?.close(); toast.error(e.message); }
  };
  const issue = async () => {
    const nid = await save(true);
    if (!nid) return;
    const v = await validateDoc(nid, false).catch(() => null);
    if (v) setCheck(v);
    if (v && !v.ok) { toast.error('Fix the items marked ✗ first.'); return; }
    const label = isTax ? 'Issue this document? After issue it cannot be edited or deleted — only corrected with a Credit / Debit Note.' : 'Issue this invoice? After issue it cannot be edited.';
    if (!window.confirm(label)) return;
    setBusy(true);
    try {
      const r = await issueDoc(nid);
      const fresh = await loadDoc(r.id).catch(() => null);
      setResult({ ...r, ramis_status: fresh?.ramis_status, ramis_message: fresh?.ramis_message });
      toast.success(`${r.doc_no} issued`);
      reload(['docs', 'customers']);
    } catch (e) { toast.error(e.message, { duration: 8000 }); } finally { setBusy(false); }
  };
  const sendRamis = async () => {
    setBusy(true);
    try {
      const r = await submitRamis(result.id);
      toast.success(r.status === 'pending_config' ? 'Queued — RAMIS integration pending configuration' : 'Queued for RAMIS');
      setResult((x) => ({ ...x, ramis: r }));
      reload(['docs']);
    } catch (e) { toast.error(e.message, { duration: 8000 }); } finally { setBusy(false); }
  };

  if (loading) return <Spinner />;
  if (isNote && !orig) return <div className="card p-6 text-sm text-gray-600">Open the original invoice and choose <b>Credit note</b> or <b>Debit note</b>.</div>;

  if (result) {
    const ramisOn = isTax && result.ramis_status === 'ready';
    const autoQueued = isTax && !result.ramis && ['queued', 'submitting'].includes(result.ramis_status);
    return (
      <div className="card space-y-3 p-6 text-center">
        <CheckCircle2 size={44} className="mx-auto text-green-600" />
        <div className="text-lg font-bold text-gray-800">{DOC_TYPES[type].short} <span className="font-mono">{result.doc_no}</span> issued</div>
        {result.warnings?.length > 0 && <div className="mx-auto max-w-md rounded-lg bg-amber-50 p-2 text-left text-xs text-amber-900">{result.warnings.map((w) => <div key={w.key}>⚠ {w.label}: {w.msg}</div>)}</div>}
        {isTax && (
          <div className="mx-auto max-w-md rounded-lg border p-3 text-left text-sm">
            <div className="flex items-center gap-1.5 font-semibold"><Landmark size={15} /> RAMIS</div>
            {autoQueued ? <div className="mt-1 text-xs">{result.ramis_message || 'Queued for RAMIS automatically.'}</div> : result.ramis ? (
              <div className="mt-1 text-xs">{result.ramis.status === 'pending_config'
                ? <>Queued as <b>{t('ramis.pending')}</b>. It is <b>not yet sent to IRD</b>; it goes automatically when TaxMate connects the IRD Web API.</>
                : <>Queued for RAMIS ({result.ramis.submission_no}). The status updates on the invoice.</>}</div>
            ) : ramisOn && can('submit_ramis') ? (
              <button type="button" disabled={busy} onClick={sendRamis} className="btn-primary mt-2 px-3 py-1.5 text-sm">{busy ? <Loader2 size={14} className="animate-spin" /> : <Send size={14} />} {t('act.submit_ramis')}</button>
            ) : <div className="mt-1 text-xs text-gray-500">RAMIS submission is off for this business (Settings → RAMIS integration). Remember to report this invoice to IRD.</div>}
          </div>
        )}
        <div className="flex flex-wrap justify-center gap-2">
          <button type="button" className="btn-primary text-sm" onClick={() => openDoc(result.id)}><FileText size={15} /> Open document</button>
          {!isNote && <button type="button" className="btn-secondary border text-sm" onClick={() => go('new', { type })}><Plus size={15} /> Another</button>}
        </div>
      </div>
    );
  }

  const pickCustomer = (cid) => {
    const c = data.customers.find((x) => x.id === cid);
    set({ customer_id: cid, ...(c && c.terms_days != null && !doc.customDue ? { terms_days: c.terms_days } : {}) });
  };
  const addFromItem = (key, itemId) => {
    const it = data.items.find((i) => i.id === itemId);
    if (!it) return setLine(key, { item_id: null });
    setLine(key, { item_id: it.id, description: it.description ? `${it.name} — ${it.description}` : it.name, unit: it.unit, unit_price: it.price, rate_code: it.rate_code === 'NONE' ? 'VAT_STD' : it.rate_code, supply_kind: it.supply_kind });
  };
  const toggleOrigLine = (ol, on) => {
    if (!on) return setLines((ls) => ls.filter((l) => l.original_line_id !== ol.id));
    setLines((ls) => [...ls, { ...blankLine(ol.rate_code === 'NONE' ? 'VAT_STD' : ol.rate_code), original_line_id: ol.id, description: `${ol.description}${type === 'credit' ? ' — returned / adjusted' : ' — adjustment'}`,
      quantity: type === 'credit' ? ol.quantity : 1, unit: ol.unit, unit_price: type === 'credit' ? ol.unit_price : '', supply_kind: ol.supply_kind }]);
  };

  const nav = () => (
    <div className="flex flex-wrap items-center gap-2 border-t pt-3">
      {step > 0 && <button type="button" className="btn-secondary border px-3 py-1.5 text-sm" onClick={() => setStep(step - 1)}><ChevronLeft size={15} /> Back</button>}
      <span className="flex-1" />
      <button type="button" disabled={busy} className="btn-secondary border px-3 py-1.5 text-sm" onClick={() => save(false)}>{busy ? <Loader2 size={14} className="animate-spin" /> : <Save size={14} />} {t('act.save_draft')}</button>
      {step < STEPS.length - 1 && <button type="button" className="btn-primary px-3 py-1.5 text-sm" onClick={() => { setStep(step + 1); if (step + 1 === STEPS.length - 1) runCheck(); }}>Next <ChevronRight size={15} /></button>}
    </div>
  );

  return (
    <div className="space-y-3">
      <div className="card p-3">
        <div className="flex flex-wrap items-center gap-2">
          <div className="text-base font-bold text-primary-800">{id ? 'Edit draft' : 'New'} {isNote ? `${isTax ? 'tax ' : ''}${type} note` : DOC_TYPES[type].label()}</div>
          {nextNo && <Badge>Number at issue: <span className="font-mono">{nextNo}</span></Badge>}
          {isNote && orig && <Badge>Against <span className="font-mono">{orig.doc_no}</span> · {rs(orig.total)}</Badge>}
        </div>
        <ol className="mt-2 flex flex-wrap gap-1 text-[11px]">
          {STEPS.map((s, i) => (
            <li key={s}><button type="button" onClick={() => { setStep(i); if (i === STEPS.length - 1) runCheck(); }}
              className={`rounded-full px-2.5 py-1 font-semibold ${i === step ? 'bg-primary-700 text-white' : i < step ? 'bg-primary-50 text-primary-700' : 'bg-gray-100 text-gray-500'}`}>{i + 1}. {s}</button></li>
          ))}
        </ol>
      </div>

      {step === 0 && (
        <div className="card space-y-3 p-4">
          {!isNote && (
            <div className="grid gap-2 sm:grid-cols-2">
              {['tax', 'nontax'].map((k) => (
                <button key={k} type="button" disabled={!!id && k !== type} onClick={() => setType(k)}
                  className={`rounded-xl border-2 p-3 text-left ${type === k ? 'border-primary-600 bg-primary-50' : 'border-gray-200'} disabled:opacity-40`}>
                  <div className="font-bold text-gray-800">{DOC_TYPES[k].label()}</div>
                  <div className="text-xs text-gray-500">{k === 'tax' ? 'IRD format with VAT. Goes to Schedule 01/07 and to RAMIS when switched on.' : 'Normal invoice without VAT. Never sent to RAMIS, never in VAT schedules.'}</div>
                  {k === 'tax' && !st.vat_registered && <div className="mt-1 text-[11px] font-semibold text-red-600">Only for VAT-registered businesses (Settings → Company &amp; VAT).</div>}
                </button>
              ))}
            </div>
          )}
          {isNote && (
            <div className="grid gap-2 sm:grid-cols-2">
              <Field label="Reason">
                <select className="input" value={doc.reason_code} onChange={(e) => set({ reason_code: e.target.value })}>
                  <option value="">Choose…</option>{Object.entries(type === 'credit' ? CREDIT_REASONS : DEBIT_REASONS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
                </select>
              </Field>
              <Field label="Details of the reason"><input className="input" maxLength={500} value={doc.reason} onChange={(e) => set({ reason: e.target.value })} placeholder="e.g. 2 units returned on GRN 551" /></Field>
            </div>
          )}
          <div className="grid gap-2 sm:grid-cols-3">
            <Field label={isNote ? 'Note date' : 'Invoice date'}><input type="date" className="input" value={doc.issue_date} max={slToday()} onChange={(e) => set({ issue_date: e.target.value })} /></Field>
            {(type === 'tax' || !isNote) && <Field label={type === 'tax' ? 'Date of supply (required)' : 'Date of supply'} hint="IRD needs both dates on a tax invoice."><input type="date" className="input" value={doc.supply_date || ''} onChange={(e) => set({ supply_date: e.target.value })} /></Field>}
            {data.branches.filter((b) => b.active).length > 0 && (
              <Field label="Branch / invoice code (QQQQ)" hint="Part of the invoice number.">
                <select className="input" value={doc.branch_id || ''} onChange={(e) => set({ branch_id: e.target.value })}><option value="">MAIN</option>{data.branches.filter((b) => b.active).map((b) => <option key={b.id} value={b.id}>{b.code} — {b.name}</option>)}</select>
              </Field>
            )}
          </div>
          {isNote && orig && <div className="rounded-lg bg-gray-50 p-2 text-xs text-gray-600">Original <b className="font-mono">{orig.doc_no}</b> of {dmy(orig.issue_date)} · total {rs(orig.total)} · already credited {rs(orig.credited)} · debited {rs(orig.debited)}{type === 'credit' && <> · <b>you can credit up to {rs(roomToCredit)}</b></>}</div>}
          {nav()}
        </div>
      )}

      {step === 1 && (
        <div className="card space-y-3 p-4">
          {isNote ? <div className="text-sm text-gray-600">Customer of the original invoice: <b>{orig?.customer?.name}</b>{orig?.customer?.tin && <> · TIN {orig.customer.tin}</>}</div> : (
            <>
              <div className="flex flex-wrap items-end gap-2">
                <Field label="Customer" className="min-w-[240px] flex-1">
                  <select className="input" value={doc.customer_id} onChange={(e) => pickCustomer(e.target.value)}>
                    <option value="">— One-off customer (type below) —</option>
                    {data.customers.filter((c) => c.status === 'active' || c.id === doc.customer_id).map((c) => <option key={c.id} value={c.id}>{c.name}{c.tin ? ` · TIN ${c.tin}` : ''}{c.vat_registered ? ' · VAT' : ''}</option>)}
                  </select>
                </Field>
                {can('customers') && <button type="button" className="btn-secondary border px-3 py-2 text-sm" onClick={() => setAddCust(true)}><UserPlus size={15} /> New customer</button>}
              </div>
              {cust ? (
                <div className="rounded-lg bg-gray-50 p-3 text-sm">
                  <div className="font-semibold">{cust.name}</div>
                  <div className="text-xs text-gray-600">{cust.address || <span className="text-red-600">No address</span>} · {cust.tin ? `TIN ${cust.tin}` : 'No TIN'} {cust.vat_registered ? '· VAT-registered' : '· not VAT-registered'}</div>
                  {type === 'tax' && cust.vat_registered && (!cust.tin || !cust.address) && <div className="mt-1 text-xs font-semibold text-red-600">A VAT-registered purchaser needs TIN and address on the tax invoice — edit the customer.</div>}
                </div>
              ) : (
                <div className="grid gap-2 sm:grid-cols-2">
                  <Field label="Name"><input className="input" value={doc.customer.name} onChange={(e) => set({ customer: { ...doc.customer, name: e.target.value } })} /></Field>
                  <Field label="TIN (9 digits)"><input className="input" inputMode="numeric" maxLength={9} value={doc.customer.tin || ''} onChange={(e) => set({ customer: { ...doc.customer, tin: e.target.value.replace(/\D/g, '') } })} /></Field>
                  <Field label="Address" className="sm:col-span-2"><input className="input" value={doc.customer.address || ''} onChange={(e) => set({ customer: { ...doc.customer, address: e.target.value } })} /></Field>
                  <Field label="Telephone"><input className="input" value={doc.customer.phone || ''} onChange={(e) => set({ customer: { ...doc.customer, phone: e.target.value } })} /></Field>
                  <Field label="Email"><input className="input" type="email" value={doc.customer.email || ''} onChange={(e) => set({ customer: { ...doc.customer, email: e.target.value } })} /></Field>
                  {type === 'tax' && <label className="flex items-center gap-2 text-sm sm:col-span-2"><input type="checkbox" checked={!!doc.customer.vat_registered} onChange={(e) => set({ customer: { ...doc.customer, vat_registered: e.target.checked } })} /> Purchaser is VAT-registered (TIN and address then required)</label>}
                </div>
              )}
            </>
          )}
          {nav()}
        </div>
      )}

      {step === 2 && (
        <div className="card space-y-3 p-4">
          {isNote && origLines.length > 0 && (
            <div className="rounded-lg border p-2">
              <div className="mb-1 text-xs font-semibold text-gray-600">Lines of the original invoice — tick to {type === 'credit' ? 'credit' : 'adjust'}</div>
              {origLines.map((ol) => (
                <label key={ol.id} className="flex items-center gap-2 py-0.5 text-xs">
                  <input type="checkbox" checked={lines.some((l) => l.original_line_id === ol.id)} onChange={(e) => toggleOrigLine(ol, e.target.checked)} />
                  <span className="flex-1 truncate">{ol.description}</span><span className="tabular-nums text-gray-500">{Number(ol.quantity)} {ol.unit} × {money(ol.unit_price)} = {money(ol.total)}</span>
                </label>
              ))}
            </div>
          )}
          {isTax && !isNote && (
            <div className="flex flex-wrap items-center gap-3 text-sm">
              <span className="text-gray-600">Prices are</span>
              {[['exclusive', 'excluding VAT'], ['inclusive', 'including VAT']].map(([k, l]) => <label key={k} className="flex items-center gap-1"><input type="radio" checked={doc.price_mode === k} onChange={() => set({ price_mode: k })} /> {l}</label>)}
            </div>
          )}
          <div className="space-y-2">
            {lines.map((l, i) => {
              const c = calc.lines[i] || {};
              return (
                <div key={l.key} className="rounded-xl border border-gray-200 p-2">
                  <div className="grid grid-cols-12 gap-2">
                    {data.items.length > 0 && !l.original_line_id && (
                      <select className="input col-span-12 py-1.5 text-xs sm:col-span-4" value={l.item_id || ''} onChange={(e) => addFromItem(l.key, e.target.value)} aria-label="Product / service">
                        <option value="">Pick a product / service…</option>{data.items.filter((it) => it.active).map((it) => <option key={it.id} value={it.id}>{it.sku ? `${it.sku} · ` : ''}{it.name}</option>)}
                      </select>
                    )}
                    <input className={`input col-span-12 py-1.5 ${data.items.length > 0 && !l.original_line_id ? 'sm:col-span-8' : ''}`} placeholder="Description of goods / services (be specific — not just 'services')" value={l.description} onChange={(e) => setLine(l.key, { description: e.target.value })} aria-label={`Line ${i + 1} description`} />
                    <Field label="Qty" className="col-span-4 sm:col-span-2"><input className="input py-1.5 text-right" inputMode="decimal" value={l.quantity} onChange={(e) => setLine(l.key, { quantity: e.target.value.replace(/[^\d.]/g, '') })} /></Field>
                    <Field label="Unit" className="col-span-4 sm:col-span-1"><input className="input py-1.5" maxLength={20} value={l.unit} onChange={(e) => setLine(l.key, { unit: e.target.value })} /></Field>
                    <Field label="Unit price" className="col-span-4 sm:col-span-2"><input className="input py-1.5 text-right" inputMode="decimal" value={l.unit_price} onChange={(e) => setLine(l.key, { unit_price: e.target.value.replace(/[^\d.]/g, '') })} /></Field>
                    <Field label="Disc. %" className="col-span-3 sm:col-span-1"><input className="input py-1.5 text-right" inputMode="decimal" value={l.disc_pct} onChange={(e) => setLine(l.key, { disc_pct: e.target.value.replace(/[^\d.]/g, '') })} /></Field>
                    {isTax && (
                      <Field label="VAT" className="col-span-5 sm:col-span-2">
                        <select className="input py-1.5" value={l.rate_code} onChange={(e) => setLine(l.key, { rate_code: e.target.value })}>
                          {codes.map((cd) => { const r = data.rates.filter((x) => x.code === cd).slice(-1)[0]; return <option key={cd} value={cd}>{r?.treatment === 'standard' ? `${Number(c.rate || r.rate)}% standard` : r?.treatment === 'zero' ? '0% zero-rated' : 'Exempt'}</option>; })}
                        </select>
                      </Field>
                    )}
                    <Field label="Supply" className="col-span-4 sm:col-span-2">
                      <select className="input py-1.5" value={l.supply_kind} onChange={(e) => setLine(l.key, { supply_kind: e.target.value })}><option value="goods">Goods</option><option value="services">Services</option></select>
                    </Field>
                  </div>
                  <div className="mt-1 flex flex-wrap items-center gap-3 text-xs text-gray-500">
                    {c.discount > 0 && <span>discount {money(c.discount)}</span>}
                    <span>value {money(c.net)}</span>{isTax && <span>VAT {money(c.vat)}</span>}<b className="text-gray-800">total {money(c.total)}</b>
                    {c.rateMissing && <span className="font-semibold text-red-600">No rate for the supply date</span>}
                    <span className="flex-1" />
                    <button type="button" className="text-gray-400 hover:text-red-600" onClick={() => setLines((ls) => ls.filter((x) => x.key !== l.key))} aria-label="Remove line"><Trash2 size={14} /></button>
                  </div>
                </div>
              );
            })}
          </div>
          <button type="button" className="btn-secondary border px-3 py-1.5 text-sm" onClick={() => setLines((ls) => [...ls, blankLine(st.default_rate_code || 'VAT_STD')])}><Plus size={14} /> Add line</button>
          <div className="flex flex-wrap items-end justify-between gap-3 rounded-lg bg-gray-50 p-3">
            {!isNote && (
              <div className="flex gap-2">
                <Field label="Invoice discount %"><input className="input w-24 py-1.5 text-right" inputMode="decimal" value={doc.disc_pct} onChange={(e) => set({ disc_pct: e.target.value.replace(/[^\d.]/g, '') })} /></Field>
                <Field label="or amount"><input className="input w-28 py-1.5 text-right" inputMode="decimal" value={doc.disc_amt} onChange={(e) => set({ disc_amt: e.target.value.replace(/[^\d.]/g, '') })} /></Field>
              </div>
            )}
            <Totals c={calc.totals} isTax={isTax} />
          </div>
          {type === 'credit' && calc.totals.total > roomToCredit && <div className="text-sm font-semibold text-red-600"><AlertTriangle size={14} className="inline" /> More than you can credit ({rs(roomToCredit)}).</div>}
          {nav()}
        </div>
      )}

      {step === 3 && (
        <div className="card space-y-3 p-4">
          {!isNote && (
            <div className="grid gap-2 sm:grid-cols-3">
              <Field label="Payment terms">
                <select className="input" value={doc.customDue ? 'custom' : String(doc.terms_days)} onChange={(e) => (e.target.value === 'custom' ? set({ customDue: true, due_date: due }) : set({ customDue: false, terms_days: Number(e.target.value) }))}>
                  {TERMS.map(([d, l]) => <option key={d} value={d}>{l}</option>)}
                  {!TERMS.some(([d]) => d === Number(doc.terms_days)) && !doc.customDue && <option value={doc.terms_days}>{doc.terms_days} days</option>}
                  <option value="custom">Custom date</option>
                </select>
              </Field>
              <Field label="Due date">{doc.customDue ? <input type="date" className="input" value={doc.due_date} min={doc.issue_date} onChange={(e) => set({ due_date: e.target.value })} /> : <div className="input bg-gray-50">{dmy(due)}</div>}</Field>
              <Field label="Mode of payment (optional)">
                <select className="input" value={doc.payment_mode} onChange={(e) => set({ payment_mode: e.target.value })}><option value="">—</option>{Object.entries(METHODS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select>
              </Field>
            </div>
          )}
          <div className="grid gap-2 sm:grid-cols-2">
            {!isNote && <Field label="Place of supply (optional)"><input className="input" maxLength={160} value={doc.place_of_supply} onChange={(e) => set({ place_of_supply: e.target.value })} /></Field>}
            <Field label="Template"><select className="input" value={doc.template_key} onChange={(e) => set({ template_key: e.target.value })}><option value="">Default ({TEMPLATES.find((x) => x.key === (st.template_key || 'classic'))?.name})</option>{TEMPLATES.map((x) => <option key={x.key} value={x.key}>{x.name}</option>)}</select></Field>
          </div>
          <Field label="Notes (printed)"><textarea className="input" rows={2} maxLength={1000} value={doc.notes} onChange={(e) => set({ notes: e.target.value })} /></Field>
          {!isNote && <Field label="Terms & conditions" hint="Empty = your default terms from Settings."><textarea className="input" rows={2} maxLength={2000} value={doc.terms} onChange={(e) => set({ terms: e.target.value })} placeholder={st.terms || ''} /></Field>}
          {nav()}
        </div>
      )}

      {step === 4 && (
        <div className="card space-y-3 p-4">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div className="text-sm">
              <div className="font-semibold text-gray-800">{doc.customer_id ? cust?.name : doc.customer.name || '—'}</div>
              <div className="text-xs text-gray-500">{isNote ? 'Note' : 'Invoice'} date {dmy(doc.issue_date)}{doc.supply_date && ` · supply ${dmy(doc.supply_date)}`}{!isNote && ` · due ${dmy(due)}`} · {lines.length} line{lines.length === 1 ? '' : 's'}</div>
            </div>
            <Totals c={calc.totals} isTax={isTax} />
          </div>
          <div>
            <div className="mb-1 flex items-center gap-2 text-sm font-semibold text-gray-700">Validation checklist {check && <Badge meta={{ cls: check.ok ? 'bg-green-50 text-green-700 border-green-200' : 'bg-red-50 text-red-700 border-red-200' }}>{check.ok ? 'Ready to issue' : 'Needs attention'}</Badge>}
              <button type="button" onClick={runCheck} className="ml-auto text-xs font-semibold text-primary-700">Check again</button></div>
            {!check ? <div className="text-xs text-gray-400">Checking…</div> : <Checklist checks={check.checks} />}
          </div>
          <div className="flex flex-wrap gap-2 border-t pt-3">
            <button type="button" className="btn-secondary border px-3 py-1.5 text-sm" onClick={() => setStep(3)}><ChevronLeft size={15} /> Back</button>
            <span className="flex-1" />
            <button type="button" disabled={busy} className="btn-secondary border px-3 py-1.5 text-sm" onClick={preview}><Eye size={14} /> Preview</button>
            <button type="button" disabled={busy} className="btn-secondary border px-3 py-1.5 text-sm" onClick={() => save(false)}><Save size={14} /> {t('act.save_draft')}</button>
            {(can(isNote ? (type === 'credit' ? 'credit_note' : 'debit_note') : 'issue')) && (
              <button type="button" disabled={busy || (check && !check.ok)} className="btn-primary px-4 py-1.5 text-sm" onClick={issue}>{busy ? <Loader2 size={14} className="animate-spin" /> : <CheckCircle2 size={14} />} {t('act.issue')}</button>
            )}
          </div>
        </div>
      )}

      {addCust && <QuickCustomer clientId={clientId} vat={type === 'tax'} onClose={() => setAddCust(false)} onSaved={async (cid) => { await reload(['customers']); pickCustomer(cid); setAddCust(false); }} />}
    </div>
  );
}

function Totals({ c, isTax }) {
  return (
    <table className="text-sm">
      <tbody>
        {c.discount_total > 0 && <tr><td className="pr-4 text-gray-500">Discount</td><td className="text-right tabular-nums">({money(c.discount_total)})</td></tr>}
        {isTax && <tr><td className="pr-4 text-gray-500">Value excl. VAT</td><td className="text-right tabular-nums">{money(c.net_total)}</td></tr>}
        {isTax && c.taxable_zero > 0 && <tr><td className="pr-4 text-xs text-gray-400">zero-rated</td><td className="text-right text-xs tabular-nums text-gray-400">{money(c.taxable_zero)}</td></tr>}
        {isTax && c.exempt_amount > 0 && <tr><td className="pr-4 text-xs text-gray-400">exempt</td><td className="text-right text-xs tabular-nums text-gray-400">{money(c.exempt_amount)}</td></tr>}
        {isTax && <tr><td className="pr-4 text-gray-500">VAT</td><td className="text-right tabular-nums">{money(c.vat_total)}</td></tr>}
        <tr className="border-t"><td className="pr-4 font-bold text-primary-800">{isTax ? 'Total incl. VAT' : 'Total'}</td><td className="text-right font-black tabular-nums text-primary-800">{rs(c.total)}</td></tr>
      </tbody>
    </table>
  );
}

export function Checklist({ checks }) {
  return (
    <ul className="grid gap-1 sm:grid-cols-2">
      {(checks || []).map((c) => (
        <li key={c.key} className={`flex items-start gap-1.5 rounded-lg px-2 py-1 text-xs ${c.ok ? 'text-gray-700' : c.level === 'error' ? 'bg-red-50 text-red-800' : 'bg-amber-50 text-amber-900'}`}>
          {c.ok ? <CheckCircle2 size={14} className="mt-px shrink-0 text-green-600" /> : c.level === 'error' ? <XCircle size={14} className="mt-px shrink-0 text-red-600" /> : <AlertTriangle size={14} className="mt-px shrink-0 text-amber-600" />}
          <span><b>{c.label}</b>{!c.ok && <> — {c.msg}</>}</span>
        </li>
      ))}
    </ul>
  );
}

function QuickCustomer({ clientId, vat, onClose, onSaved }) {
  const [f, setF] = useState({ name: '', tin: '', vat_registered: vat, address: '', phone: '', email: '' });
  const [busy, setBusy] = useState(false);
  const save = async () => {
    setBusy(true);
    try { onSaved(await saveCustomer(clientId, { ...f, kind: 'business' })); toast.success('Customer added'); } catch (e) { toast.error(e.message); } finally { setBusy(false); }
  };
  return (
    <Modal title="New customer" onClose={onClose} footer={<><button type="button" className="btn-secondary border text-sm" onClick={onClose}>Cancel</button><button type="button" disabled={busy || !f.name.trim()} className="btn-primary text-sm" onClick={save}>Save</button></>}>
      <div className="grid gap-2 sm:grid-cols-2">
        <Field label="Name" className="sm:col-span-2"><input className="input" value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} autoFocus /></Field>
        <Field label="TIN (9 digits)"><input className="input" inputMode="numeric" maxLength={9} value={f.tin} onChange={(e) => setF({ ...f, tin: e.target.value.replace(/\D/g, '') })} /></Field>
        <label className="mt-5 flex items-center gap-2 text-sm"><input type="checkbox" checked={f.vat_registered} onChange={(e) => setF({ ...f, vat_registered: e.target.checked })} /> VAT-registered</label>
        <Field label="Address" className="sm:col-span-2"><input className="input" value={f.address} onChange={(e) => setF({ ...f, address: e.target.value })} /></Field>
        <Field label="Telephone"><input className="input" value={f.phone} onChange={(e) => setF({ ...f, phone: e.target.value })} /></Field>
        <Field label="Email"><input className="input" type="email" value={f.email} onChange={(e) => setF({ ...f, email: e.target.value })} /></Field>
      </div>
    </Modal>
  );
}
