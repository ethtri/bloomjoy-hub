begin;

create extension if not exists pgtap with schema extensions;
set local search_path = public, extensions;

select plan(11);

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

select is(
  (select cadence from public.refund_automation_scheduler_settings where singleton),
  interval '30 minutes',
  'The refund automation scheduler cadence is 30 minutes'
);

select ok(
  pg_temp.capture_error(
    $$update public.refund_automation_scheduler_settings
      set cadence = interval '15 minutes'
      where singleton$$
  ) like '23514:%',
  'The scheduler settings reject a cadence other than 30 minutes'
);

select is(
  public.service_get_refund_automation_health() ->> 'staleAfterMinutes',
  '90',
  'Health waits 90 minutes before declaring the 30-minute scheduler stale'
);

select ok(
  position(
    '/ 1800) * 1800'
    in pg_get_functiondef(
      'public.service_dispatch_refund_automation_scheduler(text)'::regprocedure
    )
  ) > 0,
  'Database dispatches use exact 30-minute UTC buckets'
);

select ok(
  position(
    '/ 900) * 900'
    in pg_get_functiondef(
      'public.service_dispatch_refund_automation_scheduler(text)'::regprocedure
    )
  ) = 0,
  'The final database dispatcher no longer uses 15-minute buckets'
);

select is(
  (
    select schedule
    from cron.job
    where jobname = 'refund-automation-sweep-primary-v1'
  ),
  '7,37 * * * *',
  'The primary sweep runs twice per hour'
);

select is(
  (
    select schedule
    from cron.job
    where jobname = 'refund-automation-health-primary-v1'
  ),
  '13,43 * * * *',
  'The primary health check runs twice per hour'
);

select is(
  (
    select count(*)::integer
    from cron.job
    where jobname = 'refund-automation-sweep-primary-v1'
  ),
  1,
  'Cadence replacement preserves one primary sweep job'
);

select is(
  (
    select count(*)::integer
    from cron.job
    where jobname = 'refund-automation-health-primary-v1'
  ),
  1,
  'Cadence replacement preserves one primary health job'
);

update public.refund_automation_scheduler_settings
set enabled = false
where singleton;

select is(
  public.service_dispatch_refund_automation_scheduler('run') ->> 'status',
  'disabled',
  'The 30-minute primary sweep remains default-off'
);

select is(
  public.service_dispatch_refund_automation_scheduler('health_check') ->> 'status',
  'disabled',
  'The 30-minute primary health schedule remains default-off'
);

select * from finish();
rollback;
