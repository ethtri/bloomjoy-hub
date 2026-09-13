-- #1341: one refund approval boundary for an assigned Machine Manager or an
-- active Super-admin. Both use the same normalized authority record, the same
-- short-lived receipt, and the same provider reservation path.

alter table public.refund_case_official_action_authorizations
  add column if not exists authority_kind text not null default 'machine_manager',
  add column if not exists super_admin_role_id uuid
    references public.admin_roles(id) on delete restrict,
  add column if not exists selected_nayax_candidate_token uuid
    references public.refund_nayax_lookup_candidates(token) on delete restrict,
  add column if not exists selected_nayax_candidate_evidence_hash text check (
    selected_nayax_candidate_evidence_hash is null
    or selected_nayax_candidate_evidence_hash~'^[a-f0-9]{64}$'
  ),
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
  ),
  add constraint refund_official_action_selected_nayax_evidence_shape_check check (
    (selected_nayax_candidate_token is null
      and selected_nayax_candidate_evidence_hash is null)
    or
    (action='approve'
      and selected_nayax_candidate_token is not null
      and selected_nayax_candidate_evidence_hash is not null)
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
  select public.refund_official_action_authority(p_user_id,p_refund_case_id) is not null
    and exists(select 1 from public.refund_cases refund_case
      where refund_case.id=p_refund_case_id
        and refund_case.duplicate_of_refund_case_id is null
        and not public.refund_case_has_unresolved_reconciliation(refund_case.id)
        and not exists(select 1
          from public.refund_gmail_case_link_review_candidates link_candidate
          join public.refund_gmail_case_link_reviews link_review
            on link_review.id=link_candidate.review_id
          where link_candidate.refund_case_id=refund_case.id
            and link_review.status='pending')
        and not exists(select 1 from public.refund_authoritative_receipts receipt
          where receipt.refund_case_id=refund_case.id));
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
  authenticated_actor_user_id uuid:=auth.uid();
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
  if authenticated_actor_user_id is null then
    raise exception 'Authenticated manager or Super-admin session required';
  end if;
  perform public.assert_refund_official_action_payload_shape(normalized_action,
    normalized_status,normalized_decision,p_assigned_manager_email,p_decision_reason,
    p_internal_note,p_refund_amount_cents,p_manual_refund_reference,
    p_cash_payout_sent_at,p_cash_payment_confirmed,p_matched_nayax_candidate_token,
    p_nayax_disagreement_reason);
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(
    'refund-manager-action-v2|'||authenticated_actor_user_id::text||'|'||p_case_id::text,0));
  select * into c from public.refund_cases where id=p_case_id for update;
  if not found then raise exception 'Refund case not found'; end if;
  authority:=public.refund_official_action_authority(authenticated_actor_user_id,c.id);
  if authority is null then
    raise exception 'An active assigned manager or Super-admin is required for this machine';
  end if;
  if authority->>'kind'='machine_manager' then
    perform 1 from public.reporting_machine_refund_managers mapping
    where mapping.id=(authority->>'recordId')::uuid
      and mapping.reporting_machine_id=c.reporting_machine_id
      and mapping.manager_user_id=authenticated_actor_user_id
      and mapping.mapping_version=(authority->>'version')::bigint
      and mapping.status='active' and mapping.revoked_at is null for share;
  else
    perform 1 from public.admin_roles role_row
    where role_row.id=(authority->>'recordId')::uuid and role_row.user_id=authenticated_actor_user_id
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
    select lookup_candidate.* into candidate
    from public.refund_nayax_lookup_candidates lookup_candidate
    where lookup_candidate.token=p_matched_nayax_candidate_token
      and lookup_candidate.refund_case_id=c.id
      and (
        (lookup_candidate.actor_user_id=authenticated_actor_user_id
          and lookup_candidate.expires_at>statement_timestamp())
        or (
          lookup_candidate.lookup_generation=c.nayax_lookup_generation
          and lookup_candidate.reporting_machine_id=c.reporting_machine_id
          and lookup_candidate.provider_transaction_id
            is not distinct from c.matched_nayax_transaction_id
          and lookup_candidate.site_id is not distinct from c.matched_nayax_site_id
          and lookup_candidate.machine_authorization_time
            is not distinct from c.matched_nayax_machine_auth_time
          and lookup_candidate.amount_cents is not distinct from c.matched_nayax_amount_cents
          and lookup_candidate.card_last4 is not distinct from c.matched_nayax_card_last4
          and lookup_candidate.currency_code is not distinct from c.matched_nayax_currency_code
          and lookup_candidate.evidence_summary->>'selection_allowed'='true'
          and public.refund_nayax_candidate_identifier_evidence_state(
            lookup_candidate.refund_case_id,lookup_candidate.reporting_machine_id,
            lookup_candidate.site_id,lookup_candidate.machine_authorization_time,
            lookup_candidate.amount_cents,lookup_candidate.card_last4,
            lookup_candidate.currency_code,lookup_candidate.evidence_summary)='valid'
          and exists(select 1 from public.refund_case_events selection_marker
            where selection_marker.refund_case_id=c.id
              and selection_marker.event_type='nayax_match_selected'
              and selection_marker.actor_user_id=lookup_candidate.actor_user_id
              and selection_marker.created_at>=lookup_candidate.created_at
              and selection_marker.metadata->>'payload_redacted'='true')
        )
      )
    for share;
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
    super_admin_role_id,expected_case_version,action_context_hash,authorization_method,expires_at,
    selected_nayax_candidate_token,selected_nayax_candidate_evidence_hash)
  values(c.id,normalized_action,authenticated_actor_user_id,
    case when authority->>'kind'='machine_manager' then (authority->>'recordId')::uuid end,
    case when authority->>'kind'='machine_manager' then (authority->>'version')::bigint end,
    authority->>'kind',case when authority->>'kind'='super_admin'
      then (authority->>'recordId')::uuid end,c.official_action_version,context_hash,
    'manager_session',statement_timestamp()+interval '90 seconds',
    p_matched_nayax_candidate_token,candidate_hash) returning * into receipt;
  insert into public.refund_case_events(refund_case_id,actor_user_id,event_type,message,metadata)
  values(c.id,authenticated_actor_user_id,'official_action_authorized',
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
  if not found then
    raise exception 'Refund case changed since authorization; reload before taking an official action';
  end if;
  if normalized_action='nayax_execute' then
    if c.official_action_version is distinct from receipt.expected_case_version+1
      or c.status is distinct from 'card_refund_pending'
      or c.decision is distinct from 'approved'
      or c.decided_by is distinct from receipt.actor_user_id
      or c.refund_amount_cents is distinct from p_refund_amount_cents then
      raise exception 'Refund case changed outside the exact authorized Nayax transition; review again';
    end if;
  elsif c.official_action_version is distinct from receipt.expected_case_version then
    raise exception 'Refund case changed since authorization; reload before taking an official action';
  end if;
  -- Authority is checked once, when this immutable receipt is created.  From
  -- here onward the System validates the receipt's exact case, version, actor,
  -- payload, transaction evidence and single-use state without consulting a
  -- live assignment, role or browser session again.
  if p_matched_nayax_candidate_token is not null then
    select lookup_candidate.* into candidate
    from public.refund_nayax_lookup_candidates lookup_candidate
    where lookup_candidate.token=p_matched_nayax_candidate_token
      and lookup_candidate.refund_case_id=p_case_id
      and (
        (lookup_candidate.actor_user_id=receipt.actor_user_id
          and lookup_candidate.expires_at>statement_timestamp())
        or (
          lookup_candidate.lookup_generation=c.nayax_lookup_generation
          and lookup_candidate.reporting_machine_id=c.reporting_machine_id
          and lookup_candidate.provider_transaction_id
            is not distinct from c.matched_nayax_transaction_id
          and lookup_candidate.site_id is not distinct from c.matched_nayax_site_id
          and lookup_candidate.machine_authorization_time
            is not distinct from c.matched_nayax_machine_auth_time
          and lookup_candidate.amount_cents is not distinct from c.matched_nayax_amount_cents
          and lookup_candidate.card_last4 is not distinct from c.matched_nayax_card_last4
          and lookup_candidate.currency_code is not distinct from c.matched_nayax_currency_code
          and lookup_candidate.evidence_summary->>'selection_allowed'='true'
          and public.refund_nayax_candidate_identifier_evidence_state(
            lookup_candidate.refund_case_id,lookup_candidate.reporting_machine_id,
            lookup_candidate.site_id,lookup_candidate.machine_authorization_time,
            lookup_candidate.amount_cents,lookup_candidate.card_last4,
            lookup_candidate.currency_code,lookup_candidate.evidence_summary)='valid'
          and exists(select 1 from public.refund_case_events selection_marker
            where selection_marker.refund_case_id=c.id
              and selection_marker.event_type='nayax_match_selected'
              and selection_marker.actor_user_id=lookup_candidate.actor_user_id
              and selection_marker.created_at>=lookup_candidate.created_at
              and selection_marker.metadata->>'payload_redacted'='true')
        )
      ) for share;
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
      then (authority->>'recordId')::uuid end,p_expected_case_version,context_hash,
    'authorized',authorized_at+interval '30 seconds',null,null,evidence_hash,'manager_session')
  returning * into receipt;
  insert into public.refund_case_events(refund_case_id,actor_user_id,event_type,message,metadata)
  values(c.id,p_actor_user_id,'official_action_committed',
    'An authorized manager approved this exact Nayax refund.',jsonb_build_object(
      'action','nayax_execute','authority_kind',authority->>'kind',
      'authority_record_id',authority->>'recordId','payload_redacted',true));
  -- Daily caps are retained only in the compatibility signature. The single
  -- manager decision is bound to the exact case/transaction/amount and is not
  -- blocked by a separate retired operations cap.
  return public.service_reserve_and_consume_nayax_refund_attempt(
    p_executor_assertion,receipt.id,c.id,p_idempotency_key,p_amount_cents,'USD');
end;
$$;
revoke execute on function public.service_reserve_nayax_refund_manager_action(
  text,uuid,uuid,bigint,text,integer,integer,integer,text
) from public,anon,authenticated;
grant execute on function public.service_reserve_nayax_refund_manager_action(
  text,uuid,uuid,bigint,text,integer,integer,integer,text
) to service_role;

-- Every production v3/v4/v5 wrapper ultimately reaches this named boundary.
-- Define it explicitly against the single-manager implementation so the live
-- Edge path cannot depend on a rename-time legacy body.
create or replace function public.service_reserve_nayax_refund_manager_action_pre_context_v1(
  p_executor_assertion text,p_actor_user_id uuid,p_case_id uuid,
  p_expected_case_version bigint,p_idempotency_key text,p_amount_cents integer,
  p_daily_amount_cap_cents integer,p_daily_count_cap integer,p_currency_code text,
  p_provider_contract_version text,p_journal_contract_version text
)
returns jsonb language plpgsql security definer set search_path='' as $$
begin
  perform public.assert_nayax_provider_executor(p_executor_assertion);
  if btrim(coalesce(p_journal_contract_version,''))<>'nayax-provider-journal-v3'
    or btrim(coalesce(p_provider_contract_version,''))<>
      'nayax-production-account-contract-v2' then
    raise exception 'Nayax provider journal contract version mismatch'
      using errcode='P4611';
  end if;
  perform pg_catalog.set_config('bloomjoy.nayax_journal_contract_version',
    p_journal_contract_version,true);
  return public.service_reserve_nayax_refund_manager_action(
    p_executor_assertion,p_actor_user_id,p_case_id,p_expected_case_version,
    p_idempotency_key,p_amount_cents,p_daily_amount_cap_cents,
    p_daily_count_cap,p_currency_code);
end;
$$;
revoke all on function public.service_reserve_nayax_refund_manager_action_pre_context_v1(
  text,uuid,uuid,bigint,text,integer,integer,integer,text,text,text
) from public,anon,authenticated,service_role;

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
      execution_mode='evidence_only'
      and status='manual_review'
      and provider_claim_digest is null
      and provider_claim_expires_at is null
      and provider_outcome='unknown'
      and provider_outcome_recorded_at is not null
      and reconciliation_required is true
      and reporting_adjustment_id is null
      and case_finalization_committed_at is null
    ) or (
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
create or replace function public.service_settle_nayax_refund_attempt_pre_definitive_retry_v1(
  p_executor_assertion text,
  p_attempt_id uuid,
  p_authorization_id uuid,
  p_case_id uuid,
  p_idempotency_key text,
  p_amount_cents integer,
  p_currency_code text,
  p_provider_claim_token text,
  p_provider_outcome text,
  p_provider_reference text default null,
  p_provider_status text default null,
  p_error_code text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  attempt_row public.refund_case_nayax_refund_attempts%rowtype;
  authorization_row public.refund_case_official_action_authorizations%rowtype;
  case_row public.refund_cases%rowtype;
  adjustment_row public.sales_adjustment_facts%rowtype;
  expected_fingerprint text;
  normalized_outcome text := lower(btrim(coalesce(p_provider_outcome, '')));
  normalized_reference text := nullif(btrim(coalesce(p_provider_reference, '')), '');
  normalized_provider_status text := nullif(btrim(coalesce(p_provider_status, '')), '');
  normalized_error_code text := nullif(btrim(coalesce(p_error_code, '')), '');
  settled_at timestamptz := statement_timestamp();
  update_applied boolean := false;
begin
  perform public.assert_nayax_provider_executor(p_executor_assertion);

  if p_attempt_id is null or p_authorization_id is null or p_case_id is null then
    raise exception 'Exact Nayax attempt, authorization, and case are required';
  end if;
  if p_idempotency_key !~ '^nayax-refund-[a-f0-9]{64}$'
    or p_amount_cents is null
    or p_amount_cents <= 0
    or upper(btrim(coalesce(p_currency_code, ''))) <> 'USD' then
    raise exception 'Exact immutable Nayax request context is required';
  end if;
  if normalized_outcome not in ('success', 'rejected', 'timeout', 'unknown') then
    raise exception 'Unsupported Nayax provider outcome';
  end if;
  if normalized_reference is not null
    and normalized_reference !~ '^[A-Za-z0-9][A-Za-z0-9._:-]{5,119}$' then
    raise exception 'Provider reference is not safe to persist';
  end if;
  if normalized_outcome = 'success' and normalized_reference is null then
    raise exception 'Confirmed provider success requires a safe provider reference';
  end if;
  if normalized_provider_status is not null
    and normalized_provider_status !~ '^[A-Za-z0-9][A-Za-z0-9._:-]{0,119}$' then
    raise exception 'Provider status is not safe to persist';
  end if;
  if normalized_error_code is not null
    and normalized_error_code !~ '^[A-Za-z0-9][A-Za-z0-9._:-]{0,119}$' then
    raise exception 'Provider error code is not safe to persist';
  end if;

  select attempt.*
  into attempt_row
  from public.refund_case_nayax_refund_attempts attempt
  where attempt.id = p_attempt_id
  for update;

  if not found then
    raise exception 'Nayax provider attempt not found';
  end if;

  select action_authorization.*
  into authorization_row
  from public.refund_case_official_action_authorizations action_authorization
  where action_authorization.id = p_authorization_id
  for share;

  select refund_case.*
  into case_row
  from public.refund_cases refund_case
  where refund_case.id = p_case_id
  for update;

  expected_fingerprint := public.refund_nayax_attempt_request_fingerprint(
    p_authorization_id,
    p_case_id,
    p_idempotency_key,
    p_amount_cents,
    'USD',
    authorization_row.nayax_execution_evidence_hash
  );

  if attempt_row.official_action_authorization_id is distinct from p_authorization_id
    or attempt_row.step_up_intent_id is distinct from authorization_row.step_up_intent_id
    or attempt_row.refund_case_id is distinct from p_case_id
    or attempt_row.idempotency_key is distinct from p_idempotency_key
    or attempt_row.amount_cents is distinct from p_amount_cents
    or attempt_row.currency_code is distinct from 'USD'
    or attempt_row.request_fingerprint is distinct from expected_fingerprint then
    raise exception 'Provider claim does not match immutable Nayax request context';
  end if;

  if authorization_row.status is distinct from 'consumed'
    or authorization_row.consumed_at is null
    or authorization_row.action is distinct from 'nayax_execute'
    or authorization_row.refund_case_id is distinct from p_case_id
    or authorization_row.authorization_method is distinct from 'manager_session'
    or authorization_row.step_up_intent_id is not null
    or authorization_row.verified_totp_at is not null
    or authorization_row.nayax_execution_evidence_hash is null then
    raise exception 'Consumed manager confirmation is not valid for settlement';
  end if;

  if attempt_row.status is distinct from 'in_progress'
    or attempt_row.provider_outcome is not null
    or attempt_row.provider_outcome_recorded_at is not null then
    raise exception 'Nayax provider attempt is already terminal';
  end if;
  if attempt_row.provider_claim_consumed_at is not null
    or attempt_row.provider_claim_expires_at <= settled_at
    or nullif(p_provider_claim_token, '') is null
    or attempt_row.provider_claim_digest is distinct from encode(
      extensions.digest(
        convert_to(p_provider_claim_token, 'UTF8'),
        'sha256'
      ),
      'hex'
    ) then
    raise exception 'Valid unused attempt-scoped provider claim required';
  end if;
  if case_row.id is null
    or case_row.nayax_refund_execution_status is distinct from 'requested'
    or case_row.nayax_match_execution_eligible is distinct from false
    or case_row.decision is distinct from 'approved'
    or case_row.status not in ('approved', 'card_refund_pending')
    or case_row.refund_amount_cents is distinct from p_amount_cents
    or case_row.reporting_adjustment_id is not null then
    raise exception 'Refund case changed while the provider attempt was active';
  end if;

  perform set_config(
    'bloomjoy.nayax_settlement_attempt_id',
    attempt_row.id::text,
    true
  );
  perform set_config(
    'bloomjoy.nayax_settlement_provider_claim',
    p_provider_claim_token,
    true
  );

  if normalized_outcome = 'success' then
    update public.refund_cases
    set
      status = 'completed',
      decision = 'approved',
      manual_refund_reference = normalized_reference,
      refund_completed_by = authorization_row.actor_user_id,
      refund_completed_at = settled_at,
      automation_state = 'completed',
      nayax_refund_execution_status = 'approved',
      nayax_match_execution_eligible = false
    where id = case_row.id;

    insert into public.sales_adjustment_facts (
      reporting_machine_id,
      reporting_location_id,
      adjustment_date,
      adjustment_type,
      amount_cents,
      complaint_count,
      source,
      source_row_hash,
      source_reference,
      source_row_reference,
      refund_case_id,
      match_status,
      match_confidence,
      notes,
      raw_payload
    ) values (
      case_row.reporting_machine_id,
      case_row.reporting_location_id,
      settled_at::date,
      'refund',
      p_amount_cents,
      1,
      'refund_case',
      case_row.id::text,
      'refund_cases',
      case_row.public_reference,
      case_row.id,
      'applied',
      greatest(case_row.correlation_confidence, 0.01),
      'Bloomjoy refund case ' || case_row.public_reference,
      jsonb_build_object(
        'refund_case_id', case_row.id,
        'refund_case_reference', case_row.public_reference,
        'refund_case_status', 'completed',
        'refund_case_decision', 'approved',
        'payment_method', case_row.payment_method,
        'correlation_source', case_row.correlation_source,
        'correlation_has_card_lookup', true,
        'nayax_provider_attempt_id', attempt_row.id,
        'provider_reference_present', true,
        'payload_redacted', true
      )
    )
    on conflict (source, source_reference, source_row_reference)
    do update set
      reporting_machine_id = excluded.reporting_machine_id,
      reporting_location_id = excluded.reporting_location_id,
      adjustment_date = excluded.adjustment_date,
      amount_cents = excluded.amount_cents,
      refund_case_id = excluded.refund_case_id,
      match_status = excluded.match_status,
      match_confidence = excluded.match_confidence,
      notes = excluded.notes,
      raw_payload = excluded.raw_payload
    returning * into adjustment_row;

    update public.refund_cases
    set reporting_adjustment_id = adjustment_row.id
    where id = case_row.id;

    update public.refund_case_nayax_refund_attempts
    set
      status = 'succeeded',
      provider_reference = normalized_reference,
      provider_status = coalesce(normalized_provider_status, 'approved'),
      error_code = null,
      sanitized_response = jsonb_build_object(
        'provider_outcome', 'success',
        'provider_reference_present', true,
        'payload_redacted', true
      ),
      provider_claim_consumed_at = settled_at,
      provider_outcome = 'success',
      provider_outcome_recorded_at = settled_at,
      reconciliation_required = false,
      reporting_adjustment_id = adjustment_row.id,
      case_finalization_committed_at = settled_at,
      completed_at = settled_at
    where id = attempt_row.id
    returning * into attempt_row;

    update_applied := true;
  elsif normalized_outcome = 'rejected' then
    update public.refund_cases
    set
      nayax_refund_execution_status = 'declined',
      nayax_match_execution_eligible = false
    where id = case_row.id;

    update public.refund_case_nayax_refund_attempts
    set
      status = 'declined',
      provider_reference = normalized_reference,
      provider_status = normalized_provider_status,
      error_code = coalesce(normalized_error_code, 'provider_rejected'),
      sanitized_response = jsonb_build_object(
        'provider_outcome', 'rejected',
        'provider_reference_present', normalized_reference is not null,
        'payload_redacted', true
      ),
      provider_claim_consumed_at = settled_at,
      provider_outcome = 'rejected',
      provider_outcome_recorded_at = settled_at,
      reconciliation_required = false,
      completed_at = settled_at
    where id = attempt_row.id
    returning * into attempt_row;
  else
    update public.refund_cases
    set
      nayax_refund_execution_status = 'ambiguous',
      nayax_match_execution_eligible = false
    where id = case_row.id;

    update public.refund_case_nayax_refund_attempts
    set
      status = 'ambiguous',
      provider_reference = normalized_reference,
      provider_status = normalized_provider_status,
      error_code = coalesce(
        normalized_error_code,
        case normalized_outcome
          when 'timeout' then 'provider_timeout'
          else 'provider_outcome_unknown'
        end
      ),
      sanitized_response = jsonb_build_object(
        'provider_outcome', normalized_outcome,
        'provider_reference_present', normalized_reference is not null,
        'payload_redacted', true
      ),
      provider_claim_consumed_at = settled_at,
      provider_outcome = normalized_outcome,
      provider_outcome_recorded_at = settled_at,
      reconciliation_required = true,
      completed_at = settled_at
    where id = attempt_row.id
    returning * into attempt_row;
  end if;

  insert into public.refund_case_events (
    refund_case_id,
    actor_user_id,
    event_type,
    message,
    metadata
  ) values (
    p_case_id,
    authorization_row.actor_user_id,
    case
      when normalized_outcome = 'success' then 'nayax_official_action_finalized'
      else 'nayax_provider_outcome_recorded'
    end,
    case
      when normalized_outcome = 'success'
        then 'The manager-authorized Nayax refund and reporting adjustment committed atomically.'
      when normalized_outcome = 'rejected'
        then 'Nayax rejected the refund; the case remains open for manager review.'
      else 'The Nayax outcome is held for reconciliation; no retry or fallback was issued.'
    end,
    jsonb_build_object(
      'attempt_id', attempt_row.id,
      'authorization_id', authorization_row.id,
      'provider_outcome', normalized_outcome,
      'provider_reference_present', normalized_reference is not null,
      'reporting_adjustment_present', adjustment_row.id is not null,
      'reconciliation_required', attempt_row.reconciliation_required,
      'payload_redacted', true
    )
  );

  return jsonb_build_object(
    'attempt', public.refund_nayax_attempt_snapshot(attempt_row.id, false),
    'updateApplied', update_applied,
    'reportingAdjustmentPresent', attempt_row.reporting_adjustment_id is not null
  );
end;
$$;
revoke all on function public.service_settle_nayax_refund_attempt_pre_definitive_retry_v1(
  text,uuid,uuid,uuid,text,integer,text,text,text,text,text,text
) from public,anon,authenticated,service_role;

create or replace function public.guard_refund_case_active_nayax_attempt()
returns trigger language plpgsql set search_path=public as $$
declare
  settlement_attempt_id uuid;
  settlement_provider_claim text;
  settlement_provider_claim_digest text;
  resolution_id uuid:=nullif(current_setting(
    'bloomjoy.nayax_support_resolution_id',true),'')::uuid;
  interruption_attempt_id uuid:=nullif(current_setting(
    'bloomjoy.nayax_interruption_recovery_attempt_id',true),'')::uuid;
  database_owner text;
  resolver_owner text;
  recovery_owner text;
  exact_completion_resolution boolean:=false;
  exact_interruption_recovery boolean:=false;
begin
  if public.refund_journal_duplicate_recovery_case_change_allowed(
    to_jsonb(old),to_jsonb(new)) then return new; end if;
  if public.refund_terminal_receipt_case_change_allowed(
    to_jsonb(old),to_jsonb(new)) then return new; end if;
  select pg_get_userbyid(database.datdba) into database_owner
  from pg_database database where database.datname=current_database();
  if resolution_id is not null then
    select pg_get_userbyid(procedure.proowner) into resolver_owner
    from pg_proc procedure where procedure.oid=
      'public.admin_consume_refund_nayax_resolution_intent(uuid,uuid,uuid,text,text,text,timestamptz,text,text)'::regprocedure;
    select exists(select 1 from public.refund_nayax_outcome_resolutions resolution
      where resolution.id=resolution_id and resolution.refund_case_id=old.id
        and resolution.resolution_result in(
          'provider_confirmed_success','documented_manual_completion'))
      and current_user=database_owner and current_user=resolver_owner
    into exact_completion_resolution;
  end if;
  if interruption_attempt_id is not null then
    select pg_get_userbyid(procedure.proowner) into recovery_owner
    from pg_proc procedure where procedure.oid=
      'public.service_recover_stale_nayax_refund_attempts(text)'::regprocedure;
    select exists(select 1 from public.refund_case_nayax_refund_attempts attempt
      where attempt.id=interruption_attempt_id and attempt.refund_case_id=old.id
        and attempt.provider_claim_consumed_at is not null
        and ((attempt.status='failed' and attempt.provider_outcome is null
          and attempt.reconciliation_required is false
          and attempt.safe_transport_stage='released_no_call'
          and new.status='needs_review' and new.decision is null
          and new.nayax_refund_execution_status='not_requested')
        or (attempt.status='manual_review' and attempt.provider_outcome='unknown'
          and attempt.reconciliation_required is true
          and attempt.safe_transport_stage='confirmation_hold'
          and new.status='card_refund_pending' and new.decision='approved'
          and new.nayax_refund_execution_status='manual_review')))
      and current_user=database_owner and recovery_owner=database_owner
    into exact_interruption_recovery;
  end if;
  settlement_provider_claim:=nullif(current_setting(
    'bloomjoy.nayax_settlement_provider_claim',true),'');
  settlement_provider_claim_digest:=case when settlement_provider_claim is null
    then null else encode(extensions.digest(convert_to(
      settlement_provider_claim,'UTF8'),'sha256'),'hex') end;
  if new.payment_method='card' and new.status='completed'
    and old.status is distinct from 'completed' and not exact_completion_resolution then
    settlement_attempt_id:=nullif(current_setting(
      'bloomjoy.nayax_settlement_attempt_id',true),'')::uuid;
    if settlement_attempt_id is null or settlement_provider_claim_digest is null
      or old.nayax_refund_execution_status is distinct from 'requested'
      or not exists(select 1
        from public.refund_case_nayax_refund_attempts attempt
        join public.refund_case_official_action_authorizations action_authorization
          on action_authorization.id=attempt.official_action_authorization_id
        where attempt.id=settlement_attempt_id and attempt.refund_case_id=old.id
          and attempt.status='in_progress' and attempt.provider_outcome is null
          and attempt.provider_claim_consumed_at is null
          and attempt.provider_claim_expires_at>statement_timestamp()
          and attempt.provider_claim_digest=settlement_provider_claim_digest
          and (action_authorization.status='consumed'
              and action_authorization.authorization_method='manager_session'
              and action_authorization.step_up_intent_id is null
              and action_authorization.verified_totp_at is null)
            ) then
      raise exception 'Card completion requires token-bound confirmed provider settlement';
    end if;
  end if;
  if old.nayax_refund_execution_status='requested'
    and row(old.status,old.decision,old.refund_amount_cents,
      old.manual_refund_reference,old.refund_completed_by,
      old.refund_completed_at,old.reporting_adjustment_id,
      old.nayax_refund_execution_status)
      is distinct from row(new.status,new.decision,new.refund_amount_cents,
      new.manual_refund_reference,new.refund_completed_by,
      new.refund_completed_at,new.reporting_adjustment_id,
      new.nayax_refund_execution_status)
    and not exact_interruption_recovery then
    settlement_attempt_id:=nullif(current_setting(
      'bloomjoy.nayax_settlement_attempt_id',true),'')::uuid;
    if settlement_attempt_id is null or settlement_provider_claim_digest is null
      or not exists(select 1 from public.refund_case_nayax_refund_attempts attempt
        where attempt.id=settlement_attempt_id and attempt.refund_case_id=old.id
          and attempt.status='in_progress' and attempt.provider_outcome is null
          and attempt.provider_claim_consumed_at is null
          and attempt.provider_claim_expires_at>statement_timestamp()
          and attempt.provider_claim_digest=settlement_provider_claim_digest) then
      raise exception 'An active Nayax provider attempt must settle before another official mutation';
    end if;
  end if;
  return new;
end;
$$;
revoke all on function public.guard_refund_case_active_nayax_attempt()
  from public,anon,authenticated,service_role;
create or replace function public.refund_nayax_unsettled_api_success_journal_proved(
  p_case_id uuid,
  p_attempt_id uuid
)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.refund_cases refund_case
    join public.reporting_machines machine
      on machine.id = refund_case.reporting_machine_id
    join public.refund_case_nayax_refund_attempts attempt
      on attempt.id = p_attempt_id
      and attempt.refund_case_id = refund_case.id
    join public.refund_case_official_action_authorizations authz
      on authz.id = attempt.official_action_authorization_id
    join public.refund_nayax_execution_contexts saved
      on saved.attempt_id = attempt.id
      and saved.refund_case_id = refund_case.id
    cross join lateral jsonb_to_record(saved.context) as context(
      "caseId" uuid,
      "reportingMachineId" uuid,
      "caseVersion" bigint,
      "contextHash" text,
      "attemptGeneration" integer,
      "accountScope" text,
      "providerMachineId" text,
      "transactionId" text,
      "siteId" integer,
      "originalAmountCents" integer,
      "currencyCode" text,
      "cardLast4" text,
      "machineAuthorizationTimeInstant" timestamptz,
      "machineAuthorizationTime" text,
      "machineAuthorizationTimeWire" text,
      "machineAuthorizationTimeSerializationMode" text,
      "machineAuthorizationTimeSerializationSource" text,
      "refundEmailListMode" text
    )
    join public.refund_nayax_provider_stage_journal request_journal
      on request_journal.nayax_refund_attempt_id = attempt.id
      and request_journal.pending_approval_recovery_id is null
      and request_journal.stage = 'request'
      and request_journal.event = 'result'
    join public.refund_nayax_provider_business_outcomes request_outcome
      on request_outcome.provider_stage_journal_id = request_journal.id
      and request_outcome.nayax_refund_attempt_id = attempt.id
      and request_outcome.stage = 'request'
    join public.refund_nayax_provider_stage_journal approve_journal
      on approve_journal.nayax_refund_attempt_id = attempt.id
      and approve_journal.pending_approval_recovery_id is null
      and approve_journal.stage = 'approve'
      and approve_journal.event = 'result'
    join public.refund_nayax_provider_business_outcomes approve_outcome
      on approve_outcome.provider_stage_journal_id = approve_journal.id
      and approve_outcome.nayax_refund_attempt_id = attempt.id
      and approve_outcome.stage = 'approve'
    where refund_case.id = p_case_id
      and refund_case.case_population = 'customer'
      and refund_case.payment_method = 'card'
      and refund_case.decision = 'approved'
      and attempt.execution_mode = 'request_and_approve'
      and attempt.actor_user_id = authz.actor_user_id
      and attempt.amount_cents = refund_case.refund_amount_cents
      and attempt.amount_cents = refund_case.matched_nayax_amount_cents
      and attempt.currency_code = 'USD'
      and attempt.currency_code = refund_case.matched_nayax_currency_code
      and attempt.idempotency_key ~ '^nayax-refund-[a-f0-9]{64}$'
      and attempt.request_fingerprint = public.refund_nayax_attempt_request_fingerprint(
        authz.id,
        refund_case.id,
        attempt.idempotency_key,
        attempt.amount_cents,
        attempt.currency_code,
        authz.nayax_execution_evidence_hash
      )
      and authz.status = 'consumed'
      and authz.consumed_at is not null
      and authz.action = 'nayax_execute'
      and authz.refund_case_id = refund_case.id
      and authz.authorization_method = 'manager_session'
      and authz.step_up_intent_id is null
      and authz.verified_totp_at is null
      and authz.nayax_execution_evidence_hash ~ '^[a-f0-9]{64}$'
      and context."caseId" = refund_case.id
      and context."reportingMachineId" = machine.id
      and authz.expected_case_version = context."caseVersion"
      -- The official-action evidence hash and selected-context hash are two
      -- independent immutable contracts. The former binds authorization to
      -- the intent and request fingerprint; the latter is a self-hash over
      -- the exact request context persisted by the current Woodland path.
      and context."contextHash" ~ '^[a-f0-9]{64}$'
      and context."contextHash" = encode(extensions.digest(convert_to(
        (saved.context - 'contextHash')::text, 'UTF8'
      ), 'sha256'), 'hex')
      and context."machineAuthorizationTimeSerializationMode" = 'exact_source'
      and context."machineAuthorizationTimeSerializationSource" = 'exact_source'
      and context."refundEmailListMode" = 'empty_string'
      and context."machineAuthorizationTimeWire" = context."machineAuthorizationTime"
      and context."attemptGeneration" = refund_case.nayax_refund_attempt_generation
      and context."accountScope" = machine.nayax_account_key
      and context."providerMachineId" = machine.nayax_machine_id
      and context."transactionId" = refund_case.matched_nayax_transaction_id
      and context."siteId" = refund_case.matched_nayax_site_id
      and context."originalAmountCents" = attempt.amount_cents
      and context."currencyCode" = attempt.currency_code
      and context."cardLast4" = refund_case.matched_nayax_card_last4
      and context."machineAuthorizationTimeInstant" = refund_case.matched_nayax_machine_auth_time
      and request_journal.http_status = 200
      and request_journal.http_accepted
      and request_journal.outcome = 'accepted'
      and request_journal.contract_matched
      and request_journal.approval_authorized
      and request_journal.schema_matched
      and request_journal.semantic_pair_matched
      and request_journal.journal_contract_version = 'nayax-provider-journal-v3'
      and request_journal.provider_contract_version = 'nayax-production-account-contract-v2'
      and approve_journal.http_status = 200
      and approve_journal.http_accepted
      and approve_journal.outcome = 'succeeded'
      and approve_journal.contract_matched
      and approve_journal.schema_matched
      and approve_journal.semantic_pair_matched
      and approve_journal.journal_contract_version = 'nayax-provider-journal-v3'
      and approve_journal.provider_contract_version = 'nayax-production-account-contract-v2'
      and request_outcome.business_pair_retained
      and request_outcome.observed_scalar_pair_retained
      and approve_outcome.business_pair_retained
      and approve_outcome.observed_scalar_pair_retained
      and request_outcome.business_result =
        'Refund status updated successfully, but the email could not be sent'
      and request_outcome.business_status = 'Partial success'
      and request_outcome.observed_result_scalar = request_outcome.business_result
      and request_outcome.observed_status_scalar = request_outcome.business_status
      and approve_outcome.business_result = request_outcome.business_result
      and approve_outcome.business_status = request_outcome.business_status
      and approve_outcome.observed_result_scalar = approve_outcome.business_result
      and approve_outcome.observed_status_scalar = approve_outcome.business_status
      and request_journal.created_at < approve_journal.created_at
      and (select count(*) from public.refund_nayax_provider_stage_journal journal
        where journal.nayax_refund_attempt_id = attempt.id
          and journal.pending_approval_recovery_id is null
          and journal.stage = 'request'
          and journal.event = 'result') = 1
      and (select count(*) from public.refund_nayax_provider_stage_journal journal
        where journal.nayax_refund_attempt_id = attempt.id
          and journal.pending_approval_recovery_id is null
          and journal.stage = 'approve'
          and journal.event = 'result') = 1
      and not exists (
        select 1 from public.refund_nayax_provider_stage_journal journal
        where journal.nayax_refund_attempt_id = attempt.id
          and journal.pending_approval_recovery_id is not null
      )
      and not exists (
        select 1
        from public.refund_case_nayax_refund_attempts other_attempt
        where other_attempt.id <> attempt.id
          and other_attempt.refund_case_id = refund_case.id
          and (
            other_attempt.status in ('in_progress', 'requested', 'approved', 'succeeded')
            or other_attempt.provider_outcome = 'success'
          )
      )
  );
$$;

revoke all on function public.refund_nayax_unsettled_api_success_journal_proved(uuid, uuid)
  from public, anon, authenticated, service_role;

-- Once approval is recorded, validity is intrinsic to the immutable receipt.
-- Do not make System completion depend on a later assignment, role or session.
create or replace function public.refund_official_action_receipt_authority_valid(
  p_authorization_id uuid,p_reporting_machine_id uuid
)
returns boolean language sql stable security definer set search_path='' as $$
  select exists(
    select 1
    from public.refund_case_official_action_authorizations receipt
    join public.refund_cases refund_case on refund_case.id=receipt.refund_case_id
    where receipt.id=p_authorization_id
      and refund_case.reporting_machine_id=p_reporting_machine_id
      and receipt.actor_user_id is not null
      and receipt.action='nayax_execute'
      and receipt.authorization_method='manager_session'
      and receipt.status='consumed'
      and receipt.consumed_at is not null
      and receipt.step_up_intent_id is null
      and receipt.verified_totp_at is null
      and receipt.nayax_execution_evidence_hash~'^[a-f0-9]{64}$'
      and ((receipt.authority_kind='machine_manager'
        and receipt.manager_mapping_id is not null
        and receipt.manager_mapping_version>0
        and receipt.super_admin_role_id is null)
        or (receipt.authority_kind='super_admin'
          and receipt.manager_mapping_id is null
          and receipt.manager_mapping_version is null
          and receipt.super_admin_role_id is not null))
  );
$$;
revoke all on function public.refund_official_action_receipt_authority_valid(uuid,uuid)
  from public,anon,authenticated,service_role;

create or replace function public.service_consume_nayax_refund_official_action(
  p_authorization_id uuid,p_case_id uuid,p_status text,p_decision text,
  p_refund_amount_cents integer,p_matched_nayax_candidate_token uuid default null
)
returns jsonb language plpgsql security definer set search_path='' as $$
declare
  authorization_context jsonb;
  authorization_row public.refund_case_official_action_authorizations%rowtype;
  refund_case public.refund_cases%rowtype;
  nayax_machine public.reporting_machines%rowtype;
  current_execution_evidence_hash text;
begin
  if p_matched_nayax_candidate_token is not null then
    raise exception 'Nayax execution uses the persisted approved match and does not accept a candidate token';
  end if;

  authorization_context:=public.consume_refund_official_action_authorization(
    p_authorization_id,p_case_id,'nayax_execute',p_status,p_decision,
    null,null,null,p_refund_amount_cents,null,null,false,null,null);

  select * into authorization_row
  from public.refund_case_official_action_authorizations receipt_row
  where receipt_row.id=p_authorization_id for update;
  select * into refund_case from public.refund_cases
  where id=p_case_id for update;
  select * into nayax_machine from public.reporting_machines
  where id=refund_case.reporting_machine_id for share;
  if not found then
    raise exception 'Nayax machine configuration changed after manager confirmation';
  end if;

  current_execution_evidence_hash:=public.refund_nayax_execution_evidence_hash(
    refund_case,nayax_machine);
  if authorization_row.nayax_execution_evidence_hash is distinct from
      current_execution_evidence_hash then
    raise exception 'Nayax execution evidence changed after manager confirmation; review again';
  end if;
  if not public.refund_official_action_receipt_authority_valid(
    authorization_row.id,refund_case.reporting_machine_id
  ) then
    raise exception 'Immutable manager confirmation receipt is invalid';
  end if;

  insert into public.refund_case_events(
    refund_case_id,actor_user_id,event_type,message,metadata)
  values(p_case_id,authorization_row.actor_user_id,
    'nayax_official_action_revalidated',
    'The System validated the exact manager confirmation and frozen transaction evidence before Nayax preparation.',
    jsonb_build_object('action','nayax_execute',
      'authority_kind',authorization_row.authority_kind,
      'authority_record_id',coalesce(authorization_row.manager_mapping_id,
        authorization_row.super_admin_role_id),
      'payload_redacted',true));
  return authorization_context;
end;
$$;
revoke execute on function public.service_consume_nayax_refund_official_action(
  uuid,uuid,text,text,integer,uuid
) from public,anon,authenticated,service_role;

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
      and public.refund_official_action_receipt_authority_valid(receipt.id,machine.id)
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

-- The interactive continuation is still available to either currently
-- authorized manager role, but it preserves the original approval receipt.
create or replace function public.refund_nayax_approval_continuation_ready_v1(
  p_user_id uuid,
  p_refund_case_id uuid
)
returns boolean
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  saved_context jsonb;
  current_context jsonb;
begin
  select execution.context into saved_context
  from public.refund_cases refund_case
  join public.reporting_machines machine
    on machine.id = refund_case.reporting_machine_id
  join public.refund_case_nayax_refund_attempts attempt
    on attempt.refund_case_id = refund_case.id
  join public.refund_nayax_execution_contexts execution
    on execution.attempt_id = attempt.id
    and execution.refund_case_id = refund_case.id
  join public.refund_case_official_action_authorizations action_authorization
    on action_authorization.id = attempt.official_action_authorization_id
  where refund_case.id = p_refund_case_id
    and p_user_id is not null
    and refund_case.duplicate_of_refund_case_id is null
    and refund_case.payment_method = 'card'
    and refund_case.status = 'card_refund_pending'
    and refund_case.decision = 'approved'
    and refund_case.correlation_status = 'matched'
    and refund_case.correlation_source = 'nayax'
    and refund_case.nayax_refund_execution_status = 'requested'
    and refund_case.refund_completed_at is null
    and refund_case.reporting_adjustment_id is null
    and refund_case.refund_amount_cents is not null
    and refund_case.refund_amount_cents > 0
    and refund_case.refund_amount_cents = refund_case.matched_nayax_amount_cents
    and refund_case.matched_nayax_currency_code = 'USD'
    and public.is_review_safe_nayax_transaction_reference(
      refund_case.matched_nayax_transaction_id
    )
    and refund_case.matched_nayax_site_id is not null
    and refund_case.matched_nayax_machine_auth_time is not null
    and not public.refund_case_has_unresolved_reconciliation(refund_case.id)
    and not exists (
      select 1
      from public.refund_gmail_case_link_review_candidates candidate
      join public.refund_gmail_case_link_reviews review
        on review.id = candidate.review_id
      where candidate.refund_case_id = refund_case.id
        and review.status = 'pending'
    )
    and not exists (
      select 1
      from public.refund_cases duplicate_case
      where duplicate_case.id <> refund_case.id
        and duplicate_case.matched_nayax_transaction_id =
          refund_case.matched_nayax_transaction_id
    )
    and exists (
      select 1
      from public.refund_case_events selection_event
      where selection_event.refund_case_id = refund_case.id
        and selection_event.event_type = 'nayax_match_selected'
        and selection_event.actor_user_id is not null
    )
    and machine.status = 'active'
    and machine.nayax_refunds_enabled is true
    and machine.nayax_machine_id = execution.context ->> 'providerMachineId'
    and machine.nayax_account_key = execution.context ->> 'accountScope'
    and attempt.actor_user_id = action_authorization.actor_user_id
    and attempt.execution_mode = 'request_and_approve'
    and attempt.status = 'in_progress'
    and attempt.provider_outcome is null
    and attempt.provider_claim_consumed_at is null
    and attempt.provider_claim_expires_at is not null
    and attempt.provider_claim_expires_at <= statement_timestamp()
    and action_authorization.refund_case_id = refund_case.id
    and action_authorization.action = 'nayax_execute'
    and action_authorization.status = 'consumed'
    and action_authorization.consumed_at is not null
    and (
      action_authorization.expected_case_version =
        (execution.context ->> 'caseVersion')::bigint + 1
      or (
        action_authorization.expected_case_version =
          (execution.context ->> 'caseVersion')::bigint
        and public.refund_nayax_durable_preapproval_started_attempt_v1(
          p_user_id, refund_case.id, attempt.id
        )
      )
    )
    and refund_case.official_action_version =
      action_authorization.expected_case_version + 1
    and public.refund_official_action_receipt_authority_valid(
      action_authorization.id, refund_case.reporting_machine_id
    )
    and public.can_perform_refund_official_action(p_user_id, refund_case.id)
    and refund_case.nayax_refund_attempt_generation =
      (execution.context ->> 'attemptGeneration')::integer
    and refund_case.matched_nayax_transaction_id =
      execution.context ->> 'transactionId'
    and refund_case.matched_nayax_site_id =
      (execution.context ->> 'siteId')::integer
    and refund_case.matched_nayax_amount_cents =
      (execution.context ->> 'originalAmountCents')::integer
    and refund_case.matched_nayax_currency_code =
      execution.context ->> 'currencyCode'
    and not exists (
      select 1
      from public.refund_nayax_attempt_approval_continuations continuation
      where continuation.nayax_refund_attempt_id = attempt.id
    )
    and not exists (
      select 1
      from public.refund_nayax_provider_stage_journal approval_stage
      where approval_stage.nayax_refund_attempt_id = attempt.id
        and approval_stage.pending_approval_recovery_id is null
        and approval_stage.stage = 'approve'
    )
    and exists (
      select 1
      from public.refund_nayax_provider_stage_journal request_result
      join public.refund_nayax_provider_business_outcomes business
        on business.provider_stage_journal_id = request_result.id
      where request_result.nayax_refund_attempt_id = attempt.id
        and request_result.pending_approval_recovery_id is null
        and request_result.stage = 'request'
        and request_result.event = 'result'
        and request_result.http_status = 200
        and request_result.http_accepted is true
        and request_result.media_type_class = 'application_json'
        and request_result.body_kind = 'json_object'
        and request_result.json_parsed is true
        and request_result.body_json_object is true
        and request_result.schema_matched is true
        and request_result.semantic_pair_matched is true
        and request_result.contract_matched is true
        and request_result.outcome = 'accepted'
        and request_result.failure_type is null
        and request_result.approval_authorized is true
        and request_result.provider_contract_version =
          'nayax-production-account-contract-v2'
        and request_result.journal_contract_version =
          'nayax-provider-journal-v3'
        and business.nayax_refund_attempt_id = attempt.id
        and business.stage = 'request'
        and business.business_pair_retained is true
    )
  limit 1;

  if saved_context is null then
    return false;
  end if;

  begin
    current_context := public.refund_nayax_selected_execution_context(
      p_refund_case_id
    );
  exception when others then
    return false;
  end;

  return current_context is not null
    and current_context ->> 'transactionId' = saved_context ->> 'transactionId'
    and current_context ->> 'siteId' = saved_context ->> 'siteId'
    and current_context ->> 'machineAuthorizationTime' =
      saved_context ->> 'machineAuthorizationTime'
    and current_context ->> 'machineAuthorizationTimeSource' =
      'MachineAuthorizationTime'
    and current_context ->> 'originalAmountCents' =
      saved_context ->> 'originalAmountCents'
    and current_context ->> 'currencyCode' = saved_context ->> 'currencyCode';
end;
$$;

revoke all on function public.refund_nayax_approval_continuation_ready_v1(uuid,uuid)
  from public,anon,authenticated,service_role;

create or replace function public.service_reserve_nayax_refund_approval_continuation_v1(
  p_executor_assertion text,
  p_actor_user_id uuid,
  p_case_id uuid,
  p_expected_case_version bigint,
  p_idempotency_key text,
  p_amount_cents integer,
  p_currency_code text,
  p_provider_contract_version text,
  p_journal_contract_version text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  case_row public.refund_cases%rowtype;
  attempt_row public.refund_case_nayax_refund_attempts%rowtype;
  authorization_row public.refund_case_official_action_authorizations%rowtype;
  machine_row public.reporting_machines%rowtype;
  execution_context jsonb;
  current_context jsonb;
  continuation_claim_token text;
  continuation_claim_digest text;
  continuation_claim_expires_at timestamptz;
  reservation jsonb;
begin
  perform public.assert_nayax_provider_executor(p_executor_assertion);
  if p_actor_user_id is null or p_case_id is null
    or p_idempotency_key !~ '^nayax-refund-[a-f0-9]{64}$'
    or p_amount_cents is null or p_amount_cents <= 0
    or upper(btrim(coalesce(p_currency_code, ''))) <> 'USD'
    or btrim(coalesce(p_provider_contract_version, '')) <> 'nayax-production-account-contract-v2'
    or btrim(coalesce(p_journal_contract_version, '')) <> 'nayax-provider-journal-v3' then
    raise exception 'Exact current Nayax continuation context is required'
      using errcode = 'P4628';
  end if;

  select refund_case.* into case_row
  from public.refund_cases refund_case where refund_case.id = p_case_id for update;
  if not found then
    raise exception 'Refund case not found' using errcode = 'P4628';
  end if;
  select attempt.* into attempt_row
  from public.refund_case_nayax_refund_attempts attempt
  where attempt.idempotency_key = p_idempotency_key for update;
  if not found or attempt_row.refund_case_id is distinct from case_row.id
    or attempt_row.amount_cents is distinct from p_amount_cents
    or attempt_row.currency_code is distinct from 'USD'
    or attempt_row.execution_mode is distinct from 'request_and_approve' then
    raise exception 'Continuation does not match the immutable Nayax attempt'
      using errcode = 'P4628';
  end if;

  select context into strict execution_context
  from public.refund_nayax_execution_contexts
  where attempt_id = attempt_row.id and refund_case_id = case_row.id;
  select * into strict authorization_row
  from public.refund_case_official_action_authorizations
  where id = attempt_row.official_action_authorization_id;
  if not public.can_perform_refund_official_action(p_actor_user_id, case_row.id) then
    raise exception 'Assigned Machine Manager or Super-admin authority is required for continuation'
      using errcode = 'P4628';
  end if;
  select * into strict machine_row
  from public.reporting_machines where id = case_row.reporting_machine_id for share;

  if case_row.official_action_version is distinct from p_expected_case_version
    or authorization_row.refund_case_id is distinct from case_row.id
    or authorization_row.actor_user_id is distinct from attempt_row.actor_user_id
    or authorization_row.action is distinct from 'nayax_execute'
    or authorization_row.status is distinct from 'consumed'
    or authorization_row.consumed_at is null
    or (
      authorization_row.expected_case_version is distinct from
        (execution_context->>'caseVersion')::bigint + 1
      and (
        authorization_row.expected_case_version is distinct from
          (execution_context->>'caseVersion')::bigint
        or not public.refund_nayax_durable_preapproval_started_attempt_v1(
          p_actor_user_id, case_row.id, attempt_row.id
        )
      )
    )
    or case_row.official_action_version is distinct from
      authorization_row.expected_case_version + 1
    or not public.refund_official_action_receipt_authority_valid(
      authorization_row.id, case_row.reporting_machine_id
    )
    or case_row.duplicate_of_refund_case_id is not null
    or public.refund_case_has_unresolved_reconciliation(case_row.id)
    or exists (
      select 1
      from public.refund_gmail_case_link_review_candidates candidate
      join public.refund_gmail_case_link_reviews review
        on review.id = candidate.review_id
      where candidate.refund_case_id = case_row.id
        and review.status = 'pending'
    )
    or exists (
      select 1
      from public.refund_cases duplicate_case
      where duplicate_case.id <> case_row.id
        and duplicate_case.matched_nayax_transaction_id =
          case_row.matched_nayax_transaction_id
    )
    or case_row.status is distinct from 'card_refund_pending'
    or case_row.decision is distinct from 'approved'
    or case_row.nayax_refund_execution_status is distinct from 'requested'
    or case_row.refund_completed_at is not null or case_row.reporting_adjustment_id is not null
    or case_row.refund_amount_cents is distinct from p_amount_cents
    or case_row.nayax_refund_attempt_generation is distinct from (execution_context->>'attemptGeneration')::integer
    or case_row.matched_nayax_transaction_id is distinct from execution_context->>'transactionId'
    or case_row.matched_nayax_site_id is distinct from (execution_context->>'siteId')::integer
    or case_row.matched_nayax_amount_cents is distinct from (execution_context->>'originalAmountCents')::integer
    or case_row.matched_nayax_currency_code is distinct from execution_context->>'currencyCode'
    or machine_row.status is distinct from 'active'
    or machine_row.nayax_refunds_enabled is distinct from true
    or machine_row.nayax_machine_id is distinct from execution_context->>'providerMachineId'
    or machine_row.nayax_account_key is distinct from execution_context->>'accountScope' then
    raise exception 'Selected Nayax purchase or manager authority changed'
      using errcode = 'P4628';
  end if;

  current_context := public.refund_nayax_selected_execution_context(case_row.id);
  if current_context is null
    or current_context->>'transactionId' is distinct from execution_context->>'transactionId'
    or current_context->>'siteId' is distinct from execution_context->>'siteId'
    or current_context->>'machineAuthorizationTime' is distinct from execution_context->>'machineAuthorizationTime'
    or current_context->>'machineAuthorizationTimeSource' is distinct from 'MachineAuthorizationTime'
    or current_context->>'originalAmountCents' is distinct from execution_context->>'originalAmountCents'
    or current_context->>'currencyCode' is distinct from execution_context->>'currencyCode' then
    raise exception 'Original Nayax execution evidence changed'
      using errcode = 'P4628';
  end if;

  -- Active original workers retain their claim. A continuation is considered
  -- only after that claim expires, and only one continuation reservation can
  -- ever be inserted for the immutable attempt.
  if attempt_row.status is distinct from 'in_progress'
    or attempt_row.provider_outcome is not null
    or attempt_row.provider_claim_consumed_at is not null
    or attempt_row.provider_claim_expires_at > statement_timestamp()
    or exists (
      select 1 from public.refund_nayax_attempt_approval_continuations continuation
      where continuation.nayax_refund_attempt_id = attempt_row.id
    )
    or exists (
      select 1 from public.refund_nayax_provider_stage_journal approval_stage
      where approval_stage.nayax_refund_attempt_id = attempt_row.id
        and approval_stage.pending_approval_recovery_id is null
        and approval_stage.stage = 'approve'
    )
    or not exists (
      select 1
      from public.refund_nayax_provider_stage_journal request_result
      join public.refund_nayax_provider_business_outcomes business
        on business.provider_stage_journal_id = request_result.id
      where request_result.nayax_refund_attempt_id = attempt_row.id
        and request_result.pending_approval_recovery_id is null
        and request_result.stage = 'request' and request_result.event = 'result'
        and request_result.http_status = 200 and request_result.http_accepted is true
        and request_result.media_type_class = 'application_json'
        and request_result.body_kind = 'json_object'
        and request_result.json_parsed is true and request_result.body_json_object is true
        and request_result.schema_matched is true
        and request_result.semantic_pair_matched is true
        and request_result.contract_matched is true
        and request_result.outcome = 'accepted'
        and request_result.failure_type is null
        and request_result.approval_authorized is true
        and request_result.provider_contract_version = p_provider_contract_version
        and request_result.journal_contract_version = p_journal_contract_version
        and business.nayax_refund_attempt_id = attempt_row.id
        and business.stage = 'request' and business.business_pair_retained is true
    ) then
    reservation := public.refund_nayax_attempt_reservation_payload(attempt_row.id, false, null);
    return jsonb_set(
      reservation,
      '{attempt,executionPlan}',
      to_jsonb('approval_continuation'::text),
      true
    );
  end if;

  continuation_claim_token := encode(extensions.gen_random_bytes(32), 'hex');
  continuation_claim_digest := encode(
    extensions.digest(convert_to(continuation_claim_token, 'UTF8'), 'sha256'), 'hex'
  );
  continuation_claim_expires_at := statement_timestamp() + interval '15 minutes';
  insert into public.refund_nayax_attempt_approval_continuations (
    nayax_refund_attempt_id, refund_case_id, actor_user_id,
    official_action_authorization_id, attempt_generation,
    execution_context_hash, provider_claim_digest, provider_claim_expires_at
  ) values (
    attempt_row.id, case_row.id, p_actor_user_id, authorization_row.id,
    (execution_context->>'attemptGeneration')::integer,
    execution_context->>'contextHash', continuation_claim_digest,
    continuation_claim_expires_at
  );
  update public.refund_case_nayax_refund_attempts
  set provider_claim_digest = continuation_claim_digest,
      provider_claim_expires_at = continuation_claim_expires_at,
      safe_transport_stage = 'request_result',
      safe_failure_class = null,
      refund_operations_due_at = null
  where id = attempt_row.id;

  reservation := public.refund_nayax_attempt_reservation_payload(
    attempt_row.id, true, continuation_claim_token
  );
  return jsonb_set(
    reservation,
    '{attempt,executionPlan}',
    to_jsonb('approval_continuation'::text),
    true
  );
end;
$$;
revoke all on function public.service_reserve_nayax_refund_approval_continuation_v1(
  text,uuid,uuid,bigint,text,integer,text,text,text
) from public,anon,authenticated,service_role;
grant execute on function public.service_reserve_nayax_refund_approval_continuation_v1(
  text,uuid,uuid,bigint,text,integer,text,text,text
) to service_role;

-- A service continuation is the System finishing the approval stage of an
-- already-approved immutable attempt. It is bound only to the original receipt,
-- case, frozen execution context, and single-use provider claim.
-- This nullable marker is inert in this migration. The following System-boundary
-- migration adds its composite foreign key and is the only writer of non-null values.
alter table public.refund_case_nayax_refund_attempts
  add column if not exists system_saved_approval_receipt_id uuid;

create or replace function public.service_claim_due_nayax_approval_continuations_v1(
  p_executor_assertion text,
  p_account_key text,
  p_limit integer default 2
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  candidate record;
  current_context jsonb;
  claim_token text;
  claim_digest text;
  claim_expires_at timestamptz;
  reservation jsonb;
  claims jsonb := '[]'::jsonb;
begin
  perform public.assert_nayax_provider_executor(p_executor_assertion);
  if nullif(btrim(p_account_key), '') is null
    or p_account_key is distinct from
      regexp_replace(upper(btrim(p_account_key)), '[^A-Z0-9_]', '_', 'g')
    or p_limit is null or p_limit < 1 or p_limit > 5 then
    raise exception 'Nayax continuation claim limit must be between 1 and 5'
      using errcode = 'P4628';
  end if;

  for candidate in
    select
      attempt.id as attempt_id,
      attempt.idempotency_key,
      attempt.amount_cents,
      attempt.currency_code,
      attempt.official_action_authorization_id,
      refund_case.id as case_id,
      refund_case.official_action_version,
      refund_case.nayax_refund_attempt_generation,
      refund_case.reporting_machine_id,
      authz.actor_user_id as approving_actor_user_id,
      authz.expected_case_version as authorization_case_version,
      machine.nayax_account_key,
      machine.nayax_machine_id,
      frozen.context as frozen_context
    from public.refund_case_nayax_refund_attempts attempt
    join public.refund_cases refund_case
      on refund_case.id = attempt.refund_case_id
    join public.refund_case_official_action_authorizations authz
      on authz.id = attempt.official_action_authorization_id
    join public.reporting_machines machine
      on machine.id = refund_case.reporting_machine_id
    join public.refund_nayax_execution_contexts frozen
      on frozen.attempt_id = attempt.id
      and frozen.refund_case_id = refund_case.id
    where attempt.execution_mode = 'request_and_approve'
      and attempt.system_saved_approval_receipt_id is null
      and attempt.status = 'in_progress'
      and attempt.provider_outcome is null
      and attempt.provider_claim_consumed_at is null
      and attempt.provider_claim_expires_at is not null
      and attempt.provider_claim_expires_at <= statement_timestamp()
      and refund_case.duplicate_of_refund_case_id is null
      and refund_case.payment_method = 'card'
      and refund_case.status = 'card_refund_pending'
      and refund_case.decision = 'approved'
      and refund_case.correlation_status = 'matched'
      and refund_case.correlation_source = 'nayax'
      and refund_case.nayax_refund_execution_status = 'requested'
      and refund_case.refund_completed_at is null
      and refund_case.reporting_adjustment_id is null
      and refund_case.refund_amount_cents = attempt.amount_cents
      and refund_case.matched_nayax_amount_cents = attempt.amount_cents
      and refund_case.matched_nayax_currency_code = attempt.currency_code
      and attempt.currency_code = 'USD'
      and authz.refund_case_id = refund_case.id
      and authz.actor_user_id = attempt.actor_user_id
      and authz.action = 'nayax_execute'
      and authz.status = 'consumed'
      and authz.consumed_at is not null
      and authz.expected_case_version =
        (frozen.context ->> 'caseVersion')::bigint + 1
      and refund_case.official_action_version =
        authz.expected_case_version + 1
      and public.refund_official_action_receipt_authority_valid(
        authz.id, refund_case.reporting_machine_id
      )
      and machine.status = 'active'
      and machine.nayax_refunds_enabled is true
      and machine.nayax_account_key = p_account_key
      and machine.nayax_machine_id = frozen.context ->> 'providerMachineId'
      and machine.nayax_account_key = frozen.context ->> 'accountScope'
      and refund_case.reporting_machine_id =
        (frozen.context ->> 'reportingMachineId')::uuid
      and refund_case.nayax_refund_attempt_generation =
        (frozen.context ->> 'attemptGeneration')::integer
      and refund_case.matched_nayax_transaction_id =
        frozen.context ->> 'transactionId'
      and refund_case.matched_nayax_site_id =
        (frozen.context ->> 'siteId')::integer
      and refund_case.matched_nayax_amount_cents =
        (frozen.context ->> 'originalAmountCents')::integer
      and refund_case.matched_nayax_currency_code =
        frozen.context ->> 'currencyCode'
      and not public.refund_case_has_unresolved_reconciliation(refund_case.id)
      and not exists (
        select 1
        from public.refund_authoritative_receipts receipt
        where receipt.refund_case_id = refund_case.id
      )
      and not exists (
        select 1
        from public.refund_nayax_attempt_approval_continuations continuation
        where continuation.nayax_refund_attempt_id = attempt.id
      )
      and not exists (
        select 1
        from public.refund_nayax_provider_stage_journal approval_stage
        where approval_stage.nayax_refund_attempt_id = attempt.id
          and approval_stage.pending_approval_recovery_id is null
          and approval_stage.stage = 'approve'
      )
      and exists (
        select 1
        from public.refund_nayax_provider_stage_journal request_result
        join public.refund_nayax_provider_business_outcomes business
          on business.provider_stage_journal_id = request_result.id
        where request_result.nayax_refund_attempt_id = attempt.id
          and request_result.pending_approval_recovery_id is null
          and request_result.stage = 'request'
          and request_result.event = 'result'
          and request_result.http_status = 200
          and request_result.http_accepted is true
          and request_result.media_type_class = 'application_json'
          and request_result.body_kind = 'json_object'
          and request_result.json_parsed is true
          and request_result.body_json_object is true
          and request_result.schema_matched is true
          and request_result.semantic_pair_matched is true
          and request_result.contract_matched is true
          and request_result.outcome = 'accepted'
          and request_result.failure_type is null
          and request_result.approval_authorized is true
          and request_result.provider_contract_version =
            'nayax-production-account-contract-v2'
          and request_result.journal_contract_version =
            'nayax-provider-journal-v3'
          and business.nayax_refund_attempt_id = attempt.id
          and business.stage = 'request'
          and business.business_pair_retained is true
      )
    order by attempt.provider_claim_expires_at, attempt.id
    for update of attempt, refund_case skip locked
    limit p_limit
  loop
    current_context := public.refund_nayax_selected_execution_context_v3(
      candidate.case_id,
      coalesce(
        candidate.frozen_context ->>
          'machineAuthorizationTimeSerializationMode',
        'exact_source'
      ),
      coalesce(candidate.frozen_context ->> 'refundEmailListMode', 'omit')
    );
    if current_context is null
      or current_context ->> 'transactionId' is distinct from
        candidate.frozen_context ->> 'transactionId'
      or current_context ->> 'siteId' is distinct from
        candidate.frozen_context ->> 'siteId'
      or current_context ->> 'machineAuthorizationTime' is distinct from
        candidate.frozen_context ->> 'machineAuthorizationTime'
      or current_context ->> 'machineAuthorizationTimeWire' is distinct from
        candidate.frozen_context ->> 'machineAuthorizationTimeWire'
      or current_context ->> 'machineAuthorizationTimeSerializationMode'
        is distinct from candidate.frozen_context ->>
          'machineAuthorizationTimeSerializationMode'
      or coalesce(current_context ->> 'refundEmailListMode', 'omit')
        is distinct from coalesce(
          candidate.frozen_context ->> 'refundEmailListMode', 'omit'
        )
      or current_context ->> 'originalAmountCents' is distinct from
        candidate.frozen_context ->> 'originalAmountCents'
      or current_context ->> 'currencyCode' is distinct from
        candidate.frozen_context ->> 'currencyCode'
      or current_context ->> 'providerMachineId' is distinct from
        candidate.frozen_context ->> 'providerMachineId'
      or current_context ->> 'accountScope' is distinct from
        candidate.frozen_context ->> 'accountScope' then
      continue;
    end if;

    claim_token := encode(extensions.gen_random_bytes(32), 'hex');
    claim_digest := encode(
      extensions.digest(convert_to(claim_token, 'UTF8'), 'sha256'),
      'hex'
    );
    claim_expires_at := statement_timestamp() + interval '15 minutes';

    insert into public.refund_nayax_attempt_approval_continuations (
      nayax_refund_attempt_id,
      refund_case_id,
      actor_user_id,
      official_action_authorization_id,
      attempt_generation,
      execution_context_hash,
      provider_claim_digest,
      provider_claim_expires_at
    ) values (
      candidate.attempt_id,
      candidate.case_id,
      candidate.approving_actor_user_id,
      candidate.official_action_authorization_id,
      candidate.nayax_refund_attempt_generation,
      candidate.frozen_context ->> 'contextHash',
      claim_digest,
      claim_expires_at
    );

    insert into public.refund_nayax_server_approval_continuation_claims (
      nayax_refund_attempt_id,
      refund_case_id,
      approval_continuation_attempt_id,
      official_action_authorization_id,
      execution_context_hash,
      provider_claim_digest
    ) values (
      candidate.attempt_id,
      candidate.case_id,
      candidate.attempt_id,
      candidate.official_action_authorization_id,
      candidate.frozen_context ->> 'contextHash',
      claim_digest
    );

    update public.refund_case_nayax_refund_attempts
    set provider_claim_digest = claim_digest,
        provider_claim_expires_at = claim_expires_at,
        safe_transport_stage = 'request_result',
        safe_failure_class = null,
        refund_operations_due_at = null
    where id = candidate.attempt_id;

    reservation := public.refund_nayax_attempt_reservation_payload(
      candidate.attempt_id,
      true,
      claim_token
    );
    reservation := jsonb_set(
      reservation,
      '{attempt,executionPlan}',
      to_jsonb('approval_continuation'::text),
      true
    ) || jsonb_build_object(
      'executionContext', candidate.frozen_context,
      'idempotencyKey', candidate.idempotency_key,
      'accountKey', candidate.nayax_account_key,
      'providerMachineId', candidate.nayax_machine_id,
      'payloadRedacted', true
    );
    claims := claims || jsonb_build_array(reservation);
  end loop;

  return jsonb_build_object(
    'schemaVersion', 'nayax-server-approval-continuation-v1',
    'claims', claims,
    'claimedCount', jsonb_array_length(claims),
    'payloadRedacted', true
  );
end;
$$;


create or replace function public.guard_refund_nayax_execution_context_stage()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  attempt_row public.refund_case_nayax_refund_attempts%rowtype;
  case_row public.refund_cases%rowtype;
  machine_row public.reporting_machines%rowtype;
  execution_context jsonb;
  current_execution_authorized boolean := false;
begin
  select * into strict attempt_row
  from public.refund_case_nayax_refund_attempts
  where id = new.nayax_refund_attempt_id;
  select context into execution_context
  from public.refund_nayax_execution_contexts
  where attempt_id = attempt_row.id;
  if execution_context is not null
    and new.journal_contract_version is distinct from
      'nayax-provider-journal-v3' then
    raise exception 'Execution context requires the current provider journal contract'
      using errcode = 'P4620';
  end if;
  if new.event <> 'started'
    or new.journal_contract_version is distinct from
      'nayax-provider-journal-v3' then
    return new;
  end if;

  select * into strict case_row
  from public.refund_cases
  where id = attempt_row.refund_case_id
  for share;
  select * into strict machine_row
  from public.reporting_machines
  where id = case_row.reporting_machine_id
  for share;

  current_execution_authorized := public.refund_official_action_receipt_authority_valid(
    attempt_row.official_action_authorization_id,
    case_row.reporting_machine_id
  );
  if new.stage = 'approve' then
    current_execution_authorized := current_execution_authorized or exists (
      select 1
      from public.refund_nayax_attempt_approval_continuations continuation
      where continuation.nayax_refund_attempt_id = attempt_row.id
        and continuation.refund_case_id = case_row.id
        and continuation.official_action_authorization_id =
          attempt_row.official_action_authorization_id
        and continuation.attempt_generation =
          case_row.nayax_refund_attempt_generation
        and continuation.execution_context_hash =
          execution_context ->> 'contextHash'
        and continuation.provider_claim_digest =
          attempt_row.provider_claim_digest
        and continuation.provider_claim_expires_at =
          attempt_row.provider_claim_expires_at
        and public.refund_official_action_receipt_authority_valid(
          continuation.official_action_authorization_id,
          case_row.reporting_machine_id
        )
        and (
          not exists (
            select 1
            from public.refund_nayax_server_approval_continuation_claims
              server_claim
            where server_claim.nayax_refund_attempt_id = attempt_row.id
          )
          or exists (
            select 1
            from public.refund_nayax_server_approval_continuation_claims
              server_claim
            where server_claim.nayax_refund_attempt_id = attempt_row.id
              and server_claim.refund_case_id = case_row.id
              and server_claim.approval_continuation_attempt_id =
                continuation.nayax_refund_attempt_id
              and server_claim.official_action_authorization_id =
                continuation.official_action_authorization_id
              and server_claim.execution_context_hash =
                continuation.execution_context_hash
              and server_claim.provider_claim_digest =
                continuation.provider_claim_digest
          )
        )
    );
  end if;

  if execution_context is null
    or execution_context ->> 'caseId' is distinct from case_row.id::text
    or execution_context ->> 'reportingMachineId' is distinct from
      machine_row.id::text
    or execution_context ->> 'accountScope' is distinct from
      machine_row.nayax_account_key
    or execution_context ->> 'providerMachineId' is distinct from
      machine_row.nayax_machine_id
    or execution_context ->> 'transactionId' is distinct from
      case_row.matched_nayax_transaction_id
    or (execution_context ->> 'siteId')::integer is distinct from
      case_row.matched_nayax_site_id
    or (execution_context ->> 'attemptGeneration')::integer is distinct from
      case_row.nayax_refund_attempt_generation
    or (execution_context ->> 'originalAmountCents')::integer is distinct from
      case_row.matched_nayax_amount_cents
    or (execution_context ->> 'originalAmountCents')::integer is distinct from
      attempt_row.amount_cents
    or execution_context ->> 'currencyCode' is distinct from
      attempt_row.currency_code
    or machine_row.status <> 'active'
    or machine_row.nayax_refunds_enabled is distinct from true
    or not current_execution_authorized then
    raise exception 'Selected Nayax purchase or manager authority changed'
      using errcode = 'P4620';
  end if;
  return new;
end;
$$;


alter table public.refund_nayax_server_approval_continuation_claims
  drop column current_manager_mapping_id,
  drop column current_manager_mapping_version;

revoke all on function public.service_claim_due_nayax_approval_continuations_v1(
  text, text, integer
) from public, anon, authenticated, service_role;
grant execute on function public.service_claim_due_nayax_approval_continuations_v1(
  text, text, integer
) to service_role;
revoke all on function public.guard_refund_nayax_execution_context_stage()
  from public, anon, authenticated, service_role;

comment on function public.refund_nayax_approval_continuation_ready_v1(uuid,uuid) is
  'Checks whether an authorized Machine Manager or Super-admin can continue only the approval stage of one unchanged, already-approved Nayax attempt.';
comment on function public.service_reserve_nayax_refund_approval_continuation_v1(
  text,uuid,uuid,bigint,text,integer,text,text,text
) is
  'Lets an authorized Machine Manager or Super-admin continue only the approval stage of one unchanged, already-approved Nayax attempt. It never creates or repeats the refund request.';
comment on table public.refund_nayax_server_approval_continuation_claims is
  'Immutable System claim for finishing only the approval stage of one already-approved Nayax attempt. The claim is bound to the original receipt and cannot repeat the refund request.';

-- Historical step-up rows remain readable as audit evidence.  The former TOTP
-- preparation/consumption endpoints are retired so no caller can accidentally
-- re-enter the second-approval workflow.
create or replace function public.admin_prepare_refund_action_step_up_intent(
  p_case_id uuid,p_action text,p_target_function text,p_expected_case_version bigint,
  p_target_status text default null,p_target_decision text default null,
  p_assigned_manager_email text default null,p_decision_reason text default null,
  p_internal_note text default null,p_refund_amount_cents integer default null,
  p_manual_refund_reference text default null,p_cash_payout_sent_at timestamptz default null,
  p_cash_payment_confirmed boolean default false,
  p_matched_nayax_candidate_token uuid default null,
  p_nayax_disagreement_reason text default null
)
returns jsonb language plpgsql security definer set search_path='' as $$
begin
  raise exception 'The refund TOTP approval lane is retired' using errcode='42501';
end;
$$;
create or replace function public.admin_get_refund_action_step_up_intent(p_intent_id uuid)
returns jsonb language plpgsql security definer set search_path='' as $$
begin
  raise exception 'The refund TOTP approval lane is retired' using errcode='42501';
end;
$$;
create or replace function public.admin_cancel_refund_action_step_up_intent(p_intent_id uuid)
returns jsonb language plpgsql security definer set search_path='' as $$
begin
  raise exception 'The refund TOTP approval lane is retired' using errcode='42501';
end;
$$;
create or replace function public.admin_refund_manager_step_up_factor_is_approved(
  p_intent_id uuid,p_factor_binding_hash text
)
returns boolean language plpgsql stable security definer set search_path='' as $$
begin
  raise exception 'The refund TOTP approval lane is retired' using errcode='42501';
end;
$$;
create or replace function public.admin_consume_refund_action_step_up_intent(
  p_intent_id uuid,p_case_id uuid,p_action text,p_target_function text,
  p_expected_case_version bigint,p_target_status text default null,
  p_target_decision text default null,p_assigned_manager_email text default null,
  p_decision_reason text default null,p_internal_note text default null,
  p_refund_amount_cents integer default null,p_manual_refund_reference text default null,
  p_cash_payout_sent_at timestamptz default null,
  p_cash_payment_confirmed boolean default false,
  p_matched_nayax_candidate_token uuid default null,
  p_nayax_disagreement_reason text default null,
  p_factor_verification_proof text default null
)
returns jsonb language plpgsql security definer set search_path='' as $$
begin
  raise exception 'The refund TOTP approval lane is retired' using errcode='42501';
end;
$$;
create or replace function public.service_mark_refund_manager_step_up_factor_verified(
  p_actor_user_id uuid,p_intent_id uuid,p_factor_binding_hash text
)
returns jsonb language plpgsql security definer set search_path='' as $$
begin
  raise exception 'The refund TOTP approval lane is retired' using errcode='42501';
end;
$$;
revoke execute on function public.admin_prepare_refund_action_step_up_intent(
  uuid,text,text,bigint,text,text,text,text,text,integer,text,
  timestamptz,boolean,uuid,text
) from public,anon,authenticated,service_role;
revoke execute on function public.admin_get_refund_action_step_up_intent(uuid)
  from public,anon,authenticated,service_role;
revoke execute on function public.admin_cancel_refund_action_step_up_intent(uuid)
  from public,anon,authenticated,service_role;
revoke execute on function public.admin_refund_manager_step_up_factor_is_approved(uuid,text)
  from public,anon,authenticated,service_role;
revoke execute on function public.admin_consume_refund_action_step_up_intent(
  uuid,uuid,text,text,bigint,text,text,text,text,text,integer,text,
  timestamptz,boolean,uuid,text,text
) from public,anon,authenticated,service_role;
revoke execute on function public.service_mark_refund_manager_step_up_factor_verified(uuid,uuid,text)
  from public,anon,authenticated,service_role;

-- Historical manual-portal attempts remain readable for audit evidence.  Make
-- the retired entry point fail before any lifecycle or attempt write, including
-- when it is called by a database-owner or service context.
create or replace function public.admin_begin_refund_manual_nayax_portal(
  p_case_id uuid,p_expected_case_version bigint
)
returns jsonb language plpgsql security definer set search_path='' as $$
begin
  raise exception 'The manual Nayax portal refund lane is retired'
    using errcode='42501';
end;
$$;
revoke execute on function public.admin_begin_refund_manual_nayax_portal(uuid,bigint)
  from public,anon,authenticated,service_role;

create or replace function public.admin_begin_refund_manual_nayax_portal_pre_ops_v1(
  p_case_id uuid,p_expected_case_version bigint
)
returns jsonb language plpgsql security definer set search_path='' as $$
begin
  raise exception 'The manual Nayax portal refund lane is retired'
    using errcode='42501';
end;
$$;
revoke all on function public.admin_begin_refund_manual_nayax_portal_pre_ops_v1(uuid,bigint)
  from public,anon,authenticated,service_role;

create or replace function public.admin_resolve_refund_nayax_outcome_manager_session(
  p_case_id uuid,p_attempt_id uuid,p_resolution_result text,p_evidence_type text,
  p_evidence_reference text,p_evidence_occurred_at timestamptz,
  p_reason_code text,p_expected_case_version bigint
)
returns jsonb language plpgsql security definer set search_path='' as $$
begin
  if auth.role() is distinct from 'authenticated' or auth.uid() is null
    or not public.is_super_admin(auth.uid()) then
    raise exception 'Super-admin access is required to record reconciled provider evidence'
      using errcode='42501';
  end if;
  -- Serialize with provider settlement before deciding whether this legacy
  -- reconciliation path is still available.  Without this lock a concurrent
  -- settlement can create its immutable receipt after the pre-check and the
  -- old resolver can then return an unrelated live-manager error.
  perform 1 from public.refund_cases refund_case
  where refund_case.id=p_case_id for update;
  if not found then
    raise exception 'Refund case not found';
  end if;
  if exists(select 1 from public.refund_authoritative_receipts receipt
    where receipt.refund_case_id=p_case_id) then
    raise exception 'Authoritative refund evidence is already recorded for this case'
      using errcode='P4661';
  end if;
  return public.admin_resolve_refund_nayax_outcome_manager_session_pre_ops_v1(
    p_case_id,p_attempt_id,p_resolution_result,p_evidence_type,
    p_evidence_reference,p_evidence_occurred_at,p_reason_code,
    p_expected_case_version);
end;
$$;
revoke execute on function public.admin_resolve_refund_nayax_outcome_manager_session(
  uuid,uuid,text,text,text,timestamptz,text,bigint
) from public,anon,service_role;
grant execute on function public.admin_resolve_refund_nayax_outcome_manager_session(
  uuid,uuid,text,text,text,timestamptz,text,bigint
) to authenticated;

-- Retire the remaining TOTP enrollment and controlled-pilot write surfaces.
-- Historical tables and read paths remain available for audit, but no caller,
-- including the database owner, can restart either execution lane.
create or replace function public.open_refund_manager_totp_enrollment_window_current_user()
returns jsonb language plpgsql security definer set search_path='' as $$ begin
  raise exception 'The refund authenticator enrollment lane is retired' using errcode='42501';
end; $$;
create or replace function public.close_refund_manager_totp_enrollment_window_current_user()
returns jsonb language plpgsql security definer set search_path='' as $$ begin
  raise exception 'The refund authenticator enrollment lane is retired' using errcode='42501';
end; $$;
create or replace function public.service_record_refund_manager_totp_enrollment(
  p_actor_user_id uuid,p_factor_binding_hash text
)
returns jsonb language plpgsql security definer set search_path='' as $$ begin
  raise exception 'The refund authenticator enrollment lane is retired' using errcode='42501';
end; $$;
create or replace function public.service_compensate_refund_manager_totp_enrollment(
  p_actor_user_id uuid,p_factor_binding_hash text
)
returns jsonb language plpgsql security definer set search_path='' as $$ begin
  raise exception 'The refund authenticator enrollment lane is retired' using errcode='42501';
end; $$;
revoke all on function public.open_refund_manager_totp_enrollment_window_current_user()
  from public,anon,authenticated,service_role;
revoke all on function public.close_refund_manager_totp_enrollment_window_current_user()
  from public,anon,authenticated,service_role;
revoke all on function public.service_record_refund_manager_totp_enrollment(uuid,text)
  from public,anon,authenticated,service_role;
revoke all on function public.service_compensate_refund_manager_totp_enrollment(uuid,text)
  from public,anon,authenticated,service_role;

create or replace function public.owner_authorize_refund_nayax_controlled_pilot(
  p_authorization_id uuid,p_owner_user_id uuid,p_case_id uuid,
  p_expected_case_version bigint,p_amount_cents integer,
  p_owner_case_evidence_digest text,p_owner_email_digest text,
  p_self_case_attestation_digest text,p_machine_evidence_digest text,
  p_account_key_digest text,p_runner_assertion_digest text,
  p_executor_assertion_digest text,p_contract_digest text,
  p_contract_version text,p_sponsor_confirmation_digest text,
  p_dtm_owner_operator_proof_digest text
)
returns jsonb language plpgsql security definer set search_path='' as $$ begin
  raise exception 'The controlled Nayax pilot lane is retired' using errcode='42501';
end; $$;
create or replace function public.owner_cancel_refund_nayax_controlled_pilot(
  p_authorization_id uuid
)
returns jsonb language plpgsql security definer set search_path='' as $$ begin
  raise exception 'The controlled Nayax pilot lane is retired' using errcode='42501';
end; $$;
create or replace function public.owner_recover_expired_refund_nayax_controlled_pilot()
returns jsonb language plpgsql security definer set search_path='' as $$ begin
  raise exception 'The controlled Nayax pilot lane is retired' using errcode='42501';
end; $$;
create or replace function public.service_validate_nayax_controlled_pilot_postarm(
  p_executor_assertion text,p_pilot_authorization_id uuid,p_case_id uuid,
  p_amount_cents integer,p_runner_assertion_digest text,p_contract_digest text
)
returns jsonb language plpgsql security definer set search_path='' as $$ begin
  raise exception 'The controlled Nayax pilot lane is retired' using errcode='42501';
end; $$;
create or replace function public.admin_consume_refund_nayax_controlled_pilot_intent(
  p_pilot_authorization_id uuid,p_intent_id uuid,p_case_id uuid,
  p_expected_case_version bigint,p_refund_amount_cents integer,
  p_factor_verification_proof text,p_executor_assertion text,
  p_runner_assertion_digest text,p_contract_digest text,p_idempotency_key text,
  p_worker_lease_id uuid
)
returns jsonb language plpgsql security definer set search_path='' as $$ begin
  raise exception 'The controlled Nayax pilot lane is retired' using errcode='42501';
end; $$;
create or replace function public.service_reserve_and_consume_nayax_controlled_pilot_attempt(
  p_executor_assertion text,p_pilot_authorization_id uuid,
  p_runner_assertion_digest text,p_contract_digest text,p_authorization_id uuid,
  p_case_id uuid,p_idempotency_key text,p_amount_cents integer,
  p_currency_code text default 'USD',p_worker_lease_id uuid default null
)
returns jsonb language plpgsql security definer set search_path='' as $$ begin
  raise exception 'The controlled Nayax pilot lane is retired' using errcode='42501';
end; $$;
create or replace function public.service_record_nayax_controlled_pilot_stage(
  p_executor_assertion text,p_pilot_authorization_id uuid,p_attempt_id uuid,
  p_worker_lease_id uuid,p_stage_event text,p_outcome text default null,
  p_http_status integer default null,p_provider_result text default null,
  p_provider_status text default null,p_failure_type text default null,
  p_contract_matched boolean default null,p_classification_digest text default null
)
returns jsonb language plpgsql security definer set search_path='' as $$ begin
  raise exception 'The controlled Nayax pilot lane is retired' using errcode='42501';
end; $$;
create or replace function public.service_settle_nayax_controlled_pilot_attempt(
  p_executor_assertion text,p_pilot_authorization_id uuid,p_attempt_id uuid,
  p_authorization_id uuid,p_case_id uuid,p_idempotency_key text,
  p_amount_cents integer,p_currency_code text,p_provider_claim_token text,
  p_provider_outcome text,p_worker_lease_id uuid,p_evidence_reference text default null,
  p_provider_status text default null,p_error_code text default null
)
returns jsonb language plpgsql security definer set search_path='' as $$ begin
  raise exception 'The controlled Nayax pilot lane is retired' using errcode='42501';
end; $$;

revoke all on function public.owner_authorize_refund_nayax_controlled_pilot(
  uuid,uuid,uuid,bigint,integer,text,text,text,text,text,text,text,text,text,text,text
) from public,anon,authenticated,service_role;
revoke all on function public.owner_cancel_refund_nayax_controlled_pilot(uuid)
  from public,anon,authenticated,service_role;
revoke all on function public.owner_recover_expired_refund_nayax_controlled_pilot()
  from public,anon,authenticated,service_role;
revoke all on function public.service_validate_nayax_controlled_pilot_postarm(
  text,uuid,uuid,integer,text,text
) from public,anon,authenticated,service_role;
revoke all on function public.admin_consume_refund_nayax_controlled_pilot_intent(
  uuid,uuid,uuid,bigint,integer,text,text,text,text,text,uuid
) from public,anon,authenticated,service_role;
revoke all on function public.service_reserve_and_consume_nayax_controlled_pilot_attempt(
  text,uuid,text,text,uuid,uuid,text,integer,text,uuid
) from public,anon,authenticated,service_role;
revoke all on function public.service_record_nayax_controlled_pilot_stage(
  text,uuid,uuid,uuid,text,text,integer,text,text,text,boolean,text
) from public,anon,authenticated,service_role;
revoke all on function public.service_settle_nayax_controlled_pilot_attempt(
  text,uuid,uuid,uuid,uuid,text,integer,text,text,text,uuid,text,text,text
) from public,anon,authenticated,service_role;

select pg_notify('pgrst','reload schema');
