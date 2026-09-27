begin;
create extension if not exists pgtap with schema extensions;
set local search_path = public, extensions;
select no_plan();

insert into public.customer_accounts (id, name, account_type)
values (
  'e2100000-0000-4000-8000-000000000001',
  'Nayax sales fixture',
  'internal'
);

insert into public.reporting_locations (id, account_id, name, timezone)
values (
  'e2200000-0000-4000-8000-000000000001',
  'e2100000-0000-4000-8000-000000000001',
  'Nayax sales location',
  'America/Los_Angeles'
);

insert into public.reporting_machines (
  id,
  account_id,
  location_id,
  machine_label,
  sunze_machine_id,
  nayax_machine_id,
  nayax_account_key
) values (
  'e2300000-0000-4000-8000-000000000001',
  'e2100000-0000-4000-8000-000000000001',
  'e2200000-0000-4000-8000-000000000001',
  'Nayax-only fixture',
  null,
  '600000001',
  'TGPACI_USA_DB'
), (
  'e2300000-0000-4000-8000-000000000002',
  'e2100000-0000-4000-8000-000000000001',
  'e2200000-0000-4000-8000-000000000001',
  'Sunze overlap fixture',
  'sunze-overlap',
  '600000002',
  'TGPACI_USA_DB'
);

insert into public.refund_nayax_machine_inventory (
  account_key,
  nayax_machine_id,
  provider_is_active,
  refund_category,
  reporting_machine_id,
  reconciliation_state,
  setup_reason
) values (
  'TGPACI_USA_DB',
  '600000001',
  true,
  'snapcase',
  'e2300000-0000-4000-8000-000000000001',
  'published',
  'test_fixture'
), (
  'TGPACI_USA_DB',
  '600000002',
  true,
  'snapcase',
  'e2300000-0000-4000-8000-000000000002',
  'published',
  'test_fixture'
);

insert into public.nayax_scheduled_report_files (
  file_digest,
  received_at,
  byte_count,
  row_count,
  report
) values (
  repeat('c', 64),
  '2026-09-26T01:05:00Z',
  500,
  1,
  '{}'::jsonb
), (
  repeat('d', 64),
  '2026-09-26T01:05:00Z',
  500,
  1,
  '{}'::jsonb
), (
  repeat('e', 64),
  '2026-09-26T01:05:00Z',
  500,
  1,
  '{}'::jsonb
), (
  repeat('f', 64),
  '2026-09-26T03:05:00Z',
  500,
  1,
  '{}'::jsonb
), (
  repeat('0', 64),
  '2026-09-26T02:05:00Z',
  500,
  1,
  '{}'::jsonb
);

create function pg_temp.sale(
  p_machine_id text,
  p_transaction_id text,
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
    'providerMachineId', p_machine_id,
    'currencyCode', 'USD',
    'authorizationAmountCents', 1080,
    'settlementAmountCents', 1080,
    'paidAmountCents', 1080,
    'machineSettledAt', '2026-09-25T18:00:00',
    'providerSettledAt', '2026-09-26T01:00:00Z',
    'providerUpdatedAt', '2026-09-26T01:00:05Z',
    'providerStatus', 12,
    'providerStatusName', 'Settled',
    'sourceOrderHash', p_order_hash,
    'sourceRowHash', p_row_hash
  );
$$;

select set_config('request.jwt.claim.role', 'service_role', true);

select lives_ok(
  $$select public.service_ingest_nayax_scheduled_sales(
    repeat('c', 64),
    jsonb_build_array(pg_temp.sale('600000001', '800000001', repeat('a', 64), repeat('b', 64)))
  )$$,
  'A published Nayax-only machine imports one settled sale'
);

select is(
  (
    select count(*)
    from public.machine_sales_facts
    where source = 'nayax_scheduled_report'
  ),
  1::bigint,
  'One Nayax sale fact exists'
);

select is(
  (
    select net_sales_cents
    from public.machine_sales_facts
    where source = 'nayax_scheduled_report'
  ),
  1080,
  'The settled amount is used as revenue'
);

select is(
  (
    select sale_date
    from public.machine_sales_facts
    where source = 'nayax_scheduled_report'
  ),
  date '2026-09-25',
  'The sale date uses the provider machine-local settlement date'
);

select is(
  (
    select raw_payload ->> 'providerUpdatedAt'
    from public.machine_sales_facts
    where source = 'nayax_scheduled_report'
      and source_order_hash = repeat('a', 64)
  ),
  '2026-09-26T01:00:05Z',
  'The fact retains the actual provider update clock'
);

select is(
  (
    public.service_ingest_nayax_scheduled_sales(
      repeat('c', 64),
      jsonb_build_array(pg_temp.sale('600000001', '800000001', repeat('a', 64), repeat('b', 64)))
    ) ->> 'duplicate'
  )::boolean,
  true,
  'The same report file is idempotent'
);

select lives_ok(
  $$select public.service_ingest_nayax_scheduled_sales(
    repeat('d', 64),
    jsonb_build_array(pg_temp.sale('600000002', '800000002', repeat('e', 64), repeat('f', 64)))
  )$$,
  'A Sunze-backed machine is safely recognized'
);

select is(
  (
    select sunze_overlap_rows
    from public.nayax_scheduled_sales_ingestions
    where file_digest = repeat('d', 64)
  ),
  0,
  'Sunze-backed card sales are staged for an explicit source boundary'
);

select is(
  (
    select count(*)
    from public.machine_sales_facts
    where source = 'nayax_scheduled_report'
  ),
  2::bigint,
  'The overlap fact is retained for a reversible authority transition'
);

select is(
  (
    select net_sales_cents
    from public.machine_sales_facts
    where source = 'nayax_scheduled_report'
      and reporting_machine_id = 'e2300000-0000-4000-8000-000000000002'
  ),
  0,
  'A staged overlap fact contributes no revenue before its boundary'
);

insert into public.refund_nayax_machine_inventory (
  account_key,
  nayax_machine_id,
  provider_is_active,
  refund_category,
  reporting_machine_id,
  reconciliation_state,
  setup_reason,
  exclusion_reason
) values (
  'TGPACI_USA_DB',
  '600000003',
  true,
  'snapcase',
  null,
  'excluded',
  'explicitly_excluded',
  'test exclusion'
);

select lives_ok(
  $$select public.service_ingest_nayax_scheduled_sales(
    repeat('e', 64),
    jsonb_build_array(pg_temp.sale('600000003', '800000003', repeat('1', 64), repeat('2', 64)))
  )$$,
  'A valid sale for an excluded machine is retained without publication'
);

select is(
  (
    select disposition
    from public.nayax_pending_sales
    where source_order_hash = repeat('1', 64)
  ),
  'excluded',
  'An explicit inventory exclusion remains staged'
);

insert into public.refund_nayax_machine_inventory (
  account_key,
  nayax_machine_id,
  provider_is_active,
  refund_category,
  reporting_machine_id,
  reconciliation_state,
  setup_reason,
  exclusion_reason
) values (
  'TGPACI_USA_DB',
  '600000004',
  true,
  'snapcase',
  null,
  'excluded',
  'explicitly_excluded',
  'test revised machine exclusion'
);

select lives_ok(
  $$select public.service_ingest_nayax_scheduled_sales(
    repeat('0', 64),
    jsonb_build_array(
      jsonb_set(
        jsonb_set(
          jsonb_set(
            jsonb_set(
              jsonb_set(
                jsonb_set(
                  pg_temp.sale('600000004', '800000003', repeat('1', 64), repeat('3', 64)),
                  '{authorizationAmountCents}',
                  '1200'::jsonb
                ),
                '{paidAmountCents}',
                '0'::jsonb
              ),
              '{machineSettledAt}',
              '"2026-09-26T00:30:00"'::jsonb
            ),
            '{providerSettledAt}',
            '"2026-09-26T02:00:00Z"'::jsonb
          ),
          '{providerUpdatedAt}',
          '"2026-09-26T02:00:05Z"'::jsonb
        ),
        '{providerStatus}',
        '62'::jsonb
      ) || jsonb_build_object(
        'providerStatusName',
        'Refunded'
      )
    )
  )$$,
  'A newer same-key provider revision updates the retained normalized evidence'
);

select is(
  (
    select concat_ws(
      '|',
      provider_machine_id,
      machine_settled_at::text,
      provider_settled_at::text,
      source_row_hash
    )
    from public.nayax_pending_sales
    where source_order_hash = repeat('1', 64)
  ),
  concat_ws(
    '|',
    '600000004',
    timestamp '2026-09-26T00:30:00'::text,
    timestamptz '2026-09-26T02:00:00Z'::text,
    repeat('3', 64)
  ),
  'Typed machine, local time, UTC time, and row hash match the newest normalized evidence'
);

select is(
  (
    select concat_ws('|', provider_status::text, provider_status_name)
    from public.nayax_pending_sales
    where source_order_hash = repeat('1', 64)
  ),
  '62|Refunded',
  'A positive original first observed as refunded remains staged as gross-sale evidence'
);

insert into public.reporting_machines (
  id,
  account_id,
  location_id,
  machine_label,
  nayax_machine_id,
  nayax_account_key,
  status
) values (
  'e2300000-0000-4000-8000-000000000003',
  'e2100000-0000-4000-8000-000000000001',
  'e2200000-0000-4000-8000-000000000001',
  'Historical inactive fixture',
  '600000004',
  'TGPACI_USA_DB',
  'inactive'
);

update public.refund_nayax_machine_inventory
set
  provider_is_active = true,
  reporting_machine_id = 'e2300000-0000-4000-8000-000000000003',
  reconciliation_state = 'published',
  setup_reason = 'test_historical_mapping',
  exclusion_reason = null
where account_key = 'TGPACI_USA_DB'
  and nayax_machine_id = '600000004';

select is(
  (
    public.service_promote_nayax_pending_sales() ->> 'promotedRows'
  )::integer,
  1,
  'The periodic recovery promotes a newly mapped historical sale'
);

select is(
  (
    select disposition
    from public.nayax_pending_sales
    where source_order_hash = repeat('1', 64)
  ),
  'promoted',
  'The retained row records its promoted disposition'
);

select is(
  (
    select sale_date
    from public.machine_sales_facts
    where source = 'nayax_scheduled_report'
      and source_order_hash = repeat('1', 64)
  ),
  date '2026-09-26',
  'Historical promotion does not depend on the current reporting machine active state'
);

select lives_ok(
  $$select public.service_ingest_nayax_scheduled_sales(
    repeat('f', 64),
    jsonb_build_array(
      jsonb_set(
        jsonb_set(
          pg_temp.sale('600000004', '800000003', repeat('1', 64), repeat('4', 64)),
          '{providerUpdatedAt}',
          '"2026-09-26T01:00:06Z"'::jsonb
        ),
        '{providerSettledAt}',
        '"2026-09-26T01:00:00Z"'::jsonb
      )
    )
  )$$,
  'An older scheduled revision remains an idempotent successful ingest'
);

select is(
  (
    select raw_payload ->> 'providerStatus'
    from public.machine_sales_facts
    where source = 'nayax_scheduled_report'
      and source_order_hash = repeat('1', 64)
  ),
  '62',
  'Older status-12 evidence cannot replace the newer refunded gross-sale revision'
);

select ok(
  not has_table_privilege('authenticated', 'public.nayax_pending_sales', 'SELECT'),
  'Customer sessions cannot inspect pending provider sales'
);

select ok(
  not has_function_privilege(
    'authenticated',
    'public.service_promote_nayax_pending_sales(integer)',
    'EXECUTE'
  ),
  'Customer sessions cannot promote pending provider sales'
);

select set_config('request.jwt.claim.role', 'authenticated', true);
select throws_ok(
  $$select public.service_ingest_nayax_scheduled_sales(repeat('c', 64), '[]'::jsonb)$$,
  'P0001',
  'Service report sales ingestion required',
  'Customer sessions cannot import provider sales'
);

select * from finish();
rollback;
