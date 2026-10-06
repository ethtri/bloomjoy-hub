begin;
create extension if not exists pgtap with schema extensions;
set local search_path=public,extensions;
set local timezone='UTC';
select no_plan();
-- Synthetic seed only; every API action runs with origin triggers and actual roles.
set local session_replication_role=replica;
insert into auth.users(id,email) values
 ('aa180200-0000-4000-8000-000000000001','complete-admin@example.invalid'),
 ('aa180200-0000-4000-8000-000000000002','complete-outsider@example.invalid');
insert into admin_roles(user_id,role,active) values('aa180200-0000-4000-8000-000000000001','super_admin',true);
insert into customer_accounts(id,name) values('aa180201-0000-4000-8000-000000000001','Complete mapping company');
insert into reporting_locations(id,account_id,name,timezone) values
 ('aa180202-0000-4000-8000-000000000001','aa180201-0000-4000-8000-000000000001','Saved source site','America/Los_Angeles');
insert into reporting_machines(id,account_id,location_id,machine_label,machine_type,nayax_machine_id,nayax_account_key,sunze_machine_id,nayax_card_sales_started_on) values
 ('aa180203-0000-4000-8000-000000000001','aa180201-0000-4000-8000-000000000001','aa180202-0000-4000-8000-000000000001','Existing cotton cabinet','commercial','18020001','TGPACI_USA_DB',null,null),
 ('aa180203-0000-4000-8000-000000000002','aa180201-0000-4000-8000-000000000001','aa180202-0000-4000-8000-000000000001','Existing case cabinet','commercial','18020002','TGPACI_USA_DB',null,null),
 ('aa180203-0000-4000-8000-000000000003','aa180201-0000-4000-8000-000000000001','aa180202-0000-4000-8000-000000000001','Counted legacy source cabinet','commercial',null,null,'complete-existing-source',null),
 ('aa180203-0000-4000-8000-000000000004','aa180201-0000-4000-8000-000000000001','aa180202-0000-4000-8000-000000000001','Existing dated authority','commercial','18020004','TGPACI_USA_DB','complete-dated-source','2025-01-01');
insert into reporting_machines(id,account_id,location_id,machine_label,machine_type,nayax_machine_id,nayax_account_key) values
 ('aa180203-0000-4000-8000-000000000005','aa180201-0000-4000-8000-000000000001','aa180202-0000-4000-8000-000000000001','Rollback existing cabinet','commercial','18020006','TGPACI_USA_DB');
insert into refund_nayax_machine_inventory(id,account_key,nayax_machine_id,machine_name,provider_is_active,reporting_machine_id,reconciliation_state,refund_category) values
 ('aa180204-0000-4000-8000-000000000001','TGPACI_USA_DB','18020001','Existing cotton reader',true,'aa180203-0000-4000-8000-000000000001','published','cotton_candy'),
 ('aa180204-0000-4000-8000-000000000002','TGPACI_USA_DB','18020002','Existing case reader',true,'aa180203-0000-4000-8000-000000000002','needs_setup','snapcase'),
 ('aa180204-0000-4000-8000-000000000003','TGPACI_USA_DB','18020003','First legacy-source reader',true,null,'needs_setup','cotton_candy'),
 ('aa180204-0000-4000-8000-000000000004','TGPACI_USA_DB','18020004','Dated authority reader',true,'aa180203-0000-4000-8000-000000000004','published','cotton_candy'),
 ('aa180204-0000-4000-8000-000000000005','TGPACI_USA_DB','18020005','Free imported reader',true,null,'needs_setup','cotton_candy');
insert into refund_nayax_machine_inventory(id,account_key,nayax_machine_id,machine_name,provider_is_active,reporting_machine_id,reconciliation_state,refund_category) values
 ('aa180204-0000-4000-8000-000000000006','TGPACI_USA_DB','18020006','Rollback existing reader',true,'aa180203-0000-4000-8000-000000000005','published','cotton_candy');
insert into sunze_machine_discoveries(sunze_machine_id,sunze_machine_name,status,reporting_machine_id) values
 ('complete-unbound-cotton','Imported app cotton name','pending',null),
 ('complete-free-cotton','Imported free cotton name','pending',null),
 ('complete-existing-source','Counted source app name','mapped','aa180203-0000-4000-8000-000000000003'),
 ('complete-dated-source','Actual dated app name','mapped','aa180203-0000-4000-8000-000000000004');
insert into sunze_machine_discoveries(sunze_machine_id,sunze_machine_name,status) values('complete-rollback-source','Rollback imported name','pending');
insert into sunze_unmapped_sales(sunze_machine_id,source_order_hash,source_row_hash,sale_date,payment_method,net_sales_cents,transaction_count,raw_payload) values
 ('complete-unbound-cotton',repeat('1',64),repeat('2',64),'2025-01-01','credit',900,1,'{"order_amount_cents":900,"item_quantity":2,"tax_cents":90,"machine_code":"complete-unbound-cotton","payment_method_source":"Credit card"}'),
 ('complete-unbound-cotton',repeat('3',64),repeat('4',64),'2025-01-01','cash',400,1,'{"order_amount_cents":400,"item_quantity":1,"tax_cents":0,"machine_code":"complete-unbound-cotton","payment_method_source":"Coin + Notes"}'),
 ('complete-unbound-cotton',repeat('5',64),repeat('6',64),'2025-01-01','other',0,1,'{"order_amount_cents":0,"item_quantity":1,"machine_code":"complete-unbound-cotton","payment_method_source":"No-Pay"}'),
 ('complete-free-cotton',repeat('7',64),repeat('8',64),'2025-01-01','credit',500,1,'{"order_amount_cents":500,"item_quantity":1,"machine_code":"complete-free-cotton"}');
insert into sunze_unmapped_sales(sunze_machine_id,source_order_hash,source_row_hash,sale_date,payment_method,net_sales_cents,transaction_count,raw_payload) values
 ('complete-rollback-source',repeat('e',64),repeat('f',64),'2025-01-01','credit',600,1,'{"order_amount_cents":600,"machine_code":"complete-rollback-source"}');
insert into private.snapcase_provider_accounts(id,source_account_key) values
 ('aa180205-0000-4000-8000-000000000001','complete-account-a'),
 ('aa180205-0000-4000-8000-000000000002','complete-account-b');
insert into private.snapcase_source_machines(provider_account_id,source_machine_id,source_label,source_timezone) values
 ('aa180205-0000-4000-8000-000000000001','complete-case','Imported case app name','America/Los_Angeles'),
 ('aa180205-0000-4000-8000-000000000002','complete-case','Other account same source ID','America/Los_Angeles');
insert into machine_sales_facts(id,reporting_machine_id,reporting_location_id,sale_date,payment_method,net_sales_cents,transaction_count,item_quantity,tax_cents,source,source_order_hash,source_row_hash,raw_payload) values
 ('aa180206-0000-4000-8000-000000000001','aa180203-0000-4000-8000-000000000001','aa180202-0000-4000-8000-000000000001','2025-01-01','credit',1200,2,2,100,'nayax_scheduled_report',repeat('a',64),'complete-nayax-original','{"amountBasis":"separate_tax","providerMachineId":"18020001","_salesAuthorityOriginal":{"netSalesCents":1200,"transactionCount":2,"itemQuantity":2,"taxCents":100}}'),
 ('aa180206-0000-4000-8000-000000000002','aa180203-0000-4000-8000-000000000002','aa180202-0000-4000-8000-000000000001','2025-01-01','credit',800,1,1,0,'nayax_scheduled_report',repeat('b',64),'complete-case-original','{"amountBasis":"tax_exclusive","providerMachineId":"18020002"}'),
 ('aa180206-0000-4000-8000-000000000003','aa180203-0000-4000-8000-000000000003','aa180202-0000-4000-8000-000000000001','2025-01-01','credit',1000,1,3,0,'sunze_browser',repeat('c',64),'complete-inherited-original','{"order_amount_cents":1000,"item_quantity":3,"amountBasis":"tax_exclusive"}');
insert into reporting_machine_refund_managers(reporting_machine_id,manager_user_id,manager_email,status) values
 ('aa180203-0000-4000-8000-000000000001','aa180200-0000-4000-8000-000000000001','complete-admin@example.invalid','active');
insert into refund_machine_qr_codes(reporting_machine_id,public_code,version) values('aa180203-0000-4000-8000-000000000001',repeat('8',32),1);
insert into reporting_partnerships(id,name,partnership_type,reporting_week_end_day,timezone,effective_start_date,effective_end_date,status) values
 ('aa180207-0000-4000-8000-000000000001','Complete mapping per-stick partner','revenue_share',0,'America/Los_Angeles','2025-01-01','2025-01-31','active');
insert into reporting_machine_partnership_assignments(machine_id,partnership_id,assignment_role,effective_start_date,effective_end_date,status) values
 ('aa180203-0000-4000-8000-000000000001','aa180207-0000-4000-8000-000000000001','primary_reporting','2025-01-01','2025-01-31','active');
insert into reporting_partnership_financial_rules(partnership_id,calculation_model,split_base,fee_amount_cents,fee_basis,cost_amount_cents,cost_basis,deduction_timing,gross_to_net_method,fever_share_basis_points,partner_share_basis_points,bloomjoy_share_basis_points,effective_start_date,effective_end_date,status) values
 ('aa180207-0000-4000-8000-000000000001','contribution_split','contribution_after_costs',100,'per_order',200,'per_stick','before_split','imported_tax_plus_configured_fees',0,10000,0,'2025-01-01','2025-01-31','active');
create temporary table complete_before as select
 (select jsonb_agg(to_jsonb(f) order by id) from machine_sales_facts f where id::text like 'aa180206-%') facts,
 (select jsonb_agg(jsonb_build_object('id',id,'accountId',account_id,'locationId',location_id,'name',machine_label,'type',machine_type,'reader',nayax_machine_id,'readerAccount',nayax_account_key) order by id) from reporting_machines where id in('aa180203-0000-4000-8000-000000000001','aa180203-0000-4000-8000-000000000002')) configuration,
 (select jsonb_agg(to_jsonb(p) order by id) from sunze_unmapped_sales p where sunze_machine_id='complete-unbound-cotton') pending,
 (select jsonb_agg(to_jsonb(m) order by reporting_machine_id,manager_user_id) from reporting_machine_refund_managers m where reporting_machine_id='aa180203-0000-4000-8000-000000000001') managers,
 (select jsonb_agg(to_jsonb(q) order by id) from refund_machine_qr_codes q where reporting_machine_id='aa180203-0000-4000-8000-000000000001') qr,
 (select to_jsonb(m) from reporting_machines m where id='aa180203-0000-4000-8000-000000000004') dated,
 (select count(*) from reporting_machines) machine_count;
create temporary table complete_expected as select id,updated_at from reporting_machines where id::text like 'aa180203-%';
grant select on complete_before,complete_expected to authenticated;
set local session_replication_role=origin;
select ok(not has_table_privilege('authenticated','private.machine_card_financial_policies','INSERT'),'Clients cannot create financial policy metadata directly');
select ok(not has_table_privilege('authenticated','private.machine_preserved_source_card_facts','INSERT'),'Clients cannot fabricate inherited financial eligibility');
select set_config('request.jwt.claim.sub','aa180200-0000-4000-8000-000000000002',true);
set local role authenticated;
select throws_ok($$select admin_reuse_imported_source_machine('Sunze',null,'complete-unbound-cotton','aa180204-0000-4000-8000-000000000001','aa180203-0000-4000-8000-000000000001',(select updated_at from complete_expected where id='aa180203-0000-4000-8000-000000000001'),'America/Los_Angeles','Unauthorized source attachment')$$,'42501',null,'Outsider cannot complete a legacy source association');
reset role;
select is((select count(*) from private.machine_card_financial_policies),0::bigint,'Unauthorized attempt creates no financial policy');
select set_config('request.jwt.claim.sub','aa180200-0000-4000-8000-000000000001',true);
set local role authenticated;
select throws_ok($$select admin_reuse_imported_source_machine('Sunze',null,'complete-unbound-cotton','aa180204-0000-4000-8000-000000000001','aa180203-0000-4000-8000-000000000001',(select updated_at from complete_expected where id='aa180203-0000-4000-8000-000000000001'),'America/New_York','Wrong reviewed source zone')$$,'40001',null,'Stale reviewed site does not attach or activate policy');
select lives_ok($$select admin_reuse_imported_source_machine('Sunze',null,'complete-unbound-cotton','aa180204-0000-4000-8000-000000000001','aa180203-0000-4000-8000-000000000001',(select updated_at from complete_expected where id='aa180203-0000-4000-8000-000000000001'),'America/Los_Angeles','Owner confirmed same physical cotton cabinet throughout')$$,'Sunze legacy association completes in one save');
select lives_ok($$select admin_reuse_imported_source_machine('Kexiaozhan','aa180205-0000-4000-8000-000000000001','complete-case','aa180204-0000-4000-8000-000000000002','aa180203-0000-4000-8000-000000000002',(select updated_at from complete_expected where id='aa180203-0000-4000-8000-000000000002'),'America/Los_Angeles','Owner confirmed same physical case cabinet throughout')$$,'Kexiaozhan legacy association completes in one save');
select lives_ok($$select admin_save_machine_workspace_mapping('aa180203-0000-4000-8000-000000000003',null,'aa180204-0000-4000-8000-000000000003',null,null,null)$$,'Existing counted source may select its first reader without losing history');
reset role;
select lives_ok($$set constraints source_management_association_completed immediate$$,'Both completed provider associations satisfy the actual deferred commit guard');
set constraints source_management_association_completed deferred;
select is((select count(*) from reporting_machines),(select machine_count from complete_before),'Legacy reuse creates no duplicate Hub');
select is((select jsonb_agg(to_jsonb(f) order by id) from machine_sales_facts f where id::text like 'aa180206-%'),(select facts from complete_before),'All original Nayax and inherited source facts remain byte-identical');
select is((select jsonb_agg(jsonb_build_object('id',id,'accountId',account_id,'locationId',location_id,'name',machine_label,'type',machine_type,'reader',nayax_machine_id,'readerAccount',nayax_account_key) order by id) from reporting_machines where id in('aa180203-0000-4000-8000-000000000001','aa180203-0000-4000-8000-000000000002')),(select configuration from complete_before),'Both provider adapters preserve canonical machine configuration and reader');
select is((select sunze_machine_id from reporting_machines where id='aa180203-0000-4000-8000-000000000001'),'complete-unbound-cotton','Sunze association is canonical, not a management-only pending state');
select ok(exists(select 1 from private.snapcase_machine_mappings where provider_account_id='aa180205-0000-4000-8000-000000000001' and source_machine_id='complete-case' and reporting_machine_id='aa180203-0000-4000-8000-000000000002'),'Kex source maps to the same actual Hub');
select is((select machine_type from reporting_machines where id='aa180203-0000-4000-8000-000000000002'),'commercial','Kex legacy Nayax-bound cabinet retains its existing taxonomy/configuration under shared eligibility');
select ok(not exists(select 1 from private.snapcase_machine_mappings where provider_account_id='aa180205-0000-4000-8000-000000000002' and source_machine_id='complete-case'),'Same Kex source ID in another account is not taken');
select ok(not exists(select 1 from reporting_machines where id in('aa180203-0000-4000-8000-000000000001','aa180203-0000-4000-8000-000000000002','aa180203-0000-4000-8000-000000000003') and nayax_card_sales_started_on is not null),'Ordinary same-machine mapping invents no sales start date');
select is((select jsonb_agg(to_jsonb(m) order by reporting_machine_id,manager_user_id) from reporting_machine_refund_managers m where reporting_machine_id='aa180203-0000-4000-8000-000000000001'),(select managers from complete_before),'Existing managers remain byte-identical');
select is((select jsonb_agg(to_jsonb(q) order by id) from refund_machine_qr_codes q where reporting_machine_id='aa180203-0000-4000-8000-000000000001'),(select qr from complete_before),'Existing QR identity remains byte-identical');
select is((select to_jsonb(m) from reporting_machines m where id='aa180203-0000-4000-8000-000000000004'),(select dated from complete_before),'Unrelated dated authority machine is byte-identical');
select ok(not exists(select 1 from private.machine_card_financial_policies where reporting_machine_id='aa180203-0000-4000-8000-000000000004'),'Dated authority stays in its existing legacy mode');
select results_eq($$select sum(net_sales_cents)::bigint,sum(transaction_count)::bigint,sum(item_quantity)::bigint,sum(tax_cents)::bigint from private.financial_machine_sales_facts where reporting_machine_id='aa180203-0000-4000-8000-000000000001' and net_sales_cents>0$$,$$ values (1600::bigint,3::bigint,3::bigint,100::bigint)$$,'Card money and cash count once; app-card tax/counts/items cannot duplicate financial inputs');
select is((select count(*) from private.machine_preserved_source_card_facts where reporting_machine_id='aa180203-0000-4000-8000-000000000001'),0::bigint,'Newly promoted pending app-card history is not fabricated inherited eligibility');
select ok(exists(select 1 from private.machine_preserved_source_card_facts where fact_id='aa180206-0000-4000-8000-000000000003' and reporting_machine_id='aa180203-0000-4000-8000-000000000003'),'Exact already-counted source fact retains inherited eligibility');
select is((select net_sales_cents from private.financial_machine_sales_facts where id='aa180206-0000-4000-8000-000000000003'),1000,'First reader selection preserves prior reported source money');
select lives_ok($$insert into machine_sales_facts(reporting_machine_id,reporting_location_id,sale_date,payment_method,net_sales_cents,transaction_count,item_quantity,tax_cents,source,source_order_hash,source_row_hash,raw_payload) values('aa180203-0000-4000-8000-000000000003','aa180202-0000-4000-8000-000000000001','2025-01-02','credit',700,1,2,70,'sunze_browser',repeat('d',64),'complete-later-app-card','{"order_amount_cents":700}')$$,'A later app-card import retains its original observation');
select ok(not exists(select 1 from private.financial_machine_sales_facts where source_row_hash='complete-later-app-card'),'Later app card is operational-only despite positive source money');
select is((select net_sales_cents from machine_sales_facts where source_row_hash='complete-later-app-card'),700,'Operational-only eligibility never destroys raw source money');
select set_config('request.jwt.claim.role','authenticated',true);
select set_config('request.jwt.claim.sub','aa180200-0000-4000-8000-000000000001',true);
select results_eq($$select (preview#>>'{summary,gross_sales_cents}')::int,(preview#>>'{summary,order_count}')::int,(preview#>>'{summary,item_quantity}')::int,(preview#>>'{summary,tax_cents}')::int,(preview#>>'{summary,fee_cents}')::int,(preview#>>'{summary,cost_cents}')::int,(preview#>>'{summary,amount_owed_cents}')::int from (select public.admin_preview_partner_period_report_internal('aa180207-0000-4000-8000-000000000001','2025-01-01','2025-01-31','calendar_month') preview) report$$,$$ values (1600,3,3,100,300,600,600)$$,'Actual partner recorded gross minus original tax, per-order fees and per-stick costs excludes operational app-card transactions and units');
-- Normal initial setup establishes its policy BEFORE any pending promotion.
create temporary table complete_free_result(machine_id uuid);
grant select,insert on complete_free_result to authenticated;
set local role authenticated;
select lives_ok($$insert into complete_free_result select (public.admin_setup_imported_machine('Sunze',null,'complete-free-cotton','aa180201-0000-4000-8000-000000000001','New chosen machine name','commercial','setup','America/Los_Angeles','aa180204-0000-4000-8000-000000000005',array[]::text[],'Reviewed imported machine initial setup')->>'machineId')::uuid$$,'Free imported source and reader complete in one ordinary save');
reset role;
select is((select count(*) from reporting_machines where sunze_machine_id='complete-free-cotton'),1::bigint,'Initial setup creates one canonical source-backed Hub');
select ok(exists(select 1 from private.machine_card_financial_policies where reporting_machine_id=(select machine_id from complete_free_result)),'Initial setup establishes automatic channel policy');
select ok(not exists(select 1 from private.machine_preserved_source_card_facts where reporting_machine_id=(select machine_id from complete_free_result)),'Initial pending card orders are not incorrectly grandfathered as already-counted history');
select is((select sum(net_sales_cents) from machine_sales_facts where reporting_machine_id=(select machine_id from complete_free_result)),500::bigint,'Initial source evidence is preserved at its original amount');
select is((select count(*) from private.financial_machine_sales_facts where reporting_machine_id=(select machine_id from complete_free_result)),0::bigint,'Absent Nayax card feed is not silently replaced with provider card money');
select ok((public.admin_get_machine_source_inventory()->'sources') @> '[{"sourceId":"complete-free-cotton","salesActivationPending":false}]','A completed initial source save has no separate engineering activation step');
-- Fail at the final canonical audit, AFTER policy, source update and promotion.
create temporary table complete_rollback_before as select
 (select to_jsonb(m) from reporting_machines m where id='aa180203-0000-4000-8000-000000000005') machine,
 (select jsonb_agg(to_jsonb(p) order by id) from sunze_unmapped_sales p where sunze_machine_id='complete-rollback-source') pending,
 (select to_jsonb(d) from sunze_machine_discoveries d where sunze_machine_id='complete-rollback-source') discovery,
 (select count(*) from admin_audit_log) audits;
create function pg_temp.fail_complete_source_audit() returns trigger language plpgsql as $$begin if new.action='reporting_machine.source_management_associated' and new.entity_id='aa180203-0000-4000-8000-000000000005' then raise exception 'Synthetic completed-source late audit failure' using errcode='P0001'; end if; return new; end$$;
create trigger complete_source_late_audit before insert on admin_audit_log for each row execute function pg_temp.fail_complete_source_audit();
set local role authenticated;
select throws_ok($$select admin_reuse_imported_source_machine('Sunze',null,'complete-rollback-source','aa180204-0000-4000-8000-000000000006','aa180203-0000-4000-8000-000000000005',(select updated_at from complete_expected where id='aa180203-0000-4000-8000-000000000005'),'America/Los_Angeles','Synthetic completed-source rollback')$$,'P0001','Synthetic completed-source late audit failure','Late audit failure rolls back completed source association and policy atomically');
reset role;
drop trigger complete_source_late_audit on admin_audit_log;
select is((select to_jsonb(m) from reporting_machines m where id='aa180203-0000-4000-8000-000000000005'),(select machine from complete_rollback_before),'Rejected final audit preserves complete original Hub bytes');
select is((select jsonb_agg(to_jsonb(p) order by id) from sunze_unmapped_sales p where sunze_machine_id='complete-rollback-source'),(select pending from complete_rollback_before),'Rejected final audit rolls back every pending promotion');
select is((select to_jsonb(d) from sunze_machine_discoveries d where sunze_machine_id='complete-rollback-source'),(select discovery from complete_rollback_before),'Rejected final audit preserves discovery state');
select is((select count(*) from admin_audit_log),(select audits from complete_rollback_before),'Rejected final audit commits no partial policy or identity audit');
select ok(not exists(select 1 from private.machine_card_financial_policies where reporting_machine_id='aa180203-0000-4000-8000-000000000005'),'Rejected final audit leaves no partial financial policy');
select ok(not exists(select 1 from private.machine_source_management_associations where reporting_machine_id='aa180203-0000-4000-8000-000000000005'),'Rejected final audit leaves no partial source association');
select ok(not exists(select 1 from machine_sales_facts where source_order_hash=repeat('e',64)),'Rejected final audit leaves no promoted card observation');
-- The native service contract retains purchase evidence when available. An
-- exact existing transaction owner always outranks a reader's current owner.
insert into nayax_scheduled_report_files(file_digest,received_at,byte_count,row_count,report) values
 (repeat('9',64),'2026-09-26T03:00:00Z',500,1,'{}'),
 (repeat('0',64),'2026-09-26T03:00:00Z',500,1,'{}'),
 (repeat('6',64),'2026-09-26T03:00:00Z',500,1,'{}'),
 (repeat('4',64),'2026-09-26T03:00:00Z',500,1,'{}');
create function pg_temp.complete_native_sale(p_reader text,p_transaction text,p_hash text,p_authorized boolean)
returns jsonb language sql as $$select jsonb_build_object('transactionId',p_transaction,'siteId','4','actorId','2003563806','providerMachineId',p_reader,'currencyCode','USD','authorizationAmountCents',500,'settlementAmountCents',500,'paidAmountCents',500,'machineSettledAt','2025-01-01T16:00:00','providerSettledAt','2025-01-02T00:00:00Z','providerUpdatedAt','2025-01-02T00:00:05Z','providerStatus',12,'providerStatusName','Settled','sourceOrderHash',p_hash,'sourceRowHash',repeat('1',64)) || case when p_authorized then jsonb_build_object('machineAuthorizedAt','2025-01-01T15:59:00','authorizedAt','2025-01-01T23:59:00Z') else '{}'::jsonb end$$;
select set_config('request.jwt.claim.role','service_role',true);
select lives_ok($$select service_ingest_nayax_scheduled_sales(repeat('9',64),jsonb_build_array(pg_temp.complete_native_sale('18020001','1802000101',repeat('12',32),true)))$$,'Native card import uses completed Sunze source mapping without a fabricated financial start');
select results_eq($$select reporting_machine_id,net_sales_cents,raw_payload->>'authorizedAt' from machine_sales_facts where source_order_hash=repeat('12',32)$$,$$ values ('aa180203-0000-4000-8000-000000000001'::uuid,500,'2025-01-01T23:59:00Z'::text)$$,'Nayax card contribution and actual authorization UTC evidence are retained');
select lives_ok($$select service_ingest_nayax_scheduled_sales(repeat('0',64),jsonb_build_array(pg_temp.complete_native_sale('18020003','1802000301',repeat('13',32),false)))$$,'Missing purchase evidence for inherited source history stays recoverable');
select is((select disposition_reason from nayax_pending_sales where source_order_hash=repeat('13',32)),'inherited_source_card_purchase_ownership_unverified','Unknown historical overlap cannot add a second card contribution');
select lives_ok($$select service_ingest_nayax_scheduled_sales(repeat('6',64),jsonb_build_array(pg_temp.complete_native_sale('18020003','1802000302',repeat('15',32),true)))$$,'Actual authorization in inherited app-card history does not imply cross-provider transaction identity');
select ok(not exists(select 1 from machine_sales_facts where source_order_hash in(repeat('13',32),repeat('15',32))),'Unproven inherited-overlap native rows add no duplicate money/counts/tax/items');
select is((select net_sales_cents from private.financial_machine_sales_facts where id='aa180206-0000-4000-8000-000000000003'),1000,'Quarantined native overlap does not erase inherited card money');
-- A purchase after all immutable observation timestamps cannot be among the
-- already-observed inherited inputs. This is causal evidence, not a sale-date
-- cutover or a comparison with the unverified provider-local calendar.
insert into nayax_scheduled_report_files(file_digest,received_at,byte_count,row_count,report)
 select repeat('3',64),max(observed_at)+interval '5 seconds',500,2,'{}'::jsonb
 from private.machine_preserved_source_card_facts where reporting_machine_id='aa180203-0000-4000-8000-000000000003';
create function pg_temp.complete_observed_native_sale(p_later boolean) returns jsonb language sql as $$
 select pg_temp.complete_native_sale('18020003',case when p_later then '1802000303' else '1802000304' end,case when p_later then repeat('17',32) else repeat('18',32) end,true)
 || jsonb_build_object('authorizedAt',to_char((observed+case when p_later then interval '2 seconds' else interval '0 seconds' end) at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS"Z"'),
 'providerSettledAt',to_char((observed+interval '3 seconds') at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS"Z"'),
 'machineSettledAt',to_char((observed+interval '3 seconds') at time zone 'America/Los_Angeles','YYYY-MM-DD"T"HH24:MI:SS'),
 'machineAuthorizedAt',to_char((observed+case when p_later then interval '2 seconds' else interval '0 seconds' end) at time zone 'America/Los_Angeles','YYYY-MM-DD"T"HH24:MI:SS'),
 'providerUpdatedAt',to_char((observed+interval '4 seconds') at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS"Z"'))
 from (select max(observed_at) observed from private.machine_preserved_source_card_facts where reporting_machine_id='aa180203-0000-4000-8000-000000000003') capture
$$;
select lives_ok($$select service_ingest_nayax_scheduled_sales(repeat('3',64),jsonb_build_array(pg_temp.complete_observed_native_sale(true),pg_temp.complete_observed_native_sale(false)))$$,'Validated post-observation purchases can flow without an artificial mapping-date cutoff');
select is((select count(*) from machine_sales_facts where source_order_hash=repeat('17',32)),1::bigint,'Strictly later authorization supplies one new Nayax card contribution');
select ok(not exists(select 1 from machine_sales_facts where source_order_hash=repeat('18',32)),'Authorization not later than observation time cannot establish non-overlap');
select is((select disposition_reason from nayax_pending_sales where source_order_hash=repeat('18',32)),'inherited_source_card_purchase_ownership_unverified','Unproven causal boundary remains recoverable pending');
select is((select sum(net_sales_cents) from private.financial_machine_sales_facts where reporting_machine_id='aa180203-0000-4000-8000-000000000003'),1500::bigint,'Original inherited card inputs and proven new Nayax purchase contribute once each');
-- Simulate a changed current-reader lookup only in the isolated seed seam;
-- the service action itself runs with ordinary origin triggers afterward.
set local session_replication_role=replica;
insert into reporting_machines(id,account_id,location_id,machine_label,machine_type) values('aa180203-0000-4000-8000-000000000006','aa180201-0000-4000-8000-000000000001','aa180202-0000-4000-8000-000000000001','Synthetic changed inventory owner','commercial');
update refund_nayax_machine_inventory set reporting_machine_id='aa180203-0000-4000-8000-000000000006' where id='aa180204-0000-4000-8000-000000000001';
set local session_replication_role=origin;
select lives_ok($$select service_ingest_nayax_scheduled_sales(repeat('4',64),jsonb_build_array(pg_temp.complete_native_sale('18020001','1802000101',repeat('12',32),true)))$$,'Repeated original transaction survives changed current reader lookup');
select is((select count(*) from machine_sales_facts where source_order_hash=repeat('12',32)),1::bigint,'Repeated original transaction has one fact');
select is((select reporting_machine_id from machine_sales_facts where source_order_hash=repeat('12',32)),'aa180203-0000-4000-8000-000000000001'::uuid,'Original transaction machine ownership cannot be rewritten by a new current-reader pointer');
select is((service_ingest_nayax_scheduled_sales(repeat('4',64),jsonb_build_array(pg_temp.complete_native_sale('18020001','1802000101',repeat('12',32),true)))->>'duplicate')::boolean,true,'Same native report receipt is idempotent');
select throws_ok($$delete from private.machine_preserved_source_card_facts where fact_id='aa180206-0000-4000-8000-000000000003'$$,'22023',null,'Inherited financial eligibility cannot be silently removed');
select throws_ok($$update private.machine_card_financial_policies set reason='Rewrite previous policy' where reporting_machine_id='aa180203-0000-4000-8000-000000000001'$$,'22023',null,'Established same-machine policy cannot be silently rewritten');
-- Reproduce an obsolete management-only writer resuming after rollout. The
-- real deferred constraint is flushed inside the same rejected subtransaction.
create function pg_temp.obsolete_source_management_save() returns void language plpgsql as $$
begin
 insert into private.machine_source_management_associations(platform,source_id,reporting_machine_id,created_by,reason)
 values('Sunze','complete-obsolete-source','aa180203-0000-4000-8000-000000000006','aa180200-0000-4000-8000-000000000001','Synthetic obsolete management-only save');
 set constraints source_management_association_completed immediate;
end $$;
select throws_ok($$select pg_temp.obsolete_source_management_save()$$,'22023',null,'Obsolete management-only save cannot commit after rollout');
select ok(not exists(select 1 from private.machine_source_management_associations where source_id='complete-obsolete-source'),'Deferred rejection rolls back the obsolete association entirely');
select * from finish();
rollback;
