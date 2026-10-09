begin;
create extension if not exists pgtap with schema extensions;
set local search_path=public,extensions;
select no_plan();
-- Keep the 125,440 raw facts and 80,000 decoy DTM rows in the reusable source
-- fixtures. Seventeen authorised machines return 9,520 annual rows, matching
-- the production report size. One provisional, one confirmed and uncovered
-- source groups prove both active policy paths and remaining unknown amounts.
\ir fixtures/labor_annual_volume.inc
\ir fixtures/finance_provider_volume.inc
set local session_replication_role=replica;
-- Retain all exact originals and 81,000 DTM rows, but match the production
-- provider-event volume rather than adding a thousand extra financial events.
delete from public.nayax_provider_refund_events where adjustment_id in
 (select adjustment_id from finance_provider_originals order by transaction_id offset 393);
delete from public.sales_adjustment_facts where id in
 (select adjustment_id from finance_provider_originals order by transaction_id offset 393);
update public.machine_sales_facts set tax_cents=0,raw_payload=raw_payload||jsonb_build_object('amountBasis','tax_inclusive','actorId','2003563806','providerMachineId',(1824000000+n)::text,'currencyCode','USD')
from generate_series(1,8)n where reporting_machine_id=md5('annual-machine-'||n)::uuid and net_sales_cents>0 and payment_method='credit';
delete from private.nayax_machine_tax_observations where nayax_machine_id in(select (1824000000+n)::text from generate_series(1,7)n);
insert into private.reporting_machine_rate_policies(machine_id,rate_percent,status,starts_on,reason,created_by)
select md5('annual-machine-'||n)::uuid,case when n=8 then 9 else 8 end,case when n=8 then 'confirmed' else 'provisional' end,'2026-01-01','Synthetic active-volume policy','b1824000-0000-4000-8000-000000000001' from generate_series(1,8)n where n in(1,8);
update public.machine_sales_facts f set net_sales_cents=1080,tax_cents=0,
 raw_payload=(f.raw_payload-'_salesAuthorityOriginal')||jsonb_build_object('amountBasis','tax_inclusive')
where f.id=(select fact_id from finance_provider_originals where reporting_machine_id=md5('annual-machine-1')::uuid order by transaction_id limit 1);
update public.sales_adjustment_facts set created_at='2025-12-31' where id=(select adjustment_id from finance_provider_originals where reporting_machine_id=md5('annual-machine-1')::uuid order by transaction_id limit 1);
set local session_replication_role=origin;
select is((select private.provider_refund_original_source_tax_cents(adjustment_id,540)
 from finance_provider_originals where reporting_machine_id=md5('annual-machine-1')::uuid order by transaction_id limit 1),null::bigint,'Provisional policy leaves exact provider refund canonical tax unknown');
select is((select private.provider_refund_original_source_tax_cents_estimate(adjustment_id,540)
 from finance_provider_originals where reporting_machine_id=md5('annual-machine-1')::uuid order by transaction_id limit 1),40::bigint,'Exact provider-original provisional path computes incremental estimate');
analyze public.machine_sales_facts;
analyze private.reporting_machine_rate_policies;
select is((select sum(refund_cents) from private.machine_rate_estimated_components(md5('annual-machine-1')::uuid,
 (select sale_date+30 from finance_provider_originals where reporting_machine_id=md5('annual-machine-1')::uuid order by transaction_id limit 1),
 (select sale_date+30 from finance_provider_originals where reporting_machine_id=md5('annual-machine-1')::uuid order by transaction_id limit 1))),500::numeric,'Exact native refund estimate reaches reporting component adapter');
create temp table policy_volume_timing(label text,elapsed interval);
do $volume$
declare t timestamptz; r record; preview jsonb;
begin
 t:=clock_timestamp();
 select count(*) rows,sum(octet_length(to_jsonb(s)::text)) bytes,
 sum((s.tax_policy_evidence->>'provisionalSalesComponents')::bigint) provisional,
 sum(s.gross_sales_unknown_count) unknown into r
 from private.sales_report_rows_for_actor('b1824000-0000-4000-8000-000000000001','2026-01-01','2026-10-07','day',array(select md5('annual-machine-'||n)::uuid from generate_series(1,17)n),null,null)s;
 if coalesce(r.provisional,0)=0 or r.unknown<=r.provisional then raise exception 'Representative volume must include estimates and remaining unknown amounts'; end if;
 insert into policy_volume_timing values('annual',clock_timestamp()-t);
 t:=clock_timestamp();
 preview:=public.admin_preview_reporting_machine_rate_policy(md5('annual-machine-1')::uuid,9,'provisional','2026-01-01',null,'Synthetic busy preview',null);
 insert into policy_volume_timing values('preview',clock_timestamp()-t);
 t:=clock_timestamp();
 perform public.admin_save_reporting_machine_rate_policy(md5('annual-machine-1')::uuid,9,'provisional','2026-01-01',null,'Synthetic busy preview',null,(preview->>'previewToken')::uuid);
 insert into policy_volume_timing values('save',clock_timestamp()-t);
end;
$volume$;
select ok(elapsed<interval '8 seconds','Representative annual active-policy complete-row workload below eight seconds') from policy_volume_timing where label='annual';
select * from policy_volume_timing;
select * from finish();
rollback;