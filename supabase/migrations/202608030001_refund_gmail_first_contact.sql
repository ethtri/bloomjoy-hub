-- Exactly-once first-contact acknowledgement for Gmail-linked refund threads.
-- This migration is default-off. Runtime cutover gates live in refund-gmail-sync.

create table if not exists public.refund_gmail_first_contact_operations (
  id uuid primary key default gen_random_uuid(),
  gmail_thread_id uuid not null references public.refund_gmail_threads (id) on delete cascade,
  refund_case_id uuid not null references public.refund_cases (id) on delete cascade,
  source_message_id uuid not null references public.refund_gmail_messages (id) on delete cascade,
  refund_case_message_id uuid references public.refund_case_messages (id) on delete set null,
  transport_message_id uuid references public.refund_gmail_messages (id) on delete set null,
  operation_key text not null,
  mode text not null check (mode in ('shadow', 'isolated_test', 'active')),
  template_key text not null,
  prior_mailbox_reply_present boolean not null default false,
  status text not null check (
    status in ('shadowed', 'pending_send', 'sent', 'failed', 'delivery_unknown')
  ),
  cutover_at timestamptz,
  error_code text,
  claimed_at timestamptz not null default now(),
  reconciliation_checked_at timestamptz,
  reconciliation_attempt_count integer not null default 0 check (reconciliation_attempt_count >= 0),
  reconciliation_no_match_version integer not null default 0 check (
    reconciliation_no_match_version >= 0
    and reconciliation_no_match_version <= reconciliation_attempt_count
  ),
  sent_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint refund_gmail_first_contact_thread_unique unique (gmail_thread_id),
  constraint refund_gmail_first_contact_operation_unique unique (operation_key),
  constraint refund_gmail_first_contact_operation_key_length check (
    length(operation_key) between 20 and 255
  ),
  constraint refund_gmail_first_contact_template_key_length check (
    length(template_key) between 8 and 120
  ),
  constraint refund_gmail_first_contact_error_code_length check (
    error_code is null or length(error_code) between 1 and 120
  ),
  constraint refund_gmail_first_contact_cutover_required check (
    mode = 'shadow' or cutover_at is not null
  )
);

create index if not exists refund_gmail_first_contact_case_idx
  on public.refund_gmail_first_contact_operations (refund_case_id, claimed_at desc);

create index if not exists refund_gmail_first_contact_recovery_idx
  on public.refund_gmail_first_contact_operations (
    status,
    reconciliation_checked_at nulls first,
    claimed_at
  )
  where status in ('pending_send', 'failed', 'delivery_unknown');

alter table public.refund_gmail_messages
  add column if not exists reconciliation_checked_at timestamptz,
  add column if not exists reconciliation_attempt_count integer not null default 0
    check (reconciliation_attempt_count >= 0),
  add column if not exists reconciliation_no_match_version integer not null default 0
    check (
      reconciliation_no_match_version >= 0
      and reconciliation_no_match_version <= reconciliation_attempt_count
    );

create index if not exists refund_gmail_outbound_recovery_idx
  on public.refund_gmail_messages (
    status,
    reconciliation_checked_at nulls first,
    created_at
  )
  where direction = 'outbound'
    and message_kind = 'message'
    and operation_key is not null
    and status in ('pending_send', 'delivery_unknown');

create or replace function public.guard_refund_gmail_outbound_during_uncertain_delivery()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.direction <> 'outbound' or new.status <> 'pending_send' then
    return new;
  end if;

  if new.operation_key is not null and exists (
    select 1
    from public.refund_gmail_messages existing
    where existing.operation_key = new.operation_key
  ) then
    return new;
  end if;

  if exists (
    select 1
    from public.refund_gmail_messages existing
    where existing.gmail_thread_id = new.gmail_thread_id
      and existing.direction = 'outbound'
      and existing.message_kind = 'message'
      and existing.status in ('pending_send', 'delivery_unknown')
  ) then
    raise exception 'refund_gmail_delivery_reconciliation_required';
  end if;

  return new;
end;
$$;

drop trigger if exists refund_gmail_outbound_uncertain_delivery_guard
  on public.refund_gmail_messages;
create trigger refund_gmail_outbound_uncertain_delivery_guard
before insert on public.refund_gmail_messages
for each row execute function public.guard_refund_gmail_outbound_during_uncertain_delivery();

revoke execute on function public.guard_refund_gmail_outbound_during_uncertain_delivery()
  from public, anon, authenticated;

drop trigger if exists refund_gmail_first_contact_set_updated_at
  on public.refund_gmail_first_contact_operations;
create trigger refund_gmail_first_contact_set_updated_at
before update on public.refund_gmail_first_contact_operations
for each row execute function public.set_updated_at();

alter table public.refund_gmail_first_contact_operations enable row level security;
revoke all on table public.refund_gmail_first_contact_operations from anon, authenticated;
grant select, insert, update, delete on table public.refund_gmail_first_contact_operations to service_role;

create or replace function public.service_claim_refund_gmail_first_contact(
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
  normalized_mode text := lower(btrim(coalesce(p_mode, '')));
  normalized_template_key text := btrim(coalesce(p_template_key, ''));
  normalized_sender_email text := lower(btrim(coalesce(p_sender_email, '')));
  source_row public.refund_gmail_messages;
  first_inbound_id uuid;
  thread_row public.refund_gmail_threads;
  case_row public.refund_cases;
  operation_row public.refund_gmail_first_contact_operations;
  case_message_row public.refund_case_messages;
  transport_row public.refund_gmail_messages;
  prior_mailbox_reply_present boolean := false;
  operation_key_value text;
  reply_subject text;
  reply_references text;
begin
  if normalized_mode not in ('shadow', 'isolated_test', 'active') then
    raise exception 'Valid first-contact mode required';
  end if;
  if length(normalized_template_key) not between 8 and 120 then
    raise exception 'Valid first-contact template key required';
  end if;
  if normalized_mode <> 'shadow' and p_cutover_at is null then
    raise exception 'First-contact cutover timestamp required before sending';
  end if;

  select * into source_row
  from public.refund_gmail_messages
  where id = p_source_message_id
  for update;

  if source_row.id is null
    or source_row.direction <> 'inbound'
    or source_row.message_kind <> 'message'
    or source_row.status <> 'received'
    or source_row.sender_email is null
    or source_row.content_deleted_at is not null then
    return jsonb_build_object(
      'eligible', false,
      'claimed', false,
      'reason', 'source_message_not_eligible'
    );
  end if;

  select * into thread_row
  from public.refund_gmail_threads
  where id = source_row.gmail_thread_id
  for update;

  select * into case_row
  from public.refund_cases
  where id = source_row.refund_case_id;

  if thread_row.id is null
    or case_row.id is null
    or thread_row.refund_case_id <> case_row.id
    or lower(case_row.customer_email) <> lower(source_row.sender_email) then
    return jsonb_build_object(
      'eligible', false,
      'claimed', false,
      'reason', 'customer_or_thread_mismatch'
    );
  end if;

  select message.id into first_inbound_id
  from public.refund_gmail_messages message
  where message.gmail_thread_id = thread_row.id
    and message.direction = 'inbound'
    and message.message_kind = 'message'
    and message.status = 'received'
  order by message.received_at, message.id
  limit 1;

  if first_inbound_id is distinct from source_row.id then
    return jsonb_build_object(
      'eligible', false,
      'claimed', false,
      'reason', 'later_thread_message'
    );
  end if;

  if normalized_mode <> 'shadow' and source_row.received_at < p_cutover_at then
    return jsonb_build_object(
      'eligible', false,
      'claimed', false,
      'reason', 'before_cutover'
    );
  end if;

  select * into operation_row
  from public.refund_gmail_first_contact_operations
  where gmail_thread_id = thread_row.id;

  if operation_row.id is not null then
    return jsonb_build_object(
      'eligible', true,
      'claimed', false,
      'operationId', operation_row.id,
      'status', operation_row.status,
      'mode', operation_row.mode,
      'operationKey', operation_row.operation_key,
      'providerThreadId', thread_row.provider_thread_id,
      'reason', 'operation_already_exists'
    );
  end if;

  prior_mailbox_reply_present := coalesce(p_thread_has_outbound, false) or exists (
    select 1
    from public.refund_gmail_messages message
    where message.gmail_thread_id = thread_row.id
      and message.direction = 'outbound'
      and message.message_kind = 'message'
  );

  if normalized_mode <> 'shadow' and prior_mailbox_reply_present then
    return jsonb_build_object(
      'eligible', false,
      'claimed', false,
      'reason', 'prior_mailbox_reply'
    );
  end if;

  operation_key_value := 'refund-first-contact:' || thread_row.id::text;

  insert into public.refund_gmail_first_contact_operations (
    gmail_thread_id,
    refund_case_id,
    source_message_id,
    operation_key,
    mode,
    template_key,
    prior_mailbox_reply_present,
    status,
    cutover_at
  )
  values (
    thread_row.id,
    case_row.id,
    source_row.id,
    operation_key_value,
    normalized_mode,
    normalized_template_key,
    prior_mailbox_reply_present,
    case when normalized_mode = 'shadow' then 'shadowed' else 'pending_send' end,
    case when normalized_mode = 'shadow' then null else p_cutover_at end
  )
  returning * into operation_row;

  if normalized_mode = 'shadow' then
    insert into public.refund_case_events (
      refund_case_id,
      event_type,
      message,
      metadata
    )
    values (
      case_row.id,
      'gmail_first_contact_shadowed',
      'The Hub recorded that a first-contact acknowledgement would have been sent, without sending customer email.',
      jsonb_build_object(
        'payload_redacted', true,
        'template_key', normalized_template_key,
        'mode', normalized_mode,
        'prior_mailbox_reply_present', prior_mailbox_reply_present
      )
    );

    return jsonb_build_object(
      'eligible', true,
      'claimed', true,
      'operationId', operation_row.id,
      'status', operation_row.status,
      'mode', operation_row.mode,
      'templateKey', operation_row.template_key,
      'priorMailboxReplyPresent', operation_row.prior_mailbox_reply_present
    );
  end if;

  if normalized_sender_email !~ '^[^[:space:]@<>]+@[^[:space:]@<>]+\.[^[:space:]@<>]+$' then
    raise exception 'Valid first-contact sender mailbox required';
  end if;
  if length(coalesce(p_plain_body, '')) not between 1 and 50000 then
    raise exception 'Valid first-contact message body required';
  end if;
  if p_plain_body ~* '/refunds\?case=' then
    raise exception 'Customer first-contact body must not contain an internal case link';
  end if;

  reply_subject := coalesce(nullif(btrim(source_row.subject), ''), thread_row.thread_subject);
  reply_references := btrim(concat_ws(
    ' ',
    nullif(btrim(coalesce(source_row.references_header, '')), ''),
    nullif(btrim(coalesce(source_row.provider_message_header, '')), '')
  ));

  insert into public.refund_case_messages (
    refund_case_id,
    message_type,
    status,
    recipient_email,
    subject,
    body,
    template_key,
    created_by
  )
  values (
    case_row.id,
    'confirmation',
    'pending',
    lower(source_row.sender_email),
    reply_subject,
    left(p_plain_body, 50000),
    normalized_template_key,
    null
  )
  returning * into case_message_row;

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
    subject,
    plain_body,
    received_at,
    retention_expires_at
  )
  values (
    thread_row.id,
    case_row.id,
    case_message_row.id,
    operation_key_value,
    'outbound',
    'message',
    'pending_send',
    normalized_sender_email,
    lower(source_row.sender_email),
    reply_subject,
    left(p_plain_body, 50000),
    now(),
    now() + interval '180 days'
  )
  returning * into transport_row;

  update public.refund_gmail_first_contact_operations
  set
    refund_case_message_id = case_message_row.id,
    transport_message_id = transport_row.id
  where id = operation_row.id
  returning * into operation_row;

  insert into public.refund_case_events (
    refund_case_id,
    event_type,
    message,
    metadata
  )
  values (
    case_row.id,
    'gmail_first_contact_claimed',
    'The exactly-once first-contact acknowledgement was claimed for original-thread delivery.',
    jsonb_build_object(
      'payload_redacted', true,
      'template_key', normalized_template_key,
      'mode', normalized_mode
    )
  );

  return jsonb_build_object(
    'eligible', true,
    'claimed', true,
    'operationId', operation_row.id,
    'status', operation_row.status,
    'mode', operation_row.mode,
    'templateKey', operation_row.template_key,
    'operationKey', operation_row.operation_key,
    'transportMessageId', transport_row.id,
    'refundCaseMessageId', case_message_row.id,
    'providerThreadId', thread_row.provider_thread_id,
    'recipientEmail', lower(source_row.sender_email),
    'subject', reply_subject,
    'inReplyTo', source_row.provider_message_header,
    'references', nullif(reply_references, '')
  );
end;
$$;

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
set search_path = public
as $$
declare
  normalized_status text := lower(btrim(coalesce(p_status, '')));
  normalized_error_code text := nullif(left(btrim(coalesce(p_error_code, '')), 120), '');
  normalized_provider_message_id text := nullif(left(btrim(coalesce(p_provider_message_id, '')), 255), '');
  normalized_provider_message_header text := nullif(left(btrim(coalesce(p_provider_message_header, '')), 998), '');
  operation_row public.refund_gmail_first_contact_operations;
  transport_row public.refund_gmail_messages;
  expected_provider_message_header text;
begin
  if normalized_status not in ('sent', 'failed', 'delivery_unknown') then
    raise exception 'Valid first-contact completion status required';
  end if;

  select * into operation_row
  from public.refund_gmail_first_contact_operations
  where id = p_operation_id
  for update;

  if operation_row.id is null then
    return false;
  end if;

  expected_provider_message_header := '<refund-' || left(
    regexp_replace(operation_row.operation_key, '[^a-zA-Z0-9._-]', '', 'g'),
    80
  ) || '@bloomjoyusa.com>';

  select * into transport_row
  from public.refund_gmail_messages
  where id = operation_row.transport_message_id
  for update;

  if normalized_status = 'sent' then
    if normalized_provider_message_id is null
      or normalized_provider_message_header is distinct from expected_provider_message_header then
      raise exception 'Confirmed first-contact provider evidence required';
    end if;
    if p_attempt_version is not null and (
      p_attempt_version < 1
      or operation_row.reconciliation_attempt_count <> p_attempt_version
    ) then
      return false;
    end if;
    if operation_row.status = 'delivery_unknown' and p_attempt_version is null then
      return false;
    end if;
  elsif normalized_error_code is null then
    raise exception 'Safe first-contact failure code required';
  end if;

  if operation_row.status <> 'pending_send' then
    if operation_row.status = 'sent'
      and normalized_status = 'sent'
      and transport_row.provider_message_id = normalized_provider_message_id
      and transport_row.provider_message_header = normalized_provider_message_header then
      return true;
    end if;
    if not (operation_row.status = 'delivery_unknown' and normalized_status = 'sent') then
      return false;
    end if;
  end if;

  update public.refund_gmail_messages
  set
    status = normalized_status,
    provider_message_id = case
      when normalized_status = 'sent' then normalized_provider_message_id
      else provider_message_id
    end,
    provider_message_header = case
      when normalized_status = 'sent' then normalized_provider_message_header
      else provider_message_header
    end,
    sent_at = case when normalized_status = 'sent' then now() else sent_at end
  where id = operation_row.transport_message_id
    and (
      status = 'pending_send'
      or (normalized_status = 'sent' and status = 'delivery_unknown')
    );

  if not found then
    raise exception 'First-contact transport message is not pending';
  end if;

  update public.refund_case_messages
  set
    status = case when normalized_status = 'sent' then 'sent' else 'failed' end,
    sent_at = case when normalized_status = 'sent' then now() else sent_at end,
    error_message = case
      when normalized_status = 'sent' then null
      when normalized_status = 'delivery_unknown' then 'Gmail delivery could not be confirmed. Reconcile the original thread before retrying.'
      else 'The automatic first-contact acknowledgement could not be sent.'
    end
  where id = operation_row.refund_case_message_id
    and (
      status = 'pending'
      or (normalized_status = 'sent' and operation_row.status = 'delivery_unknown' and status = 'failed')
    );

  if not found then
    raise exception 'First-contact case message is not pending';
  end if;

  update public.refund_gmail_first_contact_operations
  set
    status = normalized_status,
    error_code = case when normalized_status = 'sent' then null else normalized_error_code end,
    sent_at = case when normalized_status = 'sent' then now() else sent_at end
  where id = operation_row.id;

  update public.refund_gmail_threads
  set latest_message_at = greatest(latest_message_at, now())
  where id = operation_row.gmail_thread_id;

  insert into public.refund_case_events (
    refund_case_id,
    event_type,
    message,
    metadata
  )
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
      'error_code', normalized_error_code
    )
  );

  return true;
end;
$$;

create or replace function public.service_mark_stale_refund_gmail_first_contacts_unknown(
  p_stale_before timestamptz
)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  stale_operation record;
  reconciled_count integer := 0;
begin
  if p_stale_before is null or p_stale_before > now() - interval '5 minutes' then
    raise exception 'A safe stale first-contact boundary is required';
  end if;

  for stale_operation in
    select operation.id
    from public.refund_gmail_first_contact_operations operation
    where operation.status = 'pending_send'
      and operation.claimed_at <= p_stale_before
    order by operation.claimed_at, operation.id
    limit 100
    for update skip locked
  loop
    if public.service_finish_refund_gmail_first_contact(
      stale_operation.id,
      'delivery_unknown',
      null,
      null,
      'stale_pending_reconciliation_required'
    ) then
      reconciled_count := reconciled_count + 1;
    end if;
  end loop;

  return reconciled_count;
end;
$$;

create or replace function public.service_claim_refund_gmail_first_contact_reconciliation_batch(
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
    from public.refund_gmail_first_contact_operations operation
    where operation.status in ('pending_send', 'delivery_unknown')
      and (
        operation.reconciliation_attempt_count = operation.reconciliation_no_match_version
        or operation.reconciliation_checked_at <= now() - interval '5 minutes'
      )
    order by operation.reconciliation_checked_at nulls first, operation.claimed_at, operation.id
    limit least(greatest(coalesce(p_limit, 100), 1), 500)
    for update skip locked
  ), claimed as (
    update public.refund_gmail_first_contact_operations operation
    set
      reconciliation_checked_at = now(),
      reconciliation_attempt_count = operation.reconciliation_attempt_count + 1
    from candidates
    where operation.id = candidates.id
    returning operation.*
  )
  select
    claimed.id,
    claimed.operation_key,
    thread.provider_thread_id,
    claimed.status,
    claimed.reconciliation_attempt_count
  from claimed
  join public.refund_gmail_threads thread
    on thread.id = claimed.gmail_thread_id
  order by claimed.reconciliation_checked_at, claimed.claimed_at, claimed.id;
end;
$$;

create or replace function public.service_count_refund_gmail_first_contact_reconciliation()
returns integer
language sql
stable
security definer
set search_path = public
as $$
  select count(*)::integer
  from public.refund_gmail_first_contact_operations operation
  where operation.status in ('pending_send', 'delivery_unknown');
$$;

create or replace function public.service_finish_refund_gmail_first_contact_no_match(
  p_operation_id uuid,
  p_attempt_version integer
)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
begin
  if coalesce(p_attempt_version, 0) < 1 then
    return false;
  end if;

  update public.refund_gmail_first_contact_operations
  set reconciliation_no_match_version = p_attempt_version
  where id = p_operation_id
    and status = 'delivery_unknown'
    and reconciliation_attempt_count = p_attempt_version;

  return found;
end;
$$;

create or replace function public.service_mark_stale_refund_gmail_outbound_unknown(
  p_stale_before timestamptz
)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  stale_message record;
  transitioned_count integer := 0;
begin
  if p_stale_before is null or p_stale_before > now() - interval '5 minutes' then
    raise exception 'A safe stale Gmail outbound boundary is required';
  end if;

  for stale_message in
    select message.id, message.refund_case_message_id
    from public.refund_gmail_messages message
    where message.direction = 'outbound'
      and message.message_kind = 'message'
      and message.operation_key is not null
      and message.status = 'pending_send'
      and message.created_at <= p_stale_before
      and not exists (
        select 1
        from public.refund_gmail_first_contact_operations first_contact
        where first_contact.transport_message_id = message.id
      )
    order by message.created_at, message.id
    limit 100
    for update skip locked
  loop
    if public.service_finish_refund_gmail_outbound(
      stale_message.id,
      'delivery_unknown',
      null,
      null,
      'stale_pending_reconciliation_required'
    ) then
      update public.refund_case_messages
      set
        status = 'failed',
        error_message = 'Gmail delivery could not be confirmed. Check the original thread before retrying.'
      where id = stale_message.refund_case_message_id
        and status = 'pending';
      transitioned_count := transitioned_count + 1;
    end if;
  end loop;

  return transitioned_count;
end;
$$;

create or replace function public.service_claim_refund_gmail_outbound_reconciliation_batch(
  p_limit integer default 100
)
returns table (
  transport_message_id uuid,
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
    select message.id
    from public.refund_gmail_messages message
    where message.direction = 'outbound'
      and message.message_kind = 'message'
      and message.operation_key is not null
      and message.status = 'delivery_unknown'
      and (
        message.reconciliation_attempt_count = message.reconciliation_no_match_version
        or message.reconciliation_checked_at <= now() - interval '5 minutes'
      )
      and not exists (
        select 1
        from public.refund_gmail_first_contact_operations first_contact
        where first_contact.transport_message_id = message.id
      )
    order by message.reconciliation_checked_at nulls first, message.created_at, message.id
    limit least(greatest(coalesce(p_limit, 100), 1), 500)
    for update skip locked
  ), claimed as (
    update public.refund_gmail_messages message
    set
      reconciliation_checked_at = now(),
      reconciliation_attempt_count = message.reconciliation_attempt_count + 1
    from candidates
    where message.id = candidates.id
    returning message.*
  )
  select
    claimed.id,
    claimed.operation_key,
    thread.provider_thread_id,
    claimed.status,
    claimed.reconciliation_attempt_count
  from claimed
  join public.refund_gmail_threads thread
    on thread.id = claimed.gmail_thread_id
  order by claimed.reconciliation_checked_at, claimed.created_at, claimed.id;
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
set search_path = public
as $$
declare
  message_row public.refund_gmail_messages;
  normalized_provider_message_id text := nullif(left(btrim(coalesce(p_provider_message_id, '')), 255), '');
  normalized_provider_message_header text := nullif(left(btrim(coalesce(p_provider_message_header, '')), 998), '');
  expected_provider_message_header text;
  safe_operation_key text;
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
      select 1
      from public.refund_gmail_first_contact_operations first_contact
      where first_contact.transport_message_id = message_row.id
    ) then
    return false;
  end if;

  if coalesce(p_attempt_version, 0) < 1
    or message_row.reconciliation_attempt_count <> p_attempt_version then
    return false;
  end if;

  safe_operation_key := left(
    regexp_replace(message_row.operation_key, '[^a-zA-Z0-9._-]', '', 'g'),
    80
  );
  expected_provider_message_header := '<refund-' || safe_operation_key || '@bloomjoyusa.com>';

  if length(safe_operation_key) < 8
    or normalized_provider_message_id is null
    or normalized_provider_message_header is distinct from expected_provider_message_header then
    raise exception 'Confirmed Gmail outbound provider evidence required';
  end if;

  if message_row.status = 'sent' then
    return message_row.provider_message_id = normalized_provider_message_id
      and message_row.provider_message_header = normalized_provider_message_header;
  end if;
  if message_row.status <> 'delivery_unknown' then
    return false;
  end if;

  update public.refund_gmail_messages
  set
    status = 'sent',
    provider_message_id = normalized_provider_message_id,
    provider_message_header = normalized_provider_message_header,
    sent_at = now()
  where id = message_row.id
    and status = 'delivery_unknown';

  if not found then
    return false;
  end if;

  update public.refund_case_messages
  set
    status = 'sent',
    sent_at = now(),
    error_message = null
  where id = message_row.refund_case_message_id
    and status in ('pending', 'failed');

  update public.refund_gmail_threads
  set latest_message_at = greatest(latest_message_at, now())
  where id = message_row.gmail_thread_id;

  insert into public.refund_case_events (
    refund_case_id,
    event_type,
    message,
    metadata
  )
  values (
    message_row.refund_case_id,
    'gmail_manager_reply_reconciled',
    'Manager-approved reply delivery was confirmed in the original Gmail thread.',
    jsonb_build_object('payload_redacted', true)
  );

  return true;
end;
$$;

create or replace function public.service_count_refund_gmail_outbound_reconciliation()
returns integer
language sql
stable
security definer
set search_path = public
as $$
  select count(*)::integer
  from public.refund_gmail_messages message
  where message.direction = 'outbound'
    and message.message_kind = 'message'
    and message.operation_key is not null
    and message.status = 'delivery_unknown'
    and not exists (
      select 1
      from public.refund_gmail_first_contact_operations first_contact
      where first_contact.transport_message_id = message.id
    );
$$;

create or replace function public.service_finish_refund_gmail_outbound_reconciliation_no_match(
  p_transport_message_id uuid,
  p_attempt_version integer
)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
begin
  if coalesce(p_attempt_version, 0) < 1 then
    return false;
  end if;

  update public.refund_gmail_messages message
  set reconciliation_no_match_version = p_attempt_version
  where message.id = p_transport_message_id
    and message.direction = 'outbound'
    and message.message_kind = 'message'
    and message.operation_key is not null
    and message.status = 'delivery_unknown'
    and message.reconciliation_attempt_count = p_attempt_version
    and not exists (
      select 1
      from public.refund_gmail_first_contact_operations first_contact
      where first_contact.transport_message_id = message.id
    );

  return found;
end;
$$;

create or replace function public.admin_resolve_refund_gmail_delivery_not_found(
  p_refund_case_message_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  actor_id uuid := auth.uid();
  target_transport_message_id uuid;
  target_refund_case_id uuid;
  message_row public.refund_gmail_messages;
  first_contact_row public.refund_gmail_first_contact_operations;
begin
  if actor_id is null or coalesce(auth.role(), '') <> 'authenticated' then
    raise exception 'Authenticated portal user required';
  end if;

  select message.id, message.refund_case_id
  into target_transport_message_id, target_refund_case_id
  from public.refund_gmail_messages message
  where message.refund_case_message_id = p_refund_case_message_id
    and message.direction = 'outbound'
    and message.message_kind = 'message'
  order by message.created_at desc, message.id desc
  limit 1;

  if target_transport_message_id is null then
    raise exception 'A delivery-unknown Gmail reply is required';
  end if;
  if not public.can_manage_refund_case(actor_id, target_refund_case_id) then
    raise exception 'Not authorized to resolve this Gmail delivery';
  end if;

  select * into first_contact_row
  from public.refund_gmail_first_contact_operations
  where refund_gmail_first_contact_operations.transport_message_id = target_transport_message_id
  for update;

  select * into message_row
  from public.refund_gmail_messages
  where id = target_transport_message_id
  for update;

  if message_row.id is null or message_row.status <> 'delivery_unknown' then
    raise exception 'A delivery-unknown Gmail reply is required';
  end if;

  if (
    first_contact_row.id is not null
    and (
      first_contact_row.reconciliation_attempt_count < 1
      or first_contact_row.reconciliation_no_match_version <>
        first_contact_row.reconciliation_attempt_count
    )
  ) or (
    first_contact_row.id is null
    and (
      message_row.reconciliation_attempt_count < 1
      or message_row.reconciliation_no_match_version <>
        message_row.reconciliation_attempt_count
    )
  ) then
    raise exception 'A completed latest-version Gmail no-match check is required before human resolution';
  end if;
  if not public.can_manage_refund_case(actor_id, message_row.refund_case_id) then
    raise exception 'Not authorized to resolve this Gmail delivery';
  end if;
  if exists (
    select 1
    from public.refund_gmail_messages unresolved
    where unresolved.gmail_thread_id = message_row.gmail_thread_id
      and unresolved.id <> message_row.id
      and unresolved.direction = 'outbound'
      and unresolved.message_kind = 'message'
      and unresolved.status in ('pending_send', 'delivery_unknown')
  ) then
    raise exception 'Resolve every outstanding Gmail delivery separately';
  end if;

  update public.refund_gmail_messages
  set status = 'failed'
  where id = message_row.id
    and status = 'delivery_unknown';

  if not found then
    return jsonb_build_object('resolved', false, 'reason', 'delivery_state_changed');
  end if;

  if first_contact_row.id is not null then
    update public.refund_gmail_first_contact_operations
    set
      status = 'failed',
      error_code = 'human_verified_not_delivered'
    where id = first_contact_row.id
      and status = 'delivery_unknown';
  end if;

  update public.refund_case_messages
  set
    status = 'failed',
    error_message = 'A manager verified that no Gmail message was delivered. A controlled follow-up is now allowed.'
  where id = p_refund_case_message_id
    and status in ('pending', 'failed');

  insert into public.refund_case_events (
    refund_case_id,
    actor_user_id,
    event_type,
    message,
    metadata
  )
  values (
    message_row.refund_case_id,
    actor_id,
    'gmail_delivery_verified_not_delivered',
    'An authorized portal user checked the original Gmail thread and verified that the uncertain reply was not delivered.',
    jsonb_build_object(
      'payload_redacted', true,
      'resolution', 'verified_not_delivered'
    )
  );

  return jsonb_build_object(
    'resolved', true,
    'refundCaseId', message_row.refund_case_id,
    'refundCaseMessageId', p_refund_case_message_id
  );
end;
$$;

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
    array_agg(expired.refund_case_message_id) filter (where expired.refund_case_message_id is not null)
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

revoke execute on function public.service_claim_refund_gmail_first_contact(uuid,text,timestamptz,text,text,text,boolean)
  from public, anon, authenticated;
revoke execute on function public.service_finish_refund_gmail_first_contact(uuid,text,text,text,text,integer)
  from public, anon, authenticated;
revoke execute on function public.service_mark_stale_refund_gmail_first_contacts_unknown(timestamptz)
  from public, anon, authenticated;
revoke execute on function public.service_claim_refund_gmail_first_contact_reconciliation_batch(integer)
  from public, anon, authenticated;
revoke execute on function public.service_count_refund_gmail_first_contact_reconciliation()
  from public, anon, authenticated;
revoke execute on function public.service_finish_refund_gmail_first_contact_no_match(uuid,integer)
  from public, anon, authenticated;
revoke execute on function public.service_mark_stale_refund_gmail_outbound_unknown(timestamptz)
  from public, anon, authenticated;
revoke execute on function public.service_claim_refund_gmail_outbound_reconciliation_batch(integer)
  from public, anon, authenticated;
revoke execute on function public.service_finish_refund_gmail_outbound_reconciliation(uuid,text,text,integer)
  from public, anon, authenticated;
revoke execute on function public.service_count_refund_gmail_outbound_reconciliation()
  from public, anon, authenticated;
revoke execute on function public.service_finish_refund_gmail_outbound_reconciliation_no_match(uuid,integer)
  from public, anon, authenticated;
revoke execute on function public.admin_resolve_refund_gmail_delivery_not_found(uuid)
  from public, anon, service_role;

grant execute on function public.service_claim_refund_gmail_first_contact(uuid,text,timestamptz,text,text,text,boolean)
  to service_role;
grant execute on function public.service_finish_refund_gmail_first_contact(uuid,text,text,text,text,integer)
  to service_role;
grant execute on function public.service_mark_stale_refund_gmail_first_contacts_unknown(timestamptz)
  to service_role;
grant execute on function public.service_claim_refund_gmail_first_contact_reconciliation_batch(integer)
  to service_role;
grant execute on function public.service_count_refund_gmail_first_contact_reconciliation()
  to service_role;
grant execute on function public.service_finish_refund_gmail_first_contact_no_match(uuid,integer)
  to service_role;
grant execute on function public.service_mark_stale_refund_gmail_outbound_unknown(timestamptz)
  to service_role;
grant execute on function public.service_claim_refund_gmail_outbound_reconciliation_batch(integer)
  to service_role;
grant execute on function public.service_finish_refund_gmail_outbound_reconciliation(uuid,text,text,integer)
  to service_role;
grant execute on function public.service_count_refund_gmail_outbound_reconciliation()
  to service_role;
grant execute on function public.service_finish_refund_gmail_outbound_reconciliation_no_match(uuid,integer)
  to service_role;
grant execute on function public.admin_resolve_refund_gmail_delivery_not_found(uuid)
  to authenticated;

comment on table public.refund_gmail_first_contact_operations is
  'Content-free, service-only exactly-once operation ledger for refund Gmail first-contact acknowledgements.';
comment on function public.service_claim_refund_gmail_first_contact(uuid,text,timestamptz,text,text,text,boolean) is
  'Claims one shadow or original-thread first-contact operation for the first eligible customer message in a Gmail thread.';
comment on function public.service_finish_refund_gmail_first_contact(uuid,text,text,text,text,integer) is
  'Finalizes first-contact delivery once and records a redacted recovery event for known or uncertain failures.';
comment on function public.service_mark_stale_refund_gmail_first_contacts_unknown(timestamptz) is
  'Moves abandoned first-contact send claims to reconciliation-required without retrying customer email.';
comment on function public.service_claim_refund_gmail_first_contact_reconciliation_batch(integer) is
  'Rotates through content-free outstanding first-contact operations for Message-ID reconciliation independently of current send mode.';
comment on function public.service_count_refund_gmail_first_contact_reconciliation() is
  'Counts unresolved first-contact deliveries so Gmail health remains degraded until reconciliation completes.';
comment on function public.service_finish_refund_gmail_first_contact_no_match(uuid,integer) is
  'Records a versioned completed zero-result Gmail search without resolving or retrying the first-contact delivery.';
comment on function public.service_mark_stale_refund_gmail_outbound_unknown(timestamptz) is
  'Moves abandoned non-first-contact Gmail reply claims to reconciliation-required without retrying customer email.';
comment on function public.service_claim_refund_gmail_outbound_reconciliation_batch(integer) is
  'Rotates through unresolved non-first-contact Gmail replies for deterministic Message-ID reconciliation.';
comment on function public.service_finish_refund_gmail_outbound_reconciliation(uuid,text,text,integer) is
  'Confirms an uncertain non-first-contact Gmail reply only with exact deterministic provider evidence.';
comment on function public.service_count_refund_gmail_outbound_reconciliation() is
  'Counts unresolved non-first-contact Gmail replies so Gmail health cannot appear healthy while replies are blocked.';
comment on function public.service_finish_refund_gmail_outbound_reconciliation_no_match(uuid,integer) is
  'Records a versioned completed zero-result Gmail search without resolving or retrying a manager reply.';
comment on function public.admin_resolve_refund_gmail_delivery_not_found(uuid) is
  'Lets an authenticated authorized portal user record an audited negative Gmail check only after automatic reconciliation found no delivery.';

select pg_notify('pgrst', 'reload schema');
