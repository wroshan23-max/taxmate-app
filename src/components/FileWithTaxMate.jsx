// V73 — public calculator: "File my return with TaxMate" → lead in the Call Log (no login)
import { useState } from 'react';
import { Link } from 'react-router-dom';
import { X, Loader2, CheckCircle2, MessageCircle, UserPlus, Send } from 'lucide-react';
import { supabase } from '../lib/supabase';
import { FIRM } from '../lib/iitStatement';
import { waNumber } from '../lib/share';

export default function FileWithTaxMate({ year, summary, onClose }) {
  const [f, setF] = useState({ name: '', phone: '', email: '', note: '', web: '' });
  const [ok, setOk] = useState(false);
  const [agree, setAgree] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const set = (k) => (e) => { setF({ ...f, [k]: e.target.value }); setErr(''); };

  const send = async (e) => {
    e.preventDefault();
    if (f.web) { setOk(true); return; }             // bots fill the hidden field
    if (f.name.trim().length < 2) return setErr('Please enter your name.');
    if (f.phone.replace(/\D/g, '').length < 9) return setErr('Please enter your mobile number.');
    if (!agree) return setErr('Please tick the box so we can contact you.');
    setBusy(true);
    const { error } = await supabase.rpc('submit_calc_lead', { p_name: f.name.trim(), p_phone: f.phone.trim(), p_email: f.email.trim(), p_year: year, p_summary: summary, p_note: f.note.trim() });
    setBusy(false);
    if (error) return setErr(/submit_calc_lead|schema cache/.test(error.message) ? 'Sorry — please WhatsApp us instead.' : error.message.replace(/^.*?ERROR:\s*/, ''));
    setOk(true);
  };
  const wa = `https://wa.me/${waNumber(FIRM.whatsapp)}?text=${encodeURIComponent(`Hi TaxMate, I used your tax calculator (Y/A ${year}). Please help me file my income tax return.\n\n${summary}`)}`;

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/50 sm:items-center sm:p-4" onMouseDown={(e) => e.target === e.currentTarget && !busy && onClose()}>
      <div className="max-h-[94vh] w-full max-w-md overflow-y-auto rounded-t-2xl bg-white shadow-xl sm:rounded-2xl">
        <div className="flex items-center gap-2 border-b px-4 py-3">
          <h3 className="flex-1 font-bold text-primary-800">{ok ? 'Thank you!' : `File my Y/A ${year} return with TaxMate`}</h3>
          <button type="button" onClick={onClose} className="rounded p-1 text-gray-400 hover:bg-gray-100" aria-label="Close"><X size={18} /></button>
        </div>
        {ok ? (
          <div className="space-y-3 p-5 text-center">
            <CheckCircle2 size={44} className="mx-auto text-green-600" />
            <p className="text-gray-700">We received your request. A TaxMate tax advisor will call you soon on <b>{f.phone}</b>.</p>
            <p className="text-xs text-gray-500">ඔබගේ ඉල්ලීම ලැබුණා — අපි ඉක්මනින් ඔබව අමතන්නෙමු.</p>
            <a href={wa} target="_blank" rel="noreferrer" className="flex w-full items-center justify-center gap-2 rounded-xl bg-[#25D366] py-3 font-semibold text-white hover:brightness-95"><MessageCircle size={18} /> Chat now on WhatsApp</a>
            <Link to="/join/calc" className="btn-secondary w-full justify-center border py-2.5"><UserPlus size={16} /> Create my free TaxMate account</Link>
          </div>
        ) : (
          <form onSubmit={send} className="space-y-3 p-4">
            <p className="text-sm text-gray-600">We prepare and file your Income Tax Return in RAMIS, claim every relief, and remind you of IRD dates. Leave your details — we'll call you with a quote.</p>
            <label className="block text-xs font-semibold text-gray-600">Your name *<input className="input mt-1" maxLength={120} autoComplete="name" value={f.name} onChange={set('name')} /></label>
            <label className="block text-xs font-semibold text-gray-600">Mobile / WhatsApp *<input className="input mt-1" type="tel" inputMode="tel" maxLength={20} autoComplete="tel" placeholder="07X XXX XXXX" value={f.phone} onChange={set('phone')} /></label>
            <label className="block text-xs font-semibold text-gray-600">Email (optional)<input className="input mt-1" type="email" maxLength={160} autoComplete="email" value={f.email} onChange={set('email')} /></label>
            <label className="block text-xs font-semibold text-gray-600">Message (optional)<textarea className="input mt-1 resize-none" rows={2} maxLength={500} placeholder="e.g. I'm a freelancer — please call after 6 pm" value={f.note} onChange={set('note')} /></label>
            <input type="text" tabIndex={-1} autoComplete="off" value={f.web} onChange={set('web')} className="absolute -left-[9999px] h-0 w-0 opacity-0" aria-hidden="true" />
            <div className="rounded-lg bg-gray-50 p-2.5 text-[11px] text-gray-600 whitespace-pre-line">{summary}</div>
            <label className="flex items-start gap-2 text-xs text-gray-600"><input type="checkbox" className="mt-0.5" checked={agree} onChange={(e) => { setAgree(e.target.checked); setErr(''); }} />
              <span>TaxMate may contact me about filing my tax return and keep these figures for that purpose.</span></label>
            {err && <div className="text-sm text-red-600">{err}</div>}
            <button type="submit" disabled={busy} className="btn-primary w-full justify-center py-3 text-base">{busy ? <Loader2 size={17} className="animate-spin" /> : <Send size={17} />} Send — call me back</button>
            <a href={wa} target="_blank" rel="noreferrer" className="flex w-full items-center justify-center gap-2 text-sm font-semibold text-green-700 hover:underline"><MessageCircle size={15} /> Or WhatsApp {FIRM.whatsapp}</a>
          </form>
        )}
      </div>
    </div>
  );
}
