begin;
select plan(78);

select has_table(
  'public',
  'refund_gmail_intake_shadow_dispatch_authorizations',
  'Gmail intake shadow has an owner-armed exact-run dispatch ledger'
);
select has_table(
  'public',
  'refund_gmail_intake_shadow_dispatch_control',
  'Gmail intake shadow has a durable global recovery epoch'
);
select ok(
  (select relrowsecurity
   from pg_catalog.pg_class relation
   join pg_catalog.pg_namespace namespace on namespace.oid = relation.relnamespace
   where namespace.nspname = 'public'
     and relation.relname = 'refund_gmail_intake_shadow_dispatch_control')
  and not has_table_privilege(
    'service_role',
    'public.refund_gmail_intake_shadow_dispatch_control',
    'select'
  )
  and not has_table_privilege(
    'authenticated',
    'public.refund_gmail_intake_shadow_dispatch_control',
    'select'
  ),
  'Recovery epoch state is RLS-enabled and unavailable to service or authenticated roles'
);

select has_table(
  'public',
  'refund_gmail_intake_shadow_notices',
  'Gmail intake shadow has an exact-run evidence ledger'
);
select has_table(
  'public',
  'refund_gmail_intake_shadow_cleanup_obligations',
  'Gmail intake shadow has a separate PII-free cleanup obligation ledger'
);
select has_function(
  'public',
  'service_preflight_refund_gmail_intake_shadow',
  array['boolean', 'text', 'boolean', 'boolean', 'text'],
  'Gmail intake shadow has a dedicated DB safety preflight'
);
select has_function(
  'public',
  'owner_authorize_refund_gmail_intake_shadow_dispatch',
  array['text', 'text', 'timestamp with time zone'],
  'The owner has one fixed dispatch-authorization boundary'
);
select has_function(
  'public',
  'owner_cancel_refund_gmail_intake_shadow_dispatch',
  array['text'],
  'The owner has one fixed dispatch-cancellation boundary'
);
select has_function(
  'public',
  'owner_recover_expired_refund_gmail_intake_shadow_dispatches',
  array[]::text[],
  'The owner has one no-target expired-dispatch recovery boundary'
);
select has_function(
  'public',
  'owner_complete_due_refund_gmail_intake_shadow_cleanup',
  array['uuid'],
  'The owner has one verified cleanup-obligation completion boundary'
);
select has_function(
  'public',
  'service_complete_refund_gmail_intake_shadow',
  array['uuid', 'uuid', 'uuid'],
  'Gmail intake shadow has one atomic exact-run completion boundary'
);
select hasnt_function(
  'public',
  'service_record_refund_gmail_intake_shadow_notice',
  array['uuid', 'uuid'],
  'The superseded caller-trusted notice recorder is absent'
);
select hasnt_function(
  'public',
  'service_record_refund_gmail_intake_shadow_first_contact',
  array['uuid', 'text'],
  'The superseded caller-trusted first-contact recorder is absent'
);
select function_privs_are(
  'public',
  'service_complete_refund_gmail_intake_shadow',
  array['uuid', 'uuid', 'uuid'],
  'service_role',
  array['EXECUTE'],
  'Only the service role can complete an exact intake-shadow run'
);
select ok(
  not has_function_privilege(
    'service_role',
    'public.refund_gmail_workflow_run_key_is_valid(text,text)',
    'execute'
  )
  and not has_function_privilege(
    'authenticated',
    'public.service_start_refund_gmail_sync(text,text,timestamptz,text,text,boolean)',
    'execute'
  )
  and has_function_privilege(
    'service_role',
    'public.service_start_refund_gmail_sync(text,text,timestamptz,text,text,boolean)',
    'execute'
  )
  and not has_function_privilege(
    'service_role',
    'public.owner_authorize_refund_gmail_intake_shadow_dispatch(text,text,timestamptz)',
    'execute'
  )
  and not has_function_privilege(
    'service_role',
    'public.owner_cancel_refund_gmail_intake_shadow_dispatch(text)',
    'execute'
  )
  and not has_function_privilege(
    'service_role',
    'public.owner_recover_expired_refund_gmail_intake_shadow_dispatches()',
    'execute'
  )
  and not has_function_privilege(
    'service_role',
    'public.owner_complete_due_refund_gmail_intake_shadow_cleanup(uuid)',
    'execute'
  ),
  'Run-key validation and owner dispatch/cleanup controls stay private while only service role starts Gmail sync'
);

select ok(
  public.refund_gmail_workflow_run_key_is_valid('github-scheduled:123:1', 'scheduled')
  and public.refund_gmail_workflow_run_key_is_valid('github-manual:123:1', 'manual')
  and public.refund_gmail_workflow_run_key_is_valid(
    'github-failure-test:123:1',
    'failure_test'
  ),
  'All three existing trigger-bound run-key grammars remain valid'
);
select ok(
  not public.refund_gmail_workflow_run_key_is_valid('github-manual:123:1', 'scheduled'),
  'Scheduled runs reject a manual run key'
);
select ok(
  not public.refund_gmail_workflow_run_key_is_valid('github-scheduled:123:1', 'manual'),
  'Manual runs reject a scheduled run key'
);
select ok(
  not public.refund_gmail_workflow_run_key_is_valid('github-manual:123:1', 'failure_test'),
  'Failure-test runs reject a manual run key'
);

select throws_ok(
  $$
    select public.service_start_refund_gmail_sync(
      'github-manual:123:1',
      'intake_shadow',
      now(),
      repeat('a', 64),
      repeat('b', 64),
      false
    )
  $$,
  'P0001',
  'Valid trigger-bound Gmail sync run key required',
  'The intake trigger rejects a generic manual run key at the DB boundary'
);

select throws_ok(
  $$
    select public.service_start_refund_gmail_sync(
      'owner-intake-shadow:' || repeat('c', 64),
      'intake_shadow', now(), repeat('a', 64), repeat('b', 64), false
    )
  $$,
  'P0001',
  'Enabled exact intake-shadow run required',
  'Static default-off configuration cannot create an intake-shadow run'
);

select throws_ok(
  $$
    select public.service_start_refund_gmail_sync(
      'owner-intake-shadow:' || repeat('c', 64),
      'intake_shadow', now(), repeat('a', 64), repeat('b', 64), true
    )
  $$,
  'P0001',
  'Active owner intake-shadow dispatch authorization required',
  'A shared service credential cannot start an unarmed exact intake run'
);

create temporary table intake_shadow_cancelled as
select public.owner_authorize_refund_gmail_intake_shadow_dispatch(
  encode(extensions.digest(convert_to(
    'owner-intake-shadow:' || repeat('c', 64), 'UTF8'
  ), 'sha256'), 'hex'),
  repeat('9', 64),
  statement_timestamp() - interval '5 minutes'
) as result;
select is(
  public.service_preflight_refund_gmail_intake_shadow(
    false, 'refund_gmail_retention_v1', false, false, ''
  ) ->> 'status',
  'intake_shadow_dispatch_armed',
  'Any preexisting armed DB dispatch blocks dry-run and a second ceremony'
);
select is(
  public.owner_cancel_refund_gmail_intake_shadow_dispatch(
    encode(extensions.digest(convert_to(
      'owner-intake-shadow:' || repeat('c', 64), 'UTF8'
    ), 'sha256'), 'hex')
  ) ->> 'status',
  'cancelled',
  'Owner cancellation durably closes an armed exact run before provider work'
);
select throws_ok(
  $$
    select public.service_start_refund_gmail_sync(
      'owner-intake-shadow:' || repeat('c', 64),
      'intake_shadow', now(), repeat('a', 64), repeat('b', 64), true
    )
  $$,
  'P0001',
  'Active owner intake-shadow dispatch authorization required',
  'A late gateway worker is rejected after owner cancellation'
);

select is(
  (select count(*)::integer from public.refund_gmail_sync_runs
    where run_key = 'owner-intake-shadow:' || repeat('c', 64)),
  0,
  'Cancelled late-start rejection creates no attempt row'
);

select public.owner_authorize_refund_gmail_intake_shadow_dispatch(
  encode(extensions.digest(convert_to(
    'owner-intake-shadow:' || repeat('d', 64), 'UTF8'
  ), 'sha256'), 'hex'),
  encode(extensions.digest(convert_to(
    'owner.synthetic@example.test', 'UTF8'
  ), 'sha256'), 'hex'),
  statement_timestamp() - interval '5 minutes'
);

create temporary table intake_shadow_active_run as
select public.service_start_refund_gmail_sync(
  'owner-intake-shadow:' || repeat('d', 64),
  'intake_shadow',
  now(),
  repeat('a', 64),
  repeat('b', 64),
  true
) as result;
select ok(
  (select (result ->> 'claimed')::boolean from intake_shadow_active_run)
  and (select result ->> 'status' from intake_shadow_active_run) = 'running'
  and (select (result ->> 'intakeShadowAuthorized')::boolean
    from intake_shadow_active_run)
  and (select result ->> 'intakeShadowOwnerSenderDigest'
    from intake_shadow_active_run) = encode(extensions.digest(convert_to(
      'owner.synthetic@example.test', 'UTF8'
    ), 'sha256'), 'hex'),
  'An owner-armed exact intake-shadow run atomically consumes its DB authorization'
);
select is(
  (select status from public.refund_gmail_intake_shadow_dispatch_authorizations
   where consumed_run_id = (
     select (result ->> 'runId')::uuid from intake_shadow_active_run
   )),
  'consumed',
  'The dispatch ledger is consumed by the exact truthful run'
);
select throws_ok(
  $$
    select public.service_start_refund_gmail_sync(
      'owner-intake-shadow:' || repeat('d', 64),
      'intake_shadow', now(), repeat('a', 64), repeat('b', 64), true
    )
  $$,
  'P0001',
  'Active owner intake-shadow dispatch authorization required',
  'The consumed exact run key cannot replay'
);

create temporary table intake_shadow_source as
select public.service_ingest_refund_gmail_message_v2(
  repeat('d', 64),
  'intake-shadow-thread',
  'intake-shadow-message',
  '<intake-shadow-message@example.test>',
  null,
  'inbound',
  false,
  'owner.synthetic@example.test',
  'Synthetic Owner',
  'info@bloomjoysweets.com',
  'Synthetic owner intake shadow',
  'Synthetic owner-controlled message.',
  false,
  now(),
  null,
  '[]'::jsonb,
  '{}'::text[],
  array['info@bloomjoysweets.com'],
  'direct_human',
  false,
  false,
  '{}'::text[]
) as result;

create temporary table intake_shadow_ack as
select public.service_ingest_refund_gmail_message_v2(
  repeat('d', 64),
  'intake-shadow-thread',
  'intake-shadow-ack',
  '<intake-shadow-ack@example.test>',
  '<intake-shadow-message@example.test>',
  'outbound',
  false,
  'info@bloomjoysweets.com',
  'Bloomjoy Support',
  'owner.synthetic@example.test',
  'Re: Synthetic owner intake shadow',
  'Mailbox acknowledgement fixture.',
  false,
  now() + interval '1 second',
  null,
  '[]'::jsonb,
  '{}'::text[],
  array['info@bloomjoysweets.com'],
  'automated',
  true,
  false,
  '{}'::text[]
) as result;

update public.refund_gmail_intake_shadow_dispatch_authorizations
set owner_sender_digest = repeat('8', 64)
where consumed_run_id = (
  select (result ->> 'runId')::uuid from intake_shadow_active_run
);
select throws_ok(
  format(
    'select public.service_complete_refund_gmail_intake_shadow(%L::uuid, %L::uuid, %L::uuid)',
    (select result ->> 'runId' from intake_shadow_active_run),
    (select result ->> 'messageId' from intake_shadow_source),
    (select result ->> 'caseId' from intake_shadow_source)
  ),
  'P0001',
  'Exact active intake-shadow run and customer source required',
  'The DB finalizer rejects a source sender not bound to the consumed authorization'
);
update public.refund_gmail_intake_shadow_dispatch_authorizations
set owner_sender_digest = encode(extensions.digest(convert_to(
  'owner.synthetic@example.test', 'UTF8'
), 'sha256'), 'hex'),
  start_at = statement_timestamp() + interval '20 seconds'
where consumed_run_id = (
  select (result ->> 'runId')::uuid from intake_shadow_active_run
);
select throws_ok(
  format(
    'select public.service_complete_refund_gmail_intake_shadow(%L::uuid, %L::uuid, %L::uuid)',
    (select result ->> 'runId' from intake_shadow_active_run),
    (select result ->> 'messageId' from intake_shadow_source),
    (select result ->> 'caseId' from intake_shadow_source)
  ),
  'P0001',
  'Exact active intake-shadow run and customer source required',
  'The DB finalizer rejects a source older than the consumed fresh boundary'
);
update public.refund_gmail_intake_shadow_dispatch_authorizations
set start_at = statement_timestamp() - interval '5 minutes'
where consumed_run_id = (
  select (result ->> 'runId')::uuid from intake_shadow_active_run
);

create temporary table first_notice as
select public.service_complete_refund_gmail_intake_shadow(
  (select (result ->> 'runId')::uuid from intake_shadow_active_run),
  (select (result ->> 'messageId')::uuid from intake_shadow_source),
  (select (result ->> 'caseId')::uuid from intake_shadow_source)
) as result;

select is(
  (select (result ->> 'recorded')::boolean from first_notice),
  true,
  'The first exact source/case pair records one shadow notice'
);
select is(
  (select result ->> 'routeClass' from first_notice),
  'unassigned_owner_ops_queue',
  'An unassigned Gmail draft is truthfully classified for the owner/ops queue'
);
select is(
  (
    public.service_complete_refund_gmail_intake_shadow(
      (select (result ->> 'runId')::uuid from intake_shadow_active_run),
      (select (result ->> 'messageId')::uuid from intake_shadow_source),
      (select (result ->> 'caseId')::uuid from intake_shadow_source)
    ) ->> 'recorded'
  )::boolean,
  false,
  'The exact source replay reuses the durable shadow notice'
);
select is(
  (select count(*)::integer from public.refund_gmail_intake_shadow_notices),
  1,
  'The source-message ledger contains exactly one row after replay'
);
select is(
  (select count(*)::integer
    from public.refund_gmail_intake_shadow_cleanup_obligations
    where assigned_owner_role = 'refund_operations_owner'
      and status = 'assigned'
      and earliest_retention_due_at <= latest_retention_due_at),
  1,
  'The exact run has one durable PII-free assigned cleanup obligation'
);
select is(
  (select count(*)::integer from public.refund_case_events
    where event_type = 'gmail_manager_action_notice_shadowed'),
  1,
  'The case has exactly one PII-free manager-action shadow event after replay'
);
select ok(
  (
    select metadata = jsonb_build_object(
      'route_class', 'unassigned_owner_ops_queue',
      'payload_redacted', true
    )
    from public.refund_case_events
    where event_type = 'gmail_manager_action_notice_shadowed'
  ),
  'The shadow event metadata contains only the fixed route class and redaction marker'
);
select is(
  (select count(*)::integer from public.refund_case_events
    where event_type in ('gmail_customer_action_notice_sent', 'gmail_bounce_action_notice_sent')),
  0,
  'The intake shadow recorder never records a sent manager or ops notice'
);
select is(
  (select count(*)::integer from public.refund_case_messages),
  0,
  'The intake shadow notice recorder creates no customer delivery message'
);

select ok(
  (select (result ->> 'firstContactPresent')::boolean from first_notice)
  and (select (result ->> 'mailboxAcknowledgementObserved')::boolean
    from first_notice)
  and not (select (result ->> 'hubCustomerDeliverySent')::boolean
    from first_notice)
  and (select (result ->> 'laterHubFirstContactExcluded')::boolean
    from first_notice),
  'The intake-specific first-contact boundary records mailbox acknowledgement and no Hub send'
);
select ok(
  exists (
    select 1
    from public.refund_case_events event
    where event.refund_case_id = (
      select (result ->> 'caseId')::uuid from intake_shadow_source
    )
      and event.event_type = 'gmail_first_contact_shadowed'
      and event.message =
        'Hub sent no customer first-contact message. A mailbox acknowledgement was already observed, and this thread is durably excluded from later Hub first contact.'
      and event.metadata = jsonb_build_object(
        'payload_redacted', true,
        'template_key', 'refund_first_contact_v1',
        'mode', 'shadow',
        'prior_mailbox_reply_present', true,
        'mailbox_acknowledgement_observed', true,
        'hub_customer_delivery_sent', false,
        'later_hub_first_contact_excluded', true,
        'exact_run_bound', true
      )
  ),
  'The manager-visible first-contact event truthfully records durable exclusion without false send copy'
);

create temporary table intake_shadow_other_case as
select gen_random_uuid() as id;

insert into public.refund_cases (
  id,
  customer_email,
  issue_summary,
  status,
  intake_source,
  automation_state
)
values (
  (select id from intake_shadow_other_case),
  'other.synthetic@example.test',
  'Synthetic mismatch case',
  'draft',
  'gmail',
  'customer_replied'
);

select throws_ok(
  format(
    'select public.service_complete_refund_gmail_intake_shadow(%L::uuid, %L::uuid, %L::uuid)',
    (select result ->> 'runId' from intake_shadow_active_run),
    (select result ->> 'messageId' from intake_shadow_source),
    (select id::text from intake_shadow_other_case)
  ),
  'P0001',
  'Exact active intake-shadow run and customer source required',
  'The exact completion boundary rejects a cross-case source replay'
);

update public.refund_gmail_retention_state
set status = 'healthy', last_success_at = statement_timestamp();

select ok(
  (public.service_preflight_refund_gmail_intake_shadow(
    false,
    'refund_gmail_retention_v1',
    false,
    false,
    ''
  ) ->> 'allowed')::boolean
  and (public.service_preflight_refund_gmail_intake_shadow(
    false,
    'refund_gmail_retention_v1',
    false,
    false,
    ''
  ) ->> 'payloadRedacted')::boolean,
  'The narrow attachment-free copy preflight authorizes only healthy redacted state'
);
select is(
  public.service_preflight_refund_gmail_intake_shadow(
    true,
    'refund_gmail_retention_v1',
    false,
    false,
    ''
  ) ->> 'status',
  'retention_policy_unhealthy',
  'The independently callable retention worker must remain disabled'
);

update public.refund_gmail_retention_state
set last_success_at = statement_timestamp() - interval '27 hours';
select is(
  public.service_preflight_refund_gmail_intake_shadow(
    false,
    'refund_gmail_retention_v1',
    false,
    false,
    ''
  ) ->> 'status',
  'retention_policy_unhealthy',
  'Stale retention health blocks intake before provider access'
);
update public.refund_gmail_retention_state
set last_success_at = statement_timestamp();

select is(
  public.service_preflight_refund_gmail_intake_shadow(
    false,
    'refund_gmail_retention_v999',
    false,
    false,
    ''
  ) ->> 'status',
  'retention_policy_unhealthy',
  'A retention policy-version mismatch blocks intake before provider access'
);

update public.refund_gmail_retention_settings
set cleanup_enabled = false,
    approved_retention_days = null,
    owner_approved_at = null;
select is(
  public.service_preflight_refund_gmail_intake_shadow(
    false,
    'refund_gmail_retention_v1',
    false,
    false,
    ''
  ) ->> 'status',
  'retention_policy_unhealthy',
  'Missing owner-approved cleanup policy blocks intake before provider access'
);
update public.refund_gmail_retention_settings
set cleanup_enabled = true,
    approved_retention_days = 180,
    owner_approved_at = statement_timestamp();

select is(
  public.service_preflight_refund_gmail_intake_shadow(
    false,
    'refund_gmail_retention_v1',
    true,
    false,
    ''
  ) ->> 'status',
  'retention_policy_unhealthy',
  'Attachment copying remains hard-off during intake shadow'
);
select is(
  public.service_preflight_refund_gmail_intake_shadow(
    false,
    'refund_gmail_retention_v1',
    false,
    true,
    'scanner-v1'
  ) ->> 'status',
  'retention_policy_unhealthy',
  'Attachment scanning remains hard-off during intake shadow'
);

update public.refund_gmail_retention_state
set status = 'manual_review', last_success_at = statement_timestamp();
select is(
  public.service_preflight_refund_gmail_intake_shadow(
    false,
    'refund_gmail_retention_v1',
    false,
    false,
    ''
  ) ->> 'status',
  'retention_policy_unhealthy',
  'A nonhealthy retention state blocks intake before provider access'
);
update public.refund_gmail_retention_state
set status = 'healthy', last_success_at = statement_timestamp();

alter table public.refund_gmail_messages
  disable trigger refund_gmail_messages_preserve_copied_at;
update public.refund_gmail_messages
set copied_at = statement_timestamp() - interval '181 days'
where id = (select (result ->> 'messageId')::uuid from intake_shadow_source);
alter table public.refund_gmail_messages
  enable trigger refund_gmail_messages_preserve_copied_at;
select is(
  public.service_preflight_refund_gmail_intake_shadow(
    false,
    'refund_gmail_retention_v1',
    false,
    false,
    ''
  ) ->> 'status',
  'retention_policy_unhealthy',
  'An overdue copied message blocks intake before provider access'
);
alter table public.refund_gmail_messages
  disable trigger refund_gmail_messages_preserve_copied_at;
update public.refund_gmail_messages
set copied_at = statement_timestamp()
where id = (select (result ->> 'messageId')::uuid from intake_shadow_source);
alter table public.refund_gmail_messages
  enable trigger refund_gmail_messages_preserve_copied_at;

create temporary table intake_shadow_attachment_source as
select public.service_ingest_refund_gmail_message_v2(
  repeat('e', 64),
  'intake-shadow-attachment-thread',
  'intake-shadow-attachment-message',
  '<intake-shadow-attachment-message@example.test>',
  null,
  'inbound',
  false,
  'owner.attachment@example.test',
  'Synthetic Attachment Owner',
  'info@bloomjoysweets.com',
  'Synthetic attachment safety fixture',
  'Synthetic attachment safety fixture.',
  false,
  now(),
  null,
  jsonb_build_array(jsonb_build_object(
    'providerAttachmentId', 'intake-shadow-attachment',
    'fileName', 'synthetic.pdf',
    'contentType', 'application/pdf',
    'byteSize', 128,
    'disposition', 'attachment',
    'allowed', true,
    'rejectionCode', null
  )),
  '{}'::text[],
  array['info@bloomjoysweets.com'],
  'direct_human',
  false,
  false,
  '{}'::text[]
) as result;

alter table public.refund_gmail_attachments
  disable trigger refund_gmail_attachments_preserve_copied_at;
update public.refund_gmail_attachments
set copied_at = statement_timestamp() - interval '181 days'
where id = (
  select (result -> 'attachments' -> 0 ->> 'attachmentId')::uuid
  from intake_shadow_attachment_source
);
alter table public.refund_gmail_attachments
  enable trigger refund_gmail_attachments_preserve_copied_at;
select is(
  public.service_preflight_refund_gmail_intake_shadow(
    false,
    'refund_gmail_retention_v1',
    false,
    false,
    ''
  ) ->> 'status',
  'retention_policy_unhealthy',
  'An overdue copied attachment blocks intake before provider access'
);
alter table public.refund_gmail_attachments
  disable trigger refund_gmail_attachments_preserve_copied_at;
update public.refund_gmail_attachments
set copied_at = statement_timestamp()
where id = (
  select (result -> 'attachments' -> 0 ->> 'attachmentId')::uuid
  from intake_shadow_attachment_source
);
alter table public.refund_gmail_attachments
  enable trigger refund_gmail_attachments_preserve_copied_at;

create temporary table intake_shadow_upload_intent as
select public.service_reserve_refund_gmail_attachment_upload(
  (select (result -> 'attachments' -> 0 ->> 'attachmentId')::uuid
    from intake_shadow_attachment_source)
) as result;
select is(
  public.service_preflight_refund_gmail_intake_shadow(
    false,
    'refund_gmail_retention_v1',
    false,
    false,
    ''
  ) ->> 'status',
  'retention_policy_unhealthy',
  'A pending quarantine upload intent blocks intake before provider access'
);

update public.refund_gmail_quarantine_upload_intents
set status = 'uploaded', settled_at = statement_timestamp()
where id = (select (result ->> 'intentId')::uuid from intake_shadow_upload_intent);

update public.refund_gmail_quarantine_upload_intents
set status = 'deleted', storage_bucket = null, storage_path = null
where id = (select (result ->> 'intentId')::uuid from intake_shadow_upload_intent);
select is(
  public.service_preflight_refund_gmail_intake_shadow(
    false,
    'refund_gmail_retention_v1',
    false,
    false,
    ''
  ) ->> 'status',
  'retention_policy_unhealthy',
  'Malformed quarantine-storage linkage blocks intake before provider access'
);
update public.refund_gmail_quarantine_upload_intents intent
set status = 'uploaded',
    storage_bucket = 'refund-gmail-quarantine',
    storage_path = public.refund_gmail_quarantine_path(
      intent.refund_case_id,
      intent.gmail_message_id,
      intent.gmail_attachment_id,
      intent.storage_extension
    );

insert into public.refund_gmail_retention_runs (
  id, run_key, trigger_source, status, policy_version,
  retention_days, lease_expires_at
) values (
  '85400000-0000-4000-8000-000000000010',
  'retention:github-retention:854:1',
  'retention',
  'running',
  'refund_gmail_retention_v1',
  180,
  statement_timestamp() + interval '5 minutes'
);
insert into public.refund_gmail_retention_actions (
  retention_run_id,
  gmail_attachment_id,
  quarantine_upload_intent_id,
  status,
  lease_expires_at
)
select
  '85400000-0000-4000-8000-000000000010',
  (source.result -> 'attachments' -> 0 ->> 'attachmentId')::uuid,
  (intent.result ->> 'intentId')::uuid,
  'claimed',
  statement_timestamp() + interval '5 minutes'
from intake_shadow_attachment_source source
cross join intake_shadow_upload_intent intent;
select is(
  public.service_preflight_refund_gmail_intake_shadow(
    false,
    'refund_gmail_retention_v1',
    false,
    false,
    ''
  ) ->> 'status',
  'retention_policy_unhealthy',
  'A pending retention action blocks intake before provider access'
);
delete from public.refund_gmail_retention_actions
where retention_run_id = '85400000-0000-4000-8000-000000000010';
delete from public.refund_gmail_retention_runs
where id = '85400000-0000-4000-8000-000000000010';

-- The primary exact-run fixture has completed before independently exercising
-- the two possible manager-route classifications. The production singleton
-- correctly refuses a second authorization while a consumed run is running.
update public.refund_gmail_sync_runs
set status = 'succeeded',
    finished_at = statement_timestamp(),
    threads_scanned = 1,
    messages_seen = 2,
    messages_created = 2,
    messages_deduplicated = 0,
    attachments_quarantined = 0,
    messages_failed = 0
where id = (select (result ->> 'runId')::uuid from intake_shadow_active_run);
update public.refund_gmail_sync_state
set connection_status = 'healthy'
where singleton;

insert into auth.users (
  instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at
) values (
  '00000000-0000-0000-0000-000000000000',
  'ac000000-0000-4000-8000-000000000001',
  'authenticated', 'authenticated', 'intake-shadow-manager@example.test', '', now(),
  '{}'::jsonb, '{}'::jsonb, now(), now()
);
insert into public.customer_accounts (id, name, account_type)
values ('ac100000-0000-4000-8000-000000000001', 'Intake shadow safety', 'customer');
insert into public.reporting_locations (id, account_id, name, timezone)
values (
  'ac200000-0000-4000-8000-000000000001',
  'ac100000-0000-4000-8000-000000000001',
  'Intake shadow safety location',
  'America/Los_Angeles'
);
insert into public.reporting_machines (id, account_id, location_id, machine_label)
values (
  'ac300000-0000-4000-8000-000000000001',
  'ac100000-0000-4000-8000-000000000001',
  'ac200000-0000-4000-8000-000000000001',
  'Intake shadow safety machine'
);
insert into public.reporting_machine_refund_managers (
  id, reporting_machine_id, manager_user_id, manager_email
) values (
  'ac400000-0000-4000-8000-000000000001',
  'ac300000-0000-4000-8000-000000000001',
  'ac000000-0000-4000-8000-000000000001',
  'intake-shadow-manager@example.test'
);
insert into public.refund_cases (
  id, reporting_machine_id, reporting_location_id, customer_email,
  issue_summary, status, intake_source, automation_state
) values (
  'ac500000-0000-4000-8000-000000000001',
  'ac300000-0000-4000-8000-000000000001',
  'ac200000-0000-4000-8000-000000000001',
  'intake-shadow-customer@example.test',
  'Intake shadow DB posture fixture',
  'draft', 'gmail', 'customer_replied'
);

create temporary table intake_shadow_assigned_source as
select public.service_ingest_refund_gmail_message_v2(
  repeat('e', 64), 'intake-assigned-thread', 'intake-assigned-message',
  '<intake-assigned-message@example.test>', null, 'inbound', false,
  'assigned-customer@example.test', 'Assigned Customer',
  'info@bloomjoysweets.com', 'Assigned route', 'Assigned route body.',
  false, now(), null, '[]'::jsonb, '{}'::text[],
  array['info@bloomjoysweets.com'], 'direct_human', false, false, '{}'::text[]
) as result;
update public.refund_cases
set reporting_machine_id = 'ac300000-0000-4000-8000-000000000001',
  reporting_location_id = 'ac200000-0000-4000-8000-000000000001'
where id = (
  select (result ->> 'caseId')::uuid from intake_shadow_assigned_source
);
create temporary table intake_shadow_assigned_ack as
select public.service_ingest_refund_gmail_message_v2(
  repeat('e', 64), 'intake-assigned-thread', 'intake-assigned-ack',
  '<intake-assigned-ack@example.test>', null, 'outbound', false,
  'info@bloomjoysweets.com', 'Bloomjoy Support',
  'assigned-customer@example.test', 'Re: Assigned route',
  'Mailbox acknowledgement fixture.', false, now() + interval '1 second', null,
  '[]'::jsonb, '{}'::text[], array['info@bloomjoysweets.com'],
  'automated', true, false, '{}'::text[]
) as result;
select public.owner_authorize_refund_gmail_intake_shadow_dispatch(
  encode(extensions.digest(convert_to(
    'owner-intake-shadow:' || repeat('e', 64), 'UTF8'
  ), 'sha256'), 'hex'),
  encode(extensions.digest(convert_to(
    'assigned-customer@example.test', 'UTF8'
  ), 'sha256'), 'hex'),
  statement_timestamp() - interval '5 minutes'
);
create temporary table intake_shadow_assigned_run as
select public.service_start_refund_gmail_sync(
  'owner-intake-shadow:' || repeat('e', 64), 'intake_shadow', now(),
  repeat('a', 64), repeat('b', 64), true
) as result;
select is(
  case when public.service_resolve_refund_customer_manager_cc(
    (select (result ->> 'caseId')::uuid from intake_shadow_assigned_source),
    'assigned-customer@example.test',
    array['info@bloomjoysweets.com', 'support@bloomjoysweets.com', 'refunds@bloomjoysweets.com']
  ) ->> 'status' = 'resolved' then 'assigned_managers' else 'operations_fallback' end,
  'assigned_managers',
  'The shadow notice truthfully classifies a complete current manager route'
);
create temporary table intake_shadow_assigned_notice as
select public.service_complete_refund_gmail_intake_shadow(
  (select (result ->> 'runId')::uuid from intake_shadow_assigned_run),
  (select (result ->> 'messageId')::uuid from intake_shadow_assigned_source),
  (select (result ->> 'caseId')::uuid from intake_shadow_assigned_source)
) as result;
update public.refund_gmail_sync_runs
set status = 'succeeded', finished_at = statement_timestamp()
where id = (select (result ->> 'runId')::uuid from intake_shadow_assigned_run);

insert into public.reporting_machines (id, account_id, location_id, machine_label)
values (
  'ac300000-0000-4000-8000-000000000002',
  'ac100000-0000-4000-8000-000000000001',
  'ac200000-0000-4000-8000-000000000001',
  'Intake shadow no-manager machine'
);
create temporary table intake_shadow_ops_source as
select public.service_ingest_refund_gmail_message_v2(
  repeat('f', 64), 'intake-ops-thread', 'intake-ops-message',
  '<intake-ops-message@example.test>', null, 'inbound', false,
  'ops-customer@example.test', 'Ops Customer',
  'info@bloomjoysweets.com', 'Operations route', 'Operations route body.',
  false, now(), null, '[]'::jsonb, '{}'::text[],
  array['info@bloomjoysweets.com'], 'direct_human', false, false, '{}'::text[]
) as result;
update public.refund_cases
set reporting_machine_id = 'ac300000-0000-4000-8000-000000000002',
  reporting_location_id = 'ac200000-0000-4000-8000-000000000001'
where id = (
  select (result ->> 'caseId')::uuid from intake_shadow_ops_source
);
create temporary table intake_shadow_ops_ack as
select public.service_ingest_refund_gmail_message_v2(
  repeat('f', 64), 'intake-ops-thread', 'intake-ops-ack',
  '<intake-ops-ack@example.test>', null, 'outbound', false,
  'info@bloomjoysweets.com', 'Bloomjoy Support',
  'ops-customer@example.test', 'Re: Operations route',
  'Mailbox acknowledgement fixture.', false, now() + interval '1 second', null,
  '[]'::jsonb, '{}'::text[], array['info@bloomjoysweets.com'],
  'automated', true, false, '{}'::text[]
) as result;
select public.owner_authorize_refund_gmail_intake_shadow_dispatch(
  encode(extensions.digest(convert_to(
    'owner-intake-shadow:' || repeat('f', 64), 'UTF8'
  ), 'sha256'), 'hex'),
  encode(extensions.digest(convert_to(
    'ops-customer@example.test', 'UTF8'
  ), 'sha256'), 'hex'),
  statement_timestamp() - interval '5 minutes'
);
create temporary table intake_shadow_ops_run as
select public.service_start_refund_gmail_sync(
  'owner-intake-shadow:' || repeat('f', 64), 'intake_shadow', now(),
  repeat('a', 64), repeat('b', 64), true
) as result;
select is(
  case when public.service_resolve_refund_customer_manager_cc(
    (select (result ->> 'caseId')::uuid from intake_shadow_ops_source),
    'ops-customer@example.test',
    array['info@bloomjoysweets.com', 'support@bloomjoysweets.com', 'refunds@bloomjoysweets.com']
  ) ->> 'status' = 'resolved' then 'assigned_managers' else 'operations_fallback' end,
  'operations_fallback',
  'The shadow notice truthfully classifies a machine with no active managers for ops'
);
update public.refund_gmail_sync_runs
set status = 'succeeded', finished_at = statement_timestamp()
where id = (select (result ->> 'runId')::uuid from intake_shadow_ops_run);

insert into public.refund_manager_action_step_up_intents (
  id, actor_user_id, refund_case_id, action, target_function,
  manager_mapping_id, manager_mapping_version,
  manager_totp_enrollment_version, expected_case_version,
  action_context_hash, status, not_before, expires_at
) values (
  'ac600000-0000-4000-8000-000000000001',
  'ac000000-0000-4000-8000-000000000001',
  'ac500000-0000-4000-8000-000000000001',
  'approve', 'refund-case-admin-update',
  'ac400000-0000-4000-8000-000000000001', 1, 1, 1,
  repeat('a', 64), 'pending', statement_timestamp(),
  statement_timestamp() + interval '90 seconds'
);
select is(
  public.service_preflight_refund_gmail_intake_shadow(
    false, 'refund_gmail_retention_v1', false, false, ''
  ) ->> 'status',
  'official_actions_enabled',
  'A pending manager step-up intent blocks Gmail intake before OAuth'
);

update public.refund_manager_action_step_up_intents
set status = 'consumed',
  verified_totp_at = statement_timestamp() + interval '1 second',
  consumed_at = statement_timestamp() + interval '1 second'
where id = 'ac600000-0000-4000-8000-000000000001';
insert into public.refund_case_official_action_authorizations (
  id, refund_case_id, action, actor_user_id, manager_mapping_id,
  manager_mapping_version, expected_case_version, action_context_hash,
  status, expires_at, step_up_intent_id, verified_totp_at
) values (
  'ac700000-0000-4000-8000-000000000001',
  'ac500000-0000-4000-8000-000000000001',
  'approve', 'ac000000-0000-4000-8000-000000000001',
  'ac400000-0000-4000-8000-000000000001', 1, 1,
  repeat('a', 64), 'authorized', statement_timestamp() + interval '5 minutes',
  'ac600000-0000-4000-8000-000000000001',
  statement_timestamp() + interval '1 second'
);
select ok(
  (public.service_preflight_refund_gmail_intake_shadow(
    false, 'refund_gmail_retention_v1', false, false, ''
  ) ->> 'activeOfficialAuthorizationCount')::integer = 1
  and public.service_preflight_refund_gmail_intake_shadow(
    false, 'refund_gmail_retention_v1', false, false, ''
  ) ->> 'status' = 'official_actions_enabled',
  'An active official-action authorization blocks intake'
);
delete from public.refund_case_official_action_authorizations
where id = 'ac700000-0000-4000-8000-000000000001';
delete from public.refund_manager_action_step_up_intents
where id = 'ac600000-0000-4000-8000-000000000001';

insert into public.refund_case_nayax_refund_attempts (
  id, refund_case_id, execution_mode, status, idempotency_key, amount_cents
) values (
  'ac800000-0000-4000-8000-000000000001',
  'ac500000-0000-4000-8000-000000000001',
  'preflight', 'preflight_blocked', 'intake-shadow-terminal-attempt', 0
);
select ok(
  (public.service_preflight_refund_gmail_intake_shadow(
    false, 'refund_gmail_retention_v1', false, false, ''
  ) ->> 'nayaxProviderAttemptCount')::integer = 1
  and (public.service_preflight_refund_gmail_intake_shadow(
    false, 'refund_gmail_retention_v1', false, false, ''
  ) ->> 'unresolvedNayaxProviderAttemptCount')::integer = 0
  and (public.service_preflight_refund_gmail_intake_shadow(
    false, 'refund_gmail_retention_v1', false, false, ''
  ) ->> 'allowed')::boolean,
  'Historical terminal Nayax attempts are counted but do not block intake'
);
delete from public.refund_case_nayax_refund_attempts
where id = 'ac800000-0000-4000-8000-000000000001';

insert into public.refund_case_nayax_refund_attempts (
  id, refund_case_id, execution_mode, status, idempotency_key, amount_cents,
  reconciliation_required
) values (
  'ac800000-0000-4000-8000-000000000002',
  'ac500000-0000-4000-8000-000000000001',
  'preflight', 'ambiguous', 'intake-shadow-unresolved-attempt', 0, true
);
select is(
  (public.service_preflight_refund_gmail_intake_shadow(
    false, 'refund_gmail_retention_v1', false, false, ''
  ) ->> 'unresolvedNayaxProviderAttemptCount')::integer,
  1,
  'An unresolved Nayax provider attempt is explicitly counted and blocks intake'
);

insert into public.refund_nayax_resolution_operators (
  actor_user_id, approved_by_owner_user_id
) values (
  'ac000000-0000-4000-8000-000000000001',
  'ac000000-0000-4000-8000-000000000001'
);
insert into public.refund_nayax_resolution_intents (
  id, actor_user_id, refund_case_id, nayax_refund_attempt_id,
  manager_mapping_id, manager_mapping_version,
  manager_totp_enrollment_version, operator_version, expected_case_version,
  resolution_result, evidence_type, evidence_reference_digest,
  reason_code, attempt_evidence_hash, status, not_before, expires_at
) values (
  'ac900000-0000-4000-8000-000000000001',
  'ac000000-0000-4000-8000-000000000001',
  'ac500000-0000-4000-8000-000000000001',
  'ac800000-0000-4000-8000-000000000002',
  'ac400000-0000-4000-8000-000000000001', 1, 1, 1, 1,
  'remain_on_hold', 'nayax_support_ticket', repeat('b', 64),
  'evidence_incomplete', repeat('c', 64), 'pending',
  statement_timestamp(), statement_timestamp() + interval '90 seconds'
);
select is(
  (public.service_preflight_refund_gmail_intake_shadow(
    false, 'refund_gmail_retention_v1', false, false, ''
  ) ->> 'nayaxResolutionIntentCount')::integer,
  1,
  'A pending Nayax resolution intent is explicitly counted and blocks intake'
);

update public.refund_gmail_intake_shadow_cleanup_obligations
set earliest_retention_due_at = statement_timestamp() - interval '2 seconds',
    latest_retention_due_at = statement_timestamp() - interval '1 second'
where run_id = (select (result ->> 'runId')::uuid from intake_shadow_active_run);

select is(
  (public.service_preflight_refund_gmail_intake_shadow(
    false, 'refund_gmail_retention_v1', false, false, ''
  ) ->> 'overdueCleanupObligationCount')::integer,
  1,
  'An overdue assigned intake-shadow cleanup obligation is visible in preflight'
);
select is(
  public.owner_complete_due_refund_gmail_intake_shadow_cleanup(
    '00000000-0000-4000-8000-000000000999'
  ),
  jsonb_build_object(
    'completedNow', 0,
    'assignedOverdue', 1,
    'assignedOutstanding', 2,
    'taskFound', false,
    'taskStatus', 'absent',
    'payloadRedacted', true
  ),
  'A different or prior cleanup handle cannot satisfy the current obligation'
);
select ok(
  (public.owner_complete_due_refund_gmail_intake_shadow_cleanup(
    (select cleanup_task_handle
     from public.refund_gmail_intake_shadow_cleanup_obligations
     where run_id = (select (result ->> 'runId')::uuid from intake_shadow_active_run))
  )
    ->> 'completedNow')::integer = 0
  and (public.owner_complete_due_refund_gmail_intake_shadow_cleanup(
    (select cleanup_task_handle
     from public.refund_gmail_intake_shadow_cleanup_obligations
     where run_id = (select (result ->> 'runId')::uuid from intake_shadow_active_run))
  )
    ->> 'assignedOverdue')::integer = 1,
  'Cleanup completion fails closed while either exact message remains unpurged'
);

update public.refund_gmail_messages message
set
  provider_message_id = null,
  provider_message_header = null,
  references_header = null,
  sender_email = null,
  sender_name = null,
  recipient_email = null,
  recipient_cc_emails = '{}'::text[],
  recipient_cc_count = 0,
  subject = '[Deleted after Gmail retention period]',
  plain_body = '[Deleted after Gmail retention period]',
  content_deleted_at = statement_timestamp()
where message.gmail_thread_id = (
  select source.gmail_thread_id
  from public.refund_gmail_intake_shadow_notices notice
  join public.refund_gmail_messages source on source.id = notice.source_message_id
  where notice.run_id = (
    select (result ->> 'runId')::uuid from intake_shadow_active_run
  )
);

update public.refund_gmail_threads thread
set thread_subject = '[Deleted after Gmail retention period]'
where thread.id = (
  select source.gmail_thread_id
  from public.refund_gmail_intake_shadow_notices notice
  join public.refund_gmail_messages source on source.id = notice.source_message_id
  where notice.run_id = (
    select (result ->> 'runId')::uuid from intake_shadow_active_run
  )
);

update public.refund_gmail_messages message
set sender_name = 'retained identity'
where message.id = (
  select notice.source_message_id
  from public.refund_gmail_intake_shadow_notices notice
  where notice.run_id = (
    select (result ->> 'runId')::uuid from intake_shadow_active_run
  )
);
select is(
  (public.owner_complete_due_refund_gmail_intake_shadow_cleanup(
    (select cleanup_task_handle
     from public.refund_gmail_intake_shadow_cleanup_obligations
     where run_id = (select (result ->> 'runId')::uuid from intake_shadow_active_run))
  ) ->> 'completedNow')::integer,
  0,
  'Cleanup rejects a retained sender name'
);
update public.refund_gmail_messages message
set sender_name = null
where message.id = (
  select notice.source_message_id
  from public.refund_gmail_intake_shadow_notices notice
  where notice.run_id = (
    select (result ->> 'runId')::uuid from intake_shadow_active_run
  )
);

update public.refund_gmail_messages message
set provider_message_header = '<retained@example.invalid>'
where message.id = (
  select notice.source_message_id
  from public.refund_gmail_intake_shadow_notices notice
  where notice.run_id = (
    select (result ->> 'runId')::uuid from intake_shadow_active_run
  )
);
select is(
  (public.owner_complete_due_refund_gmail_intake_shadow_cleanup(
    (select cleanup_task_handle
     from public.refund_gmail_intake_shadow_cleanup_obligations
     where run_id = (select (result ->> 'runId')::uuid from intake_shadow_active_run))
  ) ->> 'completedNow')::integer,
  0,
  'Cleanup rejects a retained provider message header'
);
update public.refund_gmail_messages message
set provider_message_header = null
where message.id = (
  select notice.source_message_id
  from public.refund_gmail_intake_shadow_notices notice
  where notice.run_id = (
    select (result ->> 'runId')::uuid from intake_shadow_active_run
  )
);

update public.refund_gmail_messages message
set references_header = '<retained-reference@example.invalid>'
where message.id = (
  select notice.source_message_id
  from public.refund_gmail_intake_shadow_notices notice
  where notice.run_id = (
    select (result ->> 'runId')::uuid from intake_shadow_active_run
  )
);
select is(
  (public.owner_complete_due_refund_gmail_intake_shadow_cleanup(
    (select cleanup_task_handle
     from public.refund_gmail_intake_shadow_cleanup_obligations
     where run_id = (select (result ->> 'runId')::uuid from intake_shadow_active_run))
  ) ->> 'completedNow')::integer,
  0,
  'Cleanup rejects a retained references header'
);
update public.refund_gmail_messages message
set references_header = null
where message.id = (
  select notice.source_message_id
  from public.refund_gmail_intake_shadow_notices notice
  where notice.run_id = (
    select (result ->> 'runId')::uuid from intake_shadow_active_run
  )
);

update public.refund_gmail_messages message
set recipient_cc_emails = array['retained@example.invalid']::text[]
where message.id = (
  select notice.source_message_id
  from public.refund_gmail_intake_shadow_notices notice
  where notice.run_id = (
    select (result ->> 'runId')::uuid from intake_shadow_active_run
  )
);
select is(
  (public.owner_complete_due_refund_gmail_intake_shadow_cleanup(
    (select cleanup_task_handle
     from public.refund_gmail_intake_shadow_cleanup_obligations
     where run_id = (select (result ->> 'runId')::uuid from intake_shadow_active_run))
  ) ->> 'completedNow')::integer,
  0,
  'Cleanup rejects a retained CC address array'
);
update public.refund_gmail_messages message
set recipient_cc_emails = '{}'::text[]
where message.id = (
  select notice.source_message_id
  from public.refund_gmail_intake_shadow_notices notice
  where notice.run_id = (
    select (result ->> 'runId')::uuid from intake_shadow_active_run
  )
);

update public.refund_gmail_messages message
set recipient_cc_count = 1
where message.id = (
  select notice.source_message_id
  from public.refund_gmail_intake_shadow_notices notice
  where notice.run_id = (
    select (result ->> 'runId')::uuid from intake_shadow_active_run
  )
);
select is(
  (public.owner_complete_due_refund_gmail_intake_shadow_cleanup(
    (select cleanup_task_handle
     from public.refund_gmail_intake_shadow_cleanup_obligations
     where run_id = (select (result ->> 'runId')::uuid from intake_shadow_active_run))
  ) ->> 'completedNow')::integer,
  0,
  'Cleanup rejects a retained CC recipient count'
);
update public.refund_gmail_messages message
set recipient_cc_count = 0
where message.id = (
  select notice.source_message_id
  from public.refund_gmail_intake_shadow_notices notice
  where notice.run_id = (
    select (result ->> 'runId')::uuid from intake_shadow_active_run
  )
);

update public.refund_gmail_threads thread
set thread_subject = 'retained thread subject'
where thread.id = (
  select source.gmail_thread_id
  from public.refund_gmail_intake_shadow_notices notice
  join public.refund_gmail_messages source on source.id = notice.source_message_id
  where notice.run_id = (
    select (result ->> 'runId')::uuid from intake_shadow_active_run
  )
);
select is(
  (public.owner_complete_due_refund_gmail_intake_shadow_cleanup(
    (select cleanup_task_handle
     from public.refund_gmail_intake_shadow_cleanup_obligations
     where run_id = (select (result ->> 'runId')::uuid from intake_shadow_active_run))
  ) ->> 'completedNow')::integer,
  0,
  'Cleanup rejects a retained linked Gmail thread subject'
);
update public.refund_gmail_threads thread
set thread_subject = '[Deleted after Gmail retention period]'
where thread.id = (
  select source.gmail_thread_id
  from public.refund_gmail_intake_shadow_notices notice
  join public.refund_gmail_messages source on source.id = notice.source_message_id
  where notice.run_id = (
    select (result ->> 'runId')::uuid from intake_shadow_active_run
  )
);

create temporary table intake_shadow_cleanup_completion as
select public.owner_complete_due_refund_gmail_intake_shadow_cleanup(
  (select cleanup_task_handle
   from public.refund_gmail_intake_shadow_cleanup_obligations
   where run_id = (select (result ->> 'runId')::uuid from intake_shadow_active_run))
) as result;
select ok(
  (select (result ->> 'completedNow')::integer
    from intake_shadow_cleanup_completion) = 1
  and (select (result ->> 'assignedOverdue')::integer
    from intake_shadow_cleanup_completion) = 0
  and (select (result ->> 'assignedOutstanding')::integer
    from intake_shadow_cleanup_completion) = 1
  and (select (result ->> 'taskFound')::boolean
    from intake_shadow_cleanup_completion)
  and (select result ->> 'taskStatus'
    from intake_shadow_cleanup_completion) = 'completed'
  and (select (result ->> 'payloadRedacted')::boolean
    from intake_shadow_cleanup_completion),
  'Cleanup A completes but the newer assigned cleanup B remains globally outstanding'
);
select is(
  public.owner_complete_due_refund_gmail_intake_shadow_cleanup(
    (select cleanup_task_handle
     from public.refund_gmail_intake_shadow_cleanup_obligations
     where run_id = (select (result ->> 'runId')::uuid from intake_shadow_active_run))
  ),
  jsonb_build_object(
    'completedNow', 0,
    'assignedOverdue', 0,
    'assignedOutstanding', 1,
    'taskFound', true,
    'taskStatus', 'completed',
    'payloadRedacted', true
  ),
  'A stale completed task handle cannot hide the newer assigned cleanup B'
);
select is(
  public.owner_complete_due_refund_gmail_intake_shadow_cleanup(
    (select cleanup_task_handle
     from public.refund_gmail_intake_shadow_cleanup_obligations
     where run_id = (select (result ->> 'runId')::uuid from intake_shadow_assigned_run))
  ),
  jsonb_build_object(
    'completedNow', 0,
    'assignedOverdue', 0,
    'assignedOutstanding', 1,
    'taskFound', true,
    'taskStatus', 'assigned',
    'payloadRedacted', true
  ),
  'Cleanup B cannot complete before its exact latest due time'
);

update public.refund_gmail_intake_shadow_cleanup_obligations
set earliest_retention_due_at = statement_timestamp() - interval '2 seconds',
    latest_retention_due_at = statement_timestamp() - interval '1 second'
where run_id = (select (result ->> 'runId')::uuid from intake_shadow_assigned_run);
update public.refund_gmail_messages message
set
  provider_message_id = null,
  provider_message_header = null,
  references_header = null,
  sender_email = null,
  sender_name = null,
  recipient_email = null,
  recipient_cc_emails = '{}'::text[],
  recipient_cc_count = 0,
  subject = '[Deleted after Gmail retention period]',
  plain_body = '[Deleted after Gmail retention period]',
  content_deleted_at = statement_timestamp()
where message.gmail_thread_id = (
  select source.gmail_thread_id
  from public.refund_gmail_intake_shadow_notices notice
  join public.refund_gmail_messages source on source.id = notice.source_message_id
  where notice.run_id = (
    select (result ->> 'runId')::uuid from intake_shadow_assigned_run
  )
);

update public.refund_gmail_threads thread
set thread_subject = '[Deleted after Gmail retention period]'
where thread.id = (
  select source.gmail_thread_id
  from public.refund_gmail_intake_shadow_notices notice
  join public.refund_gmail_messages source on source.id = notice.source_message_id
  where notice.run_id = (
    select (result ->> 'runId')::uuid from intake_shadow_assigned_run
  )
);

create temporary table intake_shadow_cleanup_b_completion as
select public.owner_complete_due_refund_gmail_intake_shadow_cleanup(
  (select cleanup_task_handle
   from public.refund_gmail_intake_shadow_cleanup_obligations
   where run_id = (select (result ->> 'runId')::uuid from intake_shadow_assigned_run))
) as result;
select ok(
  (select (result ->> 'completedNow')::integer
    from intake_shadow_cleanup_b_completion) = 1
  and (select (result ->> 'assignedOverdue')::integer
    from intake_shadow_cleanup_b_completion) = 0
  and (select (result ->> 'assignedOutstanding')::integer
    from intake_shadow_cleanup_b_completion) = 0
  and (select (result ->> 'taskFound')::boolean
    from intake_shadow_cleanup_b_completion)
  and (select result ->> 'taskStatus'
    from intake_shadow_cleanup_b_completion) = 'completed',
  'Due and purged cleanup B completes only after all assigned work is discharged'
);
select is(
  public.owner_complete_due_refund_gmail_intake_shadow_cleanup(
    (select cleanup_task_handle
     from public.refund_gmail_intake_shadow_cleanup_obligations
     where run_id = (select (result ->> 'runId')::uuid from intake_shadow_assigned_run))
  ),
  jsonb_build_object(
    'completedNow', 0,
    'assignedOverdue', 0,
    'assignedOutstanding', 0,
    'taskFound', true,
    'taskStatus', 'completed',
    'payloadRedacted', true
  ),
  'An ambiguous successful cleanup B completion can be verified idempotently'
);
select is(
  (select count(*)::integer
   from public.refund_gmail_intake_shadow_cleanup_obligations
   where status = 'completed'),
  2,
  'Both exact run-bound cleanup obligations are durably completed'
);

select * from finish();
rollback;
