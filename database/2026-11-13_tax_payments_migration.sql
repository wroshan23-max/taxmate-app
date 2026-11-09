-- ═══════════════════════════════════════════════════════════
--  TaxMate V57 — Tax payments allocated to a client
--  • Monthly APIT (calculated with the Monthly APIT calculator, one row per month)
--  • Quarterly IIT instalments (calculated with the Quarterly Instalment calculator, Q1–Q4)
--  Each row: the amount worked out, due date, and whether it was paid / deducted
--  (amount, date, reference). When TaxMate prepares the final IIT Return for that Y/A,
--  the paid amounts fill "Tax already paid" (APIT → cage 903, instalments → cage 911).
--  Clients can see their own schedule. Safe to re-run.
-- ═══════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS public.tax_payments (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id   UUID NOT NULL REFERENCES public.clients(id) ON DELETE CASCADE,
  year        TEXT NOT NULL CHECK (year ~ '^\d{4}/\d{2}$'),                 -- Y/A, e.g. 2025/26
  kind        TEXT NOT NULL CHECK (kind IN ('apit', 'instalment')),
  period      TEXT NOT NULL,                                              -- APIT: YYYY-MM · instalment: Q1–Q4
  basis       JSONB NOT NULL DEFAULT '{}'::jsonb CHECK (octet_length(basis::text) <= 20000),   -- calculator inputs
  amount      NUMERIC(14,2) NOT NULL DEFAULT 0 CHECK (amount >= 0),       -- worked out / due
  due_date    DATE,
  status      TEXT NOT NULL DEFAULT 'due' CHECK (status IN ('due', 'paid')),
  paid_amount NUMERIC(14,2) CHECK (paid_amount IS NULL OR paid_amount >= 0),
  paid_on     DATE,
  reference   TEXT CHECK (reference IS NULL OR length(reference) <= 100),
  note        TEXT CHECK (note IS NULL OR length(note) <= 500),
  created_by  UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CHECK ((kind = 'apit' AND period ~ '^\d{4}-(0[1-9]|1[0-2])$') OR (kind = 'instalment' AND period ~ '^Q[1-4]$')),
  UNIQUE (client_id, year, kind, period)
);
CREATE INDEX IF NOT EXISTS tax_payments_client_idx ON public.tax_payments (client_id, year, kind, period);
CREATE INDEX IF NOT EXISTS tax_payments_due_idx ON public.tax_payments (status, due_date);

ALTER TABLE public.tax_payments ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Admins manage tax payments" ON public.tax_payments;
CREATE POLICY "Admins manage tax payments" ON public.tax_payments FOR ALL USING (is_admin()) WITH CHECK (is_admin());
DROP POLICY IF EXISTS "Clients read own tax payments" ON public.tax_payments;
CREATE POLICY "Clients read own tax payments" ON public.tax_payments FOR SELECT USING (client_id = my_client_id());

-- 🔔 tell the client when TaxMate allocates an instalment / APIT amount, and when it is recorded as paid
CREATE OR REPLACE FUNCTION public._ntf_tax_payment() RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE what TEXT; due TEXT;
BEGIN
  what := CASE WHEN NEW.kind = 'instalment' THEN NEW.period || ' income tax instalment (Y/A ' || NEW.year || ')'
               ELSE 'APIT for ' || to_char(to_date(NEW.period || '-01', 'YYYY-MM-DD'), 'FMMonth YYYY') END;
  due := CASE WHEN NEW.due_date IS NOT NULL THEN ' · due ' || to_char(NEW.due_date, 'DD Mon YYYY') ELSE '' END;
  IF TG_OP = 'INSERT' AND NEW.status = 'due' AND NEW.amount > 0 THEN
    PERFORM _notify_client(NEW.client_id, 'info', what || ': ' || _rs(NEW.amount), 'Worked out by TaxMate' || due || '.', '/client/tax-returns');
  ELSIF TG_OP = 'UPDATE' AND NEW.status = 'paid' AND OLD.status <> 'paid' THEN
    PERFORM _notify_client(NEW.client_id, 'paid', what || ' recorded as paid', _rs(coalesce(NEW.paid_amount, NEW.amount)) ||
      CASE WHEN NEW.paid_on IS NOT NULL THEN ' on ' || to_char(NEW.paid_on, 'DD Mon YYYY') ELSE '' END || '. It will count in your tax return.', '/client/tax-returns');
  END IF;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS trg_ntf_tax_payment ON public.tax_payments;
CREATE TRIGGER trg_ntf_tax_payment AFTER INSERT OR UPDATE OF status ON public.tax_payments FOR EACH ROW EXECUTE FUNCTION public._ntf_tax_payment();

SELECT to_regclass('public.tax_payments') IS NOT NULL AS tax_payments_table,
       (SELECT count(*) FROM pg_policies WHERE tablename = 'tax_payments') AS policies;
