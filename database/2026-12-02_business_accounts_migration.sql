-- ════════════════════════════════════════════════════════════════════════════
-- V76 — Business income computation: sole proprietor & partnership
--   • business_accounts: one per business per Y/A. TaxMate creates it; the client fills the
--     income, cost of sales, expenses (own lines allowed), assets and partners — annual totals
--     or month by month — and submits. TaxMate adjusts, finalises and sends the result to the
--     IIT return (Schedule 2; partners: cage 906 / 907 credits).
--   • business_account_office: TaxMate's adjustments (allowable %, capital allowance classes,
--     add-backs, loss b/f, partnership credits, partner ↔ client links). Staff only.
--   • my_portal_features() adds 'business_accounts' (menu shows when the client has one).
-- Safe to run more than once.
-- ════════════════════════════════════════════════════════════════════════════

-- ═══ 1. Accounts ════════════════════════════════════════════
CREATE TABLE IF NOT EXISTS public.business_accounts (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id     UUID NOT NULL REFERENCES public.clients(id) ON DELETE CASCADE,
  year          TEXT NOT NULL CHECK (year ~ '^\d{4}/\d{2}$'),
  kind          TEXT NOT NULL DEFAULT 'sole' CHECK (kind IN ('sole', 'partnership')),
  name          TEXT NOT NULL CHECK (length(trim(name)) BETWEEN 1 AND 160),
  tin           TEXT CHECK (tin IS NULL OR length(tin) <= 30),
  activity_code TEXT CHECK (activity_code IS NULL OR length(activity_code) <= 20),
  mode          TEXT NOT NULL DEFAULT 'annual' CHECK (mode IN ('annual', 'monthly')),
  data          JSONB NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(data) = 'object' AND octet_length(data::text) <= 300000),
  status        TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'submitted', 'final')),
  result        JSONB CHECK (result IS NULL OR octet_length(result::text) <= 100000),
  client_note   TEXT CHECK (client_note IS NULL OR length(client_note) <= 2000),
  created_by    UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  submitted_at  TIMESTAMPTZ,
  finalized_at  TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS business_accounts_client_idx ON public.business_accounts (client_id, year);
CREATE INDEX IF NOT EXISTS business_accounts_final_idx ON public.business_accounts (year) WHERE status = 'final';

ALTER TABLE public.business_accounts ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Staff manage business accounts" ON public.business_accounts;
CREATE POLICY "Staff manage business accounts" ON public.business_accounts FOR ALL USING (public.is_admin()) WITH CHECK (public.is_admin());
DROP POLICY IF EXISTS "Clients read own business accounts" ON public.business_accounts;
CREATE POLICY "Clients read own business accounts" ON public.business_accounts FOR SELECT USING (client_id = public.my_client_id());
DROP POLICY IF EXISTS "Clients fill own open business accounts" ON public.business_accounts;
CREATE POLICY "Clients fill own open business accounts" ON public.business_accounts FOR UPDATE
  USING (client_id = public.my_client_id() AND status = 'open') WITH CHECK (client_id = public.my_client_id());
REVOKE ALL ON public.business_accounts FROM anon;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.business_accounts TO authenticated;

-- Clients may change only their entries; open → submitted is the only status move they can make.
-- (runs as the caller, so current_user is 'authenticated' for app users)
CREATE OR REPLACE FUNCTION public._business_account_trg() RETURNS TRIGGER LANGUAGE plpgsql SET search_path = public AS $$
BEGIN
  NEW.updated_at := NOW();
  IF TG_OP = 'INSERT' THEN
    NEW.created_by := coalesce(auth.uid(), NEW.created_by);
    NEW.name := trim(NEW.name);
    RETURN NEW;
  END IF;
  IF NOT public.is_admin() AND current_user IN ('authenticated', 'anon') THEN
    NEW.client_id := OLD.client_id; NEW.year := OLD.year; NEW.kind := OLD.kind; NEW.result := OLD.result;
    NEW.finalized_at := OLD.finalized_at; NEW.created_by := OLD.created_by; NEW.created_at := OLD.created_at;
    IF NEW.status NOT IN ('open', 'submitted') THEN NEW.status := OLD.status; END IF;
  END IF;
  IF NEW.status = 'submitted' AND OLD.status <> 'submitted' THEN NEW.submitted_at := NOW(); END IF;
  IF NEW.status = 'final' AND OLD.status <> 'final' THEN NEW.finalized_at := NOW(); END IF;
  IF NEW.status <> 'final' THEN NEW.finalized_at := NULL; END IF;
  NEW.name := trim(NEW.name);
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS trg_business_account ON public.business_accounts;
CREATE TRIGGER trg_business_account BEFORE INSERT OR UPDATE ON public.business_accounts FOR EACH ROW EXECUTE FUNCTION public._business_account_trg();

-- Notices: client submitted → TaxMate push; TaxMate finalised / reopened / created → client notification
CREATE OR REPLACE FUNCTION public._business_account_notify() RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE nm TEXT;
BEGIN
  SELECT full_name INTO nm FROM public.clients WHERE id = NEW.client_id;
  IF TG_OP = 'INSERT' THEN
    PERFORM public._notify_client(NEW.client_id, 'business', '🏪 Business accounts — Y/A ' || NEW.year,
      'Please fill in the income, expenses and assets of ' || NEW.name || ' for Y/A ' || NEW.year || '.', '/client/business');
    RETURN NEW;
  END IF;
  IF NEW.status = OLD.status THEN RETURN NEW; END IF;
  IF NEW.status = 'submitted' THEN
    PERFORM public._push_send('admin', NULL, '🏪 Business accounts submitted', coalesce(nm, 'Client') || ' · ' || NEW.name || ' · Y/A ' || NEW.year,
      '/admin/clients/' || NEW.client_id || '?tab=business', 'biz' || left(NEW.id::text, 8));
  ELSIF NEW.status = 'final' THEN
    PERFORM public._notify_client(NEW.client_id, 'business', '✅ Business income computed — ' || NEW.name,
      'TaxMate has finalised the Y/A ' || NEW.year || ' business income computation.', '/client/business');
  ELSIF NEW.status = 'open' AND OLD.status = 'submitted' THEN
    PERFORM public._notify_client(NEW.client_id, 'business', '✏️ Please check your business accounts — ' || NEW.name,
      'TaxMate re-opened the Y/A ' || NEW.year || ' business accounts for changes.', '/client/business');
  END IF;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS trg_business_account_notify ON public.business_accounts;
CREATE TRIGGER trg_business_account_notify AFTER INSERT OR UPDATE OF status ON public.business_accounts FOR EACH ROW EXECUTE FUNCTION public._business_account_notify();

-- ═══ 2. TaxMate's adjustments (staff only) ══════════════════
CREATE TABLE IF NOT EXISTS public.business_account_office (
  account_id UUID PRIMARY KEY REFERENCES public.business_accounts(id) ON DELETE CASCADE,
  client_id  UUID NOT NULL REFERENCES public.clients(id) ON DELETE CASCADE,
  data       JSONB NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(data) = 'object' AND octet_length(data::text) <= 150000),
  updated_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
ALTER TABLE public.business_account_office ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Staff manage business office" ON public.business_account_office;
CREATE POLICY "Staff manage business office" ON public.business_account_office FOR ALL USING (public.is_admin()) WITH CHECK (public.is_admin());
REVOKE ALL ON public.business_account_office FROM anon;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.business_account_office TO authenticated;

CREATE OR REPLACE FUNCTION public._business_office_trg() RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  NEW.updated_at := NOW();
  NEW.updated_by := coalesce(auth.uid(), NEW.updated_by);
  SELECT client_id INTO NEW.client_id FROM public.business_accounts WHERE id = NEW.account_id;   -- always the account's own client
  IF NEW.client_id IS NULL THEN RAISE EXCEPTION 'Business account not found'; END IF;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS trg_business_office ON public.business_account_office;
CREATE TRIGGER trg_business_office BEFORE INSERT OR UPDATE ON public.business_account_office FOR EACH ROW EXECUTE FUNCTION public._business_office_trg();

-- ═══ 3. Portal menu ═════════════════════════════════════════
CREATE OR REPLACE FUNCTION public.my_portal_features()
RETURNS JSONB LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE cid UUID := my_client_id(); n INT; nb INT;
BEGIN
  SELECT count(*) INTO n FROM public.income_sheets WHERE client_id = cid AND enabled;
  SELECT count(*) INTO nb FROM public.business_accounts WHERE client_id = cid;
  RETURN jsonb_build_object(
    'quick_tax',      _feature_on(cid, 'quick_tax'),
    'tax_calculator', _feature_on(cid, 'tax_calculator'),
    'tax_calendar',   _feature_on(cid, 'tax_calendar'),
    'ird_codes',      _feature_on(cid, 'ird_codes'),
    'activity_codes', _feature_on(cid, 'activity_codes'),
    'reminders',      _feature_on(cid, 'reminders'),
    'referrals',      _feature_on(cid, 'referrals'),
    'documents',      _feature_on(cid, 'documents'),
    'return_tracker', _feature_on(cid, 'return_tracker'),
    'messages',       _feature_on(cid, 'messages'),
    'services',       _feature_on(cid, 'services'),
    'summary_letters', _feature_on(cid, 'summary_letters'),
    'plans',          _feature_on(cid, 'plans'),
    'tax_reviews',    _feature_on(cid, 'tax_reviews'),
    'packages',       _feature_on(cid, 'packages'),
    'referral_reward', coalesce((SELECT value->>'referral_reward' FROM public.app_settings WHERE key = 'client_tools'), ''),
    'income_sheets', coalesce(n, 0),
    'business_accounts', coalesce(nb, 0));
END $$;
REVOKE ALL ON FUNCTION public.my_portal_features() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.my_portal_features() TO authenticated;

-- ═══ 4. Check ═══════════════════════════════════════════════
SELECT to_regclass('public.business_accounts') IS NOT NULL AS accounts_ok,
       to_regclass('public.business_account_office') IS NOT NULL AS office_ok,
       (SELECT relrowsecurity FROM pg_class WHERE oid = 'public.business_accounts'::regclass) AS rls_on,
       (public.my_portal_features() ? 'business_accounts') AS menu_ok;
