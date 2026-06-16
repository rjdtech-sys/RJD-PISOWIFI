-- ============================================================
-- RJD PisoWiFi - Supabase Storage Setup for System Updates
-- ============================================================
-- Run this in Supabase Dashboard → SQL Editor
-- This creates the "UPDATE FILE" bucket and sets up policies
-- so machines can download updates but only admins can upload.
-- ============================================================

-- 1. Create the storage bucket
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'UPDATE FILE',
  'UPDATE FILE',
  false,  -- Not publicly browsable, but files can be downloaded via signed URL or with anon key
  104857600,  -- 100MB limit
  NULL  -- Allow all mime types
) ON CONFLICT (id) DO NOTHING;

-- 2. Allow anyone (anon key) to READ files from the bucket
--    This lets machines download updates and check update_release.json
CREATE POLICY "Allow public read access to UPDATE FILE bucket"
ON storage.objects FOR SELECT
USING (bucket_id = 'UPDATE FILE');

-- 3. Allow service_role to INSERT/UPDATE/DELETE files
--    This is for the build-update.js script that uploads new versions
--    Note: service_role already bypasses RLS, so this policy is optional
--    but included for clarity
CREATE POLICY "Allow service_role full access to UPDATE FILE bucket"
ON storage.objects FOR ALL
USING (auth.role() = 'service_role')
WITH CHECK (auth.role() = 'service_role');

-- ============================================================
-- After running this SQL:
--   1. The bucket "UPDATE FILE" will exist
--   2. Machines can download files using the anon key
--   3. You can upload using the service_role key (via build-update.js)
--
-- To get your service_role key:
--   Supabase Dashboard → Settings → API → service_role key
--   Add it to .env: SUPABASE_SERVICE_ROLE_KEY=your_key_here
-- ============================================================
