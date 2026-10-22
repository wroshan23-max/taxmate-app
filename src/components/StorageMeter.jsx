import { useEffect, useState } from 'react';
import { HardDrive, Database, AlertTriangle } from 'lucide-react';
import { supabase } from '../lib/supabase';
import { fmtBytes } from '../lib/documents';

/** Supabase free-plan usage: document storage (1 GB) + database (500 MB). Admin only. */
export default function StorageMeter() {
  const [u, setU] = useState(null);
  useEffect(() => { supabase.rpc('storage_usage').then(({ data }) => data && setU(data)); }, []);
  if (!u) return null;

  const bars = [
    { icon: HardDrive, label: 'Document storage', used: Number(u.bytes), limit: Number(u.limit_bytes), sub: `${u.files} file${u.files === 1 ? '' : 's'}` },
    { icon: Database, label: 'Database', used: Number(u.db_bytes), limit: Number(u.db_limit_bytes), sub: 'clients, returns, invoices…' },
  ];
  const warn = bars.some(b => b.used / b.limit >= 0.8);

  return (
    <div className="card overflow-hidden">
      <div className="card-header"><HardDrive size={16} /> Free plan usage
        <span className="ml-auto text-[10px] font-semibold text-gray-400 uppercase">Supabase free</span>
      </div>
      <div className="p-4 space-y-3">
        {bars.map(({ icon: Icon, label, used, limit, sub }) => {
          const pct = Math.min(100, (used / limit) * 100);
          const tone = pct >= 90 ? 'from-red-500 to-red-600' : pct >= 80 ? 'from-amber-400 to-orange-500' : 'from-primary-500 to-indigo-500';
          return (
            <div key={label}>
              <div className="flex items-center gap-1.5 text-xs">
                <Icon size={13} className="text-gray-400" /><span className="font-semibold text-gray-700">{label}</span>
                <span className="ml-auto text-gray-500">{fmtBytes(used)} / {fmtBytes(limit)}</span>
              </div>
              <div className="mt-1 h-2 rounded-full bg-gray-100 overflow-hidden">
                <div className={`h-full rounded-full bg-gradient-to-r ${tone} transition-all duration-700`} style={{ width: `${Math.max(pct, 1.5)}%` }} />
              </div>
              <div className="text-[10px] text-gray-400 mt-0.5">{pct.toFixed(pct < 10 ? 1 : 0)}% used · {sub}</div>
            </div>
          );
        })}
        {warn && (
          <div className="flex gap-2 text-xs rounded-lg bg-amber-50 border border-amber-200 text-amber-800 p-2.5">
            <AlertTriangle size={14} className="flex-shrink-0 mt-0.5" />
            <span>Over 80% used. Delete old years' documents (client → Documents → Delete year) or upgrade to Supabase Pro ($25/month, 100 GB).</span>
          </div>
        )}
      </div>
    </div>
  );
}
