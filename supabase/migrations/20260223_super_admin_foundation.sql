-- Super-admin foundation for operations tooling (issue #44)

create table if not exists public.admin_roles (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  role text not null check (role = 'super_admin'),
  active boolean not null default true,
  granted_by uuid references auth.users (id) on delete set null,
  granted_at timestamptz not null default now(),
  revoked_by uuid references auth.users (id) on delete set null,
  revoked_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index if not exists admin_roles_active_user_role_idx
  on public.admin_roles (user_id, role)
  where active = true;

create index if not exists admin_roles_user_id_idx
  on public.admin_roles (user_id);

create table if not exists public.admin_audit_log (
  id uuid primary key default gen_random_uuid(),
  actor_user_id uuid references auth.users (id) on delete set null,
  action text not null,
  entity_type text not null,
  entity_id text,
  target_user_id uuid references auth.users (id) on delete set null,
  before jsonb not null default '{}'::jsonb,
  after jsonb not null default '{}'::jsonb,
  meta jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index if not exists admin_audit_log_created_at_idx
  on public.admin_audit_log (created_at desc);

create index if not exists admin_audit_log_actor_user_id_idx
  on public.admin_audit_log (actor_user_id);

drop trigger if exists admin_roles_set_updated_at on public.admin_roles;

create trigger admin_roles_set_updated_at
before update on public.admin_roles
for each row execute function public.set_updated_at();

create or replace function public.is_super_admin(uid uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.admin_roles ar
    where ar.user_id = uid
      and ar.role = 'super_admin'
      and ar.active = true
  );
$$;

grant execute on function public.is_super_admin(uuid) to authenticated;

alter table public.admin_roles enable row level security;
alter table public.admin_audit_log enable row level security;

drop policy if exists "admin_roles_select_self_or_super_admin" on public.admin_roles;
drop policy if exists "admin_roles_insert_super_admin" on public.admin_roles;
drop policy if exists "admin_roles_update_super_admin" on public.admin_roles;
drop policy if exists "admin_audit_log_select_super_admin" on public.admin_audit_log;
drop policy if exists "admin_audit_log_insert_super_admin" on public.admin_audit_log;

create policy "admin_roles_select_self_or_super_admin"
on public.admin_roles
for select
using (
  auth.uid() = user_id
  or public.is_super_admin(auth.uid())
);

create policy "admin_roles_insert_super_admin"
on public.admin_roles
for insert
with check (public.is_super_admin(auth.uid()));

create policy "admin_roles_update_super_admin"
on public.admin_roles
for update
using (public.is_super_admin(auth.uid()))
with check (public.is_super_admin(auth.uid()));

create policy "admin_audit_log_select_super_admin"
on public.admin_audit_log
for select
using (public.is_super_admin(auth.uid()));

create policy "admin_audit_log_insert_super_admin"
on public.admin_audit_log
for insert
with check (public.is_super_admin(auth.uid()));
