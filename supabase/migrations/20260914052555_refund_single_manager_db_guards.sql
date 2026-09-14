-- Forward-only hardening for the single-manager/System-owned Nayax refund flow.
-- The original gate migration may already be present in migration history, so
-- every runtime correction is repeated here rather than relying on an edit to
-- 20260913090000.

create or replace function public.service_commit_refund_nayax_lookup_and_preselect_v1(
  p_refund_case_id uuid,p_lookup_generation bigint,p_expected_fact_version bigint,
  p_lookup_status text,p_recommendation_state text,p_policy_version text,
  p_last_checked_at timestamptz,p_summary text,p_resolved_machine_id uuid,
  p_candidate_count integer,p_trigger_source text,p_actor_user_id uuid,p_diagnostics jsonb
) returns jsonb language plpgsql security definer set search_path='' as $$
declare result jsonb; c public.refund_cases%rowtype;
  candidate public.refund_nayax_lookup_candidates%rowtype; qualifying_count integer;
  candidate_token uuid; evidence_hash text; lookup_event_actor uuid;
begin
  lookup_event_actor:=case when p_trigger_source in
      ('automatic','manual','wallet_correction','scheduled')
      and p_lookup_status='match_found' and p_recommendation_state='high_confidence'
    then null else p_actor_user_id end;
  result:=public.service_commit_refund_nayax_lookup_with_diagnostics(
    p_refund_case_id,p_lookup_generation,p_expected_fact_version,p_lookup_status,
    p_recommendation_state,p_policy_version,p_last_checked_at,p_summary,
    p_resolved_machine_id,p_candidate_count,p_trigger_source,lookup_event_actor,p_diagnostics);
  if result->>'applied' is distinct from 'true'
    or p_trigger_source not in ('automatic','manual','wallet_correction','scheduled')
    or p_lookup_status<>'match_found' or p_recommendation_state<>'high_confidence' then
    return result||jsonb_build_object('systemPreselectionApplied',false);
  end if;
  select * into strict c from public.refund_cases where id=p_refund_case_id for update;
  if c.nayax_lookup_generation<>p_lookup_generation
    or c.deterministic_fact_version<>p_expected_fact_version
    or c.nayax_recommendation_state<>'high_confidence'
    or c.payment_method<>'card' or c.status not in ('submitted','needs_review','correlated')
    or c.decision is not null or c.nayax_refund_execution_status<>'not_requested'
    or c.reporting_adjustment_id is not null or c.refund_completed_at is not null
    or c.duplicate_of_refund_case_id is not null
    or public.refund_case_has_unresolved_reconciliation(c.id)
    or exists(select 1 from public.refund_authoritative_receipts r where r.refund_case_id=c.id)
    or exists(select 1 from public.refund_case_nayax_refund_attempts a where a.refund_case_id=c.id)
    or exists(select 1 from public.refund_case_official_action_authorizations z
      where z.refund_case_id=c.id and z.status in ('pending','consumed')) then
    raise exception 'Clear match changed before System selection' using errcode='P4620';
  end if;
  select count(*),(array_agg(k.token order by k.created_at,k.token))[1]
    into qualifying_count,candidate_token
  from public.refund_nayax_lookup_candidates k
  where k.refund_case_id=c.id and k.lookup_generation=p_lookup_generation
    and k.expires_at>statement_timestamp()
    and k.actor_user_id is not distinct from p_actor_user_id
    and coalesce(k.evidence_summary->>'source','')<>'manual_nayax_portal'
    and k.evidence_summary->>'recommendation_state'='high_confidence'
    and k.evidence_summary->>'is_recommended'='true'
    and k.evidence_summary->>'selection_allowed'='true'
    and k.evidence_summary->>'one_click_eligible'='true'
    and k.evidence_summary->>'customer_fact_version'=p_expected_fact_version::text
    and public.refund_nayax_candidate_identifier_evidence_state(k.refund_case_id,
      k.reporting_machine_id,k.site_id,k.machine_authorization_time,k.amount_cents,
      k.card_last4,k.currency_code,k.evidence_summary)='valid';
  if qualifying_count<>1 then
    raise exception 'Exactly one current clear Nayax match is required' using errcode='P4620';
  end if;
  select * into strict candidate from public.refund_nayax_lookup_candidates
    where token=candidate_token for share;
  if candidate.reporting_machine_id is null or candidate.site_id is null
    or candidate.amount_cents<=0 or candidate.currency_code<>'USD'
    or not public.is_review_safe_nayax_transaction_reference(candidate.provider_transaction_id)
    or exists(select 1 from public.refund_cases other
      where other.id<>c.id and other.matched_nayax_transaction_id=candidate.provider_transaction_id)
    or exists(select 1 from public.refund_nayax_transaction_allocations allocation
      where allocation.original_transaction_id=candidate.provider_transaction_id
        and allocation.allocation_state in ('reserved','refunded')) then
    raise exception 'Clear Nayax match is no longer selectable' using errcode='P4620';
  end if;

  -- The lookup initiator did not choose the transaction. Reissue this immutable
  -- provider candidate under the same opaque token as System-owned evidence;
  -- ambiguous candidates remain actor-bound for deliberate human selection.
  if candidate.actor_user_id is not null then
    delete from public.refund_nayax_lookup_candidates where token=candidate.token;
    insert into public.refund_nayax_lookup_candidates(
      token,refund_case_id,actor_user_id,provider_transaction_id,site_id,
      machine_authorization_time,amount_cents,card_last4,currency_code,
      evidence_summary,expires_at,created_at,reporting_machine_id,lookup_generation)
    values(candidate.token,candidate.refund_case_id,null,candidate.provider_transaction_id,
      candidate.site_id,candidate.machine_authorization_time,candidate.amount_cents,
      candidate.card_last4,candidate.currency_code,candidate.evidence_summary,
      candidate.expires_at,candidate.created_at,candidate.reporting_machine_id,
      candidate.lookup_generation)
    returning * into candidate;
  end if;

  evidence_hash:=public.refund_nayax_candidate_evidence_hash(candidate.refund_case_id,
    candidate.actor_user_id,candidate.provider_transaction_id,candidate.site_id,
    candidate.machine_authorization_time,candidate.amount_cents,candidate.card_last4,
    candidate.currency_code,candidate.evidence_summary,candidate.expires_at,candidate.created_at);
  update public.refund_cases set reporting_machine_id=candidate.reporting_machine_id,
    status='needs_review',refund_amount_cents=candidate.amount_cents,
    matched_nayax_transaction_id=candidate.provider_transaction_id,
    matched_nayax_site_id=candidate.site_id,
    matched_nayax_machine_auth_time=candidate.machine_authorization_time,
    matched_nayax_amount_cents=candidate.amount_cents,
    matched_nayax_card_last4=candidate.card_last4,
    matched_nayax_currency_code=candidate.currency_code,
    correlation_status='matched',correlation_source='nayax',correlation_confidence=1,
    correlation_summary='System selected the one clear Nayax transaction. A manager must confirm the refund.',
    nayax_recommendation_state='high_confidence',
    nayax_recommendation_policy_version=p_policy_version,
    nayax_recommendation_evaluated_at=statement_timestamp(),
    nayax_match_execution_eligible=true where id=c.id returning * into c;
  insert into public.refund_case_events(refund_case_id,actor_user_id,event_type,message,metadata)
  values(c.id,null,'nayax_match_preselected','System saved the one clear Nayax transaction for manager confirmation.',
    jsonb_strip_nulls(jsonb_build_object('candidate_token',candidate.token,
      'candidate_evidence_hash',evidence_hash,'lookup_generation',p_lookup_generation,
      'deterministic_fact_version',p_expected_fact_version,
      'lookup_initiator_user_id',p_actor_user_id,
      'provider_amount_cents',candidate.amount_cents,'execution_eligible',true,
      'provider_call_made',false,'payload_redacted',true)));
  return result||jsonb_build_object('systemPreselectionApplied',true,
    'selectedCandidateToken',candidate.token,'providerAmountCents',candidate.amount_cents,
    'payloadRedacted',true);
end;
$$;
revoke all on function public.service_commit_refund_nayax_lookup_and_preselect_v1(
  uuid,bigint,bigint,text,text,text,timestamptz,text,uuid,integer,text,uuid,jsonb)
  from public,anon,authenticated,service_role;
grant execute on function public.service_commit_refund_nayax_lookup_and_preselect_v1(
  uuid,bigint,bigint,text,text,text,timestamptz,text,uuid,integer,text,uuid,jsonb)
  to service_role;

-- A successful provider reference may complete one case only. The advisory
-- lock gives concurrent callers the same friendly domain error; the unique
-- index remains the final database boundary.
create unique index if not exists refund_nayax_system_success_one_reference_idx
  on public.refund_nayax_system_success_evidence(
    evidence_type,evidence_reference_digest);

do $success_evidence_precheck$
declare body text; anchor text; replacement text;
begin
  body:=replace(pg_catalog.pg_get_functiondef(
    'public.admin_record_nayax_system_outcome_evidence_v1(uuid,uuid,text,text,text,timestamptz,text,bigint)'::regprocedure),
    E'\r\n',E'\n');
  anchor:=E'  insert into public.refund_nayax_system_success_evidence(refund_case_id,\n';
  replacement:=E'  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(\n'
    ||E'    ''refund-nayax-success-evidence|''||evidence_type||''|''||evidence_digest,0));\n'
    ||E'  if exists(select 1 from public.refund_nayax_system_success_evidence evidence\n'
    ||E'      where evidence.evidence_type=lower(btrim(coalesce(p_evidence_type,'''')))\n'
    ||E'        and evidence.evidence_reference_digest=evidence_digest\n'
    ||E'        and evidence.refund_case_id<>c.id) then\n'
    ||E'    raise exception ''This provider evidence reference already completed another refund case''\n'
    ||E'      using errcode=''P4661'';\n'
    ||E'  end if;\n'
    ||anchor;
  if cardinality(string_to_array(body,anchor))<>2 then
    raise exception 'Unexpected System success evidence insertion shape';
  end if;
  execute replace(body,anchor,replacement);
end;
$success_evidence_precheck$;

-- One private predicate binds every continuation generation to the immutable
-- no-refund proof that advanced that exact attempt/context.
create or replace function public.refund_nayax_current_continuation_proof_matches_v1(
  p_attempt_id uuid
) returns boolean language sql stable security definer set search_path='' as $$
  select coalesce(exists(
    select 1
    from public.refund_case_nayax_refund_attempts attempt
    join public.refund_nayax_execution_contexts saved
      on saved.attempt_id=attempt.id and saved.refund_case_id=attempt.refund_case_id
    join public.refund_nayax_no_refund_proofs proof
      on proof.nayax_refund_attempt_id=attempt.id
      and proof.refund_case_id=attempt.refund_case_id
      and proof.source_execution_generation=attempt.provider_execution_generation-1
      and proof.continuation_execution_generation=attempt.provider_execution_generation
      and proof.execution_plan=attempt.execution_plan
      and proof.frozen_execution_context_hash=saved.context->>'contextHash'
    where attempt.id=p_attempt_id and attempt.actor_user_id is null
      and attempt.provider_execution_generation>1
      and attempt.execution_plan in ('request_and_approve','approve_only')
  ),false);
$$;
revoke all on function public.refund_nayax_current_continuation_proof_matches_v1(uuid)
  from public,anon,authenticated,service_role;

create or replace function public.guard_refund_nayax_provider_generation_plan_v1()
returns trigger language plpgsql security definer set search_path='' as $$
declare attempt public.refund_case_nayax_refund_attempts%rowtype;
begin
  select a.* into attempt from public.refund_case_nayax_refund_attempts a
    where a.id=new.nayax_refund_attempt_id for share;
  if not found then raise exception 'Exact Nayax attempt required' using errcode='P4620'; end if;

  -- Historical actor-owned rows are immutable evidence, not the current queue.
  if attempt.actor_user_id is not null then return new; end if;
  if new.provider_execution_generation<>attempt.provider_execution_generation
    or (attempt.provider_execution_generation=1
      and attempt.execution_plan<>'request_and_approve')
    or (attempt.provider_execution_generation>1
      and not public.refund_nayax_current_continuation_proof_matches_v1(attempt.id)) then
    raise exception 'Exact proof-bound provider execution generation required'
      using errcode='P4620';
  end if;
  if attempt.execution_plan='approve_only' and new.stage='request' then
    raise exception 'Approval-only continuation cannot create a new refund request'
      using errcode='P4620';
  end if;
  if new.stage='approve' and new.event='started' then
    if attempt.execution_plan='request_and_approve' and not exists(select 1
        from public.refund_nayax_provider_stage_journal journal
        where journal.nayax_refund_attempt_id=attempt.id
          and journal.pending_approval_recovery_id is null
          and journal.provider_execution_generation=attempt.provider_execution_generation
          and journal.stage='request' and journal.event='result'
          and journal.outcome='accepted' and journal.contract_matched
          and journal.approval_authorized and journal.failure_type is null
          and journal.provider_contract_version=(select saved.context->>'providerContractVersion'
            from public.refund_nayax_execution_contexts saved where saved.attempt_id=attempt.id)
          and journal.journal_contract_version=(select saved.context->>'journalContractVersion'
            from public.refund_nayax_execution_contexts saved where saved.attempt_id=attempt.id)) then
      raise exception 'Current-generation accepted request required before approval'
        using errcode='P4620';
    elsif attempt.execution_plan='approve_only' and not exists(select 1
        from public.refund_nayax_provider_stage_journal journal
        where journal.nayax_refund_attempt_id=attempt.id
          and journal.pending_approval_recovery_id is null
          and journal.provider_execution_generation<attempt.provider_execution_generation
          and journal.stage='request' and journal.event='result'
          and journal.outcome='accepted' and journal.contract_matched
          and journal.approval_authorized and journal.failure_type is null
          and journal.provider_contract_version=(select saved.context->>'providerContractVersion'
            from public.refund_nayax_execution_contexts saved where saved.attempt_id=attempt.id)
          and journal.journal_contract_version=(select saved.context->>'journalContractVersion'
            from public.refund_nayax_execution_contexts saved where saved.attempt_id=attempt.id)) then
      raise exception 'Proof-bound prior accepted request required before approval-only continuation'
        using errcode='P4620';
    end if;
  end if;
  return new;
end;
$$;
revoke all on function public.guard_refund_nayax_provider_generation_plan_v1()
  from public,anon,authenticated,service_role;
drop trigger if exists aab_refund_nayax_provider_generation_plan_v1
  on public.refund_nayax_provider_stage_journal;
create trigger aab_refund_nayax_provider_generation_plan_v1
before insert on public.refund_nayax_provider_stage_journal for each row
execute function public.guard_refund_nayax_provider_generation_plan_v1();

create or replace function public.service_claim_due_nayax_refund_attempts_v1(
  p_executor_assertion text,p_account_key text,p_serialization_mode text,
  p_refund_email_list_mode text,p_limit integer default 1
) returns jsonb language plpgsql security definer set search_path='' as $$
declare a public.refund_case_nayax_refund_attempts%rowtype; token text; claims jsonb:='[]'::jsonb;
begin
  perform public.assert_nayax_provider_executor(p_executor_assertion);
  if p_limit not between 1 and 5 or p_serialization_mode<>'exact_source'
    or p_refund_email_list_mode<>'empty_string' then
    raise exception 'Supported queue claim configuration required' using errcode='P4620';
  end if;
  for a in select attempt.* from public.refund_case_nayax_refund_attempts attempt
    join public.refund_case_official_action_authorizations z
      on z.id=attempt.official_action_authorization_id
    join public.refund_nayax_execution_contexts saved on saved.attempt_id=attempt.id
    join public.refund_cases c on c.id=attempt.refund_case_id
    where attempt.actor_user_id is null and attempt.status='created'
      and z.action='approve' and z.status='consumed' and z.consumed_at is not null
      and z.authorization_method='manager_session'
      and saved.context->>'accountScope'=p_account_key
      and saved.context->>'machineAuthorizationTimeSerializationMode'=p_serialization_mode
      and saved.context->>'refundEmailListMode'=p_refund_email_list_mode
      and c.status='card_refund_pending' and c.decision='approved'
      and c.reporting_adjustment_id is null
      and ((attempt.provider_execution_generation=1
          and attempt.execution_plan='request_and_approve')
        or (attempt.provider_execution_generation>1
          and public.refund_nayax_current_continuation_proof_matches_v1(attempt.id)))
    order by attempt.created_at,attempt.id for update of attempt skip locked limit p_limit
  loop
    token:=encode(extensions.gen_random_bytes(32),'hex');
    update public.refund_case_nayax_refund_attempts set status='in_progress',
      provider_claim_digest=encode(extensions.digest(convert_to(token,'UTF8'),'sha256'),'hex'),
      provider_claim_expires_at=statement_timestamp()+interval '15 minutes'
      where id=a.id;
    perform pg_catalog.set_config('bloomjoy.nayax_settlement_attempt_id',a.id::text,true);
    update public.refund_cases set nayax_refund_execution_status='requested'
      where id=a.refund_case_id and nayax_refund_execution_status='not_requested';
    claims:=claims||jsonb_build_array(public.refund_nayax_attempt_claim_payload_v1(a.id,token));
  end loop;
  return jsonb_build_object('schemaVersion','nayax-refund-attempt-queue-v1',
    'claims',claims,'payloadRedacted',true);
end;
$$;
revoke all on function public.service_claim_due_nayax_refund_attempts_v1(
  text,text,text,text,integer) from public,anon,authenticated,service_role;
grant execute on function public.service_claim_due_nayax_refund_attempts_v1(
  text,text,text,text,integer) to service_role;

-- These historical external/manual recovery RPCs remain non-executable even
-- when this forward migration is applied independently of the original gate.
revoke all on function public.admin_get_refund_external_recovery_options(uuid)
  from public,anon,authenticated,service_role;
revoke all on function public.admin_reconcile_external_refund_and_notice(uuid,jsonb)
  from public,anon,authenticated,service_role;

select pg_notify('pgrst','reload schema');
