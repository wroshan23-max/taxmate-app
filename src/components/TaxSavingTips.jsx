import { useMemo } from 'react';
import { Lightbulb, MessageCircle, Sparkles } from 'lucide-react';
import { Link } from 'react-router-dom';
import { taxSavingTips } from '../lib/taxTips';
import { FIRM } from '../lib/iitStatement';

const rs = (v) => `Rs. ${Math.round(v).toLocaleString('en-LK')}`;
const waLink = (text) => `https://wa.me/94${String(FIRM.whatsapp || FIRM.phone || '').replace(/\D/g, '').replace(/^0/, '')}?text=${encodeURIComponent(text)}`;

/**
 * "You could save Rs. X" cards under a tax result.
 *  x: computePersonal input (annual)   mode: 'client' (link to Messages) | 'public' (WhatsApp)
 */
export default function TaxSavingTips({ year, x, mode = 'public' }) {
  const { base, tips, combined } = useMemo(() => taxSavingTips(year, x), [year, x]);
  if (!tips.length) return null;
  const money = tips.filter(t => t.save > 0);
  const info = tips.filter(t => !t.save);

  return (
    <div className="card overflow-hidden">
      <div className="px-5 py-4 bg-gradient-to-r from-amber-50 via-white to-emerald-50 border-b border-gray-100 flex items-start gap-3">
        <div className="w-10 h-10 rounded-2xl bg-gold-500 text-primary-900 flex items-center justify-center flex-shrink-0 shadow-sm"><Lightbulb size={20} /></div>
        <div className="flex-1">
          <div className="font-bold text-gray-800">Ways to pay less tax {money.length > 0 && <span className="text-emerald-700">· save up to {rs(combined)}</span>}</div>
          <div className="text-xs text-gray-500">බදු ඉතුරු කරගන්න ක්‍රම — based on your figures (resident individual, Y/A {year})</div>
        </div>
      </div>
      <div className="p-4 grid sm:grid-cols-2 gap-3">
        {money.map(t => (
          <div key={t.key} className="rounded-2xl border border-emerald-100 bg-emerald-50/50 p-4">
            <div className="flex items-start gap-2">
              <div className="text-2xl">{t.emoji}</div>
              <div className="flex-1">
                <div className="font-semibold text-gray-800 text-sm">{t.title}</div>
                <div className="text-[11px] text-gray-400">{t.si}</div>
              </div>
              <div className="text-right">
                <div className="text-[10px] uppercase font-bold text-emerald-700">Save up to</div>
                <div className="text-lg font-black text-emerald-700 tabular-nums">{rs(t.save)}</div>
              </div>
            </div>
            <p className="text-xs text-gray-600 mt-2 leading-relaxed">{t.body}</p>
          </div>
        ))}
        {info.map(t => (
          <div key={t.key} className="rounded-2xl border border-gray-100 bg-gray-50 p-4">
            <div className="flex items-start gap-2">
              <div className="text-xl">{t.emoji}</div>
              <div className="flex-1">
                <div className="font-semibold text-gray-800 text-sm">{t.title}</div>
                <p className="text-xs text-gray-600 mt-1 leading-relaxed">{t.body}</p>
              </div>
            </div>
          </div>
        ))}
      </div>
      <div className="px-4 pb-4 flex items-center gap-3 flex-wrap">
        <p className="text-[11px] text-gray-400 flex-1 min-w-[200px]">Estimates only — reliefs need proper receipts and depend on IRD rules. TaxMate checks every relief before filing.</p>
        {mode === 'client'
          ? <Link to="/client/messages" className="btn-primary text-sm"><Sparkles size={15} /> Ask TaxMate to plan this</Link>
          : <a href={waLink(`Hi TaxMate! The calculator says I pay about ${rs(base.tax)} tax. Can you help me reduce it?`)} target="_blank" rel="noreferrer"
              className="rounded-xl bg-[#25D366] hover:brightness-95 text-white font-semibold text-sm px-4 py-2 flex items-center gap-2 shadow-sm"><MessageCircle size={16} /> Ask on WhatsApp</a>}
      </div>
    </div>
  );
}
