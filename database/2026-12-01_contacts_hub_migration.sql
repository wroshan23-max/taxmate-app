-- ═══════════════════════════════════════════════════════════════════════════
-- V75 — Contacts hub: Phone Book · Groups · Broadcast · Call Log · Messages
--   • contact_groups / contact_group_members — your own client & lead groups
--     (a member is a client, or a phone number from the Call Log that is not a client yet)
--   • broadcasts / broadcast_recipients — one message to many clients:
--       portal message + phone notification (sent by the server),
--       WhatsApp / SMS / email queue (sent one by one from your phone, ticked off here)
--   • admin_send_broadcast(…) RPC
-- Safe to run more than once. Admins (full admins and staff) only.
-- ═══════════════════════════════════════════════════════════════════════════

-- ═══ 1. Groups ══════════════════════════════════════════════
CREATE TABLE IF NOT EXISTS public.contact_groups (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name        TEXT NOT NULL CHECK (length(trim(name)) BETWEEN 1 AND 40),
  color       TEXT NOT NULL DEFAULT 'blue' CHECK (color ~ '^[a-z]{3,10}$'),
  emoji       TEXT CHECK (emoji IS NULL OR length(emoji) <= 8),
  description TEXT CHECK (description IS NULL OR length(description) <= 200),
  sort        INT NOT NULL DEFAULT 0,
  created_by  UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE UNIQUE INDEX IF NOT EXISTS contact_groups_name_uq ON public.contact_groups (lower(trim(name)));

CREATE TABLE IF NOT EXISTS public.contact_group_members (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  group_id   UUID NOT NULL REFERENCES public.contact_groups(id) ON DELETE CASCADE,
  client_id  UUID REFERENCES public.clients(id) ON DELETE CASCADE,
  name       TEXT CHECK (name IS NULL OR length(name) <= 120),
  phone      TEXT CHECK (phone IS NULL OR length(phone) BETWEEN 3 AND 30),
  email      TEXT CHECK (email IS NULL OR length(email) <= 160),
  phone_key  TEXT,                      -- last 9 digits (set by trigger)
  added_by   UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  added_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CHECK (client_id IS NOT NULL OR phone IS NOT NULL)
);
CREATE UNIQUE INDEX IF NOT EXISTS contact_group_members_client_uq ON public.contact_group_members (group_id, client_id) WHERE client_id IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS contact_group_members_phone_uq  ON public.contact_group_members (group_id, phone_key) WHERE client_id IS NULL;
CREATE INDEX IF NOT EXISTS contact_group_members_group_idx ON public.contact_group_members (group_id);

CREATE OR REPLACE FUNCTION public._cgm_fill() RETURNS TRIGGER LANGUAGE plpgsql SET search_path = public AS $$
BEGIN
  NEW.phone_key := nullif(right(regexp_replace(coalesce(NEW.phone, ''), '\D', '', 'g'), 9), '');
  IF NEW.client_id IS NULL AND NEW.phone_key IS NULL THEN RAISE EXCEPTION 'Add a client or a phone number'; END IF;
  IF TG_OP = 'INSERT' THEN NEW.added_by := coalesce(NEW.added_by, auth.uid()); END IF;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS trg_cgm_fill ON public.contact_group_members;
CREATE TRIGGER trg_cgm_fill BEFORE INSERT OR UPDATE ON public.contact_group_members FOR EACH ROW EXECUTE FUNCTION public._cgm_fill();

CREATE OR REPLACE FUNCTION public._cg_touch() RETURNS TRIGGER LANGUAGE plpgsql SET search_path = public AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN NEW.created_by := coalesce(NEW.created_by, auth.uid()); END IF;
  NEW.updated_at := NOW();
  NEW.name := trim(NEW.name);
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS trg_cg_touch ON public.contact_groups;
CREATE TRIGGER trg_cg_touch BEFORE INSERT OR UPDATE ON public.contact_groups FOR EACH ROW EXECUTE FUNCTION public._cg_touch();

-- ═══ 2. Broadcasts ══════════════════════════════════════════
CREATE TABLE IF NOT EXISTS public.broadcasts (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  title       TEXT CHECK (title IS NULL OR length(title) <= 120),
  body        TEXT NOT NULL CHECK (length(trim(body)) BETWEEN 1 AND 2000),
  channels    TEXT[] NOT NULL DEFAULT '{}',
  audience    TEXT CHECK (audience IS NULL OR length(audience) <= 200),
  total       INT NOT NULL DEFAULT 0,
  portal_sent INT NOT NULL DEFAULT 0,
  created_by  UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CHECK (channels <@ ARRAY['portal', 'whatsapp', 'sms', 'email']::TEXT[] AND cardinality(channels) BETWEEN 1 AND 4)
);
CREATE INDEX IF NOT EXISTS broadcasts_created_idx ON public.broadcasts (created_at DESC);

CREATE TABLE IF NOT EXISTS public.broadcast_recipients (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  broadcast_id  UUID NOT NULL REFERENCES public.broadcasts(id) ON DELETE CASCADE,
  client_id     UUID REFERENCES public.clients(id) ON DELETE SET NULL,
  name          TEXT,
  phone         TEXT,
  email         TEXT,
  body          TEXT NOT NULL,                       -- personalised text ({name} filled in)
  portal_status TEXT CHECK (portal_status IS NULL OR portal_status IN ('sent', 'no_portal', 'off')),
  message_id    UUID REFERENCES public.messages(id) ON DELETE SET NULL,
  wa_sent_at    TIMESTAMPTZ,
  sms_sent_at   TIMESTAMPTZ,
  email_sent_at TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS broadcast_recipients_b_idx ON public.broadcast_recipients (broadcast_id);

-- ═══ 3. RLS: admins only ════════════════════════════════════
ALTER TABLE public.contact_groups        ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.contact_group_members ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.broadcasts            ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.broadcast_recipients  ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Admins manage contact groups" ON public.contact_groups;
CREATE POLICY "Admins manage contact groups" ON public.contact_groups FOR ALL USING (is_admin()) WITH CHECK (is_admin());
DROP POLICY IF EXISTS "Admins manage group members" ON public.contact_group_members;
CREATE POLICY "Admins manage group members" ON public.contact_group_members FOR ALL USING (is_admin()) WITH CHECK (is_admin());
DROP POLICY IF EXISTS "Admins read broadcasts" ON public.broadcasts;
CREATE POLICY "Admins read broadcasts" ON public.broadcasts FOR SELECT USING (is_admin());
DROP POLICY IF EXISTS "Full admins delete broadcasts" ON public.broadcasts;
CREATE POLICY "Full admins delete broadcasts" ON public.broadcasts FOR DELETE USING (is_owner());
DROP POLICY IF EXISTS "Admins read broadcast recipients" ON public.broadcast_recipients;
CREATE POLICY "Admins read broadcast recipients" ON public.broadcast_recipients FOR SELECT USING (is_admin());
DROP POLICY IF EXISTS "Admins tick broadcast recipients" ON public.broadcast_recipients;
CREATE POLICY "Admins tick broadcast recipients" ON public.broadcast_recipients FOR UPDATE USING (is_admin()) WITH CHECK (is_admin());

-- only the "sent" ticks can change from the app
CREATE OR REPLACE FUNCTION public._br_guard() RETURNS TRIGGER LANGUAGE plpgsql SET search_path = public AS $$
BEGIN
  IF current_user IN ('authenticated', 'anon') THEN
    NEW.broadcast_id := OLD.broadcast_id; NEW.client_id := OLD.client_id; NEW.name := OLD.name; NEW.phone := OLD.phone;
    NEW.email := OLD.email; NEW.body := OLD.body; NEW.portal_status := OLD.portal_status; NEW.message_id := OLD.message_id;
  END IF;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS trg_br_guard ON public.broadcast_recipients;
CREATE TRIGGER trg_br_guard BEFORE UPDATE ON public.broadcast_recipients FOR EACH ROW EXECUTE FUNCTION public._br_guard();

-- ═══ 4. Send a broadcast ════════════════════════════════════
-- p_recipients: [{ "client_id": uuid|null, "name": text, "phone": text, "email": text }]  (max 500)
-- {name} in the title / body becomes the person's first name ("Dear {name}," → "Dear Kasun,")
-- 'portal' channel: a private message in the client's portal chat + a phone notification
--   (only for clients who can open the portal and have Messages switched on)
CREATE OR REPLACE FUNCTION public.admin_send_broadcast(p_title TEXT, p_body TEXT, p_channels TEXT[], p_audience TEXT, p_recipients JSONB)
RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  b_id UUID; r JSONB; cid UUID; c RECORD; nm TEXT; ph TEXT; em TEXT; has_portal BOOLEAN; first TEXT; txt TEXT; ttl TEXT; st TEXT; mid UUID;
  n INT := 0; sent INT := 0; seen UUID[] := '{}'; seen_ph TEXT[] := '{}'; pk TEXT;
  ch TEXT[] := ARRAY(SELECT DISTINCT x FROM unnest(coalesce(p_channels, '{}')) x WHERE x IN ('portal', 'whatsapp', 'sms', 'email'));
BEGIN
  IF NOT public.is_admin() THEN RAISE EXCEPTION 'Admins only'; END IF;
  IF length(trim(coalesce(p_body, ''))) = 0 THEN RAISE EXCEPTION 'Type the message'; END IF;
  IF length(p_body) > 1900 THEN RAISE EXCEPTION 'The message is too long (max 1,900 characters)'; END IF;
  IF cardinality(ch) = 0 THEN RAISE EXCEPTION 'Choose at least one way to send'; END IF;
  IF jsonb_typeof(p_recipients) <> 'array' OR jsonb_array_length(p_recipients) = 0 THEN RAISE EXCEPTION 'Choose who gets the message'; END IF;
  IF jsonb_array_length(p_recipients) > 500 THEN RAISE EXCEPTION 'Max 500 people in one message — split the group'; END IF;
  -- flood guard: 3,000 recipients an hour
  IF (SELECT coalesce(sum(total), 0) FROM public.broadcasts WHERE created_at > NOW() - INTERVAL '1 hour') + jsonb_array_length(p_recipients) > 3000 THEN
    RAISE EXCEPTION 'Too many messages in the last hour — please wait a little';
  END IF;

  INSERT INTO public.broadcasts (title, body, channels, audience, created_by)
  VALUES (nullif(left(trim(coalesce(p_title, '')), 120), ''), trim(p_body), ch, left(p_audience, 200), auth.uid())
  RETURNING id INTO b_id;

  FOR r IN SELECT * FROM jsonb_array_elements(p_recipients) LOOP
    cid := NULL; st := NULL; mid := NULL; ph := NULL; em := NULL; has_portal := false;
    BEGIN cid := nullif(r->>'client_id', '')::UUID; EXCEPTION WHEN others THEN cid := NULL; END;
    IF cid IS NOT NULL THEN
      SELECT id, full_name, mobile, email, profile_id, contact_name, contact_mobile, contact_email, contact_preferred INTO c
        FROM public.clients WHERE id = cid;
      IF c.id IS NULL THEN CONTINUE; END IF;
      IF cid = ANY(seen) THEN CONTINUE; END IF;
      seen := seen || cid;
      nm := coalesce(nullif(trim(r->>'name'), ''), CASE WHEN c.contact_preferred AND c.contact_name IS NOT NULL THEN c.contact_name ELSE c.full_name END);
      ph := CASE WHEN c.contact_preferred AND c.contact_mobile IS NOT NULL THEN c.contact_mobile ELSE coalesce(c.mobile, c.contact_mobile) END;
      em := CASE WHEN c.contact_preferred AND c.contact_email IS NOT NULL THEN c.contact_email ELSE coalesce(c.email, c.contact_email) END;
      has_portal := c.profile_id IS NOT NULL OR EXISTS (SELECT 1 FROM public.client_family f WHERE f.member_id = cid);
    ELSE
      pk := nullif(right(regexp_replace(coalesce(r->>'phone', ''), '\D', '', 'g'), 9), '');
      IF pk IS NULL AND nullif(trim(r->>'email'), '') IS NULL THEN CONTINUE; END IF;
      IF pk IS NOT NULL AND pk = ANY(seen_ph) THEN CONTINUE; END IF;
      IF pk IS NOT NULL THEN seen_ph := seen_ph || pk; END IF;
      nm := nullif(trim(r->>'name'), '');
    END IF;
    -- first name: "Mr. A.B. Kasun Perera" → "Kasun"; initials and titles are skipped
    first := (SELECT w FROM regexp_split_to_table(coalesce(nm, ''), '\s+') WITH ORDINALITY AS t(w, i)
               WHERE w !~* '^(mr|mrs|ms|miss|dr|rev|prof|hon)\.?$' AND w !~ '^([A-Za-z]\.)+$' AND length(w) > 1 ORDER BY i LIMIT 1);
    first := coalesce(initcap(first), 'Sir/Madam');
    txt := left(replace(trim(p_body), '{name}', first), 2000);
    ttl := nullif(left(replace(trim(coalesce(p_title, '')), '{name}', first), 120), '');

    IF 'portal' = ANY(ch) AND cid IS NOT NULL THEN
      IF NOT has_portal THEN st := 'no_portal';
      ELSIF NOT public._feature_on(cid, 'messages') THEN st := 'off';
      ELSE
        INSERT INTO public.messages (client_id, sender_role, sender_id, title, body)
        VALUES (cid, 'admin', auth.uid(), ttl, txt) RETURNING id INTO mid;
        PERFORM public._notify_client(cid, 'message', '💬 ' || coalesce(ttl, 'New message from TaxMate'), left(txt, 200), '/client/messages');
        st := 'sent'; sent := sent + 1;
      END IF;
    ELSIF 'portal' = ANY(ch) THEN st := 'no_portal';
    END IF;

    INSERT INTO public.broadcast_recipients (broadcast_id, client_id, name, phone, email, body, portal_status, message_id)
    VALUES (b_id, cid, left(coalesce(nm, r->>'phone'), 120),
            left(nullif(trim(coalesce(nullif(trim(r->>'phone'), ''), ph, '')), ''), 30),
            left(nullif(trim(coalesce(nullif(trim(r->>'email'), ''), em, '')), ''), 160),
            txt, st, mid);
    n := n + 1;
  END LOOP;

  IF n = 0 THEN RAISE EXCEPTION 'None of the chosen people has a phone number or email'; END IF;
  UPDATE public.broadcasts SET total = n, portal_sent = sent WHERE id = b_id;
  RETURN jsonb_build_object('id', b_id, 'total', n, 'portal_sent', sent);
END $$;
REVOKE ALL ON FUNCTION public.admin_send_broadcast(TEXT, TEXT, TEXT[], TEXT, JSONB) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_send_broadcast(TEXT, TEXT, TEXT[], TEXT, JSONB) TO authenticated;

-- ═══ 5. Live updates ════════════════════════════════════════
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_publication WHERE pubname = 'supabase_realtime')
     AND NOT EXISTS (SELECT 1 FROM pg_publication_tables WHERE pubname = 'supabase_realtime' AND tablename = 'broadcast_recipients') THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.broadcast_recipients;
  END IF;
END $$;

-- ═══ 6. Check ═══════════════════════════════════════════════
SELECT
  to_regclass('public.contact_groups') IS NOT NULL        AS groups_ready,
  to_regclass('public.broadcast_recipients') IS NOT NULL  AS broadcasts_ready,
  to_regprocedure('public.admin_send_broadcast(text,text,text[],text,jsonb)') IS NOT NULL AS send_ready;
