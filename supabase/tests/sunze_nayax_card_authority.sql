begin;
create extension if not exists pgtap with schema extensions;
set local search_path = public, extensions;
select no_plan();

insert into public.customer_accounts (id, name, account_type)
values ('e3100000-0000-4000-8000-000000000001', 'Card authority fixture', 'internal');

insert into auth.users (
  instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at
) values (
  '00000000-0000-0000-0000-000000000000',
  'e3000000-0000-4000-8000-000000000001',
  'authenticated', 'authenticated', 'card-authority@example.invalid', '', now(),
  '{}'::jsonb, '{}'::jsonb, now(), now()
);

insert into public.admin_roles (user_id, role, active)
values ('e3000000-0000-4000-8000-000000000001', 'super_admin', true);

insert into public.reporting_locations (id, account_id, name, timezone)
values (
  'e3200000-0000-4000-8000-000000000001',
  'e3100000-0000-4000-8000-000000000001',
  'Card authority location',
  'America/Los_Angeles'
);

insert into public.reporting_machines (
  id, account_id, location_id, machine_label,
  sunze_machine_id, nayax_machine_id, nayax_account_key
) values (
  'e3300000-0000-4000-8000-000000000001',
  'e3100000-0000-4000-8000-000000000001',
  'e3200000-0000-4000-8000-000000000001',
  'Sunze and Nayax fixture',
  'sunze-authority-fixture',
  '700000001',
  'TGPACI_USA_DB'
);

insert into public.refund_nayax_machine_inventory (
  account_key, nayax_machine_id, provider_is_active, refund_category,
  reporting_machine_id, reconciliation_state, setup_reason
) values (
  'TGPACI_USA_DB', '700000001', true, 'cotton_candy',
  'e3300000-0000-4000-8000-000000000001', 'published', 'test_fixture'
);

insert into public.nayax_scheduled_report_files (
  file_digest, received_at, byte_count, row_count, report
) values (
  repeat('1', 64), '2025-01-02T08:05:00Z', 500, 2, '{}'::jsonb
), (
  repeat('2', 64), '2025-01-03T08:05:00Z', 500, 1, '{}'::jsonb
);

create function pg_temp.card_sale(
  p_transaction_id text,
  p_settled_at text,
  p_amount_cents integer,
  p_order_hash text,
  p_row_hash text
)
returns jsonb
language sql
as $$
  select jsonb_build_object(
    'transactionId', p_transaction_id,
    'siteId', '4',
    'actorId', '2003563806',
    'providerMachineId', '700000001',
    'currencyCode', 'USD',
    'authorizationAmountCents', p_amount_cents,
    'settlementAmountCents', p_amount_cents,
    'paidAmountCents', p_amount_cents,
    'providerSettledAt', p_settled_at,
    'providerStatus', 12,
    'providerStatusName', 'Settled',
    'sourceOrderHash', p_order_hash,
    'sourceRowHash', p_row_hash
  );
$$;

select set_config('request.jwt.claim.role', 'service_role', true);

select lives_ok(
  $$select public.upsert_sunze_sales_facts(jsonb_build_array(
    jsonb_build_object(
      'reporting_machine_id', 'e3300000-0000-4000-8000-000000000001',
      'reporting_location_id', 'e3200000-0000-4000-8000-000000000001',
      'sale_date', '2025-01-02',
      'payment_method', 'credit',
      'net_sales_cents', 1500,
      'transaction_count', 1,
      'source', 'sunze_browser',
      'source_order_hash', repeat('3', 64),
      'source_row_hash', repeat('4', 64),
      'item_quantity', 2,
      'tax_cents', 120,
      'source_payment_status', 'Payment success',
      'payment_time', '2025-01-02T08:00:00Z',
      'raw_payload', jsonb_build_object(
        'order_amount_cents', 1500,
        'item_quantity', 2,
        'tax_cents', 120
      )
    ),
    jsonb_build_object(
      'reporting_machine_id', 'e3300000-0000-4000-8000-000000000001',
      'reporting_location_id', 'e3200000-0000-4000-8000-000000000001',
      'sale_date', '2025-01-02',
      'payment_method', 'credit',
      'net_sales_cents', 0,
      'transaction_count', 1,
      'source', 'sunze_browser',
      'source_order_hash', repeat('c', 64),
      'source_row_hash', repeat('d', 64),
      'item_quantity', 3,
      'tax_cents', 0,
      'source_payment_status', 'Payment failed',
      'payment_time', '2025-01-02T08:00:30Z',
      'raw_payload', jsonb_build_object(
        'order_amount_cents', 0,
        'item_quantity', 3,
        'tax_cents', 0
      )
    ),
    jsonb_build_object(
      'reporting_machine_id', 'e3300000-0000-4000-8000-000000000001',
      'reporting_location_id', 'e3200000-0000-4000-8000-000000000001',
      'sale_date', '2025-01-02',
      'payment_method', 'cash',
      'net_sales_cents', 500,
      'transaction_count', 1,
      'source', 'sunze_browser',
      'source_order_hash', repeat('5', 64),
      'source_row_hash', repeat('6', 64),
      'item_quantity', 1,
      'tax_cents', 40,
      'source_payment_status', 'Payment success',
      'payment_time', '2025-01-02T08:01:00Z',
      'raw_payload', jsonb_build_object('order_amount_cents', 500)
    )
  ))$$,
  'Sunze cash and legacy card facts import normally'
);

insert into public.sales_adjustment_facts (
  reporting_machine_id, reporting_location_id, adjustment_date,
  adjustment_type, amount_cents, source, source_row_hash
) values (
  'e3300000-0000-4000-8000-000000000001',
  'e3200000-0000-4000-8000-000000000001',
  '2025-01-02', 'refund', 300, 'manual', repeat('7', 64)
);

select lives_ok(
  $$select public.service_ingest_nayax_scheduled_sales(
    repeat('1', 64),
    jsonb_build_array(
      pg_temp.card_sale(
        '900000001', '2025-01-02T08:00:00Z', 100,
        repeat('8', 64), repeat('9', 64)
      ),
      pg_temp.card_sale(
        '900000003', '2025-01-02T08:00:10Z', 1900,
        repeat('e', 64), repeat('f', 64)
      )
    )
  )$$,
  'A settled 2025 Nayax row is accepted and staged'
);

select is(
  (
    select sum(net_sales_cents)::integer
    from public.machine_sales_facts
    where reporting_machine_id = 'e3300000-0000-4000-8000-000000000001'
      and sale_date = '2025-01-02'
  ),
  2000,
  'Before the boundary, legacy Sunze card plus cash revenue remains complete'
);

select is(
  (
    select net_sales_cents
    from public.machine_sales_facts
    where source = 'nayax_scheduled_report'
      and source_order_hash = repeat('8', 64)
  ),
  0,
  'The overlap Nayax card is non-contributing before the boundary'
);

update public.reporting_machines
set nayax_card_sales_started_on = '2025-01-02'
where id = 'e3300000-0000-4000-8000-000000000001';

select is(
  (
    select sum(net_sales_cents)::integer
    from public.machine_sales_facts
    where reporting_machine_id = 'e3300000-0000-4000-8000-000000000001'
      and sale_date = '2025-01-02'
  ),
  2500,
  'After the boundary, Nayax card plus Sunze cash revenue is counted once'
);

select results_eq(
  $$
    select
      sum(transaction_count)::integer,
      sum(item_quantity)::integer,
      sum(tax_cents)::integer
    from public.machine_sales_facts
    where reporting_machine_id = 'e3300000-0000-4000-8000-000000000001'
      and sale_date = '2025-01-02'
      and payment_method = 'credit'
  $$,
  $$values (2, 5, 120)$$,
  'Paid and zero-value Sunze operational metrics each contribute exactly once'
);

select results_eq(
  $$
    select net_sales_cents, transaction_count, item_quantity, tax_cents
    from public.machine_sales_facts
    where source = 'sunze_browser'
      and source_order_hash = repeat('3', 64)
  $$,
  $$values (0, 0, 0, 0)$$,
  'The paid post-boundary Sunze card row is provenance, not duplicate totals'
);

select is(
  (
    select (raw_payload #>> '{_salesAuthorityOriginal,netSalesCents}')::integer
    from public.machine_sales_facts
    where source = 'sunze_browser'
      and source_order_hash = repeat('3', 64)
  ),
  1500,
  'The original Sunze card amount is retained for rollback'
);

select results_eq(
  $$
    select net_sales_cents, transaction_count, item_quantity, tax_cents
    from public.machine_sales_facts
    where source = 'card_authority_daily'
  $$,
  $$values (2000, 1, 2, 120)$$,
  'The daily authority projection combines Nayax money with paid Sunze metrics'
);

select results_eq(
  $$
    select net_sales_cents, transaction_count, item_quantity, tax_cents
    from public.machine_sales_facts
    where source = 'sunze_browser'
      and source_order_hash = repeat('c', 64)
  $$,
  $$values (0, 1, 3, 0)$$,
  'A zero-value Sunze operational row stays separate and gains no deductions'
);

select results_eq(
  $$
    select net_sales_cents, transaction_count, item_quantity, tax_cents
    from public.machine_sales_facts
    where source = 'sunze_browser'
      and payment_method = 'cash'
      and source_order_hash = repeat('5', 64)
  $$,
  $$values (500, 1, 1, 40)$$,
  'Sunze cash is unchanged by the card authority boundary'
);

select is(
  (
    select sum(amount_cents)::integer
    from public.sales_adjustment_facts
    where reporting_machine_id = 'e3300000-0000-4000-8000-000000000001'
  ),
  300,
  'The canonical refund adjustment remains unchanged'
);

insert into public.reporting_partnerships (
  id, name, partnership_type, reporting_week_end_day, timezone,
  effective_start_date, effective_end_date, status
) values (
  'e3500000-0000-4000-8000-000000000001',
  'Card authority partner fixture', 'revenue_share', 0,
  'America/Los_Angeles', '2025-01-01', '2025-01-31', 'active'
);

insert into public.reporting_machine_partnership_assignments (
  machine_id, partnership_id, assignment_role,
  effective_start_date, effective_end_date, status
) values (
  'e3300000-0000-4000-8000-000000000001',
  'e3500000-0000-4000-8000-000000000001',
  'primary_reporting', '2025-01-01', '2025-01-31', 'active'
);

insert into public.reporting_partnership_financial_rules (
  partnership_id, calculation_model, split_base,
  fee_amount_cents, fee_basis, cost_amount_cents, cost_basis,
  deduction_timing, gross_to_net_method,
  fever_share_basis_points, partner_share_basis_points,
  bloomjoy_share_basis_points, effective_start_date,
  effective_end_date, status
) values (
  'e3500000-0000-4000-8000-000000000001',
  'contribution_split', 'contribution_after_costs',
  100, 'per_order', 200, 'per_stick',
  'before_split', 'imported_tax_plus_configured_fees',
  0, 10000, 0, '2025-01-01', '2025-01-31', 'active'
);

select set_config('request.jwt.claim.role', 'authenticated', true);
select set_config(
  'request.jwt.claim.sub',
  'e3000000-0000-4000-8000-000000000001',
  true
);

select results_eq(
  $$
    select
      (preview #>> '{summary,gross_sales_cents}')::integer,
      (preview #>> '{summary,refund_amount_cents}')::integer,
      (preview #>> '{summary,order_count}')::integer,
      (preview #>> '{summary,item_quantity}')::integer,
      (preview #>> '{summary,tax_cents}')::integer,
      (preview #>> '{summary,fee_cents}')::integer,
      (preview #>> '{summary,cost_cents}')::integer,
      (preview #>> '{summary,amount_owed_cents}')::integer
    from (
      select public.admin_preview_partner_period_report_internal(
        'e3500000-0000-4000-8000-000000000001',
        '2025-01-01', '2025-01-31', 'calendar_month'
      ) as preview
    ) result
  $$,
  $$values (2500, 300, 3, 6, 160, 200, 600, 1240)$$,
  'Partner preview applies daily card tax, fees, costs, and refund exactly once'
);

select set_config('request.jwt.claim.role', 'service_role', true);
select set_config('request.jwt.claim.sub', '', true);

update public.machine_sales_facts
set net_sales_cents = 1700,
    source_row_hash = repeat('0', 64),
    raw_payload = raw_payload - '_salesAuthorityOriginal'
where source = 'nayax_scheduled_report'
  and source_order_hash = repeat('e', 64);

select is(
  (
    select net_sales_cents
    from public.machine_sales_facts
    where source = 'card_authority_daily'
  ),
  1800,
  'A late Nayax correction recomputes the daily card aggregate'
);

update public.machine_sales_facts
set net_sales_cents = 1900,
    source_row_hash = repeat('f', 64),
    raw_payload = raw_payload - '_salesAuthorityOriginal'
where source = 'nayax_scheduled_report'
  and source_order_hash = repeat('e', 64);

delete from public.machine_sales_facts
where source = 'nayax_scheduled_report'
  and source_order_hash = repeat('e', 64);

select is(
  (
    select net_sales_cents
    from public.machine_sales_facts
    where source = 'card_authority_daily'
  ),
  100,
  'Deleting a provider row reconciles the old machine and date scope'
);

insert into public.machine_sales_facts (
  reporting_machine_id, reporting_location_id, sale_date, payment_method,
  net_sales_cents, transaction_count, source, source_order_hash,
  source_row_hash, item_quantity, tax_cents, source_payment_status,
  payment_time, raw_payload
) values (
  'e3300000-0000-4000-8000-000000000001',
  'e3200000-0000-4000-8000-000000000001',
  '2025-01-02', 'credit', 1900, 1, 'nayax_scheduled_report',
  repeat('e', 64), repeat('f', 64), 1, 0, 'Settled',
  '2025-01-02T08:00:10Z',
  jsonb_build_object('providerMachineId', '700000001', 'payloadRedacted', true)
);

select is(
  (
    select net_sales_cents
    from public.machine_sales_facts
    where source = 'card_authority_daily'
  ),
  2000,
  'Reinserting the provider row restores the daily aggregate exactly once'
);

select lives_ok(
  $$select public.upsert_sunze_sales_facts(jsonb_build_array(
    jsonb_build_object(
      'reporting_machine_id', 'e3300000-0000-4000-8000-000000000001',
      'reporting_location_id', 'e3200000-0000-4000-8000-000000000001',
      'sale_date', '2025-02-01',
      'payment_method', 'credit',
      'net_sales_cents', 900,
      'transaction_count', 1,
      'source', 'sunze_browser',
      'source_order_hash', repeat('1a', 32),
      'source_row_hash', repeat('1b', 32),
      'item_quantity', 2,
      'tax_cents', 70,
      'source_payment_status', 'Payment success',
      'payment_time', '2025-02-01T08:00:00Z',
      'raw_payload', jsonb_build_object('order_amount_cents', 900)
    )
  ))$$,
  'A post-boundary Sunze card can arrive before its Nayax day'
);

select results_eq(
  $$
    select
      coalesce(sum(net_sales_cents), 0)::integer,
      coalesce(sum(transaction_count), 0)::integer,
      coalesce(sum(item_quantity), 0)::integer
    from public.machine_sales_facts
    where reporting_machine_id = 'e3300000-0000-4000-8000-000000000001'
      and sale_date = '2025-02-01'
      and payment_method = 'credit'
  $$,
  $$values (0, 1, 2)$$,
  'A day without Nayax money keeps only zero-value Sunze operational counts'
);

select is(
  (
    select count(*)
    from public.machine_sales_facts
    where source = 'card_authority_daily'
      and sale_date = '2025-02-01'
  ),
  0::bigint,
  'A day without Nayax money has no daily authority projection'
);

update public.reporting_machines
set nayax_card_sales_started_on = null
where id = 'e3300000-0000-4000-8000-000000000001';

select results_eq(
  $$
    select source, net_sales_cents, transaction_count, item_quantity, tax_cents
    from public.machine_sales_facts
    where source_order_hash in (repeat('3', 64), repeat('8', 64))
    order by source
  $$,
  $$values
    ('nayax_scheduled_report'::text, 0, 0, 0, 0),
    ('sunze_browser'::text, 1500, 1, 2, 120)
  $$,
  'Clearing the boundary restores Sunze history and removes staged Nayax totals'
);

select is(
  (
    select count(*)
    from public.machine_sales_facts
    where source = 'card_authority_daily'
  ),
  0::bigint,
  'Clearing the boundary removes the daily authority projection'
);

update public.reporting_machines
set nayax_card_sales_started_on = '2025-01-02'
where id = 'e3300000-0000-4000-8000-000000000001';

select is(
  (
    public.service_ingest_nayax_scheduled_sales(
      repeat('1', 64),
      jsonb_build_array(pg_temp.card_sale(
        '900000001', '2025-01-02T08:00:00Z', 2000,
        repeat('8', 64), repeat('9', 64)
      ))
    ) ->> 'duplicate'
  )::boolean,
  true,
  'Replaying the current authority report is idempotent'
);

insert into public.sales_import_runs (
  id, source, status, source_reference, rows_seen, rows_imported,
  rows_skipped, completed_at
) values (
  'e3400000-0000-4000-8000-000000000001',
  'nayax_scheduled_report', 'completed', repeat('2', 64), 1, 0, 1,
  '2025-01-03T08:05:00Z'
);

insert into public.nayax_scheduled_sales_ingestions (
  file_digest, import_run_id, settled_rows, imported_rows,
  unmapped_rows, sunze_overlap_rows
) values (
  repeat('2', 64), 'e3400000-0000-4000-8000-000000000001',
  1, 0, 0, 1
);

select throws_ok(
  $$select public.service_ingest_nayax_scheduled_sales(
    repeat('2', 64),
    '[]'::jsonb
  )$$,
  'P0001',
  'Complete native report sales replay required',
  'A partial payload cannot consume the one-time overlap replay'
);

select is(
  (
    select count(*)
    from public.nayax_scheduled_card_authority_replays
    where file_digest = repeat('2', 64)
  ),
  0::bigint,
  'A rejected partial replay records no immutable completion receipt'
);

update public.refund_nayax_machine_inventory
set reconciliation_state = 'needs_setup',
    setup_reason = 'test_temporarily_unmapped'
where account_key = 'TGPACI_USA_DB'
  and nayax_machine_id = '700000001';

select throws_ok(
  $$select public.service_ingest_nayax_scheduled_sales(
    repeat('2', 64),
    jsonb_build_array(pg_temp.card_sale(
      '900000002', '2025-01-03T08:00:00Z', 1700,
      repeat('a', 64), repeat('b', 64)
    ))
  )$$,
  'P0001',
  'Complete mapped overlap replay required',
  'A now-unmapped row cannot consume the one-time overlap replay'
);

update public.refund_nayax_machine_inventory
set reconciliation_state = 'published',
    setup_reason = 'test_fixture'
where account_key = 'TGPACI_USA_DB'
  and nayax_machine_id = '700000001';

select is(
  (
    public.service_ingest_nayax_scheduled_sales(
      repeat('2', 64),
      jsonb_build_array(pg_temp.card_sale(
        '900000002', '2025-01-03T08:00:00Z', 1700,
        repeat('a', 64), repeat('b', 64)
      ))
    ) ->> 'authorityReplay'
  )::boolean,
  true,
  'A previously skipped authenticated overlap report replays once'
);

select is(
  (
    select count(*)
    from public.nayax_scheduled_card_authority_replays
    where file_digest = repeat('2', 64)
  ),
  1::bigint,
  'The old-file authority replay has one immutable receipt'
);

select is(
  (
    public.service_ingest_nayax_scheduled_sales(
      repeat('2', 64),
      jsonb_build_array(pg_temp.card_sale(
        '900000002', '2025-01-03T08:00:00Z', 1700,
        repeat('a', 64), repeat('b', 64)
      ))
    ) ->> 'duplicate'
  )::boolean,
  true,
  'A repeated skipped-file replay is a no-op'
);

select is(
  (
    select count(*)
    from public.machine_sales_facts
    where source = 'nayax_scheduled_report'
      and source_order_hash = repeat('a', 64)
  ),
  1::bigint,
  'The replayed provider payment is present exactly once'
);

select * from finish();
rollback;
