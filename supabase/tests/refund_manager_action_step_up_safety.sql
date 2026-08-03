begin;

create extension if not exists pgtap with schema extensions;
set local search_path = public, extensions;

select plan(36);

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
values (
  '8a410000-0000-4000-8000-000000000001',
  '8a000000-0000-4000-8000-000000000002',
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
   '8a500000-0000-4000-8000-000000000001', 650, false);

select ok(not public.refund_official_actions_enabled(),
  'Production official-action gate remains hard false');
select ok(not public.refund_manager_totp_enrollment_window_enabled(),
  'Owner-controlled TOTP enrollment window defaults closed');
select ok(
  not has_table_privilege('authenticated', 'public.refund_manager_action_step_up_intents', 'select')
  and not has_table_privilege('service_role', 'public.refund_manager_action_step_up_intents', 'insert')
  and not has_table_privilege('authenticated', 'public.refund_manager_step_up_audit', 'select')
  and not has_table_privilege('service_role', 'public.refund_manager_security_config', 'update'),
  'Intent, audit, and security config tables are private from browsers and services');
select ok(
  has_function_privilege('authenticated',
    'public.admin_prepare_refund_action_step_up_intent(uuid,text,text,bigint,text,text,text,text,text,integer,text,timestamp with time zone,boolean,uuid,text)', 'execute')
  and has_function_privilege('authenticated',
    'public.admin_consume_refund_action_step_up_intent(uuid,uuid,text,text,bigint,text,text,text,text,text,integer,text,timestamp with time zone,boolean,uuid,text)', 'execute')
  and not has_function_privilege('service_role',
    'public.admin_consume_refund_action_step_up_intent(uuid,uuid,text,text,bigint,text,text,text,text,text,integer,text,timestamp with time zone,boolean,uuid,text)', 'execute'),
  'Only authenticated humans receive prepare and consume RPC grants');

set local role authenticated;
select pg_temp.set_auth_claims('8a000000-0000-4000-8000-000000000001', 'aal2',
  jsonb_build_array(jsonb_build_object('method', 'totp', 'timestamp', extract(epoch from statement_timestamp()))));
select ok(
  pg_temp.capture_error($sql$
    select public.admin_authorize_refund_official_action(
      '8a600000-0000-4000-8000-000000000001', 'approve', 1,
      'cash_zelle_pending', 'approved', null, null, null, 700, null, null, false, null, null)
  $sql$) like '%Action-bound manager step-up intent required%',
  'Legacy recent-AAL2 receipt minting is permanently blocked');
reset role;

create or replace function public.refund_official_actions_enabled()
returns boolean language sql immutable set search_path = public as $$ select true; $$;

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
    and expected_case_version > 0
    and action_context_hash ~ '^[a-f0-9]{64}$'
    and expires_at <= not_before + interval '2 minutes 5 seconds'
  from public.refund_manager_action_step_up_intents
  where id = (select intent_id from pg_temp.step_up_test_intents where intent_key = 'first')
), 'Intent binds actor, case, action, target, mapping, version, context, and two-minute expiry');

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
insert into pg_temp.step_up_test_intents (intent_key, intent_id)
select 'authorization', (public.admin_consume_refund_action_step_up_intent(
  (select intent_id from pg_temp.step_up_test_intents where intent_key = 'second'),
  '8a600000-0000-4000-8000-000000000002', 'approve', 'refund-case-admin-update',
  (select official_action_version from public.refund_cases where id = '8a600000-0000-4000-8000-000000000002'),
  'cash_zelle_pending', 'approved', null, null, null, 650, null, null, false, null, null
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
  'Unrelated authenticated user cannot prepare an intent');
select pg_temp.set_auth_claims('8a000000-0000-4000-8000-000000000002', 'aal1', '[]'::jsonb);
select ok(pg_temp.capture_error($sql$
  select public.admin_prepare_refund_action_step_up_intent(
    '8a600000-0000-4000-8000-000000000002', 'approve', 'refund-case-admin-update', 1,
    'cash_zelle_pending', 'approved', null, null, null, 650, null, null, false, null, null)
$sql$) like '%admin identities are review-only%',
  'Mapped Super Admin cannot prepare an official intent');
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

select * from finish();
rollback;
