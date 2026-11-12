// V63 — Public page /notice/<token>: one APIT / instalment payment notice (no login)
import { useEffect, useRef, useState } from 'react';
import { useParams } from 'react-router-dom';
import { Printer, Loader2 } from 'lucide-react';
import { FIRM, waNumber } from '../lib/firm';
import { sharedNotice, buildTaxNoticeHtml } from '../lib/taxNotice';
import { periodLabel } from '../lib/taxPayments';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const DOC_WIDTH = 820;

function Shell({ children }) {
  return (
    <div className="min-h-screen bg-gray-50">
      <header className="bg-primary-700 text-white px-4 py-3 mb-4"><div className="max-w-4xl mx-auto font-black text-lg">Tax<span className="text-gold-400">Mate</span> Solutions</div></header>
      <main className="px-3 pb-10">{children}</main>
    </div>
  );
}

export default function SharedTaxNotice() {
  const { token } = useParams();
  const [d, setD] = useState(null);
  const [state, setState] = useState('loading');
  const wrapRef = useRef(null), frameRef = useRef(null);
  const [scale, setScale] = useState(1);
  const [frameH, setFrameH] = useState(1100);

  useEffect(() => {
    if (!UUID_RE.test(token || '')) { setState('missing'); return; }
    sharedNotice(token).then(r => { if (r) { setD(r); setState('ok'); } else setState('missing'); });
  }, [token]);
  useEffect(() => {
    const el = wrapRef.current; if (!el) return undefined;
    const ro = new ResizeObserver(() => setScale(Math.min(1, el.clientWidth / DOC_WIDTH))); ro.observe(el);
    return () => ro.disconnect();
  }, [state]);

  if (state === 'loading') return <Shell><div className="flex items-center justify-center py-24 text-gray-400"><Loader2 className="animate-spin mr-2" size={18} /> Loading notice…</div></Shell>;
  if (state === 'missing') return (
    <Shell><div className="card p-10 text-center max-w-lg mx-auto">
      <div className="text-4xl mb-3">🔒</div><div className="font-semibold text-gray-800 mb-1">This link is not available</div>
      <p className="text-sm text-gray-500">It may have been turned off. Please contact {FIRM.name} on WhatsApp <a className="text-primary-700 underline" href={`https://wa.me/${waNumber(FIRM.whatsapp)}`}>{FIRM.whatsapp}</a>.</p>
    </div></Shell>
  );
  const html = buildTaxNoticeHtml(d.payment, d.client, { withToolbar: false });
  const print = () => { const w = window.open('', '_blank'); if (!w) return; w.document.open(); w.document.write(buildTaxNoticeHtml(d.payment, d.client)); w.document.close(); w.focus(); };
  return (
    <Shell>
      <div className="max-w-4xl mx-auto space-y-4">
        <div className="flex items-center gap-3 flex-wrap">
          <div><h1 className="text-lg font-bold text-primary-800">Payment notice — {periodLabel(d.payment)}</h1>
            <div className="text-sm text-gray-500">{d.client?.full_name} · Y/A {d.payment.year}</div></div>
          <button onClick={print} className="btn-primary ml-auto"><Printer size={15} /> Download / Print PDF</button>
        </div>
        <div ref={wrapRef} className="card overflow-hidden" style={{ height: frameH * scale + 2 }}>
          <iframe ref={frameRef} title="Payment notice" srcDoc={html}
            onLoad={() => { const h = frameRef.current?.contentDocument?.body?.scrollHeight; if (h) setFrameH(h + 30); }}
            style={{ width: DOC_WIDTH, height: frameH, border: 0, transform: `scale(${scale})`, transformOrigin: 'top left' }} />
        </div>
      </div>
    </Shell>
  );
}
