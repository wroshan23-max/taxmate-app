-- ═══════════════════════════════════════════════════════════
--  V86 + repair (28 Nov 2026)
--  1. Repair: the old combined V65–V70 script was run again from a saved SQL tab. It replaced
--     my_portal_features() with its older version (no 'packages' / 'business_accounts' menus).
--     This puts back the latest version (from the V76 script). Nothing else in that old script
--     was changed by later versions, and it is safe to run again.
--  2. V86: one-time password for the client portal invitation.
--  Safe to run more than once.
-- ═══════════════════════════════════════════════════════════

-- ── 1. Portal menu (latest, V76) ──
CREATE OR REPLACE FUNCTION public.my_portal_features()
RETURNS JSONB LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE cid UUID := my_client_id(); n INT; nb INT;
BEGIN
  SELECT count(*) INTO n FROM public.income_sheets WHERE client_id = cid AND enabled;
  SELECT count(*) INTO nb FROM public.business_accounts WHERE client_id = cid;
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
    'packages',       _feature_on(cid, 'packages'),
    'referral_reward', coalesce((SELECT value->>'referral_reward' FROM public.app_settings WHERE key = 'client_tools'), ''),
    'income_sheets', coalesce(n, 0),
    'business_accounts', coalesce(nb, 0));
END $$;
REVOKE ALL ON FUNCTION public.my_portal_features() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.my_portal_features() TO authenticated;

-- ═══ 4. Check ═══════════════════════════════════════════════

-- activity codes switch (V65) — only if the key is still missing
UPDATE public.app_settings SET value = coalesce(value, '{}'::jsonb) || jsonb_build_object('activity_codes', coalesce((value->>'ird_codes')::boolean, true)), updated_at = NOW()
 WHERE key = 'client_tools' AND NOT (coalesce(value, '{}'::jsonb) ? 'activity_codes');

-- ── 2. V86 one-time password ──
ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS temp_password_at TIMESTAMPTZ;

ALTER TABLE public.portal_invites ADD COLUMN IF NOT EXISTS method TEXT NOT NULL DEFAULT 'link';
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'portal_invites_method_chk') THEN
    ALTER TABLE public.portal_invites ADD CONSTRAINT portal_invites_method_chk CHECK (method IN ('link', 'temp_password'));
  END IF;
END $$;

-- The signed-in user has chosen (new password set, or kept the temporary one)
CREATE OR REPLACE FUNCTION public.my_temp_password_done(p_kept BOOLEAN DEFAULT false)
RETURNS VOID LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'Please sign in'; END IF;
  UPDATE public.profiles SET temp_password_at = NULL WHERE id = auth.uid() AND temp_password_at IS NOT NULL;
END $$;
REVOKE ALL ON FUNCTION public.my_temp_password_done(BOOLEAN) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.my_temp_password_done(BOOLEAN) TO authenticated;

-- ✅ Check (one row — every column should be true)
SELECT position('business_accounts' IN pg_get_functiondef('public.my_portal_features()'::regprocedure)) > 0
       AND position('packages' IN pg_get_functiondef('public.my_portal_features()'::regprocedure)) > 0 AS portal_menu_ok,
       (SELECT value ? 'activity_codes' FROM public.app_settings WHERE key = 'client_tools') IS NOT FALSE AS activity_codes_ok,
       EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'profiles' AND column_name = 'temp_password_at') AS v86_profiles_flag,
       EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'portal_invites' AND column_name = 'method') AS v86_invite_method,
       EXISTS (SELECT 1 FROM pg_proc WHERE proname = 'my_temp_password_done') AS v86_done_rpc;
