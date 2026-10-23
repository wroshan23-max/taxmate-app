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
