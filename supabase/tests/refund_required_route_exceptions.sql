-- Disposable database only. Real reservations/final checks and concurrent
-- sessions exercise routing safety without invoking any mail transport.
create extension if not exists pgtap with schema extensions;
create extension if not exists dblink with schema extensions;
set search_path=public,extensions;
select dblink_connect('required_route_a','host=db port='||current_setting('port')||
 ' dbname='||current_database()||' user=postgres password=postgres sslmode=disable application_name=required_route_a');
select dblink_connect('required_route_b','host=db port='||current_setting('port')||
 ' dbname='||current_database()||' user=postgres password=postgres sslmode=disable application_name=required_route_b');
begin;
alter table public.refund_cases disable trigger refund_manager_ready_case_postcommit_wakeup;
alter table public.refund_case_messages disable trigger refund_completion_outbox_postcommit_wakeup;
alter table public.refund_case_messages disable trigger refund_gift_denial_postcommit_wakeup;
create schema required_route_test;
create table required_route_test.results(lane text primary key,payload jsonb);
create table required_route_test.settings as select to_jsonb(s) saved
 from private.email_alert_delivery_settings s where singleton;
update private.email_alert_delivery_settings set activated_at=statement_timestamp(),delivery_enabled=true where singleton;
insert into auth.users(id,email,email_confirmed_at) values
 ('fb110000-0000-4000-8000-000000000001','current-route-manager@example.invalid',now()),
 ('fb110000-0000-4000-8000-000000000002','route-mailbox@example.invalid',now()),
 ('fb110000-0000-4000-8000-000000000003','route-ops@example.invalid',now());
insert into public.email_alert_profiles(user_id,timezone,quiet_enabled)
 select id,'UTC',false from auth.users where id in
 ('fb110000-0000-4000-8000-000000000001','fb110000-0000-4000-8000-000000000002','fb110000-0000-4000-8000-000000000003');
insert into public.customer_accounts(id,name,account_type)
 values('fb120000-0000-4000-8000-000000000001','Required route exception fixture','customer');
insert into public.reporting_locations(id,account_id,name,timezone)
 values('fb130000-0000-4000-8000-000000000001','fb120000-0000-4000-8000-000000000001','Synthetic routing location','UTC');
insert into public.reporting_machines(id,account_id,location_id,machine_label,status)
 select ('fb140000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid,
 'fb120000-0000-4000-8000-000000000001','fb130000-0000-4000-8000-000000000001','Synthetic route '||n,'active'
 from generate_series(1,4)n;
insert into public.reporting_machine_refund_managers(reporting_machine_id,manager_user_id,manager_email,grant_reason)
 select id,case when machine_label='Synthetic route 1' then 'fb110000-0000-4000-8000-000000000001'::uuid
 else 'fb110000-0000-4000-8000-000000000002'::uuid end,
 case when machine_label='Synthetic route 1' then 'not-an-email' else 'stale-valid-mapping@example.invalid' end,
 'Synthetic current-account routing'
 from public.reporting_machines where account_id='fb120000-0000-4000-8000-000000000001';
insert into public.refund_cases(id,public_reference,reporting_machine_id,reporting_location_id,
 customer_email,issue_summary,incident_at,payment_method,payment_amount_cents,zelle_payment_contact,status,automation_state)
 select ('fb150000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid,'RF-REQUIRED-ROUTE-'||n,
 ('fb140000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid,'fb130000-0000-4000-8000-000000000001',
 'route-customer-'||n||'@example.invalid','Synthetic routing exception',now()-interval '14 days',
 'cash',500,'synthetic-payout','needs_review','under_review' from generate_series(1,4)n;
insert into public.refund_gift_card_pools(id,provider,provider_account_id,face_value_cents,
 eligible_machine_ids,eligible_locations,expires_at,enabled,redemption_instructions)
 values('fb160000-0000-4000-8000-000000000001','kemore','owner-route-fixture',1500,
 array['fb140000-0000-4000-8000-000000000001','fb140000-0000-4000-8000-000000000002']::uuid[],
 array['Synthetic routing location'],now()+interval '30 days',true,'Synthetic terms');
insert into public.refund_cases(id,public_reference,reporting_machine_id,reporting_location_id,
 customer_email,issue_summary,issue_category,incident_at,payment_method,payment_amount_cents,refund_amount_cents,
 resolution_method,gift_card_pool_id,gift_card_value_cents,gift_card_expires_at,gift_card_state)
 select ('fb150000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid,'RF-REQUIRED-ROUTE-'||n,
 case when n=7 then 'fb140000-0000-4000-8000-000000000001'::uuid else 'fb140000-0000-4000-8000-000000000002'::uuid end,
 'fb130000-0000-4000-8000-000000000001','route-customer-'||n||'@example.invalid',
 'Synthetic partial order','partial_items',now(),'cash',1100,1100,'gift_card',
 'fb160000-0000-4000-8000-000000000001',1500,
 (select expires_at from public.refund_gift_card_pools where id='fb160000-0000-4000-8000-000000000001'),
 'pending_inventory' from generate_series(5,11)n;
-- Attention is the existing aging clock, not a successful-send timestamp.
update public.refund_manager_attention_states set attention_started_at=statement_timestamp()-interval '14 days'
 where refund_case_id in(select id from public.refund_cases where public_reference like 'RF-REQUIRED-ROUTE-%');
select public.service_start_refund_automation_run('scheduled:required-route-test','scheduled',statement_timestamp());
create function required_route_test.reserve(p_case uuid,p_milestone text default 'escalation')
returns jsonb language plpgsql as $$
declare version_value bigint; action_key text; run_id uuid;
begin
 select attention_version into strict version_value from public.refund_manager_attention_states where refund_case_id=p_case;
 action_key:=format('manager_aging:%s:%s:v%s',p_milestone,p_case,version_value);
 select id into strict run_id from public.refund_automation_runs where run_key='scheduled:required-route-test';
 perform public.service_claim_refund_automation_action(run_id,p_case,action_key,
  case when p_milestone='escalation' then 'manager_escalation' else 'manager_reminder' end,
  'needs_review',date_trunc('hour',statement_timestamp()));
 return public.service_begin_refund_manager_aging_notice_attempt(p_case,version_value,p_milestone,
  statement_timestamp(),'UTC',2,5,'refund_manager_aging_v1',action_key,
  array['route-mailbox@example.invalid'],array['route-ops@example.invalid']);
exception when others then return jsonb_build_object('qa_error',sqlerrm,'sqlstate',sqlstate);
end $$;
create function required_route_test.revalidate(p_case uuid,p_key text default null)
returns jsonb language plpgsql as $$
declare customer text; action_key text;
begin
 select customer_email into strict customer from public.refund_cases where id=p_case;
 select notice_attempt_key into action_key from public.refund_manager_attention_states where refund_case_id=p_case;
 return public.service_revalidate_refund_manager_operational_aging(p_case,customer,
  array['route-mailbox@example.invalid'],array['route-ops@example.invalid'],coalesce(p_key,action_key));
exception when others then return jsonb_build_object('qa_error',sqlerrm,'sqlstate',sqlstate);
end $$;
create function required_route_test.wait_for_lock() returns boolean language plpgsql as $$
begin
 for i in 1..100 loop
  perform pg_stat_clear_snapshot();
  if exists(select 1 from pg_stat_activity where application_name='required_route_b' and wait_event_type='Lock') then return true; end if;
  perform pg_sleep(0.01);
 end loop;
 return false;
end $$;
create function required_route_test.deny_contact(p_case uuid,p_exhaust boolean default true,
 p_manager uuid default 'fb110000-0000-4000-8000-000000000002')
returns jsonb language plpgsql as $$
declare claims text:=current_setting('request.jwt.claims',true); subject text:=current_setting('request.jwt.claim.sub',true);
 notice_id uuid; claimed record;
begin
 perform set_config('request.jwt.claims',jsonb_build_object('role','authenticated','sub',p_manager)::text,true);
 perform set_config('request.jwt.claim.sub',p_manager::text,true);
 perform public.admin_decide_refund_gift_card(p_case,false,'Synthetic reviewed customer explanation.');
 perform set_config('request.jwt.claims',coalesce(claims,''),true);
 perform set_config('request.jwt.claim.sub',coalesce(subject,''),true);
 select id into strict notice_id from public.refund_case_messages
  where refund_case_id=p_case and manual_delivery_intent_id=md5('gift-card-denial:'||p_case::text)::uuid;
 if p_exhaust then
  for attempt in 1..3 loop
   select * into strict claimed from public.service_claim_refund_manual_message_deliveries(notice_id,1);
   perform public.service_finish_refund_manual_message_delivery(claimed.refund_case_message_id,claimed.claim_token,
    'failed',null,'synthetic_preprovider_failure',0,null);
  end loop;
 end if;
 return jsonb_build_object('messageId',notice_id,'exhausted',p_exhaust);
exception when others then
 perform set_config('request.jwt.claims',coalesce(claims,''),true);
 perform set_config('request.jwt.claim.sub',coalesce(subject,''),true);
 return jsonb_build_object('qa_error',sqlerrm,'sqlstate',sqlstate);
end $$;
create function required_route_test.owner_claim(p_observed timestamptz default statement_timestamp())
returns jsonb language sql as $$
 select public.service_claim_refund_contact_owner_notice(array['route-mailbox@example.invalid'],
  array['route-ops@example.invalid'],p_observed);
$$;
create function required_route_test.owner_start(p_lane text,p_recipients_override text[] default null)
returns boolean language plpgsql as $$
declare claimed jsonb; recipients text[];
begin
 select payload into strict claimed from required_route_test.results where lane=p_lane;
 select array_agg(v order by v) into recipients from jsonb_array_elements_text(claimed->'recipients') v;
 return public.service_mark_refund_contact_owner_provider_started((claimed->>'actionId')::uuid,(claimed->>'claimToken')::uuid,
  array['route-mailbox@example.invalid'],array['route-ops@example.invalid'],claimed->>'routeFingerprint',coalesce(p_recipients_override,recipients));
end $$;
commit;
select no_plan();
select ok(not has_function_privilege('authenticated',
 'public.service_list_due_refund_manager_operational_exceptions(timestamptz,text,integer,integer,text,integer,text[])','execute'),
 'Browser roles cannot select operational routing exceptions');
select ok(has_function_privilege('service_role',
 'public.service_list_due_refund_manager_operational_exceptions(timestamptz,text,integer,integer,text,integer,text[])','execute'),
 'The existing service workflow owns the bounded exception selector');
select ok(not has_function_privilege('authenticated',
 'public.service_revalidate_refund_manager_operational_aging(uuid,text,text[],text[],text)','execute'),
 'Browser roles cannot authorize the final Ops provider boundary');
select ok(has_function_privilege('service_role',
 'public.service_revalidate_refund_manager_operational_aging(uuid,text,text[],text[],text)','execute'),
 'Only the service workflow receives final operational revalidation');
select is((select count(*) from public.service_list_due_refund_manager_aging_notices(
 statement_timestamp(),'UTC',2,5,'refund_manager_aging_v1',100)),0::bigint,
 'An old worker receives no adopted Manager aging work');
select is((select count(*) from public.service_list_due_refund_manager_operational_exceptions(
 statement_timestamp(),'UTC',2,5,'refund_manager_aging_v1',100,array['route-mailbox@example.invalid'])
 where refund_case_id='fb150000-0000-4000-8000-000000000001'),0::bigint,
 'A valid current Manager account does not become Ops work because its mapping email is stale');
select is((select refund_case_id from public.service_list_due_refund_manager_operational_exceptions(
 statement_timestamp(),'UTC',2,5,'refund_manager_aging_v1',1,array['route-mailbox@example.invalid'])),
 'fb150000-0000-4000-8000-000000000002'::uuid,
 'Resolved older routes are excluded before the bounded exception batch');
select ok((select bool_and(milestone='escalation' and business_day_age>=5)
 from public.service_list_due_refund_manager_operational_exceptions(
 statement_timestamp(),'UTC',2,5,'refund_manager_aging_v1',100,array['route-mailbox@example.invalid'])),
 'Only the existing five-business-day escalation is retained');
update auth.users set banned_until=statement_timestamp()+interval '1 day' where id='fb110000-0000-4000-8000-000000000001';
select is((select count(*) from public.service_list_due_refund_manager_operational_exceptions(
 statement_timestamp(),'UTC',2,5,'refund_manager_aging_v1',100,array['route-mailbox@example.invalid'])
 where refund_case_id='fb150000-0000-4000-8000-000000000001'),1::bigint,
 'A banned current account is not treated as a valid responsible route');
update auth.users set banned_until=null where id='fb110000-0000-4000-8000-000000000001';
insert into required_route_test.results select 'valid_manager',required_route_test.reserve('fb150000-0000-4000-8000-000000000001');
select is((select coalesce((payload->>'attemptStarted')::boolean,false) from required_route_test.results where lane='valid_manager'),false,
 'The final reservation cannot restore a normal Manager day-five ping');
insert into required_route_test.results select 'ops_initial',required_route_test.reserve('fb150000-0000-4000-8000-000000000002');
select is((select payload->>'attemptStarted' from required_route_test.results where lane='ops_initial'),'true',
 'An unresolved current account reserves the existing Ops exception');
select ok((select payload#>>'{recipientRoute,routeType}'='operations'
 and payload#>'{recipientRoute,recipients}'='["route-ops@example.invalid"]'::jsonb
 and payload->>'requiredRefundActionsVersion'='1' from required_route_test.results where lane='ops_initial'),
 'The reservation binds only the existing Ops recipient and required-policy contract');
select is(required_route_test.revalidate('fb150000-0000-4000-8000-000000000002')->>'deliveryAllowed','true',
 'A live unresolved reserved exception passes its actual final provider check');
select is(required_route_test.revalidate('fb150000-0000-4000-8000-000000000002','manager_aging:wrong-attempt')->>'deliveryAllowed','false',
 'An unrelated attempt key cannot cross the provider boundary');
select public.service_complete_refund_manager_aging_notice('fb150000-0000-4000-8000-000000000002',
 (select notice_attempt_key from public.refund_manager_attention_states where refund_case_id='fb150000-0000-4000-8000-000000000002'),
 'delivery_unknown');
select is(required_route_test.revalidate('fb150000-0000-4000-8000-000000000002')->>'deliveryAllowed','false',
 'An actual unknown settlement preserves its hold despite retaining the same attempt identity');
select is((select count(*) from public.service_list_due_refund_manager_operational_exceptions(
 statement_timestamp()+interval '14 days','UTC',2,5,'refund_manager_aging_v1',100,array['route-mailbox@example.invalid'])
 where refund_case_id='fb150000-0000-4000-8000-000000000002'),0::bigint,
 'Unknown delivery cannot acquire another scheduled exception');

-- Both selection and reservation defer under the adopted master or Ops quiet
-- hours, without creating an in-flight delivery hold.
update private.email_alert_delivery_settings set delivery_enabled=false where singleton;
select is((select count(*) from public.service_list_due_refund_manager_operational_exceptions(
 statement_timestamp(),'UTC',2,5,'refund_manager_aging_v1',100,array['route-mailbox@example.invalid'])),0::bigint,
 'The adopted master-disable suppresses the exception selector');
insert into required_route_test.results select 'disabled_reserve',required_route_test.reserve('fb150000-0000-4000-8000-000000000004');
select is((select coalesce((payload->>'attemptStarted')::boolean,false) from required_route_test.results where lane='disabled_reserve'),false,
 'The master-disable also prevents direct exception reservation');
select ok((select notice_attempt_key is null from public.refund_manager_attention_states where refund_case_id='fb150000-0000-4000-8000-000000000004'),
 'A disabled reservation leaves no delivery hold');
update private.email_alert_delivery_settings set delivery_enabled=true where singleton;
update public.email_alert_profiles set quiet_enabled=true,
 quiet_start=((statement_timestamp() at time zone 'UTC')-interval '1 hour')::time,
 quiet_end=((statement_timestamp() at time zone 'UTC')+interval '1 hour')::time
 where user_id='fb110000-0000-4000-8000-000000000003';
insert into required_route_test.results select 'quiet_reserve',required_route_test.reserve('fb150000-0000-4000-8000-000000000004');
select is((select coalesce((payload->>'attemptStarted')::boolean,false) from required_route_test.results where lane='quiet_reserve'),false,
 'The actual Ops recipient quiet hours defer direct reservation');
select ok((select notice_attempt_key is null from public.refund_manager_attention_states where refund_case_id='fb150000-0000-4000-8000-000000000004'),
 'Quiet deferral consumes no exception delivery hold');
update public.email_alert_profiles set quiet_enabled=false where user_id='fb110000-0000-4000-8000-000000000003';
insert into required_route_test.results select 'gate_reserve',required_route_test.reserve('fb150000-0000-4000-8000-000000000004');
select is((select payload->>'attemptStarted' from required_route_test.results where lane='gate_reserve'),'true',
 'The same due exception may reserve once gates permit delivery');
update private.email_alert_delivery_settings set delivery_enabled=false where singleton;
select is(required_route_test.revalidate('fb150000-0000-4000-8000-000000000004')->>'deliveryAllowed','false',
 'Master-disable after reservation blocks actual provider access');
update private.email_alert_delivery_settings set delivery_enabled=true where singleton;
update public.email_alert_profiles set quiet_enabled=true where user_id='fb110000-0000-4000-8000-000000000003';
select is(required_route_test.revalidate('fb150000-0000-4000-8000-000000000004')->>'deliveryAllowed','false',
 'Ops quiet hours changed after reservation are rechecked at provider access');
update public.email_alert_profiles set quiet_enabled=false where user_id='fb110000-0000-4000-8000-000000000003';

-- Failed customer contact with no usable Manager gets one existing Ops notice,
-- independent of the old business-decision aging clock. There is no reminder.
select ok(not has_function_privilege('authenticated','public.service_claim_refund_contact_owner_notice(text[],text[],timestamptz)','execute'),
 'Browser roles cannot claim the contact-owner exception');
select ok(not has_function_privilege('authenticated','public.service_mark_refund_contact_owner_provider_started(uuid,uuid,text[],text[],text,text[])','execute'),
 'Browser roles cannot cross the contact-owner provider boundary');
insert into required_route_test.results select 'denial_five',required_route_test.deny_contact('fb150000-0000-4000-8000-000000000005');
update private.email_alert_delivery_settings set delivery_enabled=false where singleton;
select is(required_route_test.owner_claim()->>'claimed','false','Disabled personal sender cannot create or claim a contact-owner notice');
select is((select count(*) from public.refund_manager_notification_actions where notice_reason='customer_contact_owner_needed'),0::bigint,
 'Disabled contact-owner claim has no action-ledger effect');
update private.email_alert_delivery_settings set delivery_enabled=true where singleton;
update public.email_alert_profiles set quiet_enabled=true where user_id='fb110000-0000-4000-8000-000000000003';
select is(required_route_test.owner_claim()->>'claimed','false','Ops quiet hours defer the initial contact-owner claim');
update public.email_alert_profiles set quiet_enabled=false where user_id='fb110000-0000-4000-8000-000000000003';
select dblink_exec('required_route_a','begin');
insert into required_route_test.results select 'owner_first',p from dblink('required_route_a',
 $$select required_route_test.owner_claim()$$) r(p jsonb);
insert into required_route_test.results select 'owner_competing',p from dblink('required_route_b',
 $$select required_route_test.owner_claim()$$) r(p jsonb);
select is((select payload->>'claimed' from required_route_test.results where lane='owner_first'),'true',
 'The first actual worker claims a supported failed-contact owner exception');
select is((select payload->>'claimed' from required_route_test.results where lane='owner_competing'),'false',
 'A concurrent worker cannot claim a second initial Ops notice');
select dblink_exec('required_route_a','commit');
select ok((select payload->>'claimKind'='customer_contact_owner_needed' and payload->>'caseId'='fb150000-0000-4000-8000-000000000005'
 and payload->'recipients'='["route-ops@example.invalid"]'::jsonb from required_route_test.results where lane='owner_first'),
 'The claim has a distinct owner-routing purpose and only existing Ops recipients');
select is((select public.service_mark_refund_manager_notification_provider_started((payload->>'actionId')::uuid,(payload->>'claimToken')::uuid)
 from required_route_test.results where lane='owner_first'),false,'An old generic consumer cannot send the new contact-owner purpose');
select is(required_route_test.owner_start('owner_first',array['tampered-ops@example.invalid']),false,
 'A changed actual transport recipient cannot reuse a valid contact-owner fingerprint');
update private.email_alert_delivery_settings set delivery_enabled=false where singleton;
select is(required_route_test.owner_start('owner_first'),false,'Master-disable after contact-owner claim prevents provider access');
update private.email_alert_delivery_settings set delivery_enabled=true where singleton;
update public.email_alert_profiles set quiet_enabled=true where user_id='fb110000-0000-4000-8000-000000000003';
select is(required_route_test.owner_start('owner_first'),false,'Current Ops quiet hours are checked again after claim');
update public.email_alert_profiles set quiet_enabled=false where user_id='fb110000-0000-4000-8000-000000000003';
select ok(required_route_test.owner_start('owner_first'),'A supported current unowned contact crosses the protected provider boundary once');
select public.service_complete_refund_manager_notification((payload->>'actionId')::uuid,(payload->>'claimToken')::uuid,'delivery_unknown',null)
 from required_route_test.results where lane='owner_first';
select is(required_route_test.owner_claim(statement_timestamp()+interval '14 days')->>'claimed','false',
 'Uncertain Ops contact delivery remains held without a new initial or reminder');
select is(required_route_test.owner_start('owner_first'),false,'An uncertain contact-owner attempt cannot re-enter the provider');
select public.service_complete_refund_manager_notification((payload->>'actionId')::uuid,(payload->>'claimToken')::uuid,'sent','synthetic-contact-owner-receipt')
 from required_route_test.results where lane='owner_first';
select is(required_route_test.owner_claim(statement_timestamp()+interval '14 days')->>'claimed','false',
 'A known sent initial contact-owner notice has no later reminder or replacement');
select is((select count(*) from public.refund_manager_notification_actions where refund_case_id='fb150000-0000-4000-8000-000000000005'
 and notice_reason='customer_contact_owner_needed'),1::bigint,'Duplicate scans preserve one Ops notice identity for the canonical denial root');

insert into required_route_test.results select 'denial_six',required_route_test.deny_contact('fb150000-0000-4000-8000-000000000006');
insert into required_route_test.results select 'owner_retry',required_route_test.owner_claim();
select is((select payload->>'caseId' from required_route_test.results where lane='owner_retry'),'fb150000-0000-4000-8000-000000000006',
 'A separate supported no-owner failure receives its own initial Ops notice');
select set_config('request.jwt.claims','{"role":"authenticated","sub":"fb110000-0000-4000-8000-000000000002"}',false);
select set_config('request.jwt.claim.sub','fb110000-0000-4000-8000-000000000002',false);
select public.admin_retry_refund_gift_denial_notice('fb150000-0000-4000-8000-000000000006','fb170000-0000-4000-8000-000000000006');
select is(required_route_test.owner_start('owner_retry'),false,'A queued supported customer retry cancels the claimed Ops exception before provider access');
select public.service_complete_refund_manager_notification((payload->>'actionId')::uuid,(payload->>'claimToken')::uuid,'known_not_sent',null)
 from required_route_test.results where lane='owner_retry';
select is(required_route_test.owner_claim(statement_timestamp()+interval '14 days')->>'claimed','false',
 'A queued latest retry does not create another contact-owner action');
insert into required_route_test.results select 'denial_owned',required_route_test.deny_contact('fb150000-0000-4000-8000-000000000007',true,
 'fb110000-0000-4000-8000-000000000001');
select is(required_route_test.owner_claim()->>'claimed','false','A valid current Manager owns supported recovery despite a stale invalid mapping email');

insert into required_route_test.results select 'denial_complaint',required_route_test.deny_contact('fb150000-0000-4000-8000-000000000009');
select public.service_bind_refund_transactional_delivery((payload->>'messageId')::uuid,'synthetic-owner-complaint',statement_timestamp())
 from required_route_test.results where lane='denial_complaint';
select public.service_record_refund_transactional_delivery_event(repeat('b',64),'synthetic-owner-complaint','complained',statement_timestamp());
insert into required_route_test.results select 'denial_settled',required_route_test.deny_contact('fb150000-0000-4000-8000-000000000010');
select public.service_bind_refund_transactional_delivery((payload->>'messageId')::uuid,'synthetic-owner-settled',statement_timestamp())
 from required_route_test.results where lane='denial_settled';
select public.service_record_refund_transactional_delivery_event(repeat('c',64),'synthetic-owner-settled','delivered',statement_timestamp());
insert into required_route_test.results select 'denial_unknown',required_route_test.deny_contact('fb150000-0000-4000-8000-000000000011',false);
create temporary table required_unknown_claim as select * from public.service_claim_refund_manual_message_deliveries(
 (select (payload->>'messageId')::uuid from required_route_test.results where lane='denial_unknown'),1);
select public.service_mark_refund_manual_message_provider_attempt(refund_case_message_id,claim_token) from required_unknown_claim;
select public.service_finish_refund_manual_message_delivery(refund_case_message_id,claim_token,'delivery_unknown',null,
 'synthetic_provider_unknown',0,null) from required_unknown_claim;
select is(required_route_test.owner_claim()->>'claimed','false','Complained, settled and unknown customer contact cannot become an unsupported owner-retry alert');
insert into required_route_test.results select 'denial_route_fix',required_route_test.deny_contact('fb150000-0000-4000-8000-000000000008');
insert into required_route_test.results select 'owner_route_fix',required_route_test.owner_claim();
select is((select payload->>'caseId' from required_route_test.results where lane='owner_route_fix'),'fb150000-0000-4000-8000-000000000008',
 'The final no-owner recovery claim is bound before concurrent route correction');

insert into required_route_test.results select 'race_reserve',required_route_test.reserve('fb150000-0000-4000-8000-000000000003');
select is((select payload->>'attemptStarted' from required_route_test.results where lane='race_reserve'),'true',
 'A separate unresolved route reserves before concurrent correction');
select dblink_exec('required_route_a','begin');
select * from dblink('required_route_a',
 $$select id from public.refund_cases where id='fb150000-0000-4000-8000-000000000003' for update$$) r(id uuid);
select dblink_exec('required_route_a',
 $$update auth.users set email='corrected-current-manager@example.invalid' where id='fb110000-0000-4000-8000-000000000002'$$);
select dblink_send_query('required_route_b',
 $$select required_route_test.revalidate('fb150000-0000-4000-8000-000000000003')$$);
select ok(required_route_test.wait_for_lock(),'Final revalidation waits for the concurrent routing transaction');
select dblink_exec('required_route_a','commit');
insert into required_route_test.results select 'race_revalidate',p from dblink_get_result('required_route_b') r(p jsonb);
select * from dblink_get_result('required_route_b') r(p jsonb);
select is((select payload->>'deliveryAllowed' from required_route_test.results where lane='race_revalidate'),'false',
 'A current Manager route corrected before final access cancels the Ops exception');
select is((select payload->>'status' from required_route_test.results where lane='race_revalidate'),'resolved',
 'The provider boundary reads the committed current account route, not the old mapping email');
select is(required_route_test.owner_start('owner_route_fix'),false,'The same current-account route correction cancels the claimed failed-contact Ops notice');
select is(required_route_test.owner_claim(statement_timestamp()+interval '14 days')->>'claimed','false',
 'A now-owned recovery has no automatic Ops resend or reminder');
select is((select count(*) from public.refund_case_events where refund_case_id='fb150000-0000-4000-8000-000000000006'
 and event_type='gift_card_exception_decided'),1::bigint,'Ops contact recovery never creates another refund decision');
select is((select count(*) from public.refund_gift_card_issuances where refund_case_id in
 (select id from public.refund_cases where public_reference like 'RF-REQUIRED-ROUTE-%')),0::bigint,
 'Operational owner alerts never issue a gift or move money');
select diag(payload::text) from required_route_test.results where payload ? 'qa_error';
select is((select count(*) from required_route_test.results where payload ? 'qa_error'),0::bigint,
 'All actual reservation and revalidation calls completed without hidden errors');
select dblink_disconnect('required_route_a');
select dblink_disconnect('required_route_b');
begin;
alter table public.refund_case_messages disable trigger aa_refund_gift_denial_notice_identity;
delete from public.refund_manager_notification_recipients where action_id in
 (select id from public.refund_manager_notification_actions where refund_case_id in
  (select id from public.refund_cases where public_reference like 'RF-REQUIRED-ROUTE-%'));
delete from public.refund_manager_notification_actions where refund_case_id in
 (select id from public.refund_cases where public_reference like 'RF-REQUIRED-ROUTE-%');
delete from public.refund_case_messages where refund_case_id in
 (select id from public.refund_cases where public_reference like 'RF-REQUIRED-ROUTE-%') and gift_denial_source_message_id is not null;
delete from public.refund_case_messages where refund_case_id in
 (select id from public.refund_cases where public_reference like 'RF-REQUIRED-ROUTE-%');
delete from public.refund_automation_actions where refund_case_id in
 (select id from public.refund_cases where public_reference like 'RF-REQUIRED-ROUTE-%');
delete from public.refund_automation_runs where run_key='scheduled:required-route-test';
delete from public.refund_cases where public_reference like 'RF-REQUIRED-ROUTE-%';
delete from public.refund_gift_card_pools where id='fb160000-0000-4000-8000-000000000001';
delete from public.reporting_machine_refund_managers where reporting_machine_id in
 (select id from public.reporting_machines where account_id='fb120000-0000-4000-8000-000000000001');
delete from public.reporting_machines where account_id='fb120000-0000-4000-8000-000000000001';
delete from public.reporting_locations where id='fb130000-0000-4000-8000-000000000001';
delete from public.customer_accounts where id='fb120000-0000-4000-8000-000000000001';
delete from public.email_alert_profiles where user_id in
 ('fb110000-0000-4000-8000-000000000001','fb110000-0000-4000-8000-000000000002','fb110000-0000-4000-8000-000000000003');
delete from auth.users where id in
 ('fb110000-0000-4000-8000-000000000001','fb110000-0000-4000-8000-000000000002','fb110000-0000-4000-8000-000000000003');
update private.email_alert_delivery_settings s set activated_at=(b.saved->>'activated_at')::timestamptz,
 delivery_enabled=(b.saved->>'delivery_enabled')::boolean,
 contact_owner_scan_after_case_id=(b.saved->>'contact_owner_scan_after_case_id')::uuid from required_route_test.settings b where s.singleton;
set constraints all immediate;
alter table public.refund_cases enable trigger refund_manager_ready_case_postcommit_wakeup;
alter table public.refund_case_messages enable trigger refund_completion_outbox_postcommit_wakeup;
alter table public.refund_case_messages enable trigger refund_gift_denial_postcommit_wakeup;
alter table public.refund_case_messages enable trigger aa_refund_gift_denial_notice_identity;
drop schema required_route_test cascade;
commit;
select * from finish();
