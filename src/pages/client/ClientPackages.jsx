// V74 — client portal: choose a Tax & Accounting service package for a Y/A
import { useEffect, useMemo, useState } from 'react';
import toast from 'react-hot-toast';
import {
  User, Globe2, Laptop, HeartHandshake, Store, Users, Building2, FileCheck2, Check, X, Loader2, Info, MessageCircle, Globe, Sparkles, AlertTriangle, BadgeCheck, Clock,
} from 'lucide-react';
import { supabase } from '../../lib/supabase';
import { useAuth } from '../../contexts/AuthContext';
import { filingYear } from '../../lib/assets';
import { FIRM } from '../../lib/iitStatement';
import { waNumber } from '../../lib/share';
import { loadPackages, loadMyPackages, selectPackage, autoUpgrade, packageFit, bestCalcFor, upgradeReason, priceText, fullName } from '../../lib/packages';

const ICON = { personal_local: User, personal_fx: Globe2, freelancer: Laptop, senior: HeartHandshake, sole: Store, partnership: Users, company: Building2, nil: FileCheck2 };
const nextYear = (y) => { const s = parseInt(y, 10) + 1; return `${s}/${String(s + 1).slice(2)}`; };

export default function ClientPackages() {
  const { profile } = useAuth();
  const years = useMemo(() => { const f = filingYear(); return [f, nextYear(f)]; }, []);
  const [year, setYear] = useState(years[0]);
  const [pkgs, setPkgs] = useState(null);
  const [mine, setMine] = useState([]);
  const [calcs, setCalcs] = useState([]);
  const [client, setClient] = useState({});
  const [pick, setPick] = useState(null);       // package being confirmed
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);

  const load = async () => {
    const [p, m, { data: cs }, { data: cl }] = await Promise.all([
      loadPackages(), loadMyPackages(),
      supabase.from('iit_calculations').select('*').eq('shared_with_client', true).order('created_at', { ascending: false }).limit(50),
      supabase.from('clients').select('id, nic, full_name').eq('id', profile?.client_id).maybeSingle(),
    ]);
    setPkgs(p); setMine(m); setCalcs(cs ?? []); setClient(cl ?? {});
    return { m, cs: cs ?? [], cl: cl ?? {} };
  };

  // A Nil return with a computation that shows income tax → move to the suitable package (once)
  useEffect(() => {
    if (!profile?.client_id) return;
    load().then(async ({ m, cs, cl }) => {
      for (const row of m.filter((x) => x.package_key === 'nil')) {
        const fit = packageFit(bestCalcFor(cs, row.year), cl);
        if (fit?.liable) {
          try { await autoUpgrade(row.year, fit.suggested, upgradeReason(fit, row.year)); toast(`Y/A ${row.year}: your package was updated — your computation shows income tax.`, { icon: '🔁', duration: 7000 }); await load(); }
          catch { /* TaxMate will adjust it */ }
        }
      }
    });
  }, [profile?.client_id]); // eslint-disable-line react-hooks/exhaustive-deps

  const cur = mine.find((x) => x.year === year);
  const fit = packageFit(bestCalcFor(calcs, year), client);
  const curPkg = cur && pkgs?.find((p) => p.key === cur.package_key);

  const confirm = async () => {
    if (pick.key === 'nil' && fit?.liable) return;
    setBusy(true);
    try { await selectPackage(year, pick.key, note); toast.success('Package selected — TaxMate will confirm it with you.'); setPick(null); setNote(''); await load(); }
    catch (e) { toast.error(e.message); }
    setBusy(false);
  };

  const Card = ({ p }) => {
    const Icon = ICON[p.key] || FileCheck2;
    const isMine = cur?.package_key === p.key;
    const rec = fit && fit.suggested === p.key && !isMine;
    const nilBlocked = p.key === 'nil' && fit?.liable;
    return (
      <div className={`relative flex flex-col rounded-2xl border-2 bg-white p-4 shadow-sm transition hover:-translate-y-0.5 hover:shadow-md ${isMine ? 'border-gold-500 ring-2 ring-gold-500/30' : rec ? 'border-emerald-400' : 'border-amber-100'}`}>
        {isMine && <span className="absolute -top-2.5 left-1/2 -translate-x-1/2 whitespace-nowrap rounded-full bg-gold-500 px-2.5 py-0.5 text-[10px] font-black uppercase tracking-wide text-primary-900">Your package</span>}
        {rec && <span className="absolute -top-2.5 left-1/2 -translate-x-1/2 whitespace-nowrap rounded-full bg-emerald-600 px-2.5 py-0.5 text-[10px] font-black uppercase tracking-wide text-white">Recommended for you</span>}
        <div className="flex items-start gap-3">
          <div className="flex h-12 w-12 flex-shrink-0 items-center justify-center rounded-xl bg-primary-800 text-white"><Icon size={24} /></div>
          <div className="min-w-0">
            <div className="font-black leading-tight text-primary-900">{p.name}</div>
            {p.sub && <div className="text-xs italic text-gray-500">{p.sub}</div>}
            <div className="text-[11px] text-gray-400">{p.si}</div>
          </div>
        </div>
        <div className="mt-3 rounded-xl bg-gradient-to-r from-gold-500 to-amber-400 px-3 py-2 text-center text-primary-900">
          <div className="text-lg font-black leading-tight">{priceText(p)}</div>
        </div>
        <ul className="mt-3 flex-1 space-y-1 text-xs text-gray-600">
          {(p.includes || []).map((t) => <li key={t} className="flex gap-1.5"><Check size={13} className="mt-0.5 flex-shrink-0 text-emerald-600" />{t}</li>)}
        </ul>
        {nilBlocked && <div className="mt-2 rounded-lg bg-red-50 px-2 py-1.5 text-[11px] text-red-700">Not suitable for Y/A {year} — your computation shows income tax.</div>}
        <button type="button" disabled={isMine || nilBlocked} onClick={() => { setPick(p); setNote(''); }}
          className={`mt-3 w-full rounded-xl py-2.5 text-sm font-bold ${isMine ? 'bg-gold-500/20 text-amber-900' : nilBlocked ? 'bg-gray-100 text-gray-400' : 'bg-primary-800 text-white hover:bg-primary-700'}`}>
          {isMine ? <><Check size={15} className="mr-1 inline" />Selected</> : 'Choose this package'}
        </button>
      </div>
    );
  };

  const indiv = (pkgs || []).filter((p) => p.group !== 'business');
  const biz = (pkgs || []).filter((p) => p.group === 'business');
  const wa = `https://wa.me/${waNumber(FIRM.whatsapp)}?text=${encodeURIComponent(`Hi TaxMate, I have a question about the tax packages (Y/A ${year}).`)}`;

  return (
    <div className="space-y-5 pb-6">
      {/* Hero */}
      <div className="relative overflow-hidden rounded-3xl bg-gradient-to-br from-primary-800 via-primary-900 to-[#0b1b3a] p-5 text-white shadow-lg sm:p-7">
        <div className="absolute -right-10 -top-10 h-48 w-48 rounded-full bg-gold-500/20 blur-2xl" />
        <div className="relative">
          <div className="text-xs font-bold uppercase tracking-widest text-gold-500">TaxMate Solutions</div>
          <h1 className="mt-1 text-2xl font-black leading-tight sm:text-3xl">Tax &amp; Accounting <span className="text-gold-500">Service Packages</span></h1>
          <p className="mt-1 text-sm text-primary-200">Choose the package that fits you — TaxMate prepares and files everything for you. · ඔබට ගැලපෙන පැකේජය තෝරන්න.</p>
          <div className="mt-4 inline-flex rounded-xl bg-white/10 p-1">
            {years.map((y) => (
              <button key={y} type="button" onClick={() => setYear(y)} className={`rounded-lg px-3 py-1.5 text-sm font-semibold ${year === y ? 'bg-gold-500 text-primary-900' : 'text-primary-100 hover:bg-white/10'}`}>Y/A {y}</button>
            ))}
          </div>
        </div>
      </div>

      {/* Current package / auto change */}
      {cur && (
        <div className={`flex flex-wrap items-start gap-3 rounded-2xl border p-4 ${cur.selected_by === 'auto' ? 'border-amber-300 bg-amber-50' : 'border-emerald-200 bg-emerald-50'}`}>
          {cur.selected_by === 'auto' ? <AlertTriangle size={20} className="mt-0.5 text-amber-600" /> : cur.confirmed_at ? <BadgeCheck size={20} className="mt-0.5 text-emerald-600" /> : <Clock size={20} className="mt-0.5 text-emerald-600" />}
          <div className="min-w-0 flex-1 text-sm">
            <div className="font-bold text-gray-900">Y/A {year}: {curPkg ? fullName(curPkg) : cur.package_name} <span className="font-normal text-gray-600">· {priceText({ price: cur.price, from: cur.price_from, key: cur.package_key })}</span></div>
            {cur.selected_by === 'auto' && <div className="text-amber-900">Changed from <b>{cur.previous_name || 'Nil Return File'}</b>. {cur.change_reason}</div>}
            <div className="text-xs text-gray-600">{cur.confirmed_at ? 'Confirmed by TaxMate' : 'Waiting for TaxMate to confirm — we will contact you.'} · ගැලපෙන පැකේජය TaxMate සමඟ තහවුරු කෙරේ.</div>
          </div>
        </div>
      )}
      {!cur && fit && (
        <div className="flex gap-2 rounded-2xl border border-emerald-200 bg-emerald-50 p-3 text-sm text-emerald-900">
          <Sparkles size={17} className="mt-0.5 flex-shrink-0" />
          <div>Based on your Y/A {year} computation ({fit.why}{fit.tax ? `, income tax Rs. ${fit.tax.toLocaleString('en-LK')}` : ', no income tax'}), we recommend the <b>{fullName(pkgs?.find((p) => p.key === (fit.liable ? fit.suggested : 'nil')) || { name: '' })}</b> package.</div>
        </div>
      )}

      {!pkgs ? <div className="card flex justify-center p-12 text-gray-400"><Loader2 className="animate-spin" /></div> : (
        <>
          <div>
            <h2 className="mb-3 text-sm font-bold uppercase tracking-wide text-gray-500">Individuals · පුද්ගලයින්</h2>
            <div className="grid gap-4 pt-2 sm:grid-cols-2 xl:grid-cols-4">{indiv.map((p) => <Card key={p.key} p={p} />)}</div>
          </div>
          {biz.length > 0 && (
            <div>
              <h2 className="mb-3 text-sm font-bold uppercase tracking-wide text-gray-500">Businesses · ව්‍යාපාර</h2>
              <div className="grid gap-4 pt-2 sm:grid-cols-2 xl:grid-cols-3">{biz.map((p) => <Card key={p.key} p={p} />)}</div>
            </div>
          )}
        </>
      )}

      <div className="flex gap-2 rounded-2xl border border-gold-500/40 bg-amber-50/60 p-3 text-xs text-gray-700">
        <Info size={16} className="mt-0.5 flex-shrink-0 text-amber-700" />
        <span>Indicative starting rates. The final quote depends on transaction volume, complexity and turnaround. All packages include preparation, filing and IRD-related notifications, plus WhatsApp support.
          A Nil return is only for income within the tax-free relief — if your computation shows income tax, your package moves to the suitable one automatically.</span>
      </div>

      <div className="grid gap-3 rounded-3xl bg-primary-900 p-5 text-white sm:grid-cols-[1fr_auto] sm:items-center">
        <div>
          <div className="text-lg font-black text-gold-500">Free first consultation</div>
          <div className="text-sm text-primary-200">Not sure which package fits? Ask us — ඔබට ගැලපෙන එක අපි කියන්නම්.</div>
        </div>
        <div className="flex flex-wrap gap-2">
          <a href={wa} target="_blank" rel="noreferrer" className="flex items-center gap-1.5 rounded-xl bg-[#25D366] px-4 py-2.5 text-sm font-semibold text-white hover:brightness-95"><MessageCircle size={16} /> WhatsApp {FIRM.whatsapp}</a>
          <a href="https://www.taxmatesolutions.com" target="_blank" rel="noreferrer" className="flex items-center gap-1.5 rounded-xl bg-white/10 px-4 py-2.5 text-sm font-semibold hover:bg-white/20"><Globe size={16} /> Website</a>
        </div>
      </div>

      {pick && (
        <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/50 sm:items-center sm:p-4" onMouseDown={(e) => e.target === e.currentTarget && !busy && setPick(null)}>
          <div className="max-h-[92vh] w-full max-w-md overflow-y-auto rounded-t-2xl bg-white shadow-xl sm:rounded-2xl">
            <div className="flex items-center gap-2 border-b px-4 py-3">
              <h3 className="flex-1 font-bold text-primary-800">Confirm your package · Y/A {year}</h3>
              <button type="button" onClick={() => setPick(null)} className="rounded p-1 text-gray-400 hover:bg-gray-100" aria-label="Close"><X size={18} /></button>
            </div>
            <div className="space-y-3 p-4">
              <div className="rounded-xl bg-primary-50 p-3">
                <div className="font-black text-primary-900">{fullName(pick)}</div>
                <div className="text-sm font-bold text-amber-700">{priceText(pick)}</div>
                <ul className="mt-2 space-y-0.5 text-xs text-gray-600">{(pick.includes || []).map((t) => <li key={t}>✓ {t}</li>)}</ul>
              </div>
              {pick.key === 'nil' && <p className="rounded-lg bg-amber-50 p-2 text-xs text-amber-900">A Nil return is for income within the Rs. 1,800,000 tax-free relief. If your computation later shows income tax, your package moves to the suitable one automatically.</p>}
              {cur && <p className="text-xs text-gray-500">This replaces <b>{cur.package_name}</b> for Y/A {year}.</p>}
              <label className="block text-xs font-semibold text-gray-600">Anything we should know? (optional)
                <textarea className="input mt-1 resize-none" rows={2} maxLength={500} placeholder="e.g. I also have rent income" value={note} onChange={(e) => setNote(e.target.value)} />
              </label>
              <button type="button" disabled={busy} onClick={confirm} className="btn-primary w-full justify-center py-3 text-base">{busy ? <Loader2 size={17} className="animate-spin" /> : <Check size={17} />} Confirm package</button>
              <p className="text-center text-[11px] text-gray-400">TaxMate will contact you to confirm the final fee before starting.</p>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
