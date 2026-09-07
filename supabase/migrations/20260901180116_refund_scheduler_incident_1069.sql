-- #1069: restore the refund scheduler after a denied provider-delay read and
-- keep outside-policy clock heartbeats from clearing a processing failure.

create or replace function public.service_list_due_refund_provider_delay_attempts(
  p_observed_at timestamptz,
  p_limit integer default 100
)
returns table (
  id uuid,
  refund_case_id uuid,
  status text,
  safe_transport_stage text,
  reconciliation_required boolean,
  refund_operations_due_at timestamptz,
  created_at timestamptz
)
language sql
stable
security definer
set search_path = ''
as $$
  select
    attempt.id,
    attempt.refund_case_id,
    attempt.status,
    attempt.safe_transport_stage,
    attempt.reconciliation_required,
    attempt.refund_operations_due_at,
    attempt.created_at
  from public.refund_case_nayax_refund_attempts attempt
  where attempt.reconciliation_required is true
    and attempt.safe_transport_stage = 'confirmation_hold'
    and attempt.refund_operations_due_at <= coalesce(p_observed_at, statement_timestamp())
    and not exists (
      select 1
      from public.refund_case_nayax_refund_attempts later_attempt
      where later_attempt.refund_case_id = attempt.refund_case_id
        and (later_attempt.created_at, later_attempt.id) >
          (attempt.created_at, attempt.id)
    )
  order by attempt.created_at desc, attempt.id desc
  limit least(greatest(coalesce(p_limit, 100), 1), 100);
$$;

revoke execute on function public.service_list_due_refund_provider_delay_attempts(
  timestamptz,
  integer
) from public, anon, authenticated;
grant execute on function public.service_list_due_refund_provider_delay_attempts(
  timestamptz,
  integer
) to service_role;

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
  latest_scheduler_heartbeat public.refund_automation_runs;
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

  -- A processing success must have entered the policy window. Older releases
  -- stored outside-window no-op runs as succeeded, so exclude those by their
  -- durable reason as well as using the corrected status for new runs.
  select * into latest_success
  from public.refund_automation_runs automation_run
  where automation_run.trigger_source in ('scheduled', 'manual')
    and automation_run.status = 'succeeded'
    and not (automation_run.reason_counts ? 'outside_policy_window')
  order by automation_run.finished_at desc nulls last, automation_run.started_at desc
  limit 1;

  -- An outside-window no-op still proves the scheduler clock is alive. It may
  -- prevent a stale-clock alert, but it must not erase a processing failure.
  select * into latest_scheduler_heartbeat
  from public.refund_automation_runs automation_run
  where automation_run.trigger_source in ('scheduled', 'manual')
    and (
      automation_run.status = 'succeeded'
      or (
        automation_run.status = 'suppressed'
        and automation_run.failure_category = 'outside_policy_window'
      )
    )
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
    when consecutive_failures > 0 then 'failing'
    when latest_scheduler_heartbeat.id is null then 'waiting'
    when latest_scheduler_heartbeat.finished_at
      < now() - make_interval(mins => stale_after_minutes) then 'stale'
    when latest_success.id is null then 'waiting'
    else 'healthy'
  end;

  return jsonb_build_object(
    'status', health_status,
    'lastRunAt', latest_run.started_at,
    'lastSuccessAt', latest_success.finished_at,
    'lastSchedulerHeartbeatAt', latest_scheduler_heartbeat.finished_at,
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

comment on function public.service_list_due_refund_provider_delay_attempts(
  timestamptz,
  integer
) is 'Service-only PII-free projection of current due Nayax confirmation holds for refund automation.';
comment on function public.service_get_refund_automation_health() is
  'Separates scheduler clock heartbeats from in-policy processing success so no-op runs cannot clear failures.';

select pg_notify('pgrst', 'reload schema');
