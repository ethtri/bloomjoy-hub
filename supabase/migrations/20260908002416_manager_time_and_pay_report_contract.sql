-- #1215: read-only manager Time Report and account-authorized Technician Pay Report.
--
-- This migration does not approve time, execute payment, mark payment complete,
-- calculate withholding, or generate tax forms. It keeps manager time correction
-- on the existing audited manager_correct_operator_time_entry RPC.

create schema if not exists private;
revoke all on schema private from public, anon, authenticated;
grant usage on schema private to service_role;

-- Pay details are account-sensitive. The original proof-of-concept also let a
-- machine-only manager inherit payout-run and Pay Stub reads from one machine.
-- Keep Time Report corrections machine-scoped, but remove that inheritance
-- from every existing payout table policy that calls these helpers.
create or replace function public.can_access_payout_run(
  p_user_id uuid,
  p_payout_run_id uuid
)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select p_user_id is not null
    and p_payout_run_id is not null
    and exists (
      select 1
      from public.payout_runs run
      where run.id = p_payout_run_id
        and (
          public.is_super_admin(p_user_id)
          or public.can_manage_operator_payout_account(p_user_id, run.account_id)
        )
    );
$$;

create or replace function public.can_access_payout_run_item(
  p_user_id uuid,
  p_payout_run_item_id uuid
)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select p_user_id is not null
    and p_payout_run_item_id is not null
    and exists (
      select 1
      from public.payout_run_items item
      where item.id = p_payout_run_item_id
        and (
          public.is_super_admin(p_user_id)
          or public.can_manage_operator_payout_account(p_user_id, item.account_id)
        )
    );
$$;

create or replace function public.can_access_pay_statement(
  p_user_id uuid,
  p_pay_statement_id uuid
)
returns boolean
language sql
stable
security definer
set search_path = ''
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
          or public.is_super_admin(p_user_id)
          or public.can_manage_operator_payout_account(p_user_id, statement.account_id)
        )
    );
$$;

drop policy if exists "compensation_rules_select_manager"
  on public.compensation_rules;
create policy "compensation_rules_select_manager"
on public.compensation_rules
for select
to authenticated
using (public.can_manage_operator_payout_account_current_user(account_id));

drop policy if exists "payout_run_item_machines_select_accessible"
  on public.payout_run_item_machines;
create policy "payout_run_item_machines_select_accessible"
on public.payout_run_item_machines
for select
to authenticated
using (public.can_access_payout_run_item_current_user(payout_run_item_id));

create or replace function public.get_my_admin_access_context()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  actor_user_id uuid;
  actor_is_super_admin boolean;
  actor_machine_ids uuid[];
  actor_is_scoped_admin boolean;
  actor_is_refund_manager boolean;
  actor_can_manage_payouts boolean;
  allowed_surfaces text[];
begin
  actor_user_id := auth.uid();

  if actor_user_id is null then
    return jsonb_build_object(
      'isSuperAdmin', false,
      'isScopedAdmin', false,
      'canAccessAdmin', false,
      'allowedSurfaces', '[]'::jsonb,
      'scopedMachineIds', '[]'::jsonb
    );
  end if;

  actor_is_super_admin := public.is_super_admin(actor_user_id);
  actor_machine_ids := coalesce(public.scoped_admin_machine_ids(actor_user_id), '{}'::uuid[]);
  actor_is_scoped_admin := public.is_scoped_admin(actor_user_id);
  actor_is_refund_manager := public.user_is_refund_manager(actor_user_id);
  actor_can_manage_payouts := exists (
    select 1
    from public.customer_accounts account
    where public.can_manage_operator_payout_account(actor_user_id, account.id)
  );

  if actor_is_super_admin then
    allowed_surfaces := array['*'];
  else
    allowed_surfaces := '{}'::text[];

    if actor_is_scoped_admin then
      allowed_surfaces := allowed_surfaces || array[
        'overview',
        'orders',
        'support',
        'accounts',
        'machines',
        'access',
        'audit',
        'reporting_access',
        'refunds',
        'partnerships'
      ];
    end if;

    if actor_is_refund_manager then
      allowed_surfaces := allowed_surfaces || array['refunds'];
    end if;

    if actor_can_manage_payouts then
      allowed_surfaces := allowed_surfaces || array['payouts'];
    end if;
  end if;

  return jsonb_build_object(
    'isSuperAdmin', actor_is_super_admin,
    'isScopedAdmin', actor_is_scoped_admin,
    'canAccessAdmin',
      actor_is_super_admin
      or actor_is_scoped_admin
      or actor_is_refund_manager
      or actor_can_manage_payouts,
    'allowedSurfaces', to_jsonb(array(
      select distinct surface
      from unnest(allowed_surfaces) as surface
    )),
    'scopedMachineIds', to_jsonb(actor_machine_ids)
  );
end;
$$;

create or replace function public.get_my_time_report_access()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select auth.uid() is not null
    and exists (
      select 1
      from public.reporting_machines machine
      where public.can_manage_operator_payout_machine(auth.uid(), machine.id)
    );
$$;

-- A rate change is one manager action. The database closes the prior effective
-- rate on the preceding day and creates the replacement atomically, preserving
-- both effective-dated history and the existing audit trail.
create or replace function public.admin_supersede_operator_compensation_rate(
  p_account_id uuid,
  p_operator_profile_id uuid,
  p_reporting_machine_id uuid,
  p_rate_type text,
  p_rate_value integer,
  p_effective_start_date date,
  p_effective_end_date date default null,
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
  prior_rule public.compensation_rules;
  prior_rate_value integer;
  lock_key text;
begin
  actor_user_id := auth.uid();
  normalized_type := lower(trim(coalesce(p_rate_type, '')));

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

  lock_key := concat_ws(
    ':',
    p_operator_profile_id::text,
    coalesce(p_reporting_machine_id::text, 'default'),
    normalized_type
  );
  perform pg_advisory_xact_lock(hashtextextended(lock_key, 0));

  select rule.*
  into prior_rule
  from public.compensation_rules rule
  where rule.account_id = p_account_id
    and rule.operator_profile_id = p_operator_profile_id
    and rule.reporting_machine_id is not distinct from p_reporting_machine_id
    and rule.status = 'active'
    and p_effective_start_date between rule.effective_start_date
      and coalesce(rule.effective_end_date, 'infinity'::date)
    and (
      (normalized_type = 'shift' and rule.shift_rate_cents is not null)
      or (normalized_type = 'commission' and rule.commission_basis_points is not null)
    )
  order by rule.effective_start_date desc, rule.created_at desc, rule.id
  limit 1
  for update;

  if prior_rule.id is not null and prior_rule.effective_start_date = p_effective_start_date then
    return public.admin_upsert_operator_compensation_rate(
      prior_rule.id,
      p_account_id,
      p_operator_profile_id,
      p_reporting_machine_id,
      normalized_type,
      p_rate_value,
      p_effective_start_date,
      p_effective_end_date,
      'active',
      p_notes
    );
  end if;

  if prior_rule.id is not null then
    prior_rate_value := case
      when normalized_type = 'shift' then prior_rule.shift_rate_cents
      else prior_rule.commission_basis_points
    end;

    perform public.admin_upsert_operator_compensation_rate(
      prior_rule.id,
      p_account_id,
      p_operator_profile_id,
      p_reporting_machine_id,
      normalized_type,
      prior_rate_value,
      prior_rule.effective_start_date,
      p_effective_start_date - 1,
      'active',
      prior_rule.notes
    );
  end if;

  return public.admin_upsert_operator_compensation_rate(
    null,
    p_account_id,
    p_operator_profile_id,
    p_reporting_machine_id,
    normalized_type,
    p_rate_value,
    p_effective_start_date,
    p_effective_end_date,
    'active',
    p_notes
  );
end;
$$;

-- Report-specific convenience action: refresh every monthly sales snapshot the
-- caller may manage, including historically valid assignments later revoked.
create or replace function public.admin_refresh_technician_pay_report_sales(
  p_month date default current_date,
  p_account_id uuid default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  actor_user_id uuid;
  period_start date;
  period_end date;
  period_row public.payout_periods;
  machine_id uuid;
  period_count integer := 0;
  snapshot_count integer := 0;
begin
  actor_user_id := auth.uid();
  period_start := date_trunc('month', coalesce(p_month, current_date)::timestamp)::date;
  period_end := (period_start + interval '1 month - 1 day')::date;

  if actor_user_id is null then
    raise exception 'Authentication required';
  end if;

  if p_account_id is not null and not coalesce(
    public.can_manage_operator_payout_account(actor_user_id, p_account_id),
    false
  ) then
    raise exception 'Technician compensation access required';
  end if;

  for period_row in
    select period.*
    from public.payout_periods period
    where period.period_start_date = period_start
      and period.period_end_date = period_end
      and period.status <> 'voided'
      and (p_account_id is null or period.account_id = p_account_id)
      and public.can_manage_operator_payout_account(actor_user_id, period.account_id)
    order by period.account_id, period.id
  loop
    period_count := period_count + 1;

    for machine_id in
      select distinct assignment.reporting_machine_id
      from public.operator_machine_assignments assignment
      where assignment.account_id = period_row.account_id
        and assignment.effective_start_date <= period_row.period_end_date
        and coalesce(assignment.effective_end_date, 'infinity'::date) >= period_row.period_start_date
      order by assignment.reporting_machine_id
    loop
      perform public.admin_generate_payout_revenue_snapshot(
        period_row.id,
        machine_id,
        true,
        'Technician Pay Report sales refresh'
      );
      snapshot_count := snapshot_count + 1;
    end loop;
  end loop;

  return jsonb_build_object(
    'periodCount', period_count,
    'snapshotCount', snapshot_count
  );
end;
$$;

-- Manager corrections may use an assignment that covered the corrected work
-- date even if that assignment was revoked later. Technician writes still
-- require the assignment to be currently active.
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
      and assignment.effective_start_date <= new.work_date
      and (
        assignment.effective_end_date is null
        or assignment.effective_end_date >= new.work_date
      )
      and (
        (
          manager_correction
          and coalesce(
            public.can_manage_operator_payout_machine(auth.uid(), new.reporting_machine_id),
            false
          )
        )
        or (assignment.status = 'active' and assignment.revoked_at is null)
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
declare
  manager_correction boolean;
begin
  manager_correction := coalesce(
    current_setting('app.timekeeping_manager_correction', true),
    ''
  ) = 'true';

  if new.work_date > (now() at time zone 'America/Los_Angeles')::date then
    raise exception 'Future work dates are not allowed';
  end if;

  if not exists (
    select 1
    from public.operator_machine_assignments assignment
    where assignment.operator_profile_id = new.operator_profile_id
      and assignment.reporting_machine_id = new.reporting_machine_id
      and assignment.effective_start_date <= new.work_date
      and (
        assignment.effective_end_date is null
        or assignment.effective_end_date >= new.work_date
      )
      and (
        (
          manager_correction
          and coalesce(
            public.can_manage_operator_payout_machine(auth.uid(), new.reporting_machine_id),
            false
          )
        )
        or (assignment.status = 'active' and assignment.revoked_at is null)
      )
  ) then
    raise exception 'Time entry machine is not assigned for this work date';
  end if;

  return new;
end;
$$;

-- Managers may correct historical time after an assignment is later revoked.
-- The work-date effective window is authoritative; current assignment status
-- must not erase valid historical scope.
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
      work_date = work_date_local,
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

-- Replace the legacy approval-queue projection with canonical completed-time
-- fields. Access remains machine-scoped: account pay authority is not required
-- to correct time, and one machine manager never sees another machine.
create or replace function public.get_my_time_review_context(
  p_work_date date default current_date
)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  actor_user_id uuid;
  target_work_date date;
  period_start date;
  period_end date;
  result jsonb;
begin
  actor_user_id := auth.uid();
  target_work_date := coalesce(p_work_date, current_date);
  period_start := date_trunc('month', target_work_date::timestamp)::date;
  period_end := (date_trunc('month', target_work_date::timestamp) + interval '1 month - 1 day')::date;

  if actor_user_id is null then
    raise exception 'Authentication required';
  end if;

  with manageable_machines as materialized (
    select
      machine.id,
      machine.account_id,
      machine.machine_label,
      location.id as location_id,
      location.name as location_name
    from public.reporting_machines machine
    join public.reporting_locations location on location.id = machine.location_id
    where coalesce(
      public.can_manage_operator_payout_machine(actor_user_id, machine.id),
      false
    )
  ),
  visible_entries as materialized (
    select
      entry.*,
      account.name as account_name,
      profile.display_name as operator_name,
      machine.machine_label,
      machine.location_name
    from public.time_entries entry
    join manageable_machines machine on machine.id = entry.reporting_machine_id
    join public.operator_payout_profiles profile on profile.id = entry.operator_profile_id
    join public.customer_accounts account on account.id = entry.account_id
    where entry.work_date between period_start and period_end
      and entry.status <> 'voided'
  )
  select jsonb_build_object(
    'workDate', target_work_date,
    'periodStartDate', period_start,
    'periodEndDate', period_end,
    'hasAccess', exists (select 1 from manageable_machines),
    'machines', coalesce((
      select jsonb_agg(
        jsonb_build_object(
          'machineId', machine.id,
          'machineLabel', machine.machine_label,
          'locationId', machine.location_id,
          'locationName', machine.location_name
        )
        order by machine.location_name, machine.machine_label, machine.id
      )
      from manageable_machines machine
    ), '[]'::jsonb),
    'technicians', coalesce((
      select jsonb_agg(
        jsonb_build_object(
          'operatorProfileId', summary.operator_profile_id,
          'operatorName', summary.operator_name,
          'actualDurationMinutes', summary.actual_duration_minutes,
          'paidShifts', summary.paid_shifts,
          'entryCount', summary.entry_count,
          'machines', summary.machines
        )
        order by summary.operator_name, summary.operator_profile_id
      )
      from (
        select
          entry.operator_profile_id,
          entry.operator_name,
          sum(entry.raw_duration_minutes)::integer as actual_duration_minutes,
          sum(entry.paid_shift_count)::integer as paid_shifts,
          count(*)::integer as entry_count,
          (
            select jsonb_agg(jsonb_build_object(
              'machineId', machine_summary.reporting_machine_id,
              'machineLabel', machine_summary.machine_label,
              'locationId', machine_summary.reporting_location_id,
              'locationName', machine_summary.location_name
            ) order by machine_summary.location_name, machine_summary.machine_label, machine_summary.reporting_machine_id)
            from (
              select distinct
                machine_entry.reporting_machine_id,
                machine_entry.machine_label,
                machine_entry.reporting_location_id,
                machine_entry.location_name
              from visible_entries machine_entry
              where machine_entry.operator_profile_id = entry.operator_profile_id
            ) machine_summary
          ) as machines
        from visible_entries entry
        group by entry.operator_profile_id, entry.operator_name
      ) summary
    ), '[]'::jsonb),
    'entries', coalesce((
      select jsonb_agg(
        jsonb_build_object(
          'id', entry.id,
          'accountId', entry.account_id,
          'accountName', entry.account_name,
          'operatorProfileId', entry.operator_profile_id,
          'operatorName', entry.operator_name,
          'machineId', entry.reporting_machine_id,
          'machineLabel', entry.machine_label,
          'locationId', entry.reporting_location_id,
          'locationName', entry.location_name,
          'payoutPolicyId', entry.payout_policy_id,
          'payoutPeriodId', entry.payout_period_id,
          'workDate', entry.work_date,
          'startTime', to_char(entry.actual_start_at at time zone 'America/Los_Angeles', 'HH24:MI'),
          'endTime', to_char(entry.actual_end_at at time zone 'America/Los_Angeles', 'HH24:MI'),
          'actualStartAt', entry.actual_start_at,
          'actualEndAt', entry.actual_end_at,
          'actualDurationMinutes', entry.raw_duration_minutes,
          'rawDurationMinutes', entry.raw_duration_minutes,
          'paidShifts', entry.paid_shift_count,
          'roundedPaidMinutes', entry.rounded_paid_minutes,
          'notes', entry.notes,
          'status', entry.status,
          'technicianCutoffAt', public.operator_time_entry_cutoff_at(entry.work_date),
          'lockedAt', entry.locked_at,
          'createdAt', entry.created_at,
          'updatedAt', entry.updated_at
        )
        order by entry.work_date desc, entry.actual_start_at desc, entry.operator_name, entry.id
      )
      from visible_entries entry
    ), '[]'::jsonb),
    'capabilities', jsonb_build_object(
      'canCorrectTime', exists (select 1 from manageable_machines),
      'approvalRequired', false,
      'paymentExecution', false
    )
  )
  into result;

  return coalesce(result, jsonb_build_object(
    'workDate', target_work_date,
    'periodStartDate', period_start,
    'periodEndDate', period_end,
    'hasAccess', false,
    'machines', '[]'::jsonb,
    'technicians', '[]'::jsonb,
    'entries', '[]'::jsonb,
    'capabilities', jsonb_build_object(
      'canCorrectTime', false,
      'approvalRequired', false,
      'paymentExecution', false
    )
  ));
end;
$$;

-- Deterministic calculation truth for the manager report and later Pay Stub
-- generation. It is intentionally kept outside the exposed public schema and
-- is callable only by trusted database code/service_role.
create or replace function private.calculate_technician_pay_report(
  p_account_id uuid,
  p_operator_profile_id uuid,
  p_period_start_date date,
  p_period_end_date date
)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  with profile_context as (
    select
      profile.id,
      profile.account_id,
      profile.user_id,
      profile.display_name,
      profile.worker_type,
      profile.worker_identifier,
      profile.position_title
    from public.operator_payout_profiles profile
    where profile.id = p_operator_profile_id
      and profile.account_id = p_account_id
  ),
  entry_base as materialized (
    select
      entry.id,
      entry.work_date,
      entry.actual_start_at,
      entry.actual_end_at,
      entry.raw_duration_minutes as actual_duration_minutes,
      entry.paid_shift_count,
      entry.reporting_machine_id,
      entry.reporting_location_id,
      machine.machine_label,
      location.name as location_name,
      public.operator_compensation_rate_at(
        entry.account_id,
        entry.operator_profile_id,
        entry.reporting_machine_id,
        entry.work_date,
        'shift'
      ) as shift_rate
    from public.time_entries entry
    join public.reporting_machines machine on machine.id = entry.reporting_machine_id
    join public.reporting_locations location on location.id = entry.reporting_location_id
    where entry.account_id = p_account_id
      and entry.operator_profile_id = p_operator_profile_id
      and entry.work_date between p_period_start_date and p_period_end_date
      and entry.status <> 'voided'
  ),
  entry_lines as materialized (
    select
      entry.*,
      nullif(entry.shift_rate ->> 'shiftRateCents', '')::integer as shift_rate_cents,
      case
        when entry.shift_rate is null then 0
        else entry.paid_shift_count
          * nullif(entry.shift_rate ->> 'shiftRateCents', '')::integer
      end as shift_earnings_cents
    from entry_base entry
  ),
  assignment_windows as materialized (
    select
      assignment.reporting_machine_id,
      machine.machine_label,
      machine.location_id,
      location.name as location_name,
      greatest(assignment.effective_start_date, p_period_start_date) as assigned_start_date,
      least(coalesce(assignment.effective_end_date, p_period_end_date), p_period_end_date) as assigned_end_date
    from public.operator_machine_assignments assignment
    join public.reporting_machines machine
      on machine.id = assignment.reporting_machine_id
      and machine.account_id = p_account_id
    join public.reporting_locations location on location.id = machine.location_id
    where assignment.operator_profile_id = p_operator_profile_id
      and assignment.account_id = p_account_id
      and assignment.effective_start_date <= p_period_end_date
      and coalesce(assignment.effective_end_date, 'infinity'::date) >= p_period_start_date
  ),
  assigned_machines as materialized (
    select
      assignment.reporting_machine_id,
      assignment.machine_label,
      assignment.location_id,
      assignment.location_name,
      min(assignment.assigned_start_date) as assigned_start_date,
      max(assignment.assigned_end_date) as assigned_end_date,
      not exists (
        select 1
        from generate_series(
          p_period_start_date::timestamp,
          p_period_end_date::timestamp,
          interval '1 day'
        ) day_value
        where not exists (
          select 1
          from assignment_windows coverage
          where coverage.reporting_machine_id = assignment.reporting_machine_id
            and day_value::date between coverage.assigned_start_date and coverage.assigned_end_date
        )
      ) as full_period_scope,
      exists (
        select 1
        from assignment_windows own_assignment
        join public.operator_machine_assignments other_assignment
          on other_assignment.reporting_machine_id = own_assignment.reporting_machine_id
          and other_assignment.operator_profile_id <> p_operator_profile_id
          and daterange(
            own_assignment.assigned_start_date,
            own_assignment.assigned_end_date + 1,
            '[)'
          ) && daterange(
            greatest(other_assignment.effective_start_date, p_period_start_date),
            least(coalesce(other_assignment.effective_end_date, p_period_end_date), p_period_end_date) + 1,
            '[)'
          )
        where own_assignment.reporting_machine_id = assignment.reporting_machine_id
          and other_assignment.effective_start_date <= p_period_end_date
          and coalesce(other_assignment.effective_end_date, 'infinity'::date) >= p_period_start_date
      ) as shared_compensation_scope
    from assignment_windows assignment
    group by
      assignment.reporting_machine_id,
      assignment.machine_label,
      assignment.location_id,
      assignment.location_name
  ),
  assigned_days as materialized (
    select
      assigned.reporting_machine_id,
      assigned.machine_label,
      assigned.location_id,
      assigned.location_name,
      assigned.assigned_start_date,
      assigned.assigned_end_date,
      assigned.full_period_scope,
      assigned.shared_compensation_scope,
      day_value::date as sales_date,
      public.operator_compensation_rate_at(
        p_account_id,
        p_operator_profile_id,
        assigned.reporting_machine_id,
        day_value::date,
        'commission'
      ) as commission_rate,
      coalesce(sales.gross_sales_cents, 0)::bigint as gross_sales_cents,
      coalesce(sales.source_sales_row_count, 0)::integer as source_sales_row_count,
      coalesce(refunds.refund_adjustment_cents, 0)::bigint as refund_adjustment_cents,
      coalesce(refunds.source_adjustment_row_count, 0)::integer as source_adjustment_row_count
    from assigned_machines assigned
    cross join lateral generate_series(
      assigned.assigned_start_date::timestamp,
      assigned.assigned_end_date::timestamp,
      interval '1 day'
    ) day_value
    left join lateral (
      select
        coalesce(sum(fact.net_sales_cents), 0)::bigint as gross_sales_cents,
        count(*)::integer as source_sales_row_count
      from public.machine_sales_facts fact
      where fact.reporting_machine_id = assigned.reporting_machine_id
        and fact.sale_date = day_value::date
    ) sales on true
    left join lateral (
      select
        coalesce(sum(adjustment.amount_cents), 0)::bigint as refund_adjustment_cents,
        count(*)::integer as source_adjustment_row_count
      from public.sales_adjustment_facts adjustment
      where adjustment.reporting_machine_id = assigned.reporting_machine_id
        and adjustment.adjustment_date = day_value::date
        and adjustment.adjustment_type in ('refund', 'complaint_refund')
        and adjustment.amount_cents > 0
    ) refunds on true
    where exists (
      select 1
      from assignment_windows coverage
      where coverage.reporting_machine_id = assigned.reporting_machine_id
        and day_value::date between coverage.assigned_start_date and coverage.assigned_end_date
    )
  ),
  segmented_days as materialized (
    select
      day_row.*,
      day_row.sales_date - row_number() over (
        partition by
          day_row.reporting_machine_id,
          coalesce(day_row.commission_rate ->> 'ruleId', 'missing'),
          coalesce(day_row.commission_rate ->> 'commissionBasisPoints', 'missing')
        order by day_row.sales_date
      )::integer as segment_group
    from assigned_days day_row
  ),
  commission_segments as materialized (
    select
      day_row.reporting_machine_id,
      day_row.machine_label,
      day_row.location_id,
      day_row.location_name,
      min(day_row.sales_date) as segment_start_date,
      max(day_row.sales_date) as segment_end_date,
      (array_agg(day_row.commission_rate order by day_row.sales_date))[1] as commission_rate,
      nullif(day_row.commission_rate ->> 'commissionBasisPoints', '')::integer
        as commission_basis_points,
      sum(day_row.gross_sales_cents)::bigint as gross_sales_cents,
      sum(day_row.refund_adjustment_cents)::bigint as refund_adjustment_cents,
      (
        sum(day_row.gross_sales_cents) - sum(day_row.refund_adjustment_cents)
      )::bigint as net_revenue_cents,
      greatest(
        sum(day_row.gross_sales_cents) - sum(day_row.refund_adjustment_cents),
        0
      )::bigint as eligible_commission_revenue_cents,
      sum(day_row.source_sales_row_count)::integer as source_sales_row_count,
      sum(day_row.source_adjustment_row_count)::integer as source_adjustment_row_count,
      max(day_row.sales_date) filter (where day_row.source_sales_row_count > 0)
        as source_latest_sale_date
    from segmented_days day_row
    group by
      day_row.reporting_machine_id,
      day_row.machine_label,
      day_row.location_id,
      day_row.location_name,
      day_row.commission_rate,
      day_row.segment_group
  ),
  commission_machine_scope as materialized (
    select
      segment.reporting_machine_id,
      (count(distinct segment.commission_basis_points)
        filter (where segment.commission_basis_points is not null))::integer
        as commission_rate_count,
      bool_or(segment.commission_rate is null) as commission_rate_missing_day,
      (
        count(distinct segment.commission_basis_points)
          filter (where segment.commission_basis_points is not null) > 1
        and bool_or(segment.net_revenue_cents < 0)
      ) as cross_rate_refund_allocation_ambiguous,
      greatest(sum(segment.net_revenue_cents), 0)::bigint
        as eligible_commission_revenue_cents,
      case
        when bool_or(segment.commission_rate is null) then 0
        when count(distinct segment.commission_basis_points)
          filter (where segment.commission_basis_points is not null) > 1
          and bool_or(segment.net_revenue_cents < 0)
        then 0
        when count(distinct segment.commission_basis_points)
          filter (where segment.commission_basis_points is not null) = 1
        then round(
          greatest(sum(segment.net_revenue_cents), 0)::numeric
          * max(segment.commission_basis_points)
          / 10000
        )::integer
        else sum(round(
          segment.eligible_commission_revenue_cents::numeric
          * segment.commission_basis_points
          / 10000
        ))::integer
      end as commission_earnings_cents
    from commission_segments segment
    group by segment.reporting_machine_id
  ),
  commission_segment_lines as materialized (
    select
      segment.*,
      not scope.cross_rate_refund_allocation_ambiguous
        as commission_allocation_resolved,
      case
        when segment.commission_rate is null
          or scope.cross_rate_refund_allocation_ambiguous
        then 0
        when scope.commission_rate_count = 1 then round(
          segment.net_revenue_cents::numeric
          * segment.commission_basis_points
          / 10000
        )::integer
        else round(
          segment.eligible_commission_revenue_cents::numeric
          * segment.commission_basis_points
          / 10000
        )::integer
      end as commission_earnings_cents
    from commission_segments segment
    join commission_machine_scope scope
      on scope.reporting_machine_id = segment.reporting_machine_id
  ),
  commission_lines as materialized (
    select
      assigned.*,
      snapshot.id as revenue_snapshot_id,
      snapshot.gross_sales_cents as snapshot_gross_sales_cents,
      snapshot.refund_adjustment_cents as snapshot_refund_adjustment_cents,
      snapshot.net_revenue_cents as snapshot_net_revenue_cents,
      snapshot.eligible_commission_revenue_cents as snapshot_commissionable_sales_cents,
      snapshot.source_latest_sale_date as snapshot_source_latest_sale_date,
      snapshot.generated_at as revenue_generated_at,
      snapshot.status as revenue_snapshot_status,
      snapshot.warnings as revenue_warnings,
      coalesce(assigned_totals.gross_sales_cents, 0)::bigint as gross_sales_cents,
      coalesce(assigned_totals.refund_adjustment_cents, 0)::bigint as refund_adjustment_cents,
      coalesce(assigned_totals.net_revenue_cents, 0)::bigint as net_revenue_cents,
      coalesce(assigned_totals.eligible_commission_revenue_cents, 0)::bigint
        as eligible_commission_revenue_cents,
      coalesce(assigned_totals.commission_earnings_cents, 0)::bigint
        as commission_earnings_cents,
      coalesce(assigned_totals.source_sales_row_count, 0)::integer
        as source_sales_row_count,
      coalesce(assigned_totals.source_adjustment_row_count, 0)::integer
        as source_adjustment_row_count,
      assigned_totals.source_latest_sale_date,
      coalesce(assigned_totals.commission_rate_missing_day, true)
        as commission_rate_missing_day,
      coalesce(assigned_totals.commission_rate_count, 0)::integer
        as commission_rate_count,
      coalesce(assigned_totals.cross_rate_refund_allocation_ambiguous, false)
        as cross_rate_refund_allocation_ambiguous,
      assigned_totals.single_commission_rate as commission_rate,
      assigned_totals.single_commission_basis_points as commission_basis_points,
      coalesce(assigned_totals.commission_segments, '[]'::jsonb) as commission_segments,
      coalesce(full_facts.gross_sales_cents, 0)::bigint as full_fact_gross_sales_cents,
      coalesce(full_facts.refund_adjustment_cents, 0)::bigint
        as full_fact_refund_adjustment_cents,
      greatest(
        coalesce(full_facts.gross_sales_cents, 0)
        - coalesce(full_facts.refund_adjustment_cents, 0),
        0
      )::bigint as full_fact_commissionable_sales_cents,
      coalesce(full_facts.source_sales_row_count, 0)::integer
        as full_fact_source_sales_row_count,
      full_facts.source_latest_sale_date as full_fact_source_latest_sale_date,
      snapshot.id is not null
        and snapshot.gross_sales_cents = coalesce(full_facts.gross_sales_cents, 0)
        and snapshot.refund_adjustment_cents = coalesce(full_facts.refund_adjustment_cents, 0)
        and snapshot.eligible_commission_revenue_cents = greatest(
          coalesce(full_facts.gross_sales_cents, 0)
          - coalesce(full_facts.refund_adjustment_cents, 0),
          0
        ) as snapshot_matches_facts
    from assigned_machines assigned
    left join lateral (
      select candidate.*
      from public.payout_period_machine_revenue_snapshots candidate
      where candidate.account_id = p_account_id
        and candidate.reporting_machine_id = assigned.reporting_machine_id
        and candidate.period_start_date = p_period_start_date
        and candidate.period_end_date = p_period_end_date
        and candidate.status <> 'voided'
      order by candidate.updated_at desc, candidate.id
      limit 1
    ) snapshot on true
    left join lateral (
      select
        sum(segment.gross_sales_cents)::bigint as gross_sales_cents,
        sum(segment.refund_adjustment_cents)::bigint as refund_adjustment_cents,
        sum(segment.net_revenue_cents)::bigint as net_revenue_cents,
        max(scope.eligible_commission_revenue_cents)::bigint
          as eligible_commission_revenue_cents,
        max(scope.commission_earnings_cents)::bigint as commission_earnings_cents,
        sum(segment.source_sales_row_count)::integer as source_sales_row_count,
        sum(segment.source_adjustment_row_count)::integer as source_adjustment_row_count,
        max(segment.source_latest_sale_date) as source_latest_sale_date,
        bool_or(scope.commission_rate_missing_day) as commission_rate_missing_day,
        max(scope.commission_rate_count)::integer as commission_rate_count,
        bool_or(scope.cross_rate_refund_allocation_ambiguous)
          as cross_rate_refund_allocation_ambiguous,
        case
          when count(distinct segment.commission_basis_points)
            filter (where segment.commission_basis_points is not null) = 1
          then (array_agg(segment.commission_rate order by segment.segment_start_date))[1]
          else null
        end as single_commission_rate,
        case
          when count(distinct segment.commission_basis_points)
            filter (where segment.commission_basis_points is not null) = 1
          then max(segment.commission_basis_points)
          else null
        end as single_commission_basis_points,
        case
          when max(scope.commission_rate_count) = 1 then jsonb_build_array(
            jsonb_build_object(
              'segmentStartDate', min(segment.segment_start_date),
              'segmentEndDate', max(segment.segment_end_date),
              'commissionRate',
                (array_agg(segment.commission_rate order by segment.segment_start_date))[1],
              'commissionBasisPoints', max(segment.commission_basis_points),
              'grossSalesCents', sum(segment.gross_sales_cents),
              'refundAdjustmentCents', sum(segment.refund_adjustment_cents),
              'netRevenueCents', sum(segment.net_revenue_cents),
              'commissionableSalesCents', max(scope.eligible_commission_revenue_cents),
              'commissionEarningsCents', max(scope.commission_earnings_cents),
              'sourceSalesRowCount', sum(segment.source_sales_row_count),
              'sourceAdjustmentRowCount', sum(segment.source_adjustment_row_count),
              'sourceLatestSaleDate', max(segment.source_latest_sale_date)
            )
          )
          else jsonb_agg(jsonb_build_object(
            'segmentStartDate', segment.segment_start_date,
            'segmentEndDate', segment.segment_end_date,
            'commissionRate', segment.commission_rate,
            'commissionBasisPoints', segment.commission_basis_points,
            'grossSalesCents', segment.gross_sales_cents,
            'refundAdjustmentCents', segment.refund_adjustment_cents,
            'netRevenueCents', segment.net_revenue_cents,
            'commissionableSalesCents', segment.eligible_commission_revenue_cents,
            'commissionEarningsCents', segment.commission_earnings_cents,
            'sourceSalesRowCount', segment.source_sales_row_count,
            'sourceAdjustmentRowCount', segment.source_adjustment_row_count,
            'sourceLatestSaleDate', segment.source_latest_sale_date
          ) order by segment.segment_start_date, segment.segment_end_date)
        end as commission_segments
      from commission_segment_lines segment
      join commission_machine_scope scope
        on scope.reporting_machine_id = segment.reporting_machine_id
      where segment.reporting_machine_id = assigned.reporting_machine_id
    ) assigned_totals on true
    left join lateral (
      select
        sales.gross_sales_cents,
        sales.source_sales_row_count,
        sales.source_latest_sale_date,
        refunds.refund_adjustment_cents
      from (
        select
          coalesce(sum(fact.net_sales_cents), 0)::bigint as gross_sales_cents,
          count(*)::integer as source_sales_row_count,
          max(fact.sale_date) as source_latest_sale_date
        from public.machine_sales_facts fact
        where fact.reporting_machine_id = assigned.reporting_machine_id
          and fact.sale_date between p_period_start_date and p_period_end_date
      ) sales
      cross join (
        select coalesce(sum(adjustment.amount_cents), 0)::bigint
          as refund_adjustment_cents
        from public.sales_adjustment_facts adjustment
        where adjustment.reporting_machine_id = assigned.reporting_machine_id
          and adjustment.adjustment_date between p_period_start_date and p_period_end_date
          and adjustment.adjustment_type in ('refund', 'complaint_refund')
          and adjustment.amount_cents > 0
      ) refunds
    ) full_facts on true
  ),
  recurring_lines as materialized (
    select item.*
    from public.operator_recurring_compensation_items item
    where item.account_id = p_account_id
      and item.operator_profile_id = p_operator_profile_id
      and item.status = 'active'
      and item.effective_start_date <= p_period_end_date
      and coalesce(item.effective_end_date, 'infinity'::date) >= p_period_start_date
  ),
  blockers as materialized (
    select jsonb_build_object(
      'code', 'missing_shift_rate',
      'severity', 'blocker',
      'message', 'Add a shift rate effective on this work date.',
      'operatorProfileId', p_operator_profile_id,
      'timeEntryId', entry.id,
      'workDate', entry.work_date,
      'machineId', entry.reporting_machine_id
    ) as item
    from entry_lines entry
    where entry.shift_rate is null

    union all

    select jsonb_build_object(
      'code', 'unresolved_time_assignment_scope',
      'severity', 'blocker',
      'message', 'Restore or correct the Technician assignment for this time entry.',
      'operatorProfileId', p_operator_profile_id,
      'timeEntryId', entry.id,
      'workDate', entry.work_date,
      'machineId', entry.reporting_machine_id
    )
    from entry_lines entry
    where not exists (
      select 1
      from public.operator_machine_assignments assignment
      where assignment.operator_profile_id = p_operator_profile_id
        and assignment.reporting_machine_id = entry.reporting_machine_id
        and entry.work_date between assignment.effective_start_date
          and coalesce(assignment.effective_end_date, 'infinity'::date)
    )

    union all

    select jsonb_build_object(
      'code', 'missing_revenue_snapshot',
      'severity', 'blocker',
      'message', 'Refresh Commissionable Sales for this machine and month.',
      'operatorProfileId', p_operator_profile_id,
      'machineId', commission.reporting_machine_id
    )
    from commission_lines commission
    where commission.revenue_snapshot_id is null

    union all

    select jsonb_build_object(
      'code', 'missing_commission_rate',
      'severity', 'blocker',
      'message', 'Add a commission rate effective for this machine and month.',
      'operatorProfileId', p_operator_profile_id,
      'machineId', commission.reporting_machine_id
    )
    from commission_lines commission
    where commission.commission_rate_missing_day

    union all

    select jsonb_build_object(
      'code', 'missing_commission_sales_facts',
      'severity', 'blocker',
      'message', 'Load Commissionable Sales facts for this Technician assignment window.',
      'operatorProfileId', p_operator_profile_id,
      'machineId', commission.reporting_machine_id
    )
    from commission_lines commission
    where commission.source_sales_row_count = 0

    union all

    select jsonb_build_object(
      'code', 'stale_commission_sales_facts',
      'severity', 'blocker',
      'message', 'Refresh Commissionable Sales facts through the end of this Technician assignment window.',
      'operatorProfileId', p_operator_profile_id,
      'machineId', commission.reporting_machine_id,
      'sourceLatestSaleDate', commission.source_latest_sale_date,
      'assignedEndDate', commission.assigned_end_date
    )
    from commission_lines commission
    where commission.source_latest_sale_date is not null
      and commission.source_latest_sale_date < commission.assigned_end_date

    union all

    select jsonb_build_object(
      'code', 'revenue_snapshot_fact_mismatch',
      'severity', 'blocker',
      'message', 'Reconcile the monthly revenue snapshot with the authoritative sales and refund facts.',
      'operatorProfileId', p_operator_profile_id,
      'machineId', commission.reporting_machine_id
    )
    from commission_lines commission
    where commission.revenue_snapshot_id is not null
      and not commission.snapshot_matches_facts

    union all

    select jsonb_build_object(
      'code', 'cross_rate_refund_allocation_ambiguous',
      'severity', 'blocker',
      'message', 'Resolve refund attribution across commission-rate periods before publishing.',
      'operatorProfileId', p_operator_profile_id,
      'machineId', commission.reporting_machine_id
    )
    from commission_lines commission
    where commission.cross_rate_refund_allocation_ambiguous

    union all

    select jsonb_build_object(
      'code', 'shared_machine_compensation_scope',
      'severity', 'blocker',
      'message', 'Resolve overlapping Technician assignment dates for this machine before publishing.',
      'operatorProfileId', p_operator_profile_id,
      'machineId', commission.reporting_machine_id
    )
    from commission_lines commission
    where commission.shared_compensation_scope

    union all

    select warning.value || jsonb_build_object(
      'severity', 'blocker',
      'operatorProfileId', p_operator_profile_id,
      'machineId', commission.reporting_machine_id
    )
    from commission_lines commission
    cross join lateral jsonb_array_elements(coalesce(commission.revenue_warnings, '[]'::jsonb)) warning(value)
    where warning.value ->> 'severity' = 'blocker'
      or warning.value ->> 'code' = 'stale_sales_source'
  ),
  warnings as materialized (
    select warning.value || jsonb_build_object(
      'operatorProfileId', p_operator_profile_id,
      'machineId', commission.reporting_machine_id
    ) as item
    from commission_lines commission
    cross join lateral jsonb_array_elements(coalesce(commission.revenue_warnings, '[]'::jsonb)) warning(value)
    where coalesce(warning.value ->> 'severity', 'warning') <> 'blocker'
      and coalesce(warning.value ->> 'code', '') <> 'stale_sales_source'
  ),
  totals as (
    select
      coalesce((select sum(actual_duration_minutes) from entry_lines), 0)::integer
        as actual_duration_minutes,
      coalesce((select sum(paid_shift_count) from entry_lines), 0)::integer
        as paid_shift_count,
      coalesce((select sum(shift_earnings_cents) from entry_lines), 0)::bigint
        as shift_earnings_cents,
      coalesce((select sum(eligible_commission_revenue_cents) from commission_lines), 0)::bigint
        as commissionable_sales_cents,
      coalesce((select sum(commission_earnings_cents) from commission_lines), 0)::bigint
        as commission_earnings_cents,
      coalesce((select sum(amount_cents) from recurring_lines where item_type = 'bonus'), 0)::bigint
        as bonus_cents,
      coalesce((select sum(amount_cents) from recurring_lines where item_type = 'supply_credit'), 0)::bigint
        as supply_credit_cents,
      coalesce((select sum(amount_cents) from recurring_lines where item_type = 'expense_reimbursement'), 0)::bigint
        as expense_reimbursement_cents
  )
  select jsonb_build_object(
    'operatorProfileId', profile.id,
    'accountId', profile.account_id,
    'displayName', profile.display_name,
    'workerType', profile.worker_type,
    'workerIdentifier', profile.worker_identifier,
    'positionTitle', profile.position_title,
    'periodStartDate', p_period_start_date,
    'periodEndDate', p_period_end_date,
    'actualDurationMinutes', totals.actual_duration_minutes,
    'paidShifts', totals.paid_shift_count,
    'shiftEarningsCents', totals.shift_earnings_cents,
    'commissionableSalesCents', totals.commissionable_sales_cents,
    'commissionEarningsCents', totals.commission_earnings_cents,
    'bonusCents', totals.bonus_cents,
    'supplyCreditCents', totals.supply_credit_cents,
    'expenseReimbursementCents', totals.expense_reimbursement_cents,
    'currentTotalCents',
      totals.shift_earnings_cents
      + totals.commission_earnings_cents
      + totals.bonus_cents
      + totals.supply_credit_cents
      + totals.expense_reimbursement_cents,
    'publishable', not exists (select 1 from blockers),
    'entries', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', entry.id,
        'workDate', entry.work_date,
        'actualStartAt', entry.actual_start_at,
        'actualEndAt', entry.actual_end_at,
        'actualDurationMinutes', entry.actual_duration_minutes,
        'paidShifts', entry.paid_shift_count,
        'machineId', entry.reporting_machine_id,
        'machineLabel', entry.machine_label,
        'locationId', entry.reporting_location_id,
        'locationName', entry.location_name,
        'shiftRate', entry.shift_rate,
        'shiftRateCents', entry.shift_rate_cents,
        'shiftEarningsCents', entry.shift_earnings_cents
      ) order by entry.work_date, entry.actual_start_at, entry.id)
      from entry_lines entry
    ), '[]'::jsonb),
    'shiftRateLines', coalesce((
      select jsonb_agg(jsonb_build_object(
        'shiftRateCents', grouped.shift_rate_cents,
        'paidShifts', grouped.paid_shifts,
        'actualDurationMinutes', grouped.actual_duration_minutes,
        'shiftEarningsCents', grouped.shift_earnings_cents,
        'firstWorkDate', grouped.first_work_date,
        'lastWorkDate', grouped.last_work_date
      ) order by grouped.first_work_date, grouped.shift_rate_cents)
      from (
        select
          entry.shift_rate_cents,
          sum(entry.paid_shift_count)::integer as paid_shifts,
          sum(entry.actual_duration_minutes)::integer as actual_duration_minutes,
          sum(entry.shift_earnings_cents)::bigint as shift_earnings_cents,
          min(entry.work_date) as first_work_date,
          max(entry.work_date) as last_work_date
        from entry_lines entry
        group by entry.shift_rate_cents
      ) grouped
    ), '[]'::jsonb),
    'machines', coalesce((
      select jsonb_agg(jsonb_build_object(
        'machineId', commission.reporting_machine_id,
        'machineLabel', commission.machine_label,
        'locationId', commission.location_id,
        'locationName', commission.location_name,
        'assignedStartDate', commission.assigned_start_date,
        'assignedEndDate', commission.assigned_end_date,
        'assignmentScopeResolved', not commission.shared_compensation_scope,
        'fullPeriodAssignment', commission.full_period_scope,
        'commissionAllocationResolved', not commission.cross_rate_refund_allocation_ambiguous,
        'commissionRateCompleteForPeriod', not commission.commission_rate_missing_day,
        'revenueSnapshotId', commission.revenue_snapshot_id,
        'revenueSnapshotStatus', commission.revenue_snapshot_status,
        'revenueGeneratedAt', commission.revenue_generated_at,
        'sourceLatestSaleDate', commission.source_latest_sale_date,
        'sourceSalesRowCount', commission.source_sales_row_count,
        'sourceAdjustmentRowCount', commission.source_adjustment_row_count,
        'grossSalesCents', coalesce(commission.gross_sales_cents, 0),
        'refundAdjustmentCents', coalesce(commission.refund_adjustment_cents, 0),
        'netRevenueCents', coalesce(commission.net_revenue_cents, 0),
        'commissionableSalesCents', coalesce(commission.eligible_commission_revenue_cents, 0),
        'commissionRate', commission.commission_rate,
        'commissionBasisPoints', commission.commission_basis_points,
        'commissionEarningsCents', commission.commission_earnings_cents,
        'commissionSegments', commission.commission_segments,
        'snapshotGrossSalesCents', coalesce(commission.snapshot_gross_sales_cents, 0),
        'snapshotRefundAdjustmentCents', coalesce(commission.snapshot_refund_adjustment_cents, 0),
        'snapshotNetRevenueCents', coalesce(commission.snapshot_net_revenue_cents, 0),
        'snapshotCommissionableSalesCents', coalesce(commission.snapshot_commissionable_sales_cents, 0),
        'snapshotSourceLatestSaleDate', commission.snapshot_source_latest_sale_date,
        'snapshotMatchesFacts', commission.snapshot_matches_facts,
        'warnings', coalesce(commission.revenue_warnings, '[]'::jsonb)
      ) order by commission.location_name, commission.machine_label, commission.reporting_machine_id)
      from commission_lines commission
    ), '[]'::jsonb),
    'otherEarnings', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', item.id,
        'type', item.item_type,
        'description', item.description,
        'amountCents', item.amount_cents,
        'effectiveStartDate', item.effective_start_date,
        'effectiveEndDate', item.effective_end_date
      ) order by item.item_type, item.description, item.id)
      from recurring_lines item
    ), '[]'::jsonb),
    'blockers', coalesce((select jsonb_agg(item) from blockers), '[]'::jsonb),
    'warnings', coalesce((select jsonb_agg(item) from warnings), '[]'::jsonb),
    'calculationMeta', jsonb_build_object(
      'schemaVersion', 'technician-pay-report-v1',
      'commissionBasisSource', 'date-bounded machine_sales_facts less sales_adjustment_facts, reconciled to the monthly revenue snapshot',
      'legacyPartialPeriodBlocker', 'partial_period_assignment_scope removed; valid partial windows are date segmented',
      'removedLegacyBlockers', jsonb_build_array('partial_period_assignment_scope'),
      'refundAppliedOnce', true,
      'crossRateRefundPolicy', 'fail closed when a negative segment cannot be attributed across multiple effective commission rates',
      'approvalRequired', false,
      'paymentExecution', false,
      'taxCalculation', false
    )
  )
  from profile_context profile
  cross join totals;
$$;

revoke execute on function private.calculate_technician_pay_report(uuid, uuid, date, date)
  from public, anon, authenticated;
grant execute on function private.calculate_technician_pay_report(uuid, uuid, date, date)
  to service_role;

-- Pay-sensitive report: account-level payout authority is mandatory. Machine
-- managers and reporting entitlements intentionally cannot broaden into pay.
create or replace function public.get_technician_pay_report_context(
  p_month date default current_date
)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  actor_user_id uuid;
  target_month date;
  period_start date;
  period_end date;
  result jsonb;
begin
  actor_user_id := auth.uid();
  target_month := coalesce(p_month, current_date);
  period_start := date_trunc('month', target_month::timestamp)::date;
  period_end := (date_trunc('month', target_month::timestamp) + interval '1 month - 1 day')::date;

  if actor_user_id is null then
    raise exception 'Authentication required';
  end if;

  if not exists (
    select 1
    from public.customer_accounts account
    where coalesce(
      public.can_manage_operator_payout_account(actor_user_id, account.id),
      false
    )
  ) then
    raise exception 'Account pay authority required';
  end if;

  with authorized_accounts as materialized (
    select account.id, account.name
    from public.customer_accounts account
    where coalesce(
      public.can_manage_operator_payout_account(actor_user_id, account.id),
      false
    )
  ),
  report_rows as materialized (
    select
      account.id as account_id,
      account.name as account_name,
      profile.id as operator_profile_id,
      private.calculate_technician_pay_report(
        account.id,
        profile.id,
        period_start,
        period_end
      ) as calculation
    from authorized_accounts account
    join public.operator_payout_profiles profile
      on profile.account_id = account.id
      and (
        profile.status = 'active'
        or exists (
          select 1
          from public.time_entries historical_entry
          where historical_entry.operator_profile_id = profile.id
            and historical_entry.account_id = account.id
            and historical_entry.work_date between period_start and period_end
            and historical_entry.status <> 'voided'
        )
        or exists (
          select 1
          from public.operator_machine_assignments historical_assignment
          where historical_assignment.operator_profile_id = profile.id
            and historical_assignment.account_id = account.id
            and historical_assignment.effective_start_date <= period_end
            and coalesce(historical_assignment.effective_end_date, 'infinity'::date) >= period_start
        )
        or exists (
          select 1
          from public.operator_recurring_compensation_items historical_item
          where historical_item.operator_profile_id = profile.id
            and historical_item.account_id = account.id
            and historical_item.effective_start_date <= period_end
            and coalesce(historical_item.effective_end_date, 'infinity'::date) >= period_start
        )
      )
  )
  select jsonb_build_object(
    'month', period_start,
    'periodStartDate', period_start,
    'periodEndDate', period_end,
    'hasAccess', exists (select 1 from authorized_accounts),
    'accounts', coalesce((
      select jsonb_agg(jsonb_build_object(
        'accountId', account.id,
        'accountName', account.name
      ) order by account.name, account.id)
      from authorized_accounts account
    ), '[]'::jsonb),
    'technicians', coalesce((
      select jsonb_agg(report.calculation order by report.account_name, report.calculation ->> 'displayName', report.operator_profile_id)
      from report_rows report
      where report.calculation is not null
    ), '[]'::jsonb),
    'capabilities', jsonb_build_object(
      'accountPayAuthorityRequired', true,
      'canCorrectTime', false,
      'approvalRequired', false,
      'paymentExecution', false,
      'taxCalculation', false
    )
  )
  into result;

  return result;
end;
$$;

comment on function public.get_my_time_review_context(date) is
  'Machine-scoped monthly Time Report with canonical timestamps, actual duration, paid shifts, and no approval workflow.';
comment on function private.calculate_technician_pay_report(uuid, uuid, date, date) is
  'Deterministic read-only Technician pay calculation used by manager reporting and future Pay Stub generation.';
comment on function public.get_technician_pay_report_context(date) is
  'Account-pay-authorized monthly Technician Pay Report. It calculates only and never approves time, executes payment, calculates tax, or marks payment complete.';
comment on function public.can_access_payout_run(uuid, uuid) is
  'Account-pay-authorized payout-run access. Machine-only Time Report authority does not expose pay details.';
comment on function public.can_access_payout_run_item(uuid, uuid) is
  'Account-pay-authorized payout-item access. Machine-only Time Report authority does not expose pay details.';
comment on function public.can_access_pay_statement(uuid, uuid) is
  'Account-pay-authorized or own-published Pay Stub access. Machine-only Time Report authority does not expose pay details.';
comment on function public.get_my_time_report_access() is
  'Safe machine-scoped portal capability probe. It exposes no machine or pay data.';
comment on function public.admin_supersede_operator_compensation_rate(uuid, uuid, uuid, text, integer, date, date, text) is
  'Atomically closes the prior effective rate and creates its audited replacement without an approval workflow.';
comment on function public.admin_refresh_technician_pay_report_sales(date, uuid) is
  'Refreshes authoritative monthly Commissionable Sales snapshots for account-authorized Technician Pay Reports.';

revoke execute on function public.get_my_time_review_context(date)
  from public, anon, authenticated;
grant execute on function public.get_my_time_review_context(date)
  to authenticated;

revoke execute on function public.get_my_time_report_access()
  from public, anon, authenticated;
grant execute on function public.get_my_time_report_access()
  to authenticated;

revoke execute on function public.admin_supersede_operator_compensation_rate(uuid, uuid, uuid, text, integer, date, date, text)
  from public, anon, authenticated;
grant execute on function public.admin_supersede_operator_compensation_rate(uuid, uuid, uuid, text, integer, date, date, text)
  to authenticated;

revoke execute on function public.admin_refresh_technician_pay_report_sales(date, uuid)
  from public, anon, authenticated;
grant execute on function public.admin_refresh_technician_pay_report_sales(date, uuid)
  to authenticated;

revoke execute on function public.get_technician_pay_report_context(date)
  from public, anon, authenticated;
grant execute on function public.get_technician_pay_report_context(date)
  to authenticated;

select pg_notify('pgrst', 'reload schema');
