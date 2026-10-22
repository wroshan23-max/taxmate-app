-- ═══════════════════════════════════════════════════════════
--  TaxMate V28 — client archive, portal feature switches, reminders, referrals
-- ═══════════════════════════════════════════════════════════

-- 1. Clients: archive, per-client feature switches, who referred them
ALTER TABLE public.clients ADD COLUMN IF NOT EXISTS archived_at       TIMESTAMPTZ;
ALTER TABLE public.clients ADD COLUMN IF NOT EXISTS feature_overrides JSONB NOT NULL DEFAULT '{}'::jsonb;
ALTER TABLE public.clients ADD COLUMN IF NOT EXISTS referred_by       UUID REFERENCES public.clients(id) ON DELETE SET NULL;
-- carry over the V27 calculator switch
UPDATE public.clients SET feature_overrides = feature_overrides || jsonb_build_object('tax_calculator', tax_calc = 'on')
WHERE tax_calc IN ('on', 'off') AND NOT (feature_overrides ? 'tax_calculator');

-- 2. Global switches (Settings → Client Portal)
UPDATE public.app_settings
SET value = jsonb_build_object('tax_calculator', true, 'tax_calendar', true, 'reminders', true, 'referrals', true, 'referral_reward', '') || coalesce(value, '{}'::jsonb)
WHERE key = 'client_tools';
INSERT INTO public.app_settings (key, value)
VALUES ('client_tools', '{"tax_calculator": true, "tax_calendar": true, "reminders": true, "referrals": true, "referral_reward": ""}'::jsonb)
ON CONFLICT (key) DO NOTHING;

-- Is a portal feature on for this client?  per-client override → global switch → on
CREATE OR REPLACE FUNCTION public._feature_on(p_client UUID, p_key TEXT)
RETURNS BOOLEAN LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT coalesce(
    (SELECT (feature_overrides->>p_key)::boolean FROM public.clients WHERE id = p_client AND feature_overrides ? p_key),
    (SELECT (value->>p_key)::boolean FROM public.app_settings WHERE key = 'client_tools'),
    true);
$$;
REVOKE ALL ON FUNCTION public._feature_on(UUID, TEXT) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public._feature_on(UUID, TEXT) TO authenticated;   -- used inside the reminders policy

CREATE OR REPLACE FUNCTION public.my_portal_features()
RETURNS JSONB LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE cid UUID := my_client_id(); n INT;
BEGIN
  SELECT count(*) INTO n FROM public.income_sheets WHERE client_id = cid AND enabled;
  RETURN jsonb_build_object(
    'tax_calculator', _feature_on(cid, 'tax_calculator'),
    'tax_calendar',   _feature_on(cid, 'tax_calendar'),
    'reminders',      _feature_on(cid, 'reminders'),
    'referrals',      _feature_on(cid, 'referrals'),
    'referral_reward', coalesce((SELECT value->>'referral_reward' FROM public.app_settings WHERE key = 'client_tools'), ''),
    'income_sheets', coalesce(n, 0));
END $$;
REVOKE ALL ON FUNCTION public.my_portal_features() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.my_portal_features() TO authenticated;

-- 3. Reminders
--   audience: admin (firm only) · client (one client sees it) · all (every client sees it) · personal (client's own)
CREATE TABLE IF NOT EXISTS public.reminders (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  title      TEXT NOT NULL CHECK (length(title) BETWEEN 1 AND 120),
  note       TEXT CHECK (note IS NULL OR length(note) <= 1000),
  due_date   DATE NOT NULL,
  category   TEXT NOT NULL DEFAULT 'reminder',
  audience   TEXT NOT NULL DEFAULT 'admin' CHECK (audience IN ('admin', 'client', 'all', 'personal')),
  client_id  UUID REFERENCES public.clients(id) ON DELETE CASCADE,
  done_at    TIMESTAMPTZ,
  created_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CHECK (audience NOT IN ('client', 'personal') OR client_id IS NOT NULL)
);
CREATE INDEX IF NOT EXISTS reminders_due_idx ON public.reminders (due_date);
ALTER TABLE public.reminders ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Admins manage reminders" ON public.reminders;
CREATE POLICY "Admins manage reminders" ON public.reminders FOR ALL USING (is_admin()) WITH CHECK (is_admin());
DROP POLICY IF EXISTS "Clients read their reminders" ON public.reminders;
CREATE POLICY "Clients read their reminders" ON public.reminders FOR SELECT USING (
  audience = 'all' OR (audience IN ('client', 'personal') AND client_id = my_client_id()));
DROP POLICY IF EXISTS "Clients add personal reminders" ON public.reminders;
CREATE POLICY "Clients add personal reminders" ON public.reminders FOR INSERT WITH CHECK (
  audience = 'personal' AND client_id = my_client_id() AND created_by = auth.uid() AND _feature_on(my_client_id(), 'reminders'));
DROP POLICY IF EXISTS "Clients edit personal reminders" ON public.reminders;
CREATE POLICY "Clients edit personal reminders" ON public.reminders FOR UPDATE
  USING (audience = 'personal' AND client_id = my_client_id())
  WITH CHECK (audience = 'personal' AND client_id = my_client_id());
DROP POLICY IF EXISTS "Clients delete personal reminders" ON public.reminders;
CREATE POLICY "Clients delete personal reminders" ON public.reminders FOR DELETE
  USING (audience = 'personal' AND client_id = my_client_id());

-- 4. Referrals: each client gets a reusable link /join/r-xxxxxx
ALTER TABLE public.client_registrations ADD COLUMN IF NOT EXISTS referrer_client_id UUID REFERENCES public.clients(id) ON DELETE CASCADE;
CREATE UNIQUE INDEX IF NOT EXISTS client_registrations_referrer_key ON public.client_registrations (referrer_client_id) WHERE referrer_client_id IS NOT NULL;

CREATE OR REPLACE FUNCTION public.my_referral_link()
RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE cid UUID := my_client_id(); c TEXT; nm TEXT; tries INT := 0;
BEGIN
  IF cid IS NULL THEN RAISE EXCEPTION 'Please sign in again.'; END IF;
  IF NOT _feature_on(cid, 'referrals') THEN RAISE EXCEPTION 'Invites are not available right now.'; END IF;
  SELECT code INTO c FROM public.client_registrations WHERE referrer_client_id = cid;
  IF c IS NULL THEN
    SELECT full_name INTO nm FROM public.clients WHERE id = cid;
    LOOP
      c := 'r-' || substr(md5(gen_random_uuid()::text), 1, 6);
      EXIT WHEN NOT EXISTS (SELECT 1 FROM public.client_registrations WHERE code = c);
      tries := tries + 1; IF tries > 10 THEN RAISE EXCEPTION 'Please try again.'; END IF;
    END LOOP;
    INSERT INTO public.client_registrations (multi_use, code, label, expires_at, referrer_client_id, max_per_day)
    VALUES (TRUE, c, 'Referral: ' || coalesce(nm, 'client'), '2100-01-01', cid, 20);
  END IF;
  RETURN jsonb_build_object('code', c);
END $$;
REVOKE ALL ON FUNCTION public.my_referral_link() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.my_referral_link() TO authenticated;

-- Friends who joined through my link (first names only)
CREATE OR REPLACE FUNCTION public.my_referrals()
RETURNS JSONB LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT coalesce(jsonb_agg(jsonb_build_object(
    'name', split_part(trim(full_name), ' ', 1),
    'joined', registered_at,
    'active', profile_id IS NOT NULL) ORDER BY registered_at DESC), '[]'::jsonb)
  FROM public.clients WHERE referred_by = my_client_id();
$$;
REVOKE ALL ON FUNCTION public.my_referrals() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.my_referrals() TO authenticated;

-- Public link check now also says who invited you (first name only)
CREATE OR REPLACE FUNCTION public.get_public_registration(p_code TEXT)
RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE r public.client_registrations; who TEXT;
BEGIN
  SELECT * INTO r FROM public.client_registrations WHERE code = lower(p_code) AND multi_use;
  IF r.id IS NULL THEN RETURN jsonb_build_object('status', 'missing'); END IF;
  IF NOT r.active OR r.revoked_at IS NOT NULL THEN RETURN jsonb_build_object('status', 'closed'); END IF;
  IF r.referrer_client_id IS NOT NULL THEN
    IF NOT _feature_on(r.referrer_client_id, 'referrals') THEN RETURN jsonb_build_object('status', 'closed'); END IF;
    SELECT split_part(trim(full_name), ' ', 1) INTO who FROM public.clients WHERE id = r.referrer_client_id;
  END IF;
  RETURN jsonb_build_object('status', 'ok', 'invited_by', who);
END $$;

CREATE OR REPLACE FUNCTION public.submit_public_registration(p_code TEXT, p JSONB)
RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  r public.client_registrations; cid UUID; hdr JSON; ip TEXT; iph TEXT; mkey TEXT;
BEGIN
  SELECT * INTO r FROM public.client_registrations WHERE code = lower(p_code) AND multi_use;
  IF r.id IS NULL OR NOT r.active OR r.revoked_at IS NOT NULL THEN RAISE EXCEPTION 'This registration link is closed. Please WhatsApp TaxMate.'; END IF;
  IF r.referrer_client_id IS NOT NULL AND NOT _feature_on(r.referrer_client_id, 'referrals') THEN RAISE EXCEPTION 'This invite link is closed. Please WhatsApp TaxMate.'; END IF;
  IF coalesce(trim(p->>'website'), '') <> '' THEN RETURN jsonb_build_object('ok', true, 'name', p->>'full_name'); END IF;
  hdr := nullif(current_setting('request.headers', true), '')::json;
  ip := coalesce(hdr->>'cf-connecting-ip', trim(split_part(coalesce(hdr->>'x-forwarded-for', ''), ',', 1)), hdr->>'x-real-ip', '');
  iph := CASE WHEN ip = '' THEN NULL ELSE md5(ip || r.id::text) END;
  mkey := right(regexp_replace(coalesce(nullif(p->>'mobile', ''), p->>'contact_mobile', ''), '\D', '', 'g'), 9);
  IF iph IS NOT NULL AND (SELECT count(*) FROM public.registration_attempts
      WHERE registration_id = r.id AND ip_hash = iph AND created_at > NOW() - INTERVAL '24 hours') >= 3 THEN
    RAISE EXCEPTION 'Too many forms from this device today. Please WhatsApp TaxMate instead.';
  END IF;
  IF length(mkey) = 9 AND EXISTS (SELECT 1 FROM public.registration_attempts
      WHERE registration_id = r.id AND mobile_key = mkey AND created_at > NOW() - INTERVAL '30 days') THEN
    RAISE EXCEPTION 'We have already received details for this mobile number. TaxMate will contact you soon.';
  END IF;
  IF (SELECT count(*) FROM public.registration_attempts
      WHERE registration_id = r.id AND created_at > NOW() - INTERVAL '24 hours') >= r.max_per_day THEN
    RAISE EXCEPTION 'We are receiving many registrations right now. Please try again tomorrow or WhatsApp TaxMate.';
  END IF;
  cid := public._create_registered_client(p, r.created_by, coalesce(r.label, r.code));
  IF r.referrer_client_id IS NOT NULL THEN
    UPDATE public.clients SET referred_by = r.referrer_client_id WHERE id = cid;
  END IF;
  INSERT INTO public.registration_attempts (registration_id, ip_hash, mobile_key, client_id) VALUES (r.id, iph, nullif(mkey, ''), cid);
  UPDATE public.client_registrations SET use_count = use_count + 1 WHERE id = r.id;
  RETURN jsonb_build_object('ok', true, 'name', p->>'full_name');
END $$;
