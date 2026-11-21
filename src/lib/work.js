// V70 — Work board: tasks per client moved across stages, assigned to team members
import { supabase } from './supabase';

export const STAGES = [
  { key: 'todo', label: 'To do', si: 'කළ යුතු', dot: 'bg-gray-400', head: 'bg-gray-100 text-gray-700' },
  { key: 'waiting', label: 'Waiting for client', si: 'ගනුදෙනුකරු බලාපොරොත්තුවෙන්', dot: 'bg-amber-500', head: 'bg-amber-50 text-amber-800' },
  { key: 'doing', label: 'In progress', si: 'කරමින්', dot: 'bg-blue-500', head: 'bg-blue-50 text-blue-800' },
  { key: 'review', label: 'Review', si: 'පරීක්ෂාව', dot: 'bg-purple-500', head: 'bg-purple-50 text-purple-800' },
  { key: 'done', label: 'Done', si: 'අවසන්', dot: 'bg-green-500', head: 'bg-green-50 text-green-800' },
];
export const stageOf = (k) => STAGES.find((s) => s.key === k) || STAGES[0];

export const KINDS = [
  { key: 'iit', label: 'IIT return', emoji: '🧾' },
  { key: 'cit', label: 'Company tax return', emoji: '🏢' },
  { key: 'vat', label: 'VAT return', emoji: '📑' },
  { key: 'apit', label: 'PAYE / APIT', emoji: '👥' },
  { key: 'books', label: 'Bookkeeping', emoji: '📒' },
  { key: 'accounts', label: 'Financial statements', emoji: '📊' },
  { key: 'payroll', label: 'Payroll / EPF / ETF', emoji: '💼' },
  { key: 'tin', label: 'TIN / RAMIS', emoji: '🆔' },
  { key: 'advice', label: 'Consultation', emoji: '💬' },
  { key: 'other', label: 'Other', emoji: '📌' },
];
export const kindOf = (k) => KINDS.find((x) => x.key === k) || KINDS[KINDS.length - 1];

const SELECT = 'id, client_id, title, kind, period, stage, assignee, due_date, priority, notes, source, done_at, created_at, updated_at, clients(id, full_name, client_no, mobile)';
const notSetUp = (e) => (/work_items|admin_team|schema cache|does not exist/.test(e?.message || '') ? new Error('The work board database is not set up yet — run the V70 script in Supabase.') : e);

// open tasks + tasks finished in the last `doneDays` days
export async function loadWork({ clientId = null, doneDays = 30 } = {}) {
  const since = new Date(Date.now() - doneDays * 86400000).toISOString();
  let q = supabase.from('work_items').select(SELECT).or(`stage.neq.done,done_at.gte.${since}`).order('due_date', { ascending: true, nullsFirst: false }).order('created_at', { ascending: false }).limit(1000);
  if (clientId) q = q.eq('client_id', clientId);
  const { data, error } = await q;
  if (error) throw notSetUp(error);
  return data ?? [];
}

export async function loadTeam() {
  const { data, error } = await supabase.rpc('admin_team');
  if (error) throw notSetUp(error);
  return data ?? [];
}

const clean = (w) => ({
  client_id: w.client_id || null,
  title: (w.title || '').trim().slice(0, 150),
  kind: w.kind || 'other',
  period: (w.period || '').trim() || null,
  stage: w.stage || 'todo',
  assignee: w.assignee || null,
  due_date: w.due_date || null,
  priority: w.priority === 'high' ? 'high' : 'normal',
  notes: (w.notes || '').trim() || null,
});

export async function saveWork(w) {
  const row = clean(w);
  const q = w.id ? supabase.from('work_items').update(row).eq('id', w.id) : supabase.from('work_items').insert(row);
  const { data, error } = await q.select(SELECT).single();
  if (error) throw notSetUp(error);
  return data;
}

export async function moveWork(id, stage) {
  const { data, error } = await supabase.from('work_items').update({ stage }).eq('id', id).select(SELECT).single();
  if (error) throw notSetUp(error);
  return data;
}

export async function deleteWork(id) {
  const { error } = await supabase.from('work_items').delete().eq('id', id);
  if (error) throw notSetUp(error);
}

const today = () => new Date(Date.now() + 5.5 * 3600000).toISOString().slice(0, 10);   // Sri Lanka date
export function dueState(w) {
  if (!w.due_date || w.stage === 'done') return null;
  const t = today();
  if (w.due_date < t) return 'overdue';
  if (w.due_date === t) return 'today';
  const in7 = new Date(Date.parse(t) + 7 * 86400000).toISOString().slice(0, 10);
  return w.due_date <= in7 ? 'soon' : 'later';
}
export const DUE_STYLE = { overdue: 'bg-red-100 text-red-700', today: 'bg-orange-100 text-orange-700', soon: 'bg-amber-50 text-amber-700', later: 'bg-gray-100 text-gray-600' };
export const dueLabel = (w) => {
  const s = dueState(w); if (!s) return '';
  const d = new Date(w.due_date + 'T00:00:00').toLocaleDateString('en-GB', { day: 'numeric', month: 'short' });
  return s === 'overdue' ? `Overdue · ${d}` : s === 'today' ? 'Due today' : `Due ${d}`;
};

export const initials = (n = '') => n.split(/[\s@.]+/).filter(Boolean).slice(0, 2).map((x) => x[0]?.toUpperCase()).join('') || '?';

// suggested title from kind + period ("VAT return — Oct 2026")
export const suggestTitle = (kind, period) => `${kindOf(kind).label}${period ? ` — ${period}` : ''}`;

export const STAGE_ORDER = STAGES.map((s) => s.key);
export const nextStage = (k, dir) => STAGE_ORDER[Math.min(STAGE_ORDER.length - 1, Math.max(0, STAGE_ORDER.indexOf(k) + dir))];
