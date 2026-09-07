-- Canonical Timekeeping and contractor-compensation data rules.
--
-- This migration is deliberately additive. The older Operator Payout tables and
-- RPC signatures remain available while the technician calendar and manager
-- report move to this no-approval contract in subsequent slices.

create extension if not exists btree_gist with schema extensions;

alter table public.payout_policies
  alter column submission_due_offset_days set default 4,
  alter column lock_offset_days set default 4,
  alter column review_model set default 'no_review_required';

update public.payout_policies
set
  submission_due_offset_days = 4,
  lock_offset_days = 4,
  rounding_rule = 'round_up_60_minutes',
  review_model = 'no_review_required'
where active
  and frequency = 'monthly'
  and monthly_period_type = 'calendar_month';

alter table public.operator_payout_profiles
  add column if not exists worker_identifier text,
  add column if not exists position_title text not null default 'Technician';

alter table public.time_entries
  add column if not exists actual_start_at timestamptz,
  add column if not exists actual_end_at timestamptz,
  add column if not exists paid_shift_count integer;

update public.time_entries
set
  actual_start_at = (work_date::timestamp + start_time) at time zone 'America/Los_Angeles',
  actual_end_at = (work_date::timestamp + end_time) at time zone 'America/Los_Angeles',
  paid_shift_count = greatest(1, (raw_duration_minutes + 59) / 60)
where actual_start_at is null
   or actual_end_at is null
   or paid_shift_count is null;

alter table public.time_entries
  alter column actual_start_at set not null,
  alter column actual_end_at set not null,
  alter column paid_shift_count set not null,
  alter column paid_shift_count set default 1;

alter table public.time_entries
  drop constraint if exists time_entries_end_after_start;

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'time_entries_actual_end_after_start'
      and conrelid = 'public.time_entries'::regclass
  ) then
    alter table public.time_entries
      add constraint time_entries_actual_end_after_start
      check (actual_end_at > actual_start_at);
  end if;

  if not exists (
    select 1
    from pg_constraint
    where conname = 'time_entries_paid_shift_count_positive'
      and conrelid = 'public.time_entries'::regclass
  ) then
    alter table public.time_entries
      add constraint time_entries_paid_shift_count_positive
      check (paid_shift_count > 0);
  end if;
end;
$$;

create index if not exists time_entries_profile_actual_start_idx
  on public.time_entries (operator_profile_id, actual_start_at desc)
  where status <> 'voided';

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'time_entries_no_operator_overlap'
      and conrelid = 'public.time_entries'::regclass
  ) then
    alter table public.time_entries
      add constraint time_entries_no_operator_overlap
      exclude using gist (
        operator_profile_id with =,
        tstzrange(actual_start_at, actual_end_at, '[)') with &&
      )
      where (status <> 'voided')
      deferrable initially immediate;
  end if;
end;
$$;

-- Sequential assignment windows remain active historical facts. Revocation is
-- reserved for removing a grant, not for naturally ending an effective window.
drop index if exists public.operator_machine_assignments_active_machine_idx;

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'operator_machine_assignments_no_active_overlap'
      and conrelid = 'public.operator_machine_assignments'::regclass
  ) then
    alter table public.operator_machine_assignments
      add constraint operator_machine_assignments_no_active_overlap
      exclude using gist (
        operator_profile_id with =,
        reporting_machine_id with =,
        daterange(
          effective_start_date,
          coalesce(effective_end_date + 1, 'infinity'::date),
          '[)'
        ) with &&
      )
      where (status = 'active' and revoked_at is null)
      deferrable initially immediate;
  end if;
end;
$$;

alter table public.compensation_rules
  add column if not exists shift_rate_cents integer;

update public.compensation_rules
set shift_rate_cents = hourly_rate_cents
where shift_rate_cents is null
  and hourly_rate_cents is not null
  and operator_profile_id is not null
  and reporting_machine_id is null;

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'compensation_rules_shift_rate_nonnegative'
      and conrelid = 'public.compensation_rules'::regclass
  ) then
    alter table public.compensation_rules
      add constraint compensation_rules_shift_rate_nonnegative
      check (shift_rate_cents is null or shift_rate_cents >= 0);
  end if;

  if not exists (
    select 1
    from pg_constraint
    where conname = 'compensation_rules_canonical_shift_scope'
      and conrelid = 'public.compensation_rules'::regclass
  ) then
    alter table public.compensation_rules
      add constraint compensation_rules_canonical_shift_scope
      check (
        shift_rate_cents is null
        or (operator_profile_id is not null and reporting_machine_id is null)
      ) not valid;
  end if;

  if not exists (
    select 1
    from pg_constraint
    where conname = 'compensation_rules_canonical_commission_scope'
      and conrelid = 'public.compensation_rules'::regclass
  ) then
    alter table public.compensation_rules
      add constraint compensation_rules_canonical_commission_scope
      check (commission_basis_points is null or operator_profile_id is not null)
      not valid;
  end if;
end;
$$;

create index if not exists compensation_rules_canonical_shift_lookup_idx
  on public.compensation_rules (
    operator_profile_id,
    effective_start_date desc,
    effective_end_date
  )
  where status = 'active'
    and shift_rate_cents is not null
    and reporting_machine_id is null;

create index if not exists compensation_rules_canonical_commission_lookup_idx
  on public.compensation_rules (
    operator_profile_id,
    reporting_machine_id,
    effective_start_date desc,
    effective_end_date
  )
  where status = 'active'
    and commission_basis_points is not null;

create table if not exists public.operator_recurring_compensation_items (
  id uuid primary key default gen_random_uuid(),
  account_id uuid not null references public.customer_accounts (id) on delete cascade,
  operator_profile_id uuid not null references public.operator_payout_profiles (id) on delete cascade,
  item_type text not null check (item_type in ('bonus', 'supply_credit', 'expense_reimbursement')),
  description text not null,
  amount_cents integer not null,
  effective_start_date date not null,
  effective_end_date date,
  status text not null default 'active' check (status in ('active', 'inactive')),
  created_by uuid references auth.users (id) on delete set null,
  updated_by uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint operator_recurring_items_description_present
    check (length(trim(description)) > 0),
  constraint operator_recurring_items_amount_positive check (amount_cents > 0),
  constraint operator_recurring_items_valid_window
    check (effective_end_date is null or effective_end_date >= effective_start_date)
);

create index if not exists operator_recurring_items_profile_effective_idx
  on public.operator_recurring_compensation_items (
    operator_profile_id,
    effective_start_date,
    effective_end_date
  )
  where status = 'active';

drop trigger if exists operator_recurring_items_set_updated_at
  on public.operator_recurring_compensation_items;
create trigger operator_recurring_items_set_updated_at
before update on public.operator_recurring_compensation_items
for each row execute function public.set_updated_at();

create table if not exists public.operator_ytd_opening_balances (
  id uuid primary key default gen_random_uuid(),
  account_id uuid not null references public.customer_accounts (id) on delete cascade,
  operator_profile_id uuid not null references public.operator_payout_profiles (id) on delete cascade,
  calendar_year integer not null check (calendar_year between 2000 and 2200),
  balance_through_date date not null,
  actual_minutes integer not null default 0 check (actual_minutes >= 0),
  paid_shift_count integer not null default 0 check (paid_shift_count >= 0),
  commissionable_sales_cents bigint not null default 0 check (commissionable_sales_cents >= 0),
  shift_earnings_cents bigint not null default 0,
  commission_earnings_cents bigint not null default 0,
  bonus_cents bigint not null default 0,
  supply_credit_cents bigint not null default 0,
  expense_reimbursement_cents bigint not null default 0,
  created_by uuid references auth.users (id) on delete set null,
  updated_by uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint operator_ytd_opening_balance_year_match check (
    extract(year from balance_through_date)::integer = calendar_year
  ),
  constraint operator_ytd_opening_balance_amounts_nonnegative check (
    shift_earnings_cents >= 0
    and commission_earnings_cents >= 0
    and bonus_cents >= 0
    and supply_credit_cents >= 0
    and expense_reimbursement_cents >= 0
  ),
  unique (operator_profile_id, calendar_year)
);

create index if not exists operator_ytd_opening_balances_account_year_idx
  on public.operator_ytd_opening_balances (account_id, calendar_year);

drop trigger if exists operator_ytd_opening_balances_set_updated_at
  on public.operator_ytd_opening_balances;
create trigger operator_ytd_opening_balances_set_updated_at
before update on public.operator_ytd_opening_balances
for each row execute function public.set_updated_at();

create table if not exists public.time_entry_change_events (
  id uuid primary key default gen_random_uuid(),
  time_entry_id uuid not null references public.time_entries (id) on delete restrict,
  account_id uuid not null references public.customer_accounts (id) on delete cascade,
  operator_profile_id uuid not null references public.operator_payout_profiles (id) on delete restrict,
  reporting_machine_id uuid not null references public.reporting_machines (id) on delete restrict,
  actor_user_id uuid references auth.users (id) on delete set null,
  change_kind text not null check (change_kind in (
    'technician_created',
    'technician_updated',
    'technician_voided',
    'manager_corrected',
    'manager_voided',
    'system_changed'
  )),
  before_state jsonb,
  after_state jsonb not null,
  created_at timestamptz not null default now()
);

create index if not exists time_entry_change_events_entry_created_idx
  on public.time_entry_change_events (time_entry_id, created_at desc);

create index if not exists time_entry_change_events_machine_created_idx
  on public.time_entry_change_events (reporting_machine_id, created_at desc);

alter table public.operator_recurring_compensation_items enable row level security;
alter table public.operator_ytd_opening_balances enable row level security;
alter table public.time_entry_change_events enable row level security;

drop policy if exists "operator_recurring_items_select_manager"
  on public.operator_recurring_compensation_items;
create policy "operator_recurring_items_select_manager"
on public.operator_recurring_compensation_items
for select
to authenticated
using (public.can_manage_operator_payout_account_current_user(account_id));

drop policy if exists "operator_ytd_opening_balances_select_manager"
  on public.operator_ytd_opening_balances;
create policy "operator_ytd_opening_balances_select_manager"
on public.operator_ytd_opening_balances
for select
to authenticated
using (public.can_manage_operator_payout_account_current_user(account_id));

drop policy if exists "time_entry_change_events_select_accessible"
  on public.time_entry_change_events;
create policy "time_entry_change_events_select_accessible"
on public.time_entry_change_events
for select
to authenticated
using (
  public.can_manage_operator_payout_machine_current_user(reporting_machine_id)
  or exists (
    select 1
    from public.operator_payout_profiles profile
    where profile.id = time_entry_change_events.operator_profile_id
      and profile.user_id = (select auth.uid())
  )
);

revoke all on table public.operator_recurring_compensation_items from anon, authenticated;
revoke all on table public.operator_ytd_opening_balances from anon, authenticated;
revoke all on table public.time_entry_change_events from anon, authenticated;
grant select on table public.operator_recurring_compensation_items to authenticated;
grant select on table public.operator_ytd_opening_balances to authenticated;
grant select on table public.time_entry_change_events to authenticated;

create or replace function public.operator_paid_shift_count(
  p_actual_minutes integer
)
returns integer
language sql
immutable
set search_path = ''
as $$
  select case
    when coalesce(p_actual_minutes, 0) <= 0 then 0
    else ((p_actual_minutes + 59) / 60)::integer
  end;
$$;

create or replace function public.operator_time_entry_cutoff_at(
  p_work_date date
)
returns timestamptz
language sql
immutable
set search_path = ''
as $$
  select (
    (
      date_trunc('month', p_work_date::timestamp)
      + interval '1 month'
      + interval '4 days'
    ) at time zone 'America/Los_Angeles'
  );
$$;

create or replace function public.operator_worker_notice_code(
  p_worker_type text
)
returns text
language sql
immutable
set search_path = ''
as $$
  select case lower(coalesce(p_worker_type, 'unspecified'))
    when 'contractor_1099' then 'independent_contractor_no_withholding'
    when 'employee_w2' then 'employee_pay_statement'
    when 'part_time_employee' then 'employee_pay_statement'
    else 'classification_specific_notice_required'
  end;
$$;

create or replace function public.set_operator_time_entry_durations()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  machine_row public.reporting_machines;
  profile_row public.operator_payout_profiles;
  policy_row public.payout_policies;
  period_row public.payout_periods;
  manager_correction boolean;
begin
  manager_correction := coalesce(
    current_setting('app.timekeeping_manager_correction', true),
    ''
  ) = 'true';

  if tg_op = 'INSERT' then
    if new.actual_start_at is null then
      new.actual_start_at :=
        (new.work_date::timestamp + new.start_time) at time zone 'America/Los_Angeles';
    end if;
    if new.actual_end_at is null then
      new.actual_end_at :=
        (new.work_date::timestamp + new.end_time) at time zone 'America/Los_Angeles';
    end if;
  elsif new.actual_start_at is not distinct from old.actual_start_at
    and new.actual_end_at is not distinct from old.actual_end_at
    and (
      new.work_date is distinct from old.work_date
      or new.start_time is distinct from old.start_time
      or new.end_time is distinct from old.end_time
    ) then
    new.actual_start_at :=
      (new.work_date::timestamp + new.start_time) at time zone 'America/Los_Angeles';
    new.actual_end_at :=
      (new.work_date::timestamp + new.end_time) at time zone 'America/Los_Angeles';
  end if;

  if new.actual_end_at <= new.actual_start_at then
    raise exception 'End time must be after start time';
  end if;

  new.work_date := (new.actual_start_at at time zone 'America/Los_Angeles')::date;
  new.start_time := (new.actual_start_at at time zone 'America/Los_Angeles')::time;
  new.end_time := (new.actual_end_at at time zone 'America/Los_Angeles')::time;

  select *
  into profile_row
  from public.operator_payout_profiles profile
  where profile.id = new.operator_profile_id;

  if profile_row.id is null then
    raise exception 'Technician pay profile not found';
  end if;

  select *
  into machine_row
  from public.reporting_machines machine
  where machine.id = new.reporting_machine_id;

  if machine_row.id is null or machine_row.account_id <> profile_row.account_id then
    raise exception 'Technician and machine must belong to the same account';
  end if;

  select *
  into period_row
  from public.payout_periods period
  where period.id = new.payout_period_id;

  select *
  into policy_row
  from public.payout_policies policy
  where policy.id = new.payout_policy_id;

  if period_row.id is null or policy_row.id is null then
    raise exception 'Time entry pay period configuration is missing';
  end if;

  if new.work_date not between period_row.period_start_date and period_row.period_end_date then
    raise exception 'Work date must fall inside the pay period';
  end if;

  if not manager_correction
    and period_row.status not in ('open', 'grace_period', 'reopened') then
    raise exception 'Time entry is closed for Technician editing';
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
    raise exception 'Technician is not assigned to this machine for the work date';
  end if;

  if policy_row.account_id <> profile_row.account_id
    or period_row.account_id <> profile_row.account_id
    or period_row.payout_policy_id <> policy_row.id then
    raise exception 'Time entry pay policy, period, Technician, and machine must share an account';
  end if;

  new.account_id := profile_row.account_id;
  new.reporting_location_id := machine_row.location_id;
  new.raw_duration_minutes := ceil(
    extract(epoch from (new.actual_end_at - new.actual_start_at)) / 60
  )::integer;
  new.paid_shift_count := public.operator_paid_shift_count(new.raw_duration_minutes);
  new.rounded_paid_minutes := new.paid_shift_count * 60;

  if new.created_by is null then
    new.created_by := auth.uid();
  end if;
  new.updated_by := auth.uid();

  return new;
end;
$$;

create or replace function public.validate_operator_time_entry_assignment()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.work_date > (now() at time zone 'America/Los_Angeles')::date then
    raise exception 'Future work dates are not allowed';
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
    raise exception 'Time entry machine is not assigned for this work date';
  end if;

  return new;
end;
$$;

create or replace function public.reset_operator_time_entry_manager_review()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  time_details_changed boolean;
begin
  time_details_changed :=
    new.operator_profile_id is distinct from old.operator_profile_id
    or new.reporting_machine_id is distinct from old.reporting_machine_id
    or new.work_date is distinct from old.work_date
    or new.start_time is distinct from old.start_time
    or new.end_time is distinct from old.end_time
    or new.actual_start_at is distinct from old.actual_start_at
    or new.actual_end_at is distinct from old.actual_end_at
    or new.notes is distinct from old.notes;

  if time_details_changed then
    new.manager_review_status := 'pending';
    new.manager_review_reason := null;
    new.manager_reviewed_at := null;
    new.manager_reviewed_by := null;
  elsif (
    new.manager_review_status is distinct from old.manager_review_status
    or new.manager_review_reason is distinct from old.manager_review_reason
    or new.manager_reviewed_at is distinct from old.manager_reviewed_at
    or new.manager_reviewed_by is distinct from old.manager_reviewed_by
  ) and coalesce(current_setting('app.time_entry_review_rpc', true), '') <> 'true'
    and coalesce(current_setting('app.timekeeping_manager_correction', true), '') <> 'true' then
    raise exception 'Legacy review fields can only be changed through an audited manager action';
  end if;

  return new;
end;
$$;

create or replace function public.record_time_entry_change_event()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  configured_kind text;
  resolved_kind text;
begin
  configured_kind := nullif(
    current_setting('app.timekeeping_change_kind', true),
    ''
  );

  resolved_kind := coalesce(
    configured_kind,
    case
      when tg_op = 'INSERT' then 'system_changed'
      else 'system_changed'
    end
  );

  insert into public.time_entry_change_events (
    time_entry_id,
    account_id,
    operator_profile_id,
    reporting_machine_id,
    actor_user_id,
    change_kind,
    before_state,
    after_state
  )
  values (
    new.id,
    new.account_id,
    new.operator_profile_id,
    new.reporting_machine_id,
    auth.uid(),
    resolved_kind,
    case when tg_op = 'UPDATE' then to_jsonb(old) else null end,
    to_jsonb(new)
  );

  return new;
end;
$$;

drop trigger if exists time_entries_record_change_event on public.time_entries;
create trigger time_entries_record_change_event
after insert or update of
  operator_profile_id,
  reporting_machine_id,
  actual_start_at,
  actual_end_at,
  notes,
  status
on public.time_entries
for each row execute function public.record_time_entry_change_event();

create or replace function public.ensure_default_operator_payout_policy(
  p_account_id uuid
)
returns public.payout_policies
language plpgsql
security definer
set search_path = ''
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

  if not coalesce(
    public.can_manage_operator_payout_account(actor_user_id, p_account_id),
    false
  ) then
    raise exception 'Technician pay setup access required';
  end if;

  select * into account_row
  from public.customer_accounts account
  where account.id = p_account_id;

  if account_row.id is null then
    raise exception 'Account not found';
  end if;

  select * into policy_row
  from public.payout_policies policy
  where policy.id = account_row.default_payout_policy_id
    and policy.active;

  if policy_row.id is null then
    select * into policy_row
    from public.payout_policies policy
    where policy.account_id = account_row.id
      and policy.active
      and lower(policy.name) = 'monthly operator payouts'
    order by policy.created_at
    limit 1;
  end if;

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
      4,
      0,
      4,
      5,
      'round_up_60_minutes',
      'no_review_required',
      true,
      actor_user_id,
      actor_user_id
    )
    returning * into policy_row;
  else
    update public.payout_policies
    set
      submission_due_offset_days = 4,
      lock_offset_days = 4,
      rounding_rule = 'round_up_60_minutes',
      review_model = 'no_review_required',
      updated_by = actor_user_id
    where id = policy_row.id
    returning * into policy_row;
  end if;

  update public.customer_accounts
  set default_payout_policy_id = policy_row.id
  where id = account_row.id
    and default_payout_policy_id is distinct from policy_row.id;

  return policy_row;
end;
$$;

create or replace function public.ensure_operator_payout_period_for_date(
  p_operator_profile_id uuid,
  p_work_date date default current_date
)
returns public.payout_periods
language plpgsql
security definer
set search_path = ''
as $$
declare
  actor_user_id uuid;
  profile_row public.operator_payout_profiles;
  policy_row public.payout_policies;
  period_row public.payout_periods;
  target_work_date date;
  period_start date;
  period_end date;
  cutoff_at timestamptz;
begin
  actor_user_id := auth.uid();
  target_work_date := coalesce(p_work_date, current_date);

  if actor_user_id is null then
    raise exception 'Authentication required';
  end if;

  select * into profile_row
  from public.operator_payout_profiles profile
  where profile.id = p_operator_profile_id
    and profile.status = 'active';

  if profile_row.id is null then
    raise exception 'Technician pay profile not found';
  end if;

  if profile_row.user_id <> actor_user_id
    and not coalesce(
      public.can_manage_operator_payout_account(actor_user_id, profile_row.account_id),
      false
    )
    and not exists (
      select 1
      from public.operator_machine_assignments assignment
      where assignment.operator_profile_id = profile_row.id
        and public.can_manage_operator_payout_machine(
          actor_user_id,
          assignment.reporting_machine_id
        )
    ) then
    raise exception 'Technician timekeeping access required';
  end if;

  select * into policy_row
  from public.payout_policies policy
  where policy.id = coalesce(
    profile_row.payout_policy_id,
    (
      select account.default_payout_policy_id
      from public.customer_accounts account
      where account.id = profile_row.account_id
    )
  )
    and policy.account_id = profile_row.account_id
    and policy.active;

  if policy_row.id is null then
    select * into policy_row
    from public.ensure_default_operator_payout_policy(profile_row.account_id);
  end if;

  if policy_row.frequency <> 'monthly'
    or policy_row.monthly_period_type <> 'calendar_month' then
    raise exception 'Timekeeping requires a monthly calendar pay policy';
  end if;

  period_start := date_trunc('month', target_work_date::timestamp)::date;
  period_end := (date_trunc('month', target_work_date::timestamp) + interval '1 month - 1 day')::date;
  cutoff_at := public.operator_time_entry_cutoff_at(target_work_date);

  insert into public.payout_periods (
    account_id,
    payout_policy_id,
    period_start_date,
    period_end_date,
    submission_due_date,
    lock_date,
    target_payout_date,
    status,
    created_by,
    updated_by
  )
  values (
    profile_row.account_id,
    policy_row.id,
    period_start,
    period_end,
    period_end + 4,
    period_end + 4,
    period_end + 5,
    case when now() >= cutoff_at then 'locked' else 'open' end,
    actor_user_id,
    actor_user_id
  )
  on conflict (account_id, payout_policy_id, period_start_date, period_end_date)
  do update set
    submission_due_date = excluded.submission_due_date,
    lock_date = excluded.lock_date,
    target_payout_date = excluded.target_payout_date,
    status = case
      when public.payout_periods.status in (
        'review', 'draft_payout', 'finalized', 'issued', 'closed', 'reopened', 'voided'
      ) then public.payout_periods.status
      when now() >= cutoff_at then 'locked'
      else 'open'
    end,
    updated_by = actor_user_id
  returning * into period_row;

  return period_row;
end;
$$;

create or replace function public.operator_time_entry_payload(
  p_time_entry_id uuid
)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select jsonb_build_object(
    'id', entry.id,
    'accountId', entry.account_id,
    'operatorProfileId', entry.operator_profile_id,
    'machineId', entry.reporting_machine_id,
    'machineLabel', machine.machine_label,
    'locationId', entry.reporting_location_id,
    'locationName', location.name,
    'payoutPolicyId', entry.payout_policy_id,
    'payoutPeriodId', entry.payout_period_id,
    'workDate', entry.work_date,
    'startTime', to_char(entry.start_time, 'HH24:MI'),
    'endTime', to_char(entry.end_time, 'HH24:MI'),
    'actualStartAt', entry.actual_start_at,
    'actualEndAt', entry.actual_end_at,
    'actualDurationMinutes', entry.raw_duration_minutes,
    'rawDurationMinutes', entry.raw_duration_minutes,
    'paidShifts', entry.paid_shift_count,
    'roundedPaidMinutes', entry.rounded_paid_minutes,
    'notes', entry.notes,
    'status', entry.status,
    'managerReviewStatus', entry.manager_review_status,
    'managerReviewReason', entry.manager_review_reason,
    'managerReviewedAt', entry.manager_reviewed_at,
    'technicianCutoffAt', public.operator_time_entry_cutoff_at(entry.work_date),
    'technicianEditable', (
      now() < public.operator_time_entry_cutoff_at(entry.work_date)
      and entry.status not in ('included_in_payout', 'paid', 'voided')
    ),
    'lockedAt', entry.locked_at,
    'createdAt', entry.created_at,
    'updatedAt', entry.updated_at
  )
  from public.time_entries entry
  join public.reporting_machines machine on machine.id = entry.reporting_machine_id
  join public.reporting_locations location on location.id = entry.reporting_location_id
  join public.operator_payout_profiles profile on profile.id = entry.operator_profile_id
  where entry.id = p_time_entry_id
    and (
      profile.user_id = (select auth.uid())
      or public.can_access_operator_payout_profile((select auth.uid()), profile.id)
    );
$$;

create or replace function public.save_operator_time_entry(
  p_time_entry_id uuid,
  p_operator_profile_id uuid,
  p_reporting_machine_id uuid,
  p_actual_start_at timestamptz,
  p_actual_end_at timestamptz,
  p_notes text default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  actor_user_id uuid;
  profile_row public.operator_payout_profiles;
  machine_row public.reporting_machines;
  period_row public.payout_periods;
  before_row public.time_entries;
  entry_row public.time_entries;
  work_date_local date;
  event_kind text;
begin
  actor_user_id := auth.uid();

  if actor_user_id is null then
    raise exception 'Authentication required';
  end if;

  if p_actual_start_at is null or p_actual_end_at is null
    or p_actual_end_at <= p_actual_start_at then
    raise exception 'End time must be after start time';
  end if;

  if p_actual_end_at > now() then
    raise exception 'Time can be entered only after the work is completed';
  end if;

  work_date_local := (p_actual_start_at at time zone 'America/Los_Angeles')::date;

  if now() >= public.operator_time_entry_cutoff_at(work_date_local) then
    raise exception 'This month is closed for Technician editing';
  end if;

  select * into profile_row
  from public.operator_payout_profiles profile
  where profile.id = p_operator_profile_id
    and profile.user_id = actor_user_id
    and profile.status = 'active';

  if profile_row.id is null then
    raise exception 'Technician timekeeping access required';
  end if;

  select * into machine_row
  from public.reporting_machines machine
  where machine.id = p_reporting_machine_id
    and machine.account_id = profile_row.account_id;

  if machine_row.id is null then
    raise exception 'Assigned machine not found';
  end if;

  if not exists (
    select 1
    from public.operator_machine_assignments assignment
    where assignment.operator_profile_id = profile_row.id
      and assignment.reporting_machine_id = machine_row.id
      and assignment.status = 'active'
      and assignment.revoked_at is null
      and work_date_local between assignment.effective_start_date
        and coalesce(assignment.effective_end_date, 'infinity'::date)
  ) then
    raise exception 'Assigned machine not found for the work date';
  end if;

  if p_time_entry_id is not null then
    select * into before_row
    from public.time_entries entry
    where entry.id = p_time_entry_id
    for update;

    if before_row.id is null
      or before_row.operator_profile_id <> profile_row.id then
      raise exception 'Technician timekeeping access required';
    end if;

    if before_row.status in ('included_in_payout', 'paid', 'voided') then
      raise exception 'This time entry can no longer be edited by the Technician';
    end if;

    if now() >= public.operator_time_entry_cutoff_at(before_row.work_date) then
      raise exception 'This month is closed for Technician editing';
    end if;
  end if;

  if exists (
    select 1
    from public.time_entries existing
    where existing.operator_profile_id = profile_row.id
      and existing.status <> 'voided'
      and existing.id is distinct from p_time_entry_id
      and tstzrange(existing.actual_start_at, existing.actual_end_at, '[)')
        && tstzrange(p_actual_start_at, p_actual_end_at, '[)')
  ) then
    raise exception 'Time entry overlaps another Technician entry';
  end if;

  select * into period_row
  from public.ensure_operator_payout_period_for_date(profile_row.id, work_date_local);

  event_kind := case when p_time_entry_id is null
    then 'technician_created'
    else 'technician_updated'
  end;
  perform set_config('app.timekeeping_change_kind', event_kind, true);

  if p_time_entry_id is null then
    insert into public.time_entries (
      account_id,
      operator_profile_id,
      reporting_machine_id,
      reporting_location_id,
      payout_policy_id,
      payout_period_id,
      work_date,
      start_time,
      end_time,
      actual_start_at,
      actual_end_at,
      raw_duration_minutes,
      rounded_paid_minutes,
      paid_shift_count,
      notes,
      status,
      created_by,
      updated_by
    )
    values (
      profile_row.account_id,
      profile_row.id,
      machine_row.id,
      machine_row.location_id,
      period_row.payout_policy_id,
      period_row.id,
      work_date_local,
      (p_actual_start_at at time zone 'America/Los_Angeles')::time,
      (p_actual_end_at at time zone 'America/Los_Angeles')::time,
      p_actual_start_at,
      p_actual_end_at,
      1,
      60,
      1,
      nullif(trim(coalesce(p_notes, '')), ''),
      'submitted',
      actor_user_id,
      actor_user_id
    )
    returning * into entry_row;
  else
    update public.time_entries
    set
      reporting_machine_id = machine_row.id,
      reporting_location_id = machine_row.location_id,
      payout_policy_id = period_row.payout_policy_id,
      payout_period_id = period_row.id,
      actual_start_at = p_actual_start_at,
      actual_end_at = p_actual_end_at,
      notes = nullif(trim(coalesce(p_notes, '')), ''),
      status = 'submitted',
      updated_by = actor_user_id
    where id = before_row.id
    returning * into entry_row;
  end if;

  perform set_config('app.timekeeping_change_kind', '', true);

  return jsonb_build_object(
    'timeEntry', public.operator_time_entry_payload(entry_row.id),
    'context', public.get_my_operator_timekeeping_context(work_date_local)
  );
end;
$$;

create or replace function public.submit_operator_time_entry(
  p_operator_profile_id uuid,
  p_reporting_machine_id uuid,
  p_work_date date,
  p_start_time time,
  p_end_time time,
  p_notes text default null,
  p_status text default 'submitted'
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  actor_user_id uuid;
  profile_row public.operator_payout_profiles;
  machine_row public.reporting_machines;
begin
  actor_user_id := auth.uid();

  if actor_user_id is null then
    raise exception 'Authentication required';
  end if;

  if p_end_time <= p_start_time then
    raise exception 'End time must be after start time';
  end if;

  select * into profile_row
  from public.operator_payout_profiles profile
  where profile.id = p_operator_profile_id
    and profile.user_id = actor_user_id
    and profile.status = 'active';

  if profile_row.id is null then
    raise exception 'Operator payout profile not found';
  end if;

  select * into machine_row
  from public.reporting_machines machine
  where machine.id = p_reporting_machine_id
    and machine.account_id = profile_row.account_id;

  if machine_row.id is null then
    raise exception 'Assigned machine not found';
  end if;

  if not exists (
    select 1
    from public.operator_machine_assignments assignment
    where assignment.operator_profile_id = profile_row.id
      and assignment.reporting_machine_id = p_reporting_machine_id
      and assignment.status = 'active'
      and assignment.revoked_at is null
      and p_work_date between assignment.effective_start_date
        and coalesce(assignment.effective_end_date, 'infinity'::date)
  ) then
    raise exception 'Operator is not assigned to this machine for the work date';
  end if;

  return public.save_operator_time_entry(
    null,
    p_operator_profile_id,
    p_reporting_machine_id,
    (p_work_date::timestamp + p_start_time) at time zone 'America/Los_Angeles',
    (p_work_date::timestamp + p_end_time) at time zone 'America/Los_Angeles',
    p_notes
  );
end;
$$;

create or replace function public.update_operator_time_entry(
  p_time_entry_id uuid,
  p_reporting_machine_id uuid,
  p_work_date date,
  p_start_time time,
  p_end_time time,
  p_notes text default null,
  p_status text default 'submitted'
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  actor_user_id uuid;
  profile_id uuid;
begin
  actor_user_id := auth.uid();

  if actor_user_id is null then
    raise exception 'Authentication required';
  end if;

  if p_end_time <= p_start_time then
    raise exception 'End time must be after start time';
  end if;

  select entry.operator_profile_id into profile_id
  from public.time_entries entry
  join public.operator_payout_profiles profile
    on profile.id = entry.operator_profile_id
  where entry.id = p_time_entry_id;

  if profile_id is null or not exists (
    select 1
    from public.operator_payout_profiles profile
    where profile.id = profile_id
      and profile.user_id = actor_user_id
      and profile.status = 'active'
  ) then
    raise exception 'Operator timekeeping access required';
  end if;

  return public.save_operator_time_entry(
    p_time_entry_id,
    profile_id,
    p_reporting_machine_id,
    (p_work_date::timestamp + p_start_time) at time zone 'America/Los_Angeles',
    (p_work_date::timestamp + p_end_time) at time zone 'America/Los_Angeles',
    p_notes
  );
end;
$$;

create or replace function public.void_operator_time_entry(
  p_time_entry_id uuid,
  p_reason text default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  actor_user_id uuid;
  before_row public.time_entries;
  after_row public.time_entries;
  profile_row public.operator_payout_profiles;
begin
  actor_user_id := auth.uid();

  if actor_user_id is null then
    raise exception 'Authentication required';
  end if;

  select * into before_row
  from public.time_entries entry
  where entry.id = p_time_entry_id
  for update;

  select * into profile_row
  from public.operator_payout_profiles profile
  where profile.id = before_row.operator_profile_id
    and profile.user_id = actor_user_id
    and profile.status = 'active';

  if before_row.id is null or profile_row.id is null then
    raise exception 'Operator timekeeping access required';
  end if;

  if before_row.status in ('included_in_payout', 'paid', 'voided')
    or now() >= public.operator_time_entry_cutoff_at(before_row.work_date) then
    raise exception 'This time entry can no longer be deleted by the Technician';
  end if;

  perform set_config('app.timekeeping_change_kind', 'technician_voided', true);

  update public.time_entries
  set
    status = 'voided',
    updated_by = actor_user_id
  where id = before_row.id
  returning * into after_row;

  perform set_config('app.timekeeping_change_kind', '', true);

  return jsonb_build_object(
    'timeEntryId', after_row.id,
    'context', public.get_my_operator_timekeeping_context(before_row.work_date)
  );
end;
$$;

create or replace function public.manager_correct_operator_time_entry(
  p_time_entry_id uuid,
  p_reporting_machine_id uuid,
  p_actual_start_at timestamptz,
  p_actual_end_at timestamptz,
  p_notes text default null,
  p_void boolean default false
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  actor_user_id uuid;
  before_row public.time_entries;
  after_row public.time_entries;
  profile_row public.operator_payout_profiles;
  machine_row public.reporting_machines;
  period_row public.payout_periods;
  work_date_local date;
begin
  actor_user_id := auth.uid();

  if actor_user_id is null then
    raise exception 'Authentication required';
  end if;

  select * into before_row
  from public.time_entries entry
  where entry.id = p_time_entry_id
  for update;

  if before_row.id is null then
    raise exception 'Time entry not found';
  end if;

  if not coalesce(
    public.can_manage_operator_payout_machine(actor_user_id, before_row.reporting_machine_id),
    false
  ) then
    raise exception 'Machine manager access required';
  end if;

  select * into profile_row
  from public.operator_payout_profiles profile
  where profile.id = before_row.operator_profile_id;

  if coalesce(p_void, false) then
    perform set_config('app.timekeeping_manager_correction', 'true', true);
    perform set_config('app.timekeeping_change_kind', 'manager_voided', true);

    update public.time_entries
    set status = 'voided', updated_by = actor_user_id
    where id = before_row.id
    returning * into after_row;
  else
    if p_actual_start_at is null or p_actual_end_at is null
      or p_actual_end_at <= p_actual_start_at then
      raise exception 'End time must be after start time';
    end if;

    if p_actual_end_at > now() then
      raise exception 'Time can be entered only after the work is completed';
    end if;

    work_date_local := (p_actual_start_at at time zone 'America/Los_Angeles')::date;

    select * into machine_row
    from public.reporting_machines machine
    where machine.id = p_reporting_machine_id
      and machine.account_id = before_row.account_id;

    if machine_row.id is null
      or not coalesce(
        public.can_manage_operator_payout_machine(actor_user_id, machine_row.id),
        false
      ) then
      raise exception 'Machine manager access required';
    end if;

    if not exists (
      select 1
      from public.operator_machine_assignments assignment
      where assignment.operator_profile_id = before_row.operator_profile_id
        and assignment.reporting_machine_id = machine_row.id
        and assignment.status = 'active'
        and assignment.revoked_at is null
        and work_date_local between assignment.effective_start_date
          and coalesce(assignment.effective_end_date, 'infinity'::date)
    ) then
      raise exception 'Technician is not assigned to this machine for the work date';
    end if;

    if exists (
      select 1
      from public.time_entries existing
      where existing.operator_profile_id = before_row.operator_profile_id
        and existing.status <> 'voided'
        and existing.id <> before_row.id
        and tstzrange(existing.actual_start_at, existing.actual_end_at, '[)')
          && tstzrange(p_actual_start_at, p_actual_end_at, '[)')
    ) then
      raise exception 'Time entry overlaps another Technician entry';
    end if;

    select * into period_row
    from public.ensure_operator_payout_period_for_date(
      before_row.operator_profile_id,
      work_date_local
    );

    perform set_config('app.timekeeping_manager_correction', 'true', true);
    perform set_config('app.timekeeping_change_kind', 'manager_corrected', true);

    update public.time_entries
    set
      reporting_machine_id = machine_row.id,
      reporting_location_id = machine_row.location_id,
      payout_policy_id = period_row.payout_policy_id,
      payout_period_id = period_row.id,
      actual_start_at = p_actual_start_at,
      actual_end_at = p_actual_end_at,
      notes = nullif(trim(coalesce(p_notes, '')), ''),
      status = 'submitted',
      manager_review_status = 'pending',
      manager_review_reason = null,
      manager_reviewed_at = null,
      manager_reviewed_by = null,
      locked_at = null,
      locked_by = null,
      updated_by = actor_user_id
    where id = before_row.id
    returning * into after_row;
  end if;

  perform set_config('app.timekeeping_change_kind', '', true);
  perform set_config('app.timekeeping_manager_correction', '', true);

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
    case when coalesce(p_void, false)
      then 'operator_time_entry.manager_voided'
      else 'operator_time_entry.manager_corrected'
    end,
    'time_entry',
    after_row.id::text,
    profile_row.user_id,
    to_jsonb(before_row),
    to_jsonb(after_row),
    jsonb_build_object(
      'machine_manager_correction', true,
      'reason_required', false,
      'after_cutoff_allowed', true,
      'payment_execution', false
    )
  );

  return jsonb_build_object(
    'timeEntry', public.operator_time_entry_payload(after_row.id),
    'context', public.get_my_time_review_context(
      coalesce(work_date_local, before_row.work_date)
    )
  );
end;
$$;

create or replace function public.admin_upsert_operator_machine_assignment(
  p_assignment_id uuid,
  p_operator_profile_id uuid,
  p_reporting_machine_id uuid,
  p_effective_start_date date,
  p_effective_end_date date default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  actor_user_id uuid;
  profile_row public.operator_payout_profiles;
  machine_row public.reporting_machines;
  before_row public.operator_machine_assignments;
  after_row public.operator_machine_assignments;
  lock_key text;
begin
  actor_user_id := auth.uid();

  if actor_user_id is null then
    raise exception 'Authentication required';
  end if;

  if p_effective_start_date is null
    or (
      p_effective_end_date is not null
      and p_effective_end_date < p_effective_start_date
    ) then
    raise exception 'Machine assignment effective window is invalid';
  end if;

  select * into profile_row
  from public.operator_payout_profiles profile
  where profile.id = p_operator_profile_id;

  select * into machine_row
  from public.reporting_machines machine
  where machine.id = p_reporting_machine_id
    and machine.account_id = profile_row.account_id;

  if profile_row.id is null or machine_row.id is null then
    raise exception 'Technician and machine must belong to the same account';
  end if;

  if not coalesce(
    public.can_manage_operator_payout_account(actor_user_id, profile_row.account_id),
    false
  ) and not coalesce(
    public.can_manage_operator_payout_machine(actor_user_id, machine_row.id),
    false
  ) then
    raise exception 'Machine assignment access required';
  end if;

  lock_key := concat_ws(
    ':',
    p_operator_profile_id::text,
    p_reporting_machine_id::text,
    'timekeeping-assignment'
  );
  perform pg_advisory_xact_lock(hashtextextended(lock_key, 0));

  if exists (
    select 1
    from public.operator_machine_assignments assignment
    where assignment.id is distinct from p_assignment_id
      and assignment.operator_profile_id = p_operator_profile_id
      and assignment.reporting_machine_id = p_reporting_machine_id
      and assignment.status = 'active'
      and assignment.revoked_at is null
      and daterange(
        assignment.effective_start_date,
        coalesce(assignment.effective_end_date + 1, 'infinity'::date),
        '[)'
      ) && daterange(
        p_effective_start_date,
        coalesce(p_effective_end_date + 1, 'infinity'::date),
        '[)'
      )
  ) then
    raise exception 'Machine assignment overlaps an existing effective window';
  end if;

  if p_assignment_id is not null then
    select * into before_row
    from public.operator_machine_assignments assignment
    where assignment.id = p_assignment_id
      and assignment.operator_profile_id = p_operator_profile_id
    for update;

    if before_row.id is null then
      raise exception 'Machine assignment not found';
    end if;

    if not coalesce(
      public.can_manage_operator_payout_machine(
        actor_user_id,
        before_row.reporting_machine_id
      ),
      false
    ) and not coalesce(
      public.can_manage_operator_payout_account(actor_user_id, profile_row.account_id),
      false
    ) then
      raise exception 'Machine assignment access required';
    end if;
  end if;

  if before_row.id is null then
    insert into public.operator_machine_assignments (
      operator_profile_id,
      account_id,
      reporting_machine_id,
      effective_start_date,
      effective_end_date,
      status,
      grant_reason,
      created_by
    ) values (
      profile_row.id,
      profile_row.account_id,
      machine_row.id,
      p_effective_start_date,
      p_effective_end_date,
      'active',
      'Effective Timekeeping assignment',
      actor_user_id
    ) returning * into after_row;
  else
    update public.operator_machine_assignments
    set
      reporting_machine_id = machine_row.id,
      effective_start_date = p_effective_start_date,
      effective_end_date = p_effective_end_date,
      status = 'active',
      revoked_by = null,
      revoked_at = null,
      revoke_reason = null
    where id = before_row.id
    returning * into after_row;
  end if;

  insert into public.admin_audit_log (
    actor_user_id, action, entity_type, entity_id, target_user_id, before, after, meta
  ) values (
    actor_user_id,
    case when before_row.id is null
      then 'operator_machine_assignment.created'
      else 'operator_machine_assignment.updated'
    end,
    'operator_machine_assignment',
    after_row.id::text,
    profile_row.user_id,
    coalesce(to_jsonb(before_row), '{}'::jsonb),
    to_jsonb(after_row),
    jsonb_build_object(
      'effective_dated', true,
      'approval_required', false,
      'payment_execution', false
    )
  );

  return jsonb_build_object(
    'id', after_row.id,
    'operatorProfileId', after_row.operator_profile_id,
    'machineId', after_row.reporting_machine_id,
    'effectiveStartDate', after_row.effective_start_date,
    'effectiveEndDate', after_row.effective_end_date,
    'status', after_row.status
  );
end;
$$;

create or replace function public.operator_compensation_rate_at(
  p_account_id uuid,
  p_operator_profile_id uuid,
  p_reporting_machine_id uuid,
  p_effective_date date,
  p_rate_type text
)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  normalized_type text;
  selected_rule public.compensation_rules;
  source_label text;
begin
  normalized_type := lower(trim(coalesce(p_rate_type, '')));

  if normalized_type not in ('shift', 'commission') then
    raise exception 'Rate type must be shift or commission';
  end if;

  select rule.* into selected_rule
  from public.compensation_rules rule
  where rule.account_id = p_account_id
    and rule.operator_profile_id = p_operator_profile_id
    and rule.status = 'active'
    and p_effective_date between rule.effective_start_date
      and coalesce(rule.effective_end_date, 'infinity'::date)
    and (
      (
        normalized_type = 'shift'
        and rule.shift_rate_cents is not null
        and rule.reporting_machine_id is null
      )
      or (
        normalized_type = 'commission'
        and rule.commission_basis_points is not null
        and (
          rule.reporting_machine_id = p_reporting_machine_id
          or rule.reporting_machine_id is null
        )
      )
    )
  order by
    case
      when normalized_type = 'commission'
        and rule.reporting_machine_id = p_reporting_machine_id then 0
      else 1
    end,
    rule.effective_start_date desc,
    rule.created_at desc,
    rule.id
  limit 1;

  if selected_rule.id is null then
    return null;
  end if;

  source_label := case
    when normalized_type = 'shift' then 'technician_default'
    when selected_rule.reporting_machine_id is not null then 'technician_machine_override'
    else 'technician_default'
  end;

  return jsonb_build_object(
    'ruleId', selected_rule.id,
    'rateType', normalized_type,
    'source', source_label,
    'shiftRateCents', selected_rule.shift_rate_cents,
    'commissionBasisPoints', selected_rule.commission_basis_points,
    'effectiveStartDate', selected_rule.effective_start_date,
    'effectiveEndDate', selected_rule.effective_end_date
  );
end;
$$;

create or replace function public.admin_upsert_operator_compensation_rate(
  p_rule_id uuid,
  p_account_id uuid,
  p_operator_profile_id uuid,
  p_reporting_machine_id uuid,
  p_rate_type text,
  p_rate_value integer,
  p_effective_start_date date,
  p_effective_end_date date default null,
  p_status text default 'active',
  p_notes text default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  actor_user_id uuid;
  normalized_type text;
  normalized_status text;
  profile_row public.operator_payout_profiles;
  machine_row public.reporting_machines;
  before_row public.compensation_rules;
  after_row public.compensation_rules;
  lock_key text;
begin
  actor_user_id := auth.uid();
  normalized_type := lower(trim(coalesce(p_rate_type, '')));
  normalized_status := lower(trim(coalesce(p_status, 'active')));

  if actor_user_id is null then
    raise exception 'Authentication required';
  end if;

  if not coalesce(
    public.can_manage_operator_payout_account(actor_user_id, p_account_id),
    false
  ) then
    raise exception 'Technician compensation access required';
  end if;

  if normalized_type not in ('shift', 'commission') then
    raise exception 'Rate type must be shift or commission';
  end if;

  if normalized_status not in ('active', 'inactive') then
    raise exception 'Invalid compensation rate status';
  end if;

  if p_rate_value is null or p_rate_value < 0
    or (normalized_type = 'commission' and p_rate_value > 10000) then
    raise exception 'Compensation rate value is invalid';
  end if;

  if p_effective_start_date is null
    or (
      p_effective_end_date is not null
      and p_effective_end_date < p_effective_start_date
    ) then
    raise exception 'Compensation rate effective window is invalid';
  end if;

  select * into profile_row
  from public.operator_payout_profiles profile
  where profile.id = p_operator_profile_id
    and profile.account_id = p_account_id;

  if profile_row.id is null then
    raise exception 'Technician pay profile not found for account';
  end if;

  if normalized_type = 'shift' and p_reporting_machine_id is not null then
    raise exception 'Shift rate belongs to the Technician, not a machine';
  end if;

  if p_reporting_machine_id is not null then
    select * into machine_row
    from public.reporting_machines machine
    where machine.id = p_reporting_machine_id
      and machine.account_id = p_account_id;

    if machine_row.id is null then
      raise exception 'Reporting machine not found for account';
    end if;
  end if;

  lock_key := concat_ws(
    ':',
    p_operator_profile_id::text,
    coalesce(p_reporting_machine_id::text, 'default'),
    normalized_type
  );
  perform pg_advisory_xact_lock(hashtextextended(lock_key, 0));

  if exists (
    select 1
    from public.compensation_rules rule
    where rule.id is distinct from p_rule_id
      and rule.account_id = p_account_id
      and rule.operator_profile_id = p_operator_profile_id
      and rule.reporting_machine_id is not distinct from p_reporting_machine_id
      and rule.status = 'active'
      and normalized_status = 'active'
      and daterange(
        rule.effective_start_date,
        coalesce(rule.effective_end_date + 1, 'infinity'::date),
        '[)'
      ) && daterange(
        p_effective_start_date,
        coalesce(p_effective_end_date + 1, 'infinity'::date),
        '[)'
      )
      and (
        (normalized_type = 'shift' and rule.shift_rate_cents is not null)
        or (
          normalized_type = 'commission'
          and rule.commission_basis_points is not null
        )
      )
  ) then
    raise exception 'Compensation rate overlaps an existing effective rate';
  end if;

  if p_rule_id is not null then
    select * into before_row
    from public.compensation_rules rule
    where rule.id = p_rule_id
      and rule.account_id = p_account_id
    for update;

    if before_row.id is null then
      raise exception 'Compensation rate not found';
    end if;
  end if;

  if before_row.id is null then
    insert into public.compensation_rules (
      account_id,
      operator_profile_id,
      reporting_machine_id,
      hourly_rate_cents,
      shift_rate_cents,
      commission_basis_points,
      effective_start_date,
      effective_end_date,
      status,
      notes,
      created_by,
      updated_by
    )
    values (
      p_account_id,
      p_operator_profile_id,
      p_reporting_machine_id,
      case when normalized_type = 'shift' then p_rate_value else null end,
      case when normalized_type = 'shift' then p_rate_value else null end,
      case when normalized_type = 'commission' then p_rate_value else null end,
      p_effective_start_date,
      p_effective_end_date,
      normalized_status,
      nullif(trim(coalesce(p_notes, '')), ''),
      actor_user_id,
      actor_user_id
    )
    returning * into after_row;
  else
    update public.compensation_rules
    set
      operator_profile_id = p_operator_profile_id,
      reporting_machine_id = p_reporting_machine_id,
      hourly_rate_cents = case when normalized_type = 'shift' then p_rate_value else null end,
      shift_rate_cents = case when normalized_type = 'shift' then p_rate_value else null end,
      commission_basis_points = case when normalized_type = 'commission' then p_rate_value else null end,
      effective_start_date = p_effective_start_date,
      effective_end_date = p_effective_end_date,
      status = normalized_status,
      notes = nullif(trim(coalesce(p_notes, '')), ''),
      updated_by = actor_user_id
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
    actor_user_id,
    case when before_row.id is null
      then 'operator_compensation_rate.created'
      else 'operator_compensation_rate.updated'
    end,
    'compensation_rule',
    after_row.id::text,
    profile_row.user_id,
    coalesce(to_jsonb(before_row), '{}'::jsonb),
    to_jsonb(after_row),
    jsonb_build_object(
      'rate_type', normalized_type,
      'machine_override', p_reporting_machine_id is not null,
      'approval_required', false,
      'payment_execution', false
    )
  );

  return jsonb_build_object(
    'id', after_row.id,
    'accountId', after_row.account_id,
    'operatorProfileId', after_row.operator_profile_id,
    'machineId', after_row.reporting_machine_id,
    'rateType', normalized_type,
    'rateValue', p_rate_value,
    'shiftRateCents', after_row.shift_rate_cents,
    'commissionBasisPoints', after_row.commission_basis_points,
    'effectiveStartDate', after_row.effective_start_date,
    'effectiveEndDate', after_row.effective_end_date,
    'status', after_row.status,
    'notes', after_row.notes
  );
end;
$$;

create or replace function public.admin_upsert_operator_recurring_item(
  p_item_id uuid,
  p_account_id uuid,
  p_operator_profile_id uuid,
  p_item_type text,
  p_description text,
  p_amount_cents integer,
  p_effective_start_date date,
  p_effective_end_date date default null,
  p_status text default 'active'
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  actor_user_id uuid;
  normalized_type text;
  normalized_status text;
  profile_row public.operator_payout_profiles;
  before_row public.operator_recurring_compensation_items;
  after_row public.operator_recurring_compensation_items;
begin
  actor_user_id := auth.uid();
  normalized_type := lower(trim(coalesce(p_item_type, '')));
  normalized_status := lower(trim(coalesce(p_status, 'active')));

  if actor_user_id is null then
    raise exception 'Authentication required';
  end if;

  if not coalesce(
    public.can_manage_operator_payout_account(actor_user_id, p_account_id),
    false
  ) then
    raise exception 'Technician compensation access required';
  end if;

  if normalized_type not in ('bonus', 'supply_credit', 'expense_reimbursement')
    or normalized_status not in ('active', 'inactive')
    or length(trim(coalesce(p_description, ''))) = 0
    or coalesce(p_amount_cents, 0) <= 0
    or p_effective_start_date is null
    or (
      p_effective_end_date is not null
      and p_effective_end_date < p_effective_start_date
    ) then
    raise exception 'Recurring compensation item is invalid';
  end if;

  select * into profile_row
  from public.operator_payout_profiles profile
  where profile.id = p_operator_profile_id
    and profile.account_id = p_account_id;

  if profile_row.id is null then
    raise exception 'Technician pay profile not found for account';
  end if;

  if p_item_id is not null then
    select * into before_row
    from public.operator_recurring_compensation_items item
    where item.id = p_item_id
      and item.account_id = p_account_id
    for update;

    if before_row.id is null then
      raise exception 'Recurring compensation item not found';
    end if;
  end if;

  if before_row.id is null then
    insert into public.operator_recurring_compensation_items (
      account_id,
      operator_profile_id,
      item_type,
      description,
      amount_cents,
      effective_start_date,
      effective_end_date,
      status,
      created_by,
      updated_by
    ) values (
      p_account_id,
      p_operator_profile_id,
      normalized_type,
      trim(p_description),
      p_amount_cents,
      p_effective_start_date,
      p_effective_end_date,
      normalized_status,
      actor_user_id,
      actor_user_id
    ) returning * into after_row;
  else
    update public.operator_recurring_compensation_items
    set
      operator_profile_id = p_operator_profile_id,
      item_type = normalized_type,
      description = trim(p_description),
      amount_cents = p_amount_cents,
      effective_start_date = p_effective_start_date,
      effective_end_date = p_effective_end_date,
      status = normalized_status,
      updated_by = actor_user_id
    where id = before_row.id
    returning * into after_row;
  end if;

  insert into public.admin_audit_log (
    actor_user_id, action, entity_type, entity_id, target_user_id, before, after, meta
  ) values (
    actor_user_id,
    case when before_row.id is null
      then 'operator_recurring_compensation.created'
      else 'operator_recurring_compensation.updated'
    end,
    'operator_recurring_compensation_item',
    after_row.id::text,
    profile_row.user_id,
    coalesce(to_jsonb(before_row), '{}'::jsonb),
    to_jsonb(after_row),
    jsonb_build_object('approval_required', false, 'payment_execution', false)
  );

  return to_jsonb(after_row);
end;
$$;

create or replace function public.admin_upsert_operator_ytd_opening_balance(
  p_account_id uuid,
  p_operator_profile_id uuid,
  p_calendar_year integer,
  p_balance_through_date date,
  p_actual_minutes integer default 0,
  p_paid_shift_count integer default 0,
  p_commissionable_sales_cents bigint default 0,
  p_shift_earnings_cents bigint default 0,
  p_commission_earnings_cents bigint default 0,
  p_bonus_cents bigint default 0,
  p_supply_credit_cents bigint default 0,
  p_expense_reimbursement_cents bigint default 0
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  actor_user_id uuid;
  profile_row public.operator_payout_profiles;
  before_row public.operator_ytd_opening_balances;
  after_row public.operator_ytd_opening_balances;
begin
  actor_user_id := auth.uid();

  if actor_user_id is null then
    raise exception 'Authentication required';
  end if;

  if not coalesce(
    public.can_manage_operator_payout_account(actor_user_id, p_account_id),
    false
  ) then
    raise exception 'Technician compensation access required';
  end if;

  select * into profile_row
  from public.operator_payout_profiles profile
  where profile.id = p_operator_profile_id
    and profile.account_id = p_account_id;

  if profile_row.id is null then
    raise exception 'Technician pay profile not found for account';
  end if;

  if p_calendar_year not between 2000 and 2200
    or p_balance_through_date is null
    or extract(year from p_balance_through_date)::integer <> p_calendar_year
    or coalesce(p_actual_minutes, 0) < 0
    or coalesce(p_paid_shift_count, 0) < 0
    or coalesce(p_commissionable_sales_cents, 0) < 0
    or coalesce(p_shift_earnings_cents, 0) < 0
    or coalesce(p_commission_earnings_cents, 0) < 0
    or coalesce(p_bonus_cents, 0) < 0
    or coalesce(p_supply_credit_cents, 0) < 0
    or coalesce(p_expense_reimbursement_cents, 0) < 0 then
    raise exception 'Opening year-to-date balance is invalid';
  end if;

  select * into before_row
  from public.operator_ytd_opening_balances balance
  where balance.operator_profile_id = p_operator_profile_id
    and balance.calendar_year = p_calendar_year
  for update;

  insert into public.operator_ytd_opening_balances (
    account_id,
    operator_profile_id,
    calendar_year,
    balance_through_date,
    actual_minutes,
    paid_shift_count,
    commissionable_sales_cents,
    shift_earnings_cents,
    commission_earnings_cents,
    bonus_cents,
    supply_credit_cents,
    expense_reimbursement_cents,
    created_by,
    updated_by
  ) values (
    p_account_id,
    p_operator_profile_id,
    p_calendar_year,
    p_balance_through_date,
    coalesce(p_actual_minutes, 0),
    coalesce(p_paid_shift_count, 0),
    coalesce(p_commissionable_sales_cents, 0),
    coalesce(p_shift_earnings_cents, 0),
    coalesce(p_commission_earnings_cents, 0),
    coalesce(p_bonus_cents, 0),
    coalesce(p_supply_credit_cents, 0),
    coalesce(p_expense_reimbursement_cents, 0),
    actor_user_id,
    actor_user_id
  )
  on conflict (operator_profile_id, calendar_year)
  do update set
    account_id = excluded.account_id,
    balance_through_date = excluded.balance_through_date,
    actual_minutes = excluded.actual_minutes,
    paid_shift_count = excluded.paid_shift_count,
    commissionable_sales_cents = excluded.commissionable_sales_cents,
    shift_earnings_cents = excluded.shift_earnings_cents,
    commission_earnings_cents = excluded.commission_earnings_cents,
    bonus_cents = excluded.bonus_cents,
    supply_credit_cents = excluded.supply_credit_cents,
    expense_reimbursement_cents = excluded.expense_reimbursement_cents,
    updated_by = actor_user_id
  returning * into after_row;

  insert into public.admin_audit_log (
    actor_user_id, action, entity_type, entity_id, target_user_id, before, after, meta
  ) values (
    actor_user_id,
    case when before_row.id is null
      then 'operator_ytd_opening_balance.created'
      else 'operator_ytd_opening_balance.updated'
    end,
    'operator_ytd_opening_balance',
    after_row.id::text,
    profile_row.user_id,
    coalesce(to_jsonb(before_row), '{}'::jsonb),
    to_jsonb(after_row),
    jsonb_build_object('payment_execution', false, 'tax_calculation', false)
  );

  return to_jsonb(after_row);
end;
$$;

comment on function public.operator_paid_shift_count(integer) is
  'Canonical per-entry one-hour pay-unit calculation: ceiling(actual minutes / 60).';
comment on function public.operator_time_entry_cutoff_at(date) is
  'Technician edit cutoff at 00:00 America/Los_Angeles on the fifth day after month-end.';
comment on function public.operator_worker_notice_code(text) is
  'Profile-driven Pay Stub notice selector; contractor profiles use the independent-contractor/no-withholding notice.';
comment on function public.save_operator_time_entry(uuid, uuid, uuid, timestamptz, timestamptz, text) is
  'Technician-owned completed-time create/update path with exact timestamps, cutoff, assignment, overlap, and per-entry shift enforcement.';
comment on function public.manager_correct_operator_time_entry(uuid, uuid, timestamptz, timestamptz, text, boolean) is
  'Machine-scoped manager correction path. Works after cutoff, requires no approval or reason, and retains before/after audit history.';
comment on function public.admin_upsert_operator_machine_assignment(uuid, uuid, uuid, date, date) is
  'Audited effective-dated Technician-to-machine assignment maintenance with overlap prevention.';
comment on function public.operator_compensation_rate_at(uuid, uuid, uuid, date, text) is
  'Resolves an effective Technician shift rate or commission rate; commission uses an explicit Technician-machine override before the Technician default.';
comment on function public.admin_upsert_operator_compensation_rate(uuid, uuid, uuid, uuid, text, integer, date, date, text, text) is
  'Audited effective-dated Technician shift or commission rate maintenance without an approval workflow.';
comment on table public.operator_recurring_compensation_items is
  'Effective-dated manager-maintained bonus, supply credit, and reimbursement inputs for contractor Pay Stubs.';
comment on table public.operator_ytd_opening_balances is
  'Audited opening calendar-year totals used when portal Pay Stubs begin after January.';
comment on table public.time_entry_change_events is
  'Immutable before/after history for Technician changes and manager corrections to time entries.';

revoke execute on function public.operator_paid_shift_count(integer)
  from public, anon;
revoke execute on function public.operator_time_entry_cutoff_at(date)
  from public, anon;
revoke execute on function public.operator_worker_notice_code(text)
  from public, anon;
revoke execute on function public.set_operator_time_entry_durations()
  from public, anon, authenticated;
revoke execute on function public.validate_operator_time_entry_assignment()
  from public, anon, authenticated;
revoke execute on function public.reset_operator_time_entry_manager_review()
  from public, anon, authenticated;
revoke execute on function public.record_time_entry_change_event()
  from public, anon, authenticated;
revoke execute on function public.operator_time_entry_payload(uuid)
  from public, anon, authenticated;
revoke execute on function public.save_operator_time_entry(uuid, uuid, uuid, timestamptz, timestamptz, text)
  from public, anon;
revoke execute on function public.manager_correct_operator_time_entry(uuid, uuid, timestamptz, timestamptz, text, boolean)
  from public, anon;
revoke execute on function public.admin_upsert_operator_machine_assignment(uuid, uuid, uuid, date, date)
  from public, anon;
revoke execute on function public.operator_compensation_rate_at(uuid, uuid, uuid, date, text)
  from public, anon, authenticated;
revoke execute on function public.admin_upsert_operator_compensation_rate(uuid, uuid, uuid, uuid, text, integer, date, date, text, text)
  from public, anon;
revoke execute on function public.admin_upsert_operator_recurring_item(uuid, uuid, uuid, text, text, integer, date, date, text)
  from public, anon;
revoke execute on function public.admin_upsert_operator_ytd_opening_balance(uuid, uuid, integer, date, integer, integer, bigint, bigint, bigint, bigint, bigint, bigint)
  from public, anon;

grant execute on function public.operator_paid_shift_count(integer) to authenticated;
grant execute on function public.operator_time_entry_cutoff_at(date) to authenticated;
grant execute on function public.operator_worker_notice_code(text) to authenticated;
grant execute on function public.set_operator_time_entry_durations() to service_role;
grant execute on function public.validate_operator_time_entry_assignment() to service_role;
grant execute on function public.reset_operator_time_entry_manager_review() to service_role;
grant execute on function public.record_time_entry_change_event() to service_role;
grant execute on function public.operator_time_entry_payload(uuid) to service_role;
grant execute on function public.save_operator_time_entry(uuid, uuid, uuid, timestamptz, timestamptz, text)
  to authenticated;
grant execute on function public.manager_correct_operator_time_entry(uuid, uuid, timestamptz, timestamptz, text, boolean)
  to authenticated;
grant execute on function public.admin_upsert_operator_machine_assignment(uuid, uuid, uuid, date, date)
  to authenticated;
grant execute on function public.operator_compensation_rate_at(uuid, uuid, uuid, date, text)
  to service_role;
grant execute on function public.admin_upsert_operator_compensation_rate(uuid, uuid, uuid, uuid, text, integer, date, date, text, text)
  to authenticated;
grant execute on function public.admin_upsert_operator_recurring_item(uuid, uuid, uuid, text, text, integer, date, date, text)
  to authenticated;
grant execute on function public.admin_upsert_operator_ytd_opening_balance(uuid, uuid, integer, date, integer, integer, bigint, bigint, bigint, bigint, bigint, bigint)
  to authenticated;

select pg_notify('pgrst', 'reload schema');
