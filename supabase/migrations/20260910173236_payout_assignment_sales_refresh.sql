-- Assignment-date changes alter which historical machine sales belong to a
-- Technician. A matching, regenerated monthly snapshot is the completeness
-- attestation for a closed month; the last transaction date is not, because a
-- machine can legitimately have no sale on the final calendar day.

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
    blocker.item ->> 'code' in ('stale_commission_sales_facts', 'stale_sales_source')
    and (
      period_in_progress
      or exists (
        select 1
        from jsonb_array_elements(coalesce(normalized -> 'machines', '[]'::jsonb)) machine(item)
        where coalesce(machine.item ->> 'machineId', '') = coalesce(blocker.item ->> 'machineId', '')
          and nullif(machine.item ->> 'revenueSnapshotId', '') is not null
          and coalesce(nullif(machine.item ->> 'snapshotMatchesFacts', '')::boolean, false)
      )
    )
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
      'freshnessPolicy', 'Open months show imported sales through the latest available fact date. Closed months require a refreshed snapshot that matches the authoritative facts; a zero-sales final day is valid.'
    ),
    true
  );

  return normalized;
end;
$$;

comment on function private.normalize_technician_pay_report_status(jsonb, date, date, date) is
  'Normalizes Technician Pay Report blockers, accepting a matching refreshed snapshot as closed-month completeness evidence even when the final calendar day has no sales.';

-- The report can calculate a month before anyone has entered time, so the
-- refresh action must establish the corresponding monthly period instead of
-- returning a successful no-op. This is especially important immediately
-- after a historical assignment is added.
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
  profile_id uuid;
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

  for profile_id in
    select distinct profile.id
    from public.operator_payout_profiles profile
    where (p_account_id is null or profile.account_id = p_account_id)
      and public.can_manage_operator_payout_account(actor_user_id, profile.account_id)
      and exists (
        select 1
        from public.operator_machine_assignments assignment
        where assignment.operator_profile_id = profile.id
          and assignment.account_id = profile.account_id
          and assignment.effective_start_date <= period_end
          and coalesce(assignment.effective_end_date, 'infinity'::date) >= period_start
      )
    order by profile.id
  loop
    perform public.ensure_operator_payout_period_for_date(profile_id, period_start);
  end loop;

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

comment on function public.admin_refresh_technician_pay_report_sales(date, uuid) is
  'Creates any missing authorized monthly payout period and refreshes authoritative Commissionable Sales snapshots for Technician Pay Reports.';
