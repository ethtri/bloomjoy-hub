begin;
create extension if not exists pgtap with schema extensions;
set local search_path=public,extensions;
select no_plan();
set local session_replication_role=replica;
insert into auth.users(id,email) values
 ('aa177400-0000-4000-8000-000000000001','archive-admin@example.invalid'),
 ('aa177400-0000-4000-8000-000000000002','archive-outsider@example.invalid');
insert into public.admin_roles(user_id,role,active) values ('aa177400-0000-4000-8000-000000000001','super_admin',true);
insert into public.customer_accounts(id,name) values ('aa177401-0000-4000-8000-000000000001','Archive fixture company');
insert into public.reporting_locations(id,account_id,name,timezone) values
 ('aa177402-0000-4000-8000-000000000001','aa177401-0000-4000-8000-000000000001','Archive unique venue','America/Los_Angeles');
insert into public.reporting_machines(id,account_id,location_id,machine_label,machine_type,refund_public_display_label,sunze_machine_id,nayax_machine_id,nayax_account_key,nayax_card_sales_started_on) values
 ('aa177403-0000-4000-8000-000000000001','aa177401-0000-4000-8000-000000000001','aa177402-0000-4000-8000-000000000001','Historical alias','commercial','Preserved customer name','archive-source-one','17740001','ARCHIVE_FIXTURE','2026-09-01');
insert into public.reporting_machine_refund_managers(reporting_machine_id,manager_user_id,manager_email,status) values
 ('aa177403-0000-4000-8000-000000000001','aa177400-0000-4000-8000-000000000001','archive-admin@example.invalid','active');
insert into public.machine_sales_facts(reporting_machine_id,reporting_location_id,sale_date,payment_method,net_sales_cents,transaction_count,source,source_row_hash,raw_payload) values
 ('aa177403-0000-4000-8000-000000000001','aa177402-0000-4000-8000-000000000001','2026-09-01','credit',1200,2,'card_authority_daily','archive-original-card','{"originalReader":"17740001"}');
insert into public.refund_nayax_machine_inventory(id,account_key,nayax_machine_id,machine_name,provider_is_active,reconciliation_state,refund_category,reporting_machine_id) values
 ('aa177404-0000-4000-8000-000000000001','ARCHIVE_FIXTURE','17740001','Original reader',true,'published','cotton_candy','aa177403-0000-4000-8000-000000000001'),
 ('aa177404-0000-4000-8000-000000000002','ARCHIVE_FIXTURE','17740002','Unbound inventory remains',true,'needs_setup','cotton_candy',null);
insert into public.refund_machine_qr_codes(reporting_machine_id,public_code,version) values
 ('aa177403-0000-4000-8000-000000000001',repeat('7',32),1);
create temporary table archive_machine_before as select to_jsonb(m)-'updated_at' value from public.reporting_machines m where id='aa177403-0000-4000-8000-000000000001';
create temporary table archive_fact_before as select to_jsonb(f) value from public.machine_sales_facts f where source_row_hash='archive-original-card';
create temporary table archive_manager_before as select to_jsonb(m) value from public.reporting_machine_refund_managers m where reporting_machine_id='aa177403-0000-4000-8000-000000000001';
create temporary table archive_qr_before as select to_jsonb(q) value from public.refund_machine_qr_codes q where reporting_machine_id='aa177403-0000-4000-8000-000000000001';
set local session_replication_role=origin;
select set_config('request.jwt.claim.role','authenticated',true);
select set_config('request.jwt.claim.sub','aa177400-0000-4000-8000-000000000001',true);
select is((select count(*)::integer from public.public_refund_machine_options() where machine_id='aa177403-0000-4000-8000-000000000001'),1,'Synthetic historical machine is initially selectable');
select lives_ok($$select public.admin_set_machine_management_archive('aa177403-0000-4000-8000-000000000001',true,'Owner reviewed retirement fixture',(select updated_at from public.reporting_machines where id='aa177403-0000-4000-8000-000000000001'))$$,'Authorized retirement succeeds');
select is((select to_jsonb(m)-array['management_archived_at','management_archived_by','management_archive_reason','updated_at'] from public.reporting_machines m where id='aa177403-0000-4000-8000-000000000001'),(select value-array['management_archived_at','management_archived_by','management_archive_reason'] from archive_machine_before),'Archive preserves every original machine field');
select is((select to_jsonb(f) from public.machine_sales_facts f where source_row_hash='archive-original-card'),(select value from archive_fact_before),'Financial history remains byte-equivalent');
select is((select to_jsonb(m) from public.reporting_machine_refund_managers m where reporting_machine_id='aa177403-0000-4000-8000-000000000001'),(select value from archive_manager_before),'Existing manager assignment remains byte-equivalent');
select is((select to_jsonb(q) from public.refund_machine_qr_codes q where reporting_machine_id='aa177403-0000-4000-8000-000000000001'),(select value from archive_qr_before),'Existing QR identity remains byte-equivalent');
select is((select count(*)::integer from public.public_refund_machine_options() where machine_id='aa177403-0000-4000-8000-000000000001'),0,'Archived machine omitted from new public choices');
select ok(not public.service_refund_machine_is_public('aa177403-0000-4000-8000-000000000001'),'Archived machine cannot admit a new QR request');
select ok(not public.admin_get_machine_workspace_metadata() @> '[{"machineId":"aa177403-0000-4000-8000-000000000001"}]'::jsonb,'Archived setup absent from active workspace metadata');
select ok(not public.admin_get_refund_nayax_inventory()->'machines' @> '[{"reportingMachineId":"aa177403-0000-4000-8000-000000000001"}]'::jsonb,'Archived linked Nayax omitted from new management choices');
select ok(public.admin_get_refund_nayax_inventory()->'machines' @> '[{"id":"aa177404-0000-4000-8000-000000000002"}]'::jsonb,'Unbound imported Nayax remains available');
select throws_ok($$delete from public.reporting_machines where id='aa177403-0000-4000-8000-000000000001'$$,'22023',null,'Archived tombstone cannot be deleted');
select throws_ok($$update public.reporting_machines set management_archived_at=null where id='aa177403-0000-4000-8000-000000000001'$$,'42501',null,'Ordinary marker removal is denied');
select throws_ok($$insert into public.reporting_machines(id,account_id,location_id,machine_label,machine_type,management_archived_at,management_archive_reason) values ('aa177403-0000-4000-8000-000000000002','aa177401-0000-4000-8000-000000000001','aa177402-0000-4000-8000-000000000001','Forbidden insert','commercial',now(),'Not authorized')$$,'42501',null,'Archive marker cannot be supplied on direct insert');
select throws_ok($$select public.admin_set_machine_display_name('aa177403-0000-4000-8000-000000000001','Changed archived name','Preserved customer name')$$,'22023',null,'Ordinary identity editing cannot resurrect archive');
select throws_ok($$select public.admin_reconcile_refund_nayax_machine('aa177404-0000-4000-8000-000000000001','published','cotton_candy','aa177403-0000-4000-8000-000000000001',null,'Attempt archived republish')$$,'22023',null,'Direct inventory reconciliation cannot republish an archived target');
select throws_ok($$select public.admin_set_reporting_machine_refund_managers('aa177403-0000-4000-8000-000000000001',array['archive-outsider@example.invalid'],'Attempt new manager assignment')$$,'22023',null,'Archived machine refuses new manager assignment');
select throws_ok($$select private.upsert_reporting_machine_identity('aa177403-0000-4000-8000-000000000001','aa177401-0000-4000-8000-000000000001','aa177402-0000-4000-8000-000000000001','Imported resurrection','commercial','archive-source-one','setup',false)$$,'22023',null,'Repeat identity import cannot resurrect archived configuration');
select lives_ok($$select public.service_sync_refund_nayax_inventory('archive-repeat-sync','ARCHIVE_FIXTURE','[{"machineId":"17740001","machineName":"Fresh provider name","active":true},{"machineId":"17740002","machineName":"Unbound inventory remains","active":true}]',true,null)$$,'Repeat provider observation is retained without resurrection');
select is((select nayax_card_sales_started_on from public.reporting_machines where id='aa177403-0000-4000-8000-000000000001'),'2026-09-01'::date,'Provider refresh preserves archived authority boundary');
select is((select to_jsonb(f) from public.machine_sales_facts f where source_row_hash='archive-original-card'),(select value from archive_fact_before),'Provider refresh preserves immutable original card facts');
select set_config('request.jwt.claim.sub','aa177400-0000-4000-8000-000000000002',true);
select throws_ok($$select public.admin_set_machine_management_archive('aa177403-0000-4000-8000-000000000001',false,'Unauthorized restore',(select updated_at from public.reporting_machines where id='aa177403-0000-4000-8000-000000000001'))$$,'42501',null,'Unscoped user cannot restore');
select set_config('request.jwt.claim.sub','aa177400-0000-4000-8000-000000000001',true);
select throws_ok($$select public.admin_set_machine_management_archive('aa177403-0000-4000-8000-000000000001',false,'Stale restore','2000-01-01'::timestamptz)$$,'40001',null,'Stale restore fails optimistic guard');
select is((select count(*)::integer from public.admin_audit_log where entity_id='aa177403-0000-4000-8000-000000000001' and action like 'reporting_machine.management_%'),1,'Rejected restore and writes produce no success audit');
select lives_ok($$select public.admin_set_machine_management_archive('aa177403-0000-4000-8000-000000000001',false,'Explicit owner-reviewed restore',(select updated_at from public.reporting_machines where id='aa177403-0000-4000-8000-000000000001'))$$,'Restricted explicit restore succeeds');
select ok((select management_archived_at is null and management_archived_by is null and management_archive_reason is null from public.reporting_machines where id='aa177403-0000-4000-8000-000000000001'),'Restore clears only retirement marker');
select is((select count(*)::integer from public.admin_audit_log where entity_id='aa177403-0000-4000-8000-000000000001' and action like 'reporting_machine.management_%'),2,'Archive and restore have distinct attributable audit entries');
select ok(not has_function_privilege('anon','public.admin_set_machine_management_archive(uuid,boolean,text,timestamptz)','EXECUTE'),'Anonymous archive action revoked');
select is(private.apply_reviewed_machine_retirements(),0,'Exact retirement batch safely skips absent IDs in fresh databases');
select ok(not has_function_privilege('authenticated','private.apply_reviewed_machine_retirements()','EXECUTE'),'Exact deployment retirement batch is not a browser action');
insert into public.reporting_machines(id,account_id,location_id,machine_label,machine_type,sunze_machine_id) values
 ('19f40178-711c-499d-bf51-c68374959f25','aa177401-0000-4000-8000-000000000001','aa177402-0000-4000-8000-000000000001','Reviewed empty placeholder','commercial','newly-connected-source');
select throws_ok($$select private.apply_reviewed_machine_retirements()$$,'P0001',null,'Exact batch refuses a newly source-connected reviewed placeholder');
select ok((select management_archived_at is null from public.reporting_machines where id='19f40178-711c-499d-bf51-c68374959f25'),'Changed source guard commits no marker');
update public.reporting_machines set sunze_machine_id=null where id='19f40178-711c-499d-bf51-c68374959f25';
set local session_replication_role=replica;
insert into private.snapcase_provider_accounts(id,source_account_key) values ('aa177409-0000-4000-8000-000000000001','archive-historical-source-fixture');
insert into private.snapcase_source_machines(provider_account_id,source_machine_id,source_label) values ('aa177409-0000-4000-8000-000000000001','expired-source-link','Exact historical source');
insert into private.snapcase_machine_mappings(provider_account_id,source_machine_id,reporting_machine_id,effective_start_date,effective_end_date,mapping_reason) values ('aa177409-0000-4000-8000-000000000001','expired-source-link','19f40178-711c-499d-bf51-c68374959f25','2020-01-01','2020-01-02','Synthetic expired exact mapping');
set local session_replication_role=origin;
select throws_ok($$select private.apply_reviewed_machine_retirements()$$,'P0001',null,'Exact batch refuses newly discovered historical source alignment');
select ok((select management_archived_at is null from public.reporting_machines where id='19f40178-711c-499d-bf51-c68374959f25'),'Historical source refusal preserves original record');
set local session_replication_role=replica;
delete from private.snapcase_machine_mappings where provider_account_id='aa177409-0000-4000-8000-000000000001';
set local session_replication_role=origin;

insert into public.reporting_machine_refund_managers(reporting_machine_id,manager_user_id,manager_email,status) values
 ('19f40178-711c-499d-bf51-c68374959f25','aa177400-0000-4000-8000-000000000001','archive-admin@example.invalid','active');
select throws_ok($$select private.apply_reviewed_machine_retirements()$$,'P0001',null,'Exact batch refuses new referenced history on a previously empty placeholder');
select is((select count(*)::integer from public.reporting_machine_refund_managers where reporting_machine_id='19f40178-711c-499d-bf51-c68374959f25'),1,'Rejected batch preserves the new reference');
delete from public.reporting_machine_refund_managers where reporting_machine_id='19f40178-711c-499d-bf51-c68374959f25';
select is(private.apply_reviewed_machine_retirements(),1,'Unchanged reviewed empty placeholder is retired exactly once');
select is(private.apply_reviewed_machine_retirements(),0,'Reviewed deployment retirement is idempotent');
select is((select count(*)::integer from public.reporting_machines where management_archived_at is not null),1,'Batch does not archive unrelated or restored historical machines');
select * from finish();
rollback;
