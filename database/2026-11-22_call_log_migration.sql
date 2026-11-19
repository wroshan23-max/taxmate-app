-- ════════════════════════════════════════════════════════════════════════════
-- V66 — Call Log: record every phone call / enquiry (number, name, service, notes),
--        follow-up reminders, link to an existing client or turn the caller into a client.
--   Admins only (clients never see this table).
--   Safe to run more than once.
-- ════════════════════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS public.call_logs (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  called_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  channel       TEXT NOT NULL DEFAULT 'incoming' CHECK (channel IN ('incoming', 'outgoing', 'missed', 'whatsapp', 'walk_in')),
  phone         TEXT NOT NULL CHECK (length(phone) BETWEEN 3 AND 30),
  phone_key     TEXT,                                   -- last 9 digits, for matching (set by trigger)
  name          TEXT CHECK (name IS NULL OR length(name) <= 120),
  email         TEXT CHECK (email IS NULL OR length(email) <= 160),
  location      TEXT CHECK (location IS NULL OR length(location) <= 120),
  client_id     UUID REFERENCES public.clients(id) ON DELETE SET NULL,
  services      TEXT[] NOT NULL DEFAULT '{}' CHECK (cardinality(services) <= 12),
  source        TEXT CHECK (source IS NULL OR length(source) <= 30),   -- how they found us
  notes         TEXT CHECK (notes IS NULL OR length(notes) <= 3000),
  status        TEXT NOT NULL DEFAULT 'new' CHECK (status IN ('new', 'follow_up', 'won', 'lost', 'done')),
  quoted_fee    NUMERIC(12, 2) CHECK (quoted_fee IS NULL OR quoted_fee >= 0),
  follow_up_at  TIMESTAMPTZ,
  followed_up_at TIMESTAMPTZ,
  created_by    UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS call_logs_called_idx   ON public.call_logs (called_at DESC);
CREATE INDEX IF NOT EXISTS call_logs_phone_idx    ON public.call_logs (phone_key);
CREATE INDEX IF NOT EXISTS call_logs_follow_idx   ON public.call_logs (follow_up_at) WHERE status = 'follow_up';
CREATE INDEX IF NOT EXISTS call_logs_client_idx   ON public.call_logs (client_id);

-- last 9 digits of a phone number ('077 123 4567', '+94 77 123 4567', '0094771234567' → '771234567')
CREATE OR REPLACE FUNCTION public._phone_key(p TEXT) RETURNS TEXT LANGUAGE sql IMMUTABLE AS $$
  SELECT nullif(right(regexp_replace(coalesce(p, ''), '\D', '', 'g'), 9), '');
$$;

-- keys, timestamps and automatic link to the one client with this mobile number
CREATE OR REPLACE FUNCTION public._call_log_trg() RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE m UUID[];
BEGIN
  NEW.phone := trim(NEW.phone);
  NEW.phone_key := public._phone_key(NEW.phone);
  NEW.name := nullif(trim(NEW.name), '');
  NEW.email := nullif(lower(trim(NEW.email)), '');
  NEW.updated_at := NOW();
  IF TG_OP = 'INSERT' THEN
    NEW.created_by := coalesce(NEW.created_by, auth.uid());
  END IF;
  IF NEW.status <> 'follow_up' AND (TG_OP = 'INSERT' OR OLD.status = 'follow_up') AND NEW.follow_up_at IS NOT NULL THEN
    NEW.followed_up_at := coalesce(NEW.followed_up_at, NOW());
  END IF;
  IF NEW.client_id IS NULL AND NEW.phone_key IS NOT NULL AND (TG_OP = 'INSERT' OR NEW.phone_key IS DISTINCT FROM OLD.phone_key) THEN
    SELECT array_agg(id) INTO m FROM public.clients WHERE archived_at IS NULL AND public._phone_key(mobile) = NEW.phone_key;
    IF cardinality(m) = 1 THEN NEW.client_id := m[1]; END IF;
  END IF;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS trg_call_log ON public.call_logs;
CREATE TRIGGER trg_call_log BEFORE INSERT OR UPDATE ON public.call_logs FOR EACH ROW EXECUTE FUNCTION public._call_log_trg();

ALTER TABLE public.call_logs ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS call_logs_admin ON public.call_logs;
CREATE POLICY call_logs_admin ON public.call_logs FOR ALL TO authenticated USING (public.is_admin()) WITH CHECK (public.is_admin());
REVOKE ALL ON public.call_logs FROM anon;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.call_logs TO authenticated;

-- While typing a number: clients with this number (own mobile or contact person) and earlier calls
CREATE OR REPLACE FUNCTION public.admin_call_match(p_phone TEXT, p_except UUID DEFAULT NULL) RETURNS JSONB
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE k TEXT := public._phone_key(p_phone);
BEGIN
  IF NOT public.is_admin() THEN RAISE EXCEPTION 'Not allowed.'; END IF;
  IF k IS NULL OR length(k) < 7 THEN RETURN jsonb_build_object('clients', '[]'::jsonb, 'calls', '[]'::jsonb, 'count', 0); END IF;
  RETURN jsonb_build_object(
    'clients', coalesce((SELECT jsonb_agg(jsonb_build_object('id', c.id, 'full_name', c.full_name, 'client_no', c.client_no, 'mobile', c.mobile,
                         'email', c.email, 'archived', c.archived_at IS NOT NULL,
                         'via', CASE WHEN public._phone_key(c.mobile) = k THEN 'client' ELSE 'contact' END, 'contact_name', c.contact_name) ORDER BY c.archived_at NULLS FIRST, c.full_name)
                         FROM public.clients c WHERE public._phone_key(c.mobile) = k OR public._phone_key(c.contact_mobile) = k), '[]'::jsonb),
    'calls', coalesce((SELECT jsonb_agg(x ORDER BY x->>'called_at' DESC) FROM (
                         SELECT jsonb_build_object('id', l.id, 'called_at', l.called_at, 'name', l.name, 'status', l.status, 'services', l.services, 'notes', left(l.notes, 200)) x
                           FROM public.call_logs l WHERE l.phone_key = k AND l.id IS DISTINCT FROM p_except ORDER BY l.called_at DESC LIMIT 5) t), '[]'::jsonb),
    'count', (SELECT count(*) FROM public.call_logs WHERE phone_key = k AND id IS DISTINCT FROM p_except));
END $$;
REVOKE ALL ON FUNCTION public.admin_call_match(TEXT, UUID) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_call_match(TEXT, UUID) TO authenticated;

-- Link a call to an existing client (p_client), or make a new client from the caller (p_client NULL).
-- Other calls from the same number with no client are linked too. Returns the client id.
CREATE OR REPLACE FUNCTION public.admin_call_to_client(p_call UUID, p_client UUID DEFAULT NULL, p_name TEXT DEFAULT NULL) RETURNS UUID
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE l public.call_logs; cid UUID := p_client; nm TEXT;
BEGIN
  IF NOT public.is_admin() THEN RAISE EXCEPTION 'Not allowed.'; END IF;
  SELECT * INTO l FROM public.call_logs WHERE id = p_call FOR UPDATE;
  IF l.id IS NULL THEN RAISE EXCEPTION 'Call not found.'; END IF;
  IF cid IS NOT NULL THEN
    IF NOT EXISTS (SELECT 1 FROM public.clients WHERE id = cid) THEN RAISE EXCEPTION 'Client not found.'; END IF;
  ELSE
    nm := nullif(trim(coalesce(p_name, l.name)), '');
    IF nm IS NULL THEN RAISE EXCEPTION 'Type the caller''s name first.'; END IF;
    INSERT INTO public.clients (full_name, mobile, email, created_by, source)
    VALUES (left(nm, 120), l.phone, l.email, auth.uid(), 'call_log')
    RETURNING id INTO cid;
  END IF;
  UPDATE public.call_logs SET client_id = cid, name = coalesce(name, nm),
         status = CASE WHEN p_client IS NULL OR status IN ('new', 'follow_up') THEN 'won' ELSE status END
   WHERE id = p_call;
  UPDATE public.call_logs SET client_id = cid WHERE phone_key = l.phone_key AND client_id IS NULL AND id <> p_call;
  RETURN cid;
END $$;
REVOKE ALL ON FUNCTION public.admin_call_to_client(UUID, UUID, TEXT) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_call_to_client(UUID, UUID, TEXT) TO authenticated;

-- Check: table ready · RLS on · follow-ups due today or earlier
SELECT to_regclass('public.call_logs') IS NOT NULL AS table_ok,
       (SELECT relrowsecurity FROM pg_class WHERE oid = 'public.call_logs'::regclass) AS rls_on,
       (SELECT count(*) FROM public.call_logs WHERE status = 'follow_up' AND follow_up_at < (((NOW() AT TIME ZONE 'Asia/Colombo')::date + 1)::timestamp AT TIME ZONE 'Asia/Colombo')) AS follow_ups_due;
