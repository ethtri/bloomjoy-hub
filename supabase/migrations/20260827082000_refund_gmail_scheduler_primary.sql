-- #1009: make Supabase the supported ten-minute Gmail intake primary.
--
-- GitHub schedule remains available as a fallback and the separately gated
-- twenty-minute watchdog remains a second recovery layer. This primary lane
-- owns Gmail intake scheduling only and has no payment, refund, provider, or
-- customer-message authority beyond the existing idempotent sync contract.

alter table public.refund_gmail_sync_runs
  drop constraint if exists refund_gmail_sync_runs_trigger_source_check,
  add constraint refund_gmail_sync_runs_trigger_source_check check (
    trigger_source in (
      'scheduled',
      'scheduler_primary',
      'scheduler_recovery',
      'manual',
      'failure_test',
      'intake_shadow'
    )
  );

create or replace function public.refund_gmail_workflow_run_key_is_valid(
  p_run_key text,
  p_trigger_source text
)
returns boolean
language sql
immutable
set search_path = public
as $$
  select case lower(btrim(coalesce(p_trigger_source, '')))
    when 'scheduled' then btrim(coalesce(p_run_key, ''))
      ~ '^github-scheduled:[1-9][0-9]{0,19}:[1-9][0-9]{0,5}$'
    when 'scheduler_primary' then btrim(coalesce(p_run_key, ''))
      ~ '^supabase-primary:20[0-9]{6}T([01][0-9]|2[0-3])[0-5]0Z$'
    when 'scheduler_recovery' then btrim(coalesce(p_run_key, ''))
      ~ '^supabase-recovery:20[0-9]{6}T([01][0-9]|2[0-3])[0-5][05]Z$'
    when 'manual' then btrim(coalesce(p_run_key, ''))
      ~ '^github-manual:[1-9][0-9]{0,19}:[1-9][0-9]{0,5}$'
    when 'failure_test' then btrim(coalesce(p_run_key, ''))
      ~ '^github-failure-test:[1-9][0-9]{0,19}:[1-9][0-9]{0,5}$'
    when 'intake_shadow' then btrim(coalesce(p_run_key, ''))
      ~ '^owner-intake-shadow:[a-f0-9]{64}$'
    else false
  end;
$$;

alter table public.refund_gmail_sync_runs
  drop constraint if exists refund_gmail_sync_runs_trigger_key_check;

alter table public.refund_gmail_sync_runs
  add constraint refund_gmail_sync_runs_trigger_key_check
  check (public.refund_gmail_workflow_run_key_is_valid(run_key, trigger_source));

create or replace function public.refund_gmail_retention_run_key_is_valid(
  p_run_key text,
  p_trigger_source text
)
returns boolean
language sql
immutable
set search_path = public
as $$
  select case lower(btrim(coalesce(p_trigger_source, '')))
    when 'retention' then btrim(coalesce(p_run_key, ''))
      ~ '^retention:github-retention:[1-9][0-9]{0,19}:[1-9][0-9]{0,5}$'
    when 'pre_sync' then btrim(coalesce(p_run_key, ''))
      ~ '^(pre-sync:github-(scheduled|manual):[1-9][0-9]{0,19}:[1-9][0-9]{0,5}|pre-sync:supabase-primary:20[0-9]{6}T(?:[01][0-9]|2[0-3])[0-5]0Z|pre-sync:supabase-recovery:20[0-9]{6}T(?:[01][0-9]|2[0-3])[0-5][05]Z)$'
    else false
  end;
$$;

create table if not exists public.refund_gmail_primary_scheduler_settings (
  singleton boolean primary key default true check (singleton),
  enabled boolean not null default false,
  cadence interval not null default interval '10 minutes'
    check (cadence = interval '10 minutes'),
  owner_name text not null default 'Refund Operations'
    check (owner_name = 'Refund Operations'),
  last_check_at timestamptz,
  last_check_status text check (
    last_check_status is null
    or last_check_status in (
      'disabled',
      'gmail_disabled',
      'recent_attempt',
      'configuration_missing',
      'configuration_invalid',
      'dispatched'
    )
  ),
  last_dispatch_at timestamptz,
  updated_at timestamptz not null default now()
);

insert into public.refund_gmail_primary_scheduler_settings (singleton, enabled)
values (true, false)
on conflict (singleton) do nothing;

create table if not exists public.refund_gmail_primary_scheduler_dispatches (
  bucket_at timestamptz primary key,
  run_key text not null unique check (
    run_key ~ '^supabase-primary:20[0-9]{6}T([01][0-9]|2[0-3])[0-5]0Z$'
  ),
  status text not null check (status in ('dispatching', 'dispatched')),
  request_id bigint unique,
  created_at timestamptz not null default now(),
  dispatched_at timestamptz
);

create index if not exists refund_gmail_primary_scheduler_dispatches_created_idx
  on public.refund_gmail_primary_scheduler_dispatches (created_at desc);

alter table public.refund_gmail_primary_scheduler_settings enable row level security;
alter table public.refund_gmail_primary_scheduler_dispatches enable row level security;

revoke all on table public.refund_gmail_primary_scheduler_settings
  from public, anon, authenticated, service_role;
revoke all on table public.refund_gmail_primary_scheduler_dispatches
  from public, anon, authenticated, service_role;

create or replace function public.service_set_refund_gmail_primary_scheduler_enabled(
  p_enabled boolean
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
begin
  update public.refund_gmail_primary_scheduler_settings
  set
    enabled = coalesce(p_enabled, false),
    last_check_status = case
      when coalesce(p_enabled, false) then last_check_status
      else 'disabled'
    end,
    updated_at = clock_timestamp()
  where singleton;

  return jsonb_build_object(
    'enabled', coalesce(p_enabled, false),
    'owner', 'Refund Operations',
    'payloadRedacted', true
  );
end;
$$;

create or replace function public.service_dispatch_refund_gmail_primary_scheduler()
returns jsonb
language plpgsql
security definer
set search_path = public, extensions, net, vault, pg_catalog
as $$
declare
  settings_row public.refund_gmail_primary_scheduler_settings;
  state_row public.refund_gmail_sync_state;
  endpoint text;
  scheduler_secret text;
  endpoint_count integer;
  secret_count integer;
  v_bucket_at timestamptz;
  v_run_key text;
  v_request_id bigint;
begin
  if not pg_try_advisory_xact_lock(628, 1018) then
    return jsonb_build_object(
      'status', 'recent_attempt',
      'dispatched', false,
      'owner', 'Refund Operations',
      'payloadRedacted', true
    );
  end if;

  select * into settings_row
  from public.refund_gmail_primary_scheduler_settings
  where singleton
  for update;

  if not coalesce(settings_row.enabled, false) then
    update public.refund_gmail_primary_scheduler_settings
    set last_check_at = clock_timestamp(), last_check_status = 'disabled'
    where singleton;
    return jsonb_build_object(
      'status', 'disabled',
      'dispatched', false,
      'owner', settings_row.owner_name,
      'payloadRedacted', true
    );
  end if;

  select * into state_row
  from public.refund_gmail_sync_state
  where singleton;

  if not coalesce(state_row.enabled, false) then
    update public.refund_gmail_primary_scheduler_settings
    set last_check_at = clock_timestamp(), last_check_status = 'gmail_disabled'
    where singleton;
    return jsonb_build_object(
      'status', 'gmail_disabled',
      'dispatched', false,
      'owner', settings_row.owner_name,
      'payloadRedacted', true
    );
  end if;

  if state_row.last_attempt_at is not null
    and state_row.connection_status = 'running'
    and state_row.last_attempt_at >= clock_timestamp() - interval '10 minutes' then
    update public.refund_gmail_primary_scheduler_settings
    set last_check_at = clock_timestamp(), last_check_status = 'recent_attempt'
    where singleton;
    return jsonb_build_object(
      'status', 'recent_attempt',
      'dispatched', false,
      'owner', settings_row.owner_name,
      'payloadRedacted', true
    );
  end if;

  select count(*), max(decrypted_secret)
    into endpoint_count, endpoint
  from vault.decrypted_secrets
  where name = 'refund_gmail_scheduler_url';

  select count(*), max(decrypted_secret)
    into secret_count, scheduler_secret
  from vault.decrypted_secrets
  where name = 'refund_gmail_scheduler_secret';

  if endpoint_count <> 1 or secret_count <> 1 then
    update public.refund_gmail_primary_scheduler_settings
    set last_check_at = clock_timestamp(), last_check_status = 'configuration_missing'
    where singleton;
    return jsonb_build_object(
      'status', 'configuration_missing',
      'dispatched', false,
      'owner', settings_row.owner_name,
      'payloadRedacted', true
    );
  end if;

  if endpoint !~ '^https://[a-z0-9]{20}\.supabase\.co/functions/v1/refund-gmail-sync$'
    or length(scheduler_secret) < 32
    or length(scheduler_secret) > 255 then
    update public.refund_gmail_primary_scheduler_settings
    set last_check_at = clock_timestamp(), last_check_status = 'configuration_invalid'
    where singleton;
    return jsonb_build_object(
      'status', 'configuration_invalid',
      'dispatched', false,
      'owner', settings_row.owner_name,
      'payloadRedacted', true
    );
  end if;

  v_bucket_at := date_trunc('hour', clock_timestamp())
    + floor(extract(minute from clock_timestamp()) / 10)::integer * interval '10 minutes';
  v_run_key := 'supabase-primary:'
    || to_char(v_bucket_at at time zone 'UTC', 'YYYYMMDD"T"HH24MI"Z"');

  insert into public.refund_gmail_primary_scheduler_dispatches (
    bucket_at,
    run_key,
    status
  )
  values (v_bucket_at, v_run_key, 'dispatching')
  on conflict (bucket_at) do nothing;

  if not found then
    update public.refund_gmail_primary_scheduler_settings
    set last_check_at = clock_timestamp(), last_check_status = 'recent_attempt'
    where singleton;
    return jsonb_build_object(
      'status', 'recent_attempt',
      'dispatched', false,
      'owner', settings_row.owner_name,
      'payloadRedacted', true
    );
  end if;

  v_request_id := net.http_post(
    url := endpoint,
    headers := jsonb_build_object(
      'Authorization', 'Bearer ' || scheduler_secret,
      'Content-Type', 'application/json'
    ),
    body := jsonb_build_object(
      'runKey', v_run_key,
      'trigger', 'scheduler_primary'
    ),
    timeout_milliseconds := 15000
  );

  update public.refund_gmail_primary_scheduler_dispatches
  set
    status = 'dispatched',
    request_id = v_request_id,
    dispatched_at = clock_timestamp()
  where bucket_at = v_bucket_at;

  update public.refund_gmail_primary_scheduler_settings
  set
    last_check_at = clock_timestamp(),
    last_check_status = 'dispatched',
    last_dispatch_at = clock_timestamp()
  where singleton;

  return jsonb_build_object(
    'status', 'dispatched',
    'dispatched', true,
    'owner', settings_row.owner_name,
    'payloadRedacted', true
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
  scheduler_row public.refund_gmail_scheduler_settings;
  primary_row public.refund_gmail_primary_scheduler_settings;
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

  select * into scheduler_row
  from public.refund_gmail_scheduler_settings
  where singleton;

  select * into primary_row
  from public.refund_gmail_primary_scheduler_settings
  where singleton;

  health_status := case
    when not coalesce(state_row.enabled, false) then 'paused'
    when state_row.connection_status = 'revoked' then 'revoked'
    when state_row.connection_status = 'failing' or state_row.consecutive_failures >= 2 then 'failing'
    when state_row.last_success_at is null then 'waiting'
    when state_row.last_success_at < now() - interval '30 minutes' then 'stale'
    when coalesce(scheduler_row.enabled, false)
      and state_row.last_success_at < now() - scheduler_row.recovery_after
      and scheduler_row.last_dispatch_at >= now() - interval '10 minutes'
      then 'recovering'
    else 'healthy'
  end;

  return jsonb_build_object(
    'status', health_status,
    'lastRunAt', state_row.last_attempt_at,
    'lastSuccessAt', state_row.last_success_at,
    'lastActualSuccessAt', state_row.last_success_at,
    'lastExpectedRunAt', case
      when coalesce(primary_row.enabled, false)
        then coalesce(primary_row.last_dispatch_at, primary_row.updated_at) + primary_row.cadence
      else null
    end,
    'lastRunStatus', run_row.status,
    'schedulerSource', run_row.trigger_source,
    'schedulerDelaySeconds', case
      when state_row.last_success_at is null then null
      else greatest(0, extract(epoch from (now() - state_row.last_success_at)))::bigint
    end,
    'schedulerRecoveryAction', case
      when scheduler_row.last_check_status = 'dispatched'
        and scheduler_row.last_dispatch_at > coalesce(state_row.last_success_at, '-infinity'::timestamptz)
        then 'scheduler_recovery_dispatched'
      else 'none'
    end,
    'schedulerOwner', primary_row.owner_name,
    'consecutiveFailures', state_row.consecutive_failures,
    'threadsScanned', coalesce(run_row.threads_scanned, 0),
    'messagesSeen', coalesce(run_row.messages_seen, 0),
    'messagesCreated', coalesce(run_row.messages_created, 0),
    'messagesDeduplicated', coalesce(run_row.messages_deduplicated, 0),
    'attachmentsQuarantined', coalesce(run_row.attachments_quarantined, 0),
    'messagesFailed', coalesce(run_row.messages_failed, 0),
    'errorCode', state_row.last_error_code,
    'primarySchedulerEnabled', coalesce(primary_row.enabled, false),
    'primarySchedulerStatus', primary_row.last_check_status,
    'primarySchedulerLastCheckAt', primary_row.last_check_at,
    'primarySchedulerLastDispatchAt', primary_row.last_dispatch_at,
    'schedulerEnabled', coalesce(scheduler_row.enabled, false),
    'schedulerStatus', scheduler_row.last_check_status,
    'schedulerLastCheckAt', scheduler_row.last_check_at,
    'schedulerLastDispatchAt', scheduler_row.last_dispatch_at,
    'payloadRedacted', true
  );
end;
$$;

revoke execute on function public.service_set_refund_gmail_primary_scheduler_enabled(boolean)
  from public, anon, authenticated;
revoke execute on function public.service_dispatch_refund_gmail_primary_scheduler()
  from public, anon, authenticated, service_role;
grant execute on function public.service_set_refund_gmail_primary_scheduler_enabled(boolean)
  to service_role;

revoke execute on function public.get_refund_gmail_health() from public, anon;
grant execute on function public.get_refund_gmail_health() to authenticated;

select cron.schedule(
  'refund-gmail-sync-primary-v1',
  '2-59/10 * * * *',
  'select public.service_dispatch_refund_gmail_primary_scheduler();'
);

comment on function public.service_dispatch_refund_gmail_primary_scheduler() is
  'Default-off, Vault-backed ten-minute Gmail intake primary. Has no payment, refund, or provider authority.';

comment on function public.refund_gmail_retention_run_key_is_valid(text, text) is
  'Validates trigger-bound retention ledger keys for GitHub, Supabase primary, and independent recovery schedules.';
