-- #628: Customer completion receipts stay on the customer thread. Machine
-- Managers receive the separate decision alerts and digest, so provider-success
-- completion mail must not copy them.

-- The legacy three-argument finalizer remains available to the stale-delivery
-- reconciler for failed/unknown settlement. A sent result now requires the
-- explicit physical-recipient proof accepted by the five-argument overload.
do $$
declare
  definition text := replace(pg_get_functiondef(
    'public.service_finish_nayax_refund_completion(text,uuid,text)'::regprocedure
  ), E'\r\n', E'\n');
  marker text := E'  if normalized_status = ''sent'' then\n    select count(distinct lower(manager.manager_email))::integer,';
  guard text := E'  if normalized_status = ''sent'' then\n    raise exception ''Exact customer-only Nayax completion recipient proof required'';\n  end if;\n\n';
begin
  if position(marker in definition) = 0
    or position('Exact customer-only Nayax completion recipient proof required' in definition) > 0 then
    raise exception 'Expected legacy Nayax completion sent branch';
  end if;
  execute replace(definition, marker, guard || marker);
end;
$$;

comment on function public.service_finish_nayax_refund_completion(
  text, uuid, text
) is
  'Settles failed or delivery-unknown legacy Gmail completion attempts. Sent completion requires the customer-only five-argument recipient-proof overload.';

-- Keep the existing interruption recovery fail-closed. A provider-success row
-- without the new exact recipient result is delivery-unknown and must not be
-- reclassified from the pre-policy manager-route projection.
do $$
declare
  definition text := replace(pg_get_functiondef(
    'public.service_recover_stale_nayax_completion(text,uuid,uuid)'::regprocedure
  ), E'\r\n', E'\n');
  revised text;
begin
  revised := replace(
    definition,
    $text$sqlerrm = 'Sent Gmail proof with current mapped manager CC is required'$text$,
    $text$sqlerrm = 'Exact customer-only Nayax completion recipient proof required'$text$
  );
  if revised = definition then
    raise exception 'Expected legacy Nayax completion recovery error contract';
  end if;
  execute revised;
end;
$$;

create or replace function public.service_finish_nayax_refund_completion(
  p_executor_assertion text,
  p_attempt_id uuid,
  p_delivery_status text,
  p_manager_cc_count integer,
  p_manager_recipient_overlap boolean
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
  outbound_row public.refund_gmail_messages%rowtype;
  normalized_status text := lower(btrim(coalesce(p_delivery_status, '')));
  active_manager_cc_count integer := 0;
  active_manager_recipient_overlap boolean := false;
  total_active_manager_count integer := 0;
begin
  perform public.assert_nayax_provider_executor(p_executor_assertion);

  if normalized_status not in ('sent', 'failed', 'delivery_unknown') then
    raise exception 'Valid Nayax completion delivery status required';
  end if;

  if normalized_status <> 'sent' then
    return public.service_finish_nayax_refund_completion(
      p_executor_assertion,
      p_attempt_id,
      normalized_status
    );
  end if;

  select attempt.*
  into attempt_row
  from public.refund_case_nayax_refund_attempts attempt
  where attempt.id = p_attempt_id
  for update;

  select refund_case.*
  into case_row
  from public.refund_cases refund_case
  where refund_case.id = attempt_row.refund_case_id
  for share;

  select message.*
  into message_row
  from public.refund_case_messages message
  where message.id = attempt_row.completion_message_id
  for update;

  if attempt_row.id is null
    or attempt_row.status is distinct from 'succeeded'
    or attempt_row.provider_outcome is distinct from 'success'
    or attempt_row.reporting_adjustment_id is null
    or attempt_row.case_finalization_committed_at is null
    or attempt_row.completion_message_id is null
    or attempt_row.completion_gmail_thread_id is null
    or case_row.status is distinct from 'completed'
    or case_row.reporting_adjustment_id is distinct from
      attempt_row.reporting_adjustment_id
    or message_row.id is null
    or message_row.nayax_refund_attempt_id is distinct from attempt_row.id then
    raise exception 'Committed Nayax completion evidence required';
  end if;

  if attempt_row.completion_delivery_status = 'sent'
    and message_row.status = 'sent' then
    return jsonb_build_object(
      'status', 'already_sent',
      'transport', 'gmail_thread',
      'managerCcCount', attempt_row.completion_manager_cc_count,
      'originalThread', true,
      'operationApplied', false,
      'managerCompletionNoticeSent', false
    );
  end if;

  select outbound.*
  into outbound_row
  from public.refund_gmail_messages outbound
  where outbound.operation_key =
      'refund-case-message:' || attempt_row.completion_message_id::text
    and outbound.refund_case_id = attempt_row.refund_case_id
    and outbound.refund_case_message_id = attempt_row.completion_message_id
    and outbound.gmail_thread_id = attempt_row.completion_gmail_thread_id
    and outbound.direction = 'outbound'
    and outbound.message_kind = 'message'
  for update;

  select count(distinct lower(manager.manager_email))::integer,
    coalesce(bool_or(lower(btrim(manager.manager_email)) =
      lower(btrim(case_row.customer_email))), false)
  into total_active_manager_count, active_manager_recipient_overlap
  from public.reporting_machine_refund_managers manager
  where manager.reporting_machine_id = case_row.reporting_machine_id
    and manager.status = 'active'
    and manager.revoked_at is null;

  select count(distinct lower(manager.manager_email))::integer
  into active_manager_cc_count
  from public.reporting_machine_refund_managers manager
  where manager.reporting_machine_id = case_row.reporting_machine_id
    and manager.status = 'active'
    and manager.revoked_at is null
    and lower(manager.manager_email) = any(outbound_row.recipient_cc_emails);

  if coalesce(p_manager_cc_count, -1) <> 0
    or coalesce(p_manager_recipient_overlap, true)
    or outbound_row.id is null
    or outbound_row.status is distinct from 'sent'
    or outbound_row.sent_at is null
    or outbound_row.provider_message_id is null
    or outbound_row.delivery_kind is distinct from 'manual'
    or outbound_row.recipient_resolution_status is distinct from 'resolved'
    or total_active_manager_count not between 1 and 4
    or outbound_row.recipient_manager_overlap is distinct from
      active_manager_recipient_overlap
    or outbound_row.recipient_manager_count is distinct from
      total_active_manager_count
    or outbound_row.recipient_manager_count is distinct from
      outbound_row.recipient_cc_count +
        (case when outbound_row.recipient_manager_overlap then 1 else 0 end)
    or active_manager_cc_count is distinct from outbound_row.recipient_cc_count
    or cardinality(outbound_row.recipient_cc_emails) is distinct from
      outbound_row.recipient_cc_count
    or lower(btrim(outbound_row.recipient_email)) is distinct from
      lower(btrim(case_row.customer_email)) then
    raise exception 'Sent Gmail proof with customer-only recipient policy is required';
  end if;

  update public.refund_case_messages
  set
    status = 'sent',
    sent_at = coalesce(sent_at, outbound_row.sent_at),
    error_message = null
  where id = message_row.id;

  update public.refund_case_nayax_refund_attempts
  set
    completion_delivery_status = 'sent',
    completion_manager_cc_count = 0
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
    'nayax_customer_completion_sent',
    'The refund completion was sent once to the customer in the original Gmail thread.',
    jsonb_build_object(
      'attempt_id', attempt_row.id,
      'refund_case_message_id', message_row.id,
      'manager_cc_count', 0,
      'manager_recipient_overlap', false,
      'original_thread', true,
      'manager_completion_notice_sent', false,
      'payload_redacted', true
    )
  );

  return jsonb_build_object(
    'status', 'sent',
    'transport', 'gmail_thread',
    'managerCcCount', 0,
    'managerRecipientOverlap', false,
    'originalThread', true,
    'operationApplied', true,
    'managerCompletionNoticeSent', false
  );
end;
$$;

revoke execute on function public.service_finish_nayax_refund_completion(
  text, uuid, text, integer, boolean
) from public, anon, authenticated;
grant execute on function public.service_finish_nayax_refund_completion(
  text, uuid, text, integer, boolean
) to service_role;

comment on function public.service_finish_nayax_refund_completion(
  text, uuid, text, integer, boolean
) is
  'Finalizes a provider-success completion only with exact sent Gmail evidence, a still-valid mapped-manager governance route, and customer-only physical recipient proof. Historical sent receipts remain immutable.';

create or replace function public.service_finish_nayax_refund_form_completion(
  p_executor_assertion text,
  p_attempt_id uuid,
  p_delivery_status text,
  p_manager_cc_count integer,
  p_manager_recipient_overlap boolean
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
  normalized_status text := lower(btrim(coalesce(p_delivery_status, '')));
  distinct_active_manager_count integer := 0;
  valid_active_manager_count integer := 0;
begin
  perform public.assert_nayax_provider_executor(p_executor_assertion);

  if normalized_status not in ('sent', 'failed', 'delivery_unknown') then
    raise exception 'Valid Nayax completion delivery status required';
  end if;

  select attempt.*
  into attempt_row
  from public.refund_case_nayax_refund_attempts attempt
  where attempt.id = p_attempt_id
  for update;

  select refund_case.*
  into case_row
  from public.refund_cases refund_case
  where refund_case.id = attempt_row.refund_case_id
  for share;

  select message.*
  into message_row
  from public.refund_case_messages message
  where message.id = attempt_row.completion_message_id
  for update;

  if attempt_row.id is null
    or attempt_row.status is distinct from 'succeeded'
    or attempt_row.provider_outcome is distinct from 'success'
    or attempt_row.reporting_adjustment_id is null
    or attempt_row.case_finalization_committed_at is null
    or attempt_row.completion_message_id is null
    or attempt_row.completion_gmail_thread_id is not null
    or case_row.status is distinct from 'completed'
    or case_row.intake_source is distinct from 'form'
    or case_row.reporting_adjustment_id is distinct from
      attempt_row.reporting_adjustment_id
    or message_row.id is null
    or message_row.nayax_refund_attempt_id is distinct from attempt_row.id then
    raise exception 'Committed website-form Nayax completion evidence required';
  end if;

  if attempt_row.completion_delivery_status = 'sent'
    and message_row.status = 'sent' then
    return jsonb_build_object(
      'status', 'already_sent',
      'transport', 'transactional_email',
      'managerCcCount', attempt_row.completion_manager_cc_count,
      'originalThread', false,
      'operationApplied', false,
      'managerCompletionNoticeSent', false
    );
  end if;

  if normalized_status = 'sent' then
    select
      count(distinct lower(btrim(manager.manager_email)))::integer,
      count(distinct lower(btrim(manager.manager_email))) filter (
        where public.refund_email_address_is_valid(manager.manager_email)
      )::integer
    into distinct_active_manager_count, valid_active_manager_count
    from public.reporting_machine_refund_managers manager
    where manager.reporting_machine_id = case_row.reporting_machine_id
      and manager.status = 'active'
      and manager.revoked_at is null;

    if distinct_active_manager_count not between 1 and 4
      or valid_active_manager_count <> distinct_active_manager_count
      or coalesce(p_manager_cc_count, -1) <> 0
      or coalesce(p_manager_recipient_overlap, true) then
      raise exception 'Customer-only completion and current mapped Machine Manager route required';
    end if;

    update public.refund_case_messages
    set
      status = 'sent',
      sent_at = coalesce(sent_at, statement_timestamp()),
      error_message = null
    where id = message_row.id;

    update public.refund_case_nayax_refund_attempts
    set
      completion_delivery_status = 'sent',
      completion_manager_cc_count = 0
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
      'nayax_customer_completion_sent',
      'The website-form refund completion was emailed once to the customer.',
      jsonb_build_object(
        'attempt_id', attempt_row.id,
        'refund_case_message_id', message_row.id,
        'manager_cc_count', 0,
        'manager_recipient_overlap', false,
        'transport', 'transactional_email',
        'original_thread', false,
        'manager_completion_notice_sent', false,
        'payload_redacted', true
      )
    );

    return jsonb_build_object(
      'status', 'sent',
      'transport', 'transactional_email',
      'managerCcCount', 0,
      'managerRecipientOverlap', false,
      'originalThread', false,
      'operationApplied', true,
      'managerCompletionNoticeSent', false
    );
  end if;

  update public.refund_case_messages
  set
    status = case when normalized_status = 'failed' then 'failed' else status end,
    error_message = case
      when normalized_status = 'failed' then 'transactional_completion_failed'
      else 'transactional_completion_delivery_unknown'
    end
  where id = message_row.id;

  update public.refund_case_nayax_refund_attempts
  set completion_delivery_status = normalized_status
  where id = attempt_row.id;

  return jsonb_build_object(
    'status', normalized_status,
    'transport', 'transactional_email',
    'managerCcCount', 0,
    'managerRecipientOverlap', false,
    'originalThread', false,
    'operationApplied', true,
    'managerCompletionNoticeSent', false
  );
end;
$$;

revoke execute on function public.service_finish_nayax_refund_form_completion(
  text, uuid, text, integer, boolean
) from public, anon, authenticated;
grant execute on function public.service_finish_nayax_refund_form_completion(
  text, uuid, text, integer, boolean
) to service_role;

comment on function public.service_finish_nayax_refund_form_completion(
  text, uuid, text, integer, boolean
) is
  'Finalizes the transactional-email completion for a website-form Nayax refund only with a current mapped-manager governance route and customer-only physical recipient proof. Historical sent receipts remain immutable.';
