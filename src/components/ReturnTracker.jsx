import { useState } from 'react';
import toast from 'react-hot-toast';
import { Check, Loader2, Plus, PartyPopper } from 'lucide-react';
import { supabase, fmtDate } from '../lib/supabase';
import { STAGES, stageIndex, docYears, defaultDocYear } from '../lib/documents';

/**
 * Return progress stepper: Documents received → Computing → Ready to review → Filed in RAMIS.
 *  onSet(stageKey) — admin: steps become clickable.   size: 'md' | 'sm'
 */
export function ReturnStepper({ ret, onSet, size = 'md', showSinhala = false }) {
  const [busy, setBusy] = useState(null);
  const cur = stageIndex(ret.stage);
  const done = ret.stage === 'filed';
  const pct = (cur / (STAGES.length - 1)) * 100;
  const sm = size === 'sm';

  const set = async (k) => {
    if (!onSet || k === ret.stage || busy) return;
    setBusy(k);
    try { await onSet(k); } finally { setBusy(null); }
  };

  return (
    <div className={sm ? '' : 'pt-1'}>
      <div className="relative">
        {/* track */}
        <div className={`absolute left-[12.5%] right-[12.5%] ${sm ? 'top-[15px]' : 'top-[19px]'} h-1 rounded-full bg-gray-200`}>
          <div className={`h-full rounded-full transition-all duration-700 ${done ? 'bg-gradient-to-r from-green-400 to-emerald-500' : 'bg-gradient-to-r from-primary-500 to-gold-500'}`} style={{ width: `${pct}%` }} />
        </div>
        <div className="relative grid grid-cols-4">
          {STAGES.map((s, i) => {
            const reached = i <= cur;
            const current = i === cur && !done;
            const at = ret.stage_at?.[s.key];
            const Tag = onSet ? 'button' : 'div';
            return (
              <Tag key={s.key} type={onSet ? 'button' : undefined} onClick={onSet ? () => set(s.key) : undefined}
                title={onSet ? `Set to "${s.label}"` : s.hint}
                className={`flex flex-col items-center text-center px-0.5 ${onSet ? 'group cursor-pointer' : ''}`}>
                <div className={`relative ${sm ? 'w-8 h-8 text-sm' : 'w-10 h-10 text-lg'} rounded-full flex items-center justify-center border-2 transition-all
                  ${reached ? (done ? 'bg-emerald-500 border-emerald-500 text-white' : current ? 'bg-white border-gold-500 shadow-[0_0_0_4px_rgba(234,179,8,0.18)]' : 'bg-primary-600 border-primary-600 text-white') : 'bg-white border-gray-200 text-gray-300'}
                  ${onSet ? 'group-hover:scale-110 group-hover:border-primary-400' : ''}`}>
                  {busy === s.key ? <Loader2 size={sm ? 14 : 16} className="animate-spin text-primary-600" />
                    : reached && !current ? <Check size={sm ? 15 : 18} strokeWidth={3} />
                    : <span className={current ? '' : 'grayscale opacity-60'}>{s.emoji}</span>}
                  {current && <span className="absolute inset-0 rounded-full animate-ping bg-gold-500/20" />}
                </div>
                <div className={`mt-1.5 font-semibold leading-tight ${sm ? 'text-[10px]' : 'text-xs'} ${reached ? (done ? 'text-emerald-700' : current ? 'text-primary-800' : 'text-primary-700') : 'text-gray-400'}`}>{s.label}</div>
                {showSinhala && <div className="text-[10px] text-gray-400 leading-tight">{s.si}</div>}
                {at && reached && !sm && <div className="text-[10px] text-gray-400">{fmtDate(at)}</div>}
              </Tag>
            );
          })}
        </div>
      </div>
      {!sm && (
        <div className={`mt-3 text-center text-xs font-medium rounded-lg py-1.5 ${done ? 'bg-emerald-50 text-emerald-700' : 'bg-primary-50 text-primary-700'}`}>
          {done ? <span className="inline-flex items-center gap-1"><PartyPopper size={13} /> Complete — filed with the IRD</span> : STAGES[cur].hint}
        </div>
      )}
    </div>
  );
}

/** Admin: move a return to another stage. */
export async function setReturnStage(id, stage) {
  const { data, error } = await supabase.from('tax_returns').update({ stage }).eq('id', id).select().single();
  if (error) { toast.error(error.message); throw error; }
  toast.success(`Moved to "${STAGES[stageIndex(stage)].label}"`);
  return data;
}

/** Admin: start tracking a Y/A for a client (creates the tax_returns row). */
export function StartTracking({ clientId, userId, existing = [], onCreated }) {
  const years = docYears().filter(y => !existing.includes(y));
  const [year, setYear] = useState(years.includes(defaultDocYear()) ? defaultDocYear() : years[0]);
  const [busy, setBusy] = useState(false);
  if (!years.length) return null;
  const start = async () => {
    setBusy(true);
    const s = parseInt(year, 10);
    const { data, error } = await supabase.from('tax_returns').insert({ client_id: clientId, created_by: userId, year, stage: 'docs', due_date: `${s + 1}-11-30` }).select().single();
    setBusy(false);
    if (error) return toast.error(error.message);
    toast.success(`Tracking Y/A ${year}`);
    onCreated?.(data);
  };
  return (
    <div className="flex items-center gap-2">
      <select className="input text-sm py-1.5 w-36" value={year} onChange={e => setYear(e.target.value)}>
        {years.map(y => <option key={y} value={y}>Y/A {y}</option>)}
      </select>
      <button onClick={start} disabled={busy} className="btn-primary text-sm py-1.5 whitespace-nowrap">{busy ? <Loader2 size={14} className="animate-spin" /> : <Plus size={14} />} Start tracking</button>
    </div>
  );
}
