begin;
create extension if not exists pgtap with schema extensions;
set local search_path=public,extensions;
select no_plan();
-- Disposable synthetic identities only. Origin triggers are enabled for every
-- action under test; the initial fixture bypass avoids incidental seed effects.
set local session_replication_role=replica;
insert into auth.users(id,email) values
 ('aa177400-0000-4000-8000-000000000001','source-admin@example.invalid'),
 ('aa177400-0000-4000-8000-000000000002','source-scoped@example.invalid'),
 ('aa177400-0000-4000-8000-000000000003','source-manager@example.invalid'),
 ('aa177400-0000-4000-8000-000000000004','source-outsider@example.invalid');
insert into public.admin_roles(user_id,role,active) values
 ('aa177400-0000-4000-8000-000000000001','super_admin',true);
insert into public.customer_accounts(id,name) values
 ('aa177401-0000-4000-8000-000000000001','Source catalogue fixture company');
insert into public.reporting_locations(id,account_id,name,timezone) values
 ('aa177402-0000-4000-8000-000000000001','aa177401-0000-4000-8000-000000000001','Retired descriptive venue','America/Los_Angeles');
insert into public.reporting_machines(id,account_id,location_id,machine_label,machine_type,sunze_machine_id,nayax_machine_id,nayax_account_key) values
 ('aa177403-0000-4000-8000-000000000001','aa177401-0000-4000-8000-000000000001','aa177402-0000-4000-8000-000000000001','Mapped cotton machine','commercial','fixture-1774-mapped',null,null),
 ('aa177403-0000-4000-8000-000000000002','aa177401-0000-4000-8000-000000000001','aa177402-0000-4000-8000-000000000001','Mapped case machine','snapcase',null,null,null),
 ('aa177403-0000-4000-8000-000000000003','aa177401-0000-4000-8000-000000000001','aa177402-0000-4000-8000-000000000001','Conflicting case machine','snapcase',null,null,null),
 ('aa177403-0000-4000-8000-000000000004','aa177401-0000-4000-8000-000000000001','aa177402-0000-4000-8000-000000000001','Hub-only service history','commercial',null,'17740002','FIXTURE_SOURCE_A');
insert into public.sunze_machine_discoveries(sunze_machine_id,sunze_machine_name,status,reporting_machine_id,last_seen_at,ignore_reason) values
 ('fixture-1774-mapped','Imported cotton alias','mapped','aa177403-0000-4000-8000-000000000001',now(),null),
 ('fixture-1774-pending','Imported Gilroy fixture','pending',null,now(),null),
 ('fixture-1774-ignored',null,'ignored',null,'2020-01-01','Synthetic historical imported identity');
insert into public.sunze_unmapped_sales(sunze_machine_id,source_order_hash,source_row_hash,sale_date,net_sales_cents,transaction_count) values
 ('fixture-1774-pending','fixture-source-order-positive','fixture-source-row-positive','2026-10-04',500,1),
 ('fixture-1774-pending','fixture-source-order-zero','fixture-source-row-zero','2026-10-05',0,0);
insert into private.snapcase_provider_accounts(id,source_account_key) values
 ('aa177405-0000-4000-8000-000000000001','fixture-source-account-a'),
 ('aa177405-0000-4000-8000-000000000002','fixture-source-account-b');
insert into private.snapcase_source_machines(provider_account_id,source_machine_id,source_label,source_status,source_timezone,first_seen_at,last_seen_at) values
 ('aa177405-0000-4000-8000-000000000001','same-source-id',null,null,'America/Los_Angeles','2020-01-01','2020-01-01'),
 ('aa177405-0000-4000-8000-000000000002','same-source-id','Other account same ID','offline','America/Los_Angeles',now(),now()),
 ('aa177405-0000-4000-8000-000000000001','bound-case','Imported case alias','1','America/Los_Angeles',now(),now()),
 ('aa177405-0000-4000-8000-000000000001','conflicting-case','Conflicting mapping source','0','America/Los_Angeles',now(),now());
insert into private.snapcase_machine_mappings(provider_account_id,source_machine_id,reporting_machine_id,effective_start_date,mapping_reason) values
 ('aa177405-0000-4000-8000-000000000001','bound-case','aa177403-0000-4000-8000-000000000002','2020-01-01','Synthetic exact mapping'),
 ('aa177405-0000-4000-8000-000000000001','conflicting-case','aa177403-0000-4000-8000-000000000002','2020-01-01','Synthetic conflicting imported mapping'),
 ('aa177405-0000-4000-8000-000000000001','conflicting-case','aa177403-0000-4000-8000-000000000003','2021-01-01','Synthetic conflicting imported mapping');
insert into public.admin_scoped_access_grants(id,user_id,grant_reason) values
 ('aa177406-0000-4000-8000-000000000001','aa177400-0000-4000-8000-000000000002','Synthetic exact source scope');
insert into public.admin_scoped_access_scopes(grant_id,scope_type,machine_id,grant_reason) values
 ('aa177406-0000-4000-8000-000000000001','machine','aa177403-0000-4000-8000-000000000001','Synthetic mapped cotton scope'),
 ('aa177406-0000-4000-8000-000000000001','machine','aa177403-0000-4000-8000-000000000004','Synthetic legacy service scope');
insert into public.refund_nayax_machine_inventory(id,account_key,nayax_machine_id,machine_name,provider_is_active,reporting_machine_id,reconciliation_state) values
 ('aa177404-0000-4000-8000-000000000001','FIXTURE_SOURCE_A','17740001','Available imported reader',true,null,'needs_setup'),
 ('aa177404-0000-4000-8000-000000000002','FIXTURE_SOURCE_A','17740002','Occupied historical reader',true,'aa177403-0000-4000-8000-000000000004','needs_setup'),
 ('aa177404-0000-4000-8000-000000000003','FIXTURE_SOURCE_B','17740001','Other merchant same reader ID',true,null,'needs_setup');
insert into private.nayax_machine_tax_observations(account_key,nayax_machine_id,observed_at,source,classification,rate_percent,provenance,effective_start_date) values
 ('FIXTURE_SOURCE_A','17740001',now()-interval '1 hour','finance_verified','verified_tax',7.25,'Synthetic verified source tax',current_date-1),
 ('FIXTURE_SOURCE_A','17740002',now(),'nayax_api','unclassified_extra_charge',9,'Synthetic surcharge, not verified tax',current_date-1),
 ('FIXTURE_SOURCE_B','17740001',now(),'finance_verified','verified_tax',9.5,'Synthetic different merchant tax',current_date-1);
insert into public.machine_sales_facts(reporting_machine_id,reporting_location_id,sale_date,payment_method,net_sales_cents,transaction_count,source,source_row_hash,raw_payload) values
 ('aa177403-0000-4000-8000-000000000004','aa177402-0000-4000-8000-000000000001','2026-09-01','credit',800,1,'nayax_scheduled_report','fixture-source-history','{"providerMachineId":"17740002","originalName":"Preserved history"}');
create temporary table source_setup_history_before as select id,to_jsonb(fact) value from public.machine_sales_facts fact where source_row_hash='fixture-source-history';
create temporary table source_catalogue_expected as
 select jsonb_build_array('Sunze',null::text,sunze_machine_id) identity from public.sunze_machine_discoveries
 union all select jsonb_build_array('Kexiaozhan',provider_account_id::text,source_machine_id) from private.snapcase_source_machines;
create temporary table source_setup_result(platform text primary key,machine_id uuid);
grant select on source_catalogue_expected,source_setup_history_before to authenticated;
grant select,insert on source_setup_result to authenticated;
set local session_replication_role=origin;
select ok(not has_function_privilege('anon','public.admin_get_machine_source_inventory()','execute'),'Anonymous cannot enumerate imported sources');
select ok(not has_function_privilege('anon','public.admin_setup_imported_machine(text,uuid,text,uuid,text,text,text,text,uuid,text[],text)','execute'),'Anonymous cannot create imported configuration');
select ok(not has_function_privilege('anon','public.admin_get_imported_machine_tax(uuid)','execute'),'Anonymous cannot read private source tax');
set local role authenticated;
select set_config('request.jwt.claim.role','authenticated',true);
select set_config('request.jwt.claim.sub','aa177400-0000-4000-8000-000000000004',true);
select throws_ok($$select public.admin_get_machine_source_inventory()$$,'42501',null,'Authenticated outsider cannot enumerate source inventory');
select throws_ok($$select public.admin_get_imported_machine_tax('aa177404-0000-4000-8000-000000000001')$$,'42501',null,'Authenticated outsider cannot read imported tax');
select set_config('request.jwt.claim.sub','aa177400-0000-4000-8000-000000000002',true);
select is((public.admin_get_machine_source_inventory()->>'count')::int,1,'Scoped user sees exact authorized imported source only, not authorized Hub-only history or global unbound sources');
select ok(public.admin_get_machine_source_inventory()->'sources' @> '[{"platform":"Sunze","sourceId":"fixture-1774-mapped","reportingMachineId":"aa177403-0000-4000-8000-000000000001"}]','Scoped catalogue preserves stable mapped identity');
select throws_ok($$select public.admin_setup_imported_machine('Sunze',null,'fixture-1774-pending','aa177401-0000-4000-8000-000000000001','Unauthorized setup','commercial','setup','America/Los_Angeles',null,array[]::text[],'Synthetic denied setup')$$,'42501',null,'Scoped user cannot claim an unbound source');
select throws_ok($$select public.admin_get_imported_machine_tax('aa177404-0000-4000-8000-000000000001')$$,'42501',null,'Scoped user cannot enumerate arbitrary imported-reader tax');
select set_config('request.jwt.claim.sub','aa177400-0000-4000-8000-000000000001',true);
select is(
 (select jsonb_agg(identity order by identity::text) from source_catalogue_expected),
 (select jsonb_agg(jsonb_build_array(item->>'platform',item->>'providerAccountId',item->>'sourceId') order by jsonb_build_array(item->>'platform',item->>'providerAccountId',item->>'sourceId')::text) from jsonb_array_elements(public.admin_get_machine_source_inventory()->'sources') item),
 'Superadmin catalogue equals the COMPLETE stored provider/account/source-ID set, including old/ignored/unnamed sources');
select is((public.admin_get_machine_source_inventory()->>'count')::int,jsonb_array_length(public.admin_get_machine_source_inventory()->'sources'),'Reported count equals exact source rows');
select is((select count(*)::int from jsonb_array_elements(public.admin_get_machine_source_inventory()->'sources') item),(select count(distinct jsonb_build_array(item->>'platform',item->>'providerAccountId',item->>'sourceId'))::int from jsonb_array_elements(public.admin_get_machine_source_inventory()->'sources') item),'No duplicate semantic source tuple');
select is((select count(*)::int from jsonb_array_elements(public.admin_get_machine_source_inventory()->'sources') item where item->>'sourceId'='same-source-id'),2,'Same source ID in distinct provider accounts is two exact identities');
select ok(not exists(select 1 from jsonb_array_elements(public.admin_get_machine_source_inventory()->'sources') item where item->>'reportingMachineId'='aa177403-0000-4000-8000-000000000004'),'Hub-only reader/service history cannot originate a catalogue row');
select ok(public.admin_get_machine_source_inventory()->'sources' @> '[{"sourceId":"fixture-1774-pending","reportingMachineId":null,"lastSourceTransaction":"2026-10-04"}]','Unbound positive Sunze transaction retains source calendar date and ignores newer zero-sale row');
select ok(public.admin_get_machine_source_inventory()->'sources' @> '[{"sourceId":"fixture-1774-ignored","sourceName":null,"discoveryStatus":"ignored","reportingMachineId":null}]','Unknown name and ignored historical discovery remain visible');
select ok(public.admin_get_machine_source_inventory()->'sources' @> '[{"sourceId":"conflicting-case","mappingConflict":true,"reportingMachineId":null}]','Ambiguous current mapping is one source row with explicit conflict, not a guessed Hub');
select is((public.admin_get_imported_machine_tax('aa177404-0000-4000-8000-000000000001')->>'ratePercent')::numeric,7.25::numeric,'Verified numeric tax is available before real Hub setup');
select is((public.admin_get_imported_machine_tax('aa177404-0000-4000-8000-000000000003')->>'ratePercent')::numeric,9.5::numeric,'Tax preview uses exact merchant account as well as reader ID');
select is(public.admin_get_imported_machine_tax('aa177404-0000-4000-8000-000000000002')->>'ratePercent',null::text,'Unclassified surcharge is never invented as numeric tax');
select is(public.admin_get_imported_machine_tax('aa177404-0000-4000-8000-000000000099')->>'coverageStatus','missing','Missing imported reader has explicit unavailable tax state');
reset role;
create temporary table source_setup_before_failure as select
 (select count(*) from public.reporting_machines) machines,
 (select count(*) from public.reporting_locations) locations,
 (select count(*) from public.admin_audit_log) audits,
 (select to_jsonb(d) from public.sunze_machine_discoveries d where sunze_machine_id='fixture-1774-ignored') discovery;
set local role authenticated;
select throws_ok($$select public.admin_setup_imported_machine('Sunze',null,'fixture-1774-ignored','aa177401-0000-4000-8000-000000000001','Rejected occupied reader','commercial','setup','America/Los_Angeles','aa177404-0000-4000-8000-000000000002',array[]::text[],'Synthetic occupied rollback')$$,'23505',null,'Occupied reader cannot be stolen by new source setup');
select throws_ok($$select public.admin_setup_imported_machine('Sunze',null,'fixture-1774-ignored','aa177401-0000-4000-8000-000000000001','Rejected manager setup','commercial','setup','America/Los_Angeles',null,array['not-registered@example.invalid'],'Synthetic manager rollback')$$,'P0001',null,'Unknown manager rejects complete setup transaction');
select throws_ok($$select public.admin_setup_imported_machine('Kexiaozhan','aa177405-0000-4000-8000-000000000099','same-source-id','aa177401-0000-4000-8000-000000000001','Wrong merchant source','snapcase','setup','America/Los_Angeles',null,array[]::text[],'Synthetic missing account source')$$,'22023',null,'Source ID in another account cannot substitute for selected exact merchant');
select throws_ok($$select public.admin_setup_imported_machine('Kexiaozhan','aa177405-0000-4000-8000-000000000001','conflicting-case','aa177401-0000-4000-8000-000000000001','Guessed conflict target','snapcase','setup','America/Los_Angeles',null,array[]::text[],'Synthetic conflict rejection')$$,'40001',null,'Conflicting exact source mapping cannot be repaired by initial setup or name guess');
select throws_ok($$select public.admin_setup_imported_machine('Sunze',null,'source-that-was-never-imported','aa177401-0000-4000-8000-000000000001','Invented physical machine','commercial','setup','America/Los_Angeles',null,array[]::text[],'Synthetic absent source')$$,'22023',null,'Initial setup cannot fabricate a source that was never imported');
reset role;
select is((select count(*) from public.reporting_machines),(select machines from source_setup_before_failure),'Rejected first setup creates no partial Hub');
select is((select count(*) from public.reporting_locations),(select locations from source_setup_before_failure),'Rejected first setup creates no partial internal location');
select is((select count(*) from public.admin_audit_log),(select audits from source_setup_before_failure),'Rejected first setup commits no misleading audit');
select is((select to_jsonb(d) from public.sunze_machine_discoveries d where sunze_machine_id='fixture-1774-ignored'),(select discovery from source_setup_before_failure),'Rejected first setup preserves source state and identity');
set local role authenticated;
select lives_ok($$insert into source_setup_result values('Sunze',(public.admin_setup_imported_machine('Sunze',null,'fixture-1774-pending','aa177401-0000-4000-8000-000000000001','Canonical cotton name','commercial','setup','America/Los_Angeles','aa177404-0000-4000-8000-000000000001',array['source-manager@example.invalid'],'Synthetic unified source setup')->>'machineId')::uuid)$$,'One atomic Manage save creates exact Sunze configuration/name/company/Nayax/managers');
select throws_ok($$select public.admin_setup_imported_machine('Sunze',null,'fixture-1774-pending','aa177401-0000-4000-8000-000000000001','Repeated source attempt','commercial','setup','America/Los_Angeles',null,array[]::text[],'Synthetic duplicate rejection')$$,'40001',null,'Repeated initial setup cannot recreate a canonical source identity');
select lives_ok($$insert into source_setup_result values('Kexiaozhan',(public.admin_setup_imported_machine('Kexiaozhan','aa177405-0000-4000-8000-000000000001','same-source-id','aa177401-0000-4000-8000-000000000001','Canonical case name','snapcase','setup','America/Los_Angeles',null,array[]::text[],'Synthetic unbound case setup')->>'machineId')::uuid)$$,'Unbound unnamed historic Kex source is configurable without inventing another source identity');
reset role;
select is((select count(*)::int from public.reporting_machines where sunze_machine_id='fixture-1774-pending'),1,'Sunze source owns exactly one real Hub');
select is((select machine_display_name from public.reporting_machines where id=(select machine_id from source_setup_result where platform='Sunze')),'Canonical cotton name','Single canonical name persisted');
select is((select refund_public_display_label from public.reporting_machines where id=(select machine_id from source_setup_result where platform='Sunze')),'Canonical cotton name','Refund name projection agrees');
select is((select account_id from public.reporting_machines where id=(select machine_id from source_setup_result where platform='Sunze')),'aa177401-0000-4000-8000-000000000001'::uuid,'Chosen company persists without name matching');
select is((select nayax_machine_id from public.reporting_machines where id=(select machine_id from source_setup_result where platform='Sunze')),'17740001','Selected exact reader persists');
select is((select nayax_account_key from public.reporting_machines where id=(select machine_id from source_setup_result where platform='Sunze')),'FIXTURE_SOURCE_A','Selected exact reader merchant persists');
select is((select reporting_machine_id from public.refund_nayax_machine_inventory where id='aa177404-0000-4000-8000-000000000001'),(select machine_id from source_setup_result where platform='Sunze'),'Nayax imported record joins the one real Hub');
select is((select count(*)::int from public.reporting_machine_refund_managers where reporting_machine_id=(select machine_id from source_setup_result where platform='Sunze') and manager_user_id='aa177400-0000-4000-8000-000000000003' and status='active' and revoked_at is null),1,'Chosen manager is granted exactly once');
select is((select count(*)::int from private.snapcase_machine_mappings where provider_account_id='aa177405-0000-4000-8000-000000000001' and source_machine_id='same-source-id' and reporting_machine_id=(select machine_id from source_setup_result where platform='Kexiaozhan')),1,'Kex source mapping uses selected stable account/source tuple');
select is((select count(*)::int from private.snapcase_machine_mappings where provider_account_id='aa177405-0000-4000-8000-000000000002' and source_machine_id='same-source-id'),0,'Same source ID in other merchant is untouched');
select is((select count(*)::int from source_setup_history_before original join public.machine_sales_facts fact on fact.id=original.id where to_jsonb(fact)=original.value),1,'New source setup leaves existing reader history byte-equivalent');
select is((select reporting_machine_id from public.refund_nayax_machine_inventory where id='aa177404-0000-4000-8000-000000000002'),'aa177403-0000-4000-8000-000000000004'::uuid,'Existing operational Hub-only route remains bound');
set local role authenticated;
select is((public.admin_get_machine_source_inventory()->>'count')::int,(select count(*)::int from source_catalogue_expected),'Configuring imports never adds physical catalogue rows');
select ok(public.admin_get_machine_source_inventory()->'sources' @> '[{"sourceId":"fixture-1774-pending","machineName":"Canonical cotton name","nayaxMachineId":"17740001","nayaxAccountKey":"FIXTURE_SOURCE_A"}]','Post-save source row joins exact canonical name and reader');
reset role;
select * from finish();
rollback;
