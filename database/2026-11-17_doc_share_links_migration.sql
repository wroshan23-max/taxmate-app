-- ═══════════════════════════════════════════════════════════
--  TaxMate V61 — Password-protected share links for client documents
--  • Admin ticks one or more files in a client's Documents → link + password
--    (/d/<token>). Anyone with the link AND the password can download them —
--    no TaxMate login needed. Expires after 1–30 days (or never), can be
--    switched off, or given a new password at any time.
--  • Only a bcrypt hash of the password is kept. 5 wrong passwords lock the
--    link for 15 minutes.
--  • The files are handed out by the Edge Function "onedrive" (actions
--    share_open / share_download), which calls _doc_share_check() with the
--    service role. Nobody else can read the links table except admins.
--  Safe to re-run.
-- ═══════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS public.doc_shares (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  token          UUID NOT NULL UNIQUE DEFAULT gen_random_uuid(),
  client_id      UUID NOT NULL REFERENCES public.clients(id) ON DELETE CASCADE,
  doc_ids        UUID[] NOT NULL CHECK (cardinality(doc_ids) BETWEEN 1 AND 50),
  title          TEXT CHECK (title IS NULL OR length(title) <= 120),
  pw_hash        TEXT NOT NULL,
  expires_at     TIMESTAMPTZ,                       -- NULL = no expiry
  revoked_at     TIMESTAMPTZ,
  created_by     UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  pw_changed_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  open_count     INT NOT NULL DEFAULT 0,
  download_count INT NOT NULL DEFAULT 0,
  last_opened_at TIMESTAMPTZ,
  failed_count   INT NOT NULL DEFAULT 0,
  locked_until   TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS doc_shares_client_idx ON public.doc_shares (client_id, created_at DESC);
ALTER TABLE public.doc_shares ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Admins read doc shares" ON public.doc_shares;
CREATE POLICY "Admins read doc shares" ON public.doc_shares FOR SELECT USING (is_admin());
REVOKE INSERT, UPDATE, DELETE ON public.doc_shares FROM anon, authenticated;   -- changes only through the functions below

CREATE OR REPLACE FUNCTION public._doc_share_pw_ok(p TEXT) RETURNS BOOLEAN LANGUAGE sql IMMUTABLE AS $$
  SELECT p IS NOT NULL AND length(p) BETWEEN 6 AND 64
$$;

-- Admin: make a link. Returns { id, token }
CREATE OR REPLACE FUNCTION public.admin_create_doc_share(p_client UUID, p_doc_ids UUID[], p_password TEXT, p_days INT, p_title TEXT DEFAULT NULL)
RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, extensions AS $$
DECLARE ids UUID[]; r public.doc_shares;
BEGIN
  IF NOT is_admin() THEN RAISE EXCEPTION 'Admins only'; END IF;
  IF NOT public._doc_share_pw_ok(p_password) THEN RAISE EXCEPTION 'The password must be 6–64 characters.'; END IF;
  SELECT array_agg(DISTINCT d.id) INTO ids FROM public.client_documents d WHERE d.client_id = p_client AND d.id = ANY (coalesce(p_doc_ids, '{}'));
  IF ids IS NULL OR cardinality(ids) <> (SELECT count(DISTINCT x) FROM unnest(p_doc_ids) x) THEN RAISE EXCEPTION 'Choose this client''s documents.'; END IF;
  IF cardinality(ids) > 50 THEN RAISE EXCEPTION 'Up to 50 files in one link.'; END IF;
  IF p_days IS NOT NULL AND (p_days < 0 OR p_days > 365) THEN RAISE EXCEPTION 'Check the expiry.'; END IF;
  INSERT INTO public.doc_shares (client_id, doc_ids, title, pw_hash, expires_at, created_by)
  VALUES (p_client, ids, nullif(left(trim(coalesce(p_title, '')), 120), ''), crypt(p_password, gen_salt('bf', 8)),
          CASE WHEN coalesce(p_days, 0) > 0 THEN NOW() + make_interval(days => p_days) END, auth.uid())
  RETURNING * INTO r;
  RETURN jsonb_build_object('id', r.id, 'token', r.token, 'expires_at', r.expires_at);
END $$;
REVOKE ALL ON FUNCTION public.admin_create_doc_share(UUID, UUID[], TEXT, INT, TEXT) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_create_doc_share(UUID, UUID[], TEXT, INT, TEXT) TO authenticated;

-- Admin: new password (old one stops working, lock cleared)
CREATE OR REPLACE FUNCTION public.admin_doc_share_password(p_id UUID, p_password TEXT)
RETURNS VOID LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, extensions AS $$
BEGIN
  IF NOT is_admin() THEN RAISE EXCEPTION 'Admins only'; END IF;
  IF NOT public._doc_share_pw_ok(p_password) THEN RAISE EXCEPTION 'The password must be 6–64 characters.'; END IF;
  UPDATE public.doc_shares SET pw_hash = crypt(p_password, gen_salt('bf', 8)), pw_changed_at = NOW(), failed_count = 0, locked_until = NULL WHERE id = p_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'Link not found'; END IF;
END $$;
REVOKE ALL ON FUNCTION public.admin_doc_share_password(UUID, TEXT) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_doc_share_password(UUID, TEXT) TO authenticated;

-- Admin: switch off / on again, change expiry, delete
CREATE OR REPLACE FUNCTION public.admin_doc_share_update(p_id UUID, p_action TEXT, p_days INT DEFAULT NULL)
RETURNS VOID LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NOT is_admin() THEN RAISE EXCEPTION 'Admins only'; END IF;
  IF p_action = 'revoke' THEN UPDATE public.doc_shares SET revoked_at = NOW() WHERE id = p_id;
  ELSIF p_action = 'restore' THEN UPDATE public.doc_shares SET revoked_at = NULL WHERE id = p_id;
  ELSIF p_action = 'expiry' THEN
    IF p_days IS NULL OR p_days < 0 OR p_days > 365 THEN RAISE EXCEPTION 'Check the expiry.'; END IF;
    UPDATE public.doc_shares SET expires_at = CASE WHEN p_days > 0 THEN NOW() + make_interval(days => p_days) END WHERE id = p_id;
  ELSIF p_action = 'delete' THEN DELETE FROM public.doc_shares WHERE id = p_id;
  ELSE RAISE EXCEPTION 'Unknown action';
  END IF;
END $$;
REVOKE ALL ON FUNCTION public.admin_doc_share_update(UUID, TEXT, INT) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_doc_share_update(UUID, TEXT, INT) TO authenticated;

-- Edge Function only (service role): check link + password; p_doc = one file to download (NULL = list the files)
CREATE OR REPLACE FUNCTION public._doc_share_check(p_token UUID, p_password TEXT, p_doc UUID DEFAULT NULL)
RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, extensions AS $$
DECLARE s public.doc_shares; files JSONB; first TEXT;
BEGIN
  SELECT * INTO s FROM public.doc_shares WHERE token = p_token FOR UPDATE;
  IF s.id IS NULL OR s.revoked_at IS NOT NULL THEN RETURN jsonb_build_object('ok', false, 'error', 'This link is not available.'); END IF;
  IF s.expires_at IS NOT NULL AND s.expires_at < NOW() THEN RETURN jsonb_build_object('ok', false, 'error', 'This link has expired.', 'expired', true); END IF;
  IF s.locked_until IS NOT NULL AND s.locked_until > NOW() THEN
    RETURN jsonb_build_object('ok', false, 'locked', true, 'error', 'Too many wrong passwords. Please try again after ' || to_char(s.locked_until AT TIME ZONE 'Asia/Colombo', 'HH12:MI AM') || '.');
  END IF;
  IF p_password IS NULL OR crypt(p_password, s.pw_hash) <> s.pw_hash THEN
    UPDATE public.doc_shares SET failed_count = CASE WHEN failed_count + 1 >= 5 THEN 0 ELSE failed_count + 1 END,
           locked_until = CASE WHEN failed_count + 1 >= 5 THEN NOW() + INTERVAL '15 minutes' ELSE locked_until END
     WHERE id = s.id;
    RETURN jsonb_build_object('ok', false, 'error', CASE WHEN s.failed_count + 1 >= 5 THEN 'Too many wrong passwords. The link is locked for 15 minutes.' ELSE 'Wrong password.' END,
                              'tries_left', greatest(0, 4 - s.failed_count));
  END IF;
  SELECT coalesce(jsonb_agg(jsonb_build_object('id', d.id, 'title', d.title, 'size', d.size, 'mime', d.mime, 'year', d.year, 'category', d.category,
                                                'storage', d.storage, 'path', d.path, 'drive_item_id', d.drive_item_id) ORDER BY d.year DESC NULLS LAST, d.title), '[]')
    INTO files FROM public.client_documents d
   WHERE d.client_id = s.client_id AND d.id = ANY (s.doc_ids) AND (p_doc IS NULL OR d.id = p_doc);
  IF p_doc IS NOT NULL AND jsonb_array_length(files) = 0 THEN RETURN jsonb_build_object('ok', false, 'error', 'This file is no longer available.'); END IF;
  UPDATE public.doc_shares SET failed_count = 0, locked_until = NULL,
         open_count = open_count + CASE WHEN p_doc IS NULL THEN 1 ELSE 0 END,
         download_count = download_count + CASE WHEN p_doc IS NULL THEN 0 ELSE 1 END,
         last_opened_at = NOW()
   WHERE id = s.id;
  SELECT split_part(trim(full_name), ' ', 1) INTO first FROM public.clients WHERE id = s.client_id;
  RETURN jsonb_build_object('ok', true, 'title', s.title, 'client', first, 'expires_at', s.expires_at, 'files', files);
END $$;
REVOKE ALL ON FUNCTION public._doc_share_check(UUID, TEXT, UUID) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public._doc_share_check(UUID, TEXT, UUID) TO service_role;

SELECT to_regclass('public.doc_shares') IS NOT NULL AS shares_table,
       has_function_privilege('anon', 'public._doc_share_check(uuid,text,uuid)', 'execute') AS anon_can_check,
       has_function_privilege('service_role', 'public._doc_share_check(uuid,text,uuid)', 'execute') AS function_can_check;
