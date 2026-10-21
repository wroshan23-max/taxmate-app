import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import toast from 'react-hot-toast';
import { X, Link2, XCircle, CheckCircle2, Clock, Globe, Copy, Plus, ExternalLink } from 'lucide-react';
import { supabase, fmtDate } from '../lib/supabase';
import { useAuth } from '../contexts/AuthContext';
import { registerUrl, registrationMessage, joinUrl } from '../lib/contacts';
import MessageMenu from './MessageMenu';

/** Modal: create & send one-time registration links for new clients; list recent links. */
export default function RegistrationLinks({ onClose }) {
  const { user } = useAuth();
  const [name, setName] = useState('');
  const [mobile, setMobile] = useState('');
  const [list, setList] = useState([]);
  const [pub, setPub] = useState([]);
  const [newLabel, setNewLabel] = useState('');
  const [newCode, setNewCode] = useState('');

  const load = async () => {
    const [{ data, error }, { data: p }] = await Promise.all([
      supabase.from('client_registrations').select('*, clients(id, full_name)').eq('multi_use', false)
        .order('created_at', { ascending: false }).limit(30),
      supabase.from('client_registrations').select('*').eq('multi_use', true).order('created_at'),
    ]);
    if (error) toast.error(error.message);
    setList(data ?? []); setPub(p ?? []);
  };

  const copy = async (text, msg = 'Link copied') => { await navigator.clipboard.writeText(text); toast.success(msg); };
  const togglePublic = async (r) => {
    const { error } = await supabase.from('client_registrations').update({ active: !r.active }).eq('id', r.id);
    if (error) return toast.error(error.message);
    toast.success(r.active ? 'Link switched off — it now shows "registration closed"' : 'Link is live again');
    load();
  };
  const addPublic = async () => {
    const code = newCode.trim().toLowerCase().replace(/[^a-z0-9-]/g, '-').replace(/^-+|-+$/g, '');
    if (!/^[a-z0-9][a-z0-9-]{1,29}$/.test(code)) return toast.error('Short code: 2–30 letters, numbers or "-", e.g. "flyer" or "wa-status"');
    const { error } = await supabase.from('client_registrations')
      .insert({ multi_use: true, code, label: newLabel.trim() || code, expires_at: '2100-01-01', created_by: user.id });
    if (error) return toast.error(/duplicate|unique/i.test(error.message) ? 'That code is already used' : error.message);
    setNewLabel(''); setNewCode('');
    toast.success('Public link created');
    load();
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
          <h3 className="font-bold text-primary-800 flex items-center gap-2"><Link2 size={18} /> Client registration links</h3>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600"><X size={20} /></button>
        </div>
        <div className="p-5 space-y-4">
          {/* Public links */}
          <div className="rounded-xl border border-primary-100 bg-primary-50/40 p-3 space-y-3">
            <div className="flex items-center gap-1.5 text-sm font-semibold text-primary-800"><Globe size={15} /> Public links — for Facebook, WhatsApp status, flyers</div>
            <p className="text-xs text-gray-600">Anyone with these links can register (many people). Each new client lands in Clients as NEW, with the link name as the source. Protected against spam: max 3 forms per device per day, the same mobile only once per 30 days, and you can switch a link off anytime.</p>
            {pub.map(r => (
              <div key={r.id} className={`rounded-lg border bg-white p-2.5 ${r.active ? 'border-gray-200' : 'border-gray-200 opacity-60'}`}>
                <div className="flex items-center gap-2 flex-wrap">
                  <span className="font-semibold text-sm text-gray-800">{r.label || r.code}</span>
                  <span className={`text-[10px] font-bold px-1.5 py-0.5 rounded ${r.active ? 'bg-green-100 text-green-700' : 'bg-gray-100 text-gray-500'}`}>{r.active ? 'LIVE' : 'OFF'}</span>
                  <span className="text-xs text-gray-400 ml-auto">{r.use_count} registration{r.use_count === 1 ? '' : 's'}</span>
                </div>
                <div className="flex items-center gap-2 mt-1.5">
                  <code className="text-xs bg-gray-50 border border-gray-100 rounded px-2 py-1 flex-1 truncate">{joinUrl(r.code)}</code>
                  <button onClick={() => copy(joinUrl(r.code))} title="Copy link" className="p-1.5 rounded-md border border-gray-200 hover:bg-gray-50 text-primary-700"><Copy size={13} /></button>
                  <a href={joinUrl(r.code)} target="_blank" rel="noreferrer" title="Open" className="p-1.5 rounded-md border border-gray-200 hover:bg-gray-50 text-primary-700"><ExternalLink size={13} /></a>
                  <button onClick={() => togglePublic(r)} className="text-xs px-2 py-1 rounded-md border border-gray-200 hover:bg-gray-50">{r.active ? 'Switch off' : 'Switch on'}</button>
                </div>
              </div>
            ))}
            <div className="flex gap-2 flex-wrap items-end">
              <div className="flex-1 min-w-[120px]">
                <label className="block text-[11px] font-semibold text-gray-500 mb-0.5">New link name</label>
                <input className="input py-1.5 text-sm" placeholder="e.g. Flyer QR" value={newLabel} onChange={e => setNewLabel(e.target.value)} />
              </div>
              <div className="w-32">
                <label className="block text-[11px] font-semibold text-gray-500 mb-0.5">Short code</label>
                <input className="input py-1.5 text-sm" placeholder="flyer" maxLength={30} value={newCode} onChange={e => setNewCode(e.target.value)} />
              </div>
              <button onClick={addPublic} className="btn-secondary text-sm py-1.5"><Plus size={14} /> Add</button>
            </div>
          </div>

          <div className="text-sm font-semibold text-gray-700 pt-1">Personal link — for one person</div>
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
            <div className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-2">Recent personal links</div>
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
