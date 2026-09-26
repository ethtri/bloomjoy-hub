-- Phase A: SnapCase has no verified complete cash + card sales source in Hub.
-- Keep current imported amounts available as estimates, but fail closed anywhere
-- a positive commission rate makes a Pay Stub depend on those sales.

create function private.operator_incomplete_snapcase_sales_machines(
  p_account_id uuid,
  p_operator_profile_id uuid,
  p_period_start date,
  p_period_end date
)
returns table (
  machine_id uuid,
  machine_label text,
  assigned_start_date date,
  assigned_end_date date
)
language sql
stable
security definer
set search_path = ''
as $$
  select
    machine.id,
    machine.machine_label,
    min(assigned_day.value)::date,
    max(assigned_day.value)::date
  from public.operator_machine_assignments assignment
  join public.reporting_machines machine
    on machine.id = assignment.reporting_machine_id
    and machine.account_id = assignment.account_id
  cross join lateral generate_series(
    greatest(assignment.effective_start_date, p_period_start)::timestamp,
    least(coalesce(assignment.effective_end_date, p_period_end), p_period_end)::timestamp,
    interval '1 day'
  ) assigned_day(value)
  where assignment.account_id = p_account_id
    and assignment.operator_profile_id = p_operator_profile_id
    and assignment.status = 'active'
    and assignment.revoked_at is null
    and assignment.effective_start_date <= p_period_end
    and coalesce(assignment.effective_end_date, 'infinity'::date) >= p_period_start
    and machine.machine_type = 'snapcase'
    and coalesce(
      nullif(
        public.operator_compensation_rate_at(
          p_account_id,
          p_operator_profile_id,
          machine.id,
          assigned_day.value::date,
          'commission'
        ) ->> 'commissionBasisPoints',
        ''
      )::integer,
      0
    ) > 0
  group by machine.id, machine.machine_label;
$$;

revoke execute on function private.operator_incomplete_snapcase_sales_machines(uuid, uuid, date, date)
  from public, anon, authenticated;
grant execute on function private.operator_incomplete_snapcase_sales_machines(uuid, uuid, date, date)
  to service_role;

comment on function private.operator_incomplete_snapcase_sales_machines(uuid, uuid, date, date) is
  'Phase A list of assigned SnapCase machines whose positive commission rate requires sales that Hub cannot yet prove complete. A later coverage/reconciliation migration will replace this fail-closed source predicate.';

alter function private.calculate_technician_pay_report(uuid, uuid, date, date)
  rename to calculate_technician_pay_report_without_snapcase_readiness;

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
  blockers jsonb;
  incomplete_machine record;
begin
  result := private.calculate_technician_pay_report_without_snapcase_readiness(
    p_account_id,
    p_operator_profile_id,
    p_period_start_date,
    p_period_end_date
  );
  blockers := coalesce(result -> 'blockers', '[]'::jsonb);

  for incomplete_machine in
    select *
    from private.operator_incomplete_snapcase_sales_machines(
      p_account_id,
      p_operator_profile_id,
      p_period_start_date,
      p_period_end_date
    )
  loop
    if not exists (
      select 1
      from jsonb_array_elements(blockers) blocker(item)
      where blocker.item ->> 'code' = 'snapcase_sales_incomplete'
        and blocker.item ->> 'machineId' = incomplete_machine.machine_id::text
    ) then
      blockers := blockers || jsonb_build_array(jsonb_build_object(
        'code', 'snapcase_sales_incomplete',
        'severity', 'blocker',
        'message', 'Imported SnapCase sales are still an estimate. Waiting for complete cash and card sales for '
          || incomplete_machine.machine_label || ' before publishing.',
        'operatorProfileId', p_operator_profile_id,
        'machineId', incomplete_machine.machine_id,
        'requiredStartDate', incomplete_machine.assigned_start_date,
        'requiredEndDate', incomplete_machine.assigned_end_date,
        'readiness', 'waiting_for_sales'
      ));
    end if;
  end loop;

  result := result || jsonb_build_object(
    'blockers', blockers,
    'publishable',
      coalesce((result ->> 'publishable')::boolean, false)
      and jsonb_array_length(blockers) = 0
  );

  if exists (
    select 1
    from jsonb_array_elements(blockers) blocker(item)
    where blocker.item ->> 'code' = 'snapcase_sales_incomplete'
  ) then
    result := result || jsonb_build_object(
      'calculationMeta', coalesce(result -> 'calculationMeta', '{}'::jsonb)
        || jsonb_build_object(
          'snapcaseSalesReadiness', 'phase_a_unverified',
          'snapcaseSalesReadinessPolicy',
            'Positive SnapCase commission waits for verified complete cash and card coverage.'
        )
    );
  end if;

  return result;
end;
$$;

revoke execute on function private.calculate_technician_pay_report_without_snapcase_readiness(uuid, uuid, date, date)
  from public, anon, authenticated;
grant execute on function private.calculate_technician_pay_report_without_snapcase_readiness(uuid, uuid, date, date)
  to service_role;
revoke execute on function private.calculate_technician_pay_report(uuid, uuid, date, date)
  from public, anon, authenticated;
grant execute on function private.calculate_technician_pay_report(uuid, uuid, date, date)
  to service_role;

comment on function private.calculate_technician_pay_report(uuid, uuid, date, date) is
  'Calculates the Technician Pay Report and appends the Phase A SnapCase completeness blocker only when a positive commission rate depends on unverified SnapCase sales.';

-- Open months remain useful estimates. Keep the same reason visible, but move
-- it out of the blocker list so the existing UI continues to show imported
-- month-to-date sales and calculated earnings until the month closes.
alter function private.normalize_technician_pay_report_status(jsonb, date, date, date)
  rename to normalize_technician_pay_report_status_without_snapcase_open;

create function private.normalize_technician_pay_report_status(
  p_calculation jsonb,
  p_period_start date,
  p_period_end date,
  p_as_of_date date
)
returns jsonb
language plpgsql
stable
security invoker
set search_path = ''
as $$
declare
  normalized jsonb;
  estimate_notices jsonb := '[]'::jsonb;
  remaining_blockers jsonb := '[]'::jsonb;
begin
  normalized := private.normalize_technician_pay_report_status_without_snapcase_open(
    p_calculation,
    p_period_start,
    p_period_end,
    p_as_of_date
  );

  if p_as_of_date between p_period_start and p_period_end then
    select
      coalesce(jsonb_agg(blocker.item order by blocker.position)
        filter (where blocker.item ->> 'code' <> 'snapcase_sales_incomplete'), '[]'::jsonb),
      coalesce(jsonb_agg(
        blocker.item || jsonb_build_object(
          'severity', 'warning',
          'message', 'Month-to-date SnapCase sales and commission are estimates while complete cash and card sales are still pending.'
        ) order by blocker.position
      ) filter (where blocker.item ->> 'code' = 'snapcase_sales_incomplete'), '[]'::jsonb)
    into remaining_blockers, estimate_notices
    from jsonb_array_elements(coalesce(normalized -> 'blockers', '[]'::jsonb))
      with ordinality blocker(item, position);

    normalized := jsonb_set(normalized, '{blockers}', remaining_blockers, true);
    normalized := jsonb_set(
      normalized,
      '{warnings}',
      coalesce(normalized -> 'warnings', '[]'::jsonb) || estimate_notices,
      true
    );
    normalized := jsonb_set(normalized, '{publishable}', 'false'::jsonb, true);
  end if;

  return normalized;
end;
$$;

revoke execute on function private.normalize_technician_pay_report_status_without_snapcase_open(jsonb, date, date, date)
  from public, anon, authenticated;
grant execute on function private.normalize_technician_pay_report_status_without_snapcase_open(jsonb, date, date, date)
  to service_role;
revoke execute on function private.normalize_technician_pay_report_status(jsonb, date, date, date)
  from public, anon, authenticated;
grant execute on function private.normalize_technician_pay_report_status(jsonb, date, date, date)
  to service_role;

comment on function private.normalize_technician_pay_report_status(jsonb, date, date, date) is
  'Keeps incomplete SnapCase sales visible as an open-month estimate notice, then preserves the same reason as a closed-month publication blocker.';

create function private.payout_run_snapcase_sales_incomplete_blockers(
  p_payout_run_id uuid
)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(jsonb_agg(jsonb_build_object(
    'code', 'snapcase_sales_incomplete',
    'severity', 'blocker',
    'message', 'Imported SnapCase sales are still an estimate. Waiting for complete cash and card sales for '
      || affected.machine_label || ' before publishing.',
    'operatorProfileId', affected.operator_profile_id,
    'machineId', affected.machine_id,
    'requiredStartDate', affected.assigned_start_date,
    'requiredEndDate', affected.assigned_end_date,
    'readiness', 'waiting_for_sales'
  ) order by affected.operator_profile_id, affected.machine_label, affected.machine_id), '[]'::jsonb)
  from (
    select distinct
      item.operator_profile_id,
      incomplete.machine_id,
      incomplete.machine_label,
      incomplete.assigned_start_date,
      incomplete.assigned_end_date
    from public.payout_runs run
    join public.payout_periods period on period.id = run.payout_period_id
    join public.payout_run_items item
      on item.payout_run_id = run.id
      and item.status <> 'voided'
    cross join lateral private.operator_incomplete_snapcase_sales_machines(
      run.account_id,
      item.operator_profile_id,
      period.period_start_date,
      period.period_end_date
    ) incomplete
    where run.id = p_payout_run_id
  ) affected;
$$;

revoke execute on function private.payout_run_snapcase_sales_incomplete_blockers(uuid)
  from public, anon, authenticated;
grant execute on function private.payout_run_snapcase_sales_incomplete_blockers(uuid)
  to service_role;

alter function public.admin_finalize_payout_run(uuid, text, boolean, text)
  rename to admin_finalize_payout_run_without_snapcase_readiness;

create function public.admin_finalize_payout_run(
  p_payout_run_id uuid,
  p_reason text,
  p_override_blockers boolean default false,
  p_override_reason text default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  actor_user_id uuid := auth.uid();
  blockers jsonb;
begin
  if actor_user_id is null then
    raise exception 'Authentication required';
  end if;
  if not coalesce(
    public.operator_can_finalize_payout_run(actor_user_id, p_payout_run_id),
    false
  ) then
    raise exception 'Payout finalization access required';
  end if;

  blockers := private.payout_run_snapcase_sales_incomplete_blockers(p_payout_run_id);
  if jsonb_array_length(blockers) > 0 then
    raise exception 'SnapCase sales coverage is incomplete; this payout run cannot be finalized';
  end if;

  return public.admin_finalize_payout_run_without_snapcase_readiness(
    p_payout_run_id,
    p_reason,
    p_override_blockers,
    p_override_reason
  );
end;
$$;

revoke execute on function public.admin_finalize_payout_run_without_snapcase_readiness(uuid, text, boolean, text)
  from public, anon, authenticated;
revoke execute on function public.admin_finalize_payout_run(uuid, text, boolean, text)
  from public, anon;
grant execute on function public.admin_finalize_payout_run(uuid, text, boolean, text)
  to authenticated;

comment on function public.admin_finalize_payout_run(uuid, text, boolean, text) is
  'Finalizes a reviewed payout run while preventing blocker overrides from bypassing incomplete SnapCase commission sales.';

alter function public.admin_issue_pay_statements(uuid, text, text)
  rename to admin_issue_pay_statements_without_snapcase_readiness;

create function public.admin_issue_pay_statements(
  p_payout_run_id uuid,
  p_reason text,
  p_revision_reason text default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  actor_user_id uuid := auth.uid();
  blockers jsonb;
begin
  if actor_user_id is null then
    raise exception 'Authentication required';
  end if;
  if not coalesce(
    public.operator_can_finalize_payout_run(actor_user_id, p_payout_run_id),
    false
  ) then
    raise exception 'Pay statement issuance access required';
  end if;

  blockers := private.payout_run_snapcase_sales_incomplete_blockers(p_payout_run_id);
  if jsonb_array_length(blockers) > 0 then
    raise exception 'SnapCase sales coverage is incomplete; pay statements cannot be issued';
  end if;

  return public.admin_issue_pay_statements_without_snapcase_readiness(
    p_payout_run_id,
    p_reason,
    p_revision_reason
  );
end;
$$;

revoke execute on function public.admin_issue_pay_statements_without_snapcase_readiness(uuid, text, text)
  from public, anon, authenticated;
revoke execute on function public.admin_issue_pay_statements(uuid, text, text)
  from public, anon;
grant execute on function public.admin_issue_pay_statements(uuid, text, text)
  to authenticated;

comment on function public.admin_issue_pay_statements(uuid, text, text) is
  'Issues legacy pay statements only when no included positive-commission SnapCase machine is waiting for complete sales.';

alter function public.service_complete_pay_stub(uuid, uuid, text)
  rename to service_complete_pay_stub_without_snapcase_readiness;

create function public.service_complete_pay_stub(
  p_request_id uuid,
  p_pay_statement_id uuid,
  p_storage_path text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  request_row public.pay_stub_generation_requests;
  period_row public.payout_periods;
  report jsonb;
begin
  if current_user not in ('postgres', 'service_role')
    and coalesce(auth.role(), '') <> 'service_role' then
    raise exception 'Service role required';
  end if;

  select * into request_row
  from public.pay_stub_generation_requests request
  where request.id = p_request_id
    and request.status = 'processing'
    and request.pay_statement_id = p_pay_statement_id
  for update;
  if request_row.id is null then
    raise exception 'Processing Pay Stub request not found';
  end if;

  select * into period_row
  from public.payout_periods period
  where period.id = request_row.payout_period_id;

  report := private.calculate_technician_pay_report(
    request_row.account_id,
    request_row.operator_profile_id,
    period_row.period_start_date,
    period_row.period_end_date
  );

  if exists (
    select 1
    from jsonb_array_elements(coalesce(report -> 'blockers', '[]'::jsonb)) blocker(item)
    where blocker.item ->> 'code' = 'snapcase_sales_incomplete'
  ) then
    update public.pay_stub_generation_requests
    set
      status = 'blocked',
      blocker_details = coalesce(report -> 'blockers', '[]'::jsonb),
      completed_at = now()
    where id = request_row.id;

    return jsonb_build_object(
      'requestId', request_row.id,
      'status', 'blocked',
      'blockers', coalesce(report -> 'blockers', '[]'::jsonb)
    );
  end if;

  return public.service_complete_pay_stub_without_snapcase_readiness(
    p_request_id,
    p_pay_statement_id,
    p_storage_path
  );
end;
$$;

revoke execute on function public.service_complete_pay_stub_without_snapcase_readiness(uuid, uuid, text)
  from public, anon, authenticated;
grant execute on function public.service_complete_pay_stub_without_snapcase_readiness(uuid, uuid, text)
  to service_role;
revoke execute on function public.service_complete_pay_stub(uuid, uuid, text)
  from public, anon, authenticated;
grant execute on function public.service_complete_pay_stub(uuid, uuid, text)
  to service_role;

comment on function public.service_complete_pay_stub(uuid, uuid, text) is
  'Rechecks Phase A SnapCase sales readiness after PDF preparation and before publishing an immutable Pay Stub version.';
