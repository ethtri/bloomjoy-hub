-- Make the monthly Technician Pay Report truthful while a month is still open,
-- collapse duplicate sales-freshness findings, and expose the effective-dated
-- payout assignments that an account pay manager can already edit through the
-- audited assignment RPC.

create or replace function private.normalize_technician_pay_report_status(
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
  normalized jsonb := coalesce(p_calculation, '{}'::jsonb);
  original_blockers jsonb := coalesce(p_calculation -> 'blockers', '[]'::jsonb);
  normalized_blockers jsonb := '[]'::jsonb;
  normalized_warnings jsonb := coalesce(p_calculation -> 'warnings', '[]'::jsonb);
  period_in_progress boolean := p_as_of_date between p_period_start and p_period_end;
  has_assignment_in_period boolean := jsonb_array_length(
    coalesce(p_calculation -> 'machines', '[]'::jsonb)
  ) > 0;
  sales_through_date date;
  current_total_cents bigint := coalesce(nullif(p_calculation ->> 'currentTotalCents', '')::bigint, 0);
begin
  select coalesce(jsonb_agg(blocker.item order by blocker.position), '[]'::jsonb)
  into normalized_blockers
  from jsonb_array_elements(original_blockers) with ordinality blocker(item, position)
  where not (
    period_in_progress
    and blocker.item ->> 'code' in ('stale_commission_sales_facts', 'stale_sales_source')
  )
  and not (
    blocker.item ->> 'code' = 'stale_sales_source'
    and exists (
      select 1
      from jsonb_array_elements(original_blockers) companion(item)
      where coalesce(companion.item ->> 'machineId', '') = coalesce(blocker.item ->> 'machineId', '')
        and companion.item ->> 'code' in (
          'stale_commission_sales_facts',
          'missing_commission_sales_facts',
          'missing_revenue_snapshot'
        )
    )
  );

  if period_in_progress then
    select min(nullif(machine.item ->> 'sourceLatestSaleDate', '')::date)
    into sales_through_date
    from jsonb_array_elements(coalesce(normalized -> 'machines', '[]'::jsonb)) machine(item);

    if sales_through_date is not null then
      normalized_warnings := normalized_warnings || jsonb_build_array(jsonb_build_object(
        'code', 'current_period_sales_through',
        'severity', 'info',
        'message', 'Month in progress. Commissionable Sales include imported facts through '
          || to_char(sales_through_date, 'Mon FMDD, YYYY') || '.',
        'salesThroughDate', sales_through_date
      ));
    end if;
  end if;

  normalized := jsonb_set(normalized, '{blockers}', normalized_blockers, true);
  normalized := jsonb_set(normalized, '{warnings}', normalized_warnings, true);
  normalized := jsonb_set(
    normalized,
    '{publishable}',
    to_jsonb(
      not period_in_progress
      and not (not has_assignment_in_period and current_total_cents = 0)
      and jsonb_array_length(normalized_blockers) = 0
    ),
    true
  );
  normalized := jsonb_set(
    normalized,
    '{calculationMeta}',
    coalesce(normalized -> 'calculationMeta', '{}'::jsonb) || jsonb_build_object(
      'periodInProgress', period_in_progress,
      'asOfDate', p_as_of_date,
      'salesThroughDate', sales_through_date,
      'hasAssignmentInPeriod', has_assignment_in_period,
      'freshnessPolicy', 'Open months show imported sales through the latest available fact date; closed months require complete source data.'
    ),
    true
  );

  return normalized;
end;
$$;

revoke execute on function private.normalize_technician_pay_report_status(jsonb, date, date, date)
  from public, anon, authenticated;
grant execute on function private.normalize_technician_pay_report_status(jsonb, date, date, date)
  to service_role;

alter function public.get_technician_pay_report_context(date)
  rename to get_technician_pay_report_context_without_assignment_clarity;

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
  period_start date;
  period_end date;
  as_of_date date := timezone('America/Los_Angeles', now())::date;
  enriched_technicians jsonb;
begin
  base_context := public.get_technician_pay_report_context_without_assignment_clarity(p_month);
  period_start := (base_context ->> 'periodStartDate')::date;
  period_end := (base_context ->> 'periodEndDate')::date;

  select coalesce(jsonb_agg(
    private.normalize_technician_pay_report_status(
      report.technician,
      period_start,
      period_end,
      as_of_date
    ) || jsonb_build_object(
      'assignments', coalesce((
        select jsonb_agg(jsonb_build_object(
          'assignmentId', assignment.id,
          'machineId', assignment.reporting_machine_id,
          'machineLabel', machine.machine_label,
          'locationId', machine.location_id,
          'locationName', location.name,
          'effectiveStartDate', assignment.effective_start_date,
          'effectiveEndDate', assignment.effective_end_date,
          'status', assignment.status,
          'editable', assignment.status = 'active' and assignment.revoked_at is null,
          'overlapsSelectedPeriod', assignment.effective_start_date <= period_end
            and coalesce(assignment.effective_end_date, 'infinity'::date) >= period_start,
          'selectedPeriodGrossSalesCents', coalesce((
            select sum(fact.net_sales_cents)::bigint
            from public.machine_sales_facts fact
            where fact.reporting_machine_id = assignment.reporting_machine_id
              and fact.sale_date between period_start and period_end
          ), 0)
        ) order by
          case when assignment.status = 'active' and assignment.revoked_at is null then 0 else 1 end,
          machine.machine_label,
          assignment.effective_start_date desc,
          assignment.id)
        from public.operator_machine_assignments assignment
        join public.reporting_machines machine
          on machine.id = assignment.reporting_machine_id
          and machine.account_id = (report.technician ->> 'accountId')::uuid
        join public.reporting_locations location on location.id = machine.location_id
        where assignment.operator_profile_id = (report.technician ->> 'operatorProfileId')::uuid
          and assignment.account_id = (report.technician ->> 'accountId')::uuid
      ), '[]'::jsonb)
    )
    order by report.technician ->> 'displayName', report.technician ->> 'operatorProfileId'
  ), '[]'::jsonb)
  into enriched_technicians
  from jsonb_array_elements(coalesce(base_context -> 'technicians', '[]'::jsonb)) report(technician);

  return base_context || jsonb_build_object(
    'asOfDate', as_of_date,
    'technicians', enriched_technicians
  );
end;
$$;

revoke execute on function public.get_technician_pay_report_context_without_assignment_clarity(date)
  from public, anon, authenticated;
grant execute on function public.get_technician_pay_report_context_without_assignment_clarity(date)
  to service_role;
revoke execute on function public.get_technician_pay_report_context(date)
  from public, anon;
grant execute on function public.get_technician_pay_report_context(date)
  to authenticated;

comment on function private.normalize_technician_pay_report_status(jsonb, date, date, date) is
  'Collapses duplicate sales-freshness findings, treats an open month as a non-publishable estimate, and preserves genuine closed-period blockers.';
comment on function public.get_technician_pay_report_context(date) is
  'Account-pay-authorized monthly Technician Pay Report with assignment history, open-month as-of status, and durable Pay Stub regeneration state.';
