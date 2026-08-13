-- #793: narrow the database-owner-only legacy repair to the exact aggregate
-- history observed in production: one sent confirmation and one sent approval.
-- The prior migration remains immutable; this forward-only replacement changes
-- only the accepted message shape and redacted aggregate evidence.

create or replace function public.owner_normalize_refund_legacy_card_state(
  p_refund_case_id uuid,
  p_confirmation text
)
returns jsonb
language plpgsql
security definer
set search_path = public, auth
as $$
declare
  legacy_case public.refund_cases%rowtype;
  approved_message_count integer;
  sent_approved_message_count integer;
  confirmation_message_count integer;
  sent_confirmation_message_count integer;
  sent_message_count integer;
  non_sent_message_count integer;
  other_message_type_count integer;
  completed_message_count integer;
  total_message_count integer;
  pending_message_count integer;
  provider_attempt_count integer;
  lookup_candidate_count integer;
  operation_owner name;
  database_owner name;
begin
  select pg_get_userbyid(routine.proowner)
  into operation_owner
  from pg_proc routine
  where routine.oid =
    'public.owner_normalize_refund_legacy_card_state(uuid,text)'::regprocedure;

  select pg_get_userbyid(database.datdba)
  into database_owner
  from pg_database database
  where database.datname = current_database();

  if operation_owner is null
    or database_owner is null
    or operation_owner <> database_owner
    or current_user <> operation_owner
    or session_user <> database_owner then
    raise exception 'Legacy refund normalization is database-owner only';
  end if;

  if p_confirmation is distinct from
    'NORMALIZE_LEGACY_CARD_STATE_WITHOUT_PROVIDER_ACTION' then
    raise exception 'Exact legacy refund normalization confirmation is required';
  end if;

  select refund_case.*
  into strict legacy_case
  from public.refund_cases refund_case
  where refund_case.id = p_refund_case_id
  for update;

  if exists (
    select 1
    from public.refund_case_events event
    where event.refund_case_id = legacy_case.id
      and event.event_type = 'legacy_card_state_normalized'
  ) then
    return jsonb_build_object(
      'normalized', false,
      'alreadyNormalized', true,
      'payloadRedacted', true
    );
  end if;

  select count(*)::integer
  into provider_attempt_count
  from public.refund_case_nayax_refund_attempts attempt
  where attempt.refund_case_id = legacy_case.id;

  select
    count(*)::integer,
    count(*) filter (where message.message_type = 'approved')::integer,
    count(*) filter (
      where message.message_type = 'approved'
        and message.status = 'sent'
    )::integer,
    count(*) filter (where message.message_type = 'confirmation')::integer,
    count(*) filter (
      where message.message_type = 'confirmation'
        and message.status = 'sent'
    )::integer,
    count(*) filter (where message.status = 'sent')::integer,
    count(*) filter (where message.status is distinct from 'sent')::integer,
    count(*) filter (
      where message.message_type is null
        or message.message_type not in ('confirmation', 'approved')
    )::integer,
    count(*) filter (where message.message_type = 'completed')::integer,
    count(*) filter (where message.status = 'pending')::integer
  into
    total_message_count,
    approved_message_count,
    sent_approved_message_count,
    confirmation_message_count,
    sent_confirmation_message_count,
    sent_message_count,
    non_sent_message_count,
    other_message_type_count,
    completed_message_count,
    pending_message_count
  from public.refund_case_messages message
  where message.refund_case_id = legacy_case.id;

  if legacy_case.payment_method is distinct from 'card'
    or legacy_case.status is distinct from 'card_refund_pending'
    or legacy_case.decision is distinct from 'approved'
    or legacy_case.decided_at is null
    or legacy_case.nayax_refund_execution_status is distinct from 'not_requested'
    or provider_attempt_count <> 0
    or total_message_count <> 2
    or approved_message_count <> 1
    or sent_approved_message_count <> 1
    or confirmation_message_count <> 1
    or sent_confirmation_message_count <> 1
    or sent_message_count <> 2
    or non_sent_message_count <> 0
    or other_message_type_count <> 0
    or completed_message_count <> 0
    or pending_message_count <> 0
    or legacy_case.reporting_adjustment_id is not null
    or legacy_case.refund_completed_by is not null
    or legacy_case.refund_completed_at is not null
    or nullif(btrim(coalesce(legacy_case.manual_refund_reference, '')), '') is not null then
    raise exception 'Case does not match the exact legacy confirmation-and-approval structure';
  end if;

  select count(*)::integer
  into lookup_candidate_count
  from public.refund_nayax_lookup_candidates candidate
  where candidate.refund_case_id = legacy_case.id;

  update public.refund_cases
  set
    status = 'needs_review',
    decision = null,
    decision_reason = null,
    decided_by = null,
    decided_at = null,
    refund_amount_cents = null,
    correlation_status = 'manual_review',
    correlation_source = null,
    correlation_confidence = 0,
    correlation_summary = 'Historical payment evidence requires a fresh read-only transaction check.',
    matched_nayax_transaction_id = null,
    matched_nayax_site_id = null,
    matched_nayax_machine_auth_time = null,
    matched_nayax_amount_cents = null,
    matched_nayax_card_last4 = null,
    matched_nayax_currency_code = null,
    nayax_recommendation_state = null,
    nayax_recommendation_policy_version = null,
    nayax_recommendation_evaluated_at = null,
    nayax_match_execution_eligible = false,
    automation_state = 'under_review'
  where id = legacy_case.id;

  -- Candidate tokens are replaceable lookup cache, not durable case history.
  -- Both sent customer messages remain byte-for-byte untouched.
  delete from public.refund_nayax_lookup_candidates candidate
  where candidate.refund_case_id = legacy_case.id;

  insert into public.refund_case_events (
    refund_case_id,
    actor_user_id,
    event_type,
    message,
    metadata
  ) values (
    legacy_case.id,
    null,
    'legacy_card_state_normalized',
    'Historical approval did not represent a provider refund. The case returned to review; no provider or customer action was taken.',
    jsonb_build_object(
      'previous_status', legacy_case.status,
      'previous_decision', legacy_case.decision,
      'previous_decided_at', legacy_case.decided_at,
      'previous_decision_reason_present',
        nullif(btrim(coalesce(legacy_case.decision_reason, '')), '') is not null,
      'previous_decided_by_present', legacy_case.decided_by is not null,
      'previous_refund_amount_cents', legacy_case.refund_amount_cents,
      'previous_correlation_status', legacy_case.correlation_status,
      'previous_correlation_source', legacy_case.correlation_source,
      'previous_match_present', legacy_case.matched_nayax_transaction_id is not null,
      'previous_match_site_present', legacy_case.matched_nayax_site_id is not null,
      'previous_match_time_present', legacy_case.matched_nayax_machine_auth_time is not null,
      'previous_match_amount_present', legacy_case.matched_nayax_amount_cents is not null,
      'previous_recommendation_state', legacy_case.nayax_recommendation_state,
      'previous_recommendation_policy_present',
        legacy_case.nayax_recommendation_policy_version is not null,
      'previous_recommendation_evaluated_at', legacy_case.nayax_recommendation_evaluated_at,
      'legacy_confirmation_message_count', sent_confirmation_message_count,
      'legacy_approved_message_count', sent_approved_message_count,
      'total_historical_message_count', total_message_count,
      'stale_lookup_candidate_count', lookup_candidate_count,
      'provider_attempt_count', provider_attempt_count,
      'provider_execution_status', legacy_case.nayax_refund_execution_status,
      'payload_redacted', true
    )
  );

  insert into public.admin_audit_log (
    actor_user_id,
    action,
    entity_type,
    entity_id,
    before,
    after,
    meta
  ) values (
    null,
    'refund_case.legacy_state_normalized',
    'refund_case',
    legacy_case.id::text,
    jsonb_build_object(
      'status', legacy_case.status,
      'decision', legacy_case.decision,
      'decision_reason_present',
        nullif(btrim(coalesce(legacy_case.decision_reason, '')), '') is not null,
      'decided_by_present', legacy_case.decided_by is not null,
      'decided_at_present', legacy_case.decided_at is not null,
      'refund_amount_present', legacy_case.refund_amount_cents is not null,
      'matched_nayax_evidence_present', legacy_case.matched_nayax_transaction_id is not null,
      'nayax_recommendation_present', legacy_case.nayax_recommendation_state is not null,
      'provider_attempt_count', provider_attempt_count,
      'provider_execution_status', legacy_case.nayax_refund_execution_status,
      'legacy_confirmation_message_count', sent_confirmation_message_count,
      'legacy_approved_message_count', sent_approved_message_count,
      'total_historical_message_count', total_message_count,
      'stale_lookup_candidate_count', lookup_candidate_count
    ),
    jsonb_build_object(
      'status', 'needs_review',
      'decision_present', false,
      'provider_attempt_count', provider_attempt_count,
      'provider_execution_status', 'not_requested',
      'execution_eligible', false,
      'refund_amount_present', false,
      'matched_nayax_evidence_present', false,
      'nayax_recommendation_present', false
    ),
    jsonb_build_object(
      'operation', 'owner_only_forward_repair',
      'provider_action_taken', false,
      'customer_message_sent', false,
      'payload_redacted', true
    )
  );

  return jsonb_build_object(
    'normalized', true,
    'alreadyNormalized', false,
    'status', 'needs_review',
    'decision', null,
    'providerAttemptCount', provider_attempt_count,
    'legacyConfirmationMessageCount', sent_confirmation_message_count,
    'legacyApprovedMessageCount', sent_approved_message_count,
    'totalHistoricalMessageCount', total_message_count,
    'staleLookupCandidateCount', lookup_candidate_count,
    'providerExecutionStatus', 'not_requested',
    'payloadRedacted', true
  );
exception
  when no_data_found then
    raise exception 'Refund case was not found';
end;
$$;

revoke all on function public.owner_normalize_refund_legacy_card_state(uuid, text)
  from public, anon, authenticated, service_role;

comment on function public.owner_normalize_refund_legacy_card_state(uuid, text) is
  'Database-owner-only repair for exactly one sent confirmation plus one sent approval. It records truthful review state without provider execution or customer communication.';

select pg_notify('pgrst', 'reload schema');
