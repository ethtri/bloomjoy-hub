begin;

create extension if not exists pgtap with schema extensions;
set local search_path = public, extensions;

select plan(19);

select ok(
  not (
    select enabled
    from public.refund_gmail_primary_scheduler_settings
    where singleton
  ),
  'The independent Gmail primary scheduler defaults off'
);

select is(
  public.service_dispatch_refund_gmail_primary_scheduler() ->> 'status',
  'disabled',
  'A disabled primary scheduler exits before configuration or transport'
);

select is(
  public.service_dispatch_refund_gmail_primary_scheduler() ->> 'dispatched',
  'false',
  'A disabled primary scheduler dispatches nothing'
);

select is(
  public.service_dispatch_refund_gmail_primary_scheduler() ->> 'payloadRedacted',
  'true',
  'Primary scheduler results are explicitly redacted'
);

select is(
  public.service_dispatch_refund_gmail_primary_scheduler() ->> 'owner',
  'Refund Operations',
  'Primary scheduler health names the Refund Operations owner'
);

select ok(
  public.refund_gmail_workflow_run_key_is_valid(
    'supabase-primary:20260827T0410Z',
    'scheduler_primary'
  ),
  'An aligned UTC primary bucket is accepted'
);

select ok(
  not public.refund_gmail_workflow_run_key_is_valid(
    'supabase-primary:20260827T0411Z',
    'scheduler_primary'
  ),
  'An off-bucket primary key is rejected'
);

select ok(
  not public.refund_gmail_workflow_run_key_is_valid(
    'supabase-primary:20260827T0410Z',
    'scheduler_recovery'
  ),
  'A primary key cannot cross into the recovery trigger'
);

select ok(
  public.refund_gmail_retention_run_key_is_valid(
    'pre-sync:supabase-primary:20260827T0410Z',
    'pre_sync'
  ),
  'A primary run passes the mandatory pre-sync retention ledger'
);

select ok(
  not public.refund_gmail_retention_run_key_is_valid(
    'pre-sync:supabase-primary:20260827T0411Z',
    'pre_sync'
  ),
  'An off-bucket primary run cannot enter the retention ledger'
);

select ok(
  not has_function_privilege(
    'authenticated',
    'public.service_dispatch_refund_gmail_primary_scheduler()',
    'execute'
  ),
  'Authenticated browser sessions cannot invoke the primary scheduler'
);

select ok(
  not has_function_privilege(
    'service_role',
    'public.service_dispatch_refund_gmail_primary_scheduler()',
    'execute'
  ),
  'Service callers cannot bypass cron to dispatch the primary scheduler'
);

select ok(
  not has_function_privilege(
    'authenticated',
    'public.service_set_refund_gmail_primary_scheduler_enabled(boolean)',
    'execute'
  ),
  'Authenticated browser sessions cannot enable the primary scheduler'
);

select ok(
  has_function_privilege(
    'service_role',
    'public.service_set_refund_gmail_primary_scheduler_enabled(boolean)',
    'execute'
  ),
  'Only the service owner lane may change the primary scheduler gate'
);

select is(
  public.service_set_refund_gmail_primary_scheduler_enabled(true) ->> 'enabled',
  'true',
  'The owner lane can explicitly enable the primary scheduler'
);

update public.refund_gmail_sync_state
set
  enabled = true,
  connection_status = 'healthy',
  last_success_at = clock_timestamp() - interval '25 minutes',
  last_attempt_at = clock_timestamp() - interval '25 minutes';

select is(
  public.service_dispatch_refund_gmail_primary_scheduler() ->> 'status',
  'configuration_missing',
  'Missing exact Vault configuration fails closed before transport'
);

select is(
  (
    select last_check_status
    from public.refund_gmail_primary_scheduler_settings
    where singleton
  ),
  'configuration_missing',
  'The configuration failure is retained as redacted health'
);

select is(
  (
    select count(*)::text
    from public.refund_gmail_primary_scheduler_dispatches
  ),
  '0',
  'A configuration failure creates no dispatch intent'
);

select ok(
  exists (
    select 1
    from cron.job
    where jobname = 'refund-gmail-sync-primary-v1'
      and schedule = '2-59/10 * * * *'
      and active
  ),
  'The independent ten-minute cron is installed while its data gate remains off'
);

select * from finish();
rollback;
