-- ════════════════════════════════════════════════════════════
--  TaxMate V18 — E-Invoice (V16 feature parity)
--  Additive only: adds columns/tables, widens the status check.
--  Existing invoices and items are not modified. Safe to re-run.
-- ════════════════════════════════════════════════════════════

-- 1. Bank accounts printed on invoices
CREATE TABLE IF NOT EXISTS public.bank_accounts (
  id           UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  bank_name    TEXT NOT NULL,
  account_name TEXT,
  account_no   TEXT NOT NULL,
  branch       TEXT,
  is_default   BOOLEAN DEFAULT FALSE,
  created_at   TIMESTAMPTZ DEFAULT NOW()
);
ALTER TABLE public.bank_accounts ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Admins manage bank accounts" ON public.bank_accounts;
CREATE POLICY "Admins manage bank accounts" ON public.bank_accounts FOR ALL USING (is_admin()) WITH CHECK (is_admin());
DROP POLICY IF EXISTS "Signed-in users read bank accounts" ON public.bank_accounts;
CREATE POLICY "Signed-in users read bank accounts" ON public.bank_accounts FOR SELECT USING (auth.uid() IS NOT NULL);

-- 2. Firm-wide settings (saved signature / stamp image)
CREATE TABLE IF NOT EXISTS public.app_settings (
  key        TEXT PRIMARY KEY,
  value      JSONB,
  updated_at TIMESTAMPTZ DEFAULT NOW()
);
ALTER TABLE public.app_settings ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Admins manage settings" ON public.app_settings;
CREATE POLICY "Admins manage settings" ON public.app_settings FOR ALL USING (is_admin()) WITH CHECK (is_admin());

-- 3. Invoice columns used by the V16 invoice form
ALTER TABLE public.invoices
  ADD COLUMN IF NOT EXISTS subtotal        NUMERIC,
  ADD COLUMN IF NOT EXISTS discount_pct    NUMERIC DEFAULT 0,
  ADD COLUMN IF NOT EXISTS discount_amt    NUMERIC DEFAULT 0,
  ADD COLUMN IF NOT EXISTS client_snapshot JSONB,
  ADD COLUMN IF NOT EXISTS bank_account_id UUID,
  ADD COLUMN IF NOT EXISTS signature       TEXT,
  ADD COLUMN IF NOT EXISTS paid_date       DATE,
  ADD COLUMN IF NOT EXISTS updated_at      TIMESTAMPTZ;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'invoices_bank_account_id_fkey') THEN
    ALTER TABLE public.invoices
      ADD CONSTRAINT invoices_bank_account_id_fkey FOREIGN KEY (bank_account_id)
      REFERENCES public.bank_accounts(id) ON DELETE SET NULL;
  END IF;
END $$;

ALTER TABLE public.invoice_items
  ADD COLUMN IF NOT EXISTS discount_pct NUMERIC DEFAULT 0,
  ADD COLUMN IF NOT EXISTS sort_order   INT DEFAULT 0;

-- 4. Status: add 'draft' (V16 flow draft → sent/unpaid → paid)
DO $$
DECLARE c RECORD;
BEGIN
  FOR c IN SELECT conname FROM pg_constraint
           WHERE conrelid = 'public.invoices'::regclass AND contype = 'c'
             AND pg_get_constraintdef(oid) ILIKE '%status%'
  LOOP
    EXECUTE format('ALTER TABLE public.invoices DROP CONSTRAINT %I', c.conname);
  END LOOP;
END $$;
ALTER TABLE public.invoices
  ADD CONSTRAINT invoices_status_check CHECK (status IN ('draft', 'unpaid', 'paid', 'overdue'));

-- 5. Invoice numbers must be unique (sequential numbering)
CREATE UNIQUE INDEX IF NOT EXISTS invoices_invoice_no_uniq ON public.invoices(invoice_no) WHERE invoice_no IS NOT NULL;

-- 6. Clients never see draft invoices
DROP POLICY IF EXISTS "Clients can read own invoices" ON public.invoices;
CREATE POLICY "Clients can read own invoices" ON public.invoices
  FOR SELECT USING (client_id = my_client_id() AND status <> 'draft');

-- Check
SELECT json_build_object(
  'invoice_cols', (SELECT json_agg(column_name ORDER BY ordinal_position) FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'invoices'),
  'item_cols',    (SELECT json_agg(column_name ORDER BY ordinal_position) FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'invoice_items'),
  'status_check', (SELECT pg_get_constraintdef(oid) FROM pg_constraint WHERE conname = 'invoices_status_check'),
  'invoice_count',(SELECT count(*) FROM public.invoices)
)::text AS migration_result;
