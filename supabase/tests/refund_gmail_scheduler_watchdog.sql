begin;

create extension if not exists pgtap with schema extensions;
set local search_path = public, extensions;

select plan(17);

select ok(
  not (select enabled from public.refund_gmail_scheduler_settings where singleton),
  'The independent Gmail watchdog defaults off'
);

select is(
  public.service_dispatch_refund_gmail_scheduler_watchdog() ->> 'status',
  'disabled',
  'A disabled watchdog exits before configuration or transport'
);

select is(
  public.service_dispatch_refund_gmail_scheduler_watchdog() ->> 'dispatched',
  'false',
  'A disabled watchdog dispatches nothing'
);

select is(
  public.service_dispatch_refund_gmail_scheduler_watchdog() ->> 'payloadRedacted',
  'true',
  'Watchdog results are explicitly redacted'
);

select ok(
  public.refund_gmail_workflow_run_key_is_valid(
    'supabase-recovery:20260827T0410Z',
    'scheduler_recovery'
  ),
  'An aligned UTC recovery bucket is accepted'
);

select ok(
  not public.refund_gmail_workflow_run_key_is_valid(
    'supabase-recovery:20260827T0411Z',
    'scheduler_recovery'
  ),
  'An off-bucket recovery key is rejected'
);

select ok(
  not public.refund_gmail_workflow_run_key_is_valid(
    'supabase-recovery:20260827T0410Z',
    'scheduled'
  ),
  'A recovery key cannot cross into the primary scheduler trigger'
);

select ok(
  public.refund_gmail_retention_run_key_is_valid(
    'pre-sync:supabase-recovery:20260827T0410Z',
    'pre_sync'
  ),
  'A recovery run passes the mandatory pre-sync retention ledger'
);

select ok(
  not public.refund_gmail_retention_run_key_is_valid(
    'pre-sync:supabase-recovery:20260827T0411Z',
    'pre_sync'
  ),
  'An off-bucket recovery run cannot enter the retention ledger'
);

select ok(
  not has_function_privilege(
    'authenticated',
    'public.service_dispatch_refund_gmail_scheduler_watchdog()',
    'execute'
  ),
  'Authenticated browser sessions cannot invoke the watchdog'
);

select ok(
  not has_function_privilege(
    'authenticated',
    'public.service_set_refund_gmail_scheduler_enabled(boolean)',
    'execute'
  ),
  'Authenticated browser sessions cannot enable the watchdog'
);

select ok(
  has_function_privilege(
    'service_role',
    'public.service_set_refund_gmail_scheduler_enabled(boolean)',
    'execute'
  ),
  'Only the service owner lane may change the watchdog gate'
);

select is(
  public.service_set_refund_gmail_scheduler_enabled(true) ->> 'enabled',
  'true',
  'The owner lane can explicitly enable the watchdog'
);

update public.refund_gmail_sync_state
set
  enabled = true,
  connection_status = 'healthy',
  last_success_at = clock_timestamp() - interval '25 minutes',
  last_attempt_at = clock_timestamp() - interval '25 minutes';

select is(
  public.service_dispatch_refund_gmail_scheduler_watchdog() ->> 'status',
  'configuration_missing',
  'Missing exact Vault configuration fails closed before transport'
);

select is(
  (select last_check_status from public.refund_gmail_scheduler_settings where singleton),
  'configuration_missing',
  'The configuration failure is retained as redacted health'
);

select is(
  (select count(*)::text from public.refund_gmail_scheduler_dispatches),
  '0',
  'A configuration failure creates no dispatch intent'
);

select ok(
  exists (
    select 1
    from cron.job
    where jobname = 'refund-gmail-sync-watchdog-v1'
      and schedule = '*/5 * * * *'
      and active
  ),
  'The independent five-minute cron is installed while its data gate remains off'
);

select * from finish();
rollback;
