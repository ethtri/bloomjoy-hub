begin;
create extension if not exists pgtap with schema extensions;
set local search_path=public,extensions;
select no_plan();
\ir fixtures/labor_annual_volume.inc

-- Inclusive card amounts exercise dated-rate lookup instead of the earlier
-- separately imported tax fast path. Half use original-reader history; most
-- evidence is explicitly missing, preserving unknown monetary results.
-- Read-path fixture only: preserve the same setup boundary as the bulk seed.
set local session_replication_role=replica;
update public.machine_sales_facts f
set net_sales_cents=1080,tax_cents=0,
  raw_payload=jsonb_build_object('amountBasis','tax_inclusive','providerMachineId',m.nayax_machine_id)
from public.reporting_machines m where m.id=f.reporting_machine_id
  and f.net_sales_cents>0 and f.payment_method='credit'
  and f.reporting_location_id='b1824200-0000-4000-8000-000000000001';
set local session_replication_role=origin;
update private.nayax_machine_tax_observations set classification='missing',rate_percent=null
where provenance='Disposable Labor parity fixture' and nayax_machine_id::bigint%4<>0;
insert into private.machine_nayax_reader_associations(account_key,nayax_machine_id,
  reporting_machine_id,ownership_basis,created_by,reason)
select 'TGPACI_USA_DB',m.nayax_machine_id,m.id,'same_physical_machine_all_history',
  'b1824000-0000-4000-8000-000000000001','Synthetic original-reader plan parity'
from public.reporting_machines m
where m.location_id='b1824200-0000-4000-8000-000000000001' and m.nayax_machine_id::bigint%2=0;

create temporary table optimized_source_tax_definition as select pg_get_functiondef(
  'private.resolve_reporting_machine_source_tax(uuid,date)'::regprocedure) definition;
create temporary table source_tax_security as select prosecdef,provolatile,prorows,proconfig,proacl
from pg_proc where oid='private.resolve_reporting_machine_source_tax(uuid,date)'::regprocedure;
\ir fixtures/reporting_source_tax_before.inc
create temporary table prior_source_reports as select
  public.get_sales_report_complete('2026-01-01','2026-10-07','day') sales,
  public.get_labor_analytics_report('2026-01-01','2026-10-07')-'generatedAt' labor,
  public.get_refund_analytics('2026-01-01','2026-10-07')-'generatedAt' refunds;
create temporary table source_tax_inputs as
select m.id machine_id,d.day from public.reporting_machines m
cross join unnest(array['2025-12-31'::date,'2026-01-01','2026-07-15','2026-10-07','2027-01-01',null])d(day)
where m.location_id='b1824200-0000-4000-8000-000000000001'
union all select null::uuid,null::date
union all select 'b1824999-0000-4000-8000-000000000001'::uuid,'2026-10-07'::date;
create temporary table prior_source_rows as select i.*,r.* from source_tax_inputs i
cross join lateral private.resolve_reporting_machine_source_tax(i.machine_id,i.day) r;
do $$begin execute(select definition from optimized_source_tax_definition);end$$;

select results_eq(
  $$select i.*,r.* from source_tax_inputs i cross join lateral
    private.resolve_reporting_machine_source_tax(i.machine_id,i.day)r order by machine_id,day$$,
  $$select * from prior_source_rows order by machine_id,day$$,
  'Prepared resolver retains exact dated/missing/original-reader tuple values and row counts');
select is(public.get_sales_report_complete('2026-01-01','2026-10-07','day'),
  (select sales from prior_source_reports),'Complete inclusive/unknown annual Sales payload remains identical');
select is(public.get_labor_analytics_report('2026-01-01','2026-10-07')-'generatedAt',
  (select labor from prior_source_reports),'Complete inclusive/unknown annual Labor payload remains identical');
select is(public.get_refund_analytics('2026-01-01','2026-10-07')-'generatedAt',
  (select refunds from prior_source_reports),'Complete inclusive/unknown annual Refunds payload remains identical');
select is((select count(*) from private.resolve_reporting_machine_source_tax(null,'2026-10-07')),
  0::bigint,'NULL machine still returns zero resolver rows');
select is((select count(*) from private.resolve_reporting_machine_source_tax(
  'b1824999-0000-4000-8000-000000000001','2026-10-07')),0::bigint,
  'Absent machine still returns zero resolver rows');
select is((select coverage_status from private.resolve_reporting_machine_source_tax(md5('annual-machine-4')::uuid,null)),
  'missing','NULL date retains the one-row missing-evidence result for an existing machine');
select results_eq(
  $$select prosecdef,provolatile,prorows,proconfig,proacl from pg_proc
    where oid='private.resolve_reporting_machine_source_tax(uuid,date)'::regprocedure$$,
  $$select * from source_tax_security$$,'Resolver definer/volatility/ROWS/search-path/ACL remain unchanged');
-- Plan reuse is not result caching: newly recorded dated evidence must be read.
insert into private.nayax_machine_tax_observations(account_key,nayax_machine_id,observed_at,
  source,classification,rate_percent,provenance,effective_start_date,effective_end_date)
values('TGPACI_USA_DB','1824000004','2026-10-07T01:00:00Z','finance_verified',
  'verified_tax',0,'Synthetic newly recorded zero-rate evidence','2026-01-01','2026-12-31');
select is((select rate_percent from private.resolve_reporting_machine_source_tax(md5('annual-machine-4')::uuid,'2026-10-07')),
  0::numeric,'Prepared resolver sees newly recorded evidence and preserves a proved zero rate');
select * from finish();
rollback;
