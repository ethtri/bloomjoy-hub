begin;
create extension if not exists pgtap with schema extensions;
set local search_path=public,extensions;
select no_plan();
set local session_replication_role=replica;
insert into auth.users(id,email) values('ec710000-0000-4000-8000-000000000001','signals@example.invalid');
insert into public.customer_accounts(id,name,account_type) values('ec720000-0000-4000-8000-000000000001','Signal fixture','internal');
insert into public.reporting_locations(id,account_id,name,timezone) values('ec730000-0000-4000-8000-000000000001','ec720000-0000-4000-8000-000000000001','Fixture','America/Los_Angeles');
insert into public.reporting_machines(id,account_id,location_id,machine_label,status,nayax_machine_id,nayax_account_key,sunze_machine_id) values
 ('ec740000-0000-4000-8000-000000000001','ec720000-0000-4000-8000-000000000001','ec730000-0000-4000-8000-000000000001','Device fixture','active','123456','TEST_ACCOUNT','TEST-SUNZE');
insert into public.reporting_machine_refund_managers(reporting_machine_id,manager_user_id,manager_email,status)
 values('ec740000-0000-4000-8000-000000000001','ec710000-0000-4000-8000-000000000001','signals@example.invalid','active');
insert into public.sales_import_runs(id,source,status) values('ec750000-0000-4000-8000-000000000001','sunze_browser','completed');
set local session_replication_role=origin;
select is(private.email_alert_quiet_candidate('ec740000-0000-4000-8000-000000000001',statement_timestamp()),null,'Missing cash coverage cannot mean quiet sales');
select is(jsonb_array_length(public.service_get_email_alert_signal_inputs()->'devices'),1,'Mapped assigned device can bootstrap before opt-in');
select is((public.service_get_email_alert_signal_inputs()#>>'{devices,0,subscribed}')::boolean,false,'Bootstrap does not create subscription');
select ok(not has_function_privilege('authenticated','public.service_record_email_alert_device_observation(uuid,timestamptz,text,boolean)','execute'),'Clients cannot forge provider observations');
select ok(not has_function_privilege('anon','public.service_record_email_alert_signal(jsonb)','execute'),'Clients cannot forge quiet signals');
select throws_ok($$select public.service_record_email_alert_device_observation('ec740000-0000-4000-8000-000000000001',statement_timestamp(),'Status',false)$$,'22023',null,'Generic attention status is not proof of offline');
select throws_ok($$select public.service_record_email_alert_device_observation('ec740000-0000-4000-8000-000000000001',statement_timestamp()-interval '1 hour','MachineMQTTStatus',false)$$,'22023',null,'Stale status cannot start an outage');
select lives_ok($$select public.service_record_email_alert_device_observation('ec740000-0000-4000-8000-000000000001',statement_timestamp(),'MachineMQTTStatus',false)$$,'Fresh explicit false observation recorded');
select is((select count(*)::int from private.email_alert_signals),0,'One offline sample does not invent duration');
select is((select count(*)::int from private.email_alert_signal_capabilities where alert_id='device-offline'),0,'False without prior connected baseline does not claim MQTT support');
update private.email_alert_device_observations set first_observed_at=statement_timestamp()-interval '15 minutes',last_observed_at=statement_timestamp()-interval '5 minutes',observation_count=3;
select lives_ok($$select public.service_record_email_alert_device_observation('ec740000-0000-4000-8000-000000000001',statement_timestamp(),'MachineMQTTStatus',false)$$,'Repeated false without baseline remains unknown');
select is((select count(*)::int from private.email_alert_signals),0,'A default false terminal cannot manufacture a disconnected event');
select lives_ok($$select public.service_record_email_alert_device_observation('ec740000-0000-4000-8000-000000000001',statement_timestamp(),'MachineMQTTStatus',true)$$,'Explicit connected state establishes same-mapping support');
select is((select count(*)::int from private.email_alert_signal_capabilities where alert_id='device-offline'),1,'Confirmed connected MQTT source enables connection category');
update private.email_alert_device_observations set is_online=false,last_online_observed_at=statement_timestamp()-interval '20 minutes',
 first_observed_at=statement_timestamp()-interval '15 minutes',last_observed_at=statement_timestamp()-interval '5 minutes',observation_count=3;
select lives_ok($$select public.service_record_email_alert_device_observation('ec740000-0000-4000-8000-000000000001',statement_timestamp(),'MachineMQTTStatus',false)$$,'Continuous explicit observations prove interval');
select is((select count(*)::int from private.email_alert_signals where alert_id='device-offline'),1,'One durable event per outage');
select is((select payload->>'component' from private.email_alert_signals),'Nayax MQTT connection','Component label does not claim payments or machine mechanics offline');
select ok((select (payload->>'priorOnlineObservedAt')::timestamptz<=(payload->>'firstObservedAt')::timestamptz from private.email_alert_signals),'Outage retains proven prior connected observation');
select is((select private.email_alert_signal_is_current(id,statement_timestamp()) from private.email_alert_signals),true,'Current source mapping and fresh streak validate event');
select lives_ok($$select public.service_record_email_alert_device_observation('ec740000-0000-4000-8000-000000000001',statement_timestamp(),'MachineMQTTStatus',false)$$,'Repeated observation refreshes existing outage');
select is((select count(*)::int from private.email_alert_signals),1,'Outage heartbeat does not create repeat event IDs');
select lives_ok($$select public.service_record_email_alert_device_observation('ec740000-0000-4000-8000-000000000001',statement_timestamp(),'MachineMQTTStatus',true)$$,'Online observation clears current outage');
select is((select count(*)::int from private.email_alert_signals where valid_until>statement_timestamp()),0,'Recovered device cannot deliver stale offline alert');
update private.email_alert_device_observations set is_online=false,first_observed_at=statement_timestamp()-interval '1 hour',last_observed_at=statement_timestamp()-interval '7 minutes',observation_count=9;
select lives_ok($$select public.service_record_email_alert_device_observation('ec740000-0000-4000-8000-000000000001',statement_timestamp(),'MachineMQTTStatus',false)$$,'Observation after gap restarts streak');
select is((select observation_count from private.email_alert_device_observations),1,'Gap cannot establish continuous offline interval');
set local session_replication_role=replica;
update public.reporting_machines set nayax_account_key='OTHER_TEST_ACCOUNT' where id='ec740000-0000-4000-8000-000000000001';
set local session_replication_role=origin;
select is(private.email_alert_capability_is_current('ec740000-0000-4000-8000-000000000001','device-offline',statement_timestamp()),false,'Changed mapping invalidates previously observed connected baseline');
select lives_ok($$select public.service_record_email_alert_device_observation('ec740000-0000-4000-8000-000000000001',statement_timestamp(),'MachineMQTTStatus',false)$$,'Changed mapping starts unknown again');
select is((select has_observed_online from private.email_alert_device_observations),false,'New account mapping cannot reuse former online baseline');
select is((select count(*)::int from private.email_alert_signal_capabilities where alert_id='device-offline'),0,'Changed mapping removes stale capability');
set local session_replication_role=replica;
insert into public.sunze_cash_source_watermarks(reporting_machine_id,coverage_started_at,covered_through,last_successful_import_at,freshness_expires_at,
 payment_time_basis,payment_time_timezone,timestamp_proof_scope,import_run_id) values
 ('ec740000-0000-4000-8000-000000000001',statement_timestamp()-interval '40 days',statement_timestamp(),statement_timestamp(),statement_timestamp()+interval '1 day',
 'validated_iana_timezone','America/Los_Angeles','account','ec750000-0000-4000-8000-000000000001');
insert into public.machine_sales_facts(reporting_machine_id,reporting_location_id,sale_date,payment_method,net_sales_cents,transaction_count,source,source_row_hash,source_order_hash,raw_payload)
 select 'ec740000-0000-4000-8000-000000000001','ec730000-0000-4000-8000-000000000001',(statement_timestamp() at time zone 'America/Los_Angeles')::date-1-i*7,
 'cash',1000,10,'sunze_browser',md5(i::text)||md5(i::text),md5(i::text),'{}' from generate_series(1,4) i;
set local session_replication_role=origin;
create temporary table quiet_proof as select private.email_alert_quiet_candidate('ec740000-0000-4000-8000-000000000001',statement_timestamp()) p;
select is((select p#>>'{payload,actualTransactions}' from quiet_proof),'0','Zero exists only with positively complete source coverage');
select is((select (p#>>'{payload,baselineTransactions}')::numeric from quiet_proof),10::numeric,'Four comparable weekdays supply baseline');
select is((select p#>>'{payload,paymentScope}' from quiet_proof),'cash','Quiet proof never claims all payments covered');
select lives_ok($$select public.service_record_email_alert_signal((select p||'{"schemaVersion":"machine_email_signal_v1","category":"sales-quiet"}'::jsonb from quiet_proof))$$,'Verified source candidate can publish');
select throws_ok($$select public.service_record_email_alert_signal((select jsonb_set(p,'{payload,actualTransactions}','999')||'{"schemaVersion":"machine_email_signal_v1","category":"sales-quiet"}'::jsonb from quiet_proof))$$,'22023',null,'Forged metric rejected against actual source proof');
select set_config('request.jwt.claim.sub','ec710000-0000-4000-8000-000000000001',true);
select is((select a->>'authorized' from jsonb_array_elements(public.get_my_email_alert_preferences()->'alerts') a where a->>'id'='sales-quiet'),'false','Manager without sales entitlement cannot receive cash comparison');
insert into public.email_alert_preferences(user_id,alert_id,enabled,enabled_since) values('ec710000-0000-4000-8000-000000000001','sales-quiet',true,statement_timestamp()-interval '1 hour');
select is((select count(*)::int from private.email_alert_selected_scope('ec710000-0000-4000-8000-000000000001','sales-quiet')),0,'Stored preference cannot bypass current sales authorization');
select * from finish();
rollback;
