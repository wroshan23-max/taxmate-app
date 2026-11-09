-- ═══════════════════════════════════════════════════════════
--  TaxMate V55 — Family accounts (main applicant + family members)
--  • TaxMate links family members (each a normal client with their own returns,
--    calculations, documents and invoices) to one main applicant.
--  • The main applicant's portal can switch to a member and see + manage everything
--    for that member (the app sends the header  x-family-member: <member client id>).
--    my_client_id() gives the member only when the signed-in client is that member's
--    main applicant. Without the header nothing changes.
--  • Members can still get their own login later — they then see only their own data.
--  • The main applicant pays for the family: members' invoices are readable by the
--    main applicant, and members' notifications are copied to the main applicant.
--  • The main applicant can share a member's tax computation with the member
--    (secure link for WhatsApp / email).
--  Safe to re-run.
-- ═══════════════════════════════════════════════════════════

-- ═══ 1. Links ═══════════════════════════════════════════════
CREATE TABLE IF NOT EXISTS public.client_family (
  member_id  UUID PRIMARY KEY REFERENCES public.clients(id) ON DELETE CASCADE,   -- a client is in at most one family
  head_id    UUID NOT NULL REFERENCES public.clients(id) ON DELETE CASCADE,
  relation   TEXT CHECK (relation IS NULL OR length(relation) <= 40),
  created_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CHECK (member_id <> head_id)
);
CREATE INDEX IF NOT EXISTS client_family_head_idx ON public.client_family (head_id);

-- One level only: a main applicant is not a member, a member has no members
CREATE OR REPLACE FUNCTION public._family_check() RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF EXISTS (SELECT 1 FROM public.client_family WHERE member_id = NEW.head_id) THEN
    RAISE EXCEPTION 'The main applicant is a family member of someone else. Choose that person as the main applicant.';
  END IF;
  IF EXISTS (SELECT 1 FROM public.client_family WHERE head_id = NEW.member_id) THEN
    RAISE EXCEPTION 'This client already has family members, so they cannot be added to another family.';
  END IF;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS trg_family_check ON public.client_family;
CREATE TRIGGER trg_family_check BEFORE INSERT OR UPDATE ON public.client_family FOR EACH ROW EXECUTE FUNCTION public._family_check();

-- ═══ 2. Who am I / who am I acting for ══════════════════════
-- The client record of the signed-in person (what my_client_id() returned before)
CREATE OR REPLACE FUNCTION public._my_own_client_id() RETURNS UUID LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT id FROM public.clients WHERE profile_id = auth.uid() AND public._mfa_ok() LIMIT 1;
$$;
REVOKE ALL ON FUNCTION public._my_own_client_id() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public._my_own_client_id() TO authenticated;

-- Member chosen in the main applicant's portal (x-family-member header), NULL if none / not a UUID
CREATE OR REPLACE FUNCTION public._family_as() RETURNS UUID LANGUAGE sql STABLE SET search_path = public AS $$
  SELECT CASE WHEN h ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' THEN h::uuid END
  FROM (SELECT lower(nullif(current_setting('request.headers', true), '')::json->>'x-family-member') AS h) x;
$$;
REVOKE ALL ON FUNCTION public._family_as() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public._family_as() TO authenticated;

-- Family members of the signed-in main applicant
CREATE OR REPLACE FUNCTION public._my_family_ids() RETURNS UUID[] LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT coalesce(array_agg(member_id), '{}'::uuid[]) FROM public.client_family WHERE head_id = public._my_own_client_id();
$$;
REVOKE ALL ON FUNCTION public._my_family_ids() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public._my_family_ids() TO authenticated;

CREATE OR REPLACE FUNCTION public.my_client_id() RETURNS UUID LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT CASE
    WHEN public._view_as() IS NOT NULL AND public._real_admin() THEN          -- V53 admin preview (read only)
      (SELECT c.id FROM public.clients c WHERE c.id = public._view_as() AND public._view_as_readonly())
    WHEN public._family_as() IS NOT NULL THEN                                  -- V55 main applicant acting for a member
      (SELECT f.member_id FROM public.client_family f WHERE f.member_id = public._family_as() AND f.head_id = public._my_own_client_id())
    ELSE public._my_own_client_id()
  END;
$$;

-- Storage folders (<client id>/…): own folder, the member being managed, or any family member
CREATE OR REPLACE FUNCTION public._my_folder_client(p_folder TEXT) RETURNS UUID LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE f UUID;
BEGIN
  IF p_folder IS NULL OR p_folder !~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' THEN RETURN NULL; END IF;
  f := p_folder::uuid;
  IF f = public.my_client_id() OR f = public._my_own_client_id() OR f = ANY (public._my_family_ids()) THEN RETURN f; END IF;
  RETURN NULL;
END $$;
REVOKE ALL ON FUNCTION public._my_folder_client(TEXT) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public._my_folder_client(TEXT) TO authenticated;

DROP POLICY IF EXISTS "client-docs client read" ON storage.objects;
CREATE POLICY "client-docs client read" ON storage.objects FOR SELECT TO authenticated
  USING (bucket_id = 'client-docs' AND public._my_folder_client((storage.foldername(name))[1]) IS NOT NULL
         AND public._feature_on(public._my_folder_client((storage.foldername(name))[1]), 'documents'));
DROP POLICY IF EXISTS "client-docs client upload" ON storage.objects;
CREATE POLICY "client-docs client upload" ON storage.objects FOR INSERT TO authenticated
  WITH CHECK (bucket_id = 'client-docs' AND public._my_folder_client((storage.foldername(name))[1]) IS NOT NULL
              AND public._feature_on(public._my_folder_client((storage.foldername(name))[1]), 'documents')
              AND public._doc_quota_ok(public._my_folder_client((storage.foldername(name))[1]), 0));
DROP POLICY IF EXISTS "client-docs client delete" ON storage.objects;
CREATE POLICY "client-docs client delete" ON storage.objects FOR DELETE TO authenticated
  USING (bucket_id = 'client-docs' AND public._my_folder_client((storage.foldername(name))[1]) IS NOT NULL
         AND owner_id = auth.uid()::text);
DROP POLICY IF EXISTS "payment-slips client upload" ON storage.objects;
CREATE POLICY "payment-slips client upload" ON storage.objects FOR INSERT TO authenticated
  WITH CHECK (bucket_id = 'payment-slips' AND public._my_folder_client((storage.foldername(name))[1]) IS NOT NULL);
DROP POLICY IF EXISTS "payment-slips client read" ON storage.objects;
CREATE POLICY "payment-slips client read" ON storage.objects FOR SELECT TO authenticated
  USING (bucket_id = 'payment-slips' AND public._my_folder_client((storage.foldername(name))[1]) IS NOT NULL);

-- The main applicant pays for the family: members' invoices are readable too
DROP POLICY IF EXISTS "Clients can read own invoices" ON public.invoices;
CREATE POLICY "Clients can read own invoices" ON public.invoices
  FOR SELECT USING ((client_id = my_client_id() OR client_id = ANY (_my_family_ids())) AND status <> 'draft');

-- Profile-change requests: only for the client being viewed (own record, or the family member being managed)
DROP POLICY IF EXISTS "Clients can insert requests" ON public.update_requests;
CREATE POLICY "Clients can insert requests" ON public.update_requests FOR INSERT
  WITH CHECK (profile_id = auth.uid() AND _mfa_ok() AND client_id = my_client_id());

-- ═══ 3. RLS on the links ════════════════════════════════════
ALTER TABLE public.client_family ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Admins manage families" ON public.client_family;
CREATE POLICY "Admins manage families" ON public.client_family FOR ALL USING (is_admin()) WITH CHECK (is_admin());
DROP POLICY IF EXISTS "Clients read own family" ON public.client_family;
CREATE POLICY "Clients read own family" ON public.client_family FOR SELECT
  USING (head_id = _my_own_client_id() OR member_id = _my_own_client_id());

-- ═══ 4. Main applicant: family overview ═════════════════════
CREATE OR REPLACE FUNCTION public.my_family()
RETURNS JSONB LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE me UUID := public._my_own_client_id();
BEGIN
  IF me IS NULL THEN RETURN jsonb_build_object('me', NULL, 'members', '[]'::jsonb); END IF;
  RETURN jsonb_build_object(
    'me', (SELECT jsonb_build_object('id', c.id, 'full_name', c.full_name, 'client_no', c.client_no) FROM public.clients c WHERE c.id = me),
    'head', (SELECT jsonb_build_object('id', h.id, 'full_name', h.full_name, 'relation', f.relation)
             FROM public.client_family f JOIN public.clients h ON h.id = f.head_id WHERE f.member_id = me),
    'members', coalesce((SELECT jsonb_agg(jsonb_build_object(
        'id', c.id, 'full_name', c.full_name, 'client_no', c.client_no, 'relation', f.relation,
        'mobile', c.mobile, 'email', c.email, 'tin', c.tin, 'has_login', c.profile_id IS NOT NULL,
        'returns', coalesce((SELECT jsonb_agg(jsonb_build_object('year', r.year, 'status', r.status, 'stage', r.stage) ORDER BY r.year DESC)
                             FROM (SELECT * FROM public.tax_returns WHERE client_id = c.id ORDER BY year DESC LIMIT 3) r), '[]'::jsonb),
        'calcs', coalesce((SELECT jsonb_agg(jsonb_build_object('id', i.id, 'year', i.year, 'status', i.status, 'label', i.label,
                                   'client_status', i.client_status, 'share_token', i.share_token, 'created_at', i.created_at) ORDER BY i.created_at DESC)
                           FROM (SELECT * FROM public.iit_calculations WHERE client_id = c.id AND shared_with_client ORDER BY created_at DESC LIMIT 4) i), '[]'::jsonb),
        'unpaid', coalesce((SELECT jsonb_agg(jsonb_build_object('id', v.id, 'invoice_no', v.invoice_no, 'total', v.total_amount, 'due_date', v.due_date, 'status', v.status) ORDER BY v.issue_date)
                            FROM public.invoices v WHERE v.client_id = c.id AND v.status IN ('unpaid', 'overdue')), '[]'::jsonb),
        'unread', (SELECT count(*) FROM public.client_notifications n WHERE n.client_id = c.id AND n.read_at IS NULL)
      ) ORDER BY c.full_name) FROM public.client_family f JOIN public.clients c ON c.id = f.member_id WHERE f.head_id = me), '[]'::jsonb));
END $$;
REVOKE ALL ON FUNCTION public.my_family() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.my_family() TO authenticated;

-- ═══ 5. Share a member's tax computation (secure link) ══════
-- p_on = true → create / reuse the link and return it; false → switch the link off
CREATE OR REPLACE FUNCTION public.share_family_calc(p_calc UUID, p_on BOOLEAN)
RETURNS UUID LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE r public.iit_calculations; tok UUID;
BEGIN
  SELECT * INTO r FROM public.iit_calculations WHERE id = p_calc FOR UPDATE;
  IF r.id IS NULL OR NOT coalesce(r.shared_with_client, false)
     OR NOT (r.client_id = public._my_own_client_id() OR r.client_id = ANY (public._my_family_ids())) THEN
    RAISE EXCEPTION 'Calculation not found.';
  END IF;
  IF coalesce(p_on, true) THEN
    tok := coalesce(r.share_token, gen_random_uuid());
    UPDATE public.iit_calculations SET share_token = tok WHERE id = r.id;
    RETURN tok;
  END IF;
  UPDATE public.iit_calculations SET share_token = NULL WHERE id = r.id;
  RETURN NULL;
END $$;
REVOKE ALL ON FUNCTION public.share_family_calc(UUID, BOOLEAN) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.share_family_calc(UUID, BOOLEAN) TO authenticated;

-- ═══ 6. Members' notifications also go to the main applicant ═
CREATE OR REPLACE FUNCTION public._notify_client(p_client UUID, p_kind TEXT, p_title TEXT, p_body TEXT, p_link TEXT)
RETURNS VOID LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE hd UUID; nm TEXT; lnk TEXT;
BEGIN
  IF p_client IS NULL THEN RETURN; END IF;
  INSERT INTO public.client_notifications (client_id, kind, title, body, link)
  VALUES (p_client, p_kind, left(p_title, 160), left(p_body, 500), p_link);
  DELETE FROM public.client_notifications WHERE client_id = p_client AND id IN (
    SELECT id FROM public.client_notifications WHERE client_id = p_client ORDER BY created_at DESC OFFSET 200);
  -- V55: copy to the main applicant, opening the member's portal
  SELECT f.head_id, c.full_name INTO hd, nm FROM public.client_family f JOIN public.clients c ON c.id = f.member_id WHERE f.member_id = p_client;
  IF hd IS NOT NULL THEN
    lnk := CASE WHEN p_link IS NULL OR p_link !~ '^/client/' THEN '/client/family'
                ELSE p_link || CASE WHEN position('?' IN p_link) > 0 THEN '&' ELSE '?' END || 'member=' || p_client::text END;
    INSERT INTO public.client_notifications (client_id, kind, title, body, link)
    VALUES (hd, p_kind, left('👪 ' || coalesce(split_part(nm, ' ', 1), 'Family') || ': ' || p_title, 160), left(p_body, 500), lnk);
    DELETE FROM public.client_notifications WHERE client_id = hd AND id IN (
      SELECT id FROM public.client_notifications WHERE client_id = hd ORDER BY created_at DESC OFFSET 200);
  END IF;
END $$;
REVOKE ALL ON FUNCTION public._notify_client(UUID, TEXT, TEXT, TEXT, TEXT) FROM PUBLIC, anon, authenticated;

-- ═══ 7. Check ═══════════════════════════════════════════════
SELECT to_regclass('public.client_family') IS NOT NULL AS family_table,
       has_function_privilege('authenticated', 'public.my_family()', 'execute') AS my_family_ok,
       public.my_client_id() IS NULL AS no_client_in_sql_editor;
