-- ═══════════════════════════════════════════════════════════
--  TaxMate V45 — Client files in OneDrive
--  • client_documents can live in OneDrive (storage = 'onedrive', drive_item_id)
--  • new document types: IRD acknowledgment ('ack'), payment voucher ('voucher')
--  • OneDrive connection + pending uploads: readable only by the Edge Function (service role)
--  • client gets a 🔔 notification when TaxMate shares a document
--  Safe to re-run.
-- ═══════════════════════════════════════════════════════════

-- 1. Documents: where the file is stored
ALTER TABLE public.client_documents ADD COLUMN IF NOT EXISTS storage TEXT NOT NULL DEFAULT 'supabase';
ALTER TABLE public.client_documents ADD COLUMN IF NOT EXISTS drive_item_id TEXT;
DO $$
DECLARE c RECORD;
BEGIN
  FOR c IN SELECT conname, pg_get_constraintdef(oid) AS def FROM pg_constraint
           WHERE conrelid = 'public.client_documents'::regclass AND contype = 'c' LOOP
    IF c.def ILIKE '%category%' OR c.def ILIKE '%size%' OR c.def ILIKE '%storage%' THEN
      EXECUTE format('ALTER TABLE public.client_documents DROP CONSTRAINT %I', c.conname);
    END IF;
  END LOOP;
END $$;
ALTER TABLE public.client_documents ADD CONSTRAINT client_documents_category_check
  CHECK (category IN ('salary', 'bank', 'rent', 'business', 'foreign', 'assets', 'id', 'ird', 'return', 'ack', 'voucher', 'other'));
ALTER TABLE public.client_documents ADD CONSTRAINT client_documents_size_check
  CHECK (size >= 0 AND size <= 26214400);                     -- 25 MB (OneDrive); app keeps 10 MB for the old storage
ALTER TABLE public.client_documents ADD CONSTRAINT client_documents_storage_check
  CHECK (storage IN ('supabase', 'onedrive') AND (storage = 'supabase' OR drive_item_id IS NOT NULL));

-- OneDrive folder used for each client (set by the Edge Function on the first upload)
ALTER TABLE public.clients ADD COLUMN IF NOT EXISTS drive_folder TEXT;

-- 2. OneDrive connection (one row). No policies → only the Edge Function (service role) can read the tokens.
CREATE TABLE IF NOT EXISTS public.storage_connection (
  id             INT PRIMARY KEY DEFAULT 1 CHECK (id = 1),
  provider       TEXT NOT NULL DEFAULT 'onedrive' CHECK (provider IN ('onedrive')),
  account_email  TEXT,
  account_name   TEXT,
  refresh_token  TEXT,
  access_token   TEXT,
  access_expires TIMESTAMPTZ,
  root_folder    TEXT NOT NULL DEFAULT 'TaxMate Clients',
  connected_by   UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  connected_at   TIMESTAMPTZ,
  updated_at     TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
ALTER TABLE public.storage_connection ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.storage_connection FROM anon, authenticated;

-- 3. Uploads in progress (file goes straight from the phone to OneDrive, then is registered)
CREATE TABLE IF NOT EXISTS public.drive_uploads (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id   UUID NOT NULL REFERENCES public.clients(id) ON DELETE CASCADE,
  user_id     UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  role        TEXT NOT NULL CHECK (role IN ('admin', 'client')),
  year        TEXT,
  category    TEXT NOT NULL,
  title       TEXT NOT NULL,
  note        TEXT,
  mime        TEXT,
  size        BIGINT NOT NULL DEFAULT 0,
  folder_path TEXT NOT NULL,
  file_name   TEXT NOT NULL,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
ALTER TABLE public.drive_uploads ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.drive_uploads FROM anon, authenticated;

-- 4. Admin: is OneDrive connected? (never returns the tokens)
CREATE OR REPLACE FUNCTION public.storage_status()
RETURNS JSONB LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE r public.storage_connection;
BEGIN
  IF NOT is_admin() THEN RAISE EXCEPTION 'Admins only'; END IF;
  SELECT * INTO r FROM public.storage_connection WHERE id = 1;
  RETURN jsonb_build_object(
    'provider', coalesce(r.provider, 'onedrive'),
    'connected', r.refresh_token IS NOT NULL,
    'account_email', r.account_email, 'account_name', r.account_name,
    'connected_at', r.connected_at, 'root_folder', coalesce(r.root_folder, 'TaxMate Clients'),
    'files', (SELECT count(*) FROM public.client_documents WHERE storage = 'onedrive'),
    'bytes', (SELECT coalesce(sum(size), 0) FROM public.client_documents WHERE storage = 'onedrive'));
END $$;
REVOKE ALL ON FUNCTION public.storage_status() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.storage_status() TO authenticated;

-- 5. 🔔 Client is told when TaxMate shares a document
CREATE OR REPLACE FUNCTION public._ntf_document() RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE what TEXT;
BEGIN
  IF NEW.uploaded_role <> 'admin' THEN RETURN NEW; END IF;
  what := CASE NEW.category
    WHEN 'ack' THEN 'IRD acknowledgment'
    WHEN 'voucher' THEN 'IRD payment voucher'
    WHEN 'return' THEN 'Filed return / receipt'
    WHEN 'ird' THEN 'IRD letter'
    ELSE 'New document' END;
  PERFORM _notify_client(NEW.client_id, 'report',
    what || CASE WHEN NEW.year IS NOT NULL THEN ' — Y/A ' || NEW.year ELSE '' END || ' is ready',
    NEW.title || '. Open My Documents to view or download it.',
    '/client/documents');
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS trg_ntf_document ON public.client_documents;
CREATE TRIGGER trg_ntf_document AFTER INSERT ON public.client_documents FOR EACH ROW EXECUTE FUNCTION public._ntf_document();

SELECT (SELECT count(*) FROM public.client_documents) AS documents,
       (SELECT count(*) FROM public.storage_connection) AS connections,
       to_regclass('public.drive_uploads') IS NOT NULL AS uploads_table;
