begin;

create extension if not exists pgtap with schema extensions;
set local search_path = public, extensions;

select plan(11);

select has_function(
  'public',
  'service_list_due_refund_provider_delay_attempts',
  array['timestamp with time zone', 'integer'],
  'The scheduler has a service-only provider-delay projection'
);

select ok(
  not has_table_privilege(
    'service_role',
    'public.refund_case_nayax_refund_attempts',
    'select'
  ),
  'The fix does not reopen the protected Nayax attempt table'
);

select ok(
  has_function_privilege(
    'service_role',
    'public.service_list_due_refund_provider_delay_attempts(timestamp with time zone,integer)',
    'execute'
  ),
  'The service workflow can execute the safe projection'
);

select ok(
  not has_function_privilege(
    'authenticated',
    'public.service_list_due_refund_provider_delay_attempts(timestamp with time zone,integer)',
    'execute'
  ),
  'Browser clients cannot execute the provider-delay projection'
);

insert into public.refund_automation_runs (
  run_key, trigger_source, scheduled_for, started_at, finished_at, status,
  reason_counts, failure_category
)
values
  (
    'scheduled:incident1069-success', 'scheduled', now() - interval '4 hours',
    now() - interval '4 hours', now() - interval '4 hours', 'succeeded',
    '{}'::jsonb, null
  ),
  (
    'scheduled:incident1069-failure-1', 'scheduled', now() - interval '3 hours',
    now() - interval '3 hours', now() - interval '3 hours', 'failed',
    '{"failed_stage_provider_delay_status":1}'::jsonb, 'database_failure'
  ),
  (
    'scheduled:incident1069-failure-2', 'scheduled', now() - interval '2 hours',
    now() - interval '2 hours', now() - interval '2 hours', 'failed',
    '{"failed_stage_provider_delay_status":1}'::jsonb, 'database_failure'
  ),
  (
    'scheduled:incident1069-legacy-noop', 'scheduled', now() - interval '1 hour',
    now() - interval '1 hour', now() - interval '1 hour', 'succeeded',
    '{"outside_policy_window":1}'::jsonb, null
  ),
  (
    'scheduled:incident1069-noop', 'scheduled', now(), now(), now(), 'suppressed',
    '{"outside_policy_window":1}'::jsonb, 'outside_policy_window'
  );

select is(
  public.service_get_refund_automation_health() ->> 'status',
  'failing',
  'Outside-policy heartbeats do not clear a processing failure'
);

select is(
  (public.service_get_refund_automation_health() ->> 'consecutiveFailures')::integer,
  2,
  'Outside-policy heartbeats do not reset the failure count'
);

select is(
  (public.service_get_refund_automation_health() ->> 'lastSuccessAt')::timestamptz,
  (
    select finished_at
    from public.refund_automation_runs
    where run_key = 'scheduled:incident1069-success'
  ),
  'A legacy outside-policy success is not reported as processing success'
);

select is(
  (
    public.service_get_refund_automation_health() ->> 'lastSchedulerHeartbeatAt'
  )::timestamptz,
  (
    select finished_at
    from public.refund_automation_runs
    where run_key = 'scheduled:incident1069-noop'
  ),
  'The corrected outside-policy run still proves the scheduler clock is alive'
);

insert into public.refund_automation_runs (
  run_key, trigger_source, scheduled_for, started_at, finished_at, status,
  reason_counts, failure_category
)
values (
  'scheduled:incident1069-recovery', 'scheduled', now() + interval '1 second',
  now() + interval '1 second', now() + interval '1 second', 'succeeded',
  '{}'::jsonb, null
);

select is(
  public.service_get_refund_automation_health() ->> 'status',
  'healthy',
  'A real in-policy success clears the processing failure'
);

select is(
  (public.service_get_refund_automation_health() ->> 'consecutiveFailures')::integer,
  0,
  'A real in-policy success resets the failure count'
);

select is(
  public.service_get_refund_automation_health() ->> 'payloadRedacted',
  'true',
  'Health output remains explicitly redacted'
);

select * from finish();
rollback;
