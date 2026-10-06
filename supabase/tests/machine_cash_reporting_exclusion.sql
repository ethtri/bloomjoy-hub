begin;
create extension if not exists pgtap with schema extensions;
set local search_path=public,extensions;
select no_plan();

insert into auth.users(id,aud,role,email,raw_app_meta_data,raw_user_meta_data) values
 ('ce000000-0000-4000-8000-000000000001','authenticated','authenticated','cash-admin@example.invalid','{}','{}'),
 ('ce000000-0000-4000-8000-000000000002','authenticated','authenticated','cash-scoped@example.invalid','{}','{}'),
 ('ce000000-0000-4000-8000-000000000003','authenticated','authenticated','cash-denied@example.invalid','{}','{}');
insert into public.admin_roles(user_id,role,active) values ('ce000000-0000-4000-8000-000000000001','super_admin',true);
insert into public.customer_accounts(id,name,account_type) values ('ce100000-0000-4000-8000-000000000001','Cash exclusion fixture','internal');
insert into public.reporting_locations(id,account_id,name,timezone) values
 ('ce200000-0000-4000-8000-000000000001','ce100000-0000-4000-8000-000000000001','Cash fixture','America/Los_Angeles');
insert into public.reporting_machines(id,account_id,location_id,machine_label,machine_type) values
 ('ce300000-0000-4000-8000-000000000001','ce100000-0000-4000-8000-000000000001','ce200000-0000-4000-8000-000000000001','Mixed cash and card','commercial'),
 ('ce300000-0000-4000-8000-000000000002','ce100000-0000-4000-8000-000000000001','ce200000-0000-4000-8000-000000000001','Unaffected cash machine','commercial');
insert into public.admin_scoped_access_grants(id,user_id,grant_reason) values
 ('ce600000-0000-4000-8000-000000000001','ce000000-0000-4000-8000-000000000002','Cash fixture');
insert into public.admin_scoped_access_scopes(grant_id,scope_type,machine_id,grant_reason) values
 ('ce600000-0000-4000-8000-000000000001','machine','ce300000-0000-4000-8000-000000000001','Cash scope');
insert into public.machine_sales_facts(id,reporting_machine_id,reporting_location_id,sale_date,payment_method,net_sales_cents,transaction_count,item_quantity,source,source_order_hash,source_row_hash,tax_cents,raw_payload) values
 ('ce400000-0000-4000-8000-000000000001','ce300000-0000-4000-8000-000000000001','ce200000-0000-4000-8000-000000000001',current_date-20,'cash',3000,3,3,'sunze_browser',repeat('a',32),repeat('a',64),0,'{}'),
 ('ce400000-0000-4000-8000-000000000002','ce300000-0000-4000-8000-000000000001','ce200000-0000-4000-8000-000000000001',current_date-20,'credit',1100,1,1,'nayax_scheduled_report',null,repeat('b',64),100,'{"amountBasis":"separate_tax"}'),
 ('ce400000-0000-4000-8000-000000000003','ce300000-0000-4000-8000-000000000001','ce200000-0000-4000-8000-000000000001',current_date-20,'cash',500,1,1,'manual_csv',null,repeat('c',64),0,'{}');
create temporary table original_cash_facts as select * from public.machine_sales_facts where reporting_machine_id in ('ce300000-0000-4000-8000-000000000001','ce300000-0000-4000-8000-000000000002');
select ok(not (select exclude_cash_from_financial_reporting from public.reporting_machines where id='ce300000-0000-4000-8000-000000000001'),'New machines include cash by default');
select is((select sum(sales_ex_tax_cents)::bigint from private.machine_sales_daily_components('ce300000-0000-4000-8000-000000000001',current_date-30,current_date)),4000::bigint,'Default includes cash and actual card net');
select set_config('request.jwt.claim.role','authenticated',true);
select set_config('request.jwt.claim.sub','ce000000-0000-4000-8000-000000000001',true);
select lives_ok($$select public.admin_set_machine_cash_reporting_exclusion('ce300000-0000-4000-8000-000000000001',true,false)$$,'Admin can enable exclusion');
select results_eq($$select sum(sales_ex_tax_cents)::bigint,sum(sales_transaction_count)::bigint,sum(unresolved_sales_count)::bigint from private.machine_sales_daily_components('ce300000-0000-4000-8000-000000000001',current_date-30,current_date)$$,$$values (1000::bigint,1::bigint,0::bigint)$$,'Sale revenue/count/completeness exclude test cash');
select is((select sum(sales_ex_tax_cents)::bigint from private.machine_sales_daily_waterfall_components('ce300000-0000-4000-8000-000000000001',current_date-30,current_date)),1000::bigint,'Finance waterfall agrees with Sales');
select is((private.operator_machine_tax_snapshot_shared('ce300000-0000-4000-8000-000000000001',current_date-30,current_date)->>'commissionableSalesCents')::bigint,1000::bigint,'Technician commission base agrees');
select is((select count(*)::integer from private.machine_sales_calculation_candidates('ce300000-0000-4000-8000-000000000001',current_date-30,current_date) where component_kind='sale'),1,'Paid-sale candidates exclude cash');
select is((select sum(sales_ex_tax_cents)::bigint from private.machine_sales_daily_components('ce300000-0000-4000-8000-000000000002',current_date-30,current_date)),500::bigint,'Other machine cash is unchanged');
select is((select count(*)::integer from public.admin_audit_log where entity_id='ce300000-0000-4000-8000-000000000001' and action='machine.cash_reporting_exclusion_updated'),1,'Change has one audit record');
select lives_ok($$select public.admin_set_machine_cash_reporting_exclusion('ce300000-0000-4000-8000-000000000001',true,false)$$,'Same desired state retries safely');
select is((select count(*)::integer from public.admin_audit_log where entity_id='ce300000-0000-4000-8000-000000000001' and action='machine.cash_reporting_exclusion_updated'),1,'Retry does not duplicate audit');
select throws_ok($$select public.admin_set_machine_cash_reporting_exclusion('ce300000-0000-4000-8000-000000000001',false,false)$$,'40001','Cash reporting changed since you opened this machine. Reload and try again.','Stale inverse write is rejected');
select results_eq($$select to_jsonb(f) from public.machine_sales_facts f where reporting_machine_id in ('ce300000-0000-4000-8000-000000000001','ce300000-0000-4000-8000-000000000002') order by id$$,$$select to_jsonb(f) from original_cash_facts f order by id$$,'All raw facts and payloads remain identical');
select ok((select (item->>'excludeCashFromFinancialReporting')::boolean from jsonb_array_elements(public.admin_get_machine_workspace_metadata()) item where item->>'machineId'='ce300000-0000-4000-8000-000000000001'),'Workspace reports the stored setting');
select set_config('request.jwt.claim.sub','ce000000-0000-4000-8000-000000000003',true);
select throws_ok($$select public.admin_set_machine_cash_reporting_exclusion('ce300000-0000-4000-8000-000000000001',false,true)$$,'42501','Machine admin access required','Unauthorized save denied');
select set_config('request.jwt.claim.sub','ce000000-0000-4000-8000-000000000002',true);
select throws_ok($$select public.admin_set_machine_cash_reporting_exclusion('ce300000-0000-4000-8000-000000000002',true,false)$$,'42501','Machine admin access required','Scoped admin cannot change another machine');
select lives_ok($$select public.admin_set_machine_cash_reporting_exclusion('ce300000-0000-4000-8000-000000000001',false,true)$$,'Scoped admin can restore own machine');
select is((select sum(sales_ex_tax_cents)::bigint from private.machine_sales_daily_components('ce300000-0000-4000-8000-000000000001',current_date-30,current_date)),4000::bigint,'Turning off restores historical eligible cash');
select ok(not has_table_privilege('authenticated','private.financial_machine_sales_facts','select'),'Private financial view cannot bypass report scope');
select ok(not has_function_privilege('authenticated','public.service_complete_pay_stub_before_cash_policy(uuid,uuid,text)','execute'),'Old publication function cannot bypass freshness');
select * from finish();
rollback;
