-- ═══════════════════════════════════════════════════════════
--  TaxMate V22 — Statement of Assets & Liabilities (per client, per Y/A)
--  * Admin enables a sheet for a client + year (prefilled from last year)
--  * Client fills it in the portal, saves drafts, then submits
--  * Admin reviews, reopens for changes, or marks it reviewed
-- ═══════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS public.asset_statements (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id      UUID NOT NULL REFERENCES public.clients(id) ON DELETE CASCADE,
  year           TEXT NOT NULL CHECK (year ~ '^\d{4}/\d{2}$'),
  status         TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'submitted', 'reviewed')),
  enabled        BOOLEAN NOT NULL DEFAULT TRUE,
  data           JSONB NOT NULL DEFAULT '{}'::jsonb,
  client_note    TEXT,
  admin_note     TEXT,
  prefilled_from UUID REFERENCES public.asset_statements(id) ON DELETE SET NULL,
  created_by     UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  submitted_at   TIMESTAMPTZ,
  reviewed_at    TIMESTAMPTZ,
  UNIQUE (client_id, year)
);
CREATE INDEX IF NOT EXISTS asset_statements_status_idx ON public.asset_statements (status, enabled);

ALTER TABLE public.asset_statements ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Admins manage asset statements" ON public.asset_statements;
CREATE POLICY "Admins manage asset statements" ON public.asset_statements
  FOR ALL USING (is_admin()) WITH CHECK (is_admin());

-- Clients only READ their own enabled sheets; all client writes go through the function below
DROP POLICY IF EXISTS "Clients read own asset statements" ON public.asset_statements;
CREATE POLICY "Clients read own asset statements" ON public.asset_statements
  FOR SELECT USING (enabled = TRUE AND client_id = my_client_id());

-- Client saves a draft or submits. Only while the sheet is enabled and open.
CREATE OR REPLACE FUNCTION public.save_my_asset_statement(p_id UUID, p_data JSONB, p_note TEXT, p_submit BOOLEAN)
RETURNS TEXT LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE s public.asset_statements;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'Please sign in again.'; END IF;
  SELECT * INTO s FROM public.asset_statements WHERE id = p_id;
  IF s.id IS NULL OR s.client_id IS DISTINCT FROM my_client_id() OR NOT s.enabled THEN
    RAISE EXCEPTION 'This form is not available.';
  END IF;
  IF s.status <> 'open' THEN
    RAISE EXCEPTION 'This form was already submitted. Please contact TaxMate to make changes.';
  END IF;
  IF p_data IS NULL OR jsonb_typeof(p_data) <> 'object' THEN RAISE EXCEPTION 'Invalid form data.'; END IF;
  IF octet_length(p_data::text) > 300000 THEN RAISE EXCEPTION 'The form is too large. Please contact TaxMate.'; END IF;

  UPDATE public.asset_statements SET
    data         = p_data,
    client_note  = NULLIF(left(trim(coalesce(p_note, '')), 2000), ''),
    updated_at   = NOW(),
    status       = CASE WHEN p_submit THEN 'submitted' ELSE 'open' END,
    submitted_at = CASE WHEN p_submit THEN NOW() ELSE submitted_at END
  WHERE id = p_id;
  RETURN CASE WHEN p_submit THEN 'submitted' ELSE 'saved' END;
END $$;

REVOKE ALL ON FUNCTION public.save_my_asset_statement(UUID, JSONB, TEXT, BOOLEAN) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.save_my_asset_statement(UUID, JSONB, TEXT, BOOLEAN) FROM anon;
GRANT EXECUTE ON FUNCTION public.save_my_asset_statement(UUID, JSONB, TEXT, BOOLEAN) TO authenticated;
