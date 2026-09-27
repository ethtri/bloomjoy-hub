begin;

create extension if not exists pgtap with schema extensions;
set local search_path = public, extensions;

select plan(10);

insert into auth.users (
  instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at
)
values
  ('00000000-0000-0000-0000-000000000000', 'b2100000-0000-4000-8000-000000000001', 'authenticated', 'authenticated', 'contacts-super@example.invalid', '', now(), '{}'::jsonb, '{}'::jsonb, now(), now()),
  ('00000000-0000-0000-0000-000000000000', 'b2100000-0000-4000-8000-000000000002', 'authenticated', 'authenticated', 'contacts-scoped@example.invalid', '', now(), '{}'::jsonb, '{}'::jsonb, now(), now()),
  ('00000000-0000-0000-0000-000000000000', 'b2100000-0000-4000-8000-000000000003', 'authenticated', 'authenticated', 'contacts-visible@example.invalid', '', now(), '{}'::jsonb, '{}'::jsonb, now(), now()),
  ('00000000-0000-0000-0000-000000000000', 'b2100000-0000-4000-8000-000000000004', 'authenticated', 'authenticated', 'contacts-hidden@example.invalid', '', now(), '{}'::jsonb, '{}'::jsonb, now(), now());

insert into public.admin_roles (user_id, role, active)
values ('b2100000-0000-4000-8000-000000000001', 'super_admin', true);

insert into public.customer_accounts (id, name, account_type)
values
  ('b2200000-0000-4000-8000-000000000001', 'Contact scope A', 'internal'),
  ('b2200000-0000-4000-8000-000000000002', 'Contact scope B', 'internal');

insert into public.reporting_locations (id, account_id, name, timezone)
values
  ('b2300000-0000-4000-8000-000000000001', 'b2200000-0000-4000-8000-000000000001', 'Contact location A', 'America/Los_Angeles'),
  ('b2300000-0000-4000-8000-000000000002', 'b2200000-0000-4000-8000-000000000002', 'Contact location B', 'America/Los_Angeles');

insert into public.reporting_machines (id, account_id, location_id, machine_label, machine_type)
values
  ('b2400000-0000-4000-8000-000000000001', 'b2200000-0000-4000-8000-000000000001', 'b2300000-0000-4000-8000-000000000001', 'Contact machine A', 'commercial'),
  ('b2400000-0000-4000-8000-000000000002', 'b2200000-0000-4000-8000-000000000002', 'b2300000-0000-4000-8000-000000000002', 'Contact machine B', 'commercial');

insert into public.customer_account_memberships (account_id, user_id, email, role, active)
values
  ('b2200000-0000-4000-8000-000000000001', 'b2100000-0000-4000-8000-000000000003', 'contacts-visible@example.invalid', 'owner', true),
  ('b2200000-0000-4000-8000-000000000002', 'b2100000-0000-4000-8000-000000000004', 'contacts-hidden@example.invalid', 'owner', true);

insert into public.customer_profiles (
  user_id, full_name, phone, shipping_street_1, shipping_city,
  shipping_state, shipping_postal_code, shipping_country
)
values
  ('b2100000-0000-4000-8000-000000000003', 'Visible Contact', '+1 555 010 2100', '100 Profile Street', 'Los Angeles', 'CA', '90001', 'US'),
  ('b2100000-0000-4000-8000-000000000004', 'Hidden Contact', '+1 555 010 2200', '200 Hidden Street', 'Seattle', 'WA', '98101', 'US');

insert into public.operator_contact_details (
  user_id, contact_email, contact_phone, mailing_address
)
values (
  'b2100000-0000-4000-8000-000000000003',
  'visible.operations@example.invalid',
  '+1 555 010 2199',
  E'PO Box 99\nLos Angeles, CA 90001'
);

insert into public.admin_scoped_access_grants (
  id, user_id, grant_reason, granted_by
)
values (
  'b2500000-0000-4000-8000-000000000001',
  'b2100000-0000-4000-8000-000000000002',
  'Contact directory scope test',
  'b2100000-0000-4000-8000-000000000001'
);

insert into public.admin_scoped_access_scopes (
  grant_id, scope_type, machine_id, grant_reason, granted_by
)
values (
  'b2500000-0000-4000-8000-000000000001',
  'machine',
  'b2400000-0000-4000-8000-000000000001',
  'Contact directory scope test',
  'b2100000-0000-4000-8000-000000000001'
);

select ok(
  not has_function_privilege('anon', 'public.admin_list_access_people(text,text,uuid,text,uuid,integer,integer)', 'execute'),
  'Anonymous callers cannot execute the contact-enriched people directory'
);

set local role authenticated;
select set_config('request.jwt.claim.sub', 'b2100000-0000-4000-8000-000000000002', true);

select is(
  (public.admin_list_access_people() ->> 'totalCount')::integer,
  1,
  'A Scoped Admin receives only people in the assigned machine scope'
);
select is(
  public.admin_list_access_people() #>> '{items,0,contactEmail}',
  'visible.operations@example.invalid',
  'The protected operational email takes precedence over the access email'
);
select is(
  public.admin_list_access_people() #>> '{items,0,contactPhone}',
  '+1 555 010 2199',
  'The protected operational phone is returned for an in-scope person'
);
select is(
  public.admin_list_access_people() #>> '{items,0,mailingAddress}',
  E'PO Box 99\nLos Angeles, CA 90001',
  'The protected operational address is returned for an in-scope person'
);
select is(
  (public.admin_list_access_people() -> 'items') @> '[{"userId":"b2100000-0000-4000-8000-000000000004"}]'::jsonb,
  false,
  'An out-of-scope person is absent from the Scoped Admin response'
);
select is(
  public.admin_list_access_people('contacts-hidden@example.invalid') -> 'items',
  '[]'::jsonb,
  'Searching cannot reveal an out-of-scope contact'
);

reset role;
set local role authenticated;
select set_config('request.jwt.claim.sub', 'b2100000-0000-4000-8000-000000000001', true);

select is(
  (public.admin_list_access_people() ->> 'totalCount')::integer,
  4,
  'A Super Admin receives every directory person in this isolated fixture'
);
select is(
  public.admin_list_access_people('contacts-hidden@example.invalid') #>> '{items,0,contactPhone}',
  '+1 555 010 2200',
  'Customer profile phone is used when no operational contact exists'
);
select is(
  public.admin_list_access_people('contacts-hidden@example.invalid') #>> '{items,0,mailingAddress}',
  E'200 Hidden Street\nSeattle, WA 98101\nUS',
  'Customer shipping fields are formatted as the fallback address'
);

select * from finish();
rollback;
