-- ═══════════════════════════════════════════════════════════
--  TaxMate V36 — RAMIS filing drafts (ADMIN ONLY)
--  One draft per client per Y/A, built from the final IIT computation,
--  the Monthly Income sheet, the Assets & Liabilities statement and the
--  client's documents. Laid out like the RAMIS "Individual income tax
--  filing summary" so TaxMate can key it into RAMIS. Clients never see it.
--  Safe to re-run.
-- ═══════════════════════════════════════════════════════════
CREATE TABLE IF NOT EXISTS public.filing_drafts (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id   UUID NOT NULL REFERENCES public.clients(id) ON DELETE CASCADE,
  year        TEXT NOT NULL CHECK (year ~ '^\d{4}/\d{2}$'),
  calc_id     UUID REFERENCES public.iit_calculations(id) ON DELETE SET NULL,
  status      TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'checked', 'filed')),
  data        JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_by  UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  updated_by  UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (client_id, year)
);
CREATE INDEX IF NOT EXISTS filing_drafts_client_idx ON public.filing_drafts (client_id, year);

ALTER TABLE public.filing_drafts ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Admins manage filing drafts" ON public.filing_drafts;
CREATE POLICY "Admins manage filing drafts" ON public.filing_drafts
  FOR ALL USING (is_admin()) WITH CHECK (is_admin());
-- No client policy: clients cannot read or write drafts.
REVOKE ALL ON public.filing_drafts FROM anon;

CREATE OR REPLACE FUNCTION public._touch_filing_draft()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN NEW.updated_at := NOW(); NEW.updated_by := auth.uid(); RETURN NEW; END $$;
DROP TRIGGER IF EXISTS filing_drafts_touch ON public.filing_drafts;
CREATE TRIGGER filing_drafts_touch BEFORE UPDATE ON public.filing_drafts
  FOR EACH ROW EXECUTE FUNCTION public._touch_filing_draft();
