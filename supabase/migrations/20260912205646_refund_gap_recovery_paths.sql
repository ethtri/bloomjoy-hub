-- Close three observed refund-workflow gaps without adding payment or message
-- authority. Incomplete provider history gets one deliberate read-only API
-- refresh for the current fact version; the existing portal remains fallback.

create or replace function public.service_begin_refund_nayax_operations_lookup(
  p_refund_case_id uuid,
  p_expected_fact_version bigint,
  p_actor_user_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  case_row public.refund_cases%rowtype;
  incomplete_history boolean := false;
  result jsonb;
begin
  if public.is_super_admin(p_actor_user_id) is distinct from true then
    raise exception 'Authorized manager access required' using errcode='42501';
  end if;
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(
    'refund-nayax-lookup-v1|' || p_refund_case_id::text, 0
  ));
  select c.* into case_row from public.refund_cases c
  where c.id=p_refund_case_id for update;

  if found then
    incomplete_history := case_row.nayax_lookup_status = 'inconclusive'
      or (
        case_row.nayax_lookup_status = 'no_match'
        and exists (
          select 1
          from public.refund_case_events event
          where event.refund_case_id = case_row.id
            and event.event_type = 'nayax_lookup_diagnostics'
            and event.metadata ->> 'lookup_generation' =
              case_row.nayax_lookup_generation::text
            and coalesce(
              event.metadata -> 'diagnostics' ->> 'historicalCoverage',
              'unknown'
            ) = 'unknown'
        )
      );
  end if;

  if case_row.id is null
    or case_row.deterministic_fact_version is distinct from p_expected_fact_version
    or case_row.payment_method <> 'card'
    or case_row.status not in ('submitted','needs_review','correlated')
    or case_row.decision is not null
    or (
      case_row.nayax_lookup_status not in (
        'lookup_failed','lookup_timed_out','response_limited'
      )
      and not incomplete_history
    )
    or (
      case_row.nayax_lookup_status in (
        'lookup_failed','lookup_timed_out','response_limited'
      )
      and case_row.nayax_lookup_retry_count < 1
      and case_row.nayax_lookup_safe_retry_eligible
    )
    or (
      incomplete_history
      and case_row.nayax_lookup_retry_fact_version = p_expected_fact_version
      and case_row.nayax_lookup_retry_count >= 1
    )
    or case_row.nayax_refund_execution_status <> 'not_requested'
    or case_row.refund_completed_at is not null
    or case_row.matched_nayax_transaction_id is not null
    or exists(select 1 from public.refund_authoritative_receipts receipt
      where receipt.refund_case_id=case_row.id)
    or exists(select 1 from public.refund_case_nayax_refund_attempts attempt
      where attempt.refund_case_id=case_row.id) then
    raise exception 'Automatic transaction checks must be exhausted first'
      using errcode='P4622';
  end if;

  if not incomplete_history then
    update public.refund_cases
    set nayax_lookup_safe_retry_eligible=true
    where id=case_row.id;
  end if;

  result := public.service_begin_refund_nayax_lookup(
    case_row.id,case_row.deterministic_fact_version,'manual',p_actor_user_id
  );

  if incomplete_history and result ->> 'status' = 'checking' then
    update public.refund_cases
    set
      nayax_lookup_retry_count = case
        when nayax_lookup_retry_fact_version = p_expected_fact_version
          then least(nayax_lookup_retry_count::integer + 1, 32767)::smallint
        else 1
      end,
      nayax_lookup_retry_fact_version = p_expected_fact_version
    where id = case_row.id;
    result := result || jsonb_build_object('safeRetryConsumed', true);
  end if;

  return result || jsonb_build_object('payloadRedacted', true);
end;
$$;

revoke all on function public.service_begin_refund_nayax_operations_lookup(
  uuid,bigint,uuid
) from public, anon, authenticated;
grant execute on function public.service_begin_refund_nayax_operations_lookup(
  uuid,bigint,uuid
) to service_role;

comment on function public.service_begin_refund_nayax_operations_lookup(
  uuid,bigint,uuid
) is
  'Allows one deliberate read-only Operations refresh for incomplete provider history, or a deliberate check after automatic failure recovery is exhausted. It grants no payment authority.';

create or replace function public.refund_project_nayax_lookup_recovery_cases_for_manager(
  p_cases jsonb,
  p_has_operations_access boolean
)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  projected_cases jsonb := '[]'::jsonb;
  item jsonb;
  case_row public.refund_cases%rowtype;
  work_owner text;
  next_attempt_at timestamptz;
  diagnostic jsonb;
  incomplete_history boolean;
begin
  for item in select value from jsonb_array_elements(coalesce(p_cases,'[]'::jsonb)) loop
    case_row := null;
    work_owner := 'complete';
    next_attempt_at := null;
    diagnostic := null;
    incomplete_history := false;

    select c.* into case_row
    from public.refund_cases c
    where c.id = nullif(item->>'id','')::uuid;

    if case_row.id is not null then
      if case_row.nayax_lookup_status = 'no_match' then
        select e.metadata -> 'diagnostics' into diagnostic
        from public.refund_case_events e
        where e.refund_case_id = case_row.id
          and e.event_type = 'nayax_lookup_diagnostics'
          and e.metadata ->> 'lookup_generation' =
            case_row.nayax_lookup_generation::text
        order by e.created_at desc, e.id desc
        limit 1;
      end if;
      incomplete_history := case_row.nayax_lookup_status = 'inconclusive'
        or (
          case_row.nayax_lookup_status = 'no_match'
          and coalesce(diagnostic ->> 'historicalCoverage','unknown') = 'unknown'
        );

      if case_row.payment_method = 'card'
        and case_row.status in ('submitted','needs_review','correlated')
        and case_row.decision is null
        and case_row.nayax_refund_execution_status = 'not_requested'
        and case_row.refund_completed_at is null
        and case_row.nayax_lookup_status = 'not_started'
        and case_row.reporting_location_id is not null
        and (case_row.reporting_machine_id is not null or (
          case_row.intake_selection_kind = 'livermore_pair'
          and case_row.intake_selection_key is not null
          and coalesce(array_length(case_row.intake_selection_machine_ids,1),0)=2
        ))
        and case_row.incident_at is not null
        and case_row.incident_time_resolution is not null
        and case_row.payment_amount_cents > 0
        and (case_row.card_wallet_used or case_row.card_last4 ~ '^[0-9]{4}$') then
        work_owner := 'system';
        next_attempt_at := coalesce(case_row.deterministic_facts_updated_at,case_row.created_at);
      elsif case_row.payment_method = 'card'
        and case_row.status in ('submitted','needs_review','correlated')
        and case_row.decision is null
        and case_row.nayax_refund_execution_status = 'not_requested'
        and case_row.refund_completed_at is null
        and case_row.nayax_lookup_status = 'checking' then
        work_owner := 'system';
      elsif case_row.payment_method = 'card'
        and case_row.status in ('submitted','needs_review','correlated')
        and case_row.decision is null
        and case_row.nayax_refund_execution_status = 'not_requested'
        and case_row.refund_completed_at is null
        and case_row.nayax_lookup_status in ('lookup_failed','lookup_timed_out')
        and case_row.nayax_lookup_safe_retry_eligible
        and case_row.nayax_lookup_retry_count < 1 then
        work_owner := 'system';
        next_attempt_at := case_row.nayax_lookup_finished_at + interval '2 minutes';
      elsif case_row.payment_method = 'card'
        and case_row.status in ('submitted','needs_review','correlated')
        and case_row.decision is null
        and case_row.nayax_refund_execution_status = 'not_requested'
        and case_row.refund_completed_at is null
        and case_row.matched_nayax_transaction_id is null
        and incomplete_history then
        work_owner := 'refund_operations';
      elsif case_row.payment_method = 'card'
        and case_row.status in ('submitted','needs_review','correlated')
        and case_row.decision is null
        and case_row.nayax_refund_execution_status = 'not_requested'
        and case_row.refund_completed_at is null
        and case_row.nayax_lookup_status in ('lookup_failed','lookup_timed_out','response_limited') then
        work_owner := 'refund_operations';
      end if;

      item := item || jsonb_build_object('nayaxLookupWork',jsonb_build_object(
        'state', work_owner,
        'automaticRetriesUsed', case_row.nayax_lookup_retry_count,
        'nextAttemptAt', case when work_owner='system' then next_attempt_at else null end,
        'failureClass', case when work_owner='refund_operations'
          then coalesce(
            case_row.nayax_lookup_failure_class,
            case when incomplete_history then 'incomplete_history' else null end
          ) else null end,
        'payloadRedacted', true
      ));

      if work_owner = 'system' then
        item := jsonb_set(item,'{canSelectNayaxCandidate}','false'::jsonb,true);
        item := jsonb_set(jsonb_set(jsonb_set(jsonb_set(jsonb_set(item,
          '{lifecycle,managerAction,action}','"none"'::jsonb,true),
          '{lifecycle,managerAction,owner}','"System"'::jsonb,true),
          '{lifecycle,managerAction,safeRetryEligible}','false'::jsonb,true),
          '{lifecycle,managerQueue,nextAction}','"observe_automatic_lookup"'::jsonb,true),
          '{lifecycle,managerQueue,safeRetryEligible}','false'::jsonb,true);
        item := jsonb_set(jsonb_set(item,'{lifecycle,lookup,status}','"checking"'::jsonb,true),
          '{lifecycle,lookup,safeRetryEligible}','false'::jsonb,true);
        item := jsonb_set(jsonb_set(item,'{nayaxLookupSummary,lookupStatus}','"checking"'::jsonb,true),
          '{nayaxLookupSummary,safeRetryEligible}','false'::jsonb,true);
      elsif work_owner = 'refund_operations' then
        item := jsonb_set(jsonb_set(jsonb_set(jsonb_set(jsonb_set(jsonb_set(jsonb_set(item,
          '{lifecycle,managerAction,action}','"refund_operations"'::jsonb,true),
          '{lifecycle,managerAction,owner}','"Refund Operations"'::jsonb,true),
          '{lifecycle,managerAction,safeRetryEligible}','false'::jsonb,true),
          '{lifecycle,managerQueue,nextAction}','"refund_operations"'::jsonb,true),
          '{lifecycle,managerQueue,safeRetryEligible}','false'::jsonb,true),
          '{lifecycle,operations,required}','true'::jsonb,true),
          '{lifecycle,operations,owner}','"Refund Operations"'::jsonb,true);
        item := jsonb_set(item,'{lifecycle,lookup,safeRetryEligible}','false'::jsonb,true);
      end if;

      if case_row.nayax_lookup_status = 'no_match'
        and incomplete_history then
        item := jsonb_set(item,'{nayaxLookupSummary}',
          coalesce(item->'nayaxLookupSummary','{}'::jsonb) || jsonb_build_object(
            'lookupStatus','inconclusive',
            'historicalCoverage','unknown',
            'providerRecordCount',diagnostic->'providerRecordCount',
            'providerParseableRecordCount',diagnostic->'providerParseableRecordCount',
            'providerWindowRecordCount',diagnostic->'providerWindowRecordCount',
            'summary','Nayax did not provide enough historical coverage to confirm whether a matching transaction exists.'
          ),true);
        item := jsonb_set(jsonb_set(item,'{lifecycle,lookup,status}','"inconclusive"'::jsonb,true),
          '{lifecycle,lookup,reasonCode}','"lookup_coverage_unknown"'::jsonb,true);
      end if;
    end if;

    if not p_has_operations_access then
      item := jsonb_set(item,'{nayaxLookupSummary,safeRetryEligible}','false'::jsonb,true);
    end if;
    projected_cases := projected_cases || jsonb_build_array(item);
  end loop;
  return projected_cases;
end;
$$;

revoke all on function public.refund_project_nayax_lookup_recovery_cases_for_manager(
  jsonb,boolean
) from public, anon, authenticated, service_role;
grant execute on function public.refund_project_nayax_lookup_recovery_cases_for_manager(
  jsonb,boolean
) to service_role;

comment on function public.refund_project_nayax_lookup_recovery_cases_for_manager(
  jsonb,boolean
) is
  'Projects case-owned lookup work, exposes one Operations refresh for incomplete provider history, and preserves Refund Operations as the internal owner.';

select pg_notify('pgrst', 'reload schema');
