begin;
create extension if not exists pgtap with schema extensions;
set local search_path=public,extensions;
select no_plan();

create function pg_temp.health() returns jsonb language sql volatile as $$
  select public.service_get_refund_workflow_health(
    true,true,true,true,true,'{}'::text[],statement_timestamp());
$$;
create function pg_temp.health_at(p_observed_at timestamptz)
returns jsonb language sql volatile as $$
  select public.service_get_refund_workflow_health(
    true,true,true,true,true,'{}'::text[],p_observed_at);
$$;
insert into public.refund_automation_runs(
  run_key,trigger_source,scheduled_for,started_at,finished_at,status,reason_counts)
values('scheduled:clarification-health','scheduled',now(),now(),now(),
  'succeeded','{}'::jsonb);
update public.refund_customer_contact_settings
set automatic_customer_contact_enabled=true where singleton;

insert into public.customer_accounts(id,name,account_type)
values('e1100000-0000-4000-8000-000000000001','Clarification health test','customer');
insert into public.reporting_locations(id,account_id,name,timezone)
values('e1200000-0000-4000-8000-000000000001',
  'e1100000-0000-4000-8000-000000000001','Clarification health location',
  'America/Los_Angeles');
insert into public.reporting_machines(id,account_id,location_id,machine_label)
values('e1300000-0000-4000-8000-000000000001',
  'e1100000-0000-4000-8000-000000000001',
  'e1200000-0000-4000-8000-000000000001','Clarification health machine');
insert into public.refund_cases(
  id,public_reference,reporting_machine_id,reporting_location_id,
  customer_email,issue_summary,status,intake_source,incident_at,
  incident_local_datetime,incident_timezone,incident_time_resolution,
  incident_time_confidence,payment_method,payment_interaction,card_last4,
  card_last4_provenance,card_wallet_used,card_network,correlation_status
) values (
  'e1400000-0000-4000-8000-000000000001','RF-CLARIFICATION-HEALTH',
  'e1300000-0000-4000-8000-000000000001',
  'e1200000-0000-4000-8000-000000000001',
  'clarification-health@example.invalid','Synthetic clarification',
  'needs_review','gmail',now()-interval '2 hours',
  to_char((now()-interval '2 hours') at time zone 'America/Los_Angeles',
    'YYYY-MM-DD"T"HH24:MI'),
  'America/Los_Angeles','exact','exact','card','tap_card','1234',
  'physical_card',false,'visa','manual_review'
);
create temp table clarification_fixture as
select public.service_claim_refund_follow_up_cycle(
  'e1400000-0000-4000-8000-000000000001','missing_information',
  (select template_version from public.refund_customer_contact_settings
   where singleton),repeat('e',64),null) value;
select is((select value->>'claimed' from clarification_fixture),'true',
  'The existing follow-up cycle claims the current missing-information request');
select is(pg_temp.health() #>> '{customerClarificationDelivery,status}',
  'healthy','A fresh preparing cycle is not retroactively overdue');
select is(public.service_get_refund_workflow_health(
  true,false,true,true,true,'{}'::text[],statement_timestamp())
  #>> '{customerClarificationDelivery,policySuppressedCount}','1',
  'Runtime-disabled required outreach is visible even while the DB switch is enabled');
-- Observe the same immutable request at a later clock; its causal receipt is unchanged.
select is(pg_temp.health_at(statement_timestamp()+interval '2 hours')
  #>> '{customerClarificationDelivery,agingPreparingCount}',
  '1','A still-unissued current request becomes due after the defined hour');
select is(pg_temp.health_at(statement_timestamp()+interval '2 hours')
  #>> '{customerClarificationDelivery,owner}',
  'System','An aged unissued request remains System delivery work');
select ok(pg_temp.health_at(statement_timestamp()+interval '2 hours')
  ->'blockedReasons' ? 'customer_clarification_obligation',
  'Existing incident health receives one clarification blocker');

update public.refund_customer_contact_settings
set automatic_customer_contact_enabled=false where singleton;
select is(pg_temp.health() #>> '{customerClarificationDelivery,policySuppressedCount}',
  '1','Disabled required current outreach is visible before a send');
select is(pg_temp.health() #>> '{customerClarificationDelivery,owner}',
  'Refund Operations','A policy-suppressed required request has an operations owner');
update public.refund_customer_contact_settings
set automatic_customer_contact_enabled=true where singleton;

insert into public.refund_case_messages(
  id,refund_case_id,message_type,status,recipient_email,subject,body,
  content_source,delivery_kind,reason_code,template_version,
  follow_up_cycle_id,requested_fields
) select 'e1500000-0000-4000-8000-000000000001',
  'e1400000-0000-4000-8000-000000000001','more_info','pending',
  'clarification-health@example.invalid','Please update your request',
  '[Secure refund correction link included at delivery]',
  'deterministic_template','automatic',cycle.reason_code,
  cycle.template_version,cycle.id,cycle.requested_fields
from public.refund_follow_up_cycles cycle
where cycle.id=(select (value#>>'{cycle,id}')::uuid from clarification_fixture);
select is(pg_temp.health() #>> '{customerClarificationDelivery,status}',
  'healthy','A freshly queued exact request is not a delivery failure');
select is(pg_temp.health_at(statement_timestamp()+interval '2 hours')
  #>> '{customerClarificationDelivery,agingQueuedCount}',
  '1','An unsent current request aging past an hour is an owned obligation');
savepoint definite_failure_observation;
update public.refund_case_messages
set status='failed',error_message='synthetic_no_provider_send'
where id='e1500000-0000-4000-8000-000000000001';
select is(pg_temp.health() #>> '{customerClarificationDelivery,definiteFailureCount}',
  '1','An exact proven-unsent current request is an immediate delivery failure');
rollback to savepoint definite_failure_observation;
release savepoint definite_failure_observation;

-- Each observation starts from the same pending request. The send guard stays
-- enabled: a failed automatic message can never become pending or sent again.
savepoint unknown_effect_observation;
set local role service_role;
select public.service_mark_refund_transactional_delivery_attempt(
  'e1500000-0000-4000-8000-000000000001');
reset role;
select is(pg_temp.health() #>> '{customerClarificationDelivery,unknownEffectCount}',
  '1','An exact started but uncertain transport is actionable without age');
rollback to savepoint unknown_effect_observation;
release savepoint unknown_effect_observation;

savepoint accepted_receipt_observation;
set local role service_role;
select public.service_mark_refund_transactional_delivery_attempt(
  'e1500000-0000-4000-8000-000000000001');
select public.service_bind_refund_transactional_delivery(
  'e1500000-0000-4000-8000-000000000001',
  'accepted-clarification',statement_timestamp());
reset role;
select is(pg_temp.health() #>> '{customerClarificationDelivery,status}',
  'healthy','An accepted provider receipt before parent settlement is not an unknown effect');
set local role service_role;
select public.service_record_refund_transactional_delivery_event(
  repeat('e',64),'accepted-clarification','delivered',statement_timestamp());
reset role;
select is(pg_temp.health() #>> '{customerClarificationDelivery,status}',
  'healthy','A delivered current question legitimately waits on the customer');
rollback to savepoint accepted_receipt_observation;
release savepoint accepted_receipt_observation;

update public.refund_case_messages
set status='failed',
  error_message='synthetic_old_fact_failure'
where id='e1500000-0000-4000-8000-000000000001';
update public.refund_cases set incident_time_confidence='rough'
where id='e1400000-0000-4000-8000-000000000001';
select is(pg_temp.health() #>> '{customerClarificationDelivery,status}',
  'healthy','A failed request from an obsolete fact version is not current work');

create or replace function public.service_get_refund_clarification_contact_obligation_health(
  p_automation_enabled boolean,p_customer_contact_enabled boolean,
  p_observed_at timestamptz)
returns jsonb language sql stable security definer set search_path='' as $$
  select '{"status":"healthy","unresolvedCount":"invalid","payloadRedacted":true}'::jsonb;
$$;
select is(pg_temp.health() #>> '{customerClarificationDelivery,status}',
  'instrumentation_unavailable','Malformed clarification evidence is explicit');
select is(pg_temp.health() ->> 'deliveryStatus',
  'instrumentation_unavailable','Malformed clarification evidence cannot report healthy delivery');
insert into public.refund_automation_runs(run_key,trigger_source,
  scheduled_for,started_at,finished_at,status,reason_counts)
values('scheduled:clarification-health-failed',
  'scheduled',now()+interval '1 minute',now()+interval '1 minute',
  now()+interval '1 minute','failed','{}'::jsonb);
select is(pg_temp.health() ->> 'status','failing',
  'Missing clarification instrumentation does not hide a known scheduler failure');
select ok(not has_function_privilege('authenticated',
  'public.service_get_refund_clarification_contact_obligation_health(boolean,boolean,timestamp with time zone)',
  'execute'),'The clarification projection is service-only');
select ok(not has_function_privilege('service_role',
  'public.service_get_refund_workflow_health_pre_clarification_20260925(boolean,boolean,boolean,boolean,boolean,text[],timestamp with time zone)',
  'execute'),'The prior aggregate is not a clarification-blind service bypass');
select * from finish();
rollback;
