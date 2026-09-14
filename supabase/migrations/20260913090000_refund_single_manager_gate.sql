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

-- Persist the routine lookup and its one unambiguous recommendation together.
-- A clear System match is evidence preparation only; the assigned manager or
-- Super-admin still supplies the single financial approval.
create or replace function public.service_commit_refund_nayax_lookup_and_preselect_v1(
  p_refund_case_id uuid,p_lookup_generation bigint,p_expected_fact_version bigint,
  p_lookup_status text,p_recommendation_state text,p_policy_version text,
  p_last_checked_at timestamptz,p_summary text,p_resolved_machine_id uuid,
  p_candidate_count integer,p_trigger_source text,p_actor_user_id uuid,p_diagnostics jsonb
) returns jsonb language plpgsql security definer set search_path='' as $$
declare result jsonb; c public.refund_cases%rowtype;
  candidate public.refund_nayax_lookup_candidates%rowtype; qualifying_count integer;
  candidate_token uuid; evidence_hash text;
begin
  result:=public.service_commit_refund_nayax_lookup_with_diagnostics(
    p_refund_case_id,p_lookup_generation,p_expected_fact_version,p_lookup_status,
    p_recommendation_state,p_policy_version,p_last_checked_at,p_summary,
    p_resolved_machine_id,p_candidate_count,p_trigger_source,p_actor_user_id,p_diagnostics);
  if result->>'applied' is distinct from 'true' or p_actor_user_id is not null
    or p_trigger_source not in ('automatic','scheduled')
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
    and k.actor_user_id is null
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
    jsonb_build_object('candidate_token',candidate.token,'candidate_evidence_hash',evidence_hash,
      'lookup_generation',p_lookup_generation,'deterministic_fact_version',p_expected_fact_version,
      'provider_amount_cents',candidate.amount_cents,'execution_eligible',true,
      'provider_call_made',false,'payload_redacted',true));
  return result||jsonb_build_object('systemPreselectionApplied',true,
    'selectedCandidateToken',candidate.token,'providerAmountCents',candidate.amount_cents,
    'payloadRedacted',true);
end;
$$;
revoke all on function public.service_commit_refund_nayax_lookup_and_preselect_v1(
  uuid,bigint,bigint,text,text,text,timestamptz,text,uuid,integer,text,uuid,jsonb)
  from public,anon,authenticated;
grant execute on function public.service_commit_refund_nayax_lookup_and_preselect_v1(
  uuid,bigint,bigint,text,text,text,timestamptz,text,uuid,integer,text,uuid,jsonb)
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
  body:=replace(body,old_text,new_text);
  old_text:=E'    jsonb_build_object(\n      ''policy_version'', policy_version,';
  new_text:=E'    jsonb_build_object(\n      ''candidate_token'', candidate.token,\n'
    ||E'      ''candidate_evidence_hash'', public.refund_nayax_candidate_evidence_hash(\n'
    ||E'        candidate.refund_case_id,candidate.actor_user_id,candidate.provider_transaction_id,\n'
    ||E'        candidate.site_id,candidate.machine_authorization_time,candidate.amount_cents,\n'
    ||E'        candidate.card_last4,candidate.currency_code,candidate.evidence_summary,\n'
    ||E'        candidate.expires_at,candidate.created_at),\n'
    ||E'      ''lookup_generation'', candidate.lookup_generation,\n'
    ||E'      ''deterministic_fact_version'', refund_case.deterministic_fact_version,\n'
    ||E'      ''policy_version'', policy_version,';
  if cardinality(string_to_array(body,old_text))<>2 then
    raise exception 'Unexpected candidate selection audit shape';
  end if;
  execute replace(body,old_text,new_text);

  body:=replace(pg_get_functiondef(
    'public.enforce_refund_official_event_boundary()'::regprocedure),E'\r\n',E'\n');
  old_text:=E'      ''nayax_match_selected'',\n';
  new_text:=old_text||E'      ''nayax_match_preselected'',\n'
    ||E'      ''nayax_match_preselection_disputed'',\n';
  if cardinality(string_to_array(body,old_text))<>3 then
    raise exception 'Unexpected official selection event boundary shape';
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
  if not exists(select 1 from public.refund_cases c where c.id=p_case_id
      and c.decision is null and c.nayax_recommendation_state in ('ambiguous','manual_exception')
      and c.nayax_lookup_status in ('multiple_matches','manual_exception')) then
    raise exception 'Clear System matches are read-only; choose only among ambiguous results'
      using errcode='P4604';
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

create or replace function public.admin_dispute_refund_nayax_preselection_current_user_v1(
  p_case_id uuid,p_expected_case_version bigint
) returns jsonb language plpgsql security definer set search_path='' as $$
declare actor_id uuid:=auth.uid(); c public.refund_cases%rowtype;
  candidate public.refund_nayax_lookup_candidates%rowtype; evidence_hash text;
begin
  if actor_id is null or coalesce((auth.jwt()->>'is_anonymous')::boolean,false)
    or not public.can_manage_refund_case_current_user(p_case_id) then
    raise exception 'Current refund case access required' using errcode='42501';
  end if;
  select * into c from public.refund_cases where id=p_case_id for update;
  if not found or c.official_action_version is distinct from p_expected_case_version then
    raise exception 'Refund case changed; reload before disputing the System match'
      using errcode='P4620';
  end if;
  if c.payment_method<>'card' or c.status not in ('needs_review','correlated')
    or c.decision is not null or c.correlation_status<>'matched'
    or c.correlation_source<>'nayax' or not c.nayax_match_execution_eligible
    or c.nayax_recommendation_state<>'high_confidence'
    or c.nayax_refund_execution_status<>'not_requested'
    or c.reporting_adjustment_id is not null or c.refund_completed_at is not null
    or c.duplicate_of_refund_case_id is not null
    or public.refund_case_has_unresolved_reconciliation(c.id)
    or exists(select 1 from public.refund_authoritative_receipts receipt
      where receipt.refund_case_id=c.id)
    or exists(select 1 from public.refund_case_nayax_refund_attempts attempt
      where attempt.refund_case_id=c.id)
    or exists(select 1 from public.refund_case_official_action_authorizations approval_record
      where approval_record.refund_case_id=c.id and approval_record.status in ('pending','consumed')) then
    raise exception 'Only the current unapproved System match can be disputed'
      using errcode='P4620';
  end if;
  select * into candidate from public.refund_nayax_lookup_candidates k
    where k.refund_case_id=c.id and k.lookup_generation=c.nayax_lookup_generation
      and k.actor_user_id is null
      and k.reporting_machine_id=c.reporting_machine_id
      and k.provider_transaction_id is not distinct from c.matched_nayax_transaction_id
      and k.site_id is not distinct from c.matched_nayax_site_id
      and k.machine_authorization_time is not distinct from c.matched_nayax_machine_auth_time
      and k.amount_cents is not distinct from c.matched_nayax_amount_cents
      and k.card_last4 is not distinct from c.matched_nayax_card_last4
      and k.currency_code is not distinct from c.matched_nayax_currency_code
    order by k.created_at desc,k.token desc limit 1 for share;
  if not found then
    raise exception 'Current System match evidence is unavailable' using errcode='P4620';
  end if;
  evidence_hash:=public.refund_nayax_candidate_evidence_hash(candidate.refund_case_id,
    candidate.actor_user_id,candidate.provider_transaction_id,candidate.site_id,
    candidate.machine_authorization_time,candidate.amount_cents,candidate.card_last4,
    candidate.currency_code,candidate.evidence_summary,candidate.expires_at,candidate.created_at);
  if not exists(select 1 from public.refund_case_events event
      where event.refund_case_id=c.id and event.event_type='nayax_match_preselected'
        and event.actor_user_id is null
        and event.metadata->>'candidate_token'=candidate.token::text
        and event.metadata->>'candidate_evidence_hash'=evidence_hash
        and event.metadata->>'lookup_generation'=c.nayax_lookup_generation::text
        and event.metadata->>'deterministic_fact_version'=c.deterministic_fact_version::text
        and event.metadata->>'execution_eligible'='true'
        and event.metadata->>'payload_redacted'='true') then
    raise exception 'Exact current System preselection evidence required' using errcode='P4620';
  end if;
  update public.refund_cases set refund_amount_cents=null,
    matched_nayax_transaction_id=null,matched_nayax_site_id=null,
    matched_nayax_machine_auth_time=null,matched_nayax_amount_cents=null,
    matched_nayax_card_last4=null,matched_nayax_currency_code=null,
    correlation_status='manual_review',correlation_source=null,correlation_confidence=0,
    correlation_summary='The System match was disputed. Review the available transactions.',
    nayax_lookup_status='manual_exception',nayax_recommendation_state='manual_exception',
    nayax_recommendation_policy_version=null,nayax_recommendation_evaluated_at=statement_timestamp(),
    nayax_match_execution_eligible=false where id=c.id returning * into c;
  insert into public.refund_case_events(refund_case_id,actor_user_id,event_type,message,metadata)
  values(c.id,actor_id,'nayax_match_preselection_disputed',
    'A case worker disputed the System-selected transaction. No refund was approved or issued.',
    jsonb_build_object('candidate_token',candidate.token,
      'candidate_evidence_hash',evidence_hash,'lookup_generation',candidate.lookup_generation,
      'provider_call_made',false,'approval_created',false,
      'customer_message_created',false,'payload_redacted',true));
  return jsonb_build_object('disputed',true,'status','manual_exception',
    'refundCaseId',c.id,'caseVersion',c.official_action_version,
    'providerCallMade',false,'approvalCreated',false,
    'customerMessageCreated',false,'payloadRedacted',true);
end;
$$;
revoke all on function public.admin_dispute_refund_nayax_preselection_current_user_v1(uuid,bigint)
  from public,anon,service_role;
grant execute on function public.admin_dispute_refund_nayax_preselection_current_user_v1(uuid,bigint)
  to authenticated;

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
  add column if not exists provider_execution_generation integer not null default 1,
  add column if not exists execution_plan text not null default 'request_and_approve',
  drop constraint if exists refund_nayax_provider_execution_generation_check,
  add constraint refund_nayax_provider_execution_generation_check
    check(provider_execution_generation between 1 and 100),
  drop constraint if exists refund_nayax_execution_plan_check,
  add constraint refund_nayax_execution_plan_check
    check(execution_plan in ('request_and_approve','approve_only')),
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

alter table public.refund_nayax_provider_stage_journal
  add column if not exists provider_execution_generation integer not null default 1;
drop index if exists public.refund_nayax_provider_stage_once_idx;
create unique index refund_nayax_provider_stage_once_idx
  on public.refund_nayax_provider_stage_journal(nayax_refund_attempt_id,
    provider_execution_generation,
    coalesce(pending_approval_recovery_id,'00000000-0000-0000-0000-000000000000'::uuid),
    stage,event);

create or replace function public.bind_refund_nayax_provider_stage_generation_v1()
returns trigger language plpgsql security definer set search_path='' as $$
begin
  select a.provider_execution_generation into new.provider_execution_generation
  from public.refund_case_nayax_refund_attempts a
  where a.id=new.nayax_refund_attempt_id;
  if not found then raise exception 'Exact Nayax attempt required' using errcode='P4620'; end if;
  return new;
end;
$$;
revoke all on function public.bind_refund_nayax_provider_stage_generation_v1()
  from public,anon,authenticated,service_role;
drop trigger if exists aaa_bind_refund_nayax_provider_stage_generation_v1
  on public.refund_nayax_provider_stage_journal;
create trigger aaa_bind_refund_nayax_provider_stage_generation_v1
before insert on public.refund_nayax_provider_stage_journal for each row
execute function public.bind_refund_nayax_provider_stage_generation_v1();

do $generation_scope_diagnostics$
declare body text; anchor text; replacement text;
begin
  body:=replace(pg_get_functiondef(
    'public.service_record_nayax_refund_provider_stage_v3(text,uuid,text,text,text,integer,text,boolean,text,text,text,text,boolean,text,text,text,boolean,boolean,boolean,boolean,boolean,text,text,boolean)'::regprocedure),E'\r\n',E'\n');
  anchor:=E'      and journal.event = ''started''\n'
    ||E'      and journal.provider_contract_version = normalized_provider_version';
  replacement:=E'      and journal.event = ''started''\n'
    ||E'      and journal.provider_execution_generation=attempt_row.provider_execution_generation\n'
    ||E'      and journal.provider_contract_version = normalized_provider_version';
  if cardinality(string_to_array(body,anchor))<>2 then
    raise exception 'Unexpected provider started-stage lookup shape';
  end if;
  execute replace(body,anchor,replacement);

  body:=replace(pg_get_functiondef(
    'public.service_record_nayax_refund_provider_stage_v3_diagnostics(text,uuid,text,text,text,integer,text,boolean,text,text,text,text,boolean,text,text,text,boolean,boolean,boolean,boolean,boolean,text,text,boolean,text,text,boolean,text,text,boolean)'::regprocedure),E'\r\n',E'\n');
  anchor:=E'      and journal.pending_approval_recovery_id is null\n'
    ||E'      and journal.stage = lower(btrim(p_stage))\n'
    ||E'      and journal.event = ''result'';';
  replacement:=E'      and journal.pending_approval_recovery_id is null\n'
    ||E'      and journal.provider_execution_generation=(select provider_execution_generation\n'
    ||E'        from public.refund_case_nayax_refund_attempts where id=p_attempt_id)\n'
    ||E'      and journal.stage = lower(btrim(p_stage))\n'
    ||E'      and journal.event = ''result'';';
  if cardinality(string_to_array(body,anchor))<>2 then
    raise exception 'Unexpected provider business-outcome lookup shape';
  end if;
  execute replace(body,anchor,replacement);

  body:=replace(pg_get_functiondef(
    'public.service_record_nayax_refund_provider_stage_v4_diagnostics(text,uuid,text,text,text,integer,text,boolean,text,text,text,text,boolean,text,text,text,boolean,boolean,boolean,boolean,boolean,text,text,boolean,text,text,boolean,text,text,boolean,text,text,text,text,text,text)'::regprocedure),E'\r\n',E'\n');
  anchor:=E'      and pending_approval_recovery_id is null\n'
    ||E'      and stage=lower(btrim(p_stage)) and event=''result'';';
  replacement:=E'      and pending_approval_recovery_id is null\n'
    ||E'      and provider_execution_generation=(select provider_execution_generation\n'
    ||E'        from public.refund_case_nayax_refund_attempts where id=p_attempt_id)\n'
    ||E'      and stage=lower(btrim(p_stage)) and event=''result'';';
  if cardinality(string_to_array(body,anchor))<>2 then
    raise exception 'Unexpected provider diagnostics journal lookup shape';
  end if;
  execute replace(body,anchor,replacement);
end;
$generation_scope_diagnostics$;

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
    raise exception 'Refund case changed since review; reload before approving the refund'
      using errcode='P4620';
  end if;
  if c.payment_method<>'card' or c.status not in ('needs_review','correlated')
    or c.decision is not null or c.correlation_status<>'matched'
    or c.correlation_source<>'nayax' or not c.nayax_match_execution_eligible
    or c.nayax_refund_execution_status<>'not_requested'
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
  if not exists(select 1 from public.refund_case_events e where e.refund_case_id=c.id
      and (
        (e.event_type='nayax_match_preselected' and e.actor_user_id is null
          and e.metadata->>'candidate_token'=selected.token::text
          and e.metadata->>'candidate_evidence_hash'=candidate_hash
          and e.metadata->>'lookup_generation'=c.nayax_lookup_generation::text
          and e.metadata->>'deterministic_fact_version'=c.deterministic_fact_version::text
          and e.metadata->>'execution_eligible'='true'
          and e.metadata->>'payload_redacted'='true')
        or (e.event_type='nayax_match_selected'
          and e.metadata->>'candidate_token'=selected.token::text
          and e.metadata->>'candidate_evidence_hash'=candidate_hash
          and e.metadata->>'lookup_generation'=c.nayax_lookup_generation::text
          and e.metadata->>'deterministic_fact_version'=c.deterministic_fact_version::text
          and e.metadata->>'execution_eligible'='true'
          and e.metadata->>'payload_redacted'='true')
      )) then
    raise exception 'Current System or case-worker transaction selection evidence required'
      using errcode='P4620';
  end if;
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

-- Readiness accepts the current exact System preselection or the current exact
-- ambiguous-case selection. Retired approval-continuation state is never a
-- reason to offer another manager action.
create or replace function public.refund_case_nayax_manager_readiness(
  p_user_id uuid,p_refund_case_id uuid
) returns jsonb language plpgsql stable security definer set search_path='' as $$
declare c public.refund_cases%rowtype; machine public.reporting_machines%rowtype;
  transaction_confirmed boolean:=false; block_reason text:=null;
begin
  select * into c from public.refund_cases where id=p_refund_case_id;
  if not found then return jsonb_build_object('transactionConfirmed',false,
    'approvalContinuationReady',false,'canIssueCardRefund',false,
    'blockReason','case_not_found','refundAmountCents',null,
    'machineLimitCents',null,'caseVersion',null); end if;
  if c.reporting_machine_id is not null then
    select * into machine from public.reporting_machines where id=c.reporting_machine_id;
  end if;
  transaction_confirmed:=c.correlation_status='matched'
    and c.correlation_source='nayax' and c.nayax_match_execution_eligible
    and c.nayax_recommendation_policy_version is not null
    and public.is_review_safe_nayax_transaction_reference(c.matched_nayax_transaction_id)
    and c.matched_nayax_site_id is not null
    and c.matched_nayax_machine_auth_time is not null
    and c.matched_nayax_amount_cents is not null and c.matched_nayax_amount_cents>0
    and c.matched_nayax_currency_code='USD'
    and c.refund_amount_cents=c.matched_nayax_amount_cents
    and exists(select 1 from public.refund_nayax_lookup_candidates k
      join public.refund_case_events e on e.refund_case_id=k.refund_case_id
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
        and e.metadata->>'candidate_token'=k.token::text
        and e.metadata->>'candidate_evidence_hash'=
          public.refund_nayax_candidate_evidence_hash(k.refund_case_id,k.actor_user_id,
            k.provider_transaction_id,k.site_id,k.machine_authorization_time,k.amount_cents,
            k.card_last4,k.currency_code,k.evidence_summary,k.expires_at,k.created_at)
        and e.metadata->>'lookup_generation'=c.nayax_lookup_generation::text
        and e.metadata->>'deterministic_fact_version'=c.deterministic_fact_version::text
        and ((e.event_type='nayax_match_preselected' and e.actor_user_id is null
            and e.metadata->>'execution_eligible'='true')
          or (e.event_type='nayax_match_selected' and e.actor_user_id is not null)));
  block_reason:=case
    when p_user_id is null or not public.can_perform_refund_official_action(p_user_id,c.id)
      then 'unauthorized'
    when not transaction_confirmed then 'transaction_not_confirmed'
    when c.reporting_adjustment_id is not null or c.refund_completed_at is not null
      or c.nayax_refund_execution_status='succeeded' then 'already_refunded'
    when public.refund_case_has_unresolved_reconciliation(c.id)
      or c.nayax_refund_execution_status in ('requested','ambiguous','manual_review')
      then 'reconciliation_hold'
    when exists(select 1 from public.refund_cases other where other.id<>c.id
      and other.matched_nayax_transaction_id=c.matched_nayax_transaction_id)
      then 'duplicate_transaction'
    when c.payment_method<>'card' or c.status not in ('needs_review','correlated')
      or c.decision is not null or c.nayax_refund_execution_status<>'not_requested'
      then 'case_not_refundable'
    when machine.id is null or machine.status<>'active'
      or nullif(btrim(machine.nayax_machine_id),'') is null
      or nullif(btrim(machine.nayax_account_key),'') is null then 'provider_unavailable'
    when not machine.nayax_refunds_enabled then 'machine_not_enabled'
    else null end;
  return jsonb_build_object('transactionConfirmed',transaction_confirmed,
    'approvalContinuationReady',false,'canIssueCardRefund',block_reason is null,
    'blockReason',block_reason,'refundAmountCents',c.matched_nayax_amount_cents,
    'machineLimitCents',null,'caseVersion',c.official_action_version,
    'accountCircuitBreakerActive',false);
end;
$$;
revoke execute on function public.refund_case_nayax_manager_readiness(uuid,uuid)
  from public,anon,authenticated;
grant execute on function public.refund_case_nayax_manager_readiness(uuid,uuid)
  to service_role;

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
      'providerExecutionGeneration',a.provider_execution_generation,
      'executionPlan',a.execution_plan,
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
    where j.nayax_refund_attempt_id=a.id
      and j.provider_execution_generation=a.provider_execution_generation
      and j.event='started') into transport_started;
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
      'The expired provider-started attempt is held for verification; no blind provider call was created.',
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
    'System held this exact attempt for verification; no blind provider call was created.',
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

create table if not exists public.refund_nayax_system_success_evidence(
  id uuid primary key default extensions.gen_random_uuid(),
  refund_case_id uuid not null unique references public.refund_cases(id) on delete restrict,
  nayax_refund_attempt_id uuid not null unique
    references public.refund_case_nayax_refund_attempts(id) on delete restrict,
  official_action_authorization_id uuid not null
    references public.refund_case_official_action_authorizations(id) on delete restrict,
  evidence_type text not null check(evidence_type in ('nayax_dtm_transaction','nayax_support_ticket')),
  evidence_reference_digest text not null check(evidence_reference_digest~'^[a-f0-9]{64}$'),
  evidence_occurred_at timestamptz not null,
  reason_code text not null check(reason_code in ('nayax_dtm_settled','nayax_support_confirmed_success')),
  frozen_execution_context_hash text not null check(frozen_execution_context_hash~'^[a-f0-9]{64}$'),
  prior_provider_outcome text not null check(prior_provider_outcome in ('rejected','timeout','unknown')),
  prior_safe_transport_stage text not null,
  recorded_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default statement_timestamp()
);
alter table public.refund_nayax_system_success_evidence enable row level security;
revoke all on table public.refund_nayax_system_success_evidence
  from public,anon,authenticated,service_role;

create or replace function public.guard_refund_nayax_system_success_evidence_immutable_v1()
returns trigger language plpgsql set search_path='' as $$
begin raise exception 'System success evidence is append-only' using errcode='P4620'; end;
$$;
revoke all on function public.guard_refund_nayax_system_success_evidence_immutable_v1()
  from public,anon,authenticated,service_role;
drop trigger if exists refund_nayax_system_success_evidence_immutable_v1
  on public.refund_nayax_system_success_evidence;
create trigger refund_nayax_system_success_evidence_immutable_v1
before update or delete on public.refund_nayax_system_success_evidence for each row
execute function public.guard_refund_nayax_system_success_evidence_immutable_v1();

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
            where journal.nayax_refund_attempt_id=attempt.id
              and journal.provider_execution_generation=attempt.provider_execution_generation
              and journal.event='started')
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
        or
        (attempt.status in ('manual_review','ambiguous')
          and attempt.provider_outcome in ('rejected','timeout','unknown')
          and attempt.reconciliation_required
          and exists(select 1 from public.refund_nayax_system_success_evidence evidence
            where evidence.id=nullif(current_setting(
                'bloomjoy.nayax_system_success_evidence_id',true),'')::uuid
              and evidence.refund_case_id=attempt.refund_case_id
              and evidence.nayax_refund_attempt_id=attempt.id
              and evidence.official_action_authorization_id=approval.id)
          and p_new->>'status'='completed'
          and p_new->>'decision'='approved'
          and p_new->>'nayax_refund_execution_status'='approved')
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
  body:=replace(body,old_text,new_text);
  old_text:=E'      and request_journal.stage=''request'' and request_journal.event=''result''\n';
  new_text:=old_text||E'      and request_journal.provider_execution_generation<=attempt.provider_execution_generation\n';
  if cardinality(string_to_array(body,old_text))<>2 then
    raise exception 'Unexpected terminal request journal shape';
  end if;
  body:=replace(body,old_text,new_text);
  old_text:=E'      and approve_journal.stage=''approve'' and approve_journal.event=''result''\n';
  new_text:=old_text||E'      and approve_journal.provider_execution_generation=attempt.provider_execution_generation\n';
  if cardinality(string_to_array(body,old_text))<>2 then
    raise exception 'Unexpected terminal approval journal shape';
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
  body:=replace(body,old_text,new_text);
  old_text:=E'      and stage=''request'' and event=''result'';';
  new_text:=E'      and stage=''request'' and event=''result''\n'
    ||E'      and provider_execution_generation<=attempt.provider_execution_generation\n'
    ||E'      and outcome=''accepted'' order by provider_execution_generation desc limit 1;';
  if cardinality(string_to_array(body,old_text))<>2 then
    raise exception 'Unexpected terminal receipt request journal shape';
  end if;
  body:=replace(body,old_text,new_text);
  old_text:=E'      and stage=''approve'' and event=''result'';';
  new_text:=E'      and stage=''approve'' and event=''result''\n'
    ||E'      and provider_execution_generation=attempt.provider_execution_generation;';
  if cardinality(string_to_array(body,old_text))<>2 then
    raise exception 'Unexpected terminal receipt approval journal shape';
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
    or a.execution_mode<>'request_and_approve'
    or a.execution_plan not in ('request_and_approve','approve_only')
    or a.status<>'in_progress'
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
    if not exists(select 1 from public.refund_nayax_provider_stage_journal j
        where j.nayax_refund_attempt_id=a.id
          and j.provider_execution_generation=a.provider_execution_generation
          and j.stage='approve' and j.event='result' and j.outcome='succeeded'
          and j.contract_matched)
      or (a.execution_plan='request_and_approve' and not exists(select 1
        from public.refund_nayax_provider_stage_journal j
        where j.nayax_refund_attempt_id=a.id
          and j.provider_execution_generation=a.provider_execution_generation
          and j.stage='request' and j.event='result' and j.outcome='accepted'
          and j.contract_matched and j.approval_authorized))
      or (a.execution_plan='approve_only' and not exists(select 1
        from public.refund_nayax_provider_stage_journal j
        where j.nayax_refund_attempt_id=a.id
          and j.provider_execution_generation<a.provider_execution_generation
          and j.stage='request' and j.event='result' and j.outcome='accepted'
          and j.contract_matched and j.approval_authorized)) then
      raise exception 'Generation-scoped accepted request and approval proof required'
        using errcode='P4620';
    end if;
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
      else 'The provider outcome is held for verification; no blind provider call was created.' end,
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

create table if not exists public.refund_nayax_no_refund_proofs(
  id uuid primary key default extensions.gen_random_uuid(),
  refund_case_id uuid not null references public.refund_cases(id) on delete restrict,
  nayax_refund_attempt_id uuid not null
    references public.refund_case_nayax_refund_attempts(id) on delete restrict,
  source_execution_generation integer not null check(source_execution_generation>0),
  continuation_execution_generation integer not null
    check(continuation_execution_generation=source_execution_generation+1),
  evidence_type text not null check(evidence_type in ('nayax_dtm_transaction','nayax_support_ticket')),
  evidence_reference_digest text not null check(evidence_reference_digest~'^[a-f0-9]{64}$'),
  evidence_occurred_at timestamptz not null,
  reason_code text not null check(reason_code in
    ('nayax_dtm_not_refunded','nayax_support_confirmed_no_refund')),
  execution_plan text not null check(execution_plan in ('request_and_approve','approve_only')),
  frozen_execution_context_hash text not null
    check(frozen_execution_context_hash~'^[a-f0-9]{64}$'),
  prior_provider_outcome text not null
    check(prior_provider_outcome in ('rejected','timeout','unknown')),
  prior_safe_transport_stage text not null,
  recorded_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default statement_timestamp(),
  unique(nayax_refund_attempt_id,source_execution_generation)
);
alter table public.refund_nayax_no_refund_proofs enable row level security;
revoke all on table public.refund_nayax_no_refund_proofs
  from public,anon,authenticated,service_role;

create or replace function public.guard_refund_nayax_no_refund_proof_immutable_v1()
returns trigger language plpgsql set search_path='' as $$
begin raise exception 'No-refund proof is append-only' using errcode='P4620'; end;
$$;
revoke all on function public.guard_refund_nayax_no_refund_proof_immutable_v1()
  from public,anon,authenticated,service_role;
drop trigger if exists refund_nayax_no_refund_proof_immutable_v1
  on public.refund_nayax_no_refund_proofs;
create trigger refund_nayax_no_refund_proof_immutable_v1
before update or delete on public.refund_nayax_no_refund_proofs for each row
execute function public.guard_refund_nayax_no_refund_proof_immutable_v1();

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
grant execute on function public.refund_nayax_approved_card_read_state_v1(uuid)
  to service_role;

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
    'allowedResults',jsonb_build_array('provider_confirmed_success',
      'provider_confirmed_no_refund','remain_on_hold'),
    'payloadRedacted',true);
end;
$$;
revoke all on function public.admin_get_refund_nayax_resolution_readiness(uuid)
  from public,anon,service_role;
grant execute on function public.admin_get_refund_nayax_resolution_readiness(uuid)
  to authenticated;

-- Evidence may confirm success, leave the attempt held, or prove authoritatively
-- that no refund occurred. Only the last case advances the same System attempt
-- to one new execution generation under the original consumed approval.
create or replace function public.admin_record_nayax_system_outcome_evidence_v1(
  p_case_id uuid,p_attempt_id uuid,p_resolution_result text,p_evidence_type text,
  p_evidence_reference text,p_evidence_occurred_at timestamptz,
  p_reason_code text,p_expected_case_version bigint
) returns jsonb language plpgsql security definer set search_path='' as $$
declare evidence_type text:=lower(btrim(coalesce(p_evidence_type,'')));
  evidence_reference text:=btrim(coalesce(p_evidence_reference,''));
  reason_code text:=lower(btrim(coalesce(p_reason_code,'')));
  resolution_result text:=lower(btrim(coalesce(p_resolution_result,'')));
  a public.refund_case_nayax_refund_attempts%rowtype; c public.refund_cases%rowtype;
  approval public.refund_case_official_action_authorizations%rowtype;
  success_evidence public.refund_nayax_system_success_evidence%rowtype;
  adjustment public.sales_adjustment_facts%rowtype;
  completion_thread public.refund_gmail_threads%rowtype;
  completion_message public.refund_case_messages%rowtype;
  next_generation integer; next_plan text; next_idempotency text;
  evidence_digest text; completion_subject text; completion_body text;
begin
  if auth.uid() is null or not public.can_manage_refund_case_current_user(p_case_id)
    then raise exception 'Current refund case access required' using errcode='42501'; end if;
  if resolution_result not in
      ('provider_confirmed_success','provider_confirmed_no_refund','remain_on_hold')
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
      or (resolution_result='provider_confirmed_no_refund'
        and ((evidence_type='nayax_dtm_transaction' and reason_code='nayax_dtm_not_refunded')
          or (evidence_type='nayax_support_ticket'
            and reason_code='nayax_support_confirmed_no_refund')))
      or (lower(btrim(p_resolution_result))='remain_on_hold'
        and reason_code in ('evidence_incomplete','provider_still_pending','evidence_conflict'))
    ) then
    raise exception 'Held attempts require exact success, exact no-refund, or remain-held evidence'
      using errcode='P4661';
  end if;
  evidence_digest:=encode(extensions.digest(convert_to(evidence_reference,'UTF8'),'sha256'),'hex');
  select attempt.* into a from public.refund_case_nayax_refund_attempts attempt
    where attempt.id=p_attempt_id and attempt.refund_case_id=p_case_id
      and attempt.actor_user_id is null for update;
  select * into c from public.refund_cases where id=p_case_id for update;
  select * into approval from public.refund_case_official_action_authorizations
    where id=a.official_action_authorization_id and refund_case_id=p_case_id for share;
  if resolution_result='provider_confirmed_success' then
    select * into success_evidence from public.refund_nayax_system_success_evidence evidence
      where evidence.refund_case_id=p_case_id and evidence.nayax_refund_attempt_id=p_attempt_id;
    if success_evidence.id is not null then
      if success_evidence.evidence_type<>evidence_type
        or success_evidence.evidence_reference_digest<>evidence_digest
        or success_evidence.evidence_occurred_at<>p_evidence_occurred_at
        or success_evidence.reason_code<>reason_code
        or c.status<>'completed' or a.status<>'succeeded'
        or c.reporting_adjustment_id is null
        or a.reporting_adjustment_id is distinct from c.reporting_adjustment_id
        or a.completion_message_id is null then
        raise exception 'Success evidence replay conflicts with completed refund' using errcode='P4661';
      end if;
      return jsonb_build_object('resolved',true,'result','provider_confirmed_success',
        'caseCompleted',true,'customerCompletionAvailable',true,
        'providerCallMade',false,'customerMessageCreated',true,
        'customerCompletionMessageId',a.completion_message_id,
        'authorizationMethod','original_manager_approval','replayed',true,
        'payloadRedacted',true);
    end if;
  end if;
  if a.id is null or c.id is null or c.official_action_version<>p_expected_case_version
    or c.status<>'card_refund_pending' or c.decision<>'approved'
    or c.nayax_refund_execution_status<>'ambiguous'
    or a.status not in ('ambiguous','manual_review') or not a.reconciliation_required
    or a.provider_outcome not in ('rejected','timeout','unknown')
    or a.provider_outcome_recorded_at is null
    or approval.id is null or approval.action<>'approve' or approval.status<>'consumed'
    or approval.consumed_at is null or approval.authorization_method<>'manager_session' then
    raise exception 'Exact held System attempt required' using errcode='P4661';
  end if;
  if resolution_result='remain_on_hold' then
    insert into public.refund_case_events(refund_case_id,actor_user_id,event_type,message,metadata)
    values(p_case_id,auth.uid(),'nayax_system_outcome_evidence_recorded',
      'The evidence was recorded and the same attempt remains held for verification.',
      jsonb_build_object('attempt_id',p_attempt_id,'resolution_result','remain_on_hold',
        'evidence_type',evidence_type,'evidence_reference_digest',
          evidence_digest,
        'evidence_reference_present',true,
        'evidence_occurred_at',p_evidence_occurred_at,'reason_code',reason_code,
        'provider_call_made',false,'provider_retry_made',false,'payload_redacted',true));
    return jsonb_build_object('resolved',false,'status','provider_hold',
      'providerCallMade',false,'providerRetryMade',false,'payloadRedacted',true);
  end if;
  if resolution_result='provider_confirmed_no_refund' then
    if p_evidence_occurred_at<a.provider_outcome_recorded_at then
      raise exception 'No-refund evidence predates the held provider outcome' using errcode='P4661';
    end if;
    next_generation:=a.provider_execution_generation+1;
    select case when exists(select 1 from public.refund_nayax_provider_stage_journal j
        where j.nayax_refund_attempt_id=a.id
          and j.provider_execution_generation<=a.provider_execution_generation
          and j.stage='request' and j.event='result' and j.outcome='accepted'
          and j.contract_matched and j.approval_authorized)
      then 'approve_only' else 'request_and_approve' end into next_plan;
    next_idempotency:='nayax-refund-'||encode(extensions.digest(convert_to(
      a.official_action_authorization_id::text||'|'||a.id::text||'|provider-generation|'||
        next_generation::text,'UTF8'),'sha256'),'hex');
    insert into public.refund_nayax_no_refund_proofs(refund_case_id,
      nayax_refund_attempt_id,source_execution_generation,
      continuation_execution_generation,evidence_type,evidence_reference_digest,
      evidence_occurred_at,reason_code,execution_plan,frozen_execution_context_hash,
      prior_provider_outcome,prior_safe_transport_stage,recorded_by)
    values(c.id,a.id,a.provider_execution_generation,next_generation,evidence_type,
      evidence_digest,
      p_evidence_occurred_at,reason_code,next_plan,
      (select context->>'contextHash' from public.refund_nayax_execution_contexts
        where attempt_id=a.id),a.provider_outcome,a.safe_transport_stage,auth.uid());
    update public.refund_case_nayax_refund_attempts set status='created',
      provider_execution_generation=next_generation,execution_plan=next_plan,
      idempotency_key=next_idempotency,
      request_fingerprint=encode(extensions.digest(convert_to(
        next_idempotency||'|'||(select context->>'contextHash'
          from public.refund_nayax_execution_contexts where attempt_id=a.id),
        'UTF8'),'sha256'),'hex'),
      provider_claim_digest=null,provider_claim_expires_at=null,
      provider_claim_consumed_at=null,provider_reference=null,provider_status=null,
      error_code=null,sanitized_response='{}'::jsonb,provider_outcome=null,
      provider_outcome_recorded_at=null,reconciliation_required=false,
      safe_transport_stage='reserved',safe_failure_class=null,completed_at=null
      where id=a.id;
    perform pg_catalog.set_config('bloomjoy.nayax_settlement_attempt_id',a.id::text,true);
    update public.refund_cases set nayax_refund_execution_status='not_requested',
      nayax_match_execution_eligible=false,
      correlation_summary='Exact no-refund evidence was recorded. System will continue the same approved attempt.'
      where id=c.id;
    insert into public.refund_case_events(refund_case_id,actor_user_id,event_type,message,metadata)
    values(c.id,auth.uid(),'nayax_no_refund_evidence_requeued',
      'Exact no-refund evidence was recorded; System will continue the same approved attempt.',
      jsonb_build_object('attempt_id',a.id,'authorization_id',a.official_action_authorization_id,
        'source_execution_generation',a.provider_execution_generation,
        'continuation_execution_generation',next_generation,'execution_plan',next_plan,
        'evidence_type',evidence_type,'evidence_reference_digest',
          evidence_digest,
        'evidence_occurred_at',p_evidence_occurred_at,'reason_code',reason_code,
        'provider_call_made',false,'payload_redacted',true));
    return jsonb_build_object('resolved',false,'status','system_finishing',
      'attemptId',a.id,'authorizationId',a.official_action_authorization_id,
      'providerExecutionGeneration',next_generation,'executionPlan',next_plan,
      'providerCallMade',false,'providerRetryMade',false,'payloadRedacted',true);
  end if;
  if p_evidence_occurred_at<a.provider_outcome_recorded_at then
    raise exception 'Success evidence predates the held provider outcome' using errcode='P4661';
  end if;
  select thread.* into completion_thread from public.refund_gmail_threads thread
    where thread.refund_case_id=c.id order by thread.first_message_at,thread.id
    limit 1 for update;
  if completion_thread.id is null then
    raise exception 'Original Gmail thread required before completing this refund' using errcode='P4661';
  end if;
  if exists(select 1 from public.refund_case_messages message
      where message.refund_case_id=c.id and message.message_type<>'manual_note'
        and (message.status='pending' or message.manual_delivery_state in
          ('queued','claimed','delivery_unknown'))) then
    raise exception 'Settle the existing customer message before confirming this refund'
      using errcode='P4661';
  end if;
  insert into public.refund_nayax_system_success_evidence(refund_case_id,
    nayax_refund_attempt_id,official_action_authorization_id,evidence_type,
    evidence_reference_digest,evidence_occurred_at,reason_code,
    frozen_execution_context_hash,prior_provider_outcome,prior_safe_transport_stage,recorded_by)
  values(c.id,a.id,approval.id,evidence_type,evidence_digest,p_evidence_occurred_at,
    reason_code,(select context->>'contextHash' from public.refund_nayax_execution_contexts
      where attempt_id=a.id),a.provider_outcome,a.safe_transport_stage,auth.uid())
  returning * into success_evidence;
  perform pg_catalog.set_config('bloomjoy.nayax_system_success_evidence_id',
    success_evidence.id::text,true);
  insert into public.sales_adjustment_facts(reporting_machine_id,reporting_location_id,
    adjustment_date,adjustment_type,amount_cents,complaint_count,source,source_row_hash,
    source_reference,source_row_reference,refund_case_id,match_status,match_confidence,
    notes,raw_payload)
  values(c.reporting_machine_id,c.reporting_location_id,
    (p_evidence_occurred_at at time zone 'UTC')::date,'refund',c.refund_amount_cents,1,
    'refund_case',c.id::text,'refund_cases',c.public_reference,c.id,'applied',
    greatest(c.correlation_confidence,0.01),'Bloomjoy refund case '||c.public_reference,
    jsonb_build_object('refund_case_id',c.id,'nayax_provider_attempt_id',a.id,
      'system_success_evidence_id',success_evidence.id,
      'official_action_authorization_id',approval.id,'payload_redacted',true))
  on conflict(source,source_reference,source_row_reference) do update set
    reporting_machine_id=excluded.reporting_machine_id,
    reporting_location_id=excluded.reporting_location_id,
    adjustment_date=excluded.adjustment_date,amount_cents=excluded.amount_cents,
    refund_case_id=excluded.refund_case_id,match_status=excluded.match_status,
    match_confidence=excluded.match_confidence,notes=excluded.notes,
    raw_payload=excluded.raw_payload returning * into adjustment;
  update public.refund_cases set status='completed',decision='approved',
    manual_refund_reference='Provider evidence recorded',
    refund_completed_by=approval.actor_user_id,refund_completed_at=p_evidence_occurred_at,
    automation_state='completed',nayax_refund_execution_status='approved',
    nayax_match_execution_eligible=false,reporting_adjustment_id=adjustment.id where id=c.id;
  update public.refund_case_nayax_refund_attempts set status='succeeded',
    provider_outcome='success',provider_outcome_recorded_at=p_evidence_occurred_at,
    reconciliation_required=false,reporting_adjustment_id=adjustment.id,
    case_finalization_committed_at=statement_timestamp(),completed_at=p_evidence_occurred_at,
    sanitized_response=sanitized_response||jsonb_build_object(
      'system_success_evidence_id',success_evidence.id,
      'initial_provider_outcome',a.provider_outcome,'evidence_reference_present',true,
      'evidence_action_time_present',true,
      'authorization_method','original_manager_approval','payload_redacted',true)
    where id=a.id;
  completion_subject:='Your '||to_char(c.refund_amount_cents::numeric/100,
    'FM$999999990.00')||' Bloomjoy refund is on its way';
  completion_body:=concat_ws(E'\n\n','Hi there,','We issued your '||
    to_char(c.refund_amount_cents::numeric/100,'FM$999999990.00')||' refund'||
    case when c.matched_nayax_card_last4~'^[0-9]{4}$'
      then ' to the card ending in '||c.matched_nayax_card_last4 else '' end||
    ' on '||to_char(p_evidence_occurred_at at time zone 'UTC','Mon FMDD, YYYY')||' UTC.',
    'Your bank or card issuer may take up to 4 business days to show the credit. If it is not visible after that, reply to this email with the reference below. We are sorry this needed a refund, and we appreciate the chance to make it right.',
    'Reference: '||c.public_reference,E'Warmly,\nBloomjoy Sweets');
  insert into public.refund_case_messages(refund_case_id,message_type,status,
    recipient_email,subject,body,template_key,created_by,content_source,delivery_kind,
    template_version,requested_fields,nayax_refund_attempt_id)
  values(c.id,'completed','pending',c.customer_email,completion_subject,completion_body,
    'refund_nayax_completed_v2',approval.actor_user_id,'deterministic_template','manual',
    'refund_nayax_completion_v2','{}'::text[],a.id) returning * into completion_message;
  update public.refund_case_nayax_refund_attempts set
    completion_message_id=completion_message.id,
    completion_gmail_thread_id=completion_thread.id,
    completion_delivery_status='pending',
    completion_delivery_attempted_at=statement_timestamp() where id=a.id;
  insert into public.refund_case_events(refund_case_id,actor_user_id,event_type,message,metadata)
  values(c.id,null,'nayax_support_resolution_completed',
    'Authoritative evidence completed the original manager-approved System attempt.',
    jsonb_build_object('system_success_evidence_id',success_evidence.id,
      'nayax_refund_attempt_id',a.id,'authorization_id',approval.id,
      'recorded_by',auth.uid(),'resolution_result','provider_confirmed_success',
      'reason_code',reason_code,'evidence_type',evidence_type,
      'evidence_reference_digest',evidence_digest,'provider_call_made',false,
      'customer_message_created',true,'payload_redacted',true));
  return jsonb_build_object('resolved',true,'result','provider_confirmed_success',
    'caseCompleted',true,'customerCompletionAvailable',true,
    'providerCallMade',false,'providerRetryMade',false,'customerMessageCreated',true,
    'customerCompletionMessageId',completion_message.id,
    'authorizationMethod','original_manager_approval','replayed',false,
    'payloadRedacted',true);
end;
$$;
revoke all on function public.admin_record_nayax_system_outcome_evidence_v1(
  uuid,uuid,text,text,text,timestamptz,text,bigint) from public,anon,service_role;
grant execute on function public.admin_record_nayax_system_outcome_evidence_v1(
  uuid,uuid,text,text,text,timestamptz,text,bigint) to authenticated;

-- Retire every legacy card writer. Historical tables remain private/readable
-- to trusted server code, but no old approval becomes executable authority.
revoke all on function public.admin_get_refund_external_recovery_options(uuid)
  from public,anon,authenticated,service_role;
revoke all on function public.admin_reconcile_external_refund_and_notice(uuid,jsonb)
  from public,anon,authenticated,service_role;
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
