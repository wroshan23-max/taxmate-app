// V61 — Public page /d/<token>: client documents behind a password (no login)
import { useState } from 'react';
import { useParams } from 'react-router-dom';
import { Lock, Download, Loader2, FileText, FileImage, FileSpreadsheet, File as FileIcon, ShieldCheck, Eye, EyeOff, AlertTriangle } from 'lucide-react';
import { FIRM, waNumber } from '../lib/firm';
import { openShare, downloadShared } from '../lib/docShares';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const fmtBytes = (b = 0) => (b < 1024 ? `${b} B` : b < 1048576 ? `${Math.round(b / 1024)} KB` : `${(b / 1048576).toFixed(1)} MB`);
const iconOf = (m = '') => (/^image\//.test(m) ? FileImage : /pdf/.test(m) ? FileText : /sheet|excel|csv/.test(m) ? FileSpreadsheet : FileIcon);

function Shell({ children }) {
  return (
    <div className="min-h-screen bg-gray-50">
      <header className="bg-primary-700 text-white px-4 py-3 mb-6">
        <div className="max-w-2xl mx-auto font-black text-lg">Tax<span className="text-gold-400">Mate</span> Solutions</div>
      </header>
      <main className="px-3 pb-10 max-w-2xl mx-auto">{children}</main>
      <footer className="text-center text-[11px] text-gray-400 pb-6">{FIRM.name}{FIRM.whatsapp ? <> · WhatsApp <a className="underline" href={`https://wa.me/${waNumber(FIRM.whatsapp)}`}>{FIRM.whatsapp}</a></> : null}</footer>
    </div>
  );
}

export default function SharedFiles() {
  const { token } = useParams();
  const valid = UUID_RE.test(token || '');
  const [pw, setPw] = useState('');
  const [show, setShow] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState(null);       // { msg, hard }
  const [data, setData] = useState(null);     // { title, client, expires_at, files }
  const [dl, setDl] = useState(null);         // doc id being prepared

  const unlock = async (e) => {
    e.preventDefault();
    if (!pw.trim()) return;
    setBusy(true); setErr(null);
    try { setData(await openShare(token, pw.trim())); }
    catch (x) { setErr({ msg: x.message + (x.triesLeft > 0 && x.triesLeft < 4 ? ` ${x.triesLeft} tr${x.triesLeft > 1 ? 'ies' : 'y'} left.` : ''), hard: x.expired || /not available/i.test(x.message) }); }
    setBusy(false);
  };
  const download = async (f) => {
    setDl(f.id); setErr(null);
    try {
      const r = await downloadShared(token, pw.trim(), f.id);
      const a = document.createElement('a'); a.href = r.url; a.rel = 'noopener'; if (r.name) a.download = r.name;
      document.body.appendChild(a); a.click(); a.remove();
    } catch (x) { setErr({ msg: x.message, hard: x.expired }); }
    setDl(null);
  };

  if (!valid || err?.hard) return (
    <Shell>
      <div className="card p-10 text-center">
        <div className="text-4xl mb-3">🔒</div>
        <div className="font-semibold text-gray-800 mb-1">{err?.msg || 'This link is not available'}</div>
        <p className="text-sm text-gray-500">Please contact {FIRM.name}{FIRM.whatsapp ? <> on WhatsApp <a className="text-primary-700 underline" href={`https://wa.me/${waNumber(FIRM.whatsapp)}`}>{FIRM.whatsapp}</a></> : ''} for a new link.</p>
      </div>
    </Shell>
  );

  if (!data) return (
    <Shell>
      <form onSubmit={unlock} className="card p-6 sm:p-8 max-w-md mx-auto space-y-4">
        <div className="w-14 h-14 rounded-2xl bg-primary-50 text-primary-700 flex items-center justify-center mx-auto"><Lock size={26} /></div>
        <div className="text-center">
          <h1 className="text-lg font-bold text-primary-800">Documents from {FIRM.name}</h1>
          <p className="text-sm text-gray-500">Enter the password we sent you · ඔබට එවූ password එක ඇතුළත් කරන්න</p>
        </div>
        <div className="relative">
          <input autoFocus type={show ? 'text' : 'password'} autoComplete="off" autoCapitalize="characters" spellCheck={false}
            className="input text-center text-lg tracking-widest font-mono pr-10" placeholder="Password" maxLength={64} value={pw} onChange={e => setPw(e.target.value)} />
          <button type="button" onClick={() => setShow(v => !v)} className="absolute right-2 top-1/2 -translate-y-1/2 p-1 text-gray-400 hover:text-gray-600" aria-label={show ? 'Hide password' : 'Show password'}>{show ? <EyeOff size={16} /> : <Eye size={16} />}</button>
        </div>
        {err && <div className="text-sm text-red-600 flex items-start gap-1.5"><AlertTriangle size={15} className="flex-shrink-0 mt-0.5" /> {err.msg}</div>}
        <button type="submit" disabled={busy || !pw.trim()} className="btn-primary w-full justify-center">{busy ? <Loader2 size={16} className="animate-spin" /> : <ShieldCheck size={16} />} Open documents</button>
        <p className="text-[11px] text-gray-400 text-center">The password is case-sensitive. After 5 wrong tries the link is locked for 15 minutes.</p>
      </form>
    </Shell>
  );

  return (
    <Shell>
      <div className="space-y-4">
        <div>
          <h1 className="text-lg font-bold text-primary-800">{data.title || 'Your documents'}</h1>
          <p className="text-sm text-gray-500">{data.client ? `For ${data.client} · ` : ''}{data.files.length} file{data.files.length === 1 ? '' : 's'}{data.expires_at ? ` · link works until ${new Date(data.expires_at).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })}` : ''}</p>
        </div>
        {err && <div className="card p-3 text-sm text-red-600 flex items-start gap-1.5"><AlertTriangle size={15} className="flex-shrink-0 mt-0.5" /> {err.msg}</div>}
        {data.files.length === 0 ? <div className="card p-8 text-center text-sm text-gray-500">These files are no longer available. Please contact {FIRM.name}.</div> : (
          <div className="space-y-2">
            {data.files.map(f => {
              const Icon = iconOf(f.mime);
              return (
                <div key={f.id} className="card p-3 flex items-center gap-3">
                  <div className="w-11 h-11 rounded-xl bg-primary-50 text-primary-700 flex items-center justify-center flex-shrink-0"><Icon size={20} /></div>
                  <div className="flex-1 min-w-0">
                    <div className="text-sm font-semibold text-gray-800 truncate">{f.title}</div>
                    <div className="text-[11px] text-gray-400">{f.year ? `Y/A ${f.year} · ` : ''}{fmtBytes(f.size)}</div>
                  </div>
                  <button onClick={() => download(f)} disabled={dl === f.id} className="btn-primary text-sm py-1.5">{dl === f.id ? <Loader2 size={14} className="animate-spin" /> : <Download size={14} />} Download</button>
                </div>
              );
            })}
          </div>
        )}
        <p className="text-[11px] text-gray-400 text-center">🔒 Shared securely by {FIRM.name}. Please keep these documents private.</p>
      </div>
    </Shell>
  );
}
