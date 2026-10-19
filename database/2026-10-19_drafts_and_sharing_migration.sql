-- ════════════════════════════════════════════════════════════
--  TaxMate V20 — Draft/Final calculation versions, client review,
--  secure share links (WhatsApp / Email). Additive. Safe to re-run.
-- ════════════════════════════════════════════════════════════

-- 1. Calculation versions: several drafts per client & period, one final
ALTER TABLE public.iit_calculations
  ADD COLUMN IF NOT EXISTS status              TEXT DEFAULT 'draft',
  ADD COLUMN IF NOT EXISTS label               TEXT,
  ADD COLUMN IF NOT EXISTS finalized_at        TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS client_status       TEXT,
  ADD COLUMN IF NOT EXISTS client_note         TEXT,
  ADD COLUMN IF NOT EXISTS client_responded_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS share_token         UUID,
  ADD COLUMN IF NOT EXISTS updated_at          TIMESTAMPTZ;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'iit_calculations_status_check') THEN
    ALTER TABLE public.iit_calculations ADD CONSTRAINT iit_calculations_status_check CHECK (status IN ('draft', 'final'));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'iit_calculations_client_status_check') THEN
    ALTER TABLE public.iit_calculations ADD CONSTRAINT iit_calculations_client_status_check
      CHECK (client_status IS NULL OR client_status IN ('approved', 'changes_requested'));
  END IF;
END $$;
CREATE UNIQUE INDEX IF NOT EXISTS iit_calculations_share_token_uniq ON public.iit_calculations(share_token) WHERE share_token IS NOT NULL;

-- 2. Invoice share links
ALTER TABLE public.invoices ADD COLUMN IF NOT EXISTS share_token UUID;
CREATE UNIQUE INDEX IF NOT EXISTS invoices_share_token_uniq ON public.invoices(share_token) WHERE share_token IS NOT NULL;

-- 3. Public read of ONE shared document by its secret token (no login needed)
CREATE OR REPLACE FUNCTION public.get_shared_document(p_token UUID)
RETURNS JSON LANGUAGE sql SECURITY DEFINER STABLE SET search_path = public AS $$
  SELECT COALESCE(
    (SELECT json_build_object(
        'kind', 'calc',
        'calc', json_build_object('id', i.id, 'year', i.year, 'calc_type', i.calc_type, 'input_data', i.input_data,
                                  'status', i.status, 'label', i.label, 'created_at', i.created_at,
                                  'client_status', i.client_status, 'client_note', i.client_note),
        'client', json_build_object('full_name', c.full_name, 'tin', c.tin, 'nic', c.nic, 'address', c.address,
                                    'employer', c.employer, 'resident_status', c.resident_status))
     FROM iit_calculations i JOIN clients c ON c.id = i.client_id
     WHERE p_token IS NOT NULL AND i.share_token = p_token),
    (SELECT json_build_object(
        'kind', 'invoice',
        'invoice', (to_jsonb(v) - 'created_by' - 'share_token'),
        'clients', json_build_object('full_name', c.full_name, 'tin', c.tin, 'nic', c.nic, 'mobile', c.mobile, 'email', c.email, 'address', c.address),
        'items', (SELECT COALESCE(json_agg(to_jsonb(it) ORDER BY it.sort_order), '[]'::json) FROM invoice_items it WHERE it.invoice_id = v.id),
        'bank', (SELECT to_jsonb(b) FROM bank_accounts b WHERE b.id = v.bank_account_id))
     FROM invoices v LEFT JOIN clients c ON c.id = v.client_id
     WHERE p_token IS NOT NULL AND v.share_token = p_token)
  );
$$;

-- 4. Client confirms / requests changes — from the share link (token) …
CREATE OR REPLACE FUNCTION public.respond_shared_calc(p_token UUID, p_decision TEXT, p_note TEXT)
RETURNS JSON LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE r iit_calculations;
BEGIN
  IF p_decision NOT IN ('approved', 'changes_requested') THEN RAISE EXCEPTION 'invalid decision'; END IF;
  UPDATE iit_calculations
     SET client_status = p_decision, client_note = left(NULLIF(trim(p_note), ''), 2000), client_responded_at = NOW()
   WHERE p_token IS NOT NULL AND share_token = p_token
   RETURNING * INTO r;
  IF r.id IS NULL THEN RAISE EXCEPTION 'link not found'; END IF;
  RETURN json_build_object('client_status', r.client_status, 'client_note', r.client_note);
END $$;

-- … or from the client portal (signed-in client, own shared calculation)
CREATE OR REPLACE FUNCTION public.respond_my_calc(p_id UUID, p_decision TEXT, p_note TEXT)
RETURNS JSON LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE r iit_calculations;
BEGIN
  IF p_decision NOT IN ('approved', 'changes_requested') THEN RAISE EXCEPTION 'invalid decision'; END IF;
  UPDATE iit_calculations
     SET client_status = p_decision, client_note = left(NULLIF(trim(p_note), ''), 2000), client_responded_at = NOW()
   WHERE id = p_id AND client_id = my_client_id() AND shared_with_client = TRUE
   RETURNING * INTO r;
  IF r.id IS NULL THEN RAISE EXCEPTION 'calculation not found'; END IF;
  RETURN json_build_object('client_status', r.client_status, 'client_note', r.client_note);
END $$;

REVOKE ALL ON FUNCTION public.get_shared_document(UUID) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.respond_shared_calc(UUID, TEXT, TEXT) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.respond_my_calc(UUID, TEXT, TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_shared_document(UUID) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.respond_shared_calc(UUID, TEXT, TEXT) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.respond_my_calc(UUID, TEXT, TEXT) TO authenticated;

-- Check
SELECT json_build_object(
  'calc_cols', (SELECT json_agg(column_name ORDER BY ordinal_position) FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'iit_calculations'),
  'inv_has_token', (SELECT count(*) FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'invoices' AND column_name = 'share_token'),
  'functions', (SELECT json_agg(proname) FROM pg_proc WHERE proname IN ('get_shared_document', 'respond_shared_calc', 'respond_my_calc')),
  'calc_status_counts', (SELECT json_object_agg(status, n) FROM (SELECT status, count(*) n FROM public.iit_calculations GROUP BY status) s)
)::text AS migration_result;
