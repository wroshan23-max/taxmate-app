import { useEffect, useState } from 'react';
import { Link, useOutletContext } from 'react-router-dom';
import { FolderLock, ShieldCheck, Loader2, ChevronDown } from 'lucide-react';
import { supabase } from '../../lib/supabase';
import { useAuth } from '../../contexts/AuthContext';
import DocumentVault from '../../components/DocumentVault';

// What to send for an individual income tax return
const CHECKLIST = [
  ['💼', 'Salary', 'T-10 / APIT certificate from your employer, or pay slips'],
  ['🏦', 'Bank interest', 'Interest & WHT certificates for every FD / savings account'],
  ['🏠', 'Rent', 'Rent agreement and amounts received'],
  ['🌍', 'Foreign income', 'Bank credit advices / remittance statements'],
  ['📊', 'Business', 'Sales, expenses, bank statements'],
  ['🚗', 'Assets & loans', 'New vehicles, land, loans taken or settled'],
];

export default function ClientDocuments() {
  const features = useOutletContext() ?? {};
  const { user } = useAuth();
  const [clientId, setClientId] = useState(null);
  const [loading, setLoading] = useState(true);
  const [tips, setTips] = useState(false);

  useEffect(() => {
    supabase.from('clients').select('id').eq('profile_id', user.id).maybeSingle()
      .then(({ data }) => { setClientId(data?.id ?? null); setLoading(false); });
  }, [user.id]);

  if (features.loaded && features.documents === false) return (
    <div className="card p-8 text-center space-y-3"><FolderLock size={36} className="mx-auto text-gray-300" /><p className="text-gray-600">Document upload is not available right now. Please WhatsApp your documents to TaxMate.</p><Link to="/client" className="btn-secondary text-sm inline-flex">Back to dashboard</Link></div>
  );

  return (
    <div className="space-y-5">
      <div className="relative overflow-hidden rounded-3xl bg-gradient-to-br from-primary-700 via-primary-800 to-indigo-900 text-white p-6 shadow-xl">
        <div className="absolute -right-12 -top-12 w-52 h-52 rounded-full bg-gold-500/20 blur-2xl" />
        <div className="relative flex items-start gap-4">
          <div className="w-14 h-14 rounded-2xl bg-white/15 flex items-center justify-center flex-shrink-0"><FolderLock size={28} /></div>
          <div className="flex-1">
            <h1 className="text-2xl font-black leading-tight">My Documents</h1>
            <p className="text-primary-200 text-sm mt-0.5">ඔබේ බදු ලේඛන ආරක්ෂිතව එක තැනක — upload once, we handle the rest.</p>
            <div className="mt-3 inline-flex items-center gap-1.5 text-xs font-semibold bg-white/15 rounded-full px-3 py-1"><ShieldCheck size={13} /> Private · only you &amp; TaxMate can open these</div>
          </div>
        </div>
      </div>

      <div className="card">
        <button onClick={() => setTips(t => !t)} className="w-full flex items-center gap-2 px-5 py-3 text-sm font-semibold text-primary-800">
          📋 What should I upload? <span className="text-xs font-normal text-gray-400">මොනවද යවන්න ඕනේ?</span>
          <ChevronDown size={16} className={`ml-auto transition-transform ${tips ? 'rotate-180' : ''}`} />
        </button>
        {tips && (
          <div className="px-5 pb-4 grid sm:grid-cols-2 lg:grid-cols-3 gap-2">
            {CHECKLIST.map(([e, t, d]) => (
              <div key={t} className="flex gap-2.5 rounded-xl bg-gray-50 p-3"><div className="text-xl">{e}</div><div><div className="text-sm font-semibold text-gray-800">{t}</div><div className="text-xs text-gray-500">{d}</div></div></div>
            ))}
          </div>
        )}
      </div>

      {loading ? <div className="card p-10 text-center text-gray-400"><Loader2 className="animate-spin mx-auto" /></div>
        : !clientId ? <div className="card p-8 text-center text-gray-500 text-sm">Your client profile is not linked yet. Please contact TaxMate.</div>
        : <DocumentVault clientId={clientId} role="client" userId={user.id} />}
    </div>
  );
}
