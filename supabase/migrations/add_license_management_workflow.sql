-- Secure cloud license generation, ownership visibility, revocation, and transfer.

alter table public.licenses
  add column if not exists license_type text default 'basic';

create or replace function public.refresh_rjd_license_expirations()
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  expired_license_count integer := 0;
  updated_machine_count integer := 0;
begin
  update public.licenses
  set is_active = false
  where coalesce(is_active, false) = true
    and coalesce(is_revoked, false) = false
    and expires_at is not null
    and expires_at <= now();
  get diagnostics expired_license_count = row_count;

  update public.vendors machine
  set is_licensed = false,
      trial_active = case
        when coalesce(machine.trial_active, false)
          and machine.trial_expires_at is not null
          and machine.trial_expires_at <= now()
        then false
        else machine.trial_active
      end
  from public.licenses license
  where machine.license_key = license.license_key
    and coalesce(machine.is_revoked, false) = false
    and license.expires_at is not null
    and license.expires_at <= now();
  get diagnostics updated_machine_count = row_count;

  return jsonb_build_object(
    'success', true,
    'expired_licenses', expired_license_count,
    'updated_machines', updated_machine_count
  );
end;
$$;

create or replace function public.list_rjd_license_assignees()
returns table (
  user_id uuid,
  email text,
  display_name text,
  roles text[]
)
language plpgsql
security definer
set search_path = public, auth
as $$
begin
  if not public.is_superadmin() then
    raise exception 'Only superadmins can view license assignees';
  end if;

  perform public.refresh_rjd_license_expirations();

  return query
  select
    users.id,
    users.email::text,
    coalesce(
      nullif(users.raw_user_meta_data ->> 'display_name', ''),
      nullif(users.raw_user_meta_data ->> 'username', ''),
      split_part(coalesce(users.email, ''), '@', 1)
    )::text,
    array_agg(distinct user_roles.role order by user_roles.role)::text[]
  from auth.users users
  join public.user_roles user_roles on user_roles.user_id = users.id
  group by users.id, users.email, users.raw_user_meta_data
  order by users.email;
end;
$$;

create or replace function public.list_rjd_accounts()
returns table (
  user_id uuid,
  email text,
  display_name text,
  roles text[],
  vendor_owner_id uuid,
  subaccount_permission text
)
language plpgsql
security definer
set search_path = public, auth
as $$
begin
  if not (public.is_superadmin() or public.is_vendor()) then
    raise exception 'Only superadmins and vendors can view account assignments';
  end if;

  return query
  select
    users.id,
    users.email::text,
    coalesce(
      nullif(users.raw_user_meta_data ->> 'display_name', ''),
      nullif(users.raw_user_meta_data ->> 'username', ''),
      split_part(coalesce(users.email, ''), '@', 1)
    )::text,
    array_agg(distinct roles.role order by roles.role)::text[],
    sub.vendor_id,
    sub.permission
  from auth.users users
  join public.user_roles roles on roles.user_id = users.id
  left join public.vendor_sub_accounts sub on sub.sub_user_id = users.id and sub.is_active = true
  where public.is_superadmin()
     or roles.role = 'client'
     or sub.vendor_id = auth.uid()
  group by users.id, users.email, users.raw_user_meta_data, sub.vendor_id, sub.permission
  order by users.email;
end;
$$;

create or replace function public.set_rjd_account_role(
  p_target_user_id uuid,
  p_role text,
  p_vendor_id uuid default null,
  p_permission text default 'view_only'
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  normalized_role text := lower(trim(coalesce(p_role, '')));
begin
  if not public.is_superadmin() then
    raise exception 'Only superadmins can assign account roles';
  end if;

  if p_target_user_id is null or not exists (
    select 1 from auth.users where id = p_target_user_id
  ) then
    raise exception 'Target account does not exist';
  end if;

  if exists (
    select 1 from public.user_roles
    where user_id = p_target_user_id and role = 'superadmin'
  ) then
    raise exception 'The superadmin role cannot be changed here';
  end if;

  if normalized_role not in ('vendor', 'client', 'vendor_subaccount') then
    raise exception 'Role must be vendor, client, or vendor_subaccount';
  end if;

  if normalized_role = 'vendor_subaccount' then
    if p_vendor_id is null or not exists (
      select 1 from public.user_roles
      where user_id = p_vendor_id and role = 'vendor'
    ) then
      raise exception 'A vendor account is required for a vendor subaccount';
    end if;
    if p_permission not in ('view_only', 'sales_only', 'support_only') then
      raise exception 'Invalid sub-account permission';
    end if;
  end if;

  insert into public.user_roles (user_id, role)
  select sub_user_id, 'client'
  from public.vendor_sub_accounts
  where vendor_id = p_target_user_id
  on conflict (user_id, role) do nothing;

  delete from public.vendor_sub_accounts
  where sub_user_id = p_target_user_id
     or vendor_id = p_target_user_id
     or (normalized_role = 'vendor_subaccount' and vendor_id = p_vendor_id);

  delete from public.user_roles
  where user_id = p_target_user_id
    and role in ('vendor', 'client', 'vendor_subaccount');

  insert into public.user_roles (user_id, role)
  values (p_target_user_id, normalized_role);

  if normalized_role = 'vendor_subaccount' then
    insert into public.vendor_sub_accounts (
      vendor_id, sub_user_id, permission, is_active
    ) values (
      p_vendor_id, p_target_user_id, p_permission, true
    );
  end if;

  return jsonb_build_object(
    'success', true,
    'user_id', p_target_user_id,
    'role', normalized_role
  );
end;
$$;

create or replace function public.set_vendor_sub_account(
  sub_user_id_param uuid,
  permission_param text
)
returns public.vendor_sub_accounts
language plpgsql
security definer
set search_path = public
as $$
declare
  existing_sub_user_id uuid;
  result public.vendor_sub_accounts;
begin
  if not public.is_vendor() then
    raise exception 'Only vendor accounts can manage sub-accounts';
  end if;

  if sub_user_id_param is null or sub_user_id_param = auth.uid() then
    raise exception 'A valid client account UUID is required';
  end if;

  if permission_param not in ('view_only', 'sales_only', 'support_only') then
    raise exception 'Invalid sub-account permission';
  end if;

  if not exists (
    select 1 from public.user_roles
    where user_id = sub_user_id_param and role = 'client'
  ) then
    raise exception 'Only client accounts can become vendor sub-accounts';
  end if;

  if exists (
    select 1 from public.user_roles
    where user_id = sub_user_id_param and role in ('superadmin', 'vendor')
  ) then
    raise exception 'Superadmin and vendor accounts cannot become sub-accounts';
  end if;

  if exists (
    select 1 from public.vendor_sub_accounts
    where sub_user_id = sub_user_id_param and vendor_id <> auth.uid()
  ) then
    raise exception 'This client is already assigned to another vendor';
  end if;

  select sub_user_id into existing_sub_user_id
  from public.vendor_sub_accounts
  where vendor_id = auth.uid();

  if existing_sub_user_id is not null and existing_sub_user_id <> sub_user_id_param then
    delete from public.user_roles
    where user_id = existing_sub_user_id and role = 'vendor_subaccount';
    insert into public.user_roles (user_id, role)
    values (existing_sub_user_id, 'client')
    on conflict (user_id, role) do nothing;
  end if;

  delete from public.user_roles
  where user_id = sub_user_id_param and role = 'client';

  insert into public.user_roles (user_id, role)
  values (sub_user_id_param, 'vendor_subaccount')
  on conflict (user_id, role) do nothing;

  insert into public.vendor_sub_accounts (vendor_id, sub_user_id, permission, is_active)
  values (auth.uid(), sub_user_id_param, permission_param, true)
  on conflict (vendor_id) do update
    set sub_user_id = excluded.sub_user_id,
        permission = excluded.permission,
        is_active = true,
        updated_at = now()
  returning * into result;

  return result;
end;
$$;

create or replace function public.remove_vendor_sub_account()
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  existing_sub_user_id uuid;
begin
  if not public.is_vendor() then
    raise exception 'Only vendor accounts can manage sub-accounts';
  end if;

  select sub_user_id into existing_sub_user_id
  from public.vendor_sub_accounts
  where vendor_id = auth.uid();

  if existing_sub_user_id is null then
    return false;
  end if;

  delete from public.vendor_sub_accounts where vendor_id = auth.uid();
  delete from public.user_roles
  where user_id = existing_sub_user_id and role = 'vendor_subaccount';
  insert into public.user_roles (user_id, role)
  values (existing_sub_user_id, 'client')
  on conflict (user_id, role) do nothing;

  return true;
end;
$$;

create or replace function public.generate_rjd_licenses(
  p_batch_size integer default 1,
  p_license_type text default 'basic',
  p_assigned_user_id uuid default null,
  p_expiration_months integer default 12,
  p_max_online_users integer default null
)
returns table (
  id uuid,
  license_key text,
  license_type text,
  vendor_id uuid,
  expires_at timestamptz,
  max_online_users integer
)
language plpgsql
security definer
set search_path = public
as $$
declare
  item integer;
  generated_key text;
  normalized_type text := lower(trim(coalesce(p_license_type, 'basic')));
  normalized_limit integer;
  expiration timestamptz;
  inserted public.licenses%rowtype;
begin
  if not public.is_superadmin() then
    raise exception 'Only superadmins can generate licenses';
  end if;

  if normalized_type not in ('basic', 'premium', 'lifetime') then
    raise exception 'License type must be basic, premium, or lifetime';
  end if;

  if p_assigned_user_id is not null and not exists (
    select 1 from public.user_roles where user_id = p_assigned_user_id
  ) then
    raise exception 'Assigned account does not have a user role';
  end if;

  normalized_limit := case
    when p_max_online_users is not null and p_max_online_users > 0 then p_max_online_users
    else null
  end;

  expiration := case
    when normalized_type = 'lifetime' then null
    when p_expiration_months is not null and p_expiration_months > 0
      then now() + make_interval(months => p_expiration_months)
    else now() + interval '12 months'
  end;

  for item in 1..least(greatest(coalesce(p_batch_size, 1), 1), 100) loop
    generated_key := 'RJD-' ||
      upper(substr(md5(random()::text || clock_timestamp()::text || item::text || auth.uid()::text), 1, 8)) || '-' ||
      upper(substr(md5(clock_timestamp()::text || random()::text || item::text), 1, 8));

    insert into public.licenses (
      license_key, license_type, vendor_id, created_by, is_active,
      is_revoked, expires_at, max_online_users
    ) values (
      generated_key, normalized_type, p_assigned_user_id, auth.uid(), false,
      false, expiration, normalized_limit
    ) returning * into inserted;

    id := inserted.id;
    license_key := inserted.license_key;
    license_type := inserted.license_type;
    vendor_id := inserted.vendor_id;
    expires_at := inserted.expires_at;
    max_online_users := inserted.max_online_users;
    return next;
  end loop;
end;
$$;

create or replace function public.revoke_rjd_license(p_license_id uuid)
returns public.licenses
language plpgsql
security definer
set search_path = public
as $$
declare
  target public.licenses%rowtype;
begin
  if not public.is_superadmin() then
    raise exception 'Only superadmins can revoke licenses';
  end if;

  select * into target
  from public.licenses
  where id = p_license_id
  for update;

  if target.id is null then
    raise exception 'License not found';
  end if;

  update public.vendors
  set is_licensed = false,
      is_revoked = true,
      trial_active = false
  where license_key = target.license_key
     or hardware_id = target.hardware_id;

  update public.licenses
  set is_active = false,
      is_revoked = true
  where id = target.id
  returning * into target;

  return target;
end;
$$;

create or replace function public.transfer_rjd_license(
  p_license_id uuid,
  p_target_user_id uuid
)
returns public.licenses
language plpgsql
security definer
set search_path = public
as $$
declare
  target public.licenses%rowtype;
begin
  if not public.is_superadmin() then
    raise exception 'Only superadmins can transfer licenses';
  end if;

  if p_target_user_id is null or not exists (
    select 1 from public.user_roles where user_id = p_target_user_id
  ) then
    raise exception 'Target account does not have a user role';
  end if;

  select * into target
  from public.licenses
  where id = p_license_id
  for update;

  if target.id is null then
    raise exception 'License not found';
  end if;

  if coalesce(target.is_active, false) then
    raise exception 'Revoke or deactivate the license before transfer';
  end if;

  if coalesce(target.license_type, 'basic') = 'trial' then
    raise exception 'Trial licenses cannot be transferred';
  end if;

  update public.vendors
  set license_key = null,
      is_licensed = false,
      is_revoked = true,
      trial_active = false
  where license_key = target.license_key
     or hardware_id = target.hardware_id;

  update public.licenses
  set vendor_id = p_target_user_id,
      hardware_id = null,
      is_active = false,
      is_revoked = false,
      activated_at = null
  where id = target.id
  returning * into target;

  return target;
end;
$$;

drop policy if exists "Vendors can view own licenses" on public.licenses;
drop policy if exists "Vendors and permitted subaccounts can view own licenses" on public.licenses;
drop policy if exists "Assigned accounts can view own licenses" on public.licenses;
create policy "Assigned accounts can view own licenses"
on public.licenses for select
using (
  vendor_id = auth.uid()
  or (
    public.is_vendor_subaccount()
    and vendor_id = public.get_vendor_owner_id()
    and public.get_vendor_sub_permission() in ('view_only', 'support_only')
  )
);

revoke all on function public.list_rjd_license_assignees() from public;
grant execute on function public.list_rjd_license_assignees() to authenticated;
revoke all on function public.list_rjd_accounts() from public;
grant execute on function public.list_rjd_accounts() to authenticated;
revoke all on function public.set_rjd_account_role(uuid, text, uuid, text) from public;
grant execute on function public.set_rjd_account_role(uuid, text, uuid, text) to authenticated;
revoke all on function public.set_vendor_sub_account(uuid, text) from public;
grant execute on function public.set_vendor_sub_account(uuid, text) to authenticated;
revoke all on function public.remove_vendor_sub_account() from public;
grant execute on function public.remove_vendor_sub_account() to authenticated;
revoke all on function public.refresh_rjd_license_expirations() from public;
grant execute on function public.refresh_rjd_license_expirations() to authenticated;
revoke all on function public.generate_rjd_licenses(integer, text, uuid, integer, integer) from public;
grant execute on function public.generate_rjd_licenses(integer, text, uuid, integer, integer) to authenticated;
revoke all on function public.revoke_rjd_license(uuid) from public;
grant execute on function public.revoke_rjd_license(uuid) to authenticated;
revoke all on function public.transfer_rjd_license(uuid, uuid) from public;
grant execute on function public.transfer_rjd_license(uuid, uuid) to authenticated;
