import { useEffect, useState } from 'react';
import { supabase, fmtDate } from '../../lib/supabase';
import toast from 'react-hot-toast';
import { CheckCircle, XCircle, Clock, User, ChevronDown, ChevronUp } from 'lucide-react';

const statusBadge = (s) => {
  const map = { pending: 'badge-yellow', approved: 'badge-green', rejected: 'badge-red' };
  return <span className={map[s] ?? 'badge-gray'}>{s}</span>;
};

export default function UpdateRequests() {
  const [requests, setRequests] = useState([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState('pending');
  const [expanded, setExpanded] = useState(null);
  const [processing, setProcessing] = useState(null);

  useEffect(() => { loadRequests(); }, []);

  const loadRequests = async () => {
    const { data } = await supabase
      .from('update_requests')
      .select('*, profiles(full_name, email), clients(full_name)')
      .order('created_at', { ascending: false });
    setRequests(data ?? []);
    setLoading(false);
  };

  const filtered = requests.filter(r => filter === 'all' || r.status === filter);

  const approve = async (req) => {
    setProcessing(req.id);
    // Apply the requested changes to the client record
    const changes = req.requested_changes;
    const { error: updateErr } = await supabase.from('clients').update(changes).eq('id', req.client_id);
    if (updateErr) { toast.error(updateErr.message); setProcessing(null); return; }

    await supabase.from('update_requests').update({ status: 'approved', resolved_at: new Date().toISOString() }).eq('id', req.id);
    toast.success('Request approved & changes applied!');
    setProcessing(null);
    loadRequests();
  };

  const reject = async (req) => {
    setProcessing(req.id);
    await supabase.from('update_requests').update({ status: 'rejected', resolved_at: new Date().toISOString() }).eq('id', req.id);
    toast.success('Request rejected.');
    setProcessing(null);
    loadRequests();
  };

  const pendingCount = requests.filter(r => r.status === 'pending').length;

  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-2xl font-bold text-primary-800">Update Requests</h1>
        <p className="text-sm text-gray-500">
          {pendingCount > 0
            ? <span className="text-amber-600 font-semibold">{pendingCount} pending request{pendingCount !== 1 ? 's' : ''} awaiting review</span>
            : 'No pending requests'}
        </p>
      </div>

      <div className="flex gap-2">
        {['pending', 'approved', 'rejected', 'all'].map(s => (
          <button key={s} onClick={() => setFilter(s)}
            className={`px-3 py-1 rounded-full text-xs font-semibold capitalize transition-all ${filter === s ? 'bg-primary-700 text-white' : 'bg-gray-100 text-gray-600 hover:bg-gray-200'}`}>
            {s}
          </button>
        ))}
      </div>

      <div className="space-y-3">
        {loading ? (
          <div className="card p-8 text-center text-gray-400">Loading...</div>
        ) : filtered.length === 0 ? (
          <div className="card p-12 text-center">
            <Clock size={40} className="mx-auto text-gray-200 mb-3" />
            <div className="text-gray-400">No {filter === 'all' ? '' : filter} requests</div>
          </div>
        ) : filtered.map(req => (
          <div key={req.id} className="card overflow-hidden">
            <div
              className="flex items-center gap-3 p-4 cursor-pointer hover:bg-gray-50 transition-colors"
              onClick={() => setExpanded(expanded === req.id ? null : req.id)}
            >
              <div className="w-9 h-9 rounded-full bg-primary-100 flex items-center justify-center flex-shrink-0">
                <User size={16} className="text-primary-700" />
              </div>
              <div className="flex-1 min-w-0">
                <div className="font-semibold text-sm text-gray-800">{req.clients?.full_name ?? '—'}</div>
                <div className="text-xs text-gray-400">{req.profiles?.email ?? '—'} · {fmtDate(req.created_at)}</div>
              </div>
              <div className="flex items-center gap-2">
                {statusBadge(req.status)}
                {expanded === req.id ? <ChevronUp size={16} className="text-gray-400" /> : <ChevronDown size={16} className="text-gray-400" />}
              </div>
            </div>

            {expanded === req.id && (
              <div className="border-t border-gray-100 p-4 bg-gray-50 space-y-4">
                {req.notes && (
                  <div>
                    <div className="text-xs font-semibold text-gray-500 mb-1">Client Note</div>
                    <p className="text-sm text-gray-700 bg-white rounded-lg p-3 border border-gray-100">{req.notes}</p>
                  </div>
                )}
                <div>
                  <div className="text-xs font-semibold text-gray-500 mb-2">Requested Changes</div>
                  <div className="bg-white rounded-lg border border-gray-100 divide-y divide-gray-50">
                    {Object.entries(req.requested_changes ?? {}).map(([key, val]) => (
                      <div key={key} className="flex items-start gap-3 px-3 py-2">
                        <span className="text-xs font-semibold text-gray-400 capitalize w-28 flex-shrink-0 pt-0.5">{key.replace('_', ' ')}</span>
                        <span className="text-sm text-gray-800 break-all">{val || <span className="text-gray-300 italic">empty</span>}</span>
                      </div>
                    ))}
                  </div>
                </div>

                {req.status === 'pending' && (
                  <div className="flex gap-3">
                    <button
                      onClick={() => reject(req)}
                      disabled={processing === req.id}
                      className="flex items-center gap-1.5 px-4 py-2 rounded-lg text-sm font-semibold bg-red-50 text-red-600 hover:bg-red-100 transition-colors disabled:opacity-50"
                    >
                      <XCircle size={15} /> Reject
                    </button>
                    <button
                      onClick={() => approve(req)}
                      disabled={processing === req.id}
                      className="flex items-center gap-1.5 px-4 py-2 rounded-lg text-sm font-semibold bg-green-50 text-green-700 hover:bg-green-100 transition-colors disabled:opacity-50"
                    >
                      <CheckCircle size={15} /> {processing === req.id ? 'Processing...' : 'Approve & Apply'}
                    </button>
                  </div>
                )}

                {req.status !== 'pending' && req.resolved_at && (
                  <div className="text-xs text-gray-400">Resolved: {fmtDate(req.resolved_at)}</div>
                )}
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}
