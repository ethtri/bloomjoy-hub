begin;

create extension if not exists pgtap with schema extensions;
set local search_path = public, extensions;

select no_plan();

create function pg_temp.capture_error(statement text)
returns text
language plpgsql
as $$
begin
  execute statement;
  return null;
exception
  when others then return sqlstate || ':' || sqlerrm;
end;
$$;

select has_table('public', 'refund_gmail_retention_settings', 'Default-off owner retention policy exists');
select has_table('public', 'refund_gmail_retention_runs', 'Aggregate cleanup run ledger exists');
select has_table('public', 'refund_gmail_quarantine_upload_intents', 'Durable pre-upload intent ledger exists');
select has_table('public', 'refund_gmail_retention_actions', 'Attachment outcome ledger exists');
select has_table('public', 'refund_gmail_retention_state', 'Cleanup health state exists');
select has_column('public', 'refund_gmail_threads', 'copied_at', 'Threads have a trusted local copy time');
select has_column('public', 'refund_gmail_messages', 'copied_at', 'Messages have a trusted local copy time');
select has_column('public', 'refund_gmail_attachments', 'copied_at', 'Attachments have a trusted local copy time');

select ok(
  not has_table_privilege('authenticated', 'public.refund_gmail_retention_runs', 'select'),
  'Browser sessions cannot read retention runs'
);
select ok(
  not has_table_privilege('service_role', 'public.refund_gmail_retention_actions', 'select'),
  'Service workers cannot bypass guarded retention action RPCs'
);
select ok(
  not has_table_privilege('service_role', 'public.refund_gmail_quarantine_upload_intents', 'select'),
  'Service workers cannot bypass guarded pre-upload intent RPCs'
);
select ok(
  not has_table_privilege('service_role', 'public.refund_gmail_attachments', 'update'),
  'Service workers cannot finalize attachment metadata directly'
);
select ok(
  not has_function_privilege(
    'authenticated',
    'public.service_claim_refund_gmail_retention_run(text,text,boolean,text)',
    'execute'
  ),
  'Browser sessions cannot claim cleanup runs'
);
select ok(
  has_function_privilege(
    'service_role',
    'public.service_claim_refund_gmail_retention_run(text,text,boolean,text)',
    'execute'
  ),
  'Only the service worker can claim cleanup runs'
);
select ok(
  has_function_privilege(
    'service_role',
    'public.service_reserve_refund_gmail_attachment_upload(uuid)',
    'execute'
  ),
  'The service worker can reserve one DB-derived upload target'
);
select ok(
  has_function_privilege(
    'service_role',
    'public.service_settle_refund_gmail_attachment_upload(uuid,uuid,text)',
    'execute'
  ),
  'The service worker can settle one token-bound upload outcome'
);
select ok(
  not has_function_privilege(
    'service_role',
    'public.service_mark_refund_gmail_attachment(uuid,text,text,text,text)',
    'execute'
  ),
  'The legacy caller-supplied attachment target RPC is revoked'
);
select ok(
  has_function_privilege(
    'service_role',
    'public.service_settle_refund_gmail_retention_attachment(uuid,uuid,text)',
    'execute'
  ),
  'The service worker can settle claimed byte-deletion outcomes'
);
select ok(
  has_function_privilege(
    'service_role',
    'public.service_authorize_refund_gmail_copy(boolean,text,boolean,text)',
    'execute'
  ),
  'The service worker can invoke the pre-copy safety gate'
);
select ok(
  not has_function_privilege(
    'service_role',
    'public.service_list_refund_gmail_expired_attachments(integer)',
    'execute'
  ),
  'The legacy unclaimed attachment-list deletion path is revoked'
);
select ok(
  not has_function_privilege(
    'service_role',
    'public.service_purge_refund_gmail_expired_message_content(integer)',
    'execute'
  ),
  'The legacy unclaimed message purge is revoked'
);
select ok(
  (
    select constraint_row.convalidated
    from pg_catalog.pg_constraint constraint_row
    where constraint_row.conrelid = 'public.refund_gmail_sync_runs'::regclass
      and constraint_row.conname = 'refund_gmail_sync_runs_trigger_key_check'
  ),
  'The exact sync trigger/run-key constraint validates every legacy row'
);

select is(
  (select cleanup_enabled from public.refund_gmail_retention_settings where singleton),
  false,
  'Production cleanup policy defaults off'
);
select is(
  (select approved_retention_days from public.refund_gmail_retention_settings where singleton),
  null,
  'The proposed 180-day duration is not silently owner-approved'
);
select is(
  (select attachment_quarantine_approved from public.refund_gmail_retention_settings where singleton),
  false,
  'Attachment quarantine/scanner policy defaults unapproved'
);
select ok(
  pg_temp.capture_error($capture$
    select public.service_claim_refund_gmail_retention_run(
      'customer@example.test', 'retention', true, 'refund_gmail_retention_v1'
    )
  $capture$) like '%Valid trigger-bound retention run key required%',
  'Caller-supplied addresses cannot enter the retention run-key ledger'
);
select ok(
  pg_temp.capture_error($capture$
    select public.service_claim_refund_gmail_retention_run(
      '550e8400-e29b-41d4-a716-446655440000', 'retention', true, 'refund_gmail_retention_v1'
    )
  $capture$) like '%Valid trigger-bound retention run key required%',
  'Generic UUID run keys are rejected'
);
select ok(
  pg_temp.capture_error($capture$
    select public.service_claim_refund_gmail_retention_run(
      'RF-2026-000123', 'retention', true, 'refund_gmail_retention_v1'
    )
  $capture$) like '%Valid trigger-bound retention run key required%',
  'Refund references cannot enter the run ledger'
);
select ok(
  pg_temp.capture_error($capture$
    select public.service_claim_refund_gmail_retention_run(
      '18c7aProviderMessageToken', 'retention', true, 'refund_gmail_retention_v1'
    )
  $capture$) like '%Valid trigger-bound retention run key required%',
  'Provider-like alphanumeric identifiers cannot enter the run ledger'
);
select ok(
  pg_temp.capture_error($capture$
    select public.service_claim_refund_gmail_retention_run(
      '18005551212', 'retention', true, 'refund_gmail_retention_v1'
    )
  $capture$) like '%Valid trigger-bound retention run key required%',
  'Digit and phone-like values cannot enter the run ledger'
);
select ok(
  pg_temp.capture_error($capture$
    select public.service_claim_refund_gmail_retention_run(
      'retention:github-manual:1000:1', 'retention', true, 'refund_gmail_retention_v1'
    )
  $capture$) like '%Valid trigger-bound retention run key required%',
  'A wrong trigger prefix is rejected by the retention SQL boundary'
);
select ok(
  pg_temp.capture_error($capture$
    select public.service_start_refund_gmail_sync(
      'github-scheduled:1000:1', 'manual', clock_timestamp(), repeat('a', 64), repeat('b', 64), false
    )
  $capture$) like '%Valid trigger-bound Gmail sync run key required%',
  'The SQL sync boundary independently rejects a trigger/key mismatch'
);

create temporary table default_off_run as
select public.service_claim_refund_gmail_retention_run(
  'retention:github-retention:1001:1',
  'retention',
  true,
  'refund_gmail_retention_v1'
) as result;

select is(
  (select result ->> 'status' from default_off_run),
  'suppressed',
  'Cleanup is suppressed until the owner policy is approved'
);
select is(
  (select failure_code from public.refund_gmail_retention_runs where run_key = 'retention:github-retention:1001:1'),
  'retention_policy_not_approved',
  'Default-off suppression stores only a redacted reason code'
);
select is(
  (
    public.service_claim_refund_gmail_retention_run(
      'retention:github-retention:1001:1', 'retention', true, 'refund_gmail_retention_v1'
    ) ->> 'claimed'
  )::boolean,
  false,
  'Replaying a suppressed run key is an idempotent no-op'
);
select is(
  (select count(*)::integer from public.refund_gmail_retention_runs where run_key = 'retention:github-retention:1001:1'),
  1,
  'A replay creates one durable run row'
);
select is(
  (select count(*)::integer from public.refund_gmail_retention_actions),
  0,
  'A manual retention dispatch while runtime policy is off cannot claim or delete content'
);

update public.refund_gmail_retention_settings
set
  cleanup_enabled = true,
  approved_retention_days = 180,
  owner_approved_at = clock_timestamp(),
  attachment_quarantine_approved = true,
  scanner_version = 'scanner-v1'
where singleton;

select is(
  public.service_claim_refund_gmail_retention_run(
    'retention:github-retention:1002:1',
    'retention',
    true,
    'unsafe@example.test'
  ) ->> 'errorCode',
  'retention_policy_version_mismatch',
  'A caller policy mismatch fails closed with a redacted code'
);
select is(
  (
    select policy_version
    from public.refund_gmail_retention_runs
    where run_key = 'retention:github-retention:1002:1'
  ),
  'refund_gmail_retention_v1',
  'A policy mismatch persists only the configured policy version'
);
select ok(
  not exists (
    select 1
    from public.refund_gmail_retention_runs
    where run_key like '%@%'
      or policy_version like '%@%'
      or coalesce(failure_code, '') like '%@%'
  ),
  'Retention ledgers reject caller addresses and arbitrary policy text'
);

create temporary table success_ingest as
select public.service_ingest_refund_gmail_message_v2(
  repeat('d', 64),
  'retention-success-thread',
  'retention-success-message',
  '<retention-success-message@example.test>',
  null,
  'inbound',
  false,
  'retention-customer@example.test',
  'Synthetic Customer',
  'info@bloomjoysweets.com',
  'Synthetic retention request',
  'Synthetic retention-only fixture.',
  false,
  clock_timestamp(),
  null,
  jsonb_build_array(jsonb_build_object(
    'providerAttachmentId', 'retention-success-attachment',
    'fileName', 'synthetic.pdf',
    'contentType', 'application/pdf',
    'byteSize', 128,
    'disposition', 'attachment',
    'allowed', true,
    'rejectionCode', null
  )),
  '{}'::text[],
  array['info@bloomjoysweets.com', 'support@bloomjoysweets.com'],
  'direct_human',
  false,
  false,
  '{}'::text[]
) as result;

create temporary table success_upload_intent as
select public.service_reserve_refund_gmail_attachment_upload(
  ((select result from success_ingest) -> 'attachments' -> 0 ->> 'attachmentId')::uuid
) as result;
select is(
  (select (result ->> 'claimed')::boolean from success_upload_intent),
  true,
  'The database durably reserves an attachment target before Storage transport'
);
select is(
  (select result ->> 'storageBucket' from success_upload_intent),
  'refund-gmail-quarantine',
  'The upload reservation fixes the exact quarantine bucket'
);
select is(
  (select result ->> 'storagePath' from success_upload_intent),
  public.refund_gmail_quarantine_path(
    ((select result from success_ingest) ->> 'caseId')::uuid,
    ((select result from success_ingest) ->> 'messageId')::uuid,
    ((select result from success_ingest) -> 'attachments' -> 0 ->> 'attachmentId')::uuid,
    'pdf'
  ),
  'The upload path is derived only from database UUID linkage'
);
select is(
  public.service_settle_refund_gmail_attachment_upload(
    ((select result from success_upload_intent) ->> 'intentId')::uuid,
    ((select result from success_upload_intent) ->> 'claimToken')::uuid,
    'upload_failed'
  ) ->> 'status',
  'upload_failed',
  'An explicit upload failure settles without discarding its reserved coordinates'
);
select ok(
  pg_temp.capture_error(format(
    'update public.refund_gmail_attachments set storage_bucket = %L where id = %L::uuid',
    'another-bucket',
    ((select result from success_ingest) -> 'attachments' -> 0 ->> 'attachmentId')
  )) like '%refund_gmail_attachments_quarantine_location_check%',
  'Even owner-level corrupt metadata cannot redirect a new attachment to another bucket'
);
select ok(
  pg_temp.capture_error(format(
    'update public.refund_gmail_quarantine_upload_intents set storage_path = %L where id = %L::uuid',
    'another/object.pdf',
    ((select result from success_upload_intent) ->> 'intentId')
  )) like '%refund_gmail_quarantine_upload_intents_target_check%',
  'The durable intent cannot be redirected to a caller-shaped path'
);

create temporary table trusted_copy_time as
select copied_at
from public.refund_gmail_attachments
where id = ((select result from success_ingest) -> 'attachments' -> 0 ->> 'attachmentId')::uuid;
update public.refund_gmail_attachments
set copied_at = clock_timestamp() - interval '181 days'
where id = ((select result from success_ingest) -> 'attachments' -> 0 ->> 'attachmentId')::uuid;
select is(
  (
    select copied_at
    from public.refund_gmail_attachments
    where id = ((select result from success_ingest) -> 'attachments' -> 0 ->> 'attachmentId')::uuid
  ),
  (select copied_at from trusted_copy_time),
  'The local copied timestamp cannot be moved by an ordinary update'
);

alter table public.refund_gmail_threads disable trigger refund_gmail_threads_preserve_copied_at;
alter table public.refund_gmail_messages disable trigger refund_gmail_messages_preserve_copied_at;
alter table public.refund_gmail_attachments disable trigger refund_gmail_attachments_preserve_copied_at;
update public.refund_gmail_threads
set copied_at = clock_timestamp() - interval '181 days'
where provider_thread_id = 'retention-success-thread';
update public.refund_gmail_messages
set copied_at = clock_timestamp() - interval '181 days'
where provider_message_id = 'retention-success-message';
update public.refund_gmail_attachments
set copied_at = clock_timestamp() - interval '181 days'
where provider_attachment_id = 'retention-success-attachment';
alter table public.refund_gmail_threads enable trigger refund_gmail_threads_preserve_copied_at;
alter table public.refund_gmail_messages enable trigger refund_gmail_messages_preserve_copied_at;
alter table public.refund_gmail_attachments enable trigger refund_gmail_attachments_preserve_copied_at;

create temporary table first_cleanup_run as
select public.service_claim_refund_gmail_retention_run(
  'retention:github-retention:1003:1', 'retention', true, 'refund_gmail_retention_v1'
) as result;
select is(
  (select (result ->> 'claimed')::boolean from first_cleanup_run),
  true,
  'An approved retention worker claims one cleanup run'
);
select is(
  (
    public.service_claim_refund_gmail_retention_run(
      'retention:github-retention:1003:1', 'retention', true, 'refund_gmail_retention_v1'
    ) ->> 'claimed'
  )::boolean,
  false,
  'A duplicate active run key does not claim twice'
);
select is(
  public.service_claim_refund_gmail_retention_run(
    'retention:github-retention:1004:1', 'retention', true, 'refund_gmail_retention_v1'
  ) ->> 'errorCode',
  'cleanup_already_running',
  'A different concurrent run is suppressed by the singleton lease'
);

create temporary table first_delete_claim as
select public.service_claim_refund_gmail_retention_attachment(
  ((select result from first_cleanup_run) ->> 'runId')::uuid,
  ((select result from first_cleanup_run) ->> 'claimToken')::uuid
) as result;
select is(
  (select (result ->> 'claimed')::boolean from first_delete_claim),
  true,
  'The due quarantined byte receives one deletion claim'
);
select is(
  public.service_settle_refund_gmail_retention_attachment(
    ((select result from first_delete_claim) ->> 'actionId')::uuid,
    ((select result from first_delete_claim) ->> 'claimToken')::uuid,
    'delete_failed'
  ) ->> 'status',
  'retry_required',
  'An explicit storage failure is retryable'
);
select is(
  (
    select storage_path
    from public.refund_gmail_attachments
    where provider_attachment_id = 'retention-success-attachment'
  ),
  public.refund_gmail_quarantine_path(
    ((select result from success_ingest) ->> 'caseId')::uuid,
    ((select result from success_ingest) ->> 'messageId')::uuid,
    ((select result from success_ingest) -> 'attachments' -> 0 ->> 'attachmentId')::uuid,
    'pdf'
  ),
  'A failed byte delete leaves quarantine metadata intact'
);
select is(
  public.service_settle_refund_gmail_retention_run(
    ((select result from first_cleanup_run) ->> 'runId')::uuid,
    ((select result from first_cleanup_run) ->> 'claimToken')::uuid,
    'retry_required',
    'storage_delete_failed'
  ) ->> 'status',
  'retry_required',
  'The failed-byte run cannot report healthy'
);

update public.refund_gmail_retention_actions
set retry_after = clock_timestamp() - interval '1 minute'
where status = 'delete_failed';

create temporary table retry_cleanup_run as
select public.service_claim_refund_gmail_retention_run(
  'retention:github-retention:1005:1', 'retention', true, 'refund_gmail_retention_v1'
) as result;
select is(
  (select (result ->> 'claimed')::boolean from retry_cleanup_run),
  true,
  'A new scheduler attempt can retry a confirmed storage failure'
);
create temporary table retry_delete_claim as
select public.service_claim_refund_gmail_retention_attachment(
  ((select result from retry_cleanup_run) ->> 'runId')::uuid,
  ((select result from retry_cleanup_run) ->> 'claimToken')::uuid
) as result;
select is(
  (select (result ->> 'claimed')::boolean from retry_delete_claim),
  true,
  'The confirmed failed byte receives a later retry claim'
);
select is(
  public.service_settle_refund_gmail_retention_attachment(
    ((select result from retry_delete_claim) ->> 'actionId')::uuid,
    ((select result from retry_delete_claim) ->> 'claimToken')::uuid,
    'deleted'
  ) ->> 'status',
  'deleted',
  'Exact external delete success settles the claimed byte once'
);
select ok(
  exists (
    select 1
    from public.refund_gmail_attachments
    where id = ((select result from success_ingest) -> 'attachments' -> 0 ->> 'attachmentId')::uuid
      and storage_bucket is null
      and storage_path is null
      and provider_attachment_id like 'retention-deleted:%'
      and file_name = '[Deleted after Gmail retention period]'
      and byte_size = 0
      and status = 'deleted'
      and deleted_at is not null
  ),
  'Only successful byte settlement clears and redacts attachment metadata'
);
select is(
  public.service_purge_refund_gmail_retention_content(
    ((select result from retry_cleanup_run) ->> 'runId')::uuid,
    ((select result from retry_cleanup_run) ->> 'claimToken')::uuid,
    200
  ) ->> 'status',
  'purged',
  'Message content purges only after every due attachment byte is settled'
);
select ok(
  exists (
    select 1
    from public.refund_gmail_messages
    where id = ((select result from success_ingest) ->> 'messageId')::uuid
      and sender_email is null
      and recipient_email is null
      and cardinality(recipient_cc_emails) = 0
      and provider_message_id is null
      and content_deleted_at is not null
  ),
  'Expired copied message content, addresses, recipients, and provider message ID are removed'
);
select is(
  public.service_settle_refund_gmail_retention_run(
    ((select result from retry_cleanup_run) ->> 'runId')::uuid,
    ((select result from retry_cleanup_run) ->> 'claimToken')::uuid,
    'succeeded',
    null
  ) ->> 'status',
  'succeeded',
  'Known-success settlement reconciles the prior explicit failure and permits healthy completion'
);
select ok(
  exists (
    select 1
    from public.refund_gmail_retention_actions failed
    where failed.gmail_attachment_id =
      ((select result from success_ingest) -> 'attachments' -> 0 ->> 'attachmentId')::uuid
      and failed.status = 'deleted'
      and failed.reconciled_by_action_id is not null
  ),
  'The prior explicit failure remains auditable and points to its known-success reconciliation'
);

-- Simulate Storage accepting an upload and the worker stopping before it can
-- settle the upload RPC. No Gmail/provider configuration is present or used.
create temporary table crash_ingest as
select public.service_ingest_refund_gmail_message_v2(
  repeat('d', 64),
  'retention-crash-thread',
  'retention-crash-message',
  '<retention-crash-message@example.test>',
  null,
  'inbound',
  false,
  'retention-crash-customer@example.test',
  'Synthetic Customer',
  'info@bloomjoysweets.com',
  'Synthetic accepted upload crash',
  'Synthetic accepted-before-settle fixture.',
  false,
  clock_timestamp(),
  null,
  jsonb_build_array(jsonb_build_object(
    'providerAttachmentId', 'retention-crash-attachment',
    'fileName', 'synthetic-crash.pdf',
    'contentType', 'application/pdf',
    'byteSize', 192,
    'disposition', 'attachment',
    'allowed', true,
    'rejectionCode', null
  )),
  '{}'::text[],
  array['info@bloomjoysweets.com', 'support@bloomjoysweets.com'],
  'direct_human',
  false,
  false,
  '{}'::text[]
) as result;
create temporary table crash_upload_intent as
select public.service_reserve_refund_gmail_attachment_upload(
  ((select result from crash_ingest) -> 'attachments' -> 0 ->> 'attachmentId')::uuid
) as result;
select is(
  current_setting('app.refund_gmail_provider_config', true),
  null,
  'Accepted-upload crash recovery fixture has no Gmail configuration'
);
select is(
  (
    select status
    from public.refund_gmail_quarantine_upload_intents
    where id = ((select result from crash_upload_intent) ->> 'intentId')::uuid
  ),
  'reserved',
  'A crash before upload settlement leaves a durable tokenized intent'
);

alter table public.refund_gmail_messages disable trigger refund_gmail_messages_preserve_copied_at;
alter table public.refund_gmail_attachments disable trigger refund_gmail_attachments_preserve_copied_at;
update public.refund_gmail_messages
set copied_at = clock_timestamp() - interval '181 days'
where provider_message_id = 'retention-crash-message';
update public.refund_gmail_attachments
set copied_at = clock_timestamp() - interval '181 days'
where provider_attachment_id = 'retention-crash-attachment';
alter table public.refund_gmail_messages enable trigger refund_gmail_messages_preserve_copied_at;
alter table public.refund_gmail_attachments enable trigger refund_gmail_attachments_preserve_copied_at;

create temporary table crash_cleanup_run as
select public.service_claim_refund_gmail_retention_run(
  'retention:github-retention:1010:1', 'retention', true, 'refund_gmail_retention_v1'
) as result;
create temporary table crash_delete_claim as
select public.service_claim_refund_gmail_retention_attachment(
  ((select result from crash_cleanup_run) ->> 'runId')::uuid,
  ((select result from crash_cleanup_run) ->> 'claimToken')::uuid
) as result;
select is(
  (select result ->> 'storagePath' from crash_delete_claim),
  (select result ->> 'storagePath' from crash_upload_intent),
  'Retention recovers the exact pre-recorded target without Gmail access'
);
select is(
  public.service_purge_refund_gmail_retention_content(
    ((select result from crash_cleanup_run) ->> 'runId')::uuid,
    ((select result from crash_cleanup_run) ->> 'claimToken')::uuid,
    200
  ) ->> 'status',
  'purged',
  'Per-message purge completes while the crash-held message remains protected'
);
select ok(
  exists (
    select 1
    from public.refund_gmail_messages
    where id = ((select result from crash_ingest) ->> 'messageId')::uuid
      and content_deleted_at is null
  ),
  'Crash-held message metadata cannot purge before exact byte deletion settles'
);
select is(
  public.service_settle_refund_gmail_retention_attachment(
    ((select result from crash_delete_claim) ->> 'actionId')::uuid,
    ((select result from crash_delete_claim) ->> 'claimToken')::uuid,
    'deleted'
  ) ->> 'status',
  'deleted',
  'Exact local-byte deletion settles the crash-held intent'
);
select is(
  (
    select status
    from public.refund_gmail_quarantine_upload_intents
    where id = ((select result from crash_upload_intent) ->> 'intentId')::uuid
  ),
  'deleted',
  'Known byte deletion finalizes the durable upload intent'
);
select ok(
  exists (
    select 1
    from public.refund_gmail_quarantine_upload_intents
    where id = ((select result from crash_upload_intent) ->> 'intentId')::uuid
      and storage_bucket is null
      and storage_path is null
  ),
  'Intent coordinates clear only after exact local-byte deletion'
);
select is(
  public.service_purge_refund_gmail_retention_content(
    ((select result from crash_cleanup_run) ->> 'runId')::uuid,
    ((select result from crash_cleanup_run) ->> 'claimToken')::uuid,
    200
  ) ->> 'status',
  'purged',
  'Crash-held message becomes purgeable only after byte settlement'
);
select ok(
  exists (
    select 1
    from public.refund_gmail_messages
    where id = ((select result from crash_ingest) ->> 'messageId')::uuid
      and content_deleted_at is not null
  ),
  'Crash-held copied message content purges after its exact byte is settled'
);
select is(
  public.service_settle_refund_gmail_retention_run(
    ((select result from crash_cleanup_run) ->> 'runId')::uuid,
    ((select result from crash_cleanup_run) ->> 'claimToken')::uuid,
    'succeeded',
    null
  ) ->> 'status',
  'succeeded',
  'Provider-independent crash recovery can complete healthy'
);

create temporary table healthy_cleanup_run as
select public.service_claim_refund_gmail_retention_run(
  'retention:github-retention:1006:1', 'retention', true, 'refund_gmail_retention_v1'
) as result;
select is(
  public.service_purge_refund_gmail_retention_content(
    ((select result from healthy_cleanup_run) ->> 'runId')::uuid,
    ((select result from healthy_cleanup_run) ->> 'claimToken')::uuid,
    200
  ) ->> 'status',
  'purged',
  'A clean follow-up run confirms no copied content remains due'
);
select is(
  public.service_settle_refund_gmail_retention_run(
    ((select result from healthy_cleanup_run) ->> 'runId')::uuid,
    ((select result from healthy_cleanup_run) ->> 'claimToken')::uuid,
    'succeeded',
    null
  ) ->> 'status',
  'succeeded',
  'A clean run can report healthy after known-success reconciliation'
);
select is(
  public.service_authorize_refund_gmail_copy(
    true, 'refund_gmail_retention_v1', false, 'scanner-v1'
  ) ->> 'status',
  'attachment_scanner_not_approved',
  'Missing scanner enablement blocks every new local copy'
);
select is(
  (
    public.service_authorize_refund_gmail_copy(
      true, 'refund_gmail_retention_v1', true, 'scanner-v1'
    ) ->> 'allowed'
  )::boolean,
  true,
  'Owner policy, fresh cleanup, and exact scanner version authorize copying'
);
select is(
  (
    public.service_claim_refund_gmail_retention_run(
      'retention:github-retention:1006:1', 'retention', true, 'refund_gmail_retention_v1'
    ) ->> 'claimed'
  )::boolean,
  false,
  'A completed scheduler key replays without another cleanup'
);
select is(
  (select count(*)::integer from public.refund_gmail_retention_runs where run_key = 'retention:github-retention:1006:1'),
  1,
  'Completed replay retains exactly one run row'
);

update public.refund_gmail_retention_state
set last_success_at = clock_timestamp() - interval '27 hours'
where singleton;
select is(
  public.service_authorize_refund_gmail_copy(
    true, 'refund_gmail_retention_v1', true, 'scanner-v1'
  ) ->> 'status',
  'cleanup_overdue',
  'An approved but overdue cleanup blocks new Gmail copies'
);

create temporary table unknown_ingest as
select public.service_ingest_refund_gmail_message_v2(
  repeat('d', 64),
  'retention-unknown-thread',
  'retention-unknown-message',
  '<retention-unknown-message@example.test>',
  null,
  'inbound',
  false,
  'retention-unknown-customer@example.test',
  'Synthetic Customer',
  'info@bloomjoysweets.com',
  'Synthetic unknown retention request',
  'Synthetic unknown-outcome fixture.',
  false,
  clock_timestamp(),
  null,
  jsonb_build_array(jsonb_build_object(
    'providerAttachmentId', 'retention-unknown-attachment',
    'fileName', 'synthetic-unknown.pdf',
    'contentType', 'application/pdf',
    'byteSize', 256,
    'disposition', 'attachment',
    'allowed', true,
    'rejectionCode', null
  )),
  '{}'::text[],
  array['info@bloomjoysweets.com', 'support@bloomjoysweets.com'],
  'direct_human',
  false,
  false,
  '{}'::text[]
) as result;
create temporary table unknown_upload_intent as
select public.service_reserve_refund_gmail_attachment_upload(
  ((select result from unknown_ingest) -> 'attachments' -> 0 ->> 'attachmentId')::uuid
) as result;
select is(
  public.service_settle_refund_gmail_attachment_upload(
    ((select result from unknown_upload_intent) ->> 'intentId')::uuid,
    ((select result from unknown_upload_intent) ->> 'claimToken')::uuid,
    'uploaded'
  ) ->> 'status',
  'uploaded',
  'The isolation fixture starts with one exact quarantined object'
);

create temporary table storage_free_ingest as
select public.service_ingest_refund_gmail_message_v2(
  repeat('d', 64),
  'retention-storage-free-thread',
  'retention-storage-free-message',
  '<retention-storage-free-message@example.test>',
  null,
  'inbound',
  false,
  'retention-storage-free-customer@example.test',
  'Synthetic Customer',
  'info@bloomjoysweets.com',
  'Synthetic storage-free retention request',
  'Synthetic unrelated storage-free fixture.',
  false,
  clock_timestamp(),
  null,
  jsonb_build_array(jsonb_build_object(
    'providerAttachmentId', 'retention-storage-free-attachment',
    'fileName', 'synthetic-rejected.txt',
    'contentType', 'text/plain',
    'byteSize', 64,
    'disposition', 'attachment',
    'allowed', false,
    'rejectionCode', 'attachment_type_rejected'
  )),
  '{}'::text[],
  array['info@bloomjoysweets.com', 'support@bloomjoysweets.com'],
  'direct_human',
  false,
  false,
  '{}'::text[]
) as result;
select ok(
  public.service_record_refund_gmail_attachment_not_uploaded(
    ((select result from storage_free_ingest) -> 'attachments' -> 0 ->> 'attachmentId')::uuid,
    'rejected',
    'attachment_type_rejected'
  ),
  'The unrelated rejected attachment is provably storage-free'
);
select is(
  (
    select count(*)::integer
    from public.refund_gmail_quarantine_upload_intents
    where gmail_attachment_id =
      ((select result from storage_free_ingest) -> 'attachments' -> 0 ->> 'attachmentId')::uuid
  ),
  0,
  'Known-not-uploaded evidence has no Storage intent or coordinates'
);

select ok(
  not public.service_record_refund_gmail_attachment_not_uploaded(
    ((select result from unknown_ingest) -> 'attachments' -> 0 ->> 'attachmentId')::uuid,
    'error',
    'attachment_quarantine_failed'
  ),
  'The storage-free marker cannot clear or rewrite an existing upload intent'
);
alter table public.refund_gmail_messages disable trigger refund_gmail_messages_preserve_copied_at;
alter table public.refund_gmail_attachments disable trigger refund_gmail_attachments_preserve_copied_at;
update public.refund_gmail_messages
set copied_at = clock_timestamp() - interval '181 days'
where provider_message_id in ('retention-unknown-message', 'retention-storage-free-message');
update public.refund_gmail_attachments
set copied_at = clock_timestamp() - interval '181 days'
where provider_attachment_id in ('retention-unknown-attachment', 'retention-storage-free-attachment');
alter table public.refund_gmail_messages enable trigger refund_gmail_messages_preserve_copied_at;
alter table public.refund_gmail_attachments enable trigger refund_gmail_attachments_preserve_copied_at;

create temporary table unknown_cleanup_run as
select public.service_claim_refund_gmail_retention_run(
  'retention:github-retention:1007:1', 'retention', true, 'refund_gmail_retention_v1'
) as result;
create temporary table unknown_delete_claim as
select public.service_claim_refund_gmail_retention_attachment(
  ((select result from unknown_cleanup_run) ->> 'runId')::uuid,
  ((select result from unknown_cleanup_run) ->> 'claimToken')::uuid
) as result;
select is(
  public.service_settle_refund_gmail_retention_attachment(
    ((select result from unknown_delete_claim) ->> 'actionId')::uuid,
    ((select result from unknown_delete_claim) ->> 'claimToken')::uuid,
    'delete_unknown'
  ) ->> 'status',
  'manual_review',
  'An uncertain provider outcome enters durable manual review'
);
select is(
  (
    select storage_path
    from public.refund_gmail_attachments
    where provider_attachment_id = 'retention-unknown-attachment'
  ),
  (select result ->> 'storagePath' from unknown_upload_intent),
  'Unknown deletion never finalizes object metadata'
);
select is(
  public.service_purge_refund_gmail_retention_content(
    ((select result from unknown_cleanup_run) ->> 'runId')::uuid,
    ((select result from unknown_cleanup_run) ->> 'claimToken')::uuid,
    200
  ) ->> 'status',
  'purged',
  'An unknown attachment does not block unrelated safe purge work'
);
select ok(
  exists (
    select 1
    from public.refund_gmail_attachments attachment
    join public.refund_gmail_messages message
      on message.id = attachment.gmail_message_id
    where attachment.id =
        ((select result from unknown_ingest) -> 'attachments' -> 0 ->> 'attachmentId')::uuid
      and attachment.deleted_at is null
      and attachment.storage_path = (select result ->> 'storagePath' from unknown_upload_intent)
      and message.content_deleted_at is null
  ),
  'The unknown object preserves only its own attachment and message metadata'
);
select ok(
  exists (
    select 1
    from public.refund_gmail_attachments attachment
    join public.refund_gmail_messages message
      on message.id = attachment.gmail_message_id
    where attachment.id =
        ((select result from storage_free_ingest) -> 'attachments' -> 0 ->> 'attachmentId')::uuid
      and attachment.deleted_at is not null
      and message.content_deleted_at is not null
      and message.provider_message_id is null
  ),
  'The unrelated due storage-free attachment and message purge in the same run'
);
select is(
  public.service_settle_refund_gmail_retention_run(
    ((select result from unknown_cleanup_run) ->> 'runId')::uuid,
    ((select result from unknown_cleanup_run) ->> 'claimToken')::uuid,
    'manual_review',
    'storage_delete_outcome_unknown'
  ) ->> 'status',
  'manual_review',
  'Unknown outcome makes the cleanup run unhealthy'
);
select is(
  public.service_get_refund_gmail_retention_health() ->> 'status',
  'manual_review',
  'Aggregate cleanup health visibly holds manual review'
);
select is(
  (public.service_get_refund_gmail_retention_health() ->> 'unresolvedManualReviewCount')::integer,
  1,
  'Aggregate health reports one unresolved hold without identifiers'
);
select is(
  public.service_authorize_refund_gmail_copy(
    true, 'refund_gmail_retention_v1', true, 'scanner-v1'
  ) ->> 'status',
  'cleanup_unhealthy',
  'The durable unknown-outcome hold blocks new Gmail copies'
);

create temporary table later_cleanup_run as
select public.service_claim_refund_gmail_retention_run(
  'retention:github-retention:1008:1', 'retention', true, 'refund_gmail_retention_v1'
) as result;
select is(
  (
    public.service_claim_refund_gmail_retention_attachment(
      ((select result from later_cleanup_run) ->> 'runId')::uuid,
      ((select result from later_cleanup_run) ->> 'claimToken')::uuid
    ) ->> 'claimed'
  )::boolean,
  false,
  'A later cleanup cannot blindly retry an unknown deletion outcome'
);
select is(
  public.service_settle_refund_gmail_retention_run(
    ((select result from later_cleanup_run) ->> 'runId')::uuid,
    ((select result from later_cleanup_run) ->> 'claimToken')::uuid,
    'succeeded',
    null
  ) ->> 'status',
  'manual_review',
  'A later empty run cannot mask an older manual-review hold as healthy'
);
select is(
  public.service_get_refund_gmail_retention_health() ->> 'status',
  'manual_review',
  'Manual-review health remains durable across later scheduler runs'
);
select ok(
  public.service_get_refund_gmail_retention_health() ?& array[
    'status', 'lastAttemptAt', 'lastSuccessAt', 'consecutiveFailures',
    'attachmentsDeleted', 'attachmentsRetryRequired', 'attachmentsManualReview',
    'unresolvedManualReviewCount', 'unresolvedRetryRequiredCount',
    'attachmentMetadataPurged', 'messagesPurged', 'errorCode', 'payloadRedacted'
  ],
  'Health exposes only the documented aggregate key set'
);
select ok(
  not (
    public.service_get_refund_gmail_retention_health()::text ~
      '(example\\.test|synthetic/|retention-unknown-attachment|refund-gmail-quarantine)'
  ),
  'Health contains no addresses, object keys, attachment names, or provider identifiers'
);

select * from finish();
rollback;
