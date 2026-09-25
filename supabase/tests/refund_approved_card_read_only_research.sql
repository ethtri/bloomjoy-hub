begin;
create extension if not exists pgtap with schema extensions;
set local search_path = public, extensions;
select no_plan();

insert into auth.users(id,aud,role,email,raw_app_meta_data,raw_user_meta_data)
values('ab410000-0000-4000-8000-000000000001','authenticated','authenticated',
  'approved-research-manager@example.invalid','{}','{}');
insert into public.customer_accounts(id,name,account_type)
values('ab420000-0000-4000-8000-000000000001','Approved research fixture','internal');
insert into public.reporting_locations(id,account_id,name,timezone)
values('ab430000-0000-4000-8000-000000000001',
  'ab420000-0000-4000-8000-000000000001','Approved research place','America/Los_Angeles');
insert into public.reporting_machines(
  id,account_id,location_id,machine_label,status,nayax_machine_id,
  nayax_account_key,nayax_refunds_enabled,nayax_manual_portal_enabled
) values('ab440000-0000-4000-8000-000000000001',
  'ab420000-0000-4000-8000-000000000001',
  'ab430000-0000-4000-8000-000000000001',
  'Approved research machine','active','APPROVED-RESEARCH-MACHINE',
  'default',true,false);

insert into public.refund_cases(
  id,public_reference,reporting_machine_id,reporting_location_id,customer_email,
  issue_summary,incident_at,incident_timezone,incident_time_resolution,
  payment_method,payment_amount_cents,refund_amount_cents,card_last4,
  status,decision,decision_reason,decided_by,decided_at,
  correlation_status,correlation_source,nayax_lookup_generation,
  nayax_lookup_status,nayax_lookup_started_at,nayax_lookup_finished_at,
  nayax_lookup_correlation_digest,nayax_recommendation_state,
  nayax_recommendation_policy_version,nayax_refund_execution_status,
  customer_request_received_at,customer_request_received_source
) values
('ab450000-0000-4000-8000-000000000001','RF-APPROVED-RESEARCH-1',
  'ab440000-0000-4000-8000-000000000001',
  'ab430000-0000-4000-8000-000000000001',
  'approved-research-1@example.invalid','Synthetic saved approval',
  date_trunc('milliseconds',statement_timestamp()-interval '8 hours'),'America/Los_Angeles','exact',
  'card',963,963,'4242','needs_review','approved','Saved customer-owed decision',
  'ab410000-0000-4000-8000-000000000001',statement_timestamp()-interval '2 hours',
  'manual_review','nayax',3,'manual_exception',
  statement_timestamp()-interval '4 hours',statement_timestamp()-interval '3 hours',
  repeat('a',64),'manual_exception','automatic-lookup-v1','not_requested',
  statement_timestamp()-interval '7 hours','hosted_refund_intake'),
('ab450000-0000-4000-8000-000000000002','RF-APPROVED-RESEARCH-MANUAL',
  'ab440000-0000-4000-8000-000000000001',
  'ab430000-0000-4000-8000-000000000001',
  'approved-research-2@example.invalid','Synthetic manual provenance',
  date_trunc('milliseconds',statement_timestamp()-interval '8 hours'),'America/Los_Angeles','exact',
  'card',963,963,'4242','needs_review','approved','Saved decision',
  'ab410000-0000-4000-8000-000000000001',statement_timestamp()-interval '2 hours',
  'manual_review','nayax',3,'manual_exception',
  statement_timestamp()-interval '4 hours',statement_timestamp()-interval '3 hours',
  repeat('b',64),'manual_exception','manual-nayax-portal-v1','not_requested',
  statement_timestamp()-interval '7 hours','hosted_refund_intake'),
('ab450000-0000-4000-8000-000000000003','RF-APPROVED-RESEARCH-ATTEMPT',
  'ab440000-0000-4000-8000-000000000001',
  'ab430000-0000-4000-8000-000000000001',
  'approved-research-3@example.invalid','Synthetic prior execution',
  date_trunc('milliseconds',statement_timestamp()-interval '8 hours'),'America/Los_Angeles','exact',
  'card',963,963,'4242','needs_review','approved','Saved decision',
  'ab410000-0000-4000-8000-000000000001',statement_timestamp()-interval '2 hours',
  'manual_review','nayax',3,'manual_exception',
  statement_timestamp()-interval '4 hours',statement_timestamp()-interval '3 hours',
  repeat('c',64),'manual_exception','automatic-lookup-v1','requested',
  statement_timestamp()-interval '7 hours','hosted_refund_intake');

insert into public.reporting_machines(
  id,account_id,location_id,machine_label,status,nayax_refunds_enabled,
  nayax_manual_portal_enabled
) values('ab440000-0000-4000-8000-000000000002',
  'ab420000-0000-4000-8000-000000000001',
  'ab430000-0000-4000-8000-000000000001',
  'Older unmapped approved research machine','active',false,false);
insert into public.refund_cases(
  id,public_reference,reporting_machine_id,reporting_location_id,customer_email,
  issue_summary,incident_at,incident_timezone,incident_time_resolution,
  payment_method,payment_amount_cents,refund_amount_cents,card_last4,
  status,decision,decision_reason,decided_by,decided_at,
  correlation_status,correlation_source,nayax_lookup_generation,
  nayax_lookup_status,nayax_lookup_started_at,nayax_lookup_finished_at,
  nayax_lookup_correlation_digest,nayax_recommendation_state,
  nayax_recommendation_policy_version,nayax_refund_execution_status,
  customer_request_received_at,customer_request_received_source
) select 'ab450000-0000-4000-8000-000000000004',
  'RF-APPROVED-RESEARCH-UNMAPPED',
  'ab440000-0000-4000-8000-000000000002',reporting_location_id,
  'approved-research-4@example.invalid',issue_summary,incident_at,
  incident_timezone,incident_time_resolution,payment_method,
  payment_amount_cents,refund_amount_cents,card_last4,status,decision,
  decision_reason,decided_by,decided_at,correlation_status,correlation_source,
  nayax_lookup_generation,nayax_lookup_status,
  nayax_lookup_started_at-interval '1 hour',
  nayax_lookup_finished_at-interval '1 hour',repeat('d',64),
  nayax_recommendation_state,nayax_recommendation_policy_version,
  nayax_refund_execution_status,
  customer_request_received_at,customer_request_received_source
from public.refund_cases where id='ab450000-0000-4000-8000-000000000001';

select ok(has_function_privilege('service_role',
  'public.service_claim_due_approved_card_nayax_research(integer)','execute')
  and not has_function_privilege('authenticated',
  'public.service_claim_due_approved_card_nayax_research(integer)','execute')
  and not has_function_privilege('anon',
  'public.service_claim_due_approved_card_nayax_research(integer)','execute'),
  'Only the service worker can claim approved-card read-only research');
select ok(not has_function_privilege('authenticated',
    'public.service_validate_approved_card_nayax_research_start(uuid,bigint,bigint,bigint,text,text,integer)',
    'execute')
  and not has_function_privilege('authenticated',
    'public.service_get_approved_card_nayax_research_health()','execute')
  and not has_function_privilege('authenticated',
    'public.service_commit_approved_card_nayax_research(uuid,bigint,bigint,bigint,text,text,integer,text,text,text,timestamp with time zone,text,uuid,integer,jsonb)',
    'execute')
  and not has_function_privilege('authenticated',
    'public.service_fail_approved_card_nayax_research(uuid,bigint,bigint,bigint,text,text,integer,text,boolean)',
    'execute'),
  'Start, health, commit and failure RPCs remain service-only');

create temporary table saved_approval as
select decision,decision_reason,decided_by,decided_at,refund_amount_cents,
  refund_business_fingerprint,official_action_version
from public.refund_cases where id='ab450000-0000-4000-8000-000000000001';
select is((public.refund_lifecycle_contract('ab450000-0000-4000-8000-000000000001')
  #>> '{lookup,status}'),'results_expired',
  'The approved split-state has canonically expired read-only evidence');

set local role service_role;
select is(public.service_get_approved_card_nayax_research_health()->>'dueCount',
  '1','An unmapped older case is excluded from the actual due count');
select throws_ok($$select public.service_begin_refund_nayax_lookup(
  'ab450000-0000-4000-8000-000000000001',1,'approved_scheduled',null)$$,
  'P4622','This older approval is not tied to an exact transaction and cannot be reused. It needs separate review.',
  'The old service begin route still rejects an approved case');
create temporary table approved_claim as
select public.service_claim_due_approved_card_nayax_research(1) as result;
select is((select jsonb_array_length(result) from approved_claim),1,
  'A later mapped approved case survives an older unmapped row at batch limit one');
select ok((select result @> '[{"caseId":"ab450000-0000-4000-8000-000000000001"}]'::jsonb
  from approved_claim),'Manual provenance and prior execution remain excluded');
select is(jsonb_array_length(public.service_claim_due_approved_card_nayax_research(1)),0,
  'Repeated sweep cannot claim the active generation');
reset role;

select is((select nayax_lookup_status from public.refund_cases
  where id='ab450000-0000-4000-8000-000000000001'),'checking',
  'The actual existing lookup generation entered checking');
select is((select count(*)::integer from public.refund_case_events
  where refund_case_id='ab450000-0000-4000-8000-000000000001'
    and event_type='approved_card_lookup_research_claimed'),1,
  'One durable fact/action-bound research claim was recorded');
select ok((select c.decision=s.decision and c.decided_by=s.decided_by
  and c.decided_at=s.decided_at and c.decision_reason=s.decision_reason
  and c.refund_amount_cents=s.refund_amount_cents
  and c.refund_business_fingerprint=s.refund_business_fingerprint
  from public.refund_cases c cross join saved_approval s
  where c.id='ab450000-0000-4000-8000-000000000001'),
  'The saved approval actor, time, reason, amount and case fingerprint survive the claim');

set local role service_role;
select is((select public.service_validate_approved_card_nayax_research_start(
  'ab450000-0000-4000-8000-000000000001',
  (result->0->>'lookupGeneration')::bigint,1,
  (result->0->>'officialActionVersion')::bigint,
  result->0->>'businessFingerprint',result->0->>'scopeDigest',963
)->>'ready' from approved_claim),'true',
  'Exact saved approval, fact and account/machine scope permit a read-only provider start');
reset role;
-- The real portal-mode constraint requires removing API routing in the same write.
update public.reporting_machines set nayax_manual_portal_enabled=true,
  nayax_manual_account_scope='approved_research_manual',
  nayax_refunds_enabled=false,nayax_machine_id=null,nayax_account_key=null
where id='ab440000-0000-4000-8000-000000000001';
set local role service_role;
select is((select public.service_validate_approved_card_nayax_research_start(
  'ab450000-0000-4000-8000-000000000001',
  (result->0->>'lookupGeneration')::bigint,1,
  (result->0->>'officialActionVersion')::bigint,
  result->0->>'businessFingerprint',result->0->>'scopeDigest',963
)->>'ready' from approved_claim),'false',
  'Switching the claimed machine to manual portal blocks the provider read');
reset role;
select is(public.refund_approved_card_research_scope_digest(
  'ab450000-0000-4000-8000-000000000001'),null,
  'Manual portal mode invalidates the private approved-read scope binding');
update public.reporting_machines set nayax_manual_portal_enabled=false,
  nayax_manual_account_scope=null,nayax_refunds_enabled=true,
  nayax_machine_id='APPROVED-RESEARCH-MACHINE',nayax_account_key='default'
where id='ab440000-0000-4000-8000-000000000001';
update public.reporting_machines set nayax_account_key='changed-account'
where id='ab440000-0000-4000-8000-000000000001';
set local role service_role;
select is((select public.service_validate_approved_card_nayax_research_start(
  'ab450000-0000-4000-8000-000000000001',
  (result->0->>'lookupGeneration')::bigint,1,
  (result->0->>'officialActionVersion')::bigint,
  result->0->>'businessFingerprint',result->0->>'scopeDigest',963
)->>'ready' from approved_claim),'false',
  'A changed account mapping rejects the claimed provider read before it starts');
reset role;
update public.reporting_machines set nayax_account_key='default'
where id='ab440000-0000-4000-8000-000000000001';

-- Only the mutable lease clock advances in this synthetic crash fixture.
-- This is the state reached naturally when the worker dies for two minutes.
update public.refund_cases
set nayax_lookup_started_at=statement_timestamp()-interval '2 minutes'
where id='ab450000-0000-4000-8000-000000000001';
set local role service_role;
select is(public.service_get_approved_card_nayax_research_health()
  ->>'staleClaimCount','1','An interrupted claim is visible as overdue work');
create temporary table recovered_claim as
select public.service_claim_due_approved_card_nayax_research(1) as result;
select is((select jsonb_array_length(result) from recovered_claim),1,
  'The existing recovery plus exact prior claim safely reclaims the interrupted read');
select is((select result->0->>'caseId' from recovered_claim),
  'ab450000-0000-4000-8000-000000000001',
  'An unmapped older case does not starve the recovered approved case');
select is(public.service_get_approved_card_nayax_research_health()
  ->>'staleClaimCount','0','The new generation clears the stale-claim health state');
reset role;
select is((select count(*)::integer from public.refund_case_events
  where refund_case_id='ab450000-0000-4000-8000-000000000001'
    and event_type='approved_card_lookup_research_claimed'),2,
  'Crash recovery records a separate exact generation without another approval');

-- The real stale-claim recovery writer can settle checking before the old
-- worker reports a failure. The late failure must not overwrite recovery.
savepoint late_approved_failure;
update public.refund_cases
set nayax_lookup_started_at=statement_timestamp()-interval '2 minutes'
where id='ab450000-0000-4000-8000-000000000001';
set local role service_role;
select is(public.service_recover_stale_refund_nayax_lookups()
  ->>'recoveredCount','1','The shared recovery writer settles the expired claim');
select is(public.service_fail_approved_card_nayax_research(
  'ab450000-0000-4000-8000-000000000001',
  (select (result->0->>'lookupGeneration')::bigint from recovered_claim),1,
  (select (result->0->>'officialActionVersion')::bigint from recovered_claim),
  (select result->0->>'businessFingerprint' from recovered_claim),
  (select result->0->>'scopeDigest' from recovered_claim),963,
  'worker_interrupted',true)->>'stale','true',
  'A late worker failure cannot overwrite the recovered checking state');
select is(public.service_fail_approved_card_nayax_research(
  'ab450000-0000-4000-8000-000000000001',
  (select (result->0->>'lookupGeneration')::bigint from recovered_claim),1,
  (select (result->0->>'officialActionVersion')::bigint from recovered_claim),
  (select result->0->>'businessFingerprint' from recovered_claim),
  (select result->0->>'scopeDigest' from recovered_claim),963,
  'worker_interrupted',true)->>'alreadyCompleted','false',
  'A recovered failed generation is not a completed provider read');
reset role;
select is((select nayax_lookup_status||':'||nayax_lookup_failure_class
  from public.refund_cases
  where id='ab450000-0000-4000-8000-000000000001'),
  'lookup_failed:worker_interrupted',
  'The recovery result remains authoritative after the stale failure');
rollback to savepoint late_approved_failure;

insert into public.refund_nayax_lookup_candidates(
  token,refund_case_id,reporting_machine_id,lookup_generation,
  provider_transaction_id,site_id,machine_authorization_time,
  amount_cents,card_last4,currency_code,evidence_summary,expires_at
) values(
  'ab460000-0000-4000-8000-000000000001',
  'ab450000-0000-4000-8000-000000000001',
  'ab440000-0000-4000-8000-000000000001',
  (select (result->0->>'lookupGeneration')::bigint from recovered_claim),
  'APPROVED-READ-CANDIDATE-001',101,
  (select incident_at from public.refund_cases
   where id='ab450000-0000-4000-8000-000000000001'),
  963,'4242','USD',(
    select jsonb_build_object(
      'selection_allowed',true,'one_click_eligible',false,
      'policy_version','2026-09-13.v12',
      'identifier_policy_version','2026-09-05.identifier.v2',
      'customer_fact_version',c.deterministic_fact_version,
      'customer_credential_class','customer_identifier_unknown',
      'provider_identifier_class','last_sales_identifier_unknown',
      'card_last4_comparison','exact_support',
      'card_network_comparison','missing',
      'payment_interaction_comparison','unknown',
      'same_identifier_equivalence_proven',false,
      'identifier_review_state','exact_support',
      'customer_correction_fields','[]'::jsonb,
      'hard_exclusions','[]'::jsonb,
      'lookup_account_scope','DEFAULT',
      'lookup_provider_machine_id','APPROVED-RESEARCH-MACHINE',
      'provider_machine_id','APPROVED-RESEARCH-MACHINE',
      'machine_authorization_time_raw',
        to_char(c.incident_at at time zone 'America/Los_Angeles','YYYY-MM-DD"T"HH24:MI:SS.MS'),
      'machine_authorization_at',c.incident_at,
      'machine_authorization_time_source','MachineAuthorizationTime',
      'machine_time_resolution','exact',
      'provider_time_resolution','exact',
      'provider_time_source','authorization_gmt',
      'authorized_at',c.incident_at,
      'customer_request_received_at',c.customer_request_received_at,
      'customer_request_received_source',c.customer_request_received_source,
      'transaction_occurrence_comparable',true,
      'transaction_occurrence_semantics','online_purchase_occurrence',
      'transaction_occurrence_proof_source','verified_provider_purchase_occurrence_v1',
      'transaction_occurrence_timestamp_source','authorization_gmt',
      'transaction_occurrence_timezone_basis','utc',
      'transaction_occurrence_lower_bound_at',c.incident_at,
      'transaction_occurrence_upper_bound_at',c.incident_at,
      'request_receipt_lower_bound_at',c.customer_request_received_at,
      'request_receipt_upper_bound_at',c.customer_request_received_at,
      'request_time_boundary','before_or_at_request',
      'amount_delta_cents',0,'time_delta_minutes',0,
      'provider_processing_time_delta_minutes',0,
      'payment_status','approved',
      'payment_status_evidence','last_sales_contract',
      'provider_refund_state','clear',
      'duplicate_provider_record',false)
    from public.refund_cases c
    where c.id='ab450000-0000-4000-8000-000000000001'),
  statement_timestamp()+interval '30 minutes');
set local role service_role;
select is(public.service_commit_approved_card_nayax_research(
  'ab450000-0000-4000-8000-000000000001',
  (select (result->0->>'lookupGeneration')::bigint from recovered_claim),1,
  (select (result->0->>'officialActionVersion')::bigint from recovered_claim),
  (select result->0->>'businessFingerprint' from recovered_claim),
  (select result->0->>'scopeDigest' from recovered_claim),963,
  'match_found','ambiguous','approved-research-v1',statement_timestamp(),
  'The bounded read found a candidate requiring review.',null,1,null
) ->> 'applied','true','A current read-only result commits through the version guard');
select is(public.service_fail_approved_card_nayax_research(
  'ab450000-0000-4000-8000-000000000001',
  (select (result->0->>'lookupGeneration')::bigint from recovered_claim),1,
  (select (result->0->>'officialActionVersion')::bigint from recovered_claim),
  (select result->0->>'businessFingerprint' from recovered_claim),
  (select result->0->>'scopeDigest' from recovered_claim),963,
  'worker_interrupted',true)->>'alreadyCompleted','true',
  'A late failure after a lost commit response identifies durable completion');
reset role;
create temporary table completed_version as
select official_action_version from public.refund_cases
where id='ab450000-0000-4000-8000-000000000001';
savepoint changed_completed_research;
update public.refund_cases
set correlation_summary=correlation_summary||' Reviewed after the read.'
where id='ab450000-0000-4000-8000-000000000001';
select ok((select c.official_action_version>v.official_action_version
  from public.refund_cases c cross join completed_version v
  where c.id='ab450000-0000-4000-8000-000000000001'),
  'A later review legitimately advances the action version');
set local role service_role;
select is(public.service_fail_approved_card_nayax_research(
  'ab450000-0000-4000-8000-000000000001',
  (select (result->0->>'lookupGeneration')::bigint from recovered_claim),1,
  (select (result->0->>'officialActionVersion')::bigint from recovered_claim),
  (select result->0->>'businessFingerprint' from recovered_claim),
  (select result->0->>'scopeDigest' from recovered_claim),963,
  'worker_interrupted',true)->>'alreadyCompleted','false',
  'Later changed work cannot masquerade as the original completed claim');
reset role;
rollback to savepoint changed_completed_research;
set local role service_role;
select is(public.service_commit_approved_card_nayax_research(
  'ab450000-0000-4000-8000-000000000001',
  (select (result->0->>'lookupGeneration')::bigint from recovered_claim),1,
  (select (result->0->>'officialActionVersion')::bigint from recovered_claim),
  (select result->0->>'businessFingerprint' from recovered_claim),
  (select result->0->>'scopeDigest' from recovered_claim),963,
  'match_found','ambiguous','approved-research-v1',statement_timestamp(),
  'The bounded read found a candidate requiring review.',null,1,null
) ->> 'stale','true','An idempotent commit replay is stale');
reset role;
select is((select count(*)::integer from public.refund_nayax_lookup_candidates
  where token='ab460000-0000-4000-8000-000000000001'),1,
  'Late failure and commit replay preserve the completed candidate evidence');
select is((select nayax_lookup_status from public.refund_cases
  where id='ab450000-0000-4000-8000-000000000001'), 'match_found',
  'Late calls preserve the completed lookup status');

select ok((select c.decision=s.decision and c.decided_by=s.decided_by
  and c.decided_at=s.decided_at and c.decision_reason=s.decision_reason
  and c.refund_amount_cents=s.refund_amount_cents
  from public.refund_cases c cross join saved_approval s
  where c.id='ab450000-0000-4000-8000-000000000001'),
  'Research completion preserves the exact saved business decision');
select is((select count(*)::integer from public.refund_case_nayax_refund_attempts
  where refund_case_id='ab450000-0000-4000-8000-000000000001'),0,
  'Read-only approved research never creates a refund attempt');
select is((select count(*)::integer from public.refund_case_messages
  where refund_case_id='ab450000-0000-4000-8000-000000000001'),0,
  'Read-only approved research never sends a customer message');
select is((select count(*)::integer from public.refund_case_events
  where refund_case_id='ab450000-0000-4000-8000-000000000001'
    and event_type='approved_card_lookup_research_completed'),1,
  'Completion leaves one durable read-only result event');

select * from finish();
rollback;
