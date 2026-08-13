-- #767: audited, payment-support-only resolution for rejected or uncertain
-- Nayax provider outcomes.
--
-- This migration is deliberately default-off. It adds no operator, enables no
-- official action, calls no provider, and sends no customer message. A later
-- owner-reviewed activation must replace the immutable false gate and seed an
-- exact payment-support operator only after the Nayax reconciliation contract
-- and capped production proof are approved.

create or replace function public.refund_nayax_outcome_resolution_enabled()
returns boolean
language sql
immutable
set search_path = public
as $$
  select false;
$$;

create table if not exists public.refund_nayax_resolution_operators (
  actor_user_id uuid primary key references auth.users (id) on delete restrict,
  capability text not null default 'payment_support_resolution'
    check (capability = 'payment_support_resolution'),
  status text not null default 'active' check (status in ('active', 'revoked')),
  operator_version bigint not null default 1 check (operator_version > 0),
  approved_by_owner_user_id uuid not null references auth.users (id) on delete restrict,
  approved_at timestamptz not null default statement_timestamp(),
  revoked_at timestamptz,
  updated_at timestamptz not null default statement_timestamp(),
  constraint refund_nayax_resolution_operator_lifecycle_check check (
    (status = 'active' and revoked_at is null)
    or (status = 'revoked' and revoked_at is not null)
  )
);

alter table public.refund_nayax_resolution_operators enable row level security;
revoke all on table public.refund_nayax_resolution_operators
  from public, anon, authenticated, service_role;

create table if not exists public.refund_nayax_resolution_intents (
  id uuid primary key default gen_random_uuid(),
  actor_user_id uuid not null references auth.users (id) on delete restrict,
  refund_case_id uuid not null references public.refund_cases (id) on delete restrict,
  nayax_refund_attempt_id uuid not null
    references public.refund_case_nayax_refund_attempts (id) on delete restrict,
  manager_mapping_id uuid not null
    references public.reporting_machine_refund_managers (id) on delete restrict,
  manager_mapping_version bigint not null check (manager_mapping_version > 0),
  manager_totp_enrollment_version bigint not null check (
    manager_totp_enrollment_version > 0
  ),
  operator_version bigint not null check (operator_version > 0),
  expected_case_version bigint not null check (expected_case_version > 0),
  resolution_result text not null check (
    resolution_result in (
      'provider_confirmed_success',
      'provider_confirmed_retry_safe',
      'documented_manual_completion',
      'remain_on_hold'
    )
  ),
  evidence_type text not null check (
    evidence_type in (
      'nayax_dtm_transaction',
      'nayax_support_ticket',
      'documented_manual_refund'
    )
  ),
  evidence_reference text not null check (
    length(evidence_reference) between 8 and 120
    and evidence_reference ~ '^[A-Za-z0-9][A-Za-z0-9._:/-]{7,119}$'
  ),
  reason_code text not null check (
    reason_code in (
      'nayax_dtm_settled',
      'nayax_support_confirmed_success',
      'nayax_dtm_not_refunded',
      'nayax_support_retry_safe',
      'manual_nayax_completion',
      'evidence_incomplete',
      'provider_still_pending',
      'evidence_conflict'
    )
  ),
  attempt_evidence_hash text not null check (attempt_evidence_hash ~ '^[a-f0-9]{64}$'),
  status text not null default 'pending' check (
    status in ('pending', 'consumed', 'cancelled', 'superseded', 'expired')
  ),
  not_before timestamptz not null default statement_timestamp(),
  expires_at timestamptz not null default (statement_timestamp() + interval '2 minutes'),
  factor_verified_at timestamptz,
  factor_verification_proof_hash text check (
    factor_verification_proof_hash is null
    or factor_verification_proof_hash ~ '^[a-f0-9]{64}$'
  ),
  verified_totp_at timestamptz,
  consumed_at timestamptz,
  cancelled_at timestamptz,
  created_at timestamptz not null default statement_timestamp(),
  constraint refund_nayax_resolution_intent_result_shape_check check (
    (
      resolution_result = 'provider_confirmed_success'
      and (
        (evidence_type = 'nayax_dtm_transaction' and reason_code = 'nayax_dtm_settled')
        or (
          evidence_type = 'nayax_support_ticket'
          and reason_code = 'nayax_support_confirmed_success'
        )
      )
    )
    or (
      resolution_result = 'provider_confirmed_retry_safe'
      and (
        (evidence_type = 'nayax_dtm_transaction' and reason_code = 'nayax_dtm_not_refunded')
        or (
          evidence_type = 'nayax_support_ticket'
          and reason_code = 'nayax_support_retry_safe'
        )
      )
    )
    or (
      resolution_result = 'documented_manual_completion'
      and evidence_type = 'documented_manual_refund'
      and reason_code = 'manual_nayax_completion'
    )
    or (
      resolution_result = 'remain_on_hold'
      and reason_code in ('evidence_incomplete', 'provider_still_pending', 'evidence_conflict')
    )
  ),
  constraint refund_nayax_resolution_intent_expiry_check check (
    expires_at > not_before
    and expires_at <= not_before + interval '2 minutes 5 seconds'
  ),
  constraint refund_nayax_resolution_intent_factor_check check (
    (factor_verified_at is null and factor_verification_proof_hash is null)
    or (
      factor_verified_at is not null
      and factor_verified_at >= not_before
      and factor_verified_at <= expires_at
      and (factor_verification_proof_hash is null or status = 'pending')
    )
  ),
  constraint refund_nayax_resolution_intent_lifecycle_check check (
    (
      status = 'pending'
      and verified_totp_at is null
      and consumed_at is null
      and cancelled_at is null
    )
    or (
      status = 'consumed'
      and verified_totp_at is not null
      and consumed_at is not null
      and cancelled_at is null
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
  )
);

create unique index if not exists refund_nayax_resolution_one_live_actor_idx
  on public.refund_nayax_resolution_intents (actor_user_id)
  where status = 'pending';
create unique index if not exists refund_nayax_resolution_one_use_totp_idx
  on public.refund_nayax_resolution_intents (actor_user_id, verified_totp_at)
  where status = 'consumed' and verified_totp_at is not null;
create index if not exists refund_nayax_resolution_intent_case_idx
  on public.refund_nayax_resolution_intents (refund_case_id, created_at desc);
create index if not exists refund_nayax_resolution_intent_attempt_idx
  on public.refund_nayax_resolution_intents (nayax_refund_attempt_id, created_at desc);
create index if not exists refund_nayax_resolution_intent_expiry_idx
  on public.refund_nayax_resolution_intents (expires_at)
  where status = 'pending';

alter table public.refund_nayax_resolution_intents enable row level security;
revoke all on table public.refund_nayax_resolution_intents
  from public, anon, authenticated, service_role;

create table if not exists public.refund_nayax_outcome_resolutions (
  id uuid primary key default gen_random_uuid(),
  refund_case_id uuid not null references public.refund_cases (id) on delete restrict,
  nayax_refund_attempt_id uuid not null
    references public.refund_case_nayax_refund_attempts (id) on delete restrict,
  resolution_intent_id uuid not null unique
    references public.refund_nayax_resolution_intents (id) on delete restrict,
  actor_user_id uuid not null references auth.users (id) on delete restrict,
  resolution_result text not null check (
    resolution_result in (
      'provider_confirmed_success',
      'provider_confirmed_retry_safe',
      'documented_manual_completion',
      'remain_on_hold'
    )
  ),
  evidence_type text not null check (
    evidence_type in (
      'nayax_dtm_transaction',
      'nayax_support_ticket',
      'documented_manual_refund'
    )
  ),
  evidence_reference text not null check (
    length(evidence_reference) between 8 and 120
    and evidence_reference ~ '^[A-Za-z0-9][A-Za-z0-9._:/-]{7,119}$'
  ),
  reason_code text not null,
  prior_attempt_status text not null,
  prior_provider_outcome text not null,
  prior_reconciliation_required boolean not null,
  attempt_evidence_hash text not null check (attempt_evidence_hash ~ '^[a-f0-9]{64}$'),
  payload_redacted boolean not null default true check (payload_redacted),
  created_at timestamptz not null default statement_timestamp(),
  constraint refund_nayax_outcome_resolution_result_shape_check check (
    (
      resolution_result = 'provider_confirmed_success'
      and (
        (evidence_type = 'nayax_dtm_transaction' and reason_code = 'nayax_dtm_settled')
        or (
          evidence_type = 'nayax_support_ticket'
          and reason_code = 'nayax_support_confirmed_success'
        )
      )
    )
    or (
      resolution_result = 'provider_confirmed_retry_safe'
      and (
        (evidence_type = 'nayax_dtm_transaction' and reason_code = 'nayax_dtm_not_refunded')
        or (
          evidence_type = 'nayax_support_ticket'
          and reason_code = 'nayax_support_retry_safe'
        )
      )
    )
    or (
      resolution_result = 'documented_manual_completion'
      and evidence_type = 'documented_manual_refund'
      and reason_code = 'manual_nayax_completion'
    )
    or (
      resolution_result = 'remain_on_hold'
      and evidence_type in ('nayax_dtm_transaction', 'nayax_support_ticket')
      and reason_code in ('evidence_incomplete', 'provider_still_pending', 'evidence_conflict')
    )
  )
);

create unique index if not exists refund_nayax_resolution_one_terminal_attempt_idx
  on public.refund_nayax_outcome_resolutions (nayax_refund_attempt_id)
  where resolution_result <> 'remain_on_hold';
create index if not exists refund_nayax_resolution_case_created_idx
  on public.refund_nayax_outcome_resolutions (refund_case_id, created_at desc);

alter table public.refund_nayax_outcome_resolutions enable row level security;
revoke all on table public.refund_nayax_outcome_resolutions
  from public, anon, authenticated, service_role;

create or replace function public.guard_refund_nayax_outcome_resolution_immutable()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  raise exception 'Payment-support outcome resolution evidence is immutable';
end;
$$;

drop trigger if exists refund_nayax_outcome_resolution_immutable
  on public.refund_nayax_outcome_resolutions;
create trigger refund_nayax_outcome_resolution_immutable
before update or delete on public.refund_nayax_outcome_resolutions
for each row execute function public.guard_refund_nayax_outcome_resolution_immutable();

alter table public.refund_case_nayax_refund_attempts
  add column if not exists support_resolution_id uuid
    references public.refund_nayax_outcome_resolutions (id) on delete restrict,
  add column if not exists support_resolution_result text,
  add column if not exists support_resolution_recorded_at timestamptz;

alter table public.refund_case_nayax_refund_attempts
  drop constraint if exists refund_nayax_attempt_support_resolution_shape,
  add constraint refund_nayax_attempt_support_resolution_shape check (
    (
      support_resolution_id is null
      and support_resolution_result is null
      and support_resolution_recorded_at is null
    )
    or (
      support_resolution_id is not null
      and support_resolution_result in (
        'provider_confirmed_success',
        'provider_confirmed_retry_safe',
        'documented_manual_completion'
      )
      and support_resolution_recorded_at is not null
    )
  );

create unique index if not exists refund_nayax_attempt_support_resolution_idx
  on public.refund_case_nayax_refund_attempts (support_resolution_id)
  where support_resolution_id is not null;

create or replace function public.refund_nayax_resolution_operator_is_active(
  p_user_id uuid
)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select p_user_id is not null
    and public.user_is_active_refund_manager_only(p_user_id)
    and exists (
      select 1
      from public.refund_nayax_resolution_operators resolution_operator
      where resolution_operator.actor_user_id = p_user_id
        and resolution_operator.capability = 'payment_support_resolution'
        and resolution_operator.status = 'active'
        and resolution_operator.revoked_at is null
    );
$$;

create or replace function public.refund_nayax_resolution_evidence_hash(
  p_case public.refund_cases,
  p_attempt public.refund_case_nayax_refund_attempts
)
returns text
language sql
immutable
strict
set search_path = public
as $$
  select encode(
    extensions.digest(
      jsonb_build_array(
        'refund_nayax_resolution_evidence_v1',
        p_case.id,
        p_case.official_action_version,
        p_case.reporting_machine_id,
        p_case.status,
        p_case.decision,
        p_case.payment_method,
        p_case.refund_amount_cents,
        p_case.reporting_adjustment_id,
        p_case.refund_completed_at,
        p_case.nayax_refund_execution_status,
        p_case.nayax_match_execution_eligible,
        p_case.matched_nayax_transaction_id,
        p_case.matched_nayax_site_id,
        p_case.matched_nayax_machine_auth_time,
        p_case.matched_nayax_amount_cents,
        p_case.matched_nayax_currency_code,
        p_attempt.id,
        p_attempt.refund_case_id,
        p_attempt.status,
        p_attempt.idempotency_key,
        p_attempt.amount_cents,
        p_attempt.currency_code,
        p_attempt.request_fingerprint,
        p_attempt.provider_outcome,
        p_attempt.provider_outcome_recorded_at,
        p_attempt.provider_reference,
        p_attempt.provider_status,
        p_attempt.error_code,
        p_attempt.reconciliation_required,
        p_attempt.reporting_adjustment_id,
        p_attempt.case_finalization_committed_at,
        p_attempt.completion_message_id,
        p_attempt.support_resolution_id
      )::text,
      'sha256'
    ),
    'hex'
  );
$$;

create or replace function public.refund_nayax_retry_safe_case_is_current(
  p_case public.refund_cases
)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select p_case.payment_method = 'card'
    and p_case.status = 'card_refund_pending'
    and p_case.decision = 'approved'
    and p_case.correlation_status = 'matched'
    and p_case.correlation_source = 'nayax'
    and p_case.nayax_recommendation_state = 'high_confidence'
    and p_case.card_wallet_used = false
    and public.is_review_safe_nayax_transaction_reference(
      p_case.matched_nayax_transaction_id
    )
    and p_case.matched_nayax_site_id is not null
    and p_case.matched_nayax_machine_auth_time is not null
    and p_case.matched_nayax_currency_code = 'USD'
    and p_case.refund_amount_cents is not null
    and p_case.refund_amount_cents > 0
    and p_case.refund_amount_cents = p_case.payment_amount_cents
    and p_case.refund_amount_cents = p_case.matched_nayax_amount_cents
    and p_case.reporting_adjustment_id is null
    and p_case.refund_completed_at is null
    and not exists (
      select 1
      from public.refund_cases duplicate_case
      where duplicate_case.id <> p_case.id
        and duplicate_case.matched_nayax_transaction_id =
          p_case.matched_nayax_transaction_id
    )
    and exists (
      select 1
      from public.reporting_machines machine
      where machine.id = p_case.reporting_machine_id
        and machine.status = 'active'
        and machine.nayax_refunds_enabled = true
        and machine.nayax_machine_id is not null
        and btrim(machine.nayax_machine_id) <> ''
        and (
          machine.nayax_refund_max_amount_cents is null
          or p_case.refund_amount_cents <= machine.nayax_refund_max_amount_cents
        )
    );
$$;

create or replace function public.guard_refund_provider_hold_case_update()
returns trigger
language plpgsql
set search_path = public
as $$
declare
  resolution_id uuid := nullif(
    current_setting('bloomjoy.nayax_support_resolution_id', true),
    ''
  )::uuid;
  database_owner text;
  resolver_owner text;
  exact_resolution boolean := false;
begin
  if resolution_id is not null then
    select pg_get_userbyid(database.datdba)
    into database_owner
    from pg_database database
    where database.datname = current_database();

    select pg_get_userbyid(procedure.proowner)
    into resolver_owner
    from pg_proc procedure
    where procedure.oid =
      'public.admin_consume_refund_nayax_resolution_intent(uuid,uuid,uuid,text,text,text,text,text)'::regprocedure;

    select exists (
      select 1
      from public.refund_nayax_outcome_resolutions resolution
      where resolution.id = resolution_id
        and resolution.refund_case_id = old.id
        and resolution.resolution_result in (
          'provider_confirmed_success',
          'provider_confirmed_retry_safe',
          'documented_manual_completion'
        )
    )
    and current_user = database_owner
    and current_user = resolver_owner
    into exact_resolution;
  end if;

  if public.refund_nayax_provider_outcome_state(
      old.nayax_refund_execution_status
    ) in ('unconfirmed', 'rejected')
    and row(
      old.status,
      old.decision,
      old.decision_reason,
      old.decided_by,
      old.decided_at,
      old.refund_amount_cents,
      old.manual_refund_reference,
      old.refund_completed_by,
      old.refund_completed_at,
      old.reporting_adjustment_id
    ) is distinct from row(
      new.status,
      new.decision,
      new.decision_reason,
      new.decided_by,
      new.decided_at,
      new.refund_amount_cents,
      new.manual_refund_reference,
      new.refund_completed_by,
      new.refund_completed_at,
      new.reporting_adjustment_id
    )
    and not exact_resolution
    and (
      lower(btrim(coalesce(old.nayax_refund_execution_status, ''))) <> 'requested'
      or nullif(
        current_setting('bloomjoy.nayax_settlement_attempt_id', true),
        ''
      ) is null
    ) then
    raise exception 'Nayax provider outcome freezes official case decisions for payment support';
  end if;

  return new;
end;
$$;

-- Preserve the existing token-bound provider-settlement guard while allowing
-- only the exact database-owner support resolution to commit an already-known
-- payment fact. A copied GUC, an arbitrary SECURITY DEFINER wrapper, or a hold /
-- retry-safe resolution never satisfies this predicate.
create or replace function public.guard_refund_case_active_nayax_attempt()
returns trigger
language plpgsql
set search_path = public
as $$
declare
  settlement_attempt_id uuid;
  settlement_provider_claim text;
  settlement_provider_claim_digest text;
  resolution_id uuid := nullif(
    current_setting('bloomjoy.nayax_support_resolution_id', true),
    ''
  )::uuid;
  database_owner text;
  resolver_owner text;
  exact_completion_resolution boolean := false;
begin
  if resolution_id is not null then
    select pg_get_userbyid(database.datdba)
    into database_owner
    from pg_database database
    where database.datname = current_database();

    select pg_get_userbyid(procedure.proowner)
    into resolver_owner
    from pg_proc procedure
    where procedure.oid =
      'public.admin_consume_refund_nayax_resolution_intent(uuid,uuid,uuid,text,text,text,text,text)'::regprocedure;

    select exists (
      select 1
      from public.refund_nayax_outcome_resolutions resolution
      where resolution.id = resolution_id
        and resolution.refund_case_id = old.id
        and resolution.resolution_result in (
          'provider_confirmed_success',
          'documented_manual_completion'
        )
    )
    and current_user = database_owner
    and current_user = resolver_owner
    into exact_completion_resolution;
  end if;

  settlement_provider_claim := nullif(
    current_setting('bloomjoy.nayax_settlement_provider_claim', true),
    ''
  );
  settlement_provider_claim_digest := case
    when settlement_provider_claim is null then null
    else encode(
      extensions.digest(
        convert_to(settlement_provider_claim, 'UTF8'),
        'sha256'
      ),
      'hex'
    )
  end;

  if new.payment_method = 'card'
    and new.status = 'completed'
    and old.status is distinct from 'completed'
    and not exact_completion_resolution then
    settlement_attempt_id := nullif(
      current_setting('bloomjoy.nayax_settlement_attempt_id', true),
      ''
    )::uuid;
    if settlement_attempt_id is null
      or settlement_provider_claim_digest is null
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
          and attempt.provider_claim_expires_at > statement_timestamp()
          and attempt.provider_claim_digest = settlement_provider_claim_digest
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
      or settlement_provider_claim_digest is null
      or not exists (
        select 1
        from public.refund_case_nayax_refund_attempts attempt
        where attempt.id = settlement_attempt_id
          and attempt.refund_case_id = old.id
          and attempt.status = 'in_progress'
          and attempt.provider_outcome is null
          and attempt.provider_claim_consumed_at is null
          and attempt.provider_claim_expires_at > statement_timestamp()
          and attempt.provider_claim_digest = settlement_provider_claim_digest
      ) then
      raise exception 'An active Nayax provider attempt must settle before another official mutation';
    end if;
  end if;
  return new;
end;
$$;

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
  operator_row public.refund_nayax_resolution_operators%rowtype;
begin
  if auth.role() is distinct from 'authenticated' or current_actor_user_id is null then
    raise exception 'Authenticated payment-support session required';
  end if;

  select resolution_operator.*
  into operator_row
  from public.refund_nayax_resolution_operators resolution_operator
  where resolution_operator.actor_user_id = current_actor_user_id
    and resolution_operator.status = 'active'
    and resolution_operator.revoked_at is null;

  if not found or not public.refund_nayax_resolution_operator_is_active(current_actor_user_id) then
    return jsonb_build_object(
      'visible', false,
      'available', false,
      'payloadRedacted', true
    );
  end if;

  select refund_case.*
  into case_row
  from public.refund_cases refund_case
  where refund_case.id = p_refund_case_id
    and public.can_manage_refund_case(current_actor_user_id, refund_case.id);

  if not found then
    raise exception 'Refund case not found';
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
      and attempt_row.id is not null
      and public.refund_nayax_provider_outcome_state(
        case_row.nayax_refund_execution_status
      ) in ('unconfirmed', 'rejected')
      and attempt_row.support_resolution_id is null,
    'blockReason', case
      when not public.refund_nayax_outcome_resolution_enabled()
        then 'resolution_disabled'
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
    'payloadRedacted', true
  );
end;
$$;

create or replace function public.admin_prepare_refund_nayax_resolution_intent(
  p_case_id uuid,
  p_attempt_id uuid,
  p_resolution_result text,
  p_evidence_type text,
  p_evidence_reference text,
  p_reason_code text,
  p_expected_case_version bigint
)
returns jsonb
language plpgsql
security definer
set search_path = public, auth
as $$
declare
  current_actor_user_id uuid := auth.uid();
  normalized_result text := lower(btrim(coalesce(p_resolution_result, '')));
  normalized_type text := lower(btrim(coalesce(p_evidence_type, '')));
  normalized_reference text := btrim(coalesce(p_evidence_reference, ''));
  normalized_reason text := lower(btrim(coalesce(p_reason_code, '')));
  case_row public.refund_cases%rowtype;
  attempt_row public.refund_case_nayax_refund_attempts%rowtype;
  manager_mapping public.reporting_machine_refund_managers%rowtype;
  manager_enrollment public.refund_manager_totp_enrollments%rowtype;
  operator_row public.refund_nayax_resolution_operators%rowtype;
  intent_row public.refund_nayax_resolution_intents%rowtype;
  evidence_hash text;
begin
  if auth.role() is distinct from 'authenticated' or current_actor_user_id is null then
    raise exception 'Authenticated payment-support session required';
  end if;
  if not public.refund_nayax_outcome_resolution_enabled() then
    raise exception 'Payment-support outcome resolution is disabled pending contract proof and controlled UAT';
  end if;
  if normalized_reference !~ '^[A-Za-z0-9][A-Za-z0-9._:/-]{7,119}$' then
    raise exception 'A safe authoritative evidence reference is required';
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
      and normalized_reason in ('evidence_incomplete', 'provider_still_pending', 'evidence_conflict')
    )
  ) then
    raise exception 'Resolution result, evidence type, and reason do not form an approved payment-support outcome';
  end if;

  perform pg_advisory_xact_lock(hashtextextended(current_actor_user_id::text, 767));

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
    raise exception 'Provider-held case changed; reload before payment-support resolution';
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
    raise exception 'Exact latest provider-held Nayax attempt is required';
  end if;

  select resolution_operator.*
  into operator_row
  from public.refund_nayax_resolution_operators resolution_operator
  where resolution_operator.actor_user_id = current_actor_user_id
    and resolution_operator.status = 'active'
    and resolution_operator.revoked_at is null
  for share;

  if not found or not public.refund_nayax_resolution_operator_is_active(current_actor_user_id) then
    raise exception 'Separate active payment-support authorization is required';
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
    raise exception 'Current mapped Machine Manager authority is required';
  end if;

  select enrollment.*
  into manager_enrollment
  from public.refund_manager_totp_enrollments enrollment
  where enrollment.actor_user_id = current_actor_user_id
    and enrollment.status = 'active'
    and enrollment.revoked_at is null
  for share;

  if not found then
    raise exception 'Owner-approved refund authenticator enrollment is required';
  end if;

  evidence_hash := public.refund_nayax_resolution_evidence_hash(case_row, attempt_row);

  update public.refund_nayax_resolution_intents existing
  set
    status = case
      when existing.expires_at <= statement_timestamp() then 'expired'
      else 'superseded'
    end,
    factor_verified_at = null,
    factor_verification_proof_hash = null
  where existing.actor_user_id = current_actor_user_id
    and existing.status = 'pending';

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
    evidence_reference,
    reason_code,
    attempt_evidence_hash,
    not_before,
    expires_at
  ) values (
    current_actor_user_id,
    case_row.id,
    attempt_row.id,
    manager_mapping.id,
    manager_mapping.mapping_version,
    manager_enrollment.enrollment_version,
    operator_row.operator_version,
    case_row.official_action_version,
    normalized_result,
    normalized_type,
    normalized_reference,
    normalized_reason,
    evidence_hash,
    statement_timestamp(),
    statement_timestamp() + interval '2 minutes'
  )
  returning * into intent_row;

  insert into public.refund_case_events (
    refund_case_id,
    actor_user_id,
    event_type,
    message,
    metadata
  ) values (
    case_row.id,
    current_actor_user_id,
    'nayax_support_resolution_intent_created',
    'Payment support reviewed an exact provider-held attempt; no outcome changed and no customer message was sent.',
    jsonb_build_object(
      'resolution_intent_id', intent_row.id,
      'nayax_refund_attempt_id', attempt_row.id,
      'resolution_result', normalized_result,
      'evidence_type', normalized_type,
      'evidence_reference_present', true,
      'payload_redacted', true
    )
  );

  return jsonb_build_object(
    'intentId', intent_row.id,
    'action', 'nayax_resolve',
    'targetFunction', 'refund-nayax-outcome-resolve',
    'expiresAt', intent_row.expires_at,
    'payloadRedacted', true
  );
end;
$$;

create or replace function public.admin_get_refund_nayax_resolution_intent(
  p_intent_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = public, auth
as $$
declare
  current_actor_user_id uuid := auth.uid();
  intent_row public.refund_nayax_resolution_intents%rowtype;
begin
  if auth.role() is distinct from 'authenticated' or current_actor_user_id is null then
    raise exception 'Authenticated payment-support session required';
  end if;

  select intent.*
  into intent_row
  from public.refund_nayax_resolution_intents intent
  where intent.id = p_intent_id
    and intent.actor_user_id = current_actor_user_id;

  if not found
    or intent_row.status <> 'pending'
    or intent_row.expires_at <= statement_timestamp() then
    raise exception 'Payment-support verification expired; review the evidence again';
  end if;

  return jsonb_build_object(
    'intentId', intent_row.id,
    'action', 'nayax_resolve',
    'targetFunction', 'refund-nayax-outcome-resolve',
    'expiresAt', intent_row.expires_at
  );
end;
$$;

create or replace function public.admin_cancel_refund_nayax_resolution_intent(
  p_intent_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = public, auth
as $$
declare
  current_actor_user_id uuid := auth.uid();
  intent_row public.refund_nayax_resolution_intents%rowtype;
begin
  if auth.role() is distinct from 'authenticated' or current_actor_user_id is null then
    raise exception 'Authenticated payment-support session required';
  end if;

  perform pg_advisory_xact_lock(hashtextextended(current_actor_user_id::text, 767));

  update public.refund_nayax_resolution_intents intent
  set
    status = 'cancelled',
    cancelled_at = statement_timestamp(),
    factor_verified_at = null,
    factor_verification_proof_hash = null
  where intent.id = p_intent_id
    and intent.actor_user_id = current_actor_user_id
    and intent.status = 'pending'
  returning * into intent_row;

  return jsonb_build_object('cancelled', found);
end;
$$;

create or replace function public.admin_refund_nayax_resolution_factor_is_approved(
  p_intent_id uuid,
  p_factor_binding_hash text
)
returns boolean
language sql
stable
security definer
set search_path = public, auth
as $$
  select auth.role() = 'authenticated'
    and auth.uid() is not null
    and coalesce(p_factor_binding_hash ~ '^[a-f0-9]{64}$', false)
    and public.refund_nayax_resolution_operator_is_active(auth.uid())
    and exists (
      select 1
      from public.refund_nayax_resolution_intents intent
      join public.refund_manager_totp_enrollments enrollment
        on enrollment.actor_user_id = intent.actor_user_id
       and enrollment.enrollment_version = intent.manager_totp_enrollment_version
      where intent.id = p_intent_id
        and intent.actor_user_id = auth.uid()
        and intent.status = 'pending'
        and intent.expires_at > statement_timestamp()
        and enrollment.status = 'active'
        and enrollment.revoked_at is null
        and enrollment.approved_factor_binding_hash = p_factor_binding_hash
    );
$$;

create or replace function public.service_mark_refund_nayax_resolution_factor_verified(
  p_actor_user_id uuid,
  p_intent_id uuid,
  p_factor_binding_hash text
)
returns jsonb
language plpgsql
security definer
set search_path = public, auth
as $$
declare
  intent_row public.refund_nayax_resolution_intents%rowtype;
  enrollment_row public.refund_manager_totp_enrollments%rowtype;
  verification_proof text;
  marked_at timestamptz := statement_timestamp();
begin
  if auth.role() is distinct from 'service_role'
    or p_actor_user_id is null
    or p_intent_id is null
    or not coalesce(p_factor_binding_hash ~ '^[a-f0-9]{64}$', false) then
    raise exception 'Payment-support authenticator marker is not authorized';
  end if;

  perform pg_advisory_xact_lock(hashtextextended(p_actor_user_id::text, 767));

  select intent.*
  into intent_row
  from public.refund_nayax_resolution_intents intent
  where intent.id = p_intent_id
  for update;

  if not found
    or intent_row.actor_user_id is distinct from p_actor_user_id
    or intent_row.status <> 'pending'
    or intent_row.expires_at <= marked_at
    or not public.refund_nayax_resolution_operator_is_active(p_actor_user_id) then
    raise exception 'Payment-support verification request is invalid or expired';
  end if;

  select enrollment.*
  into enrollment_row
  from public.refund_manager_totp_enrollments enrollment
  where enrollment.actor_user_id = p_actor_user_id
    and enrollment.status = 'active'
    and enrollment.revoked_at is null
  for update;

  if not found
    or enrollment_row.enrollment_version is distinct from
      intent_row.manager_totp_enrollment_version
    or enrollment_row.approved_factor_binding_hash is distinct from
      p_factor_binding_hash then
    raise exception 'Owner-approved refund authenticator changed; review with the owner';
  end if;

  verification_proof := encode(extensions.gen_random_bytes(32), 'hex');

  update public.refund_nayax_resolution_intents
  set
    factor_verified_at = marked_at,
    factor_verification_proof_hash = encode(
      extensions.digest(
        convert_to(
          'bloomjoy-refund-nayax-resolution-proof-v1:' || verification_proof,
          'UTF8'
        ),
        'sha256'
      ),
      'hex'
    )
  where id = intent_row.id;

  return jsonb_build_object(
    'factorVerificationProof', verification_proof,
    'expiresAt', intent_row.expires_at
  );
end;
$$;

create or replace function public.admin_consume_refund_nayax_resolution_intent(
  p_intent_id uuid,
  p_case_id uuid,
  p_attempt_id uuid,
  p_resolution_result text,
  p_evidence_type text,
  p_evidence_reference text,
  p_reason_code text,
  p_factor_verification_proof text
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
  intent_row public.refund_nayax_resolution_intents%rowtype;
  case_row public.refund_cases%rowtype;
  attempt_row public.refund_case_nayax_refund_attempts%rowtype;
  operator_row public.refund_nayax_resolution_operators%rowtype;
  manager_mapping public.reporting_machine_refund_managers%rowtype;
  enrollment_row public.refund_manager_totp_enrollments%rowtype;
  resolution_row public.refund_nayax_outcome_resolutions%rowtype;
  adjustment_row public.sales_adjustment_facts%rowtype;
  verified_at_value timestamptz;
  current_evidence_hash text;
  resolved_at timestamptz := statement_timestamp();
  completion_committed boolean := false;
  retry_released boolean := false;
begin
  if auth.role() is distinct from 'authenticated' or current_actor_user_id is null then
    raise exception 'Authenticated payment-support session required';
  end if;
  if not public.refund_nayax_outcome_resolution_enabled() then
    raise exception 'Payment-support outcome resolution is disabled pending contract proof and controlled UAT';
  end if;

  perform pg_advisory_xact_lock(hashtextextended(current_actor_user_id::text, 767));

  select intent.*
  into intent_row
  from public.refund_nayax_resolution_intents intent
  where intent.id = p_intent_id
  for update;

  if not found
    or intent_row.actor_user_id is distinct from current_actor_user_id
    or intent_row.refund_case_id is distinct from p_case_id
    or intent_row.nayax_refund_attempt_id is distinct from p_attempt_id
    or intent_row.status <> 'pending'
    or intent_row.expires_at <= resolved_at
    or intent_row.resolution_result is distinct from normalized_result
    or intent_row.evidence_type is distinct from normalized_type
    or intent_row.evidence_reference is distinct from normalized_reference
    or intent_row.reason_code is distinct from normalized_reason then
    raise exception 'Payment-support verification request is invalid, changed, or already used';
  end if;

  select refund_case.*
  into case_row
  from public.refund_cases refund_case
  where refund_case.id = p_case_id
  for update;

  select attempt.*
  into attempt_row
  from public.refund_case_nayax_refund_attempts attempt
  where attempt.id = p_attempt_id
  for update;

  select resolution_operator.*
  into operator_row
  from public.refund_nayax_resolution_operators resolution_operator
  where resolution_operator.actor_user_id = current_actor_user_id
  for share;

  select manager.*
  into manager_mapping
  from public.reporting_machine_refund_managers manager
  where manager.id = intent_row.manager_mapping_id
  for share;

  select enrollment.*
  into enrollment_row
  from public.refund_manager_totp_enrollments enrollment
  where enrollment.actor_user_id = current_actor_user_id
  for update;

  if case_row.id is null
    or case_row.official_action_version is distinct from intent_row.expected_case_version
    or attempt_row.id is null
    or attempt_row.refund_case_id is distinct from case_row.id
    or attempt_row.provider_outcome not in ('rejected', 'timeout', 'unknown')
    or attempt_row.support_resolution_id is not null
    or operator_row.status is distinct from 'active'
    or operator_row.revoked_at is not null
    or operator_row.operator_version is distinct from intent_row.operator_version
    or not public.refund_nayax_resolution_operator_is_active(current_actor_user_id)
    or manager_mapping.manager_user_id is distinct from current_actor_user_id
    or manager_mapping.reporting_machine_id is distinct from case_row.reporting_machine_id
    or manager_mapping.status is distinct from 'active'
    or manager_mapping.revoked_at is not null
    or manager_mapping.mapping_version is distinct from intent_row.manager_mapping_version
    or enrollment_row.status is distinct from 'active'
    or enrollment_row.revoked_at is not null
    or enrollment_row.enrollment_version is distinct from
      intent_row.manager_totp_enrollment_version then
    raise exception 'Payment-support authority, case, attempt, or authenticator changed';
  end if;

  current_evidence_hash := public.refund_nayax_resolution_evidence_hash(
    case_row,
    attempt_row
  );
  if current_evidence_hash is distinct from intent_row.attempt_evidence_hash then
    raise exception 'Provider-held attempt changed; review authoritative evidence again';
  end if;

  verified_at_value := public.refund_verified_totp_after_intent(intent_row.not_before);
  if verified_at_value is null then
    raise exception 'A new authenticator code entered after reviewing this resolution is required';
  end if;
  if exists (
    select 1
    from public.refund_nayax_resolution_intents used_intent
    where used_intent.actor_user_id = current_actor_user_id
      and used_intent.status = 'consumed'
      and used_intent.verified_totp_at = verified_at_value
  ) or exists (
    select 1
    from public.refund_manager_action_step_up_intents official_intent
    where official_intent.actor_user_id = current_actor_user_id
      and official_intent.status = 'consumed'
      and official_intent.verified_totp_at = verified_at_value
  ) then
    raise exception 'This authenticator verification already authorized another action';
  end if;

  if not coalesce(p_factor_verification_proof ~ '^[a-f0-9]{64}$', false)
    or intent_row.factor_verified_at is null
    or intent_row.factor_verified_at < intent_row.not_before
    or intent_row.factor_verified_at > intent_row.expires_at
    or intent_row.factor_verification_proof_hash is distinct from encode(
      extensions.digest(
        convert_to(
          'bloomjoy-refund-nayax-resolution-proof-v1:' ||
            p_factor_verification_proof,
          'UTF8'
        ),
        'sha256'
      ),
      'hex'
    ) then
    raise exception 'Exact owner-approved authenticator verification proof is required';
  end if;

  insert into public.refund_nayax_outcome_resolutions (
    refund_case_id,
    nayax_refund_attempt_id,
    resolution_intent_id,
    actor_user_id,
    resolution_result,
    evidence_type,
    evidence_reference,
    reason_code,
    prior_attempt_status,
    prior_provider_outcome,
    prior_reconciliation_required,
    attempt_evidence_hash
  ) values (
    case_row.id,
    attempt_row.id,
    intent_row.id,
    current_actor_user_id,
    normalized_result,
    normalized_type,
    normalized_reference,
    normalized_reason,
    attempt_row.status,
    attempt_row.provider_outcome,
    attempt_row.reconciliation_required,
    intent_row.attempt_evidence_hash
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
      manual_refund_reference = normalized_reference,
      refund_completed_by = current_actor_user_id,
      refund_completed_at = resolved_at,
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
      resolved_at::date,
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
      reconciliation_required = false,
      reporting_adjustment_id = adjustment_row.id,
      case_finalization_committed_at = resolved_at,
      completed_at = resolved_at,
      support_resolution_id = resolution_row.id,
      support_resolution_result = normalized_result,
      support_resolution_recorded_at = resolved_at,
      sanitized_response = sanitized_response || jsonb_build_object(
        'support_resolution_result', normalized_result,
        'initial_provider_outcome', resolution_row.prior_provider_outcome,
        'evidence_reference_present', true,
        'payload_redacted', true
      )
    where id = attempt_row.id;

    completion_committed := true;
  elsif normalized_result = 'provider_confirmed_retry_safe' then
    if not public.refund_nayax_retry_safe_case_is_current(case_row) then
      raise exception 'Case evidence is not safe to release for a separately reviewed retry';
    end if;

    update public.refund_cases
    set
      nayax_refund_execution_status = 'not_requested',
      nayax_match_execution_eligible = true
    where id = case_row.id;

    update public.refund_case_nayax_refund_attempts
    set
      reconciliation_required = false,
      support_resolution_id = resolution_row.id,
      support_resolution_result = normalized_result,
      support_resolution_recorded_at = resolved_at
    where id = attempt_row.id;

    retry_released := true;
  end if;

  update public.refund_nayax_resolution_intents
  set
    status = 'consumed',
    factor_verification_proof_hash = null,
    verified_totp_at = verified_at_value,
    consumed_at = resolved_at
  where id = intent_row.id;

  update public.refund_manager_totp_enrollments enrollment
  set
    last_step_up_verified_at = verified_at_value,
    updated_at = resolved_at
  where enrollment.actor_user_id = current_actor_user_id
    and enrollment.enrollment_version = intent_row.manager_totp_enrollment_version
    and enrollment.status = 'active';

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
        then 'Payment support preserved the provider hold; no case outcome, retry, or customer message was created.'
      when normalized_result = 'provider_confirmed_retry_safe'
        then 'Authoritative payment evidence released the hold to fresh review; no provider retry or customer message was created.'
      else 'Authoritative payment evidence committed the refund fact and reporting atomically before any customer completion message.'
    end,
    jsonb_build_object(
      'resolution_id', resolution_row.id,
      'resolution_intent_id', intent_row.id,
      'nayax_refund_attempt_id', attempt_row.id,
      'resolution_result', normalized_result,
      'reason_code', normalized_reason,
      'evidence_type', normalized_type,
      'evidence_reference_present', true,
      'completion_committed', completion_committed,
      'retry_released', retry_released,
      'provider_call_made', false,
      'customer_message_created', false,
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
    'customerMessageCreated', false,
    'payloadRedacted', true
  );
end;
$$;

revoke execute on function public.refund_nayax_outcome_resolution_enabled()
  from public, anon, authenticated, service_role;
revoke execute on function public.refund_nayax_resolution_operator_is_active(uuid)
  from public, anon, authenticated, service_role;
revoke execute on function public.refund_nayax_resolution_evidence_hash(
  public.refund_cases, public.refund_case_nayax_refund_attempts
) from public, anon, authenticated, service_role;
revoke execute on function public.refund_nayax_retry_safe_case_is_current(
  public.refund_cases
) from public, anon, authenticated, service_role;
revoke execute on function public.guard_refund_nayax_outcome_resolution_immutable()
  from public, anon, authenticated, service_role;

revoke execute on function public.admin_get_refund_nayax_resolution_readiness(uuid)
  from public, anon, authenticated, service_role;
grant execute on function public.admin_get_refund_nayax_resolution_readiness(uuid)
  to authenticated;

revoke execute on function public.admin_prepare_refund_nayax_resolution_intent(
  uuid, uuid, text, text, text, text, bigint
) from public, anon, authenticated, service_role;
grant execute on function public.admin_prepare_refund_nayax_resolution_intent(
  uuid, uuid, text, text, text, text, bigint
) to authenticated;

revoke execute on function public.admin_get_refund_nayax_resolution_intent(uuid)
  from public, anon, authenticated, service_role;
grant execute on function public.admin_get_refund_nayax_resolution_intent(uuid)
  to authenticated;

revoke execute on function public.admin_cancel_refund_nayax_resolution_intent(uuid)
  from public, anon, authenticated, service_role;
grant execute on function public.admin_cancel_refund_nayax_resolution_intent(uuid)
  to authenticated;

revoke execute on function public.admin_refund_nayax_resolution_factor_is_approved(
  uuid, text
) from public, anon, authenticated, service_role;
grant execute on function public.admin_refund_nayax_resolution_factor_is_approved(
  uuid, text
) to authenticated;

revoke execute on function public.service_mark_refund_nayax_resolution_factor_verified(
  uuid, uuid, text
) from public, anon, authenticated, service_role;
grant execute on function public.service_mark_refund_nayax_resolution_factor_verified(
  uuid, uuid, text
) to service_role;

revoke execute on function public.admin_consume_refund_nayax_resolution_intent(
  uuid, uuid, uuid, text, text, text, text, text
) from public, anon, authenticated, service_role;
grant execute on function public.admin_consume_refund_nayax_resolution_intent(
  uuid, uuid, uuid, text, text, text, text, text
) to authenticated;

comment on table public.refund_nayax_resolution_operators is
  'Owner-controlled exact payment-support capability. No row is seeded and no authenticated/service setter exists.';
comment on table public.refund_nayax_resolution_intents is
  'Two-minute one-use resolution intents bound to an exact provider-held attempt, immutable evidence reference, current manager mapping, owner-approved TOTP enrollment, and payment-support capability version.';
comment on table public.refund_nayax_outcome_resolutions is
  'Immutable redacted payment-support resolution audit. Evidence references only; never stores vendor content, customer copy, secrets, codes, or payment payloads.';
comment on function public.admin_consume_refund_nayax_resolution_intent(
  uuid, uuid, uuid, text, text, text, text, text
) is
  'Consumes one exact fresh-TOTP payment-support intent. It never calls Nayax or sends email; success/manual facts commit case and reporting before customer completion becomes separately claimable, while retry-safe only returns the case to fresh review.';

select pg_notify('pgrst', 'reload schema');
