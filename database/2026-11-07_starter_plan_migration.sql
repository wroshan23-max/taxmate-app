-- ═══════════════════════════════════════════════════════════
--  TaxMate V48 — new 🌱 Starter plan (Rs. 500 / month), shown first
--  Keeps any changes already made to the other plans in Settings → Plans.
--  Safe to re-run (does nothing if a 'starter' plan already exists).
-- ═══════════════════════════════════════════════════════════
UPDATE public.app_settings
SET value = jsonb_set(value, '{plans}',
  jsonb_build_array(jsonb_build_object(
    'key', 'starter', 'name', 'Starter', 'price', 500, 'active', true, 'includes_review', false,
    'tagline', 'For self-filers & basic tax support',
    'features', jsonb_build_array(
      'TaxMate client portal access',
      'Tax calendar & deadline reminders',
      'Annual income & expense checklist',
      'Tax document checklist',
      'Basic TIN / RAMIS guidance',
      'Basic tax guidance',
      'WhatsApp support – basic queries')))
  || coalesce(value->'plans', '[]'::jsonb))
WHERE key = 'plans'
  AND NOT EXISTS (SELECT 1 FROM jsonb_array_elements(coalesce(value->'plans', '[]'::jsonb)) p WHERE p->>'key' = 'starter');

SELECT p->>'key' AS key, p->>'name' AS name, (p->>'price')::numeric AS price, p->>'active' AS shown
FROM public.app_settings, jsonb_array_elements(value->'plans') p WHERE key = 'plans';
