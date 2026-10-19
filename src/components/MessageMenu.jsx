import { useState } from 'react';
import toast from 'react-hot-toast';
import { Send, Mail, Copy, MessageCircle, Share2 } from 'lucide-react';
import { whatsappLink, emailLink, waNumber } from '../lib/share';

/**
 * Send a ready-made message by WhatsApp / Email / copy.
 *  getText: async () => message text (may create the link first). Throw to abort.
 */
export default function MessageMenu({ phone, email, subject, getText, label = 'Send', className = '' }) {
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const canNative = typeof navigator !== 'undefined' && !!navigator.share;

  const go = async (channel) => {
    setOpen(false);
    const w = channel === 'wa' ? window.open('', '_blank') : null;   // open inside the click
    setBusy(true);
    try {
      const text = await getText();
      if (channel === 'wa') {
        const link = whatsappLink(phone, text);
        if (w) w.location.href = link; else window.open(link, '_blank');
        if (!waNumber(phone)) toast('No mobile number saved — pick the contact in WhatsApp', { icon: 'ℹ️' });
      } else if (channel === 'mail') {
        window.location.href = emailLink(email, subject, text);
      } else if (channel === 'native') {
        await navigator.share({ title: subject, text });
      } else {
        await navigator.clipboard.writeText(text);
        toast.success('Message with link copied');
      }
    } catch (e) {
      w?.close();
      if (e?.name !== 'AbortError') toast.error(e.message ?? String(e));
    }
    setBusy(false);
  };

  const item = 'w-full flex items-center gap-2 px-3 py-2 text-sm text-left hover:bg-gray-50';
  return (
    <div className={`relative inline-block ${className}`}>
      <button type="button" disabled={busy} onClick={() => setOpen(o => !o)}
        className="flex items-center gap-1.5 text-sm font-semibold px-3 py-1.5 rounded-lg bg-green-600 text-white hover:bg-green-700 disabled:opacity-60">
        <Send size={14} /> {busy ? 'Preparing…' : label}
      </button>
      {open && (
        <>
          <div className="fixed inset-0 z-40" onClick={() => setOpen(false)} />
          <div className="absolute left-0 z-50 mt-1 w-60 bg-white border border-gray-200 rounded-xl shadow-lg py-1">
            <button className={item} onClick={() => go('wa')}><MessageCircle size={15} className="text-green-600" /> WhatsApp{phone ? <span className="ml-auto text-xs text-gray-400">{phone}</span> : null}</button>
            <button className={item} onClick={() => go('mail')}><Mail size={15} className="text-blue-600" /> Email{email ? <span className="ml-auto text-xs text-gray-400 truncate max-w-[110px]">{email}</span> : null}</button>
            {canNative && <button className={item} onClick={() => go('native')}><Share2 size={15} className="text-primary-600" /> Share… (phone apps)</button>}
            <button className={item} onClick={() => go('copy')}><Copy size={15} className="text-gray-500" /> Copy message + link</button>
          </div>
        </>
      )}
    </div>
  );
}
