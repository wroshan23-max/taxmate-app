-- ═══════════════════════════════════════════════════════════
--  TaxMate V30 — Messages, activity log & usage stats, two-factor login
-- ═══════════════════════════════════════════════════════════

-- 1. Two-factor (authenticator app / TOTP) enforcement in the database
--    Anyone who has turned on 2FA must have completed the code step (aal2)
--    before admin rights or their client data are available.
CREATE OR REPLACE FUNCTION public._mfa_ok()
RETURNS BOOLEAN LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, auth AS $$
  SELECT coalesce(auth.jwt()->>'aal', 'aal1') = 'aal2'
      OR NOT EXISTS (SELECT 1 FROM auth.mfa_factors WHERE user_id = auth.uid() AND status = 'verified');
$$;
REVOKE ALL ON FUNCTION public._mfa_ok() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public._mfa_ok() TO authenticated;

CREATE OR REPLACE FUNCTION public.is_admin()
RETURNS BOOLEAN LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (SELECT 1 FROM public.profiles WHERE id = auth.uid() AND role = 'admin') AND public._mfa_ok();
$$;

CREATE OR REPLACE FUNCTION public.my_client_id()
RETURNS UUID LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT id FROM public.clients WHERE profile_id = auth.uid() AND public._mfa_ok() LIMIT 1;
$$;

-- Admin: switch off a client's 2FA when they lose their phone
CREATE OR REPLACE FUNCTION public.admin_reset_mfa(p_client UUID)
RETURNS INT LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, auth AS $$
DECLARE uid UUID; n INT;
BEGIN
  IF NOT is_admin() THEN RAISE EXCEPTION 'Admins only'; END IF;
  SELECT profile_id INTO uid FROM public.clients WHERE id = p_client;
  IF uid IS NULL THEN RETURN 0; END IF;
  IF EXISTS (SELECT 1 FROM public.profiles WHERE id = uid AND role = 'admin') THEN RAISE EXCEPTION 'Not for admin logins'; END IF;
  DELETE FROM auth.mfa_factors WHERE user_id = uid;
  GET DIAGNOSTICS n = ROW_COUNT;
  RETURN n;
END $$;
REVOKE ALL ON FUNCTION public.admin_reset_mfa(UUID) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_reset_mfa(UUID) TO authenticated;

-- 2. Messages
--   client_id set  → private thread between TaxMate and that client (both can write)
--   client_id NULL → public announcement to every client (admin only)
CREATE TABLE IF NOT EXISTS public.messages (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id   UUID REFERENCES public.clients(id) ON DELETE CASCADE,
  sender_role TEXT NOT NULL CHECK (sender_role IN ('admin', 'client')),
  sender_id   UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  title       TEXT CHECK (title IS NULL OR length(title) <= 120),
  body        TEXT NOT NULL CHECK (length(trim(body)) BETWEEN 1 AND 2000),
  read_at     TIMESTAMPTZ,              -- private: read by the other side
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CHECK (client_id IS NOT NULL OR sender_role = 'admin')
);
CREATE INDEX IF NOT EXISTS messages_thread_idx ON public.messages (client_id, created_at DESC);
CREATE INDEX IF NOT EXISTS messages_unread_admin_idx ON public.messages (created_at) WHERE sender_role = 'client' AND read_at IS NULL;

CREATE TABLE IF NOT EXISTS public.message_reads (      -- who has seen an announcement
  message_id UUID NOT NULL REFERENCES public.messages(id) ON DELETE CASCADE,
  client_id  UUID NOT NULL REFERENCES public.clients(id) ON DELETE CASCADE,
  read_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (message_id, client_id)
);

-- Clients: max 30 messages an hour (stops accidental floods)
CREATE OR REPLACE FUNCTION public._msg_rate_ok(p_client UUID)
RETURNS BOOLEAN LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT count(*) < 30 FROM public.messages WHERE client_id = p_client AND sender_role = 'client' AND created_at > NOW() - INTERVAL '1 hour';
$$;
REVOKE ALL ON FUNCTION public._msg_rate_ok(UUID) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public._msg_rate_ok(UUID) TO authenticated;

ALTER TABLE public.messages ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Admins manage messages" ON public.messages;
CREATE POLICY "Admins manage messages" ON public.messages FOR ALL USING (is_admin()) WITH CHECK (is_admin());
DROP POLICY IF EXISTS "Clients read their messages" ON public.messages;
CREATE POLICY "Clients read their messages" ON public.messages FOR SELECT USING (
  my_client_id() IS NOT NULL AND (client_id = my_client_id() OR client_id IS NULL) AND _feature_on(my_client_id(), 'messages'));
DROP POLICY IF EXISTS "Clients write to TaxMate" ON public.messages;
CREATE POLICY "Clients write to TaxMate" ON public.messages FOR INSERT WITH CHECK (
  client_id = my_client_id() AND sender_role = 'client' AND sender_id = auth.uid() AND read_at IS NULL AND title IS NULL
  AND _feature_on(my_client_id(), 'messages') AND _msg_rate_ok(my_client_id()));

ALTER TABLE public.message_reads ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Admins read message reads" ON public.message_reads;
CREATE POLICY "Admins read message reads" ON public.message_reads FOR SELECT USING (is_admin());
DROP POLICY IF EXISTS "Clients read own reads" ON public.message_reads;
CREATE POLICY "Clients read own reads" ON public.message_reads FOR SELECT USING (client_id = my_client_id());

-- Client opened Messages: mark TaxMate's messages + announcements as read
CREATE OR REPLACE FUNCTION public.mark_my_messages_read()
RETURNS VOID LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE cid UUID := my_client_id();
BEGIN
  IF cid IS NULL OR NOT _feature_on(cid, 'messages') THEN RETURN; END IF;
  UPDATE public.messages SET read_at = NOW() WHERE client_id = cid AND sender_role = 'admin' AND read_at IS NULL;
  INSERT INTO public.message_reads (message_id, client_id)
  SELECT m.id, cid FROM public.messages m WHERE m.client_id IS NULL AND m.created_at >= (SELECT coalesce(created_at, NOW()) FROM public.clients WHERE id = cid) - INTERVAL '60 days'
  ON CONFLICT DO NOTHING;
END $$;
REVOKE ALL ON FUNCTION public.mark_my_messages_read() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.mark_my_messages_read() TO authenticated;

CREATE OR REPLACE FUNCTION public.my_unread_messages()
RETURNS INT LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT CASE WHEN my_client_id() IS NULL OR NOT _feature_on(my_client_id(), 'messages') THEN 0 ELSE
    (SELECT count(*) FROM public.messages WHERE client_id = my_client_id() AND sender_role = 'admin' AND read_at IS NULL)::int
  + (SELECT count(*) FROM public.messages m WHERE m.client_id IS NULL
       AND m.created_at >= (SELECT created_at FROM public.clients WHERE id = my_client_id()) - INTERVAL '60 days'
       AND NOT EXISTS (SELECT 1 FROM public.message_reads r WHERE r.message_id = m.id AND r.client_id = my_client_id()))::int END;
$$;
REVOKE ALL ON FUNCTION public.my_unread_messages() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.my_unread_messages() TO authenticated;

-- Live updates (Supabase Realtime respects the policies above)
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_publication WHERE pubname = 'supabase_realtime')
     AND NOT EXISTS (SELECT 1 FROM pg_publication_tables WHERE pubname = 'supabase_realtime' AND tablename = 'messages') THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.messages;
  END IF;
END $$;

-- 3. Activity log + "online now" (admin only)
CREATE TABLE IF NOT EXISTS public.activity_log (
  id         BIGSERIAL PRIMARY KEY,
  user_id    UUID REFERENCES auth.users(id) ON DELETE CASCADE,
  client_id  UUID REFERENCES public.clients(id) ON DELETE CASCADE,
  role       TEXT,
  event      TEXT NOT NULL CHECK (event IN ('login', 'view', 'upload', 'download', 'message', 'calc', 'submit', 'share')),
  area       TEXT,                     -- e.g. client/documents
  detail     TEXT CHECK (detail IS NULL OR length(detail) <= 200),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS activity_log_time_idx ON public.activity_log (created_at DESC);
CREATE INDEX IF NOT EXISTS activity_log_user_idx ON public.activity_log (user_id, created_at DESC);
ALTER TABLE public.activity_log ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Admins read activity" ON public.activity_log;
CREATE POLICY "Admins read activity" ON public.activity_log FOR SELECT USING (is_admin());

CREATE TABLE IF NOT EXISTS public.user_presence (
  user_id      UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  client_id    UUID REFERENCES public.clients(id) ON DELETE CASCADE,
  role         TEXT,
  area         TEXT,
  device       TEXT,
  last_seen_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
ALTER TABLE public.user_presence ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Admins read presence" ON public.user_presence;
CREATE POLICY "Admins read presence" ON public.user_presence FOR SELECT USING (is_admin());

-- Called by the app: records an event (page views de-duplicated per minute) and "I'm here"
CREATE OR REPLACE FUNCTION public.log_activity(p_event TEXT, p_path TEXT DEFAULT NULL, p_detail TEXT DEFAULT NULL, p_device TEXT DEFAULT NULL)
RETURNS VOID LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE uid UUID := auth.uid(); cid UUID; r TEXT; a TEXT;
BEGIN
  IF uid IS NULL OR NOT _mfa_ok() THEN RETURN; END IF;
  IF p_event NOT IN ('login', 'view', 'upload', 'download', 'message', 'calc', 'submit', 'share', 'ping') THEN RETURN; END IF;
  SELECT role INTO r FROM public.profiles WHERE id = uid;
  SELECT id INTO cid FROM public.clients WHERE profile_id = uid LIMIT 1;
  a := nullif(rtrim(left(regexp_replace(lower(coalesce(p_path, '')), '^/?([a-z-]+)/?([a-z-]*).*$', '\1/\2'), 40), '/'), '');
  INSERT INTO public.user_presence (user_id, client_id, role, area, device, last_seen_at)
  VALUES (uid, cid, r, coalesce(a, 'app'), left(p_device, 40), NOW())
  ON CONFLICT (user_id) DO UPDATE SET client_id = EXCLUDED.client_id, role = EXCLUDED.role,
    area = coalesce(EXCLUDED.area, user_presence.area), device = coalesce(EXCLUDED.device, user_presence.device), last_seen_at = NOW();
  IF p_event = 'ping' THEN RETURN; END IF;
  IF p_event = 'view' AND EXISTS (SELECT 1 FROM public.activity_log WHERE user_id = uid AND event = 'view' AND area IS NOT DISTINCT FROM a AND created_at > NOW() - INTERVAL '1 minute') THEN RETURN; END IF;
  IF (SELECT count(*) FROM public.activity_log WHERE user_id = uid AND created_at > NOW() - INTERVAL '1 hour') > 300 THEN RETURN; END IF;
  INSERT INTO public.activity_log (user_id, client_id, role, event, area, detail) VALUES (uid, cid, r, p_event, a, left(p_detail, 200));
  IF random() < 0.01 THEN DELETE FROM public.activity_log WHERE created_at < NOW() - INTERVAL '180 days'; END IF;
END $$;
REVOKE ALL ON FUNCTION public.log_activity(TEXT, TEXT, TEXT, TEXT) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.log_activity(TEXT, TEXT, TEXT, TEXT) TO authenticated;

-- Admin usage dashboard
CREATE OR REPLACE FUNCTION public.admin_usage_stats(p_days INT DEFAULT 30)
RETURNS JSONB LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, auth AS $$
DECLARE since TIMESTAMPTZ := NOW() - make_interval(days => greatest(1, least(p_days, 180)));
BEGIN
  IF NOT is_admin() THEN RAISE EXCEPTION 'Admins only'; END IF;
  RETURN jsonb_build_object(
    'clients_total',   (SELECT count(*) FROM clients WHERE archived_at IS NULL),
    'clients_portal',  (SELECT count(*) FROM clients WHERE archived_at IS NULL AND profile_id IS NOT NULL),
    'clients_new',     (SELECT count(*) FROM clients WHERE archived_at IS NULL AND created_at >= since),
    'self_registered', (SELECT count(*) FROM clients WHERE archived_at IS NULL AND source = 'self_registration'),
    'active_today',    (SELECT count(DISTINCT user_id) FROM activity_log WHERE role = 'client' AND created_at >= date_trunc('day', NOW())),
    'active_7',        (SELECT count(DISTINCT user_id) FROM activity_log WHERE role = 'client' AND created_at >= NOW() - INTERVAL '7 days'),
    'active_period',   (SELECT count(DISTINCT user_id) FROM activity_log WHERE role = 'client' AND created_at >= since),
    'online', (SELECT coalesce(jsonb_agg(jsonb_build_object('name', coalesce(c.full_name, p.full_name, 'User'), 'client_id', u.client_id, 'role', u.role,
                 'area', u.area, 'device', u.device, 'last_seen', u.last_seen_at) ORDER BY u.last_seen_at DESC), '[]'::jsonb)
               FROM user_presence u LEFT JOIN clients c ON c.id = u.client_id LEFT JOIN profiles p ON p.id = u.user_id
               WHERE u.last_seen_at > NOW() - INTERVAL '3 minutes'),
    'daily', (SELECT coalesce(jsonb_agg(jsonb_build_object('day', d::date, 'users', coalesce(x.users, 0), 'events', coalesce(x.events, 0)) ORDER BY d), '[]'::jsonb)
              FROM generate_series(date_trunc('day', NOW()) - INTERVAL '29 days', date_trunc('day', NOW()), INTERVAL '1 day') d
              LEFT JOIN (SELECT date_trunc('day', created_at) dd, count(DISTINCT user_id) users, count(*) events
                         FROM activity_log WHERE role = 'client' AND created_at >= NOW() - INTERVAL '30 days' GROUP BY 1) x ON x.dd = d),
    'features', (SELECT coalesce(jsonb_agg(jsonb_build_object('area', area, 'views', n, 'users', u) ORDER BY n DESC), '[]'::jsonb)
                 FROM (SELECT area, count(*) n, count(DISTINCT user_id) u FROM activity_log
                       WHERE role = 'client' AND created_at >= since AND area IS NOT NULL GROUP BY area ORDER BY 2 DESC LIMIT 15) f),
    'events', (SELECT coalesce(jsonb_object_agg(event, n), '{}'::jsonb) FROM (SELECT event, count(*) n FROM activity_log WHERE role = 'client' AND created_at >= since GROUP BY 1) e),
    'users', (SELECT coalesce(jsonb_agg(jsonb_build_object('client_id', c.id, 'name', c.full_name, 'last_seen', pr.last_seen_at,
                 'last_login', au.last_sign_in_at, 'views', coalesce(s.views, 0), 'actions', coalesce(s.actions, 0), 'days', coalesce(s.days, 0),
                 'top', s.top, 'mfa', EXISTS (SELECT 1 FROM auth.mfa_factors f WHERE f.user_id = c.profile_id AND f.status = 'verified'))
                 ORDER BY pr.last_seen_at DESC NULLS LAST), '[]'::jsonb)
              FROM clients c
              LEFT JOIN auth.users au ON au.id = c.profile_id
              LEFT JOIN user_presence pr ON pr.user_id = c.profile_id
              LEFT JOIN LATERAL (SELECT count(*) FILTER (WHERE event = 'view') views, count(*) FILTER (WHERE event NOT IN ('view', 'login')) actions,
                                        count(DISTINCT date_trunc('day', created_at)) days, mode() WITHIN GROUP (ORDER BY area) top
                                 FROM activity_log l WHERE l.user_id = c.profile_id AND l.created_at >= since) s ON TRUE
              WHERE c.archived_at IS NULL AND c.profile_id IS NOT NULL),
    'recent', (SELECT coalesce(jsonb_agg(r ORDER BY (r->>'at') DESC), '[]'::jsonb) FROM (
                 SELECT jsonb_build_object('at', l.created_at, 'event', l.event, 'area', l.area, 'detail', l.detail, 'role', l.role,
                   'client_id', l.client_id, 'name', coalesce(c.full_name, p.full_name, 'User')) r
                 FROM activity_log l LEFT JOIN clients c ON c.id = l.client_id LEFT JOIN profiles p ON p.id = l.user_id
                 ORDER BY l.created_at DESC LIMIT 60) q),
    'mfa', jsonb_build_object(
       'admins', (SELECT count(*) FROM profiles WHERE role = 'admin'),
       'admins_on', (SELECT count(DISTINCT p.id) FROM profiles p JOIN auth.mfa_factors f ON f.user_id = p.id AND f.status = 'verified' WHERE p.role = 'admin'),
       'clients_on', (SELECT count(DISTINCT c.id) FROM clients c JOIN auth.mfa_factors f ON f.user_id = c.profile_id AND f.status = 'verified'))
  );
END $$;
REVOKE ALL ON FUNCTION public.admin_usage_stats(INT) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_usage_stats(INT) TO authenticated;

-- 4. Portal switch: messages
UPDATE public.app_settings SET value = jsonb_build_object('messages', true) || coalesce(value, '{}'::jsonb) WHERE key = 'client_tools';

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
    'referral_reward', coalesce((SELECT value->>'referral_reward' FROM public.app_settings WHERE key = 'client_tools'), ''),
    'income_sheets', coalesce(n, 0));
END $$;
REVOKE ALL ON FUNCTION public.my_portal_features() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.my_portal_features() TO authenticated;
