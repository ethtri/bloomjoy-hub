begin;

create extension if not exists pgtap with schema extensions;
set local search_path = public, extensions;
select plan(28);

insert into auth.users (
  instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at
) values (
  '00000000-0000-0000-0000-000000000000',
  '14550000-0000-4000-8000-000000000001', 'authenticated', 'authenticated',
  'info-health-admin@example.test', '', now(), '{}'::jsonb, '{}'::jsonb, now(), now()
);
insert into public.admin_roles (user_id, role, active)
values ('14550000-0000-4000-8000-000000000001', 'super_admin', true);
select set_config('request.jwt.claim.sub', '14550000-0000-4000-8000-000000000001', true);
select set_config('request.jwt.claims',
  '{"sub":"14550000-0000-4000-8000-000000000001","role":"authenticated","is_anonymous":false}', true);

select ok(not has_function_privilege('authenticated',
  'public.service_mark_refund_info_inquiry(uuid,text)', 'execute'),
  'Only the trusted Gmail service can mark a verified Info inquiry');
select ok(has_function_privilege('service_role',
  'public.service_mark_refund_info_inquiry(uuid,text)', 'execute'),
  'The Gmail service can mark a verified Info inquiry');
select ok(not has_function_privilege('authenticated',
  'public.service_record_refund_info_inquiry_run(uuid,integer,integer,integer,integer,integer,integer,integer,integer,text,boolean)',
  'execute'), 'Browser callers cannot write Info outcome counts');
select ok(not has_function_privilege('authenticated',
  'public.get_refund_gmail_health_base_1455()', 'execute'),
  'The base health implementation is not exposed as a bypass');
select ok(not has_function_privilege('authenticated',
  'public.service_get_refund_info_inquiry_scan_cursor()', 'execute'),
  'The private Gmail backlog cursor is service-only');

create temporary table info_case_baseline as
select count(*)::integer as case_count from public.refund_cases;

create temporary table info_source as
select public.service_ingest_refund_gmail_contact_v1(
  repeat('5',64), 'info-inquiry-synthetic-thread', 'info-inquiry-synthetic-message',
  '<info-inquiry-synthetic-message@example.test>', null, 'inbound', false,
  'info-inquiry-customer@example.test', 'Synthetic Customer',
  'info@bloomjoysweets.com', 'Refund request',
  'My Bloomjoy machine did not dispense. I would like a refund.', false,
  now() - interval '31 minutes', null, '[]'::jsonb, '{}'::text[],
  array['info@bloomjoysweets.com','refunds@bloomjoysweets.com'],
  'direct_human', false, false, '{}'::text[]
) as result;

select is((select result->>'contactOnly' from info_source), 'true',
  'An Info message remains a pre-form contact');
select is((select count(*)::integer from public.refund_cases),
  (select case_count from info_case_baseline),
  'The Info message does not create a refund case');

select ok(public.service_mark_refund_info_inquiry(
  (select (result->>'messageId')::uuid from info_source), 'new_refund_inquiry'),
  'Verified same-mailbox source becomes an eligible inquiry');
select ok(public.service_mark_refund_info_inquiry(
  (select (result->>'messageId')::uuid from info_source), 'new_refund_inquiry'),
  'Replaying the same classification does not create another obligation');
select is((public.get_refund_gmail_health()->'infoInquiry'->>'unansweredDueCount')::integer,
  1, 'An eligible unanswered inquiry is due after 30 minutes');
select is(public.get_refund_gmail_health()->>'status', 'failing',
  'A successful scheduler cannot hide an overdue Info inquiry');

insert into public.refund_gmail_sync_runs
  (id, run_key, trigger_source, status, started_at)
values ('14550000-0000-4000-8000-000000000002',
  'github-manual:1455:1', 'manual', 'running', now());
update public.refund_gmail_sync_state
set last_run_id = '14550000-0000-4000-8000-000000000002'
where singleton;
select ok(public.service_record_refund_info_inquiry_run(
  '14550000-0000-4000-8000-000000000002', 3, 1, 0, 0, 1, 1, 0, 0,
  'synthetic-next-page', false),
  'Service records an outcome partition on the existing sync run');
select is((select info_inquiries_eligible from public.refund_gmail_sync_runs
  where id='14550000-0000-4000-8000-000000000002'), 1,
  'The eligible count is durable');
select is(public.service_get_refund_info_inquiry_scan_cursor(),
  'synthetic-next-page', 'The next recovery page is durable between scheduled runs');
select ok(not public.service_record_refund_info_inquiry_run(
  '14550000-0000-4000-8000-000000000002', 1, 2, 0, 0, 0, 0, 0, 0, null, false),
  'Impossible outcome totals are rejected');
select ok(public.service_record_refund_info_inquiry_run(
  '14550000-0000-4000-8000-000000000002', 3, 1, 0, 0, 1, 1, 0, 0,
  null, true), 'A completed full recovery scan is recorded on the existing sync state');
select ok((public.get_refund_gmail_health()->'infoInquiry'->>'lastFullMailboxScanAt') is not null,
  'Health exposes the bounded completed mailbox-audit time');

create temporary table info_claim as
select public.service_claim_refund_gmail_contact_first_response(
  (select (result->>'messageId')::uuid from info_source), 'active',
  now() - interval '1 hour', 'refund_first_contact_v1',
  'refunds@bloomjoysweets.com',
  'Please use https://app.bloomjoyusa.com/refunds/request', false
) as result;
select is((select result->>'claimed' from info_claim), 'true',
  'The existing one-response ledger claims the original Info thread');
select ok(public.service_finish_refund_gmail_contact_first_response(
  (select (result->>'operationId')::uuid from info_claim), 'sent',
  'synthetic-info-provider-message',
  (select '<refund-' || left(regexp_replace(result->>'operationKey',
    '[^a-zA-Z0-9._-]', '', 'g'), 80) || '@bloomjoyusa.com>' from info_claim),
  null), 'The existing writer records the sent receipt');
select is((public.get_refund_gmail_health()->'infoInquiry'->>'unansweredDueCount')::integer,
  0, 'A confirmed same-thread response resolves the unanswered obligation');

create temporary table info_prior_status as
select public.service_ingest_refund_gmail_contact_v1(
  repeat('5',64), 'info-inquiry-later-new', 'info-inquiry-old-status',
  '<info-inquiry-old-status@example.test>', null, 'inbound', false,
  'later-new@example.test', 'Synthetic Customer',
  'info@bloomjoysweets.com', 'Status question',
  'What is the status of my refund?', false,
  now() - interval '25 minutes', null, '[]'::jsonb, '{}'::text[],
  array['info@bloomjoysweets.com','refunds@bloomjoysweets.com'],
  'direct_human', false, false, '{}'::text[]
) as result;
create temporary table info_later_new as
select public.service_ingest_refund_gmail_contact_v1(
  repeat('5',64), 'info-inquiry-later-new', 'info-inquiry-later-new-message',
  '<info-inquiry-later-new-message@example.test>',
  '<info-inquiry-old-status@example.test>', 'inbound', false,
  'later-new@example.test', 'Synthetic Customer',
  'info@bloomjoysweets.com', 'New purchase issue',
  'I made another purchase and need a refund.', false,
  now() - interval '10 minutes', null, '[]'::jsonb, '{}'::text[],
  array['info@bloomjoysweets.com','refunds@bloomjoysweets.com'],
  'direct_human', false, false, '{}'::text[]
) as result;
select ok(public.service_mark_refund_info_inquiry(
  (select (result->>'messageId')::uuid from info_later_new), 'new_refund_inquiry'),
  'The latest verified Info inquiry is bound to its exact later message');
create temporary table info_later_claim as
select public.service_claim_refund_gmail_contact_first_response(
  (select (result->>'messageId')::uuid from info_later_new), 'active',
  now() - interval '1 hour', 'refund_first_contact_v1',
  'refunds@bloomjoysweets.com',
  'Please use https://app.bloomjoyusa.com/refunds/request', false
) as result;
select is((select result->>'claimed' from info_later_claim), 'true',
  'A later genuine new inquiry can use the original-thread one-response ledger');
select is(
  public.service_claim_refund_gmail_contact_first_response(
    (select (result->>'messageId')::uuid from info_later_new), 'active',
    now() - interval '1 hour', 'refund_first_contact_v1',
    'refunds@bloomjoysweets.com',
    'Please use https://app.bloomjoyusa.com/refunds/request', false
  )->>'reason', 'operation_already_exists',
  'Replaying the later Info inquiry cannot claim a second response');

create temporary table manually_answered_info as
select public.service_ingest_refund_gmail_contact_v1(
  repeat('5',64), 'info-inquiry-already-answered', 'info-inquiry-prior-customer',
  '<info-inquiry-prior-customer@example.test>', null, 'inbound', false,
  'already-helped@example.test', 'Synthetic Customer',
  'info@bloomjoysweets.com', 'Refund request',
  'I paid and the cotton candy machine did not dispense.', false,
  now() - interval '31 minutes', null, '[]'::jsonb, '{}'::text[],
  array['info@bloomjoysweets.com','refunds@bloomjoysweets.com'],
  'direct_human', false, false, '{}'::text[]
) as result;
select public.service_ingest_refund_gmail_contact_v1(
  repeat('5',64), 'info-inquiry-already-answered', 'info-inquiry-prior-outbound',
  '<info-inquiry-prior-outbound@example.test>',
  '<info-inquiry-prior-customer@example.test>', 'outbound', false,
  'refunds@bloomjoysweets.com', 'Bloomjoy Refunds',
  'already-helped@example.test', 'Refund request',
  'I am sorry. Please use the hosted refund request form.', false,
  now() - interval '1 minute', null, '[]'::jsonb, '{}'::text[],
  array['info@bloomjoysweets.com','refunds@bloomjoysweets.com'],
  'direct_human', true, false, '{}'::text[]
);
select ok(public.service_mark_refund_info_inquiry(
  (select (result->>'messageId')::uuid from manually_answered_info), 'new_refund_inquiry'),
  'Historical eligible Info mail is reconciled without resending');
select is((public.get_refund_gmail_health()->'infoInquiry'->>'unansweredDueCount')::integer,
  0, 'An actual later same-thread manual sent message resolves the old inquiry');
select is(
  public.service_claim_refund_gmail_contact_first_response(
    (select (result->>'messageId')::uuid from manually_answered_info), 'active',
    now() - interval '1 hour', 'refund_first_contact_v1',
    'refunds@bloomjoysweets.com',
    'Please use https://app.bloomjoyusa.com/refunds/request', true
  )->>'reason',
  'prior_mailbox_reply', 'The existing writer refuses a duplicate form-link response');

create temporary table answered_review_info as
select public.service_ingest_refund_gmail_contact_v1(
  repeat('5',64), 'info-inquiry-answered-review', 'info-inquiry-review-source',
  '<info-inquiry-review-source@example.test>', null, 'inbound', false,
  'review-helped@example.test', 'Synthetic Customer',
  'info@bloomjoysweets.com', 'Question about existing request',
  'I asked about my refund request status.', false,
  now() - interval '31 minutes', null, '[]'::jsonb, '{}'::text[],
  array['info@bloomjoysweets.com','refunds@bloomjoysweets.com'],
  'direct_human', false, false, '{}'::text[]
) as result;
select ok(public.service_mark_refund_info_inquiry(
  (select (result->>'messageId')::uuid from answered_review_info),
  'existing_case_question')
  and (public.get_refund_gmail_health()->'infoInquiry'->>'reviewDueCount')::integer = 1,
  'A current unanswered Info status question remains reviewable after 30 minutes');
select public.service_ingest_refund_gmail_contact_v1(
  repeat('5',64), 'info-inquiry-answered-review', 'info-inquiry-review-outbound',
  '<info-inquiry-review-outbound@example.test>',
  '<info-inquiry-review-source@example.test>', 'outbound', false,
  'refunds@bloomjoysweets.com', 'Bloomjoy Refunds',
  'review-helped@example.test', 'Question about existing request',
  'We have your request and will follow up.', false,
  now() - interval '1 minute', null, '[]'::jsonb, '{}'::text[],
  array['info@bloomjoysweets.com','refunds@bloomjoysweets.com'],
  'direct_human', true, false, '{}'::text[]
);
select ok((public.get_refund_gmail_health()->'infoInquiry'->>'reviewDueCount')::integer = 0,
  'A confirmed later same-thread reply resolves a reviewable Info question');

select * from finish();
rollback;
