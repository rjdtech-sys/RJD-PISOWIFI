-- Add vendor sub-account support.
-- Each vendor can link exactly one sub-account. The linked user must already
-- exist in Supabase Auth, then the vendor links that user's UUID.

create extension if not exists pgcrypto;

alter table public.user_roles drop constraint if exists user_roles_role_check;
alter table public.user_roles
add constraint user_roles_role_check
check (role in ('superadmin', 'vendor', 'client', 'vendor_subaccount'));

create table if not exists public.vendor_sub_accounts (
  id uuid primary key default gen_random_uuid(),
  vendor_id uuid not null references auth.users(id) on delete cascade,
  sub_user_id uuid not null references auth.users(id) on delete cascade,
  permission text not null check (permission in ('view_only', 'sales_only', 'support_only')),
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index if not exists vendor_sub_accounts_vendor_id_key
on public.vendor_sub_accounts (vendor_id);

create unique index if not exists vendor_sub_accounts_sub_user_id_key
on public.vendor_sub_accounts (sub_user_id);

alter table public.vendor_sub_accounts enable row level security;

create or replace function public.is_vendor_subaccount()
returns boolean
language sql
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.user_roles ur
    join public.vendor_sub_accounts vsa on vsa.sub_user_id = ur.user_id
    where ur.user_id = auth.uid()
      and ur.role = 'vendor_subaccount'
      and vsa.is_active = true
  );
$$;

create or replace function public.get_vendor_owner_id()
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  owner_id uuid;
begin
  if public.is_vendor() then
    return auth.uid();
  end if;

  select vendor_id into owner_id
  from public.vendor_sub_accounts
  where sub_user_id = auth.uid()
    and is_active = true
  limit 1;

  return owner_id;
end;
$$;

create or replace function public.get_vendor_sub_permission()
returns text
language sql
security definer
set search_path = public
as $$
  select permission
  from public.vendor_sub_accounts
  where sub_user_id = auth.uid()
    and is_active = true
  limit 1;
$$;

create or replace function public.get_my_vendor_sub_account()
returns table (
  id uuid,
  vendor_id uuid,
  sub_user_id uuid,
  permission text,
  is_active boolean,
  created_at timestamptz,
  updated_at timestamptz
)
language sql
security definer
set search_path = public
as $$
  select vsa.id, vsa.vendor_id, vsa.sub_user_id, vsa.permission, vsa.is_active, vsa.created_at, vsa.updated_at
  from public.vendor_sub_accounts vsa
  where (
    public.is_superadmin()
    or vsa.vendor_id = auth.uid()
    or vsa.sub_user_id = auth.uid()
  )
  order by vsa.updated_at desc
  limit 1;
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

  if sub_user_id_param is null then
    raise exception 'Sub-account user UUID is required';
  end if;

  if sub_user_id_param = auth.uid() then
    raise exception 'A vendor account cannot be its own sub-account';
  end if;

  if permission_param not in ('view_only', 'sales_only', 'support_only') then
    raise exception 'Invalid sub-account permission';
  end if;

  if not exists (select 1 from auth.users where id = sub_user_id_param) then
    raise exception 'Sub-account user does not exist in Supabase Auth';
  end if;

  if exists (
    select 1
    from public.vendor_sub_accounts
    where sub_user_id = sub_user_id_param
      and vendor_id <> auth.uid()
  ) then
    raise exception 'This sub-account is already assigned to another vendor';
  end if;

  select sub_user_id into existing_sub_user_id
  from public.vendor_sub_accounts
  where vendor_id = auth.uid();

  if existing_sub_user_id is not null and existing_sub_user_id <> sub_user_id_param then
    delete from public.user_roles
    where user_id = existing_sub_user_id
      and role = 'vendor_subaccount';
  end if;

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

  delete from public.vendor_sub_accounts
  where vendor_id = auth.uid();

  delete from public.user_roles
  where user_id = existing_sub_user_id
    and role = 'vendor_subaccount';

  return true;
end;
$$;

drop policy if exists "Superadmins can manage vendor sub accounts" on public.vendor_sub_accounts;
create policy "Superadmins can manage vendor sub accounts"
on public.vendor_sub_accounts for all
using (public.is_superadmin())
with check (public.is_superadmin());

drop policy if exists "Vendors can manage own sub account" on public.vendor_sub_accounts;
create policy "Vendors can manage own sub account"
on public.vendor_sub_accounts for all
using (vendor_id = auth.uid())
with check (vendor_id = auth.uid());

drop policy if exists "Subaccounts can view own link" on public.vendor_sub_accounts;
create policy "Subaccounts can view own link"
on public.vendor_sub_accounts for select
using (sub_user_id = auth.uid());

drop policy if exists "Vendors can view own machines" on public.vendors;
drop policy if exists "Vendors and subaccounts can view own machines" on public.vendors;
create policy "Vendors and subaccounts can view own machines"
on public.vendors for select
using (
  vendor_id = auth.uid()
  or (
    public.is_vendor_subaccount()
    and vendor_id = public.get_vendor_owner_id()
    and public.get_vendor_sub_permission() in ('view_only', 'sales_only', 'support_only')
  )
);

drop policy if exists "Vendors can view own licenses" on public.licenses;
drop policy if exists "Vendors and permitted subaccounts can view own licenses" on public.licenses;
create policy "Vendors and permitted subaccounts can view own licenses"
on public.licenses for select
using (
  vendor_id = auth.uid()
  or (
    public.is_vendor_subaccount()
    and vendor_id = public.get_vendor_owner_id()
    and public.get_vendor_sub_permission() in ('view_only', 'support_only')
  )
);

drop policy if exists "Vendors can view own sales" on public.sales_logs;
drop policy if exists "Vendors and permitted subaccounts can view own sales" on public.sales_logs;
create policy "Vendors and permitted subaccounts can view own sales"
on public.sales_logs for select
using (
  vendor_id = auth.uid()
  or (
    public.is_vendor_subaccount()
    and vendor_id = public.get_vendor_owner_id()
    and public.get_vendor_sub_permission() in ('view_only', 'sales_only')
  )
);
