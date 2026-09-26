-- Keep the Manager-facing lookup projection aligned with current payment and System ownership.
-- A stale case status cannot reopen a paid/unknown-effect transaction lookup.
CREATE OR REPLACE FUNCTION public.refund_project_nayax_lookup_recovery_cases_for_manager(p_cases jsonb, p_has_operations_access boolean)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  projected_cases jsonb := '[]'::jsonb;
  item jsonb;
  case_row public.refund_cases%rowtype;
  work_owner text;
  next_attempt_at timestamptz;
  diagnostic jsonb;
  incomplete_history boolean;
  payment_effect_exists boolean;
  lookup_scope_failure text;
begin
  for item in select value from jsonb_array_elements(coalesce(p_cases,'[]'::jsonb)) loop
    case_row := null;
    work_owner := 'complete';
    next_attempt_at := null;
    diagnostic := null;
    incomplete_history := false;
    payment_effect_exists := false;
    lookup_scope_failure := null;

    select c.* into case_row
    from public.refund_cases c
    where c.id = nullif(item->>'id','')::uuid;

    if case_row.id is not null then
      -- Existing effects outrank a stale case status during read-only projection.
      payment_effect_exists :=
        coalesce((item -> 'lifecycle' ->> 'paymentWorkComplete')::boolean,false)
        or exists (select 1 from public.refund_authoritative_receipts receipt where receipt.refund_case_id=case_row.id)
        or exists (select 1 from public.refund_case_nayax_refund_attempts attempt where attempt.refund_case_id=case_row.id);
      lookup_scope_failure := case
        when case_row.duplicate_of_refund_case_id is not null then 'duplicate_case_pending'
        when case_row.reporting_machine_id is not null and exists (
          select 1 from public.reporting_machines machine
          where machine.id = case_row.reporting_machine_id
            and machine.location_id is distinct from case_row.reporting_location_id
        ) then 'reported_machine_location_mismatch'
        else null end;
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

      if not payment_effect_exists
        and lookup_scope_failure is null
        and case_row.payment_method = 'card'
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
      elsif not payment_effect_exists and lookup_scope_failure is null and case_row.payment_method = 'card'
        and case_row.status in ('submitted','needs_review','correlated')
        and case_row.decision is null
        and case_row.nayax_refund_execution_status = 'not_requested'
        and case_row.refund_completed_at is null
        and case_row.nayax_lookup_status = 'checking' then
        work_owner := 'system';
      elsif not payment_effect_exists and lookup_scope_failure is null and case_row.payment_method = 'card'
        and case_row.status in ('submitted','needs_review','correlated')
        and case_row.decision is null
        and case_row.nayax_refund_execution_status = 'not_requested'
        and case_row.refund_completed_at is null
        and case_row.nayax_lookup_status in ('lookup_failed','lookup_timed_out')
        and case_row.nayax_lookup_safe_retry_eligible
        and case_row.nayax_lookup_retry_count < 1 then
        work_owner := 'system';
        next_attempt_at := case_row.nayax_lookup_finished_at + interval '2 minutes';
      elsif not payment_effect_exists and case_row.payment_method = 'card'
        and case_row.status in ('submitted','needs_review','correlated')
        and case_row.decision is null
        and case_row.nayax_refund_execution_status = 'not_requested'
        and case_row.refund_completed_at is null
        and case_row.matched_nayax_transaction_id is null
        and case_row.nayax_lookup_status='setup_needed' then
        work_owner := 'refund_operations';
      elsif not payment_effect_exists and case_row.payment_method = 'card'
        and case_row.status in ('submitted','needs_review','correlated')
        and case_row.decision is null
        and case_row.nayax_refund_execution_status = 'not_requested'
        and case_row.refund_completed_at is null
        and case_row.matched_nayax_transaction_id is null
        and incomplete_history then
        work_owner := 'refund_operations';
      elsif not payment_effect_exists and case_row.payment_method = 'card'
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
            lookup_scope_failure,
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
            'summary','Nayax did not provide enough transaction history to confirm a match.'
          ),true);
        -- Keep compatibility summary separate from canonical lifecycle.
      end if;
    end if;

    projected_cases := projected_cases || jsonb_build_array(item);
  end loop;
  return projected_cases;
end;
$function$
revoke all on function public.refund_project_nayax_lookup_recovery_cases_for_manager(jsonb,boolean) from public,anon,authenticated,service_role;
grant execute on function public.refund_project_nayax_lookup_recovery_cases_for_manager(jsonb,boolean) to service_role;
comment on function public.refund_project_nayax_lookup_recovery_cases_for_manager(jsonb,boolean) is
  'Projects case-owned read-only lookup work without assigning purchase research to a Manager or reopening an existing payment effect.';
