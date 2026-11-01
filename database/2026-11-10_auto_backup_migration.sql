-- ═══════════════════════════════════════════════════════════
--  TaxMate V52 — Automatic backups to OneDrive
--  • Every night (02:00 Sri Lanka time) the `onedrive` Edge Function saves a full copy of the
--    app's data to the firm's OneDrive:  TaxMate Backups / Daily / <date> /
--      - TaxMate-backup-<date>.json.gz  (every table — used to restore)
--      - TaxMate-data-<date>.xlsx       (main tables, to open in Excel)
--    and copies new app-storage files to  TaxMate Backups / App files / <bucket> / …
--  • Keeps 30 daily + 12 monthly backups (older ones go to the OneDrive recycle bin).
--  • Not backed up (secrets): OneDrive sign-in, login PINs, encrypted RAMIS PIN/SSID,
--    invite / reset links, registration IP hashes, temporary upload rows.
--  Safe to re-run.
-- ═══════════════════════════════════════════════════════════

INSERT INTO public.app_settings (key, value)
VALUES ('backup', jsonb_build_object('enabled', true, 'keep_daily', 30, 'keep_monthly', 12, 'files', true))
ON CONFLICT (key) DO NOTHING;

-- History of backup runs (admins read; only the Edge Function writes)
CREATE TABLE IF NOT EXISTS public.backups (
  id            BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  kind          TEXT NOT NULL DEFAULT 'auto' CHECK (kind IN ('auto', 'manual')),
  status        TEXT NOT NULL DEFAULT 'running' CHECK (status IN ('running', 'ok', 'partial', 'error')),
  started_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  finished_at   TIMESTAMPTZ,
  started_by    UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  tables        INT,
  rows          INT,
  bytes         BIGINT,
  xlsx_bytes    BIGINT,
  files_copied  INT,
  files_bytes   BIGINT,
  files_pending INT,
  folder        TEXT,
  web_url       TEXT,
  error         TEXT
);
CREATE INDEX IF NOT EXISTS backups_time_idx ON public.backups (started_at DESC);
ALTER TABLE public.backups ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Admins read backups" ON public.backups;
CREATE POLICY "Admins read backups" ON public.backups FOR SELECT USING (is_admin());
REVOKE INSERT, UPDATE, DELETE ON public.backups FROM anon, authenticated;

-- Which app-storage files were already copied to OneDrive (Edge Function only)
CREATE TABLE IF NOT EXISTS public.backup_file_log (
  bucket        TEXT NOT NULL,
  path          TEXT NOT NULL,
  size          BIGINT,
  src_updated   TEXT,
  drive_item_id TEXT,
  copied_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (bucket, path)
);
ALTER TABLE public.backup_file_log ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.backup_file_log FROM anon, authenticated;

-- Tables that go into a backup: every table in `public` except the secrets listed here
CREATE OR REPLACE FUNCTION public._backup_tables()
RETURNS SETOF TEXT LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT c.relname::text FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
  WHERE n.nspname = 'public' AND c.relkind IN ('r', 'p')
    AND c.relname NOT IN ('storage_connection', 'user_pins', 'pin_sessions', 'client_ird', 'password_resets', 'portal_invites',
                          'registration_attempts', 'drive_uploads', 'user_presence', 'backup_file_log', 'backups')
  ORDER BY 1;
$$;
REVOKE ALL ON FUNCTION public._backup_tables() FROM PUBLIC, anon, authenticated;

-- One table's rows as JSON (Edge Function only)
CREATE OR REPLACE FUNCTION public._backup_table(p_name TEXT)
RETURNS JSONB LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE out JSONB;
BEGIN
  IF p_name IS NULL OR NOT EXISTS (SELECT 1 FROM public._backup_tables() t WHERE t = p_name) THEN
    RAISE EXCEPTION 'Not a backup table: %', p_name;
  END IF;
  EXECUTE format('SELECT coalesce(jsonb_agg(to_jsonb(t)), ''[]''::jsonb) FROM public.%I t', p_name) INTO out;
  RETURN out;
END $$;
REVOKE ALL ON FUNCTION public._backup_table(TEXT) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public._backup_tables() TO service_role;   -- the Edge Function
GRANT EXECUTE ON FUNCTION public._backup_table(TEXT) TO service_role;

-- Nightly at 02:00 Sri Lanka time (20:30 UTC). The function answers at once and works in the background.
DO $$
BEGIN
  PERFORM cron.unschedule(jobid) FROM cron.job WHERE jobname = 'taxmate-daily-backup';
  PERFORM cron.schedule('taxmate-daily-backup', '30 20 * * *', $job$
    SELECT net.http_post(
      url := 'https://qipehxixvulvrubjifvi.supabase.co/functions/v1/onedrive',
      headers := jsonb_build_object('Content-Type', 'application/json',
                   'Authorization', 'Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InFpcGVoeGl4dnVsdnJ1YmppZnZpIiwicm9sZSI6ImFub24iLCJpYXQiOjE3OTE5MTE3NTUsImV4cCI6MjEwNzQ4Nzc1NX0.52tQGPTJTBVAsH7QPeyRNRBbrYCYbi9lDSfaoPSWlu4',
                   'x-cron-key', (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'taxmate_cron_key' LIMIT 1)),
      body := '{"action":"backup_cron"}'::jsonb,
      timeout_milliseconds := 30000);
  $job$);
END $$;

SELECT (SELECT count(*) FROM public._backup_tables()) AS tables_in_backup,
       (SELECT schedule FROM cron.job WHERE jobname = 'taxmate-daily-backup') AS schedule,
       (SELECT value FROM public.app_settings WHERE key = 'backup') AS settings;
