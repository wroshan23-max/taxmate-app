// V64 — Purchaser VAT inbox: supplier invoices to review (from TaxMate suppliers, manual, CSV; RAMIS when connected)
import { useEffect, useMemo, useState } from 'react';
import toast from 'react-hot-toast';
import { Inbox, Plus, Upload, Search, Eye, Check, X, AlertTriangle, Undo2, Paperclip, Trash2, Download, Info } from 'lucide-react';
import { loadPurchases, savePurchase, importPurchases, reviewPurchase, deletePurchase, purchaseDocument, uploadVatFile, vatFileUrl, loadScheduleMap } from '../../lib/vat/api';
import { rs, money, dmy, slToday, APPROVAL } from '../../lib/vat/format';
import { buildDocHtml, openPrintWindow, writePrint } from '../../lib/vat/printDoc';
import { Badge, Empty, Modal, Field, Spinner, downloadCsv } from './ui';

const SOURCE = { taxmate: 'TaxMate supplier', api: 'RAMIS API', manual: 'Manual', csv: 'CSV import' };
const blank = { doc_kind: 'invoice', schedule_key: 'in:local', supplier_name: '', supplier_tin: '', supplier_address: '', invoice_no: '', original_no: '', invoice_date: slToday(), supply_date: '', description: '', taxable: '', vat: '', total: '', disallowed_vat: '', claim_period: '' };
const CSV_COLS = ['supplier_name', 'supplier_tin', 'invoice_no', 'invoice_date', 'supply_date', 'description', 'taxable', 'vat', 'total', 'doc_kind', 'original_no', 'schedule'];

function parseCsv(text) {
  const rows = []; let row = [], cell = '', q = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (q) { if (ch === '"' && text[i + 1] === '"') { cell += '"'; i++; } else if (ch === '"') q = false; else cell += ch; }
    else if (ch === '"') q = true; else if (ch === ',') { row.push(cell); cell = ''; } else if (ch === '\n' || ch === '\r') { if (ch === '\r' && text[i + 1] === '\n') i++; row.push(cell); rows.push(row); row = []; cell = ''; } else cell += ch;
  }
  if (cell || row.length) { row.push(cell); rows.push(row); }
  return rows.filter((r) => r.some((c) => c.trim() !== ''));
}
const isoDate = (s) => { const v = String(s || '').trim(); if (/^\d{4}-\d{2}-\d{2}$/.test(v)) return v; const m = v.match(/^(\d{1,2})[./-](\d{1,2})[./-](\d{4})$/); return m ? `${m[3]}-${m[2].padStart(2, '0')}-${m[1].padStart(2, '0')}` : v; };

export default function Purchases({ app }) {
  const { clientId, can, tick } = app;
  const [list, setList] = useState(null);
  const [map, setMap] = useState([]);
  const [q, setQ] = useState('');
  const [appr, setAppr] = useState('');
  const [src, setSrc] = useState('');
  const [edit, setEdit] = useState(null);
  const [review, setReview] = useState(null);
  const [imp, setImp] = useState(false);
  const load = () => loadPurchases(clientId).then(setList).catch((e) => { toast.error(e.message); setList([]); });
  useEffect(() => { load(); loadScheduleMap().then(setMap).catch(() => {}); }, [clientId, tick]); // eslint-disable-line react-hooks/exhaustive-deps
  const rows = useMemo(() => (list || []).filter((p) => (!appr || p.approval === appr) && (!src || p.source === src)
    && (!q || [p.supplier_name, p.supplier_tin, p.invoice_no].filter(Boolean).join(' ').toLowerCase().includes(q.toLowerCase()))), [list, appr, src, q]);
  if (!list) return <Spinner />;
  const schedLabel = (k) => { const m = map.find((x) => x.key === k); return m ? `Sch ${m.schedule || '—'}` : k; };
  const pending = list.filter((p) => p.approval === 'pending').length;

  const viewDoc = async (p) => {
    if (p.linked_doc_id) {
      const w = openPrintWindow();
      try { writePrint(w, buildDocHtml(await purchaseDocument(p.id), { toolbar: true, payLink: false })); } catch (e) { w?.close(); toast.error(e.message); }
    } else if (p.attachment_path) {
      const w = window.open('', '_blank');
      try { w.location.href = await vatFileUrl(p.attachment_path); } catch (e) { w?.close(); toast.error(e.message); }
    } else toast('No document attached.');
  };
  const sheet = () => [['Source', 'Kind', 'Schedule', 'Supplier', 'Supplier TIN', 'Invoice no.', 'Original no.', 'Invoice date', 'Supply date', 'Taxable', 'VAT', 'Total', 'Disallowed VAT', 'Claim period', 'Approval', 'Note'],
    ...rows.map((p) => [SOURCE[p.source], p.doc_kind, schedLabel(p.schedule_key), p.supplier_name, p.supplier_tin, p.invoice_no, p.original_no, p.invoice_date, p.supply_date, Number(p.taxable), Number(p.vat), Number(p.total), Number(p.disallowed_vat), p.claim_period, p.approval, p.review_note])];

  return (
    <div className="space-y-3">
      <div className="card p-3 text-xs text-gray-600">
        <Info size={13} className="-mt-0.5 mr-1 inline text-primary-700" />When a supplier submits a tax invoice to RAMIS, it appears in your RAMIS Schedule 02 as <b>Pending Approval</b>; you review and approve it there.
        This inbox keeps the same records in TaxMate: invoices from suppliers who also use TaxMate arrive automatically, others you add by hand or CSV.
        Approving here is your own review — <b>it does not claim input VAT in RAMIS</b>; approve in RAMIS as IRD requires.
      </div>
      <div className="card space-y-2 p-3">
        <div className="flex flex-wrap items-center gap-2">
          <div className="relative min-w-[200px] flex-1"><Search size={14} className="absolute left-2.5 top-2.5 text-gray-400" /><input className="input pl-8" placeholder="Supplier, TIN, invoice no…" value={q} onChange={(e) => setQ(e.target.value)} /></div>
          {can('purchases') && <button type="button" className="btn-secondary border px-3 py-1.5 text-sm" onClick={() => setImp(true)}><Upload size={14} /> CSV import</button>}
          {can('purchases') && <button type="button" className="btn-primary px-3 py-1.5 text-sm" onClick={() => setEdit(blank)}><Plus size={14} /> Purchase invoice</button>}
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <select className="input w-auto py-1.5" value={appr} onChange={(e) => setAppr(e.target.value)} aria-label="Approval"><option value="">All ({list.length})</option>{Object.entries(APPROVAL).map(([k, v]) => <option key={k} value={k}>{v.label}{k === 'pending' ? ` (${pending})` : ''}</option>)}</select>
          <select className="input w-auto py-1.5" value={src} onChange={(e) => setSrc(e.target.value)} aria-label="Source"><option value="">Any source</option>{Object.entries(SOURCE).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select>
          <span className="flex-1" />
          <button type="button" className="text-xs font-semibold text-primary-700" onClick={() => downloadCsv(`purchases-${slToday()}.csv`, sheet())}><Download size={12} className="inline" /> CSV</button>
        </div>
      </div>
      {rows.length === 0 ? <Empty icon={Inbox} title="No purchase records">Supplier invoices to review show here.</Empty> : (
        <div className="card overflow-x-auto">
          <table className="w-full text-xs">
            <thead className="bg-gray-50"><tr><th className="table-th">Supplier</th><th className="table-th">Invoice</th><th className="table-th text-right">Taxable</th><th className="table-th text-right">VAT</th><th className="table-th text-right">Total</th><th className="table-th">Status</th><th className="table-th" /></tr></thead>
            <tbody className="divide-y divide-gray-50">
              {rows.map((p) => (
                <tr key={p.id}>
                  <td className="table-td"><div className="font-semibold">{p.supplier_name}</div><div className="text-gray-500">{p.supplier_tin ? `TIN ${p.supplier_tin}` : 'no TIN'} · <span className={p.source === 'taxmate' || p.source === 'api' ? 'font-semibold text-primary-700' : ''}>{SOURCE[p.source]}</span></div></td>
                  <td className="table-td"><div className="font-mono">{p.invoice_no}</div><div className="text-gray-500">{p.doc_kind !== 'invoice' && <b>{p.doc_kind} note{p.original_no && ` vs ${p.original_no}`} · </b>}{dmy(p.invoice_date)}{p.supply_date && ` · supply ${dmy(p.supply_date)}`} · {schedLabel(p.schedule_key)}</div></td>
                  <td className="table-td text-right tabular-nums">{money(p.taxable)}</td>
                  <td className="table-td text-right tabular-nums">{money(p.vat)}{Number(p.disallowed_vat) > 0 && <div className="text-red-600">disallowed {money(p.disallowed_vat)}</div>}</td>
                  <td className="table-td text-right tabular-nums">{money(p.total)}</td>
                  <td className="table-td"><Badge meta={APPROVAL[p.approval]} />{p.ramis_status === 'accepted' && <div className="mt-0.5 text-[10px] text-green-700">supplier: RAMIS accepted</div>}{p.review_note && <div className="mt-0.5 max-w-[180px] truncate text-[10px] text-gray-500" title={p.review_note}>{p.review_note}</div>}</td>
                  <td className="table-td whitespace-nowrap text-right">
                    <button type="button" className="p-1 text-gray-500 hover:text-primary-700" onClick={() => viewDoc(p)} title="View invoice"><Eye size={14} /></button>
                    {can('approve_purchases') && <button type="button" className="p-1 text-gray-500 hover:text-primary-700" onClick={() => setReview(p)} title="Review">Review</button>}
                    {can('purchases') && ['manual', 'csv'].includes(p.source) && !['approved', 'matched'].includes(p.approval) && <>
                      <button type="button" className="p-1 text-gray-400 hover:text-primary-700" onClick={() => setEdit({ ...blank, ...Object.fromEntries(Object.entries(p).map(([k, v]) => [k, v ?? ''])) })} title="Edit">Edit</button>
                      <button type="button" className="p-1 text-gray-400 hover:text-red-600" onClick={async () => { if (!window.confirm('Delete this purchase record?')) return; try { await deletePurchase(p.id); load(); } catch (e) { toast.error(e.message); } }} title="Delete"><Trash2 size={13} /></button>
                    </>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {edit && <PurchaseForm app={app} value={edit} map={map} onClose={() => setEdit(null)} onSaved={() => { setEdit(null); load(); }} />}
      {review && <ReviewForm p={review} onClose={() => setReview(null)} onDone={() => { setReview(null); load(); }} />}
      {imp && <ImportForm app={app} onClose={() => setImp(false)} onDone={() => { setImp(false); load(); }} />}
    </div>
  );
}

function PurchaseForm({ app, value, map, onClose, onSaved }) {
  const { clientId } = app;
  const [f, setF] = useState(value);
  const [file, setFile] = useState(null);
  const [busy, setBusy] = useState(false);
  const s = (k) => (e) => setF({ ...f, [k]: e.target.value });
  const num = (k) => (e) => setF({ ...f, [k]: e.target.value.replace(/[^\d.-]/g, '') });
  const save = async () => {
    setBusy(true);
    try {
      const attachment_path = file ? await uploadVatFile(clientId, 'purchases', file) : (f.attachment_path || null);
      await savePurchase(clientId, { ...f, attachment_path, total: f.total || (Number(f.taxable || 0) + Number(f.vat || 0)) });
      toast.success('Saved'); onSaved();
    } catch (e) { toast.error(e.message); } finally { setBusy(false); }
  };
  return (
    <Modal title={f.id ? 'Edit purchase invoice' : 'Add a purchase invoice'} onClose={onClose} wide footer={<><button type="button" className="btn-secondary border text-sm" onClick={onClose}>Cancel</button><button type="button" disabled={busy} className="btn-primary text-sm" onClick={save}>Save</button></>}>
      <div className="grid gap-2 sm:grid-cols-3">
        <Field label="Kind"><select className="input" value={f.doc_kind} onChange={(e) => setF({ ...f, doc_kind: e.target.value, schedule_key: e.target.value === 'invoice' ? 'in:local' : 'in:note' })}><option value="invoice">Tax invoice</option><option value="credit">Credit note</option><option value="debit">Debit note</option></select></Field>
        <Field label="Schedule"><select className="input" value={f.schedule_key} onChange={s('schedule_key')}>{map.filter((m) => m.side === 'purchaser' && m.active).map((m) => <option key={m.key} value={m.key}>Sch {m.schedule} — {m.label}</option>)}</select></Field>
        <Field label="Claim period (YYYY-MM)"><input className="input" placeholder="2026-11" value={f.claim_period} onChange={s('claim_period')} /></Field>
        <Field label="Supplier name" className="sm:col-span-2"><input className="input" value={f.supplier_name} onChange={s('supplier_name')} /></Field>
        <Field label="Supplier TIN"><input className="input" inputMode="numeric" maxLength={9} value={f.supplier_tin} onChange={(e) => setF({ ...f, supplier_tin: e.target.value.replace(/\D/g, '') })} /></Field>
        <Field label="Supplier address" className="sm:col-span-3"><input className="input" value={f.supplier_address} onChange={s('supplier_address')} /></Field>
        <Field label="Invoice / note no."><input className="input" value={f.invoice_no} onChange={s('invoice_no')} /></Field>
        <Field label="Invoice date"><input type="date" className="input" value={f.invoice_date} onChange={s('invoice_date')} /></Field>
        <Field label="Date of supply"><input type="date" className="input" value={f.supply_date || ''} onChange={s('supply_date')} /></Field>
        {f.doc_kind !== 'invoice' && <Field label="Original invoice no."><input className="input" value={f.original_no} onChange={s('original_no')} /></Field>}
        <Field label="Description" className={f.doc_kind !== 'invoice' ? 'sm:col-span-2' : 'sm:col-span-3'}><input className="input" value={f.description} onChange={s('description')} /></Field>
        <Field label="Taxable value (Rs.)"><input className="input text-right" inputMode="decimal" value={f.taxable} onChange={num('taxable')} /></Field>
        <Field label="VAT (Rs.)"><input className="input text-right" inputMode="decimal" value={f.vat} onChange={num('vat')} /></Field>
        <Field label="Total (Rs.)" hint="Empty = taxable + VAT"><input className="input text-right" inputMode="decimal" value={f.total} onChange={num('total')} /></Field>
        <Field label="Disallowed VAT (Rs.)"><input className="input text-right" inputMode="decimal" value={f.disallowed_vat} onChange={num('disallowed_vat')} /></Field>
        <Field label="Invoice copy (PDF / photo)" className="sm:col-span-2">
          <label className="input flex cursor-pointer items-center gap-1 text-xs text-gray-600"><Paperclip size={13} />{file ? file.name : f.attachment_path ? 'Attached — choose to replace' : 'Choose file'}<input type="file" accept="image/*,application/pdf" className="hidden" onChange={(e) => setFile(e.target.files?.[0] || null)} /></label>
        </Field>
      </div>
    </Modal>
  );
}

function ReviewForm({ p, onClose, onDone }) {
  const [note, setNote] = useState(p.review_note || '');
  const [dis, setDis] = useState(String(p.disallowed_vat || ''));
  const [per, setPer] = useState(p.claim_period || '');
  const [busy, setBusy] = useState(false);
  const go = async (a) => {
    setBusy(true);
    try { const r = await reviewPurchase(p.id, a, note, dis === '' ? null : Number(dis), per || null); toast.success(r === 'matched' ? 'Approved — matched with the supplier invoice' : `Marked ${a}`); onDone(); } catch (e) { toast.error(e.message); } finally { setBusy(false); }
  };
  return (
    <Modal title={`Review ${p.invoice_no} — ${p.supplier_name}`} onClose={onClose}
      footer={<>
        <button type="button" disabled={busy} className="btn-secondary border text-sm" onClick={() => go('pending')}><Undo2 size={14} /> Pending</button>
        <button type="button" disabled={busy} className="btn-secondary border text-sm text-orange-700" onClick={() => go('disputed')}><AlertTriangle size={14} /> Dispute</button>
        <button type="button" disabled={busy} className="btn-secondary border text-sm text-red-700" onClick={() => go('rejected')}><X size={14} /> Reject</button>
        <button type="button" disabled={busy} className="btn-primary text-sm" onClick={() => go('approved')}><Check size={14} /> Approve</button>
      </>}>
      <div className="space-y-2 text-sm">
        <div className="rounded-lg bg-gray-50 p-2 text-xs">{dmy(p.invoice_date)} · taxable {rs(p.taxable)} · VAT {rs(p.vat)} · total {rs(p.total)} · now <b>{APPROVAL[p.approval]?.label}</b></div>
        <div className="grid gap-2 sm:grid-cols-2">
          <Field label="Disallowed VAT (Rs.)" hint="Part of the VAT you cannot claim."><input className="input text-right" inputMode="decimal" value={dis} onChange={(e) => setDis(e.target.value.replace(/[^\d.]/g, ''))} /></Field>
          <Field label="Claim period (YYYY-MM)"><input className="input" value={per} onChange={(e) => setPer(e.target.value)} placeholder="2026-11" /></Field>
        </div>
        <Field label="Note (required to reject or dispute)"><input className="input" maxLength={500} value={note} onChange={(e) => setNote(e.target.value)} /></Field>
        <div className="text-[11px] text-gray-500">Approving here does not claim input VAT in RAMIS — approve the record in RAMIS Schedule 02 as well.</div>
      </div>
    </Modal>
  );
}

function ImportForm({ app, onClose, onDone }) {
  const { clientId } = app;
  const [parsed, setParsed] = useState(null);
  const [res, setRes] = useState(null);
  const [busy, setBusy] = useState(false);
  const read = async (file) => {
    const rows = parseCsv(await file.text());
    if (rows.length < 2) return toast.error('The file has no rows.');
    const head = rows[0].map((h) => h.trim().toLowerCase().replace(/\s+/g, '_'));
    const miss = ['supplier_name', 'invoice_no', 'invoice_date'].filter((c) => !head.includes(c));
    if (miss.length) return toast.error(`Missing columns: ${miss.join(', ')}`);
    setParsed(rows.slice(1).map((r) => {
      const o = Object.fromEntries(head.map((h, i) => [h, (r[i] ?? '').trim()]));
      const kind = ['credit', 'debit'].includes(o.doc_kind?.toLowerCase()) ? o.doc_kind.toLowerCase() : 'invoice';
      const sch = { import: 'in:import', imports: 'in:import', deemed: 'in:deemed' }[o.schedule?.toLowerCase()] || (kind === 'invoice' ? 'in:local' : 'in:note');
      return { supplier_name: o.supplier_name, supplier_tin: (o.supplier_tin || '').replace(/\D/g, ''), invoice_no: o.invoice_no, invoice_date: isoDate(o.invoice_date), supply_date: isoDate(o.supply_date) || '',
        description: o.description, taxable: o.taxable?.replace(/,/g, ''), vat: o.vat?.replace(/,/g, ''), total: o.total?.replace(/,/g, ''), doc_kind: kind, original_no: o.original_no, schedule_key: sch };
    }));
  };
  const run = async () => {
    setBusy(true);
    try { setRes(await importPurchases(clientId, parsed)); } catch (e) { toast.error(e.message); } finally { setBusy(false); }
  };
  return (
    <Modal title="Import purchase invoices (CSV)" onClose={onClose} wide footer={res ? <button type="button" className="btn-primary text-sm" onClick={onDone}>Done</button> : <><button type="button" className="btn-secondary border text-sm" onClick={onClose}>Cancel</button><button type="button" disabled={!parsed || busy} className="btn-primary text-sm" onClick={run}>Import {parsed ? parsed.length : ''} rows</button></>}>
      <div className="space-y-2 text-sm">
        <div className="text-xs text-gray-600">Columns (first row): <span className="font-mono">{CSV_COLS.join(', ')}</span>. Required: supplier_name, invoice_no, invoice_date (YYYY-MM-DD or DD/MM/YYYY). doc_kind: invoice / credit / debit; schedule: local / import / deemed. Same supplier + number is skipped as duplicate.</div>
        <button type="button" className="text-xs font-semibold text-primary-700" onClick={() => downloadCsv('purchase-import-template.csv', [CSV_COLS, ['ABC Suppliers (Pvt) Ltd', '123456789', '26NOV_MAIN_00012', '2026-11-05', '2026-11-05', 'Office chairs', '50000', '9000', '59000', 'invoice', '', 'local']])}>Download template</button>
        {!res && <input type="file" accept=".csv,text/csv" onChange={(e) => e.target.files?.[0] && read(e.target.files[0])} />}
        {parsed && !res && <div className="max-h-48 overflow-auto rounded border text-xs">{parsed.slice(0, 20).map((r, i) => <div key={i} className="border-b px-2 py-0.5">{r.supplier_name} · {r.invoice_no} · {r.invoice_date} · VAT {r.vat}</div>)}{parsed.length > 20 && <div className="px-2 py-0.5 text-gray-400">… {parsed.length - 20} more</div>}</div>}
        {res && <div className="rounded-lg bg-gray-50 p-2 text-xs">Imported <b>{res.imported}</b> · duplicates skipped <b>{res.duplicates}</b> · errors <b>{res.errors.length}</b>{res.errors.map((e) => <div key={e.row} className="text-red-700">Row {e.row + 1}: {e.error}</div>)}</div>}
      </div>
    </Modal>
  );
}
