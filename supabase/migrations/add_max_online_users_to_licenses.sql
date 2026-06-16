-- Add license-level online user limit.
-- NULL or 0 means unlimited. Positive values enforce that many online clients.

ALTER TABLE public.licenses
ADD COLUMN IF NOT EXISTS max_online_users INTEGER;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'licenses_max_online_users_non_negative'
      AND conrelid = 'public.licenses'::regclass
  ) THEN
    ALTER TABLE public.licenses
    ADD CONSTRAINT licenses_max_online_users_non_negative
    CHECK (max_online_users IS NULL OR max_online_users >= 0)
    NOT VALID;
  END IF;
END $$;

ALTER TABLE public.licenses
VALIDATE CONSTRAINT licenses_max_online_users_non_negative;

COMMENT ON COLUMN public.licenses.max_online_users IS
'Maximum online WiFi clients allowed by this license. NULL or 0 means unlimited.';

CREATE OR REPLACE FUNCTION public.generate_license_keys(
  batch_size integer default 1,
  assigned_vendor_id uuid default null,
  expiration_months integer default null,
  max_online_users_param integer default null
)
RETURNS TABLE (license_key text, expires_at timestamptz, max_online_users integer)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  i integer;
  new_key text;
  exp_date timestamptz;
  normalized_limit integer;
BEGIN
  IF NOT public.is_superadmin() THEN
    RAISE EXCEPTION 'Only superadmins can generate license keys';
  END IF;

  normalized_limit := CASE
    WHEN max_online_users_param IS NOT NULL AND max_online_users_param > 0 THEN max_online_users_param
    ELSE NULL
  END;

  FOR i IN 1..least(greatest(batch_size, 1), 100) LOOP
    new_key := 'RJD-' ||
      upper(substring(encode(gen_random_bytes(8), 'hex') from 1 for 8)) || '-' ||
      upper(substring(encode(gen_random_bytes(8), 'hex') from 1 for 8));

    IF expiration_months IS NOT NULL THEN
      exp_date := now() + (expiration_months || ' months')::interval;
    ELSE
      exp_date := NULL;
    END IF;

    INSERT INTO public.licenses (license_key, vendor_id, created_by, expires_at, max_online_users)
    VALUES (new_key, assigned_vendor_id, auth.uid(), exp_date, normalized_limit);

    license_key := new_key;
    expires_at := exp_date;
    max_online_users := normalized_limit;
    RETURN NEXT;
  END LOOP;
END;
$$;
