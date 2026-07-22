begin;

create extension if not exists pgtap with schema extensions;
set local search_path = public, extensions;

select plan(20);

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

insert into auth.users (
  instance_id,
  id,
  aud,
  role,
  email,
  encrypted_password,
  email_confirmed_at,
  raw_app_meta_data,
  raw_user_meta_data,
  created_at,
  updated_at
)
values (
  '00000000-0000-0000-0000-000000000000',
  '76000000-0000-4000-8000-000000000001',
  'authenticated',
  'authenticated',
  'refund-automation-manager@example.test',
  '',
  now(),
  '{}'::jsonb,
  '{}'::jsonb,
  now(),
  now()
);

insert into public.customer_accounts (id, name, account_type)
values ('76100000-0000-4000-8000-000000000001', 'Refund automation test', 'customer');

insert into public.reporting_locations (id, account_id, name, timezone)
values (
  '76200000-0000-4000-8000-000000000001',
  '76100000-0000-4000-8000-000000000001',
  'Refund automation test location',
  'America/Los_Angeles'
);

insert into public.reporting_machines (id, account_id, location_id, machine_label)
values (
  '76300000-0000-4000-8000-000000000001',
  '76100000-0000-4000-8000-000000000001',
  '76200000-0000-4000-8000-000000000001',
  'Refund automation test machine'
);

insert into public.reporting_machine_refund_managers (
  id,
  reporting_machine_id,
  manager_user_id,
  manager_email,
  grant_reason
)
values (
  '76400000-0000-4000-8000-000000000001',
  '76300000-0000-4000-8000-000000000001',
  '76000000-0000-4000-8000-000000000001',
  'refund-automation-manager@example.test',
  'Refund automation health test'
);

insert into public.refund_cases (
  id,
  public_reference,
  reporting_machine_id,
  reporting_location_id,
  customer_email,
  issue_summary,
  incident_at,
  payment_method,
  payment_amount_cents,
  card_last4,
  status,
  automation_state
)
values (
  '76500000-0000-4000-8000-000000000001',
  'RF-AUTOMATION-TEST',
  '76300000-0000-4000-8000-000000000001',
  '76200000-0000-4000-8000-000000000001',
  'refund-automation-customer@example.test',
  'Synthetic automation safety fixture',
  now() - interval '2 hours',
  'card',
  700,
  '4242',
  'waiting_on_customer',
  'more_info_needed'
);

select has_table('public', 'refund_automation_runs', 'Refund automation run ledger exists');
select has_table('public', 'refund_automation_actions', 'Refund automation action ledger exists');

select ok(
  not has_table_privilege('authenticated', 'public.refund_automation_runs', 'select'),
  'Authenticated browser clients cannot read raw automation runs'
);

select ok(
  not has_table_privilege('authenticated', 'public.refund_automation_actions', 'select'),
  'Authenticated browser clients cannot read action claims'
);

select ok(
  not has_function_privilege(
    'authenticated',
    'public.service_start_refund_automation_run(text,text,timestamp with time zone)',
    'execute'
  ),
  'Browser clients cannot start scheduler runs'
);

select ok(
  has_function_privilege(
    'service_role',
    'public.service_start_refund_automation_run(text,text,timestamp with time zone)',
    'execute'
  ),
  'The service workflow can start scheduler runs'
);

select is(
  (
    public.service_start_refund_automation_run(
      'scheduled:refund-automation-test-1',
      'scheduled',
      now()
    ) ->> 'claimed'
  )::boolean,
  true,
  'The first scheduler request claims its run key'
);

select is(
  (
    public.service_start_refund_automation_run(
      'scheduled:refund-automation-test-1',
      'scheduled',
      now()
    ) ->> 'claimed'
  )::boolean,
  false,
  'Replaying the same scheduler window is an idempotent no-op'
);

select is(
  (
    select count(*)::integer
    from public.refund_automation_runs
    where run_key = 'scheduled:refund-automation-test-1'
  ),
  1,
  'A repeated run key creates one run row'
);

select is(
  (
    public.service_claim_refund_automation_action(
      (select id from public.refund_automation_runs where run_key = 'scheduled:refund-automation-test-1'),
      '76500000-0000-4000-8000-000000000001',
      'reminder:76500000-0000-4000-8000-000000000001:window-1',
      'customer_reminder',
      'waiting_on_customer',
      date_trunc('hour', now())
    ) ->> 'claimed'
  )::boolean,
  true,
  'The first reminder action is claimed'
);

select is(
  (
    public.service_claim_refund_automation_action(
      (select id from public.refund_automation_runs where run_key = 'scheduled:refund-automation-test-1'),
      '76500000-0000-4000-8000-000000000001',
      'reminder:76500000-0000-4000-8000-000000000001:window-1',
      'customer_reminder',
      'waiting_on_customer',
      date_trunc('hour', now())
    ) ->> 'claimed'
  )::boolean,
  false,
  'Replaying the same case/state reminder does not claim a second action'
);

select is(
  (
    select count(*)::integer
    from public.refund_automation_actions
    where action_key = 'reminder:76500000-0000-4000-8000-000000000001:window-1'
  ),
  1,
  'A repeated reminder creates one action row'
);

select is(
  public.service_finish_refund_automation_action(
    (
      select id
      from public.refund_automation_actions
      where action_key = 'reminder:76500000-0000-4000-8000-000000000001:window-1'
    ),
    'completed',
    'reminder_sent',
    null
  ),
  true,
  'A claimed action can be completed once'
);

select is(
  public.service_finish_refund_automation_action(
    (
      select id
      from public.refund_automation_actions
      where action_key = 'reminder:76500000-0000-4000-8000-000000000001:window-1'
    ),
    'completed',
    'reminder_sent',
    null
  ),
  false,
  'A completed action cannot be completed twice'
);

select is(
  (
    public.service_start_refund_automation_run(
      'scheduled:refund-automation-test-2',
      'scheduled',
      now() + interval '15 minutes'
    ) ->> 'claimed'
  )::boolean,
  true,
  'A later scheduler window can start independently'
);

select is(
  (
    public.service_claim_refund_automation_action(
      (select id from public.refund_automation_runs where run_key = 'scheduled:refund-automation-test-2'),
      '76500000-0000-4000-8000-000000000001',
      'reminder:76500000-0000-4000-8000-000000000001:window-1',
      'customer_reminder',
      'waiting_on_customer',
      date_trunc('hour', now()) + interval '15 minutes'
    ) ->> 'claimed'
  )::boolean,
  false,
  'A later scheduler window cannot repeat the same case/state reminder action'
);

select is(
  public.service_finish_refund_automation_run(
    (select id from public.refund_automation_runs where run_key = 'scheduled:refund-automation-test-1'),
    'succeeded',
    1,
    1,
    1,
    0,
    0,
    '{"reminder_sent":1}'::jsonb,
    null,
    'not_needed'
  ),
  true,
  'A scheduler run records redacted aggregate completion metadata'
);

select set_config('request.jwt.claim.sub', '76000000-0000-4000-8000-000000000001', true);

select is(
  public.get_refund_automation_health() ->> 'status',
  'healthy',
  'An authorized refund manager sees a healthy scheduler state'
);

select is(
  public.get_refund_automation_health() ->> 'payloadRedacted',
  'true',
  'Manager health output is explicitly redacted'
);

select set_config('request.jwt.claim.sub', '', true);

select ok(
  pg_temp.capture_error('select public.get_refund_automation_health()') like '%Authentication required%',
  'Unauthenticated callers cannot read refund automation health'
);

select * from finish();
rollback;
