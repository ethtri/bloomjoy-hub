-- #1054: match the refund scheduler to current operating volume without
-- weakening its idempotency, incident, customer-contact, or payment gates.
--
-- The 30-minute primary and fallback lanes share one UTC bucket. Health is
-- stale only after 90 minutes, so a normal delayed tick cannot recreate the
-- false-positive alert pattern fixed by #1045.

alter table public.refund_automation_scheduler_settings
  drop constraint if exists refund_automation_scheduler_settings_cadence_check;

alter table public.refund_automation_scheduler_settings
  alter column cadence set default interval '30 minutes';

update public.refund_automation_scheduler_settings
set cadence = interval '30 minutes', updated_at = clock_timestamp()
where singleton;

alter table public.refund_automation_scheduler_settings
  add constraint refund_automation_scheduler_settings_cadence_check
  check (cadence = interval '30 minutes');

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
    floor(extract(epoch from clock_timestamp()) / 1800) * 1800
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
  stale_after_minutes integer := 90;
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

select cron.schedule(
  'refund-automation-sweep-primary-v1',
  '7,37 * * * *',
  $$select public.service_dispatch_refund_automation_scheduler('run');$$
);

select cron.schedule(
  'refund-automation-health-primary-v1',
  '13,43 * * * *',
  $$select public.service_dispatch_refund_automation_scheduler('health_check');$$
);

comment on function public.service_dispatch_refund_automation_scheduler(text) is
  'Default-off Vault-backed 30-minute primary clock for idempotent refund sweeps and health checks.';

select pg_notify('pgrst', 'reload schema');
