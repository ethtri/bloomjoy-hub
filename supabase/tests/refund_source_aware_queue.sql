begin;

create extension if not exists pgtap with schema extensions;
set local search_path = public, extensions;

select plan(22);

create function pg_temp.capture_error(statement text)
returns text
language plpgsql
as $$
begin
  execute statement;
  return null;
exception
  when others then
    return sqlstate || ':' || sqlerrm;
end;
$$;

insert into auth.users (
  instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at
)
values
  (
    '00000000-0000-0000-0000-000000000000',
    '94000000-0000-4000-8000-000000000001',
    'authenticated', 'authenticated', 'source-manager@example.test', '', now(),
    '{}'::jsonb, '{}'::jsonb, now(), now()
  ),
  (
    '00000000-0000-0000-0000-000000000000',
    '94000000-0000-4000-8000-000000000002',
    'authenticated', 'authenticated', 'source-admin@example.test', '', now(),
    '{}'::jsonb, '{}'::jsonb, now(), now()
  ),
  (
    '00000000-0000-0000-8000-000000000000',
    '94000000-0000-4000-8000-000000000003',
    'authenticated', 'authenticated', 'source-outsider@example.test', '', now(),
    '{}'::jsonb, '{}'::jsonb, now(), now()
  );

insert into public.admin_roles (user_id, role)
values ('94000000-0000-4000-8000-000000000002', 'super_admin');

insert into public.customer_accounts (id, name, account_type)
values ('94100000-0000-4000-8000-000000000001', 'Source queue test', 'customer');

insert into public.reporting_locations (id, account_id, name, timezone)
values (
  '94200000-0000-4000-8000-000000000001',
  '94100000-0000-4000-8000-000000000001',
  'Source queue location',
  'America/Los_Angeles'
);

insert into public.reporting_machines (
  id, account_id, location_id, machine_label, machine_type, refund_public_display_label
)
values (
  '94300000-0000-4000-8000-000000000001',
  '94100000-0000-4000-8000-000000000001',
  '94200000-0000-4000-8000-000000000001',
  'Internal source queue machine',
  'commercial',
  'Cotton Candy 01'
);

insert into public.reporting_machine_refund_managers (
  id, reporting_machine_id, manager_user_id, manager_email, grant_reason
)
values (
  '94400000-0000-4000-8000-000000000001',
  '94300000-0000-4000-8000-000000000001',
  '94000000-0000-4000-8000-000000000001',
  'source-manager@example.test',
  'Source-aware queue test'
);

insert into public.refund_cases (
  id, reporting_machine_id, reporting_location_id, customer_email, issue_summary,
  incident_at, payment_method, payment_amount_cents, status, correlation_status,
  intake_source, updated_at
)
values
  (
    '94500000-0000-4000-8000-000000000001',
    '94300000-0000-4000-8000-000000000001',
    '94200000-0000-4000-8000-000000000001',
    'website-customer@example.test', 'Website case private text',
    now() - interval '2 hours', 'card', 900, 'submitted', 'not_started', 'form', now() - interval '2 hours'
  ),
  (
    '94500000-0000-4000-8000-000000000002',
    '94300000-0000-4000-8000-000000000001',
    '94200000-0000-4000-8000-000000000001',
    'sms-customer@example.test', 'SMS form private text',
    now() - interval '28 hours', 'card', null, 'draft', 'manual_review', 'sms_google_form', now() - interval '27 hours'
  ),
  (
    '94500000-0000-4000-8000-000000000003',
    null, null, 'gmail-customer@example.test', 'Gmail private text',
    null, null, null, 'draft', 'manual_review', 'gmail', now() - interval '1 hour'
  );

update public.refund_cases
set nayax_refund_execution_status = 'ambiguous'
where id = '94500000-0000-4000-8000-000000000001';

insert into public.refund_gmail_threads (
  id, refund_case_id, mailbox_hash, provider_thread_id, thread_subject,
  first_message_at, latest_message_at, retention_expires_at
)
values (
  '94600000-0000-4000-8000-000000000001',
  '94500000-0000-4000-8000-000000000003',
  repeat('a', 64), 'source-aware-thread', 'Private Gmail subject',
  now() - interval '1 hour', now() - interval '1 hour', now() + interval '180 days'
);

insert into public.refund_google_form_sync_runs (
  id, run_key, trigger_source, source_version, status, rows_seen, rows_imported,
  completed_at, started_at
)
values (
  '94700000-0000-4000-8000-000000000001', 'source-aware-run', 'synthetic_test',
  '2026-08-04.v1', 'completed', 2, 1, now() - interval '5 minutes', now() - interval '6 minutes'
);

insert into public.refund_google_form_import_rows (
  id, source_response_key_hash, source_payload_fingerprint, source_row_number,
  source_submitted_at, source_version, refund_case_id, last_seen_run_id,
  import_status, reason_code, mapping_status, missing_fields, invalid_fields
)
values
  (
    '94800000-0000-4000-8000-000000000001', repeat('b', 64), repeat('c', 64), 2,
    now() - interval '28 hours', '2026-08-04.v1',
    '94500000-0000-4000-8000-000000000002', '94700000-0000-4000-8000-000000000001',
    'quarantined', 'missing_fields', 'matched', array['incident_time'], '{}'
  ),
  (
    '94800000-0000-4000-8000-000000000002', repeat('d', 64), repeat('e', 64), 3,
    now() - interval '3 hours', '2026-08-04.v1',
    null, '94700000-0000-4000-8000-000000000001',
    'quarantined', 'unmapped_location', 'unmapped', '{}', '{}'
  );

insert into public.refund_case_reconciliation_reviews (
  id, left_refund_case_id, right_refund_case_id, match_class, status,
  reason_codes, policy_version
)
values (
  '94900000-0000-4000-8000-000000000001',
  '94500000-0000-4000-8000-000000000001',
  '94500000-0000-4000-8000-000000000002',
  'possible', 'pending', array['customer_email_exact'], '2026-08-04.v1'
);

select has_function(
  'public', 'admin_get_refund_source_draft_cases', array[]::text[],
  'Unified source draft RPC exists'
);
select has_function(
  'public', 'get_refund_source_queue_snapshot', array['timestamp with time zone'],
  'Source-aware queue snapshot RPC exists'
);
select ok(
  has_function_privilege('authenticated', 'public.admin_get_refund_source_draft_cases()', 'execute'),
  'Authenticated operators can invoke the scoped draft RPC'
);
select ok(
  not has_function_privilege('anon', 'public.get_refund_source_queue_snapshot(timestamptz)', 'execute'),
  'Anonymous callers cannot inspect source health'
);

select set_config('request.jwt.claim.role', 'authenticated', true);
select set_config('request.jwt.claim.sub', '94000000-0000-4000-8000-000000000001', true);

select is(
  jsonb_array_length(public.admin_get_refund_source_draft_cases()),
  1,
  'Machine manager sees the mapped SMS draft but not the unassigned Gmail draft'
);
select is(
  public.admin_get_refund_source_draft_cases() -> 0 ->> 'intakeSource',
  'sms_google_form',
  'Unified draft result preserves the SMS Google Form source'
);
select is(
  jsonb_array_length(public.get_refund_source_queue_snapshot() -> 'cases'),
  2,
  'Machine manager source snapshot includes only assigned cases'
);
select is(
  (
    select item ->> 'ingestionState'
    from jsonb_array_elements(public.get_refund_source_queue_snapshot() -> 'cases') item
    where item ->> 'caseId' = '94500000-0000-4000-8000-000000000002'
  ),
  'missing_information',
  'SMS draft is classified for the missing-information filter'
);
select is(
  (
    select (item ->> 'isAging')::boolean
    from jsonb_array_elements(public.get_refund_source_queue_snapshot() -> 'cases') item
    where item ->> 'caseId' = '94500000-0000-4000-8000-000000000002'
  ),
  true,
  'Aging state is calculated for open drafts'
);
select is(
  (
    select (item ->> 'providerReconciliationHold')::boolean
    from jsonb_array_elements(public.get_refund_source_queue_snapshot() -> 'cases') item
    where item ->> 'caseId' = '94500000-0000-4000-8000-000000000001'
  ),
  true,
  'Provider reconciliation holds are explicit in the queue contract'
);
select is(
  (
    select item ->> 'canonicalCasePath'
    from jsonb_array_elements(public.get_refund_source_queue_snapshot() -> 'cases') item
    where item ->> 'caseId' = '94500000-0000-4000-8000-000000000001'
  ),
  '/refunds?case=94500000-0000-4000-8000-000000000001',
  'Every visible case has an exact canonical portal link'
);
select ok(
  (public.get_refund_source_queue_snapshot() -> 'cases')::text
    !~ 'website-customer|sms-customer|private text|Internal source',
  'Case-state snapshot contains no customer content or private machine labels'
);
select is(
  jsonb_array_length(public.get_refund_source_queue_snapshot() -> 'sources'),
  3,
  'Manager source health covers website, Gmail, and SMS Google Form'
);

select set_config('request.jwt.claim.sub', '94000000-0000-4000-8000-000000000002', true);

select is(
  jsonb_array_length(public.admin_get_refund_source_draft_cases()),
  2,
  'Central admin sees both Gmail and SMS Google Form drafts'
);
select is(
  (
    select (item ->> 'unmappedCount')::integer
    from jsonb_array_elements(public.get_refund_source_queue_snapshot() -> 'sources') item
    where item ->> 'source' = 'sms_google_form'
  ),
  1,
  'Authorized central source health counts unmapped Google Form submissions'
);
select is(
  (public.get_refund_source_queue_snapshot() #>> '{reconciliation,visibleQuarantineCount}')::integer,
  1,
  'Authorized central reconciliation includes visible quarantine items'
);
select is(
  (public.get_refund_source_queue_snapshot() #>> '{reconciliation,delta}')::integer,
  0,
  'Source submissions reconcile to cases plus authorized quarantine'
);
select is(
  (public.get_refund_source_queue_snapshot() #>> '{reconciliation,reconciled}')::boolean,
  true,
  'Aggregate daily reconciliation reports a balanced equation'
);

select set_config('request.jwt.claim.sub', '94000000-0000-4000-8000-000000000003', true);
select ok(
  pg_temp.capture_error('select public.get_refund_source_queue_snapshot()') like '%Refund operations access required%',
  'Unprivileged authenticated users cannot inspect source health'
);

select set_config('request.jwt.claim.sub', '', true);
select set_config('request.jwt.claim.role', 'service_role', true);
select is(
  jsonb_array_length(public.get_refund_source_queue_snapshot() -> 'cases'),
  0,
  'Daily service monitor receives no case-level rows'
);
select is(
  (public.get_refund_source_queue_snapshot() ->> 'payloadRedacted')::boolean,
  true,
  'Daily service monitor output is explicitly aggregate-only'
);
select ok(
  public.get_refund_source_queue_snapshot()::text
    !~ 'example.test|Private Gmail|private text|source_response',
  'Daily monitor output omits customer content, provider IDs, and source row keys'
);

select * from finish();
rollback;
