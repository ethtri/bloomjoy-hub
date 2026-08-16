-- Run the existing read-only Nayax lookup once for each lookup-ready evidence
-- version. Existing automation action rows are the concurrency/idempotency lock.

alter table public.refund_automation_runs
  drop constraint if exists refund_automation_runs_trigger_source_check,
  add constraint refund_automation_runs_trigger_source_check
    check (trigger_source in ('scheduled', 'manual', 'event', 'health_check', 'failure_test'));

create or replace function public.service_start_refund_automation_run(
  p_run_key text,
  p_trigger_source text,
  p_scheduled_for timestamptz default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  normalized_run_key text;
  run_row public.refund_automation_runs;
  claimed boolean := false;
begin
  normalized_run_key := nullif(btrim(coalesce(p_run_key, '')), '');
  if normalized_run_key is null
    or length(normalized_run_key) not between 8 and 160
    or normalized_run_key !~ '^[A-Za-z0-9:_-]+$' then
    raise exception 'A safe refund automation run key is required';
  end if;

  if p_trigger_source not in ('scheduled', 'manual', 'event', 'health_check', 'failure_test') then
    raise exception 'Unsupported refund automation trigger source';
  end if;

  insert into public.refund_automation_runs (
    run_key,
    trigger_source,
    scheduled_for
  ) values (
    normalized_run_key,
    p_trigger_source,
    p_scheduled_for
  )
  on conflict (run_key) do nothing
  returning * into run_row;

  if run_row.id is not null then
    claimed := true;
  else
    select * into run_row
    from public.refund_automation_runs
    where run_key = normalized_run_key;
  end if;

  return jsonb_build_object(
    'runId', run_row.id,
    'claimed', claimed,
    'status', run_row.status,
    'startedAt', run_row.started_at,
    'finishedAt', run_row.finished_at
  );
end;
$$;

comment on function public.service_start_refund_automation_run(text, text, timestamptz) is
  'Service-only idempotent automation-run claim, including evidence-change event triggers.';

alter function public.admin_get_refund_operations_overview()
  rename to admin_get_refund_operations_overview_pre_auto_nayax_v1;

revoke execute on function public.admin_get_refund_operations_overview_pre_auto_nayax_v1()
  from public, anon, authenticated;

create function public.admin_get_refund_operations_overview()
returns jsonb
language plpgsql
stable
security definer
set search_path = public, auth
as $$
declare
  base_result jsonb;
  enriched_cases jsonb;
begin
  -- The upstream scoped function remains authoritative for paymentInteraction,
  -- incidentTimeConfidence, issueCategory, productLabel, machineStatus, and
  -- nearbyMachineAlerts. This wrapper changes only current lookup-operation UI
  -- state and preserves every sanitized evidence field byte-for-byte.
  base_result := public.admin_get_refund_operations_overview_pre_auto_nayax_v1();

  select coalesce(
    jsonb_agg(
      item.case_json || jsonb_build_object(
        'nayaxLookupSummary',
          coalesce(item.case_json -> 'nayaxLookupSummary', '{}'::jsonb) ||
          jsonb_build_object(
            'lookupStatus', case
              when current_lookup.status = 'claimed' then 'checking'
              when current_lookup.status = 'failed'
                and refund_case.nayax_recommendation_evaluated_at is null
                then 'lookup_failed'
              when refund_case.correlation_status = 'nayax_not_configured'
                then 'setup_needed'
              else coalesce(item.case_json #>> '{nayaxLookupSummary,lookupStatus}', 'not_started')
            end,
            'summary', case
              when current_lookup.status = 'claimed'
                then 'Bloomjoy is automatically checking recent Nayax sales for this case.'
              when current_lookup.status = 'failed'
                and refund_case.nayax_recommendation_evaluated_at is null
                then coalesce(
                  nullif(btrim(refund_case.correlation_summary), ''),
                  'The automatic Nayax check failed. A manager can retry the read-only lookup.'
                )
              else item.case_json #>> '{nayaxLookupSummary,summary}'
            end,
            'recommendedAction', case
              when current_lookup.status = 'claimed'
                then 'No manager action is needed while the automatic transaction check finishes.'
              when current_lookup.status = 'failed'
                and refund_case.nayax_recommendation_evaluated_at is null
                then 'Use Refresh transaction results to retry the read-only lookup.'
              when refund_case.correlation_status = 'nayax_not_configured'
                then 'Ask an admin to complete the mapped machine Nayax setup, then use Refresh transaction results.'
              else item.case_json #>> '{nayaxLookupSummary,recommendedAction}'
            end,
            'automatic', true,
            'evidenceVersion', refund_case.deterministic_fact_version
          )
      )
      order by item.case_order
    ),
    '[]'::jsonb
  ) into enriched_cases
  from jsonb_array_elements(coalesce(base_result -> 'cases', '[]'::jsonb))
    with ordinality as item(case_json, case_order)
  join public.refund_cases refund_case
    on refund_case.id = (item.case_json ->> 'id')::uuid
  left join lateral (
    select action.status
    from public.refund_automation_actions action
    where action.refund_case_id = refund_case.id
      and action.action_type = 'nayax_lookup'
      and action.action_key =
        'nayax_lookup:' || refund_case.id::text || ':v' ||
        refund_case.deterministic_fact_version::text
    order by action.created_at desc
    limit 1
  ) current_lookup on true;

  return jsonb_set(base_result, '{cases}', enriched_cases, true);
end;
$$;

comment on function public.admin_get_refund_operations_overview() is
  'Scoped Refund Operations overview with current evidence-version automatic Nayax lookup state.';

revoke execute on function public.admin_get_refund_operations_overview() from public, anon;
grant execute on function public.admin_get_refund_operations_overview()
  to authenticated, service_role;
