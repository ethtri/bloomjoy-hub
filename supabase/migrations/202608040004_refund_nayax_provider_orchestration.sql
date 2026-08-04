-- #409 local/synthetic provider orchestration proof.
--
-- This migration does not enable a live Nayax HTTP call. It establishes the
-- immutable, manager/TOTP-bound database boundary that a future owner-approved
-- provider adapter must use. No production executor assertion is seeded here.

create table if not exists public.refund_nayax_provider_callers (
  caller_id text primary key,
  assertion_digest text not null check (assertion_digest ~ '^[a-f0-9]{64}$'),
  status text not null default 'active' check (status in ('active', 'revoked')),
  created_at timestamptz not null default statement_timestamp(),
  rotated_at timestamptz,
  constraint refund_nayax_provider_callers_id_check
    check (caller_id = 'nayax-card-refund')
);

alter table public.refund_nayax_provider_callers enable row level security;
revoke all on table public.refund_nayax_provider_callers
  from public, anon, authenticated, service_role;

alter table public.refund_case_nayax_refund_attempts
  add column if not exists official_action_authorization_id uuid
    references public.refund_case_official_action_authorizations (id) on delete restrict,
  add column if not exists step_up_intent_id uuid
    references public.refund_manager_action_step_up_intents (id) on delete restrict,
  add column if not exists request_fingerprint text,
  add column if not exists currency_code text not null default 'USD',
  add column if not exists provider_claim_digest text,
  add column if not exists provider_claim_expires_at timestamptz,
  add column if not exists provider_claim_consumed_at timestamptz,
  add column if not exists provider_outcome text,
  add column if not exists provider_outcome_recorded_at timestamptz,
  add column if not exists reconciliation_required boolean not null default false,
  add column if not exists reporting_adjustment_id uuid
    references public.sales_adjustment_facts (id) on delete restrict,
  add column if not exists case_finalization_committed_at timestamptz,
  add column if not exists completion_message_id uuid
    references public.refund_case_messages (id) on delete restrict,
  add column if not exists completion_gmail_thread_id uuid
    references public.refund_gmail_threads (id) on delete restrict,
  add column if not exists completion_delivery_status text not null default 'not_claimed',
  add column if not exists completion_manager_cc_count integer not null default 0,
  add column if not exists completed_at timestamptz;

alter table public.refund_case_nayax_refund_attempts
  drop constraint if exists refund_nayax_attempt_authorization_unique,
  add constraint refund_nayax_attempt_authorization_unique
    unique (official_action_authorization_id),
  drop constraint if exists refund_nayax_attempt_request_fingerprint_check,
  add constraint refund_nayax_attempt_request_fingerprint_check check (
    request_fingerprint is null or request_fingerprint ~ '^[a-f0-9]{64}$'
  ),
  drop constraint if exists refund_nayax_attempt_currency_check,
  add constraint refund_nayax_attempt_currency_check check (currency_code = 'USD'),
  drop constraint if exists refund_nayax_attempt_provider_claim_digest_check,
  add constraint refund_nayax_attempt_provider_claim_digest_check check (
    provider_claim_digest is null or provider_claim_digest ~ '^[a-f0-9]{64}$'
  ),
  drop constraint if exists refund_nayax_attempt_provider_outcome_check,
  add constraint refund_nayax_attempt_provider_outcome_check check (
    provider_outcome is null or provider_outcome in ('success', 'rejected', 'timeout', 'unknown')
  ),
  drop constraint if exists refund_nayax_attempt_completion_delivery_check,
  add constraint refund_nayax_attempt_completion_delivery_check check (
    completion_delivery_status in (
      'not_claimed', 'pending', 'sent', 'failed', 'delivery_unknown'
    )
  ),
  drop constraint if exists refund_nayax_attempt_completion_cc_count_check,
  add constraint refund_nayax_attempt_completion_cc_count_check check (
    completion_manager_cc_count between 0 and 3
  ),
  drop constraint if exists refund_nayax_attempt_bound_lifecycle_check,
  add constraint refund_nayax_attempt_bound_lifecycle_check check (
    official_action_authorization_id is null
    or (
      step_up_intent_id is not null
      and request_fingerprint is not null
      and provider_claim_digest is not null
      and provider_claim_expires_at is not null
      and (
        (provider_outcome is null and provider_outcome_recorded_at is null)
        or (provider_outcome is not null and provider_outcome_recorded_at is not null)
      )
      and (
        provider_outcome = 'success'
        or reporting_adjustment_id is null
      )
      and (
        case_finalization_committed_at is null
        or (
          provider_outcome = 'success'
          and reporting_adjustment_id is not null
          and status = 'succeeded'
        )
      )
    )
  );

create index if not exists refund_nayax_attempt_authorization_idx
  on public.refund_case_nayax_refund_attempts (official_action_authorization_id)
  where official_action_authorization_id is not null;
create index if not exists refund_nayax_attempt_step_up_intent_idx
  on public.refund_case_nayax_refund_attempts (step_up_intent_id)
  where step_up_intent_id is not null;
create index if not exists refund_nayax_attempt_reporting_adjustment_idx
  on public.refund_case_nayax_refund_attempts (reporting_adjustment_id)
  where reporting_adjustment_id is not null;
create index if not exists refund_nayax_attempt_completion_message_idx
  on public.refund_case_nayax_refund_attempts (completion_message_id)
  where completion_message_id is not null;
create index if not exists refund_nayax_attempt_completion_thread_idx
  on public.refund_case_nayax_refund_attempts (completion_gmail_thread_id)
  where completion_gmail_thread_id is not null;
create index if not exists refund_nayax_attempt_reconciliation_idx
  on public.refund_case_nayax_refund_attempts (updated_at, id)
  where reconciliation_required = true;

alter table public.refund_case_messages
  add column if not exists nayax_refund_attempt_id uuid
    references public.refund_case_nayax_refund_attempts (id) on delete restrict;

create unique index if not exists refund_case_messages_nayax_attempt_unique
  on public.refund_case_messages (nayax_refund_attempt_id)
  where nayax_refund_attempt_id is not null;

revoke all on table public.refund_case_nayax_refund_attempts
  from public, anon, authenticated, service_role;

create or replace function public.assert_nayax_provider_executor(
  p_executor_assertion text
)
returns void
language plpgsql
stable
security definer
set search_path = public, extensions
as $$
begin
  if nullif(p_executor_assertion, '') is null
    or not exists (
      select 1
      from public.refund_nayax_provider_callers caller
      where caller.caller_id = 'nayax-card-refund'
        and caller.status = 'active'
        and caller.assertion_digest = encode(
          extensions.digest(convert_to(p_executor_assertion, 'UTF8'), 'sha256'),
          'hex'
        )
    ) then
    raise exception 'Nayax provider executor identity required';
  end if;
end;
$$;

create or replace function public.refund_nayax_attempt_request_fingerprint(
  p_authorization_id uuid,
  p_case_id uuid,
  p_idempotency_key text,
  p_amount_cents integer,
  p_currency_code text,
  p_execution_evidence_hash text
)
returns text
language sql
immutable
set search_path = public, extensions
as $$
  select encode(
    extensions.digest(
      convert_to(
        concat_ws(
          '|',
          'refund_nayax_provider_request_v1',
          p_authorization_id::text,
          p_case_id::text,
          p_idempotency_key,
          p_amount_cents::text,
          p_currency_code,
          p_execution_evidence_hash
        ),
        'UTF8'
      ),
      'sha256'
    ),
    'hex'
  );
$$;

create or replace function public.refund_nayax_attempt_snapshot(
  p_attempt_id uuid,
  p_should_execute boolean default false
)
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  select jsonb_build_object(
    'attemptId', attempt.id,
    'status', case
      when not p_should_execute
        and attempt.status = 'in_progress'
        and attempt.provider_outcome is null
        then 'ambiguous'
      else attempt.status
    end,
    'providerOutcome', case
      when not p_should_execute
        and attempt.status = 'in_progress'
        and attempt.provider_outcome is null
        then 'unknown'
      else attempt.provider_outcome
    end,
    'shouldExecute', p_should_execute,
    'reconciliationRequired',
      attempt.reconciliation_required
      or (
        not p_should_execute
        and attempt.status = 'in_progress'
        and attempt.provider_outcome is null
      ),
    'reportingAdjustmentPresent',
      attempt.reporting_adjustment_id is not null
      and refund_case.reporting_adjustment_id = attempt.reporting_adjustment_id,
    'caseFinalizationCommitted',
      attempt.case_finalization_committed_at is not null
      and refund_case.status = 'completed'
      and refund_case.refund_completed_at is not null
      and refund_case.reporting_adjustment_id = attempt.reporting_adjustment_id
  )
  from public.refund_case_nayax_refund_attempts attempt
  join public.refund_cases refund_case
    on refund_case.id = attempt.refund_case_id
  where attempt.id = p_attempt_id;
$$;

create or replace function public.refund_nayax_attempt_reservation_payload(
  p_attempt_id uuid,
  p_should_execute boolean,
  p_provider_claim_token text default null
)
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  select jsonb_build_object(
    'managerAction', jsonb_build_object(
      'authorizationId', action_authorization.id,
      'caseId', action_authorization.refund_case_id,
      'action', action_authorization.action,
      'targetFunction', intent.target_function,
      'status', action_authorization.status,
      'stepUpIntentId', intent.id,
      'verifiedTotpAt', action_authorization.verified_totp_at
    ),
    'attempt', public.refund_nayax_attempt_snapshot(attempt.id, p_should_execute),
    'providerClaimToken', p_provider_claim_token
  )
  from public.refund_case_nayax_refund_attempts attempt
  join public.refund_case_official_action_authorizations action_authorization
    on action_authorization.id = attempt.official_action_authorization_id
  join public.refund_manager_action_step_up_intents intent
    on intent.id = attempt.step_up_intent_id
  where attempt.id = p_attempt_id;
$$;

create or replace function public.guard_nayax_attempt_completion_message()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if tg_op <> 'DELETE'
    and new.message_type in ('approved', 'completed')
    and exists (
      select 1
      from public.refund_cases refund_case
      where refund_case.id = new.refund_case_id
        and refund_case.payment_method = 'card'
    )
    and (
      new.message_type <> 'completed'
      or new.nayax_refund_attempt_id is null
      or not exists (
        select 1
        from public.refund_case_nayax_refund_attempts attempt
        join public.refund_cases refund_case
          on refund_case.id = attempt.refund_case_id
        where attempt.id = new.nayax_refund_attempt_id
          and attempt.refund_case_id = new.refund_case_id
          and attempt.status = 'succeeded'
          and attempt.provider_outcome = 'success'
          and attempt.reconciliation_required = false
          and attempt.reporting_adjustment_id is not null
          and attempt.case_finalization_committed_at is not null
          and refund_case.status = 'completed'
          and refund_case.reporting_adjustment_id = attempt.reporting_adjustment_id
      )
    ) then
    raise exception 'Card success messages require committed token-bound provider settlement';
  end if;

  if current_user in ('anon', 'authenticated', 'service_role')
    and (
      (tg_op <> 'INSERT' and old.nayax_refund_attempt_id is not null)
      or (tg_op <> 'DELETE' and new.nayax_refund_attempt_id is not null)
    ) then
    raise exception 'Nayax completion messages are orchestration-wrapper owned';
  end if;
  return case when tg_op = 'DELETE' then old else new end;
end;
$$;

drop trigger if exists refund_case_messages_nayax_attempt_guard
  on public.refund_case_messages;
create trigger refund_case_messages_nayax_attempt_guard
before insert or update or delete on public.refund_case_messages
for each row execute function public.guard_nayax_attempt_completion_message();

create or replace function public.guard_refund_case_active_nayax_attempt()
returns trigger
language plpgsql
set search_path = public
as $$
declare
  settlement_attempt_id uuid;
begin
  if new.payment_method = 'card'
    and new.status = 'completed'
    and old.status is distinct from 'completed' then
    settlement_attempt_id := nullif(
      current_setting('bloomjoy.nayax_settlement_attempt_id', true),
      ''
    )::uuid;
    if settlement_attempt_id is null
      or old.nayax_refund_execution_status is distinct from 'requested'
      or not exists (
        select 1
        from public.refund_case_nayax_refund_attempts attempt
        join public.refund_case_official_action_authorizations action_authorization
          on action_authorization.id = attempt.official_action_authorization_id
        join public.refund_manager_action_step_up_intents intent
          on intent.id = attempt.step_up_intent_id
        where attempt.id = settlement_attempt_id
          and attempt.refund_case_id = old.id
          and attempt.status = 'in_progress'
          and attempt.provider_outcome is null
          and attempt.provider_claim_consumed_at is null
          and action_authorization.status = 'consumed'
          and action_authorization.verified_totp_at is not null
          and intent.status = 'consumed'
          and intent.target_function = 'nayax-card-refund'
          and intent.verified_totp_at = action_authorization.verified_totp_at
      ) then
      raise exception 'Card completion requires token-bound confirmed provider settlement';
    end if;
  end if;

  if old.nayax_refund_execution_status = 'requested'
    and row(
      old.status,
      old.decision,
      old.refund_amount_cents,
      old.manual_refund_reference,
      old.refund_completed_by,
      old.refund_completed_at,
      old.reporting_adjustment_id,
      old.nayax_refund_execution_status
    ) is distinct from row(
      new.status,
      new.decision,
      new.refund_amount_cents,
      new.manual_refund_reference,
      new.refund_completed_by,
      new.refund_completed_at,
      new.reporting_adjustment_id,
      new.nayax_refund_execution_status
    ) then
    settlement_attempt_id := nullif(
      current_setting('bloomjoy.nayax_settlement_attempt_id', true),
      ''
    )::uuid;
    if settlement_attempt_id is null
      or not exists (
        select 1
        from public.refund_case_nayax_refund_attempts attempt
        where attempt.id = settlement_attempt_id
          and attempt.refund_case_id = old.id
          and attempt.status = 'in_progress'
      ) then
      raise exception 'An active Nayax provider attempt must settle before another official mutation';
    end if;
  end if;
  return new;
end;
$$;

drop trigger if exists refund_cases_active_nayax_attempt_guard
  on public.refund_cases;
create trigger refund_cases_active_nayax_attempt_guard
before update on public.refund_cases
for each row execute function public.guard_refund_case_active_nayax_attempt();

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
        and public.can_perform_refund_official_action(p_user_id, refund_case.id)
        and refund_case.payment_method = 'card'
        and refund_case.decision = 'approved'
        and refund_case.status in ('approved', 'card_refund_pending')
        and refund_case.correlation_status = 'matched'
        and refund_case.correlation_source = 'nayax'
        and refund_case.nayax_recommendation_state = 'high_confidence'
        and refund_case.nayax_match_execution_eligible = true
        and refund_case.nayax_refund_execution_status = 'not_requested'
        and refund_case.card_wallet_used = false
        and refund_case.nayax_recommendation_policy_version is not null
        and public.is_review_safe_nayax_transaction_reference(
          refund_case.matched_nayax_transaction_id
        )
        and refund_case.matched_nayax_site_id is not null
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
            and duplicate_case.matched_nayax_transaction_id =
              refund_case.matched_nayax_transaction_id
        )
        and exists (
          select 1
          from public.reporting_machines machine
          where machine.id = refund_case.reporting_machine_id
            and machine.status = 'active'
            and machine.nayax_refunds_enabled = true
            and machine.nayax_machine_id is not null
            and btrim(machine.nayax_machine_id) <> ''
            and (
              machine.nayax_refund_max_amount_cents is null
              or refund_case.refund_amount_cents <= machine.nayax_refund_max_amount_cents
            )
        )
    );
$$;

create or replace function public.service_reserve_and_consume_nayax_refund_attempt(
  p_executor_assertion text,
  p_authorization_id uuid,
  p_case_id uuid,
  p_idempotency_key text,
  p_amount_cents integer,
  p_currency_code text default 'USD'
)
returns jsonb
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  attempt_row public.refund_case_nayax_refund_attempts%rowtype;
  authorization_row public.refund_case_official_action_authorizations%rowtype;
  intent_row public.refund_manager_action_step_up_intents%rowtype;
  case_row public.refund_cases%rowtype;
  authorization_context jsonb;
  request_fingerprint text;
  provider_claim_token text;
  provider_claim_digest text;
begin
  perform public.assert_nayax_provider_executor(p_executor_assertion);

  if p_authorization_id is null or p_case_id is null then
    raise exception 'Exact Nayax authorization and case are required';
  end if;
  if p_idempotency_key !~ '^nayax-refund-[a-f0-9]{64}$' then
    raise exception 'Invalid Nayax idempotency key';
  end if;
  if p_amount_cents is null or p_amount_cents <= 0 then
    raise exception 'Positive Nayax refund amount required';
  end if;
  if upper(btrim(coalesce(p_currency_code, ''))) <> 'USD' then
    raise exception 'Only exact USD Nayax refund context is supported';
  end if;

  -- The idempotency row is consulted before any one-use manager evidence is
  -- touched. A replay can never consume a second authorization.
  select attempt.*
  into attempt_row
  from public.refund_case_nayax_refund_attempts attempt
  where attempt.idempotency_key = p_idempotency_key
  for update;

  if found then
    select action_authorization.*
    into authorization_row
    from public.refund_case_official_action_authorizations action_authorization
    where action_authorization.id = p_authorization_id
    for share;

    if not found then
      raise exception 'Bound Nayax authorization not found';
    end if;

    request_fingerprint := public.refund_nayax_attempt_request_fingerprint(
      p_authorization_id,
      p_case_id,
      p_idempotency_key,
      p_amount_cents,
      'USD',
      authorization_row.nayax_execution_evidence_hash
    );

    if attempt_row.official_action_authorization_id is distinct from p_authorization_id
      or attempt_row.refund_case_id is distinct from p_case_id
      or attempt_row.amount_cents is distinct from p_amount_cents
      or attempt_row.currency_code is distinct from 'USD'
      or attempt_row.request_fingerprint is distinct from request_fingerprint then
      raise exception 'Nayax idempotency key is bound to different immutable context';
    end if;

    return public.refund_nayax_attempt_reservation_payload(
      attempt_row.id,
      false,
      null
    );
  end if;

  -- Lock in the same order as authorization consumption. Different
  -- authorizations for one case serialize on the case row; same-authorization
  -- replays serialize on the authorization row.
  select action_authorization.*
  into authorization_row
  from public.refund_case_official_action_authorizations action_authorization
  where action_authorization.id = p_authorization_id
  for update;

  if not found then
    raise exception 'Official action authorization not found';
  end if;

  select intent.*
  into intent_row
  from public.refund_manager_action_step_up_intents intent
  where intent.id = authorization_row.step_up_intent_id
  for share;

  if not found
    or authorization_row.refund_case_id is distinct from p_case_id
    or authorization_row.action is distinct from 'nayax_execute'
    or authorization_row.status is distinct from 'authorized'
    or authorization_row.consumed_at is not null
    or authorization_row.verified_totp_at is null
    or authorization_row.nayax_execution_evidence_hash is null
    or intent_row.refund_case_id is distinct from p_case_id
    or intent_row.actor_user_id is distinct from authorization_row.actor_user_id
    or intent_row.action is distinct from 'nayax_execute'
    or intent_row.target_function is distinct from 'nayax-card-refund'
    or intent_row.status is distinct from 'consumed'
    or intent_row.verified_totp_at is null
    or intent_row.verified_totp_at is distinct from authorization_row.verified_totp_at
    or intent_row.nayax_execution_evidence_hash is distinct from
      authorization_row.nayax_execution_evidence_hash then
    raise exception 'Fresh exact-factor Nayax manager evidence required';
  end if;

  select refund_case.*
  into case_row
  from public.refund_cases refund_case
  where refund_case.id = p_case_id
  for update;

  if not found then
    raise exception 'Refund case not found';
  end if;

  -- Recheck after both authority and case locks so concurrent callers cannot
  -- consume manager evidence behind one another.
  select attempt.*
  into attempt_row
  from public.refund_case_nayax_refund_attempts attempt
  where attempt.idempotency_key = p_idempotency_key
  for update;

  if found then
    if attempt_row.official_action_authorization_id is distinct from p_authorization_id
      or attempt_row.refund_case_id is distinct from p_case_id
      or attempt_row.amount_cents is distinct from p_amount_cents
      or attempt_row.currency_code is distinct from 'USD' then
      raise exception 'Nayax idempotency key is bound to different immutable context';
    end if;
    return public.refund_nayax_attempt_reservation_payload(
      attempt_row.id,
      false,
      null
    );
  end if;

  authorization_context := public.service_consume_nayax_refund_official_action(
    p_authorization_id,
    p_case_id,
    'card_refund_pending',
    'approved',
    p_amount_cents,
    null
  );

  select action_authorization.*
  into authorization_row
  from public.refund_case_official_action_authorizations action_authorization
  where action_authorization.id = p_authorization_id
  for update;

  if authorization_row.status is distinct from 'consumed'
    or authorization_row.consumed_at is null
    or (authorization_context ->> 'actorUserId')::uuid is distinct from
      authorization_row.actor_user_id
    or (authorization_context ->> 'action') is distinct from 'nayax_execute' then
    raise exception 'Consumed manager evidence was not preserved';
  end if;

  request_fingerprint := public.refund_nayax_attempt_request_fingerprint(
    p_authorization_id,
    p_case_id,
    p_idempotency_key,
    p_amount_cents,
    'USD',
    authorization_row.nayax_execution_evidence_hash
  );
  provider_claim_token := encode(extensions.gen_random_bytes(32), 'hex');
  provider_claim_digest := encode(
    extensions.digest(convert_to(provider_claim_token, 'UTF8'), 'sha256'),
    'hex'
  );

  insert into public.refund_case_nayax_refund_attempts (
    refund_case_id,
    actor_user_id,
    execution_mode,
    status,
    idempotency_key,
    amount_cents,
    transaction_id_present,
    site_id_present,
    machine_auth_time_present,
    sanitized_request,
    sanitized_response,
    official_action_authorization_id,
    step_up_intent_id,
    request_fingerprint,
    currency_code,
    provider_claim_digest,
    provider_claim_expires_at,
    reconciliation_required
  ) values (
    p_case_id,
    authorization_row.actor_user_id,
    'request_and_approve',
    'in_progress',
    p_idempotency_key,
    p_amount_cents,
    case_row.matched_nayax_transaction_id is not null,
    case_row.matched_nayax_site_id is not null,
    case_row.matched_nayax_machine_auth_time is not null,
    jsonb_build_object(
      'request_fingerprint', request_fingerprint,
      'amount_cents', p_amount_cents,
      'currency_code', 'USD',
      'transaction_id_present', case_row.matched_nayax_transaction_id is not null,
      'site_id_present', case_row.matched_nayax_site_id is not null,
      'machine_authorization_time_present',
        case_row.matched_nayax_machine_auth_time is not null,
      'payload_redacted', true
    ),
    '{}'::jsonb,
    p_authorization_id,
    authorization_row.step_up_intent_id,
    request_fingerprint,
    'USD',
    provider_claim_digest,
    statement_timestamp() + interval '15 minutes',
    true
  )
  returning * into attempt_row;

  perform set_config(
    'bloomjoy.nayax_settlement_attempt_id',
    attempt_row.id::text,
    true
  );

  update public.refund_cases
  set
    nayax_refund_execution_status = 'requested',
    nayax_match_execution_eligible = false
  where id = p_case_id;

  insert into public.refund_case_events (
    refund_case_id,
    actor_user_id,
    event_type,
    message,
    metadata
  ) values (
    p_case_id,
    authorization_row.actor_user_id,
    'nayax_provider_attempt_reserved',
    'A manager-authorized Nayax provider attempt was reserved exactly once.',
    jsonb_build_object(
      'attempt_id', attempt_row.id,
      'authorization_id', authorization_row.id,
      'step_up_intent_id', authorization_row.step_up_intent_id,
      'provider_claim_present', true,
      'payload_redacted', true
    )
  );

  return public.refund_nayax_attempt_reservation_payload(
    attempt_row.id,
    true,
    provider_claim_token
  );
end;
$$;

create or replace function public.service_settle_nayax_refund_attempt(
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
  intent_row public.refund_manager_action_step_up_intents%rowtype;
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

  select intent.*
  into intent_row
  from public.refund_manager_action_step_up_intents intent
  where intent.id = authorization_row.step_up_intent_id
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
    or authorization_row.verified_totp_at is null
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
    raise exception 'Consumed manager/TOTP evidence is not valid for settlement';
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

create or replace function public.service_claim_nayax_refund_completion(
  p_executor_assertion text,
  p_attempt_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  attempt_row public.refund_case_nayax_refund_attempts%rowtype;
  case_row public.refund_cases%rowtype;
  thread_row public.refund_gmail_threads%rowtype;
  message_row public.refund_case_messages%rowtype;
  completion_subject text;
  completion_body text;
begin
  perform public.assert_nayax_provider_executor(p_executor_assertion);

  if p_attempt_id is null then
    raise exception 'Nayax provider attempt required';
  end if;

  select attempt.*
  into attempt_row
  from public.refund_case_nayax_refund_attempts attempt
  where attempt.id = p_attempt_id
  for update;

  select refund_case.*
  into case_row
  from public.refund_cases refund_case
  where refund_case.id = attempt_row.refund_case_id
  for share;

  if attempt_row.id is null
    or attempt_row.status is distinct from 'succeeded'
    or attempt_row.provider_outcome is distinct from 'success'
    or attempt_row.reconciliation_required
    or attempt_row.reporting_adjustment_id is null
    or attempt_row.case_finalization_committed_at is null
    or case_row.status is distinct from 'completed'
    or case_row.refund_completed_at is null
    or case_row.reporting_adjustment_id is distinct from
      attempt_row.reporting_adjustment_id then
    raise exception 'Fully committed Nayax success required before customer completion';
  end if;

  select thread.*
  into thread_row
  from public.refund_gmail_threads thread
  where thread.refund_case_id = case_row.id
  order by thread.first_message_at, thread.id
  limit 1
  for update;

  if thread_row.id is null then
    raise exception 'Original Gmail thread required for Nayax completion';
  end if;

  completion_subject :=
    'Your Bloomjoy refund request ' || case_row.public_reference || ' is complete';
  completion_body := concat_ws(
    E'\n\n',
    'Hi there,',
    'Your approved refund request for ' ||
      to_char(case_row.refund_amount_cents::numeric / 100, 'FM$999999990.00') ||
      ' has been completed through our payment provider.',
    'Your bank or card issuer may take a little additional time to show the credit. We are sorry this needed a refund, and we appreciate the chance to make it right.',
    'Reference: ' || case_row.public_reference,
    E'Warmly,\nBloomjoy Sweets'
  );

  if attempt_row.completion_message_id is not null then
    select message.*
    into message_row
    from public.refund_case_messages message
    where message.id = attempt_row.completion_message_id;

    if message_row.id is null
      or message_row.refund_case_id is distinct from case_row.id
      or message_row.nayax_refund_attempt_id is distinct from attempt_row.id
      or attempt_row.completion_gmail_thread_id is distinct from thread_row.id then
      raise exception 'Nayax completion claim evidence changed';
    end if;

    return jsonb_build_object(
      'claimed', false,
      'refundCaseId', case_row.id,
      'refundCaseMessageId', message_row.id,
      'gmailThreadId', thread_row.id,
      'recipientEmail', case_row.customer_email,
      'subject', message_row.subject,
      'body', message_row.body,
      'status', attempt_row.completion_delivery_status,
      'originalThread', true
    );
  end if;

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
    'refund_nayax_completed_v1',
    attempt_row.actor_user_id,
    'deterministic_template',
    'manual',
    'refund_nayax_completion_v1',
    '{}'::text[],
    attempt_row.id
  )
  returning * into message_row;

  update public.refund_case_nayax_refund_attempts
  set
    completion_message_id = message_row.id,
    completion_gmail_thread_id = thread_row.id,
    completion_delivery_status = 'pending'
  where id = attempt_row.id;

  insert into public.refund_case_events (
    refund_case_id,
    actor_user_id,
    event_type,
    message,
    metadata
  ) values (
    case_row.id,
    attempt_row.actor_user_id,
    'nayax_customer_completion_claimed',
    'The post-refund customer reply was bound to the original Gmail thread.',
    jsonb_build_object(
      'attempt_id', attempt_row.id,
      'refund_case_message_id', message_row.id,
      'original_thread', true,
      'manager_completion_notice_sent', false,
      'payload_redacted', true
    )
  );

  return jsonb_build_object(
    'claimed', true,
    'refundCaseId', case_row.id,
    'refundCaseMessageId', message_row.id,
    'gmailThreadId', thread_row.id,
    'recipientEmail', case_row.customer_email,
    'subject', message_row.subject,
    'body', message_row.body,
    'status', 'pending',
    'originalThread', true
  );
end;
$$;

create or replace function public.service_finish_nayax_refund_completion(
  p_executor_assertion text,
  p_attempt_id uuid,
  p_delivery_status text
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  attempt_row public.refund_case_nayax_refund_attempts%rowtype;
  message_row public.refund_case_messages%rowtype;
  case_row public.refund_cases%rowtype;
  outbound_row public.refund_gmail_messages%rowtype;
  normalized_status text := lower(btrim(coalesce(p_delivery_status, '')));
  active_manager_cc_count integer := 0;
  total_active_manager_count integer := 0;
begin
  perform public.assert_nayax_provider_executor(p_executor_assertion);

  if normalized_status not in ('sent', 'failed', 'delivery_unknown') then
    raise exception 'Valid Nayax completion delivery status required';
  end if;

  select attempt.*
  into attempt_row
  from public.refund_case_nayax_refund_attempts attempt
  where attempt.id = p_attempt_id
  for update;

  select refund_case.*
  into case_row
  from public.refund_cases refund_case
  where refund_case.id = attempt_row.refund_case_id
  for share;

  select message.*
  into message_row
  from public.refund_case_messages message
  where message.id = attempt_row.completion_message_id
  for update;

  if attempt_row.id is null
    or attempt_row.status is distinct from 'succeeded'
    or attempt_row.provider_outcome is distinct from 'success'
    or attempt_row.reporting_adjustment_id is null
    or attempt_row.case_finalization_committed_at is null
    or attempt_row.completion_message_id is null
    or attempt_row.completion_gmail_thread_id is null
    or case_row.status is distinct from 'completed'
    or case_row.reporting_adjustment_id is distinct from
      attempt_row.reporting_adjustment_id
    or message_row.id is null
    or message_row.nayax_refund_attempt_id is distinct from attempt_row.id then
    raise exception 'Committed Nayax completion evidence required';
  end if;

  if attempt_row.completion_delivery_status = 'sent'
    and message_row.status = 'sent' then
    return jsonb_build_object(
      'status', 'already_sent',
      'transport', 'gmail_thread',
      'managerCcCount', attempt_row.completion_manager_cc_count,
      'originalThread', true,
      'operationApplied', false,
      'managerCompletionNoticeSent', false
    );
  end if;

  select outbound.*
  into outbound_row
  from public.refund_gmail_messages outbound
  where outbound.operation_key =
      'refund-case-message:' || attempt_row.completion_message_id::text
    and outbound.refund_case_id = attempt_row.refund_case_id
    and outbound.refund_case_message_id = attempt_row.completion_message_id
    and outbound.gmail_thread_id = attempt_row.completion_gmail_thread_id
    and outbound.direction = 'outbound'
    and outbound.message_kind = 'message'
  for update;

  if normalized_status = 'sent' then
    select count(distinct lower(manager.manager_email))::integer
    into total_active_manager_count
    from public.reporting_machine_refund_managers manager
    where manager.reporting_machine_id = case_row.reporting_machine_id
      and manager.status = 'active'
      and manager.revoked_at is null;

    select count(distinct lower(manager.manager_email))::integer
    into active_manager_cc_count
    from public.reporting_machine_refund_managers manager
    where manager.reporting_machine_id = case_row.reporting_machine_id
      and manager.status = 'active'
      and manager.revoked_at is null
      and lower(manager.manager_email) = any(outbound_row.recipient_cc_emails);

    if outbound_row.id is null
      or outbound_row.status is distinct from 'sent'
      or outbound_row.sent_at is null
      or outbound_row.provider_message_id is null
      or outbound_row.delivery_kind is distinct from 'manual'
      or outbound_row.recipient_resolution_status not in (
        'resolved', 'resolved_with_exclusions'
      )
      or outbound_row.recipient_cc_count not between 1 and 3
      or total_active_manager_count not between 1 and 3
      or cardinality(outbound_row.recipient_cc_emails) is distinct from
        outbound_row.recipient_cc_count
      or total_active_manager_count is distinct from outbound_row.recipient_cc_count
      or active_manager_cc_count is distinct from total_active_manager_count
      or active_manager_cc_count is distinct from outbound_row.recipient_cc_count
      or lower(btrim(outbound_row.recipient_email)) is distinct from
        lower(btrim(case_row.customer_email)) then
      raise exception 'Sent Gmail proof with current mapped manager CC is required';
    end if;

    update public.refund_case_messages
    set
      status = 'sent',
      sent_at = coalesce(sent_at, outbound_row.sent_at),
      error_message = null
    where id = message_row.id;

    update public.refund_case_nayax_refund_attempts
    set
      completion_delivery_status = 'sent',
      completion_manager_cc_count = outbound_row.recipient_cc_count
    where id = attempt_row.id;

    insert into public.refund_case_events (
      refund_case_id,
      actor_user_id,
      event_type,
      message,
      metadata
    ) values (
      case_row.id,
      attempt_row.actor_user_id,
      'nayax_customer_completion_sent',
      'The refund completion was sent once in the original Gmail thread with current mapped Machine Managers copied.',
      jsonb_build_object(
        'attempt_id', attempt_row.id,
        'refund_case_message_id', message_row.id,
        'manager_cc_count', outbound_row.recipient_cc_count,
        'original_thread', true,
        'manager_completion_notice_sent', false,
        'payload_redacted', true
      )
    );

    return jsonb_build_object(
      'status', 'sent',
      'transport', 'gmail_thread',
      'managerCcCount', outbound_row.recipient_cc_count,
      'originalThread', true,
      'operationApplied', true,
      'managerCompletionNoticeSent', false
    );
  end if;

  update public.refund_case_messages
  set
    status = case when normalized_status = 'failed' then 'failed' else status end,
    error_message = case
      when normalized_status = 'failed' then 'gmail_completion_failed'
      else 'gmail_completion_delivery_unknown'
    end
  where id = message_row.id;

  update public.refund_case_nayax_refund_attempts
  set completion_delivery_status = normalized_status
  where id = attempt_row.id;

  return jsonb_build_object(
    'status', normalized_status,
    'transport', 'gmail_thread',
    'managerCcCount', 0,
    'originalThread', true,
    'operationApplied', true,
    'managerCompletionNoticeSent', false
  );
end;
$$;

revoke execute on function public.assert_nayax_provider_executor(text)
  from public, anon, authenticated, service_role;
revoke execute on function public.refund_nayax_attempt_request_fingerprint(
  uuid, uuid, text, integer, text, text
) from public, anon, authenticated, service_role;
revoke execute on function public.refund_nayax_attempt_snapshot(uuid, boolean)
  from public, anon, authenticated, service_role;
revoke execute on function public.refund_nayax_attempt_reservation_payload(
  uuid, boolean, text
) from public, anon, authenticated, service_role;
revoke execute on function public.guard_nayax_attempt_completion_message()
  from public, anon, authenticated, service_role;
revoke execute on function public.guard_refund_case_active_nayax_attempt()
  from public, anon, authenticated, service_role;

-- The legacy consumer lacks the scoped executor assertion and would let any
-- service-role workload burn a fresh manager authorization. Only the atomic
-- reservation wrapper may invoke it as the function owner.
revoke execute on function public.service_consume_nayax_refund_official_action(
  uuid, uuid, text, text, integer, uuid
) from public, anon, authenticated, service_role;

revoke execute on function public.service_reserve_and_consume_nayax_refund_attempt(
  text, uuid, uuid, text, integer, text
) from public, anon, authenticated, service_role;
grant execute on function public.service_reserve_and_consume_nayax_refund_attempt(
  text, uuid, uuid, text, integer, text
) to service_role;

revoke execute on function public.service_settle_nayax_refund_attempt(
  text, uuid, uuid, uuid, text, integer, text, text, text, text, text, text
) from public, anon, authenticated, service_role;
grant execute on function public.service_settle_nayax_refund_attempt(
  text, uuid, uuid, uuid, text, integer, text, text, text, text, text, text
) to service_role;

revoke execute on function public.service_claim_nayax_refund_completion(
  text, uuid
) from public, anon, authenticated, service_role;
grant execute on function public.service_claim_nayax_refund_completion(
  text, uuid
) to service_role;

revoke execute on function public.service_finish_nayax_refund_completion(
  text, uuid, text
) from public, anon, authenticated, service_role;
grant execute on function public.service_finish_nayax_refund_completion(
  text, uuid, text
) to service_role;

comment on table public.refund_nayax_provider_callers is
  'Private function-scoped assertion digests. This migration intentionally seeds no production executor.';
comment on function public.service_reserve_and_consume_nayax_refund_attempt(
  text, uuid, uuid, text, integer, text
) is
  'Atomically consumes one exact Machine Manager TOTP authorization and reserves one immutable Nayax attempt. A raw claim is returned only once to the scoped executor and is never browser-visible.';
comment on function public.service_settle_nayax_refund_attempt(
  text, uuid, uuid, uuid, text, integer, text, text, text, text, text, text
) is
  'Consumes one attempt-scoped provider claim. Provider outcome and confirmed-success case/reporting finalization commit atomically; terminal outcomes cannot be rewritten.';
comment on function public.service_claim_nayax_refund_completion(
  text, uuid
) is
  'Claims one database-owned, versioned deterministic completion message only after immutable success, case completion, and reporting evidence, always on the earliest linked Gmail thread.';
comment on function public.service_finish_nayax_refund_completion(
  text, uuid, text
) is
  'Finalizes the one customer completion only with exact Gmail sent evidence and one-to-three current mapped Machine Managers in CC. It never creates a manager-only completion notice.';
