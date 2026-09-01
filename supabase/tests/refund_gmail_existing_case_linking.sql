begin;

create extension if not exists pgtap with schema extensions;
set local search_path = public, extensions;

select plan(30);

create function pg_temp.set_auth_claims(p_user_id uuid)
returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claim.sub', p_user_id::text, true);
  perform set_config('request.jwt.claim.role', 'authenticated', true);
  perform set_config('request.jwt.claims', jsonb_build_object(
    'sub', p_user_id, 'role', 'authenticated', 'is_anonymous', false
  )::text, true);
end;
$$;

create function pg_temp.capture_error(statement text)
returns text language plpgsql as $$
begin
  execute statement;
  return null;
exception when others then
  return sqlstate || ':' || sqlerrm;
end;
$$;

insert into auth.users (
  instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at
) values
  ('00000000-0000-0000-0000-000000000000', 'b8900000-0000-4000-8000-000000000001', 'authenticated', 'authenticated', 'gmail-link-manager@example.invalid', '', now(), '{}'::jsonb, '{}'::jsonb, now(), now()),
  ('00000000-0000-0000-8000-000000000000', 'b8900000-0000-4000-8000-000000000002', 'authenticated', 'authenticated', 'gmail-link-outsider@example.invalid', '', now(), '{}'::jsonb, '{}'::jsonb, now(), now());

insert into public.customer_accounts (id, name, account_type)
values ('b8910000-0000-4000-8000-000000000001', 'Existing Gmail link fixture', 'internal');

insert into public.reporting_locations (id, account_id, name, timezone)
values (
  'b8920000-0000-4000-8000-000000000001',
  'b8910000-0000-4000-8000-000000000001',
  'Gmail link fixture location',
  'America/Los_Angeles'
);

insert into public.reporting_machines (
  id, account_id, location_id, machine_label, refund_public_display_label, status
) values (
  'b8930000-0000-4000-8000-000000000001',
  'b8910000-0000-4000-8000-000000000001',
  'b8920000-0000-4000-8000-000000000001',
  'Gmail link fixture machine',
  'Fixture machine',
  'active'
);

insert into public.reporting_machine_refund_managers (
  reporting_machine_id, manager_user_id, manager_email, grant_reason
) values (
  'b8930000-0000-4000-8000-000000000001',
  'b8900000-0000-4000-8000-000000000001',
  'gmail-link-manager@example.invalid',
  'Existing Gmail link test authority'
);

insert into public.refund_cases (
  id, public_reference, reporting_machine_id, reporting_location_id,
  customer_email, issue_summary, incident_at, incident_local_datetime,
  payment_method, payment_amount_cents, card_last4, status,
  correlation_status, correlation_source, intake_source, created_at
) values
  (
    'b8940000-0000-4000-8000-000000000001', 'RF-LINK-ONE',
    'b8930000-0000-4000-8000-000000000001',
    'b8920000-0000-4000-8000-000000000001',
    'single-case@example.test', 'Single open website case',
    statement_timestamp() - interval '2 days',
    to_char((statement_timestamp() - interval '2 days') at time zone 'America/Los_Angeles', 'YYYY-MM-DD"T"HH24:MI'),
    'card', 700, '4242', 'needs_review', 'needs_nayax', 'nayax', 'form',
    statement_timestamp() - interval '3 days'
  ),
  (
    'b8940000-0000-4000-8000-000000000002', 'RF-LINK-TWO-A',
    'b8930000-0000-4000-8000-000000000001',
    'b8920000-0000-4000-8000-000000000001',
    'two-cases@example.test', 'First related website case',
    statement_timestamp() - interval '2 days',
    to_char((statement_timestamp() - interval '2 days') at time zone 'America/Los_Angeles', 'YYYY-MM-DD"T"HH24:MI'),
    'card', 900, '4242', 'needs_review', 'needs_nayax', 'nayax', 'form',
    statement_timestamp() - interval '3 days'
  ),
  (
    'b8940000-0000-4000-8000-000000000003', 'RF-LINK-TWO-B',
    'b8930000-0000-4000-8000-000000000001',
    'b8920000-0000-4000-8000-000000000001',
    'two-cases@example.test', 'Second related website case',
    statement_timestamp() - interval '1 day',
    to_char((statement_timestamp() - interval '1 day') at time zone 'America/Los_Angeles', 'YYYY-MM-DD"T"HH24:MI'),
    'card', 1100, '1111', 'waiting_on_customer', 'needs_nayax', 'nayax', 'form',
    statement_timestamp() - interval '3 days'
  );

create temporary table case_baseline as
select count(*)::integer as count from public.refund_cases;

select ok(
  has_function_privilege(
    'service_role',
    'public.service_ingest_refund_gmail_contact_v2(text,text,text,text,text,text,boolean,text,text,text,text,text,boolean,timestamptz,text,jsonb,text[],text[],text,boolean,boolean,text[],jsonb)',
    'execute'
  ) and not has_function_privilege(
    'authenticated',
    'public.service_ingest_refund_gmail_contact_v2(text,text,text,text,text,text,boolean,text,text,text,text,text,boolean,timestamptz,text,jsonb,text[],text[],text,boolean,boolean,text[],jsonb)',
    'execute'
  ) and not has_table_privilege(
    'service_role', 'public.refund_gmail_case_link_reviews', 'select'
  ) and not has_table_privilege(
    'authenticated', 'public.refund_gmail_contact_case_associations', 'select'
  ),
  'Only the Gmail service RPC can stage existing-case linking; its ledgers remain private'
);

select ok(
  has_function_privilege(
    'authenticated',
    'public.admin_resolve_refund_gmail_case_link_review(uuid,bigint,uuid)',
    'execute'
  ) and not has_function_privilege(
    'service_role',
    'public.admin_resolve_refund_gmail_case_link_review(uuid,bigint,uuid)',
    'execute'
  ),
  'Only an authenticated manager session can reach link resolution'
);

create temporary table single_link as
select public.service_ingest_refund_gmail_contact_v2(
  repeat('1', 64), 'single-existing-thread', 'single-existing-message',
  '<single-existing-message@example.test>', null, 'inbound', false,
  'single-case@example.test', 'Single Customer', 'info@bloomjoysweets.com',
  'Existing refund help', 'Amount: 7.00', false, statement_timestamp(), null,
  '[]'::jsonb, '{}'::text[], array['info@bloomjoysweets.com'],
  'direct_human', false, false, '{}'::text[],
  jsonb_build_object('amountCents', 700, 'paymentMethod', 'card', 'payloadRedacted', true)
) as result;

select is(
  (select result ->> 'existingCaseLink' from single_link),
  'automatic',
  'One exact normalized sender with one recent open case links automatically'
);

select is(
  (select result ->> 'caseId' from single_link),
  'b8940000-0000-4000-8000-000000000001',
  'The inbound message is attached to the existing case'
);

select is(
  (select count(*)::integer from public.refund_cases),
  (select count from case_baseline),
  'Existing-case linking creates no refund case'
);

select is(
  (select count(*)::integer from public.refund_gmail_intake_contacts where customer_email = 'single-case@example.test'),
  0,
  'The unambiguous path never stages a form-only contact'
);

select is(
  (select count(*)::integer from public.refund_gmail_messages where refund_case_id = 'b8940000-0000-4000-8000-000000000001'),
  1,
  'The verified inbound message is persisted once on the existing case thread'
);

select is(
  (public.service_ingest_refund_gmail_contact_v2(
    repeat('1', 64), 'single-existing-thread', 'single-existing-message',
    '<single-existing-message@example.test>', null, 'inbound', false,
    'single-case@example.test', 'Single Customer', 'info@bloomjoysweets.com',
    'Existing refund help', 'Amount: 7.00', false, statement_timestamp(), null,
    '[]'::jsonb, '{}'::text[], array['info@bloomjoysweets.com'],
    'direct_human', false, false, '{}'::text[],
    jsonb_build_object('amountCents', 700, 'payloadRedacted', true)
  ) ->> 'duplicate')::boolean,
  true,
  'Replaying the unambiguous inbound message is deduplicated'
);

select is(
  (select count(*)::integer from public.refund_case_events
    where refund_case_id = 'b8940000-0000-4000-8000-000000000001'
      and event_type = 'gmail_existing_case_auto_linked'),
  1,
  'Automatic linking records one redacted immutable event'
);

create temporary table ambiguous_link as
select public.service_ingest_refund_gmail_contact_v2(
  repeat('2', 64), 'two-existing-thread', 'two-existing-message',
  '<two-existing-message@example.test>', null, 'inbound', false,
  'two-cases@example.test', 'Two Purchase Customer', 'support@bloomjoysweets.com',
  'Two existing purchases', 'Amount: 9.00', false, statement_timestamp(), null,
  '[]'::jsonb, '{}'::text[], array['support@bloomjoysweets.com'],
  'direct_human', false, false, '{}'::text[],
  jsonb_build_object('amountCents', 900, 'paymentMethod', 'card', 'payloadRedacted', true)
) as result;

select ok(
  (select (result ->> 'customerContactSuppressed')::boolean from ambiguous_link)
    and not (select (result ->> 'contactOnly')::boolean from ambiguous_link)
    and (select (result -> 'linkReview' ->> 'candidateCount')::integer from ambiguous_link) = 2,
  'Two plausible cases create one manager task and suppress the form response'
);

select is(
  (select status from public.refund_gmail_intake_contacts where provider_thread_id = 'two-existing-thread'),
  'link_review',
  'The ambiguous contact has a non-sendable manager-review state'
);

select is(
  (select count(*)::integer from public.refund_gmail_case_link_reviews review
    join public.refund_gmail_intake_contacts contact on contact.id = review.contact_id
    where contact.provider_thread_id = 'two-existing-thread' and review.status = 'pending'),
  1,
  'Ambiguous intake creates exactly one pending linking task'
);

select is(
  (select count(*)::integer from public.refund_gmail_case_link_review_candidates candidate
    join public.refund_gmail_case_link_reviews review on review.id = candidate.review_id
    join public.refund_gmail_intake_contacts contact on contact.id = review.contact_id
    where contact.provider_thread_id = 'two-existing-thread'),
  2,
  'The task retains both plausible existing cases'
);

select ok(
  (select evidence ->> 'normalizedSender' = 'true'
      and evidence ->> 'amount' = 'true'
      and evidence ->> 'payloadRedacted' = 'true'
    from public.refund_gmail_case_link_review_candidates
    where refund_case_id = 'b8940000-0000-4000-8000-000000000002'),
  'Candidate context exposes only redacted match booleans'
);

select is(
  (select count(*)::integer from public.refund_gmail_intake_contact_operations operation
    join public.refund_gmail_intake_contacts contact on contact.id = operation.contact_id
    where contact.provider_thread_id = 'two-existing-thread'),
  0,
  'No form-link delivery operation is claimed for ambiguous existing cases'
);

select is(
  public.service_claim_refund_gmail_contact_first_response(
    (select (result ->> 'messageId')::uuid from ambiguous_link),
    'active', statement_timestamp() - interval '1 minute',
    'refund_first_contact_v1', 'info@bloomjoysweets.com', 'Do not send this.'
  ) ->> 'reason',
  'contact_not_eligible',
  'The database independently prevents a first-contact send for link review'
);

select is(
  (public.service_ingest_refund_gmail_contact_v2(
    repeat('2', 64), 'two-existing-thread', 'two-existing-message',
    '<two-existing-message@example.test>', null, 'inbound', false,
    'two-cases@example.test', 'Two Purchase Customer', 'support@bloomjoysweets.com',
    'Two existing purchases', 'Amount: 9.00', false, statement_timestamp(), null,
    '[]'::jsonb, '{}'::text[], array['support@bloomjoysweets.com'],
    'direct_human', false, false, '{}'::text[],
    jsonb_build_object('amountCents', 900, 'payloadRedacted', true)
  ) ->> 'duplicate')::boolean,
  true,
  'Ambiguous message replay is deduplicated'
);

select is(
  (select count(*)::integer from public.refund_gmail_case_link_reviews review
    join public.refund_gmail_intake_contacts contact on contact.id = review.contact_id
    where contact.provider_thread_id = 'two-existing-thread'),
  1,
  'Replay cannot create a second manager task'
);

set local role authenticated;
select pg_temp.set_auth_claims('b8900000-0000-4000-8000-000000000002');

select ok(
  pg_temp.capture_error(format(
    'select public.admin_resolve_refund_gmail_case_link_review(%L,1,%L)',
    (select (result -> 'linkReview' ->> 'reviewId')::uuid from ambiguous_link),
    'b8940000-0000-4000-8000-000000000002'
  )) like 'P4655:Current manager access%',
  'An unrelated authenticated user cannot resolve the linking task'
);

select pg_temp.set_auth_claims('b8900000-0000-4000-8000-000000000001');

select is(
  public.admin_get_refund_operations_overview() ->> 'inboundLinkReviewContractVersion',
  'refund_gmail_case_link_review_v1',
  'The manager overview versions the inbound-link review contract'
);

select ok(
  exists (
    select 1
    from jsonb_array_elements(public.admin_get_refund_operations_overview() -> 'cases') item
    where item ->> 'id' = 'b8940000-0000-4000-8000-000000000002'
      and item -> 'inboundLinkReview' ->> 'status' = 'pending'
      and item ->> 'officialActionBlockReason' = 'inbound_link_review_required'
      and (item ->> 'canPerformOfficialAction')::boolean is false
      and item -> 'lifecycle' -> 'managerQueue' ->> 'bucket' = 'needs_action'
      and item -> 'lifecycle' -> 'managerQueue' ->> 'nextAction' = 'review_inbound_case_link'
  ),
  'Each candidate exposes one Action needed manager task and blocks official action'
);

create temporary table resolved_link as
select public.admin_resolve_refund_gmail_case_link_review(
  (select (result -> 'linkReview' ->> 'reviewId')::uuid from ambiguous_link),
  1,
  'b8940000-0000-4000-8000-000000000002'
) as result;

select ok(
  (select (result ->> 'resolved')::boolean from resolved_link)
    and not (select (result ->> 'customerMessageSent')::boolean from resolved_link)
    and not (select (result ->> 'caseCreated')::boolean from resolved_link)
    and not (select (result ->> 'providerCallMade')::boolean from resolved_link)
    and not (select (result ->> 'paymentActionTaken')::boolean from resolved_link),
  'Manager resolution returns an explicit no-side-effect receipt'
);

reset role;

select ok(
  (select status = 'linked'
      and linked_refund_case_id = 'b8940000-0000-4000-8000-000000000002'
    from public.refund_gmail_intake_contacts where provider_thread_id = 'two-existing-thread')
  and (select refund_case_id = 'b8940000-0000-4000-8000-000000000002'
    from public.refund_gmail_threads where provider_thread_id = 'two-existing-thread'),
  'Resolution links the provider thread and contact to the selected primary case'
);

select is(
  (select count(*)::integer from public.refund_gmail_contact_case_associations association
    join public.refund_gmail_intake_contacts contact on contact.id = association.contact_id
    where contact.provider_thread_id = 'two-existing-thread'),
  2,
  'Resolution retains one primary and one related immutable association'
);

select ok(
  (select count(*) = 1 from public.refund_gmail_contact_case_associations association
    join public.refund_gmail_intake_contacts contact on contact.id = association.contact_id
    where contact.provider_thread_id = 'two-existing-thread' and association.relationship = 'primary')
  and (select count(*) = 1 from public.refund_gmail_contact_case_associations association
    join public.refund_gmail_intake_contacts contact on contact.id = association.contact_id
    where contact.provider_thread_id = 'two-existing-thread' and association.relationship = 'related')
  and (select status = 'waiting_on_customer'
    from public.refund_cases where id = 'b8940000-0000-4000-8000-000000000003'),
  'The association distinguishes related work without changing its customer lifecycle'
);

select is(
  (select count(*)::integer from public.refund_gmail_messages
    where refund_case_id = 'b8940000-0000-4000-8000-000000000002'
      and provider_message_id = 'two-existing-message'),
  1,
  'The customer email becomes visible once in the primary case conversation'
);

select is(
  (select count(*)::integer from public.refund_case_events
    where event_type = 'gmail_existing_case_link_resolved'
      and refund_case_id in (
        'b8940000-0000-4000-8000-000000000002',
        'b8940000-0000-4000-8000-000000000003'
      )),
  2,
  'Primary and related cases each receive one redacted audit event'
);

set local role authenticated;
select pg_temp.set_auth_claims('b8900000-0000-4000-8000-000000000001');

select ok(
  (select (result ->> 'replayed')::boolean
      and (result ->> 'customerMessageSent')::boolean is false
      and (result ->> 'caseCreated')::boolean is false
      and (result ->> 'providerCallMade')::boolean is false
      and (result ->> 'paymentActionTaken')::boolean is false
    from (select public.admin_resolve_refund_gmail_case_link_review(
    (select (result -> 'linkReview' ->> 'reviewId')::uuid from ambiguous_link),
    1,
    'b8940000-0000-4000-8000-000000000002'
  ) as result) replay),
  'An identical manager retry returns the same explicit no-side-effect receipt'
);

reset role;

select is(
  (select count(*)::integer from public.refund_cases),
  (select count from case_baseline),
  'The complete two-cases-then-email flow creates no competing case'
);

select is(
  (select count(*)::integer from public.refund_case_nayax_refund_attempts
    where refund_case_id in (
      'b8940000-0000-4000-8000-000000000002',
      'b8940000-0000-4000-8000-000000000003'
    )),
  0,
  'Linking and replay create no provider or payment attempt'
);

select * from finish();
rollback;
