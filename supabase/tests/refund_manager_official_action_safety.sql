begin;

create extension if not exists pgtap with schema extensions;
set local search_path = public, extensions;

select plan(68);

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

create function pg_temp.set_auth_claims(
  p_user_id uuid,
  p_aal text,
  p_method text,
  p_method_timestamp numeric
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
      'amr', jsonb_build_array(jsonb_build_object(
        'method', p_method,
        'timestamp', p_method_timestamp
      ))
    )::text,
    true
  );
end;
$$;

create temporary table official_action_test_receipts (
  receipt_key text primary key,
  authorization_id uuid not null
);
grant select, insert on table pg_temp.official_action_test_receipts to authenticated, service_role;

insert into auth.users (
  instance_id,
  id,
  aud,
  role,
  email,
  encrypted_password,
  email_confirmed_at,
  raw_app_meta_data,
  raw_user_meta_data,
  created_at,
  updated_at
)
values
  (
    '00000000-0000-0000-0000-000000000000',
    '79000000-0000-4000-8000-000000000001',
    'authenticated',
    'authenticated',
    'official-manager@example.test',
    '', now(), '{}'::jsonb, '{}'::jsonb, now(), now()
  ),
  (
    '00000000-0000-0000-0000-000000000000',
    '79000000-0000-4000-8000-000000000002',
    'authenticated',
    'authenticated',
    'official-super@example.test',
    '', now(), '{}'::jsonb, '{}'::jsonb, now(), now()
  ),
  (
    '00000000-0000-0000-0000-000000000000',
    '79000000-0000-4000-8000-000000000003',
    'authenticated',
    'authenticated',
    'official-scoped@example.test',
    '', now(), '{}'::jsonb, '{}'::jsonb, now(), now()
  ),
  (
    '00000000-0000-0000-0000-000000000000',
    '79000000-0000-4000-8000-000000000004',
    'authenticated',
    'authenticated',
    'official-unrelated@example.test',
    '', now(), '{}'::jsonb, '{}'::jsonb, now(), now()
  );

insert into public.customer_accounts (id, name, account_type)
values ('79100000-0000-4000-8000-000000000001', 'Official action safety', 'customer');

insert into public.reporting_locations (id, account_id, name, timezone)
values (
  '79200000-0000-4000-8000-000000000001',
  '79100000-0000-4000-8000-000000000001',
  'Official action test location',
  'America/Los_Angeles'
);

insert into public.reporting_machines (
  id,
  account_id,
  location_id,
  machine_label,
  nayax_machine_id,
  nayax_account_key,
  nayax_refunds_enabled,
  nayax_refund_max_amount_cents
)
values (
  '79300000-0000-4000-8000-000000000001',
  '79100000-0000-4000-8000-000000000001',
  '79200000-0000-4000-8000-000000000001',
  'Official action test machine',
  'MACHINE-793',
  'ACCOUNT-793',
  true,
  2000
);

insert into public.reporting_machine_refund_managers (
  id,
  reporting_machine_id,
  manager_user_id,
  manager_email,
  grant_reason
)
values
  (
    '79400000-0000-4000-8000-000000000001',
    '79300000-0000-4000-8000-000000000001',
    '79000000-0000-4000-8000-000000000001',
    'official-manager@example.test',
    'Official action safety test'
  ),
  (
    '79410000-0000-4000-8000-000000000002',
    '79300000-0000-4000-8000-000000000001',
    '79000000-0000-4000-8000-000000000002',
    'official-super@example.test',
    'Dual-role Super Admin manager authority test'
  ),
  (
    '79410000-0000-4000-8000-000000000003',
    '79300000-0000-4000-8000-000000000001',
    '79000000-0000-4000-8000-000000000003',
    'official-scoped@example.test',
    'Dual-role Scoped Admin manager authority test'
  );

insert into public.admin_roles (id, user_id, role, active)
values
  (
    '79400000-0000-4000-8000-000000000002',
    '79000000-0000-4000-8000-000000000002',
    'super_admin',
    true
  ),
  (
    '79400000-0000-4000-8000-000000000006',
    '79000000-0000-4000-8000-000000000004',
    'super_admin',
    true
  );

insert into public.admin_scoped_access_grants (
  id,
  user_id,
  role,
  source,
  grant_reason
)
values (
  '79400000-0000-4000-8000-000000000003',
  '79000000-0000-4000-8000-000000000003',
  'scoped_admin',
  'manual_admin_grant',
  'Official action safety test'
);

insert into public.admin_scoped_access_scopes (
  id,
  grant_id,
  scope_type,
  machine_id,
  grant_reason
)
values (
  '79400000-0000-4000-8000-000000000004',
  '79400000-0000-4000-8000-000000000003',
  'machine',
  '79300000-0000-4000-8000-000000000001',
  'Official action safety test'
);

insert into public.machine_sales_facts (
  id,
  reporting_machine_id,
  reporting_location_id,
  sale_date,
  payment_method,
  net_sales_cents,
  transaction_count,
  source,
  source_row_hash,
  raw_payload
)
values (
  '79500000-0000-4000-8000-000000000001',
  '79300000-0000-4000-8000-000000000001',
  '79200000-0000-4000-8000-000000000001',
  current_date,
  'cash',
  700,
  1,
  'sample_seed',
  'official-action-safety-cash-sale',
  '{"fixture":"official-action-safety"}'::jsonb
);

insert into public.refund_cases (
  id,
  public_reference,
  reporting_machine_id,
  reporting_location_id,
  customer_email,
  zelle_payment_contact,
  issue_summary,
  incident_at,
  payment_method,
  payment_amount_cents,
  card_last4,
  status,
  correlation_status,
  correlation_source,
  correlation_confidence,
  matched_sales_fact_id,
  decision,
  decision_reason,
  decided_by,
  decided_at,
  refund_amount_cents,
  matched_nayax_transaction_id,
  matched_nayax_site_id,
  matched_nayax_machine_auth_time,
  matched_nayax_amount_cents,
  matched_nayax_card_last4,
  matched_nayax_currency_code,
  nayax_recommendation_state,
  nayax_recommendation_policy_version,
  nayax_recommendation_evaluated_at,
  nayax_match_execution_eligible
)
values
  (
    '79600000-0000-4000-8000-000000000001', 'RF-OFFICIAL-APPROVE',
    '79300000-0000-4000-8000-000000000001', '79200000-0000-4000-8000-000000000001',
    'approve-customer@example.test', 'synthetic-zelle-contact', 'Approval safety fixture',
    now() - interval '2 hours', 'cash', 700, null, 'needs_review', 'matched', 'sunze', 0.95,
    '79500000-0000-4000-8000-000000000001', null, null, null, null, 700,
    null, null, null, null, null, null, null, null, null, false
  ),
  (
    '79600000-0000-4000-8000-000000000002', 'RF-OFFICIAL-STALE',
    '79300000-0000-4000-8000-000000000001', '79200000-0000-4000-8000-000000000001',
    'stale-customer@example.test', 'synthetic-zelle-contact', 'Stale case safety fixture',
    now() - interval '2 hours', 'cash', 600, null, 'needs_review', 'matched', 'sunze', 0.95,
    '79500000-0000-4000-8000-000000000001', null, null, null, null, 600,
    null, null, null, null, null, null, null, null, null, false
  ),
  (
    '79600000-0000-4000-8000-000000000003', 'RF-OFFICIAL-MAPPING',
    '79300000-0000-4000-8000-000000000001', '79200000-0000-4000-8000-000000000001',
    'mapping-customer@example.test', 'synthetic-zelle-contact', 'Mapping revision safety fixture',
    now() - interval '2 hours', 'cash', 650, null, 'needs_review', 'matched', 'sunze', 0.95,
    '79500000-0000-4000-8000-000000000001', null, null, null, null, 650,
    null, null, null, null, null, null, null, null, null, false
  ),
  (
    '79600000-0000-4000-8000-000000000004', 'RF-OFFICIAL-EXPIRE',
    '79300000-0000-4000-8000-000000000001', '79200000-0000-4000-8000-000000000001',
    'expire-customer@example.test', 'synthetic-zelle-contact', 'Expiry safety fixture',
    now() - interval '2 hours', 'cash', 675, null, 'needs_review', 'matched', 'sunze', 0.95,
    '79500000-0000-4000-8000-000000000001', null, null, null, null, 675,
    null, null, null, null, null, null, null, null, null, false
  ),
  (
    '79600000-0000-4000-8000-000000000005', 'RF-OFFICIAL-TRIAGE',
    '79300000-0000-4000-8000-000000000001', '79200000-0000-4000-8000-000000000001',
    'triage-customer@example.test', 'synthetic-zelle-contact', 'Triage safety fixture',
    now() - interval '2 hours', 'cash', 550, null, 'needs_review', 'matched', 'sunze', 0.95,
    '79500000-0000-4000-8000-000000000001', null, null, null, null, 550,
    null, null, null, null, null, null, null, null, null, false
  ),
  (
    '79600000-0000-4000-8000-000000000006', 'RF-OFFICIAL-CASH',
    '79300000-0000-4000-8000-000000000001', '79200000-0000-4000-8000-000000000001',
    'cash-customer@example.test', 'synthetic-zelle-contact', 'Cash completion safety fixture',
    now() - interval '2 hours', 'cash', 725, null, 'cash_zelle_pending', 'matched', 'sunze', 0.95,
    '79500000-0000-4000-8000-000000000001', 'approved', 'Matched cash sale.',
    '79000000-0000-4000-8000-000000000001', now() - interval '1 hour', 725,
    null, null, null, null, null, null, null, null, null, false
  ),
  (
    '79600000-0000-4000-8000-000000000007', 'RF-OFFICIAL-NAYAX',
    '79300000-0000-4000-8000-000000000001', '79200000-0000-4000-8000-000000000001',
    'card-customer@example.test', null, 'Nayax execution safety fixture',
    now() - interval '2 hours', 'card', 500, '4242', 'card_refund_pending', 'matched', 'nayax', 0,
    null, 'approved', 'Matched card sale.', '79000000-0000-4000-8000-000000000001',
    now() - interval '1 hour', 500, 'SAFE-TXN-79600007', 17, now() - interval '2 hours', 500,
    '4242', 'USD', 'high_confidence', 'official-action-test.v1', now(), true
  ),
  (
    '79600000-0000-4000-8000-000000000008', 'RF-OFFICIAL-DECLINE',
    '79300000-0000-4000-8000-000000000001', '79200000-0000-4000-8000-000000000001',
    'decline-customer@example.test', 'synthetic-zelle-contact', 'Decline safety fixture',
    now() - interval '2 hours', 'cash', 525, null, 'needs_review', 'no_match', null, 0,
    null, null, null, null, null, 525,
    null, null, null, null, null, null, null, null, null, false
  ),
  (
    '79600000-0000-4000-8000-000000000009', 'RF-OFFICIAL-CANDIDATE',
    '79300000-0000-4000-8000-000000000001', '79200000-0000-4000-8000-000000000001',
    'candidate-customer@example.test', null, 'Candidate immutability safety fixture',
    date_trunc('second',now() - interval '90 minutes'), 'card', 440, '4242', 'needs_review', 'needs_nayax', null, 0,
    null, null, null, null, null, 450,
    null, null, null, null, null, null, null, null, null, false
  ),
  (
    '79600000-0000-4000-8000-000000000010', 'RF-OFFICIAL-WALLET',
    '79300000-0000-4000-8000-000000000001', '79200000-0000-4000-8000-000000000001',
    'wallet-official-customer@example.test', null, 'Official wallet correction lock fixture',
    now() - interval '2 hours', 'card', 575, '4242', 'card_refund_pending', 'matched', 'nayax', 0,
    null, 'approved', 'Matched wallet sale.', '79000000-0000-4000-8000-000000000001',
    now() - interval '1 hour', 575, 'SAFE-TXN-79600010', 17, now() - interval '2 hours', 575,
    '4242', 'USD', 'high_confidence', 'official-action-test.v1', now(), false
  ),
  (
    '79600000-0000-4000-8000-000000000011', 'RF-OFFICIAL-CLOSED',
    '79300000-0000-4000-8000-000000000001', '79200000-0000-4000-8000-000000000001',
    'closed-customer@example.test', 'synthetic-zelle-contact', 'Closed case service bypass fixture',
    now() - interval '3 hours', 'cash', 800, null, 'closed', 'matched', 'sunze', 0.95,
    '79500000-0000-4000-8000-000000000001', 'approved', 'Already completed.',
    '79000000-0000-4000-8000-000000000001', now() - interval '2 hours', 800,
    null, null, null, null, null, null, null, null, null, false
  );

update public.refund_cases
set
  card_wallet_used = true,
  wallet_correction_version = 2,
  wallet_correction_state = 'sent'
where id = '79600000-0000-4000-8000-000000000010';

update public.refund_cases
set customer_request_received_at = now() - interval '30 minutes',
    customer_request_received_source = 'hosted_refund_intake',
    incident_time_resolution = 'exact',
    incident_time_confidence = 'exact'
where id = '79600000-0000-4000-8000-000000000009';

insert into public.refund_wallet_correction_contexts (
  id,
  refund_case_id,
  token_hash,
  version,
  status,
  issued_at,
  expires_at
)
values (
  '79800000-0000-4000-8000-000000000001',
  '79600000-0000-4000-8000-000000000010',
  repeat('a', 64),
  2,
  'pending',
  statement_timestamp() - interval '1 hour',
  statement_timestamp() + interval '1 hour'
);

insert into public.refund_nayax_lookup_candidates (
  token,
  refund_case_id,
  actor_user_id,
  reporting_machine_id,
  provider_transaction_id,
  site_id,
  machine_authorization_time,
  amount_cents,
  card_last4,
  currency_code,
  evidence_summary,
  expires_at,
  created_at
)
values (
  '79700000-0000-4000-8000-000000000001',
  '79600000-0000-4000-8000-000000000009',
  '79000000-0000-4000-8000-000000000001',
  '79300000-0000-4000-8000-000000000001',
  'SAFE-TXN-79600009',
  17,
  date_trunc('second',now() - interval '90 minutes'),
  450,
  '4242',
  'USD',
  jsonb_build_object(
    'selection_allowed', true,
    'is_recommended', false,
    'one_click_eligible', false,
    'recommendation_state', 'manual_exception',
    'policy_version', '2026-09-05.v11',
    'identifier_policy_version', '2026-09-05.identifier.v1',
    'customer_fact_version', (
      select deterministic_fact_version from public.refund_cases
      where id = '79600000-0000-4000-8000-000000000009'
    ),
    'customer_credential_class', 'customer_identifier_unknown',
    'provider_identifier_class', 'last_sales_identifier_unknown',
    'card_last4_comparison', 'exact_support',
    'card_network_comparison', 'missing',
    'payment_interaction_comparison', 'unknown',
    'same_identifier_equivalence_proven', false,
    'identifier_review_state', 'exact_support',
    'customer_correction_fields', '[]'::jsonb,
    'hard_exclusions', '[]'::jsonb,
    'reason_codes', '[]'::jsonb,
    'lookup_account_scope', 'ACCOUNT_793',
    'lookup_provider_machine_id', 'MACHINE-793',
    'provider_machine_id', 'MACHINE-793',
    'machine_authorization_time_raw', to_char(date_trunc('second',now() - interval '90 minutes') at time zone 'America/Los_Angeles', 'YYYY-MM-DD"T"HH24:MI:SS'),
    'machine_authorization_at', date_trunc('second',now() - interval '90 minutes'),
    'machine_authorization_time_source', 'MachineAuthorizationTime',
    'machine_time_resolution', 'exact',
    'provider_time_resolution', 'exact',
    'provider_time_source', 'authorization_gmt',
    'authorized_at', date_trunc('second',now() - interval '90 minutes'),
    'customer_request_received_at', now() - interval '30 minutes',
    'customer_request_received_source', 'hosted_refund_intake',
    'request_time_boundary', 'occurrence_time_uncertain',
    'transaction_occurrence_comparable', false,
    'transaction_occurrence_semantics','unknown',
    'transaction_occurrence_proof_source','null'::jsonb,
    'transaction_occurrence_timestamp_source','null'::jsonb,
    'transaction_occurrence_timezone_basis','null'::jsonb,
    'transaction_occurrence_lower_bound_at','null'::jsonb,
    'transaction_occurrence_upper_bound_at','null'::jsonb,
    'request_receipt_lower_bound_at','null'::jsonb,
    'request_receipt_upper_bound_at','null'::jsonb,
    'payment_status', 'approved',
    'payment_status_evidence', 'last_sales_contract',
    'provider_refund_state', 'clear',
    'duplicate_provider_record', false,
    'amount_delta_cents', 10,
    'time_delta_minutes', null,
    'provider_processing_time_delta_minutes',0,
    'provider_payload_redacted', true
  ),
  now() + interval '1 hour',
  now() - interval '1 minute'
);

select has_column(
  'public',
  'reporting_machine_refund_managers',
  'mapping_version',
  'Machine Manager mappings carry a monotonic revision'
);

select ok(
  public.refund_official_action_context_hash(
    'approve', 'cash_zelle_pending', 'approved', null, null, null,
    700, null, null, false, null, null
  ) ~ '^[a-f0-9]{64}$',
  'Official-action payload integrity uses a 64-hex SHA-256 digest'
);

select isnt(
  public.refund_official_action_context_hash(
    'approve', 'cash_zelle_pending', 'approved', null, 'a|b', 'c',
    700, null, null, false, null, null
  ),
  public.refund_official_action_context_hash(
    'approve', 'cash_zelle_pending', 'approved', null, 'a', 'b|c',
    700, null, null, false, null, null
  ),
  'Structured JSON hashing cannot confuse delimiter-shaped action fields'
);

select has_column(
  'public',
  'refund_cases',
  'official_action_version',
  'Refund cases carry an official-action review revision'
);

select ok(
  has_function_privilege(
    'authenticated',
    'public.admin_authorize_refund_official_action(uuid,text,bigint,text,text,text,text,text,integer,text,timestamp with time zone,boolean,uuid,text)',
    'execute'
  )
  and not has_function_privilege(
    'anon',
    'public.admin_authorize_refund_official_action(uuid,text,bigint,text,text,text,text,text,integer,text,timestamp with time zone,boolean,uuid,text)',
    'execute'
  )
  and not has_function_privilege(
    'service_role',
    'public.admin_authorize_refund_official_action(uuid,text,bigint,text,text,text,text,text,integer,text,timestamp with time zone,boolean,uuid,text)',
    'execute'
  ),
  'Only an authenticated browser session can mint an official-action receipt'
);

select ok(
  has_function_privilege(
    'service_role',
    'public.service_apply_refund_official_case_update(uuid,uuid,text,text,text,text,text,text,integer,text,uuid,text)',
    'execute'
  )
  and not has_function_privilege(
    'authenticated',
    'public.service_apply_refund_official_case_update(uuid,uuid,text,text,text,text,text,text,integer,text,uuid,text)',
    'execute'
  )
  and not has_function_privilege(
    'service_role',
    'public.service_complete_cash_refund_as_actor(uuid,uuid,integer,text,timestamp with time zone,text,text,text)',
    'execute'
  )
  and not has_function_privilege(
    'service_role',
    'public.admin_update_refund_case(uuid,text,text,text,text,text,integer,text,boolean,text,integer,timestamp with time zone,integer,text,text)',
    'execute'
  )
  and not has_function_privilege(
    'authenticated',
    'public.admin_update_refund_case(uuid,text,text,text,text,text,integer,text,boolean,text,integer,timestamp with time zone,integer,text,text)',
    'execute'
  )
  and to_regprocedure(
    'public.service_finalize_nayax_refund_official_action(uuid,uuid,text,text)'
  ) is null,
  'Service workflows can consume receipts but no provider-success finalizer exists'
);

select ok(
  public.refund_official_actions_enabled(),
  'Official refund actions are enabled by the reviewed manager-session cutover'
);

set local role authenticated;
select pg_temp.set_auth_claims(
  '79000000-0000-4000-8000-000000000001',
  'aal2',
  'totp',
  extract(epoch from statement_timestamp())
);
select is(
  (public.admin_authorize_refund_official_action(
      '79600000-0000-4000-8000-000000000001', 'approve',
      (select official_action_version from public.refund_cases where id = '79600000-0000-4000-8000-000000000001'),
      'cash_zelle_pending', 'approved', null, null, null, 700, null, null, false, null, null
    ) ->> 'authorizationMethod'),
  'manager_session',
  'A mapped signed-in manager receives a session-bound receipt without TOTP'
);
reset role;

-- The remainder exercises the future #692 protocol behind an explicit
-- transaction-local test replacement. ROLLBACK restores the production-false
-- implementation from the migration.
create or replace function public.refund_official_actions_enabled()
returns boolean
language sql
immutable
set search_path = public
as $$
  select true;
$$;

set local role authenticated;
select pg_temp.set_auth_claims(
  '79000000-0000-4000-8000-000000000001',
  'aal1',
  'totp',
  extract(epoch from statement_timestamp())
);
select is(
  (public.admin_authorize_refund_official_action(
      '79600000-0000-4000-8000-000000000001', 'approve', 1,
      'cash_zelle_pending', 'approved', null, null, null, 700, null, null, false, null, null
    ) ->> 'authorizationMethod'),
  'manager_session',
  'AAL1 mapped-manager sessions use the same exact server-side receipt boundary'
);

select pg_temp.set_auth_claims(
  '79000000-0000-4000-8000-000000000001',
  'aal2',
  'password',
  extract(epoch from statement_timestamp())
);
select is(
  (public.admin_authorize_refund_official_action(
      '79600000-0000-4000-8000-000000000001', 'approve', 1,
      'cash_zelle_pending', 'approved', null, null, null, 700, null, null, false, null, null
    ) ->> 'authorizationMethod'),
  'manager_session',
  'Manager-session receipts do not depend on a TOTP AMR entry'
);

select pg_temp.set_auth_claims(
  '79000000-0000-4000-8000-000000000001',
  'aal2',
  'totp',
  extract(epoch from statement_timestamp() - interval '3 minutes')
);
select is(
  (public.admin_authorize_refund_official_action(
      '79600000-0000-4000-8000-000000000001', 'approve', 1,
      'cash_zelle_pending', 'approved', null, null, null, 700, null, null, false, null, null
    ) ->> 'authorizationMethod'),
  'manager_session',
  'A mapped manager session ignores historical TOTP freshness metadata'
);
reset role;

delete from public.refund_case_official_action_authorizations
where actor_user_id = '79000000-0000-4000-8000-000000000001'
  and refund_case_id = '79600000-0000-4000-8000-000000000001';

set local role authenticated;
select pg_temp.set_auth_claims(
  '79000000-0000-4000-8000-000000000001', 'aal2', 'totp',
  extract(epoch from statement_timestamp())
);
select ok(
  pg_temp.capture_error($sql$
    select public.admin_prepare_refund_action_step_up_intent(
      '79600000-0000-4000-8000-000000000001', 'approve', 'refund-case-admin-update',
      (select official_action_version from public.refund_cases where id = '79600000-0000-4000-8000-000000000001'),
      'card_refund_pending', 'approved', null, null, null, 700, null, null, false, null, null
    )
  $sql$) like '%Cash approval must enter the cash refund pending state%'
  and pg_temp.capture_error($sql$
    select public.admin_prepare_refund_action_step_up_intent(
      '79600000-0000-4000-8000-000000000009', 'approve', 'refund-case-admin-update',
      (select official_action_version from public.refund_cases where id = '79600000-0000-4000-8000-000000000009'),
      'cash_zelle_pending', 'approved', null, null, null, 450, null, null, false, null, null
    )
  $sql$) like '%Card approval must enter the card refund pending state%',
  'Approval receipts cannot place cash and card cases into each other''s payment states'
);

select ok(
  pg_temp.capture_error($sql$
    select public.admin_prepare_refund_action_step_up_intent(
      '79600000-0000-4000-8000-000000000001', 'approve', 'refund-case-admin-update', 1,
      'cash_zelle_pending', 'approved', null, null, null, 0, null, null, false, null, null
    )
  $sql$) like '%positive reviewed refund amount%'
  and pg_temp.capture_error($sql$
    select public.admin_prepare_refund_action_step_up_intent(
      '79600000-0000-4000-8000-000000000001', 'approve', 'refund-case-admin-update', 1,
      'cash_zelle_pending', 'approved', null, null, null, null, null, null, false, null, null
    )
  $sql$) like '%positive reviewed refund amount%',
  'Approve receipts require an exact positive reviewed refund amount'
);
reset role;

insert into public.refund_manager_totp_enrollments (
  actor_user_id,
  approved_factor_binding_hash,
  owner_approved_by_user_id,
  owner_approval_version,
  enrollment_version
) values
  (
    '79000000-0000-4000-8000-000000000001',
    repeat('c', 64),
    '79000000-0000-4000-8000-000000000002',
    1,
    1
  ),
  (
    '79000000-0000-4000-8000-000000000002',
    repeat('c', 64),
    '79000000-0000-4000-8000-000000000002',
    2,
    1
  ),
  (
    '79000000-0000-4000-8000-000000000003',
    repeat('c', 64),
    '79000000-0000-4000-8000-000000000002',
    3,
    1
  );

-- The remaining #689 regression assertions need receipts. Route their legacy
-- test helper through the new #692 prepare/verify/consume protocol. This
-- transaction-local replacement rolls back with the test.
create or replace function public.admin_authorize_refund_official_action(
  p_case_id uuid,
  p_action text,
  p_expected_case_version bigint,
  p_target_status text default null,
  p_target_decision text default null,
  p_assigned_manager_email text default null,
  p_decision_reason text default null,
  p_internal_note text default null,
  p_refund_amount_cents integer default null,
  p_manual_refund_reference text default null,
  p_cash_payout_sent_at timestamptz default null,
  p_cash_payment_confirmed boolean default false,
  p_matched_nayax_candidate_token uuid default null,
  p_nayax_disagreement_reason text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public, auth, pg_temp
as $$
declare
  actor_user_id uuid := auth.uid();
  intent jsonb;
  factor_marker jsonb;
  target_function text := case
    when lower(btrim(coalesce(p_action, ''))) = 'nayax_execute'
      then 'nayax-card-refund'
    else 'refund-case-admin-update'
  end;
begin
  intent := public.admin_prepare_refund_action_step_up_intent(
    p_case_id,
    p_action,
    target_function,
    p_expected_case_version,
    p_target_status,
    p_target_decision,
    p_assigned_manager_email,
    p_decision_reason,
    p_internal_note,
    p_refund_amount_cents,
    p_manual_refund_reference,
    p_cash_payout_sent_at,
    p_cash_payment_confirmed,
    p_matched_nayax_candidate_token,
    p_nayax_disagreement_reason
  );
  perform set_config('request.jwt.claim.sub', '', true);
  perform set_config('request.jwt.claim.role', 'service_role', true);
  perform set_config('request.jwt.claims', '{"role":"service_role"}', true);
  factor_marker := public.service_mark_refund_manager_step_up_factor_verified(
    actor_user_id,
    (intent ->> 'intentId')::uuid,
    repeat('c', 64)
  );
  perform pg_temp.set_auth_claims(
    actor_user_id,
    'aal2',
    'totp',
    extract(epoch from statement_timestamp() + interval '1 second')
  );
  return public.admin_consume_refund_action_step_up_intent(
    (intent ->> 'intentId')::uuid,
    p_case_id,
    p_action,
    target_function,
    p_expected_case_version,
    p_target_status,
    p_target_decision,
    p_assigned_manager_email,
    p_decision_reason,
    p_internal_note,
    p_refund_amount_cents,
    p_manual_refund_reference,
    p_cash_payout_sent_at,
    p_cash_payment_confirmed,
    p_matched_nayax_candidate_token,
    p_nayax_disagreement_reason,
    factor_marker ->> 'factorVerificationProof'
  );
end;
$$;

select ok(
  public.can_perform_refund_official_action(
    '79000000-0000-4000-8000-000000000001',
    '79600000-0000-4000-8000-000000000001'
  ),
  'An active mapped Machine Manager can perform official actions'
);

select ok(
  public.can_manage_refund_case(
    '79000000-0000-4000-8000-000000000002',
    '79600000-0000-4000-8000-000000000001'
  )
  and public.can_perform_refund_official_action(
    '79000000-0000-4000-8000-000000000002',
    '79600000-0000-4000-8000-000000000001'
  ),
  'A mapped Super Admin receives official-action authority only from the exact Machine Manager mapping'
);

select ok(
  public.can_manage_refund_case(
    '79000000-0000-4000-8000-000000000003',
    '79600000-0000-4000-8000-000000000001'
  )
  and public.can_perform_refund_official_action(
    '79000000-0000-4000-8000-000000000003',
    '79600000-0000-4000-8000-000000000001'
  ),
  'A mapped Scoped Admin receives official-action authority only from the exact Machine Manager mapping'
);

select ok(
  public.can_manage_refund_case(
    '79000000-0000-4000-8000-000000000004',
    '79600000-0000-4000-8000-000000000001'
  )
  and not public.can_perform_refund_official_action(
    '79000000-0000-4000-8000-000000000004',
    '79600000-0000-4000-8000-000000000001'
  ),
  'Admin access can review but cannot perform an official action without an exact Machine Manager mapping'
);

set local role service_role;
select ok(
  pg_temp.capture_error($sql$
    update public.refund_cases
    set status = 'card_refund_pending',
        decision = 'approved'
    where id = '79600000-0000-4000-8000-000000000005'
  $sql$) like '%Official refund transitions require a browser-authenticated Machine Manager receipt%'
  and exists (
    select 1
    from public.refund_cases
    where id = '79600000-0000-4000-8000-000000000005'
      and status = 'needs_review'
      and decision is null
  ),
  'A raw service-role table update cannot proxy an official refund transition'
);
reset role;

set local role service_role;
select ok(
  pg_temp.capture_error($sql$
    insert into public.refund_cases (
      id, public_reference, reporting_machine_id, reporting_location_id,
      customer_email, issue_summary, incident_at, payment_method,
      payment_amount_cents, status, correlation_status, decision,
      decided_by, decided_at, refund_amount_cents
    ) values (
      '79600000-0000-4000-8000-000000000012', 'RF-RAW-OFFICIAL-INSERT',
      '79300000-0000-4000-8000-000000000001', '79200000-0000-4000-8000-000000000001',
      'raw-insert@example.test', 'Raw official insert attempt', statement_timestamp(),
      'cash', 500, 'approved', 'matched', 'approved',
      '79000000-0000-4000-8000-000000000001', statement_timestamp(), 500
    )
  $sql$) like '%Official refund state cannot be inserted by a browser or service identity%'
  and not exists (
    select 1 from public.refund_cases
    where id = '79600000-0000-4000-8000-000000000012'
  ),
  'A raw service identity cannot insert a pre-approved refund case'
);

select ok(
  pg_temp.capture_error($sql$
    update public.refund_cases
    set nayax_match_execution_eligible = true
    where id = '79600000-0000-4000-8000-000000000005'
  $sql$) like '%Official refund transitions require a browser-authenticated Machine Manager receipt%'
  and not (select nayax_match_execution_eligible from public.refund_cases where id = '79600000-0000-4000-8000-000000000005'),
  'A raw service identity cannot elevate pre-review Nayax execution eligibility'
);

select ok(
  pg_temp.capture_error($sql$
    update public.refund_cases
    set
      matched_nayax_transaction_id = 'SWAPPED-TXN-79600007',
      correlation_summary = 'Swapped after approval.'
    where id = '79600000-0000-4000-8000-000000000007'
  $sql$) like '%Official refund transitions require a browser-authenticated Machine Manager receipt%'
  and (
    select matched_nayax_transaction_id = 'SAFE-TXN-79600007'
      and correlation_summary is distinct from 'Swapped after approval.'
    from public.refund_cases
    where id = '79600000-0000-4000-8000-000000000007'
  ),
  'Approved match and correlation evidence cannot be swapped by a raw service identity'
);

select lives_ok(
  $sql$
    update public.refund_cases
    set
      correlation_status = 'needs_nayax',
      correlation_source = null,
      correlation_confidence = 0,
      correlation_summary = 'No safe recommendation yet.',
      nayax_recommendation_state = 'no_safe_match',
      nayax_recommendation_policy_version = 'official-action-test.v1',
      nayax_recommendation_evaluated_at = statement_timestamp(),
      nayax_match_execution_eligible = false
    where id = '79600000-0000-4000-8000-000000000005'
  $sql$,
  'Legitimate non-official recommendation preparation remains available to the service'
);

select ok(
  pg_temp.capture_error($sql$
    insert into public.refund_case_events (
      refund_case_id, actor_user_id, event_type, message, metadata
    ) values (
      '79600000-0000-4000-8000-000000000005',
      '79000000-0000-4000-8000-000000000001',
      'nayax_match_selected',
      'Spoofed manager evidence.',
      '{"payload_redacted":true}'::jsonb
    )
  $sql$) like '%Official refund audit events are wrapper-owned and append-only%'
  and pg_temp.capture_error($sql$
    insert into public.refund_case_events (
      refund_case_id, actor_user_id, event_type, message, metadata
    ) values (
      '79600000-0000-4000-8000-000000000005',
      '79000000-0000-4000-8000-000000000001',
      'nayax_official_action_finalized',
      'Spoofed provider success.',
      '{"payload_redacted":true}'::jsonb
    )
  $sql$) like '%Official refund audit events are wrapper-owned and append-only%',
  'A raw service identity cannot spoof manager evidence or a provider-success event'
);

select ok(
  pg_temp.capture_error($sql$
    select public.service_update_refund_case_as_actor(
      '79000000-0000-4000-8000-000000000001',
      '79600000-0000-4000-8000-000000000011',
      'needs_review', null, null, null, 'Attempted closed-case reopen.', 800, null,
      false, null, null, null, null, null, null
    )
  $sql$) like '%Official refund actions require a browser-authenticated Machine Manager authorization%'
  and (select status = 'closed' from public.refund_cases where id = '79600000-0000-4000-8000-000000000011'),
  'The legacy SECURITY DEFINER wrapper cannot reopen a closed official case'
);

select ok(
  pg_temp.capture_error($sql$
    select public.service_issue_refund_wallet_correction(
      '79600000-0000-4000-8000-000000000010', repeat('b', 64),
      statement_timestamp() + interval '1 hour'
    )
  $sql$) like '%can no longer be corrected%'
  and pg_temp.capture_error($sql$
    select public.service_apply_refund_wallet_correction(
      repeat('a', 64), 'apple_pay', '1111',
      statement_timestamp() - interval '2 hours', '2026-08-03T09:00', true
    )
  $sql$) like '%can no longer be corrected%'
  and pg_temp.capture_error($sql$
    select public.service_cancel_refund_wallet_correction(repeat('a', 64))
  $sql$) like '%can no longer be corrected%'
  and public.service_get_refund_wallet_correction(repeat('a', 64)) ->> 'state' = 'invalid'
  and (
    select status = 'card_refund_pending' and decision = 'approved'
    from public.refund_cases
    where id = '79600000-0000-4000-8000-000000000010'
  )
  and (
    select status = 'pending'
    from public.refund_wallet_correction_contexts
    where id = '79800000-0000-4000-8000-000000000001'
  ),
  'Stale wallet SECURITY DEFINER paths cannot issue, apply, cancel, reveal, or mutate an official case'
);
reset role;

update public.refund_wallet_correction_contexts
set expires_at = statement_timestamp() - interval '1 minute'
where id = '79800000-0000-4000-8000-000000000001';

set local role service_role;
select ok(
  public.service_get_refund_wallet_correction(repeat('a', 64)) ->> 'state' = 'invalid'
  and (
    select status = 'card_refund_pending' and decision = 'approved'
    from public.refund_cases
    where id = '79600000-0000-4000-8000-000000000010'
  )
  and (
    select status = 'pending'
    from public.refund_wallet_correction_contexts
    where id = '79800000-0000-4000-8000-000000000001'
  ),
  'Expired version-two wallet lookup cannot reopen an official case or mutate its token state'
);
reset role;

set local role authenticated;
select pg_temp.set_auth_claims(
  '79000000-0000-4000-8000-000000000001', 'aal2', 'totp',
  extract(epoch from statement_timestamp())
);

insert into pg_temp.official_action_test_receipts (receipt_key, authorization_id)
select
  'approve',
  (public.admin_authorize_refund_official_action(
    '79600000-0000-4000-8000-000000000001',
    'approve',
    (select official_action_version from public.refund_cases where id = '79600000-0000-4000-8000-000000000001'),
    'cash_zelle_pending',
    'approved',
    'official-manager@example.test',
    'Matched cash sale.',
    'Synthetic review note.',
    700,
    null,
    null,
    false,
    null,
    null
  ) ->> 'authorizationId')::uuid;

reset role;

select is(
  (
    select actor_user_id
    from public.refund_case_official_action_authorizations
    where id = (select authorization_id from pg_temp.official_action_test_receipts where receipt_key = 'approve')
  ),
  '79000000-0000-4000-8000-000000000001'::uuid,
  'The receipt actor is derived from auth.uid()'
);

set local role service_role;
select public.service_apply_refund_official_case_update(
  (select authorization_id from pg_temp.official_action_test_receipts where receipt_key = 'approve'),
  '79600000-0000-4000-8000-000000000001',
  'approve',
  'cash_zelle_pending',
  'official-manager@example.test',
  'approved',
  'Matched cash sale.',
  'Synthetic review note.',
  700,
  null,
  null,
  null
);
reset role;

select is(
  (
    select status || ':' || decision || ':' || decided_by::text
    from public.refund_cases
    where id = '79600000-0000-4000-8000-000000000001'
  ),
  'cash_zelle_pending:approved:79000000-0000-4000-8000-000000000001',
  'A consumed approval receipt commits the exact action as the mapped manager'
);

select ok(
  exists (
    select 1
    from public.refund_case_events
    where refund_case_id = '79600000-0000-4000-8000-000000000001'
      and event_type = 'official_action_committed'
      and actor_user_id = '79000000-0000-4000-8000-000000000001'
      and metadata ->> 'manager_mapping_id' = '79400000-0000-4000-8000-000000000001'
      and (metadata ->> 'manager_mapping_version')::bigint > 0
      and metadata ->> 'payload_redacted' = 'true'
      and not (metadata ? 'authorization_id')
      and not (metadata ? 'authorizationId')
      and metadata::text not like '%' || (
        select authorization_id::text
        from pg_temp.official_action_test_receipts
        where receipt_key = 'approve'
      ) || '%'
      and metadata::text not like '%approve-customer@example.test%'
      and metadata::text not like '%SAFE-TXN%'
  ),
  'Official audit evidence records actor and mapping revision without customer or provider payloads'
);

set local role service_role;
select ok(
  pg_temp.capture_error($sql$
    update public.refund_case_events
    set message = 'Rewritten official evidence.'
    where refund_case_id = '79600000-0000-4000-8000-000000000001'
      and event_type = 'official_action_committed'
  $sql$) is not null
  and pg_temp.capture_error($sql$
    delete from public.refund_case_events
    where refund_case_id = '79600000-0000-4000-8000-000000000001'
      and event_type = 'official_action_committed'
  $sql$) is not null
  and exists (
    select 1 from public.refund_case_events
    where refund_case_id = '79600000-0000-4000-8000-000000000001'
      and event_type = 'official_action_committed'
  ),
  'Wrapper-owned official audit evidence is append-only for service identities'
);

select ok(
  pg_temp.capture_error($sql$
    select public.service_apply_refund_official_case_update(
      (select authorization_id from pg_temp.official_action_test_receipts where receipt_key = 'approve'),
      '79600000-0000-4000-8000-000000000001', 'approve', 'cash_zelle_pending',
      'official-manager@example.test', 'approved', 'Matched cash sale.', 'Synthetic review note.',
      700, null, null, null
    )
  $sql$) like '%already used%',
  'An official-action receipt cannot be replayed'
);
reset role;

set local role authenticated;
select pg_temp.set_auth_claims(
  '79000000-0000-4000-8000-000000000001', 'aal2', 'totp',
  extract(epoch from statement_timestamp())
);
select ok(
  pg_temp.capture_error($sql$
    select public.admin_authorize_refund_official_action(
      '79600000-0000-4000-8000-000000000002', 'approve', 999,
      'cash_zelle_pending', 'approved', null, null, null, 600, null, null, false, null, null
    )
  $sql$) like '%changed since review%',
  'A stale browser case revision cannot mint a receipt'
);

select pg_temp.set_auth_claims(
  '79000000-0000-4000-8000-000000000002', 'aal2', 'totp',
  extract(epoch from statement_timestamp())
);
select lives_ok(
$sql$
    select public.admin_authorize_refund_official_action(
      '79600000-0000-4000-8000-000000000002', 'approve',
      (select official_action_version from public.refund_cases where id = '79600000-0000-4000-8000-000000000002'),
      'cash_zelle_pending', 'approved', null, null, null, 600, null, null, false, null, null
    )
$sql$,
  'A mapped Super Admin can mint a Machine Manager receipt after the same owner-approved step-up'
);

select pg_temp.set_auth_claims(
  '79000000-0000-4000-8000-000000000003', 'aal2', 'totp',
  extract(epoch from statement_timestamp())
);
select lives_ok(
$sql$
    select public.admin_authorize_refund_official_action(
      '79600000-0000-4000-8000-000000000002', 'approve',
      (select official_action_version from public.refund_cases where id = '79600000-0000-4000-8000-000000000002'),
      'cash_zelle_pending', 'approved', null, null, null, 600, null, null, false, null, null
    )
$sql$,
  'A mapped Scoped Admin can mint a Machine Manager receipt after the same owner-approved step-up'
);

select pg_temp.set_auth_claims(
  '79000000-0000-4000-8000-000000000001', 'aal2', 'totp',
  extract(epoch from statement_timestamp())
);
insert into pg_temp.official_action_test_receipts (receipt_key, authorization_id)
select
  'case_changed',
  (public.admin_authorize_refund_official_action(
    '79600000-0000-4000-8000-000000000002', 'approve',
    (select official_action_version from public.refund_cases where id = '79600000-0000-4000-8000-000000000002'),
    'cash_zelle_pending', 'approved', null, null, null, 600, null, null, false, null, null
  ) ->> 'authorizationId')::uuid;
reset role;

update public.refund_cases
set
  customer_email = 'changed-after-review@example.test',
  customer_name = 'Changed after review',
  incident_local_datetime = '2026-08-03T09:15',
  incident_timezone = 'America/Los_Angeles',
  incident_time_resolution = 'exact'
where id = '79600000-0000-4000-8000-000000000002';

set local role service_role;
select ok(
  pg_temp.capture_error($sql$
    select public.service_apply_refund_official_case_update(
      (select authorization_id from pg_temp.official_action_test_receipts where receipt_key = 'case_changed'),
      '79600000-0000-4000-8000-000000000002', 'approve', 'cash_zelle_pending',
      null, 'approved', null, null, 600, null, null, null
    )
  $sql$) like '%changed since authorization%',
  'Customer identity and local incident context changes invalidate a minted receipt'
);
reset role;

set local role authenticated;
select pg_temp.set_auth_claims(
  '79000000-0000-4000-8000-000000000001', 'aal2', 'totp',
  extract(epoch from statement_timestamp())
);
insert into pg_temp.official_action_test_receipts (receipt_key, authorization_id)
select
  'payload_changed',
  (public.admin_authorize_refund_official_action(
    '79600000-0000-4000-8000-000000000004', 'approve',
    (select official_action_version from public.refund_cases where id = '79600000-0000-4000-8000-000000000004'),
    'cash_zelle_pending', 'approved', null, null, null, 675, null, null, false, null, null
  ) ->> 'authorizationId')::uuid;
reset role;

set local role service_role;
select ok(
  pg_temp.capture_error($sql$
    select public.service_apply_refund_official_case_update(
      (select authorization_id from pg_temp.official_action_test_receipts where receipt_key = 'payload_changed'),
      '79600000-0000-4000-8000-000000000004', 'approve', 'cash_zelle_pending',
      null, 'approved', null, 'Changed after browser authorization.', 675, null, null, null
    )
  $sql$) like '%authorization payload changed%',
  'Changing any authorized action field invalidates the SHA-256-bound receipt'
);
reset role;

set local role authenticated;
select pg_temp.set_auth_claims(
  '79000000-0000-4000-8000-000000000001', 'aal2', 'totp',
  extract(epoch from statement_timestamp())
);
insert into pg_temp.official_action_test_receipts (receipt_key, authorization_id)
select
  'admin_changed',
  (public.admin_authorize_refund_official_action(
    '79600000-0000-4000-8000-000000000002', 'approve',
    (select official_action_version from public.refund_cases where id = '79600000-0000-4000-8000-000000000002'),
    'cash_zelle_pending', 'approved', null, null, null, 600, null, null, false, null, null
  ) ->> 'authorizationId')::uuid;
reset role;

insert into public.admin_roles (id, user_id, role, active)
values (
  '79400000-0000-4000-8000-000000000005',
  '79000000-0000-4000-8000-000000000001',
  'super_admin',
  true
);

set local role service_role;
select lives_ok(
$sql$
    select public.service_apply_refund_official_case_update(
      (select authorization_id from pg_temp.official_action_test_receipts where receipt_key = 'admin_changed'),
      '79600000-0000-4000-8000-000000000002', 'approve', 'cash_zelle_pending',
      null, 'approved', null, null, 600, null, null, null
    )
$sql$,
  'A later admin entitlement does not invalidate a receipt whose exact Machine Manager mapping remains current'
);
reset role;

delete from public.admin_roles
where id = '79400000-0000-4000-8000-000000000005';

set local role authenticated;
select pg_temp.set_auth_claims(
  '79000000-0000-4000-8000-000000000001', 'aal2', 'totp',
  extract(epoch from statement_timestamp())
);
insert into pg_temp.official_action_test_receipts (receipt_key, authorization_id)
select
  'candidate_tampered',
  (public.admin_authorize_refund_official_action(
    '79600000-0000-4000-8000-000000000009', 'approve',
    (select official_action_version from public.refund_cases where id = '79600000-0000-4000-8000-000000000009'),
    'card_refund_pending', 'approved', null, null, null, 450, null, null, false,
    '79700000-0000-4000-8000-000000000001', null
  ) ->> 'authorizationId')::uuid;
reset role;

create temporary table candidate_tamper_snapshot as
select *
from public.refund_nayax_lookup_candidates
where token = '79700000-0000-4000-8000-000000000001';
grant select on table pg_temp.candidate_tamper_snapshot to service_role;

set local role service_role;
select ok(
  pg_temp.capture_error($sql$
    update public.refund_nayax_lookup_candidates
    set amount_cents = 451
    where token = '79700000-0000-4000-8000-000000000001'
  $sql$) is not null
  and (
    select amount_cents = 450
    from public.refund_nayax_lookup_candidates
    where token = '79700000-0000-4000-8000-000000000001'
  ),
  'A service identity cannot rewrite reviewed Nayax candidate evidence in place'
);

delete from public.refund_nayax_lookup_candidates
where token = '79700000-0000-4000-8000-000000000001';

insert into public.refund_nayax_lookup_candidates (
  token, refund_case_id, actor_user_id, reporting_machine_id, provider_transaction_id, site_id,
  machine_authorization_time, amount_cents, card_last4, currency_code,
  evidence_summary, expires_at, created_at
)
select
  token, refund_case_id, actor_user_id, reporting_machine_id,
  'SAFE-TXN-79600009-ALTERED', site_id,
  machine_authorization_time, amount_cents, card_last4, currency_code,
  evidence_summary, expires_at, created_at
from pg_temp.candidate_tamper_snapshot;

select ok(
  pg_temp.capture_error($sql$
    select public.service_apply_refund_official_case_update(
      (select authorization_id from pg_temp.official_action_test_receipts where receipt_key = 'candidate_tampered'),
      '79600000-0000-4000-8000-000000000009', 'approve', 'card_refund_pending',
      null, 'approved', null, null, 450, null,
      '79700000-0000-4000-8000-000000000001', null
    )
  $sql$) like '%authorization payload changed%'
  and (select status = 'needs_review' and decision is null from public.refund_cases where id = '79600000-0000-4000-8000-000000000009'),
  'Delete-and-reinsert candidate evidence is detected by the receipt-bound SHA-256 hash'
);
reset role;

set local role authenticated;
select pg_temp.set_auth_claims(
  '79000000-0000-4000-8000-000000000001', 'aal2', 'totp',
  extract(epoch from statement_timestamp())
);
insert into pg_temp.official_action_test_receipts (receipt_key, authorization_id)
select
  'mapping_changed',
  (public.admin_authorize_refund_official_action(
    '79600000-0000-4000-8000-000000000003', 'approve',
    (select official_action_version from public.refund_cases where id = '79600000-0000-4000-8000-000000000003'),
    'cash_zelle_pending', 'approved', null, null, null, 650, null, null, false, null, null
  ) ->> 'authorizationId')::uuid;
reset role;

update public.reporting_machine_refund_managers
set grant_reason = 'Official action safety test revision'
where id = '79400000-0000-4000-8000-000000000001';

set local role service_role;
select ok(
  pg_temp.capture_error($sql$
    select public.service_apply_refund_official_case_update(
      (select authorization_id from pg_temp.official_action_test_receipts where receipt_key = 'mapping_changed'),
      '79600000-0000-4000-8000-000000000003', 'approve', 'cash_zelle_pending',
      null, 'approved', null, null, 650, null, null, null
    )
  $sql$) like '%mapping changed%',
  'A mapping revision between authorization and mutation invalidates the receipt'
);
reset role;

set local role authenticated;
select pg_temp.set_auth_claims(
  '79000000-0000-4000-8000-000000000001', 'aal2', 'totp',
  extract(epoch from statement_timestamp())
);
insert into pg_temp.official_action_test_receipts (receipt_key, authorization_id)
select
  'expired',
  (public.admin_authorize_refund_official_action(
    '79600000-0000-4000-8000-000000000004', 'approve',
    (select official_action_version from public.refund_cases where id = '79600000-0000-4000-8000-000000000004'),
    'cash_zelle_pending', 'approved', null, null, null, 675, null, null, false, null, null
  ) ->> 'authorizationId')::uuid;
reset role;

update public.refund_case_official_action_authorizations
set created_at = statement_timestamp() - interval '10 minutes',
    expires_at = statement_timestamp() - interval '5 minutes'
where id = (select authorization_id from pg_temp.official_action_test_receipts where receipt_key = 'expired');

set local role service_role;
select ok(
  pg_temp.capture_error($sql$
    select public.service_apply_refund_official_case_update(
      (select authorization_id from pg_temp.official_action_test_receipts where receipt_key = 'expired'),
      '79600000-0000-4000-8000-000000000004', 'approve', 'cash_zelle_pending',
      null, 'approved', null, null, 675, null, null, null
    )
  $sql$) like '%authorization expired%',
  'An expired receipt cannot be consumed'
);
reset role;

update public.reporting_machine_refund_managers
set status = 'revoked',
    revoked_at = statement_timestamp(),
    revoked_by = '79000000-0000-4000-8000-000000000002',
    revoke_reason = 'Official action safety test'
where id = '79400000-0000-4000-8000-000000000001';

select ok(
  not public.can_perform_refund_official_action(
    '79000000-0000-4000-8000-000000000001',
    '79600000-0000-4000-8000-000000000004'
  ),
  'A revoked Machine Manager mapping immediately removes official authority'
);

set local role authenticated;
select pg_temp.set_auth_claims(
  '79000000-0000-4000-8000-000000000001', 'aal2', 'totp',
  extract(epoch from statement_timestamp())
);
select ok(
  pg_temp.capture_error($sql$
    select public.admin_authorize_refund_official_action(
      '79600000-0000-4000-8000-000000000004', 'approve',
      1,
      'cash_zelle_pending', 'approved', null, null, null, 675, null, null, false, null, null
    )
  $sql$) like '%Active Machine Manager mapping required%',
  'A revoked manager cannot mint a new receipt'
);
reset role;

update public.reporting_machine_refund_managers
set status = 'active',
    revoked_at = null,
    revoked_by = null,
    revoke_reason = null
where id = '79400000-0000-4000-8000-000000000001';

set local role service_role;
select public.service_update_refund_case_as_actor(
  '79000000-0000-4000-8000-000000000001',
  '79600000-0000-4000-8000-000000000005',
  'waiting_on_customer',
  null, null, null, 'Synthetic triage note.', 550, null,
  false, null, null, null, null, null, null
);
reset role;

select is(
  (select status from public.refund_cases where id = '79600000-0000-4000-8000-000000000005'),
  'needs_review',
  'The legacy service wrapper cannot create unsupported customer waiting'
);

set local role service_role;
select ok(
  pg_temp.capture_error($sql$
    select public.service_update_refund_case_as_actor(
      '79000000-0000-4000-8000-000000000001',
      '79600000-0000-4000-8000-000000000005',
      'approved', null, 'approved', null, null, 550, null,
      false, null, null, null, null, null, null
    )
  $sql$) like '%Official refund actions require a browser-authenticated Machine Manager authorization%',
  'A service identity cannot impersonate a manager to approve through the legacy wrapper'
);
reset role;

select is(
  (select status from public.refund_cases where id = '79600000-0000-4000-8000-000000000005'),
  'needs_review',
  'A rejected service approval leaves the unsupported triage request in manager review'
);

set local role authenticated;
select pg_temp.set_auth_claims(
  '79000000-0000-4000-8000-000000000001', 'aal2', 'totp',
  extract(epoch from statement_timestamp())
);
insert into pg_temp.official_action_test_receipts (receipt_key, authorization_id)
select
  'decline',
  (public.admin_authorize_refund_official_action(
    '79600000-0000-4000-8000-000000000008', 'decline',
    (select official_action_version from public.refund_cases where id = '79600000-0000-4000-8000-000000000008'),
    'denied', 'denied', null, 'We could not find a matching transaction.', null, null,
    null, null, false, null, null
  ) ->> 'authorizationId')::uuid;

insert into pg_temp.official_action_test_receipts (receipt_key, authorization_id)
select
  'decline_parallel',
  (public.admin_authorize_refund_official_action(
    '79600000-0000-4000-8000-000000000008', 'decline',
    (select official_action_version from public.refund_cases where id = '79600000-0000-4000-8000-000000000008'),
    'denied', 'denied', null, 'We could not find a matching transaction.', null, null,
    null, null, false, null, null
  ) ->> 'authorizationId')::uuid;
reset role;

set local role service_role;
select public.service_apply_refund_official_case_update(
  (select authorization_id from pg_temp.official_action_test_receipts where receipt_key = 'decline'),
  '79600000-0000-4000-8000-000000000008', 'decline', 'denied', null, 'denied',
  'We could not find a matching transaction.', null, null, null, null, null
);
reset role;

select is(
  (select status || ':' || decision from public.refund_cases where id = '79600000-0000-4000-8000-000000000008'),
  'denied:denied',
  'A mapped manager can commit an exact decline receipt'
);

set local role service_role;
select ok(
  pg_temp.capture_error($sql$
    select public.service_apply_refund_official_case_update(
      (select authorization_id from pg_temp.official_action_test_receipts where receipt_key = 'decline_parallel'),
      '79600000-0000-4000-8000-000000000008', 'decline', 'denied', null, 'denied',
      'We could not find a matching transaction.', null, null, null, null, null
    )
  $sql$) like '%changed since authorization%'
  and (
    select status = 'denied' and decision = 'denied'
    from public.refund_cases
    where id = '79600000-0000-4000-8000-000000000008'
  ),
  'Two receipts minted for one case cannot both commit an official action'
);
reset role;

set local role authenticated;
select pg_temp.set_auth_claims(
  '79000000-0000-4000-8000-000000000001', 'aal2', 'totp',
  extract(epoch from statement_timestamp())
);
insert into pg_temp.official_action_test_receipts (receipt_key, authorization_id)
select
  'cash_complete',
  (public.admin_authorize_refund_official_action(
    '79600000-0000-4000-8000-000000000006', 'cash_complete',
    (select official_action_version from public.refund_cases where id = '79600000-0000-4000-8000-000000000006'),
    'completed', 'approved', 'official-manager@example.test', 'Matched cash sale.',
    'Synthetic completion note.', 725, null, null, true, null, null
  ) ->> 'authorizationId')::uuid;
reset role;

set local role service_role;
select public.service_complete_cash_refund_official(
  (select authorization_id from pg_temp.official_action_test_receipts where receipt_key = 'cash_complete'),
  '79600000-0000-4000-8000-000000000006', 725, null, null,
  'Matched cash sale.', 'Synthetic completion note.', 'official-manager@example.test'
);
reset role;

select is(
  (
    select status || ':' || refund_completed_by::text || ':' || refund_amount_cents::text
    from public.refund_cases
    where id = '79600000-0000-4000-8000-000000000006'
  ),
  'completed:79000000-0000-4000-8000-000000000001:725',
  'Cash completion derives the case amount and attributes a mapped-manager receipt'
);

select ok(
  (
    select count(*) = 1
      and bool_and(metadata ->> 'completion_method' = 'manual_external')
      and bool_and(metadata ->> 'refund_amount_cents' = '725')
      and bool_and(metadata ->> 'payload_redacted' = 'true')
      and bool_and(not (metadata ? 'manual_refund_reference'))
      and bool_and(not (metadata ? 'zelle_payment_contact'))
    from public.refund_case_events
    where refund_case_id = '79600000-0000-4000-8000-000000000006'
      and event_type = 'official_action_committed'
      and metadata ->> 'action' = 'cash_complete'
  ),
  'Cash completion records exactly one channel-neutral official audit event'
);

select ok(
  public.can_prepare_nayax_refund_execution(
    '79000000-0000-4000-8000-000000000001',
    '79600000-0000-4000-8000-000000000007'
  )
  and public.can_prepare_nayax_refund_execution(
    '79000000-0000-4000-8000-000000000002',
    '79600000-0000-4000-8000-000000000007'
  )
  and public.can_prepare_nayax_refund_execution(
    '79000000-0000-4000-8000-000000000003',
    '79600000-0000-4000-8000-000000000007'
  )
  and not public.can_prepare_nayax_refund_execution(
    '79000000-0000-4000-8000-000000000004',
    '79600000-0000-4000-8000-000000000007'
  ),
  'Nayax preparation follows exact Machine Manager mapping, regardless of separate admin access'
);

set local role authenticated;
select pg_temp.set_auth_claims(
  '79000000-0000-4000-8000-000000000001', 'aal2', 'totp',
  extract(epoch from statement_timestamp())
);
insert into pg_temp.official_action_test_receipts (receipt_key, authorization_id)
select
  'nayax_execute',
  (public.admin_authorize_refund_official_action(
    '79600000-0000-4000-8000-000000000007', 'nayax_execute',
    (select official_action_version from public.refund_cases where id = '79600000-0000-4000-8000-000000000007'),
    'card_refund_pending', 'approved', null, null, null, 500, null, null, false, null, null
  ) ->> 'authorizationId')::uuid;
reset role;

set local role service_role;
select ok(
  not has_function_privilege(
    'service_role',
    'public.service_consume_nayax_refund_official_action(uuid,uuid,text,text,integer,uuid)',
    'execute'
  ),
  'Legacy service-role Nayax receipt consumption is revoked in favor of the assertion-scoped atomic wrapper'
);
reset role;

select ok(
  (
    select refund_case.status = 'card_refund_pending'
      and refund_case.decision = 'approved'
      and refund_case.refund_completed_at is null
      and refund_case.reporting_adjustment_id is null
      and action_authorization.status = 'authorized'
    from public.refund_cases refund_case
    join public.refund_case_official_action_authorizations action_authorization
      on action_authorization.id = (select authorization_id from pg_temp.official_action_test_receipts where receipt_key = 'nayax_execute')
    where refund_case.id = '79600000-0000-4000-8000-000000000007'
  )
  and not exists (
    select 1
    from public.refund_case_events
    where refund_case_id = '79600000-0000-4000-8000-000000000007'
      and event_type in (
        'nayax_official_action_revalidated',
        'nayax_official_action_finalized',
        'refund_completed'
      )
  ),
  'Denied legacy consumption leaves manager authority and card case untouched'
);

set local role authenticated;
select pg_temp.set_auth_claims(
  '79000000-0000-4000-8000-000000000001', 'aal2', 'totp',
  extract(epoch from statement_timestamp())
);
select ok(
  public.can_perform_refund_official_action_current_user(
    '79600000-0000-4000-8000-000000000007'
  ),
  'The browser-facing current-user predicate derives the mapped manager from auth.uid()'
);

select pg_temp.set_auth_claims(
  '79000000-0000-4000-8000-000000000002', 'aal2', 'totp',
  extract(epoch from statement_timestamp())
);
select ok(
  public.can_perform_refund_official_action_current_user(
    '79600000-0000-4000-8000-000000000007'
  ),
  'The browser-facing current-user predicate honors the mapped-manager role for a dual-role Super Admin'
);
reset role;

select ok(
  not has_table_privilege('authenticated', 'public.refund_case_official_action_authorizations', 'select')
  and not has_table_privilege('anon', 'public.refund_case_official_action_authorizations', 'select')
  and not has_table_privilege('service_role', 'public.refund_case_official_action_authorizations', 'select')
  and not exists (
    select 1
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'refund_case_official_action_authorizations'
      and column_name in ('customer_email', 'provider_transaction_id', 'request_payload', 'response_payload')
  ),
  'Receipt storage is hidden from browser and service identities and contains no customer or provider payload columns'
);

create temporary table nayax_selection_boundary_baseline as
select
  (select count(*) from public.refund_case_official_action_authorizations
    where refund_case_id = '79600000-0000-4000-8000-000000000009') as authorization_count,
  (select count(*) from public.refund_case_nayax_refund_attempts
    where refund_case_id = '79600000-0000-4000-8000-000000000009') as attempt_count;
grant select on table pg_temp.nayax_selection_boundary_baseline to service_role;

create temporary table nayax_selection_result (payload jsonb not null);
grant select, insert on table pg_temp.nayax_selection_result to service_role;

select ok(
  has_function_privilege(
    'service_role',
    'public.service_select_refund_nayax_candidate_as_actor(uuid,uuid,bigint,uuid,text)',
    'execute'
  )
  and not has_function_privilege(
    'authenticated',
    'public.service_select_refund_nayax_candidate_as_actor(uuid,uuid,bigint,uuid,text)',
    'execute'
  )
  and not has_function_privilege(
    'anon',
    'public.service_select_refund_nayax_candidate_as_actor(uuid,uuid,bigint,uuid,text)',
    'execute'
  ),
  'Only the service workflow can invoke mapped-manager Nayax candidate selection'
);

set local role service_role;
select lives_ok(
  format(
    $sql$
      insert into pg_temp.nayax_selection_result (payload)
      select public.service_select_refund_nayax_candidate_as_actor(
        '79000000-0000-4000-8000-000000000001',
        '79600000-0000-4000-8000-000000000009',
        %s,
        '79700000-0000-4000-8000-000000000001',
        'customer_confirmation'
      )
    $sql$,
    (select official_action_version from public.refund_cases
      where id = '79600000-0000-4000-8000-000000000009')
  ),
  'A currently mapped manager can persist their actor-bound reviewed candidate without step-up'
);
reset role;

select ok(
  (
    select payload ->> 'selectionApplied' = 'true'
      and payload ->> 'transactionConfirmed' = 'true'
      and payload -> 'refundReadiness' ->> 'transactionConfirmed' = 'true'
      and payload -> 'refundReadiness' ->> 'canIssueCardRefund' = 'true'
      and payload -> 'refundReadiness' -> 'blockReason' = 'null'::jsonb
      and payload -> 'refundReadiness' ->> 'refundAmountCents' = '450'
      and payload -> 'refundReadiness' -> 'machineLimitCents' = 'null'::jsonb
    from pg_temp.nayax_selection_result
  ),
  'First confirmation returns a ready production refund without a machine launch cap'
);

select ok(
  (
    select status = 'needs_review'
      and decision is null
      and refund_amount_cents = 450
      and payment_amount_cents = 440
      and matched_nayax_transaction_id = 'SAFE-TXN-79600009-ALTERED'
      and matched_nayax_amount_cents = 450
      and matched_nayax_currency_code = 'USD'
      and correlation_status = 'matched'
      and correlation_source = 'nayax'
      and nayax_recommendation_state = 'manual_exception'
      and nayax_match_execution_eligible = false
    from public.refund_cases
    where id = '79600000-0000-4000-8000-000000000009'
  )
  and (
    select count(*) = 1
    from public.refund_case_events
    where refund_case_id = '79600000-0000-4000-8000-000000000009'
      and event_type = 'nayax_match_selected'
      and actor_user_id = '79000000-0000-4000-8000-000000000001'
      and metadata ->> 'payload_redacted' = 'true'
  ),
  'Selection preserves the reported estimate and uses the full provider total without approving a refund'
);

select ok(
  (select count(*) from public.refund_case_official_action_authorizations
    where refund_case_id = '79600000-0000-4000-8000-000000000009') =
    (select authorization_count from pg_temp.nayax_selection_boundary_baseline)
  and (select count(*) from public.refund_case_nayax_refund_attempts
    where refund_case_id = '79600000-0000-4000-8000-000000000009') =
    (select attempt_count from pg_temp.nayax_selection_boundary_baseline)
  and not exists (
    select 1 from public.refund_case_events
    where refund_case_id = '79600000-0000-4000-8000-000000000009'
      and event_type in ('official_action_committed', 'nayax_official_action_finalized')
  ),
  'Evidence selection creates no authorization, provider attempt, or official completion evidence'
);

set local role service_role;
select ok(
  pg_temp.capture_error(format(
    $sql$
      select public.service_select_refund_nayax_candidate_as_actor(
        '79000000-0000-4000-8000-000000000002',
        '79600000-0000-4000-8000-000000000009',
        %s,
        '79700000-0000-4000-8000-000000000001',
        null
      )
    $sql$,
    (select official_action_version from public.refund_cases
      where id = '79600000-0000-4000-8000-000000000009')
  )) like '%expired or belongs to another review session%',
  'A different mapped manager cannot reuse another review session candidate token'
);

select ok(
  (
    with replay as (
      select public.service_select_refund_nayax_candidate_as_actor(
        '79000000-0000-4000-8000-000000000001',
        '79600000-0000-4000-8000-000000000009',
        1,
        '79700000-0000-4000-8000-000000000001',
        'customer_confirmation'
      ) as payload
    )
    select payload ->> 'selectionApplied' = 'false'
      and payload ->> 'transactionConfirmed' = 'true'
      and payload -> 'refundReadiness' ->> 'canIssueCardRefund' = 'true'
    from replay
  )
  and (
    select count(*) = 1
    from public.refund_case_events
    where refund_case_id = '79600000-0000-4000-8000-000000000009'
      and event_type = 'nayax_match_selected'
  ),
  'An exact replay succeeds despite the old review version and creates no second event'
);
reset role;

update public.reporting_machines
set nayax_refunds_enabled = false
where id = '79300000-0000-4000-8000-000000000001';

select ok(
  (
    select readiness ->> 'transactionConfirmed' = 'true'
      and readiness ->> 'canIssueCardRefund' = 'false'
      and readiness ->> 'blockReason' = 'machine_not_enabled'
    from (
      select public.refund_case_nayax_manager_readiness(
        '79000000-0000-4000-8000-000000000001',
        '79600000-0000-4000-8000-000000000009'
      ) as readiness
    ) readiness_result
  ),
  'A disabled machine preserves confirmation and returns the exact machine-disabled reason'
);

update public.reporting_machines
set nayax_refunds_enabled = true
where id = '79300000-0000-4000-8000-000000000001';

select ok(
  has_function_privilege(
    'service_role',
    'public.refund_case_nayax_manager_readiness(uuid,uuid)',
    'execute'
  )
  and not has_function_privilege(
    'authenticated',
    'public.refund_case_nayax_manager_readiness(uuid,uuid)',
    'execute'
  )
  and not has_function_privilege(
    'anon',
    'public.refund_case_nayax_manager_readiness(uuid,uuid)',
    'execute'
  ),
  'Only the service workflow can read the private refund-readiness contract'
);

insert into public.refund_nayax_lookup_candidates (
  token, refund_case_id, actor_user_id, reporting_machine_id, provider_transaction_id, site_id,
  machine_authorization_time, amount_cents, card_last4, currency_code,
  evidence_summary, expires_at
)
values
  (
    '79700000-0000-4000-8000-000000000002',
    '79600000-0000-4000-8000-000000000009',
    '79000000-0000-4000-8000-000000000001',
    '79300000-0000-4000-8000-000000000001',
    'SAFE-TXN-BLOCKED-79600009', 17, date_trunc('second',now() - interval '80 minutes'), 450,
    '4242', 'USD',
    jsonb_build_object(
      'selection_allowed',false,'is_recommended',false,'one_click_eligible',false,
      'recommendation_state','blocked','policy_version','2026-09-05.v11',
      'identifier_policy_version','2026-09-05.identifier.v1',
      'customer_fact_version',(
        select deterministic_fact_version from public.refund_cases
        where id = '79600000-0000-4000-8000-000000000009'
      ),
      'customer_credential_class','customer_identifier_unknown',
      'provider_identifier_class','last_sales_identifier_unknown',
      'card_last4_comparison','exact_support','card_network_comparison','missing',
      'payment_interaction_comparison','unknown','same_identifier_equivalence_proven',false,
      'identifier_review_state','blocked_safety','customer_correction_fields','[]'::jsonb,
      'hard_exclusions',jsonb_build_array('provider_safety_block'),'reason_codes','[]'::jsonb,
      'lookup_account_scope','ACCOUNT_793','lookup_provider_machine_id','MACHINE-793',
      'provider_machine_id','MACHINE-793',
      'machine_authorization_time_raw',to_char(date_trunc('second',now()-interval '80 minutes') at time zone 'America/Los_Angeles','YYYY-MM-DD"T"HH24:MI:SS'),
      'machine_authorization_at',date_trunc('second',now()-interval '80 minutes'),
      'machine_authorization_time_source','MachineAuthorizationTime','machine_time_resolution','exact',
      'customer_request_received_at',now()-interval '30 minutes',
      'customer_request_received_source','hosted_refund_intake',
      'request_time_boundary','occurrence_time_uncertain','transaction_occurrence_comparable',false,
      'transaction_occurrence_semantics','unknown','transaction_occurrence_proof_source','null'::jsonb,
      'transaction_occurrence_timestamp_source','null'::jsonb,'transaction_occurrence_timezone_basis','null'::jsonb,
      'transaction_occurrence_lower_bound_at','null'::jsonb,'transaction_occurrence_upper_bound_at','null'::jsonb,
      'request_receipt_lower_bound_at','null'::jsonb,'request_receipt_upper_bound_at','null'::jsonb,
      'provider_time_resolution','exact','provider_time_source','authorization_gmt',
      'authorized_at',date_trunc('second',now()-interval '80 minutes'),
      'payment_status','approved','payment_status_evidence','last_sales_contract',
      'provider_refund_state','clear','duplicate_provider_record',false,
      'amount_delta_cents',10,'time_delta_minutes',null,'provider_processing_time_delta_minutes',10,'provider_payload_redacted',true
    ),
    now() + interval '1 hour'
  ),
  (
    '79700000-0000-4000-8000-000000000003',
    '79600000-0000-4000-8000-000000000009',
    '79000000-0000-4000-8000-000000000001',
    '79300000-0000-4000-8000-000000000001',
    'SAFE-TXN-EXPIRED-79600009', 17, date_trunc('second',now() - interval '70 minutes'), 450,
    '4242', 'USD',
    jsonb_build_object(
      'selection_allowed',true,'is_recommended',true,'one_click_eligible',false,
      'recommendation_state','high_confidence','policy_version','2026-09-05.v11',
      'identifier_policy_version','2026-09-05.identifier.v1',
      'customer_fact_version',(
        select deterministic_fact_version from public.refund_cases
        where id = '79600000-0000-4000-8000-000000000009'
      ),
      'customer_credential_class','customer_identifier_unknown',
      'provider_identifier_class','last_sales_identifier_unknown',
      'card_last4_comparison','exact_support','card_network_comparison','missing',
      'payment_interaction_comparison','unknown','same_identifier_equivalence_proven',false,
      'identifier_review_state','exact_support','customer_correction_fields','[]'::jsonb,
      'hard_exclusions','[]'::jsonb,'reason_codes','[]'::jsonb,
      'lookup_account_scope','ACCOUNT_793','lookup_provider_machine_id','MACHINE-793',
      'provider_machine_id','MACHINE-793',
      'machine_authorization_time_raw',to_char(date_trunc('second',now()-interval '70 minutes') at time zone 'America/Los_Angeles','YYYY-MM-DD"T"HH24:MI:SS'),
      'machine_authorization_at',date_trunc('second',now()-interval '70 minutes'),
      'machine_authorization_time_source','MachineAuthorizationTime','machine_time_resolution','exact',
      'customer_request_received_at',now()-interval '30 minutes',
      'customer_request_received_source','hosted_refund_intake',
      'request_time_boundary','occurrence_time_uncertain','transaction_occurrence_comparable',false,
      'transaction_occurrence_semantics','unknown','transaction_occurrence_proof_source','null'::jsonb,
      'transaction_occurrence_timestamp_source','null'::jsonb,'transaction_occurrence_timezone_basis','null'::jsonb,
      'transaction_occurrence_lower_bound_at','null'::jsonb,'transaction_occurrence_upper_bound_at','null'::jsonb,
      'request_receipt_lower_bound_at','null'::jsonb,'request_receipt_upper_bound_at','null'::jsonb,
      'provider_time_resolution','exact','provider_time_source','authorization_gmt',
      'authorized_at',date_trunc('second',now()-interval '70 minutes'),
      'payment_status','approved','payment_status_evidence','last_sales_contract',
      'provider_refund_state','clear','duplicate_provider_record',false,
      'amount_delta_cents',10,'time_delta_minutes',null,'provider_processing_time_delta_minutes',20,'provider_payload_redacted',true
    ),
    now() - interval '1 minute'
  );

set local role service_role;
select ok(
  pg_temp.capture_error($sql$
    select public.service_select_refund_nayax_candidate_as_actor(
      '79000000-0000-4000-8000-000000000001',
      '79600000-0000-4000-8000-000000000009',
      1,
      '79700000-0000-4000-8000-000000000002',
      'other_review_reason'
    )
  $sql$) like 'P4601:%changed since review%',
  'A stale version for a different selection fails with the stable stale-review code'
);

select ok(
  pg_temp.capture_error(format(
    $sql$
      select public.service_select_refund_nayax_candidate_as_actor(
        '79000000-0000-4000-8000-000000000001',
        '79600000-0000-4000-8000-000000000009',
        %s,
        '79700000-0000-4000-8000-000000000002',
        'other_review_reason'
      )
    $sql$,
    (select official_action_version from public.refund_cases
      where id = '79600000-0000-4000-8000-000000000009')
  )) like 'P4604:%safety block%',
  'A candidate with a safety block cannot be selected'
);

select ok(
  pg_temp.capture_error(format(
    $sql$
      select public.service_select_refund_nayax_candidate_as_actor(
        '79000000-0000-4000-8000-000000000001',
        '79600000-0000-4000-8000-000000000009',
        %s,
        '79700000-0000-4000-8000-000000000003',
        null
      )
    $sql$,
    (select official_action_version from public.refund_cases
      where id = '79600000-0000-4000-8000-000000000009')
  )) like 'P4602:%expired or belongs to another review session%',
  'Expired Nayax lookup evidence cannot be selected'
);
reset role;

select * from finish();
rollback;
