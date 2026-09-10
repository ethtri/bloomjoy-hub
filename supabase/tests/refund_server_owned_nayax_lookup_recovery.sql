begin;

create extension if not exists pgtap with schema extensions;
set local search_path = public, extensions;

select plan(32);

select has_table('public', 'refund_nayax_lookup_recoveries',
  'Final schema contains the durable server lookup queue');
select col_is_pk('public', 'refund_nayax_lookup_recoveries', 'id',
  'Recovery rows have a stable primary key');
select ok(exists(
  select 1 from pg_constraint
  where conrelid='public.refund_nayax_lookup_recoveries'::regclass
    and contype='u'
    and pg_get_constraintdef(oid) like '%refund_case_id%deterministic_fact_version%recovery_generation%attempt_ordinal%'
), 'Case, fact version, and recovery generation are exactly unique');
select ok((select relrowsecurity from pg_class
  where oid='public.refund_nayax_lookup_recoveries'::regclass),
  'Recovery queue has RLS enabled');
select ok(
  not has_table_privilege('anon','public.refund_nayax_lookup_recoveries','select')
  and not has_table_privilege('authenticated','public.refund_nayax_lookup_recoveries','select'),
  'Browser roles cannot read the server queue');
select ok(
  not has_function_privilege('anon','public.service_claim_refund_nayax_lookup_recoveries(integer)','execute')
  and not has_function_privilege('authenticated','public.service_claim_refund_nayax_lookup_recoveries(integer)','execute')
  and has_function_privilege('service_role','public.service_claim_refund_nayax_lookup_recoveries(integer)','execute'),
  'Only the server can claim lookup work');
select ok(
  not has_function_privilege('authenticated','public.service_enqueue_refund_nayax_lookup(uuid,bigint)','execute')
  and has_function_privilege('service_role','public.service_enqueue_refund_nayax_lookup(uuid,bigint)','execute'),
  'Only the server can enqueue exact event-side lookup work');
select ok(
  not has_function_privilege('authenticated','public.service_finish_refund_nayax_lookup_recovery(uuid,uuid,bigint,boolean,text)','execute')
  and has_function_privilege('service_role','public.service_finish_refund_nayax_lookup_recovery(uuid,uuid,bigint,boolean,text)','execute'),
  'Only the server can finish exact lookup work');
select ok(
  not has_function_privilege('authenticated','public.service_mark_refund_nayax_lookup_recovery_started(uuid,uuid,bigint)','execute')
  and has_function_privilege('service_role','public.service_mark_refund_nayax_lookup_recovery_started(uuid,uuid,bigint)','execute'),
  'Only the exact server claim can checkpoint provider-read start');
select ok(
  not has_function_privilege('authenticated','public.service_claim_refund_nayax_lookup_operations_recovery(uuid,bigint,uuid)','execute')
  and pg_get_functiondef('public.service_claim_refund_nayax_lookup_operations_recovery(uuid,bigint,uuid)'::regprocedure)
    like '%is_super_admin(p_actor_user_id)%Automatic lookup recovery must be exhausted first%',
  'Elevated fallback is server-only, operations-authorized, and exhaustion-gated');
select ok(
  pg_get_functiondef('public.service_claim_refund_nayax_lookup_recoveries(integer)'::regprocedure)
    like '%for update of recovery skip locked%'
  and pg_get_functiondef('public.service_claim_refund_nayax_lookup_recoveries(integer)'::regprocedure)
    like '%order by recovery.next_attempt_at, recovery.created_at, recovery.refund_case_id%',
  'Concurrent workers use a fair ordered skip-locked claim');
select ok(
  pg_get_functiondef('public.service_claim_refund_nayax_lookup_recoveries(integer)'::regprocedure)
    like '%prior.attempt_ordinal = 0%'
  and pg_get_functiondef('public.service_claim_refund_nayax_lookup_recoveries(integer)'::regprocedure)
    like '%interval ''2 minutes''%',
  'A fact version receives one automatic retry with explicit backoff');
select ok(
  pg_get_functiondef('public.service_claim_refund_nayax_lookup_recoveries(integer)'::regprocedure)
    like '%refund_authoritative_receipts%'
  and pg_get_functiondef('public.service_claim_refund_nayax_lookup_recoveries(integer)'::regprocedure)
    like '%refund_case_nayax_refund_attempts%'
  and pg_get_functiondef('public.service_claim_refund_nayax_lookup_recoveries(integer)'::regprocedure)
    like '%nayax_refund_execution_status = ''not_requested''%',
  'Payment evidence blocks all lookup recovery');
select ok(
  pg_get_functiondef('public.service_claim_refund_nayax_lookup_recoveries(integer)'::regprocedure)
    like '%expired.expired_at <= statement_timestamp()%',
  'Expired results schedule a server refresh');
select ok(
  not has_function_privilege('authenticated',
    'public.admin_get_refund_operations_overview_pre_lookup_recovery_v1()','execute'),
  'Routine managers cannot call the unprojected overview predecessor');

insert into public.customer_accounts(id,name,account_type)
values('a8700000-0000-4000-8000-000000000001','Lookup recovery fixture','internal');
insert into public.reporting_locations(id,account_id,name,timezone)
values('a8700000-0000-4000-8000-000000000002','a8700000-0000-4000-8000-000000000001','Lookup recovery place','America/Los_Angeles');
insert into public.reporting_machines(id,account_id,location_id,machine_label,status,nayax_machine_id,nayax_account_key)
values('a8700000-0000-4000-8000-000000000003','a8700000-0000-4000-8000-000000000001','a8700000-0000-4000-8000-000000000002','Lookup recovery machine','active','recovery-machine','default');
insert into public.refund_cases(id,public_reference,reporting_machine_id,reporting_location_id,
  customer_email,issue_summary,incident_at,incident_timezone,incident_time_resolution,
  payment_method,payment_amount_cents,card_last4,status,correlation_status,correlation_source)
values
('a8700000-0000-4000-8000-000000000010','RF-RECOVERY-LEASE','a8700000-0000-4000-8000-000000000003','a8700000-0000-4000-8000-000000000002','lease@example.invalid','Lease fixture',statement_timestamp()-interval '1 hour','America/Los_Angeles','exact','card',700,'4242','needs_review','needs_nayax','nayax');

select is(public.service_enqueue_refund_nayax_lookup(
  'a8700000-0000-4000-8000-000000000010',1)->>'status','scheduled',
  'Event-side readiness creates the one durable initial attempt');
select is(public.service_enqueue_refund_nayax_lookup(
  'a8700000-0000-4000-8000-000000000010',1)->>'status','deduplicated',
  'Repeated event delivery deduplicates against the same queue attempt');
select is((select count(*)::integer from public.refund_nayax_lookup_recoveries
  where refund_case_id='a8700000-0000-4000-8000-000000000010'),1,
  'Event and sweep share one case/fact/generation/attempt owner');
select is(jsonb_array_length(public.service_claim_refund_nayax_lookup_recoveries(1)),1,
  'Initial ready case claims once without a browser');
update public.refund_nayax_lookup_recoveries
set claimed_at=statement_timestamp()-interval '2 minutes',
  claim_expires_at=statement_timestamp()-interval '1 second'
where refund_case_id='a8700000-0000-4000-8000-000000000010';
select is(jsonb_array_length(public.service_claim_refund_nayax_lookup_recoveries(1)),0,
  'Crash before begin consumes attempt zero and observes backoff');
select is((select status from public.refund_nayax_lookup_recoveries where refund_case_id='a8700000-0000-4000-8000-000000000010' and attempt_ordinal=0),'failed',
  'Abandoned initial lease is durable failure evidence');
select ok((select next_attempt_at > statement_timestamp()
  from public.refund_nayax_lookup_recoveries
  where refund_case_id='a8700000-0000-4000-8000-000000000010' and attempt_ordinal=0),
  'Failure settlement immediately exposes the truthful future retry time');
update public.refund_nayax_lookup_recoveries set next_attempt_at=statement_timestamp()-interval '1 second'
where refund_case_id='a8700000-0000-4000-8000-000000000010' and attempt_ordinal=1;
select is((public.service_claim_refund_nayax_lookup_recoveries(1)->0->>'attemptOrdinal')::integer,1,
  'Only the one bounded safe retry is claimed');
update public.refund_nayax_lookup_recoveries
set claimed_at=statement_timestamp()-interval '2 minutes',
  claim_expires_at=statement_timestamp()-interval '1 second'
where refund_case_id='a8700000-0000-4000-8000-000000000010' and attempt_ordinal=1;
select public.service_claim_refund_nayax_lookup_recoveries(1) is not null;
select is((select status from public.refund_nayax_lookup_recoveries where refund_case_id='a8700000-0000-4000-8000-000000000010' and attempt_ordinal=1),'exhausted',
  'A second abandoned worker lease exhausts instead of replaying forever');

insert into public.refund_cases(id,public_reference,reporting_machine_id,reporting_location_id,
  customer_email,issue_summary,incident_at,incident_timezone,incident_time_resolution,
  payment_method,payment_amount_cents,card_last4,status,correlation_status,correlation_source)
values
('a8700000-0000-4000-8000-000000000011','RF-RECOVERY-EXPIRY','a8700000-0000-4000-8000-000000000003','a8700000-0000-4000-8000-000000000002','expiry@example.invalid','Expiry fixture',statement_timestamp()-interval '1 hour','America/Los_Angeles','exact','card',700,'4242','needs_review','manual_review','nayax'),
('a8700000-0000-4000-8000-000000000012','RF-RECOVERY-COMMIT','a8700000-0000-4000-8000-000000000003','a8700000-0000-4000-8000-000000000002','commit@example.invalid','Commit fixture',statement_timestamp()-interval '1 hour','America/Los_Angeles','exact','card',700,'4242','needs_review','manual_review','nayax');

update public.refund_cases set nayax_lookup_status='no_match',nayax_lookup_generation=4,
  nayax_recommendation_state='no_safe_match',nayax_recommendation_evaluated_at=statement_timestamp()-interval '25 hours'
where id='a8700000-0000-4000-8000-000000000011';
update public.refund_cases set nayax_lookup_status='no_match',nayax_lookup_generation=9,
  nayax_recommendation_state='no_safe_match',nayax_recommendation_evaluated_at=statement_timestamp()
where id='a8700000-0000-4000-8000-000000000012';
insert into public.refund_nayax_lookup_recoveries(refund_case_id,deterministic_fact_version,recovery_generation,attempt_ordinal,status,next_attempt_at,finished_at)
select id,deterministic_fact_version,0,0,'completed',statement_timestamp()-interval '25 hours',statement_timestamp()-interval '25 hours'
from public.refund_cases where id='a8700000-0000-4000-8000-000000000011';
select is((public.service_claim_refund_nayax_lookup_recoveries(1)->0->>'recoveryGeneration')::integer,1,
  'First expiry creates a new refresh generation');
update public.refund_nayax_lookup_recoveries set status='completed',claim_token=null,claim_expires_at=null,finished_at=statement_timestamp()
where refund_case_id='a8700000-0000-4000-8000-000000000011' and recovery_generation=1;
select is((public.service_claim_refund_nayax_lookup_recoveries(1)->0->>'recoveryGeneration')::integer,2,
  'A later expiry can create a second independent refresh generation');
update public.refund_nayax_lookup_recoveries
set claimed_at=statement_timestamp()-interval '2 minutes',
  claim_expires_at=statement_timestamp()-interval '1 second'
where refund_case_id='a8700000-0000-4000-8000-000000000011' and recovery_generation=2 and attempt_ordinal=0;
select public.service_claim_refund_nayax_lookup_recoveries(1) is not null;
select is((select status from public.refund_nayax_lookup_recoveries
  where refund_case_id='a8700000-0000-4000-8000-000000000011' and recovery_generation=2 and attempt_ordinal=1),'scheduled',
  'Crash before begin on an expired refresh preserves old evidence and schedules one bounded retry');

insert into public.refund_nayax_lookup_recoveries(refund_case_id,deterministic_fact_version,recovery_generation,attempt_ordinal,status,next_attempt_at,claimed_at,claim_expires_at,claim_token,lookup_generation)
select id,deterministic_fact_version,0,0,'claimed',statement_timestamp()-interval '2 minutes',statement_timestamp()-interval '2 minutes',statement_timestamp()-interval '1 second','a8700000-0000-4000-8000-000000000099',9
from public.refund_cases where id='a8700000-0000-4000-8000-000000000012';
select public.service_claim_refund_nayax_lookup_recoveries(1) is not null;
select is((select status from public.refund_nayax_lookup_recoveries where refund_case_id='a8700000-0000-4000-8000-000000000012'),'completed',
  'Crash after persisted result never downgrades committed lookup success');

select is((select jsonb_build_object(
    'state',item->'nayaxLookupRecovery'->>'state',
    'action',item->'lifecycle'->'managerAction'->>'action',
    'actionOwner',item->'lifecycle'->'managerAction'->>'owner',
    'queueAction',item->'lifecycle'->'managerQueue'->>'nextAction',
    'operationsOwner',item->'lifecycle'->'operations'->>'owner')
  from jsonb_array_elements(public.refund_project_nayax_lookup_recovery_cases_for_manager(
    jsonb_build_array(jsonb_build_object('id','a8700000-0000-4000-8000-000000000010',
      'lifecycle',jsonb_build_object('managerAction','{}'::jsonb,'managerQueue','{}'::jsonb,
        'lookup','{}'::jsonb,'operations','{}'::jsonb),'nayaxLookupSummary','{}'::jsonb)),false)) item),
  jsonb_build_object('state','refund_operations','action','refund_operations',
    'actionOwner','Refund Operations','queueAction','refund_operations',
    'operationsOwner','Refund Operations'),
  'Exhausted lookup fields agree on Refund Operations without manager retry authority');
select ok((select item->'nayaxLookupRecovery'->>'state'='system'
    and item->'lifecycle'->'managerAction'->>'action'='none'
    and item->'lifecycle'->'managerAction'->>'owner'='System'
    and item->'lifecycle'->'managerQueue'->>'nextAction'='observe_automatic_lookup'
    and item->'nayaxLookupRecovery'->>'nextAttemptAt' is not null
  from jsonb_array_elements(public.refund_project_nayax_lookup_recovery_cases_for_manager(
    jsonb_build_array(jsonb_build_object('id','a8700000-0000-4000-8000-000000000011',
      'lifecycle',jsonb_build_object('managerAction','{}'::jsonb,'managerQueue','{}'::jsonb,
        'lookup','{}'::jsonb,'operations','{}'::jsonb),'nayaxLookupSummary','{}'::jsonb)),false)) item),
  'Scheduled retry fields agree on System observation and expose the due time');
select is((public.refund_project_nayax_lookup_recovery_cases_for_manager(
  jsonb_build_array(jsonb_build_object('id','a8700000-0000-4000-8000-000000000012',
    'lifecycle',jsonb_build_object('lookup',jsonb_build_object('status','no_match')),
    'nayaxLookupSummary',jsonb_build_object('lookupStatus','no_match'))),false)
  ->0->'nayaxLookupRecovery'->>'state'),'complete',
  'A completed lookup is never projected as automatic checking');
select is((public.refund_project_nayax_lookup_recovery_cases_for_manager(
  jsonb_build_array(jsonb_build_object('id','a8700000-0000-4000-8000-000000000012',
    'lifecycle',jsonb_build_object('lookup',jsonb_build_object('status','no_match')),
    'nayaxLookupSummary',jsonb_build_object('lookupStatus','no_match'))),false)
  ->0->'lifecycle'->'lookup'->>'status'),'no_match',
  'Completed evidence retains its final lookup status');

select * from finish();
rollback;
