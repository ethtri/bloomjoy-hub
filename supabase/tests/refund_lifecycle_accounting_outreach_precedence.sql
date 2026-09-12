begin;
create extension if not exists pgtap with schema extensions;
set local search_path = public, extensions;
select plan(4);

select ok(
  has_function_privilege(
    'service_role',
    'public.refund_apply_customer_outreach_to_lifecycle(jsonb,jsonb)',
    'execute'
  )
  and not has_function_privilege(
    'authenticated',
    'public.refund_apply_customer_outreach_to_lifecycle(jsonb,jsonb)',
    'execute'
  ),
  'Lifecycle outreach projection remains service-only'
);

create temp table projected as
select public.refund_apply_customer_outreach_to_lifecycle(
  jsonb_build_object(
    'managerNextAction', 'review_accounting_date',
    'managerAction', jsonb_build_object(
      'action', 'review_accounting_date',
      'owner', 'Refund Operations',
      'safeRetryEligible', false,
      'payloadRedacted', true
    ),
    'managerQueue', jsonb_build_object(
      'schemaVersion', 'refund_manager_queue_v2',
      'bucket', 'accounting_review',
      'label', 'Refund confirmed · accounting review',
      'nextAction', 'review_accounting_date',
      'safeRetryEligible', false,
      'customerActionFields', '[]'::jsonb,
      'payloadRedacted', true
    ),
    'operations', jsonb_build_object(
      'required', true,
      'owner', 'Refund Operations',
      'failureClass', 'settlement_time_unknown',
      'nextStep', 'review_accounting_date'
    ),
    'accountingState', jsonb_build_object('state', 'pending')
  ),
  jsonb_build_object(
    'state', 'delivery_failed',
    'owner', 'Refund Operations',
    'nextAction', 'refund_operations',
    'requestedFields', '[]'::jsonb,
    'failureCode', 'historical_delivery_failure',
    'payloadRedacted', true
  )
) as lifecycle;

select is(
  (select lifecycle #>> '{managerQueue,bucket}' from projected),
  'accounting_review',
  'Pending accounting remains the authoritative manager queue despite outreach failure'
);

select ok(
  (select
    lifecycle ->> 'managerNextAction' = 'review_accounting_date'
    and lifecycle #>> '{operations,failureClass}' = 'settlement_time_unknown'
    and lifecycle #>> '{managerAction,action}' = 'review_accounting_date'
   from projected),
  'Pending accounting action and failure class remain internally consistent'
);

select is(
  (select lifecycle #>> '{customerOutreach,state}' from projected),
  'delivery_failed',
  'Historical outreach evidence remains present without taking queue ownership'
);

select * from finish();
rollback;
