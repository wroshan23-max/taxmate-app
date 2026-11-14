-- ════════════════════════════════════════════════════════════════════════════
-- V65 — Client Portal: own on/off switch for "Activity Codes" (/client/activity-codes)
--   Until now the menu item followed the "IRD Payment Codes" switch (ird_codes).
--   New key: activity_codes — in Settings → Client Portal (all clients) and per client
--   (client page → Overview → Portal features).
--   Nothing changes for clients on the day: the new switch starts with the same value as
--   ird_codes (globally and in every client's own override).
-- Safe to run more than once.
-- ════════════════════════════════════════════════════════════════════════════

-- 1. Global switch — copy today's IRD Payment Codes value
UPDATE public.app_settings
   SET value = coalesce(value, '{}'::jsonb)
             || jsonb_build_object('activity_codes', coalesce((value->>'ird_codes')::boolean, true)),
       updated_at = NOW()
 WHERE key = 'client_tools'
   AND NOT (coalesce(value, '{}'::jsonb) ? 'activity_codes');

-- 2. Per-client overrides — a client with IRD codes switched on/off keeps the same for activity codes
UPDATE public.clients
   SET feature_overrides = feature_overrides || jsonb_build_object('activity_codes', feature_overrides->'ird_codes')
 WHERE feature_overrides ? 'ird_codes'
   AND NOT (feature_overrides ? 'activity_codes');

-- 3. What the portal reads (same as before + activity_codes)
CREATE OR REPLACE FUNCTION public.my_portal_features()
RETURNS JSONB LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE cid UUID := my_client_id(); n INT;
BEGIN
  SELECT count(*) INTO n FROM public.income_sheets WHERE client_id = cid AND enabled;
  RETURN jsonb_build_object(
    'quick_tax',      _feature_on(cid, 'quick_tax'),
    'tax_calculator', _feature_on(cid, 'tax_calculator'),
    'tax_calendar',   _feature_on(cid, 'tax_calendar'),
    'ird_codes',      _feature_on(cid, 'ird_codes'),
    'activity_codes', _feature_on(cid, 'activity_codes'),
    'reminders',      _feature_on(cid, 'reminders'),
    'referrals',      _feature_on(cid, 'referrals'),
    'documents',      _feature_on(cid, 'documents'),
    'return_tracker', _feature_on(cid, 'return_tracker'),
    'messages',       _feature_on(cid, 'messages'),
    'services',       _feature_on(cid, 'services'),
    'summary_letters', _feature_on(cid, 'summary_letters'),
    'plans',          _feature_on(cid, 'plans'),
    'tax_reviews',    _feature_on(cid, 'tax_reviews'),
    'referral_reward', coalesce((SELECT value->>'referral_reward' FROM public.app_settings WHERE key = 'client_tools'), ''),
    'income_sheets', coalesce(n, 0));
END $$;
REVOKE ALL ON FUNCTION public.my_portal_features() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.my_portal_features() TO authenticated;

-- Check: activity_codes switch (expect true unless IRD codes were off) · clients with their own setting
SELECT (SELECT value->>'activity_codes' FROM public.app_settings WHERE key = 'client_tools') AS activity_codes_on,
       (SELECT count(*) FROM public.clients WHERE feature_overrides ? 'activity_codes') AS clients_with_own_setting;
