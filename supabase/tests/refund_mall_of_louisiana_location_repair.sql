-- Disposable database only. All identities and source rows below are synthetic.
begin;

create extension if not exists pgtap with schema extensions;
set local search_path = public, extensions;
select no_plan();

create function pg_temp.capture_error(statement text)
returns text language plpgsql as $$
begin
  execute statement;
  return null;
exception when others then
  return sqlstate || ':' || sqlerrm;
end;
$$;

insert into auth.users (
  instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at
) values (
  '00000000-0000-0000-0000-000000000000',
  '89000000-0000-4000-8000-000000000890',
  'authenticated', 'authenticated', 'location-manager@example.invalid', '', now(),
  '{}'::jsonb, '{}'::jsonb, now(), now()
);

insert into public.customer_accounts (id, name, account_type, status)
values (
  '89010000-0000-4000-8000-000000000890',
  'Location correction fixture', 'internal', 'active'
);

insert into public.reporting_locations (
  id, account_id, name, timezone, status
) values (
  '89020000-0000-4000-8000-000000000890',
  '89010000-0000-4000-8000-000000000890',
  'Shared legacy location fixture', 'America/Los_Angeles', 'active'
);

with labels(label, manual_timezone) as (
  values
    ('Altamonte Mall', 'America/New_York'),
    ('Asheville Mall', 'America/New_York'),
    ('Carolina Place', 'America/New_York'),
    ('Columbiana Centre', 'America/New_York'),
    ('Commerce Tanger Outlet', 'America/New_York'),
    ('Gonzales Tanger Outlet', 'America/Chicago'),
    ('Locust Grove Tanger Outlet', 'America/New_York'),
    ('Nashville Tanger Outlets', 'America/Chicago'),
    ('Norfolk Premium Outlets', 'America/New_York'),
    ('Oakwood Mall Gretna', 'America/Chicago'),
    ('Southridge Mall', 'America/Chicago'),
    ('Uptown Christiansburg', 'America/New_York')
)
insert into public.reporting_machines (
  account_id, location_id, machine_label, machine_type, status,
  nayax_machine_id, nayax_account_key, nayax_refunds_enabled,
  refund_intake_enabled, refund_public_display_label,
  nayax_manual_portal_enabled, nayax_manual_account_scope,
  nayax_manual_portal_timezone
)
select
  '89010000-0000-4000-8000-000000000890',
  '89020000-0000-4000-8000-000000000890',
  label, 'commercial', 'active', null, null, false, false, label,
  true, 'bloomjoy_nc_adam', manual_timezone
from labels;

insert into public.reporting_machine_refund_managers (
  reporting_machine_id, manager_user_id, manager_email, grant_reason
)
select
  machine.id,
  '89000000-0000-4000-8000-000000000890',
  'location-manager@example.invalid',
  'Synthetic shared manual-cohort route'
from public.reporting_machines machine
where machine.account_id = '89010000-0000-4000-8000-000000000890';

insert into public.sunze_machine_discoveries (
  sunze_machine_id, sunze_machine_name, status
) values (
  'UNMAPPED-SOURCE-FIXTURE', 'Unmapped location source fixture', 'pending'
);
insert into public.sunze_unmapped_sales (
  sunze_machine_id, sunze_machine_name, source_order_hash, source_row_hash,
  sale_date, payment_method, net_sales_cents, transaction_count, status,
  raw_payload
) values (
  'UNMAPPED-SOURCE-FIXTURE', 'Unmapped location source fixture',
  repeat('a', 64), repeat('b', 64), current_date - 1, 'credit', 700, 1,
  'pending', '{"fixture":true}'::jsonb
);

select is(
  public.ensure_refund_mall_of_louisiana_catalog() ->> 'status',
  'created',
  'The complete manual cohort creates one reviewed customer-safe location'
);
select is(
  public.ensure_refund_mall_of_louisiana_catalog() ->> 'status',
  'already_present',
  'Catalog creation is idempotent'
);
select ok(
  (select location.city = 'Baton Rouge'
      and location.state = 'LA'
      and location.timezone = 'America/Chicago'
      and location.status = 'active'
   from public.reporting_locations location
   where location.account_id = '89010000-0000-4000-8000-000000000890'
     and location.name = 'Mall of Louisiana'),
  'The new physical/customer location has the reviewed city, state, and Central timezone'
);
select ok(
  (select machine.machine_type = 'commercial'
      and machine.status = 'active'
      and machine.sunze_machine_id is null
      and machine.nayax_machine_id is null
      and machine.nayax_account_key is null
      and not machine.nayax_refunds_enabled
      and not machine.refund_intake_enabled
      and machine.nayax_manual_portal_enabled
      and machine.nayax_manual_account_scope = 'bloomjoy_nc_adam'
      and machine.nayax_manual_portal_timezone = 'America/Chicago'
   from public.reporting_machines machine
   where machine.account_id = '89010000-0000-4000-8000-000000000890'
     and machine.machine_label = 'Mall of Louisiana'),
  'The machine is manual-only with unknown provider/source identity and payment disabled'
);
select is(
  (select count(*)::integer
   from public.reporting_machine_refund_managers mapping
   join public.reporting_machines machine
     on machine.id = mapping.reporting_machine_id
   where machine.machine_label = 'Mall of Louisiana'
     and mapping.manager_user_id = '89000000-0000-4000-8000-000000000890'
     and mapping.status = 'active' and mapping.revoked_at is null),
  1,
  'The sole manual-cohort manager route is copied exactly once'
);
select is(
  (select count(*)::integer
   from public.public_refund_selections() selection
   where selection.display_label = 'Mall of Louisiana'
     and selection.selection_kind = 'exact_machine'
     and selection.location_timezone = 'America/Chicago'),
  1,
  'The customer selector exposes one unique exact Mall of Louisiana choice'
);
select ok(
  (select discovery.status = 'pending'
      and discovery.reporting_machine_id is null
   from public.sunze_machine_discoveries discovery
   where discovery.sunze_machine_id = 'UNMAPPED-SOURCE-FIXTURE')
  and (select pending.status = 'pending'
      and pending.reporting_machine_id is null
      and pending.promoted_at is null
   from public.sunze_unmapped_sales pending
   where pending.sunze_machine_id = 'UNMAPPED-SOURCE-FIXTURE')
  and not exists (
    select 1 from public.machine_sales_facts fact
    where fact.source_order_hash = repeat('a', 64)
  ),
  'Catalog creation neither binds nor promotes an unrelated pending sales source'
);

create temporary table repair_fixture as
select
  source_machine.id as source_machine_id,
  source_machine.location_id as source_location_id,
  target_machine.id as target_machine_id,
  target_machine.location_id as target_location_id
from public.reporting_machines source_machine
join public.reporting_machines target_machine
  on target_machine.account_id = source_machine.account_id
where source_machine.machine_label = 'Gonzales Tanger Outlet'
  and target_machine.machine_label = 'Mall of Louisiana';

insert into public.refund_cases (
  id, public_reference, reporting_machine_id, reporting_location_id,
  customer_email, customer_name, issue_summary, incident_at,
  incident_local_datetime, incident_timezone, incident_time_resolution,
  payment_method, payment_amount_cents, card_last4, status,
  correlation_status, correlation_source, correlation_confidence,
  automation_state, nayax_lookup_status, nayax_lookup_retry_count,
  nayax_lookup_retry_fact_version, intake_selection_key,
  intake_selection_kind, intake_selection_machine_ids, intake_meta
)
select
  '89040000-0000-4000-8000-000000000890',
  'RF-LOCATION-FIXTURE',
  source_machine_id,
  source_location_id,
  'location-customer@example.invalid',
  'Location Customer',
  'Existing customer report names Mall of Louisiana in Baton Rouge.',
  statement_timestamp() - interval '2 hours',
  to_char(statement_timestamp() - interval '2 hours', 'YYYY-MM-DD"T"HH24:MI'),
  'America/Los_Angeles',
  'exact',
  'card', 700, '4242', 'needs_review',
  'nayax_not_configured', 'nayax', 0,
  'under_review', 'setup_needed', 0, 1,
  public.refund_public_selection_key('machine|' || source_machine_id::text),
  'exact_machine', array[source_machine_id],
  '{"fixture_sentinel":"preserve"}'::jsonb
from repair_fixture;

insert into public.refund_case_messages (
  refund_case_id, message_type, status, recipient_email, subject, body
) values (
  '89040000-0000-4000-8000-000000000890',
  'manual_note', 'pending', 'location-customer@example.invalid',
  'Synthetic prior message', 'Synthetic prior message body'
);

set local role service_role;
create temporary table repair_context as
select public.service_refund_location_binding_correction_context(
  '89040000-0000-4000-8000-000000000890'
) as value;
reset role;

set local role service_role;
select ok(
  (select (value ->> 'eligible')::boolean
      and (value ->> 'customerLocationEvidencePresent')::boolean
      and (value ->> 'targetCatalogReady')::boolean
      and (value ->> 'messageCount')::integer = 1
      and (value ->> 'candidateCount')::integer = 0
      and (value ->> 'attemptCount')::integer = 0
      and (value ->> 'receiptCount')::integer = 0
      and (value ->> 'adjustmentCount')::integer = 0
      and (value ->> 'providerCallMade')::boolean is false
      and (value ->> 'customerMessageCreated')::boolean is false
   from repair_context),
  'Private context returns only reviewed readiness and aggregate no-side-effect evidence'
);
select ok(
  has_function_privilege(
    'service_role',
    'public.service_refund_location_binding_correction_context(uuid)',
    'execute'
  )
  and has_function_privilege(
    'service_role',
    'public.service_correct_refund_location_binding(uuid,text,bigint,bigint,uuid,uuid,boolean)',
    'execute'
  )
  and not has_function_privilege(
    'authenticated',
    'public.service_correct_refund_location_binding(uuid,text,bigint,bigint,uuid,uuid,boolean)',
    'execute'
  )
  and not has_function_privilege(
    'anon',
    'public.service_correct_refund_location_binding(uuid,text,bigint,bigint,uuid,uuid,boolean)',
    'execute'
  ),
  'Only the trusted service role can inspect and apply the private correction'
);

select ok(
  pg_temp.capture_error(format(
    $$select public.service_correct_refund_location_binding(
      '89040000-0000-4000-8000-000000000890', %L, %s, %s, %L, %L, true
    )$$,
    repeat('0', 64),
    (select value ->> 'expectedCaseVersion' from repair_context),
    (select value ->> 'expectedFactVersion' from repair_context),
    (select value ->> 'expectedSourceMachineId' from repair_context),
    (select value ->> 'expectedSourceLocationId' from repair_context)
  )) like 'P4681:Exact unresolved customer-reported location correction required%',
  'A stale or unrelated case digest fails before mutation'
);
reset role;
select ok(
  (select refund_case.reporting_machine_id = fixture.source_machine_id
      and refund_case.reporting_location_id = fixture.source_location_id
      and refund_case.incident_timezone = 'America/Los_Angeles'
   from public.refund_cases refund_case cross join repair_fixture fixture
   where refund_case.id = '89040000-0000-4000-8000-000000000890'),
  'A rejected invocation leaves the case binding unchanged'
);

set local role service_role;
create temporary table repair_result as
select public.service_correct_refund_location_binding(
  '89040000-0000-4000-8000-000000000890',
  value ->> 'caseDigest',
  (value ->> 'expectedCaseVersion')::bigint,
  (value ->> 'expectedFactVersion')::bigint,
  (value ->> 'expectedSourceMachineId')::uuid,
  (value ->> 'expectedSourceLocationId')::uuid,
  true
) as value
from repair_context;
reset role;

select ok(
  (select value ->> 'status' = 'corrected'
      and (value ->> 'caseIdentityPreserved')::boolean
      and (value ->> 'lookupInvalidated')::boolean
      and (value ->> 'providerCallMade')::boolean is false
      and (value ->> 'customerMessageCreated')::boolean is false
      and (value ->> 'refundAttemptCreated')::boolean is false
      and (value ->> 'receiptCreated')::boolean is false
      and (value ->> 'adjustmentCreated')::boolean is false
      and (value ->> 'paymentAction')::boolean is false
   from repair_result),
  'The guarded correction reports one same-case, lookup-only repair with no payment or contact action'
);
select ok(
  (select refund_case.id = '89040000-0000-4000-8000-000000000890'
      and refund_case.public_reference = 'RF-LOCATION-FIXTURE'
      and refund_case.reporting_machine_id = fixture.target_machine_id
      and refund_case.reporting_location_id = fixture.target_location_id
      and refund_case.incident_timezone = 'America/Chicago'
      and refund_case.intake_selection_kind = 'exact_machine'
      and refund_case.intake_selection_machine_ids = array[fixture.target_machine_id]
      and refund_case.intake_selection_key = public.refund_public_selection_key(
        'machine|' || fixture.target_machine_id::text
      )
      and refund_case.customer_email = 'location-customer@example.invalid'
      and refund_case.customer_name = 'Location Customer'
      and refund_case.issue_summary =
        'Existing customer report names Mall of Louisiana in Baton Rouge.'
      and refund_case.payment_amount_cents = 700
      and refund_case.card_last4 = '4242'
      and refund_case.intake_meta ->> 'fixture_sentinel' = 'preserve'
      and (refund_case.intake_meta -> 'location_binding_correction' ->>
        'raw_submission_unchanged')::boolean
   from public.refund_cases refund_case cross join repair_fixture fixture
   where refund_case.id = '89040000-0000-4000-8000-000000000890'),
  'Identity and raw submission remain intact while machine, location, selection and timezone change atomically'
);
select ok(
  (select refund_case.official_action_version =
        (context.value ->> 'expectedCaseVersion')::bigint + 1
      and refund_case.deterministic_fact_version =
        (context.value ->> 'expectedFactVersion')::bigint + 1
      and refund_case.nayax_lookup_status = 'not_started'
      and refund_case.nayax_lookup_retry_count = 0
      and refund_case.nayax_lookup_retry_fact_version =
        refund_case.deterministic_fact_version
      and refund_case.nayax_lookup_started_at is null
      and refund_case.nayax_lookup_finished_at is null
      and not refund_case.nayax_lookup_safe_retry_eligible
      and refund_case.nayax_lookup_correlation_digest is null
   from public.refund_cases refund_case cross join repair_context context
   where refund_case.id = '89040000-0000-4000-8000-000000000890'),
  'Existing fact-version recovery increments once and invalidates the stale lookup'
);
select ok(
  (select count(*) = 1 from public.refund_case_messages
   where refund_case_id = '89040000-0000-4000-8000-000000000890')
  and not exists (
    select 1 from public.refund_nayax_lookup_candidates
    where refund_case_id = '89040000-0000-4000-8000-000000000890'
  )
  and not exists (
    select 1 from public.refund_case_nayax_refund_attempts
    where refund_case_id = '89040000-0000-4000-8000-000000000890'
  )
  and not exists (
    select 1 from public.refund_authoritative_receipts
    where refund_case_id = '89040000-0000-4000-8000-000000000890'
  )
  and not exists (
    select 1 from public.sales_adjustment_facts
    where refund_case_id = '89040000-0000-4000-8000-000000000890'
  )
  and (select decision is null
      and refund_completed_at is null
      and reporting_adjustment_id is null
      and nayax_refund_execution_status = 'not_requested'
   from public.refund_cases
   where id = '89040000-0000-4000-8000-000000000890'),
  'No message, candidate, attempt, receipt, adjustment, decision, completion, or payment is created'
);
select ok(
  (select count(*) = 1
   from public.refund_case_events event
   where event.refund_case_id = '89040000-0000-4000-8000-000000000890'
     and event.event_type = 'location_binding_corrected'
     and event.metadata ->> 'policy' = 'customer_reported_location_binding_v1'
     and (event.metadata ->> 'payload_redacted')::boolean
     and (event.metadata ->> 'raw_submission_unchanged')::boolean
     and (event.metadata ->> 'customer_message_created')::boolean is false
     and (event.metadata ->> 'provider_call_made')::boolean is false
     and (event.metadata ->> 'payment_action')::boolean is false),
  'Exactly one redacted immutable correction event records the no-side-effect result'
);

set local role service_role;
select is(
  public.service_correct_refund_location_binding(
    '89040000-0000-4000-8000-000000000890',
    (select value ->> 'caseDigest' from repair_context),
    (select (value ->> 'expectedCaseVersion')::bigint from repair_context),
    (select (value ->> 'expectedFactVersion')::bigint from repair_context),
    (select (value ->> 'expectedSourceMachineId')::uuid from repair_context),
    (select (value ->> 'expectedSourceLocationId')::uuid from repair_context),
    true
  ) ->> 'status',
  'already_corrected',
  'An exact replay returns the original safe outcome without a second mutation'
);
reset role;
select ok(
  (select count(*) = 1 from public.refund_case_events
   where refund_case_id = '89040000-0000-4000-8000-000000000890'
     and event_type = 'location_binding_corrected')
  and (select count(*) = 1 from public.refund_case_messages
   where refund_case_id = '89040000-0000-4000-8000-000000000890'),
  'Replay creates neither a duplicate audit row nor a customer message'
);

select ok(
  (select discovery.status = 'pending'
      and discovery.reporting_machine_id is null
   from public.sunze_machine_discoveries discovery
   where discovery.sunze_machine_id = 'UNMAPPED-SOURCE-FIXTURE')
  and (select pending.status = 'pending'
      and pending.reporting_machine_id is null
      and pending.promoted_at is null
   from public.sunze_unmapped_sales pending
   where pending.sunze_machine_id = 'UNMAPPED-SOURCE-FIXTURE')
  and not exists (
    select 1 from public.machine_sales_facts fact
    where fact.source_order_hash = repeat('a', 64)
  ),
  'Case correction leaves the pending sales source and historical row unbound and unpromoted'
);

select * from finish();
rollback;
