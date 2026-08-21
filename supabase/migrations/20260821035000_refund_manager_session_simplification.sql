-- Make the normal refund workflow match the product requirement: one exact
-- authenticated Machine Manager session, one reviewed action, and invisible
-- server-side safety controls. Historical TOTP and temporary-operator rows are
-- retained for audit, but no normal manager action depends on them.

create or replace function public.refund_official_actions_enabled()
returns boolean
language sql
immutable
set search_path = public
as $$
  select true;
$$;

-- The preceding overview wrapper preserved the legacy recent-TOTP presentation
-- fields whenever broad official actions were enabled. Normal operations now
-- expose an action solely to the exact active machine-manager mapping; the
-- action RPC remains the authoritative payload, version, and transition guard.
create or replace function public.admin_get_refund_operations_overview()
returns jsonb
language plpgsql
stable
security definer
set search_path = public, auth
as $$
declare
  actor_user_id uuid := auth.uid();
  base_result jsonb;
  enriched_cases jsonb;
begin
  -- The upstream scoped overview remains authoritative for paymentInteraction,
  -- incidentTimeConfidence, issueCategory, productLabel, machineStatus, and
  -- nearbyMachineAlerts. It also preserves the current automatic lookup states:
  -- current_lookup.status = 'claimed', lookup_failed, and
  -- Refresh transaction results. This wrapper changes only the two official
  -- action presentation fields.
  base_result := public.admin_get_refund_ops_overview_pre_nayax_mgr_v1();

  select coalesce(
    jsonb_agg(
      item.case_json || jsonb_build_object(
        'canPerformOfficialAction', case
          when not public.refund_official_actions_enabled() then false
          else public.can_perform_refund_official_action(
            actor_user_id,
            refund_case.id
          )
        end,
        'officialActionBlockReason', case
          when not public.refund_official_actions_enabled()
            then to_jsonb('official_actions_disabled'::text)
          when not public.can_perform_refund_official_action(
            actor_user_id,
            refund_case.id
          ) then to_jsonb('manager_access_required'::text)
          else null
        end
      )
      order by item.case_order
    ),
    '[]'::jsonb
  ) into enriched_cases
  from jsonb_array_elements(coalesce(base_result -> 'cases', '[]'::jsonb))
    with ordinality as item(case_json, case_order)
  join public.refund_cases refund_case
    on refund_case.id = (item.case_json ->> 'id')::uuid;

  return jsonb_set(base_result, '{cases}', enriched_cases, true);
end;
$$;

comment on function public.admin_get_refund_operations_overview() is
  'Scoped Refund Operations overview. Exact active machine managers receive normal session-based action readiness without a TOTP presentation gate.';

create or replace function public.enforce_refund_authorization_step_up_binding()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if new.authorization_method = 'manager_session' then
    if (new.step_up_intent_id is null) is distinct from
       (new.verified_totp_at is null) then
      raise exception 'Manager-session reservation evidence must be complete or absent';
    end if;

    -- Normal Nayax execution already uses an internal consumed intent as its
    -- single-attempt reservation record. The historical timestamp column is a
    -- schema-compatibility marker, not a user-entered TOTP proof.
    if new.step_up_intent_id is not null and not exists (
      select 1
      from public.refund_manager_action_step_up_intents intent
      where intent.id = new.step_up_intent_id
        and intent.refund_case_id = new.refund_case_id
        and intent.actor_user_id = new.actor_user_id
        and intent.action = new.action
        and intent.authorization_method = 'manager_session'
        and intent.manager_totp_enrollment_version is null
        and intent.status = 'consumed'
        and intent.verified_totp_at = new.verified_totp_at
        and new.action = 'nayax_execute'
    ) then
      raise exception 'Manager-session reservation evidence is invalid';
    end if;
    return new;
  end if;

  if new.step_up_intent_id is null or new.verified_totp_at is null then
    raise exception 'TOTP authorization requires a consumed human step-up intent';
  end if;
  return new;
end;
$$;

create or replace function public.admin_authorize_refund_official_action(
  p_case_id uuid,
  p_action text,
  p_expected_case_version bigint,
  p_target_status text default null,
  p_target_decision text default null,
  p_assigned_manager_email text default null,
  p_decision_reason text default null,
  p_internal_note text default null,
  p_refund_amount_cents integer default null,
  p_manual_refund_reference text default null,
  p_cash_payout_sent_at timestamptz default null,
  p_cash_payment_confirmed boolean default false,
  p_matched_nayax_candidate_token uuid default null,
  p_nayax_disagreement_reason text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public, auth
as $$
declare
  authenticated_actor_user_id uuid := auth.uid();
  refund_case public.refund_cases%rowtype;
  manager_mapping public.reporting_machine_refund_managers%rowtype;
  nayax_candidate public.refund_nayax_lookup_candidates%rowtype;
  authorization_row public.refund_case_official_action_authorizations%rowtype;
  normalized_action text := lower(btrim(coalesce(p_action, '')));
  normalized_status text := lower(btrim(coalesce(p_target_status, '')));
  normalized_decision text := lower(btrim(coalesce(p_target_decision, '')));
  candidate_evidence_hash text;
  context_hash text;
begin
  if auth.role() is distinct from 'authenticated'
    or authenticated_actor_user_id is null then
    raise exception 'Authenticated Machine Manager session required';
  end if;

  perform public.assert_refund_official_action_payload_shape(
    normalized_action,
    normalized_status,
    normalized_decision,
    p_assigned_manager_email,
    p_decision_reason,
    p_internal_note,
    p_refund_amount_cents,
    p_manual_refund_reference,
    p_cash_payout_sent_at,
    p_cash_payment_confirmed,
    p_matched_nayax_candidate_token,
    p_nayax_disagreement_reason
  );

  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(
      'refund-manager-session-action-v1|' || authenticated_actor_user_id::text ||
        '|' || p_case_id::text,
      0
    )
  );

  select case_row.*
  into refund_case
  from public.refund_cases case_row
  where case_row.id = p_case_id
  for update;

  if not found then
    raise exception 'Refund case not found';
  end if;

  if not public.can_perform_refund_official_action(
    authenticated_actor_user_id,
    refund_case.id
  ) then
    raise exception 'Active Machine Manager mapping required; admin identities are review-only';
  end if;

  if refund_case.official_action_version is distinct from p_expected_case_version then
    raise exception 'Refund case changed since review; reload before taking an official action';
  end if;

  if normalized_action = 'cash_complete' and refund_case.payment_method <> 'cash' then
    raise exception 'Cash completion is available only for cash refund cases';
  end if;

  if normalized_action = 'approve' then
    if refund_case.payment_method = 'card'
      and normalized_status <> 'card_refund_pending' then
      raise exception 'Card approval must enter the card refund pending state';
    elsif refund_case.payment_method = 'cash'
      and normalized_status <> 'cash_zelle_pending' then
      raise exception 'Cash approval must enter the cash refund pending state';
    elsif refund_case.payment_method not in ('card', 'cash') then
      raise exception 'This payment method cannot be approved for a refund';
    end if;
  end if;

  if normalized_action = 'nayax_execute' and refund_case.payment_method <> 'card' then
    raise exception 'Nayax execution is available only for card refund cases';
  end if;

  if normalized_action = 'nayax_execute'
    and p_refund_amount_cents is distinct from refund_case.refund_amount_cents then
    raise exception 'Nayax execution amount changed since manager review';
  end if;

  select manager.*
  into manager_mapping
  from public.reporting_machine_refund_managers manager
  where manager.reporting_machine_id = refund_case.reporting_machine_id
    and manager.manager_user_id = authenticated_actor_user_id
    and manager.status = 'active'
    and manager.revoked_at is null
  for share;

  if not found then
    raise exception 'Active Machine Manager mapping required; admin identities are review-only';
  end if;

  if p_matched_nayax_candidate_token is not null then
    if normalized_action <> 'approve'
      or refund_case.payment_method <> 'card'
      or normalized_status <> 'card_refund_pending' then
      raise exception 'Nayax candidate selection is available only during card approval';
    end if;

    select candidate.*
    into nayax_candidate
    from public.refund_nayax_lookup_candidates candidate
    where candidate.token = p_matched_nayax_candidate_token
      and candidate.refund_case_id = refund_case.id
      and candidate.actor_user_id = authenticated_actor_user_id
      and candidate.expires_at > statement_timestamp()
    for share;

    if not found then
      raise exception 'Nayax lookup evidence expired or belongs to another review session';
    end if;

    candidate_evidence_hash := public.refund_nayax_candidate_evidence_hash(
      nayax_candidate.refund_case_id,
      nayax_candidate.actor_user_id,
      nayax_candidate.provider_transaction_id,
      nayax_candidate.site_id,
      nayax_candidate.machine_authorization_time,
      nayax_candidate.amount_cents,
      nayax_candidate.card_last4,
      nayax_candidate.currency_code,
      nayax_candidate.evidence_summary,
      nayax_candidate.expires_at,
      nayax_candidate.created_at
    );
  end if;

  context_hash := public.refund_official_action_context_hash(
    normalized_action,
    normalized_status,
    normalized_decision,
    p_assigned_manager_email,
    p_decision_reason,
    p_internal_note,
    p_refund_amount_cents,
    p_manual_refund_reference,
    p_cash_payout_sent_at,
    p_cash_payment_confirmed,
    p_matched_nayax_candidate_token,
    p_nayax_disagreement_reason,
    candidate_evidence_hash
  );

  insert into public.refund_case_official_action_authorizations (
    refund_case_id,
    action,
    actor_user_id,
    manager_mapping_id,
    manager_mapping_version,
    expected_case_version,
    action_context_hash,
    authorization_method,
    expires_at
  ) values (
    refund_case.id,
    normalized_action,
    authenticated_actor_user_id,
    manager_mapping.id,
    manager_mapping.mapping_version,
    refund_case.official_action_version,
    context_hash,
    'manager_session',
    statement_timestamp() + interval '90 seconds'
  )
  returning * into authorization_row;

  insert into public.refund_case_events (
    refund_case_id,
    actor_user_id,
    event_type,
    message,
    metadata
  ) values (
    refund_case.id,
    authenticated_actor_user_id,
    'official_action_authorized',
    'The mapped Machine Manager authorized this exact action in the current session.',
    jsonb_build_object(
      'action', normalized_action,
      'authorization_method', 'manager_session',
      'manager_mapping_version', manager_mapping.mapping_version,
      'payload_redacted', true
    )
  );

  return jsonb_build_object(
    'authorizationId', authorization_row.id,
    'action', authorization_row.action,
    'expectedCaseVersion', authorization_row.expected_case_version,
    'mappingVersion', authorization_row.manager_mapping_version,
    'expiresAt', authorization_row.expires_at,
    'authorizationMethod', 'manager_session'
  );
end;
$$;

revoke execute on function public.admin_authorize_refund_official_action(
  uuid, text, bigint, text, text, text, text, text, integer, text,
  timestamptz, boolean, uuid, text
) from public, anon, service_role;
grant execute on function public.admin_authorize_refund_official_action(
  uuid, text, bigint, text, text, text, text, text, integer, text,
  timestamptz, boolean, uuid, text
) to authenticated;

comment on function public.admin_authorize_refund_official_action(
  uuid, text, bigint, text, text, text, text, text, integer, text,
  timestamptz, boolean, uuid, text
) is
  'Creates one short-lived authorization for the exact active mapped-manager session and frozen action payload. No provider or email call is made.';

alter table public.refund_nayax_resolution_intents
  add column if not exists authorization_method text not null default 'totp';

alter table public.refund_nayax_resolution_intents
  drop constraint if exists refund_nayax_resolution_intents_authorization_method_check,
  add constraint refund_nayax_resolution_intents_authorization_method_check
    check (authorization_method in ('totp', 'manager_session'));

alter table public.refund_nayax_resolution_intents
  alter column manager_totp_enrollment_version drop not null,
  alter column operator_version drop not null;

alter table public.refund_nayax_resolution_intents
  drop constraint if exists refund_nayax_resolution_intents_manager_totp_enrollment_version_check,
  drop constraint if exists refund_nayax_resolution_intents_operator_version_check,
  add constraint refund_nayax_resolution_intents_authority_shape_check check (
    (
      authorization_method = 'totp'
      and manager_totp_enrollment_version > 0
      and operator_version > 0
    )
    or (
      authorization_method = 'manager_session'
      and manager_totp_enrollment_version is null
      and operator_version is null
    )
  );

alter table public.refund_nayax_resolution_intents
  drop constraint if exists refund_nayax_resolution_intent_lifecycle_check,
  add constraint refund_nayax_resolution_intent_lifecycle_check check (
    (
      status = 'pending'
      and verified_totp_at is null
      and consumed_at is null
      and cancelled_at is null
    )
    or (
      status = 'consumed'
      and consumed_at is not null
      and cancelled_at is null
      and (
        (authorization_method = 'totp' and verified_totp_at is not null)
        or (authorization_method = 'manager_session' and verified_totp_at is null)
      )
    )
    or (
      status = 'cancelled'
      and verified_totp_at is null
      and consumed_at is null
      and cancelled_at is not null
    )
    or (
      status in ('superseded', 'expired')
      and verified_totp_at is null
      and consumed_at is null
      and cancelled_at is null
    )
  );

drop index if exists public.refund_nayax_resolution_one_use_totp_idx;
create unique index refund_nayax_resolution_one_use_totp_idx
  on public.refund_nayax_resolution_intents (actor_user_id, verified_totp_at)
  where status = 'consumed'
    and authorization_method = 'totp'
    and verified_totp_at is not null;

alter table public.refund_nayax_outcome_resolutions
  add column if not exists authorization_method text not null default 'totp';

alter table public.refund_nayax_outcome_resolutions
  drop constraint if exists refund_nayax_outcome_resolutions_authorization_method_check,
  add constraint refund_nayax_outcome_resolutions_authorization_method_check
    check (authorization_method in ('totp', 'manager_session'));

create or replace function public.admin_get_refund_nayax_resolution_readiness(
  p_refund_case_id uuid
)
returns jsonb
language plpgsql
stable
security definer
set search_path = public, auth
as $$
declare
  current_actor_user_id uuid := auth.uid();
  case_row public.refund_cases%rowtype;
  attempt_row public.refund_case_nayax_refund_attempts%rowtype;
  has_manager_authority boolean := false;
begin
  if current_actor_user_id is null
    or coalesce((auth.jwt() ->> 'is_anonymous')::boolean, false) then
    raise exception 'Authenticated Machine Manager session required';
  end if;

  select refund_case.*
  into case_row
  from public.refund_cases refund_case
  where refund_case.id = p_refund_case_id;

  if not found then
    return jsonb_build_object(
      'visible', false,
      'available', false,
      'payloadRedacted', true
    );
  end if;

  has_manager_authority := public.can_perform_refund_official_action(
    current_actor_user_id,
    case_row.id
  );

  if not has_manager_authority then
    return jsonb_build_object(
      'visible', false,
      'available', false,
      'payloadRedacted', true
    );
  end if;

  select attempt.*
  into attempt_row
  from public.refund_case_nayax_refund_attempts attempt
  where attempt.refund_case_id = case_row.id
    and attempt.provider_outcome in ('rejected', 'timeout', 'unknown')
  order by attempt.created_at desc, attempt.id desc
  limit 1;

  return jsonb_build_object(
    'visible', true,
    'available',
      public.refund_nayax_outcome_resolution_enabled()
      and has_manager_authority
      and attempt_row.id is not null
      and public.refund_nayax_provider_outcome_state(
        case_row.nayax_refund_execution_status
      ) in ('unconfirmed', 'rejected')
      and attempt_row.support_resolution_id is null,
    'blockReason', case
      when not public.refund_nayax_outcome_resolution_enabled()
        then 'resolution_disabled'
      when not has_manager_authority then 'manager_access_required'
      when attempt_row.id is null then 'exact_attempt_required'
      when attempt_row.support_resolution_id is not null then 'already_resolved'
      when public.refund_nayax_provider_outcome_state(
        case_row.nayax_refund_execution_status
      ) not in ('unconfirmed', 'rejected') then 'provider_hold_required'
      else null
    end,
    'attemptId', attempt_row.id,
    'providerOutcome', attempt_row.provider_outcome,
    'expectedCaseVersion', case_row.official_action_version,
    'allowedResults', jsonb_build_array(
      'provider_confirmed_success',
      'provider_confirmed_retry_safe',
      'documented_manual_completion',
      'remain_on_hold'
    ),
    'authorizationMethod', 'manager_session',
    'payloadRedacted', true
  );
end;
$$;

revoke execute on function public.admin_get_refund_nayax_resolution_readiness(uuid)
  from public, anon, service_role;
grant execute on function public.admin_get_refund_nayax_resolution_readiness(uuid)
  to authenticated;

create or replace function public.admin_resolve_refund_nayax_outcome_manager_session(
  p_case_id uuid,
  p_attempt_id uuid,
  p_resolution_result text,
  p_evidence_type text,
  p_evidence_reference text,
  p_evidence_occurred_at timestamptz,
  p_reason_code text,
  p_expected_case_version bigint
)
returns jsonb
language plpgsql
security definer
set search_path = public, auth, extensions
as $$
declare
  current_actor_user_id uuid := auth.uid();
  normalized_result text := lower(btrim(coalesce(p_resolution_result, '')));
  normalized_type text := lower(btrim(coalesce(p_evidence_type, '')));
  normalized_reference text := btrim(coalesce(p_evidence_reference, ''));
  normalized_reason text := lower(btrim(coalesce(p_reason_code, '')));
  reference_digest text;
  case_row public.refund_cases%rowtype;
  attempt_row public.refund_case_nayax_refund_attempts%rowtype;
  manager_mapping public.reporting_machine_refund_managers%rowtype;
  intent_row public.refund_nayax_resolution_intents%rowtype;
  resolution_row public.refund_nayax_outcome_resolutions%rowtype;
  adjustment_row public.sales_adjustment_facts%rowtype;
  completion_thread_row public.refund_gmail_threads%rowtype;
  completion_message_row public.refund_case_messages%rowtype;
  completion_subject text;
  completion_body text;
  evidence_hash text;
  resolved_at timestamptz := statement_timestamp();
  completion_committed boolean := false;
  retry_released boolean := false;
begin
  if current_actor_user_id is null
    or coalesce((auth.jwt() ->> 'is_anonymous')::boolean, false) then
    raise exception 'Authenticated Machine Manager session required';
  end if;

  if not public.refund_nayax_outcome_resolution_enabled() then
    raise exception 'Payment result confirmation is temporarily unavailable';
  end if;

  if not public.refund_nayax_resolution_reference_is_safe(
    normalized_reference,
    normalized_type
  ) then
    raise exception 'A safe authoritative evidence reference is required';
  end if;

  if (
    normalized_result in (
      'provider_confirmed_success',
      'documented_manual_completion'
    )
    and p_evidence_occurred_at is null
  ) or (
    normalized_result in (
      'provider_confirmed_retry_safe',
      'remain_on_hold'
    )
    and p_evidence_occurred_at is not null
  ) then
    raise exception 'Refund time is required only for a completed payment result';
  end if;

  if not (
    (
      normalized_result = 'provider_confirmed_success'
      and (
        (normalized_type = 'nayax_dtm_transaction' and normalized_reason = 'nayax_dtm_settled')
        or (
          normalized_type = 'nayax_support_ticket'
          and normalized_reason = 'nayax_support_confirmed_success'
        )
      )
    )
    or (
      normalized_result = 'provider_confirmed_retry_safe'
      and (
        (normalized_type = 'nayax_dtm_transaction' and normalized_reason = 'nayax_dtm_not_refunded')
        or (
          normalized_type = 'nayax_support_ticket'
          and normalized_reason = 'nayax_support_retry_safe'
        )
      )
    )
    or (
      normalized_result = 'documented_manual_completion'
      and normalized_type = 'documented_manual_refund'
      and normalized_reason = 'manual_nayax_completion'
    )
    or (
      normalized_result = 'remain_on_hold'
      and normalized_type in ('nayax_dtm_transaction', 'nayax_support_ticket')
      and normalized_reason in (
        'evidence_incomplete',
        'provider_still_pending',
        'evidence_conflict'
      )
    )
  ) then
    raise exception 'Result and evidence do not form an approved payment outcome';
  end if;

  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(
      'refund-nayax-manager-resolution-v1|' || current_actor_user_id::text ||
        '|' || p_case_id::text,
      0
    )
  );

  select refund_case.*
  into case_row
  from public.refund_cases refund_case
  where refund_case.id = p_case_id
  for update;

  if not found
    or case_row.official_action_version is distinct from p_expected_case_version
    or case_row.payment_method is distinct from 'card'
    or case_row.status is distinct from 'card_refund_pending'
    or case_row.decision is distinct from 'approved'
    or case_row.reporting_adjustment_id is not null
    or case_row.refund_completed_at is not null
    or public.refund_nayax_provider_outcome_state(
      case_row.nayax_refund_execution_status
    ) not in ('unconfirmed', 'rejected') then
    raise exception 'Payment result changed; reload before confirming it';
  end if;

  if not public.can_perform_refund_official_action(
    current_actor_user_id,
    case_row.id
  ) then
    raise exception 'Active Machine Manager mapping required';
  end if;

  select manager.*
  into manager_mapping
  from public.reporting_machine_refund_managers manager
  where manager.reporting_machine_id = case_row.reporting_machine_id
    and manager.manager_user_id = current_actor_user_id
    and manager.status = 'active'
    and manager.revoked_at is null
  for share;

  if not found then
    raise exception 'Active Machine Manager mapping required';
  end if;

  select attempt.*
  into attempt_row
  from public.refund_case_nayax_refund_attempts attempt
  where attempt.id = p_attempt_id
  for update;

  if not found
    or attempt_row.refund_case_id is distinct from case_row.id
    or attempt_row.provider_outcome not in ('rejected', 'timeout', 'unknown')
    or attempt_row.status not in ('declined', 'failed', 'ambiguous', 'manual_review')
    or attempt_row.support_resolution_id is not null
    or attempt_row.reporting_adjustment_id is not null
    or attempt_row.case_finalization_committed_at is not null
    or exists (
      select 1
      from public.refund_case_nayax_refund_attempts later_attempt
      where later_attempt.refund_case_id = case_row.id
        and row(later_attempt.created_at, later_attempt.id) >
          row(attempt_row.created_at, attempt_row.id)
    ) then
    raise exception 'Exact latest held payment attempt is required';
  end if;

  if p_evidence_occurred_at is not null
    and (
      p_evidence_occurred_at < attempt_row.created_at
      or p_evidence_occurred_at > resolved_at + interval '30 seconds'
    ) then
    raise exception 'Refund time must be within the reviewed payment attempt window';
  end if;

  if normalized_result in (
      'provider_confirmed_success',
      'documented_manual_completion'
    ) and exists (
      select 1
      from public.refund_case_messages customer_message
      where customer_message.refund_case_id = case_row.id
        and customer_message.message_type <> 'manual_note'
        and not (
          customer_message.message_type = 'completed'
          and customer_message.template_version = 'refund_nayax_completion_v2'
          and customer_message.nayax_refund_attempt_id is not null
        )
        and (
          customer_message.status = 'pending'
          or exists (
            select 1
            from public.refund_gmail_messages outbound
            where outbound.refund_case_id = case_row.id
              and outbound.refund_case_message_id = customer_message.id
              and outbound.direction = 'outbound'
              and outbound.message_kind = 'message'
              and outbound.status in ('pending_send', 'delivery_unknown')
          )
          or exists (
            select 1
            from public.refund_gmail_first_contact_operations first_contact
            where first_contact.refund_case_id = case_row.id
              and first_contact.refund_case_message_id = customer_message.id
              and first_contact.status in ('pending_send', 'delivery_unknown')
          )
          or (
            customer_message.status = 'failed'
            and customer_message.error_message in (
              'Gmail delivery could not be confirmed. Check the original thread before retrying.',
              'Gmail delivery could not be confirmed. Reconcile the original thread before retrying.',
              'gmail_delivery_reconciliation_required',
              'refund_gmail_delivery_reconciliation_required'
            )
          )
        )
    ) then
    raise exception 'Settle the existing customer message before confirming this refund';
  end if;

  evidence_hash := public.refund_nayax_resolution_evidence_hash(
    case_row,
    attempt_row
  );
  reference_digest := public.refund_nayax_resolution_reference_digest(
    normalized_reference
  );

  insert into public.refund_nayax_resolution_intents (
    actor_user_id,
    refund_case_id,
    nayax_refund_attempt_id,
    manager_mapping_id,
    manager_mapping_version,
    manager_totp_enrollment_version,
    operator_version,
    expected_case_version,
    resolution_result,
    evidence_type,
    evidence_reference_digest,
    evidence_occurred_at,
    reason_code,
    attempt_evidence_hash,
    authorization_method,
    status,
    not_before,
    expires_at,
    consumed_at
  ) values (
    current_actor_user_id,
    case_row.id,
    attempt_row.id,
    manager_mapping.id,
    manager_mapping.mapping_version,
    null,
    null,
    case_row.official_action_version,
    normalized_result,
    normalized_type,
    reference_digest,
    p_evidence_occurred_at,
    normalized_reason,
    evidence_hash,
    'manager_session',
    'consumed',
    resolved_at,
    resolved_at + interval '90 seconds',
    resolved_at
  )
  returning * into intent_row;

  insert into public.refund_nayax_outcome_resolutions (
    refund_case_id,
    nayax_refund_attempt_id,
    resolution_intent_id,
    actor_user_id,
    resolution_result,
    evidence_type,
    evidence_reference_digest,
    evidence_occurred_at,
    reason_code,
    prior_attempt_status,
    prior_provider_outcome,
    prior_reconciliation_required,
    prior_attempt_generation,
    next_attempt_generation,
    attempt_evidence_hash,
    authorization_method
  ) values (
    case_row.id,
    attempt_row.id,
    intent_row.id,
    current_actor_user_id,
    normalized_result,
    normalized_type,
    reference_digest,
    p_evidence_occurred_at,
    normalized_reason,
    attempt_row.status,
    attempt_row.provider_outcome,
    attempt_row.reconciliation_required,
    case_row.nayax_refund_attempt_generation,
    case
      when normalized_result = 'provider_confirmed_retry_safe'
        then case_row.nayax_refund_attempt_generation + 1
      else case_row.nayax_refund_attempt_generation
    end,
    evidence_hash,
    'manager_session'
  )
  returning * into resolution_row;

  perform set_config(
    'bloomjoy.nayax_support_resolution_id',
    resolution_row.id::text,
    true
  );

  if normalized_result in (
    'provider_confirmed_success',
    'documented_manual_completion'
  ) then
    update public.refund_cases
    set
      status = 'completed',
      decision = 'approved',
      manual_refund_reference = 'Provider evidence recorded',
      refund_completed_by = current_actor_user_id,
      refund_completed_at = intent_row.evidence_occurred_at,
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
      (intent_row.evidence_occurred_at at time zone 'UTC')::date,
      'refund',
      case_row.refund_amount_cents,
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
        'support_resolution_id', resolution_row.id,
        'support_resolution_result', normalized_result,
        'authorization_method', 'manager_session',
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
      provider_outcome = 'success',
      provider_outcome_recorded_at = intent_row.evidence_occurred_at,
      reconciliation_required = false,
      reporting_adjustment_id = adjustment_row.id,
      case_finalization_committed_at = resolved_at,
      completed_at = intent_row.evidence_occurred_at,
      support_resolution_id = resolution_row.id,
      support_resolution_result = normalized_result,
      support_resolution_recorded_at = resolved_at,
      sanitized_response = sanitized_response || jsonb_build_object(
        'support_resolution_result', normalized_result,
        'initial_provider_outcome', resolution_row.prior_provider_outcome,
        'evidence_reference_present', true,
        'evidence_action_time_present', true,
        'authorization_method', 'manager_session',
        'payload_redacted', true
      )
    where id = attempt_row.id;

    select thread.*
    into completion_thread_row
    from public.refund_gmail_threads thread
    where thread.refund_case_id = case_row.id
    order by thread.first_message_at, thread.id
    limit 1
    for update;

    if completion_thread_row.id is null then
      raise exception 'Original Gmail thread required before completing this refund';
    end if;

    completion_subject :=
      'Your ' ||
      to_char(case_row.refund_amount_cents::numeric / 100, 'FM$999999990.00') ||
      ' Bloomjoy refund is on its way';
    completion_body := concat_ws(
      E'\n\n',
      'Hi there,',
      'We issued your ' ||
        to_char(case_row.refund_amount_cents::numeric / 100, 'FM$999999990.00') ||
        ' refund' ||
        case
          when case_row.matched_nayax_card_last4 ~ '^[0-9]{4}$'
            then ' to the card ending in ' || case_row.matched_nayax_card_last4
          else ''
        end ||
        ' on ' ||
        to_char(
          intent_row.evidence_occurred_at at time zone 'UTC',
          'Mon FMDD, YYYY'
        ) || ' UTC.',
      'Your bank or card issuer may take up to 4 business days to show the credit. If it is not visible after that, reply to this email with the reference below. We are sorry this needed a refund, and we appreciate the chance to make it right.',
      'Reference: ' || case_row.public_reference,
      E'Warmly,\nBloomjoy Sweets'
    );

    insert into public.refund_case_messages (
      refund_case_id,
      message_type,
      status,
      recipient_email,
      subject,
      body,
      template_key,
      created_by,
      content_source,
      delivery_kind,
      template_version,
      requested_fields,
      nayax_refund_attempt_id
    ) values (
      case_row.id,
      'completed',
      'pending',
      case_row.customer_email,
      completion_subject,
      completion_body,
      'refund_nayax_completed_v2',
      current_actor_user_id,
      'deterministic_template',
      'manual',
      'refund_nayax_completion_v2',
      '{}'::text[],
      attempt_row.id
    )
    returning * into completion_message_row;

    update public.refund_case_nayax_refund_attempts
    set
      completion_message_id = completion_message_row.id,
      completion_gmail_thread_id = completion_thread_row.id,
      completion_delivery_status = 'pending',
      completion_delivery_attempted_at = statement_timestamp()
    where id = attempt_row.id;

    completion_committed := true;
  elsif normalized_result = 'provider_confirmed_retry_safe' then
    if not public.refund_nayax_retry_safe_case_is_current(case_row) then
      raise exception 'Case evidence is not safe to release for a fresh review';
    end if;

    update public.refund_case_nayax_refund_attempts
    set
      reconciliation_required = false,
      support_resolution_id = resolution_row.id,
      support_resolution_result = normalized_result,
      support_resolution_recorded_at = resolved_at
    where id = attempt_row.id;

    update public.refund_cases
    set
      nayax_refund_execution_status = 'not_requested',
      nayax_match_execution_eligible = true,
      nayax_refund_attempt_generation = resolution_row.next_attempt_generation
    where id = case_row.id;

    retry_released := true;
  end if;

  insert into public.refund_case_events (
    refund_case_id,
    actor_user_id,
    event_type,
    message,
    metadata
  ) values (
    case_row.id,
    current_actor_user_id,
    case
      when normalized_result = 'remain_on_hold'
        then 'nayax_support_resolution_hold_preserved'
      when normalized_result = 'provider_confirmed_retry_safe'
        then 'nayax_support_resolution_retry_safe'
      else 'nayax_support_resolution_completed'
    end,
    case
      when normalized_result = 'remain_on_hold'
        then 'The mapped manager preserved the provider hold. No payment, case outcome, or customer message changed.'
      when normalized_result = 'provider_confirmed_retry_safe'
        then 'Authoritative payment evidence released the hold to a fresh review. No provider call or customer message was made.'
      else 'Authoritative payment evidence recorded the refund, reporting adjustment, and one pending original-thread completion.'
    end,
    jsonb_build_object(
      'resolution_id', resolution_row.id,
      'resolution_intent_id', intent_row.id,
      'nayax_refund_attempt_id', attempt_row.id,
      'resolution_result', normalized_result,
      'reason_code', normalized_reason,
      'evidence_type', normalized_type,
      'evidence_reference_present', true,
      'authorization_method', 'manager_session',
      'completion_committed', completion_committed,
      'retry_released', retry_released,
      'provider_call_made', false,
      'customer_message_created', completion_committed,
      'payload_redacted', true
    )
  );

  return jsonb_build_object(
    'resolved', normalized_result <> 'remain_on_hold',
    'result', normalized_result,
    'caseCompleted', completion_committed,
    'retryReadyForFreshReview', retry_released,
    'customerCompletionAvailable', completion_committed,
    'providerCallMade', false,
    'customerMessageCreated', completion_committed,
    'customerCompletionMessageId', completion_message_row.id,
    'authorizationMethod', 'manager_session',
    'payloadRedacted', true
  );
end;
$$;

revoke execute on function public.admin_resolve_refund_nayax_outcome_manager_session(
  uuid, uuid, text, text, text, timestamptz, text, bigint
) from public, anon, service_role;
grant execute on function public.admin_resolve_refund_nayax_outcome_manager_session(
  uuid, uuid, text, text, text, timestamptz, text, bigint
) to authenticated;

create or replace function public.refund_nayax_outcome_resolution_enabled()
returns boolean
language sql
immutable
set search_path = public
as $$
  select true;
$$;

revoke execute on function public.refund_nayax_outcome_resolution_enabled()
  from public, anon, authenticated, service_role;

comment on function public.admin_resolve_refund_nayax_outcome_manager_session(
  uuid, uuid, text, text, text, timestamptz, text, bigint
) is
  'Records one authoritative result for the exact latest held Nayax attempt under the current mapped-manager session. It can never call Nayax.';

comment on function public.refund_nayax_outcome_resolution_enabled() is
  'Manager-session payment-result confirmation is enabled. The legacy TOTP/operator ceremony remains retired.';
