begin;

create extension if not exists pgtap with schema extensions;
set local search_path = public, extensions;

select plan(39);

select has_column('public', 'refund_cases', 'intake_selection_key', 'Cases store the submitted opaque selection key');
select has_column('public', 'refund_cases', 'intake_selection_machine_ids', 'Cases store the server-resolved selection scope separately');
select has_column('public', 'refund_nayax_lookup_candidates', 'reporting_machine_id', 'Every grouped candidate can retain its owning reporting machine');
select has_function('public', 'public_refund_selections', array[]::text[], 'The public selection contract exists');
select ok(
  has_function_privilege('anon', 'public.public_refund_selections()', 'execute'),
  'Anonymous intake may read only the customer-safe selection contract'
);
select ok(
  has_function_privilege('service_role', 'public.service_resolve_refund_public_selection(text)', 'execute')
  and not has_function_privilege('anon', 'public.service_resolve_refund_public_selection(text)', 'execute')
  and not has_function_privilege('authenticated', 'public.service_resolve_refund_public_selection(text)', 'execute'),
  'Only the server resolves opaque selections to machine identities'
);

insert into public.customer_accounts (id, name, account_type, status)
values ('92100000-0000-4000-8000-000000000001', 'Refund selection fixtures', 'internal', 'active');

insert into public.reporting_locations (id, account_id, name, city, state, timezone, status)
values
  ('92110000-0000-4000-8000-000000000001', '92100000-0000-4000-8000-000000000001', 'San Francisco Premium Outlets', 'Livermore', 'CA', 'America/Los_Angeles', 'active'),
  ('92110000-0000-4000-8000-000000000002', '92100000-0000-4000-8000-000000000001', 'Capital City Mall', 'Camp Hill', 'PA', 'America/New_York', 'active'),
  ('92110000-0000-4000-8000-000000000003', '92100000-0000-4000-8000-000000000001', 'South Hills Village', 'Pittsburgh', 'PA', 'America/New_York', 'active'),
  ('92110000-0000-4000-8000-000000000004', '92100000-0000-4000-8000-000000000001', 'Unmapped Bubble Planet Machines', null, null, 'America/New_York', 'active'),
  ('92110000-0000-4000-8000-000000000005', '92100000-0000-4000-8000-000000000001', 'Unmapped Bloomjoy Machines', null, null, 'America/New_York', 'active');

insert into public.reporting_machines (
  id, account_id, location_id, machine_label, machine_type, status,
  nayax_machine_id, nayax_account_key, nayax_refunds_enabled,
  refund_intake_enabled, refund_public_display_label
)
values
  ('91bae5ac-4ba6-4378-91f0-ef266bdd4d7a', '92100000-0000-4000-8000-000000000001', '92110000-0000-4000-8000-000000000001', 'TT20 Cotton Candy', 'commercial', 'active', '921900001', 'TGPACI_USA_DB', false, true, 'San Francisco Premium Outlets — TT20 Cotton Candy'),
  ('8eda5a29-1718-4c70-9993-7c7e2fd6c65a', '92100000-0000-4000-8000-000000000001', '92110000-0000-4000-8000-000000000001', 'TT33 Cotton Candy', 'commercial', 'active', '921900002', 'TGPACI_USA_DB', false, true, 'San Francisco Premium Outlets — TT33 Cotton Candy'),
  ('92120000-0000-4000-8000-000000000003', '92100000-0000-4000-8000-000000000001', '92110000-0000-4000-8000-000000000002', 'Preit0990 Capital City', 'commercial', 'active', '921900003', 'TGPACI_USA_DB', false, true, 'Capital City Mall — Cotton Candy'),
  ('92120000-0000-4000-8000-000000000004', '92100000-0000-4000-8000-000000000001', '92110000-0000-4000-8000-000000000003', 'South Hills Cotton', 'commercial', 'active', '921900004', 'TGPACI_USA_DB', false, true, 'South Hills Village — Cotton Candy'),
  ('92120000-0000-4000-8000-000000000005', '92100000-0000-4000-8000-000000000001', '92110000-0000-4000-8000-000000000003', 'South Hills SnapCase', 'unknown', 'active', '921900005', 'TGPACI_USA_DB', false, true, 'South Hills Village — SnapCase'),
  ('92120000-0000-4000-8000-000000000006', '92100000-0000-4000-8000-000000000001', '92110000-0000-4000-8000-000000000004', 'Bubble Planet Atlanta', 'commercial', 'active', '921900006', 'TGPACI_USA_DB', false, true, 'Bubble Planet - Atlanta'),
  ('92120000-0000-4000-8000-000000000007', '92100000-0000-4000-8000-000000000001', '92110000-0000-4000-8000-000000000005', 'Carolina Place', 'commercial', 'active', null, null, false, false, 'Carolina Place'),
  ('92120000-0000-4000-8000-000000000008', '92100000-0000-4000-8000-000000000001', '92110000-0000-4000-8000-000000000005', 'Columbiana', 'commercial', 'active', null, null, false, false, 'Columbiana Centre'),
  ('92120000-0000-4000-8000-000000000009', '92100000-0000-4000-8000-000000000001', '92110000-0000-4000-8000-000000000004', 'Bubble Planet DC', 'commercial', 'active', '921900009', 'TGPACI_USA_DB', false, true, 'Bubble Planet DC'),
  ('92120000-0000-4000-8000-000000000010', '92100000-0000-4000-8000-000000000001', '92110000-0000-4000-8000-000000000004', 'Bubble Planet Seattle', 'commercial', 'active', '921900010', 'TGPACI_USA_DB', false, true, 'Bubble Planet Seattle');

insert into public.refund_nayax_machine_inventory (
  id, account_key, nayax_machine_id, machine_name, machine_number,
  provider_is_active, refund_category, reporting_machine_id,
  reconciliation_state, setup_reason
)
values
  ('92130000-0000-4000-8000-000000000001', 'TGPACI_USA_DB', '921900001', 'Livermore A', 'fixture-a', true, 'cotton_candy', '91bae5ac-4ba6-4378-91f0-ef266bdd4d7a', 'published', 'reviewed_exact_mapping'),
  ('92130000-0000-4000-8000-000000000002', 'TGPACI_USA_DB', '921900002', 'Livermore B', 'fixture-b', true, 'cotton_candy', '8eda5a29-1718-4c70-9993-7c7e2fd6c65a', 'published', 'reviewed_exact_mapping'),
  ('92130000-0000-4000-8000-000000000003', 'TGPACI_USA_DB', '921900003', 'Capital', 'fixture-c', true, 'cotton_candy', '92120000-0000-4000-8000-000000000003', 'published', 'reviewed_exact_mapping'),
  ('92130000-0000-4000-8000-000000000004', 'TGPACI_USA_DB', '921900004', 'South Cotton', 'fixture-d', true, 'cotton_candy', '92120000-0000-4000-8000-000000000004', 'published', 'reviewed_exact_mapping'),
  ('92130000-0000-4000-8000-000000000005', 'TGPACI_USA_DB', '921900005', 'South SnapCase', 'fixture-e', true, 'snapcase', '92120000-0000-4000-8000-000000000005', 'published', 'reviewed_exact_mapping'),
  ('92130000-0000-4000-8000-000000000006', 'TGPACI_USA_DB', '921900006', 'Bubble Planet Atlanta', 'fixture-f', true, 'cotton_candy', '92120000-0000-4000-8000-000000000006', 'published', 'reviewed_exact_mapping'),
  ('92130000-0000-4000-8000-000000000009', 'TGPACI_USA_DB', '921900009', 'Bubble Planet DC', 'fixture-i', true, 'cotton_candy', '92120000-0000-4000-8000-000000000009', 'published', 'reviewed_exact_mapping'),
  ('92130000-0000-4000-8000-000000000010', 'TGPACI_USA_DB', '921900010', 'Bubble Planet Seattle', 'fixture-j', true, 'cotton_candy', '92120000-0000-4000-8000-000000000010', 'published', 'reviewed_exact_mapping');

insert into auth.users (
  instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at
)
values (
  '00000000-0000-0000-0000-000000000000',
  '92140000-0000-4000-8000-000000000001', 'authenticated', 'authenticated',
  'pair-manager@example.test', '', now(), '{}'::jsonb, '{}'::jsonb, now(), now()
);

insert into public.reporting_machine_refund_managers (
  reporting_machine_id, manager_user_id, manager_email, grant_reason
)
values
  ('91bae5ac-4ba6-4378-91f0-ef266bdd4d7a', '92140000-0000-4000-8000-000000000001', 'pair-manager@example.test', 'Pair fixture'),
  ('8eda5a29-1718-4c70-9993-7c7e2fd6c65a', '92140000-0000-4000-8000-000000000001', 'pair-manager@example.test', 'Pair fixture');

select ok(public.refund_livermore_selection_is_valid(), 'The exact reviewed pair satisfies every invariant');
select has_function('public', 'public_refund_selections_v2', array[]::text[], 'The cash-aware public selection contract exists');
select ok(
  has_function_privilege('anon', 'public.public_refund_selections_v2()', 'execute'),
  'Anonymous intake may read the cash-aware customer-safe selections'
);
select ok(
  not exists (
    select 1
    from pg_constraint
    where conrelid = 'public.refund_cases'::regclass
      and conname = 'refund_cases_cash_zelle_contact_present'
  ),
  'Cash cases no longer require a payout-channel contact'
);
select is(
  (select jsonb_array_length(cash_machine_options)
   from public.public_refund_selections_v2()
   where selection_kind = 'livermore_pair'),
  2,
  'The one ambiguous cash location exposes exactly two plain machine choices'
);
select ok(
  (select cash_machine_options @> '[{"displayLabel":"TT20 cotton candy machine"},{"displayLabel":"TT33 cotton candy machine"}]'::jsonb
   from public.public_refund_selections_v2()
   where selection_kind = 'livermore_pair'),
  'The ambiguous cash choices use customer-readable machine labels'
);
select is(
  (select count(*)::integer from public.public_refund_selections() where selection_kind = 'livermore_pair'),
  1,
  'Livermore produces exactly one customer choice'
);
select is(
  (select display_label from public.public_refund_selections() where selection_kind = 'livermore_pair'),
  'San Francisco Premium Outlets — Cotton candy',
  'The Livermore label contains no provider or first/second identifier'
);
select is(
  (select count(*)::integer from public.public_refund_selections() where display_label = 'Capital City Mall'),
  1,
  'An ordinary one-machine location is displayed once without repeated product text'
);
select is(
  (select count(*)::integer from public.public_refund_selections() where display_label in (
    'South Hills Village — Cotton candy', 'South Hills Village — Phone cases (SnapCase)'
  )),
  2,
  'A mixed-type location has one exact choice per product category'
);
select is(
  (select count(*)::integer from public.public_refund_selections() where display_label in (
    'Bubble Planet - Atlanta', 'Bubble Planet DC', 'Bubble Planet Seattle', 'Carolina Place', 'Columbiana Centre'
  )),
  5,
  'Customer-safe fallback labels remain separate ordinary choices across both placeholder location cohorts'
);
select is(
  (select count(*)::integer from public.public_refund_selections()
   where display_label ilike '%unmapped%' or display_label ilike '%unknown%'),
  0,
  'Placeholder location names never appear in the customer selector'
);
select is(
  (select count(*)::integer from public.public_refund_selections()
   where display_label in ('Bubble Planet - Atlanta', 'Bubble Planet DC', 'Bubble Planet Seattle', 'Carolina Place', 'Columbiana Centre')
     and selection_kind = 'exact_machine'),
  5,
  'Every restored fallback label retains exact-machine selection semantics'
);
select is(
  (select count(*)::integer
   from public.public_refund_selections()
   where display_label in ('Bubble Planet - Atlanta', 'Bubble Planet DC', 'Bubble Planet Seattle', 'Carolina Place', 'Columbiana Centre')
     and jsonb_array_length(
       public.service_resolve_refund_public_selection(selection_key) -> 'machineIds'
     ) = 1),
  5,
  'Every restored fallback label resolves to exactly one server-owned machine'
);
select is(
  (select count(*)::integer from public.public_refund_selections()),
  10,
  'The fixture exposes every ordinary choice and compresses only the reviewed Livermore pair'
);
select is(
  (select count(*)::integer from public.public_refund_selections()),
  (select count(distinct regexp_replace(lower(display_label), '[^a-z0-9]+', '', 'g'))::integer from public.public_refund_selections()),
  'Every rendered selection label is unique after safe normalization'
);
select is(
  jsonb_array_length(public.service_resolve_refund_public_selection(public.refund_livermore_selection_key()) -> 'machineIds'),
  2,
  'The server resolves Livermore to exactly two machine UUIDs'
);
select throws_ok(
  $$select public.service_resolve_refund_public_selection(repeat('f', 64))$$,
  'P0001',
  'The selected location is not available',
  'A forged selection key fails closed'
);

insert into public.refund_cases (
  id, reporting_machine_id, reporting_location_id, intake_selection_key,
  intake_selection_kind, intake_selection_machine_ids, customer_email,
  customer_name, issue_summary, incident_at, incident_local_datetime,
  incident_timezone, incident_time_resolution, payment_method,
  payment_amount_cents, card_last4, card_network, payment_interaction,
  incident_time_confidence, issue_category, status, correlation_status
)
values (
  '92150000-0000-4000-8000-000000000001', null,
  '92110000-0000-4000-8000-000000000001', public.refund_livermore_selection_key(),
  'livermore_pair', public.refund_livermore_selection_machine_ids(),
  'pair-customer@example.test', 'Pair Customer', 'Synthetic grouped lookup',
  now() - interval '30 minutes', to_char(now() - interval '30 minutes', 'YYYY-MM-DD"T"HH24:MI'),
  'America/Los_Angeles', 'exact', 'card', 550, '4242', 'visa',
  'tap_card', 'exact', 'charged_no_product', 'needs_review', 'multiple_candidates'
);

select ok(
  public.can_manage_refund_case('92140000-0000-4000-8000-000000000001', '92150000-0000-4000-8000-000000000001'),
  'A manager authorized for the complete pair can view and compare the unresolved case'
);
select lives_ok(
  $$insert into public.refund_cases (
      id, reporting_machine_id, reporting_location_id, customer_email,
      customer_name, issue_summary, incident_at, payment_method,
      payment_amount_cents, payment_interaction, incident_time_confidence,
      issue_category, status, correlation_status, refund_amount_cents
    ) values (
      '92150000-0000-4000-8000-000000000002',
      '91bae5ac-4ba6-4378-91f0-ef266bdd4d7a',
      '92110000-0000-4000-8000-000000000001',
      'cash-customer@example.test', 'Cash Customer', 'Synthetic cash intake',
      now() - interval '20 minutes', 'cash', 700, 'cash', 'exact',
      'charged_no_product', 'needs_review', 'no_match', 700
    )$$,
  'A normal cash website case is valid without Zelle or Venmo data'
);
select is(
  (select zelle_payment_contact from public.refund_cases where id = '92150000-0000-4000-8000-000000000002'),
  null,
  'The normal cash path stores no payout-channel contact'
);
select lives_ok(
  $$insert into public.refund_cases (
      id, reporting_machine_id, reporting_location_id, customer_email,
      customer_name, zelle_payment_contact, issue_summary, incident_at,
      payment_method, payment_amount_cents, payment_interaction,
      incident_time_confidence, issue_category, status, correlation_status,
      refund_amount_cents
    ) values (
      '92150000-0000-4000-8000-000000000003',
      '8eda5a29-1718-4c70-9993-7c7e2fd6c65a',
      '92110000-0000-4000-8000-000000000001',
      'legacy-cash@example.test', 'Legacy Cash', 'legacy-contact@example.test',
      'Synthetic legacy cash record', now() - interval '10 minutes',
      'cash', 650, 'cash', 'exact', 'charged_no_product', 'needs_review',
      'no_match', 650
    )$$,
  'Existing legacy cash records may still retain historical payout contact data'
);
select is(
  (select zelle_payment_contact from public.refund_cases where id = '92150000-0000-4000-8000-000000000003'),
  'legacy-contact@example.test',
  'The migration does not destructively rewrite legacy payout contact history'
);
select ok(
  not public.can_perform_refund_official_action('92140000-0000-4000-8000-000000000001', '92150000-0000-4000-8000-000000000001'),
  'Official decisions remain unavailable while exact machine identity is unresolved'
);
select is(
  public.service_resolve_refund_customer_manager_cc(
    '92150000-0000-4000-8000-000000000001',
    'pair-customer@example.test',
    array['info@bloomjoysweets.com']
  ) ->> 'status',
  'resolved',
  'The valid shared route preserves warm reply-based customer communication'
);
select throws_ok(
  $$insert into public.refund_cases (
      reporting_machine_id, reporting_location_id, customer_email, issue_summary,
      incident_at, payment_method, payment_amount_cents, card_last4, status
    ) values (
      null, '92110000-0000-4000-8000-000000000001', 'forged@example.test',
      'Forged unresolved case', now(), 'card', 500, '1111', 'needs_review'
    )$$,
  '23514', null,
  'A null machine without the exact grouped scope is rejected'
);

update public.reporting_machine_refund_managers
set manager_email = 'divergent-manager@example.test'
where reporting_machine_id = '8eda5a29-1718-4c70-9993-7c7e2fd6c65a';
select ok(not public.refund_livermore_selection_is_valid(), 'Any manager-route divergence invalidates the pair');
select is(
  (select count(*)::integer from public.public_refund_selections() where selection_kind = 'livermore_pair'),
  0,
  'An invalid pair disappears instead of degrading to guessed individual choices'
);
update public.reporting_machine_refund_managers
set manager_email = 'pair-manager@example.test'
where reporting_machine_id = '8eda5a29-1718-4c70-9993-7c7e2fd6c65a';
select ok(public.refund_livermore_selection_is_valid(), 'Restoring the exact shared route restores the bounded selection');

insert into public.refund_nayax_lookup_candidates (
  token, refund_case_id, actor_user_id, reporting_machine_id,
  provider_transaction_id, site_id, machine_authorization_time,
  amount_cents, card_last4, currency_code, evidence_summary, expires_at
)
values (
  '92160000-0000-4000-8000-000000000001',
  '92150000-0000-4000-8000-000000000001',
  '92140000-0000-4000-8000-000000000001',
  '8eda5a29-1718-4c70-9993-7c7e2fd6c65a',
  'SAFE-TXN-921-LIVERMORE-B', 21, now() - interval '30 minutes',
  550, '4242', 'USD',
  '{"selection_allowed":true,"is_recommended":true,"recommendation_state":"high_confidence","confidence_class":"strong_card","one_click_eligible":false,"policy_version":"2026-09-05.v8","customer_request_received_at":null,"customer_request_received_source":null,"request_time_boundary":"request_time_unknown"}'::jsonb,
  now() + interval '1 hour'
);

set local role service_role;
select lives_ok(
  format(
    $$select public.service_select_refund_nayax_candidate_as_actor(
      '92140000-0000-4000-8000-000000000001',
      '92150000-0000-4000-8000-000000000001', %s,
      '92160000-0000-4000-8000-000000000001', null
    )$$,
    (select official_action_version from public.refund_cases where id = '92150000-0000-4000-8000-000000000001')
  ),
  'Manager confirmation atomically binds the candidate transaction and owning machine'
);
reset role;

select ok(
  (select reporting_machine_id = '8eda5a29-1718-4c70-9993-7c7e2fd6c65a'
    and matched_nayax_transaction_id = 'SAFE-TXN-921-LIVERMORE-B'
    and decision is null and status = 'needs_review'
   from public.refund_cases where id = '92150000-0000-4000-8000-000000000001'),
  'Candidate selection binds exact machine B while preserving separate approval'
);
select is(
  (select count(*)::integer from public.refund_case_nayax_refund_attempts where refund_case_id = '92150000-0000-4000-8000-000000000001'),
  0,
  'Transaction confirmation creates no refund attempt'
);
select is(
  (select count(*)::integer from public.refund_case_official_action_authorizations where refund_case_id = '92150000-0000-4000-8000-000000000001'),
  0,
  'Transaction confirmation creates no approval authorization'
);

select * from finish();
rollback;
