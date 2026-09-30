begin;
create extension if not exists pgtap with schema extensions;
set local search_path = public, extensions;
select no_plan();

select is(
  (select tax_exclusive_amount_cents
   from private.normalize_financial_amount_cents(10000, 'tax_exclusive', 10, null)),
  10000::bigint,
  'Tax-exclusive cents stay unchanged'
);
select is(
  (select tax_cents
   from private.normalize_financial_amount_cents(10000, 'tax_exclusive', 10, null)),
  0::bigint,
  'Tax-exclusive cents do not receive a blanket tax deduction'
);
select is(
  (select tax_exclusive_amount_cents
   from private.normalize_financial_amount_cents(11000, 'tax_inclusive', 10, null)),
  10000::bigint,
  'Embedded 10 percent tax is extracted from a 110 dollar customer charge'
);
select is(
  (select tax_cents
   from private.normalize_financial_amount_cents(11000, 'tax_inclusive', 10, null)),
  1000::bigint,
  'Embedded-tax extraction reports the 10 dollar tax component'
);
select is(
  (select tax_exclusive_amount_cents
   from private.normalize_financial_amount_cents(11000, 'separate_tax', null, 1000)),
  10000::bigint,
  'Reliable separately imported tax is subtracted once'
);
select is(
  (select tax_exclusive_amount_cents
   from private.normalize_financial_amount_cents(0, 'separate_tax', null, null)),
  0::bigint,
  'A zero paid cumulative amount needs no separate-tax evidence'
);
select is(
  (select normalization_status
   from private.normalize_financial_amount_cents(11000, 'legacy_percentage_of_gross_estimate', 10, null)),
  'estimated',
  'Legacy gross-times-rate math remains explicitly estimated'
);
select is(
  (select tax_exclusive_amount_cents
   from private.normalize_financial_amount_cents(11000, 'unknown', 10, null)),
  null::bigint,
  'An unknown amount basis does not masquerade as tax-exclusive'
);
select results_eq($$
  select tax_exclusive_amount_cents, tax_cents, normalization_status,
    normalization_reason
  from private.normalize_financial_amount_cents(11000, 'tax_inclusive', null, null)
$$, $$values (
  11000::bigint, 0::bigint, 'estimated'::text,
  'configured_tax_rate_missing_no_deduction'::text
)$$,
  'Missing configured rate preserves numeric display without claiming a proved zero rate'
);
select is(
  (select tax_exclusive_amount_cents
   from private.normalize_financial_amount_cents(11000, 'tax_inclusive', 0, null)),
  11000::bigint,
  'A verified zero rate preserves the full amount'
);
select throws_ok(
  $$select * from private.normalize_financial_amount_cents(-1, 'tax_exclusive', 0, null)$$,
  '22023',
  'Financial amount cents must be nonnegative',
  'Negative source amounts are rejected'
);
select throws_ok(
  $$select * from private.normalize_financial_amount_cents(100, 'separate_tax', null, 101)$$,
  '22023',
  'Separate tax cents cannot exceed the recorded amount',
  'Impossible separate-tax input is rejected'
);

select is(
  (select combined_refund_ex_tax_cents
   from private.normalize_refund_cents(11000, 0, 'tax_inclusive', 10, null, null)),
  10000::bigint,
  'A full 110 dollar requested refund reverses 100 tax-exclusive dollars'
);
select is(
  (select request_target_tax_cents
   from private.normalize_refund_cents(2200, 0, 'tax_inclusive', 10, null, null)),
  200::bigint,
  'A partial 22 dollar requested refund contains two dollars of tax'
);
select is(
  (select combined_refund_ex_tax_cents
   from private.normalize_refund_cents(1000, 400, 'tax_exclusive', null, null, null)),
  1000::bigint,
  'Four dollars paid plus six outstanding stays one 10 dollar deduction'
);
select is(
  (select outstanding_request_ex_tax_cents
   from private.normalize_refund_cents(1000, 1000, 'tax_exclusive', null, null, null)),
  0::bigint,
  'Full payment moves the request to paid without a second deduction'
);
select is(
  (select combined_refund_ex_tax_cents
   from private.normalize_refund_cents(12, 6, 'tax_inclusive', 10, null, null)),
  11::bigint,
  'Cumulative normalization avoids partial-payment penny drift'
);
select is(
  (select outstanding_request_ex_tax_cents
   from private.normalize_refund_cents(12, 6, 'tax_inclusive', 10, null, null)),
  6::bigint,
  'Outstanding cents are the normalized cumulative difference'
);

insert into public.customer_accounts (id, name, account_type)
values (
  'ec100000-0000-4000-8000-000000000001',
  'Shared sales calculation fixtures',
  'internal'
);
insert into public.reporting_locations (id, account_id, name, timezone)
values (
  'ec200000-0000-4000-8000-000000000001',
  'ec100000-0000-4000-8000-000000000001',
  'Shared calculation location',
  'America/Los_Angeles'
);
insert into public.reporting_machines (
  id, account_id, location_id, machine_label, status
) values (
  'ec300000-0000-4000-8000-000000000001',
  'ec100000-0000-4000-8000-000000000001',
  'ec200000-0000-4000-8000-000000000001',
  'Shared calculation machine',
  'active'
);
insert into public.reporting_machine_tax_rates (
  id, machine_id, tax_rate_percent, effective_start_date, status
) values (
  'ec400000-0000-4000-8000-000000000001',
  'ec300000-0000-4000-8000-000000000001',
  10,
  '2026-01-01',
  'active'
);

set local session_replication_role = replica;

insert into public.machine_sales_facts (
  id, reporting_machine_id, reporting_location_id, sale_date, payment_method,
  net_sales_cents, transaction_count, source, source_order_hash,
  source_row_hash, tax_cents, raw_payload
) values
(
  'ec500000-0000-4000-8000-000000000001',
  'ec300000-0000-4000-8000-000000000001',
  'ec200000-0000-4000-8000-000000000001',
  '2026-09-20', 'cash', 10000, 1, 'sunze_browser', repeat('1', 32),
  repeat('1', 64), 0, '{}'::jsonb
),
(
  'ec500000-0000-4000-8000-000000000002',
  'ec300000-0000-4000-8000-000000000001',
  'ec200000-0000-4000-8000-000000000001',
  '2026-09-20', 'credit', 11000, 1, 'card_authority_daily', repeat('2', 32),
  repeat('2', 64), 0, '{}'::jsonb
),
(
  'ec500000-0000-4000-8000-000000000003',
  'ec300000-0000-4000-8000-000000000001',
  'ec200000-0000-4000-8000-000000000001',
  '2026-09-20', 'other', 3300, 1, 'manual_csv', null,
  repeat('3', 64), 300, '{"amountBasis":"separate_tax"}'::jsonb
),
(
  'ec500000-0000-4000-8000-000000000004',
  'ec300000-0000-4000-8000-000000000001',
  'ec200000-0000-4000-8000-000000000001',
  '2026-09-20', 'unknown', 7000, 1, 'manual_csv', null,
  repeat('4', 64), 700, '{}'::jsonb
),
(
  'ec500000-0000-4000-8000-000000000005',
  'ec300000-0000-4000-8000-000000000001',
  'ec200000-0000-4000-8000-000000000001',
  '2026-09-20', 'credit', 0, 0, 'nayax_scheduled_report', repeat('5', 32),
  repeat('5', 64), 900, '{"revenueAuthority":"card_authority_daily"}'::jsonb
),
(
  'ec500000-0000-4000-8000-000000000006',
  'ec300000-0000-4000-8000-000000000001',
  'ec200000-0000-4000-8000-000000000001',
  '2026-09-19', 'credit', 5500, 1, 'sunze_browser', repeat('6', 32),
  repeat('6', 64), 0, '{}'::jsonb
),
(
  'ec500000-0000-4000-8000-000000000007',
  'ec300000-0000-4000-8000-000000000001',
  'ec200000-0000-4000-8000-000000000001',
  '2026-09-18', 'cash', 5500, 1, 'sunze_browser', repeat('7', 32),
  repeat('7', 64), 500, '{"taxBasis":"separate_tax"}'::jsonb
);

insert into public.refund_cases (
  id, public_reference, reporting_machine_id, reporting_location_id,
  customer_email, issue_summary, incident_at, payment_method,
  payment_amount_cents, refund_amount_cents, status, decision,
  customer_request_received_at, customer_request_received_source,
  nayax_refund_execution_status, duplicate_of_refund_case_id,
  correlation_source, reporting_adjustment_id, matched_sales_fact_id
) values
(
  'ec600000-0000-4000-8000-000000000001', 'RF-SHARED-1',
  'ec300000-0000-4000-8000-000000000001',
  'ec200000-0000-4000-8000-000000000001',
  'partial@example.invalid', 'Partially paid request', '2026-09-20T18:00:00Z',
  'card', 1000, 1000, 'card_refund_pending', 'approved',
  '2026-09-20T19:00:00Z', 'hosted_refund_intake', 'ambiguous', null,
  'nayax', null, null
),
(
  'ec600000-0000-4000-8000-000000000002', 'RF-SHARED-2',
  'ec300000-0000-4000-8000-000000000001',
  'ec200000-0000-4000-8000-000000000001',
  'paid@example.invalid', 'Fully paid request', '2026-09-20T18:00:00Z',
  'card', 1000, 1000, 'completed', 'approved',
  '2026-09-20T19:00:00Z', 'hosted_refund_intake', 'approved', null,
  'nayax', 'ec700000-0000-4000-8000-000000000002', null
),
(
  'ec600000-0000-4000-8000-000000000003', 'RF-SHARED-3',
  'ec300000-0000-4000-8000-000000000001',
  'ec200000-0000-4000-8000-000000000001',
  'denied@example.invalid', 'Denied request', '2026-09-20T18:00:00Z',
  'card', 1000, 1000, 'denied', 'denied',
  '2026-09-20T19:00:00Z', 'hosted_refund_intake', 'not_requested', null,
  'manual', null, null
),
(
  'ec600000-0000-4000-8000-000000000004', 'RF-SHARED-4',
  'ec300000-0000-4000-8000-000000000001',
  'ec200000-0000-4000-8000-000000000001',
  'duplicate@example.invalid', 'Duplicate request', '2026-09-20T18:00:00Z',
  'card', 1000, 1000, 'completed', 'approved',
  '2026-09-20T19:00:00Z', 'hosted_refund_intake', 'approved',
  'ec600000-0000-4000-8000-000000000001', 'nayax', null, null
),
(
  'ec600000-0000-4000-8000-000000000005', 'RF-SHARED-5',
  'ec300000-0000-4000-8000-000000000001',
  'ec200000-0000-4000-8000-000000000001',
  'missing@example.invalid', 'Missing amount request', '2026-09-20T18:00:00Z',
  'card', null, null, 'needs_review', null,
  '2026-09-20T19:00:00Z', 'gmail_contact_ingested', 'not_requested', null,
  null, null, 'ec500000-0000-4000-8000-000000000001'
),
(
  'ec600000-0000-4000-8000-000000000006', 'RF-SHARED-6',
  'ec300000-0000-4000-8000-000000000001',
  'ec200000-0000-4000-8000-000000000001',
  'unmatched@example.invalid', 'Unmatched public request', '2026-09-20T18:00:00Z',
  'cash', 800, 800, 'needs_review', null,
  '2026-09-20T19:00:00Z', 'hosted_refund_intake', 'not_requested', null,
  null, null, null
);

insert into public.sales_adjustment_facts (
  id, reporting_machine_id, reporting_location_id, adjustment_date,
  adjustment_type, amount_cents, complaint_count, source, source_row_hash,
  refund_case_id, raw_payload
) values
(
  'ec700000-0000-4000-8000-000000000001',
  'ec300000-0000-4000-8000-000000000001',
  'ec200000-0000-4000-8000-000000000001',
  '2026-09-21', 'refund', 400, 1, 'manual', repeat('a', 64),
  'ec600000-0000-4000-8000-000000000001', '{"payment_method":"card"}'::jsonb
),
(
  'ec700000-0000-4000-8000-000000000002',
  'ec300000-0000-4000-8000-000000000001',
  'ec200000-0000-4000-8000-000000000001',
  '2026-09-21', 'refund', 1000, 1, 'manual', repeat('b', 64),
  null, '{"payment_method":"card"}'::jsonb
),
(
  'ec700000-0000-4000-8000-000000000003',
  'ec300000-0000-4000-8000-000000000001',
  'ec200000-0000-4000-8000-000000000001',
  '2026-09-21', 'refund', 200, 1, 'manual', repeat('c', 64),
  'ec600000-0000-4000-8000-000000000004', '{"payment_method":"credit"}'::jsonb
),
(
  'ec700000-0000-4000-8000-000000000004',
  'ec300000-0000-4000-8000-000000000001',
  'ec200000-0000-4000-8000-000000000001',
  '2026-09-21', 'complaint_refund', 300, 1, 'manual', repeat('d', 64),
  null, '{"payment_method":"unknown"}'::jsonb
),
(
  'ec700000-0000-4000-8000-000000000005',
  'ec300000-0000-4000-8000-000000000001',
  'ec200000-0000-4000-8000-000000000001',
  '2026-09-21', 'refund', 0, 0, 'nayax_provider_refund', repeat('e', 64),
  'ec600000-0000-4000-8000-000000000002', '{}'::jsonb
),
(
  'ec700000-0000-4000-8000-000000000006',
  'ec300000-0000-4000-8000-000000000001',
  'ec200000-0000-4000-8000-000000000001',
  '2026-09-21', 'refund', 250, 0, 'nayax_provider_refund', repeat('f', 64),
  null, '{}'::jsonb
);

set local session_replication_role = origin;

select is(
  (select count(*) from private.machine_sales_calculation_candidates(
    'ec300000-0000-4000-8000-000000000001', '2026-09-20', '2026-09-22'
  ) where component_kind = 'sale'),
  4::bigint,
  'Only positive contributing authority rows become sale components'
);
select is(
  (select sum(component_amount_cents) from private.machine_sales_calculation_candidates(
    'ec300000-0000-4000-8000-000000000001', '2026-09-20', '2026-09-22'
  ) where component_kind = 'sale'),
  31300::numeric,
  'Recorded sales reconcile across every tender'
);
select is(
  (select sum(component_amount_cents) from private.machine_sales_calculation_candidates(
    'ec300000-0000-4000-8000-000000000001', '2026-09-20', '2026-09-22'
  ) where component_kind = 'sale' and tender = 'cash'),
  10000::numeric,
  'Cash remains a distinct sales component'
);
select is(
  (select amount_basis || ':' || amount_provenance
   from private.machine_sales_calculation_candidates(
    'ec300000-0000-4000-8000-000000000001', '2026-09-20', '2026-09-22'
  ) where component_identity = 'sale:ec500000-0000-4000-8000-000000000001'),
  'tax_exclusive:sunze_orders_tax_exclusive_revenue',
  'Sunze cash Order amount uses the finance-confirmed tax-exclusive Revenue contract'
);
select is(
  (select amount_basis || ':' || amount_provenance
   from private.machine_sales_calculation_candidates(
    'ec300000-0000-4000-8000-000000000001', '2026-09-19', '2026-09-19'
  ) where component_identity = 'sale:ec500000-0000-4000-8000-000000000006'),
  'tax_exclusive:sunze_orders_tax_exclusive_revenue',
  'Retained Sunze card history shares the same Order amount basis without changing authority'
);
select is(
  (select amount_basis || ':' || amount_provenance
   from private.machine_sales_calculation_candidates(
    'ec300000-0000-4000-8000-000000000001', '2026-09-18', '2026-09-18'
  ) where component_identity = 'sale:ec500000-0000-4000-8000-000000000007'),
  'separate_tax:source_tax_basis',
  'Explicit source tax-basis metadata overrides the Sunze fallback consistently'
);
select is(
  (select sum(component_amount_cents) from private.machine_sales_calculation_candidates(
    'ec300000-0000-4000-8000-000000000001', '2026-09-20', '2026-09-22'
  ) where component_kind = 'sale' and tender = 'card'),
  11000::numeric,
  'Card remains a distinct sales component'
);
select is(
  (select tax_exclusive_amount_cents from private.machine_sales_calculation_candidates(
    'ec300000-0000-4000-8000-000000000001', '2026-09-20', '2026-09-22'
  ) where component_identity = 'sale:ec500000-0000-4000-8000-000000000002'),
  10000::bigint,
  'Known inclusive card charge exposes its diagnostic tax-exclusive amount'
);
select is(
  (select tax_exclusive_amount_cents from private.machine_sales_calculation_candidates(
    'ec300000-0000-4000-8000-000000000001', '2026-09-20', '2026-09-22'
  ) where component_identity = 'sale:ec500000-0000-4000-8000-000000000003'),
  3000::bigint,
  'Explicit separate-tax sale exposes its diagnostic tax-exclusive amount'
);
select is(
  (select normalization_status from private.machine_sales_calculation_candidates(
    'ec300000-0000-4000-8000-000000000001', '2026-09-20', '2026-09-22'
  ) where component_identity = 'sale:ec500000-0000-4000-8000-000000000004'),
  'unknown',
  'Unknown sales basis remains explicitly unknown'
);
select is(
  (select component_amount_cents from private.machine_sales_calculation_candidates(
    'ec300000-0000-4000-8000-000000000001', '2026-09-20', '2026-09-22'
  ) where component_identity = 'request:ec600000-0000-4000-8000-000000000001'),
  400::bigint,
  'Failed execution leaves only the unpaid canonical-lineage request outstanding'
);
select is(
  (select linked_paid_cumulative_cents from private.machine_sales_calculation_candidates(
    'ec300000-0000-4000-8000-000000000001', '2026-09-20', '2026-09-22'
  ) where component_identity = 'request:ec600000-0000-4000-8000-000000000001'),
  600::bigint,
  'Non-additive paid context includes distinct payments attached to duplicate descendants'
);
select is(
  (select sum(component_amount_cents) from private.machine_sales_calculation_candidates(
    'ec300000-0000-4000-8000-000000000001', '2026-09-20', '2026-09-22'
  ) where component_identity in (
    'request:ec600000-0000-4000-8000-000000000001',
    'paid:ec700000-0000-4000-8000-000000000001',
    'paid:ec700000-0000-4000-8000-000000000003'
  )),
  1000::numeric,
  'Canonical request plus duplicate-lineage payments remains one 10 dollar deduction'
);
select is(
  (select component_amount_cents from private.machine_sales_calculation_candidates(
    'ec300000-0000-4000-8000-000000000001', '2026-09-20', '2026-09-22'
  ) where component_identity = 'request:ec600000-0000-4000-8000-000000000002'),
  0::bigint,
  'A fully paid request contributes no outstanding amount'
);
select is(
  (select component_amount_cents from private.machine_sales_calculation_candidates(
    'ec300000-0000-4000-8000-000000000001', '2026-09-20', '2026-09-22'
  ) where component_identity = 'request:ec600000-0000-4000-8000-000000000003'),
  0::bigint,
  'Denial removes the unpaid requested amount'
);
select is(
  (select count(*) from private.machine_sales_calculation_candidates(
    'ec300000-0000-4000-8000-000000000001', '2026-09-20', '2026-09-22'
  ) where component_identity = 'request:ec600000-0000-4000-8000-000000000004'),
  0::bigint,
  'A duplicate request has no second outstanding component'
);
select is(
  (select component_amount_cents from private.machine_sales_calculation_candidates(
    'ec300000-0000-4000-8000-000000000001', '2026-09-20', '2026-09-22'
  ) where component_identity = 'paid:ec700000-0000-4000-8000-000000000003'),
  200::bigint,
  'Distinct paid evidence linked to a duplicate case remains accounted once'
);
select is(
  (select refund_case_id from private.machine_sales_calculation_candidates(
    'ec300000-0000-4000-8000-000000000001', '2026-09-20', '2026-09-22'
  ) where component_identity = 'paid:ec700000-0000-4000-8000-000000000002'),
  'ec600000-0000-4000-8000-000000000002'::uuid,
  'Legacy reporting-adjustment backlink supplies canonical case context'
);
select is(
  (select component_amount_cents from private.machine_sales_calculation_candidates(
    'ec300000-0000-4000-8000-000000000001', '2026-09-20', '2026-09-22'
  ) where component_identity = 'paid:ec700000-0000-4000-8000-000000000004'),
  300::bigint,
  'Independent paid adjustments remain in the candidate stream'
);
select is(
  (select amount_basis from private.machine_sales_calculation_candidates(
    'ec300000-0000-4000-8000-000000000001', '2026-09-20', '2026-09-22'
  ) where component_identity = 'paid:ec700000-0000-4000-8000-000000000004'),
  'unknown',
  'Manual paid adjustment basis remains unknown without explicit evidence'
);
select is(
  (select tender || ':' || amount_basis from private.machine_sales_calculation_candidates(
    'ec300000-0000-4000-8000-000000000001', '2026-09-20', '2026-09-22'
  ) where component_identity = 'paid:ec700000-0000-4000-8000-000000000006'),
  'card:tax_inclusive',
  'Known Nayax provider refunds normalize to card with proved customer-charge basis'
);
select is(
  (select normalization_status from private.machine_sales_calculation_candidates(
    'ec300000-0000-4000-8000-000000000001', '2026-09-20', '2026-09-22'
  ) where component_identity = 'request:ec600000-0000-4000-8000-000000000005'),
  'missing',
  'Missing request amount stays unresolved instead of becoming zero or full sale'
);
select is(
  (select amount_basis from private.machine_sales_calculation_candidates(
    'ec300000-0000-4000-8000-000000000001', '2026-09-20', '2026-09-22'
  ) where component_identity = 'request:ec600000-0000-4000-8000-000000000005'),
  'unknown',
  'Matched sale basis alone does not prove the customer request amount basis'
);
select is(
  (select component_amount_cents from private.machine_sales_calculation_candidates(
    'ec300000-0000-4000-8000-000000000001', '2026-09-20', '2026-09-22'
  ) where component_identity = 'request:ec600000-0000-4000-8000-000000000006'),
  800::bigint,
  'Unmatched public intake contributes its positive customer estimate'
);
select is(
  (select amount_basis from private.machine_sales_calculation_candidates(
    'ec300000-0000-4000-8000-000000000001', '2026-09-20', '2026-09-22'
  ) where component_identity = 'request:ec600000-0000-4000-8000-000000000006'),
  'tax_inclusive',
  'Hosted amount-paid intake proves a customer-charge basis before matching'
);
select is(
  (select count(*) from private.machine_sales_calculation_candidates(
    'ec300000-0000-4000-8000-000000000001', '2026-09-20', '2026-09-22'
  ) where component_kind = 'refund_paid'),
  5::bigint,
  'Zero-value canonical provider receipts do not become a second paid deduction'
);

select ok(
  has_function_privilege(
    'service_role',
    'private.machine_sales_calculation_candidates(uuid,date,date)',
    'execute'
  )
  and not has_function_privilege(
    'authenticated',
    'private.machine_sales_calculation_candidates(uuid,date,date)',
    'execute'
  )
  and not has_function_privilege(
    'anon',
    'private.normalize_refund_cents(bigint,bigint,text,numeric,bigint,bigint)',
    'execute'
  ),
  'Shared sales calculation helpers remain private and service-only'
);

select * from finish();
rollback;
