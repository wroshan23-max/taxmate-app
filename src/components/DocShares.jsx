// V61 — Admin: share a client's documents with a link + password; list / manage the links
import { useEffect, useState } from 'react';
import toast from 'react-hot-toast';
import { Link2, KeyRound, RefreshCw, Copy, X, Loader2, Lock, Power, Trash2, ShieldCheck, Eye } from 'lucide-react';
import MessageMenu from './MessageMenu';
import { recipientsOf } from '../lib/contacts';
import { fmtDate } from '../lib/supabase';
import {
  genPassword, EXPIRY, createShare, listShares, newSharePassword, updateShare, shareState, shareFilesUrl, linkMessage, passwordMessage,
} from '../lib/docShares';

const copy = (text, what) => navigator.clipboard?.writeText(text).then(() => toast.success(`${what} copied`)).catch(() => toast.error('Could not copy'));

/** Shows the link + password once, with "send" buttons for each */
function Reveal({ client, url, password, count, expiresAt, onDone }) {
  return (
    <div className="space-y-3">
      <div className="rounded-xl bg-emerald-50 border border-emerald-200 p-3 text-sm text-emerald-900 flex items-start gap-2">
        <ShieldCheck size={18} className="text-emerald-600 flex-shrink-0 mt-0.5" />
        <span>Ready. Send the <b>link</b> and the <b>password</b> as two separate messages. The password is shown only now — if it is lost, make a new one.</span>
      </div>
      <div>
        <div className="text-xs font-semibold text-gray-500 mb-1">1 · Link</div>
        <div className="flex items-center gap-2">
          <input readOnly className="input text-sm font-mono flex-1" value={url} onFocus={e => e.target.select()} />
          <button type="button" onClick={() => copy(url, 'Link')} className="btn-secondary text-sm py-2" title="Copy link"><Copy size={14} /></button>
        </div>
        <div className="mt-2 flex gap-2 flex-wrap">
          <MessageMenu label="Send link" phone={client?.mobile} email={client?.email} recipients={recipientsOf(client)}
            subject={`Documents from TaxMate`} getText={async () => linkMessage(client, url, count, expiresAt)} />
          <button type="button" onClick={() => copy(linkMessage(client, url, count, expiresAt), 'Message')} className="btn-secondary text-xs py-1.5"><Copy size={12} /> Copy message</button>
        </div>
      </div>
      <div>
        <div className="text-xs font-semibold text-gray-500 mb-1">2 · Password</div>
        <div className="flex items-center gap-2">
          <div className="flex-1 rounded-lg border-2 border-dashed border-primary-200 bg-primary-50 px-3 py-2 text-xl font-black tracking-widest font-mono text-primary-800 text-center select-all">{password}</div>
          <button type="button" onClick={() => copy(password, 'Password')} className="btn-secondary text-sm py-2" title="Copy password"><Copy size={14} /></button>
        </div>
        <div className="mt-2 flex gap-2 flex-wrap items-center">
          <MessageMenu label="Send password" phone={client?.mobile} email={client?.email} recipients={recipientsOf(client)}
            subject="Password for your TaxMate documents" getText={async () => passwordMessage(client, password)} />
          <span className="text-[11px] text-gray-500">Tip: send it a minute later, or by SMS / phone call.</span>
        </div>
      </div>
      <div className="flex justify-end"><button type="button" onClick={onDone} className="btn-primary text-sm">Done</button></div>
    </div>
  );
}

/** Pick title / expiry / password → create the link */
export function ShareDocsDialog({ client, docs, onClose, onCreated }) {
  const years = [...new Set(docs.map(d => d.year).filter(Boolean))];
  const [title, setTitle] = useState(docs.length === 1 ? docs[0].title : `Documents${years.length === 1 ? ` — Y/A ${years[0]}` : ''}`);
  const [days, setDays] = useState(7);
  const [password, setPassword] = useState(genPassword);
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(null);
  const create = async () => {
    if (password.trim().length < 6) return toast.error('The password must be at least 6 characters');
    setBusy(true);
    try {
      const r = await createShare({ clientId: client.id, docIds: docs.map(d => d.id), password: password.trim(), days, title: title.trim() });
      setDone({ url: shareFilesUrl(r.token), password: password.trim(), expiresAt: r.expires_at });
      onCreated?.();
    } catch (e) { toast.error(e.message); }
    setBusy(false);
  };
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50" onClick={onClose}>
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-lg max-h-[92vh] overflow-y-auto" onClick={e => e.stopPropagation()}>
        <div className="flex items-center justify-between p-4 border-b">
          <h3 className="font-bold text-primary-800 flex items-center gap-2"><Lock size={17} /> Share with a password</h3>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600"><X size={20} /></button>
        </div>
        <div className="p-4">
          {done ? <Reveal client={client} url={done.url} password={done.password} count={docs.length} expiresAt={done.expiresAt} onDone={onClose} /> : (
            <div className="space-y-3">
              <div className="rounded-xl bg-gray-50 p-2.5 max-h-36 overflow-y-auto">
                <div className="text-xs font-semibold text-gray-500 mb-1">{docs.length} file{docs.length > 1 ? 's' : ''} for {client?.full_name}</div>
                {docs.map(d => <div key={d.id} className="text-sm text-gray-700 truncate">📄 {d.title}{d.year ? <span className="text-gray-400"> · Y/A {d.year}</span> : ''}</div>)}
              </div>
              <label className="block text-xs font-semibold text-gray-500">Name shown on the page
                <input className="input mt-1" maxLength={120} value={title} onChange={e => setTitle(e.target.value)} /></label>
              <label className="block text-xs font-semibold text-gray-500">Link works for
                <select className="input mt-1" value={days} onChange={e => setDays(Number(e.target.value))}>
                  {EXPIRY.map(([d, l]) => <option key={d} value={d}>{l}</option>)}
                </select></label>
              <div>
                <div className="text-xs font-semibold text-gray-500 mb-1">Password</div>
                <div className="flex gap-2">
                  <input className="input font-mono text-lg tracking-widest text-center" maxLength={64} value={password} onChange={e => setPassword(e.target.value)} />
                  <button type="button" onClick={() => setPassword(genPassword())} className="btn-secondary text-sm whitespace-nowrap" title="Make a new random password"><RefreshCw size={14} /> Generate</button>
                </div>
                <div className="text-[11px] text-gray-400 mt-1">At least 6 characters. Only a scrambled copy (hash) is saved; 5 wrong tries lock the link for 15 minutes.</div>
              </div>
              <div className="flex justify-end gap-2 pt-1">
                <button type="button" onClick={onClose} className="btn-secondary text-sm">Cancel</button>
                <button type="button" onClick={create} disabled={busy} className="btn-primary text-sm">{busy ? <Loader2 size={14} className="animate-spin" /> : <Link2 size={14} />} Create link</button>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

/** The client's share links: state, opens, copy link, new password, expiry, on/off, delete */
export function DocShareLinks({ client, docs, refreshKey }) {
  const [rows, setRows] = useState(null);
  const [reveal, setReveal] = useState(null);   // { url, password, count, expiresAt }
  const [busy, setBusy] = useState(null);
  const load = () => listShares(client.id).then(setRows).catch(() => setRows([]));
  useEffect(() => { load(); }, [client.id, refreshKey]); // eslint-disable-line react-hooks/exhaustive-deps
  if (!rows?.length) return null;
  const titleOf = Object.fromEntries((docs ?? []).map(d => [d.id, d.title]));
  const run = async (s, fn, ok) => { setBusy(s.id); try { await fn(); if (ok) toast.success(ok); await load(); } catch (e) { toast.error(e.message); } setBusy(null); };
  const newPw = (s) => {
    if (!window.confirm('Make a new password? The old password stops working.')) return;
    const pw = genPassword();
    run(s, async () => { await newSharePassword(s.id, pw); setReveal({ url: shareFilesUrl(s.token), password: pw, count: s.doc_ids.length, expiresAt: s.expires_at }); });
  };
  const BADGE = { active: 'bg-green-100 text-green-700', expired: 'bg-gray-100 text-gray-600', off: 'bg-red-100 text-red-700' };
  const LABEL = { active: 'Active', expired: 'Expired', off: 'Switched off' };

  return (
    <div className="card">
      <div className="card-header"><Link2 size={16} /> Password share links <span className="font-normal text-xs text-gray-400">· {rows.length}</span></div>
      <div className="divide-y divide-gray-50">
        {rows.map(s => {
          const st = shareState(s);
          const names = s.doc_ids.map(id => titleOf[id]).filter(Boolean);
          return (
            <div key={s.id} className="px-4 py-3 flex items-start gap-3 flex-wrap">
              <div className="flex-1 min-w-[220px]">
                <div className="text-sm font-semibold text-gray-800 flex items-center gap-2 flex-wrap">{s.title || 'Documents'}
                  <span className={`text-[10px] font-bold px-1.5 py-0.5 rounded ${BADGE[st]}`}>{LABEL[st]}</span>
                  {s.locked_until && new Date(s.locked_until) > new Date() && <span className="text-[10px] font-bold px-1.5 py-0.5 rounded bg-amber-100 text-amber-800">🔒 locked (wrong passwords)</span>}</div>
                <div className="text-[11px] text-gray-500 truncate" title={names.join(', ')}>{s.doc_ids.length} file{s.doc_ids.length > 1 ? 's' : ''}{names.length ? ` — ${names.slice(0, 3).join(', ')}${names.length > 3 ? '…' : ''}` : ''}{names.length < s.doc_ids.length ? ` (${s.doc_ids.length - names.length} deleted)` : ''}</div>
                <div className="text-[11px] text-gray-400">Made {fmtDate(s.created_at)} · {s.expires_at ? `${st === 'expired' ? 'expired' : 'until'} ${fmtDate(s.expires_at)}` : 'no expiry'} · <Eye size={10} className="inline -mt-0.5" /> opened {s.open_count}× · {s.download_count} download{s.download_count === 1 ? '' : 's'}{s.last_opened_at ? ` · last ${fmtDate(s.last_opened_at)}` : ''}</div>
              </div>
              <div className="flex items-center gap-1 flex-wrap">
                {busy === s.id && <Loader2 size={14} className="animate-spin text-gray-400" />}
                <button type="button" onClick={() => copy(shareFilesUrl(s.token), 'Link')} className="btn-secondary text-xs py-1 px-2"><Copy size={12} /> Link</button>
                <button type="button" onClick={() => newPw(s)} disabled={busy === s.id} className="btn-secondary text-xs py-1 px-2" title="New password (the old one stops working)"><KeyRound size={12} /> New password</button>
                <select value="" onChange={e => { const d = Number(e.target.value); run(s, () => updateShare(s.id, 'expiry', d), d ? `Link works for ${d} more day${d > 1 ? 's' : ''}` : 'No expiry'); }}
                  className="input w-auto text-xs py-1 px-2" title="Change how long the link works" disabled={busy === s.id}>
                  <option value="" disabled>Extend…</option>
                  {EXPIRY.map(([d, l]) => <option key={d} value={d}>{d ? `${l} from now` : l}</option>)}
                </select>
                {st === 'off'
                  ? <button type="button" onClick={() => run(s, () => updateShare(s.id, 'restore'), 'Link switched on')} className="btn-secondary text-xs py-1 px-2 text-green-700"><Power size={12} /> Turn on</button>
                  : <button type="button" onClick={() => run(s, () => updateShare(s.id, 'revoke'), 'Link switched off')} className="btn-secondary text-xs py-1 px-2 text-amber-700"><Power size={12} /> Turn off</button>}
                <button type="button" onClick={() => { if (window.confirm('Delete this link? It stops working for good.')) run(s, () => updateShare(s.id, 'delete'), 'Link deleted'); }} className="p-1 text-gray-300 hover:text-red-600" title="Delete"><Trash2 size={14} /></button>
              </div>
            </div>
          );
        })}
      </div>
      <p className="px-4 pb-3 text-[11px] text-gray-500">Anyone with the link <b>and</b> the password can download these files without logging in. Turn a link off when it is no longer needed.</p>
      {reveal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50" onClick={() => setReveal(null)}>
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-lg max-h-[92vh] overflow-y-auto p-4" onClick={e => e.stopPropagation()}>
            <h3 className="font-bold text-primary-800 flex items-center gap-2 mb-3"><KeyRound size={17} /> New password</h3>
            <Reveal client={client} {...reveal} onDone={() => setReveal(null)} />
          </div>
        </div>
      )}
    </div>
  );
}
