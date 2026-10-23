-- ═══════════════════════════════════════════════════════════
--  TaxMate V33 — Online payments (PayHere + bank slip), Income & Tax
--  summary letters, service requests / booking, public calculator link
-- ═══════════════════════════════════════════════════════════

-- 0. Public registration link used by the free calculator page (/join/calc)
INSERT INTO public.client_registrations (multi_use, code, label, expires_at, created_by)
SELECT TRUE, 'calc', 'Tax calculator', '2100-01-01', (SELECT id FROM public.profiles WHERE role = 'admin' ORDER BY created_at LIMIT 1)
WHERE NOT EXISTS (SELECT 1 FROM public.client_registrations WHERE code = 'calc');

-- 1. Settings: payments (PayHere on/off, bank transfer on/off, note)
INSERT INTO public.app_settings (key, value) VALUES ('payments', '{"payhere": false, "bank": true, "bank_note": ""}'::jsonb)
ON CONFLICT (key) DO NOTHING;
UPDATE public.app_settings SET value = jsonb_build_object('services', true, 'summary_letters', true) || coalesce(value, '{}'::jsonb)
WHERE key = 'client_tools';

-- ═══ 2. Payments ═══════════════════════════════════════════
CREATE TABLE IF NOT EXISTS public.payments (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  invoice_id    UUID NOT NULL REFERENCES public.invoices(id) ON DELETE CASCADE,
  client_id     UUID REFERENCES public.clients(id) ON DELETE CASCADE,
  method        TEXT NOT NULL CHECK (method IN ('payhere', 'bank')),
  amount        NUMERIC(14,2) NOT NULL CHECK (amount > 0),
  currency      TEXT NOT NULL DEFAULT 'LKR',
  status        TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'review', 'paid', 'failed', 'cancelled', 'rejected', 'chargedback')),
  order_id      TEXT UNIQUE,                -- PayHere order id
  gateway_ref   TEXT,                       -- PayHere payment id
  status_code   INT,
  card          TEXT,                       -- e.g. VISA ····1234 / eZ Cash
  slip_path     TEXT,                       -- bank slip in storage "payment-slips"
  reference     TEXT,                       -- bank reference typed by the client
  paid_on       DATE,
  note          TEXT CHECK (note IS NULL OR length(note) <= 500),
  admin_note    TEXT,
  raw           JSONB,
  created_by    UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  confirmed_by  UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  confirmed_at  TIMESTAMPTZ,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS payments_invoice_idx ON public.payments (invoice_id);
CREATE INDEX IF NOT EXISTS payments_review_idx ON public.payments (created_at) WHERE status = 'review';
ALTER TABLE public.payments ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Admins manage payments" ON public.payments;
CREATE POLICY "Admins manage payments" ON public.payments FOR ALL USING (is_admin()) WITH CHECK (is_admin());
DROP POLICY IF EXISTS "Clients read own payments" ON public.payments;
CREATE POLICY "Clients read own payments" ON public.payments FOR SELECT USING (client_id = my_client_id());

-- Mark an invoice paid (used by PayHere notify via service role, and by admin confirm)
CREATE OR REPLACE FUNCTION public._settle_invoice(p_invoice UUID, p_date DATE)
RETURNS VOID LANGUAGE sql SECURITY DEFINER SET search_path = public AS $$
  UPDATE public.invoices SET status = 'paid', paid_date = coalesce(paid_date, p_date) WHERE id = p_invoice AND status <> 'paid';
$$;
REVOKE ALL ON FUNCTION public._settle_invoice(UUID, DATE) FROM PUBLIC, anon, authenticated;

-- Client: bank transfer — tell TaxMate (with slip) that I paid
CREATE OR REPLACE FUNCTION public.submit_bank_payment(p_invoice UUID, p_amount NUMERIC, p_reference TEXT, p_paid_on DATE, p_slip_path TEXT, p_note TEXT)
RETURNS UUID LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE cid UUID := my_client_id(); inv public.invoices; pid UUID;
BEGIN
  IF cid IS NULL THEN RAISE EXCEPTION 'Please sign in again.'; END IF;
  IF NOT coalesce((SELECT (value->>'bank')::boolean FROM public.app_settings WHERE key = 'payments'), true) THEN RAISE EXCEPTION 'Bank transfer is not available right now.'; END IF;
  SELECT * INTO inv FROM public.invoices WHERE id = p_invoice AND client_id = cid AND status IN ('unpaid', 'overdue');
  IF inv.id IS NULL THEN RAISE EXCEPTION 'This invoice cannot be paid (already paid or not found).'; END IF;
  IF p_amount IS NULL OR p_amount <= 0 OR p_amount > inv.total_amount * 1.01 THEN RAISE EXCEPTION 'Please check the amount.'; END IF;
  IF p_slip_path IS NULL OR split_part(p_slip_path, '/', 1) <> cid::text THEN RAISE EXCEPTION 'Please attach the payment slip.'; END IF;
  IF p_paid_on IS NOT NULL AND (p_paid_on > CURRENT_DATE + 1 OR p_paid_on < CURRENT_DATE - 365) THEN RAISE EXCEPTION 'Please check the payment date.'; END IF;
  IF (SELECT count(*) FROM public.payments WHERE client_id = cid AND created_at > NOW() - INTERVAL '1 day') >= 20 THEN RAISE EXCEPTION 'Too many attempts today. Please WhatsApp TaxMate.'; END IF;
  INSERT INTO public.payments (invoice_id, client_id, method, amount, status, slip_path, reference, paid_on, note, created_by)
  VALUES (inv.id, cid, 'bank', round(p_amount, 2), 'review', p_slip_path, left(trim(p_reference), 80), p_paid_on, nullif(left(trim(p_note), 500), ''), auth.uid())
  RETURNING id INTO pid;
  RETURN pid;
END $$;
REVOKE ALL ON FUNCTION public.submit_bank_payment(UUID, NUMERIC, TEXT, DATE, TEXT, TEXT) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.submit_bank_payment(UUID, NUMERIC, TEXT, DATE, TEXT, TEXT) TO authenticated;

-- Admin: confirm or reject a bank slip
CREATE OR REPLACE FUNCTION public.admin_review_payment(p_payment UUID, p_ok BOOLEAN, p_note TEXT)
RETURNS VOID LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE p public.payments;
BEGIN
  IF NOT is_admin() THEN RAISE EXCEPTION 'Admins only'; END IF;
  SELECT * INTO p FROM public.payments WHERE id = p_payment FOR UPDATE;
  IF p.id IS NULL THEN RAISE EXCEPTION 'Payment not found'; END IF;
  UPDATE public.payments SET status = CASE WHEN p_ok THEN 'paid' ELSE 'rejected' END, admin_note = nullif(trim(p_note), ''),
    confirmed_by = auth.uid(), confirmed_at = NOW(), updated_at = NOW() WHERE id = p.id;
  IF p_ok THEN PERFORM public._settle_invoice(p.invoice_id, coalesce(p.paid_on, CURRENT_DATE)); END IF;
END $$;
REVOKE ALL ON FUNCTION public.admin_review_payment(UUID, BOOLEAN, TEXT) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_review_payment(UUID, BOOLEAN, TEXT) TO authenticated;

-- Client portal: payment options + bank accounts
CREATE OR REPLACE FUNCTION public.my_payment_options()
RETURNS JSONB LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT jsonb_build_object(
    'payhere', coalesce((SELECT (value->>'payhere')::boolean FROM public.app_settings WHERE key = 'payments'), false),
    'bank', coalesce((SELECT (value->>'bank')::boolean FROM public.app_settings WHERE key = 'payments'), true),
    'bank_note', coalesce((SELECT value->>'bank_note' FROM public.app_settings WHERE key = 'payments'), ''),
    'accounts', (SELECT coalesce(jsonb_agg(jsonb_build_object('bank_name', bank_name, 'account_name', account_name, 'account_no', account_no, 'branch', branch) ORDER BY is_default DESC, created_at), '[]'::jsonb) FROM public.bank_accounts))
  WHERE my_client_id() IS NOT NULL;
$$;
REVOKE ALL ON FUNCTION public.my_payment_options() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.my_payment_options() TO authenticated;

-- Private bucket for bank slips:  <client_id>/<random>-slip.jpg
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES ('payment-slips', 'payment-slips', FALSE, 5242880, ARRAY['image/jpeg', 'image/png', 'image/webp', 'application/pdf'])
ON CONFLICT (id) DO UPDATE SET public = FALSE, file_size_limit = EXCLUDED.file_size_limit, allowed_mime_types = EXCLUDED.allowed_mime_types;
DROP POLICY IF EXISTS "payment-slips admin all" ON storage.objects;
CREATE POLICY "payment-slips admin all" ON storage.objects FOR ALL TO authenticated
  USING (bucket_id = 'payment-slips' AND public.is_admin()) WITH CHECK (bucket_id = 'payment-slips' AND public.is_admin());
DROP POLICY IF EXISTS "payment-slips client upload" ON storage.objects;
CREATE POLICY "payment-slips client upload" ON storage.objects FOR INSERT TO authenticated
  WITH CHECK (bucket_id = 'payment-slips' AND (storage.foldername(name))[1] = public.my_client_id()::text);
DROP POLICY IF EXISTS "payment-slips client read" ON storage.objects;
CREATE POLICY "payment-slips client read" ON storage.objects FOR SELECT TO authenticated
  USING (bucket_id = 'payment-slips' AND (storage.foldername(name))[1] = public.my_client_id()::text);

-- ═══ 3. Income & Tax summary letters ═══════════════════════
CREATE TABLE IF NOT EXISTS public.summary_letters (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id    UUID NOT NULL REFERENCES public.clients(id) ON DELETE CASCADE,
  year         TEXT NOT NULL CHECK (year ~ '^\d{4}/\d{2}$'),
  purpose      TEXT NOT NULL DEFAULT 'visa' CHECK (purpose IN ('visa', 'bank_loan', 'employment', 'other')),
  addressed_to TEXT CHECK (addressed_to IS NULL OR length(addressed_to) <= 200),
  client_note  TEXT CHECK (client_note IS NULL OR length(client_note) <= 500),
  status       TEXT NOT NULL DEFAULT 'requested' CHECK (status IN ('requested', 'issued', 'rejected', 'cancelled')),
  calc_id      UUID REFERENCES public.iit_calculations(id) ON DELETE SET NULL,
  fee          NUMERIC(12,2) NOT NULL DEFAULT 0,
  invoice_id   UUID REFERENCES public.invoices(id) ON DELETE SET NULL,
  ref          TEXT UNIQUE,
  admin_note   TEXT,
  requested_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  issued_by    UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  issued_at    TIMESTAMPTZ,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS summary_letters_client_idx ON public.summary_letters (client_id, created_at DESC);
ALTER TABLE public.summary_letters ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Admins manage letters" ON public.summary_letters;
CREATE POLICY "Admins manage letters" ON public.summary_letters FOR ALL USING (is_admin()) WITH CHECK (is_admin());
DROP POLICY IF EXISTS "Clients read own letters" ON public.summary_letters;
CREATE POLICY "Clients read own letters" ON public.summary_letters FOR SELECT USING (client_id = my_client_id());

-- The letter content (figures, signature) — admin-only table; clients get it through my_summary_letter()
CREATE TABLE IF NOT EXISTS public.summary_letter_data (
  letter_id UUID PRIMARY KEY REFERENCES public.summary_letters(id) ON DELETE CASCADE,
  data      JSONB NOT NULL
);
ALTER TABLE public.summary_letter_data ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Admins manage letter data" ON public.summary_letter_data;
CREATE POLICY "Admins manage letter data" ON public.summary_letter_data FOR ALL USING (is_admin()) WITH CHECK (is_admin());

CREATE OR REPLACE FUNCTION public.request_summary_letter(p_year TEXT, p_purpose TEXT, p_addressed_to TEXT, p_note TEXT)
RETURNS UUID LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE cid UUID := my_client_id(); lid UUID;
BEGIN
  IF cid IS NULL THEN RAISE EXCEPTION 'Please sign in again.'; END IF;
  IF NOT _feature_on(cid, 'summary_letters') THEN RAISE EXCEPTION 'Letters are not available right now.'; END IF;
  IF (SELECT count(*) FROM public.summary_letters WHERE client_id = cid AND status = 'requested') >= 3 THEN RAISE EXCEPTION 'You already have requests waiting — TaxMate will contact you soon.'; END IF;
  INSERT INTO public.summary_letters (client_id, year, purpose, addressed_to, client_note, requested_by)
  VALUES (cid, p_year, coalesce(p_purpose, 'visa'), nullif(left(trim(p_addressed_to), 200), ''), nullif(left(trim(p_note), 500), ''), auth.uid())
  RETURNING id INTO lid;
  RETURN lid;
END $$;
REVOKE ALL ON FUNCTION public.request_summary_letter(TEXT, TEXT, TEXT, TEXT) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.request_summary_letter(TEXT, TEXT, TEXT, TEXT) TO authenticated;

CREATE OR REPLACE FUNCTION public.cancel_my_summary_letter(p_id UUID)
RETURNS VOID LANGUAGE sql SECURITY DEFINER SET search_path = public AS $$
  UPDATE public.summary_letters SET status = 'cancelled' WHERE id = p_id AND client_id = my_client_id() AND status = 'requested';
$$;
REVOKE ALL ON FUNCTION public.cancel_my_summary_letter(UUID) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.cancel_my_summary_letter(UUID) TO authenticated;

-- Client download: only once issued, and paid when there is a fee
CREATE OR REPLACE FUNCTION public.my_summary_letter(p_id UUID)
RETURNS JSONB LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE l public.summary_letters;
BEGIN
  SELECT * INTO l FROM public.summary_letters WHERE id = p_id AND client_id = my_client_id();
  IF l.id IS NULL OR l.status <> 'issued' THEN RAISE EXCEPTION 'This letter is not ready yet.'; END IF;
  IF l.invoice_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM public.invoices WHERE id = l.invoice_id AND status = 'paid') THEN
    RAISE EXCEPTION 'Please pay the invoice for this letter first.';
  END IF;
  RETURN (SELECT data FROM public.summary_letter_data WHERE letter_id = l.id) || jsonb_build_object('ref', l.ref, 'issued_at', l.issued_at, 'purpose', l.purpose, 'addressed_to', l.addressed_to, 'year', l.year);
END $$;
REVOKE ALL ON FUNCTION public.my_summary_letter(UUID) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.my_summary_letter(UUID) TO authenticated;

-- Admin issues a letter (figures snapshot built by the app from the FINAL computation)
CREATE OR REPLACE FUNCTION public.admin_issue_summary_letter(p_id UUID, p_calc UUID, p_data JSONB, p_fee NUMERIC, p_invoice UUID)
RETURNS TEXT LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE r TEXT; tries INT := 0;
BEGIN
  IF NOT is_admin() THEN RAISE EXCEPTION 'Admins only'; END IF;
  IF p_data IS NULL OR NOT (p_data ? 'income') THEN RAISE EXCEPTION 'Letter figures missing'; END IF;
  SELECT ref INTO r FROM public.summary_letters WHERE id = p_id;
  IF r IS NULL THEN
    LOOP
      r := 'TM' || upper(substr(md5(gen_random_uuid()::text), 1, 10));
      EXIT WHEN NOT EXISTS (SELECT 1 FROM public.summary_letters WHERE ref = r);
      tries := tries + 1; IF tries > 10 THEN RAISE EXCEPTION 'Please try again.'; END IF;
    END LOOP;
  END IF;
  UPDATE public.summary_letters SET status = 'issued', calc_id = p_calc, fee = coalesce(p_fee, 0), invoice_id = p_invoice,
    ref = r, issued_by = auth.uid(), issued_at = NOW() WHERE id = p_id;
  INSERT INTO public.summary_letter_data (letter_id, data) VALUES (p_id, p_data)
  ON CONFLICT (letter_id) DO UPDATE SET data = EXCLUDED.data;
  RETURN r;
END $$;
REVOKE ALL ON FUNCTION public.admin_issue_summary_letter(UUID, UUID, JSONB, NUMERIC, UUID) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_issue_summary_letter(UUID, UUID, JSONB, NUMERIC, UUID) TO authenticated;

-- Public verification (/verify/<ref>): masked name + headline figures only
CREATE OR REPLACE FUNCTION public.verify_summary_letter(p_ref TEXT)
RETURNS JSONB LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE l public.summary_letters; d JSONB; nm TEXT;
BEGIN
  SELECT * INTO l FROM public.summary_letters WHERE ref = upper(trim(p_ref)) AND status = 'issued';
  IF l.id IS NULL THEN RETURN jsonb_build_object('valid', false); END IF;
  SELECT data INTO d FROM public.summary_letter_data WHERE letter_id = l.id;
  SELECT string_agg(left(w, 1) || repeat('•', greatest(length(w) - 2, 1)) || right(w, 1), ' ') INTO nm
    FROM unnest(string_to_array(trim(coalesce(d->'client'->>'name', '')), ' ')) w WHERE w <> '';
  RETURN jsonb_build_object('valid', true, 'ref', l.ref, 'name', nm, 'year', l.year, 'issued_at', l.issued_at, 'purpose', l.purpose,
    'total_income', d->'totals'->'income', 'tax', d->'totals'->'tax', 'filed', d->'filed');
END $$;
REVOKE ALL ON FUNCTION public.verify_summary_letter(TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.verify_summary_letter(TEXT) TO anon, authenticated;

-- ═══ 4. Service requests / booking ═════════════════════════
CREATE TABLE IF NOT EXISTS public.service_requests (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id      UUID NOT NULL REFERENCES public.clients(id) ON DELETE CASCADE,
  service        TEXT NOT NULL CHECK (length(service) BETWEEN 2 AND 80),
  details        TEXT CHECK (details IS NULL OR length(details) <= 1000),
  preferred_date DATE,
  preferred_time TEXT CHECK (preferred_time IS NULL OR preferred_time IN ('morning', 'afternoon', 'evening', 'any')),
  contact_method TEXT NOT NULL DEFAULT 'whatsapp' CHECK (contact_method IN ('whatsapp', 'call', 'office', 'online')),
  status         TEXT NOT NULL DEFAULT 'new' CHECK (status IN ('new', 'contacted', 'scheduled', 'in_progress', 'done', 'cancelled')),
  scheduled_at   TIMESTAMPTZ,
  admin_note     TEXT CHECK (admin_note IS NULL OR length(admin_note) <= 1000),
  created_by     UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at     TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS service_requests_status_idx ON public.service_requests (status, created_at DESC);
ALTER TABLE public.service_requests ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Admins manage service requests" ON public.service_requests;
CREATE POLICY "Admins manage service requests" ON public.service_requests FOR ALL USING (is_admin()) WITH CHECK (is_admin());
DROP POLICY IF EXISTS "Clients read own service requests" ON public.service_requests;
CREATE POLICY "Clients read own service requests" ON public.service_requests FOR SELECT USING (client_id = my_client_id());

CREATE OR REPLACE FUNCTION public.request_service(p_service TEXT, p_details TEXT, p_date DATE, p_time TEXT, p_contact TEXT)
RETURNS UUID LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE cid UUID := my_client_id(); rid UUID;
BEGIN
  IF cid IS NULL THEN RAISE EXCEPTION 'Please sign in again.'; END IF;
  IF NOT _feature_on(cid, 'services') THEN RAISE EXCEPTION 'Requests are not available right now.'; END IF;
  IF p_date IS NOT NULL AND (p_date < CURRENT_DATE OR p_date > CURRENT_DATE + 180) THEN RAISE EXCEPTION 'Please pick a date within the next 6 months.'; END IF;
  IF (SELECT count(*) FROM public.service_requests WHERE client_id = cid AND created_at > NOW() - INTERVAL '1 day') >= 10 THEN RAISE EXCEPTION 'Too many requests today. Please WhatsApp TaxMate.'; END IF;
  INSERT INTO public.service_requests (client_id, service, details, preferred_date, preferred_time, contact_method, created_by)
  VALUES (cid, left(trim(p_service), 80), nullif(left(trim(p_details), 1000), ''), p_date, coalesce(p_time, 'any'), coalesce(p_contact, 'whatsapp'), auth.uid())
  RETURNING id INTO rid;
  RETURN rid;
END $$;
REVOKE ALL ON FUNCTION public.request_service(TEXT, TEXT, DATE, TEXT, TEXT) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.request_service(TEXT, TEXT, DATE, TEXT, TEXT) TO authenticated;

CREATE OR REPLACE FUNCTION public.cancel_my_service_request(p_id UUID)
RETURNS VOID LANGUAGE sql SECURITY DEFINER SET search_path = public AS $$
  UPDATE public.service_requests SET status = 'cancelled', updated_at = NOW()
  WHERE id = p_id AND client_id = my_client_id() AND status IN ('new', 'contacted', 'scheduled');
$$;
REVOKE ALL ON FUNCTION public.cancel_my_service_request(UUID) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.cancel_my_service_request(UUID) TO authenticated;

-- ═══ 5. Portal features: services + letters + payment options flag ═══
CREATE OR REPLACE FUNCTION public.my_portal_features()
RETURNS JSONB LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE cid UUID := my_client_id(); n INT;
BEGIN
  SELECT count(*) INTO n FROM public.income_sheets WHERE client_id = cid AND enabled;
  RETURN jsonb_build_object(
    'tax_calculator', _feature_on(cid, 'tax_calculator'),
    'tax_calendar',   _feature_on(cid, 'tax_calendar'),
    'reminders',      _feature_on(cid, 'reminders'),
    'referrals',      _feature_on(cid, 'referrals'),
    'documents',      _feature_on(cid, 'documents'),
    'return_tracker', _feature_on(cid, 'return_tracker'),
    'messages',       _feature_on(cid, 'messages'),
    'services',       _feature_on(cid, 'services'),
    'summary_letters', _feature_on(cid, 'summary_letters'),
    'referral_reward', coalesce((SELECT value->>'referral_reward' FROM public.app_settings WHERE key = 'client_tools'), ''),
    'income_sheets', coalesce(n, 0));
END $$;
REVOKE ALL ON FUNCTION public.my_portal_features() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.my_portal_features() TO authenticated;
