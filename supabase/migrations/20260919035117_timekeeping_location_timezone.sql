-- Technician-entered wall-clock times belong to the selected machine's location,
-- not to the browser or Bloomjoy's Pacific headquarters. Keep the existing
-- Pacific month-close policy, but resolve work timestamps and dates locally.

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
  location_timezone text;
  manager_correction boolean;
begin
  manager_correction := coalesce(
    current_setting('app.timekeeping_manager_correction', true),
    ''
  ) = 'true';

  select machine, location.timezone
  into machine_row, location_timezone
  from public.reporting_machines machine
  join public.reporting_locations location on location.id = machine.location_id
  where machine.id = new.reporting_machine_id;

  if machine_row.id is null then
    raise exception 'Technician machine not found';
  end if;

  if location_timezone is null or not exists (
    select 1
    from pg_catalog.pg_timezone_names zone
    where zone.name = location_timezone
  ) then
    raise exception 'Technician machine location timezone is invalid';
  end if;

  if tg_op = 'INSERT' then
    if new.actual_start_at is null then
      new.actual_start_at :=
        (new.work_date::timestamp + new.start_time) at time zone location_timezone;
    end if;
    if new.actual_end_at is null then
      new.actual_end_at :=
        (new.work_date::timestamp + new.end_time) at time zone location_timezone;
    end if;
  elsif new.actual_start_at is not distinct from old.actual_start_at
    and new.actual_end_at is not distinct from old.actual_end_at
    and (
      new.work_date is distinct from old.work_date
      or new.start_time is distinct from old.start_time
      or new.end_time is distinct from old.end_time
    ) then
    new.actual_start_at :=
      (new.work_date::timestamp + new.start_time) at time zone location_timezone;
    new.actual_end_at :=
      (new.work_date::timestamp + new.end_time) at time zone location_timezone;
  end if;

  if new.actual_end_at <= new.actual_start_at then
    raise exception 'End time must be after start time';
  end if;

  new.work_date := (new.actual_start_at at time zone location_timezone)::date;
  new.start_time := (new.actual_start_at at time zone location_timezone)::time;
  new.end_time := (new.actual_end_at at time zone location_timezone)::time;

  select *
  into profile_row
  from public.operator_payout_profiles profile
  where profile.id = new.operator_profile_id;

  if profile_row.id is null then
    raise exception 'Technician pay profile not found';
  end if;

  if machine_row.account_id <> profile_row.account_id then
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
declare
  location_timezone text;
begin
  select location.timezone
  into location_timezone
  from public.reporting_machines machine
  join public.reporting_locations location on location.id = machine.location_id
  where machine.id = new.reporting_machine_id;

  if location_timezone is null or not exists (
    select 1
    from pg_catalog.pg_timezone_names zone
    where zone.name = location_timezone
  ) then
    raise exception 'Technician machine location timezone is invalid';
  end if;

  if new.work_date > (now() at time zone location_timezone)::date then
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
    'locationTimezone', location.timezone,
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
      or public.can_manage_operator_payout_machine(
        (select auth.uid()),
        entry.reporting_machine_id
      )
    );
$$;

create or replace function public.get_my_operator_timekeeping_context(
  p_work_date date default current_date
)
returns jsonb
language plpgsql
security definer
set search_path = public, auth
as $$
declare
  actor_user_id uuid;
  target_work_date date;
  result jsonb;
begin
  actor_user_id := auth.uid();
  target_work_date := coalesce(p_work_date, current_date);

  if actor_user_id is null then
    raise exception 'Authentication required';
  end if;

  with profile_context as (
    select
      profile.id,
      profile.account_id,
      account.name as account_name,
      profile.display_name,
      profile.worker_type,
      profile.status,
      policy.id as payout_policy_id,
      policy.name as payout_policy_name,
      policy.frequency,
      policy.rounding_rule,
      policy.review_model,
      period.id as payout_period_id,
      period.period_start_date,
      period.period_end_date,
      period.submission_due_date,
      period.lock_date,
      period.target_payout_date,
      period.status as period_status
    from public.operator_payout_profiles profile
    join public.customer_accounts account on account.id = profile.account_id
    join lateral public.ensure_operator_payout_period_for_date(profile.id, target_work_date) period
      on true
    join public.payout_policies policy on policy.id = period.payout_policy_id
    where profile.user_id = actor_user_id
      and profile.status = 'active'
  )
  select jsonb_build_object(
    'workDate', target_work_date,
    'profiles', coalesce(jsonb_agg(
      jsonb_build_object(
        'id', profile.id,
        'accountId', profile.account_id,
        'accountName', profile.account_name,
        'displayName', profile.display_name,
        'workerType', profile.worker_type,
        'status', profile.status,
        'policy', jsonb_build_object(
          'id', profile.payout_policy_id,
          'name', profile.payout_policy_name,
          'frequency', profile.frequency,
          'roundingRule', profile.rounding_rule,
          'reviewModel', profile.review_model
        ),
        'currentPeriod', jsonb_build_object(
          'id', profile.payout_period_id,
          'periodStartDate', profile.period_start_date,
          'periodEndDate', profile.period_end_date,
          'submissionDueDate', profile.submission_due_date,
          'lockDate', profile.lock_date,
          'targetPayoutDate', profile.target_payout_date,
          'status', profile.period_status
        ),
        'assignedMachines', coalesce((
          select jsonb_agg(
            jsonb_build_object(
              'assignmentId', assignment.id,
              'machineId', machine.id,
              'machineLabel', machine.machine_label,
              'locationId', location.id,
              'locationName', location.name,
              'locationTimezone', location.timezone,
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
        'currentEntries', coalesce((
          select jsonb_agg(public.operator_time_entry_payload(entry.id) order by entry.work_date desc, entry.start_time desc)
          from public.time_entries entry
          where entry.operator_profile_id = profile.id
            and entry.payout_period_id = profile.payout_period_id
            and entry.status <> 'voided'
        ), '[]'::jsonb),
        'recentEntries', coalesce((
          select jsonb_agg(entry_payload.payload order by entry_payload.work_date desc, entry_payload.start_time desc)
          from (
            select
              entry.work_date,
              entry.start_time,
              public.operator_time_entry_payload(entry.id) as payload
            from public.time_entries entry
            where entry.operator_profile_id = profile.id
              and entry.status <> 'voided'
            order by entry.work_date desc, entry.start_time desc
            limit 20
          ) entry_payload
        ), '[]'::jsonb)
      )
      order by profile.account_name, profile.display_name
    ), '[]'::jsonb)
  )
  into result
  from profile_context profile;

  return coalesce(result, jsonb_build_object('workDate', target_work_date, 'profiles', '[]'::jsonb));
end;
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
  location_timezone text;
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

  select * into profile_row
  from public.operator_payout_profiles profile
  where profile.id = p_operator_profile_id
    and profile.user_id = actor_user_id
    and profile.status = 'active';

  if profile_row.id is null then
    raise exception 'Technician timekeeping access required';
  end if;

  select machine, location.timezone
  into machine_row, location_timezone
  from public.reporting_machines machine
  join public.reporting_locations location on location.id = machine.location_id
  where machine.id = p_reporting_machine_id
    and machine.account_id = profile_row.account_id;

  if machine_row.id is null then
    raise exception 'Assigned machine not found';
  end if;

  if location_timezone is null or not exists (
    select 1
    from pg_catalog.pg_timezone_names zone
    where zone.name = location_timezone
  ) then
    raise exception 'Technician machine location timezone is invalid';
  end if;

  work_date_local := (p_actual_start_at at time zone location_timezone)::date;

  if now() >= public.operator_time_entry_cutoff_at(work_date_local) then
    raise exception 'This month is closed for Technician editing';
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
      (p_actual_start_at at time zone location_timezone)::time,
      (p_actual_end_at at time zone location_timezone)::time,
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

comment on function public.save_operator_time_entry(uuid, uuid, uuid, timestamptz, timestamptz, text) is
  'Creates or updates completed Technician time using the selected machine location timezone; Technician editing remains open through the Pacific month-close cutoff.';
