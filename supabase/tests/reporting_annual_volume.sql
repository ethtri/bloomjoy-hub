begin;
create extension if not exists pgtap with schema extensions;
set local search_path=public,extensions;
select no_plan();

insert into auth.users(id,email,raw_app_meta_data,raw_user_meta_data)
values('b1824000-0000-4000-8000-000000000001','annual-report@example.invalid','{}','{}'),
  ('b1824000-0000-4000-8000-000000000002','annual-report-outsider@example.invalid','{}','{}');
insert into public.admin_roles(user_id,role,active)
values('b1824000-0000-4000-8000-000000000001','super_admin',true);
insert into public.customer_accounts(id,name,account_type,status)
values('b1824100-0000-4000-8000-000000000001','Annual volume fixture','internal','active');
insert into public.reporting_locations(id,account_id,name,timezone,status)
values('b1824200-0000-4000-8000-000000000001','b1824100-0000-4000-8000-000000000001','Annual fixture','America/Los_Angeles','active');
insert into public.reporting_machines(id,account_id,location_id,machine_label,machine_type,status)
select md5('annual-machine-'||n)::uuid,'b1824100-0000-4000-8000-000000000001',
  'b1824200-0000-4000-8000-000000000001','Annual machine '||n,'commercial','active'
from generate_series(1,28)n;
update private.refund_request_recognition_rollout set activated_at=now() where singleton;

-- 125,440 raw facts, including 109,760 retained zeroed source observations.
-- 15,680 daily report rows exceed both 1,000 and 10,000 API response caps.
insert into public.machine_sales_facts(reporting_machine_id,reporting_location_id,
  sale_date,payment_method,net_sales_cents,transaction_count,item_quantity,source,
  source_row_hash,source_order_hash,tax_cents,raw_payload)
select md5('annual-machine-'||machine)::uuid,'b1824200-0000-4000-8000-000000000001',
  '2026-01-01'::date+day,case when observation=1 then 'cash' else 'credit' end,
  case observation when 1 then 100 when 2 then 1100 else 0 end,
  case when observation<=2 then 1 else 0 end,1,
  case when observation=1 then 'snapcase_cash' else 'nayax_scheduled_report' end,
  md5(machine||':'||day||':'||observation),md5(machine||':'||day||':'||observation),
  case when observation=2 then 100 else 0 end,
  case when observation=2 then '{"amountBasis":"separate_tax"}'::jsonb
    else '{"amountBasis":"tax_exclusive"}'::jsonb end
from generate_series(1,28)machine cross join generate_series(0,279)day
cross join generate_series(1,16)observation;
analyze public.machine_sales_facts;
analyze public.reporting_machines;

select set_config('request.jwt.claim.sub','b1824000-0000-4000-8000-000000000001',true);
create temporary table annual_report as
select * from public.get_sales_report('2026-01-01','2026-10-07','day',
  array(select id from public.reporting_machines where account_id='b1824100-0000-4000-8000-000000000001'),null,null);
select is((select count(*) from annual_report),15680::bigint,'Annual report includes every daily machine/tender row');
select is((select sum(transaction_count)::bigint from annual_report),15680::bigint,'Annual transaction counts reconcile');
select is((select sum(net_sales_cents)::bigint from annual_report),8624000::bigint,'Annual exact net cents reconcile');
select is((select sum(tax_cents)::bigint from annual_report),784000::bigint,'Original separately sourced tax is subtracted once');
select is((select sum(unresolved_sales_count)::bigint from annual_report),0::bigint,'Separate original tax does not require guessed rate coverage');
select results_eq(
  $$select jsonb_array_elements(public.get_sales_report_complete('2026-01-01','2026-10-07','day',
    array(select id from public.reporting_machines where account_id='b1824100-0000-4000-8000-000000000001'),null,null)) order by 1$$,
  $$select to_jsonb(annual_report) from annual_report order by 1$$,
  'Complete scalar RPC preserves every row, cent and field beyond common API caps');
select is((select jsonb_array_length(public.get_sales_report_complete('2026-01-01','2026-10-07','day',null,null,null,
  'b1824100-0000-4000-8000-000000000001'))),15680,'Company complete RPC retains exact full authorized scope');
select is((select jsonb_array_length(public.get_sales_report_complete('2026-01-01','2026-10-07','day',
  array(select id from public.reporting_machines where account_id='b1824100-0000-4000-8000-000000000001'),null,array['cash']))),7840,
  'Tender filters retain full selected annual results');
select set_config('request.jwt.claim.sub','b1824000-0000-4000-8000-000000000002',true);
select is(public.get_sales_report_complete('2026-01-01','2026-10-07','day'),'[]'::jsonb,'Unauthorised actor receives no retained wider results');
select set_config('request.jwt.claim.sub','',true);
select throws_ok($$select public.get_sales_report_complete('2026-01-01','2026-10-07','day')$$,
  '42501','Authentication required','Complete report requires authentication');
select ok(not has_function_privilege('anon','public.get_sales_report_complete(date,date,text,uuid[],uuid[],text[],uuid)','execute'),
  'Anonymous role cannot execute complete report');
select is((select prorows::integer from pg_proc where oid='private.normalize_refund_original_reader_amount_cents(uuid,text,date,bigint,text,numeric,bigint,boolean)'::regprocedure),1,
  'Single-amount refund helper has exact cardinality for chained normalization');
select * from finish();
rollback;
