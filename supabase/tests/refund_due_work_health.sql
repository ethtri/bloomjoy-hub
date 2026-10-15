-- Disposable synthetic database only. No provider, customer send or payment.
begin;
create extension if not exists pgtap with schema extensions;
set local search_path=public,extensions;
select no_plan();
alter table public.refund_case_messages disable trigger refund_completion_outbox_postcommit_wakeup;
alter table public.refund_case_messages disable trigger refund_gift_denial_postcommit_wakeup;
delete from public.refund_automation_scheduler_dispatches;
delete from public.refund_automation_actions;
delete from public.refund_automation_runs;

create function pg_temp.at_slot(n integer) returns timestamptz language sql stable as $$
 select date_trunc('hour',statement_timestamp())+interval '3 hours'+n*interval '30 minutes';
$$;
create function pg_temp.runtime() returns jsonb language sql immutable as $$
 select '{"automation":true,"contact":true,"manualOutbox":true,"paymentExecutor":true,"policyWindow":true}'::jsonb;
$$;
create function pg_temp.observe_slot(n integer,p_runtime jsonb default pg_temp.runtime(),p_trigger text default 'scheduled')
returns uuid language plpgsql as $$
declare slot timestamptz:=pg_temp.at_slot(n); runid uuid; snapshot jsonb; key text;
begin
 snapshot:=private.refund_current_work(slot);
 key:=case when p_trigger='scheduled' then 'scheduled:'||to_char(slot at time zone 'UTC','YYYYMMDD"T"HH24MI"Z"')
  else 'manual:due-health-'||n::text end;
 if p_trigger='scheduled' then
  insert into public.refund_automation_scheduler_dispatches(mode,bucket_at,run_key,status,dispatched_at)
   values('run',slot,key,'dispatched',slot);
 end if;
 insert into public.refund_automation_runs(run_key,trigger_source,scheduled_for,started_at,finished_at,status,work_observation)
 values(key,p_trigger,slot,slot,slot+interval '1 minute','succeeded',jsonb_build_object(
  'schemaVersion','refund_work_observation_v1','payloadRedacted',true,
  'before',jsonb_build_object('observedAt',slot,'runtime',p_runtime,'work',snapshot),
  'after',jsonb_build_object('observedAt',slot+interval '30 seconds','runtime',p_runtime,'work',snapshot))) returning id into runid;
 return runid;
end;
$$;
create function pg_temp.health() returns jsonb language sql stable as $$
 select public.service_get_refund_due_work_health(pg_temp.at_slot(20));
$$;

select is(private.refund_current_work(now())->>'status','available','Current selectors execute as a pure observation');
select is(pg_temp.health()->>'status','instrumentation_unavailable','Missing opportunity evidence cannot become an empty healthy queue');
select pg_temp.observe_slot(1);
select pg_temp.observe_slot(2);
select is(pg_temp.health()->>'status','healthy','Two complete empty normal opportunities prove healthy zero');

insert into public.customer_accounts(id,name,account_type)
 values('14310000-0000-4000-8000-000000000001','Due health fixture','internal');
insert into public.reporting_locations(id,account_id,name,timezone)
 values('14310000-0000-4000-8000-000000000002','14310000-0000-4000-8000-000000000001','Due health fixture','UTC');
insert into public.reporting_machines(id,account_id,location_id,machine_label,status,nayax_machine_id,nayax_account_key)
 values('14310000-0000-4000-8000-000000000003','14310000-0000-4000-8000-000000000001',
  '14310000-0000-4000-8000-000000000002','Due health fixture','active','due-health-machine','default');
insert into public.refund_cases(id,public_reference,reporting_machine_id,reporting_location_id,
 customer_email,issue_summary,incident_at,incident_timezone,incident_time_resolution,
 payment_method,payment_amount_cents,card_last4,status,correlation_status,correlation_source)
 values('14310000-0000-4000-8000-000000000010','RF-DUE-HEALTH',
  '14310000-0000-4000-8000-000000000003','14310000-0000-4000-8000-000000000002',
  'due-health-customer@example.invalid','Synthetic private complaint',now()-interval '1 day','UTC','exact',
  'card',700,'4242','needs_review','needs_nayax','nayax');
select is(pg_temp.health()->>'dueCount','1','Existing eligible unclaimed lookup is due');
select is(pg_temp.health()->>'overdueCount','0','New current work did not exist in previous empty opportunities');
select pg_temp.observe_slot(3);
select is(pg_temp.health()->>'overdueCount','0','One missed opportunity is not two');
select pg_temp.observe_slot(4,pg_temp.runtime(),'manual');
select is(pg_temp.health()->>'overdueCount','0','A manual invocation cannot fabricate a second normal opportunity');
select pg_temp.observe_slot(5);
select is(pg_temp.health()->>'status','degraded','Successful no-op sweeps cannot hide current due work');
select is(pg_temp.health()->>'overdueCount','1','Same current identity survived two real scheduled opportunities');
select is(pg_temp.health()#>>'{blockedWork,0,owner}','Agent','Stalled system execution routes to technical Agent, not Manager');
select is(pg_temp.health()#>>'{technicalOwner,availability}','unverified','A routing record is not proof of a running repair consumer');
select is(pg_temp.health()#>>'{technicalOwner,activity}',null,'Health does not claim repair is active');
select ok(pg_temp.health()::text !~ 'due-health-customer|private complaint|4242','Health contains no customer content, address or card detail');

create temp table protected_before as select
 (select count(*) from public.refund_case_messages) messages,
 (select count(*) from public.refund_case_nayax_refund_attempts) attempts,
 (select count(*) from public.refund_automation_actions) actions,
 (select md5(to_jsonb(c)::text) from public.refund_cases c where id='14310000-0000-4000-8000-000000000010') case_digest;
select pg_temp.health();
select ok((select messages=(select count(*) from public.refund_case_messages)
 and attempts=(select count(*) from public.refund_case_nayax_refund_attempts)
 and actions=(select count(*) from public.refund_automation_actions)
 and case_digest=(select md5(to_jsonb(c)::text) from public.refund_cases c where id='14310000-0000-4000-8000-000000000010')
 from protected_before),'Health read preserves case, claims, messages and payment attempts');

-- Harmless case touches and green heartbeats do not change current work.
update public.refund_cases set updated_at=statement_timestamp() where id='14310000-0000-4000-8000-000000000010';
select is(pg_temp.health()->>'overdueCount','1','Touching a case timestamp is not meaningful progress');
update public.refund_automation_runs set reason_counts='{"heartbeat":1}' where trigger_source='scheduled';
select is(pg_temp.health()->>'overdueCount','1','A heartbeat cannot clear an unmet current obligation');
select pg_temp.observe_slot(6,pg_temp.runtime()||'{"automation":false}');
select is(pg_temp.health()->>'disabledWorkerCount','1','Current required worker disabled with due work is explicit');
select is(pg_temp.health()->>'status','degraded','Disabled lane cannot disappear behind a successful run');

select pg_temp.observe_slot(7);
update public.refund_automation_runs set work_observation=null where scheduled_for=pg_temp.at_slot(7);
select is(pg_temp.health()->>'status','instrumentation_unavailable','Latest missing evidence is not skipped for older green observations');
update public.refund_automation_runs set work_observation=jsonb_build_object('schemaVersion','refund_work_observation_v1',
 'payloadRedacted',true,'before',jsonb_build_object('work',jsonb_build_object('status','available')))
 where scheduled_for=pg_temp.at_slot(7);
select is(pg_temp.health()->>'status','instrumentation_unavailable','Partial evidence cannot claim healthy work');

select pg_temp.observe_slot(8);
select pg_temp.observe_slot(9);
update public.refund_cases set card_last4='5252' where id='14310000-0000-4000-8000-000000000010';
select is(pg_temp.health()->>'overdueCount','0','Material new fact/version cannot be satisfied or stalled by old-version observations');

-- The actual writer accepts only scheduler-dispatched runs and never overwrites
-- a captured phase. It stores a boolean whitelist, even from a service caller.
insert into public.refund_automation_runs(id,run_key,trigger_source,scheduled_for)
 values('14310000-0000-4000-8000-000000000020','manual:writer-proof','manual',now());
select is(public.service_record_refund_work_observation('14310000-0000-4000-8000-000000000020','before',pg_temp.runtime())->>'recorded',
 'false','Manual writer call creates no opportunity evidence');
insert into public.refund_automation_scheduler_dispatches(mode,bucket_at,run_key,status)
 values('run',date_trunc('minute',now()),'scheduled:'||to_char(now() at time zone 'UTC','YYYYMMDD"T"HH24MI"Z"'),'dispatched');
insert into public.refund_automation_runs(id,run_key,trigger_source,scheduled_for)
 values('14310000-0000-4000-8000-000000000021','scheduled:'||to_char(now() at time zone 'UTC','YYYYMMDD"T"HH24MI"Z"'),
  'scheduled',date_trunc('minute',now()));
select is(public.service_record_refund_work_observation('14310000-0000-4000-8000-000000000021','before',
 pg_temp.runtime()||'{"secret":"not-to-store","recipient":"not-to-store"}')->>'recorded','true','Actual normal dispatched run records a current observation');
select ok((select work_observation::text !~ 'not-to-store|recipient|secret' from public.refund_automation_runs
 where id='14310000-0000-4000-8000-000000000021'),'Runtime whitelist excludes arbitrary secret or recipient fields');
select is(public.service_record_refund_work_observation('14310000-0000-4000-8000-000000000021','before',pg_temp.runtime())->>'recorded',
 'false','Replayed phase cannot erase original opportunity evidence');
select is(public.service_record_refund_work_observation('14310000-0000-4000-8000-000000000021','after',pg_temp.runtime())->>'recorded',
 'true','Actual after observation is captured before finalization');
select is(public.service_finish_refund_automation_run('14310000-0000-4000-8000-000000000021',
 'succeeded',0,0,0,0,0,'{}',null,'not_needed'),true,'Existing run finalization is preserved');
select is((select work_observation#>>'{healthSummary,schemaVersion}' from public.refund_automation_runs
 where id='14310000-0000-4000-8000-000000000021'),'refund_due_work_health_v1',
 'Finalized run retains verified server-produced summary in the same observation column');
select is(private.refund_observed_work_health(statement_timestamp(),90)->>'source','verified_scheduled_run',
 'Existing health API can consume fresh server evidence without global human-context recomputation');
select set_config('request.jwt.claim.sub','14310000-0000-4000-8000-000000000099',true);
select is(private.refund_current_work(now())->>'reason','server_observation_context_required',
 'Human actor context is not silently promoted into service observation authority');
select is(private.refund_observed_work_health(statement_timestamp(),90)->>'source','verified_scheduled_run',
 'The same verified aggregate remains readable under the existing authorized wrapper context');
select set_config('request.jwt.claim.sub','',true);
update public.refund_automation_runs set work_observation=jsonb_set(work_observation,
 '{healthSummary,observedAt}',to_jsonb(statement_timestamp()-interval '2 hours'))
 where id='14310000-0000-4000-8000-000000000021';
select is(private.refund_observed_work_health(statement_timestamp(),90)->>'reason','verified_server_summary_stale',
 'Stale server evidence is explicitly unavailable, never current healthy zero');
select is(has_function_privilege('anon','public.service_get_refund_due_work_health(timestamptz)','EXECUTE'),false,'Anonymous callers cannot read health');
select is(has_function_privilege('authenticated','public.service_record_refund_work_observation(uuid,text,jsonb)','EXECUTE'),false,'App users cannot fabricate observations');
select is(has_function_privilege('service_role','public.service_get_refund_due_work_health(timestamptz)','EXECUTE'),true,'Existing service can read pure health');

-- Record actual isolated query overhead at a representative 25-case batch.
-- This is evidence, not a new production execution or business eligibility gate.
insert into public.refund_cases(id,public_reference,reporting_machine_id,reporting_location_id,
 customer_email,issue_summary,incident_at,incident_timezone,incident_time_resolution,
 payment_method,payment_amount_cents,card_last4,status,correlation_status,correlation_source)
 select gen_random_uuid(),'RF-DUE-BATCH-'||n,
  '14310000-0000-4000-8000-000000000003','14310000-0000-4000-8000-000000000002',
  'synthetic-'||n||'@example.invalid','Synthetic load',now()-interval '1 day','UTC','exact',
  'card',700,'4242','needs_review','needs_nayax','nayax' from generate_series(1,24)n;
do $$ declare started timestamptz:=clock_timestamp(); snapshot jsonb; begin
 snapshot:=private.refund_current_work(statement_timestamp());
 raise notice 'due-work observation timing: 25 synthetic active cases, % ms, % items, status %',
  round(extract(epoch from (clock_timestamp()-started))*1000,2),jsonb_array_length(snapshot->'items'),snapshot->>'status';
end $$;

insert into public.refund_gift_card_pools(id,provider,provider_account_id,face_value_cents,
 eligible_machine_ids,eligible_locations,expires_at,enabled,redemption_instructions)
 values('14310000-0000-4000-8000-000000000030','kemore','due-health-fixture',1500,
 array['14310000-0000-4000-8000-000000000003']::uuid[],array['Due health fixture'],
 now()+interval '30 days',true,'Synthetic terms');
insert into public.refund_cases(id,public_reference,reporting_machine_id,reporting_location_id,
 customer_email,issue_summary,issue_category,incident_at,payment_method,payment_amount_cents,
 resolution_method,gift_card_pool_id,gift_card_value_cents,gift_card_expires_at,gift_card_state)
 values('14310000-0000-4000-8000-000000000031','RF-DUE-DECISION',
 '14310000-0000-4000-8000-000000000003','14310000-0000-4000-8000-000000000002',
 'decision-wait@example.invalid','Synthetic partial order','partial_items',now(),'cash',1100,
 'gift_card','14310000-0000-4000-8000-000000000030',1500,now()+interval '29 days','manager_review');
select pg_temp.observe_slot(10);
select pg_temp.observe_slot(11);
select is(pg_temp.health()->>'awaitingDecisionCount','1','Canonical Manager decision count is separate from System failure');
select is(pg_temp.health()->>'overdueCount','25','Old decision wait adds no automatic-work overdue item');
select is(pg_temp.health()->>'decisionClockBasis','recorded_attention_clock',
 'Decision age uses its recorded clock instead of inferring age from intake or a heartbeat');
select is((select count(*) from public.refund_gift_card_issuances where refund_case_id='14310000-0000-4000-8000-000000000031'),
 0::bigint,'Health never issues a gift card or records a Manager decision');

update public.refund_customer_contact_settings set automatic_customer_contact_enabled=true where singleton;
-- An actual delivered current question is a valid wait; its future single
-- reminder is not a missed opportunity. Closing the case removes the source.
insert into public.refund_cases(id,public_reference,reporting_machine_id,reporting_location_id,
 customer_email,issue_summary,incident_at,payment_method,payment_amount_cents,card_last4,status)
 values('14310000-0000-4000-8000-000000000050','RF-DUE-WAIT',
 '14310000-0000-4000-8000-000000000003','14310000-0000-4000-8000-000000000002',
 'wait-fixture@example.invalid','Synthetic question',now(),'card',null,'4242','waiting_on_customer');
insert into public.refund_follow_up_cycles(id,refund_case_id,cycle_number,trigger_fingerprint,reason_code,
 requested_fields,template_version,case_fact_version,reminder_delay_hours,status)
 select '14310000-0000-4000-8000-000000000051',id,1,repeat('1',64),'missing_information',
 public.refund_missing_follow_up_fields(id),'refund_follow_up_v1',deterministic_fact_version,168,'claimed'
 from public.refund_cases where id='14310000-0000-4000-8000-000000000050';
insert into public.refund_case_messages(id,refund_case_id,follow_up_cycle_id,message_type,status,
 recipient_email,subject,body,template_version,reason_code,requested_fields,sent_at,delivery_state,
 delivery_transport,provider_message_id,content_source,delivery_kind)
 values('14310000-0000-4000-8000-000000000052','14310000-0000-4000-8000-000000000050',
 '14310000-0000-4000-8000-000000000051','more_info','sent','wait-fixture@example.invalid',
 'Synthetic question','Synthetic question','refund_follow_up_v1','missing_information',
 public.refund_missing_follow_up_fields('14310000-0000-4000-8000-000000000050'),
 now(),'delivered','resend','synthetic-delivery-health','deterministic_template','automatic');
select ok((select status='waiting' and request_message_id='14310000-0000-4000-8000-000000000052'
 and request_sent_at is not null and reminder_due_at>now()+interval '6 days'
 from public.refund_follow_up_cycles where id='14310000-0000-4000-8000-000000000051'),
 'Actual sent-message synchronization binds the immutable request and future reminder clock');
select is(pg_temp.health()->>'futureRetryCount','1','Future existing follow-up remains a wait');
select is(pg_temp.health()->>'overdueCount','25','A future reminder adds no overdue processing work');
select pg_temp.observe_slot(400,pg_temp.runtime()||'{"policyWindow":false}');
select pg_temp.observe_slot(401,pg_temp.runtime()||'{"policyWindow":false}');
select is(public.service_get_refund_due_work_health(pg_temp.at_slot(402))->>'policyWaitCount','1',
 'An actual due question reminder outside its contact window is a policy wait');
select is(public.service_get_refund_due_work_health(pg_temp.at_slot(402))->>'disabledWorkerCount','0',
 'The legitimate policy wait does not imply a disabled contact worker');
select is(public.service_get_refund_due_work_health(pg_temp.at_slot(402))->>'overdueCount','25',
 'Two outside-window opportunities cannot age the question reminder into stalled work');
update public.refund_cases set status='closed' where id='14310000-0000-4000-8000-000000000050';
select is(pg_temp.health()->>'futureRetryCount','0','Closing the real current cycle source stops its due/wait observation');

insert into auth.users(id,email) values('14310000-0000-4000-8000-000000000060','synthetic-author@example.invalid');
insert into public.refund_case_messages(id,refund_case_id,message_type,status,recipient_email,subject,body,
 created_by,content_source,delivery_kind,reason_code,requested_fields,manual_delivery_intent_id,manual_delivery_state,
 manual_delivery_expected_case_version,manual_delivery_provider_attempted_at,manual_delivery_attempt_count)
 select '14310000-0000-4000-8000-000000000061',id,'more_info','failed',customer_email,'Synthetic unknown','Synthetic unknown',
 '14310000-0000-4000-8000-000000000060','manager_authored','manual','missing_information',
 public.refund_missing_follow_up_fields(id),
 '14310000-0000-4000-8000-000000000062','delivery_unknown',official_action_version,now(),1
 from public.refund_cases where id='14310000-0000-4000-8000-000000000050';
select is(pg_temp.health()->>'unknownHoldCount','1','Actual provider-started unknown intent remains a hold, not eligible resend');
select is(pg_temp.health()->>'overdueCount','25','Unknown contact does not accrue a missed-send opportunity');
insert into public.refund_cases(id,public_reference,reporting_machine_id,reporting_location_id,
 customer_email,issue_summary,incident_at,payment_method,payment_amount_cents,card_last4,status,
 nayax_lookup_status,nayax_lookup_generation,nayax_lookup_started_at)
 values('14310000-0000-4000-8000-000000000070','RF-DUE-CLAIM',
 '14310000-0000-4000-8000-000000000003','14310000-0000-4000-8000-000000000002',
 'claim-fixture@example.invalid','Synthetic interrupted read',now(),'card',700,'4242','needs_review','checking',1,null);
select is((select item->>'state' from jsonb_array_elements(private.refund_current_work(now())->'items') item
 where item->>'action'='recover_interrupted_lookup'),'blocked','A NULL lookup claim clock is not an indefinitely active worker');
update public.refund_cases set nayax_lookup_started_at=now() where id='14310000-0000-4000-8000-000000000070';
select is((select item->>'state' from jsonb_array_elements(private.refund_current_work(now())->'items') item
 where item->>'action'='recover_interrupted_lookup'),'active_claim','A real unexpired lookup lease remains a wait');
update public.refund_cases set nayax_lookup_started_at=now()-interval '3 minutes' where id='14310000-0000-4000-8000-000000000070';
select is((select item->>'state' from jsonb_array_elements(private.refund_current_work(now())->'items') item
 where item->>'action'='recover_interrupted_lookup'),'due','Existing90-second interrupted read recovery is due without attempting a provider request');

-- A real known-failed denial stays open even though the decision is final.
insert into public.reporting_machine_refund_managers(reporting_machine_id,manager_user_id,manager_email,grant_reason)
 values('14310000-0000-4000-8000-000000000003','14310000-0000-4000-8000-000000000060',
 'synthetic-author@example.invalid','Synthetic due-work review');
select set_config('request.jwt.claim.sub','14310000-0000-4000-8000-000000000060',true);
select public.admin_decide_refund_gift_card('14310000-0000-4000-8000-000000000031',false,'Synthetic reviewed explanation.');
select set_config('request.jwt.claim.sub','',true);
do $$ declare notice uuid; claim record; begin
 select id into strict notice from public.refund_case_messages
  where refund_case_id='14310000-0000-4000-8000-000000000031' and gift_denial_source_message_id is null;
 for attempt in 1..3 loop
  select * into strict claim from public.service_claim_refund_manual_message_deliveries(notice,1);
  perform public.service_finish_refund_manual_message_delivery(claim.refund_case_message_id,claim.claim_token,
   'failed',null,'synthetic_preprovider_failure',0,null);
 end loop;
end $$;
select is(public.refund_lifecycle_contract('14310000-0000-4000-8000-000000000031')#>>'{nextWork,isOpen}','true',
 'The actual exhausted failed denial remains canonically open after its final decision');
select is(public.service_get_refund_due_work_health(now())->>'manualContactRecoveryCount','1',
 'Supported failed-denial human recovery is visible independently from fresh automatic work');
select set_config('request.jwt.claim.sub','14310000-0000-4000-8000-000000000060',true);
select public.admin_retry_refund_gift_denial_notice('14310000-0000-4000-8000-000000000031',
 '14310000-0000-4000-8000-000000000080');
select set_config('request.jwt.claim.sub','',true);
select is(public.service_get_refund_due_work_health(now())->>'manualContactRecoveryCount','0',
 'A recognized current child queued for recovery stops the old human-recovery classification');
select public.service_bind_refund_transactional_delivery((select id from public.refund_case_messages
 where manual_delivery_intent_id='14310000-0000-4000-8000-000000000080'),'synthetic-due-child-accepted',now());
select count(*) from public.service_claim_refund_manual_message_deliveries((select id from public.refund_case_messages
 where manual_delivery_intent_id='14310000-0000-4000-8000-000000000080'),1);
select is(public.refund_lifecycle_contract('14310000-0000-4000-8000-000000000031')#>>'{nextWork,isOpen}','false',
 'Known accepted current child resolves contact without repeating the saved decision');
select is(public.service_get_refund_due_work_health(now())->>'manualContactRecoveryCount','0',
 'A settled latest child cannot revive the older failed denial as pending recovery');

-- Candidate-heavy source enrichment, fixture setup only. Observe full snapshot
-- overhead before/after200 current candidates; do not infer production SLA.
do $$ declare started timestamptz:=clock_timestamp(); snapshot jsonb; begin
 snapshot:=private.refund_current_work(statement_timestamp());
 raise notice 'due-work full snapshot baseline: % ms, % items',
  round(extract(epoch from (clock_timestamp()-started))*1000,2),jsonb_array_length(snapshot->'items');
end $$;
update public.refund_cases set nayax_lookup_generation=1,nayax_lookup_status='multiple_matches',
 nayax_lookup_started_at=now()-interval '2 hours',nayax_lookup_finished_at=now()-interval '1 hour',
 nayax_lookup_correlation_digest=repeat('a',64),nayax_recommendation_policy_version='synthetic-health-benchmark-v1',
 nayax_recommendation_state='ambiguous',correlation_status='manual_review'
 where id='14310000-0000-4000-8000-000000000010';
insert into public.refund_nayax_lookup_candidates(token,refund_case_id,reporting_machine_id,lookup_generation,
 provider_transaction_id,machine_authorization_time,amount_cents,card_last4,currency_code,expires_at)
 select gen_random_uuid(),'14310000-0000-4000-8000-000000000010','14310000-0000-4000-8000-000000000003',1,
 'SYNTHETIC-HEALTH-CANDIDATE-'||n,now()-interval '1 day',700,'5252','USD',now()+interval '1 day'
 from generate_series(1,200)n;
select is((select count(*) from public.refund_nayax_lookup_candidates
 where refund_case_id='14310000-0000-4000-8000-000000000010' and lookup_generation=1),200::bigint,
 'Performance observation actually includes200 current synthetic candidates');
do $$ declare started timestamptz:=clock_timestamp(); snapshot jsonb; begin
 snapshot:=private.refund_current_work(statement_timestamp());
 raise notice 'due-work full snapshot with200 current candidates: % ms, % items, status %',
  round(extract(epoch from (clock_timestamp()-started))*1000,2),jsonb_array_length(snapshot->'items'),snapshot->>'status';
end $$;
select * from finish();
rollback;
