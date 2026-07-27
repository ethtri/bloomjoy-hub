-- One manager approval now authorizes the already-recommended transaction,
-- executes the guarded provider flow, finalizes reporting, and queues one
-- customer plus one approving-manager confirmation.
--
-- This migration does not enable Nayax production execution. Existing
-- environment flags, machine allowlists, caps, provider-contract confirmation,
-- dry-run, and kill-switch controls remain fail-closed.

alter table public.refund_cases
  drop constraint if exists refund_cases_nayax_execution_eligibility_check;

alter table public.refund_cases
  add constraint refund_cases_nayax_execution_eligibility_check
  check (
    nayax_match_execution_eligible = false
    or (
      nayax_recommendation_state = 'high_confidence'
      and correlation_status = 'matched'
      and correlation_source = 'nayax'
      and matched_nayax_transaction_id is not null
      and nayax_recommendation_policy_version is not null
    )
  );

alter table public.refund_cases
  drop constraint if exists refund_cases_nayax_refund_execution_status_check;

alter table public.refund_cases
  add constraint refund_cases_nayax_refund_execution_status_check
  check (nayax_refund_execution_status in (
    'not_requested',
    'ready',
    'requested',
    'approved',
    'succeeded',
    'declined',
    'failed',
    'ambiguous',
    'disabled',
    'manual_review'
  ));

create table if not exists public.refund_case_resolution_notifications (
  id uuid primary key default gen_random_uuid(),
  refund_case_id uuid not null references public.refund_cases (id) on delete cascade,
  nayax_attempt_id uuid not null references public.refund_case_nayax_refund_attempts (id) on delete cascade,
  audience text not null check (audience in ('customer', 'manager')),
  recipient_email text not null check (
    length(btrim(recipient_email)) between 3 and 320
    and position('@' in recipient_email) > 1
  ),
  delivery_key text not null unique check (
    length(delivery_key) between 8 and 256
    and delivery_key ~ '^[A-Za-z0-9][A-Za-z0-9._:/-]+$'
  ),
  status text not null default 'pending' check (
    status in ('pending', 'sending', 'sent', 'failed', 'manual_review')
  ),
  attempt_count integer not null default 0 check (attempt_count between 0 and 3),
  next_attempt_at timestamptz,
  claimed_at timestamptz,
  sent_at timestamptz,
  error_code text,
  provider_message_id text check (
    provider_message_id is null
    or provider_message_id ~ '^[A-Za-z0-9][A-Za-z0-9._:-]{5,159}$'
  ),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint refund_case_resolution_notification_audience_unique
    unique (refund_case_id, audience)
);

create index if not exists refund_case_resolution_notifications_due_idx
  on public.refund_case_resolution_notifications (status, next_attempt_at, created_at)
  where status in ('pending', 'failed');

drop trigger if exists refund_case_resolution_notifications_set_updated_at
  on public.refund_case_resolution_notifications;
create trigger refund_case_resolution_notifications_set_updated_at
before update on public.refund_case_resolution_notifications
for each row execute function public.set_updated_at();

alter table public.refund_case_resolution_notifications enable row level security;

revoke all on public.refund_case_resolution_notifications from public, anon, authenticated;
grant select, insert, update, delete on public.refund_case_resolution_notifications to service_role;

comment on table public.refund_case_resolution_notifications is
  'Service-only, idempotent customer and approving-manager completion notifications for confirmed Nayax refunds.';

create or replace function public.can_prepare_nayax_refund_execution(
  p_user_id uuid,
  p_refund_case_id uuid
)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select p_user_id is not null
    and p_refund_case_id is not null
    and exists (
      select 1
      from public.refund_cases refund_case
      where refund_case.id = p_refund_case_id
        and public.can_manage_refund_case(p_user_id, refund_case.id)
        and refund_case.payment_method = 'card'
        and refund_case.decision = 'approved'
        and refund_case.status in ('approved', 'card_refund_pending')
        and refund_case.correlation_status = 'matched'
        and refund_case.correlation_source = 'nayax'
        and refund_case.nayax_recommendation_state = 'high_confidence'
        and refund_case.nayax_match_execution_eligible = true
        and refund_case.nayax_recommendation_policy_version is not null
        and public.is_review_safe_nayax_transaction_reference(refund_case.matched_nayax_transaction_id)
        and refund_case.matched_nayax_site_id is not null
        and refund_case.matched_nayax_site_id > 0
        and refund_case.matched_nayax_machine_auth_time is not null
        and refund_case.matched_nayax_currency_code = 'USD'
        and refund_case.refund_amount_cents is not null
        and refund_case.payment_amount_cents is not null
        and refund_case.matched_nayax_amount_cents is not null
        and refund_case.refund_amount_cents > 0
        and refund_case.refund_amount_cents = refund_case.payment_amount_cents
        and refund_case.refund_amount_cents = refund_case.matched_nayax_amount_cents
        and refund_case.reporting_adjustment_id is null
        and not exists (
          select 1
          from public.refund_cases duplicate_case
          where duplicate_case.id <> refund_case.id
            and duplicate_case.matched_nayax_transaction_id = refund_case.matched_nayax_transaction_id
        )
        and exists (
          select 1
          from public.reporting_machines machine
          where machine.id = refund_case.reporting_machine_id
            and machine.status = 'active'
            and machine.nayax_refunds_enabled = true
            and nullif(btrim(machine.nayax_machine_id), '') is not null
            and nullif(btrim(machine.nayax_account_key), '') is not null
            and (
              machine.nayax_refund_max_amount_cents is null
              or refund_case.refund_amount_cents <= machine.nayax_refund_max_amount_cents
            )
        )
    );
$$;

comment on function public.can_prepare_nayax_refund_execution(uuid, uuid) is
  'Fail-closed readiness predicate for a manager-approved high-confidence strong-card or unique-QR/time recommendation.';

revoke execute on function public.can_prepare_nayax_refund_execution(uuid, uuid)
from public, anon, authenticated;
grant execute on function public.can_prepare_nayax_refund_execution(uuid, uuid)
to service_role;

create or replace function public.service_approve_nayax_refund_as_actor(
  p_actor_user_id uuid,
  p_refund_case_id uuid,
  p_candidate_token uuid,
  p_policy_version text
)
returns jsonb
language plpgsql
security definer
set search_path = public, auth
as $$
declare
  before_row public.refund_cases%rowtype;
  after_row public.refund_cases%rowtype;
  candidate public.refund_nayax_lookup_candidates%rowtype;
  actor_email text;
  candidate_confidence_class text;
  candidate_policy_version text;
  approval_changed boolean := false;
begin
  if p_actor_user_id is null or p_refund_case_id is null then
    raise exception 'Refund approval requires an actor and case';
  end if;

  if p_policy_version is null
    or p_policy_version !~ '^[A-Za-z0-9][A-Za-z0-9._:-]{5,79}$' then
    raise exception 'Refund matching policy version is invalid';
  end if;

  select refund_case.*
  into before_row
  from public.refund_cases refund_case
  where refund_case.id = p_refund_case_id
  for update;

  if not found then
    raise exception 'Refund case not found';
  end if;

  if not public.can_manage_refund_case(p_actor_user_id, before_row.id) then
    raise exception 'Refund case access required';
  end if;

  select lower(btrim(coalesce(refund_actor.email::text, '')))
  into actor_email
  from auth.users refund_actor
  where refund_actor.id = p_actor_user_id;

  if actor_email is null or position('@' in actor_email) <= 1 then
    raise exception 'Approving manager email is required';
  end if;

  if nullif(btrim(coalesce(before_row.customer_email, '')), '') is null
    or position('@' in before_row.customer_email) <= 1 then
    raise exception 'Customer email is required before card refund approval';
  end if;

  if before_row.status = 'completed' then
    return jsonb_build_object(
      'approved', true,
      'alreadyCompleted', true,
      'candidateAccepted', false
    );
  end if;

  if before_row.status = 'denied' or before_row.decision = 'denied' then
    raise exception 'Denied refund cases cannot be approved for Nayax execution';
  end if;

  if before_row.payment_method <> 'card' then
    raise exception 'Nayax execution is available only for card refund cases';
  end if;

  if p_candidate_token is not null then
    select private_candidate.*
    into candidate
    from public.refund_nayax_lookup_candidates private_candidate
    where private_candidate.token = p_candidate_token
      and private_candidate.refund_case_id = before_row.id
      and private_candidate.expires_at > statement_timestamp()
    for share;
  elsif before_row.matched_nayax_transaction_id is not null then
    select private_candidate.*
    into candidate
    from public.refund_nayax_lookup_candidates private_candidate
    where private_candidate.refund_case_id = before_row.id
      and private_candidate.provider_transaction_id = before_row.matched_nayax_transaction_id
      and private_candidate.expires_at > statement_timestamp()
    order by private_candidate.created_at desc
    limit 1
    for share;
  end if;

  if candidate.token is not null then
    candidate_confidence_class := candidate.evidence_summary ->> 'confidence_class';
    candidate_policy_version := candidate.evidence_summary ->> 'policy_version';

    if candidate.evidence_summary ->> 'selection_allowed' is distinct from 'true'
      or candidate.evidence_summary ->> 'is_recommended' is distinct from 'true'
      or candidate.evidence_summary ->> 'recommendation_state' is distinct from 'high_confidence'
      or candidate.evidence_summary ->> 'one_click_eligible' is distinct from 'true'
      or candidate_confidence_class is null
      or candidate_confidence_class not in ('strong_card', 'unique_qr_time')
      or candidate_policy_version is distinct from p_policy_version then
      raise exception 'Only the current high-confidence recommended transaction can be approved';
    end if;

    if not public.is_review_safe_nayax_transaction_reference(candidate.provider_transaction_id)
      or candidate.site_id is null
      or candidate.site_id <= 0
      or candidate.machine_authorization_time is null
      or candidate.amount_cents is null
      or candidate.amount_cents <= 0
      or candidate.currency_code is distinct from 'USD'
      or before_row.payment_amount_cents is distinct from candidate.amount_cents then
      raise exception 'Recommended transaction evidence is incomplete or changed';
    end if;

    if exists (
      select 1
      from public.refund_cases duplicate_case
      where duplicate_case.id <> before_row.id
        and duplicate_case.matched_nayax_transaction_id = candidate.provider_transaction_id
    ) then
      raise exception 'This Nayax transaction is already linked to another refund case'
        using errcode = '23505';
    end if;

    approval_changed :=
      before_row.decision is distinct from 'approved'
      or before_row.status is distinct from 'card_refund_pending'
      or before_row.matched_nayax_transaction_id is distinct from candidate.provider_transaction_id
      or before_row.nayax_match_execution_eligible is distinct from true;

    update public.refund_cases
    set
      status = 'card_refund_pending',
      decision = 'approved',
      decided_by = coalesce(decided_by, p_actor_user_id),
      decided_at = coalesce(decided_at, statement_timestamp()),
      refund_amount_cents = candidate.amount_cents,
      matched_nayax_transaction_id = candidate.provider_transaction_id,
      matched_nayax_site_id = candidate.site_id,
      matched_nayax_machine_auth_time = candidate.machine_authorization_time,
      matched_nayax_amount_cents = candidate.amount_cents,
      matched_nayax_card_last4 = candidate.card_last4,
      matched_nayax_currency_code = candidate.currency_code,
      correlation_status = 'matched',
      correlation_source = 'nayax',
      correlation_confidence = greatest(correlation_confidence, 0.95),
      correlation_summary =
        'Manager approved the single high-confidence recommended transaction for automated refund execution.',
      nayax_recommendation_state = 'high_confidence',
      nayax_recommendation_policy_version = candidate_policy_version,
      nayax_recommendation_evaluated_at = coalesce(
        nayax_recommendation_evaluated_at,
        candidate.created_at
      ),
      nayax_match_execution_eligible = true,
      nayax_refund_execution_status = case
        when nayax_refund_execution_status in ('ambiguous', 'manual_review', 'succeeded')
          then nayax_refund_execution_status
        else 'ready'
      end,
      automation_state = 'approved',
      automation_follow_up_due_at = null,
      updated_at = statement_timestamp()
    where id = before_row.id
    returning * into after_row;
  else
    if before_row.nayax_recommendation_state is distinct from 'high_confidence'
      or before_row.nayax_recommendation_policy_version is distinct from p_policy_version
      or before_row.nayax_match_execution_eligible is distinct from true
      or before_row.correlation_status is distinct from 'matched'
      or before_row.correlation_source is distinct from 'nayax'
      or not public.is_review_safe_nayax_transaction_reference(before_row.matched_nayax_transaction_id)
      or before_row.matched_nayax_site_id is null
      or before_row.matched_nayax_site_id <= 0
      or before_row.matched_nayax_machine_auth_time is null
      or before_row.matched_nayax_currency_code is distinct from 'USD'
      or before_row.matched_nayax_amount_cents is null
      or before_row.payment_amount_cents is distinct from before_row.matched_nayax_amount_cents then
      raise exception 'The high-confidence recommendation expired; run matching again';
    end if;

    approval_changed :=
      before_row.decision is distinct from 'approved'
      or before_row.status is distinct from 'card_refund_pending';

    update public.refund_cases
    set
      status = 'card_refund_pending',
      decision = 'approved',
      decided_by = coalesce(decided_by, p_actor_user_id),
      decided_at = coalesce(decided_at, statement_timestamp()),
      refund_amount_cents = matched_nayax_amount_cents,
      nayax_refund_execution_status = case
        when nayax_refund_execution_status in ('ambiguous', 'manual_review', 'succeeded')
          then nayax_refund_execution_status
        else 'ready'
      end,
      automation_state = 'approved',
      automation_follow_up_due_at = null,
      updated_at = statement_timestamp()
    where id = before_row.id
    returning * into after_row;
  end if;

  if approval_changed then
    insert into public.refund_case_events (
      refund_case_id,
      actor_user_id,
      event_type,
      message,
      metadata
    )
    values (
      after_row.id,
      p_actor_user_id,
      'nayax_refund_approved',
      'Manager approved the recommended refund; automated Nayax execution started.',
      jsonb_build_object(
        'policy_version', after_row.nayax_recommendation_policy_version,
        'recommendation_state', after_row.nayax_recommendation_state,
        'execution_eligible', after_row.nayax_match_execution_eligible,
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
    )
    values (
      p_actor_user_id,
      'refund_case.nayax_refund_approved',
      'refund_case',
      after_row.id::text,
      jsonb_build_object(
        'status', before_row.status,
        'decision', before_row.decision,
        'execution_eligible', before_row.nayax_match_execution_eligible
      ),
      jsonb_build_object(
        'status', after_row.status,
        'decision', after_row.decision,
        'execution_eligible', after_row.nayax_match_execution_eligible
      ),
      jsonb_build_object(
        'transaction_present', after_row.matched_nayax_transaction_id is not null,
        'site_present', after_row.matched_nayax_site_id is not null,
        'card_digits_included', false,
        'payload_redacted', true
      )
    );
  end if;

  return jsonb_build_object(
    'approved', true,
    'alreadyCompleted', false,
    'candidateAccepted', candidate.token is not null,
    'approvalRecorded', approval_changed,
    'status', after_row.status
  );
end;
$$;

comment on function public.service_approve_nayax_refund_as_actor(uuid, uuid, uuid, text) is
  'Service-only one-decision authorization of the current high-confidence recommended Nayax transaction.';

revoke execute on function public.service_approve_nayax_refund_as_actor(uuid, uuid, uuid, text)
from public, anon, authenticated;
grant execute on function public.service_approve_nayax_refund_as_actor(uuid, uuid, uuid, text)
to service_role;

create or replace function public.service_finalize_nayax_refund_execution(
  p_actor_user_id uuid,
  p_refund_case_id uuid,
  p_attempt_id uuid,
  p_provider_status text,
  p_sanitized_response jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = public, auth
as $$
declare
  refund_case public.refund_cases%rowtype;
  refund_attempt public.refund_case_nayax_refund_attempts%rowtype;
  completed_case jsonb;
  manager_email text;
  assigned_manager_email text;
begin
  if p_actor_user_id is null
    or p_refund_case_id is null
    or p_attempt_id is null then
    raise exception 'Nayax finalization requires an actor, case, and attempt';
  end if;

  if p_provider_status is null
    or length(p_provider_status) > 200
    or p_provider_status !~ '^[A-Za-z0-9][A-Za-z0-9._: -]*$' then
    raise exception 'Nayax provider status is invalid';
  end if;

  if p_sanitized_response is null
    or jsonb_typeof(p_sanitized_response) <> 'object'
    or p_sanitized_response ->> 'payload_redacted' is distinct from 'true'
    or pg_column_size(p_sanitized_response) > 8192 then
    raise exception 'Nayax sanitized response is invalid';
  end if;

  select attempt.*
  into refund_attempt
  from public.refund_case_nayax_refund_attempts attempt
  where attempt.id = p_attempt_id
    and attempt.refund_case_id = p_refund_case_id
    and attempt.execution_mode = 'request_and_approve'
  for update;

  if not found then
    raise exception 'Nayax refund attempt not found';
  end if;

  if refund_attempt.actor_user_id is distinct from p_actor_user_id then
    raise exception 'Only the manager who claimed this Nayax refund may finalize it';
  end if;

  select case_row.*
  into refund_case
  from public.refund_cases case_row
  where case_row.id = p_refund_case_id
  for update;

  if not found or not public.can_manage_refund_case(p_actor_user_id, p_refund_case_id) then
    raise exception 'Refund case access required';
  end if;

  if refund_attempt.status not in ('requested', 'approved', 'succeeded') then
    raise exception 'Nayax refund attempt is not ready for successful finalization';
  end if;

  if refund_case.decision is distinct from 'approved'
    or refund_case.status not in ('approved', 'card_refund_pending', 'completed')
    or refund_case.nayax_match_execution_eligible is distinct from true then
    raise exception 'Refund case is not approved for Nayax finalization';
  end if;

  select lower(btrim(coalesce(refund_actor.email::text, '')))
  into manager_email
  from auth.users refund_actor
  where refund_actor.id = p_actor_user_id;

  if manager_email is null or position('@' in manager_email) <= 1 then
    raise exception 'Approving manager email is required';
  end if;

  if refund_case.assigned_manager_id is not null then
    select lower(btrim(coalesce(assigned_actor.email::text, '')))
    into assigned_manager_email
    from auth.users assigned_actor
    where assigned_actor.id = refund_case.assigned_manager_id;
  end if;

  update public.refund_case_nayax_refund_attempts
  set
    status = 'succeeded',
    provider_status = p_provider_status,
    error_code = null,
    sanitized_response = p_sanitized_response
  where id = refund_attempt.id;

  if refund_case.status <> 'completed' then
    completed_case := public.service_update_refund_case_as_actor(
      p_actor_user_id,
      refund_case.id,
      'completed',
      assigned_manager_email,
      'approved',
      refund_case.decision_reason,
      'Confirmed Nayax success; Bloomjoy completed the case automatically.',
      refund_case.refund_amount_cents,
      'NAYAX-' || refund_case.public_reference,
      false,
      null,
      null,
      null,
      null,
      null,
      null
    );
  else
    completed_case := to_jsonb(refund_case);
  end if;

  update public.refund_cases
  set
    nayax_refund_execution_status = 'succeeded',
    automation_state = 'completed',
    automation_follow_up_due_at = null,
    updated_at = statement_timestamp()
  where id = refund_case.id;

  insert into public.refund_case_resolution_notifications (
    refund_case_id,
    nayax_attempt_id,
    audience,
    recipient_email,
    delivery_key,
    status,
    next_attempt_at
  )
  values
    (
      refund_case.id,
      refund_attempt.id,
      'customer',
      lower(btrim(refund_case.customer_email)),
      'refund-completed/customer/' || refund_case.id::text,
      'pending',
      statement_timestamp()
    ),
    (
      refund_case.id,
      refund_attempt.id,
      'manager',
      manager_email,
      'refund-completed/manager/' || refund_case.id::text,
      'pending',
      statement_timestamp()
    )
  on conflict (refund_case_id, audience) do nothing;

  return jsonb_build_object(
    'completed', true,
    'refundCaseId', refund_case.id,
    'publicReference', refund_case.public_reference,
    'notificationCount', 2,
    'payloadRedacted', true
  );
end;
$$;

comment on function public.service_finalize_nayax_refund_execution(uuid, uuid, uuid, text, jsonb) is
  'Service-only atomic successful-attempt finalization, reporting adjustment, and two-recipient notification outbox creation.';

revoke execute on function public.service_finalize_nayax_refund_execution(uuid, uuid, uuid, text, jsonb)
from public, anon, authenticated;
grant execute on function public.service_finalize_nayax_refund_execution(uuid, uuid, uuid, text, jsonb)
to service_role;

create or replace function public.service_claim_refund_resolution_notifications(
  p_refund_case_id uuid default null,
  p_limit integer default 20
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  claimed_rows jsonb;
begin
  update public.refund_case_resolution_notifications notification
  set
    status = 'manual_review',
    next_attempt_at = null,
    error_code = coalesce(notification.error_code, 'delivery_retry_window_expired')
  where notification.status in ('pending', 'failed')
    and (
      notification.attempt_count >= 3
      or notification.created_at <= statement_timestamp() - interval '23 hours'
    );

  with due as (
    select notification.id
    from public.refund_case_resolution_notifications notification
    where notification.status in ('pending', 'failed')
      and notification.attempt_count < 3
      and notification.created_at > statement_timestamp() - interval '23 hours'
      and coalesce(notification.next_attempt_at, notification.created_at) <= statement_timestamp()
      and (p_refund_case_id is null or notification.refund_case_id = p_refund_case_id)
    order by notification.created_at, notification.audience
    for update skip locked
    limit greatest(1, least(coalesce(p_limit, 20), 50))
  ),
  claimed as (
    update public.refund_case_resolution_notifications notification
    set
      status = 'sending',
      attempt_count = notification.attempt_count + 1,
      claimed_at = statement_timestamp(),
      next_attempt_at = null,
      error_code = null
    from due
    where notification.id = due.id
    returning
      notification.id,
      notification.refund_case_id,
      notification.audience,
      notification.recipient_email,
      notification.delivery_key,
      notification.attempt_count
  )
  select coalesce(
    jsonb_agg(jsonb_build_object(
      'id', claimed.id,
      'refundCaseId', claimed.refund_case_id,
      'audience', claimed.audience,
      'recipientEmail', claimed.recipient_email,
      'deliveryKey', claimed.delivery_key,
      'attemptCount', claimed.attempt_count
    ) order by claimed.audience),
    '[]'::jsonb
  )
  into claimed_rows
  from claimed;

  return claimed_rows;
end;
$$;

comment on function public.service_claim_refund_resolution_notifications(uuid, integer) is
  'Service-only skip-locked claim for bounded idempotent refund completion email delivery.';

revoke execute on function public.service_claim_refund_resolution_notifications(uuid, integer)
from public, anon, authenticated;
grant execute on function public.service_claim_refund_resolution_notifications(uuid, integer)
to service_role;

create or replace function public.service_finish_refund_resolution_notification(
  p_notification_id uuid,
  p_status text,
  p_error_code text default null,
  p_provider_message_id text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  notification public.refund_case_resolution_notifications%rowtype;
  normalized_status text;
  normalized_error_code text;
  normalized_provider_message_id text;
begin
  normalized_status := lower(btrim(coalesce(p_status, '')));
  if normalized_status not in ('sent', 'failed') then
    raise exception 'Refund notification result is invalid';
  end if;

  normalized_error_code := nullif(lower(btrim(coalesce(p_error_code, ''))), '');
  if normalized_error_code is not null
    and normalized_error_code !~ '^[a-z0-9][a-z0-9_:-]{2,79}$' then
    raise exception 'Refund notification error code is invalid';
  end if;

  normalized_provider_message_id := nullif(btrim(coalesce(p_provider_message_id, '')), '');
  if normalized_provider_message_id is not null
    and normalized_provider_message_id !~ '^[A-Za-z0-9][A-Za-z0-9._:-]{5,159}$' then
    raise exception 'Refund notification provider reference is invalid';
  end if;

  select delivery.*
  into notification
  from public.refund_case_resolution_notifications delivery
  where delivery.id = p_notification_id
  for update;

  if not found then
    raise exception 'Refund notification not found';
  end if;

  if notification.status = 'sent' then
    return jsonb_build_object(
      'finished', false,
      'status', 'sent',
      'alreadySent', true
    );
  end if;

  if notification.status <> 'sending' then
    raise exception 'Refund notification is not claimed for delivery';
  end if;

  update public.refund_case_resolution_notifications
  set
    status = case
      when normalized_status = 'sent' then 'sent'
      when notification.attempt_count >= 3 then 'manual_review'
      else 'failed'
    end,
    sent_at = case
      when normalized_status = 'sent' then statement_timestamp()
      else sent_at
    end,
    next_attempt_at = case
      when normalized_status = 'failed' and notification.attempt_count < 3
        then statement_timestamp() + interval '15 minutes'
      else null
    end,
    error_code = case
      when normalized_status = 'sent' then null
      else coalesce(normalized_error_code, 'email_delivery_failed')
    end,
    provider_message_id = case
      when normalized_status = 'sent' then normalized_provider_message_id
      else provider_message_id
    end
  where id = notification.id
  returning * into notification;

  return jsonb_build_object(
    'finished', true,
    'status', notification.status,
    'alreadySent', false
  );
end;
$$;

comment on function public.service_finish_refund_resolution_notification(uuid, text, text, text) is
  'Service-only completion of one idempotent refund resolution notification attempt.';

revoke execute on function public.service_finish_refund_resolution_notification(uuid, text, text, text)
from public, anon, authenticated;
grant execute on function public.service_finish_refund_resolution_notification(uuid, text, text, text)
to service_role;
