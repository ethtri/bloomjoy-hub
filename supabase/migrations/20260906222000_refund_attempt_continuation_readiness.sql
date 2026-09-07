-- #990: expose one service-only, read-only readiness bit for the narrowly
-- bounded same-attempt approval continuation. Ordinary requested/uncertain
-- attempts remain reconciliation holds.

create function public.refund_nayax_approval_continuation_ready_v1(
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
  join public.reporting_machine_refund_managers manager_mapping
    on manager_mapping.id = action_authorization.manager_mapping_id
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
    and attempt.actor_user_id = p_user_id
    and attempt.execution_mode = 'request_and_approve'
    and attempt.status = 'in_progress'
    and attempt.provider_outcome is null
    and attempt.provider_claim_consumed_at is null
    and attempt.provider_claim_expires_at is not null
    and attempt.provider_claim_expires_at <= statement_timestamp()
    and action_authorization.refund_case_id = refund_case.id
    and action_authorization.actor_user_id = p_user_id
    and action_authorization.action = 'nayax_execute'
    and action_authorization.status = 'consumed'
    and action_authorization.consumed_at is not null
    and action_authorization.expected_case_version =
      (execution.context ->> 'caseVersion')::bigint + 1
    and refund_case.official_action_version =
      action_authorization.expected_case_version + 1
    and manager_mapping.reporting_machine_id = refund_case.reporting_machine_id
    and manager_mapping.manager_user_id = p_user_id
    and manager_mapping.mapping_version = action_authorization.manager_mapping_version
    and manager_mapping.status = 'active'
    and manager_mapping.revoked_at is null
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

create or replace function public.refund_case_nayax_manager_readiness(
  p_user_id uuid,
  p_refund_case_id uuid
)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  refund_case public.refund_cases%rowtype;
  machine public.reporting_machines%rowtype;
  transaction_confirmed boolean := false;
  approval_continuation_ready boolean := false;
  can_issue_card_refund boolean := false;
  block_reason text := null;
begin
  select case_row.* into refund_case
  from public.refund_cases case_row
  where case_row.id = p_refund_case_id;

  if not found then
    return jsonb_build_object(
      'transactionConfirmed', false,
      'approvalContinuationReady', false,
      'canIssueCardRefund', false,
      'blockReason', 'case_not_found',
      'refundAmountCents', null,
      'machineLimitCents', null,
      'caseVersion', null
    );
  end if;

  if refund_case.reporting_machine_id is not null then
    select machine_row.* into machine
    from public.reporting_machines machine_row
    where machine_row.id = refund_case.reporting_machine_id;
  end if;

  transaction_confirmed :=
    refund_case.correlation_status = 'matched'
    and refund_case.correlation_source = 'nayax'
    and refund_case.nayax_recommendation_policy_version is not null
    and public.is_review_safe_nayax_transaction_reference(
      refund_case.matched_nayax_transaction_id
    )
    and (
      refund_case.matched_nayax_site_id is not null
      or exists (
        select 1
        from public.refund_case_events manual_selection_event
        where manual_selection_event.refund_case_id = refund_case.id
          and manual_selection_event.event_type = 'nayax_match_selected'
          and manual_selection_event.metadata ->> 'manual_portal_candidate' = 'true'
      )
    )
    and refund_case.matched_nayax_machine_auth_time is not null
    and refund_case.matched_nayax_amount_cents is not null
    and refund_case.matched_nayax_currency_code = 'USD'
    and refund_case.refund_amount_cents is not null
    and refund_case.refund_amount_cents > 0
    and refund_case.matched_nayax_amount_cents = refund_case.refund_amount_cents
    and exists (
      select 1
      from public.refund_case_events selection_event
      where selection_event.refund_case_id = refund_case.id
        and selection_event.event_type = 'nayax_match_selected'
        and selection_event.actor_user_id is not null
    );

  approval_continuation_ready :=
    public.refund_nayax_approval_continuation_ready_v1(
      p_user_id,
      refund_case.id
    );

  block_reason := case
    when approval_continuation_ready then null
    when p_user_id is null
      or not public.can_perform_refund_official_action(p_user_id, refund_case.id)
      then 'unauthorized'
    when not transaction_confirmed then 'transaction_not_confirmed'
    when refund_case.reporting_adjustment_id is not null
      or refund_case.refund_completed_at is not null
      or refund_case.nayax_refund_execution_status = 'succeeded'
      then 'already_refunded'
    when public.refund_case_has_unresolved_reconciliation(refund_case.id)
      or refund_case.nayax_refund_execution_status in (
        'requested', 'ambiguous', 'manual_review'
      )
      then 'reconciliation_hold'
    when exists (
      select 1
      from public.refund_cases duplicate_case
      where duplicate_case.id <> refund_case.id
        and duplicate_case.matched_nayax_transaction_id =
          refund_case.matched_nayax_transaction_id
    ) then 'duplicate_transaction'
    when refund_case.payment_method <> 'card'
      or refund_case.status not in (
        'needs_review', 'correlated', 'approved', 'card_refund_pending'
      )
      or (refund_case.decision is not null and refund_case.decision <> 'approved')
      or refund_case.nayax_refund_execution_status <> 'not_requested'
      then 'case_not_refundable'
    when machine.id is null
      or machine.status <> 'active'
      or machine.nayax_machine_id is null
      or btrim(machine.nayax_machine_id) = ''
      or machine.nayax_account_key is null
      or btrim(machine.nayax_account_key) = ''
      then 'provider_unavailable'
    when machine.nayax_refunds_enabled is not true then 'machine_not_enabled'
    else null
  end;

  can_issue_card_refund := block_reason is null;
  return jsonb_build_object(
    'transactionConfirmed', transaction_confirmed,
    'approvalContinuationReady', approval_continuation_ready,
    'canIssueCardRefund', can_issue_card_refund,
    'blockReason', block_reason,
    'refundAmountCents', refund_case.matched_nayax_amount_cents,
    'machineLimitCents', null,
    'caseVersion', refund_case.official_action_version,
    'accountCircuitBreakerActive', false
  );
end;
$$;

revoke execute on function public.refund_case_nayax_manager_readiness(uuid, uuid)
  from public, anon, authenticated;
grant execute on function public.refund_case_nayax_manager_readiness(uuid, uuid)
  to service_role;

comment on function public.refund_nayax_approval_continuation_ready_v1(uuid, uuid)
  is 'Private read-only proof that the same current manager may claim the one approval continuation for the immutable accepted request attempt.';

select pg_notify('pgrst', 'reload schema');
