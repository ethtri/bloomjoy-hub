-- Support simple per-Technician, per-machine pay arrangements while preserving
-- the existing effective-dated compensation history and payer-scoped profiles.

alter table public.compensation_rules
  drop constraint if exists compensation_rules_canonical_shift_scope;

alter table public.compensation_rules
  add constraint compensation_rules_canonical_shift_scope
  check (shift_rate_cents is null or operator_profile_id is not null)
  not valid;

drop index if exists public.compensation_rules_canonical_shift_lookup_idx;

create index compensation_rules_canonical_shift_lookup_idx
  on public.compensation_rules (
    operator_profile_id,
    reporting_machine_id,
    effective_start_date desc,
    effective_end_date
  )
  where status = 'active'
    and shift_rate_cents is not null;

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
    and (rule.reporting_machine_id = p_reporting_machine_id or rule.reporting_machine_id is null)
    and (
      (normalized_type = 'shift' and rule.shift_rate_cents is not null)
      or (normalized_type = 'commission' and rule.commission_basis_points is not null)
    )
  order by
    case when rule.reporting_machine_id = p_reporting_machine_id then 0 else 1 end,
    rule.effective_start_date desc,
    rule.created_at desc,
    rule.id
  limit 1;

  if selected_rule.id is null then
    return null;
  end if;

  return jsonb_build_object(
    'ruleId', selected_rule.id,
    'rateType', normalized_type,
    'source', case when selected_rule.reporting_machine_id is not null
      then 'technician_machine_override'
      else 'technician_default'
    end,
    'shiftRateCents', selected_rule.shift_rate_cents,
    'commissionBasisPoints', selected_rule.commission_basis_points,
    'effectiveStartDate', selected_rule.effective_start_date,
    'effectiveEndDate', selected_rule.effective_end_date
  );
end;
$$;

-- Add machine identity to shift-rate lines without duplicating the existing
-- report calculator. Pay Stub generation consumes this same report payload.
alter function private.calculate_technician_pay_report(uuid, uuid, date, date)
  rename to calculate_technician_pay_report_without_machine_rates;

create function private.calculate_technician_pay_report(
  p_account_id uuid,
  p_operator_profile_id uuid,
  p_period_start_date date,
  p_period_end_date date
)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  result jsonb;
  rate_lines jsonb;
begin
  result := private.calculate_technician_pay_report_without_machine_rates(
    p_account_id, p_operator_profile_id, p_period_start_date, p_period_end_date
  );

  select coalesce(jsonb_agg(jsonb_build_object(
    'machineId', grouped.machine_id,
    'machineLabel', grouped.machine_label,
    'locationName', grouped.location_name,
    'shiftRateCents', grouped.shift_rate_cents,
    'paidShifts', grouped.paid_shifts,
    'actualDurationMinutes', grouped.actual_duration_minutes,
    'shiftEarningsCents', grouped.shift_earnings_cents,
    'firstWorkDate', grouped.first_work_date,
    'lastWorkDate', grouped.last_work_date
  ) order by grouped.location_name, grouped.machine_label, grouped.first_work_date), '[]'::jsonb)
  into rate_lines
  from (
    select
      entry.value ->> 'machineId' as machine_id,
      entry.value ->> 'machineLabel' as machine_label,
      entry.value ->> 'locationName' as location_name,
      nullif(entry.value ->> 'shiftRateCents', '')::integer as shift_rate_cents,
      sum((entry.value ->> 'paidShifts')::integer)::integer as paid_shifts,
      sum((entry.value ->> 'actualDurationMinutes')::integer)::integer as actual_duration_minutes,
      sum((entry.value ->> 'shiftEarningsCents')::bigint)::bigint as shift_earnings_cents,
      min((entry.value ->> 'workDate')::date) as first_work_date,
      max((entry.value ->> 'workDate')::date) as last_work_date
    from jsonb_array_elements(coalesce(result -> 'entries', '[]'::jsonb)) entry(value)
    group by
      entry.value ->> 'machineId', entry.value ->> 'machineLabel',
      entry.value ->> 'locationName', nullif(entry.value ->> 'shiftRateCents', '')::integer
  ) grouped;

  return result || jsonb_build_object('shiftRateLines', rate_lines);
end;
$$;

revoke execute on function private.calculate_technician_pay_report_without_machine_rates(uuid, uuid, date, date)
  from public, anon, authenticated;
grant execute on function private.calculate_technician_pay_report_without_machine_rates(uuid, uuid, date, date)
  to service_role;
revoke execute on function private.calculate_technician_pay_report(uuid, uuid, date, date)
  from public, anon, authenticated;
grant execute on function private.calculate_technician_pay_report(uuid, uuid, date, date)
  to service_role;

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

  if actor_user_id is null then raise exception 'Authentication required'; end if;
  if not coalesce(public.can_manage_operator_payout_account(actor_user_id, p_account_id), false) then
    raise exception 'Technician compensation access required';
  end if;
  if normalized_type not in ('shift', 'commission') then raise exception 'Rate type must be shift or commission'; end if;
  if normalized_status not in ('active', 'inactive') then raise exception 'Invalid compensation rate status'; end if;
  if p_rate_value is null or p_rate_value < 0
    or (normalized_type = 'commission' and p_rate_value > 10000) then
    raise exception 'Compensation rate value is invalid';
  end if;
  if p_effective_start_date is null
    or (p_effective_end_date is not null and p_effective_end_date < p_effective_start_date) then
    raise exception 'Compensation rate effective window is invalid';
  end if;

  select * into profile_row
  from public.operator_payout_profiles profile
  where profile.id = p_operator_profile_id and profile.account_id = p_account_id;
  if profile_row.id is null then raise exception 'Technician pay profile not found for account'; end if;

  if p_reporting_machine_id is not null then
    select * into machine_row
    from public.reporting_machines machine
    where machine.id = p_reporting_machine_id and machine.account_id = p_account_id;
    if machine_row.id is null then raise exception 'Reporting machine not found for account'; end if;

    if not exists (
      select 1 from public.operator_machine_assignments assignment
      where assignment.operator_profile_id = p_operator_profile_id
        and assignment.reporting_machine_id = p_reporting_machine_id
        and assignment.status = 'active'
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
      raise exception 'Machine-specific pay requires an effective Technician assignment';
    end if;
  end if;

  lock_key := concat_ws(':', p_operator_profile_id::text, coalesce(p_reporting_machine_id::text, 'default'), normalized_type);
  perform pg_advisory_xact_lock(hashtextextended(lock_key, 0));

  if exists (
    select 1 from public.compensation_rules rule
    where rule.id is distinct from p_rule_id
      and rule.account_id = p_account_id
      and rule.operator_profile_id = p_operator_profile_id
      and rule.reporting_machine_id is not distinct from p_reporting_machine_id
      and rule.status = 'active' and normalized_status = 'active'
      and daterange(rule.effective_start_date, coalesce(rule.effective_end_date + 1, 'infinity'::date), '[)')
        && daterange(p_effective_start_date, coalesce(p_effective_end_date + 1, 'infinity'::date), '[)')
      and ((normalized_type = 'shift' and rule.shift_rate_cents is not null)
        or (normalized_type = 'commission' and rule.commission_basis_points is not null))
  ) then
    raise exception 'Compensation rate overlaps an existing effective rate';
  end if;

  if p_rule_id is not null then
    select * into before_row from public.compensation_rules rule
    where rule.id = p_rule_id and rule.account_id = p_account_id for update;
    if before_row.id is null then raise exception 'Compensation rate not found'; end if;
  end if;

  if before_row.id is null then
    insert into public.compensation_rules (
      account_id, operator_profile_id, reporting_machine_id, hourly_rate_cents,
      shift_rate_cents, commission_basis_points, effective_start_date,
      effective_end_date, status, notes, created_by, updated_by
    ) values (
      p_account_id, p_operator_profile_id, p_reporting_machine_id,
      case when normalized_type = 'shift' then p_rate_value else null end,
      case when normalized_type = 'shift' then p_rate_value else null end,
      case when normalized_type = 'commission' then p_rate_value else null end,
      p_effective_start_date, p_effective_end_date, normalized_status,
      nullif(trim(coalesce(p_notes, '')), ''), actor_user_id, actor_user_id
    ) returning * into after_row;
  else
    update public.compensation_rules set
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
    where id = before_row.id returning * into after_row;
  end if;

  insert into public.admin_audit_log (
    actor_user_id, action, entity_type, entity_id, target_user_id, before, after, meta
  ) values (
    actor_user_id,
    case when before_row.id is null then 'operator_compensation_rate.created' else 'operator_compensation_rate.updated' end,
    'compensation_rule', after_row.id::text, profile_row.user_id,
    coalesce(to_jsonb(before_row), '{}'::jsonb), to_jsonb(after_row),
    jsonb_build_object('rate_type', normalized_type, 'machine_override', p_reporting_machine_id is not null,
      'approval_required', false, 'payment_execution', false)
  );

  return jsonb_build_object(
    'id', after_row.id, 'accountId', after_row.account_id,
    'operatorProfileId', after_row.operator_profile_id, 'machineId', after_row.reporting_machine_id,
    'rateType', normalized_type, 'rateValue', p_rate_value,
    'shiftRateCents', after_row.shift_rate_cents,
    'commissionBasisPoints', after_row.commission_basis_points,
    'effectiveStartDate', after_row.effective_start_date,
    'effectiveEndDate', after_row.effective_end_date, 'status', after_row.status,
    'notes', after_row.notes
  );
end;
$$;

create or replace function public.admin_setup_timekeeping_technician_arrangements(
  p_user_email text,
  p_display_name text,
  p_worker_type text,
  p_worker_identifier text,
  p_effective_start_date date,
  p_machine_compensation jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  actor_user_id uuid := auth.uid();
  normalized_email text := lower(trim(coalesce(p_user_email, '')));
  normalized_display_name text := trim(coalesce(p_display_name, ''));
  normalized_worker_identifier text := nullif(trim(coalesce(p_worker_identifier, '')), '');
  target_user_id uuid;
  profile_row public.operator_payout_profiles;
  account_row record;
  arrangement record;
  profile_results jsonb := '[]'::jsonb;
  machine_count integer;
  account_count integer;
begin
  if actor_user_id is null then raise exception 'Authentication required'; end if;
  if normalized_email = '' or normalized_display_name = '' then raise exception 'Technician email and name are required'; end if;
  if p_effective_start_date is null then raise exception 'Timekeeping start date is required'; end if;
  if jsonb_typeof(p_machine_compensation) <> 'array' or jsonb_array_length(p_machine_compensation) = 0 then
    raise exception 'Choose at least one machine';
  end if;

  create temporary table selected_arrangements on commit drop as
  select
    value ->> 'machineId' as machine_id_text,
    nullif(value ->> 'shiftRateCents', '')::integer as shift_rate_cents,
    nullif(value ->> 'commissionBasisPoints', '')::integer as commission_basis_points,
    nullif(value ->> 'commissionEffectiveStartDate', '')::date as commission_start_date
  from jsonb_array_elements(p_machine_compensation) selected(value);

  if exists (select 1 from selected_arrangements where machine_id_text is null or machine_id_text !~* '^[0-9a-f-]{36}$') then
    raise exception 'Every pay arrangement must identify a machine';
  end if;
  if exists (select 1 from selected_arrangements group by machine_id_text having count(*) > 1) then
    raise exception 'Each machine can have only one starting pay arrangement';
  end if;
  if exists (select 1 from selected_arrangements where shift_rate_cents is null or shift_rate_cents <= 0) then
    raise exception 'Pay per started hour must be greater than zero';
  end if;
  if exists (select 1 from selected_arrangements where commission_basis_points is null or commission_basis_points < 0 or commission_basis_points > 10000) then
    raise exception 'Commission percent must be between zero and 100';
  end if;
  if exists (select 1 from selected_arrangements where commission_start_date is null or commission_start_date < p_effective_start_date) then
    raise exception 'Commission start cannot be before Timekeeping starts';
  end if;

  select users.id into target_user_id from auth.users users
  where lower(users.email) = normalized_email limit 1;
  if target_user_id is null then
    raise exception 'Technician must accept the invitation and sign in once before Timekeeping setup';
  end if;

  perform pg_advisory_xact_lock(hashtextextended(concat_ws(':', target_user_id::text, 'timekeeping-arrangements'), 0));

  if exists (
    select 1
    from selected_arrangements selected
    left join public.reporting_machines machine on machine.id = selected.machine_id_text::uuid
    where machine.id is null or machine.status <> 'active'
      or not coalesce(public.can_manage_operator_payout_account(actor_user_id, machine.account_id), false)
      or not coalesce(public.can_manage_operator_payout_machine(actor_user_id, machine.id), false)
  ) then
    raise exception 'Every machine must be active and within your pay access';
  end if;

  select count(*)::integer, count(distinct machine.account_id)::integer
  into machine_count, account_count
  from selected_arrangements selected
  join public.reporting_machines machine on machine.id = selected.machine_id_text::uuid;

  for account_row in
    select distinct machine.account_id
    from selected_arrangements selected
    join public.reporting_machines machine on machine.id = selected.machine_id_text::uuid
  loop
    if exists (
      select 1 from public.operator_payout_profiles profile
      where profile.account_id = account_row.account_id and profile.user_id = target_user_id
    ) then
      raise exception 'Technician already has Timekeeping setup for one of these accounts';
    end if;

    select * into profile_row from public.admin_upsert_operator_payout_profile(
      normalized_email, account_row.account_id, normalized_display_name, p_worker_type,
      null, 'Initial Timekeeping pay arrangements'
    );

    update public.operator_payout_profiles set
      worker_identifier = normalized_worker_identifier,
      position_title = 'Technician',
      updated_by = actor_user_id
    where id = profile_row.id returning * into profile_row;

    for arrangement in
      select selected.*, machine.id as machine_id
      from selected_arrangements selected
      join public.reporting_machines machine on machine.id = selected.machine_id_text::uuid
      where machine.account_id = account_row.account_id
    loop
      perform public.admin_upsert_operator_machine_assignment(
        null, profile_row.id, arrangement.machine_id, p_effective_start_date, null
      );
      perform public.admin_upsert_operator_compensation_rate(
        null, account_row.account_id, profile_row.id, arrangement.machine_id,
        'shift', arrangement.shift_rate_cents, p_effective_start_date, null,
        'active', 'Initial Timekeeping pay arrangement'
      );

      if arrangement.commission_start_date > p_effective_start_date then
        perform public.admin_upsert_operator_compensation_rate(
          null, account_row.account_id, profile_row.id, arrangement.machine_id,
          'commission', 0, p_effective_start_date, arrangement.commission_start_date - 1,
          'active', 'Commission waiting period'
        );
      end if;
      perform public.admin_upsert_operator_compensation_rate(
        null, account_row.account_id, profile_row.id, arrangement.machine_id,
        'commission', arrangement.commission_basis_points, arrangement.commission_start_date,
        null, 'active', 'Initial Timekeeping pay arrangement'
      );
    end loop;

    profile_results := profile_results || jsonb_build_array(jsonb_build_object(
      'operatorProfileId', profile_row.id, 'accountId', profile_row.account_id
    ));
  end loop;

  insert into public.admin_audit_log (
    actor_user_id, action, entity_type, entity_id, target_user_id, before, after, meta
  ) values (
    actor_user_id, 'timekeeping_technician.arrangements_setup_completed', 'auth_user',
    target_user_id::text, target_user_id, '{}'::jsonb,
    jsonb_build_object('displayName', normalized_display_name, 'profiles', profile_results),
    jsonb_build_object('machineCount', machine_count, 'payerCount', account_count,
      'effectiveStartDate', p_effective_start_date, 'approvalRequired', false, 'paymentExecution', false)
  );

  return jsonb_build_object(
    'displayName', normalized_display_name, 'profiles', profile_results,
    'machineCount', machine_count, 'payerCount', account_count,
    'effectiveStartDate', p_effective_start_date
  );
end;
$$;

comment on function public.admin_setup_timekeeping_technician_arrangements(text, text, text, text, date, jsonb) is
  'Atomically creates payer-scoped Technician profiles, machine assignments, and effective-dated machine pay arrangements.';

revoke execute on function public.admin_setup_timekeeping_technician_arrangements(text, text, text, text, date, jsonb)
  from public, anon;
grant execute on function public.admin_setup_timekeeping_technician_arrangements(text, text, text, text, date, jsonb)
  to authenticated;
