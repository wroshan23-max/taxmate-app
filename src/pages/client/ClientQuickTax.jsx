import { Link, useOutletContext } from 'react-router-dom';
import { Zap, Percent } from 'lucide-react';
import SimpleTaxCalculator from '../../components/SimpleTaxCalculator';

export default function ClientQuickTax() {
  const features = useOutletContext() ?? {};
  if (features.loaded && features.tax_calculator === false) return (
    <div className="card p-8 text-center space-y-3"><Percent size={36} className="mx-auto text-gray-300" /><p className="text-gray-600">The tax calculator is not available right now.</p><Link to="/client" className="btn-secondary text-sm inline-flex">Back to dashboard</Link></div>
  );
  return (
    <div className="space-y-4">
      <div className="flex items-end gap-3 flex-wrap">
        <div>
          <h1 className="text-2xl font-bold text-primary-800 flex items-center gap-2"><Zap size={22} className="text-gold-500" /> Quick Tax Check</h1>
          <p className="text-sm text-gray-500">Just type your income — see your tax instantly · ඉක්මන් බදු ගණනය</p>
        </div>
        <Link to="/client/tax-calculator" className="ml-auto text-sm font-semibold text-primary-700 hover:underline">Need more detail? Open the full calculator →</Link>
      </div>
      <SimpleTaxCalculator mode="client" />
    </div>
  );
}
