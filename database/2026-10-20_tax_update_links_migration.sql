-- ═══════════════════════════════════════════════════════════
--  TaxMate V23 — Links on Tax Updates
--  An update can carry a link (IRD notice, blog post, video, PDF…)
--  that clients open from the portal. Only http(s) links are allowed.
-- ═══════════════════════════════════════════════════════════
ALTER TABLE public.tax_updates ADD COLUMN IF NOT EXISTS link_url   TEXT;
ALTER TABLE public.tax_updates ADD COLUMN IF NOT EXISTS link_label TEXT;
ALTER TABLE public.tax_updates DROP CONSTRAINT IF EXISTS tax_updates_link_url_check;
ALTER TABLE public.tax_updates ADD CONSTRAINT tax_updates_link_url_check
  CHECK (link_url IS NULL OR (link_url ~* '^https?://[^\s]+$' AND length(link_url) <= 2000));
ALTER TABLE public.tax_updates ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ;
