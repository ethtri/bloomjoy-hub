begin;
create extension if not exists pgtap with schema extensions;
set local search_path=public,extensions;
set local timezone='UTC';
select no_plan();
-- Capital City shape: separate current source/cash and historical reader/card
-- records, conflicting companies, stale product alias and an unmatched case.
-- Only seed construction bypasses triggers. Every real action uses origin.
set local session_replication_role=replica;
insert into auth.users(id,email) values
 ('aa181500-0000-4000-8000-000000000001','same-machine-admin@example.invalid'),
 ('aa181500-0000-4000-8000-000000000002','same-machine-manager@example.invalid'),
 ('aa181500-0000-4000-8000-000000000003','historical-manager@example.invalid');
insert into admin_roles(user_id,role,active) values('aa181500-0000-4000-8000-000000000001','super_admin',true);
insert into customer_accounts(id,name) values
 ('aa181501-0000-4000-8000-000000000001','Current selected company'),
 ('aa181501-0000-4000-8000-000000000002','Historical reporting company');
insert into reporting_locations(id,account_id,name,timezone) values
 ('aa181502-0000-4000-8000-000000000001','aa181501-0000-4000-8000-000000000001','Capital City Mall','America/New_York'),
 ('aa181502-0000-4000-8000-000000000002','aa181501-0000-4000-8000-000000000002','Capital City Mall','America/New_York');
insert into reporting_machines(id,account_id,location_id,machine_label,machine_type,operational_phase,refund_intake_enabled,nayax_refunds_enabled) values
 ('aa181503-0000-4000-8000-000000000001','aa181501-0000-4000-8000-000000000001','aa181502-0000-4000-8000-000000000001','SnapCase Capital City','snapcase','live',false,false),
 ('aa181503-0000-4000-8000-000000000003','aa181501-0000-4000-8000-000000000001','aa181502-0000-4000-8000-000000000001','Other real machine','snapcase','live',false,false);
insert into reporting_machines(id,account_id,location_id,machine_label,refund_public_display_label,machine_type,operational_phase,nayax_machine_id,nayax_account_key,refund_intake_enabled,nayax_refunds_enabled) values
 ('aa181503-0000-4000-8000-000000000002','aa181501-0000-4000-8000-000000000002','aa181502-0000-4000-8000-000000000002','Historical provider name','Capital City Mall — Cotton Candy','snapcase','live','18150001','TGPACI_USA_DB',true,true);
insert into refund_nayax_machine_inventory(id,account_key,nayax_machine_id,machine_name,provider_is_active,reporting_machine_id,reconciliation_state,refund_category) values
 ('aa181504-0000-4000-8000-000000000001','TGPACI_USA_DB','18150001','Historical provider name',true,'aa181503-0000-4000-8000-000000000002','published','cotton_candy');
insert into private.snapcase_provider_accounts(id,source_account_key) values('aa181505-0000-4000-8000-000000000001','same-machine-join-fixture');
insert into private.snapcase_source_machines(provider_account_id,source_machine_id,source_label,source_timezone) values
 ('aa181505-0000-4000-8000-000000000001','fixture-1815-capital','Capital City','America/New_York');
insert into private.snapcase_machine_mappings(provider_account_id,source_machine_id,reporting_machine_id,effective_start_date,mapping_reason) values
 ('aa181505-0000-4000-8000-000000000001','fixture-1815-capital','aa181503-0000-4000-8000-000000000001','2025-01-01','Retained original cash source mapping');
insert into reporting_machine_refund_managers(reporting_machine_id,manager_user_id,manager_email,status) values
 ('aa181503-0000-4000-8000-000000000001','aa181500-0000-4000-8000-000000000002','same-machine-manager@example.invalid','active'),
 ('aa181503-0000-4000-8000-000000000002','aa181500-0000-4000-8000-000000000001','same-machine-admin@example.invalid','active'),
 ('aa181503-0000-4000-8000-000000000002','aa181500-0000-4000-8000-000000000003','historical-manager@example.invalid','active');
insert into private.nayax_machine_tax_observations(account_key,nayax_machine_id,observed_at,source,classification,rate_percent,provenance,effective_start_date)
 values('TGPACI_USA_DB','18150001',now(),'finance_verified','verified_tax',0,'Explicit synthetic old-reader tax evidence','2025-01-01');
insert into machine_sales_facts(reporting_machine_id,reporting_location_id,sale_date,payment_method,net_sales_cents,transaction_count,item_quantity,tax_cents,source,source_order_hash,source_row_hash,raw_payload)
 select 'aa181503-0000-4000-8000-000000000001','aa181502-0000-4000-8000-000000000001','2026-09-01','cash',100,1,1,0,'snapcase_cash',md5('1815-cash-'||g)||md5('cash-'||g),'1815-cash-row-'||g,'{"amountBasis":"tax_exclusive"}'::jsonb from generate_series(1,67)g;
insert into machine_sales_facts(reporting_machine_id,reporting_location_id,sale_date,payment_method,net_sales_cents,transaction_count,item_quantity,tax_cents,source,source_order_hash,source_row_hash,raw_payload)
 select 'aa181503-0000-4000-8000-000000000002','aa181502-0000-4000-8000-000000000002','2026-09-01','credit',200,1,1,0,'nayax_scheduled_report',md5('1815-card-'||g)||md5('card-'||g),'1815-card-row-'||g,
 jsonb_build_object('amountBasis','tax_inclusive','providerMachineId','18150001','transactionId','1815-transaction-'||g,'siteId','4','actorId','18150000','currencyCode','USD') from generate_series(1,317)g;
insert into refund_cases(id,public_reference,reporting_machine_id,reporting_location_id,customer_email,issue_summary,incident_at,incident_timezone,incident_time_resolution,incident_time_confidence,payment_method,payment_amount_cents,status,intake_meta)
 values('aa181506-0000-4000-8000-000000000001','RF-1815-RETAINED','aa181503-0000-4000-8000-000000000002','aa181502-0000-4000-8000-000000000002','same-machine-customer@example.invalid','Retained rough-time request','2026-09-01T12:00:00Z','America/New_York','exact','rough','card',200,'denied','{}');
set local session_replication_role=origin;
-- A separate Sunze/cotton-candy pair proves the correction is provider-neutral.
set local session_replication_role=replica;
insert into reporting_machines(id,account_id,location_id,machine_label,machine_type,operational_phase,sunze_machine_id,nayax_machine_id,nayax_account_key) values
 ('aa181503-0000-4000-8000-000000000004','aa181501-0000-4000-8000-000000000001','aa181502-0000-4000-8000-000000000001','Current Sunze cabinet','commercial','live','1815-sunze-current',null,null),
 ('aa181503-0000-4000-8000-000000000005','aa181501-0000-4000-8000-000000000002','aa181502-0000-4000-8000-000000000002','Historical cotton reader','commercial','live',null,'18150003','TGPACI_USA_DB');
insert into sunze_machine_discoveries(sunze_machine_id,sunze_machine_name,status,reporting_machine_id) values
 ('1815-sunze-current','Current Sunze cabinet','mapped','aa181503-0000-4000-8000-000000000004');
insert into refund_nayax_machine_inventory(id,account_key,nayax_machine_id,machine_name,provider_is_active,reporting_machine_id,reconciliation_state,refund_category) values
 ('aa181504-0000-4000-8000-000000000002','TGPACI_USA_DB','18150003','Historical cotton reader',true,'aa181503-0000-4000-8000-000000000005','published','cotton_candy');
insert into private.nayax_machine_tax_observations(account_key,nayax_machine_id,observed_at,source,classification,rate_percent,provenance,effective_start_date)
 values('TGPACI_USA_DB','18150003',now(),'finance_verified','verified_tax',0,'Synthetic Sunze historical reader tax evidence','2025-01-01');
insert into machine_sales_facts(reporting_machine_id,reporting_location_id,sale_date,payment_method,net_sales_cents,transaction_count,item_quantity,tax_cents,source,source_order_hash,source_row_hash,raw_payload) values
 ('aa181503-0000-4000-8000-000000000004','aa181502-0000-4000-8000-000000000001','2026-09-01','cash',100,1,1,0,'sunze_browser',repeat('a',64),'1815-sunze-cash','{"amountBasis":"tax_exclusive","order_amount_cents":100,"machine_code":"1815-sunze-current"}'),
 ('aa181503-0000-4000-8000-000000000004','aa181502-0000-4000-8000-000000000001','2026-09-01','credit',200,1,1,0,'sunze_browser',repeat('b',64),'1815-sunze-app-card','{"amountBasis":"tax_exclusive","order_amount_cents":200,"machine_code":"1815-sunze-current"}'),
 ('aa181503-0000-4000-8000-000000000005','aa181502-0000-4000-8000-000000000002','2026-09-01','credit',300,1,1,0,'nayax_scheduled_report',repeat('c',64),'1815-sunze-native-card','{"amountBasis":"tax_inclusive","providerMachineId":"18150003","transactionId":"1815-sunze-original"}');
insert into refund_cases(id,public_reference,reporting_machine_id,reporting_location_id,customer_email,issue_summary,incident_at,incident_timezone,incident_time_resolution,incident_time_confidence,payment_method,payment_amount_cents,status,intake_meta)
 values('aa181506-0000-4000-8000-000000000002','RF-1815-SUNZE-RETAINED','aa181503-0000-4000-8000-000000000005','aa181502-0000-4000-8000-000000000002','sunze-customer@example.invalid','Retained original Sunze reader case','2026-09-01T12:00Z','America/New_York','exact','rough','card',300,'denied','{}');
set local session_replication_role=origin;
create temporary table join_before as select
 (select jsonb_agg(to_jsonb(f) order by id) from machine_sales_facts f where source_row_hash like '1815-%') facts,
 (select to_jsonb(c) from refund_cases c where id='aa181506-0000-4000-8000-000000000001') refund_case,
 (select jsonb_agg(to_jsonb(k) order by id) from private.snapcase_machine_mappings k where provider_account_id='aa181505-0000-4000-8000-000000000001') source_mapping,
 (select jsonb_agg(to_jsonb(m) order by reporting_machine_id,manager_user_id) from reporting_machine_refund_managers m where reporting_machine_id::text like 'aa181503-%') managers,
 (select jsonb_agg(to_jsonb(a) order by id) from reporting_machine_partnership_assignments a where machine_id::text like 'aa181503-%') assignments,
 (select jsonb_agg(to_jsonb(c) order by booking_date,tender) from private.machine_sales_daily_components('aa181503-0000-4000-8000-000000000001','2026-09-01','2026-09-30') c) cash_components,
 (select jsonb_agg(to_jsonb(c) order by booking_date,tender) from private.machine_sales_daily_components('aa181503-0000-4000-8000-000000000002','2026-09-01','2026-09-30') c) card_components,
 (select jsonb_agg(to_jsonb(m)-array['nayax_machine_id','nayax_account_key','nayax_manual_portal_enabled','nayax_manual_account_scope','nayax_manual_portal_timezone','management_archived_at','management_archived_by','management_archive_reason','updated_at'] order by id) from reporting_machines m where id::text like 'aa181503-%') machines;
create function pg_temp.execute_join(p jsonb,confirmed boolean default true) returns jsonb language sql as $$
 select public.admin_join_same_physical_machine_reader((p->>'machineId')::uuid,(p->>'inventoryId')::uuid,
 (p->>'expectedMachineUpdatedAt')::timestamptz,(p->>'historicalMachineId')::uuid,
 (p->>'expectedHistoricalMachineUpdatedAt')::timestamptz,(p->>'expectedInventoryUpdatedAt')::timestamptz,
 p->>'expectedSourceIdentityDigest',confirmed,'Explicitly confirmed same physical machine correction'); $$;
grant select on join_before to authenticated;
-- Invalid seed variants are isolated subtransactions. Candidate inspection and
-- every join writer still execute with the real origin trigger stack.
create function pg_temp.join_candidate_rejects(mutation text) returns boolean language plpgsql as $$
declare rejected boolean;
begin
  execute 'set local session_replication_role=replica';
  execute mutation;
  execute 'set local session_replication_role=origin';
  rejected:=private.same_physical_reader_join_blocker('aa181503-0000-4000-8000-000000000001','aa181504-0000-4000-8000-000000000001') is not null;
  raise exception '%',case when rejected then 'rejected' else 'admitted' end using errcode='P1815';
exception when sqlstate 'P1815' then return sqlerrm='rejected';
end $$;
select ok(pg_temp.join_candidate_rejects($$update reporting_machines set status='inactive' where id='aa181503-0000-4000-8000-000000000002'$$),'Inactive historical machine cannot be joined');
select ok(pg_temp.join_candidate_rejects($$update reporting_machines set status='inactive' where id='aa181503-0000-4000-8000-000000000001'$$),'Inactive current source machine cannot be joined');
select ok(pg_temp.join_candidate_rejects($$update refund_nayax_machine_inventory set provider_is_active=false where id='aa181504-0000-4000-8000-000000000001'$$),'Inactive provider reader cannot be joined');
select ok(pg_temp.join_candidate_rejects($$update refund_nayax_machine_inventory set missing_successful_snapshots=2 where id='aa181504-0000-4000-8000-000000000001'$$),'Stale missing reader snapshots cannot be joined');
select ok(pg_temp.join_candidate_rejects($$update reporting_locations set timezone='America/Los_Angeles' where id='aa181502-0000-4000-8000-000000000002'$$),'Different saved time zones require review');
select ok(pg_temp.join_candidate_rejects($$update reporting_machines set machine_type='commercial' where id='aa181503-0000-4000-8000-000000000002'$$),'Different saved machine families cannot be joined');
select ok(pg_temp.join_candidate_rejects($$update reporting_machines set sunze_machine_id='another-real-source' where id='aa181503-0000-4000-8000-000000000002'$$),'A reader owned by another source is a real reconciliation, not a duplicate join');
select ok(pg_temp.join_candidate_rejects($$update private.snapcase_source_machines set catalogue_inactive_at=now() where source_machine_id='fixture-1815-capital'$$),'Inactive imported source cannot be joined');
select ok(pg_temp.join_candidate_rejects($$insert into private.snapcase_machine_mappings(provider_account_id,source_machine_id,reporting_machine_id,effective_start_date,mapping_reason) values('aa181505-0000-4000-8000-000000000001','fixture-1815-capital','aa181503-0000-4000-8000-000000000003','2025-01-02','Synthetic contradictory source owner')$$),'Conflicting current Kex source owners cannot be joined');
select ok(pg_temp.join_candidate_rejects($$delete from private.snapcase_machine_mappings where reporting_machine_id='aa181503-0000-4000-8000-000000000001'; update reporting_machines set sunze_machine_id='1815-conflicting-sunze' where id='aa181503-0000-4000-8000-000000000001'; insert into sunze_machine_discoveries(sunze_machine_id,sunze_machine_name,status,reporting_machine_id) values('1815-conflicting-sunze','Conflicting discovery','mapped','aa181503-0000-4000-8000-000000000003')$$),'Conflicting Sunze discovery owner cannot be joined');
select ok(pg_temp.join_candidate_rejects($$insert into private.machine_nayax_reader_associations(account_key,nayax_machine_id,reporting_machine_id,effective_from,effective_from_date,effective_timezone,ownership_basis,created_by,reason) values('TGPACI_USA_DB','18150001','aa181503-0000-4000-8000-000000000002','2026-01-01T00:00Z','2025-12-31','America/New_York','reviewed_physical_reader_change','aa181500-0000-4000-8000-000000000001','Real reviewed physical history')$$),'Prior dated reader history cannot be bypassed with duplicate correction');
select ok(pg_temp.join_candidate_rejects($$update machine_sales_facts set reporting_machine_id='aa181503-0000-4000-8000-000000000003' where source_row_hash='1815-card-row-1'$$),'Third retained transaction owner cannot be silently displaced');
select set_config('request.jwt.claim.sub','aa181500-0000-4000-8000-000000000003',true);
set local role authenticated;
select throws_ok($$select public.admin_preview_same_physical_machine_reader_join('aa181503-0000-4000-8000-000000000001','aa181504-0000-4000-8000-000000000001')$$,'42501',null,'Unrelated Manager cannot inspect or join another machine');
select throws_ok($$select public.admin_join_same_physical_machine_reader('aa181503-0000-4000-8000-000000000001','aa181504-0000-4000-8000-000000000001',now(),'aa181503-0000-4000-8000-000000000002',now(),now(),'fake',true,'Unauthorized same physical join')$$,'42501',null,'Unrelated Manager cannot execute the join');
reset role;
select set_config('request.jwt.claim.sub','aa181500-0000-4000-8000-000000000001',true);
create temporary table join_preview as select public.admin_preview_same_physical_machine_reader_join('aa181503-0000-4000-8000-000000000001','aa181504-0000-4000-8000-000000000001') p;
grant select on join_preview to authenticated;
set local role authenticated;
select ok((select (p->>'eligible')::boolean from join_preview),'Already source-bound exact pair can be explicitly confirmed');
select is((select (p->>'historicalCardTransactionCount')::int from join_preview),317,'Preview reports all 317 retained historical facts');
select throws_ok($$select pg_temp.execute_join((select p from join_preview),false)$$,'22023',null,'No join without explicit same-machine intent');
select throws_ok($$select pg_temp.execute_join((select p||'{"expectedMachineUpdatedAt":"2020-01-01"}'::jsonb from join_preview))$$,'40001',null,'Stale current machine snapshot rejects');
select throws_ok($$select pg_temp.execute_join((select p||'{"expectedInventoryUpdatedAt":"2020-01-01"}'::jsonb from join_preview))$$,'40001',null,'Stale exact reader snapshot rejects');
select throws_ok($$select pg_temp.execute_join((select p||'{"expectedHistoricalMachineUpdatedAt":"2020-01-01"}'::jsonb from join_preview))$$,'40001',null,'Stale historical owner snapshot rejects');
select throws_ok($$select pg_temp.execute_join((select p||'{"expectedSourceIdentityDigest":"stale"}'::jsonb from join_preview))$$,'40001',null,'Stale imported source connection rejects');
select lives_ok($$select pg_temp.execute_join((select p from join_preview))$$,'One confirmation connects the current source machine without a physical move date');
select throws_ok($$select pg_temp.execute_join((select p from join_preview))$$,'40001',null,'Repeated stale save cannot create a second association');
reset role;
select is((select jsonb_agg(to_jsonb(f) order by id) from machine_sales_facts f where source_row_hash like '1815-%'),(select facts from join_before),'All 67 cash and 317 card fact UUIDs, amounts and original ownership remain byte-identical');
select is((select to_jsonb(c) from refund_cases c where id='aa181506-0000-4000-8000-000000000001'),(select refund_case from join_before),'Denied rough-time case retains original UUID, location and routing');
select is((select jsonb_agg(to_jsonb(k) order by id) from private.snapcase_machine_mappings k where provider_account_id='aa181505-0000-4000-8000-000000000001'),(select source_mapping from join_before),'Original source mapping and financial date window are unchanged');
select is((select jsonb_agg(to_jsonb(m) order by reporting_machine_id,manager_user_id) from reporting_machine_refund_managers m where reporting_machine_id::text like 'aa181503-%'),(select managers from join_before),'No Manager ownership union or access transfer');
select is((select jsonb_agg(to_jsonb(a) order by id) from reporting_machine_partnership_assignments a where machine_id::text like 'aa181503-%'),(select assignments from join_before),'No historical partnership reassignment');
select is((select jsonb_agg(to_jsonb(m)-array['nayax_machine_id','nayax_account_key','nayax_manual_portal_enabled','nayax_manual_account_scope','nayax_manual_portal_timezone','management_archived_at','management_archived_by','management_archive_reason','updated_at'] order by id) from reporting_machines m where id::text like 'aa181503-%'),(select machines from join_before),'Names, companies, sites, operating states, payment capabilities and historical card authority stay unchanged');
select ok((select management_archived_at is not null and status='active' from reporting_machines where id='aa181503-0000-4000-8000-000000000002'),'Duplicate retires only from management; financial operating record remains');
select is((select jsonb_agg(to_jsonb(c) order by booking_date,tender) from private.machine_sales_daily_components('aa181503-0000-4000-8000-000000000001','2026-09-01','2026-09-30') c),(select cash_components from join_before),'Current company retains the same 67-cash financial report components');
select is((select jsonb_agg(to_jsonb(c) order by booking_date,tender) from private.machine_sales_daily_components('aa181503-0000-4000-8000-000000000002','2026-09-01','2026-09-30') c),(select card_components from join_before),'Archived historical owner retains the same 317-card financial report components and original tax');
select is((select sum(net_sales_cents) from private.financial_machine_sales_facts where reporting_machine_id='aa181503-0000-4000-8000-000000000002'),63400::bigint,'Historical-company 317-card ledger remains financially included after archive');
select is((select sum(net_sales_cents) from private.financial_machine_sales_facts where reporting_machine_id='aa181503-0000-4000-8000-000000000001'),6700::bigint,'Current-company 67-cash ledger remains financially included once');
select is(public.service_refund_case_reader_identity('aa181506-0000-4000-8000-000000000001','aa181503-0000-4000-8000-000000000002')->>'readerId','18150001','Unmatched rough-time former case retains the same attested reader without loosening a new replacement');
select ok(not exists(select 1 from private.machine_nayax_reader_associations where reporting_machine_id::text like 'aa181503-%' and (effective_from is not null or effective_until is not null or effective_from_date is not null or closed_on is not null)),'Administrative correction creates no invented physical date or interval');
select ok(private.same_physical_reader_legacy_owner('aa181503-0000-4000-8000-000000000001','TGPACI_USA_DB','18150001','aa181503-0000-4000-8000-000000000002'),'Saved current machine recognizes only the exact attested historical owner');
select ok(not private.same_physical_reader_legacy_owner('aa181503-0000-4000-8000-000000000001','OTHER_ACCOUNT','18150001','aa181503-0000-4000-8000-000000000002'),'Another provider account cannot borrow the historical-owner exception');
select is(private.resolve_machine_reader_purchase_owner('TGPACI_USA_DB','18150001',now()),'aa181503-0000-4000-8000-000000000001'::uuid,'New unseen card purchases resolve to the user-selected source machine');
select is((select reporting_machine_id from machine_sales_facts where source_row_hash='1815-card-row-1'),'aa181503-0000-4000-8000-000000000002'::uuid,'Existing immutable card-order match keeps its historical owner ahead of current reader configuration');
select set_config('request.jwt.claim.sub','aa181500-0000-4000-8000-000000000001',true);
set local role authenticated;
select lives_ok($$select public.admin_save_machine_workspace_mapping('aa181503-0000-4000-8000-000000000001','', 'aa181504-0000-4000-8000-000000000001','18150001','TGPACI_USA_DB',null)$$,'Ordinary exact-reader re-save accepts only the reviewed same-machine legacy ownership');
reset role;
-- Original transaction evidence must continue to outrank the administrative tuple.
set local session_replication_role=replica;
update refund_cases set matched_sales_fact_id=(select id from machine_sales_facts where source_row_hash='1815-card-row-1'),matched_nayax_transaction_id='1815-transaction-1' where id='aa181506-0000-4000-8000-000000000001';
set local session_replication_role=origin;
select is(public.service_refund_case_reader_identity('aa181506-0000-4000-8000-000000000001','aa181503-0000-4000-8000-000000000002')->>'basis','matched_original_transaction','Matched original transaction retains first priority');
set local session_replication_role=replica;
update refund_cases set matched_nayax_transaction_id='different-transaction' where id='aa181506-0000-4000-8000-000000000001';
set local session_replication_role=origin;
select is(public.service_refund_case_reader_identity('aa181506-0000-4000-8000-000000000001','aa181503-0000-4000-8000-000000000002')->>'basis','original_transaction_conflict','Conflicting original transaction cannot use same-machine fallback');
set local session_replication_role=replica;
update refund_cases set matched_sales_fact_id=null,matched_nayax_transaction_id=null where id='aa181506-0000-4000-8000-000000000001';
insert into private.machine_nayax_reader_associations(account_key,nayax_machine_id,reporting_machine_id,ownership_basis,created_by,reason)
 values('TGPACI_USA_DB','18150002','aa181503-0000-4000-8000-000000000002','same_physical_machine_all_history','aa181500-0000-4000-8000-000000000001','Different hardware history cannot use duplicate fallback');
set local session_replication_role=origin;
select is(public.service_refund_case_reader_identity('aa181506-0000-4000-8000-000000000001','aa181503-0000-4000-8000-000000000002')->>'readerId',null::text,'Multiple historical readers cannot use the single duplicate-reader fallback');
select throws_ok($$select public.service_refund_case_reader_identity('aa181506-0000-4000-8000-000000000001','aa181503-0000-4000-8000-000000000003')$$,'22023',null,'Unrelated machine cannot adopt the retained case');
create temporary table sunze_join_before as select
 (select jsonb_agg(to_jsonb(f) order by id) from machine_sales_facts f where source_row_hash like '1815-sunze-%') facts,
 (select to_jsonb(d) from sunze_machine_discoveries d where sunze_machine_id='1815-sunze-current') discovery,
 (select jsonb_agg(to_jsonb(c) order by booking_date,tender) from private.machine_sales_daily_components('aa181503-0000-4000-8000-000000000004','2026-09-01','2026-09-30') c) source_components,
 (select jsonb_agg(to_jsonb(c) order by booking_date,tender) from private.machine_sales_daily_components('aa181503-0000-4000-8000-000000000005','2026-09-01','2026-09-30') c) card_components;
create temporary table sunze_join_preview as select public.admin_preview_same_physical_machine_reader_join('aa181503-0000-4000-8000-000000000004','aa181504-0000-4000-8000-000000000002') p;
grant select on sunze_join_preview to authenticated;
set local role authenticated;
select ok((select (p->>'eligible')::boolean from sunze_join_preview),'An already-bound Sunze/cotton-candy source has the same correction flow');
select lives_ok($$select pg_temp.execute_join((select p from sunze_join_preview))$$,'Authenticated Sunze correction uses the canonical writer without a physical move date');
reset role;
select is((select jsonb_agg(to_jsonb(f) order by id) from machine_sales_facts f where source_row_hash like '1815-sunze-%'),(select facts from sunze_join_before),'Sunze cash, observed app-card and historical native-card facts are byte-identical without replay');
select is((select to_jsonb(d) from sunze_machine_discoveries d where sunze_machine_id='1815-sunze-current'),(select discovery from sunze_join_before),'Sunze current discovery identity stays attached to the chosen machine');
select is((select jsonb_agg(to_jsonb(c) order by booking_date,tender) from private.machine_sales_daily_components('aa181503-0000-4000-8000-000000000004','2026-09-01','2026-09-30') c),(select source_components from sunze_join_before),'Sunze source cash/app-card financial components remain included once under the current company');
select is((select jsonb_agg(to_jsonb(c) order by booking_date,tender) from private.machine_sales_daily_components('aa181503-0000-4000-8000-000000000005','2026-09-01','2026-09-30') c),(select card_components from sunze_join_before),'Sunze retired reader historical card components retain their original company and totals');
select is(public.service_refund_case_reader_identity('aa181506-0000-4000-8000-000000000002','aa181503-0000-4000-8000-000000000005')->>'readerId','18150003','Sunze historical refund case keeps the original reader after correction');
select is(private.resolve_machine_reader_purchase_owner('TGPACI_USA_DB','18150003',now()),'aa181503-0000-4000-8000-000000000004'::uuid,'Sunze future native-card purchases resolve only to the current source machine');
select * from finish();
rollback;
