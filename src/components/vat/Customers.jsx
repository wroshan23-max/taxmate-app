// V64 — customers, balances and customer statements (ledger)
import { useEffect, useMemo, useState } from 'react';
import toast from 'react-hot-toast';
import { Users, Plus, Search, Pencil, FileText, Download, Printer, ArrowLeft, Wallet } from 'lucide-react';
import { saveCustomer, customerLedger } from '../../lib/vat/api';
import { rs, money, dmy, slToday } from '../../lib/vat/format';
import { AGING as AGING_LABELS } from '../../lib/vat/stats';
import { downloadXlsx } from '../../lib/xlsx';
import { Modal, Field, Empty, Badge, downloadCsv, Spinner } from './ui';
import PaymentForm from './PaymentForm';

const blank = { kind: 'business', name: '', company_name: '', tin: '', vat_registered: false, vat_no: '', address: '', phone: '', email: '', contact_person: '', credit_limit: '', terms_days: '', opening_balance: '', opening_date: '', status: 'active', notes: '' };

export default function Customers({ app }) {
  const { data, nav, go, can } = app;
  const [q, setQ] = useState('');
  const [edit, setEdit] = useState(null);
  const [show, setShow] = useState('active');
  const balances = useMemo(() => {
    const m = {};
    for (const d of data.docs) {
      if (d.status !== 'issued' || !d.customer_id || !(d.doc_type === 'tax' || d.doc_type === 'nontax')) continue;
      const x = (m[d.customer_id] ||= { bal: 0, overdue: 0, n: 0 });
      x.bal += Number(d.balance); x.n += 1;
      if (Number(d.balance) > 0 && d.due_date && d.due_date < slToday()) x.overdue += Number(d.balance);
    }
    return m;
  }, [data.docs]);
  if (nav.c) return <Statement app={app} customerId={nav.c} onBack={() => go('customers')} />;
  const list = data.customers.filter((c) => (show === 'all' || c.status === show) && (!q || [c.name, c.company_name, c.tin, c.email, c.phone].filter(Boolean).join(' ').toLowerCase().includes(q.toLowerCase())));

  return (
    <div className="space-y-3">
      <div className="card flex flex-wrap items-center gap-2 p-3">
        <div className="relative min-w-[200px] flex-1"><Search size={14} className="absolute left-2.5 top-2.5 text-gray-400" /><input className="input pl-8" placeholder="Name, TIN, email, phone…" value={q} onChange={(e) => setQ(e.target.value)} /></div>
        <select className="input w-auto py-1.5" value={show} onChange={(e) => setShow(e.target.value)} aria-label="Show"><option value="active">Active</option><option value="inactive">Inactive</option><option value="all">All</option></select>
        {can('customers') && <button type="button" className="btn-primary px-3 py-1.5 text-sm" onClick={() => setEdit(blank)}><Plus size={14} /> Customer</button>}
      </div>
      {list.length === 0 ? <Empty icon={Users} title="No customers yet">Add the businesses and people you invoice. VAT-registered customers need TIN and address for tax invoices.</Empty> : (
        <div className="card overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-gray-50"><tr><th className="table-th">Customer</th><th className="table-th hidden sm:table-cell">TIN</th><th className="table-th hidden md:table-cell">Contact</th><th className="table-th text-right">Outstanding</th><th className="table-th" /></tr></thead>
            <tbody className="divide-y divide-gray-50">
              {list.map((c) => { const b = balances[c.id] || { bal: 0, overdue: 0 }; return (
                <tr key={c.id} className="cursor-pointer hover:bg-primary-50/40" onClick={() => go('customers', { c: c.id })}>
                  <td className="table-td"><div className="font-semibold">{c.name}</div><div className="flex gap-1 text-[11px] text-gray-500">{c.vat_registered && <Badge>VAT</Badge>}{c.kind === 'individual' ? 'Individual' : c.company_name}</div></td>
                  <td className="table-td hidden font-mono text-xs sm:table-cell">{c.tin || '—'}</td>
                  <td className="table-td hidden text-xs text-gray-600 md:table-cell">{c.phone}{c.email && <div>{c.email}</div>}</td>
                  <td className="table-td text-right tabular-nums">{rs(b.bal + Number(c.opening_balance || 0))}{b.overdue > 0 && <div className="text-[11px] font-semibold text-red-600">overdue {rs(b.overdue)}</div>}</td>
                  <td className="table-td text-right">{can('customers') && <button type="button" className="p-1 text-gray-400 hover:text-primary-700" onClick={(e) => { e.stopPropagation(); setEdit({ ...blank, ...Object.fromEntries(Object.entries(c).map(([k, v]) => [k, v ?? ''])) }); }} aria-label="Edit"><Pencil size={14} /></button>}</td>
                </tr>); })}
            </tbody>
          </table>
        </div>
      )}
      {edit && <CustomerForm app={app} value={edit} onClose={() => setEdit(null)} />}
    </div>
  );
}

export function CustomerForm({ app, value, onClose }) {
  const { clientId, reload } = app;
  const [f, setF] = useState(value);
  const [busy, setBusy] = useState(false);
  const s = (k) => (e) => setF({ ...f, [k]: e.target.type === 'checkbox' ? e.target.checked : e.target.value });
  const save = async () => {
    setBusy(true);
    try { await saveCustomer(clientId, f); toast.success('Customer saved'); await reload(['customers']); onClose(); } catch (e) { toast.error(e.message); } finally { setBusy(false); }
  };
  return (
    <Modal title={f.id ? 'Edit customer' : 'New customer'} onClose={onClose} wide footer={<><button type="button" className="btn-secondary border text-sm" onClick={onClose}>Cancel</button><button type="button" disabled={busy || !f.name.trim()} className="btn-primary text-sm" onClick={save}>Save</button></>}>
      <div className="grid gap-2 sm:grid-cols-3">
        <Field label="Type"><select className="input" value={f.kind} onChange={s('kind')}><option value="business">Business</option><option value="individual">Individual</option></select></Field>
        <Field label="Name" className="sm:col-span-2"><input className="input" value={f.name} onChange={s('name')} autoFocus /></Field>
        <Field label="Company name"><input className="input" value={f.company_name} onChange={s('company_name')} /></Field>
        <Field label="TIN (9 digits)"><input className="input" inputMode="numeric" maxLength={9} value={f.tin} onChange={(e) => setF({ ...f, tin: e.target.value.replace(/\D/g, '') })} /></Field>
        <Field label="VAT number"><input className="input" value={f.vat_no} onChange={s('vat_no')} /></Field>
        <label className="flex items-center gap-2 text-sm sm:col-span-3"><input type="checkbox" checked={!!f.vat_registered} onChange={s('vat_registered')} /> VAT-registered (TIN and address are printed on tax invoices; they can claim input VAT)</label>
        <Field label="Address" className="sm:col-span-3"><input className="input" value={f.address} onChange={s('address')} /></Field>
        <Field label="Telephone / WhatsApp"><input className="input" value={f.phone} onChange={s('phone')} /></Field>
        <Field label="Email"><input className="input" type="email" value={f.email} onChange={s('email')} /></Field>
        <Field label="Contact person"><input className="input" value={f.contact_person} onChange={s('contact_person')} /></Field>
        <Field label="Payment terms (days)"><input className="input" inputMode="numeric" value={f.terms_days} onChange={(e) => setF({ ...f, terms_days: e.target.value.replace(/\D/g, '') })} placeholder="default" /></Field>
        <Field label="Credit limit (Rs.)"><input className="input" inputMode="decimal" value={f.credit_limit} onChange={(e) => setF({ ...f, credit_limit: e.target.value.replace(/[^\d.]/g, '') })} /></Field>
        <Field label="Status"><select className="input" value={f.status} onChange={s('status')}><option value="active">Active</option><option value="inactive">Inactive</option></select></Field>
        <Field label="Opening balance (Rs.)" hint="Owed before you started using TaxMate."><input className="input" inputMode="decimal" value={f.opening_balance} onChange={(e) => setF({ ...f, opening_balance: e.target.value.replace(/[^\d.-]/g, '') })} /></Field>
        <Field label="Opening balance date"><input type="date" className="input" value={f.opening_date || ''} onChange={s('opening_date')} /></Field>
        <Field label="Notes" className="sm:col-span-3"><input className="input" value={f.notes} onChange={s('notes')} /></Field>
      </div>
    </Modal>
  );
}

function Statement({ app, customerId, onBack }) {
  const { clientId, data, openDoc, can } = app;
  const c = data.customers.find((x) => x.id === customerId);
  const [from, setFrom] = useState('');
  const [to, setTo] = useState(slToday());
  const [led, setLed] = useState(null);
  const [pay, setPay] = useState(false);
  const load = () => customerLedger(clientId, customerId, from || null, to || null).then(setLed).catch((e) => toast.error(e.message));
  useEffect(() => { load(); }, [customerId, from, to]); // eslint-disable-line react-hooks/exhaustive-deps
  if (!led) return <Spinner />;
  let run = Number(led.opening);
  const rows = led.rows.map((r) => { run += Number(r.amount); return { ...r, run }; });
  const sheet = () => [['Date', 'Type', 'Number', 'Details', 'Debit', 'Credit', 'Balance'], ['', '', '', 'Opening balance', '', '', Number(led.opening)],
    ...rows.map((r) => [r.date, r.kind, r.no, r.label, Number(r.amount) > 0 ? Number(r.amount) : '', Number(r.amount) < 0 ? -Number(r.amount) : '', r.run])];
  const printIt = () => {
    const w = window.open('', '_blank');
    const st = data.settings || {};
    const html = `<!doctype html><html><head><meta charset="utf-8"><title>Statement ${c?.name || ''}</title><style>body{font:12px Arial;margin:24px}table{width:100%;border-collapse:collapse}th,td{padding:4px 6px;border-bottom:1px solid #ddd;text-align:left}td.r,th.r{text-align:right}h1{font-size:18px;margin:0}@media print{button{display:none}}</style></head><body>
      <button onclick="print()">Print / Save as PDF</button><h1>${(st.legal_name || '').replace(/</g, '&lt;')}</h1><div>${(st.address || '').replace(/</g, '&lt;')}${st.tin ? ` · TIN ${st.tin}` : ''}</div>
      <h2>Customer statement — ${(c?.name || '').replace(/</g, '&lt;')}</h2><div>${from ? dmy(from) : 'From the start'} to ${dmy(to)}</div>
      <table><tr><th>Date</th><th>Number</th><th>Details</th><th class="r">Debit</th><th class="r">Credit</th><th class="r">Balance</th></tr>
      <tr><td></td><td></td><td>Opening balance</td><td></td><td></td><td class="r">${money(led.opening)}</td></tr>
      ${rows.map((r) => `<tr><td>${dmy(r.date)}</td><td>${r.no || ''}</td><td>${String(r.label).replace(/</g, '&lt;')}</td><td class="r">${r.amount > 0 ? money(r.amount) : ''}</td><td class="r">${r.amount < 0 ? money(-r.amount) : ''}</td><td class="r">${money(r.run)}</td></tr>`).join('')}
      <tr><th colspan="5">Closing balance</th><th class="r">${money(led.closing)}</th></tr></table>
      <p>Aging: ${AGING_LABELS.map(([k, l]) => `${l}: ${money(led.aging?.[k])}`).join(' · ')}</p></body></html>`;
    w.document.write(html); w.document.close();
  };
  return (
    <div className="space-y-3">
      <div className="card flex flex-wrap items-center gap-2 p-3">
        <button type="button" onClick={onBack} className="p-1 text-gray-500" aria-label="Back"><ArrowLeft size={18} /></button>
        <div className="min-w-0 flex-1"><div className="font-bold text-primary-800">{c?.name}</div><div className="text-xs text-gray-500">{c?.tin && `TIN ${c.tin} · `}{c?.phone} {c?.email}</div></div>
        <input type="date" className="input w-auto py-1.5" value={from} onChange={(e) => setFrom(e.target.value)} aria-label="From" />
        <input type="date" className="input w-auto py-1.5" value={to} onChange={(e) => setTo(e.target.value)} aria-label="To" />
        <button type="button" className="btn-secondary border px-2 py-1.5 text-xs" onClick={printIt}><Printer size={13} /> PDF</button>
        <button type="button" className="btn-secondary border px-2 py-1.5 text-xs" onClick={() => downloadCsv(`statement-${c?.name || 'customer'}.csv`, sheet())}><Download size={13} /> CSV</button>
        <button type="button" className="btn-secondary border px-2 py-1.5 text-xs" onClick={() => downloadXlsx(`statement-${c?.name || 'customer'}.xlsx`, [{ name: 'Statement', rows: sheet(), freeze: 1, widths: [12, 10, 20, 40, 14, 14, 14] }])}><Download size={13} /> Excel</button>
        {can('payment') && <button type="button" className="btn-primary px-3 py-1.5 text-sm" onClick={() => setPay(true)}><Wallet size={14} /> Payment</button>}
      </div>
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
        <div className="card p-3 text-sm"><div className="text-xs text-gray-500">Opening</div><b>{rs(led.opening)}</b></div>
        <div className="card p-3 text-sm"><div className="text-xs text-gray-500">Closing balance</div><b className={Number(led.closing) > 0 ? 'text-amber-700' : 'text-green-700'}>{rs(led.closing)}</b></div>
        <div className="card p-3 text-sm"><div className="text-xs text-gray-500">Unapplied payments (credit)</div><b>{rs(led.unallocated)}</b></div>
        <div className="card p-3 text-xs">{AGING_LABELS.map(([k, l]) => <div key={k} className="flex justify-between"><span className="text-gray-500">{l}</span><span className="tabular-nums">{money(led.aging?.[k])}</span></div>)}</div>
      </div>
      <div className="card overflow-x-auto">
        <table className="w-full text-xs">
          <thead className="bg-gray-50"><tr><th className="table-th">Date</th><th className="table-th">Number</th><th className="table-th">Details</th><th className="table-th text-right">Debit</th><th className="table-th text-right">Credit</th><th className="table-th text-right">Balance</th></tr></thead>
          <tbody className="divide-y divide-gray-50">
            <tr><td className="table-td" /><td className="table-td" /><td className="table-td font-semibold">Opening balance</td><td className="table-td" /><td className="table-td" /><td className="table-td text-right tabular-nums">{money(led.opening)}</td></tr>
            {rows.map((r) => (
              <tr key={`${r.kind}-${r.id}`} className={r.kind !== 'payment' ? 'cursor-pointer hover:bg-primary-50/40' : ''} onClick={() => r.kind !== 'payment' && openDoc(r.id)}>
                <td className="table-td">{dmy(r.date)}</td><td className="table-td font-mono">{r.no}</td><td className="table-td">{r.label}</td>
                <td className="table-td text-right tabular-nums">{r.amount > 0 ? money(r.amount) : ''}</td><td className="table-td text-right tabular-nums">{r.amount < 0 ? money(-r.amount) : ''}</td><td className="table-td text-right tabular-nums">{money(r.run)}</td>
              </tr>
            ))}
          </tbody>
        </table>
        {rows.length === 0 && <div className="p-6 text-center text-xs text-gray-400"><FileText size={20} className="mx-auto mb-1" />No transactions in this period.</div>}
      </div>
      {pay && <PaymentForm app={app} customerId={customerId} onClose={() => setPay(false)} onDone={() => { setPay(false); load(); app.reload(['docs']); }} />}
    </div>
  );
}
