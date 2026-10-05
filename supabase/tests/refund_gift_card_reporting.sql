begin;
create extension if not exists pgtap with schema extensions;
set local search_path = public, extensions;
select no_plan();
-- Synthetic delivery only; the transaction rolls this policy change back.
update public.refund_customer_contact_settings set automatic_customer_contact_enabled=true where singleton;

insert into public.customer_accounts(id,name,account_type)
values ('fc610000-0000-4000-8000-000000000001','Gift-card reporting fixture','internal');
insert into public.reporting_locations(id,account_id,name,timezone)
values ('fc620000-0000-4000-8000-000000000001','fc610000-0000-4000-8000-000000000001','Gift-card fixture','UTC');
insert into public.reporting_machines(id,account_id,location_id,machine_label,status)
values ('fc630000-0000-4000-8000-000000000001','fc610000-0000-4000-8000-000000000001',
  'fc620000-0000-4000-8000-000000000001','Fixture machine','active');
insert into public.reporting_machine_tax_rates(id,machine_id,tax_rate_percent,effective_start_date,status)
values ('fc631000-0000-4000-8000-000000000001','fc630000-0000-4000-8000-000000000001',10,'2020-01-01','active');
\ir fixtures/reporting_source_tax.inc

-- Seed an already-active synthetic rollout so yesterday's request is recognized
-- on its real request date. No production row or immutable event is changed.
insert into private.refund_request_recognition_rollout(singleton,activated_at,activated_by)
values (true,now()-interval '2 days','Gift-card synthetic reporting test');

insert into public.refund_gift_card_pools(id,provider,provider_account_id,face_value_cents,
  eligible_machine_ids,eligible_locations,expires_at,enabled,redemption_instructions)
values ('fc650000-0000-4000-8000-000000000001','kemore','synthetic-reporting-account',1500,
  array['fc630000-0000-4000-8000-000000000001']::uuid[],array['Fixture location'],
  now()+interval '30 days',true,'Enter your code on the fixture machine.');
insert into public.refund_gift_card_codes(id,pool_id,provider,provider_account_id,provider_code_id,
  code,valid_from,expires_at)
values ('fc660000-0000-4000-8000-000000000001','fc650000-0000-4000-8000-000000000001',
  'kemore','synthetic-reporting-account','synthetic-code-1','000000001',now()-interval '1 day',now()+interval '30 days');

-- Add ordinary requests first, then choose the gift-card resolution on the same
-- case. This makes before/after financial behavior explicit in one transaction.
insert into public.refund_cases(id,public_reference,reporting_machine_id,reporting_location_id,
  customer_email,issue_summary,incident_at,payment_method,payment_amount_cents,refund_amount_cents,
  status,customer_request_received_at,customer_request_received_source)
values
 ('fc640000-0000-4000-8000-000000000001','RF-GIFT-REPORT-1','fc630000-0000-4000-8000-000000000001',
  'fc620000-0000-4000-8000-000000000001','gift-report@example.invalid','Synthetic gift-card request',
  now(),'cash',1100,1100,'needs_review',now(),'hosted_refund_intake'),
 ('fc640000-0000-4000-8000-000000000002','RF-GIFT-REPORT-2','fc630000-0000-4000-8000-000000000001',
  'fc620000-0000-4000-8000-000000000001','card-report@example.invalid','Synthetic card request',
  now(),'card',2200,2200,'needs_review',now(),'hosted_refund_intake');

select is((select sum(outstanding_context_ex_tax_cents) from private.machine_sales_daily_components(
  'fc630000-0000-4000-8000-000000000001',current_date,current_date)),3100::numeric,
  'Before issuance both original purchase requests are outstanding, excluding tax');
create temporary table gift_reporting_before on commit drop as
select count(*) as events from private.refund_request_recognition_events
where refund_case_id in ('fc640000-0000-4000-8000-000000000001','fc640000-0000-4000-8000-000000000002');

update public.refund_cases set resolution_method='gift_card',
  gift_card_pool_id='fc650000-0000-4000-8000-000000000001',gift_card_value_cents=1500,
  gift_card_expires_at=now()+interval '30 days',gift_card_state='pending_inventory'
where id='fc640000-0000-4000-8000-000000000001';
select lives_ok($$select public.service_issue_refund_gift_card('fc640000-0000-4000-8000-000000000001')$$,
  'Issuing a synthetic gift card uses the existing case and outbox');
select results_eq($$
  select purchase_amount_cents,face_value_cents,goodwill_amount_cents
  from public.refund_gift_card_issuances where refund_case_id='fc640000-0000-4000-8000-000000000001'
$$,$$values (1100,1500,400)$$,'Purchase, gift-card value and Bloomjoy goodwill remain distinct');
select is((select sum(request_deduction_ex_tax_cents) from private.machine_sales_daily_components(
  'fc630000-0000-4000-8000-000000000001',current_date,current_date)),3100::numeric,
  'Issuance preserves the original request deduction without deducting goodwill');
select is((select sum(outstanding_context_ex_tax_cents) from private.machine_sales_daily_components(
  'fc630000-0000-4000-8000-000000000001',current_date,current_date)),2000::numeric,
  'Only the original-payment card request remains outstanding');
select is((select sum(paid_context_ex_tax_cents) from private.machine_sales_daily_components(
  'fc630000-0000-4000-8000-000000000001',current_date,current_date)),0::numeric,
  'A gift card never appears as money paid');
select is((select sum(commissionable_sales_ex_tax_cents) from private.machine_sales_daily_components(
  'fc630000-0000-4000-8000-000000000001',current_date,current_date)),-3100::numeric,
  'Technician and partner calculations keep the original purchase deduction only');
select is((select component_amount_cents from private.machine_sales_calculation_candidates(
  'fc630000-0000-4000-8000-000000000001',current_date,current_date)
  where refund_case_id='fc640000-0000-4000-8000-000000000001' and component_kind='refund_request_outstanding'),
  0::bigint,'Canonical request context also treats the gift-card purchase as resolved');
select results_eq($$
  select component_kind,source,component_amount_cents,paid_date
  from private.machine_sales_calculation_candidates(
    'fc630000-0000-4000-8000-000000000001',current_date,current_date)
  where refund_case_id='fc640000-0000-4000-8000-000000000001' and component_kind='refund_gift_card'
$$,$$values ('refund_gift_card'::text,'gift_card'::text,1100::bigint,null::date)$$,
  'Canonical reporting distinguishes the gift-card purchase resolution from money paid');
select is(private.refund_gift_card_resolved_purchase_cents('fc640000-0000-4000-8000-000000000001',current_date-1),
  0::bigint,'An issuance does not resolve a report dated before it happened');
select is(private.refund_gift_card_resolved_purchase_cents('fc640000-0000-4000-8000-000000000001',current_date),
  1100::bigint,'Resolution uses the purchase amount, not the larger gift-card value');

select lives_ok($$select public.service_issue_refund_gift_card('fc640000-0000-4000-8000-000000000001')$$,
  'Issuance replay reuses the same receipt');
update public.refund_gift_card_codes set status='used'
where id='fc660000-0000-4000-8000-000000000001';
select is((select count(*) from public.refund_gift_card_issuances
  where refund_case_id='fc640000-0000-4000-8000-000000000001'),1::bigint,
  'Replay and later redemption create no second gift card');
select is((select count(*) from public.sales_adjustment_facts
  where refund_case_id='fc640000-0000-4000-8000-000000000001'),0::bigint,
  'Issuance and redemption create no cash-paid adjustment');
select is((select count(*) from private.refund_request_recognition_events
  where refund_case_id in ('fc640000-0000-4000-8000-000000000001','fc640000-0000-4000-8000-000000000002')),
  (select events from gift_reporting_before),'No extra request deduction is created by issuance or redemption');
select is((select sum(commissionable_sales_ex_tax_cents) from private.machine_sales_daily_components(
  'fc630000-0000-4000-8000-000000000001',current_date,current_date)),-3100::numeric,
  'Replay and redemption leave commission treatment unchanged');
insert into public.machine_sales_facts(id,reporting_machine_id,reporting_location_id,sale_date,
  payment_method,net_sales_cents,transaction_count,source,source_order_hash,source_row_hash,tax_cents,raw_payload)
values ('fc670000-0000-4000-8000-000000000001','fc630000-0000-4000-8000-000000000001',
  'fc620000-0000-4000-8000-000000000001',current_date,'other',1500,1,'sunze_browser',
  repeat('fc67',8),repeat('fc67',16),0,'{"payment_method_source":"Free","order_amount_cents":1500}');
select is((select sum(commissionable_sales_ex_tax_cents) from private.machine_sales_daily_components(
  'fc630000-0000-4000-8000-000000000001',current_date,current_date)),-3100::numeric,
  'A provider-labelled Free order is not new money revenue even if it carries a product value');
select is((select count(*) from private.machine_sales_calculation_candidates(
  'fc630000-0000-4000-8000-000000000001',current_date,current_date) where source='sunze_browser'),0::bigint,
  'The canonical candidate contract also excludes Free product value from sales money');
select is((select net_sales_cents from public.machine_sales_facts
  where id='fc670000-0000-4000-8000-000000000001'),1500,
  'Original provider evidence remains stored unchanged');
select is(has_function_privilege('anon','private.refund_gift_card_resolved_purchase_cents(uuid,date)','EXECUTE'),false,
  'Anonymous callers cannot read gift-card resolution history');

-- A request yesterday and issuance today prove historical report totals, rather
-- than only the helper's date filter. Keep this machine isolated from above.
insert into public.reporting_machines(id,account_id,location_id,machine_label,status)
values ('fc630000-0000-4000-8000-000000000002','fc610000-0000-4000-8000-000000000001',
  'fc620000-0000-4000-8000-000000000001','Historical fixture machine','active');
insert into public.reporting_machine_tax_rates(id,machine_id,tax_rate_percent,effective_start_date,status)
values ('fc631000-0000-4000-8000-000000000002','fc630000-0000-4000-8000-000000000002',10,'2020-01-01','active');
\ir fixtures/reporting_source_tax.inc

update public.refund_gift_card_pools set eligible_machine_ids=array[
  'fc630000-0000-4000-8000-000000000001','fc630000-0000-4000-8000-000000000002']::uuid[]
where id='fc650000-0000-4000-8000-000000000001';
insert into public.refund_gift_card_codes(id,pool_id,provider,provider_account_id,provider_code_id,
  code,valid_from,expires_at)
values ('fc660000-0000-4000-8000-000000000002','fc650000-0000-4000-8000-000000000001',
  'kemore','synthetic-reporting-account','synthetic-code-2','000000002',now()-interval '2 days',now()+interval '30 days');
insert into public.refund_cases(id,public_reference,reporting_machine_id,reporting_location_id,
  customer_email,issue_summary,incident_at,payment_method,payment_amount_cents,refund_amount_cents,
  status,customer_request_received_at,customer_request_received_source)
values ('fc640000-0000-4000-8000-000000000003','RF-GIFT-REPORT-HISTORY','fc630000-0000-4000-8000-000000000002',
  'fc620000-0000-4000-8000-000000000001','gift-history@example.invalid','Synthetic historical request',
  now()-interval '1 day','cash',1100,1100,'needs_review',now()-interval '1 day','hosted_refund_intake');
update public.refund_cases set resolution_method='gift_card',
  gift_card_pool_id='fc650000-0000-4000-8000-000000000001',gift_card_value_cents=1500,
  gift_card_expires_at=now()+interval '30 days',gift_card_state='pending_inventory'
where id='fc640000-0000-4000-8000-000000000003';
select lives_ok($$select public.service_issue_refund_gift_card('fc640000-0000-4000-8000-000000000003')$$,
  'A previous-day request can receive a gift card today');
select results_eq($$
  select sum(request_deduction_ex_tax_cents),sum(outstanding_context_ex_tax_cents),
    sum(paid_context_ex_tax_cents),sum(commissionable_sales_ex_tax_cents)
  from private.machine_sales_daily_components('fc630000-0000-4000-8000-000000000002',current_date-1,current_date-1)
$$,$$values (1100::numeric,1100::numeric,0::numeric,-1100::numeric)$$,
  'Historical full report retains outstanding purchase and original deduction before issuance');
select results_eq($$
  select sum(request_deduction_ex_tax_cents),sum(outstanding_context_ex_tax_cents),
    sum(paid_context_ex_tax_cents),sum(commissionable_sales_ex_tax_cents)
  from private.machine_sales_daily_components('fc630000-0000-4000-8000-000000000002',current_date-1,current_date)
$$,$$values (1100::numeric,0::numeric,0::numeric,-1100::numeric)$$,
  'Current full report resolves the purchase without paying money or charging goodwill');
select is((select count(*) from private.machine_sales_calculation_candidates(
  'fc630000-0000-4000-8000-000000000002',current_date-1,current_date-1)
  where component_kind='refund_gift_card'),0::bigint,'Historical candidates contain no future gift-card receipt');

-- Accepted issuance cannot be reparented. A later ordinary duplicate points to
-- that canonical gift-card request and contributes no second deduction/receipt.
insert into public.refund_cases(id,public_reference,reporting_machine_id,reporting_location_id,
  customer_email,issue_summary,incident_at,payment_method,payment_amount_cents,refund_amount_cents,
  status,customer_request_received_at,customer_request_received_source,duplicate_of_refund_case_id)
values ('fc640000-0000-4000-8000-000000000004','RF-GIFT-REPORT-DUPLICATE','fc630000-0000-4000-8000-000000000002',
  'fc620000-0000-4000-8000-000000000001','gift-history@example.invalid','Duplicate synthetic request',
  now()-interval '1 day','cash',1100,1100,'needs_review',now(),'hosted_refund_intake',
  'fc640000-0000-4000-8000-000000000003');
select throws_ok($$update public.refund_cases set duplicate_of_refund_case_id='fc640000-0000-4000-8000-000000000004'
  where id='fc640000-0000-4000-8000-000000000003'$$,'P4670',null::text,
  'Accepted gift-card terms and canonical identity cannot be changed by late reparenting');
select is(private.refund_gift_card_resolved_purchase_cents('fc640000-0000-4000-8000-000000000003',current_date),
  1100::bigint,'Canonical request retains one receipt when an ordinary duplicate points to it');
select is((select count(*) from private.machine_sales_calculation_candidates(
  'fc630000-0000-4000-8000-000000000002',current_date-1,current_date)
  where component_kind='refund_gift_card'),1::bigint,'Duplicate lineage produces one canonical gift-card component');
select results_eq($$
  select sum(request_deduction_ex_tax_cents)-sum(refund_reversal_ex_tax_cents),
    sum(outstanding_context_ex_tax_cents),sum(paid_context_ex_tax_cents),sum(commissionable_sales_ex_tax_cents)
  from private.machine_sales_daily_components('fc630000-0000-4000-8000-000000000002',current_date-1,current_date)
$$,$$values (1100::numeric,0::numeric,0::numeric,-1100::numeric)$$,
  'Duplicate lineage full report deducts the purchase once, with no outstanding amount or money paid');

select * from finish();
rollback;
