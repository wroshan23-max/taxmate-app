import { useState } from 'react';
import toast from 'react-hot-toast';
import { Send, Mail, Link2, Copy, MessageCircle, Share2, Unlink } from 'lucide-react';
import { supabase } from '../lib/supabase';
import { ensureShareToken, disableShareLink, shareUrl, whatsappLink, emailLink, waNumber } from '../lib/share';

/**
 * "Send" dropdown: WhatsApp, Email, copy message / link, phone share sheet, disable link.
 *  table        'iit_calculations' | 'invoices'
 *  row          the record (needs id, share_token)
 *  phone/email  client contact (optional — WhatsApp/email app lets you pick if missing)
 *  subject      email subject
 *  buildMessage (url) => message text
 *  beforeSend   optional async () => patch   (e.g. mark a draft invoice as sent)
 *  onChange     (patch) => void               (update the row in the parent list)
 */
export default function SendMenu({ table, row, phone, email, subject, buildMessage, beforeSend, onChange, label = 'Send' }) {
  const [open, setOpen] = useState(false);
  const canNativeShare = typeof navigator !== 'undefined' && !!navigator.share;

  const go = async (channel) => {
    setOpen(false);
    // open WhatsApp's window inside the click so the browser doesn't block it
    const w = channel === 'wa' ? window.open('', '_blank') : null;
    try {
      let patch = beforeSend ? await beforeSend() : null;
      const token = await ensureShareToken(supabase, table, row);
      if (token !== row.share_token) patch = { ...(patch || {}), share_token: token };
      if (patch) onChange?.(patch);
      const url = shareUrl(token);
      const text = buildMessage(url);

      if (channel === 'wa') {
        const link = whatsappLink(phone, text);
        if (w) w.location.href = link; else window.open(link, '_blank');
        if (!waNumber(phone)) toast('No mobile number saved — pick the contact in WhatsApp', { icon: 'ℹ️' });
      } else if (channel === 'mail') {
        window.location.href = emailLink(email, subject, text);
        if (!email) toast('No email saved — enter the address in your mail app', { icon: 'ℹ️' });
      } else if (channel === 'native') {
        await navigator.share({ title: subject, text });
      } else if (channel === 'copy') {
        await navigator.clipboard.writeText(text);
        toast.success('Message with link copied');
      } else if (channel === 'link') {
        await navigator.clipboard.writeText(url);
        toast.success('Link copied');
      }
    } catch (e) {
      w?.close();
      if (e?.name !== 'AbortError') toast.error(e.message ?? String(e));
    }
  };

  const disable = async () => {
    setOpen(false);
    if (!window.confirm('Turn off the shared link? Anyone with the old link will no longer be able to open this document.')) return;
    try {
      await disableShareLink(supabase, table, row.id);
      onChange?.({ share_token: null });
      toast.success('Share link turned off');
    } catch (e) { toast.error(e.message); }
  };

  const item = 'w-full flex items-center gap-2 px-3 py-2 text-sm text-left hover:bg-gray-50';
  return (
    <div className="relative inline-block">
      <button type="button" onClick={() => setOpen(o => !o)}
        className="flex items-center gap-1 text-xs font-semibold px-2.5 py-1 rounded-lg bg-green-600 text-white hover:bg-green-700">
        <Send size={12} /> {label}
      </button>
      {open && (
        <>
          <div className="fixed inset-0 z-40" onClick={() => setOpen(false)} />
          <div className="absolute right-0 z-50 mt-1 w-60 bg-white border border-gray-200 rounded-xl shadow-lg py-1">
            <button className={item} onClick={() => go('wa')}><MessageCircle size={15} className="text-green-600" /> WhatsApp{phone ? <span className="ml-auto text-xs text-gray-400">{phone}</span> : null}</button>
            <button className={item} onClick={() => go('mail')}><Mail size={15} className="text-blue-600" /> Email{email ? <span className="ml-auto text-xs text-gray-400 truncate max-w-[110px]">{email}</span> : null}</button>
            {canNativeShare && <button className={item} onClick={() => go('native')}><Share2 size={15} className="text-primary-600" /> Share… (phone apps)</button>}
            <button className={item} onClick={() => go('copy')}><Copy size={15} className="text-gray-500" /> Copy message + link</button>
            <button className={item} onClick={() => go('link')}><Link2 size={15} className="text-gray-500" /> Copy link only</button>
            {row.share_token && (
              <button className={`${item} text-red-600 border-t border-gray-100`} onClick={disable}><Unlink size={15} /> Turn off shared link</button>
            )}
          </div>
        </>
      )}
    </div>
  );
}
