// V64 — list of invoices / notes with search, filters and export
import { useMemo, useState } from 'react';
import { Search, FileText, Download, Plus, Lock } from 'lucide-react';
import { rs, dmy, slToday, DOC_TYPES, RAMIS, PAY, DOC_STATUS } from '../../lib/vat/format';
import { downloadXlsx } from '../../lib/xlsx';
import { t } from '../../lib/vat/i18n';
import { Badge, Empty, downloadCsv } from './ui';

const RAMIS_FILTER = [['', 'Any RAMIS status'], ['draft', 'RAMIS off'], ['ready', 'Ready'], ['pending', 'Queued / submitting'], ['submitted', 'Submitted'], ['accepted', 'Accepted / locked'], ['rejected', 'Rejected'], ['failed', 'Failed']];
const PAY_FILTER = [['', 'Any payment status'], ['open', 'Outstanding'], ['overdue', 'Overdue'], ['unpaid', 'Unpaid'], ['partial', 'Partly paid'], ['paid', 'Paid'], ['overpaid', 'Overpaid'], ['cancelled', 'Cancelled']];

export default function DocList({ app }) {
  const { data, nav, go, openDoc, can } = app;
  const type = nav.type || '';
  const [q, setQ] = useState('');
  const [status, setStatus] = useState('');
  const [pay, setPay] = useState(nav.f || '');
  const [ramis, setRamis] = useState(nav.ramis || '');
  const [cust, setCust] = useState('');
  const [branch, setBranch] = useState('');
  const [from, setFrom] = useState(nav.from || '');
  const [to, setTo] = useState(nav.to || '');
  const [vat, setVat] = useState('');
  const today = slToday();

  const list = useMemo(() => {
    const qq = q.trim().toLowerCase();
    const num = Number(qq.replace(/[, ]/g, ''));
    return data.docs.filter((d) => {
      if (type && d.doc_type !== type) return false;
      if (status && d.status !== status) return false;
      if (vat === 'tax' && !d.is_tax) return false;
      if (vat === 'nontax' && d.is_tax) return false;
      if (pay === 'open' && !(d.status === 'issued' && Number(d.balance) > 0)) return false;
      if (pay === 'overdue' && !(d.status === 'issued' && Number(d.balance) > 0 && d.due_date && d.due_date < today)) return false;
      if (pay && !['open', 'overdue'].includes(pay) && d.pay_status !== pay) return false;
      if (ramis === 'pending' && !['queued', 'submitting', 'validating'].includes(d.ramis_status)) return false;
      if (ramis === 'accepted' && !['accepted', 'locked'].includes(d.ramis_status)) return false;
      if (ramis && !['pending', 'accepted'].includes(ramis) && d.ramis_status !== ramis) return false;
      if (cust && d.customer_id !== cust) return false;
      if (branch && d.branch_id !== branch) return false;
      if (from && d.issue_date < from) return false;
      if (to && d.issue_date > to) return false;
      if (qq) {
        const hay = [d.doc_no, d.customer?.name, d.customer?.tin, d.ramis_ref, d.reason].filter(Boolean).join(' ').toLowerCase();
        if (!hay.includes(qq) && !(num && (Math.abs(Number(d.total) - num) < 0.01 || Math.abs(Number(d.balance) - num) < 0.01))) return false;
      }
      return true;
    });
  }, [data.docs, type, status, pay, ramis, cust, branch, from, to, q, vat, today]);

  const exportRows = () => [
    ['Type', 'Number', 'Status', 'Invoice date', 'Supply date', 'Due date', 'Customer', 'Customer TIN', 'Value excl. VAT', 'VAT', 'Total', 'Credited', 'Debited', 'Paid', 'Balance', 'Payment status', 'RAMIS status', 'RAMIS ref'],
    ...list.map((d) => [DOC_TYPES[d.doc_type]?.short, d.doc_no || 'Draft', d.status, d.issue_date, d.supply_date, d.due_date, d.customer?.name, d.customer?.tin,
      Number(d.net_total), Number(d.vat_total), Number(d.total), Number(d.credited), Number(d.debited), Number(d.paid), Number(d.balance), d.pay_status, d.ramis_status, d.ramis_ref]),
  ];
  const totals = list.filter((d) => d.status === 'issued').reduce((a, d) => {
    const s = d.doc_type === 'credit' ? -1 : 1;
    return { net: a.net + s * Number(d.net_total), vat: a.vat + s * Number(d.vat_total), total: a.total + s * Number(d.total), bal: a.bal + Number(d.balance || 0) };
  }, { net: 0, vat: 0, total: 0, bal: 0 });

  return (
    <div className="space-y-3">
      <div className="card space-y-2 p-3">
        <div className="flex flex-wrap items-center gap-2">
          <div className="text-sm font-bold text-primary-800">{type ? t(`nav.${type}`) : t('nav.all')}</div>
          <div className="relative min-w-[200px] flex-1">
            <Search size={14} className="absolute left-2.5 top-2.5 text-gray-400" />
            <input className="input pl-8" placeholder="Number, customer, TIN, amount, RAMIS ref…" value={q} onChange={(e) => setQ(e.target.value)} />
          </div>
          {can('create') && type !== 'credit' && type !== 'debit' && <button type="button" onClick={() => go('new', { type: type || 'tax' })} className="btn-primary px-3 py-1.5 text-sm"><Plus size={14} /> New</button>}
          {(type === 'credit' || type === 'debit') && <span className="text-[11px] text-gray-500">Create a note from the original invoice (open it → {type === 'credit' ? 'Credit' : 'Debit'} note).</span>}
        </div>
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-4 lg:grid-cols-8">
          <select className="input py-1.5" value={type} onChange={(e) => go('docs', { type: e.target.value || null })} aria-label="Type">
            <option value="">All types</option>{Object.values(DOC_TYPES).map((x) => <option key={x.key} value={x.key}>{x.label()}</option>)}
          </select>
          <select className="input py-1.5" value={status} onChange={(e) => setStatus(e.target.value)} aria-label="Status"><option value="">Any status</option><option value="draft">Draft</option><option value="issued">Issued</option><option value="cancelled">Cancelled</option></select>
          <select className="input py-1.5" value={vat} onChange={(e) => setVat(e.target.value)} aria-label="VAT"><option value="">VAT + non-VAT</option><option value="tax">VAT documents</option><option value="nontax">Non-VAT documents</option></select>
          <select className="input py-1.5" value={pay} onChange={(e) => setPay(e.target.value)} aria-label="Payment status">{PAY_FILTER.map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select>
          <select className="input py-1.5" value={ramis} onChange={(e) => setRamis(e.target.value)} aria-label="RAMIS status">{RAMIS_FILTER.map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select>
          <select className="input py-1.5" value={cust} onChange={(e) => setCust(e.target.value)} aria-label="Customer"><option value="">All customers</option>{data.customers.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</select>
          <input type="date" className="input py-1.5" value={from} onChange={(e) => setFrom(e.target.value)} aria-label="From" />
          <input type="date" className="input py-1.5" value={to} onChange={(e) => setTo(e.target.value)} aria-label="To" />
          {data.branches.length > 0 && <select className="input py-1.5" value={branch} onChange={(e) => setBranch(e.target.value)} aria-label="Branch"><option value="">All branches / codes</option>{data.branches.map((b) => <option key={b.id} value={b.id}>{b.code} — {b.name}</option>)}</select>}
        </div>
        <div className="flex flex-wrap items-center gap-2 text-xs text-gray-500">
          <span>{list.length} document{list.length === 1 ? '' : 's'} · issued total {rs(totals.total)} (VAT {rs(totals.vat)}) · balance {rs(totals.bal)}</span>
          <span className="flex-1" />
          <button type="button" className="inline-flex items-center gap-1 font-semibold text-primary-700" onClick={() => downloadCsv(`vat-documents-${slToday()}.csv`, exportRows())}><Download size={12} /> CSV</button>
          <button type="button" className="inline-flex items-center gap-1 font-semibold text-primary-700" onClick={() => downloadXlsx(`vat-documents-${slToday()}.xlsx`, [{ name: 'Documents', rows: [exportRows()[0].map((h) => ({ v: h, s: 'h' })), ...exportRows().slice(1).map((r) => r.map((c, i) => (i >= 8 && i <= 14 ? { v: c, s: 'm' } : c)))], freeze: 1, widths: [12, 22, 10, 12, 12, 12, 28, 12, 14, 12, 14, 12, 12, 12, 14, 12, 14, 16] }])}><Download size={12} /> Excel</button>
        </div>
      </div>

      {list.length === 0 ? <Empty icon={FileText} title="No documents here">Change the filters, or create a new invoice.</Empty> : (
        <div className="card overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-gray-50"><tr>
                <th className="table-th">Number</th><th className="table-th">Customer</th><th className="table-th hidden md:table-cell">Date</th>
                <th className="table-th text-right">Total</th><th className="table-th text-right hidden sm:table-cell">Balance</th><th className="table-th">Status</th>
              </tr></thead>
              <tbody className="divide-y divide-gray-50">
                {list.slice(0, 500).map((d) => (
                  <tr key={d.id} onClick={() => openDoc(d.id)} className="cursor-pointer hover:bg-primary-50/40">
                    <td className="table-td"><div className="font-mono text-xs font-semibold text-gray-800">{d.doc_no || <span className="text-gray-400">Draft</span>}</div>
                      <div className="text-[11px] text-gray-500">{DOC_TYPES[d.doc_type]?.short}{d.is_tax && d.doc_type !== 'tax' ? ' (VAT)' : ''}</div></td>
                    <td className="table-td"><div className="max-w-[220px] truncate">{d.customer?.name || '—'}</div>{d.customer?.tin && <div className="text-[11px] text-gray-400">TIN {d.customer.tin}</div>}</td>
                    <td className="table-td hidden text-xs text-gray-600 md:table-cell">{dmy(d.issue_date)}{d.due_date && d.doc_type !== 'credit' && d.doc_type !== 'debit' && <div className={`text-[11px] ${d.status === 'issued' && Number(d.balance) > 0 && d.due_date < today ? 'font-semibold text-red-600' : 'text-gray-400'}`}>due {dmy(d.due_date)}</div>}</td>
                    <td className="table-td text-right tabular-nums">{d.doc_type === 'credit' ? '−' : ''}{rs(d.total)}{d.is_tax && <div className="text-[11px] text-gray-400">VAT {rs(d.vat_total)}</div>}</td>
                    <td className="table-td hidden text-right tabular-nums sm:table-cell">{d.doc_type === 'tax' || d.doc_type === 'nontax' ? rs(d.balance) : '—'}</td>
                    <td className="table-td"><div className="flex flex-wrap gap-1">
                      {d.status !== 'issued' && <Badge meta={DOC_STATUS[d.status]} />}
                      {d.status === 'issued' && (d.doc_type === 'tax' || d.doc_type === 'nontax') && <Badge meta={PAY[d.pay_status]} />}
                      {d.is_tax && d.status !== 'draft' && <Badge meta={RAMIS[d.ramis_status]}>{['accepted', 'locked'].includes(d.ramis_status) && <Lock size={10} />}{RAMIS[d.ramis_status]?.label}</Badge>}
                    </div></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {list.length > 500 && <div className="p-2 text-center text-xs text-gray-500">Showing the first 500 — narrow the filters or export to see all.</div>}
        </div>
      )}
    </div>
  );
}
