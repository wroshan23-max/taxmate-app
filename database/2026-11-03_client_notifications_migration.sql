-- ═══════════════════════════════════════════════════════════
--  TaxMate V38 — Client notifications (bell icon in the portal header)
--  Created automatically by triggers when TaxMate does something for the
--  client (plan activated, invoice sent, payment confirmed, report ready …).
--  Clients read and mark their own; they cannot create or edit them.
--  Safe to re-run.
-- ═══════════════════════════════════════════════════════════
CREATE TABLE IF NOT EXISTS public.client_notifications (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id  UUID NOT NULL REFERENCES public.clients(id) ON DELETE CASCADE,
  kind       TEXT NOT NULL DEFAULT 'info',
  title      TEXT NOT NULL CHECK (length(title) BETWEEN 1 AND 160),
  body       TEXT CHECK (body IS NULL OR length(body) <= 500),
  link       TEXT CHECK (link IS NULL OR link ~ '^/client(/|$)'),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  read_at    TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS client_notifications_feed ON public.client_notifications (client_id, created_at DESC);
CREATE INDEX IF NOT EXISTS client_notifications_unread ON public.client_notifications (client_id) WHERE read_at IS NULL;
ALTER TABLE public.client_notifications ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Admins manage notifications" ON public.client_notifications;
CREATE POLICY "Admins manage notifications" ON public.client_notifications FOR ALL USING (is_admin()) WITH CHECK (is_admin());
DROP POLICY IF EXISTS "Clients read own notifications" ON public.client_notifications;
CREATE POLICY "Clients read own notifications" ON public.client_notifications FOR SELECT USING (client_id = my_client_id());

-- Live updates in the portal
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_publication WHERE pubname = 'supabase_realtime')
     AND NOT EXISTS (SELECT 1 FROM pg_publication_tables WHERE pubname = 'supabase_realtime' AND tablename = 'client_notifications') THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.client_notifications;
  END IF;
END $$;

-- Client: unread count, mark one / all as read
CREATE OR REPLACE FUNCTION public.my_unread_notifications()
RETURNS INT LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT count(*)::int FROM public.client_notifications WHERE client_id = my_client_id() AND read_at IS NULL;
$$;
REVOKE ALL ON FUNCTION public.my_unread_notifications() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.my_unread_notifications() TO authenticated;

CREATE OR REPLACE FUNCTION public.mark_my_notifications_read(p_id UUID DEFAULT NULL)
RETURNS VOID LANGUAGE sql SECURITY DEFINER SET search_path = public AS $$
  UPDATE public.client_notifications SET read_at = NOW()
   WHERE client_id = my_client_id() AND read_at IS NULL AND (p_id IS NULL OR id = p_id);
$$;
REVOKE ALL ON FUNCTION public.mark_my_notifications_read(UUID) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.mark_my_notifications_read(UUID) TO authenticated;

-- Internal: add a notification (old ones beyond 200 per client are trimmed)
CREATE OR REPLACE FUNCTION public._notify_client(p_client UUID, p_kind TEXT, p_title TEXT, p_body TEXT, p_link TEXT)
RETURNS VOID LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF p_client IS NULL THEN RETURN; END IF;
  INSERT INTO public.client_notifications (client_id, kind, title, body, link)
  VALUES (p_client, p_kind, left(p_title, 160), left(p_body, 500), p_link);
  DELETE FROM public.client_notifications WHERE client_id = p_client AND id IN (
    SELECT id FROM public.client_notifications WHERE client_id = p_client ORDER BY created_at DESC OFFSET 200);
END $$;
REVOKE ALL ON FUNCTION public._notify_client(UUID, TEXT, TEXT, TEXT, TEXT) FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public._rs(n NUMERIC) RETURNS TEXT LANGUAGE sql IMMUTABLE AS $$
  SELECT 'Rs. ' || to_char(coalesce(n, 0), 'FM999,999,999,990.00')
$$;

-- ═══ Triggers ═══════════════════════════════════════════════

-- Plans
CREATE OR REPLACE FUNCTION public._ntf_subscription() RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NEW.status = 'active' AND (TG_OP = 'INSERT' OR OLD.status <> 'active') THEN
    PERFORM _notify_client(NEW.client_id, 'plan',
      CASE WHEN TG_OP = 'UPDATE' AND OLD.status = 'paused' THEN 'Your ' || NEW.plan_name || ' plan is active again' ELSE 'Your ' || NEW.plan_name || ' plan is active 🎉' END,
      _rs(NEW.price) || ' per month' || CASE WHEN NEW.auto_invoice AND NEW.next_bill_date IS NOT NULL THEN ' · invoice every month from ' || to_char(NEW.next_bill_date, 'DD Mon YYYY') ELSE '' END || '. Thank you for choosing TaxMate!',
      '/client/plan');
  ELSIF TG_OP = 'UPDATE' AND NEW.status = 'paused' AND OLD.status = 'active' THEN
    PERFORM _notify_client(NEW.client_id, 'plan', 'Your ' || NEW.plan_name || ' plan is paused', 'No invoices while paused. Contact TaxMate to resume.', '/client/plan');
  ELSIF TG_OP = 'UPDATE' AND NEW.status = 'cancelled' AND OLD.status IN ('active', 'paused') AND coalesce(NEW.admin_note, '') NOT LIKE '%Replaced by%' THEN
    PERFORM _notify_client(NEW.client_id, 'plan', 'Your ' || NEW.plan_name || ' plan has ended', 'No more monthly invoices. You can choose a plan again any time.', '/client/plan');
  ELSIF TG_OP = 'UPDATE' AND NEW.status = 'cancelled' AND OLD.status = 'requested' AND is_admin() THEN
    PERFORM _notify_client(NEW.client_id, 'plan', 'About your ' || NEW.plan_name || ' plan request', 'TaxMate will contact you to discuss the best plan for you.', '/client/plan');
  ELSIF TG_OP = 'UPDATE' AND NEW.status = 'active' AND OLD.status = 'active' AND NEW.price <> OLD.price THEN
    PERFORM _notify_client(NEW.client_id, 'plan', 'Your ' || NEW.plan_name || ' plan price changed', 'New price: ' || _rs(NEW.price) || ' per month.', '/client/plan');
  END IF;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS ntf_subscription ON public.subscriptions;
CREATE TRIGGER ntf_subscription AFTER INSERT OR UPDATE OF status, price ON public.subscriptions
  FOR EACH ROW EXECUTE FUNCTION public._ntf_subscription();

-- Invoices: sent (unpaid) and paid
CREATE OR REPLACE FUNCTION public._ntf_invoice() RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NEW.status = 'unpaid' AND (TG_OP = 'INSERT' OR OLD.status = 'draft') THEN
    PERFORM _notify_client(NEW.client_id, 'invoice', 'New invoice ' || coalesce(NEW.invoice_no, '') || ' — ' || _rs(NEW.total_amount),
      CASE WHEN NEW.due_date IS NOT NULL THEN 'Due ' || to_char(NEW.due_date, 'DD Mon YYYY') || '. ' ELSE '' END || 'Pay online or by bank transfer from your portal.', '/client/invoices');
  ELSIF TG_OP = 'UPDATE' AND NEW.status = 'paid' AND OLD.status IS DISTINCT FROM 'paid' THEN
    PERFORM _notify_client(NEW.client_id, 'paid', 'Payment received — ' || coalesce(NEW.invoice_no, 'invoice'), _rs(NEW.total_amount) || ' received. Thank you!', '/client/invoices');
  END IF;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS ntf_invoice ON public.invoices;
CREATE TRIGGER ntf_invoice AFTER INSERT OR UPDATE OF status ON public.invoices
  FOR EACH ROW EXECUTE FUNCTION public._ntf_invoice();

-- Bank slip rejected
CREATE OR REPLACE FUNCTION public._ntf_payment() RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NEW.status = 'rejected' AND OLD.status IS DISTINCT FROM 'rejected' THEN
    PERFORM _notify_client(NEW.client_id, 'warning', 'We could not confirm your payment of ' || _rs(NEW.amount),
      coalesce('Reason: ' || nullif(NEW.admin_note, '') || '. ', '') || 'Please check the slip or contact TaxMate.', '/client/invoices');
  END IF;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS ntf_payment ON public.payments;
CREATE TRIGGER ntf_payment AFTER UPDATE OF status ON public.payments
  FOR EACH ROW EXECUTE FUNCTION public._ntf_payment();

-- Reports ready
CREATE OR REPLACE FUNCTION public._ntf_report() RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE nm TEXT := CASE TG_TABLE_NAME WHEN 'tax_reviews' THEN 'Annual Tax Review' ELSE 'Income & Tax summary letter' END;
BEGIN
  IF NEW.status = 'issued' AND OLD.status IS DISTINCT FROM 'issued' THEN
    PERFORM _notify_client(NEW.client_id, 'report', 'Your ' || nm || ' (Y/A ' || NEW.year || ') is ready',
      CASE WHEN NEW.invoice_id IS NOT NULL THEN 'Pay the invoice to download the PDF.' ELSE 'Download it from Tax Returns.' END, '/client/tax-returns');
  END IF;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS ntf_review ON public.tax_reviews;
CREATE TRIGGER ntf_review AFTER UPDATE OF status ON public.tax_reviews FOR EACH ROW EXECUTE FUNCTION public._ntf_report();
DROP TRIGGER IF EXISTS ntf_letter ON public.summary_letters;
CREATE TRIGGER ntf_letter AFTER UPDATE OF status ON public.summary_letters FOR EACH ROW EXECUTE FUNCTION public._ntf_report();

-- Service requests (updates by TaxMate)
CREATE OR REPLACE FUNCTION public._ntf_service() RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NOT is_admin() THEN RETURN NEW; END IF;   -- only TaxMate's updates (client cancelling is not notified)
  IF NEW.status IS DISTINCT FROM OLD.status OR NEW.scheduled_at IS DISTINCT FROM OLD.scheduled_at THEN
    PERFORM _notify_client(NEW.client_id, 'service',
      NEW.service || ': ' || CASE NEW.status WHEN 'contacted' THEN 'we contacted you' WHEN 'scheduled' THEN 'appointment booked' WHEN 'in_progress' THEN 'in progress'
                                           WHEN 'done' THEN 'completed ✅' WHEN 'cancelled' THEN 'cancelled' ELSE NEW.status END,
      CASE WHEN NEW.scheduled_at IS NOT NULL AND NEW.status NOT IN ('done', 'cancelled') THEN 'Appointment: ' || to_char(NEW.scheduled_at AT TIME ZONE 'Asia/Colombo', 'DD Mon YYYY, HH12:MI AM') || '. ' ELSE '' END
        || coalesce(NEW.admin_note, ''), '/client/services');
  END IF;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS ntf_service ON public.service_requests;
CREATE TRIGGER ntf_service AFTER UPDATE OF status, scheduled_at ON public.service_requests FOR EACH ROW EXECUTE FUNCTION public._ntf_service();

-- Tax return progress
CREATE OR REPLACE FUNCTION public._ntf_return() RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NEW.stage IS DISTINCT FROM OLD.stage AND NEW.stage IN ('computing', 'review', 'filed') THEN
    PERFORM _notify_client(NEW.client_id, CASE WHEN NEW.stage = 'filed' THEN 'success' ELSE 'return' END,
      CASE NEW.stage WHEN 'computing' THEN 'We are calculating your Y/A ' || NEW.year || ' tax'
                     WHEN 'review' THEN 'Your Y/A ' || NEW.year || ' return is ready to review'
                     ELSE 'Your Y/A ' || NEW.year || ' return is filed in RAMIS ✅' END,
      CASE NEW.stage WHEN 'review' THEN 'Please check the figures and confirm.' WHEN 'filed' THEN 'All done for this year — thank you!' ELSE NULL END,
      '/client/tax-returns');
  END IF;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS ntf_return ON public.tax_returns;
CREATE TRIGGER ntf_return AFTER UPDATE OF stage ON public.tax_returns FOR EACH ROW EXECUTE FUNCTION public._ntf_return();

-- Computation shared with the client
CREATE OR REPLACE FUNCTION public._ntf_calc() RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NEW.shared_with_client AND (TG_OP = 'INSERT' OR NOT coalesce(OLD.shared_with_client, false)) THEN
    PERFORM _notify_client(NEW.client_id, 'calc', 'Your Y/A ' || coalesce(NEW.year, '') || ' tax computation is ready',
      CASE WHEN coalesce(NEW.status, 'draft') = 'final' THEN 'Final figures from TaxMate.' ELSE 'Please review and confirm or ask for changes.' END, '/client/calculations');
  END IF;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS ntf_calc ON public.iit_calculations;
CREATE TRIGGER ntf_calc AFTER INSERT OR UPDATE OF shared_with_client ON public.iit_calculations FOR EACH ROW EXECUTE FUNCTION public._ntf_calc();

-- Sheets to fill
CREATE OR REPLACE FUNCTION public._ntf_sheet() RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE nm TEXT := CASE TG_TABLE_NAME WHEN 'asset_statements' THEN 'Assets & Liabilities statement' ELSE 'Monthly Income sheet' END;
        lk TEXT := CASE TG_TABLE_NAME WHEN 'asset_statements' THEN '/client/assets' ELSE '/client/income' END;
BEGIN
  IF NEW.enabled AND NEW.status = 'open' AND (TG_OP = 'INSERT' OR OLD.status <> 'open' OR NOT OLD.enabled) THEN
    PERFORM _notify_client(NEW.client_id, 'todo', 'Please fill your ' || nm || ' — Y/A ' || NEW.year,
      CASE WHEN TG_OP = 'UPDATE' AND OLD.status <> 'open' THEN coalesce('TaxMate reopened it: ' || nullif(NEW.admin_note, ''), 'TaxMate reopened it for changes.') ELSE 'It only takes a few minutes.' END, lk);
  END IF;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS ntf_assets ON public.asset_statements;
CREATE TRIGGER ntf_assets AFTER INSERT OR UPDATE OF status, enabled ON public.asset_statements FOR EACH ROW EXECUTE FUNCTION public._ntf_sheet();
DROP TRIGGER IF EXISTS ntf_income ON public.income_sheets;
CREATE TRIGGER ntf_income AFTER INSERT OR UPDATE OF status, enabled ON public.income_sheets FOR EACH ROW EXECUTE FUNCTION public._ntf_sheet();

-- Welcome note for clients who already have a live plan (one-time)
INSERT INTO public.client_notifications (client_id, kind, title, body, link)
SELECT s.client_id, 'plan', 'You''re on the ' || s.plan_name || ' plan', _rs(s.price) || ' per month. Notifications from TaxMate will appear here.', '/client/plan'
FROM public.subscriptions s
WHERE s.status = 'active' AND NOT EXISTS (SELECT 1 FROM public.client_notifications n WHERE n.client_id = s.client_id);
