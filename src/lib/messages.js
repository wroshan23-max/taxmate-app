import { useEffect, useRef, useState } from 'react';
import { useLocation } from 'react-router-dom';
import { supabase } from './supabase';

/** Live updates for new messages (Supabase Realtime, respects RLS). */
export function useMessageFeed(onInsert, filter, key = 'all') {
  const cb = useRef(onInsert);
  cb.current = onInsert;
  useEffect(() => {
    const ch = supabase.channel(`msgs-${key}-${Math.random().toString(36).slice(2, 8)}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'messages', ...(filter ? { filter } : {}) }, (p) => cb.current?.(p))
      .subscribe();
    return () => { supabase.removeChannel(ch); };
  }, [filter, key]);
}

/** Unread count for the menu badge. role: 'admin' | 'client' */
export function useUnreadMessages(role, enabled = true) {
  const [n, setN] = useState(0);
  const loc = useLocation();
  const load = async () => {
    if (!enabled) return setN(0);
    if (role === 'client') {
      const { data } = await supabase.rpc('my_unread_messages');
      setN(Number(data) || 0);
    } else {
      const { count } = await supabase.from('messages').select('id', { count: 'exact', head: true }).eq('sender_role', 'client').is('read_at', null);
      setN(count ?? 0);
    }
  };
  useEffect(() => { load(); const t = setInterval(load, 60000); return () => clearInterval(t); }, [role, enabled, loc.pathname]); // eslint-disable-line react-hooks/exhaustive-deps
  useMessageFeed(() => setTimeout(load, 400), null, `badge-${role}`);
  return n;
}

export const timeLabel = (iso) => {
  const d = new Date(iso), now = new Date();
  const sameDay = d.toDateString() === now.toDateString();
  const y = new Date(now); y.setDate(now.getDate() - 1);
  const t = d.toLocaleTimeString('en-LK', { hour: 'numeric', minute: '2-digit' });
  if (sameDay) return t;
  if (d.toDateString() === y.toDateString()) return `Yesterday ${t}`;
  return d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', ...(d.getFullYear() !== now.getFullYear() ? { year: 'numeric' } : {}) }) + ` ${t}`;
};
export const dayLabel = (iso) => {
  const d = new Date(iso), now = new Date();
  if (d.toDateString() === now.toDateString()) return 'Today';
  const y = new Date(now); y.setDate(now.getDate() - 1);
  if (d.toDateString() === y.toDateString()) return 'Yesterday';
  return d.toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' });
};
