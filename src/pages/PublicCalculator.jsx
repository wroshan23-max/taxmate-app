import { useEffect } from 'react';
import { Link } from 'react-router-dom';
import { LogIn, MessageCircle, UserPlus, ShieldCheck, FileCheck2, Clock, Globe } from 'lucide-react';
import SimpleTaxCalculator from '../components/SimpleTaxCalculator';
import { FIRM, websiteUrl } from '../lib/iitStatement';

const wa = () => `https://wa.me/94${String(FIRM.whatsapp || FIRM.phone || '').replace(/\D/g, '').replace(/^0/, '')}?text=${encodeURIComponent('Hi TaxMate! I used your tax calculator. I would like help with my income tax return.')}`;

/** Public, no-login simple tax calculator: /calculator */
export default function PublicCalculator() {
  useEffect(() => {
    const t = document.title;
    document.title = 'Sri Lanka Income Tax Calculator 2025/26 · TaxMate Solutions';
    return () => { document.title = t; };
  }, []);

  return (
    <div className="min-h-screen bg-gray-50">
      <header className="bg-gradient-to-br from-primary-700 via-primary-800 to-indigo-900 text-white">
        <div className="max-w-6xl mx-auto px-4 py-4 flex items-center gap-3">
          <div className="text-2xl font-black">Tax<span className="text-gold-500">Mate</span></div>
          <div className="text-xs text-primary-200 hidden sm:block">{FIRM.tagline}</div>
          <a href={websiteUrl()} className="ml-auto inline-flex items-center gap-1.5 text-sm font-semibold text-primary-100 hover:text-white rounded-xl px-2 py-1.5"><Globe size={15} /> <span className="hidden sm:inline">Website</span></a>
          <Link to="/login" className="inline-flex items-center gap-1.5 text-sm font-semibold bg-white/10 hover:bg-white/20 rounded-xl px-3 py-1.5"><LogIn size={15} /> Sign in</Link>
        </div>
        <div className="max-w-6xl mx-auto px-4 pt-6 pb-24">
          <div className="inline-flex items-center gap-1.5 text-xs font-bold uppercase tracking-wider bg-white/15 rounded-full px-3 py-1">🇱🇰 Free · No sign-up</div>
          <h1 className="text-3xl sm:text-4xl font-black mt-3 leading-tight">How much income tax do I pay?</h1>
          <p className="text-primary-200 mt-2 max-w-2xl">Type your income — local, foreign, or both — and see your tax in seconds. Based on the latest Inland Revenue rates.</p>
          <p className="text-primary-300 text-sm mt-1">ඔබේ ආදායම ඇතුළත් කරන්න — ඔබ ගෙවිය යුතු බද්ද ක්ෂණිකව බලාගන්න.</p>
        </div>
      </header>

      <main className="max-w-6xl mx-auto px-4 -mt-16 pb-10 space-y-6">
        <SimpleTaxCalculator mode="public" />

        <section className="relative overflow-hidden rounded-3xl bg-white border border-gray-100 shadow-sm p-6 sm:p-8">
          <div className="absolute -right-16 -bottom-16 w-64 h-64 rounded-full bg-gold-500/10 blur-2xl" />
          <div className="relative grid md:grid-cols-[1.4fr_1fr] gap-6 items-center">
            <div>
              <h2 className="text-2xl font-black text-primary-800">Let TaxMate file it for you</h2>
              <p className="text-gray-600 mt-1">We prepare and file your Income Tax Return in RAMIS, claim every relief you're entitled to, and keep you on time with IRD.</p>
              <div className="grid sm:grid-cols-3 gap-3 mt-4">
                {[[FileCheck2, 'Filed in RAMIS', 'Done right, on time'], [ShieldCheck, 'Private & secure', 'Your own client portal'], [Clock, 'Reminders', 'Never miss an IRD date']].map(([I, t, d]) => (
                  <div key={t} className="rounded-2xl bg-gray-50 p-3"><I size={18} className="text-primary-600" /><div className="font-semibold text-sm text-gray-800 mt-1">{t}</div><div className="text-xs text-gray-500">{d}</div></div>
                ))}
              </div>
            </div>
            <div className="space-y-2">
              <Link to="/join/calc" className="w-full btn-primary justify-center py-3 text-base"><UserPlus size={18} /> Register in 2 minutes</Link>
              <a href={wa()} target="_blank" rel="noreferrer" className="w-full rounded-xl bg-[#25D366] hover:brightness-95 text-white font-semibold py-3 flex items-center justify-center gap-2"><MessageCircle size={18} /> WhatsApp {FIRM.whatsapp}</a>
            </div>
          </div>
        </section>

        <p className="text-[11px] text-gray-400 text-center max-w-3xl mx-auto">
          Estimate for a Sri Lankan resident individual under the Inland Revenue Act No. 24 of 2017 (as amended). Not included: capital gains, terminal benefits, dividends and other final-tax income.
          This is a guide, not tax advice. © {FIRM.name}
        </p>
      </main>
    </div>
  );
}
