-- Bind exactly-once Gmail first contact to the participant-safe manager-CC
-- boundary added after the original first-contact migration. This migration
-- does not enable Gmail or automatic customer contact.

create or replace function public.service_prepare_refund_gmail_first_contact_delivery(
  p_operation_id uuid,
  p_mailbox_identities text[]
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  operation_row public.refund_gmail_first_contact_operations;
  source_row public.refund_gmail_messages;
  transport_row public.refund_gmail_messages;
  case_row public.refund_cases;
  mailbox_identities text[] := public.normalize_refund_mailbox_identities(
    p_mailbox_identities
  );
  recipient_resolution jsonb;
  manager_cc_emails text[] := '{}'::text[];
  resolution_status text;
  route_changed boolean := false;
begin
  if p_operation_id is null or cardinality(mailbox_identities) = 0 then
    raise exception 'Valid first-contact operation and mailbox identities required';
  end if;

  select * into operation_row
  from public.refund_gmail_first_contact_operations operation
  where operation.id = p_operation_id
  for update;

  if operation_row.id is null then
    return jsonb_build_object('allowed', false, 'status', 'operation_not_found');
  end if;
  if operation_row.mode not in ('isolated_test', 'active')
    or operation_row.status <> 'pending_send' then
    return jsonb_build_object(
      'allowed', false,
      'status', 'operation_not_sendable'
    );
  end if;

  select * into source_row
  from public.refund_gmail_messages message
  where message.id = operation_row.source_message_id
  for update;

  select * into transport_row
  from public.refund_gmail_messages message
  where message.id = operation_row.transport_message_id
  for update;

  select * into case_row
  from public.refund_cases refund_case
  where refund_case.id = operation_row.refund_case_id
  for update;

  if source_row.id is null
    or transport_row.id is null
    or case_row.id is null
    or source_row.refund_case_id is distinct from case_row.id
    or transport_row.refund_case_id is distinct from case_row.id
    or source_row.gmail_thread_id is distinct from operation_row.gmail_thread_id
    or transport_row.gmail_thread_id is distinct from operation_row.gmail_thread_id
    or source_row.direction <> 'inbound'
    or source_row.message_kind <> 'message'
    or source_row.status <> 'received'
    or source_row.participant_role <> 'customer'
    or source_row.participant_trust <> 'verified'
    or lower(btrim(coalesce(source_row.sender_email, ''))) <>
      lower(btrim(case_row.customer_email))
    or lower(btrim(coalesce(transport_row.recipient_email, ''))) <>
      lower(btrim(case_row.customer_email))
    or transport_row.direction <> 'outbound'
    or transport_row.message_kind <> 'message'
    or transport_row.status <> 'pending_send' then
    return jsonb_build_object(
      'allowed', false,
      'status', 'first_contact_evidence_invalid'
    );
  end if;

  if case_row.status in ('approved', 'denied', 'completed', 'closed')
    or case_row.decision is not null then
    update public.refund_gmail_messages
    set
      recipient_cc_emails = '{}'::text[],
      recipient_cc_count = 0,
      recipient_resolution_status = null
    where id = transport_row.id;
    return jsonb_build_object('allowed', false, 'status', 'terminal_case');
  end if;

  perform thread.id
  from public.refund_gmail_threads thread
  where thread.refund_case_id = case_row.id
  order by thread.id
  for update;

  if exists (
    select 1
    from public.refund_gmail_threads thread
    where thread.refund_case_id = case_row.id
      and thread.automatic_customer_contact_paused_at is not null
  ) then
    update public.refund_gmail_messages
    set
      recipient_cc_emails = '{}'::text[],
      recipient_cc_count = 0,
      recipient_resolution_status = null
    where id = transport_row.id;
    return jsonb_build_object(
      'allowed', false,
      'status', 'automatic_contact_paused'
    );
  end if;

  recipient_resolution := public.service_resolve_refund_customer_manager_cc(
    case_row.id,
    case_row.customer_email,
    mailbox_identities
  );
  resolution_status := recipient_resolution ->> 'status';

  select coalesce(array_agg(value order by value), '{}'::text[])
  into manager_cc_emails
  from jsonb_array_elements_text(
    coalesce(recipient_resolution -> 'managerCcEmails', '[]'::jsonb)
  ) value;

  if resolution_status not in ('resolved', 'resolved_with_exclusions')
    or cardinality(manager_cc_emails) not between 1 and 3 then
    update public.refund_gmail_messages
    set
      recipient_cc_emails = '{}'::text[],
      recipient_cc_count = 0,
      recipient_resolution_status = case
        when resolution_status in (
          'machine_unresolved',
          'no_active_managers',
          'invalid_manager_mapping'
        ) then resolution_status
        else null
      end
    where id = transport_row.id;
    return jsonb_build_object(
      'allowed', false,
      'status', coalesce(resolution_status, 'manager_cc_required'),
      'managerCcCount', 0
    );
  end if;

  route_changed := transport_row.recipient_cc_emails is distinct from manager_cc_emails
    or transport_row.recipient_cc_count is distinct from cardinality(manager_cc_emails)
    or transport_row.recipient_resolution_status is distinct from resolution_status
    or transport_row.delivery_kind is distinct from 'automatic'
    or transport_row.participant_role is distinct from 'mailbox'
    or transport_row.participant_trust is distinct from 'verified';

  update public.refund_gmail_messages
  set
    recipient_cc_emails = manager_cc_emails,
    recipient_cc_count = cardinality(manager_cc_emails),
    recipient_resolution_status = resolution_status,
    delivery_kind = 'automatic',
    participant_role = 'mailbox',
    participant_trust = 'verified'
  where id = transport_row.id;

  if route_changed then
    insert into public.refund_case_events (
      refund_case_id,
      event_type,
      message,
      metadata
    ) values (
      case_row.id,
      'gmail_first_contact_manager_cc_resolved',
      'Current mapped Machine Managers were resolved for the exactly-once first-contact acknowledgement.',
      jsonb_build_object(
        'payload_redacted', true,
        'manager_cc_count', cardinality(manager_cc_emails),
        'recipient_resolution_status', resolution_status,
        'template_key', operation_row.template_key
      )
    );
  end if;

  return jsonb_build_object(
    'allowed', true,
    'status', resolution_status,
    'managerCcEmails', to_jsonb(manager_cc_emails),
    'managerCcCount', cardinality(manager_cc_emails)
  );
end;
$$;

revoke execute on function public.service_prepare_refund_gmail_first_contact_delivery(uuid, text[])
  from public, anon, authenticated;
grant execute on function public.service_prepare_refund_gmail_first_contact_delivery(uuid, text[])
  to service_role;

comment on function public.service_prepare_refund_gmail_first_contact_delivery(uuid, text[]) is
  'Revalidates verified direct-customer evidence, open-case and case-wide bounce gates, and one-to-three current mapped manager CC recipients immediately before an exactly-once first-contact Gmail send.';

-- Preserve the exactly-once migration's linked canonical-message erasure while
-- also clearing the participant-safe visible CC fields added later. Defining
-- the combined boundary in a forward migration keeps both deployment orders
-- safe and prevents retained customer content in the portal copy.
create or replace function public.service_purge_refund_gmail_expired_message_content(
  p_limit integer default 200
)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  expired_message_ids uuid[];
  expired_case_message_ids uuid[];
  purged_count integer := 0;
begin
  select
    array_agg(expired.id),
    array_agg(expired.refund_case_message_id)
      filter (where expired.refund_case_message_id is not null)
  into expired_message_ids, expired_case_message_ids
  from (
    select message.id, message.refund_case_message_id
    from public.refund_gmail_messages message
    where message.retention_expires_at <= now()
      and message.content_deleted_at is null
    order by message.retention_expires_at, message.id
    limit least(greatest(coalesce(p_limit, 200), 1), 500)
    for update skip locked
  ) expired;

  if coalesce(array_length(expired_message_ids, 1), 0) = 0 then
    return 0;
  end if;

  if coalesce(array_length(expired_case_message_ids, 1), 0) > 0 then
    update public.refund_case_messages case_message
    set
      recipient_email = '[Deleted after Gmail retention period]',
      subject = '[Deleted after Gmail retention period]',
      body = '[Deleted after Gmail retention period]',
      error_message = null
    where case_message.id = any(expired_case_message_ids);
  end if;

  update public.refund_gmail_messages message
  set
    sender_email = null,
    sender_name = null,
    recipient_email = null,
    recipient_cc_emails = '{}'::text[],
    recipient_cc_count = 0,
    subject = '[Deleted after Gmail retention period]',
    plain_body = '[Deleted after Gmail retention period]',
    provider_message_header = null,
    references_header = null,
    content_deleted_at = now()
  where message.id = any(expired_message_ids);

  get diagnostics purged_count = row_count;

  update public.refund_gmail_threads thread
  set thread_subject = '[Deleted after Gmail retention period]'
  where thread.retention_expires_at <= now()
    and thread.thread_subject <> '[Deleted after Gmail retention period]';

  return purged_count;
end;
$$;

select pg_notify('pgrst', 'reload schema');
