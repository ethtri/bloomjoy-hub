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
update public.reporting_machines set nayax_machine_id='1763001',nayax_account_key='TGPACI_USA_DB'
where id='ab300000-0000-4000-8000-000000000001';
insert into private.nayax_machine_tax_observations(account_key,nayax_machine_id,observed_at,source,
 classification,rate_percent,provenance,effective_start_date,effective_end_date)
values('TGPACI_USA_DB','1763001',now(),'finance_verified','verified_tax',8,
 'Synthetic dated Finance confirmation',current_date-30,current_date-1);
select results_eq($$select tax_exclusive_amount_cents,tax_cents
 from private.normalize_reporting_treated_amount_cents('ab300000-0000-4000-8000-000000000001','cash',current_date-5,1000,'tax_inclusive',8,80,true)
$$,$$values(1000::bigint,0::bigint)$$,'Cash sale and refund preserve full collected amount regardless of configured tax or source basis');
select results_eq($$select tax_exclusive_amount_cents,tax_cents
 from private.normalize_reporting_treated_amount_cents('ab300000-0000-4000-8000-000000000001','card',current_date-5,10800,'tax_inclusive',99,null,true)
$$,$$values(10000::bigint,800::bigint)$$,'Verified original-date source rate supersedes manual rate');
select results_eq($$select tax_exclusive_amount_cents,tax_cents
 from private.normalize_reporting_treated_amount_cents('ab300000-0000-4000-8000-000000000001','card',current_date,10800,'tax_inclusive',8,null,true)
$$,$$values(null::bigint,null::bigint)$$,'Expired historical rate is not extended into an unverified date');
select results_eq($$select tax_exclusive_amount_cents,tax_cents
 from private.normalize_reporting_treated_amount_cents('ab300000-0000-4000-8000-000000000001','card',current_date,10800,'tax_inclusive',8,700,true)
$$,$$values(10100::bigint,700::bigint)$$,'Actual transaction tax wins even without a verified rate');
select results_eq($$select tax_exclusive_amount_cents,tax_cents
 from private.normalize_reporting_treated_amount_cents('ab300000-0000-4000-8000-000000000001','card',current_date,10800,'unknown',8,700,true)
$$,$$values(10100::bigint,700::bigint)$$,'Exact original charge tax supplies a split when historical basis was unknown');
select results_eq($$select tax_exclusive_amount_cents,tax_cents
 from private.normalize_reporting_treated_amount_cents('ab300000-0000-4000-8000-000000000001','card',current_date,10800,'separate_tax',8,0,true)
$$,$$values(10800::bigint,0::bigint)$$,'Explicit zero actual tax is preserved');
select results_eq($$select tax_exclusive_amount_cents,tax_cents
 from private.normalize_reporting_treated_amount_cents('ab300000-0000-4000-8000-000000000001','card',current_date-5,5,'tax_inclusive',8,null,true)
$$,$$values(5::bigint,0::bigint)$$,'Minor-unit rounding stays at cents');
select results_eq($$select tax_exclusive_amount_cents,tax_cents
 from private.normalize_reporting_treated_amount_cents('ab300000-0000-4000-8000-000000000003','card',current_date,10800,'tax_inclusive',8,null,true)
$$,$$values(null::bigint,null::bigint)$$,'Unconnected source does not invent a zero-tax split');
select results_eq($$select tax_exclusive_amount_cents,tax_cents
 from private.normalize_reporting_treated_amount_cents('ab300000-0000-4000-8000-000000000003','cash',current_date,1000,'unknown',8,null,true)
$$,$$values(1000::bigint,0::bigint)$$,'Untaxed cash requires no connected reader');
select results_eq($$select tax_exclusive_amount_cents,tax_cents
 from private.normalize_reporting_treated_amount_cents('ab300000-0000-4000-8000-000000000003','card',current_date,0,'unknown',null,null,true)
$$,$$values(0::bigint,0::bigint)$$,'Zero recognition target has known zero tax');
select ok(not has_function_privilege('authenticated','private.normalize_reporting_treated_amount_cents(uuid,text,date,bigint,text,numeric,bigint,boolean)','execute'),'Private normalization remains inaccessible');
select ok(not has_function_privilege('anon','private.machine_sales_daily_waterfall_components(uuid,date,date)','execute'),'Private waterfall cannot bypass report scope');
select * from finish();
rollback;
