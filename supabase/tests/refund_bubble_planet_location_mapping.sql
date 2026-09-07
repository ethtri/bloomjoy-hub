begin;
create extension if not exists pgtap with schema extensions;
set local search_path = public, extensions;
select no_plan();

select is(
  public.reconcile_refund_bubble_planet_locations() ->> 'status',
  'skipped_no_targets',
  'Clean databases skip the production-specific location repair'
);

insert into public.customer_accounts (id, name, account_type)
values (
  '11230000-0000-4000-8000-000000000001',
  'Bloomjoy Enterprises',
  'internal'
);

insert into public.reporting_locations (
  id, account_id, name, city, state, timezone, status
) values (
  '33424c87-38f1-4ad5-9058-8a1814baa294',
  '11230000-0000-4000-8000-000000000001',
  'Unmapped Sunze Machines',
  null,
  null,
  'America/Los_Angeles',
  'active'
);

insert into public.reporting_machines (
  id, account_id, location_id, machine_label, machine_type, status,
  nayax_account_key, nayax_machine_id, nayax_refunds_enabled,
  refund_intake_enabled, refund_public_display_label
) values
  (
    '9433f09f-9874-4904-b511-2fa55723e0d7',
    '11230000-0000-4000-8000-000000000001',
    '33424c87-38f1-4ad5-9058-8a1814baa294',
    'Bubble Planet - Atlanta', 'commercial', 'active',
    'TGPACI_USA_DB', '403158085', true, true, 'Bubble Planet - Atlanta'
  ),
  (
    '20d475a0-ab75-4a0e-8fa7-14306b63fe29',
    '11230000-0000-4000-8000-000000000001',
    '33424c87-38f1-4ad5-9058-8a1814baa294',
    'Bubble Planet DC', 'commercial', 'active',
    'TGPACI_USA_DB', '938197833', true, true, 'Bubble Planet DC'
  ),
  (
    '7ae1695c-1394-4a11-843e-3bc594547fed',
    '11230000-0000-4000-8000-000000000001',
    '33424c87-38f1-4ad5-9058-8a1814baa294',
    'Bubble Planet Seattle', 'commercial', 'active',
    'TGPACI_USA_DB', '287196350', true, true, 'Bubble Planet Seattle'
  );

insert into auth.users (
  id, aud, role, email, raw_app_meta_data, raw_user_meta_data
) values
  (
    '11230000-0000-4000-8000-000000000011',
    'authenticated', 'authenticated', 'manager-one@example.test',
    '{"provider":"email","providers":["email"]}', '{}'
  ),
  (
    '11230000-0000-4000-8000-000000000012',
    'authenticated', 'authenticated', 'manager-two@example.test',
    '{"provider":"email","providers":["email"]}', '{}'
  );

insert into public.reporting_machine_refund_managers (
  reporting_machine_id, manager_user_id, manager_email, status, grant_reason
)
select
  machine.id,
  manager.id,
  manager.email,
  'active',
  'Synthetic Bubble Planet route fixture'
from public.reporting_machines machine
cross join (values
  ('11230000-0000-4000-8000-000000000011'::uuid, 'manager-one@example.test'),
  ('11230000-0000-4000-8000-000000000012'::uuid, 'manager-two@example.test')
) manager(id, email)
where machine.id = any(array[
  '9433f09f-9874-4904-b511-2fa55723e0d7'::uuid,
  '20d475a0-ab75-4a0e-8fa7-14306b63fe29'::uuid,
  '7ae1695c-1394-4a11-843e-3bc594547fed'::uuid
]);

insert into public.refund_cases (
  id, public_reference, reporting_machine_id, reporting_location_id,
  customer_email, issue_summary, incident_at, incident_local_datetime,
  incident_timezone, incident_time_resolution, payment_method,
  payment_amount_cents, refund_amount_cents, card_last4, status,
  correlation_status, intake_source
) values (
  '11230000-0000-4000-8000-000000000021',
  'RF-BUBBLE-HISTORY',
  '9433f09f-9874-4904-b511-2fa55723e0d7',
  '33424c87-38f1-4ad5-9058-8a1814baa294',
  'customer@example.test',
  'Synthetic historical customer input',
  '2026-09-05T19:00:00Z',
  '2026-09-05T12:00',
  'America/Los_Angeles',
  'exact',
  'card',
  700,
  700,
  '4242',
  'needs_review',
  'no_match',
  'form'
);

create temp table bubble_before as
select
  (select to_jsonb(refund_case)
   from public.refund_cases refund_case
   where refund_case.id = '11230000-0000-4000-8000-000000000021') as case_row,
  (select jsonb_agg(to_jsonb(manager) order by manager.reporting_machine_id, manager.manager_user_id)
   from public.reporting_machine_refund_managers manager
   where manager.reporting_machine_id = any(array[
     '9433f09f-9874-4904-b511-2fa55723e0d7'::uuid,
     '20d475a0-ab75-4a0e-8fa7-14306b63fe29'::uuid,
     '7ae1695c-1394-4a11-843e-3bc594547fed'::uuid
   ])) as managers;

select is(
  public.reconcile_refund_bubble_planet_locations() ->> 'status',
  'repaired',
  'The three reviewed locations are repaired atomically'
);

select results_eq(
  $$
    select selection.display_label, selection.location_timezone
    from public.public_refund_selections_v2() selection
    where selection.display_label like 'Bubble Planet%'
    order by selection.display_label
  $$,
  $$ values
    ('Bubble Planet Atlanta — Doraville, GA'::text, 'America/New_York'::text),
    ('Bubble Planet DC — Washington, DC'::text, 'America/New_York'::text),
    ('Bubble Planet Seattle — Bellevue, WA'::text, 'America/Los_Angeles'::text)
  $$,
  'Public intake exposes the reviewed physical city and venue timezone'
);

select is(
  ('2026-09-05 12:00'::timestamp at time zone 'America/New_York'),
  '2026-09-05 16:00:00+00'::timestamptz,
  'Atlanta and DC local noon resolve to the Eastern purchase instant'
);

select is(
  ('2026-09-05 12:00'::timestamp at time zone 'America/Los_Angeles'),
  '2026-09-05 19:00:00+00'::timestamptz,
  'Bellevue local noon resolves to the Pacific purchase instant'
);

select is(
  extract(epoch from (
    ('2026-09-05 12:00'::timestamp at time zone 'America/Los_Angeles') -
    ('2026-09-05 12:00'::timestamp at time zone 'America/New_York')
  ))::integer / 60,
  180,
  'The same reported local clock time cannot collapse Eastern and Pacific matches'
);

select ok(
  (select to_jsonb(refund_case) = bubble_before.case_row
   from public.refund_cases refund_case, bubble_before
   where refund_case.id = '11230000-0000-4000-8000-000000000021'),
  'Historical customer facts and case state remain byte-for-byte unchanged'
);

select ok(
  (select jsonb_agg(to_jsonb(manager) order by manager.reporting_machine_id, manager.manager_user_id) = bubble_before.managers
   from public.reporting_machine_refund_managers manager, bubble_before
   where manager.reporting_machine_id = any(array[
     '9433f09f-9874-4904-b511-2fa55723e0d7'::uuid,
     '20d475a0-ab75-4a0e-8fa7-14306b63fe29'::uuid,
     '7ae1695c-1394-4a11-843e-3bc594547fed'::uuid
   ])
   group by bubble_before.managers),
  'Both existing managers remain assigned to every reviewed machine'
);

select results_eq(
  $$
    select machine.machine_label, machine.nayax_account_key, machine.nayax_machine_id
    from public.reporting_machines machine
    where machine.id = any(array[
      '9433f09f-9874-4904-b511-2fa55723e0d7'::uuid,
      '20d475a0-ab75-4a0e-8fa7-14306b63fe29'::uuid,
      '7ae1695c-1394-4a11-843e-3bc594547fed'::uuid
    ])
    order by machine.machine_label
  $$,
  $$ values
    ('Bubble Planet - Atlanta'::text, 'TGPACI_USA_DB'::text, '403158085'::text),
    ('Bubble Planet DC'::text, 'TGPACI_USA_DB'::text, '938197833'::text),
    ('Bubble Planet Seattle'::text, 'TGPACI_USA_DB'::text, '287196350'::text)
  $$,
  'Provider account and machine identities remain unchanged'
);

select is(
  public.reconcile_refund_bubble_planet_locations() ->> 'status',
  'already_applied',
  'An exact replay is harmless'
);

select is(
  (select count(*)::integer
   from public.admin_audit_log audit
   where audit.action = 'reporting_machine.refund_bubble_planet_location_repair'),
  1,
  'Replay creates no duplicate audit event'
);

select ok(
  not has_function_privilege(
    'service_role',
    'public.reconcile_refund_bubble_planet_locations()',
    'execute'
  )
  and not has_function_privilege(
    'authenticated',
    'public.reconcile_refund_bubble_planet_locations()',
    'execute'
  ),
  'The data repair is not exposed as an application RPC'
);

select * from finish();
rollback;

