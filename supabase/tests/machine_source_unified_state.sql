begin;
create extension if not exists pgtap with schema extensions;
set local search_path=public,extensions;
set local timezone='UTC';
select no_plan();
-- Synthetic seeds only; every operation below uses origin triggers and real roles.
set local session_replication_role=replica;
insert into auth.users(id,email) values
 ('aa181300-0000-4000-8000-000000000001','unified_state-admin@example.invalid'),
 ('aa181300-0000-4000-8000-000000000002','unified_state-scoped@example.invalid'),
 ('aa181300-0000-4000-8000-000000000003','unified_state-outsider@example.invalid');
insert into admin_roles(user_id,role,active) values('aa181300-0000-4000-8000-000000000001','super_admin',true);
insert into customer_accounts(id,name) values('aa181301-0000-4000-8000-000000000001','Catalogue current company');
insert into reporting_locations(id,account_id,name,timezone) values('aa181302-0000-4000-8000-000000000001','aa181301-0000-4000-8000-000000000001','Retained unified_state site','America/Los_Angeles');
insert into reporting_machines(id,account_id,location_id,machine_label,machine_type,sunze_machine_id,nayax_machine_id,nayax_account_key,nayax_card_sales_started_on) values
 ('aa181303-0000-4000-8000-000000000001','aa181301-0000-4000-8000-000000000001','aa181302-0000-4000-8000-000000000001','Retained live cotton','commercial','unified_state-bound','18110001','CATALOGUE_FIXTURE','2026-09-01'),
 ('aa181303-0000-4000-8000-000000000002','aa181301-0000-4000-8000-000000000001','aa181302-0000-4000-8000-000000000001','Retained setup case','snapcase',null,null,null,null),
 ('aa181303-0000-4000-8000-000000000003','aa181301-0000-4000-8000-000000000001','aa181302-0000-4000-8000-000000000001','Retired history','commercial','unified_state-archived',null,null,null);
update reporting_machines set management_archived_at=now(),management_archived_by='aa181300-0000-4000-8000-000000000001',management_archive_reason='Synthetic permanent management retirement' where id='aa181303-0000-4000-8000-000000000003';
update reporting_machines set operational_phase='setup' where id='aa181303-0000-4000-8000-000000000002';
insert into sunze_machine_discoveries(sunze_machine_id,sunze_machine_name,status,reporting_machine_id,last_seen_at) values
 ('unified_state-bound','Original cotton name','mapped','aa181303-0000-4000-8000-000000000001',now()),
 ('unified_state-unbound','Unnamed unconfigured cotton','pending',null,now()),
 ('unified_state-archived','Retired source name','mapped','aa181303-0000-4000-8000-000000000003',now());
insert into private.snapcase_provider_accounts(id,source_account_key) values
 ('aa181305-0000-4000-8000-000000000001','unified_state-account-a'),('aa181305-0000-4000-8000-000000000002','unified_state-account-b');
insert into private.snapcase_source_machines(provider_account_id,source_machine_id,source_label,source_timezone) values
 ('aa181305-0000-4000-8000-000000000001','unified_state-kex-bound','Original case name','America/Los_Angeles'),
 ('aa181305-0000-4000-8000-000000000001','same-unbound-id',null,null),
 ('aa181305-0000-4000-8000-000000000002','same-unbound-id','Other account cabinet',null);
insert into private.snapcase_machine_mappings(provider_account_id,source_machine_id,reporting_machine_id,effective_start_date,mapping_reason) values('aa181305-0000-4000-8000-000000000001','unified_state-kex-bound','aa181303-0000-4000-8000-000000000002','2020-01-01','Synthetic exact account mapping');
insert into admin_scoped_access_grants(id,user_id,starts_at,grant_reason,granted_by) values('aa181306-0000-4000-8000-000000000001','aa181300-0000-4000-8000-000000000002','2020-01-01','Synthetic unified_state scope','aa181300-0000-4000-8000-000000000001');
insert into admin_scoped_access_scopes(grant_id,scope_type,machine_id,grant_reason,granted_by)
select 'aa181306-0000-4000-8000-000000000001','machine',id,'Synthetic exact mapped scope','aa181300-0000-4000-8000-000000000001' from reporting_machines where id in('aa181303-0000-4000-8000-000000000001','aa181303-0000-4000-8000-000000000002');
insert into refund_nayax_machine_inventory(id,account_key,nayax_machine_id,machine_name,provider_is_active,reporting_machine_id,reconciliation_state,refund_category) values('aa181304-0000-4000-8000-000000000001','CATALOGUE_FIXTURE','18110001','Retained card reader',true,'aa181303-0000-4000-8000-000000000001','published','cotton_candy');
insert into machine_sales_facts(id,reporting_machine_id,reporting_location_id,sale_date,payment_method,net_sales_cents,transaction_count,item_quantity,source,source_row_hash,tax_cents,raw_payload) values('aa181307-0000-4000-8000-000000000001','aa181303-0000-4000-8000-000000000001','aa181302-0000-4000-8000-000000000001','2026-09-15','credit',1100,1,1,'nayax_scheduled_report','unified_state-native-original',100,'{"providerMachineId":"18110001","amountBasis":"separate_tax"}');
insert into sunze_unmapped_sales(sunze_machine_id,source_order_hash,source_row_hash,sale_date,payment_method,net_sales_cents,transaction_count) values('unified_state-unbound',repeat('1',64),'unified_state-pending-original','2026-09-15','cash',500,1);
insert into reporting_machine_refund_managers(reporting_machine_id,manager_user_id,manager_email,status) values('aa181303-0000-4000-8000-000000000001','aa181300-0000-4000-8000-000000000001','unified_state-admin@example.invalid','active');
insert into refund_machine_qr_codes(reporting_machine_id,public_code,version) values('aa181303-0000-4000-8000-000000000001',repeat('1',32),1);
insert into reporting_partnerships(id,name,effective_start_date,status,created_by) values('aa181308-0000-4000-8000-000000000001','Retained unified_state partner','2026-01-01','active','aa181300-0000-4000-8000-000000000001');
insert into reporting_machine_partnership_assignments(machine_id,partnership_id,effective_start_date,status) values('aa181303-0000-4000-8000-000000000001','aa181308-0000-4000-8000-000000000001','2026-01-01','active');
insert into reporting_partnership_financial_rules(partnership_id,calculation_model,split_base,fee_amount_cents,fee_basis,cost_amount_cents,cost_basis,deduction_timing,gross_to_net_method,fever_share_basis_points,partner_share_basis_points,bloomjoy_share_basis_points,effective_start_date,status) values('aa181308-0000-4000-8000-000000000001','net_split','net_sales',40,'per_stick',0,'none','before_split','imported_tax_plus_configured_fees',6000,0,4000,'2026-01-01','active');
insert into partner_report_snapshots(id,partnership_id,week_ending_date,status,summary_json,period_grain,period_start_date,period_end_date,generated_by,approved_by,approved_at,sent_at) values('aa181309-0000-4000-8000-000000000001','aa181308-0000-4000-8000-000000000001','2026-09-20','sent','{"immutableIssued":true,"amount_owed_cents":576}','reporting_week','2026-09-14','2026-09-20','aa181300-0000-4000-8000-000000000001','aa181300-0000-4000-8000-000000000001',now(),now());
insert into refund_cases(id,public_reference,reporting_machine_id,reporting_location_id,customer_email,issue_summary,incident_at,payment_method,payment_amount_cents,status) values('aa181310-0000-4000-8000-000000000001','RF-CATALOGUE-1811','aa181303-0000-4000-8000-000000000001','aa181302-0000-4000-8000-000000000001','unified_state-customer@example.invalid','Synthetic retained service case','2026-09-15T12:00:00Z','card',1100,'needs_review');
set local session_replication_role=origin;
create function pg_temp.unified_state_history() returns jsonb language sql as $$
 select jsonb_build_object(
 'machines',(select jsonb_agg(to_jsonb(x)-array['operational_phase','updated_at'] order by id) from reporting_machines x where id::text like 'aa181303-%'),
 'sites',(select jsonb_agg(to_jsonb(x) order by id) from reporting_locations x where id::text like 'aa181302-%'),
 'readers',(select jsonb_agg(to_jsonb(x) order by id) from refund_nayax_machine_inventory x where id::text like 'aa181304-%'),
 'facts',(select jsonb_agg(to_jsonb(x) order by id) from machine_sales_facts x where id::text like 'aa181307-%'),
 'financial',(select jsonb_agg(to_jsonb(x) order by id) from private.financial_machine_sales_facts x where id::text like 'aa181307-%'),
 'pending',(select jsonb_agg(to_jsonb(x) order by source_order_hash) from sunze_unmapped_sales x where sunze_machine_id='unified_state-unbound'),
 'managers',(select jsonb_agg(to_jsonb(x) order by manager_user_id) from reporting_machine_refund_managers x where reporting_machine_id::text like 'aa181303-%'),
 'qr',(select jsonb_agg(to_jsonb(x) order by id) from refund_machine_qr_codes x where reporting_machine_id::text like 'aa181303-%'),
 'refunds',(select jsonb_agg(to_jsonb(x) order by id) from refund_cases x where id::text like 'aa181310-%'),
 'assignments',(select jsonb_agg(to_jsonb(x) order by machine_id) from reporting_machine_partnership_assignments x where partnership_id::text like 'aa181308-%'),
 'rules',(select jsonb_agg(to_jsonb(x) order by id) from reporting_partnership_financial_rules x where partnership_id::text like 'aa181308-%'),
 'snapshots',(select jsonb_agg(to_jsonb(x) order by id) from partner_report_snapshots x),
 'components',(select jsonb_agg(to_jsonb(x) order by booking_date,tender,source) from private.machine_sales_daily_components('aa181303-0000-4000-8000-000000000001','2026-09-01','2026-09-30')x));
$$;
create temporary table unified_state_before as select pg_temp.unified_state_history() history;
create temporary table unified_state_expected as select id,updated_at,operational_phase from reporting_machines where id::text like 'aa181303-%';
grant select on unified_state_before,unified_state_expected to authenticated;
select ok(not has_function_privilege('anon','public.admin_set_machine_source_state(text,uuid,text,text,timestamptz,timestamptz,text)','execute'),'Anonymous cannot change unified State');
set local role authenticated;
select set_config('request.jwt.claim.role','authenticated',true),set_config('request.jwt.claim.sub','aa181300-0000-4000-8000-000000000003',true);
select throws_ok($$select admin_set_machine_source_state('Sunze',null,'unified_state-bound','inactive',null,null,'Outsider probe')$$,'42501',null,'Outsider cannot hide a known machine');
select set_config('request.jwt.claim.sub','aa181300-0000-4000-8000-000000000002',true);
select is((select (i->>'machineUpdatedAt')::timestamptz from jsonb_array_elements(admin_get_machine_source_inventory()->'sources')i where i->>'sourceId'='unified_state-bound'),(select updated_at from unified_state_expected where id='aa181303-0000-4000-8000-000000000001'),'Authorized source getter exposes the exact bound Hub stamp for State review');
select is(admin_set_machine_source_state('Sunze',null,'unified_state-bound','inactive',null,(select updated_at from unified_state_expected where id='aa181303-0000-4000-8000-000000000001'),'Scoped Inactive')->>'state','inactive','Scoped Inactive retains the underlying Live machine');
select throws_ok($$select admin_set_machine_source_state('Sunze',null,'unified_state-bound','setup',(select (i->>'catalogueInactiveAt')::timestamptz from jsonb_array_elements(admin_get_machine_source_inventory()->'sources')i where i->>'sourceId'='unified_state-bound'),(select updated_at from unified_state_expected where id='aa181303-0000-4000-8000-000000000001'),'Scoped phase privilege probe')$$,'P0001',null,'Scoped visibility authority cannot acquire operational phase authority');
select ok((select i->>'catalogueInactiveAt' is not null from jsonb_array_elements(admin_get_machine_source_inventory()->'sources')i where i->>'sourceId'='unified_state-bound'),'Denied scoped phase change rolls back the attempted restore');
select is(admin_set_machine_source_state('Sunze',null,'unified_state-bound','live',(select (i->>'catalogueInactiveAt')::timestamptz from jsonb_array_elements(admin_get_machine_source_inventory()->'sources')i where i->>'sourceId'='unified_state-bound'),(select updated_at from unified_state_expected where id='aa181303-0000-4000-8000-000000000001'),'Scoped retained Live restore')->>'state','live','Scoped restore to retained Live is permitted');
select throws_ok($$select admin_set_machine_source_state('Sunze',null,'unified_state-unbound','inactive',null,null,'Scoped unbound probe')$$,'42501',null,'Scoped user cannot claim unbound source');
select set_config('request.jwt.claim.sub','aa181300-0000-4000-8000-000000000001',true);
select is((select i->>'machineUpdatedAt' from jsonb_array_elements(admin_get_machine_source_inventory()->'sources')i where i->>'sourceId'='unified_state-unbound'),null::text,'Unbound source has no manufactured Hub stamp');
select is(admin_set_machine_source_state('Sunze',null,'unified_state-unbound','inactive',null,null,'No setup fields')->>'state','inactive','Unbound Sunze becomes Inactive without name/company/zone/reader');
select is(admin_set_machine_source_state('Kexiaozhan','aa181305-0000-4000-8000-000000000001','same-unbound-id','inactive',null,null,'No setup fields')->>'state','inactive','Unbound Kex becomes Inactive without setup');
select is((select i->>'catalogueInactiveAt' from jsonb_array_elements(admin_get_machine_source_inventory()->'sources')i where i->>'sourceId'='same-unbound-id' and i->>'providerAccountId'='aa181305-0000-4000-8000-000000000002'),null::text,'Identical Kex ID in another account remains visible');
select throws_ok($$select admin_set_machine_source_state('Sunze',null,'unified_state-unbound','live',(select (i->>'catalogueInactiveAt')::timestamptz from jsonb_array_elements(admin_get_machine_source_inventory()->'sources')i where i->>'sourceId'='unified_state-unbound'),null,'Cannot fabricate live Hub')$$,'22023',null,'Unbound Live requires ordinary real setup');
select ok((select i->>'catalogueInactiveAt' is not null from jsonb_array_elements(admin_get_machine_source_inventory()->'sources')i where i->>'sourceId'='unified_state-unbound'),'Failed unbound Live leaves Inactive marker intact');
select is(admin_set_machine_source_state('Sunze',null,'unified_state-unbound','setup',(select (i->>'catalogueInactiveAt')::timestamptz from jsonb_array_elements(admin_get_machine_source_inventory()->'sources')i where i->>'sourceId'='unified_state-unbound'),null,'Restore original unbound Setup')->>'state','setup','Unbound Sunze restores to Setup without creating Hub');
select is(admin_set_machine_source_state('Kexiaozhan','aa181305-0000-4000-8000-000000000001','same-unbound-id','setup',(select (i->>'catalogueInactiveAt')::timestamptz from jsonb_array_elements(admin_get_machine_source_inventory()->'sources')i where i->>'sourceId'='same-unbound-id' and i->>'providerAccountId'='aa181305-0000-4000-8000-000000000001'),null,'Restore original unbound Setup')->>'state','setup','Unbound Kex restores to Setup without creating Hub');
select throws_ok($$select admin_set_machine_source_state('Sunze',null,'unified_state-bound','setup',null,'2000-01-01','Stale reviewed Hub')$$,'40001',null,'Stale Hub stamp cannot change phase');
select throws_ok($$select admin_set_machine_source_state('Sunze',null,'unified_state-bound','setup',null,null,'Missing reviewed Hub')$$,'40001',null,'Bound phase change requires its reviewed Hub stamp');
select throws_ok($$select admin_set_machine_source_state('Sunze',null,'unified_state-bound',null,null,null,'Null State')$$,'22023',null,'Null State is rejected');
select throws_ok($$select admin_set_machine_source_state('Sunze',null,'unified_state-bound','retired',null,null,'Invalid State')$$,'22023',null,'Only Setup Live Inactive are accepted');
select throws_ok($$select admin_set_machine_source_state('Sunze',null,'unified_state-archived','inactive',null,(select updated_at from unified_state_expected where id='aa181303-0000-4000-8000-000000000003'),'Archived history probe')$$,'22023',null,'Inactive cannot revive an archived historical Hub');
reset role;
select is(pg_temp.unified_state_history(),(select history from unified_state_before),'Inactive and same-phase restores preserve financial/config/history inputs');
create temporary table unified_state_rows_before as select to_jsonb(m) machine,(select count(*) from admin_audit_log where actor_user_id='aa181300-0000-4000-8000-000000000001') audit_count from reporting_machines m where id='aa181303-0000-4000-8000-000000000001';
grant select on unified_state_rows_before to authenticated;
set local role authenticated;
select is(admin_set_machine_source_state('Sunze',null,'unified_state-bound','live',null,(select updated_at from unified_state_expected where id='aa181303-0000-4000-8000-000000000001'),'Idempotent State')->>'state','live','Same visible State succeeds idempotently');
reset role;
select is((select to_jsonb(m) from reporting_machines m where id='aa181303-0000-4000-8000-000000000001'),(select machine from unified_state_rows_before),'Idempotent State leaves full Hub row unchanged');
select is((select count(*) from admin_audit_log where actor_user_id='aa181300-0000-4000-8000-000000000001'),(select audit_count from unified_state_rows_before),'Idempotent State creates no audit churn');
set local role authenticated;
select is(admin_set_machine_source_state('Sunze',null,'unified_state-bound','inactive',null,(select updated_at from unified_state_expected where id='aa181303-0000-4000-8000-000000000001'),'Retain Live underneath')->>'state','inactive','Bound Live transitions to Inactive');
select throws_ok($$select admin_set_machine_source_state('Sunze',null,'unified_state-bound','live',null,(select updated_at from unified_state_expected where id='aa181303-0000-4000-8000-000000000001'),'Stale visibility marker')$$,'40001',null,'Stale marker cannot restore visible State');
select is(admin_set_machine_source_state('Sunze',null,'unified_state-bound','setup',(select (i->>'catalogueInactiveAt')::timestamptz from jsonb_array_elements(admin_get_machine_source_inventory()->'sources')i where i->>'sourceId'='unified_state-bound'),(select updated_at from unified_state_expected where id='aa181303-0000-4000-8000-000000000001'),'Atomic restore to Setup')->>'state','setup','Bound Inactive restores atomically to a different Setup phase');
reset role;
select is((select operational_phase from reporting_machines where id='aa181303-0000-4000-8000-000000000001'),'setup','Restored underlying phase is exactly Setup');
select ok((select catalogue_inactive_at is null from sunze_machine_discoveries where sunze_machine_id='unified_state-bound'),'Atomic phase restore cleared only the source marker');
update unified_state_expected e set updated_at=m.updated_at from reporting_machines m where m.id=e.id;
set local role authenticated;
select is(admin_set_machine_source_state('Sunze',null,'unified_state-bound','live',null,(select updated_at from unified_state_expected where id='aa181303-0000-4000-8000-000000000001'),'Original Live phase restored')->>'state','live','Visible Setup changes back to Live through canonical phase writer');
select is(admin_set_machine_source_state('Kexiaozhan','aa181305-0000-4000-8000-000000000001','unified_state-kex-bound','inactive',null,(select updated_at from unified_state_expected where id='aa181303-0000-4000-8000-000000000002'),'Retain original Setup')->>'state','inactive','Bound Kex Setup transitions to Inactive');
reset role;
create temporary table unified_state_rollback_before as select to_jsonb(m) machine,(select to_jsonb(s) from private.snapcase_source_machines s where provider_account_id='aa181305-0000-4000-8000-000000000001' and source_machine_id='unified_state-kex-bound') source,(select count(*) from admin_audit_log) audit_count from reporting_machines m where id='aa181303-0000-4000-8000-000000000002';
create function pg_temp.fail_unified_state_audit() returns trigger language plpgsql as $$ begin if new.action='reporting_machine.operational_phase_updated' and new.entity_id='aa181303-0000-4000-8000-000000000002' then raise exception 'Synthetic late phase audit' using errcode='Z1813'; end if; return new; end $$;
create trigger unified_state_late_audit before insert on admin_audit_log for each row execute function pg_temp.fail_unified_state_audit();
set local role authenticated;
select throws_ok($$select admin_set_machine_source_state('Kexiaozhan','aa181305-0000-4000-8000-000000000001','unified_state-kex-bound','live',(select (i->>'catalogueInactiveAt')::timestamptz from jsonb_array_elements(admin_get_machine_source_inventory()->'sources')i where i->>'sourceId'='unified_state-kex-bound'),(select updated_at from unified_state_expected where id='aa181303-0000-4000-8000-000000000002'),'Late audit atomic rollback')$$,'Z1813',null,'Late second audit failure rolls back marker and phase together');
reset role;
drop trigger unified_state_late_audit on admin_audit_log;
select is((select to_jsonb(m) from reporting_machines m where id='aa181303-0000-4000-8000-000000000002'),(select machine from unified_state_rollback_before),'Late failure preserves full Kex Hub row');
select is((select to_jsonb(s) from private.snapcase_source_machines s where provider_account_id='aa181305-0000-4000-8000-000000000001' and source_machine_id='unified_state-kex-bound'),(select source from unified_state_rollback_before),'Late failure preserves full Kex source row');
select is((select count(*) from admin_audit_log),(select audit_count from unified_state_rollback_before),'Late failure leaves neither source nor phase audit');
set local role authenticated;
select is(admin_set_machine_source_state('Kexiaozhan','aa181305-0000-4000-8000-000000000001','unified_state-kex-bound','setup',(select (i->>'catalogueInactiveAt')::timestamptz from jsonb_array_elements(admin_get_machine_source_inventory()->'sources')i where i->>'sourceId'='unified_state-kex-bound'),(select updated_at from unified_state_expected where id='aa181303-0000-4000-8000-000000000002'),'Retained Setup restore')->>'state','setup','Bound Kex restores retained Setup without operational changes');
select is(admin_set_machine_source_state('Kexiaozhan','aa181305-0000-4000-8000-000000000001','unified_state-kex-bound','live',null,(select updated_at from unified_state_expected where id='aa181303-0000-4000-8000-000000000002'),'Kex visible Live')->>'state','live','Kex Setup changes to Live through the same audited phase path');
reset role;
update unified_state_expected e set updated_at=m.updated_at from reporting_machines m where m.id=e.id;
set local role authenticated;
select is(admin_set_machine_source_state('Kexiaozhan','aa181305-0000-4000-8000-000000000001','unified_state-kex-bound','setup',null,(select updated_at from unified_state_expected where id='aa181303-0000-4000-8000-000000000002'),'Original Kex Setup')->>'state','setup','Kex Live returns to its original Setup phase');
reset role;
select is(pg_temp.unified_state_history(),(select history from unified_state_before),'All state transitions preserve raw/canonical money, original reader authority, managers, QR, refunds, assignment/rule and issued snapshot bytes');
select is((select jsonb_agg(jsonb_build_array(id,operational_phase) order by id) from reporting_machines where id::text like 'aa181303-%'),(select jsonb_agg(jsonb_build_array(id,operational_phase) order by id) from unified_state_expected),'Final underlying Setup and Live phases match their original values');
select is((select count(*) from reporting_machines where id::text like 'aa181303-%'),3::bigint,'Unbound inactive and restore created no new physical Hub');
select * from finish();
rollback;
