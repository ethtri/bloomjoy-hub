begin;
create extension if not exists pgtap with schema extensions;
set local search_path = public, extensions;
select no_plan();

insert into public.customer_accounts (id, name, account_type)
values ('e5100000-0000-4000-8000-000000000001', 'Relocation hold fixture', 'internal');

insert into public.reporting_locations (id, account_id, name, timezone)
values
  ('e5200000-0000-4000-8000-000000000001', 'e5100000-0000-4000-8000-000000000001',
    'Current venue one', 'America/New_York'),
  ('e5200000-0000-4000-8000-000000000002', 'e5100000-0000-4000-8000-000000000001',
    'Current venue two', 'America/New_York'),
  ('e5200000-0000-4000-8000-000000000003', 'e5100000-0000-4000-8000-000000000001',
    'Correct historical venue one', 'America/New_York'),
  ('e5200000-0000-4000-8000-000000000004', 'e5100000-0000-4000-8000-000000000001',
    'Correct historical venue two', 'America/New_York');

insert into public.reporting_machines (
  id, account_id, location_id, machine_label, nayax_machine_id,
  nayax_account_key, status
) values
  ('e5300000-0000-4000-8000-000000000001', 'e5100000-0000-4000-8000-000000000001',
    'e5200000-0000-4000-8000-000000000001', 'Current machine one', '800000001',
    'TGPACI_USA_DB', 'active'),
  ('e5300000-0000-4000-8000-000000000002', 'e5100000-0000-4000-8000-000000000001',
    'e5200000-0000-4000-8000-000000000002', 'Current machine two', '800000002',
    'TGPACI_USA_DB', 'active'),
  ('e5300000-0000-4000-8000-000000000003', 'e5100000-0000-4000-8000-000000000001',
    'e5200000-0000-4000-8000-000000000003', 'Correct historical machine one', null,
    null, 'active'),
  ('e5300000-0000-4000-8000-000000000004', 'e5100000-0000-4000-8000-000000000001',
    'e5200000-0000-4000-8000-000000000004', 'Correct historical machine two', null,
    null, 'active');

insert into public.refund_nayax_machine_inventory (
  id, account_key, nayax_machine_id, machine_name, provider_is_active,
  refund_category, reporting_machine_id, reconciliation_state, setup_reason,
  exclusion_reason, decision_reason
) values
  ('e5400000-0000-4000-8000-000000000001', 'TGPACI_USA_DB', '800000001',
    'Former venue label one', true, 'cotton_candy',
    'e5300000-0000-4000-8000-000000000001', 'published', 'ready', null,
    'Published fixture'),
  ('e5400000-0000-4000-8000-000000000002', 'TGPACI_USA_DB', '800000002',
    'Former venue label two', true, 'cotton_candy',
    'e5300000-0000-4000-8000-000000000002', 'needs_setup',
    'historical_effective_location_link_required', null,
    'Completed immutable DTM history proves a prior venue window; confirm the effective location link before publishing (#1478/#1479).');

create temporary table relocation_fixture_sales (
  fact_id uuid primary key,
  machine_id uuid not null,
  location_id uuid not null,
  provider_machine_id text not null,
  sale_date date not null,
  amount_cents integer not null,
  order_hash text not null,
  row_hash text not null,
  transaction_id text not null
) on commit drop;

insert into relocation_fixture_sales values
  ('e5500000-0000-4000-8000-000000000001', 'e5300000-0000-4000-8000-000000000001',
    'e5200000-0000-4000-8000-000000000001', '800000001', '2026-09-22', 2650,
    repeat('1', 64), repeat('a', 64), '930000001'),
  ('e5500000-0000-4000-8000-000000000002', 'e5300000-0000-4000-8000-000000000001',
    'e5200000-0000-4000-8000-000000000001', '800000001', '2026-09-23', 2915,
    repeat('2', 64), repeat('b', 64), '930000002'),
  ('e5500000-0000-4000-8000-000000000003', 'e5300000-0000-4000-8000-000000000001',
    'e5200000-0000-4000-8000-000000000001', '800000001', '2026-09-23', 2915,
    repeat('3', 64), repeat('c', 64), '930000003'),
  ('e5500000-0000-4000-8000-000000000004', 'e5300000-0000-4000-8000-000000000001',
    'e5200000-0000-4000-8000-000000000001', '800000001', '2026-09-25', 2915,
    repeat('4', 64), repeat('d', 64), '930000004'),
  ('e5500000-0000-4000-8000-000000000005', 'e5300000-0000-4000-8000-000000000001',
    'e5200000-0000-4000-8000-000000000001', '800000001', '2026-09-25', 2915,
    repeat('5', 64), repeat('e', 64), '930000005'),
  ('e5500000-0000-4000-8000-000000000006', 'e5300000-0000-4000-8000-000000000002',
    'e5200000-0000-4000-8000-000000000002', '800000002', '2026-09-26', 3180,
    repeat('6', 64), repeat('f', 64), '930000006');

insert into public.machine_sales_facts (
  id, reporting_machine_id, reporting_location_id, sale_date, payment_method,
  net_sales_cents, transaction_count, source, source_order_hash, source_row_hash,
  item_quantity, tax_cents, source_payment_status, payment_time, raw_payload
)
select
  fact_id, machine_id, location_id, sale_date, 'credit', amount_cents, 1,
  'nayax_scheduled_report', order_hash, row_hash, 1, 0, 'Settled',
  sale_date::timestamp at time zone 'America/New_York',
  jsonb_build_object(
    'actorId', '2003563806',
    'siteId', '4',
    'providerMachineId', provider_machine_id,
    'transactionId', transaction_id,
    'providerUpdatedAt', (sale_date::timestamp at time zone 'America/New_York') + interval '1 minute',
    'payloadRedacted', true
  )
from relocation_fixture_sales;

insert into public.machine_sales_facts (
  id, reporting_machine_id, reporting_location_id, sale_date, payment_method,
  net_sales_cents, transaction_count, source, source_order_hash, source_row_hash,
  item_quantity, tax_cents, source_payment_status, payment_time, raw_payload
) values (
  'e5500000-0000-4000-8000-000000000007',
  'e5300000-0000-4000-8000-000000000001',
  'e5200000-0000-4000-8000-000000000001',
  '2026-09-23', 'credit', 777, 1, 'nayax_scheduled_report', repeat('7', 64),
  repeat('8', 64), 1, 0, 'Settled', '2026-09-23T16:00:00Z',
  jsonb_build_object(
    'actorId', '2003563806', 'siteId', '4', 'providerMachineId', '800000001',
    'transactionId', '930000007', 'payloadRedacted', true
  )
);

insert into public.sales_import_runs (
  id, source, status, source_reference, rows_seen, rows_imported, rows_skipped,
  started_at, completed_at
) values (
  'e5600000-0000-4000-8000-000000000001', 'nayax_dtm_history', 'completed',
  'relocation-hold-fixture', 6, 0, 6, now(), now()
);

insert into public.nayax_dtm_export_files (
  file_digest, import_run_id, byte_count, row_count, authorization_cents,
  settlement_cents, refund_annotation_cents, currency_code, period_start,
  period_end, is_partial, origin
) values (
  repeat('9', 64), 'e5600000-0000-4000-8000-000000000001', 1000, 6, 17490,
  17490, 0, 'USD', '2026-09-01T00:00:00Z', '2026-10-01T00:00:00Z', false,
  'manual_dtm_export'
);

insert into public.nayax_dtm_export_rows (
  file_digest, source_row_hash, source_order_hash, provider_actor_id,
  provider_machine_id, provider_site_id, provider_transaction_id,
  authorization_amount_cents, settlement_amount_cents, refund_annotation_cents,
  machine_settled_at, provider_settled_at, provider_updated_at, provider_status,
  provider_type, machine_name_hash, mapping_disposition, financial_disposition,
  history_scope_disposition, disposition
)
select
  repeat('9', 64), row_hash, order_hash, '2003563806', provider_machine_id, '4',
  transaction_id, amount_cents, amount_cents, 0, sale_date + time '12:00',
  (sale_date + time '16:00') at time zone 'UTC',
  (sale_date + time '16:01') at time zone 'UTC', 12, 0,
  repeat('0', 64), 'relocation_candidate', 'eligible', 'in_scope', 'held_relocation'
from relocation_fixture_sales;

insert into public.nayax_dtm_export_completions (
  file_digest, rows_recorded, facts_linked, adjustments_linked, pending_rows, held_rows
) values (repeat('9', 64), 6, 0, 0, 0, 6);

select is(
  (private.apply_nayax_wrong_venue_relocation_hold_v1() ->> 'heldFactCount')::integer,
  6,
  'Exactly six facts are selected by completed immutable relocation evidence'
);

select results_eq(
  $$
    select
      count(*)::integer,
      sum(net_sales_cents)::integer,
      sum(transaction_count)::integer,
      sum(item_quantity)::integer,
      sum(tax_cents)::integer
    from public.machine_sales_facts
    where id in (select fact_id from relocation_fixture_sales)
  $$,
  $$values (6, 0, 0, 0, 0)$$,
  'The six wrong-venue facts remain canonical rows but contribute no reporting metrics'
);

select is(
  (
    select sum((raw_payload #>> '{_salesAuthorityOriginal,netSalesCents}')::integer)::integer
    from public.machine_sales_facts
    where id in (select fact_id from relocation_fixture_sales)
  ),
  17490,
  'Original reporting metrics remain recoverable on the retained facts'
);

select is(
  (
    select count(*)
    from public.machine_sales_facts
    where id in (select fact_id from relocation_fixture_sales)
      and raw_payload #>> '{relocationHold,status}' = 'held_wrong_venue'
      and raw_payload #>> '{relocationHold,basis}' = 'completed_dtm_relocation_candidate'
  ),
  6::bigint,
  'Every suppressed fact carries the narrow redacted relocation-hold provenance'
);

select results_eq(
  $$
    select reconciliation_state, setup_reason, count(*)::integer
    from public.refund_nayax_machine_inventory
    where id in (
      'e5400000-0000-4000-8000-000000000001',
      'e5400000-0000-4000-8000-000000000002'
    )
    group by reconciliation_state, setup_reason
  $$,
  $$values ('needs_setup'::text, 'historical_effective_location_link_required'::text, 2)$$,
  'Published and already-contained inventory both finish in the same existing setup state'
);

select is(
  (
    select count(*)
    from public.refund_nayax_machine_inventory
    where id in (
      'e5400000-0000-4000-8000-000000000001',
      'e5400000-0000-4000-8000-000000000002'
    )
      and reporting_machine_id is not null
      and refund_category = 'cotton_candy'
      and exclusion_reason is null
  ),
  2::bigint,
  'Inventory retains its exact prior machine reference and category for audit'
);

select is(
  (select net_sales_cents from public.machine_sales_facts where id = 'e5500000-0000-4000-8000-000000000007'),
  777,
  'An ordinary scheduled fact on the same machine and date is untouched'
);

select results_eq(
  $$
    select count(*)::integer, sum(settlement_amount_cents)::integer
    from public.nayax_dtm_export_rows
    where file_digest = repeat('9', 64)
  $$,
  $$values (6, 17490)$$,
  'Immutable DTM rows and amounts remain unchanged'
);

select is(
  (select held_rows from public.nayax_dtm_export_completions where file_digest = repeat('9', 64)),
  6,
  'The completed immutable DTM receipt remains unchanged'
);

select is(
  (private.apply_nayax_wrong_venue_relocation_hold_v1() ->> 'factsChanged')::integer,
  0,
  'Replaying the correction is idempotent'
);

insert into public.nayax_scheduled_report_files (
  file_digest, received_at, byte_count, row_count, report
) values (
  repeat('d', 64), '2026-09-27T17:05:00Z', 500, 1, '{}'::jsonb
);

select set_config('request.jwt.claim.role', 'service_role', true);

select lives_ok(
  $$select public.service_ingest_nayax_scheduled_sales(
    repeat('d', 64),
    jsonb_build_array(jsonb_build_object(
      'transactionId', '940000001',
      'siteId', '4',
      'actorId', '2003563806',
      'providerMachineId', '800000001',
      'currencyCode', 'USD',
      'authorizationAmountCents', 1200,
      'settlementAmountCents', 1200,
      'paidAmountCents', 1200,
      'machineSettledAt', '2026-09-27T12:00:00',
      'providerSettledAt', '2026-09-27T16:00:00Z',
      'providerUpdatedAt', '2026-09-27T16:01:00Z',
      'providerStatus', 12,
      'providerStatusName', 'Settled',
      'sourceOrderHash', repeat('a', 64),
      'sourceRowHash', repeat('0', 64)
    ))
  )$$,
  'A later scheduled row uses the existing pending path while the location link needs setup'
);

select results_eq(
  $$
    select disposition, settlement_amount_cents
    from public.nayax_pending_sales
    where source_order_hash = repeat('a', 64)
  $$,
  $$values ('pending'::text, 1200)$$,
  'The future row is retained without publishing it to the wrong current venue'
);

-- Simulate the documented forward recovery after exact historical venues exist:
-- move the provider identity, restore retained metrics, then republish and promote.
update public.reporting_machines
set nayax_machine_id = null,
    nayax_account_key = null
where id in (
  'e5300000-0000-4000-8000-000000000001',
  'e5300000-0000-4000-8000-000000000002'
);

update public.reporting_machines
set nayax_machine_id = case id
      when 'e5300000-0000-4000-8000-000000000003'::uuid then '800000001'
      else '800000002'
    end,
    nayax_account_key = 'TGPACI_USA_DB'
where id in (
  'e5300000-0000-4000-8000-000000000003',
  'e5300000-0000-4000-8000-000000000004'
);

update public.machine_sales_facts fact
set
  reporting_machine_id = case fact.raw_payload ->> 'providerMachineId'
    when '800000001' then 'e5300000-0000-4000-8000-000000000003'::uuid
    else 'e5300000-0000-4000-8000-000000000004'::uuid
  end,
  reporting_location_id = case fact.raw_payload ->> 'providerMachineId'
    when '800000001' then 'e5200000-0000-4000-8000-000000000003'::uuid
    else 'e5200000-0000-4000-8000-000000000004'::uuid
  end,
  net_sales_cents = (fact.raw_payload #>> '{_salesAuthorityOriginal,netSalesCents}')::integer,
  transaction_count = (fact.raw_payload #>> '{_salesAuthorityOriginal,transactionCount}')::integer,
  item_quantity = (fact.raw_payload #>> '{_salesAuthorityOriginal,itemQuantity}')::integer,
  tax_cents = (fact.raw_payload #>> '{_salesAuthorityOriginal,taxCents}')::integer,
  raw_payload = fact.raw_payload - 'relocationHold'
where fact.id in (select fact_id from relocation_fixture_sales);

update public.refund_nayax_machine_inventory inventory
set
  reporting_machine_id = case inventory.nayax_machine_id
    when '800000001' then 'e5300000-0000-4000-8000-000000000003'::uuid
    else 'e5300000-0000-4000-8000-000000000004'::uuid
  end,
  reconciliation_state = 'published',
  setup_reason = 'ready',
  decision_reason = 'Exact effective historical venue fixture confirmed.'
where inventory.id in (
  'e5400000-0000-4000-8000-000000000001',
  'e5400000-0000-4000-8000-000000000002'
);

select is(
  (
    select sum(net_sales_cents)::integer
    from public.machine_sales_facts
    where id in (select fact_id from relocation_fixture_sales)
      and not (raw_payload ? 'relocationHold')
  ),
  17490,
  'A forward exact-location correction can move the retained facts and restore their original metrics'
);

select is(
  (public.service_promote_nayax_pending_sales(100) ->> 'promotedRows')::integer,
  1,
  'Publishing the corrected exact mapping promotes the later queued row once'
);

select is(
  (
    select count(*)
    from public.machine_sales_facts
    where source = 'nayax_scheduled_report'
      and source_order_hash = repeat('a', 64)
      and reporting_machine_id = 'e5300000-0000-4000-8000-000000000003'
      and reporting_location_id = 'e5200000-0000-4000-8000-000000000003'
      and net_sales_cents = 1200
  ),
  1::bigint,
  'The future row publishes once to the corrected exact location'
);

select is(
  (public.service_promote_nayax_pending_sales(100) ->> 'promotedRows')::integer,
  0,
  'Repeating pending promotion does not duplicate the future sale'
);

select * from finish();
rollback;
