-- #767: audited, payment-support-only resolution for rejected or uncertain
-- Nayax provider outcomes.
--
-- This migration is deliberately default-off. It adds no operator, enables no
-- official action, calls no provider, and sends no customer message while the
-- gate is off. A later
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

alter table public.refund_cases
  add column if not exists nayax_refund_attempt_generation integer not null default 0;

alter table public.refund_cases
  drop constraint if exists refund_cases_nayax_attempt_generation_check,
  add constraint refund_cases_nayax_attempt_generation_check check (
    nayax_refund_attempt_generation between 0 and 1000
  );

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
  evidence_reference_digest text not null check (
    evidence_reference_digest ~ '^[a-f0-9]{64}$'
  ),
  evidence_occurred_at timestamptz,
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
  constraint refund_nayax_resolution_intent_evidence_time_check check (
    (
      resolution_result in (
        'provider_confirmed_success',
        'documented_manual_completion'
      )
      and evidence_occurred_at is not null
    )
    or (
      resolution_result in (
        'provider_confirmed_retry_safe',
        'remain_on_hold'
      )
      and evidence_occurred_at is null
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
  evidence_reference_digest text not null check (
    evidence_reference_digest ~ '^[a-f0-9]{64}$'
  ),
  evidence_occurred_at timestamptz,
  reason_code text not null,
  prior_attempt_status text not null,
  prior_provider_outcome text not null,
  prior_reconciliation_required boolean not null,
  prior_attempt_generation integer not null check (
    prior_attempt_generation between 0 and 1000
  ),
  next_attempt_generation integer not null check (
    next_attempt_generation between 0 and 1000
  ),
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
  ),
  constraint refund_nayax_outcome_resolution_evidence_time_check check (
    (
      resolution_result in (
        'provider_confirmed_success',
        'documented_manual_completion'
      )
      and evidence_occurred_at is not null
    )
    or (
      resolution_result in (
        'provider_confirmed_retry_safe',
        'remain_on_hold'
      )
      and evidence_occurred_at is null
    )
  ),
  constraint refund_nayax_outcome_resolution_generation_check check (
    (
      resolution_result = 'provider_confirmed_retry_safe'
      and next_attempt_generation = prior_attempt_generation + 1
    )
    or (
      resolution_result <> 'provider_confirmed_retry_safe'
      and next_attempt_generation = prior_attempt_generation
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
  add column if not exists support_resolution_recorded_at timestamptz,
  add column if not exists completion_delivery_retry_count integer not null default 0,
  add column if not exists completion_delivery_attempted_at timestamptz;

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

alter table public.refund_case_nayax_refund_attempts
  drop constraint if exists refund_nayax_attempt_completion_retry_count_check,
  add constraint refund_nayax_attempt_completion_retry_count_check check (
    completion_delivery_retry_count between 0 and 1
  );

create or replace function public.mark_refund_nayax_completion_retry_exhausted()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.template_version = 'refund_nayax_completion_v2'
    and new.status = 'failed'
    and new.error_message = 'gmail_completion_failed'
    and exists (
      select 1
      from public.refund_case_nayax_refund_attempts attempt
      where attempt.completion_message_id = new.id
        and attempt.completion_delivery_retry_count = 1
    ) then
    new.error_message := 'gmail_completion_retry_exhausted';
  end if;
  return new;
end;
$$;

drop trigger if exists mark_refund_nayax_completion_retry_exhausted
  on public.refund_case_messages;
create trigger mark_refund_nayax_completion_retry_exhausted
before update of status, error_message on public.refund_case_messages
for each row execute function public.mark_refund_nayax_completion_retry_exhausted();

create unique index if not exists refund_nayax_attempt_support_resolution_idx
  on public.refund_case_nayax_refund_attempts (support_resolution_id)
  where support_resolution_id is not null;

create or replace function public.guard_refund_nayax_attempt_generation()
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
  exact_generation_advance boolean := false;
begin
  if new.nayax_refund_attempt_generation is not distinct from
      old.nayax_refund_attempt_generation then
    return new;
  end if;

  select pg_get_userbyid(database.datdba)
  into database_owner
  from pg_database database
  where database.datname = current_database();

  select pg_get_userbyid(procedure.proowner)
  into resolver_owner
  from pg_proc procedure
  where procedure.oid =
    'public.admin_consume_refund_nayax_resolution_intent(uuid,uuid,uuid,text,text,text,timestamptz,text,text)'::regprocedure;

  if resolution_id is not null then
    select exists (
      select 1
      from public.refund_nayax_outcome_resolutions resolution
      join public.refund_case_nayax_refund_attempts attempt
        on attempt.id = resolution.nayax_refund_attempt_id
      where resolution.id = resolution_id
        and resolution.refund_case_id = old.id
        and resolution.resolution_result = 'provider_confirmed_retry_safe'
        and resolution.prior_attempt_generation =
          old.nayax_refund_attempt_generation
        and resolution.next_attempt_generation =
          new.nayax_refund_attempt_generation
        and attempt.support_resolution_id = resolution.id
        and attempt.support_resolution_result =
          'provider_confirmed_retry_safe'
    ) into exact_generation_advance;
  end if;

  if not exact_generation_advance
    or current_user is distinct from database_owner
    or resolver_owner is distinct from database_owner then
    raise exception 'Nayax attempt generation advances only through one exact retry-safe support resolution';
  end if;

  return new;
end;
$$;

drop trigger if exists refund_cases_guard_nayax_attempt_generation
  on public.refund_cases;
create trigger refund_cases_guard_nayax_attempt_generation
before update of nayax_refund_attempt_generation on public.refund_cases
for each row execute function public.guard_refund_nayax_attempt_generation();

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

create or replace function public.refund_nayax_resolution_reference_is_safe(
  p_reference text,
  p_evidence_type text
)
returns boolean
language sql
immutable
set search_path = public
as $$
  with normalized as (
    select
      btrim(coalesce(p_reference, '')) as reference_value,
      lower(btrim(coalesce(p_evidence_type, ''))) as evidence_type
  )
  select reference_value ~ '^[A-Za-z0-9][A-Za-z0-9._:/-]{7,119}$'
    and reference_value !~ '@'
    and reference_value !~* '[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}'
    and reference_value !~* '(account|bank|card|customer|email|password|passcode|phone|pin|routing|security.?code|cvv|pan)'
    and (
      length(regexp_replace(reference_value, '[^0-9]', '', 'g')) < 8
      or (
        evidence_type = 'nayax_support_ticket'
        and reference_value ~ '^SUPPORT:NAYAX-[0-9]{8}$'
      )
      or (
        evidence_type = 'nayax_dtm_transaction'
        and reference_value ~ '^DTM:NAYAX-[0-9]{9}$'
      )
    )
    and case evidence_type
      when 'nayax_dtm_transaction' then reference_value ~ '^DTM[:/-]'
      when 'nayax_support_ticket' then reference_value ~ '^SUPPORT[:/-]'
      when 'documented_manual_refund' then reference_value ~ '^MANUAL[:/-]'
      else false
    end
  from normalized;
$$;

create or replace function public.refund_nayax_resolution_reference_digest(
  p_reference text
)
returns text
language sql
immutable
strict
set search_path = public, extensions
as $$
  select encode(
    extensions.digest(
      convert_to(
        'bloomjoy-refund-nayax-resolution-reference-v1:' || btrim(p_reference),
        'UTF8'
      ),
      'sha256'
    ),
    'hex'
  );
$$;

-- A support-approved fresh review is a new payment attempt, not a replay of
-- the old uncertain request. Freeze the monotonically increasing generation
-- into the manager's reviewed execution evidence as well as the Edge HMAC.
create or replace function public.refund_nayax_execution_evidence_hash(
  p_case public.refund_cases,
  p_machine public.reporting_machines
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
        'refund_nayax_execution_evidence_v2',
        p_case.id,
        p_case.official_action_version,
        p_case.nayax_refund_attempt_generation,
        p_case.reporting_machine_id,
        p_case.status,
        p_case.decision,
        p_case.payment_method,
        p_case.incident_at,
        p_case.incident_local_datetime,
        p_case.card_last4,
        p_case.payment_amount_cents,
        p_case.refund_amount_cents,
        p_case.card_wallet_used,
        p_case.correlation_status,
        p_case.correlation_source,
        p_case.nayax_recommendation_state,
        p_case.nayax_recommendation_policy_version,
        p_case.nayax_recommendation_evaluated_at,
        p_case.nayax_match_execution_eligible,
        p_case.matched_nayax_transaction_id,
        p_case.matched_nayax_site_id,
        p_case.matched_nayax_machine_auth_time,
        p_case.matched_nayax_amount_cents,
        p_case.matched_nayax_card_last4,
        p_case.matched_nayax_currency_code,
        p_case.reporting_adjustment_id,
        p_case.nayax_refund_execution_status,
        p_machine.id,
        p_machine.status,
        p_machine.nayax_machine_id,
        p_machine.nayax_account_key,
        p_machine.nayax_refunds_enabled,
        p_machine.nayax_refund_max_amount_cents
      )::text,
      'sha256'
    ),
    'hex'
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
        p_case.nayax_refund_attempt_generation,
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
      'public.admin_consume_refund_nayax_resolution_intent(uuid,uuid,uuid,text,text,text,timestamptz,text,text)'::regprocedure;

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
      'public.admin_consume_refund_nayax_resolution_intent(uuid,uuid,uuid,text,text,text,timestamptz,text,text)'::regprocedure;

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
  exact_manager_mapping boolean := false;
  has_active_enrollment boolean := false;
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

  select exists (
    select 1
    from public.reporting_machine_refund_managers manager
    where manager.reporting_machine_id = case_row.reporting_machine_id
      and manager.manager_user_id = current_actor_user_id
      and manager.status = 'active'
      and manager.revoked_at is null
  ) into exact_manager_mapping;

  if not exact_manager_mapping then
    return jsonb_build_object(
      'visible', false,
      'available', false,
      'payloadRedacted', true
    );
  end if;

  select exists (
    select 1
    from public.refund_manager_totp_enrollments enrollment
    where enrollment.actor_user_id = current_actor_user_id
      and enrollment.status = 'active'
      and enrollment.revoked_at is null
  ) into has_active_enrollment;

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
      and has_active_enrollment
      and attempt_row.id is not null
      and public.refund_nayax_provider_outcome_state(
        case_row.nayax_refund_execution_status
      ) in ('unconfirmed', 'rejected')
      and attempt_row.support_resolution_id is null,
    'blockReason', case
      when not public.refund_nayax_outcome_resolution_enabled()
        then 'resolution_disabled'
      when not has_active_enrollment then 'authenticator_required'
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
  p_evidence_occurred_at timestamptz,
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
  reference_digest text;
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
    raise exception 'Authoritative refund action time is required only for a completed payment outcome';
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

  if p_evidence_occurred_at is not null
    and (
      p_evidence_occurred_at < attempt_row.created_at
      or p_evidence_occurred_at > statement_timestamp() + interval '30 seconds'
    ) then
    raise exception 'Authoritative refund action time must be within the reviewed attempt window';
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
  reference_digest := public.refund_nayax_resolution_reference_digest(
    normalized_reference
  );

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
    evidence_reference_digest,
    evidence_occurred_at,
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
    reference_digest,
    p_evidence_occurred_at,
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
  p_evidence_occurred_at timestamptz,
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
  reference_digest text;
  intent_row public.refund_nayax_resolution_intents%rowtype;
  case_row public.refund_cases%rowtype;
  attempt_row public.refund_case_nayax_refund_attempts%rowtype;
  operator_row public.refund_nayax_resolution_operators%rowtype;
  manager_mapping public.reporting_machine_refund_managers%rowtype;
  enrollment_row public.refund_manager_totp_enrollments%rowtype;
  resolution_row public.refund_nayax_outcome_resolutions%rowtype;
  adjustment_row public.sales_adjustment_facts%rowtype;
  completion_thread_row public.refund_gmail_threads%rowtype;
  completion_message_row public.refund_case_messages%rowtype;
  completion_subject text;
  completion_body text;
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

  if not public.refund_nayax_resolution_reference_is_safe(
    normalized_reference,
    normalized_type
  ) then
    raise exception 'A safe authoritative evidence reference is required';
  end if;
  reference_digest := public.refund_nayax_resolution_reference_digest(
    normalized_reference
  );

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
    or intent_row.evidence_reference_digest is distinct from reference_digest
    or intent_row.evidence_occurred_at is distinct from p_evidence_occurred_at
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
    evidence_reference_digest,
    evidence_occurred_at,
    reason_code,
    prior_attempt_status,
    prior_provider_outcome,
    prior_reconciliation_required,
    prior_attempt_generation,
    next_attempt_generation,
    attempt_evidence_hash
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
      manual_refund_reference = 'Support evidence recorded',
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
      raise exception 'Original Gmail thread required before committing a customer-visible refund completion';
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
      raise exception 'Case evidence is not safe to release for a separately reviewed retry';
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
      nayax_refund_attempt_generation =
        resolution_row.next_attempt_generation
    where id = case_row.id;

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
      else 'Authoritative payment evidence committed the refund fact, reporting, and one pending original-thread customer completion atomically.'
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
    'payloadRedacted', true
  );
end;
$$;

create or replace function public.service_prepare_nayax_completion_retry(
  p_executor_assertion text,
  p_refund_case_message_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  message_row public.refund_case_messages%rowtype;
  attempt_row public.refund_case_nayax_refund_attempts%rowtype;
  case_row public.refund_cases%rowtype;
  outbound_row public.refund_gmail_messages%rowtype;
  v_operation_key text;
begin
  perform public.assert_nayax_provider_executor(p_executor_assertion);

  if p_refund_case_message_id is null then
    raise exception 'Exact Nayax completion message required';
  end if;

  select message.*
  into message_row
  from public.refund_case_messages message
  where message.id = p_refund_case_message_id
  for update;

  select attempt.*
  into attempt_row
  from public.refund_case_nayax_refund_attempts attempt
  where attempt.id = message_row.nayax_refund_attempt_id
  for update;

  select refund_case.*
  into case_row
  from public.refund_cases refund_case
  where refund_case.id = message_row.refund_case_id
  for share;

  if message_row.id is null
    or message_row.message_type is distinct from 'completed'
    or message_row.template_version is distinct from 'refund_nayax_completion_v2'
    or message_row.status is distinct from 'failed'
    or attempt_row.id is null
    or attempt_row.refund_case_id is distinct from message_row.refund_case_id
    or attempt_row.completion_message_id is distinct from message_row.id
    or attempt_row.completion_gmail_thread_id is null
    or attempt_row.completion_delivery_status is distinct from 'failed'
    or attempt_row.completion_delivery_retry_count is distinct from 0
    or attempt_row.status is distinct from 'succeeded'
    or attempt_row.provider_outcome is distinct from 'success'
    or attempt_row.reconciliation_required
    or attempt_row.reporting_adjustment_id is null
    or attempt_row.case_finalization_committed_at is null
    or case_row.status is distinct from 'completed'
    or case_row.reporting_adjustment_id is distinct from attempt_row.reporting_adjustment_id
    or lower(btrim(message_row.recipient_email)) is distinct from
      lower(btrim(case_row.customer_email)) then
    raise exception 'One safely failed Nayax completion is required';
  end if;

  v_operation_key := 'refund-case-message:' || message_row.id::text;
  select outbound.*
  into outbound_row
  from public.refund_gmail_messages outbound
  where outbound.operation_key = v_operation_key
  for update;

  if outbound_row.id is not null then
    if outbound_row.status is distinct from 'failed'
      or outbound_row.sent_at is not null
      or outbound_row.provider_message_id is not null then
      raise exception 'Nayax completion delivery requires reconciliation, not retry';
    end if;

    update public.refund_gmail_messages
    set operation_key = v_operation_key || ':failed:1'
    where id = outbound_row.id;
  end if;

  update public.refund_case_messages
  set status = 'pending', error_message = null
  where id = message_row.id;

  update public.refund_case_nayax_refund_attempts
  set
    completion_delivery_status = 'pending',
    completion_delivery_retry_count = 1,
    completion_delivery_attempted_at = statement_timestamp()
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
    'nayax_customer_completion_retry_prepared',
    'One bounded retry was prepared for the same completion message in the original Gmail thread.',
    jsonb_build_object(
      'attempt_id', attempt_row.id,
      'refund_case_message_id', message_row.id,
      'retry_count', 1,
      'original_thread', true,
      'provider_call_made', false,
      'payload_redacted', true
    )
  );

  return jsonb_build_object(
    'prepared', true,
    'refundCaseId', case_row.id,
    'refundCaseMessageId', message_row.id,
    'attemptId', attempt_row.id,
    'gmailThreadId', attempt_row.completion_gmail_thread_id,
    'recipientEmail', case_row.customer_email,
    'subject', message_row.subject,
    'body', message_row.body,
    'retryCount', 1,
    'originalThread', true,
    'payloadRedacted', true
  );
end;
$$;

create or replace function public.service_recover_stale_nayax_completion(
  p_executor_assertion text,
  p_refund_case_message_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  message_row public.refund_case_messages%rowtype;
  attempt_row public.refund_case_nayax_refund_attempts%rowtype;
  case_row public.refund_cases%rowtype;
  outbound_row public.refund_gmail_messages%rowtype;
  recovery_status text;
  recovery_result jsonb;
begin
  perform public.assert_nayax_provider_executor(p_executor_assertion);

  if p_refund_case_message_id is null then
    raise exception 'Exact Nayax completion message required';
  end if;

  select message.*
  into message_row
  from public.refund_case_messages message
  where message.id = p_refund_case_message_id
  for update;

  select attempt.*
  into attempt_row
  from public.refund_case_nayax_refund_attempts attempt
  where attempt.id = message_row.nayax_refund_attempt_id
  for update;

  select refund_case.*
  into case_row
  from public.refund_cases refund_case
  where refund_case.id = message_row.refund_case_id
  for share;

  if message_row.id is null
    or message_row.message_type is distinct from 'completed'
    or message_row.template_version is distinct from 'refund_nayax_completion_v2'
    or message_row.status is distinct from 'pending'
    or attempt_row.id is null
    or attempt_row.refund_case_id is distinct from message_row.refund_case_id
    or attempt_row.completion_message_id is distinct from message_row.id
    or attempt_row.completion_gmail_thread_id is null
    or attempt_row.completion_delivery_status is distinct from 'pending'
    or attempt_row.completion_delivery_retry_count not between 0 and 1
    or attempt_row.status is distinct from 'succeeded'
    or attempt_row.provider_outcome is distinct from 'success'
    or attempt_row.reconciliation_required
    or attempt_row.reporting_adjustment_id is null
    or attempt_row.case_finalization_committed_at is null
    or case_row.status is distinct from 'completed'
    or case_row.reporting_adjustment_id is distinct from attempt_row.reporting_adjustment_id
    or lower(btrim(message_row.recipient_email)) is distinct from
      lower(btrim(case_row.customer_email)) then
    raise exception 'One exact pending Nayax completion is required';
  end if;

  if attempt_row.completion_delivery_attempted_at is null
    or attempt_row.completion_delivery_attempted_at >
      statement_timestamp() - interval '5 minutes' then
    raise exception 'Wait for the bounded completion attempt before recovery';
  end if;

  select outbound.*
  into outbound_row
  from public.refund_gmail_messages outbound
  where outbound.operation_key =
      'refund-case-message:' || message_row.id::text
    and outbound.refund_case_id = case_row.id
    and outbound.refund_case_message_id = message_row.id
    and outbound.gmail_thread_id = attempt_row.completion_gmail_thread_id
    and outbound.direction = 'outbound'
    and outbound.message_kind = 'message'
  for update;

  recovery_status := case
    when outbound_row.id is null then 'failed'
    when outbound_row.status = 'failed'
      and outbound_row.sent_at is null
      and outbound_row.provider_message_id is null then 'failed'
    when outbound_row.status = 'sent'
      and outbound_row.sent_at is not null
      and outbound_row.provider_message_id is not null then 'sent'
    else 'delivery_unknown'
  end;

  recovery_result := public.service_finish_nayax_refund_completion(
    p_executor_assertion,
    attempt_row.id,
    recovery_status
  );

  insert into public.refund_case_events (
    refund_case_id,
    actor_user_id,
    event_type,
    message,
    metadata
  ) values (
    case_row.id,
    attempt_row.actor_user_id,
    'nayax_customer_completion_interruption_recovered',
    case
      when recovery_status = 'failed'
        then 'An interrupted customer completion was proven not sent and moved to the bounded retry path.'
      when recovery_status = 'sent'
        then 'An interrupted customer completion was reconciled from exact sent Gmail evidence.'
      else 'An interrupted customer completion has possible delivery and requires original-thread reconciliation.'
    end,
    jsonb_build_object(
      'recovery_status', recovery_status,
      'outbound_present', outbound_row.id is not null,
      'retry_count', attempt_row.completion_delivery_retry_count,
      'provider_call_made', false,
      'payload_redacted', true
    )
  );

  return jsonb_build_object(
    'recovered', true,
    'status', recovery_result ->> 'status',
    'transport', 'gmail_thread',
    'originalThread', true,
    'outboundPresent', outbound_row.id is not null,
    'providerCallMade', false,
    'payloadRedacted', true
  );
end;
$$;

revoke execute on function public.refund_nayax_outcome_resolution_enabled()
  from public, anon, authenticated, service_role;
revoke execute on function public.refund_nayax_resolution_operator_is_active(uuid)
  from public, anon, authenticated, service_role;
revoke execute on function public.refund_nayax_resolution_reference_is_safe(
  text, text
) from public, anon, authenticated, service_role;
revoke execute on function public.refund_nayax_resolution_reference_digest(text)
  from public, anon, authenticated, service_role;
revoke execute on function public.refund_nayax_resolution_evidence_hash(
  public.refund_cases, public.refund_case_nayax_refund_attempts
) from public, anon, authenticated, service_role;
revoke execute on function public.refund_nayax_retry_safe_case_is_current(
  public.refund_cases
) from public, anon, authenticated, service_role;
revoke execute on function public.guard_refund_nayax_outcome_resolution_immutable()
  from public, anon, authenticated, service_role;
revoke execute on function public.guard_refund_nayax_attempt_generation()
  from public, anon, authenticated, service_role;
revoke execute on function public.mark_refund_nayax_completion_retry_exhausted()
  from public, anon, authenticated, service_role;

revoke execute on function public.admin_get_refund_nayax_resolution_readiness(uuid)
  from public, anon, authenticated, service_role;
grant execute on function public.admin_get_refund_nayax_resolution_readiness(uuid)
  to authenticated;

revoke execute on function public.admin_prepare_refund_nayax_resolution_intent(
  uuid, uuid, text, text, text, timestamptz, text, bigint
) from public, anon, authenticated, service_role;
grant execute on function public.admin_prepare_refund_nayax_resolution_intent(
  uuid, uuid, text, text, text, timestamptz, text, bigint
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

revoke execute on function public.service_prepare_nayax_completion_retry(
  text, uuid
) from public, anon, authenticated, service_role;
grant execute on function public.service_prepare_nayax_completion_retry(
  text, uuid
) to service_role;

revoke execute on function public.service_recover_stale_nayax_completion(
  text, uuid
) from public, anon, authenticated, service_role;
grant execute on function public.service_recover_stale_nayax_completion(
  text, uuid
) to service_role;

revoke execute on function public.admin_consume_refund_nayax_resolution_intent(
  uuid, uuid, uuid, text, text, text, timestamptz, text, text
) from public, anon, authenticated, service_role;
grant execute on function public.admin_consume_refund_nayax_resolution_intent(
  uuid, uuid, uuid, text, text, text, timestamptz, text, text
) to authenticated;

comment on table public.refund_nayax_resolution_operators is
  'Owner-controlled exact payment-support capability. No row is seeded and no authenticated/service setter exists.';
comment on table public.refund_nayax_resolution_intents is
  'Two-minute one-use resolution intents bound to an exact provider-held attempt, digest-only evidence reference, authoritative payment action time when applicable, current manager mapping, owner-approved TOTP enrollment, and payment-support capability version.';
comment on table public.refund_nayax_outcome_resolutions is
  'Immutable redacted payment-support resolution audit. Stores only an evidence-reference digest and authoritative action time; never stores the raw reference, vendor content, customer copy, secrets, codes, or payment payloads.';
comment on function public.admin_consume_refund_nayax_resolution_intent(
  uuid, uuid, uuid, text, text, text, timestamptz, text, text
) is
  'Consumes one exact fresh-TOTP payment-support intent. It never calls Nayax; success/manual facts use the authoritative UTC action time and atomically commit case/reporting plus one pending original-thread completion, while retry-safe increments the attempt generation before returning the case to fresh review.';

comment on column public.refund_cases.nayax_refund_attempt_generation is
  'Monotonic generation included in the Nayax manager evidence hash and HMAC idempotency key. It advances only after an authoritative retry-safe support resolution.';

comment on function public.service_prepare_nayax_completion_retry(text, uuid) is
  'Reopens the exact safely failed Nayax completion message for one bounded original-thread retry. It refuses sent, uncertain, mismatched, or already-retried evidence and never calls the payment provider.';
comment on function public.service_recover_stale_nayax_completion(text, uuid) is
  'Classifies one stale pending Nayax completion without sending: no outbound or a proven safe failure enters the bounded retry path, sent evidence finalizes once, and every possibly delivered claim becomes reconciliation-only.';

select pg_notify('pgrst', 'reload schema');
