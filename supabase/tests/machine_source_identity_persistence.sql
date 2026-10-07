begin;
create extension if not exists pgtap with schema extensions;
set local search_path=public,extensions;
set local timezone='UTC';
select no_plan();
set local session_replication_role=replica;
insert into auth.users(id,email) values
 ('aa180800-0000-4000-8000-000000000001','identity-admin@example.invalid'),
 ('aa180800-0000-4000-8000-000000000002','identity-outsider@example.invalid');
insert into public.admin_roles(user_id,role,active) values ('aa180800-0000-4000-8000-000000000001','super_admin',true);
insert into public.customer_accounts(id,name) values ('aa180801-0000-4000-8000-000000000001','Identity company');
insert into public.reporting_locations(id,account_id,name,timezone) values ('aa180802-0000-4000-8000-000000000001','aa180801-0000-4000-8000-000000000001','Retained site','America/Los_Angeles');
insert into public.reporting_machines(id,account_id,location_id,machine_label,machine_type,nayax_machine_id,nayax_account_key) values
 ('aa180803-0000-4000-8000-000000000001','aa180801-0000-4000-8000-000000000001','aa180802-0000-4000-8000-000000000001','Existing cotton','commercial','18080001','IDENTITY_FIXTURE'),
 ('aa180803-0000-4000-8000-000000000002','aa180801-0000-4000-8000-000000000001','aa180802-0000-4000-8000-000000000001','Existing case','snapcase','18080002','IDENTITY_FIXTURE');
insert into public.refund_nayax_machine_inventory(id,account_key,nayax_machine_id,machine_name,provider_is_active,reporting_machine_id,reconciliation_state,refund_category) values
 ('aa180804-0000-4000-8000-000000000001','IDENTITY_FIXTURE','18080001','Existing cotton reader',true,'aa180803-0000-4000-8000-000000000001','published','cotton_candy'),
 ('aa180804-0000-4000-8000-000000000002','IDENTITY_FIXTURE','18080002','Existing case reader',true,'aa180803-0000-4000-8000-000000000002','needs_setup','snapcase');
insert into public.sunze_machine_discoveries(sunze_machine_id,sunze_machine_name,status,last_seen_at) values ('fixture-1808-sunze','Imported cotton','pending',now());
insert into public.sunze_unmapped_sales(sunze_machine_id,source_order_hash,source_row_hash,sale_date,payment_method,net_sales_cents,transaction_count,raw_payload) values
 ('fixture-1808-sunze',repeat('8',64),'identity-pending','2026-10-04','credit',700,1,'{"machine_code":"fixture-1808-sunze","machine_name":"Imported cotton"}');
insert into public.machine_sales_facts(reporting_machine_id,reporting_location_id,sale_date,payment_method,net_sales_cents,transaction_count,source,source_row_hash,item_quantity,tax_cents,raw_payload) values
 ('aa180803-0000-4000-8000-000000000001','aa180802-0000-4000-8000-000000000001','2026-09-01','credit',1100,1,'nayax_scheduled_report','identity-native',1,100,'{"providerMachineId":"18080001"}');
insert into public.reporting_machine_refund_managers(reporting_machine_id,manager_user_id,manager_email,status) values ('aa180803-0000-4000-8000-000000000001','aa180800-0000-4000-8000-000000000001','identity-admin@example.invalid','active');
insert into public.refund_machine_qr_codes(reporting_machine_id,public_code,version) values ('aa180803-0000-4000-8000-000000000001',repeat('8',32),1);
insert into private.snapcase_provider_accounts(id,source_account_key) values ('aa180805-0000-4000-8000-000000000001','identity-account');
insert into private.snapcase_source_machines(provider_account_id,source_machine_id,source_label,source_timezone) values ('aa180805-0000-4000-8000-000000000001','fixture-1808-kex','Imported case','America/Los_Angeles');
set local session_replication_role=origin;
set local role authenticated;
select set_config('request.jwt.claim.role','authenticated',true);
select set_config('request.jwt.claim.sub','aa180800-0000-4000-8000-000000000001',true);
select lives_ok($$select public.admin_reuse_imported_source_machine('Sunze',null,'fixture-1808-sunze','aa180804-0000-4000-8000-000000000001','aa180803-0000-4000-8000-000000000001',(select updated_at from public.reporting_machines where id='aa180803-0000-4000-8000-000000000001'),'America/Los_Angeles','Confirmed same cotton machine')$$,'Same-machine source save completes Sunze identity');
select lives_ok($$select public.admin_reuse_imported_source_machine('Kexiaozhan','aa180805-0000-4000-8000-000000000001','fixture-1808-kex','aa180804-0000-4000-8000-000000000002','aa180803-0000-4000-8000-000000000002',(select updated_at from public.reporting_machines where id='aa180803-0000-4000-8000-000000000002'),'America/Los_Angeles','Confirmed same case machine')$$,'Same-machine source save completes exact Kex account identity');
select lives_ok($$select public.admin_save_named_machine('aa180803-0000-4000-8000-000000000002','aa180801-0000-4000-8000-000000000001','aa180802-0000-4000-8000-000000000001','Renamed case','snapcase',null,'live','Case name-only save','aa180801-0000-4000-8000-000000000001','aa180802-0000-4000-8000-000000000001',null,null,'Existing case')$$,'Ordinary Kex name save preserves its exact provider account/source association');
select ok(public.admin_get_machine_source_inventory()->'sources' @> '[{"platform":"Kexiaozhan","providerAccountId":"aa180805-0000-4000-8000-000000000001","sourceId":"fixture-1808-kex","reportingMachineId":"aa180803-0000-4000-8000-000000000002"}]','Reopened Kex catalogue retains account-qualified source after ordinary save');
select ok(public.admin_get_machine_workspace_metadata() @> '[{"machineId":"aa180803-0000-4000-8000-000000000002","sources":[{"platform":"Kexiaozhan","id":"fixture-1808-kex"}]}]','Kex Manage source summary remains connected after ordinary save');
set constraints all immediate;
set constraints all deferred;
reset role;
create temporary table identity_history_before as select
 (select jsonb_agg(to_jsonb(f) order by id) from public.machine_sales_facts f where reporting_machine_id::text like 'aa180803-%') facts,
 (select jsonb_agg(to_jsonb(p) order by source_order_hash) from public.sunze_unmapped_sales p where sunze_machine_id='fixture-1808-sunze') pending,
 (select jsonb_agg(to_jsonb(i) order by id) from public.refund_nayax_machine_inventory i where id::text like 'aa180804-%') readers,
 (select jsonb_agg(to_jsonb(a) order by id) from private.machine_source_management_associations a where reporting_machine_id::text like 'aa180803-%') associations,
 (select jsonb_agg(to_jsonb(p) order by reporting_machine_id) from private.machine_card_financial_policies p where reporting_machine_id::text like 'aa180803-%') policies,
 (select jsonb_agg(to_jsonb(h) order by id) from private.machine_nayax_reader_associations h where reporting_machine_id::text like 'aa180803-%') history,
 (select jsonb_agg(to_jsonb(l) order by id) from public.reporting_locations l where id::text like 'aa180802-%') sites,
 (select jsonb_agg(to_jsonb(m) order by reporting_machine_id,manager_user_id) from public.reporting_machine_refund_managers m where reporting_machine_id::text like 'aa180803-%') managers,
 (select jsonb_agg(to_jsonb(q) order by id) from public.refund_machine_qr_codes q where reporting_machine_id::text like 'aa180803-%') qr,
 (select jsonb_agg(to_jsonb(s) order by id) from public.partner_report_snapshots s) snapshots;
grant select on identity_history_before to authenticated;
set local role authenticated;
select lives_ok($$select public.admin_save_named_machine('aa180803-0000-4000-8000-000000000001','aa180801-0000-4000-8000-000000000001','aa180802-0000-4000-8000-000000000001','Renamed cotton','commercial',null,'live','Name-only stale source form','aa180801-0000-4000-8000-000000000001','aa180802-0000-4000-8000-000000000001',null,null,'Existing cotton')$$,'Ordinary name save accepts legacy blank source draft without clearing identity');
select is((select sunze_machine_id from public.reporting_machines where id='aa180803-0000-4000-8000-000000000001'),'fixture-1808-sunze','Named save preserves exact canonical Sunze ID');
select ok(public.admin_get_machine_workspace_metadata() @> '[{"machineId":"aa180803-0000-4000-8000-000000000001","sources":[{"platform":"Sunze","id":"fixture-1808-sunze"}]}]','Reopened Manage retains source identity after name-only save');
select ok(public.admin_get_machine_source_inventory()->'sources' @> '[{"sourceId":"fixture-1808-sunze","reportingMachineId":"aa180803-0000-4000-8000-000000000001","salesActivationPending":false}]','Catalogue and Manage remain consistent');
select throws_ok($$do $probe$ begin perform public.admin_upsert_reporting_machine_by_id('aa180803-0000-4000-8000-000000000001','aa180801-0000-4000-8000-000000000001','aa180802-0000-4000-8000-000000000001','Existing cotton','commercial',null,'live','Attempt source clear','aa180801-0000-4000-8000-000000000001','aa180802-0000-4000-8000-000000000001',null,null); set constraints public.completed_source_machine_identity immediate; end; $probe$;$$,'22023',null,'Alternate source writer cannot commit a cleared completed identity');
reset role;
select throws_ok($$do $probe$ begin delete from private.snapcase_machine_mappings where provider_account_id='aa180805-0000-4000-8000-000000000001' and source_machine_id='fixture-1808-kex'; set constraints private.completed_source_kex_identity immediate; end; $probe$;$$,'22023',null,'Deleting last exact Kex mapping cannot orphan completed source');
select is((select count(*)::int from private.snapcase_machine_mappings where provider_account_id='aa180805-0000-4000-8000-000000000001' and source_machine_id='fixture-1808-kex'),1,'Rejected Kex deletion leaves exact mapping');
set constraints all immediate;
set constraints all deferred;
-- Reproduce the already-committed bug only as a historical seed, then restore origin.
set local session_replication_role=replica;
update public.reporting_machines set sunze_machine_id=null where id='aa180803-0000-4000-8000-000000000001';
set local session_replication_role=origin;
create temporary table identity_recovery_before as select to_jsonb(m) machine,m.updated_at,(select count(*) from public.admin_audit_log) audits from public.reporting_machines m where id='aa180803-0000-4000-8000-000000000001';
grant select on identity_recovery_before to authenticated;
select ok(not has_function_privilege('anon','public.admin_restore_completed_sunze_identity(uuid,text,uuid,timestamptz,text)','execute'),'Anonymous cannot invoke recovery');
set local role authenticated;
select set_config('request.jwt.claim.sub','aa180800-0000-4000-8000-000000000002',true);
select throws_ok($$select public.admin_restore_completed_sunze_identity('aa180803-0000-4000-8000-000000000001','fixture-1808-sunze','aa180804-0000-4000-8000-000000000001',(select updated_at from identity_recovery_before),'Unauthorized recovery')$$,'42501',null,'Outsider cannot recover identity');
select set_config('request.jwt.claim.sub','aa180800-0000-4000-8000-000000000001',true);
select throws_ok($$select public.admin_restore_completed_sunze_identity('aa180803-0000-4000-8000-000000000001','different-source','aa180804-0000-4000-8000-000000000001',(select updated_at from identity_recovery_before),'Wrong source')$$,'22023',null,'Recovery cannot guess another source');
select throws_ok($$select public.admin_restore_completed_sunze_identity('aa180803-0000-4000-8000-000000000001','fixture-1808-sunze','aa180804-0000-4000-8000-000000000002',(select updated_at from identity_recovery_before),'Wrong reader')$$,'40001',null,'Recovery requires same exact owned reader');
select throws_ok($$select public.admin_restore_completed_sunze_identity('aa180803-0000-4000-8000-000000000001','fixture-1808-sunze','aa180804-0000-4000-8000-000000000001',(select updated_at-interval '1 second' from identity_recovery_before),'Stale recovery')$$,'40001',null,'Recovery requires reviewed current machine stamp');
reset role;
select throws_ok($$do $probe$ begin set local session_replication_role=replica; delete from public.sunze_machine_discoveries where sunze_machine_id='fixture-1808-sunze'; set local session_replication_role=origin; perform public.admin_restore_completed_sunze_identity('aa180803-0000-4000-8000-000000000001','fixture-1808-sunze','aa180804-0000-4000-8000-000000000001',(select updated_at from identity_recovery_before),'Missing discovery'); end; $probe$;$$,'22023',null,'Recovery requires an actual retained source discovery');
select throws_ok($$do $probe$ begin set local session_replication_role=replica; update public.sunze_machine_discoveries set reporting_machine_id=null where sunze_machine_id='fixture-1808-sunze'; set local session_replication_role=origin; perform public.admin_restore_completed_sunze_identity('aa180803-0000-4000-8000-000000000001','fixture-1808-sunze','aa180804-0000-4000-8000-000000000001',(select updated_at from identity_recovery_before),'Null discovery owner'); end; $probe$;$$,'22023',null,'Conservative recovery requires discovery still pointing to proved same Hub');
create function pg_temp.reject_identity_recovery_audit() returns trigger language plpgsql as $$begin if new.action='reporting_machine.completed_source_restored' then raise exception 'Synthetic late recovery audit failure' using errcode='P0001'; end if; return new; end$$;
create trigger reject_identity_recovery_audit before insert on public.admin_audit_log for each row execute function pg_temp.reject_identity_recovery_audit();
set local role authenticated;
select throws_ok($$select public.admin_restore_completed_sunze_identity('aa180803-0000-4000-8000-000000000001','fixture-1808-sunze','aa180804-0000-4000-8000-000000000001',(select updated_at from identity_recovery_before),'Recovery atomic rollback')$$,'P0001',null,'Late audit failure rolls back source restoration');
reset role;
drop trigger reject_identity_recovery_audit on public.admin_audit_log;
select is((select to_jsonb(m) from public.reporting_machines m where id='aa180803-0000-4000-8000-000000000001'),(select machine from identity_recovery_before),'Failed recovery preserves full machine bytes');
select is((select count(*) from public.admin_audit_log),(select audits from identity_recovery_before),'Failed recovery leaves no partial audits');
set local role authenticated;
select lives_ok($$select public.admin_restore_completed_sunze_identity('aa180803-0000-4000-8000-000000000001','fixture-1808-sunze','aa180804-0000-4000-8000-000000000001',(select updated_at from identity_recovery_before),'Restore exact previously confirmed source without replay')$$,'Guarded recovery restores existing user-confirmed identity');
select ok(public.admin_get_machine_workspace_metadata() @> '[{"machineId":"aa180803-0000-4000-8000-000000000001","sources":[{"platform":"Sunze","id":"fixture-1808-sunze"}]}]','Recovered source is durably visible in Manage');
select throws_ok($$select public.admin_restore_completed_sunze_identity('aa180803-0000-4000-8000-000000000001','fixture-1808-sunze','aa180804-0000-4000-8000-000000000001',(select updated_at from public.reporting_machines where id='aa180803-0000-4000-8000-000000000001'),'Repeat recovery')$$,'22023',null,'Recovery is not a repeat mapping or promotion action');
set constraints all immediate;
reset role;
select is((select to_jsonb(m)-array['sunze_machine_id','updated_at'] from public.reporting_machines m where id='aa180803-0000-4000-8000-000000000001'),(select machine-array['sunze_machine_id','updated_at'] from identity_recovery_before),'Recovery changes only source pointer and update stamp');
select is((select jsonb_agg(to_jsonb(f) order by id) from public.machine_sales_facts f where reporting_machine_id::text like 'aa180803-%'),(select facts from identity_history_before),'All original and promoted financial facts remain byte-identical');
select is((select jsonb_agg(to_jsonb(p) order by source_order_hash) from public.sunze_unmapped_sales p where sunze_machine_id='fixture-1808-sunze'),(select pending from identity_history_before),'Recovery never replays or promotes pending source rows');
select is((select jsonb_agg(to_jsonb(i) order by id) from public.refund_nayax_machine_inventory i where id::text like 'aa180804-%'),(select readers from identity_history_before),'Reader ownership and publication unchanged');
select is((select jsonb_agg(to_jsonb(a) order by id) from private.machine_source_management_associations a where reporting_machine_id::text like 'aa180803-%'),(select associations from identity_history_before),'Exact previously attested associations unchanged');
select is((select jsonb_agg(to_jsonb(p) order by reporting_machine_id) from private.machine_card_financial_policies p where reporting_machine_id::text like 'aa180803-%'),(select policies from identity_history_before),'Financial channel policy unchanged');
select is((select jsonb_agg(to_jsonb(h) order by id) from private.machine_nayax_reader_associations h where reporting_machine_id::text like 'aa180803-%'),(select history from identity_history_before),'Reader historical ownership unchanged');
select is((select jsonb_agg(to_jsonb(l) order by id) from public.reporting_locations l where id::text like 'aa180802-%'),(select sites from identity_history_before),'Company site and timezone unchanged');
select is((select jsonb_agg(to_jsonb(m) order by reporting_machine_id,manager_user_id) from public.reporting_machine_refund_managers m where reporting_machine_id::text like 'aa180803-%'),(select managers from identity_history_before),'Manager permissions unchanged');
select is((select jsonb_agg(to_jsonb(q) order by id) from public.refund_machine_qr_codes q where reporting_machine_id::text like 'aa180803-%'),(select qr from identity_history_before),'Public QR references unchanged');
select is((select jsonb_agg(to_jsonb(s) order by id) from public.partner_report_snapshots s),(select snapshots from identity_history_before),'Issued and draft payout snapshots unchanged');
select * from finish();
rollback;
