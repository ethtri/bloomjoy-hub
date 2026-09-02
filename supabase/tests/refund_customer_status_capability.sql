begin;

create extension if not exists pgtap with schema extensions;
set local search_path = public, extensions;

select plan(26);

insert into public.customer_accounts (id, name, account_type)
values ('c1000000-0000-4000-8000-000000000001', 'Customer status test', 'customer');

insert into public.reporting_locations (id, account_id, name, timezone)
values (
  'c2000000-0000-4000-8000-000000000001',
  'c1000000-0000-4000-8000-000000000001',
  'Customer status location',
  'America/Los_Angeles'
);

insert into public.reporting_machines (id, account_id, location_id, machine_label)
values (
  'c3000000-0000-4000-8000-000000000001',
  'c1000000-0000-4000-8000-000000000001',
  'c2000000-0000-4000-8000-000000000001',
  'Customer status machine'
);

insert into public.refund_cases (
  id, public_reference, reporting_machine_id, reporting_location_id,
  customer_email, issue_summary, incident_at, payment_method,
  payment_amount_cents, refund_amount_cents, card_last4, status,
  correlation_status, correlation_source, automation_state
) values (
  'c4000000-0000-4000-8000-000000000001', 'RF-CUSTOMER-STATUS',
  'c3000000-0000-4000-8000-000000000001',
  'c2000000-0000-4000-8000-000000000001',
  'status-customer@example.invalid', '', statement_timestamp(), 'card',
  700, 700, '4242', 'needs_review', 'needs_nayax', 'nayax', 'under_review'
);

select ok(
  (select relrowsecurity from pg_class where oid = 'public.refund_case_status_capabilities'::regclass),
  'Capability table has RLS enabled'
);
select ok(
  (select relrowsecurity from pg_class where oid = 'public.refund_case_status_access_windows'::regclass),
  'Rate-limit table has RLS enabled'
);
select ok(
  (select relrowsecurity from pg_class where oid = 'public.refund_case_status_access_audit'::regclass),
  'Access-audit table has RLS enabled'
);

select is(
  has_function_privilege('anon', 'public.service_read_refund_status_capability(text,text)', 'execute'),
  false,
  'Anonymous browser role cannot execute the status RPC directly'
);
select is(
  has_function_privilege('authenticated', 'public.service_read_refund_status_capability(text,text)', 'execute'),
  false,
  'Authenticated browser role cannot execute the status RPC directly'
);
select is(
  has_function_privilege('service_role', 'public.service_read_refund_status_capability(text,text)', 'execute'),
  true,
  'Only the Edge service role receives the status RPC grant'
);

select is(
  (public.service_issue_refund_status_capability(
    'c4000000-0000-4000-8000-000000000001',
    repeat('a', 64),
    statement_timestamp() + interval '30 days'
  ) ->> 'issued')::boolean,
  true,
  'A 30-day one-case capability can be issued'
);
select is(
  (select count(*)::integer from public.refund_case_status_capabilities
   where token_digest = repeat('a', 64)),
  1,
  'Only one digest row is stored for the issued token'
);
select is(
  (select count(*)::integer from public.refund_case_status_capabilities
   where token_digest like '%raw-status-token%'),
  0,
  'No raw token is stored'
);

insert into public.refund_case_messages (
  refund_case_id, message_type, status, recipient_email, subject, body,
  template_key
) values (
  'c4000000-0000-4000-8000-000000000001', 'confirmation', 'pending',
  'status-customer@example.invalid', 'Synthetic status receipt',
  '[Secure refund status link included at delivery]', 'refund_confirmation_v1'
);
select is(
  public.service_attach_refund_status_capability_to_message(
    'c4000000-0000-4000-8000-000000000001',
    (select id from public.refund_case_messages
     where subject = 'Synthetic status receipt'),
    (select id from public.refund_case_status_capabilities
     where token_digest = repeat('a', 64))
  ),
  true,
  'A message can be linked only through the scoped service boundary'
);
select is(
  (select count(*)::integer from public.refund_case_messages
   where status_link_included is true and status_capability_id is not null),
  1,
  'Message audit links to the digest capability without storing its raw token'
);
select is(
  (select count(*)::integer from public.refund_case_messages
   where body like '%#token=%'),
  0,
  'Message bodies do not persist raw status tokens'
);

select is(
  (public.service_read_refund_status_capability(repeat('a', 64), repeat('1', 64)) ->> 'available')::boolean,
  true,
  'The exact active digest reads one lifecycle'
);
select is(
  public.service_read_refund_status_capability(repeat('a', 64), repeat('2', 64))
    #>> '{lifecycle,schemaVersion}',
  'refund_lifecycle_v2',
  'The read consumes the canonical lifecycle contract'
);
select is(
  (select access_count::integer from public.refund_case_status_capabilities
   where token_digest = repeat('a', 64)),
  2,
  'Successful access increments only the capability counter'
);
select is(
  (select count(*)::integer from public.refund_case_status_access_audit
   where outcome = 'available'),
  2,
  'Successful reads create privacy-safe audit rows'
);

select is(
  public.service_read_refund_status_capability(repeat('b', 64), repeat('3', 64))
    - 'rateLimited',
  jsonb_build_object('available', false, 'payloadRedacted', true),
  'A guessed digest receives the generic unavailable shape'
);

select is(
  (public.service_revoke_refund_status_capabilities(
    'c4000000-0000-4000-8000-000000000001', 'security_hold'
  ) ->> 'revokedCount')::integer,
  1,
  'The exact case capability can be revoked'
);
select is(
  public.service_read_refund_status_capability(repeat('a', 64), repeat('4', 64))
    - 'rateLimited',
  jsonb_build_object('available', false, 'payloadRedacted', true),
  'A revoked digest has the same generic unavailable shape as a guessed digest'
);

select is(
  (public.service_issue_refund_status_capability(
    'c4000000-0000-4000-8000-000000000001',
    repeat('e', 64),
    statement_timestamp() + interval '30 days'
  ) ->> 'issued')::boolean,
  true,
  'A replacement capability can be issued after revocation'
);
select is(
  (public.service_read_refund_status_capability(repeat('e', 64), repeat('6', 64)) ->> 'available')::boolean,
  true,
  'The replacement capability reads the same one-case lifecycle'
);

insert into public.refund_case_status_capabilities (
  refund_case_id, token_digest, created_at, expires_at
) values (
  'c4000000-0000-4000-8000-000000000001', repeat('f', 64),
  statement_timestamp() - interval '2 days',
  statement_timestamp() - interval '1 day'
);
select is(
  public.service_read_refund_status_capability(repeat('f', 64), repeat('7', 64))
    - 'rateLimited',
  jsonb_build_object('available', false, 'payloadRedacted', true),
  'An expired digest has the same generic unavailable shape as a guessed digest'
);

insert into public.refund_case_status_access_windows (
  access_key_digest, window_started_at, request_count, expires_at
) values (
  repeat('8', 64), statement_timestamp() - interval '3 hours', 1,
  statement_timestamp() - interval '1 hour'
);
insert into public.refund_case_status_access_audit (
  access_key_digest, outcome, accessed_at, expires_at
) values (
  repeat('8', 64), 'unavailable', statement_timestamp() - interval '32 days',
  statement_timestamp() - interval '1 day'
);
select is(
  (public.service_prune_refund_status_access_evidence() ->> 'accessWindowCount')::integer,
  1,
  'Expired rate-limit evidence is pruned'
);
select is(
  (select count(*)::integer from public.refund_case_status_access_audit
   where access_key_digest = repeat('8', 64)),
  0,
  'Expired access-audit evidence is pruned'
);

select throws_ok(
  $$select public.service_issue_refund_status_capability(
    'c4000000-0000-4000-8000-000000000001', repeat('c', 64),
    statement_timestamp() + interval '46 days'
  )$$,
  '22023',
  'Invalid refund status capability request',
  'Capability lifetime cannot exceed 45 days'
);

do $$
begin
  for attempt in 1..21 loop
    perform public.service_read_refund_status_capability(
      repeat('d', 64), repeat('5', 64)
    );
  end loop;
end;
$$;
select is(
  (public.service_read_refund_status_capability(repeat('d', 64), repeat('5', 64)) ->> 'rateLimited')::boolean,
  true,
  'A status access key is rate-limited after the bounded minute window'
);

select * from finish();
rollback;
