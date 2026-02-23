-- Enable RLS on clients table (if not already)
ALTER TABLE clients ENABLE ROW LEVEL SECURITY;

-- Drop existing policies to ensure clean state
DROP POLICY IF EXISTS "Public can insert clients" ON clients;
DROP POLICY IF EXISTS "Public can update clients" ON clients;
DROP POLICY IF EXISTS "Public can select clients" ON clients;
DROP POLICY IF EXISTS "Public can create client sessions" ON clients;
DROP POLICY IF EXISTS "Public can update client sessions" ON clients;
DROP POLICY IF EXISTS "Anon can insert clients" ON clients;
DROP POLICY IF EXISTS "Anon can update clients" ON clients;
DROP POLICY IF EXISTS "Anon can select clients" ON clients;

-- Create permissive policies for EdgeSync
CREATE POLICY "Anon can insert clients"
ON clients
FOR INSERT
TO anon, authenticated
WITH CHECK (true);

CREATE POLICY "Anon can update clients"
ON clients
FOR UPDATE
TO anon, authenticated
USING (true)
WITH CHECK (true);

CREATE POLICY "Anon can select clients"
ON clients
FOR SELECT
TO anon, authenticated
USING (true);
