begin;

create extension if not exists pgtap with schema extensions;
set local search_path = public, extensions;

select plan(49);

create function pg_temp.capture_error(statement text)
returns text
language plpgsql
as $$
begin
  execute statement;
  return null;
exception when others then
  return sqlstate || ':' || sqlerrm;
end;
$$;

create function pg_temp.set_auth_claims(
  p_user_id uuid,
  p_aal text,
  p_amr jsonb
)
returns void
language plpgsql
as $$
begin
  perform set_config('request.jwt.claim.sub', p_user_id::text, true);
  perform set_config('request.jwt.claim.role', 'authenticated', true);
  perform set_config(
    'request.jwt.claims',
    jsonb_build_object(
      'sub', p_user_id,
      'role', 'authenticated',
      'aal', p_aal,
      'amr', p_amr
    )::text,
    true
  );
end;
$$;

create temporary table step_up_test_intents (
  intent_key text primary key,
  intent_id uuid not null
);
grant all on table pg_temp.step_up_test_intents to authenticated, service_role;

create temporary table step_up_test_results (
  result_key text primary key,
  result jsonb not null
);
grant all on table pg_temp.step_up_test_results to authenticated, service_role;

create temporary table step_up_test_factor_proofs (
  intent_key text primary key,
  proof text not null
);
grant all on table pg_temp.step_up_test_factor_proofs to authenticated, service_role;

create function pg_temp.intent_not_before(p_intent_id uuid)
returns timestamptz
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select intent.not_before
  from public.refund_manager_action_step_up_intents intent
  where intent.id = p_intent_id;
$$;
grant execute on function pg_temp.intent_not_before(uuid) to authenticated;

create function pg_temp.intent_totp_epoch(p_intent_id uuid, p_offset_seconds integer)
returns numeric
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select extract(epoch from date_trunc('second', intent.not_before)
    + make_interval(secs => p_offset_seconds))
  from public.refund_manager_action_step_up_intents intent
  where intent.id = p_intent_id;
$$;
grant execute on function pg_temp.intent_totp_epoch(uuid, integer) to authenticated;

create function pg_temp.authorization_totp_epoch(p_authorization_id uuid)
returns numeric
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select extract(epoch from auth_row.verified_totp_at)
  from public.refund_case_official_action_authorizations auth_row
  where auth_row.id = p_authorization_id;
$$;
grant execute on function pg_temp.authorization_totp_epoch(uuid) to authenticated;

insert into auth.users (
  instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at
)
values
  ('00000000-0000-0000-0000-000000000000', '8a000000-0000-4000-8000-000000000001',
   'authenticated', 'authenticated', 'step-up-manager@example.test', '', now(), '{}'::jsonb, '{}'::jsonb, now(), now()),
  ('00000000-0000-0000-0000-000000000000', '8a000000-0000-4000-8000-000000000002',
   'authenticated', 'authenticated', 'step-up-admin@example.test', '', now(), '{}'::jsonb, '{}'::jsonb, now(), now()),
  ('00000000-0000-0000-0000-000000000000', '8a000000-0000-4000-8000-000000000003',
   'authenticated', 'authenticated', 'step-up-unrelated@example.test', '', now(), '{}'::jsonb, '{}'::jsonb, now(), now());

insert into public.customer_accounts (id, name, account_type)
values ('8a100000-0000-4000-8000-000000000001', 'Step-up safety', 'customer');

insert into public.reporting_locations (id, account_id, name, timezone)
values (
  '8a200000-0000-4000-8000-000000000001',
  '8a100000-0000-4000-8000-000000000001',
  'Step-up test location',
  'America/Los_Angeles'
);

insert into public.reporting_machines (
  id, account_id, location_id, machine_label, nayax_machine_id,
  nayax_account_key, nayax_refunds_enabled, nayax_refund_max_amount_cents
)
values (
  '8a300000-0000-4000-8000-000000000001',
  '8a100000-0000-4000-8000-000000000001',
  '8a200000-0000-4000-8000-000000000001',
  'Step-up test machine', 'STEP-UP-MACHINE', 'STEP-UP-ACCOUNT', true, 2500
);

insert into public.reporting_machine_refund_managers (
  id, reporting_machine_id, manager_user_id, manager_email, grant_reason
)
values
  ('8a400000-0000-4000-8000-000000000001', '8a300000-0000-4000-8000-000000000001',
   '8a000000-0000-4000-8000-000000000001', 'step-up-manager@example.test', 'Step-up safety'),
  ('8a400000-0000-4000-8000-000000000002', '8a300000-0000-4000-8000-000000000001',
   '8a000000-0000-4000-8000-000000000002', 'step-up-admin@example.test', 'Admin exclusion');

insert into public.admin_roles (id, user_id, role, active)
values
  (
    '8a410000-0000-4000-8000-000000000004',
    '8a000000-0000-4000-8000-000000000001',
    'super_admin', true
  ),
  (
    '8a410000-0000-4000-8000-000000000001',
    '8a000000-0000-4000-8000-000000000002',
    'super_admin', true
  ),
  (
    '8a410000-0000-4000-8000-000000000002',
    '8a000000-0000-4000-8000-000000000003',
    'super_admin', true
  );

insert into public.machine_sales_facts (
  id, reporting_machine_id, reporting_location_id, sale_date, payment_method,
  net_sales_cents, transaction_count, source, source_row_hash, raw_payload
)
values (
  '8a500000-0000-4000-8000-000000000001',
  '8a300000-0000-4000-8000-000000000001',
  '8a200000-0000-4000-8000-000000000001',
  current_date, 'cash', 1400, 2, 'sample_seed', 'step-up-sale', '{"fixture":true}'::jsonb
);

insert into public.refund_cases (
  id, public_reference, reporting_machine_id, reporting_location_id,
  customer_email, zelle_payment_contact, issue_summary, incident_at,
  payment_method, payment_amount_cents, status, correlation_status,
  correlation_source, correlation_confidence, matched_sales_fact_id,
  refund_amount_cents, nayax_match_execution_eligible
)
values
  ('8a600000-0000-4000-8000-000000000001', 'RF-STEP-UP-ONE',
   '8a300000-0000-4000-8000-000000000001', '8a200000-0000-4000-8000-000000000001',
   'step-up-one@example.test', 'synthetic-contact', 'Step-up one', now() - interval '2 hours',
   'cash', 700, 'needs_review', 'matched', 'sunze', 0.95,
   '8a500000-0000-4000-8000-000000000001', 700, false),
  ('8a600000-0000-4000-8000-000000000002', 'RF-STEP-UP-TWO',
   '8a300000-0000-4000-8000-000000000001', '8a200000-0000-4000-8000-000000000001',
   'step-up-two@example.test', 'synthetic-contact', 'Step-up two', now() - interval '2 hours',
   'cash', 650, 'needs_review', 'matched', 'sunze', 0.95,
   '8a500000-0000-4000-8000-000000000001', 650, false),
  ('8a600000-0000-4000-8000-000000000003', 'RF-STEP-UP-NAYAX',
   '8a300000-0000-4000-8000-000000000001', '8a200000-0000-4000-8000-000000000001',
   'step-up-nayax@example.test', null, 'Step-up Nayax execution', now() - interval '1 hour',
   'card', 600, 'card_refund_pending', 'matched', 'nayax', 1,
   null, 600, false);

update public.refund_cases
set
  decision = 'approved',
  decided_by = '8a000000-0000-4000-8000-000000000001',
  decided_at = statement_timestamp(),
  card_last4 = '4242',
  card_wallet_used = false,
  matched_nayax_transaction_id = 'STEP-UP-NAYAX-TX-001',
  matched_nayax_site_id = 101,
  matched_nayax_machine_auth_time = statement_timestamp() - interval '1 hour',
  matched_nayax_amount_cents = 600,
  matched_nayax_card_last4 = '4242',
  matched_nayax_currency_code = 'USD',
  nayax_recommendation_state = 'high_confidence',
  nayax_recommendation_policy_version = 'step-up-test-v1',
  nayax_recommendation_evaluated_at = statement_timestamp(),
  nayax_match_execution_eligible = true
where id = '8a600000-0000-4000-8000-000000000003';

select ok(public.refund_official_actions_enabled(),
  'Normal manager official actions are enabled by the reviewed cutover');
select ok(not public.refund_manager_totp_enrollment_window_enabled(),
  'Owner-controlled TOTP enrollment window defaults closed');
select ok(
  not has_table_privilege('authenticated', 'public.refund_manager_action_step_up_intents', 'select')
  and not has_table_privilege('service_role', 'public.refund_manager_action_step_up_intents', 'insert')
  and not has_table_privilege('authenticated', 'public.refund_manager_totp_enrollments', 'select')
  and not has_table_privilege('service_role', 'public.refund_manager_totp_enrollments', 'insert')
  and not has_table_privilege('authenticated', 'public.refund_manager_step_up_audit', 'select')
  and not has_table_privilege('service_role', 'public.refund_manager_security_config', 'update'),
  'Intent, audit, and security config tables are private from browsers and services');
select ok(
  has_function_privilege('authenticated',
    'public.admin_prepare_refund_action_step_up_intent(uuid,text,text,bigint,text,text,text,text,text,integer,text,timestamp with time zone,boolean,uuid,text)', 'execute')
  and has_function_privilege('authenticated',
    'public.admin_consume_refund_action_step_up_intent(uuid,uuid,text,text,bigint,text,text,text,text,text,integer,text,timestamp with time zone,boolean,uuid,text,text)', 'execute')
  and not has_function_privilege('authenticated',
    'public.service_mark_refund_manager_step_up_factor_verified(uuid,uuid,text)', 'execute')
  and has_function_privilege('service_role',
    'public.service_mark_refund_manager_step_up_factor_verified(uuid,uuid,text)', 'execute')
  and not has_function_privilege('authenticated',
    'public.service_record_refund_manager_totp_enrollment(uuid,text)', 'execute')
  and has_function_privilege('service_role',
    'public.service_record_refund_manager_totp_enrollment(uuid,text)', 'execute')
  and not has_function_privilege('service_role',
    'public.admin_consume_refund_action_step_up_intent(uuid,uuid,text,text,bigint,text,text,text,text,text,integer,text,timestamp with time zone,boolean,uuid,text,text)', 'execute'),
  'Only authenticated humans consume intents, while only the trusted service can mint factor proofs');

set local role authenticated;
select pg_temp.set_auth_claims('8a000000-0000-4000-8000-000000000001', 'aal2',
  jsonb_build_array(jsonb_build_object('method', 'totp', 'timestamp', extract(epoch from statement_timestamp()))));
select is(
  (public.admin_authorize_refund_official_action(
      '8a600000-0000-4000-8000-000000000001', 'approve', 1,
      'cash_zelle_pending', 'approved', null, null, null, 700, null, null, false, null, null
    ) ->> 'authorizationMethod'),
  'manager_session',
  'A mapped signed-in manager receives a direct session-bound receipt');
reset role;

delete from public.refund_case_official_action_authorizations
where actor_user_id = '8a000000-0000-4000-8000-000000000001'
  and refund_case_id = '8a600000-0000-4000-8000-000000000001';

create or replace function public.refund_official_actions_enabled()
returns boolean language sql immutable set search_path = public as $$ select true; $$;

set local role authenticated;
select pg_temp.set_auth_claims('8a000000-0000-4000-8000-000000000001', 'aal1',
  jsonb_build_array(jsonb_build_object('method', 'password', 'timestamp', extract(epoch from statement_timestamp()))));
select ok(pg_temp.capture_error($sql$
  select public.admin_prepare_refund_action_step_up_intent(
    '8a600000-0000-4000-8000-000000000001', 'approve', 'refund-case-admin-update',
    (select official_action_version from public.refund_cases where id = '8a600000-0000-4000-8000-000000000001'),
    'cash_zelle_pending', 'approved', null, null, null, 700, null, null, false, null, null)
$sql$) like '%Owner-approved refund authenticator enrollment is required%',
  'A generic pre-existing Auth TOTP cannot prepare an action without durable owner approval');
reset role;

insert into public.refund_manager_totp_enrollments (
  actor_user_id,
  approved_factor_binding_hash,
  owner_approved_by_user_id,
  owner_approval_version,
  enrollment_version
) values
  (
    '8a000000-0000-4000-8000-000000000001',
    repeat('a', 64),
    '8a000000-0000-4000-8000-000000000002',
    1,
    1
  ),
  (
    '8a000000-0000-4000-8000-000000000002',
    repeat('d', 64),
    '8a000000-0000-4000-8000-000000000002',
    2,
    1
  );

set local role authenticated;
select pg_temp.set_auth_claims('8a000000-0000-4000-8000-000000000001', 'aal1',
  jsonb_build_array(jsonb_build_object('method', 'password', 'timestamp', extract(epoch from statement_timestamp()))));
select lives_ok($sql$
  insert into pg_temp.step_up_test_intents (intent_key, intent_id)
  select 'first', (public.admin_prepare_refund_action_step_up_intent(
    '8a600000-0000-4000-8000-000000000001', 'approve', 'refund-case-admin-update',
    (select official_action_version from public.refund_cases where id = '8a600000-0000-4000-8000-000000000001'),
    'cash_zelle_pending', 'approved', null, null, null, 700, null, null, false, null, null
  ) ->> 'intentId')::uuid
$sql$, 'AAL1 manager may freeze an exact action before entering TOTP');
reset role;

select ok((
  select actor_user_id = '8a000000-0000-4000-8000-000000000001'
    and refund_case_id = '8a600000-0000-4000-8000-000000000001'
    and action = 'approve'
    and target_function = 'refund-case-admin-update'
    and manager_mapping_version > 0
    and manager_totp_enrollment_version = 1
    and expected_case_version > 0
    and action_context_hash ~ '^[a-f0-9]{64}$'
    and expires_at <= not_before + interval '2 minutes 5 seconds'
  from public.refund_manager_action_step_up_intents
  where id = (select intent_id from pg_temp.step_up_test_intents where intent_key = 'first')
), 'Intent binds actor, case, action, target, mapping, version, context, and two-minute expiry');

set local role authenticated;
select pg_temp.set_auth_claims('8a000000-0000-4000-8000-000000000001', 'aal2',
  jsonb_build_array(jsonb_build_object('method', 'totp', 'timestamp', extract(epoch from statement_timestamp()))));
select ok(
  public.admin_refund_manager_step_up_factor_is_approved(
    (select intent_id from pg_temp.step_up_test_intents where intent_key = 'first'),
    repeat('a', 64)
  )
  and not public.admin_refund_manager_step_up_factor_is_approved(
    (select intent_id from pg_temp.step_up_test_intents where intent_key = 'first'),
    repeat('b', 64)
  ),
  'Only the exact owner-approved factor binding is accepted for the pending intent');
reset role;

set local role authenticated;
select pg_temp.set_auth_claims('8a000000-0000-4000-8000-000000000001', 'aal1', '[]'::jsonb);
insert into pg_temp.step_up_test_intents (intent_key, intent_id)
select 'second', (public.admin_prepare_refund_action_step_up_intent(
  '8a600000-0000-4000-8000-000000000002', 'approve', 'refund-case-admin-update',
  (select official_action_version from public.refund_cases where id = '8a600000-0000-4000-8000-000000000002'),
  'cash_zelle_pending', 'approved', null, null, null, 650, null, null, false, null, null
) ->> 'intentId')::uuid;
reset role;
select is((select status from public.refund_manager_action_step_up_intents
  where id = (select intent_id from pg_temp.step_up_test_intents where intent_key = 'first')),
  'superseded', 'Creating a new intent invalidates the prior live intent');
select is((select count(*)::integer from public.refund_manager_action_step_up_intents
  where actor_user_id = '8a000000-0000-4000-8000-000000000001' and status = 'pending'),
  1, 'At most one live intent exists per actor');

set local role authenticated;
select pg_temp.set_auth_claims('8a000000-0000-4000-8000-000000000003', 'aal1', '[]'::jsonb);
select ok(
  pg_temp.capture_error(format('select public.admin_get_refund_action_step_up_intent(%L)',
    (select intent_id from pg_temp.step_up_test_intents where intent_key = 'second'))) like '%expired%'
  and (public.admin_cancel_refund_action_step_up_intent(
    (select intent_id from pg_temp.step_up_test_intents where intent_key = 'second')) ->> 'cancelled')::boolean = false,
  'Another authenticated user cannot inspect or cancel an intent');
reset role;

set local role authenticated;
select pg_temp.set_auth_claims('8a000000-0000-4000-8000-000000000001', 'aal1',
  jsonb_build_array(jsonb_build_object('method', 'totp', 'timestamp', extract(epoch from statement_timestamp() + interval '5 seconds'))));
select ok(pg_temp.capture_error(format($sql$
  select public.admin_consume_refund_action_step_up_intent(%L,
    '8a600000-0000-4000-8000-000000000002', 'approve', 'refund-case-admin-update',
    (select official_action_version from public.refund_cases where id = '8a600000-0000-4000-8000-000000000002'),
    'cash_zelle_pending', 'approved', null, null, null, 650, null, null, false, null, null)
$sql$, (select intent_id from pg_temp.step_up_test_intents where intent_key = 'second'))) like '%new authenticator code%',
  'AAL1 cannot consume even with a TOTP-shaped AMR');

select pg_temp.set_auth_claims('8a000000-0000-4000-8000-000000000001', 'aal2',
  jsonb_build_array(jsonb_build_object('method', 'password', 'timestamp', extract(epoch from statement_timestamp()))));
select ok(pg_temp.capture_error(format($sql$
  select public.admin_consume_refund_action_step_up_intent(%L,
    '8a600000-0000-4000-8000-000000000002', 'approve', 'refund-case-admin-update', 1,
    'cash_zelle_pending', 'approved', null, null, null, 650, null, null, false, null, null)
$sql$, (select intent_id from pg_temp.step_up_test_intents where intent_key = 'second'))) like '%new authenticator code%',
  'AAL2 without TOTP cannot consume');

select pg_temp.set_auth_claims('8a000000-0000-4000-8000-000000000001', 'aal2',
  jsonb_build_array(jsonb_build_object('method', 'totp', 'timestamp', extract(epoch from statement_timestamp() - interval '3 minutes'))));
select ok(pg_temp.capture_error(format($sql$
  select public.admin_consume_refund_action_step_up_intent(%L,
    '8a600000-0000-4000-8000-000000000002', 'approve', 'refund-case-admin-update', 1,
    'cash_zelle_pending', 'approved', null, null, null, 650, null, null, false, null, null)
$sql$, (select intent_id from pg_temp.step_up_test_intents where intent_key = 'second'))) like '%new authenticator code%',
  'A stale login-time TOTP cannot consume');

select pg_temp.set_auth_claims('8a000000-0000-4000-8000-000000000001', 'aal2',
  jsonb_build_array(jsonb_build_object('method', 'totp', 'timestamp',
    pg_temp.intent_totp_epoch(
      (select intent_id from pg_temp.step_up_test_intents where intent_key = 'second'), 0))));
select ok(pg_temp.capture_error(format($sql$
  select public.admin_consume_refund_action_step_up_intent(%L,
    '8a600000-0000-4000-8000-000000000002', 'approve', 'refund-case-admin-update', 1,
    'cash_zelle_pending', 'approved', null, null, null, 650, null, null, false, null, null)
$sql$, (select intent_id from pg_temp.step_up_test_intents where intent_key = 'second'))) like '%new authenticator code%',
  'Same-second TOTP evidence fails closed');

select pg_temp.set_auth_claims('8a000000-0000-4000-8000-000000000001', 'aal2',
  jsonb_build_array(
    jsonb_build_object('method', 'totp', 'timestamp', extract(epoch from statement_timestamp() - interval '3 minutes')),
    jsonb_build_object('method', 'token_refresh', 'timestamp', extract(epoch from statement_timestamp() + interval '1 second'))));
select ok(pg_temp.capture_error(format($sql$
  select public.admin_consume_refund_action_step_up_intent(%L,
    '8a600000-0000-4000-8000-000000000002', 'approve', 'refund-case-admin-update', 1,
    'cash_zelle_pending', 'approved', null, null, null, 650, null, null, false, null, null)
$sql$, (select intent_id from pg_temp.step_up_test_intents where intent_key = 'second'))) like '%new authenticator code%',
  'A refresh-only token does not refresh TOTP authority');

select pg_temp.set_auth_claims('8a000000-0000-4000-8000-000000000001', 'aal2',
  jsonb_build_array(
    jsonb_build_object('method', 'totp', 'timestamp', extract(epoch from statement_timestamp() + interval '1 second')),
    jsonb_build_object('method', 'totp', 'timestamp', extract(epoch from statement_timestamp() + interval '1 second'))));
select ok(pg_temp.capture_error(format($sql$
  select public.admin_consume_refund_action_step_up_intent(%L,
    '8a600000-0000-4000-8000-000000000002', 'approve', 'refund-case-admin-update', 1,
    'cash_zelle_pending', 'approved', null, null, null, 650, null, null, false, null, null)
$sql$, (select intent_id from pg_temp.step_up_test_intents where intent_key = 'second'))) like '%new authenticator code%',
  'Ambiguous duplicate newest TOTP entries fail closed');

select pg_temp.set_auth_claims('8a000000-0000-4000-8000-000000000001', 'aal2',
  jsonb_build_array(
    jsonb_build_object('method', 'totp', 'timestamp', 'malformed'),
    jsonb_build_object('method', 'totp', 'timestamp', extract(epoch from statement_timestamp() + interval '1 second'))));
select ok(pg_temp.capture_error(format($sql$
  select public.admin_consume_refund_action_step_up_intent(%L,
    '8a600000-0000-4000-8000-000000000002', 'approve', 'refund-case-admin-update', 1,
    'cash_zelle_pending', 'approved', null, null, null, 650, null, null, false, null, null)
$sql$, (select intent_id from pg_temp.step_up_test_intents where intent_key = 'second'))) like '%new authenticator code%',
  'Malformed TOTP AMR evidence fails closed');

select pg_temp.set_auth_claims('8a000000-0000-4000-8000-000000000001', 'aal2',
  jsonb_build_array(jsonb_build_object('method', 'totp', 'timestamp',
    pg_temp.intent_totp_epoch(
      (select intent_id from pg_temp.step_up_test_intents where intent_key = 'second'), 20))));
select ok(pg_temp.capture_error(format($sql$
  select public.admin_consume_refund_action_step_up_intent(%L,
    '8a600000-0000-4000-8000-000000000002', 'approve', 'refund-case-admin-update',
    (select official_action_version from public.refund_cases where id = '8a600000-0000-4000-8000-000000000002'),
    'cash_zelle_pending', 'approved', null, null, null, 650, null, null, false, null, null)
$sql$, (select intent_id from pg_temp.step_up_test_intents where intent_key = 'second')))
  like '%authenticator verification proof is required%',
  'A fresh generic-factor AAL2 token cannot bypass the trusted exact-factor Edge proof');
reset role;

select set_config('request.jwt.claim.role', 'service_role', true);
select set_config('request.jwt.claims', '{"role":"service_role"}', true);
insert into pg_temp.step_up_test_factor_proofs (intent_key, proof)
select
  'second',
  public.service_mark_refund_manager_step_up_factor_verified(
    '8a000000-0000-4000-8000-000000000001',
    (select intent_id from pg_temp.step_up_test_intents where intent_key = 'second'),
    repeat('a', 64)
  ) ->> 'factorVerificationProof';

set local role authenticated;
select pg_temp.set_auth_claims('8a000000-0000-4000-8000-000000000001', 'aal2',
  jsonb_build_array(jsonb_build_object('method', 'totp', 'timestamp',
    pg_temp.intent_totp_epoch(
      (select intent_id from pg_temp.step_up_test_intents where intent_key = 'second'), 20))));
select ok(pg_temp.capture_error(format($sql$
  select public.admin_consume_refund_action_step_up_intent(%L,
    '8a600000-0000-4000-8000-000000000002', 'approve', 'refund-case-admin-update',
    (select official_action_version from public.refund_cases where id = '8a600000-0000-4000-8000-000000000002'),
    'cash_zelle_pending', 'approved', null, null, null, 650, null, null, false, null, null,
    repeat('f', 64))
$sql$, (select intent_id from pg_temp.step_up_test_intents where intent_key = 'second')))
  like '%authenticator verification proof is required%',
  'A caller cannot guess or substitute the one-use internal factor proof');
insert into pg_temp.step_up_test_intents (intent_key, intent_id)
select 'authorization', (public.admin_consume_refund_action_step_up_intent(
  (select intent_id from pg_temp.step_up_test_intents where intent_key = 'second'),
  '8a600000-0000-4000-8000-000000000002', 'approve', 'refund-case-admin-update',
  (select official_action_version from public.refund_cases where id = '8a600000-0000-4000-8000-000000000002'),
  'cash_zelle_pending', 'approved', null, null, null, 650, null, null, false, null, null,
  (select proof from pg_temp.step_up_test_factor_proofs where intent_key = 'second')
) ->> 'authorizationId')::uuid;
reset role;
select is((select status from public.refund_manager_action_step_up_intents
  where id = (select intent_id from pg_temp.step_up_test_intents where intent_key = 'second')),
  'consumed', 'A strictly newer unambiguous TOTP consumes the intent');
select ok((select step_up_intent_id = (select intent_id from pg_temp.step_up_test_intents where intent_key = 'second')
  and verified_totp_at is not null and expires_at <= created_at + interval '30 seconds'
  from public.refund_case_official_action_authorizations
  where id = (select intent_id from pg_temp.step_up_test_intents where intent_key = 'authorization')),
  'Minted official receipt is bound to the consumed intent and verified TOTP timestamp');

set local role authenticated;
select pg_temp.set_auth_claims('8a000000-0000-4000-8000-000000000001', 'aal2',
  jsonb_build_array(jsonb_build_object('method', 'totp', 'timestamp', extract(epoch from statement_timestamp() + interval '1 second'))));
select ok(pg_temp.capture_error(format($sql$
  select public.admin_consume_refund_action_step_up_intent(%L,
    '8a600000-0000-4000-8000-000000000002', 'approve', 'refund-case-admin-update', 1,
    'cash_zelle_pending', 'approved', null, null, null, 650, null, null, false, null, null)
$sql$, (select intent_id from pg_temp.step_up_test_intents where intent_key = 'second'))) like '%already used%',
  'Consumed intent cannot be replayed');

insert into pg_temp.step_up_test_intents (intent_key, intent_id)
select 'reuse-proof', (public.admin_prepare_refund_action_step_up_intent(
  '8a600000-0000-4000-8000-000000000001', 'approve', 'refund-case-admin-update',
  (select official_action_version from public.refund_cases where id = '8a600000-0000-4000-8000-000000000001'),
  'cash_zelle_pending', 'approved', null, null, null, 700, null, null, false, null, null
) ->> 'intentId')::uuid;
select pg_temp.set_auth_claims('8a000000-0000-4000-8000-000000000001', 'aal2',
  jsonb_build_array(jsonb_build_object('method', 'totp', 'timestamp',
    pg_temp.authorization_totp_epoch(
      (select intent_id from pg_temp.step_up_test_intents where intent_key = 'authorization')))));
select ok(pg_temp.capture_error(format($sql$
  select public.admin_consume_refund_action_step_up_intent(%L,
    '8a600000-0000-4000-8000-000000000001', 'approve', 'refund-case-admin-update', 1,
    'cash_zelle_pending', 'approved', null, null, null, 700, null, null, false, null, null)
$sql$, (select intent_id from pg_temp.step_up_test_intents where intent_key = 'reuse-proof'))) like '%already authorized%',
  'One TOTP verification cannot consume a second intent even with positive clock skew');
select pg_temp.set_auth_claims('8a000000-0000-4000-8000-000000000001', 'aal2',
  jsonb_build_array(jsonb_build_object('method', 'totp', 'timestamp',
    pg_temp.intent_totp_epoch(
      (select intent_id from pg_temp.step_up_test_intents where intent_key = 'reuse-proof'), 0))));
select ok(pg_temp.capture_error(format($sql$
  select public.admin_consume_refund_action_step_up_intent(%L,
    '8a600000-0000-4000-8000-000000000001', 'approve', 'refund-case-admin-update', 1,
    'cash_zelle_pending', 'approved', null, null, null, 700, null, null, false, null, null)
$sql$, (select intent_id from pg_temp.step_up_test_intents where intent_key = 'reuse-proof'))) like '%new authenticator code%',
  'One prior TOTP verification cannot authorize a newly created intent');

select pg_temp.set_auth_claims('8a000000-0000-4000-8000-000000000001', 'aal2',
  jsonb_build_array(jsonb_build_object('method', 'totp', 'timestamp', extract(epoch from statement_timestamp() + interval '2 seconds'))));
select ok(pg_temp.capture_error(format($sql$
  select public.admin_consume_refund_action_step_up_intent(%L,
    '8a600000-0000-4000-8000-000000000001', 'approve', 'refund-case-admin-update', 1,
    'cash_zelle_pending', 'approved', null, null, null, 701, null, null, false, null, null)
$sql$, (select intent_id from pg_temp.step_up_test_intents where intent_key = 'reuse-proof'))) like '%changed%',
  'Changing the exact amount invalidates the intent');
select ok(pg_temp.capture_error(format($sql$
  select public.admin_consume_refund_action_step_up_intent(%L,
    '8a600000-0000-4000-8000-000000000001', 'approve', 'nayax-card-refund', 1,
    'cash_zelle_pending', 'approved', null, null, null, 700, null, null, false, null, null)
$sql$, (select intent_id from pg_temp.step_up_test_intents where intent_key = 'reuse-proof'))) like '%changed%',
  'Changing the target function invalidates the intent');

reset role;
update public.refund_cases set customer_email = 'step-up-changed@example.test'
where id = '8a600000-0000-4000-8000-000000000001';
set local role authenticated;
select pg_temp.set_auth_claims('8a000000-0000-4000-8000-000000000001', 'aal2',
  jsonb_build_array(jsonb_build_object('method', 'totp', 'timestamp', extract(epoch from statement_timestamp() + interval '2 seconds'))));
select ok(pg_temp.capture_error(format($sql$
  select public.admin_consume_refund_action_step_up_intent(%L,
    '8a600000-0000-4000-8000-000000000001', 'approve', 'refund-case-admin-update', 1,
    'cash_zelle_pending', 'approved', null, null, null, 700, null, null, false, null, null)
$sql$, (select intent_id from pg_temp.step_up_test_intents where intent_key = 'reuse-proof'))) like '%changed since review%',
  'Case version drift invalidates the intent');

insert into pg_temp.step_up_test_intents (intent_key, intent_id)
select 'enrollment-drift', (public.admin_prepare_refund_action_step_up_intent(
  '8a600000-0000-4000-8000-000000000002', 'approve', 'refund-case-admin-update',
  (select official_action_version from public.refund_cases where id = '8a600000-0000-4000-8000-000000000002'),
  'cash_zelle_pending', 'approved', null, null, null, 650, null, null, false, null, null
) ->> 'intentId')::uuid;
reset role;
update public.refund_manager_totp_enrollments
set enrollment_version = enrollment_version + 1,
    updated_at = statement_timestamp()
where actor_user_id = '8a000000-0000-4000-8000-000000000001';
set local role authenticated;
select pg_temp.set_auth_claims('8a000000-0000-4000-8000-000000000001', 'aal2',
  jsonb_build_array(jsonb_build_object('method', 'totp', 'timestamp', extract(epoch from statement_timestamp() + interval '2 seconds'))));
select ok(pg_temp.capture_error(format($sql$
  select public.admin_consume_refund_action_step_up_intent(%L,
    '8a600000-0000-4000-8000-000000000002', 'approve', 'refund-case-admin-update',
    (select official_action_version from public.refund_cases where id = '8a600000-0000-4000-8000-000000000002'),
    'cash_zelle_pending', 'approved', null, null, null, 650, null, null, false, null, null)
$sql$, (select intent_id from pg_temp.step_up_test_intents where intent_key = 'enrollment-drift'))) like '%enrollment changed%',
  'Enrollment revocation or replacement invalidates an already prepared intent at consumption');

insert into pg_temp.step_up_test_intents (intent_key, intent_id)
select 'mapping-drift', (public.admin_prepare_refund_action_step_up_intent(
  '8a600000-0000-4000-8000-000000000002', 'approve', 'refund-case-admin-update',
  (select official_action_version from public.refund_cases where id = '8a600000-0000-4000-8000-000000000002'),
  'cash_zelle_pending', 'approved', null, null, null, 650, null, null, false, null, null
) ->> 'intentId')::uuid;
reset role;
update public.reporting_machine_refund_managers set grant_reason = 'Mapping changed after review'
where id = '8a400000-0000-4000-8000-000000000001';
set local role authenticated;
select pg_temp.set_auth_claims('8a000000-0000-4000-8000-000000000001', 'aal2',
  jsonb_build_array(jsonb_build_object('method', 'totp', 'timestamp', extract(epoch from statement_timestamp() + interval '2 seconds'))));
select ok(pg_temp.capture_error(format($sql$
  select public.admin_consume_refund_action_step_up_intent(%L,
    '8a600000-0000-4000-8000-000000000002', 'approve', 'refund-case-admin-update',
    (select official_action_version from public.refund_cases where id = '8a600000-0000-4000-8000-000000000002'),
    'cash_zelle_pending', 'approved', null, null, null, 650, null, null, false, null, null)
$sql$, (select intent_id from pg_temp.step_up_test_intents where intent_key = 'mapping-drift'))) like '%changed%',
  'Manager mapping revision drift invalidates the intent');

insert into pg_temp.step_up_test_intents (intent_key, intent_id)
select 'nayax', (public.admin_prepare_refund_action_step_up_intent(
  '8a600000-0000-4000-8000-000000000003', 'nayax_execute', 'nayax-card-refund',
  (select official_action_version from public.refund_cases where id = '8a600000-0000-4000-8000-000000000003'),
  'card_refund_pending', 'approved', null, null, null, 600, null, null, false, null, null
) ->> 'intentId')::uuid;
reset role;
select ok((
  select nayax_execution_evidence_hash ~ '^[a-f0-9]{64}$'
    and candidate_evidence_hash is null
  from public.refund_manager_action_step_up_intents
  where id = (select intent_id from pg_temp.step_up_test_intents where intent_key = 'nayax')
), 'Nayax execution intent persists a locked canonical match and provider-config fingerprint');

select set_config('request.jwt.claim.role', 'service_role', true);
select set_config('request.jwt.claims', '{"role":"service_role"}', true);
insert into pg_temp.step_up_test_factor_proofs (intent_key, proof)
select
  'nayax',
  public.service_mark_refund_manager_step_up_factor_verified(
    '8a000000-0000-4000-8000-000000000001',
    (select intent_id from pg_temp.step_up_test_intents where intent_key = 'nayax'),
    repeat('a', 64)
  ) ->> 'factorVerificationProof';

update public.reporting_machines
set nayax_account_key = 'STEP-UP-ACCOUNT-CHANGED'
where id = '8a300000-0000-4000-8000-000000000001';
set local role authenticated;
select pg_temp.set_auth_claims('8a000000-0000-4000-8000-000000000001', 'aal2',
  jsonb_build_array(jsonb_build_object('method', 'totp', 'timestamp', extract(epoch from statement_timestamp() + interval '2 seconds'))));
select ok(pg_temp.capture_error(format($sql$
  select public.admin_consume_refund_action_step_up_intent(%L,
    '8a600000-0000-4000-8000-000000000003', 'nayax_execute', 'nayax-card-refund',
    (select official_action_version from public.refund_cases where id = '8a600000-0000-4000-8000-000000000003'),
    'card_refund_pending', 'approved', null, null, null, 600, null, null, false, null, null)
$sql$, (select intent_id from pg_temp.step_up_test_intents where intent_key = 'nayax'))) like '%changed%',
  'Valid-to-valid Nayax account configuration drift invalidates the human step-up intent');
reset role;

update public.reporting_machines
set nayax_account_key = 'STEP-UP-ACCOUNT'
where id = '8a300000-0000-4000-8000-000000000001';
set local role authenticated;
select pg_temp.set_auth_claims('8a000000-0000-4000-8000-000000000001', 'aal2',
  jsonb_build_array(jsonb_build_object('method', 'totp', 'timestamp',
    pg_temp.intent_totp_epoch(
      (select intent_id from pg_temp.step_up_test_intents where intent_key = 'nayax'), 25))));
insert into pg_temp.step_up_test_intents (intent_key, intent_id)
select 'nayax-authorization', (public.admin_consume_refund_action_step_up_intent(
  (select intent_id from pg_temp.step_up_test_intents where intent_key = 'nayax'),
  '8a600000-0000-4000-8000-000000000003', 'nayax_execute', 'nayax-card-refund',
  (select official_action_version from public.refund_cases where id = '8a600000-0000-4000-8000-000000000003'),
  'card_refund_pending', 'approved', null, null, null, 600, null, null, false, null, null,
  (select proof from pg_temp.step_up_test_factor_proofs where intent_key = 'nayax')
) ->> 'authorizationId')::uuid;
reset role;
select ok((
  select action_authorization.nayax_execution_evidence_hash = intent.nayax_execution_evidence_hash
  from public.refund_case_official_action_authorizations action_authorization
  join public.refund_manager_action_step_up_intents intent
    on intent.id = action_authorization.step_up_intent_id
  where action_authorization.id = (
    select intent_id from pg_temp.step_up_test_intents where intent_key = 'nayax-authorization'
  )
), 'Nayax authorization carries the exact human-reviewed execution fingerprint');

update public.reporting_machines
set nayax_machine_id = 'STEP-UP-MACHINE-CHANGED'
where id = '8a300000-0000-4000-8000-000000000001';
select ok(
  pg_temp.capture_error(format($sql$
    select public.service_consume_nayax_refund_official_action(
      %L,
      '8a600000-0000-4000-8000-000000000003',
      'card_refund_pending', 'approved', 600, null)
  $sql$, (select intent_id from pg_temp.step_up_test_intents where intent_key = 'nayax-authorization')))
    like '%execution evidence changed%'
  and (select status from public.refund_case_official_action_authorizations where id =
    (select intent_id from pg_temp.step_up_test_intents where intent_key = 'nayax-authorization')) = 'authorized',
  'Service consumption revalidates locked Nayax evidence and rolls receipt use back on drift');
update public.reporting_machines
set nayax_machine_id = 'STEP-UP-MACHINE'
where id = '8a300000-0000-4000-8000-000000000001';

set local role authenticated;
select pg_temp.set_auth_claims('8a000000-0000-4000-8000-000000000001', 'aal2',
  jsonb_build_array(jsonb_build_object('method', 'totp', 'timestamp', extract(epoch from statement_timestamp() + interval '2 seconds'))));

insert into pg_temp.step_up_test_intents (intent_key, intent_id)
select 'cancel', (public.admin_prepare_refund_action_step_up_intent(
  '8a600000-0000-4000-8000-000000000002', 'approve', 'refund-case-admin-update',
  (select official_action_version from public.refund_cases where id = '8a600000-0000-4000-8000-000000000002'),
  'cash_zelle_pending', 'approved', null, null, null, 650, null, null, false, null, null
) ->> 'intentId')::uuid;
select ok((public.admin_cancel_refund_action_step_up_intent(
  (select intent_id from pg_temp.step_up_test_intents where intent_key = 'cancel')) ->> 'cancelled')::boolean,
  'Manager cancellation invalidates the live intent');
reset role;
select is((select status from public.refund_manager_action_step_up_intents where id =
  (select intent_id from pg_temp.step_up_test_intents where intent_key = 'cancel')),
  'cancelled', 'Cancelled intent cannot remain live');

set local role authenticated;
select pg_temp.set_auth_claims('8a000000-0000-4000-8000-000000000001', 'aal2',
  jsonb_build_array(jsonb_build_object('method', 'totp', 'timestamp', extract(epoch from statement_timestamp() + interval '2 seconds'))));
insert into pg_temp.step_up_test_intents (intent_key, intent_id)
select 'expired', (public.admin_prepare_refund_action_step_up_intent(
  '8a600000-0000-4000-8000-000000000002', 'approve', 'refund-case-admin-update',
  (select official_action_version from public.refund_cases where id = '8a600000-0000-4000-8000-000000000002'),
  'cash_zelle_pending', 'approved', null, null, null, 650, null, null, false, null, null
) ->> 'intentId')::uuid;
reset role;
update public.refund_manager_action_step_up_intents
set not_before = statement_timestamp() - interval '3 minutes',
    expires_at = statement_timestamp() - interval '1 minute'
where id = (select intent_id from pg_temp.step_up_test_intents where intent_key = 'expired');
set local role authenticated;
select pg_temp.set_auth_claims('8a000000-0000-4000-8000-000000000001', 'aal2',
  jsonb_build_array(jsonb_build_object('method', 'totp', 'timestamp', extract(epoch from statement_timestamp()))));
select ok(pg_temp.capture_error(format($sql$
  select public.admin_consume_refund_action_step_up_intent(%L,
    '8a600000-0000-4000-8000-000000000002', 'approve', 'refund-case-admin-update',
    (select official_action_version from public.refund_cases where id = '8a600000-0000-4000-8000-000000000002'),
    'cash_zelle_pending', 'approved', null, null, null, 650, null, null, false, null, null)
$sql$, (select intent_id from pg_temp.step_up_test_intents where intent_key = 'expired'))) like '%expired%',
  'Expired intent cannot be consumed');

select pg_temp.set_auth_claims('8a000000-0000-4000-8000-000000000003', 'aal1', '[]'::jsonb);
select ok(pg_temp.capture_error($sql$
  select public.admin_prepare_refund_action_step_up_intent(
    '8a600000-0000-4000-8000-000000000002', 'approve', 'refund-case-admin-update', 1,
    'cash_zelle_pending', 'approved', null, null, null, 650, null, null, false, null, null)
$sql$) like '%Active Machine Manager mapping required%',
  'Admin access alone cannot prepare an intent without a current Machine Manager mapping');
select pg_temp.set_auth_claims('8a000000-0000-4000-8000-000000000002', 'aal1', '[]'::jsonb);
select lives_ok($sql$
  select public.admin_prepare_refund_action_step_up_intent(
    '8a600000-0000-4000-8000-000000000002', 'approve', 'refund-case-admin-update', 1,
    'cash_zelle_pending', 'approved', null, null, null, 650, null, null, false, null, null)
$sql$,
  'A mapped Super Admin can prepare the same owner-approved action-bound intent');
reset role;

select ok(not has_function_privilege('service_role',
  'public.admin_prepare_refund_action_step_up_intent(uuid,text,text,bigint,text,text,text,text,text,integer,text,timestamp with time zone,boolean,uuid,text)',
  'execute'), 'Service identity cannot prepare an intent');

select ok(not exists (
  select 1 from information_schema.columns
  where table_schema = 'public' and table_name = 'refund_manager_step_up_audit'
    and column_name ~ '(code|factor|secret|qr|jwt|email|amount|payload_json)'
), 'Sanitized audit schema cannot store codes, factors, secrets, QR, JWTs, addresses, amounts, or payloads');

select ok(pg_temp.capture_error($sql$
  insert into public.refund_case_official_action_authorizations (
    refund_case_id, action, actor_user_id, manager_mapping_id,
    manager_mapping_version, expected_case_version, action_context_hash, expires_at
  ) values (
    '8a600000-0000-4000-8000-000000000002', 'approve',
    '8a000000-0000-4000-8000-000000000001',
    '8a400000-0000-4000-8000-000000000001', 1, 1, repeat('a', 64),
    statement_timestamp() + interval '30 seconds'
  )
$sql$) like '%requires a consumed human step-up intent%',
  'Even a direct database insert cannot mint an unbound receipt');

select ok(not has_table_privilege('service_role', 'public.refund_manager_security_config', 'update')
  and not has_function_privilege('service_role',
    'public.can_enroll_refund_manager_totp_current_user()', 'execute'),
  'No service identity can open the owner-controlled enrollment window');

set local role authenticated;
select pg_temp.set_auth_claims('8a000000-0000-4000-8000-000000000001', 'aal1', '[]'::jsonb);
select ok(not public.can_enroll_refund_manager_totp_current_user(),
  'Manager enrollment remains closed until an owner-controlled database and Auth window is opened');
reset role;

update public.refund_manager_security_config
set
  totp_enrollment_enabled = true,
  totp_enrollment_approved_manager_user_id = '8a000000-0000-4000-8000-000000000001',
  totp_enrollment_approved_by_owner_user_id = '8a000000-0000-4000-8000-000000000001',
  totp_enrollment_approval_expires_at = statement_timestamp() + interval '5 minutes',
  totp_enrollment_approval_version = 1,
  totp_enrollment_owner_user_id_digest = encode(
    extensions.digest(
      convert_to('8a000000-0000-4000-8000-000000000001', 'UTF8'),
      'sha256'
    ),
    'hex'
  ),
  updated_at = statement_timestamp()
where singleton = true;
set local role authenticated;
select pg_temp.set_auth_claims('8a000000-0000-4000-8000-000000000001', 'aal1', '[]'::jsonb);
select ok(public.can_enroll_refund_manager_totp_current_user(),
  'Owner-targeted enrollment window admits only its approved Machine Manager');
select pg_temp.set_auth_claims('8a000000-0000-4000-8000-000000000003', 'aal1', '[]'::jsonb);
select ok(not public.can_enroll_refund_manager_totp_current_user(),
  'An authenticated user outside the owner-targeted enrollment grant remains blocked');
reset role;

select set_config('request.jwt.claim.role', 'service_role', true);
select set_config('request.jwt.claims', '{"role":"service_role"}', true);
insert into pg_temp.step_up_test_results (result_key, result)
select 'record-enrollment', public.service_record_refund_manager_totp_enrollment(
  '8a000000-0000-4000-8000-000000000001', repeat('b', 64)
);
select ok(
  (select (result ->> 'recorded')::boolean from pg_temp.step_up_test_results
    where result_key = 'record-enrollment')
  and exists (
    select 1
    from public.refund_manager_totp_enrollments enrollment
    where enrollment.actor_user_id = '8a000000-0000-4000-8000-000000000001'
      and enrollment.status = 'active'
      and enrollment.approved_factor_binding_hash = repeat('b', 64)
      and enrollment.owner_approved_by_user_id = '8a000000-0000-4000-8000-000000000001'
      and enrollment.enrollment_version = 3
  )
  and not public.refund_manager_totp_enrollment_window_enabled()
  and exists (
    select 1 from public.refund_manager_step_up_audit
    where actor_user_id = '8a000000-0000-4000-8000-000000000001'
      and event_type = 'totp_enrollment_verified'
  ),
  'Trusted enrollment atomically records durable owner approval and closes the one-use window');

insert into pg_temp.step_up_test_results (result_key, result)
select 'compensate-enrollment', public.service_compensate_refund_manager_totp_enrollment(
  '8a000000-0000-4000-8000-000000000001', repeat('b', 64)
);
select ok(
  (select (result ->> 'compensated')::boolean from pg_temp.step_up_test_results
    where result_key = 'compensate-enrollment')
  and exists (
    select 1
    from public.refund_manager_totp_enrollments enrollment
    where enrollment.actor_user_id = '8a000000-0000-4000-8000-000000000001'
      and enrollment.status = 'revoked'
      and enrollment.revoked_at is not null
      and enrollment.enrollment_version = 4
  )
  and not exists (
    select 1 from public.refund_manager_action_step_up_intents
    where actor_user_id = '8a000000-0000-4000-8000-000000000001'
      and status = 'pending'
  )
  and exists (
    select 1 from public.refund_manager_step_up_audit
    where actor_user_id = '8a000000-0000-4000-8000-000000000001'
      and event_type = 'totp_enrollment_compensated'
  ),
  'Enrollment compensation revokes durable approval and cancels every pending intent');

select * from finish();
rollback;
