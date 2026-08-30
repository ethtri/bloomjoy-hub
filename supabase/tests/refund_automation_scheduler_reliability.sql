begin;

create extension if not exists pgtap with schema extensions;
set local search_path = public, extensions;

select plan(29);

create function pg_temp.capture_error(statement text)
returns text
language plpgsql
as $$
begin
  execute statement;
  return null;
exception
  when others then
    return sqlstate || ':' || sqlerrm;
end;
$$;

select has_table(
  'public',
  'refund_automation_scheduler_settings',
  'Primary refund scheduler settings exist'
);

select has_table(
  'public',
  'refund_automation_scheduler_dispatches',
  'Primary refund scheduler dispatch ledger exists'
);

select has_table(
  'public',
  'refund_automation_alert_incidents',
  'Refund scheduler alert incidents exist'
);

select ok(
  not has_table_privilege(
    'authenticated',
    'public.refund_automation_scheduler_settings',
    'select'
  ),
  'Authenticated clients cannot read scheduler settings'
);

select ok(
  not has_table_privilege(
    'authenticated',
    'public.refund_automation_scheduler_dispatches',
    'select'
  ),
  'Authenticated clients cannot read scheduler dispatches'
);

select ok(
  not has_table_privilege(
    'authenticated',
    'public.refund_automation_alert_incidents',
    'select'
  ),
  'Authenticated clients cannot read alert incidents'
);

select ok(
  has_function_privilege(
    'service_role',
    'public.service_set_refund_automation_scheduler_enabled(boolean)',
    'execute'
  ),
  'The service role can use the narrow scheduler enable switch'
);

select ok(
  has_function_privilege(
    'service_role',
    'public.service_claim_refund_automation_health_notification(text)',
    'execute'
  ),
  'The service role can claim health notifications'
);

select ok(
  not has_function_privilege(
    'service_role',
    'public.service_dispatch_refund_automation_scheduler(text)',
    'execute'
  ),
  'Only the database-owned cron job can dispatch the primary scheduler'
);

select is(
  (select enabled from public.refund_automation_scheduler_settings where singleton),
  false,
  'The primary scheduler is default-off'
);

select is(
  public.service_dispatch_refund_automation_scheduler('run') ->> 'status',
  'disabled',
  'A disabled primary scheduler performs no HTTP dispatch'
);

select ok(
  pg_temp.capture_error(
    $$select public.service_dispatch_refund_automation_scheduler('unsupported')$$
  ) like '%Unsupported refund automation scheduler mode%',
  'The primary scheduler rejects unsupported modes'
);

select is(
  public.service_claim_refund_automation_health_notification('stale')
    ->> 'notificationType',
  'initial',
  'The first stale observation claims one opening alert'
);

select is(
  (
    select count(*)::integer
    from public.refund_automation_alert_incidents
    where status = 'open'
  ),
  1,
  'Exactly one alert incident is open'
);

select is(
  public.service_claim_refund_automation_health_notification('stale')
    ->> 'notificationType',
  'none',
  'Repeated stale observations inside the cooldown send nothing'
);

select is(
  public.service_claim_refund_automation_health_notification('failing')
    ->> 'notificationType',
  'none',
  'Escalation to failing remains inside the same incident cooldown'
);

select is(
  (
    select incident_kind
    from public.refund_automation_alert_incidents
    where status = 'open'
  ),
  'repeated_failure',
  'An open stale incident can escalate without opening another incident'
);

update public.refund_automation_alert_incidents
set last_notification_claimed_at = now() - interval '25 hours'
where status = 'open';

select is(
  public.service_claim_refund_automation_health_notification('failing')
    ->> 'notificationType',
  'reminder',
  'An unresolved incident permits one reminder after the daily cooldown'
);

select is(
  (
    select notification_sequence
    from public.refund_automation_alert_incidents
    where status = 'open'
  ),
  2,
  'The daily reminder advances the incident notification sequence once'
);

select is(
  public.service_claim_refund_automation_health_notification('healthy')
    ->> 'notificationType',
  'none',
  'A brief healthy observation does not close the incident or send mail'
);

select ok(
  (
    select healthy_since is not null
    from public.refund_automation_alert_incidents
    where status = 'open'
  ),
  'The first healthy observation starts the stability window'
);

update public.refund_automation_alert_incidents
set healthy_since = now() - interval '61 minutes'
where status = 'open';

select is(
  public.service_claim_refund_automation_health_notification('healthy')
    ->> 'notificationType',
  'recovery',
  'One recovery notification is claimed after a stable healthy hour'
);

select is(
  (
    select count(*)::integer
    from public.refund_automation_alert_incidents
    where status = 'resolved'
      and close_reason = 'stable_recovery'
      and recovery_notification_claimed_at is not null
  ),
  1,
  'Stable recovery resolves the incident with one recovery claim'
);

select is(
  public.service_claim_refund_automation_health_notification('healthy')
    ->> 'notificationType',
  'none',
  'Later healthy checks cannot repeat the recovery notification'
);

select is(
  public.service_claim_refund_automation_health_notification('stale')
    ->> 'notificationType',
  'initial',
  'A genuinely new stale period can open one new incident'
);

select is(
  (
    select count(*)::integer
    from public.refund_automation_alert_incidents
    where status = 'open'
  ),
  1,
  'Only the new incident remains open after recovery'
);

select is(
  (select count(*)::integer from public.refund_automation_alert_incidents),
  2,
  'The incident ledger preserves one resolved and one open incident'
);

select is(
  public.service_get_refund_automation_health() ->> 'primarySchedulerEnabled',
  'false',
  'Health output reports the primary scheduler activation state'
);

select is(
  public.service_get_refund_automation_health() ->> 'alertIncidentOpen',
  'true',
  'Health output reports an open incident without exposing customer data'
);

select * from finish();
rollback;
