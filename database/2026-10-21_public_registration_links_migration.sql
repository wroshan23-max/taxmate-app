-- ═══════════════════════════════════════════════════════════
--  TaxMate V25 — Reusable public registration links
--  e.g. https://taxmate-app.vercel.app/join/fb  (Facebook post, WhatsApp
--  status, flyer). Anyone can register; protected by:
--   * honeypot field (bots)            * max 3 submissions / IP / 24h
--   * same mobile twice in 30 days → "already received"
--   * daily cap per link                * admin can switch a link off
-- ═══════════════════════════════════════════════════════════

ALTER TABLE public.client_registrations ADD COLUMN IF NOT EXISTS multi_use   BOOLEAN NOT NULL DEFAULT FALSE;
ALTER TABLE public.client_registrations ADD COLUMN IF NOT EXISTS code        TEXT;
ALTER TABLE public.client_registrations ADD COLUMN IF NOT EXISTS label       TEXT;
ALTER TABLE public.client_registrations ADD COLUMN IF NOT EXISTS active      BOOLEAN NOT NULL DEFAULT TRUE;
ALTER TABLE public.client_registrations ADD COLUMN IF NOT EXISTS use_count   INTEGER NOT NULL DEFAULT 0;
ALTER TABLE public.client_registrations ADD COLUMN IF NOT EXISTS max_per_day INTEGER NOT NULL DEFAULT 100;
CREATE UNIQUE INDEX IF NOT EXISTS client_registrations_code_key ON public.client_registrations (code) WHERE code IS NOT NULL;
ALTER TABLE public.client_registrations DROP CONSTRAINT IF EXISTS client_registrations_code_check;
ALTER TABLE public.client_registrations ADD CONSTRAINT client_registrations_code_check
  CHECK (code IS NULL OR code ~ '^[a-z0-9][a-z0-9-]{1,29}$');

-- Submissions through public links (for rate limits). IP is stored only as a hash.
CREATE TABLE IF NOT EXISTS public.registration_attempts (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  registration_id UUID REFERENCES public.client_registrations(id) ON DELETE CASCADE,
  ip_hash         TEXT,
  mobile_key      TEXT,
  client_id       UUID REFERENCES public.clients(id) ON DELETE SET NULL,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS registration_attempts_recent_idx ON public.registration_attempts (registration_id, created_at);
ALTER TABLE public.registration_attempts ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Admins read registration attempts" ON public.registration_attempts;
CREATE POLICY "Admins read registration attempts" ON public.registration_attempts FOR SELECT USING (is_admin());

-- Shared: validate the form and create the client (internal only)
CREATE OR REPLACE FUNCTION public._create_registered_client(p JSONB, p_created_by UUID, p_via TEXT)
RETURNS UUID LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  cid UUID;
  v_name TEXT := left(trim(coalesce(p->>'full_name', '')), 150);
  v_mobile TEXT := left(trim(coalesce(p->>'mobile', '')), 30);
  v_cmobile TEXT := left(trim(coalesce(p->>'contact_mobile', '')), 30);
  v_res TEXT := coalesce(nullif(p->>'resident_status', ''), 'resident');
BEGIN
  IF p IS NULL OR jsonb_typeof(p) <> 'object' OR octet_length(p::text) > 20000 THEN RAISE EXCEPTION 'Invalid form.'; END IF;
  IF length(v_name) < 3 THEN RAISE EXCEPTION 'Please enter the full name.'; END IF;
  IF v_mobile = '' AND v_cmobile = '' THEN RAISE EXCEPTION 'Please enter a mobile number.'; END IF;
  IF coalesce((p->>'consent')::boolean, false) IS NOT TRUE THEN RAISE EXCEPTION 'Please accept the consent to continue.'; END IF;
  IF v_res NOT IN ('resident', 'nrcitizen', 'nonresident') THEN v_res := 'resident'; END IF;

  INSERT INTO public.clients (
    created_by, full_name, nic, tin, email, mobile, address, employer, resident_status,
    contact_name, contact_relation, contact_mobile, contact_email, contact_preferred,
    source, registered_at, registration)
  VALUES (
    p_created_by, v_name,
    nullif(upper(left(trim(coalesce(p->>'nic', '')), 20)), ''),
    nullif(left(trim(coalesce(p->>'tin', '')), 20), ''),
    nullif(lower(left(trim(coalesce(p->>'email', '')), 150)), ''),
    nullif(v_mobile, ''),
    nullif(left(trim(coalesce(p->>'address', '')), 400), ''),
    nullif(left(trim(coalesce(p->>'employer', '')), 150), ''),
    v_res,
    nullif(left(trim(coalesce(p->>'contact_name', '')), 150), ''),
    nullif(left(trim(coalesce(p->>'contact_relation', '')), 50), ''),
    nullif(v_cmobile, ''),
    nullif(lower(left(trim(coalesce(p->>'contact_email', '')), 150)), ''),
    coalesce((p->>'contact_preferred')::boolean, false) AND v_cmobile <> '',
    'self_registration', NOW(),
    jsonb_build_object(
      'services', CASE WHEN jsonb_typeof(p->'services') = 'array' THEN p->'services' ELSE '[]'::jsonb END,
      'note', left(coalesce(p->>'note', ''), 2000),
      'filled_by', CASE WHEN p->>'filled_by' = 'contact' THEN 'contact' ELSE 'self' END,
      'via', p_via,
      'consent_at', NOW())
  ) RETURNING id INTO cid;
  RETURN cid;
END $$;
REVOKE ALL ON FUNCTION public._create_registered_client(JSONB, UUID, TEXT) FROM PUBLIC, anon, authenticated;

-- One-time links: now use the shared function; public links are not usable here
CREATE OR REPLACE FUNCTION public.get_registration(p_token UUID)
RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE r public.client_registrations;
BEGIN
  SELECT * INTO r FROM public.client_registrations WHERE token = p_token AND NOT multi_use;
  IF r.id IS NULL THEN RETURN jsonb_build_object('status', 'missing'); END IF;
  IF r.revoked_at IS NOT NULL THEN RETURN jsonb_build_object('status', 'revoked'); END IF;
  IF r.used_at IS NOT NULL THEN RETURN jsonb_build_object('status', 'used'); END IF;
  IF r.expires_at < NOW() THEN RETURN jsonb_build_object('status', 'expired'); END IF;
  RETURN jsonb_build_object('status', 'ok', 'name_hint', r.name_hint);
END $$;

CREATE OR REPLACE FUNCTION public.submit_registration(p_token UUID, p JSONB)
RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE r public.client_registrations; cid UUID;
BEGIN
  SELECT * INTO r FROM public.client_registrations WHERE token = p_token AND NOT multi_use FOR UPDATE;
  IF r.id IS NULL OR r.revoked_at IS NOT NULL THEN RAISE EXCEPTION 'This registration link is not valid.'; END IF;
  IF r.used_at IS NOT NULL THEN RAISE EXCEPTION 'This link was already used. Please contact TaxMate.'; END IF;
  IF r.expires_at < NOW() THEN RAISE EXCEPTION 'This link has expired. Please ask TaxMate for a new one.'; END IF;
  cid := public._create_registered_client(p, r.created_by, 'personal link');
  UPDATE public.client_registrations SET used_at = NOW(), client_id = cid, use_count = 1 WHERE id = r.id;
  RETURN jsonb_build_object('ok', true, 'name', p->>'full_name');
END $$;

-- Public links
CREATE OR REPLACE FUNCTION public.get_public_registration(p_code TEXT)
RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE r public.client_registrations;
BEGIN
  SELECT * INTO r FROM public.client_registrations WHERE code = lower(p_code) AND multi_use;
  IF r.id IS NULL THEN RETURN jsonb_build_object('status', 'missing'); END IF;
  IF NOT r.active OR r.revoked_at IS NOT NULL THEN RETURN jsonb_build_object('status', 'closed'); END IF;
  RETURN jsonb_build_object('status', 'ok');
END $$;

CREATE OR REPLACE FUNCTION public.submit_public_registration(p_code TEXT, p JSONB)
RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  r public.client_registrations; cid UUID; hdr JSON; ip TEXT; iph TEXT; mkey TEXT;
BEGIN
  SELECT * INTO r FROM public.client_registrations WHERE code = lower(p_code) AND multi_use;
  IF r.id IS NULL OR NOT r.active OR r.revoked_at IS NOT NULL THEN RAISE EXCEPTION 'This registration link is closed. Please WhatsApp TaxMate.'; END IF;

  -- Bots fill the hidden "website" field: pretend success, save nothing
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
  INSERT INTO public.registration_attempts (registration_id, ip_hash, mobile_key, client_id) VALUES (r.id, iph, nullif(mkey, ''), cid);
  UPDATE public.client_registrations SET use_count = use_count + 1 WHERE id = r.id;
  RETURN jsonb_build_object('ok', true, 'name', p->>'full_name');
END $$;

REVOKE ALL ON FUNCTION public.get_public_registration(TEXT) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.submit_public_registration(TEXT, JSONB) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_public_registration(TEXT) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.submit_public_registration(TEXT, JSONB) TO anon, authenticated;

-- Default Facebook link: /join/fb
INSERT INTO public.client_registrations (multi_use, code, label, expires_at, created_by)
SELECT TRUE, 'fb', 'Facebook', '2100-01-01', (SELECT id FROM public.profiles WHERE role = 'admin' ORDER BY created_at LIMIT 1)
WHERE NOT EXISTS (SELECT 1 FROM public.client_registrations WHERE code = 'fb');
