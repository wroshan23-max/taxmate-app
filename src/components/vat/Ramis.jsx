// V64 — VAT / RAMIS: reconciliation dashboard, VAT schedules, submission history, failed submissions
import { useEffect, useMemo, useState } from 'react';
import toast from 'react-hot-toast';
import { Landmark, ArrowRight, Download, AlertTriangle, CheckCircle2, Clock, XCircle, Info } from 'lucide-react';
import { loadSubmissions, loadLinesFor, loadPurchases, loadScheduleMap, ramisInfo } from '../../lib/vat/api';
import { rs, money, dmy, dt, slToday, SUB_STATUS, RAMIS } from '../../lib/vat/format';
import { ramisCounts, periodRange, PERIODS, sign } from '../../lib/vat/stats';
import { downloadXlsx } from '../../lib/xlsx';
import { t } from '../../lib/vat/i18n';
import { Stat, Badge, Empty, Spinner, downloadCsv } from './ui';

export function PeriodPicker({ value, onChange }) {
  const [k, setK] = useState(value.key || 'month');
  return (
    <div className="flex flex-wrap items-center gap-2">
      <select className="input w-auto py-1.5" value={k} aria-label="Period" onChange={(e) => { setK(e.target.value); if (e.target.value !== 'custom') { const [f, to] = periodRange(e.target.value); onChange({ key: e.target.value, from: f, to }); } }}>
        {PERIODS.map(([p, l]) => <option key={p} value={p}>{l}</option>)}
      </select>
      {k === 'custom' && <>
        <input type="date" className="input w-auto py-1.5" value={value.from || ''} onChange={(e) => onChange({ ...value, key: 'custom', from: e.target.value })} aria-label="From" />
        <input type="date" className="input w-auto py-1.5" value={value.to || ''} onChange={(e) => onChange({ ...value, key: 'custom', to: e.target.value })} aria-label="To" />
      </>}
      <span className="text-xs text-gray-500">{dmy(value.from)} – {dmy(value.to)}</span>
    </div>
  );
}
export const initialPeriod = (key = 'month') => { const [from, to] = periodRange(key); return { key, from, to }; };

export default function Ramis({ app }) {
  const { nav, go } = app;
  const tab = nav.tab || 'dashboard';
  const tabs = [['dashboard', t('nav.ramis')], ['schedules', t('nav.schedules')], ['history', t('nav.history')], ['failed', t('nav.failed')]];
  return (
    <div className="space-y-3">
      <div className="flex flex-wrap gap-1">{tabs.map(([k, l]) => <button key={k} type="button" onClick={() => go('ramis', { tab: k })} className={`rounded-full px-3 py-1 text-xs font-semibold ${tab === k ? 'bg-primary-700 text-white' : 'bg-white text-gray-600 border'}`}>{l}</button>)}</div>
      {tab === 'dashboard' && <RamisDashboard app={app} />}
      {tab === 'schedules' && <Schedules app={app} />}
      {(tab === 'history' || tab === 'failed') && <History app={app} failedOnly={tab === 'failed'} />}
    </div>
  );
}

function RamisDashboard({ app }) {
  const { clientId, data, go, ctx, can } = app;
  const [p, setP] = useState(initialPeriod());
  const [info, setInfo] = useState(null);
  useEffect(() => { ramisInfo(clientId).then(setInfo).catch(() => {}); }, [clientId]);
  const c = useMemo(() => ramisCounts(data.docs, p.from, p.to), [data.docs, p]);
  const adapterActive = info?.adapter_status === 'active';
  return (
    <div className="space-y-3">
      <div className={`card p-3 text-sm ${adapterActive ? 'border-green-200 bg-green-50 text-green-900' : 'border-amber-200 bg-amber-50 text-amber-900'}`}>
        <div className="flex items-center gap-1.5 font-semibold"><Landmark size={15} /> {adapterActive ? `RAMIS Web API connected (adapter ${info.adapter}, spec ${info.spec_version || '—'})` : t('ramis.pending')}</div>
        <div className="mt-1 text-xs">{adapterActive
          ? 'Accepted invoices are locked. Rejected ones need a corrected draft; corrections after acceptance are made with Credit / Debit Notes.'
          : 'IRD has not published the Web API endpoints / field specification to TaxMate yet. Submissions are validated and wait in the queue — nothing is shown as sent to IRD until the official API answers. Keep reporting through RAMIS as usual meanwhile.'}</div>
        {info && <div className="mt-1 text-xs">This business: RAMIS {info.config?.enabled ? 'on' : 'off'} · {info.config?.environment || 'production'} · auto-submit {info.config?.auto_submit ? 'on' : 'off'} · login {info.config?.use_saved_login && info.has_ssid && info.has_pin ? 'saved (SSID + password)' : 'not set'}
          {can('settings') && <button type="button" className="ml-1 font-semibold underline" onClick={() => go('settings', { tab: 'ramis' })}>change</button>}</div>}
      </div>
      <div className="card p-3"><PeriodPicker value={p} onChange={setP} /></div>
      <div className="grid grid-cols-2 gap-2 md:grid-cols-5">
        <Stat label="Tax documents" value={c.total} />
        <Stat icon={CheckCircle2} label="Submitted" value={c.submitted} tone="green" />
        <Stat icon={CheckCircle2} label="Accepted" value={c.accepted} tone="green" />
        <Stat icon={XCircle} label="Rejected" value={c.rejected} tone={c.rejected ? 'red' : 'gray'} onClick={() => go('ramis', { tab: 'failed' })} />
        <Stat icon={AlertTriangle} label="Failed" value={c.failed} tone={c.failed ? 'red' : 'gray'} onClick={() => go('ramis', { tab: 'failed' })} />
        <Stat icon={Clock} label="Pending" value={c.pending} tone={c.pending ? 'amber' : 'gray'} onClick={() => go('docs', { ramis: 'pending' })} />
        <Stat label="Not sent (RAMIS off)" value={c.not_sent} onClick={() => go('docs', { ramis: 'draft' })} />
        <Stat label="Credit notes" value={c.credits} />
        <Stat label="Debit notes" value={c.debits} />
        <Stat label="API errors" value={c.rejected + c.failed} tone={c.rejected + c.failed ? 'red' : 'gray'} />
      </div>
      <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
        <Stat label="Total taxable value" value={rs(c.taxable)} tone="blue" />
        <Stat label="Total VAT" value={rs(c.vat)} tone="violet" />
        <Stat label="Total invoice value" value={rs(c.value)} tone="blue" />
      </div>
      <div className="card p-4 text-sm">
        <div className="mb-2 flex items-center gap-1.5 font-semibold text-gray-700"><Info size={15} /> How a tax invoice flows (IRD VAT Web API)</div>
        <ol className="flex flex-wrap items-center gap-1.5 text-xs">
          {['Supplier issues tax invoice', 'TaxMate validates', 'TaxMate submits to RAMIS', 'RAMIS accepts → supplier Schedule 01 (07 zero-rated services)', 'Purchaser\'s Schedule 02 shows "Pending Approval"', 'Purchaser reviews & approves', 'Matched / input VAT per IRD rules']
            .map((s, i, a) => <li key={s} className="flex items-center gap-1.5"><span className="rounded-lg bg-primary-50 px-2 py-1 text-primary-800">{s}</span>{i < a.length - 1 && <ArrowRight size={12} className="text-gray-400" />}</li>)}
        </ol>
        <div className="mt-2 text-xs text-gray-500">Credit and debit notes go to Schedule 04 for both sides. IRD: records submitted through the Web API cannot be updated or deleted — correct them with a credit or debit note. Source: IRD VAT WEB API Quick Guide v0.1; invoice format: Circular SEC/2026/E/03.</div>
        <div className="mt-1 text-xs text-gray-400">Compliance version: {ctx.compliance?.invoice_spec} · rules v{ctx.compliance?.rules_version} · RAMIS API: {ctx.compliance?.ramis_api_spec}</div>
      </div>
    </div>
  );
}

function Schedules({ app }) {
  const { clientId, data } = app;
  const [p, setP] = useState(initialPeriod());
  const [lines, setLines] = useState(null);
  const [purch, setPurch] = useState([]);
  const [map, setMap] = useState([]);
  useEffect(() => {
    setLines(null);
    Promise.all([loadLinesFor(clientId, p.from || '1900-01-01', p.to || '2999-12-31'), loadPurchases(clientId), loadScheduleMap()])
      .then(([l, pu, m]) => { setLines(l); setPurch(pu); setMap(m); }).catch((e) => { toast.error(e.message); setLines([]); });
  }, [clientId, p, data.docs]);
  if (!lines) return <Spinner />;
  const out = {};
  for (const l of lines) {
    const d = l.vi_documents;
    if (!d?.is_tax || d.status !== 'issued' || !l.schedule) continue;
    const k = l.schedule; const s = sign(d);
    const x = (out[k] ||= { net: 0, vat: 0, n: new Set() });
    x.net += s * Number(l.net); x.vat += s * Number(l.vat); x.n.add(l.doc_id);
  }
  const schedOf = (key) => map.find((m) => m.key === key)?.schedule;
  const inn = {};
  for (const pu of purch.filter((x) => (!p.from || x.invoice_date >= p.from) && (!p.to || x.invoice_date <= p.to))) {
    const k = schedOf(pu.schedule_key) || '—';
    const x = (inn[k] ||= { taxable: 0, vat: 0, claim: 0, pending: 0, n: 0 });
    const s = pu.doc_kind === 'credit' ? -1 : 1;
    x.taxable += s * Number(pu.taxable); x.vat += s * Number(pu.vat); x.n += 1;
    if (['approved', 'matched'].includes(pu.approval)) x.claim += s * (Number(pu.vat) - Number(pu.disallowed_vat)); else if (pu.approval === 'pending') x.pending += 1;
  }
  const label = (sch, side) => map.find((m) => m.schedule === sch && m.side === side)?.label || '';
  const sheet = () => [['Side', 'Schedule', 'Description', 'Documents', 'Value / taxable', 'VAT', 'Input VAT approved'],
    ...Object.entries(out).sort().map(([k, v]) => ['Supplier (output)', k, label(k, 'supplier'), v.n.size, Math.round(v.net * 100) / 100, Math.round(v.vat * 100) / 100, '']),
    ...Object.entries(inn).sort().map(([k, v]) => ['Purchaser (input)', k, label(k, 'purchaser'), v.n, Math.round(v.taxable * 100) / 100, Math.round(v.vat * 100) / 100, Math.round(v.claim * 100) / 100])];
  return (
    <div className="space-y-3">
      <div className="card flex flex-wrap items-center gap-2 p-3"><PeriodPicker value={p} onChange={setP} /><span className="flex-1" />
        <button type="button" className="text-xs font-semibold text-primary-700" onClick={() => downloadCsv(`vat-schedules-${p.from}-${p.to}.csv`, sheet())}><Download size={12} className="inline" /> CSV</button>
        <button type="button" className="text-xs font-semibold text-primary-700" onClick={() => downloadXlsx(`vat-schedules-${p.from}-${p.to}.xlsx`, [{ name: 'VAT schedules', rows: sheet(), freeze: 1, widths: [18, 10, 40, 12, 16, 14, 18] }])}><Download size={12} className="inline" /> Excel</button></div>
      <div className="grid gap-3 md:grid-cols-2">
        <div className="card p-4">
          <div className="mb-2 text-sm font-semibold text-gray-700">Output (your sales)</div>
          {Object.keys(out).length === 0 ? <div className="text-xs text-gray-400">No tax documents in this period.</div> : Object.entries(out).sort().map(([k, v]) => (
            <div key={k} className="flex items-center gap-2 border-b border-gray-50 py-1.5 text-sm"><Badge>Sch {k}</Badge><span className="flex-1 text-xs text-gray-600">{label(k, 'supplier')} · {v.n.size} doc{v.n.size === 1 ? '' : 's'}</span>
              <span className="text-right text-xs tabular-nums">{money(v.net)}<div className="text-gray-500">VAT {money(v.vat)}</div></span></div>
          ))}
        </div>
        <div className="card p-4">
          <div className="mb-2 text-sm font-semibold text-gray-700">Input (your purchases, from the Purchaser VAT inbox)</div>
          {Object.keys(inn).length === 0 ? <div className="text-xs text-gray-400">No purchase records in this period.</div> : Object.entries(inn).sort().map(([k, v]) => (
            <div key={k} className="flex items-center gap-2 border-b border-gray-50 py-1.5 text-sm"><Badge>Sch {k}</Badge><span className="flex-1 text-xs text-gray-600">{label(k, 'purchaser')} · {v.n} record{v.n === 1 ? '' : 's'}{v.pending ? ` · ${v.pending} pending review` : ''}</span>
              <span className="text-right text-xs tabular-nums">VAT {money(v.vat)}<div className="text-green-700">approved {money(v.claim)}</div></span></div>
          ))}
        </div>
      </div>
      <div className="text-[11px] text-gray-500">Schedule mapping is set by TaxMate from IRD documents and can change with new IRD specifications; check the figures against RAMIS before filing the VAT return.</div>
    </div>
  );
}

function History({ app, failedOnly }) {
  const { clientId, data, openDoc, tick } = app;
  const [subs, setSubs] = useState(null);
  const [status, setStatus] = useState('');
  useEffect(() => { loadSubmissions(clientId).then(setSubs).catch((e) => { toast.error(e.message); setSubs([]); }); }, [clientId, tick]);
  if (!subs) return <Spinner />;
  const docNo = Object.fromEntries(data.docs.map((d) => [d.id, d]));
  const list = subs.filter((s) => (failedOnly ? ['failed', 'rejected', 'retrying'].includes(s.status) : !status || s.status === status));
  const problemDocs = failedOnly ? data.docs.filter((d) => ['failed', 'rejected'].includes(d.ramis_status) && d.status === 'issued') : [];
  const sheet = () => [['Submission', 'Document', 'Kind', 'Environment', 'Adapter', 'Status', 'Tries', 'HTTP', 'RAMIS status', 'RAMIS ref', 'Error code', 'Error', 'Created', 'Responded'],
    ...list.map((s) => [s.submission_no, docNo[s.doc_id]?.doc_no, s.kind, s.environment, s.adapter_version, s.status, s.attempts, s.last_http_status, s.ramis_status, s.ramis_ref, s.error_code, s.error_message, s.created_at, s.responded_at])];
  return (
    <div className="space-y-3">
      <div className="card flex flex-wrap items-center gap-2 p-3">
        {!failedOnly && <select className="input w-auto py-1.5" value={status} onChange={(e) => setStatus(e.target.value)} aria-label="Status"><option value="">All statuses</option>{Object.entries(SUB_STATUS).map(([k, v]) => <option key={k} value={k}>{v.label}</option>)}</select>}
        <span className="flex-1 text-xs text-gray-500">{list.length} submission{list.length === 1 ? '' : 's'}</span>
        <button type="button" className="text-xs font-semibold text-primary-700" onClick={() => downloadCsv(`ramis-submissions-${slToday()}.csv`, sheet())}><Download size={12} className="inline" /> CSV</button>
      </div>
      {failedOnly && problemDocs.length > 0 && (
        <div className="card p-3">
          <div className="mb-1 text-sm font-semibold text-red-700">Documents needing action</div>
          {problemDocs.map((d) => (
            <button key={d.id} type="button" onClick={() => openDoc(d.id)} className="flex w-full flex-wrap items-center gap-2 border-b border-gray-50 py-1 text-left text-xs hover:bg-red-50">
              <span className="font-mono font-semibold">{d.doc_no}</span><Badge meta={RAMIS[d.ramis_status]} /><span className="flex-1 truncate text-gray-600">{d.ramis_message}</span>
              <span className="font-semibold text-primary-700">{d.ramis_status === 'rejected' ? 'Create corrected draft →' : 'Retry →'}</span>
            </button>
          ))}
        </div>
      )}
      {list.length === 0 ? <Empty icon={Landmark} title={failedOnly ? 'No failed submissions' : 'No RAMIS submissions yet'}>{failedOnly ? 'All good.' : 'Issue a tax invoice and press Submit to RAMIS.'}</Empty> : (
        <div className="card overflow-x-auto">
          <table className="w-full text-xs">
            <thead className="bg-gray-50"><tr><th className="table-th">Submission</th><th className="table-th">Document</th><th className="table-th">Status</th><th className="table-th hidden md:table-cell">Details</th><th className="table-th">When</th></tr></thead>
            <tbody className="divide-y divide-gray-50">
              {list.map((s) => (
                <tr key={s.id} className="cursor-pointer hover:bg-primary-50/40" onClick={() => openDoc(s.doc_id)}>
                  <td className="table-td font-mono">{s.submission_no}<div className="text-[10px] text-gray-400">{s.kind} · {s.environment} · adapter {s.adapter_version}</div></td>
                  <td className="table-td font-mono">{docNo[s.doc_id]?.doc_no}</td>
                  <td className="table-td"><Badge meta={SUB_STATUS[s.status]} /><div className="text-[10px] text-gray-400">tries {s.attempts}/{s.max_attempts}</div></td>
                  <td className="table-td hidden md:table-cell">{s.ramis_ref && <div>ref {s.ramis_ref}</div>}{s.error_message && <div className="text-red-700">{s.error_code && `${s.error_code}: `}{s.error_message}</div>}{s.status === 'retrying' && <div className="text-orange-700">next try {dt(s.next_attempt_at)}</div>}</td>
                  <td className="table-td whitespace-nowrap">{dt(s.created_at)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
