import { ListTree, ExternalLink } from 'lucide-react';
import ActivityCodeFinder from '../../components/ActivityCodeFinder';

export default function ActivityCodes() {
  return (
    <div className="space-y-4">
      <div className="flex items-end gap-3 flex-wrap">
        <div>
          <h1 className="text-2xl font-bold text-primary-800 flex items-center gap-2"><ListTree size={24} className="text-gold-500" /> RAMIS Activity Codes</h1>
          <p className="text-sm text-gray-500">All IRD economic activity codes for RAMIS registration and returns · ව්‍යාපාරික ක්‍රියාකාරකම් කේත</p>
        </div>
        <a href="/activity-codes" target="_blank" rel="noreferrer" className="ml-auto text-sm font-semibold text-primary-700 hover:underline inline-flex items-center gap-1">Public page to share <ExternalLink size={13} /></a>
      </div>
      <ActivityCodeFinder mode="admin" />
    </div>
  );
}
