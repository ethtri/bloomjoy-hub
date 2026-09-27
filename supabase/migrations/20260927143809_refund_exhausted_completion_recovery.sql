-- One operator-controlled recovery after the automatic completion retry was
-- exhausted without a provider attempt. This prepares the original saved
-- message; it cannot initiate or repeat a Nayax refund.
create function public.service_prepare_exhausted_nayax_completion_recovery(
  p_executor_assertion text,
  p_refund_case_message_id uuid,
  p_original_thread_history_id text,
  p_actor_user_id uuid
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
  thread_row public.refund_gmail_threads%rowtype;
begin
  perform public.assert_nayax_provider_executor(p_executor_assertion);

  if p_refund_case_message_id is null
    or p_original_thread_history_id !~ '^[0-9]{3,30}$' then
    raise exception 'Exact completion and reviewed original-thread history required';
  end if;

  select * into message_row from public.refund_case_messages
    where id = p_refund_case_message_id for update;
  select * into attempt_row from public.refund_case_nayax_refund_attempts
    where id = message_row.nayax_refund_attempt_id for update;
  select * into case_row from public.refund_cases
    where id = message_row.refund_case_id for share;
  select * into thread_row from public.refund_gmail_threads
    where id = attempt_row.completion_gmail_thread_id
      and refund_case_id = case_row.id for share;

  if message_row.id is null
    or message_row.message_type is distinct from 'completed'
    or message_row.template_version is distinct from 'refund_nayax_completion_v2'
    or message_row.status is distinct from 'failed'
    or message_row.error_message is distinct from 'gmail_completion_retry_exhausted'
    or message_row.sent_at is not null
    or message_row.provider_message_id is not null
    or message_row.delivery_transport is not null
    or message_row.manual_delivery_provider_attempted_at is not null
    or attempt_row.id is null
    or attempt_row.refund_case_id is distinct from case_row.id
    or attempt_row.completion_message_id is distinct from message_row.id
    or attempt_row.completion_delivery_status is distinct from 'failed'
    or attempt_row.completion_delivery_retry_count is distinct from 1
    or attempt_row.status is distinct from 'succeeded'
    or attempt_row.provider_outcome is distinct from 'success'
    or attempt_row.reconciliation_required
    or attempt_row.reporting_adjustment_id is null
    or attempt_row.case_finalization_committed_at is null
    or case_row.status is distinct from 'completed'
    or case_row.reporting_adjustment_id is distinct from attempt_row.reporting_adjustment_id
    or not public.can_manage_refund_case(p_actor_user_id, case_row.id)
    or lower(btrim(message_row.recipient_email)) is distinct from
      lower(btrim(case_row.customer_email))
    or thread_row.id is null
    or not exists (
      select 1 from public.refund_gmail_messages outbound
      where outbound.refund_case_id = case_row.id
        and outbound.gmail_thread_id = thread_row.id
        and outbound.direction = 'outbound'
        and outbound.status = 'sent'
        and outbound.sent_at is not null
        and outbound.provider_message_id is not null
    )
    or exists (
      select 1 from public.refund_gmail_messages outbound
      where outbound.refund_case_message_id = message_row.id
        or outbound.operation_key = 'refund-case-message:' || message_row.id::text
    )
    or exists (
      select 1 from public.refund_case_events event
      where event.refund_case_id = case_row.id
        and event.event_type = 'nayax_customer_completion_exhausted_recovery_prepared'
        and event.metadata ->> 'refund_case_message_id' = message_row.id::text
    ) then
    raise exception 'Exhausted completion requires exact unsent evidence and an unused recovery';
  end if;

  update public.refund_case_messages
    set status = 'pending', error_message = null
    where id = message_row.id;
  update public.refund_case_nayax_refund_attempts
    set completion_delivery_status = 'pending',
      completion_delivery_attempted_at = statement_timestamp()
    where id = attempt_row.id;

  insert into public.refund_case_events (
    refund_case_id, actor_user_id, event_type, message, metadata
  ) values (
    case_row.id, p_actor_user_id,
    'nayax_customer_completion_exhausted_recovery_prepared',
    'The original completion message was prepared once after exact unsent evidence and original-thread review. No refund or email was sent by preparation.',
    jsonb_build_object(
      'attempt_id', attempt_row.id,
      'refund_case_message_id', message_row.id,
      'original_thread_history_id', p_original_thread_history_id,
      'retry_count', 1,
      'provider_call_made', false,
      'customer_message_sent', false,
      'payload_redacted', true
    )
  );

  return jsonb_build_object(
    'prepared', true,
    'refundCaseId', case_row.id,
    'refundCaseMessageId', message_row.id,
    'attemptId', attempt_row.id,
    'gmailThreadId', thread_row.id,
    'recipientEmail', case_row.customer_email,
    'subject', message_row.subject,
    'body', message_row.body,
    'retryCount', 1,
    'originalThread', true,
    'exhaustedRecovery', true,
    'payloadRedacted', true
  );
end;
$$;

revoke all on function public.service_prepare_exhausted_nayax_completion_recovery(text,uuid,text,uuid)
  from public, anon, authenticated;
grant execute on function public.service_prepare_exhausted_nayax_completion_recovery(text,uuid,text,uuid)
  to service_role;
