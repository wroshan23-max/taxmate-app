-- ════════════════════════════════════════════════════════════════════════════
-- V72 — Business & Freelance tool on the Monthly Income sheet
--   • income_sheets.biz_mode: TaxMate switches the tool on per client / Y/A.
--     When on, the client also enters detailed expenses (full bill amounts) and an equipment list.
--   • income_sheet_office: TaxMate's own working (work-use %, asset classes, allowances claimed before,
--     how deductions are shared between foreign-currency and local income). Staff only — clients
--     cannot read or change it.
-- Safe to run more than once.
-- ════════════════════════════════════════════════════════════════════════════

ALTER TABLE public.income_sheets ADD COLUMN IF NOT EXISTS biz_mode BOOLEAN NOT NULL DEFAULT false;

CREATE TABLE IF NOT EXISTS public.income_sheet_office (
  sheet_id   UUID PRIMARY KEY REFERENCES public.income_sheets(id) ON DELETE CASCADE,
  client_id  UUID NOT NULL REFERENCES public.clients(id) ON DELETE CASCADE,
  data       JSONB NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(data) = 'object' AND octet_length(data::text) <= 100000),
  updated_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
ALTER TABLE public.income_sheet_office ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Staff manage office working" ON public.income_sheet_office;
CREATE POLICY "Staff manage office working" ON public.income_sheet_office FOR ALL USING (public.is_admin()) WITH CHECK (public.is_admin());
REVOKE ALL ON public.income_sheet_office FROM anon;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.income_sheet_office TO authenticated;

CREATE OR REPLACE FUNCTION public._sheet_office_trg() RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  NEW.updated_at := NOW();
  NEW.updated_by := coalesce(auth.uid(), NEW.updated_by);
  SELECT client_id INTO NEW.client_id FROM public.income_sheets WHERE id = NEW.sheet_id;   -- always the sheet's own client
  IF NEW.client_id IS NULL THEN RAISE EXCEPTION 'Sheet not found'; END IF;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS trg_sheet_office ON public.income_sheet_office;
CREATE TRIGGER trg_sheet_office BEFORE INSERT OR UPDATE ON public.income_sheet_office FOR EACH ROW EXECUTE FUNCTION public._sheet_office_trg();

-- Check: column · table · RLS
SELECT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'income_sheets' AND column_name = 'biz_mode') AS biz_mode_ok,
       to_regclass('public.income_sheet_office') IS NOT NULL AS office_table_ok,
       (SELECT relrowsecurity FROM pg_class WHERE oid = 'public.income_sheet_office'::regclass) AS rls_on;
