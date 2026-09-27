-- Correct the task projection for a historically abandoned pre-message claim
-- or deliberate no-customer-fact suppression. Neither state contains a
-- customer question, so delivery recovery would misdirect the Agent.
create or replace function public.refund_next_work_projection(
  p_lifecycle jsonb,
  p_verified_reply_at timestamptz default null
)
returns jsonb
language plpgsql
stable
set search_path = ''
as $$
declare
  stage text := p_lifecycle ->> 'stage';
  reason text := p_lifecycle ->> 'reasonCode';
  outreach jsonb := coalesce(p_lifecycle -> 'customerOutreach', '{}'::jsonb);
  outreach_state text := outreach ->> 'state';
  request_sent_at timestamptz := nullif(outreach ->> 'requestSentAt', '')::timestamptz;
  reply_at timestamptz := greatest(
    coalesce(nullif(outreach ->> 'replyReceivedAt', '')::timestamptz, '-infinity'::timestamptz),
    coalesce(p_verified_reply_at, '-infinity'::timestamptz)
  );
  customer_wait boolean := false;
  payment_confirmed boolean := p_lifecycle ->> 'paymentState' = 'confirmed';
  notice_state text := p_lifecycle -> 'messageState' ->> 'state';
  notice_resolved boolean := coalesce(notice_state in ('sent', 'delivered'), false);
  denial_notice_state text := p_lifecycle ->> 'denialNoticeState';
  is_open boolean;
  actor_name text := 'agent';
  action_code text := 'research_purchase';
  action_label text := 'Review the purchase evidence and prepare the next step.';
  progress_at timestamptz;
  due_at timestamptz := null;
  blocker jsonb := null;
begin
  if p_lifecycle is null or p_lifecycle ->> 'payloadRedacted' <> 'true' then
    return null;
  end if;

  -- A linked, verified customer reply wins over a stale follow-up cycle even
  -- when the reply parser has not yet applied structured facts (#1361).
  customer_wait := outreach_state = 'waiting_for_customer'
    and request_sent_at is not null
    and outreach ->> 'deliveryState' = 'delivered'
    and (reply_at = '-infinity'::timestamptz or reply_at <= request_sent_at);

  is_open := case
    when stage in ('duplicate_resolved', 'internal_test_archived', 'unable_to_complete') then false
    when stage = 'denied' then coalesce(denial_notice_state in
      ('pending', 'failed', 'skipped', 'delivery_unconfirmed', 'unknown'), false)
    when payment_confirmed then not notice_resolved
    else not coalesce((p_lifecycle ->> 'terminal')::boolean, false)
  end;

  progress_at := nullif(p_lifecycle -> 'lookup' ->> 'lastUpdatedAt', '')::timestamptz;
  if request_sent_at is not null then
    progress_at := greatest(coalesce(progress_at, '-infinity'::timestamptz), request_sent_at);
  end if;
  if reply_at <> '-infinity'::timestamptz then
    progress_at := greatest(coalesce(progress_at, '-infinity'::timestamptz), reply_at);
  end if;
  if payment_confirmed then
    progress_at := nullif(p_lifecycle -> 'messageState' ->> 'lastUpdatedAt', '')::timestamptz;
  elsif stage = 'denied' then
    progress_at := nullif(p_lifecycle ->> 'denialNoticeAt', '')::timestamptz;
  end if;
  if progress_at = '-infinity'::timestamptz then progress_at := null; end if;

  if not is_open then
    actor_name := 'system';
    action_code := 'none';
    action_label := 'No refund or customer-contact action is due.';
  elsif stage = 'denied' then
    actor_name := 'agent';
    action_code := 'recover_customer_delivery';
    action_label := 'Check the existing denial notice and complete or reconcile its delivery.';
    blocker := jsonb_build_object(
      'code', 'denial_notice_unresolved', 'owner', 'Agent',
      'nextStep', 'Inspect the existing denial message and delivery evidence before any resend.'
    );
  elsif payment_confirmed then
    actor_name := case when notice_state in ('failed', 'delivery_unconfirmed') then 'agent' else 'system' end;
    action_code := 'recover_customer_delivery';
    action_label := case
      when actor_name = 'agent' then 'Check the existing customer update and recover its delivery without repeating payment.'
      else 'Complete the existing customer update without repeating payment.'
    end;
    if actor_name = 'agent' then
      blocker := jsonb_build_object(
        'code', 'customer_delivery_unresolved', 'owner', 'Agent',
        'nextStep', 'Inspect the existing message and delivery evidence; use the supported recovery action.'
      );
    end if;
  elsif p_lifecycle ->> 'approvedCardContinuation' = 'true' then
    actor_name := 'agent';
    action_code := 'continue_refund';
    action_label := 'Review the existing card approval and continue or reconcile its payment attempt.';
    blocker := jsonb_build_object(
      'code', 'approved_card_continuation_pending', 'owner', 'Agent',
      'nextStep', 'Use the existing approved decision and payment evidence; do not ask for another approval.'
    );
  elsif reply_at <> '-infinity'::timestamptz and request_sent_at is not null
    and reply_at > request_sent_at and outreach_state in ('waiting_for_customer', 'customer_replied', 'rechecking') then
    actor_name := 'agent';
    action_code := 'review_customer_reply';
    action_label := 'Review the customer reply and continue the same case.';
    blocker := jsonb_build_object(
      'code', 'reply_reconciliation_pending', 'owner', 'Agent',
      'nextStep', 'Apply or review the verified reply and resume purchase research.'
    );
  elsif customer_wait then
    actor_name := 'customer';
    action_code := 'answer_question';
    action_label := 'Waiting for the customer to answer the delivered question.';
  elsif outreach_state in ('queued', 'preparing', 'sent_unconfirmed') then
    actor_name := 'system';
    action_code := 'deliver_customer_question';
    action_label := 'Send or confirm delivery of the existing customer question.';
  elsif outreach_state in ('delivery_failed', 'policy_suppressed')
    and outreach ->> 'requestMessageId' is null
    and outreach ->> 'requestSentAt' is null
    and outreach -> 'requestedFields' = '[]'::jsonb
    and outreach ->> 'failureCode' in (
      'request_claim_abandoned',
      'pre_message_suppressed:no_customer_correctable_fact'
    ) then
    actor_name := 'agent';
    action_code := 'research_purchase';
    action_label := 'Research the purchase internally; no customer question is ready.';
    blocker := jsonb_build_object(
      'code', 'no_customer_correctable_fact', 'owner', 'Agent',
      'nextStep', 'Check purchase evidence internally before asking the customer for a specific fact.'
    );
  elsif outreach_state in ('delivery_failed', 'delivery_unknown', 'policy_suppressed', 'clarification_exhausted', 'manual_fallback') then
    actor_name := 'agent';
    action_code := 'recover_customer_delivery';
    action_label := 'Review the existing customer question and its delivery evidence.';
    blocker := jsonb_build_object(
      'code', coalesce(outreach ->> 'reasonCode', 'customer_contact_unresolved'),
      'owner', 'Agent',
      'nextStep', 'Resolve the existing outreach state without repeating a settled question.'
    );
  elsif stage = 'needs_refund_operations' or reason = 'provider_outcome_unknown' then
    actor_name := 'agent';
    action_code := 'reconcile_provider_outcome';
    action_label := 'Reconcile the exact Nayax attempt; do not retry payment.';
    blocker := jsonb_build_object(
      'code', coalesce(reason, 'provider_outcome_unknown'), 'owner', 'Agent',
      'nextStep', 'Check authoritative evidence for this exact payment attempt before any continuation.'
    );
  elsif stage = 'integrity_hold' then
    actor_name := 'agent';
    action_code := 'reconcile_integrity';
    action_label := 'Repair the saved payment evidence; do not retry payment.';
    blocker := jsonb_build_object(
      'code', coalesce(reason, 'payment_record_mismatch'), 'owner', 'Agent',
      'nextStep', 'Reconcile the immutable receipt and current case state.'
    );
  elsif stage in ('refund_initiated', 'confirming_with_nayax') then
    actor_name := 'system';
    action_code := 'continue_refund';
    action_label := 'Continue the existing authorized refund attempt.';
  elsif p_lifecycle ->> 'preparationPending' = 'true' then
    actor_name := 'agent';
    action_code := 'prepare_manager_decision';
    action_label := 'Complete the purchase research before asking the Manager for a final decision.';
    blocker := jsonb_build_object(
      'code', 'preparation_evidence_pending', 'owner', 'Agent',
      'nextStep', 'Finish or recover the existing purchase research and verify its current evidence.'
    );
  elsif stage = 'awaiting_payout' and reason = 'external_payment_ready'
    and p_lifecycle -> 'managerAction' ->> 'action' = 'mark_external_refund' then
    actor_name := 'manager';
    action_code := 'send_cash_refund_and_confirm';
    action_label := 'Send the cash refund through Zelle and confirm it was sent.';
  elsif stage = 'transaction_confirmed' and p_lifecycle -> 'managerAction' ->> 'action' = 'refund' then
    actor_name := 'manager';
    action_code := 'approve_or_deny_request';
    action_label := 'Approve or deny the prepared refund request.';
  elsif stage = 'needs_transaction_selection'
    and p_lifecycle -> 'managerAction' ->> 'action' = 'refund'
    and p_lifecycle ->> 'reviewedSetPrepared' = 'true' then
    actor_name := 'manager';
    action_code := 'approve_or_deny_request';
    action_label := 'Choose the reviewed purchase if approving, or deny the request.';
  elsif p_lifecycle -> 'managerAction' ->> 'action' = 'resolve_manager_access' then
    actor_name := 'agent';
    action_code := 'resolve_manager_assignment';
    action_label := 'Resolve the assigned Manager access for this machine.';
    blocker := jsonb_build_object(
      'code', 'manager_assignment_unavailable', 'owner', 'Agent',
      'nextStep', 'Verify the machine assignment and restore the existing decision path.'
    );
  elsif stage = 'awaiting_payout' and reason = 'payout_destination_missing' then
    actor_name := 'agent';
    action_code := 'obtain_payout_destination';
    action_label := 'Obtain the missing Zelle destination through the same case.';
  elsif reason = 'internal_mapping_required' then
    actor_name := 'agent';
    action_code := 'repair_provider_setup';
    action_label := 'Correct the saved machine or provider mapping, then check the purchase.';
    blocker := jsonb_build_object(
      'code', 'provider_mapping_required', 'owner', 'Agent',
      'nextStep', 'Correct the verified machine or provider mapping before a read-only check.'
    );
  elsif stage = 'needs_transaction_selection' then
    actor_name := 'agent';
    action_code := 'research_purchase';
    action_label := 'Compare the purchase candidates and prepare one Manager decision.';
  elsif p_lifecycle -> 'lookup' ->> 'status' = 'checking' then
    actor_name := 'system';
    action_code := 'run_lookup';
    action_label := 'Check the purchase through the existing read-only lookup.';
  elsif stage = 'matching' then
    actor_name := 'agent';
    action_code := 'research_purchase';
    action_label := 'Research the purchase and prepare the next safe step.';
    if reason in ('lookup_failed', 'lookup_timed_out', 'lookup_response_limited') then
      blocker := jsonb_build_object(
        'code', reason, 'owner', 'Agent',
        'nextStep', 'Investigate the failed read-only lookup and use the supported recovery path.'
      );
    end if;
  end if;

  -- An SLA target is not proof that a worker is queued. #1429 will fill dueAt
  -- only from a durable executor claim or next eligible execution timestamp.
  return jsonb_build_object(
    'schemaVersion', 'refund_next_work_v1',
    'isOpen', is_open,
    'actor', actor_name,
    'actionCode', action_code,
    'actionLabel', action_label,
    'lastProgressAt', progress_at,
    'dueAt', due_at,
    'blocker', blocker,
    'payloadRedacted', true
  ) || case when actor_name = 'manager'
      and stage = 'needs_transaction_selection'
      and p_lifecycle ->> 'reviewedSetProofId' is not null
      and jsonb_typeof(p_lifecycle -> 'reviewedSetEligibleCandidateTokens') = 'array'
    then jsonb_build_object(
      'preparationProofId', p_lifecycle ->> 'reviewedSetProofId',
      'eligibleCandidateTokens', p_lifecycle -> 'reviewedSetEligibleCandidateTokens'
    )
    else '{}'::jsonb end;
end;
$$;


revoke all on function public.refund_next_work_projection(jsonb, timestamptz)
  from public, anon, authenticated, service_role;
grant execute on function public.refund_next_work_projection(jsonb, timestamptz)
  to service_role;

-- These six legacy cycles stopped before message creation, but were marked as
-- abandoned delivery. Reclassify only an exact still-current no-safe-match
-- cycle after checking there is no customer question or send evidence.
create function public.service_reclassify_unsent_empty_refund_question(
  p_refund_case_id uuid,
  p_follow_up_cycle_id uuid
)
returns jsonb
language plpgsql
security invoker
set search_path = public
as $$
declare
  case_row public.refund_cases%rowtype;
  cycle_row public.refund_follow_up_cycles%rowtype;
begin
  select * into case_row from public.refund_cases
  where id = p_refund_case_id for update;
  select * into cycle_row from public.refund_follow_up_cycles
  where id = p_follow_up_cycle_id and refund_case_id = p_refund_case_id for update;

  if case_row.id is null or cycle_row.id is null
    or case_row.status <> 'needs_review'
    or cycle_row.status <> 'manual_review'
    or cycle_row.reason_code <> 'no_safe_match'
    or cycle_row.failure_code <> 'request_claim_abandoned'
    or cycle_row.case_fact_version <> case_row.deterministic_fact_version
    or cardinality(cycle_row.requested_fields) <> 0
    or cardinality(public.refund_purchase_correction_request_fields(case_row.id)) <> 0
    or cycle_row.request_message_id is not null
    or cycle_row.request_created_at is not null
    or cycle_row.request_sent_at is not null
    or cycle_row.reminder_message_id is not null
    or cycle_row.reminder_sent_at is not null
    or cycle_row.receipt_message_id is not null
    or cycle_row.receipt_sent_at is not null
    or exists (
      select 1 from public.refund_case_messages message
      where message.follow_up_cycle_id = cycle_row.id
    )
  then
    raise exception 'Exact unsent current empty-question cycle required';
  end if;

  update public.refund_follow_up_cycles
  set failure_code = 'pre_message_suppressed:no_customer_correctable_fact',
      updated_at = statement_timestamp()
  where id = cycle_row.id;

  insert into public.refund_case_events(refund_case_id,event_type,message,metadata)
  values (case_row.id,'refund_empty_question_reclassified',
    'An unsent empty customer question was reclassified for internal purchase research.',
    jsonb_build_object('follow_up_cycle_id',cycle_row.id,
      'message_created',false,'customer_send',false,'payload_redacted',true));

  return jsonb_build_object('reclassified',true,'caseId',case_row.id,
    'cycleId',cycle_row.id,'payloadRedacted',true);
end;
$$;

revoke all on function public.service_reclassify_unsent_empty_refund_question(uuid,uuid)
  from public, anon, authenticated, service_role;
grant execute on function public.service_reclassify_unsent_empty_refund_question(uuid,uuid)
  to service_role;
