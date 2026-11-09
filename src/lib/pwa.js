// Installable app (PWA): service worker + "Add to home screen" prompt
import { useEffect, useState } from 'react';

export function registerSW() {
  if (!('serviceWorker' in navigator) || !import.meta.env.PROD) return;
  window.addEventListener('load', () => { navigator.serviceWorker.register('/sw.js').catch(() => {}); });
}

let deferred = null;
const subs = new Set();
if (typeof window !== 'undefined') {
  window.addEventListener('beforeinstallprompt', (e) => { e.preventDefault(); deferred = e; subs.forEach(f => f()); });
  window.addEventListener('appinstalled', () => { deferred = null; subs.forEach(f => f()); });
}
export const isStandalone = () => window.matchMedia?.('(display-mode: standalone)').matches || window.navigator.standalone === true;
export const isIOS = () => /iPhone|iPad|iPod/i.test(navigator.userAgent) && !window.MSStream;

/** { canInstall, ios, installed, install() } */
export function useInstallPrompt() {
  const [, force] = useState(0);
  useEffect(() => { const f = () => force(n => n + 1); subs.add(f); return () => subs.delete(f); }, []);
  return {
    canInstall: !!deferred,
    ios: isIOS() && !isStandalone(),
    installed: isStandalone(),
    install: async () => { if (!deferred) return false; deferred.prompt(); const r = await deferred.userChoice; deferred = null; force(n => n + 1); return r.outcome === 'accepted'; },
  };
}

// ─── V59 — count installs (random device id, no personal data) ───
const DEV_KEY = 'tm_device';
export function deviceId() {
  try {
    let d = localStorage.getItem(DEV_KEY);
    if (!d || !/^[a-z0-9]{8,40}$/.test(d)) { d = Array.from(crypto.getRandomValues(new Uint8Array(12)), b => (b % 36).toString(36)).join(''); localStorage.setItem(DEV_KEY, d); }
    return d;
  } catch { return null; }
}
export function platform() {
  const ua = navigator.userAgent || '';
  if (/Android/i.test(ua)) return 'android';
  if (/iPhone|iPad|iPod/i.test(ua) || (/Macintosh/.test(ua) && navigator.maxTouchPoints > 1)) return 'ios';
  if (/Windows/i.test(ua)) return 'windows';
  if (/Macintosh|Mac OS/i.test(ua)) return 'mac';
  if (/Linux/i.test(ua)) return 'linux';
  return 'other';
}
/** event 'open' (running as the installed app) or 'install' (the browser just installed it) */
export async function logAppOpen(event = 'open') {
  const d = deviceId();
  if (!d || !import.meta.env.PROD) return;
  try {
    const { supabase } = await import('./supabase');
    await supabase.rpc('log_app_open', { p_device: d, p_platform: platform(), p_event: event });
  } catch { /* never disturb the app */ }
}
if (typeof window !== 'undefined') window.addEventListener('appinstalled', () => { logAppOpen('install'); });
