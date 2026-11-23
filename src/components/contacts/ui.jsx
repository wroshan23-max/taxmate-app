// V75 — small shared pieces for the Contacts hub
import { colorOf } from '../../lib/clientFlags';
import { toneOf, initialsOf } from '../../lib/contactsHub';

export function Avatar({ c, size = 'h-10 w-10 text-sm', ring = '' }) {
  const lead = c?.kind === 'lead';
  return (
    <div className={`${size} ${ring} flex flex-shrink-0 items-center justify-center rounded-full font-bold text-white shadow-sm ${lead ? 'bg-gradient-to-br from-orange-400 to-amber-500' : `bg-gradient-to-br ${toneOf(c?.key)}`}`}>
      {lead && c?.unnamed ? '📞' : initialsOf(c?.name)}
    </div>
  );
}

export const GroupDot = ({ color, className = 'h-2 w-2' }) => <span className={`inline-block flex-shrink-0 rounded-full ${colorOf(color).dot} ${className}`} />;

export function GroupChip({ g, onClick, active, onRemove }) {
  const col = colorOf(g.color);
  return (
    <span className={`inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[11px] font-semibold ${active === false ? 'border-dashed border-gray-300 bg-white text-gray-500' : col.chip}`}>
      <button type="button" onClick={onClick} className="inline-flex items-center gap-1">{g.emoji ? <span>{g.emoji}</span> : <GroupDot color={g.color} />}{g.name}</button>
      {onRemove && <button type="button" onClick={onRemove} className="ml-0.5 opacity-60 hover:opacity-100" aria-label={`Remove from ${g.name}`}>×</button>}
    </span>
  );
}

export const EMOJIS = ['⭐', '💼', '🏢', '👨‍💻', '🌍', '👴', '🏠', '💰', '🎯', '🔥', '📌', '🤝', '🧾', '🏦', '📚', '❤️'];
export const GROUP_COLORS = ['blue', 'indigo', 'purple', 'pink', 'red', 'orange', 'amber', 'green', 'teal', 'gray'];
