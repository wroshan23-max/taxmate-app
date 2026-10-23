import { useEffect, useState } from 'react';
import { supabase, fmtRs, fmtDate } from '../../lib/supabase';
import { useAuth } from '../../contexts/AuthContext';
import { FileText } from 'lucide-react';
import { useOutletContext } from 'react-router-dom';
import { ReturnStepper } from '../../components/ReturnTracker';
import SummaryLettersClient from '../../components/SummaryLettersClient';
import { STAGES, stageIndex } from '../../lib/documents';

const statusBadge = (s) => {
  const map = { pending: 'badge-yellow', in_progress: 'badge-blue', submitted: 'badge-gray', completed: 'badge-green' };
  const labels = { pending: 'Pending', in_progress: 'In Progress', submitted: 'Submitted', completed: 'Completed' };
  return <span className={map[s] ?? 'badge-gray'}>{labels[s] ?? s}</span>;
};


export default function ClientTaxReturns() {
  const { user } = useAuth();
  const features = useOutletContext() ?? {};
  const [returns, setReturns] = useState([]);
  const [loading, setLoading] = useState(true);
  const [clientId, setClientId] = useState(null);

  useEffect(() => {
    const load = async () => {
      const { data: cl } = await supabase.from('clients').select('id').eq('profile_id', user.id).single();
      if (!cl) { setLoading(false); return; }
      setClientId(cl.id);
      const { data } = await supabase
        .from('tax_returns')
        .select('*')
        .eq('client_id', cl.id)
        .order('created_at', { ascending: false });
      setReturns(data ?? []);
      setLoading(false);
    };
    load();
  }, [user.id]);

  if (loading) return <div className="flex items-center justify-center h-64 text-gray-400">Loading...</div>;

  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-2xl font-bold text-primary-800">My Tax Returns</h1>
        <p className="text-sm text-gray-500">{returns.length} return{returns.length !== 1 ? 's' : ''} on file</p>
      </div>

      {clientId && features.summary_letters !== false && <SummaryLettersClient clientId={clientId} />}

      {returns.length === 0 ? (
        <div className="card p-12 text-center">
          <FileText size={40} className="mx-auto text-gray-200 mb-3" />
          <div className="text-gray-400">No tax returns on file yet</div>
        </div>
      ) : (
        <div className="space-y-4">
          {returns.map(r => (
            <div key={r.id} className="card p-5">
              <div className="flex items-center justify-between flex-wrap gap-3 mb-4">
                <div>
                  <div className="font-bold text-gray-800">Y/A {r.year}</div>
                  <div className="text-xs text-gray-400">Due: {fmtDate(r.due_date)}</div>
                </div>
                {features.return_tracker !== false && r.stage
                  ? <span className={r.stage === 'filed' ? 'badge-green' : 'badge-blue'}>{STAGES[stageIndex(r.stage)].emoji} {STAGES[stageIndex(r.stage)].label}</span>
                  : statusBadge(r.status)}
              </div>

              {features.return_tracker !== false && (
                <div className="mb-4 rounded-xl bg-gray-50/70 border border-gray-100 p-3">
                  <ReturnStepper ret={r} showSinhala />
                </div>
              )}

              {(r.gross_income || r.total_tax) && (
                <div className="grid grid-cols-2 gap-3 pt-3 border-t border-gray-100">
                  {r.gross_income && (
                    <div>
                      <div className="text-xs text-gray-400">Gross Income</div>
                      <div className="font-semibold text-sm text-gray-800">{fmtRs(r.gross_income)}</div>
                    </div>
                  )}
                  {r.total_tax && (
                    <div>
                      <div className="text-xs text-gray-400">Total Tax</div>
                      <div className="font-semibold text-sm text-primary-700">{fmtRs(r.total_tax)}</div>
                    </div>
                  )}
                </div>
              )}

              {r.notes && (
                <div className="mt-3 pt-3 border-t border-gray-100">
                  <div className="text-xs text-gray-400">Notes</div>
                  <div className="text-sm text-gray-600">{r.notes}</div>
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
