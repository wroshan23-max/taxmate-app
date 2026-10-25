-- ═══════════════════════════════════════════════════════════
--  TaxMate V49 — Payroll / APIT module + add-on services
--  • Employers keep a staff list; each month the app works out APIT (Table 01),
--    EPF 8% / 12%, ETF 3% and net pay, and makes payslips and reports.
--  • Included in plans marked "includes_payroll" (Standard + Premium by default).
--  • Any client can request it on its own as a monthly add-on service.
--  Safe to re-run.
-- ═══════════════════════════════════════════════════════════

-- ═══ 1. Plans: which plans include payroll ══════════════════
UPDATE public.app_settings
SET value = jsonb_set(value, '{plans}', (
  SELECT coalesce(jsonb_agg(CASE WHEN p ? 'includes_payroll' THEN p
                                 ELSE p || jsonb_build_object('includes_payroll', p->>'key' IN ('standard', 'premium')) END ORDER BY ord), '[]'::jsonb)
  FROM jsonb_array_elements(coalesce(value->'plans', '[]'::jsonb)) WITH ORDINALITY t(p, ord)))
WHERE key = 'plans';

-- ═══ 2. Add-on catalog (edit in Settings → Plans) ════════════
INSERT INTO public.app_settings (key, value) VALUES ('addons', jsonb_build_object('addons', jsonb_build_array(
  jsonb_build_object('key', 'payroll', 'name', 'Payroll & APIT', 'price', 1500, 'active', true,
    'tagline', 'Staff list, monthly APIT, EPF / ETF and payslips',
    'features', jsonb_build_array('Staff list with salary & allowances', 'Monthly APIT (Tax Table 01) worked out automatically',
                                  'EPF 8% + 12% and ETF 3%', 'Payslips — PDF or WhatsApp', 'EPF / ETF, APIT and bank transfer reports'))
)))
ON CONFLICT (key) DO NOTHING;

-- ═══ 3. Add-on services per client ══════════════════════════
CREATE TABLE IF NOT EXISTS public.service_addons (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id      UUID NOT NULL REFERENCES public.clients(id) ON DELETE CASCADE,
  addon_key      TEXT NOT NULL CHECK (addon_key ~ '^[a-z0-9_-]{1,30}$'),
  addon_name     TEXT NOT NULL CHECK (length(addon_name) BETWEEN 1 AND 60),
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
CREATE UNIQUE INDEX IF NOT EXISTS service_addons_one_live ON public.service_addons (client_id, addon_key) WHERE status IN ('active', 'paused');
CREATE UNIQUE INDEX IF NOT EXISTS service_addons_one_request ON public.service_addons (client_id, addon_key) WHERE status = 'requested';
CREATE INDEX IF NOT EXISTS service_addons_billing_idx ON public.service_addons (status, auto_invoice, next_bill_date);
ALTER TABLE public.service_addons ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Admins manage add-ons" ON public.service_addons;
CREATE POLICY "Admins manage add-ons" ON public.service_addons FOR ALL USING (is_admin()) WITH CHECK (is_admin());
DROP POLICY IF EXISTS "Clients read own add-ons" ON public.service_addons;
CREATE POLICY "Clients read own add-ons" ON public.service_addons FOR SELECT USING (client_id = my_client_id());

ALTER TABLE public.invoices ADD COLUMN IF NOT EXISTS addon_id UUID REFERENCES public.service_addons(id) ON DELETE SET NULL;
CREATE UNIQUE INDEX IF NOT EXISTS invoices_addon_period ON public.invoices (addon_id, period) WHERE addon_id IS NOT NULL;

-- Invoice one add-on period (month of next_bill_date) and move to the next month
CREATE OR REPLACE FUNCTION public._bill_addon(p_id UUID)
RETURNS UUID LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE a public.service_addons; c public.clients; inv UUID; per TEXT; bill DATE; due_days INT; tries INT := 0;
BEGIN
  SELECT * INTO a FROM public.service_addons WHERE id = p_id FOR UPDATE;
  IF a.id IS NULL OR a.status <> 'active' THEN RAISE EXCEPTION 'Add-on is not active.'; END IF;
  bill := coalesce(a.next_bill_date, _sl_today());
  per := to_char(bill, 'YYYY-MM');
  IF EXISTS (SELECT 1 FROM public.invoices WHERE addon_id = a.id AND period = per) THEN
    UPDATE public.service_addons SET next_bill_date = (bill + INTERVAL '1 month')::date, updated_at = NOW() WHERE id = a.id;
    RETURN NULL;
  END IF;
  SELECT * INTO c FROM public.clients WHERE id = a.client_id;
  due_days := coalesce(nullif((SELECT value->>'dueDays' FROM public.app_settings WHERE key = 'invoice'), '')::int, 14);
  LOOP
    BEGIN
      INSERT INTO public.invoices (invoice_no, issue_date, due_date, client_id, client_snapshot, subtotal, discount_pct, discount_amt, total_amount,
                                   notes, status, addon_id, period)
      VALUES (_next_invoice_no(_sl_today()), _sl_today(), _sl_today() + due_days, a.client_id,
              jsonb_build_object('name', coalesce(c.full_name, ''), 'tin', coalesce(c.tin, ''), 'nic', coalesce(c.nic, ''), 'phone', coalesce(c.mobile, ''), 'email', coalesce(c.email, ''), 'address', coalesce(c.address, '')),
              a.price, 0, 0, a.price, (SELECT value->>'defaultNote' FROM public.app_settings WHERE key = 'invoice'), 'unpaid', a.id, per)
      RETURNING id INTO inv;
      EXIT;
    EXCEPTION WHEN unique_violation THEN
      tries := tries + 1; IF tries > 5 THEN RAISE; END IF;
    END;
  END LOOP;
  INSERT INTO public.invoice_items (invoice_id, description, quantity, unit_price, discount_pct, amount, sort_order)
  VALUES (inv, a.addon_name || ' — ' || to_char(bill, 'FMMonth YYYY'), 1, a.price, 0, a.price, 0);
  UPDATE public.service_addons SET next_bill_date = (bill + INTERVAL '1 month')::date, updated_at = NOW() WHERE id = a.id;
  RETURN inv;
END $$;
REVOKE ALL ON FUNCTION public._bill_addon(UUID) FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.admin_bill_addon(p_id UUID)
RETURNS UUID LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE inv UUID;
BEGIN
  IF NOT is_admin() THEN RAISE EXCEPTION 'Admins only'; END IF;
  inv := public._bill_addon(p_id);
  IF inv IS NULL THEN RAISE EXCEPTION 'This month is already invoiced — moved to the next month.'; END IF;
  RETURN inv;
END $$;
REVOKE ALL ON FUNCTION public.admin_bill_addon(UUID) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_bill_addon(UUID) TO authenticated;

-- The existing daily billing job (taxmate-subscription-billing, 07:47 SL time) now bills add-ons too
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
  FOR r IN SELECT id FROM public.service_addons WHERE status = 'active' AND auto_invoice AND next_bill_date IS NOT NULL AND next_bill_date <= _sl_today() ORDER BY next_bill_date LIMIT 500 LOOP
    BEGIN
      IF public._bill_addon(r.id) IS NOT NULL THEN n := n + 1; END IF;
    EXCEPTION WHEN others THEN RAISE WARNING 'add-on % not billed: %', r.id, SQLERRM;
    END;
  END LOOP;
  RETURN n;
END $$;
REVOKE ALL ON FUNCTION public._bill_subscriptions() FROM PUBLIC, anon, authenticated;

-- ═══ 4. Who can use payroll ═════════════════════════════════
-- plan includes it, or the payroll add-on is active (admins can always use it)
CREATE OR REPLACE FUNCTION public._payroll_on(p_client UUID)
RETURNS BOOLEAN LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT p_client IS NOT NULL AND (is_admin() OR p_client = my_client_id()) AND (
    EXISTS (SELECT 1 FROM public.service_addons WHERE client_id = p_client AND addon_key = 'payroll' AND status = 'active')
    OR EXISTS (SELECT 1 FROM public.subscriptions s WHERE s.client_id = p_client AND s.status = 'active'
               AND EXISTS (SELECT 1 FROM jsonb_array_elements(coalesce((SELECT value->'plans' FROM public.app_settings WHERE key = 'plans'), '[]'::jsonb)) x
                           WHERE x->>'key' = s.plan_key AND coalesce((x->>'includes_payroll')::boolean, false))));
$$;
REVOKE ALL ON FUNCTION public._payroll_on(UUID) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public._payroll_on(UUID) TO authenticated;   -- used inside policies

-- Client: payroll access + where it comes from
CREATE OR REPLACE FUNCTION public.my_payroll_access()
RETURNS JSONB LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE cid UUID := my_client_id(); plan TEXT; addon BOOLEAN;
BEGIN
  IF cid IS NULL THEN RETURN jsonb_build_object('on', false); END IF;
  SELECT s.plan_name INTO plan FROM public.subscriptions s WHERE s.client_id = cid AND s.status = 'active'
    AND EXISTS (SELECT 1 FROM jsonb_array_elements(coalesce((SELECT value->'plans' FROM public.app_settings WHERE key = 'plans'), '[]'::jsonb)) x
                WHERE x->>'key' = s.plan_key AND coalesce((x->>'includes_payroll')::boolean, false)) LIMIT 1;
  addon := EXISTS (SELECT 1 FROM public.service_addons WHERE client_id = cid AND addon_key = 'payroll' AND status = 'active');
  RETURN jsonb_build_object('on', plan IS NOT NULL OR addon, 'plan', plan, 'addon', addon);
END $$;
REVOKE ALL ON FUNCTION public.my_payroll_access() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.my_payroll_access() TO authenticated;

-- Client: add-on catalog + own add-ons
CREATE OR REPLACE FUNCTION public.my_addons()
RETURNS JSONB LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE cid UUID := my_client_id();
BEGIN
  IF cid IS NULL THEN RAISE EXCEPTION 'Please sign in again.'; END IF;
  RETURN jsonb_build_object(
    'addons', coalesce((SELECT jsonb_agg(a) FROM jsonb_array_elements(coalesce((SELECT value->'addons' FROM public.app_settings WHERE key = 'addons'), '[]'::jsonb)) a
                        WHERE coalesce((a->>'active')::boolean, true)), '[]'::jsonb),
    'mine', coalesce((SELECT jsonb_agg(to_jsonb(s) - 'admin_note' ORDER BY s.created_at DESC) FROM public.service_addons s
                      WHERE s.client_id = cid AND s.status IN ('requested', 'active', 'paused')), '[]'::jsonb),
    'payroll', public.my_payroll_access());
END $$;
REVOKE ALL ON FUNCTION public.my_addons() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.my_addons() TO authenticated;

CREATE OR REPLACE FUNCTION public.request_addon(p_key TEXT, p_note TEXT)
RETURNS UUID LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE cid UUID := my_client_id(); a JSONB; rid UUID;
BEGIN
  IF cid IS NULL THEN RAISE EXCEPTION 'Please sign in again.'; END IF;
  SELECT x INTO a FROM jsonb_array_elements(coalesce((SELECT value->'addons' FROM public.app_settings WHERE key = 'addons'), '[]'::jsonb)) x
   WHERE x->>'key' = p_key AND coalesce((x->>'active')::boolean, true);
  IF a IS NULL THEN RAISE EXCEPTION 'This service is not available right now.'; END IF;
  IF EXISTS (SELECT 1 FROM public.service_addons WHERE client_id = cid AND addon_key = p_key AND status IN ('active', 'paused')) THEN
    RAISE EXCEPTION 'You already have this service.';
  END IF;
  IF p_key = 'payroll' AND (public.my_payroll_access()->>'plan') IS NOT NULL THEN
    RAISE EXCEPTION 'Payroll is already included in your plan.';
  END IF;
  DELETE FROM public.service_addons WHERE client_id = cid AND addon_key = p_key AND status = 'requested';
  INSERT INTO public.service_addons (client_id, addon_key, addon_name, price, status, client_note, requested_by)
  VALUES (cid, p_key, a->>'name', coalesce((a->>'price')::numeric, 0), 'requested', nullif(left(trim(coalesce(p_note, '')), 500), ''), auth.uid())
  RETURNING id INTO rid;
  RETURN rid;
END $$;
REVOKE ALL ON FUNCTION public.request_addon(TEXT, TEXT) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.request_addon(TEXT, TEXT) TO authenticated;

CREATE OR REPLACE FUNCTION public.cancel_my_addon_request(p_key TEXT)
RETURNS VOID LANGUAGE sql SECURITY DEFINER SET search_path = public AS $$
  DELETE FROM public.service_addons WHERE client_id = my_client_id() AND addon_key = p_key AND status = 'requested';
$$;
REVOKE ALL ON FUNCTION public.cancel_my_addon_request(TEXT) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.cancel_my_addon_request(TEXT) TO authenticated;

-- 🔔 client notifications for add-ons
CREATE OR REPLACE FUNCTION public._ntf_addon() RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE lnk TEXT := CASE WHEN NEW.addon_key = 'payroll' THEN '/client/payroll' ELSE '/client/plan' END;
BEGIN
  IF NEW.status = 'active' AND (TG_OP = 'INSERT' OR OLD.status <> 'active') THEN
    PERFORM _notify_client(NEW.client_id, 'plan',
      NEW.addon_name || CASE WHEN TG_OP = 'UPDATE' AND OLD.status = 'paused' THEN ' is active again' ELSE ' is active 🎉' END,
      _rs(NEW.price) || ' per month' || CASE WHEN NEW.auto_invoice AND NEW.next_bill_date IS NOT NULL THEN ' · invoice every month from ' || to_char(NEW.next_bill_date, 'DD Mon YYYY') ELSE '' END || '.', lnk);
  ELSIF TG_OP = 'UPDATE' AND NEW.status = 'paused' AND OLD.status <> 'paused' THEN
    PERFORM _notify_client(NEW.client_id, 'plan', NEW.addon_name || ' is paused', 'No invoices while paused. Contact TaxMate to resume.', '/client/plan');
  ELSIF TG_OP = 'UPDATE' AND NEW.status = 'cancelled' AND OLD.status IN ('active', 'paused') THEN
    PERFORM _notify_client(NEW.client_id, 'plan', NEW.addon_name || ' has ended', 'No more monthly invoices for this service.', '/client/plan');
  ELSIF TG_OP = 'UPDATE' AND NEW.status = 'cancelled' AND OLD.status = 'requested' THEN
    PERFORM _notify_client(NEW.client_id, 'plan', 'About your ' || NEW.addon_name || ' request', 'TaxMate will contact you about this service.', '/client/plan');
  ELSIF TG_OP = 'UPDATE' AND NEW.status = 'active' AND NEW.price <> OLD.price THEN
    PERFORM _notify_client(NEW.client_id, 'plan', NEW.addon_name || ' price changed', 'New price: ' || _rs(NEW.price) || ' per month.', '/client/plan');
  END IF;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS trg_ntf_addon ON public.service_addons;
CREATE TRIGGER trg_ntf_addon AFTER INSERT OR UPDATE ON public.service_addons FOR EACH ROW EXECUTE FUNCTION public._ntf_addon();

-- ═══ 5. Payroll data ════════════════════════════════════════
CREATE TABLE IF NOT EXISTS public.payroll_settings (
  client_id     UUID PRIMARY KEY REFERENCES public.clients(id) ON DELETE CASCADE,
  employer_name TEXT CHECK (employer_name IS NULL OR length(employer_name) <= 120),
  address       TEXT CHECK (address IS NULL OR length(address) <= 300),
  epf_reg_no    TEXT CHECK (epf_reg_no IS NULL OR length(epf_reg_no) <= 40),
  etf_reg_no    TEXT CHECK (etf_reg_no IS NULL OR length(etf_reg_no) <= 40),
  tin           TEXT CHECK (tin IS NULL OR length(tin) <= 40),
  updated_by    UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS public.payroll_employees (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id    UUID NOT NULL REFERENCES public.clients(id) ON DELETE CASCADE,
  emp_no       TEXT CHECK (emp_no IS NULL OR length(emp_no) <= 20),
  full_name    TEXT NOT NULL CHECK (length(full_name) BETWEEN 1 AND 120),
  nic          TEXT CHECK (nic IS NULL OR length(nic) <= 20),
  designation  TEXT CHECK (designation IS NULL OR length(designation) <= 80),
  epf_no       TEXT CHECK (epf_no IS NULL OR length(epf_no) <= 20),
  join_date    DATE,
  mobile       TEXT CHECK (mobile IS NULL OR length(mobile) <= 20),
  email        TEXT CHECK (email IS NULL OR length(email) <= 120),
  bank_name    TEXT CHECK (bank_name IS NULL OR length(bank_name) <= 60),
  bank_branch  TEXT CHECK (bank_branch IS NULL OR length(bank_branch) <= 60),
  bank_account TEXT CHECK (bank_account IS NULL OR length(bank_account) <= 30),
  basic        NUMERIC(12,2) NOT NULL DEFAULT 0 CHECK (basic >= 0),
  allow_epf    NUMERIC(12,2) NOT NULL DEFAULT 0 CHECK (allow_epf >= 0),     -- fixed allowances that count for EPF/ETF (e.g. cost of living)
  allow_other  NUMERIC(12,2) NOT NULL DEFAULT 0 CHECK (allow_other >= 0),   -- fixed allowances outside EPF (e.g. travel, fuel)
  epf_member   BOOLEAN NOT NULL DEFAULT TRUE,
  apit_mode    TEXT NOT NULL DEFAULT 'table1' CHECK (apit_mode IN ('table1', 'none')),
  active       BOOLEAN NOT NULL DEFAULT TRUE,
  left_date    DATE,
  notes        TEXT CHECK (notes IS NULL OR length(notes) <= 500),
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS payroll_employees_client_idx ON public.payroll_employees (client_id, active, full_name);

CREATE TABLE IF NOT EXISTS public.payroll_runs (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id    UUID NOT NULL REFERENCES public.clients(id) ON DELETE CASCADE,
  period       TEXT NOT NULL CHECK (period ~ '^\d{4}-(0[1-9]|1[0-2])$'),
  status       TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'final')),
  lines        JSONB NOT NULL DEFAULT '[]'::jsonb CHECK (jsonb_typeof(lines) = 'array' AND octet_length(lines::text) <= 2000000),
  totals       JSONB NOT NULL DEFAULT '{}'::jsonb,
  note         TEXT CHECK (note IS NULL OR length(note) <= 500),
  created_by   UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  updated_by   UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  finalized_at TIMESTAMPTZ,
  finalized_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (client_id, period)
);

ALTER TABLE public.payroll_settings  ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.payroll_employees ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.payroll_runs      ENABLE ROW LEVEL SECURITY;

-- Admin: everything
DROP POLICY IF EXISTS "Admins manage payroll settings" ON public.payroll_settings;
CREATE POLICY "Admins manage payroll settings" ON public.payroll_settings FOR ALL USING (is_admin()) WITH CHECK (is_admin());
DROP POLICY IF EXISTS "Admins manage payroll employees" ON public.payroll_employees;
CREATE POLICY "Admins manage payroll employees" ON public.payroll_employees FOR ALL USING (is_admin()) WITH CHECK (is_admin());
DROP POLICY IF EXISTS "Admins manage payroll runs" ON public.payroll_runs;
CREATE POLICY "Admins manage payroll runs" ON public.payroll_runs FOR ALL USING (is_admin()) WITH CHECK (is_admin());

-- Client: always read own data (old payslips stay visible); change it only while payroll is on
DROP POLICY IF EXISTS "Clients read own payroll settings" ON public.payroll_settings;
CREATE POLICY "Clients read own payroll settings" ON public.payroll_settings FOR SELECT USING (client_id = my_client_id());
DROP POLICY IF EXISTS "Clients add payroll settings" ON public.payroll_settings;
CREATE POLICY "Clients add payroll settings" ON public.payroll_settings FOR INSERT WITH CHECK (client_id = my_client_id() AND _payroll_on(client_id));
DROP POLICY IF EXISTS "Clients edit payroll settings" ON public.payroll_settings;
CREATE POLICY "Clients edit payroll settings" ON public.payroll_settings FOR UPDATE
  USING (client_id = my_client_id() AND _payroll_on(client_id)) WITH CHECK (client_id = my_client_id());

DROP POLICY IF EXISTS "Clients read own employees" ON public.payroll_employees;
CREATE POLICY "Clients read own employees" ON public.payroll_employees FOR SELECT USING (client_id = my_client_id());
DROP POLICY IF EXISTS "Clients add employees" ON public.payroll_employees;
CREATE POLICY "Clients add employees" ON public.payroll_employees FOR INSERT WITH CHECK (client_id = my_client_id() AND _payroll_on(client_id));
DROP POLICY IF EXISTS "Clients edit employees" ON public.payroll_employees;
CREATE POLICY "Clients edit employees" ON public.payroll_employees FOR UPDATE
  USING (client_id = my_client_id() AND _payroll_on(client_id)) WITH CHECK (client_id = my_client_id());
DROP POLICY IF EXISTS "Clients delete employees" ON public.payroll_employees;
CREATE POLICY "Clients delete employees" ON public.payroll_employees FOR DELETE USING (client_id = my_client_id() AND _payroll_on(client_id));

DROP POLICY IF EXISTS "Clients read own payroll runs" ON public.payroll_runs;
CREATE POLICY "Clients read own payroll runs" ON public.payroll_runs FOR SELECT USING (client_id = my_client_id());
DROP POLICY IF EXISTS "Clients start payroll runs" ON public.payroll_runs;
CREATE POLICY "Clients start payroll runs" ON public.payroll_runs FOR INSERT
  WITH CHECK (client_id = my_client_id() AND status = 'draft' AND _payroll_on(client_id));
DROP POLICY IF EXISTS "Clients edit draft payroll runs" ON public.payroll_runs;     -- a final month is locked (TaxMate can reopen it)
CREATE POLICY "Clients edit draft payroll runs" ON public.payroll_runs FOR UPDATE
  USING (client_id = my_client_id() AND status = 'draft' AND _payroll_on(client_id)) WITH CHECK (client_id = my_client_id());
DROP POLICY IF EXISTS "Clients delete draft payroll runs" ON public.payroll_runs;
CREATE POLICY "Clients delete draft payroll runs" ON public.payroll_runs FOR DELETE
  USING (client_id = my_client_id() AND status = 'draft' AND _payroll_on(client_id));

-- ═══ 6. Check ═══════════════════════════════════════════════
SELECT (SELECT jsonb_agg(jsonb_build_object('plan', p->>'key', 'payroll', p->'includes_payroll')) FROM public.app_settings, jsonb_array_elements(value->'plans') p WHERE key = 'plans') AS plans,
       (SELECT value->'addons'->0->>'name' FROM public.app_settings WHERE key = 'addons') AS addon,
       to_regclass('public.payroll_runs') IS NOT NULL AS payroll_tables;
