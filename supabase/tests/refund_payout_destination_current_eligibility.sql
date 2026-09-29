begin;

create extension if not exists pgtap with schema extensions;
set local search_path = public, extensions;

select plan(15);

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
) values (
  '00000000-0000-0000-0000-000000000000',
  'ca000000-0000-4000-8000-000000000001',
  'authenticated', 'authenticated', 'current-payout-manager@example.invalid',
  '', now(), '{}'::jsonb, '{}'::jsonb, now(), now()
);

insert into public.admin_roles (user_id, role, active)
values ('ca000000-0000-4000-8000-000000000001', 'super_admin', true);

insert into public.customer_accounts (id, name, account_type)
values (
  'ca100000-0000-4000-8000-000000000001',
  'Current payout eligibility fixture', 'internal'
);

insert into public.reporting_locations (id, account_id, name, timezone)
values (
  'ca200000-0000-4000-8000-000000000001',
  'ca100000-0000-4000-8000-000000000001',
  'Current payout location', 'America/Los_Angeles'
);

insert into public.reporting_machines (
  id, account_id, location_id, machine_label, status
) values (
  'ca300000-0000-4000-8000-000000000001',
  'ca100000-0000-4000-8000-000000000001',
  'ca200000-0000-4000-8000-000000000001',
  'Current payout machine', 'active'
);

insert into public.reporting_machine_refund_managers (
  reporting_machine_id, manager_user_id, manager_email, grant_reason
) values (
  'ca300000-0000-4000-8000-000000000001',
  'ca000000-0000-4000-8000-000000000001',
  'current-payout-manager@example.invalid', 'Current payout fixture'
);

insert into public.refund_cases (
  id, public_reference, reporting_machine_id, reporting_location_id,
  customer_email, issue_summary, incident_at, incident_timezone,
  incident_time_resolution, payment_method, payment_amount_cents,
  refund_amount_cents, status, decision, correlation_status,
  correlation_source, automation_state, intake_source
) values (
  'ca400000-0000-4000-8000-000000000001', 'RF-CURRENT-PAYOUT',
  'ca300000-0000-4000-8000-000000000001',
  'ca200000-0000-4000-8000-000000000001',
  'current-payout-customer@example.invalid',
  'Undecided cash request awaiting one protected payout destination',
  statement_timestamp() - interval '2 hours', 'America/Los_Angeles',
  'exact', 'cash', 900, 900, 'needs_review', null,
  'manual_review', 'manual', 'under_review', 'form'
);

insert into public.refund_cases (
  id, public_reference, reporting_machine_id, reporting_location_id,
  customer_email, issue_summary, incident_at, incident_timezone,
  incident_time_resolution, payment_method, payment_amount_cents,
  refund_amount_cents, status, decision, correlation_status,
  correlation_source, automation_state, intake_source
) values (
  'ca400000-0000-4000-8000-000000000002', 'RF-INCOMPLETE-PAYOUT',
  'ca300000-0000-4000-8000-000000000001',
  'ca200000-0000-4000-8000-000000000001',
  'incomplete-payout-customer@example.invalid',
  'Incomplete cash request without a known amount',
  statement_timestamp() - interval '2 hours', 'America/Los_Angeles',
  'exact', 'cash', null, null, 'needs_review', null,
  'manual_review', 'manual', 'under_review', 'form'
);

select ok(
  public.refund_payout_destination_case_current(
    (select refund_case from public.refund_cases refund_case
      where refund_case.id = 'ca400000-0000-4000-8000-000000000001')
  ),
  'Current undecided open cash case is eligible for the protected payout path'
);

select is(
  public.refund_payout_destination_case_current(
    (select refund_case from public.refund_cases refund_case
      where refund_case.id = 'ca400000-0000-4000-8000-000000000002')
  ),
  false,
  'Incomplete undecided cash case fails closed'
);

select ok((select
  strpos(correction_source,'p_case.status in')>0
  and strpos(correction_source,'p_case.status in')
    < strpos(correction_source,'public.refund_authoritative_receipts')
  and strpos(payout_source,'p_case.payment_method is distinct from ''cash''')>0
  and strpos(payout_source,'p_case.payment_method is distinct from ''cash''')
    < strpos(payout_source,'public.refund_purchase_correction_eligible')
from (select
  lower(pg_get_functiondef(
    'public.refund_purchase_correction_eligible(public.refund_cases)'
      ::regprocedure)) correction_source,
  lower(pg_get_functiondef(
    'public.refund_payout_destination_case_current(public.refund_cases)'
      ::regprocedure)) payout_source) sources),
  'Correction and payout predicates reject unrelated states before research'
);

set local role service_role;
select ok(
  pg_temp.capture_error($$select public.service_enqueue_refund_manual_message_intent(
    'ca400000-0000-4000-8000-000000000002',
    (select official_action_version from public.refund_cases
      where id = 'ca400000-0000-4000-8000-000000000002'),
    'ca500000-0000-4000-8000-000000000099',
    'ca000000-0000-4000-8000-000000000001',
    'more_info', 'incomplete-payout-customer@example.invalid',
    'Unsafe incomplete request', 'Unsafe incomplete request',
    'refund_more_info_editable_v1', 'manager_authored',
    'missing_information', array['zelle_payment_contact']::text[],
    null, false, null
  )$$) like 'P4655:%',
  'Incomplete undecided cash case cannot enqueue a payout request'
);
reset role;

set local role service_role;
select is(
  public.refund_purchase_correction_request_fields(
    'ca400000-0000-4000-8000-000000000001'
  ),
  array['zelle_payment_contact']::text[],
  'Current field contract exposes exactly the payout destination'
);

select is(
  public.service_enqueue_refund_manual_message_intent(
    'ca400000-0000-4000-8000-000000000001',
    (select official_action_version from public.refund_cases
      where id = 'ca400000-0000-4000-8000-000000000001'),
    'ca500000-0000-4000-8000-000000000001',
    'ca000000-0000-4000-8000-000000000001',
    'more_info', 'current-payout-customer@example.invalid',
    'One detail needed for your Bloomjoy refund',
    'Reply with the Zelle email address or phone number for this refund.',
    'refund_more_info_editable_v1', 'manager_authored',
    'missing_information', array['zelle_payment_contact']::text[],
    null, false, null
  ) ->> 'enqueued',
  'true',
  'Existing protected sender queues the current payout request'
);

select ok(
  pg_temp.capture_error($$select public.service_enqueue_refund_manual_message_intent(
    'ca400000-0000-4000-8000-000000000001',
    (select official_action_version from public.refund_cases
      where id = 'ca400000-0000-4000-8000-000000000001'),
    'ca500000-0000-4000-8000-000000000002',
    'ca000000-0000-4000-8000-000000000001',
    'more_info', 'current-payout-customer@example.invalid',
    'Duplicate request', 'Duplicate request',
    'refund_more_info_editable_v1', 'manager_authored',
    'missing_information', array['zelle_payment_contact']::text[],
    null, false, null
  )$$) like 'P4662:%',
  'Existing durable-outcome guard still blocks a duplicate payout request'
);

create temp table current_payout_claim as
select * from public.service_claim_refund_manual_message_deliveries(
  (select id from public.refund_case_messages
    where manual_delivery_intent_id = 'ca500000-0000-4000-8000-000000000001'),
  1
);

select is((select count(*)::integer from current_payout_claim), 1,
  'Existing outbox claims the one current request');

select lives_ok($$select public.service_mark_refund_manual_message_provider_attempt(
  (select refund_case_message_id from current_payout_claim),
  (select claim_token from current_payout_claim)
)$$, 'Existing provider-attempt gate accepts the exact claimed request');

select is(
  public.service_finish_refund_manual_message_delivery(
    (select refund_case_message_id from current_payout_claim),
    (select claim_token from current_payout_claim),
    'sent', 'gmail_thread', null, 0, 'customer_only'
  ) ->> 'outcome',
  'sent',
  'Recorded delivery settles through the existing outbox'
);
reset role;

select ok(
  (select status = 'waiting_on_customer'
      and decision is null
      and automation_state = 'more_info_needed'
    from public.refund_cases
    where id = 'ca400000-0000-4000-8000-000000000001'),
  'Delivery advances customer wait without inventing a manager decision'
);

select ok(
  (select status = 'waiting' and reminder_due_at is not null
    from public.refund_payout_destination_follow_ups
    where refund_case_id = 'ca400000-0000-4000-8000-000000000001'),
  'Recorded delivery starts the existing single-reminder window'
);

update public.refund_customer_contact_settings
set automatic_customer_contact_enabled = true;
update public.refund_payout_destination_follow_ups
set reminder_due_at = statement_timestamp() - interval '1 minute'
where refund_case_id = 'ca400000-0000-4000-8000-000000000001';

set local role service_role;
create temp table current_payout_reminder_claim as
select public.service_claim_due_refund_payout_destination_follow_ups(1, true)
  as result;

select is(
  current_payout_reminder_claim.result #>> '{reminders,0,refundCaseId}',
  'ca400000-0000-4000-8000-000000000001',
  'Existing follow-up worker claims the due current payout reminder'
) from current_payout_reminder_claim;

select is(
  public.service_create_refund_payout_destination_reminder_message(
    (current_payout_reminder_claim.result #>> '{reminders,0,followUpId}')::uuid,
    (current_payout_reminder_claim.result #>> '{reminders,0,claimToken}')::uuid,
    'Reminder: one detail for your Bloomjoy refund',
    'Reply with the Zelle email address or phone number for this refund.'
  ) ->> 'created',
  'true',
  'Existing deterministic reminder creator supports the current lifecycle'
) from current_payout_reminder_claim;
reset role;

update public.refund_cases
set status = 'denied', decision = 'denied'
where id = 'ca400000-0000-4000-8000-000000000001';

set local role service_role;
select is(
  public.refund_purchase_correction_request_fields(
    'ca400000-0000-4000-8000-000000000001'
  ),
  '{}'::text[],
  'A decided terminal case exposes no payout destination request field'
);
reset role;

select * from finish();
rollback;
