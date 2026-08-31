begin;

create extension if not exists pgtap with schema extensions;
set local search_path = public, extensions;

select plan(52);

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
begin execute statement; return null;
exception when others then return sqlstate || ':' || sqlerrm;
end;
$$;

create function pg_temp.machine_local_minutes_ago(minutes_ago integer)
returns text language sql stable as $$
  select to_char(
    (statement_timestamp() - make_interval(mins => minutes_ago)) at time zone 'America/New_York',
    'YYYY-MM-DD"T"HH24:MI'
  );
$$;

create temporary table manual_results (key text primary key, value jsonb not null);
grant all on table pg_temp.manual_results to authenticated, service_role;

select has_column('public', 'reporting_machines', 'nayax_manual_portal_enabled', 'Machines have an explicit manual Nayax portal switch');
select has_column('public', 'reporting_machines', 'nayax_manual_account_scope', 'Machines have a private duplicate-protection scope');
select has_column('public', 'reporting_machines', 'nayax_manual_portal_timezone', 'Manual machines have an exact machine-local timezone');
select has_table('public', 'refund_manual_nayax_evidence', 'Exact manual portal evidence has a private table');
select has_function('public', 'admin_create_refund_manual_nayax_candidate', array['uuid','bigint','text','text','text','integer','text'], 'Refund Operations can enter exact portal evidence through one guarded function');
select has_function('public', 'admin_begin_refund_manual_nayax_portal', array['uuid','bigint'], 'Refund Operations has a separate guarded approval function');
select ok(
  public.refund_nayax_direct_api_execution_hard_disabled()
  and pg_get_functiondef(
    'public.admin_begin_refund_manual_nayax_portal_pre_ops_v1(uuid,bigint)'::regprocedure
  ) like '%refund_nayax_direct_api_execution_hard_disabled()%'
  and not has_function_privilege(
    'authenticated',
    'public.refund_nayax_direct_api_execution_hard_disabled()',
    'execute'
  ),
  'Ordinary portal fallback is durably bound to the private immutable direct-API hard-disable'
);
select ok(
  not has_table_privilege('anon', 'public.refund_manual_nayax_evidence', 'select')
  and not has_table_privilege('authenticated', 'public.refund_manual_nayax_evidence', 'select')
  and not has_table_privilege('service_role', 'public.refund_manual_nayax_evidence', 'select'),
  'Raw manual portal evidence is unavailable to browser and service personas'
);
select ok(
  has_function_privilege('authenticated', 'public.admin_create_refund_manual_nayax_candidate(uuid,bigint,text,text,text,integer,text)', 'execute')
  and not has_function_privilege('anon', 'public.admin_create_refund_manual_nayax_candidate(uuid,bigint,text,text,text,integer,text)', 'execute'),
  'Only authenticated sessions can reach the evidence-entry boundary'
);
select ok(
  has_function_privilege('authenticated', 'public.admin_begin_refund_manual_nayax_portal(uuid,bigint)', 'execute')
  and not has_function_privilege('anon', 'public.admin_begin_refund_manual_nayax_portal(uuid,bigint)', 'execute'),
  'Only authenticated sessions can reach the separate approval boundary'
);

insert into public.customer_accounts (id, name, account_type, status)
values ('94100000-0000-4000-8000-000000000001', 'Manual Nayax fixture', 'internal', 'active');
insert into public.reporting_locations (id, account_id, name, city, state, timezone, status)
values ('94110000-0000-4000-8000-000000000001', '94100000-0000-4000-8000-000000000001', 'Shared Pacific placeholder fixture', 'Los Angeles', 'CA', 'America/Los_Angeles', 'active');
insert into public.reporting_machines (
  id, account_id, location_id, machine_label, machine_type, status,
  nayax_machine_id, nayax_account_key, nayax_refunds_enabled,
  refund_intake_enabled, refund_public_display_label,
  nayax_manual_portal_enabled, nayax_manual_account_scope,
  nayax_manual_portal_timezone
) values
  (
    '94120000-0000-4000-8000-000000000001',
    '94100000-0000-4000-8000-000000000001',
    '94110000-0000-4000-8000-000000000001',
    'Carolina Place fixture', 'commercial', 'active', null, null, false,
    true, 'Carolina Place fixture', true, 'bloomjoy_nc_adam', 'America/New_York'
  ),
  (
    '94120000-0000-4000-8000-000000000002',
    '94100000-0000-4000-8000-000000000001',
    '94110000-0000-4000-8000-000000000001',
    'API mapped fixture', 'commercial', 'active', 'NAYAX-STANDARD-002',
    'TGPACI_STANDARD', true, true, 'API mapped fixture', false, null, null
  );

insert into auth.users (
  instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at
) values
  ('00000000-0000-0000-0000-000000000000', '94130000-0000-4000-8000-000000000001', 'authenticated', 'authenticated', 'adam-manual@example.test', '', now(), '{}'::jsonb, '{}'::jsonb, now(), now()),
  ('00000000-0000-0000-0000-000000000000', '94130000-0000-4000-8000-000000000002', 'authenticated', 'authenticated', 'unmapped@example.test', '', now(), '{}'::jsonb, '{}'::jsonb, now(), now()),
  ('00000000-0000-0000-0000-000000000000', '94130000-0000-4000-8000-000000000003', 'authenticated', 'authenticated', 'routine-manager@example.test', '', now(), '{}'::jsonb, '{}'::jsonb, now(), now());

insert into public.admin_roles (user_id, role, active)
values ('94130000-0000-4000-8000-000000000001', 'super_admin', true);

insert into public.reporting_machine_refund_managers (
  reporting_machine_id, manager_user_id, manager_email, grant_reason
) values
  (
    '94120000-0000-4000-8000-000000000001',
    '94130000-0000-4000-8000-000000000001',
    'adam-manual@example.test', 'Refund Operations fixture'
  ),
  (
    '94120000-0000-4000-8000-000000000001',
    '94130000-0000-4000-8000-000000000003',
    'routine-manager@example.test', 'Routine manager fixture'
  ),
  (
    '94120000-0000-4000-8000-000000000002',
    '94130000-0000-4000-8000-000000000001',
    'adam-manual@example.test', 'Refund Operations standard fixture'
  );

insert into public.refund_cases (
  id, reporting_machine_id, reporting_location_id, customer_email,
  customer_name, issue_summary, incident_at, incident_local_datetime,
  incident_timezone, incident_time_resolution, payment_method,
  payment_amount_cents, card_last4, card_network, payment_interaction,
  incident_time_confidence, issue_category, status, correlation_status
) values
  ('94140000-0000-4000-8000-000000000001', '94120000-0000-4000-8000-000000000001', '94110000-0000-4000-8000-000000000001', 'customer-one@example.test', 'Customer One', 'Manual Nayax refund fixture one', now() - interval '30 minutes', to_char(now() - interval '30 minutes', 'YYYY-MM-DD"T"HH24:MI'), 'America/New_York', 'exact', 'card', 700, '4242', 'visa', 'tap_card', 'exact', 'charged_no_product', 'needs_review', 'nayax_not_configured'),
  ('94140000-0000-4000-8000-000000000002', '94120000-0000-4000-8000-000000000001', '94110000-0000-4000-8000-000000000001', 'customer-two@example.test', 'Customer Two', 'Manual Nayax refund fixture two', now() - interval '25 minutes', to_char(now() - interval '25 minutes', 'YYYY-MM-DD"T"HH24:MI'), 'America/New_York', 'exact', 'card', 800, '4242', 'visa', 'tap_card', 'exact', 'charged_no_product', 'needs_review', 'nayax_not_configured'),
  ('94140000-0000-4000-8000-000000000003', '94120000-0000-4000-8000-000000000002', '94110000-0000-4000-8000-000000000001', 'customer-standard@example.test', 'Standard Customer', 'Exact matched standard Nayax wallet refund fixture', now() - interval '20 minutes', to_char(now() - interval '20 minutes', 'YYYY-MM-DD"T"HH24:MI'), 'America/Los_Angeles', 'exact', 'card', 600, '1111', 'mastercard', 'phone_watch_wallet', 'exact', 'charged_no_product', 'needs_review', 'matched'),
  ('94140000-0000-4000-8000-000000000004', '94120000-0000-4000-8000-000000000002', '94110000-0000-4000-8000-000000000001', 'customer-physical@example.test', 'Physical Customer', 'Exact matched physical-card ineligible fixture', now() - interval '15 minutes', to_char(now() - interval '15 minutes', 'YYYY-MM-DD"T"HH24:MI'), 'America/Los_Angeles', 'exact', 'card', 1000, '4444', 'visa', 'tap_card', 'exact', 'charged_no_product', 'needs_review', 'matched');

update public.refund_cases
set
  correlation_source = 'nayax',
  correlation_confidence = 0.99,
  correlation_summary = 'Exact standard Nayax fixture transaction selected.',
  refund_amount_cents = 900,
  matched_nayax_transaction_id = 'STANDARD-TXN-941-0003',
  matched_nayax_site_id = 94103,
  matched_nayax_machine_auth_time = statement_timestamp() - interval '20 minutes',
  matched_nayax_amount_cents = 900,
  matched_nayax_card_last4 = '3333',
  matched_nayax_currency_code = 'USD',
  nayax_recommendation_state = 'high_confidence',
  nayax_recommendation_policy_version = '2026-07-21.v1',
  nayax_recommendation_evaluated_at = statement_timestamp(),
  nayax_match_execution_eligible = false,
  card_wallet_used = true,
  wallet_provider = 'apple_pay'
where id = '94140000-0000-4000-8000-000000000003';

insert into public.refund_case_events (
  refund_case_id, actor_user_id, event_type, message, metadata
) values (
  '94140000-0000-4000-8000-000000000003',
  '94130000-0000-4000-8000-000000000001',
  'nayax_match_selected',
  'Refund Operations confirmed the exact standard Nayax fixture transaction.',
  jsonb_build_object(
    'policy_version', '2026-07-21.v1',
    'recommendation_state', 'high_confidence',
    'selected_recommended', true,
    'execution_eligible', false,
    'payload_redacted', true
  )
);

update public.refund_cases
set
  correlation_source = 'nayax',
  correlation_confidence = 0.99,
  correlation_summary = 'Exact physical-card fixture transaction selected.',
  refund_amount_cents = 1000,
  matched_nayax_transaction_id = 'STANDARD-TXN-941-0004',
  matched_nayax_site_id = 94104,
  matched_nayax_machine_auth_time = statement_timestamp() - interval '15 minutes',
  matched_nayax_amount_cents = 1000,
  matched_nayax_card_last4 = '4444',
  matched_nayax_currency_code = 'USD',
  nayax_recommendation_state = 'high_confidence',
  nayax_recommendation_policy_version = '2026-07-21.v1',
  nayax_recommendation_evaluated_at = statement_timestamp(),
  nayax_match_execution_eligible = false,
  card_wallet_used = false,
  wallet_provider = null
where id = '94140000-0000-4000-8000-000000000004';

insert into public.refund_case_events (
  refund_case_id, actor_user_id, event_type, message, metadata
) values (
  '94140000-0000-4000-8000-000000000004',
  '94130000-0000-4000-8000-000000000001',
  'nayax_match_selected',
  'Refund Operations confirmed the exact physical-card fixture transaction.',
  jsonb_build_object(
    'policy_version', '2026-07-21.v1',
    'recommendation_state', 'high_confidence',
    'selected_recommended', true,
    'execution_eligible', false,
    'payload_redacted', true
  )
);

insert into public.refund_gmail_threads (
  id, refund_case_id, mailbox_hash, provider_thread_id, thread_subject,
  first_message_at, latest_message_at, retention_expires_at
) values
  (
    '94150000-0000-4000-8000-000000000001',
    '94140000-0000-4000-8000-000000000001', repeat('9', 64),
    'manual-nayax-original-thread', 'Original manual Nayax refund conversation',
    statement_timestamp() - interval '2 days',
    statement_timestamp() - interval '1 day',
    statement_timestamp() + interval '180 days'
  ),
  (
    '94150000-0000-4000-8000-000000000002',
    '94140000-0000-4000-8000-000000000003', repeat('8', 64),
    'standard-nayax-original-thread', 'Original standard Nayax refund conversation',
    statement_timestamp() - interval '2 days',
    statement_timestamp() - interval '1 day',
    statement_timestamp() + interval '180 days'
  );

set local role authenticated;
select pg_temp.set_auth_claims('94130000-0000-4000-8000-000000000002');
select ok(
  pg_temp.capture_error(format(
    $$select public.admin_create_refund_manual_nayax_candidate(
      '94140000-0000-4000-8000-000000000001', %s, 'Carolina-Portal-01',
      'MANUAL-TXN-941-0001', pg_temp.machine_local_minutes_ago(30), 700, '4242')$$,
    (select official_action_version from public.refund_cases where id = '94140000-0000-4000-8000-000000000001')
  )) is not null,
  'An unrelated authenticated user cannot enter portal evidence'
);

select pg_temp.set_auth_claims('94130000-0000-4000-8000-000000000003');
select is(
  public.admin_get_refund_manual_nayax_context(),
  '[]'::jsonb,
  'A routine mapped manager receives no manual Nayax provider context'
);
select ok(
  pg_temp.capture_error(format(
    $$select public.admin_create_refund_manual_nayax_candidate(
      '94140000-0000-4000-8000-000000000001', %s, 'Carolina-Portal-01',
      'MANUAL-TXN-941-ROUTINE', pg_temp.machine_local_minutes_ago(30), 700, '4242')$$,
    (select official_action_version from public.refund_cases where id = '94140000-0000-4000-8000-000000000001')
  )) like '42501:Refund Operations administrator required%',
  'A routine mapped manager cannot submit manual Nayax evidence'
);

select pg_temp.set_auth_claims('94130000-0000-4000-8000-000000000001');
select is(
  (
    select jsonb_build_object(
      'fallbackKind', context ->> 'reviewedNayaxPortalFallbackKind',
      'selected', (context ->> 'manualNayaxEvidenceSelected')::boolean,
      'timezone', context ->> 'manualNayaxLocationTimezone'
    )
    from jsonb_array_elements(
      public.admin_get_refund_manual_nayax_context()
    ) context
    where context ->> 'caseId' =
      '94140000-0000-4000-8000-000000000001'
  ),
  jsonb_build_object(
    'fallbackKind', 'legacy_manual_evidence',
    'selected', false,
    'timezone', 'America/New_York'
  ),
  'Legacy portal work is discoverable before evidence with its exact kind, unselected state, and machine timezone'
);
select ok(
  pg_get_functiondef(
    'public.admin_create_refund_manual_nayax_candidate_pre_ops_v1(uuid,bigint,text,text,text,integer,text)'::regprocedure
  ) not like '%Transaction amount must exactly match the reviewed customer payment%'
  and pg_get_functiondef(
    'public.admin_create_refund_manual_nayax_candidate_pre_ops_v1(uuid,bigint,text,text,text,integer,text)'::regprocedure
  ) like '%Enter the positive transaction amount shown in Nayax%',
  'Customer-reported amount is a clue; the positive provider amount is authoritative'
);
select ok(
  pg_get_functiondef(
    'public.admin_create_refund_manual_nayax_candidate_pre_ops_v1(uuid,bigint,text,text,text,integer,text)'::regprocedure
  ) not like '%Card ending must exactly match the reviewed customer payment%'
  and pg_get_functiondef(
    'public.admin_create_refund_manual_nayax_candidate_pre_ops_v1(uuid,bigint,text,text,text,integer,text)'::regprocedure
  ) like '%Enter the four card digits shown in Nayax%',
  'Customer-reported card digits are a clue; safe provider digits are authoritative'
);
select ok(
  pg_temp.capture_error(format(
    $$select public.admin_create_refund_manual_nayax_candidate(
      '94140000-0000-4000-8000-000000000001', %s, 'unsafe@example.test',
      'MANUAL-TXN-941-0001', pg_temp.machine_local_minutes_ago(30), 700, '4242')$$,
    (select official_action_version from public.refund_cases where id = '94140000-0000-4000-8000-000000000001')
  )) like
  'P0001:Enter a safe Nayax portal machine reference%',
  'Sensitive-looking machine text is rejected'
);
select ok(
  pg_temp.capture_error(format(
    $$select public.admin_create_refund_manual_nayax_candidate(
      '94140000-0000-4000-8000-000000000001', %s, 'Carolina-Portal-01',
      'MANUAL-TXN-941-0001', '2026-03-08T02:30', 700, '4242')$$,
    (select official_action_version from public.refund_cases where id = '94140000-0000-4000-8000-000000000001')
  )) like 'P0001:That local transaction time does not exist%',
  'A daylight-saving gap cannot silently shift the transaction time'
);
select ok(
  pg_temp.capture_error(format(
    $$select public.admin_create_refund_manual_nayax_candidate(
      '94140000-0000-4000-8000-000000000001', %s, 'Carolina-Portal-01',
      'MANUAL-TXN-941-0001', '2026-11-01T01:30', 700, '4242')$$,
    (select official_action_version from public.refund_cases where id = '94140000-0000-4000-8000-000000000001')
  )) like 'P0001:That local transaction time is ambiguous%',
  'A daylight-saving fold cannot pick one of two transaction times'
);

insert into pg_temp.manual_results values (
  'candidate_local_time', to_jsonb(pg_temp.machine_local_minutes_ago(30))
);
insert into pg_temp.manual_results
select 'candidate', public.admin_create_refund_manual_nayax_candidate(
  '94140000-0000-4000-8000-000000000001',
  (select official_action_version from public.refund_cases where id = '94140000-0000-4000-8000-000000000001'),
  'Carolina-Portal-01', 'MANUAL-TXN-941-0001',
  (select value #>> '{}' from pg_temp.manual_results where key = 'candidate_local_time'),
  700, '4242'
);
reset role;
select ok((select (value ->> 'providerCallMade')::boolean = false and (value ->> 'customerMessageCreated')::boolean = false from pg_temp.manual_results where key = 'candidate'), 'Evidence entry explicitly makes no provider call or customer email');
select is((select site_id from public.refund_nayax_lookup_candidates where token = (select (value ->> 'candidateToken')::uuid from pg_temp.manual_results where key = 'candidate')), null::integer, 'Manual evidence never invents a Nayax API site ID');
select is(
  (select to_char(machine_authorization_time at time zone 'America/New_York', 'YYYY-MM-DD"T"HH24:MI')
   from public.refund_manual_nayax_evidence
   where refund_case_id = '94140000-0000-4000-8000-000000000001'),
  (select value #>> '{}' from pg_temp.manual_results where key = 'candidate_local_time'),
  'Exact transaction time is converted with the machine timezone, not the shared placeholder'
);

set local role authenticated;
select pg_temp.set_auth_claims('94130000-0000-4000-8000-000000000001');
select ok(
  pg_temp.capture_error(format(
    $$select public.admin_create_refund_manual_nayax_candidate(
      '94140000-0000-4000-8000-000000000002', %s, 'Carolina-Portal-01',
      'MANUAL-TXN-941-0001', pg_temp.machine_local_minutes_ago(25), 800, '4242')$$,
    (select official_action_version from public.refund_cases where id = '94140000-0000-4000-8000-000000000002')
  )) like
  '23505:This Nayax transaction is already linked%',
  'The same account-scope transaction cannot enter a second case'
);

set local role service_role;
select lives_ok(format(
  $$select public.service_select_refund_nayax_candidate_as_actor(
    '94130000-0000-4000-8000-000000000001',
    '94140000-0000-4000-8000-000000000001', %s, %L::uuid, null)$$,
  (select official_action_version from public.refund_cases where id = '94140000-0000-4000-8000-000000000001'),
  (select value ->> 'candidateToken' from pg_temp.manual_results where key = 'candidate')
), 'The established confirmation boundary accepts the exact private manual evidence');
reset role;

set local role authenticated;
select pg_temp.set_auth_claims('94130000-0000-4000-8000-000000000001');
select is(
  (
    select (context ->> 'manualNayaxEvidenceSelected')::boolean
    from jsonb_array_elements(
      public.admin_get_refund_manual_nayax_context()
    ) context
    where context ->> 'caseId' =
      '94140000-0000-4000-8000-000000000001'
  ),
  true,
  'The exact legacy context becomes selected after the guarded evidence-selection boundary'
);
reset role;

select is((select matched_nayax_site_id from public.refund_cases where id = '94140000-0000-4000-8000-000000000001'), null::integer, 'Confirmed manual evidence remains honest about the absent API site');
select is((select decision from public.refund_cases where id = '94140000-0000-4000-8000-000000000001'), null::text, 'Transaction confirmation does not approve the refund');
select is((select count(*)::integer from public.refund_case_nayax_refund_attempts where refund_case_id = '94140000-0000-4000-8000-000000000001'), 0, 'Transaction confirmation does not create a refund attempt');
select is((select count(*)::integer from public.refund_case_messages where refund_case_id = '94140000-0000-4000-8000-000000000001'), 0, 'Transaction confirmation sends no customer email');

set local role authenticated;
select pg_temp.set_auth_claims('94130000-0000-4000-8000-000000000001');
insert into pg_temp.manual_results
select 'approval', public.admin_begin_refund_manual_nayax_portal(
  '94140000-0000-4000-8000-000000000001',
  (select official_action_version from public.refund_cases where id = '94140000-0000-4000-8000-000000000001')
);
reset role;
select ok((select (value ->> 'providerCallMade')::boolean = false and (value ->> 'customerMessageCreated')::boolean = false from pg_temp.manual_results where key = 'approval'), 'Manual approval explicitly makes no provider call or customer email');
select is((select status || ':' || decision from public.refund_cases where id = '94140000-0000-4000-8000-000000000001'), 'card_refund_pending:approved', 'Separate approval places the case on a payment-result hold');
select is((select execution_mode || ':' || status || ':' || provider_outcome from public.refund_case_nayax_refund_attempts where refund_case_id = '94140000-0000-4000-8000-000000000001'), 'manual_portal:manual_review:unknown', 'Approval creates one truthful unknown manual-portal attempt');
select is((select count(*)::integer from public.refund_case_messages where refund_case_id = '94140000-0000-4000-8000-000000000001'), 0, 'Approval still sends no customer email');
select is((select count(*)::integer from public.sales_adjustment_facts where refund_case_id = '94140000-0000-4000-8000-000000000001'), 0, 'Approval does not change financial reporting');

set local role authenticated;
select pg_temp.set_auth_claims('94130000-0000-4000-8000-000000000001');
insert into pg_temp.manual_results
select 'replay', public.admin_begin_refund_manual_nayax_portal(
  '94140000-0000-4000-8000-000000000001',
  (select official_action_version from public.refund_cases where id = '94140000-0000-4000-8000-000000000001')
);
reset role;
select ok((select (value ->> 'created')::boolean = false from pg_temp.manual_results where key = 'replay'), 'A repeated approval returns the original attempt');
select is((select count(*)::integer from public.refund_case_nayax_refund_attempts where refund_case_id = '94140000-0000-4000-8000-000000000001'), 1, 'A repeated approval cannot create a duplicate attempt');

set local role authenticated;
select pg_temp.set_auth_claims('94130000-0000-4000-8000-000000000001');
insert into pg_temp.manual_results
select 'completion', public.admin_resolve_refund_nayax_outcome_manager_session(
  '94140000-0000-4000-8000-000000000001',
  (select (value ->> 'attemptId')::uuid from pg_temp.manual_results where key = 'approval'),
  'documented_manual_completion', 'documented_manual_refund',
  'MANUAL:MANUAL-TXN-941-0001', statement_timestamp(),
  'manual_nayax_completion',
  (select official_action_version from public.refund_cases where id = '94140000-0000-4000-8000-000000000001')
);
reset role;
select ok(
  (select (value ->> 'caseCompleted')::boolean and not (value ->> 'providerCallMade')::boolean
   from pg_temp.manual_results where key = 'completion'),
  'The exact documented Nayax result completes the case without a second provider call'
);
select ok((
  select refund_case.status = 'completed'
    and refund_case.reporting_adjustment_id is not null
    and attempt.status = 'succeeded'
    and attempt.provider_outcome = 'success'
    and not attempt.reconciliation_required
  from public.refund_cases refund_case
  join public.refund_case_nayax_refund_attempts attempt on attempt.refund_case_id = refund_case.id
  where refund_case.id = '94140000-0000-4000-8000-000000000001'
), 'Documented completion atomically settles the case and its held attempt');
select is(
  (select count(*)::integer from public.sales_adjustment_facts where refund_case_id = '94140000-0000-4000-8000-000000000001'),
  1,
  'Documented completion creates exactly one reporting adjustment'
);
select ok(
  (select count(*) = 1 from public.refund_case_messages
    where refund_case_id = '94140000-0000-4000-8000-000000000001'
      and template_version = 'refund_nayax_completion_v2')
  and (select completion_gmail_thread_id = '94150000-0000-4000-8000-000000000001'
    from public.refund_case_nayax_refund_attempts
    where refund_case_id = '94140000-0000-4000-8000-000000000001'),
  'Documented completion prepares one warm reply on the original customer thread'
);

set local role authenticated;
select pg_temp.set_auth_claims('94130000-0000-4000-8000-000000000001');
select ok(
  exists (
    select 1
    from jsonb_array_elements(public.admin_get_refund_manual_nayax_context()) context
    where context ->> 'caseId' = '94140000-0000-4000-8000-000000000003'
      and (context ->> 'manualNayaxPortalEnabled')::boolean
      and context ->> 'reviewedNayaxPortalFallbackKind' = 'ordinary_exact_match'
  ),
  'Refund Operations receives the reviewed portal fallback for an ordinary exact matched wallet transaction'
);
select ok(
  not exists (
    select 1
    from jsonb_array_elements(public.admin_get_refund_manual_nayax_context()) context
    where context ->> 'caseId' = '94140000-0000-4000-8000-000000000004'
  ),
  'An execution-ineligible physical-card match cannot use the ordinary portal fallback'
);
select ok(
  pg_temp.capture_error(format(
    $$select public.admin_begin_refund_manual_nayax_portal(
      '94140000-0000-4000-8000-000000000004', %s)$$,
    (select official_action_version from public.refund_cases
     where id = '94140000-0000-4000-8000-000000000004')
  )) like 'P0001:Only an exact settled Nayax match can use the reviewed portal fallback%',
  'The server rejects an execution-ineligible physical-card fallback even when called directly'
);
insert into pg_temp.manual_results
select 'standard_approval', public.admin_begin_refund_manual_nayax_portal(
  '94140000-0000-4000-8000-000000000003',
  (select official_action_version from public.refund_cases where id = '94140000-0000-4000-8000-000000000003')
);
reset role;
select ok(
  (select not (value ->> 'providerCallMade')::boolean
    and not (value ->> 'customerMessageCreated')::boolean
   from pg_temp.manual_results where key = 'standard_approval'),
  'Ordinary exact-match portal approval makes no provider call or customer message'
);
select ok((
  select attempt.execution_mode = 'manual_portal'
    and attempt.status = 'manual_review'
    and attempt.provider_outcome = 'unknown'
    and attempt.amount_cents = 900
    and attempt.site_id_present
  from public.refund_case_nayax_refund_attempts attempt
  where attempt.refund_case_id = '94140000-0000-4000-8000-000000000003'
), 'Ordinary wallet-backed exact match creates one truthful full-transaction portal hold');
select is(
  (select status || ':' || decision || ':' || nayax_refund_execution_status
   from public.refund_cases
   where id = '94140000-0000-4000-8000-000000000003'),
  'card_refund_pending:approved:manual_review',
  'Ordinary portal approval moves the case to the canonical payment-result hold'
);
select ok(
  (select count(*) = 0 from public.refund_case_messages
   where refund_case_id = '94140000-0000-4000-8000-000000000003')
  and
  (select count(*) = 0 from public.sales_adjustment_facts
   where refund_case_id = '94140000-0000-4000-8000-000000000003'),
  'Portal approval does not notify the customer or change reporting'
);

set local role authenticated;
select pg_temp.set_auth_claims('94130000-0000-4000-8000-000000000001');
insert into pg_temp.manual_results
select 'standard_replay', public.admin_begin_refund_manual_nayax_portal(
  '94140000-0000-4000-8000-000000000003',
  (select official_action_version from public.refund_cases where id = '94140000-0000-4000-8000-000000000003')
);
reset role;
select ok(
  (select not (value ->> 'created')::boolean
   from pg_temp.manual_results where key = 'standard_replay')
  and
  (select count(*) = 1
   from public.refund_case_nayax_refund_attempts
   where refund_case_id = '94140000-0000-4000-8000-000000000003'),
  'Repeated ordinary portal approval replays the one exact attempt'
);

set local role authenticated;
select pg_temp.set_auth_claims('94130000-0000-4000-8000-000000000001');
insert into pg_temp.manual_results
select 'standard_completion', public.admin_resolve_refund_nayax_outcome_manager_session(
  '94140000-0000-4000-8000-000000000003',
  (select (value ->> 'attemptId')::uuid from pg_temp.manual_results where key = 'standard_approval'),
  'documented_manual_completion', 'documented_manual_refund',
  'MANUAL:STANDARD-TXN-941-0003', statement_timestamp(),
  'manual_nayax_completion',
  (select official_action_version from public.refund_cases where id = '94140000-0000-4000-8000-000000000003')
);
reset role;
select ok(
  (select (value ->> 'caseCompleted')::boolean
    and not (value ->> 'providerCallMade')::boolean
   from pg_temp.manual_results where key = 'standard_completion'),
  'Documented full-amount portal evidence completes the ordinary case without a provider call'
);
select ok((
  select refund_case.status = 'completed'
    and refund_case.refund_amount_cents = 900
    and refund_case.reporting_adjustment_id is not null
    and attempt.status = 'succeeded'
    and attempt.provider_outcome = 'success'
    and not attempt.reconciliation_required
  from public.refund_cases refund_case
  join public.refund_case_nayax_refund_attempts attempt
    on attempt.refund_case_id = refund_case.id
  where refund_case.id = '94140000-0000-4000-8000-000000000003'
), 'Verified portal completion settles the full matched amount and held attempt atomically');
select is(
  (select count(*)::integer from public.sales_adjustment_facts
   where refund_case_id = '94140000-0000-4000-8000-000000000003'),
  1,
  'Ordinary portal completion creates exactly one reporting adjustment'
);
select ok(
  (select count(*) = 1 from public.refund_case_messages
    where refund_case_id = '94140000-0000-4000-8000-000000000003'
      and template_version = 'refund_nayax_completion_v2')
  and
  (select completion_gmail_thread_id = '94150000-0000-4000-8000-000000000002'
    from public.refund_case_nayax_refund_attempts
    where refund_case_id = '94140000-0000-4000-8000-000000000003'),
  'Ordinary portal completion prepares exactly one reply on the original customer thread'
);

reset role;
select * from finish();
rollback;
