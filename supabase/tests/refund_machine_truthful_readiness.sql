begin;

create extension if not exists pgtap with schema extensions;
set local search_path = public, extensions;

select plan(17);

insert into auth.users (
  instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at
) values
  ('00000000-0000-0000-0000-000000000000', 'b0000000-0000-4000-8000-000000000001',
   'authenticated', 'authenticated', 'readiness-owner@example.test', '', now(), '{}'::jsonb, '{}'::jsonb, now(), now()),
  ('00000000-0000-0000-0000-000000000000', 'b0000000-0000-4000-8000-000000000002',
   'authenticated', 'authenticated', 'readiness-user@example.test', '', now(), '{}'::jsonb, '{}'::jsonb, now(), now());

insert into public.admin_roles (user_id, role, active)
values ('b0000000-0000-4000-8000-000000000001', 'super_admin', true);

insert into public.customer_accounts (id, name, account_type)
values ('b0100000-0000-4000-8000-000000000001', 'Truthful readiness test', 'customer');

insert into public.reporting_locations (id, account_id, name, timezone)
values (
  'b0200000-0000-4000-8000-000000000001',
  'b0100000-0000-4000-8000-000000000001',
  'Truthful readiness mall', 'America/Los_Angeles'
);

insert into public.reporting_machines (
  id, account_id, location_id, machine_label, machine_type, status,
  nayax_machine_id, nayax_account_key, refund_intake_enabled,
  refund_public_display_label, nayax_refunds_enabled,
  nayax_refund_max_amount_cents, nayax_refunds_disabled_reason
) values
  ('b0300000-0000-4000-8000-000000000001', 'b0100000-0000-4000-8000-000000000001',
   'b0200000-0000-4000-8000-000000000001', 'Ready machine', 'commercial', 'active',
   'TRUTH-READY-1', 'TRUTH_ACCOUNT', true, 'Ready machine', false, null, 'awaiting_reviewed_activation'),
  ('b0300000-0000-4000-8000-000000000002', 'b0100000-0000-4000-8000-000000000001',
   'b0200000-0000-4000-8000-000000000001', 'Bulk machine', 'commercial', 'active',
   'TRUTH-READY-2', 'TRUTH_ACCOUNT', true, 'Bulk machine', false, null, 'awaiting_reviewed_activation'),
  ('b0300000-0000-4000-8000-000000000003', 'b0100000-0000-4000-8000-000000000001',
   'b0200000-0000-4000-8000-000000000001', 'Exception machine', 'commercial', 'active',
   'TRUTH-READY-3', 'TRUTH_ACCOUNT', true, 'Exception machine', false, null, 'owner_pause');

insert into public.reporting_machine_refund_managers (
  id, reporting_machine_id, manager_user_id, manager_email, grant_reason
) values
  ('b0400000-0000-4000-8000-000000000001', 'b0300000-0000-4000-8000-000000000001',
   'b0000000-0000-4000-8000-000000000001', 'readiness-owner@example.test', 'Truthful readiness test'),
  ('b0400000-0000-4000-8000-000000000002', 'b0300000-0000-4000-8000-000000000002',
   'b0000000-0000-4000-8000-000000000001', 'readiness-owner@example.test', 'Truthful readiness test'),
  ('b0400000-0000-4000-8000-000000000003', 'b0300000-0000-4000-8000-000000000003',
   'b0000000-0000-4000-8000-000000000001', 'readiness-owner@example.test', 'Truthful readiness test');

insert into public.refund_nayax_machine_inventory (
  id, account_key, nayax_machine_id, machine_name, provider_is_active,
  refund_category, reporting_machine_id, reconciliation_state, setup_reason
) values
  ('b0500000-0000-4000-8000-000000000001', 'TRUTH_ACCOUNT', 'TRUTH-READY-1',
   'Ready machine', true, 'cotton_candy', 'b0300000-0000-4000-8000-000000000001', 'published', 'ready'),
  ('b0500000-0000-4000-8000-000000000002', 'TRUTH_ACCOUNT', 'TRUTH-READY-2',
   'Bulk machine', true, 'cotton_candy', 'b0300000-0000-4000-8000-000000000002', 'published', 'ready'),
  ('b0500000-0000-4000-8000-000000000003', 'TRUTH_ACCOUNT', 'TRUTH-READY-3',
   'Exception machine', true, 'cotton_candy', 'b0300000-0000-4000-8000-000000000003', 'published', 'ready');

select ok(
  has_function_privilege('authenticated', 'public.admin_set_refund_machine_card_activation(uuid,boolean,text,text)', 'execute')
  and not has_function_privilege('anon', 'public.admin_set_refund_machine_card_activation(uuid,boolean,text,text)', 'execute'),
  'Only authenticated callers receive the activation RPC surface'
);

select ok(
  has_function_privilege('authenticated', 'public.admin_activate_qualified_refund_machines(text)', 'execute')
  and not has_function_privilege('anon', 'public.admin_activate_qualified_refund_machines(text)', 'execute'),
  'Only authenticated callers receive the reviewed bulk RPC surface'
);

set local role authenticated;
select set_config('request.jwt.claim.sub', 'b0000000-0000-4000-8000-000000000002', true);
select set_config('request.jwt.claims', '{"sub":"b0000000-0000-4000-8000-000000000002","role":"authenticated"}', true);
select throws_ok(
  $$ select public.admin_set_refund_machine_card_activation(
    'b0300000-0000-4000-8000-000000000001', true, null, 'Unauthorized activation test'
  ) $$,
  'Super Admin access required',
  'A normal authenticated user cannot activate machine payments'
);

select set_config('request.jwt.claim.sub', 'b0000000-0000-4000-8000-000000000001', true);
select set_config('request.jwt.claims', '{"sub":"b0000000-0000-4000-8000-000000000001","role":"authenticated"}', true);

select ok(
  (
    select machine ->> 'readinessState' = 'ready_to_activate'
      and machine ->> 'customerIntakeAccepting' = 'true'
      and machine ->> 'transactionLookupReady' = 'true'
      and machine ->> 'managerRoutingReady' = 'true'
      and machine ->> 'nayaxRefundsEnabled' = 'false'
      and machine ->> 'paymentDisabledReason' = 'awaiting_reviewed_activation'
    from jsonb_array_elements(public.admin_get_refund_manager_setup() -> 'machines') machine
    where machine ->> 'id' = 'b0300000-0000-4000-8000-000000000001'
  ),
  'The Admin contract reports every capability and a truthful ready-to-activate state'
);

select is(
  public.admin_set_refund_machine_card_activation(
    'b0300000-0000-4000-8000-000000000001', true, null, 'Reviewed test activation'
  ) ->> 'replayed',
  'false',
  'A qualified machine activates through one reviewed action'
);

select ok(
  (select nayax_refunds_enabled
     and nayax_refund_max_amount_cents = 5000
     and nayax_refunds_disabled_reason is null
   from public.reporting_machines where id = 'b0300000-0000-4000-8000-000000000001'),
  'Activation always applies the $50 launch limit and clears the disabled reason'
);

select is(
  (select count(*)::integer from public.admin_audit_log
   where entity_id = 'b0300000-0000-4000-8000-000000000001'
     and action = 'reporting_machine.card_refunds.activated'),
  1,
  'Activation writes one redacted audit record'
);

select is(
  public.admin_set_refund_machine_card_activation(
    'b0300000-0000-4000-8000-000000000001', true, null, 'Reviewed test activation replay'
  ) ->> 'replayed',
  'true',
  'An exact activation replay succeeds without another mutation'
);

select is(
  (select count(*)::integer from public.admin_audit_log
   where entity_id = 'b0300000-0000-4000-8000-000000000001'
     and action = 'reporting_machine.card_refunds.activated'),
  1,
  'An activation replay creates no duplicate audit event'
);

select throws_ok(
  $$ select public.admin_set_refund_machine_card_activation(
    'b0300000-0000-4000-8000-000000000001', false, null, 'Missing pause reason test'
  ) $$,
  'Choose an approved reason before pausing card refunds',
  'Rollback fails closed without an approved visible reason'
);

select is(
  public.admin_set_refund_machine_card_activation(
    'b0300000-0000-4000-8000-000000000001', false, 'owner_pause', 'Reviewed owner pause test'
  ) ->> 'replayed',
  'false',
  'A reviewed pause rolls the machine payment gate back safely'
);

select ok(
  (select not nayax_refunds_enabled
     and nayax_refund_max_amount_cents is null
     and nayax_refunds_disabled_reason = 'owner_pause'
   from public.reporting_machines where id = 'b0300000-0000-4000-8000-000000000001'),
  'Rollback clears the payment cap and preserves the approved reason'
);

update public.refund_nayax_machine_inventory
set reconciliation_state = 'needs_setup'
where id = 'b0500000-0000-4000-8000-000000000002';
update public.reporting_machines
set nayax_refunds_disabled_reason = null
where id = 'b0300000-0000-4000-8000-000000000002';
update public.refund_nayax_machine_inventory
set reconciliation_state = 'published'
where id = 'b0500000-0000-4000-8000-000000000002';

select is(
  (select nayax_refunds_disabled_reason from public.reporting_machines
   where id = 'b0300000-0000-4000-8000-000000000002'),
  'awaiting_reviewed_activation',
  'A mapping or inventory repair cannot silently publish with an unknown payment-disabled state'
);

select is(
  public.admin_set_refund_machine_card_activation(
    'b0300000-0000-4000-8000-000000000001', false, 'owner_pause', 'Reviewed owner pause replay'
  ) ->> 'replayed',
  'true',
  'An exact pause replay is mutation-free'
);

select is(
  (select count(*)::integer from public.admin_audit_log
   where entity_id = 'b0300000-0000-4000-8000-000000000001'
     and action = 'reporting_machine.card_refunds.paused'),
  1,
  'Pause and replay leave exactly one pause audit event'
);

select ok(
  (select result ->> 'activatedCount' = '1'
      and result ->> 'approvedExceptionCount' = '2'
   from (select public.admin_activate_qualified_refund_machines(
     'Reviewed qualified machine test activation'
   ) result) activation),
  'Bulk activation enables waiting machines while preserving approved pause exceptions'
);

select ok(
  (select nayax_refunds_enabled and nayax_refund_max_amount_cents = 5000
   from public.reporting_machines where id = 'b0300000-0000-4000-8000-000000000002')
  and (select not nayax_refunds_enabled and nayax_refunds_disabled_reason = 'owner_pause'
   from public.reporting_machines where id = 'b0300000-0000-4000-8000-000000000003'),
  'Bulk activation applies the standard cap and never overrides an approved exception'
);

reset role;
select * from finish();
rollback;
