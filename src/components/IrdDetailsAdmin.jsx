import { useEffect, useRef, useState } from 'react';
import toast from 'react-hot-toast';
import { KeyRound, Eye, EyeOff, Copy, Pencil, X, Save, Loader2, ShieldCheck, History, Sparkles, Building2, Fingerprint } from 'lucide-react';
import { CLIENT_TYPES, needsSsid, tinOk, cleanTin, fmtTin, adminIrd, adminSaveIrd, revealIrd, LOG_LABEL } from '../lib/ird';
import { ago } from '../lib/activity';

/** Masked secret with Show (auto-hides after 30 s) and Copy. Every reveal is logged in the database. */
function SecretRow({ label, has, field, clientId, onRevealed }) {
  const [value, setValue] = useState(null);
  const [busy, setBusy] = useState(false);
  const timer = useRef();
  useEffect(() => () => clearTimeout(timer.current), []);

  const get = async () => {
    setBusy(true);
    try { const v = await revealIrd(clientId, field); onRevealed?.(); return v; }
    catch (e) { toast.error(e.message); return null; }
    finally { setBusy(false); }
  };
  const show = async () => {
    if (value) { setValue(null); clearTimeout(timer.current); return; }
    const v = await get();
    if (v) { setValue(v); clearTimeout(timer.current); timer.current = setTimeout(() => setValue(null), 30000); }
  };
  const copy = async () => {
    const v = value ?? await get();
    if (!v) return;
    try { await navigator.clipboard.writeText(v); toast.success(`${label} copied`); } catch { toast.error('Could not copy'); }
  };

  return (
    <div className="rounded-xl border border-gray-100 bg-gray-50/70 px-3 py-2.5">
      <div className="text-[11px] font-semibold text-gray-400 uppercase tracking-wider">{label}</div>
      {has ? (
        <div className="flex items-center gap-2 mt-0.5">
          <div className={`flex-1 font-mono text-base ${value ? 'text-primary-800 font-bold tracking-wide' : 'text-gray-500 tracking-[0.3em]'}`}>{value ?? '••••••••'}</div>
          <button onClick={show} disabled={busy} title={value ? 'Hide' : 'Show (logged)'} className="p-1.5 rounded-lg text-gray-500 hover:bg-white hover:text-primary-700">
            {busy ? <Loader2 size={15} className="animate-spin" /> : value ? <EyeOff size={15} /> : <Eye size={15} />}
          </button>
          <button onClick={copy} disabled={busy} title="Copy (logged)" className="p-1.5 rounded-lg text-gray-500 hover:bg-white hover:text-primary-700"><Copy size={15} /></button>
        </div>
      ) : <div className="text-sm text-gray-400 mt-0.5">Not saved</div>}
    </div>
  );
}

export default function IrdDetailsAdmin({ client, onClientChange }) {
  const [d, setD] = useState(null);
  const [edit, setEdit] = useState(false);
  const [f, setF] = useState({});
  const [busy, setBusy] = useState(false);
  const [showLog, setShowLog] = useState(false);
  const [wasNew, setWasNew] = useState(false);

  const load = async (first) => {
    try {
      const r = await adminIrd(client.id);
      if (first) setWasNew(r.updated_role === 'client' && !r.seen_at && r.updated_at);
      setD(r);
    } catch (e) { toast.error(e.message); }
  };
  useEffect(() => { load(true); }, [client.id]); // eslint-disable-line react-hooks/exhaustive-deps
  if (!d) return <div className="card p-5 text-sm text-gray-400 flex items-center gap-2"><Loader2 size={15} className="animate-spin" /> Loading IRD details…</div>;

  const type = edit ? f.type : d.client_type;
  const startEdit = () => { setF({ tin: d.tin ?? '', pin: '', ssid: '', type: d.client_type, clearPin: false, clearSsid: false }); setEdit(true); };
  const save = async () => {
    if (!tinOk(f.tin)) return toast.error('TIN must be 9 to 12 digits');
    setBusy(true);
    try {
      await adminSaveIrd(client.id, {
        tin: cleanTin(f.tin) !== cleanTin(d.tin) ? f.tin : undefined,
        pin: f.clearPin ? '' : (f.pin.trim() || undefined),
        ssid: f.clearSsid ? '' : (f.ssid.trim() || undefined),
        type: f.type !== d.client_type ? f.type : undefined,
      });
      toast.success('IRD details saved');
      setEdit(false);
      await load();
      onClientChange?.({ tin: cleanTin(f.tin) || null, client_type: f.type });
    } catch (e) { toast.error(e.message); }
    setBusy(false);
  };

  return (
    <div className="card overflow-hidden">
      <div className="card-header flex-wrap gap-2">
        <Fingerprint size={16} /> IRD / RAMIS filing details
        {wasNew && <span className="text-[10px] font-black uppercase bg-gold-500 text-primary-900 rounded px-1.5 py-0.5 flex items-center gap-0.5"><Sparkles size={10} /> Updated by client</span>}
        <div className="ml-auto flex items-center gap-2">
          {!edit
            ? <button onClick={startEdit} className="btn-secondary text-xs py-1"><Pencil size={13} /> Edit</button>
            : <>
                <button onClick={() => setEdit(false)} className="btn-secondary text-xs py-1"><X size={13} /> Cancel</button>
                <button onClick={save} disabled={busy} className="btn-primary text-xs py-1">{busy ? <Loader2 size={13} className="animate-spin" /> : <Save size={13} />} Save</button>
              </>}
        </div>
      </div>

      <div className="p-5 space-y-4">
        {!edit ? (
          <div className="grid sm:grid-cols-3 gap-3">
            <div className="rounded-xl border border-gray-100 bg-gray-50/70 px-3 py-2.5">
              <div className="text-[11px] font-semibold text-gray-400 uppercase tracking-wider">TIN · {CLIENT_TYPES[d.client_type]?.emoji} {CLIENT_TYPES[d.client_type]?.label}</div>
              {d.tin ? (
                <div className="flex items-center gap-2 mt-0.5">
                  <div className="flex-1 font-mono text-base font-bold text-primary-800">{fmtTin(d.tin)}</div>
                  <button onClick={() => { navigator.clipboard?.writeText(cleanTin(d.tin)); toast.success('TIN copied'); }} title="Copy" className="p-1.5 rounded-lg text-gray-500 hover:bg-white hover:text-primary-700"><Copy size={15} /></button>
                </div>
              ) : <div className="text-sm text-gray-400 mt-0.5">Not saved</div>}
            </div>
            <SecretRow label="RAMIS PIN" has={d.has_pin} field="pin" clientId={client.id} onRevealed={() => load()} />
            {(needsSsid(type) || d.has_ssid)
              ? <SecretRow label="SSID" has={d.has_ssid} field="ssid" clientId={client.id} onRevealed={() => load()} />
              : <div className="rounded-xl border border-dashed border-gray-200 px-3 py-2.5 text-xs text-gray-400 flex items-center gap-2"><Building2 size={14} /> SSID is for companies — change the type in Edit if needed.</div>}
          </div>
        ) : (
          <div className="grid sm:grid-cols-2 gap-3">
            <label className="text-xs font-semibold text-gray-600">Taxpayer type
              <select className="input mt-1" value={f.type} onChange={e => setF({ ...f, type: e.target.value })}>
                {Object.entries(CLIENT_TYPES).map(([k, t]) => <option key={k} value={k}>{t.emoji} {t.label}</option>)}
              </select>
            </label>
            <label className="text-xs font-semibold text-gray-600">TIN
              <input className={`input mt-1 font-mono ${tinOk(f.tin) ? '' : 'border-red-400 bg-red-50'}`} inputMode="numeric" placeholder="9-digit TIN" value={f.tin} onChange={e => setF({ ...f, tin: e.target.value })} />
            </label>
            <label className="text-xs font-semibold text-gray-600">RAMIS PIN {d.has_pin && <span className="font-normal text-gray-400">(leave empty to keep the saved one)</span>}
              <input className="input mt-1 font-mono" type="password" autoComplete="new-password" disabled={f.clearPin} placeholder={d.has_pin ? '•••••• saved' : 'PIN from IRD'} value={f.pin} onChange={e => setF({ ...f, pin: e.target.value })} />
              {d.has_pin && <span className="flex items-center gap-1.5 mt-1 font-normal text-red-600"><input type="checkbox" checked={f.clearPin} onChange={e => setF({ ...f, clearPin: e.target.checked, pin: '' })} /> Remove saved PIN</span>}
            </label>
            {(needsSsid(f.type) || d.has_ssid) && (
              <label className="text-xs font-semibold text-gray-600">SSID {d.has_ssid && <span className="font-normal text-gray-400">(leave empty to keep)</span>}
                <input className="input mt-1 font-mono" type="password" autoComplete="new-password" disabled={f.clearSsid} placeholder={d.has_ssid ? '•••••• saved' : 'Company SSID'} value={f.ssid} onChange={e => setF({ ...f, ssid: e.target.value })} />
                {d.has_ssid && <span className="flex items-center gap-1.5 mt-1 font-normal text-red-600"><input type="checkbox" checked={f.clearSsid} onChange={e => setF({ ...f, clearSsid: e.target.checked, ssid: '' })} /> Remove saved SSID</span>}
              </label>
            )}
          </div>
        )}

        <div className="flex items-center gap-3 flex-wrap text-[11px] text-gray-500">
          <span className="flex items-center gap-1"><ShieldCheck size={12} className="text-emerald-600" /> PIN &amp; SSID are encrypted; every view is logged.</span>
          {d.updated_at && <span>Last change {ago(d.updated_at)} by {d.updated_role === 'client' ? 'the client' : (d.updated_by_name || 'TaxMate')}</span>}
          {d.consent_at && <span className="text-emerald-700">✓ Client allowed TaxMate to use these ({new Date(d.consent_at).toLocaleDateString('en-GB')})</span>}
          {d.log?.length > 0 && <button onClick={() => setShowLog(s => !s)} className="ml-auto font-semibold text-primary-700 hover:underline flex items-center gap-1"><History size={12} /> {showLog ? 'Hide' : 'Show'} history</button>}
        </div>
        {showLog && (
          <div className="rounded-xl bg-gray-50 divide-y divide-gray-100 text-xs">
            {d.log.map((l, i) => (
              <div key={i} className="px-3 py-1.5 flex gap-2"><KeyRound size={12} className="text-gray-400 mt-0.5" /><span className="flex-1"><b>{l.by}</b> {LOG_LABEL(l.action)}</span><span className="text-gray-400">{ago(l.at)}</span></div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
