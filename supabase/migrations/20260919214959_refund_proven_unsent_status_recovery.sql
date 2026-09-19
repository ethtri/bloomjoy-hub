-- Release one exact, proven-unsent automatic status action so the normal
-- scheduler can render and send a fresh current-status message after the
-- transport routing fix. This does not resend the failed row, contact a
-- provider, or mutate refund/payment authority.

create or replace function public.service_release_proven_unsent_refund_status(
  p_refund_case_message_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  message_row public.refund_case_messages%rowtype;
  case_row public.refund_cases%rowtype;
  action_row public.refund_automation_actions%rowtype;
  recovery_action_key text;
begin
  if p_refund_case_message_id is null then
    raise exception 'Exact failed refund status message required'
      using errcode = 'P4675';
  end if;

  select message.* into message_row
  from public.refund_case_messages message
  where message.id = p_refund_case_message_id
  for update;

  if message_row.id is null then
    raise exception 'Failed refund status message not found'
      using errcode = 'P4675';
  end if;

  select action.* into action_row
  from public.refund_automation_actions action
  where action.message_id = message_row.id
  for update;

  recovery_action_key := 'recovered-failed-status:' || message_row.id::text;

  -- An exact repeat is a read-only success even if the scheduler has since
  -- advanced the case or sent the replacement message. The immutable recovery
  -- marker proves this specific release already occurred.
  if action_row.id is not null
    and action_row.action_key = recovery_action_key
    and action_row.metadata ->> 'recoverySourceMessageId' = message_row.id::text then
    return jsonb_build_object(
      'released', true,
      'replayed', true,
      'messageId', message_row.id,
      'refundCaseId', message_row.refund_case_id,
      'payloadRedacted', true
    );
  end if;

  select refund_case.* into case_row
  from public.refund_cases refund_case
  where refund_case.id = message_row.refund_case_id
  for update;

  if case_row.id is null
    or case_row.case_population is distinct from 'customer'
    or case_row.status is null
    or case_row.status not in ('submitted', 'needs_review', 'correlated', 'card_refund_pending')
    or case_row.decision is not null
    or message_row.message_type is distinct from 'status_update'
    or message_row.delivery_kind is distinct from 'automatic'
    or message_row.content_source is distinct from 'deterministic_template'
    or message_row.reason_code is distinct from 'sla_at_risk'
    or message_row.template_version is distinct from 'refund_customer_status_v1'
    or message_row.status is distinct from 'failed'
    or message_row.error_message is distinct from 'gmail_source_thread_required'
    or message_row.sent_at is not null
    or message_row.provider_message_id is not null
    or message_row.delivery_transport is not null
    or (message_row.delivery_state is not null and message_row.delivery_state <> 'unknown')
    or message_row.delivery_state_updated_at is not null
    or message_row.manual_delivery_provider_attempted_at is not null
    or exists (
      select 1
      from public.refund_gmail_messages gmail_message
      where gmail_message.refund_case_message_id = message_row.id
    )
    or exists (
      select 1
      from public.refund_case_nayax_refund_attempts attempt
      where attempt.refund_case_id = message_row.refund_case_id
    )
    or exists (
      select 1
      from public.refund_authoritative_receipts receipt
      where receipt.refund_case_id = message_row.refund_case_id
    )
    or not exists (
      select 1
      from public.refund_customer_contact_settings settings
      where settings.singleton
        and settings.automatic_customer_contact_enabled
    )
    or exists (
      select 1
      from public.refund_case_messages later_message
      where later_message.refund_case_id = message_row.refund_case_id
        and later_message.id <> message_row.id
        and later_message.message_type = 'status_update'
        and later_message.reason_code = message_row.reason_code
        and (
          later_message.status = 'sent'
          or later_message.sent_at is not null
          or later_message.provider_message_id is not null
          or later_message.delivery_transport is not null
        )
    )
    or exists (
      select 1
      from public.refund_case_events event
      where event.refund_case_id = message_row.refund_case_id
        and event.event_type = 'customer_status_update_sent'
        and event.metadata ->> 'reason_code' = message_row.reason_code
    )
    or exists (
      select 1
      from public.refund_case_events event
      where event.refund_case_id = message_row.refund_case_id
        and event.event_type = 'customer_status_recovery_released'
        and event.metadata ->> 'source_message_id' <> message_row.id::text
    ) then
    raise exception 'Refund status delivery is not proven unsent'
      using errcode = 'P4675';
  end if;

  if action_row.id is null
    or action_row.action_type is distinct from 'customer_status_update'
    or action_row.status is distinct from 'failed'
    or action_row.reason_category is distinct from 'sla_at_risk_delivery_failed'
    or action_row.action_key is null
    or action_row.action_key not like 'customer_status:sla_at_risk:%' then
    raise exception 'Failed refund status action is not recoverable'
      using errcode = 'P4675';
  end if;

  update public.refund_automation_actions action
  set
    action_key = recovery_action_key,
    metadata = action.metadata || jsonb_build_object(
      'recoverySourceMessageId', message_row.id,
      'recoveryPreviousActionKey', action_row.action_key,
      'recoveryReason', 'proven_unsent_transport_route',
      'payload_redacted', true
    )
  where action.id = action_row.id;

  insert into public.refund_case_events (
    refund_case_id,
    event_type,
    message,
    metadata
  ) values (
    message_row.refund_case_id,
    'customer_status_recovery_released',
    'A proven-unsent automatic status action was released for a fresh scheduler evaluation.',
    jsonb_build_object(
      'source_message_id', message_row.id,
      'reason_code', message_row.reason_code,
      'payload_redacted', true
    )
  );

  return jsonb_build_object(
    'released', true,
    'replayed', false,
    'messageId', message_row.id,
    'refundCaseId', message_row.refund_case_id,
    'payloadRedacted', true
  );
end;
$$;

revoke all on function public.service_release_proven_unsent_refund_status(uuid)
  from public, anon, authenticated;
grant execute on function public.service_release_proven_unsent_refund_status(uuid)
  to service_role;

comment on function public.service_release_proven_unsent_refund_status(uuid) is
  'Service-only exact recovery release for an open customer SLA message proven to have no provider, Gmail, later-send, receipt, or refund-attempt evidence. The normal scheduler re-evaluates current eligibility and creates a new idempotent message; payment execution is untouched.';

select pg_notify('pgrst', 'reload schema');
