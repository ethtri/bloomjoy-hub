begin;
create extension if not exists pgtap with schema extensions;
set local search_path=public,extensions;
select plan(23);
update public.refund_customer_contact_settings
set automatic_customer_contact_enabled=true,correction_links_enabled=true
where singleton;

select is(public.refund_next_work_projection(jsonb_build_object(
  'payloadRedacted',true,'stage','matching','reasonCode','no_safe_match',
  'customerOutreach',jsonb_build_object('state','delivery_failed',
    'failureCode','request_claim_abandoned','requestMessageId',null,
    'requestSentAt',null,'requestedFields','[]'::jsonb)),null)->>'actionCode',
  'research_purchase','An abandoned empty claim assigns internal research');
select is(public.refund_next_work_projection(jsonb_build_object(
  'payloadRedacted',true,'stage','matching','reasonCode','no_safe_match',
  'customerOutreach',jsonb_build_object('state','policy_suppressed',
    'failureCode','pre_message_suppressed:no_customer_correctable_fact',
    'requestMessageId',null,'requestSentAt',null,'requestedFields','[]'::jsonb)),null)->>'actor',
  'agent','A deliberate empty-question suppression remains Agent work');
select is(public.refund_next_work_projection(jsonb_build_object(
  'payloadRedacted',true,'stage','matching','reasonCode','no_safe_match',
  'customerOutreach',jsonb_build_object('state','delivery_failed',
    'failureCode','synthetic_transport_failure','requestMessageId','00000000-0000-4000-8000-000000000099',
    'requestedFields','["amount"]'::jsonb)),null)->>'actionCode',
  'recover_customer_delivery','A real saved question keeps delivery recovery');

insert into public.customer_accounts(id,name,account_type)
values('b9200000-0000-4000-8000-000000000001','Empty question fixture','customer');
insert into public.reporting_locations(id,account_id,name,timezone,status)
values('b9200000-0000-4000-8000-000000000002',
  'b9200000-0000-4000-8000-000000000001','Fixture location','America/Los_Angeles','active');
insert into public.reporting_machines(id,account_id,location_id,machine_label,machine_type,status,
  refund_intake_enabled,refund_public_display_label)
values('b9200000-0000-4000-8000-000000000003',
  'b9200000-0000-4000-8000-000000000001',
  'b9200000-0000-4000-8000-000000000002','Fixture machine','commercial','active',true,'Fixture machine');
insert into public.refund_cases(id,public_reference,reporting_machine_id,reporting_location_id,
  customer_email,issue_summary,status,intake_source,incident_at,incident_local_datetime,
  incident_timezone,incident_time_resolution,incident_time_confidence,payment_method,
  payment_interaction,payment_amount_cents,correlation_status)
values('b9200000-0000-4000-8001-000000000001','RF-EMPTY-1',
  'b9200000-0000-4000-8000-000000000003','b9200000-0000-4000-8000-000000000002',
  'empty-question@example.invalid','Fixture issue','needs_review','gmail',
  statement_timestamp()-interval '2 hours',
  to_char((statement_timestamp()-interval '2 hours') at time zone 'America/Los_Angeles',
    'YYYY-MM-DD"T"HH24:MI'),
  'America/Los_Angeles','exact','exact','cash','cash',100,'manual_review');
update public.refund_cases
set correlation_status='no_match',correlation_source='sunze',
  correlation_summary='No matching local cash sale.'
where id='b9200000-0000-4000-8001-000000000001';
update public.refund_cases
set cash_match_evaluated_fact_version=deterministic_fact_version
where id='b9200000-0000-4000-8001-000000000001';
insert into public.refund_follow_up_cycles(id,refund_case_id,cycle_number,trigger_fingerprint,
  reason_code,requested_fields,template_version,case_fact_version,reminder_delay_hours)
select 'b9200000-0000-4000-8002-000000000001',c.id,1,repeat('b',64),
  'no_safe_match','{}'::text[],settings.template_version,c.deterministic_fact_version,
  settings.reminder_delay_hours
from public.refund_cases c cross join public.refund_customer_contact_settings settings
where c.id='b9200000-0000-4000-8001-000000000001' and settings.singleton;
update public.refund_follow_up_cycles
set status='manual_review',failed_at=statement_timestamp(),failure_code='request_claim_abandoned'
where id='b9200000-0000-4000-8002-000000000001';

savepoint obsolete_unknown_question;
insert into public.refund_case_messages(id,refund_case_id,message_type,status,
  recipient_email,subject,body,content_source,delivery_kind,reason_code,
  template_version,follow_up_cycle_id,requested_fields)
select 'b9200000-0000-4000-8003-000000000001',c.id,'no_safe_match','pending',
  c.customer_email,'Purchase detail request','Fixture empty question body',
  'deterministic_template','automatic','no_safe_match',cycle.template_version,
  cycle.id,'{}'::text[]
from public.refund_cases c join public.refund_follow_up_cycles cycle
  on cycle.refund_case_id=c.id
where c.id='b9200000-0000-4000-8001-000000000001';
set local role service_role;
select public.service_mark_refund_transactional_delivery_attempt(
  'b9200000-0000-4000-8003-000000000001');
reset role;
select is(public.refund_customer_outreach_contract(
  'b9200000-0000-4000-8001-000000000001')->>'state','delivery_unknown',
  'The historical empty question keeps its unknown transport evidence');
select is(public.service_get_refund_clarification_contact_obligation_health(
  true,true,statement_timestamp())->>'unresolvedCount','0',
  'An empty question with no current field is not a current obligation');
select is(public.service_get_refund_clarification_contact_obligation_health(
  true,true,statement_timestamp())->>'resolvedObsoleteCount','1',
  'The obsolete unknown question has an explicit redacted disposition');
select is((select status from public.refund_case_messages
  where id='b9200000-0000-4000-8003-000000000001'),'pending',
  'The health projection does not rewrite the historical parent message');
rollback to savepoint obsolete_unknown_question;
release savepoint obsolete_unknown_question;

select is(public.service_get_refund_clarification_contact_obligation_health(
  true,true,statement_timestamp())->>'unresolvedCount','0',
  'A current empty claim has no customer delivery obligation');

insert into public.refund_cases(id,public_reference,reporting_machine_id,reporting_location_id,
  customer_email,issue_summary,status,intake_source,incident_at,incident_local_datetime,
  incident_timezone,incident_time_resolution,incident_time_confidence,payment_method,
  payment_interaction,payment_amount_cents,correlation_status)
select ('b9200000-0000-4000-8001-'||lpad(n::text,12,'0'))::uuid,'RF-EMPTY-'||n,
  c.reporting_machine_id,c.reporting_location_id,'empty-question-'||n||'@example.invalid',
  c.issue_summary,c.status,c.intake_source,c.incident_at,c.incident_local_datetime,
  c.incident_timezone,c.incident_time_resolution,c.incident_time_confidence,
  c.payment_method,c.payment_interaction,c.payment_amount_cents,'manual_review'
from public.refund_cases c cross join generate_series(2,4) n
where c.id='b9200000-0000-4000-8001-000000000001';
update public.refund_cases
set correlation_status='no_match',correlation_source='sunze',
  correlation_summary='No matching local cash sale.'
where id in ('b9200000-0000-4000-8001-000000000002',
  'b9200000-0000-4000-8001-000000000003',
  'b9200000-0000-4000-8001-000000000004');
update public.refund_cases
set cash_match_evaluated_fact_version=deterministic_fact_version
where id in ('b9200000-0000-4000-8001-000000000002',
  'b9200000-0000-4000-8001-000000000003',
  'b9200000-0000-4000-8001-000000000004');
insert into public.refund_follow_up_cycles(id,refund_case_id,cycle_number,trigger_fingerprint,
  reason_code,requested_fields,template_version,case_fact_version,reminder_delay_hours)
select ('b9200000-0000-4000-8002-'||lpad(n::text,12,'0'))::uuid,c.id,1,
  repeat(n::text,64),'no_safe_match','{}'::text[],settings.template_version,
  c.deterministic_fact_version,settings.reminder_delay_hours
from public.refund_cases c cross join public.refund_customer_contact_settings settings
cross join generate_series(2,4) n
where c.id=('b9200000-0000-4000-8001-'||lpad(n::text,12,'0'))::uuid
  and settings.singleton;
update public.refund_follow_up_cycles
set status='manual_review',failed_at=statement_timestamp(),failure_code='request_claim_abandoned'
where id='b9200000-0000-4000-8002-000000000002';
update public.refund_follow_up_cycles
set status='manual_review',failed_at=statement_timestamp(),
  failure_code='pre_message_suppressed:no_customer_correctable_fact'
where id='b9200000-0000-4000-8002-000000000004';
select is(public.service_get_refund_clarification_contact_obligation_health(
  true,true,statement_timestamp())->>'policySuppressedCount','0',
  'An explicit no-correctable-fact suppression has no customer delivery obligation');

-- One cycle is stale because the customer facts changed after its claim.
update public.refund_cases set payment_amount_cents=150
where id='b9200000-0000-4000-8001-000000000002';

-- The other has a linked saved request. The service must not erase its evidence.
insert into public.refund_case_messages(id,refund_case_id,message_type,status,recipient_email,
  subject,body,content_source,delivery_kind,reason_code,template_version,
  follow_up_cycle_id,requested_fields)
select 'b9200000-0000-4000-8003-000000000003',c.id,'no_safe_match','failed',
  c.customer_email,'Purchase detail request','Fixture question body',
  'deterministic_template','automatic','no_safe_match',cycle.template_version,
  cycle.id,cycle.requested_fields
from public.refund_cases c join public.refund_follow_up_cycles cycle
  on cycle.refund_case_id=c.id
where c.id='b9200000-0000-4000-8001-000000000003';

select is(public.service_get_refund_clarification_contact_obligation_health(
  true,true,statement_timestamp())->>'definiteFailureCount','1',
  'The same no-question exclusion retains a real saved question failure');

-- The message-binding trigger now owns this cycle's request evidence. Its
-- normal state cannot be forced into the legacy abandoned shape.

create temp table rejected_evidence as
select id,to_jsonb(cycle) as cycle_value from public.refund_follow_up_cycles cycle
where id in ('b9200000-0000-4000-8002-000000000001',
  'b9200000-0000-4000-8002-000000000002',
  'b9200000-0000-4000-8002-000000000003');
create temp table rejected_message as
select id,to_jsonb(message) as message_value from public.refund_case_messages message
where id='b9200000-0000-4000-8003-000000000003';

select is(cardinality(public.refund_purchase_correction_request_fields(
  'b9200000-0000-4000-8001-000000000001')),0,
  'Current complete cash facts have no customer-correctable field');
select is(public.refund_customer_outreach_contract(
  'b9200000-0000-4000-8001-000000000001')->>'state','policy_suppressed',
  'Unsent legacy cycle projects no customer question without changing evidence');
select is(public.refund_customer_outreach_contract(
  'b9200000-0000-4000-8001-000000000001')->>'reasonCode','no_customer_correctable_fact',
  'Legacy abandoned failure has the exact internal-work reason');
select is(public.refund_customer_outreach_contract(
  'b9200000-0000-4000-8001-000000000001')->>'failureCode','request_claim_abandoned',
  'Immutable historical failure code is retained');
select is(public.refund_lifecycle_contract(
  'b9200000-0000-4000-8001-000000000001')->'nextWork'->>'actionCode',
  'research_purchase','Canonical next work points to internal research');
select ok((select to_jsonb(c) = e.cycle_value from public.refund_follow_up_cycles c
  join rejected_evidence e on e.id=c.id
  where c.id='b9200000-0000-4000-8002-000000000001'),
  'Projection leaves the original abandoned cycle byte-for-byte unchanged');
select is((select count(*) from public.refund_case_messages where refund_case_id=
  'b9200000-0000-4000-8001-000000000001'),0::bigint,
  'Projection creates no customer question or delivery message');
select is((select count(*) from public.refund_case_events where refund_case_id=
  'b9200000-0000-4000-8001-000000000001'),0::bigint,
  'Projection adds no audit or send event');
select ok(public.refund_customer_outreach_contract(
  'b9200000-0000-4000-8001-000000000002')->>'state' <> 'policy_suppressed',
  'Stale customer facts are not reinterpreted as current no-question policy');
select ok((select to_jsonb(c) = e.cycle_value from public.refund_follow_up_cycles c
  join rejected_evidence e on e.id=c.id
  where c.id='b9200000-0000-4000-8002-000000000002'),
  'Stale cycle evidence remains unchanged');
select ok(public.refund_customer_outreach_contract(
  'b9200000-0000-4000-8001-000000000003')->>'state' <> 'policy_suppressed',
  'A linked saved customer question stays on the actual delivery path');
select ok((select to_jsonb(c) = e.cycle_value from public.refund_follow_up_cycles c
  join rejected_evidence e on e.id=c.id
  where c.id='b9200000-0000-4000-8002-000000000003'),
  'Linked-question cycle evidence remains unchanged');
select ok((select to_jsonb(m) = e.message_value from public.refund_case_messages m
  join rejected_message e on e.id=m.id),
  'Linked saved question and its delivery evidence remain unchanged');

select * from finish();
rollback;
