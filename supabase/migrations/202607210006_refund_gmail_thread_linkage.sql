-- Gmail support-thread linkage for refund operations.
-- This migration is transport-only: it does not enable Gmail polling or sending.

alter table public.refund_cases
  add column if not exists intake_source text not null default 'form';

alter table public.refund_cases
  drop constraint if exists refund_cases_intake_source_check;

alter table public.refund_cases
  add constraint refund_cases_intake_source_check
  check (intake_source in ('form', 'gmail'));

alter table public.refund_cases
  alter column reporting_machine_id drop not null,
  alter column reporting_location_id drop not null,
  alter column incident_at drop not null,
  alter column payment_method drop not null;

alter table public.refund_cases
  drop constraint if exists refund_cases_status_check;

alter table public.refund_cases
  add constraint refund_cases_status_check
  check (status in (
    'draft',
    'submitted',
    'needs_review',
    'waiting_on_customer',
    'correlated',
    'approved',
    'denied',
    'card_refund_pending',
    'cash_zelle_pending',
    'completed',
    'closed'
  ));

alter table public.refund_cases
  drop constraint if exists refund_cases_payment_method_check;

alter table public.refund_cases
  add constraint refund_cases_payment_method_check
  check (payment_method is null or payment_method in ('card', 'cash'));

alter table public.refund_cases
  drop constraint if exists refund_cases_processing_fields_complete;

alter table public.refund_cases
  add constraint refund_cases_processing_fields_complete
  check (
    (status = 'draft' and intake_source = 'gmail')
    or (
      status <> 'draft'
      and reporting_machine_id is not null
      and reporting_location_id is not null
      and incident_at is not null
      and payment_method is not null
    )
  );

create table if not exists public.refund_gmail_threads (
  id uuid primary key default gen_random_uuid(),
  refund_case_id uuid not null references public.refund_cases (id) on delete cascade,
  mailbox_hash text not null,
  provider_thread_id text not null,
  thread_subject text not null,
  first_message_at timestamptz not null,
  latest_message_at timestamptz not null,
  retention_expires_at timestamptz not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint refund_gmail_threads_provider_unique unique (mailbox_hash, provider_thread_id),
  constraint refund_gmail_threads_mailbox_hash_format check (mailbox_hash ~ '^[a-f0-9]{64}$'),
  constraint refund_gmail_threads_provider_id_present check (
    length(btrim(provider_thread_id)) between 1 and 255
  ),
  constraint refund_gmail_threads_subject_length check (length(thread_subject) between 1 and 998)
);

create index if not exists refund_gmail_threads_latest_message_idx
  on public.refund_gmail_threads (latest_message_at desc);

create index if not exists refund_gmail_threads_case_latest_idx
  on public.refund_gmail_threads (refund_case_id, latest_message_at desc);

drop trigger if exists refund_gmail_threads_set_updated_at on public.refund_gmail_threads;
create trigger refund_gmail_threads_set_updated_at
before update on public.refund_gmail_threads
for each row execute function public.set_updated_at();

create table if not exists public.refund_gmail_messages (
  id uuid primary key default gen_random_uuid(),
  gmail_thread_id uuid not null references public.refund_gmail_threads (id) on delete cascade,
  refund_case_id uuid not null references public.refund_cases (id) on delete cascade,
  refund_case_message_id uuid references public.refund_case_messages (id) on delete set null,
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
  subject text not null,
  plain_body text not null,
  sensitive_data_redacted boolean not null default false,
  received_at timestamptz not null,
  sent_at timestamptz,
  retention_expires_at timestamptz not null,
  content_deleted_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint refund_gmail_messages_provider_id_length check (
    provider_message_id is null or length(btrim(provider_message_id)) between 1 and 255
  ),
  constraint refund_gmail_messages_operation_key_length check (
    operation_key is null or length(btrim(operation_key)) between 8 and 255
  ),
  constraint refund_gmail_messages_sender_length check (
    sender_email is null or length(sender_email) between 3 and 320
  ),
  constraint refund_gmail_messages_recipient_length check (
    recipient_email is null or length(recipient_email) between 3 and 320
  ),
  constraint refund_gmail_messages_subject_length check (length(subject) between 1 and 998),
  constraint refund_gmail_messages_body_length check (length(plain_body) <= 50000),
  constraint refund_gmail_messages_provider_unique unique (gmail_thread_id, provider_message_id),
  constraint refund_gmail_messages_operation_unique unique (operation_key)
);

create index if not exists refund_gmail_messages_case_received_idx
  on public.refund_gmail_messages (refund_case_id, received_at, id);

create index if not exists refund_gmail_messages_thread_received_idx
  on public.refund_gmail_messages (gmail_thread_id, received_at, id);

create index if not exists refund_gmail_messages_expiry_idx
  on public.refund_gmail_messages (retention_expires_at)
  where content_deleted_at is null;

drop trigger if exists refund_gmail_messages_set_updated_at on public.refund_gmail_messages;
create trigger refund_gmail_messages_set_updated_at
before update on public.refund_gmail_messages
for each row execute function public.set_updated_at();

create table if not exists public.refund_gmail_attachments (
  id uuid primary key default gen_random_uuid(),
  gmail_message_id uuid not null references public.refund_gmail_messages (id) on delete cascade,
  refund_case_id uuid not null references public.refund_cases (id) on delete cascade,
  provider_attachment_id text not null,
  file_name text not null,
  content_type text not null,
  byte_size integer not null check (byte_size >= 0 and byte_size <= 26214400),
  disposition text not null default 'attachment' check (disposition in ('attachment', 'inline')),
  status text not null check (
    status in ('pending', 'rejected', 'quarantined', 'clean', 'error', 'deleted')
  ),
  rejection_code text,
  storage_bucket text,
  storage_path text,
  retention_expires_at timestamptz not null,
  deleted_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint refund_gmail_attachments_provider_unique unique (
    gmail_message_id,
    provider_attachment_id
  ),
  constraint refund_gmail_attachments_provider_id_present check (
    length(btrim(provider_attachment_id)) between 1 and 512
  ),
  constraint refund_gmail_attachments_file_name_length check (
    length(file_name) between 1 and 255
  ),
  constraint refund_gmail_attachments_content_type_length check (
    length(content_type) between 1 and 160
  ),
  constraint refund_gmail_attachments_storage_pair check (
    (storage_bucket is null and storage_path is null)
    or (storage_bucket is not null and storage_path is not null)
  )
);

create index if not exists refund_gmail_attachments_case_idx
  on public.refund_gmail_attachments (refund_case_id, created_at);

create index if not exists refund_gmail_attachments_expiry_idx
  on public.refund_gmail_attachments (retention_expires_at)
  where deleted_at is null and storage_path is not null;

drop trigger if exists refund_gmail_attachments_set_updated_at on public.refund_gmail_attachments;
create trigger refund_gmail_attachments_set_updated_at
before update on public.refund_gmail_attachments
for each row execute function public.set_updated_at();

create table if not exists public.refund_gmail_sync_runs (
  id uuid primary key default gen_random_uuid(),
  run_key text not null unique,
  trigger_source text not null check (trigger_source in ('scheduled', 'manual', 'failure_test')),
  status text not null check (status in ('running', 'succeeded', 'failed', 'suppressed')),
  started_at timestamptz not null,
  finished_at timestamptz,
  threads_scanned integer not null default 0 check (threads_scanned >= 0),
  messages_seen integer not null default 0 check (messages_seen >= 0),
  messages_created integer not null default 0 check (messages_created >= 0),
  messages_deduplicated integer not null default 0 check (messages_deduplicated >= 0),
  attachments_quarantined integer not null default 0 check (attachments_quarantined >= 0),
  messages_failed integer not null default 0 check (messages_failed >= 0),
  failure_category text,
  error_code text,
  payload_redacted boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint refund_gmail_sync_runs_run_key_length check (length(run_key) between 8 and 255)
);

create index if not exists refund_gmail_sync_runs_started_idx
  on public.refund_gmail_sync_runs (started_at desc);

drop trigger if exists refund_gmail_sync_runs_set_updated_at on public.refund_gmail_sync_runs;
create trigger refund_gmail_sync_runs_set_updated_at
before update on public.refund_gmail_sync_runs
for each row execute function public.set_updated_at();

create table if not exists public.refund_gmail_sync_state (
  singleton boolean primary key default true check (singleton),
  mailbox_hash text,
  label_hash text,
  connection_status text not null default 'waiting'
    check (connection_status in ('waiting', 'healthy', 'running', 'failing', 'paused', 'revoked')),
  enabled boolean not null default false,
  connected_at timestamptz,
  revoked_at timestamptz,
  last_attempt_at timestamptz,
  last_success_at timestamptz,
  last_history_id text,
  last_error_code text,
  consecutive_failures integer not null default 0 check (consecutive_failures >= 0),
  last_run_id uuid references public.refund_gmail_sync_runs (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint refund_gmail_sync_state_mailbox_hash_format check (
    mailbox_hash is null or mailbox_hash ~ '^[a-f0-9]{64}$'
  ),
  constraint refund_gmail_sync_state_label_hash_format check (
    label_hash is null or label_hash ~ '^[a-f0-9]{64}$'
  )
);

insert into public.refund_gmail_sync_state (singleton)
values (true)
on conflict (singleton) do nothing;

drop trigger if exists refund_gmail_sync_state_set_updated_at on public.refund_gmail_sync_state;
create trigger refund_gmail_sync_state_set_updated_at
before update on public.refund_gmail_sync_state
for each row execute function public.set_updated_at();

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'refund-gmail-quarantine',
  'refund-gmail-quarantine',
  false,
  5242880,
  array['image/jpeg', 'image/png', 'application/pdf']
)
on conflict (id) do update
set
  public = false,
  file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

alter table public.refund_gmail_threads enable row level security;
alter table public.refund_gmail_messages enable row level security;
alter table public.refund_gmail_attachments enable row level security;
alter table public.refund_gmail_sync_runs enable row level security;
alter table public.refund_gmail_sync_state enable row level security;

revoke all on table public.refund_gmail_threads from anon, authenticated;
revoke all on table public.refund_gmail_messages from anon, authenticated;
revoke all on table public.refund_gmail_attachments from anon, authenticated;
revoke all on table public.refund_gmail_sync_runs from anon, authenticated;
revoke all on table public.refund_gmail_sync_state from anon, authenticated;

grant select, insert, update, delete on table public.refund_gmail_threads to service_role;
grant select, insert, update, delete on table public.refund_gmail_messages to service_role;
grant select, insert, update, delete on table public.refund_gmail_attachments to service_role;
grant select, insert, update, delete on table public.refund_gmail_sync_runs to service_role;
grant select, insert, update, delete on table public.refund_gmail_sync_state to service_role;

create or replace function public.can_manage_refund_case(
  p_user_id uuid,
  p_refund_case_id uuid
)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select p_user_id is not null
    and p_refund_case_id is not null
    and exists (
      select 1
      from public.refund_cases refund_case
      where refund_case.id = p_refund_case_id
        and (
          public.can_manage_refund_machine(p_user_id, refund_case.reporting_machine_id)
          or (
            refund_case.intake_source = 'gmail'
            and refund_case.status = 'draft'
            and (
              public.is_super_admin(p_user_id)
              or public.is_scoped_admin(p_user_id)
            )
          )
        )
    );
$$;

create or replace function public.service_start_refund_gmail_sync(
  p_run_key text,
  p_trigger_source text,
  p_started_at timestamptz,
  p_mailbox_hash text,
  p_label_hash text,
  p_enabled boolean
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  run_row public.refund_gmail_sync_runs;
  state_row public.refund_gmail_sync_state;
  normalized_trigger text := lower(btrim(coalesce(p_trigger_source, '')));
begin
  if length(btrim(coalesce(p_run_key, ''))) not between 8 and 255 then
    raise exception 'Valid Gmail sync run key required';
  end if;

  if normalized_trigger not in ('scheduled', 'manual', 'failure_test') then
    raise exception 'Valid Gmail sync trigger required';
  end if;

  if coalesce(p_mailbox_hash, '') !~ '^[a-f0-9]{64}$'
    or coalesce(p_label_hash, '') !~ '^[a-f0-9]{64}$' then
    raise exception 'Redacted Gmail configuration fingerprints required';
  end if;

  insert into public.refund_gmail_sync_runs (
    run_key,
    trigger_source,
    status,
    started_at,
    finished_at,
    error_code
  )
  values (
    btrim(p_run_key),
    normalized_trigger,
    case when p_enabled then 'running' else 'suppressed' end,
    coalesce(p_started_at, now()),
    case when p_enabled then null else coalesce(p_started_at, now()) end,
    case when p_enabled then null else 'integration_disabled' end
  )
  on conflict (run_key) do nothing
  returning * into run_row;

  if run_row.id is null then
    select * into run_row
    from public.refund_gmail_sync_runs
    where run_key = btrim(p_run_key);

    return jsonb_build_object(
      'claimed', false,
      'runId', run_row.id,
      'status', run_row.status,
      'reason', 'duplicate_run_key'
    );
  end if;

  select * into state_row
  from public.refund_gmail_sync_state
  where singleton
  for update;

  if p_enabled
    and state_row.connection_status = 'running'
    and state_row.last_attempt_at > coalesce(p_started_at, now()) - interval '20 minutes' then
    update public.refund_gmail_sync_runs
    set
      status = 'suppressed',
      finished_at = now(),
      error_code = 'sync_already_running'
    where id = run_row.id;

    return jsonb_build_object(
      'claimed', false,
      'runId', run_row.id,
      'status', 'suppressed',
      'reason', 'sync_already_running'
    );
  end if;

  update public.refund_gmail_sync_state
  set
    mailbox_hash = p_mailbox_hash,
    label_hash = p_label_hash,
    enabled = p_enabled,
    connection_status = case when p_enabled then 'running' else 'paused' end,
    last_attempt_at = coalesce(p_started_at, now()),
    last_run_id = run_row.id,
    last_error_code = case when p_enabled then null else 'integration_disabled' end
  where singleton;

  return jsonb_build_object(
    'claimed', p_enabled,
    'runId', run_row.id,
    'status', case when p_enabled then 'running' else 'suppressed' end,
    'lastHistoryId', state_row.last_history_id
  );
end;
$$;

create or replace function public.service_finish_refund_gmail_sync(
  p_run_id uuid,
  p_status text,
  p_threads_scanned integer,
  p_messages_seen integer,
  p_messages_created integer,
  p_messages_deduplicated integer,
  p_attachments_quarantined integer,
  p_messages_failed integer,
  p_history_id text,
  p_failure_category text,
  p_error_code text
)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  normalized_status text := lower(btrim(coalesce(p_status, '')));
  applied boolean := false;
begin
  if normalized_status not in ('succeeded', 'failed', 'suppressed') then
    raise exception 'Valid Gmail sync completion status required';
  end if;

  update public.refund_gmail_sync_runs
  set
    status = normalized_status,
    finished_at = now(),
    threads_scanned = greatest(coalesce(p_threads_scanned, 0), 0),
    messages_seen = greatest(coalesce(p_messages_seen, 0), 0),
    messages_created = greatest(coalesce(p_messages_created, 0), 0),
    messages_deduplicated = greatest(coalesce(p_messages_deduplicated, 0), 0),
    attachments_quarantined = greatest(coalesce(p_attachments_quarantined, 0), 0),
    messages_failed = greatest(coalesce(p_messages_failed, 0), 0),
    failure_category = nullif(btrim(coalesce(p_failure_category, '')), ''),
    error_code = nullif(btrim(coalesce(p_error_code, '')), '')
  where id = p_run_id
    and status = 'running';

  applied := found;
  if not applied then
    return false;
  end if;

  update public.refund_gmail_sync_state
  set
    connection_status = case
      when normalized_status = 'succeeded' then 'healthy'
      when coalesce(p_error_code, '') = 'authorization_revoked' then 'revoked'
      when normalized_status = 'suppressed' then 'paused'
      else 'failing'
    end,
    connected_at = case
      when normalized_status = 'succeeded' then coalesce(connected_at, now())
      else connected_at
    end,
    revoked_at = case
      when coalesce(p_error_code, '') = 'authorization_revoked' then now()
      else revoked_at
    end,
    last_success_at = case
      when normalized_status = 'succeeded' then now()
      else last_success_at
    end,
    last_history_id = case
      when normalized_status = 'succeeded' then coalesce(nullif(btrim(p_history_id), ''), last_history_id)
      else last_history_id
    end,
    last_error_code = case
      when normalized_status = 'succeeded' then null
      else nullif(btrim(coalesce(p_error_code, '')), '')
    end,
    consecutive_failures = case
      when normalized_status = 'succeeded' then 0
      when normalized_status = 'failed' then consecutive_failures + 1
      else consecutive_failures
    end,
    last_run_id = p_run_id
  where singleton;

  return true;
end;
$$;

create or replace function public.service_ingest_refund_gmail_message(
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
  p_attachments jsonb
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
  normalized_direction text := lower(btrim(coalesce(p_direction, '')));
  normalized_sender_email text := lower(btrim(coalesce(p_sender_email, '')));
  normalized_subject text := left(btrim(coalesce(p_subject, '')), 998);
  normalized_body text := left(coalesce(p_plain_body, ''), 50000);
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
  if normalized_direction not in ('inbound', 'outbound', 'system') then
    raise exception 'Valid Gmail message direction required';
  end if;
  if normalized_subject = '' then
    normalized_subject := '(no subject)';
  end if;
  if jsonb_typeof(coalesce(p_attachments, '[]'::jsonb)) <> 'array' then
    raise exception 'Gmail attachment metadata must be an array';
  end if;

  perform pg_advisory_xact_lock(hashtextextended(p_mailbox_hash || ':' || p_provider_thread_id, 0));

  select * into thread_row
  from public.refund_gmail_threads
  where mailbox_hash = p_mailbox_hash
    and provider_thread_id = btrim(p_provider_thread_id)
  for update;

  if thread_row.id is null then
    if normalized_direction <> 'inbound' or coalesce(p_is_bounce, false) then
      return jsonb_build_object('created', false, 'skipped', true, 'reason', 'unlinked_non_customer_message');
    end if;

    if nullif(btrim(coalesce(p_public_reference, '')), '') is not null then
      select * into case_row
      from public.refund_cases
      where upper(public_reference) = upper(btrim(p_public_reference))
        and lower(customer_email) = normalized_sender_email
      order by created_at desc
      limit 1;
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
          case
            when normalized_body = '' then normalized_subject
            else normalized_subject || E'\n\n' || normalized_body
          end,
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
    normalized_direction,
    case when coalesce(p_is_bounce, false) then 'bounce' else 'message' end,
    case when normalized_direction = 'outbound' then 'sent' else 'received' end,
    nullif(normalized_sender_email, ''),
    nullif(left(btrim(coalesce(p_sender_name, '')), 160), ''),
    nullif(lower(left(btrim(coalesce(p_recipient_email, '')), 320)), ''),
    normalized_subject,
    normalized_body,
    coalesce(p_sensitive_data_redacted, false),
    received_at,
    case when normalized_direction = 'outbound' then received_at else null end,
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
      'attachments', attachment_rows
    );
  end if;

  update public.refund_gmail_threads
  set
    latest_message_at = greatest(latest_message_at, received_at),
    retention_expires_at = greatest(retention_expires_at, retention_at)
  where id = thread_row.id;

  if normalized_direction = 'inbound' and not coalesce(p_is_bounce, false) then
    update public.refund_cases
    set
      status = case when status = 'waiting_on_customer' then 'needs_review' else status end,
      automation_state = 'customer_replied',
      automation_follow_up_due_at = null,
      updated_at = now()
    where id = case_row.id;

    insert into public.refund_case_events (
      refund_case_id,
      event_type,
      message,
      metadata,
      created_at
    )
    values (
      case_row.id,
      'gmail_customer_message_received',
      'A customer message was added from the designated Gmail refund label.',
      jsonb_build_object('payload_redacted', true, 'content_redacted', coalesce(p_sensitive_data_redacted, false)),
      received_at
    );
  elsif coalesce(p_is_bounce, false) then
    insert into public.refund_case_events (
      refund_case_id,
      event_type,
      message,
      metadata,
      created_at
    )
    values (
      case_row.id,
      'gmail_customer_message_bounced',
      'Gmail reported that a customer message may not have been delivered.',
      jsonb_build_object('payload_redacted', true),
      received_at
    );
  end if;

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
    'attachments', attachment_rows
  );
end;
$$;

create or replace function public.service_mark_refund_gmail_attachment(
  p_attachment_id uuid,
  p_status text,
  p_storage_bucket text,
  p_storage_path text,
  p_rejection_code text
)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  normalized_status text := lower(btrim(coalesce(p_status, '')));
begin
  if normalized_status not in ('rejected', 'quarantined', 'clean', 'error', 'deleted') then
    raise exception 'Valid Gmail attachment status required';
  end if;

  update public.refund_gmail_attachments
  set
    status = normalized_status,
    storage_bucket = case when normalized_status in ('quarantined', 'clean') then nullif(btrim(p_storage_bucket), '') else storage_bucket end,
    storage_path = case when normalized_status in ('quarantined', 'clean') then nullif(btrim(p_storage_path), '') else storage_path end,
    rejection_code = nullif(left(btrim(coalesce(p_rejection_code, '')), 120), ''),
    deleted_at = case when normalized_status = 'deleted' then now() else deleted_at end
  where id = p_attachment_id
    and status in ('pending', 'quarantined', 'clean', 'error');

  return found;
end;
$$;

create or replace function public.service_claim_refund_gmail_outbound(
  p_refund_case_id uuid,
  p_refund_case_message_id uuid,
  p_operation_key text,
  p_sender_email text,
  p_recipient_email text,
  p_plain_body text
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
  reply_subject text;
  reply_references text;
begin
  if length(btrim(coalesce(p_operation_key, ''))) not between 8 and 255 then
    raise exception 'Valid Gmail outbound operation key required';
  end if;

  select * into case_row
  from public.refund_cases
  where id = p_refund_case_id;

  select * into thread_row
  from public.refund_gmail_threads
  where refund_case_id = p_refund_case_id
  order by latest_message_at desc, id desc
  limit 1
  for update;

  if thread_row.id is null or case_row.id is null then
    return jsonb_build_object('linked', false, 'claimed', false);
  end if;

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
    lower(left(btrim(coalesce(p_sender_email, '')), 320)),
    lower(left(btrim(coalesce(p_recipient_email, '')), 320)),
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

  return jsonb_build_object(
    'linked', true,
    'claimed', true,
    'transportMessageId', outbound_row.id,
    'providerThreadId', thread_row.provider_thread_id,
    'subject', reply_subject,
    'inReplyTo', latest_message.provider_message_header,
    'references', nullif(reply_references, '')
  );
end;
$$;

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
set search_path = public
as $$
declare
  normalized_status text := lower(btrim(coalesce(p_status, '')));
  updated_row public.refund_gmail_messages;
begin
  if normalized_status not in ('sent', 'failed', 'delivery_unknown') then
    raise exception 'Valid Gmail outbound completion status required';
  end if;

  update public.refund_gmail_messages
  set
    status = normalized_status,
    provider_message_id = case
      when normalized_status = 'sent' then nullif(btrim(coalesce(p_provider_message_id, '')), '')
      else provider_message_id
    end,
    provider_message_header = case
      when normalized_status = 'sent' then nullif(left(btrim(coalesce(p_provider_message_header, '')), 998), '')
      else provider_message_header
    end,
    sent_at = case when normalized_status = 'sent' then now() else sent_at end
  where id = p_transport_message_id
    and status = 'pending_send'
  returning * into updated_row;

  if updated_row.id is null then
    return false;
  end if;

  update public.refund_gmail_threads
  set latest_message_at = greatest(latest_message_at, now())
  where id = updated_row.gmail_thread_id;

  insert into public.refund_case_events (
    refund_case_id,
    event_type,
    message,
    metadata
  )
  values (
    updated_row.refund_case_id,
    case
      when normalized_status = 'sent' then 'gmail_manager_reply_sent'
      when normalized_status = 'delivery_unknown' then 'gmail_manager_reply_delivery_unknown'
      else 'gmail_manager_reply_failed'
    end,
    case
      when normalized_status = 'sent' then 'Manager-approved reply was sent in the original Gmail thread.'
      when normalized_status = 'delivery_unknown' then 'Gmail reply delivery could not be confirmed; check the Gmail thread before retrying.'
      else 'Manager-approved Gmail reply could not be sent.'
    end,
    jsonb_build_object(
      'payload_redacted', true,
      'error_code', nullif(left(btrim(coalesce(p_error_code, '')), 120), '')
    )
  );

  return true;
end;
$$;

create or replace function public.service_list_refund_gmail_expired_attachments(p_limit integer default 50)
returns jsonb
language sql
security definer
set search_path = public
as $$
  select coalesce(jsonb_agg(jsonb_build_object(
    'attachmentId', expired.id,
    'storageBucket', expired.storage_bucket,
    'storagePath', expired.storage_path
  )), '[]'::jsonb)
  from (
    select attachment.id, attachment.storage_bucket, attachment.storage_path
    from public.refund_gmail_attachments attachment
    where attachment.retention_expires_at <= now()
      and attachment.deleted_at is null
      and attachment.storage_bucket is not null
      and attachment.storage_path is not null
    order by attachment.retention_expires_at, attachment.id
    limit least(greatest(coalesce(p_limit, 50), 1), 200)
  ) expired;
$$;

create or replace function public.service_purge_refund_gmail_expired_message_content(p_limit integer default 200)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  purged_count integer;
begin
  with expired as (
    select message.id
    from public.refund_gmail_messages message
    where message.retention_expires_at <= now()
      and message.content_deleted_at is null
    order by message.retention_expires_at, message.id
    limit least(greatest(coalesce(p_limit, 200), 1), 500)
    for update skip locked
  )
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
  from expired
  where message.id = expired.id;

  get diagnostics purged_count = row_count;
  return purged_count;
end;
$$;

create or replace function public.admin_get_refund_gmail_draft_cases()
returns jsonb
language plpgsql
stable
security definer
set search_path = public, auth
as $$
declare
  actor_user_id uuid := auth.uid();
begin
  if actor_user_id is null then
    raise exception 'Authentication required';
  end if;

  if not (
    public.is_super_admin(actor_user_id)
    or public.is_scoped_admin(actor_user_id)
    or public.user_is_refund_manager(actor_user_id)
  ) then
    raise exception 'Refund operations access required';
  end if;

  return coalesce((
    select jsonb_agg(jsonb_build_object(
      'id', refund_case.id,
      'publicReference', refund_case.public_reference,
      'status', 'draft',
      'priority', refund_case.priority,
      'correlationStatus', refund_case.correlation_status,
      'correlationSource', refund_case.correlation_source,
      'correlationConfidence', refund_case.correlation_confidence,
      'correlationSummary', 'Waiting for the purchase details needed to run transaction matching.',
      'machineLabel', 'Needs location',
      'locationName', 'Needs location',
      'customerEmail', refund_case.customer_email,
      'customerName', refund_case.customer_name,
      'customerPhone', refund_case.customer_phone,
      'zellePaymentContact', refund_case.zelle_payment_contact,
      'issueSummary', refund_case.issue_summary,
      'incidentAt', gmail_thread.first_message_at,
      'paymentMethod', 'unknown',
      'paymentAmountCents', refund_case.payment_amount_cents,
      'cardLast4', refund_case.card_last4,
      'cardWalletUsed', refund_case.card_wallet_used,
      'hasMatchedSalesFact', false,
      'hasMatchedNayaxTransaction', false,
      'nayaxMatchExecutionEligible', false,
      'nayaxRecommendationState', null,
      'matchedNayaxMachineAuthTime', null,
      'matchedNayaxAmountCents', null,
      'matchedNayaxCardLast4', null,
      'matchedNayaxCurrencyCode', null,
      'nayaxLookupCandidates', '[]'::jsonb,
      'assignedManagerEmail', null,
      'decision', null,
      'decisionReason', null,
      'decidedAt', null,
      'refundAmountCents', null,
      'manualRefundReference', null,
      'hasReportingAdjustment', false,
      'intakeSource', 'gmail',
      'intakeComplete', false,
      'hasGmailThread', true,
      'customerCommunicationStatus', coalesce((
        select message.status
        from public.refund_case_messages message
        where message.refund_case_id = refund_case.id
        order by message.created_at desc
        limit 1
      ), 'not_contacted'),
      'latestCustomerMessageStatus', (
        select message.status
        from public.refund_case_messages message
        where message.refund_case_id = refund_case.id
        order by message.created_at desc
        limit 1
      ),
      'latestCustomerMessageType', (
        select message.message_type
        from public.refund_case_messages message
        where message.refund_case_id = refund_case.id
        order by message.created_at desc
        limit 1
      ),
      'latestCustomerMessageAt', (
        select coalesce(message.sent_at, message.created_at)
        from public.refund_case_messages message
        where message.refund_case_id = refund_case.id
        order by message.created_at desc
        limit 1
      ),
      'nayaxLookupSummary', null,
      'createdAt', refund_case.created_at,
      'updatedAt', refund_case.updated_at,
      'attachments', '[]'::jsonb,
      'events', coalesce((
        select jsonb_agg(jsonb_build_object(
          'id', event.id,
          'eventType', event.event_type,
          'message', event.message,
          'createdAt', event.created_at
        ) order by event.created_at desc)
        from public.refund_case_events event
        where event.refund_case_id = refund_case.id
      ), '[]'::jsonb),
      'messages', coalesce((
        select jsonb_agg(jsonb_build_object(
          'id', message.id,
          'messageType', message.message_type,
          'status', message.status,
          'recipientEmail', message.recipient_email,
          'subject', message.subject,
          'body', message.body,
          'sentAt', message.sent_at,
          'errorMessage', message.error_message,
          'createdAt', message.created_at
        ) order by message.created_at desc)
        from public.refund_case_messages message
        where message.refund_case_id = refund_case.id
      ), '[]'::jsonb)
    ) order by refund_case.created_at desc)
    from public.refund_cases refund_case
    join lateral (
      select linked_thread.first_message_at
      from public.refund_gmail_threads linked_thread
      where linked_thread.refund_case_id = refund_case.id
      order by linked_thread.latest_message_at desc, linked_thread.id desc
      limit 1
    ) gmail_thread on true
    where refund_case.status = 'draft'
      and public.can_manage_refund_case(actor_user_id, refund_case.id)
  ), '[]'::jsonb);
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
    'messages', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', message.id,
        'direction', message.direction,
        'kind', message.message_kind,
        'status', message.status,
        'senderEmail', message.sender_email,
        'recipientEmail', message.recipient_email,
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

create or replace function public.get_refund_gmail_health()
returns jsonb
language plpgsql
stable
security definer
set search_path = public, auth
as $$
declare
  actor_user_id uuid := auth.uid();
  state_row public.refund_gmail_sync_state;
  run_row public.refund_gmail_sync_runs;
  health_status text;
begin
  if actor_user_id is null then
    raise exception 'Authentication required';
  end if;
  if not (
    public.is_super_admin(actor_user_id)
    or public.is_scoped_admin(actor_user_id)
    or public.user_is_refund_manager(actor_user_id)
  ) then
    raise exception 'Refund operations access required';
  end if;

  select * into state_row
  from public.refund_gmail_sync_state
  where singleton;

  select * into run_row
  from public.refund_gmail_sync_runs
  where id = state_row.last_run_id;

  health_status := case
    when not coalesce(state_row.enabled, false) then 'paused'
    when state_row.connection_status = 'revoked' then 'revoked'
    when state_row.connection_status = 'failing' or state_row.consecutive_failures >= 2 then 'failing'
    when state_row.last_success_at is null then 'waiting'
    when state_row.last_success_at < now() - interval '30 minutes' then 'stale'
    else 'healthy'
  end;

  return jsonb_build_object(
    'status', health_status,
    'lastRunAt', state_row.last_attempt_at,
    'lastSuccessAt', state_row.last_success_at,
    'lastRunStatus', run_row.status,
    'consecutiveFailures', state_row.consecutive_failures,
    'threadsScanned', coalesce(run_row.threads_scanned, 0),
    'messagesSeen', coalesce(run_row.messages_seen, 0),
    'messagesCreated', coalesce(run_row.messages_created, 0),
    'messagesDeduplicated', coalesce(run_row.messages_deduplicated, 0),
    'attachmentsQuarantined', coalesce(run_row.attachments_quarantined, 0),
    'messagesFailed', coalesce(run_row.messages_failed, 0),
    'errorCode', state_row.last_error_code,
    'payloadRedacted', true
  );
end;
$$;

revoke execute on function public.service_start_refund_gmail_sync(text,text,timestamptz,text,text,boolean) from public, anon, authenticated;
revoke execute on function public.service_finish_refund_gmail_sync(uuid,text,integer,integer,integer,integer,integer,integer,text,text,text) from public, anon, authenticated;
revoke execute on function public.service_ingest_refund_gmail_message(text,text,text,text,text,text,boolean,text,text,text,text,text,boolean,timestamptz,text,jsonb) from public, anon, authenticated;
revoke execute on function public.service_mark_refund_gmail_attachment(uuid,text,text,text,text) from public, anon, authenticated;
revoke execute on function public.service_claim_refund_gmail_outbound(uuid,uuid,text,text,text,text) from public, anon, authenticated;
revoke execute on function public.service_finish_refund_gmail_outbound(uuid,text,text,text,text) from public, anon, authenticated;
revoke execute on function public.service_list_refund_gmail_expired_attachments(integer) from public, anon, authenticated;
revoke execute on function public.service_purge_refund_gmail_expired_message_content(integer) from public, anon, authenticated;

grant execute on function public.service_start_refund_gmail_sync(text,text,timestamptz,text,text,boolean) to service_role;
grant execute on function public.service_finish_refund_gmail_sync(uuid,text,integer,integer,integer,integer,integer,integer,text,text,text) to service_role;
grant execute on function public.service_ingest_refund_gmail_message(text,text,text,text,text,text,boolean,text,text,text,text,text,boolean,timestamptz,text,jsonb) to service_role;
grant execute on function public.service_mark_refund_gmail_attachment(uuid,text,text,text,text) to service_role;
grant execute on function public.service_claim_refund_gmail_outbound(uuid,uuid,text,text,text,text) to service_role;
grant execute on function public.service_finish_refund_gmail_outbound(uuid,text,text,text,text) to service_role;
grant execute on function public.service_list_refund_gmail_expired_attachments(integer) to service_role;
grant execute on function public.service_purge_refund_gmail_expired_message_content(integer) to service_role;

revoke execute on function public.admin_get_refund_gmail_draft_cases() from public, anon;
revoke execute on function public.admin_get_refund_gmail_case_context(uuid) from public, anon;
revoke execute on function public.get_refund_gmail_health() from public, anon;
grant execute on function public.admin_get_refund_gmail_draft_cases() to authenticated;
grant execute on function public.admin_get_refund_gmail_case_context(uuid) to authenticated;
grant execute on function public.get_refund_gmail_health() to authenticated;

comment on table public.refund_gmail_threads is
  'Service-only Gmail provider thread identifiers; multiple threads may link to one refund case.';
comment on table public.refund_gmail_messages is
  'Service-only sanitized plain-text Gmail message copies retained for the approved refund-support period.';
comment on table public.refund_gmail_attachments is
  'Service-only Gmail attachment metadata; permitted bytes remain private and quarantined until malware-cleared.';
comment on function public.admin_get_refund_gmail_case_context(uuid) is
  'Authorized refund-manager view of a linked Gmail conversation without provider identifiers or storage paths.';

select pg_notify('pgrst', 'reload schema');
