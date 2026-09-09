begin;
create extension if not exists pgtap with schema extensions;
set local search_path=public,extensions;
select no_plan();

select has_table('public','refund_nayax_transaction_allocations',
  'Exact provider transactions have a private allocation ledger');
select ok((select relrowsecurity from pg_catalog.pg_class
    where oid='public.refund_nayax_transaction_allocations'::regclass),
  'Exact provider allocation ledger has row-level security enabled');

select ok(not has_table_privilege('authenticated',
    'public.refund_nayax_transaction_allocations','select'),
  'Managers cannot read private provider allocation identifiers');
select ok(not has_table_privilege('service_role',
    'public.refund_nayax_transaction_allocations','insert'),
  'Service role cannot forge provider allocations outside the bounded RPC');
select ok(not has_table_privilege('authenticated',
    'public.refund_accounting_exceptions','select'),
  'Accounting exception internals are not exposed directly');
select has_function('public','service_get_refund_nayax_transaction_preflight',
  array['text','uuid','uuid','bigint','text']);
select function_privs_are('public','service_get_refund_nayax_transaction_preflight',
  array['text','uuid','uuid','bigint','text'],'service_role',array['EXECUTE'],
  'Only the refund executor can request the redacted exact-transaction preflight');
select has_function('public','service_reserve_nayax_refund_manager_action_v5',
  array['text','uuid','uuid','bigint','text','integer','integer','integer',
    'text','text','text','text','text','text']);
select ok(position('refund_claim_exact_nayax_transaction'
    in pg_get_functiondef('public.service_reserve_nayax_refund_manager_action_v5(text,uuid,uuid,bigint,text,integer,integer,integer,text,text,text,text,text,text)'::regprocedure))>0,
  'Dispatch reserves the exact provider purchase in the same transaction');
select ok(position('pg_advisory_xact_lock'
    in pg_get_functiondef('public.refund_claim_exact_nayax_transaction(uuid,uuid,jsonb)'::regprocedure))>0,
  'Concurrent cases serialize on the exact provider purchase');
select ok(position('when unique_violation'
    in pg_get_functiondef('public.service_settle_nayax_refund_attempt(text,uuid,uuid,uuid,text,integer,text,text,text,text,text,text)'::regprocedure))>0,
  'Late accounting uniqueness conflicts have an explicit post-provider path');
select ok(position('refund_nayax_unsettled_api_success_journal_proved'
    in pg_get_functiondef('public.service_settle_nayax_refund_attempt(text,uuid,uuid,uuid,text,integer,text,text,text,text,text,text)'::regprocedure))>0,
  'Only immutable request-and-approve evidence can enter late-conflict recovery');
select ok(position('service_ensure_refund_receipt_automatic_completion'
    in pg_get_functiondef('public.refund_record_nayax_late_accounting_exception(uuid,uuid)'::regprocedure))>0,
  'The paid outcome queues one receipt-bound truthful completion notice');
select ok(position('insert into public.sales_adjustment_facts'
    in pg_get_functiondef('public.refund_record_nayax_late_accounting_exception(uuid,uuid)'::regprocedure))=0,
  'Late-conflict recovery does not bypass the broad accounting safeguard');
select ok(position('provider_call_made'',false'
    in pg_get_functiondef('public.refund_record_nayax_late_accounting_exception(uuid,uuid)'::regprocedure))>0,
  'Recovery evidence explicitly records that it makes no additional provider call');

select * from finish();
rollback;
