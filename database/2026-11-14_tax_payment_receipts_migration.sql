-- ═══════════════════════════════════════════════════════════
--  TaxMate V58 — Tax payments: client marks paid + receipt, admin checks & reminds
--  • Due APIT / instalments show on the client's dashboard until paid
--  • The client marks one paid and uploads the receipt (bucket "payment-slips",
--    folder = client id) → it counts as paid and leaves the dashboard
--  • TaxMate checks the receipt (✓ Checked, or "Not accepted" → back to due)
--  • TaxMate can send a reminder for due / overdue payments (in-app notice;
--    WhatsApp / email text is built in the app)
--  Needs V57 (tax_payments). Safe to re-run.
-- ═══════════════════════════════════════════════════════════

ALTER TABLE public.tax_payments ADD COLUMN IF NOT EXISTS paid_by_role   TEXT;
ALTER TABLE public.tax_payments ADD COLUMN IF NOT EXISTS receipt_path   TEXT;
ALTER TABLE public.tax_payments ADD COLUMN IF NOT EXISTS receipt_name   TEXT;
ALTER TABLE public.tax_payments ADD COLUMN IF NOT EXISTS checked_at     TIMESTAMPTZ;
ALTER TABLE public.tax_payments ADD COLUMN IF NOT EXISTS checked_by     UUID REFERENCES auth.users(id) ON DELETE SET NULL;
ALTER TABLE public.tax_payments ADD COLUMN IF NOT EXISTS reminded_at    TIMESTAMPTZ;
ALTER TABLE public.tax_payments ADD COLUMN IF NOT EXISTS reminder_count INT NOT NULL DEFAULT 0;

ALTER TABLE public.tax_payments DROP CONSTRAINT IF EXISTS tax_payments_v58_chk;
ALTER TABLE public.tax_payments ADD CONSTRAINT tax_payments_v58_chk CHECK (
  (paid_by_role IS NULL OR paid_by_role IN ('admin', 'client'))
  AND (receipt_path IS NULL OR length(receipt_path) <= 300)
  AND (receipt_name IS NULL OR length(receipt_name) <= 200));

-- Rows paid before V58 were recorded by TaxMate
UPDATE public.tax_payments SET paid_by_role = 'admin', checked_at = coalesce(checked_at, updated_at)
 WHERE status = 'paid' AND paid_by_role IS NULL;

CREATE INDEX IF NOT EXISTS tax_payments_tocheck_idx ON public.tax_payments (created_at) WHERE paid_by_role = 'client' AND checked_at IS NULL;

-- ── Client: I've paid this (with the receipt) ──────────────
CREATE OR REPLACE FUNCTION public.mark_my_tax_payment_paid(p_id UUID, p_amount NUMERIC, p_paid_on DATE, p_reference TEXT, p_receipt_path TEXT, p_receipt_name TEXT)
RETURNS VOID LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE cid UUID := my_client_id(); r public.tax_payments;
BEGIN
  IF cid IS NULL THEN RAISE EXCEPTION 'Please sign in again.'; END IF;
  SELECT * INTO r FROM public.tax_payments WHERE id = p_id AND client_id = cid FOR UPDATE;
  IF r.id IS NULL THEN RAISE EXCEPTION 'Payment not found.'; END IF;
  IF r.status = 'paid' THEN RAISE EXCEPTION 'This payment is already marked as paid.'; END IF;
  IF p_amount IS NULL OR p_amount <= 0 OR p_amount > 999999999999 THEN RAISE EXCEPTION 'Please check the amount paid.'; END IF;
  IF p_paid_on IS NULL OR p_paid_on > CURRENT_DATE + 1 OR p_paid_on < CURRENT_DATE - 730 THEN RAISE EXCEPTION 'Please check the payment date.'; END IF;
  IF p_receipt_path IS NULL OR split_part(p_receipt_path, '/', 1) <> cid::text OR length(p_receipt_path) > 300 THEN
    RAISE EXCEPTION 'Please attach the payment receipt.'; END IF;
  UPDATE public.tax_payments SET status = 'paid', paid_amount = round(p_amount, 2), paid_on = p_paid_on,
         reference = nullif(left(trim(coalesce(p_reference, '')), 100), ''),
         receipt_path = p_receipt_path, receipt_name = nullif(left(trim(coalesce(p_receipt_name, '')), 200), ''),
         paid_by_role = 'client', checked_at = NULL, checked_by = NULL, updated_at = NOW()
   WHERE id = r.id;
END $$;
REVOKE ALL ON FUNCTION public.mark_my_tax_payment_paid(UUID, NUMERIC, DATE, TEXT, TEXT, TEXT) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.mark_my_tax_payment_paid(UUID, NUMERIC, DATE, TEXT, TEXT, TEXT) TO authenticated;

-- ── Client: undo my own mark (only while TaxMate has not checked it) ──
CREATE OR REPLACE FUNCTION public.undo_my_tax_payment_paid(p_id UUID)
RETURNS VOID LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE cid UUID := my_client_id();
BEGIN
  IF cid IS NULL THEN RAISE EXCEPTION 'Please sign in again.'; END IF;
  UPDATE public.tax_payments SET status = 'due', paid_amount = NULL, paid_on = NULL, reference = NULL,
         receipt_path = NULL, receipt_name = NULL, paid_by_role = NULL, updated_at = NOW()
   WHERE id = p_id AND client_id = cid AND status = 'paid' AND paid_by_role = 'client' AND checked_at IS NULL;
  IF NOT FOUND THEN RAISE EXCEPTION 'This payment cannot be changed now — please message TaxMate.'; END IF;
END $$;
REVOKE ALL ON FUNCTION public.undo_my_tax_payment_paid(UUID) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.undo_my_tax_payment_paid(UUID) TO authenticated;

-- ── Admin: receipt checked ✓ / not accepted (back to due, client told why) ──
CREATE OR REPLACE FUNCTION public.admin_check_tax_payment(p_id UUID, p_ok BOOLEAN, p_note TEXT DEFAULT NULL)
RETURNS VOID LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE r public.tax_payments; what TEXT;
BEGIN
  IF NOT is_admin() THEN RAISE EXCEPTION 'Admins only'; END IF;
  SELECT * INTO r FROM public.tax_payments WHERE id = p_id FOR UPDATE;
  IF r.id IS NULL OR r.status <> 'paid' THEN RAISE EXCEPTION 'Payment not found or not marked paid'; END IF;
  IF p_ok THEN
    UPDATE public.tax_payments SET checked_at = NOW(), checked_by = auth.uid(), updated_at = NOW() WHERE id = r.id;
  ELSE
    UPDATE public.tax_payments SET status = 'due', paid_amount = NULL, paid_on = NULL, reference = NULL,
           paid_by_role = NULL, checked_at = NULL, checked_by = NULL,
           note = nullif(left(trim(coalesce(p_note, '')), 500), ''), updated_at = NOW()
     WHERE id = r.id;      -- receipt_path is kept so TaxMate can still see what was sent
    what := CASE WHEN r.kind = 'instalment' THEN r.period || ' income tax instalment (Y/A ' || r.year || ')'
                 ELSE 'APIT for ' || to_char(to_date(r.period || '-01', 'YYYY-MM-DD'), 'FMMonth YYYY') END;
    PERFORM _notify_client(r.client_id, 'warning', 'Receipt not accepted — ' || what,
      coalesce(nullif(trim(p_note), ''), 'Please check the payment and upload the correct receipt.'), '/client');
  END IF;
END $$;
REVOKE ALL ON FUNCTION public.admin_check_tax_payment(UUID, BOOLEAN, TEXT) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_check_tax_payment(UUID, BOOLEAN, TEXT) TO authenticated;

-- ── Admin: remind the client about due payments (in-app notice + stamp) ──
CREATE OR REPLACE FUNCTION public.admin_remind_tax_payments(p_client UUID, p_ids UUID[])
RETURNS INT LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE n INT; total NUMERIC; late INT; first_due DATE;
BEGIN
  IF NOT is_admin() THEN RAISE EXCEPTION 'Admins only'; END IF;
  UPDATE public.tax_payments SET reminded_at = NOW(), reminder_count = reminder_count + 1
   WHERE client_id = p_client AND id = ANY (coalesce(p_ids, '{}')) AND status = 'due';
  GET DIAGNOSTICS n = ROW_COUNT;
  IF n = 0 THEN RETURN 0; END IF;
  SELECT sum(amount), count(*) FILTER (WHERE due_date < CURRENT_DATE), min(due_date) INTO total, late, first_due
    FROM public.tax_payments WHERE client_id = p_client AND id = ANY (p_ids) AND status = 'due';
  PERFORM _notify_client(p_client, CASE WHEN late > 0 THEN 'warning' ELSE 'info' END,
    'Reminder: ' || n || ' tax payment' || CASE WHEN n > 1 THEN 's' ELSE '' END || ' due — ' || _rs(total),
    CASE WHEN late > 0 THEN late || ' overdue. ' ELSE '' END ||
    CASE WHEN first_due IS NOT NULL THEN CASE WHEN late > 0 THEN 'Earliest was due ' ELSE 'Next due ' END || to_char(first_due, 'DD Mon YYYY') || '. ' ELSE '' END ||
    'After paying, tap "I''ve paid" on your dashboard and upload the receipt.', '/client');
  RETURN n;
END $$;
REVOKE ALL ON FUNCTION public.admin_remind_tax_payments(UUID, UUID[]) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_remind_tax_payments(UUID, UUID[]) TO authenticated;

-- ── Notices: no "recorded as paid" notice when the client marked it themselves ──
CREATE OR REPLACE FUNCTION public._ntf_tax_payment() RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE what TEXT; due TEXT;
BEGIN
  what := CASE WHEN NEW.kind = 'instalment' THEN NEW.period || ' income tax instalment (Y/A ' || NEW.year || ')'
               ELSE 'APIT for ' || to_char(to_date(NEW.period || '-01', 'YYYY-MM-DD'), 'FMMonth YYYY') END;
  due := CASE WHEN NEW.due_date IS NOT NULL THEN ' · due ' || to_char(NEW.due_date, 'DD Mon YYYY') ELSE '' END;
  IF TG_OP = 'INSERT' AND NEW.status = 'due' AND NEW.amount > 0 THEN
    PERFORM _notify_client(NEW.client_id, 'info', what || ': ' || _rs(NEW.amount), 'Worked out by TaxMate' || due || '. After paying, tap "I''ve paid" on your dashboard and upload the receipt.', '/client');
  ELSIF TG_OP = 'UPDATE' AND NEW.status = 'paid' AND OLD.status <> 'paid' AND coalesce(NEW.paid_by_role, 'admin') <> 'client' THEN
    PERFORM _notify_client(NEW.client_id, 'paid', what || ' recorded as paid', _rs(coalesce(NEW.paid_amount, NEW.amount)) ||
      CASE WHEN NEW.paid_on IS NOT NULL THEN ' on ' || to_char(NEW.paid_on, 'DD Mon YYYY') ELSE '' END || '. It will count in your tax return.', '/client/tax-returns');
  END IF;
  RETURN NEW;
END $$;

SELECT (SELECT count(*) FROM information_schema.columns WHERE table_name = 'tax_payments'
          AND column_name IN ('paid_by_role', 'receipt_path', 'receipt_name', 'checked_at', 'checked_by', 'reminded_at', 'reminder_count')) AS new_columns,
       to_regprocedure('public.mark_my_tax_payment_paid(uuid,numeric,date,text,text,text)') IS NOT NULL AS client_rpc,
       to_regprocedure('public.admin_remind_tax_payments(uuid,uuid[])') IS NOT NULL AS remind_rpc;
