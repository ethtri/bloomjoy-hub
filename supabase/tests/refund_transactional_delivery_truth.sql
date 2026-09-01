begin;

create extension if not exists pgtap with schema extensions;
set local search_path = public, extensions;

select plan(20);

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
begin
  execute statement;
  return null;
exception when others then
  return sqlstate || ':' || sqlerrm;
end;
$$;

insert into auth.users (
  instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at
) values
  ('00000000-0000-0000-0000-000000000000', 'd9100000-0000-4000-8000-000000000001', 'authenticated', 'authenticated', 'delivery-manager@example.invalid', '', now(), '{}'::jsonb, '{}'::jsonb, now(), now()),
  ('00000000-0000-0000-0000-000000000000', 'd9100000-0000-4000-8000-000000000002', 'authenticated', 'authenticated', 'unrelated-delivery-manager@example.invalid', '', now(), '{}'::jsonb, '{}'::jsonb, now(), now());

insert into public.customer_accounts (id, name, account_type)
values ('d9110000-0000-4000-8000-000000000001', 'Delivery truth fixture', 'internal');

insert into public.reporting_locations (id, account_id, name, timezone)
values (
  'd9120000-0000-4000-8000-000000000001',
  'd9110000-0000-4000-8000-000000000001',
  'Delivery fixture location', 'America/Los_Angeles'
);

insert into public.reporting_machines (
  id, account_id, location_id, machine_label, status
) values
  ('d9130000-0000-4000-8000-000000000001', 'd9110000-0000-4000-8000-000000000001', 'd9120000-0000-4000-8000-000000000001', 'Delivery fixture machine', 'active'),
  ('d9130000-0000-4000-8000-000000000002', 'd9110000-0000-4000-8000-000000000001', 'd9120000-0000-4000-8000-000000000001', 'Unrelated delivery machine', 'active');

insert into public.reporting_machine_refund_managers (
  reporting_machine_id, manager_user_id, manager_email, grant_reason
) values
  ('d9130000-0000-4000-8000-000000000001', 'd9100000-0000-4000-8000-000000000001', 'delivery-manager@example.invalid', 'Delivery fixture'),
  ('d9130000-0000-4000-8000-000000000002', 'd9100000-0000-4000-8000-000000000002', 'unrelated-delivery-manager@example.invalid', 'Isolation fixture');

insert into public.refund_cases (
  id, public_reference, reporting_machine_id, reporting_location_id,
  customer_email, issue_summary, incident_at, incident_timezone,
  payment_method, payment_amount_cents, card_last4, status,
  correlation_status, correlation_source
) values
  ('d9140000-0000-4000-8000-000000000001', 'RF-DELIVERY-TRUTH', 'd9130000-0000-4000-8000-000000000001', 'd9120000-0000-4000-8000-000000000001', 'delivery-customer@example.invalid', 'Delivery truth fixture', statement_timestamp() - interval '2 hours', 'America/Los_Angeles', 'card', 700, '4242', 'needs_review', 'matched', 'nayax'),
  ('d9140000-0000-4000-8000-000000000002', 'RF-DELIVERY-INTERNAL', 'd9130000-0000-4000-8000-000000000001', 'd9120000-0000-4000-8000-000000000001', 'internal-delivery@example.invalid', 'Internal delivery fixture', statement_timestamp() - interval '1 hour', 'America/Los_Angeles', 'card', 700, '4242', 'closed', 'manual_review', 'manual');

insert into public.refund_case_messages (
  id, refund_case_id, message_type, status, recipient_email,
  subject, body, created_by, requested_fields
) values
  ('d9150000-0000-4000-8000-000000000001', 'd9140000-0000-4000-8000-000000000001', 'status_update', 'pending', 'delivery-customer@example.invalid', 'Synthetic delivery update', 'Synthetic body', 'd9100000-0000-4000-8000-000000000001', '{}'::text[]),
  ('d9150000-0000-4000-8000-000000000002', 'd9140000-0000-4000-8000-000000000001', 'more_info', 'pending', 'delivery-customer@example.invalid', 'Synthetic second update', 'Synthetic second body', 'd9100000-0000-4000-8000-000000000001', array['incident_time']::text[]),
  ('d9150000-0000-4000-8000-000000000003', 'd9140000-0000-4000-8000-000000000002', 'status_update', 'failed', 'internal-delivery@example.invalid', 'Suppressed synthetic update', 'Suppressed body', 'd9100000-0000-4000-8000-000000000001', '{}'::text[]);

-- Seed the historical message before classification; the production disposition
-- suppresses every new customer message after the case enters Internal/test.
update public.refund_cases
set case_population = 'internal_test',
  internal_test_reason = 'provider_test',
  internal_test_classified_at = statement_timestamp(),
  internal_test_classified_by = 'd9100000-0000-4000-8000-000000000001',
  status = 'closed',
  automation_state = 'closed_incomplete',
  automation_follow_up_due_at = null,
  decision = null,
  decided_by = null,
  decided_at = null,
  reporting_adjustment_id = null,
  refund_completed_by = null,
  refund_completed_at = null
where id = 'd9140000-0000-4000-8000-000000000002';

select ok(
  has_function_privilege('service_role', 'public.service_mark_refund_transactional_delivery_attempt(uuid)', 'execute')
  and has_function_privilege('service_role', 'public.service_bind_refund_transactional_delivery(uuid,text,timestamptz)', 'execute')
  and has_function_privilege('service_role', 'public.service_record_refund_transactional_delivery_event(text,text,text,timestamptz)', 'execute')
  and not has_function_privilege('authenticated', 'public.service_record_refund_transactional_delivery_event(text,text,text,timestamptz)', 'execute'),
  'Only the service boundary can record direct-email delivery evidence'
);

select ok(
  not has_table_privilege('service_role', 'public.refund_transactional_delivery_events', 'select')
  and not has_table_privilege('service_role', 'public.refund_transactional_delivery_events', 'insert')
  and not has_table_privilege('authenticated', 'public.refund_transactional_delivery_events', 'select'),
  'The redacted provider-event ledger is private behind RPCs'
);

set local role service_role;
select is(
  public.service_mark_refund_transactional_delivery_attempt('d9150000-0000-4000-8000-000000000001') ->> 'deliveryState',
  'unknown', 'A direct attempt is explicit before provider access'
);
select is(
  public.service_bind_refund_transactional_delivery('d9150000-0000-4000-8000-000000000001', 'resend_delivery_primary', statement_timestamp()) ->> 'bound',
  'true', 'A successful API response binds exact provider acceptance evidence'
);
reset role;

select ok(
  (select delivery_transport = 'resend' and provider_message_id = 'resend_delivery_primary'
    and delivery_state = 'accepted'
   from public.refund_case_messages where id = 'd9150000-0000-4000-8000-000000000001'),
  'Accepted is distinct from delivered in the message ledger'
);

set local role authenticated;
select pg_temp.set_auth_claims('d9100000-0000-4000-8000-000000000001');
select ok(
  public.admin_get_refund_operations_overview() ->> 'transactionalDeliveryContractVersion' = 'refund_transactional_delivery_v1'
  and position('resend_delivery_primary' in public.admin_get_refund_operations_overview()::text) = 0,
  'Manager delivery projection is versioned and never exposes provider identifiers'
);
select ok(
  (select item ->> 'customerDeliveryException' is null
    and exists (
      select 1
      from jsonb_array_elements(item -> 'messages') message_item
      where message_item ->> 'id' = 'd9150000-0000-4000-8000-000000000001'
        and message_item ->> 'deliveryState' = 'accepted'
    )
   from jsonb_array_elements(public.admin_get_refund_operations_overview() -> 'cases') item
   where item ->> 'id' = 'd9140000-0000-4000-8000-000000000001'),
  'Recent provider acceptance does not claim delivery or prematurely create an exception'
);
reset role;

set local role service_role;
select is(
  public.service_record_refund_transactional_delivery_event(repeat('a', 64), 'resend_delivery_primary', 'delivered', statement_timestamp()) ->> 'deliveryState',
  'delivered', 'A delivered webhook advances the delivery state'
);
select is(
  public.service_record_refund_transactional_delivery_event(repeat('a', 64), 'resend_delivery_primary', 'delivered', statement_timestamp()) ->> 'duplicate',
  'true', 'An at-least-once webhook replay is deduplicated'
);
select public.service_record_refund_transactional_delivery_event(repeat('b', 64), 'resend_delivery_primary', 'accepted', statement_timestamp());
reset role;

select is(
  (select delivery_state from public.refund_case_messages where id = 'd9150000-0000-4000-8000-000000000001'),
  'delivered', 'A later accepted event cannot downgrade delivered truth'
);

update public.refund_case_messages set status = 'sent', sent_at = statement_timestamp()
where id = 'd9150000-0000-4000-8000-000000000001';

set local role service_role;
select is(
  public.service_record_refund_transactional_delivery_event(repeat('c', 64), 'resend_delivery_primary', 'bounced', statement_timestamp()) ->> 'deliveryState',
  'bounced', 'A bounce supersedes earlier delivered evidence'
);
reset role;
select ok(
  (select delivery_state = 'bounced' and status = 'failed'
    and error_message = 'transactional_delivery_bounced'
   from public.refund_case_messages where id = 'd9150000-0000-4000-8000-000000000001'),
  'Terminal delivery failure returns the application message to review'
);

set local role service_role;
select public.service_record_refund_transactional_delivery_event(repeat('d', 64), 'resend_delivery_primary', 'delivered', statement_timestamp());
select is(
  public.service_record_refund_transactional_delivery_event(repeat('e', 64), 'resend_delivery_primary', 'complained', statement_timestamp()) ->> 'deliveryState',
  'complained', 'A complaint is retained as the strongest delivery safety state'
);
select is(
  public.service_record_refund_transactional_delivery_event(repeat('f', 64), 'resend_delivery_latebind', 'failed', statement_timestamp()) ->> 'matched',
  'false', 'Webhook-before-bind evidence is retained without guessing a case'
);
select public.service_mark_refund_transactional_delivery_attempt('d9150000-0000-4000-8000-000000000002');
select is(
  public.service_bind_refund_transactional_delivery('d9150000-0000-4000-8000-000000000002', 'resend_delivery_latebind', statement_timestamp()) ->> 'deliveryState',
  'failed', 'Late provider binding atomically applies earlier webhook evidence'
);
reset role;

select ok(
  (select count(*) = 2 from public.refund_case_messages
   where refund_case_id = 'd9140000-0000-4000-8000-000000000001')
  and (select count(*) = 0 from public.refund_case_nayax_refund_attempts
       where refund_case_id = 'd9140000-0000-4000-8000-000000000001'),
  'Delivery events create no message replay and no payment attempt'
);

set local role authenticated;
select pg_temp.set_auth_claims('d9100000-0000-4000-8000-000000000001');
select ok(
  (select item -> 'customerDeliveryException' ->> 'recoveryOwner' = 'refund_operations'
      and item -> 'customerDeliveryException' ->> 'nextAction' = 'review_delivery_no_resend'
      and (item -> 'customerDeliveryException' ->> 'customerMessageReplayAllowed')::boolean is false
      and (item -> 'customerDeliveryException' ->> 'paymentReplayAllowed')::boolean is false
      and item -> 'lifecycle' -> 'managerQueue' ->> 'bucket' = 'needs_action'
      and item -> 'lifecycle' ->> 'managerNextAction' = 'review_customer_delivery'
   from jsonb_array_elements(public.admin_get_refund_operations_overview() -> 'cases') item
   where item ->> 'id' = 'd9140000-0000-4000-8000-000000000001'),
  'Queue, case detail, and next action share the no-replay delivery contract'
);
select pg_temp.set_auth_claims('d9100000-0000-4000-8000-000000000002');
select is(
  (select count(*)::integer from jsonb_array_elements(
    public.admin_get_refund_operations_overview() -> 'cases'
  ) item where item ->> 'id' = 'd9140000-0000-4000-8000-000000000001'),
  0, 'An unrelated manager cannot discover delivery evidence'
);
reset role;

set local role service_role;
select ok(
  pg_temp.capture_error($$select public.service_mark_refund_transactional_delivery_attempt('d9150000-0000-4000-8000-000000000003')$$)
    like 'P4640:Customer delivery is suppressed for Internal/test cases%',
  'Internal/test classification suppresses direct provider delivery attempts'
);
reset role;

select is(
  (select count(*)::integer from public.refund_transactional_delivery_events),
  6, 'The private ledger stores one redacted row per unique provider event'
);

select * from finish();
rollback;
