-- ═══════════════════════════════════════════════════════════
--  TaxMate V31 — Fixed login PIN (alternative to the authenticator app)
--  After the password, a user with a PIN must type their 6-digit PIN before
--  any client data or admin rights are available. Admin can switch the PIN
--  option on/off for everyone (Settings → Users & Access).
--  PINs are stored only as bcrypt hashes; 5 wrong tries lock the PIN.
-- ═══════════════════════════════════════════════════════════

-- 1. Global switch
INSERT INTO public.app_settings (key, value) VALUES ('security', '{"pin_login": true}'::jsonb)
ON CONFLICT (key) DO UPDATE SET value = jsonb_build_object('pin_login', true) || coalesce(public.app_settings.value, '{}'::jsonb);

CREATE OR REPLACE FUNCTION public._pin_on()
RETURNS BOOLEAN LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT coalesce((SELECT (value->>'pin_login')::boolean FROM public.app_settings WHERE key = 'security'), false);
$$;
REVOKE ALL ON FUNCTION public._pin_on() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public._pin_on() TO authenticated;

-- 2. PINs and "PIN entered in this login session" (no policies: only the functions below touch them)
CREATE TABLE IF NOT EXISTS public.user_pins (
  user_id      UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  pin_hash     TEXT NOT NULL,
  failed       INT NOT NULL DEFAULT 0,
  locked_until TIMESTAMPTZ,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
ALTER TABLE public.user_pins ENABLE ROW LEVEL SECURITY;

CREATE TABLE IF NOT EXISTS public.pin_sessions (
  session_id  UUID PRIMARY KEY,                    -- Supabase login session (JWT session_id)
  user_id     UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  verified_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS pin_sessions_user_idx ON public.pin_sessions (user_id);
ALTER TABLE public.pin_sessions ENABLE ROW LEVEL SECURITY;

CREATE OR REPLACE FUNCTION public._session_id()
RETURNS UUID LANGUAGE sql STABLE AS $$
  SELECT nullif(auth.jwt()->>'session_id', '')::uuid;
$$;

-- 3. Second-step check used by is_admin(), my_client_id() and the 2FA policies
--    OK when: authenticator code entered (aal2) · or no 2FA/PIN set up · or PIN entered this session
CREATE OR REPLACE FUNCTION public._mfa_ok()
RETURNS BOOLEAN LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, auth AS $$
  SELECT coalesce(auth.jwt()->>'aal', 'aal1') = 'aal2'
    OR (
      NOT EXISTS (SELECT 1 FROM auth.mfa_factors WHERE user_id = auth.uid() AND status = 'verified')
      AND NOT (public._pin_on() AND EXISTS (SELECT 1 FROM public.user_pins WHERE user_id = auth.uid()))
    )
    OR (
      public._pin_on()
      AND EXISTS (SELECT 1 FROM public.user_pins WHERE user_id = auth.uid())
      AND EXISTS (SELECT 1 FROM public.pin_sessions WHERE session_id = public._session_id() AND user_id = auth.uid())
    );
$$;
REVOKE ALL ON FUNCTION public._mfa_ok() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public._mfa_ok() TO authenticated;

CREATE OR REPLACE FUNCTION public.my_second_step_ok()
RETURNS BOOLEAN LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$ SELECT public._mfa_ok(); $$;
REVOKE ALL ON FUNCTION public.my_second_step_ok() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.my_second_step_ok() TO authenticated;

-- 4. What the app needs to know about my login security
CREATE OR REPLACE FUNCTION public.my_login_security()
RETURNS JSONB LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT jsonb_build_object(
    'pin_allowed', public._pin_on(),
    'has_pin', EXISTS (SELECT 1 FROM public.user_pins WHERE user_id = auth.uid()),
    'pin_ok', EXISTS (SELECT 1 FROM public.pin_sessions WHERE session_id = public._session_id() AND user_id = auth.uid()),
    'locked_until', (SELECT locked_until FROM public.user_pins WHERE user_id = auth.uid() AND locked_until > NOW()),
    'pin_set_at', (SELECT updated_at FROM public.user_pins WHERE user_id = auth.uid()),
    'second_step_ok', public._mfa_ok());
$$;
REVOKE ALL ON FUNCTION public.my_login_security() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.my_login_security() TO authenticated;

CREATE OR REPLACE FUNCTION public._pin_weak(p TEXT)
RETURNS BOOLEAN LANGUAGE sql IMMUTABLE AS $$
  SELECT p ~ '^(\d)\1{5}$'                                           -- 111111
      OR position(p IN '01234567890') > 0 OR position(p IN '09876543210') > 0   -- 123456, 654321
      OR p ~ '^(\d\d\d)\1$' OR p ~ '^(\d\d)\1\1$'                       -- 123123, 121212
      OR p ~ '^(\d)\1(\d)\2(\d)\3$';                                    -- 112233
$$;

-- 5. Set / change my PIN. Changing an existing PIN needs this login to have passed the second step.
CREATE OR REPLACE FUNCTION public.set_my_pin(p_pin TEXT)
RETURNS BOOLEAN LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, extensions AS $$
DECLARE uid UUID := auth.uid(); sid UUID := public._session_id();
BEGIN
  IF uid IS NULL THEN RAISE EXCEPTION 'Please sign in again.'; END IF;
  IF NOT public._pin_on() THEN RAISE EXCEPTION 'The PIN option is switched off. Please use the authenticator app.'; END IF;
  IF p_pin IS NULL OR p_pin !~ '^\d{6}$' THEN RAISE EXCEPTION 'The PIN must be exactly 6 digits.'; END IF;
  IF public._pin_weak(p_pin) THEN RAISE EXCEPTION 'That PIN is too easy to guess. Avoid 123456, 111111, 121212 and similar.'; END IF;
  IF NOT public._mfa_ok() THEN RAISE EXCEPTION 'Enter your current PIN or code first.'; END IF;
  INSERT INTO public.user_pins (user_id, pin_hash) VALUES (uid, crypt(p_pin, gen_salt('bf', 8)))
  ON CONFLICT (user_id) DO UPDATE SET pin_hash = EXCLUDED.pin_hash, failed = 0, locked_until = NULL, updated_at = NOW();
  -- other devices must enter the new PIN; this login stays signed in
  DELETE FROM public.pin_sessions WHERE user_id = uid;
  IF sid IS NOT NULL THEN INSERT INTO public.pin_sessions (session_id, user_id) VALUES (sid, uid) ON CONFLICT (session_id) DO UPDATE SET verified_at = NOW(), user_id = uid; END IF;
  RETURN TRUE;
END $$;
REVOKE ALL ON FUNCTION public.set_my_pin(TEXT) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.set_my_pin(TEXT) TO authenticated;

-- 6. Check my PIN after the password. Returns { ok, left, locked_until } (never raises, so failed tries are counted).
CREATE OR REPLACE FUNCTION public.verify_my_pin(p_pin TEXT)
RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, extensions AS $$
DECLARE uid UUID := auth.uid(); sid UUID := public._session_id(); r public.user_pins; f INT; lock TIMESTAMPTZ;
BEGIN
  IF uid IS NULL OR sid IS NULL THEN RETURN jsonb_build_object('ok', false, 'error', 'Please sign in again.'); END IF;
  SELECT * INTO r FROM public.user_pins WHERE user_id = uid FOR UPDATE;
  IF r.user_id IS NULL OR NOT public._pin_on() THEN RETURN jsonb_build_object('ok', false, 'error', 'No PIN is set up for this account.'); END IF;
  IF r.locked_until > NOW() THEN RETURN jsonb_build_object('ok', false, 'locked_until', r.locked_until); END IF;
  IF crypt(coalesce(p_pin, ''), r.pin_hash) = r.pin_hash THEN
    UPDATE public.user_pins SET failed = 0, locked_until = NULL WHERE user_id = uid;
    INSERT INTO public.pin_sessions (session_id, user_id) VALUES (sid, uid) ON CONFLICT (session_id) DO UPDATE SET verified_at = NOW(), user_id = uid;
    DELETE FROM public.pin_sessions WHERE user_id = uid AND verified_at < NOW() - INTERVAL '90 days';
    RETURN jsonb_build_object('ok', true);
  END IF;
  f := r.failed + 1;
  -- every 5 wrong tries: locked for 15 min, then 30, 60 … (max 24 h)
  IF f % 5 = 0 THEN lock := NOW() + least(INTERVAL '24 hours', INTERVAL '15 minutes' * power(2, f / 5 - 1)); END IF;
  UPDATE public.user_pins SET failed = f, locked_until = coalesce(lock, locked_until) WHERE user_id = uid;
  RETURN jsonb_build_object('ok', false, 'left', 5 - (f % 5), 'locked_until', lock);
END $$;
REVOKE ALL ON FUNCTION public.verify_my_pin(TEXT) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.verify_my_pin(TEXT) TO authenticated;

-- 7. Remove my PIN (only after passing the second step in this login)
CREATE OR REPLACE FUNCTION public.remove_my_pin()
RETURNS BOOLEAN LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NOT public._mfa_ok() THEN RAISE EXCEPTION 'Enter your current PIN or code first.'; END IF;
  DELETE FROM public.user_pins WHERE user_id = auth.uid();
  DELETE FROM public.pin_sessions WHERE user_id = auth.uid();
  RETURN TRUE;
END $$;
REVOKE ALL ON FUNCTION public.remove_my_pin() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.remove_my_pin() TO authenticated;

-- 8. Admin: reset a client's two-step login (authenticator + PIN)
CREATE OR REPLACE FUNCTION public.admin_reset_mfa(p_client UUID)
RETURNS INT LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, auth AS $$
DECLARE uid UUID; n INT; m INT;
BEGIN
  IF NOT is_admin() THEN RAISE EXCEPTION 'Admins only'; END IF;
  SELECT profile_id INTO uid FROM public.clients WHERE id = p_client;
  IF uid IS NULL THEN RETURN 0; END IF;
  IF EXISTS (SELECT 1 FROM public.profiles WHERE id = uid AND role = 'admin') THEN RAISE EXCEPTION 'Not for admin logins'; END IF;
  DELETE FROM auth.mfa_factors WHERE user_id = uid;
  GET DIAGNOSTICS n = ROW_COUNT;
  DELETE FROM public.user_pins WHERE user_id = uid;
  GET DIAGNOSTICS m = ROW_COUNT;
  DELETE FROM public.pin_sessions WHERE user_id = uid;
  RETURN n + m;
END $$;
REVOKE ALL ON FUNCTION public.admin_reset_mfa(UUID) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_reset_mfa(UUID) TO authenticated;

-- 9. Admin: who uses what (for Settings)
CREATE OR REPLACE FUNCTION public.admin_security_overview()
RETURNS JSONB LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, auth AS $$
BEGIN
  IF NOT is_admin() THEN RAISE EXCEPTION 'Admins only'; END IF;
  RETURN jsonb_build_object(
    'pin_login', public._pin_on(),
    'admins', (SELECT count(*) FROM profiles WHERE role = 'admin'),
    'admins_app', (SELECT count(DISTINCT p.id) FROM profiles p JOIN auth.mfa_factors f ON f.user_id = p.id AND f.status = 'verified' WHERE p.role = 'admin'),
    'admins_pin', (SELECT count(*) FROM profiles p JOIN user_pins u ON u.user_id = p.id WHERE p.role = 'admin'),
    'admins_pin_only', (SELECT count(*) FROM profiles p JOIN user_pins u ON u.user_id = p.id WHERE p.role = 'admin'
                          AND NOT EXISTS (SELECT 1 FROM auth.mfa_factors f WHERE f.user_id = p.id AND f.status = 'verified')),
    'clients_app', (SELECT count(DISTINCT c.id) FROM clients c JOIN auth.mfa_factors f ON f.user_id = c.profile_id AND f.status = 'verified'),
    'clients_pin', (SELECT count(*) FROM clients c JOIN user_pins u ON u.user_id = c.profile_id));
END $$;
REVOKE ALL ON FUNCTION public.admin_security_overview() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_security_overview() TO authenticated;

-- 10. Usage report: show PIN users too
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
                 'top', s.top, 'mfa', EXISTS (SELECT 1 FROM auth.mfa_factors f WHERE f.user_id = c.profile_id AND f.status = 'verified'),
                 'pin', public._pin_on() AND EXISTS (SELECT 1 FROM public.user_pins up WHERE up.user_id = c.profile_id))
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
       'clients_on', (SELECT count(DISTINCT c.id) FROM clients c JOIN auth.mfa_factors f ON f.user_id = c.profile_id AND f.status = 'verified'),
       'clients_pin', (SELECT count(*) FROM clients c JOIN public.user_pins up ON up.user_id = c.profile_id))
  );
END $$;
REVOKE ALL ON FUNCTION public.admin_usage_stats(INT) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_usage_stats(INT) TO authenticated;

