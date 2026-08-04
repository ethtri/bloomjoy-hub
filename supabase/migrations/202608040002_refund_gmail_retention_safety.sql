set check_function_bodies = on;

-- Gmail/provider timestamps are evidence about the source mailbox, not a safe
-- clock for local privacy retention. copied_at is written only by Postgres and
-- is the authoritative start of the local-copy retention window.
alter table public.refund_gmail_threads
  add column if not exists copied_at timestamptz;
alter table public.refund_gmail_messages
  add column if not exists copied_at timestamptz;
alter table public.refund_gmail_attachments
  add column if not exists copied_at timestamptz;

update public.refund_gmail_threads
set copied_at = created_at
where copied_at is null;
update public.refund_gmail_messages
set copied_at = created_at
where copied_at is null;
update public.refund_gmail_attachments
set copied_at = created_at
where copied_at is null;

alter table public.refund_gmail_threads
  alter column copied_at set default clock_timestamp(),
  alter column copied_at set not null;
alter table public.refund_gmail_messages
  alter column copied_at set default clock_timestamp(),
  alter column copied_at set not null;
alter table public.refund_gmail_attachments
  alter column copied_at set default clock_timestamp(),
  alter column copied_at set not null;

create index if not exists refund_gmail_messages_copied_at_idx
  on public.refund_gmail_messages (copied_at, id)
  where content_deleted_at is null;
create index if not exists refund_gmail_attachments_copied_at_idx
  on public.refund_gmail_attachments (copied_at, id)
  where deleted_at is null;

create or replace function public.preserve_refund_gmail_copied_at()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if tg_op = 'INSERT' then
    new.copied_at := clock_timestamp();
  else
    new.copied_at := old.copied_at;
  end if;
  return new;
end;
$$;

drop trigger if exists refund_gmail_threads_preserve_copied_at on public.refund_gmail_threads;
create trigger refund_gmail_threads_preserve_copied_at
before insert or update on public.refund_gmail_threads
for each row execute function public.preserve_refund_gmail_copied_at();

drop trigger if exists refund_gmail_messages_preserve_copied_at on public.refund_gmail_messages;
create trigger refund_gmail_messages_preserve_copied_at
before insert or update on public.refund_gmail_messages
for each row execute function public.preserve_refund_gmail_copied_at();

drop trigger if exists refund_gmail_attachments_preserve_copied_at on public.refund_gmail_attachments;
create trigger refund_gmail_attachments_preserve_copied_at
before insert or update on public.refund_gmail_attachments
for each row execute function public.preserve_refund_gmail_copied_at();

create table if not exists public.refund_gmail_retention_settings (
  singleton boolean primary key default true check (singleton),
  cleanup_enabled boolean not null default false,
  policy_version text not null default 'refund_gmail_retention_v1',
  proposed_retention_days integer not null default 180
    check (proposed_retention_days = 180),
  approved_retention_days integer
    check (approved_retention_days is null or approved_retention_days = 180),
  owner_approved_at timestamptz,
  attachment_quarantine_approved boolean not null default false,
  scanner_version text,
  cleanup_overdue_after_hours integer not null default 26
    check (cleanup_overdue_after_hours between 1 and 168),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint refund_gmail_retention_settings_policy_version_check
    check (policy_version ~ '^refund_gmail_retention_v[0-9]+$'),
  constraint refund_gmail_retention_settings_owner_gate_check
    check (
      not cleanup_enabled
      or (
        approved_retention_days = proposed_retention_days
        and owner_approved_at is not null
      )
    ),
  constraint refund_gmail_retention_settings_scanner_gate_check
    check (
      not attachment_quarantine_approved
      or (
        scanner_version is not null
        and scanner_version ~ '^[a-zA-Z0-9._-]{3,80}$'
      )
    )
);

insert into public.refund_gmail_retention_settings (singleton)
values (true)
on conflict (singleton) do nothing;

drop trigger if exists refund_gmail_retention_settings_set_updated_at
  on public.refund_gmail_retention_settings;
create trigger refund_gmail_retention_settings_set_updated_at
before update on public.refund_gmail_retention_settings
for each row execute function public.set_updated_at();

create table if not exists public.refund_gmail_retention_runs (
  id uuid primary key default gen_random_uuid(),
  run_key text not null unique,
  trigger_source text not null
    check (trigger_source in ('retention', 'pre_sync')),
  status text not null
    check (status in ('running', 'succeeded', 'retry_required', 'manual_review', 'suppressed')),
  claim_token uuid not null default gen_random_uuid(),
  policy_version text not null,
  retention_days integer,
  claimed_at timestamptz not null default clock_timestamp(),
  lease_expires_at timestamptz,
  finished_at timestamptz,
  attachments_claimed integer not null default 0 check (attachments_claimed >= 0),
  attachments_deleted integer not null default 0 check (attachments_deleted >= 0),
  attachments_retry_required integer not null default 0 check (attachments_retry_required >= 0),
  attachments_manual_review integer not null default 0 check (attachments_manual_review >= 0),
  attachment_metadata_purged integer not null default 0 check (attachment_metadata_purged >= 0),
  messages_purged integer not null default 0 check (messages_purged >= 0),
  failure_code text,
  payload_redacted boolean not null default true check (payload_redacted),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint refund_gmail_retention_runs_run_key_length
    check (length(run_key) between 8 and 255),
  constraint refund_gmail_retention_runs_run_key_format
    check (run_key ~ '^[a-zA-Z0-9:_-]{8,255}$'),
  constraint refund_gmail_retention_runs_policy_version_length
    check (length(policy_version) between 3 and 80),
  constraint refund_gmail_retention_runs_failure_code_check
    check (failure_code is null or failure_code ~ '^[a-z0-9_]{3,80}$'),
  constraint refund_gmail_retention_runs_lifecycle_check
    check (
      (status = 'running' and finished_at is null and lease_expires_at is not null)
      or (status <> 'running' and finished_at is not null)
    )
);

create unique index if not exists refund_gmail_retention_one_running_idx
  on public.refund_gmail_retention_runs ((true))
  where status = 'running';

create index if not exists refund_gmail_retention_runs_claimed_idx
  on public.refund_gmail_retention_runs (claimed_at desc);

drop trigger if exists refund_gmail_retention_runs_set_updated_at
  on public.refund_gmail_retention_runs;
create trigger refund_gmail_retention_runs_set_updated_at
before update on public.refund_gmail_retention_runs
for each row execute function public.set_updated_at();

create table if not exists public.refund_gmail_retention_actions (
  id uuid primary key default gen_random_uuid(),
  retention_run_id uuid not null
    references public.refund_gmail_retention_runs (id) on delete restrict,
  gmail_attachment_id uuid not null
    references public.refund_gmail_attachments (id) on delete restrict,
  claim_token uuid not null default gen_random_uuid(),
  status text not null
    check (status in ('claimed', 'deleted', 'delete_failed', 'manual_review')),
  claimed_at timestamptz not null default clock_timestamp(),
  lease_expires_at timestamptz not null,
  settled_at timestamptz,
  retry_after timestamptz,
  failure_code text,
  reconciled_by_action_id uuid
    references public.refund_gmail_retention_actions (id) on delete restrict,
  payload_redacted boolean not null default true check (payload_redacted),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint refund_gmail_retention_actions_run_attachment_unique
    unique (retention_run_id, gmail_attachment_id),
  constraint refund_gmail_retention_actions_failure_code_check
    check (failure_code is null or failure_code ~ '^[a-z0-9_]{3,80}$'),
  constraint refund_gmail_retention_actions_lifecycle_check
    check (
      (status = 'claimed' and settled_at is null and retry_after is null)
      or (status = 'delete_failed' and settled_at is not null and retry_after is not null)
      or (status in ('deleted', 'manual_review') and settled_at is not null and retry_after is null)
    )
);

create unique index if not exists refund_gmail_retention_attachment_claim_idx
  on public.refund_gmail_retention_actions (gmail_attachment_id)
  where status = 'claimed';

create index if not exists refund_gmail_retention_actions_attachment_idx
  on public.refund_gmail_retention_actions (gmail_attachment_id, claimed_at desc);

drop trigger if exists refund_gmail_retention_actions_set_updated_at
  on public.refund_gmail_retention_actions;
create trigger refund_gmail_retention_actions_set_updated_at
before update on public.refund_gmail_retention_actions
for each row execute function public.set_updated_at();

create table if not exists public.refund_gmail_retention_state (
  singleton boolean primary key default true check (singleton),
  status text not null default 'waiting'
    check (status in ('waiting', 'running', 'healthy', 'retry_required', 'manual_review', 'disabled')),
  last_attempt_at timestamptz,
  last_success_at timestamptz,
  last_run_id uuid references public.refund_gmail_retention_runs (id) on delete set null,
  last_error_code text,
  consecutive_failures integer not null default 0 check (consecutive_failures >= 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint refund_gmail_retention_state_error_code_check
    check (last_error_code is null or last_error_code ~ '^[a-z0-9_]{3,80}$')
);

insert into public.refund_gmail_retention_state (singleton)
values (true)
on conflict (singleton) do nothing;

drop trigger if exists refund_gmail_retention_state_set_updated_at
  on public.refund_gmail_retention_state;
create trigger refund_gmail_retention_state_set_updated_at
before update on public.refund_gmail_retention_state
for each row execute function public.set_updated_at();

alter table public.refund_gmail_retention_settings enable row level security;
alter table public.refund_gmail_retention_runs enable row level security;
alter table public.refund_gmail_retention_actions enable row level security;
alter table public.refund_gmail_retention_state enable row level security;

revoke all on table public.refund_gmail_retention_settings from public, anon, authenticated, service_role;
revoke all on table public.refund_gmail_retention_runs from public, anon, authenticated, service_role;
revoke all on table public.refund_gmail_retention_actions from public, anon, authenticated, service_role;
revoke all on table public.refund_gmail_retention_state from public, anon, authenticated, service_role;

-- Existing workers retain read-only linkage access. All local-copy writes now
-- go through narrowly scoped SECURITY DEFINER functions.
revoke insert, update, delete on table public.refund_gmail_messages from service_role;
revoke insert, update, delete on table public.refund_gmail_attachments from service_role;
grant select on table public.refund_gmail_messages to service_role;
grant select on table public.refund_gmail_attachments to service_role;

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
  -- Retention deletion is deliberately excluded. Only a successful external
  -- byte-delete claim may finalize deleted metadata.
  if normalized_status not in ('rejected', 'quarantined', 'clean', 'error') then
    raise exception 'Unsupported attachment status';
  end if;

  if normalized_status in ('quarantined', 'clean') and (
    nullif(btrim(coalesce(p_storage_bucket, '')), '') is null
    or nullif(btrim(coalesce(p_storage_path, '')), '') is null
  ) then
    raise exception 'Quarantine storage evidence is required';
  end if;

  update public.refund_gmail_attachments
  set
    status = normalized_status,
    rejection_code = nullif(left(btrim(coalesce(p_rejection_code, '')), 120), ''),
    storage_bucket = case
      when normalized_status in ('quarantined', 'clean') then nullif(btrim(p_storage_bucket), '')
      else storage_bucket
    end,
    storage_path = case
      when normalized_status in ('quarantined', 'clean') then nullif(btrim(p_storage_path), '')
      else storage_path
    end
  where id = p_attachment_id
    and deleted_at is null
    and status in ('pending', 'rejected', 'quarantined', 'clean', 'error');

  return found;
end;
$$;

create or replace function public.service_claim_refund_gmail_retention_run(
  p_run_key text,
  p_trigger_source text,
  p_worker_enabled boolean,
  p_policy_version text
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  settings_row public.refund_gmail_retention_settings;
  existing_row public.refund_gmail_retention_runs;
  running_row public.refund_gmail_retention_runs;
  claimed_row public.refund_gmail_retention_runs;
  normalized_key text := btrim(coalesce(p_run_key, ''));
  normalized_trigger text := lower(btrim(coalesce(p_trigger_source, '')));
  normalized_policy text := left(btrim(coalesce(p_policy_version, '')), 80);
  suppression_code text;
begin
  if length(normalized_key) not between 8 and 255
    or normalized_key !~ '^[a-zA-Z0-9:_-]{8,255}$' then
    raise exception 'Valid retention run key required';
  end if;
  if normalized_trigger not in ('retention', 'pre_sync') then
    raise exception 'Valid retention trigger required';
  end if;

  select * into settings_row
  from public.refund_gmail_retention_settings
  where singleton
  for update;

  select * into existing_row
  from public.refund_gmail_retention_runs
  where run_key = normalized_key;

  if existing_row.id is not null then
    return jsonb_build_object(
      'claimed', false,
      'status', existing_row.status,
      'attachmentsDeleted', existing_row.attachments_deleted,
      'attachmentsRetryRequired', existing_row.attachments_retry_required,
      'attachmentsManualReview', existing_row.attachments_manual_review,
      'attachmentMetadataPurged', existing_row.attachment_metadata_purged,
      'messagesPurged', existing_row.messages_purged,
      'errorCode', existing_row.failure_code,
      'payloadRedacted', true
    );
  end if;

  if not coalesce(p_worker_enabled, false) then
    suppression_code := 'retention_worker_disabled';
  elsif not coalesce(settings_row.cleanup_enabled, false)
    or settings_row.owner_approved_at is null
    or settings_row.approved_retention_days is null then
    suppression_code := 'retention_policy_not_approved';
  elsif normalized_policy = '' or normalized_policy <> settings_row.policy_version then
    suppression_code := 'retention_policy_version_mismatch';
  end if;

  if suppression_code is not null then
    insert into public.refund_gmail_retention_runs (
      run_key, trigger_source, status, policy_version, retention_days,
      claimed_at, lease_expires_at, finished_at, failure_code
    ) values (
      normalized_key, normalized_trigger, 'suppressed',
      settings_row.policy_version,
      settings_row.approved_retention_days,
      clock_timestamp(), null, clock_timestamp(), suppression_code
    ) returning * into claimed_row;

    update public.refund_gmail_retention_state
    set
      status = 'disabled',
      last_attempt_at = claimed_row.claimed_at,
      last_run_id = claimed_row.id,
      last_error_code = suppression_code
    where singleton;

    return jsonb_build_object(
      'claimed', false,
      'status', 'suppressed',
      'errorCode', suppression_code,
      'payloadRedacted', true
    );
  end if;

  -- A worker disappearing after an external delete has an unknown outcome.
  -- Never retry that attachment blindly: quarantine it for manual review.
  update public.refund_gmail_retention_actions action
  set
    status = 'manual_review',
    settled_at = clock_timestamp(),
    retry_after = null,
    failure_code = 'storage_delete_outcome_unknown'
  from public.refund_gmail_retention_runs run
  where action.retention_run_id = run.id
    and action.status = 'claimed'
    and action.lease_expires_at <= clock_timestamp()
    and run.status = 'running';

  update public.refund_gmail_retention_runs
  set
    status = 'manual_review',
    finished_at = clock_timestamp(),
    lease_expires_at = null,
    failure_code = 'cleanup_claim_stale',
    attachments_manual_review = (
      select count(*)::integer
      from public.refund_gmail_retention_actions action
      where action.retention_run_id = refund_gmail_retention_runs.id
        and action.status = 'manual_review'
    )
  where status = 'running'
    and lease_expires_at <= clock_timestamp();

  select * into running_row
  from public.refund_gmail_retention_runs
  where status = 'running'
  limit 1;

  if running_row.id is not null then
    return jsonb_build_object(
      'claimed', false,
      'status', 'suppressed',
      'errorCode', 'cleanup_already_running',
      'payloadRedacted', true
    );
  end if;

  insert into public.refund_gmail_retention_runs (
    run_key, trigger_source, status, policy_version, retention_days,
    claimed_at, lease_expires_at
  ) values (
    normalized_key, normalized_trigger, 'running', settings_row.policy_version,
    settings_row.approved_retention_days, clock_timestamp(),
    clock_timestamp() + interval '15 minutes'
  ) returning * into claimed_row;

  update public.refund_gmail_retention_state
  set
    status = 'running',
    last_attempt_at = claimed_row.claimed_at,
    last_run_id = claimed_row.id,
    last_error_code = null
  where singleton;

  return jsonb_build_object(
    'claimed', true,
    'status', 'running',
    'runId', claimed_row.id,
    'claimToken', claimed_row.claim_token,
    'payloadRedacted', true
  );
end;
$$;

create or replace function public.service_claim_refund_gmail_retention_attachment(
  p_run_id uuid,
  p_run_token uuid
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  run_row public.refund_gmail_retention_runs;
  attachment_row public.refund_gmail_attachments;
  action_row public.refund_gmail_retention_actions;
begin
  select * into run_row
  from public.refund_gmail_retention_runs
  where id = p_run_id
    and claim_token = p_run_token
  for update;

  if run_row.id is null or run_row.status <> 'running'
    or run_row.lease_expires_at <= clock_timestamp() then
    return jsonb_build_object(
      'claimed', false,
      'status', 'run_not_claimed',
      'payloadRedacted', true
    );
  end if;

  select attachment.* into attachment_row
  from public.refund_gmail_attachments attachment
  where attachment.deleted_at is null
    and attachment.storage_bucket is not null
    and attachment.storage_path is not null
    and attachment.copied_at
      + make_interval(days => run_row.retention_days) <= clock_timestamp()
    and not exists (
      select 1
      from public.refund_gmail_retention_actions action
      where action.gmail_attachment_id = attachment.id
        and action.status in ('claimed', 'manual_review', 'deleted')
    )
    and not exists (
      select 1
      from public.refund_gmail_retention_actions action
      where action.gmail_attachment_id = attachment.id
        and action.status = 'delete_failed'
        and action.retry_after > clock_timestamp()
    )
  order by attachment.copied_at, attachment.id
  limit 1
  for update skip locked;

  if attachment_row.id is null then
    return jsonb_build_object(
      'claimed', false,
      'status', 'empty',
      'payloadRedacted', true
    );
  end if;

  insert into public.refund_gmail_retention_actions (
    retention_run_id, gmail_attachment_id, status, claimed_at, lease_expires_at
  ) values (
    run_row.id, attachment_row.id, 'claimed', clock_timestamp(), run_row.lease_expires_at
  ) returning * into action_row;

  update public.refund_gmail_retention_runs
  set attachments_claimed = attachments_claimed + 1
  where id = run_row.id;

  -- Storage coordinates are returned only across this service-only claim.
  -- They are never copied into the action ledger, logs, health, or HTTP output.
  return jsonb_build_object(
    'claimed', true,
    'status', 'claimed',
    'actionId', action_row.id,
    'claimToken', action_row.claim_token,
    'storageBucket', attachment_row.storage_bucket,
    'storagePath', attachment_row.storage_path,
    'payloadRedacted', true
  );
end;
$$;

create or replace function public.service_settle_refund_gmail_retention_attachment(
  p_action_id uuid,
  p_claim_token uuid,
  p_outcome text
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  action_row public.refund_gmail_retention_actions;
  normalized_outcome text := lower(btrim(coalesce(p_outcome, '')));
  updated_attachment_count integer := 0;
begin
  if normalized_outcome not in ('deleted', 'delete_failed', 'delete_unknown') then
    raise exception 'Valid retention attachment outcome required';
  end if;

  select * into action_row
  from public.refund_gmail_retention_actions
  where id = p_action_id
    and claim_token = p_claim_token
  for update;

  if action_row.id is null then
    return jsonb_build_object(
      'settled', false,
      'status', 'claim_not_found',
      'payloadRedacted', true
    );
  end if;

  if action_row.status <> 'claimed' then
    return jsonb_build_object(
      'settled', false,
      'status', action_row.status,
      'reconciled', true,
      'payloadRedacted', true
    );
  end if;

  if normalized_outcome = 'deleted' then
    update public.refund_gmail_attachments attachment
    set
      provider_attachment_id = 'retention-deleted:' || attachment.id::text,
      file_name = '[Deleted after Gmail retention period]',
      content_type = 'application/octet-stream',
      byte_size = 0,
      status = 'deleted',
      rejection_code = 'retention_expired',
      storage_bucket = null,
      storage_path = null,
      deleted_at = clock_timestamp()
    where attachment.id = action_row.gmail_attachment_id
      and attachment.deleted_at is null
      and attachment.storage_bucket is not null
      and attachment.storage_path is not null;

    get diagnostics updated_attachment_count = row_count;
    if updated_attachment_count <> 1 then
      update public.refund_gmail_retention_actions
      set
        status = 'manual_review',
        settled_at = clock_timestamp(),
        failure_code = 'attachment_metadata_state_changed'
      where id = action_row.id;

      update public.refund_gmail_retention_runs
      set attachments_manual_review = attachments_manual_review + 1
      where id = action_row.retention_run_id;

      return jsonb_build_object(
        'settled', true,
        'status', 'manual_review',
        'payloadRedacted', true
      );
    end if;

    update public.refund_gmail_retention_actions
    set
      status = 'deleted',
      settled_at = clock_timestamp(),
      failure_code = null
    where id = action_row.id;

    -- A later exact delete confirmation safely reconciles prior attempts that
    -- explicitly failed before deleting bytes. Unknown outcomes never enter
    -- this path and therefore remain durable manual-review holds.
    update public.refund_gmail_retention_actions
    set
      status = 'deleted',
      retry_after = null,
      failure_code = null,
      reconciled_by_action_id = action_row.id
    where gmail_attachment_id = action_row.gmail_attachment_id
      and id <> action_row.id
      and status = 'delete_failed';

    update public.refund_gmail_retention_runs
    set attachments_deleted = attachments_deleted + 1
    where id = action_row.retention_run_id;

    return jsonb_build_object(
      'settled', true,
      'status', 'deleted',
      'payloadRedacted', true
    );
  end if;

  if normalized_outcome = 'delete_failed' then
    update public.refund_gmail_retention_actions
    set
      status = 'delete_failed',
      settled_at = clock_timestamp(),
      retry_after = clock_timestamp() + interval '5 minutes',
      failure_code = 'storage_delete_failed'
    where id = action_row.id;

    update public.refund_gmail_retention_runs
    set attachments_retry_required = attachments_retry_required + 1
    where id = action_row.retention_run_id;

    return jsonb_build_object(
      'settled', true,
      'status', 'retry_required',
      'payloadRedacted', true
    );
  end if;

  update public.refund_gmail_retention_actions
  set
    status = 'manual_review',
    settled_at = clock_timestamp(),
    failure_code = 'storage_delete_outcome_unknown'
  where id = action_row.id;

  update public.refund_gmail_retention_runs
  set attachments_manual_review = attachments_manual_review + 1
  where id = action_row.retention_run_id;

  return jsonb_build_object(
    'settled', true,
    'status', 'manual_review',
    'payloadRedacted', true
  );
end;
$$;

create or replace function public.service_purge_refund_gmail_retention_content(
  p_run_id uuid,
  p_run_token uuid,
  p_limit integer default 200
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  run_row public.refund_gmail_retention_runs;
  purge_limit integer := least(greatest(coalesce(p_limit, 200), 1), 500);
  blocked_count integer := 0;
  attachment_count integer := 0;
  message_count integer := 0;
begin
  select * into run_row
  from public.refund_gmail_retention_runs
  where id = p_run_id
    and claim_token = p_run_token
  for update;

  if run_row.id is null or run_row.status <> 'running' then
    return jsonb_build_object(
      'purged', false,
      'status', 'run_not_claimed',
      'payloadRedacted', true
    );
  end if;

  select count(*)::integer into blocked_count
  from public.refund_gmail_attachments attachment
  where attachment.deleted_at is null
    and attachment.storage_path is not null
    and attachment.copied_at
      + make_interval(days => run_row.retention_days) <= clock_timestamp();

  if blocked_count > 0 then
    return jsonb_build_object(
      'purged', false,
      'status', 'attachment_cleanup_incomplete',
      'payloadRedacted', true
    );
  end if;

  with expired as (
    select attachment.id
    from public.refund_gmail_attachments attachment
    where attachment.deleted_at is null
      and attachment.storage_path is null
      and attachment.copied_at
        + make_interval(days => run_row.retention_days) <= clock_timestamp()
    order by attachment.copied_at, attachment.id
    limit purge_limit
    for update skip locked
  )
  update public.refund_gmail_attachments attachment
  set
    provider_attachment_id = 'retention-deleted:' || attachment.id::text,
    file_name = '[Deleted after Gmail retention period]',
    content_type = 'application/octet-stream',
    byte_size = 0,
    status = 'deleted',
    rejection_code = 'retention_expired',
    deleted_at = clock_timestamp()
  from expired
  where attachment.id = expired.id;

  get diagnostics attachment_count = row_count;

  with expired as (
    select message.id
    from public.refund_gmail_messages message
    where message.content_deleted_at is null
      and message.copied_at
        + make_interval(days => run_row.retention_days) <= clock_timestamp()
      and not exists (
        select 1
        from public.refund_gmail_attachments attachment
        where attachment.gmail_message_id = message.id
          and attachment.deleted_at is null
      )
    order by message.copied_at, message.id
    limit purge_limit
    for update skip locked
  )
  update public.refund_gmail_messages message
  set
    provider_message_id = null,
    provider_message_header = null,
    references_header = null,
    sender_email = null,
    sender_name = null,
    recipient_email = null,
    recipient_cc_emails = '{}'::text[],
    recipient_cc_count = 0,
    subject = '[Deleted after Gmail retention period]',
    plain_body = '[Deleted after Gmail retention period]',
    content_deleted_at = clock_timestamp()
  from expired
  where message.id = expired.id;

  get diagnostics message_count = row_count;

  update public.refund_gmail_threads thread
  set thread_subject = '[Deleted after Gmail retention period]'
  where thread.thread_subject <> '[Deleted after Gmail retention period]'
    and not exists (
      select 1
      from public.refund_gmail_messages message
      where message.gmail_thread_id = thread.id
        and message.content_deleted_at is null
    );

  update public.refund_gmail_retention_runs
  set
    attachment_metadata_purged = attachment_metadata_purged + attachment_count,
    messages_purged = messages_purged + message_count
  where id = run_row.id;

  return jsonb_build_object(
    'purged', true,
    'status', 'purged',
    'attachmentMetadataPurged', attachment_count,
    'messagesPurged', message_count,
    'payloadRedacted', true
  );
end;
$$;

create or replace function public.service_settle_refund_gmail_retention_run(
  p_run_id uuid,
  p_run_token uuid,
  p_outcome text,
  p_failure_code text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  run_row public.refund_gmail_retention_runs;
  normalized_outcome text := lower(btrim(coalesce(p_outcome, '')));
  normalized_failure text := lower(btrim(coalesce(p_failure_code, '')));
  final_status text;
  final_failure text;
  due_attachment_count integer := 0;
  due_message_count integer := 0;
  open_claim_count integer := 0;
  global_manual_count integer := 0;
  global_retry_count integer := 0;
begin
  if normalized_outcome not in ('succeeded', 'retry_required', 'manual_review') then
    raise exception 'Valid retention run outcome required';
  end if;
  if normalized_failure not in (
    '', 'cleanup_batch_incomplete', 'storage_delete_failed',
    'storage_delete_outcome_unknown', 'database_operation_failed',
    'cleanup_abandoned'
  ) then
    normalized_failure := 'cleanup_failed';
  end if;

  select * into run_row
  from public.refund_gmail_retention_runs
  where id = p_run_id
    and claim_token = p_run_token
  for update;

  if run_row.id is null then
    return jsonb_build_object(
      'settled', false,
      'status', 'claim_not_found',
      'payloadRedacted', true
    );
  end if;

  if run_row.status <> 'running' then
    return jsonb_build_object(
      'settled', false,
      'status', run_row.status,
      'reconciled', true,
      'attachmentsDeleted', run_row.attachments_deleted,
      'attachmentsRetryRequired', run_row.attachments_retry_required,
      'attachmentsManualReview', run_row.attachments_manual_review,
      'attachmentMetadataPurged', run_row.attachment_metadata_purged,
      'messagesPurged', run_row.messages_purged,
      'errorCode', run_row.failure_code,
      'payloadRedacted', true
    );
  end if;

  select count(*)::integer into open_claim_count
  from public.refund_gmail_retention_actions action
  where action.retention_run_id = run_row.id
    and action.status = 'claimed';

  select count(*)::integer into due_attachment_count
  from public.refund_gmail_attachments attachment
  where attachment.deleted_at is null
    and attachment.copied_at
      + make_interval(days => run_row.retention_days) <= clock_timestamp();

  select count(*)::integer into due_message_count
  from public.refund_gmail_messages message
  where message.content_deleted_at is null
    and message.copied_at
      + make_interval(days => run_row.retention_days) <= clock_timestamp();

  select count(*)::integer into global_manual_count
  from public.refund_gmail_retention_actions action
  where action.status = 'manual_review';

  select count(*)::integer into global_retry_count
  from public.refund_gmail_retention_actions action
  where action.status = 'delete_failed';

  final_status := case
    when open_claim_count > 0 then 'manual_review'
    when global_manual_count > 0
      or run_row.attachments_manual_review > 0
      or normalized_outcome = 'manual_review' then 'manual_review'
    when run_row.attachments_retry_required > 0
      or global_retry_count > 0
      or due_attachment_count > 0
      or due_message_count > 0
      or normalized_outcome = 'retry_required' then 'retry_required'
    else 'succeeded'
  end;

  final_failure := case
    when final_status = 'succeeded' then null
    when open_claim_count > 0 then 'storage_delete_outcome_unknown'
    when normalized_failure <> '' then normalized_failure
    when final_status = 'manual_review' then 'storage_delete_outcome_unknown'
    else 'cleanup_batch_incomplete'
  end;

  if open_claim_count > 0 then
    update public.refund_gmail_retention_actions
    set
      status = 'manual_review',
      settled_at = clock_timestamp(),
      failure_code = 'storage_delete_outcome_unknown'
    where retention_run_id = run_row.id
      and status = 'claimed';
  end if;

  update public.refund_gmail_retention_runs
  set
    status = final_status,
    finished_at = clock_timestamp(),
    lease_expires_at = null,
    attachments_manual_review = attachments_manual_review + open_claim_count,
    failure_code = final_failure
  where id = run_row.id
  returning * into run_row;

  update public.refund_gmail_retention_state
  set
    status = case
      when final_status = 'succeeded' then 'healthy'
      else final_status
    end,
    last_attempt_at = run_row.claimed_at,
    last_success_at = case
      when final_status = 'succeeded' then run_row.finished_at
      else last_success_at
    end,
    last_run_id = run_row.id,
    last_error_code = final_failure,
    consecutive_failures = case
      when final_status = 'succeeded' then 0
      else consecutive_failures + 1
    end
  where singleton;

  return jsonb_build_object(
    'settled', true,
    'status', run_row.status,
    'attachmentsDeleted', run_row.attachments_deleted,
    'attachmentsRetryRequired', run_row.attachments_retry_required,
    'attachmentsManualReview', run_row.attachments_manual_review,
    'attachmentMetadataPurged', run_row.attachment_metadata_purged,
    'messagesPurged', run_row.messages_purged,
    'errorCode', run_row.failure_code,
    'payloadRedacted', true
  );
end;
$$;

create or replace function public.service_abandon_refund_gmail_retention_run(
  p_run_id uuid,
  p_run_token uuid
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  open_claim_count integer := 0;
begin
  if not exists (
    select 1
    from public.refund_gmail_retention_runs run
    where run.id = p_run_id
      and run.claim_token = p_run_token
      and run.status = 'running'
  ) then
    return jsonb_build_object(
      'abandoned', false,
      'status', 'run_not_claimed',
      'payloadRedacted', true
    );
  end if;

  update public.refund_gmail_retention_actions
  set
    status = 'manual_review',
    settled_at = clock_timestamp(),
    failure_code = 'storage_delete_outcome_unknown'
  where retention_run_id = p_run_id
    and status = 'claimed';
  get diagnostics open_claim_count = row_count;

  update public.refund_gmail_retention_runs
  set
    status = 'manual_review',
    finished_at = clock_timestamp(),
    lease_expires_at = null,
    attachments_manual_review = attachments_manual_review + open_claim_count,
    failure_code = 'cleanup_abandoned'
  where id = p_run_id
    and claim_token = p_run_token
    and status = 'running';

  update public.refund_gmail_retention_state
  set
    status = 'manual_review',
    last_attempt_at = clock_timestamp(),
    last_run_id = p_run_id,
    last_error_code = 'cleanup_abandoned',
    consecutive_failures = consecutive_failures + 1
  where singleton;

  return jsonb_build_object(
    'abandoned', true,
    'status', 'manual_review',
    'payloadRedacted', true
  );
end;
$$;

create or replace function public.service_authorize_refund_gmail_copy(
  p_worker_enabled boolean,
  p_policy_version text,
  p_scanner_enabled boolean,
  p_scanner_version text
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  settings_row public.refund_gmail_retention_settings;
  state_row public.refund_gmail_retention_state;
  normalized_policy text := left(btrim(coalesce(p_policy_version, '')), 80);
  normalized_scanner text := left(btrim(coalesce(p_scanner_version, '')), 80);
  gate_status text := 'authorized';
begin
  select * into settings_row
  from public.refund_gmail_retention_settings
  where singleton;
  select * into state_row
  from public.refund_gmail_retention_state
  where singleton;

  if not coalesce(p_worker_enabled, false) then
    gate_status := 'retention_worker_disabled';
  elsif not coalesce(settings_row.cleanup_enabled, false)
    or settings_row.owner_approved_at is null
    or settings_row.approved_retention_days is null then
    gate_status := 'retention_policy_not_approved';
  elsif normalized_policy = '' or normalized_policy <> settings_row.policy_version then
    gate_status := 'retention_policy_version_mismatch';
  elsif not coalesce(p_scanner_enabled, false)
    or not coalesce(settings_row.attachment_quarantine_approved, false)
    or normalized_scanner = ''
    or normalized_scanner <> coalesce(settings_row.scanner_version, '') then
    gate_status := 'attachment_scanner_not_approved';
  elsif state_row.status <> 'healthy' then
    gate_status := 'cleanup_unhealthy';
  elsif state_row.last_success_at is null
    or state_row.last_success_at
      < clock_timestamp() - make_interval(hours => settings_row.cleanup_overdue_after_hours) then
    gate_status := 'cleanup_overdue';
  elsif exists (
    select 1
    from public.refund_gmail_attachments attachment
    where attachment.deleted_at is null
      and attachment.copied_at
        + make_interval(days => settings_row.approved_retention_days) <= clock_timestamp()
  ) or exists (
    select 1
    from public.refund_gmail_messages message
    where message.content_deleted_at is null
      and message.copied_at
        + make_interval(days => settings_row.approved_retention_days) <= clock_timestamp()
  ) then
    gate_status := 'cleanup_overdue';
  elsif exists (
    select 1
    from public.refund_gmail_retention_actions action
    where action.status in ('claimed', 'delete_failed', 'manual_review')
  ) then
    gate_status := 'cleanup_unhealthy';
  end if;

  return jsonb_build_object(
    'allowed', gate_status = 'authorized',
    'status', gate_status,
    'payloadRedacted', true
  );
end;
$$;

create or replace function public.service_get_refund_gmail_retention_health()
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  settings_row public.refund_gmail_retention_settings;
  state_row public.refund_gmail_retention_state;
  run_row public.refund_gmail_retention_runs;
  global_manual_count integer := 0;
  global_retry_count integer := 0;
begin
  select * into settings_row
  from public.refund_gmail_retention_settings
  where singleton;
  select * into state_row
  from public.refund_gmail_retention_state
  where singleton;
  select * into run_row
  from public.refund_gmail_retention_runs
  where id = state_row.last_run_id;
  select count(*)::integer into global_manual_count
  from public.refund_gmail_retention_actions action
  where action.status = 'manual_review';
  select count(*)::integer into global_retry_count
  from public.refund_gmail_retention_actions action
  where action.status = 'delete_failed';

  return jsonb_build_object(
    'status', case
      when not settings_row.cleanup_enabled then 'disabled'
      when global_manual_count > 0 then 'manual_review'
      when global_retry_count > 0 then 'retry_required'
      else state_row.status
    end,
    'lastAttemptAt', state_row.last_attempt_at,
    'lastSuccessAt', state_row.last_success_at,
    'consecutiveFailures', state_row.consecutive_failures,
    'attachmentsDeleted', coalesce(run_row.attachments_deleted, 0),
    'attachmentsRetryRequired', coalesce(run_row.attachments_retry_required, 0),
    'attachmentsManualReview', coalesce(run_row.attachments_manual_review, 0),
    'unresolvedManualReviewCount', global_manual_count,
    'unresolvedRetryRequiredCount', global_retry_count,
    'attachmentMetadataPurged', coalesce(run_row.attachment_metadata_purged, 0),
    'messagesPurged', coalesce(run_row.messages_purged, 0),
    'errorCode', state_row.last_error_code,
    'payloadRedacted', true
  );
end;
$$;

-- Disable the legacy unclaimed cleanup surface. An old Edge bundle now fails
-- closed instead of deleting metadata without durable byte-delete evidence.
revoke execute on function public.service_list_refund_gmail_expired_attachments(integer)
  from service_role;
revoke execute on function public.service_purge_refund_gmail_expired_message_content(integer)
  from service_role;

revoke execute on function public.preserve_refund_gmail_copied_at()
  from public, anon, authenticated, service_role;
revoke execute on function public.service_claim_refund_gmail_retention_run(text,text,boolean,text)
  from public, anon, authenticated;
revoke execute on function public.service_claim_refund_gmail_retention_attachment(uuid,uuid)
  from public, anon, authenticated;
revoke execute on function public.service_settle_refund_gmail_retention_attachment(uuid,uuid,text)
  from public, anon, authenticated;
revoke execute on function public.service_purge_refund_gmail_retention_content(uuid,uuid,integer)
  from public, anon, authenticated;
revoke execute on function public.service_settle_refund_gmail_retention_run(uuid,uuid,text,text)
  from public, anon, authenticated;
revoke execute on function public.service_abandon_refund_gmail_retention_run(uuid,uuid)
  from public, anon, authenticated;
revoke execute on function public.service_authorize_refund_gmail_copy(boolean,text,boolean,text)
  from public, anon, authenticated;
revoke execute on function public.service_get_refund_gmail_retention_health()
  from public, anon, authenticated;

grant execute on function public.service_claim_refund_gmail_retention_run(text,text,boolean,text)
  to service_role;
grant execute on function public.service_claim_refund_gmail_retention_attachment(uuid,uuid)
  to service_role;
grant execute on function public.service_settle_refund_gmail_retention_attachment(uuid,uuid,text)
  to service_role;
grant execute on function public.service_purge_refund_gmail_retention_content(uuid,uuid,integer)
  to service_role;
grant execute on function public.service_settle_refund_gmail_retention_run(uuid,uuid,text,text)
  to service_role;
grant execute on function public.service_abandon_refund_gmail_retention_run(uuid,uuid)
  to service_role;
grant execute on function public.service_authorize_refund_gmail_copy(boolean,text,boolean,text)
  to service_role;
grant execute on function public.service_get_refund_gmail_retention_health()
  to service_role;

comment on table public.refund_gmail_retention_settings is
  'Owner-controlled, default-off local Gmail-copy retention and attachment quarantine policy.';
comment on table public.refund_gmail_retention_runs is
  'Service-only aggregate retention run ledger. It contains no customer, mailbox, provider, payment, or object-key data.';
comment on table public.refund_gmail_retention_actions is
  'Service-only attachment deletion outcome ledger. Storage coordinates are never persisted here.';
comment on function public.service_authorize_refund_gmail_copy(boolean,text,boolean,text) is
  'Service-only pre-copy health gate. New local Gmail copies fail closed when cleanup or scanner policy is not healthy.';

select pg_notify('pgrst', 'reload schema');
