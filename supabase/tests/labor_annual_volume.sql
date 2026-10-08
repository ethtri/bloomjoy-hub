begin;
create extension if not exists pgtap with schema extensions;
set local search_path=public,extensions;
select no_plan();
\ir fixtures/labor_annual_volume.inc

-- Preserve the optimized definition, replay the deployed-before calculator,
-- and compare every canonical result in this rollback-only fixture.
create temporary table optimized_labor_definition as
select pg_get_functiondef('private.calculate_technician_pay_report(uuid,uuid,date,date)'::regprocedure) definition;
\ir fixtures/labor_before_candidate_calculator.inc
create temporary table prior_monthly_calculations as
select p.id profile_id,m.month_start::date period_start,
  private.calculate_technician_pay_report(p.account_id,p.id,m.month_start::date,
    least('2026-10-07'::date,(m.month_start+interval '1 month - 1 day')::date)) report
from public.operator_payout_profiles p cross join generate_series('2026-01-01'::timestamp,
  '2026-10-01'::timestamp,interval '1 month')m(month_start)
where p.account_id='b1824100-0000-4000-8000-000000000001';
create temporary table prior_labor_report as
select public.get_labor_analytics_report('2026-01-01','2026-10-07')-'generatedAt' report;
do $$begin execute (select definition from optimized_labor_definition); end$$;
select is((select count(*) from prior_monthly_calculations),180::bigint,'Annual Labor includes inactive profiles and all ten monthly calculations');
select results_eq(
  $$select profile_id,period_start,private.calculate_technician_pay_report(
    'b1824100-0000-4000-8000-000000000001',profile_id,period_start,
    least('2026-10-07'::date,(period_start+interval '1 month - 1 day')::date))
    from prior_monthly_calculations order by profile_id,period_start$$,
  $$select profile_id,period_start,report from prior_monthly_calculations order by profile_id,period_start$$,
  'All 180 complete calculator payloads retain exact amounts, machine attribution and blockers');
select is(public.get_labor_analytics_report('2026-01-01','2026-10-07')-'generatedAt',
  (select report from prior_labor_report),'Full annual Labor response preserves every field except request time');
select is(jsonb_array_length(private.calculate_technician_pay_report(
  'b1824100-0000-4000-8000-000000000001',md5('annual-labor-profile-18')::uuid,
  '2026-10-01','2026-10-07')->'machines'),0,'No-assignment inactive profile does not acquire company machine scope');
select ok(exists(select 1 from jsonb_array_elements(private.calculate_technician_pay_report(
  'b1824100-0000-4000-8000-000000000001',md5('annual-labor-profile-17')::uuid,
  '2026-10-01','2026-10-07')->'machines')m where m->>'machineId'=md5('annual-machine-17')::uuid::text
  and (m->>'originalPurchaseAttribution')::boolean),
  'Later request remains attributed to inactive former assignment outside the booking month');
select is((public.get_labor_analytics_report('2026-01-01','2026-10-07')->'pay'->>'partialMonthCalculationCount')::integer,
  18,'All profiles retain October partial-month classification');
select set_config('request.jwt.claim.sub','b1824000-0000-4000-8000-000000000002',true);
select is(public.get_labor_analytics_report('2026-01-01','2026-10-07')->'pay','null'::jsonb,
  'Outsider has no account payroll projection');
select * from finish();
rollback;
