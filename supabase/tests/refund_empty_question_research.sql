begin;
create extension if not exists pgtap with schema extensions;
set local search_path=public,extensions;
select plan(10);

create function pg_temp.capture_error(statement text) returns text language plpgsql as $$
begin execute statement; return null; exception when others then return sqlstate||':'||sqlerrm; end; $$;

select ok(has_function_privilege('service_role',
  'public.service_reclassify_unsent_empty_refund_question(uuid,uuid)','execute')
  and not has_function_privilege('authenticated',
  'public.service_reclassify_unsent_empty_refund_question(uuid,uuid)','execute'),
  'Only the service role can reclassify a historical cycle');

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
insert into public.refund_follow_up_cycles(id,refund_case_id,cycle_number,trigger_fingerprint,
  reason_code,requested_fields,template_version,case_fact_version,reminder_delay_hours,
  status,failed_at,failure_code)
select 'b9200000-0000-4000-8002-000000000001',c.id,1,repeat('b',64),
  'no_safe_match','{}'::text[],settings.template_version,c.deterministic_fact_version,
  settings.reminder_delay_hours,'manual_review',statement_timestamp(),'request_claim_abandoned'
from public.refund_cases c cross join public.refund_customer_contact_settings settings
where c.id='b9200000-0000-4000-8001-000000000001' and settings.singleton;

select is(cardinality(public.refund_purchase_correction_request_fields(
  'b9200000-0000-4000-8001-000000000001')),0,
  'Current complete cash facts have no customer-correctable field');
select is((public.service_reclassify_unsent_empty_refund_question(
  'b9200000-0000-4000-8001-000000000001',
  'b9200000-0000-4000-8002-000000000001')->>'reclassified')::boolean,true,
  'Exact no-message cycle is reclassified once');
select is(public.refund_customer_outreach_contract(
  'b9200000-0000-4000-8001-000000000001')->>'state','policy_suppressed',
  'Outreach no longer falsely projects a delivery failure');
select is(public.refund_lifecycle_contract(
  'b9200000-0000-4000-8001-000000000001')->'nextWork'->>'actionCode',
  'research_purchase','Canonical next work points to internal research');
select ok(pg_temp.capture_error($q$select public.service_reclassify_unsent_empty_refund_question(
  'b9200000-0000-4000-8001-000000000001',
  'b9200000-0000-4000-8002-000000000001')$q$) like 'P0001:%',
  'Second reclassification is refused');
select is((select count(*) from public.refund_case_events where refund_case_id=
  'b9200000-0000-4000-8001-000000000001'
  and event_type='refund_empty_question_reclassified'),1::bigint,
  'Exactly one audit event records the no-send correction');

select * from finish();
rollback;
