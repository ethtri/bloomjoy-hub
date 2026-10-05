begin;

create extension if not exists pgtap with schema extensions;
set local search_path = public, extensions;
select plan(18);

insert into auth.users (
  instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at
) values (
  '00000000-0000-0000-0000-000000000000',
  '15490000-0000-4000-8000-000000000001',
  'authenticated', 'authenticated', 'reader-replacement-admin@example.test', '', now(),
  '{}'::jsonb, '{}'::jsonb, now(), now()
);

insert into public.admin_roles (user_id, role, active)
values ('15490000-0000-4000-8000-000000000001', 'super_admin', true);

insert into public.customer_accounts (id, name, account_type, status)
values ('15490000-0000-4000-8000-000000000002', 'Reader replacement fixture', 'internal', 'active');

insert into public.reporting_locations (id, account_id, name, city, state, timezone, status)
values (
  '15490000-0000-4000-8000-000000000003',
  '15490000-0000-4000-8000-000000000002',
  'Replacement fixture location', 'Test City', 'CA', 'America/Los_Angeles', 'active'
);

insert into public.reporting_machines (
  id, account_id, location_id, machine_label, machine_type, status,
  sunze_machine_id, nayax_machine_id, nayax_account_key,
  nayax_card_sales_started_on, nayax_refunds_enabled,
  refund_intake_enabled, refund_public_display_label
) values (
  '15490000-0000-4000-8000-000000000004',
  '15490000-0000-4000-8000-000000000002',
  '15490000-0000-4000-8000-000000000003',
  'Reader replacement fixture', 'commercial', 'active',
  'SUNZE-1549', 'NAYAX-OLD-1549', 'FIXTURE_ACCOUNT',
  '2026-09-01', false, false, null
);

insert into public.reporting_machine_refund_managers (
  reporting_machine_id, manager_user_id, manager_email, status, grant_reason
) values (
  '15490000-0000-4000-8000-000000000004',
  '15490000-0000-4000-8000-000000000001',
  'reader-replacement-admin@example.test', 'active', 'Reader replacement test route'
);

insert into public.refund_nayax_machine_inventory (
  id, account_key, nayax_machine_id, machine_name, provider_status_bit,
  provider_is_active, missing_successful_snapshots, refund_category,
  reporting_machine_id, reconciliation_state, setup_reason, decision_reason
) values
  (
    '15490000-0000-4000-8000-000000000005', 'FIXTURE_ACCOUNT', 'NAYAX-OLD-1549',
    'Old fixture reader', 1, true, 0, 'cotton_candy',
    '15490000-0000-4000-8000-000000000004', 'published', 'ready', 'Fixture current reader'
  ),
  (
    '15490000-0000-4000-8000-000000000006', 'FIXTURE_ACCOUNT', 'NAYAX-NEW-1549',
    'New fixture reader', 1, true, 0, null,
    null, 'needs_setup', 'exact_mapping_required', null
  ),
  (
    '15490000-0000-4000-8000-000000000007', 'OTHER_ACCOUNT', 'NAYAX-WRONG-1549',
    'Wrong account fixture reader', 1, true, 0, 'cotton_candy',
    null, 'needs_setup', 'exact_mapping_required', null
  );

insert into public.machine_sales_facts (
  id, reporting_machine_id, reporting_location_id, sale_date, payment_method,
  net_sales_cents, transaction_count, source, source_order_hash, source_row_hash,
  item_quantity, tax_cents, source_payment_status, payment_time, raw_payload
) values (
  '15490000-0000-4000-8000-000000000008',
  '15490000-0000-4000-8000-000000000004',
  '15490000-0000-4000-8000-000000000003',
  '2026-09-10', 'credit', 1250, 1, 'nayax_scheduled_report', repeat('1', 64),
  repeat('2', 64), 1, 0, 'Settled', '2026-09-10T18:00:00Z',
  jsonb_build_object(
    'providerMachineId', 'NAYAX-OLD-1549',
    'transactionId', 'NAYAX-TXN-1549',
    'payloadRedacted', true
  )
);

insert into public.refund_cases (
  id, public_reference, reporting_machine_id, reporting_location_id,
  customer_email, issue_summary, incident_at, payment_method,
  payment_amount_cents, refund_amount_cents, status, decision,
  refund_completed_at, correlation_status, correlation_source, correlation_confidence,
  automation_state, nayax_refund_execution_status, nayax_match_execution_eligible,
  matched_nayax_transaction_id, matched_nayax_machine_auth_time,
  matched_nayax_amount_cents, matched_nayax_currency_code, matched_nayax_site_id
) values (
  '15490000-0000-4000-8000-000000000009', 'RF-READER-1549',
  '15490000-0000-4000-8000-000000000004',
  '15490000-0000-4000-8000-000000000003',
  'reader-history@example.test', 'Historical reader-linked refund fixture',
  '2026-09-10T18:00:00Z', 'card', 1250, 1250, 'completed', 'approved',
  '2026-09-11T18:00:00Z', 'matched', 'nayax', 1, 'completed', 'approved', false,
  'NAYAX-TXN-1549', '2026-09-10T18:00:00Z',
  1250, 'USD', 1549
);

insert into public.refund_authoritative_receipts (
  refund_case_id, reporting_machine_id, account_scope, provider_machine_id,
  original_transaction_id, original_amount_cents, refunded_amount_cents,
  currency_code, provider_status, evidence_reference_digest, recorded_by,
  attempt_binding_kind, current_provider_observation_reviewed
) values (
  '15490000-0000-4000-8000-000000000009',
  '15490000-0000-4000-8000-000000000004', 'FIXTURE_ACCOUNT',
  'NAYAX-OLD-1549', 'NAYAX-TXN-1549', 1250, 1250, 'USD', 62,
  repeat('3', 64), '15490000-0000-4000-8000-000000000001',
  'no_attempt_integrity_hold', true
);

create temporary table historical_sale_before as
select to_jsonb(fact) as snapshot
from public.machine_sales_facts fact
where fact.id = '15490000-0000-4000-8000-000000000008';

set local role authenticated;
select set_config('request.jwt.claim.sub', '15490000-0000-4000-8000-000000000001', true);

create temporary table replacement_result as
select public.admin_replace_refund_nayax_machine(
  '15490000-0000-4000-8000-000000000004',
  '15490000-0000-4000-8000-000000000006',
  'Synthetic failed reader replacement'
) as result;

select is(
  (select result ->> 'readiness' from replacement_result),
  'ready',
  'The atomic replacement reports verified readiness'
);

reset role;

select is(
  (select refund_public_display_label from public.reporting_machines where id='15490000-0000-4000-8000-000000000004'),
  'Reader replacement fixture',
  'A missing legacy override uses the effective machine name without a redundant rename'
);
select is(
  (select machine_display_name from public.reporting_machines where id='15490000-0000-4000-8000-000000000004'),
  null::text,
  'Advanced replacement does not create a separate name edit'
);

select is(
  (select nayax_machine_id from public.reporting_machines where id = '15490000-0000-4000-8000-000000000004'),
  'NAYAX-NEW-1549',
  'The reporting machine uses the replacement Nayax ID'
);

select is(
  (select nayax_card_sales_started_on::text from public.reporting_machines where id = '15490000-0000-4000-8000-000000000004'),
  '2026-09-01',
  'The existing card-authority boundary is preserved'
);

select ok(
  not (select nayax_refunds_enabled from public.reporting_machines where id = '15490000-0000-4000-8000-000000000004'),
  'Replacing a reader does not enable payment execution'
);

select ok(
  not (select refund_intake_enabled from public.reporting_machines where id = '15490000-0000-4000-8000-000000000004'),
  'Replacing a reader preserves a deliberately disabled customer intake lane'
);

select is(
  (select to_jsonb(fact) from public.machine_sales_facts fact where fact.id = '15490000-0000-4000-8000-000000000008'),
  (select snapshot from historical_sale_before),
  'The historical sale and its old provider identity remain unchanged'
);

select is(
  (select concat_ws(':', reporting_machine_id, matched_nayax_transaction_id, status)
   from public.refund_cases where id = '15490000-0000-4000-8000-000000000009'),
  '15490000-0000-4000-8000-000000000004:NAYAX-TXN-1549:completed',
  'The existing refund case remains linked to the same machine and transaction'
);

select is(
  (select concat_ws(':', refund_case_id, provider_machine_id, original_transaction_id)
   from public.refund_authoritative_receipts
   where refund_case_id = '15490000-0000-4000-8000-000000000009'),
  '15490000-0000-4000-8000-000000000009:NAYAX-OLD-1549:NAYAX-TXN-1549',
  'The authoritative receipt keeps the retired reader identity and case linkage'
);

select is(
  (select reconciliation_state || ':' || coalesce(reporting_machine_id::text, 'none')
   from public.refund_nayax_machine_inventory where id = '15490000-0000-4000-8000-000000000005'),
  'excluded:none',
  'The old inventory row is retained as excluded and unmapped'
);

select is(
  (select reconciliation_state || ':' || refund_category || ':' || reporting_machine_id::text
   from public.refund_nayax_machine_inventory where id = '15490000-0000-4000-8000-000000000006'),
  'published:cotton_candy:15490000-0000-4000-8000-000000000004',
  'The replacement inherits category and becomes the exact published mapping'
);

select is(
  (select count(*)::integer from public.refund_nayax_machine_inventory
   where reporting_machine_id = '15490000-0000-4000-8000-000000000004'),
  1,
  'Exactly one current inventory row remains linked'
);

select is(
  (select count(*)::integer from public.refund_nayax_machine_inventory
   where id in ('15490000-0000-4000-8000-000000000005', '15490000-0000-4000-8000-000000000006')),
  2,
  'Both immutable provider inventory records remain available for history'
);

select is(
  (select count(*)::integer from public.admin_audit_log
   where actor_user_id = '15490000-0000-4000-8000-000000000001'
     and action in ('refund_nayax_inventory.reconciled', 'reporting_machine.nayax_config.set', 'reporting_machine.nayax_reader.replaced')),
  4,
  'The old row, new row, machine config, and replacement summary are audited'
);

set local role authenticated;
select set_config('request.jwt.claim.sub', '15490000-0000-4000-8000-000000000001', true);

select throws_ok(
  $$select public.admin_replace_refund_nayax_machine(
    '15490000-0000-4000-8000-000000000004',
    '15490000-0000-4000-8000-000000000007',
    'Attempt wrong account replacement'
  )$$,
  'P0001',
  'Replacement Nayax reader must use the same provider account',
  'A replacement from another provider account is rejected'
);

reset role;

select is(
  (select nayax_machine_id from public.reporting_machines where id = '15490000-0000-4000-8000-000000000004'),
  'NAYAX-NEW-1549',
  'A rejected follow-up leaves the verified mapping unchanged'
);

select is(
  (select count(*)::integer from public.refund_cases where reporting_machine_id = '15490000-0000-4000-8000-000000000004'),
  1,
  'Reader replacement does not create or reassign refund cases'
);

select * from finish();
rollback;
