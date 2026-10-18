import { useEffect, useState } from 'react';
import { supabase, fmtRs, fmtDate } from '../../lib/supabase';
import { useAuth } from '../../contexts/AuthContext';
import toast from 'react-hot-toast';
import { Receipt, Printer } from 'lucide-react';
import { isSent, isOverdue, openInvoice } from '../../lib/invoice';

const STATUS_CLS = { unpaid: 'bg-blue-100 text-blue-700', overdue: 'bg-blue-100 text-blue-700', paid: 'bg-green-100 text-green-700' };

export default function ClientInvoices() {
  const { user } = useAuth();
  const [invoices, setInvoices] = useState([]);
  const [banks, setBanks] = useState([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState('all');

  useEffect(() => {
    const load = async () => {
      const { data: cl } = await supabase.from('clients').select('id').eq('profile_id', user.id).single();
      if (!cl) { setLoading(false); return; }
      const [{ data }, { data: bk }] = await Promise.all([
        supabase.from('invoices')
          .select('*, clients(full_name, tin, nic, mobile, email, address), invoice_items(*)')
          .eq('client_id', cl.id).neq('status', 'draft')
          .order('issue_date', { ascending: false }),
        supabase.from('bank_accounts').select('*'),
      ]);
      setInvoices(data ?? []);
      setBanks(bk ?? []);
      setLoading(false);
    };
    load();
  }, [user.id]);

  const filtered = invoices.filter(i => filter === 'all' || (filter === 'unpaid' ? isSent(i.status) : i.status === filter));
  const outstanding = invoices.filter(i => isSent(i.status)).reduce((s, i) => s + Number(i.total_amount || 0), 0);
  const print = (inv) => {
    const bank = banks.find(b => b.id === inv.bank_account_id) ?? null;
    if (!openInvoice(inv, inv.invoice_items ?? [], bank)) toast.error('Pop-up blocked — allow pop-ups for this site');
  };

  if (loading) return <div className="flex items-center justify-center h-64 text-gray-400">Loading...</div>;

  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-2xl font-bold text-primary-800">My Invoices</h1>
        {outstanding > 0 && <p className="text-sm text-gray-500">Outstanding: <strong className="text-red-600">{fmtRs(outstanding)}</strong></p>}
      </div>

      <div className="flex gap-2">
        {[['all', 'All'], ['unpaid', 'Unpaid'], ['paid', 'Paid']].map(([s, l]) => (
          <button key={s} onClick={() => setFilter(s)}
            className={`px-3 py-1 rounded-full text-xs font-semibold transition-all ${filter === s ? 'bg-primary-700 text-white' : 'bg-gray-100 text-gray-600 hover:bg-gray-200'}`}>
            {l}
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
              <div className="flex items-center justify-between gap-3 p-4 border-b border-gray-50 flex-wrap">
                <div>
                  <div className="font-bold text-gray-800 font-mono text-sm">{inv.invoice_no}</div>
                  <div className="text-xs text-gray-400">
                    Issued: {fmtDate(inv.issue_date)} · Due: {inv.due_date ? fmtDate(inv.due_date) : 'On receipt'}
                    {isOverdue(inv) && <span className="ml-1 font-bold text-red-600">OVERDUE</span>}
                  </div>
                </div>
                <div className="flex items-center gap-3">
                  <div className="font-bold text-primary-700">{fmtRs(inv.total_amount)}</div>
                  <span className={`text-xs font-semibold px-2 py-0.5 rounded-md ${STATUS_CLS[inv.status] ?? 'bg-gray-100'}`}>
                    {inv.status === 'paid' ? '✅ Paid' : '⏳ Unpaid'}
                  </span>
                  <button onClick={() => print(inv)} className="btn-secondary text-xs py-1 px-2.5"><Printer size={13} /> View / PDF</button>
                </div>
              </div>

              {inv.invoice_items?.length > 0 && (
                <div className="px-4 py-3 bg-gray-50">
                  <div className="space-y-1">
                    {[...inv.invoice_items].sort((a, b) => (a.sort_order ?? 0) - (b.sort_order ?? 0)).map((item, i) => (
                      <div key={i} className="flex justify-between text-sm">
                        <span className="text-gray-700">{item.description} {item.quantity > 1 ? `× ${item.quantity}` : ''}</span>
                        <span className="font-semibold text-gray-800">{fmtRs(item.amount)}</span>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {isSent(inv.status) && (
                <div className="px-4 py-3 bg-amber-50 border-t border-amber-100">
                  <p className="text-xs text-amber-700">
                    Payment details are on the invoice. Questions? WhatsApp{' '}
                    <a href="https://wa.me/94719404604" target="_blank" rel="noreferrer" className="font-semibold underline">0719 404 604</a>
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

