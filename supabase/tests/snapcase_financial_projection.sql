begin;
create extension if not exists pgtap with schema extensions;
set local search_path = public, extensions;
select no_plan();

insert into auth.users (
  instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at
) values (
  '00000000-0000-0000-0000-000000000000',
  '14780000-0000-4000-8000-000000000001',
  'authenticated', 'authenticated', 'snapcase-finance-admin@example.invalid', '', now(),
  '{}'::jsonb, '{}'::jsonb, now(), now()
);
insert into public.admin_roles(user_id, role, active)
values ('14780000-0000-4000-8000-000000000001', 'super_admin', true);

insert into public.customer_accounts(id, name, account_type, status)
values ('14781000-0000-4000-8000-000000000001', 'SnapCase finance fixture', 'internal', 'active');
insert into public.reporting_locations(id, account_id, name, timezone, status)
values
  ('14782000-0000-4000-8000-000000000001', '14781000-0000-4000-8000-000000000001', 'Finance location A', 'America/Los_Angeles', 'active'),
  ('14782000-0000-4000-8000-000000000002', '14781000-0000-4000-8000-000000000001', 'Finance location B', 'America/Los_Angeles', 'active');
insert into public.reporting_machines(
  id, account_id, location_id, machine_label, machine_type, status
) values
  ('14783000-0000-4000-8000-000000000001', '14781000-0000-4000-8000-000000000001', '14782000-0000-4000-8000-000000000001', 'Finance SnapCase A', 'snapcase', 'active'),
  ('14783000-0000-4000-8000-000000000002', '14781000-0000-4000-8000-000000000001', '14782000-0000-4000-8000-000000000002', 'Finance SnapCase B', 'snapcase', 'active');
insert into public.reporting_machine_tax_rates(
  id, machine_id, tax_rate_percent, effective_start_date, status
) values
  ('14783500-0000-4000-8000-000000000001', '14783000-0000-4000-8000-000000000001', 0, '2025-01-01', 'active'),
  ('14783500-0000-4000-8000-000000000002', '14783000-0000-4000-8000-000000000002', 0, '2025-01-01', 'active');
\ir fixtures/reporting_source_tax.inc


insert into private.snapcase_provider_accounts(id, source_account_key)
values ('14784000-0000-4000-8000-000000000001', 'finance-fixture');
insert into private.snapcase_ingest_batches(
  id, provider_account_id, contract_version, run_key, batch_key, batch_digest,
  request_fingerprint, machine_count, order_count, payment_count, evidence_count
) values (
  '14785000-0000-4000-8000-000000000001',
  '14784000-0000-4000-8000-000000000001', 'snapcase.ingest.v1',
  repeat('1', 64), repeat('2', 64), repeat('3', 64), repeat('4', 64),
  1, 4, 4, 0
);
insert into private.snapcase_source_machines(
  provider_account_id, source_inventory_id, source_machine_id,
  source_label, source_status, source_timezone, source_currency,
  revision_digest, revision_number, first_seen_batch_id, last_seen_batch_id
) values (
  '14784000-0000-4000-8000-000000000001', 'finance-inventory', 'finance-machine',
  'Finance source machine', 'active', 'America/Los_Angeles', 'USD',
  repeat('5', 64), 1,
  '14785000-0000-4000-8000-000000000001',
  '14785000-0000-4000-8000-000000000001'
);
insert into private.snapcase_machine_mappings(
  id, provider_account_id, source_machine_id, reporting_machine_id,
  effective_start_date, mapping_reason
) values (
  '14786000-0000-4000-8000-000000000001',
  '14784000-0000-4000-8000-000000000001', 'finance-machine',
  '14783000-0000-4000-8000-000000000001', '2025-01-01',
  'Synthetic financial projection fixture'
);

insert into private.snapcase_sales_observations(
  id, provider_account_id, resource, source_key, source_key_version,
  source_machine_id, source_status, source_payment_status,
  source_tender_code, source_tender_label, normalized_tender,
  occurred_time_raw, occurred_at, source_currency, currency_code,
  source_amount_text, amount_minor, source_refund_amount_text,
  refund_amount_minor, product_label, quantity, exception_codes, revision_digest,
  first_seen_batch_id, last_seen_batch_id
) values
  (
    '14787000-0000-4000-8000-000000000001', '14784000-0000-4000-8000-000000000001',
    'order', repeat('a', 64), 1, 'finance-machine', 'print_failed', 'success',
    '1', 'cash', 'cash', '2026-09-20T19:00:00Z', '2026-09-20T19:00:00Z',
    'USD', 'USD', '10.00', 1000, null, null, 'Phone case', null,
    array['financial_status_semantics_unverified', 'product_unverified'], repeat('a', 64),
    '14785000-0000-4000-8000-000000000001', '14785000-0000-4000-8000-000000000001'
  ),
  (
    '14787000-0000-4000-8000-000000000002', '14784000-0000-4000-8000-000000000001',
    'order', repeat('b', 64), 1, 'finance-machine', 'complete', 'success',
    '0', 'creditCard', 'card', '2026-09-20T20:00:00Z', '2026-09-20T20:00:00Z',
    'USD', 'USD', '20.00', 2000, null, null, null, 1,
    array['financial_status_semantics_unverified'], repeat('b', 64),
    '14785000-0000-4000-8000-000000000001', '14785000-0000-4000-8000-000000000001'
  ),
  (
    '14787000-0000-4000-8000-000000000003', '14784000-0000-4000-8000-000000000001',
    'order', repeat('c', 64), 1, 'finance-machine', 'complete', 'success',
    '1', 'cash', 'cash', '2026-09-21T07:00:00Z', '2026-09-21T07:00:00Z',
    'USD', 'USD', '7.50', 750, null, null, null, 1,
    array['financial_status_semantics_unverified'], repeat('c', 64),
    '14785000-0000-4000-8000-000000000001', '14785000-0000-4000-8000-000000000001'
  ),
  (
    '14787000-0000-4000-8000-000000000004', '14784000-0000-4000-8000-000000000001',
    'order', repeat('d', 64), 1, 'finance-machine', 'complete', 'success',
    '1', 'cash', 'cash', '2026-09-21T07:00:00Z', '2026-09-21T07:00:00Z',
    'USD', 'USD', '7.50', 750, null, null, null, 1,
    array['financial_status_semantics_unverified'], repeat('d', 64),
    '14785000-0000-4000-8000-000000000001', '14785000-0000-4000-8000-000000000001'
  );

insert into private.snapcase_sales_observations(
  id, provider_account_id, resource, source_key, source_key_version,
  source_machine_id, source_status, source_transaction_key, related_order_keys,
  source_tender_code, source_tender_label, normalized_tender,
  occurred_time_raw, occurred_at, source_currency, currency_code,
  source_amount_text, amount_minor, source_refund_amount_text,
  refund_amount_minor, exception_codes, revision_digest,
  first_seen_batch_id, last_seen_batch_id
) values
  (
    '14788000-0000-4000-8000-000000000001', '14784000-0000-4000-8000-000000000001',
    'payment', repeat('e', 64), 1, 'finance-machine', 'success', repeat('1', 64),
    array[repeat('a', 64)], '1', 'cash', 'cash',
    '2026-09-20T19:00:00Z', '2026-09-20T19:00:00Z', 'USD', 'USD',
    '10.00', 1000, null, null,
    array['financial_status_semantics_unverified'], repeat('e', 64),
    '14785000-0000-4000-8000-000000000001', '14785000-0000-4000-8000-000000000001'
  ),
  (
    '14788000-0000-4000-8000-000000000002', '14784000-0000-4000-8000-000000000001',
    'payment', repeat('f', 64), 1, 'finance-machine', 'success', null,
    array[repeat('b', 64)], '0', 'creditCard', 'card',
    '2026-09-20T20:00:00Z', '2026-09-20T20:00:00Z', 'USD', 'USD',
    '20.00', 2000, null, null,
    array['financial_status_semantics_unverified'], repeat('f', 64),
    '14785000-0000-4000-8000-000000000001', '14785000-0000-4000-8000-000000000001'
  ),
  (
    '14788000-0000-4000-8000-000000000003', '14784000-0000-4000-8000-000000000001',
    'payment', repeat('6', 64), 1, 'finance-machine', 'success', null,
    array[repeat('c', 64), repeat('d', 64)], '1', 'cash', 'cash',
    '2026-09-21T07:00:00Z', '2026-09-21T07:00:00Z', 'USD', 'USD',
    '15.00', 1500, null, null,
    array['financial_status_semantics_unverified'], repeat('6', 64),
    '14785000-0000-4000-8000-000000000001', '14785000-0000-4000-8000-000000000001'
  ),
  (
    '14788000-0000-4000-8000-000000000004', '14784000-0000-4000-8000-000000000001',
    'payment', repeat('7', 64), 1, 'finance-machine', 'success', null,
    '{}'::text[], '3', 'creditCard', 'card',
    '2026-09-20T22:00:00Z', '2026-09-20T22:00:00Z', 'USD', 'USD',
    '20.00', 2000, null, null,
    array['financial_status_semantics_unverified'], repeat('7', 64),
    '14785000-0000-4000-8000-000000000001', '14785000-0000-4000-8000-000000000001'
  );

insert into public.machine_sales_facts(
  id, reporting_machine_id, reporting_location_id, sale_date, payment_method,
  net_sales_cents, transaction_count, source, source_order_hash, source_row_hash,
  source_payment_status, payment_time, raw_payload
) values (
  '14789000-0000-4000-8000-000000000001',
  '14783000-0000-4000-8000-000000000001', '14782000-0000-4000-8000-000000000001',
  '2026-09-20', 'credit', 2000, 1, 'nayax_scheduled_report', repeat('8', 64),
  repeat('9', 64), 'Settled', '2026-09-20T20:05:00Z',
  jsonb_build_object('providerMachineId', 'fixture-nayax', 'payloadRedacted', true)
);
insert into public.sales_adjustment_facts(
  id, reporting_machine_id, reporting_location_id, adjustment_date,
  adjustment_type, amount_cents, source, source_row_hash
) values (
  '1478a000-0000-4000-8000-000000000001',
  '14783000-0000-4000-8000-000000000001', '14782000-0000-4000-8000-000000000001',
  '2026-09-20', 'refund', 500, 'manual', 'snapcase-finance-confirmed-refund'
);

select set_config('request.jwt.claim.role', 'authenticated', true);
select throws_ok(
  $$select public.service_project_snapcase_financial_window(
    '14784000-0000-4000-8000-000000000001', 'finance-machine',
    '2026-09-20T07:00:00Z', '2026-09-21T07:00:00Z'
  )$$,
  'P0001', 'Service role required',
  'clients cannot invoke the financial projector'
);

select set_config('request.jwt.claim.role', 'service_role', true);

create temporary table first_projection as
select public.service_project_snapcase_financial_window(
  '14784000-0000-4000-8000-000000000001', 'finance-machine',
  '2026-09-20T07:00:00Z', '2026-09-21T07:00:00Z'
) as result;

select is((select result ->> 'cashPublishedCount' from first_projection), '1',
  'one proved cash payment is published without optional order context');
select is((select result ->> 'cashSalesCents' from first_projection), '1000',
  'cash uses the collected payment amount rather than grouped tender guesses');
select is(
  (select item_quantity from public.machine_sales_facts where source = 'snapcase_cash'),
  0,
  'unknown source quantity uses the explicit zero storage fallback'
);
select is(
  (select raw_payload ->> 'itemQuantityBasis'
   from public.machine_sales_facts where source = 'snapcase_cash'),
  'unknown_zero',
  'the zero fallback is marked unknown rather than presented as a proved quantity'
);
select is(
  (select details ->> 'quantityUnknownCount'
   from private.snapcase_financial_window_revisions
   where source_machine_id = 'finance-machine'),
  '1',
  'quantity and product-label uncertainty do not hide proved gross cash'
);
select is((select result ->> 'cardObservationCount' from first_projection), '1',
  'only the proved POS-card tender stays comparison evidence');
select is((select result ->> 'nayaxCardSalesCents' from first_projection), '2000',
  'existing Nayax remains the card-money authority');
select is(
  (select details ->> 'cardWindowComparable'
   from private.snapcase_financial_window_revisions
   where source_machine_id = 'finance-machine'),
  'true',
  'card aggregates compare only across aligned machine-local business days'
);
select is((select result ->> 'financialReady' from first_projection), 'true',
  'mapped authoritative cash can complete despite nonblocking card diagnostics');

select is(
  (select count(*)::integer from public.machine_sales_facts where source = 'snapcase_cash'),
  1,
  'only cash creates a new financial fact'
);
select is(
  (select count(*)::integer from public.machine_sales_facts
   where source = 'snapcase_cash' and payment_method = 'credit'),
  0,
  'an unmatched Kexiaozhan card observation never creates a credit fact'
);
select is(
  (select details ->> 'cardContextExceptionCount'
   from private.snapcase_financial_window_revisions
   where source_machine_id = 'finance-machine'),
  '1',
  'payment-board card is retained as a contextual discrepancy'
);
select is(
  (private.operator_machine_tax_snapshot(
    '14783000-0000-4000-8000-000000000001', '2026-09-20', '2026-09-20'
  ) ->> 'netRevenueCents')::bigint,
  2500::bigint,
  'cash 10 plus existing Nayax card 20 minus one confirmed refund 5 equals 25 once'
);
select is(
  (select count(*)::integer from public.sales_adjustment_facts
   where id = '1478a000-0000-4000-8000-000000000001'),
  1,
  'refund candidates do not duplicate the existing confirmed adjustment'
);
select is(
  (select details ->> 'cashExceptionCount'
   from private.snapcase_financial_window_revisions
   where source_machine_id = 'finance-machine'),
  '0',
  'the half-open window excludes an exact grouped payment at its end boundary'
);

create temporary table replay_projection as
select public.service_project_snapcase_financial_window(
  '14784000-0000-4000-8000-000000000001', 'finance-machine',
  '2026-09-20T07:00:00Z', '2026-09-21T07:00:00Z'
) as result;
select is((select result ->> 'changedFactCount' from replay_projection), '0',
  'replaying the same window does not rewrite its cash fact');
select is((select result ->> 'revisionChanged' from replay_projection), 'false',
  'replaying the same window does not create a new financial revision');
select is(
  (select count(*)::integer from public.machine_sales_facts where source = 'snapcase_cash'),
  1,
  'the unique payment financial key also prevents concurrent duplicate facts'
);

update private.snapcase_sales_observations
set source_status = 'refund_success',
    source_refund_amount_text = '5.00',
    refund_amount_minor = 500,
    exception_codes = array[
      'financial_status_semantics_unverified',
      'refund_semantics_unverified'
    ],
    revision_digest = repeat('1', 64)
where id = '14788000-0000-4000-8000-000000000001';

create temporary table partial_refund_projection as
select public.service_project_snapcase_financial_window(
  '14784000-0000-4000-8000-000000000001', 'finance-machine',
  '2026-09-20T07:00:00Z', '2026-09-21T07:00:00Z'
) as result;
select is((select result ->> 'reasonCode' from partial_refund_projection),
  'refund_semantics_unverified',
  'a late partial refund is reviewable instead of silently changing gross sales');
select is((select result ->> 'suppressedFactCount' from partial_refund_projection), '0',
  'a refund candidate does not suppress the known original cash charge');
select is((select result ->> 'cashSalesCents' from partial_refund_projection), '1000',
  'review-preserved cash stays in the known gross window summary');
select is(
  (select net_sales_cents from public.machine_sales_facts where source = 'snapcase_cash'),
  1000,
  'the published gross cash charge survives a later partial refund state'
);
select is(
  (private.operator_machine_tax_snapshot(
    '14783000-0000-4000-8000-000000000001', '2026-09-20', '2026-09-20'
  ) ->> 'netRevenueCents')::bigint,
  2500::bigint,
  'the existing partial refund adjustment is deducted once from preserved gross'
);
select is(
  public.service_project_snapcase_financial_window(
    '14784000-0000-4000-8000-000000000001', 'finance-machine',
    '2026-09-20T07:00:00Z', '2026-09-21T07:00:00Z'
  ) ->> 'changedFactCount',
  '0',
  'replaying a partial-refund review does not rewrite the cash fact'
);

update private.snapcase_sales_observations
set source_refund_amount_text = '10.00',
    refund_amount_minor = 1000,
    revision_digest = repeat('2', 64)
where id = '14788000-0000-4000-8000-000000000001';
select is(
  public.service_project_snapcase_financial_window(
    '14784000-0000-4000-8000-000000000001', 'finance-machine',
    '2026-09-20T07:00:00Z', '2026-09-21T07:00:00Z'
  ) ->> 'reasonCode',
  'refund_semantics_unverified',
  'a late full-refund state also remains reviewable'
);
select is(
  (select net_sales_cents from public.machine_sales_facts where source = 'snapcase_cash'),
  1000,
  'the full-refund candidate does not erase the original gross charge'
);
select is(
  (private.operator_machine_tax_snapshot(
    '14783000-0000-4000-8000-000000000001', '2026-09-20', '2026-09-20'
  ) ->> 'netRevenueCents')::bigint,
  2500::bigint,
  'the unconfirmed full-refund candidate cannot add to the existing confirmed adjustment'
);
select is(
  public.service_project_snapcase_financial_window(
    '14784000-0000-4000-8000-000000000001', 'finance-machine',
    '2026-09-20T07:00:00Z', '2026-09-21T07:00:00Z'
  ) ->> 'changedFactCount',
  '0',
  'replaying a full-refund review also leaves the known gross fact unchanged'
);

update private.snapcase_machine_mappings
set reporting_machine_id = '14783000-0000-4000-8000-000000000002',
    mapped_at = statement_timestamp() + interval '1 second'
where id = '14786000-0000-4000-8000-000000000001';

select is(
  public.service_project_snapcase_financial_window(
    '14784000-0000-4000-8000-000000000001', 'finance-machine',
    '2026-09-20T07:00:00Z', '2026-09-21T07:00:00Z'
  ) ->> 'reasonCode',
  'refund_semantics_unverified',
  'a remap during refund review keeps the affected scope visibly unresolved'
);
select is(
  (select reporting_machine_id from public.machine_sales_facts where source = 'snapcase_cash'),
  '14783000-0000-4000-8000-000000000001'::uuid,
  'the known gross fact stays on its last proved machine while the refund is unresolved'
);
select is(
  (select count(*)::integer from public.machine_sales_facts
   where source = 'nayax_scheduled_report'
     and reporting_machine_id = '14783000-0000-4000-8000-000000000001'),
  1,
  'remapping SnapCase cash does not move or rewrite Nayax card money'
);
select is(
  (select count(*)::integer from public.sales_adjustment_facts
   where reporting_machine_id = '14783000-0000-4000-8000-000000000001'),
  1,
  'remapping SnapCase cash does not move or rewrite existing refunds'
);

update private.snapcase_sales_observations
set source_status = 'success',
    source_refund_amount_text = null,
    refund_amount_minor = null,
    exception_codes = array['financial_status_semantics_unverified'],
    revision_digest = repeat('3', 64)
where id = '14788000-0000-4000-8000-000000000001';

select lives_ok(
  $$select public.service_project_snapcase_financial_window(
    '14784000-0000-4000-8000-000000000001', 'finance-machine',
    '2026-09-20T07:00:00Z', '2026-09-21T07:00:00Z'
  )$$,
  'the proved cash identity reprojects after the refund exception is cleared'
);
select is(
  (select reporting_machine_id from public.machine_sales_facts where source = 'snapcase_cash'),
  '14783000-0000-4000-8000-000000000002'::uuid,
  'the one cash fact moves only after its source state is proved eligible again'
);

update private.snapcase_sales_observations
set related_order_keys = '{}'::text[],
    revision_digest = repeat('4', 64)
where id = '14788000-0000-4000-8000-000000000001';

create temporary table invalid_revision_projection as
select public.service_project_snapcase_financial_window(
  '14784000-0000-4000-8000-000000000001', 'finance-machine',
  '2026-09-20T07:00:00Z', '2026-09-21T07:00:00Z'
) as result;
select is((select result ->> 'reasonCode' from invalid_revision_projection),
  'card_window_difference',
  'optional order linkage does not invalidate authoritative cash payment gross');
select is((select result ->> 'cashSalesCents' from invalid_revision_projection), '1000',
  'an unproved linkage revision preserves the last known gross cash');
select is(
  (select raw_payload ->> 'publicationState'
   from public.machine_sales_facts where source = 'snapcase_cash'),
  'active',
  'the cash payment remains current when only optional order context changes');
select is(
  public.service_project_snapcase_financial_window(
    '14784000-0000-4000-8000-000000000001', 'finance-machine',
    '2026-09-20T07:00:00Z', '2026-09-21T07:00:00Z'
  ) ->> 'changedFactCount',
  '0',
  'replaying unchanged optional context leaves the cash fact unchanged'
);

update private.snapcase_sales_observations
set related_order_keys = array[repeat('a', 64)],
    revision_digest = repeat('5', 64)
where id = '14788000-0000-4000-8000-000000000001';
select lives_ok(
  $$select public.service_project_snapcase_financial_window(
    '14784000-0000-4000-8000-000000000001', 'finance-machine',
    '2026-09-20T07:00:00Z', '2026-09-21T07:00:00Z'
  )$$,
  'the exact linkage restores the same cash fact to active state'
);

update private.snapcase_sales_observations
set source_amount_text = '9.00',
    amount_minor = 900,
    revision_digest = repeat('8', 64)
where id = '14787000-0000-4000-8000-000000000001';

create temporary table changed_order_projection as
select public.service_project_snapcase_financial_window(
  '14784000-0000-4000-8000-000000000001', 'finance-machine',
  '2026-09-20T07:00:00Z', '2026-09-21T07:00:00Z'
) as result;
select is((select result ->> 'reasonCode' from changed_order_projection),
  'card_window_difference',
  'a linked-order-only amount revision does not invalidate payment gross');
select is((select result ->> 'cashSalesCents' from changed_order_projection), '1000',
  'the linked-order-only revision preserves the last proved payment gross');
select is(
  (select raw_payload ->> 'publicationState'
   from public.machine_sales_facts where source = 'snapcase_cash'),
  'active',
  'the unchanged payment remains active across optional order revisions'
);

update private.snapcase_sales_observations
set source_amount_text = '10.00',
    amount_minor = 1000,
    revision_digest = repeat('9', 64)
where id = '14787000-0000-4000-8000-000000000001';
select lives_ok(
  $$select public.service_project_snapcase_financial_window(
    '14784000-0000-4000-8000-000000000001', 'finance-machine',
    '2026-09-20T07:00:00Z', '2026-09-21T07:00:00Z'
  )$$,
  'a reconciled linked order restores the same payment-keyed cash fact'
);

update private.snapcase_sales_observations
set source_tender_code = '0',
    source_tender_label = 'creditCard',
    normalized_tender = 'card',
    revision_digest = repeat('6', 64)
where id = '14788000-0000-4000-8000-000000000001';

create temporary table corrected_tender_projection as
select public.service_project_snapcase_financial_window(
  '14784000-0000-4000-8000-000000000001', 'finance-machine',
  '2026-09-20T07:00:00Z', '2026-09-21T07:00:00Z'
) as result;
select is((select result ->> 'reasonCode' from corrected_tender_projection),
  'cash_projection_incomplete',
  'a proved cash-to-card correction remains reviewable until card authority reconciles');
select is((select result ->> 'cashSalesCents' from corrected_tender_projection), '0',
  'the corrected tender supersedes the old Kexiaozhan cash amount');
select is(
  (select raw_payload ->> 'publicationState'
   from public.machine_sales_facts where source = 'snapcase_cash'),
  'superseded',
  'the corrected cash fact is explicitly superseded');
select is(
  (select count(*)::integer from public.machine_sales_facts
   where source = 'snapcase_cash' and payment_method = 'credit'),
  0,
  'the tender correction does not create a Kexiaozhan card fact');
select is(
  (select net_sales_cents from public.machine_sales_facts
   where source = 'nayax_scheduled_report'),
  2000,
  'the existing Nayax card fact remains unchanged');
select is(
  (private.operator_machine_tax_snapshot(
    '14783000-0000-4000-8000-000000000001', '2026-09-20', '2026-09-20'
  ) ->> 'netRevenueCents')::bigint,
  1500::bigint,
  'the corrected Kexiaozhan cash cannot double count the Nayax card authority'
);
select is(
  public.service_project_snapcase_financial_window(
    '14784000-0000-4000-8000-000000000001', 'finance-machine',
    '2026-09-20T07:00:00Z', '2026-09-21T07:00:00Z'
  ) ->> 'changedFactCount',
  '0',
  'replaying the tender correction leaves the superseded fact unchanged'
);

update private.snapcase_sales_observations
set source_tender_code = '1',
    source_tender_label = 'cash',
    normalized_tender = 'cash',
    revision_digest = repeat('7', 64)
where id = '14788000-0000-4000-8000-000000000001';
select lives_ok(
  $$select public.service_project_snapcase_financial_window(
    '14784000-0000-4000-8000-000000000001', 'finance-machine',
    '2026-09-20T07:00:00Z', '2026-09-21T07:00:00Z'
  )$$,
  'a later proved cash revision restores the same payment-keyed fact'
);

select set_config('request.jwt.claim.role', 'authenticated', true);
select set_config('request.jwt.claim.sub', '14780000-0000-4000-8000-000000000001', true);
select ok(
  public.admin_get_snapcase_machine_mapping_queue()
    @> '[{"sourceMachineId":"finance-machine","financialReady":true,"financialReasonCode":"card_window_difference"}]'::jsonb,
  'the existing mapping queue exposes the sanitized remap discrepancy'
);

select set_config('request.jwt.claim.role', 'service_role', true);
create temporary table grouped_projection as
select public.service_project_snapcase_financial_window(
  '14784000-0000-4000-8000-000000000001', 'finance-machine',
  '2026-09-21T07:00:00Z', '2026-09-22T07:00:00Z'
) as result;
select is((select result ->> 'cashPublishedCount' from grouped_projection), '1',
  'one exact grouped payment publishes as one payment-keyed cash fact');
select is((select result ->> 'cashSalesCents' from grouped_projection), '1500',
  'the exact linked-order sum supports the grouped gross cash amount');
select is(
  (select count(*)::integer from public.machine_sales_facts where source = 'snapcase_cash'),
  2,
  'grouped orders do not split or duplicate the one collected payment fact'
);
select is(
  (select count(*)::integer from public.machine_sales_facts
   where source = 'snapcase_cash' and net_sales_cents = 1500 and transaction_count = 1),
  1,
  'the exact group keeps one transaction and requires no guessed allocation'
);
select is(
  (select item_quantity from public.machine_sales_facts
   where source = 'snapcase_cash' and net_sales_cents = 1500),
  0,
  'grouped payment quantity remains explicitly unknown without source proof'
);

select * from finish();
rollback;
