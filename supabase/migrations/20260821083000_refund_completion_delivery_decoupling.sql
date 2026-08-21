-- Customer-completion delivery is a service concern, not a Nayax provider
-- execution. Keep the attempt table private while removing the retired
-- provider-caller assertion from the three completion-only finalizers.

do $$
declare
  procedure_signature regprocedure;
  procedure_definition text;
  assertion_statement text :=
    '  perform public.assert_nayax_provider_executor(p_executor_assertion);';
begin
  foreach procedure_signature in array array[
    'public.service_finish_nayax_refund_completion(text,uuid,text)'::regprocedure,
    'public.service_authorize_nayax_refund_form_completion(text,uuid,text[])'::regprocedure,
    'public.service_finish_nayax_refund_form_completion(text,uuid,text,integer,boolean)'::regprocedure
  ] loop
    procedure_definition := pg_get_functiondef(procedure_signature);
    if position(assertion_statement in procedure_definition) = 0 then
      raise exception 'Expected completion-only provider assertion required for %',
        procedure_signature;
    end if;
    execute replace(
      procedure_definition,
      assertion_statement,
      '  -- Service-role delivery is authorized by the committed completion state.'
    );
  end loop;
end;
$$;

create or replace function public.service_load_nayax_refund_completion(
  p_attempt_id uuid
)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  attempt_row public.refund_case_nayax_refund_attempts%rowtype;
  message_row public.refund_case_messages%rowtype;
  case_row public.refund_cases%rowtype;
begin
  select attempt.*
  into attempt_row
  from public.refund_case_nayax_refund_attempts attempt
  where attempt.id = p_attempt_id;

  select message.*
  into message_row
  from public.refund_case_messages message
  where message.id = attempt_row.completion_message_id;

  select refund_case.*
  into case_row
  from public.refund_cases refund_case
  where refund_case.id = attempt_row.refund_case_id;

  if attempt_row.id is null
    or attempt_row.status is distinct from 'succeeded'
    or attempt_row.provider_outcome is distinct from 'success'
    or attempt_row.reconciliation_required
    or attempt_row.reporting_adjustment_id is null
    or attempt_row.case_finalization_committed_at is null
    or attempt_row.completion_message_id is null
    or case_row.status is distinct from 'completed'
    or case_row.reporting_adjustment_id is distinct from
      attempt_row.reporting_adjustment_id
    or message_row.id is null
    or message_row.nayax_refund_attempt_id is distinct from attempt_row.id
    or message_row.refund_case_id is distinct from case_row.id
    or lower(btrim(message_row.recipient_email)) is distinct from
      lower(btrim(case_row.customer_email)) then
    raise exception 'Committed Nayax customer completion required';
  end if;

  return jsonb_build_object(
    'message', jsonb_build_object(
      'id', message_row.id,
      'refundCaseId', message_row.refund_case_id,
      'recipientEmail', message_row.recipient_email,
      'subject', message_row.subject,
      'body', message_row.body
    ),
    'gmailThreadId', attempt_row.completion_gmail_thread_id,
    'transport', case
      when attempt_row.completion_gmail_thread_id is null
        then 'transactional_email'
      else 'gmail_thread'
    end,
    'payloadRedacted', true
  );
end;
$$;

create or replace function public.service_prepare_nayax_form_completion_retry(
  p_refund_case_id uuid,
  p_refund_case_message_id uuid,
  p_mailbox_identities text[]
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  attempt_row public.refund_case_nayax_refund_attempts%rowtype;
  message_row public.refund_case_messages%rowtype;
  case_row public.refund_cases%rowtype;
  route jsonb;
begin
  select message.*
  into message_row
  from public.refund_case_messages message
  where message.id = p_refund_case_message_id
  for update;

  select attempt.*
  into attempt_row
  from public.refund_case_nayax_refund_attempts attempt
  where attempt.id = message_row.nayax_refund_attempt_id
  for update;

  select refund_case.*
  into case_row
  from public.refund_cases refund_case
  where refund_case.id = p_refund_case_id
  for share;

  if message_row.id is null
    or attempt_row.id is null
    or case_row.id is null
    or message_row.refund_case_id is distinct from case_row.id
    or attempt_row.refund_case_id is distinct from case_row.id
    or attempt_row.completion_message_id is distinct from message_row.id then
    raise exception 'Exact Nayax customer completion required';
  end if;

  if case_row.intake_source is distinct from 'form'
    or attempt_row.completion_gmail_thread_id is not null then
    return jsonb_build_object(
      'applicable', false,
      'prepared', false,
      'payloadRedacted', true
    );
  end if;

  if message_row.message_type is distinct from 'completed'
    or message_row.template_version is distinct from 'refund_nayax_completion_v2'
    or message_row.status is distinct from 'pending'
    or attempt_row.completion_delivery_status is distinct from 'pending'
    or attempt_row.completion_delivery_retry_count is distinct from 0
    or attempt_row.status is distinct from 'succeeded'
    or attempt_row.provider_outcome is distinct from 'success'
    or attempt_row.reconciliation_required
    or attempt_row.reporting_adjustment_id is null
    or attempt_row.case_finalization_committed_at is null
    or case_row.status is distinct from 'completed'
    or case_row.reporting_adjustment_id is distinct from
      attempt_row.reporting_adjustment_id
    or lower(btrim(message_row.recipient_email)) is distinct from
      lower(btrim(case_row.customer_email)) then
    raise exception 'One pending website-form Nayax completion is required';
  end if;

  route := public.service_authorize_nayax_refund_form_completion(
    '',
    attempt_row.id,
    p_mailbox_identities
  );
  if route ->> 'status' is distinct from 'resolved' then
    raise exception 'Current mapped Machine Manager recipient route required';
  end if;

  update public.refund_case_nayax_refund_attempts
  set
    completion_delivery_retry_count = 1,
    completion_delivery_attempted_at = statement_timestamp()
  where id = attempt_row.id;

  insert into public.refund_case_events (
    refund_case_id,
    actor_user_id,
    event_type,
    message,
    metadata
  ) values (
    case_row.id,
    attempt_row.actor_user_id,
    'nayax_customer_completion_retry_prepared',
    'One email-only retry was prepared for the same website-form completion.',
    jsonb_build_object(
      'attempt_id', attempt_row.id,
      'refund_case_message_id', message_row.id,
      'retry_count', 1,
      'transport', 'transactional_email',
      'original_thread', false,
      'provider_call_made', false,
      'payload_redacted', true
    )
  );

  return jsonb_build_object(
    'applicable', true,
    'prepared', true,
    'refundCaseId', case_row.id,
    'refundCaseMessageId', message_row.id,
    'attemptId', attempt_row.id,
    'recipientEmail', message_row.recipient_email,
    'subject', message_row.subject,
    'body', message_row.body,
    'managerCcEmails', route -> 'managerCcEmails',
    'managerCcCount', route -> 'managerCcCount',
    'managerRecipientOverlap', route -> 'managerRecipientOverlap',
    'retryCount', 1,
    'transport', 'transactional_email',
    'originalThread', false,
    'providerCallMade', false,
    'payloadRedacted', true
  );
end;
$$;

revoke execute on function public.service_load_nayax_refund_completion(uuid)
  from public, anon, authenticated, service_role;
grant execute on function public.service_load_nayax_refund_completion(uuid)
  to service_role;

revoke execute on function public.service_prepare_nayax_form_completion_retry(
  uuid, uuid, text[]
) from public, anon, authenticated, service_role;
grant execute on function public.service_prepare_nayax_form_completion_retry(
  uuid, uuid, text[]
) to service_role;

comment on function public.service_load_nayax_refund_completion(uuid) is
  'Loads only the exact committed customer-completion envelope for trusted service delivery while keeping payment-attempt tables private.';

comment on function public.service_prepare_nayax_form_completion_retry(
  uuid, uuid, text[]
) is
  'Claims the one email-only retry for a pending website-form completion. It cannot create or repeat a provider attempt.';
