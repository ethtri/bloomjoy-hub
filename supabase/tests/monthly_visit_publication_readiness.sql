begin;
set local timezone='America/Los_Angeles';
create extension if not exists pgtap with schema extensions;
set local search_path=public,extensions;
select no_plan();
create function pg_temp.mid(n integer) returns uuid language sql immutable as $$select ('e1416000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid$$;
\ir fixtures/monthly_visit_compensation.inc
select set_config('request.jwt.claim.sub',pg_temp.mid(4)::text,true);
select set_config('request.jwt.claim.role','service_role',true);
select public.admin_save_monthly_visit_agreement(null,pg_temp.mid(50),pg_temp.mid(30),'2025-01-01','2025-01-31',18000,3,60,2400,true,null);
create function pg_temp.report() returns jsonb language sql as $$
 select private.calculate_technician_pay_report(pg_temp.mid(10),pg_temp.mid(50),'2025-01-01','2025-01-31')
$$;
create function pg_temp.normalized() returns jsonb language sql as $$
 select private.normalize_technician_pay_report_status(pg_temp.report(),'2025-01-01','2025-01-31','2025-02-05')
$$;
create function pg_temp.prepare() returns jsonb language plpgsql as $$
declare request_id uuid:=gen_random_uuid();
begin
 insert into public.pay_stub_generation_requests(id,account_id,operator_profile_id,payout_period_id,trigger_kind,status,requested_by,attempt_count,started_at)
 values(request_id,pg_temp.mid(10),pg_temp.mid(50),pg_temp.mid(80),'manager_regeneration','processing',pg_temp.mid(4),1,now());
 return public.service_prepare_pay_stub(request_id);
end; $$;

-- No sale on the last day is not itself missing coverage. The existing
-- normalizer accepts a closed-month snapshot matching the current source facts.
update public.machine_sales_facts set sale_date='2025-01-30' where id=pg_temp.mid(101);
select public.service_refresh_pay_stub_revenue_snapshot(pg_temp.mid(80),pg_temp.mid(30));
select ok(exists(select 1 from jsonb_array_elements(pg_temp.report()->'blockers') b
  where b->>'code' in ('stale_commission_sales_facts','stale_sales_source')),'Fixture exercises the raw last-sale freshness finding');
select is((pg_temp.normalized()->>'publishable')::boolean,true,'Existing closed-month normalization accepts matching facts');
select is((pg_temp.normalized()->>'currentTotalCents')::integer,18500,'Normalization retains monthly base plus unchanged commission');
create temp table stale_prepared as select pg_temp.prepare() result;
select is((select result->>'status' from stale_prepared),'prepared','Actual preparation accepts the normalized monthly report');
select is((select (result#>>'{payload,current,totalEarningsCents}')::integer from stale_prepared),18500,'Prepared statement keeps the complete total');
select lives_ok($$select public.service_complete_pay_stub((result->>'requestId')::uuid,(result->>'statementId')::uuid,result->>'storagePath') from stale_prepared$$,'Normalized monthly statement completes');

-- Generated empty data still blocks. Only the existing explicit zero-revenue
-- attestation can clear missing-source findings, using the same publication path.
delete from public.machine_sales_facts where id=pg_temp.mid(101);
-- The preservation contract also requires calculationComplete from the shared
-- source adapter. A fresh-schema legacy adapter has no such coverage metadata.
-- Enable the real adapter only inside this rolled-back synthetic transaction;
-- do not mock the predicate or treat missing completeness as verified zero.
insert into private.refund_request_recognition_rollout(singleton,activated_at,activated_by)
 values(true,now(),'Synthetic monthly publication readiness')
 on conflict(singleton) do update set activated_at=excluded.activated_at,activated_by=excluded.activated_by;
select public.service_refresh_pay_stub_revenue_snapshot(pg_temp.mid(80),pg_temp.mid(30));
select is((public.operator_revenue_snapshot_source_values(pg_temp.mid(80),pg_temp.mid(30))#>>'{sourceMetadata,calculationComplete}')::boolean,true,
 'Verified-zero fixture uses the complete real shared source adapter');
select is((pg_temp.normalized()->>'publishable')::boolean,false,'Generated empty snapshot remains unverified');
select is(pg_temp.prepare()->>'status','blocked','Unverified empty month cannot prepare a statement');
update public.payout_period_machine_revenue_snapshots
  set status='manual_override',manual_override_reason='Synthetic complete provider report attests zero revenue'
  where payout_period_id=pg_temp.mid(80) and reporting_machine_id=pg_temp.mid(30) and status<>'voided';
select ok(private.pay_stub_has_verified_zero_snapshot(pg_temp.mid(80),pg_temp.mid(30)),'Fixture meets the existing verified-zero contract');
select ok(exists(select 1 from jsonb_array_elements(pg_temp.report()->'blockers') b
  where b->>'code' in ('missing_sales_source','missing_commission_sales_facts')),'Verified-zero fixture still exercises raw source findings');
select is((pg_temp.normalized()->>'publishable')::boolean,true,'Existing verified-zero normalization permits publication');
select is((pg_temp.normalized()->>'currentTotalCents')::integer,18000,'Verified-zero month retains its monthly base');
create temp table zero_prepared as select pg_temp.prepare() result;
select is((select result->>'status' from zero_prepared),'prepared','Verified-zero monthly statement prepares through the real workflow');
select is((select (result#>>'{payload,current,totalEarningsCents}')::integer from zero_prepared),18000,'Verified-zero saved statement contains base and no commission');
select lives_ok($$select public.service_complete_pay_stub((result->>'requestId')::uuid,(result->>'statementId')::uuid,result->>'storagePath') from zero_prepared$$,'Verified-zero monthly statement completes');
select * from finish();
rollback;
