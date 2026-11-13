// V64 — VAT Invoice for team members of a business (accountant, invoice operator, viewer, purchaser, approver).
// They sign in with their own TaxMate login and see only the VAT module of the businesses that added them.
import { useEffect, useState } from 'react';
import { Navigate, useSearchParams } from 'react-router-dom';
import { LogOut, Building2, Loader2 } from 'lucide-react';
import { useAuth } from '../contexts/AuthContext';
import { myWorkspaces } from '../lib/vat/api';
import { ROLES, SUBSCRIPTION } from '../lib/vat/format';
import VatApp from '../components/vat/VatApp';

export default function VatWorkspace() {
  const { user, profile, loading, signOut } = useAuth();
  const [list, setList] = useState(null);
  const [sp, setSp] = useSearchParams();
  const biz = sp.get('biz');
  useEffect(() => { if (user) myWorkspaces().then(setList).catch(() => setList([])); }, [user]);
  if (loading) return <div className="p-10 text-center"><Loader2 className="mx-auto animate-spin text-gray-400" /></div>;
  if (!user) return <Navigate to="/login?next=/vat" replace />;
  if (profile?.role === 'admin') return <Navigate to="/admin/vat" replace />;
  const current = list?.find((w) => w.client_id === biz) || (list?.length === 1 ? list[0] : null);
  return (
    <div className="min-h-screen bg-gray-50">
      <header className="flex items-center gap-3 bg-primary-800 px-4 py-3 text-white">
        <div className="text-lg font-black">Tax<span className="text-yellow-400">Mate</span> <span className="text-sm font-normal text-primary-200">VAT Invoice</span></div>
        <span className="flex-1" />
        {list?.length > 1 && (
          <select className="rounded-lg bg-primary-700 px-2 py-1 text-sm" value={current?.client_id || ''} onChange={(e) => setSp({ biz: e.target.value })} aria-label="Business">
            <option value="">Choose a business…</option>{list.map((w) => <option key={w.client_id} value={w.client_id}>{w.name}</option>)}
          </select>
        )}
        <button type="button" onClick={signOut} className="flex items-center gap-1 text-sm text-primary-100 hover:text-white"><LogOut size={15} /> Sign out</button>
      </header>
      <main className="mx-auto max-w-7xl p-3 sm:p-5">
        {!list ? <div className="p-10 text-center"><Loader2 className="mx-auto animate-spin text-gray-400" /></div>
          : list.length === 0 ? (
            <div className="card mx-auto max-w-md p-8 text-center text-sm text-gray-600"><Building2 size={36} className="mx-auto text-gray-300" /><div className="mt-2 font-semibold">No business has added you yet</div>
              Ask the business owner to add <b>{user.email}</b> in VAT Invoice → Settings → Users &amp; roles.</div>
          ) : !current ? (
            <div className="mx-auto grid max-w-2xl gap-2">
              {list.map((w) => (
                <button key={w.client_id} type="button" onClick={() => setSp({ biz: w.client_id })} className="card flex items-center gap-3 p-4 text-left hover:border-primary-300">
                  <Building2 size={22} className="text-primary-700" /><div className="flex-1"><div className="font-semibold">{w.name}</div><div className="text-xs text-gray-500">{ROLES[w.role]} · {SUBSCRIPTION[w.status]?.label}</div></div>
                </button>
              ))}
            </div>
          ) : <VatApp key={current.client_id} clientId={current.client_id} syncUrl />}
      </main>
    </div>
  );
}
