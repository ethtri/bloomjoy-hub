-- A refund case is the durable work item for its read-only transaction lookup.
-- Completed evidence remains reviewable; a short-lived worker queue is not a
-- second source of truth for whether the lookup happened.

update public.refund_nayax_lookup_candidates
set expires_at = '9999-12-31 23:59:59.999999+00'::timestamptz
where expires_at < '9999-01-01 00:00:00+00'::timestamptz
  and evidence_summary ->> 'source' is distinct from 'manual_nayax_portal';

comment on column public.refund_nayax_lookup_candidates.expires_at is
  'Compatibility boundary for candidate readers. Automatic read-only lookup evidence is durable (year 9999); selection is authorized separately against current case facts.';

create index if not exists refund_cases_nayax_lookup_due_idx
  on public.refund_cases (
    nayax_lookup_status,
    nayax_lookup_finished_at,
    created_at,
    id
  )
  where payment_method = 'card'
    and decision is null
    and status in ('submitted','needs_review','correlated')
    and nayax_lookup_status in ('not_started','lookup_failed','lookup_timed_out');

create or replace function public.service_claim_due_refund_nayax_lookups(
  p_limit integer default 10
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  candidate_id uuid;
  case_row public.refund_cases%rowtype;
  begin_result jsonb;
  claims jsonb := '[]'::jsonb;
begin
  if p_limit is null or p_limit not between 1 and 25 then
    raise exception 'Lookup claim limit must be between 1 and 25'
      using errcode = '22023';
  end if;

  perform public.service_recover_stale_refund_nayax_lookups();

  for candidate_id in
    select c.id
    from public.refund_cases c
    where c.payment_method = 'card'
      and c.status in ('submitted','needs_review','correlated')
      and c.decision is null
      and (
        c.nayax_lookup_status = 'not_started'
        or (
          c.nayax_lookup_status in ('lookup_failed','lookup_timed_out')
          and c.nayax_lookup_safe_retry_eligible
          and c.nayax_lookup_retry_count < 1
          and c.nayax_lookup_finished_at <= statement_timestamp() - interval '2 minutes'
        )
      )
      and c.reporting_location_id is not null
      and (c.reporting_machine_id is not null or (
        c.intake_selection_kind = 'livermore_pair'
        and c.intake_selection_key is not null
        and coalesce(array_length(c.intake_selection_machine_ids, 1), 0) = 2
      ))
      and c.incident_at is not null
      and c.incident_time_resolution is not null
      and c.payment_amount_cents > 0
      and (c.card_wallet_used or c.card_last4 ~ '^[0-9]{4}$')
      and c.matched_nayax_transaction_id is null
      and c.nayax_refund_execution_status = 'not_requested'
      and c.refund_completed_at is null
      and c.reporting_adjustment_id is null
      and c.manual_refund_reference is null
      and c.duplicate_of_refund_case_id is null
      and not public.refund_case_has_unresolved_reconciliation(c.id)
      and not exists (
        select 1 from public.refund_authoritative_receipts receipt
        where receipt.refund_case_id = c.id
      )
      and not exists (
        select 1 from public.refund_case_nayax_refund_attempts attempt
        where attempt.refund_case_id = c.id
      )
    order by
      case when c.nayax_lookup_status = 'not_started'
        then coalesce(c.deterministic_facts_updated_at,c.created_at)
        else c.nayax_lookup_finished_at + interval '2 minutes'
      end,
      c.created_at,
      c.id
    limit p_limit
  loop
    -- service_begin uses the same advisory key. Taking it before the row lock
    -- keeps sweep claims and deliberate operations checks in one lock order.
    if not pg_catalog.pg_try_advisory_xact_lock(pg_catalog.hashtextextended(
      'refund-nayax-lookup-v1|' || candidate_id::text, 0
    )) then
      continue;
    end if;
    case_row := null;
    select c.* into case_row from public.refund_cases c
    where c.id = candidate_id
      and (
        c.nayax_lookup_status = 'not_started'
        or (
          c.nayax_lookup_status in ('lookup_failed','lookup_timed_out')
          and c.nayax_lookup_safe_retry_eligible
          and c.nayax_lookup_retry_count < 1
          and c.nayax_lookup_finished_at <= statement_timestamp() - interval '2 minutes'
        )
      )
    for update of c skip locked;
    if not found then
      continue;
    end if;
    begin_result := public.service_begin_refund_nayax_lookup(
      case_row.id,
      case_row.deterministic_fact_version,
      'scheduled',
      null
    );
    if begin_result ->> 'status' = 'checking' then
      claims := claims || jsonb_build_array(jsonb_build_object(
        'caseId', case_row.id,
        'factVersion', case_row.deterministic_fact_version,
        'lookupGeneration', (begin_result ->> 'lookupGeneration')::bigint,
        'retryCount', case when coalesce((begin_result ->> 'safeRetryConsumed')::boolean,false)
          then case_row.nayax_lookup_retry_count + 1
          else case_row.nayax_lookup_retry_count end,
        'payloadRedacted', true
      ));
    end if;
  end loop;
  return claims;
end;
$$;

revoke all on function public.service_claim_due_refund_nayax_lookups(integer)
  from public, anon, authenticated;
grant execute on function public.service_claim_due_refund_nayax_lookups(integer)
  to service_role;

comment on function public.service_claim_due_refund_nayax_lookups(integer) is
  'Claims due read-only lookup work directly from refund_cases. One initial check and one classified-safe automatic retry are allowed; this function grants no payment authority.';

create or replace function public.service_bind_refund_nayax_candidate_to_actor(
  p_actor_user_id uuid,
  p_case_id uuid,
  p_candidate_token uuid
)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  case_row public.refund_cases%rowtype;
  candidate_row public.refund_nayax_lookup_candidates%rowtype;
begin
  if p_actor_user_id is null or p_case_id is null or p_candidate_token is null then
    return false;
  end if;
  select c.* into case_row from public.refund_cases c
  where c.id = p_case_id for update;
  if not found or public.can_manage_refund_case(p_actor_user_id,p_case_id) is distinct from true
    or case_row.decision is not null
    or case_row.nayax_lookup_status not in ('match_found','multiple_matches','manual_exception')
    or case_row.nayax_refund_execution_status <> 'not_requested'
    or case_row.refund_completed_at is not null then
    return false;
  end if;
  select candidate.* into candidate_row
  from public.refund_nayax_lookup_candidates candidate
  where candidate.token = p_candidate_token
    and candidate.refund_case_id = p_case_id
  for update;
  if not found
    or candidate_row.lookup_generation <> case_row.nayax_lookup_generation
    or candidate_row.expires_at <= statement_timestamp()
    or candidate_row.evidence_summary ->> 'source' = 'manual_nayax_portal'
    or (candidate_row.evidence_summary ->> 'customer_fact_version')::bigint
      is distinct from case_row.deterministic_fact_version then
    return false;
  end if;
  update public.refund_nayax_lookup_candidates
  set actor_user_id = p_actor_user_id
  where token = p_candidate_token;
  return true;
exception when invalid_text_representation or numeric_value_out_of_range then
  return false;
end;
$$;

revoke all on function public.service_bind_refund_nayax_candidate_to_actor(uuid,uuid,uuid)
  from public, anon, authenticated;
grant execute on function public.service_bind_refund_nayax_candidate_to_actor(uuid,uuid,uuid)
  to service_role;

comment on function public.service_bind_refund_nayax_candidate_to_actor(uuid,uuid,uuid) is
  'Binds durable server-generated evidence to the active manager review session only after current case, generation, fact-version, and payment-safety checks.';

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
begin
  if public.is_super_admin(p_actor_user_id) is distinct from true then
    raise exception 'Refund Operations access required' using errcode='42501';
  end if;
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(
    'refund-nayax-lookup-v1|' || p_refund_case_id::text, 0
  ));
  select c.* into case_row from public.refund_cases c
  where c.id=p_refund_case_id for update;
  if not found
    or case_row.deterministic_fact_version is distinct from p_expected_fact_version
    or case_row.payment_method <> 'card'
    or case_row.status not in ('submitted','needs_review','correlated')
    or case_row.decision is not null
    or case_row.nayax_lookup_status not in ('lookup_failed','lookup_timed_out','response_limited')
    or (case_row.nayax_lookup_retry_count < 1 and case_row.nayax_lookup_safe_retry_eligible)
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
  update public.refund_cases
  set nayax_lookup_safe_retry_eligible=true
  where id=case_row.id;
  return public.service_begin_refund_nayax_lookup(
    case_row.id,case_row.deterministic_fact_version,'manual',p_actor_user_id
  );
end;
$$;

revoke all on function public.service_begin_refund_nayax_operations_lookup(uuid,bigint,uuid)
  from public, anon, authenticated;
grant execute on function public.service_begin_refund_nayax_operations_lookup(uuid,bigint,uuid)
  to service_role;

comment on function public.service_begin_refund_nayax_operations_lookup(uuid,bigint,uuid) is
  'Allows a deliberate read-only Operations check only after automatic work is unsafe or exhausted; it grants no payment authority.';

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
begin
  for item in select value from jsonb_array_elements(coalesce(p_cases,'[]'::jsonb)) loop
    case_row := null;
    work_owner := 'complete';
    next_attempt_at := null;
    diagnostic := null;

    select c.* into case_row
    from public.refund_cases c
    where c.id = nullif(item->>'id','')::uuid;

    if case_row.id is not null then
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
        and case_row.nayax_lookup_status in ('lookup_failed','lookup_timed_out','response_limited') then
        work_owner := 'refund_operations';
      end if;

      item := item || jsonb_build_object('nayaxLookupWork',jsonb_build_object(
        'state', work_owner,
        'automaticRetriesUsed', case_row.nayax_lookup_retry_count,
        'nextAttemptAt', case when work_owner='system' then next_attempt_at else null end,
        'failureClass', case when work_owner='refund_operations'
          then case_row.nayax_lookup_failure_class else null end,
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

      if case_row.nayax_lookup_status = 'no_match' then
        select e.metadata -> 'diagnostics' into diagnostic
        from public.refund_case_events e
        where e.refund_case_id = case_row.id
          and e.event_type = 'nayax_lookup_diagnostics'
          and e.metadata ->> 'lookup_generation' = case_row.nayax_lookup_generation::text
        order by e.created_at desc, e.id desc
        limit 1;
        if coalesce(diagnostic ->> 'historicalCoverage','unknown') = 'unknown' then
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
    end if;

    if not p_has_operations_access then
      item := jsonb_set(item,'{nayaxLookupSummary,safeRetryEligible}','false'::jsonb,true);
    end if;
    projected_cases := projected_cases || jsonb_build_array(item);
  end loop;
  return projected_cases;
end;
$$;

drop function if exists public.service_enqueue_refund_nayax_lookup(uuid,bigint);
drop function if exists public.service_claim_refund_nayax_lookup_recoveries(integer);
drop function if exists public.service_mark_refund_nayax_lookup_recovery_started(uuid,uuid,bigint);
drop function if exists public.service_claim_refund_nayax_lookup_operations_recovery(uuid,bigint,uuid);
drop function if exists public.service_finish_refund_nayax_lookup_recovery(uuid,uuid,bigint,boolean,text);
drop table if exists public.refund_nayax_lookup_recoveries;

comment on function public.refund_project_nayax_lookup_recovery_cases_for_manager(jsonb,boolean) is
  'Projects case-owned lookup work and distinguishes incomplete provider history from a proved no-match.';

select pg_notify('pgrst', 'reload schema');
