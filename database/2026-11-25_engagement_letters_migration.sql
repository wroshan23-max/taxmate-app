-- ════════════════════════════════════════════════════════════════════════════
-- V69 — Engagement letters signed online
--   TaxMate prepares a letter (services, fees, terms) → sends a secure link → the client
--   reads it, ticks the consents, types their name (+ optional drawn signature) and signs.
--   A signed letter can't be changed or deleted. Works without a portal login (/e/<token>).
--   Safe to run more than once.
-- ════════════════════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS public.engagement_letters (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id      UUID NOT NULL REFERENCES public.clients(id) ON DELETE CASCADE,
  letter_no      TEXT UNIQUE,
  title          TEXT NOT NULL DEFAULT 'Engagement letter' CHECK (length(title) BETWEEN 1 AND 150),
  content        JSONB NOT NULL DEFAULT '{}'::jsonb CHECK (octet_length(content::text) <= 400000),   -- services, sections, consents, firm snapshot
  status         TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'sent', 'signed', 'declined', 'withdrawn')),
  share_token    UUID UNIQUE,
  valid_until    DATE,
  sent_at        TIMESTAMPTZ,
  viewed_at      TIMESTAMPTZ,
  signed_at      TIMESTAMPTZ,
  signer_name    TEXT CHECK (signer_name IS NULL OR length(signer_name) BETWEEN 2 AND 120),
  signer_capacity TEXT CHECK (signer_capacity IS NULL OR length(signer_capacity) <= 120),
  signature      TEXT CHECK (signature IS NULL OR (signature LIKE 'data:image/png;base64,%' AND length(signature) <= 300000)),
  consents       JSONB,
  signer_agent   TEXT CHECK (signer_agent IS NULL OR length(signer_agent) <= 300),
  declined_at    TIMESTAMPTZ,
  decline_reason TEXT CHECK (decline_reason IS NULL OR length(decline_reason) <= 500),
  admin_note     TEXT CHECK (admin_note IS NULL OR length(admin_note) <= 500),
  created_by     UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at     TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS engagement_letters_client_idx ON public.engagement_letters (client_id, created_at DESC);

ALTER TABLE public.engagement_letters ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS engagement_admin ON public.engagement_letters;
CREATE POLICY engagement_admin ON public.engagement_letters FOR ALL TO authenticated USING (public.is_admin()) WITH CHECK (public.is_admin());
DROP POLICY IF EXISTS engagement_client_read ON public.engagement_letters;
CREATE POLICY engagement_client_read ON public.engagement_letters FOR SELECT TO authenticated
  USING (client_id = public.my_client_id() AND status IN ('sent', 'signed', 'declined'));
REVOKE ALL ON public.engagement_letters FROM anon;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.engagement_letters TO authenticated;

-- A signed letter is a record: nothing but the admin note may change, and it can't be deleted.
CREATE OR REPLACE FUNCTION public._engagement_guard() RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    IF OLD.status = 'signed' THEN RAISE EXCEPTION 'A signed engagement letter cannot be deleted.'; END IF;
    RETURN OLD;
  END IF;
  IF OLD.status = 'signed' THEN
    IF (to_jsonb(NEW) - 'admin_note' - 'updated_at') IS DISTINCT FROM (to_jsonb(OLD) - 'admin_note' - 'updated_at') THEN
      RAISE EXCEPTION 'A signed engagement letter cannot be changed. Send a new letter instead.';
    END IF;
  ELSIF OLD.status IN ('sent', 'declined', 'withdrawn') AND NEW.content IS DISTINCT FROM OLD.content THEN
    RAISE EXCEPTION 'This letter was already sent. Withdraw it and make a new one to change the text.';
  END IF;
  NEW.updated_at := NOW();
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS trg_engagement_guard ON public.engagement_letters;
CREATE TRIGGER trg_engagement_guard BEFORE UPDATE OR DELETE ON public.engagement_letters FOR EACH ROW EXECUTE FUNCTION public._engagement_guard();

-- Admin: send (draft → sent): number, secure link, client notice
CREATE OR REPLACE FUNCTION public.admin_engagement_send(p_id UUID) RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE l public.engagement_letters; yr TEXT := to_char(NOW() AT TIME ZONE 'Asia/Colombo', 'YYYY'); n INT; no TEXT; tok UUID;
BEGIN
  IF NOT public.is_admin() THEN RAISE EXCEPTION 'Not allowed.'; END IF;
  SELECT * INTO l FROM public.engagement_letters WHERE id = p_id FOR UPDATE;
  IF l.id IS NULL THEN RAISE EXCEPTION 'Letter not found.'; END IF;
  IF l.status = 'sent' THEN RETURN jsonb_build_object('token', l.share_token, 'letter_no', l.letter_no); END IF;
  IF l.status <> 'draft' THEN RAISE EXCEPTION 'Only a draft can be sent.'; END IF;
  IF jsonb_array_length(coalesce(l.content->'sections', '[]'::jsonb)) = 0 THEN RAISE EXCEPTION 'The letter has no text.'; END IF;
  PERFORM pg_advisory_xact_lock(hashtext('engagement_letter_no'));
  SELECT coalesce(max(substring(letter_no FROM '\d+$')::int), 0) + 1 INTO n FROM public.engagement_letters WHERE letter_no LIKE 'EL-' || yr || '-%';
  no := 'EL-' || yr || '-' || lpad(n::text, 4, '0');
  tok := gen_random_uuid();
  UPDATE public.engagement_letters SET status = 'sent', letter_no = no, share_token = tok, sent_at = NOW() WHERE id = p_id;
  PERFORM public._notify_client(l.client_id, 'todo', 'Please review and sign your engagement letter', l.title || ' — ' || no || '. It takes a minute.', '/client/engagement');
  RETURN jsonb_build_object('token', tok, 'letter_no', no);
END $$;
REVOKE ALL ON FUNCTION public.admin_engagement_send(UUID) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_engagement_send(UUID) TO authenticated;

-- Public (link): read the letter. Marks it viewed the first time.
CREATE OR REPLACE FUNCTION public.get_engagement(p_token UUID) RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE l public.engagement_letters; c public.clients;
BEGIN
  SELECT * INTO l FROM public.engagement_letters WHERE share_token = p_token AND status IN ('sent', 'signed', 'declined');
  IF l.id IS NULL THEN RETURN NULL; END IF;
  IF l.viewed_at IS NULL AND l.status = 'sent' AND NOT public.is_admin() THEN
    UPDATE public.engagement_letters SET viewed_at = NOW() WHERE id = l.id;
  END IF;
  SELECT * INTO c FROM public.clients WHERE id = l.client_id;
  RETURN jsonb_build_object(
    'letter_no', l.letter_no, 'title', l.title, 'content', l.content, 'status', l.status, 'valid_until', l.valid_until,
    'expired', l.status = 'sent' AND l.valid_until IS NOT NULL AND l.valid_until < (NOW() AT TIME ZONE 'Asia/Colombo')::date,
    'sent_at', l.sent_at, 'signed_at', l.signed_at, 'signer_name', l.signer_name, 'signer_capacity', l.signer_capacity, 'signature', l.signature, 'consents', l.consents,
    'declined_at', l.declined_at,
    'client', jsonb_build_object('full_name', c.full_name, 'client_no', c.client_no, 'tin', c.tin, 'nic', c.nic, 'address', c.address));
END $$;
REVOKE ALL ON FUNCTION public.get_engagement(UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_engagement(UUID) TO anon, authenticated;

-- Public (link): sign. All required consents must be ticked.
CREATE OR REPLACE FUNCTION public.sign_engagement(p_token UUID, p_name TEXT, p_capacity TEXT, p_signature TEXT, p_consents JSONB, p_agent TEXT) RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE l public.engagement_letters; k JSONB; nm TEXT := trim(coalesce(p_name, '')); cn TEXT;
BEGIN
  SELECT * INTO l FROM public.engagement_letters WHERE share_token = p_token FOR UPDATE;
  IF l.id IS NULL OR l.status NOT IN ('sent', 'signed') THEN RAISE EXCEPTION 'This link is not available.'; END IF;
  IF l.status = 'signed' THEN RAISE EXCEPTION 'This letter is already signed.'; END IF;
  IF l.valid_until IS NOT NULL AND l.valid_until < (NOW() AT TIME ZONE 'Asia/Colombo')::date THEN RAISE EXCEPTION 'This letter has expired. Please ask TaxMate for a new one.'; END IF;
  IF length(nm) < 2 OR length(nm) > 120 THEN RAISE EXCEPTION 'Please type your full name.'; END IF;
  IF p_signature IS NOT NULL AND p_signature <> '' AND (p_signature NOT LIKE 'data:image/png;base64,%' OR length(p_signature) > 300000) THEN RAISE EXCEPTION 'The signature could not be saved. Please draw it again.'; END IF;
  FOR k IN SELECT * FROM jsonb_array_elements(coalesce(l.content->'consents', '[]'::jsonb)) LOOP
    IF coalesce((k->>'required')::boolean, false) AND coalesce((p_consents->>(k->>'key'))::boolean, false) IS NOT TRUE THEN
      RAISE EXCEPTION 'Please tick: %', k->>'text';
    END IF;
  END LOOP;
  UPDATE public.engagement_letters SET status = 'signed', signed_at = NOW(), signer_name = nm,
         signer_capacity = nullif(left(trim(coalesce(p_capacity, '')), 120), ''), signature = nullif(p_signature, ''),
         consents = coalesce(p_consents, '{}'::jsonb), signer_agent = left(coalesce(p_agent, ''), 300)
   WHERE id = l.id;
  SELECT full_name INTO cn FROM public.clients WHERE id = l.client_id;
  BEGIN
    PERFORM public._push_send('admin', NULL, '✍️ Engagement letter signed — ' || coalesce(cn, 'Client'), l.letter_no || ' signed by ' || nm, '/admin/clients/' || l.client_id, 'el' || left(l.id::text, 8));
  EXCEPTION WHEN undefined_function THEN NULL; END;
  PERFORM public._notify_client(l.client_id, 'info', 'Engagement letter signed ✓', l.letter_no || ' — thank you. You can download a copy any time.', '/client/engagement');
  RETURN jsonb_build_object('ok', true, 'signed_at', NOW());
END $$;
REVOKE ALL ON FUNCTION public.sign_engagement(UUID, TEXT, TEXT, TEXT, JSONB, TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.sign_engagement(UUID, TEXT, TEXT, TEXT, JSONB, TEXT) TO anon, authenticated;

-- Public (link): decline with a reason (TaxMate follows up)
CREATE OR REPLACE FUNCTION public.decline_engagement(p_token UUID, p_reason TEXT) RETURNS VOID
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE l public.engagement_letters; cn TEXT;
BEGIN
  SELECT * INTO l FROM public.engagement_letters WHERE share_token = p_token FOR UPDATE;
  IF l.id IS NULL OR l.status <> 'sent' THEN RAISE EXCEPTION 'This letter can no longer be declined.'; END IF;
  UPDATE public.engagement_letters SET status = 'declined', declined_at = NOW(), decline_reason = nullif(left(trim(coalesce(p_reason, '')), 500), '') WHERE id = l.id;
  SELECT full_name INTO cn FROM public.clients WHERE id = l.client_id;
  BEGIN
    PERFORM public._push_send('admin', NULL, 'Engagement letter declined — ' || coalesce(cn, 'Client'), coalesce(nullif(left(trim(coalesce(p_reason, '')), 150), ''), 'No reason given'), '/admin/clients/' || l.client_id, 'el' || left(l.id::text, 8));
  EXCEPTION WHEN undefined_function THEN NULL; END;
END $$;
REVOKE ALL ON FUNCTION public.decline_engagement(UUID, TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.decline_engagement(UUID, TEXT) TO anon, authenticated;

-- Check: table · RLS · signed letters can't change
SELECT to_regclass('public.engagement_letters') IS NOT NULL AS table_ok,
       (SELECT relrowsecurity FROM pg_class WHERE oid = 'public.engagement_letters'::regclass) AS rls_on,
       EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'trg_engagement_guard') AS guard_ok;
