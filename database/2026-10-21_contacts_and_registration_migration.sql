-- ═══════════════════════════════════════════════════════════
--  TaxMate V24 — Contact person + client self-registration links
--  * A client can have a contact person (e.g. son/daughter) who
--    coordinates the tax work; messages can go to them instead.
--  * Admin sends a one-time registration link; the new client (or
--    their contact person) fills their details, saved as a client.
-- ═══════════════════════════════════════════════════════════

ALTER TABLE public.clients ADD COLUMN IF NOT EXISTS contact_name      TEXT;
ALTER TABLE public.clients ADD COLUMN IF NOT EXISTS contact_relation  TEXT;
ALTER TABLE public.clients ADD COLUMN IF NOT EXISTS contact_mobile    TEXT;
ALTER TABLE public.clients ADD COLUMN IF NOT EXISTS contact_email     TEXT;
ALTER TABLE public.clients ADD COLUMN IF NOT EXISTS contact_preferred BOOLEAN NOT NULL DEFAULT FALSE;
ALTER TABLE public.clients ADD COLUMN IF NOT EXISTS source            TEXT NOT NULL DEFAULT 'admin';
ALTER TABLE public.clients ADD COLUMN IF NOT EXISTS registered_at     TIMESTAMPTZ;
ALTER TABLE public.clients ADD COLUMN IF NOT EXISTS reviewed_at       TIMESTAMPTZ;
ALTER TABLE public.clients ADD COLUMN IF NOT EXISTS registration      JSONB;   -- services wanted, notes, consent

-- One-time registration links
CREATE TABLE IF NOT EXISTS public.client_registrations (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  token       UUID NOT NULL UNIQUE DEFAULT gen_random_uuid(),
  name_hint   TEXT,
  mobile_hint TEXT,
  created_by  UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  expires_at  TIMESTAMPTZ NOT NULL DEFAULT NOW() + INTERVAL '14 days',
  used_at     TIMESTAMPTZ,
  revoked_at  TIMESTAMPTZ,
  client_id   UUID REFERENCES public.clients(id) ON DELETE SET NULL
);
ALTER TABLE public.client_registrations ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Admins manage registrations" ON public.client_registrations;
CREATE POLICY "Admins manage registrations" ON public.client_registrations
  FOR ALL USING (is_admin()) WITH CHECK (is_admin());

-- Public: check a link (no personal data returned)
CREATE OR REPLACE FUNCTION public.get_registration(p_token UUID)
RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE r public.client_registrations;
BEGIN
  SELECT * INTO r FROM public.client_registrations WHERE token = p_token;
  IF r.id IS NULL THEN RETURN jsonb_build_object('status', 'missing'); END IF;
  IF r.revoked_at IS NOT NULL THEN RETURN jsonb_build_object('status', 'revoked'); END IF;
  IF r.used_at IS NOT NULL THEN RETURN jsonb_build_object('status', 'used'); END IF;
  IF r.expires_at < NOW() THEN RETURN jsonb_build_object('status', 'expired'); END IF;
  RETURN jsonb_build_object('status', 'ok', 'name_hint', r.name_hint);
END $$;

-- Public: submit the form once. Creates the client record.
CREATE OR REPLACE FUNCTION public.submit_registration(p_token UUID, p JSONB)
RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  r public.client_registrations;
  cid UUID;
  v_name TEXT := left(trim(coalesce(p->>'full_name', '')), 150);
  v_mobile TEXT := left(trim(coalesce(p->>'mobile', '')), 30);
  v_cmobile TEXT := left(trim(coalesce(p->>'contact_mobile', '')), 30);
  v_res TEXT := coalesce(nullif(p->>'resident_status', ''), 'resident');
BEGIN
  SELECT * INTO r FROM public.client_registrations WHERE token = p_token FOR UPDATE;
  IF r.id IS NULL OR r.revoked_at IS NOT NULL THEN RAISE EXCEPTION 'This registration link is not valid.'; END IF;
  IF r.used_at IS NOT NULL THEN RAISE EXCEPTION 'This link was already used. Please contact TaxMate.'; END IF;
  IF r.expires_at < NOW() THEN RAISE EXCEPTION 'This link has expired. Please ask TaxMate for a new one.'; END IF;
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
    r.created_by, v_name,
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
      'consent_at', NOW())
  ) RETURNING id INTO cid;

  UPDATE public.client_registrations SET used_at = NOW(), client_id = cid WHERE id = r.id;
  RETURN jsonb_build_object('ok', true, 'name', v_name);
END $$;

REVOKE ALL ON FUNCTION public.get_registration(UUID) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.submit_registration(UUID, JSONB) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_registration(UUID) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.submit_registration(UUID, JSONB) TO anon, authenticated;
