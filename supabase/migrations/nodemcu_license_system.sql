-- ============================================
-- NODEMCU/SUBVENDO LICENSE SYSTEM
-- ============================================
-- Separate license system for NodeMCU/Subvendo boards
-- Each board needs its own license, separate from main machine license

CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- 0. BASE NODEMCU TABLES
-- These are required before nodemcu_licenses can reference a device.
CREATE TABLE IF NOT EXISTS public.nodemcu_devices (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  vendor_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  machine_id UUID NOT NULL REFERENCES public.vendors(id) ON DELETE CASCADE,
  mac_address TEXT NOT NULL,
  name TEXT,
  status TEXT DEFAULT 'disconnected' CHECK (status IN ('connected', 'disconnected', 'accepted', 'rejected')),
  total_pulses INTEGER DEFAULT 0,
  total_revenue NUMERIC(10,2) DEFAULT 0,
  authentication_key TEXT,
  last_seen TIMESTAMPTZ DEFAULT now(),
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now(),
  UNIQUE(machine_id, mac_address)
);

ALTER TABLE public.nodemcu_devices ADD COLUMN IF NOT EXISTS vendor_id UUID REFERENCES auth.users(id) ON DELETE CASCADE;
ALTER TABLE public.nodemcu_devices ADD COLUMN IF NOT EXISTS machine_id UUID REFERENCES public.vendors(id) ON DELETE CASCADE;
ALTER TABLE public.nodemcu_devices ADD COLUMN IF NOT EXISTS mac_address TEXT;
ALTER TABLE public.nodemcu_devices ADD COLUMN IF NOT EXISTS name TEXT;
ALTER TABLE public.nodemcu_devices ADD COLUMN IF NOT EXISTS status TEXT DEFAULT 'disconnected';
ALTER TABLE public.nodemcu_devices ADD COLUMN IF NOT EXISTS total_pulses INTEGER DEFAULT 0;
ALTER TABLE public.nodemcu_devices ADD COLUMN IF NOT EXISTS total_revenue NUMERIC(10,2) DEFAULT 0;
ALTER TABLE public.nodemcu_devices ADD COLUMN IF NOT EXISTS authentication_key TEXT;
ALTER TABLE public.nodemcu_devices ADD COLUMN IF NOT EXISTS last_seen TIMESTAMPTZ DEFAULT now();
ALTER TABLE public.nodemcu_devices ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ DEFAULT now();
ALTER TABLE public.nodemcu_devices ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ DEFAULT now();

CREATE UNIQUE INDEX IF NOT EXISTS nodemcu_devices_machine_id_mac_address_key
ON public.nodemcu_devices (machine_id, mac_address);

CREATE INDEX IF NOT EXISTS idx_nodemcu_devices_machine_id
ON public.nodemcu_devices (machine_id);

CREATE INDEX IF NOT EXISTS idx_nodemcu_devices_vendor_id
ON public.nodemcu_devices (vendor_id);

CREATE INDEX IF NOT EXISTS idx_nodemcu_devices_mac_address
ON public.nodemcu_devices (mac_address);

CREATE TABLE IF NOT EXISTS public.nodemcu_sales (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  vendor_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  machine_id UUID NOT NULL REFERENCES public.vendors(id) ON DELETE CASCADE,
  device_id UUID NOT NULL REFERENCES public.nodemcu_devices(id) ON DELETE CASCADE,
  slot_id INTEGER NOT NULL,
  amount NUMERIC(10,2) NOT NULL,
  created_at TIMESTAMPTZ DEFAULT now()
);

ALTER TABLE public.nodemcu_sales ADD COLUMN IF NOT EXISTS vendor_id UUID REFERENCES auth.users(id) ON DELETE CASCADE;
ALTER TABLE public.nodemcu_sales ADD COLUMN IF NOT EXISTS machine_id UUID REFERENCES public.vendors(id) ON DELETE CASCADE;
ALTER TABLE public.nodemcu_sales ADD COLUMN IF NOT EXISTS device_id UUID REFERENCES public.nodemcu_devices(id) ON DELETE CASCADE;
ALTER TABLE public.nodemcu_sales ADD COLUMN IF NOT EXISTS slot_id INTEGER;
ALTER TABLE public.nodemcu_sales ADD COLUMN IF NOT EXISTS amount NUMERIC(10,2);
ALTER TABLE public.nodemcu_sales ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ DEFAULT now();

CREATE INDEX IF NOT EXISTS idx_nodemcu_sales_device_id
ON public.nodemcu_sales (device_id);

CREATE INDEX IF NOT EXISTS idx_nodemcu_sales_machine_id
ON public.nodemcu_sales (machine_id);

CREATE INDEX IF NOT EXISTS idx_nodemcu_sales_created_at
ON public.nodemcu_sales (created_at DESC);

ALTER TABLE public.nodemcu_devices ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.nodemcu_sales ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Vendors can manage their own NodeMCU devices" ON public.nodemcu_devices;
CREATE POLICY "Vendors can manage their own NodeMCU devices"
ON public.nodemcu_devices FOR ALL
TO authenticated
USING (auth.uid() = vendor_id)
WITH CHECK (auth.uid() = vendor_id);

DROP POLICY IF EXISTS "Anon can manage nodemcu_devices" ON public.nodemcu_devices;
CREATE POLICY "Anon can manage nodemcu_devices"
ON public.nodemcu_devices FOR ALL
TO anon, authenticated
USING (true)
WITH CHECK (true);

DROP POLICY IF EXISTS "Vendors can manage their own NodeMCU sales" ON public.nodemcu_sales;
CREATE POLICY "Vendors can manage their own NodeMCU sales"
ON public.nodemcu_sales FOR ALL
TO authenticated
USING (auth.uid() = vendor_id)
WITH CHECK (auth.uid() = vendor_id);

DROP POLICY IF EXISTS "Anon can manage nodemcu_sales" ON public.nodemcu_sales;
CREATE POLICY "Anon can manage nodemcu_sales"
ON public.nodemcu_sales FOR ALL
TO anon, authenticated
USING (true)
WITH CHECK (true);

-- 1. NODEMCU LICENSES TABLE
-- Stores license keys specifically for NodeMCU/Subvendo devices
CREATE TABLE IF NOT EXISTS nodemcu_licenses (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  license_key TEXT UNIQUE NOT NULL,
  
  -- Ownership (same as main licenses)
  vendor_id UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  created_by UUID REFERENCES auth.users(id), -- Superadmin who created it
  
  -- Activation (bound to specific NodeMCU device)
  device_id UUID REFERENCES nodemcu_devices(id) ON DELETE SET NULL,
  mac_address TEXT, -- MAC address of the NodeMCU device
  is_active BOOLEAN DEFAULT false,
  activated_at TIMESTAMPTZ,
  
  -- License type and expiration
  license_type TEXT DEFAULT 'standard' CHECK (license_type IN ('trial', 'standard', 'premium')),
  expires_at TIMESTAMPTZ,
  
  -- Trial specific fields
  trial_started_at TIMESTAMPTZ,
  trial_duration_days INTEGER DEFAULT 7,
  
  -- Metadata
  notes TEXT,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

-- Indexes for performance
CREATE INDEX IF NOT EXISTS idx_nodemcu_licenses_vendor_id ON nodemcu_licenses(vendor_id);
CREATE INDEX IF NOT EXISTS idx_nodemcu_licenses_device_id ON nodemcu_licenses(device_id);
CREATE INDEX IF NOT EXISTS idx_nodemcu_licenses_mac_address ON nodemcu_licenses(mac_address);
CREATE INDEX IF NOT EXISTS idx_nodemcu_licenses_active ON nodemcu_licenses(is_active);
CREATE INDEX IF NOT EXISTS idx_nodemcu_licenses_type ON nodemcu_licenses(license_type);

-- Enable RLS
ALTER TABLE nodemcu_licenses ENABLE ROW LEVEL SECURITY;

-- Policy: Superadmins can do everything
DROP POLICY IF EXISTS "Superadmins can manage all nodemcu licenses" ON nodemcu_licenses;
CREATE POLICY "Superadmins can manage all nodemcu licenses"
ON nodemcu_licenses FOR ALL
USING (is_superadmin());

-- Policy: Vendors can view their own NodeMCU licenses
DROP POLICY IF EXISTS "Vendors can view their own nodemcu licenses" ON nodemcu_licenses;
CREATE POLICY "Vendors can view their own nodemcu licenses"
ON nodemcu_licenses FOR SELECT
USING (vendor_id = auth.uid());

-- Policy: Vendors can update their own NodeMCU licenses (for activation)
DROP POLICY IF EXISTS "Vendors can activate their own nodemcu licenses" ON nodemcu_licenses;
CREATE POLICY "Vendors can activate their own nodemcu licenses"
ON nodemcu_licenses FOR UPDATE
USING (vendor_id = auth.uid())
WITH CHECK (vendor_id = auth.uid());

-- 2. FUNCTION TO GENERATE NODEMCU LICENSE KEYS
CREATE OR REPLACE FUNCTION generate_nodemcu_license_keys(
  batch_size INTEGER DEFAULT 1,
  assigned_vendor_id UUID DEFAULT NULL,
  license_type_param TEXT DEFAULT 'standard',
  expiration_months INTEGER DEFAULT NULL
)
RETURNS TABLE (
  license_key TEXT,
  expires_at TIMESTAMPTZ,
  license_type TEXT
) AS $$
DECLARE
  i INTEGER;
  new_key TEXT;
  exp_date TIMESTAMPTZ;
BEGIN
  -- Check if user is superadmin
  IF NOT is_superadmin() THEN
    RAISE EXCEPTION 'Only superadmins can generate NodeMCU license keys';
  END IF;

  FOR i IN 1..batch_size LOOP
    -- Generate random license key with NODEMCU prefix
    new_key := 'NODEMCU-' || 
               substring(md5(random()::text || clock_timestamp()::text) from 1 for 8) || '-' ||
               substring(md5(random()::text || clock_timestamp()::text) from 1 for 8);
    
    -- Calculate expiration if specified
    IF expiration_months IS NOT NULL THEN
      exp_date := now() + (expiration_months || ' months')::interval;
    ELSE
      exp_date := NULL;
    END IF;
    
    -- Insert license
    INSERT INTO nodemcu_licenses (license_key, vendor_id, created_by, license_type, expires_at)
    VALUES (new_key, assigned_vendor_id, auth.uid(), license_type_param, exp_date);
    
    -- Return the generated key
    license_key := new_key;
    expires_at := exp_date;
    license_type := license_type_param;
    RETURN NEXT;
  END LOOP;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- 3. FUNCTION TO START TRIAL FOR NODEMCU DEVICE
CREATE OR REPLACE FUNCTION start_nodemcu_trial(
  device_mac_address TEXT,
  vendor_id_param UUID DEFAULT NULL
)
RETURNS JSON AS $$
DECLARE
  trial_license RECORD;
  device_record RECORD;
  vendor_uuid UUID;
BEGIN
  -- Use provided vendor_id or current user
  IF vendor_id_param IS NULL THEN
    vendor_uuid := auth.uid();
  ELSE
    vendor_uuid := vendor_id_param;
  END IF;

  -- Check if device exists and belongs to vendor
  SELECT * INTO device_record 
  FROM nodemcu_devices 
  WHERE mac_address = device_mac_address 
    AND vendor_id = vendor_uuid;

  IF NOT FOUND THEN
    RETURN json_build_object(
      'success', false,
      'error', 'Device not found or does not belong to you'
    );
  END IF;

  -- Check if device already has an active license
  SELECT * INTO trial_license
  FROM nodemcu_licenses
  WHERE device_id = device_record.id 
    AND is_active = true;

  IF FOUND THEN
    RETURN json_build_object(
      'success', false,
      'error', 'Device already has an active license',
      'license_key', trial_license.license_key,
      'license_type', trial_license.license_type
    );
  END IF;

  -- Check if device already had a trial
  SELECT * INTO trial_license
  FROM nodemcu_licenses
  WHERE device_id = device_record.id 
    AND license_type = 'trial';

  IF FOUND THEN
    RETURN json_build_object(
      'success', false,
      'error', 'Device already had a trial period',
      'trial_ended_at', trial_license.trial_started_at + (trial_license.trial_duration_days || ' days')::interval
    );
  END IF;

  -- Create trial license
  INSERT INTO nodemcu_licenses (
    license_key,
    vendor_id,
    created_by,
    device_id,
    mac_address,
    is_active,
    activated_at,
    license_type,
    trial_started_at,
    trial_duration_days,
    expires_at
  ) VALUES (
    'TRIAL-' || device_mac_address || '-' || substring(md5(random()::text) from 1 for 6),
    vendor_uuid,
    auth.uid(),
    device_record.id,
    device_mac_address,
    true,
    now(),
    'trial',
    now(),
    7,
    now() + interval '7 days'
  );

  RETURN json_build_object(
    'success', true,
    'message', 'Trial started successfully',
    'license_key', 'TRIAL-' || device_mac_address,
    'expires_at', now() + interval '7 days',
    'days_remaining', 7
  );

END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- 4. FUNCTION TO ACTIVATE NODEMCU LICENSE
CREATE OR REPLACE FUNCTION activate_nodemcu_license(
  license_key_param TEXT,
  device_mac_address TEXT
)
RETURNS JSON AS $$
DECLARE
  license_record RECORD;
  device_record RECORD;
  existing_license RECORD;
BEGIN
  -- Get the license
  SELECT * INTO license_record
  FROM nodemcu_licenses
  WHERE license_key = license_key_param;

  IF NOT FOUND THEN
    RETURN json_build_object(
      'success', false,
      'error', 'License key not found'
    );
  END IF;

  -- Check if license belongs to current vendor
  IF license_record.vendor_id != auth.uid() THEN
    RETURN json_build_object(
      'success', false,
      'error', 'License does not belong to you'
    );
  END IF;

  -- Check if license is already active
  IF license_record.is_active THEN
    RETURN json_build_object(
      'success', false,
      'error', 'License already activated',
      'activated_at', license_record.activated_at,
      'device_mac', license_record.mac_address
    );
  END IF;

  -- Get the device
  SELECT * INTO device_record
  FROM nodemcu_devices
  WHERE mac_address = device_mac_address
    AND vendor_id = auth.uid();

  IF NOT FOUND THEN
    RETURN json_build_object(
      'success', false,
      'error', 'Device not found or does not belong to you'
    );
  END IF;

  -- Check if device already has an active license
  SELECT * INTO existing_license
  FROM nodemcu_licenses
  WHERE device_id = device_record.id 
    AND is_active = true
    AND id != license_record.id;

  IF FOUND THEN
    RETURN json_build_object(
      'success', false,
      'error', 'Device already has an active license',
      'existing_license', existing_license.license_key
    );
  END IF;

  -- Activate the license
  UPDATE nodemcu_licenses
  SET 
    device_id = device_record.id,
    mac_address = device_mac_address,
    is_active = true,
    activated_at = now(),
    updated_at = now()
  WHERE id = license_record.id;

  RETURN json_build_object(
    'success', true,
    'message', 'License activated successfully',
    'license_key', license_key_param,
    'device_mac', device_mac_address,
    'activated_at', now()
  );

END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- 5. FUNCTION TO CHECK NODEMCU LICENSE STATUS
CREATE OR REPLACE FUNCTION check_nodemcu_license_status(
  device_mac_address TEXT
)
RETURNS JSON AS $$
DECLARE
  license_record RECORD;
  device_record RECORD;
  days_remaining INTEGER;
  is_expired BOOLEAN;
BEGIN
  -- Get the device
  SELECT * INTO device_record
  FROM nodemcu_devices
  WHERE mac_address = device_mac_address;

  IF NOT FOUND THEN
    RETURN json_build_object(
      'success', false,
      'error', 'Device not found'
    );
  END IF;

  -- Get active license for device
  SELECT * INTO license_record
  FROM nodemcu_licenses
  WHERE device_id = device_record.id 
    AND is_active = true
  ORDER BY activated_at DESC
  LIMIT 1;

  IF NOT FOUND THEN
    RETURN json_build_object(
      'success', true,
      'has_license', false,
      'has_trial', false,
      'can_start_trial', true,
      'message', 'No license found, trial available'
    );
  END IF;

  -- Calculate expiration status
  IF license_record.expires_at IS NOT NULL THEN
    days_remaining := GREATEST(0, EXTRACT(DAY FROM (license_record.expires_at - now()))::INTEGER);
    is_expired := license_record.expires_at < now();
  ELSE
    days_remaining := NULL;
    is_expired := false;
  END IF;

  RETURN json_build_object(
    'success', true,
    'has_license', true,
    'license_key', license_record.license_key,
    'license_type', license_record.license_type,
    'is_active', license_record.is_active,
    'is_expired', is_expired,
    'activated_at', license_record.activated_at,
    'expires_at', license_record.expires_at,
    'days_remaining', days_remaining,
    'trial_started_at', license_record.trial_started_at,
    'trial_duration_days', license_record.trial_duration_days,
    'can_operate', license_record.is_active AND NOT is_expired
  );

END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- 6. FUNCTION TO GET VENDOR'S NODEMCU LICENSES
CREATE OR REPLACE FUNCTION get_vendor_nodemcu_licenses(
  vendor_id_param UUID DEFAULT NULL
)
RETURNS TABLE (
  id UUID,
  license_key TEXT,
  device_name TEXT,
  mac_address TEXT,
  is_active BOOLEAN,
  license_type TEXT,
  activated_at TIMESTAMPTZ,
  expires_at TIMESTAMPTZ,
  days_remaining INTEGER,
  device_status TEXT
) AS $$
DECLARE
  vendor_uuid UUID;
BEGIN
  -- Use provided vendor_id or current user
  IF vendor_id_param IS NULL THEN
    vendor_uuid := auth.uid();
  ELSE
    vendor_uuid := vendor_id_param;
  END IF;

  RETURN QUERY
  SELECT 
    nl.id,
    nl.license_key,
    COALESCE(nd.name, 'Unnamed Device') as device_name,
    nl.mac_address,
    nl.is_active,
    nl.license_type,
    nl.activated_at,
    nl.expires_at,
    CASE 
      WHEN nl.expires_at IS NOT NULL 
      THEN GREATEST(0, EXTRACT(DAY FROM (nl.expires_at - now()))::INTEGER)
      ELSE NULL
    END as days_remaining,
    nd.status as device_status
  FROM nodemcu_licenses nl
  LEFT JOIN nodemcu_devices nd ON nd.id = nl.device_id
  WHERE nl.vendor_id = vendor_uuid
  ORDER BY nl.created_at DESC;

END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- 7. FUNCTION TO REVOKE NODEMCU LICENSE
CREATE OR REPLACE FUNCTION revoke_nodemcu_license(
  license_key_param TEXT,
  vendor_id_param UUID DEFAULT NULL
)
RETURNS JSON AS $$
DECLARE
  license_record RECORD;
  vendor_uuid UUID;
BEGIN
  -- Determine vendor ID (parameter or auth context)
  IF vendor_id_param IS NULL THEN
    vendor_uuid := auth.uid();
  ELSE
    vendor_uuid := vendor_id_param;
  END IF;

  -- Get the license
  SELECT * INTO license_record
  FROM nodemcu_licenses
  WHERE license_key = license_key_param;

  IF NOT FOUND THEN
    RETURN json_build_object(
      'success', false,
      'error', 'License key not found'
    );
  END IF;

  -- Check if license belongs to current vendor
  IF license_record.vendor_id != vendor_uuid THEN
    RETURN json_build_object(
      'success', false,
      'error', 'License does not belong to you'
    );
  END IF;

  -- Revoke the license (unbind from device)
  UPDATE nodemcu_licenses
  SET 
    device_id = NULL,
    mac_address = NULL,
    is_active = false,
    activated_at = NULL,
    updated_at = now()
  WHERE id = license_record.id;

  RETURN json_build_object(
    'success', true,
    'message', 'License revoked successfully',
    'license_key', license_key_param
  );

END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- 8. TRIGGER TO AUTO-UPDATE updated_at TIMESTAMP
CREATE OR REPLACE FUNCTION update_nodemcu_license_updated_at()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = now();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS tr_update_nodemcu_license_updated_at ON nodemcu_licenses;
CREATE TRIGGER tr_update_nodemcu_license_updated_at
BEFORE UPDATE ON nodemcu_licenses
FOR EACH ROW EXECUTE FUNCTION update_nodemcu_license_updated_at();

-- 9. SAMPLE DATA FOR TESTING
-- Generate some sample NodeMCU licenses for testing
/*
-- Generate 5 standard NodeMCU licenses
SELECT * FROM generate_nodemcu_license_keys(5, null, 'standard', 12);

-- Generate 3 premium NodeMCU licenses
SELECT * FROM generate_nodemcu_license_keys(3, null, 'premium', 24);

-- View all NodeMCU licenses
SELECT 
  nl.license_key,
  nl.license_type,
  nl.is_active,
  COALESCE(nd.name, 'Unassigned') as device_name,
  nl.mac_address,
  nl.activated_at,
  nl.expires_at
FROM nodemcu_licenses nl
LEFT JOIN nodemcu_devices nd ON nd.id = nl.device_id
ORDER BY nl.created_at DESC;
*/

-- 10. USEFUL QUERIES FOR MANAGEMENT

-- Get unassigned NodeMCU licenses for current vendor
/*
SELECT license_key, license_type, created_at
FROM nodemcu_licenses
WHERE vendor_id = auth.uid()
  AND device_id IS NULL
  AND is_active = false
ORDER BY created_at DESC;
*/

-- Get expired NodeMCU licenses
/*
SELECT 
  nl.license_key,
  COALESCE(nd.name, 'Unassigned') as device_name,
  nl.expires_at,
  (nl.expires_at - now())::int as days_overdue
FROM nodemcu_licenses nl
LEFT JOIN nodemcu_devices nd ON nd.id = nl.device_id
WHERE nl.expires_at < now()
  AND nl.is_active = true
ORDER BY nl.expires_at DESC;
*/

-- Get NodeMCU license statistics for vendor
/*
SELECT 
  COUNT(*) as total_licenses,
  COUNT(CASE WHEN is_active = true THEN 1 END) as active_licenses,
  COUNT(CASE WHEN license_type = 'trial' THEN 1 END) as trial_licenses,
  COUNT(CASE WHEN license_type = 'standard' THEN 1 END) as standard_licenses,
  COUNT(CASE WHEN license_type = 'premium' THEN 1 END) as premium_licenses,
  COUNT(CASE WHEN device_id IS NULL THEN 1 END) as unassigned_licenses
FROM nodemcu_licenses
WHERE vendor_id = auth.uid();
*/
