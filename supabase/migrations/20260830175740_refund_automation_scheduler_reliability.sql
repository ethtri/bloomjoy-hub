-- #1045: make the database the primary refund-automation clock and turn
-- repeated stale alerts into one durable incident with bounded reminders.
--
-- Both schedules install default-off. GitHub remains an external fallback,
-- but both lanes use the same 15-minute run keys so a delayed GitHub event is
-- an idempotent replay instead of a second sweep.

create extension if not exists pg_cron with schema pg_catalog;
create extension if not exists pg_net with schema extensions;

create table if not exists public.refund_automation_scheduler_settings (
  singleton boolean primary key default true check (singleton),
  enabled boolean not null default false,
  cadence interval not null default interval '15 minutes'
    check (cadence = interval '15 minutes'),
  alert_reminder_interval interval not null default interval '24 hours'
    check (
      alert_reminder_interval >= interval '12 hours'
      and alert_reminder_interval <= interval '7 days'
    ),
  recovery_stable_for interval not null default interval '60 minutes'
    check (
      recovery_stable_for >= interval '30 minutes'
      and recovery_stable_for <= interval '6 hours'
    ),
  last_check_at timestamptz,
  last_check_mode text check (
    last_check_mode is null or last_check_mode in ('run', 'health_check')
  ),
  last_check_status text check (
    last_check_status is null
    or last_check_status in (
      'disabled',
      'recent_attempt',
      'configuration_missing',
      'configuration_invalid',
      'dispatched'
    )
  ),
  last_dispatch_at timestamptz,
  updated_at timestamptz not null default now()
);

insert into public.refund_automation_scheduler_settings (singleton, enabled)
values (true, false)
on conflict (singleton) do nothing;

create table if not exists public.refund_automation_scheduler_dispatches (
  mode text not null check (mode in ('run', 'health_check')),
  bucket_at timestamptz not null,
  run_key text not null unique check (
    run_key ~ '^(scheduled|health_check):20[0-9]{6}T([01][0-9]|2[0-3])[0-5][0-9]Z$'
  ),
  status text not null check (status in ('dispatching', 'dispatched')),
  request_id bigint unique,
  created_at timestamptz not null default now(),
  dispatched_at timestamptz,
  primary key (mode, bucket_at)
);

create index if not exists refund_automation_scheduler_dispatches_created_idx
  on public.refund_automation_scheduler_dispatches (created_at desc);

create table if not exists public.refund_automation_alert_incidents (
  id uuid primary key default gen_random_uuid(),
  incident_kind text not null check (incident_kind in ('stale', 'repeated_failure')),
  status text not null default 'open' check (status in ('open', 'resolved', 'closed')),
  opened_at timestamptz not null default now(),
  last_observed_at timestamptz not null default now(),
  healthy_since timestamptz,
  initial_notification_claimed_at timestamptz not null default now(),
  last_notification_claimed_at timestamptz not null default now(),
  notification_sequence integer not null default 1 check (notification_sequence >= 1),
  recovered_at timestamptz,
  recovery_notification_claimed_at timestamptz,
  close_reason text check (
    close_reason is null or close_reason in ('stable_recovery', 'automation_paused')
  ),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint refund_automation_alert_incidents_recovery_check check (
    (status = 'open' and recovered_at is null and close_reason is null)
    or (status in ('resolved', 'closed') and recovered_at is not null and close_reason is not null)
  )
);

create unique index if not exists refund_automation_alert_incidents_one_open_idx
  on public.refund_automation_alert_incidents ((status))
  where status = 'open';

create index if not exists refund_automation_alert_incidents_opened_idx
  on public.refund_automation_alert_incidents (opened_at desc);

alter table public.refund_automation_scheduler_settings enable row level security;
alter table public.refund_automation_scheduler_dispatches enable row level security;
alter table public.refund_automation_alert_incidents enable row level security;

revoke all on table public.refund_automation_scheduler_settings
  from public, anon, authenticated;
revoke all on table public.refund_automation_scheduler_dispatches
  from public, anon, authenticated;
revoke all on table public.refund_automation_alert_incidents
  from public, anon, authenticated;

grant select, insert, update, delete on table public.refund_automation_scheduler_settings
  to service_role;
grant select, insert, update, delete on table public.refund_automation_scheduler_dispatches
  to service_role;
grant select, insert, update, delete on table public.refund_automation_alert_incidents
  to service_role;

create or replace function public.service_set_refund_automation_scheduler_enabled(
  p_enabled boolean
)
returns jsonb
language plpgsql
security invoker
set search_path = public
as $$
begin
  update public.refund_automation_scheduler_settings
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
    'payloadRedacted', true
  );
end;
$$;

create or replace function public.service_dispatch_refund_automation_scheduler(
  p_mode text
)
returns jsonb
language plpgsql
security invoker
set search_path = public, extensions, net, vault, pg_catalog
as $$
declare
  normalized_mode text := lower(btrim(coalesce(p_mode, '')));
  settings_row public.refund_automation_scheduler_settings;
  endpoint text;
  scheduler_secret text;
  endpoint_count integer;
  secret_count integer;
  v_bucket_at timestamptz;
  v_run_key text;
  v_request_id bigint;
begin
  if normalized_mode not in ('run', 'health_check') then
    raise exception 'Unsupported refund automation scheduler mode';
  end if;

  if not pg_try_advisory_xact_lock(
    628,
    case when normalized_mode = 'run' then 10451 else 10452 end
  ) then
    return jsonb_build_object(
      'status', 'recent_attempt',
      'mode', normalized_mode,
      'dispatched', false,
      'payloadRedacted', true
    );
  end if;

  select * into settings_row
  from public.refund_automation_scheduler_settings
  where singleton
  for update;

  if not coalesce(settings_row.enabled, false) then
    update public.refund_automation_scheduler_settings
    set
      last_check_at = clock_timestamp(),
      last_check_mode = normalized_mode,
      last_check_status = 'disabled',
      updated_at = clock_timestamp()
    where singleton;
    return jsonb_build_object(
      'status', 'disabled',
      'mode', normalized_mode,
      'dispatched', false,
      'payloadRedacted', true
    );
  end if;

  select count(*), max(decrypted_secret)
    into endpoint_count, endpoint
  from vault.decrypted_secrets
  where name = 'refund_automation_scheduler_url';

  select count(*), max(decrypted_secret)
    into secret_count, scheduler_secret
  from vault.decrypted_secrets
  where name = 'refund_automation_scheduler_secret';

  if endpoint_count <> 1 or secret_count <> 1 then
    update public.refund_automation_scheduler_settings
    set
      last_check_at = clock_timestamp(),
      last_check_mode = normalized_mode,
      last_check_status = 'configuration_missing',
      updated_at = clock_timestamp()
    where singleton;
    return jsonb_build_object(
      'status', 'configuration_missing',
      'mode', normalized_mode,
      'dispatched', false,
      'payloadRedacted', true
    );
  end if;

  if endpoint !~ '^https://[a-z0-9]{20}\.supabase\.co/functions/v1/refund-case-automation-sweep$'
    or length(scheduler_secret) < 32
    or length(scheduler_secret) > 255 then
    update public.refund_automation_scheduler_settings
    set
      last_check_at = clock_timestamp(),
      last_check_mode = normalized_mode,
      last_check_status = 'configuration_invalid',
      updated_at = clock_timestamp()
    where singleton;
    return jsonb_build_object(
      'status', 'configuration_invalid',
      'mode', normalized_mode,
      'dispatched', false,
      'payloadRedacted', true
    );
  end if;

  v_bucket_at := to_timestamp(
    floor(extract(epoch from clock_timestamp()) / 900) * 900
  );
  v_run_key := case
    when normalized_mode = 'run' then 'scheduled:'
    else 'health_check:'
  end || to_char(v_bucket_at at time zone 'UTC', 'YYYYMMDD"T"HH24MI"Z"');

  insert into public.refund_automation_scheduler_dispatches (
    mode,
    bucket_at,
    run_key,
    status
  )
  values (normalized_mode, v_bucket_at, v_run_key, 'dispatching')
  on conflict (mode, bucket_at) do nothing;

  if not found then
    update public.refund_automation_scheduler_settings
    set
      last_check_at = clock_timestamp(),
      last_check_mode = normalized_mode,
      last_check_status = 'recent_attempt',
      updated_at = clock_timestamp()
    where singleton;
    return jsonb_build_object(
      'status', 'recent_attempt',
      'mode', normalized_mode,
      'dispatched', false,
      'runKey', v_run_key,
      'payloadRedacted', true
    );
  end if;

  v_request_id := net.http_post(
    url := endpoint,
    headers := jsonb_build_object(
      'Authorization', 'Bearer ' || scheduler_secret,
      'Content-Type', 'application/json'
    ),
    body := jsonb_strip_nulls(jsonb_build_object(
      'mode', normalized_mode,
      'triggerSource', case when normalized_mode = 'run' then 'scheduled' else null end,
      'runKey', v_run_key,
      'scheduledAt', v_bucket_at
    )),
    timeout_milliseconds := 15000
  );

  update public.refund_automation_scheduler_dispatches
  set
    status = 'dispatched',
    request_id = v_request_id,
    dispatched_at = clock_timestamp()
  where mode = normalized_mode
    and bucket_at = v_bucket_at;

  update public.refund_automation_scheduler_settings
  set
    last_check_at = clock_timestamp(),
    last_check_mode = normalized_mode,
    last_check_status = 'dispatched',
    last_dispatch_at = clock_timestamp(),
    updated_at = clock_timestamp()
  where singleton;

  delete from public.refund_automation_scheduler_dispatches
  where created_at < clock_timestamp() - interval '30 days';

  return jsonb_build_object(
    'status', 'dispatched',
    'mode', normalized_mode,
    'dispatched', true,
    'runKey', v_run_key,
    'payloadRedacted', true
  );
end;
$$;

create or replace function public.service_claim_refund_automation_health_notification(
  p_health_status text
)
returns jsonb
language plpgsql
security invoker
set search_path = public
as $$
declare
  normalized_status text := lower(btrim(coalesce(p_health_status, '')));
  settings_row public.refund_automation_scheduler_settings;
  incident_row public.refund_automation_alert_incidents;
  v_now timestamptz := clock_timestamp();
  v_kind text;
  v_sequence integer;
  v_action_key text;
begin
  if normalized_status not in ('healthy', 'stale', 'failing', 'paused', 'waiting') then
    raise exception 'Unsupported refund automation health state';
  end if;

  perform pg_advisory_xact_lock(628, 10453);

  select * into settings_row
  from public.refund_automation_scheduler_settings
  where singleton;

  select * into incident_row
  from public.refund_automation_alert_incidents
  where status = 'open'
  order by opened_at desc
  limit 1
  for update;

  if normalized_status in ('stale', 'failing') then
    v_kind := case
      when normalized_status = 'failing' then 'repeated_failure'
      else 'stale'
    end;

    if incident_row.id is null then
      insert into public.refund_automation_alert_incidents (
        incident_kind,
        status,
        opened_at,
        last_observed_at,
        initial_notification_claimed_at,
        last_notification_claimed_at,
        notification_sequence
      )
      values (v_kind, 'open', v_now, v_now, v_now, v_now, 1)
      returning * into incident_row;

      v_action_key := 'ops_alert:incident:' || incident_row.id::text || ':initial';
      return jsonb_build_object(
        'notificationType', 'initial',
        'alertKind', incident_row.incident_kind,
        'incidentId', incident_row.id,
        'actionKey', v_action_key,
        'payloadRedacted', true
      );
    end if;

    update public.refund_automation_alert_incidents
    set
      incident_kind = case
        when v_kind = 'repeated_failure' then 'repeated_failure'
        else incident_kind
      end,
      last_observed_at = v_now,
      healthy_since = null,
      updated_at = v_now
    where id = incident_row.id
    returning * into incident_row;

    if incident_row.last_notification_claimed_at
      <= v_now - settings_row.alert_reminder_interval then
      v_sequence := incident_row.notification_sequence + 1;
      update public.refund_automation_alert_incidents
      set
        last_notification_claimed_at = v_now,
        notification_sequence = v_sequence,
        updated_at = v_now
      where id = incident_row.id;

      v_action_key := 'ops_alert:incident:' || incident_row.id::text
        || ':reminder:' || v_sequence::text;
      return jsonb_build_object(
        'notificationType', 'reminder',
        'alertKind', incident_row.incident_kind,
        'incidentId', incident_row.id,
        'actionKey', v_action_key,
        'payloadRedacted', true
      );
    end if;

    return jsonb_build_object(
      'notificationType', 'none',
      'alertKind', incident_row.incident_kind,
      'incidentId', incident_row.id,
      'payloadRedacted', true
    );
  end if;

  if incident_row.id is null then
    return jsonb_build_object(
      'notificationType', 'none',
      'payloadRedacted', true
    );
  end if;

  if normalized_status = 'paused' then
    update public.refund_automation_alert_incidents
    set
      status = 'closed',
      last_observed_at = v_now,
      recovered_at = v_now,
      close_reason = 'automation_paused',
      updated_at = v_now
    where id = incident_row.id;

    return jsonb_build_object(
      'notificationType', 'none',
      'alertKind', incident_row.incident_kind,
      'incidentId', incident_row.id,
      'payloadRedacted', true
    );
  end if;

  if normalized_status <> 'healthy' then
    update public.refund_automation_alert_incidents
    set healthy_since = null, last_observed_at = v_now, updated_at = v_now
    where id = incident_row.id;
    return jsonb_build_object(
      'notificationType', 'none',
      'alertKind', incident_row.incident_kind,
      'incidentId', incident_row.id,
      'payloadRedacted', true
    );
  end if;

  if incident_row.healthy_since is null then
    update public.refund_automation_alert_incidents
    set healthy_since = v_now, last_observed_at = v_now, updated_at = v_now
    where id = incident_row.id;
    return jsonb_build_object(
      'notificationType', 'none',
      'alertKind', incident_row.incident_kind,
      'incidentId', incident_row.id,
      'payloadRedacted', true
    );
  end if;

  if incident_row.healthy_since > v_now - settings_row.recovery_stable_for then
    update public.refund_automation_alert_incidents
    set last_observed_at = v_now, updated_at = v_now
    where id = incident_row.id;
    return jsonb_build_object(
      'notificationType', 'none',
      'alertKind', incident_row.incident_kind,
      'incidentId', incident_row.id,
      'payloadRedacted', true
    );
  end if;

  v_sequence := incident_row.notification_sequence + 1;
  update public.refund_automation_alert_incidents
  set
    status = 'resolved',
    last_observed_at = v_now,
    last_notification_claimed_at = v_now,
    notification_sequence = v_sequence,
    recovered_at = v_now,
    recovery_notification_claimed_at = v_now,
    close_reason = 'stable_recovery',
    updated_at = v_now
  where id = incident_row.id;

  v_action_key := 'ops_alert:incident:' || incident_row.id::text || ':recovery';
  return jsonb_build_object(
    'notificationType', 'recovery',
    'alertKind', incident_row.incident_kind,
    'incidentId', incident_row.id,
    'actionKey', v_action_key,
    'payloadRedacted', true
  );
end;
$$;

create or replace function public.service_get_refund_automation_health()
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  latest_run public.refund_automation_runs;
  latest_success public.refund_automation_runs;
  scheduler_row public.refund_automation_scheduler_settings;
  incident_row public.refund_automation_alert_incidents;
  consecutive_failures integer := 0;
  stale_after_minutes integer := 60;
  health_status text;
begin
  select * into latest_run
  from public.refund_automation_runs automation_run
  where automation_run.trigger_source in ('scheduled', 'manual')
  order by automation_run.started_at desc
  limit 1;

  select * into latest_success
  from public.refund_automation_runs automation_run
  where automation_run.trigger_source in ('scheduled', 'manual')
    and automation_run.status = 'succeeded'
  order by automation_run.finished_at desc nulls last, automation_run.started_at desc
  limit 1;

  select count(*)::integer into consecutive_failures
  from public.refund_automation_runs automation_run
  where automation_run.trigger_source in ('scheduled', 'manual')
    and automation_run.status = 'failed'
    and (
      latest_success.id is null
      or automation_run.started_at > latest_success.started_at
    );

  select * into scheduler_row
  from public.refund_automation_scheduler_settings
  where singleton;

  select * into incident_row
  from public.refund_automation_alert_incidents
  where status = 'open'
  order by opened_at desc
  limit 1;

  health_status := case
    when latest_run.id is null then 'waiting'
    when latest_run.status = 'suppressed'
      and latest_run.failure_category = 'automation_disabled' then 'paused'
    when latest_success.id is null and consecutive_failures >= 2 then 'failing'
    when latest_success.id is null then 'waiting'
    when latest_success.finished_at < now() - make_interval(mins => stale_after_minutes) then 'stale'
    when latest_run.status = 'failed' or consecutive_failures >= 2 then 'failing'
    else 'healthy'
  end;

  return jsonb_build_object(
    'status', health_status,
    'lastRunAt', latest_run.started_at,
    'lastSuccessAt', latest_success.finished_at,
    'lastRunStatus', latest_run.status,
    'consecutiveFailures', consecutive_failures,
    'staleAfterMinutes', stale_after_minutes,
    'casesEvaluated', coalesce(latest_run.cases_evaluated, 0),
    'actionsAttempted', coalesce(latest_run.actions_attempted, 0),
    'actionsSucceeded', coalesce(latest_run.actions_succeeded, 0),
    'actionsFailed', coalesce(latest_run.actions_failed, 0),
    'actionsSuppressed', coalesce(latest_run.actions_suppressed, 0),
    'failureCategory', latest_run.failure_category,
    'alertStatus', coalesce(latest_run.alert_status, 'not_needed'),
    'primarySchedulerEnabled', coalesce(scheduler_row.enabled, false),
    'primarySchedulerStatus', scheduler_row.last_check_status,
    'primarySchedulerMode', scheduler_row.last_check_mode,
    'primarySchedulerLastCheckAt', scheduler_row.last_check_at,
    'primarySchedulerLastDispatchAt', scheduler_row.last_dispatch_at,
    'alertIncidentOpen', incident_row.id is not null,
    'alertIncidentKind', incident_row.incident_kind,
    'alertIncidentOpenedAt', incident_row.opened_at,
    'alertIncidentLastNotificationAt', incident_row.last_notification_claimed_at,
    'payloadRedacted', true
  );
end;
$$;

revoke execute on function public.service_set_refund_automation_scheduler_enabled(boolean)
  from public, anon, authenticated;
revoke execute on function public.service_dispatch_refund_automation_scheduler(text)
  from public, anon, authenticated, service_role;
revoke execute on function public.service_claim_refund_automation_health_notification(text)
  from public, anon, authenticated;

grant execute on function public.service_set_refund_automation_scheduler_enabled(boolean)
  to service_role;
grant execute on function public.service_claim_refund_automation_health_notification(text)
  to service_role;

select cron.schedule(
  'refund-automation-sweep-primary-v1',
  '7,22,37,52 * * * *',
  $$select public.service_dispatch_refund_automation_scheduler('run');$$
);

select cron.schedule(
  'refund-automation-health-primary-v1',
  '13,28,43,58 * * * *',
  $$select public.service_dispatch_refund_automation_scheduler('health_check');$$
);

comment on table public.refund_automation_alert_incidents is
  'PII-free scheduler incidents. One incident survives brief recoveries, limits reminders to daily, and closes after one stable hour.';
comment on function public.service_dispatch_refund_automation_scheduler(text) is
  'Default-off Vault-backed primary clock for idempotent refund sweeps and health checks.';
comment on function public.service_claim_refund_automation_health_notification(text) is
  'Claims one initial scheduler alert, at most daily reminders, and one stable-recovery notification per incident.';

select pg_notify('pgrst', 'reload schema');
