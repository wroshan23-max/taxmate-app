-- ═══════════════════════════════════════════════════════════
--  TaxMate V40 — IRD Payment Codes finder
--  • client portal on/off switch "ird_codes" (on by default)
--  • public registration link /join/codes for the free /ird-codes page
--  Safe to re-run.
-- ═══════════════════════════════════════════════════════════

-- 1. Firm-wide default ON (Settings → Client Portal)
UPDATE public.app_settings
SET value = jsonb_build_object('ird_codes', true) || coalesce(value, '{}'::jsonb)
WHERE key = 'client_tools' AND NOT (coalesce(value, '{}'::jsonb) ? 'ird_codes');

-- 2. Public registration link used by the free IRD codes page (/join/codes)
INSERT INTO public.client_registrations (multi_use, code, label, expires_at, created_by)
SELECT TRUE, 'codes', 'IRD payment codes page', '2100-01-01', (SELECT id FROM public.profiles WHERE role = 'admin' ORDER BY created_at LIMIT 1)
WHERE NOT EXISTS (SELECT 1 FROM public.client_registrations WHERE code = 'codes');

-- 3. Tell the client portal
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

SELECT (SELECT value->>'ird_codes' FROM public.app_settings WHERE key = 'client_tools') AS ird_codes_default,
       (SELECT count(*) FROM public.client_registrations WHERE code = 'codes') AS codes_link;
