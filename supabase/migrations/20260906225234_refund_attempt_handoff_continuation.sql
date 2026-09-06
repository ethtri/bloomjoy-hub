-- #990/#628: preserve the original consumed approval across an unchanged
-- machine-manager handoff. The immutable attempt and authorization retain the
-- original approver; the continuation row records the current mapped executor.

create or replace function public.refund_nayax_approval_continuation_ready_v1(
  p_user_id uuid,
  p_refund_case_id uuid
)
returns boolean
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  saved_context jsonb;
  current_context jsonb;
begin
  select execution.context into saved_context
  from public.refund_cases refund_case
  join public.reporting_machines machine
    on machine.id = refund_case.reporting_machine_id
  join public.refund_case_nayax_refund_attempts attempt
    on attempt.refund_case_id = refund_case.id
  join public.refund_nayax_execution_contexts execution
    on execution.attempt_id = attempt.id
    and execution.refund_case_id = refund_case.id
  join public.refund_case_official_action_authorizations action_authorization
    on action_authorization.id = attempt.official_action_authorization_id
  join public.reporting_machine_refund_managers original_manager_mapping
    on original_manager_mapping.id = action_authorization.manager_mapping_id
  join public.reporting_machine_refund_managers current_manager_mapping
    on current_manager_mapping.reporting_machine_id = refund_case.reporting_machine_id
    and current_manager_mapping.manager_user_id = p_user_id
    and current_manager_mapping.status = 'active'
    and current_manager_mapping.revoked_at is null
  where refund_case.id = p_refund_case_id
    and p_user_id is not null
    and refund_case.duplicate_of_refund_case_id is null
    and refund_case.payment_method = 'card'
    and refund_case.status = 'card_refund_pending'
    and refund_case.decision = 'approved'
    and refund_case.correlation_status = 'matched'
    and refund_case.correlation_source = 'nayax'
    and refund_case.nayax_refund_execution_status = 'requested'
    and refund_case.refund_completed_at is null
    and refund_case.reporting_adjustment_id is null
    and refund_case.refund_amount_cents is not null
    and refund_case.refund_amount_cents > 0
    and refund_case.refund_amount_cents = refund_case.matched_nayax_amount_cents
    and refund_case.matched_nayax_currency_code = 'USD'
    and public.is_review_safe_nayax_transaction_reference(
      refund_case.matched_nayax_transaction_id
    )
    and refund_case.matched_nayax_site_id is not null
    and refund_case.matched_nayax_machine_auth_time is not null
    and not public.refund_case_has_unresolved_reconciliation(refund_case.id)
    and not exists (
      select 1
      from public.refund_gmail_case_link_review_candidates candidate
      join public.refund_gmail_case_link_reviews review
        on review.id = candidate.review_id
      where candidate.refund_case_id = refund_case.id
        and review.status = 'pending'
    )
    and not exists (
      select 1
      from public.refund_cases duplicate_case
      where duplicate_case.id <> refund_case.id
        and duplicate_case.matched_nayax_transaction_id =
          refund_case.matched_nayax_transaction_id
    )
    and exists (
      select 1
      from public.refund_case_events selection_event
      where selection_event.refund_case_id = refund_case.id
        and selection_event.event_type = 'nayax_match_selected'
        and selection_event.actor_user_id is not null
    )
    and machine.status = 'active'
    and machine.nayax_refunds_enabled is true
    and machine.nayax_machine_id = execution.context ->> 'providerMachineId'
    and machine.nayax_account_key = execution.context ->> 'accountScope'
    and attempt.actor_user_id = action_authorization.actor_user_id
    and attempt.execution_mode = 'request_and_approve'
    and attempt.status = 'in_progress'
    and attempt.provider_outcome is null
    and attempt.provider_claim_consumed_at is null
    and attempt.provider_claim_expires_at is not null
    and attempt.provider_claim_expires_at <= statement_timestamp()
    and action_authorization.refund_case_id = refund_case.id
    and action_authorization.action = 'nayax_execute'
    and action_authorization.status = 'consumed'
    and action_authorization.consumed_at is not null
    and action_authorization.expected_case_version =
      (execution.context ->> 'caseVersion')::bigint + 1
    and refund_case.official_action_version =
      action_authorization.expected_case_version + 1
    and original_manager_mapping.reporting_machine_id = refund_case.reporting_machine_id
    and original_manager_mapping.manager_user_id = action_authorization.actor_user_id
    and original_manager_mapping.mapping_version >= action_authorization.manager_mapping_version
    and current_manager_mapping.reporting_machine_id = refund_case.reporting_machine_id
    and public.can_perform_refund_official_action(p_user_id, refund_case.id)
    and refund_case.nayax_refund_attempt_generation =
      (execution.context ->> 'attemptGeneration')::integer
    and refund_case.matched_nayax_transaction_id =
      execution.context ->> 'transactionId'
    and refund_case.matched_nayax_site_id =
      (execution.context ->> 'siteId')::integer
    and refund_case.matched_nayax_amount_cents =
      (execution.context ->> 'originalAmountCents')::integer
    and refund_case.matched_nayax_currency_code =
      execution.context ->> 'currencyCode'
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
  limit 1;

  if saved_context is null then
    return false;
  end if;

  begin
    current_context := public.refund_nayax_selected_execution_context(
      p_refund_case_id
    );
  exception when others then
    return false;
  end;

  return current_context is not null
    and current_context ->> 'transactionId' = saved_context ->> 'transactionId'
    and current_context ->> 'siteId' = saved_context ->> 'siteId'
    and current_context ->> 'machineAuthorizationTime' =
      saved_context ->> 'machineAuthorizationTime'
    and current_context ->> 'machineAuthorizationTimeSource' =
      'MachineAuthorizationTime'
    and current_context ->> 'originalAmountCents' =
      saved_context ->> 'originalAmountCents'
    and current_context ->> 'currencyCode' = saved_context ->> 'currencyCode';
end;
$$;

revoke execute on function public.refund_nayax_approval_continuation_ready_v1(
  uuid, uuid
) from public, anon, authenticated, service_role;

create or replace function public.service_reserve_nayax_refund_approval_continuation_v1(
  p_executor_assertion text,
  p_actor_user_id uuid,
  p_case_id uuid,
  p_expected_case_version bigint,
  p_idempotency_key text,
  p_amount_cents integer,
  p_currency_code text,
  p_provider_contract_version text,
  p_journal_contract_version text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  case_row public.refund_cases%rowtype;
  attempt_row public.refund_case_nayax_refund_attempts%rowtype;
  authorization_row public.refund_case_official_action_authorizations%rowtype;
  original_mapping_row public.reporting_machine_refund_managers%rowtype;
  current_mapping_row public.reporting_machine_refund_managers%rowtype;
  machine_row public.reporting_machines%rowtype;
  execution_context jsonb;
  current_context jsonb;
  continuation_claim_token text;
  continuation_claim_digest text;
  continuation_claim_expires_at timestamptz;
  reservation jsonb;
begin
  perform public.assert_nayax_provider_executor(p_executor_assertion);
  if p_actor_user_id is null or p_case_id is null
    or p_idempotency_key !~ '^nayax-refund-[a-f0-9]{64}$'
    or p_amount_cents is null or p_amount_cents <= 0
    or upper(btrim(coalesce(p_currency_code, ''))) <> 'USD'
    or btrim(coalesce(p_provider_contract_version, '')) <> 'nayax-production-account-contract-v2'
    or btrim(coalesce(p_journal_contract_version, '')) <> 'nayax-provider-journal-v3' then
    raise exception 'Exact current Nayax continuation context is required'
      using errcode = 'P4628';
  end if;

  select refund_case.* into case_row
  from public.refund_cases refund_case where refund_case.id = p_case_id for update;
  if not found then
    raise exception 'Refund case not found' using errcode = 'P4628';
  end if;
  select attempt.* into attempt_row
  from public.refund_case_nayax_refund_attempts attempt
  where attempt.idempotency_key = p_idempotency_key for update;
  if not found or attempt_row.refund_case_id is distinct from case_row.id
    or attempt_row.amount_cents is distinct from p_amount_cents
    or attempt_row.currency_code is distinct from 'USD'
    or attempt_row.execution_mode is distinct from 'request_and_approve' then
    raise exception 'Continuation does not match the immutable Nayax attempt'
      using errcode = 'P4628';
  end if;

  select context into strict execution_context
  from public.refund_nayax_execution_contexts
  where attempt_id = attempt_row.id and refund_case_id = case_row.id;
  select * into strict authorization_row
  from public.refund_case_official_action_authorizations
  where id = attempt_row.official_action_authorization_id;
  select * into strict original_mapping_row
  from public.reporting_machine_refund_managers
  where id = authorization_row.manager_mapping_id for share;
  select * into current_mapping_row
  from public.reporting_machine_refund_managers
  where reporting_machine_id = case_row.reporting_machine_id
    and manager_user_id = p_actor_user_id
    and status = 'active'
    and revoked_at is null
  for share;
  if not found
    or not public.can_perform_refund_official_action(p_actor_user_id, case_row.id) then
    raise exception 'Current Machine Manager authority is required for continuation'
      using errcode = 'P4628';
  end if;
  select * into strict machine_row
  from public.reporting_machines where id = case_row.reporting_machine_id for share;

  if case_row.official_action_version is distinct from p_expected_case_version
    or authorization_row.refund_case_id is distinct from case_row.id
    or authorization_row.actor_user_id is distinct from attempt_row.actor_user_id
    or authorization_row.action is distinct from 'nayax_execute'
    or authorization_row.status is distinct from 'consumed'
    or authorization_row.consumed_at is null
    or authorization_row.expected_case_version is distinct from
      (execution_context->>'caseVersion')::bigint + 1
    or case_row.official_action_version is distinct from
      authorization_row.expected_case_version + 1
    or original_mapping_row.reporting_machine_id is distinct from case_row.reporting_machine_id
    or original_mapping_row.manager_user_id is distinct from authorization_row.actor_user_id
    or original_mapping_row.mapping_version < authorization_row.manager_mapping_version
    or current_mapping_row.reporting_machine_id is distinct from case_row.reporting_machine_id
    or current_mapping_row.manager_user_id is distinct from p_actor_user_id
    or current_mapping_row.status is distinct from 'active'
    or current_mapping_row.revoked_at is not null
    or case_row.duplicate_of_refund_case_id is not null
    or public.refund_case_has_unresolved_reconciliation(case_row.id)
    or exists (
      select 1
      from public.refund_gmail_case_link_review_candidates candidate
      join public.refund_gmail_case_link_reviews review
        on review.id = candidate.review_id
      where candidate.refund_case_id = case_row.id
        and review.status = 'pending'
    )
    or exists (
      select 1
      from public.refund_cases duplicate_case
      where duplicate_case.id <> case_row.id
        and duplicate_case.matched_nayax_transaction_id =
          case_row.matched_nayax_transaction_id
    )
    or case_row.status is distinct from 'card_refund_pending'
    or case_row.decision is distinct from 'approved'
    or case_row.nayax_refund_execution_status is distinct from 'requested'
    or case_row.refund_completed_at is not null or case_row.reporting_adjustment_id is not null
    or case_row.refund_amount_cents is distinct from p_amount_cents
    or case_row.nayax_refund_attempt_generation is distinct from (execution_context->>'attemptGeneration')::integer
    or case_row.matched_nayax_transaction_id is distinct from execution_context->>'transactionId'
    or case_row.matched_nayax_site_id is distinct from (execution_context->>'siteId')::integer
    or case_row.matched_nayax_amount_cents is distinct from (execution_context->>'originalAmountCents')::integer
    or case_row.matched_nayax_currency_code is distinct from execution_context->>'currencyCode'
    or machine_row.status is distinct from 'active'
    or machine_row.nayax_refunds_enabled is distinct from true
    or machine_row.nayax_machine_id is distinct from execution_context->>'providerMachineId'
    or machine_row.nayax_account_key is distinct from execution_context->>'accountScope' then
    raise exception 'Selected Nayax purchase or current manager authority changed'
      using errcode = 'P4628';
  end if;

  current_context := public.refund_nayax_selected_execution_context(case_row.id);
  if current_context is null
    or current_context->>'transactionId' is distinct from execution_context->>'transactionId'
    or current_context->>'siteId' is distinct from execution_context->>'siteId'
    or current_context->>'machineAuthorizationTime' is distinct from execution_context->>'machineAuthorizationTime'
    or current_context->>'machineAuthorizationTimeSource' is distinct from 'MachineAuthorizationTime'
    or current_context->>'originalAmountCents' is distinct from execution_context->>'originalAmountCents'
    or current_context->>'currencyCode' is distinct from execution_context->>'currencyCode' then
    raise exception 'Original Nayax execution evidence changed'
      using errcode = 'P4628';
  end if;

  -- Active original workers retain their claim. A continuation is considered
  -- only after that claim expires, and only one continuation reservation can
  -- ever be inserted for the immutable attempt.
  if attempt_row.status is distinct from 'in_progress'
    or attempt_row.provider_outcome is not null
    or attempt_row.provider_claim_consumed_at is not null
    or attempt_row.provider_claim_expires_at > statement_timestamp()
    or exists (
      select 1 from public.refund_nayax_attempt_approval_continuations continuation
      where continuation.nayax_refund_attempt_id = attempt_row.id
    )
    or exists (
      select 1 from public.refund_nayax_provider_stage_journal approval_stage
      where approval_stage.nayax_refund_attempt_id = attempt_row.id
        and approval_stage.pending_approval_recovery_id is null
        and approval_stage.stage = 'approve'
    )
    or not exists (
      select 1
      from public.refund_nayax_provider_stage_journal request_result
      join public.refund_nayax_provider_business_outcomes business
        on business.provider_stage_journal_id = request_result.id
      where request_result.nayax_refund_attempt_id = attempt_row.id
        and request_result.pending_approval_recovery_id is null
        and request_result.stage = 'request' and request_result.event = 'result'
        and request_result.http_status = 200 and request_result.http_accepted is true
        and request_result.media_type_class = 'application_json'
        and request_result.body_kind = 'json_object'
        and request_result.json_parsed is true and request_result.body_json_object is true
        and request_result.schema_matched is true
        and request_result.semantic_pair_matched is true
        and request_result.contract_matched is true
        and request_result.outcome = 'accepted'
        and request_result.failure_type is null
        and request_result.approval_authorized is true
        and request_result.provider_contract_version = p_provider_contract_version
        and request_result.journal_contract_version = p_journal_contract_version
        and business.nayax_refund_attempt_id = attempt_row.id
        and business.stage = 'request' and business.business_pair_retained is true
    ) then
    reservation := public.refund_nayax_attempt_reservation_payload(attempt_row.id, false, null);
    return jsonb_set(
      reservation,
      '{attempt,executionPlan}',
      to_jsonb('approval_continuation'::text),
      true
    );
  end if;

  continuation_claim_token := encode(extensions.gen_random_bytes(32), 'hex');
  continuation_claim_digest := encode(
    extensions.digest(convert_to(continuation_claim_token, 'UTF8'), 'sha256'), 'hex'
  );
  continuation_claim_expires_at := statement_timestamp() + interval '15 minutes';
  insert into public.refund_nayax_attempt_approval_continuations (
    nayax_refund_attempt_id, refund_case_id, actor_user_id,
    official_action_authorization_id, attempt_generation,
    execution_context_hash, provider_claim_digest, provider_claim_expires_at
  ) values (
    attempt_row.id, case_row.id, p_actor_user_id, authorization_row.id,
    (execution_context->>'attemptGeneration')::integer,
    execution_context->>'contextHash', continuation_claim_digest,
    continuation_claim_expires_at
  );
  update public.refund_case_nayax_refund_attempts
  set provider_claim_digest = continuation_claim_digest,
      provider_claim_expires_at = continuation_claim_expires_at,
      safe_transport_stage = 'request_result',
      safe_failure_class = null,
      refund_operations_due_at = null
  where id = attempt_row.id;

  reservation := public.refund_nayax_attempt_reservation_payload(
    attempt_row.id, true, continuation_claim_token
  );
  return jsonb_set(
    reservation,
    '{attempt,executionPlan}',
    to_jsonb('approval_continuation'::text),
    true
  );
end;
$$;
revoke execute on function public.service_reserve_nayax_refund_approval_continuation_v1(
  text, uuid, uuid, bigint, text, integer, text, text, text
) from public, anon, authenticated, service_role;
grant execute on function public.service_reserve_nayax_refund_approval_continuation_v1(
  text, uuid, uuid, bigint, text, integer, text, text, text
) to service_role;


comment on function public.refund_nayax_approval_continuation_ready_v1(uuid, uuid) is
  'Private evidence predicate for an exact same-attempt approval continuation by the current mapped executor, preserving the original consumed approval across manager handoff.';
comment on function public.service_reserve_nayax_refund_approval_continuation_v1(
  text, uuid, uuid, bigint, text, integer, text, text, text
) is 'Issues one approval-only claim to the current mapped executor for the immutable authorized attempt. It preserves original approver attribution, cannot create or repeat a refund request, and never admits unknown request evidence.';

select pg_notify('pgrst', 'reload schema');
