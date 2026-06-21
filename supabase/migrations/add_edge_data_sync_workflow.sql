-- Machine-scoped edge synchronization for clients, WiFi devices, and sales.

alter table public.sales_logs
  add column if not exists source_event_id text;

create unique index if not exists sales_logs_source_event_id_key
on public.sales_logs (source_event_id)
where source_event_id is not null;

create or replace function public.resolve_edge_machine(
  p_hardware_id text,
  p_license_key text
)
returns table (
  machine_id uuid,
  vendor_id uuid
)
language sql
security definer
set search_path = public
as $$
  select v.id, v.vendor_id
  from public.vendors v
  join public.licenses l
    on l.hardware_id = v.hardware_id
   and l.license_key = p_license_key
   and l.is_active = true
   and coalesce(l.is_revoked, false) = false
   and (l.expires_at is null or l.expires_at > now())
  where v.hardware_id = p_hardware_id
    and v.vendor_id is not null
  limit 1;
$$;

revoke all on function public.resolve_edge_machine(text, text) from public;

create or replace function public.sync_edge_machine_status(
  p_hardware_id text,
  p_license_key text,
  p_status text default 'online',
  p_cpu_temp numeric default null,
  p_uptime_seconds bigint default 0,
  p_active_sessions_count integer default 0,
  p_trial_started_at timestamptz default null,
  p_trial_expires_at timestamptz default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  edge_machine record;
begin
  select * into edge_machine
  from public.resolve_edge_machine(p_hardware_id, p_license_key);

  if edge_machine.machine_id is null then
    raise exception 'Machine license authentication failed';
  end if;

  update public.vendors
  set status = coalesce(nullif(trim(p_status), ''), 'online'),
      last_seen = now(),
      cpu_temp = p_cpu_temp,
      uptime_seconds = greatest(coalesce(p_uptime_seconds, 0), 0),
      active_sessions_count = greatest(coalesce(p_active_sessions_count, 0), 0),
      trial_started_at = p_trial_started_at,
      trial_expires_at = p_trial_expires_at,
      trial_active = p_trial_expires_at is not null and p_trial_expires_at > now(),
      updated_at = now()
  where id = edge_machine.machine_id;

  return jsonb_build_object(
    'success', true,
    'machine_id', edge_machine.machine_id,
    'vendor_id', edge_machine.vendor_id
  );
end;
$$;

create or replace function public.sync_edge_client(
  p_hardware_id text,
  p_license_key text,
  p_session_token text,
  p_mac_address text,
  p_ip_address text default null,
  p_device_name text default null,
  p_remaining_seconds integer default 0,
  p_total_paid numeric default 0,
  p_is_connected boolean default false
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  edge_machine record;
  normalized_mac text;
  wifi_id uuid;
  client_id uuid;
begin
  select * into edge_machine
  from public.resolve_edge_machine(p_hardware_id, p_license_key);

  if edge_machine.machine_id is null then
    raise exception 'Machine license authentication failed';
  end if;

  normalized_mac := upper(trim(p_mac_address));
  if normalized_mac = '' or coalesce(trim(p_session_token), '') = '' then
    raise exception 'Session token and MAC address are required';
  end if;

  delete from public.wifi_devices
  where session_token = p_session_token
    and (machine_id <> edge_machine.machine_id or mac_address <> normalized_mac);

  insert into public.wifi_devices (
    vendor_id, machine_id, mac_address, session_token, device_name,
    ip_address, is_connected, total_paid, remaining_seconds,
    last_heartbeat, updated_at
  ) values (
    edge_machine.vendor_id, edge_machine.machine_id, normalized_mac,
    p_session_token, nullif(trim(p_device_name), ''), nullif(trim(p_ip_address), ''),
    p_is_connected, greatest(coalesce(p_total_paid, 0), 0),
    greatest(coalesce(p_remaining_seconds, 0), 0), now(), now()
  )
  on conflict (mac_address, machine_id) do update set
    vendor_id = excluded.vendor_id,
    session_token = excluded.session_token,
    device_name = coalesce(excluded.device_name, public.wifi_devices.device_name),
    ip_address = coalesce(excluded.ip_address, public.wifi_devices.ip_address),
    is_connected = excluded.is_connected,
    total_paid = excluded.total_paid,
    remaining_seconds = excluded.remaining_seconds,
    last_heartbeat = excluded.last_heartbeat,
    updated_at = now()
  returning id into wifi_id;

  insert into public.clients (
    session_token, mac_address, machine_id, vendor_id, remaining_seconds,
    total_paid, ip_address, last_seen, expires_at, is_active, updated_at
  ) values (
    p_session_token, normalized_mac, edge_machine.machine_id,
    edge_machine.vendor_id, greatest(coalesce(p_remaining_seconds, 0), 0),
    greatest(coalesce(p_total_paid, 0), 0), nullif(trim(p_ip_address), ''),
    now(),
    case when coalesce(p_remaining_seconds, 0) > 0
      then now() + make_interval(secs => p_remaining_seconds)
      else now()
    end,
    p_is_connected and coalesce(p_remaining_seconds, 0) > 0,
    now()
  )
  on conflict (session_token) do update set
    mac_address = excluded.mac_address,
    machine_id = excluded.machine_id,
    vendor_id = excluded.vendor_id,
    remaining_seconds = excluded.remaining_seconds,
    total_paid = excluded.total_paid,
    ip_address = excluded.ip_address,
    last_seen = excluded.last_seen,
    expires_at = excluded.expires_at,
    is_active = excluded.is_active,
    updated_at = now()
  returning id into client_id;

  return jsonb_build_object(
    'success', true,
    'machine_id', edge_machine.machine_id,
    'wifi_device_id', wifi_id,
    'client_id', client_id
  );
end;
$$;

create or replace function public.record_edge_sale(
  p_hardware_id text,
  p_license_key text,
  p_source_event_id text,
  p_amount numeric,
  p_transaction_type text default 'coin_insert',
  p_session_duration integer default null,
  p_customer_mac text default null,
  p_customer_ip text default null,
  p_notes text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  edge_machine record;
  sale_id uuid;
begin
  select * into edge_machine
  from public.resolve_edge_machine(p_hardware_id, p_license_key);

  if edge_machine.machine_id is null then
    raise exception 'Machine license authentication failed';
  end if;

  if coalesce(p_amount, 0) = 0 then
    raise exception 'Sale amount must not be zero';
  end if;

  insert into public.sales_logs (
    vendor_id, machine_id, amount, transaction_type, session_duration,
    customer_mac, customer_ip, notes, source_event_id, created_at
  ) values (
    edge_machine.vendor_id, edge_machine.machine_id, p_amount,
    coalesce(nullif(trim(p_transaction_type), ''), 'coin_insert'),
    p_session_duration, nullif(upper(trim(p_customer_mac)), ''),
    nullif(trim(p_customer_ip), ''), p_notes,
    nullif(trim(p_source_event_id), ''), now()
  )
  on conflict (source_event_id) where source_event_id is not null do nothing
  returning id into sale_id;

  if sale_id is null and nullif(trim(p_source_event_id), '') is not null then
    select id into sale_id
    from public.sales_logs
    where source_event_id = p_source_event_id;
  end if;

  return jsonb_build_object(
    'success', true,
    'machine_id', edge_machine.machine_id,
    'sale_id', sale_id
  );
end;
$$;

grant execute on function public.sync_edge_client(
  text, text, text, text, text, text, integer, numeric, boolean
) to anon, authenticated;

grant execute on function public.sync_edge_machine_status(
  text, text, text, numeric, bigint, integer, timestamptz, timestamptz
) to anon, authenticated;

grant execute on function public.record_edge_sale(
  text, text, text, numeric, text, integer, text, text, text
) to anon, authenticated;
