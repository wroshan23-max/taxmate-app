-- ═══════════════════════════════════════════════════════════
--  TaxMate V37 — Subscription plans (monthly) + Annual Tax Review reports
--  Safe to re-run.
-- ═══════════════════════════════════════════════════════════

-- ═══ 1. Settings: plans + portal switches ═══════════════════
INSERT INTO public.app_settings (key, value) VALUES ('plans', jsonb_build_object('currency', 'LKR', 'plans', jsonb_build_array(
  jsonb_build_object('key', 'basic', 'name', 'Basic', 'price', 2500, 'active', true, 'includes_review', false, 'tagline', 'For salaried & simple returns',
    'features', jsonb_build_array('Annual income tax return (IIT) filing', 'TIN / RAMIS account support', 'Tax calendar & deadline reminders', 'Client portal & document vault', 'WhatsApp support')),
  jsonb_build_object('key', 'standard', 'name', 'Standard', 'price', 6500, 'active', true, 'includes_review', false, 'tagline', 'For freelancers & small businesses',
    'features', jsonb_build_array('Everything in Basic', 'Monthly bookkeeping (up to 50 transactions)', 'Monthly APIT / payroll tax computation', 'Quarterly instalment calculation', 'Income & Tax summary letter (1 per year)')),
  jsonb_build_object('key', 'premium', 'name', 'Premium', 'price', 15000, 'active', true, 'includes_review', true, 'tagline', 'Complete tax & accounting care',
    'features', jsonb_build_array('Everything in Standard', 'Payroll, EPF / ETF returns', 'VAT / SSCL returns (if registered)', 'Annual Tax Review report — free', 'Quarterly review call & priority WhatsApp'))
)))
ON CONFLICT (key) DO NOTHING;

UPDATE public.app_settings SET value = jsonb_build_object('plans', true, 'tax_reviews', true) || coalesce(value, '{}'::jsonb)
WHERE key = 'client_tools';

-- ═══ 2. Subscriptions ═══════════════════════════════════════
CREATE TABLE IF NOT EXISTS public.subscriptions (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id      UUID NOT NULL REFERENCES public.clients(id) ON DELETE CASCADE,
  plan_key       TEXT NOT NULL CHECK (plan_key ~ '^[a-z0-9_-]{1,30}$'),
  plan_name      TEXT NOT NULL CHECK (length(plan_name) BETWEEN 1 AND 60),
  price          NUMERIC(12,2) NOT NULL DEFAULT 0 CHECK (price >= 0),
  status         TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('requested', 'active', 'paused', 'cancelled')),
  auto_invoice   BOOLEAN NOT NULL DEFAULT TRUE,
  start_date     DATE,
  next_bill_date DATE,
  client_note    TEXT CHECK (client_note IS NULL OR length(client_note) <= 500),
  admin_note     TEXT CHECK (admin_note IS NULL OR length(admin_note) <= 1000),
  requested_by   UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  created_by     UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  cancelled_at   TIMESTAMPTZ,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at     TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE UNIQUE INDEX IF NOT EXISTS subscriptions_one_live ON public.subscriptions (client_id) WHERE status IN ('active', 'paused');
CREATE UNIQUE INDEX IF NOT EXISTS subscriptions_one_request ON public.subscriptions (client_id) WHERE status = 'requested';
CREATE INDEX IF NOT EXISTS subscriptions_billing_idx ON public.subscriptions (status, auto_invoice, next_bill_date);
ALTER TABLE public.subscriptions ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Admins manage subscriptions" ON public.subscriptions;
CREATE POLICY "Admins manage subscriptions" ON public.subscriptions FOR ALL USING (is_admin()) WITH CHECK (is_admin());
DROP POLICY IF EXISTS "Clients read own subscriptions" ON public.subscriptions;
CREATE POLICY "Clients read own subscriptions" ON public.subscriptions FOR SELECT USING (client_id = my_client_id());

ALTER TABLE public.invoices ADD COLUMN IF NOT EXISTS subscription_id UUID REFERENCES public.subscriptions(id) ON DELETE SET NULL;
ALTER TABLE public.invoices ADD COLUMN IF NOT EXISTS period TEXT;
CREATE UNIQUE INDEX IF NOT EXISTS invoices_subscription_period ON public.invoices (subscription_id, period) WHERE subscription_id IS NOT NULL;

-- Sri Lanka "today"
CREATE OR REPLACE FUNCTION public._sl_today() RETURNS DATE LANGUAGE sql STABLE AS $$ SELECT (now() AT TIME ZONE 'Asia/Colombo')::date $$;

-- Next invoice number — same rule as the app: <prefix>-<year>-<max+1, 4 digits>
CREATE OR REPLACE FUNCTION public._next_invoice_no(p_date DATE)
RETURNS TEXT LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT coalesce(nullif(upper(trim((SELECT value->>'prefix' FROM public.app_settings WHERE key = 'invoice'))), ''), 'TM-INV')
      || '-' || extract(year FROM p_date)::int || '-'
      || lpad((coalesce(max((substring(invoice_no FROM '-\d{4}-(\d+)$'))::int), 0) + 1)::text, 4, '0')
  FROM public.invoices WHERE invoice_no ~ '-\d{4}-\d+$';
$$;
REVOKE ALL ON FUNCTION public._next_invoice_no(DATE) FROM PUBLIC, anon, authenticated;

-- Create the invoice for one subscription period (period = month of next_bill_date) and move to the next month
CREATE OR REPLACE FUNCTION public._bill_subscription(p_sub UUID)
RETURNS UUID LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE s public.subscriptions; c public.clients; inv UUID; per TEXT; bill DATE; due_days INT; tries INT := 0; nm TEXT;
BEGIN
  SELECT * INTO s FROM public.subscriptions WHERE id = p_sub FOR UPDATE;
  IF s.id IS NULL OR s.status <> 'active' THEN RAISE EXCEPTION 'Subscription is not active.'; END IF;
  bill := coalesce(s.next_bill_date, _sl_today());
  per := to_char(bill, 'YYYY-MM');
  IF EXISTS (SELECT 1 FROM public.invoices WHERE subscription_id = s.id AND period = per) THEN
    UPDATE public.subscriptions SET next_bill_date = (bill + INTERVAL '1 month')::date, updated_at = NOW() WHERE id = s.id;
    RETURN NULL;
  END IF;
  SELECT * INTO c FROM public.clients WHERE id = s.client_id;
  due_days := coalesce(nullif((SELECT value->>'dueDays' FROM public.app_settings WHERE key = 'invoice'), '')::int, 14);
  LOOP
    BEGIN
      INSERT INTO public.invoices (invoice_no, issue_date, due_date, client_id, client_snapshot, subtotal, discount_pct, discount_amt, total_amount,
                                   notes, status, subscription_id, period)
      VALUES (_next_invoice_no(_sl_today()), _sl_today(), _sl_today() + due_days, s.client_id,
              jsonb_build_object('name', coalesce(c.full_name, ''), 'tin', coalesce(c.tin, ''), 'nic', coalesce(c.nic, ''), 'phone', coalesce(c.mobile, ''), 'email', coalesce(c.email, ''), 'address', coalesce(c.address, '')),
              s.price, 0, 0, s.price, (SELECT value->>'defaultNote' FROM public.app_settings WHERE key = 'invoice'), 'unpaid', s.id, per)
      RETURNING id INTO inv;
      EXIT;
    EXCEPTION WHEN unique_violation THEN
      tries := tries + 1; IF tries > 5 THEN RAISE; END IF;
    END;
  END LOOP;
  nm := s.plan_name || ' plan — ' || trim(to_char(bill, 'Month YYYY'));
  INSERT INTO public.invoice_items (invoice_id, description, quantity, unit_price, discount_pct, amount, sort_order)
  VALUES (inv, nm, 1, s.price, 0, s.price, 0);
  UPDATE public.subscriptions SET next_bill_date = (bill + INTERVAL '1 month')::date, updated_at = NOW() WHERE id = s.id;
  RETURN inv;
END $$;
REVOKE ALL ON FUNCTION public._bill_subscription(UUID) FROM PUBLIC, anon, authenticated;

-- Daily job: bill every active auto-invoice subscription that is due (one period per run each)
CREATE OR REPLACE FUNCTION public._bill_subscriptions()
RETURNS INT LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE r RECORD; n INT := 0;
BEGIN
  FOR r IN SELECT id FROM public.subscriptions WHERE status = 'active' AND auto_invoice AND next_bill_date IS NOT NULL AND next_bill_date <= _sl_today() ORDER BY next_bill_date LIMIT 500 LOOP
    BEGIN
      IF public._bill_subscription(r.id) IS NOT NULL THEN n := n + 1; END IF;
    EXCEPTION WHEN others THEN RAISE WARNING 'subscription % not billed: %', r.id, SQLERRM;
    END;
  END LOOP;
  RETURN n;
END $$;
REVOKE ALL ON FUNCTION public._bill_subscriptions() FROM PUBLIC, anon, authenticated;

-- Admin: bill now (manual plans, or to bill early)
CREATE OR REPLACE FUNCTION public.admin_bill_subscription(p_sub UUID)
RETURNS UUID LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE inv UUID;
BEGIN
  IF NOT is_admin() THEN RAISE EXCEPTION 'Admins only'; END IF;
  inv := public._bill_subscription(p_sub);
  IF inv IS NULL THEN RAISE EXCEPTION 'This month is already invoiced — moved to the next month.'; END IF;
  RETURN inv;
END $$;
REVOKE ALL ON FUNCTION public.admin_bill_subscription(UUID) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_bill_subscription(UUID) TO authenticated;

-- Admin: approve a request / start a plan (replaces the client's current plan)
CREATE OR REPLACE FUNCTION public.admin_activate_subscription(p_sub UUID, p_price NUMERIC, p_start DATE, p_auto BOOLEAN)
RETURNS VOID LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE s public.subscriptions;
BEGIN
  IF NOT is_admin() THEN RAISE EXCEPTION 'Admins only'; END IF;
  SELECT * INTO s FROM public.subscriptions WHERE id = p_sub FOR UPDATE;
  IF s.id IS NULL OR s.status <> 'requested' THEN RAISE EXCEPTION 'Not a pending request.'; END IF;
  UPDATE public.subscriptions SET status = 'cancelled', cancelled_at = NOW(), updated_at = NOW(),
         admin_note = left(coalesce(admin_note || E'\n', '') || 'Replaced by ' || s.plan_name || ' plan', 1000)
   WHERE client_id = s.client_id AND status IN ('active', 'paused');
  UPDATE public.subscriptions SET status = 'active', price = coalesce(p_price, price), start_date = coalesce(p_start, _sl_today()),
         next_bill_date = coalesce(p_start, _sl_today()), auto_invoice = coalesce(p_auto, true), updated_at = NOW()
   WHERE id = s.id;
END $$;
REVOKE ALL ON FUNCTION public.admin_activate_subscription(UUID, NUMERIC, DATE, BOOLEAN) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_activate_subscription(UUID, NUMERIC, DATE, BOOLEAN) TO authenticated;

-- Client: see plans + own plan, request / cancel a request
CREATE OR REPLACE FUNCTION public.my_plans()
RETURNS JSONB LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE cid UUID := my_client_id();
BEGIN
  IF cid IS NULL THEN RAISE EXCEPTION 'Please sign in again.'; END IF;
  RETURN jsonb_build_object(
    'plans', coalesce((SELECT jsonb_agg(p) FROM jsonb_array_elements((SELECT value->'plans' FROM public.app_settings WHERE key = 'plans')) p WHERE coalesce((p->>'active')::boolean, true)), '[]'::jsonb),
    'current', (SELECT to_jsonb(s) - 'admin_note' FROM public.subscriptions s WHERE client_id = cid AND status IN ('active', 'paused') LIMIT 1),
    'request', (SELECT to_jsonb(s) - 'admin_note' FROM public.subscriptions s WHERE client_id = cid AND status = 'requested' LIMIT 1));
END $$;
REVOKE ALL ON FUNCTION public.my_plans() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.my_plans() TO authenticated;

CREATE OR REPLACE FUNCTION public.request_plan(p_plan TEXT, p_note TEXT)
RETURNS UUID LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE cid UUID := my_client_id(); p JSONB; sid UUID;
BEGIN
  IF cid IS NULL THEN RAISE EXCEPTION 'Please sign in again.'; END IF;
  IF NOT _feature_on(cid, 'plans') THEN RAISE EXCEPTION 'Plans are not available right now.'; END IF;
  SELECT x INTO p FROM jsonb_array_elements((SELECT value->'plans' FROM public.app_settings WHERE key = 'plans')) x
   WHERE x->>'key' = p_plan AND coalesce((x->>'active')::boolean, true);
  IF p IS NULL THEN RAISE EXCEPTION 'Unknown plan.'; END IF;
  IF EXISTS (SELECT 1 FROM public.subscriptions WHERE client_id = cid AND status IN ('active', 'paused') AND plan_key = p_plan) THEN
    RAISE EXCEPTION 'You are already on this plan.';
  END IF;
  DELETE FROM public.subscriptions WHERE client_id = cid AND status = 'requested';
  INSERT INTO public.subscriptions (client_id, plan_key, plan_name, price, status, client_note, requested_by)
  VALUES (cid, p_plan, p->>'name', coalesce((p->>'price')::numeric, 0), 'requested', nullif(left(trim(p_note), 500), ''), auth.uid())
  RETURNING id INTO sid;
  RETURN sid;
END $$;
REVOKE ALL ON FUNCTION public.request_plan(TEXT, TEXT) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.request_plan(TEXT, TEXT) TO authenticated;

CREATE OR REPLACE FUNCTION public.cancel_my_plan_request()
RETURNS VOID LANGUAGE sql SECURITY DEFINER SET search_path = public AS $$
  DELETE FROM public.subscriptions WHERE client_id = my_client_id() AND status = 'requested';
$$;
REVOKE ALL ON FUNCTION public.cancel_my_plan_request() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.cancel_my_plan_request() TO authenticated;

-- Daily billing at 07:47 Sri Lanka time (02:17 UTC)
DO $$
BEGIN
  PERFORM cron.unschedule(jobid) FROM cron.job WHERE jobname = 'taxmate-subscription-billing';
  PERFORM cron.schedule('taxmate-subscription-billing', '17 2 * * *', 'SELECT public._bill_subscriptions();');
END $$;

-- ═══ 3. Annual Tax Review reports ═══════════════════════════
CREATE TABLE IF NOT EXISTS public.tax_reviews (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id    UUID NOT NULL REFERENCES public.clients(id) ON DELETE CASCADE,
  year         TEXT NOT NULL CHECK (year ~ '^\d{4}/\d{2}$'),
  status       TEXT NOT NULL DEFAULT 'requested' CHECK (status IN ('requested', 'issued', 'rejected', 'cancelled')),
  calc_id      UUID REFERENCES public.iit_calculations(id) ON DELETE SET NULL,
  prev_calc_id UUID REFERENCES public.iit_calculations(id) ON DELETE SET NULL,
  fee          NUMERIC(12,2) NOT NULL DEFAULT 0,
  invoice_id   UUID REFERENCES public.invoices(id) ON DELETE SET NULL,
  client_note  TEXT CHECK (client_note IS NULL OR length(client_note) <= 500),
  admin_note   TEXT,
  requested_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  issued_by    UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  issued_at    TIMESTAMPTZ,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS tax_reviews_client_idx ON public.tax_reviews (client_id, created_at DESC);
ALTER TABLE public.tax_reviews ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Admins manage reviews" ON public.tax_reviews;
CREATE POLICY "Admins manage reviews" ON public.tax_reviews FOR ALL USING (is_admin()) WITH CHECK (is_admin());
DROP POLICY IF EXISTS "Clients read own reviews" ON public.tax_reviews;
CREATE POLICY "Clients read own reviews" ON public.tax_reviews FOR SELECT USING (client_id = my_client_id());

CREATE TABLE IF NOT EXISTS public.tax_review_data (
  review_id UUID PRIMARY KEY REFERENCES public.tax_reviews(id) ON DELETE CASCADE,
  data      JSONB NOT NULL
);
ALTER TABLE public.tax_review_data ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Admins manage review data" ON public.tax_review_data;
CREATE POLICY "Admins manage review data" ON public.tax_review_data FOR ALL USING (is_admin()) WITH CHECK (is_admin());

CREATE OR REPLACE FUNCTION public.request_tax_review(p_year TEXT, p_note TEXT)
RETURNS UUID LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE cid UUID := my_client_id(); rid UUID;
BEGIN
  IF cid IS NULL THEN RAISE EXCEPTION 'Please sign in again.'; END IF;
  IF NOT _feature_on(cid, 'tax_reviews') THEN RAISE EXCEPTION 'Tax reviews are not available right now.'; END IF;
  IF p_year !~ '^\d{4}/\d{2}$' THEN RAISE EXCEPTION 'Choose a year of assessment.'; END IF;
  IF EXISTS (SELECT 1 FROM public.tax_reviews WHERE client_id = cid AND year = p_year AND status = 'requested') THEN RAISE EXCEPTION 'You already asked for this year — TaxMate will prepare it.'; END IF;
  INSERT INTO public.tax_reviews (client_id, year, client_note, requested_by)
  VALUES (cid, p_year, nullif(left(trim(p_note), 500), ''), auth.uid()) RETURNING id INTO rid;
  RETURN rid;
END $$;
REVOKE ALL ON FUNCTION public.request_tax_review(TEXT, TEXT) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.request_tax_review(TEXT, TEXT) TO authenticated;

CREATE OR REPLACE FUNCTION public.cancel_my_tax_review(p_id UUID)
RETURNS VOID LANGUAGE sql SECURITY DEFINER SET search_path = public AS $$
  UPDATE public.tax_reviews SET status = 'cancelled' WHERE id = p_id AND client_id = my_client_id() AND status = 'requested';
$$;
REVOKE ALL ON FUNCTION public.cancel_my_tax_review(UUID) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.cancel_my_tax_review(UUID) TO authenticated;

CREATE OR REPLACE FUNCTION public.my_tax_review(p_id UUID)
RETURNS JSONB LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE r public.tax_reviews;
BEGIN
  SELECT * INTO r FROM public.tax_reviews WHERE id = p_id AND client_id = my_client_id();
  IF r.id IS NULL OR r.status <> 'issued' THEN RAISE EXCEPTION 'This report is not ready yet.'; END IF;
  IF r.invoice_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM public.invoices WHERE id = r.invoice_id AND status = 'paid') THEN
    RAISE EXCEPTION 'Please pay the invoice for this report first.';
  END IF;
  RETURN (SELECT data FROM public.tax_review_data WHERE review_id = r.id) || jsonb_build_object('issued_at', r.issued_at, 'year', r.year);
END $$;
REVOKE ALL ON FUNCTION public.my_tax_review(UUID) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.my_tax_review(UUID) TO authenticated;

CREATE OR REPLACE FUNCTION public.admin_issue_tax_review(p_id UUID, p_calc UUID, p_prev UUID, p_data JSONB, p_fee NUMERIC, p_invoice UUID)
RETURNS VOID LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NOT is_admin() THEN RAISE EXCEPTION 'Admins only'; END IF;
  IF p_data IS NULL OR NOT (p_data ? 'current') THEN RAISE EXCEPTION 'Report figures missing'; END IF;
  INSERT INTO public.tax_review_data (review_id, data) VALUES (p_id, p_data)
  ON CONFLICT (review_id) DO UPDATE SET data = EXCLUDED.data;
  UPDATE public.tax_reviews SET status = 'issued', calc_id = p_calc, prev_calc_id = p_prev, fee = coalesce(p_fee, 0),
         invoice_id = coalesce(p_invoice, invoice_id), issued_by = auth.uid(), issued_at = NOW()
   WHERE id = p_id;
END $$;
REVOKE ALL ON FUNCTION public.admin_issue_tax_review(UUID, UUID, UUID, JSONB, NUMERIC, UUID) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_issue_tax_review(UUID, UUID, UUID, JSONB, NUMERIC, UUID) TO authenticated;

-- ═══ 4. Portal features ═════════════════════════════════════
CREATE OR REPLACE FUNCTION public.my_portal_features()
RETURNS JSONB LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE cid UUID := my_client_id(); n INT;
BEGIN
  SELECT count(*) INTO n FROM public.income_sheets WHERE client_id = cid AND enabled;
  RETURN jsonb_build_object(
    'quick_tax',      _feature_on(cid, 'quick_tax'),
    'tax_calculator', _feature_on(cid, 'tax_calculator'),
    'tax_calendar',   _feature_on(cid, 'tax_calendar'),
    'reminders',      _feature_on(cid, 'reminders'),
    'referrals',      _feature_on(cid, 'referrals'),
    'documents',      _feature_on(cid, 'documents'),
    'return_tracker', _feature_on(cid, 'return_tracker'),
    'messages',       _feature_on(cid, 'messages'),
    'services',       _feature_on(cid, 'services'),
    'summary_letters', _feature_on(cid, 'summary_letters'),
    'plans',          _feature_on(cid, 'plans'),
    'tax_reviews',    _feature_on(cid, 'tax_reviews'),
    'referral_reward', coalesce((SELECT value->>'referral_reward' FROM public.app_settings WHERE key = 'client_tools'), ''),
    'income_sheets', coalesce(n, 0));
END $$;
REVOKE ALL ON FUNCTION public.my_portal_features() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.my_portal_features() TO authenticated;
