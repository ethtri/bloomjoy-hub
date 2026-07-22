begin;

create extension if not exists pgtap with schema extensions;
set local search_path = public, extensions;

select plan(42);

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
  instance_id,
  id,
  aud,
  role,
  email,
  encrypted_password,
  email_confirmed_at,
  raw_app_meta_data,
  raw_user_meta_data,
  created_at,
  updated_at
)
values (
  '00000000-0000-0000-0000-000000000000',
  '77000000-0000-4000-8000-000000000001',
  'authenticated',
  'authenticated',
  'refund-gmail-manager@example.test',
  '',
  now(),
  '{}'::jsonb,
  '{}'::jsonb,
  now(),
  now()
);

insert into public.customer_accounts (id, name, account_type)
values ('77100000-0000-4000-8000-000000000001', 'Refund Gmail test', 'customer');

insert into public.reporting_locations (id, account_id, name, timezone)
values (
  '77200000-0000-4000-8000-000000000001',
  '77100000-0000-4000-8000-000000000001',
  'Refund Gmail test location',
  'America/Los_Angeles'
);

insert into public.reporting_machines (id, account_id, location_id, machine_label)
values (
  '77300000-0000-4000-8000-000000000001',
  '77100000-0000-4000-8000-000000000001',
  '77200000-0000-4000-8000-000000000001',
  'Refund Gmail test machine'
);

insert into public.reporting_machine_refund_managers (
  id,
  reporting_machine_id,
  manager_user_id,
  manager_email,
  grant_reason
)
values (
  '77400000-0000-4000-8000-000000000001',
  '77300000-0000-4000-8000-000000000001',
  '77000000-0000-4000-8000-000000000001',
  'refund-gmail-manager@example.test',
  'Refund Gmail transport test'
);

select has_table('public', 'refund_gmail_threads', 'Gmail thread linkage table exists');
select has_table('public', 'refund_gmail_messages', 'Gmail sanitized message table exists');
select has_table('public', 'refund_gmail_attachments', 'Gmail quarantine metadata table exists');
select has_table('public', 'refund_gmail_sync_runs', 'Gmail sync run ledger exists');
select has_table('public', 'refund_gmail_sync_state', 'Gmail sync health state exists');

select ok(
  not has_table_privilege('authenticated', 'public.refund_gmail_threads', 'select'),
  'Authenticated browser clients cannot read raw Gmail provider thread IDs'
);
select ok(
  not has_table_privilege('authenticated', 'public.refund_gmail_messages', 'select'),
  'Authenticated browser clients cannot read raw Gmail message rows'
);
select ok(
  not has_table_privilege('authenticated', 'public.refund_gmail_attachments', 'select'),
  'Authenticated browser clients cannot read quarantine paths'
);
select ok(
  not has_function_privilege(
    'authenticated',
    'public.service_ingest_refund_gmail_message(text,text,text,text,text,text,boolean,text,text,text,text,text,boolean,timestamp with time zone,text,jsonb)',
    'execute'
  ),
  'Browser clients cannot invoke the Gmail ingestion service function'
);
select ok(
  has_function_privilege(
    'service_role',
    'public.service_ingest_refund_gmail_message(text,text,text,text,text,text,boolean,text,text,text,text,text,boolean,timestamp with time zone,text,jsonb)',
    'execute'
  ),
  'The service worker can invoke Gmail ingestion'
);

create temporary table first_ingest as
select public.service_ingest_refund_gmail_message(
  repeat('a', 64),
  'gmail-thread-1',
  'gmail-message-1',
  '<gmail-message-1@example.test>',
  null,
  'inbound',
  false,
  'refund-customer@example.test',
  'Refund Customer',
  'support@example.test',
  'Refund help',
  'Synthetic sanitized customer message.',
  true,
  now() - interval '10 minutes',
  null,
  jsonb_build_array(jsonb_build_object(
    'providerAttachmentId', 'gmail-attachment-1',
    'fileName', 'receipt.pdf',
    'contentType', 'application/pdf',
    'byteSize', 1200,
    'disposition', 'attachment',
    'allowed', true,
    'rejectionCode', null
  ))
) as result;

select is(
  (select (result ->> 'created')::boolean from first_ingest),
  true,
  'A first labeled Gmail message creates one transport record'
);
select is(
  (select count(*)::integer from public.refund_cases where intake_source = 'gmail'),
  1,
  'A first labeled Gmail message creates one refund case'
);
select is(
  (
    select status
    from public.refund_cases
    where id = (select (result ->> 'caseId')::uuid from first_ingest)
  ),
  'draft',
  'A Gmail-created refund case starts as a draft'
);
select ok(
  (
    select reporting_machine_id is null
      and reporting_location_id is null
      and incident_at is null
      and payment_method is null
    from public.refund_cases
    where id = (select (result ->> 'caseId')::uuid from first_ingest)
  ),
  'A Gmail draft does not invent location, incident time, or payment method'
);
select is(
  (select count(*)::integer from public.refund_gmail_attachments),
  1,
  'Permitted attachment metadata is recorded once for quarantine'
);

create temporary table duplicate_ingest as
select public.service_ingest_refund_gmail_message(
  repeat('a', 64),
  'gmail-thread-1',
  'gmail-message-1',
  '<gmail-message-1@example.test>',
  null,
  'inbound',
  false,
  'refund-customer@example.test',
  'Refund Customer',
  'support@example.test',
  'Refund help',
  'Synthetic sanitized customer message.',
  true,
  now() - interval '10 minutes',
  null,
  '[]'::jsonb
) as result;

select is(
  (select (result ->> 'duplicate')::boolean from duplicate_ingest),
  true,
  'Repeated Gmail delivery is reported as a duplicate'
);
select is(
  (select count(*)::integer from public.refund_gmail_messages),
  1,
  'Repeated Gmail delivery does not create another message row'
);
select is(
  (select count(*)::integer from public.refund_case_events where event_type = 'gmail_customer_message_received'),
  1,
  'Repeated Gmail delivery does not duplicate the customer-message event'
);

select public.service_ingest_refund_gmail_message(
  repeat('a', 64),
  'gmail-thread-1',
  'gmail-message-2',
  '<gmail-message-2@example.test>',
  '<gmail-message-1@example.test>',
  'inbound',
  false,
  'refund-customer@example.test',
  'Refund Customer',
  'support@example.test',
  'Re: Refund help',
  'Synthetic follow-up with more details.',
  false,
  now() - interval '5 minutes',
  null,
  '[]'::jsonb
);

select is(
  (select count(*)::integer from public.refund_gmail_threads),
  1,
  'A follow-up in the same Gmail thread keeps one thread link'
);
select is(
  (select count(*)::integer from public.refund_gmail_messages),
  2,
  'A customer follow-up adds one chronological message to the same case'
);

select public.service_ingest_refund_gmail_message(
  repeat('a', 64),
  'gmail-thread-2',
  'gmail-message-3',
  '<gmail-message-3@example.test>',
  null,
  'inbound',
  false,
  'refund-customer@example.test',
  'Refund Customer',
  'support@example.test',
  'New thread for existing case',
  'Synthetic thread change.',
  false,
  now() - interval '2 minutes',
  (select public_reference from public.refund_cases where intake_source = 'gmail' order by created_at limit 1),
  '[]'::jsonb
);

select is(
  (select count(*)::integer from public.refund_cases where intake_source = 'gmail'),
  1,
  'A new Gmail thread with the same case reference and sender reuses the case'
);
select is(
  (select count(*)::integer from public.refund_gmail_threads),
  2,
  'A safe threading change creates another provider-thread link to the same case'
);

insert into public.refund_case_messages (
  id,
  refund_case_id,
  message_type,
  status,
  recipient_email,
  subject,
  body
)
values (
  '77500000-0000-4000-8000-000000000001',
  (select id from public.refund_cases where intake_source = 'gmail' order by created_at limit 1),
  'more_info',
  'pending',
  'refund-customer@example.test',
  'Synthetic manager reply',
  'Please share the missing purchase details.'
);

create temporary table outbound_claim as
select public.service_claim_refund_gmail_outbound(
  (select id from public.refund_cases where intake_source = 'gmail' order by created_at limit 1),
  '77500000-0000-4000-8000-000000000001',
  'refund-case-message:77500000-0000-4000-8000-000000000001',
  'support@example.test',
  'refund-customer@example.test',
  'Please share the missing purchase details.'
) as result;

select is(
  (select (result ->> 'claimed')::boolean from outbound_claim),
  true,
  'A manager-approved original-thread reply can be claimed once'
);
select is(
  (
    public.service_claim_refund_gmail_outbound(
      (select id from public.refund_cases where intake_source = 'gmail' order by created_at limit 1),
      '77500000-0000-4000-8000-000000000001',
      'refund-case-message:77500000-0000-4000-8000-000000000001',
      'support@example.test',
      'refund-customer@example.test',
      'Please share the missing purchase details.'
    ) ->> 'claimed'
  )::boolean,
  false,
  'The same manager reply operation cannot be claimed twice'
);
select is(
  public.service_finish_refund_gmail_outbound(
    (select (result ->> 'transportMessageId')::uuid from outbound_claim),
    'sent',
    'gmail-outbound-message-1',
    '<refund-outbound-1@example.test>',
    null
  ),
  true,
  'A claimed Gmail reply can be marked sent once'
);
select is(
  public.service_finish_refund_gmail_outbound(
    (select (result ->> 'transportMessageId')::uuid from outbound_claim),
    'sent',
    'gmail-outbound-message-1',
    '<refund-outbound-1@example.test>',
    null
  ),
  false,
  'A sent Gmail reply cannot be finalized twice'
);

select set_config('request.jwt.claim.sub', '77000000-0000-4000-8000-000000000001', true);

select is(
  jsonb_array_length(public.admin_get_refund_gmail_draft_cases()),
  0,
  'A location-only refund manager cannot read unassigned Gmail draft cases'
);
select ok(
  pg_temp.capture_error(
    format(
      'select public.admin_get_refund_gmail_case_context(%L::uuid)',
      (select id from public.refund_cases where intake_source = 'gmail' order by created_at limit 1)
    )
  ) like '%Refund case access required%',
  'A location-only refund manager cannot read an unassigned Gmail conversation'
);

insert into public.admin_roles (user_id, role, active)
values ('77000000-0000-4000-8000-000000000001', 'super_admin', true);

select is(
  jsonb_array_length(public.admin_get_refund_gmail_draft_cases()),
  1,
  'An authorized central admin sees the Gmail-created draft case'
);
select is(
  jsonb_array_length(
    public.admin_get_refund_gmail_case_context(
      (select id from public.refund_cases where intake_source = 'gmail' order by created_at limit 1)
    ) -> 'messages'
  ),
  4,
  'The central-admin Gmail view returns the full case conversation in chronological order'
);
select ok(
  public.admin_get_refund_gmail_case_context(
    (select id from public.refund_cases where intake_source = 'gmail' order by created_at limit 1)
  )::text not like '%gmail-thread-1%'
  and public.admin_get_refund_gmail_case_context(
    (select id from public.refund_cases where intake_source = 'gmail' order by created_at limit 1)
  )::text not like '%gmail-message-1%',
  'The central-admin Gmail view omits raw provider thread and message identifiers'
);

select is(
  (public.service_start_refund_gmail_sync(
    'scheduled:refund-gmail-test-1',
    'scheduled',
    now(),
    repeat('a', 64),
    repeat('b', 64),
    true
  ) ->> 'claimed')::boolean,
  true,
  'The first Gmail scheduler run key is claimed'
);
select is(
  (public.service_start_refund_gmail_sync(
    'scheduled:refund-gmail-test-1',
    'scheduled',
    now(),
    repeat('a', 64),
    repeat('b', 64),
    true
  ) ->> 'claimed')::boolean,
  false,
  'A repeated Gmail scheduler run key is an idempotent no-op'
);
select is(
  public.service_finish_refund_gmail_sync(
    (select id from public.refund_gmail_sync_runs where run_key = 'scheduled:refund-gmail-test-1'),
    'succeeded',
    2,
    4,
    3,
    1,
    0,
    0,
    'history-1',
    null,
    null
  ),
  true,
  'A Gmail scheduler run records aggregate redacted completion evidence'
);
select is(
  public.get_refund_gmail_health() ->> 'status',
  'healthy',
  'An authorized refund manager sees healthy Gmail intake state'
);
select is(
  public.get_refund_gmail_health() ->> 'payloadRedacted',
  'true',
  'Gmail health output is explicitly aggregate-only and redacted'
);

update public.refund_gmail_attachments
set
  status = 'quarantined',
  storage_bucket = 'refund-gmail-quarantine',
  storage_path = 'synthetic/expired-receipt.pdf',
  retention_expires_at = now() - interval '1 minute';

select is(
  public.service_mark_refund_gmail_attachment(
    (select id from public.refund_gmail_attachments limit 1),
    'deleted',
    null,
    null,
    'retention_expired'
  ),
  true,
  'Retention cleanup can mark a quarantined attachment deleted'
);
select ok(
  (
    select provider_attachment_id like 'deleted-%'
      and file_name = '[Deleted after Gmail retention period]'
      and content_type = 'application/octet-stream'
      and byte_size = 0
      and storage_bucket is null
      and storage_path is null
    from public.refund_gmail_attachments
    limit 1
  ),
  'Deleted Gmail attachment metadata no longer retains provider IDs, filenames, types, sizes, or storage paths'
);

update public.refund_gmail_messages
set retention_expires_at = now() - interval '1 minute';
update public.refund_gmail_threads
set retention_expires_at = now() - interval '1 minute';

select is(
  public.service_purge_refund_gmail_expired_message_content(200),
  4,
  'Expired Gmail message content is purged in a bounded retention pass'
);
select ok(
  not exists (
    select 1
    from public.refund_gmail_messages
    where content_deleted_at is null
      or subject <> '[Deleted after Gmail retention period]'
      or plain_body <> '[Deleted after Gmail retention period]'
      or sender_email is not null
      or recipient_email is not null
  )
  and not exists (
    select 1
    from public.refund_gmail_threads
    where thread_subject <> '[Deleted after Gmail retention period]'
  ),
  'Expired Gmail messages and thread subjects no longer retain copied customer content'
);

select set_config('request.jwt.claim.sub', '', true);

select ok(
  pg_temp.capture_error('select public.admin_get_refund_gmail_draft_cases()') like '%Authentication required%',
  'Unauthenticated callers cannot read Gmail draft cases'
);
select ok(
  pg_temp.capture_error('select public.get_refund_gmail_health()') like '%Authentication required%',
  'Unauthenticated callers cannot read Gmail intake health'
);

select * from finish();
rollback;
