import { Link, useOutletContext } from 'react-router-dom';
import { ListTree } from 'lucide-react';
import ActivityCodeFinder from '../../components/ActivityCodeFinder';

export default function ClientActivityCodes() {
  const features = useOutletContext() ?? {};
  if (features.loaded && features.ird_codes === false) return (
    <div className="card p-8 text-center space-y-3"><ListTree size={36} className="mx-auto text-gray-300" /><p className="text-gray-600">Activity codes are not available right now.</p><Link to="/client" className="btn-secondary text-sm inline-flex">Back to dashboard</Link></div>
  );
  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-2xl font-bold text-primary-800 flex items-center gap-2"><ListTree size={22} className="text-gold-500" /> RAMIS Activity Codes</h1>
        <p className="text-sm text-gray-500">Find the code for your business or profession in RAMIS · ඔබේ ව්‍යාපාරයට ගැළපෙන කේතය</p>
      </div>
      <ActivityCodeFinder mode="client" />
    </div>
  );
}
