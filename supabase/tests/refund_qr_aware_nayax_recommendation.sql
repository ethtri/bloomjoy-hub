begin;

create extension if not exists pgtap with schema extensions;
set local search_path = public, extensions;

select plan(5);

select ok(
  pg_get_functiondef('public.admin_get_refund_ops_overview_pre_official()'::regprocedure)
    like '%qrClaimOpenedAt%'
  and pg_get_functiondef('public.admin_get_refund_ops_overview_pre_official()'::regprocedure)
    like '%incidentAt%',
  'The manager overview exposes customer-reported time separately from verified QR-open time'
);

select ok(
  pg_get_functiondef('public.admin_get_refund_ops_overview_pre_official()'::regprocedure)
    like '%confidenceClass%'
  and pg_get_functiondef('public.admin_get_refund_ops_overview_pre_official()'::regprocedure)
    like '%reasonCodes%'
  and pg_get_functiondef('public.admin_get_refund_ops_overview_pre_official()'::regprocedure)
    like '%qrTimeDeltaMinutes%',
  'The manager overview exposes versioned QR-aware evidence using redacted fields'
);

select ok(
  pg_get_functiondef('public.admin_get_refund_ops_overview_pre_official()'::regprocedure)
    not like '%provider_transaction_id%'
  and pg_get_functiondef('public.admin_get_refund_ops_overview_pre_official()'::regprocedure)
    not like '%claim_token_hash%',
  'The browser overview does not serialize raw provider IDs or QR claim-token hashes'
);

select ok(
  has_function_privilege('authenticated', 'public.admin_get_refund_operations_overview()', 'execute')
  and has_function_privilege('service_role', 'public.admin_get_refund_operations_overview()', 'execute')
  and not has_function_privilege('anon', 'public.admin_get_refund_operations_overview()', 'execute'),
  'Only authenticated operations users and the service role can invoke the overview'
);

select ok(
  pg_get_functiondef('public.admin_get_refund_ops_overview_pre_official()'::regprocedure)
    like '%consumed_at is not null%'
  and pg_get_functiondef('public.admin_get_refund_ops_overview_pre_official()'::regprocedure)
    like '%reporting_machine_id = refund_case.reporting_machine_id%',
  'Only consumed QR evidence bound to the case machine is displayed'
);

select * from finish();
rollback;
