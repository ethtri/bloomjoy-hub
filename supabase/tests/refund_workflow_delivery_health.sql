begin;
create extension if not exists pgtap with schema extensions;
set local search_path = public, extensions;
select no_plan();

create function pg_temp.digest_window_at(p_hour integer)
returns timestamptz language sql stable as $$
  select ((now() at time zone 'America/Los_Angeles')::date
    + make_interval(hours => p_hour, mins => 30))
    at time zone 'America/Los_Angeles';
$$;
create function pg_temp.workflow_health(
  p_digest_runtime boolean default true,
  p_ready_runtime boolean default true,
  p_observed_at timestamptz default pg_temp.digest_window_at(8)
) returns jsonb language sql stable as $$
  select public.service_get_refund_workflow_health(true,true,true,
    p_digest_runtime,p_ready_runtime,'{}'::text[],p_observed_at);
$$;

insert into public.refund_automation_runs (
  run_key, trigger_source, scheduled_for, started_at, finished_at, status,
  reason_counts
) values ('scheduled:workflow-health-fixture', 'scheduled', now(), now(), now(),
  'succeeded', '{}'::jsonb);

select is(pg_temp.workflow_health() ->> 'deliveryStatus', 'healthy',
  'An empty delivery queue is healthy with live worker settings');
select is(pg_temp.workflow_health() ->> 'workflowStatus',
  'instrumentation_unavailable',
  'Missing general due-work instrumentation cannot claim overall health');
select is(pg_temp.workflow_health() ->> 'status', 'waiting',
  'The aggregate remains non-healthy when due-work evidence is unavailable');
select is(pg_temp.workflow_health() ->> 'schedulerStatus', 'healthy',
  'Scheduler health remains a separate fact');

insert into auth.users (
  instance_id,id,aud,role,email,encrypted_password,email_confirmed_at,
  raw_app_meta_data,raw_user_meta_data,created_at,updated_at
) values ('00000000-0000-0000-0000-000000000000',
  '14300000-0000-4000-8000-000000000001','authenticated','authenticated',
  'health-manager@example.invalid','',now(),'{}','{}',now(),now());
insert into public.customer_accounts(id,name,account_type)
values ('14301000-0000-4000-8000-000000000001','Workflow fixture','customer');
insert into public.reporting_locations(id,account_id,name,timezone)
values ('14302000-0000-4000-8000-000000000001',
  '14301000-0000-4000-8000-000000000001','Synthetic health location',
  'America/Los_Angeles');
insert into public.reporting_machines(
  id,account_id,location_id,machine_label,refund_public_display_label
) values ('14303000-0000-4000-8000-000000000001',
  '14301000-0000-4000-8000-000000000001',
  '14302000-0000-4000-8000-000000000001',
  'Internal health label','Public health label');
insert into public.reporting_machine_refund_managers(
  id,reporting_machine_id,manager_user_id,manager_email,grant_reason
) values ('14304000-0000-4000-8000-000000000001',
  '14303000-0000-4000-8000-000000000001',
  '14300000-0000-4000-8000-000000000001',
  'health-manager@example.invalid','Synthetic workflow health fixture');
insert into public.refund_cases(
  id,public_reference,reporting_machine_id,reporting_location_id,
  customer_email,issue_summary,incident_at,payment_method,
  payment_amount_cents,card_last4,status,automation_state,
  deterministic_fact_version,created_at
) values ('14305000-0000-4000-8000-000000000001','RF-HEALTH-1',
  '14303000-0000-4000-8000-000000000001',
  '14302000-0000-4000-8000-000000000001',
  'private-health-customer@example.invalid','Private health complaint',
  now()-interval '1 day','card',725,'4242','needs_review','under_review',
  1,now()-interval '1 day');

-- A provider-accepted historical message may have no downstream delivery
-- webhook yet. Its generic delivery_state is telemetry, not a completion
-- outbox obligation without an exact completion intent.
insert into public.refund_case_messages(
  refund_case_id,message_type,status,recipient_email,subject,body,
  sent_at,delivery_transport,delivery_state
) values ('14305000-0000-4000-8000-000000000001',
  'more_info','sent','private-health-customer@example.invalid',
  'Synthetic receipt telemetry','Synthetic sent message',now()-interval '1 hour',
  'resend','unknown');
select is(pg_temp.workflow_health() #>> '{customerDelivery,status}',
  'healthy','A sent message with generic unknown webhook telemetry is not a completion intent');
select is(pg_temp.workflow_health() #>> '{customerDelivery,deliveryUnknownCount}',
  '0','Only explicit completion-outbox unknown effects count as action-needed delivery');

select is(pg_temp.workflow_health() #>> '{managerDigest,openRecipientCount}',
  '1','The current assigned manager has a nonempty canonical digest queue');
select is(pg_temp.workflow_health() ->> 'workflowStatus',
  'degraded','Disabled database digest with an open scoped queue degrades workflow');
select is(pg_temp.workflow_health() ->> 'status',
  'failing','A successful sweep cannot mask disabled delivery with eligible work');
select is(pg_temp.workflow_health() #>> '{managerDigest,missedDueRecipientCount}',
  '0','A current open queue is not overdue during the configured send hour');
insert into public.refund_cases(
  id,public_reference,reporting_machine_id,reporting_location_id,
  customer_email,issue_summary,incident_at,payment_method,
  payment_amount_cents,card_last4,status,automation_state,
  deterministic_fact_version,created_at
) values ('14305000-0000-4000-8000-000000000004','RF-HOUR-HEALTH-4',
  '14303000-0000-4000-8000-000000000001',
  '14302000-0000-4000-8000-000000000001',
  'hour-customer@example.invalid','During-hour synthetic complaint',
  now(),'card',1025,'4242','needs_review','under_review',1,now());
select is(pg_temp.workflow_health(true,true,
    pg_temp.digest_window_at(8)+interval '15 minutes')
  #>> '{managerDigest,openRecipientCount}', '1',
  'A second observation sees the additional open case in the same hour');
select is((select cardinality(case_ids)::text
    from public.refund_manager_digest_due_observations
    where manager_user_id='14300000-0000-4000-8000-000000000001'),
  '2','Repeated due-hour observations retain earlier cases and add later ones');
create temporary table workflow_incident_first as
select public.service_claim_refund_automation_health_notification(
  'workflow_degraded') as value;
select is((select value ->> 'alertKind' from workflow_incident_first),
  'workflow_degraded','The existing incident ledger names a workflow blocker truthfully');
select is((select incident_kind from public.refund_automation_alert_incidents
  where status='open'),'workflow_degraded',
  'The technical incident is durable in the shared scheduler incident table');
select is(public.service_claim_refund_automation_health_notification(
  'workflow_degraded') ->> 'notificationType','none',
  'Repeated healthy scheduler runs do not create duplicate technical alerts');
select is(pg_temp.workflow_health() #>> '{managerDigest,sentBatchCountToday}',
  '0','Digest eligibility does not increment sent batch count');

update public.refund_manager_digest_settings set delivery_enabled=true where singleton;
select is(pg_temp.workflow_health() ->> 'deliveryStatus',
  'healthy','Enabling the live delivery lane resolves the known blocker');
select is(public.service_claim_refund_automation_health_notification(
  'healthy') ->> 'notificationType','none',
  'One healthy observation begins the stable recovery window');
update public.refund_automation_alert_incidents
set healthy_since=now()-interval '61 minutes' where status='open';
select is(public.service_claim_refund_automation_health_notification(
  'healthy') ->> 'notificationType','recovery',
  'Verified stable resolution claims one recovery notification');
select is((select status from public.refund_automation_alert_incidents
  order by opened_at desc limit 1),'resolved',
  'The shared incident resolves after the obligation clears');
select is(pg_temp.workflow_health(true,true,pg_temp.digest_window_at(9))
  #>> '{managerDigest,missedDueRecipientCount}', '1',
  'A recipient observed eligible at 08:00 remains overdue after mid-day activation');
select is(pg_temp.workflow_health(true,true,pg_temp.digest_window_at(9))
  ->> 'workflowStatus', 'degraded',
  'A successful sweep does not clear a missed daily digest');
update public.refund_cases set refund_amount_cents=825
where id='14305000-0000-4000-8000-000000000001';
select is(pg_temp.workflow_health(true,true,pg_temp.digest_window_at(9))
  #>> '{managerDigest,missedDueRecipientCount}', '1',
  'Changed content on the still-open observed case does not erase its missed batch');
update public.refund_cases set status='submitted'
where id='14305000-0000-4000-8000-000000000001';
select is(pg_temp.workflow_health(true,true,pg_temp.digest_window_at(9))
  #>> '{managerDigest,missedDueRecipientCount}', '1',
  'Changed status on the still-open observed case does not erase its missed batch');
insert into public.refund_cases(
  id,public_reference,reporting_machine_id,reporting_location_id,
  customer_email,issue_summary,incident_at,payment_method,
  payment_amount_cents,card_last4,status,automation_state,
  deterministic_fact_version,created_at
) values ('14305000-0000-4000-8000-000000000003','RF-EXTRA-HEALTH-3',
  '14303000-0000-4000-8000-000000000001',
  '14302000-0000-4000-8000-000000000001',
  'added-customer@example.invalid','New synthetic complaint',
  now(),'card',925,'4242','needs_review','under_review',1,now());
select is(pg_temp.workflow_health(true,true,pg_temp.digest_window_at(9))
  #>> '{managerDigest,missedDueRecipientCount}', '1',
  'A newly added case cannot erase an older observed unsent obligation');

insert into public.refund_manager_digest_batches(
  manager_user_id,digest_local_date,digest_timezone,status,claim_token,
  mapping_fingerprint,recipient_fingerprint,item_count,provider_attempt_started_at
) values ('14300000-0000-4000-8000-000000000001',
  (pg_temp.digest_window_at(9) at time zone 'America/Los_Angeles')::date,
  'America/Los_Angeles','sent','14306000-0000-4000-8000-000000000001',
  repeat('a',64),repeat('b',64),2,pg_temp.digest_window_at(8));
select is(pg_temp.workflow_health(true,true,pg_temp.digest_window_at(9))
  ->> 'deliveryStatus', 'healthy',
  'Durable sent batch resolves the missed-digest delivery obligation');
select is(pg_temp.workflow_health(true,true,pg_temp.digest_window_at(9))
  #>> '{managerDigest,sentBatchCountToday}', '1',
  'Sent count comes from batch settlement rather than eligibility');

-- A distinct recipient had an observed case at 08:00, but that case closed.
-- A different case arriving after the window must not inherit its due claim.
insert into auth.users (
  instance_id,id,aud,role,email,encrypted_password,email_confirmed_at,
  raw_app_meta_data,raw_user_meta_data,created_at,updated_at
) values ('00000000-0000-0000-0000-000000000000',
  '14300000-0000-4000-8000-000000000004','authenticated','authenticated',
  'closed-observation-manager@example.invalid','',now(),'{}','{}',now(),now());
insert into public.reporting_machines(
  id,account_id,location_id,machine_label,refund_public_display_label
) values ('14303000-0000-4000-8000-000000000004',
  '14301000-0000-4000-8000-000000000001',
  '14302000-0000-4000-8000-000000000001',
  'Closed observation machine','Public observation machine');
insert into public.reporting_machine_refund_managers(
  id,reporting_machine_id,manager_user_id,manager_email,grant_reason
) values ('14304000-0000-4000-8000-000000000004',
  '14303000-0000-4000-8000-000000000004',
  '14300000-0000-4000-8000-000000000004',
  'closed-observation-manager@example.invalid','Synthetic due-change case');
insert into public.refund_cases(
  id,public_reference,reporting_machine_id,reporting_location_id,
  customer_email,issue_summary,incident_at,payment_method,
  payment_amount_cents,card_last4,status,automation_state,
  deterministic_fact_version,created_at
) values ('14305000-0000-4000-8000-000000000005','RF-OBSERVED-CLOSED-5',
  '14303000-0000-4000-8000-000000000004',
  '14302000-0000-4000-8000-000000000001',
  'observed-customer@example.invalid','Observed synthetic complaint',
  now()-interval '1 day','card',1025,'4242','needs_review','under_review',
  1,now()-interval '1 day');
select is(pg_temp.workflow_health(true,true,pg_temp.digest_window_at(8))
  #>> '{managerDigest,openRecipientCount}', '2',
  'Health records the second recipient during the actual digest hour');
update public.refund_cases set status='closed'
where id='14305000-0000-4000-8000-000000000005';
insert into public.refund_cases(
  id,public_reference,reporting_machine_id,reporting_location_id,
  customer_email,issue_summary,incident_at,payment_method,
  payment_amount_cents,card_last4,status,automation_state,
  deterministic_fact_version,created_at
) values ('14305000-0000-4000-8000-000000000006','RF-NEW-ONLY-6',
  '14303000-0000-4000-8000-000000000004',
  '14302000-0000-4000-8000-000000000001',
  'new-only-customer@example.invalid','New synthetic complaint',
  now(),'card',1125,'4242','needs_review','under_review',1,now());
select is(pg_temp.workflow_health(true,true,pg_temp.digest_window_at(9))
  #>> '{managerDigest,missedDueRecipientCount}', '0',
  'Closed observed IDs plus a new-only case do not create retroactive overdue work');

insert into auth.users (
  instance_id,id,aud,role,email,encrypted_password,email_confirmed_at,
  raw_app_meta_data,raw_user_meta_data,created_at,updated_at
) values ('00000000-0000-0000-0000-000000000000',
  '14300000-0000-4000-8000-000000000002','authenticated','authenticated',
  'late-manager@example.invalid','',now(),'{}','{}',now(),now()),
  ('00000000-0000-0000-0000-000000000000',
  '14300000-0000-4000-8000-000000000003','authenticated','authenticated',
  'new-case-manager@example.invalid','',now(),'{}','{}',now(),now());
insert into public.reporting_machine_refund_managers(
  id,reporting_machine_id,manager_user_id,manager_email,grant_reason
) values ('14304000-0000-4000-8000-000000000002',
  '14303000-0000-4000-8000-000000000001',
  '14300000-0000-4000-8000-000000000002',
  'late-manager@example.invalid','Added after the digest window');
select is(pg_temp.workflow_health(true,true,pg_temp.digest_window_at(9))
  #>> '{managerDigest,openRecipientCount}', '3',
  'A later co-manager has an open queue but no earlier due observation');
select is(pg_temp.workflow_health(true,true,pg_temp.digest_window_at(9))
  #>> '{managerDigest,missedDueRecipientCount}', '0',
  'A later co-manager mapping cannot fabricate an 08:00 missed batch');

insert into public.reporting_machines(
  id,account_id,location_id,machine_label,refund_public_display_label
) values ('14303000-0000-4000-8000-000000000002',
  '14301000-0000-4000-8000-000000000001',
  '14302000-0000-4000-8000-000000000001',
  'Late machine label','Late public machine');
insert into public.reporting_machine_refund_managers(
  id,reporting_machine_id,manager_user_id,manager_email,grant_reason
) values ('14304000-0000-4000-8000-000000000003',
  '14303000-0000-4000-8000-000000000002',
  '14300000-0000-4000-8000-000000000003',
  'new-case-manager@example.invalid','Synthetic late queue');
insert into public.refund_cases(
  id,public_reference,reporting_machine_id,reporting_location_id,
  customer_email,issue_summary,incident_at,payment_method,
  payment_amount_cents,card_last4,status,automation_state,
  deterministic_fact_version,created_at
) values ('14305000-0000-4000-8000-000000000002','RF-LATE-HEALTH-2',
  '14303000-0000-4000-8000-000000000002',
  '14302000-0000-4000-8000-000000000001',
  'late-customer@example.invalid','Late synthetic complaint',
  now(),'card',825,'4242','needs_review','under_review',1,now());
select is(pg_temp.workflow_health(true,true,pg_temp.digest_window_at(9))
  #>> '{managerDigest,openRecipientCount}', '4',
  'A case first appearing after the digest hour is visible in the live queue');
select is(pg_temp.workflow_health(true,true,pg_temp.digest_window_at(9))
  #>> '{managerDigest,missedDueRecipientCount}', '0',
  'A newly eligible case after the digest hour is not retroactively overdue');
select is(pg_temp.workflow_health(true,false,pg_temp.digest_window_at(9))
  ->> 'deliveryStatus',
  'healthy','A disabled empty ready-notice lane is not a false incident');
select is(pg_temp.workflow_health(false,true,pg_temp.digest_window_at(9))
  ->> 'workflowStatus',
  'degraded','Runtime-disabled digest with an open scoped queue is degraded');
select is(pg_temp.workflow_health(null,true,pg_temp.digest_window_at(9))
  ->> 'workflowStatus',
  'instrumentation_unavailable','Unknown runtime switch is unavailable, not disabled or healthy');
select is(pg_temp.workflow_health(true,true,pg_temp.digest_window_at(9))
  #>> '{dueWork,status}',
  'instrumentation_unavailable','General missed-due-work evidence is not fabricated');
select ok(pg_temp.workflow_health(true,true,pg_temp.digest_window_at(9))::text not like
  '%private-health-customer@example.invalid%',
  'Aggregate health has no customer address or complaint text');

set local role authenticated;
select throws_ok($$select public.service_get_refund_workflow_health(
  true,true,true,true,true,'{}'::text[])$$,'42501',null,
  'Browser clients cannot call service health with invented runtime flags');
reset role;

select * from finish();
rollback;
