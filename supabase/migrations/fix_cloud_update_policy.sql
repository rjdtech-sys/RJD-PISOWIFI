-- FIX FOR CLOUD UPDATE NOT SHOWING FILES
-- Run this script in your Supabase SQL Editor (https://supabase.com/dashboard/project/_/sql)

-- 1. Allow listing files in 'UPDATE FILE' bucket
-- This is required because even "Public" buckets don't allow listing files by default for security.
DROP POLICY IF EXISTS "Public List Access UPDATE FILE" ON storage.objects;
CREATE POLICY "Public List Access UPDATE FILE"
ON storage.objects FOR SELECT
TO public
USING ( bucket_id = 'UPDATE FILE' );

-- 2. Allow listing files in 'updates' bucket (fallback)
DROP POLICY IF EXISTS "Public List Access updates" ON storage.objects;
CREATE POLICY "Public List Access updates"
ON storage.objects FOR SELECT
TO public
USING ( bucket_id = 'updates' );

-- 3. Allow listing files in 'firmware' bucket (fallback)
DROP POLICY IF EXISTS "Public List Access firmware" ON storage.objects;
CREATE POLICY "Public List Access firmware"
ON storage.objects FOR SELECT
TO public
USING ( bucket_id = 'firmware' );

-- 4. Grant access to 'anon' role explicitly (sometimes needed)
GRANT SELECT ON storage.objects TO anon;
