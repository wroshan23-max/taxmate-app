// V64 — TaxMate admin: VAT Invoice add-on control panel (clients, revenue, RAMIS, tax rules, compliance, plan)
import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import toast from 'react-hot-toast';
import { FileText, Loader2, Save, Plus, Scale, BookOpen, Crown, RefreshCw, AlertTriangle, Play } from 'lucide-react';
import { adminOverview, loadRates, adminSaveRate, loadScheduleMap, adminSaveSchedule, loadComplianceUpdates, adminCompliance, adminRamisApi, adminReleasePending, adminRamisLog, ramisRunNow } from '../../lib/vat/api';
import { loadAddons, saveAddons } from '../../lib/plans';
import { rs, dmy, dt, SUBSCRIPTION, SUB_STATUS } from '../../lib/vat/format';
import { Badge, Stat, Modal, Field, Spinner } from '../../components/vat/ui';

const TABS = [['overview', 'Overview'], ['clients', 'Clients'], ['ramis', 'RAMIS API'], ['rates', 'Tax rates'], ['schedules', 'Schedule mapping'], ['compliance', 'Compliance updates'], ['plan', 'Plan & prices']];

export default function VatInvoicing() {
  const [tab, setTab] = useState('overview');
  const [o, setO] = useState(null);
  const load = () => adminOverview().then(setO).catch((e) => toast.error(e.message));
  useEffect(() => { load(); }, []);
  return (
    <div className="space-y-4">
      <div><h1 className="flex items-center gap-2 text-2xl font-bold text-primary-800"><FileText size={24} /> VAT Invoice &amp; RAMIS</h1>
        <p className="text-sm text-gray-500">Add-on control panel · open a client → <b>VAT Invoices</b> tab to work in their invoices</p></div>
      <div className="flex flex-wrap gap-1">{TABS.map(([k, l]) => <button key={k} type="button" onClick={() => setTab(k)} className={`rounded-full px-3 py-1 text-xs font-semibold ${tab === k ? 'bg-primary-700 text-white' : 'border bg-white text-gray-600'}`}>{l}</button>)}</div>
      {!o ? <Spinner /> : (
        <>
          {tab === 'overview' && <Overview o={o} go={setTab} />}
          {tab === 'clients' && <ClientsTab o={o} />}
          {tab === 'ramis' && <RamisApi o={o} reload={load} />}
          {tab === 'rates' && <Rates />}
          {tab === 'schedules' && <Schedules />}
          {tab === 'compliance' && <Compliance o={o} reload={load} />}
          {tab === 'plan' && <Plan />}
        </>
      )}
    </div>
  );
}

function Overview({ o, go }) {
  const cl = o.clients;
  const n = (pred) => cl.filter(pred).length;
  const failedPay = cl.filter((c) => c.unpaid_addon_invoices > 0);
  return (
    <div className="space-y-3">
      <div className="grid grid-cols-2 gap-2 md:grid-cols-4">
        <Stat label="Clients with VAT Invoice" value={cl.length} onClick={() => go('clients')} />
        <Stat label="Active" value={n((c) => c.status === 'active')} sub={`${n((c) => c.status === 'trial')} on trial · ${n((c) => c.status === 'past_due')} past due`} tone="green" />
        <Stat label="VAT-registered" value={n((c) => c.vat_registered)} />
        <Stat label="RAMIS switched on" value={n((c) => c.ramis_enabled)} />
        <Stat label="MRR" value={rs(o.mrr)} tone="blue" sub="monthly recurring (annual ÷ 12)" />
        <Stat label="ARR" value={rs(o.arr)} tone="blue" />
        <Stat label="Renewals in 30 days" value={o.renewals_30d.length} />
        <Stat label="Failed / overdue payments" value={failedPay.length} tone={failedPay.length ? 'red' : 'gray'} />
        <Stat label="Documents this month" value={o.volume.docs_month} sub={`${o.volume.docs_total} in total`} />
        <Stat label="Client sales this month" value={rs(o.volume.sales_month)} sub={`VAT ${rs(o.volume.vat_month)}`} />
        <Stat label="RAMIS submissions this month" value={o.ramis.month} onClick={() => go('ramis')} />
        <Stat label="RAMIS failures" value={(o.ramis.by_status.failed || 0) + (o.ramis.by_status.rejected || 0)} sub={`${o.ramis.by_status.pending_config || 0} waiting for configuration`} tone={(o.ramis.by_status.failed || 0) ? 'red' : 'gray'} onClick={() => go('ramis')} />
      </div>
      {o.requests.length > 0 && (
        <div className="card p-4"><div className="mb-1 text-sm font-semibold text-amber-800">Requests to approve</div>
          {o.requests.map((r) => <Link key={r.id} to={`/admin/clients/${r.client_id}`} className="flex flex-wrap gap-2 border-b border-gray-50 py-1 text-sm hover:text-primary-700"><b>{r.name}</b><span>{r.cycle} · {rs(r.price)}</span><span className="text-gray-500">{dmy(r.created_at)}</span>{r.note && <span className="text-gray-500">“{r.note}”</span>}</Link>)}
          <div className="mt-1 text-xs text-gray-500">Approve on the client page → Overview → Add-on services.</div></div>
      )}
      <div className="grid gap-3 md:grid-cols-2">
        <div className="card p-4"><div className="mb-1 text-sm font-semibold">Renewals in the next 30 days</div>{o.renewals_30d.length === 0 ? <div className="text-xs text-gray-400">None.</div> : o.renewals_30d.map((r) => <div key={r.client_id} className="flex justify-between py-0.5 text-xs"><span>{r.name}</span><span>{dmy(r.date)} · {r.cycle} · {rs(r.price)}</span></div>)}</div>
        <div className="card p-4"><div className="mb-1 text-sm font-semibold">Overdue subscription invoices</div>{failedPay.length === 0 ? <div className="text-xs text-gray-400">None.</div> : failedPay.map((c) => <Link key={c.client_id} to={`/admin/clients/${c.client_id}`} className="flex justify-between py-0.5 text-xs hover:text-primary-700"><span>{c.name}</span><span>{c.unpaid_addon_invoices} unpaid · {SUBSCRIPTION[c.status]?.label}</span></Link>)}</div>
      </div>
    </div>
  );
}

function ClientsTab({ o }) {
  const [q, setQ] = useState('');
  const list = o.clients.filter((c) => !q || [c.name, c.business, c.tin, c.client_no].filter(Boolean).join(' ').toLowerCase().includes(q.toLowerCase()));
  return (
    <div className="card overflow-x-auto">
      <div className="p-3"><input className="input" placeholder="Search client, business, TIN…" value={q} onChange={(e) => setQ(e.target.value)} /></div>
      <table className="w-full text-sm">
        <thead className="bg-gray-50"><tr><th className="table-th">Client</th><th className="table-th">Subscription</th><th className="table-th text-right">This month</th><th className="table-th">RAMIS</th><th className="table-th">Users</th></tr></thead>
        <tbody className="divide-y divide-gray-50">
          {list.map((c) => (
            <tr key={c.client_id}>
              <td className="table-td"><Link className="font-semibold text-primary-700 hover:underline" to={`/admin/clients/${c.client_id}`}>{c.name}</Link><div className="text-[11px] text-gray-500">{c.client_no} · {c.business || '—'}{c.tin && ` · TIN ${c.tin}`}{c.vat_registered && ' · VAT'}</div></td>
              <td className="table-td"><Badge meta={SUBSCRIPTION[c.status]} /><div className="text-[11px] text-gray-500">{c.cycle} · {rs(c.price)}{c.next_bill_date && ` · next ${dmy(c.next_bill_date)}`}{c.trial_ends && c.status === 'trial' && ` · trial to ${dmy(c.trial_ends)}`}</div></td>
              <td className="table-td text-right tabular-nums">{c.docs_month} docs<div className="text-[11px] text-gray-500">{rs(c.sales_month)}</div></td>
              <td className="table-td text-xs">{c.ramis_enabled ? 'On' : 'Off'}{c.ramis_pending > 0 && <div className="text-amber-700">{c.ramis_pending} waiting</div>}{c.ramis_failed > 0 && <div className="text-red-600">{c.ramis_failed} failed / rejected</div>}</td>
              <td className="table-td text-xs">{c.members + 1}</td>
            </tr>
          ))}
        </tbody>
      </table>
      {list.length === 0 && <div className="p-6 text-center text-sm text-gray-400">No clients yet — start VAT Invoice for a client on the client page → Overview → Add-on services.</div>}
    </div>
  );
}

function RamisApi({ o, reload }) {
  const api = o.api || {};
  const ad = api.active_adapter || 'v1';
  const [cfg, setCfg] = useState(() => JSON.parse(JSON.stringify(api.adapters?.[ad] || {})));
  const [busy, setBusy] = useState(false);
  const [log, setLog] = useState(null);
  const set = (path, v) => { const c = JSON.parse(JSON.stringify(cfg)); let x = c; path.slice(0, -1).forEach((k) => { x[k] ||= {}; x = x[k]; }); x[path[path.length - 1]] = v; setCfg(c); };
  const save = async () => { setBusy(true); try { await adminRamisApi({ adapter: ad, config: cfg }); toast.success('Saved'); reload(); } catch (e) { toast.error(e.message); } finally { setBusy(false); } };
  const env = (k) => (
    <div className="grid gap-2 sm:grid-cols-2">
      {['base_url', 'token_endpoint', 'submit_endpoint', 'status_endpoint'].map((f) => <Field key={f} label={`${k} — ${f.replace('_', ' ')}`}><input className="input font-mono text-xs" value={cfg[k]?.[f] || ''} onChange={(e) => set([k, f], e.target.value.trim())} placeholder="https://… (from IRD's official document)" /></Field>)}
    </div>
  );
  return (
    <div className="space-y-3">
      <div className="card border-amber-200 bg-amber-50 p-4 text-sm text-amber-900">
        <div className="flex items-center gap-1.5 font-bold"><AlertTriangle size={15} /> Never invent an IRD endpoint, login method or field</div>
        <div className="mt-1 text-xs">Fill these only from IRD's official VAT Web API specification. Logins are each taxpayer's own SSID + password (stored encrypted, used only by the <span className="font-mono">vatinvoice</span> Edge Function). If IRD gives TaxMate a client ID / secret, put it in Supabase → Edge Functions → Secrets, never here.
          The field mapping is code in <span className="font-mono">supabase/functions/vatinvoice/index.ts</span> (adapter {ad}); set the status to <b>active</b> only after that adapter is built and tested against IRD's sandbox.</div>
      </div>
      <div className="card space-y-3 p-4">
        <div className="grid gap-2 sm:grid-cols-3">
          <Field label="Adapter"><input className="input font-mono" value={ad} readOnly /></Field>
          <Field label="Status"><select className="input" value={cfg.status || 'pending'} onChange={(e) => set(['status'], e.target.value)}><option value="pending">pending (queue only)</option><option value="active">active (sends to IRD)</option><option value="disabled">disabled</option></select></Field>
          <Field label="IRD API specification version"><input className="input" value={cfg.spec_version || ''} onChange={(e) => set(['spec_version'], e.target.value)} /></Field>
        </div>
        {env('production')}{env('sandbox')}
        <div className="flex flex-wrap gap-2">
          <button type="button" disabled={busy} className="btn-primary text-sm" onClick={save}>{busy ? <Loader2 size={14} className="animate-spin" /> : <Save size={14} />} Save</button>
          <button type="button" className="btn-secondary border text-sm" onClick={async () => { try { const n = await adminReleasePending(); toast.success(`${n} waiting submission(s) queued`); reload(); } catch (e) { toast.error(e.message); } }}><Play size={14} /> Send waiting submissions</button>
          <button type="button" className="btn-secondary border text-sm" onClick={async () => { try { const r = await ramisRunNow(); toast.success(`Processed ${r.processed ?? 0}`); reload(); } catch (e) { toast.error(e.message); } }}><RefreshCw size={14} /> Run queue now</button>
        </div>
      </div>
      <div className="card p-4">
        <div className="mb-1 text-sm font-semibold">Submissions by status</div>
        <div className="flex flex-wrap gap-2">{Object.entries(o.ramis.by_status).map(([k, v]) => <Badge key={k} meta={SUB_STATUS[k]}>{SUB_STATUS[k]?.label || k}: {v}</Badge>)}{Object.keys(o.ramis.by_status).length === 0 && <span className="text-xs text-gray-400">No submissions yet.</span>}</div>
        <div className="mb-1 mt-3 text-sm font-semibold">Recent errors (technical log)</div>
        {o.ramis.recent_errors.length === 0 ? <div className="text-xs text-gray-400">None.</div> : o.ramis.recent_errors.map((e) => (
          <button key={e.id} type="button" onClick={() => adminRamisLog(e.id).then((l) => setLog({ e, l })).catch((er) => toast.error(er.message))} className="flex w-full flex-wrap gap-2 border-b border-gray-50 py-1 text-left text-xs hover:bg-gray-50">
            <span className="w-32 text-gray-500">{dt(e.at)}</span><b>{e.client}</b><span className="font-mono">{e.doc_no}</span><Badge meta={SUB_STATUS[e.status]} /><span className="text-red-700">{e.code}: {e.error}</span><span className="text-gray-400">tries {e.attempts}</span>
          </button>
        ))}
      </div>
      {log && <Modal title={`Technical log — ${log.e.doc_no}`} onClose={() => setLog(null)} wide><div className="space-y-1 font-mono text-[11px]">{log.l.map((x) => <div key={x.id} className="border-b pb-1"><b>{dt(x.created_at)} · {x.kind}</b>{x.http_status && ` · HTTP ${x.http_status}`} — {x.message}{x.detail && <pre className="whitespace-pre-wrap text-gray-500">{JSON.stringify(x.detail, null, 1)}</pre>}</div>)}</div></Modal>}
    </div>
  );
}

function Rates() {
  const [rates, setRates] = useState(null);
  const [edit, setEdit] = useState(null);
  const load = () => loadRates().then(setRates).catch((e) => toast.error(e.message));
  useEffect(() => { load(); }, []);
  if (!rates) return <Spinner />;
  const save = async () => { try { await adminSaveRate(edit); toast.success('Saved'); setEdit(null); load(); } catch (e) { toast.error(e.message, { duration: 7000 }); } };
  return (
    <div className="space-y-3">
      <div className="card p-3 text-xs text-gray-600"><Scale size={13} className="-mt-0.5 mr-1 inline" />A new rate for an existing code (with a later start date) closes the old one the day before. Issued invoices keep the rate they used; a rate already used cannot be changed — add a new one instead.</div>
      <div className="card overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="bg-gray-50"><tr><th className="table-th">Code</th><th className="table-th">Type</th><th className="table-th">Rate</th><th className="table-th">From – to</th><th className="table-th">IRD reference</th><th className="table-th" /></tr></thead>
          <tbody className="divide-y divide-gray-50">
            {rates.map((r) => <tr key={r.id}><td className="table-td font-mono">{r.code}<div className="text-[11px] text-gray-500">v{r.version}</div></td><td className="table-td">{r.treatment}</td><td className="table-td">{Number(r.rate)}%</td><td className="table-td text-xs">{r.effective_from} – {r.effective_to || 'now'}</td>
              <td className="table-td max-w-xs text-xs">{r.ird_reference}{r.ird_status === 'verify' && <Badge meta={{ cls: 'ml-1 bg-amber-50 text-amber-700 border-amber-200' }}>to confirm</Badge>}</td>
              <td className="table-td"><button type="button" className="text-xs font-semibold text-primary-700" onClick={() => setEdit({ ...r, effective_to: r.effective_to || '', ird_reference: r.ird_reference || '' })}>Edit</button></td></tr>)}
          </tbody>
        </table>
        <div className="border-t p-2 text-right"><button type="button" className="text-xs font-semibold text-primary-700" onClick={() => setEdit({ code: 'VAT_STD', treatment: 'standard', rate: '', effective_from: '', effective_to: '', description: 'VAT — standard rate', ird_reference: '', ird_status: 'confirmed' })}><Plus size={12} className="inline" /> New rate</button></div>
      </div>
      {edit && (
        <Modal title={edit.id ? 'Edit rate' : 'New rate'} onClose={() => setEdit(null)} footer={<><button type="button" className="btn-secondary border text-sm" onClick={() => setEdit(null)}>Cancel</button><button type="button" className="btn-primary text-sm" onClick={save}>Save</button></>}>
          <div className="grid gap-2 sm:grid-cols-2">
            <Field label="Code"><input className="input font-mono uppercase" value={edit.code} onChange={(e) => setEdit({ ...edit, code: e.target.value.toUpperCase() })} /></Field>
            <Field label="Type"><select className="input" value={edit.treatment} onChange={(e) => setEdit({ ...edit, treatment: e.target.value })}><option value="standard">standard</option><option value="zero">zero-rated</option><option value="exempt">exempt</option></select></Field>
            <Field label="Rate %"><input className="input" inputMode="decimal" value={edit.rate} onChange={(e) => setEdit({ ...edit, rate: e.target.value.replace(/[^\d.]/g, '') })} /></Field>
            <Field label="Status"><select className="input" value={edit.ird_status} onChange={(e) => setEdit({ ...edit, ird_status: e.target.value })}><option value="confirmed">confirmed</option><option value="verify">to confirm</option><option value="superseded">superseded</option></select></Field>
            <Field label="Effective from"><input type="date" className="input" value={edit.effective_from} onChange={(e) => setEdit({ ...edit, effective_from: e.target.value })} /></Field>
            <Field label="Effective to (empty = open)"><input type="date" className="input" value={edit.effective_to} onChange={(e) => setEdit({ ...edit, effective_to: e.target.value })} /></Field>
            <Field label="Description" className="sm:col-span-2"><input className="input" value={edit.description} onChange={(e) => setEdit({ ...edit, description: e.target.value })} /></Field>
            <Field label="IRD reference (gazette / act / circular)" className="sm:col-span-2"><input className="input" value={edit.ird_reference} onChange={(e) => setEdit({ ...edit, ird_reference: e.target.value })} /></Field>
          </div>
        </Modal>
      )}
    </div>
  );
}

function Schedules() {
  const [map, setMap] = useState(null);
  const [edit, setEdit] = useState(null);
  const load = () => loadScheduleMap().then(setMap).catch((e) => toast.error(e.message));
  useEffect(() => { load(); }, []);
  if (!map) return <Spinner />;
  const save = async () => { try { await adminSaveSchedule(edit); toast.success('Saved — applies to documents issued from now on'); setEdit(null); load(); } catch (e) { toast.error(e.message); } };
  return (
    <div className="space-y-3">
      <div className="card p-3 text-xs text-gray-600"><BookOpen size={13} className="-mt-0.5 mr-1 inline" />Which VAT return schedule each kind of record belongs to. Issued documents keep the schedule they got; changes apply to new documents.</div>
      <div className="card overflow-x-auto">
        <table className="w-full text-sm"><thead className="bg-gray-50"><tr><th className="table-th">Key</th><th className="table-th">Side</th><th className="table-th">Schedule</th><th className="table-th">Label / basis</th><th className="table-th" /></tr></thead>
          <tbody className="divide-y divide-gray-50">{map.map((m) => <tr key={m.key} className={m.active ? '' : 'opacity-50'}><td className="table-td font-mono text-xs">{m.key}</td><td className="table-td text-xs">{m.side}</td><td className="table-td font-bold">{m.schedule || '—'}</td><td className="table-td text-xs">{m.label}<div className="text-gray-400">{m.basis} · v{m.version}</div></td><td className="table-td"><button type="button" className="text-xs font-semibold text-primary-700" onClick={() => setEdit({ ...m, schedule: m.schedule || '', basis: m.basis || '' })}>Edit</button></td></tr>)}</tbody></table>
      </div>
      {edit && (
        <Modal title={`Schedule mapping — ${edit.key}`} onClose={() => setEdit(null)} footer={<><button type="button" className="btn-secondary border text-sm" onClick={() => setEdit(null)}>Cancel</button><button type="button" className="btn-primary text-sm" onClick={save}>Save</button></>}>
          <div className="grid gap-2 sm:grid-cols-2">
            <Field label="Schedule (2 digits, empty = none)"><input className="input" maxLength={2} value={edit.schedule} onChange={(e) => setEdit({ ...edit, schedule: e.target.value.replace(/\D/g, '') })} /></Field>
            <label className="mt-5 flex items-center gap-2 text-sm"><input type="checkbox" checked={!!edit.active} onChange={(e) => setEdit({ ...edit, active: e.target.checked })} /> Active</label>
            <Field label="Label" className="sm:col-span-2"><input className="input" value={edit.label} onChange={(e) => setEdit({ ...edit, label: e.target.value })} /></Field>
            <Field label="Basis (IRD source)" className="sm:col-span-2"><input className="input" value={edit.basis} onChange={(e) => setEdit({ ...edit, basis: e.target.value })} /></Field>
          </div>
        </Modal>
      )}
    </div>
  );
}

function Compliance({ o, reload }) {
  const [list, setList] = useState(null);
  const [f, setF] = useState(null);
  const load = () => loadComplianceUpdates().then(setList).catch((e) => toast.error(e.message));
  useEffect(() => { load(); }, []);
  const save = async () => { try { const v = await adminCompliance(f); toast.success(`Recorded — rules version ${v}`); setF(null); load(); reload(); } catch (e) { toast.error(e.message); } };
  return (
    <div className="space-y-3">
      <div className="card p-4 text-sm">
        <div className="font-semibold text-primary-800">Current compliance version</div>
        <div className="mt-1 text-xs">IRD VAT invoice specification: <b>{o.compliance?.invoice_spec}</b> (from {o.compliance?.invoice_spec_date})</div>
        <div className="text-xs">RAMIS API specification: <b>{o.compliance?.ramis_api_spec}</b></div>
        <div className="text-xs">Tax rules version: <b>v{o.compliance?.rules_version}</b> — stored on every document issued.</div>
        <button type="button" className="btn-primary mt-2 px-3 py-1.5 text-sm" onClick={() => setF({ area: 'gazette', title: '', reference: '', effective_date: '', details: '', bump_version: false, invoice_spec: '', ramis_api_spec: '' })}><Plus size={14} /> Record an update</button>
      </div>
      {!list ? <Spinner /> : (
        <div className="card divide-y">{list.map((u) => <div key={u.id} className="p-3 text-sm"><div className="flex flex-wrap gap-2"><Badge>{u.area.replace('_', ' ')}</Badge><b>{u.title}</b>{u.rules_version && <span className="text-xs text-gray-500">rules v{u.rules_version}</span>}<span className="flex-1" /><span className="text-xs text-gray-400">{dt(u.created_at)}</span></div>
          {u.reference && <div className="text-xs text-gray-600">{u.reference}{u.effective_date && ` · effective ${dmy(u.effective_date)}`}</div>}{u.details && <div className="mt-1 whitespace-pre-line text-xs text-gray-500">{u.details}</div>}</div>)}</div>
      )}
      {f && (
        <Modal title="Record a compliance update" onClose={() => setF(null)} wide footer={<><button type="button" className="btn-secondary border text-sm" onClick={() => setF(null)}>Cancel</button><button type="button" disabled={!f.title} className="btn-primary text-sm" onClick={save}>Save</button></>}>
          <div className="grid gap-2 sm:grid-cols-2">
            <Field label="Area"><select className="input" value={f.area} onChange={(e) => setF({ ...f, area: e.target.value })}>{['gazette', 'vat_rate', 'invoice_format', 'ramis_api', 'schedule', 'validation', 'numbering', 'other'].map((a) => <option key={a} value={a}>{a.replace('_', ' ')}</option>)}</select></Field>
            <Field label="Effective date"><input type="date" className="input" value={f.effective_date} onChange={(e) => setF({ ...f, effective_date: e.target.value })} /></Field>
            <Field label="Title" className="sm:col-span-2"><input className="input" value={f.title} onChange={(e) => setF({ ...f, title: e.target.value })} /></Field>
            <Field label="Reference (gazette no., circular, notice)" className="sm:col-span-2"><input className="input" value={f.reference} onChange={(e) => setF({ ...f, reference: e.target.value })} /></Field>
            <Field label="Details" className="sm:col-span-2"><textarea className="input" rows={4} value={f.details} onChange={(e) => setF({ ...f, details: e.target.value })} /></Field>
            {f.area === 'invoice_format' && <Field label="New invoice specification label (optional)" className="sm:col-span-2"><input className="input" value={f.invoice_spec} onChange={(e) => setF({ ...f, invoice_spec: e.target.value })} /></Field>}
            {f.area === 'ramis_api' && <Field label="New RAMIS API specification label (optional)" className="sm:col-span-2"><input className="input" value={f.ramis_api_spec} onChange={(e) => setF({ ...f, ramis_api_spec: e.target.value })} /></Field>}
            <label className="flex items-center gap-2 text-sm sm:col-span-2"><input type="checkbox" checked={f.bump_version} onChange={(e) => setF({ ...f, bump_version: e.target.checked })} /> New tax rules version (documents issued from now on carry it)</label>
          </div>
        </Modal>
      )}
    </div>
  );
}

function Plan() {
  const [all, setAll] = useState(null);
  const [a, setA] = useState(null);
  const [busy, setBusy] = useState(false);
  useEffect(() => { loadAddons().then((x) => { setAll(x); setA(x.find((y) => y.key === 'vat_invoice') || null); }); }, []);
  if (!all) return <Spinner />;
  if (!a) return <div className="card p-4 text-sm text-red-700">The VAT Invoice add-on is not in the catalog — run the V64 SQL migration.</div>;
  const lim = a.limits || {};
  const setL = (k, v) => setA({ ...a, limits: { ...lim, [k]: v } });
  const save = async () => { setBusy(true); try { const saved = await saveAddons(all.map((x) => (x.key === 'vat_invoice' ? a : x))); setAll(saved); toast.success('Saved'); } catch (e) { toast.error(e.message); } finally { setBusy(false); } };
  return (
    <div className="card space-y-3 p-4">
      <div className="flex items-center gap-1.5 font-bold text-primary-800"><Crown size={16} /> VAT Invoice &amp; RAMIS — plan and prices</div>
      <div className="grid gap-2 sm:grid-cols-4">
        <Field label="Monthly price (Rs.)"><input className="input" inputMode="numeric" value={a.price ?? ''} onChange={(e) => setA({ ...a, price: e.target.value.replace(/\D/g, '') })} /></Field>
        <Field label="Annual price (Rs.)"><input className="input" inputMode="numeric" value={a.annual_price ?? ''} onChange={(e) => setA({ ...a, annual_price: e.target.value.replace(/\D/g, '') })} /></Field>
        <Field label="Free trial (days)"><input className="input" inputMode="numeric" value={a.trial_days ?? 14} onChange={(e) => setA({ ...a, trial_days: e.target.value.replace(/\D/g, '') })} /></Field>
        <label className="mt-5 flex items-center gap-2 text-sm"><input type="checkbox" checked={a.active !== false} onChange={(e) => setA({ ...a, active: e.target.checked })} /> Offer to clients (My Plan)</label>
      </div>
      <div className="text-sm font-semibold text-gray-700">Limits (0 = unlimited)</div>
      <div className="grid gap-2 sm:grid-cols-4">
        {[['invoices_per_month', 'Invoices per month'], ['customers', 'Customers'], ['users', 'Users (incl. owner)'], ['storage_mb', 'Storage (MB)']].map(([k, l]) => <Field key={k} label={l}><input className="input" inputMode="numeric" value={lim[k] ?? 0} onChange={(e) => setL(k, e.target.value.replace(/\D/g, ''))} /></Field>)}
        {[['ramis', 'RAMIS Web API'], ['reports', 'Reports'], ['auto_reminders', 'Automatic reminders'], ['payments', 'Payment features']].map(([k, l]) => <label key={k} className="flex items-center gap-2 text-sm"><input type="checkbox" checked={lim[k] !== false} onChange={(e) => setL(k, e.target.checked)} /> {l}</label>)}
      </div>
      <Field label="Tagline"><input className="input" value={a.tagline || ''} onChange={(e) => setA({ ...a, tagline: e.target.value })} /></Field>
      <div className="text-xs text-gray-500">Existing subscriptions keep their own price (change it on the client page). Prices are never hard-coded in the app.</div>
      <div className="flex justify-end"><button type="button" disabled={busy} className="btn-primary text-sm" onClick={save}>{busy ? <Loader2 size={14} className="animate-spin" /> : <Save size={14} />} Save</button></div>
    </div>
  );
}
