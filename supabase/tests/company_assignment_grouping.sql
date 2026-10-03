begin;
create extension if not exists pgtap with schema extensions;
set local search_path=public,extensions;
select no_plan();
-- Synthetic fixtures only: no payment, email transport, provider or live data.
set local session_replication_role=replica;
insert into auth.users(id,email) values
 ('cc171900-0000-4000-8000-000000000001','company-admin@example.invalid'),
 ('cc171900-0000-4000-8000-000000000002','company-manager@example.invalid'),
 ('cc171900-0000-4000-8000-000000000003','company-sales@example.invalid'),
 ('cc171900-0000-4000-8000-000000000004','company-outsider@example.invalid');
insert into public.admin_roles(user_id,role,active) values('cc171900-0000-4000-8000-000000000001','super_admin',true);
insert into public.customer_accounts(id,name,status) values
 ('cc171901-0000-4000-8000-000000000001','Company fixture A','active'),
 ('cc171901-0000-4000-8000-000000000002','Company fixture B','active'),
 ('cc171901-0000-4000-8000-000000000003','Company zero machines','active'),
 ('cc171901-0000-4000-8000-000000000004','Company inactive','inactive');
insert into public.reporting_locations(id,account_id,name,timezone,status) values
 ('cc171902-0000-4000-8000-000000000001','cc171901-0000-4000-8000-000000000001','Original venue','America/Los_Angeles','active'),
 ('cc171902-0000-4000-8000-000000000002','cc171901-0000-4000-8000-000000000002','Destination venue','America/New_York','active'),
 ('cc171902-0000-4000-8000-000000000003','cc171901-0000-4000-8000-000000000004','Inactive venue','America/Chicago','inactive');
insert into public.reporting_machines(id,account_id,location_id,machine_label,machine_type,status,nayax_account_key,nayax_machine_id) values
 ('cc171903-0000-4000-8000-000000000001','cc171901-0000-4000-8000-000000000001','cc171902-0000-4000-8000-000000000001','Company A machine','snapcase','active','TGPACI_USA_DB','17190001'),
 ('cc171903-0000-4000-8000-000000000002','cc171901-0000-4000-8000-000000000002','cc171902-0000-4000-8000-000000000002','Company B machine','commercial','active','TGPACI_USA_DB','17190002'),
 ('cc171903-0000-4000-8000-000000000003','cc171901-0000-4000-8000-000000000004','cc171902-0000-4000-8000-000000000003','Inactive machine','commercial','inactive',null,null),
 ('cc171903-0000-4000-8000-000000000004','cc171901-0000-4000-8000-000000000001','cc171902-0000-4000-8000-000000000001','Hidden same-company machine','commercial','active',null,null);
insert into public.reporting_machine_refund_managers(reporting_machine_id,manager_user_id,manager_email,status)
 values('cc171903-0000-4000-8000-000000000001','cc171900-0000-4000-8000-000000000002','company-manager@example.invalid','active');
insert into public.reporting_machine_entitlements(user_id,machine_id,starts_at) values
 ('cc171900-0000-4000-8000-000000000002','cc171903-0000-4000-8000-000000000001','2020-01-01'),
 ('cc171900-0000-4000-8000-000000000003','cc171903-0000-4000-8000-000000000001','2020-01-01');
insert into public.reporting_machine_tax_rates(machine_id,tax_rate_percent,effective_start_date,status)
 values('cc171903-0000-4000-8000-000000000001',0,'2020-01-01','active');
insert into public.machine_sales_facts(reporting_machine_id,reporting_location_id,sale_date,payment_method,net_sales_cents,transaction_count,source,source_row_hash)
 values('cc171903-0000-4000-8000-000000000001','cc171902-0000-4000-8000-000000000001','2026-09-01','cash',1000,1,'manual_csv',repeat('1',64));
insert into public.refund_cases(id,public_reference,reporting_machine_id,reporting_location_id,customer_email,issue_summary,incident_at,payment_method,payment_amount_cents,status,customer_request_received_at,customer_request_received_source) values
 ('cc171904-0000-4000-8000-000000000001','RF-COMPANY-A','cc171903-0000-4000-8000-000000000001','cc171902-0000-4000-8000-000000000001','private-company@example.invalid','Private company issue','2026-09-01T12:00Z','cash',1000,'needs_review','2026-09-01T12:00Z','hosted_refund_intake'),
 ('cc171904-0000-4000-8000-000000000002','RF-COMPANY-HIDDEN','cc171903-0000-4000-8000-000000000004','cc171902-0000-4000-8000-000000000001','hidden-company@example.invalid','Hidden company issue','2026-09-01T12:00Z','cash',99999,'needs_review','2026-09-01T12:00Z','hosted_refund_intake');
set local session_replication_role=origin;
select set_config('request.jwt.claim.role','authenticated',true);
select set_config('request.jwt.claim.sub','cc171900-0000-4000-8000-000000000001',true);
select ok(public.admin_get_reporting_company_choices() @> '{"companies":[{"accountId":"cc171901-0000-4000-8000-000000000003"}]}'::jsonb,'Company directory includes zero-machine company');
select ok(public.admin_get_reporting_company_choices() @> '{"companies":[{"accountId":"cc171901-0000-4000-8000-000000000004","status":"inactive"}]}'::jsonb,'Unavailable saved companies remain visible without reactivation');
select ok(public.admin_get_partnership_reporting_setup() @> '{"machines":[{"id":"cc171903-0000-4000-8000-000000000001","account_id":"cc171901-0000-4000-8000-000000000001","location_id":"cc171902-0000-4000-8000-000000000001","location_timezone":"America/Los_Angeles"}]}'::jsonb,'Machine edit projection carries canonical IDs/timezone');
create temporary table created_company as select public.admin_create_reporting_company('  Explicit company fixture  ') result;
select is((select result->>'created' from created_company),'true','Explicit create reports company creation');
select is((select result->>'accountName' from created_company),'Explicit company fixture','Creation trims display name');
select is(public.admin_create_reporting_company('explicit COMPANY fixture')->>'accountId',(select result->>'accountId' from created_company),'Case-equivalent retry selects same ID');
select is(public.admin_create_reporting_company(' explicit company fixture ')->>'created','false','Repeated create has no second write');
select is((select count(*)::int from public.customer_accounts where lower(btrim(name))='explicit company fixture'),1,'Duplicate create produces one canonical company');
select throws_ok($$select public.admin_upsert_reporting_machine(null,'Never implicitly create fixture','Anywhere','Fixture','commercial',null,'Fixture setup')$$,'22023',null,'Unknown legacy company fails');
select throws_ok($$select public.admin_upsert_reporting_machine_with_phase(null,'Never implicitly create fixture','Anywhere','Fixture','commercial',null,'live','Fixture setup','America/New_York')$$,'22023',null,'Unknown legacy phase company fails');
select is((select count(*)::int from public.customer_accounts where name='Never implicitly create fixture'),0,'Legacy saves create no company');
select throws_ok($$select public.admin_map_source_machine_to_partnership('Unmapped-fixture',null,'Fixture','Location','commercial',0,'2026-01-01',null,'2026-01-01','Fixture setup')$$,'22023','Choose an explicit company and location','Sunze legacy writer cannot infer company from settlement participant');
select throws_ok($$select public.admin_upsert_reporting_machine_by_id('cc171903-0000-4000-8000-000000000001','cc171901-0000-4000-8000-000000000002','cc171902-0000-4000-8000-000000000001','Wrong location','snapcase',null,'live','Fixture setup','cc171901-0000-4000-8000-000000000001','cc171902-0000-4000-8000-000000000001')$$,'22023','Location does not belong to the selected company','Cross-company location rejected atomically');
select throws_ok($$select public.admin_upsert_reporting_machine_by_id('cc171903-0000-4000-8000-000000000001','cc171901-0000-4000-8000-000000000002',null,'Invalid timezone','snapcase',null,'live','Fixture setup','cc171901-0000-4000-8000-000000000001','cc171902-0000-4000-8000-000000000001','Explicit Eastern','Not/A_Zone')$$,'22023','Choose a valid IANA location timezone','New location timezone validated on edit');
select is((select account_id from public.reporting_machines where id='cc171903-0000-4000-8000-000000000001'),'cc171901-0000-4000-8000-000000000001'::uuid,'Invalid atomic save preserves assignment');
select lives_ok($$select public.admin_upsert_reporting_machine_by_id('cc171903-0000-4000-8000-000000000001','cc171901-0000-4000-8000-000000000002',null,'Moved machine','snapcase',null,'live','Fixture company change','cc171901-0000-4000-8000-000000000001','cc171902-0000-4000-8000-000000000001','Explicit Eastern','America/New_York')$$,'Company change explicitly creates destination venue');
select is((select timezone from public.reporting_locations where account_id='cc171901-0000-4000-8000-000000000002' and name='Explicit Eastern'),'America/New_York','Edit-created location retains explicit timezone');
select is((select account_id from public.reporting_locations where id='cc171902-0000-4000-8000-000000000001'),'cc171901-0000-4000-8000-000000000001'::uuid,'Shared old location is never moved');
select is((select reporting_location_id from public.machine_sales_facts where source_row_hash=repeat('1',64)),'cc171902-0000-4000-8000-000000000001'::uuid,'Historical sales placement unchanged');
select is((select reporting_location_id from public.refund_cases where id='cc171904-0000-4000-8000-000000000001'),'cc171902-0000-4000-8000-000000000001'::uuid,'Historical case placement unchanged');
select is((select nayax_account_key from public.reporting_machines where id='cc171903-0000-4000-8000-000000000001'),'TGPACI_USA_DB','Shared provider credentials remain independent of company');
select is((select count(*)::int from public.reporting_machine_refund_managers where reporting_machine_id='cc171903-0000-4000-8000-000000000001'),1,'Machine manager assignment unchanged');
select is((select count(*)::int from public.reporting_machine_tax_rates where machine_id='cc171903-0000-4000-8000-000000000001'),1,'Machine tax configuration unchanged');
select ok(exists(select 1 from public.admin_audit_log where entity_id='cc171903-0000-4000-8000-000000000001' and action='reporting_machine.upserted' and actor_user_id='cc171900-0000-4000-8000-000000000001' and before->>'account_id'='cc171901-0000-4000-8000-000000000001' and after->>'account_id'='cc171901-0000-4000-8000-000000000002' and before->>'location_id'<>after->>'location_id'),'Audit retains actor and before/after company/location IDs');
select throws_ok($$select public.admin_upsert_reporting_machine_by_id('cc171903-0000-4000-8000-000000000001','cc171901-0000-4000-8000-000000000001','cc171902-0000-4000-8000-000000000001','Stale edit','snapcase',null,'live','Fixture setup','cc171901-0000-4000-8000-000000000001','cc171902-0000-4000-8000-000000000001')$$,'40001',null,'Stale assignment cannot overwrite newer save');
select lives_ok($$select public.admin_upsert_reporting_machine_by_id('cc171903-0000-4000-8000-000000000003','cc171901-0000-4000-8000-000000000004','cc171902-0000-4000-8000-000000000003','Renamed inactive machine','commercial',null,'live','Fixture identity edit','cc171901-0000-4000-8000-000000000004','cc171902-0000-4000-8000-000000000003')$$,'Unrelated identity edit retains inactive assignment');
select is((select status from public.reporting_machines where id='cc171903-0000-4000-8000-000000000003'),'inactive','Identity edit does not reactivate inventory');
select is((select status from public.customer_accounts where id='cc171901-0000-4000-8000-000000000004'),'inactive','Company status unchanged');
select is((select status from public.reporting_locations where id='cc171902-0000-4000-8000-000000000003'),'inactive','Location status unchanged');

select set_config('request.jwt.claim.sub','cc171900-0000-4000-8000-000000000002',true);
select throws_ok($$select public.admin_get_reporting_company_choices()$$,'42501','Admin access required','Manager cannot read global company directory');
select throws_ok($$select public.admin_create_reporting_company('Manager forbidden fixture')$$,'42501','Admin access required','Manager cannot create company');
select throws_ok($$select public.admin_upsert_reporting_machine_by_id(null,'cc171901-0000-4000-8000-000000000001','cc171902-0000-4000-8000-000000000001','Unauthorized','commercial',null,'live','Fixture setup',null,null)$$,'42501','Admin access required','Manager cannot change machine identity');
select is(jsonb_array_length(public.get_refund_analytics_access()->'dimensions'),2,'Manager sees one machine current and historical placements only');
select ok(public.get_refund_analytics_access() @> '{"dimensions":[{"machineId":"cc171903-0000-4000-8000-000000000001","accountId":"cc171901-0000-4000-8000-000000000002","accountName":"Company fixture B","locationId":"cc171902-0000-4000-8000-000000000001"}]}'::jsonb,'Historical venue uses exact machine current company');
select ok(public.get_finance_reporting_access() @> '{"dimensions":[{"machineId":"cc171903-0000-4000-8000-000000000001","accountId":"cc171901-0000-4000-8000-000000000002"}]}'::jsonb,'Finance intersection retains company metadata');
select is(cardinality(private.company_reporting_machine_ids('cc171901-0000-4000-8000-000000000002','refunds',null)),1,'Same provider/company siblings do not broaden manager scope');
select throws_ok($$select public.get_company_refund_analytics('cc171901-0000-4000-8000-000000000001','2026-09-01','2026-09-30')$$,'42501',null,'Old company is unavailable after reassignment');
select throws_ok($$select public.get_company_refund_analytics('cc171901-0000-4000-8000-000000000002','2026-09-01','2026-09-30',array[]::uuid[])$$,'22023',null,'Explicit empty company-machine subset cannot become all');
select throws_ok($$select public.get_company_sales_report('cc171901-0000-4000-8000-000000000002','2026-09-01','2026-09-30','day',array['cc171903-0000-4000-8000-000000000002']::uuid[])$$,'22023',null,'Forged sibling machine intersection never widens Sales');
select lives_ok($$select public.get_company_refund_analytics('cc171901-0000-4000-8000-000000000002','2026-09-01','2026-09-30')$$,'Company analytics supports scoped authorized machine');
select lives_ok($$select public.get_company_finance_reporting('cc171901-0000-4000-8000-000000000002','2026-09-01','2026-09-30')$$,'Company Finance supports only intersection');
select is((select count(*)::int from public.get_company_sales_report('cc171901-0000-4000-8000-000000000002','2026-09-01','2026-09-30','day')),1,'Company Sales includes historical venue once');
create temporary table company_queue as select public.get_refund_portal_queue_projection() result;
select ok((select result @> '{"items":[{"caseId":"cc171904-0000-4000-8000-000000000001","accountId":"cc171901-0000-4000-8000-000000000002","accountName":"Company fixture B"}]}'::jsonb from company_queue),'Redacted queue carries exact canonical company');
select ok((select result::text not like '%private-company@example.invalid%' and result::text not like '%Hidden company%' from company_queue),'Queue metadata preserves privacy and manager scope');
select ok(public.admin_get_refund_operations_overview() @> '{"cases":[{"id":"cc171904-0000-4000-8000-000000000001","accountId":"cc171901-0000-4000-8000-000000000002","accountName":"Company fixture B"}]}'::jsonb,'Full authorized case projection carries same company');
select set_config('request.jwt.claim.sub','cc171900-0000-4000-8000-000000000003',true);
select is(jsonb_array_length(public.get_refund_analytics_access()->'dimensions'),0,'Sales-only viewer receives no Refund dimensions');
select is(jsonb_array_length(public.get_finance_reporting_access()->'dimensions'),0,'Sales-only viewer receives no Finance dimensions');
select throws_ok($$select public.get_company_refund_analytics('cc171901-0000-4000-8000-000000000002','2026-09-01','2026-09-30')$$,'42501',null,'Company ID cannot grant Refund authority to Sales viewer');
select throws_ok($$select public.get_company_finance_reporting('cc171901-0000-4000-8000-000000000002','2026-09-01','2026-09-30')$$,'42501',null,'Company ID cannot grant Finance authority to Sales viewer');
select throws_ok($$select public.get_refund_portal_queue_projection()$$,'42501',null,'Company metadata does not expose queue to Sales viewer');
select ok(not has_function_privilege('authenticated','private.refund_add_current_company(jsonb,text)','execute'),'Metadata enrichment helper remains inaccessible');
select ok(not has_function_privilege('authenticated','private.upsert_reporting_machine_identity(uuid,uuid,uuid,text,text,text,text)','execute'),'Private identity writer remains inaccessible');
select ok(not has_function_privilege('anon','public.admin_create_reporting_company(text)','execute'),'Anonymous cannot create companies');
select * from finish();
rollback;
