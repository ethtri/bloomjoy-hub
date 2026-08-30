begin;

create extension if not exists pgtap with schema extensions;
set local search_path = public, extensions;

select plan(9);

select has_column('public', 'refund_cases', 'payment_interaction', 'Refund cases store how the customer says they paid');
select has_column('public', 'refund_cases', 'wallet_provider', 'Refund cases store the customer-described wallet provider');
select has_column('public', 'refund_cases', 'incident_time_confidence', 'Refund cases store customer time confidence');
select has_column('public', 'refund_cases', 'issue_category', 'Refund cases store a structured issue category');
select has_column('public', 'refund_cases', 'product_description', 'Refund cases store an optional product description');

select ok(
  exists (
    select 1
    from pg_constraint
    where conrelid = 'public.refund_cases'::regclass
      and conname = 'refund_cases_incident_time_confidence_check'
  ),
  'Incident time confidence is constrained to the approved values'
);

select ok(
  exists (
    select 1
    from pg_constraint
    where conrelid = 'public.refund_cases'::regclass
      and conname = 'refund_cases_payment_interaction_method_check'
  ),
  'Cash and card cases cannot store contradictory payment interactions'
);

select ok(
  (
    pg_get_functiondef('public.admin_get_refund_operations_overview()'::regprocedure)
    || pg_get_functiondef('public.admin_get_refund_operations_overview_pre_customer_correction_v1()'::regprocedure)
    || pg_get_functiondef('public.admin_get_refund_operations_overview_pre_manager_queue_truth_v1()'::regprocedure)
  )
    like '%paymentInteraction%'
  and (
    pg_get_functiondef('public.admin_get_refund_operations_overview()'::regprocedure)
    || pg_get_functiondef('public.admin_get_refund_operations_overview_pre_customer_correction_v1()'::regprocedure)
    || pg_get_functiondef('public.admin_get_refund_operations_overview_pre_manager_queue_truth_v1()'::regprocedure)
  )
    like '%incidentTimeConfidence%'
  and (
    pg_get_functiondef('public.admin_get_refund_operations_overview()'::regprocedure)
    || pg_get_functiondef('public.admin_get_refund_operations_overview_pre_customer_correction_v1()'::regprocedure)
    || pg_get_functiondef('public.admin_get_refund_operations_overview_pre_manager_queue_truth_v1()'::regprocedure)
  )
    like '%issueCategory%',
  'The manager overview exposes the structured customer evidence'
);

select ok(
  (
    pg_get_functiondef('public.admin_get_refund_operations_overview()'::regprocedure)
    || pg_get_functiondef('public.admin_get_refund_operations_overview_pre_customer_correction_v1()'::regprocedure)
    || pg_get_functiondef('public.admin_get_refund_operations_overview_pre_manager_queue_truth_v1()'::regprocedure)
  )
    like '%productLabel%'
  and (
    pg_get_functiondef('public.admin_get_refund_operations_overview()'::regprocedure)
    || pg_get_functiondef('public.admin_get_refund_operations_overview_pre_customer_correction_v1()'::regprocedure)
    || pg_get_functiondef('public.admin_get_refund_operations_overview_pre_manager_queue_truth_v1()'::regprocedure)
  )
    like '%machineStatus%'
  and (
    pg_get_functiondef('public.admin_get_refund_operations_overview()'::regprocedure)
    || pg_get_functiondef('public.admin_get_refund_operations_overview_pre_customer_correction_v1()'::regprocedure)
    || pg_get_functiondef('public.admin_get_refund_operations_overview_pre_manager_queue_truth_v1()'::regprocedure)
  )
    like '%nearbyMachineAlerts%'
  and (
    pg_get_functiondef('public.admin_get_refund_operations_overview()'::regprocedure)
    || pg_get_functiondef('public.admin_get_refund_operations_overview_pre_customer_correction_v1()'::regprocedure)
    || pg_get_functiondef('public.admin_get_refund_operations_overview_pre_manager_queue_truth_v1()'::regprocedure)
  )
    not like '%provider_transaction_id%',
  'The manager overview exposes sanitized context without raw provider transaction IDs'
);

select * from finish();
rollback;
