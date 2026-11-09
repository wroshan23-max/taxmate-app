// V57 — Client: APIT & quarterly instalments TaxMate worked out (read only)
import { useEffect, useState } from 'react';
import { Wallet } from 'lucide-react';
import { fmtRs, fmtDate } from '../lib/supabase';
import { loadPayments, periodLabel } from '../lib/taxPayments';

export default function TaxPaymentsClient({ clientId }) {
  const [rows, setRows] = useState([]);
  useEffect(() => { loadPayments(clientId).then(setRows).catch(() => setRows([])); }, [clientId]);
  if (!rows.length) return null;
  const today = new Date().toISOString().slice(0, 10);
  const years = [...new Set(rows.map(r => r.year))];
  return (
    <div className="card">
      <div className="card-header"><Wallet size={16} /> Tax payments — APIT &amp; instalments <span className="font-normal text-gray-400 text-xs">· බදු ගෙවීම්</span></div>
      <div className="p-4 space-y-4">
        {years.map(y => {
          const list = rows.filter(r => r.year === y).sort((a, b) => (a.kind === b.kind ? a.period.localeCompare(b.period) : a.kind === 'instalment' ? -1 : 1));
          const paid = list.filter(r => r.status === 'paid').reduce((a, r) => a + Number(r.paid_amount ?? r.amount), 0);
          return (
            <div key={y}>
              <div className="flex items-center text-sm font-semibold text-gray-700 mb-1">Y/A {y}<span className="ml-auto text-xs font-normal text-gray-500">Paid so far: <b className="text-green-700">{fmtRs(paid)}</b> — counted in your tax return</span></div>
              <div className="divide-y divide-gray-50">
                {list.map(r => {
                  const late = r.status !== 'paid' && r.due_date && r.due_date < today;
                  return (
                    <div key={r.id} className="flex items-center gap-2 py-1.5 text-sm">
                      <span className="flex-1 text-gray-700">{periodLabel(r)}</span>
                      <span className="tabular-nums font-semibold w-28 text-right">{fmtRs(r.amount)}</span>
                      <span className={`text-xs w-40 text-right ${r.status === 'paid' ? 'text-green-700' : late ? 'text-red-600 font-semibold' : 'text-amber-700'}`}>
                        {r.status === 'paid' ? `✓ Paid${r.paid_on ? ` ${fmtDate(r.paid_on)}` : ''}` : `${late ? 'Overdue — was due' : 'Due'} ${fmtDate(r.due_date)}`}
                      </span>
                    </div>
                  );
                })}
              </div>
            </div>
          );
        })}
        <p className="text-[11px] text-gray-500">Worked out by TaxMate. Paid amounts are deducted from the tax in your annual return. Tell TaxMate when you pay so we can record it.</p>
      </div>
    </div>
  );
}
