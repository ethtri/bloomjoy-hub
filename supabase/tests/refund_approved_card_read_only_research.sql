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
  statement_timestamp()-interval '8 hours','America/Los_Angeles','exact',
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
  statement_timestamp()-interval '8 hours','America/Los_Angeles','exact',
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
  statement_timestamp()-interval '8 hours','America/Los_Angeles','exact',
  'card',963,963,'4242','needs_review','approved','Saved decision',
  'ab410000-0000-4000-8000-000000000001',statement_timestamp()-interval '2 hours',
  'manual_review','nayax',3,'manual_exception',
  statement_timestamp()-interval '4 hours',statement_timestamp()-interval '3 hours',
  repeat('c',64),'manual_exception','automatic-lookup-v1','requested',
  statement_timestamp()-interval '7 hours','hosted_refund_intake');

select ok(has_function_privilege('service_role',
  'public.service_claim_due_approved_card_nayax_research(integer)','execute')
  and not has_function_privilege('authenticated',
  'public.service_claim_due_approved_card_nayax_research(integer)','execute')
  and not has_function_privilege('anon',
  'public.service_claim_due_approved_card_nayax_research(integer)','execute'),
  'Only the service worker can claim approved-card read-only research');

create temporary table saved_approval as
select decision,decision_reason,decided_by,decided_at,refund_amount_cents,
  refund_business_fingerprint,official_action_version
from public.refund_cases where id='ab450000-0000-4000-8000-000000000001';
select is((public.refund_lifecycle_contract('ab450000-0000-4000-8000-000000000001')
  #>> '{lookup,status}'),'results_expired',
  'The approved split-state has canonically expired read-only evidence');

set local role service_role;
select throws_ok($$select public.service_begin_refund_nayax_lookup(
  'ab450000-0000-4000-8000-000000000001',1,'approved_scheduled',null)$$,
  'P4622','This older approval is not tied to an exact transaction and cannot be reused. It needs separate review.',
  'The old service begin route still rejects an approved case');
create temporary table approved_claim as
select public.service_claim_due_approved_card_nayax_research(4) as result;
select is((select jsonb_array_length(result) from approved_claim),1,
  'One proven automatic-origin approved case is claimed');
select ok((select result @> '[{"caseId":"ab450000-0000-4000-8000-000000000001"}]'::jsonb
  from approved_claim),'Manual provenance and prior execution remain excluded');
select is(jsonb_array_length(public.service_claim_due_approved_card_nayax_research(4)),0,
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
select is(public.service_commit_approved_card_nayax_research(
  'ab450000-0000-4000-8000-000000000001',
  (select (result->0->>'lookupGeneration')::bigint from approved_claim),1,
  (select (result->0->>'officialActionVersion')::bigint from approved_claim),
  (select result->0->>'businessFingerprint' from approved_claim),
  (select result->0->>'scopeDigest' from approved_claim),963,
  'no_match','no_safe_match','approved-research-v1',statement_timestamp(),
  'The bounded recent-sales read found no supported purchase.',null,0,null
) ->> 'applied','true','A current read-only result commits through the version guard');
reset role;

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
