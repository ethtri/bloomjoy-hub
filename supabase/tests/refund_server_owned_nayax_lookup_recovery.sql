begin;

create extension if not exists pgtap with schema extensions;
set local search_path = public, extensions;
select plan(20);

select ok(to_regclass('public.refund_nayax_lookup_recoveries') is null,
  'The duplicate lookup recovery table is removed');
select ok(to_regprocedure('public.service_enqueue_refund_nayax_lookup(uuid,bigint)') is null,
  'Event-side queue writes are removed');
select ok(to_regprocedure('public.service_finish_refund_nayax_lookup_recovery(uuid,uuid,bigint,boolean,text)') is null,
  'Separate queue completion bookkeeping is removed');
select ok(
  not has_function_privilege('authenticated','public.service_claim_due_refund_nayax_lookups(integer)','execute')
  and has_function_privilege('service_role','public.service_claim_due_refund_nayax_lookups(integer)','execute'),
  'Only the server can claim case-owned lookup work');
select ok(
  pg_get_functiondef('public.service_claim_due_refund_nayax_lookups(integer)'::regprocedure) like '%pg_try_advisory_xact_lock%'
  and pg_get_functiondef('public.service_claim_due_refund_nayax_lookups(integer)'::regprocedure) like '%for update of c skip locked%'
  and pg_get_functiondef('public.service_claim_due_refund_nayax_lookups(integer)'::regprocedure) like '%nayax_lookup_retry_count < 1%'
  and pg_get_functiondef('public.service_claim_due_refund_nayax_lookups(integer)'::regprocedure) like '%interval ''2 minutes''%',
  'Case claims are atomic and allow one delayed safe retry');
select ok(
  pg_get_functiondef('public.service_claim_due_refund_nayax_lookups(integer)'::regprocedure) like '%refund_authoritative_receipts%'
  and pg_get_functiondef('public.service_claim_due_refund_nayax_lookups(integer)'::regprocedure) like '%refund_case_nayax_refund_attempts%'
  and pg_get_functiondef('public.service_claim_due_refund_nayax_lookups(integer)'::regprocedure) like '%nayax_refund_execution_status = ''not_requested''%',
  'Payment evidence blocks every read-only lookup claim');

insert into public.customer_accounts(id,name,account_type)
values('a8700000-0000-4000-8000-000000000001','Lookup work fixture','internal');
insert into public.reporting_locations(id,account_id,name,timezone)
values('a8700000-0000-4000-8000-000000000002','a8700000-0000-4000-8000-000000000001','Lookup place','America/Los_Angeles');
insert into public.reporting_machines(id,account_id,location_id,machine_label,status,nayax_machine_id,nayax_account_key)
values('a8700000-0000-4000-8000-000000000003','a8700000-0000-4000-8000-000000000001','a8700000-0000-4000-8000-000000000002','Lookup machine','active','lookup-machine','default');
insert into public.refund_cases(id,public_reference,reporting_machine_id,reporting_location_id,
  customer_email,issue_summary,incident_at,incident_timezone,incident_time_resolution,
  payment_method,payment_amount_cents,card_last4,status,correlation_status,correlation_source)
values
('a8700000-0000-4000-8000-000000000010','RF-CASE-WORK','a8700000-0000-4000-8000-000000000003','a8700000-0000-4000-8000-000000000002','case-work@example.invalid','Case-owned work',statement_timestamp()-interval '1 hour','America/Los_Angeles','exact','card',700,'4242','needs_review','needs_nayax','nayax'),
('a8700000-0000-4000-8000-000000000011','RF-INCONCLUSIVE','a8700000-0000-4000-8000-000000000003','a8700000-0000-4000-8000-000000000002','inconclusive@example.invalid','Incomplete provider history',statement_timestamp()-interval '2 hours','America/Los_Angeles','exact','card',700,'4242','needs_review','no_match','nayax'),
('a8700000-0000-4000-8000-000000000012','RF-OPERATIONS','a8700000-0000-4000-8000-000000000003','a8700000-0000-4000-8000-000000000002','operations@example.invalid','Exhausted retry',statement_timestamp()-interval '3 hours','America/Los_Angeles','exact','card',700,'4242','needs_review','needs_nayax','nayax');

select is(jsonb_array_length(public.service_claim_due_refund_nayax_lookups(1)),1,
  'A ready case is claimed directly');
select is((select nayax_lookup_status from public.refund_cases where id='a8700000-0000-4000-8000-000000000010'),'checking',
  'The claim begins lookup state on the case');
select is(jsonb_array_length(public.service_claim_due_refund_nayax_lookups(1)),0,
  'A repeated sweep cannot claim an active case');

update public.refund_cases set
  nayax_lookup_status='lookup_failed',nayax_lookup_finished_at=statement_timestamp()-interval '3 minutes',
  nayax_lookup_failure_class='transport_error',nayax_lookup_safe_retry_eligible=true,
  nayax_lookup_retry_count=0,nayax_lookup_retry_fact_version=deterministic_fact_version
where id='a8700000-0000-4000-8000-000000000010';
select is((public.service_claim_due_refund_nayax_lookups(1)->0->>'retryCount')::integer,1,
  'One classified-safe retry is claimed');
update public.refund_cases set
  nayax_lookup_status='lookup_failed',nayax_lookup_finished_at=statement_timestamp()-interval '3 minutes',
  nayax_lookup_failure_class='transport_error',nayax_lookup_safe_retry_eligible=true
where id='a8700000-0000-4000-8000-000000000010';
select is(jsonb_array_length(public.service_claim_due_refund_nayax_lookups(1)),0,
  'A failed automatic retry cannot loop');

update public.refund_cases set nayax_lookup_status='no_match',nayax_lookup_generation=4,
  nayax_recommendation_state='no_safe_match',nayax_recommendation_evaluated_at=statement_timestamp()
where id='a8700000-0000-4000-8000-000000000011';
insert into public.refund_case_events(refund_case_id,event_type,message,metadata)
values('a8700000-0000-4000-8000-000000000011','nayax_lookup_diagnostics','Coverage fixture',
  jsonb_build_object('lookup_generation',4,'diagnostics',jsonb_build_object(
    'historicalCoverage','unknown','providerRecordCount',18,
    'providerParseableRecordCount',18,'providerWindowRecordCount',0),'payload_redacted',true));
select is((public.refund_project_nayax_lookup_recovery_cases_for_manager(
  jsonb_build_array(jsonb_build_object('id','a8700000-0000-4000-8000-000000000011',
    'lifecycle',jsonb_build_object('lookup','{}'::jsonb),
    'nayaxLookupSummary',jsonb_build_object('lookupStatus','no_match'))),false)
  ->0->'nayaxLookupSummary'->>'lookupStatus'),'inconclusive',
  'Unknown historical coverage is not presented as a proved no-match');
select is((public.refund_project_nayax_lookup_recovery_cases_for_manager(
  jsonb_build_array(jsonb_build_object('id','a8700000-0000-4000-8000-000000000011',
    'lifecycle',jsonb_build_object('lookup','{}'::jsonb),
    'nayaxLookupSummary',jsonb_build_object('lookupStatus','no_match'))),false)
  ->0->'nayaxLookupSummary'->>'providerRecordCount'),'18',
  'Managers receive bounded provider counts without raw transaction data');

update public.refund_cases set nayax_lookup_status='lookup_failed',
  nayax_lookup_finished_at=statement_timestamp(),nayax_lookup_failure_class='transport_error',
  nayax_lookup_safe_retry_eligible=true,nayax_lookup_retry_count=1
where id='a8700000-0000-4000-8000-000000000012';
select is((public.refund_project_nayax_lookup_recovery_cases_for_manager(
  jsonb_build_array(jsonb_build_object('id','a8700000-0000-4000-8000-000000000012',
    'canSelectNayaxCandidate',true,'lifecycle',jsonb_build_object('managerAction','{}'::jsonb,
      'managerQueue','{}'::jsonb,'lookup','{}'::jsonb,'operations','{}'::jsonb),
    'nayaxLookupSummary','{}'::jsonb)),true)->0->'nayaxLookupWork'->>'state'),'refund_operations',
  'An exhausted automatic retry routes to Refund Operations');
select is((public.refund_project_nayax_lookup_recovery_cases_for_manager(
  jsonb_build_array(jsonb_build_object('id','a8700000-0000-4000-8000-000000000012',
    'lifecycle',jsonb_build_object('managerAction','{}'::jsonb,'managerQueue','{}'::jsonb,
      'lookup','{}'::jsonb,'operations','{}'::jsonb),'nayaxLookupSummary','{}'::jsonb)),true)
  ->0->'lifecycle'->'managerAction'->>'owner'),'Refund Operations',
  'Manager action and case-owned work agree on the owner');

select ok(not has_function_privilege('authenticated',
  'public.service_bind_refund_nayax_candidate_to_actor(uuid,uuid,uuid)','execute')
  and has_function_privilege('service_role',
  'public.service_bind_refund_nayax_candidate_to_actor(uuid,uuid,uuid)','execute'),
  'Durable candidate binding is server-only');
select ok(pg_get_functiondef('public.service_bind_refund_nayax_candidate_to_actor(uuid,uuid,uuid)'::regprocedure)
  like '%candidate_row.lookup_generation <> case_row.nayax_lookup_generation%customer_fact_version%',
  'Candidate binding revalidates current generation and deterministic facts');
select ok(pg_get_functiondef('public.refund_project_nayax_lookup_recovery_cases_for_manager(jsonb,boolean)'::regprocedure)
  not like '%refund_nayax_lookup_recoveries%',
  'Manager projection derives lookup work from the refund case');
select ok(not has_function_privilege('authenticated',
  'public.service_begin_refund_nayax_operations_lookup(uuid,bigint,uuid)','execute')
  and has_function_privilege('service_role',
  'public.service_begin_refund_nayax_operations_lookup(uuid,bigint,uuid)','execute'),
  'The deliberate Operations check is server-only');
select ok(pg_get_functiondef('public.service_begin_refund_nayax_operations_lookup(uuid,bigint,uuid)'::regprocedure)
  like '%is_super_admin(p_actor_user_id)%Automatic transaction checks must be exhausted first%refund_authoritative_receipts%',
  'Operations checks require current authority, automatic exhaustion, and no payment evidence');

select * from finish();
rollback;
