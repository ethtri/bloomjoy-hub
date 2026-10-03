begin;
create extension if not exists pgtap with schema extensions;
set local search_path=public,extensions;
select no_plan();
set local session_replication_role=replica;
insert into auth.users(id,email) values
 ('ef710000-0000-4000-8000-000000000001','ready-opt-in@example.invalid'),
 ('ef710000-0000-4000-8000-000000000002','ready-off@example.invalid');
insert into public.customer_accounts(id,name,account_type)
 values('ef720000-0000-4000-8000-000000000001','Ready scope fixture','internal');
insert into public.reporting_locations(id,account_id,name,timezone)
 values('ef730000-0000-4000-8000-000000000001','ef720000-0000-4000-8000-000000000001','Ready scope fixture','America/Los_Angeles');
insert into public.reporting_machines(id,account_id,location_id,machine_label,status) values
 ('ef740000-0000-4000-8000-000000000001','ef720000-0000-4000-8000-000000000001','ef730000-0000-4000-8000-000000000001','Selected ready machine','active'),
 ('ef740000-0000-4000-8000-000000000002','ef720000-0000-4000-8000-000000000001','ef730000-0000-4000-8000-000000000001','Unselected ready machine','active');
insert into public.reporting_machine_refund_managers(reporting_machine_id,manager_user_id,manager_email,status)
 select m.id,u.id,u.email,'active' from public.reporting_machines m cross join auth.users u
 where m.account_id='ef720000-0000-4000-8000-000000000001' and u.id='ef710000-0000-4000-8000-000000000001';
insert into public.reporting_machine_refund_managers(reporting_machine_id,manager_user_id,manager_email,status)
 values('ef740000-0000-4000-8000-000000000001','ef710000-0000-4000-8000-000000000002','ready-off@example.invalid','active');
insert into public.refund_cases(id,public_reference,reporting_machine_id,reporting_location_id,customer_email,issue_summary,
 incident_at,payment_method,payment_amount_cents,refund_amount_cents,status,customer_request_received_at,customer_request_received_source)
 select ('ef760000-0000-4000-8000-'||lpad(i::text,12,'0'))::uuid,'RF-READY-SCOPE-'||i,
  case when i=13 then 'ef740000-0000-4000-8000-000000000002'::uuid else 'ef740000-0000-4000-8000-000000000001'::uuid end,
  'ef730000-0000-4000-8000-000000000001','customer@example.invalid','Synthetic symptom','2026-10-03T01:00Z',
  'card',500,500,'needs_review','2026-10-03T01:00Z','hosted_refund_intake' from generate_series(1,13) i;
insert into public.refund_cases(id,public_reference,reporting_machine_id,reporting_location_id,customer_email,issue_summary,
 incident_at,payment_method,payment_amount_cents,refund_amount_cents,zelle_payment_contact,status,decision,correlation_status,
 correlation_source,automation_state,deterministic_fact_version,created_at)
 values('ef760000-0000-4000-8000-000000000014','RF-READY-SCOPE-14','ef740000-0000-4000-8000-000000000001',
 'ef730000-0000-4000-8000-000000000001','customer@example.invalid','Synthetic approved payout','2026-10-02T12:00Z',
 'cash',725,725,'synthetic-payout','cash_zelle_pending','approved','matched','manual','under_review',1,'2026-10-02T12:00Z');
set local session_replication_role=origin;

-- Observe actual snapshot calls while retaining the canonical implementation.
-- This proves disabled/excluded work is skipped before the expensive traversal.
create temporary table ready_snapshot_probes(case_id uuid,manager_id uuid);
do $$declare definition text;start_at integer;begin
 definition:=pg_get_functiondef('public.service_refund_manager_ready_notice_snapshot(uuid,uuid,timestamptz)'::regprocedure);
 start_at:=strpos(definition,E'begin\n');
 if start_at=0 then raise exception 'Snapshot probe insertion point changed';end if;
 definition:=overlay(definition placing E'begin\n insert into pg_temp.ready_snapshot_probes values(p_refund_case_id,p_manager_user_id);\n' from start_at for 6);
 execute definition;
end $$;
select is(public.service_enqueue_refund_manager_ready_notices('ef760000-0000-4000-8000-000000000014','2026-10-03T15:00Z')->>'queuedCount',
 '2','Before first adoption the legacy case producer retains both mapped-manager notices');
truncate ready_snapshot_probes;
update private.email_alert_delivery_settings set delivery_enabled=true,activated_at='2026-10-03T14:00Z' where singleton;
select is(public.service_enqueue_refund_manager_ready_notices(null,'2026-10-03T15:00Z')->>'reason','no_current_subscriptions','Default-off ready lane exits before scanning history');
select is((select count(*)::integer from ready_snapshot_probes),0,'Zero subscribers cause zero canonical snapshot calls');
select is(public.service_claim_next_refund_manager_ready_notice(null,'2026-10-03T15:00Z')->>'reason','no_current_subscriptions','Existing legacy ready rows do not trigger claim traversal without opt-in');
select is((select count(*)::integer from public.refund_manager_notification_actions where notice_reason='decision_ready' and delivery_state='ready_queued'),2,'Default-off preserves existing durable rows without reserving them');
select is((select ready_scan_after_case_id from private.email_alert_delivery_settings),null,'Zero-subscriber ticks do not advance a fake scan cursor');

-- A forged scope on an unassigned machine still cannot authorize a producer.
insert into public.email_alert_preferences(user_id,alert_id,enabled,scope_mode,machine_ids)
 values('ef710000-0000-4000-8000-000000000002','decision-ready',true,'selected',array['ef740000-0000-4000-8000-000000000002'::uuid]);
select is(public.service_enqueue_refund_manager_ready_notices(null,'2026-10-03T15:00Z')->>'scannedCount','0','Stored preferences grant no new machine authority');
insert into public.email_alert_preferences(user_id,alert_id,enabled,scope_mode,machine_ids)
 values('ef710000-0000-4000-8000-000000000001','decision-ready',true,'selected',array['ef740000-0000-4000-8000-000000000001'::uuid]);
create temporary table ready_scan_results(n integer,p jsonb);
insert into ready_scan_results values(1,public.service_enqueue_refund_manager_ready_notices(null,'2026-10-03T15:00Z'));
insert into ready_scan_results values(2,public.service_enqueue_refund_manager_ready_notices(null,'2026-10-03T15:05Z'));
insert into ready_scan_results values(3,public.service_enqueue_refund_manager_ready_notices(null,'2026-10-03T15:10Z'));
select ok((select bool_and(p->>'scannedCount'='5' and p->>'scanLimited'='true') from ready_scan_results),'Each global enqueue evaluates at most five subscribed cases');
select is((select count(distinct case_id)::integer from ready_snapshot_probes),13,'Rotating batches eventually cover all selected cases beyond the first five');
select is((select count(*)::integer from ready_snapshot_probes where case_id='ef760000-0000-4000-8000-000000000013'),0,'Unselected machine never enters canonical readiness work');
select is((select count(*)::integer from ready_snapshot_probes where manager_id='ef710000-0000-4000-8000-000000000002'),0,'Other mapped managers remain excluded unless their own machine scope is enabled');
select is((select count(*)::integer from public.refund_manager_notification_actions where notice_reason='decision_ready'),2,'Scoped enqueue reuses mature decision identities without duplicate actions');
create temporary table optional_ready_claim as select public.service_claim_next_refund_manager_ready_notice(null,'2026-10-03T15:10Z') p;
select is((select p->>'claimed' from optional_ready_claim),'true','An eligible subscriber can claim the existing canonical ready action');
select is((select p->>'recipient' from optional_ready_claim),'ready-opt-in@example.invalid','Claim still routes to the authorized current manager');
select is((select p#>>'{projection,actionCode}' from optional_ready_claim),'send_cash_refund_and_confirm','Canonical approved-payout action remains intact');
select is(public.service_claim_next_refund_manager_ready_notice(null,'2026-10-03T15:10Z')->>'claimed','false','An excluded manager action cannot be claimed after the subscribed action is reserved');

truncate ready_snapshot_probes;
update public.reporting_machine_refund_managers set status='revoked',revoked_at='2026-10-03T15:11Z',revoke_reason='Synthetic revoke'
 where manager_user_id='ef710000-0000-4000-8000-000000000001' and reporting_machine_id='ef740000-0000-4000-8000-000000000001';
select is(public.service_enqueue_refund_manager_ready_notices(null,'2026-10-03T15:15Z')->>'reason','no_current_subscriptions','Revocation removes source work despite a saved opt-in');
select is((select count(*)::integer from ready_snapshot_probes),0,'Revocation avoids expensive snapshots');
update public.reporting_machine_refund_managers set status='active',revoked_at=null,revoke_reason=null
 where manager_user_id='ef710000-0000-4000-8000-000000000001' and reporting_machine_id='ef740000-0000-4000-8000-000000000001';
update auth.users set banned_until='2027-01-01' where id='ef710000-0000-4000-8000-000000000001';
select is(public.service_enqueue_refund_manager_ready_notices(null,'2026-10-03T15:15Z')->>'reason','no_current_subscriptions','Banned recipients cannot generate optional ready work');
update auth.users set banned_until=null where id='ef710000-0000-4000-8000-000000000001';
insert into public.email_alert_profiles(user_id,timezone,quiet_enabled,quiet_start,quiet_end)
 values('ef710000-0000-4000-8000-000000000001','America/Los_Angeles',true,'07:00','10:00');
select is(public.service_enqueue_refund_manager_ready_notices(null,'2026-10-03T15:15Z')->>'reason','no_current_subscriptions','Quiet hours defer optional producer work without dropping its durable cursor');
update private.email_alert_delivery_settings set delivery_enabled=false where singleton;
select is(public.service_enqueue_refund_manager_ready_notices(null,'2026-10-03T18:00Z')->>'reason','delivery_disabled','Pause after cutover never resumes global legacy scans');
select is((select count(*)::integer from ready_snapshot_probes),0,'Quiet, banned and paused ticks perform zero canonical snapshots');
select ok(not has_function_privilege('authenticated','private.email_alert_current_ready_scope(timestamptz)','execute'),'Current recipient scope is not exposed to clients');
select * from finish();
rollback;
