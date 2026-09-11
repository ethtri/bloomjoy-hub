-- #1263: allow the trusted automation service to continue the approval stage
-- of one already-authorized, immutable Nayax attempt after its original claim
-- expires. This surface cannot create or repeat a refund-request stage.

create table public.refund_nayax_server_approval_continuation_claims (
  id uuid primary key default gen_random_uuid(),
  nayax_refund_attempt_id uuid not null unique
    references public.refund_case_nayax_refund_attempts(id) on delete restrict,
  refund_case_id uuid not null
    references public.refund_cases(id) on delete restrict,
  approval_continuation_attempt_id uuid not null unique
    references public.refund_nayax_attempt_approval_continuations(
      nayax_refund_attempt_id
    ) on delete restrict,
  official_action_authorization_id uuid not null
    references public.refund_case_official_action_authorizations(id)
      on delete restrict,
  current_manager_mapping_id uuid not null
    references public.reporting_machine_refund_managers(id) on delete restrict,
  current_manager_mapping_version bigint not null
    check (current_manager_mapping_version > 0),
  execution_context_hash text not null
    check (execution_context_hash ~ '^[a-f0-9]{64}$'),
  provider_claim_digest text not null
    check (provider_claim_digest ~ '^[a-f0-9]{64}$'),
  claimed_at timestamptz not null default statement_timestamp()
);

alter table public.refund_nayax_server_approval_continuation_claims
  enable row level security;
revoke all on table public.refund_nayax_server_approval_continuation_claims
  from public, anon, authenticated, service_role;
create trigger refund_nayax_server_approval_continuation_claim_immutable
before update or delete
on public.refund_nayax_server_approval_continuation_claims
for each row execute function public.guard_refund_nayax_provider_stage_immutable();

create function public.service_claim_due_nayax_approval_continuations_v1(
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
      original_mapping.id as original_mapping_id,
      original_mapping.mapping_version as original_mapping_version,
      current_mapping.id as current_mapping_id,
      current_mapping.manager_user_id as current_manager_user_id,
      current_mapping.mapping_version as current_mapping_version,
      machine.nayax_account_key,
      machine.nayax_machine_id,
      frozen.context as frozen_context
    from public.refund_case_nayax_refund_attempts attempt
    join public.refund_cases refund_case
      on refund_case.id = attempt.refund_case_id
    join public.refund_case_official_action_authorizations authz
      on authz.id = attempt.official_action_authorization_id
    join public.reporting_machine_refund_managers original_mapping
      on original_mapping.id = authz.manager_mapping_id
    join public.reporting_machines machine
      on machine.id = refund_case.reporting_machine_id
    join public.refund_nayax_execution_contexts frozen
      on frozen.attempt_id = attempt.id
      and frozen.refund_case_id = refund_case.id
    join lateral (
      select mapping.*
      from public.reporting_machine_refund_managers mapping
      where mapping.reporting_machine_id = refund_case.reporting_machine_id
        and mapping.status = 'active'
        and mapping.revoked_at is null
      order by mapping.mapping_version desc, mapping.id
      limit 1
    ) current_mapping on true
    where attempt.execution_mode = 'request_and_approve'
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
      and original_mapping.reporting_machine_id = refund_case.reporting_machine_id
      and original_mapping.manager_user_id = authz.actor_user_id
      and original_mapping.mapping_version >= authz.manager_mapping_version
      and public.can_perform_refund_official_action(
        current_mapping.manager_user_id,
        refund_case.id
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
      candidate.current_manager_user_id,
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
      current_manager_mapping_id,
      current_manager_mapping_version,
      execution_context_hash,
      provider_claim_digest
    ) values (
      candidate.attempt_id,
      candidate.case_id,
      candidate.attempt_id,
      candidate.official_action_authorization_id,
      candidate.current_mapping_id,
      candidate.current_mapping_version,
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
      'currentManagerMappingId', candidate.current_mapping_id,
      'currentManagerMappingVersion', candidate.current_mapping_version,
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

-- The immutable attempt continues to identify the manager who approved and
-- reserved it. Approval-stage execution after a reassignment is instead
-- authorized by the immutable continuation row and, for this service path,
-- its exact current-mapping claim. Never rewrite the original audit actor.
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

  current_execution_authorized := public.can_perform_refund_official_action(
    attempt_row.actor_user_id,
    case_row.id
  );
  if new.stage = 'approve' then
    current_execution_authorized := current_execution_authorized or exists (
      select 1
      from public.refund_nayax_attempt_approval_continuations continuation
      join public.reporting_machine_refund_managers current_mapping
        on current_mapping.reporting_machine_id = case_row.reporting_machine_id
        and current_mapping.manager_user_id = continuation.actor_user_id
        and current_mapping.status = 'active'
        and current_mapping.revoked_at is null
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
        and public.can_perform_refund_official_action(
          continuation.actor_user_id,
          case_row.id
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
              and server_claim.current_manager_mapping_id = current_mapping.id
              and server_claim.current_manager_mapping_version =
                current_mapping.mapping_version
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

revoke all on function public.service_claim_due_nayax_approval_continuations_v1(
  text, text, integer
) from public, anon, authenticated;
grant execute on function public.service_claim_due_nayax_approval_continuations_v1(
  text, text, integer
) to service_role;

comment on table public.refund_nayax_server_approval_continuation_claims is
  'Immutable claim-once audit binding for a service-run approval-only continuation. No retry is issued after the claim, including after an unknown provider-start outcome.';
comment on function public.service_claim_due_nayax_approval_continuations_v1(
  text, text, integer
) is
  'Atomically claims up to five expired, request-proven, already-authorized Nayax attempts with SKIP LOCKED. Returns only their frozen approval context and never creates a refund request.';

select pg_notify('pgrst', 'reload schema');
