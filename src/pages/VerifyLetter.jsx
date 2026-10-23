import { useEffect, useState } from 'react';
import { useParams, Link } from 'react-router-dom';
import { ShieldCheck, ShieldX, Loader2 } from 'lucide-react';
import { supabase } from '../lib/supabase';
import { PURPOSES } from '../lib/summaryLetter';
import { FIRM } from '../lib/iitStatement';

const rs = (v) => `Rs. ${Number(v || 0).toLocaleString('en-LK', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

/** Public: check that an Income & Tax summary letter is genuine — /verify/<ref> */
export default function VerifyLetter() {
  const { ref } = useParams();
  const [r, setR] = useState(null);
  useEffect(() => { supabase.rpc('verify_summary_letter', { p_ref: ref }).then(({ data }) => setR(data ?? { valid: false })); }, [ref]);

  return (
    <div className="min-h-screen bg-gradient-to-br from-primary-700 via-primary-800 to-indigo-900 flex items-center justify-center p-4">
      <div className="w-full max-w-md">
        <div className="text-center mb-5"><div className="text-3xl font-black text-white">Tax<span className="text-gold-500">Mate</span></div><div className="text-primary-200 text-xs">Letter verification</div></div>
        <div className="bg-white rounded-3xl shadow-2xl p-6 space-y-4">
          {!r ? <div className="py-10 text-center text-gray-400"><Loader2 className="animate-spin mx-auto" /></div> : r.valid ? (
            <>
              <div className="flex items-center gap-3">
                <div className="w-14 h-14 rounded-2xl bg-emerald-500 text-white flex items-center justify-center"><ShieldCheck size={30} /></div>
                <div><div className="text-xl font-black text-emerald-700">Genuine letter</div><div className="text-xs text-gray-500">Issued by {FIRM.name}</div></div>
              </div>
              <div className="rounded-2xl bg-gray-50 divide-y divide-gray-100 text-sm">
                {[['Reference', r.ref], ['Taxpayer', r.name], ['Year of assessment', r.year], ['Purpose', PURPOSES[r.purpose]?.label], ['Issued on', new Date(r.issued_at).toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' })],
                  ['Total assessable income', rs(r.total_income)], ['Income tax liability', rs(r.tax)], ['Return status', r.filed ? 'Filed with the IRD' : 'Computation prepared']].map(([k, v]) => (
                  <div key={k} className="flex justify-between gap-3 px-4 py-2"><span className="text-gray-500">{k}</span><b className="text-gray-800 text-right">{v}</b></div>
                ))}
              </div>
              <p className="text-[11px] text-gray-400">Check that these details match the letter you received. For questions contact {FIRM.name}: {FIRM.phone} · {FIRM.email}</p>
            </>
          ) : (
            <div className="text-center space-y-3 py-4">
              <div className="w-16 h-16 mx-auto rounded-2xl bg-red-500 text-white flex items-center justify-center"><ShieldX size={34} /></div>
              <div className="text-xl font-black text-red-700">Not found</div>
              <p className="text-sm text-gray-600">No valid letter with reference <b className="font-mono">{ref}</b>. Please contact {FIRM.name} on {FIRM.phone}.</p>
            </div>
          )}
          <Link to="/calculator" className="block text-center text-xs text-primary-700 hover:underline">TaxMate free tax calculator →</Link>
        </div>
      </div>
    </div>
  );
}
