-- Sales reporting foundation: account/location/machine entitlements, normalized
-- sales facts, refund adjustments, exports, schedules, and reporting RPCs.

create table if not exists public.customer_accounts (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  account_type text not null default 'customer'
    check (account_type in ('customer', 'partner', 'internal')),
  status text not null default 'active'
    check (status in ('active', 'inactive')),
  notes text,
  created_by uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint customer_accounts_name_present check (length(trim(name)) > 0)
);

alter table public.customer_accounts
  add column if not exists account_type text not null default 'customer',
  add column if not exists status text not null default 'active',
  add column if not exists notes text,
  add column if not exists created_by uuid references auth.users (id) on delete set null;

do $$
begin
  if exists (
    select 1
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'customer_accounts'
      and column_name = 'created_by_user_id'
  ) then
    update public.customer_accounts
    set created_by = created_by_user_id
    where created_by is null
      and created_by_user_id is not null;
  end if;
end;
$$;

do $$
begin
  alter table public.customer_accounts
    add constraint customer_accounts_account_type_check
    check (account_type in ('customer', 'partner', 'internal'));
exception
  when duplicate_object then null;
end;
$$;

do $$
begin
  alter table public.customer_accounts
    add constraint customer_accounts_status_check
    check (status in ('active', 'inactive'));
exception
  when duplicate_object then null;
end;
$$;

create unique index if not exists customer_accounts_name_unique_idx
  on public.customer_accounts (lower(name));

drop trigger if exists customer_accounts_set_updated_at on public.customer_accounts;
create trigger customer_accounts_set_updated_at
before update on public.customer_accounts
for each row execute function public.set_updated_at();

create table if not exists public.customer_account_memberships (
  id uuid primary key default gen_random_uuid(),
  account_id uuid not null references public.customer_accounts (id) on delete cascade,
  user_id uuid not null references auth.users (id) on delete cascade,
  role text not null
    check (role in (
      'owner',
      'account_admin',
      'billing_manager',
      'operator',
      'support_contact',
      'report_viewer',
      'report_manager',
      'partner_viewer'
    )),
  active boolean not null default true,
  created_by uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.customer_account_memberships
  add column if not exists active boolean not null default true,
  add column if not exists created_by uuid references auth.users (id) on delete set null;

do $$
begin
  if exists (
    select 1
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'customer_account_memberships'
      and column_name = 'revoked_at'
  ) then
    update public.customer_account_memberships
    set active = revoked_at is null;
  end if;

  if exists (
    select 1
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'customer_account_memberships'
      and column_name = 'invited_by_user_id'
  ) then
    update public.customer_account_memberships
    set created_by = invited_by_user_id
    where created_by is null
      and invited_by_user_id is not null;
  end if;
end;
$$;

alter table public.customer_account_memberships
  drop constraint if exists customer_account_memberships_role_check;

alter table public.customer_account_memberships
  add constraint customer_account_memberships_role_check
  check (role in (
    'owner',
    'account_admin',
    'billing_manager',
    'operator',
    'support_contact',
    'report_viewer',
    'report_manager',
    'partner_viewer',
    'partner'
  ));

create unique index if not exists customer_account_memberships_active_role_idx
  on public.customer_account_memberships (account_id, user_id, role)
  where active;

create index if not exists customer_account_memberships_user_id_idx
  on public.customer_account_memberships (user_id);

create index if not exists customer_account_memberships_account_id_idx
  on public.customer_account_memberships (account_id);

drop trigger if exists customer_account_memberships_set_updated_at on public.customer_account_memberships;
create trigger customer_account_memberships_set_updated_at
before update on public.customer_account_memberships
for each row execute function public.set_updated_at();

create table if not exists public.reporting_locations (
  id uuid primary key default gen_random_uuid(),
  account_id uuid not null references public.customer_accounts (id) on delete cascade,
  name text not null,
  partner_name text,
  city text,
  state text,
  timezone text not null default 'America/Los_Angeles',
  status text not null default 'active'
    check (status in ('active', 'inactive')),
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint reporting_locations_name_present check (length(trim(name)) > 0)
);

create unique index if not exists reporting_locations_account_name_idx
  on public.reporting_locations (account_id, lower(name));

create index if not exists reporting_locations_account_id_idx
  on public.reporting_locations (account_id);

drop trigger if exists reporting_locations_set_updated_at on public.reporting_locations;
create trigger reporting_locations_set_updated_at
before update on public.reporting_locations
for each row execute function public.set_updated_at();

create table if not exists public.reporting_machines (
  id uuid primary key default gen_random_uuid(),
  account_id uuid not null references public.customer_accounts (id) on delete cascade,
  location_id uuid not null references public.reporting_locations (id) on delete cascade,
  machine_label text not null,
  machine_type text not null default 'commercial'
    check (machine_type in ('commercial', 'mini', 'micro', 'unknown')),
  serial_number text,
  sunze_machine_id text,
  status text not null default 'active'
    check (status in ('active', 'inactive')),
  installed_at date,
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint reporting_machines_label_present check (length(trim(machine_label)) > 0)
);

create unique index if not exists reporting_machines_sunze_machine_id_idx
  on public.reporting_machines (lower(sunze_machine_id))
  where sunze_machine_id is not null;

create index if not exists reporting_machines_account_id_idx
  on public.reporting_machines (account_id);

create index if not exists reporting_machines_location_id_idx
  on public.reporting_machines (location_id);

drop trigger if exists reporting_machines_set_updated_at on public.reporting_machines;
create trigger reporting_machines_set_updated_at
before update on public.reporting_machines
for each row execute function public.set_updated_at();

create table if not exists public.reporting_machine_entitlements (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  account_id uuid references public.customer_accounts (id) on delete cascade,
  location_id uuid references public.reporting_locations (id) on delete cascade,
  machine_id uuid references public.reporting_machines (id) on delete cascade,
  access_level text not null default 'viewer'
    check (access_level in ('viewer', 'report_manager')),
  starts_at timestamptz not null default now(),
  expires_at timestamptz,
  grant_reason text not null default 'Sales reporting access',
  granted_by uuid references auth.users (id) on delete set null,
  revoked_at timestamptz,
  revoked_by uuid references auth.users (id) on delete set null,
  revoke_reason text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint reporting_entitlements_scope_present check (
    account_id is not null or location_id is not null or machine_id is not null
  ),
  constraint reporting_entitlements_valid_window check (
    expires_at is null or expires_at > starts_at
  ),
  constraint reporting_entitlements_reason_present check (length(trim(grant_reason)) > 0),
  constraint reporting_entitlements_revoke_reason_required check (
    revoked_at is null or length(trim(coalesce(revoke_reason, ''))) > 0
  )
);

create index if not exists reporting_machine_entitlements_user_id_idx
  on public.reporting_machine_entitlements (user_id)
  where revoked_at is null;

create index if not exists reporting_machine_entitlements_machine_id_idx
  on public.reporting_machine_entitlements (machine_id)
  where revoked_at is null;

create index if not exists reporting_machine_entitlements_location_id_idx
  on public.reporting_machine_entitlements (location_id)
  where revoked_at is null;

create index if not exists reporting_machine_entitlements_account_id_idx
  on public.reporting_machine_entitlements (account_id)
  where revoked_at is null;

drop trigger if exists reporting_machine_entitlements_set_updated_at on public.reporting_machine_entitlements;
create trigger reporting_machine_entitlements_set_updated_at
before update on public.reporting_machine_entitlements
for each row execute function public.set_updated_at();

create table if not exists public.sales_import_runs (
  id uuid primary key default gen_random_uuid(),
  source text not null
    check (source in ('manual_csv', 'google_sheets_refunds', 'sunze_browser', 'sample_seed')),
  status text not null default 'pending'
    check (status in ('pending', 'running', 'completed', 'failed')),
  source_reference text,
  rows_seen integer not null default 0 check (rows_seen >= 0),
  rows_imported integer not null default 0 check (rows_imported >= 0),
  rows_skipped integer not null default 0 check (rows_skipped >= 0),
  error_message text,
  meta jsonb not null default '{}'::jsonb,
  imported_by uuid references auth.users (id) on delete set null,
  started_at timestamptz not null default now(),
  completed_at timestamptz,
  created_at timestamptz not null default now()
);

create index if not exists sales_import_runs_source_created_at_idx
  on public.sales_import_runs (source, created_at desc);

create index if not exists sales_import_runs_status_created_at_idx
  on public.sales_import_runs (status, created_at desc);

create table if not exists public.machine_sales_facts (
  id uuid primary key default gen_random_uuid(),
  reporting_machine_id uuid not null references public.reporting_machines (id) on delete cascade,
  reporting_location_id uuid not null references public.reporting_locations (id) on delete cascade,
  sale_date date not null,
  payment_method text not null default 'unknown'
    check (payment_method in ('cash', 'credit', 'other', 'unknown')),
  net_sales_cents integer not null default 0 check (net_sales_cents >= 0),
  transaction_count integer not null default 0 check (transaction_count >= 0),
  source text not null
    check (source in ('manual_csv', 'sunze_browser', 'sample_seed')),
  source_row_hash text not null,
  import_run_id uuid references public.sales_import_runs (id) on delete set null,
  raw_payload jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint machine_sales_facts_hash_present check (length(trim(source_row_hash)) > 0)
);

create unique index if not exists machine_sales_facts_source_hash_idx
  on public.machine_sales_facts (source, source_row_hash);

create index if not exists machine_sales_facts_machine_date_idx
  on public.machine_sales_facts (reporting_machine_id, sale_date desc);

create index if not exists machine_sales_facts_location_date_idx
  on public.machine_sales_facts (reporting_location_id, sale_date desc);

create index if not exists machine_sales_facts_payment_method_idx
  on public.machine_sales_facts (payment_method, sale_date desc);

drop trigger if exists machine_sales_facts_set_updated_at on public.machine_sales_facts;
create trigger machine_sales_facts_set_updated_at
before update on public.machine_sales_facts
for each row execute function public.set_updated_at();

create table if not exists public.sales_adjustment_facts (
  id uuid primary key default gen_random_uuid(),
  reporting_machine_id uuid not null references public.reporting_machines (id) on delete cascade,
  reporting_location_id uuid not null references public.reporting_locations (id) on delete cascade,
  adjustment_date date not null,
  adjustment_type text not null default 'refund'
    check (adjustment_type in ('refund', 'complaint_refund', 'manual_adjustment')),
  amount_cents integer not null default 0 check (amount_cents >= 0),
  complaint_count integer not null default 0 check (complaint_count >= 0),
  source text not null
    check (source in ('google_sheets', 'manual')),
  source_row_hash text not null,
  import_run_id uuid references public.sales_import_runs (id) on delete set null,
  notes text,
  raw_payload jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint sales_adjustment_facts_hash_present check (length(trim(source_row_hash)) > 0)
);

create unique index if not exists sales_adjustment_facts_source_hash_idx
  on public.sales_adjustment_facts (source, source_row_hash);

create index if not exists sales_adjustment_facts_machine_date_idx
  on public.sales_adjustment_facts (reporting_machine_id, adjustment_date desc);

create index if not exists sales_adjustment_facts_location_date_idx
  on public.sales_adjustment_facts (reporting_location_id, adjustment_date desc);

drop trigger if exists sales_adjustment_facts_set_updated_at on public.sales_adjustment_facts;
create trigger sales_adjustment_facts_set_updated_at
before update on public.sales_adjustment_facts
for each row execute function public.set_updated_at();

create table if not exists public.report_view_snapshots (
  id uuid primary key default gen_random_uuid(),
  report_view_id uuid,
  created_by uuid references auth.users (id) on delete set null,
  title text not null default 'Sales report',
  filters jsonb not null default '{}'::jsonb,
  summary jsonb not null default '{}'::jsonb,
  export_storage_path text,
  export_status text not null default 'pending'
    check (export_status in ('pending', 'ready', 'failed')),
  error_message text,
  created_at timestamptz not null default now()
);

create index if not exists report_view_snapshots_created_by_created_at_idx
  on public.report_view_snapshots (created_by, created_at desc);

create table if not exists public.report_schedules (
  id uuid primary key default gen_random_uuid(),
  title text not null,
  schedule_kind text not null default 'weekly'
    check (schedule_kind in ('weekly', 'monthly')),
  timezone text not null default 'America/Los_Angeles',
  send_day_of_week integer not null default 1 check (send_day_of_week between 0 and 6),
  send_hour_local integer not null default 9 check (send_hour_local between 0 and 23),
  report_filters jsonb not null default '{}'::jsonb,
  active boolean not null default true,
  created_by uuid references auth.users (id) on delete set null,
  last_sent_at timestamptz,
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint report_schedules_title_present check (length(trim(title)) > 0)
);

create index if not exists report_schedules_active_idx
  on public.report_schedules (active, schedule_kind, send_day_of_week, send_hour_local);

drop trigger if exists report_schedules_set_updated_at on public.report_schedules;
create trigger report_schedules_set_updated_at
before update on public.report_schedules
for each row execute function public.set_updated_at();

create table if not exists public.report_schedule_recipients (
  id uuid primary key default gen_random_uuid(),
  schedule_id uuid not null references public.report_schedules (id) on delete cascade,
  email text not null,
  recipient_name text,
  partner_name text,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint report_schedule_recipients_email_present check (length(trim(email)) > 0)
);

create unique index if not exists report_schedule_recipients_active_email_idx
  on public.report_schedule_recipients (schedule_id, lower(email))
  where active;

create index if not exists report_schedule_recipients_schedule_id_idx
  on public.report_schedule_recipients (schedule_id);

drop trigger if exists report_schedule_recipients_set_updated_at on public.report_schedule_recipients;
create trigger report_schedule_recipients_set_updated_at
before update on public.report_schedule_recipients
for each row execute function public.set_updated_at();

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'sales-report-exports',
  'sales-report-exports',
  false,
  10485760,
  array['application/pdf']
)
on conflict (id) do update
set
  public = excluded.public,
  file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

create or replace function public.reporting_entitlement_is_active(
  starts_at timestamptz,
  expires_at timestamptz,
  revoked_at timestamptz
)
returns boolean
language sql
stable
as $$
  select revoked_at is null
    and starts_at <= now()
    and (expires_at is null or expires_at > now());
$$;

create or replace function public.is_reporting_account_member(
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
    and exists (
      select 1
      from public.customer_account_memberships membership
      where membership.user_id = p_user_id
        and membership.account_id = p_account_id
        and membership.active
        and membership.role in ('owner', 'account_admin', 'report_viewer', 'report_manager', 'partner_viewer')
    );
$$;

create or replace function public.has_reporting_machine_access(
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
    and (
      public.is_super_admin(p_user_id)
      or exists (
        select 1
        from public.reporting_machines machine
        where machine.id = p_machine_id
          and public.is_reporting_account_member(p_user_id, machine.account_id)
      )
      or exists (
        select 1
        from public.reporting_machines machine
        join public.reporting_machine_entitlements entitlement
          on entitlement.user_id = p_user_id
        where machine.id = p_machine_id
          and public.reporting_entitlement_is_active(
            entitlement.starts_at,
            entitlement.expires_at,
            entitlement.revoked_at
          )
          and (
            entitlement.machine_id = machine.id
            or entitlement.location_id = machine.location_id
            or entitlement.account_id = machine.account_id
          )
      )
    );
$$;

alter table public.customer_accounts enable row level security;
alter table public.customer_account_memberships enable row level security;
alter table public.reporting_locations enable row level security;
alter table public.reporting_machines enable row level security;
alter table public.reporting_machine_entitlements enable row level security;
alter table public.sales_import_runs enable row level security;
alter table public.machine_sales_facts enable row level security;
alter table public.sales_adjustment_facts enable row level security;
alter table public.report_view_snapshots enable row level security;
alter table public.report_schedules enable row level security;
alter table public.report_schedule_recipients enable row level security;

drop policy if exists "customer_accounts_select_reporting_related" on public.customer_accounts;
create policy "customer_accounts_select_reporting_related"
on public.customer_accounts
for select
using (
  public.is_super_admin((select auth.uid()))
  or public.is_reporting_account_member((select auth.uid()), id)
);

drop policy if exists "customer_account_memberships_select_related" on public.customer_account_memberships;
create policy "customer_account_memberships_select_related"
on public.customer_account_memberships
for select
using (
  user_id = (select auth.uid())
  or public.is_super_admin((select auth.uid()))
  or public.is_reporting_account_member((select auth.uid()), account_id)
);

drop policy if exists "reporting_locations_select_accessible" on public.reporting_locations;
create policy "reporting_locations_select_accessible"
on public.reporting_locations
for select
using (
  public.is_super_admin((select auth.uid()))
  or public.is_reporting_account_member((select auth.uid()), account_id)
  or exists (
    select 1
    from public.reporting_machines machine
    where machine.location_id = reporting_locations.id
      and public.has_reporting_machine_access((select auth.uid()), machine.id)
  )
);

drop policy if exists "reporting_machines_select_accessible" on public.reporting_machines;
create policy "reporting_machines_select_accessible"
on public.reporting_machines
for select
using (public.has_reporting_machine_access((select auth.uid()), id));

drop policy if exists "reporting_machine_entitlements_select_related" on public.reporting_machine_entitlements;
create policy "reporting_machine_entitlements_select_related"
on public.reporting_machine_entitlements
for select
using (
  user_id = (select auth.uid())
  or public.is_super_admin((select auth.uid()))
);

drop policy if exists "sales_import_runs_select_super_admin" on public.sales_import_runs;
create policy "sales_import_runs_select_super_admin"
on public.sales_import_runs
for select
using (public.is_super_admin((select auth.uid())));

drop policy if exists "machine_sales_facts_select_accessible" on public.machine_sales_facts;
create policy "machine_sales_facts_select_accessible"
on public.machine_sales_facts
for select
using (public.has_reporting_machine_access((select auth.uid()), reporting_machine_id));

drop policy if exists "sales_adjustment_facts_select_accessible" on public.sales_adjustment_facts;
create policy "sales_adjustment_facts_select_accessible"
on public.sales_adjustment_facts
for select
using (public.has_reporting_machine_access((select auth.uid()), reporting_machine_id));

drop policy if exists "report_view_snapshots_select_own_or_admin" on public.report_view_snapshots;
create policy "report_view_snapshots_select_own_or_admin"
on public.report_view_snapshots
for select
using (
  created_by = (select auth.uid())
  or public.is_super_admin((select auth.uid()))
);

drop policy if exists "report_schedules_select_super_admin" on public.report_schedules;
create policy "report_schedules_select_super_admin"
on public.report_schedules
for select
using (public.is_super_admin((select auth.uid())));

drop policy if exists "report_schedule_recipients_select_super_admin" on public.report_schedule_recipients;
create policy "report_schedule_recipients_select_super_admin"
on public.report_schedule_recipients
for select
using (public.is_super_admin((select auth.uid())));

drop policy if exists "sales_report_exports_read_super_admin" on storage.objects;
create policy "sales_report_exports_read_super_admin"
on storage.objects
for select
using (
  bucket_id = 'sales-report-exports'
  and public.is_super_admin((select auth.uid()))
);

drop function if exists public.get_my_reporting_access_context();
create or replace function public.get_my_reporting_access_context()
returns table (
  has_reporting_access boolean,
  accessible_machine_count bigint,
  accessible_location_count bigint,
  can_manage_reporting boolean,
  latest_sale_date date,
  latest_import_completed_at timestamptz
)
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  current_user_id uuid;
begin
  current_user_id := auth.uid();

  if current_user_id is null then
    raise exception 'Authentication required';
  end if;

  return query
  with accessible_machines as (
    select machine.id, machine.location_id
    from public.reporting_machines machine
    where public.has_reporting_machine_access(current_user_id, machine.id)
  )
  select
    exists (select 1 from accessible_machines) as has_reporting_access,
    (select count(*) from accessible_machines)::bigint as accessible_machine_count,
    (select count(distinct location_id) from accessible_machines)::bigint
      as accessible_location_count,
    public.is_super_admin(current_user_id) as can_manage_reporting,
    (
      select max(fact.sale_date)
      from public.machine_sales_facts fact
      join accessible_machines machine on machine.id = fact.reporting_machine_id
    ) as latest_sale_date,
    (
      select max(run.completed_at)
      from public.sales_import_runs run
      where run.status = 'completed'
    ) as latest_import_completed_at;
end;
$$;

drop function if exists public.get_reporting_dimensions();
create or replace function public.get_reporting_dimensions()
returns table (
  account_id uuid,
  account_name text,
  location_id uuid,
  location_name text,
  machine_id uuid,
  machine_label text,
  machine_type text,
  sunze_machine_id text,
  latest_sale_date date,
  status text
)
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  current_user_id uuid;
begin
  current_user_id := auth.uid();

  if current_user_id is null then
    raise exception 'Authentication required';
  end if;

  return query
  select
    account.id,
    account.name,
    location.id,
    location.name,
    machine.id,
    machine.machine_label,
    machine.machine_type,
    machine.sunze_machine_id,
    max(fact.sale_date) as latest_sale_date,
    machine.status
  from public.reporting_machines machine
  join public.reporting_locations location on location.id = machine.location_id
  join public.customer_accounts account on account.id = machine.account_id
  left join public.machine_sales_facts fact on fact.reporting_machine_id = machine.id
  where public.has_reporting_machine_access(current_user_id, machine.id)
  group by
    account.id,
    account.name,
    location.id,
    location.name,
    machine.id,
    machine.machine_label,
    machine.machine_type,
    machine.sunze_machine_id,
    machine.status
  order by account.name, location.name, machine.machine_label;
end;
$$;

drop function if exists public.get_sales_report(date, date, text, uuid[], uuid[], text[]);
create or replace function public.get_sales_report(
  p_date_from date,
  p_date_to date,
  p_grain text default 'week',
  p_machine_ids uuid[] default null,
  p_location_ids uuid[] default null,
  p_payment_methods text[] default null
)
returns table (
  period_start date,
  machine_id uuid,
  machine_label text,
  location_id uuid,
  location_name text,
  payment_method text,
  net_sales_cents bigint,
  refund_amount_cents bigint,
  gross_sales_cents bigint,
  transaction_count bigint
)
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  current_user_id uuid;
  normalized_grain text;
begin
  current_user_id := auth.uid();
  normalized_grain := lower(coalesce(nullif(trim(p_grain), ''), 'week'));

  if current_user_id is null then
    raise exception 'Authentication required';
  end if;

  if p_date_from is null or p_date_to is null then
    raise exception 'Date range is required';
  end if;

  if p_date_from > p_date_to then
    raise exception 'Date range is invalid';
  end if;

  if normalized_grain not in ('day', 'week', 'month') then
    raise exception 'Invalid report grain: %', p_grain;
  end if;

  return query
  with accessible_machines as (
    select
      machine.id as machine_id,
      machine.machine_label,
      machine.location_id,
      location.name as location_name
    from public.reporting_machines machine
    join public.reporting_locations location on location.id = machine.location_id
    where public.has_reporting_machine_access(current_user_id, machine.id)
      and (
        p_machine_ids is null
        or cardinality(p_machine_ids) = 0
        or machine.id = any(p_machine_ids)
      )
      and (
        p_location_ids is null
        or cardinality(p_location_ids) = 0
        or machine.location_id = any(p_location_ids)
      )
  ),
  sales_by_method as (
    select
      date_trunc(normalized_grain, fact.sale_date::timestamp)::date as period_start,
      fact.reporting_machine_id as machine_id,
      fact.reporting_location_id as location_id,
      fact.payment_method,
      sum(fact.net_sales_cents)::bigint as net_sales_cents,
      sum(fact.transaction_count)::bigint as transaction_count
    from public.machine_sales_facts fact
    join accessible_machines machine on machine.machine_id = fact.reporting_machine_id
    where fact.sale_date between p_date_from and p_date_to
      and (
        p_payment_methods is null
        or cardinality(p_payment_methods) = 0
        or fact.payment_method = any(p_payment_methods)
      )
    group by
      date_trunc(normalized_grain, fact.sale_date::timestamp)::date,
      fact.reporting_machine_id,
      fact.reporting_location_id,
      fact.payment_method
  ),
  sales_totals as (
    select
      method.period_start,
      method.machine_id,
      method.location_id,
      sum(method.net_sales_cents)::bigint as net_sales_cents
    from sales_by_method method
    group by method.period_start, method.machine_id, method.location_id
  ),
  adjustment_totals as (
    select
      date_trunc(normalized_grain, adjustment.adjustment_date::timestamp)::date as period_start,
      adjustment.reporting_machine_id as machine_id,
      adjustment.reporting_location_id as location_id,
      sum(adjustment.amount_cents)::bigint as refund_amount_cents
    from public.sales_adjustment_facts adjustment
    join accessible_machines machine on machine.machine_id = adjustment.reporting_machine_id
    where adjustment.adjustment_date between p_date_from and p_date_to
    group by
      date_trunc(normalized_grain, adjustment.adjustment_date::timestamp)::date,
      adjustment.reporting_machine_id,
      adjustment.reporting_location_id
  )
  select
    method.period_start,
    method.machine_id,
    machine.machine_label,
    method.location_id,
    machine.location_name,
    method.payment_method,
    method.net_sales_cents,
    case
      when coalesce(total.net_sales_cents, 0) > 0 then
        round(
          coalesce(adjustment.refund_amount_cents, 0)::numeric
          * method.net_sales_cents::numeric
          / total.net_sales_cents::numeric
        )::bigint
      else 0::bigint
    end as refund_amount_cents,
    (
      method.net_sales_cents
      + case
          when coalesce(total.net_sales_cents, 0) > 0 then
            round(
              coalesce(adjustment.refund_amount_cents, 0)::numeric
              * method.net_sales_cents::numeric
              / total.net_sales_cents::numeric
            )::bigint
          else 0::bigint
        end
    )::bigint as gross_sales_cents,
    method.transaction_count
  from sales_by_method method
  join accessible_machines machine on machine.machine_id = method.machine_id
  join sales_totals total
    on total.period_start = method.period_start
    and total.machine_id = method.machine_id
    and total.location_id = method.location_id
  left join adjustment_totals adjustment
    on adjustment.period_start = method.period_start
    and adjustment.machine_id = method.machine_id
    and adjustment.location_id = method.location_id
  order by method.period_start desc, machine.location_name, machine.machine_label, method.payment_method;
end;
$$;

drop function if exists public.create_report_export(uuid, jsonb);
create or replace function public.create_report_export(
  p_report_view_id uuid,
  p_filters jsonb
)
returns public.report_view_snapshots
language plpgsql
security definer
set search_path = public
as $$
declare
  current_user_id uuid;
  snapshot public.report_view_snapshots;
  normalized_filters jsonb;
  date_from date;
  date_to date;
  grain text;
  machine_ids uuid[];
  location_ids uuid[];
  payment_methods text[];
  summary jsonb;
begin
  current_user_id := auth.uid();

  if current_user_id is null then
    raise exception 'Authentication required';
  end if;

  normalized_filters := coalesce(p_filters, '{}'::jsonb);
  date_from := coalesce(nullif(normalized_filters ->> 'dateFrom', '')::date, current_date - 30);
  date_to := coalesce(nullif(normalized_filters ->> 'dateTo', '')::date, current_date);
  grain := coalesce(nullif(normalized_filters ->> 'grain', ''), 'week');

  select array_agg(value::uuid)
  into machine_ids
  from jsonb_array_elements_text(coalesce(normalized_filters -> 'machineIds', '[]'::jsonb)) as machine_value(value)
  where value ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$';

  select array_agg(value::uuid)
  into location_ids
  from jsonb_array_elements_text(coalesce(normalized_filters -> 'locationIds', '[]'::jsonb)) as location_value(value)
  where value ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$';

  select array_agg(lower(value))
  into payment_methods
  from jsonb_array_elements_text(coalesce(normalized_filters -> 'paymentMethods', '[]'::jsonb)) as payment_value(value)
  where lower(value) in ('cash', 'credit', 'other', 'unknown');

  with report_rows as (
    select *
    from public.get_sales_report(
      date_from,
      date_to,
      grain,
      machine_ids,
      location_ids,
      payment_methods
    )
  )
  select jsonb_build_object(
    'net_sales_cents', coalesce(sum(net_sales_cents), 0),
    'refund_amount_cents', coalesce(sum(refund_amount_cents), 0),
    'gross_sales_cents', coalesce(sum(gross_sales_cents), 0),
    'transaction_count', coalesce(sum(transaction_count), 0),
    'row_count', count(*)
  )
  into summary
  from report_rows;

  insert into public.report_view_snapshots (
    report_view_id,
    created_by,
    title,
    filters,
    summary,
    export_status
  )
  values (
    p_report_view_id,
    current_user_id,
    coalesce(nullif(trim(normalized_filters ->> 'title'), ''), 'Sales report'),
    normalized_filters,
    coalesce(summary, '{}'::jsonb),
    'pending'
  )
  returning * into snapshot;

  return snapshot;
end;
$$;

drop function if exists public.admin_upsert_reporting_machine(uuid, text, text, text, text, text, text);
create or replace function public.admin_upsert_reporting_machine(
  p_machine_id uuid,
  p_account_name text,
  p_location_name text,
  p_machine_label text,
  p_machine_type text,
  p_sunze_machine_id text,
  p_reason text
)
returns public.reporting_machines
language plpgsql
security definer
set search_path = public, auth
as $$
declare
  normalized_account_name text;
  normalized_location_name text;
  normalized_machine_label text;
  normalized_machine_type text;
  normalized_sunze_machine_id text;
  normalized_reason text;
  account_row public.customer_accounts;
  location_row public.reporting_locations;
  before_row public.reporting_machines;
  after_row public.reporting_machines;
begin
  if not public.is_super_admin(auth.uid()) then
    raise exception 'Admin access required';
  end if;

  normalized_account_name := trim(coalesce(p_account_name, ''));
  normalized_location_name := trim(coalesce(p_location_name, ''));
  normalized_machine_label := trim(coalesce(p_machine_label, ''));
  normalized_machine_type := lower(coalesce(nullif(trim(p_machine_type), ''), 'commercial'));
  normalized_sunze_machine_id := nullif(trim(coalesce(p_sunze_machine_id, '')), '');
  normalized_reason := trim(coalesce(p_reason, ''));

  if normalized_account_name = '' then
    raise exception 'Account name is required';
  end if;

  if normalized_location_name = '' then
    raise exception 'Location name is required';
  end if;

  if normalized_machine_label = '' then
    raise exception 'Machine label is required';
  end if;

  if normalized_machine_type not in ('commercial', 'mini', 'micro', 'unknown') then
    raise exception 'Invalid machine type';
  end if;

  if normalized_reason = '' then
    raise exception 'Update reason is required';
  end if;

  select *
  into account_row
  from public.customer_accounts account
  where lower(account.name) = lower(normalized_account_name)
  limit 1;

  if account_row.id is null then
    insert into public.customer_accounts (name, account_type, created_by)
    values (normalized_account_name, 'customer', auth.uid())
    returning * into account_row;
  end if;

  select *
  into location_row
  from public.reporting_locations location
  where location.account_id = account_row.id
    and lower(location.name) = lower(normalized_location_name)
  limit 1;

  if location_row.id is null then
    insert into public.reporting_locations (account_id, name)
    values (account_row.id, normalized_location_name)
    returning * into location_row;
  end if;

  if p_machine_id is not null then
    select *
    into before_row
    from public.reporting_machines machine
    where machine.id = p_machine_id
    limit 1;
  elsif normalized_sunze_machine_id is not null then
    select *
    into before_row
    from public.reporting_machines machine
    where lower(machine.sunze_machine_id) = lower(normalized_sunze_machine_id)
    limit 1;
  end if;

  if before_row.id is null then
    insert into public.reporting_machines (
      account_id,
      location_id,
      machine_label,
      machine_type,
      sunze_machine_id
    )
    values (
      account_row.id,
      location_row.id,
      normalized_machine_label,
      normalized_machine_type,
      normalized_sunze_machine_id
    )
    returning * into after_row;
  else
    update public.reporting_machines
    set
      account_id = account_row.id,
      location_id = location_row.id,
      machine_label = normalized_machine_label,
      machine_type = normalized_machine_type,
      sunze_machine_id = normalized_sunze_machine_id,
      status = 'active'
    where id = before_row.id
    returning * into after_row;
  end if;

  insert into public.admin_audit_log (
    actor_user_id,
    action,
    entity_type,
    entity_id,
    target_user_id,
    before,
    after,
    meta
  )
  values (
    auth.uid(),
    'reporting_machine.upserted',
    'reporting_machine',
    after_row.id::text,
    null,
    coalesce(to_jsonb(before_row), '{}'::jsonb),
    to_jsonb(after_row),
    jsonb_build_object('reason', normalized_reason)
  );

  return after_row;
end;
$$;

drop function if exists public.admin_grant_machine_report_access(text, uuid, uuid, uuid, text, text);
create or replace function public.admin_grant_machine_report_access(
  p_user_email text,
  p_account_id uuid,
  p_location_id uuid,
  p_machine_id uuid,
  p_access_level text,
  p_reason text
)
returns public.reporting_machine_entitlements
language plpgsql
security definer
set search_path = public, auth
as $$
declare
  normalized_email text;
  normalized_reason text;
  normalized_access_level text;
  target_user_id uuid;
  machine_row public.reporting_machines;
  entitlement_row public.reporting_machine_entitlements;
begin
  if not public.is_super_admin(auth.uid()) then
    raise exception 'Admin access required';
  end if;

  normalized_email := lower(trim(coalesce(p_user_email, '')));
  normalized_reason := trim(coalesce(p_reason, ''));
  normalized_access_level := lower(coalesce(nullif(trim(p_access_level), ''), 'viewer'));

  if normalized_email = '' then
    raise exception 'User email is required';
  end if;

  if normalized_access_level not in ('viewer', 'report_manager') then
    raise exception 'Invalid reporting access level';
  end if;

  if normalized_reason = '' then
    raise exception 'Grant reason is required';
  end if;

  if p_account_id is null and p_location_id is null and p_machine_id is null then
    raise exception 'A reporting scope is required';
  end if;

  select users.id
  into target_user_id
  from auth.users users
  where lower(users.email) = normalized_email
  limit 1;

  if target_user_id is null then
    raise exception 'No user found for email %', normalized_email;
  end if;

  if p_machine_id is not null then
    select *
    into machine_row
    from public.reporting_machines machine
    where machine.id = p_machine_id
    limit 1;

    if machine_row.id is null then
      raise exception 'Reporting machine not found';
    end if;
  end if;

  insert into public.reporting_machine_entitlements (
    user_id,
    account_id,
    location_id,
    machine_id,
    access_level,
    grant_reason,
    granted_by
  )
  values (
    target_user_id,
    coalesce(p_account_id, machine_row.account_id),
    coalesce(p_location_id, machine_row.location_id),
    p_machine_id,
    normalized_access_level,
    normalized_reason,
    auth.uid()
  )
  returning * into entitlement_row;

  insert into public.admin_audit_log (
    actor_user_id,
    action,
    entity_type,
    entity_id,
    target_user_id,
    before,
    after,
    meta
  )
  values (
    auth.uid(),
    'reporting_access.granted',
    'reporting_machine_entitlement',
    entitlement_row.id::text,
    target_user_id,
    '{}'::jsonb,
    to_jsonb(entitlement_row),
    jsonb_build_object(
      'email',
      normalized_email,
      'reason',
      normalized_reason,
      'access_level',
      normalized_access_level
    )
  );

  return entitlement_row;
end;
$$;

drop function if exists public.admin_create_report_schedule(text, jsonb, text[], integer, integer, text);
create or replace function public.admin_create_report_schedule(
  p_title text,
  p_report_filters jsonb,
  p_recipient_emails text[],
  p_day_of_week integer default 1,
  p_send_hour_local integer default 9,
  p_timezone text default 'America/Los_Angeles'
)
returns public.report_schedules
language plpgsql
security definer
set search_path = public, auth
as $$
declare
  normalized_title text;
  normalized_email text;
  schedule_row public.report_schedules;
begin
  if not public.is_super_admin(auth.uid()) then
    raise exception 'Admin access required';
  end if;

  normalized_title := trim(coalesce(p_title, ''));

  if normalized_title = '' then
    raise exception 'Schedule title is required';
  end if;

  if p_recipient_emails is null or cardinality(p_recipient_emails) = 0 then
    raise exception 'At least one recipient is required';
  end if;

  if p_day_of_week < 0 or p_day_of_week > 6 then
    raise exception 'Send day of week must be 0-6';
  end if;

  if p_send_hour_local < 0 or p_send_hour_local > 23 then
    raise exception 'Send hour must be 0-23';
  end if;

  insert into public.report_schedules (
    title,
    schedule_kind,
    timezone,
    send_day_of_week,
    send_hour_local,
    report_filters,
    created_by
  )
  values (
    normalized_title,
    'weekly',
    coalesce(nullif(trim(p_timezone), ''), 'America/Los_Angeles'),
    p_day_of_week,
    p_send_hour_local,
    coalesce(p_report_filters, '{}'::jsonb),
    auth.uid()
  )
  returning * into schedule_row;

  foreach normalized_email in array p_recipient_emails loop
    normalized_email := lower(trim(normalized_email));
    if normalized_email <> '' then
      insert into public.report_schedule_recipients (
        schedule_id,
        email
      )
      values (
        schedule_row.id,
        normalized_email
      )
      on conflict do nothing;
    end if;
  end loop;

  insert into public.admin_audit_log (
    actor_user_id,
    action,
    entity_type,
    entity_id,
    target_user_id,
    before,
    after,
    meta
  )
  values (
    auth.uid(),
    'report_schedule.created',
    'report_schedule',
    schedule_row.id::text,
    null,
    '{}'::jsonb,
    to_jsonb(schedule_row),
    jsonb_build_object('recipient_count', cardinality(p_recipient_emails))
  );

  return schedule_row;
end;
$$;

grant execute on function public.get_my_reporting_access_context() to authenticated;
grant execute on function public.get_reporting_dimensions() to authenticated;
grant execute on function public.get_sales_report(date, date, text, uuid[], uuid[], text[]) to authenticated;
grant execute on function public.create_report_export(uuid, jsonb) to authenticated;
grant execute on function public.admin_upsert_reporting_machine(uuid, text, text, text, text, text, text) to authenticated;
grant execute on function public.admin_grant_machine_report_access(text, uuid, uuid, uuid, text, text) to authenticated;
grant execute on function public.admin_create_report_schedule(text, jsonb, text[], integer, integer, text) to authenticated;

revoke execute on function public.reporting_entitlement_is_active(timestamptz, timestamptz, timestamptz) from public;
revoke execute on function public.is_reporting_account_member(uuid, uuid) from public;
revoke execute on function public.has_reporting_machine_access(uuid, uuid) from public;
