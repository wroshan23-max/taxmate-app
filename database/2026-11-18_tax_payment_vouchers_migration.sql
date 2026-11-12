-- ═══════════════════════════════════════════════════════════
--  TaxMate V62 — IRD payment voucher on APIT / instalment payments
--  • After TaxMate generates the payment voucher in RAMIS / IRD e-services,
--    the voucher number (and optionally the voucher PDF, kept in the client's
--    Documents → IRD payment voucher) is saved on the payment.
--  • It is shown on the client's dashboard and goes into the WhatsApp /
--    email reminder and the "share this payment" message.
--  • The client gets a portal notice (and phone push) when a voucher is added.
--  Needs V57 + V58 (tax_payments). Safe to re-run.
-- ═══════════════════════════════════════════════════════════

ALTER TABLE public.tax_payments ADD COLUMN IF NOT EXISTS voucher_no     TEXT;
ALTER TABLE public.tax_payments ADD COLUMN IF NOT EXISTS voucher_doc_id UUID REFERENCES public.client_documents(id) ON DELETE SET NULL;
ALTER TABLE public.tax_payments ADD COLUMN IF NOT EXISTS voucher_at     TIMESTAMPTZ;
ALTER TABLE public.tax_payments DROP CONSTRAINT IF EXISTS tax_payments_voucher_chk;
ALTER TABLE public.tax_payments ADD CONSTRAINT tax_payments_voucher_chk
  CHECK (voucher_no IS NULL OR voucher_no ~ '^[A-Za-z0-9][A-Za-z0-9 /._-]{0,39}$');

-- The voucher PDF must be one of this client's documents
CREATE OR REPLACE FUNCTION public._tax_payment_voucher_check() RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NEW.voucher_doc_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM public.client_documents WHERE id = NEW.voucher_doc_id AND client_id = NEW.client_id) THEN
    RAISE EXCEPTION 'The voucher file must be one of this client''s documents.';
  END IF;
  IF (NEW.voucher_no IS DISTINCT FROM OLD.voucher_no OR NEW.voucher_doc_id IS DISTINCT FROM OLD.voucher_doc_id) THEN
    NEW.voucher_at := CASE WHEN NEW.voucher_no IS NULL AND NEW.voucher_doc_id IS NULL THEN NULL ELSE NOW() END;
  END IF;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS trg_tax_payment_voucher_check ON public.tax_payments;
CREATE TRIGGER trg_tax_payment_voucher_check BEFORE INSERT OR UPDATE OF voucher_no, voucher_doc_id ON public.tax_payments
  FOR EACH ROW EXECUTE FUNCTION public._tax_payment_voucher_check();

-- Tell the client when a voucher number is added / changed (only while not paid yet)
CREATE OR REPLACE FUNCTION public._ntf_tax_payment_voucher() RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE what TEXT;
BEGIN
  IF NEW.status = 'due' AND NEW.voucher_no IS NOT NULL AND NEW.voucher_no IS DISTINCT FROM OLD.voucher_no THEN
    what := CASE WHEN NEW.kind = 'instalment' THEN NEW.period || ' income tax instalment (Y/A ' || NEW.year || ')'
                 ELSE 'APIT for ' || to_char(to_date(NEW.period || '-01', 'YYYY-MM-DD'), 'FMMonth YYYY') END;
    PERFORM _notify_client(NEW.client_id, 'info', 'Payment voucher ready — ' || what,
      'Voucher No. ' || NEW.voucher_no || ' · ' || _rs(NEW.amount) ||
      CASE WHEN NEW.due_date IS NOT NULL THEN ' · pay by ' || to_char(NEW.due_date, 'DD Mon YYYY') ELSE '' END ||
      '. After paying, tap "I''ve paid" and upload the receipt.', '/client');
  END IF;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS trg_ntf_tax_payment_voucher ON public.tax_payments;
CREATE TRIGGER trg_ntf_tax_payment_voucher AFTER UPDATE OF voucher_no ON public.tax_payments
  FOR EACH ROW EXECUTE FUNCTION public._ntf_tax_payment_voucher();

-- Admin page "Tax payments due": every unpaid payment, plus payments clients marked paid that still need the receipt checked
CREATE INDEX IF NOT EXISTS tax_payments_due_list_idx ON public.tax_payments (due_date) WHERE status = 'due';

SELECT (SELECT count(*) FROM information_schema.columns WHERE table_name = 'tax_payments' AND column_name IN ('voucher_no', 'voucher_doc_id', 'voucher_at')) AS voucher_columns,
       (SELECT count(*) FROM pg_trigger WHERE tgname IN ('trg_tax_payment_voucher_check', 'trg_ntf_tax_payment_voucher')) AS triggers;
