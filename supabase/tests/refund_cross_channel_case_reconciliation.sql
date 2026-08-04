begin;

create extension if not exists pgtap with schema extensions;
set local search_path = public, extensions;

select plan(26);

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
  instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at
)
values
  (
    '00000000-0000-0000-0000-000000000000',
    '91000000-0000-4000-8000-000000000001',
    'authenticated', 'authenticated', 'reconciliation-manager@example.test', '', now(),
    '{}'::jsonb, '{}'::jsonb, now(), now()
  ),
  (
    '00000000-0000-0000-0000-000000000000',
    '91000000-0000-4000-8000-000000000002',
    'authenticated', 'authenticated', 'unassigned-manager@example.test', '', now(),
    '{}'::jsonb, '{}'::jsonb, now(), now()
  );

insert into public.customer_accounts (id, name, account_type)
values ('91100000-0000-4000-8000-000000000001', 'Reconciliation test', 'customer');

insert into public.reporting_locations (id, account_id, name, timezone)
values (
  '91200000-0000-4000-8000-000000000001',
  '91100000-0000-4000-8000-000000000001',
  'Reconciliation test location',
  'America/Los_Angeles'
);

insert into public.reporting_machines (
  id, account_id, location_id, machine_label, machine_type, nayax_refunds_enabled,
  nayax_machine_id, nayax_refund_max_amount_cents
)
values (
  '91300000-0000-4000-8000-000000000001',
  '91100000-0000-4000-8000-000000000001',
  '91200000-0000-4000-8000-000000000001',
  'Reconciliation test machine',
  'commercial',
  true,
  'reconciliation-nayax-machine',
  2000
);

insert into public.reporting_machine_refund_managers (
  id, reporting_machine_id, manager_user_id, manager_email, grant_reason
)
values (
  '91400000-0000-4000-8000-000000000001',
  '91300000-0000-4000-8000-000000000001',
  '91000000-0000-4000-8000-000000000001',
  'reconciliation-manager@example.test',
  'Cross-channel reconciliation test'
);

select has_table(
  'public',
  'refund_case_reconciliation_reviews',
  'PII-minimized reconciliation review table exists'
);

select has_column(
  'public',
  'refund_cases',
  'duplicate_of_refund_case_id',
  'Refund cases can point to one canonical case'
);

select has_function(
  'public',
  'admin_get_refund_case_reconciliation',
  array['uuid'],
  'Manager reconciliation context RPC exists'
);

select has_function(
  'public',
  'admin_resolve_refund_case_reconciliation',
  array['uuid','text','uuid','text'],
  'Manager reconciliation resolution RPC exists'
);

select ok(
  not has_table_privilege('authenticated', 'public.refund_case_reconciliation_reviews', 'select'),
  'Browser clients cannot read the comparison table directly'
);

select ok(
  has_function_privilege(
    'authenticated',
    'public.admin_get_refund_case_reconciliation(uuid)',
    'execute'
  ),
  'Authenticated managers can invoke the scoped context RPC'
);

insert into public.refund_cases (
  id, reporting_machine_id, reporting_location_id, customer_email, customer_name,
  issue_summary, incident_at, payment_method, payment_amount_cents, card_last4,
  card_wallet_used, status, correlation_status, intake_source
)
values (
  '92000000-0000-4000-8000-000000000001',
  '91300000-0000-4000-8000-000000000001',
  '91200000-0000-4000-8000-000000000001',
  'same-customer@example.test',
  'Synthetic Customer',
  'Hosted form fixture',
  '2026-08-04 18:00:00+00',
  'card', 700, '4242', false, 'needs_review', 'manual_review', 'form'
);

insert into public.refund_cases (
  id, reporting_machine_id, reporting_location_id, customer_email, customer_name,
  issue_summary, incident_at, payment_method, payment_amount_cents, card_last4,
  card_wallet_used, status, correlation_status, intake_source
)
values (
  '92000000-0000-4000-8000-000000000002',
  '91300000-0000-4000-8000-000000000001',
  '91200000-0000-4000-8000-000000000001',
  'SAME-CUSTOMER@example.test',
  'Synthetic Customer',
  'Gmail fixture',
  '2026-08-04 18:08:00+00',
  'card', 700, '4242', false, 'needs_review', 'manual_review', 'gmail'
);

select is(
  (select count(*)::integer from public.refund_case_reconciliation_reviews),
  1,
  'Two matching channel cases create one race-safe review pair'
);

select is(
  (select match_class from public.refund_case_reconciliation_reviews),
  'exact',
  'The complete high-confidence fact set is classified as exact'
);

select ok(
  (select reason_codes @> array[
    'customer_email_exact',
    'machine_exact',
    'incident_within_15_minutes',
    'amount_exact',
    'payment_method_exact',
    'card_last4_exact',
    'wallet_state_exact'
  ]::text[] from public.refund_case_reconciliation_reviews),
  'Only fixed, non-PII match reasons are persisted'
);

select ok(
  public.refund_case_has_unresolved_reconciliation('92000000-0000-4000-8000-000000000001'),
  'An exact candidate blocks the first case pending manager review'
);

select ok(
  pg_temp.capture_error($sql$
    update public.refund_cases
    set status = 'approved', decision = 'approved'
    where id = '92000000-0000-4000-8000-000000000001'
  $sql$) like '%Resolve possible duplicate refund cases%',
  'A pending review prevents an official case decision'
);

select ok(
  pg_get_functiondef('public.can_prepare_nayax_refund_execution(uuid,uuid)'::regprocedure)
    like '%duplicate_of_refund_case_id is null%'
  and pg_get_functiondef('public.can_prepare_nayax_refund_execution(uuid,uuid)'::regprocedure)
    like '%refund_case_has_unresolved_reconciliation%',
  'The Nayax readiness predicate fails closed for duplicate state'
);

select set_config('request.jwt.claim.sub', '91000000-0000-4000-8000-000000000001', true);

select is(
  (public.admin_get_refund_case_reconciliation('92000000-0000-4000-8000-000000000001') ->> 'actionBlocked')::boolean,
  true,
  'The assigned manager sees the case as action-blocked'
);

select is(
  jsonb_array_length(
    public.admin_get_refund_case_reconciliation('92000000-0000-4000-8000-000000000001') -> 'reviews'
  ),
  1,
  'The assigned manager sees one linked review'
);

select ok(
  public.admin_get_refund_case_reconciliation('92000000-0000-4000-8000-000000000001')::text
    !~ 'same-customer@example.test|Hosted form fixture|Gmail fixture|4242',
  'The manager comparison contract omits customer PII, complaint text, and card digits'
);

select public.admin_resolve_refund_case_reconciliation(
  (select id from public.refund_case_reconciliation_reviews),
  'duplicate',
  '92000000-0000-4000-8000-000000000001',
  'same_incident'
);

select is(
  (
    select duplicate_of_refund_case_id
    from public.refund_cases
    where id = '92000000-0000-4000-8000-000000000002'
  ),
  '92000000-0000-4000-8000-000000000001'::uuid,
  'The manager can mark the later case as a duplicate of the canonical case'
);

select ok(
  not public.refund_case_has_unresolved_reconciliation('92000000-0000-4000-8000-000000000001'),
  'Resolving the pair removes the canonical case pending block'
);

select ok(
  pg_temp.capture_error($sql$
    update public.refund_cases
    set status = 'approved', decision = 'approved'
    where id = '92000000-0000-4000-8000-000000000002'
  $sql$) like '%confirmed duplicate case%',
  'A confirmed duplicate cannot take an official action'
);

select public.admin_resolve_refund_case_reconciliation(
  (select id from public.refund_case_reconciliation_reviews),
  'distinct',
  null,
  'different_purchase'
);

select is(
  (
    select duplicate_of_refund_case_id
    from public.refund_cases
    where id = '92000000-0000-4000-8000-000000000002'
  ),
  null,
  'A duplicate decision can be reversed to distinct before an official action'
);

select is(
  (select status from public.refund_case_reconciliation_reviews),
  'confirmed_distinct',
  'The reversible decision retains an auditable distinct resolution'
);

insert into public.refund_cases (
  id, reporting_machine_id, reporting_location_id, customer_email, issue_summary,
  incident_at, payment_method, payment_amount_cents, card_last4, card_wallet_used,
  status, correlation_status, intake_source
)
values (
  '92000000-0000-4000-8000-000000000003',
  '91300000-0000-4000-8000-000000000001',
  '91200000-0000-4000-8000-000000000001',
  'same-customer@example.test',
  'Possible match fixture',
  '2026-08-04 21:00:00+00',
  'card', 700, '9999', false, 'needs_review', 'manual_review', 'sms_google_form'
);

select is(
  (
    select match_class
    from public.refund_case_reconciliation_reviews
    where '92000000-0000-4000-8000-000000000003' in (
      left_refund_case_id,
      right_refund_case_id
    )
    order by created_at
    limit 1
  ),
  'possible',
  'A partial cross-channel match is routed to manager review without silent merge'
);

select ok(
  (public.admin_get_refund_reconciliation_health() ->> 'pendingReviewCount')::integer >= 1
  and (public.admin_get_refund_reconciliation_health() ->> 'payloadRedacted')::boolean,
  'Aggregate health reports pending work without raw customer facts'
);

select ok(
  (
    select count(*) = 4
    from public.refund_case_events
    where event_type = 'cross_channel_reconciliation_resolved'
      and metadata ->> 'payload_redacted' = 'true'
  ),
  'Each manager resolution writes one redacted audit event to each case'
);

select set_config('request.jwt.claim.sub', '91000000-0000-4000-8000-000000000002', true);

select ok(
  pg_temp.capture_error($sql$
    select public.admin_get_refund_case_reconciliation('92000000-0000-4000-8000-000000000001')
  $sql$) like '%Refund case access required%',
  'An unassigned manager cannot read the reconciliation context'
);

select set_config('request.jwt.claim.sub', '', true);

select ok(
  pg_temp.capture_error($sql$
    select public.admin_get_refund_reconciliation_health()
  $sql$) like '%Authentication required%',
  'Unauthenticated callers cannot read reconciliation health'
);

select ok(
  pg_get_functiondef('public.assert_refund_adjustment_reconciliation_safe()'::regprocedure)
    like '%Resolve possible duplicate refund cases before settlement%'
  and pg_get_functiondef('public.assert_refund_case_nayax_reconciliation_safe()'::regprocedure)
    like '%Resolve possible duplicate refund cases before provider execution%',
  'Settlement and provider guard functions both fail closed'
);

select * from finish();
rollback;
