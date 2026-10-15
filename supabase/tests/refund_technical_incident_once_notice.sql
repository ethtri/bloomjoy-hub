-- Disposable database only: real RPC/row-lock contention, never provider calls.
create extension if not exists pgtap with schema extensions;
create extension if not exists dblink with schema extensions;
set search_path=public,extensions;
select dblink_connect('technical_once_a','host=db port='||current_setting('port')||
 ' dbname='||current_database()||' user=postgres password=postgres sslmode=disable application_name=technical_once_a');
select dblink_connect('technical_once_b','host=db port='||current_setting('port')||
 ' dbname='||current_database()||' user=postgres password=postgres sslmode=disable application_name=technical_once_b');
begin;
create schema technical_once_test;
create table technical_once_test.results(lane text primary key,payload jsonb);
create table technical_once_test.settings as select to_jsonb(s) personal,
 (select enabled from public.refund_automation_scheduler_settings where singleton) scheduler_enabled
 from private.email_alert_delivery_settings s where singleton;
create table technical_once_test.prior_runs as select id,started_at,finished_at
 from public.refund_automation_runs where trigger_source in('scheduled','manual');
create table technical_once_test.prior_incidents as select id,status,recovered_at,close_reason,updated_at
 from public.refund_automation_alert_incidents where status='open';
create table technical_once_test.protected_counts as select
 (select count(*) from public.refund_cases) cases,
 (select count(*) from public.refund_case_messages) messages,
 (select count(*) from public.refund_case_nayax_refund_attempts) attempts;
-- Restore every changed global fixture value below, including committed races.
update public.refund_automation_runs set started_at=statement_timestamp()-interval '6 hours',
 finished_at=case when finished_at is null then null else statement_timestamp()-interval '6 hours' end
 where id in(select id from technical_once_test.prior_runs);
update public.refund_automation_alert_incidents set status='closed',recovered_at=statement_timestamp(),
 close_reason='automation_paused' where id in(select id from technical_once_test.prior_incidents);
update private.email_alert_delivery_settings set delivery_enabled=true,activated_at=statement_timestamp() where singleton;
update public.refund_automation_scheduler_settings set enabled=true where singleton;
insert into auth.users(id,email,email_confirmed_at) values
 ('14320000-0000-4000-8000-000000000001','etrifari@bloomjoysweets.com',statement_timestamp()),
 ('14320000-0000-4000-8000-000000000002','ian@bloomjoysweets.com',statement_timestamp());
insert into public.admin_roles(user_id,role,active) values
 ('14320000-0000-4000-8000-000000000001','super_admin',true),
 ('14320000-0000-4000-8000-000000000002','super_admin',true);
insert into public.email_alert_profiles(user_id,timezone,quiet_enabled)
 select id,'UTC',false from auth.users where id in
 ('14320000-0000-4000-8000-000000000001','14320000-0000-4000-8000-000000000002');
insert into public.refund_automation_runs(id,run_key,trigger_source,scheduled_for,started_at,finished_at,status,reason_counts)
 values('14320000-0000-4000-8001-000000000000','scheduled:technical-once-stale-fixture','scheduled',
 statement_timestamp()-interval '2 hours',statement_timestamp()-interval '2 hours',
 statement_timestamp()-interval '2 hours','succeeded','{}');

create function technical_once_test.runtime() returns jsonb language sql immutable as $$
 select '{"automation":true,"customerContact":true,"manualOutbox":true,"managerDigest":true,"managerReady":true}'::jsonb;
$$;
create function technical_once_test.new_run(n integer) returns uuid language plpgsql as $$
declare rid uuid:=('14320000-0000-4000-8001-'||lpad(n::text,12,'0'))::uuid;
 bucket timestamptz:=date_trunc('day',statement_timestamp())-interval '2 days'+n*interval '1 minute'; key text;
begin
 key:='health_check:'||to_char(bucket at time zone 'UTC','YYYYMMDD"T"HH24MI"Z"');
 insert into public.refund_automation_scheduler_dispatches(mode,bucket_at,run_key,status,dispatched_at)
  values('health_check',bucket,key,'dispatched',bucket);
 insert into public.refund_automation_runs(id,run_key,trigger_source,scheduled_for,started_at,status)
  values(rid,key,'health_check',bucket,statement_timestamp(),'running');
 return rid;
end $$;
create function technical_once_test.new_incident(n integer) returns uuid language plpgsql as $$
declare iid uuid:=('14320000-0000-4000-8002-'||lpad(n::text,12,'0'))::uuid;
begin
 update public.refund_automation_alert_incidents set status='resolved',recovered_at=statement_timestamp(),
  close_reason='stable_recovery' where id::text like '14320000-0000-4000-8002-%' and status='open';
 insert into public.refund_automation_alert_incidents(id,incident_kind,opened_at,last_observed_at,
  initial_notification_claimed_at,last_notification_claimed_at,notification_sequence)
  values(iid,'stale',statement_timestamp()-interval '2 days',statement_timestamp(),
   statement_timestamp()-interval '2 days',statement_timestamp()-interval '1 day',4);
 return iid;
end $$;
create function technical_once_test.claim(n integer,p_sender text default 'Bloomjoy <refunds@bloomjoysweets.com>')
returns jsonb language sql as $$
 select public.service_claim_refund_technical_incident_handoff(
  ('14320000-0000-4000-8001-'||lpad(n::text,12,'0'))::uuid,'stale',p_sender,'https://app.bloomjoyusa.com/refunds');
$$;
create function technical_once_test.mark(p_lane text,p_payload jsonb default null,p_runtime jsonb default technical_once_test.runtime())
returns jsonb language plpgsql as $$ declare c jsonb; begin
 select payload into strict c from technical_once_test.results where lane=p_lane;
 return public.service_mark_refund_technical_handoff_provider_started((c->>'incidentId')::uuid,
  (c->>'claimToken')::uuid,coalesce(p_payload,c->'payload'),p_runtime,'{}'::text[]);
end $$;
create function technical_once_test.settle(p_lane text,p_outcome text,p_provider_id text default null)
returns boolean language plpgsql as $$ declare c jsonb; begin
 select payload into strict c from technical_once_test.results where lane=p_lane;
 return public.service_complete_refund_technical_incident_handoff((c->>'incidentId')::uuid,
  (c->>'claimToken')::uuid,p_outcome,p_provider_id);
end $$;
create function technical_once_test.wait_for_lock() returns boolean language plpgsql as $$ begin
 for i in 1..100 loop
  perform pg_stat_clear_snapshot();
  if exists(select 1 from pg_stat_activity where application_name='technical_once_b' and wait_event_type='Lock') then return true; end if;
  perform pg_sleep(0.01);
 end loop;
 return false;
end $$;
select technical_once_test.new_run(n) from generate_series(1,20)n;
select technical_once_test.new_incident(1);
commit;
select no_plan();
select is(public.service_get_refund_workflow_health(true,true,true,true,true,'{}',statement_timestamp())->>'status',
 'stale','Actual old normal heartbeat creates stale health; running health checks cannot fabricate progress');
select is(has_function_privilege('authenticated','public.service_claim_refund_technical_incident_handoff(uuid,text,text,text)','EXECUTE'),false,
 'Authenticated users cannot create a technical handoff');
select is(has_function_privilege('anon','public.service_mark_refund_technical_handoff_provider_started(uuid,uuid,jsonb,jsonb,text[])','EXECUTE'),false,
 'Anonymous callers cannot cross the provider boundary');
select is(has_function_privilege('service_role','private.refund_technical_handoff_route_allowed(timestamptz)','EXECUTE'),false,
 'Private policy helper is not a direct service endpoint');
select is(public.service_claim_refund_technical_incident_handoff('14320000-0000-4000-8001-000000000000',
 'stale','refunds@bloomjoysweets.com','https://app.bloomjoyusa.com/refunds')->>'claimed','false',
 'A normal run cannot impersonate a primary dispatched health check');

update public.admin_roles set active=false where user_id='14320000-0000-4000-8000-000000000002';
select is(technical_once_test.claim(1)->>'claimed','false','Both approved recipients must retain current Super-admin authority');
update public.admin_roles set active=true where user_id='14320000-0000-4000-8000-000000000002';
update auth.users set banned_until=statement_timestamp()+interval '1 day' where id='14320000-0000-4000-8000-000000000002';
select is(technical_once_test.claim(1)->>'claimed','false','A banned approved account is not an active delivery route');
update auth.users set banned_until=null,deleted_at=statement_timestamp() where id='14320000-0000-4000-8000-000000000002';
select is(technical_once_test.claim(1)->>'claimed','false','A deleted approved account is not replaced with an unrelated Admin');
update auth.users set deleted_at=null,email='unapproved-technical@example.invalid' where id='14320000-0000-4000-8000-000000000002';
select is(technical_once_test.claim(1)->>'claimed','false','Current auth email must match the exact approved recipient policy');
update auth.users set email='ian@bloomjoysweets.com' where id='14320000-0000-4000-8000-000000000002';
update private.email_alert_delivery_settings set delivery_enabled=false where singleton;
select is(technical_once_test.claim(1)->>'claimed','false','Private master disable prevents preparing the alert');
update private.email_alert_delivery_settings set delivery_enabled=true where singleton;
update public.email_alert_profiles set quiet_enabled=true,
 quiet_start=((statement_timestamp() at time zone 'UTC')-interval '1 hour')::time,
 quiet_end=((statement_timestamp() at time zone 'UTC')+interval '1 hour')::time
 where user_id='14320000-0000-4000-8000-000000000002';
select is(technical_once_test.claim(1)->>'claimed','false','Quiet hours for either approved recipient delay the single combined alert');
select is((select count(*) from public.internal_notification_dispatches where event_key like 'refund_technical_incident:14320000-%'),
 0::bigint,'Pre-claim route deferrals create no consumed alert identity');
update public.email_alert_profiles set quiet_enabled=false where user_id='14320000-0000-4000-8000-000000000002';

select dblink_exec('technical_once_a','begin');
insert into technical_once_test.results select 'initial',p from dblink('technical_once_a',
 $$select technical_once_test.claim(1)$$) r(p jsonb);
select dblink_send_query('technical_once_b',$$select technical_once_test.claim(2)$$);
select ok(technical_once_test.wait_for_lock(),'Concurrent workers serialize on the existing incident row');
select dblink_exec('technical_once_a','commit');
insert into technical_once_test.results select 'competing',p from dblink_get_result('technical_once_b') r(p jsonb);
select * from dblink_get_result('technical_once_b') r(p jsonb);
select is((select payload->>'claimed' from technical_once_test.results where lane='initial'),'true',
 'An already-open incident with historical route timestamps receives its first actual mail intent');
select is((select payload->>'claimed' from technical_once_test.results where lane='competing'),'false',
 'Another health run cannot concurrently reserve the same incident');
select is((select count(*) from public.internal_notification_dispatches where source_id='14320000-0000-4000-8002-000000000001'),
 1::bigint,'Actual competing producers commit exactly one durable dispatch');
select is((select payload#>'{payload,to}' from technical_once_test.results where lane='initial'),
 '["etrifari@bloomjoysweets.com","ian@bloomjoysweets.com"]'::jsonb,'Recipients are exactly Ethan and Ian, without Manager/Ops expansion');
select is((select payload#>>'{payload,idempotencyKey}' from technical_once_test.results where lane='initial'),
 'refund_technical_incident_14320000-0000-4000-8002-000000000001','Provider identity is per incident, not run, day or reminder');
select is(technical_once_test.settle('initial','accepted','synthetic-technical-accepted'),false,
 'Acceptance cannot be invented before provider access');
select is(technical_once_test.mark('initial',jsonb_set((select payload->'payload' from technical_once_test.results where lane='initial'),
 '{to}','["unapproved@example.invalid"]'))->>'allowed','false','A forged actual recipient array is rejected before provider access');
select ok(technical_once_test.settle('initial','known_not_sent'),'An exact proven pre-provider non-send preserves the same intent for retry');
select is(technical_once_test.claim(1)->>'claimed','false','One actual health run cannot repeatedly reclaim even a proven non-send');
insert into technical_once_test.results values('retry',technical_once_test.claim(2,'Changed sender <changed@example.invalid>'));
select is((select payload->>'claimed' from technical_once_test.results where lane='retry'),'true',
 'The next actual scheduled opportunity can retry a proven non-send');
select is((select payload->'payload' from technical_once_test.results where lane='retry'),
 (select payload->'payload' from technical_once_test.results where lane='initial'),'Retry retains the complete frozen payload despite changed caller inputs');
select dblink_exec('technical_once_a','begin');
insert into technical_once_test.results select 'provider_first',p from dblink('technical_once_a',
 $$select technical_once_test.mark('retry')$$) r(p jsonb);
select dblink_send_query('technical_once_b',$$select technical_once_test.mark('retry')$$);
select ok(technical_once_test.wait_for_lock(),'Competing provider starts contend on the real incident/dispatch lock');
select dblink_exec('technical_once_a','commit');
insert into technical_once_test.results select 'provider_competing',p from dblink_get_result('technical_once_b') r(p jsonb);
select * from dblink_get_result('technical_once_b') r(p jsonb);
select is((select payload->>'allowed' from technical_once_test.results where lane='provider_first'),'true','Only the first worker crosses the provider boundary');
select is((select payload->>'allowed' from technical_once_test.results where lane='provider_competing'),'false','A second worker cannot start the same provider send');
select is(technical_once_test.settle('retry','known_not_sent'),false,'A provider-started intent cannot be downgraded to proven no-send');
select ok(technical_once_test.settle('retry','accepted','synthetic-technical-accepted'),'Actual acceptance is durably settled');
update public.refund_automation_alert_incidents set incident_kind='workflow_degraded',last_observed_at=statement_timestamp()
 where id='14320000-0000-4000-8002-000000000001';
select is(technical_once_test.claim(3)->>'claimed','false','Accepted handoff never produces a reminder or material-change second send');
select is((select meta->>'state' from public.internal_notification_dispatches where source_id='14320000-0000-4000-8002-000000000001'),
 'accepted','Accepted evidence remains distinct from repair activity and incident resolution');
select is(public.service_get_refund_workflow_health(true,true,true,true,true,'{}',statement_timestamp())#>>'{technicalIncidentHandoff,repairActivity}',
 null,'An accepted email never claims an active technical repair consumer');

select technical_once_test.new_incident(2);
insert into technical_once_test.results values('unknown',technical_once_test.claim(4));
select is(technical_once_test.mark('unknown')->>'allowed','true','A different genuine incident has its own one-time provider opportunity');
select ok(technical_once_test.settle('unknown','delivery_unknown'),'An ambiguous provider outcome is retained durably');
select is(technical_once_test.settle('unknown','known_not_sent'),false,'Unknown provider effect cannot be reopened as a pre-provider failure');
select is(technical_once_test.claim(5)->>'claimed','false','Later health runs cannot retry unknown provider effect');
-- Synthetic passage of time only: preserve the state, token, payload and
-- non-NULL provider marker while moving its timestamps beyond provider TTL.
update public.internal_notification_dispatches set meta=meta||jsonb_build_object(
 'providerStartedAt',statement_timestamp()-interval '2 days','claimedAt',statement_timestamp()-interval '2 days')
 where source_id='14320000-0000-4000-8002-000000000002';
select is(technical_once_test.claim(5)->>'claimed','false','Provider uncertainty remains held after a synthetically expired two-day provider key');
select is((select meta->>'state' from public.internal_notification_dispatches where source_id='14320000-0000-4000-8002-000000000002'),
 'delivery_unknown','Unknown effect remains held without a lifetime lease or provider-key expiry shortcut');

select technical_once_test.new_incident(3);
insert into technical_once_test.results values('quiet',technical_once_test.claim(6));
update public.email_alert_profiles set quiet_enabled=true,
 quiet_start=((statement_timestamp() at time zone 'UTC')-interval '1 hour')::time,
 quiet_end=((statement_timestamp() at time zone 'UTC')+interval '1 hour')::time
 where user_id='14320000-0000-4000-8000-000000000001';
select is(technical_once_test.mark('quiet')->>'allowed','false','Quiet hours beginning after reservation stop provider access');
select is((select meta->>'state' from public.internal_notification_dispatches where source_id='14320000-0000-4000-8002-000000000003'),
 'deferred','Quiet delay does not consume the only alert');
update public.email_alert_profiles set quiet_enabled=false where user_id='14320000-0000-4000-8000-000000000001';
insert into technical_once_test.results values('quiet_resumed',technical_once_test.claim(7));
select is((select payload->>'claimed' from technical_once_test.results where lane='quiet_resumed'),'true','Next actual health opportunity resumes after quiet hours');
select is((select payload->'payload' from technical_once_test.results where lane='quiet_resumed'),
 (select payload->'payload' from technical_once_test.results where lane='quiet'),'Quiet resumption preserves the same event identity and frozen payload');
update private.email_alert_delivery_settings set delivery_enabled=false where singleton;
select is(technical_once_test.mark('quiet_resumed')->>'allowed','false','Master disable after reservation also defers before provider access');
update private.email_alert_delivery_settings set delivery_enabled=true where singleton;
insert into technical_once_test.results values('master_resumed',technical_once_test.claim(8));
select is((select payload->>'claimed' from technical_once_test.results where lane='master_resumed'),'true','Re-enabled master resumes the existing intent on the next health run');
update public.admin_roles set active=false where user_id='14320000-0000-4000-8000-000000000002';
select is(technical_once_test.mark('master_resumed')->>'allowed','false','Current account authority is checked again at provider boundary');
update public.admin_roles set active=true where user_id='14320000-0000-4000-8000-000000000002';
insert into technical_once_test.results values('recovered',technical_once_test.claim(9));
update public.refund_automation_alert_incidents set healthy_since=statement_timestamp()
 where id='14320000-0000-4000-8002-000000000003';
select is(technical_once_test.mark('recovered')->>'allowed','false','Recovery observed before provider access cancels stale alert delivery');
select is((select meta->>'providerStartedAt' from public.internal_notification_dispatches where source_id='14320000-0000-4000-8002-000000000003'),
 null,'Deferred or recovering handoff has no provider-start evidence');
select is(technical_once_test.claim(10)->>'claimed','false','A recovering incident cannot be reclaimed as still unresolved');

select technical_once_test.new_incident(4);
insert into technical_once_test.results values('live_health',technical_once_test.claim(11));
update public.refund_automation_runs set started_at=statement_timestamp(),finished_at=statement_timestamp()
 where id='14320000-0000-4000-8001-000000000000';
select is(technical_once_test.mark('live_health')->>'allowed','false','Fresh current workflow health stops stale alert even before incident bookkeeping closes');
update public.refund_automation_alert_incidents set status='resolved',recovered_at=statement_timestamp(),close_reason='stable_recovery'
 where id='14320000-0000-4000-8002-000000000004';
select is(technical_once_test.claim(12)->>'claimed','false','A resolved incident never gets a late initial handoff');

-- Age only an unattempted fixture lease; never clear provider-start evidence.
update public.refund_automation_runs set started_at=statement_timestamp()-interval '2 hours',
 finished_at=statement_timestamp()-interval '2 hours' where id='14320000-0000-4000-8001-000000000000';
select technical_once_test.new_incident(5);
insert into technical_once_test.results values('lease',technical_once_test.claim(13));
select is(technical_once_test.claim(14)->>'claimed','false','An unexpired pre-provider reservation blocks another health run');
update public.internal_notification_dispatches set meta=jsonb_set(meta,'{claimedAt}',to_jsonb(statement_timestamp()-interval '6 minutes'))
 where source_id='14320000-0000-4000-8002-000000000005';
insert into technical_once_test.results values('lease_reclaimed',technical_once_test.claim(14));
select is((select payload->>'claimed' from technical_once_test.results where lane='lease_reclaimed'),'true',
 'An expired proven-unattempted lease is reclaimable by a different actual health run');
select is((select payload->'payload' from technical_once_test.results where lane='lease_reclaimed'),
 (select payload->'payload' from technical_once_test.results where lane='lease'),'Lease recovery preserves the frozen intent');
select is(technical_once_test.mark('lease')->>'allowed','false','The superseded lease token cannot cross the provider boundary');
select is(technical_once_test.mark('lease_reclaimed')->>'allowed','true','Only the current lease can mark provider access');
select ok(technical_once_test.settle('lease_reclaimed','delivery_unknown'),'A crash after recovered lease provider access remains uncertain');
select is(technical_once_test.claim(15)->>'claimed','false','Lease expiry cannot reopen an intent after its provider marker exists');
select ok((select cases=(select count(*) from public.refund_cases)
 and messages=(select count(*) from public.refund_case_messages)
 and attempts=(select count(*) from public.refund_case_nayax_refund_attempts)
 from technical_once_test.protected_counts),'Alert delivery guards never change customer cases, customer messages or payment attempts');

select dblink_disconnect('technical_once_a');
select dblink_disconnect('technical_once_b');
begin;
delete from public.internal_notification_dispatches where event_key like 'refund_technical_incident:14320000-0000-4000-8002-%';
delete from public.refund_automation_alert_incidents where id::text like '14320000-0000-4000-8002-%';
delete from public.refund_automation_scheduler_dispatches where run_key in(select run_key from public.refund_automation_runs
 where id::text like '14320000-0000-4000-8001-%');
delete from public.refund_automation_runs where id::text like '14320000-0000-4000-8001-%';
update public.refund_automation_runs r set started_at=b.started_at,finished_at=b.finished_at
 from technical_once_test.prior_runs b where r.id=b.id;
update public.refund_automation_alert_incidents i set status=b.status,recovered_at=b.recovered_at,
 close_reason=b.close_reason,updated_at=b.updated_at from technical_once_test.prior_incidents b where i.id=b.id;
delete from public.email_alert_profiles where user_id in('14320000-0000-4000-8000-000000000001','14320000-0000-4000-8000-000000000002');
delete from public.admin_roles where user_id in('14320000-0000-4000-8000-000000000001','14320000-0000-4000-8000-000000000002');
delete from auth.users where id in('14320000-0000-4000-8000-000000000001','14320000-0000-4000-8000-000000000002');
update private.email_alert_delivery_settings s set delivery_enabled=(b.personal->>'delivery_enabled')::boolean,
 activated_at=(b.personal->>'activated_at')::timestamptz from technical_once_test.settings b where s.singleton;
update public.refund_automation_scheduler_settings s set enabled=b.scheduler_enabled from technical_once_test.settings b where s.singleton;
set constraints all immediate;
drop schema technical_once_test cascade;
commit;
select * from finish();
