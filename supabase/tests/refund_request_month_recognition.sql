begin;
create extension if not exists pgtap with schema extensions;
set local search_path = public, extensions;
select no_plan();

insert into public.customer_accounts (id, name, account_type)
values ('fd100000-0000-4000-8000-000000000001', 'Refund recognition fixtures', 'internal');
insert into public.reporting_locations (id, account_id, name, timezone) values
  ('fd200000-0000-4000-8000-000000000001', 'fd100000-0000-4000-8000-000000000001', 'Pacific fixture', 'America/Los_Angeles'),
  ('fd200000-0000-4000-8000-000000000002', 'fd100000-0000-4000-8000-000000000001', 'Eastern fixture', 'America/New_York');
insert into public.reporting_machines (id, account_id, location_id, machine_label, status) values
  ('fd300000-0000-4000-8000-000000000001', 'fd100000-0000-4000-8000-000000000001', 'fd200000-0000-4000-8000-000000000001', 'Pacific machine', 'active'),
  ('fd300000-0000-4000-8000-000000000002', 'fd100000-0000-4000-8000-000000000001', 'fd200000-0000-4000-8000-000000000002', 'Eastern machine', 'active');
insert into public.reporting_machine_tax_rates
  (id, machine_id, tax_rate_percent, effective_start_date, status) values
  ('fd310000-0000-4000-8000-000000000001', 'fd300000-0000-4000-8000-000000000001', 10, '2020-01-01', 'active'),
  ('fd310000-0000-4000-8000-000000000002', 'fd300000-0000-4000-8000-000000000002', 10, '2020-01-01', 'active');

insert into public.refund_cases (
  id, public_reference, reporting_machine_id, reporting_location_id,
  customer_email, issue_summary, incident_at, payment_method,
  payment_amount_cents, refund_amount_cents, status, decision,
  customer_request_received_at, customer_request_received_source
) values
  ('fd400000-0000-4000-8000-000000000001', 'RF-PERIOD-1', 'fd300000-0000-4000-8000-000000000001', 'fd200000-0000-4000-8000-000000000001', 'opening@example.invalid', 'Opening request', now()-interval '40 days', 'card', 1100, 1100, 'needs_review', null, now()-interval '40 days', 'hosted_refund_intake'),
  ('fd400000-0000-4000-8000-000000000002', 'RF-PERIOD-2', 'fd300000-0000-4000-8000-000000000001', 'fd200000-0000-4000-8000-000000000001', 'paid@example.invalid', 'Paid before cutover', now()-interval '35 days', 'card', 1100, 1100, 'completed', 'approved', now()-interval '35 days', 'hosted_refund_intake'),
  ('fd400000-0000-4000-8000-000000000003', 'RF-PERIOD-3', 'fd300000-0000-4000-8000-000000000001', 'fd200000-0000-4000-8000-000000000001', 'partial@example.invalid', 'Partial before cutover', now()-interval '30 days', 'card', 1100, 1100, 'needs_review', null, now()-interval '30 days', 'hosted_refund_intake'),
  ('fd400000-0000-4000-8000-000000000009', 'RF-PERIOD-9', 'fd300000-0000-4000-8000-000000000001', 'fd200000-0000-4000-8000-000000000001', 'late@example.invalid', 'Late request evidence', now()-interval '50 days', 'card', 1100, 1100, 'needs_review', null, null, null);

insert into public.sales_adjustment_facts (
  id, reporting_machine_id, reporting_location_id, adjustment_date,
  adjustment_type, amount_cents, complaint_count, source, source_row_hash,
  refund_case_id, raw_payload, created_at
) values
  ('fd500000-0000-4000-8000-000000000001', 'fd300000-0000-4000-8000-000000000001', 'fd200000-0000-4000-8000-000000000001', current_date-34, 'refund', 1100, 1, 'manual', repeat('1',64), 'fd400000-0000-4000-8000-000000000002', '{"payment_method":"card"}', clock_timestamp()),
  ('fd500000-0000-4000-8000-000000000002', 'fd300000-0000-4000-8000-000000000001', 'fd200000-0000-4000-8000-000000000001', current_date-29, 'refund', 440, 1, 'manual', repeat('2',64), 'fd400000-0000-4000-8000-000000000003', '{"payment_method":"card"}', clock_timestamp()),
  ('fd500000-0000-4000-8000-000000000009', 'fd300000-0000-4000-8000-000000000001', 'fd200000-0000-4000-8000-000000000001', current_date-49, 'refund', 330, 1, 'manual', repeat('9',64), 'fd400000-0000-4000-8000-000000000009', '{"payment_method":"card"}', clock_timestamp());

-- Simulate rows that predate this migration and therefore have no raw event.
set local session_replication_role = replica;
insert into public.refund_cases (
  id, public_reference, reporting_machine_id, reporting_location_id,
  customer_email, issue_summary, incident_at, payment_method,
  payment_amount_cents, refund_amount_cents, status, decision,
  customer_request_received_at, customer_request_received_source
) values (
  'fd400000-0000-4000-8000-000000000010', 'RF-PERIOD-10',
  'fd300000-0000-4000-8000-000000000001', 'fd200000-0000-4000-8000-000000000001',
  'legacy@example.invalid', 'Legacy paid request', now()-interval '61 days',
  'card', 1100, 1100, 'completed', 'approved', now()-interval '61 days',
  'hosted_refund_intake'
);
insert into public.sales_adjustment_facts (
  id, reporting_machine_id, reporting_location_id, adjustment_date,
  adjustment_type, amount_cents, complaint_count, source, source_row_hash,
  refund_case_id, raw_payload, created_at
) values (
  'fd500000-0000-4000-8000-000000000010', 'fd300000-0000-4000-8000-000000000001',
  'fd200000-0000-4000-8000-000000000001', current_date-60, 'refund', 1100, 1,
  'manual', repeat('a',64), 'fd400000-0000-4000-8000-000000000010',
  '{"payment_method":"card"}', clock_timestamp()
);
set local session_replication_role = origin;

create temporary table activation_result on commit drop as
select * from private.activate_refund_request_recognition('pgTAP #1571');

select is((select opening_events_inserted from activation_result), 2::bigint,
  'Cutover seeds only eligible unpaid requests');
select is((select count(*) from private.refund_request_recognition_rollout), 1::bigint,
  'Activation stores one global server watermark');
select is((select count(*) from private.refund_request_recognition_events
  where refund_case_id='fd400000-0000-4000-8000-000000000002'
    and event_kind='cutover_opening'), 0::bigint,
  'A fully paid request is not seeded again');
select is((select recognized_target_before_cents
  from private.refund_request_recognition_events
  where refund_case_id='fd400000-0000-4000-8000-000000000003'
    and event_kind='cutover_opening'), 440::bigint,
  'Opening recognition begins after the paid baseline');
select is((select amount_basis from private.refund_request_recognition_events
  where refund_case_id='fd400000-0000-4000-8000-000000000001'
    and event_kind='cutover_opening'), 'tax_inclusive',
  'Unchanged hosted customer-charge evidence remains calculable at cutover');
select is((select opening_events_inserted
  from private.activate_refund_request_recognition('pgTAP replay')), 0::bigint,
  'Activation replay is a no-op and cannot seed later cases');
select is((select count(*) from private.machine_sales_daily_components(
  'fd300000-0000-4000-8000-000000000001', current_date-40, current_date-40
) where source='refund_request'), 0::bigint,
  'Pre-cutover raw request evidence is not booked into old periods');
select is((select legacy_paid_deduction_ex_tax_cents
  from private.machine_sales_daily_components(
    'fd300000-0000-4000-8000-000000000001', current_date-34, current_date-34
  ) where source='manual'), 1000::bigint,
  'Pre-cutover paid deductions retain their historical financial effect');
select results_eq($$
  select legacy_paid_deduction_ex_tax_cents, unresolved_refund_count
  from private.machine_sales_daily_components(
    'fd300000-0000-4000-8000-000000000001', current_date-60, current_date-60
  ) where source='manual'
$$, $$values (1000::bigint,0::bigint)$$,
  'Linked case evidence proves a pre-migration paid deduction basis');

update public.refund_cases set
  customer_request_received_at=now()-interval '50 days',
  customer_request_received_source='hosted_refund_intake'
where id='fd400000-0000-4000-8000-000000000009';
select results_eq($$
  select recognized_target_before_cents, recognized_target_after_cents
  from private.refund_request_recognition_events
  where refund_case_id='fd400000-0000-4000-8000-000000000009'
    and event_kind='late_request_opening'
$$, $$values (330::bigint,1100::bigint)$$,
  'A late request starts after its pre-cutover paid baseline');

update public.refund_cases set
  reporting_machine_id='fd300000-0000-4000-8000-000000000002',
  reporting_location_id='fd200000-0000-4000-8000-000000000002'
where id='fd400000-0000-4000-8000-000000000003';
select results_eq($$
  select event_kind, recognized_target_before_cents, recognized_target_after_cents
  from private.refund_request_recognition_events
  where refund_case_id='fd400000-0000-4000-8000-000000000003'
    and event_kind in ('scope_reversed','scope_applied')
  order by event_kind desc
$$, $$values ('scope_reversed'::text,1100::bigint,440::bigint),
             ('scope_applied'::text,440::bigint,1100::bigint)$$,
  'Scope correction moves only the post-cutover unpaid opening balance');

insert into public.refund_cases (
  id, public_reference, reporting_machine_id, reporting_location_id,
  customer_email, issue_summary, incident_at, payment_method,
  payment_amount_cents, refund_amount_cents, status,
  customer_request_received_at, customer_request_received_source
) values
  ('fd400000-0000-4000-8000-000000000004', 'RF-PERIOD-4', 'fd300000-0000-4000-8000-000000000001', 'fd200000-0000-4000-8000-000000000001', 'new1@example.invalid', 'New request one', now()-interval '2 days', 'card', 1100, 1100, 'needs_review', clock_timestamp(), 'hosted_refund_intake'),
  ('fd400000-0000-4000-8000-000000000005', 'RF-PERIOD-5', 'fd300000-0000-4000-8000-000000000001', 'fd200000-0000-4000-8000-000000000001', 'new2@example.invalid', 'New request two', now()-interval '2 days', 'card', 2200, 2200, 'needs_review', clock_timestamp(), 'hosted_refund_intake');

select is((select request_deduction_ex_tax_cents
  from private.machine_sales_daily_components(
    'fd300000-0000-4000-8000-000000000001',
    (now() at time zone 'America/Los_Angeles')::date,
    (now() at time zone 'America/Los_Angeles')::date
  ) where source='refund_request'
    and purchase_attribution_date=(now() at time zone 'America/Los_Angeles')::date-2),
  3000::bigint, 'Same-day requests deduct once after cumulative normalization');
select is((select outstanding_context_ex_tax_cents
  from private.machine_sales_daily_components(
    'fd300000-0000-4000-8000-000000000001',
    (now() at time zone 'America/Los_Angeles')::date,
    (now() at time zone 'America/Los_Angeles')::date
  ) where source='refund_request'
    and purchase_attribution_date=(now() at time zone 'America/Los_Angeles')::date-2),
  3000::bigint, 'Outstanding context sums each same-day case');

insert into public.refund_cases (
  id, public_reference, reporting_machine_id, reporting_location_id,
  customer_email, issue_summary, incident_at, payment_method,
  payment_amount_cents, refund_amount_cents, status,
  customer_request_received_at, customer_request_received_source
) values (
  'fd400000-0000-4000-8000-000000000006', 'RF-PERIOD-6',
  'fd300000-0000-4000-8000-000000000001', 'fd200000-0000-4000-8000-000000000001',
  'proof@example.invalid', 'Same amount gains exact evidence', clock_timestamp(),
  'card', 1100, 1100, 'needs_review', clock_timestamp(), 'gmail_contact_ingested'
);
select is((select count(*) from private.refund_request_recognition_events
  where refund_case_id='fd400000-0000-4000-8000-000000000006'), 1::bigint,
  'Unknown request initially has one immutable raw event');
insert into public.refund_nayax_lookup_candidates (
  refund_case_id, reporting_machine_id, provider_transaction_id,
  machine_authorization_time, amount_cents, currency_code, evidence_summary
)
select
  c.id, c.reporting_machine_id, 'exact-1100', c.incident_at,
  1100, 'USD', jsonb_build_object('source','manual_nayax_portal')
from public.refund_cases c
where c.id='fd400000-0000-4000-8000-000000000006';
update public.refund_cases set
  correlation_status='matched', correlation_source='nayax',
  matched_nayax_transaction_id='exact-1100', matched_nayax_amount_cents=1100,
  matched_nayax_currency_code='USD', matched_nayax_machine_auth_time=incident_at
where id='fd400000-0000-4000-8000-000000000006';
select is((select count(*) from private.refund_request_recognition_events
  where refund_case_id='fd400000-0000-4000-8000-000000000006'), 1::bigint,
  'Evidence-only correction does not create a second monetary event');
select results_eq($$
  select request_deduction_ex_tax_cents, unresolved_refund_count
  from private.machine_sales_daily_components(
    'fd300000-0000-4000-8000-000000000001',
    (now() at time zone 'America/Los_Angeles')::date,
    (now() at time zone 'America/Los_Angeles')::date
  ) where source='refund_request'
    and purchase_attribution_date=(now() at time zone 'America/Los_Angeles')::date
$$, $$values (1000::bigint,0::bigint)$$,
  'Exact same-amount Nayax proof resolves the original request without double deduction');

insert into public.refund_cases (
  id, public_reference, reporting_machine_id, reporting_location_id,
  customer_email, issue_summary, incident_at, payment_method,
  payment_amount_cents, refund_amount_cents, status,
  customer_request_received_at, customer_request_received_source
) values (
  'fd400000-0000-4000-8000-000000000007', 'RF-PERIOD-7',
  'fd300000-0000-4000-8000-000000000001', 'fd200000-0000-4000-8000-000000000001',
  'changed-proof@example.invalid', 'Changed amount gains exact evidence',
  clock_timestamp(), 'card', 1100, 1100, 'needs_review', clock_timestamp(),
  'gmail_contact_ingested'
);
insert into public.refund_nayax_lookup_candidates (
  refund_case_id, reporting_machine_id, provider_transaction_id,
  machine_authorization_time, amount_cents, currency_code, evidence_summary
)
select
  c.id, c.reporting_machine_id, 'exact-880', c.incident_at,
  880, 'USD', jsonb_build_object('source','manual_nayax_portal')
from public.refund_cases c
where c.id='fd400000-0000-4000-8000-000000000007';
update public.refund_cases set
  refund_amount_cents=880, correlation_status='matched', correlation_source='nayax',
  matched_nayax_transaction_id='exact-880', matched_nayax_amount_cents=880,
  matched_nayax_currency_code='USD', matched_nayax_machine_auth_time=incident_at
where id='fd400000-0000-4000-8000-000000000007';
select results_eq($$
  select refund_reversal_ex_tax_cents, commissionable_sales_ex_tax_cents,
    (unresolved_refund_count > 0)
  from private.machine_sales_daily_components(
    'fd300000-0000-4000-8000-000000000001',
    (now() at time zone 'America/Los_Angeles')::date,
    (now() at time zone 'America/Los_Angeles')::date
  ) where source='refund_request'
    and purchase_attribution_date=(now() at time zone 'America/Los_Angeles')::date
$$, $$values (null::bigint,null::bigint,true)$$,
  'Proof for a changed after-amount never fabricates a known reversal of an unknown before-amount');

insert into public.machine_sales_facts (
  id, reporting_machine_id, reporting_location_id, sale_date, payment_method,
  net_sales_cents, transaction_count, source, source_order_hash,
  source_row_hash, tax_cents, raw_payload
) values (
  'fd600000-0000-4000-8000-000000000008', 'fd300000-0000-4000-8000-000000000002',
  'fd200000-0000-4000-8000-000000000002', current_date-10, 'credit', 1100, 1,
  'nayax_scheduled_report', repeat('8',32), repeat('8',64), 0,
  '{"amountBasis":"gross_customer_charge_minor"}'
);
insert into public.refund_cases (
  id, public_reference, reporting_machine_id, reporting_location_id,
  customer_email, issue_summary, incident_at, payment_method,
  payment_amount_cents, refund_amount_cents, status,
  customer_request_received_at, customer_request_received_source
) values (
  'fd400000-0000-4000-8000-000000000008', 'RF-PERIOD-8',
  'fd300000-0000-4000-8000-000000000001', 'fd200000-0000-4000-8000-000000000001',
  'scope-proof@example.invalid', 'Proof also corrects purchase scope',
  now()-interval '10 days', 'card', 1100, 1100, 'needs_review',
  clock_timestamp(), 'gmail_contact_ingested'
);
insert into public.refund_nayax_lookup_candidates (
  refund_case_id, reporting_machine_id, provider_transaction_id,
  machine_authorization_time, amount_cents, currency_code, evidence_summary
)
select
  c.id, c.reporting_machine_id, 'scope-exact-1100', c.incident_at,
  1100, 'USD', jsonb_build_object('source','manual_nayax_portal')
from public.refund_cases c
where c.id='fd400000-0000-4000-8000-000000000008';
update public.refund_cases set
  matched_sales_fact_id='fd600000-0000-4000-8000-000000000008',
  correlation_status='matched', correlation_source='nayax',
  matched_nayax_transaction_id='scope-exact-1100', matched_nayax_amount_cents=1100,
  matched_nayax_currency_code='USD', matched_nayax_machine_auth_time=incident_at
where id='fd400000-0000-4000-8000-000000000008';
select results_eq($$
  select event_kind, reporting_machine_id,
    recognized_target_before_cents, recognized_target_after_cents
  from private.refund_request_recognition_events
  where refund_case_id='fd400000-0000-4000-8000-000000000008'
    and event_kind in ('scope_reversed','scope_applied')
  order by event_kind desc
$$, $$values
  ('scope_reversed'::text,'fd300000-0000-4000-8000-000000000001'::uuid,1100::bigint,0::bigint),
  ('scope_applied'::text,'fd300000-0000-4000-8000-000000000002'::uuid,0::bigint,1100::bigint)
$$, 'Same-amount proof plus scope correction reverses and reapplies on the proved purchase scope');

insert into public.sales_adjustment_facts (
  id, reporting_machine_id, reporting_location_id, adjustment_date,
  adjustment_type, amount_cents, complaint_count, source, source_row_hash,
  refund_case_id, raw_payload, created_at
) values (
  'fd500000-0000-4000-8000-000000000004', 'fd300000-0000-4000-8000-000000000001',
  'fd200000-0000-4000-8000-000000000001',
  (now() at time zone 'America/Los_Angeles')::date, 'refund', 440, 1, 'manual',
  repeat('4',64), 'fd400000-0000-4000-8000-000000000004',
  '{"payment_method":"card"}', clock_timestamp()
);
select results_eq($$
  select legacy_paid_deduction_ex_tax_cents, paid_context_ex_tax_cents,
    commissionable_sales_ex_tax_cents
  from private.machine_sales_daily_components(
    'fd300000-0000-4000-8000-000000000001',
    (now() at time zone 'America/Los_Angeles')::date,
    (now() at time zone 'America/Los_Angeles')::date
  ) where source='manual'
$$, $$values (0::bigint,400::bigint,0::bigint)$$,
  'A post-cutover payment is context with zero financial effect');

update public.refund_cases set status='denied', decision='denied'
where id='fd400000-0000-4000-8000-000000000004';
select is((select sum(refund_reversal_ex_tax_cents)::bigint
  from private.machine_sales_daily_components(
    'fd300000-0000-4000-8000-000000000001',
    (now() at time zone 'America/Los_Angeles')::date,
    (now() at time zone 'America/Los_Angeles')::date
  ) where source='refund_request'
    and purchase_attribution_date=(now() at time zone 'America/Los_Angeles')::date-2),
  600::bigint, 'Denial reverses only the unpaid normalized balance');

insert into public.machine_sales_facts (
  id, reporting_machine_id, reporting_location_id, sale_date, payment_method,
  net_sales_cents, transaction_count, source, source_order_hash,
  source_row_hash, tax_cents, raw_payload
) values
  ('fd600000-0000-4000-8000-000000000001', 'fd300000-0000-4000-8000-000000000001', 'fd200000-0000-4000-8000-000000000001', current_date-2, 'credit', 1100, 1, 'nayax_scheduled_report', repeat('b',32), repeat('b',64), 0, '{"amountBasis":"gross_customer_charge_minor"}'),
  ('fd600000-0000-4000-8000-000000000002', 'fd300000-0000-4000-8000-000000000001', 'fd200000-0000-4000-8000-000000000001', current_date-2, 'credit', 2200, 1, 'snapcase_cash', repeat('c',32), repeat('c',64), 0, '{"amountBasis":"gross_customer_charge_minor"}'),
  ('fd600000-0000-4000-8000-000000000003', 'fd300000-0000-4000-8000-000000000001', 'fd200000-0000-4000-8000-000000000001', current_date-2, 'cash', 550, 1, 'snapcase_cash', repeat('d',32), repeat('d',64), 0, '{"amountBasis":"gross_customer_charge_minor"}'),
  ('fd600000-0000-4000-8000-000000000004', 'fd300000-0000-4000-8000-000000000001', 'fd200000-0000-4000-8000-000000000001', current_date-3, 'other', 1100, 1, 'manual_csv', null, repeat('e',64), 0, '{"amountBasis":"gross_customer_charge_minor"}'),
  ('fd600000-0000-4000-8000-000000000005', 'fd300000-0000-4000-8000-000000000001', 'fd200000-0000-4000-8000-000000000001', current_date-3, 'other', 700, 1, 'manual_csv', null, repeat('f',64), 0, '{}');

select is((select sum(recorded_sales_cents)::bigint
  from private.machine_sales_daily_components(
    'fd300000-0000-4000-8000-000000000001', current_date-2, current_date-2
  ) where tender='card'), 1100::bigint,
  'Nayax card authority is included without adding vendor card observations');
select is((select sum(recorded_sales_cents)::bigint
  from private.machine_sales_daily_components(
    'fd300000-0000-4000-8000-000000000001', current_date-2, current_date-2
  ) where tender='cash'), 550::bigint,
  'Vendor cash authority remains included');
select results_eq($$
  select recorded_sales_cents, sales_ex_tax_cents,
    commissionable_sales_ex_tax_cents, unresolved_sales_count
  from private.machine_sales_daily_components(
    'fd300000-0000-4000-8000-000000000001', current_date-3, current_date-3
  ) where source='manual_csv' and tender='other'
$$, $$values (1800::bigint,null::bigint,null::bigint,1::bigint)$$,
  'Known and unknown same-day facts never collapse into a known-only total');

insert into public.customer_accounts (id, name, account_type)
values ('fd100000-0000-4000-8000-000000000011', 'Recognition deletion fixture', 'internal');
insert into public.reporting_locations (id, account_id, name, timezone)
values ('fd200000-0000-4000-8000-000000000011', 'fd100000-0000-4000-8000-000000000011', 'Deletion fixture', 'UTC');
insert into public.reporting_machines (id, account_id, location_id, machine_label, status)
values ('fd300000-0000-4000-8000-000000000011', 'fd100000-0000-4000-8000-000000000011', 'fd200000-0000-4000-8000-000000000011', 'Deletion machine', 'active');
insert into public.refund_cases (
  id, public_reference, reporting_machine_id, reporting_location_id,
  customer_email, issue_summary, incident_at, payment_method,
  payment_amount_cents, refund_amount_cents, status,
  customer_request_received_at, customer_request_received_source
) values (
  'fd400000-0000-4000-8000-000000000011', 'RF-PERIOD-11',
  'fd300000-0000-4000-8000-000000000011', 'fd200000-0000-4000-8000-000000000011',
  'delete@example.invalid', 'Snapshot survives source cleanup', clock_timestamp(),
  'cash', 500, 500, 'needs_review', clock_timestamp(), 'hosted_refund_intake'
);
delete from public.refund_cases where id='fd400000-0000-4000-8000-000000000011';
delete from public.reporting_machines where id='fd300000-0000-4000-8000-000000000011';
delete from public.reporting_locations where id='fd200000-0000-4000-8000-000000000011';
select results_eq($$
  select refund_case_id, reporting_machine_id, reporting_location_id
  from private.refund_request_recognition_events
  where refund_case_id='fd400000-0000-4000-8000-000000000011'
$$, $$values (
  'fd400000-0000-4000-8000-000000000011'::uuid,
  'fd300000-0000-4000-8000-000000000011'::uuid,
  'fd200000-0000-4000-8000-000000000011'::uuid
)$$, 'Immutable recognition snapshots do not restrict established source cleanup');
select results_eq($$
  select source, request_deduction_ex_tax_cents,
    unresolved_refund_count, unresolved_refund_cents
  from private.machine_sales_daily_components(
    'fd300000-0000-4000-8000-000000000011',
    (now() at time zone 'UTC')::date,
    (now() at time zone 'UTC')::date
  )
  where source='refund_request'
$$, $$values ('refund_request'::text,null::bigint,1::bigint,500::bigint)$$,
  'Recognition remains reportable after source cleanup; missing rate stays explicit');

select * from finish();
rollback;
