import { Link, useOutletContext } from 'react-router-dom';
import { Hash } from 'lucide-react';
import IrdCodeFinder from '../../components/IrdCodeFinder';

export default function ClientIrdCodes() {
  const features = useOutletContext() ?? {};
  if (features.loaded && features.ird_codes === false) return (
    <div className="card p-8 text-center space-y-3"><Hash size={36} className="mx-auto text-gray-300" /><p className="text-gray-600">IRD payment codes are not available right now.</p><Link to="/client" className="btn-secondary text-sm inline-flex">Back to dashboard</Link></div>
  );
  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-2xl font-bold text-primary-800 flex items-center gap-2"><Hash size={22} className="text-gold-500" /> IRD Payment Codes</h1>
        <p className="text-sm text-gray-500">Pick the tax and month — get the codes for your paying-in slip or online payment · IRD ගෙවීම් කේත</p>
      </div>
      <IrdCodeFinder mode="client" />
    </div>
  );
}
