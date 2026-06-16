-- Create and harden the cloud clients table used by customer session sync.
-- This file is intentionally idempotent so it can be rerun in Supabase.

CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE TABLE IF NOT EXISTS public.clients (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  session_token TEXT UNIQUE NOT NULL,
  mac_address TEXT NOT NULL,
  machine_id UUID,
  vendor_id UUID REFERENCES auth.users(id) ON DELETE CASCADE,
  remaining_seconds INTEGER DEFAULT 0,
  total_paid NUMERIC(10,2) DEFAULT 0,
  ip_address TEXT,
  connected_at TIMESTAMPTZ DEFAULT now(),
  last_seen TIMESTAMPTZ DEFAULT now(),
  expires_at TIMESTAMPTZ,
  is_active BOOLEAN DEFAULT true,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

ALTER TABLE public.clients ADD COLUMN IF NOT EXISTS session_token TEXT;
ALTER TABLE public.clients ADD COLUMN IF NOT EXISTS mac_address TEXT;
ALTER TABLE public.clients ADD COLUMN IF NOT EXISTS machine_id UUID;
ALTER TABLE public.clients ADD COLUMN IF NOT EXISTS vendor_id UUID REFERENCES auth.users(id) ON DELETE CASCADE;
ALTER TABLE public.clients ADD COLUMN IF NOT EXISTS remaining_seconds INTEGER DEFAULT 0;
ALTER TABLE public.clients ADD COLUMN IF NOT EXISTS total_paid NUMERIC(10,2) DEFAULT 0;
ALTER TABLE public.clients ADD COLUMN IF NOT EXISTS ip_address TEXT;
ALTER TABLE public.clients ADD COLUMN IF NOT EXISTS connected_at TIMESTAMPTZ DEFAULT now();
ALTER TABLE public.clients ADD COLUMN IF NOT EXISTS last_seen TIMESTAMPTZ DEFAULT now();
ALTER TABLE public.clients ADD COLUMN IF NOT EXISTS expires_at TIMESTAMPTZ;
ALTER TABLE public.clients ADD COLUMN IF NOT EXISTS is_active BOOLEAN DEFAULT true;
ALTER TABLE public.clients ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ DEFAULT now();
ALTER TABLE public.clients ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ DEFAULT now();

CREATE UNIQUE INDEX IF NOT EXISTS clients_session_token_key
ON public.clients (session_token);

CREATE INDEX IF NOT EXISTS idx_clients_mac_address
ON public.clients (mac_address);

CREATE INDEX IF NOT EXISTS idx_clients_machine_id
ON public.clients (machine_id);

CREATE INDEX IF NOT EXISTS idx_clients_vendor_id
ON public.clients (vendor_id);

CREATE INDEX IF NOT EXISTS idx_clients_updated_at
ON public.clients (updated_at DESC);

-- Enable RLS on clients table.
ALTER TABLE public.clients ENABLE ROW LEVEL SECURITY;

-- Drop existing policies to ensure clean state
DROP POLICY IF EXISTS "Public can insert clients" ON public.clients;
DROP POLICY IF EXISTS "Public can update clients" ON public.clients;
DROP POLICY IF EXISTS "Public can select clients" ON public.clients;
DROP POLICY IF EXISTS "Public can create client sessions" ON public.clients;
DROP POLICY IF EXISTS "Public can update client sessions" ON public.clients;
DROP POLICY IF EXISTS "Anon can insert clients" ON public.clients;
DROP POLICY IF EXISTS "Anon can update clients" ON public.clients;
DROP POLICY IF EXISTS "Anon can select clients" ON public.clients;

-- Create permissive policies for EdgeSync
CREATE POLICY "Anon can insert clients"
ON public.clients
FOR INSERT
TO anon, authenticated
WITH CHECK (true);

CREATE POLICY "Anon can update clients"
ON public.clients
FOR UPDATE
TO anon, authenticated
USING (true)
WITH CHECK (true);

CREATE POLICY "Anon can select clients"
ON public.clients
FOR SELECT
TO anon, authenticated
USING (true);
