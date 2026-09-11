begin;

create extension if not exists pgtap with schema extensions;
set local search_path = public, extensions;
select plan(9);

insert into auth.users (
  instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at
) values (
  '00000000-0000-0000-0000-000000000000',
  '12800000-0000-4000-8000-000000000001',
  'authenticated', 'authenticated', 'manager-1280@example.invalid', '', now(),
  '{}'::jsonb, '{}'::jsonb, now(), now()
);

insert into public.customer_accounts (id, name, account_type)
values ('12810000-0000-4000-8000-000000000001', 'Manager email test', 'customer');

insert into public.reporting_locations (id, account_id, name, timezone)
values (
  '12820000-0000-4000-8000-000000000001',
  '12810000-0000-4000-8000-000000000001',
  'Unmapped internal inventory', 'America/Los_Angeles'
);

insert into public.reporting_machines (
  id, account_id, location_id, machine_label, refund_public_display_label
) values (
  '12830000-0000-4000-8000-000000000001',
  '12810000-0000-4000-8000-000000000001',
  '12820000-0000-4000-8000-000000000001',
  'Private provider machine label', 'Lobby treats'
);

insert into public.reporting_machine_refund_managers (
  id, reporting_machine_id, manager_user_id, manager_email, grant_reason
) values (
  '12840000-0000-4000-8000-000000000001',
  '12830000-0000-4000-8000-000000000001',
  '12800000-0000-4000-8000-000000000001',
  'manager-1280@example.invalid', 'Synthetic manager email test'
);

insert into public.refund_cases (
  id, public_reference, reporting_machine_id, reporting_location_id,
  customer_email, customer_name, issue_summary, incident_at, payment_method,
  payment_amount_cents, card_last4, status, automation_state, created_at
) values (
  '12850000-0000-4000-8000-000000000001', 'RF-SAFE-1280',
  '12830000-0000-4000-8000-000000000001',
  '12820000-0000-4000-8000-000000000001',
  'customer-private@example.invalid', 'Private Customer',
  'Private complaint text must never leave the portal.',
  '2026-09-08T12:00:00Z', 'card', 725, '4242', 'needs_review',
  'under_review', '2026-09-08T12:00:00Z'
);

create temporary table manager_email_context as
select public.service_get_refund_manager_action_email_context(
  '12850000-0000-4000-8000-000000000001',
  'provider_unknown',
  '2026-09-10T16:00:00Z'
) as value;

select is((select value ->> 'schemaVersion' from manager_email_context),
  'refund_manager_action_email_v1', 'Email context has a stable schema');
select is((select (value ->> 'ageMinutes')::integer from manager_email_context),
  3120, 'Email context age is deterministic from the supplied observation time');
select is((select value ->> 'machineLabel' from manager_email_context),
  'Lobby treats', 'Only the public machine label is exposed');
select is((
  select jsonb_agg(key order by key)
  from manager_email_context
  cross join lateral jsonb_object_keys(value) as keys(key)
), '["actionCode","actionOwner","ageMinutes","amountCents","currencyCode","lifecycleActor","locationName","machineLabel","payloadRedacted","paymentMethodCategory","publicReference","queueLabel","schemaVersion","whatChanged"]'::jsonb,
  'Email context exposes only the fixed allowlist');
select is((select value ->> 'locationName' from manager_email_context),
  'Lobby treats', 'Internal location placeholders use the approved public label');

select set_config(
  'request.jwt.claims',
  '{"sub":"12800000-0000-4000-8000-000000000001","role":"authenticated","is_anonymous":false}',
  true
);
select is(
  (select value ->> 'actionCode' from manager_email_context),
  public.get_refund_lifecycle_for_manager(
    '12850000-0000-4000-8000-000000000001'
  ) #>> '{managerAction,action}',
  'Email action is the same server-owned action shown in the manager portal'
);
select is(
  (select value ->> 'lifecycleActor' from manager_email_context),
  public.get_refund_lifecycle_for_manager(
    '12850000-0000-4000-8000-000000000001'
  ) ->> 'actor',
  'Email actor is the same server-owned actor shown in the manager portal'
);
select ok(
  not ((select value::text from manager_email_context) like any (array[
    '%customer-private@example.invalid%', '%Private Customer%',
    '%Private complaint%', '%4242%', '%Private provider machine label%',
    '%Unmapped internal inventory%'
  ])),
  'Email context omits customer, complaint, card, and private provider fields'
);
select ok(
  not has_function_privilege(
    'authenticated',
    'public.service_get_refund_manager_action_email_context(uuid,text,timestamptz)',
    'execute'
  ),
  'Browser sessions cannot read manager email context'
);

select * from finish();
rollback;
