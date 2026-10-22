import { useEffect, useMemo, useState } from 'react';
import { supabase, fmtRs, fmtDate } from '../../lib/supabase';
import { useAuth } from '../../contexts/AuthContext';
import toast from 'react-hot-toast';
import { Receipt, Plus, Trash2, Printer, Save, RotateCcw, Pencil, Download, Search, Building2, PenTool, Star } from 'lucide-react';
import SignaturePad from '../../components/SignaturePad';
import SendMenu from '../../components/SendMenu';
import { recipientsOf } from '../../lib/contacts';
import { invoiceMessage } from '../../lib/share';
import { FIRM } from '../../lib/iitStatement';
import {
  INVOICE_CFG, STATUS_LABEL, isSent, isOverdue, itemAmount, computeTotals,
  nextInvoiceNo, todayISO, addDaysISO, billTo, openInvoice, exportInvoicesCSV,
} from '../../lib/invoice';

const EMPTY_CLIENT = { name: '', tin: '', nic: '', phone: '', email: '', address: '' };
const blankForm = () => ({
  issue_date: todayISO(), due_date: addDaysISO(todayISO(), INVOICE_CFG.dueDays), client_id: '', client: { ...EMPTY_CLIENT },
  items: [], discount_pct: '0', notes: '', bank_account_id: '', sigMode: 'draw', signature: '',
});

const STATUS_CLS = { draft: 'bg-gray-100 text-gray-600', unpaid: 'bg-blue-100 text-blue-700', overdue: 'bg-blue-100 text-blue-700', paid: 'bg-green-100 text-green-700' };
const StatusBadge = ({ inv }) => (
  <span className={`inline-flex flex-col items-start px-2 py-0.5 rounded-md text-xs font-semibold ${STATUS_CLS[inv.status] ?? 'bg-gray-100'}`}>
    {STATUS_LABEL[inv.status] ?? inv.status}
    {inv.status === 'paid' && inv.paid_date && <span className="font-normal text-[10px]">{inv.paid_date}</span>}
  </span>
);

export default function Invoices() {
  const { user } = useAuth();
  const [tab, setTab]           = useState('new');
  const [invoices, setInvoices] = useState([]);
  const [clients, setClients]   = useState([]);
  const [banks, setBanks]       = useState([]);
  const [firmSig, setFirmSig]   = useState('');
  const [loading, setLoading]   = useState(true);
  const [setupNeeded, setSetupNeeded] = useState(false);

  // form
  const [form, setForm]       = useState(blankForm);
  const [editing, setEditing] = useState(null);   // invoice row being edited
  const [formKey, setFormKey] = useState(0);      // remount signature pad on load/reset
  const [saving, setSaving]   = useState(false);

  // history filters
  const [fStatus, setFStatus] = useState('all');
  const [fFrom, setFFrom]     = useState('');
  const [fTo, setFTo]         = useState('');
  const [fSearch, setFSearch] = useState('');

  const loadAll = async () => {
    const [inv, cls, bk, st] = await Promise.all([
      supabase.from('invoices').select('*, clients(full_name, tin, nic, mobile, email, address, contact_name, contact_relation, contact_mobile, contact_email, contact_preferred), invoice_items(*)').order('created_at', { ascending: false }),
      supabase.from('clients').select('id, full_name, tin, nic, mobile, email, address').is('archived_at', null).order('full_name'),
      supabase.from('bank_accounts').select('*').order('created_at'),
      supabase.from('app_settings').select('value').eq('key', 'firm_signature').maybeSingle(),
    ]);
    if (inv.error) toast.error(inv.error.message);
    setSetupNeeded(!!bk.error);
    setInvoices(inv.data ?? []);
    setClients(cls.data ?? []);
    setBanks(bk.data ?? []);
    setFirmSig(st.data?.value?.image ?? '');
    setLoading(false);
  };
  useEffect(() => { loadAll(); }, []);

  // default bank on a fresh form
  useEffect(() => {
    if (!editing && !form.bank_account_id && banks.length) {
      const def = banks.find(b => b.is_default);
      if (def) setForm(f => ({ ...f, bank_account_id: def.id }));
    }
  }, [banks]); // eslint-disable-line react-hooks/exhaustive-deps

  const set = (patch) => setForm(f => ({ ...f, ...patch }));
  const setClient = (patch) => setForm(f => ({ ...f, client: { ...f.client, ...patch } }));
  const totals = computeTotals(form.items, form.discount_pct);
  const displayNo = editing ? editing.invoice_no : nextInvoiceNo(invoices.map(i => i.invoice_no), form.issue_date);
  const bankById = (id) => banks.find(b => b.id === id) ?? null;

  // ── stats ──
  const stats = useMemo(() => {
    const sum = (arr) => arr.reduce((s, i) => s + Number(i.total_amount || 0), 0);
    const sent = invoices.filter(i => isSent(i.status));
    const overdue = sent.filter(isOverdue);
    return {
      count: invoices.length, billed: sum(invoices), paid: sum(invoices.filter(i => i.status === 'paid')),
      outstanding: sum(sent), drafts: invoices.filter(i => i.status === 'draft').length, sentCount: sent.length,
      overdueAmt: sum(overdue), overdueCount: overdue.length, sent, overdue,
    };
  }, [invoices]);

  // ── form actions ──
  const pickClient = (id) => {
    const c = clients.find(x => x.id === id);
    set({ client_id: id, client: c ? { name: c.full_name ?? '', tin: c.tin ?? '', nic: c.nic ?? '', phone: c.mobile ?? '', email: c.email ?? '', address: c.address ?? '' } : { ...EMPTY_CLIENT } });
  };
  const addItem = (description = '', unit_price = '') => set({ items: [...form.items, { description, quantity: '1', unit_price: String(unit_price), discount_pct: '0' }] });
  const updItem = (i, patch) => set({ items: form.items.map((it, k) => (k === i ? { ...it, ...patch } : it)) });
  const delItem = (i) => set({ items: form.items.filter((_, k) => k !== i) });

  const resetForm = () => {
    setEditing(null);
    const f = blankForm();
    const def = banks.find(b => b.is_default);
    if (def) f.bank_account_id = def.id;
    setForm(f);
    setFormKey(k => k + 1);
  };

  const loadForEdit = (inv) => {
    const c = billTo(inv);
    setEditing(inv);
    setForm({
      issue_date: inv.issue_date ?? todayISO(), due_date: inv.due_date ?? '', client_id: inv.client_id ?? '', client: c,
      items: [...(inv.invoice_items ?? [])].sort((a, b) => (a.sort_order ?? 0) - (b.sort_order ?? 0))
        .map(it => ({ description: it.description, quantity: String(it.quantity ?? 1), unit_price: String(it.unit_price ?? 0), discount_pct: String(it.discount_pct ?? 0) })),
      discount_pct: String(inv.discount_pct ?? 0), notes: inv.notes ?? '', bank_account_id: inv.bank_account_id ?? '',
      sigMode: inv.signature && inv.signature === firmSig ? 'image' : 'draw', signature: inv.signature ?? '',
    });
    setFormKey(k => k + 1);
    setTab('new');
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  const currentSignature = () => (form.sigMode === 'image' ? firmSig : form.signature) || null;

  const formAsInvoice = (invoice_no) => ({
    invoice_no, issue_date: form.issue_date, due_date: form.due_date || null, client_id: form.client_id || null,
    client_snapshot: { ...form.client }, subtotal: totals.subtotal, discount_pct: parseFloat(form.discount_pct) || 0,
    discount_amt: totals.discount_amt, total_amount: totals.total, notes: form.notes.trim() || null,
    bank_account_id: form.bank_account_id || null, signature: currentSignature(),
  });

  const itemRows = (invoice_id) => form.items.map((it, k) => ({
    invoice_id, description: it.description.trim(), quantity: parseFloat(it.quantity) || 1,
    unit_price: parseFloat(it.unit_price) || 0, discount_pct: parseFloat(it.discount_pct) || 0,
    amount: Math.round(itemAmount(it) * 100) / 100, sort_order: k,
  }));

  const printSaved = (inv) => {
    if (!openInvoice(inv, inv.invoice_items ?? [], bankById(inv.bank_account_id))) toast.error('Pop-up blocked — allow pop-ups for this site');
  };

  const preview = () => {
    if (!openInvoice({ ...formAsInvoice(displayNo), status: editing?.status }, itemRows(null), bankById(form.bank_account_id), { preview: !editing }))
      toast.error('Pop-up blocked — allow pop-ups for this site');
  };

  const save = async () => {
    if (!form.client.name.trim()) return toast.error('Please select or enter a client name');
    if (!form.items.length) return toast.error('Please add at least one service item');
    if (form.items.some(it => !it.description.trim())) return toast.error('Every item needs a description');
    setSaving(true);
    try {
      let saved;
      if (editing) {
        const { data, error } = await supabase.from('invoices')
          .update({ ...formAsInvoice(editing.invoice_no), updated_at: new Date().toISOString() })
          .eq('id', editing.id).select().single();
        if (error) throw error;
        const del = await supabase.from('invoice_items').delete().eq('invoice_id', editing.id);
        if (del.error) throw del.error;
        saved = data;
      } else {
        // fresh number from the database at save time (another device may have added one)
        for (let attempt = 0; attempt < 3 && !saved; attempt++) {
          const { data: nos } = await supabase.from('invoices').select('invoice_no');
          const invoice_no = nextInvoiceNo((nos ?? []).map(r => r.invoice_no), form.issue_date);
          const { data, error } = await supabase.from('invoices')
            .insert({ ...formAsInvoice(invoice_no), status: 'draft', created_by: user.id }).select().single();
          if (error && error.code !== '23505') throw error;
          saved = data;
        }
        if (!saved) throw new Error('Could not allocate an invoice number — please try again');
      }
      const ins = await supabase.from('invoice_items').insert(itemRows(saved.id));
      if (ins.error) throw ins.error;

      const no = saved.invoice_no;
      const wasEditing = !!editing;
      await loadAll();
      resetForm();
      toast.success((t) => (
        <span className="flex items-center gap-3">
          Invoice {no} {wasEditing ? 'updated' : 'saved'}
          <button className="px-2 py-1 rounded bg-primary-600 text-white text-xs"
            onClick={async () => {
              toast.dismiss(t.id);
              const w = window.open('', '_blank', 'width=900,height=900');
              const { data } = await supabase.from('invoices').select('*, clients(full_name, tin, nic, mobile, email, address, contact_name, contact_relation, contact_mobile, contact_email, contact_preferred), invoice_items(*)').eq('id', saved.id).single();
              if (data) openInvoice(data, data.invoice_items ?? [], bankById(data.bank_account_id), {}, w); else w?.close();
            }}>
            🖨 Print
          </button>
        </span>
      ), { duration: 8000 });
    } catch (e) {
      toast.error(e.message ?? String(e));
    }
    setSaving(false);
  };

  // ── status / delete ──
  const setStatus = async (inv, status) => {
    const patch = { status, paid_date: status === 'paid' ? todayISO() : null };
    const { error } = await supabase.from('invoices').update(patch).eq('id', inv.id);
    if (error) return toast.error(error.message);
    setInvoices(list => list.map(x => (x.id === inv.id ? { ...x, ...patch } : x)));
    toast.success(status === 'paid' ? 'Marked as paid' : status === 'unpaid' ? 'Marked as sent' : 'Status updated');
  };
  const remove = async (inv) => {
    if (!window.confirm(`Delete invoice ${inv.invoice_no}? This cannot be undone.`)) return;
    const { error } = await supabase.from('invoices').delete().eq('id', inv.id);
    if (error) return toast.error(error.message);
    setInvoices(list => list.filter(x => x.id !== inv.id));
    if (editing?.id === inv.id) resetForm();
    toast.success('Invoice deleted');
  };

  // ── history filter ──
  const filtered = invoices.filter(inv => {
    if (fStatus === 'draft' && inv.status !== 'draft') return false;
    if (fStatus === 'sent' && !isSent(inv.status)) return false;
    if (fStatus === 'paid' && inv.status !== 'paid') return false;
    if (fFrom && inv.issue_date < fFrom) return false;
    if (fTo && inv.issue_date > fTo) return false;
    if (fSearch) {
      const s = fSearch.toLowerCase(), c = billTo(inv);
      if (!c.name.toLowerCase().includes(s) && !(c.tin || '').includes(fSearch) && !(inv.invoice_no || '').toLowerCase().includes(s)) return false;
    }
    return true;
  });

  const actionButtons = (inv, { ar = false } = {}) => (
    <div className="flex gap-1 flex-wrap justify-end">
      <button onClick={() => printSaved(inv)} title="Print / PDF" className="p-1.5 rounded-md border border-gray-200 hover:bg-gray-50 text-primary-700"><Printer size={14} /></button>
      <SendMenu
        table="invoices" row={inv}
        phone={billTo(inv).phone} email={billTo(inv).email} recipients={recipientsOf(inv.clients, billTo(inv))}
        subject={`Invoice ${inv.invoice_no} — TaxMate Solutions`}
        buildMessage={(url) => invoiceMessage(inv, url)}
        beforeSend={async () => {
          // sending a draft = it has been sent to the client
          if (inv.status !== 'draft') return null;
          const { error } = await supabase.from('invoices').update({ status: 'unpaid' }).eq('id', inv.id);
          if (error) throw error;
          toast.success(`${inv.invoice_no} marked as Sent`);
          return { status: 'unpaid' };
        }}
        onChange={(patch) => setInvoices(list => list.map(x => (x.id === inv.id ? { ...x, ...patch } : x)))}
      />
      {inv.status === 'draft' && <button onClick={() => setStatus(inv, 'unpaid')} className="px-2 py-1 rounded-md text-xs font-semibold bg-blue-50 text-blue-700 hover:bg-blue-100">📤 Sent</button>}
      {isSent(inv.status) && <button onClick={() => setStatus(inv, 'paid')} className="px-2 py-1 rounded-md text-xs font-semibold bg-green-50 text-green-700 hover:bg-green-100">💰 Paid</button>}
      {!ar && inv.status === 'paid' && <button onClick={() => setStatus(inv, 'unpaid')} className="px-2 py-1 rounded-md text-xs font-semibold bg-gray-50 text-gray-500 hover:bg-gray-100">↩ Unmark</button>}
      {!ar && <button onClick={() => loadForEdit(inv)} title="Edit" className="p-1.5 rounded-md border border-gray-200 hover:bg-gray-50 text-primary-700"><Pencil size={14} /></button>}
      {!ar && <button onClick={() => remove(inv)} title="Delete" className="p-1.5 rounded-md text-gray-400 hover:text-red-600 hover:bg-red-50"><Trash2 size={14} /></button>}
    </div>
  );

  if (loading) return <div className="flex items-center justify-center h-64 text-gray-400">Loading…</div>;

  return (
    <div className="space-y-5">
      <div className="flex items-center gap-3 flex-wrap">
        <div>
          <h1 className="text-2xl font-bold text-primary-800">🧾 E-Invoice</h1>
          <p className="text-sm text-gray-500">{INVOICE_CFG.prefix}-YYYY-NNNN sequential numbering · IRD Sri Lanka guidelines</p>
        </div>
        <button onClick={() => { resetForm(); setTab('new'); }} className="btn-primary ml-auto"><Plus size={16} /> New Invoice</button>
      </div>

      {setupNeeded && (
        <div className="bg-red-50 border border-red-200 text-red-700 rounded-lg p-3 text-sm">
          The database update for E-Invoice has not been applied yet (bank accounts / signature tables missing). Run <code>database/2026-10-18_e_invoice_migration.sql</code> in Supabase.
        </div>
      )}

      {/* Stats */}
      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-3">
        {[
          ['Total Invoices', stats.count, 'text-primary-700'],
          ['Total Billed', fmtRs(stats.billed), 'text-primary-700'],
          ['💰 Received (Paid)', fmtRs(stats.paid), 'text-green-700'],
          ['⏳ Outstanding', fmtRs(stats.outstanding), 'text-red-600'],
          ['📝 Draft', stats.drafts, 'text-gray-600'],
          ['📤 Sent / Unpaid', stats.sentCount, 'text-blue-700'],
        ].map(([l, val, cls]) => (
          <div key={l} className="card p-3">
            <div className={`text-lg font-black ${cls}`}>{val}</div>
            <div className="text-xs text-gray-500">{l}</div>
          </div>
        ))}
      </div>

      {/* Tabs */}
      <div className="flex gap-1 bg-gray-100 rounded-xl p-1 overflow-x-auto">
        {[
          ['new', editing ? `✏️ Editing ${editing.invoice_no}` : '➕ New Invoice'],
          ['history', `📋 Invoice History (${invoices.length})`],
          ['ar', `💰 Receivable (${stats.sentCount})`],
          ['settings', '⚙️ Bank & Signature'],
        ].map(([id, label]) => (
          <button key={id} onClick={() => setTab(id)}
            className={`flex-1 whitespace-nowrap px-3 py-2 text-sm font-medium rounded-lg transition-colors ${tab === id ? 'bg-white text-primary-700 shadow-sm' : 'text-gray-500 hover:text-gray-700'}`}>
            {label}
          </button>
        ))}
      </div>

      {/* ═════ NEW / EDIT ═════ */}
      {tab === 'new' && (
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-5">
          <div className="lg:col-span-2 space-y-4">
            {editing && (
              <div className="flex items-center gap-3 bg-amber-50 border border-amber-200 rounded-lg px-4 py-2 text-sm text-amber-800">
                ✏️ Editing <strong>{editing.invoice_no}</strong> — the same invoice number is kept.
                <button onClick={resetForm} className="ml-auto text-xs px-3 py-1 rounded-md bg-white border border-amber-300 hover:bg-amber-100">✕ Cancel edit</button>
              </div>
            )}

            {/* 1 Details */}
            <div className="card p-5">
              <Step n="1">Invoice Details</Step>
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                <div>
                  <Label>Invoice Number</Label>
                  <div className="input bg-gray-50 font-mono font-bold text-primary-700">{displayNo}</div>
                  <div className="text-[11px] text-gray-400 mt-0.5">{editing ? 'Kept on edit' : 'Auto-generated · sequential'}</div>
                </div>
                <div>
                  <Label>Invoice Date *</Label>
                  <input type="date" className="input" value={form.issue_date} onChange={e => set({ issue_date: e.target.value })} />
                </div>
                <div>
                  <Label>Due Date</Label>
                  <input type="date" className="input" value={form.due_date} onChange={e => set({ due_date: e.target.value })} />
                </div>
              </div>
            </div>

            {/* 2 Client */}
            <div className="card p-5">
              <Step n="2">Client Details</Step>
              <Label>Load from Client Database</Label>
              <select className="input mb-3" value={form.client_id} onChange={e => pickClient(e.target.value)}>
                <option value="">— Select Client (or type details below) —</option>
                {clients.map(c => <option key={c.id} value={c.id}>{c.full_name}{c.tin ? ` | TIN: ${c.tin}` : ''}</option>)}
              </select>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <Field label="Client Name *" value={form.client.name} onChange={v => setClient({ name: v })} />
                <Field label="TIN Number" value={form.client.tin} onChange={v => setClient({ tin: v })} />
                <Field label="NIC / Passport" value={form.client.nic} onChange={v => setClient({ nic: v })} />
                <Field label="Phone / WhatsApp" value={form.client.phone} onChange={v => setClient({ phone: v })} />
                <Field label="Email" value={form.client.email} onChange={v => setClient({ email: v })} />
                <Field label="Address" value={form.client.address} onChange={v => setClient({ address: v })} />
              </div>
            </div>

            {/* 3 Items */}
            <div className="card p-5">
              <Step n="3">Services &amp; Items</Step>
              <Label>⚡ Quick Add from Service Catalog</Label>
              <div className="flex flex-wrap gap-1.5 mb-4">
                {INVOICE_CFG.catalog.map(s => (
                  <button key={s.name} type="button" onClick={() => addItem(s.name, s.price)}
                    className="px-3 py-1 rounded-full text-xs font-semibold border border-primary-200 bg-primary-50 text-primary-700 hover:bg-primary-600 hover:text-white transition-colors">
                    {s.name} <span className="opacity-70">Rs.{s.price / 1000}k</span>
                  </button>
                ))}
              </div>
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="text-xs text-gray-500 border-b border-gray-100">
                      <th className="text-left py-2 pr-2">Description</th>
                      <th className="w-16 text-center">Qty</th>
                      <th className="w-28 text-right">Unit Price (Rs.)</th>
                      <th className="w-16 text-center">Disc %</th>
                      <th className="w-28 text-right">Amount (Rs.)</th>
                      <th className="w-8" />
                    </tr>
                  </thead>
                  <tbody>
                    {form.items.length === 0 ? (
                      <tr><td colSpan={6} className="text-center text-xs text-gray-400 py-6">Click a service above or add a custom row ↓</td></tr>
                    ) : form.items.map((it, i) => (
                      <tr key={i} className="border-b border-gray-50">
                        <td className="py-1.5 pr-2"><input className="input py-1.5" placeholder="Description" value={it.description} onChange={e => updItem(i, { description: e.target.value })} /></td>
                        <td className="px-1"><input type="number" min="1" className="input py-1.5 text-center" value={it.quantity} onChange={e => updItem(i, { quantity: e.target.value })} /></td>
                        <td className="px-1"><input type="number" min="0" step="100" className="input py-1.5 text-right" value={it.unit_price} onChange={e => updItem(i, { unit_price: e.target.value })} /></td>
                        <td className="px-1"><input type="number" min="0" max="100" className="input py-1.5 text-center" value={it.discount_pct} onChange={e => updItem(i, { discount_pct: e.target.value })} /></td>
                        <td className="text-right font-semibold text-primary-700 whitespace-nowrap">{fmtRs(itemAmount(it))}</td>
                        <td className="text-center"><button type="button" onClick={() => delItem(i)} className="text-gray-300 hover:text-red-500"><Trash2 size={14} /></button></td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <button type="button" onClick={() => addItem()} className="mt-2 text-sm text-primary-600 hover:underline">＋ Add Custom Item / Service</button>

              <div className="mt-4 ml-auto max-w-xs space-y-1.5 text-sm">
                <div className="flex justify-between"><span className="text-gray-500">Subtotal (after item discounts)</span><span className="font-semibold">{fmtRs(totals.subtotal)}</span></div>
                <div className="flex justify-between items-center gap-2">
                  <span className="text-gray-500">Additional Discount</span>
                  <span className="flex items-center gap-1"><input type="number" min="0" max="100" className="input py-1 w-16 text-center" value={form.discount_pct} onChange={e => set({ discount_pct: e.target.value })} />%</span>
                  <span className="text-green-700 w-24 text-right">{totals.discount_amt > 0 ? `− ${fmtRs(totals.discount_amt)}` : '—'}</span>
                </div>
                <div className="flex justify-between border-t border-gray-200 pt-2 text-base font-black text-primary-800"><span>💰 Total Amount</span><span>{fmtRs(totals.total)}</span></div>
              </div>
            </div>

            {/* 4 Notes & signature */}
            <div className="card p-5">
              <Step n="4">Notes &amp; E-Signature</Step>
              <Label>Payment Instructions / Notes</Label>
              <textarea className="input resize-none mb-4" rows={3} placeholder={INVOICE_CFG.defaultNote} value={form.notes} onChange={e => set({ notes: e.target.value })} />
              <div className="flex items-center gap-2 mb-2">
                <Label className="mb-0">Authorized Signature</Label>
                <div className="ml-auto flex rounded-lg overflow-hidden border border-gray-200 text-xs">
                  <button type="button" onClick={() => set({ sigMode: 'draw' })} className={`px-3 py-1.5 ${form.sigMode === 'draw' ? 'bg-primary-600 text-white' : 'bg-white text-gray-600'}`}>✏️ Draw</button>
                  <button type="button" onClick={() => set({ sigMode: 'image' })} className={`px-3 py-1.5 ${form.sigMode === 'image' ? 'bg-primary-600 text-white' : 'bg-white text-gray-600'}`}>🖼️ Use Saved Image</button>
                </div>
              </div>
              {form.sigMode === 'draw' ? (
                <SignaturePad key={formKey} value={form.signature} onChange={sig => set({ signature: sig })} />
              ) : firmSig ? (
                <div className="border rounded-lg p-3 text-center bg-gray-50">
                  <img src={firmSig} alt="Saved signature" className="max-h-16 mx-auto" />
                  <div className="text-xs text-green-700 font-semibold mt-1">✅ Saved firm signature will be used on this invoice</div>
                </div>
              ) : (
                <div className="border border-amber-200 bg-amber-50 rounded-lg p-3 text-xs text-amber-800">
                  ⚠️ No signature image saved yet. <button className="underline font-semibold" onClick={() => setTab('settings')}>Bank &amp; Signature → upload one</button>.
                </div>
              )}
            </div>

            {/* 5 Bank */}
            <div className="card p-5">
              <Step n="5">🏦 Payment Bank Account</Step>
              <select className="input" value={form.bank_account_id} onChange={e => set({ bank_account_id: e.target.value })}>
                <option value="">— No bank / Enter instructions in Notes manually —</option>
                {banks.map(b => <option key={b.id} value={b.id}>{b.bank_name} — {b.account_no}{b.is_default ? ' (Default)' : ''}</option>)}
              </select>
              {bankById(form.bank_account_id) ? (
                <div className="mt-3 bg-primary-50 border-l-4 border-primary-600 rounded p-3 text-sm">
                  <div className="text-xs font-semibold text-primary-700 mb-1">💳 Bank Transfer Details (will appear on printed invoice)</div>
                  <div><strong>{bankById(form.bank_account_id).bank_name}</strong>{bankById(form.bank_account_id).branch ? ` · ${bankById(form.bank_account_id).branch}` : ''}</div>
                  <div>Account Name: <strong>{bankById(form.bank_account_id).account_name || '—'}</strong></div>
                  <div>Account No: <strong className="text-primary-700 text-base">{bankById(form.bank_account_id).account_no}</strong></div>
                </div>
              ) : (
                <p className="text-xs text-gray-400 mt-2">Add or manage bank accounts in <button className="underline" onClick={() => setTab('settings')}>Bank &amp; Signature</button>.</p>
              )}
            </div>
          </div>

          {/* Summary / actions */}
          <div className="space-y-4 lg:sticky lg:top-4 self-start">
            <div className="card overflow-hidden">
              <div className="bg-primary-700 text-white px-5 py-4">
                <div className="font-mono text-sm opacity-80">{displayNo}</div>
                <div className="text-3xl font-black mt-1">{fmtRs(totals.total)}</div>
                <div className="text-sm opacity-90 mt-1 truncate">{form.client.name || 'No client selected'}</div>
                <div className="text-xs opacity-70">{form.items.length} item{form.items.length !== 1 ? 's' : ''}</div>
              </div>
              <div className="p-4 space-y-2">
                <button onClick={save} disabled={saving} className="btn-primary w-full justify-center"><Save size={15} /> {saving ? 'Saving…' : editing ? 'Update Invoice' : 'Save Invoice'}</button>
                <button onClick={preview} className="btn-secondary w-full justify-center"><Printer size={15} /> Preview &amp; Print</button>
                <button onClick={resetForm} className="w-full px-4 py-2 text-sm rounded-lg border border-gray-200 text-gray-600 hover:bg-gray-50 flex items-center justify-center gap-2"><RotateCcw size={14} /> New Invoice (Reset)</button>
                {!editing && <p className="text-xs text-gray-400">New invoices are saved as <strong>Draft</strong>. Mark them <strong>Sent</strong> when you send to the client — clients see invoices on their portal only after that.</p>}
              </div>
            </div>
            <div className="card p-4 text-xs text-gray-600 space-y-1">
              <div className="font-semibold text-primary-700 text-sm mb-1">🏢 Seller (Our Details)</div>
              <div className="font-semibold">{FIRM.name}</div>
              <div>📧 {FIRM.email}</div>
              <div>📱 {FIRM.phone}</div>
              <div>🌐 {FIRM.web}</div>
              {FIRM.facebook && <div>📘 {FIRM.facebook}</div>}
              <a href="/admin/settings" className="text-primary-600 underline">Edit in Settings</a>
            </div>
          </div>
        </div>
      )}

      {/* ═════ HISTORY ═════ */}
      {tab === 'history' && (
        <div className="card overflow-hidden">
          <div className="card-header flex-wrap gap-2">
            <Receipt size={16} /> Invoice History &amp; Sales Report
            <span className="text-xs text-gray-400 font-normal">Showing {filtered.length} of {invoices.length}</span>
            <div className="ml-auto flex flex-wrap gap-2 items-center">
              <div className="relative">
                <Search size={14} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-gray-400" />
                <input className="input py-1.5 pl-8 text-sm w-48" placeholder="Client, TIN, invoice no." value={fSearch} onChange={e => setFSearch(e.target.value)} />
              </div>
              <select className="input py-1.5 text-sm w-36" value={fStatus} onChange={e => setFStatus(e.target.value)}>
                <option value="all">All Statuses</option><option value="draft">📝 Draft</option><option value="sent">📤 Sent (Unpaid)</option><option value="paid">✅ Paid</option>
              </select>
              <input type="date" className="input py-1.5 text-sm w-36" value={fFrom} onChange={e => setFFrom(e.target.value)} title="From date" />
              <input type="date" className="input py-1.5 text-sm w-36" value={fTo} onChange={e => setFTo(e.target.value)} title="To date" />
              <button onClick={() => { setFStatus('all'); setFFrom(''); setFTo(''); setFSearch(''); }} className="text-xs text-gray-500 hover:underline">✕ Clear</button>
              <button onClick={() => exportInvoicesCSV(filtered, banks)} className="btn-secondary text-xs py-1.5"><Download size={13} /> Export CSV</button>
            </div>
          </div>
          {filtered.length === 0 ? (
            <div className="p-12 text-center text-gray-400 text-sm">{invoices.length ? 'No invoices match the current filter.' : 'No invoices yet. Create your first invoice.'}</div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full">
                <thead className="bg-gray-50 border-b border-gray-100">
                  <tr>
                    <th className="table-th">Invoice No.</th><th className="table-th">Date</th><th className="table-th">Due Date</th>
                    <th className="table-th">Client</th><th className="table-th text-right">Amount</th><th className="table-th">Status</th><th className="table-th text-right">Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-50">
                  {filtered.map(inv => {
                    const c = billTo(inv), od = isOverdue(inv), bk = bankById(inv.bank_account_id);
                    return (
                      <tr key={inv.id} className={inv.status === 'paid' ? 'bg-green-50/40' : od ? 'bg-red-50/50' : 'hover:bg-gray-50'}>
                        <td className="table-td"><div className="font-mono text-xs font-bold text-primary-700">{inv.invoice_no}</div>{inv.updated_at && <div className="text-[10px] text-gray-400">✏ edited</div>}</td>
                        <td className="table-td text-xs text-gray-600">{fmtDate(inv.issue_date)}</td>
                        <td className="table-td text-xs text-gray-600">{inv.due_date ? fmtDate(inv.due_date) : '—'}{od && <div className="text-[10px] font-bold text-red-600">OVERDUE</div>}</td>
                        <td className="table-td"><div className="text-sm font-semibold">{c.name || '—'}</div>{c.tin && <div className="text-xs text-gray-400">TIN: {c.tin}</div>}{bk && <div className="text-xs text-gray-400">🏦 {bk.bank_name}</div>}</td>
                        <td className="table-td text-right font-bold text-primary-700 whitespace-nowrap">{fmtRs(inv.total_amount)}</td>
                        <td className="table-td"><StatusBadge inv={inv} /></td>
                        <td className="table-td">{actionButtons(inv)}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

      {/* ═════ RECEIVABLE ═════ */}
      {tab === 'ar' && (
        <div className="space-y-4">
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            {[
              ['Total Outstanding', fmtRs(stats.outstanding), 'text-red-600'],
              ['Invoices Pending', stats.sentCount, 'text-primary-700'],
              ['⚠️ Overdue Amount', fmtRs(stats.overdueAmt), 'text-red-700'],
              ['⚠️ Overdue Invoices', stats.overdueCount, 'text-red-700'],
            ].map(([l, val, cls]) => <div key={l} className="card p-3"><div className={`text-lg font-black ${cls}`}>{val}</div><div className="text-xs text-gray-500">{l}</div></div>)}
          </div>
          <div className="card overflow-hidden">
            <div className="card-header">💰 Accounts Receivable — Outstanding Invoices</div>
            {stats.sent.length === 0 ? (
              <div className="p-10 text-center text-green-700 font-semibold text-sm">✅ No outstanding invoices — all payments received!</div>
            ) : (
              <table className="w-full">
                <thead className="bg-gray-50 border-b border-gray-100"><tr>
                  <th className="table-th">Invoice No.</th><th className="table-th">Client</th><th className="table-th">Invoice Date</th><th className="table-th">Due Date</th><th className="table-th text-right">Amount</th><th className="table-th text-right">Actions</th>
                </tr></thead>
                <tbody className="divide-y divide-gray-50">
                  {[...stats.sent].sort((a, b) => (a.due_date || '').localeCompare(b.due_date || '')).map(inv => {
                    const c = billTo(inv), od = isOverdue(inv);
                    const days = od ? Math.ceil((new Date(todayISO()) - new Date(inv.due_date)) / 86400000) : 0;
                    return (
                      <tr key={inv.id} className={od ? 'bg-red-50/50' : ''}>
                        <td className="table-td font-mono text-xs font-bold text-primary-700">{inv.invoice_no}</td>
                        <td className="table-td"><div className="text-sm font-semibold">{c.name}</div>{c.tin && <div className="text-xs text-gray-400">TIN: {c.tin}</div>}</td>
                        <td className="table-td text-xs">{fmtDate(inv.issue_date)}</td>
                        <td className="table-td text-xs">{inv.due_date ? fmtDate(inv.due_date) : '—'}{od && <span className="ml-1 text-[10px] font-bold text-red-600">({days}d overdue)</span>}</td>
                        <td className={`table-td text-right font-bold whitespace-nowrap ${od ? 'text-red-600' : 'text-primary-700'}`}>{fmtRs(inv.total_amount)}</td>
                        <td className="table-td">{actionButtons(inv, { ar: true })}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            )}
          </div>
        </div>
      )}

      {/* ═════ SETTINGS ═════ */}
      {tab === 'settings' && <InvoiceSettings banks={banks} firmSig={firmSig} reload={loadAll} />}
    </div>
  );
}

// ─── Bank accounts + signature image ─────────────────────
export function InvoiceSettings({ banks, firmSig, reload }) {
  const [nb, setNb] = useState({ bank_name: '', account_name: 'TaxMate Solutions', account_no: '', branch: '' });
  const [busy, setBusy] = useState(false);

  const addBank = async (e) => {
    e.preventDefault();
    if (!nb.bank_name.trim() || !nb.account_no.trim()) return toast.error('Bank name and account number are required');
    setBusy(true);
    const { error } = await supabase.from('bank_accounts').insert({ ...nb, is_default: banks.length === 0 });
    setBusy(false);
    if (error) return toast.error(error.message);
    setNb({ bank_name: '', account_name: 'TaxMate Solutions', account_no: '', branch: '' });
    toast.success('Bank account added');
    reload();
  };
  const setDefault = async (id) => {
    await supabase.from('bank_accounts').update({ is_default: false }).neq('id', id);
    const { error } = await supabase.from('bank_accounts').update({ is_default: true }).eq('id', id);
    if (error) return toast.error(error.message);
    reload();
  };
  const delBank = async (b) => {
    if (!window.confirm(`Delete bank account ${b.bank_name} — ${b.account_no}?`)) return;
    const { error } = await supabase.from('bank_accounts').delete().eq('id', b.id);
    if (error) return toast.error(error.message);
    reload();
  };

  // Downscale the uploaded signature so it stays small in the database
  const uploadSig = (file) => {
    if (!file) return;
    if (file.size > 2 * 1024 * 1024) return toast.error('File too large (max 2 MB)');
    const reader = new FileReader();
    reader.onload = () => {
      const img = new Image();
      img.onload = async () => {
        const s = Math.min(1, 600 / img.width, 220 / img.height);
        const cv = document.createElement('canvas');
        cv.width = Math.round(img.width * s); cv.height = Math.round(img.height * s);
        cv.getContext('2d').drawImage(img, 0, 0, cv.width, cv.height);
        const dataUrl = cv.toDataURL('image/png');
        const { error } = await supabase.from('app_settings').upsert({ key: 'firm_signature', value: { image: dataUrl }, updated_at: new Date().toISOString() });
        if (error) return toast.error(error.message);
        toast.success('Signature image saved — choose "Use Saved Image" on invoices');
        reload();
      };
      img.src = reader.result;
    };
    reader.readAsDataURL(file);
  };
  const delSig = async () => {
    if (!window.confirm('Remove the saved signature image?')) return;
    const { error } = await supabase.from('app_settings').delete().eq('key', 'firm_signature');
    if (error) return toast.error(error.message);
    reload();
  };

  return (
    <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
      <div className="card overflow-hidden">
        <div className="card-header"><Building2 size={16} /> Bank Accounts</div>
        <div className="p-5 space-y-4">
          <p className="text-xs text-gray-500">Select a bank account when creating an invoice — it prints as payment instructions.</p>
          {banks.length === 0 ? <div className="text-sm text-gray-400 text-center py-4">No bank accounts added yet.</div> : (
            <div className="divide-y divide-gray-100 border rounded-lg">
              {banks.map(b => (
                <div key={b.id} className="flex items-center gap-3 px-3 py-2">
                  <div className="flex-1 text-sm">
                    <div className="font-semibold">{b.bank_name}{b.branch ? ` · ${b.branch}` : ''} {b.is_default && <span className="ml-1 text-xs px-1.5 py-0.5 rounded bg-green-100 text-green-700">Default</span>}</div>
                    <div className="text-xs text-gray-500">{b.account_name || '—'} · <span className="font-mono font-semibold text-primary-700">{b.account_no}</span></div>
                  </div>
                  {!b.is_default && <button onClick={() => setDefault(b.id)} className="text-xs text-primary-600 hover:underline flex items-center gap-1"><Star size={12} /> Set default</button>}
                  <button onClick={() => delBank(b)} className="text-gray-300 hover:text-red-500"><Trash2 size={14} /></button>
                </div>
              ))}
            </div>
          )}
          <form onSubmit={addBank} className="grid grid-cols-1 sm:grid-cols-2 gap-2 border-t pt-4">
            <Field label="Bank Name *" value={nb.bank_name} onChange={v => setNb({ ...nb, bank_name: v })} placeholder="e.g. Bank of Ceylon" />
            <Field label="Branch" value={nb.branch} onChange={v => setNb({ ...nb, branch: v })} />
            <Field label="Account Name" value={nb.account_name} onChange={v => setNb({ ...nb, account_name: v })} />
            <Field label="Account No *" value={nb.account_no} onChange={v => setNb({ ...nb, account_no: v })} />
            <button type="submit" disabled={busy} className="btn-primary sm:col-span-2 justify-center"><Plus size={15} /> Add Bank Account</button>
          </form>
        </div>
      </div>

      <div className="card overflow-hidden">
        <div className="card-header"><PenTool size={16} /> Signature / Stamp Image</div>
        <div className="p-5 space-y-3">
          <p className="text-xs text-gray-500">Upload your signature or company stamp once, then pick <strong>Use Saved Image</strong> on any invoice. PNG with a transparent background prints best. Max 2 MB.</p>
          {firmSig ? (
            <div className="border rounded-lg p-4 text-center bg-gray-50">
              <img src={firmSig} alt="Saved signature" className="max-h-20 mx-auto" />
              <button onClick={delSig} className="mt-2 text-xs text-red-500 hover:underline">Remove image</button>
            </div>
          ) : <div className="text-sm text-gray-400 text-center py-4 border border-dashed rounded-lg">No signature image saved yet.</div>}
          <label className="btn-secondary justify-center cursor-pointer">
            📁 {firmSig ? 'Replace' : 'Upload'} Signature / Stamp Image
            <input type="file" accept="image/png,image/jpeg,image/webp" className="hidden" onChange={e => { uploadSig(e.target.files?.[0]); e.target.value = ''; }} />
          </label>
        </div>
      </div>
    </div>
  );
}

// ─── small UI helpers ────────────────────────────────────
function Step({ n, children }) {
  return (
    <div className="flex items-center gap-2 text-sm font-bold text-primary-700 border-b border-gray-100 pb-2 mb-3">
      <span className="w-6 h-6 rounded-full bg-primary-600 text-white text-xs flex items-center justify-center">{n}</span>{children}
    </div>
  );
}
function Label({ children, className = '' }) {
  return <label className={`block text-xs font-semibold text-gray-500 mb-1 ${className}`}>{children}</label>;
}
function Field({ label, value, onChange, placeholder }) {
  return (
    <div>
      <Label>{label}</Label>
      <input className="input" value={value} placeholder={placeholder} onChange={e => onChange(e.target.value)} />
    </div>
  );
}
