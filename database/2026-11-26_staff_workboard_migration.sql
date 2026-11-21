-- ════════════════════════════════════════════════════════════════════════════
-- V70 — Staff logins (limited admin) + Work board
--   • profiles.staff_level: NULL = full admin (owner) · 'staff' = staff member
--     Staff work with clients, returns, documents, invoices, calls and tasks, but cannot change
--     Settings, delete clients, invite admins or change anyone's access.
--     Every existing admin stays a full admin. A NEW admin login starts as staff (the owner can upgrade).
--   • work_items: tasks per client (IIT return, VAT return, bookkeeping…) moved across a board,
--     assigned to a team member, with due dates. A completed document checklist creates a task.
--   Safe to run more than once.
-- ════════════════════════════════════════════════════════════════════════════

-- ═══ 1. Staff level ═════════════════════════════════════════════════════════
ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS staff_level TEXT;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'profiles_staff_level_check') THEN
    ALTER TABLE public.profiles ADD CONSTRAINT profiles_staff_level_check CHECK (staff_level IS NULL OR staff_level = 'staff');
  END IF;
END $$;

-- full admin (not staff); false in "View as client" previews like is_admin()
CREATE OR REPLACE FUNCTION public.is_owner() RETURNS BOOLEAN LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT public.is_admin() AND coalesce((SELECT staff_level FROM public.profiles WHERE id = auth.uid()), '') <> 'staff';
$$;
REVOKE ALL ON FUNCTION public.is_owner() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.is_owner() TO authenticated;

-- role / staff level can only be changed by a full admin (or the server); a new admin login starts as staff
CREATE OR REPLACE FUNCTION public.guard_profile_role()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY INVOKER SET search_path = public AS $$
BEGIN
  IF TG_OP = 'UPDATE' THEN
    IF NEW.id IS DISTINCT FROM OLD.id THEN RAISE EXCEPTION 'Profile id cannot change'; END IF;
    IF (NEW.role IS DISTINCT FROM OLD.role OR NEW.staff_level IS DISTINCT FROM OLD.staff_level)
       AND current_user IN ('authenticated', 'anon') AND NOT public.is_owner() THEN
      RAISE EXCEPTION 'Only a full admin can change user access';
    END IF;
  END IF;
  -- someone who just became an admin starts as staff; a full admin upgrades them with admin_set_staff()
  IF NEW.role = 'admin' AND (TG_OP = 'INSERT' OR OLD.role IS DISTINCT FROM 'admin') AND NEW.staff_level IS NULL THEN
    NEW.staff_level := 'staff';
  END IF;
  IF NEW.role <> 'admin' THEN NEW.staff_level := NULL; END IF;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS profiles_guard_role ON public.profiles;
CREATE TRIGGER profiles_guard_role BEFORE INSERT OR UPDATE ON public.profiles
  FOR EACH ROW EXECUTE FUNCTION public.guard_profile_role();

-- Team list (for assigning work) and changing a member's level (full admins only)
CREATE OR REPLACE FUNCTION public.admin_team() RETURNS JSONB
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT CASE WHEN public.is_admin() THEN coalesce((
    SELECT jsonb_agg(jsonb_build_object('id', p.id, 'full_name', coalesce(nullif(p.full_name, ''), u.email), 'email', u.email, 'staff', p.staff_level = 'staff', 'me', p.id = auth.uid()) ORDER BY p.staff_level NULLS FIRST, p.full_name)
      FROM public.profiles p JOIN auth.users u ON u.id = p.id WHERE p.role = 'admin'), '[]'::jsonb) END;
$$;
REVOKE ALL ON FUNCTION public.admin_team() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_team() TO authenticated;

CREATE OR REPLACE FUNCTION public.admin_set_staff(p_user UUID, p_staff BOOLEAN) RETURNS VOID
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NOT public.is_owner() THEN RAISE EXCEPTION 'Only a full admin can change access.'; END IF;
  IF p_user = auth.uid() THEN RAISE EXCEPTION 'You cannot change your own access.'; END IF;
  IF NOT EXISTS (SELECT 1 FROM public.profiles WHERE id = p_user AND role = 'admin') THEN RAISE EXCEPTION 'That login is not an admin.'; END IF;
  UPDATE public.profiles SET staff_level = CASE WHEN p_staff THEN 'staff' END WHERE id = p_user;
END $$;
REVOKE ALL ON FUNCTION public.admin_set_staff(UUID, BOOLEAN) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_set_staff(UUID, BOOLEAN) TO authenticated;

-- ═══ 2. What staff cannot do (enforced by the database) ══════════════════════
-- Settings: every admin reads, only full admins write
DROP POLICY IF EXISTS "Admins manage settings" ON public.app_settings;
DROP POLICY IF EXISTS "Admins read settings" ON public.app_settings;
CREATE POLICY "Admins read settings" ON public.app_settings FOR SELECT USING (public.is_admin());
DROP POLICY IF EXISTS "Owners manage settings" ON public.app_settings;
CREATE POLICY "Owners manage settings" ON public.app_settings FOR ALL USING (public.is_owner()) WITH CHECK (public.is_owner());
-- Deleting a client: full admins only
DROP POLICY IF EXISTS "Only owners delete clients" ON public.clients;
CREATE POLICY "Only owners delete clients" ON public.clients AS RESTRICTIVE FOR DELETE USING (public.is_owner());
-- Admin invitations: full admins only (staff can still invite clients to the portal)
DROP POLICY IF EXISTS "Only owners invite admins" ON public.portal_invites;
CREATE POLICY "Only owners invite admins" ON public.portal_invites AS RESTRICTIVE FOR INSERT WITH CHECK (role <> 'admin' OR public.is_owner());
DROP POLICY IF EXISTS "Only owners change admin invites" ON public.portal_invites;
CREATE POLICY "Only owners change admin invites" ON public.portal_invites AS RESTRICTIVE FOR UPDATE USING (role <> 'admin' OR public.is_owner()) WITH CHECK (role <> 'admin' OR public.is_owner());

-- ═══ 3. Work board ══════════════════════════════════════════════════════════
CREATE TABLE IF NOT EXISTS public.work_items (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id   UUID REFERENCES public.clients(id) ON DELETE CASCADE,
  title       TEXT NOT NULL CHECK (length(title) BETWEEN 1 AND 150),
  kind        TEXT NOT NULL DEFAULT 'other' CHECK (length(kind) <= 30),
  period      TEXT CHECK (period IS NULL OR length(period) <= 30),             -- Y/A 2025/26, Nov 2026 …
  stage       TEXT NOT NULL DEFAULT 'todo' CHECK (stage IN ('todo', 'waiting', 'doing', 'review', 'done')),
  assignee    UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  due_date    DATE,
  priority    TEXT NOT NULL DEFAULT 'normal' CHECK (priority IN ('normal', 'high')),
  notes       TEXT CHECK (notes IS NULL OR length(notes) <= 3000),
  source      TEXT CHECK (source IS NULL OR length(source) <= 40),             -- 'checklist' when created automatically
  done_at     TIMESTAMPTZ,
  created_by  UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS work_items_open_idx ON public.work_items (stage, due_date) WHERE stage <> 'done';
CREATE INDEX IF NOT EXISTS work_items_client_idx ON public.work_items (client_id);
CREATE INDEX IF NOT EXISTS work_items_assignee_idx ON public.work_items (assignee) WHERE stage <> 'done';
CREATE UNIQUE INDEX IF NOT EXISTS work_items_auto_once ON public.work_items (client_id, kind, period) WHERE source = 'checklist';

ALTER TABLE public.work_items ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS work_items_admin ON public.work_items;
CREATE POLICY work_items_admin ON public.work_items FOR ALL TO authenticated USING (public.is_admin()) WITH CHECK (public.is_admin());
REVOKE ALL ON public.work_items FROM anon;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.work_items TO authenticated;

CREATE OR REPLACE FUNCTION public._work_item_trg() RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  NEW.updated_at := NOW();
  IF TG_OP = 'INSERT' THEN NEW.created_by := coalesce(NEW.created_by, auth.uid()); END IF;
  IF NEW.stage = 'done' AND (TG_OP = 'INSERT' OR OLD.stage <> 'done') THEN NEW.done_at := NOW(); END IF;
  IF NEW.stage <> 'done' THEN NEW.done_at := NULL; END IF;
  IF NEW.assignee IS NOT NULL AND NOT EXISTS (SELECT 1 FROM public.profiles WHERE id = NEW.assignee AND role = 'admin') THEN
    RAISE EXCEPTION 'Tasks can only be assigned to TaxMate team members.';
  END IF;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS trg_work_item ON public.work_items;
CREATE TRIGGER trg_work_item BEFORE INSERT OR UPDATE ON public.work_items FOR EACH ROW EXECUTE FUNCTION public._work_item_trg();

-- A completed document checklist creates "Prepare IIT return" on the board (once per client and Y/A)
CREATE OR REPLACE FUNCTION public._doc_list_progress() RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE lid UUID := coalesce(NEW.checklist_id, OLD.checklist_id); l public.doc_checklists; open_n INT; total INT; nm TEXT;
BEGIN
  SELECT * INTO l FROM public.doc_checklists WHERE id = lid;
  IF l.id IS NULL THEN RETURN NULL; END IF;
  SELECT count(*) FILTER (WHERE status = 'needed'), count(*) INTO open_n, total FROM public.doc_checklist_items WHERE checklist_id = lid;
  IF total > 0 AND open_n = 0 AND l.completed_at IS NULL THEN
    UPDATE public.doc_checklists SET completed_at = NOW(), updated_at = NOW() WHERE id = lid;
    SELECT full_name INTO nm FROM public.clients WHERE id = l.client_id;
    INSERT INTO public.work_items (client_id, title, kind, period, stage, source, notes)
    VALUES (l.client_id, 'Prepare IIT return — Y/A ' || l.year, 'iit', 'Y/A ' || l.year, 'todo', 'checklist', 'All documents received ' || to_char(NOW() AT TIME ZONE 'Asia/Colombo', 'DD Mon YYYY') || '.')
    ON CONFLICT DO NOTHING;
    BEGIN
      PERFORM public._push_send('admin', NULL, '✅ All documents received — ' || coalesce(nm, 'Client'), 'Y/A ' || l.year || ' checklist is complete. A task was added to the work board.', '/admin/work', 'docs' || left(lid::text, 8));
    EXCEPTION WHEN undefined_function THEN NULL; END;
  ELSIF open_n > 0 AND l.completed_at IS NOT NULL THEN
    UPDATE public.doc_checklists SET completed_at = NULL, updated_at = NOW() WHERE id = lid;
  END IF;
  RETURN NULL;
END $$;

-- ═══ Check ═════════════════════════════════════════════════════════════════
SELECT (SELECT count(*) FROM public.profiles WHERE role = 'admin' AND staff_level IS NULL) AS full_admins,
       (SELECT count(*) FROM public.profiles WHERE role = 'admin' AND staff_level = 'staff') AS staff,
       to_regclass('public.work_items') IS NOT NULL AS work_board_ok;
