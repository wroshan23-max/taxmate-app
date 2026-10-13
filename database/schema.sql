-- ============================================================
-- TaxMate Solutions - Supabase Schema
-- Run this in Supabase SQL Editor (Database > SQL Editor)
-- ============================================================

-- Enable UUID generation
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- ============================================================
-- 1. PROFILES TABLE (extends Supabase auth.users)
-- ============================================================
CREATE TABLE IF NOT EXISTS public.profiles (
  id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  full_name TEXT,
  email TEXT,
  role TEXT NOT NULL DEFAULT 'client' CHECK (role IN ('admin', 'client')),
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Auto-create profile on signup
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER AS $$
BEGIN
  INSERT INTO public.profiles (id, email, full_name, role)
  VALUES (
    NEW.id,
    NEW.email,
    COALESCE(NEW.raw_user_meta_data->>'full_name', NEW.email),
    COALESCE(NEW.raw_user_meta_data->>'role', 'client')
  );
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();

-- ============================================================
-- 2. CLIENTS TABLE
-- ============================================================
CREATE TABLE IF NOT EXISTS public.clients (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  profile_id UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
  created_by UUID REFERENCES public.profiles(id),
  full_name TEXT NOT NULL,
  tin TEXT,
  nic TEXT,
  email TEXT,
  mobile TEXT,
  address TEXT,
  employer TEXT,
  resident_status TEXT DEFAULT 'resident' CHECK (resident_status IN ('resident', 'nrcitizen', 'nonresident')),
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- ============================================================
-- 3. IIT CALCULATIONS TABLE
-- ============================================================
CREATE TABLE IF NOT EXISTS public.iit_calculations (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  client_id UUID REFERENCES public.clients(id) ON DELETE CASCADE,
  created_by UUID REFERENCES public.profiles(id),
  year TEXT NOT NULL DEFAULT '2026/27',
  calc_type TEXT NOT NULL DEFAULT 'annual' CHECK (calc_type IN ('annual', 'quarterly')),
  input_data JSONB,
  result_data JSONB,
  notes TEXT,
  shared_with_client BOOLEAN DEFAULT FALSE,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- ============================================================
-- 4. TAX RETURNS TABLE
-- ============================================================
CREATE TABLE IF NOT EXISTS public.tax_returns (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  client_id UUID REFERENCES public.clients(id) ON DELETE CASCADE,
  created_by UUID REFERENCES public.profiles(id),
  year TEXT NOT NULL DEFAULT '2026/27',
  status TEXT DEFAULT 'pending' CHECK (status IN ('pending', 'in_progress', 'submitted', 'completed')),
  due_date DATE,
  gross_income NUMERIC,
  total_tax NUMERIC,
  notes TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- ============================================================
-- 5. INVOICES TABLE
-- ============================================================
CREATE TABLE IF NOT EXISTS public.invoices (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  client_id UUID REFERENCES public.clients(id) ON DELETE CASCADE,
  created_by UUID REFERENCES public.profiles(id),
  invoice_no TEXT,
  issue_date DATE DEFAULT CURRENT_DATE,
  due_date DATE,
  total_amount NUMERIC DEFAULT 0,
  status TEXT DEFAULT 'unpaid' CHECK (status IN ('unpaid', 'paid', 'overdue')),
  notes TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- ============================================================
-- 6. INVOICE ITEMS TABLE
-- ============================================================
CREATE TABLE IF NOT EXISTS public.invoice_items (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  invoice_id UUID REFERENCES public.invoices(id) ON DELETE CASCADE,
  description TEXT NOT NULL,
  quantity NUMERIC DEFAULT 1,
  unit_price NUMERIC NOT NULL,
  amount NUMERIC NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- ============================================================
-- 7. UPDATE REQUESTS TABLE (client profile change requests)
-- ============================================================
CREATE TABLE IF NOT EXISTS public.update_requests (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  client_id UUID REFERENCES public.clients(id) ON DELETE CASCADE,
  profile_id UUID REFERENCES public.profiles(id),
  requested_changes JSONB NOT NULL,
  notes TEXT,
  status TEXT DEFAULT 'pending' CHECK (status IN ('pending', 'approved', 'rejected')),
  resolved_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- ============================================================
-- 8. TAX UPDATES TABLE (notices for clients)
-- ============================================================
CREATE TABLE IF NOT EXISTS public.tax_updates (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  created_by UUID REFERENCES public.profiles(id),
  title TEXT NOT NULL,
  body TEXT NOT NULL,
  tag TEXT DEFAULT 'general' CHECK (tag IN ('general', 'deadline', 'rate_change', 'new_regulation')),
  published BOOLEAN DEFAULT TRUE,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- ============================================================
-- ROW LEVEL SECURITY
-- ============================================================

ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.clients ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.iit_calculations ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.tax_returns ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.invoices ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.invoice_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.update_requests ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.tax_updates ENABLE ROW LEVEL SECURITY;

-- Helper: check if current user is admin
CREATE OR REPLACE FUNCTION public.is_admin()
RETURNS BOOLEAN AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.profiles
    WHERE id = auth.uid() AND role = 'admin'
  );
$$ LANGUAGE sql SECURITY DEFINER STABLE;

-- Helper: get client_id for current user
CREATE OR REPLACE FUNCTION public.my_client_id()
RETURNS UUID AS $$
  SELECT id FROM public.clients WHERE profile_id = auth.uid() LIMIT 1;
$$ LANGUAGE sql SECURITY DEFINER STABLE;

-- PROFILES policies
CREATE POLICY "Users can read own profile" ON public.profiles FOR SELECT USING (id = auth.uid());
CREATE POLICY "Admins can read all profiles" ON public.profiles FOR SELECT USING (is_admin());
CREATE POLICY "Users can update own profile" ON public.profiles FOR UPDATE USING (id = auth.uid());

-- CLIENTS policies
CREATE POLICY "Admins can manage clients" ON public.clients FOR ALL USING (is_admin());
CREATE POLICY "Clients can read own record" ON public.clients FOR SELECT USING (profile_id = auth.uid());

-- IIT CALCULATIONS policies
CREATE POLICY "Admins can manage calculations" ON public.iit_calculations FOR ALL USING (is_admin());
CREATE POLICY "Clients can read shared calculations" ON public.iit_calculations FOR SELECT
  USING (client_id = my_client_id() AND shared_with_client = TRUE);

-- TAX RETURNS policies
CREATE POLICY "Admins can manage tax returns" ON public.tax_returns FOR ALL USING (is_admin());
CREATE POLICY "Clients can read own returns" ON public.tax_returns FOR SELECT USING (client_id = my_client_id());

-- INVOICES policies
CREATE POLICY "Admins can manage invoices" ON public.invoices FOR ALL USING (is_admin());
CREATE POLICY "Clients can read own invoices" ON public.invoices FOR SELECT USING (client_id = my_client_id());

-- INVOICE ITEMS policies
CREATE POLICY "Admins can manage invoice items" ON public.invoice_items FOR ALL USING (is_admin());
CREATE POLICY "Clients can read own invoice items" ON public.invoice_items FOR SELECT
  USING (invoice_id IN (SELECT id FROM public.invoices WHERE client_id = my_client_id()));

-- UPDATE REQUESTS policies
CREATE POLICY "Admins can manage update requests" ON public.update_requests FOR ALL USING (is_admin());
CREATE POLICY "Clients can read own requests" ON public.update_requests FOR SELECT USING (profile_id = auth.uid());
CREATE POLICY "Clients can insert requests" ON public.update_requests FOR INSERT WITH CHECK (profile_id = auth.uid());

-- TAX UPDATES policies
CREATE POLICY "Admins can manage tax updates" ON public.tax_updates FOR ALL USING (is_admin());
CREATE POLICY "All users can read published updates" ON public.tax_updates FOR SELECT USING (published = TRUE);

-- ============================================================
-- INDEXES for performance
-- ============================================================
CREATE INDEX IF NOT EXISTS idx_clients_profile_id ON public.clients(profile_id);
CREATE INDEX IF NOT EXISTS idx_iit_calculations_client_id ON public.iit_calculations(client_id);
CREATE INDEX IF NOT EXISTS idx_tax_returns_client_id ON public.tax_returns(client_id);
CREATE INDEX IF NOT EXISTS idx_invoices_client_id ON public.invoices(client_id);
CREATE INDEX IF NOT EXISTS idx_invoice_items_invoice_id ON public.invoice_items(invoice_id);
CREATE INDEX IF NOT EXISTS idx_update_requests_client_id ON public.update_requests(client_id);
CREATE INDEX IF NOT EXISTS idx_tax_updates_published ON public.tax_updates(published);

-- ============================================================
-- SEED: Create initial admin user
-- (Replace the email below with your actual email after creating user in Supabase Auth)
-- ============================================================
-- UPDATE public.profiles SET role = 'admin' WHERE email = 'your-admin@email.com';
