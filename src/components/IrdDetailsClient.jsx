import { useEffect, useState } from 'react';
import toast from 'react-hot-toast';
import { Fingerprint, Pencil, Save, X, Loader2, ShieldCheck, Eye, EyeOff, CheckCircle2, Lock } from 'lucide-react';
import { CLIENT_TYPES, needsSsid, tinOk, cleanTin, fmtTin, myIrd, saveMyIrd } from '../lib/ird';
import { logActivity } from '../lib/activity';

/** Client: add / update TIN, RAMIS PIN and SSID (optional). Secrets are never shown back. */
export default function IrdDetailsClient() {
  const [d, setD] = useState(null);
  const [edit, setEdit] = useState(false);
  const [f, setF] = useState({});
  const [show, setShow] = useState(false);
  const [busy, setBusy] = useState(false);

  const load = () => myIrd().then(setD).catch(e => toast.error(e.message));
  useEffect(() => { load(); }, []);
  if (!d) return <div className="card p-5 text-sm text-gray-400 flex items-center gap-2"><Loader2 size={15} className="animate-spin" /> Loading…</div>;

  const startEdit = () => { setF({ tin: d.tin ?? '', pin: '', ssid: '', type: d.client_type, consent: false }); setShow(false); setEdit(true); };
  const addingSecret = edit && (f.pin.trim() || f.ssid.trim());
  const save = async () => {
    if (!tinOk(f.tin)) return toast.error('TIN must be 9 to 12 digits · TIN අංකය ඉලක්කම් 9ක් විය යුතුයි');
    if (addingSecret && !f.consent) return toast.error('Please tick the box to allow TaxMate to use these details');
    setBusy(true);
    try {
      await saveMyIrd({
        tin: cleanTin(f.tin) !== cleanTin(d.tin) ? f.tin : undefined,
        pin: f.pin.trim() || undefined,
        ssid: f.ssid.trim() || undefined,
        type: f.type !== d.client_type ? f.type : undefined,
        consent: f.consent,
      });
      toast.success('Saved — thank you! TaxMate has been notified.');
      logActivity('submit', '/client/profile', 'IRD details');
      setEdit(false);
      load();
    } catch (e) { toast.error(e.message); }
    setBusy(false);
  };

  const Status = ({ ok, label }) => (
    <div className="rounded-xl border border-gray-100 bg-gray-50/70 px-3 py-2.5">
      <div className="text-[11px] font-semibold text-gray-400 uppercase tracking-wider">{label}</div>
      <div className={`text-sm mt-0.5 flex items-center gap-1.5 ${ok ? 'text-emerald-700 font-semibold' : 'text-gray-400'}`}>
        {ok ? <><CheckCircle2 size={14} /> Saved securely</> : 'Not added'}
      </div>
    </div>
  );

  return (
    <div className="card overflow-hidden">
      <div className="px-5 py-4 bg-gradient-to-r from-primary-50 to-white flex items-start gap-3 border-b border-gray-100">
        <div className="w-11 h-11 rounded-2xl bg-gradient-to-br from-primary-600 to-indigo-600 text-white flex items-center justify-center flex-shrink-0 shadow-sm"><Fingerprint size={22} /></div>
        <div className="flex-1">
          <div className="font-bold text-gray-800">IRD details for filing (optional)</div>
          <p className="text-sm text-gray-500">To file your return in RAMIS, TaxMate needs your <b>TIN</b> and <b>RAMIS PIN</b> (companies also the <b>SSID</b>). Add them here if you like.</p>
          <p className="text-xs text-gray-400 mt-0.5">RAMIS හරහා ඔබේ බදු ලේඛනය ගොනු කිරීමට TIN සහ PIN අවශ්‍යයි — කැමති නම් පමණක් ඇතුළත් කරන්න.</p>
        </div>
        {!edit && <button onClick={startEdit} className="btn-secondary text-xs py-1.5"><Pencil size={13} /> {d.tin || d.has_pin ? 'Update' : 'Add'}</button>}
      </div>

      <div className="p-5 space-y-4">
        {!edit ? (
          <div className="grid sm:grid-cols-3 gap-3">
            <div className="rounded-xl border border-gray-100 bg-gray-50/70 px-3 py-2.5">
              <div className="text-[11px] font-semibold text-gray-400 uppercase tracking-wider">TIN · {CLIENT_TYPES[d.client_type]?.label}</div>
              <div className={`mt-0.5 ${d.tin ? 'font-mono text-base font-bold text-primary-800' : 'text-sm text-gray-400'}`}>{d.tin ? fmtTin(d.tin) : 'Not added'}</div>
            </div>
            <Status ok={d.has_pin} label="RAMIS PIN" />
            {(needsSsid(d.client_type) || d.has_ssid) && <Status ok={d.has_ssid} label="SSID" />}
          </div>
        ) : (
          <div className="space-y-3">
            <div className="grid sm:grid-cols-2 gap-3">
              <label className="text-xs font-semibold text-gray-600">I am filing as
                <select className="input mt-1" value={f.type} onChange={e => setF({ ...f, type: e.target.value })}>
                  {Object.entries(CLIENT_TYPES).map(([k, t]) => <option key={k} value={k}>{t.emoji} {t.label} · {t.si}</option>)}
                </select>
              </label>
              <label className="text-xs font-semibold text-gray-600">TIN (Taxpayer Identification Number)
                <input className={`input mt-1 font-mono ${tinOk(f.tin) ? '' : 'border-red-400 bg-red-50'}`} inputMode="numeric" placeholder="e.g. 123456789" value={f.tin} onChange={e => setF({ ...f, tin: e.target.value })} />
              </label>
              <label className="text-xs font-semibold text-gray-600">RAMIS PIN {d.has_pin && <span className="font-normal text-gray-400">(empty = keep the saved one)</span>}
                <div className="relative mt-1">
                  <input className="input font-mono pr-10" type={show ? 'text' : 'password'} autoComplete="new-password" maxLength={30}
                    placeholder={d.has_pin ? '•••••• saved' : 'PIN from your IRD letter'} value={f.pin} onChange={e => setF({ ...f, pin: e.target.value })} />
                  <button type="button" onClick={() => setShow(s => !s)} className="absolute right-2 top-1/2 -translate-y-1/2 p-1 text-gray-400 hover:text-gray-600">{show ? <EyeOff size={15} /> : <Eye size={15} />}</button>
                </div>
              </label>
              {needsSsid(f.type) && (
                <label className="text-xs font-semibold text-gray-600">SSID {d.has_ssid && <span className="font-normal text-gray-400">(empty = keep)</span>}
                  <input className="input mt-1 font-mono" type={show ? 'text' : 'password'} autoComplete="new-password" maxLength={40}
                    placeholder={d.has_ssid ? '•••••• saved' : 'Company SSID'} value={f.ssid} onChange={e => setF({ ...f, ssid: e.target.value })} />
                </label>
              )}
            </div>
            {addingSecret && (
              <label className="flex items-start gap-2 rounded-xl bg-amber-50 border border-amber-200 p-3 text-sm text-amber-900">
                <input type="checkbox" className="mt-1" checked={f.consent} onChange={e => setF({ ...f, consent: e.target.checked })} />
                <span>I allow <b>TaxMate Solutions</b> to use my RAMIS PIN{needsSsid(f.type) ? ' / SSID' : ''} only to file my tax returns and handle my IRD matters for me.
                  <span className="block text-xs text-amber-800 mt-0.5">මගේ බදු කටයුතු සඳහා පමණක් TaxMate හට මෙය භාවිතා කිරීමට මම අවසර දෙමි.</span></span>
              </label>
            )}
            <div className="flex gap-2">
              <button onClick={() => setEdit(false)} className="btn-secondary flex-1 justify-center text-sm"><X size={14} /> Cancel</button>
              <button onClick={save} disabled={busy} className="btn-primary flex-1 justify-center text-sm">{busy ? <Loader2 size={14} className="animate-spin" /> : <Save size={14} />} Save</button>
            </div>
          </div>
        )}
        <div className="text-[11px] text-gray-500 flex items-start gap-1.5">
          <ShieldCheck size={13} className="text-emerald-600 flex-shrink-0 mt-px" />
          <span>Your PIN{needsSsid(d.client_type) ? ' and SSID are' : ' is'} stored <b>encrypted</b>. Only TaxMate's advisors can open {needsSsid(d.client_type) ? 'them' : 'it'}, and every view is recorded. For your safety it is not shown here again.</span>
        </div>
        {d.updated_at && <div className="text-[11px] text-gray-400 flex items-center gap-1"><Lock size={11} /> Last updated {new Date(d.updated_at).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })}</div>}
      </div>
    </div>
  );
}
