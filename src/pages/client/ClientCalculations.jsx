import { useEffect, useState } from 'react';
import { supabase, fmtRs, fmtDate } from '../../lib/supabase';
import { useAuth } from '../../contexts/AuthContext';
import { Calculator, ChevronDown, ChevronUp, Printer } from 'lucide-react';
import { summarizeCalc, KIND_LABEL } from '../../lib/iitCalc';
import { buildStatementHtml, openStatement } from '../../lib/iitStatement';

export default function ClientCalculations() {
  const { user } = useAuth();
  const [calcs, setCalcs] = useState([]);
  const [loading, setLoading] = useState(true);
  const [expanded, setExpanded] = useState(null);
  const [clientId, setClientId] = useState(null);
  const [client, setClient] = useState(null);

  useEffect(() => {
    const load = async () => {
      const { data: cl } = await supabase.from('clients').select('id, full_name, tin, nic, address, employer, resident_status').eq('profile_id', user.id).single();
      if (!cl) { setLoading(false); return; }
      setClientId(cl.id);
      setClient(cl);
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
                    {KIND_LABEL[summarizeCalc(calc).kind]} · {calc.year}
                  </div>
                  <div className="text-xs text-gray-400">{fmtDate(calc.created_at)}</div>
                </div>
                <div className="text-right">
                  <div className="font-bold text-primary-700 text-sm">{fmtRs(Math.abs(summarizeCalc(calc).amount))}</div>
                  <div className="text-xs text-gray-400">
                    {{ payable: 'tax payable', refund: 'refund', nil: 'nil tax', instalment: 'per quarter' }[summarizeCalc(calc).status]}
                  </div>
                </div>
                {expanded === calc.id ? <ChevronUp size={16} className="text-gray-400 flex-shrink-0" /> : <ChevronDown size={16} className="text-gray-400 flex-shrink-0" />}
              </div>

              {expanded === calc.id && (
                <div className="border-t border-gray-100 p-4 bg-gray-50">
                  <div className="flex justify-end mb-2">
                    <button onClick={() => openStatement(calc, client ?? {})} className="btn-primary text-xs py-1.5">
                      <Printer size={13} /> Download / Print PDF
                    </button>
                  </div>
                  <iframe
                    title={`Statement ${calc.id}`}
                    srcDoc={buildStatementHtml(calc, client ?? {}, { withToolbar: false })}
                    className="w-full bg-white rounded-lg border border-gray-200"
                    style={{ height: 760 }}
                  />
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
