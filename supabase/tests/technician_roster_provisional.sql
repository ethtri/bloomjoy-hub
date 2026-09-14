begin;

create extension if not exists pgtap with schema extensions;
set local search_path = public, extensions;

select plan(34);

insert into auth.users (
  instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at
)
values
  ('00000000-0000-0000-0000-000000000000', 'a1100000-0000-4000-8000-000000000001', 'authenticated', 'authenticated', 'roster-admin@example.invalid', '', now(), '{}'::jsonb, '{}'::jsonb, now(), now()),
  ('00000000-0000-0000-0000-000000000000', 'a1100000-0000-4000-8000-000000000002', 'authenticated', 'authenticated', 'roster-tech@example.invalid', '', now(), '{}'::jsonb, '{}'::jsonb, now(), now()),
  ('00000000-0000-0000-0000-000000000000', 'a1100000-0000-4000-8000-000000000003', 'authenticated', 'authenticated', 'roster-new-tech@example.invalid', '', now(), '{}'::jsonb, '{}'::jsonb, now(), now()),
  ('00000000-0000-0000-0000-000000000000', 'a1100000-0000-4000-8000-000000000004', 'authenticated', 'authenticated', 'roster-outsider@example.invalid', '', now(), '{}'::jsonb, '{}'::jsonb, now(), now());

insert into public.admin_roles (user_id, role, active)
values ('a1100000-0000-4000-8000-000000000001', 'super_admin', true);

insert into public.customer_accounts (id, name, account_type)
values
  ('a1200000-0000-4000-8000-000000000001', 'Roster fixture A', 'internal'),
  ('a1200000-0000-4000-8000-000000000002', 'Roster fixture B', 'internal');

insert into public.reporting_locations (id, account_id, name, timezone)
values
  ('a1300000-0000-4000-8000-000000000001', 'a1200000-0000-4000-8000-000000000001', 'Roster fixture location A', 'America/Los_Angeles'),
  ('a1300000-0000-4000-8000-000000000002', 'a1200000-0000-4000-8000-000000000002', 'Roster fixture location B', 'America/Los_Angeles');

insert into public.reporting_machines (id, account_id, location_id, machine_label, machine_type)
values
  ('a1400000-0000-4000-8000-000000000001', 'a1200000-0000-4000-8000-000000000001', 'a1300000-0000-4000-8000-000000000001', 'Roster provisional machine', 'snapcase'),
  ('a1400000-0000-4000-8000-000000000002', 'a1200000-0000-4000-8000-000000000002', 'a1300000-0000-4000-8000-000000000002', 'Roster live machine', 'commercial'),
  ('a1400000-0000-4000-8000-000000000003', 'a1200000-0000-4000-8000-000000000001', 'a1300000-0000-4000-8000-000000000001', 'Roster second provisional machine', 'snapcase');

insert into public.payout_policies (id, account_id, name)
values
  ('a1500000-0000-4000-8000-000000000001', 'a1200000-0000-4000-8000-000000000001', 'Roster fixture policy A'),
  ('a1500000-0000-4000-8000-000000000002', 'a1200000-0000-4000-8000-000000000002', 'Roster fixture policy B');

update public.customer_accounts
set default_payout_policy_id = case
  when id = 'a1200000-0000-4000-8000-000000000001' then 'a1500000-0000-4000-8000-000000000001'::uuid
  else 'a1500000-0000-4000-8000-000000000002'::uuid
end
where id in ('a1200000-0000-4000-8000-000000000001', 'a1200000-0000-4000-8000-000000000002');

insert into public.operator_payout_profiles (
  id, account_id, user_id, display_name, worker_type, payout_policy_id
)
values
  ('a1600000-0000-4000-8000-000000000001', 'a1200000-0000-4000-8000-000000000001', 'a1100000-0000-4000-8000-000000000002', 'Roster Technician', 'contractor_1099', 'a1500000-0000-4000-8000-000000000001');

insert into public.operator_machine_assignments (
  operator_profile_id, account_id, reporting_machine_id, effective_start_date, grant_reason
) values (
  'a1600000-0000-4000-8000-000000000001',
  'a1200000-0000-4000-8000-000000000001',
  'a1400000-0000-4000-8000-000000000001',
  '2026-09-14',
  'Roster machine-manager privacy fixture'
);

insert into public.reporting_machine_refund_managers (
  reporting_machine_id, manager_user_id, manager_email, grant_reason, granted_by
) values (
  'a1400000-0000-4000-8000-000000000001',
  'a1100000-0000-4000-8000-000000000004',
  'roster-outsider@example.invalid',
  'Roster machine-manager privacy fixture',
  'a1100000-0000-4000-8000-000000000001'
);

select has_table('public', 'operator_contact_details', 'Technician contacts use a dedicated protected directory');
select has_column('public', 'operator_contact_details', 'contact_email', 'The contact directory stores email');
select has_column('public', 'operator_contact_details', 'contact_phone', 'The contact directory stores phone');
select has_column('public', 'operator_contact_details', 'mailing_address', 'The contact directory stores mailing address');
select has_column('public', 'reporting_machines', 'operational_phase', 'Machines have an independent operational phase');
select is(
  (select operational_phase from public.reporting_machines where id = 'a1400000-0000-4000-8000-000000000001'),
  'live',
  'New machines default to live without changing legacy behavior'
);
select ok(
  not has_table_privilege('authenticated', 'public.operator_contact_details', 'update'),
  'Authenticated browser callers cannot update protected contacts directly'
);
select ok(
  not has_table_privilege('authenticated', 'public.operator_contact_details', 'insert'),
  'Authenticated browser callers cannot insert protected contacts directly'
);
select ok(
  not has_function_privilege('anon', 'public.admin_update_operator_contact(uuid,text,text,text,text)', 'execute'),
  'Anonymous callers cannot update technician contacts'
);
select ok(
  has_function_privilege('authenticated', 'public.admin_update_operator_contact(uuid,text,text,text,text)', 'execute'),
  'Authenticated managers can reach the contact update RPC'
);
select ok(
  not has_function_privilege('anon', 'public.get_operator_contact_directory(uuid[])', 'execute'),
  'Anonymous callers cannot read the technician contact directory RPC'
);
select ok(
  not has_function_privilege('anon', 'public.admin_set_reporting_machine_operational_phase(uuid,text,text)', 'execute'),
  'Anonymous callers cannot change machine phases'
);

set local role authenticated;
select set_config('request.jwt.claim.sub', 'a1100000-0000-4000-8000-000000000001', true);

select lives_ok(
  $$select public.admin_set_reporting_machine_operational_phase(
    'a1400000-0000-4000-8000-000000000001', 'setup', 'Provisional roster test'
  )$$,
  'A Super Admin can mark an active machine provisional'
);
select throws_ok(
  $$select public.admin_set_reporting_machine_operational_phase(
    'a1400000-0000-4000-8000-000000000001', 'paused', 'Invalid lifecycle test'
  )$$,
  'P0001',
  'Invalid operational phase',
  'The provisional lifecycle cannot silently replace existing pause or archive semantics'
);
select lives_ok(
  $$select public.admin_upsert_reporting_machine_with_phase(
    null, 'Roster fixture A', 'Roster Eastern provisional', 'Roster Eastern provisional',
    'snapcase', null, 'setup', 'Eastern provisional roster test', 'America/New_York'
  )$$,
  'A Super Admin can create a provisional machine with its real location timezone'
);
select is(
  (select location.timezone
   from public.reporting_machines machine
   join public.reporting_locations location on location.id = machine.location_id
   where machine.machine_label = 'Roster Eastern provisional'),
  'America/New_York',
  'A new provisional location keeps the supplied timezone'
);
select is(
  (select operational_phase from public.reporting_machines
   where machine_label = 'Roster Eastern provisional'),
  'setup',
  'A newly created provisional machine starts in setup phase'
);
select lives_ok(
  $$select public.admin_upsert_reporting_machine_with_phase(
    null, 'Roster fixture A', 'Roster Eastern provisional', 'Roster second Eastern machine',
    'snapcase', null, 'setup', 'Shared-location timezone preservation test', 'America/Los_Angeles'
  )$$,
  'A second machine can reuse an existing provisional location'
);
select is(
  (select timezone from public.reporting_locations
   where name = 'Roster Eastern provisional'),
  'America/New_York',
  'Creating another machine cannot overwrite an existing shared location timezone'
);
select lives_ok(
  $$select public.admin_update_operator_contact(
    'a1600000-0000-4000-8000-000000000001',
    'Roster.Contact@Example.Invalid', '+1 555 010 9000', '100 Test Avenue',
    'Technician contact details updated from Admin Payouts'
  )$$,
  'A pay-authorized admin can update protected contact details'
);
select throws_ok(
  $$select public.admin_update_operator_contact(
    'a1600000-0000-4000-8000-000000000001',
    'roster.contact@example.invalid', '+1 555 010 9000', '100 Test Avenue',
    'Send the contact values to another system'
  )$$,
  'P0001',
  'Unsupported contact update reason',
  'Caller-controlled audit reasons cannot smuggle contact values into audit metadata'
);
select lives_ok(
  $$select public.admin_setup_timekeeping_technician_arrangements_with_contact(
    'roster-tech@example.invalid', 'Roster Technician', 'contractor_1099', 'TEST-1001',
    'roster-tech@example.invalid', null, null, '2026-09-14',
    '[{"machineId":"a1400000-0000-4000-8000-000000000002","shiftRateCents":2000,"commissionBasisPoints":0,"commissionEffectiveStartDate":"2026-09-14"}]'::jsonb
  )$$,
  'Adding another payer arrangement does not require re-entering optional contact details'
);
select lives_ok(
  $$select public.admin_setup_timekeeping_technician_arrangements_with_contact(
    'roster-new-tech@example.invalid', 'New Roster Technician', 'contractor_1099', 'TEST-1002',
    'roster-new-tech@example.invalid', '+1 555 010 9001', '200 Test Avenue', '2026-09-14',
    '[{"machineId":"a1400000-0000-4000-8000-000000000001","shiftRateCents":2500,"commissionBasisPoints":300,"commissionEffectiveStartDate":"2026-12-14"},{"machineId":"a1400000-0000-4000-8000-000000000003","shiftRateCents":2500,"commissionBasisPoints":300,"commissionEffectiveStartDate":"2026-12-14"}]'::jsonb
  )$$,
  'Initial setup stores contact data alongside multiple provisional machine arrangements under one payer'
);

reset role;

select is(
  (select operational_phase from public.reporting_machines where id = 'a1400000-0000-4000-8000-000000000001'),
  'setup',
  'Provisional machines remain active and are explicitly labeled setup'
);
select is(
  (select count(*)::integer from public.operator_contact_details
   where user_id = 'a1100000-0000-4000-8000-000000000002'
     and contact_email = 'roster.contact@example.invalid'
     and contact_phone = '+1 555 010 9000'
     and mailing_address = '100 Test Avenue'),
  1,
  'A technician has one contact record and later payer setup preserves its existing values'
);
select is(
  (select contact_phone from public.operator_contact_details
   where user_id = 'a1100000-0000-4000-8000-000000000003'),
  '+1 555 010 9001',
  'Initial setup saves the new technician contact details'
);
select is(
  (select count(*)::integer
   from public.operator_machine_assignments assignment
   join public.operator_payout_profiles profile on profile.id = assignment.operator_profile_id
   where profile.user_id = 'a1100000-0000-4000-8000-000000000003'
     and profile.account_id = 'a1200000-0000-4000-8000-000000000001'
     and assignment.status = 'active'),
  2,
  'Multiple same-payer machines receive separate assignments'
);
select is(
  (select count(*)::integer
   from public.compensation_rules rule
   join public.operator_payout_profiles profile on profile.id = rule.operator_profile_id
   where profile.user_id = 'a1100000-0000-4000-8000-000000000003'
     and profile.account_id = 'a1200000-0000-4000-8000-000000000001'
     and rule.shift_rate_cents = 2500
     and rule.reporting_machine_id in (
       'a1400000-0000-4000-8000-000000000001',
       'a1400000-0000-4000-8000-000000000003'
     )
     and rule.status = 'active'),
  2,
  'Multiple same-payer machines receive distinct started-hour rates'
);
select is(
  (select count(*)::integer from public.get_operator_contact_directory(
    array(select profile.id from public.operator_payout_profiles profile
      where profile.user_id = 'a1100000-0000-4000-8000-000000000002')
  )),
  2,
  'A pay-authorized manager receives the same user-scoped contact through both payer profiles'
);
select ok(
  not exists (
    select 1 from public.admin_audit_log
    where action in ('operator_contact_details.updated', 'timekeeping_technician.contact_setup_completed')
      and concat_ws(' ', before::text, after::text, meta::text) ~* 'test avenue|555 010|roster[.]contact'
  ),
  'Audit payloads record contact presence without retaining contact values'
);

set local role authenticated;
select set_config('request.jwt.claim.sub', 'a1100000-0000-4000-8000-000000000002', true);
select is(
  (select count(*)::integer from public.operator_contact_details where contact_email = 'roster.contact@example.invalid'),
  1,
  'A technician can read their own protected contact record'
);

select set_config('request.jwt.claim.sub', 'a1100000-0000-4000-8000-000000000004', true);
select is(
  (select count(*)::integer from public.operator_payout_profiles where id = 'a1600000-0000-4000-8000-000000000001'),
  1,
  'A machine manager can read the payout profile needed for assigned-machine operations'
);
select is(
  (select count(*)::integer from public.operator_contact_details),
  0,
  'A machine manager without account pay authority cannot read contact details'
);
select is(
  (select count(*)::integer from public.get_operator_contact_directory(
    array['a1600000-0000-4000-8000-000000000001'::uuid]
  )),
  0,
  'The contact directory RPC also withholds details from machine-only managers'
);

select * from finish();
rollback;
