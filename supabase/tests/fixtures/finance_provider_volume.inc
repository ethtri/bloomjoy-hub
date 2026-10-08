set local session_replication_role=replica;
create temporary table finance_provider_originals as
select f.id fact_id,f.reporting_machine_id,f.reporting_location_id,f.sale_date,m.nayax_machine_id,
  md5('finance-volume-adjustment-'||f.id)::uuid adjustment_id,
  (1824000000+row_number() over(order by f.sale_date,f.id))::text transaction_id,
  repeat(md5('finance-volume-refund-'||f.id),2) identity_hash
from public.machine_sales_facts f join public.reporting_machines m on m.id=f.reporting_machine_id
where f.net_sales_cents>0 and f.payment_method='credit'
  and f.reporting_location_id='b1824200-0000-4000-8000-000000000001'
order by f.sale_date,f.id limit 1000;
update public.machine_sales_facts f set tax_cents=case when o.transaction_id::bigint%4=0 then 80 else 0 end,
  raw_payload=f.raw_payload||jsonb_build_object(
  'actorId','182400','providerMachineId',o.nayax_machine_id,'transactionId',o.transaction_id,'currencyCode','USD',
  'amountBasis',case when o.transaction_id::bigint%4=1 then 'separate_tax' else 'tax_inclusive' end)
from finance_provider_originals o where f.id=o.fact_id;
insert into public.sales_adjustment_facts(id,reporting_machine_id,reporting_location_id,
  adjustment_date,adjustment_type,amount_cents,source,source_row_hash,raw_payload,created_at)
select adjustment_id,reporting_machine_id,reporting_location_id,sale_date+30,'refund',540,
  'nayax_provider_refund',identity_hash,'{}','2026-09-27' from finance_provider_originals;
insert into public.nayax_provider_refund_events(refund_identity_hash,account_key,provider_actor_id,
  provider_machine_id,original_transaction_id,event_transaction_id,currency_code,amount_cents,
  machine_event_at,evidence_kind,reporting_machine_id,adjustment_id,disposition)
select identity_hash,'TGPACI_USA_DB','182400',nayax_machine_id,transaction_id,transaction_id,'USD',540,
  (sale_date+30)::timestamp,'native_event',reporting_machine_id,adjustment_id,'applied' from finance_provider_originals;
insert into public.nayax_dtm_export_rows(file_digest,source_row_hash,provider_actor_id,provider_machine_id,
  provider_site_id,provider_transaction_id,settlement_amount_cents,machine_settled_at,provider_type,
  machine_name_hash,mapping_disposition,financial_disposition,history_scope_disposition,disposition,fact_id)
select repeat(md5('finance-volume-export'),2),repeat(md5('finance-volume-export-'||fact_id),2),'182400',nayax_machine_id,
  '182400',transaction_id,1080,sale_date::timestamp,0,identity_hash,'canonical','eligible','in_scope','fact_linked',fact_id
from finance_provider_originals;
set local session_replication_role=origin;
analyze public.sales_adjustment_facts;
analyze public.nayax_provider_refund_events;
analyze public.nayax_dtm_export_rows;


