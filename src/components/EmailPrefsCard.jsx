import { useEffect, useState } from 'react';
import toast from 'react-hot-toast';
import { Mail } from 'lucide-react';
import { supabase } from '../lib/supabase';

/** Client: email reminders on/off (deadlines, invoices, documents, messages). */
export default function EmailPrefsCard() {
  const [p, setP] = useState(null);
  useEffect(() => { supabase.rpc('my_email_prefs').then(({ data }) => data && setP(data)); }, []);
  if (!p) return null;
  const on = !p.opt_out;
  const toggle = async () => {
    const { error } = await supabase.rpc('set_my_email_prefs', { p_opt_out: on });
    if (error) return toast.error(error.message);
    setP({ ...p, opt_out: on });
    toast.success(on ? 'Email reminders turned off' : 'Email reminders turned on');
  };
  return (
    <div className="card p-5 flex items-center gap-4">
      <div className="w-11 h-11 rounded-2xl bg-sky-100 text-sky-700 flex items-center justify-center flex-shrink-0"><Mail size={22} /></div>
      <div className="flex-1">
        <div className="font-bold text-gray-800">Email reminders {on ? <span className="text-emerald-600">· ON</span> : <span className="text-gray-400">· OFF</span>}</div>
        <p className="text-sm text-gray-500">Tax deadlines, invoices, documents we need and new messages{p.email ? <> — sent to <b>{p.email}</b></> : ' (no email on your profile yet)'}.</p>
        <p className="text-xs text-gray-400">බදු දින, ඉන්වොයිස් සහ පණිවිඩ ගැන email මතක් කිරීම්</p>
      </div>
      <button onClick={toggle} role="switch" aria-checked={on} className={`relative w-14 h-8 rounded-full transition-colors flex-shrink-0 ${on ? 'bg-emerald-500' : 'bg-gray-300'}`}>
        <span className={`absolute top-1 left-1 w-6 h-6 rounded-full bg-white shadow transition-transform ${on ? 'translate-x-6' : ''}`} />
      </button>
    </div>
  );
}
