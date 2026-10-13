import { useEffect, useState } from 'react';
import { supabase, fmtRs, fmtDate } from '../../lib/supabase';
import { useAuth } from '../../contexts/AuthContext';
import { Calculator, ChevronDown, ChevronUp } from 'lucide-react';

export default function ClientCalculations() {
  const { user } = useAuth();
  const [calcs, setCalcs] = useState([]);
  const [loading, setLoading] = useState(true);
  const [expanded, setExpanded] = useState(null);
  const [clientId, setClientId] = useState(null);

  useEffect(() => {
    const load = async () => {
      const { data: cl } = await supabase.from('clients').select('id').eq('profile_id', user.id).single();
      if (!cl) { setLoading(false); return; }
      setClientId(cl.id);
      const { data } = await supabase
        .from('iit_calculations')
        .select('*')
        .eq('client_id', cl.id)
        .eq('shared_with_client', true)
        .order('created_at', { ascending: false });
      setCalcs(data ?? []);
      setLoading(false);
    };
    load();
  }, [user.id]);

  const renderAnnualResult = (r) => {
    if (!r) return null;
    return (
      <div className="space-y-3">
        <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
          {[
            { label: 'Total Assessable', value: fmtRs(r.totalAssessable) },
            { label: 'Qualifying Payments', value: fmtRs(r.totalQP) },
            { label: 'Taxable Income', value: fmtRs(r.taxableStd) },
            { label: 'Gross Tax', value: fmtRs(r.grossTax) },
            { label: 'WHT/APIT Credits', value: fmtRs(r.totalWHT) },
            { label: 'Net Tax Payable', value: fmtRs(r.netTax), highlight: true },
          ].map(({ label, value, highlight }) => (
            <div key={label} className={`rounded-lg p-3 ${highlight ? 'bg-primary-50 border border-primary-200' : 'bg-gray-50'}`}>
              <div className="text-xs text-gray-500 mb-0.5">{label}</div>
              <div className={`font-bold text-sm ${highlight ? 'text-primary-700' : 'text-gray-800'}`}>{value}</div>
            </div>
          ))}
        </div>
        {r.stdResult?.slabs?.length > 0 && (
          <div>
            <div className="text-xs font-semibold text-gray-500 mb-2">Tax Slabs</div>
            <div className="bg-white border border-gray-100 rounded-lg overflow-hidden">
              {r.stdResult.slabs.map((slab, i) => (
                <div key={i} className="flex justify-between items-center px-3 py-2 border-b border-gray-50 last:border-0">
                  <span className="text-xs text-gray-600">{slab.label}</span>
                  <span className="text-xs font-semibold text-primary-700">{fmtRs(slab.tax)}</span>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    );
  };

  const renderQuarterlyResult = (r) => {
    if (!r) return null;
    return (
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        {[
          { label: 'Annual Tax (A)', value: fmtRs(r.A) },
          { label: 'Credits (C)', value: fmtRs(r.C) },
          { label: 'Remaining (B)', value: r.B + ' quarters' },
          { label: 'Instalment Due', value: fmtRs(r.instalment), highlight: true },
        ].map(({ label, value, highlight }) => (
          <div key={label} className={`rounded-lg p-3 ${highlight ? 'bg-primary-50 border border-primary-200' : 'bg-gray-50'}`}>
            <div className="text-xs text-gray-500 mb-0.5">{label}</div>
            <div className={`font-bold text-sm ${highlight ? 'text-primary-700' : 'text-gray-800'}`}>{value}</div>
          </div>
        ))}
      </div>
    );
  };

  if (loading) return <div className="flex items-center justify-center h-64 text-gray-400">Loading...</div>;

  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-2xl font-bold text-primary-800">My Calculations</h1>
        <p className="text-sm text-gray-500">{calcs.length} calculation{calcs.length !== 1 ? 's' : ''} shared by TaxMate</p>
      </div>

      {calcs.length === 0 ? (
        <div className="card p-12 text-center">
          <Calculator size={40} className="mx-auto text-gray-200 mb-3" />
          <div className="text-gray-400">No calculations shared yet</div>
          <div className="text-xs text-gray-300 mt-1">Your tax advisor will share calculations with you here</div>
        </div>
      ) : (
        <div className="space-y-3">
          {calcs.map(calc => (
            <div key={calc.id} className="card overflow-hidden">
              <div
                className="flex items-center gap-3 p-4 cursor-pointer hover:bg-gray-50 transition-colors"
                onClick={() => setExpanded(expanded === calc.id ? null : calc.id)}
              >
                <div className="w-10 h-10 rounded-xl bg-primary-100 flex items-center justify-center flex-shrink-0">
                  <Calculator size={18} className="text-primary-700" />
                </div>
                <div className="flex-1">
                  <div className="font-semibold text-sm text-gray-800">
                    {calc.calc_type === 'quarterly' ? 'Quarterly Instalment' : 'Annual IIT Calculation'} · {calc.year}
                  </div>
                  <div className="text-xs text-gray-400">{fmtDate(calc.created_at)}</div>
                </div>
                <div className="text-right">
                  <div className="font-bold text-primary-700 text-sm">
                    {calc.calc_type === 'quarterly'
                      ? fmtRs(calc.result_data?.instalment)
                      : fmtRs(calc.result_data?.netTax)}
                  </div>
                  <div className="text-xs text-gray-400">
                    {calc.calc_type === 'quarterly' ? 'per quarter' : 'net tax'}
                  </div>
                </div>
                {expanded === calc.id ? <ChevronUp size={16} className="text-gray-400 flex-shrink-0" /> : <ChevronDown size={16} className="text-gray-400 flex-shrink-0" />}
              </div>

              {expanded === calc.id && (
                <div className="border-t border-gray-100 p-4 bg-gray-50">
                  {calc.calc_type === 'quarterly'
                    ? renderQuarterlyResult(calc.result_data)
                    : renderAnnualResult(calc.result_data)}
                  {calc.notes && (
                    <div className="mt-3 bg-white rounded-lg p-3 border border-gray-100">
                      <div className="text-xs font-semibold text-gray-400 mb-1">Notes from advisor</div>
                      <p className="text-sm text-gray-700">{calc.notes}</p>
                    </div>
                  )}
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
