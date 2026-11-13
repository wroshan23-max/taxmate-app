-- V64 VAT Invoice — scenario tests (run on a LOCAL Postgres copy, never on production).
-- Needs the TaxMate test stubs (auth.uid() from setting test.uid, profiles/clients seed). Ends with 'ALL VAT TESTS PASSED'.
-- Covers IRD/spec scenarios 1–15: VAT engine, numbering, immutability, notes, payments, ledger, RAMIS queue (pending config,
-- duplicate, timeout + status check, accepted + lock, rejected → corrected draft, failed → retry), purchaser inbox, reminders,
-- roles, tenant isolation, tax-rate versioning, subscription expiry.

CREATE SCHEMA IF NOT EXISTS extensions;
ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS full_name TEXT; ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS email TEXT;
ALTER TABLE auth.users ADD COLUMN IF NOT EXISTS email TEXT;
INSERT INTO auth.users (id, email) VALUES ('aaaaaaaa-0000-0000-0000-000000000001', 'admin@taxmate.lk'), ('cccccccc-0000-0000-0000-000000000003', 'kasun@x.lk'),
  ('dddddddd-0000-0000-0000-000000000004', 'nimali@x.lk'), ('eeeeeeee-0000-0000-0000-000000000005', 'op@x.lk') ON CONFLICT (id) DO UPDATE SET email = EXCLUDED.email;
INSERT INTO public.profiles (id, role) VALUES ('eeeeeeee-0000-0000-0000-000000000005', 'client') ON CONFLICT DO NOTHING;
GRANT SELECT ON ALL TABLES IN SCHEMA public TO authenticated;
GRANT SELECT ON ALL TABLES IN SCHEMA public TO anon;
GRANT USAGE ON SCHEMA extensions TO authenticated, anon;
CREATE OR REPLACE FUNCTION public.t_as(p_uid TEXT) RETURNS VOID LANGUAGE plpgsql AS $$
BEGIN
  EXECUTE 'RESET ROLE';
  PERFORM set_config('test.uid', coalesce(p_uid, ''), false);
  IF p_uid IS NULL THEN EXECUTE 'SET ROLE anon'; ELSIF p_uid <> 'super' THEN EXECUTE 'SET ROLE authenticated'; ELSE PERFORM set_config('test.uid', '', false); END IF;
END $$;
GRANT EXECUTE ON FUNCTION public.t_as(TEXT) TO authenticated, anon;
-- add-on for Kasun (active monthly) and Nimali (trial)
DELETE FROM public.service_addons WHERE addon_key = 'vat_invoice';
INSERT INTO public.service_addons (client_id, addon_key, addon_name, price, status, billing_cycle, next_bill_date)
VALUES ('11111111-1111-1111-1111-111111111111', 'vat_invoice', 'VAT Invoice & RAMIS', 2500, 'active', 'monthly', CURRENT_DATE + 20),
       ('22222222-2222-2222-2222-222222222222', 'vat_invoice', 'VAT Invoice & RAMIS', 0, 'trial', 'monthly', NULL);
UPDATE public.service_addons SET trial_ends = CURRENT_DATE + 10 WHERE client_id = '22222222-2222-2222-2222-222222222222' AND addon_key = 'vat_invoice';

\set ON_ERROR_STOP 1
DO $T$
DECLARE K UUID := '11111111-1111-1111-1111-111111111111'; NIM UUID := '22222222-2222-2222-2222-222222222222';
        ku TEXT := 'cccccccc-0000-0000-0000-000000000003'; nu TEXT := 'dddddddd-0000-0000-0000-000000000004';
        au TEXT := 'aaaaaaaa-0000-0000-0000-000000000001'; ou TEXT := 'eeeeeeee-0000-0000-0000-000000000005';
        cust UUID; inv UUID; inv2 UUID; inv3 UUID; nt UUID; cn UUID; dn UUID; r JSONB; d public.vi_documents; x NUMERIC; n INT; msg TEXT; tok UUID; sub JSONB;
        p1 JSONB; ok BOOLEAN; fixd UUID; pu UUID; s TEXT; inc UUID;
BEGIN
  -- ── Setup by the owner ──
  PERFORM t_as(ku);
  PERFORM vi_save_settings(K, '{"legal_name":"Kasun Traders (Pvt) Ltd","tin":"111111111","vat_registered":true,"vat_effective":"2024-01-01","address":"12 Galle Rd, Colombo 3","phone":"0112345678","terms":"Pay within 30 days","email":"accounts@kasun.lk"}');
  PERFORM t_as(nu);
  PERFORM vi_save_settings(NIM, '{"legal_name":"Nimali Holdings","tin":"222222222","vat_registered":true,"address":"5 Kandy Rd"}');
  PERFORM t_as(ku);
  cust := vi_save_customer(K, '{"name":"Nimali Holdings","tin":"222222222","vat_registered":true,"address":"5 Kandy Rd","email":"pay@nimali.lk","terms_days":30}');

  -- ── Scenario 1: tax invoice, VAT engine ──
  inv := vi_save_draft(K, jsonb_build_object('doc_type','tax','customer_id',cust,'issue_date','2026-11-13','supply_date','2026-11-12'),
    '[{"description":"Steel rods 12mm","quantity":10,"unit":"Nos","unit_price":1000,"rate_code":"VAT_STD"},
      {"description":"Delivery and installation","quantity":1,"unit":"Job","unit_price":5000,"disc_pct":10,"rate_code":"VAT_STD","supply_kind":"services"}]');
  SELECT * INTO d FROM vi_documents WHERE id = inv;
  ASSERT d.net_total = 14500 AND d.vat_total = 2610 AND d.total = 17110, format('calc %s %s %s', d.net_total, d.vat_total, d.total);
  r := vi_issue(inv);
  SELECT * INTO d FROM vi_documents WHERE id = inv;
  ASSERT d.doc_no = '26NOV_MAIN_00001', d.doc_no;
  ASSERT d.status = 'issued' AND d.pay_status = 'unpaid' AND d.balance = 17110 AND d.ramis_status = 'draft', d.ramis_status;
  ASSERT d.supplier->>'tin' = '111111111' AND d.customer->>'tin' = '222222222';
  ASSERT (SELECT string_agg(schedule, ',' ORDER BY sort) FROM vi_document_lines WHERE doc_id = inv) = '01,01';
  RAISE NOTICE 'S1 ok: % net % vat % total %', d.doc_no, d.net_total, d.vat_total, d.total;

  -- inclusive pricing + document discount
  inc := vi_save_draft(K, jsonb_build_object('doc_type','tax','customer_id',cust,'issue_date','2026-11-13','supply_date','2026-11-13','price_mode','inclusive','disc_amt',118),
    '[{"description":"Cement 50kg bags","quantity":1,"unit":"Bag","unit_price":1180,"rate_code":"VAT_STD"},{"description":"Paint 4L tin","quantity":2,"unit":"Tin","unit_price":590,"rate_code":"VAT_STD"}]');
  SELECT * INTO d FROM vi_documents WHERE id = inc;
  ASSERT d.total = 2242 AND d.vat_total = 342 AND d.net_total = 1900, format('incl %s %s %s', d.net_total, d.vat_total, d.total);
  PERFORM vi_delete_draft(inc);
  ASSERT NOT EXISTS (SELECT 1 FROM vi_documents WHERE id = inc);

  -- ── Scenario 11: supplier invoice appears in purchaser inbox ──
  PERFORM t_as(nu);
  SELECT id INTO pu FROM vi_purchases WHERE client_id = NIM AND linked_doc_id = inv;
  ASSERT pu IS NOT NULL AND (SELECT approval FROM vi_purchases WHERE id = pu) = 'pending';
  -- tenant isolation: Nimali cannot see Kasun's documents directly
  ASSERT (SELECT count(*) FROM vi_documents WHERE client_id = K) = 0;
  BEGIN PERFORM vi_save_draft(K, '{"doc_type":"nontax","customer":{"name":"x"}}', '[{"description":"Hack line","quantity":1,"unit_price":1}]'); ASSERT false, 'isolation';
  EXCEPTION WHEN assert_failure THEN RAISE; WHEN others THEN ASSERT SQLERRM = 'Not allowed.', SQLERRM; END;
  -- Scenario 12/13: purchaser approves → matched; dispute needs note
  ASSERT vi_review_purchase(pu, 'approved') = 'matched';
  BEGIN PERFORM vi_review_purchase(pu, 'disputed'); ASSERT false; EXCEPTION WHEN assert_failure THEN RAISE; WHEN others THEN ASSERT SQLERRM LIKE 'Write the reason%'; END;
  PERFORM vi_review_purchase(pu, 'disputed', 'Quantity differs from GRN');
  ASSERT (SELECT approval FROM vi_purchases WHERE id = pu) = 'disputed';
  PERFORM vi_review_purchase(pu, 'approved');
  r := vi_purchase_document(pu); ASSERT r->'doc'->>'doc_no' = '26NOV_MAIN_00001';
  RAISE NOTICE 'S11-13 ok: purchaser inbox, matched, dispute';

  -- ── Scenario 5: issued document cannot be edited / deleted ──
  PERFORM t_as(ku);
  BEGIN PERFORM vi_save_draft(K, jsonb_build_object('id', inv), '[{"description":"x y z","quantity":1,"unit_price":1}]'); ASSERT false;
  EXCEPTION WHEN assert_failure THEN RAISE; WHEN others THEN ASSERT SQLERRM LIKE 'This document is issued%', SQLERRM; END;
  BEGIN PERFORM vi_delete_draft(inv); ASSERT false; EXCEPTION WHEN assert_failure THEN RAISE; WHEN others THEN ASSERT SQLERRM LIKE 'Issued documents cannot be deleted%'; END;
  PERFORM t_as('super');
  BEGIN UPDATE vi_documents SET total = 1 WHERE id = inv; ASSERT false; EXCEPTION WHEN assert_failure THEN RAISE; WHEN others THEN ASSERT SQLERRM LIKE 'This document is issued%', SQLERRM; END;
  BEGIN DELETE FROM vi_documents WHERE id = inv; ASSERT false; EXCEPTION WHEN assert_failure THEN RAISE; WHEN others THEN ASSERT SQLERRM LIKE 'Issued documents%'; END;
  BEGIN UPDATE vi_document_lines SET unit_price = 1 WHERE doc_id = inv; ASSERT false; EXCEPTION WHEN assert_failure THEN RAISE; WHEN others THEN ASSERT SQLERRM LIKE 'Lines of an issued%'; END;
  BEGIN UPDATE vi_audit SET action = 'x'; ASSERT false; EXCEPTION WHEN assert_failure THEN RAISE; WHEN others THEN ASSERT SQLERRM LIKE 'The audit trail cannot%'; END;
  BEGIN DELETE FROM clients WHERE id = K; ASSERT false; EXCEPTION WHEN assert_failure THEN RAISE; WHEN others THEN ASSERT SQLERRM LIKE 'This client has issued VAT%', SQLERRM; END;
  RAISE NOTICE 'S5 ok: edits / deletes blocked (also direct SQL), audit immutable, client delete blocked';

  -- ── Scenario 8/9: partial and full payment ──
  PERFORM t_as(ku);
  r := vi_record_payment(K, jsonb_build_object('doc_id', inv, 'amount', 10000, 'method', 'bank_transfer', 'paid_on', '2026-11-13', 'reference', 'BOC 991'));
  SELECT * INTO d FROM vi_documents WHERE id = inv;
  ASSERT d.pay_status = 'partial' AND d.balance = 7110 AND d.paid = 10000, format('%s %s', d.pay_status, d.balance);
  ASSERT r->>'receipt_no' = 'RC-2026-00001', r->>'receipt_no';
  p1 := r;
  -- ── Scenario 14: credit note against the invoice ──
  cn := vi_save_draft(K, jsonb_build_object('doc_type','credit','original_id',inv,'issue_date','2026-11-13','reason_code','return','reason','2 rods returned'),
    '[{"description":"Steel rods 12mm — returned","quantity":2,"unit":"Nos","unit_price":1000,"rate_code":"VAT_STD"}]');
  r := vi_issue(cn);
  SELECT * INTO d FROM vi_documents WHERE id = cn;
  ASSERT d.doc_no = 'CN-2026-00001' AND d.total = 2360 AND d.is_tax AND d.pay_status = 'na', format('%s %s', d.doc_no, d.total);
  ASSERT (SELECT schedule FROM vi_document_lines WHERE doc_id = cn) = '04';
  SELECT * INTO d FROM vi_documents WHERE id = inv;
  ASSERT d.credited = 2360 AND d.balance = 4750, format('after CN %s %s', d.credited, d.balance);
  -- credit more than the invoice → refused
  cn := vi_save_draft(K, jsonb_build_object('doc_type','credit','original_id',inv,'issue_date','2026-11-13','reason_code','overcharge'),
    '[{"description":"Overcharge adjustment","quantity":1,"unit":"Nos","unit_price":50000,"rate_code":"VAT_STD"}]');
  BEGIN PERFORM vi_issue(cn); ASSERT false; EXCEPTION WHEN assert_failure THEN RAISE; WHEN others THEN ASSERT SQLERRM LIKE '%credit at most%', SQLERRM; END;
  PERFORM vi_delete_draft(cn);
  -- ── Scenario 15: debit note ──
  dn := vi_save_draft(K, jsonb_build_object('doc_type','debit','original_id',inv,'issue_date','2026-11-13','reason_code','undercharge'),
    '[{"description":"Price difference — steel rods","quantity":10,"unit":"Nos","unit_price":50,"rate_code":"VAT_STD"}]');
  r := vi_issue(dn);
  SELECT * INTO d FROM vi_documents WHERE id = inv;
  ASSERT d.debited = 590 AND d.balance = 5340, format('after DN %s %s', d.debited, d.balance);
  r := vi_record_payment(K, jsonb_build_object('doc_id', inv, 'amount', 5340, 'method', 'cash', 'paid_on', '2026-11-13'));
  SELECT * INTO d FROM vi_documents WHERE id = inv;
  ASSERT d.pay_status = 'paid' AND d.balance = 0;
  -- void payment → partial again; payments can't be deleted
  PERFORM vi_void_payment((r->>'id')::uuid, 'Cheque bounced');
  SELECT * INTO d FROM vi_documents WHERE id = inv;
  ASSERT d.pay_status = 'partial' AND d.balance = 5340;
  PERFORM t_as('super');
  BEGIN DELETE FROM vi_payments WHERE id = (p1->>'id')::uuid; ASSERT false; EXCEPTION WHEN assert_failure THEN RAISE; WHEN others THEN ASSERT SQLERRM LIKE 'Payments cannot be deleted%'; END;
  PERFORM t_as(ku);
  -- overpayment
  r := vi_record_payment(K, jsonb_build_object('doc_id', inv, 'amount', 6000, 'method', 'cash', 'paid_on', '2026-11-13'));
  ASSERT (SELECT pay_status FROM vi_documents WHERE id = inv) = 'overpaid';
  RAISE NOTICE 'S8/9/14/15 ok: partial, CN, DN, paid, void, overpaid';

  -- ledger: opening + invoices + DN − CN − payments = closing
  r := vi_customer_ledger(K, cust);
  ASSERT (r->>'closing')::numeric = 17110 + 590 - 2360 - 10000 - 6000, r->>'closing';
  RAISE NOTICE 'Ledger ok: closing %', r->>'closing';

  -- ── Scenario 7: non-tax invoice never goes to RAMIS ──
  nt := vi_save_draft(K, jsonb_build_object('doc_type','nontax','customer',jsonb_build_object('name','Walk-in customer'),'issue_date','2026-11-13'),
    '[{"description":"Consulting session","quantity":2,"unit":"Hrs","unit_price":2500,"rate_code":"VAT_STD"}]');
  r := vi_issue(nt);
  SELECT * INTO d FROM vi_documents WHERE id = nt;
  ASSERT d.doc_no = 'NT-2026-00001' AND d.vat_total = 0 AND d.total = 5000 AND d.ramis_status = 'na' AND NOT d.is_tax;
  ASSERT (SELECT bool_and(treatment = 'none' AND schedule IS NULL) FROM vi_document_lines WHERE doc_id = nt);
  PERFORM vi_save_ramis_config(K, '{"enabled":true}');
  BEGIN PERFORM vi_submit_ramis(nt); ASSERT false; EXCEPTION WHEN assert_failure THEN RAISE; WHEN others THEN ASSERT SQLERRM LIKE '%Only issued tax invoices%', SQLERRM; END;
  RAISE NOTICE 'S7 ok: non-tax invoice blocked from RAMIS';

  -- generic description refused on a tax invoice; earlier date than the last tax invoice refused
  inv2 := vi_save_draft(K, jsonb_build_object('doc_type','tax','customer_id',cust,'issue_date','2026-11-13','supply_date','2026-11-13'),
    '[{"description":"Services","quantity":1,"unit":"Job","unit_price":1000,"rate_code":"VAT_STD"}]');
  BEGIN PERFORM vi_issue(inv2); ASSERT false; EXCEPTION WHEN assert_failure THEN RAISE; WHEN others THEN ASSERT SQLERRM LIKE '%general words%', SQLERRM; END;
  inv2 := vi_save_draft(K, jsonb_build_object('id', inv2, 'customer_id',cust,'issue_date','2026-11-10','supply_date','2026-11-10'),
    '[{"description":"Site survey service","quantity":1,"unit":"Job","unit_price":1000,"rate_code":"VAT_STD"}]');
  BEGIN PERFORM vi_issue(inv2); ASSERT false; EXCEPTION WHEN assert_failure THEN RAISE; WHEN others THEN ASSERT SQLERRM LIKE '%sequential continuity%', SQLERRM; END;
  inv2 := vi_save_draft(K, jsonb_build_object('id', inv2, 'customer_id',cust,'issue_date','2026-11-13','supply_date','2026-11-13'),
    '[{"description":"Site survey service","quantity":1,"unit":"Job","unit_price":1000,"rate_code":"VAT_STD","supply_kind":"services"}]');
  r := vi_issue(inv2);
  ASSERT r->>'doc_no' = '26NOV_MAIN_00002', r->>'doc_no';
  RAISE NOTICE 'Validation ok: generic words, sequential date; numbering 00002';

  -- ── RAMIS: login + consent required; pending configuration; duplicates; withdraw ──
  BEGIN PERFORM vi_submit_ramis(inv2); ASSERT false; EXCEPTION WHEN assert_failure THEN RAISE; WHEN others THEN ASSERT SQLERRM LIKE '%RAMIS login%', SQLERRM; END;
  PERFORM t_as('super');
  INSERT INTO client_ird (client_id, ssid_enc, pin_enc) VALUES (K, pgp_sym_encrypt('SSID123', 'testkey'), pgp_sym_encrypt('pw', 'testkey'));
  PERFORM t_as(ku);
  PERFORM vi_save_ramis_config(K, '{"enabled":true,"use_saved_login":true}');
  sub := vi_submit_ramis(inv2);
  ASSERT sub->>'status' = 'pending_config', sub::text;
  ASSERT (SELECT ramis_status FROM vi_documents WHERE id = inv2) = 'queued';
  ASSERT (vi_submit_ramis(inv2))->>'already' = 'true';                                       -- Scenario 4: duplicate attempt
  BEGIN PERFORM vi_cancel(inv2, 'test'); ASSERT false; EXCEPTION WHEN assert_failure THEN RAISE; WHEN others THEN ASSERT SQLERRM LIKE '%already been submitted to RAMIS%', SQLERRM; END;
  PERFORM vi_ramis_withdraw(inv2);
  ASSERT (SELECT ramis_status FROM vi_documents WHERE id = inv2) = 'ready';
  -- the pending adapter never says "submitted"
  PERFORM t_as('super');
  ASSERT NOT EXISTS (SELECT 1 FROM vi_ramis_submissions WHERE status IN ('submitted', 'accepted'));
  -- admin activates an adapter (as if configured from IRD's spec)
  PERFORM t_as(au);
  PERFORM admin_vi_ramis_api('{"adapter":"v1","config":{"status":"active","spec_version":"TEST-ONLY","auth_method":"ssid_password_jwt","production":{"base_url":"https://example.invalid"}}}');
  PERFORM t_as(ku);
  sub := vi_submit_ramis(inv2);
  ASSERT sub->>'status' = 'queued';
  PERFORM t_as('super');
  -- Scenario 3: timeout → retry with status check first
  r := _vi_ramis_claim(10); ASSERT jsonb_array_length(r) = 1 AND (r->0->>'attempt')::int = 1;
  PERFORM _vi_ramis_result((r->0->>'id')::uuid, 'unknown', NULL, NULL, NULL, 'TIMEOUT', 'No answer in 30 s');
  ASSERT (SELECT status = 'retrying' AND check_first FROM vi_ramis_submissions WHERE id = (r->0->>'id')::uuid);
  ASSERT (SELECT ramis_status FROM vi_documents WHERE id = inv2) = 'queued';
  UPDATE vi_ramis_submissions SET next_attempt_at = NOW() WHERE id = (r->0->>'id')::uuid;
  r := _vi_ramis_claim(10); ASSERT (r->0->>'check_first')::boolean AND (r->0->>'attempt')::int = 2;
  -- Scenario 1 (RAMIS): accepted → locked
  PERFORM _vi_ramis_result((r->0->>'id')::uuid, 'accepted', 200, 'ACCEPTED', 'RAMIS-REF-1');
  SELECT * INTO d FROM vi_documents WHERE id = inv2;
  ASSERT d.ramis_status = 'accepted' AND d.locked_at IS NOT NULL AND d.ramis_ref = 'RAMIS-REF-1' AND d.ramis_message = 'Submitted to IRD/RAMIS – Locked';
  BEGIN UPDATE vi_documents SET notes = 'x' WHERE id = inv2; ASSERT false; EXCEPTION WHEN assert_failure THEN RAISE; WHEN others THEN ASSERT SQLERRM LIKE 'This invoice has already been submitted to RAMIS%', SQLERRM; END;
  BEGIN UPDATE vi_documents SET ramis_status = 'ready' WHERE id = inv2; ASSERT false; EXCEPTION WHEN assert_failure THEN RAISE; WHEN others THEN ASSERT SQLERRM LIKE '%stays locked%'; END;
  PERFORM t_as(ku);
  BEGIN PERFORM vi_cancel(inv2, 'x'); ASSERT false; EXCEPTION WHEN assert_failure THEN RAISE; WHEN others THEN ASSERT SQLERRM LIKE '%cannot be edited or deleted. Create a Credit Note%'; END;
  -- Scenario 6: correction by credit note — the note goes to RAMIS itself
  cn := vi_save_draft(K, jsonb_build_object('doc_type','credit','original_id',inv2,'issue_date','2026-11-13','reason_code','vat_error','reason','Wrong price'),
    '[{"description":"Site survey service — price correction","quantity":1,"unit":"Job","unit_price":200,"rate_code":"VAT_STD","supply_kind":"services"}]');
  r := vi_issue(cn);
  SELECT * INTO d FROM vi_documents WHERE id = cn;
  ASSERT d.is_tax AND d.ramis_status = 'ready' AND d.doc_no = 'CN-2026-00002';
  ASSERT (SELECT credited FROM vi_documents WHERE id = inv2) = 236;
  sub := vi_submit_ramis(cn);
  ASSERT sub->>'status' = 'queued' AND (SELECT kind FROM vi_ramis_submissions WHERE id = (sub->>'id')::uuid) = 'credit';
  RAISE NOTICE 'S1/3/4/5/6 RAMIS ok: pending config, duplicate, withdraw, timeout+status check, accepted+locked, CN correction';

  -- Scenario 2: rejected (invalid TIN) → corrected draft
  inv3 := vi_save_draft(K, jsonb_build_object('doc_type','tax','customer_id',cust,'issue_date','2026-11-13','supply_date','2026-11-13'),
    '[{"description":"Steel plates 6mm","quantity":3,"unit":"Nos","unit_price":4000,"rate_code":"VAT_STD"}]');
  r := vi_issue(inv3);
  sub := vi_submit_ramis(inv3);
  PERFORM t_as('super');
  r := _vi_ramis_claim(10);
  FOR n IN 0 .. jsonb_array_length(r) - 1 LOOP
    IF r->n->>'doc_id' = inv3::text THEN
      PERFORM _vi_ramis_result((r->n->>'id')::uuid, 'rejected', 422, 'REJECTED', NULL, 'INVALID_PURCHASER_TIN', 'Invalid Purchaser TIN');
    ELSE
      PERFORM _vi_ramis_result((r->n->>'id')::uuid, 'retry', 503, NULL, NULL, 'HTTP_503', 'Service unavailable');
    END IF;
  END LOOP;
  ASSERT (SELECT ramis_status FROM vi_documents WHERE id = inv3) = 'rejected';
  PERFORM t_as(ku);
  BEGIN PERFORM vi_submit_ramis(inv3); ASSERT false; EXCEPTION WHEN assert_failure THEN RAISE; WHEN others THEN ASSERT SQLERRM LIKE '%create a corrected draft%'; END;
  fixd := vi_correct_rejected(inv3);
  ASSERT (SELECT status FROM vi_documents WHERE id = inv3) = 'cancelled' AND (SELECT status FROM vi_documents WHERE id = fixd) = 'draft';
  ASSERT (SELECT replaced_by FROM vi_documents WHERE id = inv3) = fixd;
  -- failed after max attempts → manual retry makes a new submission
  PERFORM t_as('super');
  UPDATE vi_ramis_submissions SET max_attempts = 2, next_attempt_at = NOW() WHERE doc_id = cn AND status = 'retrying';
  r := _vi_ramis_claim(10);
  PERFORM _vi_ramis_result((r->0->>'id')::uuid, 'retry', 503, NULL, NULL, 'HTTP_503', 'Service unavailable');
  ASSERT (SELECT ramis_status FROM vi_documents WHERE id = cn) = 'failed', (SELECT ramis_status FROM vi_documents WHERE id = cn);
  PERFORM t_as(ku);
  sub := vi_ramis_retry(cn);
  ASSERT sub->>'status' = 'queued' AND (SELECT count(*) FROM vi_ramis_submissions WHERE doc_id = cn) = 2;
  RAISE NOTICE 'S2 ok: rejected → corrected draft; failed → manual retry';

  -- ── share link (customer page) ──
  r := vi_share(inv, 30); tok := (r->>'token')::uuid;
  PERFORM t_as(NULL);
  r := vi_public_document(tok);
  ASSERT r->'doc'->>'doc_no' = '26NOV_MAIN_00001' AND r ? 'brand' AND NOT (r->'doc' ? 'client_id') AND NOT (r->'doc' ? 'id');
  ASSERT vi_public_document(gen_random_uuid()) IS NULL;
  ASSERT (SELECT count(*) FROM vi_documents) = 0;                                              -- anon reads nothing directly
  RAISE NOTICE 'Share ok';

  -- ── Scenario 10: automatic reminder ──
  PERFORM t_as(ku);
  PERFORM vi_save_settings(K, '{"legal_name":"Kasun Traders (Pvt) Ltd","tin":"111111111","vat_registered":true,"vat_effective":"2024-01-01","address":"12 Galle Rd, Colombo 3","auto_reminders":true}');
  PERFORM t_as('super');
  UPDATE vi_sequences SET next_no = next_no WHERE false;  -- no-op
  -- a non-tax invoice due 3 days ago, email customer
  PERFORM t_as(ku);
  nt := vi_save_draft(K, jsonb_build_object('doc_type','nontax','customer_id',cust,'issue_date', (now() AT TIME ZONE 'Asia/Colombo')::date - 33, 'terms_days', 30),
    '[{"description":"Monthly maintenance","quantity":1,"unit":"Month","unit_price":3000}]');
  r := vi_issue(nt);
  PERFORM t_as('super');
  r := _vi_due_reminders(100);
  ASSERT EXISTS (SELECT 1 FROM jsonb_array_elements(r) e WHERE e->>'id' = nt::text AND e->>'rule_key' = 'after3'), r::text;
  PERFORM _vi_reminder_done(nt, 'after3', 'email', 'pay@nimali.lk', 'test', true, NULL, true, NULL);
  ASSERT NOT EXISTS (SELECT 1 FROM jsonb_array_elements(_vi_due_reminders(100)) e WHERE e->>'id' = nt::text);
  RAISE NOTICE 'S10 ok: auto reminder picked once';

  -- ── Roles: invoice operator ──
  PERFORM t_as(ku);
  PERFORM vi_save_member(K, 'op@x.lk', 'invoice_operator');
  PERFORM t_as(ou);
  ASSERT (SELECT count(*) FROM vi_documents WHERE client_id = K) > 0;
  inv := vi_save_draft(K, jsonb_build_object('doc_type','nontax','customer_id',cust,'issue_date', (now() AT TIME ZONE 'Asia/Colombo')::date), '[{"description":"Spare parts supply","quantity":1,"unit":"Nos","unit_price":100}]');
  r := vi_issue(inv);
  BEGIN PERFORM vi_cancel(inv, 'x'); ASSERT false; EXCEPTION WHEN assert_failure THEN RAISE; WHEN others THEN ASSERT SQLERRM = 'Your role does not allow this.', SQLERRM; END;
  BEGIN PERFORM vi_save_settings(K, '{}'); ASSERT false; EXCEPTION WHEN assert_failure THEN RAISE; WHEN others THEN ASSERT SQLERRM = 'Your role does not allow this.'; END;
  ASSERT (SELECT count(*) FROM vi_audit WHERE client_id = K) = 0;   -- operators don't see the audit trail
  ASSERT (vi_my_workspaces())->0->>'role' = 'invoice_operator';
  PERFORM t_as(ku);
  ASSERT (SELECT count(*) FROM vi_audit WHERE client_id = K AND action = 'issued') >= 6;
  RAISE NOTICE 'Roles ok';

  -- ── Tax-rate versioning ──
  PERFORM t_as(au);
  PERFORM admin_vi_save_rate('{"code":"VAT_STD","treatment":"standard","rate":20,"effective_from":"2027-01-01","description":"VAT — test future rate"}');
  ASSERT (SELECT effective_to FROM vi_tax_rates WHERE code = 'VAT_STD' AND rate = 18) = DATE '2026-12-31';
  BEGIN PERFORM admin_vi_save_rate(jsonb_build_object('id', (SELECT id FROM vi_tax_rates WHERE code = 'VAT_STD' AND rate = 18), 'code','VAT_STD','treatment','standard','rate',15,'effective_from','2024-01-01','description','x'));
    ASSERT false; EXCEPTION WHEN assert_failure THEN RAISE; WHEN others THEN ASSERT SQLERRM LIKE '%on issued invoices%'; END;
  PERFORM t_as(ku);
  inv := vi_save_draft(K, jsonb_build_object('doc_type','tax','customer_id',cust,'issue_date','2026-11-13','supply_date','2027-01-05'),
    '[{"description":"Advance billing — steel","quantity":1,"unit":"Nos","unit_price":1000,"rate_code":"VAT_STD"}]');
  ASSERT (SELECT vat_total FROM vi_documents WHERE id = inv) = 200;
  ASSERT (SELECT vat_total FROM vi_documents WHERE doc_no = '26NOV_MAIN_00001' AND client_id = K) = 2610;
  PERFORM vi_delete_draft(inv);
  PERFORM t_as('super');
  DELETE FROM vi_tax_rates WHERE code = 'VAT_STD' AND rate = 20; UPDATE vi_tax_rates SET effective_to = NULL WHERE code = 'VAT_STD';
  RAISE NOTICE 'Tax rate versioning ok';

  -- ── Subscription expired: read-only ──
  UPDATE service_addons SET status = 'expired' WHERE client_id = K AND addon_key = 'vat_invoice';
  PERFORM t_as(ku);
  ASSERT (SELECT count(*) FROM vi_documents WHERE client_id = K) > 0;
  BEGIN PERFORM vi_save_draft(K, '{"doc_type":"nontax","customer":{"name":"x"}}', '[{"description":"Something sold","quantity":1,"unit_price":1}]'); ASSERT false;
  EXCEPTION WHEN assert_failure THEN RAISE; WHEN others THEN ASSERT SQLERRM LIKE 'VAT Invoice add-on is expired%', SQLERRM; END;
  ASSERT (vi_context(K))->>'status' = 'expired';
  PERFORM t_as(au);   -- TaxMate staff can still help
  ASSERT (vi_context(K))->'perms'->>'create' = 'true';
  PERFORM t_as('super');
  UPDATE service_addons SET status = 'active' WHERE client_id = K AND addon_key = 'vat_invoice';
  -- trial expiry by the daily job
  UPDATE service_addons SET trial_ends = (now() AT TIME ZONE 'Asia/Colombo')::date - 1 WHERE client_id = NIM AND addon_key = 'vat_invoice';
  r := _vi_daily();
  ASSERT (SELECT status FROM service_addons WHERE client_id = NIM AND addon_key = 'vat_invoice') = 'expired';
  RAISE NOTICE 'Subscription ok: % ', r;

  -- numbering: next number cannot go below the last used
  PERFORM t_as(ku);
  PERFORM vi_save_sequence(K, '{"doc_type":"tax","code":"MAIN","next_no":1}');
  ASSERT (SELECT next_no FROM vi_sequences WHERE client_id = K AND doc_type = 'tax' AND code = 'MAIN') = 4, (SELECT next_no::text FROM vi_sequences WHERE client_id = K AND doc_type = 'tax' AND code = 'MAIN');
  BEGIN PERFORM vi_save_sequence(K, '{"doc_type":"tax","code":"MAIN","reset":"monthly"}'); ASSERT false; EXCEPTION WHEN assert_failure THEN RAISE; WHEN others THEN ASSERT SQLERRM LIKE 'IRD: tax invoice numbers continue%'; END;
  PERFORM vi_save_branch(K, '{"code":"KANDY","name":"Kandy branch","address":"1 Temple St, Kandy"}');
  inv := vi_save_draft(K, jsonb_build_object('doc_type','tax','customer_id',cust,'branch_id',(SELECT id FROM vi_branches WHERE client_id = K AND code = 'KANDY'),'issue_date','2026-11-13','supply_date','2026-11-13'),
    '[{"description":"Tiles 2x2 ft","quantity":5,"unit":"Box","unit_price":2000,"rate_code":"VAT_STD"}]');
  r := vi_issue(inv);
  ASSERT r->>'doc_no' = '26NOV_KANDY_00001' AND (SELECT supplier->>'address' FROM vi_documents WHERE id = inv) = '1 Temple St, Kandy', r::text;
  RAISE NOTICE 'Numbering ok: %', r->>'doc_no';
  PERFORM t_as('super');
  RAISE NOTICE 'ALL VAT TESTS PASSED';
END $T$;
