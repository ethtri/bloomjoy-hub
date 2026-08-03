begin;

create extension if not exists pgtap with schema extensions;
set local search_path = public, extensions;

select plan(53);

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
  'resolved_with_exclusions',
  'Duplicate mapped addresses are deduplicated and surfaced as a redacted exception'
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
  'resolved_with_exclusions',
  'Malformed mapped addresses are excluded without blocking customer service'
);

update public.reporting_machine_refund_managers
set manager_email = 'customer@example.test'
where id = '78640000-0000-4000-8000-000000000003';
select is(
  public.service_resolve_refund_customer_manager_cc(
    (select (result ->> 'caseId')::uuid from first_customer_ingest),
    'customer@example.test',
    array['info@bloomjoysweets.com', 'support@bloomjoysweets.com']
  ) ->> 'status',
  'resolved_with_exclusions',
  'A customer address in manager mapping drift is surfaced as an exclusion'
);
select is(
  public.service_resolve_refund_customer_manager_cc(
    (select (result ->> 'caseId')::uuid from first_customer_ingest),
    'customer@example.test',
    array['info@bloomjoysweets.com', 'support@bloomjoysweets.com']
  ) -> 'managerCcEmails',
  '["manager-one@example.test"]'::jsonb,
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
  'resolved_with_exclusions',
  'A mailbox identity in manager mapping drift is surfaced as an exclusion'
);
select is(
  public.service_resolve_refund_customer_manager_cc(
    (select (result ->> 'caseId')::uuid from first_customer_ingest),
    'customer@example.test',
    array['info@bloomjoysweets.com', 'support@bloomjoysweets.com']
  ) -> 'managerCcEmails',
  '["manager-one@example.test"]'::jsonb,
  'A Bloomjoy mailbox identity never appears in visible manager CC'
);

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
  'Before machine resolution customer service continues with no manager CC'
);
update public.refund_cases
set
  reporting_machine_id = '78630000-0000-4000-8000-000000000001',
  reporting_location_id = '78620000-0000-4000-8000-000000000001',
  incident_at = now() - interval '1 hour', payment_method = 'card', status = 'waiting_on_customer'
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

insert into public.refund_case_messages (
  id, refund_case_id, message_type, status, recipient_email, subject, body
)
values
  ('78650000-0000-4000-8000-000000000002', (select (result ->> 'caseId')::uuid from first_customer_ingest), 'reminder', 'pending', 'customer@example.test', 'Automatic reminder', 'Friendly automatic reminder.'),
  ('78650000-0000-4000-8000-000000000003', (select (result ->> 'caseId')::uuid from first_customer_ingest), 'status_update', 'pending', 'customer@example.test', 'Manual recovery', 'A manager reviewed the delivery issue.');

select is(
  public.service_claim_refund_gmail_outbound_v2(
    (select (result ->> 'caseId')::uuid from first_customer_ingest),
    '78650000-0000-4000-8000-000000000002', 'participant-paused-auto', 'info@bloomjoysweets.com',
    'customer@example.test', 'Friendly automatic reminder.', array['info@bloomjoysweets.com'], 'automatic'
  ) ->> 'status',
  'automatic_contact_paused',
  'A hard bounce blocks an automatic follow-up before provider send'
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
  'Managers see the hard-bounce recovery state without provider claims'
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
  1,
  'The hard bounce creates one redacted manager-visible recovery event'
);

select * from finish();
rollback;
