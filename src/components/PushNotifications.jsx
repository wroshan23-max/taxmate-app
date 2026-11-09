// V59 — phone notifications: dashboard prompt (clients), on/off switch (anyone), admin set-up card
import { useEffect, useState } from 'react';
import toast from 'react-hot-toast';
import { BellRing, BellOff, Loader2, Send, Smartphone, X } from 'lucide-react';
import { supabase, VIEW_AS } from '../lib/supabase';
import { pushState, enablePush, disablePush, testPush, setupPush } from '../lib/push';

const KEY = 'tm_push_prompt_dismissed';
const dismissedAt = () => { try { return Number(localStorage.getItem(KEY) || 0); } catch { return 0; } };

function usePushState() {
  const [st, setSt] = useState(null);
  const refresh = () => pushState().then(setSt).catch(() => setSt({ supported: false }));
  useEffect(() => { if (!VIEW_AS) refresh(); }, []);
  return [st, refresh];
}

/** Client dashboard: "Get notifications on this phone" — shown until turned on (or dismissed for 14 days) */
export function PushPrompt() {
  const [st, refresh] = usePushState();
  const [busy, setBusy] = useState(false);
  const [hidden, setHidden] = useState(() => Date.now() - dismissedAt() < 14 * 864e5);
  if (VIEW_AS || hidden || !st?.supported || !st.ready || st.subscribed || st.permission === 'denied') return null;
  const dismiss = () => { try { localStorage.setItem(KEY, String(Date.now())); } catch { /* private mode */ } setHidden(true); };
  const on = async () => {
    setBusy(true);
    try { await enablePush(); toast.success('Notifications are on for this device'); refresh(); } catch (e) { toast.error(e.message); }
    setBusy(false);
  };
  return (
    <div className="flex items-center gap-3 rounded-xl border border-primary-200 bg-primary-50 p-4">
      <div className="w-10 h-10 rounded-xl bg-primary-600 text-white flex items-center justify-center flex-shrink-0"><BellRing size={20} /></div>
      <div className="flex-1 min-w-0">
        <div className="font-semibold text-primary-900">Get TaxMate notifications on this phone</div>
        <div className="text-xs text-primary-700">Invoices, tax payments due, messages & return updates pop up like WhatsApp · දැනුම්දීම් phone එකට ලබාගන්න</div>
      </div>
      <button onClick={on} disabled={busy} className="btn-primary text-sm py-1.5 flex-shrink-0">{busy ? <Loader2 size={14} className="animate-spin" /> : <BellRing size={14} />} Turn on</button>
      <button onClick={dismiss} className="p-1 text-primary-400 hover:text-primary-700" title="Not now"><X size={15} /></button>
    </div>
  );
}

/** Compact on/off row for this device (bell menu, settings) */
export function PushSwitch({ className = '' }) {
  const [st, refresh] = usePushState();
  const [busy, setBusy] = useState(false);
  if (VIEW_AS || !st) return null;
  const run = async (fn, ok) => { setBusy(true); try { await fn(); if (ok) toast.success(ok); } catch (e) { toast.error(e.message); } await refresh(); setBusy(false); };
  let text, action = null;
  if (st.iosInstall) text = 'On iPhone: Share → Add to Home Screen, open TaxMate from there, then turn on notifications.';
  else if (!st.supported) text = 'This browser cannot show notifications.';
  else if (!st.ready) text = 'Phone notifications are not set up yet.';
  else if (st.permission === 'denied') text = 'Notifications are blocked for this site — allow them in the browser / phone settings.';
  else if (st.subscribed) {
    text = <>Notifications on this device: <b className="text-green-700">On</b></>;
    action = <>
      <button onClick={() => run(async () => { const r = await testPush(); if (!r?.sent) throw new Error('Test not delivered — try turning it off and on.'); }, 'Test sent — check your notifications')} disabled={busy} className="text-xs font-semibold text-primary-700 hover:underline inline-flex items-center gap-1"><Send size={12} /> Test</button>
      <button onClick={() => run(disablePush, 'Notifications off for this device')} disabled={busy} className="text-xs text-gray-500 hover:text-red-600 inline-flex items-center gap-1"><BellOff size={12} /> Turn off</button>
    </>;
  } else {
    text = <>Notifications on this device: <b className="text-gray-600">Off</b></>;
    action = <button onClick={() => run(enablePush, 'Notifications are on for this device')} disabled={busy} className="text-xs font-semibold text-primary-700 hover:underline inline-flex items-center gap-1"><BellRing size={12} /> Turn on</button>;
  }
  return (
    <div className={`flex items-center gap-2 text-xs text-gray-600 flex-wrap ${className}`}>
      <Smartphone size={13} className="text-gray-400 flex-shrink-0" />
      <span className="flex-1 min-w-[160px]">{text}</span>
      {busy ? <Loader2 size={13} className="animate-spin text-gray-400" /> : action}
    </div>
  );
}

/** Admin settings: set up once, see who gets notifications, this device on/off */
export function PushSettingsCard() {
  const [s, setS] = useState(null);
  const [busy, setBusy] = useState(false);
  const [k, setK] = useState(0);
  const load = () => supabase.rpc('admin_app_installs').then(({ data }) => setS(data ?? {}));
  useEffect(() => { load(); }, []);
  const setup = async () => {
    setBusy(true);
    try { await setupPush(); toast.success('Phone notifications are ready'); await load(); setK(x => x + 1); } catch (e) { toast.error(e.message); }
    setBusy(false);
  };
  return (
    <div className="card">
      <div className="card-header"><BellRing size={16} /> Phone notifications (push)</div>
      <div className="p-5 space-y-3 text-sm">
        <p className="text-gray-600">Clients get every portal notice (invoice, tax payment due, reminder, message, return update) as a pop-up on their phone or computer. You get a pop-up for new client messages, bank slips, tax receipts, online registrations and service bookings.</p>
        {!s ? <div className="text-gray-400">Loading…</div> : !s.push_ready ? (
          <div className="rounded-xl bg-amber-50 border border-amber-200 p-3 flex items-center gap-3 flex-wrap">
            <span className="flex-1 text-amber-900">Not set up yet. One click makes the app's notification keys (kept safely in the database — nothing to copy).</span>
            <button onClick={setup} disabled={busy} className="btn-primary text-sm">{busy ? <Loader2 size={14} className="animate-spin" /> : <BellRing size={14} />} Set up now</button>
          </div>
        ) : (
          <>
            <div className="grid grid-cols-3 gap-2 text-center">
              <div className="rounded-xl bg-primary-50 p-2"><div className="text-lg font-black text-primary-800">{s.push_clients ?? 0}</div><div className="text-[11px] text-gray-500">clients with notifications on</div></div>
              <div className="rounded-xl bg-primary-50 p-2"><div className="text-lg font-black text-primary-800">{s.push_devices ?? 0}</div><div className="text-[11px] text-gray-500">client devices</div></div>
              <div className="rounded-xl bg-primary-50 p-2"><div className="text-lg font-black text-primary-800">{s.push_admin ?? 0}</div><div className="text-[11px] text-gray-500">admin devices</div></div>
            </div>
            <PushSwitch key={k} className="rounded-lg bg-gray-50 px-3 py-2" />
            <p className="text-[11px] text-gray-500">Turn it on here on each phone / computer you use for TaxMate admin. Clients see a "Turn on" card on their dashboard. iPhone: works only after the app is added to the Home Screen (iOS 16.4 or later).</p>
          </>
        )}
      </div>
    </div>
  );
}
