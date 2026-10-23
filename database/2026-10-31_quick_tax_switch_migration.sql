-- ═══════════════════════════════════════════════════════════
--  TaxMate V35 — separate on/off for "Quick Tax Check" (simple calculator)
--  and "Tax Calculator" (detailed). Until now one switch (tax_calculator)
--  controlled both, so the new switch starts with the same value.
--  Safe to re-run.
-- ═══════════════════════════════════════════════════════════

-- 1. Firm-wide default (Settings → Client Portal)
UPDATE public.app_settings
SET value = jsonb_build_object('quick_tax', coalesce((value->>'tax_calculator')::boolean, true)) || coalesce(value, '{}'::jsonb)
WHERE key = 'client_tools' AND NOT (coalesce(value, '{}'::jsonb) ? 'quick_tax');

-- 2. Per-client exceptions: copy an existing calculator override
UPDATE public.clients
SET feature_overrides = feature_overrides || jsonb_build_object('quick_tax', feature_overrides->'tax_calculator')
WHERE feature_overrides ? 'tax_calculator' AND NOT feature_overrides ? 'quick_tax';

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
    'reminders',      _feature_on(cid, 'reminders'),
    'referrals',      _feature_on(cid, 'referrals'),
    'documents',      _feature_on(cid, 'documents'),
    'return_tracker', _feature_on(cid, 'return_tracker'),
    'messages',       _feature_on(cid, 'messages'),
    'services',       _feature_on(cid, 'services'),
    'summary_letters', _feature_on(cid, 'summary_letters'),
    'referral_reward', coalesce((SELECT value->>'referral_reward' FROM public.app_settings WHERE key = 'client_tools'), ''),
    'income_sheets', coalesce(n, 0));
END $$;
REVOKE ALL ON FUNCTION public.my_portal_features() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.my_portal_features() TO authenticated;

SELECT value->>'quick_tax' AS quick_tax, value->>'tax_calculator' AS tax_calculator FROM public.app_settings WHERE key = 'client_tools';
