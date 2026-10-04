begin;
create extension if not exists pgtap with schema extensions;
set local search_path=public,extensions;
select no_plan();
-- Disposable synthetic fixtures; transaction always rolls back.
set local session_replication_role=replica;
insert into auth.users(id,email) values
 ('aa174200-0000-4000-8000-000000000001','mapping-admin@example.invalid'),
 ('aa174200-0000-4000-8000-000000000002','mapping-outsider@example.invalid');
insert into public.admin_roles(user_id,role,active) values('aa174200-0000-4000-8000-000000000001','super_admin',true);
insert into public.customer_accounts(id,name) values('aa174201-0000-4000-8000-000000000001','Machine mapping fixture company');
insert into public.reporting_locations(id,account_id,name,timezone) values
 ('aa174202-0000-4000-8000-000000000001','aa174201-0000-4000-8000-000000000001','Shared reporting venue','America/Los_Angeles');
insert into public.reporting_machines(id,account_id,location_id,machine_label,machine_type,nayax_machine_id,nayax_account_key,refund_intake_enabled,nayax_refunds_enabled,nayax_card_sales_started_on,sunze_machine_id) values
 ('aa174203-0000-4000-8000-000000000001','aa174201-0000-4000-8000-000000000001','aa174202-0000-4000-8000-000000000001','Published reader fixture','commercial','17420001','FIXTURE_A',true,false,'2026-09-01','fixture-source-one'),
 ('aa174203-0000-4000-8000-000000000002','aa174201-0000-4000-8000-000000000001','aa174202-0000-4000-8000-000000000001','Shared venue second machine','commercial',null,null,false,false,null,null),
 ('aa174203-0000-4000-8000-000000000003','aa174201-0000-4000-8000-000000000001','aa174202-0000-4000-8000-000000000001','Legacy occupied tuple','commercial','17429999',null,false,false,null,null);
insert into public.refund_nayax_machine_inventory(id,account_key,nayax_machine_id,machine_name,provider_is_active,refund_category,reporting_machine_id,reconciliation_state) values
 ('aa174204-0000-4000-8000-000000000001','FIXTURE_A','17420001','Original published reader',true,'cotton_candy','aa174203-0000-4000-8000-000000000001','published'),
 ('aa174204-0000-4000-8000-000000000002','FIXTURE_B','17420001','Same ID different account',false,null,null,'needs_setup'),
 ('aa174204-0000-4000-8000-000000000003','TGPACI_USA_DB','17429999','Occupied legacy record',true,null,null,'needs_setup');
insert into public.machine_sales_facts(reporting_machine_id,reporting_location_id,sale_date,payment_method,net_sales_cents,transaction_count,source,source_row_hash) values
 ('aa174203-0000-4000-8000-000000000001','aa174202-0000-4000-8000-000000000001','2026-08-01','cash',1000,1,'manual_csv','fixture-mapping-positive'),
 ('aa174203-0000-4000-8000-000000000001','aa174202-0000-4000-8000-000000000001','2026-10-01','cash',0,0,'manual_csv','fixture-mapping-zero');
insert into public.machine_sales_facts(reporting_machine_id,reporting_location_id,sale_date,payment_method,net_sales_cents,transaction_count,source,source_row_hash,source_order_hash,raw_payload) values
 ('aa174203-0000-4000-8000-000000000001','aa174202-0000-4000-8000-000000000001','2026-09-01','credit',1200,2,'card_authority_daily','fixture-historical-card-projection','fixture-historical-card-projection','{"authorityStartedOn":"2026-09-01","providerMachineId":"17420001","accountKey":"FIXTURE_A"}'),
 ('aa174203-0000-4000-8000-000000000001','aa174202-0000-4000-8000-000000000001','2026-09-01','credit',0,0,'nayax_scheduled_report','fixture-historical-nayax-row','fixture-historical-nayax-row','{"providerMachineId":"17420001","accountKey":"FIXTURE_A","_salesAuthorityOriginal":{"netSalesCents":1200,"transactionCount":2,"itemQuantity":2,"taxCents":0}}');
create temporary table original_card_history as select id,to_jsonb(fact) value from public.machine_sales_facts fact
 where source_row_hash in ('fixture-historical-card-projection','fixture-historical-nayax-row');
set local session_replication_role=origin;
select set_config('request.jwt.claim.role','authenticated',true);
select set_config('request.jwt.claim.sub','aa174200-0000-4000-8000-000000000001',true);
select lives_ok($$select public.admin_get_machine_workspace_metadata()$$,'Scoped metadata RPC compiles and executes against all relations');
select ok(public.admin_get_machine_workspace_metadata() @> '[{"machineId":"aa174203-0000-4000-8000-000000000001","lastRecordedTransaction":"2026-09-01","nayaxName":"Original published reader"}]'::jsonb,'Positive transaction recency ignores later zero-sales fact and includes exact imported name');
select lives_ok($$select public.admin_save_machine_workspace_mapping('aa174203-0000-4000-8000-000000000001','Great Mall near food court',null,'17420001','FIXTURE_A',null)$$,'Label-only save preserves mapping');
select is((select name from reporting_locations where id='aa174202-0000-4000-8000-000000000001'),'Shared reporting venue','Free-text placement never renames shared venue');
select is((select venue_label from reporting_machines where id='aa174203-0000-4000-8000-000000000002'),null::text,'Other machine placement remains untouched');
select is((select nayax_machine_id from reporting_machines where id='aa174203-0000-4000-8000-000000000001'),'17420001','Label-only save keeps exact provider ID');
select throws_ok($$select public.admin_save_machine_workspace_mapping('aa174203-0000-4000-8000-000000000002','Wrong', 'aa174204-0000-4000-8000-000000000001',null,null,null)$$,'23505',null,'Occupied exact inventory tuple cannot be reassigned');
select throws_ok($$select public.admin_save_machine_workspace_mapping('aa174203-0000-4000-8000-000000000002','Wrong', 'aa174204-0000-4000-8000-000000000003',null,null,null)$$,'23505',null,'Legacy null account is treated as effective TGPACI_USA_DB when rejecting duplicates');
select throws_ok($$select public.admin_save_machine_workspace_mapping('aa174203-0000-4000-8000-000000000002','Wrong', 'aa174204-0000-4000-8000-000000000099',null,null,null)$$,'22023',null,'Unknown inventory ID rejected atomically');
select is((select venue_label from reporting_machines where id='aa174203-0000-4000-8000-000000000002'),null::text,'Rejected mapping rolls back venue edit');
select throws_ok($$select public.admin_save_machine_workspace_mapping('aa174203-0000-4000-8000-000000000001','Stale',null,'17420001','FIXTURE_A',null)$$,'40001',null,'Stale saved venue cannot overwrite newer label');
select lives_ok($$select public.admin_save_machine_workspace_mapping('aa174203-0000-4000-8000-000000000001','Great Mall near food court','aa174204-0000-4000-8000-000000000002','17420001','FIXTURE_A','Great Mall near food court')$$,'Published reader can be matched to same ID in a different account without manager, customer-label or active-reader refund prerequisites');
select is((select nayax_account_key from reporting_machines where id='aa174203-0000-4000-8000-000000000001'),'FIXTURE_B','Selected inventory resolves exact account automatically');
select is((select nayax_card_sales_started_on from reporting_machines where id='aa174203-0000-4000-8000-000000000001'),'2026-09-01'::date,'Existing historical accounting boundary survives reader matching');
select is((select reconciliation_state from refund_nayax_machine_inventory where id='aa174204-0000-4000-8000-000000000001'),'excluded','Retired reader is kept as excluded inventory rather than deleted');
select is((select reporting_machine_id from refund_nayax_machine_inventory where id='aa174204-0000-4000-8000-000000000002'),'aa174203-0000-4000-8000-000000000001'::uuid,'Exact imported record attributes to existing physical Hub machine');
select is((select reconciliation_state from refund_nayax_machine_inventory where id='aa174204-0000-4000-8000-000000000002'),'needs_setup','Identity matching never publishes new refund eligibility');
select lives_ok($$update public.refund_nayax_machine_inventory set provider_is_active=true,last_successful_sync_at=now(),missing_successful_snapshots=0 where id='aa174204-0000-4000-8000-000000000002'$$,'Ordinary provider inventory refresh remains allowed');
select is((select nayax_card_sales_started_on from reporting_machines where id='aa174203-0000-4000-8000-000000000001'),'2026-09-01'::date,'Original accounting boundary survives later ordinary provider refresh');
select is((select count(*)::int from original_card_history original join public.machine_sales_facts fact on fact.id=original.id where to_jsonb(fact)=original.value),2,'Card-authority projection and original Nayax card evidence remain byte-equivalent after matching and later refresh');
select is((select refund_intake_enabled from reporting_machines where id='aa174203-0000-4000-8000-000000000001'),true,'Existing intake setting preserved');
select is((select nayax_refunds_enabled from reporting_machines where id='aa174203-0000-4000-8000-000000000001'),false,'Matching never activates card refunds');
select is((select reporting_location_id from machine_sales_facts where source_row_hash='fixture-mapping-positive'),'aa174202-0000-4000-8000-000000000001'::uuid,'Historical sale retains original reporting placement');
select is((select net_sales_cents from machine_sales_facts where source_row_hash='fixture-mapping-positive'),1000,'Historical positive sale amount unchanged');
select is((select timezone from reporting_locations where id='aa174202-0000-4000-8000-000000000001'),'America/Los_Angeles','Historical reporting timezone preserved');
insert into public.sunze_machine_discoveries(sunze_machine_id,sunze_machine_name) values('fixture-source-two','Original Sunze name');
select lives_ok($$select public.admin_link_sunze_source_to_machine('aa174203-0000-4000-8000-000000000002','fixture-source-two')$$,'Discovered Sunze source connects to existing provisional Hub record');
select is((select sunze_machine_id from reporting_machines where id='aa174203-0000-4000-8000-000000000002'),'fixture-source-two','Exact Sunze identity saved without creating a duplicate physical machine');
select is((select count(*)::int from reporting_machines where account_id='aa174201-0000-4000-8000-000000000001'),3,'Source linking preserves physical record count');
select throws_ok($$select public.admin_link_sunze_source_to_machine('aa174203-0000-4000-8000-000000000003','fixture-source-two')$$,'23505',null,'Same Sunze source cannot link to two physical records');
select throws_ok($$select public.admin_save_machine_workspace_mapping('aa174203-0000-4000-8000-000000000001','Stale',null,'17420001','FIXTURE_A','Great Mall near food court')$$,'40001',null,'Stale exact account tuple rejected');
-- Genuine withdrawals still clear authority; ordinary pending refresh above must not.
set local session_replication_role=replica;
insert into public.reporting_machines(id,account_id,location_id,machine_label,machine_type,nayax_machine_id,nayax_account_key,nayax_card_sales_started_on)
values('aa174203-0000-4000-8000-000000000004','aa174201-0000-4000-8000-000000000001','aa174202-0000-4000-8000-000000000001','Withdrawal transitions fixture','commercial','17420004','FIXTURE_TRANSITION','2026-09-01');
insert into public.refund_nayax_machine_inventory(id,account_key,nayax_machine_id,machine_name,provider_is_active,refund_category,reporting_machine_id,reconciliation_state)
values('aa174204-0000-4000-8000-000000000004','FIXTURE_TRANSITION','17420004','Withdrawal transitions',true,'cotton_candy','aa174203-0000-4000-8000-000000000004','published');
set local session_replication_role=origin;
reset role;
set local session_replication_role=replica;
update public.reporting_machines set nayax_card_sales_started_on='2026-09-01' where id='aa174203-0000-4000-8000-000000000004';
update public.refund_nayax_machine_inventory set reconciliation_state='published',exclusion_reason=null,reporting_machine_id='aa174203-0000-4000-8000-000000000004',nayax_machine_id='17420004',provider_is_active=true where id='aa174204-0000-4000-8000-000000000004';
set local session_replication_role=origin;
update public.refund_nayax_machine_inventory set reconciliation_state='needs_setup' where id='aa174204-0000-4000-8000-000000000004';
select is((select nayax_card_sales_started_on from public.reporting_machines where id='aa174203-0000-4000-8000-000000000004'),null::date,'Published to pending retains existing authority withdrawal semantics');
set local session_replication_role=replica;
update public.reporting_machines set nayax_card_sales_started_on='2026-09-01' where id='aa174203-0000-4000-8000-000000000004';
update public.refund_nayax_machine_inventory set reconciliation_state='published',exclusion_reason=null,reporting_machine_id='aa174203-0000-4000-8000-000000000004',nayax_machine_id='17420004',provider_is_active=true where id='aa174204-0000-4000-8000-000000000004';
set local session_replication_role=origin;
update public.refund_nayax_machine_inventory set reconciliation_state='excluded',exclusion_reason='Synthetic explicit inventory exclusion' where id='aa174204-0000-4000-8000-000000000004';
select is((select nayax_card_sales_started_on from public.reporting_machines where id='aa174203-0000-4000-8000-000000000004'),null::date,'Published to excluded retains existing authority withdrawal semantics');
set local session_replication_role=replica;
update public.reporting_machines set nayax_card_sales_started_on='2026-09-01' where id='aa174203-0000-4000-8000-000000000004';
update public.refund_nayax_machine_inventory set reconciliation_state='published',exclusion_reason=null,reporting_machine_id='aa174203-0000-4000-8000-000000000004',nayax_machine_id='17420004',provider_is_active=true where id='aa174204-0000-4000-8000-000000000004';
set local session_replication_role=origin;
update public.refund_nayax_machine_inventory set reporting_machine_id=null,reconciliation_state='needs_setup' where id='aa174204-0000-4000-8000-000000000004';
select is((select nayax_card_sales_started_on from public.reporting_machines where id='aa174203-0000-4000-8000-000000000004'),null::date,'Explicit machine unlink retains existing authority withdrawal semantics');
set local session_replication_role=replica;
update public.reporting_machines set nayax_card_sales_started_on='2026-09-01' where id='aa174203-0000-4000-8000-000000000004';
update public.refund_nayax_machine_inventory set reconciliation_state='published',exclusion_reason=null,reporting_machine_id='aa174203-0000-4000-8000-000000000004',nayax_machine_id='17420004',provider_is_active=true where id='aa174204-0000-4000-8000-000000000004';
set local session_replication_role=origin;
update public.refund_nayax_machine_inventory set nayax_machine_id='17420005' where id='aa174204-0000-4000-8000-000000000004';
select is((select nayax_card_sales_started_on from public.reporting_machines where id='aa174203-0000-4000-8000-000000000004'),null::date,'Exact provider identity change retains existing authority withdrawal semantics');
set local session_replication_role=replica;
update public.reporting_machines set nayax_card_sales_started_on='2026-09-01' where id='aa174203-0000-4000-8000-000000000004';
update public.refund_nayax_machine_inventory set reconciliation_state='published',exclusion_reason=null,reporting_machine_id='aa174203-0000-4000-8000-000000000004',nayax_machine_id='17420004',provider_is_active=true where id='aa174204-0000-4000-8000-000000000004';
set local session_replication_role=origin;
update public.refund_nayax_machine_inventory set provider_is_active=false,reconciliation_state='needs_setup' where id='aa174204-0000-4000-8000-000000000004';
select is((select nayax_card_sales_started_on from public.reporting_machines where id='aa174203-0000-4000-8000-000000000004'),null::date,'Published active reader becomes inactive retains existing authority withdrawal semantics');

select set_config('request.jwt.claim.sub','aa174200-0000-4000-8000-000000000002',true);
select throws_ok($$select public.admin_link_sunze_source_to_machine('aa174203-0000-4000-8000-000000000003','fixture-source-two')$$,'42501',null,'Unscoped outsider cannot connect Sunze source');
select throws_ok($$select public.admin_save_machine_workspace_mapping('aa174203-0000-4000-8000-000000000002','Unauthorized',null,null,null,null)$$,'42501',null,'Non-super-admin cannot save workspace identity');
select throws_ok($$select public.admin_get_machine_workspace_metadata()$$,'42501',null,'Unscoped outsider cannot read machine workspace');
insert into public.admin_scoped_access_grants(id,user_id,starts_at,grant_reason) values('aa174205-0000-4000-8000-000000000001','aa174200-0000-4000-8000-000000000002','2020-01-01','Synthetic exact machine scope');
insert into public.admin_scoped_access_scopes(grant_id,scope_type,machine_id,grant_reason) values('aa174205-0000-4000-8000-000000000001','machine','aa174203-0000-4000-8000-000000000002','Synthetic exact machine scope');
select ok(public.admin_get_machine_workspace_metadata() @> '[{"machineId":"aa174203-0000-4000-8000-000000000002"}]'::jsonb,'Scoped admin reads granted machine metadata');
select ok(not (public.admin_get_machine_workspace_metadata() @> '[{"machineId":"aa174203-0000-4000-8000-000000000001"}]'::jsonb),'Scoped metadata cannot disclose another machine source identity');
select throws_ok($$select public.admin_link_sunze_source_to_machine('aa174203-0000-4000-8000-000000000002','fixture-source-two')$$,'42501',null,'Scoped identity read authority does not authorize source mapping write');
select throws_ok($$select public.admin_save_machine_workspace_mapping('aa174203-0000-4000-8000-000000000002','Scoped edit',null,null,null,null)$$,'42501',null,'Scoped identity read authority does not authorize exact matching write');
select set_config('request.jwt.claim.sub','',true);
select throws_ok($$select public.admin_save_machine_workspace_mapping('aa174203-0000-4000-8000-000000000002','Anonymous',null,null,null,null)$$,'42501',null,'Anonymous cannot save');
select ok(not has_function_privilege('anon','public.admin_get_machine_workspace_metadata()','EXECUTE'),'Anonymous RPC execution revoked');
select * from finish();
rollback;
