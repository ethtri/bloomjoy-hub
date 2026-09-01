begin;

create extension if not exists pgtap with schema extensions;
set local search_path = public, extensions;

select plan(14);

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
  'Only the bounded current lookup-begin function is executable'
);

set local role service_role;

select is(
  public.service_begin_refund_nayax_lookup(
    '89040000-0000-4000-8000-000000000001', 1, 'automatic', null
  ) ->> 'status',
  'checking',
  'The initial automatic read-only lookup begins normally'
);

reset role;
select ok(
  (select nayax_lookup_retry_count = 0
    and nayax_lookup_retry_fact_version = 1
    from public.refund_cases
    where id = '89040000-0000-4000-8000-000000000001'),
  'The initial lookup does not consume the one safe retry'
);

set local role service_role;
select is(
  public.service_fail_refund_nayax_lookup(
    '89040000-0000-4000-8000-000000000001', 1, 1,
    'timeout', true, 'automatic', null
  ) ->> 'safeRetryEligible',
  'true',
  'A bounded initial timeout exposes one safe internal retry'
);

select is(
  public.service_begin_refund_nayax_lookup(
    '89040000-0000-4000-8000-000000000001', 1, 'manual',
    '89000000-0000-4000-8000-000000000001'
  ) ->> 'safeRetryConsumed',
  'true',
  'The manager-owned retry is explicitly consumed before provider access'
);

reset role;
select is(
  (select nayax_lookup_retry_count::integer
   from public.refund_cases
   where id = '89040000-0000-4000-8000-000000000001'),
  1,
  'Exactly one retry is recorded for the current facts'
);

set local role service_role;
select is(
  public.service_fail_refund_nayax_lookup(
    '89040000-0000-4000-8000-000000000001', 2, 1,
    'timeout', true, 'manual',
    '89000000-0000-4000-8000-000000000001'
  ) ->> 'safeRetryEligible',
  'false',
  'The second failure response truthfully reports that no retry remains'
);

reset role;
select ok(
  (select not nayax_lookup_safe_retry_eligible
    and correlation_summary =
      'The one safe read-only retry is exhausted. Refund Operations owns the reviewed internal fallback.'
   from public.refund_cases
   where id = '89040000-0000-4000-8000-000000000001'),
  'The database masks another retry and assigns the internal fallback after one attempt'
);

set local role service_role;
select ok(
  pg_temp.capture_error($$select public.service_begin_refund_nayax_lookup(
    '89040000-0000-4000-8000-000000000001', 1, 'automatic', null
  )$$) like 'P4622:A read-only Nayax retry is not safe%',
  'A second retry stops before provider access even if an automatic path calls again'
);

reset role;
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
  'A new atomic fact version invalidates the old failure and receives a fresh bounded lookup lifecycle'
);

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
