begin;

create extension if not exists pgtap with schema extensions;
set local search_path = public, extensions;

select plan(94);

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

insert into auth.users (
  instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at
)
values
  ('00000000-0000-0000-0000-000000000000', '78600000-0000-4000-8000-000000000001', 'authenticated', 'authenticated', 'manager-one@example.test', '', now(), '{}'::jsonb, '{}'::jsonb, now(), now()),
  ('00000000-0000-0000-0000-000000000000', '78600000-0000-4000-8000-000000000002', 'authenticated', 'authenticated', 'manager-two@example.test', '', now(), '{}'::jsonb, '{}'::jsonb, now(), now()),
  ('00000000-0000-0000-0000-000000000000', '78600000-0000-4000-8000-000000000003', 'authenticated', 'authenticated', 'manager-three@example.test', '', now(), '{}'::jsonb, '{}'::jsonb, now(), now()),
  ('00000000-0000-0000-0000-000000000000', '78600000-0000-4000-8000-000000000004', 'authenticated', 'authenticated', 'former-manager@example.test', '', now(), '{}'::jsonb, '{}'::jsonb, now(), now());
insert into auth.users (
  instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at
)
values (
  '00000000-0000-0000-0000-000000000000', '78600000-0000-4000-8000-000000000005',
  'authenticated', 'authenticated', 'manager-four@example.test', '', now(),
  '{}'::jsonb, '{}'::jsonb, now(), now()
);

insert into public.customer_accounts (id, name, account_type)
values ('78610000-0000-4000-8000-000000000001', 'Participant boundary test', 'customer');

insert into public.reporting_locations (id, account_id, name, timezone)
values (
  '78620000-0000-4000-8000-000000000001',
  '78610000-0000-4000-8000-000000000001',
  'Participant boundary location',
  'America/Los_Angeles'
);

insert into public.reporting_machines (id, account_id, location_id, machine_label)
values
  ('78630000-0000-4000-8000-000000000001', '78610000-0000-4000-8000-000000000001', '78620000-0000-4000-8000-000000000001', 'Mapped machine'),
  ('78630000-0000-4000-8000-000000000002', '78610000-0000-4000-8000-000000000001', '78620000-0000-4000-8000-000000000001', 'Zero-manager machine');

insert into public.reporting_machine_refund_managers (
  id, reporting_machine_id, manager_user_id, manager_email, status, grant_reason,
  revoked_at, revoke_reason
)
values
  ('78640000-0000-4000-8000-000000000001', '78630000-0000-4000-8000-000000000001', '78600000-0000-4000-8000-000000000001', 'manager-one@example.test', 'active', 'Participant CC test', null, null),
  ('78640000-0000-4000-8000-000000000002', '78630000-0000-4000-8000-000000000001', '78600000-0000-4000-8000-000000000002', 'manager-two@example.test', 'active', 'Participant CC test', null, null),
  ('78640000-0000-4000-8000-000000000004', '78630000-0000-4000-8000-000000000001', '78600000-0000-4000-8000-000000000004', 'former-manager@example.test', 'revoked', 'Participant CC test', now(), 'Mapping revoked for participant test');

select ok(
  not has_function_privilege(
    'service_role',
    'public.service_ingest_refund_gmail_message(text,text,text,text,text,text,boolean,text,text,text,text,text,boolean,timestamp with time zone,text,jsonb)',
    'execute'
  ),
  'The participant-blind legacy ingestion RPC is revoked from the service worker'
);
select ok(
  has_function_privilege(
    'service_role',
    'public.service_ingest_refund_gmail_message_v2(text,text,text,text,text,text,boolean,text,text,text,text,text,boolean,timestamp with time zone,text,jsonb,text[],text[],text,boolean,boolean,text[])',
    'execute'
  ),
  'The participant-safe ingestion RPC is service-only'
);
select ok(
  not has_function_privilege(
    'authenticated',
    'public.service_resolve_refund_customer_manager_cc(uuid,text,text[])',
    'execute'
  ),
  'Browser roles cannot resolve raw mapped-manager recipient addresses'
);
select ok(
  not has_table_privilege('authenticated', 'public.refund_gmail_messages', 'select'),
  'Browser roles cannot read raw To or CC rows'
);
select ok(
  has_function_privilege(
    'authenticated',
    'public.admin_recover_refund_gmail_customer_contact(uuid,text,text)',
    'execute'
  ),
  'Authenticated managers can invoke the guarded case-wide recovery boundary'
);
select ok(
  not has_function_privilege(
    'service_role',
    'public.admin_recover_refund_gmail_customer_contact(uuid,text,text)',
    'execute'
  ),
  'Service workers cannot invoke manager hard-bounce recovery'
);
select ok(
  not has_table_privilege('service_role', 'public.refund_gmail_threads', 'update'),
  'Service workers cannot update Gmail thread pause evidence directly'
);
select ok(
  not has_table_privilege('service_role', 'public.refund_gmail_threads', 'delete'),
  'Service workers cannot delete Gmail thread pause evidence directly'
);

create temporary table first_customer_ingest as
select public.service_ingest_refund_gmail_message_v2(
  repeat('c', 64),
  'participant-thread',
  'participant-customer-1',
  '<participant-customer-1@example.test>',
  null,
  'inbound',
  false,
  'customer@example.test',
  'Synthetic Customer',
  'info@bloomjoysweets.com',
  'Refund request',
  'Synthetic refund details.',
  false,
  now() - interval '20 minutes',
  null,
  '[]'::jsonb,
  '{}'::text[],
  array['info@bloomjoysweets.com', 'support@bloomjoysweets.com'],
  'direct_human',
  false,
  false,
  '{}'::text[]
) as result;

update public.refund_cases
set
  reporting_machine_id = '78630000-0000-4000-8000-000000000001',
  reporting_location_id = '78620000-0000-4000-8000-000000000001',
  incident_at = now() - interval '1 hour',
  payment_method = 'card',
  payment_amount_cents = 500,
  status = 'waiting_on_customer',
  automation_state = 'more_info_needed',
  automation_follow_up_due_at = now() + interval '2 days'
where id = (select (result ->> 'caseId')::uuid from first_customer_ingest);

select is(
  (select participant_role from public.refund_gmail_messages where provider_message_id = 'participant-customer-1'),
  'customer',
  'A direct verified first sender is classified as the customer'
);
select is(
  (select direction from public.refund_gmail_messages where provider_message_id = 'participant-customer-1'),
  'inbound',
  'Only verified customer correspondence uses the inbound direction'
);

select public.service_ingest_refund_gmail_message_v2(
  repeat('c', 64), 'participant-thread', 'participant-manager-1', '<participant-manager-1@example.test>',
  '<participant-customer-1@example.test>', 'inbound', false, 'manager-one@example.test', 'Manager One',
  'info@bloomjoysweets.com', 'Re: Refund request', 'I will review this case.', false, now() - interval '15 minutes',
  null, '[]'::jsonb, array['customer@example.test'], array['info@bloomjoysweets.com', 'support@bloomjoysweets.com'], 'direct_human',
  false, false, '{}'::text[]
);

select is(
  (select participant_role from public.refund_gmail_messages where provider_message_id = 'participant-manager-1'),
  'assigned_manager',
  'A current mapped-manager Reply All is classified as manager correspondence'
);
select is(
  (select direction from public.refund_gmail_messages where provider_message_id = 'participant-manager-1'),
  'system',
  'Mapped-manager correspondence cannot enter customer-only inbound processing'
);
select is(
  (select status from public.refund_cases where id = (select (result ->> 'caseId')::uuid from first_customer_ingest)),
  'waiting_on_customer',
  'A manager Reply All does not clear waiting-on-customer state'
);
select is(
  (select automation_state from public.refund_cases where id = (select (result ->> 'caseId')::uuid from first_customer_ingest)),
  'more_info_needed',
  'A manager Reply All does not trigger customer-replied automation state'
);
select is(
  (select count(*)::integer from public.refund_case_events where event_type = 'gmail_manager_correspondence_received'),
  1,
  'Manager correspondence creates one redacted manager event'
);

insert into public.reporting_machine_refund_managers (
  id, reporting_machine_id, manager_user_id, manager_email, status, grant_reason
)
values (
  '78640000-0000-4000-8000-000000000007', '78630000-0000-4000-8000-000000000001',
  '78600000-0000-4000-8000-000000000003', 'customer@example.test', 'active',
  'Synthetic customer-address mapping drift'
);
select public.service_ingest_refund_gmail_message_v2(
  repeat('c', 64), 'participant-thread', 'participant-customer-mapping-drift',
  '<participant-customer-mapping-drift@example.test>', '<participant-customer-1@example.test>',
  'inbound', false, 'customer@example.test', 'Synthetic Customer', 'info@bloomjoysweets.com',
  'Re: Refund request', 'The exact case customer is replying directly.', false,
  now() - interval '14 minutes 55 seconds', null, '[]'::jsonb, '{}'::text[],
  array['info@bloomjoysweets.com', 'support@bloomjoysweets.com'], 'direct_human',
  false, false, '{}'::text[]
);
select is(
  (select participant_role from public.refund_gmail_messages where provider_message_id = 'participant-customer-mapping-drift'),
  'customer',
  'The exact case customer wins over a conflicting active manager mapping'
);
select is(
  (select direction from public.refund_gmail_messages where provider_message_id = 'participant-customer-mapping-drift'),
  'inbound',
  'A customer address affected by manager-mapping drift remains customer evidence'
);
select is(
  (select status from public.refund_cases where id = (select (result ->> 'caseId')::uuid from first_customer_ingest)),
  'needs_review',
  'The exact customer reply clears waiting-on-customer despite mapping drift'
);
select is(
  (select automation_state from public.refund_cases where id = (select (result ->> 'caseId')::uuid from first_customer_ingest)),
  'customer_replied',
  'The exact customer reply triggers customer-replied automation state despite mapping drift'
);
delete from public.reporting_machine_refund_managers
where id = '78640000-0000-4000-8000-000000000007';
update public.refund_cases
set
  status = 'waiting_on_customer',
  automation_state = 'more_info_needed',
  automation_follow_up_due_at = now() + interval '2 days'
where id = (select (result ->> 'caseId')::uuid from first_customer_ingest);

select public.service_ingest_refund_gmail_message_v2(
  repeat('c', 64), 'participant-thread', 'participant-manager-forwarded', '<participant-manager-forwarded@example.test>',
  null, 'inbound', false, 'manager-one@example.test', 'Manager One', 'info@bloomjoysweets.com',
  'Fwd: Refund request', 'Forwarded manager content.', false, now() - interval '14 minutes 50 seconds', null,
  '[]'::jsonb, '{}'::text[], array['info@bloomjoysweets.com', 'support@bloomjoysweets.com'], 'forwarded',
  false, false, '{}'::text[]
);
select is(
  (select participant_role from public.refund_gmail_messages where provider_message_id = 'participant-manager-forwarded'),
  'unknown',
  'A forwarded message using a current manager address is not trusted manager correspondence'
);

select public.service_ingest_refund_gmail_message_v2(
  repeat('c', 64), 'participant-thread', 'participant-manager-spoof', '<participant-manager-spoof@example.test>',
  null, 'inbound', false, 'manager-one@example.test', 'Manager One', 'info@bloomjoysweets.com',
  'Re: Refund request', 'Spoof-suspected manager content.', false, now() - interval '14 minutes 40 seconds', null,
  '[]'::jsonb, '{}'::text[], array['info@bloomjoysweets.com', 'support@bloomjoysweets.com'], 'spoof_suspected',
  false, false, '{}'::text[]
);
select is(
  (select participant_role from public.refund_gmail_messages where provider_message_id = 'participant-manager-spoof'),
  'unknown',
  'A spoof-suspected message using a current manager address is not trusted manager correspondence'
);

select public.service_ingest_refund_gmail_message_v2(
  repeat('c', 64), 'participant-thread', 'participant-former-manager', '<participant-former-manager@example.test>',
  null, 'inbound', false, 'former-manager@example.test', 'Former Manager', 'info@bloomjoysweets.com',
  'Re: Refund request', 'A former manager reply.', false, now() - interval '14 minutes', null,
  '[]'::jsonb, '{}'::text[], array['info@bloomjoysweets.com', 'support@bloomjoysweets.com'], 'direct_human',
  false, false, '{}'::text[]
);
select is(
  (select participant_role from public.refund_gmail_messages where provider_message_id = 'participant-former-manager'),
  'unknown',
  'A revoked manager is not classified as a current manager or customer'
);

select public.service_ingest_refund_gmail_message_v2(
  repeat('c', 64), 'participant-thread', 'participant-forwarded', '<participant-forwarded@example.test>',
  null, 'inbound', false, 'customer@example.test', 'Synthetic Customer', 'info@bloomjoysweets.com',
  'Fwd: Refund request', 'Forwarded content.', false, now() - interval '13 minutes', null,
  '[]'::jsonb, '{}'::text[], array['info@bloomjoysweets.com', 'support@bloomjoysweets.com'], 'forwarded',
  false, false, '{}'::text[]
);
select is(
  (select participant_role from public.refund_gmail_messages where provider_message_id = 'participant-forwarded'),
  'unknown',
  'A forwarded message from the customer address is not verified customer evidence'
);

select public.service_ingest_refund_gmail_message_v2(
  repeat('c', 64), 'participant-thread', 'participant-spoof', '<participant-spoof@example.test>',
  null, 'inbound', false, 'customer@example.test', 'Synthetic Customer', 'info@bloomjoysweets.com',
  'Re: Refund request', 'Spoof-suspected content.', false, now() - interval '12 minutes', null,
  '[]'::jsonb, '{}'::text[], array['info@bloomjoysweets.com', 'support@bloomjoysweets.com'], 'spoof_suspected',
  false, false, '{}'::text[]
);
select is(
  (select participant_trust from public.refund_gmail_messages where provider_message_id = 'participant-spoof'),
  'spoof_suspected',
  'Spoof-suspected correspondence remains explicitly untrusted'
);

select public.service_ingest_refund_gmail_message_v2(
  repeat('c', 64), 'participant-thread', 'participant-alias-no-sent', '<participant-alias-no-sent@example.test>',
  null, 'outbound', false, 'support@bloomjoysweets.com', 'Bloomjoy Support', 'customer@example.test',
  'Re: Refund request', 'Alias-like content without provider Sent evidence.', false, now() - interval '11 minutes 30 seconds', null,
  '[]'::jsonb, '{}'::text[], array['info@bloomjoysweets.com', 'support@bloomjoysweets.com'], 'direct_human',
  false, false, '{}'::text[]
);
select is(
  (select participant_role from public.refund_gmail_messages where provider_message_id = 'participant-alias-no-sent'),
  'unknown',
  'A configured alias is not mailbox-origin without Gmail Sent-label evidence'
);

select public.service_ingest_refund_gmail_message_v2(
  repeat('c', 64), 'participant-thread', 'participant-alias', '<participant-alias@example.test>',
  null, 'outbound', false, 'support@bloomjoysweets.com', 'Bloomjoy Support', 'customer@example.test',
  'Re: Refund request', 'Mailbox alias response.', false, now() - interval '11 minutes', null,
  '[]'::jsonb, array['manager-one@example.test'], array['info@bloomjoysweets.com', 'support@bloomjoysweets.com'], 'automated',
  true, false, '{}'::text[]
);
select is(
  (select participant_role from public.refund_gmail_messages where provider_message_id = 'participant-alias'),
  'mailbox',
  'A configured send-as alias is mailbox-origin even with an automatic header signal'
);

select is(
  public.service_resolve_refund_customer_manager_cc(
    (select (result ->> 'caseId')::uuid from first_customer_ingest),
    'customer@example.test',
    array['info@bloomjoysweets.com', 'support@bloomjoysweets.com']
  ) ->> 'status',
  'resolved',
  'A resolved machine with two valid current mappings has a clean CC result'
);
select is(
  public.service_resolve_refund_customer_manager_cc(
    (select (result ->> 'caseId')::uuid from first_customer_ingest),
    'customer@example.test',
    array['info@bloomjoysweets.com', 'support@bloomjoysweets.com']
  ) -> 'managerCcEmails',
  '["manager-one@example.test", "manager-two@example.test"]'::jsonb,
  'Only current active mapped managers are resolved in deterministic order'
);

alter table public.reporting_machine_refund_managers
  disable trigger reporting_machine_refund_manager_limit;
insert into public.reporting_machine_refund_managers (
  id, reporting_machine_id, manager_user_id, manager_email, status, grant_reason
)
values
  (
    '78640000-0000-4000-8000-000000000005', '78630000-0000-4000-8000-000000000001',
    '78600000-0000-4000-8000-000000000003', 'manager-three@example.test', 'active',
    'Synthetic direct-write mapping drift'
  ),
  (
    '78640000-0000-4000-8000-000000000006', '78630000-0000-4000-8000-000000000001',
    '78600000-0000-4000-8000-000000000005', 'manager-four@example.test', 'active',
    'Synthetic direct-write mapping drift'
  );
alter table public.reporting_machine_refund_managers
  enable trigger reporting_machine_refund_manager_limit;

select is(
  public.service_resolve_refund_customer_manager_cc(
    (select (result ->> 'caseId')::uuid from first_customer_ingest),
    'customer@example.test',
    array['info@bloomjoysweets.com', 'support@bloomjoysweets.com']
  ) ->> 'status',
  'invalid_manager_mapping',
  'More than three distinct active manager mappings fail closed as invalid'
);
select is(
  public.service_resolve_refund_customer_manager_cc(
    (select (result ->> 'caseId')::uuid from first_customer_ingest),
    'customer@example.test',
    array['info@bloomjoysweets.com', 'support@bloomjoysweets.com']
  ) -> 'managerCcEmails',
  '[]'::jsonb,
  'An over-cap mapping returns no visible manager CC recipients'
);
insert into public.refund_case_messages (
  id, refund_case_id, message_type, status, recipient_email, subject, body
)
values
  (
    '78650000-0000-4000-8000-000000000010',
    (select (result ->> 'caseId')::uuid from first_customer_ingest),
    'more_info', 'pending', 'customer@example.test', 'Invalid route send',
    'This customer message must not be claimed while manager routing is invalid.'
  ),
  (
    '78650000-0000-4000-8000-000000000011',
    (select (result ->> 'caseId')::uuid from first_customer_ingest),
    'more_info', 'pending', 'customer@example.test', 'Unresolved route send',
    'This customer message must not be claimed before the machine is resolved.'
  ),
  (
    '78650000-0000-4000-8000-000000000012',
    (select (result ->> 'caseId')::uuid from first_customer_ingest),
    'more_info', 'pending', 'customer@example.test', 'Zero manager route send',
    'This customer message must not be claimed before a current manager is mapped.'
  );
select is(
  public.service_claim_refund_gmail_outbound_v2(
    (select (result ->> 'caseId')::uuid from first_customer_ingest),
    '78650000-0000-4000-8000-000000000010', 'participant-invalid-route',
    'info@bloomjoysweets.com', 'customer@example.test',
    'This customer message must not be claimed while manager routing is invalid.',
    array['info@bloomjoysweets.com', 'support@bloomjoysweets.com'], 'manual'
  ) ->> 'status',
  'manager_cc_required',
  'An invalid manager mapping blocks the outbound claim before customer delivery'
);
select is(
  (select count(*)::integer from public.refund_gmail_messages where operation_key = 'participant-invalid-route'),
  0,
  'An invalid manager mapping creates no outbound Gmail row'
);

delete from public.reporting_machine_refund_managers
where id in (
  '78640000-0000-4000-8000-000000000005',
  '78640000-0000-4000-8000-000000000006'
);

insert into public.refund_case_messages (
  id, refund_case_id, message_type, status, recipient_email, subject, body
)
values (
  '78650000-0000-4000-8000-000000000001',
  (select (result ->> 'caseId')::uuid from first_customer_ingest),
  'more_info', 'pending', 'customer@example.test', 'A humble request for details',
  'We are sorry for the trouble. Could you please confirm the purchase time?'
);

create temporary table first_claim as
select public.service_claim_refund_gmail_outbound_v2(
  (select (result ->> 'caseId')::uuid from first_customer_ingest),
  '78650000-0000-4000-8000-000000000001',
  'participant-cc-operation-1',
  'info@bloomjoysweets.com',
  'customer@example.test',
  'We are sorry for the trouble. Could you please confirm the purchase time?',
  array['info@bloomjoysweets.com', 'support@bloomjoysweets.com'],
  'automatic'
) as result;

select is((select (result ->> 'claimed')::boolean from first_claim), true, 'The original-thread customer send is claimed');
select is((select result ->> 'providerThreadId' from first_claim), 'participant-thread', 'The claim pins the original Gmail thread');
select is((select (result ->> 'managerCcCount')::integer from first_claim), 2, 'Both current mapped managers are visibly copied');
select is(
  (select recipient_email from public.refund_gmail_messages where operation_key = 'participant-cc-operation-1'),
  'customer@example.test',
  'The customer is the sole primary recipient'
);
select is(
  (select recipient_cc_emails from public.refund_gmail_messages where operation_key = 'participant-cc-operation-1'),
  array['manager-one@example.test', 'manager-two@example.test'],
  'The service-only claim stores the exact mapped-manager CC set'
);
select ok(
  pg_temp.capture_error(format(
    'select public.service_claim_refund_gmail_outbound_v2(%L::uuid,%L::uuid,%L,%L,%L,%L,%L::text[],%L)',
    (select (result ->> 'caseId')::uuid from first_customer_ingest),
    '78650000-0000-4000-8000-000000000001',
    'participant-internal-link', 'info@bloomjoysweets.com', 'customer@example.test',
    'Open /refunds?case=internal', '{info@bloomjoysweets.com,support@bloomjoysweets.com}', 'manual'
  )) like '%cannot contain an internal refund case link%',
  'Customer Gmail claims reject internal case links'
);

select public.service_finish_refund_gmail_outbound(
  (select (result ->> 'transportMessageId')::uuid from first_claim),
  'sent',
  'participant-provider-cc-1',
  '<participant-provider-cc-1@example.test>',
  null
);

update public.reporting_machine_refund_managers
set status = 'revoked', revoked_at = now(), revoke_reason = 'Synthetic mapping change'
where id = '78640000-0000-4000-8000-000000000002';
insert into public.reporting_machine_refund_managers (
  id, reporting_machine_id, manager_user_id, manager_email, status, grant_reason
)
values (
  '78640000-0000-4000-8000-000000000003', '78630000-0000-4000-8000-000000000001',
  '78600000-0000-4000-8000-000000000003', 'manager-three@example.test', 'active', 'Synthetic mapping change'
);

select is(
  public.service_resolve_refund_customer_manager_cc(
    (select (result ->> 'caseId')::uuid from first_customer_ingest),
    'customer@example.test',
    array['info@bloomjoysweets.com', 'support@bloomjoysweets.com']
  ) -> 'managerCcEmails',
  '["manager-one@example.test", "manager-three@example.test"]'::jsonb,
  'A later send immediately uses the changed active mapping set'
);

update public.reporting_machine_refund_managers
set manager_email = 'manager-one@example.test'
where id = '78640000-0000-4000-8000-000000000003';
select is(
  public.service_resolve_refund_customer_manager_cc(
    (select (result ->> 'caseId')::uuid from first_customer_ingest),
    'customer@example.test',
    array['info@bloomjoysweets.com', 'support@bloomjoysweets.com']
  ) ->> 'status',
  'resolved',
  'Duplicate normalized manager addresses remain resolved when no distinct active identity is omitted'
);
select is(
  jsonb_array_length(public.service_resolve_refund_customer_manager_cc(
    (select (result ->> 'caseId')::uuid from first_customer_ingest),
    'customer@example.test',
    array['info@bloomjoysweets.com', 'support@bloomjoysweets.com']
  ) -> 'managerCcEmails'),
  1,
  'A duplicate manager address appears only once in visible CC'
);

update public.reporting_machine_refund_managers
set manager_email = 'not-an-email'
where id = '78640000-0000-4000-8000-000000000003';
select is(
  public.service_resolve_refund_customer_manager_cc(
    (select (result ->> 'caseId')::uuid from first_customer_ingest),
    'customer@example.test',
    array['info@bloomjoysweets.com', 'support@bloomjoysweets.com']
  ) ->> 'status',
  'invalid_manager_mapping',
  'A mixed valid and malformed active mapping fails closed'
);

create temporary table mixed_invalid_claim as
select public.service_claim_refund_gmail_outbound_v2(
  (select (result ->> 'caseId')::uuid from first_customer_ingest),
  '78650000-0000-4000-8000-000000000020',
  'participant-mixed-invalid-route',
  'info@bloomjoysweets.com',
  'customer@example.test',
  'This customer message must not be claimed with a partial manager route.',
  array['info@bloomjoysweets.com', 'support@bloomjoysweets.com'],
  'manual'
) as result;
select is(
  (select result ->> 'status' from mixed_invalid_claim),
  'manager_cc_required',
  'A mixed valid and malformed manager route blocks the customer outbound claim'
);
select is(
  (
    select count(*)::integer
    from public.refund_gmail_messages
    where operation_key = 'participant-mixed-invalid-route'
  ),
  0,
  'A mixed invalid manager route creates no outbound Gmail row'
);

update public.reporting_machine_refund_managers
set manager_email = 'manager-three@example.test'
where id = '78640000-0000-4000-8000-000000000003';

update public.reporting_machine_refund_managers
set manager_email = 'customer@example.test'
where id = '78640000-0000-4000-8000-000000000003';
select is(
  public.service_resolve_refund_customer_manager_cc(
    (select (result ->> 'caseId')::uuid from first_customer_ingest),
    'customer@example.test',
    array['info@bloomjoysweets.com', 'support@bloomjoysweets.com']
  ) ->> 'status',
  'invalid_manager_mapping',
  'A customer-address collision in the active manager mapping fails closed'
);
select is(
  public.service_resolve_refund_customer_manager_cc(
    (select (result ->> 'caseId')::uuid from first_customer_ingest),
    'customer@example.test',
    array['info@bloomjoysweets.com', 'support@bloomjoysweets.com']
  ) -> 'managerCcEmails',
  '[]'::jsonb,
  'The case customer never appears in visible manager CC'
);

update public.reporting_machine_refund_managers
set manager_email = 'support@bloomjoysweets.com'
where id = '78640000-0000-4000-8000-000000000003';
select is(
  public.service_resolve_refund_customer_manager_cc(
    (select (result ->> 'caseId')::uuid from first_customer_ingest),
    'customer@example.test',
    array['info@bloomjoysweets.com', 'support@bloomjoysweets.com']
  ) ->> 'status',
  'invalid_manager_mapping',
  'A mailbox-address collision in the active manager mapping fails closed'
);
select is(
  public.service_resolve_refund_customer_manager_cc(
    (select (result ->> 'caseId')::uuid from first_customer_ingest),
    'customer@example.test',
    array['info@bloomjoysweets.com', 'support@bloomjoysweets.com']
  ) -> 'managerCcEmails',
  '[]'::jsonb,
  'A Bloomjoy mailbox identity never appears in visible manager CC'
);

update public.reporting_machine_refund_managers
set manager_email = 'manager-three@example.test'
where id = '78640000-0000-4000-8000-000000000003';

update public.refund_cases
set reporting_machine_id = null, reporting_location_id = null, incident_at = null, payment_method = null, status = 'draft'
where id = (select (result ->> 'caseId')::uuid from first_customer_ingest);
select is(
  public.service_resolve_refund_customer_manager_cc(
    (select (result ->> 'caseId')::uuid from first_customer_ingest),
    'customer@example.test',
    array['info@bloomjoysweets.com']
  ) ->> 'status',
  'machine_unresolved',
  'Before machine resolution the recipient route is explicitly unresolved'
);
select is(
  public.service_claim_refund_gmail_outbound_v2(
    (select (result ->> 'caseId')::uuid from first_customer_ingest),
    '78650000-0000-4000-8000-000000000011', 'participant-unresolved-route',
    'info@bloomjoysweets.com', 'customer@example.test',
    'This customer message must not be claimed before the machine is resolved.',
    array['info@bloomjoysweets.com'], 'manual'
  ) ->> 'status',
  'manager_cc_required',
  'An unresolved machine blocks the outbound claim before customer delivery'
);
select is(
  (select count(*)::integer from public.refund_gmail_messages where operation_key = 'participant-unresolved-route'),
  0,
  'An unresolved machine creates no outbound Gmail row'
);
update public.refund_cases
set
  reporting_machine_id = '78630000-0000-4000-8000-000000000001',
  reporting_location_id = '78620000-0000-4000-8000-000000000001',
  incident_at = now() - interval '1 hour', payment_method = 'card', status = 'waiting_on_customer'
where id = (select (result ->> 'caseId')::uuid from first_customer_ingest);

update public.refund_cases
set reporting_machine_id = '78630000-0000-4000-8000-000000000002'
where id = (select (result ->> 'caseId')::uuid from first_customer_ingest);
create temporary table zero_manager_claim as
select public.service_claim_refund_gmail_outbound_v2(
  (select (result ->> 'caseId')::uuid from first_customer_ingest),
  '78650000-0000-4000-8000-000000000012', 'participant-zero-manager-route',
  'info@bloomjoysweets.com', 'customer@example.test',
  'This customer message must not be claimed before a current manager is mapped.',
  array['info@bloomjoysweets.com'], 'manual'
) as result;
select is(
  (select result ->> 'status' from zero_manager_claim),
  'manager_cc_required',
  'A machine with zero active managers blocks the outbound claim before customer delivery'
);
select is(
  (select result ->> 'recipientResolutionStatus' from zero_manager_claim),
  'no_active_managers',
  'The blocked zero-manager claim preserves its redacted routing reason'
);
select is(
  (select count(*)::integer from public.refund_gmail_messages where operation_key = 'participant-zero-manager-route'),
  0,
  'A zero-manager route creates no outbound Gmail row'
);
update public.refund_cases
set reporting_machine_id = '78630000-0000-4000-8000-000000000001'
where id = (select (result ->> 'caseId')::uuid from first_customer_ingest);

select public.service_ingest_refund_gmail_message_v2(
  repeat('c', 64), 'participant-thread', 'participant-bounce-weak', '<participant-bounce-weak@example.test>',
  null, 'system', true, 'mailer-daemon@googlemail.com', 'Mail Delivery Subsystem', 'info@bloomjoysweets.com',
  'Delivery Status Notification (Failure)', 'Synthetic delivery notice without trusted DSN proof.', false, now() - interval '2 minutes', null,
  '[]'::jsonb, '{}'::text[], array['info@bloomjoysweets.com', 'support@bloomjoysweets.com'], 'automated',
  false, false, array['customer@example.test']
);
select ok(
  (select automatic_customer_contact_paused_at is null from public.refund_gmail_threads where provider_thread_id = 'participant-thread'),
  'A delivery notice without trustworthy hard-bounce evidence does not pause automatic contact'
);
select is(
  (select count(*)::integer from public.refund_case_events where event_type = 'gmail_delivery_notice_received'),
  1,
  'A weak delivery notice creates review evidence without pausing contact'
);

select public.service_ingest_refund_gmail_message_v2(
  repeat('c', 64), 'participant-thread', 'participant-bounce-mismatch', '<participant-bounce-mismatch@example.test>',
  null, 'system', true, 'mailer-daemon@googlemail.com', 'Mail Delivery Subsystem', 'info@bloomjoysweets.com',
  'Delivery Status Notification (Failure)', 'Synthetic hard bounce for a different recipient.', false, now() - interval '1 minute', null,
  '[]'::jsonb, '{}'::text[], array['info@bloomjoysweets.com', 'support@bloomjoysweets.com'], 'automated',
  false, true, array['manager-one@example.test']
);
select ok(
  (select automatic_customer_contact_paused_at is null from public.refund_gmail_threads where provider_thread_id = 'participant-thread'),
  'A trusted hard bounce for a different recipient does not pause customer contact'
);
select is(
  (select count(*)::integer from public.refund_case_events where event_type = 'gmail_delivery_notice_received'),
  2,
  'A recipient-mismatched bounce remains a non-pausing delivery notice'
);

select public.service_ingest_refund_gmail_message_v2(
  repeat('c', 64), 'participant-thread', 'participant-bounce', '<participant-bounce@example.test>',
  null, 'system', true, 'mailer-daemon@googlemail.com', 'Mail Delivery Subsystem', 'info@bloomjoysweets.com',
  'Delivery Status Notification (Failure)', 'Synthetic hard bounce.', false, now(), null,
  '[]'::jsonb, '{}'::text[], array['info@bloomjoysweets.com', 'support@bloomjoysweets.com'], 'automated',
  false, true, array['customer@example.test']
);
select ok(
  (select automatic_customer_contact_paused_at is not null from public.refund_gmail_threads where provider_thread_id = 'participant-thread'),
  'A hard bounce pauses further automatic customer contact'
);

select public.service_ingest_refund_gmail_message_v2(
  repeat('c', 64), 'participant-thread-newer', 'participant-customer-newer',
  '<participant-customer-newer@example.test>', null, 'inbound', false,
  'customer@example.test', 'Synthetic Customer', 'info@bloomjoysweets.com',
  'Re: Refund request in a new conversation', 'A newer direct customer thread.', false,
  now() + interval '1 minute',
  (select public_reference from public.refund_cases where id = (select (result ->> 'caseId')::uuid from first_customer_ingest)),
  '[]'::jsonb, '{}'::text[],
  array['info@bloomjoysweets.com', 'support@bloomjoysweets.com'],
  'direct_human', false, false, '{}'::text[]
);
select is(
  (
    select refund_case_id
    from public.refund_gmail_threads
    where provider_thread_id = 'participant-thread-newer'
  ),
  (select (result ->> 'caseId')::uuid from first_customer_ingest),
  'A newer Gmail thread can link to the same refund case'
);
select is(
  (
    select count(*)::integer
    from public.refund_gmail_threads
    where refund_case_id = (select (result ->> 'caseId')::uuid from first_customer_ingest)
      and automatic_customer_contact_paused_at is not null
  ),
  1,
  'Linking a newer unpaused thread preserves the older hard-bounce pause'
);

select set_config('request.jwt.claim.sub', '', true);
select ok(
  pg_temp.capture_error(format(
    'select public.admin_recover_refund_gmail_customer_contact(%L::uuid, %L, %L)',
    (select (result ->> 'caseId')::uuid from first_customer_ingest),
    'customer@example.test',
    'customer_address_verified'
  )) like '%Authentication required%',
  'An unauthenticated caller cannot clear any hard-bounce pause'
);
select set_config('request.jwt.claim.sub', '78600000-0000-4000-8000-000000000005', true);
select ok(
  pg_temp.capture_error(format(
    'select public.admin_recover_refund_gmail_customer_contact(%L::uuid, %L, %L)',
    (select (result ->> 'caseId')::uuid from first_customer_ingest),
    'customer@example.test',
    'customer_address_verified'
  )) like '%Refund case access required%',
  'An authenticated user without case access cannot clear any hard-bounce pause'
);
select set_config('request.jwt.claim.sub', '', true);

insert into public.refund_case_messages (
  id, refund_case_id, message_type, status, recipient_email, subject, body
)
values
  ('78650000-0000-4000-8000-000000000002', (select (result ->> 'caseId')::uuid from first_customer_ingest), 'reminder', 'pending', 'customer@example.test', 'Automatic reminder', 'Friendly automatic reminder.'),
  ('78650000-0000-4000-8000-000000000003', (select (result ->> 'caseId')::uuid from first_customer_ingest), 'status_update', 'pending', 'customer@example.test', 'Manual recovery', 'A manager reviewed the delivery issue.'),
  ('78650000-0000-4000-8000-000000000004', (select (result ->> 'caseId')::uuid from first_customer_ingest), 'reminder', 'pending', 'customer@example.test', 'Automatic reminder after recovery', 'Friendly automatic reminder after verified recovery.');

select is(
  public.service_claim_refund_gmail_outbound_v2(
    (select (result ->> 'caseId')::uuid from first_customer_ingest),
    '78650000-0000-4000-8000-000000000002', 'participant-paused-auto', 'info@bloomjoysweets.com',
    'customer@example.test', 'Friendly automatic reminder.', array['info@bloomjoysweets.com'], 'automatic'
  ) ->> 'status',
  'automatic_contact_paused',
  'An older linked-thread hard bounce blocks automatic follow-up on the newer reply thread'
);
select is(
  (public.service_claim_refund_gmail_outbound_v2(
    (select (result ->> 'caseId')::uuid from first_customer_ingest),
    '78650000-0000-4000-8000-000000000003', 'participant-manual-recovery', 'info@bloomjoysweets.com',
    'customer@example.test', 'A manager reviewed the delivery issue.', array['info@bloomjoysweets.com'], 'manual'
  ) ->> 'claimed')::boolean,
  true,
  'An authorized manager can still make a deliberate manual recovery send'
);

select public.service_finish_refund_gmail_outbound(
  (
    select id
    from public.refund_gmail_messages
    where operation_key = 'participant-manual-recovery'
  ),
  'sent',
  'participant-provider-manual-recovery',
  '<participant-provider-manual-recovery@example.test>',
  null
);

insert into public.admin_roles (user_id, role, active)
values ('78600000-0000-4000-8000-000000000001', 'super_admin', true);
select set_config('request.jwt.claim.sub', '78600000-0000-4000-8000-000000000001', true);

select ok(
  public.admin_get_refund_gmail_case_context(
    (select (result ->> 'caseId')::uuid from first_customer_ingest)
  )::text not like '%manager-one@example.test%'
  and public.admin_get_refund_gmail_case_context(
    (select (result ->> 'caseId')::uuid from first_customer_ingest)
  )::text not like '%customer@example.test%',
  'The authorized safe conversation view omits raw sender, To, and CC addresses'
);
select ok(
  public.admin_get_refund_gmail_case_context(
    (select (result ->> 'caseId')::uuid from first_customer_ingest)
  )::text like '%Machine Manager%'
  and public.admin_get_refund_gmail_case_context(
    (select (result ->> 'caseId')::uuid from first_customer_ingest)
  )::text like '%Unverified participant%',
  'The safe conversation view exposes participant roles instead of addresses'
);
select is(
  public.admin_get_refund_gmail_case_context(
    (select (result ->> 'caseId')::uuid from first_customer_ingest)
  ) ->> 'automaticCustomerContactPaused',
  'true',
  'Managers see the case-wide hard-bounce state even when the newest thread is unpaused'
);

select public.service_ingest_refund_gmail_message_v2(
  repeat('c', 64), 'participant-thread-newer', 'participant-bounce-newer',
  '<participant-bounce-newer@example.test>', null, 'system', true,
  'mailer-daemon@googlemail.com', 'Mail Delivery Subsystem', 'info@bloomjoysweets.com',
  'Delivery Status Notification (Failure)', 'Synthetic hard bounce on the newer thread.', false,
  now() + interval '2 minutes', null, '[]'::jsonb, '{}'::text[],
  array['info@bloomjoysweets.com', 'support@bloomjoysweets.com'],
  'automated', false, true, array['customer@example.test']
);
select is(
  (
    select count(*)::integer
    from public.refund_gmail_threads
    where refund_case_id = (select (result ->> 'caseId')::uuid from first_customer_ingest)
      and automatic_customer_contact_paused_at is not null
  ),
  2,
  'Independent trusted hard bounces retain pause evidence on every affected linked thread'
);

set local role service_role;
select ok(
  pg_temp.capture_error(
    $clear$update public.refund_gmail_threads
      set automatic_customer_contact_paused_at = null,
          automatic_customer_contact_pause_reason = null
      where provider_thread_id = 'participant-thread-newer'$clear$
  ) like '%permission denied%',
  'A service worker cannot clear only the newest paused thread'
);
reset role;

select ok(
  pg_temp.capture_error(format(
    'select public.admin_recover_refund_gmail_customer_contact(%L::uuid, %L, %L)',
    (select (result ->> 'caseId')::uuid from first_customer_ingest),
    'customer@example.test',
    'not_verified'
  )) like '%Explicit customer address verification is required%',
  'An authorized manager must make the exact deliberate verification before recovery'
);
select is(
  (
    select count(*)::integer
    from public.refund_gmail_threads
    where refund_case_id = (select (result ->> 'caseId')::uuid from first_customer_ingest)
      and automatic_customer_contact_paused_at is not null
  ),
  2,
  'A failed or partial recovery attempt leaves all case-linked pauses intact'
);
select is(
  (
    public.admin_recover_refund_gmail_customer_contact(
      (select (result ->> 'caseId')::uuid from first_customer_ingest),
      'customer@example.test',
      'customer_address_verified'
    ) ->> 'clearedThreadCount'
  )::integer,
  2,
  'One authorized recovery atomically clears every paused thread linked to the case'
);
select is(
  (
    select count(*)::integer
    from public.refund_gmail_threads
    where refund_case_id = (select (result ->> 'caseId')::uuid from first_customer_ingest)
      and automatic_customer_contact_paused_at is not null
  ),
  0,
  'No case-linked thread remains partially paused after recovery'
);
select is(
  (
    select count(*)::integer
    from public.refund_case_events
    where refund_case_id = (select (result ->> 'caseId')::uuid from first_customer_ingest)
      and event_type = 'gmail_customer_contact_recovered'
      and actor_user_id = '78600000-0000-4000-8000-000000000001'
      and metadata ->> 'verification' = 'customer_address_verified'
      and (metadata ->> 'cleared_thread_count')::integer = 2
      and (metadata ->> 'case_wide')::boolean
      and (metadata ->> 'payload_redacted')::boolean
  ),
  1,
  'Case-wide recovery writes one actor-attributed redacted audit event'
);
select is(
  public.admin_get_refund_gmail_case_context(
    (select (result ->> 'caseId')::uuid from first_customer_ingest)
  ) ->> 'automaticCustomerContactPaused',
  'false',
  'Manager context reports resumed contact only after every linked pause is cleared'
);
select is(
  public.admin_recover_refund_gmail_customer_contact(
    (select (result ->> 'caseId')::uuid from first_customer_ingest),
    'customer@example.test',
    'customer_address_verified'
  ) ->> 'status',
  'not_paused',
  'Repeated recovery is idempotent and cannot fabricate another clear'
);
select is(
  (
    select count(*)::integer
    from public.refund_case_events
    where refund_case_id = (select (result ->> 'caseId')::uuid from first_customer_ingest)
      and event_type = 'gmail_customer_contact_recovered'
  ),
  1,
  'Idempotent recovery does not write a duplicate recovery event'
);

select public.service_ingest_refund_gmail_message_v2(
  repeat('c', 64), 'participant-thread-newer', 'participant-bounce-uncertain-newer',
  '<participant-bounce-uncertain-newer@example.test>', null, 'system', true,
  'mailer-daemon@googlemail.com', 'Mail Delivery Subsystem', 'info@bloomjoysweets.com',
  'Delivery Status Notification (Delay)', 'Synthetic uncertain delivery notice.', false,
  now() + interval '3 minutes', null, '[]'::jsonb, '{}'::text[],
  array['info@bloomjoysweets.com', 'support@bloomjoysweets.com'],
  'automated', false, false, array['customer@example.test']
);
select is(
  (
    select count(*)::integer
    from public.refund_gmail_threads
    where refund_case_id = (select (result ->> 'caseId')::uuid from first_customer_ingest)
      and automatic_customer_contact_paused_at is not null
  ),
  0,
  'An uncertain non-hard delivery notice cannot recreate a case-wide pause'
);
select is(
  (public.service_claim_refund_gmail_outbound_v2(
    (select (result ->> 'caseId')::uuid from first_customer_ingest),
    '78650000-0000-4000-8000-000000000004', 'participant-recovered-auto',
    'info@bloomjoysweets.com', 'customer@example.test',
    'Friendly automatic reminder after verified recovery.',
    array['info@bloomjoysweets.com'], 'automatic'
  ) ->> 'claimed')::boolean,
  true,
  'Automatic contact can resume only after explicit case-wide recovery'
);

select public.service_finish_refund_gmail_outbound(
  (
    select id
    from public.refund_gmail_messages
    where operation_key = 'participant-recovered-auto'
  ),
  'sent',
  'participant-provider-recovered-auto',
  '<participant-provider-recovered-auto@example.test>',
  null
);

select ok(
  not exists (
    select 1
    from public.refund_gpt_triage_jobs job
    join public.refund_gmail_messages message on message.id = job.source_message_id
    where message.participant_role <> 'customer'
  ),
  'No non-customer participant is present in the GPT job ledger'
);
select is(
  (select count(*)::integer from public.refund_case_events where event_type = 'gmail_customer_message_bounced'),
  2,
  'Each exact-customer hard bounce creates redacted manager-visible recovery evidence'
);

select ok(
  not has_function_privilege(
    'service_role',
    'public.service_claim_refund_gmail_outbound_v2(uuid,uuid,text,text,text,text,text[],text)',
    'execute'
  ),
  'The legacy v2 outbound claim is revoked so service workers cannot bypass v3 gates'
);

insert into public.refund_case_messages (
  id, refund_case_id, message_type, status, recipient_email, subject, body,
  template_key
) values
  (
    '78650000-0000-4000-8000-000000000013',
    (select (result ->> 'caseId')::uuid from first_customer_ingest),
    'confirmation', 'pending', 'customer@example.test',
    'Source-bound automatic reply', 'A source-bound synthetic automatic reply.',
    'refund_confirmation_v1'
  ),
  (
    '78650000-0000-4000-8000-000000000014',
    (select (result ->> 'caseId')::uuid from first_customer_ingest),
    'confirmation', 'pending', 'customer@example.test',
    'Terminal automatic reply', 'This automatic reply must not reach a terminal case.',
    'refund_confirmation_v1'
  ),
  (
    '78650000-0000-4000-8000-000000000015',
    (select (result ->> 'caseId')::uuid from first_customer_ingest),
    'confirmation', 'pending', 'customer@example.test',
    'Newer source-bound reply', 'A synthetic reply for the newer source thread.',
    'refund_confirmation_v1'
  );

select is(
  public.service_claim_refund_gmail_outbound_v3(
    (select (result ->> 'caseId')::uuid from first_customer_ingest),
    '78650000-0000-4000-8000-000000000013',
    'participant-v3-disabled', 'info@bloomjoysweets.com',
    'customer@example.test', 'A source-bound synthetic automatic reply.',
    array['info@bloomjoysweets.com', 'support@bloomjoysweets.com'],
    'automatic',
    (select id from public.refund_gmail_threads where provider_thread_id = 'participant-thread')
  ) ->> 'status',
  'automatic_contact_disabled',
  'The transport-time database switch blocks a new automatic Gmail claim'
);
select is(
  (select count(*)::integer from public.refund_gmail_messages where operation_key = 'participant-v3-disabled'),
  0,
  'A disabled transport gate creates no outbound Gmail milestone'
);

update public.refund_customer_contact_settings
set automatic_customer_contact_enabled = true
where singleton;

select is(
  public.service_claim_refund_gmail_outbound_v3(
    (select (result ->> 'caseId')::uuid from first_customer_ingest),
    '78650000-0000-4000-8000-000000000013',
    'participant-v3-no-source', 'info@bloomjoysweets.com',
    'customer@example.test', 'A source-bound synthetic automatic reply.',
    array['info@bloomjoysweets.com', 'support@bloomjoysweets.com'],
    'automatic', null
  ) ->> 'status',
  'source_thread_required',
  'Automatic Gmail delivery fails closed without the exact source conversation'
);

create temporary table v3_source_claim as
select public.service_claim_refund_gmail_outbound_v3(
  (select (result ->> 'caseId')::uuid from first_customer_ingest),
  '78650000-0000-4000-8000-000000000013',
  'participant-v3-source-bound', 'info@bloomjoysweets.com',
  'customer@example.test', 'A source-bound synthetic automatic reply.',
  array['info@bloomjoysweets.com', 'support@bloomjoysweets.com'],
  'automatic',
  (select id from public.refund_gmail_threads where provider_thread_id = 'participant-thread')
) as result;

select is(
  (select (result ->> 'claimed')::boolean from v3_source_claim),
  true,
  'A valid automatic message claims exactly one source-bound Gmail milestone'
);
select is(
  (select result ->> 'providerThreadId' from v3_source_claim),
  'participant-thread',
  'The source-bound claim keeps the older triggering conversation even when a newer thread exists'
);
select is(
  (
    select gmail_thread_id
    from public.refund_gmail_messages
    where operation_key = 'participant-v3-source-bound'
  ),
  (select id from public.refund_gmail_threads where provider_thread_id = 'participant-thread'),
  'The durable outbound milestone stores the exact triggering Gmail thread'
);

select public.service_finish_refund_gmail_outbound(
  (select (result ->> 'transportMessageId')::uuid from v3_source_claim),
  'sent',
  'participant-v3-provider-sent',
  '<participant-v3-provider-sent@example.test>',
  null
);
update public.refund_customer_contact_settings
set automatic_customer_contact_enabled = false
where singleton;

select is(
  (
    public.service_claim_refund_gmail_outbound_v3(
      (select (result ->> 'caseId')::uuid from first_customer_ingest),
      '78650000-0000-4000-8000-000000000013',
      'participant-v3-source-bound', 'info@bloomjoysweets.com',
      'customer@example.test', 'A source-bound synthetic automatic reply.',
      array['info@bloomjoysweets.com', 'support@bloomjoysweets.com'],
      'automatic',
      (select id from public.refund_gmail_threads where provider_thread_id = 'participant-thread')
    ) ->> 'reconciled'
  )::boolean,
  true,
  'A known provider-sent milestone reconciles locally without a second send even after the switch closes'
);
select is(
  (select status from public.refund_case_messages where id = '78650000-0000-4000-8000-000000000013'),
  'sent',
  'Known Gmail sent evidence advances the tracked customer-message milestone'
);

update public.refund_customer_contact_settings
set automatic_customer_contact_enabled = true
where singleton;
update public.refund_cases
set decision = 'denied'
where id = (select (result ->> 'caseId')::uuid from first_customer_ingest);
select is(
  public.service_claim_refund_gmail_outbound_v3(
    (select (result ->> 'caseId')::uuid from first_customer_ingest),
    '78650000-0000-4000-8000-000000000014',
    'participant-v3-terminal', 'info@bloomjoysweets.com',
    'customer@example.test', 'This automatic reply must not reach a terminal case.',
    array['info@bloomjoysweets.com', 'support@bloomjoysweets.com'],
    'automatic',
    (select id from public.refund_gmail_threads where provider_thread_id = 'participant-thread-newer')
  ) ->> 'status',
  'terminal_case',
  'A decision recorded after message creation blocks automatic transport delivery'
);
update public.refund_cases
set decision = null
where id = (select (result ->> 'caseId')::uuid from first_customer_ingest);

create temporary table v3_newer_source_claim as
select public.service_claim_refund_gmail_outbound_v3(
  (select (result ->> 'caseId')::uuid from first_customer_ingest),
  '78650000-0000-4000-8000-000000000015',
  'participant-v3-newer-source', 'info@bloomjoysweets.com',
  'customer@example.test', 'A synthetic reply for the newer source thread.',
  array['info@bloomjoysweets.com', 'support@bloomjoysweets.com'],
  'automatic',
  (select id from public.refund_gmail_threads where provider_thread_id = 'participant-thread-newer')
) as result;
select is(
  (select (result ->> 'claimed')::boolean from v3_newer_source_claim),
  true,
  'A second automatic message can bind independently to the newer triggering conversation'
);
select is(
  (select result ->> 'providerThreadId' from v3_newer_source_claim),
  'participant-thread-newer',
  'The newer source-bound claim remains on its own Gmail conversation'
);

select * from finish();
rollback;
