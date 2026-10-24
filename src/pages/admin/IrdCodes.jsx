import { Hash, ExternalLink } from 'lucide-react';
import IrdCodeFinder from '../../components/IrdCodeFinder';

export default function IrdCodes() {
  return (
    <div className="space-y-4">
      <div className="flex items-end gap-3 flex-wrap">
        <div>
          <h1 className="text-2xl font-bold text-primary-800 flex items-center gap-2"><Hash size={24} className="text-gold-500" /> IRD Payment Codes</h1>
          <p className="text-sm text-gray-500">Tax Type Code, Payment Period Code, category and due date for any IRD payment · IRD ගෙවීම් කේත</p>
        </div>
        <a href="/ird-codes" target="_blank" rel="noreferrer" className="ml-auto text-sm font-semibold text-primary-700 hover:underline inline-flex items-center gap-1">Public page to share <ExternalLink size={13} /></a>
      </div>
      <IrdCodeFinder mode="admin" />
    </div>
  );
}
