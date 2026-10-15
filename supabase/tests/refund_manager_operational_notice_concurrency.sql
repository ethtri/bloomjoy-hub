-- Disposable database only: actual sessions/RPCs, no transport or mail calls.
create extension if not exists pgtap with schema extensions;
create extension if not exists dblink with schema extensions;
set search_path=public,extensions;
select dblink_connect('operational_notice_a','host=db port='||current_setting('port')||
 ' dbname='||current_database()||' user=postgres password=postgres sslmode=disable application_name=operational_notice_a');
select dblink_connect('operational_notice_b','host=db port='||current_setting('port')||
 ' dbname='||current_database()||' user=postgres password=postgres sslmode=disable application_name=operational_notice_b');
begin;
alter table public.refund_cases disable trigger refund_manager_ready_case_postcommit_wakeup;
alter table public.refund_case_messages disable trigger refund_completion_outbox_postcommit_wakeup;
alter table public.refund_case_messages disable trigger refund_gift_denial_postcommit_wakeup;
create schema operational_notice_race_test;
create table operational_notice_race_test.results(lane text primary key,payload jsonb);
create table operational_notice_race_test.settings as
 select to_jsonb(s) personal,(select to_jsonb(r) from public.refund_manager_ready_notice_settings r where singleton) ready
 from private.email_alert_delivery_settings s where singleton;
update private.email_alert_delivery_settings set delivery_enabled=true,activated_at=statement_timestamp();
-- Adoption deliberately supersedes this legacy flag; it is not a second gate.
update public.refund_manager_ready_notice_settings set delivery_enabled=false where singleton;
insert into auth.users(id,email,email_confirmed_at) values
 ('ff110000-0000-4000-8000-000000000001','operational-race-manager@example.invalid',now()),
 ('ff110000-0000-4000-8000-000000000002','operational-race-replacement@example.invalid',now());
insert into public.customer_accounts(id,name,account_type)
 values('ff120000-0000-4000-8000-000000000001','Operational notice race','internal');
insert into public.reporting_locations(id,account_id,name,timezone)
 values('ff130000-0000-4000-8000-000000000001','ff120000-0000-4000-8000-000000000001','Operational race','UTC');
insert into public.reporting_machines(id,account_id,location_id,machine_label,status)
 values('ff140000-0000-4000-8000-000000000001','ff120000-0000-4000-8000-000000000001',
 'ff130000-0000-4000-8000-000000000001','Operational race','active');
insert into public.reporting_machine_refund_managers(reporting_machine_id,manager_user_id,manager_email,grant_reason)
 values('ff140000-0000-4000-8000-000000000001','ff110000-0000-4000-8000-000000000001',
 'operational-race-manager@example.invalid','Synthetic concurrency');
insert into public.email_alert_profiles(user_id,timezone,quiet_enabled)
 select id,'UTC',false from auth.users where id in
 ('ff110000-0000-4000-8000-000000000001','ff110000-0000-4000-8000-000000000002');
insert into public.email_alert_preferences(user_id,alert_id,enabled,scope_mode,machine_ids)
 values('ff110000-0000-4000-8000-000000000001','decision-ready',false,'selected','{}'::uuid[]);
insert into public.refund_gift_card_pools(id,provider,provider_account_id,face_value_cents,
 eligible_machine_ids,eligible_locations,expires_at,enabled,redemption_instructions)
 values('ff150000-0000-4000-8000-000000000001','kemore','operational-race-fixture',1500,
 array['ff140000-0000-4000-8000-000000000001']::uuid[],array['Operational race'],
 now()+interval '30 days',true,'Synthetic terms');
insert into public.refund_cases(id,public_reference,reporting_machine_id,reporting_location_id,
 customer_email,issue_summary,issue_category,incident_at,payment_method,payment_amount_cents,refund_amount_cents,
 resolution_method,gift_card_pool_id,gift_card_value_cents,gift_card_expires_at,gift_card_state)
 select ('ff160000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid,'RF-OPERATIONAL-RACE-'||n,
 'ff140000-0000-4000-8000-000000000001','ff130000-0000-4000-8000-000000000001',
 'operational-customer-'||n||'@example.invalid','Synthetic partial order','partial_items',now(),'cash',1100,1100,
 'gift_card','ff150000-0000-4000-8000-000000000001',1500,
 (select expires_at from public.refund_gift_card_pools where id='ff150000-0000-4000-8000-000000000001'),
 'pending_inventory' from generate_series(1,4)n;
create function operational_notice_race_test.wait_for_lock() returns boolean language plpgsql as $$
begin
 for i in 1..100 loop
  perform pg_stat_clear_snapshot();
  if exists(select 1 from pg_stat_activity where application_name='operational_notice_b' and wait_event_type='Lock') then return true; end if;
  perform pg_sleep(0.01);
 end loop;
 return false;
end $$;
create function operational_notice_race_test.enqueue(p_case uuid,p_due boolean default false)
returns jsonb language plpgsql as $$
declare observed timestamptz;
begin
 if p_due then
  select settled_at+interval '7 days' into strict observed from public.refund_manager_notification_actions
   where refund_case_id=p_case and notice_reason='decision_ready' and ready_notice_stage='initial' and delivery_state='sent';
 else observed:=statement_timestamp(); end if;
 return public.service_enqueue_refund_manager_ready_notices(p_case,observed);
exception when others then return jsonb_build_object('qa_error',sqlerrm,'sqlstate',sqlstate);
end $$;
create function operational_notice_race_test.claim(p_case uuid,p_due boolean default false)
returns jsonb language plpgsql as $$
declare observed timestamptz;
begin
 if p_due then
  select settled_at+interval '7 days' into strict observed from public.refund_manager_notification_actions
   where refund_case_id=p_case and notice_reason='decision_ready' and ready_notice_stage='initial' and delivery_state='sent';
 else observed:=statement_timestamp(); end if;
 return public.service_claim_next_refund_manager_ready_notice(p_case,observed);
exception when others then return jsonb_build_object('qa_error',sqlerrm,'sqlstate',sqlstate);
end $$;
create function operational_notice_race_test.start_provider(p_lane text)
returns boolean language plpgsql as $$
declare c jsonb;
begin
 select payload into strict c from operational_notice_race_test.results where lane=p_lane;
 return public.service_mark_refund_manager_ready_notice_provider_started(
  (c->>'intentId')::uuid,(c->>'claimToken')::uuid,c->>'routeFingerprint',c->>'recipient');
end $$;
commit;
select no_plan();
select is((select count(*) from public.refund_cases where public_reference like 'RF-OPERATIONAL-RACE-%'
 and gift_card_state='manager_review'),4::bigint,'Real partial-order fixtures require the existing Manager decision');
select dblink_exec('operational_notice_a','begin');
insert into operational_notice_race_test.results select 'initial_producer_a',p from dblink('operational_notice_a',
 $$select operational_notice_race_test.enqueue('ff160000-0000-4000-8000-000000000001')$$) r(p jsonb);
select dblink_send_query('operational_notice_b',
 $$select operational_notice_race_test.enqueue('ff160000-0000-4000-8000-000000000001')$$);
select ok(operational_notice_race_test.wait_for_lock(),'Concurrent initial producers serialize on the same case');
select dblink_exec('operational_notice_a','commit');
insert into operational_notice_race_test.results select 'initial_producer_b',p from dblink_get_result('operational_notice_b') r(p jsonb);
select * from dblink_get_result('operational_notice_b') r(p jsonb);
select is((select count(*) from public.refund_manager_notification_actions where refund_case_id='ff160000-0000-4000-8000-000000000001'
 and notice_reason='decision_ready' and ready_notice_stage='initial'),1::bigint,'Competing producers create one initial notice despite saved opt-out');
select dblink_exec('operational_notice_a','begin');
insert into operational_notice_race_test.results select 'initial_claim',p from dblink('operational_notice_a',
 $$select operational_notice_race_test.claim('ff160000-0000-4000-8000-000000000001')$$) r(p jsonb);
insert into operational_notice_race_test.results select 'initial_competing_claim',p from dblink('operational_notice_b',
 $$select operational_notice_race_test.claim('ff160000-0000-4000-8000-000000000001')$$) r(p jsonb);
select is((select payload->>'claimed' from operational_notice_race_test.results where lane='initial_claim'),'true','One initial worker reserves the notice');
select is((select payload->>'claimed' from operational_notice_race_test.results where lane='initial_competing_claim'),'false','Another worker cannot reserve that initial notice concurrently');
select dblink_exec('operational_notice_a','commit');
select ok(operational_notice_race_test.start_provider('initial_claim'),'Initial send crosses the actual current-authority provider boundary');
select ok((select public.service_complete_refund_manager_ready_notice((payload->>'intentId')::uuid,(payload->>'claimToken')::uuid,'sent','synthetic-operational-initial')
 from operational_notice_race_test.results where lane='initial_claim'),'Initial accepted receipt is settled through the real RPC');
create temporary table operational_initial_anchor as select settled_at from public.refund_manager_notification_actions
 where id=(select (payload->>'intentId')::uuid from operational_notice_race_test.results where lane='initial_claim');
-- Derive the next local weekday at the real successful send's wall-clock time.
-- Explicit UTC matches this recipient's saved timezone, independent of runner TZ.
create temporary table operational_initial_deadline as
 select min(((settled_at at time zone 'UTC')+make_interval(days=>n)) at time zone 'UTC') due_at
 from operational_initial_anchor cross join generate_series(1,3) n
 where extract(isodow from (settled_at at time zone 'UTC')+make_interval(days=>n)) between 1 and 5;
select is((select public.service_refund_business_days_elapsed(settled_at,due_at-interval '1 microsecond','UTC')
 from operational_initial_anchor cross join operational_initial_deadline),0,
 'The real initial-send clock has not reached one business day just before its next-weekday anniversary');
select is((select public.service_refund_business_days_elapsed(settled_at,due_at,'UTC')
 from operational_initial_anchor cross join operational_initial_deadline),1,
 'The real initial-send clock reaches one business day exactly at its next-weekday anniversary');
select is(public.service_refund_business_days_elapsed('2026-10-16T10:00Z','2026-10-19T09:59:59.999999Z','UTC'),0,
 'Friday initial send does not mature during the weekend or before the Monday anniversary');
select is(public.service_refund_business_days_elapsed('2026-10-16T10:00Z','2026-10-19T10:00Z','UTC'),1,
 'Friday initial send matures on Monday at the same local time');
select is((select public.service_complete_refund_manager_ready_notice((payload->>'intentId')::uuid,(payload->>'claimToken')::uuid,
 'sent','synthetic-operational-replay') from operational_notice_race_test.results where lane='initial_claim'),
 false,'A repeated successful settlement cannot restart an already-sent initial notice');
select is((select settled_at from public.refund_manager_notification_actions where id=(select (payload->>'intentId')::uuid
 from operational_notice_race_test.results where lane='initial_claim')),(select settled_at from operational_initial_anchor),
 'Supported settlement replay preserves the original reminder deadline anchor');
update private.email_alert_delivery_settings set delivery_enabled=false where singleton;
select is(operational_notice_race_test.enqueue('ff160000-0000-4000-8000-000000000001',true)->>'queuedCount',
 '0','The adopted master-disable prevents both initial and due-reminder enqueue');
select is((select count(*) from public.refund_manager_notification_actions where refund_case_id='ff160000-0000-4000-8000-000000000001'),
 1::bigint,'Disabled enqueue has no notice-row side effects');
select is(operational_notice_race_test.claim('ff160000-0000-4000-8000-000000000001',true)->>'claimed',
 'false','The adopted disabled lane cannot claim queued work');
update private.email_alert_delivery_settings set delivery_enabled=true where singleton;
select dblink_exec('operational_notice_a','begin');
insert into operational_notice_race_test.results select 'reminder_producer_a',p from dblink('operational_notice_a',
 $$select operational_notice_race_test.enqueue('ff160000-0000-4000-8000-000000000001',true)$$) r(p jsonb);
select dblink_send_query('operational_notice_b',
 $$select operational_notice_race_test.enqueue('ff160000-0000-4000-8000-000000000001',true)$$);
select ok(operational_notice_race_test.wait_for_lock(),'Concurrent due-reminder producers serialize on the same case');
select dblink_exec('operational_notice_a','commit');
insert into operational_notice_race_test.results select 'reminder_producer_b',p from dblink_get_result('operational_notice_b') r(p jsonb);
select * from dblink_get_result('operational_notice_b') r(p jsonb);
select is((select count(*) from public.refund_manager_notification_actions where refund_case_id='ff160000-0000-4000-8000-000000000001'
 and notice_reason='decision_ready' and ready_notice_stage='reminder'),1::bigint,'Concurrent due scans create exactly one reminder');
select is((select settled_at from public.refund_manager_notification_actions where id=(select (payload->>'intentId')::uuid
 from operational_notice_race_test.results where lane='initial_claim')),(select settled_at from operational_initial_anchor),
 'Duplicate scans never restart the first successful initial-send clock');
select dblink_exec('operational_notice_a','begin');
insert into operational_notice_race_test.results select 'reminder_claim',p from dblink('operational_notice_a',
 $$select operational_notice_race_test.claim('ff160000-0000-4000-8000-000000000001',true)$$) r(p jsonb);
insert into operational_notice_race_test.results select 'reminder_competing_claim',p from dblink('operational_notice_b',
 $$select operational_notice_race_test.claim('ff160000-0000-4000-8000-000000000001',true)$$) r(p jsonb);
select is((select payload->>'noticeStage' from operational_notice_race_test.results where lane='reminder_claim'),'reminder','The due claim preserves its reminder identity');
select is((select payload->>'claimed' from operational_notice_race_test.results where lane='reminder_competing_claim'),'false','A second worker cannot reserve that reminder concurrently');
select dblink_exec('operational_notice_a','commit');
select is((select private.refund_ready_stage_allowed((payload->>'intentId')::uuid,
 (select due_at-interval '1 microsecond' from operational_initial_deadline))
 from operational_notice_race_test.results where lane='reminder_claim'),false,
 'A reserved reminder is blocked just before the actual next-business-day deadline');
select ok((select private.refund_ready_stage_allowed((payload->>'intentId')::uuid,
 (select due_at from operational_initial_deadline))
 from operational_notice_race_test.results where lane='reminder_claim'),
 'The same reserved reminder becomes eligible exactly at the next-business-day deadline');
select ok((select private.refund_ready_stage_allowed((payload->>'intentId')::uuid,
 (select settled_at+interval '7 days' from operational_initial_anchor))
 from operational_notice_race_test.results where lane='reminder_claim'),
 'The claimed reminder is eligible at the explicit synthetic future observation');
select is(operational_notice_race_test.start_provider('reminder_claim'),false,
 'A future-observed reminder cannot cross the real provider boundary before its actual deadline');
select set_config('request.jwt.claims','{"role":"authenticated","sub":"ff110000-0000-4000-8000-000000000001"}',false);
select public.admin_decide_refund_gift_card('ff160000-0000-4000-8000-000000000001',false,'Synthetic reviewed customer explanation.');
select ok(public.service_refund_manager_ready_notice_snapshot('ff160000-0000-4000-8000-000000000001',
 'ff110000-0000-4000-8000-000000000001',(select settled_at+interval '7 days' from operational_initial_anchor)) is null,
 'Resolution removes the reminder snapshot even at the otherwise-eligible future observation');
select is(operational_notice_race_test.start_provider('reminder_claim'),false,'A resolved reminder retains no provider access');
select ok((select provider_attempt_started_at is null from public.refund_manager_notification_actions where id=
 (select (payload->>'intentId')::uuid from operational_notice_race_test.results where lane='reminder_claim')),'Cancelled reminder never records provider access');
select operational_notice_race_test.enqueue('ff160000-0000-4000-8000-000000000001');
select is((select count(*) from public.refund_manager_notification_actions where refund_case_id='ff160000-0000-4000-8000-000000000001'
 and notice_reason='decision_ready'),2::bigint,'Queued customer contact after denial does not revive a decision alert');

select operational_notice_race_test.enqueue('ff160000-0000-4000-8000-000000000002');
insert into operational_notice_race_test.results select 'unknown_initial',operational_notice_race_test.claim('ff160000-0000-4000-8000-000000000002');
select ok(operational_notice_race_test.start_provider('unknown_initial'),'Second fixture reaches durable provider-start evidence');
select ok((select public.service_complete_refund_manager_ready_notice((payload->>'intentId')::uuid,(payload->>'claimToken')::uuid,'delivery_unknown',null)
 from operational_notice_race_test.results where lane='unknown_initial'),'Uncertain send is retained through the canonical settlement RPC');
select public.service_enqueue_refund_manager_ready_notices('ff160000-0000-4000-8000-000000000002',statement_timestamp()+interval '14 days');
select is((select count(*) from public.refund_manager_notification_actions where refund_case_id='ff160000-0000-4000-8000-000000000002'
 and notice_reason='decision_ready'),1::bigint,'A reminder cannot bypass unknown initial delivery with another intent');
select is(public.service_claim_next_refund_manager_ready_notice('ff160000-0000-4000-8000-000000000002',statement_timestamp()+interval '14 days')->>'claimed',
 'false','Expired worker claims do not permit a blind resend of unknown delivery');

-- Exercise the real exhausted-preprovider recovery path, then cancel its initial
-- operational alert by queueing the supported linked retry. No synthetic future
-- clock is involved in this provider-boundary cancellation proof.
select public.admin_decide_refund_gift_card('ff160000-0000-4000-8000-000000000004',false,'Synthetic saved customer explanation.');
do $$ declare notice_id uuid; claimed record;
begin
 select id into strict notice_id from public.refund_case_messages
  where refund_case_id='ff160000-0000-4000-8000-000000000004'
   and manual_delivery_intent_id=md5('gift-card-denial:ff160000-0000-4000-8000-000000000004')::uuid;
 for attempt in 1..3 loop
  select * into strict claimed from public.service_claim_refund_manual_message_deliveries(notice_id,1);
  perform public.service_finish_refund_manual_message_delivery(claimed.refund_case_message_id,claimed.claim_token,
   'failed',null,'synthetic_preprovider_failure',0,null);
 end loop;
end $$;
select is(public.get_refund_gift_card_case('ff160000-0000-4000-8000-000000000004')->>'can_retry_denial',
 'true','Three actual no-provider failures leave a supported operational recovery action');
select operational_notice_race_test.enqueue('ff160000-0000-4000-8000-000000000004');
insert into operational_notice_race_test.results select 'recovery_initial',operational_notice_race_test.claim('ff160000-0000-4000-8000-000000000004');
select is((select payload->'projection'->>'actionCode' from operational_notice_race_test.results where lane='recovery_initial'),
 'retry_customer_notice','Delivery recovery has its own actionable purpose instead of another decision');
select is((select payload->'projection'->>'evidenceBasis' from operational_notice_race_test.results where lane='recovery_initial'),
 'gift_denial_delivery_recovery','Recovery notice is bound to the recognized current failed attempt');
select public.admin_retry_refund_gift_denial_notice('ff160000-0000-4000-8000-000000000004',
 'ff170000-0000-4000-8000-000000000004');
select is(operational_notice_race_test.start_provider('recovery_initial'),false,
 'A supported retry queued after claim cancels the recovery alert at the actual provider boundary');
select ok((select provider_attempt_started_at is null from public.refund_manager_notification_actions where id=
 (select (payload->>'intentId')::uuid from operational_notice_race_test.results where lane='recovery_initial')),
 'Cancelled recovery alert has no provider-start marker');
select ok(public.service_refund_manager_ready_notice_snapshot('ff160000-0000-4000-8000-000000000004',
 'ff110000-0000-4000-8000-000000000001') is null,'Queued latest delivery attempt removes recovery readiness');
select operational_notice_race_test.enqueue('ff160000-0000-4000-8000-000000000004');
select is((select count(*) from public.refund_manager_notification_actions where refund_case_id='ff160000-0000-4000-8000-000000000004'
 and notice_reason='decision_ready'),1::bigint,'A queued linked retry creates no replacement initial or reminder alert');
select is((select count(*) from public.refund_case_events where refund_case_id='ff160000-0000-4000-8000-000000000004'
 and event_type='gift_card_exception_decided'),1::bigint,'Delivery recovery preserves exactly one committed business decision');
select ok((select manual_delivery_state='failed' and manual_delivery_attempt_count=3
 from public.refund_case_messages where refund_case_id='ff160000-0000-4000-8000-000000000004'
 and gift_denial_source_message_id is null),'Recovery preserves the original exhausted delivery evidence');

select operational_notice_race_test.enqueue('ff160000-0000-4000-8000-000000000003');
insert into operational_notice_race_test.results select 'revoked_claim',operational_notice_race_test.claim('ff160000-0000-4000-8000-000000000003');
update public.reporting_machine_refund_managers set status='revoked',revoked_at=statement_timestamp(),revoke_reason='Synthetic reassignment'
 where reporting_machine_id='ff140000-0000-4000-8000-000000000001' and manager_user_id='ff110000-0000-4000-8000-000000000001';
insert into public.reporting_machine_refund_managers(reporting_machine_id,manager_user_id,manager_email,grant_reason)
 values('ff140000-0000-4000-8000-000000000001','ff110000-0000-4000-8000-000000000002',
 'operational-race-replacement@example.invalid','Synthetic replacement');
select is(operational_notice_race_test.start_provider('revoked_claim'),false,'Reassignment after claim prevents delivery to the former Manager');
select operational_notice_race_test.enqueue('ff160000-0000-4000-8000-000000000003');
insert into operational_notice_race_test.results select 'replacement_claim',operational_notice_race_test.claim('ff160000-0000-4000-8000-000000000003');
select is((select payload->>'recipient' from operational_notice_race_test.results where lane='replacement_claim'),
 'operational-race-replacement@example.invalid','The replacement gets a fresh initial alert on the current authorized route');
select is((select payload->>'noticeStage' from operational_notice_race_test.results where lane='replacement_claim'),'initial','A new assignment does not inherit the old reminder stage');
select diag(payload::text) from operational_notice_race_test.results where payload ? 'qa_error';
select is((select count(*) from operational_notice_race_test.results where payload ? 'qa_error'),0::bigint,'All competing RPCs executed without hidden runtime errors');
select is((select count(*) from public.refund_gift_card_issuances where refund_case_id in
 (select id from public.refund_cases where public_reference like 'RF-OPERATIONAL-RACE-%')),0::bigint,'Alert concurrency never issues a gift or creates another financial decision');
select dblink_disconnect('operational_notice_a');
select dblink_disconnect('operational_notice_b');
begin;
alter table public.refund_case_messages disable trigger aa_refund_gift_denial_notice_identity;
delete from public.refund_manager_notification_recipients where action_id in(select id from public.refund_manager_notification_actions
 where refund_case_id in(select id from public.refund_cases where public_reference like 'RF-OPERATIONAL-RACE-%'));
delete from public.refund_manager_notification_actions where refund_case_id in
 (select id from public.refund_cases where public_reference like 'RF-OPERATIONAL-RACE-%');
delete from public.refund_case_messages where refund_case_id in
 (select id from public.refund_cases where public_reference like 'RF-OPERATIONAL-RACE-%')
 and gift_denial_source_message_id is not null;
delete from public.refund_case_messages where refund_case_id in
 (select id from public.refund_cases where public_reference like 'RF-OPERATIONAL-RACE-%');
delete from public.refund_cases where public_reference like 'RF-OPERATIONAL-RACE-%';
delete from public.refund_gift_card_pools where id='ff150000-0000-4000-8000-000000000001';
delete from public.reporting_machine_refund_managers where reporting_machine_id='ff140000-0000-4000-8000-000000000001';
delete from public.reporting_machines where id='ff140000-0000-4000-8000-000000000001';
delete from public.reporting_locations where id='ff130000-0000-4000-8000-000000000001';
delete from public.customer_accounts where id='ff120000-0000-4000-8000-000000000001';
delete from public.email_alert_preferences where user_id in('ff110000-0000-4000-8000-000000000001','ff110000-0000-4000-8000-000000000002');
delete from public.email_alert_profiles where user_id in('ff110000-0000-4000-8000-000000000001','ff110000-0000-4000-8000-000000000002');
delete from auth.users where id in('ff110000-0000-4000-8000-000000000001','ff110000-0000-4000-8000-000000000002');
update private.email_alert_delivery_settings s set delivery_enabled=(b.personal->>'delivery_enabled')::boolean,
 activated_at=(b.personal->>'activated_at')::timestamptz,ready_scan_after_case_id=(b.personal->>'ready_scan_after_case_id')::uuid,
 ready_scan_updated_at=(b.personal->>'ready_scan_updated_at')::timestamptz,
 ready_reminder_after_action_id=(b.personal->>'ready_reminder_after_action_id')::uuid
 from operational_notice_race_test.settings b where s.singleton;
update public.refund_manager_ready_notice_settings s set delivery_enabled=(b.ready->>'delivery_enabled')::boolean
 from operational_notice_race_test.settings b where s.singleton;
set constraints all immediate;
alter table public.refund_cases enable trigger refund_manager_ready_case_postcommit_wakeup;
alter table public.refund_case_messages enable trigger refund_completion_outbox_postcommit_wakeup;
alter table public.refund_case_messages enable trigger refund_gift_denial_postcommit_wakeup;
alter table public.refund_case_messages enable trigger aa_refund_gift_denial_notice_identity;
drop schema operational_notice_race_test cascade;
commit;
select * from finish();
