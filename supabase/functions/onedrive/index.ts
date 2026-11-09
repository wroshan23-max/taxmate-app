// ═══════════════════════════════════════════════════════════
//  TaxMate — onedrive Edge Function
//  Client documents live in the firm's OneDrive (Microsoft Graph).
//  The OneDrive login (refresh token) is stored in public.storage_connection,
//  which only this function can read (service role). Clients never get
//  OneDrive access: every request is checked against the database rules.
//
//  Secrets (Supabase → Edge Functions → Secrets):  MS_CLIENT_ID, MS_CLIENT_SECRET
//
//  Admin:   status, auth_url, exchange, disconnect, purge_client, backup_now
//  pg_cron (header x-cron-key): backup_cron — nightly backup of the app's data to OneDrive (V52)
//  Signed-in admin or client (own files only):
//           start_upload → (browser PUTs the file to OneDrive) → finish_upload,
//           download, delete
// ═══════════════════════════════════════════════════════════
import { createClient } from 'npm:@supabase/supabase-js@2.49.4';
import { zipSync, strToU8 } from 'npm:fflate@0.8.2';

declare const EdgeRuntime: { waitUntil(p: Promise<unknown>): void } | undefined;

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-cron-key',
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

// ═══ Backups (V52) ═════════════════════════════════════════
const BACKUP_ROOT = 'TaxMate Backups';
// Tables in the Excel copy (the .json.gz has every table)
const XLSX_SHEETS: [string, string][] = [
  ['clients', 'Clients'], ['invoices', 'Invoices'], ['invoice_items', 'Invoice items'], ['payments', 'Payments'],
  ['tax_returns', 'Tax returns'], ['iit_calculations', 'Calculations'], ['subscriptions', 'Plans'], ['service_addons', 'Add-on services'],
  ['client_documents', 'Documents'], ['service_requests', 'Service requests'], ['summary_letters', 'Summary letters'],
  ['payroll_employees', 'Payroll staff'], ['payroll_runs', 'Payroll months'], ['asset_statements', 'Assets & liabilities'],
  ['income_sheets', 'Monthly income'], ['profiles', 'Users'],
];
const slNow = () => new Date(Date.now() + 5.5 * 3600 * 1000).toISOString();   // Sri Lanka time, as an ISO string
async function gzip(text: string) {
  const stream = new Blob([text]).stream().pipeThrough(new CompressionStream('gzip'));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}
// A small .xlsx writer (inline strings, bold frozen header row) — no big library needed
function buildXlsx(sheets: { name: string; rows: Record<string, unknown>[] }[]) {
  const esc = (v: string) => v.replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\ufffe\uffff]/g, '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  const col = (i: number) => { let out = ''; let n = i + 1; while (n > 0) { const m = (n - 1) % 26; out = String.fromCharCode(65 + m) + out; n = Math.floor((n - 1) / 26); } return out; };
  const cell = (v: unknown, ref: string) => {
    if (v === null || v === undefined || v === '') return '';
    if (typeof v === 'number' && Number.isFinite(v)) return `<c r="${ref}"><v>${v}</v></c>`;
    if (typeof v === 'boolean') return `<c r="${ref}" t="b"><v>${v ? 1 : 0}</v></c>`;
    let t = typeof v === 'object' ? JSON.stringify(v) : String(v);
    if (t.length > 32000) t = `${t.slice(0, 32000)}…`;
    return `<c r="${ref}" t="inlineStr"><is><t xml:space="preserve">${esc(t)}</t></is></c>`;
  };
  const used = new Set<string>();
  const names = sheets.map((sh) => {
    let nm = sh.name.replace(/[\[\]:*?/\\]/g, ' ').slice(0, 31) || 'Sheet'; let k = 2;
    while (used.has(nm.toLowerCase())) nm = `${nm.slice(0, 28)} ${k++}`;
    used.add(nm.toLowerCase()); return nm;
  });
  const files: Record<string, Uint8Array> = {};
  sheets.forEach((sh, si) => {
    const keys: string[] = []; const seen = new Set<string>();
    for (const r of sh.rows) for (const key of Object.keys(r)) if (!seen.has(key)) { seen.add(key); keys.push(key); }
    const rowsXml: string[] = [`<row r="1">${keys.map((key, i) => `<c r="${col(i)}1" t="inlineStr" s="1"><is><t>${esc(key)}</t></is></c>`).join('')}</row>`];
    sh.rows.forEach((r, ri) => { rowsXml.push(`<row r="${ri + 2}">${keys.map((key, i) => cell(r[key], `${col(i)}${ri + 2}`)).join('')}</row>`); });
    files[`xl/worksheets/sheet${si + 1}.xml`] = strToU8(`<?xml version="1.0" encoding="UTF-8" standalone="yes"?><worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetViews><sheetView workbookViewId="0"><pane ySplit="1" topLeftCell="A2" activePane="bottomLeft" state="frozen"/></sheetView></sheetViews><sheetData>${rowsXml.join('')}</sheetData></worksheet>`);
  });
  files['[Content_Types].xml'] = strToU8(`<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>${sheets.map((_, i) => `<Override PartName="/xl/worksheets/sheet${i + 1}.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>`).join('')}</Types>`);
  files['_rels/.rels'] = strToU8(`<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>`);
  files['xl/workbook.xml'] = strToU8(`<?xml version="1.0" encoding="UTF-8" standalone="yes"?><workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets>${names.map((nm, i) => `<sheet name="${esc(nm)}" sheetId="${i + 1}" r:id="rId${i + 1}"/>`).join('')}</sheets></workbook>`);
  files['xl/_rels/workbook.xml.rels'] = strToU8(`<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${sheets.map((_, i) => `<Relationship Id="rId${i + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet${i + 1}.xml"/>`).join('')}<Relationship Id="rId${sheets.length + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships>`);
  files['xl/styles.xml'] = strToU8(`<?xml version="1.0" encoding="UTF-8" standalone="yes"?><styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><fonts count="2"><font><sz val="11"/><name val="Calibri"/></font><font><b/><sz val="11"/><name val="Calibri"/></font></fonts><fills count="2"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill></fills><borders count="1"><border><left/><right/><top/><bottom/><diagonal/></border></borders><cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs><cellXfs count="2"><xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/><xf numFmtId="0" fontId="1" fillId="0" borderId="0" xfId="0" applyFont="1"/></cellXfs><cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles></styleSheet>`);
  return zipSync(files, { level: 6 });
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

  const isConnected = async () => {
    const { data } = await svc.from('storage_connection').select('refresh_token').eq('id', 1).maybeSingle();
    return !!data?.refresh_token && !!CLIENT_ID && !!CLIENT_SECRET;
  };

  // ═══ Backups (V52) ═══
  const folderCache = new Set<string>();
  async function ensureFolderCached(path: string) { if (folderCache.has(path)) return; await ensureFolder(path); folderCache.add(path); }
  // Upload bytes to a OneDrive path (replaces a file of the same name)
  async function putFile(path: string, data: Uint8Array | Blob, mime = 'application/octet-stream') {
    const size = data instanceof Blob ? data.size : data.byteLength;
    if (size <= 4 * 1024 * 1024) {
      const r = await graph(`/me/drive/root:/${encPath(path)}:/content`, { method: 'PUT', headers: { 'Content-Type': mime }, body: data });
      const d = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(`OneDrive upload failed for ${path.split('/').pop()} (${d.error?.message ?? r.status}).`);
      return d;
    }
    const s = await graph(`/me/drive/root:/${encPath(path)}:/createUploadSession`, { method: 'POST', body: JSON.stringify({ item: { '@microsoft.graph.conflictBehavior': 'replace' } }) });
    const sd = await s.json();
    if (!s.ok || !sd.uploadUrl) throw new Error(`OneDrive did not accept ${path.split('/').pop()} (${sd.error?.message ?? s.status}).`);
    const buf = data instanceof Blob ? new Uint8Array(await data.arrayBuffer()) : data;
    const CHUNK = 320 * 1024 * 30;   // ~9.4 MB, a multiple of 320 KiB as OneDrive requires
    let last: Record<string, unknown> = {};
    for (let i = 0; i < size; i += CHUNK) {
      const end = Math.min(size, i + CHUNK);
      const r = await fetch(sd.uploadUrl, { method: 'PUT', headers: { 'Content-Length': String(end - i), 'Content-Range': `bytes ${i}-${end - 1}/${size}` }, body: buf.slice(i, end) });
      if (!r.ok) throw new Error(`OneDrive upload stopped for ${path.split('/').pop()} (${r.status}).`);
      if (r.status !== 202) last = await r.json().catch(() => ({}));
    }
    return last;
  }
  // Keep the newest `keep` date folders (2026-10-31 / 2026-10) in a folder; older ones go to the recycle bin
  async function pruneFolders(folder: string, keep: number) {
    const r = await graph(`/me/drive/root:/${encPath(folder)}:/children?$select=id,name,folder&$top=999`);
    if (!r.ok) return 0;
    const d = await r.json();
    const dated = (d.value ?? []).filter((x: { name: string; folder?: unknown }) => x.folder && /^\d{4}-\d{2}(-\d{2})?$/.test(x.name))
      .sort((a: { name: string }, b: { name: string }) => b.name.localeCompare(a.name));
    let n = 0;
    for (const it of dated.slice(Math.max(1, keep))) { const x = await graph(`/me/drive/items/${encodeURIComponent(it.id)}`, { method: 'DELETE' }); if (x.ok || x.status === 404) n++; }
    return n;
  }
  async function listBucket(bucket: string, prefix = '', depth = 0): Promise<{ path: string; size: number; updated: string }[]> {
    const out: { path: string; size: number; updated: string }[] = [];
    if (depth > 8) return out;
    for (let offset = 0; ; offset += 1000) {
      const { data, error } = await svc.storage.from(bucket).list(prefix, { limit: 1000, offset, sortBy: { column: 'name', order: 'asc' } });
      if (error) throw new Error(`Could not list ${bucket}: ${error.message}`);
      for (const it of data ?? []) {
        const p = prefix ? `${prefix}/${it.name}` : it.name;
        if (it.id === null) out.push(...await listBucket(bucket, p, depth + 1));
        else if (it.name !== '.emptyFolderPlaceholder') out.push({ path: p, size: Number(it.metadata?.size ?? 0), updated: String(it.updated_at ?? it.created_at ?? '') });
      }
      if ((data ?? []).length < 1000) break;
    }
    return out;
  }

  async function runBackup(id: number) {
    const t0 = Date.now();
    const { data: st } = await svc.from('app_settings').select('value').eq('key', 'backup').maybeSingle();
    const cfg = { keep_daily: 30, keep_monthly: 12, files: true, ...(st?.value ?? {}) };
    const now = slNow(), day = now.slice(0, 10), stamp = `${day}-${now.slice(11, 13)}${now.slice(14, 16)}`;

    // 1. Every table (except secrets) + the list of logins
    const { data: names, error: e1 } = await svc.rpc('_backup_tables');
    if (e1) throw new Error(`Could not list tables: ${e1.message}`);
    const tables: Record<string, Record<string, unknown>[]> = {};
    let rows = 0;
    for (const t of (names ?? []) as string[]) {
      const { data, error } = await svc.rpc('_backup_table', { p_name: t });
      if (error) throw new Error(`Could not read ${t}: ${error.message}`);
      tables[t] = (data ?? []) as Record<string, unknown>[]; rows += tables[t].length;
    }
    const users: Record<string, unknown>[] = [];
    for (let page = 1; page < 50; page++) {
      const { data, error } = await svc.auth.admin.listUsers({ page, perPage: 1000 });
      if (error) break;
      for (const u of data.users) users.push({ id: u.id, email: u.email, phone: u.phone, created_at: u.created_at, last_sign_in_at: u.last_sign_in_at, email_confirmed_at: u.email_confirmed_at });
      if (data.users.length < 1000) break;
    }
    const counts = Object.fromEntries(Object.entries(tables).map(([k, v]) => [k, v.length]));
    const json = JSON.stringify({ app: 'TaxMate Solutions', format: 'taxmate-backup-1', created_at: new Date().toISOString(), created_sl: now.slice(0, 16).replace('T', ' '),
      project: 'qipehxixvulvrubjifvi', counts, auth_users: users, tables });
    const gz = await gzip(json);
    const summary = [
      { Item: 'Backup made (Sri Lanka time)', Value: now.slice(0, 16).replace('T', ' ') },
      { Item: 'Tables', Value: Object.keys(tables).length }, { Item: 'Rows', Value: rows }, { Item: 'App logins', Value: users.length },
      { Item: 'Restore file', Value: `TaxMate-backup-${stamp}.json.gz (same folder)` },
      { Item: 'Not included', Value: 'OneDrive sign-in, login PINs, encrypted RAMIS PIN/SSID, invite/reset links' },
      ...Object.entries(counts).map(([k, v]) => ({ Item: `Rows in ${k}`, Value: v })),
    ];
    const xlsx = buildXlsx([{ name: 'Summary', rows: summary }, ...XLSX_SHEETS.filter(([t]) => tables[t]).map(([t, label]) => ({ name: label, rows: tables[t] }))]);

    // 2. Upload to Daily/<date>, and the first backup of each month also to Monthly/<yyyy-mm>
    const dailyFolder = `${BACKUP_ROOT}/Daily/${day}`;
    await ensureFolderCached(dailyFolder);
    await putFile(`${dailyFolder}/TaxMate-backup-${stamp}.json.gz`, gz, 'application/gzip');
    await putFile(`${dailyFolder}/TaxMate-data-${stamp}.xlsx`, xlsx, 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    const monthFolder = `${BACKUP_ROOT}/Monthly/${day.slice(0, 7)}`;
    if (!(await graph(`/me/drive/root:/${encPath(monthFolder)}`)).ok) {
      await ensureFolderCached(monthFolder);
      await putFile(`${monthFolder}/TaxMate-backup-${stamp}.json.gz`, gz, 'application/gzip');
      await putFile(`${monthFolder}/TaxMate-data-${stamp}.xlsx`, xlsx, 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    }
    const fi = await graph(`/me/drive/root:/${encPath(dailyFolder)}?$select=webUrl`);
    const webUrl = fi.ok ? (await fi.json()).webUrl ?? null : null;
    await svc.from('backups').update({ tables: Object.keys(tables).length, rows, bytes: gz.byteLength, xlsx_bytes: xlsx.byteLength, folder: dailyFolder, web_url: webUrl }).eq('id', id);

    // 3. App-storage files: copy new / changed ones (time-boxed; the rest continue in the next backup)
    let copied = 0, copiedBytes = 0, pending = 0;
    if (cfg.files !== false) {
      const { data: buckets } = await svc.storage.listBuckets();
      const { data: logRows } = await svc.from('backup_file_log').select('bucket, path, src_updated');
      const done = new Map((logRows ?? []).map((r) => [`${r.bucket}/${r.path}`, r.src_updated]));
      for (const b of buckets ?? []) {
        const files = await listBucket(b.name);
        for (const f of files) {
          if (done.get(`${b.name}/${f.path}`) === f.updated) continue;
          if (Date.now() - t0 > 100000 || copied >= 300) { pending++; continue; }
          const { data: blob, error } = await svc.storage.from(b.name).download(f.path);
          if (error || !blob) { pending++; continue; }
          const parts = f.path.split('/').map((x) => clean(x, 120));
          const target = `${BACKUP_ROOT}/App files/${clean(b.name)}/${parts.join('/')}`;
          await ensureFolderCached(target.split('/').slice(0, -1).join('/'));
          const it = await putFile(target, blob, blob.type || 'application/octet-stream');
          await svc.from('backup_file_log').upsert({ bucket: b.name, path: f.path, size: f.size || blob.size, src_updated: f.updated, drive_item_id: (it as { id?: string })?.id ?? null, copied_at: new Date().toISOString() });
          copied++; copiedBytes += blob.size;
        }
      }
    }

    // 4. Old backups → recycle bin
    await pruneFolders(`${BACKUP_ROOT}/Daily`, Number(cfg.keep_daily) || 30);
    await pruneFolders(`${BACKUP_ROOT}/Monthly`, Number(cfg.keep_monthly) || 12);

    await svc.from('backups').update({ status: pending ? 'partial' : 'ok', finished_at: new Date().toISOString(), files_copied: copied, files_bytes: copiedBytes, files_pending: pending }).eq('id', id);
  }

  async function startBackup(kind: 'auto' | 'manual', by: string | null) {
    await svc.from('backups').update({ status: 'error', error: 'Stopped — it took too long.', finished_at: new Date().toISOString() })
      .eq('status', 'running').lt('started_at', new Date(Date.now() - 15 * 60000).toISOString());
    const { data: busy } = await svc.from('backups').select('id').eq('status', 'running').limit(1);
    if (busy?.length) return { error: 'A backup is already running — please wait a few minutes.' };
    if (!(await isConnected())) {
      await svc.from('backups').insert({ kind, started_by: by, status: 'error', finished_at: new Date().toISOString(), error: 'OneDrive is not connected (Settings → File storage).' });
      return { error: 'Connect OneDrive first (Settings → File storage).' };
    }
    const { data: row, error } = await svc.from('backups').insert({ kind, started_by: by }).select('id').single();
    if (error || !row) return { error: error?.message ?? 'Could not start the backup.' };
    const job = runBackup(row.id).catch(async (e) => {
      await svc.from('backups').update({ status: 'error', error: String((e as Error)?.message ?? e).slice(0, 500), finished_at: new Date().toISOString() }).eq('id', row.id);
    });
    if (typeof EdgeRuntime !== 'undefined' && EdgeRuntime?.waitUntil) EdgeRuntime.waitUntil(job); else await job;
    return { ok: true, id: row.id };
  }

  try {
    const body = await req.json();
    const action = String(body?.action ?? '');

    // ── Nightly backup from pg_cron (checked with the secret cron key, no login) ──
    const cronKey = req.headers.get('x-cron-key');
    if (cronKey) {
      const { data: okKey } = await svc.rpc('check_cron_key', { p_key: cronKey });
      if (okKey !== true) return reply({ error: 'Not allowed.' });
      if (action !== 'backup_cron') return reply({ error: 'Unknown action.' });
      const { data: st } = await svc.from('app_settings').select('value').eq('key', 'backup').maybeSingle();
      if (st?.value?.enabled === false) return reply({ skipped: 'Backups are switched off.' });
      return reply(await startBackup('auto', null));
    }

    // ── Who is calling? ──
    const jwt = (req.headers.get('Authorization') ?? '').replace(/^Bearer\s+/i, '');
    const { data: caller } = await svc.auth.getUser(jwt);
    if (!caller?.user) return reply({ error: 'Please sign in again.' });
    const uid = caller.user.id;
    // V55: a main applicant managing a family member sends act_as = member's client id;
    // the database (my_client_id) accepts it only for that member's main applicant
    const actAs = UUID_RE.test(String(body?.act_as ?? '')) ? String(body.act_as).toLowerCase() : null;
    const asCaller = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_ANON_KEY')!, {
      global: { headers: { Authorization: `Bearer ${jwt}`, ...(actAs ? { 'x-family-member': actAs } : {}) } },
      auth: { persistSession: false, autoRefreshToken: false },
    });
    const { data: stepOk } = await asCaller.rpc('my_second_step_ok');
    if (stepOk !== true) return reply({ error: 'Please sign in again with your PIN or 6-digit code.' });
    const { data: me } = await svc.from('profiles').select('role').eq('id', uid).single();
    const isAdmin = me?.role === 'admin';
    const adminOnly = () => { if (!isAdmin) throw new Error('Admins only.'); };
    const connected = isConnected;

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
      // Personal OneDrive leaves the download link out when $select is used → ask for the whole item,
      // and if it is still missing, read the redirect of /content (also a short-lived link).
      const r = await graph(`/me/drive/items/${encodeURIComponent(doc.drive_item_id)}`);
      const d = await r.json();
      if (r.status === 404) return reply({ error: 'This file was removed from OneDrive.' });
      if (!r.ok) return reply({ error: `OneDrive: ${d.error?.message ?? r.status}` });
      let url = d['@microsoft.graph.downloadUrl'];
      if (!url) {
        const c = await graph(`/me/drive/items/${encodeURIComponent(doc.drive_item_id)}/content`, { redirect: 'manual' });
        url = c.headers.get('location') ?? undefined;
      }
      if (!url) return reply({ error: 'OneDrive did not give a download link — please try again.' });
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

    // ════ Admin: back up now (runs in the background; Settings → File storage shows progress) ════
    if (action === 'backup_now') {
      adminOnly();
      return reply(await startBackup('manual', uid));
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
