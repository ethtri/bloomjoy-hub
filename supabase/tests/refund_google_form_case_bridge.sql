begin;

create extension if not exists pgtap with schema extensions;
set local search_path = public, extensions;

select plan(59);

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
    '82000000-0000-4000-8000-000000000001',
    'authenticated', 'authenticated', 'refund-form-manager@example.test', '', now(),
    '{}'::jsonb, '{}'::jsonb, now(), now()
  ),
  (
    '00000000-0000-0000-0000-000000000000',
    '82000000-0000-4000-8000-000000000002',
    'authenticated', 'authenticated', 'refund-form-admin@example.test', '', now(),
    '{}'::jsonb, '{}'::jsonb, now(), now()
  );

insert into public.admin_roles (user_id, role)
values ('82000000-0000-4000-8000-000000000002', 'super_admin');

insert into public.customer_accounts (id, name, account_type)
values ('82100000-0000-4000-8000-000000000001', 'Refund Google Form test', 'customer');

insert into public.reporting_locations (id, account_id, name, timezone)
values
  (
    '82200000-0000-4000-8000-000000000001',
    '82100000-0000-4000-8000-000000000001',
    'Synthetic Form Location',
    'America/Los_Angeles'
  ),
  (
    '82200000-0000-4000-8000-000000000002',
    '82100000-0000-4000-8000-000000000001',
    'Synthetic Ambiguous Location',
    'America/New_York'
  );

insert into public.reporting_machines (id, account_id, location_id, machine_label, machine_type)
values
  (
    '82300000-0000-4000-8000-000000000001',
    '82100000-0000-4000-8000-000000000001',
    '82200000-0000-4000-8000-000000000001',
    'Synthetic Form Machine',
    'commercial'
  ),
  (
    '82300000-0000-4000-8000-000000000002',
    '82100000-0000-4000-8000-000000000001',
    '82200000-0000-4000-8000-000000000002',
    'Synthetic Ambiguous Machine A',
    'commercial'
  ),
  (
    '82300000-0000-4000-8000-000000000003',
    '82100000-0000-4000-8000-000000000001',
    '82200000-0000-4000-8000-000000000002',
    'Synthetic Ambiguous Machine B',
    'mini'
  );

insert into public.reporting_machine_aliases (reporting_machine_id, alias, alias_type, source)
values (
  '82300000-0000-4000-8000-000000000001',
  'Legacy Form Location',
  'legacy_location',
  'synthetic_test'
);

insert into public.reporting_machine_refund_managers (
  id, reporting_machine_id, manager_user_id, manager_email, grant_reason
)
values (
  '82400000-0000-4000-8000-000000000001',
  '82300000-0000-4000-8000-000000000001',
  '82000000-0000-4000-8000-000000000001',
  'refund-form-manager@example.test',
  'Synthetic Google Form bridge test'
);

select has_table('public', 'refund_google_form_sync_runs', 'Google Form sync run ledger exists');
select has_table('public', 'refund_google_form_import_rows', 'Google Form opaque import ledger exists');
select has_function(
  'public',
  'service_ingest_refund_google_form_response',
  array['uuid','text','text','integer','text','text','text','timestamp with time zone','text','text','text','text','text','text','integer','text','boolean','text','text','text[]','text[]'],
  'Google Form service ingestion RPC exists'
);
select ok(
  not has_function_privilege(
    'authenticated',
    'public.service_ingest_refund_google_form_response(uuid,text,text,integer,text,text,text,timestamp with time zone,text,text,text,text,text,text,integer,text,boolean,text,text,text[],text[])',
    'execute'
  ),
  'Browser clients cannot invoke Google Form ingestion'
);
select ok(
  has_function_privilege(
    'service_role',
    'public.service_ingest_refund_google_form_response(uuid,text,text,integer,text,text,text,timestamp with time zone,text,text,text,text,text,text,integer,text,boolean,text,text,text[],text[])',
    'execute'
  ),
  'Service workers can invoke Google Form ingestion'
);
select ok(
  not has_table_privilege('authenticated', 'public.refund_google_form_sync_runs', 'select'),
  'Browser clients cannot read raw Google Form sync runs'
);
select ok(
  not has_table_privilege('authenticated', 'public.refund_google_form_import_rows', 'select'),
  'Browser clients cannot read opaque source row state'
);

select set_config('request.jwt.claim.role', 'service_role', true);

create temporary table first_run as
select public.service_start_refund_google_form_sync(
  'synthetic:refund-google-form:run-1',
  'synthetic_test',
  '2026-08-04.v1',
  now()
) as result;

select is((select (result ->> 'claimed')::boolean from first_run), true, 'First run key is claimed');
select is(
  (
    public.service_start_refund_google_form_sync(
      'synthetic:refund-google-form:run-1', 'synthetic_test', '2026-08-04.v1', now()
    ) ->> 'claimed'
  )::boolean,
  false,
  'Repeated run key is duplicate-suppressed'
);
select is(
  (select count(*)::integer from public.refund_google_form_sync_runs),
  1,
  'Repeated run key creates one run row'
);

create temporary table mapped_ingest as
select public.service_ingest_refund_google_form_response(
  (select (result ->> 'runId')::uuid from first_run),
  repeat('a', 64), repeat('b', 64), 2,
  '2026-08-04T10:00:00', 'America/Los_Angeles', '2026-08-04.v1',
  '2026-08-04T00:00:00Z',
  'refund-form-customer@example.test', 'Synthetic Form Customer', 'Legacy Form Location',
  '2026-08-04T09:45:00', 'Synthetic imported issue.', 'card', 1200, '4242', false,
  null, null, '{}', '{}'
) as result;

select is((select (result ->> 'created')::boolean from mapped_ingest), true, 'Mapped response creates a case');
select is((select result ->> 'importStatus' from mapped_ingest), 'imported', 'Complete mapped response is imported');
select is(
  (select count(*)::integer from public.refund_cases where intake_source = 'sms_google_form'),
  1,
  'One SMS Google Form response creates one case'
);
select is(
  (select intake_source from public.refund_cases where id = (select (result ->> 'caseId')::uuid from mapped_ingest)),
  'sms_google_form',
  'Case source is explicit'
);
select is(
  (select status from public.refund_cases where id = (select (result ->> 'caseId')::uuid from mapped_ingest)),
  'draft',
  'Imported case remains a draft'
);
select is(
  (select result ->> 'casePath' from mapped_ingest),
  '/refunds?case=' || (select result ->> 'caseId' from mapped_ingest),
  'Imported response returns the exact non-actioning Hub manager path'
);
select is(
  (select reporting_machine_id from public.refund_cases where id = (select (result ->> 'caseId')::uuid from mapped_ingest)),
  '82300000-0000-4000-8000-000000000001'::uuid,
  'Legacy alias maps to the canonical machine'
);
select ok(
  public.can_manage_refund_case(
    '82000000-0000-4000-8000-000000000001',
    (select (result ->> 'caseId')::uuid from mapped_ingest)
  ),
  'Current mapped Machine Manager can access the imported draft'
);
select is((select count(*)::integer from public.refund_case_messages), 0, 'Import creates no customer message');
select is(
  (select count(*)::integer from public.refund_case_events where event_type = 'google_form_response_imported'),
  1,
  'Import writes one redacted intake event'
);
select is(
  (select count(*)::integer from public.refund_case_events where metadata ->> 'official_action' = 'true'),
  0,
  'Import creates no official action event'
);

create temporary table duplicate_ingest as
select public.service_ingest_refund_google_form_response(
  (select (result ->> 'runId')::uuid from first_run),
  repeat('a', 64), repeat('b', 64), 2,
  '2026-08-04T10:00:00', 'America/Los_Angeles', '2026-08-04.v1',
  '2026-08-04T00:00:00Z',
  'refund-form-customer@example.test', 'Synthetic Form Customer', 'Legacy Form Location',
  '2026-08-04T09:45:00', 'Synthetic imported issue.', 'card', 1200, '4242', false,
  null, null, '{}', '{}'
) as result;

select is((select (result ->> 'duplicate')::boolean from duplicate_ingest), true, 'Exact replay is duplicate-suppressed');
select is(
  (select count(*)::integer from public.refund_cases where intake_source = 'sms_google_form'),
  1,
  'Exact replay creates no second case'
);
select is(
  (select count(*)::integer from public.refund_case_events where event_type = 'google_form_response_imported'),
  1,
  'Exact replay creates no second event'
);

create temporary table moved_ingest as
select public.service_ingest_refund_google_form_response(
  (select (result ->> 'runId')::uuid from first_run),
  repeat('c', 64), repeat('b', 64), 3,
  '2026-08-04T10:00:00', 'America/Los_Angeles', '2026-08-04.v1',
  '2026-08-04T00:00:00Z',
  'refund-form-customer@example.test', 'Synthetic Form Customer', 'Legacy Form Location',
  '2026-08-04T09:45:00', 'Synthetic imported issue.', 'card', 1200, '4242', false,
  null, null, '{}', '{}'
) as result;

select is((select (result ->> 'duplicate')::boolean from moved_ingest), true, 'Reordered identical response is duplicate-suppressed');
select is(
  (select source_row_number from public.refund_google_form_import_rows where source_payload_fingerprint = repeat('b', 64)),
  3,
  'Reordered response updates the redacted row cursor'
);
select is(
  (select count(*)::integer from public.refund_cases where intake_source = 'sms_google_form'),
  1,
  'Reordered response creates no second case'
);

create temporary table edited_ingest as
select public.service_ingest_refund_google_form_response(
  (select (result ->> 'runId')::uuid from first_run),
  repeat('c', 64), repeat('d', 64), 3,
  '2026-08-04T10:00:00', 'America/Los_Angeles', '2026-08-04.v1',
  '2026-08-04T00:00:00Z',
  'refund-form-customer@example.test', 'Synthetic Form Customer', 'Legacy Form Location',
  '2026-08-04T09:50:00', 'Synthetic edited issue.', 'card', 1300, '4242', false,
  null, null, '{}', '{}'
) as result;

select is((select (result ->> 'updated')::boolean from edited_ingest), true, 'Edited response updates its draft case');
select is(
  (select issue_summary from public.refund_cases where id = (select (result ->> 'caseId')::uuid from edited_ingest)),
  'Synthetic edited issue.',
  'Edited draft content is refreshed'
);
select is(
  (select payment_amount_cents from public.refund_cases where id = (select (result ->> 'caseId')::uuid from edited_ingest)),
  1300,
  'Edited draft amount is refreshed'
);
select is(
  (select count(*)::integer from public.refund_case_events where event_type = 'google_form_response_updated'),
  1,
  'Edited response adds one redacted update event'
);

update public.refund_cases
set status = 'needs_review'
where id = (select (result ->> 'caseId')::uuid from edited_ingest);

create temporary table locked_edit_ingest as
select public.service_ingest_refund_google_form_response(
  (select (result ->> 'runId')::uuid from first_run),
  repeat('c', 64), repeat('a', 63) || '1', 3,
  '2026-08-04T10:00:00', 'America/Los_Angeles', '2026-08-04.v1',
  '2026-08-04T00:00:00Z',
  'refund-form-customer@example.test', 'Synthetic Form Customer', 'Legacy Form Location',
  '2026-08-04T09:55:00', 'Unsafe late Sheet edit.', 'card', 1400, '4242', false,
  null, null, '{}', '{}'
) as result;

select is((select result ->> 'reason' from locked_edit_ingest), 'case_locked_after_progress', 'Progressed case rejects a later Sheet edit');
select is((select (result ->> 'updated')::boolean from locked_edit_ingest), false, 'Progressed case is not overwritten');
select is(
  (select issue_summary from public.refund_cases where id = (select (result ->> 'caseId')::uuid from locked_edit_ingest)),
  'Synthetic edited issue.',
  'Manager-progressed case content remains unchanged'
);

create temporary table invalid_source_timestamp_ingest as
select public.service_ingest_refund_google_form_response(
  (select (result ->> 'runId')::uuid from first_run),
  repeat('a', 63) || '2', repeat('a', 63) || '3', 10,
  null, 'America/Los_Angeles', '2026-08-04.v1',
  '2026-08-04T00:00:00Z',
  'timestamp-form@example.test', 'Synthetic Timestamp', 'Legacy Form Location',
  '2026-08-04T10:00:00', 'Synthetic invalid timestamp issue.', 'card', 900, '2222', false,
  null, null, '{}', array['source_timestamp']
) as result;

select is((select result ->> 'importStatus' from invalid_source_timestamp_ingest), 'rejected', 'Missing source timestamp is rejected');
select is((select result ->> 'reason' from invalid_source_timestamp_ingest), 'invalid_source_timestamp', 'Missing source timestamp cannot bypass cutover');
select is((select result ->> 'caseId' from invalid_source_timestamp_ingest), null, 'Missing source timestamp creates no case');

create temporary table unmapped_ingest as
select public.service_ingest_refund_google_form_response(
  (select (result ->> 'runId')::uuid from first_run),
  repeat('e', 64), repeat('f', 64), 4,
  '2026-08-04T10:05:00', 'America/Los_Angeles', '2026-08-04.v1',
  '2026-08-04T00:00:00Z',
  'unmapped-form@example.test', 'Synthetic Unmapped', 'No Such Location',
  '2026-08-04T10:00:00', 'Synthetic unmapped issue.', 'card', 700, '1111', false,
  null, null, '{}', '{}'
) as result;

select is((select result ->> 'importStatus' from unmapped_ingest), 'quarantined', 'Unmapped location is quarantined');
select is((select result ->> 'reason' from unmapped_ingest), 'unmapped_location', 'Unmapped reason is explicit');
select is((select result ->> 'caseId' from unmapped_ingest), null, 'Unmapped location does not invent a case machine');

create temporary table ambiguous_ingest as
select public.service_ingest_refund_google_form_response(
  (select (result ->> 'runId')::uuid from first_run),
  repeat('1', 64), repeat('2', 64), 5,
  '2026-08-04T10:10:00', 'America/Los_Angeles', '2026-08-04.v1',
  '2026-08-04T00:00:00Z',
  'ambiguous-form@example.test', 'Synthetic Ambiguous', 'Synthetic Ambiguous Location',
  '2026-08-04T10:00:00', 'Synthetic ambiguous issue.', 'cash', 800, null, false,
  'zelle', 'synthetic-zelle@example.test', '{}', '{}'
) as result;

select is((select result ->> 'importStatus' from ambiguous_ingest), 'quarantined', 'Ambiguous location is quarantined');
select is((select result ->> 'reason' from ambiguous_ingest), 'ambiguous_location', 'Ambiguous reason is explicit');
select is((select result ->> 'caseId' from ambiguous_ingest), null, 'Ambiguous location does not guess a machine');

create temporary table invalid_ingest as
select public.service_ingest_refund_google_form_response(
  (select (result ->> 'runId')::uuid from first_run),
  repeat('3', 64), repeat('4', 64), 6,
  '2026-08-04T10:15:00', 'America/Los_Angeles', '2026-08-04.v1',
  '2026-08-04T00:00:00Z',
  'not-an-email', 'Synthetic Invalid', 'Legacy Form Location',
  '2026-08-04T10:00:00', 'Synthetic invalid issue.', 'card', 900, '2222', false,
  null, null, '{}', array['customer_email']
) as result;

select is((select result ->> 'importStatus' from invalid_ingest), 'rejected', 'Invalid customer email is rejected');
select is((select result ->> 'reason' from invalid_ingest), 'invalid_customer_email', 'Invalid email reason is explicit');

create temporary table incomplete_ingest as
select public.service_ingest_refund_google_form_response(
  (select (result ->> 'runId')::uuid from first_run),
  repeat('5', 64), repeat('6', 64), 7,
  '2026-08-04T10:20:00', 'America/Los_Angeles', '2026-08-04.v1',
  '2026-08-04T00:00:00Z',
  'incomplete-form@example.test', 'Synthetic Incomplete', 'Legacy Form Location',
  null, 'Synthetic incomplete issue.', null, null, null, false,
  null, null, array['incident_datetime','payment_amount','payment_method'], '{}'
) as result;

select is((select (result ->> 'created')::boolean from incomplete_ingest), true, 'Incomplete mapped response creates an actionable draft');
select is((select result ->> 'importStatus' from incomplete_ingest), 'quarantined', 'Incomplete draft remains visible as quarantine work');
select ok(
  (
    select status = 'draft' and incident_at is null and payment_method is null
    from public.refund_cases
    where id = (select (result ->> 'caseId')::uuid from incomplete_ingest)
  ),
  'Draft safely preserves missing incident and payment facts'
);

create temporary table boundary_ingest as
select public.service_ingest_refund_google_form_response(
  (select (result ->> 'runId')::uuid from first_run),
  repeat('7', 64), repeat('8', 64), 8,
  '2026-08-01T10:00:00', 'America/Los_Angeles', '2026-08-04.v1',
  '2026-08-04T00:00:00Z',
  'boundary-form@example.test', 'Synthetic Boundary', 'Legacy Form Location',
  '2026-08-01T09:55:00', 'Synthetic old issue.', 'card', 500, '3333', false,
  null, null, '{}', '{}'
) as result;

select is((select (result ->> 'skipped')::boolean from boundary_ingest), true, 'Declared no-backfill boundary skips older rows');

create temporary table cash_ingest as
select public.service_ingest_refund_google_form_response(
  (select (result ->> 'runId')::uuid from first_run),
  repeat('9', 64), repeat('0', 64), 9,
  '2026-08-04T11:00:00', 'America/Los_Angeles', '2026-08-04.v1',
  '2026-08-04T00:00:00Z',
  'cash-form@example.test', 'Synthetic Cash', 'Legacy Form Location',
  '2026-08-04T10:55:00', 'Synthetic cash issue.', 'cash', 600, null, false,
  'zelle', 'synthetic-cash@example.test', '{}', '{}'
) as result;

select is((select (result ->> 'created')::boolean from cash_ingest), true, 'Mapped cash response creates a draft');
select is(
  (select zelle_payment_contact from public.refund_cases where id = (select (result ->> 'caseId')::uuid from cash_ingest)),
  'synthetic-cash@example.test',
  'Zelle contact stays in the authorized case field'
);
select is((select count(*)::integer from public.refund_case_messages), 0, 'No imported response auto-sends customer mail');

select ok(
  public.service_finish_refund_google_form_sync(
    (select (result ->> 'runId')::uuid from first_run),
    'completed',
    jsonb_build_object(
      'rowsSeen', 8, 'rowsImported', 2, 'rowsUpdated', 1, 'rowsDuplicate', 2,
      'rowsQuarantined', 3, 'rowsSkipped', 1, 'rowsFailed', 0
    ),
    null,
    jsonb_build_object('pii_redacted', true)
  ),
  'Run completion stores aggregate evidence'
);
select is(
  (select status from public.refund_google_form_sync_runs where run_key = 'synthetic:refund-google-form:run-1'),
  'completed',
  'Run ledger records completion'
);

select set_config('request.jwt.claim.role', 'authenticated', true);
select set_config('request.jwt.claim.sub', '82000000-0000-4000-8000-000000000001', true);
select ok(
  (public.admin_get_refund_google_form_import_health() ->> 'lastRunStatus') = 'completed',
  'Mapped manager can see aggregate bridge health'
);
select matches(
  pg_temp.capture_error('select public.admin_get_refund_google_form_quarantine(50)'),
  '^P0001:Admin refund triage access required',
  'Machine Manager cannot inspect the admin quarantine list'
);

select set_config('request.jwt.claim.sub', '82000000-0000-4000-8000-000000000002', true);
select ok(
  jsonb_array_length(public.admin_get_refund_google_form_quarantine(50)) >= 3,
  'Super Admin can see PII-free quarantine work'
);
select ok(
  public.admin_get_refund_google_form_quarantine(50)::text !~ 'example.test|Synthetic.*issue',
  'Quarantine API omits customer identity and complaint content'
);
select ok(
  not exists (
    select 1
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'refund_google_form_import_rows'
      and column_name in ('customer_email', 'customer_name', 'issue_summary', 'payment_contact')
  ),
  'Opaque import ledger has no raw customer-content columns'
);

select * from finish();
rollback;
