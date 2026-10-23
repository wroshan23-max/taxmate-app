-- ═══════════════════════════════════════════════════════════
--  TaxMate V34 — Automatic email reminders
--  A daily job (pg_cron → pg_net) calls the "reminders" Edge Function, which sends
--  emails through Brevo or Resend (API key kept as an Edge Function secret).
-- ═══════════════════════════════════════════════════════════

-- 1. Settings + client opt-out
INSERT INTO public.app_settings (key, value) VALUES ('email', jsonb_build_object(
  'enabled', false, 'from_email', '', 'from_name', 'TaxMate Solutions', 'reply_to', '',
  'types', jsonb_build_object('due_dates', true, 'invoices', true, 'documents', true, 'reminders', true, 'messages', true)))
ON CONFLICT (key) DO NOTHING;
ALTER TABLE public.clients ADD COLUMN IF NOT EXISTS email_opt_out BOOLEAN NOT NULL DEFAULT FALSE;

CREATE OR REPLACE FUNCTION public.my_email_prefs()
RETURNS JSONB LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT jsonb_build_object('email', email, 'opt_out', email_opt_out) FROM public.clients WHERE id = my_client_id();
$$;
REVOKE ALL ON FUNCTION public.my_email_prefs() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.my_email_prefs() TO authenticated;

CREATE OR REPLACE FUNCTION public.set_my_email_prefs(p_opt_out BOOLEAN)
RETURNS VOID LANGUAGE sql SECURITY DEFINER SET search_path = public AS $$
  UPDATE public.clients SET email_opt_out = coalesce(p_opt_out, false) WHERE id = my_client_id();
$$;
REVOKE ALL ON FUNCTION public.set_my_email_prefs(BOOLEAN) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.set_my_email_prefs(BOOLEAN) TO authenticated;

-- 2. What was sent (also stops the same reminder going twice)
CREATE TABLE IF NOT EXISTS public.email_log (
  id         BIGSERIAL PRIMARY KEY,
  client_id  UUID REFERENCES public.clients(id) ON DELETE CASCADE,
  kind       TEXT NOT NULL,          -- due_dates, invoices, documents, reminders, messages, test
  ref        TEXT NOT NULL,          -- unique per reminder (e.g. iit-2026-11-30-d7)
  to_email   TEXT,
  subject    TEXT,
  status     TEXT NOT NULL DEFAULT 'sent' CHECK (status IN ('sent', 'failed', 'skipped')),
  error      TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE UNIQUE INDEX IF NOT EXISTS email_log_once ON public.email_log (kind, ref, client_id) WHERE status = 'sent';
CREATE INDEX IF NOT EXISTS email_log_recent ON public.email_log (created_at DESC);
ALTER TABLE public.email_log ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Admins read email log" ON public.email_log;
CREATE POLICY "Admins read email log" ON public.email_log FOR SELECT USING (is_admin());

-- 3. Daily schedule: 08:37 Sri Lanka time (03:07 UTC)
CREATE EXTENSION IF NOT EXISTS pg_net;
CREATE EXTENSION IF NOT EXISTS pg_cron;
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM vault.secrets WHERE name = 'taxmate_cron_key') THEN
    PERFORM vault.create_secret(encode(extensions.gen_random_bytes(24), 'hex'), 'taxmate_cron_key', 'Lets the daily job call the reminders function');
  END IF;
END $$;

-- The Edge Function (service role) asks: is this the real daily job?
CREATE OR REPLACE FUNCTION public.check_cron_key(p_key TEXT)
RETURNS BOOLEAN LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT coalesce(p_key, '') <> '' AND p_key = (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'taxmate_cron_key' LIMIT 1);
$$;
REVOKE ALL ON FUNCTION public.check_cron_key(TEXT) FROM PUBLIC, anon, authenticated;

DO $$
BEGIN
  PERFORM cron.unschedule(jobid) FROM cron.job WHERE jobname = 'taxmate-email-reminders';
  PERFORM cron.schedule('taxmate-email-reminders', '7 3 * * *', $job$
    SELECT net.http_post(
      url := 'https://qipehxixvulvrubjifvi.supabase.co/functions/v1/reminders',
      headers := jsonb_build_object('Content-Type', 'application/json',
                   'x-cron-key', (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'taxmate_cron_key' LIMIT 1)),
      body := '{"action":"cron"}'::jsonb,
      timeout_milliseconds := 60000);
  $job$);
END $$;
