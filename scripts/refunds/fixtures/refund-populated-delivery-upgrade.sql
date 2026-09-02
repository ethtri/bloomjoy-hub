-- Generated only in the disposable migration runner, never on a linked project.
-- The actual historical guard and actual current migration prefix are injected
-- from repository files. All DDL, fixtures, and guard replacements roll back.
begin;
create extension if not exists pgtap with schema extensions;
set local search_path = public, extensions;
select no_plan();

create function pg_temp.capture_delivery_upgrade_error(statement text)
returns text language plpgsql as $$
begin
  execute statement;
  return null;
exception when others then
  return sqlstate || ':' || sqlerrm;
end;
$$;

create temporary table delivery_upgrade_initial_guard as
select prosrc from pg_proc where oid = 'public.guard_refund_customer_status_message()'::regprocedure;
create temporary table delivery_upgrade_initial_triggers as
select oid, tgenabled, pg_get_triggerdef(oid) as definition
from pg_trigger where tgrelid in ('public.refund_case_messages'::regclass, 'public.refund_cases'::regclass);

/* __HISTORICAL_GUARD__ */

insert into public.customer_accounts (id, name, account_type)
values ('da110000-0000-4000-8000-000000000001', 'Populated delivery upgrade fixture', 'customer');
insert into public.reporting_locations (id, account_id, name, timezone)
values ('da120000-0000-4000-8000-000000000001', 'da110000-0000-4000-8000-000000000001', 'Populated delivery upgrade location', 'America/Los_Angeles');
insert into public.reporting_machines (id, account_id, location_id, machine_label)
values ('da130000-0000-4000-8000-000000000001', 'da110000-0000-4000-8000-000000000001', 'da120000-0000-4000-8000-000000000001', 'Populated delivery upgrade machine');
insert into public.refund_cases (
  id, public_reference, reporting_machine_id, reporting_location_id,
  customer_email, issue_summary, incident_at, payment_method,
  payment_amount_cents, refund_amount_cents, card_last4, status,
  correlation_status, correlation_source, automation_state, created_at
) values
  ('da140000-0000-4000-8000-000000000001', 'RF-UPGRADE-HISTORICAL', 'da130000-0000-4000-8000-000000000001', 'da120000-0000-4000-8000-000000000001', 'upgrade-historical@example.invalid', 'Synthetic historical delivery', statement_timestamp() - interval '18 days', 'card', 700, 700, '4242', 'needs_review', 'needs_nayax', 'nayax', 'under_review', statement_timestamp() - interval '18 days'),
  ('da140000-0000-4000-8000-000000000002', 'RF-UPGRADE-PENDING', 'da130000-0000-4000-8000-000000000001', 'da120000-0000-4000-8000-000000000001', 'upgrade-pending@example.invalid', 'Synthetic pending delivery', statement_timestamp() - interval '18 days', 'card', 700, 700, '4242', 'needs_review', 'needs_nayax', 'nayax', 'under_review', statement_timestamp() - interval '18 days');

update public.refund_customer_contact_settings set automatic_customer_contact_enabled = true where singleton;
insert into public.refund_case_messages (
  id, refund_case_id, message_type, status, recipient_email, subject, body,
  template_key, content_source, delivery_kind, reason_code, template_version, requested_fields
) values
  ('da150000-0000-4000-8000-000000000001', 'da140000-0000-4000-8000-000000000001', 'status_update', 'pending', 'upgrade-historical@example.invalid', 'Synthetic update', 'A person is reviewing this synthetic case.', 'refund_status_update_sla_at_risk_v1', 'deterministic_template', 'automatic', 'sla_at_risk', 'refund_customer_status_v1', '{}'),
  ('da150000-0000-4000-8000-000000000002', 'da140000-0000-4000-8000-000000000002', 'status_update', 'pending', 'upgrade-pending@example.invalid', 'Synthetic update', 'A person is reviewing this synthetic case.', 'refund_status_update_sla_at_risk_v1', 'deterministic_template', 'automatic', 'sla_at_risk', 'refund_customer_status_v1', '{}');
update public.refund_case_messages set status = 'sent', sent_at = statement_timestamp()
where id = 'da150000-0000-4000-8000-000000000001';
select ok((select status = 'sent' and sent_at is not null and delivery_transport is null
  from public.refund_case_messages where id = 'da150000-0000-4000-8000-000000000001'),
  'Historical message reaches SENT through the real guard under valid old case facts');

update public.refund_cases set status = 'closed', automation_state = 'closed_incomplete'
where id = 'da140000-0000-4000-8000-000000000001';
update public.refund_customer_contact_settings set automatic_customer_contact_enabled = false where singleton;
create temporary table delivery_upgrade_message_before as
select to_jsonb(message) as value from public.refund_case_messages message where id = 'da150000-0000-4000-8000-000000000001';
create temporary table delivery_upgrade_case_before as
select to_jsonb(refund_case) - array['lifecycle_revision', 'updated_at'] as value
from public.refund_cases refund_case where id = 'da140000-0000-4000-8000-000000000001';

select is(pg_temp.capture_delivery_upgrade_error($delivery_upgrade$
/* __ORIGINAL_BACKFILL__ */
$delivery_upgrade$), '23514:Automatic customer status update requires current deterministic evidence',
  'Actual populated historical backfill reproduces the production failure under the actual later guard');
select is((select to_jsonb(message) from public.refund_case_messages message where id = 'da150000-0000-4000-8000-000000000001'),
  (select value from delivery_upgrade_message_before), 'Failed historical backfill leaves the entire message unchanged');

select lives_ok($delivery_upgrade$
/* __CURRENT_DELIVERY_PREFIX__ */
$delivery_upgrade$, 'Actual current migration prefix repairs the populated upgrade with all triggers enabled');
select is((select prosrc from pg_proc where oid = 'public.guard_refund_customer_status_message()'::regprocedure),
  (select prosrc from delivery_upgrade_initial_guard), 'Fresh replay final guard and populated-upgrade guard are identical');
select ok((select status = 'sent' and delivery_transport = 'resend' and provider_message_id is null
  and delivery_state = 'unknown' and delivery_state_updated_at = coalesce(sent_at, created_at)
  from public.refund_case_messages where id = 'da150000-0000-4000-8000-000000000001'),
  'Backfill records unknown delivery metadata without inventing provider acceptance or settlement');
select is((select to_jsonb(message) - array['delivery_transport', 'provider_message_id', 'delivery_state', 'delivery_state_updated_at']
  from public.refund_case_messages message where id = 'da150000-0000-4000-8000-000000000001'),
  (select value - array['delivery_transport', 'provider_message_id', 'delivery_state', 'delivery_state_updated_at'] from delivery_upgrade_message_before),
  'Every non-delivery message field remains byte-equivalent as JSON, including identity, envelope, evidence and sent time');
select is((select to_jsonb(refund_case) - array['lifecycle_revision', 'updated_at'] from public.refund_cases refund_case
  where id = 'da140000-0000-4000-8000-000000000001'), (select value from delivery_upgrade_case_before),
  'No financial, decision, customer, or machine facts change during delivery backfill');
select is((select count(*)::bigint from public.refund_case_nayax_refund_attempts
  where refund_case_id in ('da140000-0000-4000-8000-000000000001', 'da140000-0000-4000-8000-000000000002')),
  0::bigint, 'Populated upgrade creates no financial attempt');
select ok(not (select automatic_customer_contact_enabled from public.refund_customer_contact_settings where singleton),
  'Populated upgrade never reopens automatic customer contact');

select is(pg_temp.capture_delivery_upgrade_error($sql$
  update public.refund_case_messages set status = 'sent', sent_at = statement_timestamp()
  where id = 'da150000-0000-4000-8000-000000000002'
$sql$), '23514:Automatic customer contact is disabled', 'Pending-to-SENT delivery still fails with contact disabled');
select is(pg_temp.capture_delivery_upgrade_error($sql$
  insert into public.refund_case_messages (refund_case_id, message_type, status, recipient_email, subject, body, template_key, content_source, delivery_kind, reason_code, template_version, requested_fields)
  values ('da140000-0000-4000-8000-000000000002', 'status_update', 'pending', 'upgrade-pending@example.invalid', 'Synthetic update', 'New synthetic message', 'refund_status_update_sla_at_risk_v1', 'deterministic_template', 'automatic', 'sla_at_risk', 'refund_customer_status_v1', '{}')
$sql$), '23514:Automatic customer contact is disabled', 'A new pending message still fails with contact disabled');
select matches(pg_temp.capture_delivery_upgrade_error($sql$
  update public.refund_case_messages set status = 'pending', delivery_state = 'accepted'
  where id = 'da150000-0000-4000-8000-000000000001'
$sql$), '^23514:', 'Delivery metadata cannot revive an already SENT message');
select matches(pg_temp.capture_delivery_upgrade_error($sql$
  update public.refund_case_messages set body = 'Changed body', delivery_state = 'accepted'
  where id = 'da150000-0000-4000-8000-000000000001'
$sql$), '^23514:', 'Delivery metadata cannot conceal changed message content');
select matches(pg_temp.capture_delivery_upgrade_error($sql$
  update public.refund_case_messages set recipient_email = 'other@example.invalid', delivery_state = 'accepted'
  where id = 'da150000-0000-4000-8000-000000000001'
$sql$), '^23514:', 'Delivery metadata cannot conceal changed recipient');
select matches(pg_temp.capture_delivery_upgrade_error($sql$
  update public.refund_case_messages set sent_at = sent_at + interval '1 second', delivery_state = 'accepted'
  where id = 'da150000-0000-4000-8000-000000000001'
$sql$), '^23514:', 'Delivery metadata cannot replace historical sent time');
select matches(pg_temp.capture_delivery_upgrade_error($sql$
  update public.refund_case_messages set reason_code = 'provider_delay', delivery_state = 'accepted'
  where id = 'da150000-0000-4000-8000-000000000001'
$sql$), '^23514:', 'Delivery metadata cannot replace deterministic evidence');
select matches(pg_temp.capture_delivery_upgrade_error($sql$
  update public.refund_case_messages set error_message = 'arbitrary change', delivery_state = 'accepted'
  where id = 'da150000-0000-4000-8000-000000000001'
$sql$), '^23514:', 'Whole-row allowlist rejects other non-delivery metadata changes');
select is((select status from public.refund_case_messages where id = 'da150000-0000-4000-8000-000000000002'),
  'pending', 'Rejected sends preserve the pending message without any dispatch');
select is((select count(*)::bigint from public.refund_case_messages
  where refund_case_id in ('da140000-0000-4000-8000-000000000001', 'da140000-0000-4000-8000-000000000002')),
  2::bigint, 'Upgrade and negative tests create no duplicate communication');
select ok(not exists (
  select 1 from delivery_upgrade_initial_triggers initial
  full join (select oid, tgenabled, pg_get_triggerdef(oid) as definition from pg_trigger
    where tgrelid in ('public.refund_case_messages'::regclass, 'public.refund_cases'::regclass)) current using (oid)
  where initial.oid is null or current.oid is null or initial.tgenabled is distinct from current.tgenabled
    or initial.definition is distinct from current.definition
), 'Every case and message trigger retains its original identity, definition, and enabled state');
select ok(not exists (select 1 from pg_trigger where tgrelid in ('public.refund_case_messages'::regclass, 'public.refund_cases'::regclass)
  and not tgisinternal and tgenabled = 'D'), 'No case or message trigger is disabled during regression');
select * from finish();
rollback;
