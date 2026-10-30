-- ═══════════════════════════════════════════════════════════
--  TaxMate V51 — Website visitors (who clicks the app, from where)
--  • Every page opened is counted, also by people who are not signed in
--    (/join, /ird-codes, /login, tax calculator …).
--  • Anonymous: a random visitor id kept in the browser — no name, phone, IP or cookie is stored.
--  • TaxMate admins are never counted. Kept 180 days. Read only through admin_visitor_stats().
--  Safe to re-run.
-- ═══════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS public.site_visits (
  id         BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  visitor    TEXT NOT NULL CHECK (visitor ~ '^[a-z0-9]{8,40}$'),
  session    TEXT CHECK (session IS NULL OR session ~ '^[a-z0-9]{8,40}$'),
  event      TEXT NOT NULL DEFAULT 'view' CHECK (event IN ('view', 'register')),
  path       TEXT NOT NULL CHECK (length(path) <= 80),
  source     TEXT NOT NULL DEFAULT 'direct' CHECK (source ~ '^[a-z0-9._-]{1,40}$'),
  campaign   TEXT CHECK (campaign IS NULL OR campaign ~ '^[a-z0-9._-]{1,40}$'),
  referrer   TEXT CHECK (referrer IS NULL OR length(referrer) <= 80),
  device     TEXT NOT NULL DEFAULT 'desktop' CHECK (device IN ('mobile', 'tablet', 'desktop')),
  signed_in  BOOLEAN NOT NULL DEFAULT FALSE
);
CREATE INDEX IF NOT EXISTS site_visits_time_idx ON public.site_visits (created_at DESC);
CREATE INDEX IF NOT EXISTS site_visits_visitor_idx ON public.site_visits (visitor, created_at DESC);
ALTER TABLE public.site_visits ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.site_visits FROM anon, authenticated;   -- no direct access; only the two functions below

-- Called by the app on every page (anyone, signed in or not). Quietly ignores bad or excessive input.
CREATE OR REPLACE FUNCTION public.log_visit(p_visitor TEXT, p_session TEXT, p_path TEXT, p_source TEXT, p_campaign TEXT,
                                            p_referrer TEXT, p_device TEXT, p_event TEXT DEFAULT 'view')
RETURNS VOID LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v TEXT := lower(left(coalesce(p_visitor, ''), 40)); s TEXT := lower(left(coalesce(p_session, ''), 40));
        pth TEXT := left(coalesce(p_path, '/'), 80); src TEXT := lower(left(coalesce(nullif(trim(p_source), ''), 'direct'), 40));
        cmp TEXT := lower(left(nullif(trim(coalesce(p_campaign, '')), ''), 40)); ev TEXT := coalesce(p_event, 'view');
BEGIN
  IF auth.uid() IS NOT NULL AND EXISTS (SELECT 1 FROM public.profiles WHERE id = auth.uid() AND role = 'admin') THEN RETURN; END IF;
  IF v !~ '^[a-z0-9]{8,40}$' OR ev NOT IN ('view', 'register') OR pth !~ '^/[A-Za-z0-9/_:-]*$' THEN RETURN; END IF;
  IF s !~ '^[a-z0-9]{8,40}$' THEN s := NULL; END IF;
  IF src !~ '^[a-z0-9._-]{1,40}$' THEN src := 'other'; END IF;
  IF cmp IS NOT NULL AND cmp !~ '^[a-z0-9._-]{1,40}$' THEN cmp := NULL; END IF;
  -- same page again within 30 seconds = one view; at most 120 views per visitor an hour; a hard cap against floods
  IF ev = 'view' AND EXISTS (SELECT 1 FROM public.site_visits WHERE visitor = v AND path = pth AND event = 'view' AND created_at > NOW() - INTERVAL '30 seconds') THEN RETURN; END IF;
  IF (SELECT count(*) FROM public.site_visits WHERE visitor = v AND created_at > NOW() - INTERVAL '1 hour') >= 120 THEN RETURN; END IF;
  IF (SELECT count(*) FROM public.site_visits WHERE created_at > NOW() - INTERVAL '1 hour') >= 20000 THEN RETURN; END IF;
  INSERT INTO public.site_visits (visitor, session, event, path, source, campaign, referrer, device, signed_in)
  VALUES (v, s, ev, pth, src, cmp, nullif(left(lower(regexp_replace(coalesce(p_referrer, ''), '[^A-Za-z0-9.-]', '', 'g')), 80), ''),
          CASE WHEN p_device IN ('mobile', 'tablet', 'desktop') THEN p_device ELSE 'desktop' END, auth.uid() IS NOT NULL);
  IF random() < 0.002 THEN DELETE FROM public.site_visits WHERE created_at < NOW() - INTERVAL '180 days'; END IF;
END $$;
REVOKE ALL ON FUNCTION public.log_visit(TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.log_visit(TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT) TO anon, authenticated;

-- Admin report (Activity & Users → Visitors)
CREATE OR REPLACE FUNCTION public.admin_visitor_stats(p_days INT DEFAULT 30)
RETURNS JSONB LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE d INT := greatest(1, least(coalesce(p_days, 30), 180)); since TIMESTAMPTZ; today TIMESTAMPTZ;
BEGIN
  IF NOT is_admin() THEN RAISE EXCEPTION 'Admins only'; END IF;
  today := date_trunc('day', NOW() AT TIME ZONE 'Asia/Colombo') AT TIME ZONE 'Asia/Colombo';
  since := today - make_interval(days => d - 1);
  RETURN jsonb_build_object(
    'days', d,
    'visits',        (SELECT count(*) FROM site_visits WHERE event = 'view' AND created_at >= since),
    'visitors',      (SELECT count(DISTINCT visitor) FROM site_visits WHERE event = 'view' AND created_at >= since),
    'new_visitors',  (SELECT count(*) FROM (SELECT visitor FROM site_visits GROUP BY visitor HAVING min(created_at) >= since) x),
    'today_visits',  (SELECT count(*) FROM site_visits WHERE event = 'view' AND created_at >= today),
    'today_visitors',(SELECT count(DISTINCT visitor) FROM site_visits WHERE event = 'view' AND created_at >= today),
    'live',          (SELECT count(DISTINCT visitor) FROM site_visits WHERE created_at > NOW() - INTERVAL '5 minutes'),
    'registrations', (SELECT count(*) FROM site_visits WHERE event = 'register' AND created_at >= since),
    'guests',        (SELECT count(DISTINCT visitor) FROM site_visits WHERE event = 'view' AND NOT signed_in AND created_at >= since),
    'daily', (SELECT coalesce(jsonb_agg(jsonb_build_object('day', to_char(g, 'YYYY-MM-DD'), 'visits', coalesce(x.visits, 0), 'visitors', coalesce(x.visitors, 0)) ORDER BY g), '[]'::jsonb)
              FROM generate_series((today - INTERVAL '29 days') AT TIME ZONE 'Asia/Colombo', today AT TIME ZONE 'Asia/Colombo', INTERVAL '1 day') g
              LEFT JOIN (SELECT (created_at AT TIME ZONE 'Asia/Colombo')::date dd, count(*) visits, count(DISTINCT visitor) visitors
                         FROM site_visits WHERE event = 'view' AND created_at >= today - INTERVAL '29 days' GROUP BY 1) x ON x.dd = g::date),
    'pages', (SELECT coalesce(jsonb_agg(row_to_json(t) ORDER BY t.visits DESC), '[]'::jsonb) FROM (
               SELECT path, count(*) visits, count(DISTINCT visitor) visitors FROM site_visits
               WHERE event = 'view' AND created_at >= since GROUP BY path ORDER BY count(*) DESC LIMIT 15) t),
    'sources', (SELECT coalesce(jsonb_agg(row_to_json(t) ORDER BY t.visitors DESC), '[]'::jsonb) FROM (
               SELECT source, count(DISTINCT visitor) FILTER (WHERE event = 'view') visitors, count(*) FILTER (WHERE event = 'view') visits,
                      count(*) FILTER (WHERE event = 'register') registrations
               FROM site_visits WHERE created_at >= since GROUP BY source ORDER BY 2 DESC LIMIT 12) t),
    'campaigns', (SELECT coalesce(jsonb_agg(row_to_json(t) ORDER BY t.visitors DESC), '[]'::jsonb) FROM (
               SELECT campaign, min(source) source, count(DISTINCT visitor) FILTER (WHERE event = 'view') visitors,
                      count(*) FILTER (WHERE event = 'register') registrations
               FROM site_visits WHERE created_at >= since AND campaign IS NOT NULL GROUP BY campaign ORDER BY 3 DESC LIMIT 15) t),
    'devices', (SELECT coalesce(jsonb_object_agg(device, n), '{}'::jsonb) FROM (
               SELECT device, count(DISTINCT visitor) n FROM site_visits WHERE event = 'view' AND created_at >= since GROUP BY device) t),
    'referrers', (SELECT coalesce(jsonb_agg(row_to_json(t) ORDER BY t.visitors DESC), '[]'::jsonb) FROM (
               SELECT referrer, count(DISTINCT visitor) visitors FROM site_visits
               WHERE event = 'view' AND created_at >= since AND referrer IS NOT NULL GROUP BY referrer ORDER BY 2 DESC LIMIT 8) t),
    'recent', (SELECT coalesce(jsonb_agg(row_to_json(t)), '[]'::jsonb) FROM (
               SELECT created_at, event, path, source, campaign, device, signed_in, right(visitor, 4) AS who
               FROM site_visits ORDER BY created_at DESC LIMIT 40) t));
END $$;
REVOKE ALL ON FUNCTION public.admin_visitor_stats(INT) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_visitor_stats(INT) TO authenticated;

SELECT to_regclass('public.site_visits') IS NOT NULL AS visits_table,
       has_function_privilege('anon', 'public.log_visit(text,text,text,text,text,text,text,text)', 'execute') AS anon_can_log;
