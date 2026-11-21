-- ════════════════════════════════════════════════════════════════════════════
-- V67 — Card / online payments (PayHere)
--   • Admin phone alert + dashboard alert row when an online payment is confirmed
--   • Client paid from the invoice link (no login) → also noted in the client's bell
-- Safe to run more than once.
-- ════════════════════════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION public._push_admin_card_paid() RETURNS TRIGGER
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE nm TEXT; inv TEXT;
BEGIN
  IF NEW.method = 'payhere' AND NEW.status = 'paid' AND OLD.status IS DISTINCT FROM 'paid' THEN
    SELECT full_name INTO nm FROM public.clients WHERE id = NEW.client_id;
    SELECT invoice_no INTO inv FROM public.invoices WHERE id = NEW.invoice_id;
    PERFORM public._push_send('admin', NULL, '💳 Online payment — ' || coalesce(nm, 'Client'),
      public._rs(NEW.amount) || coalesce(' · invoice ' || inv, '') || coalesce(' · ' || NEW.card, '') || ' — marked paid', '/admin/payments', 'pay' || left(NEW.id::text, 8));
  END IF;
  RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION public._push_admin_card_paid() FROM PUBLIC, anon, authenticated;
DROP TRIGGER IF EXISTS trg_push_admin_card_paid ON public.payments;
CREATE TRIGGER trg_push_admin_card_paid AFTER UPDATE OF status ON public.payments
  FOR EACH ROW EXECUTE FUNCTION public._push_admin_card_paid();

-- Check: trigger installed · PayHere switch in Settings · online payments so far
SELECT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'trg_push_admin_card_paid') AS alert_ok,
       coalesce((SELECT (value->>'payhere')::boolean FROM public.app_settings WHERE key = 'payments'), false) AS payhere_switch_on,
       (SELECT count(*) FROM public.payments WHERE method = 'payhere' AND status = 'paid') AS online_payments_paid;
