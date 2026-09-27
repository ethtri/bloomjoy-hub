-- Replace the temporary machine-type-only SnapCase payroll hold with the
-- completed payment-import windows that already drive financial projection.
-- Coverage is required only for effective positive-commission assignment days
-- in a finished reporting month. A present completed zero-payment window is
-- valid coverage.

create or replace function private.operator_incomplete_snapcase_sales_machines(
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
  with required_days as (
    select distinct
      machine.id as machine_id,
      machine.machine_label,
      assigned_day.value::date as assigned_date
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
      and assignment.effective_start_date <= p_period_end
      and coalesce(assignment.effective_end_date, 'infinity'::date) >= p_period_start
      and machine.machine_type = 'snapcase'
      and p_period_end < (pg_catalog.statement_timestamp()
        at time zone 'America/Los_Angeles')::date
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
  ),
  missing_days as (
    select required.*
    from required_days required
    where not exists (
      select 1
      from private.snapcase_machine_mappings mapping
      join private.snapcase_completed_import_windows completed
        on completed.provider_account_id = mapping.provider_account_id
        and completed.source_machine_id = mapping.source_machine_id
        and completed.local_start_date <= required.assigned_date
        and completed.local_end_date_exclusive > required.assigned_date
      where mapping.reporting_machine_id = required.machine_id
        and mapping.effective_start_date <= required.assigned_date
        and coalesce(mapping.effective_end_date, 'infinity'::date)
          >= required.assigned_date
    )
  )
  select
    missing.machine_id,
    missing.machine_label,
    min(missing.assigned_date),
    max(missing.assigned_date)
  from missing_days missing
  group by missing.machine_id, missing.machine_label;
$$;

revoke execute on function private.operator_incomplete_snapcase_sales_machines(uuid, uuid, date, date)
  from public, anon, authenticated;
grant execute on function private.operator_incomplete_snapcase_sales_machines(uuid, uuid, date, date)
  to service_role;

comment on function private.operator_incomplete_snapcase_sales_machines(uuid, uuid, date, date) is
  'Lists finished-period SnapCase machines with positive-commission assignment dates not covered by finalized payment imports. The private finalizer records completion only after mapped cash projection succeeds; completed zero-payment windows count as coverage.';

create function private.operator_snapcase_zero_import_covers_commission_days(
  p_account_id uuid,
  p_operator_profile_id uuid,
  p_machine_id uuid,
  p_start_date date,
  p_end_date date
)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  with required_days as materialized (
    select distinct assigned_day.value::date as assigned_date
    from public.operator_machine_assignments assignment
    join public.reporting_machines machine
      on machine.id = assignment.reporting_machine_id
      and machine.account_id = assignment.account_id
    cross join lateral generate_series(
      greatest(assignment.effective_start_date, p_start_date)::timestamp,
      least(coalesce(assignment.effective_end_date, p_end_date), p_end_date)::timestamp,
      interval '1 day'
    ) assigned_day(value)
    where p_start_date <= p_end_date
      and assignment.account_id = p_account_id
      and assignment.operator_profile_id = p_operator_profile_id
      and assignment.reporting_machine_id = p_machine_id
      and assignment.effective_start_date <= p_end_date
      and coalesce(assignment.effective_end_date, 'infinity'::date) >= p_start_date
      and machine.machine_type = 'snapcase'
      and coalesce(
        nullif(
          public.operator_compensation_rate_at(
            p_account_id,
            p_operator_profile_id,
            p_machine_id,
            assigned_day.value::date,
            'commission'
          ) ->> 'commissionBasisPoints',
          ''
        )::integer,
        0
      ) > 0
  )
  select exists(select 1 from required_days)
    and not exists (
      select 1
      from required_days required
      where not exists (
        select 1
        from private.snapcase_machine_mappings mapping
        join private.snapcase_completed_import_windows completed
          on completed.provider_account_id = mapping.provider_account_id
          and completed.source_machine_id = mapping.source_machine_id
          and completed.local_start_date <= required.assigned_date
          and completed.local_end_date_exclusive > required.assigned_date
          and completed.payment_observed_count = 0
        where mapping.reporting_machine_id = p_machine_id
          and mapping.effective_start_date <= required.assigned_date
          and coalesce(mapping.effective_end_date, 'infinity'::date)
            >= required.assigned_date
      )
    );
$$;

revoke execute on function private.operator_snapcase_zero_import_covers_commission_days(uuid, uuid, uuid, date, date)
  from public, anon, authenticated;
grant execute on function private.operator_snapcase_zero_import_covers_commission_days(uuid, uuid, uuid, date, date)
  to service_role;

comment on function private.operator_snapcase_zero_import_covers_commission_days(uuid, uuid, uuid, date, date) is
  'Returns true only when every positive-commission assignment date in the requested SnapCase range has a successfully projected completed import with zero observed payments.';

create or replace function private.operator_snapcase_missing_nayax_card_machines(
  p_account_id uuid,
  p_operator_profile_id uuid,
  p_period_start date,
  p_period_end date
)
returns table (
  machine_id uuid,
  machine_label text
)
language sql
stable
security definer
set search_path = ''
as $$
  select distinct machine.id, machine.machine_label
  from public.operator_machine_assignments assignment
  join public.reporting_machines machine
    on machine.id = assignment.reporting_machine_id
    and machine.account_id = assignment.account_id
  join public.reporting_locations location
    on location.id = machine.location_id
  cross join lateral generate_series(
    greatest(assignment.effective_start_date, p_period_start)::timestamp,
    least(coalesce(assignment.effective_end_date, p_period_end), p_period_end)::timestamp,
    interval '1 day'
  ) assigned_day(value)
  join private.snapcase_machine_mappings mapping
    on mapping.reporting_machine_id = machine.id
    and mapping.effective_start_date <= assigned_day.value::date
    and coalesce(mapping.effective_end_date, 'infinity'::date)
      >= assigned_day.value::date
  join private.snapcase_completed_import_windows completed
    on completed.provider_account_id = mapping.provider_account_id
    and completed.source_machine_id = mapping.source_machine_id
    and completed.local_start_date <= assigned_day.value::date
    and completed.local_end_date_exclusive > assigned_day.value::date
  join private.snapcase_sales_observations card_observation
    on card_observation.provider_account_id = completed.provider_account_id
    and card_observation.source_machine_id = completed.source_machine_id
    and card_observation.resource = 'payment'
    and card_observation.normalized_tender = 'card'
    and card_observation.source_status = 'success'
    and card_observation.source_tender_code = '0'
    and card_observation.occurred_at >= completed.requested_start
    and card_observation.occurred_at < completed.requested_end
    and (card_observation.occurred_at at time zone location.timezone)::date
      = assigned_day.value::date
  where assignment.account_id = p_account_id
    and assignment.operator_profile_id = p_operator_profile_id
    and assignment.effective_start_date <= p_period_end
    and coalesce(assignment.effective_end_date, 'infinity'::date) >= p_period_start
    and machine.machine_type = 'snapcase'
    and p_period_end < (pg_catalog.statement_timestamp()
      at time zone 'America/Los_Angeles')::date
    and not exists (
      select 1
      from public.machine_sales_facts nayax_fact
      where nayax_fact.reporting_machine_id = machine.id
        and nayax_fact.source = 'nayax_scheduled_report'
        and nayax_fact.payment_method = 'credit'
        and nayax_fact.sale_date between p_period_start and p_period_end
    )
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
    ) > 0;
$$;

revoke execute on function private.operator_snapcase_missing_nayax_card_machines(uuid, uuid, date, date)
  from public, anon, authenticated;
grant execute on function private.operator_snapcase_missing_nayax_card_machines(uuid, uuid, date, date)
  to service_role;

comment on function private.operator_snapcase_missing_nayax_card_machines(uuid, uuid, date, date) is
  'Lists finished-period positive-commission SnapCase machines where completed K payment evidence contains an in-scope card observation but the payroll period has no canonical Nayax card facts.';

create or replace function private.calculate_technician_pay_report(
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
  retained_blockers jsonb;
  incomplete_machine record;
  missing_card_machine record;
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
        'message', 'Sales data for ' || incomplete_machine.machine_label
          || ' is incomplete for assigned commission dates. Finish the import before publishing.',
        'operatorProfileId', p_operator_profile_id,
        'machineId', incomplete_machine.machine_id,
        'requiredStartDate', incomplete_machine.assigned_start_date,
        'requiredEndDate', incomplete_machine.assigned_end_date,
        'readiness', 'waiting_for_sales'
      ));
    end if;
  end loop;

  -- K cash may already provide a sales fact, so the generic no-facts check
  -- cannot by itself detect a completed window that observed card payments but
  -- has no canonical Nayax card facts. Reuse that existing finding for this
  -- narrow demonstrated missing-source case; partial/mismatched card totals do
  -- not introduce an amount-equality or per-payment gate.
  for missing_card_machine in
    select *
    from private.operator_snapcase_missing_nayax_card_machines(
      p_account_id,
      p_operator_profile_id,
      p_period_start_date,
      p_period_end_date
    )
  loop
    if not exists (
      select 1
      from jsonb_array_elements(blockers) blocker(item)
      where blocker.item ->> 'code' = 'missing_commission_sales_facts'
        and blocker.item ->> 'machineId' = missing_card_machine.machine_id::text
    ) then
      blockers := blockers || jsonb_build_array(jsonb_build_object(
        'code', 'missing_commission_sales_facts',
        'severity', 'blocker',
        'message', 'Load Commissionable Sales facts for this Technician assignment window.',
        'operatorProfileId', p_operator_profile_id,
        'machineId', missing_card_machine.machine_id
      ));
    end if;
  end loop;

  -- A completed zero-payment import is stronger evidence than the legacy
  -- missing/last-sale-date heuristic. Remove only that machine's generic
  -- source finding, and only for the exact positive-commission dates proved
  -- zero. Known K card observations therefore still require Nayax facts.
  select coalesce(jsonb_agg(blocker.item order by blocker.position), '[]'::jsonb)
  into retained_blockers
  from jsonb_array_elements(blockers) with ordinality blocker(item, position)
  where not (
    blocker.item ->> 'code' in (
      'missing_commission_sales_facts',
      'stale_commission_sales_facts',
      'stale_sales_source'
    )
    and nullif(blocker.item ->> 'machineId', '') is not null
    and private.operator_snapcase_zero_import_covers_commission_days(
      p_account_id,
      p_operator_profile_id,
      (blocker.item ->> 'machineId')::uuid,
      case
        when blocker.item ->> 'code' in ('stale_commission_sales_facts', 'stale_sales_source')
          and nullif(blocker.item ->> 'sourceLatestSaleDate', '') is not null
        then greatest(
          p_period_start_date,
          (blocker.item ->> 'sourceLatestSaleDate')::date + 1
        )
        else p_period_start_date
      end,
      least(
        p_period_end_date,
        coalesce(nullif(blocker.item ->> 'assignedEndDate', '')::date, p_period_end_date)
      )
    )
  );
  blockers := retained_blockers;

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
          'snapcaseSalesReadiness', 'missing_import_coverage',
          'snapcaseSalesReadinessPolicy',
            'Finished periods require completed sales-import coverage for assigned commission dates.'
        )
    );
  end if;

  return result;
end;
$$;

revoke execute on function private.calculate_technician_pay_report(uuid, uuid, date, date)
  from public, anon, authenticated;
grant execute on function private.calculate_technician_pay_report(uuid, uuid, date, date)
  to service_role;

comment on function private.calculate_technician_pay_report(uuid, uuid, date, date) is
  'Calculates the Technician Pay Report and appends one closed-period SnapCase blocker per machine when positive-commission assignment dates lack completed import coverage.';

-- The shared normalizer already keeps an in-progress month non-publishable and
-- exposes its ordinary source-freshness information. Remove only the SnapCase
-- closed-period finding when callers evaluate a month as still in progress.
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
  normalized jsonb;
  remaining_blockers jsonb;
  remaining_warnings jsonb;
begin
  normalized := private.normalize_technician_pay_report_status_without_snapcase_open(
    p_calculation,
    p_period_start,
    p_period_end,
    p_as_of_date
  );

  if p_as_of_date between p_period_start and p_period_end then
    select coalesce(jsonb_agg(blocker.item order by blocker.position), '[]'::jsonb)
    into remaining_blockers
    from jsonb_array_elements(coalesce(normalized -> 'blockers', '[]'::jsonb))
      with ordinality blocker(item, position)
    where blocker.item ->> 'code' <> 'snapcase_sales_incomplete';

    select coalesce(jsonb_agg(warning.item order by warning.position), '[]'::jsonb)
    into remaining_warnings
    from jsonb_array_elements(coalesce(normalized -> 'warnings', '[]'::jsonb))
      with ordinality warning(item, position)
    where warning.item ->> 'code' <> 'snapcase_sales_incomplete';

    normalized := jsonb_set(normalized, '{blockers}', remaining_blockers, true);
    normalized := jsonb_set(normalized, '{warnings}', remaining_warnings, true);
    normalized := jsonb_set(
      normalized,
      '{calculationMeta}',
      (coalesce(normalized -> 'calculationMeta', '{}'::jsonb)
        - 'snapcaseSalesReadiness' - 'snapcaseSalesReadinessPolicy'),
      true
    );
  end if;

  return normalized;
end;
$$;

revoke execute on function private.normalize_technician_pay_report_status(jsonb, date, date, date)
  from public, anon, authenticated;
grant execute on function private.normalize_technician_pay_report_status(jsonb, date, date, date)
  to service_role;

comment on function private.normalize_technician_pay_report_status(jsonb, date, date, date) is
  'Uses ordinary in-progress month freshness and publication rules without adding a routine SnapCase warning; closed-period missing import coverage remains actionable.';

create or replace function private.payout_run_snapcase_sales_incomplete_blockers(
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
    'message', 'Sales data for ' || affected.machine_label
      || ' is incomplete for assigned commission dates. Finish the import before publishing.',
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

comment on function private.payout_run_snapcase_sales_incomplete_blockers(uuid) is
  'Builds the existing payout publication blocker only for closed-period positive-commission SnapCase dates missing completed import coverage.';

comment on function public.service_complete_pay_stub(uuid, uuid, text) is
  'Rechecks completed SnapCase import coverage after PDF preparation and before publishing an immutable Pay Stub version.';

select pg_notify('pgrst', 'reload schema');
