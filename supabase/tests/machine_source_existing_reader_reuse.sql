begin;
create extension if not exists pgtap with schema extensions;
set local search_path=public,extensions;
set local timezone='UTC';
select no_plan();
-- Synthetic records reproduce an unbound imported source plus an occupied
-- published reader. Every action below the seed runs with origin triggers.
set local session_replication_role=replica;
insert into auth.users(id,email) values
 ('aa179900-0000-4000-8000-000000000001','reuse-admin@example.invalid'),
 ('aa179900-0000-4000-8000-000000000002','reuse-scoped@example.invalid'),
 ('aa179900-0000-4000-8000-000000000003','reuse-outsider@example.invalid');
insert into public.admin_roles(user_id,role,active) values ('aa179900-0000-4000-8000-000000000001','super_admin',true);
insert into public.customer_accounts(id,name) values ('aa179901-0000-4000-8000-000000000001','Existing company retained');
insert into public.reporting_locations(id,account_id,name,timezone) values
 ('aa179902-0000-4000-8000-000000000001','aa179901-0000-4000-8000-000000000001','Internal existing site','America/Los_Angeles');
insert into public.reporting_machines(id,account_id,location_id,machine_label,machine_type,nayax_machine_id,nayax_account_key,sunze_machine_id,refund_intake_enabled,nayax_refunds_enabled) values
 ('aa179903-0000-4000-8000-000000000001','aa179901-0000-4000-8000-000000000001','aa179902-0000-4000-8000-000000000001','Existing cotton machine','commercial','17990001','REUSE_FIXTURE',null,true,true),
 ('aa179903-0000-4000-8000-000000000002','aa179901-0000-4000-8000-000000000001','aa179902-0000-4000-8000-000000000001','Other real source machine','commercial','17990002','REUSE_FIXTURE','fixture-1799-bound',true,true),
 ('aa179903-0000-4000-8000-000000000003','aa179901-0000-4000-8000-000000000001','aa179902-0000-4000-8000-000000000001','Existing case machine','snapcase','17990003','REUSE_FIXTURE',null,true,false),
 ('aa179903-0000-4000-8000-000000000004','aa179901-0000-4000-8000-000000000001','aa179902-0000-4000-8000-000000000001','Historical case connection','snapcase','17990004','REUSE_FIXTURE',null,true,false),
 ('aa179903-0000-4000-8000-000000000005','aa179901-0000-4000-8000-000000000001','aa179902-0000-4000-8000-000000000001','Historical Sunze association','commercial','17990005','REUSE_FIXTURE',null,true,false);
insert into public.sunze_machine_discoveries(sunze_machine_id,sunze_machine_name,status,reporting_machine_id,last_seen_at) values
 ('fixture-1799-gilroy','Imported cotton alias','pending',null,now()),
 ('fixture-1799-other','Second unbound source','pending',null,now()),
 ('fixture-1799-bound','Bound source','mapped','aa179903-0000-4000-8000-000000000002',now());
insert into public.sunze_unmapped_sales(sunze_machine_id,source_order_hash,source_row_hash,sale_date,payment_method,net_sales_cents,transaction_count,raw_payload) values
 ('fixture-1799-gilroy',repeat('1',64),'reuse-old-row','2025-08-03','credit',900,1,'{"machine_code":"fixture-1799-gilroy","machine_name":"Imported cotton alias"}'),
 ('fixture-1799-gilroy',repeat('2',64),'reuse-recent-row','2026-10-04','cash',400,1,'{"machine_code":"fixture-1799-gilroy","machine_name":"Imported cotton alias"}'),
 ('fixture-1799-historical','reuse-historical-order','reuse-historical-row','2025-08-03','credit',500,1,'{}');
update public.sunze_unmapped_sales set reporting_machine_id='aa179903-0000-4000-8000-000000000005' where source_order_hash='reuse-historical-order';
insert into public.refund_nayax_machine_inventory(id,account_key,nayax_machine_id,machine_name,provider_is_active,reporting_machine_id,reconciliation_state,refund_category) values
 ('aa179904-0000-4000-8000-000000000001','REUSE_FIXTURE','17990001','Occupied legacy reader',true,'aa179903-0000-4000-8000-000000000001','published','cotton_candy'),
 ('aa179904-0000-4000-8000-000000000002','REUSE_FIXTURE','17990002','Occupied genuine source reader',true,'aa179903-0000-4000-8000-000000000002','published','cotton_candy'),
 ('aa179904-0000-4000-8000-000000000003','REUSE_FIXTURE','17990003','Occupied case reader',true,'aa179903-0000-4000-8000-000000000003','needs_setup','snapcase'),
 ('aa179904-0000-4000-8000-000000000004','REUSE_FIXTURE','17990004','Historical mapped reader',true,'aa179903-0000-4000-8000-000000000004','needs_setup','snapcase'),
 ('aa179904-0000-4000-8000-000000000005','REUSE_FIXTURE','17990005','Historical Sunze reader',true,'aa179903-0000-4000-8000-000000000005','needs_setup','cotton_candy');
insert into public.reporting_machine_refund_managers(reporting_machine_id,manager_user_id,manager_email,status) values
 ('aa179903-0000-4000-8000-000000000001','aa179900-0000-4000-8000-000000000001','reuse-admin@example.invalid','active');
insert into public.refund_machine_qr_codes(reporting_machine_id,public_code,version) values
 ('aa179903-0000-4000-8000-000000000001',repeat('9',32),1);
insert into public.machine_sales_facts(reporting_machine_id,reporting_location_id,sale_date,payment_method,net_sales_cents,transaction_count,source,source_row_hash,item_quantity,tax_cents,raw_payload) values
 ('aa179903-0000-4000-8000-000000000001','aa179902-0000-4000-8000-000000000001','2025-01-01','credit',1200,2,'nayax_scheduled_report','reuse-old-nayax',2,100,'{"providerMachineId":"17990001","_salesAuthorityOriginal":{"netSalesCents":1200,"transactionCount":2,"itemQuantity":2,"taxCents":100}}'),
 ('aa179903-0000-4000-8000-000000000001','aa179902-0000-4000-8000-000000000001','2026-10-04','credit',1800,3,'nayax_scheduled_report','reuse-recent-nayax',3,150,'{"providerMachineId":"17990001","_salesAuthorityOriginal":{"netSalesCents":1800,"transactionCount":3,"itemQuantity":3,"taxCents":150}}');
insert into private.snapcase_provider_accounts(id,source_account_key) values
 ('aa179905-0000-4000-8000-000000000001','reuse-account-a'),
 ('aa179905-0000-4000-8000-000000000002','reuse-account-b');
insert into private.snapcase_source_machines(provider_account_id,source_machine_id,source_label,source_timezone) values
 ('aa179905-0000-4000-8000-000000000001','same-source-id','Unbound imported case','America/Los_Angeles'),
 ('aa179905-0000-4000-8000-000000000002','same-source-id','Different account same ID','America/New_York'),
 ('aa179905-0000-4000-8000-000000000001','historic-case','Expired source identity','America/Los_Angeles');
insert into private.snapcase_machine_mappings(provider_account_id,source_machine_id,reporting_machine_id,effective_start_date,effective_end_date,mapping_reason) values
 ('aa179905-0000-4000-8000-000000000001','historic-case','aa179903-0000-4000-8000-000000000004','2020-01-01','2020-12-31','Historical source connection retained');
insert into public.admin_scoped_access_grants(id,user_id,grant_reason) values
 ('aa179906-0000-4000-8000-000000000001','aa179900-0000-4000-8000-000000000002','Existing exact machine scope');
insert into public.admin_scoped_access_scopes(grant_id,scope_type,machine_id,grant_reason) values
 ('aa179906-0000-4000-8000-000000000001','machine','aa179903-0000-4000-8000-000000000001','Existing cotton scope');
create temporary table reuse_before as select
 (select jsonb_agg(to_jsonb(m) order by id) from public.reporting_machines m where id::text like 'aa179903-%') machines,
 (select jsonb_agg(to_jsonb(l) order by id) from public.reporting_locations l where id::text like 'aa179902-%') sites,
 (select jsonb_agg(to_jsonb(i) order by id) from public.refund_nayax_machine_inventory i where id::text like 'aa179904-%') readers,
 (select jsonb_agg(to_jsonb(f) order by id) from public.machine_sales_facts f where reporting_machine_id::text like 'aa179903-%') facts,
 (select jsonb_agg(to_jsonb(p) order by id) from public.sunze_unmapped_sales p where sunze_machine_id='fixture-1799-gilroy') pending,
 (select jsonb_agg(to_jsonb(m) order by reporting_machine_id,manager_user_id) from public.reporting_machine_refund_managers m where reporting_machine_id::text like 'aa179903-%') managers,
 (select jsonb_agg(to_jsonb(q) order by id) from public.refund_machine_qr_codes q where reporting_machine_id::text like 'aa179903-%') qr,
 (select count(*) from public.reporting_machines) machine_count,
 (select count(*) from public.reporting_locations) site_count,
 (select count(*) from public.admin_audit_log) audits;
create temporary table reuse_expected as select id,updated_at from public.reporting_machines where id::text like 'aa179903-%';
create temporary table reuse_source_set as select jsonb_build_array('Sunze',null::text,sunze_machine_id) identity from public.sunze_machine_discoveries
 union all select jsonb_build_array('Kexiaozhan',provider_account_id::text,source_machine_id) from private.snapcase_source_machines;
grant select on reuse_before,reuse_expected,reuse_source_set to authenticated;
set local session_replication_role=origin;
select ok(not has_function_privilege('anon','public.admin_get_imported_source_reuse_options(text,uuid,text)','execute'),'Anonymous cannot enumerate existing machine reuse options');
select ok(not has_function_privilege('anon','public.admin_reuse_imported_source_machine(text,uuid,text,uuid,uuid,timestamptz,text,text)','execute'),'Anonymous cannot associate an imported source');
select ok(not has_table_privilege('authenticated','private.machine_source_management_associations','INSERT,UPDATE,DELETE'),'Client roles cannot write association records directly');
set local role authenticated;
select set_config('request.jwt.claim.role','authenticated',true);
select set_config('request.jwt.claim.sub','aa179900-0000-4000-8000-000000000003',true);
select throws_ok($$select public.admin_get_imported_source_reuse_options('Sunze',null,'fixture-1799-gilroy')$$,'42501',null,'Authenticated outsider cannot enumerate private reuse targets');
select throws_ok($$select public.admin_reuse_imported_source_machine('Sunze',null,'fixture-1799-gilroy','aa179904-0000-4000-8000-000000000001','aa179903-0000-4000-8000-000000000001',(select updated_at from reuse_expected where id='aa179903-0000-4000-8000-000000000001'),'America/Los_Angeles','Unauthorized source association')$$,'42501',null,'Outsider cannot attach a source');
select set_config('request.jwt.claim.sub','aa179900-0000-4000-8000-000000000002',true);
select throws_ok($$select public.admin_get_imported_source_reuse_options('Sunze',null,'fixture-1799-gilroy')$$,'42501',null,'Scoped reader cannot claim global unbound sources');
select set_config('request.jwt.claim.sub','aa179900-0000-4000-8000-000000000001',true);
select throws_ok($$select public.admin_get_imported_source_reuse_options(null,null,'fixture-1799-gilroy')$$,'22023',null,'NULL platform cannot fall through identity validation');
select ok(public.admin_get_imported_source_reuse_options('Sunze',null,'fixture-1799-gilroy') @> '[{"inventoryId":"aa179904-0000-4000-8000-000000000001","machineId":"aa179903-0000-4000-8000-000000000001","timezone":"America/Los_Angeles","eligible":true}]','Exact occupied legacy reader offers same-Hub reuse with existing saved zone');
select ok(public.admin_get_imported_source_reuse_options('Sunze',null,'fixture-1799-gilroy') @> '[{"inventoryId":"aa179904-0000-4000-8000-000000000002","eligible":false}]','Reader belonging to a genuine source is an explained conflict, not a reusable legacy target');
select ok(public.admin_get_imported_source_reuse_options('Sunze',null,'fixture-1799-gilroy') @> '[{"inventoryId":"aa179904-0000-4000-8000-000000000004","eligible":false}]','Expired source history still blocks silently reusing a different machine');
select ok(public.admin_get_imported_source_reuse_options('Sunze',null,'fixture-1799-gilroy') @> '[{"inventoryId":"aa179904-0000-4000-8000-000000000005","eligible":false}]','Historical pending-order source association blocks reuse even after current source links were cleared');
select throws_ok($$select public.admin_reuse_imported_source_machine('Sunze',null,'fixture-1799-other','aa179904-0000-4000-8000-000000000005','aa179903-0000-4000-8000-000000000005',(select updated_at from reuse_expected where id='aa179903-0000-4000-8000-000000000005'),'America/Los_Angeles','Attempt historical pending association replacement')$$,'22023',null,'Direct writer also rejects a prior pending-order source association');
select throws_ok($$select public.admin_reuse_imported_source_machine('Sunze',null,'fixture-1799-gilroy','aa179904-0000-4000-8000-000000000001','aa179903-0000-4000-8000-000000000001','2000-01-01','America/Los_Angeles','Synthetic stale source review')$$,'40001',null,'Stale machine review cannot attach a source');
select throws_ok($$select public.admin_reuse_imported_source_machine('Sunze',null,'fixture-1799-gilroy','aa179904-0000-4000-8000-000000000001','aa179903-0000-4000-8000-000000000001',(select updated_at from reuse_expected where id='aa179903-0000-4000-8000-000000000001'),'America/New_York','Synthetic stale timezone review')$$,'40001',null,'Changed shared site timezone invalidates review even without a Hub timestamp change');
select throws_ok($$select public.admin_reuse_imported_source_machine('Sunze',null,'fixture-1799-gilroy','aa179904-0000-4000-8000-000000000001','aa179903-0000-4000-8000-000000000001',(select updated_at from reuse_expected where id='aa179903-0000-4000-8000-000000000001'),null,'Synthetic omitted timezone review')$$,'40001',null,'Omitted reviewed timezone cannot authorize association');
select throws_ok($$select public.admin_reuse_imported_source_machine('Sunze',null,'fixture-1799-gilroy','aa179904-0000-4000-8000-000000000002','aa179903-0000-4000-8000-000000000001',(select updated_at from reuse_expected where id='aa179903-0000-4000-8000-000000000001'),'America/Los_Angeles','Synthetic changed reader owner')$$,'40001',null,'Exact reader owner must still match the reviewed machine');
select throws_ok($$select public.admin_reuse_imported_source_machine('Sunze',null,'fixture-1799-gilroy','aa179904-0000-4000-8000-000000000002','aa179903-0000-4000-8000-000000000002',(select updated_at from reuse_expected where id='aa179903-0000-4000-8000-000000000002'),'America/Los_Angeles','Synthetic genuine source conflict')$$,'22023',null,'Existing genuine source cannot be displaced');
select throws_ok($$select public.admin_reuse_imported_source_machine('Kexiaozhan','aa179905-0000-4000-8000-000000000002','same-source-id','aa179904-0000-4000-8000-000000000003','aa179903-0000-4000-8000-000000000003',(select updated_at from reuse_expected where id='aa179903-0000-4000-8000-000000000003'),'America/Los_Angeles','Synthetic zone conflict review')$$,'22023',null,'Conflicting authoritative source zone cannot overwrite saved site history');
select throws_ok($$select public.admin_reuse_imported_source_machine('Sunze',null,'never-imported-source','aa179904-0000-4000-8000-000000000001','aa179903-0000-4000-8000-000000000001',(select updated_at from reuse_expected where id='aa179903-0000-4000-8000-000000000001'),'America/Los_Angeles','Synthetic absent source review')$$,'22023',null,'Reuse cannot fabricate an imported identity');
select lives_ok($$select public.admin_reuse_imported_source_machine('Sunze',null,'fixture-1799-gilroy','aa179904-0000-4000-8000-000000000001','aa179903-0000-4000-8000-000000000001',(select updated_at from reuse_expected where id='aa179903-0000-4000-8000-000000000001'),'America/Los_Angeles','Explicitly confirmed same physical cotton machine')$$,'One reviewed save associates exact imported source to SAME existing Hub');
select ok(public.admin_get_machine_source_inventory()->'sources' @> '[{"sourceId":"fixture-1799-gilroy","reportingMachineId":"aa179903-0000-4000-8000-000000000001","nayaxMachineId":"17990001","salesActivationPending":false}]','Reopened catalogue resolves completed same-machine source association');
select ok(public.admin_get_machine_workspace_metadata() @> '[{"machineId":"aa179903-0000-4000-8000-000000000001","salesActivationPending":false,"sources":[{"platform":"Sunze","id":"fixture-1799-gilroy","lastTransaction":"2026-10-04"}]}]','Reopened Manage projects the completed exact source identity and source calendar date');
select is((select jsonb_agg(jsonb_build_array(x->>'platform',x->>'providerAccountId',x->>'sourceId') order by jsonb_build_array(x->>'platform',x->>'providerAccountId',x->>'sourceId')::text) from jsonb_array_elements(public.admin_get_machine_source_inventory()->'sources') x),(select jsonb_agg(identity order by identity::text) from reuse_source_set),'Associating existing configuration does not add or lose physical source rows');
select throws_ok($$select public.admin_reuse_imported_source_machine('Sunze',null,'fixture-1799-gilroy','aa179904-0000-4000-8000-000000000001','aa179903-0000-4000-8000-000000000001',(select updated_at from reuse_expected where id='aa179903-0000-4000-8000-000000000001'),'America/Los_Angeles','Repeated exact source association')$$,'40001',null,'Repeat save cannot create duplicate source association');
select throws_ok($$select public.admin_setup_imported_machine('Sunze',null,'fixture-1799-gilroy','aa179901-0000-4000-8000-000000000001','Duplicate physical source','commercial','setup','America/Los_Angeles',null,array[]::text[],'Attempt duplicate initial source setup')$$,'40001',null,'Ordinary first setup cannot recreate an associated physical source');
select set_config('request.jwt.claim.sub','aa179900-0000-4000-8000-000000000002',true);
select ok(public.admin_get_machine_source_inventory()->'sources' @> '[{"sourceId":"fixture-1799-gilroy","reportingMachineId":"aa179903-0000-4000-8000-000000000001"}]','Existing exact scoped permission follows associated source without a new grant');
reset role;
select is((select count(*) from public.reporting_machines),(select machine_count from reuse_before),'No additional Hub was created');
select is((select count(*) from public.reporting_locations),(select site_count from reuse_before),'No additional internal site was created');
select is((select jsonb_agg(to_jsonb(m)-array['sunze_machine_id','updated_at'] order by id) from public.reporting_machines m where id::text like 'aa179903-%'),(select jsonb_agg(value-array['sunze_machine_id','updated_at'] order by value->>'id') from reuse_before,jsonb_array_elements(machines)),'All machine configuration/name/company/status/refund flags/boundary remain unchanged apart from the reviewed source ID and update stamp');
select is((select jsonb_agg(to_jsonb(l) order by id) from public.reporting_locations l where id::text like 'aa179902-%'),(select sites from reuse_before),'Existing site and IANA timezone remain byte-identical');
select is((select jsonb_agg(to_jsonb(i) order by id) from public.refund_nayax_machine_inventory i where id::text like 'aa179904-%'),(select readers from reuse_before),'Imported reader ownership/readiness/history remains byte-identical');
select is((select jsonb_agg(to_jsonb(f) order by id) from public.machine_sales_facts f where reporting_machine_id::text like 'aa179903-%' and f.source='nayax_scheduled_report'),(select facts from reuse_before),'Old and recent Nayax facts retain complete bytes and contributions');
select is((select jsonb_agg(to_jsonb(p)-array['status','reporting_machine_id','reporting_location_id','promoted_at','mapped_by','updated_at'] order by id) from public.sunze_unmapped_sales p where sunze_machine_id='fixture-1799-gilroy'),(select jsonb_agg(value-array['status','reporting_machine_id','reporting_location_id','promoted_at','mapped_by','updated_at'] order by value->>'id') from reuse_before,jsonb_array_elements(pending)),'Original order evidence remains byte-identical while reviewed promotion records its exact owner');
select is((select count(*)::int from public.sunze_unmapped_sales where sunze_machine_id='fixture-1799-gilroy' and status='mapped' and reporting_machine_id='aa179903-0000-4000-8000-000000000001' and reporting_location_id='aa179902-0000-4000-8000-000000000001'),2,'Both original pending orders are promoted to the exact existing Hub/site');
select is((select jsonb_agg(to_jsonb(m) order by id) from public.reporting_machines m where id::text like 'aa179903-%' and id not in('aa179903-0000-4000-8000-000000000001','aa179903-0000-4000-8000-000000000003')),(select jsonb_agg(value order by value->>'id') from reuse_before,jsonb_array_elements(machines) where value->>'id' not in('aa179903-0000-4000-8000-000000000001','aa179903-0000-4000-8000-000000000003')),'Unrelated machines retain every original field and update stamp');
select is((select jsonb_agg(to_jsonb(m) order by reporting_machine_id,manager_user_id) from public.reporting_machine_refund_managers m where reporting_machine_id::text like 'aa179903-%'),(select managers from reuse_before),'Existing managers and scopes are preserved');
select is((select jsonb_agg(to_jsonb(q) order by id) from public.refund_machine_qr_codes q where reporting_machine_id::text like 'aa179903-%'),(select qr from reuse_before),'Existing service/refund QR identity is preserved');
select is((select count(*) from public.admin_audit_log),(select audits+3 from reuse_before),'Policy, source identity and association each have a canonical audit');
select ok(exists(select 1 from public.admin_audit_log where action='reporting_machine.source_management_associated' and entity_id='aa179903-0000-4000-8000-000000000001' and meta @> '{"historicalFinancialFactsUnchanged":true,"sourceAssociationCompleted":true}'),'Audit records completed source association and unchanged historical financial facts');
select is((select count(*)::int from public.reporting_machines where sunze_machine_id='fixture-1799-gilroy'),1,'Completed exact source maps to its existing Hub without an extra activation step');
select throws_ok($$update private.machine_source_management_associations set source_id='silently-different-source' where reporting_machine_id='aa179903-0000-4000-8000-000000000001'$$,'22023',null,'Management association cannot silently change its physical identity');
select throws_ok($$delete from private.machine_source_management_associations where reporting_machine_id='aa179903-0000-4000-8000-000000000001'$$,'22023',null,'Ordinary deletion cannot remove association history or enable duplicate setup');
select set_config('request.jwt.claim.sub','aa179900-0000-4000-8000-000000000001',true);
select throws_ok($$select private.upsert_reporting_machine_identity('aa179903-0000-4000-8000-000000000001','aa179901-0000-4000-8000-000000000001','aa179902-0000-4000-8000-000000000001','Existing cotton machine','commercial','fixture-1799-other','Attempt unsafe source identity change',true)$$,'22023',null,'Ordinary identity writer cannot replace the reviewed physical source');
select is((select sum(net_sales_cents) from private.financial_machine_sales_facts where reporting_machine_id='aa179903-0000-4000-8000-000000000001'),3400::bigint,'Nayax plus genuine source cash count once after source completion');
-- Repeated old pending admission does not recreate or move the completed source.
-- The canonical financial map already resolves the same physical Hub.
insert into public.sunze_unmapped_sales(sunze_machine_id,source_order_hash,source_row_hash,sale_date,payment_method,net_sales_cents,transaction_count,raw_payload)
 select 'fixture-1799-gilroy',repeat('1',64),'reuse-old-row','2025-08-03','credit',900,1,'{"machine_code":"fixture-1799-gilroy","machine_name":"Imported cotton alias"}'::jsonb
 where not exists(select 1 from public.reporting_machines where lower(sunze_machine_id)=lower('fixture-1799-gilroy'))
 on conflict(source_order_hash) do update set raw_payload=excluded.raw_payload;
select is((select count(*)::int from public.sunze_unmapped_sales where sunze_machine_id='fixture-1799-gilroy' and status='pending' and reporting_machine_id is null),0,'Completed old order evidence is not duplicated as a new pending order');
select is((select jsonb_agg(to_jsonb(f) order by id) from public.machine_sales_facts f where reporting_machine_id::text like 'aa179903-%' and f.source='nayax_scheduled_report'),(select facts from reuse_before),'Source replay cannot rewrite or double-count prior Nayax history');
-- A late audit failure must roll back the association itself.
create temporary table reuse_before_late_failure as select jsonb_agg(to_jsonb(m) order by id) machines from public.reporting_machines m where id::text like 'aa179903-%';
create function pg_temp.fail_reuse_audit() returns trigger language plpgsql as $$begin if new.action='reporting_machine.source_management_associated' then raise exception 'Synthetic late audit failure' using errcode='P0001'; end if; return new; end$$;
create trigger reuse_late_audit before insert on public.admin_audit_log for each row execute function pg_temp.fail_reuse_audit();
set local role authenticated;
select set_config('request.jwt.claim.sub','aa179900-0000-4000-8000-000000000001',true);
select throws_ok($$select public.admin_reuse_imported_source_machine('Kexiaozhan','aa179905-0000-4000-8000-000000000001','same-source-id','aa179904-0000-4000-8000-000000000003','aa179903-0000-4000-8000-000000000003',(select updated_at from reuse_expected where id='aa179903-0000-4000-8000-000000000003'),'America/Los_Angeles','Synthetic final audit rollback')$$,'P0001','Synthetic late audit failure','Late audit failure atomically rolls back Kex association');
reset role;
drop trigger reuse_late_audit on public.admin_audit_log;
select is((select count(*)::int from private.machine_source_management_associations where reporting_machine_id='aa179903-0000-4000-8000-000000000003'),0,'No partial Kex management link after audit failure');
select is((select jsonb_agg(to_jsonb(m) order by id) from public.reporting_machines m where id::text like 'aa179903-%'),(select machines from reuse_before_late_failure),'Late failure preserves every machine field and earlier completed source identity');
select is((select count(*) from public.admin_audit_log),(select audits+3 from reuse_before),'Rejected second operation adds no misleading audit');
set local role authenticated;
select lives_ok($$select public.admin_reuse_imported_source_machine('Kexiaozhan','aa179905-0000-4000-8000-000000000001','same-source-id','aa179904-0000-4000-8000-000000000003','aa179903-0000-4000-8000-000000000003',(select updated_at from reuse_expected where id='aa179903-0000-4000-8000-000000000003'),'America/Los_Angeles','Explicit same physical case machine review')$$,'Kex management association preserves exact provider/account/source tuple');
select ok(public.admin_get_machine_source_inventory()->'sources' @> '[{"platform":"Kexiaozhan","providerAccountId":"aa179905-0000-4000-8000-000000000001","sourceId":"same-source-id","reportingMachineId":"aa179903-0000-4000-8000-000000000003","salesActivationPending":false}]','Selected Kex account resolves same existing case machine');
select ok(public.admin_get_machine_source_inventory()->'sources' @> '[{"platform":"Kexiaozhan","providerAccountId":"aa179905-0000-4000-8000-000000000002","sourceId":"same-source-id","reportingMachineId":null}]','Same source ID in another account is not silently associated');
reset role;
select is((select count(*)::int from private.snapcase_machine_mappings where provider_account_id='aa179905-0000-4000-8000-000000000001' and source_machine_id='same-source-id' and reporting_machine_id='aa179903-0000-4000-8000-000000000003'),1,'Completed Kex source has one exact canonical mapping');
select throws_ok($$insert into private.snapcase_machine_mappings(provider_account_id,source_machine_id,reporting_machine_id,effective_start_date,mapping_reason) values('aa179905-0000-4000-8000-000000000001','different-reviewed-source','aa179903-0000-4000-8000-000000000003','2026-01-01','Attempt unsafe case source replacement')$$,'22023',null,'Ordinary Kex writer cannot replace the reviewed physical source');
select is((select jsonb_agg(to_jsonb(m)-array['sunze_machine_id','updated_at'] order by id) from public.reporting_machines m where id::text like 'aa179903-%'),(select jsonb_agg(value-array['sunze_machine_id','updated_at'] order by value->>'id') from reuse_before,jsonb_array_elements(machines)),'Both platform associations preserve all original machine bytes');
select * from finish();
rollback;
