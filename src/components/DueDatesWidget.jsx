import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { CalendarClock, ChevronRight, Bell } from 'lucide-react';
import { supabase } from '../lib/supabase';
import { CATS, irdBetween, todayIso, addDays, daysUntil, dueLabel, fmtDay, reminderEvent, IRD_CATS, CLIENT_DEFAULT_CATS } from '../lib/taxCalendar';

/**
 * Compact "Upcoming due dates" card for dashboards.
 *  role: 'admin' | 'client'   cats: IRD categories to include   withReminders: also show reminders
 */
export default function DueDatesWidget({ role = 'admin', withReminders = true, days = 45, max = 6, to }) {
  const [rems, setRems] = useState([]);
  const from = todayIso(), until = addDays(from, days);
  const cats = role === 'admin' ? IRD_CATS.filter(c => !['bg', 'vatfs'].includes(c)) : CLIENT_DEFAULT_CATS;

  useEffect(() => {
    if (!withReminders) return;
    let q = supabase.from('reminders').select('*').gte('due_date', addDays(from, -3)).lte('due_date', until).is('done_at', null).order('due_date');
    if (role === 'admin') q = q.neq('audience', 'personal');
    q.then(({ data }) => setRems(data ?? []));
  }, [role, withReminders]); // eslint-disable-line react-hooks/exhaustive-deps

  const events = [...irdBetween(from, until, cats), ...rems.map(reminderEvent)]
    .sort((a, b) => a.date.localeCompare(b.date) || (a.cat === 'reminder' ? -1 : 1));
  // group same-day items of the same category so the list stays short
  const grouped = [];
  for (const e of events) {
    const g = grouped.find(x => x.date === e.date && x.cat === e.cat && !e.reminder && !x.reminder);
    if (g) g.titles.push(e.title); else grouped.push({ ...e, titles: [e.title] });
  }
  // keep the list short, but never hide an income-tax deadline inside the window
  const shown = grouped.slice(0, max);
  for (const g of grouped.slice(max)) if (g.cat === 'iit' && shown.length < max + 2) shown.push(g);

  return (
    <div className="card overflow-hidden">
      <div className="card-header"><CalendarClock size={16} /> Upcoming due dates
        <Link to={to ?? (role === 'admin' ? '/admin/calendar' : '/client/calendar')} className="ml-auto text-xs font-semibold text-primary-600 hover:underline flex items-center gap-0.5">Calendar <ChevronRight size={13} /></Link>
      </div>
      {shown.length === 0 ? <div className="p-6 text-center text-sm text-gray-400">Nothing due in the next {days} days 🎉</div> : (
        <div className="divide-y divide-gray-50">
          {shown.map(e => {
            const n = daysUntil(e.date);
            const urgent = n <= 3, soon = n <= 7;
            const cat = CATS[e.cat];
            return (
              <div key={e.id} className="flex items-center gap-3 px-4 py-2.5">
                <div className={`w-11 flex-shrink-0 rounded-lg text-center py-1 text-white ${cat.color}`}>
                  <div className="text-[10px] font-semibold uppercase leading-none opacity-90">{fmtDay(e.date, { month: 'short' })}</div>
                  <div className="text-lg font-black leading-tight">{fmtDay(e.date, { day: 'numeric' })}</div>
                </div>
                <div className="flex-1 min-w-0">
                  <div className="text-sm font-semibold text-gray-800 truncate flex items-center gap-1">{e.reminder && <Bell size={12} className="text-purple-500 flex-shrink-0" />}{e.titles.length > 1 ? `${cat.short}: ${e.titles.length} items` : e.title}</div>
                  <div className="text-[11px] text-gray-500 truncate">{e.titles.length > 1 ? e.titles.join(' · ') : (e.detail || cat.label)}</div>
                </div>
                <span className={`text-[11px] font-bold px-2 py-0.5 rounded-full whitespace-nowrap ${n < 0 ? 'bg-gray-100 text-gray-500' : urgent ? 'bg-red-100 text-red-700' : soon ? 'bg-amber-100 text-amber-800' : 'bg-gray-100 text-gray-600'}`}>{dueLabel(e.date)}</span>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
