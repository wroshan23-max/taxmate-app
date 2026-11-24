// V76 — client portal: Business Accounts (sole proprietor / partnership) — fill income, expenses, assets, partners
import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import toast from 'react-hot-toast';
import { Store, ChevronRight, Loader2, Info } from 'lucide-react';
import BizEditor from '../../components/business/BizEditor';
import { useAuth } from '../../contexts/AuthContext';
import { listAccounts, STATUS, KIND } from '../../lib/bizAccounts';
import { fmtDate } from '../../lib/supabase';

const fm = (n) => Math.round(Number(n) || 0).toLocaleString('en-LK');

export default function ClientBusiness() {
  const { profile } = useAuth();
  const [rows, setRows] = useState(null);
  const [openId, setOpenId] = useState(null);
  const load = () => listAccounts().then((r) => setRows(r.rows)).catch((e) => { toast.error(e.message); setRows([]); });
  useEffect(() => { load(); }, []);
  const open = rows?.find((r) => r.id === openId);

  if (rows === null) return <div className="card p-8 text-center text-gray-400"><Loader2 className="mx-auto animate-spin" /></div>;
  if (open) return <BizEditor key={open.id} acc={open} role="client" client={profile || {}} onClose={() => { setOpenId(null); load(); }} onSaved={(row) => setRows((rs) => rs.map((x) => (x.id === row.id ? row : x)))} />;

  return (
    <div className="space-y-4">
      <div className="rounded-2xl bg-gradient-to-br from-primary-700 to-primary-900 p-5 text-white shadow-lg">
        <div className="flex items-center gap-3">
          <div className="flex h-11 w-11 items-center justify-center rounded-xl bg-white/15"><Store size={22} /></div>
          <div><h1 className="text-xl font-bold">Business Accounts</h1><p className="text-sm text-primary-200">ව්‍යාපාරික ගිණුම් · income, expenses &amp; assets of your business</p></div>
        </div>
      </div>
      <div className="flex gap-2 rounded-xl border border-blue-100 bg-blue-50 p-3 text-xs text-blue-900"><Info size={15} className="mt-0.5 flex-shrink-0" />
        <div>Enter the year's figures — as <b>annual totals</b> or <b>month by month</b>, whichever is easier. Add your own expense lines if needed, list the assets you use, then press <b>Send to TaxMate</b>. TaxMate works out the taxable business income (capital allowances, items not allowed) and puts it in your return.
          <span className="mt-0.5 block text-blue-800">වර්ෂයේ ආදායම්, වියදම් හා වත්කම් ඇතුළත් කර “Send to TaxMate” ඔබන්න. බදු අය කළ හැකි ව්‍යාපාරික ආදායම TaxMate ගණනය කරයි.</span></div></div>
      {rows.length === 0 ? (
        <div className="card p-8 text-center text-sm text-gray-500">No business accounts yet. <Link to="/client/messages" className="font-semibold text-primary-700 underline">Message TaxMate</Link> to set one up.</div>
      ) : (
        <div className="card divide-y divide-gray-100 overflow-hidden">
          {rows.map((r) => {
            const st = STATUS[r.status] || STATUS.open; const R = r.result;
            return (
              <button key={r.id} type="button" onClick={() => setOpenId(r.id)} className="flex w-full items-center gap-3 px-4 py-4 text-left hover:bg-gray-50">
                <span className="flex h-11 w-11 items-center justify-center rounded-2xl bg-primary-50 text-2xl">{KIND[r.kind]?.emoji}</span>
                <span className="min-w-0 flex-1">
                  <span className="block truncate font-bold text-gray-800">{r.name}</span>
                  <span className="flex flex-wrap items-center gap-2 text-[11px] text-gray-500"><span className="font-semibold text-primary-700">Y/A {r.year}</span>{KIND[r.kind]?.en}<span className={`rounded-full px-2 py-0.5 font-semibold ${st.cls}`}>{r.status === 'open' ? 'To fill' : st.short}</span>{r.updated_at && `· ${fmtDate(r.updated_at)}`}</span>
                </span>
                {R && <span className="text-right text-xs"><span className="block text-gray-400">{r.kind === 'partnership' ? 'Partnership tax' : 'Taxable business income'}</span><b className="tabular-nums text-primary-800">Rs. {fm(r.kind === 'partnership' ? R.tax : R.bizProfit)}</b></span>}
                <ChevronRight size={18} className="text-gray-300" />
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}
