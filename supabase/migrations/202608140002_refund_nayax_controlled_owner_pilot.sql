-- #430: one owner-controlled, provider-only Nayax transaction pilot.
--
-- This migration does not enable the global official-action gate, expose a
-- portal action, contact a customer, or arm a transaction. The only live
-- capability is a single owner-created database authorization whose exact
-- manager, case, evidence, amount, machine, contract, and runner assertion are
-- revalidated and consumed atomically before one provider attempt is reserved.

create table if not exists public.refund_nayax_controlled_pilot_authorizations (
  singleton boolean primary key default true check (singleton),
  authorization_id uuid not null unique,
  owner_user_id uuid not null references auth.users (id) on delete restrict,
  refund_case_id uuid not null references public.refund_cases (id) on delete restrict,
  step_up_intent_id uuid not null unique
    references public.refund_manager_action_step_up_intents (id) on delete restrict,
  manager_mapping_id uuid not null
    references public.reporting_machine_refund_managers (id) on delete restrict,
  manager_mapping_version bigint not null check (manager_mapping_version > 0),
  expected_case_version bigint not null check (expected_case_version > 0),
  nayax_execution_evidence_hash text not null
    check (nayax_execution_evidence_hash ~ '^[a-f0-9]{64}$'),
  owner_case_evidence_digest text not null
    check (owner_case_evidence_digest ~ '^[a-f0-9]{64}$'),
  owner_email_digest text not null
    check (owner_email_digest ~ '^[a-f0-9]{64}$'),
  self_case_attestation_digest text not null
    check (self_case_attestation_digest ~ '^[a-f0-9]{64}$'),
  machine_evidence_digest text not null
    check (machine_evidence_digest ~ '^[a-f0-9]{64}$'),
  account_key_digest text not null
    check (account_key_digest ~ '^[a-f0-9]{64}$'),
  runner_assertion_digest text not null
    check (runner_assertion_digest ~ '^[a-f0-9]{64}$'),
  executor_assertion_digest text not null
    check (executor_assertion_digest ~ '^[a-f0-9]{64}$'),
  contract_digest text not null check (contract_digest ~ '^[a-f0-9]{64}$'),
  contract_version text not null
    check (contract_version ~ '^[A-Za-z0-9][A-Za-z0-9._:-]{5,79}$'),
  sponsor_confirmation_digest text not null
    check (sponsor_confirmation_digest ~ '^[a-f0-9]{64}$'),
  dtm_owner_operator_proof_digest text not null
    check (dtm_owner_operator_proof_digest ~ '^[a-f0-9]{64}$'),
  reporting_machine_id uuid not null
    references public.reporting_machines (id) on delete restrict,
  amount_cents integer not null check (amount_cents > 0),
  currency_code text not null default 'USD' check (currency_code = 'USD'),
  status text not null default 'armed'
    check (status in ('armed', 'consumed', 'cancelled')),
  provider_attempt_id uuid unique
    references public.refund_case_nayax_refund_attempts (id) on delete restrict,
  authorized_at timestamptz not null default clock_timestamp(),
  expires_at timestamptz not null,
  consumed_at timestamptz,
  worker_lease_id uuid,
  worker_lease_expires_at timestamptz,
  worker_terminal_at timestamptz,
  worker_terminal_status text check (
    worker_terminal_status is null or worker_terminal_status in (
      'success', 'rejected', 'timeout', 'unknown', 'forced_unknown'
    )
  ),
  cancelled_at timestamptz,
  settled_at timestamptz,
  provider_outcome text
    check (provider_outcome is null or provider_outcome in (
      'success', 'rejected', 'timeout', 'unknown'
    )),
  constraint refund_nayax_controlled_pilot_authorization_state_check check (
    (
      status = 'armed'
      and provider_attempt_id is null
      and consumed_at is null
      and worker_lease_id is null
      and worker_lease_expires_at is null
      and worker_terminal_at is null
      and worker_terminal_status is null
      and cancelled_at is null
      and settled_at is null
      and provider_outcome is null
    ) or (
      status = 'consumed'
      and provider_attempt_id is not null
      and consumed_at is not null
      and worker_lease_id is not null
      and worker_lease_expires_at is not null
      and cancelled_at is null
      and (
        (settled_at is null and worker_terminal_at is null and worker_terminal_status is null)
        or (settled_at is not null and worker_terminal_at is not null
          and worker_terminal_status is not null)
      )
    ) or (
      status = 'cancelled'
      and provider_attempt_id is null
      and consumed_at is null
      and worker_lease_id is null
      and worker_lease_expires_at is null
      and worker_terminal_at is null
      and worker_terminal_status is null
      and cancelled_at is not null
      and settled_at is null
      and provider_outcome is null
    )
  )
);

create or replace function public.guard_refund_nayax_controlled_pilot_binding_immutable()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if row(
    new.authorization_id, new.owner_user_id, new.refund_case_id,
    new.step_up_intent_id, new.manager_mapping_id, new.manager_mapping_version,
    new.owner_case_evidence_digest, new.owner_email_digest,
    new.self_case_attestation_digest, new.machine_evidence_digest,
    new.account_key_digest, new.runner_assertion_digest,
    new.executor_assertion_digest, new.contract_digest, new.contract_version,
    new.sponsor_confirmation_digest, new.dtm_owner_operator_proof_digest,
    new.reporting_machine_id, new.amount_cents, new.currency_code
  ) is distinct from row(
    old.authorization_id, old.owner_user_id, old.refund_case_id,
    old.step_up_intent_id, old.manager_mapping_id, old.manager_mapping_version,
    old.owner_case_evidence_digest, old.owner_email_digest,
    old.self_case_attestation_digest, old.machine_evidence_digest,
    old.account_key_digest, old.runner_assertion_digest,
    old.executor_assertion_digest, old.contract_digest, old.contract_version,
    old.sponsor_confirmation_digest, old.dtm_owner_operator_proof_digest,
    old.reporting_machine_id, old.amount_cents, old.currency_code
  ) then
    raise exception 'Controlled Nayax pilot authorization binding is immutable';
  end if;
  return new;
end;
$$;

drop trigger if exists refund_nayax_controlled_pilot_binding_immutable
  on public.refund_nayax_controlled_pilot_authorizations;
create trigger refund_nayax_controlled_pilot_binding_immutable
before update on public.refund_nayax_controlled_pilot_authorizations
for each row execute function public.guard_refund_nayax_controlled_pilot_binding_immutable();

alter table public.refund_nayax_controlled_pilot_authorizations
  enable row level security;
revoke all on table public.refund_nayax_controlled_pilot_authorizations
  from public, anon, authenticated, service_role;

create table if not exists public.refund_nayax_controlled_pilot_stage_journal (
  id uuid primary key default extensions.gen_random_uuid(),
  pilot_authorization_id uuid not null
    references public.refund_nayax_controlled_pilot_authorizations (authorization_id)
    on delete restrict,
  provider_attempt_id uuid not null
    references public.refund_case_nayax_refund_attempts (id) on delete restrict,
  stage_event text not null check (stage_event in (
    'request_started', 'request_result', 'approve_started', 'approve_result'
  )),
  stage_ordinal smallint generated always as (
    case stage_event
      when 'request_started' then 1
      when 'request_result' then 2
      when 'approve_started' then 3
      when 'approve_result' then 4
    end
  ) stored,
  outcome text check (outcome is null or outcome in (
    'accepted', 'succeeded', 'rejected', 'duplicate',
    'already_refunded', 'pending', 'unknown'
  )),
  http_status integer check (http_status is null or http_status between 100 and 599),
  provider_result text check (
    provider_result is null or provider_result in ('contract_match', 'contract_mismatch')
  ),
  provider_status text check (
    provider_status is null or provider_status in (
      'http_success', 'http_failure', 'transport_timeout', 'transport_network'
    )
  ),
  contract_matched boolean,
  classification_digest text check (
    classification_digest is null or classification_digest ~ '^[a-f0-9]{64}$'
  ),
  failure_type text check (
    failure_type is null or failure_type in ('timeout', 'network')
  ),
  payload_redacted boolean not null default true check (payload_redacted),
  recorded_at timestamptz not null default clock_timestamp(),
  unique (provider_attempt_id, stage_event),
  unique (pilot_authorization_id, stage_ordinal),
  constraint refund_nayax_controlled_pilot_stage_shape_check check (
    (
      stage_event in ('request_started', 'approve_started')
      and outcome is null
      and http_status is null
      and provider_result is null
      and provider_status is null
      and contract_matched is null
      and classification_digest is null
      and failure_type is null
    ) or (
      stage_event in ('request_result', 'approve_result')
      and outcome is not null
      and contract_matched is not null
      and classification_digest is not null
      and (
        (http_status is not null and failure_type is null)
        or (http_status is null and failure_type is not null and outcome = 'unknown')
      )
    )
  )
);

alter table public.refund_nayax_controlled_pilot_stage_journal
  enable row level security;
revoke all on table public.refund_nayax_controlled_pilot_stage_journal
  from public, anon, authenticated, service_role;

create or replace function public.guard_refund_nayax_controlled_pilot_stage_immutable()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  raise exception 'Controlled Nayax pilot stage evidence is immutable';
end;
$$;

drop trigger if exists refund_nayax_controlled_pilot_stage_immutable
  on public.refund_nayax_controlled_pilot_stage_journal;
create trigger refund_nayax_controlled_pilot_stage_immutable
before update or delete on public.refund_nayax_controlled_pilot_stage_journal
for each row execute function public.guard_refund_nayax_controlled_pilot_stage_immutable();

create or replace function public.refund_nayax_controlled_pilot_prearm_evidence_hash(
  p_case public.refund_cases,
  p_machine public.reporting_machines,
  p_desired_amount_cents integer
)
returns text
language sql
immutable
strict
set search_path = public
as $$
  select encode(extensions.digest(jsonb_build_array(
    'refund_nayax_controlled_pilot_prearm_v1',
    p_case.id, p_case.official_action_version, p_case.nayax_refund_attempt_generation,
    p_case.reporting_machine_id, p_case.status, p_case.decision,
    p_case.payment_method, p_case.refund_amount_cents,
    p_case.matched_nayax_transaction_id, p_case.matched_nayax_site_id,
    p_case.matched_nayax_machine_auth_time, p_case.matched_nayax_amount_cents,
    p_case.matched_nayax_currency_code, p_case.nayax_match_execution_eligible,
    p_machine.id, p_machine.status, p_machine.nayax_machine_id,
    p_machine.nayax_account_key, false, null,
    p_desired_amount_cents
  )::text, 'sha256'), 'hex');
$$;

create or replace function public.refund_nayax_controlled_pilot_self_attestation_hash(
  p_case public.refund_cases,
  p_machine public.reporting_machines,
  p_owner_email_digest text,
  p_desired_amount_cents integer
)
returns text
language sql
immutable
strict
set search_path = public
as $$
  select encode(extensions.digest(jsonb_build_array(
    'refund_nayax_controlled_owner_self_attestation_v1',
    p_case.id, p_machine.id, lower(p_owner_email_digest),
    p_desired_amount_cents, p_case.card_last4,
    p_case.matched_nayax_transaction_id, p_case.matched_nayax_site_id,
    p_case.matched_nayax_machine_auth_time,
    public.refund_nayax_controlled_pilot_prearm_evidence_hash(
      p_case, p_machine, p_desired_amount_cents
    )
  )::text, 'sha256'), 'hex');
$$;

-- Financial-audit retention for this provider-write evidence is intentionally
-- unresolved in #430. The rows are held for legal/incident review and there is
-- no automatic purge. A later owner-reviewed migration must replace this hard
-- false boundary only after it records the approved duration and a verified
-- purge/discharge procedure owned by refund_operations_owner.
create or replace function public.refund_nayax_controlled_pilot_audit_retention_approved()
returns boolean
language sql
immutable
set search_path = public
as $$
  select false;
$$;

create or replace function public.owner_authorize_refund_nayax_controlled_pilot(
  p_authorization_id uuid,
  p_owner_user_id uuid,
  p_case_id uuid,
  p_expected_case_version bigint,
  p_amount_cents integer,
  p_owner_case_evidence_digest text,
  p_owner_email_digest text,
  p_self_case_attestation_digest text,
  p_machine_evidence_digest text,
  p_account_key_digest text,
  p_runner_assertion_digest text,
  p_executor_assertion_digest text,
  p_contract_digest text,
  p_contract_version text,
  p_sponsor_confirmation_digest text,
  p_dtm_owner_operator_proof_digest text
)
returns jsonb
language plpgsql
security definer
set search_path = public, auth, extensions
as $$
declare
  authorization_clock timestamptz;
  context jsonb;
  enrollment public.refund_manager_totp_enrollments%rowtype;
  intent public.refund_manager_action_step_up_intents%rowtype;
  machine public.reporting_machines%rowtype;
  refund_case public.refund_cases%rowtype;
  computed_case_evidence_digest text;
  computed_owner_email_digest text;
  computed_customer_email_digest text;
  computed_self_case_attestation_digest text;
  computed_machine_evidence_digest text;
  computed_account_key_digest text;
  caller public.refund_nayax_provider_callers%rowtype;
  normalized_contract_version text := btrim(coalesce(p_contract_version, ''));
begin
  if p_authorization_id is null or p_owner_user_id is null or p_case_id is null
    or p_expected_case_version is null or p_expected_case_version <= 0
    or p_amount_cents is null or p_amount_cents <= 0
    or coalesce(p_owner_case_evidence_digest, '') !~ '^[a-f0-9]{64}$'
    or coalesce(p_owner_email_digest, '') !~ '^[a-f0-9]{64}$'
    or coalesce(p_self_case_attestation_digest, '') !~ '^[a-f0-9]{64}$'
    or coalesce(p_machine_evidence_digest, '') !~ '^[a-f0-9]{64}$'
    or coalesce(p_account_key_digest, '') !~ '^[a-f0-9]{64}$'
    or coalesce(p_runner_assertion_digest, '') !~ '^[a-f0-9]{64}$'
    or coalesce(p_executor_assertion_digest, '') !~ '^[a-f0-9]{64}$'
    or coalesce(p_contract_digest, '') !~ '^[a-f0-9]{64}$'
    or coalesce(p_sponsor_confirmation_digest, '') !~ '^[a-f0-9]{64}$'
    or coalesce(p_dtm_owner_operator_proof_digest, '') !~ '^[a-f0-9]{64}$'
    or normalized_contract_version !~ '^[A-Za-z0-9][A-Za-z0-9._:-]{5,79}$' then
    raise exception 'Exact redacted owner pilot authorization evidence required';
  end if;

  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended('refund-nayax-controlled-owner-pilot', 430)
  );
  authorization_clock := clock_timestamp();

  -- A cancelled tombstone, consumed authorization, or previous pilot row is
  -- permanent. This slice is intentionally capable of one transaction only.
  if exists (select 1 from public.refund_nayax_controlled_pilot_authorizations)
    or exists (select 1 from public.refund_nayax_controlled_pilot_closures) then
    raise exception 'Controlled Nayax pilot authorization was already closed or used';
  end if;
  if exists (
    select 1 from public.refund_case_nayax_refund_attempts attempt
    where attempt.status = 'in_progress' or attempt.reconciliation_required
  ) or exists (
    select 1 from public.refund_nayax_resolution_intents intent_row
    where intent_row.status = 'pending'
  ) then
    raise exception 'Existing Nayax provider work must be reconciled before the controlled pilot';
  end if;
  if public.refund_official_actions_enabled() then
    raise exception 'Global official actions must remain disabled for the controlled pilot';
  end if;
  if not public.refund_nayax_controlled_pilot_audit_retention_approved() then
    raise exception 'Controlled Nayax pilot audit retention approval is required';
  end if;

  select configured_case.* into refund_case
  from public.refund_cases configured_case
  where configured_case.id = p_case_id
  for update;
  select configured_machine.* into machine
  from public.reporting_machines configured_machine
  where configured_machine.id = refund_case.reporting_machine_id
  for update;

  if machine.id is null
    or machine.status is distinct from 'active'
    or machine.nayax_refunds_enabled is distinct from false
    or machine.nayax_refund_max_amount_cents is not null
    or nullif(btrim(machine.nayax_machine_id), '') is null
    or nullif(btrim(machine.nayax_account_key), '') is null then
    raise exception 'Exact one-machine allowlist and amount cap required';
  end if;
  if refund_case.id is null
    or refund_case.status is distinct from 'correlated'
    or refund_case.decision is not null
    or refund_case.payment_method is distinct from 'card'
    or refund_case.correlation_status is distinct from 'matched'
    or refund_case.correlation_source is distinct from 'nayax'
    or refund_case.nayax_recommendation_state is distinct from 'high_confidence'
    or refund_case.nayax_match_execution_eligible is distinct from true
    or refund_case.reporting_adjustment_id is not null
    or refund_case.matched_nayax_transaction_id !~ '^[1-9][0-9]{0,18}$'
    or refund_case.payment_amount_cents is distinct from p_amount_cents
    or refund_case.matched_nayax_amount_cents is distinct from p_amount_cents
    or refund_case.matched_nayax_currency_code is distinct from 'USD' then
    raise exception 'Exact numeric Nayax transaction evidence required';
  end if;

  computed_case_evidence_digest := encode(extensions.digest(convert_to(concat_ws('|',
    refund_case.id::text, machine.id::text, refund_case.official_action_version::text,
    refund_case.refund_amount_cents::text, refund_case.matched_nayax_transaction_id,
    refund_case.matched_nayax_site_id::text,
    refund_case.matched_nayax_machine_auth_time::text,
    public.refund_nayax_controlled_pilot_prearm_evidence_hash(
      refund_case, machine, p_amount_cents
    )
  ), 'UTF8'), 'sha256'), 'hex');
  computed_machine_evidence_digest := encode(extensions.digest(convert_to(concat_ws('|',
    machine.id::text, machine.nayax_machine_id, machine.nayax_account_key,
    p_amount_cents::text
  ), 'UTF8'), 'sha256'), 'hex');
  select encode(extensions.digest(convert_to(lower(btrim(owner_user.email)), 'UTF8'), 'sha256'), 'hex')
  into computed_owner_email_digest
  from auth.users owner_user where owner_user.id = p_owner_user_id;
  computed_customer_email_digest := encode(extensions.digest(convert_to(
    lower(btrim(refund_case.customer_email)), 'UTF8'
  ), 'sha256'), 'hex');
  computed_self_case_attestation_digest :=
    public.refund_nayax_controlled_pilot_self_attestation_hash(
      refund_case, machine, computed_owner_email_digest, p_amount_cents
    );
  computed_account_key_digest := encode(extensions.digest(convert_to(
    upper(regexp_replace(btrim(machine.nayax_account_key), '[^A-Za-z0-9_]', '_', 'g')),
    'UTF8'
  ), 'sha256'), 'hex');
  if computed_case_evidence_digest is distinct from lower(p_owner_case_evidence_digest)
    or computed_owner_email_digest is distinct from lower(p_owner_email_digest)
    or computed_customer_email_digest is distinct from computed_owner_email_digest
    or computed_self_case_attestation_digest is distinct from
      lower(p_self_case_attestation_digest)
    or computed_machine_evidence_digest is distinct from lower(p_machine_evidence_digest)
    or computed_account_key_digest is distinct from lower(p_account_key_digest) then
    raise exception 'Exact self-owned case, machine, and account evidence required';
  end if;

  context := public.refund_validate_official_action_context(
    p_owner_user_id,
    p_case_id,
    'approve',
    p_expected_case_version,
    'card_refund_pending',
    'approved',
    null, 'owner_controlled_nayax_pilot', null,
    p_amount_cents,
    null, null, false, null, null
  );

  select configured.* into caller
  from public.refund_nayax_provider_callers configured
  where configured.caller_id = 'nayax-card-refund'
  for update;
  if caller.caller_id is not null then
    raise exception 'Controlled pilot provider caller was already configured';
  end if;

  select configured_enrollment.* into enrollment
  from public.refund_manager_totp_enrollments configured_enrollment
  where configured_enrollment.actor_user_id = p_owner_user_id
    and configured_enrollment.status = 'active'
    and configured_enrollment.revoked_at is null
  for share;
  if enrollment.actor_user_id is null then
    raise exception 'Owner-approved refund authenticator enrollment is required';
  end if;

  if exists (
    select 1 from public.refund_manager_action_step_up_intents existing
    where existing.actor_user_id = p_owner_user_id
      and existing.status = 'pending'
  ) then
    raise exception 'Another manager verification request is pending';
  end if;

  insert into public.refund_nayax_provider_callers (
    caller_id, assertion_digest, status
  ) values (
    'nayax-card-refund', lower(p_executor_assertion_digest), 'active'
  );
  update public.reporting_machines
  set nayax_refunds_enabled = true,
      nayax_refund_max_amount_cents = p_amount_cents
  where id = machine.id;

  insert into public.refund_manager_action_step_up_intents (
    actor_user_id, refund_case_id, action, target_function,
    manager_mapping_id, manager_mapping_version,
    manager_totp_enrollment_version, expected_case_version,
    action_context_hash, candidate_evidence_hash,
    nayax_execution_evidence_hash, not_before, expires_at
  ) values (
    p_owner_user_id,
    (context ->> 'refundCaseId')::uuid,
    'nayax_execute',
    'nayax-card-refund',
    (context ->> 'mappingId')::uuid,
    (context ->> 'mappingVersion')::bigint,
    enrollment.enrollment_version,
    (context ->> 'expectedCaseVersion')::bigint,
    context ->> 'contextHash',
    null,
    public.refund_nayax_controlled_pilot_prearm_evidence_hash(
      refund_case, machine, p_amount_cents
    ),
    authorization_clock,
    authorization_clock + interval '2 minutes'
  ) returning * into intent;

  insert into public.refund_nayax_controlled_pilot_authorizations (
    singleton, authorization_id, owner_user_id, refund_case_id,
    step_up_intent_id, manager_mapping_id, manager_mapping_version,
    expected_case_version, nayax_execution_evidence_hash,
    owner_case_evidence_digest, owner_email_digest,
    self_case_attestation_digest, machine_evidence_digest, account_key_digest,
    runner_assertion_digest,
    executor_assertion_digest,
    contract_digest, contract_version, sponsor_confirmation_digest,
    dtm_owner_operator_proof_digest, reporting_machine_id, amount_cents,
    status, authorized_at, expires_at
  ) values (
    true, p_authorization_id, p_owner_user_id, p_case_id,
    intent.id, intent.manager_mapping_id, intent.manager_mapping_version,
    intent.expected_case_version, intent.nayax_execution_evidence_hash,
    lower(p_owner_case_evidence_digest), lower(p_owner_email_digest),
    lower(p_self_case_attestation_digest), lower(p_machine_evidence_digest),
    lower(p_account_key_digest),
    lower(p_runner_assertion_digest),
    lower(p_executor_assertion_digest),
    lower(p_contract_digest), normalized_contract_version,
    lower(p_sponsor_confirmation_digest),
    lower(p_dtm_owner_operator_proof_digest), machine.id, p_amount_cents,
    'armed', authorization_clock, authorization_clock + interval '2 minutes'
  );

  insert into public.refund_manager_step_up_audit (
    actor_user_id, refund_case_id, intent_id, action, event_type
  ) values (
    p_owner_user_id, p_case_id, intent.id, 'nayax_execute', 'intent_created'
  );

  return jsonb_build_object(
    'authorized', true,
    'authorizationId', p_authorization_id,
    'intentId', intent.id,
    'expiresAt', authorization_clock + interval '2 minutes',
    'payloadRedacted', true
  );
end;
$$;

-- A separate tombstone has no customer/case foreign keys and exists only to
-- serialize the timeout race where close wins before owner authorization.
create table if not exists public.refund_nayax_controlled_pilot_closures (
  singleton boolean primary key default true check (singleton),
  authorization_id uuid not null unique,
  closed_at timestamptz not null default clock_timestamp()
);
alter table public.refund_nayax_controlled_pilot_closures enable row level security;
revoke all on table public.refund_nayax_controlled_pilot_closures
  from public, anon, authenticated, service_role;

create or replace function public.owner_cancel_refund_nayax_controlled_pilot(
  p_authorization_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  authorization_row public.refund_nayax_controlled_pilot_authorizations%rowtype;
begin
  if p_authorization_id is null then
    raise exception 'Exact controlled pilot authorization required';
  end if;
  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended('refund-nayax-controlled-owner-pilot', 430)
  );
  select * into authorization_row
  from public.refund_nayax_controlled_pilot_authorizations pilot_auth
  where pilot_auth.authorization_id = p_authorization_id
  for update;
  if authorization_row.status = 'consumed'
    and authorization_row.settled_at is null
    and authorization_row.worker_terminal_at is null
    and authorization_row.worker_lease_expires_at > clock_timestamp() then
    return jsonb_build_object(
      'closed', false,
      'status', 'worker_active',
      'providerHold', true,
      'manualReconciliationRequired', true,
      'payloadRedacted', true
    );
  end if;
  if authorization_row.status = 'armed' then
    update public.refund_nayax_controlled_pilot_authorizations
    set status = 'cancelled', cancelled_at = clock_timestamp()
    where authorization_id = p_authorization_id;
    update public.refund_manager_action_step_up_intents
    set status = 'cancelled', cancelled_at = clock_timestamp(),
      factor_verified_at = null, factor_verification_proof_hash = null
    where id = authorization_row.step_up_intent_id and status = 'pending';
    authorization_row.status := 'cancelled';
  elsif authorization_row.status = 'consumed'
    and authorization_row.settled_at is null then
    update public.refund_case_nayax_refund_attempts
    set status = 'ambiguous',
        provider_reference = null,
        provider_status = null,
        error_code = 'controlled_pilot_closed_after_reservation',
        sanitized_response = jsonb_build_object(
          'provider_outcome', 'unknown',
          'provider_reference_present', false,
          'payload_redacted', true
        ),
        provider_claim_consumed_at = clock_timestamp(),
        provider_outcome = 'unknown',
        provider_outcome_recorded_at = clock_timestamp(),
        reconciliation_required = true,
        completed_at = clock_timestamp()
    where id = authorization_row.provider_attempt_id
      and status = 'in_progress' and provider_outcome is null;
    update public.refund_nayax_controlled_pilot_authorizations
    set settled_at = clock_timestamp(), provider_outcome = 'unknown',
        worker_terminal_at = clock_timestamp(),
        worker_terminal_status = 'forced_unknown'
    where authorization_id = p_authorization_id and settled_at is null;
    authorization_row.settled_at := clock_timestamp();
    authorization_row.provider_outcome := 'unknown';
  end if;
  if authorization_row.authorization_id is not null then
    update public.reporting_machines
    set nayax_refunds_enabled = false,
        nayax_refund_max_amount_cents = null
    where id = authorization_row.reporting_machine_id;
    update public.refund_nayax_provider_callers
    set status = 'revoked', rotated_at = clock_timestamp()
    where caller_id = 'nayax-card-refund'
      and assertion_digest = authorization_row.executor_assertion_digest
      and status = 'active';
  end if;
  insert into public.refund_nayax_controlled_pilot_closures (
    singleton, authorization_id
  ) values (true, p_authorization_id)
  on conflict (singleton) do nothing;
  return jsonb_build_object(
    'closed', authorization_row.status is null
      or authorization_row.status = 'cancelled'
      or (authorization_row.status = 'consumed'
        and authorization_row.settled_at is not null),
    'status', coalesce(authorization_row.status, 'cancelled_tombstone'),
    'payloadRedacted', true
  );
end;
$$;

-- Hard-process-loss recovery has no authorization identifier to target. Under
-- the same singleton lock as authorize/cancel, this boundary may close only an
-- expired armed authorization or a consumed attempt whose durable worker lease
-- has expired without a terminal acknowledgement. If a previously
-- started authorize is still waiting on the lock, the durable singleton
-- closure written here makes that authorize reject after it wakes.
create or replace function public.owner_recover_expired_refund_nayax_controlled_pilot()
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  authorization_row public.refund_nayax_controlled_pilot_authorizations%rowtype;
  cancelled_authorization_count integer := 0;
  cancelled_intent_count integer := 0;
  disabled_machine_count integer := 0;
  revoked_caller_count integer := 0;
  consumed_attempt_count integer := 0;
  forced_unknown_attempt_count integer := 0;
  recovery_tombstone_id constant uuid := '00000000-0000-4000-8000-000000000430';
begin
  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended('refund-nayax-controlled-owner-pilot', 430)
  );

  select * into authorization_row
  from public.refund_nayax_controlled_pilot_authorizations pilot_auth
  order by pilot_auth.authorized_at desc
  limit 1
  for update;

  if authorization_row.status = 'consumed'
    and authorization_row.settled_at is null
    and authorization_row.worker_terminal_at is null
    and authorization_row.worker_lease_expires_at > clock_timestamp() then
    raise exception 'Controlled Nayax pilot worker lease is still active';
  end if;
  if authorization_row.status = 'armed'
    and authorization_row.expires_at > clock_timestamp() then
    raise exception 'Active controlled Nayax pilot is not eligible for recovery';
  end if;

  if authorization_row.status = 'armed' then
    update public.refund_nayax_controlled_pilot_authorizations
    set status = 'cancelled', cancelled_at = clock_timestamp()
    where authorization_id = authorization_row.authorization_id
      and status = 'armed';
    get diagnostics cancelled_authorization_count = row_count;

    update public.refund_manager_action_step_up_intents
    set status = 'cancelled', cancelled_at = clock_timestamp(),
        factor_verified_at = null, factor_verification_proof_hash = null
    where id = authorization_row.step_up_intent_id and status = 'pending';
    get diagnostics cancelled_intent_count = row_count;

    update public.reporting_machines
    set nayax_refunds_enabled = false,
        nayax_refund_max_amount_cents = null
    where id = authorization_row.reporting_machine_id
      and (
        nayax_refunds_enabled is distinct from false
        or nayax_refund_max_amount_cents is not null
      );
    get diagnostics disabled_machine_count = row_count;

    update public.refund_nayax_provider_callers
    set status = 'revoked', rotated_at = clock_timestamp()
    where caller_id = 'nayax-card-refund'
      and assertion_digest = authorization_row.executor_assertion_digest
      and status = 'active';
    get diagnostics revoked_caller_count = row_count;
  elsif authorization_row.status = 'consumed'
    and authorization_row.settled_at is null then
    update public.refund_case_nayax_refund_attempts
    set status = 'ambiguous', provider_reference = null, provider_status = null,
        error_code = 'controlled_pilot_worker_lost',
        sanitized_response = jsonb_build_object(
          'provider_outcome', 'unknown',
          'provider_reference_present', false,
          'payload_redacted', true
        ),
        provider_claim_consumed_at = coalesce(
          provider_claim_consumed_at, clock_timestamp()
        ),
        provider_outcome = 'unknown',
        provider_outcome_recorded_at = clock_timestamp(),
        reconciliation_required = true,
        completed_at = clock_timestamp()
    where id = authorization_row.provider_attempt_id
      and status = 'in_progress' and provider_outcome is null;
    get diagnostics forced_unknown_attempt_count = row_count;
    if forced_unknown_attempt_count <> 1 then
      raise exception 'Exact consumed controlled Nayax pilot attempt required';
    end if;

    update public.refund_nayax_controlled_pilot_authorizations
    set settled_at = clock_timestamp(), provider_outcome = 'unknown',
        worker_terminal_at = clock_timestamp(),
        worker_terminal_status = 'forced_unknown'
    where authorization_id = authorization_row.authorization_id
      and settled_at is null;
    update public.reporting_machines
    set nayax_refunds_enabled = false,
        nayax_refund_max_amount_cents = null
    where id = authorization_row.reporting_machine_id;
    get diagnostics disabled_machine_count = row_count;
    update public.refund_nayax_provider_callers
    set status = 'revoked', rotated_at = clock_timestamp()
    where caller_id = 'nayax-card-refund'
      and assertion_digest = authorization_row.executor_assertion_digest
      and status = 'active';
    get diagnostics revoked_caller_count = row_count;
  end if;

  -- This is a one-lifetime lane. Recovery must report durable historical
  -- consumption, not only an attempt force-closed by this invocation. A
  -- repeated recovery after a settled success, rejection, or prior forced
  -- unknown can therefore never be mistaken for a proven-zero cancellation.
  consumed_attempt_count := case
    when authorization_row.status = 'consumed' then 1
    else 0
  end;

  insert into public.refund_nayax_controlled_pilot_closures (
    singleton, authorization_id
  ) values (
    true, coalesce(authorization_row.authorization_id, recovery_tombstone_id)
  )
  on conflict (singleton) do nothing;

  return jsonb_build_object(
    'closed', true,
    'cancelledAuthorizationCount', cancelled_authorization_count,
    'cancelledIntentCount', cancelled_intent_count,
    'disabledMachineCount', disabled_machine_count,
    'revokedCallerCount', revoked_caller_count,
    'consumedAttemptCount', consumed_attempt_count,
    'providerCallCountStatus', case
      when consumed_attempt_count = 1 then 'unknown'
      else 'proven_zero'
    end,
    'providerHold', consumed_attempt_count = 1,
    'manualReconciliationRequired', consumed_attempt_count = 1,
    'payloadRedacted', true
  );
end;
$$;

-- The Edge pilot reads the case after owner authorization, when the one exact
-- machine is intentionally armed. This service-only boundary binds that
-- post-arm machine/cap state back to the still-armed authorization before the
-- owner is asked for a fresh TOTP. The broad refund path remains unchanged.
create or replace function public.service_validate_nayax_controlled_pilot_postarm(
  p_executor_assertion text,
  p_pilot_authorization_id uuid,
  p_case_id uuid,
  p_amount_cents integer,
  p_runner_assertion_digest text,
  p_contract_digest text
)
returns jsonb
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  pilot public.refund_nayax_controlled_pilot_authorizations%rowtype;
  intent public.refund_manager_action_step_up_intents%rowtype;
  refund_case public.refund_cases%rowtype;
  machine public.reporting_machines%rowtype;
begin
  perform public.assert_nayax_provider_executor(p_executor_assertion);
  if p_pilot_authorization_id is null or p_case_id is null
    or p_amount_cents is null or p_amount_cents <= 0
    or coalesce(p_runner_assertion_digest, '') !~ '^[a-f0-9]{64}$'
    or coalesce(p_contract_digest, '') !~ '^[a-f0-9]{64}$' then
    raise exception 'Exact controlled pilot post-arm evidence required';
  end if;

  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended('refund-nayax-controlled-owner-pilot', 430)
  );
  select * into pilot
  from public.refund_nayax_controlled_pilot_authorizations pilot_auth
  where pilot_auth.authorization_id = p_pilot_authorization_id
  for share;
  if pilot.authorization_id is null
    or pilot.status <> 'armed'
    or pilot.expires_at <= clock_timestamp()
    or pilot.refund_case_id is distinct from p_case_id
    or pilot.amount_cents is distinct from p_amount_cents
    or pilot.runner_assertion_digest is distinct from lower(p_runner_assertion_digest)
    or pilot.contract_digest is distinct from lower(p_contract_digest)
    or pilot.executor_assertion_digest is distinct from encode(
      extensions.digest(convert_to(p_executor_assertion, 'UTF8'), 'sha256'), 'hex'
    )
    or exists (
      select 1 from public.refund_nayax_controlled_pilot_closures closure
      where closure.authorization_id = pilot.authorization_id
    ) then
    raise exception 'Exact active controlled Nayax pilot authorization required';
  end if;

  select * into refund_case
  from public.refund_cases case_row
  where case_row.id = pilot.refund_case_id
  for share;
  select * into machine
  from public.reporting_machines machine_row
  where machine_row.id = pilot.reporting_machine_id
  for share;
  select * into intent
  from public.refund_manager_action_step_up_intents intent_row
  where intent_row.id = pilot.step_up_intent_id
  for share;

  if refund_case.id is null
    or refund_case.reporting_machine_id is distinct from machine.id
    or refund_case.status is distinct from 'correlated'
    or refund_case.decision is not null
    or refund_case.payment_amount_cents is distinct from pilot.amount_cents
    or refund_case.matched_nayax_amount_cents is distinct from pilot.amount_cents
    or refund_case.reporting_adjustment_id is not null
    or machine.id is null
    or machine.status is distinct from 'active'
    or machine.nayax_refunds_enabled is distinct from true
    or machine.nayax_refund_max_amount_cents is distinct from pilot.amount_cents
    or intent.id is null
    or intent.status <> 'pending'
    or intent.refund_case_id is distinct from pilot.refund_case_id
    or intent.actor_user_id is distinct from pilot.owner_user_id
    or intent.expires_at <= clock_timestamp()
    or exists (
      select 1 from public.refund_case_nayax_refund_attempts attempt
      where attempt.refund_case_id = pilot.refund_case_id
    ) then
    raise exception 'Controlled Nayax pilot post-arm machine or cap changed';
  end if;

  return jsonb_build_object(
    'ready', true,
    'authorizationBound', true,
    'machineArmed', true,
    'amountCapExact', true,
    'payloadRedacted', true
  );
end;
$$;

create or replace function public.admin_consume_refund_nayax_controlled_pilot_intent(
  p_pilot_authorization_id uuid,
  p_intent_id uuid,
  p_case_id uuid,
  p_expected_case_version bigint,
  p_refund_amount_cents integer,
  p_factor_verification_proof text,
  p_executor_assertion text,
  p_runner_assertion_digest text,
  p_contract_digest text,
  p_idempotency_key text,
  p_worker_lease_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = public, auth, extensions
as $$
declare
  authenticated_actor_user_id uuid := auth.uid();
  pilot public.refund_nayax_controlled_pilot_authorizations%rowtype;
  intent public.refund_manager_action_step_up_intents%rowtype;
  enrollment public.refund_manager_totp_enrollments%rowtype;
  context jsonb;
  approval_context jsonb;
  refund_case public.refund_cases%rowtype;
  machine public.reporting_machines%rowtype;
  current_owner_email_digest text;
  current_customer_email_digest text;
  current_self_case_attestation_digest text;
  current_owner_case_evidence_digest text;
  current_machine_evidence_digest text;
  current_account_key_digest text;
  verified_at_value timestamptz;
  official_authorization public.refund_case_official_action_authorizations%rowtype;
  reservation jsonb;
begin
  if auth.role() is distinct from 'authenticated' or authenticated_actor_user_id is null then
    raise exception 'Authenticated Machine Manager session required';
  end if;
  if coalesce(p_runner_assertion_digest, '') !~ '^[a-f0-9]{64}$'
    or coalesce(p_contract_digest, '') !~ '^[a-f0-9]{64}$'
    or coalesce(p_idempotency_key, '') !~ '^nayax-refund-[a-f0-9]{64}$'
    or nullif(p_executor_assertion, '') is null
    or p_worker_lease_id is null then
    raise exception 'Exact controlled pilot reservation evidence required';
  end if;
  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended('refund-nayax-controlled-owner-pilot', 430)
  );
  select * into pilot
  from public.refund_nayax_controlled_pilot_authorizations pilot_auth
  where pilot_auth.authorization_id = p_pilot_authorization_id
  for update;
  if pilot.authorization_id is null
    or pilot.status <> 'armed'
    or pilot.expires_at <= clock_timestamp()
    or pilot.owner_user_id is distinct from authenticated_actor_user_id
    or pilot.refund_case_id is distinct from p_case_id
    or pilot.step_up_intent_id is distinct from p_intent_id
    or pilot.expected_case_version is distinct from p_expected_case_version
    or pilot.amount_cents is distinct from p_refund_amount_cents
    or exists (
      select 1 from public.refund_nayax_controlled_pilot_closures closure
      where closure.authorization_id = pilot.authorization_id
    ) then
    raise exception 'Exact active controlled Nayax pilot authorization required';
  end if;

  select * into intent
  from public.refund_manager_action_step_up_intents existing
  where existing.id = p_intent_id for update;
  if intent.id is null
    or intent.actor_user_id is distinct from authenticated_actor_user_id
    or intent.refund_case_id is distinct from p_case_id
    or intent.action <> 'nayax_execute'
    or intent.target_function <> 'nayax-card-refund'
    or intent.status <> 'pending'
    or intent.expires_at <= clock_timestamp() then
    raise exception 'Manager verification request is invalid or already used';
  end if;

  select * into enrollment
  from public.refund_manager_totp_enrollments configured
  where configured.actor_user_id = authenticated_actor_user_id
    and configured.status = 'active' and configured.revoked_at is null
  for update;
  verified_at_value := public.refund_verified_totp_after_intent(intent.not_before);
  if enrollment.actor_user_id is null
    or enrollment.enrollment_version is distinct from intent.manager_totp_enrollment_version
    or verified_at_value is null
    or exists (
      select 1 from public.refund_manager_action_step_up_intents used_intent
      where used_intent.actor_user_id = authenticated_actor_user_id
        and used_intent.status = 'consumed'
        and used_intent.verified_totp_at = verified_at_value
    )
    or not coalesce(p_factor_verification_proof ~ '^[a-f0-9]{64}$', false)
    or intent.factor_verified_at is null
    or intent.factor_verified_at < intent.not_before
    or intent.factor_verified_at > intent.expires_at
    or intent.factor_verification_proof_hash is distinct from encode(
      extensions.digest(convert_to(
        'bloomjoy-refund-manager-step-up-proof-v1:' || p_factor_verification_proof,
        'UTF8'
      ), 'sha256'), 'hex'
    ) then
    raise exception 'Exact fresh owner-approved authenticator verification required';
  end if;

  select configured_case.* into refund_case
  from public.refund_cases configured_case
  where configured_case.id = p_case_id for update;
  select configured_machine.* into machine
  from public.reporting_machines configured_machine
  where configured_machine.id = refund_case.reporting_machine_id for update;
  select encode(extensions.digest(convert_to(
    lower(btrim(owner_user.email)), 'UTF8'
  ), 'sha256'), 'hex')
  into current_owner_email_digest
  from auth.users owner_user
  where owner_user.id = authenticated_actor_user_id
  for share;
  current_customer_email_digest := encode(extensions.digest(convert_to(
    lower(btrim(refund_case.customer_email)), 'UTF8'
  ), 'sha256'), 'hex');
  current_self_case_attestation_digest :=
    public.refund_nayax_controlled_pilot_self_attestation_hash(
      refund_case, machine, current_owner_email_digest, p_refund_amount_cents
    );
  current_owner_case_evidence_digest := encode(extensions.digest(convert_to(concat_ws('|',
    refund_case.id::text, machine.id::text, refund_case.official_action_version::text,
    refund_case.refund_amount_cents::text, refund_case.matched_nayax_transaction_id,
    refund_case.matched_nayax_site_id::text,
    refund_case.matched_nayax_machine_auth_time::text,
    public.refund_nayax_controlled_pilot_prearm_evidence_hash(
      refund_case, machine, p_refund_amount_cents
    )
  ), 'UTF8'), 'sha256'), 'hex');
  current_machine_evidence_digest := encode(extensions.digest(convert_to(concat_ws('|',
    machine.id::text, machine.nayax_machine_id, machine.nayax_account_key,
    p_refund_amount_cents::text
  ), 'UTF8'), 'sha256'), 'hex');
  current_account_key_digest := encode(extensions.digest(convert_to(
    upper(regexp_replace(btrim(machine.nayax_account_key), '[^A-Za-z0-9_]', '_', 'g')),
    'UTF8'
  ), 'sha256'), 'hex');
  if current_owner_email_digest is distinct from pilot.owner_email_digest
    or current_customer_email_digest is distinct from pilot.owner_email_digest
    or current_self_case_attestation_digest is distinct from
      pilot.self_case_attestation_digest
    or current_owner_case_evidence_digest is distinct from pilot.owner_case_evidence_digest
    or current_machine_evidence_digest is distinct from pilot.machine_evidence_digest
    or current_account_key_digest is distinct from pilot.account_key_digest then
    raise exception 'Reviewed controlled pilot self-owner evidence changed';
  end if;
  approval_context := public.refund_validate_official_action_context(
    authenticated_actor_user_id, p_case_id, 'approve', p_expected_case_version,
    'card_refund_pending', 'approved', null, 'owner_controlled_nayax_pilot', null,
    p_refund_amount_cents, null, null, false, null, null
  );
  if intent.manager_mapping_id is distinct from (approval_context ->> 'mappingId')::uuid
    or intent.manager_mapping_version is distinct from
      (approval_context ->> 'mappingVersion')::bigint
    or intent.action_context_hash is distinct from approval_context ->> 'contextHash'
    or intent.nayax_execution_evidence_hash is distinct from
      public.refund_nayax_controlled_pilot_prearm_evidence_hash(
        refund_case, machine, p_refund_amount_cents
      )
    or pilot.manager_mapping_id is distinct from intent.manager_mapping_id
    or pilot.manager_mapping_version is distinct from intent.manager_mapping_version
    or pilot.nayax_execution_evidence_hash is distinct from intent.nayax_execution_evidence_hash then
    raise exception 'Reviewed controlled pilot evidence changed';
  end if;

  update public.refund_cases
  set status = 'card_refund_pending',
      decision = 'approved',
      decision_reason = 'owner_controlled_nayax_pilot',
      decided_by = authenticated_actor_user_id,
      decided_at = verified_at_value,
      refund_amount_cents = p_refund_amount_cents,
      nayax_refund_execution_status = 'not_requested'
  where id = p_case_id
  returning * into refund_case;
  if refund_case.official_action_version is distinct from p_expected_case_version + 1 then
    raise exception 'Controlled pilot approval version did not advance exactly once';
  end if;
  context := public.refund_validate_official_action_context(
    authenticated_actor_user_id, p_case_id, 'nayax_execute',
    refund_case.official_action_version,
    'card_refund_pending', 'approved', null, null, null,
    p_refund_amount_cents, null, null, false, null, null
  );
  if intent.manager_mapping_id is distinct from (context ->> 'mappingId')::uuid
    or intent.manager_mapping_version is distinct from (context ->> 'mappingVersion')::bigint
    or (context ->> 'nayaxExecutionEvidenceHash') !~ '^[a-f0-9]{64}$' then
    raise exception 'Controlled pilot post-approval execution evidence changed';
  end if;

  update public.refund_manager_action_step_up_intents
  set expected_case_version = refund_case.official_action_version,
      action_context_hash = context ->> 'contextHash',
      nayax_execution_evidence_hash = context ->> 'nayaxExecutionEvidenceHash'
  where id = intent.id
  returning * into intent;
  update public.refund_nayax_controlled_pilot_authorizations
  set expected_case_version = refund_case.official_action_version,
      nayax_execution_evidence_hash = context ->> 'nayaxExecutionEvidenceHash'
  where authorization_id = pilot.authorization_id
  returning * into pilot;

  update public.refund_manager_action_step_up_intents
  set status = 'consumed', factor_verification_proof_hash = null,
    verified_totp_at = verified_at_value, consumed_at = clock_timestamp()
  where id = intent.id;
  update public.refund_manager_totp_enrollments
  set last_step_up_verified_at = verified_at_value, updated_at = clock_timestamp()
  where refund_manager_totp_enrollments.actor_user_id = authenticated_actor_user_id
    and enrollment_version = intent.manager_totp_enrollment_version
    and status = 'active';

  insert into public.refund_case_official_action_authorizations (
    refund_case_id, action, actor_user_id, manager_mapping_id,
    manager_mapping_version, expected_case_version, action_context_hash,
    status, expires_at, step_up_intent_id, verified_totp_at,
    nayax_execution_evidence_hash
  ) values (
    p_case_id, 'nayax_execute', authenticated_actor_user_id, intent.manager_mapping_id,
    intent.manager_mapping_version, intent.expected_case_version,
    intent.action_context_hash, 'authorized',
    least(intent.expires_at, clock_timestamp() + interval '30 seconds'),
    intent.id, verified_at_value, intent.nayax_execution_evidence_hash
  ) returning * into official_authorization;

  insert into public.refund_manager_step_up_audit (
    actor_user_id, refund_case_id, intent_id, action, event_type, verified_totp_at
  ) values (
    authenticated_actor_user_id, p_case_id, intent.id, 'nayax_execute',
    'intent_consumed', verified_at_value
  );
  reservation := public.service_reserve_and_consume_nayax_controlled_pilot_attempt(
    p_executor_assertion, p_pilot_authorization_id,
    p_runner_assertion_digest, p_contract_digest,
    official_authorization.id, p_case_id, p_idempotency_key,
    p_refund_amount_cents, 'USD', p_worker_lease_id
  );
  return jsonb_build_object(
    'authorizationId', official_authorization.id,
    'action', 'nayax_execute',
    'expectedCaseVersion', official_authorization.expected_case_version,
    'mappingVersion', official_authorization.manager_mapping_version,
    'expiresAt', official_authorization.expires_at,
    'pilotReservation', reservation,
    'payloadRedacted', true
  );
end;
$$;

create or replace function public.service_reserve_and_consume_nayax_controlled_pilot_attempt(
  p_executor_assertion text,
  p_pilot_authorization_id uuid,
  p_runner_assertion_digest text,
  p_contract_digest text,
  p_authorization_id uuid,
  p_case_id uuid,
  p_idempotency_key text,
  p_amount_cents integer,
  p_currency_code text default 'USD',
  p_worker_lease_id uuid default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  pilot public.refund_nayax_controlled_pilot_authorizations%rowtype;
  reservation jsonb;
  reserved_attempt_id uuid;
begin
  perform public.assert_nayax_provider_executor(p_executor_assertion);
  if coalesce(p_runner_assertion_digest, '') !~ '^[a-f0-9]{64}$' then
    raise exception 'Exact controlled pilot runner assertion required';
  end if;
  if coalesce(p_contract_digest, '') !~ '^[a-f0-9]{64}$'
    or p_worker_lease_id is null then
    raise exception 'Exact controlled pilot provider contract required';
  end if;
  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended('refund-nayax-controlled-owner-pilot', 430)
  );
  select * into pilot
  from public.refund_nayax_controlled_pilot_authorizations pilot_auth
  where pilot_auth.authorization_id = p_pilot_authorization_id
  for update;
  if pilot.authorization_id is null
    or pilot.status <> 'armed'
    or pilot.expires_at <= clock_timestamp()
    or pilot.refund_case_id is distinct from p_case_id
    or pilot.amount_cents is distinct from p_amount_cents
    or pilot.currency_code is distinct from upper(btrim(coalesce(p_currency_code, '')))
    or pilot.runner_assertion_digest is distinct from lower(p_runner_assertion_digest)
    or pilot.contract_digest is distinct from lower(p_contract_digest)
    or exists (
      select 1 from public.refund_nayax_controlled_pilot_closures closure
      where closure.authorization_id = pilot.authorization_id
    ) then
    raise exception 'Exact unused controlled Nayax pilot authorization required';
  end if;

  reservation := public.service_reserve_and_consume_nayax_refund_attempt_v2(
    p_executor_assertion, p_authorization_id, p_case_id, p_idempotency_key,
    p_amount_cents, p_amount_cents, 1, 'USD'
  );
  reserved_attempt_id := (reservation -> 'attempt' ->> 'attemptId')::uuid;
  if reserved_attempt_id is null
    or coalesce((reservation -> 'attempt' ->> 'shouldExecute')::boolean, false) is not true then
    raise exception 'Controlled Nayax pilot cannot replay a provider reservation';
  end if;

  update public.refund_nayax_controlled_pilot_authorizations
  set status = 'consumed', provider_attempt_id = reserved_attempt_id,
    consumed_at = clock_timestamp(), worker_lease_id = p_worker_lease_id,
    worker_lease_expires_at = clock_timestamp() + interval '8 minutes'
  where authorization_id = pilot.authorization_id;
  return reservation || jsonb_build_object(
    'pilotAuthorizationConsumed', true,
    'payloadRedacted', true
  );
end;
$$;

create or replace function public.service_record_nayax_controlled_pilot_stage(
  p_executor_assertion text,
  p_pilot_authorization_id uuid,
  p_attempt_id uuid,
  p_worker_lease_id uuid,
  p_stage_event text,
  p_outcome text default null,
  p_http_status integer default null,
  p_provider_result text default null,
  p_provider_status text default null,
  p_failure_type text default null,
  p_contract_matched boolean default null,
  p_classification_digest text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  pilot public.refund_nayax_controlled_pilot_authorizations%rowtype;
  normalized_event text := lower(btrim(coalesce(p_stage_event, '')));
  normalized_outcome text := nullif(lower(btrim(coalesce(p_outcome, ''))), '');
  normalized_result text := nullif(lower(btrim(coalesce(p_provider_result, ''))), '');
  normalized_status text := nullif(lower(btrim(coalesce(p_provider_status, ''))), '');
  normalized_failure text := nullif(lower(btrim(coalesce(p_failure_type, ''))), '');
  expected_ordinal integer;
  previous_event text;
  previous_outcome text;
begin
  perform public.assert_nayax_provider_executor(p_executor_assertion);
  if p_worker_lease_id is null then
    raise exception 'Exact controlled pilot worker lease required';
  end if;
  expected_ordinal := case normalized_event
    when 'request_started' then 1 when 'request_result' then 2
    when 'approve_started' then 3 when 'approve_result' then 4 else null end;
  if expected_ordinal is null then
    raise exception 'Unsupported controlled pilot stage event';
  end if;
  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended('refund-nayax-controlled-owner-pilot', 430)
  );
  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended('refund-nayax-controlled-pilot-stage|' || p_attempt_id::text, 430)
  );
  select * into pilot
  from public.refund_nayax_controlled_pilot_authorizations pilot_auth
  where pilot_auth.authorization_id = p_pilot_authorization_id
  for share;
  if pilot.status <> 'consumed'
    or pilot.provider_attempt_id is distinct from p_attempt_id
    or pilot.worker_lease_id is distinct from p_worker_lease_id
    or pilot.worker_lease_expires_at <= clock_timestamp()
    or pilot.worker_terminal_at is not null
    or not exists (
      select 1 from public.refund_case_nayax_refund_attempts attempt
      where attempt.id = p_attempt_id and attempt.status = 'in_progress'
        and attempt.provider_outcome is null
    ) then
    raise exception 'Exact active controlled pilot attempt required';
  end if;
  select journal.stage_event, journal.outcome
  into previous_event, previous_outcome
  from public.refund_nayax_controlled_pilot_stage_journal journal
  where journal.provider_attempt_id = p_attempt_id
  order by journal.stage_ordinal desc limit 1;
  if expected_ordinal > 1 and previous_event is distinct from (
    case expected_ordinal
      when 2 then 'request_started' when 3 then 'request_result'
      when 4 then 'approve_started'
    end
  ) then
    raise exception 'Controlled pilot stage journal order is invalid';
  end if;
  if expected_ordinal = 1 and previous_event is not null then
    raise exception 'Controlled pilot request was already started';
  end if;
  if expected_ordinal = 3 and previous_outcome is distinct from 'accepted' then
    raise exception 'Nayax approval requires an exactly accepted request result';
  end if;
  if normalized_event = 'request_result' and normalized_outcome not in (
    'accepted', 'rejected', 'duplicate', 'already_refunded', 'unknown'
  ) then
    raise exception 'Unsupported controlled pilot request result';
  end if;
  if normalized_event = 'approve_result' and normalized_outcome not in (
    'succeeded', 'rejected', 'duplicate', 'already_refunded', 'pending', 'unknown'
  ) then
    raise exception 'Unsupported controlled pilot approval result';
  end if;
  if normalized_event in ('request_result', 'approve_result') and (
    p_contract_matched is null
    or coalesce(p_classification_digest, '') !~ '^[a-f0-9]{64}$'
    or normalized_result not in ('contract_match', 'contract_mismatch')
    or normalized_status not in (
      'http_success', 'http_failure', 'transport_timeout', 'transport_network'
    )
    or (p_contract_matched and normalized_result <> 'contract_match')
    or (not p_contract_matched and normalized_result <> 'contract_mismatch')
  ) then
    raise exception 'Exact redacted controlled pilot provider classification required';
  end if;

  update public.refund_nayax_controlled_pilot_authorizations
  set worker_lease_expires_at = clock_timestamp() + interval '60 seconds'
  where authorization_id = p_pilot_authorization_id
    and worker_lease_id = p_worker_lease_id
    and worker_terminal_at is null;

  insert into public.refund_nayax_controlled_pilot_stage_journal (
    pilot_authorization_id, provider_attempt_id, stage_event, outcome,
    http_status, provider_result, provider_status, failure_type,
    contract_matched, classification_digest
  ) values (
    p_pilot_authorization_id, p_attempt_id, normalized_event,
    normalized_outcome, p_http_status, normalized_result,
    normalized_status, normalized_failure,
    p_contract_matched, lower(p_classification_digest)
  );
  return jsonb_build_object(
    'recorded', true, 'stageEvent', normalized_event, 'payloadRedacted', true
  );
end;
$$;

create or replace function public.service_settle_nayax_controlled_pilot_attempt(
  p_executor_assertion text,
  p_pilot_authorization_id uuid,
  p_attempt_id uuid,
  p_authorization_id uuid,
  p_case_id uuid,
  p_idempotency_key text,
  p_amount_cents integer,
  p_currency_code text,
  p_provider_claim_token text,
  p_provider_outcome text,
  p_worker_lease_id uuid,
  p_evidence_reference text default null,
  p_provider_status text default null,
  p_error_code text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  pilot public.refund_nayax_controlled_pilot_authorizations%rowtype;
  normalized_outcome text := lower(btrim(coalesce(p_provider_outcome, '')));
  stage_count integer;
  final_event text;
  final_outcome text;
  settlement jsonb;
begin
  perform public.assert_nayax_provider_executor(p_executor_assertion);
  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended('refund-nayax-controlled-owner-pilot', 430)
  );
  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended('refund-nayax-controlled-pilot-stage|' || p_attempt_id::text, 430)
  );
  select * into pilot
  from public.refund_nayax_controlled_pilot_authorizations pilot_auth
  where pilot_auth.authorization_id = p_pilot_authorization_id
  for update;
  if pilot.status <> 'consumed'
    or pilot.provider_attempt_id is distinct from p_attempt_id
    or pilot.refund_case_id is distinct from p_case_id
    or pilot.amount_cents is distinct from p_amount_cents
    or pilot.settled_at is not null
    or pilot.worker_lease_id is distinct from p_worker_lease_id
    or pilot.worker_lease_expires_at <= clock_timestamp()
    or pilot.worker_terminal_at is not null then
    raise exception 'Exact unsettled controlled pilot attempt required';
  end if;
  select count(*)::integer into stage_count
  from public.refund_nayax_controlled_pilot_stage_journal journal
  where journal.provider_attempt_id = p_attempt_id;
  select journal.stage_event, journal.outcome
  into final_event, final_outcome
  from public.refund_nayax_controlled_pilot_stage_journal journal
  where journal.provider_attempt_id = p_attempt_id
  order by journal.stage_ordinal desc limit 1;

  if stage_count < 1 then
    raise exception 'Durable request-start evidence is required before settlement';
  end if;
  if normalized_outcome = 'success' and (
    stage_count <> 4 or final_event <> 'approve_result' or final_outcome <> 'succeeded'
    or coalesce(p_evidence_reference, '') !~ '^nayax-evidence-[a-f0-9]{64}$'
  ) then
    raise exception 'Exact request and approval success journal required';
  end if;
  if normalized_outcome = 'rejected' and final_outcome <> 'rejected' then
    raise exception 'Exact rejected provider journal required';
  end if;
  if normalized_outcome in ('timeout', 'unknown') and final_outcome not in (
    'unknown', 'duplicate', 'already_refunded', 'pending'
  ) and final_event not in ('request_started', 'approve_started') then
    raise exception 'Exact ambiguous provider journal required';
  end if;

  settlement := public.service_settle_nayax_refund_attempt(
    p_executor_assertion, p_attempt_id, p_authorization_id, p_case_id,
    p_idempotency_key, p_amount_cents, p_currency_code,
    p_provider_claim_token, normalized_outcome, p_evidence_reference,
    p_provider_status, p_error_code
  );
  update public.refund_nayax_controlled_pilot_authorizations
  set settled_at = clock_timestamp(), provider_outcome = normalized_outcome,
    worker_terminal_at = clock_timestamp(), worker_terminal_status = normalized_outcome
  where authorization_id = p_pilot_authorization_id;
  update public.reporting_machines
  set nayax_refunds_enabled = false,
      nayax_refund_max_amount_cents = null
  where id = pilot.reporting_machine_id;
  update public.refund_nayax_provider_callers
  set status = 'revoked', rotated_at = clock_timestamp()
  where caller_id = 'nayax-card-refund'
    and assertion_digest = pilot.executor_assertion_digest
    and status = 'active';
  return settlement || jsonb_build_object(
    'pilotProviderOnly', true,
    'customerCompletionAttempted', false,
    'payloadRedacted', true
  );
end;
$$;

-- No table is directly available to browser or service clients. Database-owner
-- arm/cancel functions are intentionally ungranted; the service role receives
-- only the exact consume/journal/settlement boundary.
revoke execute on function public.owner_authorize_refund_nayax_controlled_pilot(
  uuid, uuid, uuid, bigint, integer,
  text, text, text, text, text, text, text, text, text, text, text
) from public, anon, authenticated, service_role;
revoke execute on function public.refund_nayax_controlled_pilot_audit_retention_approved()
  from public, anon, authenticated, service_role;
revoke execute on function public.owner_cancel_refund_nayax_controlled_pilot(uuid)
  from public, anon, authenticated, service_role;
revoke execute on function public.owner_recover_expired_refund_nayax_controlled_pilot()
  from public, anon, authenticated, service_role;
revoke execute on function public.refund_nayax_controlled_pilot_prearm_evidence_hash(
  public.refund_cases, public.reporting_machines, integer
) from public, anon, authenticated, service_role;
revoke execute on function public.refund_nayax_controlled_pilot_self_attestation_hash(
  public.refund_cases, public.reporting_machines, text, integer
) from public, anon, authenticated, service_role;
revoke execute on function public.service_validate_nayax_controlled_pilot_postarm(
  text, uuid, uuid, integer, text, text
) from public, anon, authenticated;
grant execute on function public.service_validate_nayax_controlled_pilot_postarm(
  text, uuid, uuid, integer, text, text
) to service_role;
revoke execute on function public.admin_consume_refund_nayax_controlled_pilot_intent(
  uuid, uuid, uuid, bigint, integer, text, text, text, text, text, uuid
) from public, anon, service_role;
grant execute on function public.admin_consume_refund_nayax_controlled_pilot_intent(
  uuid, uuid, uuid, bigint, integer, text, text, text, text, text, uuid
) to authenticated;
revoke execute on function public.service_reserve_and_consume_nayax_controlled_pilot_attempt(
  text, uuid, text, text, uuid, uuid, text, integer, text, uuid
) from public, anon, authenticated;
grant execute on function public.service_reserve_and_consume_nayax_controlled_pilot_attempt(
  text, uuid, text, text, uuid, uuid, text, integer, text, uuid
) to service_role;
revoke execute on function public.service_record_nayax_controlled_pilot_stage(
  text, uuid, uuid, uuid, text, text, integer, text, text, text, boolean, text
) from public, anon, authenticated;
grant execute on function public.service_record_nayax_controlled_pilot_stage(
  text, uuid, uuid, uuid, text, text, integer, text, text, text, boolean, text
) to service_role;
revoke execute on function public.service_settle_nayax_controlled_pilot_attempt(
  text, uuid, uuid, uuid, uuid, text, integer, text, text, text, uuid, text, text, text
) from public, anon, authenticated;
grant execute on function public.service_settle_nayax_controlled_pilot_attempt(
  text, uuid, uuid, uuid, uuid, text, integer, text, text, text, uuid, text, text, text
) to service_role;

comment on table public.refund_nayax_controlled_pilot_stage_journal is
  'Immutable redacted request/approval stage evidence for the single #430 owner pilot; it is not a provider receipt.';
comment on function public.service_reserve_and_consume_nayax_controlled_pilot_attempt(
  text, uuid, text, text, uuid, uuid, text, integer, text, uuid
) is
  'Consumes the one exact owner pilot and reserves one count-capped, amount-capped Nayax attempt; no replay is permitted.';
