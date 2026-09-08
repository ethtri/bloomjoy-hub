begin;

create extension if not exists pgtap with schema extensions;
set local search_path = public, extensions;

select plan(23);

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
  ('00000000-0000-0000-0000-000000000000', '89000000-0000-4000-8000-000000000001', 'authenticated', 'authenticated', 'scope-manager@example.invalid', '', now(), '{}'::jsonb, '{}'::jsonb, now(), now()),
  ('00000000-0000-0000-0000-000000000000', '89000000-0000-4000-8000-000000000002', 'authenticated', 'authenticated', 'unrelated-scope-manager@example.invalid', '', now(), '{}'::jsonb, '{}'::jsonb, now(), now());

insert into public.customer_accounts (id, name, account_type)
values ('89010000-0000-4000-8000-000000000001', 'Nayax scope fixture', 'internal');

insert into public.reporting_locations (id, account_id, name, timezone)
values (
  '89020000-0000-4000-8000-000000000001',
  '89010000-0000-4000-8000-000000000001',
  'Nashville scope fixture',
  'America/Chicago'
);

insert into public.reporting_machines (
  id, account_id, location_id, machine_label, status,
  nayax_machine_id, nayax_account_key
) values
  (
    '89030000-0000-4000-8000-000000000001',
    '89010000-0000-4000-8000-000000000001',
    '89020000-0000-4000-8000-000000000001',
    'Nashville fixture machine', 'active',
    null, null
  ),
  (
    '89030000-0000-4000-8000-000000000002',
    '89010000-0000-4000-8000-000000000001',
    '89020000-0000-4000-8000-000000000001',
    'Unrelated scope machine', 'active',
    null, null
  );

insert into public.reporting_machine_refund_managers (
  reporting_machine_id, manager_user_id, manager_email, grant_reason
) values
  (
    '89030000-0000-4000-8000-000000000001',
    '89000000-0000-4000-8000-000000000001',
    'scope-manager@example.invalid',
    'Nayax scope recovery fixture'
  ),
  (
    '89030000-0000-4000-8000-000000000002',
    '89000000-0000-4000-8000-000000000002',
    'unrelated-scope-manager@example.invalid',
    'Unrelated scope isolation fixture'
  );

insert into public.refund_cases (
  id, public_reference, reporting_machine_id, reporting_location_id,
  customer_email, issue_summary, incident_at, incident_timezone,
  payment_method, payment_amount_cents, card_last4, status,
  correlation_status, correlation_source, deterministic_fact_version
) values (
  '89040000-0000-4000-8000-000000000001', 'RF-SCOPE-RECOVERY',
  '89030000-0000-4000-8000-000000000001',
  '89020000-0000-4000-8000-000000000001',
  'scope-customer@example.invalid', 'Nayax scope recovery fixture',
  statement_timestamp() - interval '2 hours', 'America/Chicago',
  'card', 700, '4242', 'needs_review', 'needs_nayax', 'nayax', 1
);

select ok(
  has_function_privilege(
    'service_role',
    'public.service_begin_refund_nayax_lookup(uuid,bigint,text,uuid)',
    'execute'
  ) and not has_function_privilege(
    'service_role',
    'public.service_begin_refund_nayax_lookup_pre_scope_recovery_v1(uuid,bigint,text,uuid)',
    'execute'
  ),
  'Only the current lookup-begin function is executable'
);

set local role service_role;

select is(
  public.service_begin_refund_nayax_lookup(
    '89040000-0000-4000-8000-000000000001', 1, 'automatic', null
  ) ->> 'status',
  'checking',
  'The initial automatic read-only lookup begins normally'
);

select ok(
  pg_temp.capture_error($$select public.service_begin_refund_nayax_lookup(
    '89040000-0000-4000-8000-000000000001', 1, 'manual',
    '89000000-0000-4000-8000-000000000001'
  )$$) like 'P4622:A read-only Nayax transaction check is already in progress%',
  'A second invocation cannot start while the current read-only lookup is in flight'
);

reset role;
select ok(
  (select nayax_lookup_retry_count = 0
    and nayax_lookup_retry_fact_version = 1
    from public.refund_cases
    where id = '89040000-0000-4000-8000-000000000001'),
  'The initial lookup does not count as a retry'
);

set local role service_role;
select is(
  public.service_fail_refund_nayax_lookup(
    '89040000-0000-4000-8000-000000000001', 1, 1,
    'timeout', true, 'automatic', null
  ) ->> 'safeRetryEligible',
  'true',
  'A bounded initial timeout exposes a safe fresh read-only check'
);

select is(
  public.service_begin_refund_nayax_lookup(
    '89040000-0000-4000-8000-000000000001', 1, 'manual',
    '89000000-0000-4000-8000-000000000001'
  ) ->> 'safeRetryConsumed',
  'true',
  'The manager-owned retry is recorded before provider access'
);

reset role;
select is(
  (select nayax_lookup_retry_count::integer
   from public.refund_cases
   where id = '89040000-0000-4000-8000-000000000001'),
  1,
  'The first retry is recorded for the current facts'
);

set local role service_role;
select is(
  public.service_fail_refund_nayax_lookup(
    '89040000-0000-4000-8000-000000000001', 2, 1,
    'transport_error', true, 'manual',
    '89000000-0000-4000-8000-000000000001'
  ) ->> 'safeRetryEligible',
  'true',
  'A second transient read failure remains eligible for a fresh check'
);

reset role;
select ok(
  (select nayax_lookup_safe_retry_eligible
    and nayax_lookup_failure_class = 'transport_error'
   from public.refund_cases
   where id = '89040000-0000-4000-8000-000000000001'),
  'The database preserves the provider boundary transient-failure classification'
);

update public.refund_cases
set
  nayax_lookup_safe_retry_eligible = false,
  correlation_summary =
    'The one safe read-only retry is exhausted. Refund Operations owns the reviewed internal fallback.'
where id = '89040000-0000-4000-8000-000000000001';

select is(
  public.repair_refund_nayax_lookup_retry_eligibility(),
  1,
  'A previously exhausted transient read failure is narrowly re-enabled'
);

select ok(
  (select nayax_lookup_safe_retry_eligible
    and correlation_summary =
      'The read-only transaction check can be tried again. No payment action was taken.'
    and exists (
      select 1 from public.refund_case_events event
      where event.refund_case_id = refund_case.id
        and event.event_type = 'nayax_lookup_retry_reenabled'
        and event.metadata ->> 'provider_call_kind' = 'read_only'
        and event.metadata ->> 'provider_write_made' = 'false'
    )
   from public.refund_cases refund_case
   where refund_case.id = '89040000-0000-4000-8000-000000000001'),
  'The repair records its read-only, no-payment provenance'
);

set local role service_role;
select is(
  public.service_begin_refund_nayax_lookup(
    '89040000-0000-4000-8000-000000000001', 1, 'manual',
    '89000000-0000-4000-8000-000000000001'
  ) ->> 'safeRetryConsumed',
  'true',
  'A fresh check can begin after the prior transient retry failed'
);

reset role;
select is(
  (select nayax_lookup_retry_count::integer
   from public.refund_cases
   where id = '89040000-0000-4000-8000-000000000001'),
  2,
  'Read-only retry history remains diagnostic without becoming a lifetime cap'
);

update public.refund_cases
set incident_at = incident_at + interval '1 minute'
where id = '89040000-0000-4000-8000-000000000001';

select ok(
  (select nayax_lookup_retry_count = 0
    and nayax_lookup_retry_fact_version = 2
    and nayax_lookup_status = 'not_started'
    and not nayax_lookup_safe_retry_eligible
   from public.refund_cases
   where id = '89040000-0000-4000-8000-000000000001'),
  'A new atomic fact version invalidates the old lookup and receives a fresh lifecycle'
);

set local role service_role;
select is(
  public.service_begin_refund_nayax_lookup(
    '89040000-0000-4000-8000-000000000001', 2, 'automatic', null
  ) ->> 'status',
  'checking',
  'The initial lookup for corrected facts begins normally'
);

reset role;
update public.refund_cases
set nayax_lookup_started_at = statement_timestamp() - interval '2 minutes'
where id = '89040000-0000-4000-8000-000000000001';

set local role service_role;
select is(
  public.service_begin_refund_nayax_lookup(
    '89040000-0000-4000-8000-000000000001', 2, 'manual',
    '89000000-0000-4000-8000-000000000001'
  ) ->> 'status',
  'checking',
  'A stale interrupted read is recovered before a fresh check begins'
);

reset role;
select ok(
  (select nayax_lookup_generation = 5
    and nayax_lookup_retry_count = 1
    and nayax_lookup_retry_fact_version = 2
   from public.refund_cases
   where id = '89040000-0000-4000-8000-000000000001'),
  'Stale-read recovery advances generation and records one retry for the corrected facts'
);

set local role service_role;
select is(
  public.service_fail_refund_nayax_lookup(
    '89040000-0000-4000-8000-000000000001', 5, 2,
    'provider_error', false, 'manual',
    '89000000-0000-4000-8000-000000000001'
  ) ->> 'safeRetryEligible',
  'false',
  'A non-retryable provider response remains ineligible'
);

select ok(
  pg_temp.capture_error($$select public.service_begin_refund_nayax_lookup(
    '89040000-0000-4000-8000-000000000001', 2, 'manual',
    '89000000-0000-4000-8000-000000000001'
  )$$) like 'P4622:A read-only Nayax retry is not safe%',
  'A classified-unsafe read failure still stops before provider access'
);

reset role;
update public.refund_cases
set
  nayax_lookup_status = 'setup_needed',
  correlation_status = 'nayax_not_configured',
  correlation_summary =
    'This machine needs an explicit Nayax account scope before card lookup can run.'
where id = '89040000-0000-4000-8000-000000000001';

set local role authenticated;
select pg_temp.set_auth_claims('89000000-0000-4000-8000-000000000001');

select is(
  public.admin_get_refund_operations_overview() ->>
    'nayaxScopeRecoveryContractVersion',
  'refund_nayax_scope_recovery_v1',
  'The manager overview versions the internal scope-recovery contract'
);

select ok(
  (select item -> 'nayaxLookupSummary' ->> 'setupIssueCode' = 'machine_mapping_missing'
    and item -> 'nayaxLookupSummary' ->> 'responsibleOwner' = 'refund_operations'
    and item -> 'nayaxLookupSummary' ->> 'requiredAccountScope' =
      'Nashville scope fixture Nayax account scope'
    and (item -> 'nayaxLookupSummary' ->> 'customerActionRequired')::boolean is false
   from jsonb_array_elements(
     public.admin_get_refund_operations_overview() -> 'cases'
   ) item
   where item ->> 'id' = '89040000-0000-4000-8000-000000000001'),
  'The manager sees the exact missing internal mapping, owner, and safe account scope'
);

select ok(
  (select item -> 'nayaxLookupSummary' ->> 'recommendedAction'
      like 'Refund Operations must repair%Do not ask the customer%'
   from jsonb_array_elements(
     public.admin_get_refund_operations_overview() -> 'cases'
   ) item
   where item ->> 'id' = '89040000-0000-4000-8000-000000000001'),
  'The persisted next action forbids repeating Bloomjoy-owned facts to the customer'
);

select pg_temp.set_auth_claims('89000000-0000-4000-8000-000000000002');
select is(
  (select count(*)::integer
   from jsonb_array_elements(
     public.admin_get_refund_operations_overview() -> 'cases'
   ) item
   where item ->> 'id' = '89040000-0000-4000-8000-000000000001'),
  0,
  'An unrelated manager cannot discover the case or its account-scope state'
);

select * from finish();
rollback;
