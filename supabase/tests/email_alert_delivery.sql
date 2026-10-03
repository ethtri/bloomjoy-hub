begin;
create extension if not exists pgtap with schema extensions;
set local search_path=public,extensions;
select no_plan();
set local session_replication_role=replica;
insert into auth.users(id,email) values
 ('eb710000-0000-4000-8000-000000000001','manager@example.invalid'),
 ('eb710000-0000-4000-8000-000000000002','tech@example.invalid');
insert into public.customer_accounts(id,name,account_type) values('eb720000-0000-4000-8000-000000000001','Email fixture','internal');
insert into public.reporting_locations(id,account_id,name,timezone) values
 ('eb730000-0000-4000-8000-000000000001','eb720000-0000-4000-8000-000000000001','West coast','America/Los_Angeles');
insert into public.reporting_machines(id,account_id,location_id,machine_label,status) values
 ('eb740000-0000-4000-8000-000000000001','eb720000-0000-4000-8000-000000000001','eb730000-0000-4000-8000-000000000001','Assigned','active'),
 ('eb740000-0000-4000-8000-000000000002','eb720000-0000-4000-8000-000000000001','eb730000-0000-4000-8000-000000000001','Additional assigned','active');
insert into public.reporting_machine_refund_managers(reporting_machine_id,manager_user_id,manager_email,status) values
 ('eb740000-0000-4000-8000-000000000001','eb710000-0000-4000-8000-000000000001','manager@example.invalid','active');
insert into public.technician_grants(id,account_id,sponsor_user_id,technician_email,technician_user_id,status,starts_at,grant_reason) values
 ('eb750000-0000-4000-8000-000000000001','eb720000-0000-4000-8000-000000000001','eb710000-0000-4000-8000-000000000001',
 'tech@example.invalid','eb710000-0000-4000-8000-000000000002','active','2020-01-01','Synthetic test');
insert into public.technician_machine_assignments(technician_grant_id,machine_id,status,starts_at,grant_reason) values
 ('eb750000-0000-4000-8000-000000000001','eb740000-0000-4000-8000-000000000001','active','2020-01-01','Synthetic test');
insert into public.refund_cases(id,public_reference,reporting_machine_id,reporting_location_id,customer_email,issue_summary,incident_at,
 payment_method,payment_amount_cents,refund_amount_cents,status,customer_request_received_at,customer_request_received_source) values
 ('eb760000-0000-4000-8000-000000000001','RF-EMAIL-1','eb740000-0000-4000-8000-000000000001','eb730000-0000-4000-8000-000000000001',
 'private@example.invalid','Machine did not dispense. Jane Smith lives 123 Private Street. Email private@example.invalid. Card 4111 1111 1111 1111. Gift code SECRET123',
 '2026-10-02T12:00Z','card',500,500,'needs_review','2026-10-02T12:00Z','hosted_refund_intake');
set local session_replication_role=origin;
select set_config('request.jwt.claim.sub','eb710000-0000-4000-8000-000000000002',true);
select is((select a->>'enabled' from jsonb_array_elements(public.get_my_email_alert_preferences()->'alerts') a where a->>'id'='daily'),'true','Technician daily defaults on');
select is((select a->>'authorized' from jsonb_array_elements(public.get_my_email_alert_preferences()->'alerts') a where a->>'id'='decision-ready'),'false','Technician assignment does not authorize decisions');
select is((select a->>'authorized' from jsonb_array_elements(public.get_my_email_alert_preferences()->'alerts') a where a->>'id'='sales-quiet'),'false','Technician without reporting cannot authorize financial comparison alerts');
create temporary table email_projection as select private.email_alert_projection('eb710000-0000-4000-8000-000000000002','daily','2026-10-03T15:00Z','2026-10-02','2026-10-02') p;
select is((select p#>>'{machines,0,refundCases,0,commentExcerpt}' from email_projection),'Customer reported that the machine did not dispense.','Technician gets fixed symptom only');
select ok((select p::text not like '%Jane%' and p::text not like '%Private Street%' and p::text not like '%4111%' and p::text not like '%SECRET123%' and p::text not like '%example.invalid%' from email_projection),'Adversarial personal/payment/code details never enter technician projection');
select is((select p#>>'{machines,0,refundCases,0,canOpenCase}' from email_projection),'false','Operational subscription grants no case detail access');
select is((select p#>>'{machines,0,grossSalesCents}' from email_projection),null,'No source rows stay unknown rather than zero');
select is((select p#>>'{machines,0,coverageStatus}' from email_projection),'unavailable','Unknown source has explicit coverage state');
select ok(not has_function_privilege('authenticated','public.service_claim_next_email_alert(timestamptz)','execute'),'Clients cannot claim mail');
select ok(not has_function_privilege('anon','public.service_preview_email_alerts(timestamptz)','execute'),'Preview is service-only');
select ok(not has_function_privilege('authenticated','public.service_mark_email_alert_provider_started(uuid,uuid,text,text)','execute'),'Clients cannot cross provider boundary');
select is((public.service_claim_next_email_alert('2026-10-03T15:00Z')->>'reason'),'delivery_disabled','Migration starts delivery off');
select is((select count(*)::int from private.email_alert_jobs),0,'Disabled claim writes no jobs');
select lives_ok($$select public.service_preview_email_alerts('2026-10-03T15:00Z')$$,'No-send preview builds real projection');
select is((select count(*)::int from private.email_alert_jobs),0,'Preview never reserves jobs');
select is((select count(*)::int from public.refund_manager_digest_batches),0,'Preview never reserves legacy slots');
insert into public.email_alert_profiles(user_id,daily_time,quiet_start,quiet_end) values
 ('eb710000-0000-4000-8000-000000000002','21:00','20:00','07:00');
select is((select count(*)::int from private.email_alert_due_candidates('2026-10-03T04:00Z') where user_id='eb710000-0000-4000-8000-000000000002'),0,'Quiet evening digest is deferred');
select is((select count(*)::int from private.email_alert_due_candidates('2026-10-03T14:00Z') where user_id='eb710000-0000-4000-8000-000000000002'),1,'Deferred digest becomes due next morning');
select is(private.email_alert_projection('eb710000-0000-4000-8000-000000000002','daily','2026-10-03T14:00Z','2026-10-01','2026-10-01')#>>'{machines,0,dateTo}',
 '2026-10-01','Friday evening deferred to Saturday morning preserves Thursday reporting period');
update public.email_alert_profiles set daily_time='02:30',quiet_enabled=false where user_id='eb710000-0000-4000-8000-000000000002';
select is((select due_at from private.email_alert_digest_schedule('eb710000-0000-4000-8000-000000000002','daily','2026-03-08T11:00Z') where schedule_date='2026-03-08'),'2026-03-08T10:30Z'::timestamptz,'Nonexistent DST time follows native IANA conversion');
update public.email_alert_profiles set daily_time='01:30' where user_id='eb710000-0000-4000-8000-000000000002';
select is((select due_at from private.email_alert_digest_schedule('eb710000-0000-4000-8000-000000000002','daily','2026-11-01T10:00Z') where schedule_date='2026-11-01'),'2026-11-01T09:30Z'::timestamptz,'Repeated DST local time has one scheduled instant');
update public.email_alert_profiles set daily_time='08:00' where user_id='eb710000-0000-4000-8000-000000000002';
update private.email_alert_delivery_settings set delivery_enabled=true,activated_at=statement_timestamp();
select is((public.service_begin_next_refund_manager_digest('2026-10-03T15:00Z')->>'reason'),'personal_alert_sender_owns_daily','Activated owner prevents legacy schedule racing');
select is(private.email_alert_ready_allowed('eb710000-0000-4000-8000-000000000001','eb740000-0000-4000-8000-000000000001','2026-10-03T15:00Z'),false,'Decision-ready defaults off after activation');
create temporary table email_claim as select public.service_claim_next_email_alert('2026-10-03T15:00Z') c;
select is((select c->>'claimed' from email_claim),'true','Due manager daily claims');
select ok((select c->>'idempotencyKey'~'^[A-Za-z0-9_-]{1,200}$' from email_claim),'Transport-compatible stable idempotency key');
select is((select count(*)::int from public.refund_manager_digest_batches),1,'Unified manager email reserves canonical daily slot');
update public.email_alert_preferences set enabled=false where user_id='eb710000-0000-4000-8000-000000000001' and alert_id='daily';
insert into public.email_alert_preferences(user_id,alert_id,enabled) values('eb710000-0000-4000-8000-000000000001','daily',false) on conflict do nothing;
select is((select public.service_mark_email_alert_provider_started((c->>'jobId')::uuid,(c->>'claimToken')::uuid,c->>'recipient',c->>'routeFingerprint') from email_claim),false,'Opt-out after claim blocks provider start');
select is((select state from private.email_alert_jobs where user_id='eb710000-0000-4000-8000-000000000001'),'known_not_sent','Blocked provider transition records definitive unsent');
truncate email_claim;
insert into email_claim select public.service_claim_next_email_alert('2026-10-03T15:00Z');
select is((select c->>'recipient' from email_claim),'tech@example.invalid','Current authenticated email used for eligible technician');
select is((select public.service_mark_email_alert_provider_started((c->>'jobId')::uuid,(c->>'claimToken')::uuid,c->>'recipient',c->>'routeFingerprint') from email_claim),true,'Current projection may start once');
select is((select public.service_mark_email_alert_provider_started((c->>'jobId')::uuid,(c->>'claimToken')::uuid,c->>'recipient',c->>'routeFingerprint') from email_claim),false,'Repeated provider start rejected');
select is((select public.service_complete_email_alert((c->>'jobId')::uuid,(c->>'claimToken')::uuid,'known_not_sent') from email_claim),false,'Started attempt cannot be marked safely retryable');
select is((public.service_claim_next_email_alert('2026-10-03T15:30Z')->>'claimed'),'false','Unknown provider outcome never auto-retries');
select is((select public.service_complete_email_alert((c->>'jobId')::uuid,(c->>'claimToken')::uuid,'sent','synthetic-provider-id') from email_claim),true,'Provider receipt settles unknown attempt');
set local session_replication_role=replica;
insert into public.reporting_machine_refund_managers(reporting_machine_id,manager_user_id,manager_email,status) values
 ('eb740000-0000-4000-8000-000000000002','eb710000-0000-4000-8000-000000000001','manager@example.invalid','active');
set local session_replication_role=origin;
select set_config('request.jwt.claim.sub','eb710000-0000-4000-8000-000000000001',true);
select is((select a->>'enabled' from jsonb_array_elements(public.get_my_email_alert_preferences()->'alerts') a where a->>'id'='daily'),'false','New assignment cannot override explicit daily opt-out');
select is((private.email_alert_daily_health('2026-10-03T20:00Z')->>'missedDueRecipientCount')::int,0,'Opt-out creates no false legacy due obligation');
update private.email_alert_delivery_settings set delivery_enabled=false;
select is((public.service_begin_next_refund_manager_digest('2026-10-03T15:00Z')->>'reason'),'personal_alert_sender_owns_daily','Pausing after activation does not restore old sender');
select is(private.email_alert_ready_allowed('eb710000-0000-4000-8000-000000000001','eb740000-0000-4000-8000-000000000001','2026-10-03T15:00Z'),false,'Paused cutover cannot send default-off ready notice');
select * from finish();
rollback;
