-- ═══════════════════════════════════════════════════════════
--  TaxMate V32 — IRD / RAMIS filing details per client
--  TIN (clients.tin, as before) + RAMIS PIN + SSID (companies).
--  The PIN and SSID are encrypted (pgcrypto) with a key kept in Supabase Vault.
--  Nobody can read the table directly; only the functions below.
--  Admins can reveal a value (every reveal is logged). Clients can add or
--  replace their own details (with consent) but never read the secret back.
-- ═══════════════════════════════════════════════════════════

-- 1. Taxpayer type (SSID applies to companies / other entities)
ALTER TABLE public.clients ADD COLUMN IF NOT EXISTS client_type TEXT NOT NULL DEFAULT 'individual';
ALTER TABLE public.clients DROP CONSTRAINT IF EXISTS clients_client_type_check;
ALTER TABLE public.clients ADD CONSTRAINT clients_client_type_check CHECK (client_type IN ('individual', 'company', 'partnership', 'other'));

-- 2. Encryption key in Vault (created once)
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM vault.secrets WHERE name = 'taxmate_ird_key') THEN
    PERFORM vault.create_secret(encode(extensions.gen_random_bytes(32), 'base64'), 'taxmate_ird_key', 'Encrypts client RAMIS PIN / SSID');
  END IF;
END $$;

CREATE OR REPLACE FUNCTION public._ird_key()
RETURNS TEXT LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'taxmate_ird_key' LIMIT 1;
$$;
REVOKE ALL ON FUNCTION public._ird_key() FROM PUBLIC, anon, authenticated;

-- 3. Secret details + who looked at them
CREATE TABLE IF NOT EXISTS public.client_ird (
  client_id     UUID PRIMARY KEY REFERENCES public.clients(id) ON DELETE CASCADE,
  pin_enc       BYTEA,
  ssid_enc      BYTEA,
  consent_at    TIMESTAMPTZ,            -- client allowed TaxMate to use them for filing
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_by    UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  updated_role  TEXT NOT NULL DEFAULT 'admin' CHECK (updated_role IN ('admin', 'client')),
  seen_at       TIMESTAMPTZ             -- admin has seen a client's update
);
ALTER TABLE public.client_ird ENABLE ROW LEVEL SECURITY;   -- no policies: functions only

CREATE TABLE IF NOT EXISTS public.ird_access_log (
  id        BIGSERIAL PRIMARY KEY,
  client_id UUID NOT NULL REFERENCES public.clients(id) ON DELETE CASCADE,
  user_id   UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  action    TEXT NOT NULL,              -- view_pin, view_ssid, update, clear
  at        TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS ird_access_log_client_idx ON public.ird_access_log (client_id, at DESC);
ALTER TABLE public.ird_access_log ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Admins read IRD access log" ON public.ird_access_log;
CREATE POLICY "Admins read IRD access log" ON public.ird_access_log FOR SELECT USING (is_admin());

-- TIN: digits only, 9–12 long (spaces / dashes are removed)
CREATE OR REPLACE FUNCTION public._clean_tin(p TEXT)
RETURNS TEXT LANGUAGE plpgsql IMMUTABLE AS $$
DECLARE d TEXT := regexp_replace(coalesce(p, ''), '[\s\-/]', '', 'g');
BEGIN
  IF d = '' THEN RETURN NULL; END IF;
  IF d !~ '^\d{9,12}$' THEN RAISE EXCEPTION 'TIN must be 9 to 12 digits.'; END IF;
  RETURN d;
END $$;

-- Shared save: p_pin / p_ssid → NULL keep · '' clear · text set
CREATE OR REPLACE FUNCTION public._save_ird(p_client UUID, p_role TEXT, p_tin TEXT, p_pin TEXT, p_ssid TEXT, p_type TEXT, p_consent BOOLEAN)
RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, extensions AS $$
DECLARE k TEXT := public._ird_key(); pin TEXT := trim(p_pin); ssid TEXT := trim(p_ssid); acted TEXT[] := '{}';
BEGIN
  IF k IS NULL THEN RAISE EXCEPTION 'Encryption key missing — contact support.'; END IF;
  IF p_type IS NOT NULL AND p_type NOT IN ('individual', 'company', 'partnership', 'other') THEN RAISE EXCEPTION 'Unknown taxpayer type.'; END IF;
  IF pin IS NOT NULL AND pin <> '' AND (length(pin) < 4 OR length(pin) > 30) THEN RAISE EXCEPTION 'The RAMIS PIN looks wrong (4–30 characters).'; END IF;
  IF ssid IS NOT NULL AND ssid <> '' AND (length(ssid) < 3 OR length(ssid) > 40) THEN RAISE EXCEPTION 'The SSID looks wrong (3–40 characters).'; END IF;
  IF p_role = 'client' AND ((pin IS NOT NULL AND pin <> '') OR (ssid IS NOT NULL AND ssid <> '')) AND NOT coalesce(p_consent, false) THEN
    RAISE EXCEPTION 'Please tick the box to allow TaxMate to use these details for filing.';
  END IF;

  UPDATE public.clients SET
    tin = CASE WHEN p_tin IS NULL THEN tin ELSE public._clean_tin(p_tin) END,
    client_type = coalesce(p_type, client_type),
    updated_at = NOW()
  WHERE id = p_client;

  INSERT INTO public.client_ird (client_id) VALUES (p_client) ON CONFLICT (client_id) DO NOTHING;
  UPDATE public.client_ird SET
    pin_enc  = CASE WHEN pin IS NULL THEN pin_enc  WHEN pin  = '' THEN NULL ELSE pgp_sym_encrypt(pin, k) END,
    ssid_enc = CASE WHEN ssid IS NULL THEN ssid_enc WHEN ssid = '' THEN NULL ELSE pgp_sym_encrypt(ssid, k) END,
    consent_at = CASE WHEN p_role = 'client' AND coalesce(p_consent, false) THEN NOW() ELSE consent_at END,
    updated_at = NOW(), updated_by = auth.uid(), updated_role = p_role,
    seen_at = CASE WHEN p_role = 'admin' THEN NOW() ELSE NULL END
  WHERE client_id = p_client;

  IF p_tin IS NOT NULL THEN acted := acted || 'tin'; END IF;
  IF pin IS NOT NULL THEN acted := acted || CASE WHEN pin = '' THEN 'clear_pin' ELSE 'pin' END; END IF;
  IF ssid IS NOT NULL THEN acted := acted || CASE WHEN ssid = '' THEN 'clear_ssid' ELSE 'ssid' END; END IF;
  INSERT INTO public.ird_access_log (client_id, user_id, action) VALUES (p_client, auth.uid(), 'update:' || array_to_string(acted, ','));
  RETURN jsonb_build_object('ok', true);
END $$;
REVOKE ALL ON FUNCTION public._save_ird(UUID, TEXT, TEXT, TEXT, TEXT, TEXT, BOOLEAN) FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public._ird_summary(p_client UUID)
RETURNS JSONB LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT jsonb_build_object(
    'tin', c.tin, 'client_type', c.client_type,
    'has_pin', i.pin_enc IS NOT NULL, 'has_ssid', i.ssid_enc IS NOT NULL,
    'consent_at', i.consent_at, 'updated_at', i.updated_at, 'updated_role', i.updated_role, 'seen_at', i.seen_at,
    'updated_by_name', (SELECT full_name FROM public.profiles WHERE id = i.updated_by))
  FROM public.clients c LEFT JOIN public.client_ird i ON i.client_id = c.id WHERE c.id = p_client;
$$;
REVOKE ALL ON FUNCTION public._ird_summary(UUID) FROM PUBLIC, anon, authenticated;

-- 4. Client functions (own record only; no secret is ever returned)
CREATE OR REPLACE FUNCTION public.my_ird_details()
RETURNS JSONB LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE cid UUID := my_client_id();
BEGIN
  IF cid IS NULL THEN RAISE EXCEPTION 'Please sign in again.'; END IF;
  RETURN public._ird_summary(cid) - 'seen_at' - 'updated_by_name';
END $$;
REVOKE ALL ON FUNCTION public.my_ird_details() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.my_ird_details() TO authenticated;

CREATE OR REPLACE FUNCTION public.save_my_ird_details(p_tin TEXT, p_pin TEXT, p_ssid TEXT, p_client_type TEXT, p_consent BOOLEAN)
RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE cid UUID := my_client_id();
BEGIN
  IF cid IS NULL THEN RAISE EXCEPTION 'Please sign in again.'; END IF;
  IF (SELECT count(*) FROM public.ird_access_log WHERE client_id = cid AND user_id = auth.uid() AND at > NOW() - INTERVAL '1 hour') >= 20 THEN
    RAISE EXCEPTION 'Too many changes — please try again later.';
  END IF;
  RETURN public._save_ird(cid, 'client', p_tin, p_pin, p_ssid, p_client_type, p_consent);
END $$;
REVOKE ALL ON FUNCTION public.save_my_ird_details(TEXT, TEXT, TEXT, TEXT, BOOLEAN) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.save_my_ird_details(TEXT, TEXT, TEXT, TEXT, BOOLEAN) TO authenticated;

-- 5. Admin functions
CREATE OR REPLACE FUNCTION public.admin_ird_details(p_client UUID)
RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE s JSONB;
BEGIN
  IF NOT is_admin() THEN RAISE EXCEPTION 'Admins only'; END IF;
  s := public._ird_summary(p_client);
  UPDATE public.client_ird SET seen_at = NOW() WHERE client_id = p_client AND seen_at IS NULL;
  RETURN s || jsonb_build_object('log', (SELECT coalesce(jsonb_agg(jsonb_build_object('action', l.action, 'at', l.at, 'by', coalesce(p.full_name, 'Client')) ORDER BY l.at DESC), '[]'::jsonb)
    FROM (SELECT * FROM public.ird_access_log WHERE client_id = p_client ORDER BY at DESC LIMIT 8) l LEFT JOIN public.profiles p ON p.id = l.user_id));
END $$;
REVOKE ALL ON FUNCTION public.admin_ird_details(UUID) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_ird_details(UUID) TO authenticated;

CREATE OR REPLACE FUNCTION public.admin_reveal_ird(p_client UUID, p_field TEXT)
RETURNS TEXT LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, extensions AS $$
DECLARE v BYTEA;
BEGIN
  IF NOT is_admin() THEN RAISE EXCEPTION 'Admins only'; END IF;
  IF p_field NOT IN ('pin', 'ssid') THEN RAISE EXCEPTION 'Unknown field'; END IF;
  SELECT CASE p_field WHEN 'pin' THEN pin_enc ELSE ssid_enc END INTO v FROM public.client_ird WHERE client_id = p_client;
  IF v IS NULL THEN RETURN NULL; END IF;
  INSERT INTO public.ird_access_log (client_id, user_id, action) VALUES (p_client, auth.uid(), 'view_' || p_field);
  RETURN pgp_sym_decrypt(v, public._ird_key());
END $$;
REVOKE ALL ON FUNCTION public.admin_reveal_ird(UUID, TEXT) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_reveal_ird(UUID, TEXT) TO authenticated;

CREATE OR REPLACE FUNCTION public.admin_save_ird(p_client UUID, p_tin TEXT, p_pin TEXT, p_ssid TEXT, p_client_type TEXT)
RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NOT is_admin() THEN RAISE EXCEPTION 'Admins only'; END IF;
  IF NOT EXISTS (SELECT 1 FROM public.clients WHERE id = p_client) THEN RAISE EXCEPTION 'Client not found'; END IF;
  RETURN public._save_ird(p_client, 'admin', p_tin, p_pin, p_ssid, p_client_type, NULL);
END $$;
REVOKE ALL ON FUNCTION public.admin_save_ird(UUID, TEXT, TEXT, TEXT, TEXT) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_save_ird(UUID, TEXT, TEXT, TEXT, TEXT) TO authenticated;

-- Dashboard: clients who updated their IRD details and admin hasn't looked yet
CREATE OR REPLACE FUNCTION public.admin_ird_updates()
RETURNS JSONB LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NOT is_admin() THEN RAISE EXCEPTION 'Admins only'; END IF;
  RETURN (SELECT coalesce(jsonb_agg(jsonb_build_object('client_id', c.id, 'name', c.full_name, 'at', i.updated_at,
            'has_pin', i.pin_enc IS NOT NULL, 'has_ssid', i.ssid_enc IS NOT NULL) ORDER BY i.updated_at DESC), '[]'::jsonb)
          FROM public.client_ird i JOIN public.clients c ON c.id = i.client_id
          WHERE i.updated_role = 'client' AND i.seen_at IS NULL AND c.archived_at IS NULL);
END $$;
REVOKE ALL ON FUNCTION public.admin_ird_updates() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_ird_updates() TO authenticated;

-- Which clients have a RAMIS PIN saved (for the Clients list badge) — no secrets
CREATE OR REPLACE FUNCTION public.admin_ird_flags()
RETURNS JSONB LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NOT is_admin() THEN RAISE EXCEPTION 'Admins only'; END IF;
  RETURN (SELECT coalesce(jsonb_object_agg(client_id, jsonb_build_object('pin', pin_enc IS NOT NULL, 'ssid', ssid_enc IS NOT NULL)), '{}'::jsonb) FROM public.client_ird);
END $$;
REVOKE ALL ON FUNCTION public.admin_ird_flags() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_ird_flags() TO authenticated;
