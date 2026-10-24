// ═══════════════════════════════════════════════════════════
//  TaxMate — onedrive Edge Function
//  Client documents live in the firm's OneDrive (Microsoft Graph).
//  The OneDrive login (refresh token) is stored in public.storage_connection,
//  which only this function can read (service role). Clients never get
//  OneDrive access: every request is checked against the database rules.
//
//  Secrets (Supabase → Edge Functions → Secrets):  MS_CLIENT_ID, MS_CLIENT_SECRET
//
//  Admin:   status, auth_url, exchange, disconnect, purge_client
//  Signed-in admin or client (own files only):
//           start_upload → (browser PUTs the file to OneDrive) → finish_upload,
//           download, delete
// ═══════════════════════════════════════════════════════════
import { createClient } from 'npm:@supabase/supabase-js@2.49.4';

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};
const reply = (body: unknown) => new Response(JSON.stringify(body), { headers: { ...cors, 'Content-Type': 'application/json' } });
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const APP_URLS = ['https://app.taxmatesolutions.com', 'https://taxmate-app.vercel.app'];
const AUTH = 'https://login.microsoftonline.com/consumers/oauth2/v2.0';
const GRAPH = 'https://graph.microsoft.com/v1.0';
const SCOPES = 'offline_access Files.ReadWrite User.Read';
const MAX_BYTES = 25 * 1024 * 1024;

const CAT_FOLDER: Record<string, string> = {
  salary: 'Salary - T-10 - APIT', bank: 'Bank interest - WHT', rent: 'Rent income', business: 'Business records',
  foreign: 'Foreign income', assets: 'Assets and loans', id: 'NIC - ID - TIN', ird: 'IRD letters',
  return: 'Filed return - receipt', ack: 'IRD acknowledgment', voucher: 'IRD payment voucher', other: 'Other',
};
const CLIENT_CATS = ['salary', 'bank', 'rent', 'business', 'foreign', 'assets', 'id', 'ird', 'other'];
const OK_MIMES = ['application/pdf', 'image/jpeg', 'image/png', 'image/webp',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', 'application/vnd.ms-excel',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document', 'application/msword', 'text/csv'];

// OneDrive does not allow  " * : < > ? / \ |  and names ending in a dot or space
const clean = (s: string, max = 80) => String(s || '').replace(/[\u0000-\u001f"*:<>?/\\|#%]+/g, '-').replace(/\s+/g, ' ').trim().replace(/[. ]+$/, '').slice(0, max) || 'Untitled';
const encPath = (p: string) => p.split('/').map(encodeURIComponent).join('/');
const yearFolder = (y: string | null) => (y ? `Y-A ${y.replace('/', '-')}` : 'General');

async function hmac(text: string) {
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(Deno.env.get('MS_CLIENT_SECRET') ?? 'x'), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const sig = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(text));
  return btoa(String.fromCharCode(...new Uint8Array(sig))).replace(/[+/=]/g, (c) => ({ '+': '-', '/': '_', '=': '' }[c] as string));
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors });
  if (req.method !== 'POST') return reply({ error: 'POST only' });

  const svc = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const CLIENT_ID = Deno.env.get('MS_CLIENT_ID') ?? '';
  const CLIENT_SECRET = Deno.env.get('MS_CLIENT_SECRET') ?? '';

  // ── Microsoft token: refresh when needed, keep the newest refresh token ──
  async function token(): Promise<string> {
    const { data: c } = await svc.from('storage_connection').select('*').eq('id', 1).maybeSingle();
    if (!c?.refresh_token) throw new Error('OneDrive is not connected. Admin → Settings → File storage.');
    if (c.access_token && c.access_expires && new Date(c.access_expires).getTime() > Date.now() + 120000) return c.access_token;
    const r = await fetch(`${AUTH}/token`, {
      method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ client_id: CLIENT_ID, client_secret: CLIENT_SECRET, grant_type: 'refresh_token', refresh_token: c.refresh_token, scope: SCOPES }),
    });
    const t = await r.json();
    if (!r.ok || !t.access_token) throw new Error(`OneDrive sign-in expired — please connect OneDrive again in Settings. (${t.error_description?.split('\r')[0] ?? t.error ?? r.status})`);
    await svc.from('storage_connection').update({
      access_token: t.access_token, access_expires: new Date(Date.now() + (t.expires_in ?? 3600) * 1000).toISOString(),
      refresh_token: t.refresh_token ?? c.refresh_token, updated_at: new Date().toISOString(),
    }).eq('id', 1);
    return t.access_token;
  }
  async function graph(path: string, init: RequestInit = {}) {
    const at = await token();
    return fetch(path.startsWith('http') ? path : `${GRAPH}${path}`, { ...init, headers: { Authorization: `Bearer ${at}`, 'Content-Type': 'application/json', ...(init.headers ?? {}) } });
  }
  async function rootFolder() {
    const { data } = await svc.from('storage_connection').select('root_folder').eq('id', 1).maybeSingle();
    return clean(data?.root_folder || 'TaxMate Clients');
  }
  // Create each folder of a path if it is missing ("TaxMate Clients/Name/Y-A 2025-26/Salary")
  async function ensureFolder(path: string) {
    const r = await graph(`/me/drive/root:/${encPath(path)}`);
    if (r.ok) return;
    const parts = path.split('/'); let parent = '';
    for (const name of parts) {
      const cur = parent ? `${parent}/${name}` : name;
      const g = await graph(`/me/drive/root:/${encPath(cur)}`);
      if (!g.ok) {
        const url = parent ? `/me/drive/root:/${encPath(parent)}:/children` : '/me/drive/root/children';
        const m = await graph(url, { method: 'POST', body: JSON.stringify({ name, folder: {}, '@microsoft.graph.conflictBehavior': 'fail' }) });
        if (!m.ok && m.status !== 409) throw new Error(`Could not create the OneDrive folder "${name}" (${m.status}).`);
      }
      parent = cur;
    }
  }
  async function clientFolder(clientId: string) {
    const { data: c } = await svc.from('clients').select('id, full_name, tin, drive_folder').eq('id', clientId).single();
    if (!c) throw new Error('Client not found.');
    if (c.drive_folder) return c.drive_folder as string;
    const folder = `${await rootFolder()}/${clean(`${c.full_name || 'Client'} - ${(c.tin || '').replace(/\D/g, '') || c.id.slice(0, 8)}`)}`;
    await svc.from('clients').update({ drive_folder: folder }).eq('id', clientId);
    return folder;
  }

  try {
    const body = await req.json();
    const action = String(body?.action ?? '');

    // ── Who is calling? ──
    const jwt = (req.headers.get('Authorization') ?? '').replace(/^Bearer\s+/i, '');
    const { data: caller } = await svc.auth.getUser(jwt);
    if (!caller?.user) return reply({ error: 'Please sign in again.' });
    const uid = caller.user.id;
    const asCaller = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_ANON_KEY')!, {
      global: { headers: { Authorization: `Bearer ${jwt}` } }, auth: { persistSession: false, autoRefreshToken: false },
    });
    const { data: stepOk } = await asCaller.rpc('my_second_step_ok');
    if (stepOk !== true) return reply({ error: 'Please sign in again with your PIN or 6-digit code.' });
    const { data: me } = await svc.from('profiles').select('role').eq('id', uid).single();
    const isAdmin = me?.role === 'admin';
    const adminOnly = () => { if (!isAdmin) throw new Error('Admins only.'); };
    const connected = async () => {
      const { data } = await svc.from('storage_connection').select('refresh_token').eq('id', 1).maybeSingle();
      return !!data?.refresh_token && !!CLIENT_ID && !!CLIENT_SECRET;
    };

    // ════ Admin: connect / status ════
    if (action === 'status') {
      adminOnly();
      const { data: c } = await svc.from('storage_connection').select('account_email, account_name, connected_at, root_folder, refresh_token').eq('id', 1).maybeSingle();
      const out: Record<string, unknown> = { configured: !!CLIENT_ID && !!CLIENT_SECRET, connected: !!c?.refresh_token, account_email: c?.account_email, account_name: c?.account_name, connected_at: c?.connected_at, root_folder: c?.root_folder ?? 'TaxMate Clients' };
      if (c?.refresh_token) {
        try {
          const r = await graph('/me/drive?$select=quota,driveType');
          const d = await r.json();
          if (r.ok) out.quota = { used: d.quota?.used, total: d.quota?.total, remaining: d.quota?.remaining, state: d.quota?.state };
          else out.problem = d.error?.message ?? `OneDrive answered ${r.status}`;
        } catch (e) { out.problem = (e as Error).message; }
      }
      return reply(out);
    }
    if (action === 'auth_url') {
      adminOnly();
      if (!CLIENT_ID || !CLIENT_SECRET) return reply({ error: 'Add MS_CLIENT_ID and MS_CLIENT_SECRET in Supabase → Edge Functions → Secrets first.' });
      const redirect = String(body.redirect_uri ?? '');
      if (!APP_URLS.some((u) => redirect === `${u}/admin/settings`)) return reply({ error: 'Wrong return address.' });
      const exp = Date.now() + 15 * 60 * 1000;
      const state = `${uid}.${exp}.${await hmac(`${uid}.${exp}`)}`;
      const q = new URLSearchParams({ client_id: CLIENT_ID, response_type: 'code', redirect_uri: redirect, response_mode: 'query', scope: SCOPES, state, prompt: 'select_account' });
      return reply({ url: `${AUTH}/authorize?${q}` });
    }
    if (action === 'exchange') {
      adminOnly();
      const [sUid, sExp, sSig] = String(body.state ?? '').split('.');
      if (sUid !== uid || Number(sExp) < Date.now() || sSig !== await hmac(`${sUid}.${sExp}`)) return reply({ error: 'This OneDrive sign-in link expired. Please press "Connect OneDrive" again.' });
      const redirect = String(body.redirect_uri ?? '');
      if (!APP_URLS.some((u) => redirect === `${u}/admin/settings`)) return reply({ error: 'Wrong return address.' });
      const r = await fetch(`${AUTH}/token`, {
        method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({ client_id: CLIENT_ID, client_secret: CLIENT_SECRET, grant_type: 'authorization_code', code: String(body.code ?? ''), redirect_uri: redirect, scope: SCOPES }),
      });
      const t = await r.json();
      if (!r.ok || !t.refresh_token) return reply({ error: `Microsoft did not accept the sign-in: ${t.error_description?.split('\r')[0] ?? t.error ?? r.status}` });
      const meR = await fetch(`${GRAPH}/me?$select=displayName,mail,userPrincipalName`, { headers: { Authorization: `Bearer ${t.access_token}` } });
      const meD = meR.ok ? await meR.json() : {};
      const { error } = await svc.from('storage_connection').upsert({
        id: 1, provider: 'onedrive', refresh_token: t.refresh_token, access_token: t.access_token,
        access_expires: new Date(Date.now() + (t.expires_in ?? 3600) * 1000).toISOString(),
        account_email: meD.mail ?? meD.userPrincipalName ?? null, account_name: meD.displayName ?? null,
        connected_by: uid, connected_at: new Date().toISOString(), updated_at: new Date().toISOString(),
      });
      if (error) return reply({ error: error.message });
      await ensureFolder(await rootFolder());
      return reply({ ok: true, account_email: meD.mail ?? meD.userPrincipalName, account_name: meD.displayName });
    }
    if (action === 'disconnect') {
      adminOnly();
      await svc.from('storage_connection').update({ refresh_token: null, access_token: null, access_expires: null, updated_at: new Date().toISOString() }).eq('id', 1);
      return reply({ ok: true });
    }

    // ════ Upload: start (create OneDrive upload link) ════
    if (action === 'start_upload') {
      const clientId = String(body.client_id ?? '');
      if (!UUID_RE.test(clientId)) return reply({ error: 'Client missing.' });
      if (!(await connected())) return reply({ provider: 'supabase' });       // OneDrive not set up → app uses the old storage
      const category = String(body.category ?? 'other');
      if (!CAT_FOLDER[category]) return reply({ error: 'Unknown document type.' });
      if (!isAdmin) {
        const { data: mine } = await asCaller.rpc('my_client_id');
        if (mine !== clientId) return reply({ error: 'Not allowed.' });
        const { data: feats } = await asCaller.rpc('my_portal_features');
        if (feats?.documents === false) return reply({ error: 'Documents are switched off for your account.' });
        if (!CLIENT_CATS.includes(category)) return reply({ error: 'Not allowed.' });
        const { count } = await svc.from('client_documents').select('id', { count: 'exact', head: true }).eq('client_id', clientId);
        if ((count ?? 0) >= 1000) return reply({ error: 'Your document space is full. Please contact TaxMate.' });
      }
      const size = Number(body.size ?? 0), mime = String(body.mime ?? '');
      if (!(size > 0) || size > MAX_BYTES) return reply({ error: 'Files can be up to 25 MB.' });
      if (!OK_MIMES.includes(mime)) return reply({ error: 'This file type is not allowed (PDF, photo, Excel, Word or CSV only).' });
      const year = body.year && /^\d{4}\/\d{2}$/.test(body.year) ? String(body.year) : null;
      const folder = `${await clientFolder(clientId)}/${yearFolder(year)}/${CAT_FOLDER[category]}`;
      await ensureFolder(folder);
      const fileName = clean(String(body.file_name ?? 'file'), 120);
      const s = await graph(`/me/drive/root:/${encPath(`${folder}/${fileName}`)}:/createUploadSession`, {
        method: 'POST', body: JSON.stringify({ item: { '@microsoft.graph.conflictBehavior': 'rename' } }),
      });
      const sd = await s.json();
      if (!s.ok || !sd.uploadUrl) return reply({ error: `OneDrive did not accept the upload (${sd.error?.message ?? s.status}).` });
      const { data: up, error } = await svc.from('drive_uploads').insert({
        client_id: clientId, user_id: uid, role: isAdmin ? 'admin' : 'client', year, category,
        title: String(body.title ?? fileName).slice(0, 150) || fileName, note: body.note ? String(body.note).slice(0, 500) : null,
        mime, size, folder_path: folder, file_name: fileName,
      }).select('id').single();
      if (error) return reply({ error: error.message });
      return reply({ provider: 'onedrive', upload_id: up.id, upload_url: sd.uploadUrl });
    }

    // ════ Upload: finish (check the file landed in the right folder, then register it) ════
    if (action === 'finish_upload') {
      const { data: up } = await svc.from('drive_uploads').select('*').eq('id', String(body.upload_id ?? '')).maybeSingle();
      if (!up || up.user_id !== uid) return reply({ error: 'Upload not found — please try again.' });
      const itemId = String(body.item_id ?? '');
      const r = await graph(`/me/drive/items/${encodeURIComponent(itemId)}?$select=id,name,size,file,parentReference`);
      const it = await r.json();
      const parentPath = decodeURIComponent(String(it?.parentReference?.path ?? '')).replace(/^\/drive\/root:\/?/, '');
      if (!r.ok || !it.file || parentPath !== up.folder_path) return reply({ error: 'The uploaded file could not be checked — please try again.' });
      const { data: row, error } = await svc.from('client_documents').insert({
        client_id: up.client_id, year: up.year, category: up.category, title: up.title, note: up.note,
        path: `${up.client_id}/onedrive/${it.id}`, size: it.size ?? up.size, mime: it.file?.mimeType ?? up.mime,
        uploaded_by: uid, uploaded_role: up.role, storage: 'onedrive', drive_item_id: it.id,
      }).select().single();
      await svc.from('drive_uploads').delete().eq('id', up.id);
      if (error) return reply({ error: error.message });
      return reply({ row });
    }

    // ════ Download link (short-lived) — the database decides who may see the file ════
    if (action === 'download') {
      const { data: doc } = await asCaller.from('client_documents').select('id, storage, drive_item_id, title').eq('id', String(body.doc_id ?? '')).maybeSingle();
      if (!doc) return reply({ error: 'File not found.' });
      if (doc.storage !== 'onedrive') return reply({ error: 'This file is not in OneDrive.' });
      const r = await graph(`/me/drive/items/${encodeURIComponent(doc.drive_item_id)}?$select=id,name,@microsoft.graph.downloadUrl`);
      const d = await r.json();
      const url = d['@microsoft.graph.downloadUrl'];
      if (!r.ok || !url) return reply({ error: r.status === 404 ? 'This file was removed from OneDrive.' : `OneDrive: ${d.error?.message ?? r.status}` });
      return reply({ url, name: d.name });
    }

    // ════ Delete (goes to the OneDrive recycle bin) ════
    if (action === 'delete') {
      const ids = (Array.isArray(body.doc_ids) ? body.doc_ids : []).map(String).filter((x: string) => UUID_RE.test(x)).slice(0, 200);
      const { data: docs } = await asCaller.from('client_documents').select('id, storage, drive_item_id, uploaded_by, uploaded_role').in('id', ids);
      const allowed = (docs ?? []).filter((d) => isAdmin || (d.uploaded_role === 'client' && d.uploaded_by === uid));
      if (allowed.length !== ids.length) return reply({ error: 'You can only delete files you uploaded.' });
      for (const d of allowed) {
        if (d.storage === 'onedrive' && d.drive_item_id) {
          const r = await graph(`/me/drive/items/${encodeURIComponent(d.drive_item_id)}`, { method: 'DELETE' });
          if (!r.ok && r.status !== 404) return reply({ error: `OneDrive could not delete a file (${r.status}).` });
        }
      }
      const { error } = await svc.from('client_documents').delete().in('id', allowed.map((d) => d.id));
      if (error) return reply({ error: error.message });
      return reply({ ok: true, deleted: allowed.length });
    }

    // ════ Admin: client deleted permanently → move their OneDrive folder to the recycle bin ════
    if (action === 'purge_client') {
      adminOnly();
      const clientId = String(body.client_id ?? '');
      const { data: c } = await svc.from('clients').select('drive_folder').eq('id', clientId).maybeSingle();
      if (c?.drive_folder && (await connected())) {
        const r = await graph(`/me/drive/root:/${encPath(c.drive_folder)}`, { method: 'DELETE' });
        if (!r.ok && r.status !== 404) return reply({ error: `OneDrive could not remove the client folder (${r.status}).` });
      }
      return reply({ ok: true });
    }

    return reply({ error: 'Unknown action.' });
  } catch (e) {
    return reply({ error: (e as Error).message ?? 'Something went wrong.' });
  }
});
