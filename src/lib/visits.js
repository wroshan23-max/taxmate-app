// ═══════════════════════════════════════════════════════════
//  Website visitors — counts every page opened (also by people who are not signed in)
//  Anonymous: a random id in this browser; no name, phone, IP or cookie. Admins are not counted (server side).
//  Fire-and-forget: never blocks or breaks a page.
// ═══════════════════════════════════════════════════════════
import { supabase } from './supabase';

const rid = () => {
  try { return crypto.randomUUID().replace(/-/g, ''); } catch { return (Math.random().toString(36) + Math.random().toString(36)).replace(/[^a-z0-9]/g, '').slice(0, 24); }
};
const store = (s, k, make) => {
  try { let v = s.getItem(k); if (!v) { v = make(); s.setItem(k, v); } return v; } catch { return make(); }
};
const visitorId = () => store(localStorage, 'tm_vid', rid);
const sessionId = () => store(sessionStorage, 'tm_sid', rid);
const slug = (v) => String(v || '').toLowerCase().replace(/[^a-z0-9._-]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40);

const BOT = /bot|crawl|spider|slurp|preview|facebookexternalhit|whatsapp\/|headless|lighthouse/i;
export const SOURCES = ['facebook', 'whatsapp', 'instagram', 'tiktok', 'youtube', 'linkedin', 'google', 'email', 'sms', 'flyer', 'qr', 'other'];

// Where did this visit come from? Tracking links (?src=facebook&c=iit-deadline) win; then ad click ids; then the referring site.
function detectSource() {
  const q = new URLSearchParams(window.location.search);
  const ref = (() => { try { return document.referrer ? new URL(document.referrer).hostname.replace(/^www\./, '') : ''; } catch { return ''; } })();
  const own = ref && ref === window.location.hostname.replace(/^www\./, '');
  let src = slug(q.get('src') || q.get('utm_source'));
  if (!src) {
    if (q.get('fbclid')) src = 'facebook';
    else if (q.get('gclid')) src = 'google';
    else if (/(^|\.)(facebook\.com|fb\.com|fb\.me|messenger\.com)$/.test(ref)) src = 'facebook';
    else if (/(^|\.)instagram\.com$/.test(ref)) src = 'instagram';
    else if (/(^|\.)(whatsapp\.com|wa\.me)$/.test(ref)) src = 'whatsapp';
    else if (/(^|\.)(google\.[a-z.]+)$/.test(ref)) src = 'google';
    else if (/(^|\.)(youtube\.com|youtu\.be)$/.test(ref)) src = 'youtube';
    else if (/(^|\.)tiktok\.com$/.test(ref)) src = 'tiktok';
    else if (/(^|\.)(linkedin\.com|lnkd\.in)$/.test(ref)) src = 'linkedin';
    else if (/(^|\.)(bing\.com|yahoo\.com|duckduckgo\.com)$/.test(ref)) src = 'search';
    else if (/taxmatesolutions\.com$/.test(ref) && !own) src = 'website';
    else if (ref && !own) src = 'other';
  }
  return { src, campaign: slug(q.get('c') || q.get('utm_campaign')) || null, ref: own ? '' : ref };
}

// The source of this browsing session = how it started (kept while the person clicks around)
function sessionSource() {
  const d = detectSource();
  try {
    const saved = JSON.parse(sessionStorage.getItem('tm_src') || 'null');
    if (d.src) { sessionStorage.setItem('tm_src', JSON.stringify(d)); return d; }
    if (saved) return saved;
    const first = { src: 'direct', campaign: null, ref: d.ref };
    sessionStorage.setItem('tm_src', JSON.stringify(first));
    return first;
  } catch { return d.src ? d : { src: 'direct', campaign: null, ref: d.ref }; }
}

const device = () => {
  const ua = navigator.userAgent || '';
  if (/iPad|Tablet|PlayBook|Silk|(Android(?!.*Mobile))/i.test(ua)) return 'tablet';
  return /Mobi|Android|iPhone|iPod|Opera Mini|IEMobile/i.test(ua) ? 'mobile' : 'desktop';
};

// Private links carry a token: keep only the kind of page
export function cleanPath(p) {
  const path = String(p || '/').split(/[?#]/)[0].replace(/\/+$/, '') || '/';
  const m = path.match(/^\/(share|invite|reset|register|verify)\//);
  if (m) return `/${m[1]}/:token`;
  return path.replace(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi, ':id').replace(/[^A-Za-z0-9/_:-]/g, '').slice(0, 80) || '/';
}

let last = '';
export function trackVisit(pathname, event = 'view') {
  try {
    if (BOT.test(navigator.userAgent || '')) return;
    const path = cleanPath(pathname);
    if (path.startsWith('/admin')) return;               // TaxMate's own pages
    if (event === 'view' && path === last) return;       // same page re-rendered
    if (event === 'view') last = path;
    const s = sessionSource();
    supabase.rpc('log_visit', {
      p_visitor: visitorId(), p_session: sessionId(), p_path: path, p_source: s.src, p_campaign: s.campaign,
      p_referrer: s.ref || null, p_device: device(), p_event: event,
    }).then(() => {}, () => {});
  } catch { /* never break the page */ }
}

// ── Admin: labels + tracking-link builder ────────────────
export const SOURCE_LABEL = {
  facebook: ['📘', 'Facebook'], whatsapp: ['🟢', 'WhatsApp'], instagram: ['📸', 'Instagram'], tiktok: ['🎵', 'TikTok'],
  youtube: ['▶️', 'YouTube'], linkedin: ['💼', 'LinkedIn'], google: ['🔎', 'Google'], search: ['🔎', 'Other search'],
  email: ['✉️', 'Email'], sms: ['💬', 'SMS'], flyer: ['📄', 'Flyer'], qr: ['🔳', 'QR code'], website: ['🌐', 'TaxMate website'],
  direct: ['➡️', 'Direct / typed / app'], other: ['🔗', 'Other sites'],
};
export const sourceLabel = (s) => SOURCE_LABEL[s] ?? ['🏷️', s];
export const PAGE_LABEL = {
  '/': 'Home', '/login': 'Login page', '/ird-codes': 'IRD payment codes (public)', '/calculator': 'Tax calculator (public)',
  '/tax-calculator': 'Tax calculator (public)', '/share/:token': 'Shared document link', '/invite/:token': 'Portal invite link',
  '/register/:token': 'Personal registration link', '/reset/:token': 'Password reset', '/verify/:token': 'Letter verification',
  '/client': 'Client dashboard',
};
export const pageLabel = (p) => PAGE_LABEL[p] ?? (p.startsWith('/join/') ? `Join link · ${p.slice(6)}` : p.startsWith('/client/') ? `Client · ${p.slice(8)}` : p);
export function trackingLink(page, src, campaign) {
  const u = new URL(page || '/', window.location.origin);
  if (src) u.searchParams.set('src', slug(src));
  if (campaign) u.searchParams.set('c', slug(campaign));
  return u.toString();
}
