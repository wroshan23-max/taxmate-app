-- ════════════════════════════════════════════════════════════
--  TaxMate V21 — Security fixes, portal invites, password reset
--  links, public firm profile. Logins themselves are created by the
--  `portal-admin` Edge Function (official Supabase Admin API).
--  Safe to re-run. Does not change existing client/tax/invoice data.
-- ════════════════════════════════════════════════════════════

-- 1. SECURITY: sign-ups can never choose their own role
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  INSERT INTO public.profiles (id, email, full_name, role)
  VALUES (NEW.id, NEW.email, COALESCE(NEW.raw_user_meta_data->>'full_name', NEW.email), 'client')
  ON CONFLICT (id) DO NOTHING;
  RETURN NEW;
END $$;

-- 2. SECURITY: signed-in users cannot change roles unless they are admins.
--    (Runs with the caller's rights, so app users are checked; the server-side
--     Edge Function and the dashboard SQL editor are allowed.)
CREATE OR REPLACE FUNCTION public.guard_profile_role()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY INVOKER SET search_path = public AS $$
BEGIN
  IF NEW.id IS DISTINCT FROM OLD.id THEN RAISE EXCEPTION 'Profile id cannot change'; END IF;
  IF NEW.role IS DISTINCT FROM OLD.role
     AND current_user IN ('authenticated', 'anon')
     AND NOT is_admin() THEN
    RAISE EXCEPTION 'Only an admin can change user roles';
  END IF;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS profiles_guard_role ON public.profiles;
CREATE TRIGGER profiles_guard_role BEFORE UPDATE ON public.profiles
  FOR EACH ROW EXECUTE FUNCTION public.guard_profile_role();

-- 3. Portal invitations (client portal, or staff admin)
CREATE TABLE IF NOT EXISTS public.portal_invites (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  token            UUID NOT NULL UNIQUE DEFAULT gen_random_uuid(),
  email            TEXT NOT NULL,
  full_name        TEXT,
  client_id        UUID REFERENCES public.clients(id) ON DELETE CASCADE,
  role             TEXT NOT NULL DEFAULT 'client' CHECK (role IN ('client', 'admin')),
  created_by       UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
  created_at       TIMESTAMPTZ DEFAULT NOW(),
  expires_at       TIMESTAMPTZ DEFAULT NOW() + INTERVAL '14 days',
  accepted_at      TIMESTAMPTZ,
  accepted_user_id UUID,
  revoked_at       TIMESTAMPTZ,
  CONSTRAINT portal_invites_client_needed CHECK (role = 'admin' OR client_id IS NOT NULL)
);
ALTER TABLE public.portal_invites ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Admins manage invites" ON public.portal_invites;
CREATE POLICY "Admins manage invites" ON public.portal_invites FOR ALL USING (is_admin()) WITH CHECK (is_admin());

-- 4. Password reset links (sent by WhatsApp / email by the admin)
CREATE TABLE IF NOT EXISTS public.password_resets (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  token      UUID NOT NULL UNIQUE DEFAULT gen_random_uuid(),
  user_id    UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  created_by UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  expires_at TIMESTAMPTZ DEFAULT NOW() + INTERVAL '3 days',
  used_at    TIMESTAMPTZ
);
ALTER TABLE public.password_resets ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Admins manage resets" ON public.password_resets;
CREATE POLICY "Admins manage resets" ON public.password_resets FOR ALL USING (is_admin()) WITH CHECK (is_admin());

-- 5. Public, read-only: what an invite / reset link is for (shown on the set-password page)
CREATE OR REPLACE FUNCTION public.get_invite(p_token UUID)
RETURNS JSON LANGUAGE sql SECURITY DEFINER STABLE SET search_path = public AS $$
  SELECT json_build_object(
    'email', i.email, 'full_name', COALESCE(c.full_name, i.full_name), 'role', i.role,
    'status', CASE WHEN i.revoked_at IS NOT NULL THEN 'revoked'
                   WHEN i.accepted_at IS NOT NULL THEN 'used'
                   WHEN i.expires_at < NOW() THEN 'expired' ELSE 'ok' END)
  FROM portal_invites i LEFT JOIN clients c ON c.id = i.client_id
  WHERE p_token IS NOT NULL AND i.token = p_token;
$$;

CREATE OR REPLACE FUNCTION public.get_reset(p_token UUID)
RETURNS JSON LANGUAGE sql SECURITY DEFINER STABLE SET search_path = public AS $$
  SELECT json_build_object('email', p.email,
    'status', CASE WHEN r.used_at IS NOT NULL THEN 'used' WHEN r.expires_at < NOW() THEN 'expired' ELSE 'ok' END)
  FROM password_resets r JOIN profiles p ON p.id = r.user_id
  WHERE p_token IS NOT NULL AND r.token = p_token;
$$;

REVOKE ALL ON FUNCTION public.get_invite(UUID) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.get_reset(UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_invite(UUID) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.get_reset(UUID) TO anon, authenticated;

-- 6. Firm profile is public (letterheads on shared statements / invoices)
DROP POLICY IF EXISTS "Anyone reads firm profile" ON public.app_settings;
CREATE POLICY "Anyone reads firm profile" ON public.app_settings FOR SELECT USING (key = 'firm');

-- Check
SELECT json_build_object(
  'tables', (SELECT json_agg(table_name) FROM information_schema.tables WHERE table_schema = 'public' AND table_name IN ('portal_invites', 'password_resets')),
  'functions', (SELECT json_agg(proname ORDER BY proname) FROM pg_proc WHERE proname IN ('get_invite', 'get_reset', 'guard_profile_role')),
  'signup_trigger_trusts_role', (SELECT prosrc LIKE '%raw_user_meta_data->>''role''%' FROM pg_proc WHERE proname = 'handle_new_user'),
  'role_guard_trigger', (SELECT count(*) FROM pg_trigger WHERE tgname = 'profiles_guard_role'),
  'users', (SELECT count(*) FROM auth.users)
)::text AS migration_result;
