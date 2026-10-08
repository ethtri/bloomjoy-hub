begin;
create extension if not exists pgtap with schema extensions;
set local search_path=public,extensions;
select no_plan();
\ir fixtures/labor_annual_volume.inc

-- Exercise original-reader dated tax, unknown tax, separate zero tax and actual
-- source tax in a populated full Finance response, not just scalar empty joins.
set local session_replication_role=replica;
update public.machine_sales_facts f set net_sales_cents=1080,tax_cents=0,
  raw_payload=jsonb_build_object('amountBasis','tax_inclusive','actorId','2003563806','currencyCode','USD','providerMachineId',m.nayax_machine_id)
from public.reporting_machines m where m.id=f.reporting_machine_id
  and f.net_sales_cents>0 and f.payment_method='credit'
  and f.reporting_location_id='b1824200-0000-4000-8000-000000000001';
set local session_replication_role=origin;
update private.nayax_machine_tax_observations set classification='missing',rate_percent=null
where provenance='Disposable Labor parity fixture' and nayax_machine_id::bigint%4<>0;
insert into private.machine_nayax_reader_associations(account_key,nayax_machine_id,
  reporting_machine_id,ownership_basis,created_by,reason)
select 'TGPACI_USA_DB',m.nayax_machine_id,m.id,'same_physical_machine_all_history',
  'b1824000-0000-4000-8000-000000000001','Synthetic Finance provider plan parity'
from public.reporting_machines m where m.location_id='b1824200-0000-4000-8000-000000000001'
  and m.nayax_machine_id::bigint%2=0;
\ir fixtures/finance_provider_volume.inc

create temporary table optimized_finance_helpers as select oid::regprocedure signature,
  pg_get_functiondef(oid) definition,prosecdef,provolatile,proconfig,proacl
from pg_proc where oid in('private.provider_refund_original_sale_date(uuid)'::regprocedure,
  'private.provider_refund_original_source_tax_cents(uuid,bigint)'::regprocedure);
\ir fixtures/finance_provider_before.inc
create temporary table prior_finance_payloads as select
  public.get_finance_reporting('2026-01-01','2026-10-07')-'generatedAt' annual,
  public.get_finance_reporting('2026-01-01','2026-10-07',array[md5('annual-machine-1')::uuid])-'generatedAt' machine,
  public.get_finance_reporting('2026-01-01','2026-10-07',null,array['b1824200-0000-4000-8000-000000000001'::uuid])-'generatedAt' location;
create temporary table finance_helper_inputs as
select o.adjustment_id,a.amount from finance_provider_originals o
cross join unnest(array[null::bigint,-1,0,540,1080,1081,9223372036854775807]) a(amount)
union all select null::uuid,null::bigint
union all select 'b1824999-0000-4000-8000-000000000001'::uuid,540::bigint;
create temporary table prior_finance_helper_outputs as select i.*,
  private.provider_refund_original_sale_date(i.adjustment_id) original_date,
  private.provider_refund_original_source_tax_cents(i.adjustment_id,i.amount) source_tax
from finance_helper_inputs i;
do $$declare r record;begin for r in select definition from optimized_finance_helpers loop execute r.definition;end loop;end$$;
\ir fixtures/finance_promoted_originals.inc
select ok((select count(*) from finance_promoted_originals)=4
  and (select count(*) from public.nayax_dtm_export_rows evidence
    join finance_promoted_originals original on evidence.source_order_hash=original.promoted_order_hash)=4
  and (select count(*) from public.nayax_pending_sales pending
    join finance_promoted_originals original on pending.source_order_hash=original.promoted_order_hash)=4
  and (select count(*) from public.nayax_dtm_export_rows
    where file_digest=repeat(md5('finance-volume-decoy-export'),2)
      and source_order_hash is null
      and ((disposition='fact_linked' and fact_id is not null)
        or (disposition='queued_excluded' and fact_id is null)))=80000,
  'Exactly four original transactions promoted while all eighty thousand decoys remain unchanged');
-- Ordinary linked originals retain the indexed prepared join. This populated
-- budget catches a promotion resolver accidentally scanning all 125,440 facts
-- for each of the 1,000 linked originals, without waiting for a workflow timeout.
create temporary table linked_original_plan_budget as select
  current_setting('statement_timeout') prior_timeout,clock_timestamp() started_at;
set local statement_timeout='8s';
create temporary table linked_original_tax_probe as select adjustment_id,
  private.provider_refund_original_source_tax_cents(adjustment_id,540) source_tax
from finance_provider_originals;
select set_config('statement_timeout',(select prior_timeout from linked_original_plan_budget),true);
select ok((select count(*) from linked_original_tax_probe)=1000
  and clock_timestamp()-(select started_at from linked_original_plan_budget)<interval '8 seconds',
  'One thousand originals including four promoted keep fast indexed tax plans');
create temporary table annual_reporting_budget as select clock_timestamp() started_at;
set local statement_timeout='8s';
create temporary table annual_reporting_money_probe as select count(*) row_count,
  sum(net_sales_known_cents) known_net,sum(gross_sales_known_cents) known_gross,
  sum(refund_amount_known_cents) known_refunds,sum(customer_receipts_known_cents) known_receipts,
  sum(unresolved_sales_count) unknown_sales,sum(unresolved_refund_count) unknown_refunds
from private.sales_report_rows_for_actor('b1824000-0000-4000-8000-000000000001',
  '2026-01-01','2026-10-07','day',null,null,null);
select set_config('statement_timeout',(select prior_timeout from linked_original_plan_budget),true);
select ok((select row_count from annual_reporting_money_probe)>10000
  and clock_timestamp()-(select started_at from annual_reporting_budget)<interval '8 seconds',
  'Populated annual monetary report including four promoted originals remains below eight seconds');
select is(public.get_finance_reporting('2026-01-01','2026-10-07')-'generatedAt',
  (select annual from prior_finance_payloads),'Complete populated annual Finance matches prior functions');
select is(public.get_finance_reporting('2026-01-01','2026-10-07',array[md5('annual-machine-1')::uuid])-'generatedAt',
  (select machine from prior_finance_payloads),'Machine-filtered complete Finance payload matches');
select is(public.get_finance_reporting('2026-01-01','2026-10-07',null,array['b1824200-0000-4000-8000-000000000001'::uuid])-'generatedAt',
  (select location from prior_finance_payloads),'Location-filtered complete Finance payload matches');
select is((select count(*) from prior_finance_helper_outputs p where
  p.original_date is distinct from private.provider_refund_original_sale_date(p.adjustment_id)
  or ((p.source_tax is not null or p.amount is null or p.amount<0 or p.amount>1080)
    and p.source_tax is distinct from private.provider_refund_original_source_tax_cents(p.adjustment_id,p.amount))),
  0::bigint,'All scalar dates, previously known tax and NULL/out-of-bounds inputs retain prior results');
select ok((select count(*) from prior_finance_helper_outputs p where
  p.source_tax is null and p.amount between 0 and 1080
  and private.provider_refund_original_source_tax_cents(p.adjustment_id,p.amount) is not null)>0,
  'Exact source reader resolves supported tax even without historical association');
select is((select count(*) from prior_finance_helper_outputs p
  join finance_provider_originals original on original.adjustment_id=p.adjustment_id
  left join lateral(select case when evidence.classification='verified_tax' then evidence.rate_percent end rate_percent
    from private.nayax_machine_tax_observations evidence
    where evidence.account_key='TGPACI_USA_DB' and evidence.nayax_machine_id=original.nayax_machine_id
      and evidence.effective_start_date<=original.sale_date
      and coalesce(evidence.effective_end_date,'infinity'::date)>=original.sale_date
    order by (evidence.classification<>'unavailable') desc,evidence.effective_start_date desc,
      evidence.observed_at desc,evidence.id limit 1) source on true
  cross join lateral private.normalize_financial_amount_cents(p.amount,
    case when p.amount=0 then 'tax_exclusive' when source.rate_percent is null then 'unknown' else 'tax_inclusive' end,source.rate_percent,null) expected
  where p.source_tax is null and p.amount between 0 and 1080
    and private.provider_refund_original_source_tax_cents(p.adjustment_id,p.amount) is distinct from expected.tax_cents),
  0::bigint,'Every newly supported split equals exact dated source rate normalization, never guessed tax');
select is((select count(*) from prior_finance_helper_outputs p where amount=540
  and private.provider_refund_original_source_tax_cents(p.adjustment_id,p.amount) is null)>0,
  true,'Unknown original-date source tax remains NULL');
select is((select count(*) from prior_finance_helper_outputs where amount=540 and source_tax=0)>0,
  true,'Separately proved zero tax remains known zero');
select is((select count(*) from optimized_finance_helpers old join pg_proc p on p.oid=old.signature::oid
  where (old.prosecdef,old.provolatile,old.proconfig,old.proacl) is distinct from
    (p.prosecdef,p.provolatile,p.proconfig,p.proacl)),0::bigint,'Both helper execution security and volatility are unchanged');
select set_config('request.jwt.claim.sub','b1824000-0000-4000-8000-000000000002',true);
select throws_ok($$select public.get_finance_reporting('2026-01-01','2026-10-07')$$,
  '42501','Authorized sales and refund reporting access required','Outsider Finance access remains denied');
select set_config('request.jwt.claim.sub','b1824000-0000-4000-8000-000000000001',true);
select throws_ok($$select public.get_finance_reporting(null,'2026-10-07')$$,
  '22023','Choose a valid reporting period of up to 367 days','Finance invalid-period SQLSTATE is unchanged');
select * from finish();
rollback;
