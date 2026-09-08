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
      and profile.status = 'active'
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
  assigned_machines as materialized (
    select
      assignment.reporting_machine_id,
      machine.machine_label,
      machine.location_id,
      location.name as location_name,
      min(greatest(assignment.effective_start_date, p_period_start_date)) as assigned_start_date,
      max(least(coalesce(assignment.effective_end_date, p_period_end_date), p_period_end_date)) as assigned_end_date,
      not exists (
        select 1
        from generate_series(
          p_period_start_date::timestamp,
          p_period_end_date::timestamp,
          interval '1 day'
        ) day_value
        where not exists (
          select 1
          from public.operator_machine_assignments coverage
          where coverage.operator_profile_id = p_operator_profile_id
            and coverage.reporting_machine_id = assignment.reporting_machine_id
            and coverage.status = 'active'
            and coverage.revoked_at is null
            and day_value::date between coverage.effective_start_date
              and coalesce(coverage.effective_end_date, 'infinity'::date)
        )
      ) as full_period_scope,
      exists (
        select 1
        from public.operator_machine_assignments other_assignment
        where other_assignment.reporting_machine_id = assignment.reporting_machine_id
          and other_assignment.operator_profile_id <> p_operator_profile_id
          and other_assignment.status = 'active'
          and other_assignment.revoked_at is null
          and other_assignment.effective_start_date <= p_period_end_date
          and coalesce(other_assignment.effective_end_date, 'infinity'::date) >= p_period_start_date
      ) as shared_compensation_scope
    from public.operator_machine_assignments assignment
    join public.reporting_machines machine
      on machine.id = assignment.reporting_machine_id
      and machine.account_id = p_account_id
    join public.reporting_locations location on location.id = machine.location_id
    where assignment.operator_profile_id = p_operator_profile_id
      and assignment.account_id = p_account_id
      and assignment.status = 'active'
      and assignment.revoked_at is null
      and assignment.effective_start_date <= p_period_end_date
      and coalesce(assignment.effective_end_date, 'infinity'::date) >= p_period_start_date
    group by
      assignment.reporting_machine_id,
      machine.machine_label,
      machine.location_id,
      location.name
  ),
  commission_base as materialized (
    select
      assigned.*,
      snapshot.id as revenue_snapshot_id,
      snapshot.gross_sales_cents,
      snapshot.refund_adjustment_cents,
      snapshot.net_revenue_cents,
      snapshot.eligible_commission_revenue_cents,
      snapshot.source_latest_sale_date,
      snapshot.generated_at as revenue_generated_at,
      snapshot.status as revenue_snapshot_status,
      snapshot.warnings as revenue_warnings,
      public.operator_compensation_rate_at(
        p_account_id,
        p_operator_profile_id,
        assigned.reporting_machine_id,
        p_period_end_date,
        'commission'
      ) as commission_rate,
      (
        select count(distinct rate_value.commission_basis_points)::integer
        from (
          select nullif(
            public.operator_compensation_rate_at(
              p_account_id,
              p_operator_profile_id,
              assigned.reporting_machine_id,
              day_value::date,
              'commission'
            ) ->> 'commissionBasisPoints',
            ''
          )::integer as commission_basis_points
          from generate_series(
            p_period_start_date::timestamp,
            p_period_end_date::timestamp,
            interval '1 day'
          ) day_value
        ) rate_value
        where rate_value.commission_basis_points is not null
      ) as commission_rate_count,
      exists (
        select 1
        from generate_series(
          p_period_start_date::timestamp,
          p_period_end_date::timestamp,
          interval '1 day'
        ) day_value
        where public.operator_compensation_rate_at(
          p_account_id,
          p_operator_profile_id,
          assigned.reporting_machine_id,
          day_value::date,
          'commission'
        ) is null
      ) as commission_rate_missing_day
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
  ),
  commission_lines as materialized (
    select
      commission.*,
      nullif(commission.commission_rate ->> 'commissionBasisPoints', '')::integer
        as commission_basis_points,
      case
        when commission.revenue_snapshot_id is null or commission.commission_rate is null then 0
        else round(
          commission.eligible_commission_revenue_cents::numeric
          * nullif(commission.commission_rate ->> 'commissionBasisPoints', '')::integer
          / 10000
        )::integer
      end as commission_earnings_cents
    from commission_base commission
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
        and assignment.status = 'active'
        and assignment.revoked_at is null
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
    where commission.commission_rate is null
      or commission.commission_rate_missing_day

    union all

    select jsonb_build_object(
      'code', 'partial_period_assignment_scope',
      'severity', 'blocker',
      'message', 'Resolve the Technician assignment window before publishing this month.',
      'operatorProfileId', p_operator_profile_id,
      'machineId', commission.reporting_machine_id
    )
    from commission_lines commission
    where not commission.full_period_scope

    union all

    select jsonb_build_object(
      'code', 'shared_machine_compensation_scope',
      'severity', 'blocker',
      'message', 'Resolve the shared machine compensation scope before publishing this month.',
      'operatorProfileId', p_operator_profile_id,
      'machineId', commission.reporting_machine_id
    )
    from commission_lines commission
    where commission.shared_compensation_scope

    union all

    select jsonb_build_object(
      'code', 'commission_rate_changed_within_snapshot',
      'severity', 'blocker',
      'message', 'Refresh Commissionable Sales into effective-rate segments before publishing this month.',
      'operatorProfileId', p_operator_profile_id,
      'machineId', commission.reporting_machine_id
    )
    from commission_lines commission
    where commission.commission_rate_count > 1

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
        'assignmentScopeResolved', commission.full_period_scope and not commission.shared_compensation_scope,
        'commissionRateCompleteForPeriod', not commission.commission_rate_missing_day,
        'revenueSnapshotId', commission.revenue_snapshot_id,
        'revenueSnapshotStatus', commission.revenue_snapshot_status,
        'revenueGeneratedAt', commission.revenue_generated_at,
        'sourceLatestSaleDate', commission.source_latest_sale_date,
        'grossSalesCents', coalesce(commission.gross_sales_cents, 0),
        'refundAdjustmentCents', coalesce(commission.refund_adjustment_cents, 0),
        'netRevenueCents', coalesce(commission.net_revenue_cents, 0),
        'commissionableSalesCents', coalesce(commission.eligible_commission_revenue_cents, 0),
        'commissionRate', commission.commission_rate,
        'commissionBasisPoints', commission.commission_basis_points,
        'commissionEarningsCents', commission.commission_earnings_cents,
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
      'commissionBasisSource', 'payout_period_machine_revenue_snapshots.eligible_commission_revenue_cents',
      'refundAppliedOnce', true,
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
      and profile.status = 'active'
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

revoke execute on function public.get_my_time_review_context(date)
  from public, anon, authenticated;
grant execute on function public.get_my_time_review_context(date)
  to authenticated;

revoke execute on function public.get_technician_pay_report_context(date)
  from public, anon, authenticated;
grant execute on function public.get_technician_pay_report_context(date)
  to authenticated;

select pg_notify('pgrst', 'reload schema');
