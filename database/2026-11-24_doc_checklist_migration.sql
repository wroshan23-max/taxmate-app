-- ════════════════════════════════════════════════════════════════════════════
-- V68 — Document checklist per client and Y/A
--   TaxMate lists the documents a client must send for a year (from templates or custom).
--   An upload in the matching category ticks the item automatically; the client sees
--   what is still missing in the portal; reminders list only the missing items.
--   Safe to run more than once.
-- ════════════════════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS public.doc_checklists (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id       UUID NOT NULL REFERENCES public.clients(id) ON DELETE CASCADE,
  year            TEXT NOT NULL CHECK (year ~ '^\d{4}/\d{2}$'),
  note            TEXT CHECK (note IS NULL OR length(note) <= 500),     -- message shown to the client
  due_date        DATE,                                                   -- "please send by"
  reminded_at     TIMESTAMPTZ,
  reminder_count  INT NOT NULL DEFAULT 0,
  completed_at    TIMESTAMPTZ,
  created_by      UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (client_id, year)
);

CREATE TABLE IF NOT EXISTS public.doc_checklist_items (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  checklist_id  UUID NOT NULL REFERENCES public.doc_checklists(id) ON DELETE CASCADE,
  client_id     UUID NOT NULL REFERENCES public.clients(id) ON DELETE CASCADE,
  year          TEXT NOT NULL,
  label         TEXT NOT NULL CHECK (length(label) BETWEEN 1 AND 150),
  label_si      TEXT CHECK (label_si IS NULL OR length(label_si) <= 150),
  hint          TEXT CHECK (hint IS NULL OR length(hint) <= 300),
  category      TEXT NOT NULL DEFAULT 'other',
  status        TEXT NOT NULL DEFAULT 'needed' CHECK (status IN ('needed', 'received', 'na')),
  document_id   UUID REFERENCES public.client_documents(id) ON DELETE SET NULL,
  received_at   TIMESTAMPTZ,
  na_by         TEXT CHECK (na_by IS NULL OR na_by IN ('admin', 'client')),
  client_note   TEXT CHECK (client_note IS NULL OR length(client_note) <= 300),
  sort          INT NOT NULL DEFAULT 0,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS doc_checklist_items_list_idx ON public.doc_checklist_items (checklist_id, sort);
CREATE INDEX IF NOT EXISTS doc_checklist_items_client_idx ON public.doc_checklist_items (client_id, year, status);

ALTER TABLE public.doc_checklists ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.doc_checklist_items ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS doc_checklists_admin ON public.doc_checklists;
CREATE POLICY doc_checklists_admin ON public.doc_checklists FOR ALL TO authenticated USING (public.is_admin()) WITH CHECK (public.is_admin());
DROP POLICY IF EXISTS doc_checklists_client_read ON public.doc_checklists;
CREATE POLICY doc_checklists_client_read ON public.doc_checklists FOR SELECT TO authenticated USING (client_id = public.my_client_id());
DROP POLICY IF EXISTS doc_checklist_items_admin ON public.doc_checklist_items;
CREATE POLICY doc_checklist_items_admin ON public.doc_checklist_items FOR ALL TO authenticated USING (public.is_admin()) WITH CHECK (public.is_admin());
DROP POLICY IF EXISTS doc_checklist_items_client_read ON public.doc_checklist_items;
CREATE POLICY doc_checklist_items_client_read ON public.doc_checklist_items FOR SELECT TO authenticated USING (client_id = public.my_client_id());
REVOKE ALL ON public.doc_checklists, public.doc_checklist_items FROM anon;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.doc_checklists, public.doc_checklist_items TO authenticated;

-- item bookkeeping: client/year from the checklist, received time, completed flag + admin alert
CREATE OR REPLACE FUNCTION public._doc_item_trg() RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE l public.doc_checklists;
BEGIN
  SELECT * INTO l FROM public.doc_checklists WHERE id = NEW.checklist_id;
  NEW.client_id := l.client_id; NEW.year := l.year;
  NEW.updated_at := NOW();
  IF NEW.status = 'received' AND (TG_OP = 'INSERT' OR OLD.status <> 'received') THEN NEW.received_at := coalesce(NEW.received_at, NOW()); END IF;
  IF NEW.status <> 'received' THEN NEW.received_at := NULL; IF NEW.status = 'needed' THEN NEW.document_id := NULL; END IF; END IF;
  IF NEW.status <> 'na' THEN NEW.na_by := NULL; END IF;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS trg_doc_item ON public.doc_checklist_items;
CREATE TRIGGER trg_doc_item BEFORE INSERT OR UPDATE ON public.doc_checklist_items FOR EACH ROW EXECUTE FUNCTION public._doc_item_trg();

CREATE OR REPLACE FUNCTION public._doc_list_progress() RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE lid UUID := coalesce(NEW.checklist_id, OLD.checklist_id); l public.doc_checklists; open_n INT; total INT; nm TEXT;
BEGIN
  SELECT * INTO l FROM public.doc_checklists WHERE id = lid;
  IF l.id IS NULL THEN RETURN NULL; END IF;
  SELECT count(*) FILTER (WHERE status = 'needed'), count(*) INTO open_n, total FROM public.doc_checklist_items WHERE checklist_id = lid;
  IF total > 0 AND open_n = 0 AND l.completed_at IS NULL THEN
    UPDATE public.doc_checklists SET completed_at = NOW(), updated_at = NOW() WHERE id = lid;
    SELECT full_name INTO nm FROM public.clients WHERE id = l.client_id;
    BEGIN
      PERFORM public._push_send('admin', NULL, '✅ All documents received — ' || coalesce(nm, 'Client'), 'Y/A ' || l.year || ' checklist is complete. You can start the return.', '/admin/clients/' || l.client_id || '?tab=documents', 'docs' || left(lid::text, 8));
    EXCEPTION WHEN undefined_function THEN NULL; END;
  ELSIF open_n > 0 AND l.completed_at IS NOT NULL THEN
    UPDATE public.doc_checklists SET completed_at = NULL, updated_at = NOW() WHERE id = lid;
  END IF;
  RETURN NULL;
END $$;
DROP TRIGGER IF EXISTS trg_doc_list_progress ON public.doc_checklist_items;
CREATE TRIGGER trg_doc_list_progress AFTER INSERT OR UPDATE OF status OR DELETE ON public.doc_checklist_items FOR EACH ROW EXECUTE FUNCTION public._doc_list_progress();

-- An upload ticks the first missing item of the same category (same Y/A; an upload without a year → latest open list)
CREATE OR REPLACE FUNCTION public._doc_upload_tick() RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE it UUID;
BEGIN
  IF NEW.uploaded_role <> 'client' AND NEW.category IN ('ack', 'voucher', 'return') THEN RETURN NEW; END IF;   -- TaxMate's own outputs
  SELECT i.id INTO it FROM public.doc_checklist_items i JOIN public.doc_checklists l ON l.id = i.checklist_id
   WHERE i.client_id = NEW.client_id AND i.status = 'needed' AND i.category = NEW.category
     AND (i.year = NEW.year OR (NEW.year IS NULL AND l.completed_at IS NULL))
   ORDER BY (i.year = NEW.year) DESC NULLS LAST, l.year DESC, i.sort, i.created_at LIMIT 1;
  IF it IS NOT NULL THEN
    UPDATE public.doc_checklist_items SET status = 'received', document_id = NEW.id WHERE id = it;
  END IF;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS trg_doc_upload_tick ON public.client_documents;
CREATE TRIGGER trg_doc_upload_tick AFTER INSERT ON public.client_documents FOR EACH ROW EXECUTE FUNCTION public._doc_upload_tick();

-- Admin: create (or add to) a client's checklist for a Y/A. p_items: [{label, label_si?, hint?, category}]
CREATE OR REPLACE FUNCTION public.admin_checklist_create(p_client UUID, p_year TEXT, p_items JSONB, p_note TEXT DEFAULT NULL, p_due DATE DEFAULT NULL, p_notify BOOLEAN DEFAULT TRUE)
RETURNS UUID LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE lid UUID; x JSONB; n INT := 0; base INT; missing INT;
BEGIN
  IF NOT public.is_admin() THEN RAISE EXCEPTION 'Not allowed.'; END IF;
  IF jsonb_typeof(p_items) <> 'array' OR jsonb_array_length(p_items) = 0 THEN RAISE EXCEPTION 'Choose at least one document.'; END IF;
  IF jsonb_array_length(p_items) > 60 THEN RAISE EXCEPTION 'Too many items.'; END IF;
  INSERT INTO public.doc_checklists (client_id, year, note, due_date, created_by) VALUES (p_client, p_year, nullif(trim(p_note), ''), p_due, auth.uid())
  ON CONFLICT (client_id, year) DO UPDATE SET note = coalesce(nullif(trim(EXCLUDED.note), ''), doc_checklists.note), due_date = coalesce(EXCLUDED.due_date, doc_checklists.due_date), updated_at = NOW()
  RETURNING id INTO lid;
  SELECT coalesce(max(sort), 0) INTO base FROM public.doc_checklist_items WHERE checklist_id = lid;
  FOR x IN SELECT * FROM jsonb_array_elements(p_items) LOOP
    CONTINUE WHEN coalesce(trim(x->>'label'), '') = '';
    -- skip an item that is already on the list
    CONTINUE WHEN EXISTS (SELECT 1 FROM public.doc_checklist_items WHERE checklist_id = lid AND lower(label) = lower(trim(x->>'label')));
    n := n + 1;
    INSERT INTO public.doc_checklist_items (checklist_id, client_id, year, label, label_si, hint, category, sort)
    VALUES (lid, p_client, p_year, left(trim(x->>'label'), 150), nullif(left(trim(coalesce(x->>'label_si', '')), 150), ''), nullif(left(trim(coalesce(x->>'hint', '')), 300), ''),
            coalesce(nullif(x->>'category', ''), 'other'), base + n);
  END LOOP;
  -- documents the client already uploaded for this year tick the new items
  FOR x IN SELECT to_jsonb(i) FROM public.doc_checklist_items i WHERE i.checklist_id = lid AND i.status = 'needed' ORDER BY i.sort LOOP
    UPDATE public.doc_checklist_items SET status = 'received', document_id = d.id
      FROM (SELECT cd.id FROM public.client_documents cd WHERE cd.client_id = p_client AND cd.year = p_year AND cd.category = x->>'category'
              AND NOT EXISTS (SELECT 1 FROM public.doc_checklist_items j WHERE j.document_id = cd.id) ORDER BY cd.created_at LIMIT 1) d
     WHERE doc_checklist_items.id = (x->>'id')::uuid;
  END LOOP;
  SELECT count(*) INTO missing FROM public.doc_checklist_items WHERE checklist_id = lid AND status = 'needed';
  IF p_notify AND n > 0 AND missing > 0 THEN
    PERFORM public._notify_client(p_client, 'todo', 'Documents needed for Y/A ' || p_year,
      missing || ' document' || CASE WHEN missing > 1 THEN 's' ELSE '' END || ' to upload' || coalesce(' by ' || to_char(p_due, 'DD Mon'), '') || '. Tap to see the list.', '/client/documents');
  END IF;
  RETURN lid;
END $$;
REVOKE ALL ON FUNCTION public.admin_checklist_create(UUID, TEXT, JSONB, TEXT, DATE, BOOLEAN) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_checklist_create(UUID, TEXT, JSONB, TEXT, DATE, BOOLEAN) TO authenticated;

-- Admin: stamp a WhatsApp / email reminder, or send a portal reminder (+ phone push) to many lists at once
CREATE OR REPLACE FUNCTION public.admin_checklist_remind(p_ids UUID[], p_portal BOOLEAN DEFAULT TRUE) RETURNS INT
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE l RECORD; k INT := 0;
BEGIN
  IF NOT public.is_admin() THEN RAISE EXCEPTION 'Not allowed.'; END IF;
  FOR l IN SELECT c.*, (SELECT string_agg(i.label, ', ' ORDER BY i.sort) FROM public.doc_checklist_items i WHERE i.checklist_id = c.id AND i.status = 'needed') AS missing,
                  (SELECT count(*) FROM public.doc_checklist_items i WHERE i.checklist_id = c.id AND i.status = 'needed') AS n
             FROM public.doc_checklists c WHERE c.id = ANY (p_ids) LOOP
    CONTINUE WHEN l.n = 0;
    IF p_portal THEN
      PERFORM public._notify_client(l.client_id, 'todo', 'Reminder: ' || l.n || ' document' || CASE WHEN l.n > 1 THEN 's' ELSE '' END || ' still needed — Y/A ' || l.year, left(l.missing, 280), '/client/documents');
    END IF;
    UPDATE public.doc_checklists SET reminded_at = NOW(), reminder_count = reminder_count + 1, updated_at = NOW() WHERE id = l.id;
    k := k + 1;
  END LOOP;
  RETURN k;
END $$;
REVOKE ALL ON FUNCTION public.admin_checklist_remind(UUID[], BOOLEAN) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_checklist_remind(UUID[], BOOLEAN) TO authenticated;

-- Client: link an uploaded file to an item, or say "I don't have this" (TaxMate sees the note)
CREATE OR REPLACE FUNCTION public.my_checklist_item(p_item UUID, p_action TEXT, p_doc UUID DEFAULT NULL, p_note TEXT DEFAULT NULL) RETURNS VOID
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE i public.doc_checklist_items; cid UUID := public.my_client_id();
BEGIN
  IF cid IS NULL THEN RAISE EXCEPTION 'Not allowed.'; END IF;   -- admin preview gets no client for writes
  SELECT * INTO i FROM public.doc_checklist_items WHERE id = p_item AND client_id = cid;
  IF i.id IS NULL THEN RAISE EXCEPTION 'Item not found.'; END IF;
  IF p_action = 'attach' THEN
    IF NOT EXISTS (SELECT 1 FROM public.client_documents WHERE id = p_doc AND client_id = cid) THEN RAISE EXCEPTION 'Document not found.'; END IF;
    -- if the upload trigger ticked another item with this file, give that one back
    UPDATE public.doc_checklist_items SET status = 'needed' WHERE document_id = p_doc AND id <> p_item AND client_id = cid;
    UPDATE public.doc_checklist_items SET status = 'received', document_id = p_doc, client_note = NULL WHERE id = p_item;
  ELSIF p_action = 'na' THEN
    IF i.status = 'received' THEN RAISE EXCEPTION 'This document is already received.'; END IF;
    UPDATE public.doc_checklist_items SET status = 'na', na_by = 'client', client_note = nullif(left(trim(coalesce(p_note, '')), 300), '') WHERE id = p_item;
  ELSIF p_action = 'undo' THEN
    IF NOT (i.status = 'na' AND i.na_by = 'client') THEN RAISE EXCEPTION 'Only your own "I don''t have this" can be undone.'; END IF;
    UPDATE public.doc_checklist_items SET status = 'needed', client_note = NULL WHERE id = p_item;
  ELSE
    RAISE EXCEPTION 'Unknown action.';
  END IF;
END $$;
REVOKE ALL ON FUNCTION public.my_checklist_item(UUID, TEXT, UUID, TEXT) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.my_checklist_item(UUID, TEXT, UUID, TEXT) TO authenticated;

-- Check: tables · RLS · upload trigger
SELECT to_regclass('public.doc_checklists') IS NOT NULL AND to_regclass('public.doc_checklist_items') IS NOT NULL AS tables_ok,
       (SELECT bool_and(relrowsecurity) FROM pg_class WHERE oid IN ('public.doc_checklists'::regclass, 'public.doc_checklist_items'::regclass)) AS rls_on,
       EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'trg_doc_upload_tick') AS upload_tick_ok;
