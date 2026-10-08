-- Exact pre-plan-reuse helper for transaction-only source/readiness parity.
CREATE OR REPLACE FUNCTION pg_temp.reporting_missing_nayax_before(p_account_id uuid, p_operator_profile_id uuid, p_period_start date, p_period_end date)
 RETURNS TABLE(machine_id uuid, machine_label text)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
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
    and (machine.machine_type = 'snapcase' or mapping.id is not null)
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
$function$

