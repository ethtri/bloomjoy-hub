begin;
create extension if not exists pgtap with schema extensions;
set local search_path=public,extensions;
select no_plan();

-- Retain the actually deployed #1717 helper as the comparison implementation.
-- Both paths use the real canonical lifecycle, personal schedule and job ledger.
create function pg_temp.daily_health_before(p_observed_at timestamptz)
returns jsonb language plpgsql volatile security definer set search_path='' as $$
declare u record;s record;j private.email_alert_jobs;recipient text;open_users integer:=0;invalid_users integer:=0;missed integer:=0;
 sent_count integer;unknown_count integer;local_day date;zone text;projection jsonb;
begin
 for u in select distinct m.manager_user_id id from public.reporting_machine_refund_managers m
   where m.status='active' and m.revoked_at is null loop
  if not exists(select 1 from private.email_alert_selected_scope(u.id,'daily')) then continue;end if;
  select lower(btrim(email)) into recipient from auth.users where id=u.id and deleted_at is null and (banned_until is null or banned_until<=p_observed_at);
  if recipient is null then continue;end if;
  projection:=public.refund_manager_daily_digest_projection_for(u.id,p_observed_at);
  if coalesce((projection->>'openCount')::int,0)=0 then continue;end if;
  open_users:=open_users+1;
  if not public.refund_email_address_is_valid(recipient) then invalid_users:=invalid_users+1;continue;end if;
  if not(select delivery_enabled from private.email_alert_delivery_settings) then continue;end if;
  zone:=private.email_alert_context(u.id)#>>'{settings,timezone}';local_day:=(p_observed_at at time zone zone)::date;
  for s in select * from private.email_alert_digest_schedule(u.id,'daily',p_observed_at) d
    where (d.due_at at time zone zone)::date=local_day and p_observed_at>=d.due_at+interval '90 minutes' loop
   select * into j from private.email_alert_jobs where user_id=u.id and category='daily' and slot_key='daily:'||s.date_to::text;
   if j.id is null or j.state='known_not_sent' or (j.state='reserved' and j.updated_at<p_observed_at-interval '30 minutes') then missed:=missed+1;end if;
  end loop;
 end loop;
 select count(*) filter(where state='sent'),count(*) filter(where state='delivery_unknown') into sent_count,unknown_count
  from private.email_alert_jobs where category='daily' and observed_at>=date_trunc('day',p_observed_at);
 return jsonb_build_object('openRecipientCount',open_users,'invalidRouteRecipientCount',invalid_users,
  'missedDueRecipientCount',missed,'sentBatchCountToday',sent_count,'deliveryUnknownBatchCountToday',unknown_count,'payloadRedacted',true);
end $$;

set local session_replication_role=replica;
insert into auth.users(id,email) values
 ('ec710000-0000-4000-8000-000000000001','health-manager@example.invalid'),
 ('ec710000-0000-4000-8000-000000000002','health-other@example.invalid');
insert into public.customer_accounts(id,name,account_type)
 values('ec720000-0000-4000-8000-000000000001','Health presence fixture','internal');
insert into public.reporting_locations(id,account_id,name,timezone)
 values('ec730000-0000-4000-8000-000000000001','ec720000-0000-4000-8000-000000000001','Health fixture','America/Los_Angeles');
insert into public.reporting_machines(id,account_id,location_id,machine_label,status) values
 ('ec740000-0000-4000-8000-000000000001','ec720000-0000-4000-8000-000000000001','ec730000-0000-4000-8000-000000000001','Assigned health fixture','active'),
 ('ec740000-0000-4000-8000-000000000002','ec720000-0000-4000-8000-000000000001','ec730000-0000-4000-8000-000000000001','Foreign health fixture','active');
insert into public.reporting_machine_refund_managers(reporting_machine_id,manager_user_id,manager_email,status)
 values('ec740000-0000-4000-8000-000000000001','ec710000-0000-4000-8000-000000000001','health-manager@example.invalid','active');
insert into public.refund_cases(id,public_reference,reporting_machine_id,reporting_location_id,customer_email,
 issue_summary,incident_at,payment_method,payment_amount_cents,refund_amount_cents,status,created_at) values
 ('ec760000-0000-4000-8000-000000000001','RF-HEALTH-PRESENCE-1','ec740000-0000-4000-8000-000000000001','ec730000-0000-4000-8000-000000000001','health-case@example.invalid','Synthetic research','2026-10-02T12:00Z','card',500,500,'needs_review','2026-10-02T12:00Z'),
 ('ec760000-0000-4000-8000-000000000002','RF-HEALTH-PRESENCE-2','ec740000-0000-4000-8000-000000000001','ec730000-0000-4000-8000-000000000001','health-case@example.invalid','Synthetic research','2026-10-02T13:00Z','card',500,500,'needs_review','2026-10-02T13:00Z'),
 ('ec760000-0000-4000-8000-000000000003','RF-HEALTH-PRESENCE-3','ec740000-0000-4000-8000-000000000001','ec730000-0000-4000-8000-000000000001','health-case@example.invalid','Synthetic research','2026-10-02T14:00Z','card',500,500,'needs_review','2026-10-02T14:00Z'),
 ('ec760000-0000-4000-8000-000000000004','RF-HEALTH-PRESENCE-FOREIGN','ec740000-0000-4000-8000-000000000002','ec730000-0000-4000-8000-000000000001','health-case@example.invalid','Synthetic foreign research','2026-10-02T11:00Z','card',500,500,'needs_review','2026-10-02T11:00Z');
set local session_replication_role=origin;
update private.email_alert_delivery_settings set delivery_enabled=true,activated_at='2026-10-03T12:00Z';
select set_config('request.jwt.claim.sub','ec710000-0000-4000-8000-000000000002',true);
select set_config('request.jwt.claims','{"sub":"ec710000-0000-4000-8000-000000000002","role":"authenticated","is_anonymous":false}',true);
create temp table original_context as select current_setting('request.jwt.claim.sub') sub,current_setting('request.jwt.claims') claims;

-- Count real lifecycle/digest executor calls while forwarding to their actual
-- implementations, rather than asserting only a textual SQL shape.
create temporary sequence lifecycle_evaluations;
create temporary sequence digest_evaluations;
do $$declare definition text;begin
 definition:=pg_get_functiondef('public.refund_lifecycle_contract(uuid)'::regprocedure);
 execute replace(definition,'public.refund_lifecycle_contract(', 'pg_temp.original_lifecycle(');
 definition:=pg_get_functiondef('public.refund_manager_daily_digest_projection_for(uuid,timestamptz)'::regprocedure);
 execute replace(definition,'public.refund_manager_daily_digest_projection_for(', 'pg_temp.original_digest(');
end $$;
create or replace function public.refund_lifecycle_contract(p_refund_case_id uuid)
returns jsonb language plpgsql volatile security definer set search_path='' as $$
declare result jsonb;
begin
 perform nextval('pg_temp.lifecycle_evaluations');
 result:=pg_temp.original_lifecycle(p_refund_case_id);
 if current_setting('test.health_presence_corrupt',true)='true' then
  result:=jsonb_set(result,'{nextWork,isOpen}','"unavailable"'::jsonb);
 end if;
 return result;
end $$;
create or replace function public.refund_manager_daily_digest_projection_for(p_manager_user_id uuid,p_observed_at timestamptz default statement_timestamp())
returns jsonb language plpgsql volatile security definer set search_path='' as $$
begin
 perform nextval('pg_temp.digest_evaluations');
 return pg_temp.original_digest(p_manager_user_id,p_observed_at);
end $$;

create temporary table previous_health as select pg_temp.daily_health_before('2026-10-03T20:00Z') value;
create temporary table previous_calls as select (select last_value from lifecycle_evaluations) lifecycle_calls,(select last_value from digest_evaluations) digest_calls;
select setval('pg_temp.lifecycle_evaluations',1,false);
select setval('pg_temp.digest_evaluations',1,false);
create temporary table current_health as select private.email_alert_daily_health('2026-10-03T20:00Z') value;
select is((select value from current_health),(select value from previous_health),'Complete health payload matches the deployed full-digest helper');
select is((select value->>'openRecipientCount' from current_health),'1','Canonical open work counts its assigned recipient');
select is((select last_value from lifecycle_evaluations),1::bigint,'Three open cases require only the first canonical lifecycle evaluation');
select is((select is_called from digest_evaluations),false,'Health does not build a digest or its per-item prepared purchase proof');
select ok((select lifecycle_calls from previous_calls)>1,'The prior implementation demonstrably traversed additional cases');
select is((select digest_calls from previous_calls),1::bigint,'Reference implementation actually built the Manager digest');
select is(current_setting('request.jwt.claim.sub'),(select sub from original_context),'Successful health restores the caller subject');
select is(current_setting('request.jwt.claims'),(select claims from original_context),'Successful health restores all caller claims');

set local session_replication_role=replica;
insert into public.refund_cases(id,public_reference,reporting_machine_id,reporting_location_id,customer_email,
 issue_summary,incident_at,payment_method,payment_amount_cents,status,decision,created_at)
 values('ec760000-0000-4000-8000-000000000005','RF-HEALTH-PRESENCE-CLOSED','ec740000-0000-4000-8000-000000000001','ec730000-0000-4000-8000-000000000001',
 'health-case@example.invalid','Synthetic closed prefix','2026-10-01T12:00Z','card',500,'denied','denied','2026-10-01T12:00Z');
set local session_replication_role=origin;
select setval('pg_temp.lifecycle_evaluations',1,false);
create temporary table prefix_health as select private.email_alert_daily_health('2026-10-03T20:00Z') value;
select is((select last_value from lifecycle_evaluations),2::bigint,'Closed prefix is skipped before stopping at the first open case');
select is((select value from prefix_health),pg_temp.daily_health_before('2026-10-03T20:00Z'),'Closed prefix preserves complete health parity');

insert into public.email_alert_preferences(user_id,alert_id,enabled) values('ec710000-0000-4000-8000-000000000001','daily',false);
select setval('pg_temp.lifecycle_evaluations',1,false);
select is(private.email_alert_daily_health('2026-10-03T20:00Z'),pg_temp.daily_health_before('2026-10-03T20:00Z'),'Daily opt-out preserves full health parity');
select is((select is_called from lifecycle_evaluations),false,'Opt-out performs no lifecycle work');
update public.email_alert_preferences set enabled=true where user_id='ec710000-0000-4000-8000-000000000001' and alert_id='daily';
insert into public.email_alert_profiles(user_id,daily_time) values('ec710000-0000-4000-8000-000000000001','10:00');
select is(private.email_alert_daily_health('2026-10-03T17:00Z'),pg_temp.daily_health_before('2026-10-03T17:00Z'),'Chosen later time preserves exact personal schedule health');
select is(private.email_alert_daily_health('2026-10-03T17:00Z')->>'missedDueRecipientCount','0','Chosen later time is not an old 08:00 obligation');
select is(private.email_alert_daily_health('2026-10-03T20:00Z')->>'missedDueRecipientCount','1','An actually missed chosen daily time stays actionable');
update auth.users set email='invalid-route' where id='ec710000-0000-4000-8000-000000000001';
select is(private.email_alert_daily_health('2026-10-03T20:00Z'),pg_temp.daily_health_before('2026-10-03T20:00Z'),'Invalid current route preserves full health parity');
select is(private.email_alert_daily_health('2026-10-03T20:00Z')->>'invalidRouteRecipientCount','1','Invalid route remains visible rather than healthy');
update auth.users set email='health-manager@example.invalid' where id='ec710000-0000-4000-8000-000000000001';
insert into private.email_alert_jobs(user_id,category,slot_key,observed_at,date_from,date_to,state,route_fingerprint,projection_fingerprint,provider_started_at)
 values('ec710000-0000-4000-8000-000000000001','daily','daily:2026-10-02','2026-10-03T17:00Z','2026-10-02','2026-10-02','delivery_unknown',repeat('a',64),repeat('b',64),'2026-10-03T17:00Z');
select is(private.email_alert_daily_health('2026-10-03T20:00Z'),pg_temp.daily_health_before('2026-10-03T20:00Z'),'Unknown provider outcome and due-slot counts preserve full parity');
select is(private.email_alert_daily_health('2026-10-03T20:00Z')->>'deliveryUnknownBatchCountToday','1','Unknown outcome remains distinct and is not retried');
update private.email_alert_jobs set state='sent' where category='daily';
select is(private.email_alert_daily_health('2026-10-03T20:00Z'),pg_temp.daily_health_before('2026-10-03T20:00Z'),'Sent batches preserve full health parity');
select is(private.email_alert_daily_health('2026-10-03T20:00Z')->>'sentBatchCountToday','1','Accepted daily slot remains counted');
update private.email_alert_delivery_settings set delivery_enabled=false;
select is(private.email_alert_daily_health('2026-10-03T20:00Z'),pg_temp.daily_health_before('2026-10-03T20:00Z'),'Paused delivery keeps open-work and receipt truth without false due mail');

insert into public.reporting_machine_refund_managers(reporting_machine_id,manager_user_id,manager_email,status)
 values('ec740000-0000-4000-8000-000000000001','ec710000-0000-4000-8000-000000000002','health-other@example.invalid','active');
select is(private.email_alert_daily_health('2026-10-03T20:00Z'),pg_temp.daily_health_before('2026-10-03T20:00Z'),'Co-managers retain independent canonical open-work presence');
select is(private.email_alert_daily_health('2026-10-03T20:00Z')->>'openRecipientCount','2','Presence is counted separately for each current Manager');

select set_config('test.health_presence_corrupt','true',true);
select throws_ok($$select private.email_alert_daily_health('2026-10-03T20:00Z')$$,'P4652','Unsupported refund next-work contract','Unavailable canonical open-work evidence fails closed');
select is(current_setting('request.jwt.claim.sub'),(select sub from original_context),'Failed health restores the caller subject');
select is(current_setting('request.jwt.claims'),(select claims from original_context),'Failed health restores all caller claims');
select set_config('test.health_presence_corrupt','false',true);
set local session_replication_role=replica;
update public.refund_cases set status='denied',decision='denied' where reporting_machine_id='ec740000-0000-4000-8000-000000000001';
set local session_replication_role=origin;
select is(private.email_alert_daily_health('2026-10-03T20:00Z'),pg_temp.daily_health_before('2026-10-03T20:00Z'),'Closed-only assigned cases preserve full health parity');
select is(private.email_alert_daily_health('2026-10-03T20:00Z')->>'openRecipientCount','0','An open foreign-machine case cannot create an assigned obligation');
select ok(not has_function_privilege('authenticated','private.email_alert_daily_health(timestamptz)','execute'),'Health helper remains unavailable to authenticated clients');
select ok(not has_function_privilege('anon','private.email_alert_daily_health(timestamptz)','execute'),'Health helper remains unavailable to anonymous clients');
select is(private.email_alert_daily_health('2026-10-03T20:00Z')->>'payloadRedacted','true','Health remains a redacted monitoring payload');
select * from finish();
rollback;
