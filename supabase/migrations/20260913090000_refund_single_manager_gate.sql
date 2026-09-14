-- #1341: one manager confirmation creates one System-owned Nayax attempt.
-- The existing attempt row is the queue, immutable execution context, provider
-- journal binding, settlement record, and duplicate-prevention boundary.

alter table public.refund_case_official_action_authorizations
  add column if not exists authority_kind text not null default 'machine_manager',
  add column if not exists super_admin_role_id uuid
    references public.admin_roles(id) on delete restrict,
  add column if not exists selected_nayax_candidate_token uuid
    references public.refund_nayax_lookup_candidates(token) on delete restrict,
  add column if not exists selected_nayax_candidate_evidence_hash text,
  alter column manager_mapping_id drop not null,
  alter column manager_mapping_version drop not null;

alter table public.refund_case_official_action_authorizations
  drop constraint if exists refund_official_action_authority_shape_check,
  add constraint refund_official_action_authority_shape_check check (
    (authority_kind='machine_manager' and manager_mapping_id is not null
      and manager_mapping_version>0 and super_admin_role_id is null)
    or (authority_kind='super_admin' and manager_mapping_id is null
      and manager_mapping_version is null and super_admin_role_id is not null)
  ),
  drop constraint if exists refund_official_action_selected_nayax_evidence_shape_check,
  add constraint refund_official_action_selected_nayax_evidence_shape_check check (
    (selected_nayax_candidate_token is null
      and selected_nayax_candidate_evidence_hash is null)
    or (action='approve' and selected_nayax_candidate_token is not null
      and selected_nayax_candidate_evidence_hash~'^[a-f0-9]{64}$')
  );

create or replace function public.refund_official_action_authority(
  p_user_id uuid,p_refund_case_id uuid
) returns jsonb language plpgsql stable security definer set search_path='' as $$
declare machine_id uuid; authority_id uuid; authority_version bigint;
begin
  if p_user_id is null or p_refund_case_id is null then return null; end if;
  select reporting_machine_id into machine_id from public.refund_cases
    where id=p_refund_case_id;
  if machine_id is null then return null; end if;
  select id,1 into authority_id,authority_version from public.admin_roles
    where user_id=p_user_id and role='super_admin' and active
    order by granted_at desc,id limit 1;
  if found then return jsonb_build_object('kind','super_admin',
    'recordId',authority_id,'version',authority_version,'machineId',machine_id);
  end if;
  select id,mapping_version into authority_id,authority_version
    from public.reporting_machine_refund_managers
    where reporting_machine_id=machine_id and manager_user_id=p_user_id
      and status='active' and revoked_at is null
    order by mapping_version desc,id limit 1;
  if not found then return null; end if;
  return jsonb_build_object('kind','machine_manager','recordId',authority_id,
    'version',authority_version,'machineId',machine_id);
end;
$$;
revoke all on function public.refund_official_action_authority(uuid,uuid)
  from public,anon,authenticated,service_role;

create or replace function public.can_perform_refund_official_action(
  p_user_id uuid,p_refund_case_id uuid
) returns boolean language sql stable security definer set search_path='' as $$
  select public.refund_official_action_authority(p_user_id,p_refund_case_id) is not null
    and exists(select 1 from public.refund_cases c where c.id=p_refund_case_id
      and c.duplicate_of_refund_case_id is null
      and not public.refund_case_has_unresolved_reconciliation(c.id)
      and not exists(select 1 from public.refund_authoritative_receipts r
        where r.refund_case_id=c.id));
$$;
revoke execute on function public.can_perform_refund_official_action(uuid,uuid)
  from public,anon,authenticated;
grant execute on function public.can_perform_refund_official_action(uuid,uuid)
  to service_role;

-- Selecting exact evidence is case work, not financial authorization. Replace
-- the inherited manager-only check, then expose only an auth.uid()-bound RPC.
do $selection_permission$
declare body text; old_text text; new_text text;
begin
  body:=replace(pg_get_functiondef(
    'public.service_select_refund_nayax_candidate_as_actor_pre_lookup_generation_v1(uuid,uuid,bigint,uuid,text)'::regprocedure),E'\r\n',E'\n');
  old_text:=E'  if refund_case.reporting_machine_id is null then\n'
    ||E'    if not public.can_manage_refund_case(p_actor_user_id, refund_case.id) then\n'
    ||E'      raise exception ''Complete active manager authority over the grouped selection is required''\n'
    ||E'        using errcode = ''P4603'';\n'
    ||E'    end if;\n'
    ||E'  elsif not public.refund_case_user_has_active_manager_mapping(\n'
    ||E'    p_actor_user_id,\n'
    ||E'    refund_case.id\n'
    ||E'  ) then\n'
    ||E'    raise exception ''Active Machine Manager mapping required; admin identities are review-only''\n'
    ||E'      using errcode = ''P4603'';\n'
    ||E'  end if;\n';
  new_text:=E'  if not public.can_manage_refund_case(p_actor_user_id, refund_case.id) then\n'
    ||E'    raise exception ''Current refund case access required'' using errcode = ''P4603'';\n'
    ||E'  end if;\n';
  if cardinality(string_to_array(body,old_text))<>2 then
    raise exception 'Unexpected candidate selection permission shape';
  end if;
  execute replace(body,old_text,new_text);
end;
$selection_permission$;

revoke all on function public.service_select_refund_nayax_candidate_as_actor(
  uuid,uuid,bigint,uuid,text) from public,anon,authenticated,service_role;

create or replace function public.admin_select_refund_nayax_candidate_current_user_v1(
  p_case_id uuid,p_expected_case_version bigint,p_candidate_token uuid,
  p_nayax_disagreement_reason text default null
) returns jsonb language plpgsql security definer set search_path='' as $$
declare actor_id uuid:=auth.uid(); candidate_source text;
begin
  if actor_id is null or coalesce((auth.jwt()->>'is_anonymous')::boolean,false) then
    raise exception 'Authenticated refund case access required' using errcode='42501';
  end if;
  if not public.can_manage_refund_case_current_user(p_case_id) then
    raise exception 'Current refund case access required' using errcode='42501';
  end if;
  select coalesce(candidate.evidence_summary->>'source','') into candidate_source
  from public.refund_nayax_lookup_candidates candidate
  where candidate.token=p_candidate_token and candidate.refund_case_id=p_case_id;
  if not found then
    raise exception 'Nayax lookup evidence expired or belongs to another review session'
      using errcode='P4602';
  end if;
  if candidate_source='manual_nayax_portal' then
    raise exception 'Manual Nayax candidates are historical and cannot be selected'
      using errcode='P4626';
  end if;
  return public.service_select_refund_nayax_candidate_as_actor(
    actor_id,p_case_id,p_expected_case_version,p_candidate_token,
    p_nayax_disagreement_reason);
end;
$$;
revoke all on function public.admin_select_refund_nayax_candidate_current_user_v1(
  uuid,bigint,uuid,text) from public,anon,service_role;
grant execute on function public.admin_select_refund_nayax_candidate_current_user_v1(
  uuid,bigint,uuid,text) to authenticated;

-- Cash and decline actions keep the ordinary manager-session receipt. Card
-- approval is atomic in admin_approve_selected_nayax_refund_for_system_v1.
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
  if action_name='approve' and c.payment_method='card' then
    raise exception 'Use the Refund action for atomic card approval and queueing' using errcode='P4620';
  end if;
  authority:=public.refund_official_action_authority(actor_id,c.id);
  if authority is null then
    raise exception 'An active assigned manager or Super-admin is required for this machine'
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

alter table public.refund_case_nayax_refund_attempts
  drop constraint if exists refund_nayax_attempt_bound_lifecycle_check,
  add constraint refund_nayax_attempt_bound_lifecycle_check check (
    official_action_authorization_id is null or (
      request_fingerprint is not null
      and ((actor_user_id is null and step_up_intent_id is null
          and execution_mode='request_and_approve')
        or (actor_user_id is not null and step_up_intent_id is not null))
      and ((status='created' and provider_claim_digest is null
          and provider_claim_expires_at is null and provider_claim_consumed_at is null)
        or (status<>'created' and provider_claim_digest is not null
          and provider_claim_expires_at is not null))
      and ((provider_outcome is null and provider_outcome_recorded_at is null)
        or (provider_outcome is not null and provider_outcome_recorded_at is not null))
      and (provider_outcome='success' or reporting_adjustment_id is null)
      and (case_finalization_committed_at is null
        or (provider_outcome='success' and reporting_adjustment_id is not null
          and status='succeeded'))
    )
  );

create unique index if not exists refund_nayax_one_queued_attempt_per_case_idx
  on public.refund_case_nayax_refund_attempts(refund_case_id)
  where actor_user_id is null and status in ('created','in_progress','ambiguous','manual_review','succeeded');

create or replace function public.admin_approve_selected_nayax_refund_for_system_v1(
  p_case_id uuid,p_expected_case_version bigint
) returns jsonb language plpgsql security definer set search_path='' as $$
declare actor_id uuid:=auth.uid(); c public.refund_cases%rowtype;
  selected public.refund_nayax_lookup_candidates%rowtype; machine public.reporting_machines%rowtype;
  authority jsonb; approval public.refund_case_official_action_authorizations%rowtype;
  candidate_hash text; action_hash text; frozen jsonb; frozen_hash text;
  attempt public.refund_case_nayax_refund_attempts%rowtype; idempotency text;
begin
  if actor_id is null or coalesce((auth.jwt()->>'is_anonymous')::boolean,false) then
    raise exception 'Authenticated manager or Super-admin session required' using errcode='42501';
  end if;
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(
    'refund-card-approval|'||p_case_id::text,0));
  select * into c from public.refund_cases where id=p_case_id for update;
  if not found then raise exception 'Refund case not found'; end if;
  authority:=public.refund_official_action_authority(actor_id,c.id);
  if authority is null then raise exception
    'Only the assigned machine Manager or a Super-admin can approve this refund'
    using errcode='42501'; end if;
  if c.official_action_version is distinct from p_expected_case_version then
    raise exception 'Refund case changed since review; reload before approving the refund';
  end if;
  if c.payment_method<>'card' or c.status not in ('needs_review','correlated')
    or c.decision is not null or c.correlation_status<>'matched'
    or c.correlation_source<>'nayax' or c.nayax_refund_execution_status<>'not_requested'
    or c.reporting_adjustment_id is not null or c.refund_completed_at is not null
    or c.duplicate_of_refund_case_id is not null
    or public.refund_case_has_unresolved_reconciliation(c.id) then
    raise exception 'This case is not ready for a new card refund approval' using errcode='P4620';
  end if;
  select * into machine from public.reporting_machines where id=c.reporting_machine_id for share;
  if machine.id is null or machine.status<>'active' or not machine.nayax_refunds_enabled
    or nullif(btrim(machine.nayax_machine_id),'') is null
    or nullif(btrim(machine.nayax_account_key),'') is null then
    raise exception 'Nayax refund configuration is unavailable' using errcode='P4620';
  end if;
  select * into selected from public.refund_nayax_lookup_candidates k
    where k.refund_case_id=c.id and k.lookup_generation=c.nayax_lookup_generation
      and k.reporting_machine_id=c.reporting_machine_id
      and k.provider_transaction_id is not distinct from c.matched_nayax_transaction_id
      and k.site_id is not distinct from c.matched_nayax_site_id
      and k.machine_authorization_time is not distinct from c.matched_nayax_machine_auth_time
      and k.amount_cents is not distinct from c.matched_nayax_amount_cents
      and k.card_last4 is not distinct from c.matched_nayax_card_last4
      and k.currency_code is not distinct from c.matched_nayax_currency_code
      and coalesce(k.evidence_summary->>'source','')<>'manual_nayax_portal'
      and k.evidence_summary->>'selection_allowed'='true'
      and public.refund_nayax_candidate_identifier_evidence_state(k.refund_case_id,
        k.reporting_machine_id,k.site_id,k.machine_authorization_time,k.amount_cents,
        k.card_last4,k.currency_code,k.evidence_summary)='valid'
    order by k.created_at desc,k.token desc limit 1 for share;
  if not found or selected.amount_cents<=0 or selected.currency_code<>'USD' then
    raise exception 'The saved transaction evidence changed; refresh it before approving'
      using errcode='P4620';
  end if;
  candidate_hash:=public.refund_nayax_candidate_evidence_hash(selected.refund_case_id,
    selected.actor_user_id,selected.provider_transaction_id,selected.site_id,
    selected.machine_authorization_time,selected.amount_cents,selected.card_last4,
    selected.currency_code,selected.evidence_summary,selected.expires_at,selected.created_at);
  action_hash:=public.refund_official_action_context_hash('approve','card_refund_pending',
    'approved',null,'customer_owed',null,selected.amount_cents,null,null,false,
    selected.token,null,candidate_hash);
  insert into public.refund_case_official_action_authorizations(
    refund_case_id,action,actor_user_id,manager_mapping_id,manager_mapping_version,
    authority_kind,super_admin_role_id,expected_case_version,action_context_hash,
    authorization_method,expires_at,status,consumed_at,
    selected_nayax_candidate_token,selected_nayax_candidate_evidence_hash)
  values(c.id,'approve',actor_id,
    case when authority->>'kind'='machine_manager' then (authority->>'recordId')::uuid end,
    case when authority->>'kind'='machine_manager' then (authority->>'version')::bigint end,
    authority->>'kind',case when authority->>'kind'='super_admin'
      then (authority->>'recordId')::uuid end,c.official_action_version,action_hash,
    'manager_session',statement_timestamp()+interval '90 seconds','consumed',
    statement_timestamp(),selected.token,candidate_hash) returning * into approval;
  update public.refund_cases set status='card_refund_pending',decision='approved',
    decision_reason='customer_owed',decided_by=actor_id,decided_at=statement_timestamp(),
    refund_amount_cents=selected.amount_cents,nayax_match_execution_eligible=false,
    correlation_summary='Manager approved the saved exact Nayax transaction for System execution.'
    where id=c.id returning * into c;
  frozen:=public.refund_nayax_selected_execution_context_v3(c.id,'exact_source','empty_string');
  if frozen is null or (frozen->>'caseVersion')::bigint is distinct from c.official_action_version
    or frozen->>'transactionId' is distinct from selected.provider_transaction_id
    or (frozen->>'originalAmountCents')::integer is distinct from selected.amount_cents then
    raise exception 'Approval did not preserve the exact selected refund' using errcode='P4620';
  end if;
  frozen:=(frozen-'contextHash')||jsonb_build_object(
    'providerContractVersion','nayax-production-account-contract-v2',
    'journalContractVersion','nayax-provider-journal-v3');
  frozen_hash:=encode(extensions.digest(convert_to(frozen::text,'UTF8'),'sha256'),'hex');
  frozen:=frozen||jsonb_build_object('contextHash',frozen_hash);
  idempotency:='nayax-refund-'||encode(extensions.digest(convert_to(
    approval.id::text||'|'||c.id::text||'|'||frozen_hash,'UTF8'),'sha256'),'hex');
  insert into public.refund_case_nayax_refund_attempts(
    refund_case_id,actor_user_id,execution_mode,status,idempotency_key,amount_cents,
    transaction_id_present,site_id_present,machine_auth_time_present,
    sanitized_request,sanitized_response,official_action_authorization_id,
    step_up_intent_id,request_fingerprint,currency_code,reconciliation_required)
  values(c.id,null,'request_and_approve','created',idempotency,selected.amount_cents,
    true,true,true,jsonb_build_object('amount_cents',selected.amount_cents,
      'currency_code','USD','payload_redacted',true),'{}'::jsonb,approval.id,null,
    encode(extensions.digest(convert_to(idempotency||'|'||frozen_hash,'UTF8'),'sha256'),'hex'),
    'USD',false) returning * into attempt;
  insert into public.refund_nayax_execution_contexts(attempt_id,refund_case_id,context)
    values(attempt.id,c.id,frozen);
  perform public.refund_claim_exact_nayax_transaction(c.id,attempt.id,frozen);
  insert into public.refund_case_events(refund_case_id,actor_user_id,event_type,message,metadata)
  values(c.id,actor_id,'nayax_refund_queued',
    'The manager approved this exact refund for System execution.',
    jsonb_build_object('attempt_id',attempt.id,'authorization_id',approval.id,
      'authority_kind',authority->>'kind','payload_redacted',true));
  return jsonb_build_object('approved',true,'status','system_finishing',
    'refundCaseId',c.id,'authorizationId',approval.id,'attemptId',attempt.id,
    'caseVersion',c.official_action_version,'providerCallMade',false,
    'customerMessageCreated',false,'payloadRedacted',true);
end;
$$;
revoke all on function public.admin_approve_selected_nayax_refund_for_system_v1(uuid,bigint)
  from public,anon,service_role;
grant execute on function public.admin_approve_selected_nayax_refund_for_system_v1(uuid,bigint)
  to authenticated;

create or replace function public.refund_nayax_attempt_claim_payload_v1(
  p_attempt_id uuid,p_provider_claim_token text
) returns jsonb language plpgsql stable security definer set search_path='' as $$
declare a public.refund_case_nayax_refund_attempts%rowtype;
  z public.refund_case_official_action_authorizations%rowtype; x jsonb;
begin
  select * into strict a from public.refund_case_nayax_refund_attempts where id=p_attempt_id;
  select * into strict z from public.refund_case_official_action_authorizations
    where id=a.official_action_authorization_id;
  select context into strict x from public.refund_nayax_execution_contexts
    where attempt_id=a.id and refund_case_id=a.refund_case_id;
  return jsonb_build_object('attemptId',a.id,
    'authorization',jsonb_build_object(
      'authorityType','manager_approval','authorizationId',z.id,
      'caseId',a.refund_case_id,'authorityKind',z.authority_kind),
    'attempt',jsonb_build_object('attemptId',a.id,'shouldExecute',true),
    'providerClaimToken',p_provider_claim_token,
    'providerWireContext',jsonb_build_object('caseId',a.refund_case_id,
      'caseVersion',(x->>'caseVersion')::bigint,
      'attemptGeneration',(x->>'attemptGeneration')::integer,
      'idempotencyKey',a.idempotency_key,
      'providerContractVersion',x->>'providerContractVersion',
      'journalContractVersion',x->>'journalContractVersion',
      'executionContextHash',x->>'contextHash',
      'accountScopeDigest',encode(extensions.digest(convert_to(
        x->>'accountScope','UTF8'),'sha256'),'hex'),
      'providerMachineId',x->>'providerMachineId','transactionId',x->>'transactionId',
      'siteId',(x->>'siteId')::integer,
      'machineAuthorizationTime',x->>'machineAuthorizationTime',
      'machineAuthorizationTimeInstant',x->>'machineAuthorizationTimeInstant',
      'machineAuthorizationTimeWire',x->>'machineAuthorizationTimeWire',
      'machineAuthorizationTimeSerializationMode',
        x->>'machineAuthorizationTimeSerializationMode',
      'refundEmailListMode',x->>'refundEmailListMode',
      'originalAmountCents',(x->>'originalAmountCents')::integer,
      'currencyCode',x->>'currencyCode'),'payloadRedacted',true);
end;
$$;
revoke all on function public.refund_nayax_attempt_claim_payload_v1(uuid,text)
  from public,anon,authenticated,service_role;

create or replace function public.service_get_nayax_refund_provider_journal_capability_v3(
  p_executor_assertion text
) returns jsonb language plpgsql stable security definer set search_path='' as $$
begin
  perform public.assert_nayax_provider_executor(p_executor_assertion);
  return jsonb_build_object(
    'journalContractVersion','nayax-provider-journal-v3',
    'approvalPolicyVersion','db-authoritative-exact-200-json-v1',
    'responseEnvelopeVersion','nayax-response-envelope-v1',
    'businessOutcomeRecordVersion','nayax-business-outcome-v2',
    'supportedProviderContractVersions',jsonb_build_array(
      'nayax-production-account-contract-v2'),
    'providerContractConfirmationRequired',true,'payloadRedacted',true);
end;
$$;
revoke all on function public.service_get_nayax_refund_provider_journal_capability_v3(text)
  from public,anon,authenticated;
grant execute on function public.service_get_nayax_refund_provider_journal_capability_v3(text)
  to service_role;

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
  text,text,text,text,integer) from public,anon,authenticated;
grant execute on function public.service_claim_due_nayax_refund_attempts_v1(
  text,text,text,text,integer) to service_role;

create or replace function public.service_reclaim_nayax_refund_attempt_no_call_v1(
  p_executor_assertion text,p_account_key text
) returns jsonb language plpgsql security definer set search_path='' as $$
declare a public.refund_case_nayax_refund_attempts%rowtype; transport_started boolean;
begin
  perform public.assert_nayax_provider_executor(p_executor_assertion);
  select attempt.* into a from public.refund_case_nayax_refund_attempts attempt
    join public.refund_nayax_execution_contexts saved on saved.attempt_id=attempt.id
    where attempt.actor_user_id is null and attempt.status='in_progress'
      and attempt.provider_outcome is null
      and attempt.provider_claim_consumed_at is null
      and attempt.provider_claim_expires_at<=statement_timestamp()
      and saved.context->>'accountScope'=p_account_key
    order by attempt.provider_claim_expires_at,attempt.id for update of attempt skip locked limit 1;
  if not found then return jsonb_build_object('reclaimed',false,'payloadRedacted',true); end if;
  select exists(select 1 from public.refund_nayax_provider_stage_journal j
    where j.nayax_refund_attempt_id=a.id and j.event='started') into transport_started;
  if transport_started then
    update public.refund_case_nayax_refund_attempts set status='manual_review',
      provider_claim_consumed_at=statement_timestamp(),provider_outcome='unknown',
      provider_outcome_recorded_at=statement_timestamp(),reconciliation_required=true,
      error_code='claim_expired_after_transport',safe_transport_stage='confirmation_hold',
      safe_failure_class='interrupted_after_transport',completed_at=statement_timestamp(),
      sanitized_response=jsonb_build_object('provider_outcome','unknown',
        'provider_call_made',true,'provider_retry_made',false,'payload_redacted',true)
      where id=a.id;
    perform pg_catalog.set_config('bloomjoy.nayax_settlement_attempt_id',a.id::text,true);
    update public.refund_cases set nayax_refund_execution_status='ambiguous',
      nayax_match_execution_eligible=false where id=a.refund_case_id;
    insert into public.refund_case_events(refund_case_id,actor_user_id,event_type,message,metadata)
    values(a.refund_case_id,null,'nayax_provider_outcome_recorded',
      'The expired provider-started attempt is on permanent hold; no retry was created.',
      jsonb_build_object('attempt_id',a.id,'provider_outcome','unknown',
        'provider_retry_made',false,'payload_redacted',true));
    return jsonb_build_object('reclaimed',false,'held',true,'attemptId',a.id,
      'providerOutcome','unknown','payloadRedacted',true);
  end if;
  update public.refund_case_nayax_refund_attempts set status='created',
    provider_claim_digest=null,provider_claim_expires_at=null,
    safe_transport_stage='reserved',safe_failure_class=null where id=a.id;
  perform pg_catalog.set_config('bloomjoy.nayax_settlement_attempt_id',a.id::text,true);
  update public.refund_cases set nayax_refund_execution_status='not_requested'
    where id=a.refund_case_id and nayax_refund_execution_status='requested';
  return jsonb_build_object('reclaimed',true,'attemptId',a.id,'payloadRedacted',true);
end;
$$;
revoke all on function public.service_reclaim_nayax_refund_attempt_no_call_v1(text,text)
  from public,anon,authenticated;
grant execute on function public.service_reclaim_nayax_refund_attempt_no_call_v1(text,text)
  to service_role;

-- Any failure after a claim has been issued can terminate only that exact row.
-- This is deliberately service-only and idempotent so a malformed claim or a
-- lost settlement response can never cause another provider request.
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
    safe_transport_stage='confirmation_hold',safe_failure_class='system_post_claim_failure',
    completed_at=statement_timestamp(),sanitized_response=jsonb_build_object(
      'provider_outcome','unknown','provider_transport_state','unknown',
      'provider_retry_made',false,'payload_redacted',true) where id=a.id;
  perform pg_catalog.set_config('bloomjoy.nayax_settlement_attempt_id',a.id::text,true);
  update public.refund_cases set nayax_refund_execution_status='ambiguous',
    nayax_match_execution_eligible=false where id=a.refund_case_id;
  insert into public.refund_case_events(refund_case_id,actor_user_id,event_type,message,metadata)
  values(a.refund_case_id,null,'nayax_provider_outcome_recorded',
    'System placed this exact attempt on permanent hold; no provider retry was created.',
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

-- Storage guards predate System-owned attempts. Authorize only the exact case
-- transition belonging to the claimed queue row; no current manager session is
-- consulted after approval. The no-call branch only releases the same row.
create or replace function public.refund_system_attempt_case_change_allowed_v1(
  p_old jsonb,p_new jsonb
) returns boolean language sql stable security definer set search_path='' as $$
  select coalesce(exists(
    select 1
    from public.refund_case_nayax_refund_attempts attempt
    join public.refund_case_official_action_authorizations approval
      on approval.id=attempt.official_action_authorization_id
    where attempt.id=nullif(current_setting(
        'bloomjoy.nayax_settlement_attempt_id',true),'')::uuid
      and attempt.refund_case_id=(p_old->>'id')::uuid
      and attempt.actor_user_id is null and attempt.step_up_intent_id is null
      and approval.action='approve' and approval.status='consumed'
      and approval.authorization_method='manager_session'
      and p_old->>'status'='card_refund_pending'
      and p_old->>'decision'='approved'
      and (
        (attempt.status='created' and attempt.provider_claim_digest is null
          and not exists(select 1 from public.refund_nayax_provider_stage_journal journal
            where journal.nayax_refund_attempt_id=attempt.id and journal.event='started')
          and p_new->>'status'='card_refund_pending'
          and p_new->>'decision'='approved'
          and p_new->>'nayax_refund_execution_status'='not_requested')
        or
        (attempt.status='in_progress'
          and attempt.provider_claim_consumed_at is null
          and attempt.provider_claim_expires_at>statement_timestamp()
          and attempt.provider_claim_digest=encode(extensions.digest(convert_to(
            nullif(current_setting('bloomjoy.nayax_settlement_provider_claim',true),''),
            'UTF8'),'sha256'),'hex')
          and (
            (p_new->>'status'='completed' and p_new->>'decision'='approved'
              and p_new->>'nayax_refund_execution_status'='approved')
            or
            (p_new->>'status'='card_refund_pending' and p_new->>'decision'='approved'
              and p_new->>'nayax_refund_execution_status'='ambiguous')
          ))
        or
        (attempt.status='manual_review' and attempt.provider_outcome='unknown'
          and attempt.reconciliation_required
          and p_new->>'status'='card_refund_pending'
          and p_new->>'decision'='approved'
          and p_new->>'nayax_refund_execution_status'='ambiguous')
      )
  ),false);
$$;
revoke all on function public.refund_system_attempt_case_change_allowed_v1(jsonb,jsonb)
  from public,anon,authenticated,service_role;

do $migration$
declare body text; anchor text; replacement text;
begin
  body:=replace(pg_get_functiondef(
    'public.guard_refund_case_active_nayax_attempt()'::regprocedure),E'\r\n',E'\n');
  anchor:=E'begin\n  if public.refund_journal_duplicate_recovery_case_change_allowed';
  replacement:=E'begin\n  if public.refund_system_attempt_case_change_allowed_v1(to_jsonb(old),to_jsonb(new)) then return new; end if;\n'
    ||E'  if public.refund_journal_duplicate_recovery_case_change_allowed';
  if cardinality(string_to_array(body,anchor))<>2 then
    raise exception 'Unexpected active Nayax attempt guard shape';
  end if;
  execute replace(body,anchor,replacement);

  body:=replace(pg_get_functiondef(
    'public.guard_refund_provider_hold_case_update()'::regprocedure),E'\r\n',E'\n');
  anchor:=E'begin\n  if public.refund_journal_duplicate_recovery_case_change_allowed';
  replacement:=E'begin\n  if public.refund_system_attempt_case_change_allowed_v1(to_jsonb(old),to_jsonb(new)) then return new; end if;\n'
    ||E'  if public.refund_journal_duplicate_recovery_case_change_allowed';
  if cardinality(string_to_array(body,anchor))<>2 then
    raise exception 'Unexpected provider hold case guard shape';
  end if;
  execute replace(body,anchor,replacement);
end;
$migration$;

create or replace function public.guard_refund_nayax_execution_context_stage()
returns trigger language plpgsql security definer set search_path='' as $$
declare attempt public.refund_case_nayax_refund_attempts%rowtype;
  c public.refund_cases%rowtype; machine public.reporting_machines%rowtype;
  approval public.refund_case_official_action_authorizations%rowtype; x jsonb;
begin
  select * into strict attempt from public.refund_case_nayax_refund_attempts
    where id=new.nayax_refund_attempt_id;
  select context into x from public.refund_nayax_execution_contexts where attempt_id=attempt.id;
  if x is not null and new.journal_contract_version<>'nayax-provider-journal-v3' then
    raise exception 'Execution context requires the current provider journal contract' using errcode='P4620';
  end if;
  if new.event<>'started' or new.journal_contract_version<>'nayax-provider-journal-v3' then
    return new;
  end if;
  select * into strict c from public.refund_cases where id=attempt.refund_case_id for share;
  select * into strict machine from public.reporting_machines where id=c.reporting_machine_id for share;
  select * into strict approval from public.refund_case_official_action_authorizations
    where id=attempt.official_action_authorization_id for share;
  if attempt.actor_user_id is not null or attempt.step_up_intent_id is not null
    or approval.action<>'approve' or approval.status<>'consumed'
    or approval.authorization_method<>'manager_session'
    or x->>'caseId'<>c.id::text or x->>'reportingMachineId'<>machine.id::text
    or x->>'accountScope'<>machine.nayax_account_key
    or x->>'providerMachineId'<>machine.nayax_machine_id
    or x->>'transactionId'<>c.matched_nayax_transaction_id
    or (x->>'siteId')::integer is distinct from c.matched_nayax_site_id
    or (x->>'attemptGeneration')::integer<>c.nayax_refund_attempt_generation
    or (x->>'originalAmountCents')::integer<>attempt.amount_cents
    or x->>'currencyCode'<>attempt.currency_code then
    raise exception 'Frozen manager-approved Nayax execution context changed' using errcode='P4620';
  end if;
  return new;
end;
$$;
revoke all on function public.guard_refund_nayax_execution_context_stage()
  from public,anon,authenticated,service_role;

-- Extend the existing terminal proof and receipt writer to the new System
-- ownership shape. The approving human remains recorded_by; no second receipt
-- table or System settlement family is introduced.
do $migration$
declare body text; old_text text; new_text text;
begin
  body:=replace(pg_get_functiondef(
    'public.refund_nayax_api_terminal_evidence_proved(uuid,uuid)'::regprocedure),E'\r\n',E'\n');
  old_text:=E'      and attempt.actor_user_id is not null\n';
  new_text:=E'      and (attempt.actor_user_id is not null or (attempt.actor_user_id is null\n'
    ||E'        and attempt.step_up_intent_id is null and exists(select 1\n'
    ||E'          from public.refund_case_official_action_authorizations approval\n'
    ||E'          where approval.id=attempt.official_action_authorization_id\n'
    ||E'            and approval.action=''approve'' and approval.status=''consumed''\n'
    ||E'            and approval.authorization_method=''manager_session'')))\n';
  if cardinality(string_to_array(body,old_text))<>2 then
    raise exception 'Unexpected terminal API proof shape';
  end if;
  execute replace(body,old_text,new_text);

  body:=replace(pg_get_functiondef(
    'public.refund_ensure_proved_nayax_api_terminal_receipt(uuid,uuid)'::regprocedure),E'\r\n',E'\n');
  old_text:='attempt.actor_user_id';
  new_text:=E'coalesce(attempt.actor_user_id,(select approval.actor_user_id\n'
    ||E'      from public.refund_case_official_action_authorizations approval\n'
    ||E'      where approval.id=attempt.official_action_authorization_id))';
  if cardinality(string_to_array(body,old_text))<>3 then
    raise exception 'Unexpected terminal API receipt actor shape';
  end if;
  execute replace(body,old_text,new_text);
end;
$migration$;

-- Extend the one canonical settlement RPC in place. Historical rows remain
-- readable without preserving a second executable settlement artifact.
create or replace function public.service_settle_nayax_refund_attempt(
  p_executor_assertion text,p_attempt_id uuid,p_authorization_id uuid,p_case_id uuid,
  p_idempotency_key text,p_amount_cents integer,p_currency_code text,
  p_provider_claim_token text,p_provider_outcome text,p_provider_reference text,
  p_provider_status text,p_error_code text
) returns jsonb language plpgsql security definer set search_path='' as $$
declare a public.refund_case_nayax_refund_attempts%rowtype;
  z public.refund_case_official_action_authorizations%rowtype;
  c public.refund_cases%rowtype; x jsonb; adjustment public.sales_adjustment_facts%rowtype;
  outcome text:=lower(btrim(coalesce(p_provider_outcome,'')));
  reference text:=nullif(btrim(coalesce(p_provider_reference,'')),'');
  provider_status text:=nullif(btrim(coalesce(p_provider_status,'')),'');
  error_code text:=nullif(btrim(coalesce(p_error_code,'')),''); settled_at timestamptz:=statement_timestamp();
begin
  perform public.assert_nayax_provider_executor(p_executor_assertion);
  select * into strict c from public.refund_cases where id=p_case_id for update;
  select * into strict a from public.refund_case_nayax_refund_attempts
    where id=p_attempt_id and refund_case_id=p_case_id for update;
  select * into strict z from public.refund_case_official_action_authorizations
    where id=p_authorization_id for share;
  select context into strict x from public.refund_nayax_execution_contexts
    where attempt_id=a.id and refund_case_id=c.id;
  if outcome not in ('success','rejected','timeout','unknown')
    or reference is not null and reference!~'^[A-Za-z0-9][A-Za-z0-9._:-]{5,119}$'
    or provider_status is not null and provider_status!~'^[A-Za-z0-9][A-Za-z0-9._:-]{0,119}$'
    or error_code is not null and error_code!~'^[A-Za-z0-9][A-Za-z0-9._:-]{0,119}$'
    or outcome='success' and (reference is null
      or provider_status is distinct from 'approve_succeeded_contract_match') then
    raise exception 'Safe provider settlement evidence required' using errcode='P4620';
  end if;
  if a.actor_user_id is null and a.official_action_authorization_id=z.id
    and a.idempotency_key=p_idempotency_key and a.amount_cents=p_amount_cents
    and a.currency_code='USD' and upper(btrim(coalesce(p_currency_code,'')))='USD'
    and a.status='succeeded' and a.provider_outcome='success' and outcome='success'
    and a.provider_reference is not distinct from reference then
    return jsonb_build_object('attempt',public.refund_nayax_attempt_snapshot(a.id,false),
      'updateApplied',false,'alreadySettled',true,'reportingAdjustmentPresent',true,
      'safeRetryEligible',false,'definitiveNoRefund',false,'payloadRedacted',true);
  end if;
  if a.actor_user_id is null and a.official_action_authorization_id=z.id
    and a.idempotency_key=p_idempotency_key and a.amount_cents=p_amount_cents
    and a.currency_code='USD' and a.status in ('manual_review','ambiguous')
    and a.reconciliation_required and a.provider_outcome=outcome then
    return jsonb_build_object('attempt',public.refund_nayax_attempt_snapshot(a.id,false),
      'updateApplied',false,'alreadySettled',true,'reportingAdjustmentPresent',false,
      'safeRetryEligible',false,'definitiveNoRefund',false,'payloadRedacted',true);
  end if;
  if a.actor_user_id is not null or a.step_up_intent_id is not null
    or a.official_action_authorization_id is distinct from z.id
    or z.action<>'approve' or z.status<>'consumed' or z.consumed_at is null
    or z.authorization_method<>'manager_session'
    or a.execution_mode<>'request_and_approve' or a.status<>'in_progress'
    or a.idempotency_key<>p_idempotency_key or a.amount_cents<>p_amount_cents
    or a.currency_code<>'USD' or upper(btrim(coalesce(p_currency_code,'')))<>'USD'
    or a.provider_claim_consumed_at is not null
    or a.provider_claim_expires_at<=settled_at
    or a.provider_claim_digest<>encode(extensions.digest(convert_to(
      p_provider_claim_token,'UTF8'),'sha256'),'hex')
    or c.status<>'card_refund_pending' or c.decision<>'approved'
    or c.nayax_refund_execution_status<>'requested'
    or c.refund_amount_cents<>p_amount_cents or c.reporting_adjustment_id is not null
    or x->>'caseId'<>c.id::text or x->>'contextHash' is null then
    raise exception 'Exact queued refund settlement context required' using errcode='P4620';
  end if;
  perform pg_catalog.set_config('bloomjoy.nayax_settlement_attempt_id',a.id::text,true);
  perform pg_catalog.set_config('bloomjoy.nayax_settlement_provider_claim',
    p_provider_claim_token,true);
  if outcome='success' then
    update public.refund_cases set status='completed',manual_refund_reference=reference,
      refund_completed_by=z.actor_user_id,refund_completed_at=settled_at,
      automation_state='completed',nayax_refund_execution_status='approved',
      nayax_match_execution_eligible=false where id=c.id;
    insert into public.sales_adjustment_facts(reporting_machine_id,
      reporting_location_id,adjustment_date,adjustment_type,amount_cents,
      complaint_count,source,source_row_hash,source_reference,source_row_reference,
      refund_case_id,match_status,match_confidence,notes,raw_payload)
    values(c.reporting_machine_id,c.reporting_location_id,settled_at::date,'refund',
      p_amount_cents,1,'refund_case',c.id::text,'refund_cases',c.public_reference,
      c.id,'applied',greatest(c.correlation_confidence,0.01),
      'Bloomjoy refund case '||c.public_reference,jsonb_build_object(
        'refund_case_id',c.id,'nayax_provider_attempt_id',a.id,
        'provider_reference_present',true,'payload_redacted',true))
    on conflict(source,source_reference,source_row_reference) do update set
      reporting_machine_id=excluded.reporting_machine_id,
      reporting_location_id=excluded.reporting_location_id,
      adjustment_date=excluded.adjustment_date,amount_cents=excluded.amount_cents,
      refund_case_id=excluded.refund_case_id,match_status=excluded.match_status,
      match_confidence=excluded.match_confidence,notes=excluded.notes,
      raw_payload=excluded.raw_payload returning * into adjustment;
    update public.refund_cases set reporting_adjustment_id=adjustment.id where id=c.id;
    update public.refund_case_nayax_refund_attempts set status='succeeded',
      provider_reference=reference,provider_status=provider_status,error_code=null,
      sanitized_response=jsonb_build_object('provider_outcome','success',
        'provider_reference_present',true,'payload_redacted',true),
      provider_claim_consumed_at=settled_at,provider_outcome='success',
      provider_outcome_recorded_at=settled_at,reconciliation_required=false,
      reporting_adjustment_id=adjustment.id,case_finalization_committed_at=settled_at,
      completed_at=settled_at where id=a.id returning * into a;
    update public.refund_nayax_transaction_allocations set allocation_state='refunded'
      where account_scope=x->>'accountScope'
        and provider_machine_id=x->>'providerMachineId'
        and original_transaction_id=x->>'transactionId'
        and refund_case_id=c.id and allocation_state='reserved';
    perform public.refund_ensure_proved_nayax_api_terminal_receipt(c.id,a.id);
  else
    update public.refund_cases set nayax_refund_execution_status='ambiguous',
      nayax_match_execution_eligible=false where id=c.id;
    update public.refund_case_nayax_refund_attempts set status='manual_review',
      provider_reference=reference,provider_status=provider_status,
      error_code=coalesce(error_code,case when outcome='timeout' then 'provider_timeout'
        when outcome='rejected' then 'provider_rejected' else 'provider_outcome_unknown' end),
      sanitized_response=jsonb_build_object('provider_outcome',outcome,
        'provider_reference_present',reference is not null,'payload_redacted',true),
      provider_claim_consumed_at=settled_at,provider_outcome=outcome,
      provider_outcome_recorded_at=settled_at,reconciliation_required=true,
      completed_at=settled_at where id=a.id returning * into a;
  end if;
  insert into public.refund_case_events(refund_case_id,actor_user_id,event_type,message,metadata)
  values(c.id,null,case when outcome='success' then 'nayax_official_action_finalized'
      else 'nayax_provider_outcome_recorded' end,
    case when outcome='success' then 'System completed the exact manager-approved refund.'
      else 'The provider outcome is on permanent hold; no retry was created.' end,
    jsonb_build_object('attempt_id',a.id,'authorization_id',z.id,
      'original_approver_user_id',z.actor_user_id,'provider_outcome',outcome,
      'reconciliation_required',a.reconciliation_required,'payload_redacted',true));
  return jsonb_build_object('attempt',public.refund_nayax_attempt_snapshot(a.id,false),
    'updateApplied',true,'reportingAdjustmentPresent',a.reporting_adjustment_id is not null,
    'safeRetryEligible',false,'definitiveNoRefund',false,'payloadRedacted',true);
end;
$$;
revoke all on function public.service_settle_nayax_refund_attempt(
  text,uuid,uuid,uuid,text,integer,text,text,text,text,text,text
) from public,anon,authenticated;
grant execute on function public.service_settle_nayax_refund_attempt(
  text,uuid,uuid,uuid,text,integer,text,text,text,text,text,text
) to service_role;

drop function if exists public.can_view_refund_system_finishing_status_v1(uuid,uuid);

create or replace function public.refund_nayax_approved_card_read_state_v1(p_case_id uuid)
returns text language sql stable security definer set search_path='' as $$
  select case
    when exists(select 1 from public.refund_case_nayax_refund_attempts a
      where a.refund_case_id=p_case_id and a.actor_user_id is null
        and a.status in ('ambiguous','manual_review') and a.reconciliation_required)
      then 'provider_hold'
    when exists(select 1 from public.refund_case_nayax_refund_attempts a
      where a.refund_case_id=p_case_id and a.actor_user_id is null
        and a.status in ('created','in_progress')) then 'system_finishing'
    else 'not_approved' end;
$$;
revoke all on function public.refund_nayax_approved_card_read_state_v1(uuid)
  from public,anon,authenticated,service_role;

create or replace function public.admin_get_refund_nayax_resolution_readiness(
  p_refund_case_id uuid
) returns jsonb language plpgsql stable security definer set search_path='' as $$
declare actor_id uuid:=auth.uid(); c public.refund_cases%rowtype;
  a public.refund_case_nayax_refund_attempts%rowtype; allowed boolean;
begin
  if actor_id is null then raise exception 'Authenticated session required' using errcode='42501'; end if;
  select * into c from public.refund_cases where id=p_refund_case_id;
  if not found then return jsonb_build_object('visible',false,'available',false,
    'payloadRedacted',true); end if;
  allowed:=public.can_manage_refund_case_current_user(c.id);
  if not allowed then return jsonb_build_object('visible',false,'available',false,
    'blockReason','manager_access_required','payloadRedacted',true); end if;
  select * into a from public.refund_case_nayax_refund_attempts attempt
    where attempt.refund_case_id=c.id and attempt.actor_user_id is null
      and attempt.status in ('ambiguous','manual_review')
      and attempt.reconciliation_required
    order by attempt.created_at desc,attempt.id desc limit 1;
  return jsonb_build_object('visible',true,'available',a.id is not null,
    'blockReason',case when a.id is null then 'exact_attempt_required' else null end,
    'systemOutcomeEvidenceAvailable',a.id is not null,'attemptId',a.id,
    'providerOutcome',a.provider_outcome,'expectedCaseVersion',c.official_action_version,
    'allowedResults',jsonb_build_array('provider_confirmed_success','remain_on_hold'),
    'payloadRedacted',true);
end;
$$;
revoke all on function public.admin_get_refund_nayax_resolution_readiness(uuid)
  from public,anon,service_role;
grant execute on function public.admin_get_refund_nayax_resolution_readiness(uuid)
  to authenticated;

-- Evidence may confirm success or leave the same held attempt unchanged. It
-- never releases the purchase, increments a generation, or authorizes a retry.
create or replace function public.admin_record_nayax_system_outcome_evidence_v1(
  p_case_id uuid,p_attempt_id uuid,p_resolution_result text,p_evidence_type text,
  p_evidence_reference text,p_evidence_occurred_at timestamptz,
  p_reason_code text,p_expected_case_version bigint
) returns jsonb language plpgsql security definer set search_path='' as $$
declare evidence_type text:=lower(btrim(coalesce(p_evidence_type,'')));
  evidence_reference text:=btrim(coalesce(p_evidence_reference,''));
  reason_code text:=lower(btrim(coalesce(p_reason_code,'')));
begin
  if auth.uid() is null
    or public.refund_official_action_authority(auth.uid(),p_case_id) is null
    then raise exception 'Manager or Super-admin access required' using errcode='42501'; end if;
  if lower(btrim(coalesce(p_resolution_result,''))) not in
      ('provider_confirmed_success','remain_on_hold')
    or evidence_type not in ('nayax_dtm_transaction','nayax_support_ticket')
    or not public.refund_nayax_resolution_reference_is_safe(
      evidence_reference,evidence_type)
    or p_evidence_occurred_at is null
    or p_evidence_occurred_at>statement_timestamp()+interval '5 minutes'
    or not (
      (lower(btrim(p_resolution_result))='provider_confirmed_success'
        and ((evidence_type='nayax_dtm_transaction' and reason_code='nayax_dtm_settled')
          or (evidence_type='nayax_support_ticket'
            and reason_code='nayax_support_confirmed_success')))
      or (lower(btrim(p_resolution_result))='remain_on_hold'
        and reason_code in ('evidence_incomplete','provider_still_pending','evidence_conflict'))
    ) then
    raise exception 'Held attempts accept success evidence or remain on hold' using errcode='P4661';
  end if;
  perform 1 from public.refund_case_nayax_refund_attempts a
    join public.refund_cases c on c.id=a.refund_case_id
    where a.id=p_attempt_id and a.refund_case_id=p_case_id and a.actor_user_id is null
      and a.status in ('ambiguous','manual_review') and a.reconciliation_required
      and c.official_action_version=p_expected_case_version for update of a,c;
  if not found then raise exception 'Exact held System attempt required' using errcode='P4661'; end if;
  if lower(btrim(p_resolution_result))='remain_on_hold' then
    insert into public.refund_case_events(refund_case_id,actor_user_id,event_type,message,metadata)
    values(p_case_id,auth.uid(),'nayax_system_outcome_evidence_recorded',
      'The evidence was recorded and the same attempt remains on permanent hold.',
      jsonb_build_object('attempt_id',p_attempt_id,'resolution_result','remain_on_hold',
        'evidence_type',evidence_type,'evidence_reference_digest',
          encode(extensions.digest(convert_to(evidence_reference,'UTF8'),'sha256'),'hex'),
        'evidence_reference_present',true,
        'evidence_occurred_at',p_evidence_occurred_at,'reason_code',reason_code,
        'provider_call_made',false,'provider_retry_made',false,'payload_redacted',true));
    return jsonb_build_object('resolved',false,'status','provider_hold',
      'providerCallMade',false,'providerRetryMade',false,'payloadRedacted',true);
  end if;
  return public.admin_resolve_refund_nayax_outcome_manager_session_pre_ops_v1(
    p_case_id,p_attempt_id,'provider_confirmed_success',p_evidence_type,
    p_evidence_reference,p_evidence_occurred_at,p_reason_code,p_expected_case_version)
    ||jsonb_build_object('providerCallMade',false,'providerRetryMade',false,
      'payloadRedacted',true);
end;
$$;
revoke all on function public.admin_record_nayax_system_outcome_evidence_v1(
  uuid,uuid,text,text,text,timestamptz,text,bigint) from public,anon,service_role;
grant execute on function public.admin_record_nayax_system_outcome_evidence_v1(
  uuid,uuid,text,text,text,timestamptz,text,bigint) to authenticated;

-- Retire every legacy card writer. Historical tables remain private/readable
-- to trusted server code, but no old approval becomes executable authority.
revoke all on function public.service_reserve_nayax_refund_manager_action(
  text,uuid,uuid,bigint,text,integer,integer,integer,text) from public,anon,authenticated,service_role;
revoke all on function public.service_reserve_nayax_refund_manager_action_v2(
  text,uuid,uuid,bigint,text,integer,integer,integer,text,text,text) from public,anon,authenticated,service_role;
revoke all on function public.service_reserve_nayax_refund_manager_action_v3(
  text,uuid,uuid,bigint,text,integer,integer,integer,text,text,text,text) from public,anon,authenticated,service_role;
revoke all on function public.service_reserve_nayax_refund_manager_action_v4(
  text,uuid,uuid,bigint,text,integer,integer,integer,text,text,text,text,text) from public,anon,authenticated,service_role;
revoke all on function public.service_reserve_nayax_refund_manager_action_v5(
  text,uuid,uuid,bigint,text,integer,integer,integer,text,text,text,text,text,text) from public,anon,authenticated,service_role;
revoke all on function public.service_reserve_and_consume_nayax_refund_attempt(
  text,uuid,uuid,text,integer,text) from public,anon,authenticated,service_role;
revoke all on function public.service_reserve_and_consume_nayax_refund_attempt_v2(
  text,uuid,uuid,text,integer,integer,integer,text) from public,anon,authenticated,service_role;
revoke all on function public.service_reserve_nayax_refund_approval_continuation_v1(
  text,uuid,uuid,bigint,text,integer,text,text,text) from public,anon,authenticated,service_role;
revoke all on function public.service_reserve_nayax_refund_approval_continuation_v2(
  text,uuid,uuid,bigint,text,integer,text,text,text,text,text,text) from public,anon,authenticated,service_role;
revoke all on function public.service_claim_due_nayax_approval_continuations_v1(
  text,text,integer) from public,anon,authenticated,service_role;
revoke all on function public.service_reserve_nayax_pending_approval_recovery(
  text,uuid,uuid,uuid,bigint,text) from public,anon,authenticated,service_role;
revoke all on function public.service_settle_nayax_pending_approval_recovery(
  text,uuid,uuid,uuid,text,text,text,text,text) from public,anon,authenticated,service_role;
revoke all on function public.admin_begin_refund_manual_nayax_portal(uuid,bigint)
  from public,anon,authenticated,service_role;
revoke all on function public.admin_create_refund_manual_nayax_candidate(
  uuid,bigint,text,text,text,integer,text) from public,anon,authenticated,service_role;
revoke all on function public.admin_get_refund_manual_nayax_context()
  from public,anon,authenticated,service_role;
revoke all on function public.admin_prepare_refund_nayax_resolution_intent(
  uuid,uuid,text,text,text,timestamptz,text,bigint) from public,anon,authenticated,service_role;
revoke all on function public.admin_consume_refund_nayax_resolution_intent(
  uuid,uuid,uuid,text,text,text,timestamptz,text,text) from public,anon,authenticated,service_role;
revoke all on function public.admin_begin_refund_nayax_evidence_only_reconciliation(uuid,bigint)
  from public,anon,authenticated,service_role;
revoke all on function public.admin_resolve_refund_nayax_outcome_manager_session(
  uuid,uuid,text,text,text,timestamptz,text,bigint) from public,anon,authenticated,service_role;
revoke all on function public.service_recover_stale_nayax_refund_attempts(text)
  from public,anon,authenticated,service_role;

-- Controlled-owner pilot history remains auditable, but every pilot writer is
-- permanently outside the executable surface after this cutover.
do $revoke_legacy_writers$
declare writer record;
begin
  for writer in
    select p.oid::regprocedure as signature
    from pg_catalog.pg_proc p
    join pg_catalog.pg_namespace n on n.oid=p.pronamespace
    where n.nspname='public' and p.proname=any(array[
      'owner_authorize_refund_nayax_controlled_pilot',
      'owner_cancel_refund_nayax_controlled_pilot',
      'owner_recover_expired_refund_nayax_controlled_pilot',
      'admin_consume_refund_nayax_controlled_pilot_intent',
      'service_validate_nayax_controlled_pilot_postarm',
      'service_reserve_and_consume_nayax_controlled_pilot_attempt',
      'service_record_nayax_controlled_pilot_stage',
      'service_settle_nayax_controlled_pilot_attempt'])
  loop
    execute format('revoke all on function %s from public,anon,authenticated,service_role',
      writer.signature);
  end loop;
end;
$revoke_legacy_writers$;

-- Retired step-up and refund-specific TOTP functions are historical only.
-- Revoke every overload so no old deployment signature remains callable.
do $revoke_step_up_totp_writers$
declare writer record;
begin
  for writer in
    select p.oid::regprocedure as signature
    from pg_catalog.pg_proc p
    join pg_catalog.pg_namespace n on n.oid=p.pronamespace
    where n.nspname='public' and p.proname=any(array[
      'admin_prepare_refund_action_step_up_intent',
      'admin_get_refund_action_step_up_intent',
      'admin_cancel_refund_action_step_up_intent',
      'admin_consume_refund_action_step_up_intent',
      'admin_refund_manager_step_up_factor_is_approved',
      'open_refund_manager_totp_enrollment_window_current_user',
      'close_refund_manager_totp_enrollment_window_current_user',
      'get_refund_manager_totp_enrollment_readiness_current_user',
      'can_enroll_refund_manager_totp_current_user',
      'service_mark_refund_manager_step_up_factor_verified',
      'service_mark_refund_nayax_resolution_factor_verified',
      'service_record_refund_manager_totp_enrollment',
      'service_compensate_refund_manager_totp_enrollment'])
  loop
    execute format('revoke all on function %s from public,anon,authenticated,service_role',
      writer.signature);
  end loop;
end;
$revoke_step_up_totp_writers$;

revoke all on table public.refund_nayax_attempt_approval_continuations
  from public,anon,authenticated,service_role;
revoke all on table public.refund_nayax_server_approval_continuation_claims
  from public,anon,authenticated,service_role;
revoke all on table public.refund_nayax_pending_approval_recoveries
  from public,anon,authenticated,service_role;

select pg_notify('pgrst','reload schema');
