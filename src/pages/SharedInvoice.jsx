// V64 — customer page /i/<token>: one invoice / note of a TaxMate VAT Invoice user (no login, link expires)
import { useEffect, useRef, useState } from 'react';
import { useParams } from 'react-router-dom';
import { Printer, Loader2, CreditCard, Lock } from 'lucide-react';
import { publicDoc } from '../lib/vat/api';
import { buildDocHtml } from '../lib/vat/printDoc';
import { rs, dmy, docTitle } from '../lib/vat/format';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const DOC_WIDTH = 820;

function Shell({ children, name }) {
  return (
    <div className="min-h-screen bg-gray-50">
      <header className="mb-4 bg-primary-700 px-4 py-3 text-white"><div className="mx-auto max-w-4xl text-lg font-black">{name || 'Invoice'}</div></header>
      <main className="px-3 pb-10">{children}</main>
    </div>
  );
}

export default function SharedInvoice() {
  const { token } = useParams();
  const [d, setD] = useState(null);
  const [state, setState] = useState('loading');
  const wrapRef = useRef(null), frameRef = useRef(null);
  const [scale, setScale] = useState(1);
  const [frameH, setFrameH] = useState(1100);
  useEffect(() => {
    if (!UUID_RE.test(token || '')) { setState('missing'); return; }
    publicDoc(token).then((r) => { if (r) { setD(r); setState('ok'); } else setState('missing'); }).catch(() => setState('missing'));
  }, [token]);
  useEffect(() => {
    const el = wrapRef.current; if (!el) return undefined;
    const ro = new ResizeObserver(() => setScale(Math.min(1, el.clientWidth / DOC_WIDTH))); ro.observe(el);
    return () => ro.disconnect();
  }, [state]);

  if (state === 'loading') return <Shell><div className="flex items-center justify-center py-24 text-gray-400"><Loader2 className="mr-2 animate-spin" size={18} /> Loading…</div></Shell>;
  if (state === 'missing') return <Shell><div className="card mx-auto max-w-lg p-10 text-center"><Lock className="mx-auto mb-2 text-gray-300" size={36} /><div className="mb-1 font-semibold text-gray-800">This link is not available</div><p className="text-sm text-gray-500">It may have expired or been switched off. Please ask the business that sent it for a new link.</p></div></Shell>;

  const doc = d.doc, b = d.brand || {};
  const name = doc.supplier?.trading_name || doc.supplier?.legal_name || b.brand_name;
  const html = buildDocHtml(d, {});
  const print = () => { const w = window.open('', '_blank'); if (!w) return; w.document.open(); w.document.write(buildDocHtml(d, { toolbar: true })); w.document.close(); w.focus(); };
  const isInv = doc.doc_type === 'tax' || doc.doc_type === 'nontax';
  const payable = isInv && doc.status === 'issued' && Number(doc.balance) > 0;
  return (
    <Shell name={name}>
      <div className="mx-auto max-w-4xl space-y-3">
        <div className="flex flex-wrap items-center gap-3">
          <div className="min-w-0 flex-1"><h1 className="text-lg font-bold text-primary-800">{docTitle(doc)} {doc.doc_no}</h1>
            <div className="text-sm text-gray-500">{dmy(doc.issue_date)} · {doc.customer?.name}</div></div>
          <button type="button" onClick={print} className="btn-primary"><Printer size={15} /> Download / Print PDF</button>
        </div>
        {isInv && doc.status === 'issued' && (
          <div className="card grid grid-cols-2 gap-2 p-3 text-sm sm:grid-cols-4">
            <div><div className="text-xs text-gray-500">Total</div><b>{rs(doc.total)}</b></div>
            {(Number(doc.credited) > 0 || Number(doc.debited) > 0) && <div><div className="text-xs text-gray-500">Adjusted</div><b>{rs(Number(doc.total) + Number(doc.debited) - Number(doc.credited))}</b></div>}
            <div><div className="text-xs text-gray-500">Paid</div><b>{rs(doc.paid)}</b></div>
            <div><div className="text-xs text-gray-500">Balance</div><b className={payable ? 'text-amber-700' : 'text-green-700'}>{rs(doc.balance)}</b>{doc.due_date && payable && <div className="text-xs text-gray-500">due {dmy(doc.due_date)}</div>}</div>
            {payable && b.online_pay_url && <a href={b.online_pay_url} target="_blank" rel="noopener noreferrer nofollow" className="btn-primary col-span-2 justify-center sm:col-span-4"><CreditCard size={16} /> PAY NOW</a>}
            {payable && (b.payment_instructions || b.bank_details) && <div className="col-span-2 whitespace-pre-line text-xs text-gray-600 sm:col-span-4">{b.payment_instructions}{b.bank_details ? `\n${b.bank_details}` : ''}</div>}
          </div>
        )}
        <div ref={wrapRef} className="card overflow-hidden" style={{ height: frameH * scale + 2 }}>
          <iframe ref={frameRef} title="Document" srcDoc={html}
            onLoad={() => { const h = frameRef.current?.contentDocument?.body?.scrollHeight; if (h) setFrameH(h + 30); }}
            style={{ width: DOC_WIDTH, height: frameH, border: 0, transform: `scale(${scale})`, transformOrigin: 'top left' }} />
        </div>
        <p className="text-center text-[11px] text-gray-400">Secure link · expires {dmy(d.expires_at)} · prepared with TaxMate Solutions</p>
      </div>
    </Shell>
  );
}
