// V59 — phone / computer notifications (Web Push). The push itself is sent by the Edge Function "push".
import { supabase } from './supabase';
import { deviceId, platform, isStandalone, isIOS } from './pwa';

const errMsg = (e) => (e?.message || String(e)).replace(/^.*?ERROR:\s*/, '');
export const pushSupported = () => typeof window !== 'undefined' && 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window;
/** iPhone/iPad: notifications work only in the app opened from the Home Screen */
export const iosNeedsInstall = () => isIOS() && !isStandalone();

const toKey = (b64) => { const s = b64.replace(/-/g, '+').replace(/_/g, '/') + '==='.slice((b64.length + 3) % 4); return Uint8Array.from(atob(s), c => c.charCodeAt(0)); };
const sameKey = (a, b) => a && b && a.byteLength === b.byteLength && new Uint8Array(a).every((x, i) => x === b[i]);

async function registration() {
  const reg = await Promise.race([navigator.serviceWorker.ready, new Promise((_, no) => setTimeout(() => no(new Error('The app is still loading — please try again in a moment.')), 8000))]);
  return reg;
}
export async function publicKey() {
  const { data, error } = await supabase.rpc('push_public_key');
  if (error) throw new Error(errMsg(error));
  return data || null;
}

/** { supported, ready, permission, subscribed, iosInstall } */
export async function pushState() {
  if (iosNeedsInstall()) return { supported: false, iosInstall: true };
  if (!pushSupported()) return { supported: false };
  let ready = false; try { ready = !!(await publicKey()); } catch { /* not set up */ }
  let subscribed = false;
  try { const reg = await navigator.serviceWorker.getRegistration(); subscribed = !!(await reg?.pushManager.getSubscription()); } catch { /* ignore */ }
  return { supported: true, ready, permission: Notification.permission, subscribed: subscribed && Notification.permission === 'granted' };
}

async function save(sub) {
  const j = sub.toJSON();
  const { error } = await supabase.rpc('save_push_subscription', { p_endpoint: j.endpoint, p_p256dh: j.keys?.p256dh, p_auth: j.keys?.auth, p_device: deviceId(), p_platform: platform() });
  if (error) throw new Error(errMsg(error));
}

/** Ask permission (must run from a tap) and save this device */
export async function enablePush() {
  if (iosNeedsInstall()) throw new Error('On iPhone, first add TaxMate to your Home Screen and open it from there.');
  if (!pushSupported()) throw new Error('This browser cannot show notifications.');
  const key = await publicKey();
  if (!key) throw new Error('Phone notifications are not set up yet.');
  const perm = await Notification.requestPermission();
  if (perm !== 'granted') throw new Error(perm === 'denied' ? 'Notifications are blocked — allow them in the browser / phone settings for this site.' : 'Notifications were not allowed.');
  const reg = await registration();
  let sub = await reg.pushManager.getSubscription();
  const appKey = toKey(key);
  if (sub && !sameKey(sub.options?.applicationServerKey, appKey)) { await sub.unsubscribe().catch(() => {}); sub = null; }
  if (!sub) sub = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: appKey });
  await save(sub);
}

export async function disablePush() {
  try {
    const reg = await navigator.serviceWorker.getRegistration();
    const sub = await reg?.pushManager.getSubscription();
    if (sub) { await supabase.rpc('remove_my_push_subscription', { p_endpoint: sub.endpoint }); await sub.unsubscribe(); }
  } catch { /* ignore */ }
}

/** Signed in on a device that already allowed notifications → keep it linked to this account */
export async function syncPush() {
  try {
    if (!pushSupported() || Notification.permission !== 'granted') return;
    const reg = await navigator.serviceWorker.getRegistration();
    const sub = await reg?.pushManager.getSubscription();
    if (sub) await save(sub);
  } catch { /* ignore */ }
}

export async function testPush() {
  const { data, error } = await supabase.functions.invoke('push', { body: { action: 'test' } });
  if (error) throw new Error(errMsg(error));
  if (data?.error) throw new Error(data.error);
  return data;
}
export async function setupPush() {
  const { data, error } = await supabase.functions.invoke('push', { body: { action: 'setup' } });
  if (error) throw new Error(errMsg(error));
  if (data?.error) throw new Error(data.error);
  return data;
}
/** Before signing out: stop sending this account's notifications to this device (it is linked again at the next sign-in) */
export async function unlinkPush() {
  try {
    if (!pushSupported()) return;
    const reg = await navigator.serviceWorker.getRegistration();
    const sub = await reg?.pushManager.getSubscription();
    if (sub) await Promise.race([supabase.rpc('remove_my_push_subscription', { p_endpoint: sub.endpoint }), new Promise(r => setTimeout(r, 3000))]);
  } catch { /* ignore */ }
}
