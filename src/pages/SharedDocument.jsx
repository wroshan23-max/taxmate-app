import { waNumber } from '../lib/share';
import { useEffect, useRef, useState } from 'react';
import { useParams, useSearchParams } from 'react-router-dom';
import { supabase } from '../lib/supabase';
import { buildStatementHtml, openStatement, FIRM } from '../lib/iitStatement';
import { buildInvoiceHtml, openInvoice } from '../lib/invoice';
import { Printer, CheckCircle2, PencilLine, Loader2, CreditCard, ShieldCheck, XCircle, Clock } from 'lucide-react';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const DOC_WIDTH = 820;

// Public page behind /share/<token>: shows ONE statement or invoice; drafts can be confirmed by the client.
export default function SharedDocument() {
  const { token } = useParams();
  const [doc, setDoc]     = useState(null);
  const [state, setState] = useState('loading');   // loading | ok | missing
  const wrapRef = useRef(null);
  const frameRef = useRef(null);
  const [scale, setScale] = useState(1);
  const [frameH, setFrameH] = useState(1100);

  useEffect(() => {
    if (!UUID_RE.test(token || '')) { setState('missing'); return; }
    supabase.rpc('get_shared_document', { p_token: token }).then(({ data, error }) => {
      if (error || !data) setState('missing');
      else { setDoc(data); setState('ok'); }
    });
  }, [token]);

  // Fit the A4 document to phone screens
  useEffect(() => {
    const el = wrapRef.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setScale(Math.min(1, el.clientWidth / DOC_WIDTH)));
    ro.observe(el);
    return () => ro.disconnect();
  }, [state]);

  if (state === 'loading') return <Shell><div className="flex items-center justify-center py-24 text-gray-400"><Loader2 className="animate-spin mr-2" size={18} /> Loading document…</div></Shell>;
  if (state === 'missing') return (
    <Shell>
      <div className="card p-10 text-center max-w-lg mx-auto">
        <div className="text-4xl mb-3">🔒</div>
        <div className="font-semibold text-gray-800 mb-1">This link is not available</div>
        <p className="text-sm text-gray-500">It may have been turned off or replaced with a newer version. Please contact {FIRM.name} on WhatsApp <a className="text-primary-700 underline" href={`https://wa.me/${waNumber(FIRM.whatsapp)}`}>{FIRM.whatsapp}</a>.</p>
      </div>
    </Shell>
  );

  const isCalc = doc.kind === 'calc';
  const html = isCalc
    ? buildStatementHtml(doc.calc, doc.client, { withToolbar: false })
    : buildInvoiceHtml({ ...doc.invoice, clients: doc.clients }, doc.items ?? [], doc.bank ?? null).replace(/<div class="bar">[\s\S]*?<\/div>/, '');
  const download = () => (isCalc ? openStatement(doc.calc, doc.client) : openInvoice({ ...doc.invoice, clients: doc.clients }, doc.items ?? [], doc.bank ?? null));
  const title = isCalc
    ? `Income Tax Computation — Y/A ${doc.calc.year}${doc.calc.status === 'final' ? '' : ' (Draft for your review)'}`
    : `Invoice ${doc.invoice.invoice_no}`;

  return (
    <Shell>
      <div className="max-w-4xl mx-auto space-y-4">
        <div className="flex items-center gap-3 flex-wrap">
          <div>
            <h1 className="text-lg font-bold text-primary-800">{title}</h1>
            <div className="text-sm text-gray-500">{isCalc ? doc.client?.full_name : (doc.invoice.client_snapshot?.name || doc.clients?.full_name)}</div>
          </div>
          <button onClick={download} className="btn-primary ml-auto"><Printer size={15} /> Download / Print PDF</button>
        </div>

        {!isCalc && <PayPanel token={token} invoice={doc.invoice} onPaid={() => setDoc(d => ({ ...d, invoice: { ...d.invoice, status: 'paid' } }))} />}

        {isCalc && doc.calc.status !== 'final' && <ReviewPanel token={token} calc={doc.calc} onDone={(r) => setDoc(d => ({ ...d, calc: { ...d.calc, ...r } }))} />}

        <div ref={wrapRef} className="card overflow-hidden" style={{ height: frameH * scale + 2 }}>
          <iframe
            ref={frameRef}
            title={title}
            srcDoc={html}
            onLoad={() => { const h = frameRef.current?.contentDocument?.body?.scrollHeight; if (h) setFrameH(h + 30); }}
            style={{ width: DOC_WIDTH, height: frameH, border: 0, transform: `scale(${scale})`, transformOrigin: 'top left' }}
          />
        </div>
        <p className="text-center text-xs text-gray-400">Shared securely by {FIRM.name} · {FIRM.phone} · {FIRM.email}</p>
      </div>
    </Shell>
  );
}

// V67 — pay the invoice by card / eZ Cash / mCash / internet banking straight from the link (PayHere)
const rsAmt = (v) => `Rs. ${Number(v || 0).toLocaleString('en-LK', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
async function payCall(body) {
  const { data, error } = await supabase.functions.invoke('payhere', { body });
  if (error) throw new Error('Could not reach the payment service. Please try again.');
  if (data?.error) throw new Error(data.error);
  return data;
}
function PayPanel({ token, invoice, onPaid }) {
  const [sp] = useSearchParams();
  const order = sp.get('payment'), cancelled = sp.get('cancelled');
  const [info, setInfo] = useState(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const [tries, setTries] = useState(0);
  useEffect(() => {
    let stop = false, timer;
    const look = async (n) => {
      try {
        const i = await payCall({ action: 'link_info', token, order_id: order || undefined });
        if (stop) return;
        setInfo(i); setTries(n);
        if (i.payment?.status === 'paid' || i.status === 'paid') { onPaid(); return; }
        // just came back from PayHere: the confirmation can take a few seconds
        if (order && !cancelled && i.payment?.status === 'pending' && n < 12) timer = setTimeout(() => look(n + 1), 2500);
      } catch { if (!stop) setInfo({ online: false }); }
    };
    look(0);
    return () => { stop = true; clearTimeout(timer); };
  }, [token, order, cancelled]); // eslint-disable-line react-hooks/exhaustive-deps

  const pay = async () => {
    setBusy(true); setErr('');
    try {
      const d = await payCall({ action: 'checkout_link', token });
      const form = document.createElement('form');
      form.method = 'POST'; form.action = d.action_url;
      for (const [k, v] of Object.entries(d.fields)) { const i = document.createElement('input'); i.type = 'hidden'; i.name = k; i.value = v; form.appendChild(i); }
      document.body.appendChild(form); form.submit();
    } catch (e) { setErr(e.message); setBusy(false); }
  };

  if (!info) return null;
  const st = info.payment?.status;
  if (invoice.status === 'paid' || info.status === 'paid' || st === 'paid') return (
    <div className="rounded-xl border border-green-200 bg-green-50 p-4 text-sm text-green-800">
      <CheckCircle2 size={16} className="mr-1 inline" /> <b>Paid — thank you!</b>{st === 'paid' ? ` We received ${rsAmt(info.payment.amount)}${info.payment.card ? ` (${info.payment.card})` : ''}. Your receipt is the paid invoice above.` : ' This invoice is settled.'}
    </div>
  );
  if (!info.payable) return null;
  return (
    <div className="space-y-2">
      {order && cancelled && <div className="rounded-xl border border-gray-200 bg-white p-3 text-sm text-gray-700"><XCircle size={15} className="mr-1 inline text-gray-500" /> The payment was cancelled — nothing was charged. You can try again below.</div>}
      {order && !cancelled && st === 'pending' && (tries < 12
        ? <div className="rounded-xl border border-blue-200 bg-blue-50 p-3 text-sm text-blue-800"><Loader2 size={15} className="mr-1 inline animate-spin" /> Confirming your payment with the bank…</div>
        : <div className="rounded-xl border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900"><Clock size={15} className="mr-1 inline" /> Your payment is still being confirmed. If money was taken from your account, it will show as paid here shortly — no need to pay again.</div>)}
      {order && !cancelled && (st === 'failed' || st === 'cancelled') && <div className="rounded-xl border border-red-200 bg-red-50 p-3 text-sm text-red-800"><XCircle size={15} className="mr-1 inline" /> The payment did not go through. Please try again or use bank transfer.</div>}
      {info.online && !(order && !cancelled && st === 'pending') && (
        <div className="flex flex-wrap items-center gap-3 rounded-xl border border-primary-200 bg-white p-4">
          <div className="min-w-0 flex-1">
            <div className="text-xs text-gray-500">Amount due</div>
            <div className="text-xl font-black text-primary-800">{rsAmt(info.amount)}</div>
            <div className="mt-0.5 flex items-center gap-1 text-[11px] text-gray-500"><ShieldCheck size={12} className="text-green-600" /> Secure payment by PayHere — Visa, Mastercard, AMEX, eZ Cash, mCash, internet banking{info.sandbox ? ' · TEST MODE' : ''}</div>
          </div>
          <button type="button" onClick={pay} disabled={busy} className="btn-primary px-5 py-2.5 text-base">{busy ? <Loader2 size={17} className="animate-spin" /> : <CreditCard size={17} />} Pay now</button>
          {err && <div className="w-full text-sm text-red-600">{err}</div>}
        </div>
      )}
    </div>
  );
}

function ReviewPanel({ token, calc, onDone }) {
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr]   = useState('');

  const respond = async (decision) => {
    if (decision === 'changes_requested' && !note.trim()) { setErr('Please tell us what should change.'); return; }
    setBusy(true); setErr('');
    const { data, error } = await supabase.rpc('respond_shared_calc', { p_token: token, p_decision: decision, p_note: note });
    setBusy(false);
    if (error) { setErr('Could not send your response — please try again or contact us on WhatsApp.'); return; }
    onDone({ ...data, client_responded_at: new Date().toISOString() });
    setNote('');
  };

  if (calc.client_status) {
    return (
      <div className={`rounded-xl border p-4 text-sm ${calc.client_status === 'approved' ? 'bg-green-50 border-green-200 text-green-800' : 'bg-amber-50 border-amber-200 text-amber-800'}`}>
        {calc.client_status === 'approved'
          ? <><CheckCircle2 size={16} className="inline mr-1" /> Thank you — you confirmed these figures. We will prepare and file the final return.</>
          : <><PencilLine size={16} className="inline mr-1" /> Thank you — we received your change request{calc.client_note ? `: “${calc.client_note}”` : ''}. We will send an updated version.</>}
        <button onClick={() => onDone({ client_status: null })} className="block mt-2 text-xs underline opacity-80">Change my response</button>
      </div>
    );
  }

  return (
    <div className="rounded-xl border border-primary-200 bg-primary-50 p-4 space-y-3">
      <div className="text-sm text-primary-900">
        <strong>Please review this draft.</strong> If the income and figures are correct, tap <strong>Confirm</strong>. If something is missing or wrong, tell us below and tap <strong>Request changes</strong>.
      </div>
      <textarea className="input resize-none bg-white" rows={2} maxLength={2000} placeholder="Note to TaxMate (optional for Confirm)…" value={note} onChange={e => setNote(e.target.value)} />
      {err && <div className="text-xs text-red-600">{err}</div>}
      <div className="flex gap-2 flex-wrap">
        <button disabled={busy} onClick={() => respond('approved')} className="btn-primary bg-green-600 hover:bg-green-700"><CheckCircle2 size={15} /> Confirm — figures are correct</button>
        <button disabled={busy} onClick={() => respond('changes_requested')} className="btn-secondary"><PencilLine size={15} /> Request changes</button>
      </div>
    </div>
  );
}

function Shell({ children }) {
  return (
    <div className="min-h-screen bg-gray-50">
      <header className="bg-primary-700 text-white px-4 py-3 mb-4">
        <div className="max-w-4xl mx-auto font-black text-lg">Tax<span className="text-gold-400">Mate</span> Solutions</div>
      </header>
      <main className="px-3 pb-10">{children}</main>
    </div>
  );
}
