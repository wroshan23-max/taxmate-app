import { useEffect, useState } from 'react';
import { supabase } from '../../lib/supabase';
import { useAuth } from '../../contexts/AuthContext';
import toast from 'react-hot-toast';
import { Send, CheckCircle, Clock } from 'lucide-react';
import ChangePassword from '../../components/ChangePassword';
import IrdDetailsClient from '../../components/IrdDetailsClient';

const FIELD_LABELS = {
  full_name: 'Full Name',
  nic: 'NIC',
  email: 'Email',
  mobile: 'Mobile',
  employer: 'Employer',
  address: 'Address',
};

export default function ClientProfile() {
  const { user } = useAuth();
  const [client, setClient] = useState(null);
  const [requests, setRequests] = useState([]);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [changes, setChanges] = useState({});
  const [notes, setNotes] = useState('');
  const [saving, setSaving] = useState(false);
  const [clientId, setClientId] = useState(null);

  useEffect(() => {
    const load = async () => {
      const { data: cl } = await supabase.from('clients').select('*').eq('profile_id', user.id).single();
      if (!cl) { setLoading(false); return; }
      setClient(cl);
      setClientId(cl.id);
      setChanges({
        full_name: cl.full_name ?? '',
        nic: cl.nic ?? '',
        email: cl.email ?? '',
        mobile: cl.mobile ?? '',
        employer: cl.employer ?? '',
        address: cl.address ?? '',
      });

      const { data: reqs } = await supabase
        .from('update_requests')
        .select('*')
        .eq('client_id', cl.id)
        .order('created_at', { ascending: false })
        .limit(5);
      setRequests(reqs ?? []);
      setLoading(false);
    };
    load();
  }, [user.id]);

  const submitRequest = async (e) => {
    e.preventDefault();
    // Only send fields that actually changed
    const diff = {};
    Object.keys(changes).forEach(k => {
      if (changes[k] !== (client[k] ?? '')) diff[k] = changes[k];
    });
    if (Object.keys(diff).length === 0) return toast.error('No changes detected');

    setSaving(true);
    const { error } = await supabase.from('update_requests').insert({
      client_id: clientId,
      profile_id: user.id,
      requested_changes: diff,
      notes: notes.trim() || null,
      status: 'pending',
    });
    setSaving(false);
    if (error) { toast.error(error.message); return; }
    toast.success('Update request submitted! Your advisor will review it shortly.');
    setShowForm(false);
    setNotes('');
    // Reload requests
    const { data: reqs } = await supabase.from('update_requests').select('*').eq('client_id', clientId).order('created_at', { ascending: false }).limit(5);
    setRequests(reqs ?? []);
  };

  if (loading) return <div className="flex items-center justify-center h-64 text-gray-400">Loading...</div>;
  if (!client) return <div className="card p-10 text-center text-gray-400">Profile not linked. Contact TaxMate.</div>;

  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-2xl font-bold text-primary-800">My Profile</h1>
        <p className="text-sm text-gray-500">Submit a request to update your information</p>
      </div>

      {client?.client_no && (
        <div className="card p-4 flex items-center gap-3 bg-gradient-to-r from-primary-50 to-white">
          <div className="w-10 h-10 rounded-xl bg-primary-600 text-white flex items-center justify-center font-black text-sm">#</div>
          <div className="flex-1">
            <div className="text-xs text-gray-500">Your TaxMate client number · ඔබගේ සේවාලාභී අංකය</div>
            <div className="font-mono text-xl font-black text-primary-800 tracking-wide">{client.client_no}</div>
          </div>
          <div className="text-[11px] text-gray-400 max-w-[180px] text-right hidden sm:block">Mention this number when you contact TaxMate.</div>
        </div>
      )}

      {/* Current Profile */}
      <div className="card p-5">
        <div className="flex items-center justify-between mb-4">
          <div className="font-semibold text-gray-700">Current Information</div>
          <button onClick={() => setShowForm(!showForm)} className="btn-primary text-xs py-1.5">
            {showForm ? 'Cancel' : 'Request Update'}
          </button>
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          {Object.entries(FIELD_LABELS).map(([key, label]) => (
            <div key={key} className={key === 'address' ? 'sm:col-span-2' : ''}>
              <div className="text-xs font-semibold text-gray-400 uppercase tracking-wider mb-1">{label}</div>
              <div className="text-sm text-gray-800 font-medium">{client[key] || <span className="text-gray-300">—</span>}</div>
            </div>
          ))}
        </div>
      </div>

      {/* IRD filing details (TIN / RAMIS PIN / SSID) — saved directly */}
      <IrdDetailsClient />

      {/* Update Request Form */}
      {showForm && (
        <div className="card p-5">
          <div className="font-semibold text-gray-700 mb-4">Request Information Update</div>
          <form onSubmit={submitRequest} className="space-y-4">
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              {Object.entries(FIELD_LABELS).map(([key, label]) => (
                <div key={key} className={key === 'address' ? 'sm:col-span-2' : ''}>
                  <label className="block text-xs font-semibold text-gray-500 mb-1">{label}</label>
                  {key === 'address' ? (
                    <textarea className="input resize-none" rows={2} value={changes[key] ?? ''} onChange={e => setChanges({...changes, [key]: e.target.value})} />
                  ) : (
                    <input className={`input ${changes[key] !== (client[key] ?? '') ? 'border-primary-400 bg-primary-50' : ''}`}
                      value={changes[key] ?? ''} onChange={e => setChanges({...changes, [key]: e.target.value})} />
                  )}
                  {changes[key] !== (client[key] ?? '') && (
                    <div className="text-xs text-primary-600 mt-0.5">Changed from: {client[key] || '(empty)'}</div>
                  )}
                </div>
              ))}
            </div>
            <div>
              <label className="block text-xs font-semibold text-gray-500 mb-1">Note to Advisor (optional)</label>
              <textarea className="input resize-none" rows={2} placeholder="e.g. Changed employer on 1st Jan 2026..."
                value={notes} onChange={e => setNotes(e.target.value)} />
            </div>
            <div className="flex gap-3">
              <button type="button" onClick={() => setShowForm(false)} className="btn-secondary flex-1 justify-center">Cancel</button>
              <button type="submit" disabled={saving} className="btn-primary flex-1 justify-center">
                <Send size={14} /> {saving ? 'Submitting...' : 'Submit Request'}
              </button>
            </div>
          </form>
        </div>
      )}

      {/* Past Requests */}
      {requests.length > 0 && (
        <div className="card">
          <div className="card-header"><Clock size={16} /> Previous Requests</div>
          <div className="divide-y divide-gray-50">
            {requests.map(req => (
              <div key={req.id} className="flex items-center gap-3 px-5 py-3">
                <div className="flex-1">
                  <div className="text-sm font-semibold text-gray-700">
                    {Object.keys(req.requested_changes ?? {}).join(', ')}
                  </div>
                  <div className="text-xs text-gray-400">{new Date(req.created_at).toLocaleDateString('en-GB')}</div>
                </div>
                <span className={`text-xs font-semibold px-2 py-0.5 rounded-full capitalize
                  ${req.status === 'approved' ? 'bg-green-100 text-green-700' : req.status === 'rejected' ? 'bg-red-100 text-red-600' : 'bg-amber-100 text-amber-700'}`}>
                  {req.status === 'approved' && <CheckCircle size={10} className="inline mr-1" />}
                  {req.status}
                </span>
              </div>
            ))}
          </div>
        </div>
      )}

      <div className="max-w-md"><ChangePassword /></div>
    </div>
  );
}
