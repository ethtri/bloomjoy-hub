begin;

create extension if not exists pgtap with schema extensions;
set local search_path = public, extensions;

select plan(19);

insert into auth.users (
  instance_id, id, aud, role, email, encrypted_password,
  email_confirmed_at, raw_app_meta_data, raw_user_meta_data, created_at, updated_at
)
values (
  '00000000-0000-0000-0000-000000000000',
  '80000000-0000-4000-8000-000000000001',
  'authenticated', 'authenticated', 'qr-manager@example.test', '', now(),
  '{}'::jsonb, '{}'::jsonb, now(), now()
);

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

insert into public.customer_accounts (id, name, account_type)
values ('81000000-0000-4000-8000-000000000001', 'Refund QR safety test', 'customer');

insert into public.reporting_locations (id, account_id, name, timezone, status)
values
  (
    '82000000-0000-4000-8000-000000000001',
    '81000000-0000-4000-8000-000000000001',
    'Refund QR test location one',
    'America/Los_Angeles',
    'active'
  ),
  (
    '82000000-0000-4000-8000-000000000002',
    '81000000-0000-4000-8000-000000000001',
    'Refund QR test location two',
    'America/Los_Angeles',
    'active'
  );

insert into public.reporting_machines (
  id,
  account_id,
  location_id,
  machine_label,
  machine_type,
  status,
  refund_intake_enabled,
  refund_public_display_label,
  nayax_machine_id,
  nayax_account_key
)
values
  (
    '83000000-0000-4000-8000-000000000001',
    '81000000-0000-4000-8000-000000000001',
    '82000000-0000-4000-8000-000000000001',
    'Refund QR machine one',
    'commercial',
    'active',
    true,
    'Refund QR machine one',
    'QR-NAYAX-1',
    'QR_TEST'
  ),
  (
    '83000000-0000-4000-8000-000000000002',
    '81000000-0000-4000-8000-000000000001',
    '82000000-0000-4000-8000-000000000002',
    'Refund QR machine two',
    'mini',
    'active',
    true,
    'Refund QR machine two',
    'QR-NAYAX-2',
    'QR_TEST'
  );

insert into public.refund_nayax_machine_inventory (
  account_key, nayax_machine_id, machine_name, provider_is_active, refund_category,
  reporting_machine_id, reconciliation_state, setup_reason
)
values
  ('QR_TEST', 'QR-NAYAX-1', 'Refund QR machine one', true, 'cotton_candy',
    '83000000-0000-4000-8000-000000000001', 'published', 'ready'),
  ('QR_TEST', 'QR-NAYAX-2', 'Refund QR machine two', true, 'cotton_candy',
    '83000000-0000-4000-8000-000000000002', 'published', 'ready');

insert into public.reporting_machine_refund_managers (
  reporting_machine_id, manager_user_id, manager_email, status, grant_reason
)
values
  ('83000000-0000-4000-8000-000000000001', '80000000-0000-4000-8000-000000000001', 'qr-manager@example.test', 'active', 'QR eligibility test'),
  ('83000000-0000-4000-8000-000000000002', '80000000-0000-4000-8000-000000000001', 'qr-manager@example.test', 'active', 'QR eligibility test');

insert into public.refund_machine_qr_codes (
  id,
  reporting_machine_id,
  public_code,
  version
)
values
  (
    '84000000-0000-4000-8000-000000000001',
    '83000000-0000-4000-8000-000000000001',
    'refund_qr_public_code_machine_one_000001',
    1
  ),
  (
    '84000000-0000-4000-8000-000000000002',
    '83000000-0000-4000-8000-000000000002',
    'refund_qr_public_code_machine_two_00002',
    1
  );

select has_table(
  'public',
  'refund_machine_qr_codes',
  'Refund machine QR codes have a dedicated server-only table'
);

select has_table(
  'public',
  'refund_qr_claim_contexts',
  'Refund QR claim contexts have a dedicated server-only table'
);

select has_column(
  'public',
  'refund_cases',
  'refund_qr_claim_context_id',
  'Refund cases can reference one verified QR claim context'
);

select has_index(
  'public',
  'refund_machine_qr_codes',
  'refund_machine_qr_codes_one_active_per_machine_idx',
  'Only one active QR code is allowed for a machine'
);

select has_index(
  'public',
  'refund_cases',
  'refund_cases_refund_qr_claim_context_id_idx',
  'A QR claim context can be linked to only one refund case'
);

select ok(
  (
    select bool_and(relrowsecurity)
    from pg_class
    where oid in (
      'public.refund_machine_qr_codes'::regclass,
      'public.refund_qr_claim_contexts'::regclass
    )
  ),
  'Both QR tables enforce row-level security'
);

select ok(
  not has_table_privilege('anon', 'public.refund_machine_qr_codes', 'select')
  and not has_table_privilege('authenticated', 'public.refund_machine_qr_codes', 'select')
  and not has_table_privilege('anon', 'public.refund_qr_claim_contexts', 'select')
  and not has_table_privilege('authenticated', 'public.refund_qr_claim_contexts', 'select'),
  'Browser roles have no direct QR-code or claim-context table access'
);

select ok(
  has_table_privilege('service_role', 'public.refund_machine_qr_codes', 'select')
  and has_table_privilege('service_role', 'public.refund_machine_qr_codes', 'insert')
  and has_table_privilege('service_role', 'public.refund_machine_qr_codes', 'update')
  and has_table_privilege('service_role', 'public.refund_qr_claim_contexts', 'select')
  and has_table_privilege('service_role', 'public.refund_qr_claim_contexts', 'insert')
  and has_table_privilege('service_role', 'public.refund_qr_claim_contexts', 'update'),
  'Only the server role receives the QR table privileges required by intake and rotation'
);

select is(
  public.record_public_intake_rate_limit_event(
    'refund_qr_claim',
    'ip',
    repeat('8', 64),
    3600
  ),
  1,
  'A QR claim start uses its own supported rate-limit scope'
);

select is(
  public.record_public_intake_rate_limit_event(
    'submission',
    'ip',
    repeat('8', 64),
    3600
  ),
  1,
  'QR claim starts do not consume the completed-submission quota'
);

select ok(
  pg_temp.capture_error($sql$
    insert into public.refund_machine_qr_codes (
      reporting_machine_id,
      public_code,
      version
    )
    values (
      '83000000-0000-4000-8000-000000000001',
      'refund_qr_duplicate_active_machine_one_0001',
      2
    )
  $sql$) like '23505:%',
  'A machine cannot have two active QR codes'
);

select ok(
  pg_temp.capture_error($sql$
    insert into public.refund_qr_claim_contexts (
      id,
      qr_code_id,
      reporting_machine_id,
      claim_token_hash
    )
    values (
      '85000000-0000-4000-8000-000000000099',
      '84000000-0000-4000-8000-000000000001',
      '83000000-0000-4000-8000-000000000002',
      repeat('9', 64)
    )
  $sql$) like '23514:%',
  'A tampered QR machine cannot create a claim context'
);

insert into public.refund_qr_claim_contexts (
  id,
  qr_code_id,
  reporting_machine_id,
  claim_token_hash
)
values (
  '85000000-0000-4000-8000-000000000001',
  '84000000-0000-4000-8000-000000000001',
  '83000000-0000-4000-8000-000000000001',
  repeat('a', 64)
);

insert into public.refund_cases (
  id,
  reporting_machine_id,
  reporting_location_id,
  customer_email,
  issue_summary,
  incident_at,
  payment_method,
  payment_amount_cents,
  card_last4,
  refund_qr_claim_context_id
)
values (
  '86000000-0000-4000-8000-000000000001',
  '83000000-0000-4000-8000-000000000001',
  '82000000-0000-4000-8000-000000000001',
  'valid-qr@example.test',
  'Valid QR claim safety fixture',
  statement_timestamp(),
  'card',
  700,
  '4242',
  '85000000-0000-4000-8000-000000000001'
);

select ok(
  (
    select consumed_at is not null
    from public.refund_qr_claim_contexts
    where id = '85000000-0000-4000-8000-000000000001'
  ),
  'Creating a refund case atomically consumes its valid QR claim'
);

select ok(
  pg_temp.capture_error($sql$
    insert into public.refund_cases (
      reporting_machine_id,
      reporting_location_id,
      customer_email,
      issue_summary,
      incident_at,
      payment_method,
      payment_amount_cents,
      card_last4,
      refund_qr_claim_context_id
    )
    values (
      '83000000-0000-4000-8000-000000000001',
      '82000000-0000-4000-8000-000000000001',
      'duplicate-qr@example.test',
      'Duplicate QR claim safety fixture',
      statement_timestamp(),
      'card',
      700,
      '4242',
      '85000000-0000-4000-8000-000000000001'
    )
  $sql$) like '23505:%',
  'A consumed QR claim cannot create a second refund case'
);

insert into public.refund_qr_claim_contexts (
  id,
  qr_code_id,
  reporting_machine_id,
  claim_token_hash
)
values (
  '85000000-0000-4000-8000-000000000002',
  '84000000-0000-4000-8000-000000000001',
  '83000000-0000-4000-8000-000000000001',
  repeat('b', 64)
);

select ok(
  pg_temp.capture_error($sql$
    insert into public.refund_cases (
      reporting_machine_id,
      reporting_location_id,
      customer_email,
      issue_summary,
      incident_at,
      payment_method,
      payment_amount_cents,
      card_last4,
      refund_qr_claim_context_id
    )
    values (
      '83000000-0000-4000-8000-000000000002',
      '82000000-0000-4000-8000-000000000002',
      'tampered-case@example.test',
      'Tampered case machine safety fixture',
      statement_timestamp(),
      'card',
      700,
      '4242',
      '85000000-0000-4000-8000-000000000002'
    )
  $sql$) like '23514:%',
  'A claim cannot be attached to a refund case for another machine'
);

insert into public.refund_qr_claim_contexts (
  id,
  qr_code_id,
  reporting_machine_id,
  claim_token_hash,
  opened_at,
  expires_at
)
values (
  '85000000-0000-4000-8000-000000000003',
  '84000000-0000-4000-8000-000000000001',
  '83000000-0000-4000-8000-000000000001',
  repeat('c', 64),
  statement_timestamp() - interval '59 minutes',
  statement_timestamp() - interval '1 minute'
);

select ok(
  pg_temp.capture_error($sql$
    insert into public.refund_cases (
      reporting_machine_id,
      reporting_location_id,
      customer_email,
      issue_summary,
      incident_at,
      payment_method,
      payment_amount_cents,
      card_last4,
      refund_qr_claim_context_id
    )
    values (
      '83000000-0000-4000-8000-000000000001',
      '82000000-0000-4000-8000-000000000001',
      'expired-qr@example.test',
      'Expired QR claim safety fixture',
      statement_timestamp(),
      'card',
      700,
      '4242',
      '85000000-0000-4000-8000-000000000003'
    )
  $sql$) like '23514:%',
  'An expired QR claim cannot create a refund case'
);

insert into public.refund_qr_claim_contexts (
  id,
  qr_code_id,
  reporting_machine_id,
  claim_token_hash
)
values (
  '85000000-0000-4000-8000-000000000004',
  '84000000-0000-4000-8000-000000000002',
  '83000000-0000-4000-8000-000000000002',
  repeat('d', 64)
);

update public.refund_machine_qr_codes
set
  status = 'disabled',
  deactivated_at = statement_timestamp(),
  deactivation_reason = 'Safety test disable'
where id = '84000000-0000-4000-8000-000000000002';

select ok(
  pg_temp.capture_error($sql$
    insert into public.refund_cases (
      reporting_machine_id,
      reporting_location_id,
      customer_email,
      issue_summary,
      incident_at,
      payment_method,
      payment_amount_cents,
      card_last4,
      refund_qr_claim_context_id
    )
    values (
      '83000000-0000-4000-8000-000000000002',
      '82000000-0000-4000-8000-000000000002',
      'disabled-qr@example.test',
      'Disabled QR claim safety fixture',
      statement_timestamp(),
      'card',
      700,
      '4242',
      '85000000-0000-4000-8000-000000000004'
    )
  $sql$) like '23514:%',
  'Disabling a QR code invalidates its unconsumed claim contexts'
);

select is(
  pg_temp.capture_error($sql$
    insert into public.refund_cases (
      reporting_machine_id,
      reporting_location_id,
      customer_email,
      issue_summary,
      incident_at,
      payment_method,
      payment_amount_cents,
      card_last4
    )
    values (
      '83000000-0000-4000-8000-000000000001',
      '82000000-0000-4000-8000-000000000001',
      'direct-intake@example.test',
      'Direct intake compatibility fixture',
      statement_timestamp(),
      'card',
      700,
      '4242'
    )
  $sql$),
  null,
  'Direct refund intake still works without QR claim evidence'
);

select ok(
  pg_get_functiondef('public.consume_refund_qr_claim_context()'::regprocedure)
    like '%for update%'
  and pg_get_functiondef('public.consume_refund_qr_claim_context()'::regprocedure)
    like '%statement_timestamp()%',
  'QR claim consumption locks the claim and uses database server time'
);

select * from finish();
rollback;
