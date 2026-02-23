-- Enable RLS on wifi_devices table (if not already)
ALTER TABLE wifi_devices ENABLE ROW LEVEL SECURITY;

-- Drop existing policies to ensure clean state
DROP POLICY IF EXISTS "Public can insert wifi_devices" ON wifi_devices;
DROP POLICY IF EXISTS "Public can update wifi_devices" ON wifi_devices;
DROP POLICY IF EXISTS "Public can select wifi_devices" ON wifi_devices;
DROP POLICY IF EXISTS "Anon can insert wifi_devices" ON wifi_devices;
DROP POLICY IF EXISTS "Anon can update wifi_devices" ON wifi_devices;
DROP POLICY IF EXISTS "Anon can select wifi_devices" ON wifi_devices;

-- Create permissive policies for EdgeSync
CREATE POLICY "Anon can insert wifi_devices"
ON wifi_devices
FOR INSERT
TO anon, authenticated
WITH CHECK (true);

CREATE POLICY "Anon can update wifi_devices"
ON wifi_devices
FOR UPDATE
TO anon, authenticated
USING (true)
WITH CHECK (true);

CREATE POLICY "Anon can select wifi_devices"
ON wifi_devices
FOR SELECT
TO anon, authenticated
USING (true);
