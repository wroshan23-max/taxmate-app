-- ════════════════════════════════════════════════════════════════════════════
-- V71 — Final tax balance: mark as PAID (client or TaxMate) + optional receipt
--   • One record per client and Y/A (the balance payable on the FINAL computation).
--   • The client taps "I've paid" (amount, date, reference, receipt photo/PDF optional).
--     TaxMate checks it (✓ Checked, or "Not accepted" → the client is told why).
--   • TaxMate can record the payment too (counts as checked).
--   • The receipt is saved in the client's Documents (type "Filed return / receipt"),
--     so both sides see it there as well.
-- Safe to run more than once.
-- ════════════════════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS public.tax_balance_payments (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id      UUID NOT NULL REFERENCES public.clients(id) ON DELETE CASCADE,
  year           TEXT NOT NULL CHECK (year ~ '^\d{4}/\d{2}$'),
  calc_id        UUID REFERENCES public.iit_calculations(id) ON DELETE SET NULL,
  amount_due     NUMERIC(14,2) CHECK (amount_due IS NULL OR amount_due >= 0),
  paid_amount    NUMERIC(14,2) NOT NULL CHECK (paid_amount > 0 AND paid_amount <= 999999999999),
  paid_on        DATE NOT NULL,
  reference      TEXT CHECK (reference IS NULL OR length(reference) <= 100),
  receipt_doc_id UUID REFERENCES public.client_documents(id) ON DELETE SET NULL,
  paid_by_role   TEXT NOT NULL CHECK (paid_by_role IN ('admin', 'client')),
  marked_by      UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  checked_at     TIMESTAMPTZ,
  checked_by     UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  note           TEXT CHECK (note IS NULL OR length(note) <= 500),
  created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (client_id, year)
);
CREATE INDEX IF NOT EXISTS tax_balance_payments_tocheck_idx ON public.tax_balance_payments (created_at) WHERE paid_by_role = 'client' AND checked_at IS NULL;

ALTER TABLE public.tax_balance_payments ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Admins manage balance payments" ON public.tax_balance_payments;
CREATE POLICY "Admins manage balance payments" ON public.tax_balance_payments FOR ALL USING (public.is_admin()) WITH CHECK (public.is_admin());
DROP POLICY IF EXISTS "Clients read own balance payments" ON public.tax_balance_payments;
CREATE POLICY "Clients read own balance payments" ON public.tax_balance_payments FOR SELECT USING (client_id = public.my_client_id());
REVOKE ALL ON public.tax_balance_payments FROM anon;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.tax_balance_payments TO authenticated;

-- Internal: the receipt belongs to this client → file it as "Filed return / receipt"
-- (a client upload arrives as "IRD letters"; undo a checklist tick it may have caused)
CREATE OR REPLACE FUNCTION public._tbp_file_receipt(p_client UUID, p_doc UUID) RETURNS VOID
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF p_doc IS NULL THEN RETURN; END IF;
  IF NOT EXISTS (SELECT 1 FROM public.client_documents WHERE id = p_doc AND client_id = p_client) THEN
    RAISE EXCEPTION 'The receipt file was not found.';
  END IF;
  UPDATE public.client_documents SET category = 'return' WHERE id = p_doc AND category <> 'return';
  IF to_regclass('public.doc_checklist_items') IS NOT NULL THEN
    EXECUTE 'UPDATE public.doc_checklist_items SET status = ''needed'', document_id = NULL WHERE document_id = $1 AND status = ''received''' USING p_doc;
  END IF;
END $$;
REVOKE ALL ON FUNCTION public._tbp_file_receipt(UUID, UUID) FROM PUBLIC, anon, authenticated;

-- ── Client: I've paid (receipt optional) — also used to change an unchecked mark ──
CREATE OR REPLACE FUNCTION public.mark_my_tax_balance_paid(p_calc UUID, p_amount NUMERIC, p_paid_on DATE, p_reference TEXT, p_doc UUID)
RETURNS UUID LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE cid UUID := public.my_client_id(); c public.iit_calculations; old public.tax_balance_payments; nid UUID; nm TEXT;
BEGIN
  IF cid IS NULL THEN RAISE EXCEPTION 'Please sign in again.'; END IF;
  SELECT * INTO c FROM public.iit_calculations WHERE id = p_calc AND client_id = cid AND shared_with_client AND status = 'final';
  IF c.id IS NULL THEN RAISE EXCEPTION 'Calculation not found.'; END IF;
  IF p_amount IS NULL OR p_amount <= 0 OR p_amount > 999999999999 THEN RAISE EXCEPTION 'Please check the amount paid.'; END IF;
  IF p_paid_on IS NULL OR p_paid_on > CURRENT_DATE + 1 OR p_paid_on < CURRENT_DATE - 1100 THEN RAISE EXCEPTION 'Please check the payment date.'; END IF;
  SELECT * INTO old FROM public.tax_balance_payments WHERE client_id = cid AND year = c.year FOR UPDATE;
  IF old.id IS NOT NULL AND (old.paid_by_role = 'admin' OR old.checked_at IS NOT NULL) THEN
    RAISE EXCEPTION 'TaxMate has already recorded this payment.';
  END IF;
  PERFORM public._tbp_file_receipt(cid, p_doc);
  INSERT INTO public.tax_balance_payments AS t (client_id, year, calc_id, amount_due, paid_amount, paid_on, reference, receipt_doc_id, paid_by_role, marked_by)
  VALUES (cid, c.year, c.id, NULL, round(p_amount, 2), p_paid_on, nullif(left(trim(coalesce(p_reference, '')), 100), ''), p_doc, 'client', auth.uid())
  ON CONFLICT (client_id, year) DO UPDATE SET calc_id = EXCLUDED.calc_id, paid_amount = EXCLUDED.paid_amount, paid_on = EXCLUDED.paid_on,
    reference = EXCLUDED.reference, receipt_doc_id = coalesce(EXCLUDED.receipt_doc_id, t.receipt_doc_id), marked_by = EXCLUDED.marked_by,
    note = NULL, updated_at = NOW()
  RETURNING id INTO nid;
  SELECT full_name INTO nm FROM public.clients WHERE id = cid;
  BEGIN
    PERFORM public._push_send('admin', cid, '💰 ' || coalesce(nm, 'Client') || ' paid the Y/A ' || c.year || ' tax',
      _rs(round(p_amount, 2)) || ' on ' || to_char(p_paid_on, 'DD Mon YYYY') || CASE WHEN p_doc IS NULL THEN ' (no receipt yet)' ELSE ' · receipt attached' END || '. Please check.',
      '/admin/clients/' || cid || '?tab=calculations', 'tbp' || left(cid::text, 8));
  EXCEPTION WHEN undefined_function THEN NULL; END;
  RETURN nid;
END $$;
REVOKE ALL ON FUNCTION public.mark_my_tax_balance_paid(UUID, NUMERIC, DATE, TEXT, UUID) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.mark_my_tax_balance_paid(UUID, NUMERIC, DATE, TEXT, UUID) TO authenticated;

-- ── Client: add the receipt later (any time) ──
CREATE OR REPLACE FUNCTION public.my_tax_balance_receipt(p_id UUID, p_doc UUID)
RETURNS VOID LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE cid UUID := public.my_client_id(); r public.tax_balance_payments;
BEGIN
  IF cid IS NULL THEN RAISE EXCEPTION 'Please sign in again.'; END IF;
  SELECT * INTO r FROM public.tax_balance_payments WHERE id = p_id AND client_id = cid FOR UPDATE;
  IF r.id IS NULL THEN RAISE EXCEPTION 'Payment not found.'; END IF;
  IF p_doc IS NULL THEN RAISE EXCEPTION 'Please attach the receipt.'; END IF;
  PERFORM public._tbp_file_receipt(cid, p_doc);
  UPDATE public.tax_balance_payments SET receipt_doc_id = p_doc, updated_at = NOW() WHERE id = r.id;
  BEGIN
    PERFORM public._push_send('admin', cid, '🧾 Tax payment receipt added', 'Y/A ' || r.year || ' — please check.', '/admin/clients/' || cid || '?tab=calculations', 'tbp' || left(cid::text, 8));
  EXCEPTION WHEN undefined_function THEN NULL; END;
END $$;
REVOKE ALL ON FUNCTION public.my_tax_balance_receipt(UUID, UUID) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.my_tax_balance_receipt(UUID, UUID) TO authenticated;

-- ── Client: undo my own mark (only before TaxMate checked it; the receipt stays in Documents) ──
CREATE OR REPLACE FUNCTION public.undo_my_tax_balance_paid(p_id UUID)
RETURNS VOID LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE cid UUID := public.my_client_id();
BEGIN
  IF cid IS NULL THEN RAISE EXCEPTION 'Please sign in again.'; END IF;
  DELETE FROM public.tax_balance_payments WHERE id = p_id AND client_id = cid AND paid_by_role = 'client' AND checked_at IS NULL;
  IF NOT FOUND THEN RAISE EXCEPTION 'This payment cannot be changed now — please message TaxMate.'; END IF;
END $$;
REVOKE ALL ON FUNCTION public.undo_my_tax_balance_paid(UUID) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.undo_my_tax_balance_paid(UUID) TO authenticated;

-- ── TaxMate: record the payment (counts as checked) ──
CREATE OR REPLACE FUNCTION public.admin_tax_balance_paid(p_client UUID, p_year TEXT, p_calc UUID, p_amount_due NUMERIC, p_amount NUMERIC, p_paid_on DATE, p_reference TEXT, p_doc UUID)
RETURNS UUID LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE nid UUID;
BEGIN
  IF NOT public.is_admin() THEN RAISE EXCEPTION 'Admins only'; END IF;
  IF p_year IS NULL OR p_year !~ '^\d{4}/\d{2}$' THEN RAISE EXCEPTION 'Year of assessment?'; END IF;
  IF p_amount IS NULL OR p_amount <= 0 OR p_amount > 999999999999 THEN RAISE EXCEPTION 'Please check the amount paid.'; END IF;
  IF p_paid_on IS NULL OR p_paid_on > CURRENT_DATE + 1 THEN RAISE EXCEPTION 'Please check the payment date.'; END IF;
  IF p_calc IS NOT NULL AND NOT EXISTS (SELECT 1 FROM public.iit_calculations WHERE id = p_calc AND client_id = p_client) THEN RAISE EXCEPTION 'Calculation not found.'; END IF;
  PERFORM public._tbp_file_receipt(p_client, p_doc);
  INSERT INTO public.tax_balance_payments AS t (client_id, year, calc_id, amount_due, paid_amount, paid_on, reference, receipt_doc_id, paid_by_role, marked_by, checked_at, checked_by)
  VALUES (p_client, p_year, p_calc, round(p_amount_due, 2), round(p_amount, 2), p_paid_on, nullif(left(trim(coalesce(p_reference, '')), 100), ''), p_doc, 'admin', auth.uid(), NOW(), auth.uid())
  ON CONFLICT (client_id, year) DO UPDATE SET calc_id = coalesce(EXCLUDED.calc_id, t.calc_id), amount_due = coalesce(EXCLUDED.amount_due, t.amount_due),
    paid_amount = EXCLUDED.paid_amount, paid_on = EXCLUDED.paid_on, reference = EXCLUDED.reference,
    receipt_doc_id = coalesce(EXCLUDED.receipt_doc_id, t.receipt_doc_id),
    checked_at = coalesce(t.checked_at, NOW()), checked_by = coalesce(t.checked_by, auth.uid()), note = NULL, updated_at = NOW()
  RETURNING id INTO nid;
  PERFORM public._notify_client(p_client, 'paid', 'Y/A ' || p_year || ' income tax recorded as paid',
    _rs(round(p_amount, 2)) || ' on ' || to_char(p_paid_on, 'DD Mon YYYY') || '. Thank you!', '/client/calculations');
  RETURN nid;
END $$;
REVOKE ALL ON FUNCTION public.admin_tax_balance_paid(UUID, TEXT, UUID, NUMERIC, NUMERIC, DATE, TEXT, UUID) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_tax_balance_paid(UUID, TEXT, UUID, NUMERIC, NUMERIC, DATE, TEXT, UUID) TO authenticated;

-- ── TaxMate: client's mark checked ✓ / not accepted (removed, client told why) ──
CREATE OR REPLACE FUNCTION public.admin_check_tax_balance(p_id UUID, p_ok BOOLEAN, p_note TEXT DEFAULT NULL)
RETURNS VOID LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE r public.tax_balance_payments;
BEGIN
  IF NOT public.is_admin() THEN RAISE EXCEPTION 'Admins only'; END IF;
  SELECT * INTO r FROM public.tax_balance_payments WHERE id = p_id FOR UPDATE;
  IF r.id IS NULL THEN RAISE EXCEPTION 'Payment not found'; END IF;
  IF p_ok THEN
    UPDATE public.tax_balance_payments SET checked_at = NOW(), checked_by = auth.uid(), updated_at = NOW() WHERE id = r.id;
    PERFORM public._notify_client(r.client_id, 'paid', 'Y/A ' || r.year || ' tax payment confirmed ✓',
      _rs(r.paid_amount) || ' paid on ' || to_char(r.paid_on, 'DD Mon YYYY') || ' — checked by TaxMate. Thank you!', '/client/calculations');
  ELSE
    DELETE FROM public.tax_balance_payments WHERE id = r.id;     -- the receipt file stays in Documents
    PERFORM public._notify_client(r.client_id, 'warning', 'Tax payment not accepted — Y/A ' || r.year,
      coalesce(nullif(trim(p_note), ''), 'Please check the payment and send the correct receipt.'), '/client/calculations');
  END IF;
END $$;
REVOKE ALL ON FUNCTION public.admin_check_tax_balance(UUID, BOOLEAN, TEXT) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_check_tax_balance(UUID, BOOLEAN, TEXT) TO authenticated;

-- Check: table · RLS · client RPC
SELECT to_regclass('public.tax_balance_payments') IS NOT NULL AS table_ok,
       (SELECT relrowsecurity FROM pg_class WHERE oid = 'public.tax_balance_payments'::regclass) AS rls_on,
       to_regprocedure('public.mark_my_tax_balance_paid(uuid,numeric,date,text,uuid)') IS NOT NULL AS client_rpc_ok;
