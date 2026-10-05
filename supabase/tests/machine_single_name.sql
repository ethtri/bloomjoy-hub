begin;
create extension if not exists pgtap with schema extensions;
set local search_path=public,extensions;
select no_plan();
-- Disposable synthetic data; no production writes or business-name backfill.
set local session_replication_role=replica;
insert into auth.users(id,email) values
 ('aa174600-0000-4000-8000-000000000001','name-admin@example.invalid'),
 ('aa174600-0000-4000-8000-000000000002','name-outsider@example.invalid');
insert into public.admin_roles(user_id,role,active) values
 ('aa174600-0000-4000-8000-000000000001','super_admin',true);
insert into public.customer_accounts(id,name) values
 ('aa174601-0000-4000-8000-000000000001','Single name fixture company');
insert into public.reporting_locations(id,account_id,name,timezone) values
 ('aa174602-0000-4000-8000-000000000001','aa174601-0000-4000-8000-000000000001','Shared mall','America/Los_Angeles'),
 ('aa174602-0000-4000-8000-000000000003','aa174601-0000-4000-8000-000000000001','Unique public mall','America/Los_Angeles');
insert into public.reporting_machines(id,account_id,location_id,machine_label,machine_type,refund_public_display_label,sunze_machine_id,nayax_machine_id,nayax_account_key,nayax_card_sales_started_on) values
 ('aa174603-0000-4000-8000-000000000001','aa174601-0000-4000-8000-000000000001','aa174602-0000-4000-8000-000000000001','Opaque legacy alias','commercial','Preserved customer wording','source-fixture-one','17460001','FIXTURE_NAME','2026-09-01'),
 ('aa174603-0000-4000-8000-000000000002','aa174601-0000-4000-8000-000000000001','aa174602-0000-4000-8000-000000000001','Legacy name without override','commercial',null,null,'17460002','FIXTURE_NAME',null),
 ('aa174603-0000-4000-8000-000000000003','aa174601-0000-4000-8000-000000000001','aa174602-0000-4000-8000-000000000003','Internal public fixture alias','commercial','Original public machine identity',null,null,null,null);
insert into public.refund_machine_qr_codes(reporting_machine_id,public_code,version) values
 ('aa174603-0000-4000-8000-000000000003',repeat('a',32),1);
create temporary table name_qr_before as select to_jsonb(qr) value from public.refund_machine_qr_codes qr where reporting_machine_id='aa174603-0000-4000-8000-000000000003';
insert into public.reporting_machine_refund_managers(reporting_machine_id,manager_user_id,manager_email,status) values
 ('aa174603-0000-4000-8000-000000000002','aa174600-0000-4000-8000-000000000001','name-admin@example.invalid','active');
insert into public.machine_sales_facts(reporting_machine_id,reporting_location_id,sale_date,payment_method,net_sales_cents,transaction_count,source,source_row_hash,raw_payload) values
 ('aa174603-0000-4000-8000-000000000001','aa174602-0000-4000-8000-000000000001','2026-09-01','credit',1200,2,'card_authority_daily','name-history-card','{"originalProvider":"17460001","originalName":"Opaque legacy alias"}');
create temporary table original_name_history as select to_jsonb(f) value from public.machine_sales_facts f where source_row_hash='name-history-card';
insert into public.reporting_locations(id,account_id,name,timezone) values
 ('aa174602-0000-4000-8000-000000000004','aa174601-0000-4000-8000-000000000001','Unmapped fixture four','America/Los_Angeles'),
 ('aa174602-0000-4000-8000-000000000005','aa174601-0000-4000-8000-000000000001','Unknown fixture five','America/Los_Angeles'),
 ('aa174602-0000-4000-8000-000000000006','aa174601-0000-4000-8000-000000000001','Unmapped fixture six','America/Los_Angeles'),
 ('aa174602-0000-4000-8000-000000000007','aa174601-0000-4000-8000-000000000001','Unknown fixture seven','America/Los_Angeles');
insert into public.reporting_machines(id,account_id,location_id,machine_label,machine_type,refund_public_display_label) values
 ('aa174603-0000-4000-8000-000000000004','aa174601-0000-4000-8000-000000000001','aa174602-0000-4000-8000-000000000004','Placeholder alias four','commercial','Unique placeholder four'),
 ('aa174603-0000-4000-8000-000000000005','aa174601-0000-4000-8000-000000000001','aa174602-0000-4000-8000-000000000005','Placeholder alias five','commercial','Unique placeholder five'),
 ('aa174603-0000-4000-8000-000000000006','aa174601-0000-4000-8000-000000000001','aa174602-0000-4000-8000-000000000006','Placeholder alias six','commercial','Duplicate placeholder'),
 ('aa174603-0000-4000-8000-000000000007','aa174601-0000-4000-8000-000000000001','aa174602-0000-4000-8000-000000000007','Placeholder alias seven','commercial','Duplicate placeholder');
set local session_replication_role=origin;
select set_config('request.jwt.claim.role','authenticated',true);
select set_config('request.jwt.claim.sub','aa174600-0000-4000-8000-000000000001',true);
-- Placeholder overrides participate in legacy duplicate suppression; edits may change wording only.
insert into public.refund_machine_qr_codes(reporting_machine_id,public_code,version) values
 ('aa174603-0000-4000-8000-000000000004',repeat('b',32),1);
create temporary table placeholder_qr_before as select to_jsonb(qr) value from public.refund_machine_qr_codes qr where reporting_machine_id='aa174603-0000-4000-8000-000000000004';
create temporary table placeholder_membership_before as select selection_key,selection_kind,location_timezone,machine_id from public.public_refund_selections_v2();
select is((select count(*)::int from public.public_refund_selections_v2() where machine_id in ('aa174603-0000-4000-8000-000000000004','aa174603-0000-4000-8000-000000000005')),2,'Unique placeholder machines both begin visible');
select lives_ok($$select public.admin_set_machine_display_name('aa174603-0000-4000-8000-000000000004','Renamed placeholder four','Unique placeholder four')$$,'Nonconflicting placeholder rename succeeds');
select is((select display_label from public.public_refund_selections_v2() where machine_id='aa174603-0000-4000-8000-000000000004'),'Renamed placeholder four','Placeholder rename changes public wording');
select ok(not exists((select selection_key,selection_kind,location_timezone,machine_id from public.public_refund_selections_v2() except select * from placeholder_membership_before) union all (select * from placeholder_membership_before except select selection_key,selection_kind,location_timezone,machine_id from public.public_refund_selections_v2())),'Unique placeholder rename preserves every public selection identity');
create temporary table placeholder_rows_before as select id,to_jsonb(m) value from public.reporting_machines m where id in ('aa174603-0000-4000-8000-000000000004','aa174603-0000-4000-8000-000000000005','aa174603-0000-4000-8000-000000000006','aa174603-0000-4000-8000-000000000007');
create temporary table placeholder_audit_before as select count(*)::int value from public.admin_audit_log;
select throws_ok($$select public.admin_save_named_machine('aa174603-0000-4000-8000-000000000004','aa174601-0000-4000-8000-000000000001','aa174602-0000-4000-8000-000000000004','Unique placeholder five','commercial',null,'setup','Collision test','aa174601-0000-4000-8000-000000000001','aa174602-0000-4000-8000-000000000004',null,null,'Renamed placeholder four')$$,'22023','This name changes customer machine choices. Choose a distinct name or review the existing duplicate names.','Placeholder collision rejects whole setup save');
select is((select count(*)::int from public.public_refund_selections_v2() where machine_id in ('aa174603-0000-4000-8000-000000000004','aa174603-0000-4000-8000-000000000005')),2,'Rejected collision leaves both choices visible');
select is((select count(*)::int from public.public_refund_selections_v2() where machine_id in ('aa174603-0000-4000-8000-000000000006','aa174603-0000-4000-8000-000000000007')),0,'Legacy duplicate placeholder choices begin hidden');
select throws_ok($$select public.admin_set_machine_display_name('aa174603-0000-4000-8000-000000000006','Now unique placeholder six','Duplicate placeholder')$$,'22023',null,'Name edit cannot activate previously suppressed choices');
select ok(not exists(select 1 from placeholder_rows_before original join public.reporting_machines m using(id) where to_jsonb(m) is distinct from original.value),'Rejected placeholder edits roll back all names, state, timestamps and eligibility');
select is((select count(*)::int from public.admin_audit_log),(select value from placeholder_audit_before),'Rejected placeholder edits create no audit mutation');
select ok((select to_jsonb(qr) from public.refund_machine_qr_codes qr where reporting_machine_id='aa174603-0000-4000-8000-000000000004')=(select value from placeholder_qr_before),'Placeholder rename and rejected collisions preserve QR UUID, code, version and status');
select ok(not exists((select selection_key,selection_kind,location_timezone,machine_id from public.public_refund_selections_v2() except select * from placeholder_membership_before) union all (select * from placeholder_membership_before except select selection_key,selection_kind,location_timezone,machine_id from public.public_refund_selections_v2())),'Rejected placeholder edits preserve keys, physical membership and grouping');
create temporary table name_public_selection_before as select * from public.public_refund_selections()
 where selection_key=public.refund_public_selection_key('machine|aa174603-0000-4000-8000-000000000003');
select is((select display_label from name_public_selection_before),'Original public machine identity','Customer selection uses the preserved effective Machine name');
select is((select machine_label from public.public_refund_machine_options() where machine_id='aa174603-0000-4000-8000-000000000003'),'Original public machine identity','Before explicit edit, public machine identity preserves legacy wording');
select is((select machine_display_name from public.reporting_machines where id='aa174603-0000-4000-8000-000000000001'),null::text,'Migration does not backfill canonical names');
select ok(public.admin_get_partnership_reporting_setup() @> '{"machines":[{"id":"aa174603-0000-4000-8000-000000000001","machine_label":"Preserved customer wording","stored_machine_label":"Opaque legacy alias"}]}','Admin projection preserves customer wording and raw alias');
select ok(public.admin_get_partnership_reporting_setup() @> '{"machines":[{"id":"aa174603-0000-4000-8000-000000000002","machine_label":"Legacy name without override"}]}','Missing legacy override falls back to machine name');
select lives_ok($$select public.admin_save_named_machine('aa174603-0000-4000-8000-000000000001','aa174601-0000-4000-8000-000000000001','aa174602-0000-4000-8000-000000000001','Preserved customer wording','commercial','source-fixture-one','live','Unrelated type/company save','aa174601-0000-4000-8000-000000000001','aa174602-0000-4000-8000-000000000001',null,null,'Preserved customer wording')$$,'Unchanged effective name saves without conversion');
select is((select machine_label from public.reporting_machines where id='aa174603-0000-4000-8000-000000000001'),'Opaque legacy alias','Unrelated save preserves differing raw legacy alias');
select is((select machine_display_name from public.reporting_machines where id='aa174603-0000-4000-8000-000000000001'),null::text,'Unrelated save does not create explicit canonical name');
create temporary table name_audit_before as select count(*)::int value from public.admin_audit_log where entity_id='aa174603-0000-4000-8000-000000000001';
select throws_ok($$select public.admin_save_named_machine('aa174603-0000-4000-8000-000000000001','aa174601-0000-4000-8000-000000000001','aa174602-0000-4000-8000-000000000001','Great Mall - Cotton Candy','commercial','source-fixture-one','setup','Stale name fixture','aa174601-0000-4000-8000-000000000001','aa174602-0000-4000-8000-000000000001',null,null,'Wrong old name')$$,'40001',null,'Stale name rejects whole setup save');
select is((select operational_phase from public.reporting_machines where id='aa174603-0000-4000-8000-000000000001'),'live','Stale name does not change operating phase');
select throws_ok($$select public.admin_save_named_machine('aa174603-0000-4000-8000-000000000001','aa174601-0000-4000-8000-000000000001','aa174602-0000-4000-8000-000000000001','Great Mall - Cotton Candy','commercial','source-fixture-one','live','Stale company fixture','aa174601-0000-4000-8000-000000000099','aa174602-0000-4000-8000-000000000001',null,null,'Preserved customer wording')$$,'40001',null,'Stale company rejects name edit atomically');
select is((select refund_public_display_label from public.reporting_machines where id='aa174603-0000-4000-8000-000000000001'),'Preserved customer wording','Company failure preserves public wording');
select is((select count(*)::int from public.admin_audit_log where entity_id='aa174603-0000-4000-8000-000000000001'),(select value from name_audit_before),'Stale name/company rejection creates no audit mutation');
select lives_ok($$select public.admin_save_named_machine('aa174603-0000-4000-8000-000000000001','aa174601-0000-4000-8000-000000000001','aa174602-0000-4000-8000-000000000001','Great Mall - Cotton Candy','commercial','source-fixture-one','live','Explicit name fixture','aa174601-0000-4000-8000-000000000001','aa174602-0000-4000-8000-000000000001',null,null,'Preserved customer wording')$$,'Explicit name edit succeeds with atomic projection');
select is((select machine_display_name from public.reporting_machines where id='aa174603-0000-4000-8000-000000000001'),'Great Mall - Cotton Candy','Canonical name saved');
select is((select refund_public_display_label from public.reporting_machines where id='aa174603-0000-4000-8000-000000000001'),'Great Mall - Cotton Candy','Public name projection agrees');
select is((select machine_label from public.reporting_machines where id='aa174603-0000-4000-8000-000000000001'),'Great Mall - Cotton Candy','Internal name projection agrees');
select lives_ok($$select public.admin_set_machine_display_name('aa174603-0000-4000-8000-000000000001','Great Mall - Cotton Candy','Great Mall - Cotton Candy')$$,'Repeated same-name save allowed');
select lives_ok($$update public.reporting_machines set operational_phase='setup' where id='aa174603-0000-4000-8000-000000000001'$$,'Unrelated legacy write with unchanged name succeeds');
select throws_ok($$update public.reporting_machines set machine_label='Stale alias',operational_phase='live' where id='aa174603-0000-4000-8000-000000000001'$$,'40001',null,'Conflicting legacy alias write explicitly rejected');
select is((select operational_phase from public.reporting_machines where id='aa174603-0000-4000-8000-000000000001'),'setup','Rejected legacy write rolls back unrelated phase');
select throws_ok($$update public.reporting_machines set refund_public_display_label='Stale public draft' where id='aa174603-0000-4000-8000-000000000001'$$,'40001',null,'Conflicting old public-label writer rejected');
select lives_ok($$select public.admin_save_machine_refund_settings('aa174603-0000-4000-8000-000000000001',false,'Refund settings fixture')$$,'Refund-only save resolves current name without stale draft');
select is((select refund_public_display_label from public.reporting_machines where id='aa174603-0000-4000-8000-000000000001'),'Great Mall - Cotton Candy','Refund save preserves explicit name');
select is((select nayax_machine_id||':'||nayax_account_key from public.reporting_machines where id='aa174603-0000-4000-8000-000000000001'),'17460001:FIXTURE_NAME','Refund save preserves exact provider tuple');
select lives_ok($$select public.admin_save_machine_refund_settings('aa174603-0000-4000-8000-000000000002',true,'Legacy no override fixture')$$,'Legacy record can save valid refund setup without redundant name edit');
select is((select refund_public_display_label from public.reporting_machines where id='aa174603-0000-4000-8000-000000000002'),'Legacy name without override','Missing override materializes same effective wording');
select is((select machine_display_name from public.reporting_machines where id='aa174603-0000-4000-8000-000000000002'),null::text,'Refund save does not create a separate canonical-name edit');
select is((select name from public.reporting_locations where id='aa174602-0000-4000-8000-000000000001'),'Shared mall','Shared venue unchanged');
select is((select timezone from public.reporting_locations where id='aa174602-0000-4000-8000-000000000001'),'America/Los_Angeles','Shared timezone unchanged');
select is((select sunze_machine_id from public.reporting_machines where id='aa174603-0000-4000-8000-000000000001'),'source-fixture-one','Imported source identity unchanged');
select is((select nayax_card_sales_started_on from public.reporting_machines where id='aa174603-0000-4000-8000-000000000001'),'2026-09-01'::date,'Authority boundary unchanged');
select ok((select to_jsonb(f) from public.machine_sales_facts f where source_row_hash='name-history-card')=(select value from original_name_history),'Historical card fact remains byte-equivalent');
select lives_ok($$select public.admin_set_machine_display_name('aa174603-0000-4000-8000-000000000003','Other Mall - Cotton Candy','Original public machine identity')$$,'Public fixture explicit name edit succeeds');
select is((select machine_label from public.public_refund_machine_options() where machine_id='aa174603-0000-4000-8000-000000000003'),'Other Mall - Cotton Candy','Public machine identity uses explicit canonical name');
select is((select display_label from public.public_refund_selections() where selection_key=(select selection_key from name_public_selection_before)),'Other Mall - Cotton Candy','Customer selection uses explicit canonical name');
select ok(exists(select 1 from public.public_refund_selections() current_selection join name_public_selection_before original using(selection_key,selection_kind,location_timezone)),'Customer selection key, kind and timezone remain stable');
select ok(exists(select 1 from public.public_refund_selections_v2() where selection_key=(select selection_key from name_public_selection_before) and machine_id='aa174603-0000-4000-8000-000000000003'),'Enriched customer selection retains exact Hub machine UUID');
select ok((select to_jsonb(qr) from public.refund_machine_qr_codes qr where reporting_machine_id='aa174603-0000-4000-8000-000000000003')=(select value from name_qr_before),'Existing QR UUID, public code, version and status remain byte-equivalent');
select throws_ok($$select public.admin_set_machine_display_name('aa174603-0000-4000-8000-000000000001','','Great Mall - Cotton Candy')$$,'22023',null,'Empty name rejected');
select throws_ok($$select public.admin_set_machine_display_name('aa174603-0000-4000-8000-000000000001',repeat('x',121),'Great Mall - Cotton Candy')$$,'22023',null,'Overlong name rejected');
select set_config('request.jwt.claim.sub','aa174600-0000-4000-8000-000000000002',true);
select throws_ok($$select public.admin_set_machine_display_name('aa174603-0000-4000-8000-000000000001','Forbidden','Great Mall - Cotton Candy')$$,'42501',null,'Unscoped actor cannot edit name');
select throws_ok($$select public.admin_save_machine_refund_settings('aa174603-0000-4000-8000-000000000001',false,'Forbidden refund setting')$$,'42501',null,'Unscoped actor cannot edit refund setup');
select throws_ok($$select public.admin_save_named_machine('aa174603-0000-4000-8000-000000000001','aa174601-0000-4000-8000-000000000001','aa174602-0000-4000-8000-000000000001','Forbidden','commercial','source-fixture-one','live','Forbidden named save','aa174601-0000-4000-8000-000000000001','aa174602-0000-4000-8000-000000000001',null,null,'Great Mall - Cotton Candy')$$,'42501',null,'Unscoped actor cannot save named setup');
insert into public.admin_scoped_access_grants(id,user_id,starts_at,grant_reason) values
 ('aa174605-0000-4000-8000-000000000001','aa174600-0000-4000-8000-000000000002','2020-01-01','Synthetic single machine scope');
insert into public.admin_scoped_access_scopes(grant_id,scope_type,machine_id,grant_reason) values
 ('aa174605-0000-4000-8000-000000000001','machine','aa174603-0000-4000-8000-000000000002','Synthetic exact scope');
select throws_ok($$select public.admin_save_machine_refund_settings('aa174603-0000-4000-8000-000000000001',false,'Out of scope refund setting')$$,'42501',null,'Scoped admin cannot save another machine settings');
select is(has_function_privilege('anon','public.admin_set_machine_display_name(uuid,text,text)','EXECUTE'),false,'Anonymous name setter forbidden');
select is(has_function_privilege('anon','public.admin_save_machine_refund_settings(uuid,boolean,text)','EXECUTE'),false,'Anonymous refund setter forbidden');
select is(has_function_privilege('anon','public.admin_save_named_machine(uuid,uuid,uuid,text,text,text,text,text,uuid,uuid,text,text,text)','EXECUTE'),false,'Anonymous named setup forbidden');
select * from finish();
rollback;
