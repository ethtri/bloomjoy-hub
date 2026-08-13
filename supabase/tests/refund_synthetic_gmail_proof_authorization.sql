begin;

create extension if not exists pgtap with schema extensions;
set local search_path = public, extensions;

select no_plan();

insert into auth.users (
  instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at
)
values
  ('00000000-0000-0000-0000-000000000000', '80000000-0000-4000-8000-000000000001',
   'authenticated', 'authenticated', 'proof-manager-one@example.test', '', now(),
   '{}'::jsonb, '{}'::jsonb, now(), now()),
  ('00000000-0000-0000-0000-000000000000', '80000000-0000-4000-8000-000000000002',
   'authenticated', 'authenticated', 'proof-manager-two@example.test', '', now(),
   '{}'::jsonb, '{}'::jsonb, now(), now());

insert into public.customer_accounts (id, name, account_type)
values ('80010000-0000-4000-8000-000000000001', 'Synthetic Gmail proof', 'customer');

insert into public.reporting_locations (id, account_id, name, timezone)
values (
  '80020000-0000-4000-8000-000000000001',
  '80010000-0000-4000-8000-000000000001',
  'Synthetic Gmail proof location',
  'America/Los_Angeles'
);

insert into public.reporting_machines (id, account_id, location_id, machine_label)
values (
  '80030000-0000-4000-8000-000000000001',
  '80010000-0000-4000-8000-000000000001',
  '80020000-0000-4000-8000-000000000001',
  'Synthetic Gmail proof machine'
);

insert into public.reporting_machine_refund_managers (
  id, reporting_machine_id, manager_user_id, manager_email, status,
  grant_reason, revoked_at, revoke_reason
)
values
  ('80040000-0000-4000-8000-000000000001',
   '80030000-0000-4000-8000-000000000001',
   '80000000-0000-4000-8000-000000000001',
   'proof-manager-one@example.test', 'active', 'Synthetic Gmail proof', null, null),
  ('80040000-0000-4000-8000-000000000002',
   '80030000-0000-4000-8000-000000000001',
   '80000000-0000-4000-8000-000000000002',
   'proof-manager-two@example.test', 'revoked', 'Synthetic Gmail proof', now(),
   'Inactive proof route');

create temporary table synthetic_proof_ingest as
select public.service_ingest_refund_gmail_message_v2(
  repeat('8', 64),
  'synthetic-proof-thread',
  'synthetic-proof-inbound',
  '<synthetic-proof-inbound@bloomjoysweets.com>',
  null,
  'inbound',
  false,
  'etrifari+refundpilot-db@bloomjoysweets.com',
  'Synthetic Owner Customer',
  'info@bloomjoysweets.com',
  'Synthetic refund proof',
  'Owner-controlled synthetic request.',
  false,
  now() - interval '1 hour',
  null,
  '[]'::jsonb,
  '{}'::text[],
  array[
    'info@bloomjoysweets.com',
    'support@bloomjoysweets.com',
    'refunds@bloomjoysweets.com'
  ]::text[],
  'direct_human',
  false,
  false,
  '{}'::text[]
) as result;

update public.refund_cases
set
  reporting_machine_id = '80030000-0000-4000-8000-000000000001',
  reporting_location_id = '80020000-0000-4000-8000-000000000001',
  incident_at = now() - interval '1 day',
  payment_method = 'card',
  payment_amount_cents = 500,
  status = 'needs_review'
where id = (select (result ->> 'caseId')::uuid from synthetic_proof_ingest);

select ok(
  not has_table_privilege(
    'authenticated',
    'public.refund_synthetic_gmail_proof_authorizations',
    'select'
  ),
  'Browser users cannot read synthetic proof authorizations'
);
select ok(
  not has_table_privilege(
    'service_role',
    'public.refund_synthetic_gmail_proof_authorizations',
    'select'
  ),
  'Service workers cannot read synthetic proof authorizations directly'
);
select ok(
  not has_table_privilege(
    'authenticated',
    'public.refund_synthetic_gmail_proof_authorizations',
    'insert'
  ),
  'Browser users cannot create an arbitrary proof target'
);
select ok(
  not has_table_privilege(
    'service_role',
    'public.refund_synthetic_gmail_proof_authorizations',
    'insert'
  ),
  'Service workers cannot create an arbitrary proof target'
);
select ok(
  not has_function_privilege(
    'authenticated',
    'public.service_authorize_refund_synthetic_gmail_proof(uuid,text,text,text,boolean)',
    'execute'
  ),
  'Browser users cannot invoke the proof authorization RPC'
);
select ok(
  has_function_privilege(
    'service_role',
    'public.service_authorize_refund_synthetic_gmail_proof(uuid,text,text,text,boolean)',
    'execute'
  ),
  'Only the service path can invoke proof authorization'
);
select ok(
  not has_function_privilege(
    'service_role',
    'public.owner_prepare_refund_synthetic_gmail_proof(uuid,text,text)',
    'execute'
  ),
  'Service workers cannot prepare a proof window'
);
select ok(
  public.refund_synthetic_gmail_proof_recipient_allowed(
    'etrifari+refundpilot-db@bloomjoysweets.com'
  ),
  'The explicit owner-controlled plus-address is eligible'
);
select ok(
  not public.refund_synthetic_gmail_proof_recipient_allowed(
    'real-customer@example.test'
  ),
  'An arbitrary recipient is never eligible'
);
select ok(
  not exists (
    select 1
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'refund_synthetic_gmail_proof_authorizations'
      and column_name in ('recipient_email', 'run_token')
  ),
  'The proof table stores recipient and run token only as digests'
);

select throws_ok(
  format(
    $$select public.owner_prepare_refund_synthetic_gmail_proof(%L, %L, %L)$$,
    (select result ->> 'caseId' from synthetic_proof_ingest),
    repeat('a', 64),
    'WRONG_CONFIRMATION'
  ),
  'P0001',
  'Exact synthetic Gmail proof confirmation is required',
  'Proof preparation requires the exact owner confirmation'
);

update public.refund_cases
set status = 'waiting_on_customer'
where id = (select (result ->> 'caseId')::uuid from synthetic_proof_ingest);
select throws_ok(
  format(
    $$select public.owner_prepare_refund_synthetic_gmail_proof(%L, %L, %L)$$,
    (select result ->> 'caseId' from synthetic_proof_ingest),
    repeat('a', 64),
    'PREPARE_ONE_OWNER_CONTROLLED_SYNTHETIC_GMAIL_SEND'
  ),
  'P0001',
  'Case is not an eligible owner-controlled synthetic Gmail proof',
  'A customer case outside exact manager review cannot open a synthetic proof window'
);
update public.refund_cases
set status = 'needs_review'
where id = (select (result ->> 'caseId')::uuid from synthetic_proof_ingest);

create temporary table first_proof_prepared as
select public.owner_prepare_refund_synthetic_gmail_proof(
  (select (result ->> 'caseId')::uuid from synthetic_proof_ingest),
  repeat('a', 64),
  'PREPARE_ONE_OWNER_CONTROLLED_SYNTHETIC_GMAIL_SEND'
) as result;

select ok(
  (select (result ->> 'prepared')::boolean from first_proof_prepared),
  'The database owner can prepare the exact existing synthetic Gmail case'
);
select is(
  (select (result ->> 'expectedManagerCount')::integer from first_proof_prepared),
  1,
  'Preparation freezes the complete one-manager route'
);
select ok(
  (
    select expires_at > prepared_at
      and expires_at <= prepared_at + interval '5 minutes'
    from public.refund_synthetic_gmail_proof_authorizations
    where id = (select (result ->> 'authorizationId')::uuid from first_proof_prepared)
  ),
  'The one-shot proof expires within five minutes'
);
select is(
  (
    select count(*)::integer
    from public.refund_synthetic_gmail_proof_authorizations
    where cancelled_at is null
  ),
  1,
  'Only one unclosed proof window can exist globally'
);

select set_config('request.jwt.claim.role', 'service_role', true);
select set_config('request.jwt.claims', '{"role":"service_role"}', true);

select is(
  public.service_authorize_refund_synthetic_gmail_proof(
    '80090000-0000-4000-8000-000000000099',
    'etrifari+refundpilot-db@bloomjoysweets.com', repeat('a', 64),
    'status_update', true
  ) ->> 'status',
  'case_mismatch',
  'A wrong case is rejected before consumption'
);
select is(
  public.service_authorize_refund_synthetic_gmail_proof(
    (select (result ->> 'caseId')::uuid from synthetic_proof_ingest),
    'real-customer@example.test', repeat('a', 64), 'status_update', true
  ) ->> 'status',
  'recipient_mismatch',
  'A wrong recipient is rejected before consumption'
);
select is(
  public.service_authorize_refund_synthetic_gmail_proof(
    (select (result ->> 'caseId')::uuid from synthetic_proof_ingest),
    'etrifari+refundpilot-db@bloomjoysweets.com', repeat('c', 64),
    'status_update', true
  ) ->> 'status',
  'token_mismatch',
  'A wrong run-token digest is rejected before consumption'
);
select is(
  public.service_authorize_refund_synthetic_gmail_proof(
    (select (result ->> 'caseId')::uuid from synthetic_proof_ingest),
    'etrifari+refundpilot-db@bloomjoysweets.com', repeat('a', 64),
    'more_info', true
  ) ->> 'status',
  'template_mismatch',
  'A non-status message is rejected'
);
select is(
  public.service_authorize_refund_synthetic_gmail_proof(
    (select (result ->> 'caseId')::uuid from synthetic_proof_ingest),
    'etrifari+refundpilot-db@bloomjoysweets.com', repeat('a', 64),
    'status_update', false
  ) ->> 'status',
  'template_mismatch',
  'Custom subject, body, triage, or fields are rejected'
);
select is(
  (
    select count(*)::integer
    from public.refund_case_messages
    where refund_case_id = (select (result ->> 'caseId')::uuid from synthetic_proof_ingest)
  ),
  0,
  'Rejected proof requests create zero case messages'
);

update public.reporting_machine_refund_managers
set status = 'revoked', revoked_at = now(), revoke_reason = 'Synthetic route change'
where id = '80040000-0000-4000-8000-000000000001';
update public.reporting_machine_refund_managers
set status = 'active', revoked_at = null, revoke_reason = null
where id = '80040000-0000-4000-8000-000000000002';

select is(
  public.service_authorize_refund_synthetic_gmail_proof(
    (select (result ->> 'caseId')::uuid from synthetic_proof_ingest),
    'etrifari+refundpilot-db@bloomjoysweets.com', repeat('a', 64),
    'status_update', true
  ) ->> 'status',
  'manager_route_changed',
  'A changed mapped-manager route is rejected'
);

update public.reporting_machine_refund_managers
set status = 'active', revoked_at = null, revoke_reason = null
where id = '80040000-0000-4000-8000-000000000001';
update public.reporting_machine_refund_managers
set status = 'revoked', revoked_at = now(), revoke_reason = 'Inactive proof route'
where id = '80040000-0000-4000-8000-000000000002';

update public.refund_synthetic_gmail_proof_authorizations
set
  prepared_at = statement_timestamp() - interval '5 minutes',
  expires_at = statement_timestamp() - interval '1 second'
where id = (select (result ->> 'authorizationId')::uuid from first_proof_prepared);

select is(
  public.service_authorize_refund_synthetic_gmail_proof(
    (select (result ->> 'caseId')::uuid from synthetic_proof_ingest),
    'etrifari+refundpilot-db@bloomjoysweets.com', repeat('a', 64),
    'status_update', true
  ) ->> 'status',
  'expired',
  'An expired run token is rejected'
);
select is(
  public.service_authorize_refund_synthetic_gmail_proof(
    (select (result ->> 'caseId')::uuid from synthetic_proof_ingest),
    'etrifari+refundpilot-db@bloomjoysweets.com', '', 'status_update', true
  ) ->> 'status',
  'expired',
  'An expired but unclosed proof keeps blocking unrelated sends'
);
select is(
  (
    public.owner_close_refund_synthetic_gmail_proof(
      (select (result ->> 'authorizationId')::uuid from first_proof_prepared),
      'CLOSE_SYNTHETIC_GMAIL_PROOF_WINDOW'
    ) ->> 'activeAuthorizationCount'
  )::integer,
  0,
  'Owner teardown closes the expired exclusive window'
);

create temporary table delivery_proof_prepared as
select public.owner_prepare_refund_synthetic_gmail_proof(
  (select (result ->> 'caseId')::uuid from synthetic_proof_ingest),
  repeat('b', 64),
  'PREPARE_ONE_OWNER_CONTROLLED_SYNTHETIC_GMAIL_SEND'
) as result;

create temporary table delivery_authorized as
select public.service_authorize_refund_synthetic_gmail_proof(
  (select (result ->> 'caseId')::uuid from synthetic_proof_ingest),
  'etrifari+refundpilot-db@bloomjoysweets.com', repeat('b', 64),
  'status_update', true
) as result;

select ok(
  (select (result ->> 'allowed')::boolean from delivery_authorized),
  'The exact case, recipient, token, default template, and route are authorized once'
);
select is(
  (select result ->> 'authorizationId' from delivery_authorized),
  (select result ->> 'authorizationId' from delivery_proof_prepared),
  'Authorization returns only the prepared internal binding'
);
select is(
  public.service_authorize_refund_synthetic_gmail_proof(
    (select (result ->> 'caseId')::uuid from synthetic_proof_ingest),
    'etrifari+refundpilot-db@bloomjoysweets.com', repeat('b', 64),
    'status_update', true
  ) ->> 'status',
  'already_consumed',
  'A replay cannot authorize a second message'
);

insert into public.refund_case_messages (
  id, refund_case_id, message_type, status, recipient_email, subject, body,
  template_key, created_by, content_source, delivery_kind, requested_fields
)
values (
  '80050000-0000-4000-8000-000000000001',
  (select (result ->> 'caseId')::uuid from synthetic_proof_ingest),
  'status_update', 'pending',
  'etrifari+refundpilot-db@bloomjoysweets.com',
  'We are reviewing your refund request',
  'Thank you for your patience. We are reviewing your request.',
  'refund_status_update_editable_v1',
  '80000000-0000-4000-8000-000000000001',
  'manager_authored', 'manual', '{}'::text[]
);

select ok(
  public.service_bind_refund_synthetic_gmail_proof_message(
    (select (result ->> 'authorizationId')::uuid from delivery_authorized),
    (select (result ->> 'caseId')::uuid from synthetic_proof_ingest),
    '80050000-0000-4000-8000-000000000001'
  ),
  'The consumed authorization binds exactly one compliant case message'
);
select is(
  public.service_verify_refund_synthetic_gmail_proof_transport(
    (select (result ->> 'caseId')::uuid from synthetic_proof_ingest),
    '80050000-0000-4000-8000-000000000001',
    'etrifari+refundpilot-db@bloomjoysweets.com',
    '80090000-0000-4000-8000-000000000099'
  ) ->> 'status',
  'authorization_mismatch',
  'Transport rejects the wrong internal authorization before claim'
);
select ok(
  (
    public.service_verify_refund_synthetic_gmail_proof_transport(
      (select (result ->> 'caseId')::uuid from synthetic_proof_ingest),
      '80050000-0000-4000-8000-000000000001',
      'etrifari+refundpilot-db@bloomjoysweets.com',
      (select (result ->> 'authorizationId')::uuid from delivery_authorized)
    ) ->> 'allowed'
  )::boolean,
  'Transport re-verifies the exact case, message, recipient, route, and expiry'
);

create temporary table synthetic_proof_claim as
select public.service_claim_refund_gmail_outbound_v3(
  (select (result ->> 'caseId')::uuid from synthetic_proof_ingest),
  '80050000-0000-4000-8000-000000000001',
  'refund-case-message:80050000-0000-4000-8000-000000000001',
  'info@bloomjoysweets.com',
  'etrifari+refundpilot-db@bloomjoysweets.com',
  'Thank you for your patience. We are reviewing your request.',
  array[
    'info@bloomjoysweets.com',
    'support@bloomjoysweets.com',
    'refunds@bloomjoysweets.com'
  ]::text[],
  'manual',
  (select (result ->> 'gmailThreadId')::uuid from delivery_authorized)
) as result;

select ok(
  (select (result ->> 'claimed')::boolean from synthetic_proof_claim),
  'The approved proof creates exactly one outbound Gmail claim'
);
select is(
  (select result ->> 'gmailThreadId' from synthetic_proof_claim),
  (select result ->> 'gmailThreadId' from delivery_authorized),
  'The outbound claim remains on the original linked thread'
);
select is(
  (select (result ->> 'managerCcCount')::integer from synthetic_proof_claim),
  1,
  'The outbound claim includes every current mapped manager'
);
select ok(
  public.service_finish_refund_gmail_outbound(
    (select (result ->> 'transportMessageId')::uuid from synthetic_proof_claim),
    'sent',
    'synthetic-provider-message',
    '<synthetic-provider-message@bloomjoysweets.com>',
    null
  ),
  'Synthetic provider evidence finalizes the one Gmail claim'
);
update public.refund_case_messages
set status = 'sent', sent_at = now()
where id = '80050000-0000-4000-8000-000000000001';

create temporary table synthetic_proof_summary as
select public.owner_get_refund_synthetic_gmail_proof_summary(
  (select (result ->> 'authorizationId')::uuid from delivery_authorized),
  'READ_REDACTED_SYNTHETIC_GMAIL_PROOF'
) as result;

select ok(
  (select (result ->> 'proofPassed')::boolean from synthetic_proof_summary),
  'Aggregate evidence proves exactly one safe case-specific Gmail send'
);
select ok(
  (
    select
      (result ->> 'globalCaseMessageDelta')::integer = 1
      and (result ->> 'globalGmailOutboundDelta')::integer = 1
      and (result ->> 'caseMessageDelta')::integer = 1
      and (result ->> 'caseGmailOutboundDelta')::integer = 1
    from synthetic_proof_summary
  ),
  'Pre/post evidence contains exactly one case message and one Gmail outbound'
);
select is(
  (select (result ->> 'caseAttachmentDelta')::integer from synthetic_proof_summary),
  0,
  'The approved path adds no attachment'
);
select ok(
  (
    select
      (result ->> 'originalThreadPreserved')::boolean
      and (result ->> 'managerRoutePreserved')::boolean
      and (result ->> 'senderIsInfo')::boolean
      and (result ->> 'recipientPreserved')::boolean
      and (result ->> 'unresolvedDeliveryCount')::integer = 0
    from synthetic_proof_summary
  ),
  'Evidence proves Info From, owner To, complete CC, original thread, and no unresolved send'
);
select ok(
  (select result::text not like '%@%' from synthetic_proof_summary)
    and (select (result ->> 'payloadRedacted')::boolean from synthetic_proof_summary),
  'The owner summary contains aggregate redacted evidence and no addresses'
);
select is(
  (
    public.owner_close_refund_synthetic_gmail_proof(
      (select (result ->> 'authorizationId')::uuid from delivery_authorized),
      'CLOSE_SYNTHETIC_GMAIL_PROOF_WINDOW'
    ) ->> 'activeAuthorizationCount'
  )::integer,
  0,
  'Final teardown verifies every exclusive proof gate is closed'
);

select * from finish();
rollback;
