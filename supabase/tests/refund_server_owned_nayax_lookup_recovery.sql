begin;

create extension if not exists pgtap with schema extensions;
set local search_path = public, extensions;
select plan(34);

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

update public.refund_cases set nayax_lookup_status='no_match'
where id='a8700000-0000-4000-8000-000000000011';
update public.refund_cases set nayax_lookup_status='response_limited',
  nayax_lookup_safe_retry_eligible=false
where id='a8700000-0000-4000-8000-000000000012';

select is(jsonb_array_length(public.service_claim_due_refund_nayax_lookups(1)),1,
  'A ready case is claimed directly');
select is((select nayax_lookup_status from public.refund_cases where id='a8700000-0000-4000-8000-000000000010'),'checking',
  'The claim begins lookup state on the case');
select is(jsonb_array_length(public.service_claim_due_refund_nayax_lookups(1)),0,
  'A repeated sweep cannot claim an active case');

update public.refund_cases set
  nayax_lookup_status='lookup_failed',
  nayax_lookup_started_at=statement_timestamp()-interval '4 minutes',
  nayax_lookup_finished_at=statement_timestamp()-interval '3 minutes',
  nayax_lookup_failure_class='transport_error',nayax_lookup_safe_retry_eligible=true,
  nayax_lookup_retry_count=0,nayax_lookup_retry_fact_version=deterministic_fact_version
where id='a8700000-0000-4000-8000-000000000010';
select is((public.service_claim_due_refund_nayax_lookups(1)->0->>'retryCount')::integer,1,
  'One classified-safe retry is claimed');
update public.refund_cases set
  nayax_lookup_status='lookup_failed',
  nayax_lookup_started_at=statement_timestamp()-interval '4 minutes',
  nayax_lookup_finished_at=statement_timestamp()-interval '3 minutes',
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
  like '%candidate_row.lookup_generation <> case_row.nayax_lookup_generation%candidate_row.actor_user_id is not null%customer_fact_version%',
  'Candidate binding revalidates current generation and deterministic facts');
select ok(
  pg_get_functiondef('public.reject_refund_nayax_candidate_update()'::regprocedure)
    like '%durable_transition%actor_binding_transition%facts_unchanged%'
  and pg_get_functiondef('public.reject_refund_nayax_candidate_update()'::regprocedure)
    like '%old.actor_user_id is null%new.actor_user_id is not null%'
  and pg_get_functiondef('public.reject_refund_nayax_candidate_update()'::regprocedure)
    like '%manual_nayax_portal%',
  'The immutable-evidence trigger permits only durable automatic evidence and one-time actor binding');

create temporary table candidate_update_guard_fixture (
  actor_user_id uuid,
  expires_at timestamptz not null,
  evidence_summary jsonb not null,
  provider_transaction_id text not null
);
create trigger candidate_update_guard_fixture_immutable
before update on candidate_update_guard_fixture
for each row execute function public.reject_refund_nayax_candidate_update();
insert into candidate_update_guard_fixture
  (actor_user_id,expires_at,evidence_summary,provider_transaction_id)
values
  (null,statement_timestamp()+interval '30 minutes','{"source":"automatic_nayax_lookup"}'::jsonb,'automatic-durable'),
  (null,statement_timestamp()+interval '30 minutes','{"source":"automatic_nayax_lookup"}'::jsonb,'automatic-bind'),
  (null,statement_timestamp()+interval '30 minutes','{"source":"manual_nayax_portal"}'::jsonb,'manual-expiring');

select lives_ok($$
  update candidate_update_guard_fixture
  set expires_at='9999-12-31 23:59:59.999999+00'::timestamptz
  where provider_transaction_id='automatic-durable'
$$,'Automatic lookup metadata can make immutable evidence durable');
select lives_ok($$
  update candidate_update_guard_fixture
  set actor_user_id='a8700000-0000-4000-8000-000000000099'::uuid
  where provider_transaction_id='automatic-bind'
$$,'An unclaimed automatic candidate can bind to one manager');
select throws_like($$
  update candidate_update_guard_fixture
  set provider_transaction_id='rewritten-transaction'
  where provider_transaction_id='automatic-durable'
$$,'%Nayax candidate evidence is immutable%',
  'Transaction evidence cannot be rewritten during a metadata transition');
select throws_like($$
  update candidate_update_guard_fixture
  set actor_user_id='a8700000-0000-4000-8000-000000000098'::uuid
  where provider_transaction_id='automatic-bind'
$$,'%Nayax candidate evidence is immutable%',
  'A candidate cannot be rebound to another manager');
select throws_like($$
  update candidate_update_guard_fixture
  set expires_at='9999-12-31 23:59:59.999999+00'::timestamptz
  where provider_transaction_id='manual-expiring'
$$,'%Nayax candidate evidence is immutable%',
  'Manual portal evidence keeps its reviewed expiry boundary');

select ok(pg_get_functiondef('public.refund_project_nayax_lookup_recovery_cases_for_manager(jsonb,boolean)'::regprocedure)
  not like '%refund_nayax_lookup_recoveries%',
  'Manager projection derives lookup work from the refund case');
select ok(not has_function_privilege('authenticated',
  'public.service_begin_refund_nayax_operations_lookup(uuid,bigint,uuid)','execute')
  and has_function_privilege('service_role',
  'public.service_begin_refund_nayax_operations_lookup(uuid,bigint,uuid)','execute'),
  'The deliberate Operations check is server-only');
select ok(
  pg_get_functiondef('public.service_begin_refund_nayax_operations_lookup(uuid,bigint,uuid)'::regprocedure)
    like '%is_super_admin(p_actor_user_id)%'
  and pg_get_functiondef('public.service_begin_refund_nayax_operations_lookup(uuid,bigint,uuid)'::regprocedure)
    like '%Automatic transaction checks must be exhausted first%'
  and pg_get_functiondef('public.service_begin_refund_nayax_operations_lookup(uuid,bigint,uuid)'::regprocedure)
    like '%refund_authoritative_receipts%',
  'Operations checks require current authority, automatic exhaustion, and no payment evidence');

select ok(
  pg_get_functiondef('public.service_claim_due_refund_nayax_lookups(integer)'::regprocedure)
    like '%nayax_lookup_status in (''match_found'',''multiple_matches'',''manual_exception'')%'
  and pg_get_functiondef('public.service_claim_due_refund_nayax_lookups(integer)'::regprocedure)
    like '%machine.nayax_manual_portal_enabled is not true%'
  and pg_get_functiondef('public.service_claim_due_refund_nayax_lookups(integer)'::regprocedure)
    like '%completed_event.metadata ->> ''candidate_count''%'
  and pg_get_functiondef('public.service_claim_due_refund_nayax_lookups(integer)'::regprocedure)
    like '%lookup_candidate.expires_at > statement_timestamp()%'
  and pg_get_functiondef('public.service_claim_due_refund_nayax_lookups(integer)'::regprocedure)
    like '%refund_authoritative_receipts%refund_case_nayax_refund_attempts%',
  'The case worker reclaims only orphaned automatic evidence and retains payment guards');

insert into public.customer_accounts(id,name,account_type)
values('a8800000-0000-4000-8000-000000000001','Orphan lookup fixture','internal');
insert into public.reporting_locations(id,account_id,name,timezone)
values('a8800000-0000-4000-8000-000000000002','a8800000-0000-4000-8000-000000000001','Orphan place','America/Los_Angeles');
insert into public.reporting_machines(
  id,account_id,location_id,machine_label,status,nayax_machine_id,nayax_account_key,
  nayax_refunds_enabled,nayax_manual_portal_enabled,nayax_manual_account_scope
) values
('a8800000-0000-4000-8000-000000000003','a8800000-0000-4000-8000-000000000001','a8800000-0000-4000-8000-000000000002','Automatic machine','active','orphan-auto','default',true,false,null),
('a8800000-0000-4000-8000-000000000004','a8800000-0000-4000-8000-000000000001','a8800000-0000-4000-8000-000000000002','Manual portal machine','active',null,null,false,true,'manual-fixture');

insert into public.refund_cases(
  id,public_reference,reporting_machine_id,reporting_location_id,customer_email,
  issue_summary,incident_at,incident_timezone,incident_time_resolution,
  payment_method,payment_amount_cents,card_last4,status,correlation_status,
  correlation_source,nayax_lookup_generation,nayax_lookup_status,
  nayax_lookup_finished_at,nayax_recommendation_state
) values
('a8800000-0000-4000-8000-000000000010','RF-ORPHAN-MATCH','a8800000-0000-4000-8000-000000000003','a8800000-0000-4000-8000-000000000002','orphan-match@example.invalid','Orphan match',statement_timestamp()-interval '8 hours','America/Los_Angeles','exact','card',700,'4242','needs_review','manual_review','nayax',3,'match_found',statement_timestamp()-interval '7 hours','high_confidence'),
('a8800000-0000-4000-8000-000000000011','RF-ORPHAN-MULTI','a8800000-0000-4000-8000-000000000003','a8800000-0000-4000-8000-000000000002','orphan-multi@example.invalid','Orphan multiple',statement_timestamp()-interval '8 hours','America/Los_Angeles','exact','card',700,'4242','needs_review','multiple_candidates','nayax',3,'multiple_matches',statement_timestamp()-interval '6 hours','ambiguous'),
('a8800000-0000-4000-8000-000000000012','RF-DURABLE-MULTI','a8800000-0000-4000-8000-000000000003','a8800000-0000-4000-8000-000000000002','durable-multi@example.invalid','Durable multiple',statement_timestamp()-interval '8 hours','America/Los_Angeles','exact','card',700,'4242','needs_review','multiple_candidates','nayax',3,'multiple_matches',statement_timestamp()-interval '5 hours','ambiguous'),
('a8800000-0000-4000-8000-000000000013','RF-ZERO-VALID','a8800000-0000-4000-8000-000000000003','a8800000-0000-4000-8000-000000000002','zero-valid@example.invalid','Valid zero result',statement_timestamp()-interval '8 hours','America/Los_Angeles','exact','card',700,'4242','needs_review','no_match','nayax',3,'no_match',statement_timestamp()-interval '4 hours','no_safe_match'),
('a8800000-0000-4000-8000-000000000014','RF-ORPHAN-EXCEPTION','a8800000-0000-4000-8000-000000000003','a8800000-0000-4000-8000-000000000002','orphan-exception@example.invalid','Orphan automatic exception',statement_timestamp()-interval '8 hours','America/Los_Angeles','exact','card',700,'4242','needs_review','manual_review','nayax',3,'manual_exception',statement_timestamp()-interval '3 hours','manual_exception'),
('a8800000-0000-4000-8000-000000000015','RF-MANUAL-EXCEPTION','a8800000-0000-4000-8000-000000000004','a8800000-0000-4000-8000-000000000002','manual-exception@example.invalid','Manual portal exception',statement_timestamp()-interval '8 hours','America/Los_Angeles','exact','card',700,'4242','needs_review','manual_review','nayax',3,'manual_exception',statement_timestamp()-interval '2 hours','manual_exception'),
('a8800000-0000-4000-8000-000000000016','RF-PAYMENT-BLOCK','a8800000-0000-4000-8000-000000000003','a8800000-0000-4000-8000-000000000002','payment-block@example.invalid','Payment state blocks lookup',statement_timestamp()-interval '8 hours','America/Los_Angeles','exact','card',700,'4242','needs_review','multiple_candidates','nayax',3,'multiple_matches',statement_timestamp()-interval '1 hour','ambiguous');

update public.refund_cases
set nayax_refund_execution_status='requested'
where id='a8800000-0000-4000-8000-000000000016';

insert into public.refund_case_events(refund_case_id,event_type,message,metadata)
values
('a8800000-0000-4000-8000-000000000014','nayax_lookup_completed','Automatic exception once had candidates',jsonb_build_object('lookup_generation',3,'candidate_count',2,'payload_redacted',true)),
('a8800000-0000-4000-8000-000000000015','nayax_lookup_completed','Manual portal exception once had candidates',jsonb_build_object('lookup_generation',3,'candidate_count',2,'payload_redacted',true));

alter table public.refund_nayax_lookup_candidates disable trigger user;
insert into public.refund_nayax_lookup_candidates(
  token,refund_case_id,reporting_machine_id,provider_transaction_id,site_id,
  machine_authorization_time,amount_cents,card_last4,currency_code,
  evidence_summary,expires_at,lookup_generation
) values (
  'a8800000-0000-4000-8000-000000000099','a8800000-0000-4000-8000-000000000012',
  'a8800000-0000-4000-8000-000000000003','DURABLE-ORPHAN-GUARD',101,
  statement_timestamp()-interval '8 hours',700,'4242','USD',
  '{"source":"automatic_nayax_lookup"}'::jsonb,
  '9999-12-31 23:59:59.999999+00'::timestamptz,3
);
alter table public.refund_nayax_lookup_candidates enable trigger user;

create temporary table orphan_claim_result(result jsonb not null);
insert into orphan_claim_result
select public.service_claim_due_refund_nayax_lookups(10);

select is((select jsonb_array_length(result) from orphan_claim_result),3,
  'A sweep claims the three orphaned automatic lookup results');
select ok((select result @> '[{"caseId":"a8800000-0000-4000-8000-000000000010"}]'::jsonb
  and result @> '[{"caseId":"a8800000-0000-4000-8000-000000000011"}]'::jsonb
  and result @> '[{"caseId":"a8800000-0000-4000-8000-000000000014"}]'::jsonb
  from orphan_claim_result),
  'Match, multiple-match, and evidenced automatic exception cases are reclaimed');
select is((select count(*)::integer from public.refund_cases
  where id in ('a8800000-0000-4000-8000-000000000010','a8800000-0000-4000-8000-000000000011','a8800000-0000-4000-8000-000000000014')
    and nayax_lookup_status='checking'),3,
  'Each reclaimed case advances into the ordinary read-only checking state');
select is((select nayax_lookup_status from public.refund_cases
  where id='a8800000-0000-4000-8000-000000000012'),'multiple_matches',
  'A completed result with durable current evidence is not reclaimed');
select is((select nayax_lookup_status from public.refund_cases
  where id='a8800000-0000-4000-8000-000000000013'),'no_match',
  'A valid zero-candidate no-match is not reclaimed');
select is((select nayax_lookup_status from public.refund_cases
  where id='a8800000-0000-4000-8000-000000000015'),'manual_exception',
  'Manual portal evidence is not reclaimed automatically');
select is((select nayax_lookup_status from public.refund_cases
  where id='a8800000-0000-4000-8000-000000000016'),'multiple_matches',
  'Existing payment execution state blocks orphan recovery');

select * from finish();
rollback;
