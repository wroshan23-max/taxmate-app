-- ═══════════════════════════════════════════════════════════
--  TaxMate V63 — Payment notice (PDF) for APIT / quarterly instalments
--  • A secure link (/notice/<token>) shows the client's payment notice
--    (amount, due date, IRD codes, voucher No., how to pay) without login,
--    so it can be sent on WhatsApp. Admin can switch the link off.
--  • Only the payment and the client's name / TIN / NIC / client No. are shown.
--  Needs V57 + V62 (tax_payments). Safe to re-run.
-- ═══════════════════════════════════════════════════════════

ALTER TABLE public.tax_payments ADD COLUMN IF NOT EXISTS share_token UUID;
CREATE UNIQUE INDEX IF NOT EXISTS tax_payments_share_token_uq ON public.tax_payments (share_token) WHERE share_token IS NOT NULL;

-- Public (anon): one notice by its secret link
CREATE OR REPLACE FUNCTION public.get_shared_tax_notice(p_token UUID)
RETURNS JSONB LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT jsonb_build_object(
    'payment', jsonb_build_object('id', t.id, 'year', t.year, 'kind', t.kind, 'period', t.period, 'amount', t.amount,
                                  'due_date', t.due_date, 'status', t.status, 'paid_on', t.paid_on, 'paid_amount', t.paid_amount,
                                  'voucher_no', t.voucher_no, 'basis', t.basis, 'updated_at', t.updated_at),
    'client', jsonb_build_object('full_name', c.full_name, 'tin', c.tin, 'nic', c.nic, 'client_no', c.client_no))
  FROM public.tax_payments t JOIN public.clients c ON c.id = t.client_id
  WHERE p_token IS NOT NULL AND t.share_token = p_token
$$;
REVOKE ALL ON FUNCTION public.get_shared_tax_notice(UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_shared_tax_notice(UUID) TO anon, authenticated;

SELECT (SELECT count(*) FROM information_schema.columns WHERE table_name = 'tax_payments' AND column_name = 'share_token') AS token_column,
       has_function_privilege('anon', 'public.get_shared_tax_notice(uuid)', 'execute') AS anon_can_open;
