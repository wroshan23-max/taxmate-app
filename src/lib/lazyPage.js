import { lazy } from 'react';

// After a new version is deployed, a phone that still has the old app open asks for page files
// that no longer exist. Reload once to pick up the new version instead of showing a blank page.
const RELOAD_KEY = 'tm-chunk-reload';
const isChunkError = (e) => /Failed to fetch dynamically imported module|Importing a module script failed|error loading dynamically imported module|ChunkLoadError|Loading chunk/i.test(String(e?.message || e));

// V82: remember WHEN we last reloaded (not just "once") — a page that loads fine must not clear the guard,
// otherwise one broken background file reloads the app again and again.
function withRetry(loader) {
  return () => loader().catch((e) => {
    let last = 0;
    try { last = Number(sessionStorage.getItem(RELOAD_KEY)) || 0; } catch { /* private mode */ }
    if (isChunkError(e) && Date.now() - last > 5 * 60 * 1000) {
      try { sessionStorage.setItem(RELOAD_KEY, String(Date.now())); } catch { /* private mode */ }
      window.location.reload();
      return new Promise(() => {});           // keep showing the loader until the reload happens
    }
    throw e;
  });
}

/** React.lazy page with .preload() to fetch it in the background before it is opened. */
export function lazyPage(loader) {
  const load = withRetry(loader);
  let p;
  const once = () => (p ??= load().catch((e) => { p = undefined; throw e; }));
  const C = lazy(once);
  C.preload = () => { once().catch(() => {}); };
  return C;
}

/** Run when the phone is idle (falls back to a short timeout). */
export const whenIdle = (fn) => (window.requestIdleCallback ? window.requestIdleCallback(fn, { timeout: 2500 }) : setTimeout(fn, 1200));
