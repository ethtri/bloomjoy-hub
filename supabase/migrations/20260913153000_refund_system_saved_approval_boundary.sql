-- #1345: a consumed human approval may be finished only by the System.
-- This is deliberately separate from official-action authorizations so a
-- System claim can never be mistaken for browser or manager authority.

alter table public.refund_case_official_action_authorizations
  add constraint refund_official_action_authorization_id_case_unique
    unique(id,refund_case_id);
alter table public.refund_nayax_lookup_candidates
  add constraint refund_nayax_candidate_token_case_unique
    unique(token,refund_case_id);
alter table public.refund_case_official_action_authorizations
  add constraint refund_official_action_selected_candidate_case_fk
    foreign key(selected_nayax_candidate_token,refund_case_id)
    references public.refund_nayax_lookup_candidates(token,refund_case_id)
    on delete restrict;

-- Receipts created before the one-manager migration did not record the
-- selected candidate token. Backfill only when exactly one historical
-- candidate independently matches the immutable approval marker and every
-- current case fact. Missing or ambiguous evidence remains null and is held
-- for review by the System selector below.
create function public.refund_backfill_unambiguous_legacy_saved_approvals_v1()
returns integer language plpgsql security definer set search_path='' as $$
declare updated_count integer;
begin
with legacy_sources as (
  select approval.id as approval_id,approval.refund_case_id,approval.actor_user_id,
    refund_case.reporting_machine_id,refund_case.matched_nayax_transaction_id,
    refund_case.matched_nayax_site_id,refund_case.matched_nayax_machine_auth_time,
    refund_case.matched_nayax_amount_cents,refund_case.matched_nayax_card_last4,
    refund_case.matched_nayax_currency_code
  from public.refund_case_official_action_authorizations approval
  join public.refund_cases refund_case on refund_case.id=approval.refund_case_id
  join public.refund_case_events marker
    on marker.refund_case_id=approval.refund_case_id
    and marker.event_type='nayax_refund_execution_authorized'
    and marker.metadata->>'authorization_id'=approval.id::text
  where approval.action='approve' and approval.status='consumed'
    and approval.authorization_method='manager_session'
    and approval.selected_nayax_candidate_token is null
    and approval.selected_nayax_candidate_evidence_hash is null
    and marker.actor_user_id=approval.actor_user_id
    and marker.metadata->>'payload_redacted'='true'
), exact_candidates as (
  select source.approval_id,candidate.token,
    public.refund_nayax_candidate_evidence_hash(
      candidate.refund_case_id,candidate.actor_user_id,
      candidate.provider_transaction_id,candidate.site_id,
      candidate.machine_authorization_time,candidate.amount_cents,
      candidate.card_last4,candidate.currency_code,candidate.evidence_summary,
      candidate.expires_at,candidate.created_at) as candidate_hash,
    count(*) over(partition by source.approval_id) as exact_count
  from legacy_sources source
  join public.refund_nayax_lookup_candidates candidate
    on candidate.refund_case_id=source.refund_case_id
    and candidate.actor_user_id=source.actor_user_id
    and candidate.reporting_machine_id=source.reporting_machine_id
    and candidate.provider_transaction_id=source.matched_nayax_transaction_id
    and candidate.site_id=source.matched_nayax_site_id
    and candidate.machine_authorization_time=source.matched_nayax_machine_auth_time
    and candidate.amount_cents=source.matched_nayax_amount_cents
    and candidate.card_last4 is not distinct from source.matched_nayax_card_last4
    and candidate.currency_code=source.matched_nayax_currency_code
    and candidate.evidence_summary->>'selection_allowed'='true'
  where public.is_review_safe_nayax_transaction_reference(
    candidate.provider_transaction_id)
    and exists(select 1 from public.refund_case_events selection_marker
      where selection_marker.refund_case_id=source.refund_case_id
        and selection_marker.event_type='nayax_match_selected'
        and selection_marker.actor_user_id=source.actor_user_id
        and selection_marker.metadata->>'payload_redacted'='true'
        and selection_marker.metadata->>'execution_eligible'='true')
), unambiguous as (
  select approval_id,token,candidate_hash from exact_candidates where exact_count=1
)
update public.refund_case_official_action_authorizations approval
set selected_nayax_candidate_token=chosen.token,
  selected_nayax_candidate_evidence_hash=chosen.candidate_hash
from unambiguous chosen where approval.id=chosen.approval_id;
get diagnostics updated_count=row_count;
return updated_count;
end;
$$;
revoke all on function public.refund_backfill_unambiguous_legacy_saved_approvals_v1()
  from public,anon,authenticated,service_role;
select public.refund_backfill_unambiguous_legacy_saved_approvals_v1();

create table public.refund_nayax_system_saved_approval_receipts (
  id uuid primary key default gen_random_uuid(),
  refund_case_id uuid not null references public.refund_cases(id) on delete restrict,
  source_approval_authorization_id uuid not null unique,
  selected_nayax_candidate_token uuid not null,
  selected_nayax_candidate_evidence_hash text not null
    check (selected_nayax_candidate_evidence_hash~'^[a-f0-9]{64}$'),
  original_actor_user_id uuid not null references auth.users(id) on delete restrict,
  original_authority_kind text not null
    check (original_authority_kind in ('machine_manager','super_admin')),
  original_manager_mapping_id uuid
    references public.reporting_machine_refund_managers(id) on delete restrict,
  original_manager_mapping_version bigint,
  original_super_admin_role_id uuid
    references public.admin_roles(id) on delete restrict,
  confirmed_case_version bigint not null check (confirmed_case_version>0),
  deterministic_fact_version bigint not null check (deterministic_fact_version>0),
  attempt_generation integer not null check (attempt_generation>=0),
  reporting_machine_id uuid not null
    references public.reporting_machines(id) on delete restrict,
  provider_machine_id text not null,
  provider_account_scope_digest text not null
    check (provider_account_scope_digest~'^[a-f0-9]{64}$'),
  transaction_id text not null,
  site_id integer not null,
  machine_authorization_time timestamptz not null,
  machine_authorization_time_raw text not null,
  machine_authorization_time_wire text not null,
  machine_authorization_time_serialization_mode text not null
    check (machine_authorization_time_serialization_mode in
      ('exact_source','source_with_bound_offset')),
  refund_email_list_mode text not null
    check (refund_email_list_mode in ('omit','empty_string')),
  provider_contract_version text not null
    check (provider_contract_version='nayax-production-account-contract-v2'),
  journal_contract_version text not null
    check (journal_contract_version='nayax-provider-journal-v3'),
  execution_context_hash text not null
    check (execution_context_hash~'^[a-f0-9]{64}$'),
  amount_cents integer not null check (amount_cents>0),
  card_last4 text,
  currency_code text not null check (currency_code='USD'),
  saved_approval_evidence_hash text not null
    check (saved_approval_evidence_hash~'^[a-f0-9]{64}$'),
  status text not null default 'available'
    check (status in ('available','claimed','consumed','held')),
  nayax_refund_attempt_id uuid unique,
  created_at timestamptz not null default statement_timestamp(),
  claimed_at timestamptz,
  consumed_at timestamptz,
  held_at timestamptz,
  hold_reason text,
  constraint refund_nayax_system_saved_approval_authority_shape check (
    (original_authority_kind='machine_manager'
      and original_manager_mapping_id is not null
      and original_manager_mapping_version>0
      and original_super_admin_role_id is null)
    or
    (original_authority_kind='super_admin'
      and original_manager_mapping_id is null
      and original_manager_mapping_version is null
      and original_super_admin_role_id is not null)
  ),
  constraint refund_nayax_system_saved_approval_lifecycle_shape check (
    ((status='available' and claimed_at is null and consumed_at is null
          and held_at is null and nayax_refund_attempt_id is null
          )
      or (status='claimed' and claimed_at is not null and consumed_at is null
          and held_at is null and nayax_refund_attempt_id is null)
      or (status='consumed' and consumed_at is not null and held_at is null
          and claimed_at is not null and nayax_refund_attempt_id is not null)
      or (status='held' and held_at is not null
          and nullif(btrim(hold_reason),'') is not null))
  ),
  unique(refund_case_id,attempt_generation),
  unique(id,refund_case_id),
  unique(nayax_refund_attempt_id,refund_case_id),
  constraint refund_nayax_system_receipt_source_case_fk
    foreign key(source_approval_authorization_id,refund_case_id)
    references public.refund_case_official_action_authorizations(id,refund_case_id)
    on delete restrict,
  constraint refund_nayax_system_receipt_candidate_case_fk
    foreign key(selected_nayax_candidate_token,refund_case_id)
    references public.refund_nayax_lookup_candidates(token,refund_case_id)
    on delete restrict
);

alter table public.refund_nayax_system_saved_approval_receipts enable row level security;
revoke all on table public.refund_nayax_system_saved_approval_receipts
  from public,anon,authenticated,service_role;

alter table public.refund_case_nayax_refund_attempts
  add column if not exists system_saved_approval_receipt_id uuid;
alter table public.refund_case_nayax_refund_attempts
  add constraint refund_nayax_attempt_id_case_unique unique(id,refund_case_id),
  add constraint refund_nayax_attempt_system_receipt_case_fk
    foreign key(system_saved_approval_receipt_id,refund_case_id)
    references public.refund_nayax_system_saved_approval_receipts(id,refund_case_id)
    on delete restrict deferrable initially deferred;
alter table public.refund_nayax_system_saved_approval_receipts
  add constraint refund_nayax_system_receipt_attempt_case_fk
    foreign key(nayax_refund_attempt_id,refund_case_id)
    references public.refund_case_nayax_refund_attempts(id,refund_case_id)
    on delete restrict deferrable initially deferred;
create unique index refund_nayax_attempt_system_saved_approval_unique
  on public.refund_case_nayax_refund_attempts(system_saved_approval_receipt_id)
  where system_saved_approval_receipt_id is not null;
alter table public.refund_case_nayax_refund_attempts
  add constraint refund_nayax_attempt_system_authority_shape check (
    system_saved_approval_receipt_id is null
    or (official_action_authorization_id is null and step_up_intent_id is null
      and execution_mode='request_and_approve' and request_fingerprint is not null
      and provider_claim_digest is not null and provider_claim_expires_at is not null)
  );

create function public.guard_refund_nayax_system_saved_approval_receipt()
returns trigger language plpgsql security definer set search_path='' as $$
begin
  -- This setting is only an internal trigger-transition marker. It grants no
  -- table privilege and is never consulted for provider or approval authority.
  if tg_op='INSERT' then
    if pg_catalog.current_setting('bloomjoy.system_saved_approval_writer',true)
      is distinct from 'service_creator_v1' then
      raise exception 'System saved-approval receipts are created only by the trusted System worker'
        using errcode='42501';
    end if;
    new.status:='available';
    new.nayax_refund_attempt_id:=null;
    new.created_at:=statement_timestamp();
    new.claimed_at:=null;
    new.consumed_at:=null;
    new.held_at:=null;
    new.hold_reason:=null;
    return new;
  end if;
  if tg_op='DELETE' then
    raise exception 'System saved-approval receipts are immutable';
  end if;
  if old.refund_case_id is distinct from new.refund_case_id
    or old.source_approval_authorization_id is distinct from new.source_approval_authorization_id
    or old.selected_nayax_candidate_token is distinct from new.selected_nayax_candidate_token
    or old.selected_nayax_candidate_evidence_hash is distinct from new.selected_nayax_candidate_evidence_hash
    or old.original_actor_user_id is distinct from new.original_actor_user_id
    or old.original_authority_kind is distinct from new.original_authority_kind
    or old.original_manager_mapping_id is distinct from new.original_manager_mapping_id
    or old.original_manager_mapping_version is distinct from new.original_manager_mapping_version
    or old.original_super_admin_role_id is distinct from new.original_super_admin_role_id
    or old.confirmed_case_version is distinct from new.confirmed_case_version
    or old.deterministic_fact_version is distinct from new.deterministic_fact_version
    or old.attempt_generation is distinct from new.attempt_generation
    or old.reporting_machine_id is distinct from new.reporting_machine_id
    or old.provider_machine_id is distinct from new.provider_machine_id
    or old.provider_account_scope_digest is distinct from new.provider_account_scope_digest
    or old.transaction_id is distinct from new.transaction_id
    or old.site_id is distinct from new.site_id
    or old.machine_authorization_time is distinct from new.machine_authorization_time
    or old.machine_authorization_time_raw is distinct from new.machine_authorization_time_raw
    or old.machine_authorization_time_wire is distinct from new.machine_authorization_time_wire
    or old.machine_authorization_time_serialization_mode is distinct from new.machine_authorization_time_serialization_mode
    or old.refund_email_list_mode is distinct from new.refund_email_list_mode
    or old.provider_contract_version is distinct from new.provider_contract_version
    or old.journal_contract_version is distinct from new.journal_contract_version
    or old.execution_context_hash is distinct from new.execution_context_hash
    or old.amount_cents is distinct from new.amount_cents
    or old.card_last4 is distinct from new.card_last4
    or old.currency_code is distinct from new.currency_code
    or old.saved_approval_evidence_hash is distinct from new.saved_approval_evidence_hash
    or old.created_at is distinct from new.created_at then
    raise exception 'System saved-approval receipt evidence is immutable';
  end if;
  if pg_catalog.current_setting('bloomjoy.system_saved_approval_writer',true)
      is distinct from 'service_creator_v1' then
    raise exception 'System saved-approval lifecycle is service-owned' using errcode='42501';
  end if;
  if old.status='available' and new.status='claimed'
    and new.claimed_at=statement_timestamp()
    and new.nayax_refund_attempt_id is null then
    return new;
  end if;
  if old.status='claimed' and new.status='consumed'
    and new.consumed_at=statement_timestamp()
    and new.nayax_refund_attempt_id is not null then
    return new;
  end if;
  if old.status='claimed' and new.status='held'
    and new.held_at=statement_timestamp() then
    return new;
  end if;
  if old.status='consumed' and new.status='held'
    and new.held_at=statement_timestamp()
    and new.consumed_at is not distinct from old.consumed_at
    and new.nayax_refund_attempt_id is not distinct from old.nayax_refund_attempt_id
    and exists(select 1 from public.refund_nayax_provider_stage_journal journal
      where journal.nayax_refund_attempt_id=old.nayax_refund_attempt_id
        and journal.stage='request') then
    return new;
  end if;
  raise exception 'System saved-approval receipt lifecycle is immutable';
end;
$$;
create trigger refund_nayax_system_saved_approval_receipt_immutable
before insert or update or delete on public.refund_nayax_system_saved_approval_receipts
for each row execute function public.guard_refund_nayax_system_saved_approval_receipt();
revoke all on function public.guard_refund_nayax_system_saved_approval_receipt()
  from public,anon,authenticated,service_role;

create index refund_nayax_system_saved_approval_claim_queue_idx
  on public.refund_nayax_system_saved_approval_receipts(status,created_at)
  where status='available';

create function public.service_apply_persisted_nayax_approval_for_system_v1(
  p_authorization_id uuid,p_case_id uuid,p_refund_amount_cents integer,
  p_matched_nayax_candidate_token uuid
)
returns jsonb language plpgsql security definer set search_path='' as $$
declare
  authorization_context jsonb;
  selected_candidate public.refund_nayax_lookup_candidates%rowtype;
  updated_case public.refund_cases%rowtype;
  scorer_recommendation_state text;
  manager_recommendation_state text;
  manager_execution_eligible boolean;
begin
  select candidate.* into strict selected_candidate
  from public.refund_nayax_lookup_candidates candidate
  where candidate.token=p_matched_nayax_candidate_token
    and candidate.refund_case_id=p_case_id for share;
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(
    'refund-nayax-selected-transaction|'||selected_candidate.provider_transaction_id,0));
  if exists(select 1 from public.refund_cases duplicate_case
    where duplicate_case.id<>p_case_id
      and duplicate_case.matched_nayax_transaction_id=
        selected_candidate.provider_transaction_id) then
    raise exception 'This Nayax transaction is already linked to another refund case'
      using errcode='23505';
  end if;
  authorization_context:=public.consume_refund_official_action_authorization(
    p_authorization_id,p_case_id,'approve','card_refund_pending','approved',
    null,'customer_owed',null,p_refund_amount_cents,null,null,false,
    p_matched_nayax_candidate_token,null);

  perform pg_catalog.set_config('request.jwt.claim.sub',
    authorization_context->>'actorUserId',true);
  scorer_recommendation_state:=coalesce(nullif(btrim(
    selected_candidate.evidence_summary->>'recommendation_state'),''),
    'manual_exception');
  manager_recommendation_state:=scorer_recommendation_state;
  manager_execution_eligible:=(
    scorer_recommendation_state='high_confidence'
    and selected_candidate.evidence_summary->>'is_recommended'='true'
    and selected_candidate.evidence_summary->>'one_click_eligible'='true'
  ) or (
    selected_candidate.evidence_summary->>'policy_version'='2026-09-05.v11'
    and selected_candidate.evidence_summary->>'selection_allowed'='true'
    and selected_candidate.evidence_summary->>'one_click_eligible'='false'
    and selected_candidate.evidence_summary->>'request_time_boundary' in (
      'request_time_unknown','occurrence_time_uncertain')
  );
  if manager_execution_eligible
    and scorer_recommendation_state<>'high_confidence' then
    manager_recommendation_state:='manager_confirmed';
  end if;
  -- One exact case update means the manager-confirmed version advances once.
  update public.refund_cases
  set status='card_refund_pending',decision='approved',
    decision_reason='customer_owed',
    decided_by=(authorization_context->>'actorUserId')::uuid,
    decided_at=statement_timestamp(),
    refund_amount_cents=selected_candidate.amount_cents,
    matched_nayax_transaction_id=selected_candidate.provider_transaction_id,
    matched_nayax_site_id=selected_candidate.site_id,
    matched_nayax_machine_auth_time=selected_candidate.machine_authorization_time,
    matched_nayax_amount_cents=selected_candidate.amount_cents,
    matched_nayax_card_last4=selected_candidate.card_last4,
    matched_nayax_currency_code=selected_candidate.currency_code,
    correlation_status='matched',correlation_source='nayax',
    nayax_recommendation_state=manager_recommendation_state,
    nayax_recommendation_policy_version=
      selected_candidate.evidence_summary->>'policy_version',
    nayax_recommendation_evaluated_at=statement_timestamp(),
    nayax_match_execution_eligible=manager_execution_eligible,
    correlation_confidence=0,
    correlation_summary=
      'Machine Manager approved the selected Nayax transaction for guarded execution.'
  where id=p_case_id returning * into updated_case;

  insert into public.refund_case_events(
    refund_case_id,actor_user_id,event_type,message,metadata)
  values(p_case_id,(authorization_context->>'actorUserId')::uuid,
    'admin_update','Refund case updated.',
    jsonb_build_object('status','card_refund_pending','decision','approved',
      'assigned_manager_email',null,'decision_reason','customer_owed',
      'refund_amount_cents',selected_candidate.amount_cents,
      'nayax_match_updated',true,'nayax_match_cleared',false,
      'payload_redacted',true));

  if updated_case.status<>'card_refund_pending'
    or updated_case.decision<>'approved'
    or updated_case.official_action_version
      is distinct from (authorization_context->>'expectedCaseVersion')::bigint+1
    or updated_case.matched_nayax_transaction_id
      is distinct from selected_candidate.provider_transaction_id
    or updated_case.matched_nayax_site_id is distinct from selected_candidate.site_id
    or updated_case.matched_nayax_machine_auth_time
      is distinct from selected_candidate.machine_authorization_time
    or updated_case.refund_amount_cents is distinct from selected_candidate.amount_cents
    or updated_case.nayax_refund_execution_status<>'not_requested' then
    raise exception 'Approval did not preserve the exact selected refund'
      using errcode='P4620';
  end if;

  insert into public.refund_case_events(
    refund_case_id,actor_user_id,event_type,message,metadata)
  values(p_case_id,(authorization_context->>'actorUserId')::uuid,
    'official_action_committed','Machine Manager approved the refund action.',
    jsonb_build_object('action','approve',
      'authority_kind',authorization_context->>'authorityKind',
      'authority_record_id',authorization_context->>'authorityRecordId',
      'authority_version',(authorization_context->>'authorityVersion')::bigint,
      'payload_redacted',true));
  insert into public.refund_case_events(
    refund_case_id,actor_user_id,event_type,message,metadata)
  values(updated_case.id,(authorization_context->>'actorUserId')::uuid,
    'nayax_refund_execution_authorized',
    'The Machine Manager approved this exact selected Nayax refund for System execution.',
    jsonb_build_object('schema_version','nayax-selection-approval-v1',
      'case_version',updated_case.official_action_version,
      'deterministic_fact_version',updated_case.deterministic_fact_version,
      'attempt_generation',updated_case.nayax_refund_attempt_generation,
      'transaction_id',updated_case.matched_nayax_transaction_id,
      'site_id',updated_case.matched_nayax_site_id,
      'machine_authorization_time',updated_case.matched_nayax_machine_auth_time,
      'amount_cents',updated_case.matched_nayax_amount_cents,
      'card_last4',updated_case.matched_nayax_card_last4,
      'currency_code',updated_case.matched_nayax_currency_code,
      'authorization_id',p_authorization_id,'payload_redacted',true));
  return to_jsonb(updated_case);
end;
$$;
revoke all on function public.service_apply_persisted_nayax_approval_for_system_v1(
  uuid,uuid,integer,uuid) from public,anon,authenticated,service_role;

-- The Refund button records the manager's decision only. The selected sale may
-- have been saved earlier by a triage agent; the exact persisted case evidence,
-- not the identity of the selector, is what the manager confirms.
create function public.admin_approve_selected_nayax_refund_for_system_v1(
  p_case_id uuid,p_expected_case_version bigint
)
returns jsonb language plpgsql security definer set search_path='' as $$
declare
  refund_case public.refund_cases%rowtype;
  selected_candidate public.refund_nayax_lookup_candidates%rowtype;
  manager_authorization jsonb;
  applied jsonb;
begin
  if auth.uid() is null then
    raise exception 'Authenticated manager or Super-admin session required'
      using errcode='42501';
  end if;
  if not public.refund_official_actions_enabled() then
    raise exception 'Refund actions are temporarily disabled' using errcode='42501';
  end if;

  select * into refund_case from public.refund_cases
  where id=p_case_id for update;
  if not found then raise exception 'Refund case not found'; end if;
  if refund_case.official_action_version is distinct from p_expected_case_version then
    raise exception 'Refund case changed since review; reload before approving the refund';
  end if;
  if refund_case.payment_method<>'card'
    or refund_case.status not in ('needs_review','correlated')
    or refund_case.decision is not null
    or refund_case.correlation_status<>'matched'
    or refund_case.correlation_source<>'nayax'
    or refund_case.nayax_refund_execution_status<>'not_requested'
    or refund_case.reporting_adjustment_id is not null
    or refund_case.refund_completed_at is not null then
    raise exception 'This case is not ready for a new card refund approval'
      using errcode='P4620';
  end if;

  select candidate.* into selected_candidate
  from public.refund_nayax_lookup_candidates candidate
  where candidate.refund_case_id=refund_case.id
    and candidate.lookup_generation=refund_case.nayax_lookup_generation
    and candidate.reporting_machine_id=refund_case.reporting_machine_id
    and candidate.provider_transaction_id
      is not distinct from refund_case.matched_nayax_transaction_id
    and candidate.site_id is not distinct from refund_case.matched_nayax_site_id
    and candidate.machine_authorization_time
      is not distinct from refund_case.matched_nayax_machine_auth_time
    and candidate.amount_cents is not distinct from refund_case.matched_nayax_amount_cents
    and candidate.card_last4 is not distinct from refund_case.matched_nayax_card_last4
    and candidate.currency_code is not distinct from refund_case.matched_nayax_currency_code
    and candidate.evidence_summary->>'selection_allowed'='true'
    and public.is_review_safe_nayax_transaction_reference(
      candidate.provider_transaction_id)
    and public.refund_nayax_candidate_identifier_evidence_state(
      candidate.refund_case_id,candidate.reporting_machine_id,candidate.site_id,
      candidate.machine_authorization_time,candidate.amount_cents,
      candidate.card_last4,candidate.currency_code,candidate.evidence_summary)='valid'
    and exists(select 1 from public.refund_case_events selection_marker
      where selection_marker.refund_case_id=refund_case.id
        and selection_marker.event_type='nayax_match_selected'
        and selection_marker.actor_user_id=candidate.actor_user_id
        and selection_marker.created_at>=candidate.created_at
        and selection_marker.metadata->>'payload_redacted'='true')
  order by candidate.created_at desc,candidate.token desc
  limit 1 for share;
  if not found then
    raise exception 'The saved transaction evidence changed; refresh it before approving'
      using errcode='P4620';
  end if;

  manager_authorization:=public.admin_authorize_refund_official_action(
    p_case_id=>refund_case.id,p_action=>'approve',
    p_expected_case_version=>refund_case.official_action_version,
    p_target_status=>'card_refund_pending',p_target_decision=>'approved',
    p_decision_reason=>'customer_owed',
    p_refund_amount_cents=>selected_candidate.amount_cents,
    p_matched_nayax_candidate_token=>selected_candidate.token);
  applied:=public.service_apply_persisted_nayax_approval_for_system_v1(
    (manager_authorization->>'authorizationId')::uuid,refund_case.id,
    selected_candidate.amount_cents,selected_candidate.token);

  return jsonb_build_object(
    'approved',true,'status','system_finishing','refundCaseId',refund_case.id,
    'authorizationId',manager_authorization->>'authorizationId',
    'caseVersion',(applied->>'official_action_version')::bigint,
    'providerCallMade',false,'customerMessageCreated',false,
    'payloadRedacted',true);
end;
$$;
revoke all on function public.admin_approve_selected_nayax_refund_for_system_v1(
  uuid,bigint) from public,anon,service_role;
grant execute on function public.admin_approve_selected_nayax_refund_for_system_v1(
  uuid,bigint) to authenticated;

create function public.refund_nayax_system_saved_approval_snapshot_v1(p_case_id uuid)
returns jsonb language plpgsql stable security definer set search_path='' as $$
declare
  refund_case public.refund_cases%rowtype;
  marker public.refund_case_events%rowtype;
  selection_marker public.refund_case_events%rowtype;
  source_approval public.refund_case_official_action_authorizations%rowtype;
  selected_candidate public.refund_nayax_lookup_candidates%rowtype;
  machine public.reporting_machines%rowtype;
  evidence_hash text;
  candidate_hash text;
  account_scope_digest text;
begin
  select * into refund_case from public.refund_cases where id=p_case_id;
  if not found then return null; end if;
  select * into marker from public.refund_case_events event_row
  where event_row.refund_case_id=refund_case.id
    and event_row.event_type='nayax_refund_execution_authorized'
  order by event_row.created_at desc,event_row.id desc limit 1;
  if not found or coalesce(marker.metadata->>'authorization_id','')!~
    '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$' then
    return null;
  end if;
  select * into source_approval
  from public.refund_case_official_action_authorizations approval
  where approval.id=(marker.metadata->>'authorization_id')::uuid;
  if not found then return null; end if;
  select * into machine from public.reporting_machines machine_row
  where machine_row.id=refund_case.reporting_machine_id;
  if not found then return null; end if;
  select * into selected_candidate from public.refund_nayax_lookup_candidates candidate
  where candidate.token=source_approval.selected_nayax_candidate_token
    and candidate.refund_case_id=refund_case.id;
  if not found then return null; end if;
  select * into selection_marker from public.refund_case_events event_row
  where event_row.refund_case_id=refund_case.id
    and event_row.event_type='nayax_match_selected'
    and event_row.actor_user_id=selected_candidate.actor_user_id
    and event_row.created_at>=selected_candidate.created_at
    and event_row.created_at<=marker.created_at
  order by event_row.created_at desc,event_row.id desc limit 1;
  if not found then return null; end if;
  candidate_hash:=public.refund_nayax_candidate_evidence_hash(
    selected_candidate.refund_case_id,selected_candidate.actor_user_id,
    selected_candidate.provider_transaction_id,selected_candidate.site_id,
    selected_candidate.machine_authorization_time,selected_candidate.amount_cents,
    selected_candidate.card_last4,selected_candidate.currency_code,
    selected_candidate.evidence_summary,selected_candidate.expires_at,
    selected_candidate.created_at);
  account_scope_digest:=encode(extensions.digest(convert_to(
    regexp_replace(upper(btrim(machine.nayax_account_key)),'[^A-Z0-9_]','_','g'),
    'UTF8'),'sha256'),'hex');

  if source_approval.refund_case_id is distinct from refund_case.id
    or source_approval.action<>'approve'
    or source_approval.authorization_method<>'manager_session'
    or source_approval.status<>'consumed' or source_approval.consumed_at is null
    or source_approval.step_up_intent_id is not null
    or source_approval.verified_totp_at is not null
    or source_approval.selected_nayax_candidate_token is null
    or source_approval.selected_nayax_candidate_evidence_hash is distinct from candidate_hash
    or source_approval.expected_case_version+1<>refund_case.official_action_version
    or source_approval.expected_case_version+1<>(marker.metadata->>'case_version')::bigint
    or marker.created_at<source_approval.consumed_at
    or source_approval.actor_user_id is distinct from marker.actor_user_id
    or not ((source_approval.authority_kind='machine_manager'
        and source_approval.manager_mapping_id is not null
        and source_approval.manager_mapping_version>0
        and source_approval.super_admin_role_id is null)
      or (source_approval.authority_kind='super_admin'
        and source_approval.manager_mapping_id is null
        and source_approval.manager_mapping_version is null
        and source_approval.super_admin_role_id is not null))
    or marker.metadata->>'schema_version'<>'nayax-selection-approval-v1'
    or marker.metadata->>'payload_redacted'<>'true'
    or marker.metadata->>'case_version'!~'^[1-9][0-9]*$'
    or (marker.metadata->>'case_version')::bigint<>refund_case.official_action_version
    or marker.metadata->>'deterministic_fact_version'!~'^[1-9][0-9]*$'
    or (marker.metadata->>'deterministic_fact_version')::bigint<>refund_case.deterministic_fact_version
    or marker.metadata->>'attempt_generation'!~'^[0-9]+$'
    or (marker.metadata->>'attempt_generation')::integer<>refund_case.nayax_refund_attempt_generation
    or marker.metadata->>'transaction_id' is distinct from refund_case.matched_nayax_transaction_id
    or marker.metadata->>'site_id'!~'^[0-9]+$'
    or (marker.metadata->>'site_id')::integer is distinct from refund_case.matched_nayax_site_id
    or (marker.metadata->>'machine_authorization_time')::timestamptz
      is distinct from refund_case.matched_nayax_machine_auth_time
    or marker.metadata->>'amount_cents'!~'^[1-9][0-9]*$'
    or (marker.metadata->>'amount_cents')::integer is distinct from refund_case.matched_nayax_amount_cents
    or marker.metadata->>'card_last4' is distinct from refund_case.matched_nayax_card_last4
    or marker.metadata->>'currency_code' is distinct from refund_case.matched_nayax_currency_code
    or selection_marker.metadata->>'payload_redacted'<>'true'
    or selection_marker.metadata->>'execution_eligible'<>'true'
    or selection_marker.metadata->>'policy_version' is distinct from
      refund_case.nayax_recommendation_policy_version
    or selected_candidate.reporting_machine_id is distinct from refund_case.reporting_machine_id
    or selected_candidate.provider_transaction_id is distinct from refund_case.matched_nayax_transaction_id
    or selected_candidate.site_id is distinct from refund_case.matched_nayax_site_id
    or selected_candidate.machine_authorization_time is distinct from refund_case.matched_nayax_machine_auth_time
    or selected_candidate.amount_cents is distinct from refund_case.matched_nayax_amount_cents
    or selected_candidate.card_last4 is distinct from refund_case.matched_nayax_card_last4
    or selected_candidate.currency_code is distinct from refund_case.matched_nayax_currency_code
    or selected_candidate.evidence_summary->>'selection_allowed'<>'true'
    or not public.is_review_safe_nayax_transaction_reference(
      selected_candidate.provider_transaction_id)
    or selected_candidate.evidence_summary->>'lookup_account_scope' is distinct from
      regexp_replace(upper(btrim(machine.nayax_account_key)),'[^A-Z0-9_]','_','g')
    or selected_candidate.evidence_summary->>'lookup_provider_machine_id' is distinct from
      machine.nayax_machine_id
    or selected_candidate.evidence_summary->>'provider_machine_id' is distinct from
      machine.nayax_machine_id
    or selected_candidate.evidence_summary->>'machine_authorization_time_source'<>
      'MachineAuthorizationTime'
    or nullif(btrim(selected_candidate.evidence_summary->>'machine_authorization_time_raw'),'') is null
    or public.refund_nayax_candidate_identifier_evidence_state(
      selected_candidate.refund_case_id,selected_candidate.reporting_machine_id,
      selected_candidate.site_id,selected_candidate.machine_authorization_time,
      selected_candidate.amount_cents,selected_candidate.card_last4,
      selected_candidate.currency_code,selected_candidate.evidence_summary)<>'valid'
    or refund_case.payment_method<>'card' or refund_case.status<>'card_refund_pending'
    or refund_case.decision<>'approved' or refund_case.correlation_status<>'matched'
    or refund_case.correlation_source<>'nayax'
    or refund_case.refund_amount_cents is distinct from refund_case.matched_nayax_amount_cents
    or refund_case.nayax_refund_execution_status<>'not_requested'
    or refund_case.reporting_adjustment_id is not null or refund_case.refund_completed_at is not null
    or refund_case.duplicate_of_refund_case_id is not null
    or machine.status<>'active' or machine.nayax_refunds_enabled is distinct from true
    or nullif(btrim(machine.nayax_machine_id),'') is null
    or nullif(btrim(machine.nayax_account_key),'') is null
    or public.refund_case_has_unresolved_reconciliation(refund_case.id)
    or exists(select 1 from public.refund_authoritative_receipts terminal_receipt
      where terminal_receipt.refund_case_id=refund_case.id)
    or exists(select 1 from public.refund_gmail_case_link_review_candidates link_candidate
      join public.refund_gmail_case_link_reviews link_review on link_review.id=link_candidate.review_id
      where link_candidate.refund_case_id=refund_case.id and link_review.status='pending')
    or exists(select 1 from public.refund_cases duplicate_case
      where duplicate_case.id<>refund_case.id
        and duplicate_case.matched_nayax_transaction_id=refund_case.matched_nayax_transaction_id)
    or exists(select 1 from public.refund_case_nayax_refund_attempts attempt
      where attempt.refund_case_id=refund_case.id and attempt.created_at>=marker.created_at)
    or exists(select 1 from public.refund_nayax_system_saved_approval_receipts system_receipt
      where system_receipt.source_approval_authorization_id=source_approval.id) then
    return null;
  end if;

  evidence_hash:=encode(extensions.digest(convert_to(jsonb_build_array(
    'refund-nayax-system-saved-approval-v1',source_approval.id,refund_case.id,
    refund_case.official_action_version,refund_case.deterministic_fact_version,
    refund_case.nayax_refund_attempt_generation,refund_case.reporting_machine_id,
    refund_case.matched_nayax_transaction_id,refund_case.matched_nayax_site_id,
    refund_case.matched_nayax_machine_auth_time,refund_case.matched_nayax_amount_cents,
    refund_case.matched_nayax_card_last4,refund_case.matched_nayax_currency_code,
    source_approval.action_context_hash,selected_candidate.token,candidate_hash,
    machine.nayax_machine_id,account_scope_digest)::text,'UTF8'),'sha256'),'hex');
  return jsonb_build_object(
    'caseId',refund_case.id,'sourceApprovalAuthorizationId',source_approval.id,
    'originalActorUserId',source_approval.actor_user_id,
    'originalAuthorityKind',source_approval.authority_kind,
    'originalManagerMappingId',source_approval.manager_mapping_id,
    'originalManagerMappingVersion',source_approval.manager_mapping_version,
    'originalSuperAdminRoleId',source_approval.super_admin_role_id,
    'selectedNayaxCandidateToken',selected_candidate.token,
    'selectedNayaxCandidateEvidenceHash',candidate_hash,
    'confirmedCaseVersion',refund_case.official_action_version,
    'deterministicFactVersion',refund_case.deterministic_fact_version,
    'attemptGeneration',refund_case.nayax_refund_attempt_generation,
    'reportingMachineId',refund_case.reporting_machine_id,
    'transactionId',refund_case.matched_nayax_transaction_id,
    'siteId',refund_case.matched_nayax_site_id,
    'machineAuthorizationTime',refund_case.matched_nayax_machine_auth_time,
    'machineAuthorizationTimeRaw',
      selected_candidate.evidence_summary->>'machine_authorization_time_raw',
    'amountCents',refund_case.matched_nayax_amount_cents,
    'cardLast4',refund_case.matched_nayax_card_last4,
    'currencyCode',refund_case.matched_nayax_currency_code,
    'providerMachineId',machine.nayax_machine_id,
    'providerAccountScopeDigest',account_scope_digest,
    'savedApprovalEvidenceHash',evidence_hash,'payloadRedacted',true);
exception when invalid_text_representation or invalid_datetime_format
  or datetime_field_overflow or numeric_value_out_of_range then
  return null;
end;
$$;
revoke all on function public.refund_nayax_system_saved_approval_snapshot_v1(uuid)
  from public,anon,authenticated,service_role;

create function public.refund_nayax_system_saved_approval_reservation_payload_v1(
  p_receipt_id uuid,p_provider_claim_token text
)
returns jsonb language sql stable security definer set search_path='' as $$
  select jsonb_build_object(
    'systemSavedApproval',jsonb_build_object(
      'systemSavedApprovalReceiptId',receipt.id,
      'sourceApprovalAuthorizationId',receipt.source_approval_authorization_id,
      'caseId',receipt.refund_case_id,'authorityType','system_saved_approval',
      'originalAuthorityKind',receipt.original_authority_kind,
      'createdAt',receipt.created_at),
    'attempt',public.refund_nayax_attempt_snapshot(attempt.id,true),
    'providerClaimToken',p_provider_claim_token,
    'providerWireContext',jsonb_build_object(
      'caseId',receipt.refund_case_id,
      'caseVersion',receipt.confirmed_case_version,
      'attemptGeneration',receipt.attempt_generation,
      'idempotencyKey',attempt.idempotency_key,
      'providerContractVersion',receipt.provider_contract_version,
      'journalContractVersion',receipt.journal_contract_version,
      'executionContextHash',receipt.execution_context_hash,
      'accountScopeDigest',receipt.provider_account_scope_digest,
      'reportingMachineId',receipt.reporting_machine_id,
      'providerMachineId',receipt.provider_machine_id,
      'transactionId',receipt.transaction_id,'siteId',receipt.site_id,
      'machineAuthorizationTime',receipt.machine_authorization_time_raw,
      'machineAuthorizationTimeInstant',receipt.machine_authorization_time,
      'machineAuthorizationTimeWire',receipt.machine_authorization_time_wire,
      'machineAuthorizationTimeSerializationMode',
        receipt.machine_authorization_time_serialization_mode,
      'refundEmailListMode',receipt.refund_email_list_mode,
      'originalAmountCents',receipt.amount_cents,
      'cardLast4',receipt.card_last4,'currencyCode',receipt.currency_code),
    'payloadRedacted',true)
  from public.refund_nayax_system_saved_approval_receipts receipt
  join public.refund_case_nayax_refund_attempts attempt
    on attempt.id=receipt.nayax_refund_attempt_id
    and attempt.refund_case_id=receipt.refund_case_id
    and attempt.system_saved_approval_receipt_id=receipt.id
  where receipt.id=p_receipt_id and receipt.status='consumed'
    and attempt.status='in_progress' and attempt.provider_outcome is null
    and attempt.provider_claim_consumed_at is null
    and attempt.provider_claim_expires_at>statement_timestamp()
    and attempt.provider_claim_digest=encode(extensions.digest(convert_to(
      p_provider_claim_token,'UTF8'),'sha256'),'hex');
$$;
revoke all on function public.refund_nayax_system_saved_approval_reservation_payload_v1(uuid,text)
  from public,anon,authenticated,service_role;

-- The scheduled worker is the only creator. Case, source approval, candidate,
-- and machine are locked and revalidated in this transaction; receipt and
-- attempt either commit together or neither exists.
create function public.service_claim_due_nayax_system_saved_approvals_v1(
  p_executor_assertion text,p_account_key text,p_serialization_mode text,
  p_refund_email_list_mode text,p_limit integer default 1
)
returns jsonb language plpgsql security definer set search_path='' as $$
declare
  target_case public.refund_cases%rowtype;
  source_approval public.refund_case_official_action_authorizations%rowtype;
  selected_candidate public.refund_nayax_lookup_candidates%rowtype;
  machine public.reporting_machines%rowtype;
  system_receipt public.refund_nayax_system_saved_approval_receipts%rowtype;
  attempt public.refund_case_nayax_refund_attempts%rowtype;
  snapshot jsonb;
  execution_context jsonb;
  v_provider_claim_token text;
  v_provider_claim_digest text;
  v_idempotency_key text;
  request_fingerprint text;
  claims jsonb:='[]'::jsonb;
begin
  perform public.assert_nayax_provider_executor(p_executor_assertion);
  if nullif(btrim(p_account_key),'') is null
    or p_serialization_mode not in ('exact_source','source_with_bound_offset')
    or p_refund_email_list_mode not in ('omit','empty_string')
    or p_limit is distinct from 1 then
    raise exception 'Exact System refund worker contract required' using errcode='P4620';
  end if;
  for target_case in
    select refund_case.* from public.refund_cases refund_case
    join public.reporting_machines selector_machine
      on selector_machine.id=refund_case.reporting_machine_id
    where refund_case.payment_method='card'
      and refund_case.status='card_refund_pending'
      and refund_case.decision='approved'
      and refund_case.nayax_refund_execution_status='not_requested'
      and selector_machine.nayax_account_key=p_account_key
      and not exists(select 1 from public.refund_case_events held_event
        where held_event.refund_case_id=refund_case.id
          and held_event.event_type='nayax_system_saved_approval_held')
    order by refund_case.decided_at nulls last,refund_case.id
    limit p_limit for update skip locked
  loop
    begin
    snapshot:=public.refund_nayax_system_saved_approval_snapshot_v1(target_case.id);
    if snapshot is null then
      raise exception 'Saved approval evidence is missing or ambiguous'
        using errcode='P4620';
    end if;
    select approval.* into strict source_approval
    from public.refund_case_official_action_authorizations approval
    where approval.id=(snapshot->>'sourceApprovalAuthorizationId')::uuid
      and approval.refund_case_id=target_case.id for share;
    select candidate.* into strict selected_candidate
    from public.refund_nayax_lookup_candidates candidate
    where candidate.token=(snapshot->>'selectedNayaxCandidateToken')::uuid
      and candidate.refund_case_id=target_case.id for share;
    select machine_row.* into strict machine from public.reporting_machines machine_row
    where machine_row.id=target_case.reporting_machine_id for share;
    if snapshot is distinct from
      public.refund_nayax_system_saved_approval_snapshot_v1(target_case.id) then
      raise exception 'Saved approval evidence changed while System locked it'
        using errcode='P4620';
    end if;
    execution_context:=public.refund_nayax_selected_execution_context_v3(
      target_case.id,p_serialization_mode,p_refund_email_list_mode);
    if execution_context is null
      or execution_context->>'accountScope' is distinct from machine.nayax_account_key
      or machine.nayax_account_key is distinct from p_account_key
      or execution_context->>'contextHash'!~'^[a-f0-9]{64}$'
      or execution_context->>'caseId' is distinct from target_case.id::text
      or (execution_context->>'caseVersion')::bigint is distinct from
        target_case.official_action_version
      or (execution_context->>'attemptGeneration')::integer is distinct from
        target_case.nayax_refund_attempt_generation
      or execution_context->>'reportingMachineId' is distinct from machine.id::text
      or execution_context->>'providerMachineId' is distinct from machine.nayax_machine_id
      or execution_context->>'transactionId' is distinct from snapshot->>'transactionId'
      or (execution_context->>'siteId')::integer is distinct from
        target_case.matched_nayax_site_id
      or (execution_context->>'originalAmountCents')::integer is distinct from
        target_case.matched_nayax_amount_cents
      or execution_context->>'currencyCode' is distinct from 'USD'
      or execution_context->>'machineAuthorizationTime' is distinct from
        snapshot->>'machineAuthorizationTimeRaw'
      or execution_context->>'machineAuthorizationTimeSerializationMode'
        is distinct from p_serialization_mode
      or coalesce(execution_context->>'refundEmailListMode','omit')
        is distinct from p_refund_email_list_mode then
      raise exception 'Frozen System provider request does not match the approved purchase'
        using errcode='P4620';
    end if;
    perform pg_catalog.set_config('bloomjoy.system_saved_approval_writer',
      'service_creator_v1',true);
    insert into public.refund_nayax_system_saved_approval_receipts(
      refund_case_id,source_approval_authorization_id,
      selected_nayax_candidate_token,selected_nayax_candidate_evidence_hash,
      original_actor_user_id,original_authority_kind,
      original_manager_mapping_id,original_manager_mapping_version,
      original_super_admin_role_id,confirmed_case_version,
      deterministic_fact_version,attempt_generation,reporting_machine_id,
      provider_machine_id,provider_account_scope_digest,transaction_id,site_id,
      machine_authorization_time,machine_authorization_time_raw,
      machine_authorization_time_wire,machine_authorization_time_serialization_mode,
      refund_email_list_mode,provider_contract_version,journal_contract_version,
      execution_context_hash,amount_cents,card_last4,currency_code,
      saved_approval_evidence_hash)
    values(target_case.id,source_approval.id,selected_candidate.token,
      snapshot->>'selectedNayaxCandidateEvidenceHash',source_approval.actor_user_id,
      source_approval.authority_kind,source_approval.manager_mapping_id,
      source_approval.manager_mapping_version,source_approval.super_admin_role_id,
      (snapshot->>'confirmedCaseVersion')::bigint,
      (snapshot->>'deterministicFactVersion')::bigint,
      (snapshot->>'attemptGeneration')::integer,target_case.reporting_machine_id,
      machine.nayax_machine_id,snapshot->>'providerAccountScopeDigest',
      target_case.matched_nayax_transaction_id,target_case.matched_nayax_site_id,
      target_case.matched_nayax_machine_auth_time,
      execution_context->>'machineAuthorizationTime',
      execution_context->>'machineAuthorizationTimeWire',p_serialization_mode,
      p_refund_email_list_mode,'nayax-production-account-contract-v2',
      'nayax-provider-journal-v3',execution_context->>'contextHash',
      target_case.matched_nayax_amount_cents,target_case.matched_nayax_card_last4,
      'USD',snapshot->>'savedApprovalEvidenceHash') returning * into system_receipt;
    v_idempotency_key:='nayax-refund-'||encode(extensions.digest(convert_to(
      'system-saved-approval-v1|'||system_receipt.id::text||'|'||
      system_receipt.saved_approval_evidence_hash,'UTF8'),'sha256'),'hex');
    v_provider_claim_token:=encode(extensions.gen_random_bytes(32),'hex');
    v_provider_claim_digest:=encode(extensions.digest(convert_to(
      v_provider_claim_token,'UTF8'),'sha256'),'hex');
    update public.refund_nayax_system_saved_approval_receipts receipt_row
    set status='claimed',claimed_at=statement_timestamp()
    where receipt_row.id=system_receipt.id returning receipt_row.* into system_receipt;
    request_fingerprint:=public.refund_nayax_attempt_request_fingerprint(
      system_receipt.id,target_case.id,v_idempotency_key,system_receipt.amount_cents,
      'USD',system_receipt.saved_approval_evidence_hash);
    perform public.refund_claim_exact_nayax_transaction(
      target_case.id,null,execution_context);
    insert into public.refund_case_nayax_refund_attempts(
      refund_case_id,actor_user_id,execution_mode,status,idempotency_key,
      amount_cents,transaction_id_present,site_id_present,machine_auth_time_present,
      sanitized_request,sanitized_response,official_action_authorization_id,
      step_up_intent_id,request_fingerprint,currency_code,provider_claim_digest,
      provider_claim_expires_at,reconciliation_required,
      system_saved_approval_receipt_id)
    values(target_case.id,null,'request_and_approve',
      'in_progress',v_idempotency_key,system_receipt.amount_cents,true,true,true,
      jsonb_build_object('request_fingerprint',request_fingerprint,
        'amount_cents',system_receipt.amount_cents,'currency_code','USD',
        'transaction_id_present',true,'site_id_present',true,
        'machine_authorization_time_present',true,'payload_redacted',true),
      '{}'::jsonb,null,null,request_fingerprint,'USD',v_provider_claim_digest,
      statement_timestamp()+interval '5 minutes',true,system_receipt.id)
    returning * into attempt;
    insert into public.refund_nayax_execution_contexts(attempt_id,refund_case_id,context)
    values(attempt.id,target_case.id,execution_context);
    perform public.refund_claim_exact_nayax_transaction(
      target_case.id,attempt.id,execution_context);
    update public.refund_nayax_system_saved_approval_receipts receipt_row
    set status='consumed',consumed_at=statement_timestamp(),
      nayax_refund_attempt_id=attempt.id
    where receipt_row.id=system_receipt.id returning receipt_row.* into system_receipt;
    perform pg_catalog.set_config('bloomjoy.nayax_settlement_attempt_id',
      attempt.id::text,true);
    update public.refund_cases set nayax_refund_execution_status='requested',
      nayax_match_execution_eligible=false where id=target_case.id;
    insert into public.refund_case_events(
      refund_case_id,actor_user_id,event_type,message,metadata)
    values(target_case.id,null,
      'nayax_system_saved_approval_reserved',
      'System reserved the already-approved exact Nayax refund once.',
      jsonb_build_object('attempt_id',attempt.id,
        'source_approval_authorization_id',source_approval.id,
        'original_approver_user_id',source_approval.actor_user_id,
        'system_receipt_id',system_receipt.id,'provider_claim_present',true,
        'payload_redacted',true));
    claims:=claims||jsonb_build_array(
      public.refund_nayax_system_saved_approval_reservation_payload_v1(
        system_receipt.id,v_provider_claim_token));
    exception when others then
      insert into public.refund_case_events(
        refund_case_id,actor_user_id,event_type,message,metadata)
      values(target_case.id,null,'nayax_system_saved_approval_held',
        'System held this approved refund because its exact evidence could not be frozen safely.',
        jsonb_build_object('reason_code','system_evidence_revalidation_failed',
          'sqlstate',sqlstate,'payload_redacted',true));
    end;
  end loop;
  return jsonb_build_object('schemaVersion','nayax-system-saved-approval-v1',
    'claims',claims,'payloadRedacted',true);
end;
$$;
revoke all on function public.service_claim_due_nayax_system_saved_approvals_v1(
  text,text,text,text,integer) from public,anon,authenticated;
grant execute on function public.service_claim_due_nayax_system_saved_approvals_v1(
  text,text,text,text,integer) to service_role;

-- A lost RPC response may be reclaimed only on the same receipt and attempt,
-- and only when the immutable journal proves provider transport never began.
create function public.service_reclaim_nayax_system_saved_approval_no_call_v1(
  p_executor_assertion text,p_account_key text
)
returns jsonb language plpgsql security definer set search_path='' as $$
declare
  receipt public.refund_nayax_system_saved_approval_receipts%rowtype;
  attempt public.refund_case_nayax_refund_attempts%rowtype;
  v_provider_claim_token text;
  v_provider_claim_digest text;
begin
  perform public.assert_nayax_provider_executor(p_executor_assertion);
  select receipt_row.* into receipt
  from public.refund_nayax_system_saved_approval_receipts receipt_row
  join public.refund_case_nayax_refund_attempts attempt_row
    on attempt_row.id=receipt_row.nayax_refund_attempt_id
    and attempt_row.refund_case_id=receipt_row.refund_case_id
  join public.reporting_machines machine
    on machine.id=receipt_row.reporting_machine_id
  where receipt_row.status='consumed'
    and attempt_row.status='in_progress' and attempt_row.provider_outcome is null
    and attempt_row.provider_claim_consumed_at is null
    and attempt_row.provider_claim_expires_at<=statement_timestamp()
    and machine.nayax_account_key=p_account_key
  order by attempt_row.provider_claim_expires_at,receipt_row.id
  limit 1 for update of receipt_row,attempt_row skip locked;
  if not found then
    return jsonb_build_object('schemaVersion','nayax-system-saved-approval-v1',
      'claim',null,'payloadRedacted',true);
  end if;
  select * into strict attempt from public.refund_case_nayax_refund_attempts
  where id=receipt.nayax_refund_attempt_id for update;
  perform pg_catalog.set_config('bloomjoy.system_saved_approval_writer',
    'service_creator_v1',true);
  if exists(select 1 from public.refund_nayax_provider_stage_journal journal
    where journal.nayax_refund_attempt_id=attempt.id and journal.stage='request') then
    update public.refund_nayax_system_saved_approval_receipts receipt_row
    set status='held',held_at=statement_timestamp(),
      hold_reason='provider_transport_may_have_started'
    where receipt_row.id=receipt.id;
    insert into public.refund_case_events(
      refund_case_id,actor_user_id,event_type,message,metadata)
    values(receipt.refund_case_id,null,'nayax_system_saved_approval_held',
      'System found provider-start evidence and held the refund for reconciliation without retrying.',
      jsonb_build_object('system_receipt_id',receipt.id,'attempt_id',attempt.id,
        'reason_code','provider_transport_may_have_started',
        'original_approver_user_id',receipt.original_actor_user_id,
        'payload_redacted',true));
    return jsonb_build_object('schemaVersion','nayax-system-saved-approval-v1',
      'claim',null,'held',true,'payloadRedacted',true);
  end if;
  v_provider_claim_token:=encode(extensions.gen_random_bytes(32),'hex');
  v_provider_claim_digest:=encode(extensions.digest(convert_to(
    v_provider_claim_token,'UTF8'),'sha256'),'hex');
  update public.refund_case_nayax_refund_attempts attempt_row
  set provider_claim_digest=v_provider_claim_digest,
    provider_claim_expires_at=statement_timestamp()+interval '5 minutes'
  where attempt_row.id=attempt.id returning attempt_row.* into attempt;
  insert into public.refund_case_events(
    refund_case_id,actor_user_id,event_type,message,metadata)
  values(receipt.refund_case_id,null,'nayax_system_saved_approval_no_call_reclaimed',
    'System safely reclaimed the same attempt because no provider transport began.',
    jsonb_build_object('system_receipt_id',receipt.id,'attempt_id',attempt.id,
      'original_approver_user_id',receipt.original_actor_user_id,
      'payload_redacted',true));
  return jsonb_build_object('schemaVersion','nayax-system-saved-approval-v1',
    'claim',public.refund_nayax_system_saved_approval_reservation_payload_v1(
      receipt.id,v_provider_claim_token),'payloadRedacted',true);
end;
$$;
revoke all on function public.service_reclaim_nayax_system_saved_approval_no_call_v1(
  text,text) from public,anon,authenticated;
grant execute on function public.service_reclaim_nayax_system_saved_approval_no_call_v1(
  text,text) to service_role;

create function public.refund_nayax_system_saved_approval_attempt_valid_v1(
  p_receipt_id uuid,p_attempt_id uuid,p_case_id uuid
)
returns boolean language sql stable security definer set search_path='' as $$
  select exists(
    select 1
    from public.refund_nayax_system_saved_approval_receipts receipt
    join public.refund_case_nayax_refund_attempts attempt
      on attempt.id=receipt.nayax_refund_attempt_id
      and attempt.refund_case_id=receipt.refund_case_id
      and attempt.system_saved_approval_receipt_id=receipt.id
    join public.refund_cases refund_case on refund_case.id=receipt.refund_case_id
    join public.reporting_machines machine on machine.id=receipt.reporting_machine_id
    join public.refund_nayax_execution_contexts saved
      on saved.attempt_id=attempt.id and saved.refund_case_id=receipt.refund_case_id
    join public.refund_case_official_action_authorizations source_approval
      on source_approval.id=receipt.source_approval_authorization_id
      and source_approval.refund_case_id=receipt.refund_case_id
    join public.refund_nayax_lookup_candidates selected_candidate
      on selected_candidate.token=receipt.selected_nayax_candidate_token
      and selected_candidate.refund_case_id=receipt.refund_case_id
    where receipt.id=p_receipt_id and attempt.id=p_attempt_id
      and refund_case.id=p_case_id and receipt.status='consumed'
      and receipt.consumed_at is not null
      and source_approval.status='consumed' and source_approval.action='approve'
      and source_approval.authorization_method='manager_session'
      and source_approval.actor_user_id=receipt.original_actor_user_id
      and source_approval.expected_case_version+1=receipt.confirmed_case_version
      and source_approval.selected_nayax_candidate_token=
        receipt.selected_nayax_candidate_token
      and source_approval.selected_nayax_candidate_evidence_hash=
        receipt.selected_nayax_candidate_evidence_hash
      and source_approval.authority_kind=receipt.original_authority_kind
      and source_approval.manager_mapping_id is not distinct from
        receipt.original_manager_mapping_id
      and source_approval.manager_mapping_version is not distinct from
        receipt.original_manager_mapping_version
      and source_approval.super_admin_role_id is not distinct from
        receipt.original_super_admin_role_id
      and public.refund_nayax_candidate_evidence_hash(
        selected_candidate.refund_case_id,selected_candidate.actor_user_id,
        selected_candidate.provider_transaction_id,selected_candidate.site_id,
        selected_candidate.machine_authorization_time,selected_candidate.amount_cents,
        selected_candidate.card_last4,selected_candidate.currency_code,
        selected_candidate.evidence_summary,selected_candidate.expires_at,
        selected_candidate.created_at)=receipt.selected_nayax_candidate_evidence_hash
      and attempt.actor_user_id is null
      and attempt.official_action_authorization_id is null
      and attempt.step_up_intent_id is null
      and attempt.execution_mode='request_and_approve'
      and attempt.request_fingerprint=public.refund_nayax_attempt_request_fingerprint(
        receipt.id,receipt.refund_case_id,attempt.idempotency_key,
        receipt.amount_cents,receipt.currency_code,
        receipt.saved_approval_evidence_hash)
      and attempt.provider_claim_digest~'^[a-f0-9]{64}$'
      and attempt.provider_claim_expires_at is not null
      and refund_case.official_action_version=receipt.confirmed_case_version
      and refund_case.deterministic_fact_version=receipt.deterministic_fact_version
      and refund_case.nayax_refund_attempt_generation=receipt.attempt_generation
      and refund_case.reporting_machine_id=receipt.reporting_machine_id
      and refund_case.matched_nayax_transaction_id=receipt.transaction_id
      and refund_case.matched_nayax_site_id=receipt.site_id
      and refund_case.matched_nayax_machine_auth_time=receipt.machine_authorization_time
      and refund_case.matched_nayax_amount_cents=receipt.amount_cents
      and refund_case.matched_nayax_card_last4 is not distinct from receipt.card_last4
      and refund_case.matched_nayax_currency_code=receipt.currency_code
      and machine.nayax_machine_id=receipt.provider_machine_id
      and encode(extensions.digest(convert_to(regexp_replace(
        upper(btrim(machine.nayax_account_key)),'[^A-Z0-9_]','_','g'),
        'UTF8'),'sha256'),'hex')=receipt.provider_account_scope_digest
      and saved.context->>'caseId'=receipt.refund_case_id::text
      and saved.context->>'contextHash'=receipt.execution_context_hash
      and saved.context->>'contextHash'=encode(extensions.digest(convert_to(
        (saved.context-'contextHash')::text,'UTF8'),'sha256'),'hex')
      and saved.context->>'providerMachineId'=receipt.provider_machine_id
      and saved.context->>'transactionId'=receipt.transaction_id
      and (saved.context->>'siteId')::integer=receipt.site_id
      and saved.context->>'machineAuthorizationTime'=receipt.machine_authorization_time_raw
      and saved.context->>'machineAuthorizationTimeWire'=receipt.machine_authorization_time_wire
      and saved.context->>'machineAuthorizationTimeSerializationMode'=
        receipt.machine_authorization_time_serialization_mode
      and coalesce(saved.context->>'refundEmailListMode','omit')=
        receipt.refund_email_list_mode
      and (saved.context->>'originalAmountCents')::integer=receipt.amount_cents
      and saved.context->>'currencyCode'=receipt.currency_code
      and encode(extensions.digest(convert_to(regexp_replace(
        upper(btrim(saved.context->>'accountScope')),'[^A-Z0-9_]','_','g'),
        'UTF8'),'sha256'),'hex')=receipt.provider_account_scope_digest
  );
$$;
revoke all on function public.refund_nayax_system_saved_approval_attempt_valid_v1(uuid,uuid,uuid)
  from public,anon,authenticated,service_role;

-- Terminal replay validates the same immutable receipt, candidate, attempt and
-- frozen provider context, but does not require the case to remain in its
-- pre-settlement lifecycle state.
create function public.refund_nayax_system_saved_approval_terminal_binding_valid_v1(
  p_receipt_id uuid,p_attempt_id uuid,p_case_id uuid
)
returns boolean language sql stable security definer set search_path='' as $$
  select exists(
    select 1
    from public.refund_nayax_system_saved_approval_receipts receipt
    join public.refund_case_nayax_refund_attempts attempt
      on attempt.id=receipt.nayax_refund_attempt_id
      and attempt.refund_case_id=receipt.refund_case_id
      and attempt.system_saved_approval_receipt_id=receipt.id
    join public.refund_cases refund_case on refund_case.id=receipt.refund_case_id
    join public.reporting_machines machine on machine.id=receipt.reporting_machine_id
    join public.refund_case_official_action_authorizations source_approval
      on source_approval.id=receipt.source_approval_authorization_id
      and source_approval.refund_case_id=receipt.refund_case_id
    join public.refund_nayax_lookup_candidates selected_candidate
      on selected_candidate.token=receipt.selected_nayax_candidate_token
      and selected_candidate.refund_case_id=receipt.refund_case_id
    join public.refund_nayax_execution_contexts saved
      on saved.attempt_id=attempt.id and saved.refund_case_id=receipt.refund_case_id
    where receipt.id=p_receipt_id and attempt.id=p_attempt_id
      and refund_case.id=p_case_id and receipt.status in ('consumed','held')
      and receipt.consumed_at is not null
      and source_approval.status='consumed' and source_approval.action='approve'
      and source_approval.authorization_method='manager_session'
      and source_approval.actor_user_id=receipt.original_actor_user_id
      and source_approval.expected_case_version+1=receipt.confirmed_case_version
      and source_approval.selected_nayax_candidate_token=receipt.selected_nayax_candidate_token
      and source_approval.selected_nayax_candidate_evidence_hash=
        receipt.selected_nayax_candidate_evidence_hash
      and source_approval.authority_kind=receipt.original_authority_kind
      and source_approval.manager_mapping_id is not distinct from
        receipt.original_manager_mapping_id
      and source_approval.manager_mapping_version is not distinct from
        receipt.original_manager_mapping_version
      and source_approval.super_admin_role_id is not distinct from
        receipt.original_super_admin_role_id
      and public.refund_nayax_candidate_evidence_hash(
        selected_candidate.refund_case_id,selected_candidate.actor_user_id,
        selected_candidate.provider_transaction_id,selected_candidate.site_id,
        selected_candidate.machine_authorization_time,selected_candidate.amount_cents,
        selected_candidate.card_last4,selected_candidate.currency_code,
        selected_candidate.evidence_summary,selected_candidate.expires_at,
        selected_candidate.created_at)=receipt.selected_nayax_candidate_evidence_hash
      and attempt.actor_user_id is null
      and attempt.official_action_authorization_id is null
      and attempt.step_up_intent_id is null
      and attempt.execution_mode='request_and_approve'
      and attempt.request_fingerprint=public.refund_nayax_attempt_request_fingerprint(
        receipt.id,receipt.refund_case_id,attempt.idempotency_key,
        receipt.amount_cents,receipt.currency_code,receipt.saved_approval_evidence_hash)
      and refund_case.reporting_machine_id=receipt.reporting_machine_id
      and refund_case.matched_nayax_transaction_id=receipt.transaction_id
      and refund_case.matched_nayax_site_id=receipt.site_id
      and refund_case.matched_nayax_machine_auth_time=receipt.machine_authorization_time
      and refund_case.matched_nayax_amount_cents=receipt.amount_cents
      and refund_case.matched_nayax_card_last4 is not distinct from receipt.card_last4
      and refund_case.matched_nayax_currency_code=receipt.currency_code
      and machine.nayax_machine_id=receipt.provider_machine_id
      and saved.context->>'caseId'=receipt.refund_case_id::text
      and (saved.context->>'caseVersion')::bigint=receipt.confirmed_case_version
      and (saved.context->>'attemptGeneration')::integer=receipt.attempt_generation
      and saved.context->>'contextHash'=receipt.execution_context_hash
      and saved.context->>'contextHash'=encode(extensions.digest(convert_to(
        (saved.context-'contextHash')::text,'UTF8'),'sha256'),'hex')
      and saved.context->>'providerMachineId'=receipt.provider_machine_id
      and saved.context->>'transactionId'=receipt.transaction_id
      and (saved.context->>'siteId')::integer=receipt.site_id
      and saved.context->>'machineAuthorizationTime'=receipt.machine_authorization_time_raw
      and saved.context->>'machineAuthorizationTimeWire'=receipt.machine_authorization_time_wire
      and saved.context->>'machineAuthorizationTimeSerializationMode'=
        receipt.machine_authorization_time_serialization_mode
      and coalesce(saved.context->>'refundEmailListMode','omit')=receipt.refund_email_list_mode
      and (saved.context->>'originalAmountCents')::integer=receipt.amount_cents
      and saved.context->>'currencyCode'=receipt.currency_code
      and encode(extensions.digest(convert_to(regexp_replace(
        upper(btrim(saved.context->>'accountScope')),'[^A-Z0-9_]','_','g'),
        'UTF8'),'sha256'),'hex')=receipt.provider_account_scope_digest
  );
$$;
revoke all on function public.refund_nayax_system_saved_approval_terminal_binding_valid_v1(
  uuid,uuid,uuid) from public,anon,authenticated,service_role;

create function public.refund_nayax_system_definitive_rejection_proved_v1(
  p_receipt_id uuid,p_attempt_id uuid,p_case_id uuid
)
returns boolean language sql stable security definer set search_path='' as $$
  select public.refund_nayax_system_saved_approval_terminal_binding_valid_v1(
      p_receipt_id,p_attempt_id,p_case_id)
    and exists(
      select 1 from public.refund_case_nayax_refund_attempts attempt
      join public.refund_nayax_provider_stage_journal final_result
        on final_result.nayax_refund_attempt_id=attempt.id
        and final_result.pending_approval_recovery_id is null
        and final_result.event='result'
      where attempt.id=p_attempt_id and attempt.refund_case_id=p_case_id
        and attempt.execution_mode='request_and_approve'
        and attempt.status='declined' and attempt.provider_outcome='rejected'
        and attempt.provider_outcome_recorded_at is not null
        and attempt.provider_claim_consumed_at is not null
        and not attempt.reconciliation_required and attempt.completed_at is not null
        and attempt.reporting_adjustment_id is null
        and attempt.case_finalization_committed_at is null
        and final_result.outcome='rejected' and final_result.contract_matched
        and final_result.failure_type is null and final_result.http_status=200
        and final_result.http_accepted and final_result.media_type_class='application_json'
        and final_result.body_kind='json_object' and final_result.json_parsed
        and final_result.body_json_object and final_result.schema_matched
        and final_result.result_key_present and final_result.status_key_present
        and final_result.result_value_type='string'
        and final_result.status_value_type='string'
        and final_result.semantic_pair_matched
        and final_result.provider_contract_version=
          'nayax-production-account-contract-v2'
        and final_result.journal_contract_version='nayax-provider-journal-v3'
        and final_result.classification_digest~'^[a-f0-9]{64}$'
        and ((final_result.stage='request' and not final_result.approval_authorized
            and not exists(select 1 from public.refund_nayax_provider_stage_journal later
              where later.nayax_refund_attempt_id=attempt.id
                and later.pending_approval_recovery_id is null
                and later.stage='approve'))
          or (final_result.stage='approve' and exists(select 1
              from public.refund_nayax_provider_stage_journal request_result
              where request_result.nayax_refund_attempt_id=attempt.id
                and request_result.pending_approval_recovery_id is null
                and request_result.stage='request' and request_result.event='result'
                and request_result.outcome='accepted'
                and request_result.approval_authorized
                and request_result.contract_matched and request_result.http_status=200
                and request_result.http_accepted
                and request_result.journal_contract_version='nayax-provider-journal-v3'
                and request_result.provider_contract_version=
                  'nayax-production-account-contract-v2')))
    );
$$;
revoke all on function public.refund_nayax_system_definitive_rejection_proved_v1(
  uuid,uuid,uuid) from public,anon,authenticated,service_role;

-- Provider-stage writes recognize either the ordinary immutable manager
-- receipt or this separately validated System receipt. Neither branch checks
-- the manager's current role, assignment, or browser session.
create or replace function public.guard_refund_nayax_execution_context_stage()
returns trigger language plpgsql security definer set search_path='' as $$
declare
  attempt_row public.refund_case_nayax_refund_attempts%rowtype;
  case_row public.refund_cases%rowtype;
  machine_row public.reporting_machines%rowtype;
  execution_context jsonb;
  current_execution_authorized boolean:=false;
begin
  select * into strict attempt_row from public.refund_case_nayax_refund_attempts
  where id=new.nayax_refund_attempt_id;
  select context into execution_context from public.refund_nayax_execution_contexts
  where attempt_id=attempt_row.id;
  if execution_context is not null and new.journal_contract_version is distinct from
    'nayax-provider-journal-v3' then
    raise exception 'Execution context requires the current provider journal contract'
      using errcode='P4620';
  end if;
  if new.event<>'started' or new.journal_contract_version is distinct from
    'nayax-provider-journal-v3' then return new; end if;
  select * into strict case_row from public.refund_cases
  where id=attempt_row.refund_case_id for share;
  select * into strict machine_row from public.reporting_machines
  where id=case_row.reporting_machine_id for share;
  current_execution_authorized:=
    public.refund_official_action_receipt_authority_valid(
      attempt_row.official_action_authorization_id,case_row.reporting_machine_id)
    or public.refund_nayax_system_saved_approval_attempt_valid_v1(
      attempt_row.system_saved_approval_receipt_id,attempt_row.id,case_row.id);
  if new.stage='approve' then
    current_execution_authorized:=current_execution_authorized or exists(
      select 1 from public.refund_nayax_attempt_approval_continuations continuation
      where continuation.nayax_refund_attempt_id=attempt_row.id
        and continuation.refund_case_id=case_row.id
        and continuation.official_action_authorization_id=
          attempt_row.official_action_authorization_id
        and continuation.attempt_generation=case_row.nayax_refund_attempt_generation
        and continuation.execution_context_hash=execution_context->>'contextHash'
        and continuation.provider_claim_digest=attempt_row.provider_claim_digest
        and continuation.provider_claim_expires_at=attempt_row.provider_claim_expires_at
        and public.refund_official_action_receipt_authority_valid(
          continuation.official_action_authorization_id,
          case_row.reporting_machine_id)
        and (not exists(select 1
              from public.refund_nayax_server_approval_continuation_claims server_claim
              where server_claim.nayax_refund_attempt_id=attempt_row.id)
          or exists(select 1
              from public.refund_nayax_server_approval_continuation_claims server_claim
              where server_claim.nayax_refund_attempt_id=attempt_row.id
                and server_claim.refund_case_id=case_row.id
                and server_claim.approval_continuation_attempt_id=
                  continuation.nayax_refund_attempt_id
                and server_claim.official_action_authorization_id=
                  continuation.official_action_authorization_id
                and server_claim.execution_context_hash=
                  continuation.execution_context_hash
                and server_claim.provider_claim_digest=
                  continuation.provider_claim_digest)));
  end if;
  if execution_context is null
    or execution_context->>'caseId' is distinct from case_row.id::text
    or execution_context->>'reportingMachineId' is distinct from machine_row.id::text
    or execution_context->>'accountScope' is distinct from machine_row.nayax_account_key
    or execution_context->>'providerMachineId' is distinct from machine_row.nayax_machine_id
    or execution_context->>'transactionId' is distinct from case_row.matched_nayax_transaction_id
    or (execution_context->>'siteId')::integer is distinct from case_row.matched_nayax_site_id
    or (execution_context->>'attemptGeneration')::integer is distinct from
      case_row.nayax_refund_attempt_generation
    or (execution_context->>'originalAmountCents')::integer is distinct from
      case_row.matched_nayax_amount_cents
    or (execution_context->>'originalAmountCents')::integer is distinct from attempt_row.amount_cents
    or execution_context->>'currencyCode' is distinct from attempt_row.currency_code
    or machine_row.status<>'active' or machine_row.nayax_refunds_enabled is distinct from true
    or not current_execution_authorized then
    raise exception 'Selected Nayax purchase or immutable approval evidence changed'
      using errcode='P4620';
  end if;
  return new;
end;
$$;
revoke all on function public.guard_refund_nayax_execution_context_stage()
  from public,anon,authenticated,service_role;

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
        left join public.refund_case_official_action_authorizations action_authorization
          on action_authorization.id=attempt.official_action_authorization_id
        where attempt.id=settlement_attempt_id and attempt.refund_case_id=old.id
          and attempt.status='in_progress' and attempt.provider_outcome is null
          and attempt.provider_claim_consumed_at is null
          and attempt.provider_claim_expires_at>statement_timestamp()
          and attempt.provider_claim_digest=settlement_provider_claim_digest
          and ((action_authorization.status='consumed'
              and action_authorization.authorization_method='manager_session'
              and action_authorization.step_up_intent_id is null
              and action_authorization.verified_totp_at is null)
            or public.refund_nayax_system_saved_approval_attempt_valid_v1(
              attempt.system_saved_approval_receipt_id,attempt.id,old.id))) then
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

-- Proof used only when Nayax succeeded but an unrelated accounting row arrived
-- after approval. It recognizes the dedicated System receipt and the exact
-- frozen v3 request/approval journal; it never recognizes browser authority.
create function public.refund_nayax_system_unsettled_api_success_proved_v1(
  p_case_id uuid,p_attempt_id uuid
)
returns boolean language sql stable security definer set search_path='' as $$
  select exists(
    select 1
    from public.refund_cases refund_case
    join public.reporting_machines machine
      on machine.id=refund_case.reporting_machine_id
    join public.refund_case_nayax_refund_attempts attempt
      on attempt.id=p_attempt_id and attempt.refund_case_id=refund_case.id
    join public.refund_nayax_system_saved_approval_receipts receipt
      on receipt.id=attempt.system_saved_approval_receipt_id
      and receipt.refund_case_id=refund_case.id
    join public.refund_nayax_execution_contexts saved
      on saved.attempt_id=attempt.id and saved.refund_case_id=refund_case.id
    join public.refund_nayax_provider_stage_journal request_journal
      on request_journal.nayax_refund_attempt_id=attempt.id
      and request_journal.pending_approval_recovery_id is null
      and request_journal.stage='request' and request_journal.event='result'
    join public.refund_nayax_provider_business_outcomes request_outcome
      on request_outcome.provider_stage_journal_id=request_journal.id
      and request_outcome.nayax_refund_attempt_id=attempt.id
      and request_outcome.stage='request'
    join public.refund_nayax_provider_stage_journal approve_journal
      on approve_journal.nayax_refund_attempt_id=attempt.id
      and approve_journal.pending_approval_recovery_id is null
      and approve_journal.stage='approve' and approve_journal.event='result'
    join public.refund_nayax_provider_business_outcomes approve_outcome
      on approve_outcome.provider_stage_journal_id=approve_journal.id
      and approve_outcome.nayax_refund_attempt_id=attempt.id
      and approve_outcome.stage='approve'
    where refund_case.id=p_case_id
      and refund_case.case_population='customer'
      and refund_case.payment_method='card'
      and refund_case.status='card_refund_pending'
      and refund_case.decision='approved'
      and refund_case.nayax_refund_execution_status='requested'
      and refund_case.reporting_adjustment_id is null
      and refund_case.refund_completed_at is null
      and public.refund_nayax_system_saved_approval_attempt_valid_v1(
        receipt.id,attempt.id,refund_case.id)
      and attempt.status='in_progress' and attempt.provider_outcome is null
      and attempt.execution_mode='request_and_approve'
      and attempt.amount_cents=refund_case.refund_amount_cents
      and attempt.amount_cents=receipt.amount_cents
      and attempt.currency_code='USD'
      and saved.context->>'contextHash'=receipt.execution_context_hash
      and saved.context->>'contextHash'=encode(extensions.digest(convert_to(
        (saved.context-'contextHash')::text,'UTF8'),'sha256'),'hex')
      and saved.context->>'accountScope'=machine.nayax_account_key
      and saved.context->>'providerMachineId'=receipt.provider_machine_id
      and saved.context->>'transactionId'=receipt.transaction_id
      and (saved.context->>'siteId')::integer=receipt.site_id
      and (saved.context->>'originalAmountCents')::integer=receipt.amount_cents
      and saved.context->>'currencyCode'='USD'
      and request_journal.http_status=200 and request_journal.http_accepted
      and request_journal.outcome='accepted' and request_journal.contract_matched
      and request_journal.approval_authorized and request_journal.schema_matched
      and request_journal.semantic_pair_matched
      and request_journal.journal_contract_version=receipt.journal_contract_version
      and request_journal.provider_contract_version=receipt.provider_contract_version
      and approve_journal.http_status=200 and approve_journal.http_accepted
      and approve_journal.outcome='succeeded' and approve_journal.contract_matched
      and approve_journal.schema_matched and approve_journal.semantic_pair_matched
      and approve_journal.journal_contract_version=receipt.journal_contract_version
      and approve_journal.provider_contract_version=receipt.provider_contract_version
      and request_outcome.business_pair_retained
      and request_outcome.observed_scalar_pair_retained
      and approve_outcome.business_pair_retained
      and approve_outcome.observed_scalar_pair_retained
      and request_outcome.business_result=
        'Refund status updated successfully, but the email could not be sent'
      and request_outcome.business_status='Partial success'
      and request_outcome.observed_result_scalar=request_outcome.business_result
      and request_outcome.observed_status_scalar=request_outcome.business_status
      and approve_outcome.business_result=request_outcome.business_result
      and approve_outcome.business_status=request_outcome.business_status
      and approve_outcome.observed_result_scalar=approve_outcome.business_result
      and approve_outcome.observed_status_scalar=approve_outcome.business_status
      and request_journal.created_at<approve_journal.created_at
      and (select count(*) from public.refund_nayax_provider_stage_journal journal
        where journal.nayax_refund_attempt_id=attempt.id
          and journal.pending_approval_recovery_id is null
          and journal.stage='request' and journal.event='result')=1
      and (select count(*) from public.refund_nayax_provider_stage_journal journal
        where journal.nayax_refund_attempt_id=attempt.id
          and journal.pending_approval_recovery_id is null
          and journal.stage='approve' and journal.event='result')=1
      and not exists(select 1 from public.refund_nayax_provider_stage_journal journal
        where journal.nayax_refund_attempt_id=attempt.id
          and journal.pending_approval_recovery_id is not null)
  );
$$;
revoke all on function public.refund_nayax_system_unsettled_api_success_proved_v1(
  uuid,uuid) from public,anon,authenticated,service_role;

create function public.refund_record_nayax_system_late_accounting_exception_v1(
  p_case_id uuid,p_attempt_id uuid,p_system_saved_approval_receipt_id uuid
)
returns jsonb language plpgsql security definer set search_path='' as $$
declare
  refund_case public.refund_cases%rowtype;
  attempt public.refund_case_nayax_refund_attempts%rowtype;
  receipt public.refund_nayax_system_saved_approval_receipts%rowtype;
  machine public.reporting_machines%rowtype;
  execution_context jsonb;
  collision jsonb;
  approve_journal public.refund_nayax_provider_stage_journal%rowtype;
  terminal_receipt public.refund_authoritative_receipts%rowtype;
  completion_authority_id uuid;
  queued jsonb;
  evidence_digest text;
begin
  select * into strict refund_case from public.refund_cases
    where id=p_case_id for update;
  select * into strict attempt from public.refund_case_nayax_refund_attempts
    where id=p_attempt_id and refund_case_id=p_case_id for update;
  select * into strict receipt
    from public.refund_nayax_system_saved_approval_receipts
    where id=p_system_saved_approval_receipt_id and refund_case_id=p_case_id
      and nayax_refund_attempt_id=p_attempt_id for share;
  select * into strict machine from public.reporting_machines
    where id=refund_case.reporting_machine_id for share;
  select context into strict execution_context
    from public.refund_nayax_execution_contexts where attempt_id=attempt.id
      and refund_case_id=refund_case.id;
  collision:=public.refund_nayax_late_accounting_collision(
    refund_case.id,attempt.id);
  if collision->>'present' is distinct from 'true'
    or not public.refund_nayax_system_unsettled_api_success_proved_v1(
      refund_case.id,attempt.id) then
    raise exception 'System accounting exception requires exact successful provider evidence and a current collision'
      using errcode='P4677';
  end if;
  select * into strict approve_journal
  from public.refund_nayax_provider_stage_journal journal
  where journal.nayax_refund_attempt_id=attempt.id
    and journal.pending_approval_recovery_id is null
    and journal.stage='approve' and journal.event='result';
  insert into public.refund_accounting_exceptions(
    refund_case_id,nayax_refund_attempt_id,exception_kind,
    conflicting_refund_case_id,conflicting_adjustment_id)
  values(refund_case.id,attempt.id,'refund_business_fingerprint_collision',
    nullif(collision->>'conflictingRefundCaseId','')::uuid,
    nullif(collision->>'conflictingAdjustmentId','')::uuid)
  on conflict(refund_case_id) do nothing;
  evidence_digest:=encode(extensions.digest(convert_to(jsonb_build_array(
    'refund_api_terminal_accounting_exception_v1',refund_case.id,attempt.id,
    execution_context->>'contextHash',approve_journal.id,
    approve_journal.created_at)::text,'UTF8'),'sha256'),'hex');
  insert into public.refund_authoritative_receipts(
    refund_case_id,nayax_refund_attempt_id,reporting_machine_id,account_scope,
    provider_machine_id,original_transaction_id,original_amount_cents,
    refunded_amount_cents,currency_code,provider_status,evidence_reference_digest,
    observed_at,recorded_by,attempt_binding_kind,current_provider_observation_reviewed,
    confirmation_source)
  values(refund_case.id,attempt.id,machine.id,execution_context->>'accountScope',
    execution_context->>'providerMachineId',execution_context->>'transactionId',
    (execution_context->>'originalAmountCents')::integer,attempt.amount_cents,
    attempt.currency_code,null,evidence_digest,approve_journal.created_at,
    receipt.original_actor_user_id,'proved_terminal_api',false,'api_stage_contract')
  on conflict(refund_case_id) do nothing;
  select * into terminal_receipt from public.refund_authoritative_receipts
    where refund_case_id=refund_case.id and nayax_refund_attempt_id=attempt.id;
  if terminal_receipt.id is null then
    raise exception 'Terminal receipt conflicts with existing payment evidence'
      using errcode='P4663';
  end if;
  update public.refund_nayax_transaction_allocations set allocation_state='refunded'
  where account_scope=execution_context->>'accountScope'
    and provider_machine_id=execution_context->>'providerMachineId'
    and original_transaction_id=execution_context->>'transactionId'
    and refund_case_id=refund_case.id and allocation_state='reserved';
  completion_authority_id:=public.refund_create_receipt_completion_automation_authority(
    refund_case.id,terminal_receipt.id,'nayax_api_terminal',
    'verified_terminal_refund_v1',terminal_receipt.evidence_reference_digest);
  queued:=public.service_ensure_refund_receipt_automatic_completion(
    refund_case.id,terminal_receipt.id,completion_authority_id);
  insert into public.refund_case_events(
    refund_case_id,actor_user_id,event_type,message,metadata)
  values(refund_case.id,null,'nayax_paid_accounting_exception_recorded',
    'Nayax payment succeeded. System recorded it and held the separate accounting conflict for review.',
    jsonb_build_object('attempt_id',attempt.id,'receipt_id',terminal_receipt.id,
      'system_saved_approval_receipt_id',receipt.id,
      'original_approver_user_id',receipt.original_actor_user_id,
      'accounting_exception_kind','refund_business_fingerprint_collision',
      'provider_call_made',false,'customer_message_sent',false,
      'payload_redacted',true));
  return jsonb_build_object('attempt',public.refund_nayax_attempt_snapshot(
      attempt.id,false),'updateApplied',true,'reportingAdjustmentPresent',false,
    'paymentTerminal',true,'accountingException',true,
    'accountingState','pending',
    'customerCompletionQueued',queued->>'status'='canonical_message',
    'terminalReceiptRecorded',true,'payloadRedacted',true);
end;
$$;
revoke all on function public.refund_record_nayax_system_late_accounting_exception_v1(
  uuid,uuid,uuid) from public,anon,authenticated,service_role;

create function public.service_settle_nayax_system_saved_approval_v1(
  p_executor_assertion text,p_attempt_id uuid,
  p_system_saved_approval_receipt_id uuid,p_case_id uuid,
  p_idempotency_key text,p_amount_cents integer,p_currency_code text,
  p_provider_claim_token text,p_provider_outcome text,p_provider_reference text,
  p_provider_status text,p_error_code text
)
returns jsonb language plpgsql security definer set search_path='' as $$
declare
  receipt public.refund_nayax_system_saved_approval_receipts%rowtype;
  attempt public.refund_case_nayax_refund_attempts%rowtype;
  refund_case public.refund_cases%rowtype;
  adjustment public.sales_adjustment_facts%rowtype;
  execution_context jsonb;
  normalized_outcome text:=lower(btrim(coalesce(p_provider_outcome,'')));
  normalized_reference text:=nullif(btrim(coalesce(p_provider_reference,'')),'');
  normalized_provider_status text:=nullif(btrim(coalesce(p_provider_status,'')),'');
  normalized_error_code text:=nullif(btrim(coalesce(p_error_code,'')),'');
  settled_at timestamptz:=statement_timestamp();
  terminal_receipt_id uuid;
  definitive_rejection boolean:=false;
begin
  perform public.assert_nayax_provider_executor(p_executor_assertion);
  if p_attempt_id is null or p_system_saved_approval_receipt_id is null
    or p_case_id is null or p_idempotency_key!~'^nayax-refund-[a-f0-9]{64}$'
    or p_amount_cents is null or p_amount_cents<=0
    or upper(btrim(coalesce(p_currency_code,'')))<>'USD'
    or normalized_outcome not in ('success','rejected','timeout','unknown') then
    raise exception 'Exact System settlement request required' using errcode='P4620';
  end if;
  if normalized_reference is not null
      and normalized_reference!~'^[A-Za-z0-9][A-Za-z0-9._:-]{5,119}$'
    or normalized_provider_status is not null
      and normalized_provider_status!~'^[A-Za-z0-9][A-Za-z0-9._:-]{0,119}$'
    or normalized_error_code is not null
      and normalized_error_code!~'^[A-Za-z0-9][A-Za-z0-9._:-]{0,119}$'
    or normalized_outcome='success' and normalized_reference is null then
    raise exception 'Safe provider settlement evidence required' using errcode='P4620';
  end if;
  select * into strict refund_case from public.refund_cases
    where id=p_case_id for update;
  select * into strict receipt
    from public.refund_nayax_system_saved_approval_receipts
    where id=p_system_saved_approval_receipt_id and refund_case_id=p_case_id for share;
  select * into strict attempt from public.refund_case_nayax_refund_attempts
    where id=p_attempt_id and refund_case_id=p_case_id for update;
  if attempt.provider_outcome is not null then
    if not public.refund_nayax_system_saved_approval_terminal_binding_valid_v1(
      receipt.id,attempt.id,refund_case.id) then
      raise exception 'System settlement replay changed immutable authority or provider context'
        using errcode='P4620';
    end if;
    if attempt.idempotency_key=p_idempotency_key
      and attempt.amount_cents=p_amount_cents and attempt.currency_code='USD'
      and attempt.provider_outcome=normalized_outcome then
      return jsonb_build_object('attempt',public.refund_nayax_attempt_snapshot(
        attempt.id,false),'updateApplied',false,
        'reportingAdjustmentPresent',attempt.reporting_adjustment_id is not null,
        'payloadRedacted',true);
    end if;
    raise exception 'System settlement replay changed immutable outcome evidence'
      using errcode='P4620';
  end if;
  if receipt.status<>'consumed'
    or not public.refund_nayax_system_saved_approval_attempt_valid_v1(
      receipt.id,attempt.id,refund_case.id)
    or attempt.idempotency_key<>p_idempotency_key
    or attempt.amount_cents<>p_amount_cents or attempt.currency_code<>'USD'
    or attempt.status<>'in_progress' or attempt.provider_claim_consumed_at is not null
    or attempt.provider_claim_expires_at<=settled_at
    or nullif(p_provider_claim_token,'') is null
    or attempt.provider_claim_digest<>encode(extensions.digest(convert_to(
      p_provider_claim_token,'UTF8'),'sha256'),'hex')
    or refund_case.nayax_refund_execution_status<>'requested'
    or refund_case.status<>'card_refund_pending'
    or refund_case.decision<>'approved'
    or refund_case.refund_amount_cents<>p_amount_cents
    or refund_case.reporting_adjustment_id is not null then
    raise exception 'System provider claim changed before settlement' using errcode='P4620';
  end if;
  perform pg_catalog.set_config('bloomjoy.nayax_settlement_attempt_id',
    attempt.id::text,true);
  perform pg_catalog.set_config('bloomjoy.nayax_settlement_provider_claim',
    p_provider_claim_token,true);
  select context into strict execution_context
  from public.refund_nayax_execution_contexts where attempt_id=attempt.id
    and refund_case_id=refund_case.id;

  if normalized_outcome='success'
    and normalized_provider_status is distinct from
      'approve_succeeded_contract_match' then
    raise exception 'Successful settlement requires the exact proved approval result'
      using errcode='P4620';
  end if;
  if normalized_outcome='success'
    and (public.refund_nayax_late_accounting_collision(
      refund_case.id,attempt.id)->>'present')::boolean then
    return public.refund_record_nayax_system_late_accounting_exception_v1(
      refund_case.id,attempt.id,receipt.id);
  end if;

  if normalized_outcome='success' then
    update public.refund_cases set status='completed',decision='approved',
      manual_refund_reference=normalized_reference,
      refund_completed_by=receipt.original_actor_user_id,
      refund_completed_at=settled_at,automation_state='completed',
      nayax_refund_execution_status='approved',nayax_match_execution_eligible=false
    where id=refund_case.id;
    insert into public.sales_adjustment_facts(
      reporting_machine_id,reporting_location_id,adjustment_date,adjustment_type,
      amount_cents,complaint_count,source,source_row_hash,source_reference,
      source_row_reference,refund_case_id,match_status,match_confidence,notes,raw_payload)
    values(refund_case.reporting_machine_id,refund_case.reporting_location_id,
      settled_at::date,'refund',p_amount_cents,1,'refund_case',refund_case.id::text,
      'refund_cases',refund_case.public_reference,refund_case.id,'applied',
      greatest(refund_case.correlation_confidence,0.01),
      'Bloomjoy refund case '||refund_case.public_reference,
      jsonb_build_object('refund_case_id',refund_case.id,
        'refund_case_reference',refund_case.public_reference,
        'refund_case_status','completed','refund_case_decision','approved',
        'payment_method',refund_case.payment_method,
        'correlation_source',refund_case.correlation_source,
        'correlation_has_card_lookup',true,'nayax_provider_attempt_id',attempt.id,
        'provider_reference_present',true,'payload_redacted',true))
    on conflict(source,source_reference,source_row_reference) do update set
      reporting_machine_id=excluded.reporting_machine_id,
      reporting_location_id=excluded.reporting_location_id,
      adjustment_date=excluded.adjustment_date,amount_cents=excluded.amount_cents,
      refund_case_id=excluded.refund_case_id,match_status=excluded.match_status,
      match_confidence=excluded.match_confidence,notes=excluded.notes,
      raw_payload=excluded.raw_payload returning * into adjustment;
    update public.refund_cases set reporting_adjustment_id=adjustment.id
      where id=refund_case.id;
    update public.refund_case_nayax_refund_attempts set status='succeeded',
      provider_reference=normalized_reference,
      provider_status=coalesce(normalized_provider_status,'approved'),error_code=null,
      sanitized_response=jsonb_build_object('provider_outcome','success',
        'provider_reference_present',true,'payload_redacted',true),
      provider_claim_consumed_at=settled_at,provider_outcome='success',
      provider_outcome_recorded_at=settled_at,reconciliation_required=false,
      reporting_adjustment_id=adjustment.id,case_finalization_committed_at=settled_at,
      completed_at=settled_at where id=attempt.id returning * into attempt;
    update public.refund_nayax_transaction_allocations set allocation_state='refunded'
      where account_scope=execution_context->>'accountScope'
        and provider_machine_id=execution_context->>'providerMachineId'
        and original_transaction_id=execution_context->>'transactionId'
        and refund_case_id=refund_case.id and allocation_state='reserved';
    begin
      terminal_receipt_id:=public.refund_ensure_proved_nayax_api_terminal_receipt(
        refund_case.id,attempt.id);
    exception when others then
      terminal_receipt_id:=null;
      insert into public.refund_case_events(
        refund_case_id,actor_user_id,event_type,message,metadata)
      values(refund_case.id,null,'terminal_refund_receipt_recording_deferred',
        'Exact API payment outcome remains final; terminal receipt recording requires provider-free reconciliation.',
        jsonb_build_object('attempt_id',attempt.id,
          'system_saved_approval_receipt_id',receipt.id,
          'original_approver_user_id',receipt.original_actor_user_id,
          'provider_call_made',false,'payload_redacted',true));
    end;
  elsif normalized_outcome='rejected' then
    update public.refund_cases set nayax_refund_execution_status='declined',
      nayax_match_execution_eligible=false where id=refund_case.id;
    update public.refund_case_nayax_refund_attempts set status='declined',
      provider_reference=normalized_reference,provider_status=normalized_provider_status,
      error_code=coalesce(normalized_error_code,'provider_rejected'),
      sanitized_response=jsonb_build_object('provider_outcome','rejected',
        'provider_reference_present',normalized_reference is not null,
        'payload_redacted',true),provider_claim_consumed_at=settled_at,
      provider_outcome='rejected',provider_outcome_recorded_at=settled_at,
      reconciliation_required=false,completed_at=settled_at
    where id=attempt.id returning * into attempt;
    definitive_rejection:=public.refund_nayax_system_definitive_rejection_proved_v1(
      receipt.id,attempt.id,refund_case.id);
    if definitive_rejection then
      perform pg_catalog.set_config(
        'bloomjoy.nayax_definitive_rejection_attempt_id',attempt.id::text,true);
      update public.refund_case_nayax_refund_attempts set
        safe_transport_stage='released_no_refund',
        safe_failure_class='provider_rejected',
        sanitized_response=coalesce(sanitized_response,'{}'::jsonb)||
          jsonb_build_object('safe_stage','released_no_refund',
            'failure_class','provider_rejected','definitive_no_refund',true,
            'automatic_retry_made',false,'safe_retry_eligible',true,
            'payload_redacted',true)
      where id=attempt.id returning * into attempt;
      update public.refund_cases set status='needs_review',decision=null,
        decision_reason=null,decided_by=null,decided_at=null,
        nayax_refund_execution_status='not_requested',nayax_match_execution_eligible=true,
        nayax_refund_attempt_generation=nayax_refund_attempt_generation+1
      where id=refund_case.id;
      update public.refund_nayax_transaction_allocations set allocation_state='released',
        released_at=settled_at,release_reason='definitive_no_refund'
        where account_scope=execution_context->>'accountScope'
          and provider_machine_id=execution_context->>'providerMachineId'
          and original_transaction_id=execution_context->>'transactionId'
          and refund_case_id=refund_case.id and allocation_state='reserved';
    else
      update public.refund_cases set nayax_refund_execution_status='ambiguous',
        nayax_match_execution_eligible=false where id=refund_case.id;
      update public.refund_case_nayax_refund_attempts set status='ambiguous',
        reconciliation_required=true where id=attempt.id returning * into attempt;
      perform pg_catalog.set_config('bloomjoy.system_saved_approval_writer',
        'service_creator_v1',true);
      update public.refund_nayax_system_saved_approval_receipts receipt_row
      set status='held',held_at=settled_at,
        hold_reason='provider_rejection_requires_reconciliation'
      where receipt_row.id=receipt.id;
    end if;
  else
    update public.refund_cases set nayax_refund_execution_status='ambiguous',
      nayax_match_execution_eligible=false where id=refund_case.id;
    update public.refund_case_nayax_refund_attempts set status='ambiguous',
      provider_reference=normalized_reference,provider_status=normalized_provider_status,
      error_code=coalesce(normalized_error_code,case when normalized_outcome='timeout'
        then 'provider_timeout' else 'provider_outcome_unknown' end),
      sanitized_response=jsonb_build_object('provider_outcome',normalized_outcome,
        'provider_reference_present',normalized_reference is not null,
        'payload_redacted',true),provider_claim_consumed_at=settled_at,
      provider_outcome=normalized_outcome,provider_outcome_recorded_at=settled_at,
      reconciliation_required=true,completed_at=settled_at
    where id=attempt.id returning * into attempt;
    perform pg_catalog.set_config('bloomjoy.system_saved_approval_writer',
      'service_creator_v1',true);
    update public.refund_nayax_system_saved_approval_receipts receipt_row
    set status='held',held_at=settled_at,
      hold_reason='provider_outcome_requires_reconciliation'
    where receipt_row.id=receipt.id;
  end if;
  insert into public.refund_case_events(
    refund_case_id,actor_user_id,event_type,message,metadata)
  values(refund_case.id,null,case when normalized_outcome='success'
      then 'nayax_official_action_finalized' else 'nayax_provider_outcome_recorded' end,
    case when normalized_outcome='success'
      then 'System completed the exact refund already approved by the manager.'
      when normalized_outcome='rejected' and definitive_rejection
      then 'Nayax rejected the refund; no payment was made and the case returned for review.'
      else 'The Nayax outcome is held for reconciliation; no retry was issued.' end,
    jsonb_build_object('attempt_id',attempt.id,
      'system_saved_approval_receipt_id',receipt.id,
      'source_approval_authorization_id',receipt.source_approval_authorization_id,
      'original_approver_user_id',receipt.original_actor_user_id,
      'provider_outcome',normalized_outcome,
      'provider_reference_present',normalized_reference is not null,
      'reporting_adjustment_present',adjustment.id is not null,
      'terminal_receipt_id',terminal_receipt_id,
      'reconciliation_required',attempt.reconciliation_required,
      'payload_redacted',true));
  return jsonb_build_object('attempt',public.refund_nayax_attempt_snapshot(
      attempt.id,false),'updateApplied',true,
    'reportingAdjustmentPresent',attempt.reporting_adjustment_id is not null,
    'terminalReceiptRecorded',terminal_receipt_id is not null,
    'safeRetryEligible',definitive_rejection,
    'definitiveNoRefund',definitive_rejection,'payloadRedacted',true);
end;
$$;
revoke all on function public.service_settle_nayax_system_saved_approval_v1(
  text,uuid,uuid,uuid,text,integer,text,text,text,text,text,text)
  from public,anon,authenticated;
grant execute on function public.service_settle_nayax_system_saved_approval_v1(
  text,uuid,uuid,uuid,text,integer,text,text,text,text,text,text) to service_role;

-- Legacy stale-attempt recovery never owns dedicated System receipts. Those
-- attempts use the no-call reclaim/hold functions above and cannot be reset
-- into a fresh human decision by the older two-minute sweeper.
create or replace function public.service_recover_stale_nayax_refund_attempts(
  p_executor_assertion text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  attempt_row public.refund_case_nayax_refund_attempts%rowtype;
  journal_started boolean;
  latest_digest text;
  recovered_no_call integer := 0;
  held_for_confirmation integer := 0;
begin
  perform public.assert_nayax_provider_executor(p_executor_assertion);

  for attempt_row in
    select attempt.*
    from public.refund_case_nayax_refund_attempts attempt
    where attempt.execution_mode = 'request_and_approve'
      and attempt.status = 'in_progress'
      and attempt.provider_outcome is null
      and attempt.system_saved_approval_receipt_id is null
      and attempt.created_at < statement_timestamp() - interval '2 minutes'
    order by attempt.created_at, attempt.id
    limit 25
    for update skip locked
  loop
    select
      count(*) > 0,
      (
        array_agg(journal.classification_digest order by journal.created_at desc)
          filter (where journal.classification_digest is not null)
      )[1]
    into journal_started, latest_digest
    from public.refund_nayax_provider_stage_journal journal
    where journal.nayax_refund_attempt_id = attempt_row.id;

    perform pg_catalog.set_config(
      'bloomjoy.nayax_interruption_recovery_attempt_id',
      attempt_row.id::text,
      true
    );

    if not journal_started then
      update public.refund_case_nayax_refund_attempts
      set
        status = 'failed',
        provider_claim_consumed_at = statement_timestamp(),
        reconciliation_required = false,
        error_code = 'interrupted_before_transport',
        safe_transport_stage = 'released_no_call',
        safe_failure_class = 'interrupted_before_transport',
        correlation_digest = encode(extensions.digest(convert_to(
          jsonb_build_array(
            'refund-nayax-no-call-recovery-v1', attempt_row.id,
            attempt_row.request_fingerprint, attempt_row.created_at
          )::text,
          'UTF8'
        ), 'sha256'), 'hex'),
        refund_operations_due_at = null,
        sanitized_response = coalesce(sanitized_response, '{}'::jsonb) ||
          jsonb_build_object(
            'safe_stage', 'released_no_call',
            'failure_class', 'interrupted_before_transport',
            'provider_call_made', false,
            'automatic_retry_made', false,
            'payload_redacted', true
          )
      where id = attempt_row.id;

      perform pg_catalog.set_config(
        'bloomjoy.nayax_no_call_recovery_attempt_id',
        attempt_row.id::text,
        true
      );
      update public.refund_cases
      set
        status = 'needs_review',
        decision = null,
        decision_reason = null,
        decided_by = null,
        decided_at = null,
        nayax_refund_execution_status = 'not_requested',
        nayax_match_execution_eligible = true,
        nayax_refund_attempt_generation = nayax_refund_attempt_generation + 1
      where id = attempt_row.refund_case_id;
      recovered_no_call := recovered_no_call + 1;
    else
      update public.refund_case_nayax_refund_attempts
      set
        status = 'manual_review',
        provider_claim_consumed_at = statement_timestamp(),
        provider_outcome = 'unknown',
        provider_outcome_recorded_at = statement_timestamp(),
        reconciliation_required = true,
        error_code = 'interrupted_after_transport',
        safe_transport_stage = 'confirmation_hold',
        safe_failure_class = 'interrupted_after_transport',
        correlation_digest = coalesce(
          latest_digest,
          encode(extensions.digest(convert_to(
            jsonb_build_array(
              'refund-nayax-transport-hold-v1', attempt_row.id,
              attempt_row.request_fingerprint, attempt_row.created_at
            )::text,
            'UTF8'
          ), 'sha256'), 'hex')
        ),
        refund_operations_due_at = coalesce(
          refund_operations_due_at,
          created_at + interval '60 minutes'
        ),
        sanitized_response = coalesce(sanitized_response, '{}'::jsonb) ||
          jsonb_build_object(
            'safe_stage', 'confirmation_hold',
            'failure_class', 'interrupted_after_transport',
            'provider_call_made', true,
            'automatic_retry_made', false,
            'payload_redacted', true
          )
      where id = attempt_row.id;

      update public.refund_cases
      set
        status = 'card_refund_pending',
        decision = 'approved',
        nayax_refund_execution_status = 'manual_review',
        nayax_match_execution_eligible = false
      where id = attempt_row.refund_case_id;
      held_for_confirmation := held_for_confirmation + 1;
    end if;

    insert into public.refund_case_events (
      refund_case_id, actor_user_id, event_type, message, metadata
    ) values (
      attempt_row.refund_case_id,
      null,
      case when journal_started
        then 'nayax_interruption_confirmation_hold'
        else 'nayax_interruption_no_call_released'
      end,
      case when journal_started
        then 'An interrupted provider attempt entered Refund Operations confirmation hold. It will not retry automatically.'
        else 'An interrupted reservation was released only after the journal proved no provider transport started.'
      end,
      jsonb_build_object(
        'attempt_id', attempt_row.id,
        'safe_stage', case when journal_started
          then 'confirmation_hold' else 'released_no_call' end,
        'failure_class', case when journal_started
          then 'interrupted_after_transport'
          else 'interrupted_before_transport' end,
        'refund_operations_owner', 'Refund Operations',
        'refund_operations_sla_minutes', 60,
        'provider_retry_made', false,
        'payload_redacted', true
      )
    );
  end loop;

  return jsonb_build_object(
    'releasedNoCallCount', recovered_no_call,
    'confirmationHoldCount', held_for_confirmation,
    'providerRetriesMade', 0,
    'ownerLabel', 'Refund Operations',
    'escalationSlaMinutes', 60,
    'payloadRedacted', true
  );
end;
$$;

revoke execute on function public.service_recover_stale_nayax_refund_attempts(text)
  from public, anon, authenticated;
grant execute on function public.service_recover_stale_nayax_refund_attempts(text)
  to service_role;

create function public.refund_nayax_system_saved_approval_evidence_ready_v1(
  p_case_id uuid
)
returns boolean language sql stable security definer set search_path='' as $$
  select public.refund_nayax_system_saved_approval_snapshot_v1(p_case_id) is not null;
$$;
revoke all on function public.refund_nayax_system_saved_approval_evidence_ready_v1(uuid)
  from public,anon,authenticated,service_role;
comment on function public.refund_nayax_system_saved_approval_evidence_ready_v1(uuid) is
  'Read-only evidence check only. It never grants execution; the dedicated System creator must lock and revalidate every source row.';

-- The browser readiness response is explicit and read-only after approval.
-- A durable saved approval is reported as System work, never as another
-- manager action or a continuation owned by the current viewer.
create or replace function public.refund_case_nayax_manager_readiness(
  p_user_id uuid,
  p_refund_case_id uuid
)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  refund_case public.refund_cases%rowtype;
  machine public.reporting_machines%rowtype;
  transaction_confirmed boolean := false;
  system_approval_pending boolean := false;
  can_issue_card_refund boolean := false;
  block_reason text := null;
begin
  select case_row.* into refund_case
  from public.refund_cases case_row
  where case_row.id = p_refund_case_id;

  if not found then
    return jsonb_build_object(
      'transactionConfirmed', false,
      'approvalContinuationReady', false,
      'approvalPendingExecution', false,
      'canIssueCardRefund', false,
      'blockReason', 'case_not_found',
      'refundAmountCents', null,
      'machineLimitCents', null,
      'caseVersion', null
    );
  end if;

  if refund_case.reporting_machine_id is not null then
    select machine_row.* into machine
    from public.reporting_machines machine_row
    where machine_row.id = refund_case.reporting_machine_id;
  end if;

  transaction_confirmed :=
    refund_case.correlation_status = 'matched'
    and refund_case.correlation_source = 'nayax'
    and refund_case.nayax_recommendation_policy_version is not null
    and public.is_review_safe_nayax_transaction_reference(
      refund_case.matched_nayax_transaction_id
    )
    and (
      refund_case.matched_nayax_site_id is not null
      or exists (
        select 1
        from public.refund_case_events manual_selection_event
        where manual_selection_event.refund_case_id = refund_case.id
          and manual_selection_event.event_type = 'nayax_match_selected'
          and manual_selection_event.metadata ->> 'manual_portal_candidate' = 'true'
      )
    )
    and refund_case.matched_nayax_machine_auth_time is not null
    and refund_case.matched_nayax_amount_cents is not null
    and refund_case.matched_nayax_currency_code = 'USD'
    and refund_case.refund_amount_cents is not null
    and refund_case.refund_amount_cents > 0
    and refund_case.matched_nayax_amount_cents = refund_case.refund_amount_cents
    and exists (
      select 1
      from public.refund_case_events selection_event
      where selection_event.refund_case_id = refund_case.id
        and selection_event.event_type = 'nayax_match_selected'
        and selection_event.actor_user_id is not null
    );

  system_approval_pending :=
    public.refund_nayax_system_saved_approval_evidence_ready_v1(refund_case.id);

  block_reason := case
    when system_approval_pending then 'system_finishing'
    when p_user_id is null
      or not public.can_perform_refund_official_action(p_user_id, refund_case.id)
      then 'unauthorized'
    when not transaction_confirmed then 'transaction_not_confirmed'
    when refund_case.reporting_adjustment_id is not null
      or refund_case.refund_completed_at is not null
      or refund_case.nayax_refund_execution_status = 'succeeded'
      then 'already_refunded'
    when public.refund_case_has_unresolved_reconciliation(refund_case.id)
      or refund_case.nayax_refund_execution_status in (
        'requested', 'ambiguous', 'manual_review'
      )
      then 'reconciliation_hold'
    when exists (
      select 1
      from public.refund_cases duplicate_case
      where duplicate_case.id <> refund_case.id
        and duplicate_case.matched_nayax_transaction_id =
          refund_case.matched_nayax_transaction_id
    ) then 'duplicate_transaction'
    when refund_case.payment_method <> 'card'
      or refund_case.status not in ('needs_review', 'correlated')
      or refund_case.decision is not null
      or refund_case.nayax_refund_execution_status <> 'not_requested'
      then 'case_not_refundable'
    when machine.id is null
      or machine.status <> 'active'
      or machine.nayax_machine_id is null
      or btrim(machine.nayax_machine_id) = ''
      or machine.nayax_account_key is null
      or btrim(machine.nayax_account_key) = ''
      then 'provider_unavailable'
    when machine.nayax_refunds_enabled is not true then 'machine_not_enabled'
    else null
  end;

  can_issue_card_refund := block_reason is null;
  return jsonb_build_object(
    'transactionConfirmed', transaction_confirmed,
    'approvalContinuationReady', false,
    'approvalPendingExecution', system_approval_pending,
    'canIssueCardRefund', can_issue_card_refund,
    'blockReason', block_reason,
    'refundAmountCents', refund_case.matched_nayax_amount_cents,
    'machineLimitCents', null,
    'caseVersion', refund_case.official_action_version,
    'accountCircuitBreakerActive', false
  );
end;
$$;

revoke execute on function public.refund_case_nayax_manager_readiness(uuid, uuid)
  from public, anon, authenticated;
grant execute on function public.refund_case_nayax_manager_readiness(uuid, uuid)
  to service_role;

create or replace function public.refund_nayax_current_manager_approval_pending(
  p_user_id uuid,p_case_id uuid
)
returns boolean language plpgsql stable security definer set search_path='' as $$
begin
  raise exception 'Current-manager saved approval checks are retired; System owns approved refund continuation'
    using errcode='42501';
end;
$$;
revoke all on function public.refund_nayax_current_manager_approval_pending(uuid,uuid)
  from public,anon,authenticated,service_role;
comment on function public.refund_nayax_current_manager_approval_pending(uuid,uuid) is
  'Retired fail-closed helper. No current user can authorize or continue a saved approval.';

-- Final overview boundary: one current Manager/Super-admin authority predicate,
-- with no retired recent-step-up presentation gate.
alter function public.admin_get_refund_operations_overview()
  rename to admin_get_refund_operations_overview_pre_single_manager_gate_v1;
revoke all on function public.admin_get_refund_operations_overview_pre_single_manager_gate_v1()
  from public,anon,authenticated,service_role;
create function public.admin_get_refund_operations_overview()
returns jsonb language plpgsql stable security definer set search_path=public,auth as $$
declare actor_user_id uuid:=auth.uid(); base_result jsonb; cases_result jsonb;
begin
  base_result:=public.admin_get_refund_operations_overview_pre_single_manager_gate_v1();
  select coalesce(jsonb_agg(item.case_json||jsonb_build_object(
    'canPerformOfficialAction',public.refund_official_actions_enabled()
      and public.can_perform_refund_official_action(
        actor_user_id,(item.case_json->>'id')::uuid),
    'officialActionBlockReason',case
      when not public.refund_official_actions_enabled()
        then to_jsonb('official_actions_disabled'::text)
      when public.can_perform_refund_official_action(
        actor_user_id,(item.case_json->>'id')::uuid) then null
      else to_jsonb('manager_access_required'::text) end)
    order by item.case_order),'[]'::jsonb)
  into cases_result
  from jsonb_array_elements(coalesce(base_result->'cases','[]'::jsonb))
    with ordinality item(case_json,case_order);
  return jsonb_set(base_result,'{cases}',cases_result,true);
end;
$$;
revoke all on function public.admin_get_refund_operations_overview()
  from public,anon,authenticated,service_role;
grant execute on function public.admin_get_refund_operations_overview() to authenticated;

-- Exact post-settlement proof for a System attempt. The generic proof remains
-- unchanged for human attempts; this predicate replaces only its actor check
-- with the separate immutable System receipt and otherwise requires the same
-- terminal case, adjustment, context, and v3 request/approval journal.
create function public.refund_nayax_system_api_terminal_evidence_proved_v1(
  p_case_id uuid,p_attempt_id uuid
) returns boolean language sql stable security definer set search_path='' as $$
  select exists(
    select 1
    from public.refund_cases c
    join public.reporting_machines machine on machine.id=c.reporting_machine_id
    join public.refund_case_nayax_refund_attempts attempt
      on attempt.id=p_attempt_id and attempt.refund_case_id=c.id
    join public.refund_nayax_system_saved_approval_receipts system_receipt
      on system_receipt.id=attempt.system_saved_approval_receipt_id
      and system_receipt.refund_case_id=c.id
    join public.refund_nayax_execution_contexts saved
      on saved.attempt_id=attempt.id and saved.refund_case_id=c.id
    join public.refund_nayax_provider_stage_journal request_journal
      on request_journal.nayax_refund_attempt_id=attempt.id
      and request_journal.pending_approval_recovery_id is null
      and request_journal.stage='request' and request_journal.event='result'
    join public.refund_nayax_provider_business_outcomes request_outcome
      on request_outcome.provider_stage_journal_id=request_journal.id
      and request_outcome.nayax_refund_attempt_id=attempt.id
      and request_outcome.stage='request'
    join public.refund_nayax_provider_stage_journal approve_journal
      on approve_journal.nayax_refund_attempt_id=attempt.id
      and approve_journal.pending_approval_recovery_id is null
      and approve_journal.stage='approve' and approve_journal.event='result'
    join public.refund_nayax_provider_business_outcomes approve_outcome
      on approve_outcome.provider_stage_journal_id=approve_journal.id
      and approve_outcome.nayax_refund_attempt_id=attempt.id
      and approve_outcome.stage='approve'
    where c.id=p_case_id and c.case_population='customer'
      and c.payment_method='card' and c.decision='approved' and c.status='completed'
      and c.reporting_adjustment_id is not null
      and c.nayax_refund_execution_status='approved'
      and attempt.actor_user_id is null
      and attempt.execution_mode='request_and_approve'
      and attempt.status='succeeded' and attempt.provider_outcome='success'
      and attempt.provider_status='approve_succeeded_contract_match'
      and not attempt.reconciliation_required
      and attempt.reporting_adjustment_id=c.reporting_adjustment_id
      and attempt.provider_outcome_recorded_at is not null
      and attempt.case_finalization_committed_at is not null
      and public.refund_nayax_system_saved_approval_terminal_binding_valid_v1(
        system_receipt.id,attempt.id,c.id)
      and saved.context->>'accountScope'=machine.nayax_account_key
      and request_journal.http_status=200 and request_journal.http_accepted
      and request_journal.outcome='accepted' and request_journal.contract_matched
      and request_journal.approval_authorized and request_journal.schema_matched
      and request_journal.semantic_pair_matched
      and request_journal.journal_contract_version='nayax-provider-journal-v3'
      and request_journal.provider_contract_version=system_receipt.provider_contract_version
      and approve_journal.http_status=200 and approve_journal.http_accepted
      and approve_journal.outcome='succeeded' and approve_journal.contract_matched
      and approve_journal.schema_matched and approve_journal.semantic_pair_matched
      and approve_journal.journal_contract_version='nayax-provider-journal-v3'
      and approve_journal.provider_contract_version=system_receipt.provider_contract_version
      and request_outcome.business_pair_retained
      and request_outcome.observed_scalar_pair_retained
      and approve_outcome.business_pair_retained
      and approve_outcome.observed_scalar_pair_retained
      and request_outcome.business_result=
        'Refund status updated successfully, but the email could not be sent'
      and request_outcome.business_status='Partial success'
      and request_outcome.observed_result_scalar=request_outcome.business_result
      and request_outcome.observed_status_scalar=request_outcome.business_status
      and approve_outcome.business_result=request_outcome.business_result
      and approve_outcome.business_status=request_outcome.business_status
      and approve_outcome.observed_result_scalar=approve_outcome.business_result
      and approve_outcome.observed_status_scalar=approve_outcome.business_status
      and exists(select 1 from public.sales_adjustment_facts adjustment
        where adjustment.id=c.reporting_adjustment_id
          and adjustment.refund_case_id=c.id
          and adjustment.reporting_machine_id=c.reporting_machine_id
          and adjustment.reporting_location_id=c.reporting_location_id
          and adjustment.amount_cents=c.refund_amount_cents)
      and (select count(*) from public.refund_nayax_provider_stage_journal journal
        where journal.nayax_refund_attempt_id=attempt.id
          and journal.pending_approval_recovery_id is null
          and journal.stage='request' and journal.event='result')=1
      and (select count(*) from public.refund_nayax_provider_stage_journal journal
        where journal.nayax_refund_attempt_id=attempt.id
          and journal.pending_approval_recovery_id is null
          and journal.stage='approve' and journal.event='result')=1
  );
$$;
revoke all on function public.refund_nayax_system_api_terminal_evidence_proved_v1(
  uuid,uuid) from public,anon,authenticated,service_role;

-- Terminal-receipt recovery remains available without another provider call.
-- System-owned attempts must first prove their exact saved-approval binding;
-- their audit event is attributed to System while retaining the approver.
create or replace function public.refund_ensure_proved_nayax_api_terminal_receipt(
  p_case_id uuid,p_attempt_id uuid
)
returns uuid language plpgsql security definer set search_path='' as $$
declare
  c public.refund_cases%rowtype;
  attempt public.refund_case_nayax_refund_attempts%rowtype;
  machine public.reporting_machines%rowtype;
  request_journal public.refund_nayax_provider_stage_journal%rowtype;
  approve_journal public.refund_nayax_provider_stage_journal%rowtype;
  receipt public.refund_authoritative_receipts%rowtype;
  system_receipt public.refund_nayax_system_saved_approval_receipts%rowtype;
  evidence_digest text;
begin
  select * into c from public.refund_cases where id=p_case_id for update;
  select * into attempt from public.refund_case_nayax_refund_attempts
    where id=p_attempt_id and refund_case_id=c.id for share;
  if attempt.system_saved_approval_receipt_id is not null then
    select * into system_receipt
    from public.refund_nayax_system_saved_approval_receipts
    where id=attempt.system_saved_approval_receipt_id
      and refund_case_id=c.id and nayax_refund_attempt_id=attempt.id
    for share;
    if system_receipt.id is null
      or not public.refund_nayax_system_saved_approval_terminal_binding_valid_v1(
        system_receipt.id,attempt.id,c.id) then
      raise exception 'Exact System saved-approval evidence required'
        using errcode='P4670';
    end if;
  end if;
  select * into machine from public.reporting_machines
    where id=c.reporting_machine_id for share;
  select * into request_journal from public.refund_nayax_provider_stage_journal
    where nayax_refund_attempt_id=attempt.id and pending_approval_recovery_id is null
      and stage='request' and event='result';
  select * into approve_journal from public.refund_nayax_provider_stage_journal
    where nayax_refund_attempt_id=attempt.id and pending_approval_recovery_id is null
      and stage='approve' and event='result';
  select * into receipt from public.refund_authoritative_receipts
    where refund_case_id=c.id;
  if receipt.id is not null then
    if receipt.nayax_refund_attempt_id is distinct from attempt.id
      or receipt.confirmation_source is distinct from 'api_stage_contract' then
      raise exception 'A different authoritative receipt already owns this case'
        using errcode='P4670';
    end if;
    return receipt.id;
  end if;
  if c.id is null or attempt.id is null or machine.id is null
    or (system_receipt.id is null
      and not public.refund_nayax_api_terminal_evidence_proved(c.id,attempt.id))
    or (system_receipt.id is not null
      and not public.refund_nayax_system_api_terminal_evidence_proved_v1(
        c.id,attempt.id)) then
    raise exception 'Exact successful request-and-approval journal evidence required'
      using errcode='P4670';
  end if;
  evidence_digest:=encode(extensions.digest(convert_to(
    'nayax-api-terminal-v1|'||c.id::text||'|'||attempt.id::text||'|'
      ||request_journal.id::text||'|'||request_journal.classification_digest||'|'
      ||approve_journal.id::text||'|'||approve_journal.classification_digest,
    'UTF8'),'sha256'),'hex');
  insert into public.refund_authoritative_receipts(
    refund_case_id,nayax_refund_attempt_id,reporting_machine_id,account_scope,
    provider_machine_id,original_transaction_id,original_amount_cents,
    refunded_amount_cents,currency_code,provider_status,evidence_reference_digest,
    observed_at,recorded_by,attempt_binding_kind,current_provider_observation_reviewed,
    confirmation_source
  ) values (
    c.id,attempt.id,machine.id,machine.nayax_account_key,machine.nayax_machine_id,
    c.matched_nayax_transaction_id,c.refund_amount_cents,c.refund_amount_cents,
    'USD',null,evidence_digest,attempt.provider_outcome_recorded_at,
    coalesce(attempt.actor_user_id,system_receipt.original_actor_user_id),
    'proved_terminal_api',false,'api_stage_contract'
  ) returning * into receipt;
  insert into public.refund_case_events(
    refund_case_id,actor_user_id,event_type,message,metadata
  ) values (
    c.id,case when system_receipt.id is null then attempt.actor_user_id else null end,
    'authoritative_refund_receipt_recorded',
    'Exact request-and-approval journal evidence recorded payment completion independently of notice delivery.',
    jsonb_strip_nulls(jsonb_build_object(
      'schema_version','refund_api_terminal_receipt_v1',
      'attempt_id',attempt.id,'confirmation_source','api_stage_contract',
      'settlement_time_precision','unknown','customer_message_sent',false,
      'provider_call_made',false,
      'original_approver_user_id',system_receipt.original_actor_user_id,
      'system_saved_approval_receipt_id',system_receipt.id,
      'payload_redacted',true))
  );
  return receipt.id;
end;
$$;
revoke all on function public.refund_ensure_proved_nayax_api_terminal_receipt(uuid,uuid)
  from public,anon,authenticated,service_role;

-- Form-origin System refunds have no Gmail thread. Preserve the original
-- human proof exactly, but admit a separate exact System receipt proof when
-- preparing the same canonical transactional completion message.
create or replace function public.refund_claim_nayax_form_receipt_completion_internal(
  p_attempt_id uuid
)
returns jsonb language plpgsql security definer set search_path='' as $$
declare
  case_row public.refund_cases%rowtype;
  attempt_row public.refund_case_nayax_refund_attempts%rowtype;
  receipt_row public.refund_authoritative_receipts%rowtype;
  system_receipt public.refund_nayax_system_saved_approval_receipts%rowtype;
  authority_row public.refund_receipt_completion_automation_authorities%rowtype;
  intent_row public.refund_receipt_completion_intents%rowtype;
  message_row public.refund_case_messages%rowtype;
  completion_copy jsonb;
  intent_id uuid;
  system_authority boolean:=false;
begin
  select refund_case.* into case_row
  from public.refund_case_nayax_refund_attempts attempt
  join public.refund_cases refund_case on refund_case.id=attempt.refund_case_id
  where attempt.id=p_attempt_id for update of refund_case;
  select * into attempt_row from public.refund_case_nayax_refund_attempts
    where id=p_attempt_id and refund_case_id=case_row.id for share;
  select * into receipt_row from public.refund_authoritative_receipts
    where refund_case_id=case_row.id and nayax_refund_attempt_id=attempt_row.id
      and confirmation_source='api_stage_contract' for share;
  if attempt_row.system_saved_approval_receipt_id is not null then
    select * into system_receipt
    from public.refund_nayax_system_saved_approval_receipts system_row
    where system_row.id=attempt_row.system_saved_approval_receipt_id
      and system_row.refund_case_id=case_row.id
      and system_row.nayax_refund_attempt_id=attempt_row.id for share;
    system_authority:=system_receipt.id is not null
      and attempt_row.actor_user_id is null
      and receipt_row.recorded_by=system_receipt.original_actor_user_id
      and public.refund_nayax_system_saved_approval_terminal_binding_valid_v1(
        system_receipt.id,attempt_row.id,case_row.id)
      and public.refund_nayax_system_api_terminal_evidence_proved_v1(
        case_row.id,attempt_row.id);
  end if;

  if case_row.id is null or attempt_row.id is null or receipt_row.id is null
    or case_row.intake_source is distinct from 'form'
    or case_row.case_population is distinct from 'customer'
    or case_row.payment_method is distinct from 'card'
    or case_row.status is distinct from 'completed'
    or case_row.refund_completed_at is null
    or case_row.reporting_adjustment_id is null
    or attempt_row.status is distinct from 'succeeded'
    or attempt_row.provider_outcome is distinct from 'success'
    or attempt_row.reconciliation_required
    or attempt_row.reporting_adjustment_id is distinct from case_row.reporting_adjustment_id
    or attempt_row.case_finalization_committed_at is null
    or receipt_row.attempt_binding_kind is distinct from 'proved_terminal_api'
    or receipt_row.provider_status is not null
    or receipt_row.refunded_amount_cents is distinct from case_row.refund_amount_cents
    or receipt_row.refunded_amount_cents is distinct from receipt_row.original_amount_cents
    or receipt_row.currency_code is distinct from 'USD'
    or not (system_authority or (
      attempt_row.system_saved_approval_receipt_id is null
      and public.refund_nayax_api_terminal_evidence_proved(
        case_row.id,attempt_row.id))) then
    raise exception 'Fully committed form refund with exact API receipt required';
  end if;

  select * into intent_row from public.refund_receipt_completion_intents
    where receipt_id=receipt_row.id;
  if intent_row.receipt_id is not null then
    select * into message_row from public.refund_case_messages
      where id=intent_row.message_id;
    if message_row.id is null
      or not public.is_refund_receipt_completion_message(to_jsonb(message_row))
      or message_row.delivery_kind is distinct from 'automatic' then
      raise exception 'Canonical form receipt completion binding is inconsistent'
        using errcode='P4668';
    end if;
    return jsonb_build_object(
      'claimed',false,'refundCaseId',case_row.id,
      'refundCaseMessageId',message_row.id,'gmailThreadId',null,
      'recipientEmail',message_row.recipient_email,
      'subject',message_row.subject,'body',message_row.body,
      'status',case when message_row.status='sent' then 'already_sent'
        else coalesce(message_row.manual_delivery_state,message_row.status) end,
      'transport','transactional_email','originalThread',false,
      'noticeDeferred',message_row.manual_delivery_state='queued'
        and message_row.manual_delivery_provider_attempted_at is null,
      'payloadRedacted',true);
  end if;

  if exists(select 1 from public.refund_completion_notice_adoptions notice
      where notice.receipt_id=receipt_row.id)
    or exists(select 1 from public.refund_external_notice_observations notice
      where notice.receipt_id=receipt_row.id)
    or exists(select 1 from public.refund_case_messages message
      where message.refund_case_id=case_row.id and message.message_type='completed') then
    return jsonb_build_object(
      'claimed',false,'refundCaseId',case_row.id,
      'refundCaseMessageId',null,'gmailThreadId',null,
      'status','notice_deferred','transport',null,'originalThread',false,
      'noticeDeferred',true,'payloadRedacted',true);
  end if;

  completion_copy:=public.refund_receipt_completion_copy(case_row.id);
  if completion_copy is null
    or lower(btrim(coalesce(completion_copy->>'recipientEmail',''))) is distinct from
      lower(btrim(coalesce(case_row.customer_email,'')))
    or lower(btrim(coalesce(case_row.customer_email,''))) !~
      '^[^[:space:]@<>]+@[^[:space:]@<>]+\.[^[:space:]@<>]+$' then
    return jsonb_build_object(
      'claimed',false,'refundCaseId',case_row.id,
      'refundCaseMessageId',null,'gmailThreadId',null,
      'status','notice_deferred','transport',null,'originalThread',false,
      'noticeDeferred',true,'payloadRedacted',true);
  end if;

  select * into authority_row
  from public.refund_receipt_completion_automation_authorities
  where receipt_id=receipt_row.id;
  if authority_row.id is null then
    insert into public.refund_receipt_completion_automation_authorities(
      receipt_id,refund_case_id,expected_case_version,
      authorized_actor_user_id,source_kind,source_policy,
      source_event_digest,receipt_observed_at
    ) values (
      receipt_row.id,case_row.id,case_row.official_action_version,
      receipt_row.recorded_by,'nayax_api_terminal',
      'verified_terminal_refund_v1',receipt_row.evidence_reference_digest,
      receipt_row.observed_at
    ) returning * into authority_row;
  elsif authority_row.refund_case_id is distinct from case_row.id
    or authority_row.expected_case_version is distinct from case_row.official_action_version
    or authority_row.authorized_actor_user_id is distinct from receipt_row.recorded_by
    or authority_row.source_kind is distinct from 'nayax_api_terminal'
    or authority_row.source_policy is distinct from 'verified_terminal_refund_v1'
    or authority_row.source_event_digest is distinct from receipt_row.evidence_reference_digest
    or authority_row.receipt_observed_at is distinct from receipt_row.observed_at then
    raise exception 'Form receipt completion authority conflicts with payment evidence'
      using errcode='P4668';
  end if;

  intent_id:=gen_random_uuid();
  message_row.id:=gen_random_uuid();
  message_row.refund_case_id:=case_row.id;
  message_row.message_type:='completed';
  message_row.status:='pending';
  message_row.recipient_email:=completion_copy->>'recipientEmail';
  message_row.subject:=completion_copy->>'subject';
  message_row.body:=completion_copy->>'body';
  message_row.template_key:='refund_receipt_completed';
  message_row.template_version:='refund_receipt_completion_v1';
  message_row.created_by:=authority_row.authorized_actor_user_id;
  message_row.content_source:='deterministic_template';
  message_row.delivery_kind:='automatic';
  message_row.requested_fields:='{}'::text[];
  message_row.manual_delivery_intent_id:=intent_id;
  message_row.manual_delivery_state:='queued';
  message_row.manual_delivery_expected_case_version:=case_row.official_action_version;
  message_row.manual_delivery_status_link_requested:=false;

  insert into public.refund_receipt_completion_intents(
    receipt_id,refund_case_id,message_id,intent_id,expected_case_version,
    actor_user_id,message_identity_digest,reviewed_no_existing_notice,
    automation_authority_id
  ) values (
    receipt_row.id,case_row.id,message_row.id,intent_id,
    case_row.official_action_version,authority_row.authorized_actor_user_id,
    public.refund_receipt_completion_message_digest(to_jsonb(message_row)),
    false,authority_row.id);
  if not public.is_refund_receipt_completion_message(to_jsonb(message_row)) then
    raise exception 'Form receipt completion identity changed' using errcode='P4668';
  end if;
  insert into public.refund_case_messages(
    id,refund_case_id,message_type,status,recipient_email,subject,body,
    template_key,template_version,created_by,content_source,delivery_kind,
    requested_fields,manual_delivery_intent_id,manual_delivery_state,
    manual_delivery_expected_case_version,manual_delivery_status_link_requested
  ) values (
    message_row.id,message_row.refund_case_id,message_row.message_type,
    message_row.status,message_row.recipient_email,message_row.subject,
    message_row.body,message_row.template_key,message_row.template_version,
    message_row.created_by,message_row.content_source,message_row.delivery_kind,
    message_row.requested_fields,message_row.manual_delivery_intent_id,
    message_row.manual_delivery_state,
    message_row.manual_delivery_expected_case_version,false);
  insert into public.refund_case_events(
    refund_case_id,actor_user_id,event_type,message,metadata
  ) values (
    case_row.id,case when system_authority then null
      else authority_row.authorized_actor_user_id end,
    'customer_message_queued',
    'Confirmed-refund notice entered the existing delivery queue from immutable API receipt authority.',
    jsonb_strip_nulls(jsonb_build_object(
      'message_id',message_row.id,'receipt_id',receipt_row.id,
      'automation_authority_id',authority_row.id,
      'message_type','completed','provider_call_made',false,
      'system_saved_approval_receipt_id',system_receipt.id,
      'original_approver_user_id',system_receipt.original_actor_user_id,
      'payload_redacted',true)));
  return jsonb_build_object(
    'claimed',true,'refundCaseId',case_row.id,
    'refundCaseMessageId',message_row.id,'gmailThreadId',null,
    'recipientEmail',message_row.recipient_email,
    'subject',message_row.subject,'body',message_row.body,
    'status','queued','transport','transactional_email',
    'originalThread',false,'noticeDeferred',false,'payloadRedacted',true);
end;
$$;
revoke all on function public.refund_claim_nayax_form_receipt_completion_internal(uuid)
  from public,anon,authenticated,service_role;


-- Read-only status remains visible to the person who approved the exact case
-- even if their live machine assignment later changes. Unrelated users learn
-- nothing about the case.
create function public.can_view_refund_system_finishing_status_v1(
  p_user_id uuid,p_case_id uuid
) returns boolean language sql stable security definer set search_path='' as $$
  select public.can_manage_refund_case(p_user_id,p_case_id)
    or exists(select 1
      from public.refund_cases refund_case
      join public.refund_case_official_action_authorizations source_approval
        on source_approval.refund_case_id=refund_case.id
      where refund_case.id=p_case_id
        and refund_case.payment_method='card'
        and refund_case.status='card_refund_pending'
        and refund_case.decision='approved'
        and source_approval.actor_user_id=p_user_id
        and source_approval.action='approve'
        and source_approval.status='consumed'
        and source_approval.authorization_method='manager_session');
$$;
revoke all on function public.can_view_refund_system_finishing_status_v1(uuid,uuid)
  from public,anon,authenticated;
grant execute on function public.can_view_refund_system_finishing_status_v1(uuid,uuid)
  to service_role;

create function public.refund_nayax_approved_card_read_state_v1(p_case_id uuid)
returns text language plpgsql stable security definer set search_path='' as $$
declare refund_case public.refund_cases%rowtype;
begin
  select * into refund_case from public.refund_cases where id=p_case_id;
  if refund_case.id is null or refund_case.payment_method<>'card'
    or refund_case.status<>'card_refund_pending'
    or refund_case.decision<>'approved' then return null; end if;
  if refund_case.nayax_refund_execution_status in ('ambiguous','manual_review') then
    return 'provider_hold';
  end if;
  if refund_case.nayax_refund_execution_status='not_requested'
    and public.refund_nayax_system_saved_approval_snapshot_v1(refund_case.id) is not null
    then return 'system_finishing';
  end if;
  if refund_case.nayax_refund_execution_status='requested' and exists(
    select 1 from public.refund_case_nayax_refund_attempts attempt
    where attempt.refund_case_id=refund_case.id
      and attempt.status='in_progress' and attempt.provider_outcome is null
      and not public.refund_case_has_unresolved_reconciliation(refund_case.id)
      and ((attempt.system_saved_approval_receipt_id is not null
          and public.refund_nayax_system_saved_approval_attempt_valid_v1(
            attempt.system_saved_approval_receipt_id,attempt.id,refund_case.id))
        or (attempt.official_action_authorization_id is not null
          and public.refund_official_action_receipt_authority_valid(
            attempt.official_action_authorization_id,
            refund_case.reporting_machine_id)))) then return 'system_finishing';
  end if;
  return 'provider_hold';
end;
$$;
revoke all on function public.refund_nayax_approved_card_read_state_v1(uuid)
  from public,anon,authenticated;
grant execute on function public.refund_nayax_approved_card_read_state_v1(uuid)
  to service_role;

-- A saved approval can never re-enter any manager/browser reservation version,
-- including an exact idempotency replay. The case and attempt are locked before
-- delegation so the rejection happens before claims or writes.
create function public.assert_nayax_manager_reservation_not_system_v1(
  p_case_id uuid,p_idempotency_key text
) returns void language plpgsql security definer set search_path='' as $$
begin
  perform 1 from public.refund_cases where id=p_case_id for update;
  if exists(
      select 1
      from public.refund_nayax_system_saved_approval_receipts system_receipt
      where system_receipt.refund_case_id=p_case_id
    ) or exists(
      select 1
      from public.refund_case_official_action_authorizations source_approval
      where source_approval.refund_case_id=p_case_id
        and source_approval.action='approve'
        and source_approval.status='consumed'
        and source_approval.authorization_method='manager_session'
        and source_approval.step_up_intent_id is null
        and source_approval.verified_totp_at is null
        and exists(
          select 1 from public.refund_case_events approval_marker
          where approval_marker.refund_case_id=p_case_id
            and approval_marker.event_type='nayax_refund_execution_authorized'
            and approval_marker.metadata->>'authorization_id'=
              source_approval.id::text
        )
    ) then
    raise exception 'System-owned refund cannot re-enter the manager reservation lane'
      using errcode='42501';
  end if;
end;
$$;
revoke all on function public.assert_nayax_manager_reservation_not_system_v1(uuid,text)
  from public,anon,authenticated,service_role;

alter function public.service_reserve_nayax_refund_manager_action(
  text,uuid,uuid,bigint,text,integer,integer,integer,text
) rename to service_reserve_nayax_refund_manager_action_pre_system_saved_approval_v1;
revoke all on function public.service_reserve_nayax_refund_manager_action_pre_system_saved_approval_v1(
  text,uuid,uuid,bigint,text,integer,integer,integer,text
) from public,anon,authenticated,service_role;
create function public.service_reserve_nayax_refund_manager_action(
  p_executor_assertion text,p_actor_user_id uuid,p_case_id uuid,
  p_expected_case_version bigint,p_idempotency_key text,p_amount_cents integer,
  p_daily_amount_cap_cents integer,p_daily_count_cap integer,
  p_currency_code text default 'USD'
) returns jsonb language plpgsql security definer set search_path='' as $$
begin
  perform public.assert_nayax_provider_executor(p_executor_assertion);
  perform public.assert_nayax_manager_reservation_not_system_v1(
    p_case_id,p_idempotency_key);
  return public.service_reserve_nayax_refund_manager_action_pre_system_saved_approval_v1(
    p_executor_assertion,p_actor_user_id,p_case_id,p_expected_case_version,
    p_idempotency_key,p_amount_cents,p_daily_amount_cap_cents,p_daily_count_cap,
    p_currency_code);
end;
$$;
revoke all on function public.service_reserve_nayax_refund_manager_action(
  text,uuid,uuid,bigint,text,integer,integer,integer,text
) from public,anon,authenticated,service_role;

alter function public.service_reserve_nayax_refund_manager_action_v3(
  text,uuid,uuid,bigint,text,integer,integer,integer,text,text,text,text
) rename to service_reserve_nayax_refund_manager_action_v3_pre_system_saved_approval_v1;
revoke all on function public.service_reserve_nayax_refund_manager_action_v3_pre_system_saved_approval_v1(
  text,uuid,uuid,bigint,text,integer,integer,integer,text,text,text,text
) from public,anon,authenticated,service_role;
create function public.service_reserve_nayax_refund_manager_action_v3(
  p_executor_assertion text,p_actor_user_id uuid,p_case_id uuid,
  p_expected_case_version bigint,p_idempotency_key text,p_amount_cents integer,
  p_daily_amount_cap_cents integer,p_daily_count_cap integer,p_currency_code text,
  p_provider_contract_version text,p_journal_contract_version text,
  p_execution_context_hash text default null
) returns jsonb language plpgsql security definer set search_path='' as $$
begin
  perform public.assert_nayax_provider_executor(p_executor_assertion);
  perform public.assert_nayax_manager_reservation_not_system_v1(
    p_case_id,p_idempotency_key);
  return public.service_reserve_nayax_refund_manager_action_v3_pre_system_saved_approval_v1(
    p_executor_assertion,p_actor_user_id,p_case_id,p_expected_case_version,
    p_idempotency_key,p_amount_cents,p_daily_amount_cap_cents,p_daily_count_cap,
    p_currency_code,p_provider_contract_version,p_journal_contract_version,
    p_execution_context_hash);
end;
$$;
revoke all on function public.service_reserve_nayax_refund_manager_action_v3(
  text,uuid,uuid,bigint,text,integer,integer,integer,text,text,text,text
) from public,anon,authenticated;
grant execute on function public.service_reserve_nayax_refund_manager_action_v3(
  text,uuid,uuid,bigint,text,integer,integer,integer,text,text,text,text
) to service_role;

alter function public.service_reserve_nayax_refund_manager_action_v4(
  text,uuid,uuid,bigint,text,integer,integer,integer,text,text,text,text,text
) rename to service_reserve_nayax_refund_manager_action_v4_pre_system_saved_approval_v1;
revoke all on function public.service_reserve_nayax_refund_manager_action_v4_pre_system_saved_approval_v1(
  text,uuid,uuid,bigint,text,integer,integer,integer,text,text,text,text,text
) from public,anon,authenticated,service_role;
create function public.service_reserve_nayax_refund_manager_action_v4(
  p_executor_assertion text,p_actor_user_id uuid,p_case_id uuid,
  p_expected_case_version bigint,p_idempotency_key text,p_amount_cents integer,
  p_daily_amount_cap_cents integer,p_daily_count_cap integer,p_currency_code text,
  p_provider_contract_version text,p_journal_contract_version text,
  p_execution_context_hash text,p_machine_authorization_time_mode text
) returns jsonb language plpgsql security definer set search_path='' as $$
begin
  perform public.assert_nayax_provider_executor(p_executor_assertion);
  perform public.assert_nayax_manager_reservation_not_system_v1(
    p_case_id,p_idempotency_key);
  return public.service_reserve_nayax_refund_manager_action_v4_pre_system_saved_approval_v1(
    p_executor_assertion,p_actor_user_id,p_case_id,p_expected_case_version,
    p_idempotency_key,p_amount_cents,p_daily_amount_cap_cents,p_daily_count_cap,
    p_currency_code,p_provider_contract_version,p_journal_contract_version,
    p_execution_context_hash,p_machine_authorization_time_mode);
end;
$$;
revoke all on function public.service_reserve_nayax_refund_manager_action_v4(
  text,uuid,uuid,bigint,text,integer,integer,integer,text,text,text,text,text
) from public,anon,authenticated;
grant execute on function public.service_reserve_nayax_refund_manager_action_v4(
  text,uuid,uuid,bigint,text,integer,integer,integer,text,text,text,text,text
) to service_role;

alter function public.service_reserve_nayax_refund_manager_action_v5(
  text,uuid,uuid,bigint,text,integer,integer,integer,text,text,text,text,text,text
) rename to service_reserve_nayax_refund_manager_action_v5_pre_system_saved_approval_v1;
revoke all on function public.service_reserve_nayax_refund_manager_action_v5_pre_system_saved_approval_v1(
  text,uuid,uuid,bigint,text,integer,integer,integer,text,text,text,text,text,text
) from public,anon,authenticated,service_role;
create function public.service_reserve_nayax_refund_manager_action_v5(
  p_executor_assertion text,p_actor_user_id uuid,p_case_id uuid,
  p_expected_case_version bigint,p_idempotency_key text,p_amount_cents integer,
  p_daily_amount_cap_cents integer,p_daily_count_cap integer,p_currency_code text,
  p_provider_contract_version text,p_journal_contract_version text,
  p_execution_context_hash text,p_machine_authorization_time_mode text,
  p_refund_email_list_mode text
) returns jsonb language plpgsql security definer set search_path='' as $$
begin
  perform public.assert_nayax_provider_executor(p_executor_assertion);
  perform public.assert_nayax_manager_reservation_not_system_v1(
    p_case_id,p_idempotency_key);
  return public.service_reserve_nayax_refund_manager_action_v5_pre_system_saved_approval_v1(
    p_executor_assertion,p_actor_user_id,p_case_id,p_expected_case_version,
    p_idempotency_key,p_amount_cents,p_daily_amount_cap_cents,p_daily_count_cap,
    p_currency_code,p_provider_contract_version,p_journal_contract_version,
    p_execution_context_hash,p_machine_authorization_time_mode,
    p_refund_email_list_mode);
end;
$$;
revoke all on function public.service_reserve_nayax_refund_manager_action_v5(
  text,uuid,uuid,bigint,text,integer,integer,integer,text,text,text,text,text,text
) from public,anon,authenticated;
grant execute on function public.service_reserve_nayax_refund_manager_action_v5(
  text,uuid,uuid,bigint,text,integer,integer,integer,text,text,text,text,text,text
) to service_role;

-- Once a person approves a refund, the browser has no second execution step.
-- Existing accepted-request attempts and saved approvals are finished only by
-- their dedicated System workers.
create or replace function public.refund_nayax_approval_continuation_ready_v1(
  p_user_id uuid,p_refund_case_id uuid
) returns boolean language sql stable security definer set search_path='' as $$
  select false;
$$;
revoke all on function public.refund_nayax_approval_continuation_ready_v1(uuid,uuid)
  from public,anon,authenticated,service_role;

create or replace function public.service_reserve_nayax_refund_approval_continuation_v1(
  p_executor_assertion text,p_actor_user_id uuid,p_case_id uuid,
  p_expected_case_version bigint,p_idempotency_key text,p_amount_cents integer,
  p_currency_code text,p_provider_contract_version text,p_journal_contract_version text
) returns jsonb language plpgsql security definer set search_path='' as $$
begin
  raise exception 'Approved Nayax refunds are finished by System; browser continuation is retired'
    using errcode='42501';
end;
$$;
revoke all on function public.service_reserve_nayax_refund_approval_continuation_v1(
  text,uuid,uuid,bigint,text,integer,text,text,text
) from public,anon,authenticated,service_role;

create or replace function public.service_reserve_nayax_refund_approval_continuation_v2(
  p_executor_assertion text,p_actor_user_id uuid,p_case_id uuid,
  p_expected_case_version bigint,p_idempotency_key text,p_amount_cents integer,
  p_currency_code text,p_provider_contract_version text,p_journal_contract_version text,
  p_machine_authorization_time_wire text,p_machine_authorization_time_mode text,
  p_refund_email_list_mode text
) returns jsonb language plpgsql security definer set search_path='' as $$
begin
  raise exception 'Approved Nayax refunds are finished by System; browser continuation is retired'
    using errcode='42501';
end;
$$;
revoke all on function public.service_reserve_nayax_refund_approval_continuation_v2(
  text,uuid,uuid,bigint,text,integer,text,text,text,text,text,text
) from public,anon,authenticated,service_role;

-- The legacy manual outcome-resolution lane remains available for ordinary
-- historical provider holds, but it must never touch a System-owned approval.
alter function public.admin_prepare_refund_nayax_resolution_intent(
  uuid,uuid,text,text,text,timestamptz,text,bigint
) rename to admin_prepare_refund_nayax_resolution_intent_pre_system_saved_approval_v1;
revoke all on function public.admin_prepare_refund_nayax_resolution_intent_pre_system_saved_approval_v1(
  uuid,uuid,text,text,text,timestamptz,text,bigint
) from public,anon,authenticated,service_role;

create function public.admin_prepare_refund_nayax_resolution_intent(
  p_case_id uuid,p_attempt_id uuid,p_resolution_result text,p_evidence_type text,
  p_evidence_reference text,p_evidence_occurred_at timestamptz,p_reason_code text,
  p_expected_case_version bigint
) returns jsonb language plpgsql security definer set search_path='' as $$
begin
  perform 1 from public.refund_case_nayax_refund_attempts attempt
  where attempt.id=p_attempt_id and attempt.refund_case_id=p_case_id for update;
  if not found then raise exception 'Nayax provider attempt not found'; end if;
  if exists(select 1 from public.refund_case_nayax_refund_attempts attempt
    where attempt.id=p_attempt_id
      and attempt.system_saved_approval_receipt_id is not null) then
    raise exception 'System-owned refund outcomes use the dedicated reconciliation path'
      using errcode='42501';
  end if;
  return public.admin_prepare_refund_nayax_resolution_intent_pre_system_saved_approval_v1(
    p_case_id,p_attempt_id,p_resolution_result,p_evidence_type,p_evidence_reference,
    p_evidence_occurred_at,p_reason_code,p_expected_case_version);
end;
$$;
revoke all on function public.admin_prepare_refund_nayax_resolution_intent(
  uuid,uuid,text,text,text,timestamptz,text,bigint
) from public,anon,authenticated,service_role;
grant execute on function public.admin_prepare_refund_nayax_resolution_intent(
  uuid,uuid,text,text,text,timestamptz,text,bigint
) to authenticated;

alter function public.admin_consume_refund_nayax_resolution_intent(
  uuid,uuid,uuid,text,text,text,timestamptz,text,text
) rename to admin_consume_refund_nayax_resolution_intent_pre_system_saved_approval_v1;
revoke all on function public.admin_consume_refund_nayax_resolution_intent_pre_system_saved_approval_v1(
  uuid,uuid,uuid,text,text,text,timestamptz,text,text
) from public,anon,authenticated,service_role;

create function public.admin_consume_refund_nayax_resolution_intent(
  p_intent_id uuid,p_case_id uuid,p_attempt_id uuid,p_resolution_result text,
  p_evidence_type text,p_evidence_reference text,p_evidence_occurred_at timestamptz,
  p_reason_code text,p_factor_verification_proof text
) returns jsonb language plpgsql security definer set search_path='' as $$
begin
  perform 1 from public.refund_case_nayax_refund_attempts attempt
  where attempt.id=p_attempt_id and attempt.refund_case_id=p_case_id for update;
  if not found then raise exception 'Nayax provider attempt not found'; end if;
  if exists(select 1 from public.refund_case_nayax_refund_attempts attempt
    where attempt.id=p_attempt_id
      and attempt.system_saved_approval_receipt_id is not null) then
    raise exception 'System-owned refund outcomes use the dedicated reconciliation path'
      using errcode='42501';
  end if;
  return public.admin_consume_refund_nayax_resolution_intent_pre_system_saved_approval_v1(
    p_intent_id,p_case_id,p_attempt_id,p_resolution_result,p_evidence_type,
    p_evidence_reference,p_evidence_occurred_at,p_reason_code,
    p_factor_verification_proof);
end;
$$;
revoke all on function public.admin_consume_refund_nayax_resolution_intent(
  uuid,uuid,uuid,text,text,text,timestamptz,text,text
) from public,anon,authenticated,service_role;
grant execute on function public.admin_consume_refund_nayax_resolution_intent(
  uuid,uuid,uuid,text,text,text,timestamptz,text,text
) to authenticated;

create or replace function public.admin_get_refund_nayax_resolution_readiness(
  p_refund_case_id uuid
) returns jsonb language plpgsql stable security definer set search_path=public,auth as $$
declare actor_user_id uuid:=auth.uid(); attempt_row public.refund_case_nayax_refund_attempts%rowtype;
begin
  if actor_user_id is null or coalesce((auth.jwt()->>'is_anonymous')::boolean,false)
    or not public.can_manage_refund_case(actor_user_id,p_refund_case_id) then
    return jsonb_build_object('visible',false,'available',false,
      'blockReason','manager_access_required','payloadRedacted',true);
  end if;
  select * into attempt_row from public.refund_case_nayax_refund_attempts attempt
  where attempt.refund_case_id=p_refund_case_id
    and attempt.system_saved_approval_receipt_id is not null
  order by attempt.created_at desc,attempt.id desc limit 1;
  if attempt_row.id is not null then
    return jsonb_build_object('visible',true,'available',false,
      'blockReason','system_provider_hold_no_retry','attemptId',attempt_row.id,
      'providerOutcome',attempt_row.provider_outcome,
      'canStartEvidenceOnlyReconciliation',false,
      'systemOutcomeEvidenceAvailable',attempt_row.reconciliation_required
        and attempt_row.status in ('ambiguous','manual_review','failed','declined')
        and attempt_row.provider_outcome in ('unknown','timeout','rejected'),
      'allowedResults',jsonb_build_array('provider_confirmed_success',
        'provider_confirmed_retry_safe','remain_on_hold'),
      'guidance','Check the exact transaction in Nayax. Do not retry the refund.',
      'authorizationMethod','system_saved_approval','payloadRedacted',true);
  end if;
  return public.admin_get_refund_nayax_resolution_readiness_pre_ops_v1(
    p_refund_case_id);
end;
$$;
revoke all on function public.admin_get_refund_nayax_resolution_readiness(uuid)
  from public,anon,authenticated,service_role;
grant execute on function public.admin_get_refund_nayax_resolution_readiness(uuid)
  to authenticated;

-- Give the shared, provider-free evidence finalizer its honest name. The
-- browser-visible generic resolver below still excludes System attempts; this
-- private kernel never calls Nayax and contains no TOTP or manual-refund step.
alter function public.admin_resolve_refund_nayax_outcome_manager_session_pre_ops_v1(
  uuid,uuid,text,text,text,timestamptz,text,bigint
) rename to refund_record_verified_nayax_outcome_manager_session_v1;
revoke all on function public.refund_record_verified_nayax_outcome_manager_session_v1(
  uuid,uuid,text,text,text,timestamptz,text,bigint
) from public,anon,authenticated,service_role;

create or replace function public.admin_resolve_refund_nayax_outcome_manager_session(
  p_case_id uuid,p_attempt_id uuid,p_resolution_result text,p_evidence_type text,
  p_evidence_reference text,p_evidence_occurred_at timestamptz,
  p_reason_code text,p_expected_case_version bigint
) returns jsonb language plpgsql security definer set search_path='' as $$
begin
  if auth.role() is distinct from 'authenticated' or auth.uid() is null
    or not public.is_super_admin(auth.uid()) then
    raise exception 'Super-admin access is required to record reconciled provider evidence'
      using errcode='42501';
  end if;
  perform 1 from public.refund_cases refund_case where refund_case.id=p_case_id for update;
  if not found then raise exception 'Refund case not found'; end if;
  perform 1 from public.refund_case_nayax_refund_attempts attempt
  where attempt.id=p_attempt_id and attempt.refund_case_id=p_case_id for update;
  if not found then raise exception 'Nayax provider attempt not found'; end if;
  if exists(select 1 from public.refund_case_nayax_refund_attempts attempt
    where attempt.id=p_attempt_id
      and attempt.system_saved_approval_receipt_id is not null) then
    raise exception 'System-owned refund outcomes use the dedicated no-retry reconciliation path'
      using errcode='42501';
  end if;
  if exists(select 1 from public.refund_authoritative_receipts receipt
    where receipt.refund_case_id=p_case_id) then
    raise exception 'Authoritative refund evidence is already recorded for this case'
      using errcode='P4661';
  end if;
  return public.refund_record_verified_nayax_outcome_manager_session_v1(
    p_case_id,p_attempt_id,p_resolution_result,p_evidence_type,
    p_evidence_reference,p_evidence_occurred_at,p_reason_code,p_expected_case_version);
end;
$$;
revoke all on function public.admin_resolve_refund_nayax_outcome_manager_session(
  uuid,uuid,text,text,text,timestamptz,text,bigint
) from public,anon,service_role;
grant execute on function public.admin_resolve_refund_nayax_outcome_manager_session(
  uuid,uuid,text,text,text,timestamptz,text,bigint
) to authenticated;

-- A Manager may record the exact observed outcome of an already-held System
-- attempt. This is evidence only: it cannot reserve, call, or retry Nayax.
create function public.admin_record_nayax_system_outcome_evidence_v1(
  p_case_id uuid,p_attempt_id uuid,p_resolution_result text,p_evidence_type text,
  p_evidence_reference text,p_evidence_occurred_at timestamptz,
  p_reason_code text,p_expected_case_version bigint
) returns jsonb language plpgsql security definer set search_path='' as $$
declare
  attempt public.refund_case_nayax_refund_attempts%rowtype;
  receipt public.refund_nayax_system_saved_approval_receipts%rowtype;
  result jsonb;
begin
  if auth.role() is distinct from 'authenticated' or auth.uid() is null
    or coalesce((auth.jwt()->>'is_anonymous')::boolean,false) then
    raise exception 'Authenticated Machine Manager session required'
      using errcode='42501';
  end if;
  perform 1 from public.refund_cases refund_case
  where refund_case.id=p_case_id for update;
  if not found then raise exception 'Refund case not found'; end if;
  if not public.can_perform_refund_official_action(auth.uid(),p_case_id) then
    raise exception 'Active Machine Manager access is required'
      using errcode='42501';
  end if;
  select * into attempt from public.refund_case_nayax_refund_attempts attempt_row
  where attempt_row.id=p_attempt_id and attempt_row.refund_case_id=p_case_id
    and attempt_row.system_saved_approval_receipt_id is not null for update;
  if not found then
    raise exception 'Exact System-owned refund attempt required'
      using errcode='P4661';
  end if;
  select * into receipt from public.refund_nayax_system_saved_approval_receipts receipt_row
  where receipt_row.id=attempt.system_saved_approval_receipt_id
    and receipt_row.refund_case_id=p_case_id
    and receipt_row.nayax_refund_attempt_id=attempt.id for share;
  if receipt.id is null or receipt.status<>'held'
    or not public.refund_nayax_system_saved_approval_terminal_binding_valid_v1(
      receipt.id,attempt.id,p_case_id)
    or not attempt.reconciliation_required
    or attempt.status not in ('ambiguous','manual_review','failed','declined')
    or attempt.provider_outcome not in ('unknown','timeout','rejected')
    or lower(btrim(coalesce(p_resolution_result,''))) not in (
      'provider_confirmed_success','provider_confirmed_retry_safe','remain_on_hold')
    or lower(btrim(coalesce(p_evidence_type,''))) not in (
      'nayax_dtm_transaction','nayax_support_ticket') then
    raise exception 'Exact held System outcome evidence required'
      using errcode='P4661';
  end if;
  result:=public.refund_record_verified_nayax_outcome_manager_session_v1(
    p_case_id,p_attempt_id,p_resolution_result,p_evidence_type,
    p_evidence_reference,p_evidence_occurred_at,p_reason_code,
    p_expected_case_version);
  insert into public.refund_case_events(
    refund_case_id,actor_user_id,event_type,message,metadata)
  values(p_case_id,auth.uid(),'nayax_system_outcome_evidence_recorded',
    'The Manager recorded the verified Nayax outcome without issuing or retrying a refund.',
    jsonb_build_object('attempt_id',attempt.id,
      'system_saved_approval_receipt_id',receipt.id,
      'resolution_result',lower(btrim(p_resolution_result)),
      'provider_call_made',false,'provider_retry_made',false,
      'payload_redacted',true));
  return result||jsonb_build_object('systemSavedApprovalEvidence',true,
    'providerCallMade',false,'providerRetryMade',false,'payloadRedacted',true);
end;
$$;
revoke all on function public.admin_record_nayax_system_outcome_evidence_v1(
  uuid,uuid,text,text,text,timestamptz,text,bigint
) from public,anon,service_role;
grant execute on function public.admin_record_nayax_system_outcome_evidence_v1(
  uuid,uuid,text,text,text,timestamptz,text,bigint
) to authenticated;

select pg_notify('pgrst','reload schema');
