-- The delivered legacy payout reminder is also a purchase-correction message.
-- Its exhausted payout ledger must not keep projecting a customer answer.
-- Preserve current useful replies/structured submissions and all transport data.
do $exhausted_payout_outreach$
declare
  definition text;
  anchor text := $anchor$  select context.* into context_row
  from public.refund_wallet_correction_contexts context$anchor$;
  replacement text := $replacement$  if result ->> 'state' = 'waiting_for_customer'
    and result ->> 'caseFactVersion' = case_row.deterministic_fact_version::text
    and result -> 'requestedFields' = '["zelle_payment_contact"]'::jsonb
    and nullif(result ->> 'replyReceivedAt', '') is null
    and case_row.case_population <> 'internal_test'
    and case_row.status not in ('approved', 'denied', 'completed', 'closed')
    and case_row.decision is null
    and case_row.payment_method = 'cash'
    and case_row.resolution_method = 'original_payment'
    and case_row.refund_completed_at is null
    and case_row.reporting_adjustment_id is null
    and nullif(btrim(coalesce(case_row.zelle_payment_contact, '')), '') is null
    and not exists (
      select 1 from public.refund_wallet_correction_contexts answered
      where answered.refund_case_id = case_row.id
        and answered.correction_kind = 'purchase'
        and answered.status = 'submitted'
        and coalesce(answered.correction_resulting_fact_version,
          answered.correction_fact_version) = case_row.deterministic_fact_version
        and answered.correction_response is not null
        and answered.correction_response <> '{}'::jsonb
    )
    and exists (
      select 1
      from public.refund_payout_destination_follow_ups follow_up
      join public.refund_case_messages original
        on original.id = follow_up.request_message_id
        and original.refund_case_id = follow_up.refund_case_id
      join public.refund_case_messages reminder
        on reminder.id = follow_up.reminder_message_id
        and reminder.refund_case_id = follow_up.refund_case_id
        and reminder.payout_destination_follow_up_id = follow_up.id
      where follow_up.refund_case_id = case_row.id
        and follow_up.status = 'manual_review'
        and follow_up.manual_review_at >= follow_up.escalation_due_at
        and follow_up.reminder_sent_at is not null
        and reminder.id::text = result ->> 'requestMessageId'
        and original.requested_fields = array['zelle_payment_contact']::text[]
        and original.status = 'sent'
        and original.requested_fields_satisfied_at is null
        and reminder.requested_fields = array['zelle_payment_contact']::text[]
        and reminder.message_type = 'reminder'
        and reminder.template_key = 'refund_payout_destination_reminder_v1'
        and reminder.status = 'sent'
        and reminder.sent_at is not null
        and reminder.requested_fields_satisfied_at is null
        and result ->> 'deliveryState' = 'delivered'
        and not public.is_refund_message_recorded_delivery_failure(to_jsonb(original))
        and not public.is_refund_message_recorded_delivery_failure(to_jsonb(reminder))
    ) then
    return result || jsonb_build_object(
      'state', 'clarification_exhausted', 'owner', 'Refund Operations',
      'nextAction', 'refund_operations', 'reasonCode', 'payout_follow_up_exhausted',
      'manualFallbackEligible', false, 'failureCode', null,
      'payloadRedacted', true
    );
  end if;

  select context.* into context_row
  from public.refund_wallet_correction_contexts context$replacement$;
begin
  definition := replace(pg_get_functiondef(
    'public.refund_customer_outreach_contract(uuid)'::regprocedure), E'\r\n', E'\n');
  if cardinality(string_to_array(definition, anchor)) <> 2 then
    raise exception 'Unexpected submitted-form outreach context anchor';
  end if;
  execute replace(definition, anchor, replacement);
end;
$exhausted_payout_outreach$;

-- Use the existing Agent research action for exhausted contact, rather than
-- suggesting customer delivery recovery when the reminder is already delivered.
do $exhausted_payout_next_work$
declare
  definition text;
  anchor text := '  return base;';
  replacement text := $replacement$  if base ->> 'actor' = 'agent'
    and base ->> 'actionCode' = 'recover_customer_delivery'
    and p_lifecycle #>> '{customerOutreach,reasonCode}' = 'payout_follow_up_exhausted'
    and p_lifecycle #>> '{customerOutreach,state}' = 'clarification_exhausted' then
    return base || jsonb_build_object(
      'actionCode', 'research_purchase',
      'actionLabel', 'Review the exhausted customer question and prepare the next safe step.',
      'blocker', jsonb_build_object(
        'code', 'payout_follow_up_exhausted', 'owner', 'Agent',
        'nextStep', 'Review the existing answers and contact history; do not repeat the question or follow-up.'
      )
    );
  end if;
  return base;$replacement$;
begin
  definition := replace(pg_get_functiondef(
    'public.refund_next_work_projection(jsonb,timestamptz)'::regprocedure), E'\r\n', E'\n');
  if cardinality(string_to_array(definition, anchor)) <> 2 then
    raise exception 'Unexpected canonical next-work wrapper return';
  end if;
  execute replace(definition, anchor, replacement);
end;
$exhausted_payout_next_work$;

select pg_notify('pgrst', 'reload schema');
