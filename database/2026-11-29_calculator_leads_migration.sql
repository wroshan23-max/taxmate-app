-- ════════════════════════════════════════════════════════════════════════════
-- V73 — Public Advanced Tax Calculator → "File my return with TaxMate" leads
--   A visitor (no login) who used the public calculator can send their name, mobile and the
--   figures. It lands in the Call Log as a follow-up (channel "Website"), with a push to the team.
--   Limits: the same mobile number within 12 hours updates the earlier lead; at most 60 new
--   website leads an hour in total (stops floods).
-- Safe to run more than once.
-- ════════════════════════════════════════════════════════════════════════════

ALTER TABLE public.call_logs DROP CONSTRAINT IF EXISTS call_logs_channel_check;
ALTER TABLE public.call_logs ADD CONSTRAINT call_logs_channel_check
  CHECK (channel IN ('incoming', 'outgoing', 'missed', 'whatsapp', 'walk_in', 'web'));

CREATE OR REPLACE FUNCTION public.submit_calc_lead(p_name TEXT, p_phone TEXT, p_email TEXT, p_year TEXT, p_summary TEXT, p_note TEXT, p_service TEXT DEFAULT 'iit')
RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE nm TEXT := left(trim(coalesce(p_name, '')), 120);
        ph TEXT := left(trim(coalesce(p_phone, '')), 30);
        em TEXT := nullif(lower(left(trim(coalesce(p_email, '')), 160)), '');
        k TEXT := public._phone_key(p_phone);
        body TEXT; old UUID; nid UUID; svc TEXT;
BEGIN
  IF length(nm) < 2 THEN RAISE EXCEPTION 'Please enter your name.'; END IF;
  IF length(regexp_replace(ph, '\D', '', 'g')) NOT BETWEEN 9 AND 15 THEN RAISE EXCEPTION 'Please enter a valid mobile number.'; END IF;
  IF em IS NOT NULL AND em !~ '^[^@\s]+@[^@\s]+\.[^@\s]+$' THEN RAISE EXCEPTION 'Please check the email address.'; END IF;
  IF p_year IS NOT NULL AND p_year !~ '^\d{4}/\d{2}$' THEN RAISE EXCEPTION 'Year?'; END IF;
  svc := CASE WHEN p_service IN ('iit', 'tin', 'ramis', 'consult') THEN p_service ELSE 'iit' END;
  body := '🌐 From the website tax calculator' || CASE WHEN p_year IS NOT NULL THEN ' — Y/A ' || p_year ELSE '' END || E'\n'
          || left(coalesce(p_summary, ''), 1500)
          || CASE WHEN nullif(trim(coalesce(p_note, '')), '') IS NOT NULL THEN E'\nMessage: ' || left(trim(p_note), 500) ELSE '' END;

  SELECT id INTO old FROM public.call_logs
   WHERE channel = 'web' AND phone_key = k AND created_at > NOW() - INTERVAL '12 hours' ORDER BY created_at DESC LIMIT 1;
  IF old IS NOT NULL THEN
    UPDATE public.call_logs SET name = nm, email = coalesce(em, email), notes = left(body, 3000), status = 'follow_up',
           follow_up_at = coalesce(follow_up_at, NOW()) WHERE id = old;
    RETURN jsonb_build_object('ok', true, 'again', true);
  END IF;
  IF (SELECT count(*) FROM public.call_logs WHERE channel = 'web' AND created_at > NOW() - INTERVAL '1 hour') >= 60 THEN
    RAISE EXCEPTION 'We are receiving many requests right now — please WhatsApp us instead.';
  END IF;

  INSERT INTO public.call_logs (channel, phone, name, email, services, source, notes, status, follow_up_at)
  VALUES ('web', ph, nm, em, ARRAY[svc], 'calculator', left(body, 3000), 'follow_up', NOW())
  RETURNING id INTO nid;
  BEGIN
    PERFORM public._push_send('admin', NULL, '🌐 New lead from the tax calculator', nm || ' · ' || ph || CASE WHEN p_year IS NOT NULL THEN ' · Y/A ' || p_year ELSE '' END,
      '/admin/calls?tab=follow', 'lead' || left(nid::text, 8));
  EXCEPTION WHEN undefined_function THEN NULL; END;
  RETURN jsonb_build_object('ok', true);
END $$;
REVOKE ALL ON FUNCTION public.submit_calc_lead(TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.submit_calc_lead(TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT) TO anon, authenticated;

-- Check
SELECT to_regprocedure('public.submit_calc_lead(text,text,text,text,text,text,text)') IS NOT NULL AS lead_rpc_ok,
       (SELECT pg_get_constraintdef(oid) LIKE '%web%' FROM pg_constraint WHERE conname = 'call_logs_channel_check') AS web_channel_ok;
