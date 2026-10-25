import { planStyle } from '../lib/plans';

const SIZES = {
  sm: { box: 'w-8 h-8 text-sm', tag: 'w-4 h-4 text-[9px] -bottom-1 -right-1' },
  md: { box: 'w-10 h-10 text-base', tag: 'w-5 h-5 text-[11px] -bottom-1 -right-1' },
  lg: { box: 'w-12 h-12 text-xl', tag: 'w-6 h-6 text-xs -bottom-1 -right-1' },
};

/** Round initial. With an active plan it takes the plan's colours and gets a small plan emoji in the corner. */
export function PlanAvatar({ name, plan, size = 'sm', plain = 'bg-primary-100 text-primary-700' }) {
  const z = SIZES[size] ?? SIZES.sm;
  const st = plan ? planStyle(plan.plan_key) : null;
  return (
    <div className="relative flex-shrink-0" title={plan ? `${plan.plan_name} plan member` : undefined}>
      <div className={`${z.box} rounded-full flex items-center justify-center font-bold ${st ? st.avatar : plain}`}>
        {name?.trim()?.[0]?.toUpperCase() ?? '?'}
      </div>
      {st && <span className={`absolute ${z.tag} rounded-full bg-white flex items-center justify-center shadow ring-1 ring-black/5`}>{st.emoji}</span>}
    </div>
  );
}

/** "👑 Premium" pill. compact = emoji + name only. */
export function PlanBadge({ plan, compact = false, className = '' }) {
  if (!plan) return null;
  const st = planStyle(plan.plan_key);
  return (
    <span className={`inline-flex items-center gap-1 rounded-full font-bold whitespace-nowrap ${compact ? 'text-[10px] px-1.5 py-0.5' : 'text-[11px] px-2 py-0.5'} ${st.badge} ${className}`}>
      <span>{st.emoji}</span>{plan.plan_name}{!compact && ' member'}
    </span>
  );
}
