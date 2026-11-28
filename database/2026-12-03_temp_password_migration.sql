-- ═══════════════════════════════════════════════════════════
--  V86 — Client portal invitation with a one-time (temporary) password
--
--  Besides the invite link (client creates the password), TaxMate can now create the login
--  straight away with a random temporary password (portal-admin Edge Function, actions
--  create_temp_login / reset_temp_password). The message carries the sign-in link, the email
--  and that password. At the first sign-in the client chooses: set a new password, or keep it.
--
--  profiles.temp_password_at  — set when a temporary password is issued; cleared when the
--                               client has chosen (my_temp_password_done)
--  portal_invites.method      — 'link' (as before) or 'temp_password' (history of what was sent)
--  Safe to run more than once.
-- ═══════════════════════════════════════════════════════════

ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS temp_password_at TIMESTAMPTZ;

ALTER TABLE public.portal_invites ADD COLUMN IF NOT EXISTS method TEXT NOT NULL DEFAULT 'link';
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'portal_invites_method_chk') THEN
    ALTER TABLE public.portal_invites ADD CONSTRAINT portal_invites_method_chk CHECK (method IN ('link', 'temp_password'));
  END IF;
END $$;

-- The signed-in user has chosen (new password set, or kept the temporary one)
CREATE OR REPLACE FUNCTION public.my_temp_password_done(p_kept BOOLEAN DEFAULT false)
RETURNS VOID LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'Please sign in'; END IF;
  UPDATE public.profiles SET temp_password_at = NULL WHERE id = auth.uid() AND temp_password_at IS NOT NULL;
END $$;
REVOKE ALL ON FUNCTION public.my_temp_password_done(BOOLEAN) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.my_temp_password_done(BOOLEAN) TO authenticated;

-- Check (expect: true | true | true)
SELECT
  EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'profiles' AND column_name = 'temp_password_at') AS profiles_flag,
  EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'portal_invites' AND column_name = 'method') AS invite_method,
  EXISTS (SELECT 1 FROM pg_proc WHERE proname = 'my_temp_password_done') AS done_rpc;
