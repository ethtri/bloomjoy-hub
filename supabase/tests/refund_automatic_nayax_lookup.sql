begin;

create extension if not exists pgtap with schema extensions;
set local search_path = public, extensions;

select plan(8);

insert into public.refund_cases (
  id, customer_email, issue_summary, status, intake_source, automation_state
) values (
  '63000000-0000-4000-8000-000000000001',
  'automatic-lookup-test@example.invalid',
  'Sanitized automatic lookup operation test',
  'draft',
  'gmail',
  'customer_replied'
);

select is(
  (public.service_start_refund_automation_run(
    'nayax_event:63000000-0000-4000-8000-000000000001:v1',
    'event',
    null
  ) ->> 'claimed')::boolean,
  true,
  'A ready-evidence event can claim one automation run'
);

select is(
  (public.service_start_refund_automation_run(
    'nayax_event:63000000-0000-4000-8000-000000000001:v1',
    'event',
    null
  ) ->> 'claimed')::boolean,
  false,
  'The same case evidence version cannot claim a second run'
);

select is(
  (public.service_claim_refund_automation_action(
    (select id from public.refund_automation_runs
      where run_key = 'nayax_event:63000000-0000-4000-8000-000000000001:v1'),
    '63000000-0000-4000-8000-000000000001',
    'nayax_lookup:63000000-0000-4000-8000-000000000001:v1',
    'nayax_lookup',
    'ready:hosted_intake:v1',
    null
  ) ->> 'claimed')::boolean,
  true,
  'The current evidence version claims one lookup operation'
);

select is(
  (public.service_claim_refund_automation_action(
    (select id from public.refund_automation_runs
      where run_key = 'nayax_event:63000000-0000-4000-8000-000000000001:v1'),
    '63000000-0000-4000-8000-000000000001',
    'nayax_lookup:63000000-0000-4000-8000-000000000001:v1',
    'nayax_lookup',
    'ready:customer_reply_recheck:v1',
    null
  ) ->> 'claimed')::boolean,
  false,
  'Concurrent or repeated triggers deduplicate on the shared action key'
);

select is(
  (select count(*)::integer from public.refund_automation_actions
    where action_key = 'nayax_lookup:63000000-0000-4000-8000-000000000001:v1'),
  1,
  'Exactly one lookup operation is recorded for unchanged evidence'
);

select is(
  public.service_finish_refund_automation_action(
    (select id from public.refund_automation_actions
      where action_key = 'nayax_lookup:63000000-0000-4000-8000-000000000001:v1'),
    'completed',
    'nayax_review_ready',
    null
  ),
  true,
  'The claimed lookup operation records its terminal result'
);

select is(
  public.service_finish_refund_automation_run(
    (select id from public.refund_automation_runs
      where run_key = 'nayax_event:63000000-0000-4000-8000-000000000001:v1'),
    'succeeded', 1, 1, 1, 0, 0,
    '{"nayax_review_ready":1}'::jsonb,
    null,
    'not_needed'
  ),
  true,
  'The event run records successful completion'
);

select ok(
  (
    pg_get_functiondef('public.admin_get_refund_operations_overview()'::regprocedure)
    || pg_get_functiondef('public.admin_get_refund_operations_overview_pre_customer_correction_v1()'::regprocedure)
    || pg_get_functiondef('public.admin_get_refund_operations_overview_pre_manager_queue_truth_v1()'::regprocedure)
  )
    like '%current_lookup.status = ''claimed''%'
  and (
    pg_get_functiondef('public.admin_get_refund_operations_overview()'::regprocedure)
    || pg_get_functiondef('public.admin_get_refund_operations_overview_pre_customer_correction_v1()'::regprocedure)
    || pg_get_functiondef('public.admin_get_refund_operations_overview_pre_manager_queue_truth_v1()'::regprocedure)
  )
    like '%lookup_failed%'
  and (
    pg_get_functiondef('public.admin_get_refund_operations_overview()'::regprocedure)
    || pg_get_functiondef('public.admin_get_refund_operations_overview_pre_customer_correction_v1()'::regprocedure)
    || pg_get_functiondef('public.admin_get_refund_operations_overview_pre_manager_queue_truth_v1()'::regprocedure)
  )
    like '%Refresh transaction results%',
  'Manager overview exposes checking, failed, and retry states from the current operation'
);

select * from finish();
rollback;
