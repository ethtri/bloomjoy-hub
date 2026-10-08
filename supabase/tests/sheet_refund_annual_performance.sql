begin;
create extension if not exists pgtap with schema extensions;
set local search_path=public,extensions;
select no_plan();
\ir fixtures/labor_annual_volume.inc
\ir fixtures/finance_provider_volume.inc
\ir fixtures/sheet_refund_volume.inc

create temporary table sheet_volume_inputs as select n,
 md5('sheet-volume-adjustment-'||n)::uuid adjustment_id,md5('sheet-volume-review-'||n)::uuid review_id,
 case when n<=35 then 'b1824300-0000-4000-8000-000000000091'::uuid
   when n<=50 then 'b1824300-0000-4000-8000-000000000092'::uuid
   else 'b1824300-0000-4000-8000-000000000093'::uuid end machine_id,
 case when n between 36 and 39 then 'cash' else 'credit' end tender,
 '2026-07-01'::date+n original_date,repeat(md5('sheet-volume-hash-'||n),2) source_hash
from generate_series(2,54)n;
insert into refund_adjustment_review_rows(id,source_reference,source_row_reference,source_row_hash,source_location,
 refund_date,original_order_date,amount_cents,match_status,match_confidence,matched_machine_id)
select review_id,'sheet:synthetic','volume-'||n,source_hash,'Sheet site','2026-09-30',original_date,1080,'applied',1,machine_id
from sheet_volume_inputs;
insert into sales_adjustment_facts(id,reporting_machine_id,reporting_location_id,adjustment_date,adjustment_type,
 amount_cents,source,source_reference,source_row_reference,source_row_hash,raw_payload,created_at,refund_review_row_id,match_status,match_confidence)
select adjustment_id,machine_id,'b1824200-0000-4000-8000-000000000091','2026-09-30','refund',1080,
 'google_sheets','sheet:synthetic','volume-'||n,source_hash,
 jsonb_build_object('amount_source','refund_amount','source_status','Closed','source_decision','Approve',
   'original_order_date',original_date,'source_location','Sheet site','refund_date','2026-09-30'),
 '2026-09-30',review_id,'applied',1 from sheet_volume_inputs;
create temporary table sheet_volume_financial_before as select id,to_jsonb(adjustment)-array['raw_payload','updated_at'] financial
 from sales_adjustment_facts adjustment where source_reference='sheet:synthetic';
create temporary table sheet_volume_proofs as select jsonb_agg(jsonb_build_object(
 'id',adjustment.id,'sourceReference',adjustment.source_reference,'sourceRowReference',adjustment.source_row_reference,
 'sourceRowHash',adjustment.source_row_hash,'machineId',adjustment.reporting_machine_id,'refundDate',adjustment.adjustment_date,
 'originalOrderDate',adjustment.raw_payload->>'original_order_date','amountCents',adjustment.amount_cents,
 'originalTender',coalesce(input.tender,'credit'),'amountSource','refund_amount')) proofs
 from sales_adjustment_facts adjustment left join sheet_volume_inputs input on input.adjustment_id=adjustment.id
 where adjustment.source_reference='sheet:synthetic';
select is((public.service_reconcile_sheet_refund_source_evidence((select proofs from sheet_volume_proofs),'Synthetic reviewed 54 original Sheet rows')->>'changed')::integer,
 54,'All fifty-four exact source rows gain evidence without rebooking');
select is((public.service_reconcile_sheet_refund_source_evidence((select proofs from sheet_volume_proofs),'Synthetic replay')->>'changed')::integer,
 0,'Fifty-four-row evidence replay makes no further changes');
select is((select count(*) from sales_adjustment_facts adjustment join sheet_volume_financial_before original using(id)
 where to_jsonb(adjustment)-array['raw_payload','updated_at'] is distinct from original.financial),0::bigint,
 'All fifty-four financial rows, hashes, fingerprints and recognition dates remain identical');
create temporary table sheet_volume_components as select component.*
 from unnest(array['b1824300-0000-4000-8000-000000000091'::uuid,'b1824300-0000-4000-8000-000000000092','b1824300-0000-4000-8000-000000000093']) machine(id)
 cross join lateral private.machine_sales_daily_components(machine.id,'2026-09-30','2026-09-30') component;
-- Canonical components group multiple refunds by Machine/tender/day. Count
-- source adjustments, subtracting the canonical unresolved event count.
select is((select count(*) from sheet_volume_financial_before)-(select sum(unresolved_refund_count) from sheet_volume_components),39::numeric,
 'Thirty-five proved card and four cash refunds normalize; fifteen unsupported card refunds stay unknown');
select is((select sum(legacy_paid_deduction_ex_tax_cents) from sheet_volume_components),39320::numeric,
 'Known refund subtotal preserves both normalized card cents and actual cash cents');
select is((select sum(unresolved_refund_count) from sheet_volume_components),15::numeric,
 'Conflicting and missing reader evidence remains explicitly unresolved');
select ok((select count(*) from public.machine_sales_facts)>125000
 and (select count(*) from public.nayax_dtm_export_rows)>=81000,
 'Annual calculation runs with production-sized source facts and import evidence');
create temporary table sheet_annual_budget as select clock_timestamp() started_at,current_setting('statement_timeout') prior_timeout;
set local statement_timeout='8s';
create temporary table sheet_annual_money as select count(*) row_count,
 sum(net_sales_known_cents) known_net,sum(gross_sales_known_cents) known_gross,
 sum(refund_amount_known_cents) known_refunds,sum(customer_receipts_known_cents) known_receipts,
 sum(unresolved_sales_count) missing_sales,sum(unresolved_refund_count) missing_refunds
from private.sales_report_rows_for_actor('b1824000-0000-4000-8000-000000000001','2026-01-01','2026-10-07','day',null,null,null);
select set_config('statement_timeout',(select prior_timeout from sheet_annual_budget),true);
select ok((select row_count from sheet_annual_money)>10000
 and clock_timestamp()-(select started_at from sheet_annual_budget)<interval '8 seconds',
 'Actual populated annual monetary projection with repaired Sheet refunds stays below eight seconds');
select diag('Annual monetary milliseconds='||round(extract(epoch from clock_timestamp()-(select started_at from sheet_annual_budget))*1000));
select lives_ok(current_setting('bloomjoy.test.sheet_refund_migration'),
 'Actual atomic forward migration also passes its live guard over the populated repaired annual report');
select * from finish();
rollback;
