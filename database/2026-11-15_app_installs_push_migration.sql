-- ═══════════════════════════════════════════════════════════
--  TaxMate V59 — Who installed the app + phone (push) notifications
--  • app_installs: one row per phone / computer that installed or opens the
--    installed app (random device id, no personal data). Linked to the client
--    when they are signed in. Admin: badge in the Clients list, count in
--    Activity & Users. Admin devices are kept apart and not counted.
--  • push_subscriptions: phones that allowed notifications (Web Push).
--    Every client notification (bell) is also pushed to that client's phones;
--    admins get a push for new client messages, bank slips, tax receipts,
--    online registrations and service requests.
--  • The push itself is sent by the Edge Function "push" (pg_net call with the
--    secret cron key from Vault). Its VAPID keys live in push_config, which
--    only the function can read.
--  Safe to re-run.
-- ═══════════════════════════════════════════════════════════

-- ═══ 1. App installs ═══════════════════════════════════════
CREATE TABLE IF NOT EXISTS public.app_installs (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  device       TEXT NOT NULL UNIQUE CHECK (device ~ '^[a-z0-9]{8,40}$'),
  user_id      UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  client_id    UUID REFERENCES public.clients(id) ON DELETE SET NULL,
  is_admin     BOOLEAN NOT NULL DEFAULT FALSE,
  platform     TEXT NOT NULL DEFAULT 'other' CHECK (platform IN ('android', 'ios', 'windows', 'mac', 'linux', 'other')),
  installed_at TIMESTAMPTZ,                    -- the browser said "installed" (Android / computer)
  first_open   TIMESTAMPTZ,                    -- first time opened from the home screen icon
  last_open    TIMESTAMPTZ,
  opens        INT NOT NULL DEFAULT 0,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS app_installs_client_idx ON public.app_installs (client_id) WHERE client_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS app_installs_created_idx ON public.app_installs (created_at);
ALTER TABLE public.app_installs ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Admins read app installs" ON public.app_installs;
CREATE POLICY "Admins read app installs" ON public.app_installs FOR SELECT USING (is_admin());

-- Called by the app: p_event 'install' (browser install event) or 'open' (opened as the installed app)
CREATE OR REPLACE FUNCTION public.log_app_open(p_device TEXT, p_platform TEXT, p_event TEXT DEFAULT 'open')
RETURNS VOID LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE uid UUID := auth.uid(); cid UUID; adm BOOLEAN := FALSE; plat TEXT;
BEGIN
  IF p_device IS NULL OR p_device !~ '^[a-z0-9]{8,40}$' OR p_event NOT IN ('install', 'open') THEN RETURN; END IF;
  plat := CASE WHEN p_platform IN ('android', 'ios', 'windows', 'mac', 'linux') THEN p_platform ELSE 'other' END;
  IF uid IS NOT NULL THEN
    adm := public._real_admin();
    IF NOT adm THEN cid := public._my_own_client_id(); END IF;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.app_installs WHERE device = p_device) THEN
    IF (SELECT count(*) FROM public.app_installs WHERE created_at > NOW() - INTERVAL '1 hour') >= 500 THEN RETURN; END IF;   -- abuse cap
    INSERT INTO public.app_installs (device, user_id, client_id, is_admin, platform, installed_at, first_open, last_open, opens)
    VALUES (p_device, uid, cid, adm, plat,
            CASE WHEN p_event = 'install' THEN NOW() END,
            CASE WHEN p_event = 'open' THEN NOW() END, CASE WHEN p_event = 'open' THEN NOW() END,
            CASE WHEN p_event = 'open' THEN 1 ELSE 0 END)
    ON CONFLICT (device) DO NOTHING;
  ELSE
    UPDATE public.app_installs SET
      user_id      = coalesce(uid, user_id),
      client_id    = CASE WHEN uid IS NULL THEN client_id ELSE cid END,
      is_admin     = CASE WHEN uid IS NULL THEN is_admin ELSE adm END,
      platform     = CASE WHEN plat <> 'other' THEN plat ELSE platform END,
      installed_at = CASE WHEN p_event = 'install' THEN coalesce(installed_at, NOW()) ELSE installed_at END,
      first_open   = CASE WHEN p_event = 'open' THEN coalesce(first_open, NOW()) ELSE first_open END,
      last_open    = CASE WHEN p_event = 'open' THEN NOW() ELSE last_open END,
      opens        = opens + CASE WHEN p_event = 'open' AND (last_open IS NULL OR last_open < NOW() - INTERVAL '10 minutes') THEN 1 ELSE 0 END
    WHERE device = p_device;
  END IF;
END $$;
REVOKE ALL ON FUNCTION public.log_app_open(TEXT, TEXT, TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.log_app_open(TEXT, TEXT, TEXT) TO anon, authenticated;

-- ═══ 2. Push subscriptions + keys ══════════════════════════
CREATE TABLE IF NOT EXISTS public.push_config (
  id          INT PRIMARY KEY DEFAULT 1 CHECK (id = 1),
  public_key  TEXT NOT NULL,                  -- VAPID public key (base64url) — shown to browsers
  private_jwk JSONB NOT NULL,                 -- VAPID private key — only the Edge Function reads it
  subject     TEXT NOT NULL DEFAULT 'mailto:info@taxmatesolutions.com',
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
ALTER TABLE public.push_config ENABLE ROW LEVEL SECURITY;   -- no policies: service role only
REVOKE ALL ON public.push_config FROM anon, authenticated;

CREATE TABLE IF NOT EXISTS public.push_subscriptions (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  client_id   UUID REFERENCES public.clients(id) ON DELETE CASCADE,
  is_admin    BOOLEAN NOT NULL DEFAULT FALSE,
  endpoint    TEXT NOT NULL UNIQUE CHECK (length(endpoint) <= 1000),
  p256dh      TEXT NOT NULL CHECK (p256dh ~ '^[A-Za-z0-9_-]{80,100}$'),
  auth        TEXT NOT NULL CHECK (auth ~ '^[A-Za-z0-9_-]{16,30}$'),
  device      TEXT CHECK (device IS NULL OR device ~ '^[a-z0-9]{8,40}$'),
  platform    TEXT,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  last_ok_at  TIMESTAMPTZ,
  fail_count  INT NOT NULL DEFAULT 0,
  last_error  TEXT
);
CREATE INDEX IF NOT EXISTS push_subs_client_idx ON public.push_subscriptions (client_id);
CREATE INDEX IF NOT EXISTS push_subs_admin_idx ON public.push_subscriptions (is_admin) WHERE is_admin;
ALTER TABLE public.push_subscriptions ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Admins read push subscriptions" ON public.push_subscriptions;
CREATE POLICY "Admins read push subscriptions" ON public.push_subscriptions FOR SELECT USING (is_admin());

-- Only real push services (the Edge Function calls these addresses)
CREATE OR REPLACE FUNCTION public._push_endpoint_ok(p TEXT) RETURNS BOOLEAN LANGUAGE sql IMMUTABLE AS $$
  SELECT coalesce(p ~ '^https://(fcm\.googleapis\.com|updates\.push\.services\.mozilla\.com|[a-z0-9.-]+\.notify\.windows\.com|web\.push\.apple\.com|[a-z0-9.-]+\.push\.apple\.com)/', FALSE)
$$;

-- App: VAPID public key (NULL = phone notifications not set up yet)
CREATE OR REPLACE FUNCTION public.push_public_key() RETURNS TEXT LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT public_key FROM public.push_config WHERE id = 1
$$;
REVOKE ALL ON FUNCTION public.push_public_key() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.push_public_key() TO authenticated;

-- App: save this phone (client = own account, never a family member / preview)
CREATE OR REPLACE FUNCTION public.save_push_subscription(p_endpoint TEXT, p_p256dh TEXT, p_auth TEXT, p_device TEXT, p_platform TEXT)
RETURNS VOID LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE uid UUID := auth.uid(); adm BOOLEAN; cid UUID;
BEGIN
  IF uid IS NULL THEN RAISE EXCEPTION 'Please sign in again.'; END IF;
  IF public._view_as() IS NOT NULL THEN RAISE EXCEPTION 'Not in a preview.'; END IF;
  IF NOT public._push_endpoint_ok(p_endpoint) THEN RAISE EXCEPTION 'This browser''s notification service is not supported.'; END IF;
  adm := public._real_admin();
  IF NOT adm THEN
    cid := public._my_own_client_id();
    IF cid IS NULL THEN RAISE EXCEPTION 'Please sign in again.'; END IF;
  END IF;
  IF (SELECT count(*) FROM public.push_subscriptions WHERE user_id = uid AND endpoint <> p_endpoint) >= 10 THEN
    DELETE FROM public.push_subscriptions WHERE id = (SELECT id FROM public.push_subscriptions WHERE user_id = uid ORDER BY created_at LIMIT 1);
  END IF;
  INSERT INTO public.push_subscriptions (user_id, client_id, is_admin, endpoint, p256dh, auth, device, platform)
  VALUES (uid, cid, adm, p_endpoint, p_p256dh, p_auth,
          CASE WHEN p_device ~ '^[a-z0-9]{8,40}$' THEN p_device END, left(p_platform, 20))
  ON CONFLICT (endpoint) DO UPDATE SET user_id = EXCLUDED.user_id, client_id = EXCLUDED.client_id, is_admin = EXCLUDED.is_admin,
    p256dh = EXCLUDED.p256dh, auth = EXCLUDED.auth, device = EXCLUDED.device, platform = EXCLUDED.platform,
    fail_count = 0, last_error = NULL;
END $$;
REVOKE ALL ON FUNCTION public.save_push_subscription(TEXT, TEXT, TEXT, TEXT, TEXT) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.save_push_subscription(TEXT, TEXT, TEXT, TEXT, TEXT) TO authenticated;

CREATE OR REPLACE FUNCTION public.remove_my_push_subscription(p_endpoint TEXT)
RETURNS VOID LANGUAGE sql SECURITY DEFINER SET search_path = public AS $$
  DELETE FROM public.push_subscriptions WHERE endpoint = p_endpoint AND user_id = auth.uid();
$$;
REVOKE ALL ON FUNCTION public.remove_my_push_subscription(TEXT) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.remove_my_push_subscription(TEXT) TO authenticated;

-- ═══ 3. Send: queue a call to the "push" Edge Function ═════
CREATE OR REPLACE FUNCTION public._push_send(p_to TEXT, p_client UUID, p_title TEXT, p_body TEXT, p_url TEXT, p_tag TEXT)
RETURNS VOID LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM public.push_config WHERE id = 1) THEN RETURN; END IF;
  IF p_to = 'client' AND NOT EXISTS (SELECT 1 FROM public.push_subscriptions WHERE client_id = p_client AND NOT is_admin) THEN RETURN; END IF;
  IF p_to = 'admin' AND NOT EXISTS (SELECT 1 FROM public.push_subscriptions WHERE is_admin) THEN RETURN; END IF;
  PERFORM net.http_post(
    url := 'https://qipehxixvulvrubjifvi.supabase.co/functions/v1/push',
    headers := jsonb_build_object('Content-Type', 'application/json',
                 'Authorization', 'Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InFpcGVoeGl4dnVsdnJ1YmppZnZpIiwicm9sZSI6ImFub24iLCJpYXQiOjE3OTE5MTE3NTUsImV4cCI6MjEwNzQ4Nzc1NX0.52tQGPTJTBVAsH7QPeyRNRBbrYCYbi9lDSfaoPSWlu4',
                 'x-cron-key', (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'taxmate_cron_key' LIMIT 1)),
    body := jsonb_build_object('action', 'send', 'to', p_to, 'client_id', p_client, 'title', left(coalesce(p_title, 'TaxMate'), 120),
                 'body', left(coalesce(p_body, ''), 240), 'url', coalesce(p_url, CASE WHEN p_to = 'admin' THEN '/admin' ELSE '/client' END), 'tag', p_tag),
    timeout_milliseconds := 20000);
EXCEPTION WHEN OTHERS THEN
  RAISE WARNING 'push not queued: %', SQLERRM;   -- never block the real change
END $$;
REVOKE ALL ON FUNCTION public._push_send(TEXT, UUID, TEXT, TEXT, TEXT, TEXT) FROM PUBLIC, anon, authenticated;

-- Every bell notification for a client → that client's phones
CREATE OR REPLACE FUNCTION public._push_client_notification() RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  PERFORM public._push_send('client', NEW.client_id, NEW.title, NEW.body, coalesce(NEW.link, '/client'), 'n' || left(NEW.id::text, 8));
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS trg_push_client_notification ON public.client_notifications;
CREATE TRIGGER trg_push_client_notification AFTER INSERT ON public.client_notifications FOR EACH ROW EXECUTE FUNCTION public._push_client_notification();

-- Admin pushes
CREATE OR REPLACE FUNCTION public._push_admin_event() RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE nm TEXT;
BEGIN
  IF TG_TABLE_NAME = 'clients' THEN
    IF NEW.source = 'self_registration' THEN
      PERFORM public._push_send('admin', NULL, '🆕 New client registered', NEW.full_name, '/admin/clients/' || NEW.id, 'reg');
    END IF;
    RETURN NEW;
  END IF;
  SELECT full_name INTO nm FROM public.clients WHERE id = NEW.client_id;
  nm := coalesce(nm, 'Client');
  IF TG_TABLE_NAME = 'messages' THEN
    IF NEW.sender_role = 'client' THEN
      PERFORM public._push_send('admin', NULL, '💬 ' || nm, left(NEW.body, 200), '/admin/messages?client=' || NEW.client_id, 'msg' || left(NEW.client_id::text, 8));
    END IF;
  ELSIF TG_TABLE_NAME = 'payments' THEN
    IF NEW.status = 'review' THEN
      PERFORM public._push_send('admin', NULL, '🧾 Bank slip from ' || nm, _rs(NEW.amount) || ' — check & confirm', '/admin/payments', 'pay');
    END IF;
  ELSIF TG_TABLE_NAME = 'tax_payments' THEN
    IF NEW.status = 'paid' AND NEW.paid_by_role = 'client' AND OLD.status IS DISTINCT FROM 'paid' THEN
      PERFORM public._push_send('admin', NULL, '🧾 ' || nm || ' paid tax',
        CASE WHEN NEW.kind = 'instalment' THEN NEW.period || ' instalment' ELSE 'APIT ' || NEW.period END || ' · ' || _rs(coalesce(NEW.paid_amount, NEW.amount)) || ' — check the receipt',
        '/admin/clients/' || NEW.client_id || '?tab=returns', 'tax');
    END IF;
  ELSIF TG_TABLE_NAME = 'service_requests' THEN
    PERFORM public._push_send('admin', NULL, '📅 ' || nm || ' booked a service', NEW.service, '/admin/service-requests', 'sr');
  END IF;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS trg_push_admin_msg ON public.messages;
CREATE TRIGGER trg_push_admin_msg AFTER INSERT ON public.messages FOR EACH ROW EXECUTE FUNCTION public._push_admin_event();
DROP TRIGGER IF EXISTS trg_push_admin_pay ON public.payments;
CREATE TRIGGER trg_push_admin_pay AFTER INSERT ON public.payments FOR EACH ROW EXECUTE FUNCTION public._push_admin_event();
DROP TRIGGER IF EXISTS trg_push_admin_tax ON public.tax_payments;
CREATE TRIGGER trg_push_admin_tax AFTER UPDATE OF status ON public.tax_payments FOR EACH ROW EXECUTE FUNCTION public._push_admin_event();
DROP TRIGGER IF EXISTS trg_push_admin_sr ON public.service_requests;
CREATE TRIGGER trg_push_admin_sr AFTER INSERT ON public.service_requests FOR EACH ROW EXECUTE FUNCTION public._push_admin_event();
DROP TRIGGER IF EXISTS trg_push_admin_reg ON public.clients;
CREATE TRIGGER trg_push_admin_reg AFTER INSERT ON public.clients FOR EACH ROW EXECUTE FUNCTION public._push_admin_event();

-- ═══ 4. Admin report ═══════════════════════════════════════
CREATE OR REPLACE FUNCTION public.admin_app_installs() RETURNS JSONB LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE r JSONB;
BEGIN
  IF NOT is_admin() THEN RAISE EXCEPTION 'Admins only'; END IF;
  WITH d AS (SELECT * FROM public.app_installs WHERE NOT is_admin)
  SELECT jsonb_build_object(
    'total',        (SELECT count(*) FROM d),
    'clients',      (SELECT count(DISTINCT client_id) FROM d WHERE client_id IS NOT NULL),
    'guests',       (SELECT count(*) FROM d WHERE user_id IS NULL),
    'new_7',        (SELECT count(*) FROM d WHERE created_at > NOW() - INTERVAL '7 days'),
    'new_30',       (SELECT count(*) FROM d WHERE created_at > NOW() - INTERVAL '30 days'),
    'active_30',    (SELECT count(*) FROM d WHERE last_open > NOW() - INTERVAL '30 days'),
    'by_platform',  (SELECT coalesce(jsonb_object_agg(platform, n), '{}') FROM (SELECT platform, count(*) n FROM d GROUP BY 1) x),
    'per_day',      (SELECT coalesce(jsonb_agg(jsonb_build_object('day', day, 'n', n) ORDER BY day), '[]') FROM (
                       SELECT (created_at AT TIME ZONE 'Asia/Colombo')::date AS day, count(*) n FROM d
                        WHERE created_at > NOW() - INTERVAL '30 days' GROUP BY 1) x),
    'push_clients', (SELECT count(DISTINCT client_id) FROM public.push_subscriptions WHERE NOT is_admin),
    'push_devices', (SELECT count(*) FROM public.push_subscriptions WHERE NOT is_admin),
    'push_admin',   (SELECT count(*) FROM public.push_subscriptions WHERE is_admin),
    'push_ready',   EXISTS (SELECT 1 FROM public.push_config WHERE id = 1),
    'admin_devices',(SELECT count(*) FROM public.app_installs WHERE is_admin),
    'latest',       (SELECT coalesce(jsonb_agg(x ORDER BY x.at DESC), '[]') FROM (
                       SELECT d.client_id, c.full_name AS name, c.client_no, d.platform, d.created_at AS at, d.last_open, d.opens,
                              EXISTS (SELECT 1 FROM public.push_subscriptions s WHERE s.client_id = d.client_id AND NOT s.is_admin) AS push
                         FROM d LEFT JOIN public.clients c ON c.id = d.client_id
                        ORDER BY d.created_at DESC LIMIT 100) x)
  ) INTO r;
  RETURN r;
END $$;
REVOKE ALL ON FUNCTION public.admin_app_installs() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_app_installs() TO authenticated;

SELECT to_regclass('public.app_installs') IS NOT NULL AS installs_table,
       to_regclass('public.push_subscriptions') IS NOT NULL AS push_table,
       (SELECT count(*) FROM pg_trigger WHERE tgname LIKE 'trg_push_%') AS push_triggers;
