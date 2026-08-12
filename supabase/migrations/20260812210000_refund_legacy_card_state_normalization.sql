-- #784: normalize only the legacy card-refund contradiction where an old
-- approval exists without any Nayax provider attempt. This owner operation is
-- deliberately disconnected from provider, Gmail, and customer-message code.

create or replace function public.refund_case_legacy_state_review_required(
  p_refund_case_id uuid
)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.refund_cases refund_case
    join public.refund_case_events normalization
      on normalization.refund_case_id = refund_case.id
      and normalization.event_type = 'legacy_card_state_normalized'
    where refund_case.id = p_refund_case_id
      and refund_case.payment_method = 'card'
      and refund_case.status = 'needs_review'
      and refund_case.decision is null
      and refund_case.nayax_refund_execution_status = 'not_requested'
      and refund_case.nayax_match_execution_eligible = false
      and refund_case.matched_nayax_transaction_id is null
      and refund_case.matched_nayax_site_id is null
      and refund_case.matched_nayax_machine_auth_time is null
      and refund_case.matched_nayax_amount_cents is null
      and refund_case.matched_nayax_card_last4 is null
      and refund_case.matched_nayax_currency_code is null
      and refund_case.nayax_recommendation_state is null
      and refund_case.nayax_recommendation_policy_version is null
      and refund_case.nayax_recommendation_evaluated_at is null
      and not exists (
        select 1
        from public.refund_case_nayax_refund_attempts attempt
        where attempt.refund_case_id = refund_case.id
      )
      and not exists (
        select 1
        from public.refund_case_events fresh_review
        where fresh_review.refund_case_id = refund_case.id
          and fresh_review.event_type in (
            'nayax_recommendation_evaluated',
            'nayax_match_selected'
          )
          and fresh_review.created_at > normalization.created_at
      )
  );
$$;

revoke execute on function public.refund_case_legacy_state_review_required(uuid)
  from public, anon, authenticated, service_role;

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
  completed_message_count integer;
  provider_attempt_count integer;
begin
  if current_user in ('anon', 'authenticated', 'service_role')
    or current_user <> session_user then
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
    count(*) filter (where message.message_type = 'approved')::integer,
    count(*) filter (
      where message.message_type = 'approved'
        and message.status = 'sent'
    )::integer,
    count(*) filter (where message.message_type = 'completed')::integer
  into
    approved_message_count,
    sent_approved_message_count,
    completed_message_count
  from public.refund_case_messages message
  where message.refund_case_id = legacy_case.id;

  if legacy_case.payment_method is distinct from 'card'
    or legacy_case.status is distinct from 'card_refund_pending'
    or legacy_case.decision is distinct from 'approved'
    or legacy_case.decided_at is null
    or legacy_case.nayax_refund_execution_status is distinct from 'not_requested'
    or provider_attempt_count <> 0
    or approved_message_count <> 1
    or sent_approved_message_count <> 1
    or completed_message_count <> 0
    or legacy_case.reporting_adjustment_id is not null
    or legacy_case.refund_completed_by is not null
    or legacy_case.refund_completed_at is not null
    or nullif(btrim(coalesce(legacy_case.manual_refund_reference, '')), '') is not null then
    raise exception 'Case does not match the exact legacy no-provider-attempt structure';
  end if;

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
      'legacy_approved_message_count', sent_approved_message_count,
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
      'legacy_approved_message_count', sent_approved_message_count
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
    'legacyApprovedMessageCount', sent_approved_message_count,
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
  'Database-owner-only, exact-shape legacy repair. It records truthful review state without provider execution or customer communication.';

create or replace function public.guard_refund_legacy_normalization_event()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if tg_op <> 'INSERT'
    and old.event_type = 'legacy_card_state_normalized' then
    raise exception 'Legacy refund normalization evidence is append-only';
  end if;
  return case when tg_op = 'DELETE' then old else new end;
end;
$$;

drop trigger if exists refund_case_events_guard_legacy_normalization
  on public.refund_case_events;
create trigger refund_case_events_guard_legacy_normalization
before update or delete on public.refund_case_events
for each row execute function public.guard_refund_legacy_normalization_event();

create or replace function public.guard_refund_legacy_state_actions()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if public.refund_case_legacy_state_review_required(old.id)
    and (
      new.status in (
        'waiting_on_customer', 'approved', 'denied', 'card_refund_pending',
        'cash_zelle_pending', 'completed', 'closed'
      )
      or new.decision is not null
      or new.decided_by is not null
      or new.decided_at is not null
      or nullif(btrim(coalesce(new.manual_refund_reference, '')), '') is not null
      or new.refund_completed_by is not null
      or new.refund_completed_at is not null
      or new.reporting_adjustment_id is not null
      or new.nayax_refund_execution_status is distinct from 'not_requested'
      or new.nayax_match_execution_eligible = true
    ) then
    raise exception 'Run a fresh transaction check before any decision or refund action';
  end if;
  return new;
end;
$$;

drop trigger if exists refund_cases_guard_legacy_state_actions
  on public.refund_cases;
create trigger refund_cases_guard_legacy_state_actions
before update on public.refund_cases
for each row execute function public.guard_refund_legacy_state_actions();

create or replace function public.guard_refund_legacy_state_message()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.message_type <> 'manual_note'
    and public.refund_case_legacy_state_review_required(new.refund_case_id) then
    raise exception 'Run a fresh transaction check before any customer message';
  end if;
  return new;
end;
$$;

drop trigger if exists refund_case_messages_guard_legacy_state
  on public.refund_case_messages;
create trigger refund_case_messages_guard_legacy_state
before insert on public.refund_case_messages
for each row execute function public.guard_refund_legacy_state_message();

create or replace function public.guard_refund_legacy_state_provider_attempt()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if public.refund_case_legacy_state_review_required(new.refund_case_id) then
    raise exception 'Run a fresh transaction check before any provider attempt';
  end if;
  return new;
end;
$$;

drop trigger if exists refund_nayax_attempts_guard_legacy_state
  on public.refund_case_nayax_refund_attempts;
create trigger refund_nayax_attempts_guard_legacy_state
before insert on public.refund_case_nayax_refund_attempts
for each row execute function public.guard_refund_legacy_state_provider_attempt();

create or replace function public.admin_get_refund_email_queue_states()
returns jsonb
language plpgsql
stable
security definer
set search_path = public, auth
as $$
declare
  actor_user_id uuid := auth.uid();
begin
  if actor_user_id is null then
    raise exception 'Authentication required';
  end if;

  return coalesce((
    select jsonb_agg(jsonb_build_object(
      'caseId', refund_case.id,
      'intakeSource', refund_case.intake_source,
      'exactCasePath', '/refunds?case=' || refund_case.id::text,
      'missingInformation', refund_case.status in ('draft', 'waiting_on_customer'),
      'possibleDuplicate', public.refund_case_has_unresolved_reconciliation(refund_case.id),
      'confirmedDuplicate', refund_case.duplicate_of_refund_case_id is not null,
      'duplicateOfCaseId', refund_case.duplicate_of_refund_case_id,
      'aging', exists (
        select 1
        from public.refund_manager_attention_states attention
        where attention.refund_case_id = refund_case.id
          and attention.attention_started_at is not null
          and attention.delivery_review_required_at is null
          and public.refund_case_requires_manager_attention(refund_case.status)
          and refund_case.status not in (
            'draft', 'waiting_on_customer', 'denied', 'completed', 'closed'
          )
          and attention.case_status = refund_case.status
          and attention.correlation_status = refund_case.correlation_status
          and attention.decision is not distinct from refund_case.decision
          and attention.deterministic_fact_version = refund_case.deterministic_fact_version
          and public.service_refund_business_days_elapsed(
            attention.attention_started_at,
            statement_timestamp(),
            'America/Los_Angeles'
          ) >= 2
      ),
      'providerHold', public.refund_nayax_provider_outcome_state(
        refund_case.nayax_refund_execution_status
      ) = 'unconfirmed',
      'providerOutcome', public.refund_nayax_provider_outcome_state(
        refund_case.nayax_refund_execution_status
      ),
      'legacyStateReviewRequired',
        public.refund_case_legacy_state_review_required(refund_case.id),
      'actionBlocked', refund_case.duplicate_of_refund_case_id is not null
        or public.refund_case_has_unresolved_reconciliation(refund_case.id)
        or public.refund_case_legacy_state_review_required(refund_case.id),
      'payloadRedacted', true
    ) order by refund_case.updated_at desc, refund_case.id)
    from public.refund_cases refund_case
    where public.can_manage_refund_case(actor_user_id, refund_case.id)
  ), '[]'::jsonb);
end;
$$;

revoke all on function public.admin_get_refund_email_queue_states()
  from public, anon;
grant execute on function public.admin_get_refund_email_queue_states()
  to authenticated, service_role;

comment on function public.admin_get_refund_email_queue_states() is
  'Returns manager-scoped queue signals, including a redacted legacy-history review freeze, without customer identifiers.';

select pg_notify('pgrst', 'reload schema');
