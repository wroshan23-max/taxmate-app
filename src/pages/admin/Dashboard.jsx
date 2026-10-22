import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import DueDatesWidget from '../../components/DueDatesWidget';
import { supabase, fmtRs, fmtDate } from '../../lib/supabase';
import {
  Users, FileText, Receipt, Calculator, Clock, AlertCircle, ArrowRight, MessageSquareWarning,
  CheckCircle2, Wallet, TrendingUp, AlertTriangle, Settings, Globe, PencilLine, Landmark, Sparkles,
} from 'lucide-react';

const todayISO = () => new Date().toISOString().slice(0, 10);
const monthKey = (d) => (d || '').slice(0, 7);
const isSent = (s) => s === 'unpaid' || s === 'overdue';

function Kpi({ icon: Icon, label, value, sub, color, to }) {
  const body = (
    <div className={`card p-4 flex items-center gap-3 h-full ${to ? 'hover:shadow-md transition-shadow' : ''}`}>
      <div className={`w-11 h-11 rounded-xl flex items-center justify-center flex-shrink-0 ${color}`}><Icon size={20} className="text-white" /></div>
      <div className="min-w-0">
        <div className="text-xl font-black text-gray-900 truncate">{value}</div>
        <div className="text-xs text-gray-500">{label}</div>
        {sub && <div className="text-[11px] text-gray-400 truncate">{sub}</div>}
      </div>
    </div>
  );
  return to ? <Link to={to}>{body}</Link> : body;
}

export default function Dashboard() {
  const [d, setD] = useState(null);

  useEffect(() => {
    (async () => {
      const [cl, rt, inv, calc, req, invites, al, sh] = await Promise.all([
        supabase.from('clients').select('id, full_name, tin, email, created_at, profile_id, source, reviewed_at, registered_at, contact_name, contact_relation, registration').is('archived_at', null).order('created_at', { ascending: false }),
        supabase.from('tax_returns').select('id, year, status, due_date, client_id, clients(full_name)').order('due_date'),
        supabase.from('invoices').select('id, invoice_no, status, total_amount, issue_date, due_date, paid_date, client_snapshot, clients(full_name)'),
        supabase.from('iit_calculations').select('id, client_id, year, status, client_status, client_note, client_responded_at, created_at, clients(full_name)'),
        supabase.from('update_requests').select('id, created_at, clients(full_name)').eq('status', 'pending'),
        supabase.from('portal_invites').select('id, expires_at').is('accepted_at', null).is('revoked_at', null),
        supabase.from('asset_statements').select('id, client_id, year, status, client_note, submitted_at, clients(full_name)').eq('status', 'submitted').eq('enabled', true),
        supabase.from('income_sheets').select('id, client_id, year, client_note, submitted_at, clients(full_name)').eq('status', 'submitted').eq('enabled', true),
      ]);
      setD({
        clients: cl.data ?? [], returns: rt.data ?? [], invoices: inv.data ?? [], calcs: calc.data ?? [],
        requests: req.data ?? [], assets: al.data ?? [], sheets: sh.data ?? [], invites: (invites.data ?? []).filter(i => new Date(i.expires_at) > new Date()),
      });
    })();
  }, []);

  const k = useMemo(() => {
    if (!d) return null;
    const today = todayISO(), month = monthKey(today);
    const in30 = new Date(Date.now() + 30 * 86400000).toISOString().slice(0, 10);
    const sum = (a) => a.reduce((s, x) => s + Number(x.total_amount || 0), 0);
    const sent = d.invoices.filter(i => isSent(i.status));
    const overdue = sent.filter(i => i.due_date && i.due_date < today);
    const openReturns = d.returns.filter(r => r.status === 'pending' || r.status === 'in_progress');
    const finalPeriods = new Set(d.calcs.filter(c => c.status === 'final').map(c => `${c.client_id}|${c.year}`));
    const changes = d.calcs.filter(c => c.status !== 'final' && c.client_status === 'changes_requested');
    const confirmed = d.calcs.filter(c => c.status !== 'final' && c.client_status === 'approved' && !finalPeriods.has(`${c.client_id}|${c.year}`));
    const waiting = d.calcs.filter(c => c.status !== 'final' && !c.client_status);
    const dueSoon = openReturns.filter(r => r.due_date && r.due_date <= in30);
    const nameOf = (i) => i.client_snapshot?.name || i.clients?.full_name || '—';

    const attention = [
      ...d.clients.filter(c => c.source === 'self_registration' && !c.reviewed_at).map(c => ({ key: `reg${c.id}`, icon: Sparkles, tone: 'green', text: `New client registered online${c.registration?.via && c.registration.via !== 'personal link' ? ` (${c.registration.via})` : ''} — ${c.full_name}${c.registration?.filled_by === 'contact' && c.contact_name ? ` (by ${c.contact_name}${c.contact_relation ? `, ${c.contact_relation.toLowerCase()}` : ''})` : ''}`, note: c.registration?.services?.join(', '), to: `/admin/clients/${c.id}`, when: c.registered_at })),
      ...d.sheets.map(x => ({ key: `sh${x.id}`, icon: Wallet, tone: 'blue', text: `${x.clients?.full_name ?? 'Client'} submitted monthly income — Y/A ${x.year}`, note: x.client_note, to: `/admin/clients/${x.client_id}?tab=income`, when: x.submitted_at })),
      ...d.assets.map(a => ({ key: `al${a.id}`, icon: Landmark, tone: 'blue', text: `${a.clients?.full_name ?? 'Client'} submitted Assets & Liabilities — Y/A ${a.year}`, note: a.client_note, to: `/admin/clients/${a.client_id}?tab=assets`, when: a.submitted_at })),
      ...changes.map(c => ({ key: `ch${c.id}`, icon: MessageSquareWarning, tone: 'amber', text: `${c.clients?.full_name ?? 'Client'} asked for changes — Y/A ${c.year}`, note: c.client_note, to: `/admin/clients/${c.client_id}`, when: c.client_responded_at })),
      ...confirmed.map(c => ({ key: `ok${c.id}`, icon: CheckCircle2, tone: 'green', text: `${c.clients?.full_name ?? 'Client'} confirmed the draft — mark it Final (Y/A ${c.year})`, to: `/admin/clients/${c.client_id}`, when: c.client_responded_at })),
      ...overdue.map(i => ({ key: `od${i.id}`, icon: AlertTriangle, tone: 'red', text: `${i.invoice_no} overdue — ${nameOf(i)} · ${fmtRs(i.total_amount)}`, to: '/admin/invoices', when: i.due_date })),
      ...dueSoon.map(r => ({ key: `rt${r.id}`, icon: Clock, tone: r.due_date < today ? 'red' : 'blue', text: `${r.clients?.full_name ?? 'Client'} — Y/A ${r.year} return ${r.due_date < today ? 'was due' : 'due'} ${fmtDate(r.due_date)}`, to: '/admin/tax-returns', when: r.due_date })),
      ...d.requests.map(r => ({ key: `rq${r.id}`, icon: PencilLine, tone: 'blue', text: `${r.clients?.full_name ?? 'Client'} sent a profile update request`, to: '/admin/requests', when: r.created_at })),
    ];

    const paidThisMonth = d.invoices.filter(i => i.status === 'paid' && monthKey(i.paid_date || i.issue_date) === month);
    return {
      attention, changes, waiting, openReturns, sent, overdue,
      portal: d.clients.filter(c => c.profile_id).length,
      billedMonth: sum(d.invoices.filter(i => i.status !== 'draft' && monthKey(i.issue_date) === month)),
      paidMonth: sum(paidThisMonth), outstanding: sum(sent), overdueAmt: sum(overdue),
      drafts: d.invoices.filter(i => i.status === 'draft').length,
    };
  }, [d]);

  if (!d || !k) return <div className="flex items-center justify-center h-64 text-gray-400">Loading...</div>;

  const tone = { amber: 'bg-amber-50 border-amber-200 text-amber-800', green: 'bg-green-50 border-green-200 text-green-800', red: 'bg-red-50 border-red-200 text-red-800', blue: 'bg-blue-50 border-blue-200 text-blue-800' };
  const hello = new Date().getHours() < 12 ? 'Good morning' : new Date().getHours() < 17 ? 'Good afternoon' : 'Good evening';

  return (
    <div className="space-y-6">
      <div className="flex items-end gap-3 flex-wrap">
        <div>
          <h1 className="text-2xl font-bold text-primary-800">{hello} 👋</h1>
          <p className="text-sm text-gray-500 mt-0.5">TaxMate Solutions — Admin overview · {new Date().toLocaleDateString('en-LK', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })}</p>
        </div>
        <div className="ml-auto flex gap-2 flex-wrap">
          <Link to="/admin/clients" className="btn-primary text-sm py-1.5"><Users size={14} /> Add Client</Link>
          <Link to="/admin/calculator" className="btn-secondary text-sm py-1.5"><Calculator size={14} /> New Calculation</Link>
          <Link to="/admin/invoices" className="btn-secondary text-sm py-1.5"><Receipt size={14} /> New Invoice</Link>
          <Link to="/admin/settings" className="btn-secondary text-sm py-1.5"><Settings size={14} /> Settings</Link>
        </div>
      </div>

      {/* Work KPIs */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <Kpi icon={Users} label="Clients" value={d.clients.length} sub={`${k.portal} on portal · ${d.invites.length} invited`} color="bg-primary-600" to="/admin/clients" />
        <Kpi icon={FileText} label="Returns in progress" value={k.openReturns.length} sub={`${d.returns.length} returns in total`} color="bg-green-600" to="/admin/tax-returns" />
        <Kpi icon={Calculator} label="Drafts awaiting client" value={k.waiting.length} sub={`${k.changes.length} need changes`} color="bg-indigo-500" to="/admin/calculator" />
        <Kpi icon={AlertCircle} label="Pending requests" value={d.requests.length} sub="profile update requests" color="bg-red-500" to="/admin/requests" />
      </div>

      {/* Money KPIs */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <Kpi icon={TrendingUp} label="Billed this month" value={fmtRs(k.billedMonth)} color="bg-primary-500" to="/admin/invoices" />
        <Kpi icon={Wallet} label="Collected this month" value={fmtRs(k.paidMonth)} color="bg-green-500" to="/admin/invoices" />
        <Kpi icon={Receipt} label="Outstanding" value={fmtRs(k.outstanding)} sub={`${k.sent.length} unpaid · ${k.drafts} draft`} color="bg-gold-500" to="/admin/invoices" />
        <Kpi icon={AlertTriangle} label="Overdue" value={fmtRs(k.overdueAmt)} sub={`${k.overdue.length} invoice${k.overdue.length !== 1 ? 's' : ''}`} color="bg-red-600" to="/admin/invoices" />
      </div>

      <div className="grid lg:grid-cols-[1fr_380px] gap-4 items-start">
        {/* Needs attention */}
        <div className="card overflow-hidden">
          <div className="card-header"><AlertCircle size={16} /> Needs your attention <span className="text-xs text-gray-400 font-normal">{k.attention.length}</span></div>
          {k.attention.length === 0 ? (
            <div className="p-8 text-center text-green-700 text-sm font-semibold">✅ All clear — nothing waiting for you.</div>
          ) : (
            <div className="p-3 space-y-2">
              {k.attention.slice(0, 12).map(a => (
                <Link key={a.key} to={a.to} className={`flex items-start gap-3 border rounded-lg px-3 py-2 text-sm hover:shadow-sm ${tone[a.tone]}`}>
                  <a.icon size={16} className="mt-0.5 flex-shrink-0" />
                  <div className="flex-1 min-w-0">
                    <div className="font-medium">{a.text}</div>
                    {a.note && <div className="text-xs opacity-80 truncate">“{a.note}”</div>}
                  </div>
                  <ArrowRight size={14} className="mt-0.5 flex-shrink-0 opacity-60" />
                </Link>
              ))}
              {k.attention.length > 12 && <div className="text-xs text-gray-400 px-2">+ {k.attention.length - 12} more</div>}
            </div>
          )}
        </div>
        <DueDatesWidget role="admin" />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <div className="card">
          <div className="card-header"><Users size={16} /> Recent Clients
            <Link to="/admin/clients" className="ml-auto text-xs text-primary-500 hover:underline flex items-center gap-1">View all <ArrowRight size={12} /></Link>
          </div>
          <div className="divide-y divide-gray-50">
            {d.clients.length === 0 ? <div className="p-8 text-center text-gray-400 text-sm">No clients yet</div> : d.clients.slice(0, 6).map(c => (
              <Link key={c.id} to={`/admin/clients/${c.id}`} className="flex items-center gap-3 px-5 py-3 hover:bg-gray-50 transition-colors">
                <div className="w-9 h-9 rounded-full bg-primary-100 flex items-center justify-center text-primary-700 font-bold text-sm flex-shrink-0">{c.full_name?.[0] ?? '?'}</div>
                <div className="flex-1 min-w-0">
                  <div className="text-sm font-semibold text-gray-800 truncate">{c.full_name}</div>
                  <div className="text-xs text-gray-400">{c.tin ?? 'No TIN'} · {c.email ?? '—'}</div>
                </div>
                {c.profile_id && <Globe size={14} className="text-green-600 flex-shrink-0" title="On client portal" />}
                <div className="text-xs text-gray-400 flex-shrink-0">{fmtDate(c.created_at)}</div>
              </Link>
            ))}
          </div>
        </div>

        <div className="card">
          <div className="card-header"><Clock size={16} /> Tax Returns in Progress
            <Link to="/admin/tax-returns" className="ml-auto text-xs text-primary-500 hover:underline flex items-center gap-1">View all <ArrowRight size={12} /></Link>
          </div>
          <div className="divide-y divide-gray-50">
            {k.openReturns.length === 0 ? <div className="p-8 text-center text-gray-400 text-sm">No pending returns</div> : k.openReturns.slice(0, 6).map(r => (
              <Link key={r.id} to={`/admin/clients/${r.client_id}`} className="flex items-center gap-3 px-5 py-3 hover:bg-gray-50">
                <div className="flex-1 min-w-0">
                  <div className="text-sm font-semibold text-gray-800 truncate">{r.clients?.full_name ?? '—'}</div>
                  <div className={`text-xs ${r.due_date && r.due_date < todayISO() ? 'text-red-600 font-semibold' : 'text-gray-400'}`}>Y/A {r.year} · Due {fmtDate(r.due_date)}</div>
                </div>
                <span className={r.status === 'in_progress' ? 'badge-blue' : 'badge-yellow'}>{r.status.replace('_', ' ')}</span>
              </Link>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
