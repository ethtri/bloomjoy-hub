begin;
create extension if not exists pgtap with schema extensions;
set local search_path=public,extensions;
select no_plan();
set local session_replication_role=replica;
insert into auth.users(id,email) values
 ('cc173000-0000-4000-8000-000000000001','management-admin@example.invalid'),
 ('cc173000-0000-4000-8000-000000000002','management-viewer@example.invalid');
insert into public.admin_roles(user_id,role,active) values('cc173000-0000-4000-8000-000000000001','super_admin',true);
insert into public.customer_accounts(id,name,status,updated_at) values
 ('cc173001-0000-4000-8000-000000000001','Management original','inactive','2020-01-01'),
 ('cc173001-0000-4000-8000-000000000002','Management duplicate','active','2020-01-01');
insert into public.reporting_locations(id,account_id,name,timezone) values
 ('cc173002-0000-4000-8000-000000000001','cc173001-0000-4000-8000-000000000001','Preserved venue','America/Chicago'),
 ('cc173002-0000-4000-8000-000000000002','cc173001-0000-4000-8000-000000000002','Other venue','America/New_York');
insert into public.reporting_machines(id,account_id,location_id,machine_label,machine_type,sunze_machine_id,status) values
 ('cc173003-0000-4000-8000-000000000001','cc173001-0000-4000-8000-000000000001','cc173002-0000-4000-8000-000000000001','Archived current source','commercial','1730-current-source','inactive'),
 ('cc173003-0000-4000-8000-000000000002','cc173001-0000-4000-8000-000000000002','cc173002-0000-4000-8000-000000000002','Other machine','commercial',null,'active'),
 ('cc173003-0000-4000-8000-000000000003','cc173001-0000-4000-8000-000000000001','cc173002-0000-4000-8000-000000000001','Archived current SnapCase','snapcase',null,'active');
insert into public.reporting_machine_entitlements(user_id,machine_id,starts_at)
 values('cc173000-0000-4000-8000-000000000002','cc173003-0000-4000-8000-000000000003','2020-01-01');
insert into public.reporting_machine_refund_managers(reporting_machine_id,manager_user_id,manager_email,status)
 values('cc173003-0000-4000-8000-000000000003','cc173000-0000-4000-8000-000000000002','management-viewer@example.invalid','active');
insert into public.machine_sales_facts(reporting_machine_id,reporting_location_id,sale_date,payment_method,net_sales_cents,transaction_count,source,source_row_hash)
 values('cc173003-0000-4000-8000-000000000003','cc173002-0000-4000-8000-000000000001','2026-09-01','cash',1250,1,'manual_csv',repeat('a',64));
insert into public.reporting_partnerships(id,name,partnership_type,effective_start_date,status)
 values('cc173004-0000-4000-8000-000000000001','Management settlement fixture','internal','2020-01-01','active');
insert into private.snapcase_provider_accounts(id,source_account_key)
 values('cc173005-0000-4000-8000-000000000001','management-source-fixture');
insert into private.snapcase_source_machines(provider_account_id,source_inventory_id,source_machine_id,source_label,source_status) values
 ('cc173005-0000-4000-8000-000000000001','management-new-inventory','management-new-source','New source','active'),
 ('cc173005-0000-4000-8000-000000000001','management-current-inventory','management-current-source','Existing source','active');
set local session_replication_role=origin;
select set_config('request.jwt.claim.role','authenticated',true);
select set_config('request.jwt.claim.sub','cc173000-0000-4000-8000-000000000001',true);

create temporary table management_initial as select updated_at from public.customer_accounts where id='cc173001-0000-4000-8000-000000000001';
select throws_ok($$select public.admin_manage_reporting_company('cc173001-0000-4000-8000-000000000001','rename','2020-01-01','   ')$$,'22023','Company name is required','Empty rename rejected');
select throws_ok($$select public.admin_manage_reporting_company('cc173001-0000-4000-8000-000000000001','rename','2020-01-01',' MANAGEMENT duplicate ')$$,'23505',null,'Trim/case rename collision rejected');
select throws_ok($$select public.admin_manage_reporting_company('cc173001-0000-4000-8000-000000000001','invalid','2020-01-01')$$,'22023',null,'Unknown management action rejected');
select throws_ok($$select public.admin_manage_reporting_company('cc173001-0000-4000-8000-000000000001','archive',null)$$,'40001',null,'Missing concurrency token fails closed');
create temporary table renamed_company as select public.admin_manage_reporting_company('cc173001-0000-4000-8000-000000000001','rename','2020-01-01','  Management renamed  ') result;
select is((select result->>'accountName' from renamed_company),'Management renamed','Rename trims canonical name');
select is((select result->>'accountId' from renamed_company),'cc173001-0000-4000-8000-000000000001','Rename preserves canonical identity');
select is((select result->>'status' from renamed_company),'inactive','Rename preserves unrelated account status');
select is((select (result->>'machineCount')::int from renamed_company),2,'Management includes all current inventory assignments');
select ok((select (result->>'updatedAt')::timestamptz>updated_at from renamed_company,management_initial),'Management advances stale token');
select throws_ok($$select public.admin_manage_reporting_company('cc173001-0000-4000-8000-000000000001','archive','2020-01-01')$$,'40001',null,'Prior token cannot archive after rename');
select throws_ok($$insert into public.customer_accounts(name) values(' MANAGEMENT renamed ')$$,'23505',null,'Generic account writer cannot bypass trim/case duplicate guard');
select lives_ok($$insert into public.customer_accounts(name) values(' MANAGEMENT renamed ') on conflict(lower(name)) do nothing$$,'Existing ON CONFLICT duplicate handling is retained');

create temporary table archived_company as select public.admin_manage_reporting_company(
 'cc173001-0000-4000-8000-000000000001','archive',(select (result->>'updatedAt')::timestamptz from renamed_company)) result;
select isnt((select result->>'archivedAt' from archived_company),null::text,'Archive returns explicit independent flag');
select is((select status from public.customer_accounts where id='cc173001-0000-4000-8000-000000000001'),'inactive','Archive does not mutate account status');
select is(public.admin_create_reporting_company(' MANAGEMENT renamed ')->>'created','false','Create duplicate archived name returns existing company');
select is(public.admin_create_reporting_company('Management renamed')->>'archivedAt',(select result->>'archivedAt' from archived_company),'Duplicate create never restores archived company');
select ok(public.admin_get_reporting_company_choices() @> '{"companies":[{"accountId":"cc173001-0000-4000-8000-000000000001","accountName":"Management renamed","machineCount":2}]}'::jsonb,'Archived company remains in management directory');
select throws_ok($$select public.admin_manage_reporting_company('cc173001-0000-4000-8000-000000000002','rename','2020-01-01',' Management renamed ')$$,'23505',null,'Archived names remain reserved');
select throws_ok($$select public.admin_upsert_reporting_machine_by_id(null,'cc173001-0000-4000-8000-000000000001','cc173002-0000-4000-8000-000000000001','New archived machine','commercial',null,'setup','Fixture',null,null)$$,'22023','Archived companies are unavailable for new machine assignments','ID writer cannot create new archived assignment');
select throws_ok($$select public.admin_upsert_reporting_machine_by_id('cc173003-0000-4000-8000-000000000002','cc173001-0000-4000-8000-000000000001','cc173002-0000-4000-8000-000000000001','Moved archived machine','commercial',null,'live','Fixture','cc173001-0000-4000-8000-000000000002','cc173002-0000-4000-8000-000000000002')$$,'22023',null,'Existing other-company machine cannot move into archived company');
select throws_ok($$select public.admin_upsert_reporting_machine(null,'Management renamed','Preserved venue','Legacy archived','commercial',null,'Fixture')$$,'22023',null,'Legacy name writer cannot bypass archive');
select throws_ok($$select public.admin_upsert_reporting_machine_with_phase(null,'Management renamed','Preserved venue','Phase archived','commercial',null,'setup','Fixture','America/Chicago')$$,'22023',null,'Legacy phase writer cannot bypass archive');
select throws_ok($$insert into public.reporting_machines(account_id,location_id,machine_label,machine_type) values('cc173001-0000-4000-8000-000000000001','cc173002-0000-4000-8000-000000000001','Direct archived machine','commercial')$$,'22023',null,'Inventory row guard closes direct authorized insert bypass');
select throws_ok($$update public.reporting_machines set account_id='cc173001-0000-4000-8000-000000000001',location_id='cc173002-0000-4000-8000-000000000001' where id='cc173003-0000-4000-8000-000000000002'$$,'22023',null,'Inventory row guard closes direct authorized reassignment bypass');
select throws_ok($$select public.admin_upsert_reporting_machine_by_id(null,'cc173001-0000-4000-8000-000000000001',null,'Atomic location archive','commercial',null,'setup','Fixture',null,null,'Rejected new venue','America/Chicago')$$,'22023',null,'Add-location new assignment rolls back under archive guard');
select is((select count(*)::int from public.reporting_locations where name='Rejected new venue'),0,'Rejected assignment leaves no newly created location');
select lives_ok($$select public.admin_upsert_reporting_machine_by_id('cc173003-0000-4000-8000-000000000001','cc173001-0000-4000-8000-000000000001','cc173002-0000-4000-8000-000000000001','Edited saved source','commercial','1730-current-source','live','Fixture','cc173001-0000-4000-8000-000000000001','cc173002-0000-4000-8000-000000000001')$$,'Unchanged archived assignment remains editable');
select is((select status from public.reporting_machines where id='cc173003-0000-4000-8000-000000000001'),'inactive','Saved edit preserves machine status');
select throws_ok($$select public.admin_map_source_machine_to_partnership_by_id('1730-new-source','cc173004-0000-4000-8000-000000000001','New source',null,'commercial',0,'2020-01-01',null,'2020-01-01','Fixture','cc173001-0000-4000-8000-000000000001','cc173002-0000-4000-8000-000000000001',null,null,null)$$,'22023',null,'Sunze mapping cannot create archived assignment');
select lives_ok($$select public.admin_map_source_machine_to_partnership_by_id('1730-current-source','cc173004-0000-4000-8000-000000000001','Edited saved source',null,'commercial',0,'2020-01-01',null,'2020-01-01','Fixture','cc173001-0000-4000-8000-000000000001','cc173002-0000-4000-8000-000000000001',null,'cc173001-0000-4000-8000-000000000001','cc173002-0000-4000-8000-000000000001')$$,'Sunze current archived assignment remains editable');

-- SnapCase retains its inherited active-only new-machine validation. Give this
-- archived company active status through a legacy account writer; flag remains.
update public.customer_accounts set status='active' where id='cc173001-0000-4000-8000-000000000001';
select ok((select reporting_archived_at is not null from public.customer_accounts where id='cc173001-0000-4000-8000-000000000001'),'Legacy account activation cannot restore reporting archive');
select throws_ok($$select public.admin_map_snapcase_machine('cc173005-0000-4000-8000-000000000001','management-new-source',null,'cc173001-0000-4000-8000-000000000001','cc173002-0000-4000-8000-000000000001',null,'New archived SnapCase','cc173004-0000-4000-8000-000000000001','2020-01-01',null,'Fixture',null)$$,'22023',null,'SnapCase new mapping cannot bypass archive');
select throws_ok($$select public.admin_map_snapcase_machine('cc173005-0000-4000-8000-000000000001','management-new-source',null,'cc173001-0000-4000-8000-000000000001','cc173002-0000-4000-8000-000000000001',null,'New archived SnapCase','cc173004-0000-4000-8000-000000000001','2020-01-01',null,'Fixture')$$,'22023',null,'Legacy SnapCase overload cannot bypass archive');
select lives_ok($$select public.admin_map_snapcase_machine('cc173005-0000-4000-8000-000000000001','management-current-source','cc173003-0000-4000-8000-000000000003',null,null,null,null,'cc173004-0000-4000-8000-000000000001','2020-01-01',null,'Fixture',null)$$,'Mapping existing archived-company SnapCase preserves assignment');
select is((select reporting_location_id from public.machine_sales_facts where source_row_hash=repeat('a',64)),'cc173002-0000-4000-8000-000000000001'::uuid,'Management preserves recorded venue identity');
select is((select net_sales_cents from public.machine_sales_facts where source_row_hash=repeat('a',64)),1250,'Management preserves recorded money');
select is((select count(*)::int from public.reporting_machine_entitlements where user_id='cc173000-0000-4000-8000-000000000002'),1,'Management never rewrites entitlements');
select is((select count(*)::int from public.reporting_machine_refund_managers where reporting_machine_id='cc173003-0000-4000-8000-000000000003'),1,'Management never rewrites explicit refund managers');
select set_config('request.jwt.claim.sub','cc173000-0000-4000-8000-000000000002',true);
select ok(exists(select 1 from public.get_reporting_dimensions() where account_id='cc173001-0000-4000-8000-000000000001' and account_name='Management renamed'),'Archived company remains in authorized Sales dimensions');
select ok(public.get_refund_analytics_access() @> '{"dimensions":[{"accountId":"cc173001-0000-4000-8000-000000000001","accountName":"Management renamed"}]}'::jsonb,'Archived company remains in authorized Refund dimensions');
select ok(public.get_finance_reporting_access() @> '{"dimensions":[{"accountId":"cc173001-0000-4000-8000-000000000001","accountName":"Management renamed"}]}'::jsonb,'Archived company remains in authorized Finance dimensions');
select lives_ok($$select public.get_company_sales_report('cc173001-0000-4000-8000-000000000001','2026-09-01','2026-09-30')$$,'Archived company history remains readable');
select throws_ok($$select public.admin_manage_reporting_company('cc173001-0000-4000-8000-000000000001','restore',now())$$,'42501','Admin access required','Reporting manager cannot manage company');
select ok(not has_function_privilege('anon','public.admin_manage_reporting_company(uuid,text,timestamptz,text,text)','execute'),'Anonymous cannot manage company');
select ok(not has_function_privilege('service_role','public.admin_manage_reporting_company(uuid,text,timestamptz,text,text)','execute'),'Service jobs cannot replace current management actor');
select ok(not has_function_privilege('authenticated','private.reporting_company_name_guard()','execute'),'Name guard remains inaccessible as RPC');
select ok(not has_function_privilege('authenticated','private.reporting_machine_company_archive_guard()','execute'),'Assignment guard remains inaccessible as RPC');
select ok(not has_function_privilege('anon','private.reporting_company_name_guard()','execute') and not has_function_privilege('service_role','private.reporting_company_name_guard()','execute'),'Name trigger revokes anonymous/service execution');
select ok(not has_function_privilege('anon','private.reporting_machine_company_archive_guard()','execute') and not has_function_privilege('service_role','private.reporting_machine_company_archive_guard()','execute'),'Archive trigger revokes anonymous/service execution');
select ok(not has_function_privilege('authenticated','private.reporting_company_management_timestamp()','execute') and not has_function_privilege('anon','private.reporting_company_management_timestamp()','execute') and not has_function_privilege('service_role','private.reporting_company_management_timestamp()','execute'),'Timestamp trigger cannot be called as RPC');
select is((select count(*)::int from pg_proc p join pg_namespace n on n.oid=p.pronamespace cross join lateral aclexplode(coalesce(p.proacl,acldefault('f',p.proowner))) a where n.nspname='private' and p.proname in('reporting_company_name_guard','reporting_machine_company_archive_guard','reporting_company_management_timestamp') and a.grantee=0 and a.privilege_type='EXECUTE'),0,'All new trigger helpers revoke PUBLIC execute');
select set_config('request.jwt.claim.sub','cc173000-0000-4000-8000-000000000001',true);
select lives_ok($$select public.admin_manage_reporting_company('cc173001-0000-4000-8000-000000000001','restore',(select updated_at from public.customer_accounts where id='cc173001-0000-4000-8000-000000000001'))$$,'Restore permits deliberate management action');
select is((select reporting_archived_at from public.customer_accounts where id='cc173001-0000-4000-8000-000000000001'),null::timestamptz,'Restore clears only reporting archive');
select lives_ok($$select public.admin_upsert_reporting_machine_by_id(null,'cc173001-0000-4000-8000-000000000001','cc173002-0000-4000-8000-000000000001','Restored new machine','commercial',null,'setup','Fixture',null,null)$$,'Restored company accepts new assignments');
select ok(exists(select 1 from public.admin_audit_log where actor_user_id='cc173000-0000-4000-8000-000000000001' and entity_id='cc173001-0000-4000-8000-000000000001' and action='reporting_company.renamed' and before->>'accountName'='Management original' and after->>'accountName'='Management renamed'),'Rename records actor and before/after canonical names');
select is((select count(*)::int from public.admin_audit_log where entity_id='cc173001-0000-4000-8000-000000000001' and action in('reporting_company.archived','reporting_company.restored')),2,'Archive/restore each audit one state change');
select * from finish();
rollback;
