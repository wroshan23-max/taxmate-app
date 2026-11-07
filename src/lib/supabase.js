import { createClient } from '@supabase/supabase-js';

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL;
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY;

// ═══ V53: Admin "View as client" (read only) ═══════════════
// An admin opens /client?view_as=<client id> in a new tab. This tab then sends the header
// x-view-as on database reads; the database shows that client's data only to a real admin,
// and refuses every change. Here we also stop changes before they leave the browser.
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
function detectViewAs() {
  try {
    if (typeof window === 'undefined') return null;
    const q = new URLSearchParams(window.location.search).get('view_as');
    if (q && UUID_RE.test(q) && window.location.pathname.startsWith('/client')) {
      sessionStorage.setItem('tm_view_as', q.toLowerCase());
      return q.toLowerCase();
    }
    const s = sessionStorage.getItem('tm_view_as');
    return s && UUID_RE.test(s) ? s : null;
  } catch { return null; }
}
export const VIEW_AS = detectViewAs();
export const PREVIEW_MSG = 'Preview only — nothing can be changed while viewing as a client.';

export function exitViewAs() {
  try { sessionStorage.removeItem('tm_view_as'); } catch { /* ignore */ }
  const id = VIEW_AS;
  // this tab was opened from the client page — close it if we can, otherwise go back there
  try { window.close(); } catch { /* ignore */ }
  setTimeout(() => { window.location.href = id ? `/admin/clients/${id}` : '/admin'; }, 150);
}

// Read functions a preview may call (all STABLE in the database — it checks again)
const READ_RPC = new Set([
  'my_portal_features', 'my_plans', 'my_addons', 'my_payroll_access', 'my_unread_messages', 'my_unread_notifications',
  'my_payment_options', 'my_ird_details', 'my_email_prefs', 'my_referrals', 'my_summary_letter', 'my_tax_review',
  'my_calc_credits', 'my_login_security', 'my_second_step_ok', 'storage_usage', '_payroll_on',
]);
// Background writes that would only mark things as seen / count visits — skipped quietly
const SILENT_RPC = new Set(['log_visit', 'log_activity', 'mark_my_messages_read', 'mark_my_notifications_read']);
const FN_READ = { onedrive: ['status', 'download'], payhere: ['status'] };

const blocked = () => new Response(JSON.stringify({ message: PREVIEW_MSG, code: 'VIEW_AS', error: PREVIEW_MSG }),
  { status: 403, headers: { 'Content-Type': 'application/json' } });
const silent = () => new Response(null, { status: 204 });

function bodyAction(body) {
  try { return typeof body === 'string' ? JSON.parse(body)?.action : null; } catch { return null; }
}

async function previewFetch(input, init = {}) {
  const req = typeof input === 'string' || input instanceof URL ? null : input;
  const url = new URL(req ? req.url : String(input));
  const method = String(init.method || req?.method || 'GET').toUpperCase();
  const read = method === 'GET' || method === 'HEAD';
  const p = url.pathname;

  if (p.startsWith('/rest/v1/')) {
    const rpc = p.match(/^\/rest\/v1\/rpc\/([A-Za-z0-9_]+)/)?.[1];
    if (rpc && SILENT_RPC.has(rpc)) return silent();
    if (!read && !(rpc && READ_RPC.has(rpc))) return blocked();
    const headers = new Headers(init.headers || req?.headers || undefined);
    headers.set('x-view-as', VIEW_AS);
    return fetch(req ?? url.toString(), { ...init, headers });
  }
  if (p.startsWith('/auth/v1/')) {
    if (read) return fetch(input, init);
    if (p.endsWith('/token') && url.searchParams.get('grant_type') === 'refresh_token') return fetch(input, init);
    if (p.endsWith('/logout')) return silent();
    return blocked();
  }
  if (p.startsWith('/storage/v1/')) {
    if (read || /^\/storage\/v1\/object\/sign\//.test(p)) return fetch(input, init);
    return blocked();
  }
  if (p.startsWith('/functions/v1/')) {
    const fn = p.split('/')[3];
    if ((FN_READ[fn] || []).includes(bodyAction(init.body))) return fetch(input, init);
    return blocked();
  }
  return read ? fetch(input, init) : blocked();
}

export const supabase = createClient(supabaseUrl, supabaseAnonKey, VIEW_AS ? { global: { fetch: previewFetch } } : undefined);

// Live updates (realtime) are not used in a preview — a quiet stand-in channel
if (VIEW_AS) {
  const fake = { on() { return fake; }, subscribe() { return fake; }, unsubscribe() { return Promise.resolve('ok'); }, send() { return Promise.resolve('ok'); }, track() { return Promise.resolve('ok'); } };
  supabase.channel = () => fake;
  supabase.removeChannel = () => Promise.resolve('ok');
}

// Format currency
export const fmtRs = (n) =>
  'Rs. ' + Math.round(n || 0).toLocaleString('en-LK');

// Format date
export const fmtDate = (d) =>
  d ? new Date(d).toLocaleDateString('en-LK', { day: '2-digit', month: 'short', year: 'numeric' }) : '—';
