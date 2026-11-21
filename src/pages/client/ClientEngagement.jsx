// V69 — client portal: my engagement letters (sign / download)
import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { FileSignature, Loader2, PenLine, Printer } from 'lucide-react';
import { supabase } from '../../lib/supabase';
import { useAuth } from '../../contexts/AuthContext';
import { openLetter } from '../../lib/engagement';

const dmy = (d) => (d ? new Date(d).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' }) : '');

export default function ClientEngagement() {
  const { profile } = useAuth();
  const [rows, setRows] = useState(null);
  const [client, setClient] = useState(null);
  useEffect(() => {
    if (!profile?.client_id) return;
    Promise.all([
      supabase.from('engagement_letters').select('id, letter_no, title, status, share_token, sent_at, signed_at, signer_name, signer_capacity, signature, consents, content, valid_until').order('sent_at', { ascending: false }),
      supabase.from('clients').select('full_name, client_no, tin, nic, address').eq('id', profile.client_id).maybeSingle(),
    ]).then(([{ data }, { data: c }]) => { setRows(data ?? []); setClient(c); });
  }, [profile?.client_id]);

  return (
    <div className="space-y-4">
      <div>
        <h1 className="flex items-center gap-2 text-2xl font-bold text-primary-800"><FileSignature size={22} className="text-gold-500" /> Engagement letters</h1>
        <p className="text-sm text-gray-500">The services, fees and terms agreed with TaxMate · සේවා එකඟතා ලිපි</p>
      </div>
      {rows === null ? <div className="card p-10 text-center"><Loader2 className="mx-auto animate-spin text-gray-400" /></div>
        : rows.length === 0 ? <div className="card p-8 text-center text-sm text-gray-500">No engagement letters yet.</div>
        : rows.map((r) => (
          <div key={r.id} className={`card flex flex-wrap items-center gap-3 p-4 ${r.status === 'sent' ? 'border-amber-200 bg-amber-50/40' : ''}`}>
            <div className="min-w-0 flex-1">
              <div className="font-semibold text-gray-900">{r.title}</div>
              <div className="text-xs text-gray-500">{r.letter_no} · {r.status === 'signed' ? `Signed ${dmy(r.signed_at)}` : r.status === 'declined' ? 'You declined this letter' : `Sent ${dmy(r.sent_at)} — waiting for your signature`}</div>
            </div>
            {r.status === 'sent' && <Link to={`/e/${r.share_token}`} className="btn-primary text-sm"><PenLine size={15} /> Read &amp; sign</Link>}
            {r.status === 'signed' && <button type="button" onClick={() => openLetter({ ...r, client })} className="btn-secondary border text-sm"><Printer size={15} /> Download</button>}
          </div>
        ))}
    </div>
  );
}
