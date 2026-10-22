-- ═══════════════════════════════════════════════════════════
--  TaxMate V27 — Monthly Income & Business sheet + Tax Calculator on/off
-- ═══════════════════════════════════════════════════════════

-- 1. Monthly income & business sheet (one per client per Y/A)
CREATE TABLE IF NOT EXISTS public.income_sheets (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id    UUID NOT NULL REFERENCES public.clients(id) ON DELETE CASCADE,
  year         TEXT NOT NULL CHECK (year ~ '^\d{4}/\d{2}$'),
  status       TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'submitted', 'reviewed')),
  enabled      BOOLEAN NOT NULL DEFAULT TRUE,
  data         JSONB NOT NULL DEFAULT '{}'::jsonb,
  client_note  TEXT,
  admin_note   TEXT,
  created_by   UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  submitted_at TIMESTAMPTZ,
  reviewed_at  TIMESTAMPTZ,
  UNIQUE (client_id, year)
);
CREATE INDEX IF NOT EXISTS income_sheets_status_idx ON public.income_sheets (status, enabled);
ALTER TABLE public.income_sheets ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Admins manage income sheets" ON public.income_sheets;
CREATE POLICY "Admins manage income sheets" ON public.income_sheets
  FOR ALL USING (is_admin()) WITH CHECK (is_admin());
DROP POLICY IF EXISTS "Clients read own income sheets" ON public.income_sheets;
CREATE POLICY "Clients read own income sheets" ON public.income_sheets
  FOR SELECT USING (enabled = TRUE AND client_id = my_client_id());

CREATE OR REPLACE FUNCTION public.save_my_income_sheet(p_id UUID, p_data JSONB, p_note TEXT, p_submit BOOLEAN)
RETURNS TEXT LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE s public.income_sheets;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'Please sign in again.'; END IF;
  SELECT * INTO s FROM public.income_sheets WHERE id = p_id;
  IF s.id IS NULL OR s.client_id IS DISTINCT FROM my_client_id() OR NOT s.enabled THEN
    RAISE EXCEPTION 'This sheet is not available.';
  END IF;
  IF s.status <> 'open' THEN
    RAISE EXCEPTION 'This sheet was already submitted. Please contact TaxMate to make changes.';
  END IF;
  IF p_data IS NULL OR jsonb_typeof(p_data) <> 'object' THEN RAISE EXCEPTION 'Invalid data.'; END IF;
  IF octet_length(p_data::text) > 200000 THEN RAISE EXCEPTION 'The sheet is too large. Please contact TaxMate.'; END IF;
  UPDATE public.income_sheets SET
    data         = p_data,
    client_note  = NULLIF(left(trim(coalesce(p_note, '')), 2000), ''),
    updated_at   = NOW(),
    status       = CASE WHEN p_submit THEN 'submitted' ELSE 'open' END,
    submitted_at = CASE WHEN p_submit THEN NOW() ELSE submitted_at END
  WHERE id = p_id;
  RETURN CASE WHEN p_submit THEN 'submitted' ELSE 'saved' END;
END $$;
REVOKE ALL ON FUNCTION public.save_my_income_sheet(UUID, JSONB, TEXT, BOOLEAN) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.save_my_income_sheet(UUID, JSONB, TEXT, BOOLEAN) FROM anon;
GRANT EXECUTE ON FUNCTION public.save_my_income_sheet(UUID, JSONB, TEXT, BOOLEAN) TO authenticated;

-- 2. Client Tax Calculator on/off: global switch (Settings) + per-client override
ALTER TABLE public.clients ADD COLUMN IF NOT EXISTS tax_calc TEXT NOT NULL DEFAULT 'default';
ALTER TABLE public.clients DROP CONSTRAINT IF EXISTS clients_tax_calc_check;
ALTER TABLE public.clients ADD CONSTRAINT clients_tax_calc_check CHECK (tax_calc IN ('default', 'on', 'off'));

INSERT INTO public.app_settings (key, value) VALUES ('client_tools', '{"tax_calculator": true}'::jsonb)
ON CONFLICT (key) DO NOTHING;

-- What the signed-in client's portal shows
CREATE OR REPLACE FUNCTION public.my_portal_features()
RETURNS JSONB LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE cid UUID := my_client_id(); g BOOLEAN; o TEXT; n INT;
BEGIN
  SELECT coalesce((value->>'tax_calculator')::boolean, true) INTO g FROM public.app_settings WHERE key = 'client_tools';
  g := coalesce(g, true);
  SELECT tax_calc INTO o FROM public.clients WHERE id = cid;
  SELECT count(*) INTO n FROM public.income_sheets WHERE client_id = cid AND enabled;
  RETURN jsonb_build_object(
    'tax_calculator', CASE coalesce(o, 'default') WHEN 'on' THEN true WHEN 'off' THEN false ELSE g END,
    'income_sheets', coalesce(n, 0));
END $$;
REVOKE ALL ON FUNCTION public.my_portal_features() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.my_portal_features() FROM anon;
GRANT EXECUTE ON FUNCTION public.my_portal_features() TO authenticated;
