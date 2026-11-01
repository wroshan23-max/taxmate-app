import { useEffect, useRef, useState } from 'react';
import toast from 'react-hot-toast';
import { DatabaseBackup, Loader2, ExternalLink, CheckCircle2, AlertTriangle, XCircle, Clock, Play, FileSpreadsheet, FileArchive, FolderSync } from 'lucide-react';
import { supabase } from '../lib/supabase';
import { driveBackupNow, fmtBytes } from '../lib/documents';
import { ago } from '../lib/activity';

const DEFAULTS = { enabled: true, keep_daily: 30, keep_monthly: 12, files: true };
const STATUS = {
  running: { label: 'Running…', cls: 'bg-blue-50 text-blue-700', icon: Loader2 },
  ok: { label: 'Done', cls: 'bg-emerald-50 text-emerald-700', icon: CheckCircle2 },
  partial: { label: 'Done · files continue next time', cls: 'bg-amber-50 text-amber-800', icon: Clock },
  error: { label: 'Failed', cls: 'bg-red-50 text-red-700', icon: XCircle },
};
const when = (iso) => (iso ? new Date(iso).toLocaleString('en-GB', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }) : '—');

/** Settings → File storage: automatic nightly backup of all app data to OneDrive (V52). */
export default function BackupSettings({ connected }) {
  const [cfg, setCfg] = useState(null);
  const [runs, setRuns] = useState([]);
  const [busy, setBusy] = useState(false);
  const poll = useRef(null);

  const load = async () => {
    const [{ data: st }, { data: r }] = await Promise.all([
      supabase.from('app_settings').select('value').eq('key', 'backup').maybeSingle(),
      supabase.from('backups').select('*').order('started_at', { ascending: false }).limit(10),
    ]);
    setCfg({ ...DEFAULTS, ...(st?.value ?? {}) });
    setRuns(r ?? []);
    return r ?? [];
  };
  useEffect(() => { load(); return () => clearInterval(poll.current); }, []);

  const watch = () => {
    clearInterval(poll.current);
    let n = 0;
    poll.current = setInterval(async () => {
      const r = await load(); n++;
      if (r[0]?.status !== 'running' || n > 60) {
        clearInterval(poll.current);
        if (r[0]?.status === 'ok' || r[0]?.status === 'partial') toast.success('Backup saved to OneDrive');
        else if (r[0]?.status === 'error') toast.error(`Backup failed: ${r[0].error ?? ''}`);
      }
    }, 5000);
  };
  const save = async (patch) => {
    const next = { ...cfg, ...patch };
    setCfg(next);
    const { error } = await supabase.from('app_settings').upsert({ key: 'backup', value: next });
    if (error) { toast.error(error.message); load(); } else toast.success(next.enabled ? 'Saved' : 'Automatic backups switched off');
  };
  const now = async () => {
    setBusy(true);
    try { await driveBackupNow(); toast.success('Backup started — it takes a minute or two'); await load(); watch(); }
    catch (e) { toast.error(e.message); }
    setBusy(false);
  };

  if (!cfg) return <div className="card p-6 text-center text-gray-400"><Loader2 className="animate-spin mx-auto" /></div>;
  const last = runs[0];
  const lastGood = runs.find(r => r.status === 'ok' || r.status === 'partial');
  const stale = cfg.enabled && connected && (!lastGood || Date.now() - new Date(lastGood.started_at) > 2 * 86400000);
  const running = last?.status === 'running';

  return (
    <div className="card overflow-hidden">
      <div className="px-5 py-4 border-b border-gray-100 flex items-center gap-3 flex-wrap">
        <div className="w-10 h-10 rounded-xl bg-primary-50 text-primary-700 flex items-center justify-center"><DatabaseBackup size={20} /></div>
        <div className="flex-1 min-w-[220px]">
          <div className="font-bold text-gray-800">Automatic backups to OneDrive</div>
          <div className="text-xs text-gray-500">Every night at 2:00 AM · all app data + an Excel copy · keeps {cfg.keep_daily} daily and {cfg.keep_monthly} monthly backups</div>
        </div>
        <label className="inline-flex items-center gap-2 text-sm font-semibold cursor-pointer">
          <input type="checkbox" className="w-4 h-4" checked={!!cfg.enabled} onChange={e => save({ enabled: e.target.checked })} /> {cfg.enabled ? 'On' : 'Off'}
        </label>
        <button onClick={now} disabled={busy || running || !connected} className="btn-primary text-sm">
          {busy || running ? <Loader2 size={15} className="animate-spin" /> : <Play size={15} />} {running ? 'Backing up…' : 'Back up now'}
        </button>
      </div>

      <div className="p-5 space-y-4">
        {!connected && <div className="text-sm text-amber-900 bg-amber-50 border border-amber-200 rounded-xl p-3 flex gap-2"><AlertTriangle size={16} className="flex-shrink-0 mt-0.5" /> Connect OneDrive above first — backups are saved there.</div>}
        {stale && !running && <div className="text-sm text-red-800 bg-red-50 border border-red-200 rounded-xl p-3 flex gap-2"><AlertTriangle size={16} className="flex-shrink-0 mt-0.5" /> {lastGood ? `The last good backup was ${ago(lastGood.started_at)}.` : 'No backup has been made yet.'} Press “Back up now” and check that OneDrive is still connected.</div>}

        {last ? (
          <div className="rounded-xl border border-gray-100 p-4 grid sm:grid-cols-[1fr_auto] gap-3 items-start">
            <div className="space-y-1.5">
              <div className="flex items-center gap-2 flex-wrap text-sm">
                <span className="font-semibold text-gray-800">Last backup: {when(last.started_at)}</span>
                <Pill s={last.status} />
                <span className="text-xs text-gray-400">{last.kind === 'manual' ? 'started by you' : 'automatic'}</span>
              </div>
              {last.status === 'error' && <div className="text-xs text-red-700">{last.error}</div>}
              {last.rows != null && (
                <div className="flex gap-4 flex-wrap text-xs text-gray-600">
                  <span className="inline-flex items-center gap-1"><FileArchive size={13} className="text-gray-400" /> {last.tables} tables · {Number(last.rows).toLocaleString('en-LK')} rows · {fmtBytes(last.bytes)}</span>
                  {last.xlsx_bytes != null && <span className="inline-flex items-center gap-1"><FileSpreadsheet size={13} className="text-emerald-600" /> Excel copy {fmtBytes(last.xlsx_bytes)}</span>}
                  {last.files_copied != null && <span className="inline-flex items-center gap-1"><FolderSync size={13} className="text-gray-400" /> {last.files_copied} new file{last.files_copied === 1 ? '' : 's'} copied{last.files_pending ? ` · ${last.files_pending} next time` : ''}</span>}
                </div>
              )}
              {last.folder && <div className="text-[11px] text-gray-400 font-mono">{last.folder}</div>}
            </div>
            {last.web_url && <a href={last.web_url} target="_blank" rel="noreferrer" className="btn-secondary text-xs py-1.5"><ExternalLink size={13} /> Open in OneDrive</a>}
          </div>
        ) : <div className="text-sm text-gray-500">No backups yet. The first one runs tonight at 2:00 AM — or press “Back up now”.</div>}

        <label className="flex items-start gap-2 text-sm text-gray-700 cursor-pointer">
          <input type="checkbox" className="mt-1" checked={cfg.files !== false} onChange={e => save({ files: e.target.checked })} />
          <span>Also copy app-storage files (older uploads, bank slips, signature) to <span className="font-mono text-xs">TaxMate Backups/App files</span><span className="block text-xs text-gray-400">Files already kept in OneDrive (client documents) are not copied again.</span></span>
        </label>

        {runs.length > 1 && (
          <div>
            <div className="text-xs font-semibold text-gray-500 mb-1">Recent backups</div>
            <div className="divide-y divide-gray-50 text-xs">
              {runs.slice(1).map(r => (
                <div key={r.id} className="flex items-center gap-2 py-1.5">
                  <span className="w-28 text-gray-600">{when(r.started_at)}</span><Pill s={r.status} small />
                  <span className="flex-1 truncate text-gray-500">{r.status === 'error' ? r.error : r.rows != null ? `${Number(r.rows).toLocaleString('en-LK')} rows · ${fmtBytes(r.bytes)}` : ''}</span>
                  {r.web_url && <a href={r.web_url} target="_blank" rel="noreferrer" className="text-primary-700 hover:underline">Open</a>}
                </div>
              ))}
            </div>
          </div>
        )}

        <div className="text-xs text-gray-500 bg-gray-50 rounded-xl p-3 space-y-1">
          <div><b>What is saved:</b> clients, calculations, returns, invoices, payments, plans, payroll, documents list, messages and settings — in <span className="font-mono">TaxMate-backup-…json.gz</span> (for restoring) and <span className="font-mono">TaxMate-data-…xlsx</span> (open in Excel).</div>
          <div><b>Not saved (security):</b> OneDrive sign-in, login PINs and passwords, encrypted RAMIS PIN/SSID, invite and reset links.</div>
          <div><b>Restore:</b> keep the backup file; TaxMate's developer can load it back into a new database if ever needed. Keep 2-step verification ON for the OneDrive account.</div>
        </div>
      </div>
    </div>
  );
}

function Pill({ s, small }) {
  const st = STATUS[s] ?? STATUS.error; const I = st.icon;
  return <span className={`inline-flex items-center gap-1 rounded-full font-semibold ${small ? 'text-[10px] px-1.5 py-0.5' : 'text-[11px] px-2 py-0.5'} ${st.cls}`}><I size={small ? 10 : 12} className={s === 'running' ? 'animate-spin' : ''} /> {st.label}</span>;
}
