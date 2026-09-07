-- Store Gmail's canonical delivered Message-ID for RFC reply continuity. Gmail
-- can rewrite a caller-supplied Message-ID, so the deterministic operation key
-- is carried in a separate X-Bloomjoy-Refund-Operation header instead.

create or replace function public.is_refund_gmail_canonical_message_header(
  p_header text
)
returns boolean
language sql
immutable
set search_path = ''
as $$
  select p_header is not null
    and octet_length(p_header) <= 998
    and p_header ~ '^<[^<>[:space:]@]+@[^<>[:space:]@]+>$';
$$;
revoke all on function public.is_refund_gmail_canonical_message_header(text)
  from public, anon, authenticated, service_role;

-- The prior no-match receipts came from searching for a pre-send Message-ID
-- that Gmail was free to rewrite. They cannot establish non-delivery. Keep the
-- affected operations delivery-unknown for explicit manual reconciliation.
update public.refund_gmail_first_contact_operations
set reconciliation_no_match_version = 0
where status = 'delivery_unknown' and reconciliation_no_match_version <> 0;
update public.refund_gmail_intake_contact_operations
set reconciliation_no_match_version = 0, updated_at = clock_timestamp()
where status = 'delivery_unknown' and reconciliation_no_match_version <> 0;
update public.refund_gmail_messages
set reconciliation_no_match_version = 0
where status = 'delivery_unknown' and reconciliation_no_match_version <> 0;

revoke execute on function public.service_finish_refund_gmail_first_contact_no_match(uuid,integer)
  from service_role;
revoke execute on function public.service_finish_refund_gmail_contact_response_no_match(uuid,integer)
  from service_role;
revoke execute on function public.service_finish_refund_gmail_outbound_reconciliation_no_match(uuid,integer)
  from service_role;

create or replace function public.service_finish_refund_gmail_first_contact(
  p_operation_id uuid,
  p_status text,
  p_provider_message_id text,
  p_provider_message_header text,
  p_error_code text,
  p_attempt_version integer default null
)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  normalized_status text := lower(btrim(coalesce(p_status, '')));
  normalized_error_code text := nullif(left(btrim(coalesce(p_error_code, '')), 120), '');
  normalized_provider_message_id text := nullif(left(btrim(coalesce(p_provider_message_id, '')), 255), '');
  normalized_provider_message_header text := nullif(left(btrim(coalesce(p_provider_message_header, '')), 998), '');
  operation_row public.refund_gmail_first_contact_operations%rowtype;
  transport_row public.refund_gmail_messages%rowtype;
begin
  if normalized_status not in ('sent', 'failed', 'delivery_unknown') then
    raise exception 'Valid first-contact completion status required';
  end if;

  select * into operation_row
  from public.refund_gmail_first_contact_operations
  where id = p_operation_id
  for update;
  if operation_row.id is null then return false; end if;

  select * into transport_row
  from public.refund_gmail_messages
  where id = operation_row.transport_message_id
  for update;

  if normalized_status = 'sent' then
    if normalized_provider_message_id is null
      or (
        normalized_provider_message_header is not null
        and not public.is_refund_gmail_canonical_message_header(normalized_provider_message_header)
      ) then
      raise exception 'Confirmed first-contact provider evidence required';
    end if;
    if p_attempt_version is not null and (
      p_attempt_version < 1
      or operation_row.reconciliation_attempt_count <> p_attempt_version
    ) then return false; end if;
    if operation_row.status = 'delivery_unknown' and p_attempt_version is null then
      return false;
    end if;
  elsif normalized_error_code is null then
    raise exception 'Safe first-contact failure code required';
  end if;

  if operation_row.status <> 'pending_send' then
    if operation_row.status = 'sent' and normalized_status = 'sent' then
      return transport_row.provider_message_id = normalized_provider_message_id
        and transport_row.provider_message_header is not distinct from normalized_provider_message_header;
    end if;
    if not (operation_row.status = 'delivery_unknown' and normalized_status = 'sent') then
      return false;
    end if;
  end if;

  update public.refund_gmail_messages
  set status = normalized_status,
      provider_message_id = case when normalized_status = 'sent' then normalized_provider_message_id else provider_message_id end,
      provider_message_header = case when normalized_status = 'sent' then normalized_provider_message_header else provider_message_header end,
      sent_at = case when normalized_status = 'sent' then now() else sent_at end
  where id = operation_row.transport_message_id
    and (status = 'pending_send' or (normalized_status = 'sent' and status = 'delivery_unknown'));
  if not found then raise exception 'First-contact transport message is not pending'; end if;

  update public.refund_case_messages
  set status = case when normalized_status = 'sent' then 'sent' else 'failed' end,
      sent_at = case when normalized_status = 'sent' then now() else sent_at end,
      error_message = case
        when normalized_status = 'sent' then null
        when normalized_status = 'delivery_unknown' then 'Gmail delivery could not be confirmed. Reconcile the original thread before retrying.'
        else 'The automatic first-contact acknowledgement could not be sent.'
      end
  where id = operation_row.refund_case_message_id
    and (status = 'pending' or (normalized_status = 'sent' and operation_row.status = 'delivery_unknown' and status = 'failed'));
  if not found then raise exception 'First-contact case message is not pending'; end if;

  update public.refund_gmail_first_contact_operations
  set status = normalized_status,
      error_code = case when normalized_status = 'sent' then null else normalized_error_code end,
      sent_at = case when normalized_status = 'sent' then now() else sent_at end
  where id = operation_row.id;

  update public.refund_gmail_threads
  set latest_message_at = greatest(latest_message_at, now())
  where id = operation_row.gmail_thread_id;

  insert into public.refund_case_events(refund_case_id, event_type, message, metadata)
  values (
    operation_row.refund_case_id,
    case
      when normalized_status = 'sent' then 'gmail_first_contact_sent'
      when normalized_status = 'delivery_unknown' then 'gmail_first_contact_delivery_unknown'
      else 'gmail_first_contact_failed'
    end,
    case
      when normalized_status = 'sent' then 'The exactly-once first-contact acknowledgement was sent in the original Gmail thread.'
      when normalized_status = 'delivery_unknown' then 'First-contact delivery could not be confirmed. Reconcile the original Gmail thread before any retry.'
      else 'The first-contact acknowledgement could not be sent. Review the original Gmail thread before a controlled retry.'
    end,
    jsonb_build_object(
      'payload_redacted', true,
      'template_key', operation_row.template_key,
      'mode', operation_row.mode,
      'error_code', normalized_error_code,
      'canonical_message_id_available', normalized_provider_message_header is not null
    )
  );
  return true;
end;
$$;

create or replace function public.service_finish_refund_gmail_contact_first_response(
  p_operation_id uuid,
  p_status text,
  p_provider_message_id text,
  p_provider_message_header text,
  p_error_code text,
  p_attempt_version integer default null
)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  operation_row public.refund_gmail_intake_contact_operations%rowtype;
  transport_row public.refund_gmail_intake_contact_messages%rowtype;
  normalized_status text := lower(btrim(coalesce(p_status, '')));
  normalized_provider_message_id text := nullif(left(btrim(coalesce(p_provider_message_id, '')), 255), '');
  normalized_provider_message_header text := nullif(left(btrim(coalesce(p_provider_message_header, '')), 998), '');
  normalized_error_code text := nullif(left(btrim(coalesce(p_error_code, '')), 120), '');
begin
  if normalized_status not in ('sent', 'failed', 'delivery_unknown') then
    raise exception 'Valid contact completion status required';
  end if;
  select * into operation_row
  from public.refund_gmail_intake_contact_operations operation
  where operation.id = p_operation_id for update;
  if operation_row.id is null then return false; end if;
  select * into transport_row
  from public.refund_gmail_intake_contact_messages message
  where message.id = operation_row.transport_message_id for update;

  if normalized_status = 'sent' then
    if normalized_provider_message_id is null
      or (
        normalized_provider_message_header is not null
        and not public.is_refund_gmail_canonical_message_header(normalized_provider_message_header)
      ) then
      raise exception 'Confirmed contact provider evidence required';
    end if;
    if p_attempt_version is not null and (
      p_attempt_version < 1
      or operation_row.reconciliation_attempt_count <> p_attempt_version
    ) then return false; end if;
    if operation_row.status = 'delivery_unknown' and p_attempt_version is null then return false; end if;
  elsif normalized_error_code is null then
    raise exception 'Safe contact delivery failure code required';
  end if;

  if operation_row.status <> 'pending_send' then
    if operation_row.status = 'sent' and normalized_status = 'sent' then
      return transport_row.provider_message_id = normalized_provider_message_id
        and transport_row.provider_message_header is not distinct from normalized_provider_message_header;
    end if;
    if not (operation_row.status = 'delivery_unknown' and normalized_status = 'sent') then return false; end if;
  end if;

  update public.refund_gmail_intake_contact_messages
  set status = normalized_status,
      provider_message_id = case when normalized_status = 'sent' then normalized_provider_message_id else provider_message_id end,
      provider_message_header = case when normalized_status = 'sent' then normalized_provider_message_header else provider_message_header end,
      sent_at = case when normalized_status = 'sent' then clock_timestamp() else sent_at end,
      updated_at = clock_timestamp()
  where id = operation_row.transport_message_id
    and (status = 'pending_send' or (normalized_status = 'sent' and status = 'delivery_unknown'));
  if not found then return false; end if;

  update public.refund_gmail_intake_contact_operations
  set status = normalized_status,
      error_code = case when normalized_status = 'sent' then null else normalized_error_code end,
      sent_at = case when normalized_status = 'sent' then clock_timestamp() else sent_at end,
      updated_at = clock_timestamp()
  where id = operation_row.id;
  return true;
end;
$$;

create or replace function public.service_finish_refund_gmail_outbound_reconciliation(
  p_transport_message_id uuid,
  p_provider_message_id text,
  p_provider_message_header text,
  p_attempt_version integer
)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  message_row public.refund_gmail_messages%rowtype;
  normalized_provider_message_id text := nullif(left(btrim(coalesce(p_provider_message_id, '')), 255), '');
  normalized_provider_message_header text := nullif(left(btrim(coalesce(p_provider_message_header, '')), 998), '');
begin
  select * into message_row
  from public.refund_gmail_messages message
  where id = p_transport_message_id
  for update;
  if message_row.id is null
    or message_row.direction <> 'outbound'
    or message_row.message_kind <> 'message'
    or message_row.operation_key is null
    or exists (
      select 1 from public.refund_gmail_first_contact_operations first_contact
      where first_contact.transport_message_id = message_row.id
    ) then return false; end if;
  if coalesce(p_attempt_version, 0) < 1
    or message_row.reconciliation_attempt_count <> p_attempt_version then return false; end if;
  if normalized_provider_message_id is null
    or not public.is_refund_gmail_canonical_message_header(normalized_provider_message_header) then
    raise exception 'Confirmed Gmail outbound canonical provider evidence required';
  end if;
  if message_row.status = 'sent' then
    return message_row.provider_message_id = normalized_provider_message_id
      and message_row.provider_message_header = normalized_provider_message_header;
  end if;
  if message_row.status <> 'delivery_unknown' then return false; end if;

  update public.refund_gmail_messages
  set status = 'sent',
      provider_message_id = normalized_provider_message_id,
      provider_message_header = normalized_provider_message_header,
      sent_at = now()
  where id = message_row.id and status = 'delivery_unknown';
  if not found then return false; end if;
  update public.refund_case_messages
  set status = 'sent', sent_at = now(), error_message = null
  where id = message_row.refund_case_message_id and status in ('pending', 'failed');
  update public.refund_gmail_threads
  set latest_message_at = greatest(latest_message_at, now())
  where id = message_row.gmail_thread_id;
  insert into public.refund_case_events(refund_case_id, event_type, message, metadata)
  values (
    message_row.refund_case_id,
    'gmail_manager_reply_reconciled',
    'Manager-approved reply delivery was confirmed in the original Gmail thread.',
    jsonb_build_object('payload_redacted', true, 'canonical_message_id_available', true)
  );
  return true;
end;
$$;

-- A Gmail POST response with an exact provider message id and thread id is
-- confirmed delivery evidence. Canonical metadata can be absent when the
-- follow-up GET fails; retain the provider id and sent state without inventing
-- an RFC Message-ID.
create or replace function public.service_finish_refund_gmail_outbound(
  p_transport_message_id uuid,
  p_status text,
  p_provider_message_id text,
  p_provider_message_header text,
  p_error_code text
)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  gmail_message public.refund_gmail_messages%rowtype;
  message_row public.refund_case_messages%rowtype;
begin
  if lower(btrim(coalesce(p_status, ''))) = 'sent' and (
    nullif(btrim(coalesce(p_provider_message_id, '')), '') is null
    or (
      nullif(btrim(coalesce(p_provider_message_header, '')), '') is not null
      and not public.is_refund_gmail_canonical_message_header(
        nullif(btrim(coalesce(p_provider_message_header, '')), '')
      )
    )
  ) then
    raise exception 'Confirmed Gmail outbound provider evidence required';
  end if;

  select * into gmail_message from public.refund_gmail_messages
    where id = p_transport_message_id;
  if p_status = 'failed' and p_provider_message_id is null and p_provider_message_header is null
    and p_error_code in ('refund_automation_disabled', 'automatic_contact_disabled')
    and gmail_message.id is not null and gmail_message.status = 'pending_send'
    and gmail_message.provider_message_id is null and gmail_message.provider_message_header is null
    and gmail_message.refund_case_message_id is not null then
    perform 1 from public.refund_cases where id = gmail_message.refund_case_id for update;
    perform public.assert_no_active_refund_owner_resolution(gmail_message.refund_case_id);
    select * into message_row from public.refund_case_messages
      where id = gmail_message.refund_case_message_id for update;
    select * into gmail_message from public.refund_gmail_messages
      where id = p_transport_message_id for update;
    if gmail_message.id is not null and gmail_message.status = 'pending_send'
      and gmail_message.provider_message_id is null and gmail_message.provider_message_header is null
      and gmail_message.refund_case_message_id = message_row.id
      and gmail_message.refund_case_id = message_row.refund_case_id
      and message_row.status = 'pending' and message_row.manual_delivery_state = 'claimed'
      and message_row.manual_delivery_claim_token is not null
      and public.is_refund_receipt_automatic_completion_message(message_row.id) then
      delete from public.refund_gmail_messages where id = gmail_message.id;
      perform public.service_defer_refund_automatic_completion_delivery(
        message_row.id, message_row.manual_delivery_claim_token, p_error_code);
      insert into public.refund_case_events(refund_case_id, event_type, message, metadata)
      values (
        gmail_message.refund_case_id,
        'customer_message_deferred',
        'Automatic completion delivery was deferred before provider access.',
        jsonb_build_object('reason', p_error_code, 'payload_redacted', true)
      );
      return true;
    end if;
  end if;
  return public.service_finish_refund_gmail_outbound_pre_receipt_defer_v1(
    p_transport_message_id,
    p_status,
    p_provider_message_id,
    p_provider_message_header,
    p_error_code
  );
end;
$$;

revoke all on function public.service_finish_refund_gmail_first_contact(uuid,text,text,text,text,integer)
  from public, anon, authenticated;
revoke all on function public.service_finish_refund_gmail_contact_first_response(uuid,text,text,text,text,integer)
  from public, anon, authenticated;
revoke all on function public.service_finish_refund_gmail_outbound_reconciliation(uuid,text,text,integer)
  from public, anon, authenticated;
revoke all on function public.service_finish_refund_gmail_outbound(uuid,text,text,text,text)
  from public, anon, authenticated;
grant execute on function public.service_finish_refund_gmail_first_contact(uuid,text,text,text,text,integer)
  to service_role;
grant execute on function public.service_finish_refund_gmail_contact_first_response(uuid,text,text,text,text,integer)
  to service_role;
grant execute on function public.service_finish_refund_gmail_outbound_reconciliation(uuid,text,text,integer)
  to service_role;
grant execute on function public.service_finish_refund_gmail_outbound(uuid,text,text,text,text)
  to service_role;

comment on function public.is_refund_gmail_canonical_message_header(text) is
  'Private validator for a Gmail canonical RFC Message-ID read through messages.get metadata.';
