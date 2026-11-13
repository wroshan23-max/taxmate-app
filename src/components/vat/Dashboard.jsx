// V64 — VAT Invoice dashboard: today / month KPIs, RAMIS, charts
import { useEffect, useMemo, useState } from 'react';
import { TrendingUp, Receipt, Landmark, AlertTriangle, Wallet, Clock, CheckCircle2, FileText, Users } from 'lucide-react';
import { loadPayments } from '../../lib/vat/api';
import { rs, slToday, DOC_STATUS } from '../../lib/vat/format';
import { salesSummary, receivables, lastMonths, issued, sign, isInvoice, periodRange, ramisCounts, AGING } from '../../lib/vat/stats';
import { Stat, Bars, HBars } from './ui';

const short = (v) => { const x = Math.abs(Number(v) || 0); return `${v < 0 ? '−' : ''}${x >= 1e6 ? `${(x / 1e6).toFixed(1)}M` : x >= 1e3 ? `${(x / 1e3).toFixed(0)}k` : x.toFixed(0)}`; };

export default function Dashboard({ app }) {
  const { data, go, clientId, tick } = app;
  const [payments, setPayments] = useState([]);
  useEffect(() => { loadPayments(clientId).then(setPayments).catch(() => setPayments([])); }, [clientId, tick]);
  const today = slToday();
  const [m0, m1] = periodRange('month', today);
  const docs = data.docs;

  const s = useMemo(() => {
    const todayS = salesSummary(docs, today, today);
    const month = salesSummary(docs, m0, m1);
    const rec = receivables(docs, today);
    const live = payments.filter((p) => !p.voided_at);
    const monthPay = live.filter((p) => p.paid_on >= m0 && p.paid_on <= m1).reduce((a, p) => a + Number(p.amount), 0);
    const paidInv = issued(docs).filter((d) => isInvoice(d) && d.issue_date >= m0 && d.issue_date <= m1 && ['paid', 'overpaid'].includes(d.pay_status)).length;
    const ram = ramisCounts(docs, m0, m1);
    const all = ramisCounts(docs);
    const months = lastMonths(12, today).map((mm) => {
      const ds = issued(docs).filter((d) => d.issue_date.startsWith(mm.key));
      return {
        label: mm.label,
        value: ds.reduce((a, d) => a + sign(d) * Number(d.net_total), 0),
        value2: ds.filter((d) => d.is_tax).reduce((a, d) => a + sign(d) * Number(d.vat_total), 0),
        pay: live.filter((p) => p.paid_on.startsWith(mm.key)).reduce((a, p) => a + Number(p.amount), 0),
      };
    });
    const byCust = {};
    issued(docs).filter((d) => d.issue_date >= periodRange('ya', today)[0]).forEach((d) => {
      const k = d.customer?.name || '—';
      byCust[k] = (byCust[k] || 0) + sign(d) * Number(d.total);
    });
    const top = Object.entries(byCust).sort((a, b) => b[1] - a[1]).slice(0, 6).map(([label, value]) => ({ label, value }));
    const statusCounts = ['draft', 'issued', 'cancelled'].map((k) => ({ label: DOC_STATUS[k].label, value: docs.filter((d) => d.status === k).length }));
    const payCounts = [['unpaid', 'Unpaid'], ['partial', 'Partly paid'], ['paid', 'Paid'], ['overpaid', 'Overpaid']]
      .map(([k, label]) => ({ label, value: issued(docs).filter((d) => isInvoice(d) && d.pay_status === k).length }));
    return { todayS, month, rec, monthPay, paidInv, ram, all, months, top, statusCounts, payCounts };
  }, [docs, payments, today, m0, m1]);

  return (
    <div className="space-y-3">
      <div className="grid grid-cols-2 gap-2 md:grid-cols-4">
        <Stat icon={TrendingUp} label="Today's sales" value={rs(s.todayS.total)} sub={`${s.todayS.invoices} invoice${s.todayS.invoices === 1 ? '' : 's'}`} tone="blue" onClick={() => go('docs', { from: today, to: today })} />
        <Stat icon={FileText} label="Monthly sales" value={rs(s.month.total)} sub={`excl. VAT ${rs(s.month.net)}`} tone="blue" onClick={() => go('reports', { r: 'sales' })} />
        <Stat icon={Receipt} label="VAT this month" value={rs(s.month.vat)} sub="output VAT (after notes)" tone="violet" onClick={() => go('reports', { r: 'vat_summary' })} />
        <Stat icon={Wallet} label="Outstanding" value={rs(s.rec.outstanding)} sub={`${s.rec.open} open invoice${s.rec.open === 1 ? '' : 's'}`} tone="amber" onClick={() => go('docs', { f: 'open' })} />
        <Stat icon={AlertTriangle} label="Overdue" value={rs(s.rec.overdue)} sub={`${s.rec.overdueN} invoice${s.rec.overdueN === 1 ? '' : 's'}`} tone={s.rec.overdueN ? 'red' : 'gray'} onClick={() => go('docs', { f: 'overdue' })} />
        <Stat icon={CheckCircle2} label="Collected this month" value={rs(s.monthPay)} sub={`${s.paidInv} invoice${s.paidInv === 1 ? '' : 's'} fully paid`} tone="green" onClick={() => go('payments')} />
        <Stat icon={Clock} label="Pending RAMIS" value={s.all.pending} sub={`${s.all.not_sent} not sent (RAMIS off)`} tone={s.all.pending ? 'amber' : 'gray'} onClick={() => go('ramis')} />
        <Stat icon={Landmark} label="RAMIS errors" value={s.all.rejected + s.all.failed} sub={`${s.all.rejected} rejected · ${s.all.failed} failed`} tone={s.all.rejected + s.all.failed ? 'red' : 'gray'} onClick={() => go('ramis', { tab: 'failed' })} />
      </div>

      <div className="grid gap-3 md:grid-cols-2">
        <div className="card p-4">
          <div className="mb-2 flex items-center justify-between text-sm font-semibold text-gray-700"><span>Monthly sales &amp; VAT</span>
            <span className="flex gap-2 text-[11px] font-normal text-gray-500"><span><i className="inline-block h-2 w-2 rounded bg-primary-800" /> excl. VAT</span><span><i className="inline-block h-2 w-2 rounded bg-yellow-500" /> VAT</span></span></div>
          <Bars data={s.months} fmt={short} />
        </div>
        <div className="card p-4">
          <div className="mb-2 text-sm font-semibold text-gray-700">Collections (payments received)</div>
          <Bars data={s.months.map((x) => ({ label: x.label, value: x.pay }))} color="#16a34a" fmt={short} />
        </div>
        <div className="card p-4">
          <div className="mb-2 text-sm font-semibold text-gray-700">Outstanding receivables by age (days past due)</div>
          <Bars data={AGING.map(([k, label]) => ({ label, value: s.rec.buckets[k] }))} color="#d97706" fmt={short} height={110} />
        </div>
        <div className="card p-4">
          <div className="mb-2 flex items-center gap-1.5 text-sm font-semibold text-gray-700"><Users size={14} /> Customer concentration (this Y/A)</div>
          {s.top.length ? <HBars data={s.top} fmt={rs} /> : <div className="text-xs text-gray-400">No sales yet.</div>}
        </div>
        <div className="card p-4">
          <div className="mb-2 text-sm font-semibold text-gray-700">Invoice status</div>
          <div className="grid grid-cols-2 gap-3"><HBars data={s.statusCounts} color="#64748b" /><HBars data={s.payCounts} color="#0ea5e9" /></div>
        </div>
        <div className="card p-4 text-sm">
          <div className="mb-2 font-semibold text-gray-700">This month</div>
          <div className="grid grid-cols-2 gap-x-4 gap-y-1 text-xs">
            {[['Invoices', s.month.invoices], ['Taxable sales', rs(s.month.taxable)], ['VAT', rs(s.month.vat)], ['Total sales', rs(s.month.total)],
              ['Payments', rs(s.monthPay)], ['Outstanding', rs(s.rec.outstanding)], ['Credit notes', `${s.month.credits} · ${rs(s.month.credit_total)}`], ['Debit notes', `${s.month.debits} · ${rs(s.month.debit_total)}`],
              ['RAMIS submitted', s.ram.submitted], ['RAMIS accepted', s.ram.accepted], ['RAMIS rejected', s.ram.rejected], ['RAMIS pending', s.ram.pending], ['RAMIS failed', s.ram.failed]]
              .map(([k, v]) => <div key={k} className="flex justify-between gap-2 border-b border-gray-50 py-0.5"><span className="text-gray-500">{k}</span><b className="tabular-nums text-gray-800">{v}</b></div>)}
          </div>
        </div>
      </div>
    </div>
  );
}
