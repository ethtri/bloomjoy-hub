-- SELECT-only operator audit. Edit the bounded report window below; retain the
-- actual purchase dates of refund components, even outside that booking window.
-- Run with authorized private-schema read access. Keep results in gitignored
-- output/: source/account/reader identities are operational recovery evidence.
-- This is a component inventory, not a replacement for scoped report totals.
with report_window as (
  select date '2026-09-30' date_from, date '2026-10-06' date_to
), affected as materialized (
  select machine.id machine_id,
    coalesce(nullif(machine.machine_display_name,''),machine.machine_label) machine_name,
    machine.nayax_account_key current_account_key,
    machine.nayax_machine_id current_reader_id,
    component.booking_date, component.purchase_attribution_date purchase_date,
    component.source, component.unresolved_sales_count, component.unresolved_refund_count
  from public.reporting_machines machine cross join report_window
  cross join lateral private.machine_sales_daily_waterfall_components(
    machine.id,report_window.date_from,report_window.date_to) component
  where component.unresolved_sales_count>0 or component.unresolved_refund_count>0
), original_sales as materialized (
  select distinct affected.machine_id,affected.booking_date,affected.purchase_date,affected.source,
    nullif(btrim(fact.raw_payload->>'providerMachineId'),'') reader_id
  from affected
  join public.machine_sales_facts fact on fact.reporting_machine_id=affected.machine_id
    and fact.sale_date=affected.purchase_date and fact.source='nayax_scheduled_report'
    and fact.payment_method='credit'
  cross join lateral private.reporting_retained_original_money(fact) money
  where affected.unresolved_sales_count>0 and money.original_amount_cents>0
), original_sales_tuples as (
  select original.*,inventory.account_key,'original_sale_row'::text identity_source
  from original_sales original
  left join public.refund_nayax_machine_inventory inventory
    on inventory.nayax_machine_id=original.reader_id
), original_refund_cases as materialized (
  select distinct affected.machine_id,affected.booking_date,affected.purchase_date,affected.source,
    refund_case.id case_id,refund_case.matched_sales_fact_id,
    refund_case.matched_nayax_transaction_id
  from affected cross join report_window
  join private.refund_request_recognition_events event
    on event.reporting_machine_id=affected.machine_id
    and event.booking_date=affected.booking_date
    and event.purchase_attribution_date=affected.purchase_date
  join public.refund_cases refund_case on refund_case.id=event.refund_case_id
  where affected.unresolved_refund_count>0 and affected.source='refund_request'
    and event.booking_date between report_window.date_from and report_window.date_to
), refund_tuples as (
  select original.machine_id,original.booking_date,original.purchase_date,original.source,
    nullif(btrim(fact.raw_payload->>'providerMachineId'),'') reader_id,
    inventory.account_key,'matched_original_sale'::text identity_source
  from original_refund_cases original
  join public.machine_sales_facts fact on fact.id=original.matched_sales_fact_id
    and fact.reporting_machine_id=original.machine_id
    and fact.source='nayax_scheduled_report' and fact.payment_method='credit'
  left join public.refund_nayax_machine_inventory inventory
    on inventory.nayax_machine_id=nullif(btrim(fact.raw_payload->>'providerMachineId'),'')
  union all
  select original.machine_id,original.booking_date,original.purchase_date,original.source,
    receipt.provider_machine_id,receipt.account_scope,'authoritative_receipt'
  from original_refund_cases original
  join public.refund_authoritative_receipts receipt on receipt.refund_case_id=original.case_id
    and receipt.reporting_machine_id=original.machine_id
    and receipt.original_transaction_id is not null
  union all
  select original.machine_id,original.booking_date,original.purchase_date,original.source,
    candidate.evidence_summary->>'lookup_provider_machine_id',
    candidate.evidence_summary->>'lookup_account_scope','selected_lookup_candidate'
  from original_refund_cases original
  join public.refund_nayax_lookup_candidates candidate on candidate.refund_case_id=original.case_id
    and candidate.provider_transaction_id=original.matched_nayax_transaction_id
    and candidate.reporting_machine_id=original.machine_id
), provider_refund_tuples as (
  select distinct affected.machine_id,affected.booking_date,affected.purchase_date,affected.source,
    provider_event.provider_machine_id reader_id,inventory.account_key,
    'provider_original_refund'::text identity_source
  from affected
  join public.sales_adjustment_facts adjustment on adjustment.reporting_machine_id=affected.machine_id
    and adjustment.adjustment_date=affected.booking_date and adjustment.source=affected.source
  join public.nayax_provider_refund_events provider_event on provider_event.adjustment_id=adjustment.id
    and provider_event.disposition='applied'
  left join public.refund_nayax_machine_inventory inventory
    on inventory.nayax_machine_id=provider_event.provider_machine_id
  where affected.unresolved_refund_count>0 and affected.source='nayax_provider_refund'
), tuples as (
  select * from original_sales_tuples union all select * from refund_tuples
  union all select * from provider_refund_tuples
), evidence as (
  select tuples.*,observation.id observation_id,observation.source observation_source,
    observation.effective_start_date,observation.effective_end_date
  from tuples
  left join private.nayax_machine_tax_observations observation
    on observation.account_key=tuples.account_key and observation.nayax_machine_id=tuples.reader_id
    and observation.classification='verified_tax'
    and observation.effective_start_date<=tuples.purchase_date
    and coalesce(observation.effective_end_date,'infinity'::date)>=tuples.purchase_date
)
select affected.*,
  coalesce(array_agg(distinct evidence.reader_id) filter(where evidence.reader_id is not null),array[]::text[]) source_reader_ids,
  coalesce(array_agg(distinct evidence.account_key) filter(where evidence.account_key is not null),array[]::text[]) source_account_keys,
  coalesce(array_agg(distinct evidence.identity_source) filter(where evidence.reader_id is not null),array[]::text[]) identity_sources,
  count(distinct (evidence.account_key,evidence.reader_id)) filter(where evidence.account_key is not null and evidence.reader_id is not null) source_tuple_count,
  coalesce(array_agg(distinct evidence.observation_id) filter(where evidence.observation_id is not null),array[]::uuid[]) applicable_observation_ids,
  case when count(distinct evidence.reader_id)=0 then 'original_reader_unavailable'
    when count(distinct (evidence.account_key,evidence.reader_id)) filter(where evidence.account_key is not null and evidence.reader_id is not null)<>1
      then 'original_account_reader_requires_review'
    when count(evidence.observation_id)=0 then 'dated_tax_evidence_unavailable'
    else 'dated_evidence_present_inspect_normalizer' end recovery_status
from affected left join evidence on evidence.machine_id=affected.machine_id
  and evidence.booking_date=affected.booking_date and evidence.purchase_date=affected.purchase_date
  and evidence.source=affected.source
group by affected.machine_id,affected.machine_name,affected.current_account_key,affected.current_reader_id,
  affected.booking_date,affected.purchase_date,affected.source,
  affected.unresolved_sales_count,affected.unresolved_refund_count
order by affected.machine_name,affected.purchase_date,affected.booking_date,affected.source;
