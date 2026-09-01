begin;

create extension if not exists pgtap with schema extensions;
set local search_path = public, extensions;

select plan(31);

create function pg_temp.set_auth_claims(p_user_id uuid)
returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claim.sub', p_user_id::text, true);
  perform set_config('request.jwt.claim.role', 'authenticated', true);
  perform set_config('request.jwt.claims', jsonb_build_object(
    'sub', p_user_id, 'role', 'authenticated', 'is_anonymous', false
  )::text, true);
end;
$$;

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
) values
  ('00000000-0000-0000-0000-000000000000', 'ba100000-0000-4000-8000-000000000001', 'authenticated', 'authenticated', 'internal-test-manager@example.invalid', '', now(), '{}'::jsonb, '{}'::jsonb, now(), now()),
  ('00000000-0000-0000-0000-000000000000', 'ba100000-0000-4000-8000-000000000002', 'authenticated', 'authenticated', 'internal-test-operations@example.invalid', '', now(), '{}'::jsonb, '{}'::jsonb, now(), now());

insert into public.admin_roles (user_id, role, active)
values ('ba100000-0000-4000-8000-000000000002', 'super_admin', true);

insert into public.customer_accounts (id, name, account_type)
values ('ba110000-0000-4000-8000-000000000001', 'Internal test fixture', 'internal');

insert into public.reporting_locations (id, account_id, name, timezone)
values (
  'ba120000-0000-4000-8000-000000000001',
  'ba110000-0000-4000-8000-000000000001',
  'Internal test fixture location',
  'America/Los_Angeles'
);

insert into public.reporting_machines (
  id, account_id, location_id, machine_label, status
) values (
  'ba130000-0000-4000-8000-000000000001',
  'ba110000-0000-4000-8000-000000000001',
  'ba120000-0000-4000-8000-000000000001',
  'Internal test fixture machine',
  'active'
);

insert into public.reporting_machine_refund_managers (
  reporting_machine_id, manager_user_id, manager_email, grant_reason
) values (
  'ba130000-0000-4000-8000-000000000001',
  'ba100000-0000-4000-8000-000000000001',
  'internal-test-manager@example.invalid',
  'Internal test authorization fixture'
);

insert into public.refund_cases (
  id, public_reference, reporting_machine_id, reporting_location_id,
  customer_email, issue_summary, incident_at, payment_method,
  payment_amount_cents, card_last4, status, correlation_status, correlation_source
) values
  (
    'ba140000-0000-4000-8000-000000000001', 'RF-INTERNAL-TEST',
    'ba130000-0000-4000-8000-000000000001',
    'ba120000-0000-4000-8000-000000000001',
    'internal-record@example.invalid', 'Technician test fixture',
    statement_timestamp() - interval '2 hours', 'card', 700, '4242',
    'waiting_on_customer', 'needs_nayax', 'nayax'
  ),
  (
    'ba140000-0000-4000-8000-000000000002', 'RF-UNRESOLVED-TEST',
    'ba130000-0000-4000-8000-000000000001',
    'ba120000-0000-4000-8000-000000000001',
    'unresolved-record@example.invalid', 'Unresolved provider fixture',
    statement_timestamp() - interval '1 hour', 'card', 700, '4242',
    'needs_review', 'needs_nayax', 'nayax'
  );

insert into public.refund_case_messages (
  id, refund_case_id, message_type, status, recipient_email,
  subject, body, created_by, requested_fields
) values (
  'ba150000-0000-4000-8000-000000000001',
  'ba140000-0000-4000-8000-000000000001',
  'more_info', 'pending', 'internal-record@example.invalid',
  'Fixture subject', 'Fixture body',
  'ba100000-0000-4000-8000-000000000001', array['incident_time']::text[]
);

insert into public.refund_follow_up_cycles (
  id, refund_case_id, cycle_number, trigger_fingerprint, reason_code,
  requested_fields, template_version, case_fact_version,
  reminder_delay_hours, status
) values (
  'ba160000-0000-4000-8000-000000000001',
  'ba140000-0000-4000-8000-000000000001', 1,
  repeat('a', 64), 'missing_information', array['incident_time']::text[],
  'refund_follow_up_v1', 1, 48, 'claimed'
);

insert into public.refund_case_status_capabilities (
  id, refund_case_id, token_digest, expires_at
) values (
  'ba170000-0000-4000-8000-000000000001',
  'ba140000-0000-4000-8000-000000000001', repeat('b', 64),
  statement_timestamp() + interval '7 days'
);

insert into public.refund_case_nayax_refund_attempts (
  id, refund_case_id, execution_mode, status, idempotency_key,
  amount_cents, provider_outcome, provider_outcome_recorded_at,
  reconciliation_required
) values (
  'ba180000-0000-4000-8000-000000000001',
  'ba140000-0000-4000-8000-000000000002', 'preflight', 'ambiguous',
  'internal-test-unresolved-fixture', 700, 'unknown', statement_timestamp(), true
);

select ok(
  has_function_privilege(
    'authenticated',
    'public.admin_classify_refund_case_internal_test(uuid,bigint,text)',
    'execute'
  )
  and not has_function_privilege(
    'anon',
    'public.admin_classify_refund_case_internal_test(uuid,bigint,text)',
    'execute'
  )
  and not has_function_privilege(
    'service_role',
    'public.admin_classify_refund_case_internal_test(uuid,bigint,text)',
    'execute'
  ),
  'Only an authenticated session can reach the Internal/test RPC boundary'
);

select ok(
  not has_function_privilege(
    'authenticated', 'public.refund_internal_test_contract(uuid)', 'execute'
  )
  and not has_function_privilege(
    'service_role', 'public.refund_internal_test_contract(uuid)', 'execute'
  ),
  'The Internal/test projector is not a standalone Data API surface'
);

set local role authenticated;
select pg_temp.set_auth_claims('ba100000-0000-4000-8000-000000000001');

select ok(
  pg_temp.capture_error($$select public.admin_classify_refund_case_internal_test(
    'ba140000-0000-4000-8000-000000000001', 1, 'employee_technician_test'
  )$$) like 'P4630:Refund Operations administrator required%',
  'A routine Machine Manager cannot classify Internal/test records'
);

select pg_temp.set_auth_claims('ba100000-0000-4000-8000-000000000002');

select ok(
  pg_temp.capture_error($$select public.admin_classify_refund_case_internal_test(
    'ba140000-0000-4000-8000-000000000001', 99, 'employee_technician_test'
  )$$) like 'P4634:Refund case changed%',
  'A stale case version cannot classify a record'
);

select ok(
  pg_temp.capture_error($$select public.admin_classify_refund_case_internal_test(
    'ba140000-0000-4000-8000-000000000001', 1, 'free_text_reason'
  )$$) like 'P4631:Choose a required Internal/test reason%',
  'Classification requires one fixed reason rather than denial or free text'
);

select ok(
  pg_temp.capture_error($$select public.admin_classify_refund_case_internal_test(
    'ba140000-0000-4000-8000-000000000002', 1, 'provider_test'
  )$$) like 'P4635:Reconcile or complete the existing payment evidence%',
  'An unresolved provider outcome cannot be mislabeled as no customer refund'
);

select is(
  (public.admin_classify_refund_case_internal_test(
    'ba140000-0000-4000-8000-000000000001', 1, 'employee_technician_test'
  ) ->> 'classified')::boolean,
  true,
  'Refund Operations can classify a reviewed no-money record'
);

-- Inspect protected workflow tables as the migration owner. The authenticated
-- boundary above proves the RPC authorization path; these assertions verify the
-- resulting state without broadening direct table grants for managers.
reset role;

select ok(
  (
    select case_population = 'internal_test'
      and internal_test_reason = 'employee_technician_test'
      and internal_test_classified_by = 'ba100000-0000-4000-8000-000000000002'
      and internal_test_classified_at is not null
    from public.refund_cases
    where id = 'ba140000-0000-4000-8000-000000000001'
  ),
  'Classification persists its fixed reason, actor, and time'
);

select ok(
  (
    select status = 'closed'
      and automation_state = 'closed_incomplete'
      and automation_follow_up_due_at is null
      and decision is null
      and reporting_adjustment_id is null
      and refund_completed_at is null
    from public.refund_cases
    where id = 'ba140000-0000-4000-8000-000000000001'
  ),
  'The case becomes terminal without a denial, refund, reporting adjustment, reminder, or SLA'
);

select cmp_ok(
  (select official_action_version from public.refund_cases where id = 'ba140000-0000-4000-8000-000000000001'),
  '>', 1::bigint,
  'Classification invalidates stale official-action versions'
);

select is(
  (select status from public.refund_case_messages where id = 'ba150000-0000-4000-8000-000000000001'),
  'skipped',
  'A queued unsent customer message is suppressed'
);

select is(
  (select error_message from public.refund_case_messages where id = 'ba150000-0000-4000-8000-000000000001'),
  'internal_test_customer_contact_suppressed',
  'The suppressed message has a manager-readable non-denial reason code'
);

select ok(
  (
    select status = 'manual_review' and reminder_due_at is null
    from public.refund_follow_up_cycles
    where id = 'ba160000-0000-4000-8000-000000000001'
  ),
  'The active reminder cycle becomes non-runnable manual review without altering evidence'
);

select ok(
  (
    select revoked_at is not null and revoked_reason = 'case_closed'
    from public.refund_case_status_capabilities
    where id = 'ba170000-0000-4000-8000-000000000001'
  ),
  'Existing customer status links are revoked'
);

select is(
  (
    select count(*)::integer from public.refund_case_events
    where refund_case_id = 'ba140000-0000-4000-8000-000000000001'
      and event_type = 'internal_test_classified'
  ),
  1,
  'Classification appends exactly one immutable audit event'
);

select ok(
  (
    select actor_user_id = 'ba100000-0000-4000-8000-000000000002'
      and message = 'Refund Operations classified this record as Internal/test — no customer refund.'
      and metadata ->> 'reason' = 'employee_technician_test'
      and (metadata ->> 'customer_message_sent')::boolean is false
      and (metadata ->> 'provider_call_made')::boolean is false
      and (metadata ->> 'reporting_adjustment_created')::boolean is false
      and (metadata ->> 'payload_redacted')::boolean
    from public.refund_case_events
    where refund_case_id = 'ba140000-0000-4000-8000-000000000001'
      and event_type = 'internal_test_classified'
  ),
  'The immutable event has bounded redacted provenance and explicit no-side-effect evidence'
);

set local role authenticated;
select pg_temp.set_auth_claims('ba100000-0000-4000-8000-000000000002');

select is(
  (public.admin_classify_refund_case_internal_test(
    'ba140000-0000-4000-8000-000000000001',
    (select official_action_version from public.refund_cases where id = 'ba140000-0000-4000-8000-000000000001'),
    'employee_technician_test'
  ) ->> 'replayed')::boolean,
  true,
  'An identical retry returns the existing disposition'
);

reset role;

select is(
  (
    select count(*)::integer from public.refund_case_events
    where refund_case_id = 'ba140000-0000-4000-8000-000000000001'
      and event_type = 'internal_test_classified'
  ),
  1,
  'A replay cannot duplicate the classification audit event'
);

select is(
  public.refund_internal_test_contract('ba140000-0000-4000-8000-000000000001') ->> 'classification',
  'internal_test_no_customer_refund',
  'The archive exposes the explicit non-denial classification'
);

select is(
  public.refund_internal_test_contract('ba140000-0000-4000-8000-000000000001') ->> 'reasonLabel',
  'Employee or technician test',
  'The archive exposes a human-readable fixed reason'
);

select ok(
  (public.refund_internal_test_contract('ba140000-0000-4000-8000-000000000001') ->> 'suppressesCustomerMessages')::boolean
  and (public.refund_internal_test_contract('ba140000-0000-4000-8000-000000000001') ->> 'suppressesRefunds')::boolean
  and (public.refund_internal_test_contract('ba140000-0000-4000-8000-000000000001') ->> 'suppressesReportingAdjustments')::boolean
  and (public.refund_internal_test_contract('ba140000-0000-4000-8000-000000000001') ->> 'suppressesReminders')::boolean
  and (public.refund_internal_test_contract('ba140000-0000-4000-8000-000000000001') ->> 'suppressesCustomerSla')::boolean,
  'The archive contract names every suppressed customer workflow'
);

set local role authenticated;
select pg_temp.set_auth_claims('ba100000-0000-4000-8000-000000000002');

select ok(
  not exists (
    select 1 from jsonb_array_elements(public.admin_get_refund_operations_overview() -> 'cases') item
    where item ->> 'id' = 'ba140000-0000-4000-8000-000000000001'
  )
  and exists (
    select 1 from jsonb_array_elements(public.admin_get_refund_operations_overview() -> 'internalTestCases') item
    where item ->> 'id' = 'ba140000-0000-4000-8000-000000000001'
      and item -> 'internalTest' ->> 'classification' = 'internal_test_no_customer_refund'
  ),
  'Refund Operations sees the record only in the separate Internal/test archive'
);

select is(
  public.admin_get_refund_operations_overview() ->> 'internalTestContractVersion',
  'refund_internal_test_v1',
  'The overview versions the Internal/test archive contract'
);

reset role;
set local role authenticated;
select pg_temp.set_auth_claims('ba100000-0000-4000-8000-000000000001');

select ok(
  not exists (
    select 1 from jsonb_array_elements(public.admin_get_refund_operations_overview() -> 'cases') item
    where item ->> 'id' = 'ba140000-0000-4000-8000-000000000001'
  )
  and jsonb_array_length(public.admin_get_refund_operations_overview() -> 'internalTestCases') = 0,
  'Routine managers see the record in neither customer counts nor the restricted archive'
);

reset role;
set local role service_role;

select ok(
  pg_temp.capture_error($$insert into public.refund_case_messages (
    refund_case_id, message_type, status, recipient_email, subject, body
  ) values (
    'ba140000-0000-4000-8000-000000000001', 'denied', 'pending',
    'internal-record@example.invalid', 'Denied', 'Denied'
  )$$) like 'P4640:Customer, reminder, and refund actions are suppressed%',
  'The database rejects new customer denial copy for an Internal/test record'
);

select ok(
  pg_temp.capture_error($$insert into public.refund_case_nayax_refund_attempts (
    refund_case_id, execution_mode, status, idempotency_key, amount_cents
  ) values (
    'ba140000-0000-4000-8000-000000000001', 'preflight', 'created',
    'internal-test-blocked-refund', 700
  )$$) like 'P4640:Customer, reminder, and refund actions are suppressed%',
  'The database rejects every new refund attempt for an Internal/test record'
);

select ok(
  pg_temp.capture_error($$insert into public.refund_follow_up_cycles (
    refund_case_id, cycle_number, trigger_fingerprint, reason_code,
    requested_fields, template_version, case_fact_version,
    reminder_delay_hours, status
  ) values (
    'ba140000-0000-4000-8000-000000000001', 2, repeat('c', 64),
    'missing_information', array['incident_time']::text[],
    'refund_follow_up_v1', 1, 48, 'claimed'
  )$$) like 'P4640:Customer, reminder, and refund actions are suppressed%',
  'The database rejects a new reminder cycle for an Internal/test record'
);

select ok(
  pg_temp.capture_error($$insert into public.refund_case_status_capabilities (
    refund_case_id, token_digest, expires_at
  ) values (
    'ba140000-0000-4000-8000-000000000001', repeat('d', 64),
    statement_timestamp() + interval '7 days'
  )$$) like 'P4640:Customer, reminder, and refund actions are suppressed%',
  'The database rejects a new customer status capability for an Internal/test record'
);

select ok(
  pg_temp.capture_error($$update public.refund_cases
    set case_population = 'customer', internal_test_reason = null,
      internal_test_classified_at = null, internal_test_classified_by = null,
      status = 'needs_review', automation_state = 'under_review'
    where id = 'ba140000-0000-4000-8000-000000000001'$$)
    like 'P4638:Internal/test classification is immutable%',
  'A service identity cannot reclassify the immutable archive record'
);

reset role;

select is(
  (
    select count(*)::integer from public.refund_case_nayax_refund_attempts
    where refund_case_id = 'ba140000-0000-4000-8000-000000000001'
  ),
  0,
  'Classification and blocked replays make no provider attempt'
);

select is(
  (
    select count(*)::integer from public.sales_adjustment_facts adjustment
    join public.refund_cases refund_case on refund_case.reporting_adjustment_id = adjustment.id
    where refund_case.id = 'ba140000-0000-4000-8000-000000000001'
  ),
  0,
  'Classification creates no reporting adjustment'
);

select * from finish();
rollback;
