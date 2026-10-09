begin;

create extension if not exists pgtap with schema extensions;
set local search_path = public, extensions;
select plan(35);

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
  id, account_id, location_id, machine_label, refund_public_display_label, machine_display_name
) values (
  '12830000-0000-4000-8000-000000000001',
  '12810000-0000-4000-8000-000000000001',
  '12820000-0000-4000-8000-000000000001',
  'Private provider machine label', 'Lobby treats', 'Atrium cotton candy'
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
  E'Spinner stopped.\nPrivate Customer customer-private@example.invalid card ending 4242. https://example.invalid/private',
  '2026-09-08T12:00:00Z', 'card', 725, '4242', 'needs_review',
  'under_review', '2026-09-08T12:00:00Z'
);

create temporary table manager_email_context as
select public.service_get_refund_manager_action_email_context_v2(
  '12850000-0000-4000-8000-000000000001',
  'provider_unknown',
  '2026-09-10T16:00:00Z'
) as value;

-- Old deployed workers still consume the exact original v1 projection.
create temporary table legacy_manager_email_context as
select public.service_get_refund_manager_action_email_context(
 '12850000-0000-4000-8000-000000000001','provider_unknown','2026-09-10T16:00Z') value;
select is((select jsonb_agg(key order by key) from legacy_manager_email_context
 cross join lateral jsonb_object_keys(value) keys(key)),
 '["actionCode","actionOwner","ageMinutes","amountCents","currencyCode","lifecycleActor","locationName","machineLabel","payloadRedacted","paymentMethodCategory","publicReference","queueLabel","schemaVersion","whatChanged"]'::jsonb,
 'Legacy v1 keys stay unchanged for strict deployed parsers');
select is((select value->>'machineLabel' from legacy_manager_email_context),'Atrium cotton candy',
 'Legacy v1 reads the public label synchronized by the existing Machine name trigger');
select ok((select value::text not like '%Spinner stopped%' from legacy_manager_email_context),
 'Legacy v1 still excludes complaint text');
select ok(not has_function_privilege('authenticated',
 'public.service_get_refund_manager_action_email_context(uuid,text,timestamptz)','execute'),
 'Legacy v1 remains inaccessible to browser sessions');
select ok(has_function_privilege('service_role',
 'public.service_get_refund_manager_action_email_context(uuid,text,timestamptz)','execute'),
 'Legacy v1 remains available to old server workers');

select is((select value ->> 'schemaVersion' from manager_email_context),
  'refund_manager_action_email_v1', 'Email context has a stable schema');
select is((select (value ->> 'ageMinutes')::integer from manager_email_context),
  3120, 'Email context age is deterministic from the supplied observation time');
select is((select value ->> 'machineLabel' from manager_email_context),
  'Atrium cotton candy', 'Effective Machine name overrides public and imported labels');
select is((
  select jsonb_agg(key order by key)
  from manager_email_context
  cross join lateral jsonb_object_keys(value) as keys(key)
), '["actionCode","actionOwner","ageMinutes","amountCents","currencyCode","customerCommentExcerpt","issueLabel","lifecycleActor","locationName","machineLabel","payloadRedacted","paymentMethodCategory","paymentOutcomeUnknown","publicReference","queueLabel","requestedAmountCents","requestedCurrencyCode","schemaVersion","whatChanged"]'::jsonb,
  'Email context exposes only the fixed allowlist');
select is((select value ->> 'locationName' from manager_email_context),
  'Atrium cotton candy', 'Internal location placeholders use the synchronized public Machine name');

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
    '%4242%', '%Private provider machine label%', '%https://example.invalid%',
    '%Unmapped internal inventory%'
  ])),
  'Email context omits contact, card, links, and private provider fields'
);
select ok(
  not has_function_privilege(
    'authenticated',
    'public.service_get_refund_manager_action_email_context_v2(uuid,text,timestamptz)',
    'execute'
  ),
  'Browser sessions cannot read manager email context'
);

select is((select value->>'requestedAmountCents' from manager_email_context),null::text,
 'Legacy payment amount is not guessed to be the original requested amount');
select is((select value->>'requestedCurrencyCode' from manager_email_context),null::text,
 'Legacy currency is not guessed');
select is((select value->>'paymentOutcomeUnknown' from manager_email_context),'false',
 'Unknown lookup notice does not imply a payment has an unknown outcome');
select ok((select value->>'customerCommentExcerpt' like 'Spinner stopped.%' from manager_email_context),
 'Useful customer-reported symptom remains intact');
select ok((select value->>'customerCommentExcerpt' !~ '[[:cntrl:]]' from manager_email_context),
 'Narrative has no control characters');
select ok(not has_function_privilege('anon',
 'public.service_get_refund_manager_action_email_context_v2(uuid,text,timestamptz)','execute'),
 'Anonymous sessions cannot read manager email context');
select ok(has_function_privilege('service_role',
 'public.service_get_refund_manager_action_email_context_v2(uuid,text,timestamptz)','execute'),
 'Existing server-only execution remains available');

-- Seed original intake evidence, then deliberately different selected/paid values.
-- Disable triggers only for synthetic fixture changes, never for assertions.
set local session_replication_role=replica;
update public.refund_cases set issue_category='charged_no_product',refund_amount_cents=1090,
 payment_amount_cents=1250,matched_nayax_amount_cents=1090,matched_nayax_currency_code='CAD',
 customer_request_received_source='hosted_refund_intake',customer_request_received_at='2026-09-08T12:00Z'
 where id='12850000-0000-4000-8000-000000000001';
insert into private.refund_request_recognition_events(event_key,refund_case_id,event_kind,effective_at,recorded_at,
 tender,source,request_target_before_cents,request_target_after_cents,amount_basis,amount_provenance) values
 ('notice:opening','12850000-0000-4000-8000-000000000001','request_received',
 '2026-09-08T12:00Z','2026-09-08T12:00Z','card','hosted_refund_intake',0,1000,
 'tax_inclusive','hosted_intake_customer_charge_estimate');
set local session_replication_role=origin;
update manager_email_context set value=public.service_get_refund_manager_action_email_context_v2(
 '12850000-0000-4000-8000-000000000001','provider_setup','2026-09-10T16:00Z');
select is((select value->>'requestedAmountCents' from manager_email_context),'1000',
 'Original intake amount stays distinct from selected, current payment and refund amounts');
select is((select value->>'requestedCurrencyCode' from manager_email_context),'USD',
 'Hosted intake provenance establishes requested USD independently of provider currency');
select is((select value->>'amountCents' from manager_email_context),'1090',
 'Legacy amount semantics remain compatible');
select is((select value->>'currencyCode' from manager_email_context),'CAD',
 'Legacy provider currency remains compatible');
select is((select value->>'issueLabel' from manager_email_context),'Paid, but no product',
 'Selected issue uses a customer-readable label');

set local session_replication_role=replica;
update public.refund_cases set issue_summary=repeat('Spins without dispensing. 🍬 ',30)
 where id='12850000-0000-4000-8000-000000000001';
set local session_replication_role=origin;
select is(char_length(public.service_get_refund_manager_action_email_context_v2(
 '12850000-0000-4000-8000-000000000001','provider_setup')->>'customerCommentExcerpt'),320,
 'Narrative is bounded at 320 characters, including Unicode');

set local session_replication_role=replica;
update public.refund_cases set issue_summary=E' \n\t ',issue_category='other'
 where id='12850000-0000-4000-8000-000000000001';
set local session_replication_role=origin;
update manager_email_context set value=public.service_get_refund_manager_action_email_context_v2(
 '12850000-0000-4000-8000-000000000001','provider_setup');
select is((select value->>'customerCommentExcerpt' from manager_email_context),null::text,
 'Absent useful comments remain absent');
select is((select value->>'issueLabel' from manager_email_context),'Other issue',
 'Other issue is preserved without an inferred diagnosis');

set local session_replication_role=replica;
update public.refund_cases set status='card_refund_pending'
 where id='12850000-0000-4000-8000-000000000001';
set local session_replication_role=origin;
select is(public.refund_lifecycle_contract('12850000-0000-4000-8000-000000000001')->>'paymentState',
 'integrity_unknown','Synthetic inconsistent payment state is a canonical verification hold');
select is(public.service_get_refund_manager_action_email_context_v2(
 '12850000-0000-4000-8000-000000000001','provider_unknown')->>'paymentOutcomeUnknown','true',
 'Verification caution follows canonical payment truth rather than notice reason');

set local session_replication_role=replica;
update public.reporting_machine_refund_managers set status='revoked',revoked_at=now()
 where id='12840000-0000-4000-8000-000000000001';
update public.refund_cases set issue_summary='Spinner stopped.',issue_category='charged_no_product',status='needs_review'
 where id='12850000-0000-4000-8000-000000000001';
set local session_replication_role=origin;
update manager_email_context set value=public.service_get_refund_manager_action_email_context_v2(
 '12850000-0000-4000-8000-000000000001','provider_setup');
select is((select value->'requestedAmountCents' from manager_email_context),'null'::jsonb,
 'No current assigned manager means no added requested amount');
select is((select value->'requestedCurrencyCode' from manager_email_context),'null'::jsonb,
 'No current assigned manager means no added currency');
select is((select value->'issueLabel' from manager_email_context),'null'::jsonb,
 'No current assigned manager means no added issue');
select is((select value->'customerCommentExcerpt' from manager_email_context),'null'::jsonb,
 'Revoked assignment cannot expose added narrative');

select * from finish();
rollback;
