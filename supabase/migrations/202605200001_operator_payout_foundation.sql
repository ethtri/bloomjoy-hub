-- Operator payout foundation: right-sized timekeeping, payout policies,
-- compensation rules, payout review records, pay statements, and scoped access.

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'operator-pay-statements',
  'operator-pay-statements',
  false,
  10485760,
  array['application/pdf']
)
on conflict (id) do update
set
  public = excluded.public,
  file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

alter table public.customer_accounts
  add column if not exists payout_display_name text,
  add column if not exists payout_contact_email text,
  add column if not exists payout_address_line_1 text,
  add column if not exists payout_address_line_2 text,
  add column if not exists payout_city text,
  add column if not exists payout_state text,
  add column if not exists payout_postal_code text,
  add column if not exists payout_logo_storage_path text,
  add column if not exists default_pay_statement_label text not null default 'Pay Statement',
  add column if not exists pay_statement_footer_text text,
  add column if not exists default_worker_type text not null default 'contractor_1099',
  add column if not exists default_payout_policy_id uuid;

alter table public.customer_accounts
  drop constraint if exists customer_accounts_default_worker_type_check;

alter table public.customer_accounts
  add constraint customer_accounts_default_worker_type_check
  check (
    default_worker_type in (
      'contractor_1099',
      'employee_w2',
      'part_time_employee',
      'owner_operator',
      'partner',
      'other',
      'unspecified'
    )
  );

create table if not exists public.payout_policies (
  id uuid primary key default gen_random_uuid(),
  account_id uuid not null references public.customer_accounts (id) on delete cascade,
  name text not null,
  frequency text not null default 'monthly'
    check (frequency in ('weekly', 'biweekly', 'semimonthly', 'monthly')),
  period_anchor_type text not null default 'calendar'
    check (period_anchor_type in ('calendar', 'custom')),
  week_start_day integer not null default 1 check (week_start_day between 0 and 6),
  biweekly_anchor_date date,
  semimonthly_day_1 integer check (semimonthly_day_1 is null or semimonthly_day_1 between 1 and 31),
  semimonthly_day_2 integer check (semimonthly_day_2 is null or semimonthly_day_2 between 1 and 31),
  monthly_period_type text not null default 'calendar_month'
    check (monthly_period_type in ('calendar_month', 'custom_anchor')),
  submission_due_offset_days integer not null default 2 check (submission_due_offset_days between 0 and 31),
  grace_period_days integer not null default 0 check (grace_period_days between 0 and 31),
  lock_offset_days integer not null default 3 check (lock_offset_days between 0 and 31),
  target_payout_offset_days integer not null default 5 check (target_payout_offset_days between 0 and 45),
  rounding_rule text not null default 'round_up_60_minutes'
    check (rounding_rule in (
      'none',
      'round_up_15_minutes',
      'round_up_30_minutes',
      'round_up_60_minutes',
      'round_nearest_15_minutes',
      'round_nearest_30_minutes',
      'custom'
    )),
  review_model text not null default 'final_review_only'
    check (review_model in ('final_review_only', 'per_entry_approval', 'no_review_required')),
  reminder_enabled boolean not null default true,
  active boolean not null default true,
  created_by uuid references auth.users (id) on delete set null,
  updated_by uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint payout_policies_name_present check (length(trim(name)) > 0),
  constraint payout_policies_semimonthly_days_order check (
    semimonthly_day_1 is null
    or semimonthly_day_2 is null
    or semimonthly_day_1 < semimonthly_day_2
  )
);

create unique index if not exists payout_policies_account_active_name_idx
  on public.payout_policies (account_id, lower(name))
  where active;

create index if not exists payout_policies_account_idx
  on public.payout_policies (account_id, active);

drop trigger if exists payout_policies_set_updated_at on public.payout_policies;
create trigger payout_policies_set_updated_at
before update on public.payout_policies
for each row execute function public.set_updated_at();

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'customer_accounts_default_payout_policy_id_fkey'
      and conrelid = 'public.customer_accounts'::regclass
  ) then
    alter table public.customer_accounts
      add constraint customer_accounts_default_payout_policy_id_fkey
      foreign key (default_payout_policy_id)
      references public.payout_policies (id)
      on delete set null;
  end if;
end;
$$;

create table if not exists public.operator_payout_profiles (
  id uuid primary key default gen_random_uuid(),
  account_id uuid not null references public.customer_accounts (id) on delete cascade,
  user_id uuid not null references auth.users (id) on delete cascade,
  display_name text not null,
  worker_type text not null default 'contractor_1099'
    check (worker_type in (
      'contractor_1099',
      'employee_w2',
      'part_time_employee',
      'owner_operator',
      'partner',
      'other',
      'unspecified'
    )),
  status text not null default 'active'
    check (status in ('active', 'inactive')),
  payout_policy_id uuid references public.payout_policies (id) on delete set null,
  created_by uuid references auth.users (id) on delete set null,
  updated_by uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint operator_payout_profiles_display_name_present check (length(trim(display_name)) > 0)
);

create unique index if not exists operator_payout_profiles_account_user_idx
  on public.operator_payout_profiles (account_id, user_id);

create index if not exists operator_payout_profiles_user_idx
  on public.operator_payout_profiles (user_id, status);

create index if not exists operator_payout_profiles_account_idx
  on public.operator_payout_profiles (account_id, status);

drop trigger if exists operator_payout_profiles_set_updated_at
  on public.operator_payout_profiles;
create trigger operator_payout_profiles_set_updated_at
before update on public.operator_payout_profiles
for each row execute function public.set_updated_at();

create table if not exists public.operator_machine_assignments (
  id uuid primary key default gen_random_uuid(),
  operator_profile_id uuid not null references public.operator_payout_profiles (id) on delete cascade,
  account_id uuid not null references public.customer_accounts (id) on delete cascade,
  reporting_machine_id uuid not null references public.reporting_machines (id) on delete restrict,
  effective_start_date date not null default current_date,
  effective_end_date date,
  status text not null default 'active'
    check (status in ('active', 'revoked')),
  grant_reason text not null default 'Operator machine assignment',
  created_by uuid references auth.users (id) on delete set null,
  revoked_by uuid references auth.users (id) on delete set null,
  revoked_at timestamptz,
  revoke_reason text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint operator_machine_assignments_valid_window check (
    effective_end_date is null or effective_end_date >= effective_start_date
  ),
  constraint operator_machine_assignments_reason_present check (length(trim(grant_reason)) > 0),
  constraint operator_machine_assignments_revoke_reason_required check (
    revoked_at is null or length(trim(coalesce(revoke_reason, ''))) > 0
  )
);

create unique index if not exists operator_machine_assignments_active_machine_idx
  on public.operator_machine_assignments (operator_profile_id, reporting_machine_id)
  where status = 'active' and revoked_at is null;

create index if not exists operator_machine_assignments_profile_idx
  on public.operator_machine_assignments (operator_profile_id, status);

create index if not exists operator_machine_assignments_machine_idx
  on public.operator_machine_assignments (reporting_machine_id, status);

create index if not exists operator_machine_assignments_account_idx
  on public.operator_machine_assignments (account_id, status);

drop trigger if exists operator_machine_assignments_set_updated_at
  on public.operator_machine_assignments;
create trigger operator_machine_assignments_set_updated_at
before update on public.operator_machine_assignments
for each row execute function public.set_updated_at();

create table if not exists public.payout_periods (
  id uuid primary key default gen_random_uuid(),
  account_id uuid not null references public.customer_accounts (id) on delete cascade,
  payout_policy_id uuid not null references public.payout_policies (id) on delete restrict,
  period_start_date date not null,
  period_end_date date not null,
  submission_due_date date not null,
  lock_date date not null,
  target_payout_date date not null,
  status text not null default 'open'
    check (status in (
      'open',
      'grace_period',
      'locked',
      'review',
      'draft_payout',
      'finalized',
      'issued',
      'closed',
      'reopened',
      'voided'
    )),
  locked_at timestamptz,
  locked_by uuid references auth.users (id) on delete set null,
  reopened_at timestamptz,
  reopened_by uuid references auth.users (id) on delete set null,
  reopen_reason text,
  created_by uuid references auth.users (id) on delete set null,
  updated_by uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint payout_periods_valid_window check (period_end_date >= period_start_date),
  constraint payout_periods_due_after_period check (submission_due_date >= period_end_date),
  constraint payout_periods_lock_after_due check (lock_date >= submission_due_date),
  constraint payout_periods_target_after_period check (target_payout_date >= period_end_date),
  constraint payout_periods_reopen_reason_required check (
    reopened_at is null or length(trim(coalesce(reopen_reason, ''))) > 0
  )
);

create unique index if not exists payout_periods_policy_window_idx
  on public.payout_periods (account_id, payout_policy_id, period_start_date, period_end_date);

create index if not exists payout_periods_account_status_idx
  on public.payout_periods (account_id, status, period_start_date desc);

drop trigger if exists payout_periods_set_updated_at on public.payout_periods;
create trigger payout_periods_set_updated_at
before update on public.payout_periods
for each row execute function public.set_updated_at();

create table if not exists public.time_entries (
  id uuid primary key default gen_random_uuid(),
  account_id uuid not null references public.customer_accounts (id) on delete cascade,
  operator_profile_id uuid not null references public.operator_payout_profiles (id) on delete restrict,
  reporting_machine_id uuid not null references public.reporting_machines (id) on delete restrict,
  reporting_location_id uuid not null references public.reporting_locations (id) on delete restrict,
  payout_policy_id uuid not null references public.payout_policies (id) on delete restrict,
  payout_period_id uuid not null references public.payout_periods (id) on delete restrict,
  work_date date not null,
  start_time time not null,
  end_time time not null,
  raw_duration_minutes integer not null default 0 check (raw_duration_minutes > 0),
  rounded_paid_minutes integer not null default 0 check (rounded_paid_minutes > 0),
  notes text,
  status text not null default 'submitted'
    check (status in ('draft', 'submitted', 'locked', 'included_in_payout', 'paid', 'voided')),
  created_by uuid references auth.users (id) on delete set null,
  updated_by uuid references auth.users (id) on delete set null,
  locked_at timestamptz,
  locked_by uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint time_entries_end_after_start check (end_time > start_time)
);

create index if not exists time_entries_profile_period_idx
  on public.time_entries (operator_profile_id, payout_period_id, work_date desc);

create index if not exists time_entries_machine_date_idx
  on public.time_entries (reporting_machine_id, work_date desc);

create index if not exists time_entries_period_status_idx
  on public.time_entries (payout_period_id, status);

drop trigger if exists time_entries_set_updated_at on public.time_entries;
create trigger time_entries_set_updated_at
before update on public.time_entries
for each row execute function public.set_updated_at();

create table if not exists public.compensation_rules (
  id uuid primary key default gen_random_uuid(),
  account_id uuid not null references public.customer_accounts (id) on delete cascade,
  operator_profile_id uuid references public.operator_payout_profiles (id) on delete cascade,
  reporting_machine_id uuid references public.reporting_machines (id) on delete cascade,
  hourly_rate_cents integer check (hourly_rate_cents is null or hourly_rate_cents >= 0),
  commission_basis_points integer check (
    commission_basis_points is null or commission_basis_points between 0 and 10000
  ),
  effective_start_date date not null,
  effective_end_date date,
  status text not null default 'active'
    check (status in ('active', 'inactive')),
  notes text,
  created_by uuid references auth.users (id) on delete set null,
  updated_by uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint compensation_rules_scope_present check (
    operator_profile_id is not null or reporting_machine_id is not null
  ),
  constraint compensation_rules_valid_window check (
    effective_end_date is null or effective_end_date >= effective_start_date
  )
);

create index if not exists compensation_rules_profile_effective_idx
  on public.compensation_rules (operator_profile_id, effective_start_date desc)
  where status = 'active';

create index if not exists compensation_rules_machine_effective_idx
  on public.compensation_rules (reporting_machine_id, effective_start_date desc)
  where status = 'active';

create index if not exists compensation_rules_account_idx
  on public.compensation_rules (account_id, status);

drop trigger if exists compensation_rules_set_updated_at on public.compensation_rules;
create trigger compensation_rules_set_updated_at
before update on public.compensation_rules
for each row execute function public.set_updated_at();

create table if not exists public.payout_runs (
  id uuid primary key default gen_random_uuid(),
  account_id uuid not null references public.customer_accounts (id) on delete cascade,
  payout_period_id uuid not null references public.payout_periods (id) on delete restrict,
  status text not null default 'draft'
    check (status in ('draft', 'review', 'finalized', 'issued', 'closed', 'reopened', 'voided')),
  total_raw_minutes integer not null default 0 check (total_raw_minutes >= 0),
  total_rounded_paid_minutes integer not null default 0 check (total_rounded_paid_minutes >= 0),
  total_hourly_pay_cents integer not null default 0 check (total_hourly_pay_cents >= 0),
  total_commission_pay_cents integer not null default 0 check (total_commission_pay_cents >= 0),
  total_adjustments_cents integer not null default 0,
  total_payout_cents integer not null default 0,
  notes text,
  warnings jsonb not null default '[]'::jsonb,
  created_by uuid references auth.users (id) on delete set null,
  finalized_by uuid references auth.users (id) on delete set null,
  issued_by uuid references auth.users (id) on delete set null,
  finalized_at timestamptz,
  issued_at timestamptz,
  reopened_at timestamptz,
  reopened_by uuid references auth.users (id) on delete set null,
  reopen_reason text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint payout_runs_reopen_reason_required check (
    reopened_at is null or length(trim(coalesce(reopen_reason, ''))) > 0
  )
);

create unique index if not exists payout_runs_period_active_idx
  on public.payout_runs (payout_period_id)
  where status <> 'voided';

create index if not exists payout_runs_account_status_idx
  on public.payout_runs (account_id, status, created_at desc);

drop trigger if exists payout_runs_set_updated_at on public.payout_runs;
create trigger payout_runs_set_updated_at
before update on public.payout_runs
for each row execute function public.set_updated_at();

create table if not exists public.payout_run_items (
  id uuid primary key default gen_random_uuid(),
  payout_run_id uuid not null references public.payout_runs (id) on delete cascade,
  account_id uuid not null references public.customer_accounts (id) on delete cascade,
  operator_profile_id uuid not null references public.operator_payout_profiles (id) on delete restrict,
  worker_type text not null
    check (worker_type in (
      'contractor_1099',
      'employee_w2',
      'part_time_employee',
      'owner_operator',
      'partner',
      'other',
      'unspecified'
    )),
  raw_minutes integer not null default 0 check (raw_minutes >= 0),
  rounded_paid_minutes integer not null default 0 check (rounded_paid_minutes >= 0),
  shift_count integer not null default 0 check (shift_count >= 0),
  hourly_rate_cents integer check (hourly_rate_cents is null or hourly_rate_cents >= 0),
  hourly_pay_cents integer not null default 0 check (hourly_pay_cents >= 0),
  eligible_net_revenue_cents integer not null default 0 check (eligible_net_revenue_cents >= 0),
  commission_basis_points integer check (
    commission_basis_points is null or commission_basis_points between 0 and 10000
  ),
  commission_pay_cents integer not null default 0 check (commission_pay_cents >= 0),
  adjustments_total_cents integer not null default 0,
  total_payout_cents integer not null default 0,
  status text not null default 'draft'
    check (status in ('draft', 'reviewed', 'finalized', 'issued', 'revised', 'voided')),
  warnings jsonb not null default '[]'::jsonb,
  calculation_notes jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index if not exists payout_run_items_run_operator_idx
  on public.payout_run_items (payout_run_id, operator_profile_id);

create index if not exists payout_run_items_operator_idx
  on public.payout_run_items (operator_profile_id, created_at desc);

drop trigger if exists payout_run_items_set_updated_at on public.payout_run_items;
create trigger payout_run_items_set_updated_at
before update on public.payout_run_items
for each row execute function public.set_updated_at();

create table if not exists public.payout_run_item_machines (
  id uuid primary key default gen_random_uuid(),
  payout_run_item_id uuid not null references public.payout_run_items (id) on delete cascade,
  reporting_machine_id uuid not null references public.reporting_machines (id) on delete restrict,
  reporting_location_id uuid not null references public.reporting_locations (id) on delete restrict,
  net_revenue_cents integer not null default 0,
  eligible_net_revenue_cents integer not null default 0 check (eligible_net_revenue_cents >= 0),
  commission_basis_points integer check (
    commission_basis_points is null or commission_basis_points between 0 and 10000
  ),
  commission_pay_cents integer not null default 0 check (commission_pay_cents >= 0),
  shift_count integer not null default 0 check (shift_count >= 0),
  raw_minutes integer not null default 0 check (raw_minutes >= 0),
  rounded_paid_minutes integer not null default 0 check (rounded_paid_minutes >= 0),
  included_in_commission_basis boolean not null default false,
  inclusion_reason text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index if not exists payout_run_item_machines_item_machine_idx
  on public.payout_run_item_machines (payout_run_item_id, reporting_machine_id);

create index if not exists payout_run_item_machines_machine_idx
  on public.payout_run_item_machines (reporting_machine_id);

drop trigger if exists payout_run_item_machines_set_updated_at
  on public.payout_run_item_machines;
create trigger payout_run_item_machines_set_updated_at
before update on public.payout_run_item_machines
for each row execute function public.set_updated_at();

create table if not exists public.payout_adjustments (
  id uuid primary key default gen_random_uuid(),
  payout_run_id uuid not null references public.payout_runs (id) on delete cascade,
  payout_run_item_id uuid references public.payout_run_items (id) on delete cascade,
  account_id uuid not null references public.customer_accounts (id) on delete cascade,
  operator_profile_id uuid not null references public.operator_payout_profiles (id) on delete restrict,
  amount_cents integer not null check (amount_cents <> 0),
  adjustment_type text not null default 'manual_adjustment'
    check (adjustment_type in (
      'manual_adjustment',
      'training_pay',
      'bonus',
      'reimbursement',
      'prior_period_correction',
      'service_visit',
      'cleaning_bonus',
      'travel_reimbursement',
      'commission_true_up',
      'deduction'
    )),
  description text not null,
  visible_to_operator boolean not null default true,
  created_by uuid references auth.users (id) on delete set null,
  updated_by uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint payout_adjustments_description_present check (length(trim(description)) > 0)
);

create index if not exists payout_adjustments_run_idx
  on public.payout_adjustments (payout_run_id, created_at desc);

create index if not exists payout_adjustments_operator_idx
  on public.payout_adjustments (operator_profile_id, created_at desc);

drop trigger if exists payout_adjustments_set_updated_at on public.payout_adjustments;
create trigger payout_adjustments_set_updated_at
before update on public.payout_adjustments
for each row execute function public.set_updated_at();

create table if not exists public.pay_statements (
  id uuid primary key default gen_random_uuid(),
  payout_run_id uuid not null references public.payout_runs (id) on delete restrict,
  payout_run_item_id uuid not null references public.payout_run_items (id) on delete restrict,
  account_id uuid not null references public.customer_accounts (id) on delete cascade,
  operator_profile_id uuid not null references public.operator_payout_profiles (id) on delete restrict,
  statement_number text not null,
  statement_label text not null default 'Pay Statement',
  status text not null default 'draft'
    check (status in ('draft', 'issued', 'revised', 'voided')),
  version integer not null default 1 check (version > 0),
  storage_bucket text not null default 'operator-pay-statements',
  storage_path text,
  issued_at timestamptz,
  emailed_at timestamptz,
  revised_from_statement_id uuid references public.pay_statements (id) on delete set null,
  revision_reason text,
  created_by uuid references auth.users (id) on delete set null,
  updated_by uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint pay_statements_number_present check (length(trim(statement_number)) > 0),
  constraint pay_statements_label_present check (length(trim(statement_label)) > 0),
  constraint pay_statements_storage_path_present_when_issued check (
    status not in ('issued', 'revised')
    or length(trim(coalesce(storage_path, ''))) > 0
  ),
  constraint pay_statements_revision_reason_required check (
    status <> 'revised'
    or length(trim(coalesce(revision_reason, ''))) > 0
  )
);

create unique index if not exists pay_statements_statement_number_idx
  on public.pay_statements (account_id, lower(statement_number));

create unique index if not exists pay_statements_item_version_idx
  on public.pay_statements (payout_run_item_id, version);

create index if not exists pay_statements_operator_status_idx
  on public.pay_statements (operator_profile_id, status, issued_at desc);

create index if not exists pay_statements_storage_idx
  on public.pay_statements (storage_bucket, storage_path)
  where storage_path is not null;

drop trigger if exists pay_statements_set_updated_at on public.pay_statements;
create trigger pay_statements_set_updated_at
before update on public.pay_statements
for each row execute function public.set_updated_at();

create table if not exists public.payroll_provider_sync_records (
  id uuid primary key default gen_random_uuid(),
  account_id uuid not null references public.customer_accounts (id) on delete cascade,
  provider text not null,
  object_type text not null,
  object_id text,
  local_table text not null,
  local_id uuid not null,
  status text not null default 'pending'
    check (status in ('pending', 'synced', 'failed', 'skipped')),
  last_synced_at timestamptz,
  error_message text,
  redacted_meta jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint payroll_provider_sync_records_provider_present check (length(trim(provider)) > 0),
  constraint payroll_provider_sync_records_object_type_present check (length(trim(object_type)) > 0),
  constraint payroll_provider_sync_records_local_table_present check (length(trim(local_table)) > 0)
);

create unique index if not exists payroll_provider_sync_records_local_idx
  on public.payroll_provider_sync_records (provider, local_table, local_id, object_type);

create index if not exists payroll_provider_sync_records_account_idx
  on public.payroll_provider_sync_records (account_id, status, created_at desc);

drop trigger if exists payroll_provider_sync_records_set_updated_at
  on public.payroll_provider_sync_records;
create trigger payroll_provider_sync_records_set_updated_at
before update on public.payroll_provider_sync_records
for each row execute function public.set_updated_at();

create or replace function public.round_operator_payout_minutes(
  p_raw_duration_minutes integer,
  p_rounding_rule text
)
returns integer
language sql
immutable
set search_path = public
as $$
  select case lower(coalesce(nullif(trim(p_rounding_rule), ''), 'round_up_60_minutes'))
    when 'none' then greatest(coalesce(p_raw_duration_minutes, 0), 0)
    when 'round_up_15_minutes' then ((greatest(coalesce(p_raw_duration_minutes, 0), 0) + 14) / 15) * 15
    when 'round_up_30_minutes' then ((greatest(coalesce(p_raw_duration_minutes, 0), 0) + 29) / 30) * 30
    when 'round_up_60_minutes' then ((greatest(coalesce(p_raw_duration_minutes, 0), 0) + 59) / 60) * 60
    when 'round_nearest_15_minutes' then (round(greatest(coalesce(p_raw_duration_minutes, 0), 0)::numeric / 15) * 15)::integer
    when 'round_nearest_30_minutes' then (round(greatest(coalesce(p_raw_duration_minutes, 0), 0)::numeric / 30) * 30)::integer
    else greatest(coalesce(p_raw_duration_minutes, 0), 0)
  end;
$$;

create or replace function public.can_manage_operator_payout_account(
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
      or exists (
        select 1
        from public.customer_account_memberships membership
        where membership.user_id = p_user_id
          and membership.account_id = p_account_id
          and membership.active
          and membership.role in ('owner', 'account_admin', 'report_manager')
      )
      or exists (
        select 1
        from public.admin_scoped_access_grants grant_row
        join public.admin_scoped_access_scopes scope_row
          on scope_row.grant_id = grant_row.id
        where grant_row.user_id = p_user_id
          and grant_row.role = 'scoped_admin'
          and public.admin_scoped_grant_is_active(
            grant_row.starts_at,
            grant_row.expires_at,
            grant_row.revoked_at
          )
          and scope_row.scope_type = 'account'
          and scope_row.account_id = p_account_id
          and scope_row.revoked_at is null
      )
    );
$$;

create or replace function public.can_manage_operator_payout_account_current_user(
  p_account_id uuid
)
returns boolean
language sql
stable
security definer
set search_path = public, auth
as $$
  select public.can_manage_operator_payout_account((select auth.uid()), p_account_id);
$$;

create or replace function public.can_manage_operator_payout_machine(
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
      or p_machine_id = any(coalesce(public.scoped_admin_machine_ids(p_user_id), '{}'::uuid[]))
      or exists (
        select 1
        from public.reporting_machine_refund_managers manager
        where manager.reporting_machine_id = p_machine_id
          and manager.manager_user_id = p_user_id
          and manager.status = 'active'
          and manager.revoked_at is null
      )
      or exists (
        select 1
        from public.reporting_machines machine
        join public.customer_account_memberships membership
          on membership.account_id = machine.account_id
        where machine.id = p_machine_id
          and membership.user_id = p_user_id
          and membership.active
          and membership.role in ('owner', 'account_admin', 'report_manager')
      )
      or exists (
        select 1
        from public.reporting_machines machine
        join public.reporting_machine_entitlements entitlement
          on entitlement.user_id = p_user_id
        where machine.id = p_machine_id
          and entitlement.access_level = 'report_manager'
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

create or replace function public.can_manage_operator_payout_machine_current_user(
  p_machine_id uuid
)
returns boolean
language sql
stable
security definer
set search_path = public, auth
as $$
  select public.can_manage_operator_payout_machine((select auth.uid()), p_machine_id);
$$;

create or replace function public.can_access_operator_payout_profile(
  p_user_id uuid,
  p_operator_profile_id uuid
)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select p_user_id is not null
    and p_operator_profile_id is not null
    and (
      public.is_super_admin(p_user_id)
      or exists (
        select 1
        from public.operator_payout_profiles profile
        where profile.id = p_operator_profile_id
          and profile.user_id = p_user_id
      )
      or exists (
        select 1
        from public.operator_payout_profiles profile
        where profile.id = p_operator_profile_id
          and public.can_manage_operator_payout_account(p_user_id, profile.account_id)
      )
      or exists (
        select 1
        from public.operator_machine_assignments assignment
        where assignment.operator_profile_id = p_operator_profile_id
          and assignment.status = 'active'
          and assignment.revoked_at is null
          and public.can_manage_operator_payout_machine(p_user_id, assignment.reporting_machine_id)
      )
    );
$$;

create or replace function public.can_access_operator_payout_profile_current_user(
  p_operator_profile_id uuid
)
returns boolean
language sql
stable
security definer
set search_path = public, auth
as $$
  select public.can_access_operator_payout_profile((select auth.uid()), p_operator_profile_id);
$$;

create or replace function public.can_submit_operator_time_entry(
  p_user_id uuid,
  p_operator_profile_id uuid,
  p_machine_id uuid,
  p_work_date date,
  p_payout_period_id uuid,
  p_status text
)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select p_user_id is not null
    and p_operator_profile_id is not null
    and p_machine_id is not null
    and p_work_date is not null
    and p_payout_period_id is not null
    and lower(coalesce(p_status, '')) in ('draft', 'submitted')
    and exists (
      select 1
      from public.operator_payout_profiles profile
      where profile.id = p_operator_profile_id
        and profile.user_id = p_user_id
        and profile.status = 'active'
    )
    and exists (
      select 1
      from public.operator_machine_assignments assignment
      where assignment.operator_profile_id = p_operator_profile_id
        and assignment.reporting_machine_id = p_machine_id
        and assignment.status = 'active'
        and assignment.revoked_at is null
        and assignment.effective_start_date <= p_work_date
        and (
          assignment.effective_end_date is null
          or assignment.effective_end_date >= p_work_date
        )
    )
    and exists (
      select 1
      from public.payout_periods period
      where period.id = p_payout_period_id
        and period.status in ('open', 'grace_period', 'reopened')
        and p_work_date between period.period_start_date and period.period_end_date
    );
$$;

create or replace function public.can_submit_operator_time_entry_current_user(
  p_operator_profile_id uuid,
  p_machine_id uuid,
  p_work_date date,
  p_payout_period_id uuid,
  p_status text
)
returns boolean
language sql
stable
security definer
set search_path = public, auth
as $$
  select public.can_submit_operator_time_entry(
    (select auth.uid()),
    p_operator_profile_id,
    p_machine_id,
    p_work_date,
    p_payout_period_id,
    p_status
  );
$$;

create or replace function public.can_access_payout_run(
  p_user_id uuid,
  p_payout_run_id uuid
)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select p_user_id is not null
    and p_payout_run_id is not null
    and (
      public.is_super_admin(p_user_id)
      or exists (
        select 1
        from public.payout_runs run
        where run.id = p_payout_run_id
          and public.can_manage_operator_payout_account(p_user_id, run.account_id)
      )
      or exists (
        select 1
        from public.payout_runs run
        join public.payout_run_items item on item.payout_run_id = run.id
        join public.operator_payout_profiles profile on profile.id = item.operator_profile_id
        where run.id = p_payout_run_id
          and run.status in ('issued', 'closed')
          and profile.user_id = p_user_id
      )
      or exists (
        select 1
        from public.payout_run_items item
        join public.payout_run_item_machines item_machine
          on item_machine.payout_run_item_id = item.id
        where item.payout_run_id = p_payout_run_id
          and public.can_manage_operator_payout_machine(
            p_user_id,
            item_machine.reporting_machine_id
          )
      )
    );
$$;

create or replace function public.can_access_payout_run_current_user(
  p_payout_run_id uuid
)
returns boolean
language sql
stable
security definer
set search_path = public, auth
as $$
  select public.can_access_payout_run((select auth.uid()), p_payout_run_id);
$$;

create or replace function public.can_access_payout_run_item(
  p_user_id uuid,
  p_payout_run_item_id uuid
)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select p_user_id is not null
    and p_payout_run_item_id is not null
    and (
      public.is_super_admin(p_user_id)
      or exists (
        select 1
        from public.payout_run_items item
        join public.payout_runs run on run.id = item.payout_run_id
        join public.operator_payout_profiles profile on profile.id = item.operator_profile_id
        where item.id = p_payout_run_item_id
          and run.status in ('issued', 'closed')
          and profile.user_id = p_user_id
      )
      or exists (
        select 1
        from public.payout_run_items item
        where item.id = p_payout_run_item_id
          and public.can_manage_operator_payout_account(p_user_id, item.account_id)
      )
      or exists (
        select 1
        from public.payout_run_item_machines item_machine
        where item_machine.payout_run_item_id = p_payout_run_item_id
          and public.can_manage_operator_payout_machine(
            p_user_id,
            item_machine.reporting_machine_id
          )
      )
    );
$$;

create or replace function public.can_access_payout_run_item_current_user(
  p_payout_run_item_id uuid
)
returns boolean
language sql
stable
security definer
set search_path = public, auth
as $$
  select public.can_access_payout_run_item((select auth.uid()), p_payout_run_item_id);
$$;

create or replace function public.can_access_pay_statement(
  p_user_id uuid,
  p_pay_statement_id uuid
)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select p_user_id is not null
    and p_pay_statement_id is not null
    and exists (
      select 1
      from public.pay_statements statement
      join public.operator_payout_profiles profile
        on profile.id = statement.operator_profile_id
      where statement.id = p_pay_statement_id
        and (
          (
            profile.user_id = p_user_id
            and statement.status in ('issued', 'revised')
          )
          or public.can_manage_operator_payout_account(p_user_id, statement.account_id)
          or public.can_access_payout_run_item(p_user_id, statement.payout_run_item_id)
        )
    );
$$;

create or replace function public.can_access_pay_statement_current_user(
  p_pay_statement_id uuid
)
returns boolean
language sql
stable
security definer
set search_path = public, auth
as $$
  select public.can_access_pay_statement((select auth.uid()), p_pay_statement_id);
$$;

create or replace function public.set_operator_time_entry_durations()
returns trigger
language plpgsql
security definer
set search_path = public, auth
as $$
declare
  machine_row public.reporting_machines;
  profile_row public.operator_payout_profiles;
  policy_row public.payout_policies;
  period_row public.payout_periods;
begin
  if new.end_time <= new.start_time then
    raise exception 'End time must be after start time';
  end if;

  select *
  into profile_row
  from public.operator_payout_profiles profile
  where profile.id = new.operator_profile_id
  limit 1;

  if profile_row.id is null then
    raise exception 'Operator payout profile not found';
  end if;

  select *
  into machine_row
  from public.reporting_machines machine
  where machine.id = new.reporting_machine_id
  limit 1;

  if machine_row.id is null then
    raise exception 'Reporting machine not found';
  end if;

  if machine_row.account_id <> profile_row.account_id then
    raise exception 'Operator and machine must belong to the same account';
  end if;

  select *
  into period_row
  from public.payout_periods period
  where period.id = new.payout_period_id
  limit 1;

  if period_row.id is null then
    raise exception 'Payout period not found';
  end if;

  if new.work_date < period_row.period_start_date
    or new.work_date > period_row.period_end_date then
    raise exception 'Work date must fall inside the payout period';
  end if;

  if period_row.status not in ('open', 'grace_period', 'reopened') then
    raise exception 'Payout period is locked for operator time entry';
  end if;

  if not exists (
    select 1
    from public.operator_machine_assignments assignment
    where assignment.operator_profile_id = new.operator_profile_id
      and assignment.reporting_machine_id = new.reporting_machine_id
      and assignment.status = 'active'
      and assignment.revoked_at is null
      and assignment.effective_start_date <= new.work_date
      and (
        assignment.effective_end_date is null
        or assignment.effective_end_date >= new.work_date
      )
  ) then
    raise exception 'Operator is not assigned to this machine for the work date';
  end if;

  select *
  into policy_row
  from public.payout_policies policy
  where policy.id = new.payout_policy_id
  limit 1;

  if policy_row.id is null then
    raise exception 'Payout policy not found';
  end if;

  if policy_row.account_id <> profile_row.account_id
    or period_row.account_id <> profile_row.account_id
    or period_row.payout_policy_id <> policy_row.id then
    raise exception 'Time entry payout policy, period, operator, and machine must share the same account';
  end if;

  new.account_id := profile_row.account_id;
  new.reporting_location_id := machine_row.location_id;
  new.raw_duration_minutes := (
    extract(epoch from (new.end_time - new.start_time)) / 60
  )::integer;
  new.rounded_paid_minutes := public.round_operator_payout_minutes(
    new.raw_duration_minutes,
    policy_row.rounding_rule
  );

  if new.created_by is null then
    new.created_by := auth.uid();
  end if;

  new.updated_by := auth.uid();

  return new;
end;
$$;

drop trigger if exists time_entries_set_operator_durations on public.time_entries;
create trigger time_entries_set_operator_durations
before insert or update on public.time_entries
for each row execute function public.set_operator_time_entry_durations();

create or replace function public.ensure_default_operator_payout_policy(
  p_account_id uuid
)
returns public.payout_policies
language plpgsql
security definer
set search_path = public, auth
as $$
declare
  actor_user_id uuid;
  account_row public.customer_accounts;
  policy_row public.payout_policies;
begin
  actor_user_id := auth.uid();

  if actor_user_id is null then
    raise exception 'Authentication required';
  end if;

  if not public.can_manage_operator_payout_account(actor_user_id, p_account_id) then
    raise exception 'Operator payout setup access required';
  end if;

  select *
  into account_row
  from public.customer_accounts account
  where account.id = p_account_id
  limit 1;

  if account_row.id is null then
    raise exception 'Account not found';
  end if;

  select *
  into policy_row
  from public.payout_policies policy
  where policy.id = account_row.default_payout_policy_id
    and policy.active
  limit 1;

  if policy_row.id is not null then
    return policy_row;
  end if;

  select *
  into policy_row
  from public.payout_policies policy
  where policy.account_id = account_row.id
    and policy.active
    and lower(policy.name) = 'monthly operator payouts'
  limit 1;

  if policy_row.id is null then
    insert into public.payout_policies (
      account_id,
      name,
      frequency,
      period_anchor_type,
      monthly_period_type,
      submission_due_offset_days,
      grace_period_days,
      lock_offset_days,
      target_payout_offset_days,
      rounding_rule,
      review_model,
      reminder_enabled,
      created_by,
      updated_by
    )
    values (
      account_row.id,
      'Monthly operator payouts',
      'monthly',
      'calendar',
      'calendar_month',
      2,
      0,
      3,
      5,
      'round_up_60_minutes',
      'final_review_only',
      true,
      actor_user_id,
      actor_user_id
    )
    returning * into policy_row;
  end if;

  update public.customer_accounts
  set default_payout_policy_id = policy_row.id
  where id = account_row.id
    and default_payout_policy_id is distinct from policy_row.id;

  insert into public.admin_audit_log (
    actor_user_id,
    action,
    entity_type,
    entity_id,
    before,
    after,
    meta
  )
  values (
    actor_user_id,
    'operator_payout_policy.default_ensured',
    'payout_policy',
    policy_row.id::text,
    '{}'::jsonb,
    to_jsonb(policy_row),
    jsonb_build_object(
      'account_id', account_row.id,
      'right_sized_default', true
    )
  );

  return policy_row;
end;
$$;

create or replace function public.admin_upsert_operator_payout_profile(
  p_user_email text,
  p_account_id uuid,
  p_display_name text,
  p_worker_type text,
  p_payout_policy_id uuid,
  p_reason text
)
returns public.operator_payout_profiles
language plpgsql
security definer
set search_path = public, auth
as $$
declare
  actor_user_id uuid;
  normalized_email text;
  normalized_display_name text;
  normalized_worker_type text;
  normalized_reason text;
  target_user_id uuid;
  account_row public.customer_accounts;
  policy_row public.payout_policies;
  before_row public.operator_payout_profiles;
  after_row public.operator_payout_profiles;
begin
  actor_user_id := auth.uid();
  normalized_email := lower(trim(coalesce(p_user_email, '')));
  normalized_display_name := trim(coalesce(p_display_name, ''));
  normalized_reason := trim(coalesce(p_reason, ''));

  if actor_user_id is null then
    raise exception 'Authentication required';
  end if;

  if normalized_email = '' then
    raise exception 'Operator email is required';
  end if;

  if normalized_display_name = '' then
    normalized_display_name := normalized_email;
  end if;

  if normalized_reason = '' then
    raise exception 'Operator payout profile update reason is required';
  end if;

  if not public.can_manage_operator_payout_account(actor_user_id, p_account_id) then
    raise exception 'Operator payout setup access required';
  end if;

  select *
  into account_row
  from public.customer_accounts account
  where account.id = p_account_id
  limit 1;

  if account_row.id is null then
    raise exception 'Account not found';
  end if;

  normalized_worker_type := lower(coalesce(nullif(trim(p_worker_type), ''), account_row.default_worker_type));

  if normalized_worker_type not in (
    'contractor_1099',
    'employee_w2',
    'part_time_employee',
    'owner_operator',
    'partner',
    'other',
    'unspecified'
  ) then
    raise exception 'Invalid worker type';
  end if;

  select users.id
  into target_user_id
  from auth.users users
  where lower(users.email) = normalized_email
  limit 1;

  if target_user_id is null then
    raise exception 'No user found for email %', normalized_email;
  end if;

  if p_payout_policy_id is not null then
    select *
    into policy_row
    from public.payout_policies policy
    where policy.id = p_payout_policy_id
      and policy.account_id = account_row.id
      and policy.active
    limit 1;

    if policy_row.id is null then
      raise exception 'Payout policy not found for account';
    end if;
  else
    select *
    into policy_row
    from public.ensure_default_operator_payout_policy(account_row.id);
  end if;

  select *
  into before_row
  from public.operator_payout_profiles profile
  where profile.account_id = account_row.id
    and profile.user_id = target_user_id
  limit 1;

  insert into public.operator_payout_profiles (
    account_id,
    user_id,
    display_name,
    worker_type,
    status,
    payout_policy_id,
    created_by,
    updated_by
  )
  values (
    account_row.id,
    target_user_id,
    normalized_display_name,
    normalized_worker_type,
    'active',
    policy_row.id,
    actor_user_id,
    actor_user_id
  )
  on conflict (account_id, user_id)
  do update set
    display_name = excluded.display_name,
    worker_type = excluded.worker_type,
    status = 'active',
    payout_policy_id = excluded.payout_policy_id,
    updated_by = actor_user_id
  returning * into after_row;

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
    actor_user_id,
    case when before_row.id is null
      then 'operator_payout_profile.created'
      else 'operator_payout_profile.updated'
    end,
    'operator_payout_profile',
    after_row.id::text,
    target_user_id,
    coalesce(to_jsonb(before_row), '{}'::jsonb),
    to_jsonb(after_row),
    jsonb_build_object(
      'account_id', account_row.id,
      'email', normalized_email,
      'reason', normalized_reason,
      'tax_compliance_engine', false
    )
  );

  return after_row;
end;
$$;

create or replace function public.admin_set_operator_machine_assignments(
  p_operator_profile_id uuid,
  p_machine_ids uuid[],
  p_reason text
)
returns jsonb
language plpgsql
security definer
set search_path = public, auth
as $$
declare
  actor_user_id uuid;
  normalized_reason text;
  normalized_machine_ids uuid[];
  profile_row public.operator_payout_profiles;
  before_assignments jsonb;
  after_assignments jsonb;
  machine_count integer;
  manageable_count integer;
begin
  actor_user_id := auth.uid();
  normalized_reason := trim(coalesce(p_reason, ''));

  if actor_user_id is null then
    raise exception 'Authentication required';
  end if;

  if normalized_reason = '' then
    raise exception 'Assignment reason is required';
  end if;

  select *
  into profile_row
  from public.operator_payout_profiles profile
  where profile.id = p_operator_profile_id
  limit 1;

  if profile_row.id is null then
    raise exception 'Operator payout profile not found';
  end if;

  if not public.can_manage_operator_payout_account(actor_user_id, profile_row.account_id) then
    raise exception 'Operator payout setup access required';
  end if;

  select coalesce(array_agg(distinct machine_id), '{}'::uuid[])
  into normalized_machine_ids
  from unnest(coalesce(p_machine_ids, '{}'::uuid[])) as machine_ids(machine_id)
  where machine_id is not null;

  select count(*)
  into machine_count
  from public.reporting_machines machine
  where machine.id = any(normalized_machine_ids)
    and machine.account_id = profile_row.account_id;

  if machine_count <> cardinality(normalized_machine_ids) then
    raise exception 'Every assigned machine must exist in the operator account';
  end if;

  select count(*)
  into manageable_count
  from public.reporting_machines machine
  where machine.id = any(normalized_machine_ids)
    and public.can_manage_operator_payout_machine(actor_user_id, machine.id);

  if manageable_count <> cardinality(normalized_machine_ids) then
    raise exception 'Operator payout setup access is missing for one or more machines';
  end if;

  select count(*)
  into manageable_count
  from public.operator_machine_assignments assignment
  where assignment.operator_profile_id = profile_row.id
    and assignment.status = 'active'
    and assignment.revoked_at is null
    and public.can_manage_operator_payout_machine(actor_user_id, assignment.reporting_machine_id);

  select count(*)
  into machine_count
  from public.operator_machine_assignments assignment
  where assignment.operator_profile_id = profile_row.id
    and assignment.status = 'active'
    and assignment.revoked_at is null;

  if manageable_count <> machine_count then
    raise exception 'Existing out-of-scope assignments must be changed by a broader admin';
  end if;

  select coalesce(jsonb_agg(to_jsonb(assignment) order by assignment.created_at), '[]'::jsonb)
  into before_assignments
  from public.operator_machine_assignments assignment
  where assignment.operator_profile_id = profile_row.id
    and assignment.status = 'active'
    and assignment.revoked_at is null;

  update public.operator_machine_assignments assignment
  set
    status = 'revoked',
    effective_end_date = current_date,
    revoked_at = now(),
    revoked_by = actor_user_id,
    revoke_reason = normalized_reason
  where assignment.operator_profile_id = profile_row.id
    and assignment.status = 'active'
    and assignment.revoked_at is null
    and not (assignment.reporting_machine_id = any(normalized_machine_ids));

  insert into public.operator_machine_assignments (
    operator_profile_id,
    account_id,
    reporting_machine_id,
    effective_start_date,
    status,
    grant_reason,
    created_by
  )
  select
    profile_row.id,
    profile_row.account_id,
    machine_id,
    current_date,
    'active',
    normalized_reason,
    actor_user_id
  from unnest(normalized_machine_ids) as requested(machine_id)
  where not exists (
    select 1
    from public.operator_machine_assignments assignment
    where assignment.operator_profile_id = profile_row.id
      and assignment.reporting_machine_id = requested.machine_id
      and assignment.status = 'active'
      and assignment.revoked_at is null
  );

  select coalesce(jsonb_agg(to_jsonb(assignment) order by assignment.created_at), '[]'::jsonb)
  into after_assignments
  from public.operator_machine_assignments assignment
  where assignment.operator_profile_id = profile_row.id
    and assignment.status = 'active'
    and assignment.revoked_at is null;

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
    actor_user_id,
    'operator_machine_assignments.set',
    'operator_payout_profile',
    profile_row.id::text,
    profile_row.user_id,
    before_assignments,
    after_assignments,
    jsonb_build_object(
      'reason', normalized_reason,
      'account_id', profile_row.account_id,
      'requested_machine_count', cardinality(normalized_machine_ids)
    )
  );

  return jsonb_build_object(
    'operatorProfileId', profile_row.id,
    'activeAssignmentCount', jsonb_array_length(after_assignments),
    'assignments', after_assignments
  );
end;
$$;

create or replace function public.get_my_operator_payout_context()
returns jsonb
language plpgsql
stable
security definer
set search_path = public, auth
as $$
declare
  actor_user_id uuid;
  result jsonb;
begin
  actor_user_id := auth.uid();

  if actor_user_id is null then
    raise exception 'Authentication required';
  end if;

  select jsonb_build_object(
    'profiles', coalesce((
      select jsonb_agg(
        jsonb_build_object(
          'id', profile.id,
          'accountId', profile.account_id,
          'accountName', account.name,
          'displayName', profile.display_name,
          'workerType', profile.worker_type,
          'status', profile.status,
          'payoutPolicyId', profile.payout_policy_id,
          'assignedMachines', coalesce((
            select jsonb_agg(
              jsonb_build_object(
                'assignmentId', assignment.id,
                'machineId', machine.id,
                'machineLabel', machine.machine_label,
                'locationId', location.id,
                'locationName', location.name,
                'effectiveStartDate', assignment.effective_start_date,
                'effectiveEndDate', assignment.effective_end_date
              )
              order by location.name, machine.machine_label
            )
            from public.operator_machine_assignments assignment
            join public.reporting_machines machine on machine.id = assignment.reporting_machine_id
            join public.reporting_locations location on location.id = machine.location_id
            where assignment.operator_profile_id = profile.id
              and assignment.status = 'active'
              and assignment.revoked_at is null
          ), '[]'::jsonb),
          'issuedStatements', coalesce((
            select jsonb_agg(
              jsonb_build_object(
                'id', statement.id,
                'statementNumber', statement.statement_number,
                'statementLabel', statement.statement_label,
                'status', statement.status,
                'version', statement.version,
                'issuedAt', statement.issued_at,
                'storageBucket', statement.storage_bucket,
                'storagePath', statement.storage_path,
                'totalPayoutCents', item.total_payout_cents,
                'periodStartDate', period.period_start_date,
                'periodEndDate', period.period_end_date
              )
              order by statement.issued_at desc nulls last, statement.created_at desc
            )
            from public.pay_statements statement
            join public.payout_run_items item on item.id = statement.payout_run_item_id
            join public.payout_runs run on run.id = statement.payout_run_id
            join public.payout_periods period on period.id = run.payout_period_id
            where statement.operator_profile_id = profile.id
              and statement.status in ('issued', 'revised')
          ), '[]'::jsonb)
        )
        order by account.name, profile.display_name
      )
      from public.operator_payout_profiles profile
      join public.customer_accounts account on account.id = profile.account_id
      where profile.user_id = actor_user_id
        and profile.status = 'active'
    ), '[]'::jsonb)
  )
  into result;

  return result;
end;
$$;

do $$
declare
  account_row record;
  existing_policy_id uuid;
begin
  for account_row in
    select id
    from public.customer_accounts
    where account_type = 'internal'
      or lower(name) like '%bloomjoy%'
  loop
    select policy.id
    into existing_policy_id
    from public.payout_policies policy
    where policy.account_id = account_row.id
      and policy.active
      and lower(policy.name) = 'monthly operator payouts'
    limit 1;

    if existing_policy_id is null then
      insert into public.payout_policies (
        account_id,
        name,
        frequency,
        period_anchor_type,
        monthly_period_type,
        submission_due_offset_days,
        grace_period_days,
        lock_offset_days,
        target_payout_offset_days,
        rounding_rule,
        review_model,
        reminder_enabled
      )
      values (
        account_row.id,
        'Monthly operator payouts',
        'monthly',
        'calendar',
        'calendar_month',
        2,
        0,
        3,
        5,
        'round_up_60_minutes',
        'final_review_only',
        true
      )
      returning id into existing_policy_id;
    end if;

    update public.customer_accounts
    set default_payout_policy_id = existing_policy_id
    where id = account_row.id
      and default_payout_policy_id is null;
  end loop;
end;
$$;

alter table public.payout_policies enable row level security;
alter table public.operator_payout_profiles enable row level security;
alter table public.operator_machine_assignments enable row level security;
alter table public.payout_periods enable row level security;
alter table public.time_entries enable row level security;
alter table public.compensation_rules enable row level security;
alter table public.payout_runs enable row level security;
alter table public.payout_run_items enable row level security;
alter table public.payout_run_item_machines enable row level security;
alter table public.payout_adjustments enable row level security;
alter table public.pay_statements enable row level security;
alter table public.payroll_provider_sync_records enable row level security;

drop policy if exists "payout_policies_select_accessible" on public.payout_policies;
create policy "payout_policies_select_accessible"
on public.payout_policies
for select
using (
  public.can_manage_operator_payout_account_current_user(account_id)
  or exists (
    select 1
    from public.operator_payout_profiles profile
    where profile.account_id = payout_policies.account_id
      and profile.user_id = (select auth.uid())
      and profile.status = 'active'
  )
);

drop policy if exists "operator_payout_profiles_select_accessible"
  on public.operator_payout_profiles;
create policy "operator_payout_profiles_select_accessible"
on public.operator_payout_profiles
for select
using (public.can_access_operator_payout_profile_current_user(id));

drop policy if exists "operator_machine_assignments_select_accessible"
  on public.operator_machine_assignments;
create policy "operator_machine_assignments_select_accessible"
on public.operator_machine_assignments
for select
using (
  public.can_access_operator_payout_profile_current_user(operator_profile_id)
  or public.can_manage_operator_payout_machine_current_user(reporting_machine_id)
);

drop policy if exists "payout_periods_select_accessible" on public.payout_periods;
create policy "payout_periods_select_accessible"
on public.payout_periods
for select
using (
  public.can_manage_operator_payout_account_current_user(account_id)
  or exists (
    select 1
    from public.operator_payout_profiles profile
    where profile.account_id = payout_periods.account_id
      and profile.user_id = (select auth.uid())
      and profile.status = 'active'
  )
);

drop policy if exists "time_entries_select_accessible" on public.time_entries;
create policy "time_entries_select_accessible"
on public.time_entries
for select
using (
  public.can_access_operator_payout_profile_current_user(operator_profile_id)
  or public.can_manage_operator_payout_machine_current_user(reporting_machine_id)
);

drop policy if exists "time_entries_insert_own_assigned" on public.time_entries;
create policy "time_entries_insert_own_assigned"
on public.time_entries
for insert
with check (
  public.can_submit_operator_time_entry_current_user(
    operator_profile_id,
    reporting_machine_id,
    work_date,
    payout_period_id,
    status
  )
);

drop policy if exists "time_entries_update_own_unlocked" on public.time_entries;
create policy "time_entries_update_own_unlocked"
on public.time_entries
for update
using (
  locked_at is null
  and status in ('draft', 'submitted')
  and public.can_submit_operator_time_entry_current_user(
    operator_profile_id,
    reporting_machine_id,
    work_date,
    payout_period_id,
    status
  )
)
with check (
  locked_at is null
  and public.can_submit_operator_time_entry_current_user(
    operator_profile_id,
    reporting_machine_id,
    work_date,
    payout_period_id,
    status
  )
);

drop policy if exists "compensation_rules_select_manager" on public.compensation_rules;
create policy "compensation_rules_select_manager"
on public.compensation_rules
for select
using (
  public.can_manage_operator_payout_account_current_user(account_id)
  or (
    reporting_machine_id is not null
    and public.can_manage_operator_payout_machine_current_user(reporting_machine_id)
  )
);

drop policy if exists "payout_runs_select_accessible" on public.payout_runs;
create policy "payout_runs_select_accessible"
on public.payout_runs
for select
using (public.can_access_payout_run_current_user(id));

drop policy if exists "payout_run_items_select_accessible" on public.payout_run_items;
create policy "payout_run_items_select_accessible"
on public.payout_run_items
for select
using (public.can_access_payout_run_item_current_user(id));

drop policy if exists "payout_run_item_machines_select_accessible"
  on public.payout_run_item_machines;
create policy "payout_run_item_machines_select_accessible"
on public.payout_run_item_machines
for select
using (
  public.can_access_payout_run_item_current_user(payout_run_item_id)
  or public.can_manage_operator_payout_machine_current_user(reporting_machine_id)
);

drop policy if exists "payout_adjustments_select_accessible" on public.payout_adjustments;
create policy "payout_adjustments_select_accessible"
on public.payout_adjustments
for select
using (
  public.can_access_payout_run_current_user(payout_run_id)
  and (
    visible_to_operator
    or public.can_manage_operator_payout_account_current_user(account_id)
  )
);

drop policy if exists "pay_statements_select_accessible" on public.pay_statements;
create policy "pay_statements_select_accessible"
on public.pay_statements
for select
using (public.can_access_pay_statement_current_user(id));

drop policy if exists "payroll_provider_sync_records_select_super_admin"
  on public.payroll_provider_sync_records;
create policy "payroll_provider_sync_records_select_super_admin"
on public.payroll_provider_sync_records
for select
using (public.is_super_admin((select auth.uid())));

drop policy if exists "operator_pay_statement_objects_read_accessible" on storage.objects;
create policy "operator_pay_statement_objects_read_accessible"
on storage.objects
for select
to authenticated
using (
  bucket_id = 'operator-pay-statements'
  and exists (
    select 1
    from public.pay_statements statement
    where statement.storage_bucket = bucket_id
      and statement.storage_path = name
      and public.can_access_pay_statement_current_user(statement.id)
  )
);

revoke insert, update, delete on public.payout_policies from anon, authenticated;
revoke insert, update, delete on public.operator_payout_profiles from anon, authenticated;
revoke insert, update, delete on public.operator_machine_assignments from anon, authenticated;
revoke insert, update, delete on public.payout_periods from anon, authenticated;
revoke delete on public.time_entries from anon, authenticated;
revoke insert, update, delete on public.compensation_rules from anon, authenticated;
revoke insert, update, delete on public.payout_runs from anon, authenticated;
revoke insert, update, delete on public.payout_run_items from anon, authenticated;
revoke insert, update, delete on public.payout_run_item_machines from anon, authenticated;
revoke insert, update, delete on public.payout_adjustments from anon, authenticated;
revoke insert, update, delete on public.pay_statements from anon, authenticated;
revoke all on public.payroll_provider_sync_records from anon, authenticated;

grant select on public.payout_policies to authenticated;
grant select on public.operator_payout_profiles to authenticated;
grant select on public.operator_machine_assignments to authenticated;
grant select on public.payout_periods to authenticated;
grant select, insert, update on public.time_entries to authenticated;
grant select on public.compensation_rules to authenticated;
grant select on public.payout_runs to authenticated;
grant select on public.payout_run_items to authenticated;
grant select on public.payout_run_item_machines to authenticated;
grant select on public.payout_adjustments to authenticated;
grant select on public.pay_statements to authenticated;
grant select on public.payroll_provider_sync_records to authenticated;

comment on table public.operator_payout_profiles is
  'Entity-scoped operator payout profiles. Worker type is descriptive only and does not calculate tax withholding or replace legal/accounting review.';
comment on table public.payout_policies is
  'Payout schedule and review policy. Bloomjoy defaults to monthly calendar periods, shift-level round-up-to-hour time, and final manager review.';
comment on table public.time_entries is
  'Operator shift entries against assigned reporting machines. Rounded paid minutes are calculated per shift from the active payout policy.';
comment on table public.compensation_rules is
  'Effective-dated hourly and commission rules for operator payout calculations. Direct writes are intentionally RPC/service gated for auditability.';
comment on table public.pay_statements is
  'Issued operator pay statements backed by private storage. Statements are versioned and should not be silently overwritten after issuance.';
comment on table public.payroll_provider_sync_records is
  'Minimal provider-sync placeholder for a future payroll/payments provider decision. It stores redacted sync state only, not tax filings or direct-deposit instructions.';
comment on function public.round_operator_payout_minutes(integer, text) is
  'Rounds one shift duration according to a payout policy. Bloomjoy default is round_up_60_minutes, applied before monthly aggregation.';
comment on function public.can_manage_operator_payout_machine(uuid, uuid) is
  'Internal helper for payout manager authority against a reporting machine; arbitrary user-id checks are not exposed to browser callers.';
comment on function public.can_manage_operator_payout_machine_current_user(uuid) is
  'RLS helper for current-user payout manager authority against a reporting machine.';
comment on function public.can_access_operator_payout_profile(uuid, uuid) is
  'Internal helper for operator payout profile visibility by owner, scoped account manager, or assigned machine manager.';
comment on function public.can_access_operator_payout_profile_current_user(uuid) is
  'RLS helper for current-user operator payout profile visibility.';
comment on function public.can_submit_operator_time_entry(uuid, uuid, uuid, date, uuid, text) is
  'Internal helper for validating operator-owned time entry writes against active assignments and unlocked payout periods.';
comment on function public.can_submit_operator_time_entry_current_user(uuid, uuid, date, uuid, text) is
  'RLS helper for current-user operator-owned time entry writes.';
comment on function public.ensure_default_operator_payout_policy(uuid) is
  'Ensures an account has Bloomjoy-right-sized monthly operator payout defaults without creating a full payroll provider surface.';
comment on function public.admin_upsert_operator_payout_profile(text, uuid, text, text, uuid, text) is
  'Admin/scoped-manager RPC for creating or updating an operator payout profile with audit history and worker-type labeling.';
comment on function public.admin_set_operator_machine_assignments(uuid, uuid[], text) is
  'Admin/scoped-manager RPC for effective-dated operator machine assignments with audit history.';
comment on function public.get_my_operator_payout_context() is
  'Operator-facing payout context with assigned machines and issued statements only.';

revoke execute on function public.round_operator_payout_minutes(integer, text)
  from public, anon;
revoke execute on function public.can_manage_operator_payout_account(uuid, uuid)
  from public, anon, authenticated;
revoke execute on function public.can_manage_operator_payout_account_current_user(uuid)
  from public, anon;
revoke execute on function public.can_manage_operator_payout_machine(uuid, uuid)
  from public, anon, authenticated;
revoke execute on function public.can_manage_operator_payout_machine_current_user(uuid)
  from public, anon;
revoke execute on function public.can_access_operator_payout_profile(uuid, uuid)
  from public, anon, authenticated;
revoke execute on function public.can_access_operator_payout_profile_current_user(uuid)
  from public, anon;
revoke execute on function public.can_submit_operator_time_entry(uuid, uuid, uuid, date, uuid, text)
  from public, anon, authenticated;
revoke execute on function public.can_submit_operator_time_entry_current_user(uuid, uuid, date, uuid, text)
  from public, anon;
revoke execute on function public.can_access_payout_run(uuid, uuid)
  from public, anon, authenticated;
revoke execute on function public.can_access_payout_run_current_user(uuid)
  from public, anon;
revoke execute on function public.can_access_payout_run_item(uuid, uuid)
  from public, anon, authenticated;
revoke execute on function public.can_access_payout_run_item_current_user(uuid)
  from public, anon;
revoke execute on function public.can_access_pay_statement(uuid, uuid)
  from public, anon, authenticated;
revoke execute on function public.can_access_pay_statement_current_user(uuid)
  from public, anon;
revoke execute on function public.set_operator_time_entry_durations()
  from public, anon, authenticated;
revoke execute on function public.ensure_default_operator_payout_policy(uuid)
  from public, anon;
revoke execute on function public.admin_upsert_operator_payout_profile(text, uuid, text, text, uuid, text)
  from public, anon;
revoke execute on function public.admin_set_operator_machine_assignments(uuid, uuid[], text)
  from public, anon;
revoke execute on function public.get_my_operator_payout_context()
  from public, anon;

grant execute on function public.round_operator_payout_minutes(integer, text) to authenticated;
grant execute on function public.can_manage_operator_payout_account(uuid, uuid) to service_role;
grant execute on function public.can_manage_operator_payout_account_current_user(uuid) to authenticated;
grant execute on function public.can_manage_operator_payout_machine(uuid, uuid) to service_role;
grant execute on function public.can_manage_operator_payout_machine_current_user(uuid) to authenticated;
grant execute on function public.can_access_operator_payout_profile(uuid, uuid) to service_role;
grant execute on function public.can_access_operator_payout_profile_current_user(uuid) to authenticated;
grant execute on function public.can_submit_operator_time_entry(uuid, uuid, uuid, date, uuid, text) to service_role;
grant execute on function public.can_submit_operator_time_entry_current_user(uuid, uuid, date, uuid, text) to authenticated;
grant execute on function public.can_access_payout_run(uuid, uuid) to service_role;
grant execute on function public.can_access_payout_run_current_user(uuid) to authenticated;
grant execute on function public.can_access_payout_run_item(uuid, uuid) to service_role;
grant execute on function public.can_access_payout_run_item_current_user(uuid) to authenticated;
grant execute on function public.can_access_pay_statement(uuid, uuid) to service_role;
grant execute on function public.can_access_pay_statement_current_user(uuid) to authenticated;
grant execute on function public.set_operator_time_entry_durations() to service_role;
grant execute on function public.ensure_default_operator_payout_policy(uuid) to authenticated;
grant execute on function public.admin_upsert_operator_payout_profile(text, uuid, text, text, uuid, text)
  to authenticated;
grant execute on function public.admin_set_operator_machine_assignments(uuid, uuid[], text)
  to authenticated;
grant execute on function public.get_my_operator_payout_context() to authenticated;

select pg_notify('pgrst', 'reload schema');
