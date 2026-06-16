-- Create and harden the cloud wifi_devices table used by EdgeSync.
-- This file is intentionally idempotent so it can be rerun in Supabase.

CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE TABLE IF NOT EXISTS public.wifi_devices (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  vendor_id UUID REFERENCES auth.users(id) ON DELETE CASCADE,
  machine_id UUID,
  mac_address TEXT NOT NULL,
  session_token TEXT UNIQUE,
  device_name TEXT,
  ip_address TEXT,
  signal_strength INTEGER,
  connected_ssid TEXT,
  is_connected BOOLEAN DEFAULT false,
  total_paid NUMERIC(10,2) DEFAULT 0,
  remaining_seconds INTEGER DEFAULT 0,
  last_heartbeat TIMESTAMPTZ,
  metadata JSONB DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

ALTER TABLE public.wifi_devices ADD COLUMN IF NOT EXISTS vendor_id UUID REFERENCES auth.users(id) ON DELETE CASCADE;
ALTER TABLE public.wifi_devices ADD COLUMN IF NOT EXISTS machine_id UUID;
ALTER TABLE public.wifi_devices ADD COLUMN IF NOT EXISTS mac_address TEXT;
ALTER TABLE public.wifi_devices ADD COLUMN IF NOT EXISTS session_token TEXT;
ALTER TABLE public.wifi_devices ADD COLUMN IF NOT EXISTS device_name TEXT;
ALTER TABLE public.wifi_devices ADD COLUMN IF NOT EXISTS ip_address TEXT;
ALTER TABLE public.wifi_devices ADD COLUMN IF NOT EXISTS signal_strength INTEGER;
ALTER TABLE public.wifi_devices ADD COLUMN IF NOT EXISTS connected_ssid TEXT;
ALTER TABLE public.wifi_devices ADD COLUMN IF NOT EXISTS is_connected BOOLEAN DEFAULT false;
ALTER TABLE public.wifi_devices ADD COLUMN IF NOT EXISTS total_paid NUMERIC(10,2) DEFAULT 0;
ALTER TABLE public.wifi_devices ADD COLUMN IF NOT EXISTS remaining_seconds INTEGER DEFAULT 0;
ALTER TABLE public.wifi_devices ADD COLUMN IF NOT EXISTS last_heartbeat TIMESTAMPTZ;
ALTER TABLE public.wifi_devices ADD COLUMN IF NOT EXISTS metadata JSONB DEFAULT '{}'::jsonb;
ALTER TABLE public.wifi_devices ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ DEFAULT now();
ALTER TABLE public.wifi_devices ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ DEFAULT now();

CREATE UNIQUE INDEX IF NOT EXISTS wifi_devices_session_token_key
ON public.wifi_devices (session_token);

CREATE UNIQUE INDEX IF NOT EXISTS wifi_devices_mac_address_machine_id_key
ON public.wifi_devices (mac_address, machine_id);

CREATE INDEX IF NOT EXISTS idx_wifi_devices_vendor_id
ON public.wifi_devices (vendor_id);

CREATE INDEX IF NOT EXISTS idx_wifi_devices_machine_id
ON public.wifi_devices (machine_id);

CREATE INDEX IF NOT EXISTS idx_wifi_devices_updated_at
ON public.wifi_devices (updated_at DESC);

-- Enable RLS on wifi_devices table.
ALTER TABLE public.wifi_devices ENABLE ROW LEVEL SECURITY;

-- Drop existing policies to ensure clean state
DROP POLICY IF EXISTS "Public can insert wifi_devices" ON public.wifi_devices;
DROP POLICY IF EXISTS "Public can update wifi_devices" ON public.wifi_devices;
DROP POLICY IF EXISTS "Public can select wifi_devices" ON public.wifi_devices;
DROP POLICY IF EXISTS "Anon can insert wifi_devices" ON public.wifi_devices;
DROP POLICY IF EXISTS "Anon can update wifi_devices" ON public.wifi_devices;
DROP POLICY IF EXISTS "Anon can select wifi_devices" ON public.wifi_devices;

-- Create permissive policies for EdgeSync
CREATE POLICY "Anon can insert wifi_devices"
ON public.wifi_devices
FOR INSERT
TO anon, authenticated
WITH CHECK (true);

CREATE POLICY "Anon can update wifi_devices"
ON public.wifi_devices
FOR UPDATE
TO anon, authenticated
USING (true)
WITH CHECK (true);

CREATE POLICY "Anon can select wifi_devices"
ON public.wifi_devices
FOR SELECT
TO anon, authenticated
USING (true);
