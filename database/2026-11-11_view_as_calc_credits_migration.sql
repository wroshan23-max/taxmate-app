-- ═══════════════════════════════════════════════════════════
--  TaxMate V53 — (a) Admin "View as client"  (b) Tax calculator credits
--
--  (a) An admin can open the client portal exactly as one client sees it — READ ONLY.
--      The app sends the header  x-view-as: <client id>  on database reads.
--      • my_client_id() gives that client only to a real (two-step-verified) admin,
--        and only for reads (GET / HEAD, or a STABLE read function). Any write → no client → refused.
--      • is_admin() is FALSE while previewing, so the admin sees only what that client sees.
--      • A client (non-admin) sending the header is ignored. Each preview is logged.
--
--  (b) Calculator credits
--      • 🧮 Advanced Tax Calculator: 1 credit per calculation (same figures again within 24 h = free).
--      • ⚡ Quick Tax Check: 5 free uses per client, then 1 credit.
--      • Plans marked "includes_calc" (Standard + Premium) = unlimited.
--      • Packs (Settings → Plans): 10 = Rs. 500 · 25 = Rs. 1,000 · 60 = Rs. 2,000.
--        Buying makes an invoice; when it is paid the credits are added automatically
--        (switch "auto_credit" on) or wait for an admin to approve (switch off).
--        Admins can also add / remove credits by hand.
--  Safe to re-run.
-- ═══════════════════════════════════════════════════════════

-- ═══ A1. Who is previewing? ═════════════════════════════════
-- The real admin check (the old is_admin)
CREATE OR REPLACE FUNCTION public._real_admin() RETURNS BOOLEAN LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (SELECT 1 FROM public.profiles WHERE id = auth.uid() AND role = 'admin') AND public._mfa_ok();
$$;
REVOKE ALL ON FUNCTION public._real_admin() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public._real_admin() TO authenticated;

-- Client id in the x-view-as request header (NULL when absent / not a UUID / not an API request)
CREATE OR REPLACE FUNCTION public._view_as() RETURNS UUID LANGUAGE sql STABLE SET search_path = public AS $$
  SELECT CASE WHEN h ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' THEN h::uuid END
  FROM (SELECT lower(nullif(current_setting('request.headers', true), '')::json->>'x-view-as') AS h) x;
$$;
REVOKE ALL ON FUNCTION public._view_as() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public._view_as() TO authenticated;

-- Is this API request a read? GET / HEAD, or POST /rpc/<fn> where every <fn> is a STABLE / IMMUTABLE function
CREATE OR REPLACE FUNCTION public._view_as_readonly() RETURNS BOOLEAN LANGUAGE sql STABLE SET search_path = public AS $$
  SELECT CASE
    WHEN m IN ('GET', 'HEAD') THEN TRUE
    WHEN m = 'POST' AND fn IS NOT NULL THEN
      EXISTS (SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace WHERE n.nspname = 'public' AND p.proname = fn)
      AND NOT EXISTS (SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace WHERE n.nspname = 'public' AND p.proname = fn AND p.provolatile = 'v')
    ELSE FALSE END
  FROM (SELECT upper(coalesce(current_setting('request.method', true), '')) AS m,
               substring(coalesce(current_setting('request.path', true), '') FROM '(?:^|/)rpc/([A-Za-z0-9_]+)/?$') AS fn) x;
$$;
REVOKE ALL ON FUNCTION public._view_as_readonly() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public._view_as_readonly() TO authenticated;

-- ═══ A2. is_admin() / my_client_id() understand previews ════
CREATE OR REPLACE FUNCTION public.is_admin() RETURNS BOOLEAN LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT public._real_admin() AND public._view_as() IS NULL;
$$;

CREATE OR REPLACE FUNCTION public.my_client_id() RETURNS UUID LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT CASE
    WHEN public._view_as() IS NOT NULL AND public._real_admin() THEN
      (SELECT c.id FROM public.clients c WHERE c.id = public._view_as() AND public._view_as_readonly())
    ELSE (SELECT id FROM public.clients WHERE profile_id = auth.uid() AND public._mfa_ok() LIMIT 1)
  END;
$$;

-- Profile-change requests were read by profile, so a preview could not see them; read by client too
DROP POLICY IF EXISTS "Clients can read own requests" ON public.update_requests;
CREATE POLICY "Clients can read own requests" ON public.update_requests FOR SELECT USING (profile_id = auth.uid() OR client_id = my_client_id());

-- ═══ A3. Log of previews ════════════════════════════════════
CREATE TABLE IF NOT EXISTS public.admin_view_log (
  id         BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  admin_id   UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  client_id  UUID REFERENCES public.clients(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS admin_view_log_client_idx ON public.admin_view_log (client_id, created_at DESC);
ALTER TABLE public.admin_view_log ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Admins read view log" ON public.admin_view_log;
CREATE POLICY "Admins read view log" ON public.admin_view_log FOR SELECT USING (is_admin());

CREATE OR REPLACE FUNCTION public.admin_log_view_as(p_client UUID)
RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE c public.clients;
BEGIN
  IF NOT is_admin() THEN RAISE EXCEPTION 'Admins only'; END IF;
  SELECT * INTO c FROM public.clients WHERE id = p_client;
  IF c.id IS NULL THEN RAISE EXCEPTION 'Client not found.'; END IF;
  INSERT INTO public.admin_view_log (admin_id, client_id) VALUES (auth.uid(), c.id);
  RETURN jsonb_build_object('id', c.id, 'name', c.full_name, 'has_login', c.profile_id IS NOT NULL);
END $$;
REVOKE ALL ON FUNCTION public.admin_log_view_as(UUID) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_log_view_as(UUID) TO authenticated;

-- ═══ B1. Settings + plans ═══════════════════════════════════
INSERT INTO public.app_settings (key, value) VALUES ('calc_credits', jsonb_build_object(
  'charge', true, 'auto_credit', true, 'free_quick', 5,
  'packs', jsonb_build_array(jsonb_build_object('credits', 10, 'price', 500),
                             jsonb_build_object('credits', 25, 'price', 1000),
                             jsonb_build_object('credits', 60, 'price', 2000))))
ON CONFLICT (key) DO NOTHING;

UPDATE public.app_settings
SET value = jsonb_set(value, '{plans}', (
  SELECT coalesce(jsonb_agg(CASE WHEN p ? 'includes_calc' THEN p
                                 ELSE p || jsonb_build_object('includes_calc', p->>'key' IN ('standard', 'premium')) END ORDER BY ord), '[]'::jsonb)
  FROM jsonb_array_elements(coalesce(value->'plans', '[]'::jsonb)) WITH ORDINALITY t(p, ord)))
WHERE key = 'plans';

-- ═══ B2. Tables ═════════════════════════════════════════════
CREATE TABLE IF NOT EXISTS public.calc_orders (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id   UUID NOT NULL REFERENCES public.clients(id) ON DELETE CASCADE,
  credits     INT NOT NULL CHECK (credits BETWEEN 1 AND 10000),
  price       NUMERIC(12,2) NOT NULL CHECK (price >= 0),
  status      TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'paid', 'credited', 'cancelled')),
  invoice_id  UUID REFERENCES public.invoices(id) ON DELETE SET NULL,
  created_by  UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  paid_at     TIMESTAMPTZ,
  credited_at TIMESTAMPTZ,
  credited_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  cancelled_at TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS calc_orders_client_idx ON public.calc_orders (client_id, created_at DESC);
CREATE INDEX IF NOT EXISTS calc_orders_status_idx ON public.calc_orders (status, created_at DESC);
CREATE INDEX IF NOT EXISTS calc_orders_invoice_idx ON public.calc_orders (invoice_id);

CREATE TABLE IF NOT EXISTS public.calc_credit_log (
  id         BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  client_id  UUID NOT NULL REFERENCES public.clients(id) ON DELETE CASCADE,
  delta      INT NOT NULL CHECK (delta BETWEEN -10000 AND 10000),
  kind       TEXT NOT NULL CHECK (kind IN ('purchase', 'grant', 'remove', 'use', 'free', 'plan')),
  tool       TEXT CHECK (tool IS NULL OR tool IN ('quick', 'advanced')),
  input_hash TEXT CHECK (input_hash IS NULL OR input_hash ~ '^[a-z0-9]{1,64}$'),
  order_id   UUID REFERENCES public.calc_orders(id) ON DELETE SET NULL,
  note       TEXT CHECK (note IS NULL OR length(note) <= 300),
  created_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS calc_credit_log_client_idx ON public.calc_credit_log (client_id, created_at DESC);
CREATE INDEX IF NOT EXISTS calc_credit_log_repeat_idx ON public.calc_credit_log (client_id, tool, input_hash, created_at DESC);

ALTER TABLE public.calc_orders     ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.calc_credit_log ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Admins read calc orders" ON public.calc_orders;
CREATE POLICY "Admins read calc orders" ON public.calc_orders FOR SELECT USING (is_admin());
DROP POLICY IF EXISTS "Clients read own calc orders" ON public.calc_orders;
CREATE POLICY "Clients read own calc orders" ON public.calc_orders FOR SELECT USING (client_id = my_client_id());
DROP POLICY IF EXISTS "Admins read calc credits" ON public.calc_credit_log;
CREATE POLICY "Admins read calc credits" ON public.calc_credit_log FOR SELECT USING (is_admin());
DROP POLICY IF EXISTS "Clients read own calc credits" ON public.calc_credit_log;
CREATE POLICY "Clients read own calc credits" ON public.calc_credit_log FOR SELECT USING (client_id = my_client_id());
-- all changes go through the functions below
REVOKE INSERT, UPDATE, DELETE ON public.calc_orders, public.calc_credit_log FROM anon, authenticated;

-- ═══ B3. Helpers ════════════════════════════════════════════
CREATE OR REPLACE FUNCTION public._calc_cfg() RETURNS JSONB LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT jsonb_build_object('charge', true, 'auto_credit', true, 'free_quick', 5, 'packs', '[]'::jsonb)
         || coalesce((SELECT value FROM public.app_settings WHERE key = 'calc_credits'), '{}'::jsonb);
$$;
REVOKE ALL ON FUNCTION public._calc_cfg() FROM PUBLIC, anon, authenticated;

-- Name of the active plan that includes unlimited calculations (NULL = none)
CREATE OR REPLACE FUNCTION public._calc_plan(p_client UUID) RETURNS TEXT LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT s.plan_name FROM public.subscriptions s
  WHERE s.client_id = p_client AND s.status = 'active'
    AND EXISTS (SELECT 1 FROM jsonb_array_elements(coalesce((SELECT value->'plans' FROM public.app_settings WHERE key = 'plans'), '[]'::jsonb)) x
                WHERE x->>'key' = s.plan_key AND coalesce((x->>'includes_calc')::boolean, false))
  LIMIT 1;
$$;
REVOKE ALL ON FUNCTION public._calc_plan(UUID) FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public._calc_balance(p_client UUID) RETURNS INT LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT greatest(coalesce(sum(delta), 0), 0)::int FROM public.calc_credit_log WHERE client_id = p_client;
$$;
REVOKE ALL ON FUNCTION public._calc_balance(UUID) FROM PUBLIC, anon, authenticated;

-- Everything the screens need about one client's credits
CREATE OR REPLACE FUNCTION public._calc_status(p_client UUID, p_history INT) RETURNS JSONB LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  WITH cfg AS (SELECT public._calc_cfg() v),
       fu AS (SELECT count(*)::int n FROM public.calc_credit_log WHERE client_id = p_client AND kind = 'free' AND tool = 'quick')
  SELECT jsonb_build_object(
    'charge', coalesce((cfg.v->>'charge')::boolean, true),
    'auto_credit', coalesce((cfg.v->>'auto_credit')::boolean, true),
    'balance', public._calc_balance(p_client),
    'plan', public._calc_plan(p_client),
    'free_quick', coalesce((cfg.v->>'free_quick')::int, 5),
    'free_used', fu.n,
    'free_left', greatest(coalesce((cfg.v->>'free_quick')::int, 5) - fu.n, 0),
    'packs', coalesce((SELECT jsonb_agg(jsonb_build_object('i', o - 1, 'credits', (p->>'credits')::int, 'price', (p->>'price')::numeric) ORDER BY o)
                       FROM jsonb_array_elements(coalesce(cfg.v->'packs', '[]'::jsonb)) WITH ORDINALITY t(p, o)
                       WHERE coalesce((p->>'credits')::int, 0) > 0 AND coalesce((p->>'price')::numeric, 0) > 0), '[]'::jsonb),
    'used_total', (SELECT count(*) FROM public.calc_credit_log WHERE client_id = p_client AND kind IN ('use', 'free', 'plan')),
    'orders', coalesce((SELECT jsonb_agg(jsonb_build_object('id', o.id, 'credits', o.credits, 'price', o.price, 'status', o.status, 'created_at', o.created_at,
                                          'credited_at', o.credited_at, 'invoice_id', o.invoice_id, 'invoice_no', i.invoice_no, 'invoice_status', i.status) ORDER BY o.created_at DESC)
                        FROM (SELECT * FROM public.calc_orders WHERE client_id = p_client
                              AND (status IN ('pending', 'paid') OR created_at > NOW() - INTERVAL '90 days') ORDER BY created_at DESC LIMIT 20) o
                        LEFT JOIN public.invoices i ON i.id = o.invoice_id), '[]'::jsonb),
    'history', coalesce((SELECT jsonb_agg(jsonb_build_object('at', l.created_at, 'delta', l.delta, 'kind', l.kind, 'tool', l.tool, 'note', l.note) ORDER BY l.created_at DESC, l.id DESC)
                         FROM (SELECT * FROM public.calc_credit_log WHERE client_id = p_client ORDER BY created_at DESC, id DESC LIMIT greatest(1, least(coalesce(p_history, 30), 200))) l), '[]'::jsonb))
  FROM cfg, fu;
$$;
REVOKE ALL ON FUNCTION public._calc_status(UUID, INT) FROM PUBLIC, anon, authenticated;

-- Add an order's credits (once)
CREATE OR REPLACE FUNCTION public._credit_calc_order(p_order UUID, p_by UUID) RETURNS BOOLEAN LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE o public.calc_orders;
BEGIN
  SELECT * INTO o FROM public.calc_orders WHERE id = p_order FOR UPDATE;
  IF o.id IS NULL OR o.status NOT IN ('pending', 'paid') THEN RETURN FALSE; END IF;
  INSERT INTO public.calc_credit_log (client_id, delta, kind, order_id, note, created_by)
  VALUES (o.client_id, o.credits, 'purchase', o.id, o.credits || ' calculations pack', p_by);
  UPDATE public.calc_orders SET status = 'credited', credited_at = NOW(), credited_by = p_by, paid_at = coalesce(paid_at, NOW()) WHERE id = o.id;
  PERFORM _notify_client(o.client_id, 'plan', o.credits || ' calculation credits added 🎉',
    'Your Tax Calculator balance is now ' || public._calc_balance(o.client_id) || ' calculations.', '/client/tax-calculator');
  RETURN TRUE;
END $$;
REVOKE ALL ON FUNCTION public._credit_calc_order(UUID, UUID) FROM PUBLIC, anon, authenticated;

-- ═══ B4. Client functions ═══════════════════════════════════
CREATE OR REPLACE FUNCTION public.my_calc_credits()
RETURNS JSONB LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE cid UUID := my_client_id();
BEGIN
  IF cid IS NULL THEN RAISE EXCEPTION 'Please sign in again.'; END IF;
  RETURN public._calc_status(cid, 30);
END $$;
REVOKE ALL ON FUNCTION public.my_calc_credits() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.my_calc_credits() TO authenticated;

-- One calculation. Returns { ok, charged, reason: plan | off | repeat | free | credit | none, balance, free_left }
CREATE OR REPLACE FUNCTION public.use_calc(p_tool TEXT, p_hash TEXT)
RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE cid UUID := my_client_id(); cfg JSONB := public._calc_cfg(); h TEXT; plan TEXT; bal INT; fq INT; fu INT;
BEGIN
  IF cid IS NULL THEN RAISE EXCEPTION 'Please sign in again.'; END IF;
  IF p_tool IS NULL OR p_tool NOT IN ('quick', 'advanced') THEN RAISE EXCEPTION 'Unknown calculator.'; END IF;
  IF p_tool = 'advanced' AND NOT _feature_on(cid, 'tax_calculator') THEN RAISE EXCEPTION 'The Tax Calculator is not available right now.'; END IF;
  h := nullif(lower(left(regexp_replace(coalesce(p_hash, ''), '[^A-Za-z0-9]', '', 'g'), 64)), '');
  PERFORM pg_advisory_xact_lock(hashtext('calc:' || cid::text));
  bal := public._calc_balance(cid);
  fq := coalesce((cfg->>'free_quick')::int, 5);
  SELECT count(*) INTO fu FROM public.calc_credit_log WHERE client_id = cid AND kind = 'free' AND tool = 'quick';

  -- same figures again within 24 hours = no new charge
  IF h IS NOT NULL AND EXISTS (SELECT 1 FROM public.calc_credit_log WHERE client_id = cid AND tool = p_tool AND input_hash = h
                               AND kind IN ('use', 'free', 'plan') AND created_at > NOW() - INTERVAL '24 hours') THEN
    RETURN jsonb_build_object('ok', true, 'charged', false, 'reason', 'repeat', 'balance', bal, 'free_left', greatest(fq - fu, 0));
  END IF;

  plan := public._calc_plan(cid);
  IF plan IS NOT NULL THEN
    IF (SELECT count(*) FROM public.calc_credit_log WHERE client_id = cid AND created_at > NOW() - INTERVAL '1 day') < 500 THEN
      INSERT INTO public.calc_credit_log (client_id, delta, kind, tool, input_hash, created_by) VALUES (cid, 0, 'plan', p_tool, h, auth.uid());
    END IF;
    RETURN jsonb_build_object('ok', true, 'charged', false, 'reason', 'plan', 'plan', plan, 'balance', bal, 'free_left', greatest(fq - fu, 0));
  END IF;

  IF NOT coalesce((cfg->>'charge')::boolean, true) THEN
    RETURN jsonb_build_object('ok', true, 'charged', false, 'reason', 'off', 'balance', bal, 'free_left', greatest(fq - fu, 0));
  END IF;

  IF p_tool = 'quick' AND fu < fq THEN
    INSERT INTO public.calc_credit_log (client_id, delta, kind, tool, input_hash, created_by) VALUES (cid, 0, 'free', 'quick', h, auth.uid());
    RETURN jsonb_build_object('ok', true, 'charged', false, 'reason', 'free', 'balance', bal, 'free_left', fq - fu - 1);
  END IF;

  IF bal < 1 THEN
    RETURN jsonb_build_object('ok', false, 'charged', false, 'reason', 'none', 'balance', 0, 'free_left', 0);
  END IF;
  INSERT INTO public.calc_credit_log (client_id, delta, kind, tool, input_hash, created_by) VALUES (cid, -1, 'use', p_tool, h, auth.uid());
  RETURN jsonb_build_object('ok', true, 'charged', true, 'reason', 'credit', 'balance', bal - 1, 'free_left', greatest(fq - fu, 0));
END $$;
REVOKE ALL ON FUNCTION public.use_calc(TEXT, TEXT) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.use_calc(TEXT, TEXT) TO authenticated;

-- Buy a pack → an invoice to pay. Returns { order_id, invoice_id, invoice_no, total }
CREATE OR REPLACE FUNCTION public.buy_calc_pack(p_pack INT)
RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE cid UUID := my_client_id(); pk JSONB; cr INT; pr NUMERIC; c public.clients; inv UUID; ino TEXT; v_oid UUID; due_days INT; tries INT := 0;
BEGIN
  IF cid IS NULL THEN RAISE EXCEPTION 'Please sign in again.'; END IF;
  IF NOT _feature_on(cid, 'tax_calculator') THEN RAISE EXCEPTION 'The Tax Calculator is not available right now.'; END IF;
  IF public._calc_plan(cid) IS NOT NULL THEN RAISE EXCEPTION 'Unlimited calculations are already included in your plan.'; END IF;
  pk := public._calc_cfg()->'packs'->coalesce(p_pack, -1);
  cr := coalesce((pk->>'credits')::int, 0); pr := coalesce((pk->>'price')::numeric, 0);
  IF pk IS NULL OR cr < 1 OR pr <= 0 THEN RAISE EXCEPTION 'This pack is not available. Please refresh the page.'; END IF;
  PERFORM pg_advisory_xact_lock(hashtext('calc:' || cid::text));
  IF (SELECT count(*) FROM public.calc_orders WHERE client_id = cid AND status = 'pending') >= 2 THEN
    RAISE EXCEPTION 'You already have unpaid credit packs. Please pay or cancel them first.';
  END IF;
  SELECT * INTO c FROM public.clients WHERE id = cid;
  due_days := coalesce(nullif((SELECT value->>'dueDays' FROM public.app_settings WHERE key = 'invoice'), '')::int, 14);
  LOOP
    BEGIN
      INSERT INTO public.invoices (invoice_no, issue_date, due_date, client_id, client_snapshot, subtotal, discount_pct, discount_amt, total_amount, notes, status)
      VALUES (_next_invoice_no(_sl_today()), _sl_today(), _sl_today() + least(due_days, 7), cid,
              jsonb_build_object('name', coalesce(c.full_name, ''), 'tin', coalesce(c.tin, ''), 'nic', coalesce(c.nic, ''), 'phone', coalesce(c.mobile, ''), 'email', coalesce(c.email, ''), 'address', coalesce(c.address, '')),
              pr, 0, 0, pr, (SELECT value->>'defaultNote' FROM public.app_settings WHERE key = 'invoice'), 'unpaid')
      RETURNING id, invoice_no INTO inv, ino;
      EXIT;
    EXCEPTION WHEN unique_violation THEN
      tries := tries + 1; IF tries > 5 THEN RAISE; END IF;
    END;
  END LOOP;
  INSERT INTO public.invoice_items (invoice_id, description, quantity, unit_price, discount_pct, amount, sort_order)
  VALUES (inv, 'Tax Calculator credits — ' || cr || ' calculations', 1, pr, 0, pr, 0);
  INSERT INTO public.calc_orders (client_id, credits, price, invoice_id, created_by) VALUES (cid, cr, pr, inv, auth.uid()) RETURNING id INTO v_oid;
  RETURN jsonb_build_object('order_id', v_oid, 'invoice_id', inv, 'invoice_no', ino, 'total', pr, 'credits', cr);
END $$;
REVOKE ALL ON FUNCTION public.buy_calc_pack(INT) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.buy_calc_pack(INT) TO authenticated;

-- Remove an unpaid pack (and its invoice) — not while a payment slip is being checked
CREATE OR REPLACE FUNCTION public._cancel_calc_order(p_order UUID) RETURNS VOID LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE o public.calc_orders;
BEGIN
  SELECT * INTO o FROM public.calc_orders WHERE id = p_order FOR UPDATE;
  IF o.id IS NULL OR o.status <> 'pending' THEN RAISE EXCEPTION 'Only an unpaid pack can be cancelled.'; END IF;
  IF o.invoice_id IS NOT NULL AND EXISTS (SELECT 1 FROM public.invoices WHERE id = o.invoice_id AND status = 'paid') THEN
    RAISE EXCEPTION 'This pack is already paid.';
  END IF;
  IF o.invoice_id IS NOT NULL AND EXISTS (SELECT 1 FROM public.payments WHERE invoice_id = o.invoice_id AND status = 'review') THEN
    RAISE EXCEPTION 'A payment for this pack is being checked — it cannot be cancelled now.';
  END IF;
  UPDATE public.calc_orders SET status = 'cancelled', cancelled_at = NOW() WHERE id = o.id;
  IF o.invoice_id IS NOT NULL THEN DELETE FROM public.invoices WHERE id = o.invoice_id AND status <> 'paid'; END IF;
END $$;
REVOKE ALL ON FUNCTION public._cancel_calc_order(UUID) FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.cancel_my_calc_order(p_order UUID)
RETURNS VOID LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF my_client_id() IS NULL OR NOT EXISTS (SELECT 1 FROM public.calc_orders WHERE id = p_order AND client_id = my_client_id()) THEN
    RAISE EXCEPTION 'Pack not found.';
  END IF;
  PERFORM public._cancel_calc_order(p_order);
END $$;
REVOKE ALL ON FUNCTION public.cancel_my_calc_order(UUID) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.cancel_my_calc_order(UUID) TO authenticated;

-- ═══ B5. Invoice paid → credits (auto) or wait for approval ═
CREATE OR REPLACE FUNCTION public._calc_invoice_paid() RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE r RECORD; auto BOOLEAN := coalesce((public._calc_cfg()->>'auto_credit')::boolean, true);
BEGIN
  IF NEW.status = 'paid' AND OLD.status IS DISTINCT FROM 'paid' THEN
    FOR r IN SELECT id, client_id, credits FROM public.calc_orders WHERE invoice_id = NEW.id AND status = 'pending' LOOP
      IF auto THEN
        PERFORM public._credit_calc_order(r.id, NULL);
      ELSE
        UPDATE public.calc_orders SET status = 'paid', paid_at = NOW() WHERE id = r.id;
        PERFORM _notify_client(r.client_id, 'plan', 'Payment received for ' || r.credits || ' calculations',
          'TaxMate will add the credits to your Tax Calculator shortly.', '/client/tax-calculator');
      END IF;
    END LOOP;
  END IF;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS trg_calc_invoice_paid ON public.invoices;
CREATE TRIGGER trg_calc_invoice_paid AFTER UPDATE OF status ON public.invoices
  FOR EACH ROW EXECUTE FUNCTION public._calc_invoice_paid();

-- An unpaid pack's invoice deleted (by an admin) → the pack is cancelled
CREATE OR REPLACE FUNCTION public._calc_invoice_deleted() RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  UPDATE public.calc_orders SET status = 'cancelled', cancelled_at = NOW() WHERE invoice_id = OLD.id AND status = 'pending';
  RETURN OLD;
END $$;
DROP TRIGGER IF EXISTS trg_calc_invoice_deleted ON public.invoices;
CREATE TRIGGER trg_calc_invoice_deleted BEFORE DELETE ON public.invoices
  FOR EACH ROW EXECUTE FUNCTION public._calc_invoice_deleted();

-- ═══ B6. Admin functions ════════════════════════════════════
CREATE OR REPLACE FUNCTION public.admin_calc_credits(p_client UUID)
RETURNS JSONB LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NOT is_admin() THEN RAISE EXCEPTION 'Admins only'; END IF;
  RETURN public._calc_status(p_client, 100);
END $$;
REVOKE ALL ON FUNCTION public.admin_calc_credits(UUID) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_calc_credits(UUID) TO authenticated;

-- Add (+) or remove (−) credits by hand
CREATE OR REPLACE FUNCTION public.admin_calc_adjust(p_client UUID, p_delta INT, p_note TEXT)
RETURNS INT LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE bal INT;
BEGIN
  IF NOT is_admin() THEN RAISE EXCEPTION 'Admins only'; END IF;
  IF NOT EXISTS (SELECT 1 FROM public.clients WHERE id = p_client) THEN RAISE EXCEPTION 'Client not found.'; END IF;
  IF p_delta IS NULL OR p_delta = 0 OR abs(p_delta) > 10000 THEN RAISE EXCEPTION 'Enter a number of credits (1 – 10,000).'; END IF;
  PERFORM pg_advisory_xact_lock(hashtext('calc:' || p_client::text));
  bal := public._calc_balance(p_client);
  IF bal + p_delta < 0 THEN RAISE EXCEPTION 'The client has only % credits.', bal; END IF;
  INSERT INTO public.calc_credit_log (client_id, delta, kind, note, created_by)
  VALUES (p_client, p_delta, CASE WHEN p_delta > 0 THEN 'grant' ELSE 'remove' END, nullif(left(trim(coalesce(p_note, '')), 300), ''), auth.uid());
  IF p_delta > 0 THEN
    PERFORM _notify_client(p_client, 'plan', p_delta || ' calculation credits added by TaxMate 🎁',
      'Your Tax Calculator balance is now ' || (bal + p_delta) || ' calculations.', '/client/tax-calculator');
  END IF;
  RETURN bal + p_delta;
END $$;
REVOKE ALL ON FUNCTION public.admin_calc_adjust(UUID, INT, TEXT) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_calc_adjust(UUID, INT, TEXT) TO authenticated;

-- Approve a pack (paid, or unpaid if you choose) → credits added
CREATE OR REPLACE FUNCTION public.admin_calc_approve(p_order UUID)
RETURNS VOID LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NOT is_admin() THEN RAISE EXCEPTION 'Admins only'; END IF;
  IF NOT public._credit_calc_order(p_order, auth.uid()) THEN RAISE EXCEPTION 'This pack is already credited or cancelled.'; END IF;
END $$;
REVOKE ALL ON FUNCTION public.admin_calc_approve(UUID) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_calc_approve(UUID) TO authenticated;

CREATE OR REPLACE FUNCTION public.admin_calc_cancel(p_order UUID)
RETURNS VOID LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NOT is_admin() THEN RAISE EXCEPTION 'Admins only'; END IF;
  PERFORM public._cancel_calc_order(p_order);
END $$;
REVOKE ALL ON FUNCTION public.admin_calc_cancel(UUID) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_calc_cancel(UUID) TO authenticated;

-- ═══ C. Check ═══════════════════════════════════════════════
SELECT (SELECT value FROM public.app_settings WHERE key = 'calc_credits') AS calc_settings,
       (SELECT jsonb_agg(jsonb_build_object('plan', p->>'key', 'unlimited_calc', p->'includes_calc')) FROM public.app_settings, jsonb_array_elements(value->'plans') p WHERE key = 'plans') AS plans,
       to_regclass('public.calc_credit_log') IS NOT NULL AND to_regclass('public.admin_view_log') IS NOT NULL AS tables_ok,
       public.is_admin() IS NOT NULL AS is_admin_ok;
