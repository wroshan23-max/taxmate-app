import { useEffect, useState } from 'react';
import { Link, useOutletContext } from 'react-router-dom';
import toast from 'react-hot-toast';
import { CalendarCheck, Loader2, X, Send, Sparkles, CalendarClock } from 'lucide-react';
import { supabase, fmtDate } from '../../lib/supabase';
import { useAuth } from '../../contexts/AuthContext';
import { SERVICE_CARDS, cardFor, TIMES, CONTACTS, SR_STATUS } from '../../lib/services';
import { logActivity } from '../../lib/activity';

const tomorrow = () => { const d = new Date(); d.setDate(d.getDate() + 1); return d.toISOString().slice(0, 10); };

export default function ClientServices() {
  const features = useOutletContext() ?? {};
  const { user } = useAuth();
  const [clientId, setClientId] = useState(null);
  const [rows, setRows] = useState([]);
  const [pick, setPick] = useState(null);
  const [f, setF] = useState({ details: '', date: tomorrow(), time: 'any', contact: 'whatsapp' });
  const [busy, setBusy] = useState(false);

  const load = async (cid = clientId) => {
    if (!cid) return;
    const { data } = await supabase.from('service_requests').select('*').eq('client_id', cid).order('created_at', { ascending: false });
    setRows(data ?? []);
  };
  useEffect(() => {
    if (!user?.id) return;
    supabase.from('clients').select('id').eq('profile_id', user.id).maybeSingle().then(({ data }) => { setClientId(data?.id ?? null); load(data?.id); });
  }, [user?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  if (features.loaded && features.services === false) return (
    <div className="card p-8 text-center space-y-3"><CalendarCheck size={36} className="mx-auto text-gray-300" /><p className="text-gray-600">Online booking is not available right now. Please WhatsApp TaxMate.</p><Link to="/client" className="btn-secondary text-sm inline-flex">Back to dashboard</Link></div>
  );

  const choose = (s) => { setPick(s); setF({ details: '', date: tomorrow(), time: 'any', contact: 'whatsapp' }); setTimeout(() => document.getElementById('book-form')?.scrollIntoView({ behavior: 'smooth', block: 'center' }), 50); };
  const submit = async () => {
    setBusy(true);
    const { error } = await supabase.rpc('request_service', { p_service: pick.name, p_details: f.details, p_date: f.date || null, p_time: f.time, p_contact: f.contact });
    setBusy(false);
    if (error) return toast.error(error.message.replace(/^.*?ERROR:\s*/, ''));
    toast.success('Request sent! TaxMate will contact you soon.');
    logActivity('submit', '/client/services', pick.name);
    setPick(null); load();
  };
  const cancel = async (r) => {
    const { error } = await supabase.rpc('cancel_my_service_request', { p_id: r.id });
    if (error) return toast.error(error.message);
    load();
  };

  return (
    <div className="space-y-5">
      <div className="relative overflow-hidden rounded-3xl bg-gradient-to-br from-primary-700 via-primary-800 to-indigo-900 text-white p-6 shadow-xl">
        <div className="absolute -right-12 -top-12 w-52 h-52 rounded-full bg-gold-500/20 blur-2xl" />
        <div className="relative">
          <div className="inline-flex items-center gap-1.5 text-xs font-bold uppercase tracking-wider bg-white/15 rounded-full px-3 py-1"><Sparkles size={13} /> Book a service</div>
          <h1 className="text-2xl sm:text-3xl font-black mt-3">How can we help you today?</h1>
          <p className="text-primary-200 text-sm mt-1">Pick a service and a time that suits you — we'll get back to you · සේවාවක් තෝරා වේලාවක් වෙන් කරගන්න</p>
        </div>
      </div>

      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-3">
        {SERVICE_CARDS.map(s => (
          <button key={s.name} onClick={() => choose(s)}
            className={`text-left rounded-2xl border-2 p-4 bg-white transition-all hover:-translate-y-0.5 hover:shadow-md ${pick?.name === s.name ? 'border-primary-600 ring-4 ring-primary-100' : 'border-gray-100 hover:border-primary-200'}`}>
            <div className="text-3xl">{s.emoji}</div>
            <div className="font-bold text-sm text-gray-800 mt-2 leading-tight">{s.name}</div>
            <div className="text-[11px] text-gray-500 mt-0.5">{s.desc}</div>
          </button>
        ))}
      </div>

      {pick && (
        <div id="book-form" className="card overflow-hidden">
          <div className="px-5 py-3 border-b border-gray-100 flex items-center gap-2 bg-primary-50/50">
            <span className="text-2xl">{pick.emoji}</span><div className="font-bold text-primary-800 flex-1">{pick.name}</div>
            <button onClick={() => setPick(null)} className="p-1.5 rounded-lg hover:bg-white"><X size={16} /></button>
          </div>
          <div className="p-5 space-y-4">
            <label className="block text-xs font-semibold text-gray-600">Tell us a little (optional)
              <textarea className="input mt-1 resize-none" rows={3} maxLength={1000} placeholder="e.g. I started freelancing this year and need to register for TIN and file my return." value={f.details} onChange={e => setF({ ...f, details: e.target.value })} />
            </label>
            <div className="grid sm:grid-cols-2 gap-4">
              <label className="block text-xs font-semibold text-gray-600">Preferred date
                <input type="date" className="input mt-1" min={new Date().toISOString().slice(0, 10)} value={f.date} onChange={e => setF({ ...f, date: e.target.value })} />
              </label>
              <div className="text-xs font-semibold text-gray-600">Preferred time
                <div className="mt-1 flex flex-wrap gap-1.5">
                  {Object.entries(TIMES).map(([k, l]) => <button key={k} type="button" onClick={() => setF({ ...f, time: k })} className={`px-3 py-2 rounded-xl text-xs font-semibold border ${f.time === k ? 'bg-primary-700 text-white border-primary-700' : 'bg-white border-gray-200 text-gray-600'}`}>{l}</button>)}
                </div>
              </div>
            </div>
            <div className="text-xs font-semibold text-gray-600">How should we contact you?
              <div className="mt-1 grid grid-cols-2 sm:grid-cols-4 gap-2">
                {Object.entries(CONTACTS).map(([k, [e, l]]) => <button key={k} type="button" onClick={() => setF({ ...f, contact: k })} className={`rounded-xl border-2 py-2.5 text-sm font-semibold ${f.contact === k ? 'border-primary-600 bg-primary-50 text-primary-800' : 'border-gray-100 text-gray-600'}`}>{e} {l}</button>)}
              </div>
            </div>
            <button onClick={submit} disabled={busy} className="btn-primary w-full justify-center py-3">{busy ? <Loader2 size={16} className="animate-spin" /> : <Send size={16} />} Send request</button>
          </div>
        </div>
      )}

      {rows.length > 0 && (
        <div className="card overflow-hidden">
          <div className="card-header"><CalendarClock size={16} /> My requests</div>
          <div className="divide-y divide-gray-50">
            {rows.map(r => (
              <div key={r.id} className="px-5 py-3 flex items-start gap-3">
                <div className="text-2xl">{cardFor(r.service).emoji}</div>
                <div className="flex-1 min-w-0">
                  <div className="text-sm font-semibold text-gray-800">{r.service}</div>
                  <div className="text-[11px] text-gray-500">
                    Sent {fmtDate(r.created_at)}{r.preferred_date ? ` · wants ${fmtDate(r.preferred_date)} ${r.preferred_time && r.preferred_time !== 'any' ? TIMES[r.preferred_time].split(' ')[0].toLowerCase() : ''}` : ''} · {CONTACTS[r.contact_method]?.[1]}
                  </div>
                  {r.scheduled_at && <div className="text-xs font-semibold text-indigo-700 mt-0.5">📅 {new Date(r.scheduled_at).toLocaleString('en-GB', { weekday: 'short', day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' })}</div>}
                  {r.admin_note && <div className="text-xs text-gray-600 mt-0.5 italic">TaxMate: {r.admin_note}</div>}
                </div>
                <div className="flex flex-col items-end gap-1">
                  <span className={`text-[11px] font-semibold px-2 py-0.5 rounded-md ${SR_STATUS[r.status]?.cls}`}>{SR_STATUS[r.status]?.label}</span>
                  {['new', 'contacted', 'scheduled'].includes(r.status) && <button onClick={() => cancel(r)} className="text-[11px] text-gray-400 hover:text-red-600">Cancel</button>}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
