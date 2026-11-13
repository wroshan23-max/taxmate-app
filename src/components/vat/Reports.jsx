// V64 — reports: invoices, VAT, schedules, RAMIS, payments, aging — CSV / Excel / PDF
import { useEffect, useMemo, useState } from 'react';
import toast from 'react-hot-toast';
import { BarChart3, Download, Printer, ArrowLeft } from 'lucide-react';
import { loadPayments, loadLinesFor, loadPurchases, loadSubmissions, loadScheduleMap } from '../../lib/vat/api';
import { money, dmy, slToday, daysBetween, DOC_TYPES, METHODS, RAMIS, SUB_STATUS, APPROVAL } from '../../lib/vat/format';
import { sign, isInvoice, AGING } from '../../lib/vat/stats';
import { downloadXlsx } from '../../lib/xlsx';
import { PeriodPicker, initialPeriod } from './Ramis';
import { Spinner, downloadCsv } from './ui';

const GROUPS = [
  ['Invoice reports', [['sales', 'Sales invoice report'], ['tax', 'Tax invoice report'], ['nontax', 'Non-tax invoice report'], ['credit', 'Credit note report'], ['debit', 'Debit note report'],
    ['cancelled', 'Cancelled document report'], ['outstanding', 'Outstanding invoice report'], ['paid', 'Paid invoice report'], ['overdue', 'Overdue invoice report']]],
  ['VAT reports', [['vat_summary', 'Output VAT summary'], ['taxable', 'VAT taxable sales'], ['zero', 'Zero-rated sales'], ['by_rate', 'VAT by rate'], ['by_customer', 'VAT by customer'],
    ['sch01', 'Schedule 01 report'], ['sch02', 'Schedule 02 purchase report'], ['sch04', 'Schedule 04 credit / debit note report'], ['sch07', 'Schedule 07 report'],
    ['ramis_sub', 'RAMIS submission report'], ['ramis_rej', 'RAMIS rejection report'], ['ramis_rec', 'RAMIS reconciliation report']]],
  ['Payment reports', [['daily', 'Daily collections'], ['monthly', 'Monthly collections'], ['cust_pay', 'Customer payment report'], ['receivables', 'Outstanding receivables'], ['aging', 'Aging report']]],
];
const NAMES = Object.fromEntries(GROUPS.flatMap(([, r]) => r));
const NEEDS = { by_rate: 'lines', sch01: 'lines', sch07: 'lines', sch02: 'purchases', sch04: 'purchases', ramis_sub: 'subs', ramis_rej: 'subs', ramis_rec: 'subs', daily: 'payments', monthly: 'payments', cust_pay: 'payments' };
const M = (h, k) => ({ h, k, money: true });
const C = (h, k) => ({ h, k });

export default function Reports({ app }) {
  const { nav, go, data, clientId } = app;
  const r = nav.r;
  const [p, setP] = useState(initialPeriod(['receivables', 'aging', 'outstanding', 'overdue'].includes(r) ? 'ya' : 'month'));
  const [cust, setCust] = useState('');
  const [branch, setBranch] = useState('');
  const [extra, setExtra] = useState({});
  const need = NEEDS[r];
  useEffect(() => {
    if (!need) return;
    setExtra((x) => ({ ...x, [need]: null }));
    const f = need === 'lines' ? loadLinesFor(clientId, p.from || '1900-01-01', p.to || '2999-12-31')
      : need === 'purchases' ? Promise.all([loadPurchases(clientId), loadScheduleMap()]).then(([pu, m]) => ({ pu, m }))
        : need === 'subs' ? loadSubmissions(clientId) : loadPayments(clientId);
    f.then((v) => setExtra((x) => ({ ...x, [need]: v }))).catch((e) => toast.error(e.message));
  }, [need, clientId, p.from, p.to]);

  const rep = useMemo(() => (r ? build(r, { docs: data.docs, customers: data.customers, p, cust, branch, extra, need }) : null), [r, data.docs, data.customers, p, cust, branch, extra, need]);

  if (!r) return (
    <div className="grid gap-3 md:grid-cols-3">
      {GROUPS.map(([g, list]) => (
        <div key={g} className="card p-3">
          <div className="mb-2 flex items-center gap-1.5 text-sm font-bold text-primary-800"><BarChart3 size={15} /> {g}</div>
          {list.map(([k, l]) => <button key={k} type="button" onClick={() => go('reports', { r: k })} className="block w-full rounded px-2 py-1.5 text-left text-sm text-gray-700 hover:bg-primary-50">{l}</button>)}
        </div>
      ))}
    </div>
  );

  const title = NAMES[r] || r;
  const file = `${title.toLowerCase().replace(/[^a-z0-9]+/g, '-')}-${p.from || ''}-${p.to || slToday()}`;
  const sheetRows = () => rep ? [rep.cols.map((c) => c.h), ...rep.rows.map((row) => rep.cols.map((c) => (c.money ? Math.round(Number(row[c.k] || 0) * 100) / 100 : row[c.k] ?? ''))),
    ...(rep.total ? [rep.cols.map((c, i) => (i === 0 ? 'Total' : c.money && rep.total[c.k] != null ? Math.round(rep.total[c.k] * 100) / 100 : ''))] : [])] : [];
  const printIt = () => {
    const st = data.settings || {};
    const esc = (s) => String(s ?? '').replace(/[&<>]/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[ch]));
    const w = window.open('', '_blank');
    w.document.write(`<!doctype html><html><head><meta charset="utf-8"><title>${esc(title)}</title><style>@page{size:A4 landscape;margin:12mm;@bottom-right{content:"Page " counter(page) " of " counter(pages);font:9px Arial}}body{font:11px Arial;margin:18px}table{width:100%;border-collapse:collapse}th{background:#1e3a8a;color:#fff;text-align:left;padding:4px}td{padding:3px 4px;border-bottom:1px solid #ddd}td.r,th.r{text-align:right}tfoot td{font-weight:bold;border-top:2px solid #1e3a8a}@media print{button{display:none}}</style></head><body>
      <button onclick="print()">Print / Save as PDF</button><h2 style="margin:4px 0">${esc(title)}</h2><div>${esc(st.legal_name || '')}${st.tin ? ` · TIN ${esc(st.tin)}` : ''} · ${p.from ? `${dmy(p.from)} – ${dmy(p.to)}` : 'All dates'} · printed ${dmy(slToday())}</div><br>
      <table><thead><tr>${rep.cols.map((c) => `<th class="${c.money ? 'r' : ''}">${esc(c.h)}</th>`).join('')}</tr></thead><tbody>
      ${rep.rows.map((row) => `<tr>${rep.cols.map((c) => `<td class="${c.money ? 'r' : ''}">${c.money ? money(row[c.k]) : esc(row[c.k])}</td>`).join('')}</tr>`).join('')}</tbody>
      ${rep.total ? `<tfoot><tr>${rep.cols.map((c, i) => `<td class="${c.money ? 'r' : ''}">${i === 0 ? 'Total' : c.money && rep.total[c.k] != null ? money(rep.total[c.k]) : ''}</td>`).join('')}</tr></tfoot>` : ''}</table>
      <p style="color:#666;font-size:10px">Prepared with TaxMate Solutions. Figures come from issued documents; check against RAMIS before filing.</p></body></html>`);
    w.document.close();
  };

  return (
    <div className="space-y-3">
      <div className="card space-y-2 p-3">
        <div className="flex flex-wrap items-center gap-2">
          <button type="button" onClick={() => go('reports')} className="p-1 text-gray-500" aria-label="Back"><ArrowLeft size={18} /></button>
          <div className="flex-1 font-bold text-primary-800">{title}</div>
          <button type="button" className="btn-secondary border px-2 py-1.5 text-xs" onClick={() => downloadCsv(`${file}.csv`, sheetRows())}><Download size={13} /> CSV</button>
          <button type="button" className="btn-secondary border px-2 py-1.5 text-xs" onClick={() => downloadXlsx(`${file}.xlsx`, [{ name: title.slice(0, 31), rows: sheetRows().map((row, i) => (i === 0 ? row.map((v) => ({ v, s: 'h' })) : row.map((v, j) => (rep.cols[j]?.money && typeof v === 'number' ? { v, s: 'm' } : v)))), freeze: 1, widths: rep?.cols.map((c) => (c.money ? 14 : 20)) }])}><Download size={13} /> Excel</button>
          <button type="button" className="btn-secondary border px-2 py-1.5 text-xs" onClick={printIt}><Printer size={13} /> PDF</button>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <PeriodPicker value={p} onChange={setP} />
          <select className="input w-auto py-1.5" value={cust} onChange={(e) => setCust(e.target.value)} aria-label="Customer"><option value="">All customers</option>{data.customers.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</select>
          {data.branches.length > 0 && <select className="input w-auto py-1.5" value={branch} onChange={(e) => setBranch(e.target.value)} aria-label="Branch"><option value="">All branches</option>{data.branches.map((b) => <option key={b.id} value={b.id}>{b.code}</option>)}</select>}
        </div>
      </div>
      {!rep ? <Spinner /> : (
        <div className="card overflow-x-auto">
          <table className="w-full text-xs">
            <thead className="bg-gray-50"><tr>{rep.cols.map((c) => <th key={c.k} className={`table-th ${c.money ? 'text-right' : ''}`}>{c.h}</th>)}</tr></thead>
            <tbody className="divide-y divide-gray-50">
              {rep.rows.map((row, i) => <tr key={i}>{rep.cols.map((c) => <td key={c.k} className={`px-3 py-1.5 ${c.money ? 'text-right tabular-nums' : ''}`}>{c.money ? money(row[c.k]) : row[c.k]}</td>)}</tr>)}
            </tbody>
            {rep.total && <tfoot className="bg-gray-50 font-bold"><tr>{rep.cols.map((c, i) => <td key={c.k} className={`px-3 py-1.5 ${c.money ? 'text-right tabular-nums' : ''}`}>{i === 0 ? 'Total' : c.money && rep.total[c.k] != null ? money(rep.total[c.k]) : ''}</td>)}</tr></tfoot>}
          </table>
          {rep.rows.length === 0 && <div className="p-6 text-center text-xs text-gray-400">Nothing for these filters.</div>}
          {rep.note && <div className="border-t p-2 text-[11px] text-gray-500">{rep.note}</div>}
        </div>
      )}
    </div>
  );
}

const sumBy = (rows, cols) => Object.fromEntries(cols.filter((c) => c.money).map((c) => [c.k, rows.reduce((a, r) => a + Number(r[c.k] || 0), 0)]));

function build(r, { docs, customers, p, cust, branch, extra, need }) {
  if (need && !extra[need]) return null;
  const today = slToday();
  const inP = (d) => (!p.from || d >= p.from) && (!p.to || d <= p.to);
  const base = docs.filter((d) => (!cust || d.customer_id === cust) && (!branch || d.branch_id === branch));
  const iss = base.filter((d) => d.status === 'issued' && inP(d.issue_date));
  const docRow = (d) => ({ type: DOC_TYPES[d.doc_type]?.short, no: d.doc_no, date: d.issue_date, supply: d.supply_date || '', due: d.due_date || '', customer: d.customer?.name, tin: d.customer?.tin || '',
    net: sign(d) * Number(d.net_total), vat: sign(d) * Number(d.vat_total), total: sign(d) * Number(d.total), paid: Number(d.paid), balance: Number(d.balance), ramis: RAMIS[d.ramis_status]?.label, ref: d.ramis_ref || '',
    days: d.due_date ? Math.max(0, daysBetween(d.due_date, today)) : 0, reason: d.cancel_reason || d.reason || '' });
  const std = [C('Type', 'type'), C('Number', 'no'), C('Date', 'date'), C('Customer', 'customer'), C('TIN', 'tin'), M('Value excl. VAT', 'net'), M('VAT', 'vat'), M('Total', 'total')];
  const withTotals = (cols, rows, note) => ({ cols, rows, total: sumBy(rows, cols), note });
  switch (r) {
    case 'sales': return withTotals([...std, C('RAMIS', 'ramis')], iss.map(docRow), 'Invoices + debit notes − credit notes (credit notes shown negative).');
    case 'tax': case 'nontax': case 'credit': case 'debit':
      return withTotals([...std, ...(r === 'credit' || r === 'debit' ? [C('Reason', 'reason')] : [C('Supply date', 'supply')]), ...(r !== 'nontax' ? [C('RAMIS', 'ramis'), C('RAMIS ref', 'ref')] : [])], iss.filter((d) => d.doc_type === r).map(docRow));
    case 'cancelled': return withTotals([C('Type', 'type'), C('Number', 'no'), C('Date', 'date'), C('Customer', 'customer'), M('Total', 'total'), C('Reason', 'reason')], base.filter((d) => d.status === 'cancelled' && inP(d.issue_date)).map(docRow));
    case 'outstanding': case 'overdue': case 'paid': {
      const rows = base.filter((d) => d.status === 'issued' && isInvoice(d) && inP(d.issue_date)
        && (r === 'paid' ? ['paid', 'overpaid'].includes(d.pay_status) : Number(d.balance) > 0 && (r !== 'overdue' || (d.due_date && d.due_date < today)))).map(docRow);
      return withTotals([C('Number', 'no'), C('Date', 'date'), C('Due', 'due'), C('Customer', 'customer'), M('Total', 'total'), M('Paid', 'paid'), M('Balance', 'balance'), ...(r !== 'paid' ? [C('Days overdue', 'days')] : [])], rows);
    }
    case 'vat_summary': {
      const t = iss.filter((d) => d.is_tax);
      const part = (pred, f) => t.filter(pred).reduce((a, d) => a + Number(d[f]), 0);
      const rows = [
        { item: 'Tax invoices — standard-rated value', v: part((d) => d.doc_type === 'tax', 'taxable_standard'), vat: part((d) => d.doc_type === 'tax', 'vat_total') },
        { item: 'Tax invoices — zero-rated value', v: part((d) => d.doc_type === 'tax', 'taxable_zero'), vat: 0 },
        { item: 'Tax invoices — exempt items', v: part((d) => d.doc_type === 'tax', 'exempt_amount'), vat: 0 },
        { item: 'Add: tax debit notes', v: part((d) => d.doc_type === 'debit', 'net_total'), vat: part((d) => d.doc_type === 'debit', 'vat_total') },
        { item: 'Less: tax credit notes', v: -part((d) => d.doc_type === 'credit', 'net_total'), vat: -part((d) => d.doc_type === 'credit', 'vat_total') },
      ];
      return withTotals([C('Item', 'item'), M('Value', 'v'), M('Output VAT', 'vat')], rows, 'Output VAT from issued tax documents. Non-tax invoices are not included.');
    }
    case 'taxable': return withTotals(std, iss.filter((d) => d.is_tax && Number(d.taxable_standard)).map((d) => ({ ...docRow(d), net: sign(d) * Number(d.taxable_standard) })));
    case 'zero': return withTotals([C('Number', 'no'), C('Date', 'date'), C('Customer', 'customer'), M('Zero-rated value', 'zero')], iss.filter((d) => d.is_tax && Number(d.taxable_zero)).map((d) => ({ ...docRow(d), zero: sign(d) * Number(d.taxable_zero) })));
    case 'by_rate': {
      const g = {};
      for (const l of extra.lines) { const d = l.vi_documents; if (!d?.is_tax || d.status !== 'issued') continue; const k = l.treatment === 'standard' ? `${Number(l.rate)}% standard` : l.treatment; const s = d.doc_type === 'credit' ? -1 : 1; const x = (g[k] ||= { rate: k, net: 0, vat: 0, total: 0 }); x.net += s * l.net; x.vat += s * l.vat; x.total += s * l.total; }
      return withTotals([C('Rate', 'rate'), M('Value excl. VAT', 'net'), M('VAT', 'vat'), M('Total', 'total')], Object.values(g));
    }
    case 'by_customer': {
      const g = {};
      for (const d of iss.filter((x) => x.is_tax)) { const k = d.customer?.name || '—'; const x = (g[k] ||= { customer: k, tin: d.customer?.tin || '', net: 0, vat: 0, total: 0 }); x.net += sign(d) * d.net_total; x.vat += sign(d) * d.vat_total; x.total += sign(d) * d.total; }
      return withTotals([C('Customer', 'customer'), C('TIN', 'tin'), M('Value excl. VAT', 'net'), M('VAT', 'vat'), M('Total', 'total')], Object.values(g).sort((a, b) => b.vat - a.vat));
    }
    case 'sch01': case 'sch07': {
      const want = r === 'sch01' ? '01' : '07';
      const g = {};
      for (const l of extra.lines) { const d = l.vi_documents; if (l.schedule !== want || d?.status !== 'issued') continue; const x = (g[l.doc_id] ||= { id: l.doc_id, net: 0, vat: 0 }); x.net += Number(l.net); x.vat += Number(l.vat); }
      const rows = Object.values(g).map((x) => { const d = docs.find((y) => y.id === x.id) || {}; return { no: d.doc_no, date: d.issue_date, supply: d.supply_date, customer: d.customer?.name, tin: d.customer?.tin || '', net: x.net, vat: x.vat }; })
        .filter((x) => !cust || docs.find((y) => y.doc_no === x.no)?.customer_id === cust);
      return withTotals([C('Invoice no.', 'no'), C('Invoice date', 'date'), C('Supply date', 'supply'), C('Purchaser', 'customer'), C('Purchaser TIN', 'tin'), M('Value', 'net'), M('VAT', 'vat')], rows, `Lines mapped to Schedule ${want} (see VAT schedule mapping).`);
    }
    case 'sch02': case 'sch04': {
      const { pu, m } = extra.purchases;
      const sch = (k) => m.find((x) => x.key === k)?.schedule;
      const rows = [];
      if (r === 'sch04') iss.filter((d) => d.is_tax && (d.doc_type === 'credit' || d.doc_type === 'debit')).forEach((d) => rows.push({ side: 'Supplier (issued)', kind: d.doc_type, no: d.doc_no, date: d.issue_date, party: d.customer?.name, tin: d.customer?.tin || '', taxable: sign(d) * d.net_total, vat: sign(d) * d.vat_total, status: RAMIS[d.ramis_status]?.label }));
      pu.filter((x) => inP(x.invoice_date) && sch(x.schedule_key) === (r === 'sch02' ? '02' : '04')).forEach((x) => rows.push({ side: 'Purchaser (received)', kind: x.doc_kind, no: x.invoice_no, date: x.invoice_date, party: x.supplier_name, tin: x.supplier_tin || '', taxable: (x.doc_kind === 'credit' ? -1 : 1) * x.taxable, vat: (x.doc_kind === 'credit' ? -1 : 1) * x.vat, status: APPROVAL[x.approval]?.label }));
      return withTotals([C('Side', 'side'), C('Kind', 'kind'), C('Number', 'no'), C('Date', 'date'), C('Supplier / purchaser', 'party'), C('TIN', 'tin'), M('Taxable', 'taxable'), M('VAT', 'vat'), C('Status', 'status')], rows);
    }
    case 'ramis_sub': case 'ramis_rej': {
      const rows = extra.subs.filter((s) => inP(s.created_at.slice(0, 10)) && (r === 'ramis_sub' || ['rejected', 'failed'].includes(s.status)))
        .map((s) => { const d = docs.find((x) => x.id === s.doc_id) || {}; return { sub: s.submission_no, no: d.doc_no, kind: s.kind, env: s.environment, status: SUB_STATUS[s.status]?.label, tries: s.attempts, ref: s.ramis_ref || '', err: [s.error_code, s.error_message].filter(Boolean).join(': '), at: s.created_at.slice(0, 16).replace('T', ' ') }; });
      return { cols: [C('Submission', 'sub'), C('Document', 'no'), C('Kind', 'kind'), C('Environment', 'env'), C('Status', 'status'), C('Tries', 'tries'), C('RAMIS ref', 'ref'), C('Error', 'err'), C('Created', 'at')], rows };
    }
    case 'ramis_rec': {
      const rows = iss.filter((d) => d.is_tax).map((d) => { const s = extra.subs.filter((x) => x.doc_id === d.id); const last = s[0]; return { ...docRow(d), subs: s.length, last: last ? SUB_STATUS[last.status]?.label : 'Not submitted', match: ['accepted', 'locked'].includes(d.ramis_status) ? 'Reconciled' : d.ramis_status === 'draft' ? 'Not sent' : 'Open' }; });
      return withTotals([C('Number', 'no'), C('Date', 'date'), C('Customer', 'customer'), M('Value', 'net'), M('VAT', 'vat'), C('RAMIS status', 'ramis'), C('RAMIS ref', 'ref'), C('Submissions', 'subs'), C('Last submission', 'last'), C('Reconciliation', 'match')], rows);
    }
    case 'daily': case 'monthly': {
      const g = {};
      for (const x of extra.payments.filter((y) => !y.voided_at && inP(y.paid_on) && (!cust || y.customer_id === cust))) {
        const k = r === 'daily' ? x.paid_on : x.paid_on.slice(0, 7);
        const e = (g[k] ||= { period: k, n: 0, cash: 0, bank: 0, other: 0, total: 0 });
        e.n += 1; e.total += Number(x.amount);
        if (x.method === 'cash') e.cash += Number(x.amount); else if (x.method === 'bank_transfer' || x.method === 'cheque') e.bank += Number(x.amount); else e.other += Number(x.amount);
      }
      return withTotals([C(r === 'daily' ? 'Date' : 'Month', 'period'), C('Payments', 'n'), M('Cash', 'cash'), M('Bank / cheque', 'bank'), M('Card / mobile / other', 'other'), M('Total', 'total')], Object.values(g).sort((a, b) => a.period.localeCompare(b.period)));
    }
    case 'cust_pay': {
      const name = Object.fromEntries(customers.map((c) => [c.id, c.name]));
      return withTotals([C('Receipt', 'no'), C('Date', 'date'), C('Customer', 'customer'), C('Method', 'method'), C('Reference', 'ref'), M('Amount', 'amount')],
        extra.payments.filter((x) => !x.voided_at && inP(x.paid_on) && (!cust || x.customer_id === cust)).map((x) => ({ no: x.receipt_no, date: x.paid_on, customer: name[x.customer_id] || '—', method: METHODS[x.method], ref: x.reference || '', amount: Number(x.amount) })));
    }
    case 'receivables': case 'aging': {
      const g = {};
      for (const d of base.filter((x) => x.status === 'issued' && isInvoice(x) && Number(x.balance) > 0)) {
        const k = d.customer?.name || '—';
        const e = (g[k] ||= { customer: k, tin: d.customer?.tin || '', n: 0, balance: 0, ...Object.fromEntries(AGING.map(([a]) => [a, 0])) });
        const age = daysBetween(d.due_date || d.issue_date, today); const v = Number(d.balance);
        e.n += 1; e.balance += v;
        const key = age <= 0 ? 'current' : age <= 30 ? 'd1_30' : age <= 60 ? 'd31_60' : age <= 90 ? 'd61_90' : age <= 120 ? 'd91_120' : 'd120';
        e[key] += v;
      }
      const cols = r === 'aging' ? [C('Customer', 'customer'), ...AGING.map(([k, l]) => M(l, k)), M('Total', 'balance')] : [C('Customer', 'customer'), C('TIN', 'tin'), C('Open invoices', 'n'), M('Outstanding', 'balance')];
      return withTotals(cols, Object.values(g).sort((a, b) => b.balance - a.balance), 'As of today, by days past the due date. Opening balances of customers are not included.');
    }
    default: return { cols: [], rows: [] };
  }
}
