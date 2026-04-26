-- Technician entitlement data model and helper foundations.
--
-- This migration intentionally adds source records and validation helpers only.
-- Customer-facing grant/revoke RPCs and portal UX are handled by later slices.

alter table public.reporting_machine_entitlements
  add column if not exists source_type text not null default 'manual',
  add column if not exists source_id uuid;

update public.reporting_machine_entitlements
set source_type = 'manual'
where source_type is null;

alter table public.reporting_machine_entitlements
  alter column source_type set default 'manual',
  alter column source_type set not null;

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'reporting_machine_entitlements_source_type_check'
      and conrelid = 'public.reporting_machine_entitlements'::regclass
  ) then
    alter table public.reporting_machine_entitlements
      add constraint reporting_machine_entitlements_source_type_check
      check (source_type in ('manual', 'technician_grant'));
  end if;

  if not exists (
    select 1
    from pg_constraint
    where conname = 'reporting_machine_entitlements_source_shape_check'
      and conrelid = 'public.reporting_machine_entitlements'::regclass
  ) then
    alter table public.reporting_machine_entitlements
      add constraint reporting_machine_entitlements_source_shape_check
      check (
        (
          source_type = 'manual'
          and source_id is null
        )
        or (
          source_type = 'technician_grant'
          and source_id is not null
          and machine_id is not null
          and account_id is null
          and location_id is null
          and access_level = 'viewer'
        )
      );
  end if;
end;
$$;

create index if not exists reporting_machine_entitlements_source_idx
  on public.reporting_machine_entitlements (source_type, source_id)
  where revoked_at is null;

create table if not exists public.technician_grants (
  id uuid primary key default gen_random_uuid(),
  account_id uuid not null references public.customer_accounts (id) on delete cascade,
  sponsor_user_id uuid not null references auth.users (id) on delete cascade,
  technician_email text not null,
  technician_user_id uuid references auth.users (id) on delete set null,
  operator_training_grant_id uuid references public.operator_training_grants (id) on delete set null,
  status text not null default 'pending'
    check (status in ('pending', 'active', 'suspended', 'revoked')),
  invite_sent_at timestamptz,
  invite_last_error text,
  starts_at timestamptz not null default now(),
  expires_at timestamptz,
  grant_reason text not null default 'Technician access',
  granted_by_user_id uuid references auth.users (id) on delete set null,
  revoked_at timestamptz,
  revoked_by_user_id uuid references auth.users (id) on delete set null,
  revoke_reason text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint technician_grants_email_present check (length(trim(technician_email)) > 0),
  constraint technician_grants_valid_window check (
    expires_at is null
    or expires_at > starts_at
  ),
  constraint technician_grants_reason_present check (length(trim(grant_reason)) > 0),
  constraint technician_grants_revoke_reason_required check (
    revoked_at is null
    or length(trim(coalesce(revoke_reason, ''))) > 0
  ),
  constraint technician_grants_revoked_status_check check (
    (revoked_at is null and status <> 'revoked')
    or (revoked_at is not null and status = 'revoked')
  )
);

create unique index if not exists technician_grants_one_open_email_per_account_idx
  on public.technician_grants (account_id, lower(technician_email))
  where revoked_at is null;

create index if not exists technician_grants_account_id_idx
  on public.technician_grants (account_id);

create index if not exists technician_grants_sponsor_user_id_idx
  on public.technician_grants (sponsor_user_id);

create index if not exists technician_grants_technician_user_id_idx
  on public.technician_grants (technician_user_id)
  where revoked_at is null;

create index if not exists technician_grants_technician_email_idx
  on public.technician_grants (lower(technician_email))
  where revoked_at is null;

drop trigger if exists technician_grants_set_updated_at on public.technician_grants;
create trigger technician_grants_set_updated_at
before update on public.technician_grants
for each row execute function public.set_updated_at();

create table if not exists public.technician_machine_assignments (
  id uuid primary key default gen_random_uuid(),
  technician_grant_id uuid not null references public.technician_grants (id) on delete cascade,
  machine_id uuid not null references public.reporting_machines (id) on delete cascade,
  status text not null default 'active'
    check (status in ('active', 'suspended', 'revoked')),
  starts_at timestamptz not null default now(),
  expires_at timestamptz,
  grant_reason text not null default 'Technician machine access',
  granted_by_user_id uuid references auth.users (id) on delete set null,
  revoked_at timestamptz,
  revoked_by_user_id uuid references auth.users (id) on delete set null,
  revoke_reason text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint technician_machine_assignments_valid_window check (
    expires_at is null
    or expires_at > starts_at
  ),
  constraint technician_machine_assignments_reason_present check (length(trim(grant_reason)) > 0),
  constraint technician_machine_assignments_revoke_reason_required check (
    revoked_at is null
    or length(trim(coalesce(revoke_reason, ''))) > 0
  ),
  constraint technician_machine_assignments_revoked_status_check check (
    (revoked_at is null and status <> 'revoked')
    or (revoked_at is not null and status = 'revoked')
  )
);

create unique index if not exists technician_machine_assignments_one_open_machine_idx
  on public.technician_machine_assignments (technician_grant_id, machine_id)
  where revoked_at is null;

create index if not exists technician_machine_assignments_grant_id_idx
  on public.technician_machine_assignments (technician_grant_id)
  where revoked_at is null;

create index if not exists technician_machine_assignments_machine_id_idx
  on public.technician_machine_assignments (machine_id)
  where revoked_at is null;

drop trigger if exists technician_machine_assignments_set_updated_at on public.technician_machine_assignments;
create trigger technician_machine_assignments_set_updated_at
before update on public.technician_machine_assignments
for each row execute function public.set_updated_at();

create or replace function public.normalize_technician_email(email_input text)
returns text
language sql
immutable
as $$
  select lower(trim(coalesce(email_input, '')));
$$;

create or replace function public.technician_grant_is_active(
  starts_at timestamptz,
  expires_at timestamptz,
  revoked_at timestamptz,
  grant_status text
)
returns boolean
language sql
stable
as $$
  select grant_status in ('pending', 'active')
    and revoked_at is null
    and starts_at <= now()
    and (expires_at is null or expires_at > now());
$$;

create or replace function public.technician_assignment_is_active(
  starts_at timestamptz,
  expires_at timestamptz,
  revoked_at timestamptz,
  assignment_status text
)
returns boolean
language sql
stable
as $$
  select assignment_status = 'active'
    and revoked_at is null
    and starts_at <= now()
    and (expires_at is null or expires_at > now());
$$;

create or replace function public.can_manage_technician_grants_for_account(
  p_user_id uuid,
  p_account_id uuid
)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select p_user_id is not null
    and p_account_id is not null
    and (
      public.is_super_admin(p_user_id)
      or (
        public.has_plus_access(p_user_id)
        and exists (
          select 1
          from public.customer_account_memberships membership
          where membership.user_id = p_user_id
            and membership.account_id = p_account_id
            and membership.active
            and membership.role = 'owner'
        )
      )
    );
$$;

create or replace function public.can_manage_technician_grants_for_machine(
  p_user_id uuid,
  p_machine_id uuid
)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select p_user_id is not null
    and p_machine_id is not null
    and exists (
      select 1
      from public.reporting_machines machine
      where machine.id = p_machine_id
        and machine.status = 'active'
        and public.can_manage_technician_grants_for_account(p_user_id, machine.account_id)
    );
$$;

create or replace function public.can_access_technician_grant(
  p_user_id uuid,
  p_technician_grant_id uuid
)
returns boolean
language sql
stable
security definer
set search_path = public, auth
as $$
  select p_user_id is not null
    and p_technician_grant_id is not null
    and (
      public.is_super_admin(p_user_id)
      or exists (
        select 1
        from public.technician_grants grant_row
        left join auth.users auth_user on auth_user.id = p_user_id
        where grant_row.id = p_technician_grant_id
          and (
            grant_row.sponsor_user_id = p_user_id
            or grant_row.technician_user_id = p_user_id
            or lower(grant_row.technician_email) = lower(auth_user.email)
          )
      )
    );
$$;

create or replace function public.count_active_technician_grants(p_account_id uuid)
returns integer
language sql
stable
security definer
set search_path = public
as $$
  select count(distinct coalesce(grant_row.technician_user_id::text, lower(grant_row.technician_email)))::integer
  from public.technician_grants grant_row
  where grant_row.account_id = p_account_id
    and public.technician_grant_is_active(
      grant_row.starts_at,
      grant_row.expires_at,
      grant_row.revoked_at,
      grant_row.status
    );
$$;

create or replace function public.has_available_technician_grant_seat(
  p_account_id uuid,
  p_technician_email text default null,
  p_technician_user_id uuid default null,
  p_default_cap integer default 10
)
returns boolean
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  normalized_email text;
  effective_cap integer;
begin
  if p_account_id is null then
    return false;
  end if;

  normalized_email := public.normalize_technician_email(p_technician_email);
  effective_cap := coalesce(p_default_cap, 10);

  if effective_cap <= 0 then
    return false;
  end if;

  if exists (
    select 1
    from public.technician_grants grant_row
    where grant_row.account_id = p_account_id
      and public.technician_grant_is_active(
        grant_row.starts_at,
        grant_row.expires_at,
        grant_row.revoked_at,
        grant_row.status
      )
      and (
        (
          p_technician_user_id is not null
          and grant_row.technician_user_id = p_technician_user_id
        )
        or (
          normalized_email <> ''
          and lower(grant_row.technician_email) = normalized_email
        )
      )
  ) then
    return true;
  end if;

  return public.count_active_technician_grants(p_account_id) < effective_cap;
end;
$$;

alter table public.technician_grants enable row level security;
alter table public.technician_machine_assignments enable row level security;

drop policy if exists "technician_grants_select_related" on public.technician_grants;
create policy "technician_grants_select_related"
on public.technician_grants
for select
to authenticated
using (public.can_access_technician_grant((select auth.uid()), id));

drop policy if exists "technician_machine_assignments_select_related" on public.technician_machine_assignments;
create policy "technician_machine_assignments_select_related"
on public.technician_machine_assignments
for select
to authenticated
using (public.can_access_technician_grant((select auth.uid()), technician_grant_id));

comment on table public.technician_grants is
  'Source records for customer Technician access. Grants compose training access with explicit machine reporting assignments.';

comment on table public.technician_machine_assignments is
  'Machine assignment records for Technician grants. Reporting entitlement rows derived from these assignments use source_type=technician_grant.';

comment on column public.reporting_machine_entitlements.source_type is
  'Source of the reporting entitlement. Manual rows stay independent from Technician-derived rows.';

comment on column public.reporting_machine_entitlements.source_id is
  'Source record ID for non-manual reporting entitlements, such as technician_grants.id when source_type=technician_grant.';

revoke execute on function public.normalize_technician_email(text) from public;
revoke execute on function public.technician_grant_is_active(timestamptz, timestamptz, timestamptz, text) from public;
revoke execute on function public.technician_assignment_is_active(timestamptz, timestamptz, timestamptz, text) from public;
revoke execute on function public.can_manage_technician_grants_for_account(uuid, uuid) from public;
revoke execute on function public.can_manage_technician_grants_for_machine(uuid, uuid) from public;
revoke execute on function public.can_access_technician_grant(uuid, uuid) from public;
revoke execute on function public.count_active_technician_grants(uuid) from public;
revoke execute on function public.has_available_technician_grant_seat(uuid, text, uuid, integer) from public;

select pg_notify('pgrst', 'reload schema');
