begin;
create extension if not exists pgtap with schema extensions;
set local search_path=public,extensions;
set local timezone='UTC';
select no_plan();
-- Synthetic seeds only; every operation below uses origin triggers and real roles.
set local session_replication_role=replica;
insert into auth.users(id,email) values
 ('aa181100-0000-4000-8000-000000000001','catalogue-admin@example.invalid'),
 ('aa181100-0000-4000-8000-000000000002','catalogue-scoped@example.invalid'),
 ('aa181100-0000-4000-8000-000000000003','catalogue-outsider@example.invalid');
insert into admin_roles(user_id,role,active) values('aa181100-0000-4000-8000-000000000001','super_admin',true);
insert into customer_accounts(id,name) values('aa181101-0000-4000-8000-000000000001','Catalogue current company');
insert into reporting_locations(id,account_id,name,timezone) values('aa181102-0000-4000-8000-000000000001','aa181101-0000-4000-8000-000000000001','Retained catalogue site','America/Los_Angeles');
insert into reporting_machines(id,account_id,location_id,machine_label,machine_type,sunze_machine_id,nayax_machine_id,nayax_account_key,nayax_card_sales_started_on) values
 ('aa181103-0000-4000-8000-000000000001','aa181101-0000-4000-8000-000000000001','aa181102-0000-4000-8000-000000000001','Retained live cotton','commercial','catalogue-bound','18110001','CATALOGUE_FIXTURE','2026-09-01'),
 ('aa181103-0000-4000-8000-000000000002','aa181101-0000-4000-8000-000000000001','aa181102-0000-4000-8000-000000000001','Retained setup case','snapcase',null,null,null,null),
 ('aa181103-0000-4000-8000-000000000003','aa181101-0000-4000-8000-000000000001','aa181102-0000-4000-8000-000000000001','Retired history','commercial','catalogue-archived',null,null,null);
update reporting_machines set management_archived_at=now(),management_archived_by='aa181100-0000-4000-8000-000000000001',management_archive_reason='Synthetic permanent management retirement' where id='aa181103-0000-4000-8000-000000000003';
insert into sunze_machine_discoveries(sunze_machine_id,sunze_machine_name,status,reporting_machine_id,last_seen_at) values
 ('catalogue-bound','Original cotton name','mapped','aa181103-0000-4000-8000-000000000001',now()),
 ('catalogue-unbound','Unnamed unconfigured cotton','pending',null,now()),
 ('catalogue-archived','Retired source name','mapped','aa181103-0000-4000-8000-000000000003',now());
insert into private.snapcase_provider_accounts(id,source_account_key) values
 ('aa181105-0000-4000-8000-000000000001','catalogue-account-a'),('aa181105-0000-4000-8000-000000000002','catalogue-account-b');
insert into private.snapcase_source_machines(provider_account_id,source_machine_id,source_label,source_timezone) values
 ('aa181105-0000-4000-8000-000000000001','catalogue-kex-bound','Original case name','America/Los_Angeles'),
 ('aa181105-0000-4000-8000-000000000001','same-unbound-id',null,null),
 ('aa181105-0000-4000-8000-000000000002','same-unbound-id','Other account cabinet',null);
insert into private.snapcase_machine_mappings(provider_account_id,source_machine_id,reporting_machine_id,effective_start_date,mapping_reason) values('aa181105-0000-4000-8000-000000000001','catalogue-kex-bound','aa181103-0000-4000-8000-000000000002','2020-01-01','Synthetic exact account mapping');
insert into admin_scoped_access_grants(id,user_id,starts_at,grant_reason,granted_by) values('aa181106-0000-4000-8000-000000000001','aa181100-0000-4000-8000-000000000002','2020-01-01','Synthetic catalogue scope','aa181100-0000-4000-8000-000000000001');
insert into admin_scoped_access_scopes(grant_id,scope_type,machine_id,grant_reason,granted_by)
select 'aa181106-0000-4000-8000-000000000001','machine',id,'Synthetic exact mapped scope','aa181100-0000-4000-8000-000000000001' from reporting_machines where id in('aa181103-0000-4000-8000-000000000001','aa181103-0000-4000-8000-000000000002');
insert into refund_nayax_machine_inventory(id,account_key,nayax_machine_id,machine_name,provider_is_active,reporting_machine_id,reconciliation_state,refund_category) values('aa181104-0000-4000-8000-000000000001','CATALOGUE_FIXTURE','18110001','Retained card reader',true,'aa181103-0000-4000-8000-000000000001','published','cotton_candy');
insert into machine_sales_facts(id,reporting_machine_id,reporting_location_id,sale_date,payment_method,net_sales_cents,transaction_count,item_quantity,source,source_row_hash,tax_cents,raw_payload) values('aa181107-0000-4000-8000-000000000001','aa181103-0000-4000-8000-000000000001','aa181102-0000-4000-8000-000000000001','2026-09-15','credit',1100,1,1,'nayax_scheduled_report','catalogue-native-original',100,'{"providerMachineId":"18110001","amountBasis":"separate_tax"}');
insert into sunze_unmapped_sales(sunze_machine_id,source_order_hash,source_row_hash,sale_date,payment_method,net_sales_cents,transaction_count) values('catalogue-unbound',repeat('1',64),'catalogue-pending-original','2026-09-15','cash',500,1);
insert into reporting_machine_refund_managers(reporting_machine_id,manager_user_id,manager_email,status) values('aa181103-0000-4000-8000-000000000001','aa181100-0000-4000-8000-000000000001','catalogue-admin@example.invalid','active');
insert into refund_machine_qr_codes(reporting_machine_id,public_code,version) values('aa181103-0000-4000-8000-000000000001',repeat('1',32),1);
insert into reporting_partnerships(id,name,effective_start_date,status,created_by) values('aa181108-0000-4000-8000-000000000001','Retained catalogue partner','2026-01-01','active','aa181100-0000-4000-8000-000000000001');
insert into reporting_machine_partnership_assignments(machine_id,partnership_id,effective_start_date,status) values('aa181103-0000-4000-8000-000000000001','aa181108-0000-4000-8000-000000000001','2026-01-01','active');
insert into reporting_partnership_financial_rules(partnership_id,calculation_model,split_base,fee_amount_cents,fee_basis,cost_amount_cents,cost_basis,deduction_timing,gross_to_net_method,fever_share_basis_points,partner_share_basis_points,bloomjoy_share_basis_points,effective_start_date,status) values('aa181108-0000-4000-8000-000000000001','net_split','net_sales',40,'per_stick',0,'none','before_split','imported_tax_plus_configured_fees',6000,0,4000,'2026-01-01','active');
insert into partner_report_snapshots(id,partnership_id,week_ending_date,status,summary_json,period_grain,period_start_date,period_end_date,generated_by,approved_by,approved_at,sent_at) values('aa181109-0000-4000-8000-000000000001','aa181108-0000-4000-8000-000000000001','2026-09-20','sent','{"immutableIssued":true,"amount_owed_cents":576}','reporting_week','2026-09-14','2026-09-20','aa181100-0000-4000-8000-000000000001','aa181100-0000-4000-8000-000000000001',now(),now());
insert into refund_cases(id,public_reference,reporting_machine_id,reporting_location_id,customer_email,issue_summary,incident_at,payment_method,payment_amount_cents,status) values('aa181110-0000-4000-8000-000000000001','RF-CATALOGUE-1811','aa181103-0000-4000-8000-000000000001','aa181102-0000-4000-8000-000000000001','catalogue-customer@example.invalid','Synthetic retained service case','2026-09-15T12:00:00Z','card',1100,'needs_review');
set local session_replication_role=origin;
create function pg_temp.catalogue_history() returns jsonb language sql as $$
 select jsonb_build_object(
 'machines',(select jsonb_agg(to_jsonb(x) order by id) from reporting_machines x where id::text like 'aa181103-%'),
 'sites',(select jsonb_agg(to_jsonb(x) order by id) from reporting_locations x where id::text like 'aa181102-%'),
 'readers',(select jsonb_agg(to_jsonb(x) order by id) from refund_nayax_machine_inventory x where id::text like 'aa181104-%'),
 'facts',(select jsonb_agg(to_jsonb(x) order by id) from machine_sales_facts x where id::text like 'aa181107-%'),
 'financial',(select jsonb_agg(to_jsonb(x) order by id) from private.financial_machine_sales_facts x where id::text like 'aa181107-%'),
 'pending',(select jsonb_agg(to_jsonb(x) order by source_order_hash) from sunze_unmapped_sales x where sunze_machine_id='catalogue-unbound'),
 'managers',(select jsonb_agg(to_jsonb(x) order by manager_user_id) from reporting_machine_refund_managers x where reporting_machine_id::text like 'aa181103-%'),
 'qr',(select jsonb_agg(to_jsonb(x) order by id) from refund_machine_qr_codes x where reporting_machine_id::text like 'aa181103-%'),
 'refunds',(select jsonb_agg(to_jsonb(x) order by id) from refund_cases x where id::text like 'aa181110-%'),
 'assignments',(select jsonb_agg(to_jsonb(x) order by machine_id) from reporting_machine_partnership_assignments x where partnership_id::text like 'aa181108-%'),
 'rules',(select jsonb_agg(to_jsonb(x) order by id) from reporting_partnership_financial_rules x where partnership_id::text like 'aa181108-%'),
 'snapshots',(select jsonb_agg(to_jsonb(x) order by id) from partner_report_snapshots x),
 'components',(select jsonb_agg(to_jsonb(x) order by booking_date,tender,source) from private.machine_sales_daily_components('aa181103-0000-4000-8000-000000000001','2026-09-01','2026-09-30')x));
$$;
create temporary table catalogue_before as select pg_temp.catalogue_history() history,
 (select jsonb_agg(to_jsonb(d)-array['catalogue_inactive_at','updated_at'] order by sunze_machine_id) from sunze_machine_discoveries d where sunze_machine_id like 'catalogue-%') sunze,
 (select jsonb_agg(to_jsonb(s)-array['catalogue_inactive_at','updated_at'] order by provider_account_id,source_machine_id) from private.snapcase_source_machines s where provider_account_id::text like 'aa181105-%') kex;
create temporary table catalogue_markers(platform text,account_id uuid,source_id text,marker timestamptz);
create temporary table catalogue_expected as select jsonb_build_array('Sunze',null::text,sunze_machine_id)identity from sunze_machine_discoveries union all select jsonb_build_array('Kexiaozhan',provider_account_id::text,source_machine_id) from private.snapcase_source_machines;
grant select on catalogue_before,catalogue_expected to authenticated;
grant select,insert on catalogue_markers to authenticated;
select is((select net_sales_cents from private.financial_machine_sales_facts where id='aa181107-0000-4000-8000-000000000001'),1100::bigint,'Parity baseline includes a positive eligible native card sale');
select ok(not has_function_privilege('anon','public.admin_set_machine_source_catalogue_inactive(text,uuid,text,boolean,timestamptz,text)','execute'),'Anonymous cannot change source visibility');
set local role authenticated;
select set_config('request.jwt.claim.role','authenticated',true),set_config('request.jwt.claim.sub','aa181100-0000-4000-8000-000000000003',true);
select throws_ok($$select admin_set_machine_source_catalogue_inactive('Sunze',null,'catalogue-bound',true,null,'Outsider probe')$$,'42501',null,'Outsider cannot change a known source');
select set_config('request.jwt.claim.sub','aa181100-0000-4000-8000-000000000002',true);
select is((admin_get_machine_source_inventory()->>'count')::int,2,'Scoped catalogue contains only the two authorized exact sources');
select lives_ok($$select admin_set_machine_source_catalogue_inactive('Sunze',null,'catalogue-bound',true,null,'Scoped hide')$$,'Scoped mapped Sunze source can be inactive');
select lives_ok($$select admin_set_machine_source_catalogue_inactive('Kexiaozhan','aa181105-0000-4000-8000-000000000001','catalogue-kex-bound',true,null,'Scoped hide')$$,'Scoped mapped Kex source can be inactive');
select is((admin_get_machine_source_inventory()->>'count')::int,2,'Inactive does not erase scoped source inventory');
select throws_ok($$select admin_set_machine_source_catalogue_inactive('Sunze',null,'catalogue-unbound',true,null,'Scoped unbound')$$,'42501',null,'Scoped user cannot claim or hide global unbound Sunze');
select throws_ok($$select admin_set_machine_source_catalogue_inactive('Kexiaozhan','aa181105-0000-4000-8000-000000000002','same-unbound-id',true,null,'Scoped account probe')$$,'42501',null,'Scoped user cannot hide a different account source');
select set_config('request.jwt.claim.sub','aa181100-0000-4000-8000-000000000001',true);
select lives_ok($$select admin_set_machine_source_catalogue_inactive('Sunze',null,'catalogue-unbound',true,null,'Unbound source without setup')$$,'Unbound cotton needs no company, reader, timezone or manager to become inactive');
select lives_ok($$select admin_set_machine_source_catalogue_inactive('Kexiaozhan','aa181105-0000-4000-8000-000000000001','same-unbound-id',true,null,'Unbound source without setup')$$,'Unbound case source needs no setup fields to become inactive');
insert into catalogue_markers select item->>'platform',(item->>'providerAccountId')::uuid,item->>'sourceId',(item->>'catalogueInactiveAt')::timestamptz from jsonb_array_elements(admin_get_machine_source_inventory()->'sources')item where item->>'sourceId' in('catalogue-bound','catalogue-unbound','catalogue-kex-bound','same-unbound-id');
select is((select count(*)::int from catalogue_markers where marker is not null),4,'Four independently scoped sources are inactive');
select is((select marker from catalogue_markers where account_id='aa181105-0000-4000-8000-000000000002'),null::timestamptz,'Same Kex source ID in another account remains active');
select ok(admin_get_machine_source_inventory()->'sources' @> '[{"sourceId":"catalogue-bound","companyId":"aa181101-0000-4000-8000-000000000001","companyName":"Catalogue current company"},{"sourceId":"catalogue-unbound","companyId":null,"companyName":null}]','Company filter data comes from exact current Hub, not guessed source labels');
select is((admin_get_machine_source_inventory()->>'count')::int,jsonb_array_length(admin_get_machine_source_inventory()->'sources'),'Catalogue count includes inactive identities and equals complete source set');
select is((select jsonb_agg(identity order by identity::text) from catalogue_expected),(select jsonb_agg(jsonb_build_array(item->>'platform',item->>'providerAccountId',item->>'sourceId') order by jsonb_build_array(item->>'platform',item->>'providerAccountId',item->>'sourceId')::text) from jsonb_array_elements(admin_get_machine_source_inventory()->'sources')item),'Inactive sources remain in the exact complete provider/account/ID inventory set');
select throws_ok($$select admin_set_machine_source_catalogue_inactive('Sunze',null,'catalogue-bound',false,null,'Stale marker')$$,'40001',null,'Stale marker cannot undo another admin change');
select throws_ok($$select admin_set_machine_source_catalogue_inactive('Sunze',null,'catalogue-bound',null,null,'Invalid state')$$,'22023',null,'Null state is rejected');
select throws_ok($$select admin_set_machine_source_catalogue_inactive('Sunze','aa181105-0000-4000-8000-000000000001','catalogue-bound',true,null,'Wrong account')$$,'22023',null,'Sunze cannot acquire a provider account scope');
select throws_ok($$select admin_set_machine_source_catalogue_inactive('Kexiaozhan',null,'same-unbound-id',true,null,'Missing account')$$,'22023',null,'Kex requires exact account');
select throws_ok($$select admin_set_machine_source_catalogue_inactive('Sunze',null,' catalogue-bound',true,null,'Whitespace source')$$,'22023',null,'Source IDs are never silently normalized');
select throws_ok($$select admin_set_machine_source_catalogue_inactive('Sunze',null,'missing-catalogue',true,null,'Missing source')$$,'22023',null,'Missing source cannot be invented by state action');
select throws_ok($$select admin_set_machine_source_catalogue_inactive('Sunze',null,'catalogue-bound',false,(select marker from catalogue_markers where source_id='catalogue-bound'),' ')$$,'P0001',null,'Visibility change requires an audit reason');
select throws_ok($$select admin_set_machine_source_catalogue_inactive('Sunze',null,'catalogue-archived',false,null,'Archive restore attempt')$$,'22023',null,'Catalogue restore cannot revive a historical archived Hub');
select is((with changed as(update sunze_machine_discoveries set catalogue_inactive_at=null where sunze_machine_id='catalogue-bound' returning 1) select count(*) from changed),0::bigint,'Even authenticated superadmin cannot bypass audited RPC through direct source UPDATE');
reset role;
create temporary table catalogue_noop_before as select to_jsonb(d)source,(select count(*) from admin_audit_log)audits from sunze_machine_discoveries d where sunze_machine_id='catalogue-bound';
set local role authenticated;
select lives_ok($$select admin_set_machine_source_catalogue_inactive('Sunze',null,'catalogue-bound',true,(select marker from catalogue_markers where source_id='catalogue-bound'),'Already inactive')$$,'Same-state request succeeds without mutation');
reset role;
select is((select to_jsonb(d) from sunze_machine_discoveries d where sunze_machine_id='catalogue-bound'),(select source from catalogue_noop_before),'Idempotence preserves complete source row including timestamps');
select is((select count(*) from admin_audit_log),(select audits from catalogue_noop_before),'Idempotence creates no duplicate audit');
create function pg_temp.reject_catalogue_audit() returns trigger language plpgsql as $$begin if new.action='machine_source.catalogue_state_changed' then raise exception 'Synthetic late catalogue audit failure' using errcode='P0001'; end if; return new; end$$;
create trigger reject_catalogue_audit before insert on admin_audit_log for each row execute function pg_temp.reject_catalogue_audit();
set local role authenticated;
select throws_ok($$select admin_set_machine_source_catalogue_inactive('Sunze',null,'catalogue-bound',false,(select marker from catalogue_markers where source_id='catalogue-bound'),'Atomic restore')$$,'P0001',null,'Late audit failure rolls back source restore');
reset role;
drop trigger reject_catalogue_audit on admin_audit_log;
select is((select to_jsonb(d) from sunze_machine_discoveries d where sunze_machine_id='catalogue-bound'),(select source from catalogue_noop_before),'Failed restore preserves full source row');
select is((select count(*) from admin_audit_log),(select audits from catalogue_noop_before),'Failed restore leaves no audit residue');
-- Exercise provider refresh while inactive. These are actual importer column contracts.
insert into sunze_machine_discoveries(sunze_machine_id,sunze_machine_name,status,reporting_machine_id,last_seen_at) values('catalogue-unbound','Provider renamed cotton','pending',null,now()+interval '1 day') on conflict(sunze_machine_id) do update set sunze_machine_name=excluded.sunze_machine_name,status=excluded.status,reporting_machine_id=excluded.reporting_machine_id,last_seen_at=excluded.last_seen_at;
select is((select catalogue_inactive_at from sunze_machine_discoveries where sunze_machine_id='catalogue-unbound'),(select marker from catalogue_markers where source_id='catalogue-unbound'),'Sunze explicit metadata upsert preserves manual Inactive marker');
create function pg_temp.catalogue_kex_payload() returns jsonb language sql as $$select jsonb_build_object('contractVersion','snapcase.ingest.v1','sourceAccountKey','catalogue-account-a','runKey',repeat('2',64),'batchKey',repeat('3',64),'batchDigest',repeat('4',64),'machines',jsonb_build_array(jsonb_build_object('sourceInventoryId','catalogue-fixture-inventory','sourceMachineId','same-unbound-id','revisionDigest',repeat('5',64),'sourceLabel','Provider renamed case','sourceStatus','online','sourceTimezone',null)),'orders','[]'::jsonb,'payments','[]'::jsonb,'evidence','[]'::jsonb)$$;
set local role service_role;
select set_config('request.jwt.claim.role','service_role',true);
select lives_ok($$select service_ingest_snapcase_observations(pg_temp.catalogue_kex_payload())$$,'Actual Kex machines-only import refresh succeeds while inactive');
select is((service_ingest_snapcase_observations(pg_temp.catalogue_kex_payload())->>'duplicate')::boolean,true,'Repeated identical Kex import stays idempotent');
reset role;
select is((select catalogue_inactive_at from private.snapcase_source_machines where provider_account_id='aa181105-0000-4000-8000-000000000001' and source_machine_id='same-unbound-id'),(select marker from catalogue_markers where source_id='same-unbound-id' and account_id='aa181105-0000-4000-8000-000000000001'),'Kex import and replay never resurrect inactive source');
set local role authenticated;
select set_config('request.jwt.claim.role','authenticated',true);
select lives_ok($$select admin_set_machine_source_catalogue_inactive(platform,account_id,source_id,false,marker,'Restore exact prior source state') from catalogue_markers where marker is not null$$,'Restore every inactive source without setup or operational changes');
select ok(not exists(select 1 from jsonb_array_elements(admin_get_machine_source_inventory()->'sources')item where item->>'catalogueInactiveAt' is not null),'Restored catalogue has no manual inactive markers');
reset role;
select is(pg_temp.catalogue_history(),(select history from catalogue_before),'Inactive, import refresh and restore preserve full financial components, raw facts, pending, readers, machine status/boundary, service, manager, QR, assignments, rules and issued snapshots');
select is((select jsonb_agg(to_jsonb(d)-array['catalogue_inactive_at','updated_at'] order by sunze_machine_id) from sunze_machine_discoveries d where sunze_machine_id in('catalogue-bound','catalogue-archived')),(select jsonb_agg(value order by value->>'sunze_machine_id') from jsonb_array_elements((select sunze from catalogue_before))value where value->>'sunze_machine_id' in('catalogue-bound','catalogue-archived')),'Visibility operations retain all bound and archived Sunze metadata');
select is((select to_jsonb(s)-array['catalogue_inactive_at','updated_at'] from private.snapcase_source_machines s where provider_account_id='aa181105-0000-4000-8000-000000000001' and source_machine_id='catalogue-kex-bound'),(select value from jsonb_array_elements((select kex from catalogue_before))value where value->>'source_machine_id'='catalogue-kex-bound'),'Bound Kex metadata is unchanged except marker and ordinary update stamp');
select is((select count(*)::int from admin_audit_log where action='machine_source.catalogue_state_changed' and meta->>'sourceId' in('catalogue-bound','catalogue-unbound','catalogue-kex-bound','same-unbound-id')),8,'Exactly four hide and four restore changes are audited');
select ok(not exists(select 1 from admin_audit_log where action='machine_source.catalogue_state_changed' and meta->>'sourceId'='same-unbound-id' and meta->>'providerAccountId'='aa181105-0000-4000-8000-000000000002'),'Other-account same ID is never mutated or audited');
select * from finish();
rollback;
