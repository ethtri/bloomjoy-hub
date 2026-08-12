begin;

create extension if not exists pgtap with schema extensions;
set local search_path = public, extensions;

select plan(29);

insert into auth.users (
  instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at
)
values
  ('00000000-0000-0000-0000-000000000000', '88400000-0000-4000-8000-000000000001', 'authenticated', 'authenticated', 'assignment-manager-one@example.test', '', now(), '{}'::jsonb, '{}'::jsonb, now(), now()),
  ('00000000-0000-0000-0000-000000000000', '88400000-0000-4000-8000-000000000002', 'authenticated', 'authenticated', 'assignment-manager-two@example.test', '', now(), '{}'::jsonb, '{}'::jsonb, now(), now()),
  ('00000000-0000-0000-0000-000000000000', '88400000-0000-4000-8000-000000000003', 'authenticated', 'authenticated', 'assignment-manager-three@example.test', '', now(), '{}'::jsonb, '{}'::jsonb, now(), now());

insert into public.customer_accounts (id, name, account_type)
values ('88410000-0000-4000-8000-000000000001', 'Refund assignment test', 'customer');

insert into public.reporting_locations (id, account_id, name, timezone)
values (
  '88420000-0000-4000-8000-000000000001',
  '88410000-0000-4000-8000-000000000001',
  'Refund assignment test location',
  'America/Los_Angeles'
);

insert into public.reporting_machines (id, account_id, location_id, machine_label)
values
  ('88430000-0000-4000-8000-000000000001', '88410000-0000-4000-8000-000000000001', '88420000-0000-4000-8000-000000000001', 'One manager machine'),
  ('88430000-0000-4000-8000-000000000002', '88410000-0000-4000-8000-000000000001', '88420000-0000-4000-8000-000000000001', 'Zero manager machine'),
  ('88430000-0000-4000-8000-000000000003', '88410000-0000-4000-8000-000000000001', '88420000-0000-4000-8000-000000000001', 'Multiple manager machine'),
  ('88430000-0000-4000-8000-000000000004', '88410000-0000-4000-8000-000000000001', '88420000-0000-4000-8000-000000000001', 'Email manager machine'),
  ('88430000-0000-4000-8000-000000000005', '88410000-0000-4000-8000-000000000001', '88420000-0000-4000-8000-000000000001', 'Terminal backfill machine');

insert into public.reporting_machine_refund_managers (
  id, reporting_machine_id, manager_user_id, manager_email, status,
  grant_reason, revoked_at, revoke_reason
)
values
  ('88440000-0000-4000-8000-000000000001', '88430000-0000-4000-8000-000000000001', '88400000-0000-4000-8000-000000000001', 'assignment-manager-one@example.test', 'active', 'Assignment test', null, null),
  ('88440000-0000-4000-8000-000000000002', '88430000-0000-4000-8000-000000000002', '88400000-0000-4000-8000-000000000002', 'assignment-manager-two@example.test', 'revoked', 'Assignment test', now(), 'Revoked test mapping'),
  ('88440000-0000-4000-8000-000000000003', '88430000-0000-4000-8000-000000000003', '88400000-0000-4000-8000-000000000001', 'assignment-manager-one@example.test', 'active', 'Assignment test', null, null),
  ('88440000-0000-4000-8000-000000000004', '88430000-0000-4000-8000-000000000003', '88400000-0000-4000-8000-000000000002', 'assignment-manager-two@example.test', 'active', 'Assignment test', null, null),
  ('88440000-0000-4000-8000-000000000005', '88430000-0000-4000-8000-000000000004', '88400000-0000-4000-8000-000000000003', 'assignment-manager-three@example.test', 'active', 'Assignment test', null, null),
  ('88440000-0000-4000-8000-000000000006', '88430000-0000-4000-8000-000000000005', '88400000-0000-4000-8000-000000000003', 'assignment-manager-three@example.test', 'active', 'Assignment test', null, null);

select has_function(
  'public',
  'assign_refund_case_manager_on_machine_binding',
  array[]::text[],
  'The machine-binding trigger function exists'
);

select ok(
  not has_function_privilege(
    'authenticated',
    'public.assign_refund_case_manager_on_machine_binding()',
    'execute'
  ),
  'Browser roles cannot invoke the assignment trigger function'
);

select ok(
  position('pg_advisory_xact_lock' in pg_get_functiondef(
    'public.assign_refund_case_manager_on_machine_binding()'::regprocedure
  )) > 0
  and position('machine_manager:' in pg_get_functiondef(
    'public.assign_refund_case_manager_on_machine_binding()'::regprocedure
  )) > 0,
  'Case assignment takes the per-machine transaction lock'
);

select ok(
  position('machine_manager:' in pg_get_functiondef(
    'public.assign_refund_case_manager_on_machine_binding()'::regprocedure
  )) > 0
  and position('machine_manager:' in pg_get_functiondef(
    'public.admin_set_reporting_machine_refund_managers(uuid,text[],text)'::regprocedure
  )) > 0,
  'Case assignment and Admin Machines serialize on the same lock namespace'
);

select ok(
  not has_function_privilege(
    'authenticated',
    'public.service_backfill_open_refund_case_manager_assignments()',
    'execute'
  ),
  'Browser roles cannot invoke the existing-case repair function'
);

select ok(
  not has_function_privilege(
    'service_role',
    'public.service_backfill_open_refund_case_manager_assignments()',
    'execute'
  ),
  'The one-time existing-case repair leaves no service-role mutation grant'
);

insert into public.refund_cases (
  id, reporting_machine_id, reporting_location_id, customer_email,
  issue_summary, incident_at, payment_method, assigned_manager_id
)
values
  ('88450000-0000-4000-8000-000000000001', '88430000-0000-4000-8000-000000000001', '88420000-0000-4000-8000-000000000001', 'one-manager-customer@example.test', 'Synthetic direct intake.', now(), 'card', null),
  ('88450000-0000-4000-8000-000000000002', '88430000-0000-4000-8000-000000000002', '88420000-0000-4000-8000-000000000001', 'zero-manager-customer@example.test', 'Synthetic direct intake.', now(), 'card', '88400000-0000-4000-8000-000000000002'),
  ('88450000-0000-4000-8000-000000000003', '88430000-0000-4000-8000-000000000003', '88420000-0000-4000-8000-000000000001', 'multi-manager-customer@example.test', 'Synthetic direct intake.', now(), 'card', null),
  ('88450000-0000-4000-8000-000000000004', '88430000-0000-4000-8000-000000000003', '88420000-0000-4000-8000-000000000001', 'explicit-manager-customer@example.test', 'Synthetic direct intake.', now(), 'card', '88400000-0000-4000-8000-000000000002'),
  ('88450000-0000-4000-8000-000000000006', '88430000-0000-4000-8000-000000000005', '88420000-0000-4000-8000-000000000001', 'terminal-customer@example.test', 'Synthetic terminal intake.', now(), 'card', null);

update public.refund_cases
set status = 'closed', assigned_manager_id = null
where id = '88450000-0000-4000-8000-000000000006';

select is(
  (select assigned_manager_id from public.refund_cases where id = '88450000-0000-4000-8000-000000000001'),
  '88400000-0000-4000-8000-000000000001'::uuid,
  'Direct intake assigns the sole current manager'
);

select is(
  (select intake_meta ->> 'manager_assignment_status' from public.refund_cases where id = '88450000-0000-4000-8000-000000000001'),
  'assigned_sole_current_manager',
  'Direct intake records the sole-manager assignment outcome'
);

select is(
  (select assigned_manager_id from public.refund_cases where id = '88450000-0000-4000-8000-000000000002'),
  null::uuid,
  'A revoked mapping is not treated as a current manager'
);

select is(
  (select intake_meta ->> 'manager_assignment_status' from public.refund_cases where id = '88450000-0000-4000-8000-000000000002'),
  'admin_review_no_current_manager',
  'Zero current managers routes direct intake to explicit admin review'
);

select is(
  (select assigned_manager_id from public.refund_cases where id = '88450000-0000-4000-8000-000000000003'),
  null::uuid,
  'Multiple current managers remain unassigned instead of being guessed'
);

select is(
  (select intake_meta ->> 'manager_assignment_status' from public.refund_cases where id = '88450000-0000-4000-8000-000000000003'),
  'admin_review_multiple_current_managers',
  'Multiple current managers records the explicit admin-review outcome'
);

select is(
  (select assigned_manager_id from public.refund_cases where id = '88450000-0000-4000-8000-000000000004'),
  '88400000-0000-4000-8000-000000000002'::uuid,
  'A deliberate current owner can be selected when multiple managers exist'
);

select is(
  (select intake_meta ->> 'manager_assignment_status' from public.refund_cases where id = '88450000-0000-4000-8000-000000000004'),
  'preserved_explicit_current_manager',
  'A deliberate current owner is explicitly recorded as preserved'
);

create temporary table multiple_manager_cc as
select public.service_resolve_refund_customer_manager_cc(
  '88450000-0000-4000-8000-000000000003',
  'multi-manager-customer@example.test',
  array['info@example.test', 'support@example.test']
) as result;

select is(
  (select result ->> 'status' from multiple_manager_cc),
  'resolved',
  'An unassigned multiple-manager case still resolves a safe customer CC route'
);

select is(
  (select result -> 'managerCcEmails' from multiple_manager_cc),
  '["assignment-manager-one@example.test", "assignment-manager-two@example.test"]'::jsonb,
  'CC resolution includes the complete current mapping set independently of ownership assignment'
);

update public.reporting_machine_refund_managers
set
  status = 'revoked',
  revoked_at = now(),
  revoke_reason = 'Create a sole-manager backfill fixture'
where id = '88440000-0000-4000-8000-000000000004';

select is(
  public.service_backfill_open_refund_case_manager_assignments(),
  1,
  'The repair changes only the now-unambiguous existing open case'
);

select is(
  (select assigned_manager_id from public.refund_cases where id = '88450000-0000-4000-8000-000000000003'),
  '88400000-0000-4000-8000-000000000001'::uuid,
  'The existing open unassigned case receives its sole current manager'
);

select is(
  (
    select count(*)::integer
    from public.refund_case_events
    where refund_case_id = '88450000-0000-4000-8000-000000000003'
      and event_type = 'manager_assignment_backfilled'
      and metadata ->> 'payload_redacted' = 'true'
      and metadata ->> 'official_action' = 'false'
  ),
  1,
  'The existing-case repair writes one redacted non-official audit event'
);

select is(
  (select assigned_manager_id from public.refund_cases where id = '88450000-0000-4000-8000-000000000006'),
  null::uuid,
  'The existing-case repair skips terminal cases'
);

-- A stale owner from the previous machine is replaced by the sole current
-- manager when the machine binding changes.
update public.refund_cases
set
  assigned_manager_id = '88400000-0000-4000-8000-000000000002',
  reporting_machine_id = '88430000-0000-4000-8000-000000000004'
where id = '88450000-0000-4000-8000-000000000004';

select is(
  (select assigned_manager_id from public.refund_cases where id = '88450000-0000-4000-8000-000000000004'),
  '88400000-0000-4000-8000-000000000003'::uuid,
  'Changing machines clears a stale explicit owner and assigns the new sole current manager'
);

update public.refund_cases
set assigned_manager_id = null
where id = '88450000-0000-4000-8000-000000000001';

select is(
  (select assigned_manager_id from public.refund_cases where id = '88450000-0000-4000-8000-000000000001'),
  null::uuid,
  'A deliberate manual clear is preserved when the machine binding does not change'
);

insert into public.refund_cases (
  id, customer_email, issue_summary, status, intake_source
)
values (
  '88450000-0000-4000-8000-000000000005',
  'email-customer@example.test',
  'Synthetic Gmail draft.',
  'draft',
  'gmail'
);

insert into public.refund_gmail_threads (
  id, refund_case_id, mailbox_hash, provider_thread_id, thread_subject,
  first_message_at, latest_message_at, retention_expires_at
)
values (
  '88460000-0000-4000-8000-000000000001',
  '88450000-0000-4000-8000-000000000005',
  repeat('a', 64),
  'assignment-thread',
  'Synthetic assignment thread',
  now(), now(), now() + interval '180 days'
);

insert into public.refund_gmail_messages (
  id, gmail_thread_id, refund_case_id, provider_message_id, direction, status,
  sender_email, recipient_email, subject, plain_body, sensitive_data_redacted,
  received_at, retention_expires_at, participant_role, participant_trust
)
values (
  '88470000-0000-4000-8000-000000000001',
  '88460000-0000-4000-8000-000000000001',
  '88450000-0000-4000-8000-000000000005',
  'assignment-source-message',
  'inbound',
  'received',
  'email-customer@example.test',
  'info@example.test',
  'Synthetic assignment thread',
  'Synthetic redacted body.',
  true,
  now(),
  now() + interval '180 days',
  'customer',
  'verified'
);

insert into public.refund_gmail_first_contact_operations (
  id, gmail_thread_id, refund_case_id, source_message_id, operation_key,
  mode, template_key, status, cutover_at
)
values (
  '88480000-0000-4000-8000-000000000001',
  '88460000-0000-4000-8000-000000000001',
  '88450000-0000-4000-8000-000000000005',
  '88470000-0000-4000-8000-000000000001',
  'refund-assignment-first-contact-operation',
  'isolated_test',
  'refund_assignment_test_v1',
  'pending_send',
  now()
);

insert into public.refund_gmail_intake_links (
  id, operation_id, refund_case_id, token_hash, expires_at
)
values (
  '88490000-0000-4000-8000-000000000001',
  '88480000-0000-4000-8000-000000000001',
  '88450000-0000-4000-8000-000000000005',
  repeat('b', 64),
  now() + interval '1 day'
);

create temporary table linked_email_case as
select public.service_link_refund_gmail_draft_from_hosted_form(
  repeat('b', 64),
  'email-customer@example.test',
  jsonb_build_object(
    'reportingMachineId', '88430000-0000-4000-8000-000000000004',
    'reportingLocationId', '88420000-0000-4000-8000-000000000001',
    'customerName', 'Synthetic Email Customer',
    'customerPhone', '',
    'zellePaymentContact', '',
    'issueSummary', 'Synthetic hosted-form details.',
    'incidentAt', '2026-08-12T17:45:00Z',
    'incidentLocalDateTime', '2026-08-12T10:45',
    'incidentTimezone', 'America/Los_Angeles',
    'incidentTimeResolution', 'exact',
    'paymentMethod', 'card',
    'paymentAmountCents', 1,
    'cardLast4', '0000',
    'cardWalletUsed', false,
    'paymentInteraction', 'unsure',
    'incidentTimeConfidence', 'rough',
    'issueCategory', 'other',
    'status', 'needs_review',
    'correlationStatus', 'needs_nayax',
    'correlationSource', '',
    'correlationConfidence', 0,
    'correlationSummary', 'Synthetic manager review required.',
    'matchedSalesFactId', '',
    'intakeMeta', jsonb_build_object('payload_redacted', true),
    'serverDedupeKey', repeat('c', 64),
    'serverDedupeWindowStartedAt', '2026-08-12T17:40:00Z'
  )
) as result;

select is(
  (select result ->> 'id' from linked_email_case),
  '88450000-0000-4000-8000-000000000005',
  'The private form completes the original Gmail case'
);

select is(
  (select assigned_manager_id from public.refund_cases where id = '88450000-0000-4000-8000-000000000005'),
  '88400000-0000-4000-8000-000000000003'::uuid,
  'Email-linked form completion assigns the sole current mapped manager atomically'
);

select is(
  (select intake_meta ->> 'manager_assignment_status' from public.refund_cases where id = '88450000-0000-4000-8000-000000000005'),
  'assigned_sole_current_manager',
  'Email-linked completion records the same assignment rule as direct intake'
);

select ok(
  (select used_at is not null from public.refund_gmail_intake_links where id = '88490000-0000-4000-8000-000000000001'),
  'The assignment and private context consumption commit together'
);

create temporary table email_case_cc as
select public.service_resolve_refund_customer_manager_cc(
  '88450000-0000-4000-8000-000000000005',
  'email-customer@example.test',
  array['info@example.test', 'support@example.test']
) as result;

select is(
  (select result ->> 'status' from email_case_cc),
  'resolved',
  'Case-specific delivery resolves the current manager route after email completion'
);

select is(
  (select result -> 'managerCcEmails' from email_case_cc),
  '["assignment-manager-three@example.test"]'::jsonb,
  'Case-specific CC comes from the current mapping even though the manager was not a mailbox participant'
);

select is(
  (
    select count(*)::integer
    from public.refund_case_events
    where refund_case_id = '88450000-0000-4000-8000-000000000005'
      and event_type = 'email_hosted_form_linked'
      and metadata ->> 'official_action' = 'false'
  ),
  1,
  'Email assignment remains a redacted non-official intake action'
);

select * from finish();
rollback;
