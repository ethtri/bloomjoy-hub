-- Participant-safe refund Gmail threading and current mapped-manager CC.
-- This migration is production-off by itself. It adds transport boundaries but
-- does not enable Gmail polling, automatic customer mail, or payment execution.

alter table public.refund_gmail_threads
  add column if not exists automatic_customer_contact_paused_at timestamptz,
  add column if not exists automatic_customer_contact_pause_reason text;

alter table public.refund_gmail_threads
  drop constraint if exists refund_gmail_threads_contact_pause_reason_check;

alter table public.refund_gmail_threads
  add constraint refund_gmail_threads_contact_pause_reason_check
  check (
    (automatic_customer_contact_paused_at is null and automatic_customer_contact_pause_reason is null)
    or (
      automatic_customer_contact_paused_at is not null
      and automatic_customer_contact_pause_reason in ('hard_bounce')
    )
  );

alter table public.refund_gmail_messages
  add column if not exists participant_role text not null default 'unknown',
  add column if not exists participant_trust text not null default 'unverified',
  add column if not exists recipient_cc_emails text[] not null default '{}'::text[],
  add column if not exists recipient_cc_count integer not null default 0,
  add column if not exists recipient_resolution_status text,
  add column if not exists delivery_kind text;

update public.refund_gmail_messages
set
  participant_role = case
    when direction = 'outbound' then 'mailbox'
    when direction = 'system' then 'automated_system'
    else 'unknown'
  end,
  participant_trust = case
    when direction in ('outbound', 'system') then 'verified'
    else 'unverified'
  end
where participant_role = 'unknown'
  and participant_trust = 'unverified';

alter table public.refund_gmail_messages
  drop constraint if exists refund_gmail_messages_participant_role_check,
  drop constraint if exists refund_gmail_messages_participant_trust_check,
  drop constraint if exists refund_gmail_messages_recipient_cc_count_check,
  drop constraint if exists refund_gmail_messages_recipient_cc_size_check,
  drop constraint if exists refund_gmail_messages_recipient_resolution_check,
  drop constraint if exists refund_gmail_messages_delivery_kind_check;

alter table public.refund_gmail_messages
  add constraint refund_gmail_messages_participant_role_check
    check (participant_role in ('customer', 'assigned_manager', 'mailbox', 'automated_system', 'unknown')),
  add constraint refund_gmail_messages_participant_trust_check
    check (participant_trust in ('verified', 'unverified', 'forwarded', 'spoof_suspected', 'automated')),
  add constraint refund_gmail_messages_recipient_cc_count_check
    check (recipient_cc_count between 0 and 20),
  add constraint refund_gmail_messages_recipient_cc_size_check
    check (cardinality(recipient_cc_emails) <= 20),
  add constraint refund_gmail_messages_recipient_resolution_check
    check (
      recipient_resolution_status is null
      or recipient_resolution_status in (
        'resolved',
        'resolved_with_exclusions',
        'machine_unresolved',
        'no_active_managers',
        'invalid_manager_mapping'
      )
    ),
  add constraint refund_gmail_messages_delivery_kind_check
    check (delivery_kind is null or delivery_kind in ('manual', 'automatic'));

create or replace function public.refund_email_address_is_valid(p_value text)
returns boolean
language sql
immutable
set search_path = public
as $$
  select lower(btrim(coalesce(p_value, ''))) ~
    '^[a-z0-9.!#$%&''*+/=?^_`{|}~-]+@[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?)+$'
    and length(btrim(coalesce(p_value, ''))) <= 320;
$$;

create or replace function public.normalize_refund_mailbox_identities(p_values text[])
returns text[]
language sql
immutable
set search_path = public
as $$
  select coalesce(array_agg(value order by value), '{}'::text[])
  from (
    select distinct lower(btrim(entry)) as value
    from unnest(coalesce(p_values, '{}'::text[])) entry
    where public.refund_email_address_is_valid(entry)
  ) normalized;
$$;

create or replace function public.service_resolve_refund_customer_manager_cc(
  p_refund_case_id uuid,
  p_customer_email text,
  p_mailbox_identities text[]
)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  case_row public.refund_cases;
  normalized_customer text := lower(btrim(coalesce(p_customer_email, '')));
  mailbox_identities text[] := public.normalize_refund_mailbox_identities(p_mailbox_identities);
  manager_cc_emails text[] := '{}'::text[];
  active_mapping_count integer := 0;
  distinct_active_mapping_count integer := 0;
  eligible_mapping_count integer := 0;
  invalid_mapping_count integer := 0;
  resolution_status text;
begin
  select * into case_row
  from public.refund_cases
  where id = p_refund_case_id;

  if case_row.id is null then
    raise exception 'Refund case not found';
  end if;
  if not public.refund_email_address_is_valid(normalized_customer)
    or lower(btrim(case_row.customer_email)) <> normalized_customer then
    raise exception 'Customer recipient must match the refund case';
  end if;

  if case_row.reporting_machine_id is null then
    return jsonb_build_object(
      'status', 'machine_unresolved',
      'managerCcEmails', to_jsonb(manager_cc_emails),
      'managerCcCount', 0
    );
  end if;

  select count(*)::integer
  into active_mapping_count
  from public.reporting_machine_refund_managers manager
  where manager.reporting_machine_id = case_row.reporting_machine_id
    and manager.status = 'active'
    and manager.revoked_at is null;

  select count(distinct lower(btrim(manager.manager_email)))::integer
  into distinct_active_mapping_count
  from public.reporting_machine_refund_managers manager
  where manager.reporting_machine_id = case_row.reporting_machine_id
    and manager.status = 'active'
    and manager.revoked_at is null;

  select coalesce(array_agg(email order by email), '{}'::text[])
  into manager_cc_emails
  from (
    select distinct lower(btrim(manager.manager_email)) as email
    from public.reporting_machine_refund_managers manager
    where manager.reporting_machine_id = case_row.reporting_machine_id
      and manager.status = 'active'
      and manager.revoked_at is null
      and public.refund_email_address_is_valid(manager.manager_email)
      and lower(btrim(manager.manager_email)) <> normalized_customer
      and not (lower(btrim(manager.manager_email)) = any(mailbox_identities))
  ) eligible;

  eligible_mapping_count := cardinality(manager_cc_emails);
  invalid_mapping_count := greatest(active_mapping_count - eligible_mapping_count, 0);
  resolution_status := case
    when distinct_active_mapping_count > 3 or eligible_mapping_count > 3 then 'invalid_manager_mapping'
    when active_mapping_count = 0 then 'no_active_managers'
    when eligible_mapping_count = 0 then 'invalid_manager_mapping'
    when invalid_mapping_count > 0 then 'resolved_with_exclusions'
    else 'resolved'
  end;

  if distinct_active_mapping_count > 3 or eligible_mapping_count > 3 then
    manager_cc_emails := '{}'::text[];
    eligible_mapping_count := 0;
  end if;

  return jsonb_build_object(
    'status', resolution_status,
    'managerCcEmails', to_jsonb(manager_cc_emails),
    'managerCcCount', eligible_mapping_count
  );
end;
$$;

create or replace function public.service_ingest_refund_gmail_message_v2(
  p_mailbox_hash text,
  p_provider_thread_id text,
  p_provider_message_id text,
  p_provider_message_header text,
  p_references_header text,
  p_direction text,
  p_is_bounce boolean,
  p_sender_email text,
  p_sender_name text,
  p_recipient_email text,
  p_subject text,
  p_plain_body text,
  p_sensitive_data_redacted boolean,
  p_received_at timestamptz,
  p_public_reference text,
  p_attachments jsonb,
  p_recipient_cc_emails text[],
  p_mailbox_identities text[],
  p_participant_trust text,
  p_provider_sent boolean,
  p_is_hard_bounce boolean,
  p_failed_recipient_emails text[]
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  thread_row public.refund_gmail_threads;
  message_row public.refund_gmail_messages;
  case_row public.refund_cases;
  attachment jsonb;
  requested_direction text := lower(btrim(coalesce(p_direction, '')));
  normalized_sender_email text := lower(btrim(coalesce(p_sender_email, '')));
  normalized_recipient_email text := lower(left(btrim(coalesce(p_recipient_email, '')), 320));
  normalized_subject text := left(btrim(coalesce(p_subject, '')), 998);
  normalized_body text := left(coalesce(p_plain_body, ''), 50000);
  normalized_trust text := lower(btrim(coalesce(p_participant_trust, 'unverified')));
  mailbox_identities text[] := public.normalize_refund_mailbox_identities(p_mailbox_identities);
  normalized_cc_emails text[] := '{}'::text[];
  normalized_failed_recipient_emails text[] := '{}'::text[];
  participant_role text := 'unknown';
  stored_direction text := 'system';
  stored_trust text := 'unverified';
  customer_hard_bounce boolean := false;
  received_at timestamptz := coalesce(p_received_at, now());
  retention_at timestamptz := coalesce(p_received_at, now()) + interval '180 days';
  attachment_rows jsonb := '[]'::jsonb;
begin
  if coalesce(p_mailbox_hash, '') !~ '^[a-f0-9]{64}$' then
    raise exception 'Valid mailbox fingerprint required';
  end if;
  if length(btrim(coalesce(p_provider_thread_id, ''))) not between 1 and 255
    or length(btrim(coalesce(p_provider_message_id, ''))) not between 1 and 255 then
    raise exception 'Valid Gmail provider identifiers required';
  end if;
  if requested_direction not in ('inbound', 'outbound', 'system') then
    raise exception 'Valid Gmail message direction required';
  end if;
  if normalized_trust not in ('direct_human', 'forwarded', 'spoof_suspected', 'automated') then
    raise exception 'Valid Gmail participant trust signal required';
  end if;
  if normalized_subject = '' then
    normalized_subject := '(no subject)';
  end if;
  if jsonb_typeof(coalesce(p_attachments, '[]'::jsonb)) <> 'array' then
    raise exception 'Gmail attachment metadata must be an array';
  end if;

  select coalesce(array_agg(email order by email), '{}'::text[])
  into normalized_cc_emails
  from (
    select distinct lower(btrim(entry)) as email
    from unnest(coalesce(p_recipient_cc_emails, '{}'::text[])) entry
    where public.refund_email_address_is_valid(entry)
      and lower(btrim(entry)) <> normalized_recipient_email
    limit 20
  ) recipients;

  select coalesce(array_agg(email order by email), '{}'::text[])
  into normalized_failed_recipient_emails
  from (
    select distinct lower(btrim(entry)) as email
    from unnest(coalesce(p_failed_recipient_emails, '{}'::text[])) entry
    where public.refund_email_address_is_valid(entry)
    limit 20
  ) failed_recipients;

  perform pg_advisory_xact_lock(hashtextextended(p_mailbox_hash || ':' || p_provider_thread_id, 0));

  select * into thread_row
  from public.refund_gmail_threads
  where mailbox_hash = p_mailbox_hash
    and provider_thread_id = btrim(p_provider_thread_id)
  for update;

  if thread_row.id is null then
    if requested_direction <> 'inbound'
      or coalesce(p_is_bounce, false)
      or normalized_trust <> 'direct_human'
      or normalized_sender_email = any(mailbox_identities) then
      return jsonb_build_object('created', false, 'skipped', true, 'reason', 'unlinked_non_customer_message');
    end if;
    if not public.refund_email_address_is_valid(normalized_sender_email) then
      return jsonb_build_object('created', false, 'skipped', true, 'reason', 'unverified_sender');
    end if;

    if nullif(btrim(coalesce(p_public_reference, '')), '') is not null then
      select * into case_row
      from public.refund_cases
      where upper(public_reference) = upper(btrim(p_public_reference))
        and lower(customer_email) = normalized_sender_email
      order by created_at desc
      limit 1;
    end if;

    if case_row.id is null and exists (
      select 1
      from public.reporting_machine_refund_managers manager
      where manager.status = 'active'
        and manager.revoked_at is null
        and lower(btrim(manager.manager_email)) = normalized_sender_email
    ) then
      return jsonb_build_object('created', false, 'skipped', true, 'reason', 'unlinked_non_customer_message');
    end if;

    if case_row.id is null then
      insert into public.refund_cases (
        customer_email,
        customer_name,
        issue_summary,
        status,
        intake_source,
        automation_state,
        intake_meta
      )
      values (
        normalized_sender_email,
        nullif(left(btrim(coalesce(p_sender_name, '')), 160), ''),
        left(
          case when normalized_body = '' then normalized_subject
          else normalized_subject || E'\n\n' || normalized_body end,
          4000
        ),
        'draft',
        'gmail',
        'customer_replied',
        jsonb_build_object(
          'source', 'gmail',
          'content_redacted', coalesce(p_sensitive_data_redacted, false),
          'transport_ids_redacted', true
        )
      )
      returning * into case_row;
    end if;

    insert into public.refund_gmail_threads (
      refund_case_id,
      mailbox_hash,
      provider_thread_id,
      thread_subject,
      first_message_at,
      latest_message_at,
      retention_expires_at
    )
    values (
      case_row.id,
      p_mailbox_hash,
      btrim(p_provider_thread_id),
      normalized_subject,
      received_at,
      received_at,
      retention_at
    )
    returning * into thread_row;
  else
    select * into case_row
    from public.refund_cases
    where id = thread_row.refund_case_id;
  end if;

  customer_hard_bounce := coalesce(p_is_bounce, false)
    and coalesce(p_is_hard_bounce, false)
    and lower(btrim(case_row.customer_email)) = any(normalized_failed_recipient_emails);

  if coalesce(p_is_bounce, false) then
    participant_role := 'automated_system';
    stored_direction := 'system';
    stored_trust := 'automated';
  elsif coalesce(p_provider_sent, false)
    and normalized_sender_email = any(mailbox_identities)
    and normalized_trust not in ('forwarded', 'spoof_suspected') then
    participant_role := 'mailbox';
    stored_direction := 'outbound';
    stored_trust := 'verified';
  elsif normalized_trust = 'automated' or requested_direction = 'system' then
    participant_role := 'automated_system';
    stored_direction := 'system';
    stored_trust := 'automated';
  elsif normalized_trust = 'direct_human'
    and normalized_sender_email = lower(btrim(case_row.customer_email)) then
    participant_role := 'customer';
    stored_direction := 'inbound';
    stored_trust := 'verified';
  elsif normalized_trust = 'direct_human' and exists (
    select 1
    from public.reporting_machine_refund_managers manager
    where manager.reporting_machine_id = case_row.reporting_machine_id
      and manager.status = 'active'
      and manager.revoked_at is null
      and lower(btrim(manager.manager_email)) = normalized_sender_email
  ) then
    participant_role := 'assigned_manager';
    stored_direction := 'system';
    stored_trust := 'verified';
  else
    participant_role := 'unknown';
    stored_direction := 'system';
    stored_trust := case
      when normalized_trust = 'forwarded' then 'forwarded'
      when normalized_trust = 'spoof_suspected' then 'spoof_suspected'
      else 'unverified'
    end;
  end if;

  insert into public.refund_gmail_messages (
    gmail_thread_id,
    refund_case_id,
    provider_message_id,
    provider_message_header,
    references_header,
    direction,
    message_kind,
    status,
    sender_email,
    sender_name,
    recipient_email,
    recipient_cc_emails,
    recipient_cc_count,
    participant_role,
    participant_trust,
    subject,
    plain_body,
    sensitive_data_redacted,
    received_at,
    sent_at,
    retention_expires_at
  )
  values (
    thread_row.id,
    case_row.id,
    btrim(p_provider_message_id),
    nullif(left(btrim(coalesce(p_provider_message_header, '')), 998), ''),
    nullif(left(btrim(coalesce(p_references_header, '')), 4000), ''),
    stored_direction,
    case when coalesce(p_is_bounce, false) then 'bounce' else 'message' end,
    case when stored_direction = 'outbound' then 'sent' else 'received' end,
    nullif(normalized_sender_email, ''),
    nullif(left(btrim(coalesce(p_sender_name, '')), 160), ''),
    nullif(normalized_recipient_email, ''),
    normalized_cc_emails,
    cardinality(normalized_cc_emails),
    participant_role,
    stored_trust,
    normalized_subject,
    normalized_body,
    coalesce(p_sensitive_data_redacted, false),
    received_at,
    case when stored_direction = 'outbound' then received_at else null end,
    retention_at
  )
  on conflict (gmail_thread_id, provider_message_id) do nothing
  returning * into message_row;

  if message_row.id is null then
    select * into message_row
    from public.refund_gmail_messages
    where gmail_thread_id = thread_row.id
      and provider_message_id = btrim(p_provider_message_id);

    select coalesce(jsonb_agg(jsonb_build_object(
      'attachmentId', attachment_row.id,
      'providerAttachmentId', attachment_row.provider_attachment_id,
      'status', attachment_row.status,
      'contentType', attachment_row.content_type,
      'byteSize', attachment_row.byte_size
    ) order by attachment_row.created_at), '[]'::jsonb)
    into attachment_rows
    from public.refund_gmail_attachments attachment_row
    where attachment_row.gmail_message_id = message_row.id;

    return jsonb_build_object(
      'created', false,
      'skipped', false,
      'duplicate', true,
      'caseId', case_row.id,
      'messageId', message_row.id,
      'publicReference', case_row.public_reference,
      'participantRole', message_row.participant_role,
      'automaticCustomerContactPaused', false,
      'attachments', attachment_rows
    );
  end if;

  update public.refund_gmail_threads
  set
    latest_message_at = greatest(latest_message_at, received_at),
    retention_expires_at = greatest(retention_expires_at, retention_at),
    automatic_customer_contact_paused_at = case
      when customer_hard_bounce then coalesce(automatic_customer_contact_paused_at, received_at)
      else automatic_customer_contact_paused_at
    end,
    automatic_customer_contact_pause_reason = case
      when customer_hard_bounce then 'hard_bounce'
      else automatic_customer_contact_pause_reason
    end
  where id = thread_row.id;

  if participant_role = 'customer' then
    update public.refund_cases
    set
      status = case when status = 'waiting_on_customer' then 'needs_review' else status end,
      automation_state = 'customer_replied',
      automation_follow_up_due_at = null,
      updated_at = now()
    where id = case_row.id;

    insert into public.refund_case_events (
      refund_case_id, event_type, message, metadata, created_at
    ) values (
      case_row.id,
      'gmail_customer_message_received',
      'A verified customer message was added from the designated Gmail refund label.',
      jsonb_build_object(
        'participant_role', 'customer',
        'payload_redacted', true,
        'content_redacted', coalesce(p_sensitive_data_redacted, false)
      ),
      received_at
    );
  elsif participant_role = 'assigned_manager' then
    insert into public.refund_case_events (
      refund_case_id, event_type, message, metadata, created_at
    ) values (
      case_row.id,
      'gmail_manager_correspondence_received',
      'A currently mapped Machine Manager replied in the Gmail thread. Customer workflow state was not changed.',
      jsonb_build_object('participant_role', 'assigned_manager', 'payload_redacted', true),
      received_at
    );
  elsif customer_hard_bounce then
    insert into public.refund_case_events (
      refund_case_id, event_type, message, metadata, created_at
    ) values (
      case_row.id,
      'gmail_customer_message_bounced',
      'Gmail reported a hard delivery failure. Automatic customer contact is paused for manager recovery.',
      jsonb_build_object('automatic_contact_paused', true, 'payload_redacted', true),
      received_at
    );
  elsif coalesce(p_is_bounce, false) then
    insert into public.refund_case_events (
      refund_case_id, event_type, message, metadata, created_at
    ) values (
      case_row.id,
      'gmail_delivery_notice_received',
      'A delivery notice was retained for review, but it did not contain enough trusted evidence to pause customer contact.',
      jsonb_build_object('automatic_contact_paused', false, 'payload_redacted', true),
      received_at
    );
  elsif participant_role = 'unknown' then
    insert into public.refund_case_events (
      refund_case_id, event_type, message, metadata, created_at
    ) values (
      case_row.id,
      'gmail_unverified_participant_message_received',
      'An unverified participant message was retained for review without changing customer workflow state.',
      jsonb_build_object('participant_role', 'unknown', 'payload_redacted', true),
      received_at
    );
  end if;

  if participant_role = 'customer' then
    for attachment in
      select value
      from jsonb_array_elements(coalesce(p_attachments, '[]'::jsonb)) with ordinality as item(value, position)
      where position <= 10
    loop
      if length(btrim(coalesce(attachment ->> 'providerAttachmentId', ''))) between 1 and 512 then
        insert into public.refund_gmail_attachments (
          gmail_message_id,
          refund_case_id,
          provider_attachment_id,
          file_name,
          content_type,
          byte_size,
          disposition,
          status,
          rejection_code,
          retention_expires_at
        )
        values (
          message_row.id,
          case_row.id,
          btrim(attachment ->> 'providerAttachmentId'),
          left(coalesce(nullif(btrim(attachment ->> 'fileName'), ''), 'attachment'), 255),
          left(coalesce(nullif(lower(btrim(attachment ->> 'contentType')), ''), 'application/octet-stream'), 160),
          least(greatest(coalesce((attachment ->> 'byteSize')::integer, 0), 0), 26214400),
          case when lower(attachment ->> 'disposition') = 'inline' then 'inline' else 'attachment' end,
          case when coalesce((attachment ->> 'allowed')::boolean, false) then 'pending' else 'rejected' end,
          nullif(left(btrim(coalesce(attachment ->> 'rejectionCode', '')), 120), ''),
          retention_at
        )
        on conflict (gmail_message_id, provider_attachment_id) do nothing;
      end if;
    end loop;
  end if;

  select coalesce(jsonb_agg(jsonb_build_object(
    'attachmentId', attachment_row.id,
    'providerAttachmentId', attachment_row.provider_attachment_id,
    'status', attachment_row.status,
    'contentType', attachment_row.content_type,
    'byteSize', attachment_row.byte_size
  ) order by attachment_row.created_at), '[]'::jsonb)
  into attachment_rows
  from public.refund_gmail_attachments attachment_row
  where attachment_row.gmail_message_id = message_row.id;

  return jsonb_build_object(
    'created', true,
    'skipped', false,
    'duplicate', false,
    'caseId', case_row.id,
    'messageId', message_row.id,
    'publicReference', case_row.public_reference,
    'participantRole', participant_role,
    'automaticCustomerContactPaused', customer_hard_bounce,
    'attachments', attachment_rows
  );
end;
$$;

create or replace function public.service_claim_refund_gmail_outbound_v2(
  p_refund_case_id uuid,
  p_refund_case_message_id uuid,
  p_operation_key text,
  p_sender_email text,
  p_recipient_email text,
  p_plain_body text,
  p_mailbox_identities text[],
  p_delivery_kind text
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  thread_row public.refund_gmail_threads;
  latest_message public.refund_gmail_messages;
  outbound_row public.refund_gmail_messages;
  case_row public.refund_cases;
  recipient_resolution jsonb;
  manager_cc_emails text[] := '{}'::text[];
  mailbox_identities text[] := public.normalize_refund_mailbox_identities(p_mailbox_identities);
  normalized_sender text := lower(btrim(coalesce(p_sender_email, '')));
  normalized_recipient text := lower(btrim(coalesce(p_recipient_email, '')));
  normalized_delivery_kind text := lower(btrim(coalesce(p_delivery_kind, '')));
  reply_subject text;
  reply_references text;
begin
  if length(btrim(coalesce(p_operation_key, ''))) not between 8 and 255 then
    raise exception 'Valid Gmail outbound operation key required';
  end if;
  if normalized_delivery_kind not in ('manual', 'automatic') then
    raise exception 'Valid Gmail delivery kind required';
  end if;
  if coalesce(p_plain_body, '') ~* '/refunds\?case=' then
    raise exception 'Customer Gmail reply cannot contain an internal refund case link';
  end if;
  if not public.refund_email_address_is_valid(normalized_sender)
    or not (normalized_sender = any(mailbox_identities)) then
    raise exception 'Authorized refund mailbox sender required';
  end if;

  select * into case_row
  from public.refund_cases
  where id = p_refund_case_id;

  if case_row.id is null then
    return jsonb_build_object('linked', false, 'claimed', false);
  end if;
  if normalized_recipient <> lower(btrim(case_row.customer_email)) then
    raise exception 'Customer recipient must match the refund case';
  end if;

  select * into thread_row
  from public.refund_gmail_threads
  where refund_case_id = p_refund_case_id
  order by latest_message_at desc, id desc
  limit 1
  for update;

  if thread_row.id is null then
    return jsonb_build_object('linked', false, 'claimed', false);
  end if;
  if normalized_delivery_kind = 'automatic'
    and thread_row.automatic_customer_contact_paused_at is not null then
    return jsonb_build_object(
      'linked', true,
      'claimed', false,
      'status', 'automatic_contact_paused'
    );
  end if;

  recipient_resolution := public.service_resolve_refund_customer_manager_cc(
    p_refund_case_id,
    normalized_recipient,
    mailbox_identities
  );
  select coalesce(array_agg(value order by value), '{}'::text[])
  into manager_cc_emails
  from jsonb_array_elements_text(recipient_resolution -> 'managerCcEmails') value;

  select * into latest_message
  from public.refund_gmail_messages
  where gmail_thread_id = thread_row.id
    and message_kind = 'message'
  order by received_at desc, id desc
  limit 1;

  reply_subject := coalesce(nullif(btrim(latest_message.subject), ''), thread_row.thread_subject);
  reply_references := btrim(concat_ws(
    ' ',
    nullif(btrim(coalesce(latest_message.references_header, '')), ''),
    nullif(btrim(coalesce(latest_message.provider_message_header, '')), '')
  ));

  insert into public.refund_gmail_messages (
    gmail_thread_id,
    refund_case_id,
    refund_case_message_id,
    operation_key,
    direction,
    message_kind,
    status,
    sender_email,
    recipient_email,
    recipient_cc_emails,
    recipient_cc_count,
    recipient_resolution_status,
    delivery_kind,
    participant_role,
    participant_trust,
    subject,
    plain_body,
    received_at,
    retention_expires_at
  )
  values (
    thread_row.id,
    p_refund_case_id,
    p_refund_case_message_id,
    btrim(p_operation_key),
    'outbound',
    'message',
    'pending_send',
    normalized_sender,
    normalized_recipient,
    manager_cc_emails,
    cardinality(manager_cc_emails),
    recipient_resolution ->> 'status',
    normalized_delivery_kind,
    'mailbox',
    'verified',
    reply_subject,
    left(coalesce(p_plain_body, ''), 50000),
    now(),
    now() + interval '180 days'
  )
  on conflict (operation_key) do nothing
  returning * into outbound_row;

  if outbound_row.id is null then
    select * into outbound_row
    from public.refund_gmail_messages
    where operation_key = btrim(p_operation_key);

    return jsonb_build_object(
      'linked', true,
      'claimed', false,
      'transportMessageId', outbound_row.id,
      'status', outbound_row.status
    );
  end if;

  insert into public.refund_case_events (
    refund_case_id,
    event_type,
    message,
    metadata
  ) values (
    p_refund_case_id,
    case
      when recipient_resolution ->> 'status' in ('resolved', 'resolved_with_exclusions')
        then 'gmail_manager_cc_resolved'
      else 'gmail_manager_cc_exception'
    end,
    case
      when recipient_resolution ->> 'status' = 'resolved'
        then 'Current mapped Machine Managers were included on the customer Gmail reply.'
      when recipient_resolution ->> 'status' = 'resolved_with_exclusions'
        then 'Current mapped Machine Managers were included after unsafe or duplicate recipients were excluded.'
      when recipient_resolution ->> 'status' = 'machine_unresolved'
        then 'The customer Gmail reply has no manager CC because the machine is not resolved; operations triage is required.'
      when recipient_resolution ->> 'status' = 'no_active_managers'
        then 'The customer Gmail reply has no manager CC because the machine has no active manager mapping.'
      else 'The customer Gmail reply excluded invalid manager mappings; manager setup recovery is required.'
    end,
    jsonb_build_object(
      'recipient_resolution_status', recipient_resolution ->> 'status',
      'manager_cc_count', cardinality(manager_cc_emails),
      'payload_redacted', true
    )
  );

  return jsonb_build_object(
    'linked', true,
    'claimed', true,
    'transportMessageId', outbound_row.id,
    'providerThreadId', thread_row.provider_thread_id,
    'subject', reply_subject,
    'inReplyTo', latest_message.provider_message_header,
    'references', nullif(reply_references, ''),
    'managerCcEmails', to_jsonb(manager_cc_emails),
    'managerCcCount', cardinality(manager_cc_emails),
    'recipientResolutionStatus', recipient_resolution ->> 'status'
  );
end;
$$;

create or replace function public.service_purge_refund_gmail_expired_message_content(p_limit integer default 200)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  purged_count integer := 0;
begin
  with expired as (
    select message.id
    from public.refund_gmail_messages message
    where message.content_deleted_at is null
      and message.retention_expires_at <= now()
    order by message.retention_expires_at, message.id
    limit least(greatest(coalesce(p_limit, 200), 1), 500)
    for update skip locked
  )
  update public.refund_gmail_messages message
  set
    sender_email = null,
    sender_name = null,
    recipient_email = null,
    recipient_cc_emails = '{}'::text[],
    subject = '[Deleted after Gmail retention period]',
    plain_body = '[Deleted after Gmail retention period]',
    provider_message_header = null,
    references_header = null,
    content_deleted_at = now()
  from expired
  where message.id = expired.id;

  get diagnostics purged_count = row_count;

  update public.refund_gmail_threads thread
  set thread_subject = '[Deleted after Gmail retention period]'
  where thread.retention_expires_at <= now()
    and thread.thread_subject <> '[Deleted after Gmail retention period]';

  return purged_count;
end;
$$;

create or replace function public.admin_get_refund_gmail_case_context(p_refund_case_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = public, auth
as $$
declare
  actor_user_id uuid := auth.uid();
  latest_thread public.refund_gmail_threads;
begin
  if actor_user_id is null then
    raise exception 'Authentication required';
  end if;
  if not public.can_manage_refund_case(actor_user_id, p_refund_case_id) then
    raise exception 'Refund case access required';
  end if;

  select * into latest_thread
  from public.refund_gmail_threads
  where refund_case_id = p_refund_case_id
  order by latest_message_at desc, id desc
  limit 1;

  if latest_thread.id is null then
    return jsonb_build_object('connected', false, 'messages', '[]'::jsonb);
  end if;

  return jsonb_build_object(
    'connected', true,
    'subject', latest_thread.thread_subject,
    'latestMessageAt', latest_thread.latest_message_at,
    'automaticCustomerContactPaused', latest_thread.automatic_customer_contact_paused_at is not null,
    'automaticCustomerContactPauseReason', latest_thread.automatic_customer_contact_pause_reason,
    'messages', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', message.id,
        'direction', message.direction,
        'kind', message.message_kind,
        'status', message.status,
        'participantRole', message.participant_role,
        'participantTrust', message.participant_trust,
        'senderLabel', case message.participant_role
          when 'customer' then 'Customer'
          when 'assigned_manager' then 'Machine Manager'
          when 'mailbox' then 'Bloomjoy support'
          when 'automated_system' then 'Automated delivery system'
          else 'Unverified participant'
        end,
        'recipientSummary', case
          when message.direction = 'outbound' and message.recipient_cc_count > 0
            then 'Customer + ' || message.recipient_cc_count::text || ' mapped Machine Manager' ||
              case when message.recipient_cc_count = 1 then '' else 's' end
          when message.direction = 'outbound' then 'Customer'
          else 'Bloomjoy support'
        end,
        'managerCcCount', message.recipient_cc_count,
        'recipientResolutionStatus', message.recipient_resolution_status,
        'subject', message.subject,
        'body', message.plain_body,
        'receivedAt', message.received_at,
        'sentAt', message.sent_at,
        'sensitiveDataRedacted', message.sensitive_data_redacted,
        'contentDeleted', message.content_deleted_at is not null,
        'attachments', coalesce((
          select jsonb_agg(jsonb_build_object(
            'id', attachment.id,
            'fileName', attachment.file_name,
            'contentType', attachment.content_type,
            'byteSize', attachment.byte_size,
            'status', attachment.status,
            'rejectionCode', attachment.rejection_code
          ) order by attachment.created_at)
          from public.refund_gmail_attachments attachment
          where attachment.gmail_message_id = message.id
        ), '[]'::jsonb)
      ) order by message.received_at, message.id)
      from public.refund_gmail_messages message
      where message.refund_case_id = p_refund_case_id
    ), '[]'::jsonb)
  );
end;
$$;

-- The v1 service functions cannot carry participant trust or send-time CC
-- evidence. Fail closed if an old Edge bundle remains after this migration.
revoke execute on function public.service_ingest_refund_gmail_message(text,text,text,text,text,text,boolean,text,text,text,text,text,boolean,timestamptz,text,jsonb)
  from service_role;
revoke execute on function public.service_claim_refund_gmail_outbound(uuid,uuid,text,text,text,text)
  from service_role;

revoke execute on function public.refund_email_address_is_valid(text) from public, anon, authenticated;
revoke execute on function public.normalize_refund_mailbox_identities(text[]) from public, anon, authenticated;
revoke execute on function public.service_resolve_refund_customer_manager_cc(uuid,text,text[]) from public, anon, authenticated;
revoke execute on function public.service_ingest_refund_gmail_message_v2(text,text,text,text,text,text,boolean,text,text,text,text,text,boolean,timestamptz,text,jsonb,text[],text[],text,boolean,boolean,text[])
  from public, anon, authenticated;
revoke execute on function public.service_claim_refund_gmail_outbound_v2(uuid,uuid,text,text,text,text,text[],text)
  from public, anon, authenticated;

grant execute on function public.refund_email_address_is_valid(text) to service_role;
grant execute on function public.normalize_refund_mailbox_identities(text[]) to service_role;
grant execute on function public.service_resolve_refund_customer_manager_cc(uuid,text,text[]) to service_role;
grant execute on function public.service_ingest_refund_gmail_message_v2(text,text,text,text,text,text,boolean,text,text,text,text,text,boolean,timestamptz,text,jsonb,text[],text[],text,boolean,boolean,text[])
  to service_role;
grant execute on function public.service_claim_refund_gmail_outbound_v2(uuid,uuid,text,text,text,text,text[],text)
  to service_role;

comment on function public.service_resolve_refund_customer_manager_cc(uuid,text,text[]) is
  'Service-only current active machine-manager CC resolver. Raw addresses never reach browser roles or audit events.';
comment on function public.service_ingest_refund_gmail_message_v2(text,text,text,text,text,text,boolean,text,text,text,text,text,boolean,timestamptz,text,jsonb,text[],text[],text,boolean,boolean,text[]) is
  'Service-only participant-safe Gmail ingestion. Only verified direct customer messages can change customer workflow state.';
comment on function public.service_claim_refund_gmail_outbound_v2(uuid,uuid,text,text,text,text,text[],text) is
  'Service-only original-thread send claim with current mapped-manager CC resolution and automatic-contact pause enforcement.';

select pg_notify('pgrst', 'reload schema');
