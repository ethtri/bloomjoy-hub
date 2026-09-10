-- #1288: expose one durable, redacted customer-outreach state to every
-- lifecycle consumer. The only write path settles an exact claimed cycle when
-- its trusted sender suppresses before message creation. This migration does
-- not send customer mail, call a provider, or change payment state.

create function public.service_settle_refund_follow_up_pre_message_suppression(
  p_refund_case_id uuid,
  p_cycle_id uuid,
  p_reason text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  normalized_reason text := lower(btrim(coalesce(p_reason, '')));
  cycle_row public.refund_follow_up_cycles%rowtype;
  case_row public.refund_cases%rowtype;
  settings_row public.refund_customer_contact_settings%rowtype;
  thread_paused boolean := false;
  current_correctable_fields text[] := '{}'::text[];
  settled_at timestamptz := statement_timestamp();
  expected_failure_code text;
begin
  if normalized_reason not in (
    'automatic_customer_contact_disabled',
    'automatic_customer_contact_paused',
    'no_customer_correctable_fact'
  ) then
    raise exception 'Approved pre-message suppression reason required';
  end if;

  if p_refund_case_id is null or p_cycle_id is null then
    raise exception 'Exact refund case and follow-up cycle are required';
  end if;

  -- Match the automatic-message guard: exact cycle first, then its case. This
  -- makes a concurrent real message insert and suppression mutually exclusive.
  select cycle.* into cycle_row
  from public.refund_follow_up_cycles cycle
  where cycle.id = p_cycle_id
    and cycle.refund_case_id = p_refund_case_id
  for update;
  if cycle_row.id is null then
    raise exception 'Exact refund follow-up cycle not found';
  end if;

  select refund_case.* into case_row
  from public.refund_cases refund_case
  where refund_case.id = p_refund_case_id
  for update;
  if case_row.id is null then raise exception 'Refund case not found'; end if;

  select settings.* into settings_row
  from public.refund_customer_contact_settings settings
  where settings.singleton
  for share;
  if settings_row.singleton is null then
    raise exception 'Durable customer-contact policy is unavailable';
  end if;

  perform 1
  from public.refund_gmail_threads thread
  where thread.refund_case_id = p_refund_case_id
  order by thread.id
  for share;
  thread_paused := exists (
    select 1 from public.refund_gmail_threads thread
    where thread.refund_case_id = p_refund_case_id
      and thread.automatic_customer_contact_paused_at is not null
  );

  -- These durable rows feed refund_purchase_correction_request_fields. Lock
  -- them after cycle/case so the no-correctable assertion cannot race a new
  -- candidate, payment effect, or correction context.
  perform 1 from public.refund_nayax_lookup_candidates candidate
  where candidate.refund_case_id = p_refund_case_id
  order by candidate.token for share;
  perform 1 from public.refund_authoritative_receipts receipt
  where receipt.refund_case_id = p_refund_case_id
  order by receipt.id for share;
  perform 1 from public.refund_case_nayax_refund_attempts attempt
  where attempt.refund_case_id = p_refund_case_id
  order by attempt.id for share;
  perform 1 from public.refund_wallet_correction_contexts correction
  where correction.refund_case_id = p_refund_case_id
  order by correction.id for share;

  current_correctable_fields := coalesce(
    public.refund_purchase_correction_request_fields(p_refund_case_id),
    '{}'::text[]
  );

  expected_failure_code := 'pre_message_suppressed:' || normalized_reason;

  if cycle_row.status = 'manual_review'
    and cycle_row.failure_code = expected_failure_code
    and cycle_row.request_message_id is null then
    return jsonb_build_object(
      'settled', false,
      'idempotentReplay', true,
      'reason', normalized_reason,
      'cycle', public.refund_follow_up_cycle_json(cycle_row),
      'payloadRedacted', true
    );
  end if;

  if cycle_row.status <> 'claimed'
    or cycle_row.request_message_id is not null
    or cycle_row.request_created_at is not null
    or cycle_row.request_sent_at is not null then
    raise exception 'Only an exact still-claimed pre-message cycle can be settled';
  end if;

  if cycle_row.case_fact_version <> case_row.deterministic_fact_version then
    raise exception 'Current follow-up facts are required for suppression settlement';
  end if;

  if normalized_reason = 'automatic_customer_contact_disabled'
    and coalesce(settings_row.automatic_customer_contact_enabled, false) then
    raise exception 'Automatic customer contact is not durably disabled';
  elsif normalized_reason = 'automatic_customer_contact_paused'
    and not thread_paused then
    raise exception 'Automatic customer contact is not durably paused for this case';
  elsif normalized_reason = 'no_customer_correctable_fact'
    and (
      cycle_row.reason_code <> 'no_safe_match'
      or cardinality(current_correctable_fields) <> 0
    ) then
    raise exception 'Current durable facts still expose a customer-correctable field';
  end if;

  update public.refund_follow_up_cycles cycle
  set
    status = 'manual_review',
    failed_at = settled_at,
    failure_code = expected_failure_code
  where cycle.id = cycle_row.id
  returning * into cycle_row;

  update public.refund_cases refund_case
  set
    status = case
      when refund_case.status = 'waiting_on_customer' then 'needs_review'
      else refund_case.status
    end,
    automation_state = case
      when refund_case.status in ('approved', 'denied', 'completed', 'closed')
        then refund_case.automation_state
      else 'under_review'
    end,
    automation_follow_up_due_at = null
  where refund_case.id = p_refund_case_id;

  insert into public.refund_case_events (
    refund_case_id,
    event_type,
    message,
    metadata
  ) values (
    p_refund_case_id,
    'refund_follow_up_pre_message_suppressed',
    'A claimed customer follow-up was suppressed before any message was created and was routed to Refund Operations.',
    jsonb_build_object(
      'follow_up_cycle_id', cycle_row.id,
      'suppression_reason', normalized_reason,
      'message_created', false,
      'payload_redacted', true
    )
  );

  return jsonb_build_object(
    'settled', true,
    'idempotentReplay', false,
    'reason', normalized_reason,
    'cycle', public.refund_follow_up_cycle_json(cycle_row),
    'payloadRedacted', true
  );
end;
$$;

revoke all on function public.service_settle_refund_follow_up_pre_message_suppression(uuid, uuid, text)
  from public, anon, authenticated, service_role;
grant execute on function public.service_settle_refund_follow_up_pre_message_suppression(uuid, uuid, text)
  to service_role;

comment on function public.service_settle_refund_follow_up_pre_message_suppression(uuid, uuid, text) is
  'Idempotently fails closed an exact still-claimed follow-up when the sender suppresses before creating a message.';

create function public.refund_customer_outreach_contract(
  p_refund_case_id uuid
)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  case_row public.refund_cases%rowtype;
  cycle_row public.refund_follow_up_cycles%rowtype;
  request_row public.refund_case_messages%rowtype;
  correction_row public.refund_wallet_correction_contexts%rowtype;
  action_row public.refund_automation_actions%rowtype;
  fallback_action_row public.refund_automation_actions%rowtype;
  workflow_kind text;
  workflow_id uuid;
  contact_enabled boolean := false;
  thread_paused boolean := false;
  gmail_delivered boolean := false;
  terminal_delivery_failure boolean := false;
  effective_delivery_state text;
  current_fields text[] := '{}'::text[];
  requested_fields text[] := '{}'::text[];
  state text := 'none';
  owner_name text := 'None';
  next_action text := 'none';
  manual_fallback_eligible boolean := false;
  reason_code text;
  failure_code text;
  clarification_count integer := 0;
  recheck_started_at timestamptz;
begin
  select refund_case.* into case_row
  from public.refund_cases refund_case
  where refund_case.id = p_refund_case_id;

  if case_row.id is null then
    return null;
  end if;

  select coalesce(settings.automatic_customer_contact_enabled, false)
  into contact_enabled
  from public.refund_customer_contact_settings settings
  where settings.singleton;

  thread_paused := exists (
    select 1
    from public.refund_gmail_threads thread
    where thread.refund_case_id = case_row.id
      and thread.automatic_customer_contact_paused_at is not null
  );

  current_fields := coalesce(
    public.refund_purchase_correction_request_fields(case_row.id),
    '{}'::text[]
  );

  -- Pick one causal workflow. Fact version wins; time and id only break ties.
  -- Never splice a cycle's status/message together with an unrelated purchase
  -- correction's reply or recheck state.
  select candidate.kind, candidate.id
  into workflow_kind, workflow_id
  from (
    select 'cycle'::text as kind, cycle.id,
      cycle.case_fact_version as fact_version, cycle.created_at as started_at
    from public.refund_follow_up_cycles cycle
    where cycle.refund_case_id = case_row.id
    union all
    select 'correction'::text, correction.id,
      coalesce(
        correction.correction_resulting_fact_version,
        correction.correction_fact_version,
        0
      ), correction.issued_at
    from public.refund_wallet_correction_contexts correction
    where correction.refund_case_id = case_row.id
      and correction.correction_kind = 'purchase'
      and correction.status in ('pending', 'submitted')
  ) candidate
  order by candidate.fact_version desc, candidate.started_at desc,
    candidate.kind desc, candidate.id desc
  limit 1;

  if workflow_kind = 'cycle' then
    select cycle.* into cycle_row
    from public.refund_follow_up_cycles cycle
    where cycle.id = workflow_id;
    clarification_count := coalesce(cycle_row.cycle_number, 0);
  elsif workflow_kind = 'correction' then
    select correction.* into correction_row
    from public.refund_wallet_correction_contexts correction
    where correction.id = workflow_id;
    select least(count(*)::integer, 2)
    into clarification_count
    from public.refund_wallet_correction_contexts correction
    where correction.refund_case_id = case_row.id
      and correction.correction_kind = 'purchase'
      and correction.status in ('pending', 'submitted')
      and coalesce(
        correction.correction_resulting_fact_version,
        correction.correction_fact_version,
        0
      ) <= coalesce(
        correction_row.correction_resulting_fact_version,
        correction_row.correction_fact_version,
        0
      );
  end if;

  select action.* into action_row
  from public.refund_automation_actions action
  where action.refund_case_id = case_row.id
    and workflow_kind = 'cycle'
    and action.action_type = 'customer_reply_recheck'
    and action.action_key like '%' || cycle_row.id::text || '%'
  order by action.attempted_at desc, action.id desc
  limit 1;

  -- The scheduler's existing action journal is the only authority for this
  -- narrow manager handoff. The exact key binds the completed review to this
  -- case and its current deterministic facts; no free-form metadata grants it.
  select action.* into fallback_action_row
  from public.refund_automation_actions action
  where action.refund_case_id = case_row.id
    and action.action_type = 'internal_escalation'
    and action.status = 'completed'
    and action.action_key = 'follow_up_review:' || case_row.id::text
      || ':cash-no-match-incomplete:'
      || case_row.deterministic_fact_version::text
  order by action.completed_at desc, action.id desc
  limit 1;

  if cycle_row.request_message_id is not null then
    select message.* into request_row
    from public.refund_case_messages message
    where message.id = cycle_row.request_message_id
      and message.refund_case_id = case_row.id
      and message.follow_up_cycle_id = cycle_row.id;
  elsif correction_row.correction_message_id is not null then
    select message.* into request_row
    from public.refund_case_messages message
    where message.id = correction_row.correction_message_id
      and message.refund_case_id = case_row.id;
  end if;

  requested_fields := public.canonical_refund_follow_up_fields(
    case
      when request_row.id is not null then request_row.requested_fields
      when cycle_row.id is not null then cycle_row.requested_fields
      else current_fields
    end
  );

  if request_row.id is not null then
    gmail_delivered := exists (
      select 1
      from public.refund_gmail_messages gmail_message
      where gmail_message.refund_case_message_id = request_row.id
        and gmail_message.refund_case_id = case_row.id
        and gmail_message.direction = 'outbound'
        and gmail_message.status = 'sent'
        and gmail_message.sent_at is not null
        and nullif(btrim(gmail_message.provider_message_id), '') is not null
    );
    terminal_delivery_failure :=
      public.is_refund_message_recorded_delivery_failure(to_jsonb(request_row));
    effective_delivery_state := case
      when gmail_delivered then 'delivered'
      when request_row.delivery_transport = 'resend'
        and request_row.delivery_state = 'accepted'
        and request_row.delivery_state_updated_at <
          statement_timestamp() - interval '15 minutes'
        then 'unknown'
      else request_row.delivery_state
    end;
  end if;

  -- Terminal and synthetic cases cannot own fresh customer outreach.
  if case_row.case_population = 'internal_test'
    or case_row.status in ('approved', 'denied', 'completed', 'closed')
    or case_row.decision is not null
    or case_row.refund_completed_at is not null
    or case_row.reporting_adjustment_id is not null then
    state := 'none';
  elsif action_row.action_type = 'customer_reply_recheck'
    and action_row.status = 'claimed' then
    state := 'rechecking';
    owner_name := 'System';
    next_action := 'recheck_customer_reply';
    reason_code := 'customer_reply_recheck_claimed';
    recheck_started_at := action_row.attempted_at;
  elsif correction_row.status = 'submitted'
    and correction_row.correction_recheck_state = 'in_progress' then
    state := 'rechecking';
    owner_name := 'System';
    next_action := 'recheck_customer_reply';
    reason_code := 'purchase_correction_recheck_in_progress';
    recheck_started_at := correction_row.updated_at;
  elsif cycle_row.status = 'customer_replied'
    or (
      correction_row.status = 'submitted'
      and correction_row.correction_next_action = 'recheck'
      and correction_row.correction_recheck_state = 'pending'
    ) then
    state := 'customer_replied';
    owner_name := 'System';
    next_action := 'recheck_customer_reply';
    reason_code := 'customer_reply_received';
  elsif terminal_delivery_failure then
    state := 'delivery_failed';
    owner_name := 'Refund Operations';
    next_action := 'refund_operations';
    reason_code := 'request_delivery_failed';
    failure_code := effective_delivery_state;
  elsif request_row.id is not null
    and (
      request_row.manual_delivery_state = 'delivery_unknown'
      or effective_delivery_state = 'deferred'
      or (
        effective_delivery_state = 'unknown'
        and (
          request_row.status = 'sent'
          or request_row.provider_message_id is not null
          or request_row.manual_delivery_provider_attempted_at is not null
        )
      )
      or (
        request_row.status = 'failed'
        and (
          request_row.provider_message_id is not null
          or request_row.manual_delivery_provider_attempted_at is not null
        )
      )
    ) then
    state := 'delivery_unknown';
    owner_name := 'Refund Operations';
    next_action := 'refund_operations';
    reason_code := 'request_delivery_unknown';
    failure_code := 'delivery_unknown';
  elsif request_row.id is not null and request_row.status in ('failed', 'skipped') then
    state := 'delivery_failed';
    owner_name := 'Refund Operations';
    next_action := 'refund_operations';
    reason_code := 'request_delivery_failed';
    failure_code := coalesce(cycle_row.failure_code, 'customer_message_failed');
  elsif request_row.id is not null
    and request_row.delivery_kind = 'automatic'
    and request_row.status = 'pending'
    and request_row.provider_message_id is null
    and request_row.manual_delivery_provider_attempted_at is null
    and (not contact_enabled or thread_paused) then
    state := 'policy_suppressed';
    owner_name := 'Refund Operations';
    next_action := 'refund_operations';
    reason_code := case
      when thread_paused then 'automatic_customer_contact_paused'
      else 'automatic_customer_contact_disabled'
    end;
  elsif request_row.id is not null
    and (
      request_row.status = 'pending'
      or request_row.manual_delivery_state in ('queued', 'claimed')
    ) then
    state := 'queued';
    owner_name := 'System';
    next_action := 'wait_for_delivery';
    reason_code := 'request_queued';
  elsif request_row.id is not null
    and (gmail_delivered or effective_delivery_state = 'delivered') then
    state := 'waiting_for_customer';
    owner_name := 'Customer';
    next_action := 'wait_for_customer';
    reason_code := 'request_delivered';
  elsif request_row.id is not null and request_row.status = 'sent' then
    state := 'sent_unconfirmed';
    owner_name := 'System';
    next_action := 'wait_for_delivery';
    reason_code := 'request_sent_delivery_unconfirmed';
  elsif cycle_row.status = 'claimed' then
    if not contact_enabled or thread_paused then
      state := 'policy_suppressed';
      owner_name := 'Refund Operations';
      next_action := 'refund_operations';
      reason_code := case
        when thread_paused then 'automatic_customer_contact_paused'
        else 'automatic_customer_contact_disabled'
      end;
    else
      state := 'preparing';
      owner_name := 'System';
      next_action := 'wait_for_queue';
      reason_code := 'request_claimed';
    end if;
  elsif clarification_count >= 2
    and coalesce(cycle_row.case_fact_version, 0) >= case_row.deterministic_fact_version then
    state := 'clarification_exhausted';
    owner_name := 'Refund Operations';
    next_action := 'refund_operations';
    reason_code := 'contact_limit_reached';
  elsif not contact_enabled or thread_paused then
    if cardinality(current_fields) > 0
      or workflow_id is not null
      or case_row.status = 'waiting_on_customer'
      or case_row.automation_state = 'more_info_needed' then
      state := 'policy_suppressed';
      owner_name := 'Refund Operations';
      next_action := 'refund_operations';
      reason_code := case
        when thread_paused then 'automatic_customer_contact_paused'
        else 'automatic_customer_contact_disabled'
      end;
    end if;
  elsif fallback_action_row.id is not null
    and case_row.payment_method = 'cash'
    and case_row.correlation_status = 'no_match'
    and case_row.correlation_source = 'sunze'
    and nullif(btrim(coalesce(case_row.correlation_summary, '')), '') is not null
    and case_row.cash_match_evaluated_fact_version = case_row.deterministic_fact_version
    and case_row.matched_sales_fact_id is null
    and cardinality(current_fields) > 0
    and clarification_count < 2
    and not exists (
      select 1 from public.refund_follow_up_cycles current_cycle
      where current_cycle.refund_case_id = case_row.id
        and current_cycle.case_fact_version = case_row.deterministic_fact_version
    )
    and not exists (
      select 1 from public.refund_wallet_correction_contexts current_correction
      where current_correction.refund_case_id = case_row.id
        and current_correction.correction_kind = 'purchase'
        and current_correction.status in ('pending', 'submitted')
        and coalesce(
          current_correction.correction_resulting_fact_version,
          current_correction.correction_fact_version,
          0
        ) = case_row.deterministic_fact_version
    ) then
    state := 'manual_fallback';
    owner_name := 'Machine Manager';
    next_action := 'request_details';
    manual_fallback_eligible := true;
    requested_fields := current_fields;
    reason_code := 'cash_no_match_incomplete_review_completed';
  elsif cycle_row.status = 'manual_review'
    and cycle_row.failure_code in (
      'pre_message_suppressed:automatic_customer_contact_disabled',
      'pre_message_suppressed:automatic_customer_contact_paused',
      'pre_message_suppressed:no_customer_correctable_fact'
    ) then
    state := 'policy_suppressed';
    owner_name := 'Refund Operations';
    next_action := 'refund_operations';
    reason_code := replace(cycle_row.failure_code, 'pre_message_suppressed:', '');
    failure_code := cycle_row.failure_code;
  elsif cycle_row.status in ('failed', 'manual_review')
    or (
      correction_row.status = 'submitted'
      and correction_row.correction_next_action = 'review'
    ) then
    state := 'delivery_failed';
    owner_name := 'Refund Operations';
    next_action := 'refund_operations';
    reason_code := 'automatic_follow_up_exception';
    failure_code := coalesce(
      cycle_row.failure_code,
      case
        when correction_row.correction_recheck_state in ('failed', 'not_ready', 'stale')
          then 'customer_reply_recheck_' || correction_row.correction_recheck_state
        else 'manual_review_required'
      end
    );
  end if;

  return jsonb_build_object(
    'schemaVersion', 'refund_customer_outreach_v1',
    'state', state,
    'owner', owner_name,
    'nextAction', next_action,
    'manualFallbackEligible', manual_fallback_eligible,
    'requestedFields', to_jsonb(requested_fields),
    'requestMessageId', request_row.id,
    'cycleId', cycle_row.id,
    'cycleNumber', cycle_row.cycle_number,
    'caseFactVersion', case_row.deterministic_fact_version,
    'clarificationAttemptCount', clarification_count,
    'clarificationLimit', 2,
    'requestCreatedAt', coalesce(cycle_row.request_created_at, request_row.created_at),
    'requestSentAt', coalesce(cycle_row.request_sent_at, request_row.sent_at),
    'deliveryState', effective_delivery_state,
    'deliveryStateUpdatedAt', request_row.delivery_state_updated_at,
    'replyReceivedAt', coalesce(cycle_row.reply_received_at, correction_row.consumed_at),
    'recheckStartedAt', coalesce(recheck_started_at, cycle_row.recheck_claimed_at),
    'reasonCode', reason_code,
    'failureCode', failure_code,
    'payloadRedacted', true
  );
end;
$$;

revoke all on function public.refund_customer_outreach_contract(uuid)
  from public, anon, authenticated, service_role;
grant execute on function public.refund_customer_outreach_contract(uuid)
  to service_role;

comment on function public.refund_customer_outreach_contract(uuid) is
  'Redacted durable state for the exact customer request, reply, recheck, suppression, and bounded clarification ownership.';

create function public.refund_apply_customer_outreach_to_lifecycle(
  p_lifecycle jsonb,
  p_outreach jsonb
)
returns jsonb
language plpgsql
immutable
set search_path = ''
as $$
declare
  result jsonb := coalesce(p_lifecycle, '{}'::jsonb)
    || jsonb_build_object('customerOutreach', p_outreach);
  outreach_state text := p_outreach ->> 'state';
  outreach_owner text := p_outreach ->> 'owner';
  outreach_action text := p_outreach ->> 'nextAction';
  queue_label text;
begin
  if outreach_state is null or outreach_state = 'none' then
    return result;
  end if;

  queue_label := case outreach_state
    when 'preparing' then 'Preparing customer request'
    when 'queued' then 'Customer request queued'
    when 'sent_unconfirmed' then 'Customer request sent · confirming delivery'
    when 'waiting_for_customer' then 'Waiting for customer'
    when 'customer_replied' then 'Customer replied · recheck queued'
    when 'rechecking' then 'Rechecking customer information'
    when 'manual_fallback' then 'Customer details need manager request'
    else 'Needs Refund Operations'
  end;

  result := result || jsonb_build_object(
    'managerAction', jsonb_build_object(
      'action', case
        when outreach_state = 'manual_fallback' then 'request_details'
        when outreach_owner = 'Refund Operations' then 'refund_operations'
        else 'none'
      end,
      'owner', outreach_owner,
      'safeRetryEligible', false,
      'payloadRedacted', true
    ),
    'managerNextAction', outreach_action,
    'managerQueue', coalesce(result -> 'managerQueue', '{}'::jsonb)
      || jsonb_build_object(
        'bucket', case
          when outreach_state = 'manual_fallback' then 'needs_action'
          when outreach_owner = 'Refund Operations' then 'provider_hold'
          else 'in_progress'
        end,
        'label', queue_label,
        'nextAction', outreach_action,
        'safeRetryEligible', false,
        'customerActionFields', p_outreach -> 'requestedFields',
        'payloadRedacted', true
      )
  );

  if outreach_owner = 'Refund Operations' then
    result := result || jsonb_build_object(
      'operations', coalesce(result -> 'operations', '{}'::jsonb)
        || jsonb_build_object(
          'required', true,
          'owner', 'Refund Operations',
          'failureClass', p_outreach ->> 'failureCode',
          'nextStep', outreach_action
        )
    );
  end if;

  return result;
end;
$$;

revoke all on function public.refund_apply_customer_outreach_to_lifecycle(jsonb, jsonb)
  from public, anon, authenticated, service_role;
grant execute on function public.refund_apply_customer_outreach_to_lifecycle(jsonb, jsonb)
  to service_role;

alter function public.refund_lifecycle_contract(uuid)
  rename to refund_lifecycle_contract_pre_customer_outreach_v1;
revoke all on function public.refund_lifecycle_contract_pre_customer_outreach_v1(uuid)
  from public, anon, authenticated, service_role;

create function public.refund_lifecycle_contract(p_refund_case_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  base jsonb;
  outreach jsonb;
begin
  base := public.refund_lifecycle_contract_pre_customer_outreach_v1(
    p_refund_case_id
  );
  if base is null then return null; end if;
  outreach := public.refund_customer_outreach_contract(p_refund_case_id);
  return public.refund_apply_customer_outreach_to_lifecycle(base, outreach);
end;
$$;

revoke all on function public.refund_lifecycle_contract(uuid)
  from public, anon, authenticated, service_role;
grant execute on function public.refund_lifecycle_contract(uuid)
  to service_role;

comment on function public.refund_lifecycle_contract(uuid) is
  'Canonical lifecycle with exact durable customer-outreach state and ownership.';

-- Keep the authenticated detail boundary authoritative even when a later
-- forward-only migration replaces the canonical lifecycle implementation.
-- The wrapped reader still owns authentication, case scope, schema checks,
-- and receipt redaction; this outer layer adds the same outreach projection
-- and operations-only failure detail as the overview boundary.
alter function public.get_refund_lifecycle_for_manager(uuid)
  rename to get_refund_lifecycle_for_manager_pre_customer_outreach_v1;
revoke all on function public.get_refund_lifecycle_for_manager_pre_customer_outreach_v1(uuid)
  from public, anon, authenticated, service_role;

create function public.get_refund_lifecycle_for_manager(
  p_refund_case_id uuid
)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  base jsonb := public.get_refund_lifecycle_for_manager_pre_customer_outreach_v1(
    p_refund_case_id
  );
  outreach jsonb := public.refund_customer_outreach_contract(p_refund_case_id);
  has_operations_access boolean := auth.uid() is not null
    and public.is_super_admin(auth.uid()) is true;
begin
  if outreach is null then return base; end if;
  if not has_operations_access then
    outreach := jsonb_set(outreach, '{failureCode}', 'null'::jsonb, true);
  end if;
  return public.refund_apply_customer_outreach_to_lifecycle(base, outreach);
end;
$$;

revoke all on function public.get_refund_lifecycle_for_manager(uuid)
  from public, anon, service_role;
grant execute on function public.get_refund_lifecycle_for_manager(uuid)
  to authenticated;

comment on function public.get_refund_lifecycle_for_manager(uuid) is
  'Actor-scoped lifecycle detail with role-safe durable customer-outreach truth.';

create function public.refund_project_customer_outreach_cases_for_manager(
  p_cases jsonb,
  p_has_operations_access boolean
)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  projected_cases jsonb := '[]'::jsonb;
  item jsonb;
  outreach jsonb;
  lifecycle jsonb;
begin
  for item in
    select value
    from jsonb_array_elements(coalesce(p_cases, '[]'::jsonb))
  loop
    outreach := public.refund_customer_outreach_contract(
      nullif(item ->> 'id', '')::uuid
    );
    if outreach is not null then
      if not coalesce(p_has_operations_access, false) then
        outreach := jsonb_set(
          outreach,
          '{failureCode}',
          'null'::jsonb,
          true
        );
      end if;
      lifecycle := public.refund_apply_customer_outreach_to_lifecycle(
        item -> 'lifecycle',
        outreach
      );
      item := jsonb_set(item, '{lifecycle}', lifecycle, true);
    end if;
    projected_cases := projected_cases || jsonb_build_array(item);
  end loop;
  return projected_cases;
end;
$$;

revoke all on function public.refund_project_customer_outreach_cases_for_manager(jsonb, boolean)
  from public, anon, authenticated, service_role;
grant execute on function public.refund_project_customer_outreach_cases_for_manager(jsonb, boolean)
  to service_role;

alter function public.admin_get_refund_operations_overview()
  rename to admin_get_refund_operations_overview_pre_customer_outreach_v1;
revoke all on function public.admin_get_refund_operations_overview_pre_customer_outreach_v1()
  from public, anon, authenticated, service_role;

create function public.admin_get_refund_operations_overview()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  base jsonb := public.admin_get_refund_operations_overview_pre_customer_outreach_v1();
  has_operations_access boolean := coalesce(
    (base ->> 'refundOperationsAccess')::boolean,
    false
  );
begin
  if jsonb_typeof(base -> 'cases') = 'array' then
    base := jsonb_set(
      base,
      '{cases}',
      public.refund_project_customer_outreach_cases_for_manager(
        base -> 'cases',
        has_operations_access
      ),
      true
    );
  end if;
  if jsonb_typeof(base -> 'internalTestCases') = 'array' then
    base := jsonb_set(
      base,
      '{internalTestCases}',
      public.refund_project_customer_outreach_cases_for_manager(
        base -> 'internalTestCases',
        has_operations_access
      ),
      true
    );
  end if;
  return base || jsonb_build_object(
    'customerOutreachContractVersion',
    'refund_customer_outreach_v1'
  );
end;
$$;

revoke all on function public.admin_get_refund_operations_overview()
  from public, anon;
grant execute on function public.admin_get_refund_operations_overview()
  to authenticated, service_role;

comment on function public.admin_get_refund_operations_overview() is
  'Actor-scoped refund overview with server-owned Nayax recovery and role-safe durable customer-outreach truth.';

select pg_notify('pgrst', 'reload schema');
