import { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Bell, CheckCheck, X, Crown, Receipt, BadgeCheck, AlertTriangle, FileText, CalendarCheck, Calculator, ClipboardList, Info, PartyPopper } from 'lucide-react';
import { supabase } from '../lib/supabase';
import { timeLabel } from '../lib/messages';

const KIND = {
  plan:    { icon: Crown, cls: 'bg-amber-100 text-amber-700' },
  invoice: { icon: Receipt, cls: 'bg-blue-100 text-blue-700' },
  paid:    { icon: BadgeCheck, cls: 'bg-emerald-100 text-emerald-700' },
  warning: { icon: AlertTriangle, cls: 'bg-red-100 text-red-600' },
  report:  { icon: FileText, cls: 'bg-indigo-100 text-indigo-700' },
  service: { icon: CalendarCheck, cls: 'bg-violet-100 text-violet-700' },
  return:  { icon: ClipboardList, cls: 'bg-sky-100 text-sky-700' },
  success: { icon: PartyPopper, cls: 'bg-emerald-100 text-emerald-700' },
  calc:    { icon: Calculator, cls: 'bg-gold-500/20 text-amber-800' },
  todo:    { icon: ClipboardList, cls: 'bg-orange-100 text-orange-700' },
  info:    { icon: Info, cls: 'bg-gray-100 text-gray-600' },
};

/** Client portal: bell in the header with a red unread count and a notification list. */
export default function NotificationBell({ onCount }) {
  const [items, setItems] = useState([]);
  const [open, setOpen] = useState(false);
  const ref = useRef(null);
  const navigate = useNavigate();
  const unread = items.filter(n => !n.read_at).length;

  const load = async () => {
    const { data } = await supabase.from('client_notifications').select('*').order('created_at', { ascending: false }).limit(40);
    setItems(data ?? []);
  };
  useEffect(() => {
    load();
    const t = setInterval(load, 60000);
    const ch = supabase.channel(`ntf-${Math.random().toString(36).slice(2, 8)}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'client_notifications' }, () => setTimeout(load, 300))
      .subscribe();
    return () => { clearInterval(t); supabase.removeChannel(ch); };
  }, []);
  useEffect(() => { onCount?.(unread); }, [unread]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    if (!open) return;
    const close = (e) => { if (ref.current && !ref.current.contains(e.target)) setOpen(false); };
    const esc = (e) => { if (e.key === 'Escape') setOpen(false); };
    document.addEventListener('mousedown', close); document.addEventListener('keydown', esc);
    return () => { document.removeEventListener('mousedown', close); document.removeEventListener('keydown', esc); };
  }, [open]);

  const markAll = async () => {
    setItems(xs => xs.map(n => ({ ...n, read_at: n.read_at ?? new Date().toISOString() })));
    await supabase.rpc('mark_my_notifications_read', { p_id: null });
  };
  const openItem = async (n) => {
    if (!n.read_at) {
      setItems(xs => xs.map(x => (x.id === n.id ? { ...x, read_at: new Date().toISOString() } : x)));
      supabase.rpc('mark_my_notifications_read', { p_id: n.id });
    }
    setOpen(false);
    if (n.link) navigate(n.link);
  };

  return (
    <div className="relative" ref={ref}>
      <button onClick={() => setOpen(o => !o)} title="Notifications" aria-label={`Notifications${unread ? ` (${unread} new)` : ''}`}
        className={`relative p-2 rounded-lg hover:bg-gray-100 ${open ? 'bg-gray-100 text-primary-700' : 'text-gray-500'}`}>
        <Bell size={19} />
        {unread > 0 && <span className="absolute top-0.5 right-0.5 text-[9px] font-black bg-red-500 text-white rounded-full px-1 min-w-[15px] h-[15px] leading-[15px] text-center ring-2 ring-white">{unread > 99 ? '99+' : unread}</span>}
      </button>

      {open && (
        <div className="fixed inset-x-3 top-14 sm:absolute sm:inset-x-auto sm:right-0 sm:top-full sm:mt-2 sm:w-96 bg-white rounded-2xl shadow-2xl border border-gray-100 z-50 overflow-hidden">
          <div className="px-4 py-3 border-b border-gray-100 flex items-center gap-2">
            <div className="font-bold text-gray-800 flex-1">Notifications {unread > 0 && <span className="ml-1 text-[11px] font-bold bg-red-500 text-white rounded-full px-1.5 py-0.5">{unread} new</span>}</div>
            {unread > 0 && <button onClick={markAll} className="text-xs font-semibold text-primary-700 hover:underline inline-flex items-center gap-1"><CheckCheck size={14} /> Mark all read</button>}
            <button onClick={() => setOpen(false)} className="p-1 text-gray-400 hover:text-gray-600 sm:hidden"><X size={16} /></button>
          </div>
          <div className="max-h-[70vh] sm:max-h-[420px] overflow-y-auto divide-y divide-gray-50">
            {items.length === 0 ? (
              <div className="p-8 text-center text-sm text-gray-400"><Bell size={28} className="mx-auto mb-2 text-gray-300" />No notifications yet.<div className="text-xs mt-1">Updates from TaxMate will appear here.</div></div>
            ) : items.map(n => {
              const k = KIND[n.kind] ?? KIND.info; const Icon = k.icon;
              return (
                <button key={n.id} onClick={() => openItem(n)} className={`w-full text-left px-4 py-3 flex gap-3 hover:bg-gray-50 ${n.read_at ? '' : 'bg-primary-50/50'}`}>
                  <div className={`w-9 h-9 rounded-xl flex items-center justify-center flex-shrink-0 ${k.cls}`}><Icon size={17} /></div>
                  <div className="flex-1 min-w-0">
                    <div className={`text-sm ${n.read_at ? 'text-gray-700' : 'font-semibold text-gray-900'}`}>{n.title}</div>
                    {n.body && <div className="text-xs text-gray-500 mt-0.5 line-clamp-2">{n.body}</div>}
                    <div className="text-[11px] text-gray-400 mt-1">{timeLabel(n.created_at)}</div>
                  </div>
                  {!n.read_at && <span className="w-2 h-2 rounded-full bg-red-500 mt-1.5 flex-shrink-0" />}
                </button>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}
