-- Operator timekeeping flow: current-period context plus operator-owned
-- submit/edit/void RPCs for assigned-machine shift entry.

create or replace function public.ensure_operator_payout_period_for_date(
  p_operator_profile_id uuid,
  p_work_date date default current_date
)
returns public.payout_periods
language plpgsql
security definer
set search_path = public, auth
as $$
declare
  actor_user_id uuid;
  profile_row public.operator_payout_profiles;
  policy_row public.payout_policies;
  period_row public.payout_periods;
  target_work_date date;
  period_start date;
  period_end date;
begin
  actor_user_id := auth.uid();
  target_work_date := coalesce(p_work_date, current_date);

  if actor_user_id is null then
    raise exception 'Authentication required';
  end if;

  select *
  into profile_row
  from public.operator_payout_profiles profile
  where profile.id = p_operator_profile_id
    and profile.status = 'active'
  limit 1;

  if profile_row.id is null then
    raise exception 'Operator payout profile not found';
  end if;

  if profile_row.user_id <> actor_user_id
    and not public.can_manage_operator_payout_account(actor_user_id, profile_row.account_id) then
    raise exception 'Operator timekeeping access required';
  end if;

  select *
  into policy_row
  from public.payout_policies policy
  where policy.id = coalesce(profile_row.payout_policy_id, (
    select account.default_payout_policy_id
    from public.customer_accounts account
    where account.id = profile_row.account_id
  ))
    and policy.account_id = profile_row.account_id
    and policy.active
  limit 1;

  if policy_row.id is null then
    select *
    into policy_row
    from public.ensure_default_operator_payout_policy(profile_row.account_id);
  end if;

  if policy_row.frequency <> 'monthly'
    or policy_row.monthly_period_type <> 'calendar_month' then
    raise exception 'The current operator timekeeping UI supports monthly calendar payout policies';
  end if;

  period_start := date_trunc('month', target_work_date::timestamp)::date;
  period_end := (date_trunc('month', target_work_date::timestamp) + interval '1 month - 1 day')::date;

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
    period_end + policy_row.submission_due_offset_days,
    period_end + policy_row.lock_offset_days,
    period_end + policy_row.target_payout_offset_days,
    case
      when current_date > period_end + policy_row.lock_offset_days then 'locked'
      when current_date > period_end then 'grace_period'
      else 'open'
    end,
    actor_user_id,
    actor_user_id
  )
  on conflict (account_id, payout_policy_id, period_start_date, period_end_date)
  do update set
    submission_due_date = excluded.submission_due_date,
    lock_date = excluded.lock_date,
    target_payout_date = excluded.target_payout_date,
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
set search_path = public, auth
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
    'rawDurationMinutes', entry.raw_duration_minutes,
    'roundedPaidMinutes', entry.rounded_paid_minutes,
    'notes', entry.notes,
    'status', entry.status,
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
set search_path = public, auth
as $$
declare
  actor_user_id uuid;
  profile_row public.operator_payout_profiles;
  machine_row public.reporting_machines;
  policy_row public.payout_policies;
  period_row public.payout_periods;
  entry_row public.time_entries;
  normalized_status text;
begin
  actor_user_id := auth.uid();
  normalized_status := lower(coalesce(nullif(trim(p_status), ''), 'submitted'));

  if actor_user_id is null then
    raise exception 'Authentication required';
  end if;

  if normalized_status not in ('draft', 'submitted') then
    raise exception 'Time entries can only be saved as draft or submitted by operators';
  end if;

  select *
  into profile_row
  from public.operator_payout_profiles profile
  where profile.id = p_operator_profile_id
    and profile.user_id = actor_user_id
    and profile.status = 'active'
  limit 1;

  if profile_row.id is null then
    raise exception 'Operator payout profile not found';
  end if;

  select *
  into machine_row
  from public.reporting_machines machine
  where machine.id = p_reporting_machine_id
    and machine.account_id = profile_row.account_id
  limit 1;

  if machine_row.id is null then
    raise exception 'Assigned machine not found';
  end if;

  select *
  into period_row
  from public.ensure_operator_payout_period_for_date(profile_row.id, p_work_date);

  select *
  into policy_row
  from public.payout_policies policy
  where policy.id = period_row.payout_policy_id
  limit 1;

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
    raw_duration_minutes,
    rounded_paid_minutes,
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
    policy_row.id,
    period_row.id,
    p_work_date,
    p_start_time,
    p_end_time,
    1,
    1,
    nullif(trim(coalesce(p_notes, '')), ''),
    normalized_status,
    actor_user_id,
    actor_user_id
  )
  returning * into entry_row;

  return jsonb_build_object(
    'timeEntry', public.operator_time_entry_payload(entry_row.id),
    'context', public.get_my_operator_timekeeping_context(p_work_date)
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
set search_path = public, auth
as $$
declare
  actor_user_id uuid;
  before_row public.time_entries;
  profile_row public.operator_payout_profiles;
  machine_row public.reporting_machines;
  period_row public.payout_periods;
  normalized_status text;
begin
  actor_user_id := auth.uid();
  normalized_status := lower(coalesce(nullif(trim(p_status), ''), 'submitted'));

  if actor_user_id is null then
    raise exception 'Authentication required';
  end if;

  if normalized_status not in ('draft', 'submitted') then
    raise exception 'Time entries can only be saved as draft or submitted by operators';
  end if;

  select *
  into before_row
  from public.time_entries entry
  where entry.id = p_time_entry_id
  limit 1;

  if before_row.id is null then
    raise exception 'Time entry not found';
  end if;

  if before_row.locked_at is not null
    or before_row.status not in ('draft', 'submitted') then
    raise exception 'Locked or payout-included time entries cannot be edited';
  end if;

  select *
  into profile_row
  from public.operator_payout_profiles profile
  where profile.id = before_row.operator_profile_id
    and profile.user_id = actor_user_id
    and profile.status = 'active'
  limit 1;

  if profile_row.id is null then
    raise exception 'Operator timekeeping access required';
  end if;

  select *
  into machine_row
  from public.reporting_machines machine
  where machine.id = p_reporting_machine_id
    and machine.account_id = profile_row.account_id
  limit 1;

  if machine_row.id is null then
    raise exception 'Assigned machine not found';
  end if;

  select *
  into period_row
  from public.ensure_operator_payout_period_for_date(profile_row.id, p_work_date);

  update public.time_entries
  set
    reporting_machine_id = machine_row.id,
    reporting_location_id = machine_row.location_id,
    payout_policy_id = period_row.payout_policy_id,
    payout_period_id = period_row.id,
    work_date = p_work_date,
    start_time = p_start_time,
    end_time = p_end_time,
    notes = nullif(trim(coalesce(p_notes, '')), ''),
    status = normalized_status,
    updated_by = actor_user_id
  where id = before_row.id;

  return jsonb_build_object(
    'timeEntry', public.operator_time_entry_payload(before_row.id),
    'context', public.get_my_operator_timekeeping_context(p_work_date)
  );
end;
$$;

create or replace function public.void_operator_time_entry(
  p_time_entry_id uuid,
  p_reason text default 'Operator deleted unlocked shift'
)
returns jsonb
language plpgsql
security definer
set search_path = public, auth
as $$
declare
  actor_user_id uuid;
  before_row public.time_entries;
  after_row public.time_entries;
  profile_row public.operator_payout_profiles;
  normalized_reason text;
begin
  actor_user_id := auth.uid();
  normalized_reason := trim(coalesce(p_reason, ''));

  if actor_user_id is null then
    raise exception 'Authentication required';
  end if;

  if normalized_reason = '' then
    raise exception 'Delete reason is required';
  end if;

  select *
  into before_row
  from public.time_entries entry
  where entry.id = p_time_entry_id
  limit 1;

  if before_row.id is null then
    raise exception 'Time entry not found';
  end if;

  if before_row.locked_at is not null
    or before_row.status not in ('draft', 'submitted') then
    raise exception 'Locked or payout-included time entries cannot be deleted';
  end if;

  select *
  into profile_row
  from public.operator_payout_profiles profile
  where profile.id = before_row.operator_profile_id
    and profile.user_id = actor_user_id
    and profile.status = 'active'
  limit 1;

  if profile_row.id is null then
    raise exception 'Operator timekeeping access required';
  end if;

  update public.time_entries
  set
    status = 'voided',
    updated_by = actor_user_id,
    notes = concat_ws(
      E'\n',
      nullif(trim(coalesce(notes, '')), ''),
      'Deleted by operator: ' || normalized_reason
    )
  where id = before_row.id
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
    'operator_time_entry.voided',
    'time_entry',
    after_row.id::text,
    profile_row.user_id,
    to_jsonb(before_row),
    to_jsonb(after_row),
    jsonb_build_object(
      'reason', normalized_reason,
      'operator_self_service', true
    )
  );

  return jsonb_build_object(
    'timeEntryId', after_row.id,
    'context', public.get_my_operator_timekeeping_context(before_row.work_date)
  );
end;
$$;

comment on function public.ensure_operator_payout_period_for_date(uuid, date) is
  'Creates or returns the monthly calendar payout period used by the operator timekeeping UI.';
comment on function public.get_my_operator_timekeeping_context(date) is
  'Operator timekeeping context for the current user, including active profiles, assigned machines, current period, and shift history.';
comment on function public.submit_operator_time_entry(uuid, uuid, date, time, time, text, text) is
  'Operator-owned assigned-machine shift submission. Duration and rounded paid minutes are calculated server-side.';
comment on function public.update_operator_time_entry(uuid, uuid, date, time, time, text, text) is
  'Operator-owned edit path for unlocked draft/submitted time entries.';
comment on function public.void_operator_time_entry(uuid, text) is
  'Operator-owned delete path for unlocked draft/submitted time entries; records a voided audit trail instead of hard-deleting.';

revoke execute on function public.ensure_operator_payout_period_for_date(uuid, date)
  from public, anon;
revoke execute on function public.operator_time_entry_payload(uuid)
  from public, anon, authenticated;
revoke execute on function public.get_my_operator_timekeeping_context(date)
  from public, anon;
revoke execute on function public.submit_operator_time_entry(uuid, uuid, date, time, time, text, text)
  from public, anon;
revoke execute on function public.update_operator_time_entry(uuid, uuid, date, time, time, text, text)
  from public, anon;
revoke execute on function public.void_operator_time_entry(uuid, text)
  from public, anon;

grant execute on function public.ensure_operator_payout_period_for_date(uuid, date)
  to authenticated;
grant execute on function public.operator_time_entry_payload(uuid)
  to service_role;
grant execute on function public.get_my_operator_timekeeping_context(date)
  to authenticated;
grant execute on function public.submit_operator_time_entry(uuid, uuid, date, time, time, text, text)
  to authenticated;
grant execute on function public.update_operator_time_entry(uuid, uuid, date, time, time, text, text)
  to authenticated;
grant execute on function public.void_operator_time_entry(uuid, text)
  to authenticated;

select pg_notify('pgrst', 'reload schema');
