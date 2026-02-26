-- Portal account profile persistence for account settings (issue #63)

create table if not exists public.customer_profiles (
  user_id uuid primary key references auth.users (id) on delete cascade,
  full_name text,
  company_name text,
  phone text,
  shipping_street_1 text,
  shipping_street_2 text,
  shipping_city text,
  shipping_state text,
  shipping_postal_code text,
  shipping_country text not null default 'US',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

drop trigger if exists customer_profiles_set_updated_at on public.customer_profiles;

create trigger customer_profiles_set_updated_at
before update on public.customer_profiles
for each row execute function public.set_updated_at();

alter table public.customer_profiles enable row level security;

drop policy if exists "customer_profiles_select_own_or_super_admin" on public.customer_profiles;
drop policy if exists "customer_profiles_insert_own" on public.customer_profiles;
drop policy if exists "customer_profiles_update_own" on public.customer_profiles;
drop policy if exists "customer_profiles_select_super_admin" on public.customer_profiles;

create policy "customer_profiles_select_own_or_super_admin"
on public.customer_profiles
for select
to authenticated
using (
  auth.uid() = user_id
  or public.is_super_admin(auth.uid())
);

create policy "customer_profiles_insert_own"
on public.customer_profiles
for insert
to authenticated
with check (auth.uid() = user_id);

create policy "customer_profiles_update_own"
on public.customer_profiles
for update
to authenticated
using (auth.uid() = user_id)
with check (auth.uid() = user_id);
