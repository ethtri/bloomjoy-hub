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
  (
    '00000000-0000-0000-0000-000000000000',
    'a9100000-0000-4000-8000-000000000001',
    'authenticated', 'authenticated', 'ack-manager@example.invalid', '',
    now(), '{}'::jsonb, '{}'::jsonb, now(), now()
  ),
  (
    '00000000-0000-0000-0000-000000000000',
    'a9100000-0000-4000-8000-000000000002',
    'authenticated', 'authenticated', 'ack-outsider@example.invalid', '',
    now(), '{}'::jsonb, '{}'::jsonb, now(), now()
  );

insert into public.customer_accounts (id, name, account_type)
values (
  'a9110000-0000-4000-8000-000000000001',
  'Acknowledgement recovery fixture',
  'internal'
);

insert into public.reporting_locations (id, account_id, name, timezone)
values (
  'a9120000-0000-4000-8000-000000000001',
  'a9110000-0000-4000-8000-000000000001',
  'Acknowledgement recovery location',
  'America/Los_Angeles'
);

insert into public.reporting_machines (
  id, account_id, location_id, machine_label, status
) values (
  'a9130000-0000-4000-8000-000000000001',
  'a9110000-0000-4000-8000-000000000001',
  'a9120000-0000-4000-8000-000000000001',
  'Acknowledgement recovery machine',
  'active'
);

insert into public.reporting_machine_refund_managers (
  reporting_machine_id, manager_user_id, manager_email, grant_reason
) values (
  'a9130000-0000-4000-8000-000000000001',
  'a9100000-0000-4000-8000-000000000001',
  'ack-manager@example.invalid',
  'Acknowledgement recovery authorization fixture'
);

insert into public.refund_cases (
  id, public_reference, reporting_machine_id, reporting_location_id,
  customer_email, issue_summary, incident_at, payment_method,
  payment_amount_cents, status, correlation_status, correlation_source
) values
  (
    'a9140000-0000-4000-8000-000000000001', 'RF-ACK-LATER',
    'a9130000-0000-4000-8000-000000000001',
    'a9120000-0000-4000-8000-000000000001',
    'ack-later@example.invalid', 'Skipped acknowledgement with later contact',
    statement_timestamp() - interval '3 hours', 'card', 700,
    'needs_review', 'needs_nayax', 'nayax'
  ),
  (
    'a9140000-0000-4000-8000-000000000002', 'RF-ACK-NONE',
    'a9130000-0000-4000-8000-000000000001',
    'a9120000-0000-4000-8000-000000000001',
    'ack-none@example.invalid', 'Skipped acknowledgement without later contact',
    statement_timestamp() - interval '3 hours', 'card', 700,
    'needs_review', 'needs_nayax', 'nayax'
  ),
  (
    'a9140000-0000-4000-8000-000000000003', 'RF-ACK-CLEAN',
    'a9130000-0000-4000-8000-000000000001',
    'a9120000-0000-4000-8000-000000000001',
    'ack-clean@example.invalid', 'Sent acknowledgement',
    statement_timestamp() - interval '3 hours', 'card', 700,
    'needs_review', 'needs_nayax', 'nayax'
  );

insert into public.refund_case_messages (
  id, refund_case_id, message_type, status, recipient_email, subject, body,
  template_key, sent_at, error_message, created_at
) values
  (
    'a9150000-0000-4000-8000-000000000001',
    'a9140000-0000-4000-8000-000000000001',
    'confirmation', 'skipped', 'ack-later@example.invalid',
    'Request received', 'Your request was stored.', 'refund_confirmation_v1',
    null, 'automatic_customer_contact_disabled',
    statement_timestamp() - interval '2 hours'
  ),
  (
    'a9150000-0000-4000-8000-000000000002',
    'a9140000-0000-4000-8000-000000000001',
    'status_update', 'sent', 'ack-later@example.invalid',
    'Refund review update', 'Bloomjoy is reviewing the request.',
    'refund_status_update_v1', statement_timestamp() - interval '1 hour', null,
    statement_timestamp() - interval '1 hour'
  ),
  (
    'a9150000-0000-4000-8000-000000000003',
    'a9140000-0000-4000-8000-000000000002',
    'confirmation', 'skipped', 'ack-none@example.invalid',
    'Request received', 'Your request was stored.', 'refund_confirmation_v1',
    null, 'automatic_customer_contact_disabled',
    statement_timestamp() - interval '2 hours'
  ),
  (
    'a9150000-0000-4000-8000-000000000004',
    'a9140000-0000-4000-8000-000000000003',
    'confirmation', 'sent', 'ack-clean@example.invalid',
    'Request received', 'Your request was stored.', 'refund_confirmation_v1',
    statement_timestamp() - interval '2 hours', null,
    statement_timestamp() - interval '2 hours'
  );

create temp table ack_case_state_before on commit drop as
select
  status,
  decision,
  refund_completed_at,
  reporting_adjustment_id,
  nayax_refund_execution_status
from public.refund_cases
where id = 'a9140000-0000-4000-8000-000000000001';

select ok(
  has_function_privilege(
    'authenticated',
    'public.admin_dispose_refund_acknowledgement_exception(uuid,bigint,text)',
    'execute'
  )
  and not has_function_privilege(
    'anon',
    'public.admin_dispose_refund_acknowledgement_exception(uuid,bigint,text)',
    'execute'
  ),
  'Only authenticated managers can reach the acknowledgement disposition RPC'
);

select ok(
  not has_function_privilege(
    'authenticated',
    'public.refund_acknowledgement_delivery_exception(uuid)',
    'execute'
  )
  and not has_function_privilege(
    'service_role',
    'public.refund_acknowledgement_delivery_exception(uuid)',
    'execute'
  ),
  'The internal exception projector is not a standalone Data API surface'
);

select is(
  public.refund_acknowledgement_delivery_exception(
    'a9140000-0000-4000-8000-000000000001'
  ) ->> 'status',
  'unresolved',
  'A skipped acknowledgement remains unresolved after a later message'
);

select is(
  public.refund_acknowledgement_delivery_exception(
    'a9140000-0000-4000-8000-000000000001'
  ) ->> 'recoveryAction',
  'record_later_contact_disposition',
  'A later sent message exposes only the no-resend disposition'
);

select is(
  public.refund_acknowledgement_delivery_exception(
    'a9140000-0000-4000-8000-000000000002'
  ) ->> 'recoveryAction',
  'send_safe_status_update',
  'A skipped acknowledgement without later contact stays actionable'
);

select is(
  public.refund_acknowledgement_delivery_exception(
    'a9140000-0000-4000-8000-000000000003'
  ),
  null::jsonb,
  'A sent acknowledgement produces no delivery exception'
);

set local role authenticated;
select pg_temp.set_auth_claims('a9100000-0000-4000-8000-000000000002');

select ok(
  pg_temp.capture_error($$select public.admin_dispose_refund_acknowledgement_exception(
    'a9140000-0000-4000-8000-000000000001', 1,
    'later_customer_contact_already_sent'
  )$$) like 'P4613:Refund case access required%',
  'An unrelated authenticated user cannot dispose another case exception'
);

select pg_temp.set_auth_claims('a9100000-0000-4000-8000-000000000001');

select ok(
  pg_temp.capture_error($$select public.admin_dispose_refund_acknowledgement_exception(
    'a9140000-0000-4000-8000-000000000001', 99,
    'later_customer_contact_already_sent'
  )$$) like 'P4614:Refund case changed%',
  'A stale case version cannot record the disposition'
);

select ok(
  pg_temp.capture_error($$select public.admin_dispose_refund_acknowledgement_exception(
    'a9140000-0000-4000-8000-000000000001', 1, 'other'
  )$$) like 'P4611:Valid acknowledgement recovery reason required%',
  'The disposition requires the fixed nonduplicating reason'
);

select ok(
  pg_temp.capture_error($$select public.admin_dispose_refund_acknowledgement_exception(
    'a9140000-0000-4000-8000-000000000002', 1,
    'later_customer_contact_already_sent'
  )$$) like 'P4616:A later sent customer message is required%',
  'A manager cannot suppress an exception before later contact is proven sent'
);

select is(
  (public.admin_dispose_refund_acknowledgement_exception(
    'a9140000-0000-4000-8000-000000000001', 1,
    'later_customer_contact_already_sent'
  ) ->> 'recorded')::boolean,
  true,
  'The mapped manager records one recovery disposition'
);

select is(
  (
    select count(*)::integer
    from public.refund_case_events event
    where event.refund_case_id = 'a9140000-0000-4000-8000-000000000001'
      and event.event_type = 'customer_acknowledgement_recovery_disposition'
  ),
  1,
  'The recovery disposition creates exactly one immutable audit event'
);

select ok(
  (
    select event.actor_user_id = 'a9100000-0000-4000-8000-000000000001'
      and event.metadata ->> 'reason' = 'later_customer_contact_already_sent'
      and (event.metadata ->> 'payload_redacted')::boolean
    from public.refund_case_events event
    where event.refund_case_id = 'a9140000-0000-4000-8000-000000000001'
      and event.event_type = 'customer_acknowledgement_recovery_disposition'
  ),
  'The immutable event records the actor, required reason, and redacted payload'
);

select is(
  (
    select count(*)::integer
    from public.refund_case_messages message
    where message.refund_case_id = 'a9140000-0000-4000-8000-000000000001'
  ),
  2,
  'Recording the disposition sends or creates no customer message'
);

reset role;

select is(
  (
    select jsonb_build_object(
      'status', refund_case.status,
      'decision', refund_case.decision,
      'refundCompletedAt', refund_case.refund_completed_at,
      'reportingAdjustmentId', refund_case.reporting_adjustment_id,
      'nayaxRefundExecutionStatus', refund_case.nayax_refund_execution_status
    )
    from public.refund_cases refund_case
    where refund_case.id = 'a9140000-0000-4000-8000-000000000001'
  ),
  (
    select jsonb_build_object(
      'status', snapshot.status,
      'decision', snapshot.decision,
      'refundCompletedAt', snapshot.refund_completed_at,
      'reportingAdjustmentId', snapshot.reporting_adjustment_id,
      'nayaxRefundExecutionStatus', snapshot.nayax_refund_execution_status
    )
    from pg_temp.ack_case_state_before snapshot
  ),
  'The disposition changes no case decision, payment, provider, or reporting state'
);

set local role authenticated;
select pg_temp.set_auth_claims('a9100000-0000-4000-8000-000000000001');

select is(
  (public.admin_dispose_refund_acknowledgement_exception(
    'a9140000-0000-4000-8000-000000000001', 1,
    'later_customer_contact_already_sent'
  ) ->> 'replayed')::boolean,
  true,
  'Replaying the same disposition is explicitly idempotent'
);

select is(
  (
    select count(*)::integer
    from public.refund_case_events event
    where event.refund_case_id = 'a9140000-0000-4000-8000-000000000001'
      and event.event_type = 'customer_acknowledgement_recovery_disposition'
  ),
  1,
  'A replay cannot duplicate the audit event'
);

reset role;

select is(
  public.refund_acknowledgement_delivery_exception(
    'a9140000-0000-4000-8000-000000000001'
  ) ->> 'status',
  'resolved_later_contact',
  'The server projection resolves only after the immutable disposition'
);

set local role authenticated;
select pg_temp.set_auth_claims('a9100000-0000-4000-8000-000000000001');

select is(
  (
    select item.case_json -> 'acknowledgementDeliveryException' ->> 'status'
    from jsonb_array_elements(
      public.admin_get_refund_operations_overview() -> 'cases'
    ) item(case_json)
    where item.case_json ->> 'id' = 'a9140000-0000-4000-8000-000000000001'
  ),
  'resolved_later_contact',
  'The actor-scoped manager overview publishes the same recovery contract'
);

select is(
  public.admin_get_refund_operations_overview()
    ->> 'acknowledgementRecoveryContractVersion',
  'refund_acknowledgement_recovery_v1',
  'The overview versions the acknowledgement recovery contract'
);

select * from finish();
rollback;
