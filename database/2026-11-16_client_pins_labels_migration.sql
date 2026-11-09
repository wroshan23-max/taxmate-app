-- ═══════════════════════════════════════════════════════════
--  TaxMate V60 — Pin clients to the top + coloured client labels (admin only)
--  • client_labels: your own labels (name + colour), e.g. "Docs pending" red
--  • client_flags: per client — pinned (with an optional note) and its labels
--  Admins only: clients never see pins, notes or labels.
--  Also: the V59 push keys (push_config) are kept out of the OneDrive backups.
--  Safe to re-run.
-- ═══════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS public.client_labels (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name       TEXT NOT NULL CHECK (length(trim(name)) BETWEEN 1 AND 30),
  color      TEXT NOT NULL DEFAULT 'blue' CHECK (color IN ('red', 'orange', 'amber', 'green', 'teal', 'blue', 'indigo', 'purple', 'pink', 'gray')),
  sort       INT NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE UNIQUE INDEX IF NOT EXISTS client_labels_name_uq ON public.client_labels (lower(trim(name)));
ALTER TABLE public.client_labels ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Admins manage client labels" ON public.client_labels;
CREATE POLICY "Admins manage client labels" ON public.client_labels FOR ALL USING (is_admin()) WITH CHECK (is_admin());

CREATE TABLE IF NOT EXISTS public.client_flags (
  client_id  UUID PRIMARY KEY REFERENCES public.clients(id) ON DELETE CASCADE,
  pinned_at  TIMESTAMPTZ,
  pin_note   TEXT CHECK (pin_note IS NULL OR length(pin_note) <= 120),
  label_ids  UUID[] NOT NULL DEFAULT '{}' CHECK (cardinality(label_ids) <= 10),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_by UUID REFERENCES auth.users(id) ON DELETE SET NULL
);
CREATE INDEX IF NOT EXISTS client_flags_pinned_idx ON public.client_flags (pinned_at) WHERE pinned_at IS NOT NULL;
ALTER TABLE public.client_flags ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Admins manage client flags" ON public.client_flags;
CREATE POLICY "Admins manage client flags" ON public.client_flags FOR ALL USING (is_admin()) WITH CHECK (is_admin());

-- A deleted label disappears from every client
CREATE OR REPLACE FUNCTION public._client_label_deleted() RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  UPDATE public.client_flags SET label_ids = array_remove(label_ids, OLD.id) WHERE OLD.id = ANY (label_ids);
  RETURN OLD;
END $$;
DROP TRIGGER IF EXISTS trg_client_label_deleted ON public.client_labels;
CREATE TRIGGER trg_client_label_deleted AFTER DELETE ON public.client_labels FOR EACH ROW EXECUTE FUNCTION public._client_label_deleted();

-- Starter labels (only when there are none yet) — rename, recolour or delete them in the app
INSERT INTO public.client_labels (name, color, sort)
SELECT * FROM (VALUES ('Docs pending', 'red', 1), ('Waiting for client', 'amber', 2), ('In progress', 'blue', 3),
                      ('Ready to file', 'green', 4), ('VIP', 'purple', 5)) v(name, color, sort)
WHERE NOT EXISTS (SELECT 1 FROM public.client_labels);

-- Keep the push keys (V59) out of the OneDrive backups
CREATE OR REPLACE FUNCTION public._backup_tables()
RETURNS SETOF TEXT LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT c.relname::text FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
  WHERE n.nspname = 'public' AND c.relkind IN ('r', 'p')
    AND c.relname NOT IN ('storage_connection', 'user_pins', 'pin_sessions', 'client_ird', 'password_resets', 'portal_invites',
                          'registration_attempts', 'drive_uploads', 'user_presence', 'backup_file_log', 'backups', 'push_config')
  ORDER BY 1;
$$;
REVOKE ALL ON FUNCTION public._backup_tables() FROM PUBLIC, anon, authenticated;

SELECT (SELECT count(*) FROM public.client_labels) AS labels,
       to_regclass('public.client_flags') IS NOT NULL AS flags_table,
       NOT EXISTS (SELECT 1 FROM public._backup_tables() t WHERE t = 'push_config') AS push_keys_not_backed_up;
