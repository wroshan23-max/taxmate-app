-- ═══════════════════════════════════════════════════════════
--  TaxMate V29 — Document vault (Supabase free plan) + Return progress tracker
--  Free plan: 1 GB file storage · 50 MB max file → we cap files at 10 MB and
--  compress photos in the browser (~300 KB each) before upload.
-- ═══════════════════════════════════════════════════════════

-- 1. Private storage bucket
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES ('client-docs', 'client-docs', FALSE, 10485760, ARRAY[
  'application/pdf', 'image/jpeg', 'image/png', 'image/webp',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', 'application/vnd.ms-excel',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document', 'application/msword',
  'text/csv'])
ON CONFLICT (id) DO UPDATE SET public = FALSE, file_size_limit = EXCLUDED.file_size_limit, allowed_mime_types = EXCLUDED.allowed_mime_types;

-- 2. Document register (one row per file)
CREATE TABLE IF NOT EXISTS public.client_documents (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id     UUID NOT NULL REFERENCES public.clients(id) ON DELETE CASCADE,
  year          TEXT CHECK (year IS NULL OR year ~ '^\d{4}/\d{2}$'),
  category      TEXT NOT NULL DEFAULT 'other' CHECK (category IN ('salary', 'bank', 'rent', 'business', 'foreign', 'assets', 'id', 'ird', 'return', 'other')),
  title         TEXT NOT NULL CHECK (length(title) BETWEEN 1 AND 150),
  path          TEXT NOT NULL UNIQUE,
  size          BIGINT NOT NULL DEFAULT 0 CHECK (size >= 0 AND size <= 10485760),
  mime          TEXT,
  note          TEXT CHECK (note IS NULL OR length(note) <= 500),
  uploaded_by   UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  uploaded_role TEXT NOT NULL DEFAULT 'admin' CHECK (uploaded_role IN ('admin', 'client')),
  seen_at       TIMESTAMPTZ,            -- admin has seen a client upload
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CHECK (split_part(path, '/', 1) = client_id::text)
);
CREATE INDEX IF NOT EXISTS client_documents_client_idx ON public.client_documents (client_id, year);
CREATE INDEX IF NOT EXISTS client_documents_unseen_idx ON public.client_documents (created_at) WHERE uploaded_role = 'client' AND seen_at IS NULL;

-- Per-client quota so one account can't fill the free 1 GB (150 MB / 300 files each)
CREATE OR REPLACE FUNCTION public._doc_quota_ok(p_client UUID, p_add BIGINT)
RETURNS BOOLEAN LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT coalesce(sum(size), 0) + coalesce(p_add, 0) <= 157286400 AND count(*) < 300
  FROM public.client_documents WHERE client_id = p_client;
$$;
REVOKE ALL ON FUNCTION public._doc_quota_ok(UUID, BIGINT) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public._doc_quota_ok(UUID, BIGINT) TO authenticated;

ALTER TABLE public.client_documents ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Admins manage documents" ON public.client_documents;
CREATE POLICY "Admins manage documents" ON public.client_documents FOR ALL USING (is_admin()) WITH CHECK (is_admin());
DROP POLICY IF EXISTS "Clients read own documents" ON public.client_documents;
CREATE POLICY "Clients read own documents" ON public.client_documents FOR SELECT USING (
  client_id = my_client_id() AND _feature_on(my_client_id(), 'documents'));
DROP POLICY IF EXISTS "Clients add own documents" ON public.client_documents;
CREATE POLICY "Clients add own documents" ON public.client_documents FOR INSERT WITH CHECK (
  client_id = my_client_id() AND uploaded_by = auth.uid() AND uploaded_role = 'client' AND seen_at IS NULL
  AND _feature_on(my_client_id(), 'documents') AND _doc_quota_ok(my_client_id(), size));
DROP POLICY IF EXISTS "Clients delete own uploads" ON public.client_documents;
CREATE POLICY "Clients delete own uploads" ON public.client_documents FOR DELETE USING (
  client_id = my_client_id() AND uploaded_by = auth.uid() AND uploaded_role = 'client');

-- 3. Storage policies — files live at  <client_id>/<year or general>/<random>-<name>
DROP POLICY IF EXISTS "client-docs admin all" ON storage.objects;
CREATE POLICY "client-docs admin all" ON storage.objects FOR ALL TO authenticated
  USING (bucket_id = 'client-docs' AND public.is_admin())
  WITH CHECK (bucket_id = 'client-docs' AND public.is_admin());
DROP POLICY IF EXISTS "client-docs client read" ON storage.objects;
CREATE POLICY "client-docs client read" ON storage.objects FOR SELECT TO authenticated
  USING (bucket_id = 'client-docs' AND (storage.foldername(name))[1] = public.my_client_id()::text
         AND public._feature_on(public.my_client_id(), 'documents'));
DROP POLICY IF EXISTS "client-docs client upload" ON storage.objects;
CREATE POLICY "client-docs client upload" ON storage.objects FOR INSERT TO authenticated
  WITH CHECK (bucket_id = 'client-docs' AND (storage.foldername(name))[1] = public.my_client_id()::text
              AND public._feature_on(public.my_client_id(), 'documents') AND public._doc_quota_ok(public.my_client_id(), 0));
DROP POLICY IF EXISTS "client-docs client delete" ON storage.objects;
CREATE POLICY "client-docs client delete" ON storage.objects FOR DELETE TO authenticated
  USING (bucket_id = 'client-docs' AND (storage.foldername(name))[1] = public.my_client_id()::text
         AND owner_id = auth.uid()::text);

-- 4. Storage meter (admin only)
CREATE OR REPLACE FUNCTION public.storage_usage()
RETURNS JSONB LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, storage AS $$
BEGIN
  IF NOT is_admin() THEN RAISE EXCEPTION 'Admins only'; END IF;
  RETURN jsonb_build_object(
    'bytes', (SELECT coalesce(sum((metadata->>'size')::bigint), 0) FROM storage.objects WHERE bucket_id = 'client-docs'),
    'files', (SELECT count(*) FROM storage.objects WHERE bucket_id = 'client-docs'),
    'db_bytes', pg_database_size(current_database()),
    'limit_bytes', 1073741824,
    'db_limit_bytes', 524288000);
END $$;
REVOKE ALL ON FUNCTION public.storage_usage() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.storage_usage() TO authenticated;

-- 5. Return progress tracker
--   docs → computing → review → filed (complete). status stays in sync for older screens.
ALTER TABLE public.tax_returns ADD COLUMN IF NOT EXISTS stage    TEXT NOT NULL DEFAULT 'docs';
ALTER TABLE public.tax_returns ADD COLUMN IF NOT EXISTS stage_at JSONB NOT NULL DEFAULT '{}'::jsonb;
ALTER TABLE public.tax_returns DROP CONSTRAINT IF EXISTS tax_returns_stage_check;
ALTER TABLE public.tax_returns ADD CONSTRAINT tax_returns_stage_check CHECK (stage IN ('docs', 'computing', 'review', 'filed'));
UPDATE public.tax_returns SET stage = CASE status WHEN 'in_progress' THEN 'computing' WHEN 'submitted' THEN 'filed' WHEN 'completed' THEN 'filed' ELSE 'docs' END
WHERE stage = 'docs' AND status IS DISTINCT FROM 'pending';

CREATE OR REPLACE FUNCTION public._tax_return_stage_sync()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
DECLARE order_ TEXT[] := ARRAY['docs', 'computing', 'review', 'filed']; i INT;
BEGIN
  IF TG_OP = 'UPDATE' AND NEW.stage IS NOT DISTINCT FROM OLD.stage AND NEW.status IS DISTINCT FROM OLD.status THEN
    -- someone changed the old status dropdown → move the stage to match
    NEW.stage := CASE NEW.status WHEN 'in_progress' THEN 'computing' WHEN 'submitted' THEN 'filed' WHEN 'completed' THEN 'filed' ELSE 'docs' END;
  END IF;
  IF TG_OP = 'INSERT' OR NEW.stage IS DISTINCT FROM OLD.stage THEN
    NEW.status := CASE NEW.stage WHEN 'docs' THEN 'pending' WHEN 'filed' THEN 'completed' ELSE 'in_progress' END;
    i := array_position(order_, NEW.stage);
    -- keep earlier steps, stamp this one (moving back keeps its original date), drop later ones
    NEW.stage_at := (SELECT coalesce(jsonb_object_agg(k, v), '{}'::jsonb)
                     FROM jsonb_each(coalesce(NEW.stage_at, '{}'::jsonb)) AS e(k, v)
                     WHERE array_position(order_, k) < i)
                    || jsonb_build_object(NEW.stage, CASE
                         WHEN TG_OP = 'UPDATE' AND i < array_position(order_, OLD.stage) AND OLD.stage_at ? NEW.stage
                         THEN OLD.stage_at->NEW.stage ELSE to_jsonb(NOW()) END);
  END IF;
  NEW.updated_at := NOW();
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS tax_returns_stage_sync ON public.tax_returns;
CREATE TRIGGER tax_returns_stage_sync BEFORE INSERT OR UPDATE ON public.tax_returns
  FOR EACH ROW EXECUTE FUNCTION public._tax_return_stage_sync();

-- 6. Portal switches: documents + return tracker
UPDATE public.app_settings SET value = jsonb_build_object('documents', true, 'return_tracker', true) || coalesce(value, '{}'::jsonb)
WHERE key = 'client_tools';

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
    'referral_reward', coalesce((SELECT value->>'referral_reward' FROM public.app_settings WHERE key = 'client_tools'), ''),
    'income_sheets', coalesce(n, 0));
END $$;
REVOKE ALL ON FUNCTION public.my_portal_features() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.my_portal_features() TO authenticated;
