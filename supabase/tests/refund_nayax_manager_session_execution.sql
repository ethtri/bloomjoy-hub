begin;

create extension if not exists pgtap with schema extensions;
set local search_path = public, extensions;

select plan(20);

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

create temporary table manager_session_results (
  result_key text primary key,
  result jsonb not null
);

insert into auth.users (
  instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at
) values
(
  '00000000-0000-0000-0000-000000000000',
  'b1000000-0000-4000-8000-000000000001',
  'authenticated', 'authenticated', 'manager-session@example.test', '', now(),
  '{}'::jsonb, '{}'::jsonb, now(), now()
),
(
  '00000000-0000-0000-0000-000000000000',
  'b1000000-0000-4000-8000-000000000002',
  'authenticated', 'authenticated', 'unmapped-manager@example.test', '', now(),
  '{}'::jsonb, '{}'::jsonb, now(), now()
);

insert into public.customer_accounts (id, name, account_type)
values ('b1100000-0000-4000-8000-000000000001', 'Manager session refund test', 'customer');

insert into public.reporting_locations (id, account_id, name, timezone)
values (
  'b1200000-0000-4000-8000-000000000001',
  'b1100000-0000-4000-8000-000000000001',
  'Manager session location', 'America/Los_Angeles'
);

insert into public.reporting_machines (
  id, account_id, location_id, machine_label, nayax_machine_id,
  nayax_account_key, nayax_refunds_enabled, nayax_refund_max_amount_cents
) values (
  'b1300000-0000-4000-8000-000000000001',
  'b1100000-0000-4000-8000-000000000001',
  'b1200000-0000-4000-8000-000000000001',
  'Manager session machine', 'MANAGER-SESSION-MACHINE',
  'MANAGER_SESSION_ACCOUNT', true, 2500
);

insert into public.reporting_machine_refund_managers (
  id, reporting_machine_id, manager_user_id, manager_email, grant_reason
) values (
  'b1400000-0000-4000-8000-000000000001',
  'b1300000-0000-4000-8000-000000000001',
  'b1000000-0000-4000-8000-000000000001',
  'manager-session@example.test', 'Normal manager refund test'
);

insert into public.refund_cases (
  id, public_reference, reporting_machine_id, reporting_location_id,
  customer_email, issue_summary, incident_at, payment_method,
  payment_amount_cents, refund_amount_cents, status, decision,
  card_last4, card_wallet_used, correlation_status, correlation_source,
  correlation_confidence, matched_nayax_transaction_id, matched_nayax_site_id,
  matched_nayax_machine_auth_time, matched_nayax_amount_cents,
  matched_nayax_card_last4, matched_nayax_currency_code,
  nayax_recommendation_state, nayax_recommendation_policy_version,
  nayax_recommendation_evaluated_at, nayax_match_execution_eligible
) values
(
  'b1600000-0000-4000-8000-000000000001', 'RF-MANAGER-SESSION-READY',
  'b1300000-0000-4000-8000-000000000001',
  'b1200000-0000-4000-8000-000000000001',
  'customer-ready@example.test', 'Ready exact card transaction',
  statement_timestamp() - interval '1 day', 'card', 700, 700,
  'needs_review', null, '4242', false, 'matched', 'nayax', 1,
  'MANAGER-SESSION-TX-001', 901, statement_timestamp() - interval '1 day',
  700, '4242', 'USD', 'high_confidence', 'manager-session-test-v1',
  statement_timestamp(), true
),
(
  'b1600000-0000-4000-8000-000000000002', 'RF-MANAGER-SESSION-NOT-READY',
  'b1300000-0000-4000-8000-000000000001',
  'b1200000-0000-4000-8000-000000000001',
  'customer-not-ready@example.test', 'Unmatched card transaction',
  statement_timestamp() - interval '2 days', 'card', 700, 700,
  'needs_review', null, '4242', false, 'no_match', 'nayax', 0,
  null, null, null, null, null, null, 'no_safe_match',
  'manager-session-test-v1', statement_timestamp(), false
),
(
  'b1600000-0000-4000-8000-000000000003', 'RF-MANAGER-SESSION-WALLET',
  'b1300000-0000-4000-8000-000000000001',
  'b1200000-0000-4000-8000-000000000001',
  'customer-wallet@example.test', 'Manager selected a wallet transaction',
  statement_timestamp() - interval '3 days', 'card', 1000, 1090,
  'needs_review', null, '3303', true, 'matched', 'nayax', 0,
  'MANAGER-SESSION-TX-003', 901, statement_timestamp() - interval '3 days',
  1090, '8992', 'USD', 'manual_exception', 'manager-session-test-v1',
  statement_timestamp(), false
),
(
  'b1600000-0000-4000-8000-000000000004', 'RF-MANAGER-SESSION-DRIFT',
  'b1300000-0000-4000-8000-000000000001',
  'b1200000-0000-4000-8000-000000000001',
  'customer-drift@example.test', 'Immutable receipt drift check',
  statement_timestamp() - interval '4 days', 'card', 650, 650,
  'needs_review', null, '4242', false, 'matched', 'nayax', 1,
  'MANAGER-SESSION-TX-004', 901, statement_timestamp() - interval '4 days',
  650, '4242', 'USD', 'high_confidence', 'manager-session-test-v1',
  statement_timestamp(), true
),
(
  'b1600000-0000-4000-8000-000000000005', 'RF-MANAGER-SESSION-EXPIRED',
  'b1300000-0000-4000-8000-000000000001',
  'b1200000-0000-4000-8000-000000000001',
  'customer-expired@example.test', 'Expired immutable receipt check',
  statement_timestamp() - interval '5 days', 'card', 600, 600,
  'needs_review', null, '4242', false, 'matched', 'nayax', 1,
  'MANAGER-SESSION-TX-005', 901, statement_timestamp() - interval '5 days',
  600, '4242', 'USD', 'high_confidence', 'manager-session-test-v1',
  statement_timestamp(), true
),
(
  'b1600000-0000-4000-8000-000000000006', 'RF-MANAGER-SESSION-BINDING',
  'b1300000-0000-4000-8000-000000000001',
  'b1200000-0000-4000-8000-000000000001',
  'customer-binding@example.test', 'Exact immutable receipt binding check',
  statement_timestamp() - interval '6 days', 'card', 550, 550,
  'needs_review', null, '4242', false, 'matched', 'nayax', 1,
  'MANAGER-SESSION-TX-006', 901, statement_timestamp() - interval '6 days',
  550, '4242', 'USD', 'high_confidence', 'manager-session-test-v1',
  statement_timestamp(), true
);

insert into public.refund_case_events (
  refund_case_id, actor_user_id, event_type, message, metadata
) values
(
  'b1600000-0000-4000-8000-000000000001',
  'b1000000-0000-4000-8000-000000000001',
  'nayax_match_selected', 'Manager selected the transaction.',
  '{"selected_recommended":true,"payload_redacted":true}'::jsonb
),
(
  'b1600000-0000-4000-8000-000000000003',
  'b1000000-0000-4000-8000-000000000001',
  'nayax_match_selected', 'Manager selected the wallet transaction.',
  '{"selected_recommended":false,"disagreement_reason_code":"closer_time","payload_redacted":true}'::jsonb
),
(
  'b1600000-0000-4000-8000-000000000004',
  'b1000000-0000-4000-8000-000000000001',
  'nayax_match_selected', 'Manager selected the drift-check transaction.',
  '{"selected_recommended":true,"payload_redacted":true}'::jsonb
),
(
  'b1600000-0000-4000-8000-000000000005',
  'b1000000-0000-4000-8000-000000000001',
  'nayax_match_selected', 'Manager selected the expiry-check transaction.',
  '{"selected_recommended":true,"payload_redacted":true}'::jsonb
),
(
  'b1600000-0000-4000-8000-000000000006',
  'b1000000-0000-4000-8000-000000000001',
  'nayax_match_selected', 'Manager selected the binding-check transaction.',
  '{"selected_recommended":true,"payload_redacted":true}'::jsonb
);

insert into public.refund_nayax_provider_callers (caller_id, assertion_digest)
values (
  'nayax-card-refund',
  encode(extensions.digest(convert_to('manager-session-executor', 'UTF8'), 'sha256'), 'hex')
);

select ok(
  public.can_offer_nayax_refund_manager_action(
    'b1000000-0000-4000-8000-000000000001',
    'b1600000-0000-4000-8000-000000000003'
  )
  and not public.can_offer_nayax_refund_manager_action(
    'b1000000-0000-4000-8000-000000000002',
    'b1600000-0000-4000-8000-000000000003'
  ),
  'Only the exact mapped manager can be offered the selected-wallet Nayax action'
);

select set_config(
  'request.jwt.claim.sub',
  'b1000000-0000-4000-8000-000000000001',
  true
);

select ok(
  exists (
    select 1
    from jsonb_array_elements(
      public.admin_get_refund_operations_overview() -> 'cases'
    ) overview_case
    where overview_case ->> 'id' =
      'b1600000-0000-4000-8000-000000000003'
      and (overview_case ->> 'canPerformOfficialAction')::boolean
      and overview_case -> 'officialActionBlockReason' = 'null'::jsonb
  ),
  'The scoped overview exposes the exact selected-wallet manager-session action'
);

select ok(
  exists (
    select 1
    from jsonb_array_elements(
      public.admin_get_refund_operations_overview() -> 'cases'
    ) overview_case
    where overview_case ->> 'id' =
      'b1600000-0000-4000-8000-000000000002'
      and (overview_case ->> 'canPerformOfficialAction')::boolean
      and overview_case -> 'officialActionBlockReason' = 'null'::jsonb
  ),
  'The mapped manager can review a non-Nayax case without a TOTP presentation gate'
);

select set_config('request.jwt.claim.sub', '', true);

select ok(
  has_function_privilege(
    'service_role',
    'public.service_reserve_nayax_refund_manager_action_v3(text,uuid,uuid,bigint,text,integer,integer,integer,text,text,text,text)',
    'execute'
  ) and not has_function_privilege(
    'authenticated',
    'public.service_reserve_nayax_refund_manager_action_v3(text,uuid,uuid,bigint,text,integer,integer,integer,text,text,text,text)',
    'execute'
  ),
  'Only the trusted server boundary can reserve the normal manager action'
);

select ok(
  pg_temp.capture_error(format(
    $sql$select public.service_reserve_nayax_refund_manager_action(
      'manager-session-executor', 'b1000000-0000-4000-8000-000000000001',
      'b1600000-0000-4000-8000-000000000002', %s,
      'nayax-refund-%s', 700, 100000, 100, 'USD')$sql$,
    (select official_action_version from public.refund_cases
      where id = 'b1600000-0000-4000-8000-000000000002'),
    repeat('2', 64)
  )) like '%not ready for refund%'
  and not exists (
    select 1 from public.refund_case_nayax_refund_attempts
    where refund_case_id = 'b1600000-0000-4000-8000-000000000002'
  ),
  'A not-ready case creates zero provider attempts'
);

select ok(
  pg_temp.capture_error($sql$
    select public.service_reserve_nayax_refund_manager_action(
      'manager-session-executor','b1000000-0000-4000-8000-000000000001',
      'b1600000-0000-4000-8000-000000000004',999,
      'nayax-refund-6666666666666666666666666666666666666666666666666666666666666666',
      650,100000,100,'USD')
  $sql$) like '%changed since review%'
  and not exists(select 1 from public.refund_case_nayax_refund_attempts
    where refund_case_id='b1600000-0000-4000-8000-000000000004'),
  'A stale case version creates no receipt or provider attempt'
);

update public.refund_cases
set status='card_refund_pending',decision='approved',
  decided_by='b1000000-0000-4000-8000-000000000001',
  decided_at=statement_timestamp()
where id='b1600000-0000-4000-8000-000000000006';

insert into public.refund_case_official_action_authorizations(
  refund_case_id,action,actor_user_id,manager_mapping_id,manager_mapping_version,
  authority_kind,expected_case_version,action_context_hash,status,created_at,expires_at,
  step_up_intent_id,verified_totp_at,nayax_execution_evidence_hash,authorization_method
)
select refund_case.id,'nayax_execute','b1000000-0000-4000-8000-000000000001',
  manager_mapping.id,manager_mapping.mapping_version,'machine_manager',
  case when refund_case.id='b1600000-0000-4000-8000-000000000006'
    then refund_case.official_action_version-1 else refund_case.official_action_version end,
  public.refund_official_action_context_hash('nayax_execute','card_refund_pending',
    'approved',null,null,null,refund_case.refund_amount_cents,null,null,false,null,null,null),
  'authorized',
  case when refund_case.id='b1600000-0000-4000-8000-000000000005'
    then statement_timestamp()-interval '10 minutes' else statement_timestamp() end,
  case when refund_case.id='b1600000-0000-4000-8000-000000000005'
    then statement_timestamp()-interval '5 minutes' else statement_timestamp()+interval '5 minutes' end,
  null,null,public.refund_nayax_execution_evidence_hash(refund_case,machine),'manager_session'
from public.refund_cases refund_case
join public.reporting_machines machine on machine.id=refund_case.reporting_machine_id
join public.reporting_machine_refund_managers manager_mapping
  on manager_mapping.reporting_machine_id=machine.id
  and manager_mapping.manager_user_id='b1000000-0000-4000-8000-000000000001'
where refund_case.id in (
  'b1600000-0000-4000-8000-000000000005',
  'b1600000-0000-4000-8000-000000000006'
);

select ok(
  pg_temp.capture_error($sql$
    select public.service_consume_nayax_refund_official_action(
      (select id from public.refund_case_official_action_authorizations
       where refund_case_id='b1600000-0000-4000-8000-000000000005'),
      'b1600000-0000-4000-8000-000000000005',
      'card_refund_pending','approved',600,null)
  $sql$) like '%authorization expired%'
  and (select status='authorized' and consumed_at is null
    from public.refund_case_official_action_authorizations
    where refund_case_id='b1600000-0000-4000-8000-000000000005')
  and not exists(select 1 from public.refund_case_nayax_refund_attempts
    where refund_case_id='b1600000-0000-4000-8000-000000000005'),
  'An expired manager-session receipt fails before consumption or provider reservation'
);

select ok(
  pg_temp.capture_error($sql$
    select public.service_consume_nayax_refund_official_action(
      (select id from public.refund_case_official_action_authorizations
       where refund_case_id='b1600000-0000-4000-8000-000000000006'),
      'b1600000-0000-4000-8000-000000000004',
      'card_refund_pending','approved',550,null)
  $sql$) like '%does not match this request%'
  and (select status='authorized' and consumed_at is null
    from public.refund_case_official_action_authorizations
    where refund_case_id='b1600000-0000-4000-8000-000000000006'),
  'A manager-session receipt cannot be consumed for a different case'
);

select lives_ok($sql$
  select public.service_consume_nayax_refund_official_action(
    (select id from public.refund_case_official_action_authorizations
     where refund_case_id='b1600000-0000-4000-8000-000000000006'),
    'b1600000-0000-4000-8000-000000000006',
    'card_refund_pending','approved',550,null)
$sql$, 'The exact case, version, amount, actor, and evidence binding consumes once');

select ok(
  pg_temp.capture_error($sql$
    select public.service_consume_nayax_refund_official_action(
      (select id from public.refund_case_official_action_authorizations
       where refund_case_id='b1600000-0000-4000-8000-000000000006'),
      'b1600000-0000-4000-8000-000000000006',
      'card_refund_pending','approved',550,null)
  $sql$) like '%already used%'
  and (select status='consumed' and consumed_at is not null
    from public.refund_case_official_action_authorizations
    where refund_case_id='b1600000-0000-4000-8000-000000000006')
  and not exists(select 1 from public.refund_case_nayax_refund_attempts
    where refund_case_id='b1600000-0000-4000-8000-000000000006'),
  'A consumed manager-session receipt cannot be reused and creates no provider attempt by itself'
);

update public.refund_cases
set status='card_refund_pending',decision='approved',
  decided_by='b1000000-0000-4000-8000-000000000001',
  decided_at=statement_timestamp()
where id='b1600000-0000-4000-8000-000000000004';

insert into public.refund_case_official_action_authorizations(
  refund_case_id,action,actor_user_id,manager_mapping_id,manager_mapping_version,
  authority_kind,expected_case_version,action_context_hash,status,expires_at,
  step_up_intent_id,verified_totp_at,nayax_execution_evidence_hash,authorization_method
)
select refund_case.id,'nayax_execute','b1000000-0000-4000-8000-000000000001',
  manager_mapping.id,manager_mapping.mapping_version,'machine_manager',
  refund_case.official_action_version-1,
  public.refund_official_action_context_hash('nayax_execute','card_refund_pending',
    'approved',null,null,null,650,null,null,false,null,null,null),
  'authorized',statement_timestamp()+interval '5 minutes',null,null,
  public.refund_nayax_execution_evidence_hash(refund_case,machine),'manager_session'
from public.refund_cases refund_case
join public.reporting_machines machine on machine.id=refund_case.reporting_machine_id
join public.reporting_machine_refund_managers manager_mapping
  on manager_mapping.reporting_machine_id=machine.id
  and manager_mapping.manager_user_id='b1000000-0000-4000-8000-000000000001'
where refund_case.id='b1600000-0000-4000-8000-000000000004';

update public.reporting_machine_refund_managers
set status='revoked',revoked_at=statement_timestamp(),
  revoke_reason='Synthetic post-approval authority change'
where id='b1400000-0000-4000-8000-000000000001';
update public.reporting_machines set nayax_account_key='MANAGER_SESSION_ACCOUNT_CHANGED'
where id='b1300000-0000-4000-8000-000000000001';

select ok(
  pg_temp.capture_error($sql$
    select public.service_consume_nayax_refund_official_action(
      (select id from public.refund_case_official_action_authorizations
       where refund_case_id='b1600000-0000-4000-8000-000000000004'
         and action='nayax_execute'),
      'b1600000-0000-4000-8000-000000000004',
      'card_refund_pending','approved',650,null)
  $sql$) like '%execution evidence changed%'
  and (select status='authorized' and consumed_at is null
    from public.refund_case_official_action_authorizations
    where refund_case_id='b1600000-0000-4000-8000-000000000004'
      and action='nayax_execute')
  and not exists(select 1 from public.refund_case_nayax_refund_attempts
    where refund_case_id='b1600000-0000-4000-8000-000000000004'),
  'Post-approval System work ignores live role changes, rejects evidence drift, rolls back receipt use, and creates no provider attempt'
);

update public.reporting_machines set nayax_account_key='MANAGER_SESSION_ACCOUNT'
where id='b1300000-0000-4000-8000-000000000001';
update public.reporting_machine_refund_managers
set status='active',revoked_at=null,revoke_reason=null
where id='b1400000-0000-4000-8000-000000000001';

insert into pg_temp.manager_session_results (result_key, result)
select 'first', public.service_reserve_nayax_refund_manager_action(
  'manager-session-executor',
  'b1000000-0000-4000-8000-000000000001',
  'b1600000-0000-4000-8000-000000000001',
  (select official_action_version from public.refund_cases
    where id = 'b1600000-0000-4000-8000-000000000001'),
  'nayax-refund-' || repeat('1', 64), 700, null, null, 'USD'
);

select ok(
  (select (result #>> '{attempt,shouldExecute}')::boolean
      and result #>> '{managerAction,authorizationMethod}' = 'manager_session'
      and length(result ->> 'providerClaimToken') = 64
    from pg_temp.manager_session_results where result_key = 'first'),
  'A ready mapped-manager action reserves exactly one executable provider attempt'
);

select ok(
  (select count(*) = 1
   from public.refund_case_official_action_authorizations authorization_row
   where authorization_row.refund_case_id = 'b1600000-0000-4000-8000-000000000001'
     and authorization_row.authorization_method = 'manager_session'
     and authorization_row.authority_kind = 'machine_manager'
     and authorization_row.step_up_intent_id is null
     and authorization_row.verified_totp_at is null)
  and not exists (
    select 1 from public.refund_manager_action_step_up_intents intent
    where intent.refund_case_id = 'b1600000-0000-4000-8000-000000000001'
  ),
  'One manager confirmation creates one manager-session receipt and no TOTP row'
);

select ok(
  exists (
    select 1 from public.refund_cases
    where id = 'b1600000-0000-4000-8000-000000000001'
      and status = 'card_refund_pending'
      and decision = 'approved'
      and nayax_refund_execution_status = 'requested'
  ),
  'The atomic reservation records the manager decision and pending provider state'
);

insert into pg_temp.manager_session_results (result_key, result)
select 'replay', public.service_reserve_nayax_refund_manager_action(
  'manager-session-executor',
  'b1000000-0000-4000-8000-000000000001',
  'b1600000-0000-4000-8000-000000000001', 1,
  'nayax-refund-' || repeat('1', 64), 700, null, null, 'USD'
);

select ok(
  (select not (result #>> '{attempt,shouldExecute}')::boolean
    from pg_temp.manager_session_results where result_key = 'replay')
  and (select count(*) = 1 from public.refund_case_nayax_refund_attempts
    where refund_case_id = 'b1600000-0000-4000-8000-000000000001'),
  'An exact replay returns the original reservation and cannot create a second attempt'
);

select ok(
  pg_temp.capture_error($sql$
    select public.service_reserve_nayax_refund_manager_action(
      'manager-session-executor', 'b1000000-0000-4000-8000-000000000002',
      'b1600000-0000-4000-8000-000000000002', 1,
      'nayax-refund-3333333333333333333333333333333333333333333333333333333333333333',
      700, 100000, 100, 'USD')
  $sql$) like '%active assigned manager or Super-admin is required%'
  and not exists (
    select 1 from public.refund_case_nayax_refund_attempts
    where refund_case_id = 'b1600000-0000-4000-8000-000000000002'
  ),
  'An unmapped authenticated user cannot reserve a provider attempt'
);

select is(
  (select count(*)::integer from public.refund_case_events
    where refund_case_id = 'b1600000-0000-4000-8000-000000000001'
      and event_type = 'official_action_committed'
      and metadata ->> 'authority_kind' = 'machine_manager'),
  1,
  'The manager decision is auditable once'
);

insert into pg_temp.manager_session_results (result_key, result)
select 'wallet', public.service_reserve_nayax_refund_manager_action(
  'manager-session-executor',
  'b1000000-0000-4000-8000-000000000001',
  'b1600000-0000-4000-8000-000000000003',
  (select official_action_version from public.refund_cases
    where id = 'b1600000-0000-4000-8000-000000000003'),
  'nayax-refund-' || repeat('4', 64), 1090, 100000, 100, 'USD'
);

select ok(
  (select (result #>> '{attempt,shouldExecute}')::boolean
    from pg_temp.manager_session_results where result_key = 'wallet')
  and exists (
    select 1 from public.refund_case_nayax_refund_attempts
    where refund_case_id = 'b1600000-0000-4000-8000-000000000003'
      and amount_cents = 1090
  ),
  'A manager-selected wallet transaction uses the exact provider amount even when customer clues differ'
);

select ok(
  pg_temp.capture_error(format(
    $sql$select public.service_reserve_nayax_refund_manager_action(
      'manager-session-executor', 'b1000000-0000-4000-8000-000000000001',
      'b1600000-0000-4000-8000-000000000003', %s,
      'nayax-refund-%s', 1000, 100000, 100, 'USD')$sql$,
    (select official_action_version from public.refund_cases
      where id = 'b1600000-0000-4000-8000-000000000003'),
    repeat('5', 64)
  )) like '%not ready for refund%'
  and not exists (
    select 1 from public.refund_case_nayax_refund_attempts
    where idempotency_key = 'nayax-refund-' || repeat('5', 64)
  ),
  'The customer-reported amount cannot replace the exact selected provider amount'
);

select is(
  (select count(*)::integer from public.refund_case_nayax_refund_attempts
    where refund_case_id in (
      'b1600000-0000-4000-8000-000000000001',
      'b1600000-0000-4000-8000-000000000002',
      'b1600000-0000-4000-8000-000000000003'
    )),
  2,
  'All repeated and rejected calls leave only the two intended provider attempts'
);

select * from finish();
rollback;
