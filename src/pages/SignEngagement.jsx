// V69 — public page /e/<token>: read and sign the engagement letter (no login)
import { useEffect, useRef, useState } from 'react';
import { useParams } from 'react-router-dom';
import { Loader2, Lock, CheckCircle2, Printer, PenLine, XCircle } from 'lucide-react';
import { supabase } from '../lib/supabase';
import { FIRM, waNumber } from '../lib/firm';
import { buildLetterHtml, openLetter } from '../lib/engagement';
import SignaturePad from '../components/SignaturePad';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function Shell({ children }) {
  return (
    <div className="min-h-screen bg-gray-50">
      <header className="mb-4 bg-primary-700 px-4 py-3 text-white"><div className="mx-auto max-w-4xl text-lg font-black">Tax<span className="text-gold-400">Mate</span> Solutions</div></header>
      <main className="px-3 pb-12">{children}</main>
    </div>
  );
}

export default function SignEngagement() {
  const { token } = useParams();
  const [l, setL] = useState(null);
  const [state, setState] = useState('loading');
  const [ok, setOk] = useState({});
  const [name, setName] = useState('');
  const [cap, setCap] = useState('');
  const [sig, setSig] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const [declining, setDeclining] = useState(false);
  const [reason, setReason] = useState('');
  const wrap = useRef(null), frame = useRef(null);
  const [h, setH] = useState(1200);

  const load = () => supabase.rpc('get_engagement', { p_token: token }).then(({ data, error }) => {
    if (error || !data) { setState('missing'); return; }
    setL(data); setState('ok'); setName((n) => n || data.client?.full_name || '');
  });
  useEffect(() => { if (!UUID_RE.test(token || '')) { setState('missing'); return; } load(); }, [token]); // eslint-disable-line react-hooks/exhaustive-deps
  // the letter is responsive: re-measure its height when the width changes (phone rotation)
  useEffect(() => {
    const el = wrap.current; if (!el) return undefined;
    let w = 0;
    const ro = new ResizeObserver(() => { if (el.clientWidth === w) return; w = el.clientWidth; const x = frame.current?.contentDocument?.body?.scrollHeight; if (x) setH((o) => (Math.abs(o - (x + 10)) > 2 ? x + 10 : o)); }); ro.observe(el);
    return () => ro.disconnect();
  }, [state]);

  if (state === 'loading') return <Shell><div className="flex justify-center py-24 text-gray-400"><Loader2 className="mr-2 animate-spin" /> Loading…</div></Shell>;
  if (state === 'missing') return (
    <Shell><div className="card mx-auto max-w-lg p-10 text-center"><Lock className="mx-auto mb-2 text-gray-300" size={36} /><div className="mb-1 font-semibold text-gray-800">This link is not available</div>
      <p className="text-sm text-gray-500">It may have been withdrawn or replaced. Please contact {FIRM.name} on WhatsApp <a className="text-primary-700 underline" href={`https://wa.me/${waNumber(FIRM.whatsapp)}`}>{FIRM.whatsapp}</a>.</p></div></Shell>
  );

  const consents = l.content?.consents || [];
  const missingReq = consents.filter((k) => k.required && !ok[k.key]);
  const sign = async () => {
    setErr('');
    if (name.trim().length < 2) { setErr('Please type your full name.'); return; }
    if (missingReq.length) { setErr('Please tick the required confirmations.'); return; }
    setBusy(true);
    const { error } = await supabase.rpc('sign_engagement', { p_token: token, p_name: name.trim(), p_capacity: cap.trim() || null, p_signature: sig || null, p_consents: ok, p_agent: navigator.userAgent.slice(0, 300) });
    setBusy(false);
    if (error) { setErr(error.message.replace(/^.*?ERROR:\s*/, '')); return; }
    await load(); window.scrollTo({ top: 0, behavior: 'smooth' });
  };
  const decline = async () => {
    setBusy(true);
    const { error } = await supabase.rpc('decline_engagement', { p_token: token, p_reason: reason });
    setBusy(false);
    if (error) { setErr(error.message.replace(/^.*?ERROR:\s*/, '')); return; }
    setDeclining(false); load();
  };
  const html = buildLetterHtml(l, { embed: true });

  return (
    <Shell>
      <div className="mx-auto max-w-4xl space-y-4">
        <div className="flex flex-wrap items-center gap-3">
          <div className="min-w-0 flex-1"><h1 className="text-lg font-bold text-primary-800">{l.title}</h1><div className="text-sm text-gray-500">{l.letter_no} · {l.client?.full_name}</div></div>
          <button type="button" onClick={() => openLetter(l)} className="btn-secondary border"><Printer size={15} /> Download / Print</button>
        </div>

        {l.status === 'signed' && <div className="rounded-xl border border-green-200 bg-green-50 p-4 text-sm text-green-800"><CheckCircle2 size={16} className="mr-1 inline" /> <b>Signed — thank you!</b> Signed by {l.signer_name} on {new Date(l.signed_at).toLocaleString('en-GB', { dateStyle: 'medium', timeStyle: 'short', timeZone: 'Asia/Colombo' })}. You can download a copy any time from this link. ස්තූතියි!</div>}
        {l.status === 'declined' && <div className="rounded-xl border border-gray-200 bg-white p-4 text-sm text-gray-700"><XCircle size={16} className="mr-1 inline text-gray-500" /> You declined this letter. {FIRM.name} will contact you. You can also WhatsApp us on {FIRM.whatsapp}.</div>}
        {l.status === 'sent' && l.expired && <div className="rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900">This letter has expired. Please ask {FIRM.name} for a new one.</div>}

        <div ref={wrap} className="card overflow-hidden">
          <iframe ref={frame} title="Engagement letter" srcDoc={html} onLoad={() => { const x = frame.current?.contentDocument?.body?.scrollHeight; if (x) setH((o) => (Math.abs(o - (x + 10)) > 2 ? x + 10 : o)); }}
            style={{ width: '100%', height: h, border: 0, display: 'block' }} />
        </div>

        {l.status === 'sent' && !l.expired && (
          <div className="card space-y-4 border-primary-200 p-4 sm:p-5">
            <div className="flex items-center gap-2 text-lg font-bold text-primary-800"><PenLine size={20} /> Sign this letter <span className="text-sm font-normal text-gray-500">· අත්සන් කරන්න</span></div>
            <div className="space-y-2">
              {consents.map((k) => (
                <label key={k.key} className="flex items-start gap-2.5 rounded-lg border bg-white p-3 text-sm">
                  <input type="checkbox" className="mt-0.5 h-4 w-4" checked={!!ok[k.key]} onChange={(e) => { setOk({ ...ok, [k.key]: e.target.checked }); setErr(''); }} />
                  <span>{k.text}{k.required ? <span className="text-red-600"> *</span> : <span className="text-xs text-gray-400"> (optional)</span>}</span>
                </label>
              ))}
            </div>
            <div className="grid gap-3 sm:grid-cols-2">
              <label className="block text-xs font-semibold text-gray-600">Your full name *<input className="input mt-1" maxLength={120} autoComplete="name" value={name} onChange={(e) => setName(e.target.value)} /></label>
              <label className="block text-xs font-semibold text-gray-600">Signing as (if not the client) <input className="input mt-1" maxLength={120} placeholder="e.g. Son, on behalf of my father" value={cap} onChange={(e) => setCap(e.target.value)} /></label>
            </div>
            <div>
              <div className="mb-1 text-xs font-semibold text-gray-600">Signature (optional — draw with your finger or mouse)</div>
              <div className="rounded-lg border bg-white"><SignaturePad value={sig} onChange={setSig} height={120} /></div>
            </div>
            {err && <div className="text-sm text-red-600">{err}</div>}
            <div className="flex flex-wrap items-center gap-2">
              <button type="button" disabled={busy} onClick={sign} className="btn-primary px-5 py-2.5 text-base">{busy ? <Loader2 size={17} className="animate-spin" /> : <CheckCircle2 size={17} />} I agree — sign</button>
              <button type="button" disabled={busy} onClick={() => setDeclining((d) => !d)} className="text-sm text-gray-500 underline">I don't agree</button>
            </div>
            {declining && (
              <div className="space-y-2 rounded-lg border bg-gray-50 p-3">
                <textarea className="input resize-none bg-white" rows={2} maxLength={500} placeholder="Tell us what you would like to change (optional)" value={reason} onChange={(e) => setReason(e.target.value)} />
                <button type="button" disabled={busy} onClick={decline} className="btn-secondary border text-sm">Send — I don't agree</button>
              </div>
            )}
            <p className="text-[11px] text-gray-400">By tapping “I agree — sign” you sign this letter electronically. The date and time are recorded.</p>
          </div>
        )}
        <p className="text-center text-xs text-gray-400">Shared securely by {FIRM.name} · {FIRM.phone} · {FIRM.email}</p>
      </div>
    </Shell>
  );
}
