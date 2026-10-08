begin;
create extension if not exists pgtap with schema extensions;
set local search_path=public,extensions;
select no_plan();
insert into auth.users(id,email,raw_app_meta_data,raw_user_meta_data) select
  ('b1828000-0000-4000-8000-00000000000'||n)::uuid,'access-seek-'||n||'@example.invalid','{}','{}'
from generate_series(1,3)n;
insert into public.admin_roles(user_id,role,active)
values('b1828000-0000-4000-8000-000000000001','super_admin',true);
insert into public.customer_accounts(id,name,account_type)values
  ('b1828100-0000-4000-8000-000000000001','Seek authorized account','internal'),
  ('b1828100-0000-4000-8000-000000000002','Seek outside account','internal');
insert into public.reporting_locations(id,account_id,name,timezone)values
  ('b1828200-0000-4000-8000-000000000001','b1828100-0000-4000-8000-000000000001','Seek authorized','UTC'),
  ('b1828200-0000-4000-8000-000000000002','b1828100-0000-4000-8000-000000000002','Seek outside','UTC');
insert into public.reporting_machines(id,account_id,location_id,machine_label)values
  ('b1828300-0000-4000-8000-000000000001','b1828100-0000-4000-8000-000000000001','b1828200-0000-4000-8000-000000000001','Seek with facts'),
  ('b1828300-0000-4000-8000-000000000002','b1828100-0000-4000-8000-000000000001','b1828200-0000-4000-8000-000000000001','Seek without facts'),
  ('b1828300-0000-4000-8000-000000000003','b1828100-0000-4000-8000-000000000002','b1828200-0000-4000-8000-000000000002','Seek outside future');
insert into public.admin_scoped_access_grants(id,user_id,grant_reason)values
  ('b1828400-0000-4000-8000-000000000001','b1828000-0000-4000-8000-000000000002','Synthetic narrow access');
insert into public.admin_scoped_access_scopes(grant_id,scope_type,machine_id,grant_reason)
select 'b1828400-0000-4000-8000-000000000001','machine',
  ('b1828300-0000-4000-8000-00000000000'||n)::uuid,'Synthetic machine scope' from generate_series(1,2)n;
insert into public.machine_sales_facts(reporting_machine_id,reporting_location_id,sale_date,
  payment_method,net_sales_cents,transaction_count,source,source_row_hash)values
  ('b1828300-0000-4000-8000-000000000001','b1828200-0000-4000-8000-000000000001','2026-09-30','cash',100,1,'snapcase_cash','seek-positive'),
  ('b1828300-0000-4000-8000-000000000001','b1828200-0000-4000-8000-000000000001','2026-10-07','credit',0,0,'nayax_scheduled_report','seek-retained-zero'),
  ('b1828300-0000-4000-8000-000000000003','b1828200-0000-4000-8000-000000000002','2099-01-01','credit',0,0,'nayax_scheduled_report','seek-outside-zero');
insert into public.sales_import_runs(source,status,completed_at)values
  ('sample_seed','completed','2026-10-08T00:00:00Z'),('sample_seed','failed','2099-10-08T00:00:00Z');
create function pg_temp.read_access_for_actor(actor uuid)returns jsonb language plpgsql as $$
begin
  perform set_config('request.jwt.claim.sub',actor::text,true);
  return(select to_jsonb(r) from public.get_my_reporting_access_context()r);
end;$$;
create temporary table optimized_access_definition as select
  pg_get_functiondef('public.get_my_reporting_access_context()'::regprocedure) definition;
create temporary table access_security as select prosecdef,provolatile,prorows,proconfig,proacl
  from pg_proc where oid='public.get_my_reporting_access_context()'::regprocedure;
\ir fixtures/reporting_access_before.inc
create temporary table prior_access as select ('b1828000-0000-4000-8000-00000000000'||n)::uuid actor,
  pg_temp.read_access_for_actor(('b1828000-0000-4000-8000-00000000000'||n)::uuid) report from generate_series(1,3)n;
do $$begin execute(select definition from optimized_access_definition);end$$;
select results_eq(
  $$select actor,pg_temp.read_access_for_actor(actor) from prior_access order by actor$$,
  $$select actor,report from prior_access order by actor$$,
  'All six access fields match exactly for owner, narrow scoped admin and outsider');
select is(pg_temp.read_access_for_actor('b1828000-0000-4000-8000-000000000002')->>'latest_sale_date',
  '2026-10-07','Latest raw zeroed fact remains included; newer outside-scope evidence remains excluded');
select is((pg_temp.read_access_for_actor('b1828000-0000-4000-8000-000000000002')->>'accessible_machine_count')::integer,
  2,'Authorized machine with no facts remains in the machine count');
select is(pg_temp.read_access_for_actor('b1828000-0000-4000-8000-000000000003')->'latest_sale_date',
  'null'::jsonb,'No accessible machines still yields NULL latest date');
select is(pg_temp.read_access_for_actor('b1828000-0000-4000-8000-000000000003')->>'latest_import_completed_at',
  '2026-10-08T00:00:00+00:00','Existing global completed-import metadata remains unchanged for all caller scopes');
select results_eq(
  $$select prosecdef,provolatile,prorows,proconfig,proacl from pg_proc
    where oid='public.get_my_reporting_access_context()'::regprocedure$$,
  $$select * from access_security$$,'Access definer/volatility/ROWS/search-path/ACL remain unchanged');
select set_config('request.jwt.claim.sub','',true);
select throws_ok('select * from public.get_my_reporting_access_context()','P0001','Authentication required',
  'Unauthenticated access still raises the same error');
select * from finish();
rollback;

