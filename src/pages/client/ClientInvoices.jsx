import { useEffect, useState } from 'react';
import { supabase, fmtRs, fmtDate } from '../../lib/supabase';
import { useAuth } from '../../contexts/AuthContext';
import { Receipt } from 'lucide-react';

const statusBadge = (s) => {
  const map = { unpaid: 'badge-red', paid: 'badge-green', overdue: 'badge-yellow' };
  return <span className={map[s] ?? 'badge-gray'}>{s}</span>;
};

export default function ClientInvoices() {
  const { user } = useAuth();
  const [invoices, setInvoices] = useState([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState('all');

  useEffect(() => {
    const load = async () => {
      const { data: cl } = await supabase.from('clients').select('id').eq('profile_id', user.id).single();
      if (!cl) { setLoading(false); return; }
      const { data } = await supabase
        .from('invoices')
        .select('*, invoice_items(*)')
        .eq('client_id', cl.id)
        .order('created_at', { ascending: false });
      setInvoices(data ?? []);
      setLoading(false);
    };
    load();
  }, [user.id]);

  const filtered = invoices.filter(i => filter === 'all' || i.status === filter);
  const totalUnpaid = invoices.filter(i => i.status === 'unpaid').reduce((s, i) => s + (i.total_amount || 0), 0);

  if (loading) return <div className="flex items-center justify-center h-64 text-gray-400">Loading...</div>;

  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-2xl font-bold text-primary-800">My Invoices</h1>
        {totalUnpaid > 0 && (
          <p className="text-sm text-gray-500">Outstanding: <strong className="text-red-600">{fmtRs(totalUnpaid)}</strong></p>
        )}
      </div>

      <div className="flex gap-2">
        {['all', 'unpaid', 'paid', 'overdue'].map(s => (
          <button key={s} onClick={() => setFilter(s)}
            className={`px-3 py-1 rounded-full text-xs font-semibold capitalize transition-all ${filter === s ? 'bg-primary-700 text-white' : 'bg-gray-100 text-gray-600 hover:bg-gray-200'}`}>
            {s}
          </button>
        ))}
      </div>

      {filtered.length === 0 ? (
        <div className="card p-12 text-center">
          <Receipt size={40} className="mx-auto text-gray-200 mb-3" />
          <div className="text-gray-400">No invoices found</div>
        </div>
      ) : (
        <div className="space-y-4">
          {filtered.map(inv => (
            <div key={inv.id} className="card overflow-hidden">
              <div className="flex items-center justify-between p-4 border-b border-gray-50">
                <div>
                  <div className="font-bold text-gray-800 font-mono text-sm">{inv.invoice_no}</div>
                  <div className="text-xs text-gray-400">Issued: {fmtDate(inv.issue_date)} · Due: {fmtDate(inv.due_date)}</div>
                </div>
                <div className="flex items-center gap-3">
                  <div className="font-bold text-primary-700">{fmtRs(inv.total_amount)}</div>
                  {statusBadge(inv.status)}
                </div>
              </div>

              {inv.invoice_items?.length > 0 && (
                <div className="px-4 py-3 bg-gray-50">
                  <div className="text-xs font-semibold text-gray-400 mb-2">Items</div>
                  <div className="space-y-1">
                    {inv.invoice_items.map((item, i) => (
                      <div key={i} className="flex justify-between text-sm">
                        <span className="text-gray-700">{item.description} {item.quantity > 1 ? `× ${item.quantity}` : ''}</span>
                        <span className="font-semibold text-gray-800">{fmtRs(item.amount)}</span>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {inv.notes && (
                <div className="px-4 py-2 border-t border-gray-50 text-xs text-gray-500">{inv.notes}</div>
              )}

              {inv.status === 'unpaid' && (
                <div className="px-4 py-3 bg-amber-50 border-t border-amber-100">
                  <p className="text-xs text-amber-700">
                    Please contact TaxMate to arrange payment. WhatsApp: <a href="https://wa.me/94XXXXXXXXX" className="font-semibold underline">+94 XX XXX XXXX</a>
                  </p>
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
