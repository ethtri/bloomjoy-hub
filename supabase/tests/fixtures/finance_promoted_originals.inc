-- Convert four already-known synthetic originals to the exact approved
-- historical promotion evidence path without changing any recorded money.
set local session_replication_role=replica;
create temporary table finance_promoted_originals as
select original.*,repeat(md5('promoted-plan-'||original.fact_id),2) promoted_order_hash
from finance_provider_originals original
where original.nayax_machine_id::bigint%4=0 order by original.fact_id limit 4;
update public.machine_sales_facts fact set source_order_hash=original.promoted_order_hash,
  raw_payload=fact.raw_payload||'{"manualDtmEvidence":true,"historicalInactiveExactLinkRecovery":true}'::jsonb
from finance_promoted_originals original where fact.id=original.fact_id;
update public.nayax_dtm_export_rows evidence set source_order_hash=original.promoted_order_hash,
  fact_id=null,disposition='queued_excluded',mapping_disposition='historical_inactive_exact_link',provider_status=62
from finance_promoted_originals original where evidence.fact_id=original.fact_id;
insert into public.nayax_dtm_export_completions(file_digest,rows_recorded,facts_linked,adjustments_linked,pending_rows,held_rows)
select evidence.file_digest,1000,996,0,4,0 from public.nayax_dtm_export_rows evidence
join finance_promoted_originals original on evidence.source_order_hash=original.promoted_order_hash
group by evidence.file_digest;
insert into public.nayax_pending_sales(source_order_hash,source_row_hash,account_key,provider_actor_id,
  provider_site_id,provider_transaction_id,provider_machine_id,currency_code,settlement_amount_cents,
  machine_settled_at,provider_settled_at,provider_status,provider_status_name,normalized_sale,
  disposition,disposition_reason,promoted_fact_id)
select evidence.source_order_hash,evidence.source_row_hash,'TGPACI_USA_DB',evidence.provider_actor_id,
  evidence.provider_site_id,evidence.provider_transaction_id,evidence.provider_machine_id,'USD',evidence.settlement_amount_cents,
  evidence.machine_settled_at,evidence.machine_settled_at at time zone 'UTC',62,'Settled',
  jsonb_build_object('transactionId',evidence.provider_transaction_id,'siteId',evidence.provider_site_id,
    'actorId',evidence.provider_actor_id,'providerMachineId',evidence.provider_machine_id,'currencyCode','USD',
    'authorizationAmountCents',evidence.settlement_amount_cents,'settlementAmountCents',evidence.settlement_amount_cents,
    'machineSettledAt',evidence.machine_settled_at,'providerSettledAt',evidence.machine_settled_at at time zone 'UTC',
    'providerUpdatedAt',null,'providerStatus',62,'providerStatusName','Settled',
    'sourceOrderHash',evidence.source_order_hash,'sourceRowHash',evidence.source_row_hash),
  'promoted','historical_inactive_exact_link',original.fact_id
from public.nayax_dtm_export_rows evidence join finance_promoted_originals original
  on evidence.source_order_hash=original.promoted_order_hash;
set local session_replication_role=origin;
analyze public.nayax_pending_sales;
analyze public.nayax_dtm_export_rows;
analyze public.machine_sales_facts;
