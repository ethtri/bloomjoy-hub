-- Allow one reviewed current-copy amendment for a proven-unsent exhausted
-- Nayax completion. The original message id, payment attempt, recipient, and
-- Gmail thread remain fixed. Preparation cannot call Nayax or Gmail.

drop function if exists public.service_prepare_exhausted_nayax_completion_recovery(
  text, uuid, text, uuid
);

create or replace function public.canonicalize_refund_outcome_customer_copy()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  case_row public.refund_cases;
  greeting_break integer;
  amount_token text;
  required_opening constant text :=
    'Good news—your refund request was approved, and your refund is on its way.';
begin
  if new.message_type <> 'completed'
    or coalesce(new.template_version, '') <> 'refund_nayax_completion_v2' then
    return new;
  end if;

  select refund_case.* into case_row
  from public.refund_cases refund_case
  where refund_case.id = new.refund_case_id;

  if case_row.id is null
    or case_row.status <> 'completed'
    or case_row.decision <> 'approved'
    or case_row.refund_completed_at is null then
    raise exception 'Confirmed completion required for customer success copy';
  end if;

  if new.template_key = 'refund_nayax_completed_current_v1' then
    amount_token := '$' || to_char(
      coalesce(case_row.refund_amount_cents, case_row.payment_amount_cents)::numeric / 100,
      'FM999999990.00'
    );
    if lower(new.body) like '%on its way%'
      or lower(new.body) ~ 'business[[:space:]]+days?'
      or position('Nayax confirmed your ' || amount_token || ' refund on ' in new.body) = 0
      or new.body !~ 'Nayax confirmed your [$][0-9]+[.][0-9]{2} refund on [A-Z][a-z]+ ([1-9]|[12][0-9]|3[01])[.]'
      or position(case_row.public_reference in new.body) = 0 then
      raise exception 'Current completion recovery copy is not safe';
    end if;
    return new;
  end if;

  if position(required_opening in coalesce(new.body, '')) = 0 then
    greeting_break := position(E'\n\n' in coalesce(new.body, ''));
    new.body := case
      when greeting_break > 0 then
        left(new.body, greeting_break - 1) || E'\n\n' || required_opening ||
          E'\n\n' || substring(new.body from greeting_break + 2)
      else required_opening || E'\n\n' || coalesce(new.body, '')
    end;
  end if;
  return new;
end;
$$;

create function public.service_prepare_exhausted_nayax_completion_recovery(
  p_executor_assertion text,
  p_refund_case_message_id uuid,
  p_original_thread_history_id text,
  p_actor_user_id uuid,
  p_replacement_subject text,
  p_replacement_body text
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
  normalized_subject text := btrim(coalesce(p_replacement_subject, ''));
  normalized_body text := btrim(coalesce(p_replacement_body, ''));
  amount_token text;
  copy_digest text;
begin
  perform public.assert_nayax_provider_executor(p_executor_assertion);

  if p_refund_case_message_id is null
    or p_original_thread_history_id !~ '^[0-9]{3,30}$'
    or normalized_subject = ''
    or length(normalized_subject) > 180
    or normalized_subject !~* '^re:[[:space:]]+'
    or normalized_body = ''
    or length(normalized_body) > 4000
    or lower(normalized_body) like '%on its way%'
    or lower(normalized_body) ~ 'business[[:space:]]+days?' then
    raise exception 'Exact completion, current reviewed copy, and original-thread history required';
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

  amount_token := '$' || to_char(
    coalesce(case_row.refund_amount_cents, case_row.payment_amount_cents)::numeric / 100,
    'FM999999990.00'
  );

  if position('Nayax confirmed your ' || amount_token || ' refund on ' in normalized_body) = 0
    or normalized_body !~ 'Nayax confirmed your [$][0-9]+[.][0-9]{2} refund on [A-Z][a-z]+ ([1-9]|[12][0-9]|3[01])[.]' then
    raise exception 'Reviewed copy must contain the canonical positive confirmation sentence';
  end if;

  if message_row.id is null
    or message_row.message_type is distinct from 'completed'
    or message_row.template_version is distinct from 'refund_nayax_completion_v2'
    or message_row.template_key is distinct from 'refund_nayax_completed_v2'
    or message_row.content_source is distinct from 'deterministic_template'
    or message_row.status is distinct from 'failed'
    or message_row.error_message is distinct from 'gmail_completion_retry_exhausted'
    or message_row.sent_at is not null
    or message_row.provider_message_id is not null
    or message_row.delivery_transport is not null
    or message_row.delivery_state is distinct from 'unknown'
    or message_row.delivery_state_updated_at is not null
    or message_row.manual_delivery_provider_attempted_at is not null
    or message_row.manual_delivery_attempt_count is distinct from 0
    or normalized_body is not distinct from btrim(message_row.body)
    or case_row.id is null
    or position(case_row.public_reference in normalized_body) = 0
    or position(amount_token in normalized_body) = 0
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
    or case_row.decision is distinct from 'approved'
    or case_row.refund_completed_at is null
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
    raise exception 'Exhausted completion requires exact unsent evidence, current copy, and an unused recovery';
  end if;

  copy_digest := encode(extensions.digest(convert_to(
    jsonb_build_array(normalized_subject, normalized_body)::text,
    'UTF8'
  ), 'sha256'), 'hex');

  update public.refund_case_messages
    set status = 'pending',
      error_message = null,
      subject = normalized_subject,
      body = normalized_body,
      template_key = 'refund_nayax_completed_current_v1'
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
    'The original completion message was amended with reviewed current copy and prepared once after exact unsent evidence and original-thread review. No refund or email was sent by preparation.',
    jsonb_build_object(
      'attempt_id', attempt_row.id,
      'refund_case_message_id', message_row.id,
      'original_thread_history_id', p_original_thread_history_id,
      'copy_sha256', copy_digest,
      'copy_template_key', 'refund_nayax_completed_current_v1',
      'retry_count', 1,
      'provider_call_made', false,
      'customer_message_sent', false,
      'payment_action_taken', false,
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
    'subject', normalized_subject,
    'body', normalized_body,
    'retryCount', 1,
    'originalThread', true,
    'exhaustedRecovery', true,
    'currentCopy', true,
    'providerCallMade', false,
    'paymentActionTaken', false,
    'payloadRedacted', true
  );
end;
$$;

revoke all on function public.service_prepare_exhausted_nayax_completion_recovery(
  text, uuid, text, uuid, text, text
) from public, anon, authenticated;
grant execute on function public.service_prepare_exhausted_nayax_completion_recovery(
  text, uuid, text, uuid, text, text
) to service_role;
