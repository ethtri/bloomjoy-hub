-- #1251: allow an authorized machine manager to add a Technician's entirely
-- missing completed-time entry before or after the Technician cutoff.
-- This is a correction path only: it does not approve time or execute payment.

alter table public.time_entry_change_events
  drop constraint if exists time_entry_change_events_change_kind_check;
alter table public.time_entry_change_events
  add constraint time_entry_change_events_change_kind_check check (change_kind in (
    'technician_created',
    'technician_updated',
    'technician_voided',
    'manager_created',
    'manager_corrected',
    'manager_voided',
    'system_changed'
  ));

create or replace function public.get_my_time_review_entry_options(
  p_work_date date default current_date
)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  with bounds as (
    select
      date_trunc('month', coalesce(p_work_date, current_date)::timestamp)::date as period_start,
      (
        date_trunc('month', coalesce(p_work_date, current_date)::timestamp)
        + interval '1 month - 1 day'
      )::date as period_end
  ),
  manageable_machines as materialized (
    select machine.id
    from public.reporting_machines machine
    where coalesce(
      public.can_manage_operator_payout_machine(auth.uid(), machine.id),
      false
    )
  ),
  scoped_assignments as (
    select
      profile.id as operator_profile_id,
      profile.display_name as operator_name,
      assignment.reporting_machine_id as machine_id,
      assignment.effective_start_date,
      assignment.effective_end_date
    from public.operator_machine_assignments assignment
    join public.operator_payout_profiles profile
      on profile.id = assignment.operator_profile_id
    join manageable_machines machine
      on machine.id = assignment.reporting_machine_id
    cross join bounds
    where auth.uid() is not null
      and assignment.effective_start_date <= bounds.period_end
      and coalesce(assignment.effective_end_date, 'infinity'::date) >= bounds.period_start
  )
  select coalesce(
    jsonb_agg(
      jsonb_build_object(
        'operatorProfileId', option_row.operator_profile_id,
        'operatorName', option_row.operator_name,
        'machineId', option_row.machine_id,
        'effectiveStartDate', option_row.effective_start_date,
        'effectiveEndDate', option_row.effective_end_date
      )
      order by
        option_row.operator_name,
        option_row.operator_profile_id,
        option_row.effective_start_date,
        option_row.machine_id
    ),
    '[]'::jsonb
  )
  from scoped_assignments option_row;
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
  actor_can_manage_profile boolean;
begin
  actor_user_id := auth.uid();
  target_work_date := coalesce(p_work_date, current_date);

  if actor_user_id is null then
    raise exception 'Authentication required';
  end if;

  select * into profile_row
  from public.operator_payout_profiles profile
  where profile.id = p_operator_profile_id;

  if profile_row.id is null then
    raise exception 'Technician pay profile not found';
  end if;

  actor_can_manage_profile := coalesce(
    public.can_manage_operator_payout_account(actor_user_id, profile_row.account_id),
    false
  ) or exists (
    select 1
    from public.operator_machine_assignments assignment
    where assignment.operator_profile_id = profile_row.id
      and target_work_date between assignment.effective_start_date
        and coalesce(assignment.effective_end_date, 'infinity'::date)
      and public.can_manage_operator_payout_machine(
        actor_user_id,
        assignment.reporting_machine_id
      )
  );

  if profile_row.user_id <> actor_user_id and not actor_can_manage_profile then
    raise exception 'Technician timekeeping access required';
  end if;

  if profile_row.status <> 'active' and not actor_can_manage_profile then
    raise exception 'Technician pay profile not found';
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

comment on function public.ensure_operator_payout_period_for_date(uuid, date) is
  'Creates or finds the monthly Timekeeping period for an active Technician or a manager with effective-date machine/account authority; inactive Technicians cannot self-service.';

create or replace function public.manager_create_operator_time_entry(
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
  entry_row public.time_entries;
  work_date_local date;
  after_technician_cutoff boolean;
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
  after_technician_cutoff :=
    now() >= public.operator_time_entry_cutoff_at(work_date_local);

  select * into profile_row
  from public.operator_payout_profiles profile
  where profile.id = p_operator_profile_id;

  if profile_row.id is null then
    raise exception 'Technician pay profile not found';
  end if;

  select * into machine_row
  from public.reporting_machines machine
  where machine.id = p_reporting_machine_id
    and machine.account_id = profile_row.account_id;

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
    where assignment.operator_profile_id = profile_row.id
      and assignment.reporting_machine_id = machine_row.id
      and work_date_local between assignment.effective_start_date
        and coalesce(assignment.effective_end_date, 'infinity'::date)
  ) then
    raise exception 'Technician is not assigned to this machine for the work date';
  end if;

  if exists (
    select 1
    from public.time_entries existing
    where existing.operator_profile_id = profile_row.id
      and existing.status <> 'voided'
      and tstzrange(existing.actual_start_at, existing.actual_end_at, '[)')
        && tstzrange(p_actual_start_at, p_actual_end_at, '[)')
  ) then
    raise exception 'Time entry overlaps another Technician entry';
  end if;

  select * into period_row
  from public.ensure_operator_payout_period_for_date(
    profile_row.id,
    work_date_local
  );

  perform set_config('app.timekeeping_manager_correction', 'true', true);
  perform set_config('app.timekeeping_change_kind', 'manager_created', true);

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
    'operator_time_entry.manager_created',
    'time_entry',
    entry_row.id::text,
    profile_row.user_id,
    null,
    to_jsonb(entry_row),
    jsonb_build_object(
      'machine_manager_correction', true,
      'reason_required', false,
      'after_cutoff', after_technician_cutoff,
      'after_cutoff_allowed', true,
      'payment_execution', false
    )
  );

  return jsonb_build_object(
    'timeEntry', public.operator_time_entry_payload(entry_row.id),
    'afterTechnicianCutoff', after_technician_cutoff,
    'context',
      public.get_my_time_review_context(work_date_local)
      || jsonb_build_object(
        'entryOptions', public.get_my_time_review_entry_options(work_date_local)
      )
  );
end;
$$;

comment on function public.get_my_time_review_entry_options(date) is
  'Machine-scoped effective Technician assignment choices for adding missing completed time in the manager Time Report, including historical assignments for inactive Technicians.';
comment on function public.manager_create_operator_time_entry(uuid, uuid, timestamptz, timestamptz, text) is
  'Machine-scoped manager path for adding entirely missing completed Technician time before or after cutoff, with assignment, overlap, and audit enforcement.';

revoke execute on function public.get_my_time_review_entry_options(date)
  from public, anon, authenticated;
grant execute on function public.get_my_time_review_entry_options(date)
  to authenticated;

revoke execute on function public.manager_create_operator_time_entry(uuid, uuid, timestamptz, timestamptz, text)
  from public, anon, authenticated;
grant execute on function public.manager_create_operator_time_entry(uuid, uuid, timestamptz, timestamptz, text)
  to authenticated;

-- A published Pay Stub becomes stale whenever time in its exact pay period is
-- added or corrected after issuance. This is derived from immutable statement
-- history and time-entry timestamps, so the warning remains visible until a
-- newer Pay Stub is issued; no transient UI state or manual acknowledgement can
-- accidentally clear it.
create or replace function private.operator_pay_stub_regeneration_required(
  p_operator_profile_id uuid,
  p_period_start date,
  p_period_end date
)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  with latest_statement as (
    select max(coalesce(statement.statement_generated_at, statement.issued_at)) as generated_at
    from public.pay_statements statement
    join public.payout_runs run on run.id = statement.payout_run_id
    join public.payout_periods period on period.id = run.payout_period_id
    where statement.operator_profile_id = p_operator_profile_id
      and statement.status = 'issued'
      and period.period_start_date = p_period_start
      and period.period_end_date = p_period_end
  )
  select coalesce(exists (
    select 1
    from latest_statement latest
    join public.time_entry_change_events event
      on event.operator_profile_id = p_operator_profile_id
    where latest.generated_at is not null
      and event.created_at > latest.generated_at
      and (
        nullif(event.after_state ->> 'work_date', '')::date between p_period_start and p_period_end
        or nullif(event.before_state ->> 'work_date', '')::date between p_period_start and p_period_end
      )
  ), false);
$$;

revoke execute on function private.operator_pay_stub_regeneration_required(uuid, date, date)
  from public, anon, authenticated;
grant execute on function private.operator_pay_stub_regeneration_required(uuid, date, date)
  to service_role;

alter function public.get_technician_pay_report_context(date)
  rename to get_technician_pay_report_context_without_time_regeneration_state;

create function public.get_technician_pay_report_context(
  p_month date default current_date
)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  base_context jsonb;
  enriched_technicians jsonb;
begin
  base_context := public.get_technician_pay_report_context_without_time_regeneration_state(p_month);

  select coalesce(jsonb_agg(
    technician || jsonb_build_object(
      'payStubRegenerationRequired', regeneration_required,
      'warnings', case
        when regeneration_required then
          coalesce(technician -> 'warnings', '[]'::jsonb)
          || jsonb_build_array(jsonb_build_object(
            'code', 'pay_stub_regeneration_required',
            'severity', 'warning',
            'message', 'Time changed after this Pay Stub was published. Regenerate it so the Technician sees the current shifts and pay.'
          ))
        else coalesce(technician -> 'warnings', '[]'::jsonb)
      end
    )
    order by technician ->> 'displayName', technician ->> 'operatorProfileId'
  ), '[]'::jsonb)
  into enriched_technicians
  from (
    select
      value as technician,
      private.operator_pay_stub_regeneration_required(
        (value ->> 'operatorProfileId')::uuid,
        (base_context ->> 'periodStartDate')::date,
        (base_context ->> 'periodEndDate')::date
      ) as regeneration_required
    from jsonb_array_elements(coalesce(base_context -> 'technicians', '[]'::jsonb))
  ) report;

  return base_context || jsonb_build_object('technicians', enriched_technicians);
end;
$$;

revoke execute on function public.get_technician_pay_report_context_without_time_regeneration_state(date)
  from public, anon, authenticated;
grant execute on function public.get_technician_pay_report_context_without_time_regeneration_state(date)
  to service_role;
revoke execute on function public.get_technician_pay_report_context(date)
  from public, anon;
grant execute on function public.get_technician_pay_report_context(date)
  to authenticated;

comment on function private.operator_pay_stub_regeneration_required(uuid, date, date) is
  'Returns true when an audited time change touched a period after its current Pay Stub calculation; issuing a newer stub clears the derived condition.';
comment on function public.get_technician_pay_report_context(date) is
  'Account-pay-authorized monthly Technician Pay Report with a durable warning when time changed after Pay Stub publication.';

-- Historical corrections must remain publishable after a Technician leaves.
-- Account-level pay authority and exact-period evidence still fail closed.
create or replace function public.admin_request_pay_stub_generation(
  p_operator_profile_id uuid,
  p_month date
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  actor_user_id uuid := auth.uid();
  profile_row public.operator_payout_profiles;
  period_row public.payout_periods;
  request_row public.pay_stub_generation_requests;
  period_start date := date_trunc('month', p_month::timestamp)::date;
  period_end date := (date_trunc('month', p_month::timestamp) + interval '1 month - 1 day')::date;
begin
  if actor_user_id is null then
    raise exception 'Authentication required';
  end if;

  select * into profile_row
  from public.operator_payout_profiles profile
  where profile.id = p_operator_profile_id;

  if profile_row.id is null
    or not public.can_manage_operator_payout_account(actor_user_id, profile_row.account_id) then
    raise exception 'Account pay authority required';
  end if;

  select * into period_row
  from public.payout_periods period
  where period.account_id = profile_row.account_id
    and period.period_start_date = period_start
    and period.period_end_date = period_end
    and period.status <> 'voided'
  order by period.created_at desc
  limit 1;

  if period_row.id is null then
    raise exception 'Monthly pay period not found';
  end if;

  if profile_row.status <> 'active'
    and not exists (
      select 1
      from public.time_entries entry
      where entry.operator_profile_id = profile_row.id
        and entry.payout_period_id = period_row.id
    )
    and not exists (
      select 1
      from public.pay_statements statement
      join public.payout_runs run on run.id = statement.payout_run_id
      where statement.operator_profile_id = profile_row.id
        and run.payout_period_id = period_row.id
    ) then
    raise exception 'Historical Technician pay activity required';
  end if;

  if now() < public.operator_time_entry_cutoff_at(period_row.period_end_date) then
    raise exception 'Pay Stubs can be generated after the Technician edit cutoff';
  end if;

  insert into public.pay_stub_generation_requests (
    account_id,
    operator_profile_id,
    payout_period_id,
    trigger_kind,
    requested_by
  )
  values (
    profile_row.account_id,
    profile_row.id,
    period_row.id,
    'manager_regeneration',
    actor_user_id
  )
  on conflict (operator_profile_id, payout_period_id)
    where status in ('queued', 'processing')
  do update set updated_at = now()
  returning * into request_row;

  insert into public.admin_audit_log (
    actor_user_id, action, entity_type, entity_id, after, meta
  )
  values (
    actor_user_id,
    'operator_pay_stub.generation_requested',
    'pay_stub_generation_request',
    request_row.id::text,
    to_jsonb(request_row),
    jsonb_build_object(
      'account_id', profile_row.account_id,
      'operator_profile_id', profile_row.id,
      'payout_period_id', period_row.id,
      'approval_required', false,
      'payment_execution', false
    )
  );

  return jsonb_build_object(
    'requestId', request_row.id,
    'status', request_row.status
  );
end;
$$;

revoke execute on function public.admin_request_pay_stub_generation(uuid, date)
  from public, anon;
grant execute on function public.admin_request_pay_stub_generation(uuid, date)
  to authenticated;

comment on function public.admin_request_pay_stub_generation(uuid, date) is
  'Account-pay-authorized Pay Stub publication or regeneration, including inactive historical Technicians with exact-period pay activity.';

select pg_notify('pgrst', 'reload schema');
