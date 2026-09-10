begin;

create extension if not exists pgtap with schema extensions;
set local search_path = public, extensions;

select plan(26);

create function pg_temp.capture_error(statement text)
returns text language plpgsql as $$
begin
  execute statement;
  return null;
exception when others then
  return sqlstate || ':' || sqlerrm;
end;
$$;

select has_function('public','refund_customer_outreach_contract',array['uuid'],
  'Final schema exposes the customer-outreach contract');
select has_function('public','service_settle_refund_follow_up_pre_message_suppression',
  array['uuid','uuid','text'],'Final schema exposes exact pre-message settlement');
select ok(
  has_function_privilege('service_role',
    'public.service_settle_refund_follow_up_pre_message_suppression(uuid,uuid,text)','execute')
  and not has_function_privilege('authenticated',
    'public.service_settle_refund_follow_up_pre_message_suppression(uuid,uuid,text)','execute')
  and not has_function_privilege('anon',
    'public.service_settle_refund_follow_up_pre_message_suppression(uuid,uuid,text)','execute'),
  'Only the service role can settle a claimed cycle');
select ok(
  has_function_privilege('service_role','public.refund_customer_outreach_contract(uuid)','execute')
  and not has_function_privilege('authenticated','public.refund_customer_outreach_contract(uuid)','execute'),
  'The raw contract remains server-only');
select ok(
  not has_function_privilege('authenticated',
    'public.admin_get_refund_operations_overview_pre_customer_outreach_v1()','execute'),
  'Browser roles cannot bypass the final overview projection');

insert into public.customer_accounts(id,name,account_type)
values('b8800000-0000-4000-8000-000000000001','Outreach truth fixture','internal');
insert into public.reporting_locations(id,account_id,name,timezone)
values('b8800000-0000-4000-8000-000000000002','b8800000-0000-4000-8000-000000000001',
  'Outreach truth place','America/Los_Angeles');
insert into public.reporting_machines(id,account_id,location_id,machine_label,status)
values('b8800000-0000-4000-8000-000000000003','b8800000-0000-4000-8000-000000000001',
  'b8800000-0000-4000-8000-000000000002','Outreach truth machine','active');
insert into public.refund_cases(id,public_reference,customer_email,issue_summary,status,intake_source)
values
('b8800000-0000-4000-8000-000000000010','RF-OUTREACH-SUPPRESS',
  'suppress@example.invalid','Claimed request suppression fixture','draft','gmail'),
('b8800000-0000-4000-8000-000000000011','RF-OUTREACH-BIND',
  'binding@example.invalid','Exact request binding fixture','draft','gmail'),
('b8800000-0000-4000-8000-000000000012','RF-OUTREACH-SENT',
  'sent@example.invalid','Sent unconfirmed fixture','draft','gmail'),
('b8800000-0000-4000-8000-000000000013','RF-OUTREACH-DELIVERED',
  'delivered@example.invalid','Confirmed delivery fixture','draft','gmail'),
('b8800000-0000-4000-8000-000000000014','RF-OUTREACH-FAILED',
  'failed@example.invalid','Failed delivery fixture','draft','gmail'),
('b8800000-0000-4000-8000-000000000015','RF-OUTREACH-UNKNOWN',
  'unknown@example.invalid','Unknown delivery fixture','draft','gmail'),
('b8800000-0000-4000-8000-000000000016','RF-OUTREACH-REPLIED',
  'replied@example.invalid','Customer reply fixture','draft','gmail'),
('b8800000-0000-4000-8000-000000000017','RF-OUTREACH-RECHECK',
  'recheck@example.invalid','Customer recheck fixture','draft','gmail'),
('b8800000-0000-4000-8000-000000000018','RF-OUTREACH-EXHAUSTED',
  'exhausted@example.invalid','Clarification limit fixture','needs_review','gmail'),
('b8800000-0000-4000-8000-000000000019','RF-OUTREACH-INTERNAL',
  'internal@example.invalid','Internal failure fixture','needs_review','gmail');
insert into public.refund_cases(
  id,public_reference,reporting_machine_id,reporting_location_id,
  customer_email,issue_summary,status,intake_source
) values (
  'b8800000-0000-4000-8000-000000000020','RF-OUTREACH-MANUAL',
  'b8800000-0000-4000-8000-000000000003','b8800000-0000-4000-8000-000000000002',
  'manual@example.invalid','Deliberately classified discretionary fallback','needs_review','gmail'
);

update public.refund_customer_contact_settings
set automatic_customer_contact_enabled=true
where singleton;

create temporary table outreach_claim as
select public.service_claim_refund_follow_up_cycle(
  'b8800000-0000-4000-8000-000000000010','missing_information',
  'refund_follow_up_v1',repeat('a',64),null) payload;

select is((public.refund_customer_outreach_contract(
  'b8800000-0000-4000-8000-000000000010')->>'state'),'preparing',
  'A claimed cycle with no message is preparing under System ownership');
select is((public.refund_customer_outreach_contract(
  'b8800000-0000-4000-8000-000000000010')->>'owner'),'System',
  'Preparing outreach is System-owned');

select is((public.service_settle_refund_follow_up_pre_message_suppression(
  'b8800000-0000-4000-8000-000000000010',
  (select (payload->'cycle'->>'id')::uuid from outreach_claim),
  'automatic_customer_contact_disabled')->>'settled')::boolean,true,
  'The exact claimed cycle settles immediately when the sender suppresses');
select is((select status from public.refund_follow_up_cycles where id=
  (select (payload->'cycle'->>'id')::uuid from outreach_claim)),'manual_review',
  'Pre-message suppression fails the cycle closed to manual review');
select is((public.refund_customer_outreach_contract(
  'b8800000-0000-4000-8000-000000000010')->>'state'),'policy_suppressed',
  'Durable settlement projects truthful suppression instead of preparing');
select is((public.refund_customer_outreach_contract(
  'b8800000-0000-4000-8000-000000000010')->>'owner'),'Refund Operations',
  'Suppression has immediate durable Refund Operations ownership');
select is((public.refund_customer_outreach_contract(
  'b8800000-0000-4000-8000-000000000010')->>'requestMessageId'),null,
  'Pre-message suppression never invents request-message evidence');
select is((select count(*)::integer from public.refund_case_events
  where refund_case_id='b8800000-0000-4000-8000-000000000010'
    and event_type='refund_follow_up_pre_message_suppressed'),1,
  'Settlement records one redacted durable event');
select is((public.service_settle_refund_follow_up_pre_message_suppression(
  'b8800000-0000-4000-8000-000000000010',
  (select (payload->'cycle'->>'id')::uuid from outreach_claim),
  'automatic_customer_contact_disabled')->>'idempotentReplay')::boolean,true,
  'An exact settlement replay is idempotent');
select is((select count(*)::integer from public.refund_case_events
  where refund_case_id='b8800000-0000-4000-8000-000000000010'
    and event_type='refund_follow_up_pre_message_suppressed'),1,
  'An idempotent replay does not duplicate the settlement event');
select like(pg_temp.capture_error($sql$select public.service_settle_refund_follow_up_pre_message_suppression(
  'b8800000-0000-4000-8000-000000000010',
  (select (payload->'cycle'->>'id')::uuid from outreach_claim),'invented_reason')$sql$),
  'P0001:%Approved pre-message suppression reason required%',
  'Settlement rejects reasons outside its bounded enum');

set local session_replication_role=replica;
insert into public.refund_follow_up_cycles(
  id,refund_case_id,cycle_number,trigger_fingerprint,reason_code,requested_fields,
  template_version,case_fact_version,reminder_delay_hours,status)
values('b8800000-0000-4000-8000-000000000020',
  'b8800000-0000-4000-8000-000000000011',1,repeat('b',64),'missing_information',
  array['location_or_machine'],'refund_follow_up_v1',1,72,'claimed');
insert into public.refund_case_messages(
  id,refund_case_id,message_type,status,recipient_email,subject,body,
  content_source,delivery_kind,reason_code,template_version,follow_up_cycle_id,requested_fields,created_at)
values
('b8800000-0000-4000-8000-000000000021','b8800000-0000-4000-8000-000000000011',
  'more_info','pending','binding@example.invalid','Exact request','Redacted fixture',
  'deterministic_template','automatic','missing_information','refund_follow_up_v1',
  'b8800000-0000-4000-8000-000000000020',array['location_or_machine'],statement_timestamp()-interval '2 minutes'),
('b8800000-0000-4000-8000-000000000022','b8800000-0000-4000-8000-000000000011',
  'manual_note','failed','binding@example.invalid','Unrelated later message','Redacted fixture',
  null,null,null,null,null,'{}',statement_timestamp()-interval '1 minute');
update public.refund_follow_up_cycles
set request_message_id='b8800000-0000-4000-8000-000000000021',
  request_created_at=statement_timestamp()-interval '2 minutes'
where id='b8800000-0000-4000-8000-000000000020';

insert into public.refund_follow_up_cycles(
  id,refund_case_id,cycle_number,trigger_fingerprint,reason_code,requested_fields,
  template_version,case_fact_version,reminder_delay_hours,status,request_message_id,
  request_created_at,request_sent_at,reminder_due_at,failure_code)
values
('b8800000-0000-4000-8000-000000000030','b8800000-0000-4000-8000-000000000012',1,
  repeat('c',64),'missing_information',array['location_or_machine'],'refund_follow_up_v1',1,72,
  'waiting','b8800000-0000-4000-8000-000000000040',statement_timestamp()-interval '3 minutes',
  statement_timestamp()-interval '2 minutes',statement_timestamp()+interval '72 hours',null),
('b8800000-0000-4000-8000-000000000031','b8800000-0000-4000-8000-000000000013',1,
  repeat('d',64),'missing_information',array['location_or_machine'],'refund_follow_up_v1',1,72,
  'waiting','b8800000-0000-4000-8000-000000000041',statement_timestamp()-interval '3 minutes',
  statement_timestamp()-interval '2 minutes',statement_timestamp()+interval '72 hours',null),
('b8800000-0000-4000-8000-000000000032','b8800000-0000-4000-8000-000000000014',1,
  repeat('e',64),'missing_information',array['location_or_machine'],'refund_follow_up_v1',1,72,
  'manual_review','b8800000-0000-4000-8000-000000000042',statement_timestamp()-interval '3 minutes',
  null,null,'customer_message_failed'),
('b8800000-0000-4000-8000-000000000033','b8800000-0000-4000-8000-000000000015',1,
  repeat('f',64),'missing_information',array['location_or_machine'],'refund_follow_up_v1',1,72,
  'waiting','b8800000-0000-4000-8000-000000000043',statement_timestamp()-interval '3 minutes',
  statement_timestamp()-interval '2 minutes',statement_timestamp()+interval '72 hours',null),
('b8800000-0000-4000-8000-000000000034','b8800000-0000-4000-8000-000000000016',1,
  repeat('1',64),'missing_information',array['location_or_machine'],'refund_follow_up_v1',1,72,
  'customer_replied','b8800000-0000-4000-8000-000000000044',statement_timestamp()-interval '5 minutes',
  statement_timestamp()-interval '4 minutes',statement_timestamp()+interval '72 hours',null),
('b8800000-0000-4000-8000-000000000035','b8800000-0000-4000-8000-000000000017',1,
  repeat('2',64),'missing_information',array['location_or_machine'],'refund_follow_up_v1',1,72,
  'customer_replied','b8800000-0000-4000-8000-000000000045',statement_timestamp()-interval '5 minutes',
  statement_timestamp()-interval '4 minutes',statement_timestamp()+interval '72 hours',null),
('b8800000-0000-4000-8000-000000000036','b8800000-0000-4000-8000-000000000018',1,
  repeat('3',64),'missing_information',array['location_or_machine'],'refund_follow_up_v1',1,72,
  'manual_review',null,null,null,null,'manual_review_required'),
('b8800000-0000-4000-8000-000000000037','b8800000-0000-4000-8000-000000000018',2,
  repeat('4',64),'missing_information',array['location_or_machine'],'refund_follow_up_v1',1,72,
  'manual_review',null,null,null,null,'manual_review_required'),
('b8800000-0000-4000-8000-000000000038','b8800000-0000-4000-8000-000000000019',1,
  repeat('5',64),'missing_information',array['location_or_machine'],'refund_follow_up_v1',1,72,
  'manual_review',null,null,null,null,'provider_setup');

insert into public.refund_case_messages(
  id,refund_case_id,message_type,status,recipient_email,subject,body,
  content_source,delivery_kind,reason_code,template_version,follow_up_cycle_id,requested_fields,
  sent_at,delivery_transport,provider_message_id,delivery_state,delivery_state_updated_at,created_at)
values
('b8800000-0000-4000-8000-000000000040','b8800000-0000-4000-8000-000000000012',
  'more_info','sent','sent@example.invalid','Sent','Redacted fixture','deterministic_template','automatic',
  'missing_information','refund_follow_up_v1','b8800000-0000-4000-8000-000000000030',
  array['location_or_machine'],statement_timestamp()-interval '2 minutes','resend','outreachsent0001',
  'accepted',statement_timestamp()-interval '2 minutes',statement_timestamp()-interval '3 minutes'),
('b8800000-0000-4000-8000-000000000041','b8800000-0000-4000-8000-000000000013',
  'more_info','sent','delivered@example.invalid','Delivered','Redacted fixture','deterministic_template','automatic',
  'missing_information','refund_follow_up_v1','b8800000-0000-4000-8000-000000000031',
  array['location_or_machine'],statement_timestamp()-interval '2 minutes','resend','outreachdelivered0001',
  'delivered',statement_timestamp()-interval '1 minute',statement_timestamp()-interval '3 minutes'),
('b8800000-0000-4000-8000-000000000042','b8800000-0000-4000-8000-000000000014',
  'more_info','failed','failed@example.invalid','Failed','Redacted fixture','deterministic_template','automatic',
  'missing_information','refund_follow_up_v1','b8800000-0000-4000-8000-000000000032',
  array['location_or_machine'],null,null,null,'unknown',null,statement_timestamp()-interval '3 minutes'),
('b8800000-0000-4000-8000-000000000043','b8800000-0000-4000-8000-000000000015',
  'more_info','sent','unknown@example.invalid','Deferred','Redacted fixture','deterministic_template','automatic',
  'missing_information','refund_follow_up_v1','b8800000-0000-4000-8000-000000000033',
  array['location_or_machine'],statement_timestamp()-interval '2 minutes','resend','outreachdeferred0001',
  'deferred',statement_timestamp()-interval '1 minute',statement_timestamp()-interval '3 minutes'),
('b8800000-0000-4000-8000-000000000044','b8800000-0000-4000-8000-000000000016',
  'more_info','sent','replied@example.invalid','Reply','Redacted fixture','deterministic_template','automatic',
  'missing_information','refund_follow_up_v1','b8800000-0000-4000-8000-000000000034',
  array['location_or_machine'],statement_timestamp()-interval '4 minutes','resend','outreachreplied0001',
  'delivered',statement_timestamp()-interval '3 minutes',statement_timestamp()-interval '5 minutes'),
('b8800000-0000-4000-8000-000000000045','b8800000-0000-4000-8000-000000000017',
  'more_info','sent','recheck@example.invalid','Recheck','Redacted fixture','deterministic_template','automatic',
  'missing_information','refund_follow_up_v1','b8800000-0000-4000-8000-000000000035',
  array['location_or_machine'],statement_timestamp()-interval '4 minutes','resend','outreachrecheck0001',
  'delivered',statement_timestamp()-interval '3 minutes',statement_timestamp()-interval '5 minutes');

insert into public.refund_automation_runs(
  id,run_key,trigger_source,status
) values ('b8800000-0000-4000-8000-000000000050','outreach:truth:run','manual','running');
insert into public.refund_automation_actions(
  id,run_id,refund_case_id,action_key,action_type,status,reason_category,metadata,attempted_at,completed_at)
values
('b8800000-0000-4000-8000-000000000051','b8800000-0000-4000-8000-000000000050',
  'b8800000-0000-4000-8000-000000000017','outreach:truth:recheck','customer_reply_recheck',
  'claimed',null,'{"payload_redacted":true}',statement_timestamp()-interval '1 minute',null),
('b8800000-0000-4000-8000-000000000052','b8800000-0000-4000-8000-000000000050',
  'b8800000-0000-4000-8000-000000000020','outreach:truth:manual','internal_escalation',
  'completed','follow_up_manual_review',
  '{"payload_redacted":true,"customer_outreach_manual_fallback":true}',
  statement_timestamp()-interval '1 minute',statement_timestamp()-interval '30 seconds');
set local session_replication_role=origin;

select is((public.refund_customer_outreach_contract(
  'b8800000-0000-4000-8000-000000000011')->>'state'),'queued',
  'A pending exact request is queued despite a newer unrelated failure');
select is((public.refund_customer_outreach_contract(
  'b8800000-0000-4000-8000-000000000011')->>'requestMessageId'),
  'b8800000-0000-4000-8000-000000000021',
  'Projection binds only cycle.request_message_id');
select ok((public.refund_customer_outreach_contract(
  'b8800000-0000-4000-8000-000000000011')->>'manualFallbackEligible')::boolean is false,
  'Automatic outreach never leaks manual manager-send authority');
select is((public.refund_project_customer_outreach_cases_for_manager(
  jsonb_build_array(jsonb_build_object('id','b8800000-0000-4000-8000-000000000010',
    'lifecycle','{}'::jsonb)),false)->0->'lifecycle'->'customerOutreach'->>'failureCode'),null,
  'Ordinary overview projection redacts the safe internal failure category');
select is((public.refund_project_customer_outreach_cases_for_manager(
  jsonb_build_array(jsonb_build_object('id','b8800000-0000-4000-8000-000000000010',
    'lifecycle','{}'::jsonb)),true)->0->'lifecycle'->'customerOutreach'->>'failureCode'),
  'pre_message_suppressed:automatic_customer_contact_disabled',
  'Operations overview retains the bounded internal failure category');
select is((public.refund_lifecycle_contract(
  'b8800000-0000-4000-8000-000000000010')->'customerOutreach'->>'schemaVersion'),
  'refund_customer_outreach_v1','Final lifecycle includes the versioned outreach contract');
select ok((public.refund_customer_outreach_contract(
  'b8800000-0000-4000-8000-000000000010') ?& array[
    'state','owner','nextAction','requestedFields','caseFactVersion',
    'clarificationAttemptCount','clarificationLimit','payloadRedacted']),
  'Contract always exposes the strict redacted ownership and retry-bound fields');
select is((public.refund_customer_outreach_contract(
  'b8800000-0000-4000-8000-000000000010')->>'clarificationLimit')::integer,2,
  'The durable contract exposes the existing two-attempt bound');
select is((public.refund_customer_outreach_contract(
  'b8800000-0000-4000-8000-000000000010')->>'payloadRedacted')::boolean,true,
  'Customer-outreach projection is explicitly redacted');

select results_eq(
  $sql$
    select refund_case_id,state,owner_name,next_action,manual_fallback
    from (
      select id as refund_case_id,
        public.refund_customer_outreach_contract(id)->>'state' as state,
        public.refund_customer_outreach_contract(id)->>'owner' as owner_name,
        public.refund_customer_outreach_contract(id)->>'nextAction' as next_action,
        (public.refund_customer_outreach_contract(id)->>'manualFallbackEligible')::boolean as manual_fallback
      from public.refund_cases
      where id between 'b8800000-0000-4000-8000-000000000012'::uuid
        and 'b8800000-0000-4000-8000-000000000020'::uuid
    ) projected
    order by refund_case_id
  $sql$,
  $values$
    values
    ('b8800000-0000-4000-8000-000000000012'::uuid,'sent_unconfirmed','System','wait_for_delivery',false),
    ('b8800000-0000-4000-8000-000000000013'::uuid,'waiting_for_customer','Customer','wait_for_customer',false),
    ('b8800000-0000-4000-8000-000000000014'::uuid,'delivery_failed','Refund Operations','refund_operations',false),
    ('b8800000-0000-4000-8000-000000000015'::uuid,'delivery_unknown','Refund Operations','refund_operations',false),
    ('b8800000-0000-4000-8000-000000000016'::uuid,'customer_replied','System','recheck_customer_reply',false),
    ('b8800000-0000-4000-8000-000000000017'::uuid,'rechecking','System','recheck_customer_reply',false),
    ('b8800000-0000-4000-8000-000000000018'::uuid,'clarification_exhausted','Refund Operations','refund_operations',false),
    ('b8800000-0000-4000-8000-000000000019'::uuid,'delivery_failed','Refund Operations','refund_operations',false),
    ('b8800000-0000-4000-8000-000000000020'::uuid,'manual_fallback','Machine Manager','request_details',true)
  $values$,
  'Durable fixture matrix distinguishes delivery truth, reply/recheck, exhaustion, internal failure, and deliberately classified manual fallback ownership'
);

select * from finish();
rollback;
