begin;
create extension if not exists pgtap with schema extensions;
set local search_path=public,extensions;
select no_plan();
-- No provider, sender, intake automation, or production records are involved.
set local session_replication_role=replica;
insert into auth.users(id,email) values
 ('ed710000-0000-4000-8000-000000000001','digest-manager@example.invalid'),
 ('ed710000-0000-4000-8000-000000000002','digest-tech@example.invalid');
insert into public.customer_accounts(id,name,account_type) values
 ('ed720000-0000-4000-8000-000000000001','TGPaci fixture','internal'),
 ('ed720000-0000-4000-8000-000000000002','Bloomjoy NC fixture','internal');
insert into public.reporting_locations(id,account_id,name,timezone) values
 ('ed730000-0000-4000-8000-000000000001','ed720000-0000-4000-8000-000000000001','West','America/Los_Angeles'),
 ('ed730000-0000-4000-8000-000000000002','ed720000-0000-4000-8000-000000000002','Next local date','Pacific/Kiritimati');
insert into public.reporting_machines(id,account_id,location_id,machine_label,status) values
 ('ed740000-0000-4000-8000-000000000001','ed720000-0000-4000-8000-000000000001','ed730000-0000-4000-8000-000000000001','Requests','active'),
 ('ed740000-0000-4000-8000-000000000002','ed720000-0000-4000-8000-000000000002','ed730000-0000-4000-8000-000000000002','Unknown amount','active'),
 ('ed740000-0000-4000-8000-000000000003','ed720000-0000-4000-8000-000000000001','ed730000-0000-4000-8000-000000000001','No requests','active');
insert into public.reporting_machine_refund_managers(reporting_machine_id,manager_user_id,manager_email,status)
 select id,'ed710000-0000-4000-8000-000000000001','digest-manager@example.invalid','active'
 from public.reporting_machines where id in
 ('ed740000-0000-4000-8000-000000000001','ed740000-0000-4000-8000-000000000002','ed740000-0000-4000-8000-000000000003');
insert into public.technician_grants(id,account_id,sponsor_user_id,technician_email,technician_user_id,status,starts_at,grant_reason) values
 ('ed750000-0000-4000-8000-000000000001','ed720000-0000-4000-8000-000000000001','ed710000-0000-4000-8000-000000000001',
 'digest-tech@example.invalid','ed710000-0000-4000-8000-000000000002','active','2020-01-01','Synthetic test');
insert into public.technician_machine_assignments(technician_grant_id,machine_id,status,starts_at,grant_reason) values
 ('ed750000-0000-4000-8000-000000000001','ed740000-0000-4000-8000-000000000001','active','2020-01-01','Synthetic test');
-- Reporting access does not imply permission to view individual refund money.
insert into public.reporting_machine_entitlements(user_id,machine_id,starts_at) values
 ('ed710000-0000-4000-8000-000000000002','ed740000-0000-4000-8000-000000000001','2020-01-01');
insert into public.refund_gift_card_pools(id,provider,provider_account_id,face_value_cents,
 eligible_machine_ids,eligible_locations,expires_at,redemption_instructions) values
 ('ed770000-0000-4000-8000-000000000001','sunzee','digest-fixture',1500,
 array['ed740000-0000-4000-8000-000000000001']::uuid[],array['West'],'2027-10-03T00:00Z','Synthetic fixture only');
create temporary table digest_request_fixture(n integer,machine_n integer,received_at timestamptz,original_amount integer,provenance text);
insert into digest_request_fixture values
 (1,1,'2026-10-02T12:00Z',600,'hosted_intake_customer_charge_estimate'),
 (2,1,'2026-10-02T12:01Z',null,null),
 (3,1,'2026-10-02T12:02Z',800,'unproved_provider_currency'),
 (4,1,'2026-10-02T12:03Z',null,null),
 (5,1,'2026-10-02T07:00Z',100,'hosted_intake_customer_charge_estimate'),
 (6,1,'2026-10-03T07:00Z',null,null),
 (7,1,'2026-10-02T06:59:59Z',null,null),
 (8,1,'2026-09-25T12:00Z',400,'hosted_intake_customer_charge_estimate'),
 (9,1,'2026-09-01T12:00Z',null,null),
 (10,1,null,null,null),
 (11,1,'2026-10-02T12:05Z',null,null),
 (12,1,'2026-10-02T12:06Z',null,null),
 (13,1,'2026-09-25T12:07Z',null,null),
 (14,2,'2026-10-02T12:00Z',null,null);
insert into public.refund_cases(id,public_reference,reporting_machine_id,reporting_location_id,customer_email,
 issue_summary,incident_at,payment_method,payment_amount_cents,refund_amount_cents,status,
 customer_request_received_at,customer_request_received_source)
 select ('ed760000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid,'RF-DIGEST-'||n,
 ('ed740000-0000-4000-8000-'||lpad(machine_n::text,12,'0'))::uuid,
 ('ed730000-0000-4000-8000-'||lpad(machine_n::text,12,'0'))::uuid,
 'private@example.invalid','Machine did not dispense','2026-08-01T12:00Z','card',900,900,'needs_review',
 received_at,case when received_at is not null then 'hosted_refund_intake' end from digest_request_fixture;
update public.refund_cases set status='completed' where id='ed760000-0000-4000-8000-000000000001';
update public.refund_cases set issue_category='expected_cash_change',payment_method='cash',resolution_method='gift_card',
 cash_inserted_amount_cents=1000,expected_change_amount_cents=300,affected_amount_cents=900,gift_card_value_cents=1500,
 gift_card_pool_id='ed770000-0000-4000-8000-000000000001',gift_card_expires_at='2027-10-03T00:00Z',gift_card_state='manager_review'
 where id='ed760000-0000-4000-8000-000000000004';
update public.refund_cases set duplicate_of_refund_case_id='ed760000-0000-4000-8000-000000000001'
 where id='ed760000-0000-4000-8000-000000000011';
update public.refund_cases set case_population='internal_test',internal_test_reason='employee_technician_test',
 internal_test_classified_at='2026-10-02T12:06Z',internal_test_classified_by='ed710000-0000-4000-8000-000000000001',
 status='closed',automation_state='closed_incomplete'
 where id='ed760000-0000-4000-8000-000000000012';
insert into private.refund_request_recognition_events(event_key,refund_case_id,event_kind,effective_at,recorded_at,
 tender,source,request_target_before_cents,request_target_after_cents,amount_basis,amount_provenance)
 select 'digest:opening:'||n,('ed760000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid,'request_received',
 received_at,received_at,'card','hosted_refund_intake',0,original_amount,'tax_inclusive',provenance
 from digest_request_fixture where original_amount is not null;
-- A later prepared amount and even a later opening must not replace intake proof.
insert into private.refund_request_recognition_events(event_key,refund_case_id,event_kind,effective_at,recorded_at,
 tender,source,request_target_before_cents,request_target_after_cents,amount_basis,amount_provenance) values
 ('digest:later-prepared','ed760000-0000-4000-8000-000000000001','amount_changed','2026-10-03T12:00Z','2026-10-03T12:00Z','card','manager',600,900,'tax_inclusive','hosted_intake_customer_charge_estimate'),
 ('digest:later-opening','ed760000-0000-4000-8000-000000000003','late_request_opening','2026-10-03T12:00Z','2026-10-03T12:00Z','card','hosted_refund_intake',0,800,'tax_inclusive','hosted_intake_customer_charge_estimate');
set local session_replication_role=origin;
create temporary table digest_metadata as select
 private.email_alert_digest_metadata('ed710000-0000-4000-8000-000000000001','ed740000-0000-4000-8000-000000000001','2026-10-02','2026-10-02') daily,
 private.email_alert_digest_metadata('ed710000-0000-4000-8000-000000000001','ed740000-0000-4000-8000-000000000001','2026-09-28','2026-10-04') weekly,
 private.email_alert_digest_metadata('ed710000-0000-4000-8000-000000000002','ed740000-0000-4000-8000-000000000001','2026-10-02','2026-10-02') tech;
select is((select daily->>'accountId' from digest_metadata),'ed720000-0000-4000-8000-000000000001','Company identity is the machine account');
select is((select daily->>'accountName' from digest_metadata),'TGPaci fixture','Company name uses authoritative account name');
select is((select daily->>'newRequestCount' from digest_metadata),'5','Daily counts root customer intake using exact local midnight boundaries');
select is((select daily->>'requestAmountsAllowed' from digest_metadata),'true','Assigned manager can view request amounts without a sales entitlement');
select is((select daily->>'requestedAmountCents' from digest_metadata),'1000','Requested sum uses original intake plus expected change, never current prepared or gift value');
select is((select daily->>'requestedAmountKnownCount' from digest_metadata),'3','Only USD-backed request values are known');
select is((select daily->>'requestedAmountUnknownCount' from digest_metadata),'2','Missing opening and unproved currency remain explicitly unknown');
select is((select daily->>'previousNewRequestCount' from digest_metadata),'2','Daily comparison uses the same weekday one week earlier');
select is((select daily->>'previousRequestedAmountCents' from digest_metadata),'400','Previous amount remains the original request');
select is((select daily->>'previousRequestedAmountKnownCount' from digest_metadata),'1','Prior known amount count is independent');
select is((select daily->>'previousRequestedAmountUnknownCount' from digest_metadata),'1','Prior missing amount stays unknown');
select is((select weekly->>'newRequestCount' from digest_metadata),'7','Weekly includes full completed Monday through Sunday interval');
select is((select weekly->>'requestedAmountCents' from digest_metadata),'1000','Weekly does not turn additional unknown requests into zero values');
select is((select weekly->>'requestedAmountUnknownCount' from digest_metadata),'4','Weekly reports all unknown amounts');
select is((select weekly->>'previousNewRequestCount' from digest_metadata),'2','Weekly baseline is exactly the previous completed week');
select is((select weekly->>'previousRequestedAmountCents' from digest_metadata),'400','Weekly comparison uses comparable intake values');
select is((select tech->>'requestAmountsAllowed' from digest_metadata),'false','Technician reporting access does not grant refund amount access');
select is((select tech->>'newRequestCount' from digest_metadata),'5','Technician keeps operational request volume');
select is((select tech->>'requestedAmountCents' from digest_metadata),null,'Technician monetary total is redacted');
select is((select tech->>'requestedAmountKnownCount' from digest_metadata),'0','Technician receives no amount availability side channel');
select is((select tech->>'requestedAmountUnknownCount' from digest_metadata),'5','All technician request amounts are unavailable');
select is((select tech->>'previousRequestedAmountCents' from digest_metadata),null,'Previous technician amounts are also redacted');
select is(private.email_alert_digest_metadata('ed710000-0000-4000-8000-000000000001','ed740000-0000-4000-8000-000000000002','2026-10-03','2026-10-03')->>'requestedAmountCents',null,'All unknown amounts produce null rather than an invented zero');
select is(private.email_alert_digest_metadata('ed710000-0000-4000-8000-000000000001','ed740000-0000-4000-8000-000000000003','2026-10-02','2026-10-02')->>'requestedAmountCents','0','No requests is a known zero for authorized managers');
select throws_ok($$select private.email_alert_digest_metadata('ed710000-0000-4000-8000-000000000002','ed740000-0000-4000-8000-000000000002','2026-10-02','2026-10-02')$$,'42501',null,'An unassigned company cannot enter an aggregate');
select ok(not has_function_privilege('authenticated','private.email_alert_digest_metadata(uuid,uuid,date,date)','execute'),'Clients cannot request aggregates for another actor');
select ok(not has_function_privilege('service_role','private.email_alert_customer_requested_usd(public.refund_cases)','execute'),'Raw case helper has no service API grant');
select ok(not has_function_privilege('anon','private.email_alert_digest_metadata(uuid,uuid,date,date)','execute'),'Anonymous aggregate access is denied');
create temporary table digest_projection as select private.email_alert_projection(
 'ed710000-0000-4000-8000-000000000001','daily','2026-10-03T15:00Z','2026-10-02','2026-10-02') p;
select is((select m#>>'{digest,newRequestCount}' from digest_projection,jsonb_array_elements(p->'machines') m where m->>'machineId'='ed740000-0000-4000-8000-000000000001'),'5','Daily projection carries authoritative period totals');
select is((select m->>'dateTo' from digest_projection,jsonb_array_elements(p->'machines') m where m->>'machineId'='ed740000-0000-4000-8000-000000000002'),'2026-10-03','Projection preserves each machine local reporting day');
select is((select m#>>'{digest,newRequestCount}' from digest_projection,jsonb_array_elements(p->'machines') m where m->>'machineId'='ed740000-0000-4000-8000-000000000002'),'1','Intake metadata uses the machine period rather than delivery timezone');
select is((select p#>>'{summary,newRequestCount}' from digest_projection),'6','Summary count matches period intake across selected companies');
select ok((select exists(select 1 from jsonb_array_elements(p->'machines') m,jsonb_array_elements(m->'refundCases') c where c->>'caseId'='ed760000-0000-4000-8000-000000000001' and (c->>'isNew')::boolean) from digest_projection),'Resolved request is still counted in its intake period');
select ok((select bool_and((m#>>'{digest,newRequestCount}')::int=(select count(*) from jsonb_array_elements(m->'refundCases') c where (c->>'isNew')::boolean)) from digest_projection,jsonb_array_elements(p->'machines') m),'Each digest count matches its customer-root new-case projection');
select ok((select p->'managerOpenCases' is not null and jsonb_array_length(p->'managerCaseMachines')>0 from digest_projection),'Mature manager ledger proof remains available internally');
select ok((select exists(select 1 from jsonb_array_elements(p->'machines') m,jsonb_array_elements(m->'refundCases') c where c->>'caseId'='ed760000-0000-4000-8000-000000000009' and not(c->>'isNew')::boolean) from digest_projection),'Old open work stays in audit proof without becoming period intake');
insert into public.email_alert_preferences(user_id,alert_id,enabled,scope_mode,machine_ids) values
 ('ed710000-0000-4000-8000-000000000001','new-refund',true,'selected',array['ed740000-0000-4000-8000-000000000001']::uuid[]);
select ok(not(private.email_alert_projection('ed710000-0000-4000-8000-000000000001','new-refund','2026-10-02T12:00Z','2026-10-02','2026-10-02','ed760000-0000-4000-8000-000000000001')#>'{machines,0}' ? 'digest'),'Immediate event contract stays unchanged');
update public.customer_accounts set name=E'TGPaci\nfixture'||chr(1)||chr(127)
 where id='ed720000-0000-4000-8000-000000000001';
select is(private.email_alert_digest_metadata('ed710000-0000-4000-8000-000000000001','ed740000-0000-4000-8000-000000000001','2026-10-02','2026-10-02')->>'accountName','TGPaci fixture','Account display names normalize newline and control characters before wire validation');
select is(private.email_alert_digest_metadata('ed710000-0000-4000-8000-000000000001','ed740000-0000-4000-8000-000000000001','2026-10-02','2026-10-02')->>'accountId','ed720000-0000-4000-8000-000000000001','Display sanitation never changes company identity');
update public.customer_accounts set name=E'\n\t'||chr(127)
 where id='ed720000-0000-4000-8000-000000000001';
select is(private.email_alert_digest_metadata('ed710000-0000-4000-8000-000000000001','ed740000-0000-4000-8000-000000000001','2026-10-02','2026-10-02')->>'accountName','Company name unavailable','An entirely non-displayable name has an explicit unavailable label');
update public.customer_accounts set name=repeat(U&'\+01F600',241)
 where id='ed720000-0000-4000-8000-000000000001';
select is(char_length(private.email_alert_digest_metadata('ed710000-0000-4000-8000-000000000001','ed740000-0000-4000-8000-000000000001','2026-10-02','2026-10-02')->>'accountName'),240,'Company clipping counts Unicode codepoints just like the parser');
-- Both repeated local 01:30 instants belong to the 25-hour fallback day; the
-- following local midnight belongs to tomorrow, independent of receipt age.
set local session_replication_role=replica;
insert into public.refund_cases(id,public_reference,reporting_machine_id,reporting_location_id,customer_email,
 issue_summary,incident_at,payment_method,payment_amount_cents,refund_amount_cents,status,
 customer_request_received_at,customer_request_received_source)
 select ('ed760000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid,'RF-DIGEST-DST-'||n,
 'ed740000-0000-4000-8000-000000000003','ed730000-0000-4000-8000-000000000001',
 'dst@example.invalid','DST fixture','2026-08-01T12:00Z','card',900,900,'needs_review',received_at,'hosted_refund_intake'
 from (values (15,'2026-11-01T08:30Z'::timestamptz),(16,'2026-11-01T09:30Z'::timestamptz),(17,'2026-11-02T08:00Z'::timestamptz)) x(n,received_at);
set local session_replication_role=origin;
select is(private.email_alert_digest_metadata('ed710000-0000-4000-8000-000000000001','ed740000-0000-4000-8000-000000000003','2026-11-01','2026-11-01')->>'newRequestCount','2','Both repeated DST hours count exactly once and next midnight is excluded');
select is(private.email_alert_digest_metadata('ed710000-0000-4000-8000-000000000001','ed740000-0000-4000-8000-000000000003','2026-11-02','2026-11-02')->>'newRequestCount','1','New midnight starts the next machine-local intake day');
select * from finish();
rollback;
