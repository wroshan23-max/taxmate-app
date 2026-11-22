-- ════════════════════════════════════════════════════════════════════════════
-- V74 — Tax & Accounting service packages
--   • Clients pick a package for a Y/A in the portal (Personal local / local + foreign, Freelancer,
--     Senior citizen, Sole proprietor, Partnership, Private limited company, Nil return).
--   • Prices and on/off come from Settings → Packages (app_settings 'packages'); the defaults below
--     are used until TaxMate saves its own list.
--   • A Nil return is not allowed when the client's computation shows income tax: the app moves the
--     client to the suitable package (selected_by = 'auto', the reason is kept).
--   • Every selection or change also lands in Service Requests (Dashboard alert + push).
-- Safe to run more than once.
-- ════════════════════════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION public._package_list() RETURNS JSONB LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT coalesce((SELECT value->'list' FROM public.app_settings WHERE key = 'packages' AND jsonb_typeof(value->'list') = 'array'), '[
    {"key":"personal_local","name":"Personal Tax File — Local income only","price":10000,"from":true,"active":true},
    {"key":"personal_fx","name":"Personal Tax File — Local + Foreign income","price":15000,"from":true,"active":true},
    {"key":"freelancer","name":"Freelancer / Service Exporter","price":15000,"from":true,"active":true},
    {"key":"senior","name":"Senior Citizen Tax File","price":10000,"from":true,"active":true},
    {"key":"sole","name":"Sole Proprietor","price":25000,"from":true,"active":true},
    {"key":"partnership","name":"Partnership","price":25000,"from":true,"active":true},
    {"key":"company","name":"Private Limited Company","price":80000,"from":true,"active":true},
    {"key":"nil","name":"Nil Return File","price":3000,"from":false,"active":true}]'::jsonb);
$$;
REVOKE ALL ON FUNCTION public._package_list() FROM PUBLIC, anon, authenticated;

-- Packages the portal shows (active ones only; price list from Settings → Packages)
CREATE OR REPLACE FUNCTION public.package_list() RETURNS JSONB LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT coalesce(jsonb_agg(x), '[]'::jsonb) FROM jsonb_array_elements(public._package_list()) x WHERE coalesce((x->>'active')::boolean, true);
$$;
REVOKE ALL ON FUNCTION public.package_list() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.package_list() TO authenticated;

CREATE TABLE IF NOT EXISTS public.client_packages (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id      UUID NOT NULL REFERENCES public.clients(id) ON DELETE CASCADE,
  year           TEXT NOT NULL CHECK (year ~ '^\d{4}/\d{2}$'),
  package_key    TEXT NOT NULL CHECK (length(package_key) BETWEEN 2 AND 30),
  package_name   TEXT NOT NULL CHECK (length(package_name) <= 120),
  price          NUMERIC(12,2) CHECK (price IS NULL OR price >= 0),
  price_from     BOOLEAN NOT NULL DEFAULT true,
  selected_by    TEXT NOT NULL CHECK (selected_by IN ('client', 'admin', 'auto')),
  previous_key   TEXT CHECK (previous_key IS NULL OR length(previous_key) <= 30),
  previous_name  TEXT CHECK (previous_name IS NULL OR length(previous_name) <= 120),
  change_reason  TEXT CHECK (change_reason IS NULL OR length(change_reason) <= 500),
  client_note    TEXT CHECK (client_note IS NULL OR length(client_note) <= 500),
  confirmed_at   TIMESTAMPTZ,
  confirmed_by   UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (client_id, year)
);
ALTER TABLE public.client_packages ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Admins manage client packages" ON public.client_packages;
CREATE POLICY "Admins manage client packages" ON public.client_packages FOR ALL USING (public.is_admin()) WITH CHECK (public.is_admin());
DROP POLICY IF EXISTS "Clients read own packages" ON public.client_packages;
CREATE POLICY "Clients read own packages" ON public.client_packages FOR SELECT USING (client_id = public.my_client_id());
REVOKE ALL ON public.client_packages FROM anon;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.client_packages TO authenticated;

-- Internal: write the selection (one per client and Y/A) + a service request for TaxMate
CREATE OR REPLACE FUNCTION public._set_package(p_client UUID, p_year TEXT, p_key TEXT, p_by TEXT, p_reason TEXT, p_note TEXT)
RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE pk JSONB; old public.client_packages; res public.client_packages; nm TEXT; what TEXT;
BEGIN
  IF p_year IS NULL OR p_year !~ '^\d{4}/\d{2}$' THEN RAISE EXCEPTION 'Year of assessment?'; END IF;
  SELECT x INTO pk FROM jsonb_array_elements(public._package_list()) x WHERE x->>'key' = p_key AND coalesce((x->>'active')::boolean, true) LIMIT 1;
  IF pk IS NULL THEN RAISE EXCEPTION 'This package is not available.'; END IF;
  SELECT * INTO old FROM public.client_packages WHERE client_id = p_client AND year = p_year FOR UPDATE;
  IF old.id IS NOT NULL AND old.package_key = p_key THEN
    UPDATE public.client_packages SET client_note = coalesce(nullif(left(trim(coalesce(p_note, '')), 500), ''), client_note), updated_at = NOW()
     WHERE id = old.id RETURNING * INTO res;
    RETURN to_jsonb(res);
  END IF;
  INSERT INTO public.client_packages AS t (client_id, year, package_key, package_name, price, price_from, selected_by, previous_key, previous_name, change_reason, client_note)
  VALUES (p_client, p_year, p_key, left(pk->>'name', 120), nullif(pk->>'price', '')::numeric, coalesce((pk->>'from')::boolean, true), p_by,
          old.package_key, old.package_name, nullif(left(trim(coalesce(p_reason, '')), 500), ''), nullif(left(trim(coalesce(p_note, '')), 500), ''))
  ON CONFLICT (client_id, year) DO UPDATE SET package_key = EXCLUDED.package_key, package_name = EXCLUDED.package_name, price = EXCLUDED.price,
    price_from = EXCLUDED.price_from, selected_by = EXCLUDED.selected_by, previous_key = EXCLUDED.previous_key, previous_name = EXCLUDED.previous_name,
    change_reason = EXCLUDED.change_reason, client_note = coalesce(EXCLUDED.client_note, t.client_note),
    confirmed_at = CASE WHEN p_by = 'admin' THEN NOW() ELSE NULL END, confirmed_by = CASE WHEN p_by = 'admin' THEN auth.uid() ELSE NULL END, updated_at = NOW()
  RETURNING * INTO res;
  IF p_by = 'admin' AND old.id IS NULL THEN
    UPDATE public.client_packages SET confirmed_at = NOW(), confirmed_by = auth.uid() WHERE id = res.id RETURNING * INTO res;
  END IF;

  what := 'Tax package Y/A ' || p_year || ': ' || res.package_name;
  IF p_by <> 'admin' THEN
    INSERT INTO public.service_requests (client_id, service, details, contact_method, created_by)
    VALUES (p_client, left(CASE WHEN p_by = 'auto' THEN 'Package changed' ELSE 'Tax package' END, 80),
      left(what || CASE WHEN res.price IS NOT NULL THEN ' (' || CASE WHEN res.price_from THEN 'from ' ELSE '' END || 'Rs. ' || to_char(res.price, 'FM999,999,999') || ')' ELSE '' END
        || CASE WHEN old.package_name IS NOT NULL THEN E'\nWas: ' || old.package_name ELSE '' END
        || CASE WHEN res.change_reason IS NOT NULL THEN E'\nReason: ' || res.change_reason ELSE '' END
        || CASE WHEN res.client_note IS NOT NULL THEN E'\nNote: ' || res.client_note ELSE '' END, 1000),
      'whatsapp', auth.uid());
  END IF;
  IF p_by IN ('admin', 'auto') THEN
    PERFORM public._notify_client(p_client, 'info', what,
      coalesce(res.change_reason, CASE WHEN old.package_name IS NOT NULL THEN 'Changed from ' || old.package_name || '.' ELSE 'Set by TaxMate.' END), '/client/packages');
  END IF;
  BEGIN
    SELECT full_name INTO nm FROM public.clients WHERE id = p_client;
    IF p_by <> 'admin' THEN
      PERFORM public._push_send('admin', p_client, CASE WHEN p_by = 'auto' THEN '🔁 ' ELSE '📦 ' END || coalesce(nm, 'Client') || ' — ' || res.package_name,
        'Y/A ' || p_year || CASE WHEN p_by = 'auto' THEN ' · moved from ' || coalesce(old.package_name, 'Nil return') ELSE ' · package selected' END,
        '/admin/clients/' || p_client, 'pkg' || left(p_client::text, 8));
    END IF;
  EXCEPTION WHEN undefined_function THEN NULL; END;
  RETURN to_jsonb(res);
END $$;
REVOKE ALL ON FUNCTION public._set_package(UUID, TEXT, TEXT, TEXT, TEXT, TEXT) FROM PUBLIC, anon, authenticated;

-- Client: choose a package for a Y/A
CREATE OR REPLACE FUNCTION public.my_select_package(p_year TEXT, p_key TEXT, p_note TEXT DEFAULT NULL)
RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE cid UUID := public.my_client_id();
BEGIN
  IF cid IS NULL THEN RAISE EXCEPTION 'Please sign in again.'; END IF;
  RETURN public._set_package(cid, p_year, p_key, 'client', NULL, p_note);
END $$;
REVOKE ALL ON FUNCTION public.my_select_package(TEXT, TEXT, TEXT) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.my_select_package(TEXT, TEXT, TEXT) TO authenticated;

-- Client app: the computation shows income tax but the package is "Nil return" → move to the suitable one
CREATE OR REPLACE FUNCTION public.my_package_auto_upgrade(p_year TEXT, p_key TEXT, p_reason TEXT)
RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE cid UUID := public.my_client_id(); cur TEXT;
BEGIN
  IF cid IS NULL THEN RAISE EXCEPTION 'Please sign in again.'; END IF;
  SELECT package_key INTO cur FROM public.client_packages WHERE client_id = cid AND year = p_year;
  IF cur IS DISTINCT FROM 'nil' THEN RETURN NULL; END IF;                       -- only a Nil return is moved
  IF p_key NOT IN ('personal_local', 'personal_fx', 'freelancer', 'senior', 'sole') THEN RAISE EXCEPTION 'Package?'; END IF;
  RETURN public._set_package(cid, p_year, p_key, 'auto', p_reason, NULL);
END $$;
REVOKE ALL ON FUNCTION public.my_package_auto_upgrade(TEXT, TEXT, TEXT) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.my_package_auto_upgrade(TEXT, TEXT, TEXT) TO authenticated;

-- TaxMate: set / change / confirm a client's package (p_auto = moved because of the computation)
CREATE OR REPLACE FUNCTION public.admin_set_package(p_client UUID, p_year TEXT, p_key TEXT, p_reason TEXT DEFAULT NULL, p_auto BOOLEAN DEFAULT false)
RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NOT public.is_admin() THEN RAISE EXCEPTION 'Admins only'; END IF;
  RETURN public._set_package(p_client, p_year, p_key, CASE WHEN p_auto THEN 'auto' ELSE 'admin' END, p_reason, NULL);
END $$;
REVOKE ALL ON FUNCTION public.admin_set_package(UUID, TEXT, TEXT, TEXT, BOOLEAN) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_set_package(UUID, TEXT, TEXT, TEXT, BOOLEAN) TO authenticated;

CREATE OR REPLACE FUNCTION public.admin_confirm_package(p_id UUID)
RETURNS VOID LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE r public.client_packages;
BEGIN
  IF NOT public.is_admin() THEN RAISE EXCEPTION 'Admins only'; END IF;
  UPDATE public.client_packages SET confirmed_at = NOW(), confirmed_by = auth.uid(), updated_at = NOW() WHERE id = p_id RETURNING * INTO r;
  IF r.id IS NULL THEN RAISE EXCEPTION 'Not found'; END IF;
  PERFORM public._notify_client(r.client_id, 'info', 'Package confirmed — Y/A ' || r.year, r.package_name || ' · TaxMate will start on your return.', '/client/packages');
END $$;
REVOKE ALL ON FUNCTION public.admin_confirm_package(UUID) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_confirm_package(UUID) TO authenticated;

-- Portal menu switch: "Tax packages" (on unless switched off in Settings → Client Portal)
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
    'packages',       _feature_on(cid, 'packages'),
    'referral_reward', coalesce((SELECT value->>'referral_reward' FROM public.app_settings WHERE key = 'client_tools'), ''),
    'income_sheets', coalesce(n, 0));
END $$;
REVOKE ALL ON FUNCTION public.my_portal_features() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.my_portal_features() TO authenticated;

-- Check: table · RLS · client RPC · packages available
SELECT to_regclass('public.client_packages') IS NOT NULL AS table_ok,
       (SELECT relrowsecurity FROM pg_class WHERE oid = 'public.client_packages'::regclass) AS rls_on,
       to_regprocedure('public.my_select_package(text,text,text)') IS NOT NULL AS client_rpc_ok,
       jsonb_array_length(public._package_list()) AS packages;
