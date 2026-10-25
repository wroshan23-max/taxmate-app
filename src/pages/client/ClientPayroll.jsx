import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { Users, Loader2, Crown } from 'lucide-react';
import { useAuth } from '../../contexts/AuthContext';
import { supabase } from '../../lib/supabase';
import { myPayrollAccess } from '../../lib/plans';
import PayrollModule from '../../components/PayrollModule';

export default function ClientPayroll() {
  const { profile, user } = useAuth();
  const [acc, setAcc] = useState(null);
  const [hasData, setHasData] = useState(false);
  useEffect(() => {
    myPayrollAccess().then(setAcc).catch(() => setAcc({ on: false }));
    supabase.from('payroll_runs').select('id', { count: 'exact', head: true }).then(({ count }) => setHasData((count ?? 0) > 0));
  }, []);

  if (!acc || !profile) return <div className="card p-10 text-center"><Loader2 className="animate-spin mx-auto text-gray-400" /></div>;
  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-2xl font-bold text-primary-800 flex items-center gap-2"><Users size={24} /> Payroll</h1>
        <p className="text-sm text-gray-500">Staff salaries, APIT, EPF / ETF and payslips · වැටුප් ගණනය
          {acc.on && <span className="ml-2 text-[11px] font-semibold px-2 py-0.5 rounded-full bg-emerald-50 text-emerald-700 border border-emerald-200">{acc.plan ? `Included in your ${acc.plan} plan` : 'Add-on active'}</span>}</p>
      </div>
      {acc.on || hasData
        ? <PayrollModule clientId={profile.client_id} clientName={profile.full_name} canEdit={acc.on} userId={user?.id} />
        : (
          <div className="card p-8 text-center space-y-3">
            <Users size={40} className="mx-auto text-gray-200" />
            <div className="font-semibold text-gray-700">Run your staff payroll with TaxMate</div>
            <p className="text-sm text-gray-500 max-w-md mx-auto">Monthly APIT, EPF / ETF and payslips worked out for you. Included in the Standard and Premium plans — or add it on its own.</p>
            <Link to="/client/plan#addons" className="btn-primary text-sm inline-flex"><Crown size={15} /> See plans & add-ons</Link>
          </div>
        )}
    </div>
  );
}
