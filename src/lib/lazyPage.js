import { lazy } from 'react';

// After a new version is deployed, a phone that still has the old app open asks for page files
// that no longer exist. Reload once to pick up the new version instead of showing a blank page.
const RELOAD_KEY = 'tm-chunk-reload';
const isChunkError = (e) => /Failed to fetch dynamically imported module|Importing a module script failed|error loading dynamically imported module|ChunkLoadError|Loading chunk/i.test(String(e?.message || e));

function withRetry(loader) {
  return () => loader().then((m) => {
    try { sessionStorage.removeItem(RELOAD_KEY); } catch { /* private mode */ }
    return m;
  }).catch((e) => {
    let reloaded = false;
    try { reloaded = sessionStorage.getItem(RELOAD_KEY) === '1'; } catch { /* private mode */ }
    if (isChunkError(e) && !reloaded) {
      try { sessionStorage.setItem(RELOAD_KEY, '1'); } catch { /* private mode */ }
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
