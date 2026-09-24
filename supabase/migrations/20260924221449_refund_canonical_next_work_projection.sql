-- Add a truthful actor/action projection without changing the v2 payment or
-- receipt contract. Older clients ignore this additive field during rollout.
create function public.refund_next_work_projection(
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
    when stage in ('duplicate_resolved', 'internal_test_archived', 'denied', 'unable_to_complete') then false
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
  end if;
  if progress_at = '-infinity'::timestamptz then progress_at := null; end if;

  if not is_open then
    actor_name := 'system';
    action_code := 'none';
    action_label := 'No refund or customer-contact action is due.';
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
  elsif stage = 'awaiting_payout' and reason = 'external_payment_ready'
    and p_lifecycle -> 'managerAction' ->> 'action' = 'mark_external_refund' then
    actor_name := 'manager';
    action_code := 'send_cash_refund_and_confirm';
    action_label := 'Send the cash refund through Zelle and confirm it was sent.';
  elsif stage = 'transaction_confirmed' and p_lifecycle -> 'managerAction' ->> 'action' = 'refund' then
    actor_name := 'manager';
    action_code := 'approve_or_deny_request';
    action_label := 'Approve or deny the prepared refund request.';
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
  );
end;
$$;

revoke all on function public.refund_next_work_projection(jsonb, timestamptz)
  from public, anon, authenticated, service_role;
grant execute on function public.refund_next_work_projection(jsonb, timestamptz)
  to service_role;

create function public.refund_next_work_for_case(p_refund_case_id uuid, p_lifecycle jsonb)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  verified_reply_at timestamptz;
  request_sent_at timestamptz := nullif(p_lifecycle -> 'customerOutreach' ->> 'requestSentAt', '')::timestamptz;
  projected_lifecycle jsonb := p_lifecycle;
  current_manager_available boolean := false;
begin
  if p_lifecycle is null then return null; end if;
  -- Lifecycle v2 scopes managerAction to auth.uid(). A service worker has no
  -- manager JWT, so resolve read-only readiness against today's exact-machine
  -- mappings. The notice producer must still authorize each recipient and
  -- mutation against the live case/version; this is never execution authority.
  if auth.uid() is null and p_lifecycle ->> 'stage' in ('awaiting_payout', 'transaction_confirmed') then
    select exists (
      select 1
      from public.refund_cases refund_case
      join public.reporting_machine_refund_managers manager
        on manager.reporting_machine_id = refund_case.reporting_machine_id
      where refund_case.id = p_refund_case_id
        and manager.status = 'active'
        and manager.revoked_at is null
        and public.can_perform_refund_official_action(manager.manager_user_id, refund_case.id)
    ) into current_manager_available;
    if current_manager_available and p_lifecycle ->> 'stage' = 'transaction_confirmed' then
      projected_lifecycle := jsonb_set(p_lifecycle, '{managerAction,action}', '"refund"'::jsonb, true);
    elsif current_manager_available and p_lifecycle ->> 'stage' = 'awaiting_payout'
      and p_lifecycle ->> 'reasonCode' = 'external_payment_ready' then
      projected_lifecycle := jsonb_set(p_lifecycle, '{managerAction,action}', '"mark_external_refund"'::jsonb, true);
    end if;
  end if;
  if request_sent_at is not null then
    select max(message.received_at) into verified_reply_at
    from public.refund_gmail_messages message
    where message.refund_case_id = p_refund_case_id
      and message.direction = 'inbound'
      and message.participant_role = 'customer'
      and message.participant_trust = 'verified'
      and message.received_at > request_sent_at;
  end if;
  return p_lifecycle || jsonb_build_object(
    'nextWork', public.refund_next_work_projection(projected_lifecycle, verified_reply_at)
  );
end;
$$;

revoke all on function public.refund_next_work_for_case(uuid, jsonb)
  from public, anon, authenticated, service_role;
grant execute on function public.refund_next_work_for_case(uuid, jsonb)
  to service_role;

alter function public.refund_lifecycle_contract(uuid)
  rename to refund_lifecycle_contract_pre_next_work_v1;
revoke all on function public.refund_lifecycle_contract_pre_next_work_v1(uuid)
  from public, anon, authenticated, service_role;

create function public.refund_lifecycle_contract(p_refund_case_id uuid)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select public.refund_next_work_for_case(
    p_refund_case_id,
    public.refund_lifecycle_contract_pre_next_work_v1(p_refund_case_id)
  );
$$;
revoke all on function public.refund_lifecycle_contract(uuid)
  from public, anon, authenticated, service_role;
grant execute on function public.refund_lifecycle_contract(uuid) to service_role;

alter function public.get_refund_lifecycle_for_manager(uuid)
  rename to get_refund_lifecycle_for_manager_pre_next_work_v1;
revoke all on function public.get_refund_lifecycle_for_manager_pre_next_work_v1(uuid)
  from public, anon, authenticated, service_role;

create function public.get_refund_lifecycle_for_manager(p_refund_case_id uuid)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select public.refund_next_work_for_case(
    p_refund_case_id,
    public.get_refund_lifecycle_for_manager_pre_next_work_v1(p_refund_case_id)
  );
$$;
revoke all on function public.get_refund_lifecycle_for_manager(uuid)
  from public, anon, service_role;
grant execute on function public.get_refund_lifecycle_for_manager(uuid) to authenticated;

alter function public.admin_get_refund_operations_overview()
  rename to admin_get_refund_operations_overview_pre_next_work_v1;
revoke all on function public.admin_get_refund_operations_overview_pre_next_work_v1()
  from public, anon, authenticated, service_role;

create function public.admin_get_refund_operations_overview()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  base jsonb := public.admin_get_refund_operations_overview_pre_next_work_v1();
  field_name text;
  projected jsonb;
begin
  foreach field_name in array array['cases', 'internalTestCases'] loop
    if jsonb_typeof(base -> field_name) = 'array' then
      select coalesce(jsonb_agg(
        case when item -> 'lifecycle' is null or item -> 'lifecycle' = 'null'::jsonb
          then item
          else jsonb_set(item, '{lifecycle}', public.refund_next_work_for_case(
            nullif(item ->> 'id', '')::uuid, item -> 'lifecycle'
          ), true)
        end order by ordinal
      ), '[]'::jsonb)
      into projected
      from jsonb_array_elements(base -> field_name) with ordinality entry(item, ordinal);
      base := jsonb_set(base, array[field_name], projected, true);
    end if;
  end loop;
  return base;
end;
$$;
revoke all on function public.admin_get_refund_operations_overview()
  from public, anon;
grant execute on function public.admin_get_refund_operations_overview()
  to authenticated, service_role;

comment on function public.refund_next_work_projection(jsonb, timestamptz) is
  'Redacted refund/customer-work actor and action. Manager actions are only the final decision or cash send/confirm; dueAt stays null until backed by durable executor evidence.';
select pg_notify('pgrst', 'reload schema');
