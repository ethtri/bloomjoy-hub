-- Refund Pilot v1: customer contact is context, not a refund case.
--
-- This forward-only migration keeps unsubmitted Gmail contacts in a private,
-- service-only ledger. The hosted Bloomjoy form is the only operation that
-- creates a refund case. Linking is one-time and atomically moves the original
-- Gmail conversation into the existing case-thread model. No runtime switch is
-- enabled by this migration.

create table if not exists public.refund_gmail_intake_contacts (
  id uuid primary key default gen_random_uuid(),
  mailbox_hash text not null check (mailbox_hash ~ '^[a-f0-9]{64}$'),
  provider_thread_id text not null check (
    length(btrim(provider_thread_id)) between 1 and 255
  ),
  customer_email text not null check (public.refund_email_address_is_valid(customer_email)),
  customer_name text,
  thread_subject text not null check (length(thread_subject) between 1 and 998),
  first_message_at timestamptz not null,
  latest_message_at timestamptz not null,
  retention_expires_at timestamptz not null,
  status text not null default 'awaiting_form' check (
    status in ('awaiting_form', 'linked', 'expired')
  ),
  linked_refund_case_id uuid references public.refund_cases (id) on delete restrict,
  linked_at timestamptz,
  created_at timestamptz not null default clock_timestamp(),
  updated_at timestamptz not null default clock_timestamp(),
  constraint refund_gmail_intake_contacts_provider_unique
    unique (mailbox_hash, provider_thread_id),
  constraint refund_gmail_intake_contacts_link_state_check check (
    (status = 'linked' and linked_refund_case_id is not null and linked_at is not null)
    or (status <> 'linked' and linked_refund_case_id is null and linked_at is null)
  )
);

create index if not exists refund_gmail_intake_contacts_open_idx
  on public.refund_gmail_intake_contacts (latest_message_at, id)
  where status = 'awaiting_form';

create table if not exists public.refund_gmail_intake_contact_messages (
  id uuid primary key default gen_random_uuid(),
  contact_id uuid not null references public.refund_gmail_intake_contacts (id) on delete cascade,
  provider_message_id text,
  provider_message_header text,
  references_header text,
  operation_key text,
  direction text not null check (direction in ('inbound', 'outbound', 'system')),
  message_kind text not null default 'message' check (message_kind in ('message', 'bounce')),
  status text not null check (
    status in ('received', 'pending_send', 'sent', 'failed', 'delivery_unknown')
  ),
  sender_email text,
  sender_name text,
  recipient_email text,
  recipient_cc_emails text[] not null default '{}'::text[],
  participant_role text not null check (
    participant_role in ('customer', 'mailbox', 'automated_system', 'unknown')
  ),
  participant_trust text not null check (
    participant_trust in ('verified', 'unverified', 'forwarded', 'spoof_suspected', 'automated')
  ),
  subject text not null check (length(subject) between 1 and 998),
  plain_body text not null check (length(plain_body) <= 50000),
  sensitive_data_redacted boolean not null default false,
  received_at timestamptz not null,
  sent_at timestamptz,
  retention_expires_at timestamptz not null,
  created_at timestamptz not null default clock_timestamp(),
  updated_at timestamptz not null default clock_timestamp(),
  constraint refund_gmail_intake_contact_message_provider_unique
    unique (contact_id, provider_message_id),
  constraint refund_gmail_intake_contact_message_operation_unique
    unique (operation_key)
);

create index if not exists refund_gmail_intake_contact_messages_received_idx
  on public.refund_gmail_intake_contact_messages (contact_id, received_at, id);

create table if not exists public.refund_gmail_intake_contact_operations (
  id uuid primary key default gen_random_uuid(),
  contact_id uuid not null unique
    references public.refund_gmail_intake_contacts (id) on delete cascade,
  source_message_id uuid not null
    references public.refund_gmail_intake_contact_messages (id) on delete cascade,
  transport_message_id uuid
    references public.refund_gmail_intake_contact_messages (id) on delete set null,
  operation_key text not null unique check (length(operation_key) between 20 and 255),
  mode text not null check (mode in ('shadow', 'isolated_test', 'active')),
  template_key text not null check (length(template_key) between 8 and 120),
  prior_mailbox_reply_present boolean not null default false,
  status text not null check (
    status in ('shadowed', 'pending_send', 'sent', 'failed', 'delivery_unknown')
  ),
  cutover_at timestamptz,
  error_code text,
  claimed_at timestamptz not null default clock_timestamp(),
  reconciliation_checked_at timestamptz,
  reconciliation_attempt_count integer not null default 0 check (
    reconciliation_attempt_count >= 0
  ),
  reconciliation_no_match_version integer not null default 0 check (
    reconciliation_no_match_version >= 0
    and reconciliation_no_match_version <= reconciliation_attempt_count
  ),
  sent_at timestamptz,
  created_at timestamptz not null default clock_timestamp(),
  updated_at timestamptz not null default clock_timestamp(),
  constraint refund_gmail_intake_contact_operation_cutover_check check (
    mode = 'shadow' or cutover_at is not null
  )
);

create index if not exists refund_gmail_intake_contact_operations_recovery_idx
  on public.refund_gmail_intake_contact_operations (
    status,
    reconciliation_checked_at nulls first,
    claimed_at
  ) where status in ('pending_send', 'delivery_unknown');

create table if not exists public.refund_gmail_intake_contact_links (
  id uuid primary key default gen_random_uuid(),
  operation_id uuid not null unique
    references public.refund_gmail_intake_contact_operations (id) on delete cascade,
  contact_id uuid not null unique
    references public.refund_gmail_intake_contacts (id) on delete cascade,
  token_hash text not null unique check (token_hash ~ '^[0-9a-f]{64}$'),
  expires_at timestamptz not null,
  used_at timestamptz,
  linked_refund_case_id uuid references public.refund_cases (id) on delete restrict,
  created_at timestamptz not null default clock_timestamp(),
  constraint refund_gmail_intake_contact_link_expiry_check check (
    expires_at > created_at and expires_at <= created_at + interval '30 days'
  )
);

alter table public.refund_gmail_intake_contacts enable row level security;
alter table public.refund_gmail_intake_contact_messages enable row level security;
alter table public.refund_gmail_intake_contact_operations enable row level security;
alter table public.refund_gmail_intake_contact_links enable row level security;

revoke all on table public.refund_gmail_intake_contacts from public, anon, authenticated;
revoke all on table public.refund_gmail_intake_contact_messages from public, anon, authenticated;
revoke all on table public.refund_gmail_intake_contact_operations from public, anon, authenticated;
revoke all on table public.refund_gmail_intake_contact_links from public, anon, authenticated;
grant select, insert, update on table public.refund_gmail_intake_contacts to service_role;
grant select, insert, update on table public.refund_gmail_intake_contact_messages to service_role;
grant select, insert, update on table public.refund_gmail_intake_contact_operations to service_role;
grant select, insert, update on table public.refund_gmail_intake_contact_links to service_role;

create or replace function public.service_ingest_refund_gmail_contact_v1(
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
  contact_row public.refund_gmail_intake_contacts;
  message_row public.refund_gmail_intake_contact_messages;
  matched_case_id uuid;
  requested_direction text := lower(btrim(coalesce(p_direction, '')));
  normalized_sender_email text := lower(btrim(coalesce(p_sender_email, '')));
  normalized_recipient_email text := lower(left(btrim(coalesce(p_recipient_email, '')), 320));
  normalized_subject text := left(btrim(coalesce(p_subject, '')), 998);
  normalized_body text := left(coalesce(p_plain_body, ''), 50000);
  normalized_trust text := lower(btrim(coalesce(p_participant_trust, 'unverified')));
  mailbox_identities text[] := public.normalize_refund_mailbox_identities(p_mailbox_identities);
  normalized_cc_emails text[] := '{}'::text[];
  participant_role text := 'unknown';
  stored_direction text := 'system';
  stored_trust text := 'unverified';
  received_at timestamptz := coalesce(p_received_at, now());
begin
  if coalesce(p_mailbox_hash, '') !~ '^[a-f0-9]{64}$'
    or length(btrim(coalesce(p_provider_thread_id, ''))) not between 1 and 255
    or length(btrim(coalesce(p_provider_message_id, ''))) not between 1 and 255 then
    raise exception 'Valid Gmail contact identifiers required';
  end if;
  if requested_direction not in ('inbound', 'outbound', 'system')
    or normalized_trust not in ('direct_human', 'forwarded', 'spoof_suspected', 'automated') then
    raise exception 'Valid Gmail contact participant signals required';
  end if;
  if jsonb_array_length(coalesce(p_attachments, '[]'::jsonb)) > 0 then
    return jsonb_build_object(
      'created', false,
      'skipped', true,
      'reason', 'attachments_disabled'
    );
  end if;
  if normalized_subject = '' then normalized_subject := '(no subject)'; end if;

  select thread.refund_case_id into matched_case_id
  from public.refund_gmail_threads thread
  where thread.mailbox_hash = p_mailbox_hash
    and thread.provider_thread_id = btrim(p_provider_thread_id);

  if matched_case_id is not null then
    return public.service_ingest_refund_gmail_message_v2(
      p_mailbox_hash, p_provider_thread_id, p_provider_message_id,
      p_provider_message_header, p_references_header, p_direction, p_is_bounce,
      p_sender_email, p_sender_name, p_recipient_email, p_subject, p_plain_body,
      p_sensitive_data_redacted, p_received_at, p_public_reference, p_attachments,
      p_recipient_cc_emails, p_mailbox_identities, p_participant_trust,
      p_provider_sent, p_is_hard_bounce, p_failed_recipient_emails
    );
  end if;

  select contact.* into contact_row
  from public.refund_gmail_intake_contacts contact
  where contact.mailbox_hash = p_mailbox_hash
    and contact.provider_thread_id = btrim(p_provider_thread_id)
  for update;

  if contact_row.status = 'linked' and contact_row.linked_refund_case_id is not null then
    return public.service_ingest_refund_gmail_message_v2(
      p_mailbox_hash, p_provider_thread_id, p_provider_message_id,
      p_provider_message_header, p_references_header, p_direction, p_is_bounce,
      p_sender_email, p_sender_name, p_recipient_email, p_subject, p_plain_body,
      p_sensitive_data_redacted, p_received_at, p_public_reference, p_attachments,
      p_recipient_cc_emails, p_mailbox_identities, p_participant_trust,
      p_provider_sent, p_is_hard_bounce, p_failed_recipient_emails
    );
  end if;

  if contact_row.id is null and nullif(btrim(coalesce(p_public_reference, '')), '') is not null then
    select refund_case.id into matched_case_id
    from public.refund_cases refund_case
    where upper(refund_case.public_reference) = upper(btrim(p_public_reference))
      and lower(refund_case.customer_email) = normalized_sender_email
    order by refund_case.created_at desc
    limit 1;
    if matched_case_id is not null then
      return public.service_ingest_refund_gmail_message_v2(
        p_mailbox_hash, p_provider_thread_id, p_provider_message_id,
        p_provider_message_header, p_references_header, p_direction, p_is_bounce,
        p_sender_email, p_sender_name, p_recipient_email, p_subject, p_plain_body,
        p_sensitive_data_redacted, p_received_at, p_public_reference, p_attachments,
        p_recipient_cc_emails, p_mailbox_identities, p_participant_trust,
        p_provider_sent, p_is_hard_bounce, p_failed_recipient_emails
      );
    end if;
  end if;

  if contact_row.id is null then
    if requested_direction <> 'inbound'
      or coalesce(p_is_bounce, false)
      or normalized_trust <> 'direct_human'
      or normalized_sender_email = any(mailbox_identities)
      or not public.refund_email_address_is_valid(normalized_sender_email)
      or exists (
        select 1
        from public.reporting_machine_refund_managers manager
        where manager.status = 'active'
          and manager.revoked_at is null
          and lower(btrim(manager.manager_email)) = normalized_sender_email
      ) then
      return jsonb_build_object(
        'created', false,
        'skipped', true,
        'reason', 'unlinked_non_customer_message'
      );
    end if;

    perform pg_advisory_xact_lock(
      hashtextextended(p_mailbox_hash || ':' || btrim(p_provider_thread_id), 0)
    );
    insert into public.refund_gmail_intake_contacts (
      mailbox_hash, provider_thread_id, customer_email, customer_name,
      thread_subject, first_message_at, latest_message_at, retention_expires_at
    ) values (
      p_mailbox_hash,
      btrim(p_provider_thread_id),
      normalized_sender_email,
      nullif(left(btrim(coalesce(p_sender_name, '')), 160), ''),
      normalized_subject,
      received_at,
      received_at,
      clock_timestamp() + interval '30 days'
    ) on conflict (mailbox_hash, provider_thread_id) do nothing;

    select contact.* into contact_row
    from public.refund_gmail_intake_contacts contact
    where contact.mailbox_hash = p_mailbox_hash
      and contact.provider_thread_id = btrim(p_provider_thread_id)
    for update;
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

  if coalesce(p_is_bounce, false) then
    participant_role := 'automated_system'; stored_direction := 'system'; stored_trust := 'automated';
  elsif coalesce(p_provider_sent, false)
    and normalized_sender_email = any(mailbox_identities)
    and normalized_trust not in ('forwarded', 'spoof_suspected') then
    participant_role := 'mailbox'; stored_direction := 'outbound'; stored_trust := 'verified';
  elsif normalized_trust = 'automated' or requested_direction = 'system' then
    participant_role := 'automated_system'; stored_direction := 'system'; stored_trust := 'automated';
  elsif normalized_trust = 'direct_human'
    and normalized_sender_email = contact_row.customer_email then
    participant_role := 'customer'; stored_direction := 'inbound'; stored_trust := 'verified';
  else
    participant_role := 'unknown'; stored_direction := 'system';
    stored_trust := case
      when normalized_trust = 'forwarded' then 'forwarded'
      when normalized_trust = 'spoof_suspected' then 'spoof_suspected'
      else 'unverified'
    end;
  end if;

  insert into public.refund_gmail_intake_contact_messages (
    contact_id, provider_message_id, provider_message_header, references_header,
    direction, message_kind, status, sender_email, sender_name, recipient_email,
    recipient_cc_emails, participant_role, participant_trust, subject, plain_body,
    sensitive_data_redacted, received_at, sent_at, retention_expires_at
  ) values (
    contact_row.id,
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
    participant_role,
    stored_trust,
    normalized_subject,
    normalized_body,
    coalesce(p_sensitive_data_redacted, false),
    received_at,
    case when stored_direction = 'outbound' then received_at else null end,
    clock_timestamp() + interval '30 days'
  ) on conflict (contact_id, provider_message_id) do nothing
  returning * into message_row;

  update public.refund_gmail_intake_contacts
  set
    latest_message_at = greatest(latest_message_at, received_at),
    retention_expires_at = greatest(retention_expires_at, clock_timestamp() + interval '30 days'),
    updated_at = clock_timestamp()
  where id = contact_row.id;

  if message_row.id is null then
    select message.* into message_row
    from public.refund_gmail_intake_contact_messages message
    where message.contact_id = contact_row.id
      and message.provider_message_id = btrim(p_provider_message_id);
    return jsonb_build_object(
      'created', false,
      'duplicate', true,
      'contactOnly', true,
      'contactId', contact_row.id,
      'messageId', message_row.id,
      'participantRole', message_row.participant_role,
      'attachments', '[]'::jsonb
    );
  end if;

  return jsonb_build_object(
    'created', true,
    'duplicate', false,
    'contactOnly', true,
    'contactId', contact_row.id,
    'messageId', message_row.id,
    'participantRole', message_row.participant_role,
    'attachments', '[]'::jsonb
  );
end;
$$;

create or replace function public.service_claim_refund_gmail_contact_first_response(
  p_source_message_id uuid,
  p_mode text,
  p_cutover_at timestamptz,
  p_template_key text,
  p_sender_email text,
  p_plain_body text,
  p_thread_has_outbound boolean default false
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  source_row public.refund_gmail_intake_contact_messages;
  contact_row public.refund_gmail_intake_contacts;
  operation_row public.refund_gmail_intake_contact_operations;
  transport_row public.refund_gmail_intake_contact_messages;
  normalized_mode text := lower(btrim(coalesce(p_mode, '')));
  normalized_template_key text := left(btrim(coalesce(p_template_key, '')), 120);
  normalized_sender_email text := lower(btrim(coalesce(p_sender_email, '')));
  first_inbound_id uuid;
  prior_mailbox_reply_present boolean := false;
  operation_key_value text;
  reply_subject text;
  reply_references text;
begin
  if normalized_mode not in ('shadow', 'isolated_test', 'active') then
    raise exception 'Valid first-contact mode required';
  end if;
  if normalized_mode <> 'shadow' and p_cutover_at is null then
    raise exception 'First-contact cutover time required';
  end if;

  select * into source_row
  from public.refund_gmail_intake_contact_messages message
  where message.id = p_source_message_id
  for update;
  if source_row.id is null then
    return jsonb_build_object('eligible', false, 'claimed', false, 'reason', 'source_not_found');
  end if;

  select * into contact_row
  from public.refund_gmail_intake_contacts contact
  where contact.id = source_row.contact_id
  for update;
  if contact_row.id is null or contact_row.status <> 'awaiting_form'
    or source_row.direction <> 'inbound'
    or source_row.message_kind <> 'message'
    or source_row.status <> 'received'
    or source_row.participant_role <> 'customer'
    or source_row.participant_trust <> 'verified'
    or lower(coalesce(source_row.sender_email, '')) <> contact_row.customer_email then
    return jsonb_build_object('eligible', false, 'claimed', false, 'reason', 'contact_not_eligible');
  end if;

  select message.id into first_inbound_id
  from public.refund_gmail_intake_contact_messages message
  where message.contact_id = contact_row.id
    and message.direction = 'inbound'
    and message.message_kind = 'message'
    and message.status = 'received'
  order by message.received_at, message.id
  limit 1;
  if first_inbound_id is distinct from source_row.id then
    return jsonb_build_object('eligible', false, 'claimed', false, 'reason', 'later_thread_message');
  end if;
  if normalized_mode <> 'shadow' and source_row.received_at < p_cutover_at then
    return jsonb_build_object('eligible', false, 'claimed', false, 'reason', 'before_cutover');
  end if;

  select * into operation_row
  from public.refund_gmail_intake_contact_operations operation
  where operation.contact_id = contact_row.id;
  if operation_row.id is not null then
    return jsonb_build_object(
      'eligible', true,
      'claimed', false,
      'operationId', operation_row.id,
      'status', operation_row.status,
      'mode', operation_row.mode,
      'operationKey', operation_row.operation_key,
      'providerThreadId', contact_row.provider_thread_id,
      'reason', 'operation_already_exists'
    );
  end if;

  prior_mailbox_reply_present := coalesce(p_thread_has_outbound, false) or exists (
    select 1 from public.refund_gmail_intake_contact_messages message
    where message.contact_id = contact_row.id
      and message.direction = 'outbound'
      and message.message_kind = 'message'
  );
  if normalized_mode <> 'shadow' and prior_mailbox_reply_present then
    return jsonb_build_object('eligible', false, 'claimed', false, 'reason', 'prior_mailbox_reply');
  end if;

  operation_key_value := 'refund-contact-first-response:' || contact_row.id::text;
  insert into public.refund_gmail_intake_contact_operations (
    contact_id, source_message_id, operation_key, mode, template_key,
    prior_mailbox_reply_present, status, cutover_at
  ) values (
    contact_row.id, source_row.id, operation_key_value, normalized_mode,
    normalized_template_key, prior_mailbox_reply_present,
    case when normalized_mode = 'shadow' then 'shadowed' else 'pending_send' end,
    case when normalized_mode = 'shadow' then null else p_cutover_at end
  ) returning * into operation_row;

  if normalized_mode = 'shadow' then
    return jsonb_build_object(
      'eligible', true, 'claimed', true, 'operationId', operation_row.id,
      'status', operation_row.status, 'mode', operation_row.mode,
      'templateKey', operation_row.template_key
    );
  end if;

  if not public.refund_email_address_is_valid(normalized_sender_email)
    or length(coalesce(p_plain_body, '')) not between 1 and 50000 then
    raise exception 'Valid first-contact delivery values required';
  end if;
  if p_plain_body ~* '/refunds\?case=' then
    raise exception 'Customer first-contact body must not contain an internal case link';
  end if;

  reply_subject := coalesce(nullif(btrim(source_row.subject), ''), contact_row.thread_subject);
  reply_references := btrim(concat_ws(
    ' ', nullif(btrim(coalesce(source_row.references_header, '')), ''),
    nullif(btrim(coalesce(source_row.provider_message_header, '')), '')
  ));
  insert into public.refund_gmail_intake_contact_messages (
    contact_id, operation_key, direction, message_kind, status, sender_email,
    recipient_email, recipient_cc_emails, participant_role, participant_trust,
    subject, plain_body, received_at, retention_expires_at
  ) values (
    contact_row.id, operation_key_value, 'outbound', 'message', 'pending_send',
    normalized_sender_email, contact_row.customer_email, '{}'::text[], 'mailbox',
    'verified', reply_subject, left(p_plain_body, 50000), clock_timestamp(),
    clock_timestamp() + interval '30 days'
  ) returning * into transport_row;

  update public.refund_gmail_intake_contact_operations
  set transport_message_id = transport_row.id
  where id = operation_row.id
  returning * into operation_row;

  return jsonb_build_object(
    'eligible', true, 'claimed', true, 'operationId', operation_row.id,
    'status', operation_row.status, 'mode', operation_row.mode,
    'templateKey', operation_row.template_key, 'operationKey', operation_row.operation_key,
    'transportMessageId', transport_row.id,
    'providerThreadId', contact_row.provider_thread_id,
    'recipientEmail', contact_row.customer_email,
    'subject', reply_subject,
    'inReplyTo', source_row.provider_message_header,
    'references', nullif(reply_references, '')
  );
end;
$$;

create or replace function public.service_register_refund_gmail_contact_link(
  p_operation_id uuid,
  p_token_hash text,
  p_expires_at timestamptz
)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  operation_row public.refund_gmail_intake_contact_operations;
begin
  if p_operation_id is null or coalesce(p_token_hash, '') !~ '^[0-9a-f]{64}$'
    or p_expires_at <= now() or p_expires_at > now() + interval '30 days' then
    return false;
  end if;
  select * into operation_row
  from public.refund_gmail_intake_contact_operations operation
  where operation.id = p_operation_id
  for update;
  if operation_row.id is null or operation_row.mode not in ('isolated_test', 'active')
    or operation_row.status <> 'pending_send' then
    return false;
  end if;
  insert into public.refund_gmail_intake_contact_links (
    operation_id, contact_id, token_hash, expires_at
  ) values (
    operation_row.id, operation_row.contact_id, lower(p_token_hash), p_expires_at
  ) on conflict (operation_id) do update
  set token_hash = excluded.token_hash, expires_at = excluded.expires_at
  where public.refund_gmail_intake_contact_links.used_at is null;
  return found;
end;
$$;

create or replace function public.service_prepare_refund_gmail_contact_first_response(
  p_operation_id uuid,
  p_mailbox_identities text[]
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  operation_row public.refund_gmail_intake_contact_operations;
  source_row public.refund_gmail_intake_contact_messages;
  transport_row public.refund_gmail_intake_contact_messages;
  contact_row public.refund_gmail_intake_contacts;
  mailbox_identities text[] := public.normalize_refund_mailbox_identities(p_mailbox_identities);
begin
  if p_operation_id is null or cardinality(mailbox_identities) = 0 then
    raise exception 'Valid contact operation and mailbox identities required';
  end if;
  select * into operation_row from public.refund_gmail_intake_contact_operations
  where id = p_operation_id for update;
  select * into source_row from public.refund_gmail_intake_contact_messages
  where id = operation_row.source_message_id for update;
  select * into transport_row from public.refund_gmail_intake_contact_messages
  where id = operation_row.transport_message_id for update;
  select * into contact_row from public.refund_gmail_intake_contacts
  where id = operation_row.contact_id for update;
  if operation_row.id is null or operation_row.mode not in ('isolated_test', 'active')
    or operation_row.status <> 'pending_send'
    or contact_row.status <> 'awaiting_form'
    or source_row.participant_role <> 'customer'
    or source_row.participant_trust <> 'verified'
    or transport_row.status <> 'pending_send'
    or lower(coalesce(transport_row.recipient_email, '')) <> contact_row.customer_email
    or not exists (
      select 1 from public.refund_gmail_intake_contact_links link
      where link.operation_id = operation_row.id
        and link.used_at is null and link.expires_at > now()
    ) then
    return jsonb_build_object('allowed', false, 'status', 'contact_first_response_blocked');
  end if;
  update public.refund_gmail_intake_contact_messages
  set recipient_cc_emails = '{}'::text[], updated_at = clock_timestamp()
  where id = transport_row.id;
  return jsonb_build_object(
    'allowed', true,
    'status', 'premapping_acknowledgement',
    'managerCcEmails', '[]'::jsonb,
    'managerCcCount', 0
  );
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
set search_path = public
as $$
declare
  operation_row public.refund_gmail_intake_contact_operations;
  normalized_status text := lower(btrim(coalesce(p_status, '')));
  normalized_provider_message_id text := nullif(left(btrim(coalesce(p_provider_message_id, '')), 255), '');
  normalized_provider_message_header text := nullif(left(btrim(coalesce(p_provider_message_header, '')), 998), '');
  normalized_error_code text := nullif(left(btrim(coalesce(p_error_code, '')), 120), '');
  expected_provider_message_header text;
begin
  if normalized_status not in ('sent', 'failed', 'delivery_unknown') then
    raise exception 'Valid contact completion status required';
  end if;
  select * into operation_row
  from public.refund_gmail_intake_contact_operations operation
  where operation.id = p_operation_id for update;
  if operation_row.id is null then return false; end if;
  expected_provider_message_header := '<refund-' || left(
    regexp_replace(operation_row.operation_key, '[^a-zA-Z0-9._-]', '', 'g'), 80
  ) || '@bloomjoyusa.com>';
  if normalized_status = 'sent' then
    if normalized_provider_message_id is null
      or normalized_provider_message_header is distinct from expected_provider_message_header then
      raise exception 'Confirmed contact provider evidence required';
    end if;
    if p_attempt_version is not null and (
      p_attempt_version < 1
      or operation_row.reconciliation_attempt_count <> p_attempt_version
    ) then return false; end if;
    if operation_row.status = 'delivery_unknown' and p_attempt_version is null then
      return false;
    end if;
  elsif normalized_error_code is null then
    raise exception 'Safe contact delivery failure code required';
  end if;
  if operation_row.status <> 'pending_send' then
    if operation_row.status = 'sent' and normalized_status = 'sent' then return true; end if;
    if not (operation_row.status = 'delivery_unknown' and normalized_status = 'sent') then
      return false;
    end if;
  end if;
  update public.refund_gmail_intake_contact_messages
  set
    status = normalized_status,
    provider_message_id = case when normalized_status = 'sent' then normalized_provider_message_id else provider_message_id end,
    provider_message_header = case when normalized_status = 'sent' then normalized_provider_message_header else provider_message_header end,
    sent_at = case when normalized_status = 'sent' then clock_timestamp() else sent_at end,
    updated_at = clock_timestamp()
  where id = operation_row.transport_message_id
    and (status = 'pending_send' or (normalized_status = 'sent' and status = 'delivery_unknown'));
  if not found then return false; end if;
  update public.refund_gmail_intake_contact_operations
  set
    status = normalized_status,
    error_code = case when normalized_status = 'sent' then null else normalized_error_code end,
    sent_at = case when normalized_status = 'sent' then clock_timestamp() else sent_at end,
    updated_at = clock_timestamp()
  where id = operation_row.id;
  return true;
end;
$$;

create or replace function public.service_mark_stale_refund_gmail_contact_responses_unknown(
  p_stale_before timestamptz
)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  stale_operation record;
  transitioned integer := 0;
begin
  if p_stale_before is null or p_stale_before > now() - interval '5 minutes' then
    raise exception 'A safe stale contact boundary is required';
  end if;
  for stale_operation in
    select operation.id
    from public.refund_gmail_intake_contact_operations operation
    where operation.status = 'pending_send' and operation.claimed_at <= p_stale_before
    order by operation.claimed_at, operation.id
    limit 100 for update skip locked
  loop
    if public.service_finish_refund_gmail_contact_first_response(
      stale_operation.id, 'delivery_unknown', null, null,
      'stale_pending_reconciliation_required'
    ) then transitioned := transitioned + 1; end if;
  end loop;
  return transitioned;
end;
$$;

create or replace function public.service_claim_refund_gmail_contact_reconciliation_batch(
  p_limit integer default 100
)
returns table (
  operation_id uuid,
  operation_key text,
  provider_thread_id text,
  operation_status text,
  attempt_version integer
)
language plpgsql
security definer
set search_path = public
as $$
begin
  return query
  with candidates as (
    select operation.id
    from public.refund_gmail_intake_contact_operations operation
    where operation.status in ('pending_send', 'delivery_unknown')
      and (
        operation.reconciliation_attempt_count = operation.reconciliation_no_match_version
        or operation.reconciliation_checked_at <= now() - interval '5 minutes'
      )
    order by operation.reconciliation_checked_at nulls first, operation.claimed_at, operation.id
    limit least(greatest(coalesce(p_limit, 100), 1), 500)
    for update skip locked
  ), claimed as (
    update public.refund_gmail_intake_contact_operations operation
    set
      reconciliation_checked_at = clock_timestamp(),
      reconciliation_attempt_count = operation.reconciliation_attempt_count + 1,
      updated_at = clock_timestamp()
    from candidates
    where operation.id = candidates.id
    returning operation.*
  )
  select claimed.id, claimed.operation_key, contact.provider_thread_id,
    claimed.status, claimed.reconciliation_attempt_count
  from claimed
  join public.refund_gmail_intake_contacts contact on contact.id = claimed.contact_id
  order by claimed.reconciliation_checked_at, claimed.claimed_at, claimed.id;
end;
$$;

create or replace function public.service_count_refund_gmail_contact_response_reconciliation()
returns integer
language sql
stable
security definer
set search_path = public
as $$
  select count(*)::integer
  from public.refund_gmail_intake_contact_operations operation
  where operation.status in ('pending_send', 'delivery_unknown');
$$;

create or replace function public.service_finish_refund_gmail_contact_response_no_match(
  p_operation_id uuid,
  p_attempt_version integer
)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
begin
  if coalesce(p_attempt_version, 0) < 1 then return false; end if;
  update public.refund_gmail_intake_contact_operations
  set
    reconciliation_no_match_version = p_attempt_version,
    updated_at = clock_timestamp()
  where id = p_operation_id
    and status = 'delivery_unknown'
    and reconciliation_attempt_count = p_attempt_version;
  return found;
end;
$$;

create or replace function public.service_purge_refund_gmail_intake_contacts(
  p_run_id uuid,
  p_run_token uuid,
  p_limit integer default 500
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  run_row public.refund_gmail_retention_runs;
  purge_limit integer := least(greatest(coalesce(p_limit, 500), 1), 500);
  contact_count integer := 0;
  remaining_due integer := 0;
begin
  select * into run_row
  from public.refund_gmail_retention_runs run
  where run.id = p_run_id
    and run.claim_token = p_run_token
  for update;
  if run_row.id is null or run_row.status <> 'running' then
    return jsonb_build_object(
      'purged', false,
      'status', 'run_not_claimed',
      'payloadRedacted', true
    );
  end if;

  with expired as (
    select contact.id
    from public.refund_gmail_intake_contacts contact
    where contact.retention_expires_at <= clock_timestamp()
    order by contact.retention_expires_at, contact.id
    limit purge_limit
    for update skip locked
  )
  delete from public.refund_gmail_intake_contacts contact
  using expired
  where contact.id = expired.id;
  get diagnostics contact_count = row_count;

  select count(*)::integer into remaining_due
  from public.refund_gmail_intake_contacts contact
  where contact.retention_expires_at <= clock_timestamp();

  return jsonb_build_object(
    'purged', true,
    'status', case when remaining_due = 0 then 'purged' else 'batch_incomplete' end,
    'contactsPurged', contact_count,
    'remainingDue', remaining_due,
    'payloadRedacted', true
  );
end;
$$;

create or replace function public.service_create_refund_case_from_gmail_contact_form(
  p_token_hash text,
  p_customer_email text,
  p_case_values jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  link_row public.refund_gmail_intake_contact_links;
  contact_row public.refund_gmail_intake_contacts;
  operation_row public.refund_gmail_intake_contact_operations;
  case_row public.refund_cases;
  gmail_thread_row public.refund_gmail_threads;
  normalized_email text := lower(btrim(coalesce(p_customer_email, '')));
  dedupe_key text := nullif(p_case_values ->> 'serverDedupeKey', '');
  result jsonb;
begin
  if coalesce(p_token_hash, '') !~ '^[0-9a-f]{64}$'
    or not public.refund_email_address_is_valid(normalized_email)
    or jsonb_typeof(p_case_values) <> 'object' then
    return null;
  end if;
  select * into link_row
  from public.refund_gmail_intake_contact_links link
  where link.token_hash = lower(p_token_hash)
  for update;
  if link_row.id is null or link_row.used_at is not null or link_row.expires_at <= now() then
    return null;
  end if;
  select * into contact_row
  from public.refund_gmail_intake_contacts contact
  where contact.id = link_row.contact_id
  for update;
  select * into operation_row
  from public.refund_gmail_intake_contact_operations operation
  where operation.id = link_row.operation_id
  for update;
  if contact_row.id is null or contact_row.status <> 'awaiting_form'
    or contact_row.customer_email <> normalized_email
    or operation_row.id is null or operation_row.status <> 'sent' then
    return null;
  end if;

  begin
    insert into public.refund_cases (
      reporting_machine_id, reporting_location_id, customer_email, customer_name,
      customer_phone, zelle_payment_contact, issue_summary, incident_at,
      incident_local_datetime, incident_timezone, incident_time_resolution,
      payment_method, payment_amount_cents, card_last4, card_wallet_used,
      payment_interaction, wallet_provider, incident_time_confidence,
      issue_category, product_description, status, correlation_status,
      correlation_source, correlation_confidence, correlation_summary,
      matched_sales_fact_id, cash_match_evaluated_fact_version,
      refund_amount_cents, intake_source, intake_meta, server_dedupe_key,
      server_dedupe_window_started_at
    ) values (
      (p_case_values ->> 'reportingMachineId')::uuid,
      (p_case_values ->> 'reportingLocationId')::uuid,
      normalized_email,
      nullif(p_case_values ->> 'customerName', ''),
      nullif(p_case_values ->> 'customerPhone', ''),
      nullif(p_case_values ->> 'zellePaymentContact', ''),
      p_case_values ->> 'issueSummary',
      (p_case_values ->> 'incidentAt')::timestamptz,
      nullif(p_case_values ->> 'incidentLocalDateTime', ''),
      nullif(p_case_values ->> 'incidentTimezone', ''),
      nullif(p_case_values ->> 'incidentTimeResolution', ''),
      p_case_values ->> 'paymentMethod',
      (p_case_values ->> 'paymentAmountCents')::integer,
      nullif(p_case_values ->> 'cardLast4', ''),
      coalesce((p_case_values ->> 'cardWalletUsed')::boolean, false),
      coalesce(nullif(p_case_values ->> 'paymentInteraction', ''), 'unsure'),
      nullif(p_case_values ->> 'walletProvider', ''),
      coalesce(nullif(p_case_values ->> 'incidentTimeConfidence', ''), 'rough'),
      coalesce(nullif(p_case_values ->> 'issueCategory', ''), 'other'),
      nullif(p_case_values ->> 'productDescription', ''),
      p_case_values ->> 'status',
      p_case_values ->> 'correlationStatus',
      nullif(p_case_values ->> 'correlationSource', ''),
      coalesce((p_case_values ->> 'correlationConfidence')::numeric, 0),
      nullif(p_case_values ->> 'correlationSummary', ''),
      nullif(p_case_values ->> 'matchedSalesFactId', '')::uuid,
      case when p_case_values ->> 'paymentMethod' = 'cash' then 1 else null end,
      (p_case_values ->> 'paymentAmountCents')::integer,
      'form',
      coalesce(p_case_values -> 'intakeMeta', '{}'::jsonb) || jsonb_build_object(
        'source', 'hosted_refund_intake',
        'intake_path', 'email_context_form',
        'gmail_contact_linked', true,
        'contact_alone_created_case', false
      ),
      dedupe_key,
      nullif(p_case_values ->> 'serverDedupeWindowStartedAt', '')::timestamptz
    ) returning * into case_row;
  exception when unique_violation then
    if dedupe_key is null then raise; end if;
    select * into case_row
    from public.refund_cases refund_case
    where refund_case.server_dedupe_key = dedupe_key
      and lower(refund_case.customer_email) = normalized_email
    order by refund_case.created_at desc
    limit 1
    for update;
    if case_row.id is null then raise; end if;
  end;

  insert into public.refund_gmail_threads (
    refund_case_id, mailbox_hash, provider_thread_id, thread_subject,
    first_message_at, latest_message_at, retention_expires_at
  ) values (
    case_row.id, contact_row.mailbox_hash, contact_row.provider_thread_id,
    contact_row.thread_subject, contact_row.first_message_at,
    contact_row.latest_message_at, clock_timestamp() + interval '180 days'
  ) returning * into gmail_thread_row;

  insert into public.refund_gmail_messages (
    gmail_thread_id, refund_case_id, provider_message_id,
    provider_message_header, references_header, operation_key, direction,
    message_kind, status, sender_email, sender_name, recipient_email,
    recipient_cc_emails, recipient_cc_count, participant_role,
    participant_trust, recipient_resolution_status, delivery_kind,
    subject, plain_body, sensitive_data_redacted, received_at, sent_at,
    retention_expires_at
  )
  select
    gmail_thread_row.id, case_row.id, message.provider_message_id,
    message.provider_message_header, message.references_header,
    message.operation_key, message.direction, message.message_kind,
    message.status, message.sender_email, message.sender_name,
    message.recipient_email, message.recipient_cc_emails,
    cardinality(message.recipient_cc_emails), message.participant_role,
    message.participant_trust,
    case when message.operation_key = operation_row.operation_key
      then 'premapping_acknowledgement' else null end,
    case when message.operation_key = operation_row.operation_key
      then 'automatic' else null end,
    message.subject, message.plain_body, message.sensitive_data_redacted,
    message.received_at, message.sent_at, clock_timestamp() + interval '180 days'
  from public.refund_gmail_intake_contact_messages message
  where message.contact_id = contact_row.id
  order by message.received_at, message.id;

  update public.refund_gmail_intake_contacts
  set
    status = 'linked', linked_refund_case_id = case_row.id,
    linked_at = clock_timestamp(), retention_expires_at = clock_timestamp(),
    updated_at = clock_timestamp()
  where id = contact_row.id;
  update public.refund_gmail_intake_contact_links
  set used_at = clock_timestamp(), linked_refund_case_id = case_row.id
  where id = link_row.id;

  insert into public.refund_case_events (
    refund_case_id, event_type, message, metadata
  ) values (
    case_row.id,
    'email_contact_hosted_form_linked',
    'The hosted Bloomjoy refund form created the case and linked the originating email conversation.',
    jsonb_build_object(
      'payload_redacted', true,
      'official_action', false,
      'intake_path', 'email_context_form',
      'contact_alone_created_case', false,
      'first_response_status', operation_row.status
    )
  );

  select jsonb_build_object(
    'id', refund_case.id,
    'public_reference', refund_case.public_reference,
    'status', refund_case.status,
    'correlation_status', refund_case.correlation_status
  ) into result
  from public.refund_cases refund_case
  where refund_case.id = case_row.id;
  return result;
end;
$$;

do $$
declare
  function_signature regprocedure;
begin
  foreach function_signature in array array[
    'public.service_ingest_refund_gmail_contact_v1(text,text,text,text,text,text,boolean,text,text,text,text,text,boolean,timestamptz,text,jsonb,text[],text[],text,boolean,boolean,text[])'::regprocedure,
    'public.service_claim_refund_gmail_contact_first_response(uuid,text,timestamptz,text,text,text,boolean)'::regprocedure,
    'public.service_register_refund_gmail_contact_link(uuid,text,timestamptz)'::regprocedure,
    'public.service_prepare_refund_gmail_contact_first_response(uuid,text[])'::regprocedure,
    'public.service_finish_refund_gmail_contact_first_response(uuid,text,text,text,text,integer)'::regprocedure,
    'public.service_mark_stale_refund_gmail_contact_responses_unknown(timestamptz)'::regprocedure,
    'public.service_claim_refund_gmail_contact_reconciliation_batch(integer)'::regprocedure,
    'public.service_count_refund_gmail_contact_response_reconciliation()'::regprocedure,
    'public.service_finish_refund_gmail_contact_response_no_match(uuid,integer)'::regprocedure,
    'public.service_purge_refund_gmail_intake_contacts(uuid,uuid,integer)'::regprocedure,
    'public.service_create_refund_case_from_gmail_contact_form(text,text,jsonb)'::regprocedure
  ] loop
    execute format('revoke execute on function %s from public, anon, authenticated', function_signature);
    execute format('grant execute on function %s to service_role', function_signature);
  end loop;
end;
$$;

comment on table public.refund_gmail_intake_contacts is
  'Private pre-form customer-service contacts. Rows are not refund cases and never authorize payment.';
comment on function public.service_create_refund_case_from_gmail_contact_form(text,text,jsonb) is
  'Consumes one private email context, creates exactly one form-origin refund case, and attaches the original Gmail thread without deciding or paying a refund.';

select pg_notify('pgrst', 'reload schema');
