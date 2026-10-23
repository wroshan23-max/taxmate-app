-- TaxMate V34.1 — the daily reminders job also sends the public anon key, so the
-- "reminders" Edge Function can keep "Verify JWT" ON. The function still checks x-cron-key.
DO $$
BEGIN
  PERFORM cron.unschedule(jobid) FROM cron.job WHERE jobname = 'taxmate-email-reminders';
  PERFORM cron.schedule('taxmate-email-reminders', '7 3 * * *', $job$
    SELECT net.http_post(
      url := 'https://qipehxixvulvrubjifvi.supabase.co/functions/v1/reminders',
      headers := jsonb_build_object('Content-Type', 'application/json',
                   'Authorization', 'Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InFpcGVoeGl4dnVsdnJ1YmppZnZpIiwicm9sZSI6ImFub24iLCJpYXQiOjE3OTE5MTE3NTUsImV4cCI6MjEwNzQ4Nzc1NX0.52tQGPTJTBVAsH7QPeyRNRBbrYCYbi9lDSfaoPSWlu4',
                   'x-cron-key', (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'taxmate_cron_key' LIMIT 1)),
      body := '{"action":"cron"}'::jsonb,
      timeout_milliseconds := 60000);
  $job$);
END $$;
SELECT jobname, schedule, position('Authorization' in command) > 0 AS has_auth FROM cron.job WHERE jobname = 'taxmate-email-reminders';
