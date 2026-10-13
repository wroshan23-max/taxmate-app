import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { supabase, fmtRs, fmtDate } from '../../lib/supabase';
import { Users, FileText, Receipt, Calculator, Clock, CheckCircle, AlertCircle, ArrowRight } from 'lucide-react';

function StatCard({ icon: Icon, label, value, color, to }) {
  const content = (
    <div className={`card p-5 flex items-center gap-4 hover:shadow-md transition-shadow ${to ? 'cursor-pointer' : ''}`}>
      <div className={`w-12 h-12 rounded-xl flex items-center justify-center flex-shrink-0 ${color}`}>
        <Icon size={22} className="text-white" />
      </div>
      <div>
        <div className="text-2xl font-bold text-gray-900">{value}</div>
        <div className="text-sm text-gray-500">{label}</div>
      </div>
    </div>
  );
  return to ? <Link to={to}>{content}</Link> : content;
}

export default function Dashboard() {
  const [stats, setStats] = useState({ clients: 0, returns: 0, invoices: 0, pending: 0 });
  const [recentClients, setRecentClients] = useState([]);
  const [pendingReturns, setPendingReturns] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    loadData();
  }, []);

  const loadData = async () => {
    const [{ count: clientCount }, { count: returnCount }, { count: invCount }, { count: pendingCount }, { data: clients }, { data: returns }] =
      await Promise.all([
        supabase.from('clients').select('*', { count: 'exact', head: true }),
        supabase.from('tax_returns').select('*', { count: 'exact', head: true }),
        supabase.from('invoices').select('*', { count: 'exact', head: true }),
        supabase.from('client_update_requests').select('*', { count: 'exact', head: true }).eq('status', 'pending'),
        supabase.from('clients').select('id, full_name, tin, email, created_at').order('created_at', { ascending: false }).limit(5),
        supabase.from('tax_returns').select('id, year, status, due_date, clients(full_name)').in('status', ['pending', 'in_progress']).order('due_date').limit(5),
      ]);

    setStats({ clients: clientCount ?? 0, returns: returnCount ?? 0, invoices: invCount ?? 0, pending: pendingCount ?? 0 });
    setRecentClients(clients ?? []);
    setPendingReturns(returns ?? []);
    setLoading(false);
  };

  const statusBadge = (s) => {
    const map = { pending: 'badge-yellow', in_progress: 'badge-blue', submitted: 'badge-gray', completed: 'badge-green' };
    return <span className={map[s] ?? 'badge-gray'}>{s?.replace('_', ' ') ?? '—'}</span>;
  };

  if (loading) return <div className="flex items-center justify-center h-64 text-gray-400">Loading...</div>;

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-primary-800">Dashboard</h1>
        <p className="text-sm text-gray-500 mt-0.5">TaxMate Solutions — Overview</p>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <StatCard icon={Users} label="Total Clients" value={stats.clients} color="bg-primary-600" to="/admin/clients" />
        <StatCard icon={FileText} label="Tax Returns" value={stats.returns} color="bg-green-600" to="/admin/tax-returns" />
        <StatCard icon={Receipt} label="Invoices" value={stats.invoices} color="bg-gold-500" to="/admin/invoices" />
        <StatCard icon={AlertCircle} label="Pending Requests" value={stats.pending} color="bg-red-500" to="/admin/requests" />
      </div>

      {/* Two columns */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Recent clients */}
        <div className="card">
          <div className="card-header">
            <Users size={16} />
            Recent Clients
            <Link to="/admin/clients" className="ml-auto text-xs text-primary-500 hover:underline flex items-center gap-1">
              View all <ArrowRight size={12} />
            </Link>
          </div>
          <div className="divide-y divide-gray-50">
            {recentClients.length === 0 ? (
              <div className="p-8 text-center text-gray-400 text-sm">No clients yet</div>
            ) : recentClients.map(c => (
              <Link key={c.id} to={`/admin/clients/${c.id}`} className="flex items-center gap-3 px-5 py-3 hover:bg-gray-50 transition-colors">
                <div className="w-9 h-9 rounded-full bg-primary-100 flex items-center justify-center text-primary-700 font-bold text-sm flex-shrink-0">
                  {c.full_name?.[0] ?? '?'}
                </div>
                <div className="flex-1 min-w-0">
                  <div className="text-sm font-semibold text-gray-800 truncate">{c.full_name}</div>
                  <div className="text-xs text-gray-400">{c.tin ?? 'No TIN'} · {c.email ?? '—'}</div>
                </div>
                <div className="text-xs text-gray-400 flex-shrink-0">{fmtDate(c.created_at)}</div>
              </Link>
            ))}
          </div>
        </div>

        {/* Pending tax returns */}
        <div className="card">
          <div className="card-header">
            <Clock size={16} />
            Pending Tax Returns
            <Link to="/admin/tax-returns" className="ml-auto text-xs text-primary-500 hover:underline flex items-center gap-1">
              View all <ArrowRight size={12} />
            </Link>
          </div>
          <div className="divide-y divide-gray-50">
            {pendingReturns.length === 0 ? (
              <div className="p-8 text-center text-gray-400 text-sm">No pending returns</div>
            ) : pendingReturns.map(r => (
              <div key={r.id} className="flex items-center gap-3 px-5 py-3">
                <div className="flex-1 min-w-0">
                  <div className="text-sm font-semibold text-gray-800 truncate">{r.clients?.full_name ?? '—'}</div>
                  <div className="text-xs text-gray-400">Y/A {r.year} · Due: {fmtDate(r.due_date)}</div>
                </div>
                {statusBadge(r.status)}
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* Quick actions */}
      <div className="card p-5">
        <div className="text-sm font-semibold text-gray-600 mb-3">Quick Actions</div>
        <div className="flex flex-wrap gap-3">
          <Link to="/admin/clients" className="btn-primary text-sm py-1.5">
            <Users size={14} /> Add Client
          </Link>
          <Link to="/admin/calculator" className="btn-secondary text-sm py-1.5">
            <Calculator size={14} /> Run Calculation
          </Link>
          <Link to="/admin/invoices" className="btn-secondary text-sm py-1.5">
            <Receipt size={14} /> New Invoice
          </Link>
        </div>
      </div>
    </div>
  );
}
