begin;
create extension if not exists pgtap with schema extensions;
set local search_path = public, extensions;
select no_plan();

select is(
  public.reconcile_valley_mall_product_unknown() ->> 'skipped',
  'true',
  'Clean databases skip the production-specific correction'
);

insert into public.customer_accounts (id, name, account_type)
values (
  '11950000-0000-4000-8000-000000000001',
  'Valley Mall synthetic fixture',
  'internal'
);

insert into public.reporting_locations (
  id, account_id, name, city, state, timezone, status
) values (
  '806bb025-eb06-4c53-b11b-35e782646f51',
  '11950000-0000-4000-8000-000000000001',
  'Valley Mall',
  'Hagerstown',
  'MD',
  'America/New_York',
  'active'
);

insert into public.reporting_machines (
  id, account_id, location_id, machine_label, machine_type, status,
  nayax_account_key, nayax_machine_id, nayax_refunds_enabled,
  refund_intake_enabled, refund_public_display_label
) values
  (
    'f77bc8a8-71b3-4300-8a76-c935b8b1972f',
    '11950000-0000-4000-8000-000000000001',
    '806bb025-eb06-4c53-b11b-35e782646f51',
    'Preit1085-Valley mall',
    'commercial',
    'active',
    'TGPACI_USA_DB',
    '224560057',
    false,
    true,
    'Valley Mall — Cotton Candy'
  ),
  (
    '11950000-0000-4000-8000-000000000099',
    '11950000-0000-4000-8000-000000000001',
    '806bb025-eb06-4c53-b11b-35e782646f51',
    'Unrelated exact-target sentinel',
    'commercial',
    'active',
    'TGPACI_USA_DB',
    '119500099',
    false,
    true,
    'Valley Mall — unrelated sentinel'
  );

insert into auth.users (
  id, aud, role, email, raw_app_meta_data, raw_user_meta_data
) values (
  '11950000-0000-4000-8000-000000000011',
  'authenticated',
  'authenticated',
  'valley-manager@example.test',
  '{"provider":"email","providers":["email"]}',
  '{}'
);

insert into public.reporting_machine_refund_managers (
  id, reporting_machine_id, manager_user_id, manager_email, status, grant_reason
) values (
  '11950000-0000-4000-8000-000000000012',
  'f77bc8a8-71b3-4300-8a76-c935b8b1972f',
  '11950000-0000-4000-8000-000000000011',
  'valley-manager@example.test',
  'active',
  'Synthetic manager route preservation fixture'
);

insert into public.refund_nayax_machine_inventory (
  id, account_key, nayax_machine_id, machine_name, machine_number,
  nayax_machine_type_id, provider_status_bit, provider_is_active,
  first_seen_at, last_seen_at, last_successful_sync_at,
  missing_successful_snapshots, refund_category, reporting_machine_id,
  reconciliation_state, setup_reason, decision_reason
) values
  (
    '1d7d0d06-5586-4233-ba6b-cad55fe4edab',
    'TGPACI_USA_DB',
    '224560057',
    'Preit1085-Valley mall',
    '434334924111783AutoI&IBl',
    '30000527',
    1,
    true,
    '2026-08-22T00:00:00Z',
    '2026-09-06T00:00:00Z',
    '2026-09-06T00:00:00Z',
    0,
    'cotton_candy',
    'f77bc8a8-71b3-4300-8a76-c935b8b1972f',
    'published',
    'ready',
    'Synthetic unsupported product assertion'
  ),
  (
    '11950000-0000-4000-8000-000000000098',
    'TGPACI_USA_DB',
    '119500099',
    'Unrelated exact-target sentinel',
    'sentinel-number',
    '30000527',
    1,
    true,
    '2026-08-22T00:00:00Z',
    '2026-09-06T00:00:00Z',
    '2026-09-06T00:00:00Z',
    0,
    'cotton_candy',
    '11950000-0000-4000-8000-000000000099',
    'published',
    'ready',
    'Synthetic untouched row'
  );

insert into public.refund_cases (
  id, public_reference, reporting_machine_id, reporting_location_id,
  customer_email, issue_summary, incident_at, payment_method,
  payment_amount_cents, status, correlation_status,
  intake_selection_kind, intake_selection_machine_ids
) values (
  '11950000-0000-4000-8000-000000000021',
  'RF-VALLEY-HISTORY',
  'f77bc8a8-71b3-4300-8a76-c935b8b1972f',
  '806bb025-eb06-4c53-b11b-35e782646f51',
  'valley-customer@example.test',
  'Synthetic historical phone-case report',
  '2026-09-05T19:00:00Z',
  'card',
  700,
  'needs_review',
  'no_match',
  'exact_machine',
  array['f77bc8a8-71b3-4300-8a76-c935b8b1972f'::uuid]
);

insert into public.refund_nayax_lookup_candidates (
  token, refund_case_id, provider_transaction_id,
  machine_authorization_time, amount_cents, currency_code, evidence_summary
) values (
  '11950000-0000-4000-8000-000000000022',
  '11950000-0000-4000-8000-000000000021',
  'valley.synthetic.1195',
  '2026-09-05T19:00:00Z',
  700,
  'USD',
  '{"selection":"Selection 1","product":"unverified"}'
);

insert into public.refund_case_events (
  id, refund_case_id, event_type, message, metadata
) values (
  '11950000-0000-4000-8000-000000000023',
  '11950000-0000-4000-8000-000000000021',
  'synthetic_history',
  'Existing case history must remain unchanged',
  '{"fixture":"valley-1195"}'
);

insert into public.refund_case_messages (
  id, refund_case_id, message_type, status, recipient_email, subject, body
) values (
  '11950000-0000-4000-8000-000000000024',
  '11950000-0000-4000-8000-000000000021',
  'manual_note',
  'skipped',
  'valley-customer@example.test',
  'Synthetic preserved message',
  'No message is sent by this correction.'
);

update public.refund_nayax_machine_inventory
set machine_number = 'identity-drift'
where id = '1d7d0d06-5586-4233-ba6b-cad55fe4edab';

select throws_ok(
  $$ select public.reconcile_valley_mall_product_unknown() $$,
  'Reviewed Valley Mall provider identity has changed',
  'The correction fails closed when the reviewed immutable identity drifts'
);

update public.refund_nayax_machine_inventory
set machine_number = '434334924111783AutoI&IBl'
where id = '1d7d0d06-5586-4233-ba6b-cad55fe4edab';

create temp table valley_before as
select
  (select to_jsonb(inventory)
   from public.refund_nayax_machine_inventory inventory
   where inventory.id = '1d7d0d06-5586-4233-ba6b-cad55fe4edab') as inventory_row,
  (select to_jsonb(machine)
   from public.reporting_machines machine
   where machine.id = 'f77bc8a8-71b3-4300-8a76-c935b8b1972f') as machine_row,
  (select jsonb_agg(to_jsonb(manager) order by manager.id)
   from public.reporting_machine_refund_managers manager
   where manager.reporting_machine_id = 'f77bc8a8-71b3-4300-8a76-c935b8b1972f') as managers,
  (select to_jsonb(refund_case)
   from public.refund_cases refund_case
   where refund_case.id = '11950000-0000-4000-8000-000000000021') as case_row,
  (select to_jsonb(candidate)
   from public.refund_nayax_lookup_candidates candidate
   where candidate.token = '11950000-0000-4000-8000-000000000022') as candidate_row,
  (select jsonb_agg(to_jsonb(event) order by event.id)
   from public.refund_case_events event
   where event.refund_case_id = '11950000-0000-4000-8000-000000000021') as history_rows,
  (select jsonb_agg(to_jsonb(message) order by message.id)
   from public.refund_case_messages message
   where message.refund_case_id = '11950000-0000-4000-8000-000000000021') as message_rows,
  (select count(*) from public.refund_case_nayax_refund_attempts
   where refund_case_id = '11950000-0000-4000-8000-000000000021') as attempt_count,
  (select count(*) from public.refund_case_official_action_authorizations
   where refund_case_id = '11950000-0000-4000-8000-000000000021') as authorization_count;

select is(
  public.reconcile_valley_mall_product_unknown() ->> 'alreadyApplied',
  'false',
  'The exact correction applies once'
);

select ok(
  (
    select inventory.account_key = 'TGPACI_USA_DB'
      and inventory.nayax_machine_id = '224560057'
      and inventory.machine_number = '434334924111783AutoI&IBl'
      and inventory.refund_category = 'unknown'
      and inventory.reconciliation_state = 'published'
      and inventory.setup_reason = 'ready'
      and inventory.reporting_machine_id = 'f77bc8a8-71b3-4300-8a76-c935b8b1972f'::uuid
    from public.refund_nayax_machine_inventory inventory
    where inventory.id = '1d7d0d06-5586-4233-ba6b-cad55fe4edab'
  ),
  'Only the product category changes on the exact provider row'
);

select ok(
  (
    select machine.machine_type = 'unknown'
      and machine.refund_public_display_label = 'Valley Mall — product type unverified'
      and machine.location_id = '806bb025-eb06-4c53-b11b-35e782646f51'::uuid
      and machine.refund_intake_enabled
      and not machine.nayax_refunds_enabled
    from public.reporting_machines machine
    where machine.id = 'f77bc8a8-71b3-4300-8a76-c935b8b1972f'
  ),
  'Manager-facing machine truth is explicit while intake and payment settings are preserved'
);

select results_eq(
  $$
    select option.machine_label, option.location_name, option.location_timezone
    from public.public_refund_machine_options() option
    where option.machine_id = 'f77bc8a8-71b3-4300-8a76-c935b8b1972f'
  $$,
  $$ values (
    'Valley Mall — product type unverified'::text,
    'Valley Mall'::text,
    'America/New_York'::text
  ) $$,
  'Public machine intake keeps the exact route without a product assertion'
);

select ok(
  exists (
    select 1
    from public.public_refund_selections_v2() selection
    where selection.machine_id = 'f77bc8a8-71b3-4300-8a76-c935b8b1972f'
      and selection.location_timezone = 'America/New_York'
  ),
  'The customer-facing selection RPC still reaches the exact Valley Mall machine'
);

select is(
  (select jsonb_agg(to_jsonb(manager) order by manager.id)
   from public.reporting_machine_refund_managers manager
   where manager.reporting_machine_id = 'f77bc8a8-71b3-4300-8a76-c935b8b1972f'),
  (select managers from valley_before),
  'Manager assignments are byte-for-byte unchanged'
);

select is(
  (select to_jsonb(refund_case)
   from public.refund_cases refund_case
   where refund_case.id = '11950000-0000-4000-8000-000000000021'),
  (select case_row from valley_before),
  'Existing case fields and exact-machine selection binding are unchanged'
);

select is(
  (select to_jsonb(candidate)
   from public.refund_nayax_lookup_candidates candidate
   where candidate.token = '11950000-0000-4000-8000-000000000022'),
  (select candidate_row from valley_before),
  'Candidate token and reviewed evidence are unchanged'
);

select is(
  (select jsonb_agg(to_jsonb(event) order by event.id)
   from public.refund_case_events event
   where event.refund_case_id = '11950000-0000-4000-8000-000000000021'),
  (select history_rows from valley_before),
  'Existing case history is unchanged'
);

select is(
  (select jsonb_agg(to_jsonb(message) order by message.id)
   from public.refund_case_messages message
   where message.refund_case_id = '11950000-0000-4000-8000-000000000021'),
  (select message_rows from valley_before),
  'No customer message is created or changed'
);

select is(
  (select count(*) from public.refund_case_nayax_refund_attempts
   where refund_case_id = '11950000-0000-4000-8000-000000000021'),
  (select attempt_count from valley_before),
  'No selection or refund attempt is created'
);

select is(
  (select count(*) from public.refund_case_official_action_authorizations
   where refund_case_id = '11950000-0000-4000-8000-000000000021'),
  (select authorization_count from valley_before),
  'No approval or payment authorization is created'
);

select ok(
  (
    select inventory.refund_category = 'cotton_candy'
      and inventory.decision_reason = 'Synthetic untouched row'
    from public.refund_nayax_machine_inventory inventory
    where inventory.id = '11950000-0000-4000-8000-000000000098'
  ) and (
    select machine.machine_type = 'commercial'
      and machine.refund_public_display_label = 'Valley Mall — unrelated sentinel'
    from public.reporting_machines machine
    where machine.id = '11950000-0000-4000-8000-000000000099'
  ),
  'No other provider or reporting-machine row is changed'
);

select is(
  public.reconcile_valley_mall_product_unknown() ->> 'alreadyApplied',
  'true',
  'Exact replay is harmless'
);

select is(
  (select count(*)::integer
   from public.admin_audit_log
   where action = 'refund_nayax_inventory.valley_mall_product_unknown'),
  1,
  'Replay creates no duplicate audit event'
);

select ok(
  not has_function_privilege(
    'service_role',
    'public.reconcile_valley_mall_product_unknown()',
    'execute'
  )
  and not has_function_privilege(
    'authenticated',
    'public.reconcile_valley_mall_product_unknown()',
    'execute'
  )
  and not has_function_privilege(
    'anon',
    'public.reconcile_valley_mall_product_unknown()',
    'execute'
  ),
  'The one-time correction is not callable by browser or service roles'
);

select * from finish();
rollback;
