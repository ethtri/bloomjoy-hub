begin;
create extension if not exists pgtap with schema extensions;
set local search_path=public,extensions;
select no_plan();

create function pg_temp.health() returns jsonb language sql volatile as $$
  select public.service_get_refund_workflow_health(
    true,true,true,true,true,'{}'::text[],statement_timestamp());
$$;
insert into public.refund_automation_runs(
  run_key,trigger_source,scheduled_for,started_at,finished_at,status,reason_counts)
values('scheduled:status-health-success','scheduled',now(),now(),now(),
  'succeeded','{}'::jsonb);
select is(pg_temp.health() ->> 'schedulerStatus','healthy',
  'A successful scheduler remains a separate healthy fact');
select is(pg_temp.health() #>> '{customerStatusDelivery,status}','healthy',
  'The shared health view consumes the empty status-contact projection');

insert into public.customer_accounts(id,name,account_type)
values('d1100000-0000-4000-8000-000000000001','Status health test','customer');
insert into public.reporting_locations(id,account_id,name,timezone)
values('d1200000-0000-4000-8000-000000000001',
  'd1100000-0000-4000-8000-000000000001','Status health location',
  'America/Los_Angeles');
insert into public.reporting_machines(id,account_id,location_id,machine_label)
values('d1300000-0000-4000-8000-000000000001',
  'd1100000-0000-4000-8000-000000000001',
  'd1200000-0000-4000-8000-000000000001','Status health machine');
insert into public.refund_cases(id,public_reference,reporting_machine_id,
  reporting_location_id,customer_email,issue_summary,incident_at,
  payment_method,payment_amount_cents,refund_amount_cents,card_last4,
  status,correlation_status,correlation_source,automation_state,created_at)
values('d1400000-0000-4000-8000-000000000001','RF-STATUS-HEALTH',
  'd1300000-0000-4000-8000-000000000001',
  'd1200000-0000-4000-8000-000000000001',
  'status-health@example.invalid','',now()-interval '9 days',
  'card',700,700,'4242','needs_review','needs_nayax','nayax',
  'under_review',now()-interval '9 days');
update public.refund_customer_contact_settings
set automatic_customer_contact_enabled=true where singleton;
-- Issue the same SLA message as the production sender, then record a definite
-- pre-provider failure through its allowed pending -> failed transition.
insert into public.refund_case_messages(refund_case_id,message_type,status,
  recipient_email,subject,body,content_source,delivery_kind,reason_code,
  template_key,template_version,requested_fields)
values('d1400000-0000-4000-8000-000000000001','status_update','pending',
  'status-health@example.invalid','Status','Synthetic status',
  'deterministic_template','automatic','sla_at_risk','refund_status_update_sla_at_risk_v1',
  'refund_customer_status_v1','{}');
update public.refund_case_messages
set status='failed',error_message='gmail_source_thread_required'
where refund_case_id='d1400000-0000-4000-8000-000000000001'
  and message_type='status_update';
select is(pg_temp.health() #>> '{customerStatusDelivery,definiteFailureCount}','1',
  'An issued proven-unsent status message is a distinct customer obligation');
select is(pg_temp.health() ->> 'deliveryStatus','degraded',
  'The required status-contact failure degrades shared delivery health');
select is(pg_temp.health() ->> 'status','failing',
  'A healthy scheduler cannot hide an older required contact failure');
select ok(pg_temp.health() -> 'blockedReasons' ? 'customer_status_obligation',
  'The existing incident route receives a stable purpose-bound blocker');
insert into public.refund_automation_runs(run_key,trigger_source,
  scheduled_for,started_at,finished_at,status,reason_counts)
values('scheduled:status-health-noop','scheduled',now()+interval '1 minute',
  now()+interval '1 minute',now()+interval '1 minute','succeeded','{}'::jsonb);
select is(pg_temp.health() ->> 'status','failing',
  'A later successful or no-op sweep cannot erase the old status obligation');
update public.refund_automation_runs
set started_at=now()-interval '2 hours',finished_at=now()-interval '2 hours'
where run_key in ('scheduled:status-health-success','scheduled:status-health-noop');
select is(pg_temp.health() ->> 'schedulerStatus','stale',
  'A genuinely stale scheduler remains visible beside status-contact work');
select is(pg_temp.health() ->> 'status','stale',
  'Status-contact integration preserves the stronger known stale-scheduler state');
update public.refund_automation_runs
set started_at=now(),finished_at=now()
where run_key in ('scheduled:status-health-success','scheduled:status-health-noop');
create temporary table status_health_first_incident as
  select public.service_claim_refund_automation_health_notification(
    'workflow_degraded') value;
select is((select value->>'notificationType' from status_health_first_incident),
  'initial','One existing workflow incident is claimed for status-contact failure');
select is(public.service_claim_refund_automation_health_notification(
  'workflow_degraded')->>'notificationType','none',
  'Unchanged status-contact failure coalesces in the existing incident');

-- Another queued status message is not proof that customer contact succeeded.
insert into public.refund_case_messages(refund_case_id,message_type,status,
  recipient_email,subject,body,content_source,delivery_kind,reason_code,
  template_key,template_version,requested_fields)
values('d1400000-0000-4000-8000-000000000001','status_update','pending',
  'status-health@example.invalid','Status follow-up','Still following up',
  'deterministic_template','automatic','sla_at_risk',
  'refund_status_update_sla_at_risk_v1','refund_customer_status_v1','{}');
select is(pg_temp.health() #>> '{customerStatusDelivery,status}',
  'action_needed','A queued replacement cannot discharge a failed status notice');
-- A service-recorded provider receipt, followed by the sender's sent commit,
-- is the reachable same-purpose resolution path.
set local role service_role;
select public.service_mark_refund_transactional_delivery_attempt(id)
from public.refund_case_messages
where refund_case_id='d1400000-0000-4000-8000-000000000001'
  and message_type='status_update' and status='pending';
select public.service_bind_refund_transactional_delivery(
  id,'status-health-provider-receipt',statement_timestamp())
from public.refund_case_messages
where refund_case_id='d1400000-0000-4000-8000-000000000001'
  and message_type='status_update' and status='pending';
reset role;
update public.refund_case_messages
set status='sent',sent_at=statement_timestamp()
where refund_case_id='d1400000-0000-4000-8000-000000000001'
  and message_type='status_update' and status='pending';
select is(pg_temp.health() #>> '{customerStatusDelivery,status}','healthy',
  'An accepted same-purpose send resolves the superseded status notice');
select is(pg_temp.health() ->> 'deliveryStatus','healthy',
  'Resolved status contact permits the existing delivery lanes to recover');
select is(pg_temp.health() ->> 'workflowStatus','instrumentation_unavailable',
  'Recovery does not invent missing general per-case due-work evidence');
select is(public.service_claim_refund_automation_health_notification('healthy')
  ->> 'notificationType','none',
  'A single healthy observation only starts the stable recovery window');
update public.refund_automation_alert_incidents
set healthy_since=now()-interval '61 minutes' where status='open';
select is(public.service_claim_refund_automation_health_notification('healthy')
  ->> 'notificationType','recovery',
  'Authoritative resolution yields one stable recovery in the same incident');

create or replace function public.service_get_refund_status_contact_obligation_health()
returns jsonb language sql stable security definer set search_path='' as $$
  select '{"status":"healthy","unresolvedCount":"not_a_count", "payloadRedacted":true}'::jsonb;
$$;
select is(pg_temp.health() #>> '{customerStatusDelivery,status}',
  'instrumentation_unavailable','Malformed status evidence is explicit');
select is(pg_temp.health() ->> 'deliveryStatus',
  'instrumentation_unavailable','Malformed status evidence cannot report healthy delivery');
select is(pg_temp.health() ->> 'status','waiting',
  'Unavailable status instrumentation cannot promote aggregate health');
insert into public.refund_automation_runs(run_key,trigger_source,
  scheduled_for,started_at,finished_at,status,reason_counts)
values('scheduled:status-health-failure','scheduled',now()+interval '2 minutes',
  now()+interval '2 minutes',now()+interval '2 minutes','failed','{}'::jsonb);
select is(pg_temp.health() ->> 'schedulerStatus','failing',
  'A real scheduler failure remains visible despite missing status evidence');
select is(pg_temp.health() ->> 'status','failing',
  'Missing status instrumentation cannot downgrade a known scheduler failure');
select ok(not has_function_privilege('authenticated',
  'public.service_get_refund_workflow_health(boolean,boolean,boolean,boolean,boolean,text[],timestamp with time zone)',
  'execute'),'The composed service health remains private');
select ok(not has_function_privilege('service_role',
  'public.service_get_refund_workflow_health_pre_status_contact_20260925(boolean,boolean,boolean,boolean,boolean,text[],timestamp with time zone)',
  'execute'),'The old aggregate cannot be called as a status-blind service bypass');

select * from finish();
rollback;
