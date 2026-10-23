import { useEffect, useRef, useState } from 'react';
import toast from 'react-hot-toast';
import { X, CreditCard, Landmark, Loader2, Upload, Copy, ShieldCheck, CheckCircle2, Camera } from 'lucide-react';
import { fmtRs } from '../lib/supabase';
import { paymentOptions, startPayHere, submitBankPayment } from '../lib/payments';

const today = () => new Date().toISOString().slice(0, 10);

/** Pay one invoice: PayHere (card / eZ Cash / mCash / internet banking) or bank transfer + slip. */
export default function PayInvoiceDialog({ invoice, clientId, onClose, onSubmitted }) {
  const [opts, setOpts] = useState(null);
  const [tab, setTab] = useState(null);
  const [busy, setBusy] = useState(false);
  const [f, setF] = useState({ amount: String(invoice.total_amount ?? ''), reference: '', paidOn: today(), note: '', file: null });
  const fileRef = useRef(), camRef = useRef();

  useEffect(() => {
    paymentOptions().then(o => { setOpts(o); setTab(o.payhere ? 'online' : o.bank ? 'bank' : null); }).catch(e => { toast.error(e.message); setOpts({}); });
  }, []);

  const payOnline = async () => {
    setBusy(true);
    try { await startPayHere(invoice.id); }      // browser goes to PayHere
    catch (e) { toast.error(e.message); setBusy(false); }
  };
  const sendSlip = async () => {
    setBusy(true);
    try {
      await submitBankPayment({ clientId, invoiceId: invoice.id, amount: f.amount, reference: f.reference, paidOn: f.paidOn, file: f.file, note: f.note });
      toast.success('Thank you! We will confirm your payment shortly.');
      onSubmitted?.();
      onClose();
    } catch (e) { toast.error(e.message); }
    setBusy(false);
  };
  const copy = (t) => { navigator.clipboard?.writeText(t); toast.success('Copied'); };

  return (
    <div className="fixed inset-0 z-50 bg-black/50 backdrop-blur-sm flex items-end sm:items-center justify-center p-0 sm:p-4" onClick={onClose}>
      <div className="bg-white w-full sm:max-w-lg rounded-t-3xl sm:rounded-3xl shadow-2xl max-h-[92vh] overflow-y-auto" onClick={e => e.stopPropagation()}>
        <div className="relative bg-gradient-to-br from-primary-700 to-indigo-900 text-white px-5 pt-5 pb-6 rounded-t-3xl">
          <button onClick={onClose} className="absolute right-3 top-3 p-2 rounded-lg hover:bg-white/10"><X size={18} /></button>
          <div className="text-xs text-primary-200 font-semibold uppercase tracking-wider">Pay invoice {invoice.invoice_no}</div>
          <div className="text-4xl font-black mt-1 tabular-nums">{fmtRs(invoice.total_amount)}</div>
          <div className="text-xs text-primary-200 mt-1 flex items-center gap-1"><ShieldCheck size={12} /> Secure payment to TaxMate Solutions</div>
        </div>

        {!opts ? <div className="p-10 text-center text-gray-400"><Loader2 className="animate-spin mx-auto" /></div> : !tab ? (
          <div className="p-6 text-sm text-gray-600 text-center">Online payment is not available yet. Please use the bank details on the invoice.</div>
        ) : (
          <div className="p-5 space-y-4">
            {(opts.payhere && opts.bank) && (
              <div className="grid grid-cols-2 gap-2">
                {[['online', CreditCard, 'Card / eZ Cash', 'Pay now online'], ['bank', Landmark, 'Bank transfer', 'Upload the slip']].map(([k, Icon, t, s]) => (
                  <button key={k} onClick={() => setTab(k)}
                    className={`rounded-2xl border-2 p-3 text-left transition-all ${tab === k ? 'border-primary-600 bg-primary-50 shadow-sm' : 'border-gray-200 hover:border-primary-300'}`}>
                    <Icon size={20} className={tab === k ? 'text-primary-700' : 'text-gray-400'} />
                    <div className="font-bold text-sm text-gray-800 mt-1">{t}</div>
                    <div className="text-[11px] text-gray-500">{s}</div>
                  </button>
                ))}
              </div>
            )}

            {tab === 'online' && (
              <div className="space-y-3">
                <div className="rounded-2xl bg-gray-50 p-4 text-sm text-gray-600 space-y-2">
                  <div className="font-semibold text-gray-800">Pay with PayHere</div>
                  <p>Visa / Mastercard / Amex, eZ Cash, mCash, Genie or internet banking. You'll go to PayHere's secure page and come back here when it's done.</p>
                  <div className="flex flex-wrap gap-1.5">{['VISA', 'Mastercard', 'AMEX', 'eZ Cash', 'mCash', 'Genie'].map(m => <span key={m} className="text-[10px] font-bold bg-white border border-gray-200 rounded px-2 py-0.5 text-gray-600">{m}</span>)}</div>
                </div>
                <button onClick={payOnline} disabled={busy} className="w-full btn-primary justify-center py-3 text-base">
                  {busy ? <Loader2 size={18} className="animate-spin" /> : <CreditCard size={18} />} Pay {fmtRs(invoice.total_amount)} now
                </button>
                <p className="text-[11px] text-gray-400 text-center">Your invoice is marked paid automatically as soon as PayHere confirms.</p>
              </div>
            )}

            {tab === 'bank' && (
              <div className="space-y-3">
                {opts.accounts?.length > 0 && (
                  <div className="space-y-2">
                    <div className="text-xs font-semibold text-gray-500 uppercase tracking-wider">1 · Transfer to</div>
                    {opts.accounts.map((a, i) => (
                      <div key={i} className="rounded-2xl border border-gray-100 bg-gray-50 p-3 text-sm">
                        <div className="font-bold text-gray-800">{a.bank_name}{a.branch ? ` · ${a.branch}` : ''}</div>
                        <div className="text-gray-600">{a.account_name}</div>
                        <button onClick={() => copy(a.account_no)} className="mt-1 font-mono text-base font-bold text-primary-800 flex items-center gap-1.5 hover:text-primary-600">{a.account_no} <Copy size={13} /></button>
                      </div>
                    ))}
                    {opts.bank_note && <p className="text-xs text-gray-500">{opts.bank_note}</p>}
                    <p className="text-[11px] text-gray-400">Use <b>{invoice.invoice_no}</b> as the payment reference.</p>
                  </div>
                )}
                <div className="text-xs font-semibold text-gray-500 uppercase tracking-wider">2 · Send us the slip</div>
                <div className="grid grid-cols-2 gap-2">
                  <label className="text-xs font-semibold text-gray-600">Amount paid (Rs.)
                    <input className="input mt-1 text-right font-bold" inputMode="decimal" value={f.amount} onChange={e => setF({ ...f, amount: e.target.value.replace(/[^\d.]/g, '') })} />
                  </label>
                  <label className="text-xs font-semibold text-gray-600">Date paid
                    <input type="date" className="input mt-1" max={today()} value={f.paidOn} onChange={e => setF({ ...f, paidOn: e.target.value })} />
                  </label>
                </div>
                <input className="input" placeholder="Reference / transaction no. (optional)" maxLength={80} value={f.reference} onChange={e => setF({ ...f, reference: e.target.value })} />
                <div className={`rounded-2xl border-2 border-dashed p-4 text-center ${f.file ? 'border-emerald-300 bg-emerald-50' : 'border-gray-200'}`}>
                  {f.file ? (
                    <div className="text-sm text-emerald-800 flex items-center justify-center gap-2"><CheckCircle2 size={16} /> {f.file.name} <button onClick={() => setF({ ...f, file: null })} className="text-gray-400 hover:text-red-600"><X size={14} /></button></div>
                  ) : (
                    <div className="flex gap-2 justify-center flex-wrap">
                      <button type="button" onClick={() => camRef.current?.click()} className="btn-secondary text-sm"><Camera size={15} /> Take photo</button>
                      <button type="button" onClick={() => fileRef.current?.click()} className="btn-secondary text-sm"><Upload size={15} /> Choose file</button>
                    </div>
                  )}
                  <input ref={camRef} type="file" accept="image/*" capture="environment" className="hidden" onChange={e => { setF({ ...f, file: e.target.files?.[0] ?? null }); e.target.value = ''; }} />
                  <input ref={fileRef} type="file" accept="image/*,application/pdf" className="hidden" onChange={e => { setF({ ...f, file: e.target.files?.[0] ?? null }); e.target.value = ''; }} />
                </div>
                <input className="input" placeholder="Note (optional)" maxLength={500} value={f.note} onChange={e => setF({ ...f, note: e.target.value })} />
                <button onClick={sendSlip} disabled={busy || !f.file || !(parseFloat(f.amount) > 0)} className="w-full btn-primary justify-center py-3">
                  {busy ? <Loader2 size={17} className="animate-spin" /> : <Upload size={17} />} Send payment slip
                </button>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
