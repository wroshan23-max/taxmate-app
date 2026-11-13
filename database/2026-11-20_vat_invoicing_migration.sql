-- ═══════════════════════════════════════════════════════════════════════════
--  TaxMate V64 — VAT Invoice & RAMIS add-on
--
--  Tax Invoice · Non-Tax Invoice · Credit Note · Debit Note · payments & customer
--  ledger · secure share links · reminders · purchaser VAT inbox · VAT schedule
--  mapping · RAMIS Web API submission queue · audit trail · monthly / annual add-on.
--
--  Principles
--   • Tenant = the TaxMate client (client_id is the tenant id on every table).
--   • All writes go through SECURITY DEFINER functions that check _vi_can(); tables
--     only allow SELECT through RLS. Triggers keep issued documents immutable even
--     for direct SQL / service-role writes.
--   • DRAFT → editable · ISSUED → controlled (no edit, no delete) · RAMIS submitted
--     → immutable · RAMIS accepted → locked. Corrections = Credit / Debit Note.
--   • Totals are always calculated here (_vi_calc_doc), never trusted from the browser.
--   • Tax rates, schedule mappings and RAMIS API settings are configuration (admin),
--     and every issued document keeps the rate, rule version and method it used.
--   • RAMIS: no IRD endpoint, field or login method is invented. Until TaxMate admin
--     configures an adapter from IRD's official spec, submissions wait in the queue
--     as "RAMIS Integration Pending Configuration". Nothing is ever shown as
--     submitted to IRD unless the IRD API answered.
--
--  IRD sources used (read 13 Nov 2026):
--   • Circular SEC/2026/E/03 (20.05.2026) — VAT tax invoice format, from 01.07.2026:
--     serial YYMMM_QQQQ_XXXXX (QQQQ 1–15 letters/digits, XXXXX digits only,
--     no spaces, max 40 characters, sequential continuity).
--   • IRD "VAT WEB API Quick Guide" v0.1 — SSID + password → JWT; valid invoice →
--     supplier Schedule 1 / purchaser Schedule 2; credit / debit note → Schedule 4;
--     zero-rated service invoice → Schedule 7; purchaser approves "Pending Approval"
--     records; "Records submitted through the WEB API cannot be updated or deleted".
--
--  Needs: V49 add-ons (service_addons), V52 cron key, V55 family, V57+ helpers.
--  Safe to re-run.
-- ═══════════════════════════════════════════════════════════════════════════

CREATE EXTENSION IF NOT EXISTS pgcrypto WITH SCHEMA extensions;

-- ═══ 1. Add-on: monthly / annual, trial, suspended, expired ═══════════════
ALTER TABLE public.service_addons ADD COLUMN IF NOT EXISTS billing_cycle TEXT NOT NULL DEFAULT 'monthly';
ALTER TABLE public.service_addons ADD COLUMN IF NOT EXISTS trial_ends DATE;
DO $$ BEGIN
  ALTER TABLE public.service_addons ADD CONSTRAINT service_addons_cycle_check CHECK (billing_cycle IN ('monthly', 'annual'));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
ALTER TABLE public.service_addons DROP CONSTRAINT IF EXISTS service_addons_status_check;
ALTER TABLE public.service_addons ADD CONSTRAINT service_addons_status_check
  CHECK (status IN ('requested', 'trial', 'active', 'paused', 'suspended', 'expired', 'cancelled'));
DROP INDEX IF EXISTS public.service_addons_one_live;
CREATE UNIQUE INDEX service_addons_one_live ON public.service_addons (client_id, addon_key) WHERE status IN ('trial', 'active', 'paused', 'suspended');

-- Catalog entry (prices are placeholders: set them in Settings → Plans → Add-on services).
-- Starts switched off so clients only see it after TaxMate has set the prices.
UPDATE public.app_settings SET value = jsonb_set(value, '{addons}', coalesce(value->'addons', '[]'::jsonb) || jsonb_build_array(jsonb_build_object(
  'key', 'vat_invoice', 'name', 'VAT Invoice & RAMIS', 'price', 0, 'annual_price', 0, 'active', false, 'trial_days', 14,
  'tagline', 'IRD-format tax invoices, credit / debit notes, payments, reminders and RAMIS submission',
  'features', jsonb_build_array('Tax Invoice in the IRD format (YYMMM_QQQQ_XXXXX)', 'Non-Tax Invoice, Credit Note, Debit Note',
    'Payments, customer ledger, statements', 'WhatsApp / email share links and payment reminders',
    'VAT schedule reports and RAMIS submission', 'Purchaser VAT inbox'),
  'limits', jsonb_build_object('invoices_per_month', 0, 'customers', 0, 'users', 3, 'ramis', true, 'reports', true,
    'auto_reminders', true, 'payments', true, 'storage_mb', 500))))
WHERE key = 'addons' AND NOT EXISTS (SELECT 1 FROM jsonb_array_elements(coalesce(value->'addons', '[]'::jsonb)) a WHERE a->>'key' = 'vat_invoice');

-- Bill one add-on period: monthly (as before) or annual (12 months ahead)
CREATE OR REPLACE FUNCTION public._bill_addon(p_id UUID)
RETURNS UUID LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE a public.service_addons; c public.clients; inv UUID; per TEXT; bill DATE; due_days INT; tries INT := 0; yr BOOLEAN; lbl TEXT;
BEGIN
  SELECT * INTO a FROM public.service_addons WHERE id = p_id FOR UPDATE;
  IF a.id IS NULL OR a.status <> 'active' THEN RAISE EXCEPTION 'Add-on is not active.'; END IF;
  yr := a.billing_cycle = 'annual';
  bill := coalesce(a.next_bill_date, _sl_today());
  per := to_char(bill, 'YYYY-MM');
  IF EXISTS (SELECT 1 FROM public.invoices WHERE addon_id = a.id AND period = per) THEN
    UPDATE public.service_addons SET next_bill_date = (bill + CASE WHEN yr THEN INTERVAL '1 year' ELSE INTERVAL '1 month' END)::date, updated_at = NOW() WHERE id = a.id;
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
  lbl := CASE WHEN yr THEN 'Annual — ' || to_char(bill, 'FMMon YYYY') || ' to ' || to_char((bill + INTERVAL '1 year' - INTERVAL '1 day')::date, 'FMMon YYYY')
              ELSE to_char(bill, 'FMMonth YYYY') END;
  INSERT INTO public.invoice_items (invoice_id, description, quantity, unit_price, discount_pct, amount, sort_order)
  VALUES (inv, a.addon_name || ' — ' || lbl, 1, a.price, 0, a.price, 0);
  UPDATE public.service_addons SET next_bill_date = (bill + CASE WHEN yr THEN INTERVAL '1 year' ELSE INTERVAL '1 month' END)::date, updated_at = NOW() WHERE id = a.id;
  RETURN inv;
END $$;
REVOKE ALL ON FUNCTION public._bill_addon(UUID) FROM PUBLIC, anon, authenticated;

-- Add-on notices (now with trial / annual / suspended / expired)
CREATE OR REPLACE FUNCTION public._ntf_addon() RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE lnk TEXT := CASE NEW.addon_key WHEN 'payroll' THEN '/client/payroll' WHEN 'vat_invoice' THEN '/client/vat' ELSE '/client/plan' END;
        per TEXT := CASE WHEN NEW.billing_cycle = 'annual' THEN ' per year' ELSE ' per month' END;
        every TEXT := CASE WHEN NEW.billing_cycle = 'annual' THEN ' · invoice every year from ' ELSE ' · invoice every month from ' END;
BEGIN
  IF NEW.status = 'trial' AND (TG_OP = 'INSERT' OR OLD.status <> 'trial') THEN
    PERFORM _notify_client(NEW.client_id, 'plan', NEW.addon_name || ' — free trial started 🎉',
      'Trial until ' || coalesce(to_char(NEW.trial_ends, 'DD Mon YYYY'), '—') || '.', lnk);
  ELSIF NEW.status = 'active' AND (TG_OP = 'INSERT' OR OLD.status <> 'active') THEN
    PERFORM _notify_client(NEW.client_id, 'plan',
      NEW.addon_name || CASE WHEN TG_OP = 'UPDATE' AND OLD.status IN ('paused', 'suspended') THEN ' is active again' ELSE ' is active 🎉' END,
      _rs(NEW.price) || per || CASE WHEN NEW.auto_invoice AND NEW.next_bill_date IS NOT NULL THEN every || to_char(NEW.next_bill_date, 'DD Mon YYYY') ELSE '' END || '.', lnk);
  ELSIF TG_OP = 'UPDATE' AND NEW.status = 'paused' AND OLD.status <> 'paused' THEN
    PERFORM _notify_client(NEW.client_id, 'plan', NEW.addon_name || ' is paused', 'No invoices while paused. Contact TaxMate to resume.', '/client/plan');
  ELSIF TG_OP = 'UPDATE' AND NEW.status = 'suspended' AND OLD.status <> 'suspended' THEN
    PERFORM _notify_client(NEW.client_id, 'plan', NEW.addon_name || ' is suspended', 'Your records stay available to view. Contact TaxMate to continue.', '/client/plan');
  ELSIF TG_OP = 'UPDATE' AND NEW.status = 'expired' AND OLD.status <> 'expired' THEN
    PERFORM _notify_client(NEW.client_id, 'plan', NEW.addon_name || ' has expired', 'Your invoices stay available to view and download. Subscribe to create new ones.', '/client/plan');
  ELSIF TG_OP = 'UPDATE' AND NEW.status = 'cancelled' AND OLD.status IN ('trial', 'active', 'paused', 'suspended') THEN
    PERFORM _notify_client(NEW.client_id, 'plan', NEW.addon_name || ' has ended', 'No more invoices for this service.', '/client/plan');
  ELSIF TG_OP = 'UPDATE' AND NEW.status = 'cancelled' AND OLD.status = 'requested' THEN
    PERFORM _notify_client(NEW.client_id, 'plan', 'About your ' || NEW.addon_name || ' request', 'TaxMate will contact you about this service.', '/client/plan');
  ELSIF TG_OP = 'UPDATE' AND NEW.status = 'active' AND NEW.price <> OLD.price THEN
    PERFORM _notify_client(NEW.client_id, 'plan', NEW.addon_name || ' price changed', 'New price: ' || _rs(NEW.price) || per || '.', '/client/plan');
  END IF;
  RETURN NEW;
END $$;

-- Client asks for an add-on: VAT add-on can ask monthly or annual
CREATE OR REPLACE FUNCTION public.request_addon_cycle(p_key TEXT, p_cycle TEXT, p_note TEXT)
RETURNS UUID LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE rid UUID; a JSONB;
BEGIN
  IF p_cycle NOT IN ('monthly', 'annual') THEN RAISE EXCEPTION 'Choose monthly or annual.'; END IF;
  rid := public.request_addon(p_key, p_note);
  SELECT x INTO a FROM jsonb_array_elements(coalesce((SELECT value->'addons' FROM public.app_settings WHERE key = 'addons'), '[]'::jsonb)) x WHERE x->>'key' = p_key;
  UPDATE public.service_addons SET billing_cycle = p_cycle,
         price = CASE WHEN p_cycle = 'annual' THEN coalesce((a->>'annual_price')::numeric, price) ELSE price END
   WHERE id = rid;
  RETURN rid;
END $$;
REVOKE ALL ON FUNCTION public.request_addon_cycle(TEXT, TEXT, TEXT) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.request_addon_cycle(TEXT, TEXT, TEXT) TO authenticated;

-- ═══ 2. Who may do what ═══════════════════════════════════════════════════
-- Team members of a business (the owner is the client login; TaxMate admins act as 'taxmate')
CREATE TABLE IF NOT EXISTS public.vi_members (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id   UUID NOT NULL REFERENCES public.clients(id) ON DELETE CASCADE,
  user_id     UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  email       TEXT NOT NULL CHECK (length(email) <= 160),
  full_name   TEXT CHECK (full_name IS NULL OR length(full_name) <= 120),
  role        TEXT NOT NULL CHECK (role IN ('admin', 'accountant', 'invoice_operator', 'viewer', 'purchaser', 'approver')),
  active      BOOLEAN NOT NULL DEFAULT TRUE,
  added_by    UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (client_id, user_id)
);
ALTER TABLE public.vi_members ENABLE ROW LEVEL SECURITY;

-- The live VAT add-on row of a client (trial / active / paused / suspended), else the latest ended one
CREATE OR REPLACE FUNCTION public._vi_addon(p_client UUID) RETURNS public.service_addons
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT s FROM public.service_addons s WHERE s.client_id = p_client AND s.addon_key = 'vat_invoice' AND s.status <> 'requested'
  ORDER BY (s.status IN ('trial', 'active', 'paused', 'suspended')) DESC, s.created_at DESC LIMIT 1;
$$;
REVOKE ALL ON FUNCTION public._vi_addon(UUID) FROM PUBLIC, anon, authenticated;

-- none · trial · active · past_due · paused · suspended · expired · cancelled
CREATE OR REPLACE FUNCTION public._vi_status(p_client UUID) RETURNS TEXT
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE a public.service_addons := public._vi_addon(p_client); grace INT;
BEGIN
  IF a.id IS NULL THEN RETURN 'none'; END IF;
  IF a.status = 'trial' AND a.trial_ends IS NOT NULL AND a.trial_ends < _sl_today() THEN RETURN 'expired'; END IF;
  IF a.status = 'active' THEN
    grace := coalesce(nullif((SELECT value->>'past_due_days' FROM public.app_settings WHERE key = 'vi_policy'), '')::int, 7);
    IF EXISTS (SELECT 1 FROM public.invoices i WHERE i.addon_id = a.id AND i.status IN ('unpaid', 'overdue') AND i.due_date < _sl_today() - grace) THEN
      RETURN 'past_due';
    END IF;
  END IF;
  RETURN a.status;
END $$;
REVOKE ALL ON FUNCTION public._vi_status(UUID) FROM PUBLIC, anon, authenticated;

-- Role of the signed-in user for this business: taxmate · owner · admin · accountant · invoice_operator · viewer · purchaser · approver
CREATE OR REPLACE FUNCTION public._vi_role(p_client UUID) RETURNS TEXT
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT CASE
    WHEN p_client IS NULL OR auth.uid() IS NULL THEN NULL
    WHEN public.is_admin() THEN 'taxmate'
    WHEN public.my_client_id() = p_client THEN 'owner'
    ELSE (SELECT m.role FROM public.vi_members m WHERE m.client_id = p_client AND m.user_id = auth.uid() AND m.active)
  END;
$$;
REVOKE ALL ON FUNCTION public._vi_role(UUID) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public._vi_role(UUID) TO authenticated;

-- Permission check. Viewing is always allowed for members (old records stay readable after
-- the add-on ends); creating / changing needs a trial, active or past-due add-on (TaxMate staff always can).
CREATE OR REPLACE FUNCTION public._vi_can(p_client UUID, p_perm TEXT) RETURNS BOOLEAN
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE r TEXT := public._vi_role(p_client); st TEXT;
BEGIN
  IF r IS NULL THEN RETURN FALSE; END IF;
  IF p_perm NOT IN ('view', 'reports') THEN
    IF r <> 'taxmate' THEN
      st := public._vi_status(p_client);
      IF st NOT IN ('trial', 'active', 'past_due') THEN RETURN FALSE; END IF;
    END IF;
  END IF;
  RETURN CASE r
    WHEN 'taxmate' THEN TRUE
    WHEN 'owner' THEN TRUE
    WHEN 'admin' THEN p_perm <> 'subscription'
    WHEN 'accountant' THEN p_perm IN ('view', 'reports', 'create', 'edit_draft', 'issue', 'submit_ramis', 'credit_note', 'debit_note', 'payment', 'reminder', 'customers', 'purchases', 'approve_purchases', 'cancel')
    WHEN 'invoice_operator' THEN p_perm IN ('view', 'create', 'edit_draft', 'issue', 'payment', 'reminder', 'customers')
    WHEN 'viewer' THEN p_perm IN ('view', 'reports')
    WHEN 'purchaser' THEN p_perm IN ('view', 'purchases')
    WHEN 'approver' THEN p_perm IN ('view', 'reports', 'purchases', 'approve_purchases')
    ELSE FALSE END;
END $$;
REVOKE ALL ON FUNCTION public._vi_can(UUID, TEXT) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public._vi_can(UUID, TEXT) TO authenticated;

CREATE OR REPLACE FUNCTION public._vi_need(p_client UUID, p_perm TEXT) RETURNS VOID
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE st TEXT;
BEGIN
  IF public._vi_can(p_client, p_perm) THEN RETURN; END IF;
  IF public._vi_role(p_client) IS NULL THEN RAISE EXCEPTION 'Not allowed.'; END IF;
  IF p_perm NOT IN ('view', 'reports') AND public._vi_role(p_client) <> 'taxmate' THEN
    st := public._vi_status(p_client);
    IF st NOT IN ('trial', 'active', 'past_due') THEN
      RAISE EXCEPTION 'VAT Invoice add-on is %. Your records stay available to view; subscribe to create or change documents.',
        CASE st WHEN 'none' THEN 'not active' ELSE st END;
    END IF;
  END IF;
  RAISE EXCEPTION 'Your role does not allow this.';
END $$;
REVOKE ALL ON FUNCTION public._vi_need(UUID, TEXT) FROM PUBLIC, anon, authenticated;

-- Plan limit (0 / missing = unlimited)
CREATE OR REPLACE FUNCTION public._vi_limit(p_key TEXT) RETURNS INT
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT coalesce(nullif((SELECT a->'limits'->>p_key FROM public.app_settings s, jsonb_array_elements(coalesce(s.value->'addons', '[]'::jsonb)) a
                          WHERE s.key = 'addons' AND a->>'key' = 'vat_invoice' LIMIT 1), '')::int, 0);
$$;
REVOKE ALL ON FUNCTION public._vi_limit(TEXT) FROM PUBLIC, anon, authenticated;

DROP POLICY IF EXISTS "VAT members read" ON public.vi_members;
CREATE POLICY "VAT members read" ON public.vi_members FOR SELECT TO authenticated USING (_vi_can(client_id, 'view') OR user_id = auth.uid());

-- ═══ 3. Tax rules (TaxMate admin) — rates, schedule mapping, compliance versions ═══
CREATE TABLE IF NOT EXISTS public.vi_tax_rates (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  code           TEXT NOT NULL CHECK (code ~ '^[A-Z0-9_]{2,20}$'),
  tax_type       TEXT NOT NULL DEFAULT 'VAT' CHECK (tax_type IN ('VAT')),
  treatment      TEXT NOT NULL CHECK (treatment IN ('standard', 'zero', 'exempt')),
  rate           NUMERIC(7,3) NOT NULL CHECK (rate >= 0 AND rate < 100),
  effective_from DATE NOT NULL,
  effective_to   DATE CHECK (effective_to IS NULL OR effective_to >= effective_from),
  description    TEXT NOT NULL CHECK (length(description) BETWEEN 1 AND 200),
  ird_reference  TEXT CHECK (ird_reference IS NULL OR length(ird_reference) <= 300),
  ird_status     TEXT NOT NULL DEFAULT 'confirmed' CHECK (ird_status IN ('confirmed', 'verify', 'superseded')),
  version        INT NOT NULL DEFAULT 1,
  created_by     UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at     TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE UNIQUE INDEX IF NOT EXISTS vi_tax_rates_code_from ON public.vi_tax_rates (code, effective_from);
ALTER TABLE public.vi_tax_rates ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "VAT rates read" ON public.vi_tax_rates;
CREATE POLICY "VAT rates read" ON public.vi_tax_rates FOR SELECT TO authenticated USING (TRUE);

INSERT INTO public.vi_tax_rates (code, treatment, rate, effective_from, description, ird_reference, ird_status) VALUES
  ('VAT_STD', 'standard', 18, DATE '2024-01-01', 'VAT — standard rate', 'Value Added Tax (Amendment) Act No. 32 of 2023 (18% from 01.01.2024). TaxMate admin: confirm against the latest IRD gazette.', 'verify'),
  ('VAT_ZERO', 'zero', 0, DATE '2002-08-01', 'Zero-rated supply (0%)', 'VAT Act No. 14 of 2002 — zero-rated supplies', 'confirmed'),
  ('VAT_EXEMPT', 'exempt', 0, DATE '2002-08-01', 'Exempt supply (no VAT)', 'VAT Act No. 14 of 2002 — exempt supplies', 'confirmed')
ON CONFLICT (code, effective_from) DO NOTHING;

-- Which VAT schedule a record belongs to. Configuration, so IRD / RAMIS changes need no code change.
CREATE TABLE IF NOT EXISTS public.vi_schedule_map (
  key        TEXT PRIMARY KEY CHECK (key ~ '^[a-z0-9_:]{3,60}$'),
  side       TEXT NOT NULL CHECK (side IN ('supplier', 'purchaser')),
  schedule   TEXT CHECK (schedule IS NULL OR schedule ~ '^[0-9]{2}$'),
  label      TEXT NOT NULL CHECK (length(label) BETWEEN 1 AND 160),
  basis      TEXT CHECK (basis IS NULL OR length(basis) <= 300),
  active     BOOLEAN NOT NULL DEFAULT TRUE,
  version    INT NOT NULL DEFAULT 1,
  updated_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
ALTER TABLE public.vi_schedule_map ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "VAT schedule map read" ON public.vi_schedule_map;
CREATE POLICY "VAT schedule map read" ON public.vi_schedule_map FOR SELECT TO authenticated USING (TRUE);

INSERT INTO public.vi_schedule_map (key, side, schedule, label, basis) VALUES
  ('out:standard',            'supplier',  '01', 'Output — standard-rated supplies', 'IRD VAT WEB API Quick Guide v0.1: valid invoice → supplier Schedule 1'),
  ('out:zero:goods',          'supplier',  '06', 'Output — zero-rated goods (export)', 'TaxMate spec (Schedule 06 goods export) — confirm against the current VAT return'),
  ('out:zero:services',       'supplier',  '07', 'Output — zero-rated services', 'IRD VAT WEB API Quick Guide v0.1: zero-rated service invoice → supplier Schedule 7'),
  ('out:exempt',              'supplier',  NULL, 'Exempt — not in a VAT schedule', 'Exempt supplies are not on a VAT tax invoice schedule'),
  ('out:note',                'supplier',  '04', 'Credit / debit notes (supplier)', 'IRD VAT WEB API Quick Guide v0.1: tax credit / debit note → supplier Schedule 4'),
  ('in:local',                'purchaser', '02', 'Input — local purchases', 'IRD VAT WEB API Quick Guide v0.1: valid invoice → purchaser Schedule 2'),
  ('in:import',               'purchaser', '03', 'Input — imports', 'TaxMate spec (Schedule 03 imports) — confirm against the current VAT return'),
  ('in:note',                 'purchaser', '04', 'Credit / debit notes (purchaser)', 'IRD VAT WEB API Quick Guide v0.1: tax credit / debit note → purchaser Schedule 4'),
  ('in:deemed',               'purchaser', '05', 'Deemed input', 'TaxMate spec (Schedule 05 deemed input) — confirm against the current VAT return')
ON CONFLICT (key) DO NOTHING;

CREATE OR REPLACE FUNCTION public._vi_schedule(p_key TEXT) RETURNS TEXT
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT schedule FROM public.vi_schedule_map WHERE key = p_key AND active;
$$;
REVOKE ALL ON FUNCTION public._vi_schedule(TEXT) FROM PUBLIC, anon, authenticated;

-- Compliance updates log (gazettes, circulars, rate / format / API / schedule / validation changes)
CREATE TABLE IF NOT EXISTS public.vi_compliance_updates (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  area           TEXT NOT NULL CHECK (area IN ('gazette', 'vat_rate', 'invoice_format', 'ramis_api', 'schedule', 'validation', 'numbering', 'other')),
  title          TEXT NOT NULL CHECK (length(title) BETWEEN 1 AND 200),
  reference      TEXT CHECK (reference IS NULL OR length(reference) <= 300),
  effective_date DATE,
  details        TEXT CHECK (details IS NULL OR length(details) <= 4000),
  rules_version  INT,
  created_by     UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
ALTER TABLE public.vi_compliance_updates ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "VAT compliance read" ON public.vi_compliance_updates;
CREATE POLICY "VAT compliance read" ON public.vi_compliance_updates FOR SELECT TO authenticated USING (TRUE);

INSERT INTO public.app_settings (key, value) VALUES ('vi_compliance', jsonb_build_object(
  'rules_version', 1,
  'invoice_spec', 'IRD Circular SEC/2026/E/03 (20.05.2026) — VAT tax invoice format, effective 01.07.2026',
  'invoice_spec_date', '2026-07-01',
  'ramis_api_spec', 'Not configured — RAMIS Integration Pending Configuration',
  'ramis_reference', 'IRD VAT WEB API Quick Guide v0.1'))
ON CONFLICT (key) DO NOTHING;
INSERT INTO public.app_settings (key, value) VALUES ('vi_policy', jsonb_build_object('past_due_days', 7, 'share_days', 90))
ON CONFLICT (key) DO NOTHING;
-- RAMIS API (no secrets here — only what IRD publishes; logins are each taxpayer's own SSID / password)
INSERT INTO public.app_settings (key, value) VALUES ('vi_ramis_api', jsonb_build_object(
  'active_adapter', 'v1',
  'adapters', jsonb_build_object('v1', jsonb_build_object('status', 'pending', 'spec_version', '', 'auth_method', 'ssid_password_jwt',
     'sandbox', jsonb_build_object('base_url', '', 'token_endpoint', '', 'submit_endpoint', '', 'status_endpoint', ''),
     'production', jsonb_build_object('base_url', '', 'token_endpoint', '', 'submit_endpoint', '', 'status_endpoint', ''),
     'field_map', '{}'::jsonb))))
ON CONFLICT (key) DO NOTHING;

INSERT INTO public.vi_compliance_updates (area, title, reference, effective_date, details, rules_version)
SELECT 'invoice_format', 'New VAT tax invoice format', 'IRD Circular SEC/2026/E/03 dated 20.05.2026 (Gazette Extraordinary No. 2481/22 of 27.03.2026)', DATE '2026-07-01',
       'TAX INVOICE heading; supplier TIN, name, address as per VAT registration; purchaser TIN, name, address where VAT-registered; serial YYMMM_QQQQ_XXXXX (max 40, no spaces, sequential); invoice date and date of supply; description, quantity with units; value excl. VAT, VAT, total incl. VAT in LKR (2 decimals). Optional: mode of payment, place of supply, amount in words.', 1
WHERE NOT EXISTS (SELECT 1 FROM public.vi_compliance_updates WHERE area = 'invoice_format' AND reference LIKE 'IRD Circular SEC/2026/E/03%');
INSERT INTO public.vi_compliance_updates (area, title, reference, details, rules_version)
SELECT 'ramis_api', 'VAT WEB API — data flow', 'IRD VAT WEB API Quick Guide v0.1',
       'SSID + password → JWT. WEB API → MSMQ → Listener → RAMIS. Invoice → supplier Schedule 1 / purchaser Schedule 2 (Pending Approval); credit / debit note → Schedule 4; zero-rated services → Schedule 7. Records submitted through the WEB API cannot be updated or deleted. Endpoints and field specification: not published — adapter pending configuration.', 1
WHERE NOT EXISTS (SELECT 1 FROM public.vi_compliance_updates WHERE area = 'ramis_api' AND reference = 'IRD VAT WEB API Quick Guide v0.1');

-- ═══ 4. Business setup (per client) ═════════════════════════════════════════
CREATE TABLE IF NOT EXISTS public.vi_settings (
  client_id            UUID PRIMARY KEY REFERENCES public.clients(id) ON DELETE CASCADE,
  legal_name           TEXT CHECK (legal_name IS NULL OR length(legal_name) <= 160),
  trading_name         TEXT CHECK (trading_name IS NULL OR length(trading_name) <= 160),
  brn                  TEXT CHECK (brn IS NULL OR length(brn) <= 40),
  tin                  TEXT CHECK (tin IS NULL OR tin ~ '^[0-9]{9}$'),
  vat_registered       BOOLEAN NOT NULL DEFAULT FALSE,
  vat_no               TEXT CHECK (vat_no IS NULL OR length(vat_no) <= 30),
  vat_effective        DATE,
  address              TEXT CHECK (address IS NULL OR length(address) <= 400),
  phone                TEXT CHECK (phone IS NULL OR length(phone) <= 40),
  mobile               TEXT CHECK (mobile IS NULL OR length(mobile) <= 40),
  email                TEXT CHECK (email IS NULL OR length(email) <= 160),
  website              TEXT CHECK (website IS NULL OR length(website) <= 160),
  activity             TEXT CHECK (activity IS NULL OR length(activity) <= 160),
  industry             TEXT CHECK (industry IS NULL OR length(industry) <= 80),
  country              TEXT NOT NULL DEFAULT 'Sri Lanka' CHECK (length(country) <= 60),
  currency             TEXT NOT NULL DEFAULT 'LKR' CHECK (currency ~ '^[A-Z]{3}$'),
  time_zone            TEXT NOT NULL DEFAULT 'Asia/Colombo' CHECK (length(time_zone) <= 60),
  default_rate_code    TEXT NOT NULL DEFAULT 'VAT_STD',
  price_mode           TEXT NOT NULL DEFAULT 'exclusive' CHECK (price_mode IN ('exclusive', 'inclusive')),
  vat_invoice_enabled  BOOLEAN NOT NULL DEFAULT TRUE,
  -- branding
  logo_data            TEXT CHECK (logo_data IS NULL OR (logo_data ~ '^data:image/(png|jpeg|webp);base64,' AND length(logo_data) <= 450000)),
  stamp_data           TEXT CHECK (stamp_data IS NULL OR (stamp_data ~ '^data:image/(png|jpeg|webp);base64,' AND length(stamp_data) <= 300000)),
  logo_position        TEXT NOT NULL DEFAULT 'left' CHECK (logo_position IN ('left', 'center', 'right')),
  brand_name           TEXT CHECK (brand_name IS NULL OR length(brand_name) <= 120),
  brand_color          TEXT NOT NULL DEFAULT '#1e3a8a' CHECK (brand_color ~ '^#[0-9a-fA-F]{6}$'),
  header_text          TEXT CHECK (header_text IS NULL OR length(header_text) <= 300),
  footer_text          TEXT CHECK (footer_text IS NULL OR length(footer_text) <= 500),
  payment_instructions TEXT CHECK (payment_instructions IS NULL OR length(payment_instructions) <= 1000),
  bank_details         TEXT CHECK (bank_details IS NULL OR length(bank_details) <= 600),
  terms                TEXT CHECK (terms IS NULL OR length(terms) <= 2000),
  online_pay_url       TEXT CHECK (online_pay_url IS NULL OR (online_pay_url ~ '^https://' AND length(online_pay_url) <= 300)),
  template_key         TEXT NOT NULL DEFAULT 'classic' CHECK (template_key IN ('classic', 'modern', 'minimal', 'corporate', 'compliance')),
  paper                TEXT NOT NULL DEFAULT 'A4' CHECK (paper IN ('A4', 'Letter')),
  -- terms & reminders
  default_terms_days   INT NOT NULL DEFAULT 30 CHECK (default_terms_days BETWEEN 0 AND 365),
  auto_reminders       BOOLEAN NOT NULL DEFAULT FALSE,
  reminder_rules       JSONB NOT NULL DEFAULT '[{"key":"before3","days":-3,"on":true},{"key":"due","days":0,"on":true},{"key":"after3","days":3,"on":true},{"key":"after7","days":7,"on":true},{"key":"after14","days":14,"on":false},{"key":"after30","days":30,"on":false}]'::jsonb
                       CHECK (jsonb_typeof(reminder_rules) = 'array' AND jsonb_array_length(reminder_rules) <= 12),
  reminder_gap_days    INT NOT NULL DEFAULT 2 CHECK (reminder_gap_days BETWEEN 1 AND 30),
  reminder_cc_me       BOOLEAN NOT NULL DEFAULT FALSE,
  locale               TEXT NOT NULL DEFAULT 'en' CHECK (locale IN ('en', 'si', 'ta')),
  setup_done           BOOLEAN NOT NULL DEFAULT FALSE,
  updated_by           UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at           TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at           TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
ALTER TABLE public.vi_settings ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "VAT settings read" ON public.vi_settings;
CREATE POLICY "VAT settings read" ON public.vi_settings FOR SELECT TO authenticated USING (_vi_can(client_id, 'view'));

CREATE TABLE IF NOT EXISTS public.vi_branches (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id  UUID NOT NULL REFERENCES public.clients(id) ON DELETE CASCADE,
  code       TEXT NOT NULL CHECK (code ~ '^[A-Za-z0-9]{1,15}$'),
  name       TEXT NOT NULL CHECK (length(name) BETWEEN 1 AND 120),
  kind       TEXT NOT NULL DEFAULT 'branch' CHECK (kind IN ('branch', 'department', 'unit', 'project', 'customer_class', 'other')),
  address    TEXT CHECK (address IS NULL OR length(address) <= 400),
  phone      TEXT CHECK (phone IS NULL OR length(phone) <= 40),
  is_default BOOLEAN NOT NULL DEFAULT FALSE,
  active     BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (client_id, code)
);
ALTER TABLE public.vi_branches ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "VAT branches read" ON public.vi_branches;
CREATE POLICY "VAT branches read" ON public.vi_branches FOR SELECT TO authenticated USING (_vi_can(client_id, 'view'));

-- Number sequences. Tax invoice: YYMMM_<code>_<number> (IRD). Others: a format with {YYYY} {YY} {MMM} {MM} {CODE} {N}.
CREATE TABLE IF NOT EXISTS public.vi_sequences (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id  UUID NOT NULL REFERENCES public.clients(id) ON DELETE CASCADE,
  doc_type   TEXT NOT NULL CHECK (doc_type IN ('tax', 'nontax', 'credit', 'debit', 'receipt')),
  code       TEXT NOT NULL CHECK (code ~ '^[A-Za-z0-9]{1,15}$'),
  format     TEXT NOT NULL CHECK (length(format) BETWEEN 3 AND 60 AND format !~ '\s' AND position('{N}' IN format) > 0),
  next_no    BIGINT NOT NULL DEFAULT 1 CHECK (next_no BETWEEN 1 AND 999999999999),
  pad        INT NOT NULL DEFAULT 5 CHECK (pad BETWEEN 1 AND 12),
  reset      TEXT NOT NULL DEFAULT 'never' CHECK (reset IN ('never', 'yearly', 'monthly')),
  reset_reason TEXT CHECK (reset_reason IS NULL OR length(reset_reason) <= 300),
  last_key   TEXT,
  active     BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (client_id, doc_type, code)
);
ALTER TABLE public.vi_sequences ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "VAT sequences read" ON public.vi_sequences;
CREATE POLICY "VAT sequences read" ON public.vi_sequences FOR SELECT TO authenticated USING (_vi_can(client_id, 'view'));

-- ═══ 5. Customers & items ════════════════════════════════════════════════════
CREATE TABLE IF NOT EXISTS public.vi_customers (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id       UUID NOT NULL REFERENCES public.clients(id) ON DELETE CASCADE,
  kind            TEXT NOT NULL DEFAULT 'business' CHECK (kind IN ('individual', 'business')),
  name            TEXT NOT NULL CHECK (length(name) BETWEEN 1 AND 160),
  company_name    TEXT CHECK (company_name IS NULL OR length(company_name) <= 160),
  tin             TEXT CHECK (tin IS NULL OR tin ~ '^[0-9]{9}$'),
  vat_registered  BOOLEAN NOT NULL DEFAULT FALSE,
  vat_no          TEXT CHECK (vat_no IS NULL OR length(vat_no) <= 30),
  address         TEXT CHECK (address IS NULL OR length(address) <= 400),
  phone           TEXT CHECK (phone IS NULL OR length(phone) <= 40),
  email           TEXT CHECK (email IS NULL OR (length(email) <= 160 AND email ~ '^[^@\s]+@[^@\s]+\.[^@\s]+$')),
  contact_person  TEXT CHECK (contact_person IS NULL OR length(contact_person) <= 120),
  credit_limit    NUMERIC(16,2) CHECK (credit_limit IS NULL OR credit_limit >= 0),
  terms_days      INT CHECK (terms_days IS NULL OR terms_days BETWEEN 0 AND 365),
  opening_balance NUMERIC(16,2) NOT NULL DEFAULT 0,
  opening_date    DATE,
  status          TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'inactive')),
  notes           TEXT CHECK (notes IS NULL OR length(notes) <= 1000),
  created_by      UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS vi_customers_client_idx ON public.vi_customers (client_id, status, name);
CREATE INDEX IF NOT EXISTS vi_customers_tin_idx ON public.vi_customers (tin) WHERE tin IS NOT NULL;
ALTER TABLE public.vi_customers ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "VAT customers read" ON public.vi_customers;
CREATE POLICY "VAT customers read" ON public.vi_customers FOR SELECT TO authenticated USING (_vi_can(client_id, 'view'));

CREATE TABLE IF NOT EXISTS public.vi_items (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id   UUID NOT NULL REFERENCES public.clients(id) ON DELETE CASCADE,
  sku         TEXT CHECK (sku IS NULL OR length(sku) <= 40),
  name        TEXT NOT NULL CHECK (length(name) BETWEEN 1 AND 160),
  description TEXT CHECK (description IS NULL OR length(description) <= 1000),
  supply_kind TEXT NOT NULL DEFAULT 'goods' CHECK (supply_kind IN ('goods', 'services')),
  unit        TEXT NOT NULL DEFAULT 'Nos' CHECK (length(unit) BETWEEN 1 AND 20),
  price       NUMERIC(16,4) NOT NULL DEFAULT 0 CHECK (price >= 0),
  rate_code   TEXT NOT NULL DEFAULT 'VAT_STD' CHECK (rate_code ~ '^[A-Z0-9_]{2,20}$'),
  category    TEXT CHECK (category IS NULL OR length(category) <= 60),
  active      BOOLEAN NOT NULL DEFAULT TRUE,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE UNIQUE INDEX IF NOT EXISTS vi_items_sku ON public.vi_items (client_id, lower(sku)) WHERE sku IS NOT NULL;
ALTER TABLE public.vi_items ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "VAT items read" ON public.vi_items;
CREATE POLICY "VAT items read" ON public.vi_items FOR SELECT TO authenticated USING (_vi_can(client_id, 'view'));

-- ═══ 6. Documents: Tax Invoice · Non-Tax Invoice · Credit Note · Debit Note ════
CREATE TABLE IF NOT EXISTS public.vi_documents (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id         UUID NOT NULL REFERENCES public.clients(id) ON DELETE CASCADE,
  doc_type          TEXT NOT NULL CHECK (doc_type IN ('tax', 'nontax', 'credit', 'debit')),
  is_tax            BOOLEAN NOT NULL DEFAULT FALSE,           -- tax invoice, or a note against a tax invoice (RAMIS / schedules)
  status            TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'issued', 'cancelled')),
  doc_no            TEXT CHECK (doc_no IS NULL OR (length(doc_no) <= 40 AND doc_no !~ '\s')),
  sequence_id       UUID REFERENCES public.vi_sequences(id) ON DELETE SET NULL,
  seq_no            BIGINT,
  branch_id         UUID REFERENCES public.vi_branches(id) ON DELETE SET NULL,
  issue_date        DATE NOT NULL DEFAULT CURRENT_DATE,
  supply_date       DATE,
  due_date          DATE,
  terms_days        INT CHECK (terms_days IS NULL OR terms_days BETWEEN 0 AND 365),
  place_of_supply   TEXT CHECK (place_of_supply IS NULL OR length(place_of_supply) <= 160),
  payment_mode      TEXT CHECK (payment_mode IS NULL OR length(payment_mode) <= 60),
  customer_id       UUID REFERENCES public.vi_customers(id) ON DELETE SET NULL,
  customer          JSONB NOT NULL DEFAULT '{}'::jsonb,       -- name, tin, vat_no, vat_registered, address, phone, email (frozen at issue)
  supplier          JSONB NOT NULL DEFAULT '{}'::jsonb,       -- frozen at issue from Invoice & VAT setup
  original_id       UUID REFERENCES public.vi_documents(id) ON DELETE RESTRICT,
  reason_code       TEXT CHECK (reason_code IS NULL OR reason_code IN ('return', 'overcharge', 'quantity', 'vat_error', 'cancellation', 'discount',
                                                                       'undercharge', 'additional', 'price', 'vat_under', 'charge', 'other')),
  reason            TEXT CHECK (reason IS NULL OR length(reason) <= 500),
  price_mode        TEXT NOT NULL DEFAULT 'exclusive' CHECK (price_mode IN ('exclusive', 'inclusive')),
  disc_pct          NUMERIC(7,3) NOT NULL DEFAULT 0 CHECK (disc_pct >= 0 AND disc_pct <= 100),
  disc_amt          NUMERIC(16,2) NOT NULL DEFAULT 0 CHECK (disc_amt >= 0),
  currency          TEXT NOT NULL DEFAULT 'LKR' CHECK (currency ~ '^[A-Z]{3}$'),
  -- totals (calculated by _vi_calc_doc)
  gross             NUMERIC(16,2) NOT NULL DEFAULT 0,
  discount_total    NUMERIC(16,2) NOT NULL DEFAULT 0,
  taxable_standard  NUMERIC(16,2) NOT NULL DEFAULT 0,
  taxable_zero      NUMERIC(16,2) NOT NULL DEFAULT 0,
  exempt_amount     NUMERIC(16,2) NOT NULL DEFAULT 0,
  net_total         NUMERIC(16,2) NOT NULL DEFAULT 0,       -- value of supply excluding VAT
  vat_total         NUMERIC(16,2) NOT NULL DEFAULT 0,
  total             NUMERIC(16,2) NOT NULL DEFAULT 0,       -- including VAT
  -- receivable (kept up to date by _vi_refresh_doc)
  credited          NUMERIC(16,2) NOT NULL DEFAULT 0,
  debited           NUMERIC(16,2) NOT NULL DEFAULT 0,
  paid              NUMERIC(16,2) NOT NULL DEFAULT 0,
  balance           NUMERIC(16,2) NOT NULL DEFAULT 0,
  pay_status        TEXT NOT NULL DEFAULT 'unpaid' CHECK (pay_status IN ('unpaid', 'partial', 'paid', 'overpaid', 'cancelled', 'na')),
  -- RAMIS
  ramis_status      TEXT NOT NULL DEFAULT 'na' CHECK (ramis_status IN ('na', 'draft', 'ready', 'validating', 'queued', 'submitting', 'submitted',
                                                                          'accepted', 'rejected', 'failed', 'locked')),
  ramis_ref         TEXT CHECK (ramis_ref IS NULL OR length(ramis_ref) <= 120),
  ramis_message     TEXT CHECK (ramis_message IS NULL OR length(ramis_message) <= 500),
  ramis_submitted_at TIMESTAMPTZ,
  locked_at         TIMESTAMPTZ,
  -- tax rule snapshot
  rules_version     INT,
  calc_method       TEXT NOT NULL DEFAULT 'line-v1',
  compliance        TEXT,
  -- text
  notes             TEXT CHECK (notes IS NULL OR length(notes) <= 1000),
  terms             TEXT CHECK (terms IS NULL OR length(terms) <= 2000),
  template_key      TEXT CHECK (template_key IS NULL OR template_key IN ('classic', 'modern', 'minimal', 'corporate', 'compliance')),
  -- sharing / reminders
  share_token       UUID,
  share_expires_at  TIMESTAMPTZ,
  share_views       INT NOT NULL DEFAULT 0,
  last_viewed_at    TIMESTAMPTZ,
  reminder_count    INT NOT NULL DEFAULT 0,
  last_reminder_at  TIMESTAMPTZ,
  overdue_notified  DATE,
  -- lifecycle
  issued_at         TIMESTAMPTZ,
  issued_by         UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  cancelled_at      TIMESTAMPTZ,
  cancelled_by      UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  cancel_reason     TEXT CHECK (cancel_reason IS NULL OR length(cancel_reason) <= 500),
  replaced_by       UUID REFERENCES public.vi_documents(id) ON DELETE SET NULL,
  archived_at       TIMESTAMPTZ,
  created_by        UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CHECK ((doc_type IN ('credit', 'debit')) = (original_id IS NOT NULL)),
  CHECK (status = 'draft' OR doc_no IS NOT NULL)
);
CREATE UNIQUE INDEX IF NOT EXISTS vi_documents_no ON public.vi_documents (client_id, doc_no) WHERE doc_no IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS vi_documents_share ON public.vi_documents (share_token) WHERE share_token IS NOT NULL;
CREATE INDEX IF NOT EXISTS vi_documents_list ON public.vi_documents (client_id, doc_type, issue_date DESC);
CREATE INDEX IF NOT EXISTS vi_documents_customer ON public.vi_documents (customer_id, issue_date);
CREATE INDEX IF NOT EXISTS vi_documents_original ON public.vi_documents (original_id) WHERE original_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS vi_documents_due ON public.vi_documents (client_id, due_date) WHERE status = 'issued' AND balance > 0;
ALTER TABLE public.vi_documents ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "VAT documents read" ON public.vi_documents;
CREATE POLICY "VAT documents read" ON public.vi_documents FOR SELECT TO authenticated USING (_vi_can(client_id, 'view'));

CREATE TABLE IF NOT EXISTS public.vi_document_lines (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  doc_id       UUID NOT NULL REFERENCES public.vi_documents(id) ON DELETE CASCADE,
  client_id    UUID NOT NULL REFERENCES public.clients(id) ON DELETE CASCADE,
  sort         INT NOT NULL DEFAULT 0,
  item_id      UUID REFERENCES public.vi_items(id) ON DELETE SET NULL,
  original_line_id UUID REFERENCES public.vi_document_lines(id) ON DELETE SET NULL,
  description  TEXT NOT NULL CHECK (length(description) BETWEEN 1 AND 500),
  supply_kind  TEXT NOT NULL DEFAULT 'goods' CHECK (supply_kind IN ('goods', 'services')),
  quantity     NUMERIC(16,4) NOT NULL CHECK (quantity > 0),
  unit         TEXT NOT NULL DEFAULT 'Nos' CHECK (length(unit) BETWEEN 1 AND 20),
  unit_price   NUMERIC(16,4) NOT NULL CHECK (unit_price >= 0),
  disc_pct     NUMERIC(7,3) NOT NULL DEFAULT 0 CHECK (disc_pct >= 0 AND disc_pct <= 100),
  disc_amt     NUMERIC(16,2) NOT NULL DEFAULT 0 CHECK (disc_amt >= 0),
  rate_code    TEXT NOT NULL,
  rate_id      UUID REFERENCES public.vi_tax_rates(id) ON DELETE RESTRICT,
  treatment    TEXT NOT NULL CHECK (treatment IN ('standard', 'zero', 'exempt', 'none')),   -- none = non-tax document
  rate         NUMERIC(7,3) NOT NULL DEFAULT 0,
  gross        NUMERIC(16,2) NOT NULL DEFAULT 0,       -- qty × price
  discount     NUMERIC(16,2) NOT NULL DEFAULT 0,       -- line + share of document discount
  net          NUMERIC(16,2) NOT NULL DEFAULT 0,       -- value excluding VAT
  vat          NUMERIC(16,2) NOT NULL DEFAULT 0,
  total        NUMERIC(16,2) NOT NULL DEFAULT 0,
  schedule     TEXT
);
CREATE INDEX IF NOT EXISTS vi_document_lines_doc ON public.vi_document_lines (doc_id, sort);
ALTER TABLE public.vi_document_lines ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "VAT lines read" ON public.vi_document_lines;
CREATE POLICY "VAT lines read" ON public.vi_document_lines FOR SELECT TO authenticated USING (_vi_can(client_id, 'view'));

-- ═══ 7. Payments ═══════════════════════════════════════════════════════════
CREATE TABLE IF NOT EXISTS public.vi_payments (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id    UUID NOT NULL REFERENCES public.clients(id) ON DELETE CASCADE,
  customer_id  UUID REFERENCES public.vi_customers(id) ON DELETE SET NULL,
  receipt_no   TEXT,
  amount       NUMERIC(16,2) NOT NULL CHECK (amount > 0),
  paid_on      DATE NOT NULL,
  method       TEXT NOT NULL CHECK (method IN ('cash', 'bank_transfer', 'cheque', 'card', 'mobile', 'online', 'other')),
  reference    TEXT CHECK (reference IS NULL OR length(reference) <= 120),
  bank         TEXT CHECK (bank IS NULL OR length(bank) <= 80),
  notes        TEXT CHECK (notes IS NULL OR length(notes) <= 500),
  attachment_path TEXT CHECK (attachment_path IS NULL OR length(attachment_path) <= 300),
  source       TEXT NOT NULL DEFAULT 'manual' CHECK (source IN ('manual', 'online', 'import')),
  voided_at    TIMESTAMPTZ,
  voided_by    UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  void_reason  TEXT CHECK (void_reason IS NULL OR length(void_reason) <= 300),
  recorded_by  UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS vi_payments_client ON public.vi_payments (client_id, paid_on DESC);
CREATE INDEX IF NOT EXISTS vi_payments_customer ON public.vi_payments (customer_id, paid_on);
CREATE UNIQUE INDEX IF NOT EXISTS vi_payments_receipt ON public.vi_payments (client_id, receipt_no) WHERE receipt_no IS NOT NULL;
ALTER TABLE public.vi_payments ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "VAT payments read" ON public.vi_payments;
CREATE POLICY "VAT payments read" ON public.vi_payments FOR SELECT TO authenticated USING (_vi_can(client_id, 'view'));

CREATE TABLE IF NOT EXISTS public.vi_payment_allocations (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  payment_id  UUID NOT NULL REFERENCES public.vi_payments(id) ON DELETE CASCADE,
  client_id   UUID NOT NULL REFERENCES public.clients(id) ON DELETE CASCADE,
  doc_id      UUID NOT NULL REFERENCES public.vi_documents(id) ON DELETE CASCADE,
  amount      NUMERIC(16,2) NOT NULL CHECK (amount > 0),
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS vi_alloc_doc ON public.vi_payment_allocations (doc_id);
CREATE INDEX IF NOT EXISTS vi_alloc_payment ON public.vi_payment_allocations (payment_id);
ALTER TABLE public.vi_payment_allocations ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "VAT allocations read" ON public.vi_payment_allocations;
CREATE POLICY "VAT allocations read" ON public.vi_payment_allocations FOR SELECT TO authenticated USING (_vi_can(client_id, 'view'));

-- ═══ 8. RAMIS ═══════════════════════════════════════════════════════════════
CREATE TABLE IF NOT EXISTS public.vi_ramis_config (
  client_id        UUID PRIMARY KEY REFERENCES public.clients(id) ON DELETE CASCADE,
  enabled          BOOLEAN NOT NULL DEFAULT FALSE,
  environment      TEXT NOT NULL DEFAULT 'production' CHECK (environment IN ('sandbox', 'production')),
  auto_submit      BOOLEAN NOT NULL DEFAULT FALSE,
  use_saved_login  BOOLEAN NOT NULL DEFAULT FALSE,          -- the SSID + PIN saved in IRD login details (encrypted)
  consent_at       TIMESTAMPTZ,
  consent_by       UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  updated_by       UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
ALTER TABLE public.vi_ramis_config ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "VAT RAMIS config read" ON public.vi_ramis_config;
CREATE POLICY "VAT RAMIS config read" ON public.vi_ramis_config FOR SELECT TO authenticated USING (_vi_can(client_id, 'view'));

CREATE TABLE IF NOT EXISTS public.vi_ramis_submissions (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id        UUID NOT NULL REFERENCES public.clients(id) ON DELETE CASCADE,
  doc_id           UUID NOT NULL REFERENCES public.vi_documents(id) ON DELETE RESTRICT,
  submission_no    TEXT NOT NULL UNIQUE,                    -- idempotency key sent to RAMIS
  kind             TEXT NOT NULL CHECK (kind IN ('invoice', 'credit', 'debit')),
  adapter_version  TEXT NOT NULL DEFAULT 'v1',
  environment      TEXT NOT NULL CHECK (environment IN ('sandbox', 'production')),
  payload          JSONB NOT NULL,
  payload_hash     TEXT NOT NULL,
  status           TEXT NOT NULL DEFAULT 'queued' CHECK (status IN ('pending_config', 'queued', 'submitting', 'retrying', 'submitted',
                                                                    'accepted', 'rejected', 'failed', 'cancelled')),
  check_first      BOOLEAN NOT NULL DEFAULT FALSE,          -- last try timed out → ask RAMIS for status before sending again
  attempts         INT NOT NULL DEFAULT 0,
  max_attempts     INT NOT NULL DEFAULT 6,
  next_attempt_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  last_http_status INT,
  ramis_status     TEXT,
  ramis_ref        TEXT,
  error_code       TEXT,
  error_message    TEXT,
  requested_by     UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  submitted_at     TIMESTAMPTZ,
  responded_at     TIMESTAMPTZ,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
-- one live submission per document (duplicate prevention)
CREATE UNIQUE INDEX IF NOT EXISTS vi_ramis_one_live ON public.vi_ramis_submissions (doc_id)
  WHERE status IN ('pending_config', 'queued', 'submitting', 'retrying', 'submitted', 'accepted');
CREATE INDEX IF NOT EXISTS vi_ramis_queue ON public.vi_ramis_submissions (status, next_attempt_at);
CREATE INDEX IF NOT EXISTS vi_ramis_client ON public.vi_ramis_submissions (client_id, created_at DESC);
ALTER TABLE public.vi_ramis_submissions ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "VAT RAMIS submissions read" ON public.vi_ramis_submissions;
CREATE POLICY "VAT RAMIS submissions read" ON public.vi_ramis_submissions FOR SELECT TO authenticated USING (_vi_can(client_id, 'view'));

-- Technical log (TaxMate admins only); no secrets, no passwords, no tokens
CREATE TABLE IF NOT EXISTS public.vi_ramis_log (
  id            BIGSERIAL PRIMARY KEY,
  submission_id UUID NOT NULL REFERENCES public.vi_ramis_submissions(id) ON DELETE CASCADE,
  client_id     UUID NOT NULL REFERENCES public.clients(id) ON DELETE CASCADE,
  kind          TEXT NOT NULL CHECK (kind IN ('queued', 'request', 'response', 'status_check', 'error', 'retry', 'manual', 'config')),
  http_status   INT,
  message       TEXT CHECK (message IS NULL OR length(message) <= 1000),
  detail        JSONB,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS vi_ramis_log_sub ON public.vi_ramis_log (submission_id, id);
ALTER TABLE public.vi_ramis_log ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "VAT RAMIS log admins" ON public.vi_ramis_log;
CREATE POLICY "VAT RAMIS log admins" ON public.vi_ramis_log FOR SELECT TO authenticated USING (is_admin());

-- ═══ 9. Purchaser VAT inbox ═════════════════════════════════════════════════
CREATE TABLE IF NOT EXISTS public.vi_purchases (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id       UUID NOT NULL REFERENCES public.clients(id) ON DELETE CASCADE,
  source          TEXT NOT NULL CHECK (source IN ('manual', 'csv', 'taxmate', 'api')),
  doc_kind        TEXT NOT NULL DEFAULT 'invoice' CHECK (doc_kind IN ('invoice', 'credit', 'debit')),
  schedule_key    TEXT NOT NULL DEFAULT 'in:local',
  supplier_name   TEXT NOT NULL CHECK (length(supplier_name) BETWEEN 1 AND 160),
  supplier_tin    TEXT CHECK (supplier_tin IS NULL OR supplier_tin ~ '^[0-9]{9}$'),
  supplier_address TEXT CHECK (supplier_address IS NULL OR length(supplier_address) <= 400),
  invoice_no      TEXT NOT NULL CHECK (length(invoice_no) BETWEEN 1 AND 60),
  original_no     TEXT CHECK (original_no IS NULL OR length(original_no) <= 60),
  invoice_date    DATE NOT NULL,
  supply_date     DATE,
  description     TEXT CHECK (description IS NULL OR length(description) <= 500),
  taxable         NUMERIC(16,2) NOT NULL DEFAULT 0,
  vat             NUMERIC(16,2) NOT NULL DEFAULT 0 CHECK (vat >= 0 OR doc_kind = 'credit'),
  total           NUMERIC(16,2) NOT NULL DEFAULT 0,
  disallowed_vat  NUMERIC(16,2) NOT NULL DEFAULT 0 CHECK (disallowed_vat >= 0),
  claim_period    TEXT CHECK (claim_period IS NULL OR claim_period ~ '^\d{4}-(0[1-9]|1[0-2])$'),
  approval        TEXT NOT NULL DEFAULT 'pending' CHECK (approval IN ('pending', 'approved', 'rejected', 'disputed', 'matched')),
  review_note     TEXT CHECK (review_note IS NULL OR length(review_note) <= 500),
  reviewed_by     UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  reviewed_at     TIMESTAMPTZ,
  ramis_status    TEXT NOT NULL DEFAULT 'na',
  linked_doc_id   UUID REFERENCES public.vi_documents(id) ON DELETE SET NULL,
  attachment_path TEXT CHECK (attachment_path IS NULL OR length(attachment_path) <= 300),
  created_by      UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE UNIQUE INDEX IF NOT EXISTS vi_purchases_unique ON public.vi_purchases (client_id, coalesce(supplier_tin, lower(supplier_name)), lower(invoice_no), doc_kind);
CREATE UNIQUE INDEX IF NOT EXISTS vi_purchases_linked ON public.vi_purchases (client_id, linked_doc_id) WHERE linked_doc_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS vi_purchases_list ON public.vi_purchases (client_id, approval, invoice_date DESC);
ALTER TABLE public.vi_purchases ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "VAT purchases read" ON public.vi_purchases;
CREATE POLICY "VAT purchases read" ON public.vi_purchases FOR SELECT TO authenticated USING (_vi_can(client_id, 'view'));

-- ═══ 10. Reminders + audit ═══════════════════════════════════════════════════
CREATE TABLE IF NOT EXISTS public.vi_reminders (
  id          BIGSERIAL PRIMARY KEY,
  client_id   UUID NOT NULL REFERENCES public.clients(id) ON DELETE CASCADE,
  doc_id      UUID NOT NULL REFERENCES public.vi_documents(id) ON DELETE CASCADE,
  rule_key    TEXT CHECK (rule_key IS NULL OR length(rule_key) <= 20),
  channel     TEXT NOT NULL CHECK (channel IN ('email', 'whatsapp', 'sms', 'copy')),
  recipient   TEXT CHECK (recipient IS NULL OR length(recipient) <= 160),
  message     TEXT CHECK (message IS NULL OR length(message) <= 2000),
  status      TEXT NOT NULL DEFAULT 'sent' CHECK (status IN ('sent', 'failed', 'opened')),
  error       TEXT CHECK (error IS NULL OR length(error) <= 300),
  automatic   BOOLEAN NOT NULL DEFAULT FALSE,
  sent_by     UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS vi_reminders_doc ON public.vi_reminders (doc_id, created_at DESC);
CREATE INDEX IF NOT EXISTS vi_reminders_client ON public.vi_reminders (client_id, created_at DESC);
ALTER TABLE public.vi_reminders ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "VAT reminders read" ON public.vi_reminders;
CREATE POLICY "VAT reminders read" ON public.vi_reminders FOR SELECT TO authenticated USING (_vi_can(client_id, 'view'));

CREATE TABLE IF NOT EXISTS public.vi_audit (
  id          BIGSERIAL PRIMARY KEY,
  client_id   UUID NOT NULL REFERENCES public.clients(id) ON DELETE CASCADE,
  doc_id      UUID,
  entity      TEXT NOT NULL,
  entity_id   TEXT,
  action      TEXT NOT NULL,
  actor       UUID,
  actor_role  TEXT,
  ip          TEXT,
  old_value   JSONB,
  new_value   JSONB,
  note        TEXT,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS vi_audit_client ON public.vi_audit (client_id, id DESC);
CREATE INDEX IF NOT EXISTS vi_audit_doc ON public.vi_audit (doc_id, id) WHERE doc_id IS NOT NULL;
ALTER TABLE public.vi_audit ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "VAT audit read" ON public.vi_audit;
CREATE POLICY "VAT audit read" ON public.vi_audit FOR SELECT TO authenticated USING (_vi_can(client_id, 'reports') AND _vi_role(client_id) IN ('taxmate', 'owner', 'admin', 'accountant'));

-- The audit trail can't be changed or removed (only together with the whole client, when TaxMate deletes one)
CREATE OR REPLACE FUNCTION public._vi_audit_guard() RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' AND NOT EXISTS (SELECT 1 FROM public.clients WHERE id = OLD.client_id) THEN RETURN OLD; END IF;
  RAISE EXCEPTION 'The audit trail cannot be changed.';
END $$;
DROP TRIGGER IF EXISTS trg_vi_audit_guard ON public.vi_audit;
CREATE TRIGGER trg_vi_audit_guard BEFORE UPDATE OR DELETE ON public.vi_audit FOR EACH ROW EXECUTE FUNCTION public._vi_audit_guard();

CREATE OR REPLACE FUNCTION public._vi_log(p_client UUID, p_doc UUID, p_entity TEXT, p_entity_id TEXT, p_action TEXT,
                                          p_old JSONB, p_new JSONB, p_note TEXT DEFAULT NULL)
RETURNS VOID LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE ip TEXT;
BEGIN
  BEGIN ip := split_part(current_setting('request.headers', true)::jsonb->>'x-forwarded-for', ',', 1); EXCEPTION WHEN others THEN ip := NULL; END;
  INSERT INTO public.vi_audit (client_id, doc_id, entity, entity_id, action, actor, actor_role, ip, old_value, new_value, note)
  VALUES (p_client, p_doc, p_entity, p_entity_id, p_action, auth.uid(), coalesce(public._vi_role(p_client), CASE WHEN auth.uid() IS NULL THEN 'system' END),
          nullif(trim(ip), ''), p_old, p_new, left(p_note, 500));
END $$;
REVOKE ALL ON FUNCTION public._vi_log(UUID, UUID, TEXT, TEXT, TEXT, JSONB, JSONB, TEXT) FROM PUBLIC, anon, authenticated;

-- ═══ 11. Immutability guards ═════════════════════════════════════════════════
CREATE OR REPLACE FUNCTION public._vi_doc_guard() RETURNS TRIGGER LANGUAGE plpgsql AS $$
DECLARE o JSONB; n JSONB; k TEXT;
        mut TEXT[] := ARRAY['credited', 'debited', 'paid', 'balance', 'pay_status', 'ramis_status', 'ramis_ref', 'ramis_message', 'ramis_submitted_at',
                            'locked_at', 'share_token', 'share_expires_at', 'share_views', 'last_viewed_at', 'reminder_count', 'last_reminder_at',
                            'overdue_notified', 'status', 'cancelled_at', 'cancelled_by', 'cancel_reason', 'replaced_by', 'archived_at', 'updated_at'];
BEGIN
  IF TG_OP = 'DELETE' THEN
    IF OLD.status = 'draft' OR NOT EXISTS (SELECT 1 FROM public.clients WHERE id = OLD.client_id) THEN RETURN OLD; END IF;
    RAISE EXCEPTION 'Issued documents cannot be deleted. Create a Credit Note or Debit Note to correct it.';
  END IF;
  IF NEW.client_id <> OLD.client_id OR NEW.doc_type <> OLD.doc_type THEN RAISE EXCEPTION 'The document type and business cannot change.'; END IF;
  IF OLD.status = 'draft' THEN RETURN NEW; END IF;
  o := to_jsonb(OLD); n := to_jsonb(NEW);
  FOREACH k IN ARRAY mut LOOP o := o - k; n := n - k; END LOOP;
  IF o IS DISTINCT FROM n THEN
    RAISE EXCEPTION '%', CASE WHEN OLD.ramis_status IN ('submitted', 'accepted', 'locked')
      THEN 'This invoice has already been submitted to RAMIS and cannot be edited or deleted. Create a Credit Note or Debit Note to correct the transaction.'
      ELSE 'This document is issued and cannot be edited. Create a Credit Note or Debit Note to correct it.' END;
  END IF;
  IF NEW.status <> OLD.status THEN
    IF NOT (OLD.status = 'issued' AND NEW.status = 'cancelled') THEN RAISE EXCEPTION 'An issued document cannot go back to draft.'; END IF;
    IF OLD.ramis_status IN ('queued', 'submitting', 'submitted', 'accepted', 'locked') THEN
      RAISE EXCEPTION 'This invoice has been sent to IRD/RAMIS and cannot be cancelled. Create a Credit Note instead.';
    END IF;
  END IF;
  IF OLD.ramis_status IN ('accepted', 'locked') AND NEW.ramis_status NOT IN ('accepted', 'locked') THEN
    RAISE EXCEPTION 'An invoice accepted by RAMIS stays locked.';
  END IF;
  IF OLD.locked_at IS NOT NULL AND NEW.locked_at IS DISTINCT FROM OLD.locked_at THEN RAISE EXCEPTION 'Locked.'; END IF;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS trg_vi_doc_guard ON public.vi_documents;
CREATE TRIGGER trg_vi_doc_guard BEFORE UPDATE OR DELETE ON public.vi_documents FOR EACH ROW EXECUTE FUNCTION public._vi_doc_guard();

CREATE OR REPLACE FUNCTION public._vi_line_guard() RETURNS TRIGGER LANGUAGE plpgsql AS $$
DECLARE st TEXT;
BEGIN
  SELECT status INTO st FROM public.vi_documents WHERE id = CASE WHEN TG_OP = 'DELETE' THEN OLD.doc_id ELSE NEW.doc_id END;
  IF st IS NULL OR st = 'draft' THEN RETURN CASE WHEN TG_OP = 'DELETE' THEN OLD ELSE NEW END; END IF;
  RAISE EXCEPTION 'Lines of an issued document cannot be changed.';
END $$;
DROP TRIGGER IF EXISTS trg_vi_line_guard ON public.vi_document_lines;
CREATE TRIGGER trg_vi_line_guard BEFORE INSERT OR UPDATE OR DELETE ON public.vi_document_lines FOR EACH ROW EXECUTE FUNCTION public._vi_line_guard();

-- Payments are financial records: never deleted, only voided once (with a reason)
CREATE OR REPLACE FUNCTION public._vi_pay_guard() RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    IF NOT EXISTS (SELECT 1 FROM public.clients WHERE id = OLD.client_id) THEN RETURN OLD; END IF;
    RAISE EXCEPTION 'Payments cannot be deleted — void it with a reason.';
  END IF;
  IF OLD.voided_at IS NOT NULL THEN RAISE EXCEPTION 'This payment is already void.'; END IF;
  IF (to_jsonb(NEW) - ARRAY['voided_at', 'voided_by', 'void_reason']) IS DISTINCT FROM (to_jsonb(OLD) - ARRAY['voided_at', 'voided_by', 'void_reason']) THEN
    RAISE EXCEPTION 'Payments cannot be edited — void it and record it again.';
  END IF;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS trg_vi_pay_guard ON public.vi_payments;
CREATE TRIGGER trg_vi_pay_guard BEFORE UPDATE OR DELETE ON public.vi_payments FOR EACH ROW EXECUTE FUNCTION public._vi_pay_guard();

CREATE OR REPLACE FUNCTION public._vi_alloc_guard() RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' AND (NOT EXISTS (SELECT 1 FROM public.clients WHERE id = OLD.client_id)
                           OR NOT EXISTS (SELECT 1 FROM public.vi_payments WHERE id = OLD.payment_id)) THEN RETURN OLD; END IF;
  RAISE EXCEPTION 'Payment allocations cannot be changed — void the payment and record it again.';
END $$;
DROP TRIGGER IF EXISTS trg_vi_alloc_guard ON public.vi_payment_allocations;
CREATE TRIGGER trg_vi_alloc_guard BEFORE UPDATE OR DELETE ON public.vi_payment_allocations FOR EACH ROW EXECUTE FUNCTION public._vi_alloc_guard();

-- A client with issued VAT documents can't be deleted (archive instead) — legal record retention
CREATE OR REPLACE FUNCTION public._vi_client_delete_guard() RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  IF EXISTS (SELECT 1 FROM public.vi_documents WHERE client_id = OLD.id AND status <> 'draft') THEN
    RAISE EXCEPTION 'This client has issued VAT invoices / notes, which must be kept. Archive the client instead of deleting.';
  END IF;
  RETURN OLD;
END $$;
DROP TRIGGER IF EXISTS trg_vi_client_delete_guard ON public.clients;
CREATE TRIGGER trg_vi_client_delete_guard BEFORE DELETE ON public.clients FOR EACH ROW EXECUTE FUNCTION public._vi_client_delete_guard();

-- Audit triggers (documents, payments, masters, settings)
CREATE OR REPLACE FUNCTION public._vi_audit_trg() RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE o JSONB := CASE WHEN TG_OP <> 'INSERT' THEN to_jsonb(OLD) END; n JSONB := CASE WHEN TG_OP <> 'DELETE' THEN to_jsonb(NEW) END;
        cid UUID := coalesce((n->>'client_id')::uuid, (o->>'client_id')::uuid); did UUID; act TEXT; ent TEXT := TG_TABLE_NAME; k TEXT;
        noisy TEXT[] := ARRAY['updated_at', 'share_views', 'last_viewed_at', 'logo_data', 'stamp_data'];
BEGIN
  IF NOT EXISTS (SELECT 1 FROM public.clients WHERE id = cid) THEN RETURN NULL; END IF;
  FOREACH k IN ARRAY noisy LOOP o := o - k; n := n - k; END LOOP;
  IF TG_OP = 'UPDATE' AND o IS NOT DISTINCT FROM n THEN RETURN NULL; END IF;
  IF ent = 'vi_documents' THEN
    did := coalesce((n->>'id')::uuid, (o->>'id')::uuid);
    act := CASE WHEN TG_OP = 'INSERT' THEN 'created'
                WHEN TG_OP = 'DELETE' THEN 'draft_deleted'
                WHEN o->>'status' = 'draft' AND n->>'status' = 'issued' THEN 'issued'
                WHEN n->>'status' = 'cancelled' AND o->>'status' <> 'cancelled' THEN 'cancelled'
                WHEN o->>'ramis_status' IS DISTINCT FROM n->>'ramis_status' THEN 'ramis_' || (n->>'ramis_status')
                WHEN o->>'status' = 'draft' THEN 'edited'
                WHEN o->>'paid' IS DISTINCT FROM n->>'paid' OR o->>'credited' IS DISTINCT FROM n->>'credited' OR o->>'debited' IS DISTINCT FROM n->>'debited' THEN 'balance_updated'
                WHEN o->>'share_token' IS DISTINCT FROM n->>'share_token' OR o->>'share_expires_at' IS DISTINCT FROM n->>'share_expires_at' THEN 'share_link'
                WHEN o->>'reminder_count' IS DISTINCT FROM n->>'reminder_count' THEN 'reminder_sent'
                ELSE 'updated' END;
    -- keep the log readable: drop the big JSON parts unless they changed
    IF TG_OP = 'UPDATE' THEN
      IF o->'supplier' = n->'supplier' THEN o := o - 'supplier'; n := n - 'supplier'; END IF;
      IF o->'customer' = n->'customer' THEN o := o - 'customer'; n := n - 'customer'; END IF;
    END IF;
  ELSIF ent = 'vi_payments' THEN
    act := CASE WHEN TG_OP = 'INSERT' THEN 'payment_recorded' WHEN n->>'voided_at' IS NOT NULL THEN 'payment_voided' ELSE 'payment_updated' END;
  ELSE
    act := lower(TG_OP);
  END IF;
  PERFORM public._vi_log(cid, did, ent, coalesce(n->>'id', o->>'id', n->>'client_id', o->>'client_id'), act, o, n);
  RETURN NULL;
END $$;
DO $$ DECLARE t TEXT; BEGIN
  FOREACH t IN ARRAY ARRAY['vi_documents', 'vi_payments', 'vi_customers', 'vi_items', 'vi_settings', 'vi_sequences', 'vi_branches', 'vi_members', 'vi_purchases', 'vi_ramis_config'] LOOP
    EXECUTE format('DROP TRIGGER IF EXISTS trg_vi_audit ON public.%I', t);
    EXECUTE format('CREATE TRIGGER trg_vi_audit AFTER INSERT OR UPDATE OR DELETE ON public.%I FOR EACH ROW EXECUTE FUNCTION public._vi_audit_trg()', t);
  END LOOP;
END $$;

-- ═══ 12. Tax calculation engine (the only place totals are worked out) ═════════
-- Per line: gross = qty × price (2 dp) − line discount − share of the document discount = amount.
--   VAT-exclusive prices: value = amount, VAT = value × rate (2 dp).
--   VAT-inclusive prices: VAT = amount × rate ÷ (100 + rate) (2 dp), value = amount − VAT.
-- Rate = the rate of the line's code in force on the date of supply (else the invoice date).
CREATE OR REPLACE FUNCTION public._vi_calc_doc(p_doc UUID) RETURNS VOID
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE d public.vi_documents; l RECORD; r public.vi_tax_rates; on_date DATE; g NUMERIC; ld NUMERIC; s_after NUMERIC := 0;
        inv_disc NUMERIC; remaining NUMERIC; alloc NUMERIC; base NUMERIC; amt NUMERIC; v NUMERIC; nt NUMERIC; cnt INT; i INT := 0;
        tax_doc BOOLEAN; sch TEXT; rv INT;
BEGIN
  SELECT * INTO d FROM public.vi_documents WHERE id = p_doc FOR UPDATE;
  IF d.status <> 'draft' THEN RAISE EXCEPTION 'Only drafts are recalculated.'; END IF;
  tax_doc := d.is_tax;
  on_date := coalesce(d.supply_date, d.issue_date);
  SELECT count(*) INTO cnt FROM public.vi_document_lines WHERE doc_id = p_doc;
  FOR l IN SELECT * FROM public.vi_document_lines WHERE doc_id = p_doc ORDER BY sort, id LOOP
    g := round(l.quantity * l.unit_price, 2);
    ld := least(g, round(g * l.disc_pct / 100, 2) + l.disc_amt);
    IF tax_doc THEN
      SELECT * INTO r FROM public.vi_tax_rates WHERE code = l.rate_code AND effective_from <= on_date AND (effective_to IS NULL OR effective_to >= on_date)
       ORDER BY effective_from DESC LIMIT 1;
      IF r.id IS NULL THEN RAISE EXCEPTION 'No VAT rate "%" in force on %. Check the date of supply or ask TaxMate.', l.rate_code, to_char(on_date, 'DD Mon YYYY'); END IF;
      UPDATE public.vi_document_lines SET rate_id = r.id, treatment = r.treatment, rate = r.rate, gross = g, discount = ld WHERE id = l.id;
    ELSE
      UPDATE public.vi_document_lines SET rate_id = NULL, rate_code = 'NONE', treatment = 'none', rate = 0, gross = g, discount = ld WHERE id = l.id;
    END IF;
    s_after := s_after + g - ld;
  END LOOP;
  inv_disc := least(s_after, round(s_after * d.disc_pct / 100, 2) + d.disc_amt);
  remaining := inv_disc;
  FOR l IN SELECT * FROM public.vi_document_lines WHERE doc_id = p_doc ORDER BY sort, id LOOP
    i := i + 1;
    base := l.gross - l.discount;
    alloc := CASE WHEN s_after = 0 THEN 0 WHEN i = cnt THEN remaining ELSE round(inv_disc * base / s_after, 2) END;
    alloc := greatest(0, least(alloc, base, remaining));
    remaining := remaining - alloc;
    amt := base - alloc;
    IF l.rate > 0 AND d.price_mode = 'inclusive' THEN
      v := round(amt * l.rate / (100 + l.rate), 2); nt := amt - v;
    ELSE
      nt := amt; v := round(nt * l.rate / 100, 2);
    END IF;
    sch := CASE
      WHEN NOT tax_doc THEN NULL
      WHEN d.doc_type IN ('credit', 'debit') THEN public._vi_schedule('out:note')
      WHEN l.treatment = 'standard' THEN public._vi_schedule('out:standard')
      WHEN l.treatment = 'zero' THEN public._vi_schedule('out:zero:' || l.supply_kind)
      ELSE public._vi_schedule('out:exempt') END;
    UPDATE public.vi_document_lines SET discount = l.discount + alloc, net = nt, vat = v, total = nt + v, schedule = sch WHERE id = l.id;
  END LOOP;
  rv := coalesce((SELECT (value->>'rules_version')::int FROM public.app_settings WHERE key = 'vi_compliance'), 1);
  UPDATE public.vi_documents SET
    gross            = coalesce((SELECT sum(gross) FROM public.vi_document_lines WHERE doc_id = p_doc), 0),
    discount_total   = coalesce((SELECT sum(discount) FROM public.vi_document_lines WHERE doc_id = p_doc), 0),
    taxable_standard = coalesce((SELECT sum(net) FROM public.vi_document_lines WHERE doc_id = p_doc AND treatment = 'standard'), 0),
    taxable_zero     = coalesce((SELECT sum(net) FROM public.vi_document_lines WHERE doc_id = p_doc AND treatment = 'zero'), 0),
    exempt_amount    = coalesce((SELECT sum(net) FROM public.vi_document_lines WHERE doc_id = p_doc AND treatment = 'exempt'), 0),
    net_total        = coalesce((SELECT sum(net) FROM public.vi_document_lines WHERE doc_id = p_doc), 0),
    vat_total        = coalesce((SELECT sum(vat) FROM public.vi_document_lines WHERE doc_id = p_doc), 0),
    total            = coalesce((SELECT sum(total) FROM public.vi_document_lines WHERE doc_id = p_doc), 0),
    rules_version    = rv,
    calc_method      = 'line-v1:' || d.price_mode,
    updated_at       = NOW()
  WHERE id = p_doc;
END $$;
REVOKE ALL ON FUNCTION public._vi_calc_doc(UUID) FROM PUBLIC, anon, authenticated;

-- Receivable figures of an invoice (credits, debits, payments, balance, payment status)
CREATE OR REPLACE FUNCTION public._vi_refresh_doc(p_doc UUID) RETURNS VOID
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE d public.vi_documents; cr NUMERIC; db NUMERIC; pd NUMERIC; bal NUMERIC; ps TEXT;
BEGIN
  SELECT * INTO d FROM public.vi_documents WHERE id = p_doc;
  IF d.id IS NULL OR d.status = 'draft' THEN RETURN; END IF;
  IF d.doc_type IN ('credit', 'debit') THEN
    UPDATE public.vi_documents SET pay_status = 'na', balance = 0 WHERE id = p_doc AND (pay_status <> 'na' OR balance <> 0);
    RETURN;
  END IF;
  SELECT coalesce(sum(total), 0) INTO cr FROM public.vi_documents WHERE original_id = p_doc AND doc_type = 'credit' AND status = 'issued';
  SELECT coalesce(sum(total), 0) INTO db FROM public.vi_documents WHERE original_id = p_doc AND doc_type = 'debit' AND status = 'issued';
  SELECT coalesce(sum(a.amount), 0) INTO pd FROM public.vi_payment_allocations a JOIN public.vi_payments p ON p.id = a.payment_id
   WHERE a.doc_id = p_doc AND p.voided_at IS NULL;
  bal := CASE WHEN d.status = 'cancelled' THEN 0 ELSE d.total + db - cr - pd END;
  ps := CASE WHEN d.status = 'cancelled' THEN 'cancelled' WHEN bal < 0 THEN 'overpaid' WHEN bal = 0 THEN 'paid' WHEN pd > 0 THEN 'partial' ELSE 'unpaid' END;
  UPDATE public.vi_documents SET credited = cr, debited = db, paid = pd, balance = bal, pay_status = ps
   WHERE id = p_doc AND (credited, debited, paid, balance, pay_status) IS DISTINCT FROM (cr, db, pd, bal, ps);
END $$;
REVOKE ALL ON FUNCTION public._vi_refresh_doc(UUID) FROM PUBLIC, anon, authenticated;

-- ═══ 13. Numbering ═══════════════════════════════════════════════════════════
CREATE OR REPLACE FUNCTION public._vi_default_format(p_type TEXT) RETURNS TEXT LANGUAGE sql IMMUTABLE AS $$
  SELECT CASE p_type WHEN 'tax' THEN '{YY}{MMM}_{CODE}_{N}' WHEN 'nontax' THEN 'NT-{YYYY}-{N}' WHEN 'credit' THEN 'CN-{YYYY}-{N}'
                     WHEN 'debit' THEN 'DN-{YYYY}-{N}' ELSE 'RC-{YYYY}-{N}' END;
$$;

CREATE OR REPLACE FUNCTION public._vi_format_no(p_format TEXT, p_code TEXT, p_date DATE, p_n BIGINT, p_pad INT) RETURNS TEXT
LANGUAGE sql IMMUTABLE AS $$
  SELECT replace(replace(replace(replace(replace(replace(p_format,
           '{YYYY}', to_char(p_date, 'YYYY')), '{YY}', to_char(p_date, 'YY')), '{MMM}', upper(to_char(p_date, 'Mon'))),
           '{MM}', to_char(p_date, 'MM')), '{CODE}', p_code), '{N}', lpad(p_n::text, greatest(p_pad, length(p_n::text)), '0'));
$$;

-- IRD: YY + first three letters of the month, _, 1–15 letters/digits, _, digits only; no spaces; max 40
CREATE OR REPLACE FUNCTION public._vi_tax_no_ok(p_no TEXT) RETURNS BOOLEAN LANGUAGE sql IMMUTABLE AS $$
  SELECT p_no IS NOT NULL AND length(p_no) <= 40 AND p_no ~ '^[0-9]{2}(JAN|FEB|MAR|APR|MAY|JUN|JUL|AUG|SEP|OCT|NOV|DEC)_[A-Za-z0-9]{1,15}_[0-9]+$';
$$;

CREATE OR REPLACE FUNCTION public._vi_sequence(p_client UUID, p_type TEXT, p_code TEXT) RETURNS public.vi_sequences
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE s public.vi_sequences; v_code TEXT := coalesce(nullif(p_code, ''), 'MAIN');
BEGIN
  SELECT * INTO s FROM public.vi_sequences q WHERE q.client_id = p_client AND q.doc_type = p_type AND q.code = v_code AND q.active FOR UPDATE;
  IF s.id IS NULL THEN
    INSERT INTO public.vi_sequences (client_id, doc_type, code, format, pad)
    VALUES (p_client, p_type, v_code, public._vi_default_format(p_type), 5)
    ON CONFLICT (client_id, doc_type, code) DO NOTHING;
    SELECT * INTO s FROM public.vi_sequences q WHERE q.client_id = p_client AND q.doc_type = p_type AND q.code = v_code FOR UPDATE;
    IF NOT s.active THEN RAISE EXCEPTION 'Numbering "%" for % is switched off.', v_code, p_type; END IF;
  END IF;
  RETURN s;
END $$;
REVOKE ALL ON FUNCTION public._vi_sequence(UUID, TEXT, TEXT) FROM PUBLIC, anon, authenticated;

-- Take the next number (row-locked: no two documents can get the same number)
CREATE OR REPLACE FUNCTION public._vi_take_no(p_client UUID, p_type TEXT, p_code TEXT, p_date DATE, OUT doc_no TEXT, OUT seq_id UUID, OUT seq_no BIGINT)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE s public.vi_sequences := public._vi_sequence(p_client, p_type, p_code); k TEXT; n BIGINT; tries INT := 0;
BEGIN
  k := CASE s.reset WHEN 'yearly' THEN to_char(p_date, 'YYYY') WHEN 'monthly' THEN to_char(p_date, 'YYYY-MM') ELSE 'all' END;
  n := CASE WHEN s.reset <> 'never' AND s.last_key IS DISTINCT FROM k AND s.last_key IS NOT NULL THEN 1 ELSE s.next_no END;
  LOOP
    doc_no := public._vi_format_no(s.format, s.code, p_date, n, s.pad);
    IF length(doc_no) > 40 OR doc_no ~ '\s' THEN RAISE EXCEPTION 'The number % is too long (max 40, no spaces). Shorten the code or format.', doc_no; END IF;
    IF p_type = 'tax' AND NOT public._vi_tax_no_ok(doc_no) THEN RAISE EXCEPTION 'The number % is not in the IRD format YYMMM_QQQQ_XXXXX.', doc_no; END IF;
    EXIT WHEN NOT EXISTS (SELECT 1 FROM public.vi_documents d WHERE d.client_id = p_client AND d.doc_no = _vi_take_no.doc_no)
          AND NOT EXISTS (SELECT 1 FROM public.vi_payments p WHERE p.client_id = p_client AND p.receipt_no = _vi_take_no.doc_no);
    n := n + 1; tries := tries + 1;
    IF tries > 1000 THEN RAISE EXCEPTION 'Could not find a free number.'; END IF;
  END LOOP;
  UPDATE public.vi_sequences SET next_no = n + 1, last_key = k, updated_at = NOW() WHERE id = s.id;
  seq_id := s.id; seq_no := n;
END $$;
REVOKE ALL ON FUNCTION public._vi_take_no(UUID, TEXT, TEXT, DATE) FROM PUBLIC, anon, authenticated;

-- Preview of the next number (no number is used up)
CREATE OR REPLACE FUNCTION public.vi_preview_no(p_client UUID, p_type TEXT, p_code TEXT, p_date DATE) RETURNS TEXT
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE s public.vi_sequences; k TEXT; n BIGINT; c TEXT := coalesce(nullif(p_code, ''), 'MAIN');
BEGIN
  PERFORM public._vi_need(p_client, 'view');
  SELECT * INTO s FROM public.vi_sequences WHERE client_id = p_client AND doc_type = p_type AND code = c;
  IF s.id IS NULL THEN RETURN public._vi_format_no(public._vi_default_format(p_type), c, coalesce(p_date, CURRENT_DATE), 1, 5); END IF;
  k := CASE s.reset WHEN 'yearly' THEN to_char(p_date, 'YYYY') WHEN 'monthly' THEN to_char(p_date, 'YYYY-MM') ELSE 'all' END;
  n := CASE WHEN s.reset <> 'never' AND s.last_key IS DISTINCT FROM k AND s.last_key IS NOT NULL THEN 1 ELSE s.next_no END;
  RETURN public._vi_format_no(s.format, s.code, coalesce(p_date, CURRENT_DATE), n, s.pad);
END $$;
REVOKE ALL ON FUNCTION public.vi_preview_no(UUID, TEXT, TEXT, DATE) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.vi_preview_no(UUID, TEXT, TEXT, DATE) TO authenticated;

-- ═══ 14. Compliance validation (before issue and before RAMIS) ══════════════════
-- Returns {ok, checks:[{key,label,ok,level,msg}]}; level 'error' blocks, 'warning' informs.
CREATE OR REPLACE FUNCTION public._vi_validate(p_doc UUID, p_for_ramis BOOLEAN DEFAULT FALSE) RETURNS JSONB
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE d public.vi_documents; st public.vi_settings; c public.vi_customers; o public.vi_documents; rc public.vi_ramis_config;
        checks JSONB := '[]'::jsonb; cust JSONB; tin TEXT; n_lines INT; bad TEXT; last_d DATE; v_code TEXT; prev_no TEXT; room NUMERIC; x NUMERIC; y NUMERIC;
        dup TEXT;
BEGIN
  SELECT * INTO d FROM public.vi_documents WHERE id = p_doc;
  SELECT * INTO st FROM public.vi_settings WHERE client_id = d.client_id;
  IF d.customer_id IS NOT NULL THEN SELECT * INTO c FROM public.vi_customers WHERE id = d.customer_id; END IF;
  cust := CASE WHEN d.status = 'draft' AND c.id IS NOT NULL THEN jsonb_build_object('name', c.name, 'tin', c.tin, 'vat_registered', c.vat_registered,
                 'address', c.address, 'phone', c.phone) ELSE d.customer END;
  tin := nullif(cust->>'tin', '');
  SELECT count(*) INTO n_lines FROM public.vi_document_lines WHERE doc_id = p_doc;
  v_code := coalesce((SELECT b.code FROM public.vi_branches b WHERE b.id = d.branch_id), 'MAIN');

  -- helper: append a check
  -- (inline jsonb_build_object calls; level error unless noted)
  IF d.is_tax THEN
    checks := checks || jsonb_build_object('key', 'supplier', 'label', 'Supplier information', 'level', 'error',
      'ok', st.client_id IS NOT NULL AND coalesce(st.legal_name, '') <> '' AND coalesce(st.address, '') <> '',
      'msg', 'Enter the registered business name and address in Invoice & VAT setup (exactly as on the VAT registration certificate).');
    checks := checks || jsonb_build_object('key', 'supplier_tin', 'label', 'Supplier TIN', 'level', 'error',
      'ok', coalesce(st.tin, '') ~ '^[0-9]{9}$', 'msg', 'Supplier TIN must be 9 digits (Invoice & VAT setup).');
    checks := checks || jsonb_build_object('key', 'vat_registration', 'label', 'VAT registration', 'level', 'error',
      'ok', coalesce(st.vat_registered, false) AND (st.vat_effective IS NULL OR st.vat_effective <= d.issue_date),
      'msg', CASE WHEN NOT coalesce(st.vat_registered, false) THEN 'Only VAT-registered persons can issue a Tax Invoice. Use a Non-Tax Invoice, or update Invoice & VAT setup.'
                  ELSE 'The invoice date is before your VAT registration date (' || to_char(st.vat_effective, 'DD Mon YYYY') || ').' END);
    checks := checks || jsonb_build_object('key', 'purchaser', 'label', 'Purchaser information', 'level', 'error',
      'ok', coalesce(cust->>'name', '') <> '' AND (NOT coalesce((cust->>'vat_registered')::boolean, false) OR coalesce(cust->>'address', '') <> ''),
      'msg', 'Purchaser name is required; for a VAT-registered purchaser also the address.');
    checks := checks || jsonb_build_object('key', 'purchaser_tin', 'label', 'Purchaser TIN', 'level',
      CASE WHEN coalesce((cust->>'vat_registered')::boolean, false) THEN 'error' ELSE 'warning' END,
      'ok', tin ~ '^[0-9]{9}$', 'msg', CASE WHEN coalesce((cust->>'vat_registered')::boolean, false)
        THEN 'A VAT-registered purchaser''s TIN (9 digits) is required — without it the purchaser cannot claim input VAT.'
        ELSE 'No purchaser TIN — fine for a purchaser who is not VAT-registered.' END);
    checks := checks || jsonb_build_object('key', 'currency', 'label', 'Currency (LKR)', 'level', 'error', 'ok', d.currency = 'LKR',
      'msg', 'Tax invoices are in LKR. Foreign-currency invoices need Central Bank approval and LKR conversion.');
  ELSE
    checks := checks || jsonb_build_object('key', 'customer', 'label', 'Customer', 'level', 'error', 'ok', coalesce(cust->>'name', '') <> '',
      'msg', 'Choose a customer or enter the customer name.');
  END IF;

  IF d.status = 'draft' THEN
    checks := checks || jsonb_build_object('key', 'invoice_no', 'label', 'Invoice number', 'level', 'error',
      'ok', d.doc_type <> 'tax' OR public._vi_tax_no_ok(public.vi_preview_no_internal(d.client_id, d.doc_type, v_code, d.issue_date)),
      'msg', 'The next number does not fit the IRD format (YYMMM_QQQQ_XXXXX, max 40). Check Invoice numbering.');
  ELSE
    checks := checks || jsonb_build_object('key', 'invoice_no', 'label', 'Invoice number', 'level', 'error',
      'ok', d.doc_type <> 'tax' OR public._vi_tax_no_ok(d.doc_no), 'msg', 'The number is not in the IRD format.');
  END IF;

  checks := checks || jsonb_build_object('key', 'invoice_date', 'label', 'Invoice date', 'level', 'error',
    'ok', d.issue_date <= (now() AT TIME ZONE 'Asia/Colombo')::date + 1, 'msg', 'The invoice date cannot be in the future.');
  IF d.status = 'draft' AND d.doc_type = 'tax' THEN
    SELECT max(x2.issue_date), (array_agg(x2.doc_no ORDER BY x2.seq_no DESC))[1] INTO last_d, prev_no
      FROM public.vi_documents x2 JOIN public.vi_sequences q ON q.id = x2.sequence_id
     WHERE x2.client_id = d.client_id AND x2.doc_type = 'tax' AND x2.status <> 'draft' AND q.code = v_code;
    checks := checks || jsonb_build_object('key', 'sequence_date', 'label', 'Sequential order', 'level', 'error',
      'ok', last_d IS NULL OR d.issue_date >= last_d,
      'msg', 'The last tax invoice on this sequence (' || coalesce(prev_no, '') || ') is dated ' || coalesce(to_char(last_d, 'DD Mon YYYY'), '') ||
             '. A new invoice cannot be dated earlier — IRD requires sequential continuity.');
  END IF;
  IF d.doc_type = 'tax' THEN
    checks := checks || jsonb_build_object('key', 'supply_date', 'label', 'Date of supply', 'level', 'error', 'ok', d.supply_date IS NOT NULL,
      'msg', 'Enter the date of supply (IRD needs both the invoice date and the date of supply).');
  END IF;

  SELECT string_agg(DISTINCT description, ', ') INTO bad FROM public.vi_document_lines
   WHERE doc_id = p_doc AND (length(trim(description)) < 3 OR lower(trim(description)) IN ('items', 'item', 'products', 'product', 'services', 'service', 'miscellaneous', 'misc', 'goods', 'sundries'));
  checks := checks || jsonb_build_object('key', 'description', 'label', 'Item description', 'level', CASE WHEN d.is_tax THEN 'error' ELSE 'warning' END,
    'ok', n_lines > 0 AND bad IS NULL, 'msg', CASE WHEN n_lines = 0 THEN 'Add at least one line.'
      ELSE 'Describe the supply clearly — IRD does not accept general words like "' || bad || '".' END);
  checks := checks || jsonb_build_object('key', 'quantity', 'label', 'Quantity & unit', 'level', 'error',
    'ok', n_lines > 0 AND NOT EXISTS (SELECT 1 FROM public.vi_document_lines WHERE doc_id = p_doc AND (quantity <= 0 OR trim(unit) = '')),
    'msg', 'Every line needs a quantity above 0 and a unit.');
  checks := checks || jsonb_build_object('key', 'taxable_value', 'label', 'Taxable value', 'level', 'error', 'ok', d.net_total > 0,
    'msg', 'The value of supply must be more than 0.');
  IF d.is_tax THEN
    checks := checks || jsonb_build_object('key', 'vat_rate', 'label', 'VAT rate', 'level', 'error',
      'ok', NOT EXISTS (SELECT 1 FROM public.vi_document_lines l LEFT JOIN public.vi_tax_rates r ON r.id = l.rate_id WHERE l.doc_id = p_doc
                        AND (r.id IS NULL OR r.effective_from > coalesce(d.supply_date, d.issue_date) OR (r.effective_to IS NOT NULL AND r.effective_to < coalesce(d.supply_date, d.issue_date)))),
      'msg', 'A line has no VAT rate valid on the date of supply.');
    SELECT coalesce(sum(vat), 0), coalesce(sum(CASE WHEN rate > 0 AND d.price_mode = 'exclusive' THEN round(net * rate / 100, 2) ELSE vat END), 0)
      INTO x, y FROM public.vi_document_lines WHERE doc_id = p_doc;
    checks := checks || jsonb_build_object('key', 'vat_amount', 'label', 'VAT amount', 'level', 'error', 'ok', x = d.vat_total AND x = y,
      'msg', 'VAT does not add up — save the draft again to recalculate.');
    checks := checks || jsonb_build_object('key', 'exempt_lines', 'label', 'Only taxable supplies', 'level', 'warning',
      'ok', NOT EXISTS (SELECT 1 FROM public.vi_document_lines WHERE doc_id = p_doc AND treatment = 'exempt'),
      'msg', 'Exempt items may appear on a tax invoice only when they are part of the taxable supply (IRD). Otherwise put them on a Non-Tax Invoice.');
    checks := checks || jsonb_build_object('key', 'schedule', 'label', 'Schedule mapping', 'level', 'error',
      'ok', NOT EXISTS (SELECT 1 FROM public.vi_document_lines WHERE doc_id = p_doc AND treatment <> 'exempt' AND schedule IS NULL),
      'msg', 'A line has no VAT schedule — TaxMate admin must map it (VAT schedule mapping).');
  END IF;
  SELECT coalesce(sum(net), 0) + coalesce(sum(vat), 0) INTO x FROM public.vi_document_lines WHERE doc_id = p_doc;
  checks := checks || jsonb_build_object('key', 'total', 'label', 'Total', 'level', 'error', 'ok', x = d.total AND d.total = d.net_total + d.vat_total,
    'msg', 'Total ≠ value + VAT — save the draft again to recalculate.');

  -- duplicate check: same customer, date and total already issued
  SELECT x3.doc_no INTO dup FROM public.vi_documents x3 WHERE x3.client_id = d.client_id AND x3.id <> d.id AND x3.status = 'issued'
     AND x3.doc_type = d.doc_type AND x3.issue_date = d.issue_date AND x3.total = d.total
     AND coalesce(x3.customer->>'name', '') = coalesce(cust->>'name', '') LIMIT 1;
  checks := checks || jsonb_build_object('key', 'duplicate', 'label', 'Duplicate check', 'level', 'warning', 'ok', dup IS NULL,
    'msg', 'Looks like ' || coalesce(dup, '') || ' (same customer, date and total). Make sure this is not a duplicate.');

  IF d.doc_type IN ('credit', 'debit') THEN
    SELECT * INTO o FROM public.vi_documents WHERE id = d.original_id;
    checks := checks || jsonb_build_object('key', 'original', 'label', 'Original invoice', 'level', 'error',
      'ok', o.id IS NOT NULL AND o.status = 'issued' AND o.client_id = d.client_id,
      'msg', 'The original invoice must be issued and not cancelled.');
    checks := checks || jsonb_build_object('key', 'reason', 'label', 'Reason', 'level', 'error', 'ok', d.reason_code IS NOT NULL OR coalesce(d.reason, '') <> '',
      'msg', 'Give the reason for the note.');
    checks := checks || jsonb_build_object('key', 'note_date', 'label', 'Note date', 'level', 'error', 'ok', o.id IS NULL OR d.issue_date >= o.issue_date,
      'msg', 'The note cannot be dated before the original invoice (' || coalesce(to_char(o.issue_date, 'DD Mon YYYY'), '') || ').');
    IF d.doc_type = 'credit' AND o.id IS NOT NULL THEN
      room := o.total + o.debited - o.credited;
      checks := checks || jsonb_build_object('key', 'credit_limit', 'label', 'Credit not more than the invoice', 'level', 'error', 'ok', d.total <= room,
        'msg', 'You can credit at most ' || _rs(room) || ' (invoice + debit notes − earlier credit notes).');
    END IF;
  END IF;

  IF p_for_ramis THEN
    SELECT * INTO rc FROM public.vi_ramis_config WHERE client_id = d.client_id;
    checks := checks || jsonb_build_object('key', 'ramis_enabled', 'label', 'RAMIS Web API switched on', 'level', 'error', 'ok', coalesce(rc.enabled, false),
      'msg', 'Switch on RAMIS in Settings → RAMIS Integration.');
    checks := checks || jsonb_build_object('key', 'ramis_login', 'label', 'RAMIS login (SSID + password)', 'level', 'error',
      'ok', coalesce(rc.use_saved_login, false) AND rc.consent_at IS NOT NULL
            AND EXISTS (SELECT 1 FROM public.client_ird i WHERE i.client_id = d.client_id AND i.ssid_enc IS NOT NULL AND i.pin_enc IS NOT NULL),
      'msg', 'Save the RAMIS SSID and password (IRD login details) and allow TaxMate to use them for Web API submissions.');
    checks := checks || jsonb_build_object('key', 'ramis_doc', 'label', 'Document can go to RAMIS', 'level', 'error',
      'ok', d.is_tax AND d.status = 'issued', 'msg', 'Only issued tax invoices and tax credit / debit notes go to RAMIS.');
  END IF;

  RETURN jsonb_build_object('ok', NOT EXISTS (SELECT 1 FROM jsonb_array_elements(checks) e WHERE NOT (e->>'ok')::boolean AND e->>'level' = 'error'),
                            'checks', checks);
END $$;
REVOKE ALL ON FUNCTION public._vi_validate(UUID, BOOLEAN) FROM PUBLIC, anon, authenticated;

-- next number without permission check (for validation)
CREATE OR REPLACE FUNCTION public.vi_preview_no_internal(p_client UUID, p_type TEXT, p_code TEXT, p_date DATE) RETURNS TEXT
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE s public.vi_sequences; k TEXT; n BIGINT; c TEXT := coalesce(nullif(p_code, ''), 'MAIN');
BEGIN
  SELECT * INTO s FROM public.vi_sequences WHERE client_id = p_client AND doc_type = p_type AND code = c;
  IF s.id IS NULL THEN RETURN public._vi_format_no(public._vi_default_format(p_type), c, coalesce(p_date, CURRENT_DATE), 1, 5); END IF;
  k := CASE s.reset WHEN 'yearly' THEN to_char(p_date, 'YYYY') WHEN 'monthly' THEN to_char(p_date, 'YYYY-MM') ELSE 'all' END;
  n := CASE WHEN s.reset <> 'never' AND s.last_key IS DISTINCT FROM k AND s.last_key IS NOT NULL THEN 1 ELSE s.next_no END;
  RETURN public._vi_format_no(s.format, s.code, coalesce(p_date, CURRENT_DATE), n, s.pad);
END $$;
REVOKE ALL ON FUNCTION public.vi_preview_no_internal(UUID, TEXT, TEXT, DATE) FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.vi_validate(p_doc UUID, p_for_ramis BOOLEAN DEFAULT FALSE) RETURNS JSONB
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE cid UUID;
BEGIN
  SELECT client_id INTO cid FROM public.vi_documents WHERE id = p_doc;
  IF cid IS NULL THEN RAISE EXCEPTION 'Document not found.'; END IF;
  PERFORM public._vi_need(cid, 'view');
  RETURN public._vi_validate(p_doc, p_for_ramis);
END $$;
REVOKE ALL ON FUNCTION public.vi_validate(UUID, BOOLEAN) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.vi_validate(UUID, BOOLEAN) TO authenticated;

-- ═══ 15. Context, workspaces, members ════════════════════════════════════════
CREATE OR REPLACE FUNCTION public.vi_context(p_client UUID) RETURNS JSONB
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE r TEXT := public._vi_role(p_client); a public.service_addons := public._vi_addon(p_client); perms JSONB := '{}'::jsonb; k TEXT;
BEGIN
  IF r IS NULL THEN RAISE EXCEPTION 'Not allowed.'; END IF;
  FOREACH k IN ARRAY ARRAY['view', 'reports', 'create', 'edit_draft', 'issue', 'submit_ramis', 'credit_note', 'debit_note', 'payment', 'reminder',
                           'customers', 'purchases', 'approve_purchases', 'cancel', 'settings', 'users', 'subscription'] LOOP
    perms := perms || jsonb_build_object(k, public._vi_can(p_client, k));
  END LOOP;
  RETURN jsonb_build_object(
    'client_id', p_client, 'client_name', (SELECT full_name FROM public.clients WHERE id = p_client), 'role', r, 'perms', perms,
    'status', public._vi_status(p_client),
    'addon', CASE WHEN a.id IS NULL THEN NULL ELSE jsonb_build_object('id', a.id, 'status', a.status, 'cycle', a.billing_cycle, 'price', a.price,
               'trial_ends', a.trial_ends, 'next_bill_date', a.next_bill_date, 'start_date', a.start_date) END,
    'requested', EXISTS (SELECT 1 FROM public.service_addons WHERE client_id = p_client AND addon_key = 'vat_invoice' AND status = 'requested'),
    'catalog', (SELECT x FROM public.app_settings s, jsonb_array_elements(coalesce(s.value->'addons', '[]'::jsonb)) x WHERE s.key = 'addons' AND x->>'key' = 'vat_invoice' LIMIT 1),
    'setup_done', coalesce((SELECT setup_done FROM public.vi_settings WHERE client_id = p_client), false),
    'compliance', (SELECT value FROM public.app_settings WHERE key = 'vi_compliance'),
    'ramis_adapter', (SELECT value->'adapters'->(value->>'active_adapter')->>'status' FROM public.app_settings WHERE key = 'vi_ramis_api'),
    'month_issued', (SELECT count(*) FROM public.vi_documents WHERE client_id = p_client AND status <> 'draft' AND doc_type IN ('tax', 'nontax')
                      AND issue_date >= date_trunc('month', (now() AT TIME ZONE 'Asia/Colombo'))::date));
END $$;
REVOKE ALL ON FUNCTION public.vi_context(UUID) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.vi_context(UUID) TO authenticated;

-- Businesses the signed-in user can open: own client + team memberships
CREATE OR REPLACE FUNCTION public.vi_my_workspaces() RETURNS JSONB
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT coalesce(jsonb_agg(w ORDER BY w->>'name'), '[]'::jsonb) FROM (
    SELECT jsonb_build_object('client_id', c.id, 'name', coalesce(s.trading_name, s.legal_name, c.full_name), 'role', 'owner', 'status', public._vi_status(c.id)) w
      FROM public.clients c LEFT JOIN public.vi_settings s ON s.client_id = c.id WHERE c.id = public._my_own_client_id()
    UNION ALL
    SELECT jsonb_build_object('client_id', c.id, 'name', coalesce(s.trading_name, s.legal_name, c.full_name), 'role', m.role, 'status', public._vi_status(c.id))
      FROM public.vi_members m JOIN public.clients c ON c.id = m.client_id LEFT JOIN public.vi_settings s ON s.client_id = c.id
     WHERE m.user_id = auth.uid() AND m.active) t(w);
$$;
REVOKE ALL ON FUNCTION public.vi_my_workspaces() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.vi_my_workspaces() TO authenticated;

CREATE OR REPLACE FUNCTION public.vi_save_member(p_client UUID, p_email TEXT, p_role TEXT, p_active BOOLEAN DEFAULT TRUE) RETURNS UUID
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE u UUID; nm TEXT; mid UUID; lim INT := public._vi_limit('users'); em TEXT := lower(trim(coalesce(p_email, '')));
BEGIN
  PERFORM public._vi_need(p_client, 'users');
  IF p_role NOT IN ('admin', 'accountant', 'invoice_operator', 'viewer', 'purchaser', 'approver') THEN RAISE EXCEPTION 'Unknown role.'; END IF;
  SELECT au.id INTO u FROM auth.users au WHERE lower(au.email) = em LIMIT 1;
  IF u IS NULL THEN RAISE EXCEPTION 'No TaxMate login with this email yet. Ask TaxMate to create a login for this person, then add them.'; END IF;
  IF EXISTS (SELECT 1 FROM public.clients WHERE id = p_client AND profile_id = u) THEN RAISE EXCEPTION 'That is the owner''s own login.'; END IF;
  IF EXISTS (SELECT 1 FROM public.profiles WHERE id = u AND role = 'admin') THEN RAISE EXCEPTION 'TaxMate staff already have access.'; END IF;
  IF lim > 0 AND p_active AND (SELECT count(*) FROM public.vi_members WHERE client_id = p_client AND active AND user_id <> u) + 1 >= lim THEN
    RAISE EXCEPTION 'Your plan allows % users (including the owner).', lim;
  END IF;
  SELECT full_name INTO nm FROM public.profiles WHERE id = u;
  INSERT INTO public.vi_members (client_id, user_id, email, full_name, role, active, added_by)
  VALUES (p_client, u, em, nm, p_role, coalesce(p_active, true), auth.uid())
  ON CONFLICT (client_id, user_id) DO UPDATE SET role = EXCLUDED.role, active = EXCLUDED.active, updated_at = NOW()
  RETURNING id INTO mid;
  RETURN mid;
END $$;
REVOKE ALL ON FUNCTION public.vi_save_member(UUID, TEXT, TEXT, BOOLEAN) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.vi_save_member(UUID, TEXT, TEXT, BOOLEAN) TO authenticated;

CREATE OR REPLACE FUNCTION public.vi_remove_member(p_id UUID) RETURNS VOID
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE cid UUID;
BEGIN
  SELECT client_id INTO cid FROM public.vi_members WHERE id = p_id;
  IF cid IS NULL THEN RAISE EXCEPTION 'Not found.'; END IF;
  PERFORM public._vi_need(cid, 'users');
  DELETE FROM public.vi_members WHERE id = p_id;
END $$;
REVOKE ALL ON FUNCTION public.vi_remove_member(UUID) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.vi_remove_member(UUID) TO authenticated;

-- ═══ 16. Setup, branches, numbering, customers, items ═════════════════════════
CREATE OR REPLACE FUNCTION public.vi_save_settings(p_client UUID, p JSONB) RETURNS VOID
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE t TEXT := nullif(regexp_replace(coalesce(p->>'tin', ''), '\D', '', 'g'), '');
BEGIN
  PERFORM public._vi_need(p_client, 'settings');
  IF t IS NOT NULL AND t !~ '^[0-9]{9}$' THEN RAISE EXCEPTION 'TIN must be 9 digits.'; END IF;
  IF coalesce((p->>'vat_registered')::boolean, false) AND t IS NULL THEN RAISE EXCEPTION 'A VAT-registered business needs its TIN.'; END IF;
  INSERT INTO public.vi_settings AS s (client_id) VALUES (p_client) ON CONFLICT (client_id) DO NOTHING;
  UPDATE public.vi_settings SET
    legal_name = nullif(trim(p->>'legal_name'), ''), trading_name = nullif(trim(p->>'trading_name'), ''), brn = nullif(trim(p->>'brn'), ''),
    tin = t, vat_registered = coalesce((p->>'vat_registered')::boolean, false), vat_no = nullif(trim(p->>'vat_no'), ''),
    vat_effective = nullif(p->>'vat_effective', '')::date, address = nullif(trim(p->>'address'), ''), phone = nullif(trim(p->>'phone'), ''),
    mobile = nullif(trim(p->>'mobile'), ''), email = nullif(trim(p->>'email'), ''), website = nullif(trim(p->>'website'), ''),
    activity = nullif(trim(p->>'activity'), ''), industry = nullif(trim(p->>'industry'), ''),
    country = coalesce(nullif(trim(p->>'country'), ''), 'Sri Lanka'), currency = coalesce(nullif(p->>'currency', ''), 'LKR'),
    time_zone = coalesce(nullif(p->>'time_zone', ''), 'Asia/Colombo'),
    default_rate_code = coalesce(nullif(p->>'default_rate_code', ''), 'VAT_STD'), price_mode = coalesce(nullif(p->>'price_mode', ''), 'exclusive'),
    vat_invoice_enabled = coalesce((p->>'vat_invoice_enabled')::boolean, true),
    logo_data = CASE WHEN p ? 'logo_data' THEN nullif(p->>'logo_data', '') ELSE logo_data END,
    stamp_data = CASE WHEN p ? 'stamp_data' THEN nullif(p->>'stamp_data', '') ELSE stamp_data END,
    logo_position = coalesce(nullif(p->>'logo_position', ''), 'left'), brand_name = nullif(trim(p->>'brand_name'), ''),
    brand_color = coalesce(nullif(p->>'brand_color', ''), '#1e3a8a'), header_text = nullif(trim(p->>'header_text'), ''),
    footer_text = nullif(trim(p->>'footer_text'), ''), payment_instructions = nullif(trim(p->>'payment_instructions'), ''),
    bank_details = nullif(trim(p->>'bank_details'), ''), terms = nullif(trim(p->>'terms'), ''), online_pay_url = nullif(trim(p->>'online_pay_url'), ''),
    template_key = coalesce(nullif(p->>'template_key', ''), 'classic'), paper = coalesce(nullif(p->>'paper', ''), 'A4'),
    default_terms_days = coalesce(nullif(p->>'default_terms_days', '')::int, 30),
    auto_reminders = coalesce((p->>'auto_reminders')::boolean, false),
    reminder_rules = CASE WHEN jsonb_typeof(p->'reminder_rules') = 'array' THEN p->'reminder_rules' ELSE reminder_rules END,
    reminder_gap_days = coalesce(nullif(p->>'reminder_gap_days', '')::int, 2), reminder_cc_me = coalesce((p->>'reminder_cc_me')::boolean, false),
    locale = coalesce(nullif(p->>'locale', ''), 'en'), setup_done = TRUE, updated_by = auth.uid(), updated_at = NOW()
  WHERE client_id = p_client;
END $$;
REVOKE ALL ON FUNCTION public.vi_save_settings(UUID, JSONB) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.vi_save_settings(UUID, JSONB) TO authenticated;

CREATE OR REPLACE FUNCTION public.vi_save_branch(p_client UUID, p JSONB) RETURNS UUID
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE bid UUID := nullif(p->>'id', '')::uuid; c TEXT := upper(trim(coalesce(p->>'code', '')));
BEGIN
  PERFORM public._vi_need(p_client, 'settings');
  IF c !~ '^[A-Z0-9]{1,15}$' THEN RAISE EXCEPTION 'Code: 1–15 letters or digits (no spaces or symbols).'; END IF;
  IF bid IS NULL THEN
    INSERT INTO public.vi_branches (client_id, code, name, kind, address, phone, is_default, active)
    VALUES (p_client, c, trim(p->>'name'), coalesce(nullif(p->>'kind', ''), 'branch'), nullif(trim(p->>'address'), ''), nullif(trim(p->>'phone'), ''),
            coalesce((p->>'is_default')::boolean, false), coalesce((p->>'active')::boolean, true))
    RETURNING id INTO bid;
  ELSE
    IF EXISTS (SELECT 1 FROM public.vi_branches WHERE id = bid AND client_id = p_client AND code <> c)
       AND EXISTS (SELECT 1 FROM public.vi_documents WHERE branch_id = bid AND status <> 'draft') THEN
      RAISE EXCEPTION 'This code is already on issued invoices — add a new code instead of changing it.';
    END IF;
    UPDATE public.vi_branches SET code = c, name = trim(p->>'name'), kind = coalesce(nullif(p->>'kind', ''), 'branch'),
      address = nullif(trim(p->>'address'), ''), phone = nullif(trim(p->>'phone'), ''),
      is_default = coalesce((p->>'is_default')::boolean, false), active = coalesce((p->>'active')::boolean, true)
    WHERE id = bid AND client_id = p_client;
    IF NOT FOUND THEN RAISE EXCEPTION 'Not found.'; END IF;
  END IF;
  IF coalesce((p->>'is_default')::boolean, false) THEN UPDATE public.vi_branches SET is_default = (id = bid) WHERE client_id = p_client; END IF;
  RETURN bid;
END $$;
REVOKE ALL ON FUNCTION public.vi_save_branch(UUID, JSONB) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.vi_save_branch(UUID, JSONB) TO authenticated;

-- Numbering: tax invoices always use the IRD format; the next number can only move forward
CREATE OR REPLACE FUNCTION public.vi_save_sequence(p_client UUID, p JSONB) RETURNS UUID
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE typ TEXT := p->>'doc_type'; c TEXT := upper(trim(coalesce(p->>'code', 'MAIN'))); fmt TEXT; nx BIGINT; used BIGINT; sid UUID; rs TEXT;
BEGIN
  PERFORM public._vi_need(p_client, 'settings');
  IF typ NOT IN ('tax', 'nontax', 'credit', 'debit', 'receipt') THEN RAISE EXCEPTION 'Unknown document type.'; END IF;
  IF c !~ '^[A-Z0-9]{1,15}$' THEN RAISE EXCEPTION 'Code: 1–15 letters or digits.'; END IF;
  fmt := CASE WHEN typ = 'tax' THEN '{YY}{MMM}_{CODE}_{N}' ELSE coalesce(nullif(trim(p->>'format'), ''), public._vi_default_format(typ)) END;
  IF fmt ~ '\s' OR position('{N}' IN fmt) = 0 OR length(fmt) > 60 THEN RAISE EXCEPTION 'Format needs {N} and no spaces.'; END IF;
  rs := coalesce(nullif(p->>'reset', ''), 'never');
  IF typ = 'tax' AND rs <> 'never' AND coalesce(trim(p->>'reset_reason'), '') = '' THEN
    RAISE EXCEPTION 'IRD: tax invoice numbers continue from the last invoice. Restart only for a reason beyond your control — write the reason.';
  END IF;
  SELECT max(seq_no) INTO used FROM public.vi_documents d JOIN public.vi_sequences q ON q.id = d.sequence_id
   WHERE q.client_id = p_client AND q.doc_type = typ AND q.code = c AND d.status <> 'draft';
  nx := greatest(coalesce(nullif(p->>'next_no', '')::bigint, 1), coalesce(used, 0) + 1);
  INSERT INTO public.vi_sequences (client_id, doc_type, code, format, next_no, pad, reset, reset_reason, active)
  VALUES (p_client, typ, c, fmt, nx, coalesce(nullif(p->>'pad', '')::int, 5), rs, nullif(trim(p->>'reset_reason'), ''), coalesce((p->>'active')::boolean, true))
  ON CONFLICT (client_id, doc_type, code) DO UPDATE SET format = EXCLUDED.format,
     next_no = EXCLUDED.next_no,   -- never below the last number used (nx above)
     pad = EXCLUDED.pad, reset = EXCLUDED.reset, reset_reason = EXCLUDED.reset_reason, active = EXCLUDED.active, updated_at = NOW()
  RETURNING id INTO sid;
  -- a format must still give a valid number
  IF typ = 'tax' AND NOT public._vi_tax_no_ok(public._vi_format_no(fmt, c, CURRENT_DATE, nx, coalesce(nullif(p->>'pad', '')::int, 5))) THEN
    RAISE EXCEPTION 'That code / number length makes the invoice number longer than 40 characters.';
  END IF;
  RETURN sid;
END $$;
REVOKE ALL ON FUNCTION public.vi_save_sequence(UUID, JSONB) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.vi_save_sequence(UUID, JSONB) TO authenticated;

CREATE OR REPLACE FUNCTION public.vi_save_customer(p_client UUID, p JSONB) RETURNS UUID
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE cid UUID := nullif(p->>'id', '')::uuid; t TEXT := nullif(regexp_replace(coalesce(p->>'tin', ''), '\D', '', 'g'), ''); lim INT := public._vi_limit('customers');
BEGIN
  PERFORM public._vi_need(p_client, 'customers');
  IF t IS NOT NULL AND t !~ '^[0-9]{9}$' THEN RAISE EXCEPTION 'TIN must be 9 digits.'; END IF;
  IF coalesce((p->>'vat_registered')::boolean, false) AND (t IS NULL OR coalesce(trim(p->>'address'), '') = '') THEN
    RAISE EXCEPTION 'A VAT-registered customer needs a TIN and address (they appear on the tax invoice).';
  END IF;
  IF cid IS NULL THEN
    IF lim > 0 AND (SELECT count(*) FROM public.vi_customers WHERE client_id = p_client) >= lim THEN RAISE EXCEPTION 'Your plan allows % customers.', lim; END IF;
    INSERT INTO public.vi_customers (client_id, kind, name, company_name, tin, vat_registered, vat_no, address, phone, email, contact_person,
                                     credit_limit, terms_days, opening_balance, opening_date, status, notes, created_by)
    VALUES (p_client, coalesce(nullif(p->>'kind', ''), 'business'), trim(p->>'name'), nullif(trim(p->>'company_name'), ''), t,
            coalesce((p->>'vat_registered')::boolean, false), nullif(trim(p->>'vat_no'), ''), nullif(trim(p->>'address'), ''),
            nullif(trim(p->>'phone'), ''), nullif(lower(trim(p->>'email')), ''), nullif(trim(p->>'contact_person'), ''),
            nullif(p->>'credit_limit', '')::numeric, nullif(p->>'terms_days', '')::int, coalesce(nullif(p->>'opening_balance', '')::numeric, 0),
            nullif(p->>'opening_date', '')::date, coalesce(nullif(p->>'status', ''), 'active'), nullif(trim(p->>'notes'), ''), auth.uid())
    RETURNING id INTO cid;
  ELSE
    UPDATE public.vi_customers SET kind = coalesce(nullif(p->>'kind', ''), 'business'), name = trim(p->>'name'), company_name = nullif(trim(p->>'company_name'), ''),
      tin = t, vat_registered = coalesce((p->>'vat_registered')::boolean, false), vat_no = nullif(trim(p->>'vat_no'), ''),
      address = nullif(trim(p->>'address'), ''), phone = nullif(trim(p->>'phone'), ''), email = nullif(lower(trim(p->>'email')), ''),
      contact_person = nullif(trim(p->>'contact_person'), ''), credit_limit = nullif(p->>'credit_limit', '')::numeric,
      terms_days = nullif(p->>'terms_days', '')::int, opening_balance = coalesce(nullif(p->>'opening_balance', '')::numeric, 0),
      opening_date = nullif(p->>'opening_date', '')::date, status = coalesce(nullif(p->>'status', ''), 'active'),
      notes = nullif(trim(p->>'notes'), ''), updated_at = NOW()
    WHERE id = cid AND client_id = p_client;
    IF NOT FOUND THEN RAISE EXCEPTION 'Customer not found.'; END IF;
  END IF;
  RETURN cid;
END $$;
REVOKE ALL ON FUNCTION public.vi_save_customer(UUID, JSONB) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.vi_save_customer(UUID, JSONB) TO authenticated;

CREATE OR REPLACE FUNCTION public.vi_save_item(p_client UUID, p JSONB) RETURNS UUID
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE iid UUID := nullif(p->>'id', '')::uuid; rc TEXT := coalesce(nullif(p->>'rate_code', ''), 'VAT_STD');
BEGIN
  PERFORM public._vi_need(p_client, 'customers');
  IF NOT EXISTS (SELECT 1 FROM public.vi_tax_rates WHERE code = rc) AND rc <> 'NONE' THEN RAISE EXCEPTION 'Unknown VAT code %.', rc; END IF;
  IF iid IS NULL THEN
    INSERT INTO public.vi_items (client_id, sku, name, description, supply_kind, unit, price, rate_code, category, active)
    VALUES (p_client, nullif(trim(p->>'sku'), ''), trim(p->>'name'), nullif(trim(p->>'description'), ''), coalesce(nullif(p->>'supply_kind', ''), 'goods'),
            coalesce(nullif(trim(p->>'unit'), ''), 'Nos'), coalesce(nullif(p->>'price', '')::numeric, 0), rc, nullif(trim(p->>'category'), ''),
            coalesce((p->>'active')::boolean, true))
    RETURNING id INTO iid;
  ELSE
    UPDATE public.vi_items SET sku = nullif(trim(p->>'sku'), ''), name = trim(p->>'name'), description = nullif(trim(p->>'description'), ''),
      supply_kind = coalesce(nullif(p->>'supply_kind', ''), 'goods'), unit = coalesce(nullif(trim(p->>'unit'), ''), 'Nos'),
      price = coalesce(nullif(p->>'price', '')::numeric, 0), rate_code = rc, category = nullif(trim(p->>'category'), ''),
      active = coalesce((p->>'active')::boolean, true), updated_at = NOW()
    WHERE id = iid AND client_id = p_client;
    IF NOT FOUND THEN RAISE EXCEPTION 'Item not found.'; END IF;
  END IF;
  RETURN iid;
END $$;
REVOKE ALL ON FUNCTION public.vi_save_item(UUID, JSONB) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.vi_save_item(UUID, JSONB) TO authenticated;

-- ═══ 17. Drafts, issue, cancel ════════════════════════════════════════════════
-- Save a draft (new or existing). p_doc: doc_type, branch_id, issue_date, supply_date, terms_days, due_date, place_of_supply,
-- payment_mode, customer_id, customer{…} (walk-in), original_id, reason_code, reason, price_mode, disc_pct, disc_amt, notes, terms, template_key.
-- p_lines: [{description, quantity, unit, unit_price, disc_pct, disc_amt, rate_code, supply_kind, item_id, original_line_id}]
CREATE OR REPLACE FUNCTION public.vi_save_draft(p_client UUID, p_doc JSONB, p_lines JSONB) RETURNS UUID
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE did UUID := nullif(p_doc->>'id', '')::uuid; d public.vi_documents; typ TEXT; o public.vi_documents; st public.vi_settings;
        cu public.vi_customers; ln JSONB; i INT := 0; perm TEXT; v_is_tax BOOLEAN; td INT; idate DATE; rc TEXT; cust JSONB;
BEGIN
  IF did IS NOT NULL THEN
    SELECT * INTO d FROM public.vi_documents WHERE id = did FOR UPDATE;
    IF d.id IS NULL OR d.client_id <> p_client THEN RAISE EXCEPTION 'Draft not found.'; END IF;
    IF d.status <> 'draft' THEN RAISE EXCEPTION 'This document is issued and cannot be edited. Create a Credit Note or Debit Note to correct it.'; END IF;
    typ := d.doc_type;
  ELSE
    typ := p_doc->>'doc_type';
  END IF;
  IF typ NOT IN ('tax', 'nontax', 'credit', 'debit') THEN RAISE EXCEPTION 'Unknown document type.'; END IF;
  perm := CASE typ WHEN 'credit' THEN 'credit_note' WHEN 'debit' THEN 'debit_note' ELSE CASE WHEN did IS NULL THEN 'create' ELSE 'edit_draft' END END;
  PERFORM public._vi_need(p_client, perm);
  SELECT * INTO st FROM public.vi_settings WHERE client_id = p_client;

  IF jsonb_typeof(p_lines) <> 'array' OR jsonb_array_length(p_lines) = 0 THEN RAISE EXCEPTION 'Add at least one line.'; END IF;
  IF jsonb_array_length(p_lines) > 300 THEN RAISE EXCEPTION 'Up to 300 lines per document.'; END IF;

  -- notes take customer + VAT nature from the original invoice
  IF typ IN ('credit', 'debit') THEN
    SELECT * INTO o FROM public.vi_documents WHERE id = coalesce(nullif(p_doc->>'original_id', '')::uuid, d.original_id);
    IF o.id IS NULL OR o.client_id <> p_client THEN RAISE EXCEPTION 'Choose the original invoice.'; END IF;
    IF o.doc_type NOT IN ('tax', 'nontax') THEN RAISE EXCEPTION 'A note is made against an invoice, not against another note.'; END IF;
    IF o.status <> 'issued' THEN RAISE EXCEPTION 'The original invoice must be issued (not draft or cancelled).'; END IF;
    v_is_tax := o.doc_type = 'tax';
  ELSE
    v_is_tax := typ = 'tax';
  END IF;

  IF nullif(p_doc->>'customer_id', '') IS NOT NULL THEN
    SELECT * INTO cu FROM public.vi_customers WHERE id = (p_doc->>'customer_id')::uuid AND client_id = p_client;
    IF cu.id IS NULL THEN RAISE EXCEPTION 'Customer not found.'; END IF;
  END IF;
  IF typ IN ('credit', 'debit') THEN
    cust := o.customer;
  ELSIF cu.id IS NOT NULL THEN
    cust := jsonb_build_object('name', cu.name, 'company_name', cu.company_name, 'tin', cu.tin, 'vat_registered', cu.vat_registered, 'vat_no', cu.vat_no,
                               'address', cu.address, 'phone', cu.phone, 'email', cu.email, 'contact_person', cu.contact_person);
  ELSE
    cust := jsonb_build_object('name', left(trim(coalesce(p_doc->'customer'->>'name', '')), 160),
                               'tin', nullif(regexp_replace(coalesce(p_doc->'customer'->>'tin', ''), '\D', '', 'g'), ''),
                               'vat_registered', coalesce((p_doc->'customer'->>'vat_registered')::boolean, false),
                               'address', left(nullif(trim(coalesce(p_doc->'customer'->>'address', '')), ''), 400),
                               'phone', left(nullif(trim(coalesce(p_doc->'customer'->>'phone', '')), ''), 40),
                               'email', left(nullif(lower(trim(coalesce(p_doc->'customer'->>'email', ''))), ''), 160));
  END IF;
  IF nullif(cust->>'tin', '') IS NOT NULL AND cust->>'tin' !~ '^[0-9]{9}$' THEN RAISE EXCEPTION 'Customer TIN must be 9 digits.'; END IF;

  idate := coalesce(nullif(p_doc->>'issue_date', '')::date, (now() AT TIME ZONE 'Asia/Colombo')::date);
  td := coalesce(nullif(p_doc->>'terms_days', '')::int, cu.terms_days, st.default_terms_days, 30);
  IF nullif(p_doc->>'branch_id', '') IS NOT NULL AND NOT EXISTS (SELECT 1 FROM public.vi_branches WHERE id = (p_doc->>'branch_id')::uuid AND client_id = p_client AND active) THEN
    RAISE EXCEPTION 'Unknown branch / code.';
  END IF;

  IF did IS NULL THEN
    INSERT INTO public.vi_documents (client_id, doc_type, is_tax, status, ramis_status, created_by, original_id)
    VALUES (p_client, typ, v_is_tax, 'draft', CASE WHEN v_is_tax THEN 'draft' ELSE 'na' END, auth.uid(), o.id)
    RETURNING id INTO did;
  END IF;
  UPDATE public.vi_documents SET
    is_tax = v_is_tax, original_id = CASE WHEN typ IN ('credit', 'debit') THEN o.id ELSE NULL END,
    branch_id = CASE WHEN typ IN ('credit', 'debit') AND nullif(p_doc->>'branch_id', '') IS NULL THEN o.branch_id ELSE nullif(p_doc->>'branch_id', '')::uuid END,
    issue_date = idate, supply_date = nullif(p_doc->>'supply_date', '')::date,
    terms_days = CASE WHEN typ IN ('tax', 'nontax') THEN td END,
    due_date = CASE WHEN typ IN ('tax', 'nontax') THEN coalesce(nullif(p_doc->>'due_date', '')::date, idate + td) END,
    place_of_supply = nullif(trim(p_doc->>'place_of_supply'), ''), payment_mode = nullif(trim(p_doc->>'payment_mode'), ''),
    customer_id = CASE WHEN typ IN ('credit', 'debit') THEN o.customer_id ELSE cu.id END, customer = cust,
    reason_code = nullif(p_doc->>'reason_code', ''), reason = nullif(trim(p_doc->>'reason'), ''),
    price_mode = CASE WHEN typ IN ('credit', 'debit') THEN o.price_mode ELSE coalesce(nullif(p_doc->>'price_mode', ''), st.price_mode, 'exclusive') END,
    disc_pct = coalesce(nullif(p_doc->>'disc_pct', '')::numeric, 0), disc_amt = coalesce(nullif(p_doc->>'disc_amt', '')::numeric, 0),
    currency = 'LKR', notes = nullif(trim(p_doc->>'notes'), ''), terms = nullif(trim(p_doc->>'terms'), ''),
    template_key = nullif(p_doc->>'template_key', ''), updated_at = NOW()
  WHERE id = did;

  DELETE FROM public.vi_document_lines WHERE doc_id = did;
  FOR ln IN SELECT * FROM jsonb_array_elements(p_lines) LOOP
    i := i + 1;
    rc := CASE WHEN v_is_tax THEN coalesce(nullif(ln->>'rate_code', ''), st.default_rate_code, 'VAT_STD') ELSE 'NONE' END;
    IF v_is_tax AND NOT EXISTS (SELECT 1 FROM public.vi_tax_rates WHERE code = rc) THEN RAISE EXCEPTION 'Line %: unknown VAT code %.', i, rc; END IF;
    IF nullif(ln->>'item_id', '') IS NOT NULL AND NOT EXISTS (SELECT 1 FROM public.vi_items WHERE id = (ln->>'item_id')::uuid AND client_id = p_client) THEN
      RAISE EXCEPTION 'Line %: item not found.', i;
    END IF;
    IF nullif(ln->>'original_line_id', '') IS NOT NULL AND NOT EXISTS (SELECT 1 FROM public.vi_document_lines WHERE id = (ln->>'original_line_id')::uuid AND doc_id = o.id) THEN
      RAISE EXCEPTION 'Line %: not a line of the original invoice.', i;
    END IF;
    IF coalesce(trim(ln->>'description'), '') = '' THEN RAISE EXCEPTION 'Line %: enter a description.', i; END IF;
    IF coalesce(nullif(ln->>'quantity', '')::numeric, 0) <= 0 THEN RAISE EXCEPTION 'Line %: quantity must be more than 0.', i; END IF;
    IF coalesce(nullif(ln->>'unit_price', '')::numeric, -1) < 0 THEN RAISE EXCEPTION 'Line %: enter the unit price.', i; END IF;
    INSERT INTO public.vi_document_lines (doc_id, client_id, sort, item_id, original_line_id, description, supply_kind, quantity, unit, unit_price,
                                          disc_pct, disc_amt, rate_code, treatment)
    VALUES (did, p_client, i, nullif(ln->>'item_id', '')::uuid, nullif(ln->>'original_line_id', '')::uuid, left(trim(ln->>'description'), 500),
            coalesce(nullif(ln->>'supply_kind', ''), 'goods'), (ln->>'quantity')::numeric, coalesce(nullif(trim(ln->>'unit'), ''), 'Nos'),
            (ln->>'unit_price')::numeric, coalesce(nullif(ln->>'disc_pct', '')::numeric, 0), coalesce(nullif(ln->>'disc_amt', '')::numeric, 0),
            rc, CASE WHEN v_is_tax THEN 'standard' ELSE 'none' END);
  END LOOP;
  PERFORM public._vi_calc_doc(did);
  RETURN did;
END $$;
REVOKE ALL ON FUNCTION public.vi_save_draft(UUID, JSONB, JSONB) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.vi_save_draft(UUID, JSONB, JSONB) TO authenticated;

CREATE OR REPLACE FUNCTION public.vi_delete_draft(p_doc UUID) RETURNS VOID
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE d public.vi_documents;
BEGIN
  SELECT * INTO d FROM public.vi_documents WHERE id = p_doc;
  IF d.id IS NULL THEN RAISE EXCEPTION 'Not found.'; END IF;
  PERFORM public._vi_need(d.client_id, 'edit_draft');
  IF d.status <> 'draft' THEN RAISE EXCEPTION 'Issued documents cannot be deleted. Create a Credit Note or Debit Note to correct it.'; END IF;
  DELETE FROM public.vi_documents WHERE id = p_doc;
END $$;
REVOKE ALL ON FUNCTION public.vi_delete_draft(UUID) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.vi_delete_draft(UUID) TO authenticated;

CREATE OR REPLACE FUNCTION public._vi_notify(p_client UUID, p_title TEXT, p_body TEXT, p_link TEXT DEFAULT '/client/vat') RETURNS VOID
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  PERFORM public._notify_client(p_client, 'vat', p_title, p_body, CASE WHEN p_link ~ '^/client(/|$)' THEN p_link ELSE '/client/vat' END);
EXCEPTION WHEN others THEN NULL;   -- a notice must never stop an invoice
END $$;
REVOKE ALL ON FUNCTION public._vi_notify(UUID, TEXT, TEXT, TEXT) FROM PUBLIC, anon, authenticated;

-- Issue: validate → take the number → freeze supplier & customer → lock as issued
CREATE OR REPLACE FUNCTION public.vi_issue(p_doc UUID) RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE d public.vi_documents; st public.vi_settings; b public.vi_branches; v JSONB; num RECORD; lim INT := public._vi_limit('invoices_per_month');
        cnt INT; rc public.vi_ramis_config; errs TEXT; v_code TEXT; who TEXT; cust JSONB; buyer UUID; sch TEXT;
BEGIN
  SELECT * INTO d FROM public.vi_documents WHERE id = p_doc FOR UPDATE;
  IF d.id IS NULL THEN RAISE EXCEPTION 'Not found.'; END IF;
  PERFORM public._vi_need(d.client_id, CASE d.doc_type WHEN 'credit' THEN 'credit_note' WHEN 'debit' THEN 'debit_note' ELSE 'issue' END);
  IF d.status <> 'draft' THEN RAISE EXCEPTION 'Already issued.'; END IF;
  IF d.doc_type IN ('tax', 'nontax') AND lim > 0 AND public._vi_role(d.client_id) <> 'taxmate' THEN
    SELECT count(*) INTO cnt FROM public.vi_documents WHERE client_id = d.client_id AND status <> 'draft' AND doc_type IN ('tax', 'nontax')
      AND issue_date >= date_trunc('month', d.issue_date)::date AND issue_date < (date_trunc('month', d.issue_date) + INTERVAL '1 month')::date;
    IF cnt >= lim THEN RAISE EXCEPTION 'Your plan allows % invoices a month.', lim; END IF;
  END IF;
  -- refresh the customer snapshot from the customer record (notes keep the original's)
  IF d.doc_type IN ('tax', 'nontax') AND d.customer_id IS NOT NULL THEN
    SELECT jsonb_build_object('name', c.name, 'company_name', c.company_name, 'tin', c.tin, 'vat_registered', c.vat_registered, 'vat_no', c.vat_no,
                              'address', c.address, 'phone', c.phone, 'email', c.email, 'contact_person', c.contact_person)
      INTO cust FROM public.vi_customers c WHERE c.id = d.customer_id;
    UPDATE public.vi_documents SET customer = cust WHERE id = p_doc;
  END IF;
  PERFORM public._vi_calc_doc(p_doc);
  v := public._vi_validate(p_doc, false);
  IF NOT (v->>'ok')::boolean THEN
    SELECT string_agg('• ' || (e->>'label') || ': ' || (e->>'msg'), E'\n') INTO errs FROM jsonb_array_elements(v->'checks') e
     WHERE NOT (e->>'ok')::boolean AND e->>'level' = 'error';
    RAISE EXCEPTION E'Please fix before issuing:\n%', errs;
  END IF;
  SELECT * INTO d FROM public.vi_documents WHERE id = p_doc;
  SELECT * INTO st FROM public.vi_settings WHERE client_id = d.client_id;
  SELECT * INTO b FROM public.vi_branches WHERE id = d.branch_id;
  v_code := coalesce(b.code, 'MAIN');
  SELECT * INTO num FROM public._vi_take_no(d.client_id, d.doc_type, v_code, d.issue_date);
  SELECT * INTO rc FROM public.vi_ramis_config WHERE client_id = d.client_id;
  UPDATE public.vi_documents SET
    status = 'issued', doc_no = num.doc_no, sequence_id = num.seq_id, seq_no = num.seq_no,
    supplier = jsonb_build_object('legal_name', st.legal_name, 'trading_name', st.trading_name, 'brand_name', st.brand_name, 'tin', st.tin,
      'vat_no', st.vat_no, 'brn', st.brn, 'address', coalesce(b.address, st.address), 'registered_address', st.address,
      'branch', CASE WHEN b.id IS NOT NULL THEN b.name END, 'branch_code', v_code,
      'phone', coalesce(b.phone, st.phone), 'mobile', st.mobile, 'email', st.email, 'website', st.website),
    compliance = CASE WHEN d.is_tax THEN (SELECT value->>'invoice_spec' FROM public.app_settings WHERE key = 'vi_compliance') END,
    template_key = coalesce(d.template_key, st.template_key, 'classic'),
    terms = coalesce(d.terms, CASE WHEN d.doc_type IN ('tax', 'nontax') THEN st.terms END),
    ramis_status = CASE WHEN d.is_tax THEN CASE WHEN coalesce(rc.enabled, false) THEN 'ready' ELSE 'draft' END ELSE 'na' END,
    pay_status = CASE WHEN d.doc_type IN ('credit', 'debit') THEN 'na' ELSE 'unpaid' END,
    balance = CASE WHEN d.doc_type IN ('credit', 'debit') THEN 0 ELSE d.total END,
    issued_at = NOW(), issued_by = auth.uid(), updated_at = NOW()
  WHERE id = p_doc;
  PERFORM public._vi_refresh_doc(p_doc);
  IF d.original_id IS NOT NULL THEN PERFORM public._vi_refresh_doc(d.original_id); END IF;

  -- Purchaser inbox: when the buyer is also a TaxMate VAT client (same TIN), their Schedule 02 / 04 record appears for review
  IF d.is_tax AND coalesce(d.customer->>'tin', '') ~ '^[0-9]{9}$' THEN
    SELECT s2.client_id INTO buyer FROM public.vi_settings s2 WHERE s2.tin = d.customer->>'tin' AND s2.client_id <> d.client_id LIMIT 1;
    IF buyer IS NOT NULL THEN
      sch := CASE WHEN d.doc_type IN ('credit', 'debit') THEN 'in:note' ELSE 'in:local' END;
      INSERT INTO public.vi_purchases (client_id, source, doc_kind, schedule_key, supplier_name, supplier_tin, supplier_address, invoice_no, original_no,
                                       invoice_date, supply_date, description, taxable, vat, total, linked_doc_id, ramis_status)
      VALUES (buyer, 'taxmate', CASE d.doc_type WHEN 'credit' THEN 'credit' WHEN 'debit' THEN 'debit' ELSE 'invoice' END, sch,
              coalesce(st.legal_name, '—'), st.tin, st.address, num.doc_no,
              (SELECT doc_no FROM public.vi_documents WHERE id = d.original_id), d.issue_date, d.supply_date,
              left((SELECT string_agg(description, '; ' ORDER BY sort) FROM public.vi_document_lines WHERE doc_id = p_doc), 500),
              d.net_total, d.vat_total, d.total, p_doc, 'na')
      ON CONFLICT DO NOTHING;
      PERFORM public._vi_notify(buyer, 'New purchase invoice to review', coalesce(st.legal_name, 'A supplier') || ' issued ' || num.doc_no || ' — ' || _rs(d.total) || '. Review it in Purchaser VAT inbox.', '/client/vat?v=purchases');
    END IF;
  END IF;

  who := public._vi_role(d.client_id);
  IF who NOT IN ('owner') THEN
    PERFORM public._vi_notify(d.client_id,
      CASE d.doc_type WHEN 'tax' THEN 'Tax invoice ' WHEN 'nontax' THEN 'Invoice ' WHEN 'credit' THEN 'Credit note ' ELSE 'Debit note ' END || num.doc_no || ' issued',
      coalesce(d.customer->>'name', '') || ' — ' || _rs(d.total) || CASE WHEN who = 'taxmate' THEN ' (by TaxMate)' ELSE '' END, '/client/vat?doc=' || p_doc);
  END IF;
  -- automatic RAMIS submission
  IF d.is_tax AND coalesce(rc.enabled, false) AND coalesce(rc.auto_submit, false) AND public._vi_can(d.client_id, 'submit_ramis') THEN
    BEGIN
      PERFORM public.vi_submit_ramis(p_doc);
    EXCEPTION WHEN others THEN
      UPDATE public.vi_documents SET ramis_message = left('Not sent to RAMIS: ' || SQLERRM, 500) WHERE id = p_doc;
    END;
  END IF;
  RETURN jsonb_build_object('id', p_doc, 'doc_no', num.doc_no, 'warnings',
    (SELECT coalesce(jsonb_agg(e), '[]'::jsonb) FROM jsonb_array_elements(v->'checks') e WHERE NOT (e->>'ok')::boolean AND e->>'level' = 'warning'));
END $$;
REVOKE ALL ON FUNCTION public.vi_issue(UUID) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.vi_issue(UUID) TO authenticated;

-- Cancel (void) an issued document — only when nothing depends on it and it never went to RAMIS. The record stays.
CREATE OR REPLACE FUNCTION public.vi_cancel(p_doc UUID, p_reason TEXT) RETURNS VOID
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE d public.vi_documents;
BEGIN
  SELECT * INTO d FROM public.vi_documents WHERE id = p_doc FOR UPDATE;
  IF d.id IS NULL THEN RAISE EXCEPTION 'Not found.'; END IF;
  PERFORM public._vi_need(d.client_id, 'cancel');
  IF d.status <> 'issued' THEN RAISE EXCEPTION 'Only issued documents can be cancelled (delete a draft instead).'; END IF;
  IF coalesce(trim(p_reason), '') = '' THEN RAISE EXCEPTION 'Give the reason for cancelling.'; END IF;
  IF d.ramis_status IN ('queued', 'submitting', 'submitted', 'accepted', 'locked') THEN
    RAISE EXCEPTION 'This invoice has already been submitted to RAMIS and cannot be edited or deleted. Create a Credit Note or Debit Note to correct the transaction.';
  END IF;
  IF EXISTS (SELECT 1 FROM public.vi_payment_allocations a JOIN public.vi_payments p ON p.id = a.payment_id WHERE a.doc_id = p_doc AND p.voided_at IS NULL) THEN
    RAISE EXCEPTION 'This invoice has payments. Void the payments first, or create a Credit Note.';
  END IF;
  IF EXISTS (SELECT 1 FROM public.vi_documents WHERE original_id = p_doc AND status = 'issued') THEN
    RAISE EXCEPTION 'Credit / debit notes are linked to this invoice — it cannot be cancelled.';
  END IF;
  UPDATE public.vi_documents SET status = 'cancelled', pay_status = CASE WHEN doc_type IN ('credit', 'debit') THEN 'na' ELSE 'cancelled' END,
         balance = 0, cancelled_at = NOW(), cancelled_by = auth.uid(), cancel_reason = left(trim(p_reason), 500),
         ramis_status = CASE WHEN is_tax THEN ramis_status ELSE 'na' END, updated_at = NOW()
   WHERE id = p_doc;
  IF d.original_id IS NOT NULL THEN PERFORM public._vi_refresh_doc(d.original_id); END IF;
  UPDATE public.vi_purchases SET review_note = left('Supplier cancelled this document: ' || trim(p_reason), 500),
         approval = CASE WHEN approval IN ('approved', 'matched') THEN 'disputed' ELSE approval END, updated_at = NOW()
   WHERE linked_doc_id = p_doc;
END $$;
REVOKE ALL ON FUNCTION public.vi_cancel(UUID, TEXT) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.vi_cancel(UUID, TEXT) TO authenticated;

-- Copy a document into a new draft (also used for "corrected draft" after a RAMIS rejection)
CREATE OR REPLACE FUNCTION public.vi_copy(p_doc UUID, p_as_type TEXT DEFAULT NULL) RETURNS UUID
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE d public.vi_documents; typ TEXT; lines JSONB; nid UUID;
BEGIN
  SELECT * INTO d FROM public.vi_documents WHERE id = p_doc;
  IF d.id IS NULL THEN RAISE EXCEPTION 'Not found.'; END IF;
  typ := coalesce(p_as_type, d.doc_type);
  IF typ NOT IN ('tax', 'nontax') OR d.doc_type NOT IN ('tax', 'nontax') THEN RAISE EXCEPTION 'Only invoices can be copied.'; END IF;
  SELECT jsonb_agg(jsonb_build_object('description', description, 'quantity', quantity, 'unit', unit, 'unit_price', unit_price, 'disc_pct', disc_pct,
                   'disc_amt', disc_amt, 'rate_code', CASE WHEN rate_code = 'NONE' THEN NULL ELSE rate_code END, 'supply_kind', supply_kind, 'item_id', item_id) ORDER BY sort)
    INTO lines FROM public.vi_document_lines WHERE doc_id = p_doc;
  nid := public.vi_save_draft(d.client_id, jsonb_build_object('doc_type', typ, 'branch_id', d.branch_id, 'issue_date', (now() AT TIME ZONE 'Asia/Colombo')::date,
           'supply_date', d.supply_date, 'terms_days', d.terms_days, 'place_of_supply', d.place_of_supply, 'payment_mode', d.payment_mode,
           'customer_id', d.customer_id, 'customer', d.customer, 'price_mode', d.price_mode, 'disc_pct', d.disc_pct, 'disc_amt', d.disc_amt,
           'notes', d.notes, 'template_key', d.template_key), lines);
  RETURN nid;
END $$;
REVOKE ALL ON FUNCTION public.vi_copy(UUID, TEXT) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.vi_copy(UUID, TEXT) TO authenticated;

-- RAMIS rejected the invoice → cancel it (never accepted by IRD) and open a corrected draft
CREATE OR REPLACE FUNCTION public.vi_correct_rejected(p_doc UUID) RETURNS UUID
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE d public.vi_documents; nid UUID;
BEGIN
  SELECT * INTO d FROM public.vi_documents WHERE id = p_doc FOR UPDATE;
  IF d.id IS NULL THEN RAISE EXCEPTION 'Not found.'; END IF;
  PERFORM public._vi_need(d.client_id, 'cancel');
  IF d.ramis_status <> 'rejected' THEN RAISE EXCEPTION 'Only an invoice rejected by RAMIS is replaced this way.'; END IF;
  IF d.doc_type NOT IN ('tax') THEN RAISE EXCEPTION 'For a rejected credit / debit note, create a new note.'; END IF;
  nid := public.vi_copy(p_doc, 'tax');
  PERFORM public.vi_cancel(p_doc, 'Rejected by RAMIS (' || coalesce(d.ramis_message, 'see submission') || ') — replaced by a corrected draft');
  UPDATE public.vi_documents SET replaced_by = nid WHERE id = p_doc;
  RETURN nid;
END $$;
REVOKE ALL ON FUNCTION public.vi_correct_rejected(UUID) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.vi_correct_rejected(UUID) TO authenticated;

-- ═══ 18. Payments & customer ledger ══════════════════════════════════════════
-- p: customer_id, amount, paid_on, method, reference, bank, notes, attachment_path, doc_id (pay one invoice)
-- p_allocs: [{doc_id, amount}] — empty: the whole amount goes to doc_id, or else to the customer's oldest open invoices
CREATE OR REPLACE FUNCTION public.vi_record_payment(p_client UUID, p JSONB, p_allocs JSONB DEFAULT '[]'::jsonb) RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE amt NUMERIC := round(coalesce(nullif(p->>'amount', '')::numeric, 0), 2); pid UUID; cu UUID := nullif(p->>'customer_id', '')::uuid;
        one UUID := nullif(p->>'doc_id', '')::uuid; d public.vi_documents; a JSONB; left_amt NUMERIC; take NUMERIC; rno RECORD; docs UUID[] := '{}'; r RECORD;
        dt DATE := coalesce(nullif(p->>'paid_on', '')::date, (now() AT TIME ZONE 'Asia/Colombo')::date); who TEXT;
BEGIN
  PERFORM public._vi_need(p_client, 'payment');
  IF amt <= 0 THEN RAISE EXCEPTION 'Enter the amount received.'; END IF;
  IF coalesce(p->>'method', '') NOT IN ('cash', 'bank_transfer', 'cheque', 'card', 'mobile', 'online', 'other') THEN RAISE EXCEPTION 'Choose how it was paid.'; END IF;
  IF dt > (now() AT TIME ZONE 'Asia/Colombo')::date + 1 THEN RAISE EXCEPTION 'The payment date cannot be in the future.'; END IF;
  IF one IS NOT NULL THEN
    SELECT * INTO d FROM public.vi_documents WHERE id = one AND client_id = p_client;
    IF d.id IS NULL OR d.status <> 'issued' OR d.doc_type NOT IN ('tax', 'nontax') THEN RAISE EXCEPTION 'Payments go against an issued invoice.'; END IF;
    cu := coalesce(cu, d.customer_id);
  END IF;
  IF cu IS NOT NULL AND NOT EXISTS (SELECT 1 FROM public.vi_customers WHERE id = cu AND client_id = p_client) THEN RAISE EXCEPTION 'Customer not found.'; END IF;
  IF p->>'attachment_path' IS NOT NULL AND p->>'attachment_path' !~ ('^' || p_client::text || '/payments/') THEN RAISE EXCEPTION 'Wrong attachment.'; END IF;
  SELECT * INTO rno FROM public._vi_take_no(p_client, 'receipt', 'MAIN', dt);
  INSERT INTO public.vi_payments (client_id, customer_id, receipt_no, amount, paid_on, method, reference, bank, notes, attachment_path, source, recorded_by)
  VALUES (p_client, cu, rno.doc_no, amt, dt, p->>'method', nullif(trim(p->>'reference'), ''), nullif(trim(p->>'bank'), ''), nullif(trim(p->>'notes'), ''),
          nullif(p->>'attachment_path', ''), 'manual', auth.uid())
  RETURNING id INTO pid;
  left_amt := amt;
  IF jsonb_typeof(p_allocs) = 'array' AND jsonb_array_length(p_allocs) > 0 THEN
    FOR a IN SELECT * FROM jsonb_array_elements(p_allocs) LOOP
      take := round(coalesce(nullif(a->>'amount', '')::numeric, 0), 2);
      CONTINUE WHEN take <= 0;
      SELECT * INTO d FROM public.vi_documents WHERE id = (a->>'doc_id')::uuid AND client_id = p_client;
      IF d.id IS NULL OR d.status <> 'issued' OR d.doc_type NOT IN ('tax', 'nontax') THEN RAISE EXCEPTION 'Payments go against issued invoices.'; END IF;
      IF cu IS NOT NULL AND d.customer_id IS DISTINCT FROM cu THEN RAISE EXCEPTION 'Invoice % belongs to another customer.', d.doc_no; END IF;
      IF take > left_amt THEN RAISE EXCEPTION 'The amounts given to invoices are more than the payment.'; END IF;
      INSERT INTO public.vi_payment_allocations (payment_id, client_id, doc_id, amount) VALUES (pid, p_client, d.id, take);
      left_amt := left_amt - take; docs := array_append(docs, d.id);
    END LOOP;
  ELSIF one IS NOT NULL THEN
    INSERT INTO public.vi_payment_allocations (payment_id, client_id, doc_id, amount) VALUES (pid, p_client, one, amt);
    left_amt := 0; docs := array_append(docs, one);
  ELSIF cu IS NOT NULL THEN
    FOR r IN SELECT id, balance FROM public.vi_documents WHERE client_id = p_client AND customer_id = cu AND status = 'issued'
               AND doc_type IN ('tax', 'nontax') AND balance > 0 ORDER BY coalesce(due_date, issue_date), issue_date, seq_no LOOP
      EXIT WHEN left_amt <= 0;
      take := least(left_amt, r.balance);
      INSERT INTO public.vi_payment_allocations (payment_id, client_id, doc_id, amount) VALUES (pid, p_client, r.id, take);
      left_amt := left_amt - take; docs := array_append(docs, r.id);
    END LOOP;
  END IF;
  FOR r IN SELECT DISTINCT unnest(docs) AS id LOOP PERFORM public._vi_refresh_doc(r.id); END LOOP;
  who := public._vi_role(p_client);
  IF who <> 'owner' THEN
    PERFORM public._vi_notify(p_client, 'Payment received — ' || _rs(amt), coalesce((SELECT name FROM public.vi_customers WHERE id = cu), 'Customer') ||
            ' · receipt ' || rno.doc_no || CASE WHEN who = 'taxmate' THEN ' (recorded by TaxMate)' ELSE '' END, '/client/vat?v=payments');
  END IF;
  RETURN jsonb_build_object('id', pid, 'receipt_no', rno.doc_no, 'unallocated', left_amt);
END $$;
REVOKE ALL ON FUNCTION public.vi_record_payment(UUID, JSONB, JSONB) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.vi_record_payment(UUID, JSONB, JSONB) TO authenticated;

CREATE OR REPLACE FUNCTION public.vi_void_payment(p_id UUID, p_reason TEXT) RETURNS VOID
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE pm public.vi_payments; r RECORD;
BEGIN
  SELECT * INTO pm FROM public.vi_payments WHERE id = p_id FOR UPDATE;
  IF pm.id IS NULL THEN RAISE EXCEPTION 'Not found.'; END IF;
  PERFORM public._vi_need(pm.client_id, 'payment');
  IF public._vi_role(pm.client_id) = 'invoice_operator' THEN RAISE EXCEPTION 'Ask the owner or accountant to void a payment.'; END IF;
  IF coalesce(trim(p_reason), '') = '' THEN RAISE EXCEPTION 'Give the reason.'; END IF;
  UPDATE public.vi_payments SET voided_at = NOW(), voided_by = auth.uid(), void_reason = left(trim(p_reason), 300) WHERE id = p_id;
  FOR r IN SELECT DISTINCT doc_id FROM public.vi_payment_allocations WHERE payment_id = p_id LOOP PERFORM public._vi_refresh_doc(r.doc_id); END LOOP;
END $$;
REVOKE ALL ON FUNCTION public.vi_void_payment(UUID, TEXT) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.vi_void_payment(UUID, TEXT) TO authenticated;

-- Customer statement: opening + invoices + debit notes − credit notes − payments = outstanding
CREATE OR REPLACE FUNCTION public.vi_customer_ledger(p_client UUID, p_customer UUID, p_from DATE DEFAULT NULL, p_to DATE DEFAULT NULL) RETURNS JSONB
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE cu public.vi_customers; f DATE; t DATE := coalesce(p_to, (now() AT TIME ZONE 'Asia/Colombo')::date); opening NUMERIC; rows JSONB; aging JSONB;
BEGIN
  PERFORM public._vi_need(p_client, 'view');
  SELECT * INTO cu FROM public.vi_customers WHERE id = p_customer AND client_id = p_client;
  IF cu.id IS NULL THEN RAISE EXCEPTION 'Customer not found.'; END IF;
  f := coalesce(p_from, DATE '1900-01-01');
  WITH tx AS (
    SELECT d.issue_date AS dt, d.issued_at AS at, d.id AS ref_id, d.doc_type AS kind, d.doc_no AS no,
           CASE WHEN d.doc_type = 'credit' THEN -d.total ELSE d.total END AS amount,
           CASE d.doc_type WHEN 'tax' THEN 'Tax invoice' WHEN 'nontax' THEN 'Invoice' WHEN 'credit' THEN 'Credit note' ELSE 'Debit note' END
             || CASE WHEN d.original_id IS NOT NULL THEN ' (against ' || (SELECT o.doc_no FROM public.vi_documents o WHERE o.id = d.original_id) || ')' ELSE '' END AS label,
           d.due_date AS due
      FROM public.vi_documents d WHERE d.client_id = p_client AND d.customer_id = p_customer AND d.status = 'issued'
    UNION ALL
    SELECT pm.paid_on, pm.created_at, pm.id, 'payment', pm.receipt_no, -pm.amount,
           'Payment — ' || replace(pm.method, '_', ' ') || coalesce(' · ' || pm.reference, ''), NULL
      FROM public.vi_payments pm WHERE pm.client_id = p_client AND pm.customer_id = p_customer AND pm.voided_at IS NULL)
  SELECT cu.opening_balance + coalesce((SELECT sum(amount) FROM tx WHERE dt < f), 0),
         coalesce((SELECT jsonb_agg(jsonb_build_object('date', dt, 'kind', kind, 'no', no, 'label', label, 'amount', amount, 'due', due, 'id', ref_id) ORDER BY dt, at)
                   FROM tx WHERE dt >= f AND dt <= t), '[]'::jsonb)
    INTO opening, rows;
  SELECT jsonb_build_object(
    'current', coalesce(sum(balance) FILTER (WHERE coalesce(due_date, issue_date) >= t), 0),
    'd1_30',   coalesce(sum(balance) FILTER (WHERE t - coalesce(due_date, issue_date) BETWEEN 1 AND 30), 0),
    'd31_60',  coalesce(sum(balance) FILTER (WHERE t - coalesce(due_date, issue_date) BETWEEN 31 AND 60), 0),
    'd61_90',  coalesce(sum(balance) FILTER (WHERE t - coalesce(due_date, issue_date) BETWEEN 61 AND 90), 0),
    'd91_120', coalesce(sum(balance) FILTER (WHERE t - coalesce(due_date, issue_date) BETWEEN 91 AND 120), 0),
    'd120',    coalesce(sum(balance) FILTER (WHERE t - coalesce(due_date, issue_date) > 120), 0))
    INTO aging FROM public.vi_documents WHERE client_id = p_client AND customer_id = p_customer AND status = 'issued' AND doc_type IN ('tax', 'nontax') AND balance > 0;
  RETURN jsonb_build_object('customer', to_jsonb(cu), 'from', p_from, 'to', t, 'opening', opening, 'rows', rows,
    'closing', opening + coalesce((SELECT sum((x->>'amount')::numeric) FROM jsonb_array_elements(rows) x), 0),
    'unallocated', coalesce((SELECT sum(pm.amount - coalesce((SELECT sum(a.amount) FROM public.vi_payment_allocations a WHERE a.payment_id = pm.id), 0))
                             FROM public.vi_payments pm WHERE pm.client_id = p_client AND pm.customer_id = p_customer AND pm.voided_at IS NULL), 0),
    'aging', aging);
END $$;
REVOKE ALL ON FUNCTION public.vi_customer_ledger(UUID, UUID, DATE, DATE) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.vi_customer_ledger(UUID, UUID, DATE, DATE) TO authenticated;

-- ═══ 19. Secure share links & the customer page ═══════════════════════════════
CREATE OR REPLACE FUNCTION public.vi_share(p_doc UUID, p_days INT DEFAULT NULL) RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE d public.vi_documents; days INT; tok UUID;
BEGIN
  SELECT * INTO d FROM public.vi_documents WHERE id = p_doc FOR UPDATE;
  IF d.id IS NULL THEN RAISE EXCEPTION 'Not found.'; END IF;
  IF NOT (public._vi_can(d.client_id, 'reminder') OR public._vi_can(d.client_id, 'issue')) THEN PERFORM public._vi_need(d.client_id, 'reminder'); END IF;
  IF d.status = 'draft' THEN RAISE EXCEPTION 'Issue the document before sharing it.'; END IF;
  days := least(365, greatest(1, coalesce(p_days, nullif((SELECT value->>'share_days' FROM public.app_settings WHERE key = 'vi_policy'), '')::int, 90)));
  tok := CASE WHEN d.share_token IS NOT NULL AND d.share_expires_at > NOW() THEN d.share_token ELSE gen_random_uuid() END;
  UPDATE public.vi_documents SET share_token = tok, share_expires_at = greatest(coalesce(share_expires_at, NOW()), NOW() + make_interval(days => days)) WHERE id = p_doc;
  RETURN jsonb_build_object('token', tok, 'expires_at', (SELECT share_expires_at FROM public.vi_documents WHERE id = p_doc));
END $$;
REVOKE ALL ON FUNCTION public.vi_share(UUID, INT) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.vi_share(UUID, INT) TO authenticated;

CREATE OR REPLACE FUNCTION public.vi_share_off(p_doc UUID) RETURNS VOID
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE cid UUID;
BEGIN
  SELECT client_id INTO cid FROM public.vi_documents WHERE id = p_doc;
  IF cid IS NULL THEN RAISE EXCEPTION 'Not found.'; END IF;
  PERFORM public._vi_need(cid, 'reminder');
  UPDATE public.vi_documents SET share_token = NULL, share_expires_at = NULL WHERE id = p_doc;
END $$;
REVOKE ALL ON FUNCTION public.vi_share_off(UUID) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.vi_share_off(UUID) TO authenticated;

-- Everything needed to print a document (no internal ids / notes of the business)
CREATE OR REPLACE FUNCTION public._vi_doc_json(p_doc UUID) RETURNS JSONB
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT jsonb_build_object(
    'doc', jsonb_build_object('doc_type', d.doc_type, 'is_tax', d.is_tax, 'status', d.status, 'doc_no', d.doc_no, 'issue_date', d.issue_date,
        'supply_date', d.supply_date, 'due_date', d.due_date, 'terms_days', d.terms_days, 'place_of_supply', d.place_of_supply, 'payment_mode', d.payment_mode,
        'customer', d.customer, 'supplier', d.supplier, 'reason_code', d.reason_code, 'reason', d.reason, 'price_mode', d.price_mode,
        'gross', d.gross, 'discount_total', d.discount_total, 'taxable_standard', d.taxable_standard, 'taxable_zero', d.taxable_zero,
        'exempt_amount', d.exempt_amount, 'net_total', d.net_total, 'vat_total', d.vat_total, 'total', d.total,
        'credited', d.credited, 'debited', d.debited, 'paid', d.paid, 'balance', d.balance, 'pay_status', d.pay_status,
        'ramis_status', d.ramis_status, 'ramis_ref', d.ramis_ref, 'locked_at', d.locked_at, 'compliance', d.compliance, 'rules_version', d.rules_version,
        'calc_method', d.calc_method, 'terms', d.terms, 'notes', d.notes, 'template_key', d.template_key, 'currency', d.currency,
        'cancelled_at', d.cancelled_at, 'cancel_reason', d.cancel_reason, 'issued_at', d.issued_at),
    'lines', coalesce((SELECT jsonb_agg(jsonb_build_object('description', l.description, 'supply_kind', l.supply_kind, 'quantity', l.quantity, 'unit', l.unit,
        'unit_price', l.unit_price, 'disc_pct', l.disc_pct, 'discount', l.discount, 'gross', l.gross, 'treatment', l.treatment, 'rate', l.rate,
        'net', l.net, 'vat', l.vat, 'total', l.total, 'schedule', l.schedule) ORDER BY l.sort) FROM public.vi_document_lines l WHERE l.doc_id = d.id), '[]'::jsonb),
    'original', (SELECT jsonb_build_object('doc_no', o.doc_no, 'issue_date', o.issue_date, 'total', o.total, 'vat_total', o.vat_total, 'doc_type', o.doc_type)
                   FROM public.vi_documents o WHERE o.id = d.original_id),
    'notes_against', coalesce((SELECT jsonb_agg(jsonb_build_object('doc_no', n.doc_no, 'doc_type', n.doc_type, 'issue_date', n.issue_date, 'total', n.total, 'vat_total', n.vat_total) ORDER BY n.issue_date)
                   FROM public.vi_documents n WHERE n.original_id = d.id AND n.status = 'issued'), '[]'::jsonb),
    'brand', (SELECT jsonb_build_object('logo', s.logo_data, 'stamp', s.stamp_data, 'logo_position', s.logo_position, 'brand_name', s.brand_name,
        'brand_color', s.brand_color, 'header_text', s.header_text, 'footer_text', s.footer_text, 'payment_instructions', s.payment_instructions,
        'bank_details', s.bank_details, 'online_pay_url', s.online_pay_url, 'template_key', s.template_key, 'paper', s.paper, 'locale', s.locale)
                FROM public.vi_settings s WHERE s.client_id = d.client_id))
  FROM public.vi_documents d WHERE d.id = p_doc;
$$;
REVOKE ALL ON FUNCTION public._vi_doc_json(UUID) FROM PUBLIC, anon, authenticated;

-- Customer page (no login): only with a valid, unexpired link
CREATE OR REPLACE FUNCTION public.vi_public_document(p_token UUID) RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE d public.vi_documents;
BEGIN
  IF p_token IS NULL THEN RETURN NULL; END IF;
  SELECT * INTO d FROM public.vi_documents WHERE share_token = p_token AND share_expires_at > NOW() AND status <> 'draft';
  IF d.id IS NULL THEN RETURN NULL; END IF;
  IF d.last_viewed_at IS NULL OR d.last_viewed_at < NOW() - INTERVAL '10 minutes' THEN
    PERFORM public._vi_log(d.client_id, d.id, 'vi_documents', d.id::text, 'viewed_by_customer', NULL, NULL, 'Opened the share link');
  END IF;
  UPDATE public.vi_documents SET share_views = share_views + 1, last_viewed_at = NOW() WHERE id = d.id;
  RETURN public._vi_doc_json(d.id) || jsonb_build_object('expires_at', d.share_expires_at);
END $$;
REVOKE ALL ON FUNCTION public.vi_public_document(UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.vi_public_document(UUID) TO anon, authenticated;

-- The document for printing / PDF / preview (read only — works in admin preview too)
CREATE OR REPLACE FUNCTION public.vi_document_json(p_doc UUID) RETURNS JSONB
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE cid UUID;
BEGIN
  SELECT client_id INTO cid FROM public.vi_documents WHERE id = p_doc;
  IF cid IS NULL THEN RAISE EXCEPTION 'Not found.'; END IF;
  PERFORM public._vi_need(cid, 'view');
  RETURN public._vi_doc_json(p_doc);
END $$;
REVOKE ALL ON FUNCTION public.vi_document_json(UUID) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.vi_document_json(UUID) TO authenticated;

-- Audit events from the app: downloaded / printed / shared
CREATE OR REPLACE FUNCTION public.vi_log_event(p_doc UUID, p_action TEXT, p_note TEXT DEFAULT NULL) RETURNS VOID
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE cid UUID;
BEGIN
  SELECT client_id INTO cid FROM public.vi_documents WHERE id = p_doc;
  IF cid IS NULL THEN RAISE EXCEPTION 'Not found.'; END IF;
  PERFORM public._vi_need(cid, 'view');
  IF p_action NOT IN ('downloaded', 'printed', 'sent_whatsapp', 'sent_email', 'copied_link', 'shared') THEN RAISE EXCEPTION 'Unknown event.'; END IF;
  PERFORM public._vi_log(cid, p_doc, 'vi_documents', p_doc::text, p_action, NULL, NULL, left(p_note, 300));
END $$;
REVOKE ALL ON FUNCTION public.vi_log_event(UUID, TEXT, TEXT) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.vi_log_event(UUID, TEXT, TEXT) TO authenticated;

-- ═══ 20. Reminders ═══════════════════════════════════════════════════════════
CREATE OR REPLACE FUNCTION public.vi_log_reminder(p_doc UUID, p_channel TEXT, p_recipient TEXT, p_message TEXT) RETURNS BIGINT
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE d public.vi_documents; rid BIGINT;
BEGIN
  SELECT * INTO d FROM public.vi_documents WHERE id = p_doc;
  IF d.id IS NULL THEN RAISE EXCEPTION 'Not found.'; END IF;
  PERFORM public._vi_need(d.client_id, 'reminder');
  IF p_channel NOT IN ('email', 'whatsapp', 'sms', 'copy') THEN RAISE EXCEPTION 'Unknown channel.'; END IF;
  IF d.status <> 'issued' THEN RAISE EXCEPTION 'Only issued documents.'; END IF;
  IF EXISTS (SELECT 1 FROM public.vi_reminders WHERE doc_id = p_doc AND channel = p_channel AND created_at > NOW() - INTERVAL '10 minutes') THEN
    RAISE EXCEPTION 'A reminder was just sent on this channel. Wait a little before sending again.';
  END IF;
  INSERT INTO public.vi_reminders (client_id, doc_id, channel, recipient, message, status, automatic, sent_by)
  VALUES (d.client_id, p_doc, p_channel, left(p_recipient, 160), left(p_message, 2000), 'opened', false, auth.uid()) RETURNING id INTO rid;
  UPDATE public.vi_documents SET reminder_count = reminder_count + 1, last_reminder_at = NOW() WHERE id = p_doc;
  RETURN rid;
END $$;
REVOKE ALL ON FUNCTION public.vi_log_reminder(UUID, TEXT, TEXT, TEXT) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.vi_log_reminder(UUID, TEXT, TEXT, TEXT) TO authenticated;

-- For the vatinvoice Edge Function: which documents get an automatic reminder today
CREATE OR REPLACE FUNCTION public._vi_due_reminders(p_limit INT DEFAULT 300) RETURNS JSONB
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  WITH today AS (SELECT (now() AT TIME ZONE 'Asia/Colombo')::date AS t),
  cand AS (
    SELECT d.id, d.client_id, d.doc_no, d.doc_type, d.due_date, d.balance, d.total, d.customer, d.share_token, d.share_expires_at,
           s.legal_name, s.trading_name, s.email AS biz_email, s.phone AS biz_phone, s.reminder_cc_me, s.payment_instructions, s.bank_details,
           r->>'key' AS rule_key, (r->>'days')::int AS days, s.reminder_gap_days
      FROM public.vi_documents d JOIN public.vi_settings s ON s.client_id = d.client_id
      CROSS JOIN LATERAL jsonb_array_elements(s.reminder_rules) r, today
     WHERE s.auto_reminders AND coalesce((r->>'on')::boolean, false)
       AND d.status = 'issued' AND d.doc_type IN ('tax', 'nontax') AND d.balance > 0 AND d.due_date IS NOT NULL
       AND d.due_date + (r->>'days')::int = today.t
       AND coalesce(d.customer->>'email', '') ~ '^[^@\s]+@[^@\s]+\.[^@\s]+$'
       AND public._vi_status(d.client_id) IN ('trial', 'active', 'past_due')
       AND coalesce((SELECT (a->'limits'->>'auto_reminders')::boolean FROM public.app_settings st, jsonb_array_elements(st.value->'addons') a
                     WHERE st.key = 'addons' AND a->>'key' = 'vat_invoice'), true)
       AND NOT EXISTS (SELECT 1 FROM public.vi_reminders x WHERE x.doc_id = d.id AND x.rule_key = r->>'key' AND x.status = 'sent')
       AND NOT EXISTS (SELECT 1 FROM public.vi_reminders x WHERE x.doc_id = d.id AND x.created_at > NOW() - make_interval(days => s.reminder_gap_days)))
  SELECT coalesce(jsonb_agg(to_jsonb(c)), '[]'::jsonb) FROM (SELECT DISTINCT ON (id) * FROM cand ORDER BY id, days DESC LIMIT p_limit) c;
$$;
REVOKE ALL ON FUNCTION public._vi_due_reminders(INT) FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public._vi_reminder_done(p_doc UUID, p_rule TEXT, p_channel TEXT, p_recipient TEXT, p_message TEXT, p_ok BOOLEAN, p_error TEXT, p_auto BOOLEAN, p_user UUID)
RETURNS VOID LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE cid UUID;
BEGIN
  SELECT client_id INTO cid FROM public.vi_documents WHERE id = p_doc;
  IF cid IS NULL THEN RETURN; END IF;
  INSERT INTO public.vi_reminders (client_id, doc_id, rule_key, channel, recipient, message, status, error, automatic, sent_by)
  VALUES (cid, p_doc, p_rule, p_channel, left(p_recipient, 160), left(p_message, 2000), CASE WHEN p_ok THEN 'sent' ELSE 'failed' END, left(p_error, 300), p_auto, p_user);
  IF p_ok THEN UPDATE public.vi_documents SET reminder_count = reminder_count + 1, last_reminder_at = NOW() WHERE id = p_doc; END IF;
END $$;
REVOKE ALL ON FUNCTION public._vi_reminder_done(UUID, TEXT, TEXT, TEXT, TEXT, BOOLEAN, TEXT, BOOLEAN, UUID) FROM PUBLIC, anon, authenticated;

-- For the Edge Function: an email of one document, sent by a signed-in user (permission checked as that user)
CREATE OR REPLACE FUNCTION public.vi_email_job(p_doc UUID) RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE d public.vi_documents; s public.vi_settings; sh JSONB;
BEGIN
  SELECT * INTO d FROM public.vi_documents WHERE id = p_doc;
  IF d.id IS NULL THEN RAISE EXCEPTION 'Not found.'; END IF;
  PERFORM public._vi_need(d.client_id, 'reminder');
  IF d.status <> 'issued' THEN RAISE EXCEPTION 'Only issued documents can be emailed.'; END IF;
  IF coalesce(d.customer->>'email', '') !~ '^[^@\s]+@[^@\s]+\.[^@\s]+$' THEN RAISE EXCEPTION 'The customer has no email address.'; END IF;
  IF EXISTS (SELECT 1 FROM public.vi_reminders WHERE doc_id = p_doc AND channel = 'email' AND created_at > NOW() - INTERVAL '10 minutes' AND status = 'sent') THEN
    RAISE EXCEPTION 'An email was just sent for this document. Wait a little before sending again.';
  END IF;
  sh := public.vi_share(p_doc, NULL);
  SELECT * INTO s FROM public.vi_settings WHERE client_id = d.client_id;
  RETURN jsonb_build_object('doc_id', d.id, 'doc_no', d.doc_no, 'doc_type', d.doc_type, 'total', d.total, 'balance', d.balance, 'due_date', d.due_date,
    'customer', d.customer, 'token', sh->>'token', 'business', coalesce(s.trading_name, s.legal_name), 'biz_email', s.email, 'biz_phone', s.phone,
    'payment_instructions', s.payment_instructions, 'bank_details', s.bank_details, 'user', auth.uid());
END $$;
REVOKE ALL ON FUNCTION public.vi_email_job(UUID) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.vi_email_job(UUID) TO authenticated;

-- ═══ 21. Purchaser VAT inbox ═════════════════════════════════════════════════
CREATE OR REPLACE FUNCTION public.vi_save_purchase(p_client UUID, p JSONB) RETURNS UUID
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE pid UUID := nullif(p->>'id', '')::uuid; old public.vi_purchases; t TEXT := nullif(regexp_replace(coalesce(p->>'supplier_tin', ''), '\D', '', 'g'), '');
        kind TEXT := coalesce(nullif(p->>'doc_kind', ''), 'invoice'); sk TEXT;
BEGIN
  PERFORM public._vi_need(p_client, 'purchases');
  IF t IS NOT NULL AND t !~ '^[0-9]{9}$' THEN RAISE EXCEPTION 'Supplier TIN must be 9 digits.'; END IF;
  IF coalesce(trim(p->>'supplier_name'), '') = '' OR coalesce(trim(p->>'invoice_no'), '') = '' OR nullif(p->>'invoice_date', '') IS NULL THEN
    RAISE EXCEPTION 'Supplier, invoice number and date are required.';
  END IF;
  sk := coalesce(nullif(p->>'schedule_key', ''), CASE WHEN kind = 'invoice' THEN 'in:local' ELSE 'in:note' END);
  IF NOT EXISTS (SELECT 1 FROM public.vi_schedule_map WHERE key = sk AND side = 'purchaser') THEN RAISE EXCEPTION 'Unknown schedule.'; END IF;
  IF p->>'attachment_path' IS NOT NULL AND p->>'attachment_path' !~ ('^' || p_client::text || '/purchases/') THEN RAISE EXCEPTION 'Wrong attachment.'; END IF;
  IF pid IS NULL THEN
    INSERT INTO public.vi_purchases (client_id, source, doc_kind, schedule_key, supplier_name, supplier_tin, supplier_address, invoice_no, original_no,
                                     invoice_date, supply_date, description, taxable, vat, total, disallowed_vat, claim_period, attachment_path, created_by)
    VALUES (p_client, CASE WHEN p->>'source' = 'csv' THEN 'csv' ELSE 'manual' END, kind, sk, trim(p->>'supplier_name'), t, nullif(trim(p->>'supplier_address'), ''),
            trim(p->>'invoice_no'), nullif(trim(p->>'original_no'), ''), (p->>'invoice_date')::date, nullif(p->>'supply_date', '')::date,
            nullif(trim(p->>'description'), ''), coalesce(nullif(p->>'taxable', '')::numeric, 0), coalesce(nullif(p->>'vat', '')::numeric, 0),
            coalesce(nullif(p->>'total', '')::numeric, coalesce(nullif(p->>'taxable', '')::numeric, 0) + coalesce(nullif(p->>'vat', '')::numeric, 0)),
            coalesce(nullif(p->>'disallowed_vat', '')::numeric, 0), nullif(p->>'claim_period', ''), nullif(p->>'attachment_path', ''), auth.uid())
    RETURNING id INTO pid;
  ELSE
    SELECT * INTO old FROM public.vi_purchases WHERE id = pid AND client_id = p_client;
    IF old.id IS NULL THEN RAISE EXCEPTION 'Not found.'; END IF;
    IF old.source IN ('taxmate', 'api') THEN RAISE EXCEPTION 'Records from the supplier / RAMIS cannot be edited — approve, reject or dispute them.'; END IF;
    IF old.approval IN ('approved', 'matched') THEN RAISE EXCEPTION 'Approved records are locked. Set it back to pending review first.'; END IF;
    UPDATE public.vi_purchases SET doc_kind = kind, schedule_key = sk, supplier_name = trim(p->>'supplier_name'), supplier_tin = t,
      supplier_address = nullif(trim(p->>'supplier_address'), ''), invoice_no = trim(p->>'invoice_no'), original_no = nullif(trim(p->>'original_no'), ''),
      invoice_date = (p->>'invoice_date')::date, supply_date = nullif(p->>'supply_date', '')::date, description = nullif(trim(p->>'description'), ''),
      taxable = coalesce(nullif(p->>'taxable', '')::numeric, 0), vat = coalesce(nullif(p->>'vat', '')::numeric, 0),
      total = coalesce(nullif(p->>'total', '')::numeric, coalesce(nullif(p->>'taxable', '')::numeric, 0) + coalesce(nullif(p->>'vat', '')::numeric, 0)),
      disallowed_vat = coalesce(nullif(p->>'disallowed_vat', '')::numeric, 0), claim_period = nullif(p->>'claim_period', ''),
      attachment_path = coalesce(nullif(p->>'attachment_path', ''), attachment_path), updated_at = NOW()
    WHERE id = pid;
  END IF;
  RETURN pid;
EXCEPTION WHEN unique_violation THEN
  RAISE EXCEPTION 'This supplier invoice is already in your inbox.';
END $$;
REVOKE ALL ON FUNCTION public.vi_save_purchase(UUID, JSONB) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.vi_save_purchase(UUID, JSONB) TO authenticated;

-- CSV import: rows already parsed in the browser; duplicates skipped, errors listed per row
CREATE OR REPLACE FUNCTION public.vi_import_purchases(p_client UUID, p_rows JSONB) RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE r JSONB; i INT := 0; ok INT := 0; dup INT := 0; errs JSONB := '[]'::jsonb;
BEGIN
  PERFORM public._vi_need(p_client, 'purchases');
  IF jsonb_typeof(p_rows) <> 'array' OR jsonb_array_length(p_rows) > 2000 THEN RAISE EXCEPTION 'Up to 2,000 rows per import.'; END IF;
  FOR r IN SELECT * FROM jsonb_array_elements(p_rows) LOOP
    i := i + 1;
    BEGIN
      PERFORM public.vi_save_purchase(p_client, (r - 'id') || jsonb_build_object('source', 'csv'));
      ok := ok + 1;
    EXCEPTION WHEN others THEN
      IF SQLERRM LIKE '%already in your inbox%' THEN dup := dup + 1;
      ELSE errs := errs || jsonb_build_object('row', i, 'error', SQLERRM); END IF;
    END;
  END LOOP;
  RETURN jsonb_build_object('imported', ok, 'duplicates', dup, 'errors', errs);
END $$;
REVOKE ALL ON FUNCTION public.vi_import_purchases(UUID, JSONB) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.vi_import_purchases(UUID, JSONB) TO authenticated;

-- Review: approve / reject / dispute / back to pending. TaxMate-linked records whose amounts agree become MATCHED.
CREATE OR REPLACE FUNCTION public.vi_review_purchase(p_id UUID, p_approval TEXT, p_note TEXT DEFAULT NULL, p_disallowed NUMERIC DEFAULT NULL, p_period TEXT DEFAULT NULL)
RETURNS TEXT LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE pu public.vi_purchases; sd public.vi_documents; res TEXT := p_approval;
BEGIN
  SELECT * INTO pu FROM public.vi_purchases WHERE id = p_id FOR UPDATE;
  IF pu.id IS NULL THEN RAISE EXCEPTION 'Not found.'; END IF;
  PERFORM public._vi_need(pu.client_id, 'approve_purchases');
  IF p_approval NOT IN ('pending', 'approved', 'rejected', 'disputed') THEN RAISE EXCEPTION 'Unknown status.'; END IF;
  IF p_approval IN ('rejected', 'disputed') AND coalesce(trim(p_note), '') = '' THEN RAISE EXCEPTION 'Write the reason.'; END IF;
  IF p_disallowed IS NOT NULL AND (p_disallowed < 0 OR p_disallowed > abs(pu.vat)) THEN RAISE EXCEPTION 'Disallowed VAT must be between 0 and the VAT amount.'; END IF;
  IF p_period IS NOT NULL AND p_period !~ '^\d{4}-(0[1-9]|1[0-2])$' THEN RAISE EXCEPTION 'Claim period as YYYY-MM.'; END IF;
  IF p_approval = 'approved' AND pu.linked_doc_id IS NOT NULL THEN
    SELECT * INTO sd FROM public.vi_documents WHERE id = pu.linked_doc_id;
    IF sd.id IS NOT NULL AND sd.status = 'issued' AND sd.net_total = pu.taxable AND sd.vat_total = pu.vat AND sd.total = pu.total THEN res := 'matched'; END IF;
  END IF;
  UPDATE public.vi_purchases SET approval = res, review_note = coalesce(nullif(trim(p_note), ''), review_note),
         disallowed_vat = coalesce(p_disallowed, disallowed_vat), claim_period = coalesce(p_period, claim_period),
         reviewed_by = auth.uid(), reviewed_at = NOW(), updated_at = NOW()
   WHERE id = p_id;
  RETURN res;
END $$;
REVOKE ALL ON FUNCTION public.vi_review_purchase(UUID, TEXT, TEXT, NUMERIC, TEXT) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.vi_review_purchase(UUID, TEXT, TEXT, NUMERIC, TEXT) TO authenticated;

CREATE OR REPLACE FUNCTION public.vi_delete_purchase(p_id UUID) RETURNS VOID
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE pu public.vi_purchases;
BEGIN
  SELECT * INTO pu FROM public.vi_purchases WHERE id = p_id;
  IF pu.id IS NULL THEN RAISE EXCEPTION 'Not found.'; END IF;
  PERFORM public._vi_need(pu.client_id, 'purchases');
  IF pu.source IN ('taxmate', 'api') THEN RAISE EXCEPTION 'Records from the supplier / RAMIS cannot be deleted — reject or dispute them.'; END IF;
  IF pu.approval IN ('approved', 'matched') THEN RAISE EXCEPTION 'Approved records cannot be deleted.'; END IF;
  DELETE FROM public.vi_purchases WHERE id = p_id;
END $$;
REVOKE ALL ON FUNCTION public.vi_delete_purchase(UUID) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.vi_delete_purchase(UUID) TO authenticated;

-- The supplier's document behind a TaxMate-linked purchase record
CREATE OR REPLACE FUNCTION public.vi_purchase_document(p_id UUID) RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE pu public.vi_purchases;
BEGIN
  SELECT * INTO pu FROM public.vi_purchases WHERE id = p_id;
  IF pu.id IS NULL THEN RAISE EXCEPTION 'Not found.'; END IF;
  PERFORM public._vi_need(pu.client_id, 'view');
  IF pu.linked_doc_id IS NULL THEN RETURN NULL; END IF;
  RETURN public._vi_doc_json(pu.linked_doc_id);
END $$;
REVOKE ALL ON FUNCTION public.vi_purchase_document(UUID) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.vi_purchase_document(UUID) TO authenticated;

-- ═══ 22. RAMIS submission queue ═══════════════════════════════════════════════
CREATE OR REPLACE FUNCTION public.vi_save_ramis_config(p_client UUID, p JSONB) RETURNS VOID
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE use_login BOOLEAN := coalesce((p->>'use_saved_login')::boolean, false); old public.vi_ramis_config;
BEGIN
  PERFORM public._vi_need(p_client, 'settings');
  IF coalesce((p->>'enabled')::boolean, false) AND NOT coalesce((SELECT vat_registered FROM public.vi_settings WHERE client_id = p_client), false) THEN
    RAISE EXCEPTION 'RAMIS submission is for VAT-registered businesses (Invoice & VAT setup).';
  END IF;
  SELECT * INTO old FROM public.vi_ramis_config WHERE client_id = p_client;
  INSERT INTO public.vi_ramis_config (client_id) VALUES (p_client) ON CONFLICT (client_id) DO NOTHING;
  UPDATE public.vi_ramis_config SET enabled = coalesce((p->>'enabled')::boolean, false),
    environment = CASE WHEN p->>'environment' = 'sandbox' THEN 'sandbox' ELSE 'production' END,
    auto_submit = coalesce((p->>'auto_submit')::boolean, false), use_saved_login = use_login,
    consent_at = CASE WHEN use_login THEN coalesce(CASE WHEN old.use_saved_login THEN old.consent_at END, NOW()) END,
    consent_by = CASE WHEN use_login THEN coalesce(CASE WHEN old.use_saved_login THEN old.consent_by END, auth.uid()) END,
    updated_by = auth.uid(), updated_at = NOW()
  WHERE client_id = p_client;
  -- issued tax documents that were waiting for RAMIS to be switched on
  IF coalesce((p->>'enabled')::boolean, false) THEN
    UPDATE public.vi_documents SET ramis_status = 'ready' WHERE client_id = p_client AND is_tax AND status = 'issued' AND ramis_status = 'draft';
  END IF;
END $$;
REVOKE ALL ON FUNCTION public.vi_save_ramis_config(UUID, JSONB) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.vi_save_ramis_config(UUID, JSONB) TO authenticated;

CREATE OR REPLACE FUNCTION public.vi_ramis_info(p_client UUID) RETURNS JSONB
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE api JSONB := (SELECT value FROM public.app_settings WHERE key = 'vi_ramis_api');
BEGIN
  PERFORM public._vi_need(p_client, 'view');
  RETURN jsonb_build_object(
    'config', (SELECT to_jsonb(c) FROM public.vi_ramis_config c WHERE c.client_id = p_client),
    'has_ssid', EXISTS (SELECT 1 FROM public.client_ird WHERE client_id = p_client AND ssid_enc IS NOT NULL),
    'has_pin', EXISTS (SELECT 1 FROM public.client_ird WHERE client_id = p_client AND pin_enc IS NOT NULL),
    'adapter', api->>'active_adapter', 'adapter_status', api->'adapters'->(api->>'active_adapter')->>'status',
    'spec_version', api->'adapters'->(api->>'active_adapter')->>'spec_version',
    'compliance', (SELECT value FROM public.app_settings WHERE key = 'vi_compliance'));
END $$;
REVOKE ALL ON FUNCTION public.vi_ramis_info(UUID) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.vi_ramis_info(UUID) TO authenticated;

-- Canonical (adapter-neutral) data of a document. The adapter maps it to IRD's fields once IRD's spec is configured.
CREATE OR REPLACE FUNCTION public._vi_ramis_payload(p_doc UUID) RETURNS JSONB
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT jsonb_build_object(
    'kind', CASE d.doc_type WHEN 'credit' THEN 'credit' WHEN 'debit' THEN 'debit' ELSE 'invoice' END,
    'supplier_tin', d.supplier->>'tin', 'supplier_name', d.supplier->>'legal_name', 'supplier_address', d.supplier->>'registered_address',
    'purchaser_tin', d.customer->>'tin', 'purchaser_name', d.customer->>'name', 'purchaser_address', d.customer->>'address',
    'invoice_no', d.doc_no, 'invoice_date', d.issue_date, 'supply_date', d.supply_date, 'place_of_supply', d.place_of_supply, 'payment_mode', d.payment_mode,
    'original_invoice_no', o.doc_no, 'original_invoice_date', o.issue_date, 'reason', coalesce(d.reason, d.reason_code),
    'value_excl_vat', d.net_total, 'vat', d.vat_total, 'total_incl_vat', d.total, 'currency', 'LKR',
    'taxable_standard', d.taxable_standard, 'taxable_zero', d.taxable_zero,
    'lines', (SELECT jsonb_agg(jsonb_build_object('no', l.sort, 'description', l.description, 'quantity', l.quantity, 'unit', l.unit, 'unit_price', l.unit_price,
                   'value_excl_vat', l.net, 'vat_rate', l.rate, 'vat', l.vat, 'total', l.total, 'treatment', l.treatment, 'supply_kind', l.supply_kind, 'schedule', l.schedule) ORDER BY l.sort)
                FROM public.vi_document_lines l WHERE l.doc_id = d.id))
  FROM public.vi_documents d LEFT JOIN public.vi_documents o ON o.id = d.original_id WHERE d.id = p_doc;
$$;
REVOKE ALL ON FUNCTION public._vi_ramis_payload(UUID) FROM PUBLIC, anon, authenticated;

-- Submit (queue) one issued tax document. Idempotent: a document has at most one live submission.
CREATE OR REPLACE FUNCTION public.vi_submit_ramis(p_doc UUID) RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, extensions AS $$
DECLARE d public.vi_documents; v JSONB; errs TEXT; rc public.vi_ramis_config; api JSONB := (SELECT value FROM public.app_settings WHERE key = 'vi_ramis_api');
        ad TEXT; ready BOOLEAN; pl JSONB; sid UUID; sno TEXT; live public.vi_ramis_submissions;
BEGIN
  SELECT * INTO d FROM public.vi_documents WHERE id = p_doc FOR UPDATE;
  IF d.id IS NULL THEN RAISE EXCEPTION 'Not found.'; END IF;
  PERFORM public._vi_need(d.client_id, 'submit_ramis');
  SELECT * INTO live FROM public.vi_ramis_submissions WHERE doc_id = p_doc AND status IN ('pending_config', 'queued', 'submitting', 'retrying', 'submitted', 'accepted');
  IF live.id IS NOT NULL THEN
    RETURN jsonb_build_object('id', live.id, 'submission_no', live.submission_no, 'status', live.status, 'already', true);
  END IF;
  IF d.ramis_status = 'rejected' THEN RAISE EXCEPTION 'RAMIS rejected this invoice. Review the purchaser information and create a corrected draft.'; END IF;
  IF d.ramis_status IN ('accepted', 'locked') THEN RAISE EXCEPTION 'Already accepted by RAMIS.'; END IF;
  v := public._vi_validate(p_doc, true);
  IF NOT (v->>'ok')::boolean THEN
    SELECT string_agg('• ' || (e->>'label') || ': ' || (e->>'msg'), E'\n') INTO errs FROM jsonb_array_elements(v->'checks') e
     WHERE NOT (e->>'ok')::boolean AND e->>'level' = 'error';
    RAISE EXCEPTION E'Not ready for RAMIS:\n%', errs;
  END IF;
  SELECT * INTO rc FROM public.vi_ramis_config WHERE client_id = d.client_id;
  ad := coalesce(api->>'active_adapter', 'v1');
  ready := coalesce(api->'adapters'->ad->>'status', 'pending') = 'active';
  pl := public._vi_ramis_payload(p_doc);
  sno := 'TX-RAMIS-' || left(regexp_replace(d.doc_no, '[^A-Za-z0-9]', '', 'g'), 24) || '-' || upper(substr(md5(gen_random_uuid()::text), 1, 6));
  INSERT INTO public.vi_ramis_submissions (client_id, doc_id, submission_no, kind, adapter_version, environment, payload, payload_hash, status, requested_by)
  VALUES (d.client_id, p_doc, sno, pl->>'kind', ad, rc.environment, pl, encode(digest(pl::text, 'sha256'), 'hex'),
          CASE WHEN ready THEN 'queued' ELSE 'pending_config' END, auth.uid())
  RETURNING id INTO sid;
  INSERT INTO public.vi_ramis_log (submission_id, client_id, kind, message)
  VALUES (sid, d.client_id, 'queued', CASE WHEN ready THEN 'Queued for RAMIS (' || rc.environment || ', adapter ' || ad || ')' ELSE 'RAMIS Integration Pending Configuration — waiting in the queue' END);
  UPDATE public.vi_documents SET ramis_status = 'queued',
         ramis_message = CASE WHEN ready THEN 'Queued for RAMIS' ELSE 'RAMIS Integration Pending Configuration — waiting in the queue, not yet sent to IRD' END
   WHERE id = p_doc;
  RETURN jsonb_build_object('id', sid, 'submission_no', sno, 'status', CASE WHEN ready THEN 'queued' ELSE 'pending_config' END);
END $$;
REVOKE ALL ON FUNCTION public.vi_submit_ramis(UUID) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.vi_submit_ramis(UUID) TO authenticated;

-- Take a submission back while it has not been sent yet (e.g. pending configuration)
CREATE OR REPLACE FUNCTION public.vi_ramis_withdraw(p_doc UUID) RETURNS VOID
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE s public.vi_ramis_submissions;
BEGIN
  SELECT * INTO s FROM public.vi_ramis_submissions WHERE doc_id = p_doc AND status IN ('pending_config', 'queued') FOR UPDATE;
  IF s.id IS NULL THEN RAISE EXCEPTION 'Nothing waiting to withdraw (sent submissions cannot be withdrawn).'; END IF;
  PERFORM public._vi_need(s.client_id, 'submit_ramis');
  IF s.attempts > 0 THEN RAISE EXCEPTION 'It was already sent to RAMIS once — it cannot be withdrawn.'; END IF;
  UPDATE public.vi_ramis_submissions SET status = 'cancelled', updated_at = NOW() WHERE id = s.id;
  INSERT INTO public.vi_ramis_log (submission_id, client_id, kind, message) VALUES (s.id, s.client_id, 'manual', 'Withdrawn before sending');
  UPDATE public.vi_documents SET ramis_status = 'ready', ramis_message = 'Withdrawn before sending to RAMIS' WHERE id = p_doc;
END $$;
REVOKE ALL ON FUNCTION public.vi_ramis_withdraw(UUID) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.vi_ramis_withdraw(UUID) TO authenticated;

-- Manual retry: a failed submission starts again; a retrying one is tried now
CREATE OR REPLACE FUNCTION public.vi_ramis_retry(p_doc UUID) RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE s public.vi_ramis_submissions; cid UUID;
BEGIN
  SELECT client_id INTO cid FROM public.vi_documents WHERE id = p_doc;
  IF cid IS NULL THEN RAISE EXCEPTION 'Not found.'; END IF;
  PERFORM public._vi_need(cid, 'submit_ramis');
  SELECT * INTO s FROM public.vi_ramis_submissions WHERE doc_id = p_doc AND status = 'retrying' FOR UPDATE;
  IF s.id IS NOT NULL THEN
    UPDATE public.vi_ramis_submissions SET next_attempt_at = NOW(), updated_at = NOW() WHERE id = s.id;
    INSERT INTO public.vi_ramis_log (submission_id, client_id, kind, message) VALUES (s.id, cid, 'manual', 'Manual retry requested');
    RETURN jsonb_build_object('id', s.id, 'status', 'retrying');
  END IF;
  IF (SELECT ramis_status FROM public.vi_documents WHERE id = p_doc) <> 'failed' THEN RAISE EXCEPTION 'Only failed submissions are retried.'; END IF;
  RETURN public.vi_submit_ramis(p_doc);
END $$;
REVOKE ALL ON FUNCTION public.vi_ramis_retry(UUID) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.vi_ramis_retry(UUID) TO authenticated;

-- ── For the vatinvoice Edge Function (service role only) ──
CREATE OR REPLACE FUNCTION public._vi_ramis_claim(p_limit INT DEFAULT 20) RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE res JSONB := '[]'::jsonb; s RECORD; poll BOOLEAN;
BEGIN
  -- queued / retrying → send; submitted (waiting for IRD's final answer) → ask for the status
  FOR s IN SELECT * FROM public.vi_ramis_submissions WHERE status IN ('queued', 'retrying', 'submitted') AND next_attempt_at <= NOW()
            ORDER BY next_attempt_at LIMIT p_limit FOR UPDATE SKIP LOCKED LOOP
    poll := s.status = 'submitted';
    UPDATE public.vi_ramis_submissions SET status = 'submitting', attempts = attempts + CASE WHEN poll THEN 0 ELSE 1 END,
           check_first = check_first OR poll, submitted_at = coalesce(submitted_at, NOW()), updated_at = NOW() WHERE id = s.id;
    UPDATE public.vi_documents SET ramis_status = 'submitting', ramis_submitted_at = coalesce(ramis_submitted_at, NOW()) WHERE id = s.doc_id AND NOT poll;
    res := res || jsonb_build_object('id', s.id, 'client_id', s.client_id, 'doc_id', s.doc_id, 'submission_no', s.submission_no, 'kind', s.kind,
                 'adapter_version', s.adapter_version, 'environment', s.environment, 'payload', s.payload, 'payload_hash', s.payload_hash,
                 'attempt', s.attempts + CASE WHEN poll THEN 0 ELSE 1 END, 'check_first', s.check_first OR poll, 'poll_only', poll);
  END LOOP;
  RETURN res;
END $$;
REVOKE ALL ON FUNCTION public._vi_ramis_claim(INT) FROM PUBLIC, anon, authenticated;

-- Each taxpayer's own RAMIS login (only when they allowed it); used in memory by the Edge Function, never logged
CREATE OR REPLACE FUNCTION public._vi_ramis_login(p_client UUID) RETURNS JSONB
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, extensions AS $$
DECLARE i public.client_ird; c public.vi_ramis_config;
BEGIN
  SELECT * INTO c FROM public.vi_ramis_config WHERE client_id = p_client;
  IF c.client_id IS NULL OR NOT c.use_saved_login OR c.consent_at IS NULL THEN RETURN NULL; END IF;
  SELECT * INTO i FROM public.client_ird WHERE client_id = p_client;
  IF i.ssid_enc IS NULL OR i.pin_enc IS NULL THEN RETURN NULL; END IF;
  RETURN jsonb_build_object('ssid', pgp_sym_decrypt(i.ssid_enc, public._ird_key()), 'password', pgp_sym_decrypt(i.pin_enc, public._ird_key()));
END $$;
REVOKE ALL ON FUNCTION public._vi_ramis_login(UUID) FROM PUBLIC, anon, authenticated;

-- The adapter reports the outcome: accepted · submitted · rejected · retry · unknown (timeout) · pending_config
CREATE OR REPLACE FUNCTION public._vi_ramis_result(p_sub UUID, p_outcome TEXT, p_http INT DEFAULT NULL, p_ramis_status TEXT DEFAULT NULL,
                                                   p_ref TEXT DEFAULT NULL, p_code TEXT DEFAULT NULL, p_message TEXT DEFAULT NULL, p_detail JSONB DEFAULT NULL)
RETURNS VOID LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE s public.vi_ramis_submissions; d public.vi_documents; nxt TIMESTAMPTZ; final_fail BOOLEAN;
BEGIN
  SELECT * INTO s FROM public.vi_ramis_submissions WHERE id = p_sub FOR UPDATE;
  IF s.id IS NULL THEN RAISE EXCEPTION 'Unknown submission'; END IF;
  SELECT * INTO d FROM public.vi_documents WHERE id = s.doc_id;
  INSERT INTO public.vi_ramis_log (submission_id, client_id, kind, http_status, message, detail)
  VALUES (s.id, s.client_id, CASE WHEN p_outcome IN ('retry', 'unknown') THEN 'error' WHEN p_outcome = 'pending_config' THEN 'config' ELSE 'response' END,
          p_http, left(coalesce(p_message, p_outcome), 1000), p_detail);
  IF p_outcome = 'accepted' THEN
    UPDATE public.vi_ramis_submissions SET status = 'accepted', last_http_status = p_http, ramis_status = p_ramis_status, ramis_ref = p_ref,
           error_code = NULL, error_message = NULL, responded_at = NOW(), check_first = FALSE, updated_at = NOW() WHERE id = s.id;
    UPDATE public.vi_documents SET ramis_status = 'accepted', ramis_ref = left(p_ref, 120), locked_at = coalesce(locked_at, NOW()),
           ramis_message = 'Submitted to IRD/RAMIS – Locked' WHERE id = s.doc_id;
    UPDATE public.vi_purchases SET ramis_status = 'accepted', updated_at = NOW() WHERE linked_doc_id = s.doc_id;
    PERFORM public._vi_notify(s.client_id, 'RAMIS accepted ' || d.doc_no, 'Submitted to IRD/RAMIS – Locked' || coalesce(' · ref ' || p_ref, ''), '/client/vat?doc=' || s.doc_id);
  ELSIF p_outcome = 'submitted' THEN
    UPDATE public.vi_ramis_submissions SET status = 'submitted', last_http_status = p_http, ramis_status = p_ramis_status, ramis_ref = coalesce(p_ref, ramis_ref),
           responded_at = NOW(), check_first = FALSE, next_attempt_at = NOW() + INTERVAL '15 minutes', updated_at = NOW() WHERE id = s.id;
    UPDATE public.vi_documents SET ramis_status = 'submitted', ramis_ref = coalesce(left(p_ref, 120), ramis_ref),
           ramis_message = 'Submitted to IRD/RAMIS — waiting for the final status' WHERE id = s.doc_id;
  ELSIF p_outcome = 'rejected' THEN
    UPDATE public.vi_ramis_submissions SET status = 'rejected', last_http_status = p_http, ramis_status = p_ramis_status, error_code = left(p_code, 60),
           error_message = left(p_message, 500), responded_at = NOW(), check_first = FALSE, updated_at = NOW() WHERE id = s.id;
    UPDATE public.vi_documents SET ramis_status = 'rejected', ramis_message = left('RAMIS rejected: ' || coalesce(p_message, p_code, 'no reason given'), 500) WHERE id = s.doc_id;
    PERFORM public._vi_notify(s.client_id, 'RAMIS rejected ' || d.doc_no, left(coalesce(p_message, p_code, 'See the invoice for details.'), 300) || ' — create a corrected draft.', '/client/vat?doc=' || s.doc_id);
  ELSIF p_outcome IN ('retry', 'unknown') THEN
    final_fail := s.attempts >= s.max_attempts;
    nxt := NOW() + least(INTERVAL '6 hours', make_interval(mins => (power(2, greatest(s.attempts, 1)))::int));
    UPDATE public.vi_ramis_submissions SET status = CASE WHEN final_fail THEN 'failed' ELSE 'retrying' END, last_http_status = p_http,
           error_code = left(p_code, 60), error_message = left(p_message, 500), next_attempt_at = nxt,
           check_first = (p_outcome = 'unknown') OR (s.check_first AND p_outcome = 'retry'), updated_at = NOW() WHERE id = s.id;
    UPDATE public.vi_documents SET ramis_status = CASE WHEN final_fail THEN 'failed' ELSE 'queued' END,
           ramis_message = left(CASE WHEN final_fail THEN 'RAMIS submission failed after ' || s.attempts || ' tries: ' ELSE 'RAMIS not reached — will retry: ' END
                                || coalesce(p_message, p_code, 'no answer'), 500) WHERE id = s.doc_id;
    IF final_fail THEN
      PERFORM public._vi_notify(s.client_id, 'RAMIS submission failed — ' || d.doc_no, 'Tried ' || s.attempts || ' times. Open the invoice and press Retry.', '/client/vat?doc=' || s.doc_id);
    END IF;
  ELSIF p_outcome = 'pending_config' THEN
    UPDATE public.vi_ramis_submissions SET status = 'pending_config', attempts = greatest(0, attempts - 1), updated_at = NOW() WHERE id = s.id;
    UPDATE public.vi_documents SET ramis_status = 'queued',
           ramis_message = 'RAMIS Integration Pending Configuration — waiting in the queue, not yet sent to IRD' WHERE id = s.doc_id;
  ELSE
    RAISE EXCEPTION 'Unknown outcome %', p_outcome;
  END IF;
END $$;
REVOKE ALL ON FUNCTION public._vi_ramis_result(UUID, TEXT, INT, TEXT, TEXT, TEXT, TEXT, JSONB) FROM PUBLIC, anon, authenticated;

-- ═══ 23. TaxMate admin: rates, schedule mapping, compliance, RAMIS API, overview ═══
CREATE OR REPLACE FUNCTION public.admin_vi_save_rate(p JSONB) RETURNS UUID
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE rid UUID := nullif(p->>'id', '')::uuid; old public.vi_tax_rates; used BOOLEAN;
BEGIN
  IF NOT public.is_admin() THEN RAISE EXCEPTION 'Admins only'; END IF;
  IF rid IS NULL THEN
    -- a new rate for an existing code closes the previous one the day before
    UPDATE public.vi_tax_rates SET effective_to = (p->>'effective_from')::date - 1, updated_at = NOW()
     WHERE code = upper(p->>'code') AND effective_to IS NULL AND effective_from < (p->>'effective_from')::date;
    INSERT INTO public.vi_tax_rates (code, treatment, rate, effective_from, effective_to, description, ird_reference, ird_status, version, created_by)
    VALUES (upper(p->>'code'), p->>'treatment', (p->>'rate')::numeric, (p->>'effective_from')::date, nullif(p->>'effective_to', '')::date,
            p->>'description', nullif(p->>'ird_reference', ''), coalesce(nullif(p->>'ird_status', ''), 'confirmed'),
            coalesce((SELECT max(version) FROM public.vi_tax_rates WHERE code = upper(p->>'code')), 0) + 1, auth.uid())
    RETURNING id INTO rid;
  ELSE
    SELECT * INTO old FROM public.vi_tax_rates WHERE id = rid;
    used := EXISTS (SELECT 1 FROM public.vi_document_lines l JOIN public.vi_documents d ON d.id = l.doc_id WHERE l.rate_id = rid AND d.status <> 'draft');
    IF used AND (old.rate <> (p->>'rate')::numeric OR old.treatment <> p->>'treatment' OR old.effective_from <> (p->>'effective_from')::date OR old.code <> upper(p->>'code')) THEN
      RAISE EXCEPTION 'This rate is on issued invoices — its rate, code, type and start date stay as they are. Add a new rate with a new start date instead.';
    END IF;
    UPDATE public.vi_tax_rates SET code = upper(p->>'code'), treatment = p->>'treatment', rate = (p->>'rate')::numeric,
      effective_from = (p->>'effective_from')::date, effective_to = nullif(p->>'effective_to', '')::date, description = p->>'description',
      ird_reference = nullif(p->>'ird_reference', ''), ird_status = coalesce(nullif(p->>'ird_status', ''), 'confirmed'), updated_at = NOW()
    WHERE id = rid;
  END IF;
  RETURN rid;
END $$;
REVOKE ALL ON FUNCTION public.admin_vi_save_rate(JSONB) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_vi_save_rate(JSONB) TO authenticated;

CREATE OR REPLACE FUNCTION public.admin_vi_save_schedule(p JSONB) RETURNS VOID
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NOT public.is_admin() THEN RAISE EXCEPTION 'Admins only'; END IF;
  INSERT INTO public.vi_schedule_map (key, side, schedule, label, basis, active, updated_by)
  VALUES (p->>'key', p->>'side', nullif(p->>'schedule', ''), p->>'label', nullif(p->>'basis', ''), coalesce((p->>'active')::boolean, true), auth.uid())
  ON CONFLICT (key) DO UPDATE SET side = EXCLUDED.side, schedule = EXCLUDED.schedule, label = EXCLUDED.label, basis = EXCLUDED.basis,
    active = EXCLUDED.active, version = public.vi_schedule_map.version + 1, updated_by = auth.uid(), updated_at = NOW();
END $$;
REVOKE ALL ON FUNCTION public.admin_vi_save_schedule(JSONB) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_vi_save_schedule(JSONB) TO authenticated;

-- Record a compliance update; bump_version = new rules version for documents issued from now on
CREATE OR REPLACE FUNCTION public.admin_vi_compliance(p JSONB) RETURNS INT
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE rv INT := coalesce((SELECT (value->>'rules_version')::int FROM public.app_settings WHERE key = 'vi_compliance'), 1);
BEGIN
  IF NOT public.is_admin() THEN RAISE EXCEPTION 'Admins only'; END IF;
  IF coalesce((p->>'bump_version')::boolean, false) THEN rv := rv + 1; END IF;
  UPDATE public.app_settings SET value = value || jsonb_build_object('rules_version', rv)
     || CASE WHEN nullif(p->>'invoice_spec', '') IS NOT NULL THEN jsonb_build_object('invoice_spec', p->>'invoice_spec', 'invoice_spec_date', p->>'effective_date') ELSE '{}'::jsonb END
     || CASE WHEN nullif(p->>'ramis_api_spec', '') IS NOT NULL THEN jsonb_build_object('ramis_api_spec', p->>'ramis_api_spec') ELSE '{}'::jsonb END
   WHERE key = 'vi_compliance';
  INSERT INTO public.vi_compliance_updates (area, title, reference, effective_date, details, rules_version, created_by)
  VALUES (coalesce(nullif(p->>'area', ''), 'other'), p->>'title', nullif(p->>'reference', ''), nullif(p->>'effective_date', '')::date,
          nullif(p->>'details', ''), rv, auth.uid());
  RETURN rv;
END $$;
REVOKE ALL ON FUNCTION public.admin_vi_compliance(JSONB) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_vi_compliance(JSONB) TO authenticated;

-- RAMIS API settings (endpoints / spec version only — never secrets). status 'active' only when built to IRD's official spec.
CREATE OR REPLACE FUNCTION public.admin_vi_ramis_api(p JSONB) RETURNS VOID
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE ad TEXT := coalesce(nullif(p->>'adapter', ''), 'v1'); cfg JSONB := p->'config'; k TEXT;
BEGIN
  IF NOT public.is_admin() THEN RAISE EXCEPTION 'Admins only'; END IF;
  IF ad !~ '^v[0-9]{1,3}$' THEN RAISE EXCEPTION 'Adapter name like v1, v2.'; END IF;
  FOREACH k IN ARRAY ARRAY['base_url', 'token_endpoint', 'submit_endpoint', 'status_endpoint'] LOOP
    IF coalesce(cfg->'sandbox'->>k, '') <> '' AND cfg->'sandbox'->>k !~ '^https://' THEN RAISE EXCEPTION 'URLs must start with https://'; END IF;
    IF coalesce(cfg->'production'->>k, '') <> '' AND cfg->'production'->>k !~ '^https://' THEN RAISE EXCEPTION 'URLs must start with https://'; END IF;
  END LOOP;
  IF cfg::text ~* '"(client_secret|secret|password|passwd|pin|api_key|apikey|access_token|refresh_token|private_key)"\s*:' THEN RAISE EXCEPTION 'Do not store secrets here — put them in Supabase Edge Function secrets.'; END IF;
  IF cfg->>'status' = 'active' AND coalesce(cfg->>'spec_version', '') = '' THEN RAISE EXCEPTION 'Enter the IRD API specification version before activating.'; END IF;
  UPDATE public.app_settings SET value = jsonb_set(jsonb_set(value, ARRAY['adapters', ad], cfg, true), '{active_adapter}', to_jsonb(ad))
   WHERE key = 'vi_ramis_api';
  INSERT INTO public.vi_compliance_updates (area, title, reference, details, created_by)
  VALUES ('ramis_api', 'RAMIS API adapter ' || ad || ' settings changed (' || coalesce(cfg->>'status', 'pending') || ')', nullif(cfg->>'spec_version', ''), NULL, auth.uid());
END $$;
REVOKE ALL ON FUNCTION public.admin_vi_ramis_api(JSONB) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_vi_ramis_api(JSONB) TO authenticated;

-- After the adapter is configured: submissions waiting as "pending configuration" go to the queue
CREATE OR REPLACE FUNCTION public.admin_vi_release_pending() RETURNS INT
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE n INT; api JSONB := (SELECT value FROM public.app_settings WHERE key = 'vi_ramis_api');
BEGIN
  IF NOT public.is_admin() THEN RAISE EXCEPTION 'Admins only'; END IF;
  IF coalesce(api->'adapters'->(api->>'active_adapter')->>'status', 'pending') <> 'active' THEN RAISE EXCEPTION 'The RAMIS adapter is not active yet.'; END IF;
  UPDATE public.vi_ramis_submissions SET status = 'queued', adapter_version = api->>'active_adapter', next_attempt_at = NOW(), updated_at = NOW() WHERE status = 'pending_config';
  GET DIAGNOSTICS n = ROW_COUNT;
  UPDATE public.vi_documents SET ramis_message = 'Queued for RAMIS' WHERE id IN (SELECT doc_id FROM public.vi_ramis_submissions WHERE status = 'queued');
  RETURN n;
END $$;
REVOKE ALL ON FUNCTION public.admin_vi_release_pending() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_vi_release_pending() TO authenticated;

CREATE OR REPLACE FUNCTION public.admin_vi_overview() RETURNS JSONB
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE m0 DATE := date_trunc('month', (now() AT TIME ZONE 'Asia/Colombo'))::date;
BEGIN
  IF NOT public.is_admin() THEN RAISE EXCEPTION 'Admins only'; END IF;
  RETURN jsonb_build_object(
    'clients', coalesce((SELECT jsonb_agg(x ORDER BY x->>'name') FROM (
      SELECT jsonb_build_object('client_id', c.id, 'name', c.full_name, 'client_no', c.client_no,
        'business', coalesce(s.trading_name, s.legal_name), 'vat_registered', coalesce(s.vat_registered, false), 'tin', s.tin,
        'status', public._vi_status(c.id), 'cycle', a.billing_cycle, 'price', a.price, 'next_bill_date', a.next_bill_date, 'trial_ends', a.trial_ends,
        'ramis_enabled', coalesce(r.enabled, false),
        'docs_month', (SELECT count(*) FROM public.vi_documents d WHERE d.client_id = c.id AND d.status <> 'draft' AND d.issue_date >= m0),
        'docs_total', (SELECT count(*) FROM public.vi_documents d WHERE d.client_id = c.id AND d.status <> 'draft'),
        'sales_month', (SELECT coalesce(sum(d.total), 0) FROM public.vi_documents d WHERE d.client_id = c.id AND d.status = 'issued' AND d.doc_type IN ('tax', 'nontax') AND d.issue_date >= m0),
        'ramis_failed', (SELECT count(*) FROM public.vi_ramis_submissions q WHERE q.client_id = c.id AND q.status IN ('failed', 'rejected')),
        'ramis_pending', (SELECT count(*) FROM public.vi_ramis_submissions q WHERE q.client_id = c.id AND q.status IN ('pending_config', 'queued', 'retrying', 'submitting', 'submitted')),
        'unpaid_addon_invoices', (SELECT count(*) FROM public.invoices i WHERE i.addon_id = a.id AND i.status IN ('unpaid', 'overdue') AND i.due_date < (now() AT TIME ZONE 'Asia/Colombo')::date),
        'members', (SELECT count(*) FROM public.vi_members m WHERE m.client_id = c.id AND m.active)) x
      FROM public.clients c
      LEFT JOIN LATERAL (SELECT * FROM public._vi_addon(c.id)) a ON TRUE
      LEFT JOIN public.vi_settings s ON s.client_id = c.id
      LEFT JOIN public.vi_ramis_config r ON r.client_id = c.id
      WHERE a.id IS NOT NULL OR s.client_id IS NOT NULL
         OR EXISTS (SELECT 1 FROM public.service_addons q WHERE q.client_id = c.id AND q.addon_key = 'vat_invoice')) t), '[]'::jsonb),
    'requests', coalesce((SELECT jsonb_agg(jsonb_build_object('id', q.id, 'client_id', q.client_id, 'name', c.full_name, 'cycle', q.billing_cycle, 'price', q.price,
                   'note', q.client_note, 'created_at', q.created_at) ORDER BY q.created_at)
                 FROM public.service_addons q JOIN public.clients c ON c.id = q.client_id WHERE q.addon_key = 'vat_invoice' AND q.status = 'requested'), '[]'::jsonb),
    'mrr', coalesce((SELECT sum(CASE WHEN billing_cycle = 'annual' THEN price / 12 ELSE price END) FROM public.service_addons WHERE addon_key = 'vat_invoice' AND status = 'active'), 0),
    'arr', coalesce((SELECT sum(CASE WHEN billing_cycle = 'annual' THEN price ELSE price * 12 END) FROM public.service_addons WHERE addon_key = 'vat_invoice' AND status = 'active'), 0),
    'renewals_30d', coalesce((SELECT jsonb_agg(jsonb_build_object('client_id', q.client_id, 'name', c.full_name, 'date', q.next_bill_date, 'cycle', q.billing_cycle, 'price', q.price) ORDER BY q.next_bill_date)
                 FROM public.service_addons q JOIN public.clients c ON c.id = q.client_id WHERE q.addon_key = 'vat_invoice' AND q.status = 'active'
                   AND q.next_bill_date BETWEEN (now() AT TIME ZONE 'Asia/Colombo')::date AND (now() AT TIME ZONE 'Asia/Colombo')::date + 30), '[]'::jsonb),
    'ramis', jsonb_build_object(
       'by_status', coalesce((SELECT jsonb_object_agg(status, n) FROM (SELECT status, count(*) n FROM public.vi_ramis_submissions GROUP BY status) z), '{}'::jsonb),
       'month', (SELECT count(*) FROM public.vi_ramis_submissions WHERE created_at >= m0),
       'recent_errors', coalesce((SELECT jsonb_agg(jsonb_build_object('id', q.id, 'client', c.full_name, 'doc_no', d.doc_no, 'status', q.status, 'error', q.error_message,
                                  'code', q.error_code, 'at', q.updated_at, 'attempts', q.attempts) ORDER BY q.updated_at DESC)
                 FROM (SELECT * FROM public.vi_ramis_submissions WHERE status IN ('failed', 'rejected', 'retrying') ORDER BY updated_at DESC LIMIT 50) q
                 JOIN public.clients c ON c.id = q.client_id JOIN public.vi_documents d ON d.id = q.doc_id), '[]'::jsonb)),
    'volume', jsonb_build_object(
       'docs_month', (SELECT count(*) FROM public.vi_documents WHERE status <> 'draft' AND issue_date >= m0),
       'docs_total', (SELECT count(*) FROM public.vi_documents WHERE status <> 'draft'),
       'sales_month', (SELECT coalesce(sum(total), 0) FROM public.vi_documents WHERE status = 'issued' AND doc_type IN ('tax', 'nontax') AND issue_date >= m0),
       'vat_month', (SELECT coalesce(sum(vat_total), 0) FROM public.vi_documents WHERE status = 'issued' AND doc_type = 'tax' AND issue_date >= m0)),
    'api', (SELECT value FROM public.app_settings WHERE key = 'vi_ramis_api'),
    'compliance', (SELECT value FROM public.app_settings WHERE key = 'vi_compliance'));
END $$;
REVOKE ALL ON FUNCTION public.admin_vi_overview() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_vi_overview() TO authenticated;

CREATE OR REPLACE FUNCTION public.admin_vi_ramis_log(p_sub UUID) RETURNS JSONB
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NOT public.is_admin() THEN RAISE EXCEPTION 'Admins only'; END IF;
  RETURN coalesce((SELECT jsonb_agg(to_jsonb(l) ORDER BY l.id) FROM public.vi_ramis_log l WHERE l.submission_id = p_sub), '[]'::jsonb);
END $$;
REVOKE ALL ON FUNCTION public.admin_vi_ramis_log(UUID) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_vi_ramis_log(UUID) TO authenticated;

-- ═══ 24. Daily job: trials, renewals, overdue notices ═════════════════════════
CREATE OR REPLACE FUNCTION public._vi_daily() RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE t DATE := (now() AT TIME ZONE 'Asia/Colombo')::date; r RECORD; n_exp INT := 0; n_od INT := 0; grace INT;
BEGIN
  grace := coalesce(nullif((SELECT value->>'past_due_days' FROM public.app_settings WHERE key = 'vi_policy'), '')::int, 7);
  -- trials
  FOR r IN SELECT * FROM public.service_addons WHERE addon_key = 'vat_invoice' AND status = 'trial' AND trial_ends = t + 3 LOOP
    PERFORM public._vi_notify(r.client_id, 'VAT Invoice trial ends in 3 days', 'Choose monthly or annual in My Plan to keep creating invoices.', '/client/plan');
  END LOOP;
  UPDATE public.service_addons SET status = 'expired', updated_at = NOW() WHERE addon_key = 'vat_invoice' AND status = 'trial' AND trial_ends < t;
  GET DIAGNOSTICS n_exp = ROW_COUNT;
  -- renewals coming up
  FOR r IN SELECT * FROM public.service_addons WHERE addon_key = 'vat_invoice' AND status = 'active' AND auto_invoice
             AND next_bill_date = t + CASE WHEN billing_cycle = 'annual' THEN 14 ELSE 3 END LOOP
    PERFORM public._vi_notify(r.client_id, 'VAT Invoice renews on ' || to_char(r.next_bill_date, 'DD Mon YYYY'),
      _rs(r.price) || CASE WHEN r.billing_cycle = 'annual' THEN ' for the year' ELSE ' for the month' END || '.', '/client/plan');
  END LOOP;
  -- add-on invoice overdue → past due notice (once, on the day it becomes past due)
  FOR r IN SELECT a.client_id, i.invoice_no FROM public.service_addons a JOIN public.invoices i ON i.addon_id = a.id
            WHERE a.addon_key = 'vat_invoice' AND a.status = 'active' AND i.status IN ('unpaid', 'overdue') AND i.due_date = t - grace - 1 LOOP
    PERFORM public._vi_notify(r.client_id, 'VAT Invoice payment overdue', 'Invoice ' || r.invoice_no || ' is not paid yet. Please pay to keep using VAT Invoice without interruption.', '/client/invoices');
  END LOOP;
  -- the business's own invoices that became overdue: one notice per business per day
  FOR r IN SELECT client_id, count(*) n, sum(balance) amt, array_agg(id) ids FROM public.vi_documents
            WHERE status = 'issued' AND doc_type IN ('tax', 'nontax') AND balance > 0 AND due_date < t AND overdue_notified IS NULL GROUP BY client_id LOOP
    PERFORM public._vi_notify(r.client_id, r.n || ' invoice' || CASE WHEN r.n > 1 THEN 's are' ELSE ' is' END || ' overdue',
      _rs(r.amt) || ' outstanding. Send a reminder from VAT Invoice → Invoices.', '/client/vat?v=docs&f=overdue');
    UPDATE public.vi_documents SET overdue_notified = t WHERE id = ANY (r.ids);
    n_od := n_od + r.n;
  END LOOP;
  RETURN jsonb_build_object('trials_expired', n_exp, 'overdue_flagged', n_od);
END $$;
REVOKE ALL ON FUNCTION public._vi_daily() FROM PUBLIC, anon, authenticated;

-- ═══ 25. Files (payment slips, purchase invoices) ═════════════════════════════
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES ('vat-files', 'vat-files', false, 5242880, ARRAY['application/pdf', 'image/jpeg', 'image/png', 'image/webp'])
ON CONFLICT (id) DO NOTHING;

CREATE OR REPLACE FUNCTION public._vi_file_client(p_name TEXT) RETURNS UUID LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE f TEXT := split_part(p_name, '/', 1);
BEGIN
  IF f !~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' THEN RETURN NULL; END IF;
  RETURN f::uuid;
END $$;
REVOKE ALL ON FUNCTION public._vi_file_client(TEXT) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public._vi_file_client(TEXT) TO authenticated;

DO $$ BEGIN
  IF to_regclass('storage.objects') IS NOT NULL THEN
    EXECUTE 'DROP POLICY IF EXISTS "vat-files read" ON storage.objects';
    EXECUTE $p$CREATE POLICY "vat-files read" ON storage.objects FOR SELECT TO authenticated
      USING (bucket_id = 'vat-files' AND public._vi_can(public._vi_file_client(name), 'view'))$p$;
    EXECUTE 'DROP POLICY IF EXISTS "vat-files add" ON storage.objects';
    EXECUTE $p$CREATE POLICY "vat-files add" ON storage.objects FOR INSERT TO authenticated
      WITH CHECK (bucket_id = 'vat-files' AND split_part(name, '/', 2) IN ('payments', 'purchases')
                  AND (public._vi_can(public._vi_file_client(name), 'payment') OR public._vi_can(public._vi_file_client(name), 'purchases')))$p$;
  END IF;
END $$;

-- ═══ 26. Grants for the vatinvoice Edge Function + scheduled jobs ═══════════════
DO $$ BEGIN
  GRANT EXECUTE ON FUNCTION public._vi_ramis_claim(INT) TO service_role;
  GRANT EXECUTE ON FUNCTION public._vi_ramis_login(UUID) TO service_role;
  GRANT EXECUTE ON FUNCTION public._vi_ramis_result(UUID, TEXT, INT, TEXT, TEXT, TEXT, TEXT, JSONB) TO service_role;
  GRANT EXECUTE ON FUNCTION public._vi_due_reminders(INT) TO service_role;
  GRANT EXECUTE ON FUNCTION public._vi_reminder_done(UUID, TEXT, TEXT, TEXT, TEXT, BOOLEAN, TEXT, BOOLEAN, UUID) TO service_role;
EXCEPTION WHEN undefined_object THEN NULL; END $$;

DO $$
BEGIN
  PERFORM cron.unschedule(jobid) FROM cron.job WHERE jobname IN ('taxmate-vat-daily', 'taxmate-vat-worker', 'taxmate-vat-reminders');
  PERFORM cron.schedule('taxmate-vat-daily', '13 3 * * *', 'SELECT public._vi_daily();');     -- 08:43 Sri Lanka time
  PERFORM cron.schedule('taxmate-vat-worker', '*/10 * * * *', $job$
    SELECT net.http_post(
      url := 'https://qipehxixvulvrubjifvi.supabase.co/functions/v1/vatinvoice',
      headers := jsonb_build_object('Content-Type', 'application/json',
                   'Authorization', 'Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InFpcGVoeGl4dnVsdnJ1YmppZnZpIiwicm9sZSI6ImFub24iLCJpYXQiOjE3OTE5MTE3NTUsImV4cCI6MjEwNzQ4Nzc1NX0.52tQGPTJTBVAsH7QPeyRNRBbrYCYbi9lDSfaoPSWlu4',
                   'x-cron-key', (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'taxmate_cron_key' LIMIT 1)),
      body := '{"action":"ramis_cron"}'::jsonb, timeout_milliseconds := 30000)
    WHERE EXISTS (SELECT 1 FROM public.vi_ramis_submissions WHERE status IN ('queued', 'retrying', 'submitted') AND next_attempt_at <= NOW());
  $job$);
  PERFORM cron.schedule('taxmate-vat-reminders', '41 3 * * *', $job$                       -- 09:11 Sri Lanka time
    SELECT net.http_post(
      url := 'https://qipehxixvulvrubjifvi.supabase.co/functions/v1/vatinvoice',
      headers := jsonb_build_object('Content-Type', 'application/json',
                   'Authorization', 'Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InFpcGVoeGl4dnVsdnJ1YmppZnZpIiwicm9sZSI6ImFub24iLCJpYXQiOjE3OTE5MTE3NTUsImV4cCI6MjEwNzQ4Nzc1NX0.52tQGPTJTBVAsH7QPeyRNRBbrYCYbi9lDSfaoPSWlu4',
                   'x-cron-key', (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'taxmate_cron_key' LIMIT 1)),
      body := '{"action":"reminders_cron"}'::jsonb, timeout_milliseconds := 30000);
  $job$);
END $$;

DROP FUNCTION IF EXISTS public.vi_document_print(UUID);

-- ═══ 27. Check ════════════════════════════════════════════════════════════════
SELECT (SELECT count(*) FROM pg_tables WHERE schemaname = 'public' AND tablename LIKE 'vi\_%') AS vat_tables,
       (SELECT count(*) FROM public.vi_tax_rates) AS tax_rates,
       (SELECT count(*) FROM public.vi_schedule_map) AS schedules,
       (SELECT count(*) FROM cron.job WHERE jobname LIKE 'taxmate-vat-%') AS jobs,
       EXISTS (SELECT 1 FROM public.app_settings s, jsonb_array_elements(s.value->'addons') a WHERE s.key = 'addons' AND a->>'key' = 'vat_invoice') AS addon_in_catalog;
