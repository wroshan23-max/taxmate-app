// V64 — VAT Invoice subscription: status, plan, monthly / annual request
import { useState } from 'react';
import toast from 'react-hot-toast';
import { Crown, Check, Loader2, FileText, Landmark, Wallet, Bell, BarChart3 } from 'lucide-react';
import { requestAddon } from '../../lib/vat/api';
import { rs, dmy, SUBSCRIPTION } from '../../lib/vat/format';
import { t } from '../../lib/vat/i18n';
import { Badge } from './ui';

export default function Subscription({ app, intro }) {
  const { ctx, reloadCtx, can } = app;
  const cat = ctx.catalog || {};
  const a = ctx.addon;
  const [cycle, setCycle] = useState('monthly');
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const lim = cat.limits || {};
  const ask = async () => {
    setBusy(true);
    try { await requestAddon(cycle, note); toast.success('Request sent — TaxMate will switch it on and send the invoice.'); reloadCtx(); } catch (e) { toast.error(e.message); } finally { setBusy(false); }
  };
  const canAsk = ctx.role === 'owner' && can('subscription') !== false && !['trial', 'active', 'past_due', 'paused', 'suspended'].includes(ctx.status);
  const priced = Number(cat.price) > 0 || Number(cat.annual_price) > 0;
  return (
    <div className="space-y-3">
      {intro && (
        <div className="card p-6">
          <div className="flex items-center gap-2 text-lg font-bold text-primary-800"><Crown size={20} /> {t('app.title')} — add-on</div>
          <p className="mt-1 max-w-2xl text-sm text-gray-600">{cat.tagline || 'IRD-format tax invoices, credit / debit notes, payments, reminders and RAMIS submission.'}</p>
          <div className="mt-3 grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
            {[[FileText, 'Tax Invoice in the IRD format', 'YYMMM_QQQQ_XXXXX numbering, all mandatory fields, 5 templates, PDF'], [FileText, 'Credit & Debit Notes', 'Corrections linked to the original invoice — issued invoices are never edited'],
              [Landmark, 'RAMIS Web API ready', 'Validation, queue, retry and lock — connected when IRD provides the API'], [Wallet, 'Payments & customer ledger', 'Part payments, receipts, statements, aging'],
              [Bell, 'Share & reminders', 'Secure link by WhatsApp / email, automatic email reminders'], [BarChart3, 'VAT & sales reports', 'Schedule 01 / 02 / 04 / 07, VAT by rate and customer, Excel / PDF']]
              .map(([I, h, d]) => <div key={h} className="rounded-xl border p-3"><div className="flex items-center gap-1.5 text-sm font-semibold"><I size={15} className="text-primary-700" /> {h}</div><div className="text-xs text-gray-500">{d}</div></div>)}
          </div>
        </div>
      )}
      <div className="card space-y-3 p-4">
        <div className="flex flex-wrap items-center gap-2"><div className="font-bold text-primary-800">Subscription</div><Badge meta={SUBSCRIPTION[ctx.status]} /></div>
        {a && (
          <div className="grid gap-1 text-sm sm:grid-cols-2">
            <div>Plan: <b>{a.cycle === 'annual' ? 'Annual' : 'Monthly'}</b> · {rs(a.price)} per {a.cycle === 'annual' ? 'year' : 'month'}</div>
            {a.trial_ends && ctx.status === 'trial' && <div>Trial until <b>{dmy(a.trial_ends)}</b></div>}
            {a.next_bill_date && <div>Next invoice: <b>{dmy(a.next_bill_date)}</b></div>}
            {a.start_date && <div>Since {dmy(a.start_date)}</div>}
          </div>
        )}
        {ctx.status === 'past_due' && <div className="rounded-lg bg-orange-50 p-2 text-sm text-orange-900">The subscription invoice is overdue — pay it in <b>Invoices</b> to avoid suspension.</div>}
        {['expired', 'suspended', 'cancelled'].includes(ctx.status) && <div className="rounded-lg bg-red-50 p-2 text-sm text-red-900">Creating and changing documents is off. All your invoices, notes, payments and reports stay available to view, print and export.</div>}
        <div className="grid gap-2 text-xs text-gray-600 sm:grid-cols-3">
          <div>Invoices per month: <b>{lim.invoices_per_month ? lim.invoices_per_month : 'unlimited'}</b></div>
          <div>Customers: <b>{lim.customers ? lim.customers : 'unlimited'}</b></div>
          <div>Users: <b>{lim.users ? lim.users : 'unlimited'}</b></div>
          <div>RAMIS Web API: <b>{lim.ramis === false ? 'no' : 'yes'}</b></div>
          <div>Automatic reminders: <b>{lim.auto_reminders === false ? 'no' : 'yes'}</b></div>
          <div>This month issued: <b>{ctx.month_issued}</b></div>
        </div>
        {canAsk && (ctx.requested ? <div className="rounded-lg bg-sky-50 p-2 text-sm text-sky-900">Your request is with TaxMate. We will switch it on and send the invoice.</div> : (
          <div className="space-y-2 rounded-xl border p-3">
            {!priced && !cat.active ? <div className="text-sm text-gray-600">Ask TaxMate on WhatsApp to start VAT Invoice for your business.</div> : (
              <>
                <div className="grid gap-2 sm:grid-cols-2">
                  {[['monthly', 'Monthly', cat.price, 'per month'], ['annual', 'Annual', cat.annual_price, 'per year']].map(([k, l, p, per]) => (
                    <button key={k} type="button" onClick={() => setCycle(k)} className={`rounded-xl border-2 p-3 text-left ${cycle === k ? 'border-primary-600 bg-primary-50' : 'border-gray-200'}`}>
                      <div className="flex items-center gap-1 font-semibold">{cycle === k && <Check size={14} className="text-primary-700" />} {l}</div>
                      <div className="text-lg font-black text-primary-800">{Number(p) > 0 ? rs(p) : 'Ask TaxMate'}</div><div className="text-xs text-gray-500">{per}</div>
                    </button>
                  ))}
                </div>
                <input className="input" maxLength={500} placeholder="Note for TaxMate (optional)" value={note} onChange={(e) => setNote(e.target.value)} />
                <button type="button" disabled={busy} className="btn-primary text-sm" onClick={ask}>{busy ? <Loader2 size={14} className="animate-spin" /> : <Crown size={14} />} Request VAT Invoice ({cycle})</button>
              </>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}
