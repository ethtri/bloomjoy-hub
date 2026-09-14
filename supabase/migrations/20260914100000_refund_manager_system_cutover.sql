-- Remove the retired Refund Operations role from active manager work. The
-- assigned Machine Manager or a Super-admin makes the decision and performs
-- case research; the System remains the only card-payment executor.

create or replace function public.admin_authorize_refund_official_action(
  p_case_id uuid,p_action text,p_expected_case_version bigint,
  p_target_status text default null,p_target_decision text default null,
  p_assigned_manager_email text default null,p_decision_reason text default null,
  p_internal_note text default null,p_refund_amount_cents integer default null,
  p_manual_refund_reference text default null,p_cash_payout_sent_at timestamptz default null,
  p_cash_payment_confirmed boolean default false,
  p_matched_nayax_candidate_token uuid default null,
  p_nayax_disagreement_reason text default null
) returns jsonb language plpgsql security definer set search_path='' as $$
declare actor_id uuid:=auth.uid(); c public.refund_cases%rowtype;
  authority jsonb; receipt public.refund_case_official_action_authorizations%rowtype;
  action_name text:=lower(btrim(coalesce(p_action,''))); context_hash text;
begin
  if actor_id is null or coalesce((auth.jwt()->>'is_anonymous')::boolean,false) then
    raise exception 'Authenticated manager or Super-admin session required' using errcode='42501';
  end if;
  perform public.assert_refund_official_action_payload_shape(action_name,
    lower(btrim(coalesce(p_target_status,''))),lower(btrim(coalesce(p_target_decision,''))),
    p_assigned_manager_email,p_decision_reason,p_internal_note,p_refund_amount_cents,
    p_manual_refund_reference,p_cash_payout_sent_at,p_cash_payment_confirmed,
    p_matched_nayax_candidate_token,p_nayax_disagreement_reason);
  select * into c from public.refund_cases where id=p_case_id for update;
  if not found then raise exception 'Refund case not found'; end if;
  if c.official_action_version is distinct from p_expected_case_version then
    raise exception 'Refund case changed since review; reload before taking an official action';
  end if;
  if action_name='approve' then
    if c.payment_method='cash'
      and lower(btrim(coalesce(p_target_status,'')))<>'cash_zelle_pending' then
      raise exception 'Cash approval must enter the cash refund pending state' using errcode='P4620';
    elsif c.payment_method='card' then
      raise exception 'Use the Refund action for atomic card approval and queueing' using errcode='P4620';
    elsif c.payment_method not in ('cash','card') then
      raise exception 'This payment method cannot be approved for a refund' using errcode='P4620';
    end if;
  end if;
  authority:=public.refund_official_action_authority(actor_id,c.id);
  if authority is null then
    raise exception 'The current Machine Manager or a Super-admin must make this decision'
      using errcode='42501';
  end if;
  context_hash:=public.refund_official_action_context_hash(action_name,
    p_target_status,p_target_decision,p_assigned_manager_email,p_decision_reason,
    p_internal_note,p_refund_amount_cents,p_manual_refund_reference,
    p_cash_payout_sent_at,p_cash_payment_confirmed,null,p_nayax_disagreement_reason,null);
  insert into public.refund_case_official_action_authorizations(
    refund_case_id,action,actor_user_id,manager_mapping_id,manager_mapping_version,
    authority_kind,super_admin_role_id,expected_case_version,action_context_hash,
    authorization_method,expires_at)
  values(c.id,action_name,actor_id,
    case when authority->>'kind'='machine_manager' then (authority->>'recordId')::uuid end,
    case when authority->>'kind'='machine_manager' then (authority->>'version')::bigint end,
    authority->>'kind',case when authority->>'kind'='super_admin'
      then (authority->>'recordId')::uuid end,c.official_action_version,context_hash,
    'manager_session',statement_timestamp()+interval '90 seconds') returning * into receipt;
  return jsonb_build_object('authorizationId',receipt.id,'action',receipt.action,
    'expectedCaseVersion',receipt.expected_case_version,
    'authorityKind',authority->>'kind','authorityVersion',(authority->>'version')::bigint,
    'expiresAt',receipt.expires_at,'authorizationMethod','manager_session');
end;
$$;
revoke execute on function public.admin_authorize_refund_official_action(
  uuid,text,bigint,text,text,text,text,text,integer,text,timestamptz,boolean,uuid,text
) from public,anon,service_role;
grant execute on function public.admin_authorize_refund_official_action(
  uuid,text,bigint,text,text,text,text,text,integer,text,timestamptz,boolean,uuid,text
) to authenticated;

create or replace function public.service_hold_nayax_refund_attempt_v1(
  p_executor_assertion text,p_attempt_id uuid,p_error_code text
) returns jsonb language plpgsql security definer set search_path='' as $$
declare a public.refund_case_nayax_refund_attempts%rowtype;
  safe_error text:=lower(btrim(coalesce(p_error_code,'')));
begin
  perform public.assert_nayax_provider_executor(p_executor_assertion);
  if safe_error!~'^[a-z0-9][a-z0-9_:-]{2,79}$' then
    safe_error:='system_post_claim_failure';
  end if;
  select * into strict a from public.refund_case_nayax_refund_attempts
    where id=p_attempt_id for update;
  if a.actor_user_id is not null or a.official_action_authorization_id is null then
    raise exception 'Exact System-owned attempt required' using errcode='P4620';
  end if;
  if a.status='succeeded' then
    return jsonb_build_object('held',false,'alreadySettled',true,'attemptId',a.id,
      'payloadRedacted',true);
  end if;
  if a.status in ('manual_review','ambiguous') and a.reconciliation_required then
    return jsonb_build_object('held',true,'alreadyHeld',true,'attemptId',a.id,
      'payloadRedacted',true);
  end if;
  if a.status<>'in_progress' or a.provider_claim_digest is null then
    raise exception 'Claimed System attempt required' using errcode='P4620';
  end if;
  update public.refund_case_nayax_refund_attempts set status='manual_review',
    provider_claim_consumed_at=coalesce(provider_claim_consumed_at,statement_timestamp()),
    provider_outcome='unknown',provider_outcome_recorded_at=statement_timestamp(),
    reconciliation_required=true,error_code=safe_error,
    safe_transport_stage='confirmation_hold',safe_failure_class='provider_unknown',
    completed_at=statement_timestamp(),sanitized_response=jsonb_build_object(
      'provider_outcome','unknown','provider_transport_state','unknown',
      'provider_retry_made',false,'payload_redacted',true) where id=a.id;
  perform pg_catalog.set_config('bloomjoy.nayax_settlement_attempt_id',a.id::text,true);
  update public.refund_cases set nayax_refund_execution_status='ambiguous',
    nayax_match_execution_eligible=false where id=a.refund_case_id;
  insert into public.refund_case_events(refund_case_id,actor_user_id,event_type,message,metadata)
  values(a.refund_case_id,null,'nayax_provider_outcome_recorded',
    'System held this exact attempt for verification; no second provider call was created.',
    jsonb_build_object('attempt_id',a.id,'error_code',safe_error,
      'provider_outcome','unknown','provider_retry_made',false,'payload_redacted',true));
  return jsonb_build_object('held',true,'attemptId',a.id,'providerOutcome','unknown',
    'payloadRedacted',true);
end;
$$;
revoke all on function public.service_hold_nayax_refund_attempt_v1(text,uuid,text)
  from public,anon,authenticated;
grant execute on function public.service_hold_nayax_refund_attempt_v1(text,uuid,text)
  to service_role;

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
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(
    'refund-nayax-lookup-v1|' || p_refund_case_id::text, 0
  ));
  select c.* into case_row from public.refund_cases c
  where c.id=p_refund_case_id for update;

  if not found then
    raise exception 'Refund case not found' using errcode='P4622';
  end if;
  if not public.can_manage_refund_case(p_actor_user_id,case_row.id) then
    raise exception 'Current Machine Manager or Super-admin access required'
      using errcode='42501';
  end if;

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

  if case_row.deterministic_fact_version is distinct from p_expected_fact_version
    or case_row.payment_method <> 'card'
    or case_row.status not in ('submitted','needs_review','correlated')
    or case_row.decision is not null
    or (
      case_row.nayax_lookup_status not in (
        'lookup_failed','lookup_timed_out','response_limited','setup_needed'
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
    raise exception 'This case is not ready for another read-only transaction check'
      using errcode='P4622';
  end if;

  if case_row.nayax_lookup_status in (
      'lookup_failed','lookup_timed_out','response_limited'
    ) or incomplete_history then
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
  'Allows the current Machine Manager or Super-admin to request one deliberate read-only transaction check after automatic checks are complete. It grants no payment authority.';

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
  manager_action text;
  next_attempt_at timestamptz;
  diagnostic jsonb;
  incomplete_history boolean;
begin
  for item in select value from jsonb_array_elements(coalesce(p_cases,'[]'::jsonb)) loop
    case_row := null;
    work_owner := 'complete';
    manager_action := null;
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
        and case_row.nayax_lookup_status='setup_needed' then
        work_owner := 'machine_manager';
        manager_action := 'repair_nayax_lookup_setup';
      elsif case_row.payment_method = 'card'
        and case_row.status in ('submitted','needs_review','correlated')
        and case_row.decision is null
        and case_row.nayax_refund_execution_status = 'not_requested'
        and case_row.refund_completed_at is null
        and case_row.matched_nayax_transaction_id is null
        and incomplete_history then
        work_owner := 'machine_manager';
        manager_action := 'retry_read_only_lookup';
      elsif case_row.payment_method = 'card'
        and case_row.status in ('submitted','needs_review','correlated')
        and case_row.decision is null
        and case_row.nayax_refund_execution_status = 'not_requested'
        and case_row.refund_completed_at is null
        and case_row.nayax_lookup_status in ('lookup_failed','lookup_timed_out','response_limited') then
        work_owner := 'machine_manager';
        manager_action := 'retry_read_only_lookup';
      end if;

      item := item || jsonb_build_object('nayaxLookupWork',jsonb_build_object(
        'state', work_owner,
        'automaticRetriesUsed', case_row.nayax_lookup_retry_count,
        'nextAttemptAt', case when work_owner='system' then next_attempt_at else null end,
        'failureClass', case when work_owner='machine_manager'
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
      elsif work_owner = 'machine_manager' then
        item := jsonb_set(jsonb_set(jsonb_set(jsonb_set(jsonb_set(jsonb_set(jsonb_set(jsonb_set(jsonb_set(item,
          '{lifecycle,managerAction,action}',to_jsonb(manager_action),true),
          '{lifecycle,managerAction,owner}','"Machine Manager"'::jsonb,true),
          '{lifecycle,managerAction,safeRetryEligible}','false'::jsonb,true),
          '{lifecycle,managerQueue,label}','"Needs manager review"'::jsonb,true),
          '{lifecycle,managerQueue,nextAction}',to_jsonb(manager_action),true),
          '{lifecycle,managerQueue,safeRetryEligible}','false'::jsonb,true),
          '{lifecycle,operations,required}','true'::jsonb,true),
          '{lifecycle,operations,queue}','"System"'::jsonb,true),
          '{lifecycle,operations,owner}','"System"'::jsonb,true);
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
            'summary','Nayax did not provide enough transaction history to confirm a match.'
          ),true);
        item := jsonb_set(jsonb_set(item,'{lifecycle,lookup,status}','"inconclusive"'::jsonb,true),
          '{lifecycle,lookup,reasonCode}','"lookup_coverage_unknown"'::jsonb,true);
      end if;
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
  'Projects read-only transaction work to the System or current Machine Manager without granting payment authority.';

select pg_notify('pgrst','reload schema');
