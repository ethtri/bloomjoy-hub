-- #1009: independent Gmail intake scheduler recovery.
--
-- The cron job is installed but the watchdog defaults off. It can only invoke
-- refund-gmail-sync with a dedicated Vault-backed intake token. It has no
-- payment, refund, customer-contact, or provider authority.

create extension if not exists pg_cron with schema pg_catalog;
create extension if not exists pg_net with schema extensions;

alter table public.refund_gmail_sync_runs
  drop constraint if exists refund_gmail_sync_runs_trigger_source_check,
  add constraint refund_gmail_sync_runs_trigger_source_check check (
    trigger_source in (
      'scheduled',
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

create table if not exists public.refund_gmail_scheduler_settings (
  singleton boolean primary key default true check (singleton),
  enabled boolean not null default false,
  recovery_after interval not null default interval '20 minutes'
    check (
      recovery_after >= interval '15 minutes'
      and recovery_after <= interval '25 minutes'
    ),
  last_check_at timestamptz,
  last_check_status text
    check (
      last_check_status is null
      or last_check_status in (
        'disabled',
        'gmail_disabled',
        'healthy',
        'recent_attempt',
        'configuration_missing',
        'configuration_invalid',
        'dispatched'
      )
    ),
  last_dispatch_at timestamptz,
  updated_at timestamptz not null default now()
);

insert into public.refund_gmail_scheduler_settings (singleton, enabled)
values (true, false)
on conflict (singleton) do nothing;

create table if not exists public.refund_gmail_scheduler_dispatches (
  bucket_at timestamptz primary key,
  run_key text not null unique
    check (run_key ~ '^supabase-recovery:20[0-9]{6}T([01][0-9]|2[0-3])[0-5][05]Z$'),
  status text not null
    check (status in ('dispatching', 'dispatched')),
  request_id bigint unique,
  created_at timestamptz not null default now(),
  dispatched_at timestamptz
);

create index if not exists refund_gmail_scheduler_dispatches_created_idx
  on public.refund_gmail_scheduler_dispatches (created_at desc);

alter table public.refund_gmail_scheduler_settings enable row level security;
alter table public.refund_gmail_scheduler_dispatches enable row level security;

revoke all on table public.refund_gmail_scheduler_settings from public, anon, authenticated;
revoke all on table public.refund_gmail_scheduler_dispatches from public, anon, authenticated;
grant select, insert, update, delete on table public.refund_gmail_scheduler_settings to service_role;
grant select, insert, update, delete on table public.refund_gmail_scheduler_dispatches to service_role;

create or replace function public.service_set_refund_gmail_scheduler_enabled(
  p_enabled boolean
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
begin
  update public.refund_gmail_scheduler_settings
  set
    enabled = coalesce(p_enabled, false),
    last_check_status = case when coalesce(p_enabled, false)
      then last_check_status
      else 'disabled'
    end,
    updated_at = clock_timestamp()
  where singleton;

  return jsonb_build_object(
    'enabled', coalesce(p_enabled, false),
    'payloadRedacted', true
  );
end;
$$;

create or replace function public.service_dispatch_refund_gmail_scheduler_watchdog()
returns jsonb
language plpgsql
security definer
set search_path = public, extensions, net, vault, pg_catalog
as $$
declare
  settings_row public.refund_gmail_scheduler_settings;
  state_row public.refund_gmail_sync_state;
  endpoint text;
  recovery_secret text;
  endpoint_count integer;
  secret_count integer;
  v_bucket_at timestamptz;
  v_run_key text;
  v_request_id bigint;
begin
  if not pg_try_advisory_xact_lock(628, 1009) then
    return jsonb_build_object(
      'status', 'recent_attempt',
      'dispatched', false,
      'payloadRedacted', true
    );
  end if;

  select * into settings_row
  from public.refund_gmail_scheduler_settings
  where singleton
  for update;

  if not coalesce(settings_row.enabled, false) then
    update public.refund_gmail_scheduler_settings
    set last_check_at = clock_timestamp(), last_check_status = 'disabled'
    where singleton;
    return jsonb_build_object(
      'status', 'disabled',
      'dispatched', false,
      'payloadRedacted', true
    );
  end if;

  select * into state_row
  from public.refund_gmail_sync_state
  where singleton;

  if not coalesce(state_row.enabled, false) then
    update public.refund_gmail_scheduler_settings
    set last_check_at = clock_timestamp(), last_check_status = 'gmail_disabled'
    where singleton;
    return jsonb_build_object(
      'status', 'gmail_disabled',
      'dispatched', false,
      'payloadRedacted', true
    );
  end if;

  if state_row.last_success_at is not null
    and state_row.last_success_at >= clock_timestamp() - settings_row.recovery_after then
    update public.refund_gmail_scheduler_settings
    set last_check_at = clock_timestamp(), last_check_status = 'healthy'
    where singleton;
    return jsonb_build_object(
      'status', 'healthy',
      'dispatched', false,
      'payloadRedacted', true
    );
  end if;

  if state_row.last_attempt_at is not null
    and state_row.last_attempt_at >= clock_timestamp() - interval '10 minutes' then
    update public.refund_gmail_scheduler_settings
    set last_check_at = clock_timestamp(), last_check_status = 'recent_attempt'
    where singleton;
    return jsonb_build_object(
      'status', 'recent_attempt',
      'dispatched', false,
      'payloadRedacted', true
    );
  end if;

  select count(*), max(decrypted_secret)
    into endpoint_count, endpoint
  from vault.decrypted_secrets
  where name = 'refund_gmail_scheduler_url';

  select count(*), max(decrypted_secret)
    into secret_count, recovery_secret
  from vault.decrypted_secrets
  where name = 'refund_gmail_scheduler_secret';

  if endpoint_count <> 1 or secret_count <> 1 then
    update public.refund_gmail_scheduler_settings
    set last_check_at = clock_timestamp(), last_check_status = 'configuration_missing'
    where singleton;
    return jsonb_build_object(
      'status', 'configuration_missing',
      'dispatched', false,
      'payloadRedacted', true
    );
  end if;

  if endpoint !~ '^https://[a-z0-9]{20}\.supabase\.co/functions/v1/refund-gmail-sync$'
    or length(recovery_secret) < 32
    or length(recovery_secret) > 255 then
    update public.refund_gmail_scheduler_settings
    set last_check_at = clock_timestamp(), last_check_status = 'configuration_invalid'
    where singleton;
    return jsonb_build_object(
      'status', 'configuration_invalid',
      'dispatched', false,
      'payloadRedacted', true
    );
  end if;

  v_bucket_at := date_trunc('hour', clock_timestamp())
    + floor(extract(minute from clock_timestamp()) / 5)::integer * interval '5 minutes';
  v_run_key := 'supabase-recovery:' || to_char(v_bucket_at at time zone 'UTC', 'YYYYMMDD"T"HH24MI"Z"');

  insert into public.refund_gmail_scheduler_dispatches (
    bucket_at,
    run_key,
    status
  )
  values (v_bucket_at, v_run_key, 'dispatching')
  on conflict (bucket_at) do nothing;

  if not found then
    update public.refund_gmail_scheduler_settings
    set last_check_at = clock_timestamp(), last_check_status = 'recent_attempt'
    where singleton;
    return jsonb_build_object(
      'status', 'recent_attempt',
      'dispatched', false,
      'payloadRedacted', true
    );
  end if;

  v_request_id := net.http_post(
    url := endpoint,
    headers := jsonb_build_object(
      'Authorization', 'Bearer ' || recovery_secret,
      'Content-Type', 'application/json'
    ),
    body := jsonb_build_object(
      'runKey', v_run_key,
      'trigger', 'scheduler_recovery'
    ),
    timeout_milliseconds := 15000
  );

  update public.refund_gmail_scheduler_dispatches dispatch
  set
    status = 'dispatched',
    request_id = v_request_id,
    dispatched_at = clock_timestamp()
  where dispatch.bucket_at = v_bucket_at;

  update public.refund_gmail_scheduler_settings
  set
    last_check_at = clock_timestamp(),
    last_check_status = 'dispatched',
    last_dispatch_at = clock_timestamp()
  where singleton;

  return jsonb_build_object(
    'status', 'dispatched',
    'dispatched', true,
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
    'lastRunStatus', run_row.status,
    'consecutiveFailures', state_row.consecutive_failures,
    'threadsScanned', coalesce(run_row.threads_scanned, 0),
    'messagesSeen', coalesce(run_row.messages_seen, 0),
    'messagesCreated', coalesce(run_row.messages_created, 0),
    'messagesDeduplicated', coalesce(run_row.messages_deduplicated, 0),
    'attachmentsQuarantined', coalesce(run_row.attachments_quarantined, 0),
    'messagesFailed', coalesce(run_row.messages_failed, 0),
    'errorCode', state_row.last_error_code,
    'schedulerEnabled', coalesce(scheduler_row.enabled, false),
    'schedulerStatus', scheduler_row.last_check_status,
    'schedulerLastCheckAt', scheduler_row.last_check_at,
    'schedulerLastDispatchAt', scheduler_row.last_dispatch_at,
    'payloadRedacted', true
  );
end;
$$;

revoke execute on function public.service_set_refund_gmail_scheduler_enabled(boolean)
  from public, anon, authenticated;
revoke execute on function public.service_dispatch_refund_gmail_scheduler_watchdog()
  from public, anon, authenticated;
grant execute on function public.service_set_refund_gmail_scheduler_enabled(boolean)
  to service_role;

revoke execute on function public.get_refund_gmail_health() from public, anon;
grant execute on function public.get_refund_gmail_health() to authenticated;

select cron.schedule(
  'refund-gmail-sync-watchdog-v1',
  '*/5 * * * *',
  'select public.service_dispatch_refund_gmail_scheduler_watchdog();'
);

comment on function public.service_dispatch_refund_gmail_scheduler_watchdog() is
  'Default-off, Vault-backed Gmail intake recovery. Has no payment or refund authority.';
