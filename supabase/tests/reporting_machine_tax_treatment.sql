begin;
create extension if not exists pgtap with schema extensions;
set local search_path = public, extensions;
set local timezone = 'UTC';
select no_plan();

insert into auth.users(id, aud, role, email, raw_app_meta_data, raw_user_meta_data)
values
  ('ab000000-0000-4000-8000-000000000001', 'authenticated', 'authenticated', 'tax-admin@example.invalid', '{}', '{}'),
  ('ab000000-0000-4000-8000-000000000002', 'authenticated', 'authenticated', 'tax-scoped@example.invalid', '{}', '{}'),
  ('ab000000-0000-4000-8000-000000000003', 'authenticated', 'authenticated', 'tax-no-access@example.invalid', '{}', '{}');
insert into public.admin_roles(user_id, role, active)
values ('ab000000-0000-4000-8000-000000000001', 'super_admin', true);
insert into public.customer_accounts(id, name, account_type)
values ('ab100000-0000-4000-8000-000000000001', 'Tax treatment fixture', 'internal');
insert into public.reporting_locations(id, account_id, name, timezone)
values ('ab200000-0000-4000-8000-000000000001', 'ab100000-0000-4000-8000-000000000001', 'Tax fixture', 'UTC');
insert into public.reporting_machines(id, account_id, location_id, machine_label, machine_type)
values
  ('ab300000-0000-4000-8000-000000000001', 'ab100000-0000-4000-8000-000000000001', 'ab200000-0000-4000-8000-000000000001', 'Treatment fixture', 'commercial'),
  ('ab300000-0000-4000-8000-000000000002', 'ab100000-0000-4000-8000-000000000001', 'ab200000-0000-4000-8000-000000000001', 'Outside scope', 'commercial'),
  ('ab300000-0000-4000-8000-000000000003', 'ab100000-0000-4000-8000-000000000001', 'ab200000-0000-4000-8000-000000000001', 'Unconfigured sources', 'commercial');
insert into public.admin_scoped_access_grants(id, user_id, grant_reason)
values ('ab600000-0000-4000-8000-000000000001', 'ab000000-0000-4000-8000-000000000002', 'Tax fixture scope');
insert into public.admin_scoped_access_scopes(grant_id, scope_type, machine_id, grant_reason)
values ('ab600000-0000-4000-8000-000000000001', 'machine', 'ab300000-0000-4000-8000-000000000001', 'Tax fixture machine');
insert into public.reporting_machine_tax_rates(machine_id, tax_rate_percent, effective_start_date)
values ('ab300000-0000-4000-8000-000000000001', 10, current_date-30);

select set_config('request.jwt.claim.sub', 'ab000000-0000-4000-8000-000000000001', true);
select set_config('request.jwt.claim.role', 'authenticated', true);

insert into public.reporting_machine_tax_rates(machine_id,tax_rate_percent,effective_start_date)
values ('ab300000-0000-4000-8000-000000000003',10,current_date-30);
insert into public.machine_sales_facts(reporting_machine_id,reporting_location_id,
  sale_date,payment_method,net_sales_cents,transaction_count,source,source_order_hash,source_row_hash,raw_payload)
values
  ('ab300000-0000-4000-8000-000000000003','ab200000-0000-4000-8000-000000000001',current_date,'cash',10330,1,'sunze_browser',repeat('f',32),repeat('f',64),'{}'),
  ('ab300000-0000-4000-8000-000000000003','ab200000-0000-4000-8000-000000000001',current_date,'credit',10330,1,'nayax_scheduled_report',repeat('1',32),repeat('1',64),'{}'),
  ('ab300000-0000-4000-8000-000000000003','ab200000-0000-4000-8000-000000000001',current_date,'cash',10330,1,'snapcase_cash',repeat('2',32),repeat('2',64),'{"amountBasis":"gross_customer_charge_minor"}'),
  ('ab300000-0000-4000-8000-000000000003','ab200000-0000-4000-8000-000000000001',current_date,'cash',42,1,'manual_csv',null,repeat('3',64),'{}');
select results_eq($$
  select source,sales_ex_tax_cents,sales_tax_cents,unresolved_sales_count
  from private.machine_sales_daily_components('ab300000-0000-4000-8000-000000000003',current_date,current_date)
  order by source
$$,$$values ('manual_csv'::text,null::bigint,null::bigint,1::bigint),
  ('nayax_scheduled_report'::text,9391::bigint,939::bigint,0::bigint),
  ('snapcase_cash'::text,9391::bigint,939::bigint,0::bigint),
  ('sunze_browser'::text,10330::bigint,0::bigint,0::bigint)$$,
  'No rules preserve Nayax inclusive fallback, Sunze exclusive, Kex field basis and unknown manual amounts');

insert into public.machine_sales_facts(reporting_machine_id,reporting_location_id,
  sale_date,payment_method,net_sales_cents,transaction_count,source,source_order_hash,source_row_hash,raw_payload)
values
  ('ab300000-0000-4000-8000-000000000003','ab200000-0000-4000-8000-000000000001',current_date-1,'credit',5,1,'nayax_scheduled_report',repeat('4',32),repeat('4',64),'{}'),
  ('ab300000-0000-4000-8000-000000000003','ab200000-0000-4000-8000-000000000001',current_date-1,'credit',5,1,'nayax_scheduled_report',repeat('5',32),repeat('5',64),'{"amountBasis":"tax_inclusive"}');
select results_eq($$
  select sales_ex_tax_cents,sales_tax_cents,sales_transaction_count
  from private.machine_sales_daily_components('ab300000-0000-4000-8000-000000000003',current_date-1,current_date-1)
$$,$$values (9::bigint,1::bigint,2::bigint)$$,
  'Unconfigured mixed explicit/default evidence retains one daily embedded-tax rounding scope');
select public.admin_set_reporting_machine_tax_treatment(
  'ab300000-0000-4000-8000-000000000003','card','source_default',100,current_date-1,'Explicit automatic rounding test');
select results_eq($$
  select sales_ex_tax_cents,sales_tax_cents,sales_transaction_count
  from private.machine_sales_daily_components('ab300000-0000-4000-8000-000000000003',current_date-1,current_date-1)
$$,$$values (9::bigint,1::bigint,2::bigint)$$,
  'Automatic configured treatment also retains daily rounding across provenance');
select public.admin_set_reporting_machine_tax_treatment(
  'ab300000-0000-4000-8000-000000000003','card','tax_exclusive',100,current_date-1,'Different source fallback basis');
select results_eq($$
  select sum(sales_ex_tax_cents)::bigint,sum(sales_tax_cents)::bigint,sum(sales_transaction_count)::bigint
  from private.machine_sales_daily_components('ab300000-0000-4000-8000-000000000003',current_date-1,current_date-1)
$$,$$values (10::bigint,0::bigint,2::bigint)$$,
  'Different configured fallback basis preserves explicit inclusive evidence and splits only different math');

select results_eq($$
  select tax_exclusive_amount_cents, tax_cents from private.normalize_reporting_treated_amount_cents(
    'ab300000-0000-4000-8000-000000000001', 'card', current_date-10,
    11000, 'tax_inclusive', 10, null, false)
$$, $$values (10000::bigint,1000::bigint)$$, 'No configuration preserves inclusive default');
select results_eq($$
  select tax_exclusive_amount_cents, tax_cents from private.normalize_reporting_treated_amount_cents(
    'ab300000-0000-4000-8000-000000000001', 'cash', current_date-10,
    11000, 'tax_exclusive', 10, null, false)
$$, $$values (11000::bigint,0::bigint)$$, 'No configuration preserves exclusive default');

select public.admin_set_reporting_machine_tax_configuration(
  'ab300000-0000-4000-8000-000000000001', 10, current_date-20, 'Explicit synthetic treatment',
  'tax_inclusive', 33, 'tax_exclusive', 100);
select results_eq($$
  select tax_exclusive_amount_cents, tax_cents from private.normalize_reporting_treated_amount_cents(
    'ab300000-0000-4000-8000-000000000001', 'card', current_date-10,
    10330, 'tax_inclusive', 10, null, false)
$$, $$values (10000::bigint,330::bigint)$$, '33% taxable portion is distinct from the 10% statutory rate');
select results_eq($$
  select tax_exclusive_amount_cents, tax_cents from private.normalize_reporting_treated_amount_cents(
    'ab300000-0000-4000-8000-000000000001', 'cash', current_date-10,
    10330, 'unknown', 10, null, false)
$$, $$values (10330::bigint,0::bigint)$$, 'Explicit exclusive source default removes no further tax');
select results_eq($$
  select tax_exclusive_amount_cents, tax_cents from private.normalize_reporting_treated_amount_cents(
    'ab300000-0000-4000-8000-000000000001', 'cash', current_date-10,
    10330, 'tax_inclusive', 10, null, true)
$$, $$values (9391::bigint,939::bigint)$$, 'Refund charge keeps its own inclusive basis despite exclusive sales configuration');
select results_eq($$
  select tax_exclusive_amount_cents, tax_cents from private.normalize_reporting_treated_amount_cents(
    'ab300000-0000-4000-8000-000000000001', 'card', current_date-10,
    10330, 'separate_tax', 10, 125, true)
$$, $$values (10205::bigint,125::bigint)$$, 'Proved separate tax remains authoritative');

select public.admin_set_reporting_machine_tax_treatment(
  'ab300000-0000-4000-8000-000000000001', 'card', 'tax_exclusive', 100, current_date, 'New dated basis');
select results_eq($$
  select effective_start_date, effective_end_date from public.reporting_machine_tax_treatments
  where machine_id = 'ab300000-0000-4000-8000-000000000001' and tender='card'
  order by effective_start_date
$$, $$values (current_date-20,current_date-1),(current_date,null::date)$$, 'New rule closes preceding window');
select results_eq($$
  select tax_exclusive_amount_cents, tax_cents from private.normalize_reporting_treated_amount_cents(
    'ab300000-0000-4000-8000-000000000001', 'card', current_date-10,
    10330, 'tax_inclusive', 10, null, true)
$$, $$values (10000::bigint,330::bigint)$$, 'Later refund uses original purchase-date taxable portion');
select results_eq($$
  select tax_exclusive_amount_cents, tax_cents from private.normalize_reporting_treated_amount_cents(
    'ab300000-0000-4000-8000-000000000001', 'card', current_date,
    10330, 'tax_inclusive', 10, null, false)
$$, $$values (10330::bigint,0::bigint)$$, 'Current exclusive default uses the new window');
select results_eq($$
  select tax_exclusive_amount_cents, tax_cents from private.normalize_reporting_treated_amount_cents(
    'ab300000-0000-4000-8000-000000000001', 'card', current_date,
    11000, 'tax_inclusive', 10, null, true)
$$, $$values (10000::bigint,1000::bigint)$$, 'Proved explicit basis wins over source override');

select public.admin_set_reporting_machine_tax_treatment(
  'ab300000-0000-4000-8000-000000000001', 'card', 'tax_inclusive', 0, current_date+1, 'Explicit zero taxable share');
select results_eq($$
  select tax_exclusive_amount_cents, tax_cents, normalization_status from private.normalize_reporting_treated_amount_cents(
    'ab300000-0000-4000-8000-000000000001', 'card', current_date+1,
    10000, 'tax_inclusive', null, null, false)
$$, $$values (10000::bigint,0::bigint,'proved'::text)$$, 'Explicit zero taxable share works without a statutory rate');
select public.admin_set_reporting_machine_tax_treatment(
  'ab300000-0000-4000-8000-000000000001', 'card', 'source_default', 100, current_date+5, 'Return to source semantics');
select results_eq($$
  select normalization_status, normalization_reason from private.normalize_reporting_treated_amount_cents(
    'ab300000-0000-4000-8000-000000000001', 'card', current_date+5,
    10000, 'tax_inclusive', null, null, false)
$$, $$values ('estimated'::text,'configured_tax_rate_missing_no_deduction'::text)$$,
  'Automatic treatment keeps missing-rate provenance');
select public.admin_set_reporting_machine_tax_treatment(
  'ab300000-0000-4000-8000-000000000001', 'card', 'source_default', 50, current_date+3, 'Backdated between windows');
select is((select effective_end_date from public.reporting_machine_tax_treatments
  where machine_id='ab300000-0000-4000-8000-000000000001' and tender='card'
  and effective_start_date=current_date+3), current_date+4, 'Backdated insert preserves next window');
select public.admin_set_reporting_machine_tax_treatment(
  'ab300000-0000-4000-8000-000000000001', 'card', 'source_default', 25, current_date+3, 'Correct same dated rule');
select is((select count(*) from public.reporting_machine_tax_treatments
  where machine_id='ab300000-0000-4000-8000-000000000001' and tender='card'
  and effective_start_date=current_date+3), 1::bigint, 'Same-date correction retains one rule');
select is((select count(*) from public.reporting_machine_tax_treatments a
  join public.reporting_machine_tax_treatments b on a.machine_id=b.machine_id
  and a.tender=b.tender and a.id < b.id
  and daterange(a.effective_start_date,a.effective_end_date,'[]')
    && daterange(b.effective_start_date,b.effective_end_date,'[]')
  where a.machine_id='ab300000-0000-4000-8000-000000000001'), 0::bigint, 'No effective windows overlap');

select throws_ok($$select public.admin_set_reporting_machine_tax_configuration(
  'ab300000-0000-4000-8000-000000000001', 15, current_date, 'Invalid atomic save',
  'tax_inclusive', 90, 'tax_exclusive', 101)$$,
  '22023', 'Valid machine, tender, amount basis, taxable portion, and effective date are required',
  'Invalid share rejects entire configuration');
select is((select tax_rate_percent from public.reporting_machine_tax_rates
  where machine_id='ab300000-0000-4000-8000-000000000001' and status='active'
  order by effective_start_date desc limit 1), 10::numeric, 'Failed configuration rolls rate back');
select is((select amount_basis from public.reporting_machine_tax_treatments
  where machine_id='ab300000-0000-4000-8000-000000000001' and tender='card'
  and effective_start_date=current_date), 'tax_exclusive', 'Failed configuration rolls card treatment back');
select public.admin_set_reporting_machine_tax_rate(
  'ab300000-0000-4000-8000-000000000001', 12, current_date+6, 'Rate-only edit');
select is((select taxable_portion_percent from public.reporting_machine_tax_treatments
  where machine_id='ab300000-0000-4000-8000-000000000001' and tender='card'
  and effective_start_date=current_date+3), 25::numeric, 'Existing rate API leaves treatment history unchanged');
select ok(exists(select 1 from public.admin_audit_log
  where entity_type='reporting_machine_tax_treatment' and actor_user_id='ab000000-0000-4000-8000-000000000001'
  and meta->>'reason'='Correct same dated rule' and before->>'taxable_portion_percent'='50'
  and after->>'taxable_portion_percent'='25'), 'Audits capture reason and before/after treatment');

-- The canonical consumer honors row-level metadata before operator source defaults.
insert into public.machine_sales_facts(reporting_machine_id, reporting_location_id,
  sale_date, payment_method, net_sales_cents, transaction_count, item_quantity,
  source, source_order_hash, source_row_hash, tax_cents, raw_payload)
values
  ('ab300000-0000-4000-8000-000000000001','ab200000-0000-4000-8000-000000000001',current_date,'credit',11000,1,1,'nayax_scheduled_report',repeat('a',32),repeat('a',64),0,'{}'),
  ('ab300000-0000-4000-8000-000000000001','ab200000-0000-4000-8000-000000000001',current_date,'credit',11000,1,1,'nayax_scheduled_report',repeat('b',32),repeat('b',64),0,'{"amountBasis":"tax_inclusive"}'),
  ('ab300000-0000-4000-8000-000000000001','ab200000-0000-4000-8000-000000000001',current_date,'credit',11000,1,1,'nayax_scheduled_report',repeat('c',32),repeat('c',64),500,'{"taxBasis":"separate_tax"}');
select is((select sum(sales_ex_tax_cents)::bigint from private.machine_sales_daily_components(
  'ab300000-0000-4000-8000-000000000001', current_date, current_date)), 31500::bigint,
  'Canonical daily consumer uses configured fallback, explicit inclusive and explicit separate tax once');

-- Isolate canonical consumers against immutable recognition evidence, as in the
-- existing shared-consumer suite. Booking date is deliberately later than purchase.
insert into public.refund_cases(id,public_reference,reporting_machine_id,reporting_location_id,
  customer_email,issue_summary,incident_at,payment_method,status)
values ('ab500000-0000-4000-8000-000000000001','RF-TAX-TREATMENT-FIXTURE',
  'ab300000-0000-4000-8000-000000000001','ab200000-0000-4000-8000-000000000001',
  'tax-request@example.invalid','Synthetic tax-treatment request',
  (current_date-10)::timestamp at time zone 'UTC','card','needs_review');
insert into public.refund_cases(id,public_reference,reporting_machine_id,reporting_location_id,
  customer_email,issue_summary,incident_at,payment_method,status)
values ('ab500000-0000-4000-8000-000000000002','RF-TAX-GIFT-FIXTURE',
  'ab300000-0000-4000-8000-000000000002','ab200000-0000-4000-8000-000000000001',
  'tax-gift@example.invalid','Synthetic gift tax receipt',(current_date-10)::timestamp at time zone 'UTC','card','needs_review');
insert into private.refund_request_recognition_rollout(singleton,activated_at,activated_by)
values (true, current_timestamp - interval '1 day', 'Tax treatment synthetic fixture')
on conflict (singleton) do nothing;
insert into private.refund_request_recognition_events(
  event_key,refund_case_id,event_kind,effective_at,recorded_at,booking_date,
  reporting_machine_id,reporting_location_id,tender,source,purchase_attribution_date,
  request_target_before_cents,request_target_after_cents,paid_cumulative_cents,
  recognized_target_before_cents,recognized_target_after_cents,amount_basis,amount_provenance)
select 'tax-treatment:request','ab500000-0000-4000-8000-000000000001','request_received',
  activated_at, activated_at + interval '1 second', current_date,
  'ab300000-0000-4000-8000-000000000001','ab200000-0000-4000-8000-000000000001',
  'card','synthetic_fixture',current_date-10,0,10330,10330,0,10330,'tax_inclusive','synthetic_fixture'
from private.refund_request_recognition_rollout where singleton;
insert into public.sales_adjustment_facts(id,refund_case_id,reporting_machine_id,
  reporting_location_id,adjustment_date,adjustment_type,amount_cents,complaint_count,
  source,source_row_hash,raw_payload,created_at)
select 'ab800000-0000-4000-8000-000000000001','ab500000-0000-4000-8000-000000000001',
  'ab300000-0000-4000-8000-000000000001','ab200000-0000-4000-8000-000000000001',
  current_date,'refund',10330,1,'nayax_provider_refund',repeat('d',64),'{}',
  activated_at + interval '2 seconds'
from private.refund_request_recognition_rollout where singleton;
select results_eq($$
  select request_deduction_ex_tax_cents,outstanding_context_ex_tax_cents,
    commissionable_sales_ex_tax_cents from private.machine_sales_daily_components(
      'ab300000-0000-4000-8000-000000000001',current_date,current_date)
    where source='refund_request'
$$,$$values (10000::bigint,0::bigint,-10000::bigint)$$,
  'Request deduction uses purchase-date taxable share even after later treatment change');
select results_eq($$
  select legacy_paid_deduction_ex_tax_cents,paid_context_ex_tax_cents,
    commissionable_sales_ex_tax_cents from private.machine_sales_daily_components(
      'ab300000-0000-4000-8000-000000000001',current_date,current_date)
    where source='nayax_provider_refund'
$$,$$values (0::bigint,10000::bigint,0::bigint)$$,
  'Later payment changes context without a second refund or tax deduction');
select is((select sum(commissionable_sales_ex_tax_cents)::bigint
  from private.machine_sales_daily_components('ab300000-0000-4000-8000-000000000001',
    current_date,current_date)),21500::bigint,
  'Shared commission basis deducts canonical request once and keeps the original gross sales');
select is((select sum(net_sales_cents)::bigint from public.machine_sales_facts
  where reporting_machine_id='ab300000-0000-4000-8000-000000000001'),33000::bigint,
  'Reporting normalization does not rewrite imported source amounts');

insert into public.machine_sales_facts(reporting_machine_id,reporting_location_id,
  sale_date,payment_method,net_sales_cents,transaction_count,source,source_order_hash,source_row_hash,raw_payload)
values ('ab300000-0000-4000-8000-000000000001','ab200000-0000-4000-8000-000000000001',
  current_date,'other',1500,1,'sunze_browser',repeat('e',32),repeat('e',64),
  '{"payment_method_source":"No-pay"}');
select is((select sum(commissionable_sales_ex_tax_cents)::bigint
  from private.machine_sales_daily_components('ab300000-0000-4000-8000-000000000001',
    current_date,current_date)),21500::bigint,
  'Later no-pay exclusion remains intact after tax-treatment migration');

-- Seed immutable receipt evidence to isolate the tax calculation. The existing
-- refund_gift_card_reporting suite verifies real issuance/replay/redemption.
insert into public.reporting_machine_tax_rates(machine_id,tax_rate_percent,effective_start_date)
values ('ab300000-0000-4000-8000-000000000002',10,current_date-30);
select public.admin_set_reporting_machine_tax_treatment(
  'ab300000-0000-4000-8000-000000000002','card','source_default',33,current_date-20,'Gift purchase rule');
select public.admin_set_reporting_machine_tax_treatment(
  'ab300000-0000-4000-8000-000000000002','card','tax_exclusive',100,current_date,'Later source rule');

insert into private.refund_request_recognition_events(
  event_key,refund_case_id,event_kind,effective_at,recorded_at,booking_date,
  reporting_machine_id,reporting_location_id,tender,source,purchase_attribution_date,
  request_target_before_cents,request_target_after_cents,paid_cumulative_cents,
  recognized_target_before_cents,recognized_target_after_cents,amount_basis,amount_provenance)
select 'tax-treatment:gift','ab500000-0000-4000-8000-000000000002','request_received',
  activated_at,activated_at + interval '1 second',current_date,
  'ab300000-0000-4000-8000-000000000002','ab200000-0000-4000-8000-000000000001',
  'card','synthetic_fixture',current_date-10,0,1033,0,0,1033,'tax_inclusive','synthetic_fixture'
from private.refund_request_recognition_rollout where singleton;
insert into public.refund_gift_card_pools(id,provider,provider_account_id,face_value_cents,
  eligible_machine_ids,eligible_locations,expires_at,enabled,redemption_instructions)
values ('ab650000-0000-4000-8000-000000000001','kemore','synthetic-tax-account',1500,
  array['ab300000-0000-4000-8000-000000000002']::uuid[],array['Synthetic fixture'],
  current_timestamp + interval '30 days',true,'Synthetic receipt fixture');
insert into public.refund_gift_card_codes(id,pool_id,provider,provider_account_id,provider_code_id,code,valid_from,expires_at)
values ('ab660000-0000-4000-8000-000000000001','ab650000-0000-4000-8000-000000000001',
  'kemore','synthetic-tax-account','synthetic-tax-code','000000010',
  current_timestamp - interval '1 day',current_timestamp + interval '30 days');
insert into public.refund_case_messages(id,refund_case_id,message_type,status,recipient_email,subject,body)
values ('ab670000-0000-4000-8000-000000000001','ab500000-0000-4000-8000-000000000002',
  'manual_note','skipped','tax-gift@example.invalid','Synthetic receipt fixture','Synthetic receipt fixture');
insert into public.refund_gift_card_issuances(refund_case_id,code_id,pool_id,normalized_email,
  purchase_amount_cents,face_value_cents,goodwill_amount_cents,currency,eligible_locations,
  expires_at,redemption_instructions,message_id,message_identity_digest,issued_at)
values ('ab500000-0000-4000-8000-000000000002','ab660000-0000-4000-8000-000000000001',
  'ab650000-0000-4000-8000-000000000001','tax-gift@example.invalid',1033,1500,467,'USD',
  array['Synthetic fixture'],current_timestamp + interval '30 days','Synthetic fixture',
  'ab670000-0000-4000-8000-000000000001','synthetic-fixture-digest',
  (current_date+1)::timestamp at time zone 'UTC');
select results_eq($$
  select request_deduction_ex_tax_cents,outstanding_context_ex_tax_cents,paid_context_ex_tax_cents,
    commissionable_sales_ex_tax_cents from private.machine_sales_daily_components(
      'ab300000-0000-4000-8000-000000000002',current_date,current_date)
$$,$$values (1000::bigint,1000::bigint,0::bigint,-1000::bigint)$$,
  'Future gift issuance does not resolve a historical report');
select results_eq($$
  select request_deduction_ex_tax_cents,outstanding_context_ex_tax_cents,paid_context_ex_tax_cents,
    commissionable_sales_ex_tax_cents from private.machine_sales_daily_components(
      'ab300000-0000-4000-8000-000000000002',current_date,current_date+1)
$$,$$values (1000::bigint,0::bigint,0::bigint,-1000::bigint)$$,
  'Gift purchase uses original dated taxable share; face value and goodwill add no deduction');

select ok(not has_table_privilege('authenticated','public.reporting_machine_tax_treatments','INSERT'), 'Direct inserts cannot bypass audited writes');
select ok(not has_table_privilege('authenticated','public.reporting_machine_tax_treatments','UPDATE'), 'Direct updates cannot bypass audited writes');
select ok(not has_function_privilege('anon','public.admin_get_reporting_machine_tax_treatments()','EXECUTE'), 'Anonymous treatment read denied');
select ok(not has_function_privilege('anon',
  'public.admin_set_reporting_machine_tax_configuration(uuid,numeric,date,text,text,numeric,text,numeric)',
  'EXECUTE'), 'Anonymous atomic configuration save denied');
select ok((select relrowsecurity from pg_class
  where oid='public.reporting_machine_tax_treatments'::regclass), 'Treatment table enables row-level security');
select ok(not has_function_privilege('authenticated',
  'private.normalize_reporting_treated_amount_cents(uuid,text,date,bigint,text,numeric,bigint,boolean)', 'EXECUTE'),
  'Internal calculation cannot expose another machine');

select public.admin_set_reporting_machine_tax_treatment(
  'ab300000-0000-4000-8000-000000000002','cash','tax_inclusive',100,current_date,'Outside scoped fixture');
select set_config('request.jwt.claim.sub','ab000000-0000-4000-8000-000000000002',true);
set local role authenticated;
select lives_ok($$select public.admin_set_reporting_machine_tax_treatment(
  'ab300000-0000-4000-8000-000000000001','cash','source_default',100,current_date,'Authorized scoped edit')$$,
  'Current scoped machine grant can save');
select ok(not exists(select 1 from jsonb_array_elements(public.admin_get_reporting_machine_tax_treatments()) value
  where value->>'machine_id'='ab300000-0000-4000-8000-000000000002'), 'Scoped read excludes other machines');
select throws_ok($$select public.admin_set_reporting_machine_tax_treatment(
  'ab300000-0000-4000-8000-000000000002','cash','tax_exclusive',100,current_date,'Out-of-scope edit')$$,
  'P0001','Scoped admin access does not include this machine','Scoped write rejects another machine');
reset role;
update public.admin_scoped_access_grants set expires_at=current_timestamp - interval '1 second',
  starts_at=current_timestamp - interval '1 day'
where id='ab600000-0000-4000-8000-000000000001';
set local role authenticated;
select throws_ok($$select public.admin_get_reporting_machine_tax_treatments()$$,
  'P0001','Admin access required','Expired scoped grant loses treatment access');
select set_config('request.jwt.claim.sub','ab000000-0000-4000-8000-000000000003',true);
select throws_ok($$select public.admin_get_reporting_machine_tax_treatments()$$,
  'P0001','Admin access required','Non-admin read denied');
select set_config('request.jwt.claim.sub','',true);
select throws_ok($$select public.admin_get_reporting_machine_tax_treatments()$$,
  'P0001','Authentication required','Missing session denied');
reset role;
select * from finish();
rollback;
