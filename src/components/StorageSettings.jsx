import { useEffect, useRef, useState } from 'react';
import toast from 'react-hot-toast';
import { Cloud, CheckCircle2, Loader2, Link2, Unlink, RefreshCw, FolderTree, ShieldCheck, AlertTriangle, ExternalLink, KeyRound } from 'lucide-react';
import { driveStatus, driveAuthUrl, driveExchange, driveDisconnect, fmtBytes } from '../lib/documents';

const redirectUri = () => `${window.location.origin}/admin/settings`;

/** Settings → File storage: connect the firm's OneDrive for client documents. */
export default function StorageSettings() {
  const [st, setSt] = useState(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const [sure, setSure] = useState(false);
  const handled = useRef(false);

  const load = async () => {
    setErr('');
    try { setSt(await driveStatus()); } catch (e) { setErr(e.message); setSt({ configured: false, connected: false }); }
  };

  useEffect(() => {
    // Back from Microsoft sign-in: ?code=…&state=…  (or ?error=…)
    const q = new URLSearchParams(window.location.search);
    const code = q.get('code'), state = q.get('state'), mErr = q.get('error_description') || q.get('error');
    if ((code || mErr) && !handled.current) {
      handled.current = true;
      window.history.replaceState({}, '', '/admin/settings?tab=storage');
      if (mErr) { setErr(`Microsoft: ${mErr}`); load(); return; }
      setBusy(true);
      driveExchange(code, state, redirectUri())
        .then((r) => { toast.success(`OneDrive connected${r.account_email ? ` — ${r.account_email}` : ''}`); })
        .catch((e) => setErr(e.message))
        .finally(() => { setBusy(false); load(); });
      return;
    }
    load();
  }, []);

  const connect = async () => {
    setBusy(true); setErr('');
    try { const { url } = await driveAuthUrl(redirectUri()); window.location.assign(url); }
    catch (e) { setErr(e.message); setBusy(false); }
  };
  const disconnect = async () => {
    if (!sure) { setSure(true); setTimeout(() => setSure(false), 5000); return; }
    setSure(false); setBusy(true);
    try { await driveDisconnect(); toast.success('OneDrive disconnected — new uploads use the app storage'); await load(); }
    catch (e) { toast.error(e.message); }
    setBusy(false);
  };

  if (!st) return <div className="card p-8 text-center text-gray-400"><Loader2 className="animate-spin mx-auto" /></div>;
  const q = st.quota;
  const pct = q?.total ? Math.min(100, Math.round((q.used / q.total) * 100)) : 0;

  return (
    <div className="grid lg:grid-cols-[minmax(0,1.2fr)_minmax(0,1fr)] gap-5 items-start">
      <div className="card overflow-hidden">
        <div className="bg-gradient-to-r from-[#0364B8] to-[#0F78D4] text-white p-5 flex items-center gap-3">
          <div className="w-12 h-12 rounded-2xl bg-white/15 flex items-center justify-center"><Cloud size={26} /></div>
          <div className="flex-1">
            <div className="font-bold text-lg">OneDrive — client files</div>
            <div className="text-sm text-blue-100">Client documents, photos, IRD acknowledgments &amp; payment vouchers are kept in your OneDrive.</div>
          </div>
        </div>
        <div className="p-5 space-y-4">
          {st.connected ? (
            <>
              <div className="flex items-start gap-3 rounded-xl bg-emerald-50 border border-emerald-200 p-3">
                <CheckCircle2 size={20} className="text-emerald-600 flex-shrink-0 mt-0.5" />
                <div className="flex-1 text-sm">
                  <div className="font-semibold text-emerald-900">Connected{st.account_name ? ` — ${st.account_name}` : ''}</div>
                  <div className="text-emerald-800">{st.account_email}{st.connected_at ? ` · since ${new Date(st.connected_at).toLocaleDateString('en-GB')}` : ''}</div>
                </div>
              </div>
              {q?.total > 0 && (
                <div>
                  <div className="flex justify-between text-xs text-gray-500 mb-1"><span>{fmtBytes(q.used)} used</span><span>{fmtBytes(q.total)}</span></div>
                  <div className="h-2.5 rounded-full bg-gray-100 overflow-hidden"><div className={`h-full rounded-full ${pct > 90 ? 'bg-red-500' : pct > 75 ? 'bg-amber-500' : 'bg-[#0F78D4]'}`} style={{ width: `${Math.max(pct, 2)}%` }} /></div>
                </div>
              )}
              {st.problem && <div className="text-sm text-red-700 bg-red-50 border border-red-200 rounded-xl p-3 flex gap-2"><AlertTriangle size={16} className="flex-shrink-0 mt-0.5" /> {st.problem}</div>}
              <div className="flex items-center gap-2 text-sm text-gray-600"><FolderTree size={16} className="text-[#0F78D4]" /> Folder: <b className="font-mono text-[13px]">{st.root_folder}</b></div>
              <div className="flex gap-2 flex-wrap">
                <a href="https://onedrive.live.com/" target="_blank" rel="noreferrer" className="btn-secondary text-sm"><ExternalLink size={14} /> Open OneDrive</a>
                <button onClick={load} disabled={busy} className="btn-secondary text-sm"><RefreshCw size={14} /> Refresh</button>
                <button onClick={connect} disabled={busy} className="btn-secondary text-sm"><Link2 size={14} /> Reconnect</button>
                <button onClick={disconnect} disabled={busy} className="btn-secondary text-sm text-red-600"><Unlink size={14} /> {sure ? 'Tap again to disconnect' : 'Disconnect'}</button>
              </div>
            </>
          ) : (
            <>
              <p className="text-sm text-gray-600">Until OneDrive is connected, client files are saved in the app storage (1 GB, 10 MB per file). After connecting, new uploads go to OneDrive (up to 25 MB per file).</p>
              {!st.configured && (
                <div className="rounded-xl bg-amber-50 border border-amber-200 p-3 text-sm text-amber-900 flex gap-2">
                  <KeyRound size={16} className="flex-shrink-0 mt-0.5" />
                  <div>One-time setup needed: add <b className="font-mono">MS_CLIENT_ID</b> and <b className="font-mono">MS_CLIENT_SECRET</b> in Supabase → Edge Functions → Secrets (from your Microsoft app registration).</div>
                </div>
              )}
              <button onClick={connect} disabled={busy || !st.configured} className="btn-primary !bg-[#0F78D4] hover:!bg-[#0364B8]">
                {busy ? <Loader2 size={16} className="animate-spin" /> : <Cloud size={16} />} Connect OneDrive
              </button>
            </>
          )}
          {err && <div className="text-sm text-red-700 bg-red-50 border border-red-200 rounded-xl p-3">{err}</div>}
        </div>
      </div>

      <div className="space-y-4">
        <div className="card p-5 space-y-2 text-sm text-gray-600">
          <div className="font-semibold text-gray-800 flex items-center gap-2"><FolderTree size={16} className="text-primary-600" /> How files are organised</div>
          <pre className="text-[12px] bg-gray-50 rounded-xl p-3 overflow-x-auto font-mono text-gray-700">{`TaxMate Clients/
  Kasun Perera - 123456789/
    Y-A 2025-26/
      Salary - T-10 - APIT/
      IRD acknowledgment/
      IRD payment voucher/
    General/`}</pre>
          <p className="text-xs text-gray-500">Folders are created automatically. Files keep their own names; a number is added if the same name exists.</p>
        </div>
        <div className="card p-5 space-y-2 text-sm text-gray-600">
          <div className="font-semibold text-gray-800 flex items-center gap-2"><ShieldCheck size={16} className="text-emerald-600" /> Privacy</div>
          <ul className="list-disc list-inside space-y-1 text-[13px]">
            <li>Clients never get OneDrive access — they only see their own files inside the app.</li>
            <li>Each download link works for a short time only.</li>
            <li>Deleted files go to the OneDrive recycle bin (can be restored).</li>
            <li>Keep 2-step verification ON for this Microsoft account.</li>
            <li>Don't rename or move client folders in OneDrive — the app finds files by their OneDrive ID, but new uploads use the original folder name.</li>
          </ul>
        </div>
      </div>
    </div>
  );
}
