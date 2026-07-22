begin;

create extension if not exists pgtap with schema extensions;
set local search_path = public, extensions;

select plan(31);

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
values (
  '00000000-0000-0000-0000-000000000000',
  '78000000-0000-4000-8000-000000000001',
  'authenticated',
  'authenticated',
  'refund-gpt-reviewer@example.test',
  '',
  now(),
  '{}'::jsonb,
  '{}'::jsonb,
  now(),
  now()
);

insert into public.admin_roles (user_id, role, active)
values ('78000000-0000-4000-8000-000000000001', 'super_admin', true);

create temporary table first_ingest as
select public.service_ingest_refund_gmail_message(
  repeat('b', 64),
  'gpt-triage-thread-1',
  'gpt-triage-message-1',
  '<gpt-triage-message-1@example.test>',
  null,
  'inbound',
  false,
  'gpt-refund-customer@example.test',
  'GPT Refund Customer',
  'support@example.test',
  'Refund help',
  'My card was charged and ends in 4242. Please help.',
  false,
  now() - interval '10 minutes',
  null,
  '[]'::jsonb
) as result;

update public.refund_gpt_triage_settings
set enabled = true
where singleton;

select has_table('public', 'refund_gpt_triage_settings', 'GPT triage default-off settings table exists');
select has_table('public', 'refund_gpt_triage_runs', 'GPT triage review ledger exists');
select col_default_is(
  'public', 'refund_gpt_triage_settings', 'enabled', 'false',
  'GPT triage provider processing defaults to disabled'
);
select col_default_is(
  'public', 'refund_gpt_triage_settings', 'auto_send_enabled', 'false',
  'GPT triage customer auto-send defaults to disabled'
);
select ok(
  pg_temp.capture_error('update public.refund_gpt_triage_settings set auto_send_enabled = true where singleton')
    like '%refund_gpt_triage_settings_auto_send_enabled_check%',
  'Database constraints prevent enabling GPT customer auto-send'
);
select hasnt_column('public', 'refund_gpt_triage_runs', 'raw_input', 'GPT ledger does not store raw model input');
select hasnt_column('public', 'refund_gpt_triage_runs', 'raw_response', 'GPT ledger does not store raw provider responses');
select ok(
  not has_table_privilege('authenticated', 'public.refund_gpt_triage_runs', 'select'),
  'Browser clients cannot read the service-only GPT triage ledger'
);
select ok(
  not has_function_privilege(
    'authenticated',
    'public.service_record_refund_gpt_triage(uuid,uuid,text,text,text,text,text,text,jsonb)',
    'execute'
  ),
  'Browser clients cannot record model output'
);
select ok(
  has_function_privilege(
    'service_role',
    'public.service_record_refund_gpt_triage(uuid,uuid,text,text,text,text,text,text,jsonb)',
    'execute'
  ),
  'Only the server-side worker can record validated model output'
);

create temporary table ready_result as
select public.service_record_refund_gpt_triage(
  (select refund_case_id from public.refund_gmail_messages where provider_message_id = 'gpt-triage-message-1'),
  (select id from public.refund_gmail_messages where provider_message_id = 'gpt-triage-message-1'),
  'gpt-triage-run-ready-1',
  repeat('c', 64),
  'gpt-triage-model',
  'gpt-triage-model-2026-07-21',
  'refund_missing_info_v1',
  'refund_gpt_triage_v1',
  jsonb_build_object(
    'schemaVersion', 'refund_gpt_triage_v1',
    'classification', 'refund',
    'confidenceBand', 'high',
    'language', 'en',
    'route', 'draft_reply',
    'summary', 'Customer reports a card charge but did not provide the machine location, time, or amount.',
    'extracted', jsonb_build_object(
      'locationName', null,
      'machineLabel', null,
      'incidentDate', '2026-07-21',
      'incidentTime', null,
      'paymentMethod', 'card',
      'amountCents', null,
      'cardLast4', '4242',
      'walletUsed', false
    ),
    'missingFields', jsonb_build_array('location_or_machine', 'incident_time', 'amount'),
    'policyFlags', '[]'::jsonb,
    'draft', jsonb_build_object(
      'subject', 'A quick detail check for your Bloomjoy refund request',
      'body', 'Please reply with the machine location, approximate purchase time, and amount paid. Never send a full card number, CVV, PIN, password, or bank login.'
    )
  )
) as result;

select is(
  (select result ->> 'status' from ready_result),
  'ready_for_review',
  'Validated missing-information output becomes manager-reviewable'
);
select is(
  (select count(*)::integer from public.refund_gpt_triage_runs),
  1,
  'One GPT triage ledger row is created'
);
select ok(
  pg_temp.capture_error(
    $sql$update public.refund_gpt_triage_runs
      set confidence_band = 'low'
      where run_key = 'gpt-triage-run-ready-1'$sql$
  ) like '%refund_gpt_triage_runs_route_shape%',
  'Database constraints keep low-confidence output out of the draft-reply lane'
);
select is(
  (public.service_record_refund_gpt_triage(
    (select refund_case_id from public.refund_gmail_messages where provider_message_id = 'gpt-triage-message-1'),
    (select id from public.refund_gmail_messages where provider_message_id = 'gpt-triage-message-1'),
    'gpt-triage-run-ready-1',
    repeat('c', 64),
    'gpt-triage-model',
    'gpt-triage-model-2026-07-21',
    'refund_missing_info_v1',
    'refund_gpt_triage_v1',
    '{}'::jsonb
  ) ->> 'created')::boolean,
  false,
  'Duplicate source/prompt/model delivery is idempotent before parsing the replayed body'
);
select is(
  (select count(*)::integer from public.refund_gpt_triage_runs),
  1,
  'Idempotent replay does not create another triage row'
);
select ok(
  pg_temp.capture_error(format(
    $sql$select public.service_record_refund_gpt_triage(
      %L::uuid, %L::uuid, 'gpt-triage-invalid-extra', %L, 'model', 'snapshot-extra',
      'refund_missing_info_v1', 'refund_gpt_triage_v1',
      %L::jsonb
    )$sql$,
    (select refund_case_id from public.refund_gmail_messages where provider_message_id = 'gpt-triage-message-1'),
    (select id from public.refund_gmail_messages where provider_message_id = 'gpt-triage-message-1'),
    repeat('d', 64),
    jsonb_build_object(
      'schemaVersion', 'refund_gpt_triage_v1',
      'classification', 'refund',
      'confidenceBand', 'high',
      'language', 'en',
      'route', 'draft_reply',
      'summary', 'Invalid extra action field.',
      'extracted', jsonb_build_object(
        'locationName', null, 'machineLabel', null, 'incidentDate', null, 'incidentTime', null,
        'paymentMethod', 'unknown', 'amountCents', null, 'cardLast4', null, 'walletUsed', null
      ),
      'missingFields', jsonb_build_array('location_or_machine'),
      'policyFlags', '[]'::jsonb,
      'draft', jsonb_build_object('subject', 'Details', 'body', 'Please share the machine location.'),
      'approveRefund', true
    )::text
  )) like '%unapproved fields%',
  'Strict database schema rejects model-invented action fields'
);

select set_config('request.jwt.claim.sub', '78000000-0000-4000-8000-000000000001', true);

select is(
  public.admin_get_refund_gpt_triage(
    (select refund_case_id from public.refund_gmail_messages where provider_message_id = 'gpt-triage-message-1')
  ) ->> 'route',
  'draft_reply',
  'Authorized refund admin can read the redacted manager suggestion'
);
select ok(
  public.admin_get_refund_gpt_triage(
    (select refund_case_id from public.refund_gmail_messages where provider_message_id = 'gpt-triage-message-1')
  ) ?& array['humanReviewRequired', 'missingFields', 'draftSubject', 'draftBody'],
  'Manager projection includes review state and editable reply fields'
);
select ok(
  public.admin_get_refund_gpt_triage(
    (select refund_case_id from public.refund_gmail_messages where provider_message_id = 'gpt-triage-message-1')
  )::text not like '%input_fingerprint%'
  and public.admin_get_refund_gpt_triage(
    (select refund_case_id from public.refund_gmail_messages where provider_message_id = 'gpt-triage-message-1')
  )::text not like '%run_key%',
  'Manager projection hides internal fingerprints and operation keys'
);

select is(
  public.admin_reject_refund_gpt_triage(
    (select id from public.refund_gpt_triage_runs where run_key = 'gpt-triage-run-ready-1'),
    'wrong_missing_fields',
    'The customer already provided the amount.'
  ) ->> 'status',
  'rejected',
  'Manager can reject a suggestion with an evaluation reason'
);
select is(
  (select reviewer_outcome from public.refund_gpt_triage_runs where run_key = 'gpt-triage-run-ready-1'),
  'wrong_missing_fields',
  'Reviewer outcome is retained for pilot metrics'
);

select public.service_ingest_refund_gmail_message(
  repeat('b', 64),
  'gpt-triage-thread-1',
  'gpt-triage-message-2',
  '<gpt-triage-message-2@example.test>',
  '<gpt-triage-message-1@example.test>',
  'inbound',
  false,
  'gpt-refund-customer@example.test',
  'GPT Refund Customer',
  'support@example.test',
  'Re: Refund help',
  'The machine was in the mall atrium around 2:35 PM and the amount was $7.',
  false,
  now() - interval '5 minutes',
  null,
  '[]'::jsonb
);

select public.service_record_refund_gpt_triage(
  (select refund_case_id from public.refund_gmail_messages where provider_message_id = 'gpt-triage-message-2'),
  (select id from public.refund_gmail_messages where provider_message_id = 'gpt-triage-message-2'),
  'gpt-triage-run-ready-2',
  repeat('e', 64),
  'gpt-triage-model',
  'gpt-triage-model-2026-07-21',
  'refund_missing_info_v1',
  'refund_gpt_triage_v1',
  jsonb_build_object(
    'schemaVersion', 'refund_gpt_triage_v1',
    'classification', 'refund',
    'confidenceBand', 'high',
    'language', 'en',
    'route', 'draft_reply',
    'summary', 'Customer provided location, time, amount, and card last four but not the purchase date.',
    'extracted', jsonb_build_object(
      'locationName', 'Mall Atrium',
      'machineLabel', null,
      'incidentDate', null,
      'incidentTime', '14:35',
      'paymentMethod', 'card',
      'amountCents', 700,
      'cardLast4', '4242',
      'walletUsed', false
    ),
    'missingFields', jsonb_build_array('incident_date'),
    'policyFlags', '[]'::jsonb,
    'draft', jsonb_build_object(
      'subject', 'A quick date check',
      'body', 'Please reply with the purchase date. Never send a full card number, CVV, PIN, password, or bank login.'
    )
  )
);

insert into public.refund_case_messages (
  id, refund_case_id, message_type, status, recipient_email, subject, body, template_key, created_by
)
values (
  '78900000-0000-4000-8000-000000000001',
  (select refund_case_id from public.refund_gmail_messages where provider_message_id = 'gpt-triage-message-2'),
  'more_info',
  'pending',
  'gpt-refund-customer@example.test',
  'A quick date check',
  'Please reply with the approximate purchase date.',
  'refund_more_info_editable_v1',
  '78000000-0000-4000-8000-000000000001'
);

select ok(
  pg_temp.capture_error(format(
    $sql$select public.service_record_refund_gpt_triage_delivery(
      %L::uuid, %L::uuid, %L::uuid, %L::uuid, 'A quick date check', 'Please reply with the approximate purchase date.'
    )$sql$,
    (select id from public.refund_gpt_triage_runs where run_key = 'gpt-triage-run-ready-2'),
    (select refund_case_id from public.refund_gmail_messages where provider_message_id = 'gpt-triage-message-2'),
    '78000000-0000-4000-8000-000000000001',
    '78900000-0000-4000-8000-000000000001'
  )) like '%sent customer message is required%',
  'Triage approval cannot be recorded before customer delivery succeeds'
);

update public.refund_case_messages
set status = 'sent', sent_at = now()
where id = '78900000-0000-4000-8000-000000000001';

select is(
  public.service_record_refund_gpt_triage_delivery(
    (select id from public.refund_gpt_triage_runs where run_key = 'gpt-triage-run-ready-2'),
    (select refund_case_id from public.refund_gmail_messages where provider_message_id = 'gpt-triage-message-2'),
    '78000000-0000-4000-8000-000000000001',
    '78900000-0000-4000-8000-000000000001',
    'A quick date check',
    'Please reply with the approximate purchase date.'
  ) ->> 'reviewerOutcome',
  'edited',
  'Successful delivery records whether the manager edited the suggestion'
);
select is(
  (select status from public.refund_gpt_triage_runs where run_key = 'gpt-triage-run-ready-2'),
  'approved',
  'Successful customer delivery completes the human approval record'
);
select is(
  (public.admin_get_refund_gpt_triage_metrics() ->> 'totalRuns')::integer,
  2,
  'Pilot metrics aggregate reviewed triage runs without raw customer content'
);
select is(
  (public.admin_get_refund_gpt_triage_metrics() ->> 'missingFieldCorrections')::integer,
  1,
  'Pilot metrics report missing-field reviewer corrections'
);

update public.refund_gpt_triage_runs
set retention_expires_at = now() - interval '1 minute';

select is(
  public.service_purge_refund_gpt_triage_expired_content(200),
  2,
  'Expired GPT-derived content is purged in a bounded pass'
);
select ok(
  not exists (
    select 1
    from public.refund_gpt_triage_runs
    where content_deleted_at is null
      or summary is not null
      or draft_subject is not null
      or draft_body is not null
      or extracted_fields <> '{}'::jsonb
      or cardinality(missing_fields) <> 0
  ),
  'Retention cleanup removes derived customer content while leaving aggregate outcomes'
);
select is(
  (select count(*)::integer from public.refund_case_events where event_type = 'gpt_triage_approved'),
  1,
  'Human-approved GPT reply creates one redacted audit event'
);

select set_config('request.jwt.claim.sub', '', true);

select ok(
  pg_temp.capture_error(format(
    'select public.admin_get_refund_gpt_triage(%L::uuid)',
    (select refund_case_id from public.refund_gmail_messages where provider_message_id = 'gpt-triage-message-1')
  )) like '%Authentication required%',
  'Unauthenticated callers cannot read GPT triage suggestions'
);
select ok(
  pg_temp.capture_error('select public.admin_get_refund_gpt_triage_metrics()') like '%Authentication required%',
  'Unauthenticated callers cannot read GPT pilot metrics'
);

select * from finish();
rollback;
