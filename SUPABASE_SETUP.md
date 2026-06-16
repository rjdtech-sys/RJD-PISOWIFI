# Supabase Licensing System Setup Guide

This guide will help you set up the hardware-locked licensing system for your RJD PisoWiFi Management System using Supabase as the backend.

## Prerequisites

- A Supabase account (sign up at https://supabase.com)
- Access to your Supabase project's SQL Editor
- Your Supabase project URL and anon/public API key

## Step 1: Create the Licenses Table

Run this SQL in your Supabase SQL Editor to create the licenses table:

```sql
-- Create the table to manage your license keys
CREATE TABLE licenses (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  license_key TEXT UNIQUE NOT NULL,
  vendor_id UUID REFERENCES auth.users(id),
  hardware_id TEXT UNIQUE, -- Stores the Orange Pi Serial
  is_active BOOLEAN DEFAULT false,
  activated_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT now()
);

-- Enable Row Level Security so vendors can only see their own licenses
ALTER TABLE licenses ENABLE ROW LEVEL SECURITY;

-- Policy: Vendors can view their own licenses
CREATE POLICY "Vendors can view their own licenses" 
ON licenses FOR SELECT 
USING (auth.uid() = vendor_id);

-- Policy: Vendors can update their own licenses (for activation)
CREATE POLICY "Vendors can update their own licenses" 
ON licenses FOR UPDATE 
USING (auth.uid() = vendor_id);

-- Policy: Vendors can insert their own licenses
CREATE POLICY "Vendors can insert their own licenses" 
ON licenses FOR INSERT 
WITH CHECK (auth.uid() = vendor_id);

-- Add index for faster hardware_id lookups
CREATE INDEX idx_licenses_hardware_id ON licenses(hardware_id);
CREATE INDEX idx_licenses_vendor_id ON licenses(vendor_id);
```

## Step 2: Create License Keys (For Vendors)

As a vendor, you can create license keys for your customers. Here's a SQL example:

```sql
-- Generate a new license key for a customer
INSERT INTO licenses (license_key, vendor_id, is_active)
VALUES (
  'RJD-' || substring(md5(random()::text) from 1 for 8) || '-' || substring(md5(random()::text) from 1 for 8),
  auth.uid(),  -- Your vendor user ID
  false  -- Will become true when customer activates
);

-- Or batch generate multiple keys
INSERT INTO licenses (license_key, vendor_id, is_active)
SELECT 
  'RJD-' || substring(md5(random()::text) from 1 for 8) || '-' || substring(md5(random()::text) from 1 for 8),
  auth.uid(),
  false
FROM generate_series(1, 10);  -- Generate 10 keys
```

## Step 3: Configure Environment Variables

On your Orange Pi device, set the Supabase credentials as environment variables:

### Option A: Using .env file (recommended)

Create a `.env` file in your project root:

```bash
SUPABASE_URL=https://your-project-id.supabase.co
SUPABASE_ANON_KEY=your-anon-public-key-here
```

### Option B: Using systemd service file

If running as a systemd service, add to your service file:

```ini
[Service]
Environment="SUPABASE_URL=https://your-project-id.supabase.co"
Environment="SUPABASE_ANON_KEY=your-anon-public-key-here"
```

### Option C: Export in shell profile

Add to `/etc/profile` or `~/.bashrc`:

```bash
export SUPABASE_URL="https://your-project-id.supabase.co"
export SUPABASE_ANON_KEY="your-anon-public-key-here"
```

## Step 4: How the System Works

### For End Users (PisoWiFi Operators):

1. **First Boot** - 7-day trial starts automatically
2. **During Trial** - Full system functionality available
3. **After Trial** - System requires license activation
4. **To Activate**:
   - Contact vendor for a license key
   - Navigate to `http://[device-ip]/admin`
   - Go to System Settings
   - Enter the license key in the activation form
   - Click "Activate License"

### For Vendors:

1. **Create License Keys** in Supabase (see Step 2)
2. **Distribute Keys** to your customers
3. **Monitor Activations** via Supabase dashboard
4. **View Bound Hardware** - See which devices are using which keys

## Step 5: License Management Queries

### View All Licenses

```sql
SELECT 
  license_key,
  hardware_id,
  is_active,
  activated_at,
  created_at
FROM licenses
WHERE vendor_id = auth.uid()
ORDER BY created_at DESC;
```

### View Active Licenses Only

```sql
SELECT 
  license_key,
  hardware_id,
  activated_at
FROM licenses
WHERE vendor_id = auth.uid() 
  AND is_active = true
  AND hardware_id IS NOT NULL
ORDER BY activated_at DESC;
```

### View Available (Unactivated) License Keys

```sql
SELECT 
  license_key,
  created_at
FROM licenses
WHERE vendor_id = auth.uid() 
  AND hardware_id IS NULL
ORDER BY created_at DESC;
```

### Unbind a License (Allow Re-activation)

```sql
-- Use this if a customer needs to move their license to a new device
UPDATE licenses
SET 
  hardware_id = NULL,
  is_active = false,
  activated_at = NULL
WHERE license_key = 'RJD-XXXX-YYYY'
  AND vendor_id = auth.uid();
```

## Step 6: API Endpoints Available

The system exposes these endpoints on the Orange Pi:

### GET `/api/license/status`
Returns current license and trial status:
```json
{
  "hardwareId": "CPU-0000000012345678",
  "isLicensed": false,
  "trial": {
    "isActive": true,
    "hasEnded": false,
    "daysRemaining": 5,
    "expiresAt": "2026-01-31T12:00:00Z"
  },
  "canOperate": true
}
```

### POST `/api/license/activate`
Activate a license key:
```json
{
  "licenseKey": "RJD-abc123def-456ghi789"
}
```

Response:
```json
{
  "success": true,
  "message": "License activated successfully! Your device is now authorized.",
  "hardwareId": "CPU-0000000012345678"
}
```

### GET `/api/license/hardware-id`
Get the device's hardware ID:
```json
{
  "hardwareId": "CPU-0000000012345678"
}
```

## Troubleshooting

### Issue: "Unable to determine unique hardware identifier"
**Solution**: The system couldn't read `/proc/cpuinfo`. Check file permissions or run with appropriate privileges.

### Issue: "Licensing system not configured"
**Solution**: Ensure `SUPABASE_URL` and `SUPABASE_ANON_KEY` environment variables are set correctly.

### Issue: "This license key is already activated on another device"
**Solution**: Contact your vendor to unbind the license from the previous device.

### Issue: Trial expired but services still running
**Solution**: Restart the server. The gatekeeper only runs on startup.

## Security Best Practices

1. **Never expose your Supabase service_role key** - Only use the anon/public key
2. **Enable RLS** (Row Level Security) on all tables - Already done in Step 1
3. **Use HTTPS** when possible for API communications
4. **Keep vendor credentials secure** - They control license generation
5. **Regular backups** of your Supabase database

## Advanced: Custom License Duration

If you want to add expiration dates to licenses:

```sql
-- Add expiration column
ALTER TABLE licenses ADD COLUMN expires_at TIMESTAMPTZ;

-- Create license with 1-year expiration
INSERT INTO licenses (license_key, vendor_id, expires_at)
VALUES (
  'RJD-' || substring(md5(random()::text) from 1 for 8) || '-' || substring(md5(random()::text) from 1 for 8),
  auth.uid(),
  now() + interval '1 year'
);

-- Query expired licenses
SELECT * FROM licenses 
WHERE expires_at < now() 
  AND vendor_id = auth.uid();
```

## Support

For issues or questions:
- Check the project GitHub repository
- Contact RJD support team
- Review Supabase documentation at https://supabase.com/docs

---

**License System Version**: 1.0.0  
**Last Updated**: January 2026  
**Compatible with**: RJD PisoWiFi Management System v3.6.0-ONLINE-BETA+
