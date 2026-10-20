import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import toast from 'react-hot-toast';
import { X, Link2, XCircle, CheckCircle2, Clock } from 'lucide-react';
import { supabase, fmtDate } from '../lib/supabase';
import { useAuth } from '../contexts/AuthContext';
import { registerUrl, registrationMessage } from '../lib/contacts';
import MessageMenu from './MessageMenu';

/** Modal: create & send one-time registration links for new clients; list recent links. */
export default function RegistrationLinks({ onClose }) {
  const { user } = useAuth();
  const [name, setName] = useState('');
  const [mobile, setMobile] = useState('');
  const [list, setList] = useState([]);

  const load = async () => {
    const { data, error } = await supabase.from('client_registrations')
      .select('*, clients(id, full_name)').order('created_at', { ascending: false }).limit(30);
    if (error) toast.error(error.message);
    setList(data ?? []);
  };
  useEffect(() => { load(); }, []);

  const newLinkText = async () => {
    const { data, error } = await supabase.from('client_registrations')
      .insert({ name_hint: name.trim() || null, mobile_hint: mobile.trim() || null, created_by: user.id })
      .select('token').single();
    if (error) throw error;
    const text = registrationMessage({ name, url: registerUrl(data.token) });
    setName(''); setMobile('');
    load();
    return text;
  };

  const cancel = async (r) => {
    if (!window.confirm('Cancel this link? It will stop working.')) return;
    const { error } = await supabase.from('client_registrations').update({ revoked_at: new Date().toISOString() }).eq('id', r.id);
    if (error) return toast.error(error.message);
    load();
  };

  const now = new Date();
  const state = (r) => r.used_at ? 'used' : r.revoked_at ? 'cancelled' : new Date(r.expires_at) < now ? 'expired' : 'open';

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50" onClick={onClose}>
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-lg max-h-[90vh] overflow-y-auto" onClick={e => e.stopPropagation()}>
        <div className="flex items-center justify-between p-5 border-b">
          <h3 className="font-bold text-primary-800 flex items-center gap-2"><Link2 size={18} /> New client registration link</h3>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600"><X size={20} /></button>
        </div>
        <div className="p-5 space-y-4">
          <p className="text-sm text-gray-600">Send a one-time link (valid 14 days). The client — or a family member filling it for them — enters their details, and they are saved straight into your Clients list.</p>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-semibold text-gray-500 mb-1">Send to (name)</label>
              <input className="input" placeholder="Optional" value={name} onChange={e => setName(e.target.value)} />
            </div>
            <div>
              <label className="block text-xs font-semibold text-gray-500 mb-1">WhatsApp number</label>
              <input className="input" inputMode="tel" placeholder="07X XXXXXXX" value={mobile} onChange={e => setMobile(e.target.value)} />
            </div>
          </div>
          <MessageMenu label="Create link & send" phone={mobile} subject="Your details for TaxMate Solutions" getText={newLinkText} />

          <div className="pt-2">
            <div className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-2">Recent links</div>
            {list.length === 0 ? <div className="text-sm text-gray-400">No links yet</div> : (
              <div className="divide-y divide-gray-100 border border-gray-100 rounded-xl">
                {list.map(r => {
                  const st = state(r);
                  return (
                    <div key={r.id} className="px-3 py-2 flex items-center gap-2 text-sm">
                      {st === 'used' ? <CheckCircle2 size={15} className="text-green-600" /> : st === 'open' ? <Clock size={15} className="text-amber-600" /> : <XCircle size={15} className="text-gray-300" />}
                      <div className="flex-1 min-w-0">
                        {st === 'used' && r.clients
                          ? <Link to={`/admin/clients/${r.clients.id}`} onClick={onClose} className="font-semibold text-primary-700 hover:underline">{r.clients.full_name}</Link>
                          : <span className="font-medium text-gray-700">{r.name_hint || r.mobile_hint || 'Unnamed link'}</span>}
                        <div className="text-[11px] text-gray-400">{st === 'used' ? `Registered ${fmtDate(r.used_at)}` : st === 'open' ? `Sent ${fmtDate(r.created_at)} · valid until ${fmtDate(r.expires_at)}` : st}</div>
                      </div>
                      {st === 'open' && (
                        <>
                          <button onClick={async () => { await navigator.clipboard.writeText(registerUrl(r.token)); toast.success('Link copied'); }} className="text-xs text-primary-600 hover:underline">Copy</button>
                          <button onClick={() => cancel(r)} className="text-xs text-red-600 hover:underline">Cancel</button>
                        </>
                      )}
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
