import { useEffect, useState } from 'react';
import { supabase, fmtRs, fmtDate } from '../../lib/supabase';
import { useAuth } from '../../contexts/AuthContext';
import toast from 'react-hot-toast';
import { Calculator, ChevronDown, ChevronUp, Printer, CheckCircle2, PencilLine } from 'lucide-react';
import { summarizeCalc, KIND_LABEL } from '../../lib/iitCalc';
import { buildStatementHtml, openStatement } from '../../lib/iitStatement';

const AMT_LABEL = { payable: 'tax payable', refund: 'refund', nil: 'nil tax', instalment: 'per quarter' };

export default function ClientCalculations() {
  const { user } = useAuth();
  const [calcs, setCalcs] = useState([]);
  const [loading, setLoading] = useState(true);
  const [expanded, setExpanded] = useState(null);
  const [client, setClient] = useState(null);

  useEffect(() => {
    const load = async () => {
      const { data: cl } = await supabase.from('clients').select('id, full_name, tin, nic, address, employer, resident_status').eq('profile_id', user.id).single();
      if (!cl) { setLoading(false); return; }
      setClient(cl);
      const { data } = await supabase
        .from('iit_calculations')
        .select('*')
        .eq('client_id', cl.id)
        .eq('shared_with_client', true)
        .order('created_at', { ascending: false });
      setCalcs(data ?? []);
      setExpanded((data ?? []).find(c => c.status !== 'final' && !c.client_status)?.id ?? null);
      setLoading(false);
    };
    load();
  }, [user.id]);

  const patch = (id, p) => setCalcs(cs => cs.map(c => (c.id === id ? { ...c, ...p } : c)));
  const pending = calcs.filter(c => c.status !== 'final' && !c.client_status).length;

  if (loading) return <div className="flex items-center justify-center h-64 text-gray-400">Loading...</div>;

  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-2xl font-bold text-primary-800">My Tax Calculations</h1>
        <p className="text-sm text-gray-500">{calcs.length} calculation{calcs.length !== 1 ? 's' : ''} shared by TaxMate</p>
      </div>

      {pending > 0 && (
        <div className="bg-primary-50 border border-primary-200 rounded-lg p-3 text-sm text-primary-800">
          📝 {pending} draft{pending > 1 ? 's are' : ' is'} waiting for your review. Please check the figures and tap <strong>Confirm</strong> or <strong>Request changes</strong>.
        </div>
      )}

      {calcs.length === 0 ? (
        <div className="card p-12 text-center">
          <Calculator size={40} className="mx-auto text-gray-200 mb-3" />
          <div className="text-gray-400">No calculations shared yet</div>
          <div className="text-xs text-gray-300 mt-1">Your tax advisor will share calculations with you here</div>
        </div>
      ) : (
        <div className="space-y-3">
          {calcs.map(calc => {
            const sm = summarizeCalc(calc);
            const isFinal = calc.status === 'final';
            return (
              <div key={calc.id} className="card overflow-hidden">
                <div className="flex items-center gap-3 p-4 cursor-pointer hover:bg-gray-50 transition-colors" onClick={() => setExpanded(expanded === calc.id ? null : calc.id)}>
                  <div className="w-10 h-10 rounded-xl bg-primary-100 flex items-center justify-center flex-shrink-0">
                    <Calculator size={18} className="text-primary-700" />
                  </div>
                  <div className="flex-1">
                    <div className="font-semibold text-sm text-gray-800 flex items-center gap-2 flex-wrap">
                      {KIND_LABEL[sm.kind]} · {calc.year}
                      <span className={`text-[11px] font-black px-1.5 py-0.5 rounded ${isFinal ? 'bg-green-600 text-white' : 'bg-amber-100 text-amber-800'}`}>{isFinal ? 'FINAL' : 'DRAFT'}</span>
                      {calc.client_status === 'approved' && <span className="text-[11px] text-green-700 font-semibold">✅ You confirmed</span>}
                      {calc.client_status === 'changes_requested' && <span className="text-[11px] text-amber-700 font-semibold">✏️ Changes requested</span>}
                    </div>
                    <div className="text-xs text-gray-400">{calc.label ? `${calc.label} · ` : ''}{fmtDate(calc.created_at)}</div>
                  </div>
                  <div className="text-right">
                    <div className="font-bold text-primary-700 text-sm">{fmtRs(Math.abs(sm.amount))}</div>
                    <div className="text-xs text-gray-400">{AMT_LABEL[sm.status]}</div>
                  </div>
                  {expanded === calc.id ? <ChevronUp size={16} className="text-gray-400 flex-shrink-0" /> : <ChevronDown size={16} className="text-gray-400 flex-shrink-0" />}
                </div>

                {expanded === calc.id && (
                  <div className="border-t border-gray-100 p-4 bg-gray-50 space-y-3">
                    {!isFinal && <Review calc={calc} onDone={(p) => patch(calc.id, p)} />}
                    <div className="flex justify-end">
                      <button onClick={() => openStatement(calc, client ?? {})} className="btn-primary text-xs py-1.5">
                        <Printer size={13} /> Download / Print PDF
                      </button>
                    </div>
                    <iframe title={`Statement ${calc.id}`} srcDoc={buildStatementHtml(calc, client ?? {}, { withToolbar: false })}
                      className="w-full bg-white rounded-lg border border-gray-200" style={{ height: 760 }} />
                    {calc.notes && (
                      <div className="bg-white rounded-lg p-3 border border-gray-100">
                        <div className="text-xs font-semibold text-gray-400 mb-1">Notes from advisor</div>
                        <p className="text-sm text-gray-700">{calc.notes}</p>
                      </div>
                    )}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

function Review({ calc, onDone }) {
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [editing, setEditing] = useState(!calc.client_status);

  const respond = async (decision) => {
    if (decision === 'changes_requested' && !note.trim()) return toast.error('Please tell us what should change');
    setBusy(true);
    const { data, error } = await supabase.rpc('respond_my_calc', { p_id: calc.id, p_decision: decision, p_note: note });
    setBusy(false);
    if (error) return toast.error(error.message);
    onDone({ ...data, client_responded_at: new Date().toISOString() });
    setEditing(false);
    setNote('');
    toast.success(decision === 'approved' ? 'Thank you — confirmation sent to TaxMate' : 'Thank you — your change request was sent');
  };

  if (!editing) {
    return (
      <div className={`rounded-lg border p-3 text-sm ${calc.client_status === 'approved' ? 'bg-green-50 border-green-200 text-green-800' : 'bg-amber-50 border-amber-200 text-amber-800'}`}>
        {calc.client_status === 'approved' ? '✅ You confirmed these figures.' : `✏️ You asked for changes${calc.client_note ? `: “${calc.client_note}”` : ''}.`}
        <button onClick={() => setEditing(true)} className="ml-2 text-xs underline">Change my response</button>
      </div>
    );
  }
  return (
    <div className="rounded-lg border border-primary-200 bg-white p-3 space-y-2">
      <div className="text-sm text-gray-700"><strong>Please review this draft.</strong> Confirm if the figures are correct, or tell us what to change.</div>
      <textarea className="input resize-none" rows={2} maxLength={2000} placeholder="Note to TaxMate (optional for Confirm)…" value={note} onChange={e => setNote(e.target.value)} />
      <div className="flex gap-2 flex-wrap">
        <button disabled={busy} onClick={() => respond('approved')} className="btn-primary bg-green-600 hover:bg-green-700 text-sm"><CheckCircle2 size={14} /> Confirm — figures are correct</button>
        <button disabled={busy} onClick={() => respond('changes_requested')} className="btn-secondary text-sm"><PencilLine size={14} /> Request changes</button>
      </div>
    </div>
  );
}
