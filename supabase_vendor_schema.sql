-- ============================================
-- MULTI-ROLE MANAGEMENT SYSTEM - SUPABASE SCHEMA
-- ============================================
-- Roles: SUPERADMIN (you), VENDORS (machine owners), CLIENTS (customers)
-- Run this SQL in your Supabase SQL Editor
-- Project: https://fuiabtdflbodglfexvln.supabase.co
-- ============================================

-- ============================================
-- 0. USER ROLES & PROFILES
-- ============================================
-- Track user roles (superadmin, vendor, client)
CREATE TABLE IF NOT EXISTS user_roles (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  role TEXT NOT NULL CHECK (role IN ('superadmin', 'vendor', 'client')),
  created_at TIMESTAMPTZ DEFAULT now(),
  
  UNIQUE(user_id, role)
);

-- Index for fast role lookups
CREATE INDEX IF NOT EXISTS idx_user_roles_user_id ON user_roles(user_id);
CREATE INDEX IF NOT EXISTS idx_user_roles_role ON user_roles(role);

-- Enable RLS
ALTER TABLE user_roles ENABLE ROW LEVEL SECURITY;

-- Policy: Users can view their own roles
CREATE POLICY "Users can view their own roles"
ON user_roles FOR SELECT
USING (auth.uid() = user_id);

-- Policy: Only superadmins can manage roles
CREATE POLICY "Superadmins can manage all roles"
ON user_roles FOR ALL
USING (
  EXISTS (
    SELECT 1 FROM user_roles
    WHERE user_id = auth.uid() AND role = 'superadmin'
  )
);

-- Helper function to check if user is superadmin
CREATE OR REPLACE FUNCTION is_superadmin()
RETURNS BOOLEAN AS $$
BEGIN
  RETURN EXISTS (
    SELECT 1 FROM user_roles
    WHERE user_id = auth.uid() AND role = 'superadmin'
  );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Helper function to check if user is vendor
CREATE OR REPLACE FUNCTION is_vendor()
RETURNS BOOLEAN AS $$
BEGIN
  RETURN EXISTS (
    SELECT 1 FROM user_roles
    WHERE user_id = auth.uid() AND role = 'vendor'
  );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- ============================================
-- 1. LICENSES TABLE (Superadmin manages)
-- ============================================
CREATE TABLE IF NOT EXISTS licenses (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  license_key TEXT UNIQUE NOT NULL,
  
  -- Ownership
  vendor_id UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  created_by UUID REFERENCES auth.users(id), -- Superadmin who created it
  
  -- Activation
  hardware_id TEXT UNIQUE,
  is_active BOOLEAN DEFAULT false,
  activated_at TIMESTAMPTZ,
  
  -- Expiration (optional)
  expires_at TIMESTAMPTZ,
  
  -- Metadata
  notes TEXT,
  created_at TIMESTAMPTZ DEFAULT now()
);

-- Indexes
CREATE INDEX IF NOT EXISTS idx_licenses_vendor_id ON licenses(vendor_id);
CREATE INDEX IF NOT EXISTS idx_licenses_hardware_id ON licenses(hardware_id);
CREATE INDEX IF NOT EXISTS idx_licenses_active ON licenses(is_active);

-- Enable RLS
ALTER TABLE licenses ENABLE ROW LEVEL SECURITY;

-- Policy: Superadmins can do everything
CREATE POLICY "Superadmins can manage all licenses"
ON licenses FOR ALL
USING (is_superadmin());

-- Policy: Vendors can view their own licenses
CREATE POLICY "Vendors can view their own licenses"
ON licenses FOR SELECT
USING (vendor_id = auth.uid());

-- Policy: Vendors can update their own licenses (for activation)
CREATE POLICY "Vendors can activate their own licenses"
ON licenses FOR UPDATE
USING (vendor_id = auth.uid())
WITH CHECK (vendor_id = auth.uid());

-- ============================================
-- 2. VENDORS (MACHINES) TABLE
-- ============================================
-- Stores information about each PisoWiFi machine
CREATE TABLE IF NOT EXISTS vendors (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  vendor_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  
  -- Machine Information
  hardware_id TEXT UNIQUE NOT NULL,
  machine_name TEXT NOT NULL,
  location TEXT,
  
  -- License Information
  license_key TEXT REFERENCES licenses(license_key),
  is_licensed BOOLEAN DEFAULT false,
  activated_at TIMESTAMPTZ,
  
  -- Machine Status
  status TEXT DEFAULT 'offline' CHECK (status IN ('online', 'offline', 'maintenance')),
  last_seen TIMESTAMPTZ DEFAULT now(),
  
  -- Financial Tracking
  coin_slot_pulses INTEGER DEFAULT 0,
  total_revenue DECIMAL(10, 2) DEFAULT 0.00,
  
  -- Metadata
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now(),
  
  -- Indexes for performance
  CONSTRAINT unique_vendor_hardware UNIQUE(vendor_id, hardware_id)
);

-- Index for fast vendor lookups
CREATE INDEX IF NOT EXISTS idx_vendors_vendor_id ON vendors(vendor_id);
CREATE INDEX IF NOT EXISTS idx_vendors_hardware_id ON vendors(hardware_id);
CREATE INDEX IF NOT EXISTS idx_vendors_status ON vendors(status);

-- ============================================
-- 2. SALES LOGS TABLE
-- ============================================
-- Records every transaction/coin insertion
CREATE TABLE IF NOT EXISTS sales_logs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  vendor_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  machine_id UUID NOT NULL REFERENCES vendors(id) ON DELETE CASCADE,
  
  -- Transaction Details
  amount DECIMAL(10, 2) NOT NULL,
  currency TEXT DEFAULT 'PHP',
  
  -- Session Details
  session_duration INTEGER, -- in seconds
  data_used BIGINT, -- in bytes
  
  -- Customer Information (optional)
  customer_mac TEXT,
  customer_ip TEXT,
  
  -- Metadata
  transaction_type TEXT DEFAULT 'coin_insert' CHECK (transaction_type IN ('coin_insert', 'voucher', 'refund')),
  created_at TIMESTAMPTZ DEFAULT now(),
  
  -- Notes
  notes TEXT
);

-- Indexes for fast queries
CREATE INDEX IF NOT EXISTS idx_sales_logs_vendor_id ON sales_logs(vendor_id);
CREATE INDEX IF NOT EXISTS idx_sales_logs_machine_id ON sales_logs(machine_id);
CREATE INDEX IF NOT EXISTS idx_sales_logs_created_at ON sales_logs(created_at DESC);

-- Enable RLS on sales_logs table
ALTER TABLE sales_logs ENABLE ROW LEVEL SECURITY;

-- Superadmins can view all sales
CREATE POLICY "Superadmins can view all sales"
ON sales_logs FOR SELECT
USING (is_superadmin());

-- Superadmins can manage all sales
CREATE POLICY "Superadmins can manage all sales"
ON sales_logs FOR ALL
USING (is_superadmin());

-- Vendors can view only their own sales logs
CREATE POLICY "Vendors can view their own sales"
ON sales_logs FOR SELECT
USING (auth.uid() = vendor_id);

-- Vendors can insert their own sales logs
CREATE POLICY "Vendors can insert their own sales"
ON sales_logs FOR INSERT
WITH CHECK (auth.uid() = vendor_id);

-- Vendors can update their own sales logs
CREATE POLICY "Vendors can update their own sales"
ON sales_logs FOR UPDATE
USING (auth.uid() = vendor_id)
WITH CHECK (auth.uid() = vendor_id);

-- ============================================
-- 3. CLIENTS TABLE (Customer Sessions)
-- ============================================
-- Track customer sessions for client dashboard access
CREATE TABLE IF NOT EXISTS clients (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  
  -- Session Identification
  session_token TEXT UNIQUE NOT NULL,
  mac_address TEXT NOT NULL,
  
  -- Machine Reference
  machine_id UUID REFERENCES vendors(id) ON DELETE CASCADE,
  vendor_id UUID REFERENCES auth.users(id) ON DELETE CASCADE,
  
  -- Session Details
  remaining_seconds INTEGER DEFAULT 0,
  total_paid DECIMAL(10, 2) DEFAULT 0.00,
  
  -- Network Info
  ip_address TEXT,
  
  -- Timestamps
  connected_at TIMESTAMPTZ DEFAULT now(),
  last_seen TIMESTAMPTZ DEFAULT now(),
  expires_at TIMESTAMPTZ,
  
  -- Status
  is_active BOOLEAN DEFAULT true
);

-- Indexes
CREATE INDEX IF NOT EXISTS idx_clients_session_token ON clients(session_token);
CREATE INDEX IF NOT EXISTS idx_clients_mac_address ON clients(mac_address);
CREATE INDEX IF NOT EXISTS idx_clients_machine_id ON clients(machine_id);
CREATE INDEX IF NOT EXISTS idx_clients_active ON clients(is_active);

-- Enable RLS
ALTER TABLE clients ENABLE ROW LEVEL SECURITY;

-- Policy: Clients can view their own session by token
CREATE POLICY "Clients can view their own session"
ON clients FOR SELECT
USING (session_token IN (
  SELECT session_token FROM clients WHERE session_token = current_setting('request.headers')::json->>'x-session-token'
));

-- Policy: Superadmins can view all clients
CREATE POLICY "Superadmins can view all clients"
ON clients FOR SELECT
USING (is_superadmin());

-- Policy: Vendors can view clients on their machines
CREATE POLICY "Vendors can view clients on their machines"
ON clients FOR SELECT
USING (auth.uid() = vendor_id);

-- Policy: Allow public insert (for Orange Pi to create sessions)
CREATE POLICY "Public can create client sessions"
ON clients FOR INSERT
WITH CHECK (true);

-- Policy: Allow public update (for Orange Pi to update sessions)
CREATE POLICY "Public can update client sessions"
ON clients FOR UPDATE
USING (true)
WITH CHECK (true);

-- ============================================
-- 4. ROW LEVEL SECURITY (RLS) POLICIES
-- ============================================

-- Enable RLS on vendors table
ALTER TABLE vendors ENABLE ROW LEVEL SECURITY;

-- Superadmins can view all machines
CREATE POLICY "Superadmins can view all machines"
ON vendors FOR SELECT
USING (is_superadmin());

-- Superadmins can manage all machines
CREATE POLICY "Superadmins can manage all machines"
ON vendors FOR ALL
USING (is_superadmin());

-- Vendors can view only their own machines
CREATE POLICY "Vendors can view their own machines"
ON vendors FOR SELECT
USING (auth.uid() = vendor_id);

-- Vendors can insert their own machines
CREATE POLICY "Vendors can insert their own machines"
ON vendors FOR INSERT
WITH CHECK (auth.uid() = vendor_id);

-- Vendors can update their own machines
CREATE POLICY "Vendors can update their own machines"
ON vendors FOR UPDATE
USING (auth.uid() = vendor_id)
WITH CHECK (auth.uid() = vendor_id);

-- Vendors can delete their own machines
CREATE POLICY "Vendors can delete their own machines"
ON vendors FOR DELETE
USING (auth.uid() = vendor_id);

-- ============================================
-- 4. REALTIME REPLICATION
-- ============================================
-- Enable realtime for live dashboard updates
-- Run these in Supabase Dashboard > Database > Replication

-- ALTER PUBLICATION supabase_realtime ADD TABLE vendors;
-- ALTER PUBLICATION supabase_realtime ADD TABLE sales_logs;
-- ALTER PUBLICATION supabase_realtime ADD TABLE clients;
-- ALTER PUBLICATION supabase_realtime ADD TABLE licenses;

-- Note: You can also enable this in the Supabase Dashboard:
-- Go to Database > Replication > supabase_realtime
-- Enable for: vendors, sales_logs, clients, licenses

-- ============================================
-- 5. FUNCTIONS & TRIGGERS
-- ============================================

-- Function to update vendors.updated_at timestamp
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = now();
    RETURN NEW;
END;
$$ language 'plpgsql';

-- Trigger to auto-update updated_at
CREATE TRIGGER update_vendors_updated_at 
BEFORE UPDATE ON vendors
FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- Function to automatically update vendor's total_revenue
CREATE OR REPLACE FUNCTION update_vendor_revenue()
RETURNS TRIGGER AS $$
BEGIN
    -- Update the vendor's total revenue
    UPDATE vendors
    SET total_revenue = total_revenue + NEW.amount
    WHERE id = NEW.machine_id;
    
    RETURN NEW;
END;
$$ language 'plpgsql';

-- Trigger to auto-update revenue on new sale
CREATE TRIGGER update_revenue_on_sale 
AFTER INSERT ON sales_logs
FOR EACH ROW EXECUTE FUNCTION update_vendor_revenue();

-- Function to update client last_seen timestamp
CREATE OR REPLACE FUNCTION update_client_last_seen()
RETURNS TRIGGER AS $$
BEGIN
    NEW.last_seen = now();
    RETURN NEW;
END;
$$ language 'plpgsql';

-- Trigger to auto-update client last_seen
CREATE TRIGGER update_clients_last_seen
BEFORE UPDATE ON clients
FOR EACH ROW EXECUTE FUNCTION update_client_last_seen();

-- ============================================
-- 6. SUPERADMIN HELPER FUNCTIONS
-- ============================================

-- Function to generate license keys (Superadmin only)
CREATE OR REPLACE FUNCTION generate_license_keys(
  batch_size INTEGER DEFAULT 1,
  assigned_vendor_id UUID DEFAULT NULL,
  expiration_months INTEGER DEFAULT NULL
)
RETURNS TABLE (
  license_key TEXT,
  expires_at TIMESTAMPTZ
) AS $$
DECLARE
  i INTEGER;
  new_key TEXT;
  exp_date TIMESTAMPTZ;
BEGIN
  -- Check if user is superadmin
  IF NOT is_superadmin() THEN
    RAISE EXCEPTION 'Only superadmins can generate license keys';
  END IF;

  FOR i IN 1..batch_size LOOP
    -- Generate random license key
    new_key := 'RJD-' || 
               substring(md5(random()::text || clock_timestamp()::text) from 1 for 8) || '-' ||
               substring(md5(random()::text || clock_timestamp()::text) from 1 for 8);
    
    -- Calculate expiration if specified
    IF expiration_months IS NOT NULL THEN
      exp_date := now() + (expiration_months || ' months')::interval;
    ELSE
      exp_date := NULL;
    END IF;
    
    -- Insert license
    INSERT INTO licenses (license_key, vendor_id, created_by, expires_at)
    VALUES (new_key, assigned_vendor_id, auth.uid(), exp_date);
    
    -- Return the generated key
    license_key := new_key;
    expires_at := exp_date;
    RETURN NEXT;
  END LOOP;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Function to get global statistics (Superadmin only)
CREATE OR REPLACE FUNCTION get_global_stats()
RETURNS JSON AS $$
DECLARE
  stats JSON;
BEGIN
  IF NOT is_superadmin() THEN
    RAISE EXCEPTION 'Only superadmins can view global stats';
  END IF;

  SELECT json_build_object(
    'total_vendors', (SELECT COUNT(DISTINCT vendor_id) FROM vendors),
    'total_machines', (SELECT COUNT(*) FROM vendors),
    'active_machines', (SELECT COUNT(*) FROM vendors WHERE status = 'online'),
    'total_licenses', (SELECT COUNT(*) FROM licenses),
    'active_licenses', (SELECT COUNT(*) FROM licenses WHERE is_active = true),
    'available_licenses', (SELECT COUNT(*) FROM licenses WHERE hardware_id IS NULL),
    'total_revenue', (SELECT COALESCE(SUM(total_revenue), 0) FROM vendors),
    'revenue_today', (SELECT COALESCE(SUM(amount), 0) FROM sales_logs WHERE created_at >= CURRENT_DATE),
    'revenue_this_month', (SELECT COALESCE(SUM(amount), 0) FROM sales_logs WHERE created_at >= date_trunc('month', CURRENT_DATE)),
    'total_transactions', (SELECT COUNT(*) FROM sales_logs),
    'active_clients', (SELECT COUNT(*) FROM clients WHERE is_active = true)
  ) INTO stats;

  RETURN stats;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- ============================================
-- 7. VIEWS FOR ANALYTICS
-- ============================================

-- View: Vendor Dashboard Summary
CREATE OR REPLACE VIEW vendor_dashboard_summary AS
SELECT 
    v.vendor_id,
    COUNT(DISTINCT v.id) as total_machines,
    COUNT(DISTINCT CASE WHEN v.status = 'online' THEN v.id END) as online_machines,
    SUM(v.total_revenue) as total_revenue,
    COUNT(sl.id) as total_transactions,
    SUM(CASE WHEN sl.created_at >= now() - interval '24 hours' THEN sl.amount ELSE 0 END) as revenue_24h,
    SUM(CASE WHEN sl.created_at >= now() - interval '7 days' THEN sl.amount ELSE 0 END) as revenue_7d,
    SUM(CASE WHEN sl.created_at >= now() - interval '30 days' THEN sl.amount ELSE 0 END) as revenue_30d
FROM vendors v
LEFT JOIN sales_logs sl ON sl.machine_id = v.id
GROUP BY v.vendor_id;

-- RLS for the view
ALTER VIEW vendor_dashboard_summary SET (security_invoker = on);

-- View: Superadmin Global Dashboard
CREATE OR REPLACE VIEW superadmin_global_dashboard AS
SELECT 
    v.vendor_id,
    u.email as vendor_email,
    COUNT(DISTINCT v.id) as machines,
    COUNT(DISTINCT CASE WHEN v.status = 'online' THEN v.id END) as online_machines,
    SUM(v.total_revenue) as total_revenue,
    COUNT(sl.id) as total_transactions,
    SUM(CASE WHEN sl.created_at >= now() - interval '24 hours' THEN sl.amount ELSE 0 END) as revenue_24h,
    SUM(CASE WHEN sl.created_at >= now() - interval '30 days' THEN sl.amount ELSE 0 END) as revenue_30d,
    COUNT(DISTINCT l.id) as total_licenses,
    COUNT(DISTINCT CASE WHEN l.is_active = true THEN l.id END) as active_licenses
FROM auth.users u
LEFT JOIN vendors v ON v.vendor_id = u.id
LEFT JOIN sales_logs sl ON sl.vendor_id = u.id
LEFT JOIN licenses l ON l.vendor_id = u.id
WHERE EXISTS (SELECT 1 FROM user_roles WHERE user_id = u.id AND role = 'vendor')
GROUP BY v.vendor_id, u.email;

-- RLS for the view (superadmin only)
ALTER VIEW superadmin_global_dashboard SET (security_invoker = on);

-- ============================================
-- 8. INITIAL SETUP
-- ============================================

-- Create your superadmin account
-- IMPORTANT: Run this AFTER you create your account in Supabase Auth
-- Replace 'your-email@example.com' with your actual email

/*
-- Step 1: Get your user ID
SELECT id, email FROM auth.users WHERE email = 'your-email@example.com';

-- Step 2: Make yourself superadmin (use the ID from step 1)
INSERT INTO user_roles (user_id, role)
VALUES ('<your-user-id-here>', 'superadmin');

-- Step 3: Generate your first batch of licenses
SELECT * FROM generate_license_keys(10); -- Generate 10 licenses

-- Step 4: Assign licenses to specific vendors (optional)
-- First, create a vendor account via Supabase Auth, then:
INSERT INTO user_roles (user_id, role)
VALUES ('<vendor-user-id>', 'vendor');

-- Assign licenses to vendor
UPDATE licenses 
SET vendor_id = '<vendor-user-id>'
WHERE license_key IN ('RJD-xxxxx-xxxxx', 'RJD-yyyyy-yyyyy');
*/

-- ============================================
-- 9. SAMPLE DATA (Optional - for testing)
-- ============================================

-- Insert a test vendor machine (replace with your actual auth.uid())
/*
INSERT INTO vendors (vendor_id, hardware_id, machine_name, location, is_licensed)
VALUES (
    auth.uid(), 
    'CPU-TEST123456789',
    'Test Machine 1',
    'Manila, Philippines',
    true
);

-- Insert test sales logs
INSERT INTO sales_logs (vendor_id, machine_id, amount, session_duration)
SELECT 
    auth.uid(),
    (SELECT id FROM vendors WHERE vendor_id = auth.uid() LIMIT 1),
    5.00,
    300
FROM generate_series(1, 10);
*/

-- ============================================
-- 10. USEFUL QUERIES
-- ============================================

-- SUPERADMIN QUERIES

-- Get global statistics
-- SELECT * FROM get_global_stats();

-- View all vendors and their performance
-- SELECT * FROM superadmin_global_dashboard ORDER BY total_revenue DESC;

-- Generate 10 new licenses
-- SELECT * FROM generate_license_keys(10);

-- Generate licenses for specific vendor with 12-month expiration
-- SELECT * FROM generate_license_keys(5, '<vendor-user-id>', 12);

-- View all licenses
-- SELECT 
--   l.license_key,
--   l.hardware_id,
--   l.is_active,
--   u.email as vendor_email,
--   l.activated_at,
--   l.expires_at
-- FROM licenses l
-- LEFT JOIN auth.users u ON u.id = l.vendor_id
-- ORDER BY l.created_at DESC;

-- View unassigned licenses
-- SELECT license_key, created_at 
-- FROM licenses 
-- WHERE hardware_id IS NULL 
-- ORDER BY created_at DESC;

-- Unbind a license (allow reactivation)
-- UPDATE licenses 
-- SET hardware_id = NULL, is_active = false, activated_at = NULL
-- WHERE license_key = 'RJD-xxxxx-xxxxx';

-- VENDOR QUERIES

-- Get all machines for current vendor
-- SELECT * FROM vendors WHERE vendor_id = auth.uid();

-- Get today's revenue
-- SELECT SUM(amount) as today_revenue 
-- FROM sales_logs 
-- WHERE vendor_id = auth.uid() 
--   AND created_at >= CURRENT_DATE;

-- Get machine performance
-- SELECT 
--     v.machine_name,
--     v.location,
--     COUNT(sl.id) as transactions,
--     SUM(sl.amount) as revenue
-- FROM vendors v
-- LEFT JOIN sales_logs sl ON sl.machine_id = v.id
-- WHERE v.vendor_id = auth.uid()
-- GROUP BY v.id, v.machine_name, v.location
-- ORDER BY revenue DESC;

-- CLIENT QUERIES

-- Get client session info by token
-- SELECT 
--   remaining_seconds,
--   total_paid,
--   connected_at,
--   expires_at,
--   is_active
-- FROM clients
-- WHERE session_token = '<session-token>'
--   AND is_active = true;

-- ============================================
-- SETUP COMPLETE!
-- ============================================
-- 
-- Next Steps:
-- 
-- 1. SUPERADMIN SETUP:
--    - Sign up via Supabase Auth
--    - Run superadmin setup queries (Section 8)
--    - Generate initial license batch
-- 
-- 2. ENABLE REALTIME:
--    - Database > Replication > supabase_realtime
--    - Enable for: vendors, sales_logs, clients, licenses
-- 
-- 3. CONFIGURE AUTH:
--    - Authentication > Providers
--    - Enable Email (for all roles)
--    - Optional: Enable Google OAuth
-- 
-- 4. DEPLOY DASHBOARDS:
--    - Superadmin Dashboard (your management portal)
--    - Vendor Dashboard (for machine owners)
--    - Client Dashboard (for customers)
-- 
-- 5. SECURITY:
--    - Never expose service_role key
--    - Only use ANON_KEY in client apps
--    - RLS is enabled on all tables
-- 
-- ============================================
