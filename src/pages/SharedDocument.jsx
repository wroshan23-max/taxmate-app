import { waNumber } from '../lib/share';
import { useEffect, useRef, useState } from 'react';
import { useParams } from 'react-router-dom';
import { supabase } from '../lib/supabase';
import { buildStatementHtml, openStatement, FIRM } from '../lib/iitStatement';
import { buildInvoiceHtml, openInvoice } from '../lib/invoice';
import { Printer, CheckCircle2, PencilLine, Loader2 } from 'lucide-react';

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
