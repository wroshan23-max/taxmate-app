-- ═══════════════════════════════════════════════════════════
--  TaxMate V46 — Client registration numbers  TM-0001, TM-0002 …
--  • existing clients numbered in the order they were added
--  • every new client (admin, registration link, invite link) gets the next number automatically
--  • the number never changes and is never reused
--  Safe to re-run.
-- ═══════════════════════════════════════════════════════════

ALTER TABLE public.clients ADD COLUMN IF NOT EXISTS client_no TEXT;
CREATE SEQUENCE IF NOT EXISTS public.client_no_seq;

-- TM-0001 … TM-9999, then TM-10000 (never cut off)
CREATE OR REPLACE FUNCTION public._client_no(n BIGINT) RETURNS TEXT LANGUAGE sql IMMUTABLE AS $$
  SELECT 'TM-' || CASE WHEN n < 10000 THEN lpad(n::text, 4, '0') ELSE n::text END
$$;

-- 1. Number the existing clients (oldest first), after any number already given
WITH mx AS (
  SELECT coalesce(max(substring(client_no FROM 4)::BIGINT), 0) AS m FROM public.clients WHERE client_no ~ '^TM-\d+$'
), todo AS (
  SELECT id, row_number() OVER (ORDER BY created_at NULLS FIRST, id) AS n FROM public.clients WHERE client_no IS NULL
)
UPDATE public.clients c SET client_no = _client_no(mx.m + todo.n) FROM todo, mx WHERE c.id = todo.id;

-- 2. Next number continues from the highest one
SELECT setval('public.client_no_seq',
  greatest(1, (SELECT coalesce(max(substring(client_no FROM 4)::BIGINT), 0) FROM public.clients WHERE client_no ~ '^TM-\d+$')),
  (SELECT count(*) > 0 FROM public.clients WHERE client_no ~ '^TM-\d+$'));

ALTER TABLE public.clients ALTER COLUMN client_no SET NOT NULL;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'clients_client_no_key') THEN
    ALTER TABLE public.clients ADD CONSTRAINT clients_client_no_key UNIQUE (client_no);
  END IF;
END $$;

-- 3. New clients get the next number; the number can't be changed later
CREATE OR REPLACE FUNCTION public._set_client_no() RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    NEW.client_no := _client_no(nextval('public.client_no_seq'));
  ELSIF NEW.client_no IS DISTINCT FROM OLD.client_no THEN
    NEW.client_no := OLD.client_no;
  END IF;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS trg_set_client_no ON public.clients;
CREATE TRIGGER trg_set_client_no BEFORE INSERT OR UPDATE OF client_no ON public.clients
  FOR EACH ROW EXECUTE FUNCTION public._set_client_no();

SELECT client_no, full_name, created_at FROM public.clients ORDER BY client_no;
