-- #1341: one refund approval boundary for an assigned Machine Manager or an
-- active Super-admin. Both use the same normalized authority record, the same
-- short-lived receipt, and the same provider reservation path.

alter table public.refund_case_official_action_authorizations
  add column if not exists authority_kind text not null default 'machine_manager',
  add column if not exists super_admin_role_id uuid
    references public.admin_roles(id) on delete restrict,
  alter column manager_mapping_id drop not null,
  alter column manager_mapping_version drop not null;

alter table public.refund_case_official_action_authorizations
  drop constraint if exists refund_official_action_authority_shape_check,
  add constraint refund_official_action_authority_shape_check check (
    (authority_kind = 'machine_manager'
      and manager_mapping_id is not null
      and manager_mapping_version > 0
      and super_admin_role_id is null)
    or
    (authority_kind = 'super_admin'
      and manager_mapping_id is null
      and manager_mapping_version is null
      and super_admin_role_id is not null)
  );

create or replace function public.refund_official_action_authority(
  p_user_id uuid,p_refund_case_id uuid
)
returns jsonb language plpgsql stable security definer set search_path='' as $$
declare
  machine_id uuid;
  authority_record_id uuid;
  authority_version bigint;
begin
  if p_user_id is null or p_refund_case_id is null then return null; end if;
  select c.reporting_machine_id into machine_id
  from public.refund_cases c
  where c.id=p_refund_case_id;
  if machine_id is null then return null; end if;

  select role_row.id,1 into authority_record_id,authority_version
  from public.admin_roles role_row
  where role_row.user_id=p_user_id and role_row.role='super_admin'
    and role_row.active is true
  order by role_row.granted_at desc,role_row.id limit 1;
  if found then
    return jsonb_build_object('kind','super_admin','recordId',authority_record_id,
      'version',authority_version,'machineId',machine_id);
  end if;

  select mapping.id,mapping.mapping_version into authority_record_id,authority_version
  from public.reporting_machine_refund_managers mapping
  where mapping.reporting_machine_id=machine_id and mapping.manager_user_id=p_user_id
    and mapping.status='active' and mapping.revoked_at is null
  order by mapping.mapping_version desc,mapping.id limit 1;
  if not found then return null; end if;
  return jsonb_build_object('kind','machine_manager','recordId',authority_record_id,
    'version',authority_version,'machineId',machine_id);
end;
$$;
revoke all on function public.refund_official_action_authority(uuid,uuid)
  from public,anon,authenticated,service_role;

create or replace function public.can_perform_refund_official_action(
  p_user_id uuid,p_refund_case_id uuid
)
returns boolean language sql stable security definer set search_path='' as $$
  select public.refund_official_action_authority(p_user_id,p_refund_case_id) is not null;
$$;
revoke execute on function public.can_perform_refund_official_action(uuid,uuid)
  from public,anon;
grant execute on function public.can_perform_refund_official_action(uuid,uuid)
  to authenticated,service_role;

create or replace function public.admin_authorize_refund_official_action(
  p_case_id uuid,p_action text,p_expected_case_version bigint,
  p_target_status text default null,p_target_decision text default null,
  p_assigned_manager_email text default null,p_decision_reason text default null,
  p_internal_note text default null,p_refund_amount_cents integer default null,
  p_manual_refund_reference text default null,p_cash_payout_sent_at timestamptz default null,
  p_cash_payment_confirmed boolean default false,
  p_matched_nayax_candidate_token uuid default null,
  p_nayax_disagreement_reason text default null
)
returns jsonb language plpgsql security definer set search_path='' as $$
declare
  actor_user_id uuid:=auth.uid();
  c public.refund_cases%rowtype;
  candidate public.refund_nayax_lookup_candidates%rowtype;
  receipt public.refund_case_official_action_authorizations%rowtype;
  authority jsonb;
  normalized_action text:=lower(btrim(coalesce(p_action,'')));
  normalized_status text:=lower(btrim(coalesce(p_target_status,'')));
  normalized_decision text:=lower(btrim(coalesce(p_target_decision,'')));
  candidate_hash text;
  context_hash text;
begin
  if actor_user_id is null then
    raise exception 'Authenticated manager or Super-admin session required';
  end if;
  perform public.assert_refund_official_action_payload_shape(normalized_action,
    normalized_status,normalized_decision,p_assigned_manager_email,p_decision_reason,
    p_internal_note,p_refund_amount_cents,p_manual_refund_reference,
    p_cash_payout_sent_at,p_cash_payment_confirmed,p_matched_nayax_candidate_token,
    p_nayax_disagreement_reason);
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(
    'refund-manager-action-v2|'||actor_user_id::text||'|'||p_case_id::text,0));
  select * into c from public.refund_cases where id=p_case_id for update;
  if not found then raise exception 'Refund case not found'; end if;
  authority:=public.refund_official_action_authority(actor_user_id,c.id);
  if authority is null then
    raise exception 'An active assigned manager or Super-admin is required for this machine';
  end if;
  if authority->>'kind'='machine_manager' then
    perform 1 from public.reporting_machine_refund_managers mapping
    where mapping.id=(authority->>'recordId')::uuid
      and mapping.reporting_machine_id=c.reporting_machine_id
      and mapping.manager_user_id=actor_user_id
      and mapping.mapping_version=(authority->>'version')::bigint
      and mapping.status='active' and mapping.revoked_at is null for share;
  else
    perform 1 from public.admin_roles role_row
    where role_row.id=(authority->>'recordId')::uuid and role_row.user_id=actor_user_id
      and role_row.role='super_admin' and role_row.active is true for share;
  end if;
  if not found then raise exception 'Manager authority changed before confirmation'; end if;
  if c.official_action_version is distinct from p_expected_case_version then
    raise exception 'Refund case changed since review; reload before taking an official action';
  end if;
  if c.duplicate_of_refund_case_id is not null then
    raise exception 'This refund case is a duplicate; use the canonical case';
  end if;
  if public.refund_case_has_unresolved_reconciliation(c.id) then
    raise exception 'This refund case has an unresolved reconciliation review';
  end if;
  if exists(select 1 from public.refund_gmail_case_link_review_candidates link_candidate
    join public.refund_gmail_case_link_reviews review on review.id=link_candidate.review_id
    where link_candidate.refund_case_id=c.id and review.status='pending') then
    raise exception 'This refund case has a pending email-to-case link review';
  end if;
  if normalized_action='cash_complete' and c.payment_method<>'cash' then
    raise exception 'Cash completion is available only for cash refund cases';
  end if;
  if normalized_action='approve' then
    if c.payment_method='card' and normalized_status<>'card_refund_pending' then
      raise exception 'Card approval must enter the card refund pending state';
    elsif c.payment_method='cash' and normalized_status<>'cash_zelle_pending' then
      raise exception 'Cash approval must enter the cash refund pending state';
    elsif c.payment_method not in ('card','cash') then
      raise exception 'This payment method cannot be approved for a refund';
    end if;
  end if;
  if normalized_action='nayax_execute' then
    raise exception 'Nayax execution authorization is created only by the atomic refund reservation';
  end if;
  if p_matched_nayax_candidate_token is not null then
    if normalized_action<>'approve' or c.payment_method<>'card'
      or normalized_status<>'card_refund_pending' then
      raise exception 'Nayax candidate selection is available only during card approval';
    end if;
    select * into candidate from public.refund_nayax_lookup_candidates
    where token=p_matched_nayax_candidate_token and refund_case_id=c.id
      and actor_user_id=actor_user_id and expires_at>statement_timestamp() for share;
    if not found then
      raise exception 'Nayax lookup evidence expired or belongs to another review session';
    end if;
    candidate_hash:=public.refund_nayax_candidate_evidence_hash(candidate.refund_case_id,
      candidate.actor_user_id,candidate.provider_transaction_id,candidate.site_id,
      candidate.machine_authorization_time,candidate.amount_cents,candidate.card_last4,
      candidate.currency_code,candidate.evidence_summary,candidate.expires_at,candidate.created_at);
  end if;
  context_hash:=public.refund_official_action_context_hash(normalized_action,
    normalized_status,normalized_decision,p_assigned_manager_email,p_decision_reason,
    p_internal_note,p_refund_amount_cents,p_manual_refund_reference,p_cash_payout_sent_at,
    p_cash_payment_confirmed,p_matched_nayax_candidate_token,p_nayax_disagreement_reason,
    candidate_hash);
  insert into public.refund_case_official_action_authorizations(refund_case_id,
    action,actor_user_id,manager_mapping_id,manager_mapping_version,authority_kind,
    super_admin_role_id,expected_case_version,action_context_hash,authorization_method,expires_at)
  values(c.id,normalized_action,actor_user_id,
    case when authority->>'kind'='machine_manager' then (authority->>'recordId')::uuid end,
    case when authority->>'kind'='machine_manager' then (authority->>'version')::bigint end,
    authority->>'kind',case when authority->>'kind'='super_admin'
      then (authority->>'recordId')::uuid end,c.official_action_version,context_hash,
    'manager_session',statement_timestamp()+interval '90 seconds') returning * into receipt;
  insert into public.refund_case_events(refund_case_id,actor_user_id,event_type,message,metadata)
  values(c.id,actor_user_id,'official_action_authorized',
    'An authorized manager confirmed this exact action.',jsonb_build_object(
      'action',normalized_action,'authority_kind',authority->>'kind',
      'authority_record_id',authority->>'recordId','payload_redacted',true));
  return jsonb_build_object('authorizationId',receipt.id,'action',receipt.action,
    'expectedCaseVersion',receipt.expected_case_version,'authorityKind',authority->>'kind',
    'authorityVersion',(authority->>'version')::bigint,'expiresAt',receipt.expires_at,
    'authorizationMethod','manager_session');
end;
$$;
revoke execute on function public.admin_authorize_refund_official_action(
  uuid,text,bigint,text,text,text,text,text,integer,text,timestamptz,boolean,uuid,text
) from public,anon,service_role;
grant execute on function public.admin_authorize_refund_official_action(
  uuid,text,bigint,text,text,text,text,text,integer,text,timestamptz,boolean,uuid,text
) to authenticated;

create or replace function public.consume_refund_official_action_authorization(
  p_authorization_id uuid,p_case_id uuid,p_action text,p_target_status text,
  p_target_decision text,p_assigned_manager_email text,p_decision_reason text,
  p_internal_note text,p_refund_amount_cents integer,p_manual_refund_reference text,
  p_cash_payout_sent_at timestamptz,p_cash_payment_confirmed boolean,
  p_matched_nayax_candidate_token uuid,p_nayax_disagreement_reason text
)
returns jsonb language plpgsql security definer set search_path='' as $$
declare
  receipt public.refund_case_official_action_authorizations%rowtype;
  c public.refund_cases%rowtype;
  candidate public.refund_nayax_lookup_candidates%rowtype;
  authority jsonb;
  normalized_action text:=lower(btrim(coalesce(p_action,'')));
  candidate_hash text;
  expected_hash text;
begin
  select * into receipt from public.refund_case_official_action_authorizations
  where id=p_authorization_id for update;
  if not found then raise exception 'Official action authorization not found'; end if;
  if receipt.status<>'authorized' or receipt.consumed_at is not null then
    raise exception 'Official action authorization was already used';
  end if;
  if receipt.expires_at<=statement_timestamp() then raise exception 'Official action authorization expired'; end if;
  if receipt.refund_case_id is distinct from p_case_id or receipt.action is distinct from normalized_action then
    raise exception 'Official action authorization does not match this request';
  end if;
  perform public.assert_refund_official_action_payload_shape(normalized_action,p_target_status,
    p_target_decision,p_assigned_manager_email,p_decision_reason,p_internal_note,
    p_refund_amount_cents,p_manual_refund_reference,p_cash_payout_sent_at,
    p_cash_payment_confirmed,p_matched_nayax_candidate_token,p_nayax_disagreement_reason);
  select * into c from public.refund_cases where id=receipt.refund_case_id for update;
  if not found or c.official_action_version is distinct from receipt.expected_case_version then
    raise exception 'Refund case changed since authorization; reload before taking an official action';
  end if;
  authority:=public.refund_official_action_authority(receipt.actor_user_id,c.id);
  if authority is null or authority->>'kind' is distinct from receipt.authority_kind
    or (authority->>'recordId')::uuid is distinct from coalesce(
      receipt.manager_mapping_id,receipt.super_admin_role_id)
    or (receipt.authority_kind='machine_manager' and
      (authority->>'version')::bigint is distinct from receipt.manager_mapping_version) then
    raise exception 'Manager authority changed before the official action';
  end if;
  if receipt.authority_kind='machine_manager' then
    perform 1 from public.reporting_machine_refund_managers mapping
    where mapping.id=receipt.manager_mapping_id and mapping.reporting_machine_id=c.reporting_machine_id
      and mapping.manager_user_id=receipt.actor_user_id
      and mapping.mapping_version=receipt.manager_mapping_version
      and mapping.status='active' and mapping.revoked_at is null for share;
  else
    perform 1 from public.admin_roles role_row where role_row.id=receipt.super_admin_role_id
      and role_row.user_id=receipt.actor_user_id and role_row.role='super_admin'
      and role_row.active is true for share;
  end if;
  if not found then raise exception 'Manager authority changed before the official action'; end if;
  if p_matched_nayax_candidate_token is not null then
    select * into candidate from public.refund_nayax_lookup_candidates
    where token=p_matched_nayax_candidate_token and refund_case_id=p_case_id
      and actor_user_id=receipt.actor_user_id and expires_at>statement_timestamp() for share;
    if not found then raise exception 'Nayax lookup evidence expired or belongs to another review session'; end if;
    candidate_hash:=public.refund_nayax_candidate_evidence_hash(candidate.refund_case_id,
      candidate.actor_user_id,candidate.provider_transaction_id,candidate.site_id,
      candidate.machine_authorization_time,candidate.amount_cents,candidate.card_last4,
      candidate.currency_code,candidate.evidence_summary,candidate.expires_at,candidate.created_at);
  end if;
  expected_hash:=public.refund_official_action_context_hash(normalized_action,p_target_status,
    p_target_decision,p_assigned_manager_email,p_decision_reason,p_internal_note,
    p_refund_amount_cents,p_manual_refund_reference,p_cash_payout_sent_at,
    p_cash_payment_confirmed,p_matched_nayax_candidate_token,p_nayax_disagreement_reason,
    candidate_hash);
  if receipt.action_context_hash is distinct from expected_hash then
    raise exception 'Official action authorization payload changed';
  end if;
  update public.refund_case_official_action_authorizations set status='consumed',
    consumed_at=statement_timestamp() where id=receipt.id;
  return jsonb_build_object('actorUserId',receipt.actor_user_id,
    'authorityKind',receipt.authority_kind,
    'authorityRecordId',coalesce(receipt.manager_mapping_id,receipt.super_admin_role_id),
    'authorityVersion',coalesce(receipt.manager_mapping_version,1),
    'expectedCaseVersion',receipt.expected_case_version,'action',receipt.action);
end;
$$;
revoke all on function public.consume_refund_official_action_authorization(
  uuid,uuid,text,text,text,text,text,text,integer,text,timestamptz,boolean,uuid,text
) from public,anon,authenticated,service_role;

create or replace function public.service_reserve_nayax_refund_manager_action(
  p_executor_assertion text,p_actor_user_id uuid,p_case_id uuid,
  p_expected_case_version bigint,p_idempotency_key text,p_amount_cents integer,
  p_daily_amount_cap_cents integer,p_daily_count_cap integer,p_currency_code text default 'USD'
)
returns jsonb language plpgsql security definer set search_path='' as $$
declare
  c public.refund_cases%rowtype;
  machine public.reporting_machines%rowtype;
  existing public.refund_case_nayax_refund_attempts%rowtype;
  receipt public.refund_case_official_action_authorizations%rowtype;
  authority jsonb;
  context_hash text;
  evidence_hash text;
  authorized_at timestamptz:=statement_timestamp();
begin
  perform public.assert_nayax_provider_executor(p_executor_assertion);
  if p_actor_user_id is null or p_case_id is null then
    raise exception 'Authenticated manager and refund case are required';
  end if;
  if p_idempotency_key!~'^nayax-refund-[a-f0-9]{64}$' then raise exception 'Invalid Nayax idempotency key'; end if;
  if p_amount_cents is null or p_amount_cents<=0 then raise exception 'Positive Nayax refund amount required'; end if;
  if upper(btrim(coalesce(p_currency_code,'')))<>'USD' then raise exception 'Only exact USD Nayax refund context is supported'; end if;
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(
    'refund-nayax-manager-session-v2|'||p_actor_user_id::text||'|'||p_case_id::text,0));
  select * into c from public.refund_cases where id=p_case_id for update;
  if not found then raise exception 'Refund case not found'; end if;
  authority:=public.refund_official_action_authority(p_actor_user_id,c.id);
  if authority is null then
    raise exception 'An active assigned manager or Super-admin is required for this machine';
  end if;
  if authority->>'kind'='machine_manager' then
    perform 1 from public.reporting_machine_refund_managers mapping
    where mapping.id=(authority->>'recordId')::uuid
      and mapping.reporting_machine_id=c.reporting_machine_id
      and mapping.manager_user_id=p_actor_user_id
      and mapping.mapping_version=(authority->>'version')::bigint
      and mapping.status='active' and mapping.revoked_at is null for share;
  else
    perform 1 from public.admin_roles role_row
    where role_row.id=(authority->>'recordId')::uuid and role_row.user_id=p_actor_user_id
      and role_row.role='super_admin' and role_row.active is true for share;
  end if;
  if not found then raise exception 'Manager authority changed before confirmation'; end if;
  select * into existing from public.refund_case_nayax_refund_attempts
  where idempotency_key=p_idempotency_key for update;
  if found then
    if existing.refund_case_id is distinct from c.id or existing.actor_user_id is distinct from p_actor_user_id
      or existing.amount_cents is distinct from p_amount_cents or existing.currency_code is distinct from 'USD' then
      raise exception 'Nayax idempotency key is bound to different immutable context';
    end if;
    return public.refund_nayax_attempt_reservation_payload(existing.id,false,null);
  end if;
  if c.official_action_version is distinct from p_expected_case_version then
    raise exception 'Refund case changed since review; reload before refunding';
  end if;
  if c.duplicate_of_refund_case_id is not null then
    raise exception 'This refund case is a duplicate; use the canonical case';
  end if;
  if public.refund_case_has_unresolved_reconciliation(c.id) then
    raise exception 'This refund case has an unresolved reconciliation review';
  end if;
  if exists(select 1 from public.refund_gmail_case_link_review_candidates link_candidate
    join public.refund_gmail_case_link_reviews review on review.id=link_candidate.review_id
    where link_candidate.refund_case_id=c.id and review.status='pending') then
    raise exception 'This refund case has a pending email-to-case link review';
  end if;
  select * into machine from public.reporting_machines where id=c.reporting_machine_id for share;
  if not found or machine.status<>'active' or nullif(btrim(machine.nayax_machine_id),'') is null
    or machine.nayax_refunds_enabled is distinct from true then
    raise exception 'Nayax refunds are not enabled for this machine';
  end if;
  if c.payment_method<>'card' or c.status not in ('needs_review','correlated','approved','card_refund_pending')
    or (c.decision is not null and c.decision<>'approved') or c.correlation_status<>'matched'
    or c.correlation_source<>'nayax' or c.nayax_recommendation_policy_version is null
    or not public.is_review_safe_nayax_transaction_reference(c.matched_nayax_transaction_id)
    or c.matched_nayax_site_id is null or c.matched_nayax_machine_auth_time is null
    or c.matched_nayax_currency_code<>'USD' or c.refund_amount_cents is distinct from p_amount_cents
    or c.matched_nayax_amount_cents is distinct from p_amount_cents or c.reporting_adjustment_id is not null
    or c.nayax_refund_execution_status<>'not_requested'
    or not exists(select 1 from public.refund_case_events event_row
      where event_row.refund_case_id=c.id and event_row.event_type='nayax_match_selected'
        and event_row.actor_user_id is not null) then
    raise exception 'The selected Nayax transaction is not ready for refund';
  end if;
  if machine.nayax_refund_max_amount_cents is not null
    and p_amount_cents>machine.nayax_refund_max_amount_cents then
    raise exception 'Nayax refund amount exceeds the machine limit';
  end if;
  if exists(select 1 from public.refund_cases duplicate_case
    where duplicate_case.id<>c.id
      and duplicate_case.matched_nayax_transaction_id=c.matched_nayax_transaction_id) then
    raise exception 'This Nayax transaction is already linked to another refund case';
  end if;
  update public.refund_cases set status='card_refund_pending',decision='approved',
    decided_by=p_actor_user_id,decided_at=coalesce(decided_at,authorized_at) where id=c.id;
  select * into c from public.refund_cases where id=p_case_id for update;
  context_hash:=public.refund_official_action_context_hash('nayax_execute','card_refund_pending',
    'approved',null,null,null,p_amount_cents,null,null,false,null,null,null);
  evidence_hash:=public.refund_nayax_execution_evidence_hash(c,machine);
  insert into public.refund_case_official_action_authorizations(refund_case_id,
    action,actor_user_id,manager_mapping_id,manager_mapping_version,authority_kind,
    super_admin_role_id,expected_case_version,action_context_hash,status,expires_at,
    step_up_intent_id,verified_totp_at,nayax_execution_evidence_hash,authorization_method)
  values(c.id,'nayax_execute',p_actor_user_id,
    case when authority->>'kind'='machine_manager' then (authority->>'recordId')::uuid end,
    case when authority->>'kind'='machine_manager' then (authority->>'version')::bigint end,
    authority->>'kind',case when authority->>'kind'='super_admin'
      then (authority->>'recordId')::uuid end,c.official_action_version,context_hash,
    'authorized',authorized_at+interval '30 seconds',null,null,evidence_hash,'manager_session')
  returning * into receipt;
  insert into public.refund_case_events(refund_case_id,actor_user_id,event_type,message,metadata)
  values(c.id,p_actor_user_id,'official_action_committed',
    'An authorized manager approved this exact Nayax refund.',jsonb_build_object(
      'action','nayax_execute','authority_kind',authority->>'kind',
      'authority_record_id',authority->>'recordId','payload_redacted',true));
  return public.service_reserve_and_consume_nayax_refund_attempt_v2(
    p_executor_assertion,receipt.id,c.id,p_idempotency_key,p_amount_cents,
    p_daily_amount_cap_cents,p_daily_count_cap,'USD');
end;
$$;
revoke execute on function public.service_reserve_nayax_refund_manager_action(
  text,uuid,uuid,bigint,text,integer,integer,integer,text
) from public,anon,authenticated;
grant execute on function public.service_reserve_nayax_refund_manager_action(
  text,uuid,uuid,bigint,text,integer,integer,integer,text
) to service_role;

create or replace function public.service_reserve_and_consume_nayax_refund_attempt(
  p_executor_assertion text,p_authorization_id uuid,p_case_id uuid,
  p_idempotency_key text,p_amount_cents integer,p_currency_code text default 'USD'
)
returns jsonb language plpgsql security definer set search_path='' as $$
declare
  attempt_row public.refund_case_nayax_refund_attempts%rowtype;
  receipt public.refund_case_official_action_authorizations%rowtype;
  c public.refund_cases%rowtype;
  consumed jsonb;
  request_fingerprint text;
  provider_claim_token text;
  provider_claim_digest text;
begin
  perform public.assert_nayax_provider_executor(p_executor_assertion);
  if p_authorization_id is null or p_case_id is null then raise exception 'Exact Nayax authorization and case are required'; end if;
  if p_idempotency_key!~'^nayax-refund-[a-f0-9]{64}$' then raise exception 'Invalid Nayax idempotency key'; end if;
  if p_amount_cents is null or p_amount_cents<=0 then raise exception 'Positive Nayax refund amount required'; end if;
  if upper(btrim(coalesce(p_currency_code,'')))<>'USD' then raise exception 'Only exact USD Nayax refund context is supported'; end if;
  select * into attempt_row from public.refund_case_nayax_refund_attempts
  where idempotency_key=p_idempotency_key for update;
  if found then
    select * into receipt from public.refund_case_official_action_authorizations
    where id=p_authorization_id for share;
    if not found then raise exception 'Bound Nayax authorization not found'; end if;
    request_fingerprint:=public.refund_nayax_attempt_request_fingerprint(
      p_authorization_id,p_case_id,p_idempotency_key,p_amount_cents,'USD',
      receipt.nayax_execution_evidence_hash);
    if attempt_row.official_action_authorization_id is distinct from p_authorization_id
      or attempt_row.refund_case_id is distinct from p_case_id
      or attempt_row.amount_cents is distinct from p_amount_cents
      or attempt_row.currency_code is distinct from 'USD'
      or attempt_row.request_fingerprint is distinct from request_fingerprint then
      raise exception 'Nayax idempotency key is bound to different immutable context';
    end if;
    return public.refund_nayax_attempt_reservation_payload(attempt_row.id,false,null);
  end if;
  select * into receipt from public.refund_case_official_action_authorizations
  where id=p_authorization_id for update;
  if not found or receipt.refund_case_id is distinct from p_case_id
    or receipt.action<>'nayax_execute' or receipt.status<>'authorized'
    or receipt.consumed_at is not null or receipt.authorization_method<>'manager_session'
    or receipt.step_up_intent_id is not null or receipt.verified_totp_at is not null
    or receipt.nayax_execution_evidence_hash is null then
    raise exception 'Fresh manager confirmation receipt required';
  end if;
  select * into c from public.refund_cases where id=p_case_id for update;
  if not found then raise exception 'Refund case not found'; end if;
  select * into attempt_row from public.refund_case_nayax_refund_attempts
  where idempotency_key=p_idempotency_key for update;
  if found then
    if attempt_row.official_action_authorization_id is distinct from p_authorization_id
      or attempt_row.refund_case_id is distinct from p_case_id
      or attempt_row.amount_cents is distinct from p_amount_cents
      or attempt_row.currency_code is distinct from 'USD' then
      raise exception 'Nayax idempotency key is bound to different immutable context';
    end if;
    return public.refund_nayax_attempt_reservation_payload(attempt_row.id,false,null);
  end if;
  consumed:=public.service_consume_nayax_refund_official_action(p_authorization_id,
    p_case_id,'card_refund_pending','approved',p_amount_cents,null);
  select * into receipt from public.refund_case_official_action_authorizations
  where id=p_authorization_id for update;
  if receipt.status<>'consumed' or receipt.consumed_at is null
    or (consumed->>'actorUserId')::uuid is distinct from receipt.actor_user_id
    or consumed->>'action'<>'nayax_execute' then
    raise exception 'Consumed manager confirmation was not preserved';
  end if;
  request_fingerprint:=public.refund_nayax_attempt_request_fingerprint(
    p_authorization_id,p_case_id,p_idempotency_key,p_amount_cents,'USD',
    receipt.nayax_execution_evidence_hash);
  provider_claim_token:=encode(extensions.gen_random_bytes(32),'hex');
  provider_claim_digest:=encode(extensions.digest(convert_to(provider_claim_token,'UTF8'),'sha256'),'hex');
  insert into public.refund_case_nayax_refund_attempts(refund_case_id,actor_user_id,
    execution_mode,status,idempotency_key,amount_cents,transaction_id_present,
    site_id_present,machine_auth_time_present,sanitized_request,sanitized_response,
    official_action_authorization_id,step_up_intent_id,request_fingerprint,currency_code,
    provider_claim_digest,provider_claim_expires_at,reconciliation_required)
  values(p_case_id,receipt.actor_user_id,'request_and_approve','in_progress',p_idempotency_key,
    p_amount_cents,c.matched_nayax_transaction_id is not null,c.matched_nayax_site_id is not null,
    c.matched_nayax_machine_auth_time is not null,jsonb_build_object(
      'request_fingerprint',request_fingerprint,'amount_cents',p_amount_cents,
      'currency_code','USD','transaction_id_present',c.matched_nayax_transaction_id is not null,
      'site_id_present',c.matched_nayax_site_id is not null,
      'machine_authorization_time_present',c.matched_nayax_machine_auth_time is not null,
      'payload_redacted',true),'{}'::jsonb,p_authorization_id,null,request_fingerprint,
    'USD',provider_claim_digest,statement_timestamp()+interval '15 minutes',true)
  returning * into attempt_row;
  perform pg_catalog.set_config('bloomjoy.nayax_settlement_attempt_id',attempt_row.id::text,true);
  update public.refund_cases set nayax_refund_execution_status='requested',
    nayax_match_execution_eligible=false where id=p_case_id;
  insert into public.refund_case_events(refund_case_id,actor_user_id,event_type,message,metadata)
  values(p_case_id,receipt.actor_user_id,'nayax_provider_attempt_reserved',
    'The manager-approved Nayax provider attempt was reserved exactly once.',jsonb_build_object(
      'attempt_id',attempt_row.id,'authorization_id',receipt.id,
      'provider_claim_present',true,'payload_redacted',true));
  return public.refund_nayax_attempt_reservation_payload(attempt_row.id,true,provider_claim_token);
end;
$$;
revoke execute on function public.service_reserve_and_consume_nayax_refund_attempt(
  text,uuid,uuid,text,integer,text
) from public,anon,authenticated,service_role;

alter table public.refund_case_nayax_refund_attempts
  drop constraint if exists refund_nayax_attempt_bound_lifecycle_check,
  add constraint refund_nayax_attempt_bound_lifecycle_check check (
    official_action_authorization_id is null or (
      request_fingerprint is not null and provider_claim_digest is not null
      and provider_claim_expires_at is not null
      and ((provider_outcome is null and provider_outcome_recorded_at is null)
        or (provider_outcome is not null and provider_outcome_recorded_at is not null))
      and (provider_outcome='success' or reporting_adjustment_id is null)
      and (case_finalization_committed_at is null or (
        provider_outcome='success' and reporting_adjustment_id is not null
        and status='succeeded'))
    )
  );

create or replace function public.refund_nayax_attempt_reservation_payload(
  p_attempt_id uuid,p_should_execute boolean,p_provider_claim_token text default null
)
returns jsonb language sql stable security definer set search_path='' as $$
  select jsonb_build_object('managerAction',jsonb_build_object(
    'authorizationId',receipt.id,'caseId',receipt.refund_case_id,
    'action',receipt.action,'targetFunction','nayax-card-refund',
    'status',receipt.status,'authorizationMethod',receipt.authorization_method,
    'authorityKind',receipt.authority_kind,'authorizedAt',receipt.created_at),
    'attempt',public.refund_nayax_attempt_snapshot(attempt.id,p_should_execute),
    'providerClaimToken',p_provider_claim_token)
  from public.refund_case_nayax_refund_attempts attempt
  join public.refund_case_official_action_authorizations receipt
    on receipt.id=attempt.official_action_authorization_id
  where attempt.id=p_attempt_id;
$$;
revoke all on function public.refund_nayax_attempt_reservation_payload(uuid,boolean,text)
  from public,anon,authenticated,service_role;

-- The settlement and completion guards predate manager-session confirmation
-- and assumed every receipt had a TOTP step-up row. Replace only those exact
-- legacy predicates; all provider-claim, case, transaction, amount and outcome
-- checks remain unchanged.
do $$
declare
  body text;
  anchor text;
  replacement text;
begin
  body:=replace(pg_get_functiondef(
    'public.service_settle_nayax_refund_attempt_pre_definitive_retry_v1(text,uuid,uuid,uuid,text,integer,text,text,text,text,text,text)'::regprocedure),E'\r\n',E'\n');
  anchor:=$old$  intent_row public.refund_manager_action_step_up_intents%rowtype;
$old$;
  if length(body)-length(replace(body,anchor,''))<>length(anchor) then
    raise exception 'Exact settlement intent declaration required';
  end if;
  body:=replace(body,anchor,'');
  anchor:=$old$  select intent.*
  into intent_row
  from public.refund_manager_action_step_up_intents intent
  where intent.id = authorization_row.step_up_intent_id
  for share;

$old$;
  if length(body)-length(replace(body,anchor,''))<>length(anchor) then
    raise exception 'Exact settlement intent lookup required';
  end if;
  body:=replace(body,anchor,'');
  anchor:=$old$    or authorization_row.verified_totp_at is null
    or authorization_row.nayax_execution_evidence_hash is null
    or intent_row.id is null
    or intent_row.status is distinct from 'consumed'
    or intent_row.action is distinct from 'nayax_execute'
    or intent_row.target_function is distinct from 'nayax-card-refund'
    or intent_row.refund_case_id is distinct from p_case_id
    or intent_row.actor_user_id is distinct from authorization_row.actor_user_id
    or intent_row.verified_totp_at is null
    or intent_row.verified_totp_at is distinct from authorization_row.verified_totp_at
    or intent_row.nayax_execution_evidence_hash is distinct from
      authorization_row.nayax_execution_evidence_hash then
    raise exception 'Consumed manager/TOTP evidence is not valid for settlement';$old$;
  replacement:=$new$    or authorization_row.authorization_method is distinct from 'manager_session'
    or authorization_row.step_up_intent_id is not null
    or authorization_row.verified_totp_at is not null
    or authorization_row.nayax_execution_evidence_hash is null then
    raise exception 'Consumed manager confirmation is not valid for settlement';$new$;
  if length(body)-length(replace(body,anchor,''))<>length(anchor) then
    raise exception 'Exact settlement verification predicate required';
  end if;
  execute replace(body,anchor,replacement);

  body:=replace(pg_get_functiondef(
    'public.guard_refund_case_active_nayax_attempt()'::regprocedure),E'\r\n',E'\n');
  anchor:=$old$        join public.refund_manager_action_step_up_intents intent
          on intent.id = attempt.step_up_intent_id
$old$;
  if length(body)-length(replace(body,anchor,''))<>length(anchor) then
    raise exception 'Exact completion guard intent join required';
  end if;
  body:=replace(body,anchor,'');
  anchor:=$old$          and action_authorization.verified_totp_at is not null
          and intent.status = 'consumed'
          and intent.target_function = 'nayax-card-refund'
          and intent.verified_totp_at = action_authorization.verified_totp_at
$old$;
  replacement:=$new$          and action_authorization.authorization_method = 'manager_session'
          and action_authorization.step_up_intent_id is null
          and action_authorization.verified_totp_at is null
$new$;
  if length(body)-length(replace(body,anchor,''))<>length(anchor) then
    raise exception 'Exact completion guard verification predicate required';
  end if;
  execute replace(body,anchor,replacement);

  body:=replace(pg_get_functiondef(
    'public.refund_nayax_unsettled_api_success_journal_proved(uuid,uuid)'::regprocedure),E'\r\n',E'\n');
  anchor:=$old$    join public.refund_manager_action_step_up_intents intent
      on intent.id = attempt.step_up_intent_id
      and intent.id = authz.step_up_intent_id
$old$;
  if length(body)-length(replace(body,anchor,''))<>length(anchor) then
    raise exception 'Exact journal recovery intent join required';
  end if;
  body:=replace(body,anchor,'');
  anchor:=$old$      and authz.verified_totp_at is not null
      and authz.nayax_execution_evidence_hash ~ '^[a-f0-9]{64}$'
      and intent.status = 'consumed'
      and intent.action = 'nayax_execute'
      and intent.target_function = 'nayax-card-refund'
      and intent.refund_case_id = refund_case.id
      and intent.actor_user_id = authz.actor_user_id
      and intent.verified_totp_at = authz.verified_totp_at
      and intent.nayax_execution_evidence_hash = authz.nayax_execution_evidence_hash
$old$;
  replacement:=$new$      and authz.authorization_method = 'manager_session'
      and authz.step_up_intent_id is null
      and authz.verified_totp_at is null
      and authz.nayax_execution_evidence_hash ~ '^[a-f0-9]{64}$'
$new$;
  if length(body)-length(replace(body,anchor,''))<>length(anchor) then
    raise exception 'Exact journal recovery receipt predicate required';
  end if;
  execute replace(body,anchor,replacement);
end;
$$;

create or replace function public.refund_receipt_verified_api_attempt(
  p_case_id uuid,p_attempt_id uuid
)
returns boolean language sql stable security definer set search_path='' as $$
  select exists(
    select 1 from public.refund_case_nayax_refund_attempts attempt
    join public.refund_cases c on c.id=attempt.refund_case_id
    join public.reporting_machines machine on machine.id=c.reporting_machine_id
    join public.refund_nayax_execution_contexts saved on saved.attempt_id=attempt.id
    cross join lateral jsonb_to_record(saved.context) as context(
      "caseId" uuid,"reportingMachineId" uuid,"attemptGeneration" integer,
      "accountScope" text,"providerMachineId" text,"transactionId" text,
      "siteId" integer,"originalAmountCents" integer,"currencyCode" text)
    join public.refund_case_official_action_authorizations receipt
      on receipt.id=attempt.official_action_authorization_id
    where attempt.id=p_attempt_id and c.id=p_case_id
      and attempt.execution_mode='request_and_approve'
      and attempt.status in ('manual_review','ambiguous','failed','declined')
      and attempt.provider_outcome in ('unknown','timeout','rejected')
      and attempt.support_resolution_id is null and attempt.reporting_adjustment_id is null
      and attempt.case_finalization_committed_at is null
      and attempt.provider_claim_consumed_at is not null
      and context."caseId"=c.id and context."reportingMachineId"=machine.id
      and context."attemptGeneration"=c.nayax_refund_attempt_generation
      and context."accountScope"=machine.nayax_account_key
      and context."providerMachineId"=machine.nayax_machine_id
      and context."transactionId"=c.matched_nayax_transaction_id
      and context."siteId"=c.matched_nayax_site_id
      and context."originalAmountCents"=c.matched_nayax_amount_cents
      and context."originalAmountCents"=c.refund_amount_cents
      and context."originalAmountCents"=attempt.amount_cents
      and context."currencyCode"=c.matched_nayax_currency_code
      and context."currencyCode"=attempt.currency_code
      and receipt.refund_case_id=c.id and receipt.action='nayax_execute'
      and receipt.status='consumed' and receipt.actor_user_id=attempt.actor_user_id
      and receipt.authorization_method='manager_session'
      and receipt.step_up_intent_id is null and receipt.verified_totp_at is null
      and ((receipt.authority_kind='machine_manager' and exists(
        select 1 from public.reporting_machine_refund_managers mapping
        where mapping.id=receipt.manager_mapping_id
          and mapping.reporting_machine_id=machine.id
          and mapping.manager_user_id=receipt.actor_user_id))
        or (receipt.authority_kind='super_admin' and exists(
          select 1 from public.admin_roles role_row
          where role_row.id=receipt.super_admin_role_id
            and role_row.user_id=receipt.actor_user_id and role_row.role='super_admin')))
      and attempt.step_up_intent_id is null
      and attempt.request_fingerprint=public.refund_nayax_attempt_request_fingerprint(
        receipt.id,c.id,attempt.idempotency_key,attempt.amount_cents,
        attempt.currency_code,receipt.nayax_execution_evidence_hash)
      and exists(select 1 from public.refund_nayax_provider_stage_journal journal
        where journal.nayax_refund_attempt_id=attempt.id
          and journal.stage='request' and journal.event='started'));
$$;
revoke all on function public.refund_receipt_verified_api_attempt(uuid,uuid)
  from public,anon,authenticated,service_role;

-- Recovery continues the immutable attempt that the manager already approved.
-- Validate the exact authority record stored on that receipt; do not ask a
-- second manager to approve or fabricate a replacement mapping.
create or replace function public.refund_official_action_receipt_authority_valid(
  p_authorization_id uuid,p_reporting_machine_id uuid
)
returns boolean language sql stable security definer set search_path='' as $$
  select exists(
    select 1 from public.refund_case_official_action_authorizations receipt
    where receipt.id=p_authorization_id
      and ((receipt.authority_kind='machine_manager' and exists(
        select 1 from public.reporting_machine_refund_managers mapping
        where mapping.id=receipt.manager_mapping_id
          and mapping.reporting_machine_id=p_reporting_machine_id
          and mapping.manager_user_id=receipt.actor_user_id
          and mapping.mapping_version>=receipt.manager_mapping_version))
        or (receipt.authority_kind='super_admin' and exists(
          select 1 from public.admin_roles role_row
          where role_row.id=receipt.super_admin_role_id
            and role_row.user_id=receipt.actor_user_id
            and role_row.role='super_admin')))
  );
$$;
revoke all on function public.refund_official_action_receipt_authority_valid(uuid,uuid)
  from public,anon,authenticated,service_role;

-- The interactive continuation is still available to either currently
-- authorized manager role, but it preserves the original approval receipt.
do $$
declare body text; anchor text; replacement text;
begin
  body:=replace(pg_get_functiondef(
    'public.refund_nayax_approval_continuation_ready_v1(uuid,uuid)'::regprocedure),E'\r\n',E'\n');
  anchor:=$old$  join public.reporting_machine_refund_managers original_manager_mapping
    on original_manager_mapping.id = action_authorization.manager_mapping_id
  join public.reporting_machine_refund_managers current_manager_mapping
    on current_manager_mapping.reporting_machine_id = refund_case.reporting_machine_id
    and current_manager_mapping.manager_user_id = p_user_id
    and current_manager_mapping.status = 'active'
    and current_manager_mapping.revoked_at is null
$old$;
  if length(body)-length(replace(body,anchor,''))<>length(anchor) then
    raise exception 'Exact continuation manager joins required';
  end if;
  body:=replace(body,anchor,'');
  anchor:=$old$    and original_manager_mapping.reporting_machine_id = refund_case.reporting_machine_id
    and original_manager_mapping.manager_user_id = action_authorization.actor_user_id
    and original_manager_mapping.mapping_version >= action_authorization.manager_mapping_version
    and current_manager_mapping.reporting_machine_id = refund_case.reporting_machine_id
    and public.can_perform_refund_official_action(p_user_id, refund_case.id)
$old$;
  replacement:=$new$    and public.refund_official_action_receipt_authority_valid(
      action_authorization.id, refund_case.reporting_machine_id
    )
    and public.can_perform_refund_official_action(p_user_id, refund_case.id)
$new$;
  if length(body)-length(replace(body,anchor,''))<>length(anchor) then
    raise exception 'Exact continuation manager predicates required';
  end if;
  execute replace(body,anchor,replacement);

  body:=replace(pg_get_functiondef(
    'public.service_reserve_nayax_refund_approval_continuation_v1(text,uuid,uuid,bigint,text,integer,text,text,text)'::regprocedure),E'\r\n',E'\n');
  anchor:=$old$  original_mapping_row public.reporting_machine_refund_managers%rowtype;
  current_mapping_row public.reporting_machine_refund_managers%rowtype;
$old$;
  if length(body)-length(replace(body,anchor,''))<>length(anchor) then
    raise exception 'Exact interactive continuation mapping declarations required';
  end if;
  body:=replace(body,anchor,'');
  anchor:=$old$  select * into strict original_mapping_row
  from public.reporting_machine_refund_managers
  where id = authorization_row.manager_mapping_id for share;
  select * into current_mapping_row
  from public.reporting_machine_refund_managers
  where reporting_machine_id = case_row.reporting_machine_id
    and manager_user_id = p_actor_user_id
    and status = 'active'
    and revoked_at is null
  for share;
  if not found
    or not public.can_perform_refund_official_action(p_actor_user_id, case_row.id) then
    raise exception 'Current Machine Manager authority is required for continuation'
      using errcode = 'P4628';
  end if;
$old$;
  replacement:=$new$  if not public.can_perform_refund_official_action(p_actor_user_id, case_row.id) then
    raise exception 'Assigned Machine Manager or Super-admin authority is required for continuation'
      using errcode = 'P4628';
  end if;
$new$;
  if length(body)-length(replace(body,anchor,''))<>length(anchor) then
    raise exception 'Exact interactive continuation mapping lookups required';
  end if;
  body:=replace(body,anchor,replacement);
  anchor:=$old$    or original_mapping_row.reporting_machine_id is distinct from case_row.reporting_machine_id
    or original_mapping_row.manager_user_id is distinct from authorization_row.actor_user_id
    or original_mapping_row.mapping_version < authorization_row.manager_mapping_version
    or current_mapping_row.reporting_machine_id is distinct from case_row.reporting_machine_id
    or current_mapping_row.manager_user_id is distinct from p_actor_user_id
    or current_mapping_row.status is distinct from 'active'
    or current_mapping_row.revoked_at is not null
$old$;
  replacement:=$new$    or not public.refund_official_action_receipt_authority_valid(
      authorization_row.id, case_row.reporting_machine_id
    )
$new$;
  if length(body)-length(replace(body,anchor,''))<>length(anchor) then
    raise exception 'Exact interactive continuation mapping predicates required';
  end if;
  body:=replace(body,anchor,replacement);
  body:=replace(body,'Selected Nayax purchase or current manager authority changed',
    'Selected Nayax purchase or manager authority changed');
  execute body;
end;
$$;

-- A service continuation is the System finishing the approval stage of the
-- already-approved immutable attempt. Remove the redundant current-manager
-- columns and checks; the claim remains bound to the original receipt, case,
-- execution-context hash, and single-use provider claim.
alter table public.refund_nayax_server_approval_continuation_claims
  drop column current_manager_mapping_id,
  drop column current_manager_mapping_version;

do $$
declare body text; anchor text; replacement text;
begin
  body:=replace(pg_get_functiondef(
    'public.service_claim_due_nayax_approval_continuations_v1(text,text,integer)'::regprocedure),E'\r\n',E'\n');
  anchor:=$old$      original_mapping.id as original_mapping_id,
      original_mapping.mapping_version as original_mapping_version,
      current_mapping.id as current_mapping_id,
      current_mapping.manager_user_id as current_manager_user_id,
      current_mapping.mapping_version as current_mapping_version,
$old$;
  if length(body)-length(replace(body,anchor,''))<>length(anchor) then
    raise exception 'Exact server continuation mapping fields required';
  end if;
  body:=replace(body,anchor,'');
  anchor:=$old$    join public.reporting_machine_refund_managers original_mapping
      on original_mapping.id = authz.manager_mapping_id
$old$;
  if length(body)-length(replace(body,anchor,''))<>length(anchor) then
    raise exception 'Exact server continuation original mapping join required';
  end if;
  body:=replace(body,anchor,'');
  anchor:=$old$    join lateral (
      select mapping.*
      from public.reporting_machine_refund_managers mapping
      where mapping.reporting_machine_id = refund_case.reporting_machine_id
        and mapping.status = 'active'
        and mapping.revoked_at is null
      order by mapping.mapping_version desc, mapping.id
      limit 1
    ) current_mapping on true
$old$;
  if length(body)-length(replace(body,anchor,''))<>length(anchor) then
    raise exception 'Exact server continuation current mapping join required';
  end if;
  body:=replace(body,anchor,'');
  anchor:=$old$      and original_mapping.reporting_machine_id = refund_case.reporting_machine_id
      and original_mapping.manager_user_id = authz.actor_user_id
      and original_mapping.mapping_version >= authz.manager_mapping_version
      and public.can_perform_refund_official_action(
        current_mapping.manager_user_id,
        refund_case.id
      )
$old$;
  replacement:=$new$      and public.refund_official_action_receipt_authority_valid(
        authz.id, refund_case.reporting_machine_id
      )
$new$;
  if length(body)-length(replace(body,anchor,''))<>length(anchor) then
    raise exception 'Exact server continuation mapping predicates required';
  end if;
  body:=replace(body,anchor,replacement);
  body:=replace(body,'      candidate.current_manager_user_id,',
    '      candidate.approving_actor_user_id,');
  anchor:=$old$      official_action_authorization_id,
      current_manager_mapping_id,
      current_manager_mapping_version,
      execution_context_hash,
$old$;
  replacement:=$new$      official_action_authorization_id,
      execution_context_hash,
$new$;
  if length(body)-length(replace(body,anchor,''))<>length(anchor) then
    raise exception 'Exact server continuation claim columns required';
  end if;
  body:=replace(body,anchor,replacement);
  anchor:=$old$      candidate.official_action_authorization_id,
      candidate.current_mapping_id,
      candidate.current_mapping_version,
      candidate.frozen_context ->> 'contextHash',
$old$;
  replacement:=$new$      candidate.official_action_authorization_id,
      candidate.frozen_context ->> 'contextHash',
$new$;
  if length(body)-length(replace(body,anchor,''))<>length(anchor) then
    raise exception 'Exact server continuation claim values required';
  end if;
  body:=replace(body,anchor,replacement);
  body:=replace(body,E'      ''currentManagerMappingId'', candidate.current_mapping_id,\n      ''currentManagerMappingVersion'', candidate.current_mapping_version,\n','');
  execute body;

  body:=replace(pg_get_functiondef(
    'public.guard_refund_nayax_execution_context_stage()'::regprocedure),E'\r\n',E'\n');
  anchor:=$old$      join public.reporting_machine_refund_managers current_mapping
        on current_mapping.reporting_machine_id = case_row.reporting_machine_id
        and current_mapping.manager_user_id = continuation.actor_user_id
        and current_mapping.status = 'active'
        and current_mapping.revoked_at is null
$old$;
  if length(body)-length(replace(body,anchor,''))<>length(anchor) then
    raise exception 'Exact continuation guard mapping join required';
  end if;
  body:=replace(body,anchor,'');
  anchor:=$old$        and public.can_perform_refund_official_action(
          continuation.actor_user_id,
          case_row.id
        )
$old$;
  replacement:=$new$        and public.refund_official_action_receipt_authority_valid(
          continuation.official_action_authorization_id,
          case_row.reporting_machine_id
        )
$new$;
  if length(body)-length(replace(body,anchor,''))<>length(anchor) then
    raise exception 'Exact continuation guard manager predicate required';
  end if;
  body:=replace(body,anchor,replacement);
  anchor:=$old$              and server_claim.current_manager_mapping_id = current_mapping.id
              and server_claim.current_manager_mapping_version =
                current_mapping.mapping_version
$old$;
  if length(body)-length(replace(body,anchor,''))<>length(anchor) then
    raise exception 'Exact continuation guard server mapping predicates required';
  end if;
  execute replace(body,anchor,'');
end;
$$;

comment on function public.refund_nayax_approval_continuation_ready_v1(uuid,uuid) is
  'Checks whether an authorized Machine Manager or Super-admin can continue only the approval stage of one unchanged, already-approved Nayax attempt.';
comment on function public.service_reserve_nayax_refund_approval_continuation_v1(
  text,uuid,uuid,bigint,text,integer,text,text,text
) is
  'Lets an authorized Machine Manager or Super-admin continue only the approval stage of one unchanged, already-approved Nayax attempt. It never creates or repeats the refund request.';
comment on table public.refund_nayax_server_approval_continuation_claims is
  'Immutable System claim for finishing only the approval stage of one already-approved Nayax attempt. The claim is bound to the original receipt and cannot repeat the refund request.';

-- Historical manual-portal attempts remain readable for audit evidence, but the
-- former second approval lane is no longer executable by any application role.
revoke execute on function public.admin_begin_refund_manual_nayax_portal(uuid,bigint)
  from public,anon,authenticated,service_role;

select pg_notify('pgrst','reload schema');
