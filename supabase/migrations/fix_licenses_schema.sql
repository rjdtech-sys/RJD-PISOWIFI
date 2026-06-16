-- Fix licenses table missing columns
ALTER TABLE public.licenses 
ADD COLUMN IF NOT EXISTS expires_at TIMESTAMPTZ,
ADD COLUMN IF NOT EXISTS created_by UUID REFERENCES auth.users(id),
ADD COLUMN IF NOT EXISTS notes TEXT;

-- Update the generate_license_keys function to match the schema
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
