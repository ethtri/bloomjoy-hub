begin;
create extension if not exists pgtap with schema extensions;
set local search_path=public,extensions;
select no_plan();
-- One connection repeatedly executes the same cached projection plans with
-- alternating reported, restricted, missing-data and reported machines.
set local session_replication_role=replica;
insert into auth.users(id,email) values
 ('ed710000-0000-4000-8000-000000000001','mixed-one@example.invalid'),
 ('ed710000-0000-4000-8000-000000000002','mixed-two@example.invalid');
insert into public.customer_accounts(id,name,account_type)
 values('ed720000-0000-4000-8000-000000000001','Mixed metric fixture','internal');
insert into public.reporting_locations(id,account_id,name,timezone)
 values('ed730000-0000-4000-8000-000000000001','ed720000-0000-4000-8000-000000000001','Mixed metrics','America/Los_Angeles');
insert into public.reporting_machines(id,account_id,location_id,machine_label,status) values
 ('ed740000-0000-4000-8000-000000000001','ed720000-0000-4000-8000-000000000001','ed730000-0000-4000-8000-000000000001','A recorded','active'),
 ('ed740000-0000-4000-8000-000000000002','ed720000-0000-4000-8000-000000000001','ed730000-0000-4000-8000-000000000001','B different access','active'),
 ('ed740000-0000-4000-8000-000000000003','ed720000-0000-4000-8000-000000000001','ed730000-0000-4000-8000-000000000001','C no imported data','active'),
 ('ed740000-0000-4000-8000-000000000004','ed720000-0000-4000-8000-000000000001','ed730000-0000-4000-8000-000000000001','D recorded again','active');
insert into public.reporting_machine_refund_managers(reporting_machine_id,manager_user_id,manager_email,status)
 select m.id,u.id,u.email,'active' from public.reporting_machines m cross join auth.users u
 where m.account_id='ed720000-0000-4000-8000-000000000001'
 and u.id in ('ed710000-0000-4000-8000-000000000001','ed710000-0000-4000-8000-000000000002');
insert into public.reporting_machine_entitlements(user_id,machine_id,starts_at) values
 ('ed710000-0000-4000-8000-000000000001','ed740000-0000-4000-8000-000000000001','2020-01-01'),
 ('ed710000-0000-4000-8000-000000000001','ed740000-0000-4000-8000-000000000003','2020-01-01'),
 ('ed710000-0000-4000-8000-000000000001','ed740000-0000-4000-8000-000000000004','2020-01-01'),
 ('ed710000-0000-4000-8000-000000000002','ed740000-0000-4000-8000-000000000002','2020-01-01');
insert into public.machine_sales_facts(reporting_machine_id,reporting_location_id,sale_date,payment_method,net_sales_cents,
 transaction_count,source,source_row_hash,source_order_hash,raw_payload) values
 ('ed740000-0000-4000-8000-000000000001','ed730000-0000-4000-8000-000000000001','2026-10-02','cash',1000,10,'sunze_browser',repeat('1',64),repeat('1',32),'{}'),
 ('ed740000-0000-4000-8000-000000000002','ed730000-0000-4000-8000-000000000001','2026-10-02','cash',9999,99,'sunze_browser',repeat('2',64),repeat('2',32),'{}'),
 ('ed740000-0000-4000-8000-000000000004','ed730000-0000-4000-8000-000000000001','2026-10-02','cash',800,8,'sunze_browser',repeat('3',64),repeat('3',32),'{}'),
 ('ed740000-0000-4000-8000-000000000001','ed730000-0000-4000-8000-000000000001','2026-09-25','cash',900,9,'sunze_browser',repeat('4',64),repeat('4',32),'{}'),
 ('ed740000-0000-4000-8000-000000000004','ed730000-0000-4000-8000-000000000001','2026-09-25','cash',400,4,'sunze_browser',repeat('5',64),repeat('5',32),'{}');
insert into public.email_alert_preferences(user_id,alert_id,enabled,scope_mode,enabled_since) values
 ('ed710000-0000-4000-8000-000000000001','weekly',true,'all_assigned','2026-01-01'),
 ('ed710000-0000-4000-8000-000000000002','weekly',true,'all_assigned','2026-01-01');
set local session_replication_role=origin;

create temporary table saved_preferences as select to_jsonb(p) p from public.email_alert_preferences p
 where user_id in ('ed710000-0000-4000-8000-000000000001','ed710000-0000-4000-8000-000000000002');
update public.email_alert_preferences set scope_mode='selected',machine_ids=array['ed740000-0000-4000-8000-000000000003']::uuid[]
 where user_id='ed710000-0000-4000-8000-000000000001' and alert_id='weekly';
select ok(private.email_alert_digest_has_content('ed710000-0000-4000-8000-000000000001','weekly'),'Active selected machine with no sales remains eligible');
update public.email_alert_preferences set scope_mode='all_assigned',machine_ids=array[]::uuid[]
 where user_id='ed710000-0000-4000-8000-000000000001' and alert_id='weekly';
set local session_replication_role=replica;
update public.reporting_machines set management_archived_at='2026-10-03',management_archive_reason='Synthetic archive-only recipient'
 where account_id='ed720000-0000-4000-8000-000000000001';
set local session_replication_role=origin;
select is((select count(*)::integer from private.email_alert_due_candidates('2026-10-03T15:00Z') where user_id='ed710000-0000-4000-8000-000000000001' and category='daily'),0,'Archive-only daily recipient is not due');
select is((select count(*)::integer from private.email_alert_due_candidates('2026-10-05T15:00Z') where user_id='ed710000-0000-4000-8000-000000000001' and category='weekly'),0,'Archive-only weekly recipient is not due');
select is(jsonb_array_length(public.service_preview_email_alerts('2026-10-03T15:00Z')->'projections'),0,'Preview cannot emit archive-only empty digests');

set local session_replication_role=replica;
insert into public.refund_cases(id,public_reference,reporting_machine_id,reporting_location_id,customer_email,issue_summary,incident_at,
 payment_method,payment_amount_cents,refund_amount_cents,status,customer_request_received_at,customer_request_received_source) values
 ('ed760000-0000-4000-8000-000000000001','RF-ARCHIVE-CANDIDATE','ed740000-0000-4000-8000-000000000004','ed730000-0000-4000-8000-000000000001',
 'private@example.invalid','Machine did not dispense','2026-10-01T12:00Z','card',500,500,'needs_review','2026-10-01T12:00Z','hosted_refund_intake');
set local session_replication_role=origin;
select set_config('request.jwt.claim.sub','ed710000-0000-4000-8000-000000000002',true);
select set_config('request.jwt.claims','{"sub":"ed710000-0000-4000-8000-000000000002","role":"authenticated","is_anonymous":false}',true);
create temporary table caller_context as select current_setting('request.jwt.claim.sub') sub,current_setting('request.jwt.claims') claims;

-- Admission must not construct the Manager projection's expensive prepared
-- proof for every recipient. The real lifecycle remains enabled.
create temporary table original_manager_definition as select pg_get_functiondef('public.refund_manager_daily_digest_projection_for(uuid,timestamptz)'::regprocedure) d;
create or replace function public.refund_manager_daily_digest_projection_for(p_manager_user_id uuid,p_observed_at timestamptz default statement_timestamp())
returns jsonb language plpgsql volatile security definer set search_path='' as $$begin raise exception 'Admission built full Manager projection';end $$;
select is((select count(*)::integer from private.email_alert_due_candidates('2026-10-03T15:00Z') where user_id='ed710000-0000-4000-8000-000000000001' and category='daily'),1,'Archived authorized mandatory Manager work keeps daily candidate without full projection');
select is((select count(*)::integer from private.email_alert_due_candidates('2026-10-05T15:00Z') where user_id='ed710000-0000-4000-8000-000000000001' and category='weekly'),1,'Selected archived Manager work keeps weekly candidate');
select is(current_setting('request.jwt.claim.sub'),(select sub from caller_context),'Candidate presence restores caller subject');
select is(current_setting('request.jwt.claims'),(select claims from caller_context),'Candidate presence restores caller claims');
do $$begin execute (select d from original_manager_definition);end $$;
select ok(jsonb_array_length(private.email_alert_projection('ed710000-0000-4000-8000-000000000001','daily','2026-10-03T15:00Z','2026-10-02','2026-10-02')->'machines')>0,'Retained Manager candidate has a nonempty actual projection');
select ok(not exists((select p from saved_preferences) except (select to_jsonb(p) from public.email_alert_preferences p where user_id in ('ed710000-0000-4000-8000-000000000001','ed710000-0000-4000-8000-000000000002'))),'Admission leaves saved preferences unchanged');

-- Daily mandatory work remains outside selected performance preferences;
-- weekly applies the pre-existing selected weekly scope to mandatory work.
update public.email_alert_preferences set scope_mode='selected',machine_ids=array['ed740000-0000-4000-8000-000000000001']::uuid[]
 where user_id='ed710000-0000-4000-8000-000000000001' and alert_id='weekly';
select is((select count(*)::integer from private.email_alert_due_candidates('2026-10-05T15:00Z') where user_id='ed710000-0000-4000-8000-000000000001' and category='weekly'),0,'Unselected archived Manager case cannot expand weekly scope');
select is((select count(*)::integer from private.email_alert_due_candidates('2026-10-03T15:00Z') where user_id='ed710000-0000-4000-8000-000000000001' and category='daily'),1,'Daily mandatory Manager work retains original all-assignment rule');
set local session_replication_role=replica;
update public.reporting_machine_refund_managers set revoked_at='2026-10-03',revoke_reason='Synthetic revoked mapping'
 where manager_user_id='ed710000-0000-4000-8000-000000000001';
set local session_replication_role=origin;
select is((select count(*)::integer from private.email_alert_due_candidates('2026-10-03T15:00Z') where user_id='ed710000-0000-4000-8000-000000000001' and category='daily'),0,'Revoked Manager mapping cannot retain archived candidate');
select is((public.service_claim_next_email_alert('2026-10-03T15:00Z')->>'reason'),'delivery_disabled','Candidate tests keep sender disabled');
select is((select count(*)::integer from private.email_alert_jobs),0,'Read-only candidate tests reserve no delivery jobs');
select ok(not has_function_privilege('authenticated','private.email_alert_digest_has_content(uuid,text)','execute'),'Content admission helper is private');
select * from finish();
rollback;

