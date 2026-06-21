-- Account-bound first-run activation for RJD PisoWiFi machines.

alter table public.licenses
  add column if not exists license_type text;

alter table public.vendors
  alter column vendor_id drop not null;

alter table public.vendors
  add column if not exists trial_started_at timestamptz,
  add column if not exists trial_expires_at timestamptz,
  add column if not exists trial_active boolean default false;

update public.licenses
set license_type = case
  when notes ilike '%premium%' then 'premium'
  when notes ilike '%lifetime%' or expires_at is null then 'lifetime'
  else 'basic'
end
where license_type is null;

alter table public.licenses
  alter column license_type set default 'basic';

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'licenses_license_type_check'
      and conrelid = 'public.licenses'::regclass
  ) then
    alter table public.licenses
      add constraint licenses_license_type_check
      check (license_type in ('trial', 'basic', 'premium', 'lifetime')) not valid;
  end if;
end $$;

alter table public.licenses validate constraint licenses_license_type_check;

create or replace function public.setup_pisowifi_machine(
  p_hardware_id text,
  p_machine_name text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  account_id uuid := auth.uid();
  owner_id uuid;
  selected_license public.licenses%rowtype;
  machine_record public.vendors%rowtype;
  trial_key text;
  label text;
begin
  if account_id is null then
    raise exception 'Website account authentication is required';
  end if;

  if nullif(trim(p_hardware_id), '') is null then
    raise exception 'Hardware ID is required';
  end if;

  owner_id := account_id;

  insert into public.user_roles (user_id, role)
  values (owner_id, 'vendor')
  on conflict (user_id, role) do nothing;

  select * into machine_record
  from public.vendors
  where hardware_id = trim(p_hardware_id)
  for update;

  if machine_record.id is not null
     and machine_record.vendor_id is not null
     and machine_record.vendor_id <> owner_id then
    raise exception 'This hardware is already connected to another RJD account';
  end if;

  select * into selected_license
  from public.licenses
  where hardware_id = trim(p_hardware_id)
  order by created_at desc
  limit 1
  for update;

  if selected_license.id is not null and selected_license.vendor_id <> owner_id then
    raise exception 'This hardware license belongs to another RJD account';
  end if;

  if selected_license.id is null then
    select * into selected_license
    from public.licenses
    where vendor_id = owner_id
      and hardware_id is null
      and coalesce(is_active, false) = false
      and coalesce(license_type, 'basic') <> 'trial'
      and (expires_at is null or expires_at > now())
    order by
      case coalesce(license_type, 'basic')
        when 'lifetime' then 1
        when 'premium' then 2
        else 3
      end,
      created_at
    limit 1
    for update skip locked;

    if selected_license.id is not null then
      update public.licenses
      set hardware_id = trim(p_hardware_id),
          is_active = true,
          activated_at = coalesce(activated_at, now())
      where id = selected_license.id
      returning * into selected_license;
    else
      if exists (
        select 1 from public.licenses
        where hardware_id = trim(p_hardware_id)
          and license_type = 'trial'
      ) then
        raise exception 'The 7-day trial for this hardware has already been used';
      end if;

      trial_key := 'RJD-TRIAL-' || upper(substr(md5(
        random()::text || clock_timestamp()::text || trim(p_hardware_id)
      ), 1, 16));
      insert into public.licenses (
        license_key, vendor_id, created_by, hardware_id, is_active,
        activated_at, expires_at, license_type, notes
      ) values (
        trial_key, owner_id, owner_id, trim(p_hardware_id), true,
        now(), now() + interval '7 days', 'trial', 'Automatic first-run 7-day trial'
      ) returning * into selected_license;
    end if;
  elsif selected_license.expires_at is not null and selected_license.expires_at <= now() then
    raise exception 'The license for this hardware has expired';
  elsif coalesce(selected_license.is_active, false) = false then
    raise exception 'The license for this hardware is inactive';
  else
    update public.licenses
    set vendor_id = owner_id,
        is_active = true,
        activated_at = coalesce(activated_at, now())
    where id = selected_license.id
    returning * into selected_license;
  end if;

  insert into public.vendors (
    vendor_id, hardware_id, machine_name, license_key, is_licensed,
    activated_at, status, trial_started_at, trial_expires_at, trial_active
  ) values (
    owner_id, trim(p_hardware_id),
    coalesce(nullif(trim(p_machine_name), ''), 'RJD PisoWiFi Machine'),
    selected_license.license_key, true, now(), 'online',
    case when selected_license.license_type = 'trial' then now() else null end,
    case when selected_license.license_type = 'trial' then selected_license.expires_at else null end,
    selected_license.license_type = 'trial'
  )
  on conflict (hardware_id) do update
  set vendor_id = excluded.vendor_id,
      machine_name = coalesce(nullif(public.vendors.machine_name, ''), excluded.machine_name),
      license_key = excluded.license_key,
      is_licensed = true,
      activated_at = coalesce(public.vendors.activated_at, excluded.activated_at),
      status = 'online',
      trial_started_at = excluded.trial_started_at,
      trial_expires_at = excluded.trial_expires_at,
      trial_active = excluded.trial_active
  returning * into machine_record;

  label := case coalesce(selected_license.license_type, 'basic')
    when 'trial' then '7-Day Trial'
    when 'premium' then 'Premium License'
    when 'lifetime' then 'Lifetime License'
    else 'Basic License'
  end;

  return jsonb_build_object(
    'success', true,
    'machine_id', machine_record.id,
    'account_id', owner_id,
    'license_key', selected_license.license_key,
    'license_type', coalesce(selected_license.license_type, 'basic'),
    'label', label,
    'expires_at', selected_license.expires_at,
    'is_trial', selected_license.license_type = 'trial'
  );
end;
$$;

create or replace function public.register_rjd_vendor_account()
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  account_id uuid := auth.uid();
begin
  if account_id is null then
    raise exception 'Website account authentication is required';
  end if;

  insert into public.user_roles (user_id, role)
  values (account_id, 'vendor')
  on conflict (user_id, role) do nothing;

  return jsonb_build_object(
    'success', true,
    'account_id', account_id,
    'role', 'vendor'
  );
end;
$$;

revoke all on function public.setup_pisowifi_machine(text, text) from public;
grant execute on function public.setup_pisowifi_machine(text, text) to authenticated;
revoke all on function public.register_rjd_vendor_account() from public;
grant execute on function public.register_rjd_vendor_account() to authenticated;
