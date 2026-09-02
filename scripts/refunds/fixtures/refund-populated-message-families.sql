-- Additional historical families. Seed through enabled real guards under valid
-- earlier facts, advance case/cycle facts, then replay actual pre-0700 guards.
create temporary table family_cases (family text primary key, id uuid not null default gen_random_uuid());
insert into family_cases(family) values ('follow'), ('no_match'), ('no_match_review'), ('wallet'),
  ('appeal'), ('card_approved'), ('card_completed'), ('legacy'), ('internal'), ('manual');
create temporary table family_messages (family text primary key, id uuid not null default gen_random_uuid(), expected_old_error text);
grant select on family_messages to service_role;
insert into family_messages(family, expected_old_error) values
 ('more_info', '23514:Follow-up request is no longer claimable'),
 ('reminder', '23514:Follow-up reminder is not due or was already claimed'),
 ('information_received', '23514:Information-received receipt requires one verified customer reply'),
 ('no_safe_match', '23514:Follow-up request is no longer claimable'),
 ('no_safe_match_review', '23514:Follow-up request is no longer claimable'),
 ('wallet_correction', null), ('wallet_correction_reminder', null),
 ('appeal_received', '23514:Appeal receipt requires current same-case deterministic evidence'),
 ('card_approved', 'P0001:Card success messages require committed token-bound provider settlement'),
 ('card_completed', 'P0001:Card success messages require committed token-bound provider settlement'),
 ('legacy', 'P0001:Run a fresh transaction check before any customer message'),
 ('internal', 'P4640:Customer, reminder, and refund actions are suppressed for Internal/test cases'),
 ('manual', null), ('manual_denied', null), ('manual_more_info', null);

insert into public.refund_cases(id, customer_email, issue_summary, status, intake_source,
  reporting_machine_id, reporting_location_id, incident_at)
select id, 'family-' || family || '@example.invalid', 'Synthetic populated message-family history', 'draft', 'gmail',
  'da130000-0000-4000-8000-000000000001', 'da120000-0000-4000-8000-000000000001', statement_timestamp() - interval '2 days'
from family_cases;
update public.refund_cases set payment_method = 'cash', status = 'needs_review'
where id in (select id from family_cases where family in ('card_approved', 'card_completed', 'manual', 'internal'));
update public.refund_cases set payment_method = 'card', status = 'needs_review'
where id = (select id from family_cases where family = 'legacy');
update public.refund_cases set payment_method = 'card', status = 'needs_review', automation_state = 'appeal_received'
where id = (select id from family_cases where family = 'appeal');
update public.refund_customer_contact_settings set automatic_customer_contact_enabled = true where singleton;

-- Ordinary manual outcome rows are legal under the original cash facts. Later
-- correcting the payment method to card reproduces the current token-bound
-- completion guard's historical revalidation without bypassing any trigger.
insert into public.refund_case_messages(id, refund_case_id, message_type, status, recipient_email, subject, body, sent_at)
select m.id, c.id, case c.family when 'card_approved' then 'approved' when 'card_completed' then 'completed' else 'confirmation' end,
  'sent', 'family-' || c.family || '@example.invalid', 'Synthetic notice', 'Historical synthetic customer notice.', statement_timestamp()
from family_cases c join family_messages m using(family)
where c.family in ('card_approved', 'card_completed', 'legacy', 'internal', 'manual');
insert into public.refund_case_messages(id, refund_case_id, message_type, status, recipient_email, subject, body, sent_at,
  content_source, delivery_kind)
select m.id, c.id, case m.family when 'manual_denied' then 'denied' else 'more_info' end,
  'sent', 'family-manual@example.invalid', 'Synthetic manual history', 'Synthetic prior manual history.', statement_timestamp(),
  case when m.family = 'manual_denied' then 'manager_authored' end,
  case when m.family = 'manual_denied' then 'manual' end
from family_cases c cross join family_messages m where c.family = 'manual' and m.family in ('manual_denied','manual_more_info');
update public.refund_cases set payment_method = 'card'
where id in (select id from family_cases where family in ('card_approved', 'card_completed'));
insert into public.refund_case_events(refund_case_id, event_type, message, metadata)
select id, 'legacy_card_state_normalized', 'Synthetic prior normalization evidence', '{}'::jsonb
from family_cases where family = 'legacy';

-- Real cycle claim -> request -> reminder -> verified reply -> receipt -> close.
create temporary table family_cycles as
select c.family, (public.service_claim_refund_follow_up_cycle(c.id, 'missing_information',
  (select template_version from public.refund_customer_contact_settings where singleton), repeat('f1', 32), null) #>> '{cycle,id}')::uuid as id
from family_cases c where c.family = 'follow';
insert into public.refund_case_messages(id, refund_case_id, message_type, status, recipient_email, subject, body,
  content_source, delivery_kind, reason_code, template_version, follow_up_cycle_id, requested_fields, created_at)
select m.id, f.refund_case_id, 'more_info', 'pending', c.customer_email, 'Synthetic request', 'Synthetic missing details request.',
  'deterministic_template', 'automatic', f.reason_code, f.template_version, f.id, f.requested_fields, statement_timestamp() - interval '4 days'
from family_messages m cross join family_cycles k join public.refund_follow_up_cycles f on f.id = k.id
join public.refund_cases c on c.id = f.refund_case_id where m.family = 'more_info';
update public.refund_case_messages set status = 'sent', sent_at = statement_timestamp() - interval '4 days' + interval '1 minute'
where id = (select id from family_messages where family = 'more_info');
select ok(jsonb_array_length(public.service_claim_due_refund_follow_up_reminders(25)->'reminders') >= 1,
  'Historical family reminder is claimed through the actual due-reminder RPC');
insert into public.refund_case_messages(id, refund_case_id, message_type, status, recipient_email, subject, body,
  content_source, delivery_kind, reason_code, template_version, follow_up_cycle_id, requested_fields)
select m.id, f.refund_case_id, 'reminder', 'pending', c.customer_email, 'Synthetic reminder', 'Synthetic missing details reminder.',
  'deterministic_template', 'automatic', f.reason_code, f.template_version, f.id, f.requested_fields
from family_messages m cross join family_cycles k join public.refund_follow_up_cycles f on f.id = k.id
join public.refund_cases c on c.id = f.refund_case_id where m.family = 'reminder';
update public.refund_case_messages set status = 'sent', sent_at = statement_timestamp()
where id = (select id from family_messages where family = 'reminder');

create temporary table family_gmail as
select family, gen_random_uuid() as thread_id, gen_random_uuid() as message_id from family_cases where family in ('follow', 'appeal');
insert into public.refund_gmail_threads(id, refund_case_id, mailbox_hash, provider_thread_id, thread_subject,
  first_message_at, latest_message_at, retention_expires_at)
select g.thread_id, c.id, repeat('f2', 32), 'family-' || g.family, 'Synthetic family thread',
  statement_timestamp(), statement_timestamp(), statement_timestamp() + interval '180 days'
from family_gmail g join family_cases c using(family);
insert into public.refund_gmail_messages(id, gmail_thread_id, refund_case_id, direction, status, sender_email,
  recipient_email, subject, plain_body, received_at, retention_expires_at, participant_role, participant_trust)
select g.message_id, g.thread_id, c.id, 'inbound', 'received', 'family-' || c.family || '@example.invalid',
  'fixture-mailbox@example.invalid', 'Synthetic reply', 'Synthetic verified customer reply.', statement_timestamp(),
  statement_timestamp() + interval '180 days', 'customer', 'verified'
from family_gmail g join family_cases c using(family);
select is(public.service_claim_refund_follow_up_customer_reply(
  (select id from family_cases where family = 'follow'), (select id from family_cycles)) ->> 'claimed', 'true',
  'Historical family receipt uses a real verified customer reply claim');
insert into public.refund_case_messages(id, refund_case_id, message_type, status, recipient_email, subject, body,
  content_source, delivery_kind, reason_code, template_version, follow_up_cycle_id, requested_fields)
select m.id, f.refund_case_id, 'information_received', 'pending', c.customer_email, 'Synthetic receipt', 'Synthetic received-information receipt.',
  'deterministic_template', 'automatic', f.reason_code, f.template_version, f.id, f.requested_fields
from family_messages m cross join family_cycles k join public.refund_follow_up_cycles f on f.id = k.id
join public.refund_cases c on c.id = f.refund_case_id where m.family = 'information_received';
update public.refund_follow_up_cycles set recheck_claimed_at = statement_timestamp() where id = (select id from family_cycles);
update public.refund_case_messages set status = 'sent', sent_at = statement_timestamp()
where id = (select id from family_messages where family = 'information_received');
select is((select status from public.refund_follow_up_cycles where id = (select id from family_cycles)), 'closed',
  'Real request, reminder, reply and receipt lifecycle reaches CLOSED before backfill');

-- No-safe-match is a distinct automatic class with complete, current evidence.
update public.refund_cases set reporting_machine_id = 'da130000-0000-4000-8000-000000000001',
  reporting_location_id = 'da120000-0000-4000-8000-000000000001',
  incident_at = statement_timestamp() - interval '1 day', incident_local_datetime = '2026-09-01T10:00',
  incident_timezone = 'America/Los_Angeles', incident_time_resolution = 'exact', payment_method = 'card',
  payment_amount_cents = 700, card_last4 = '4242', card_wallet_used = false, status = 'needs_review',
  correlation_status = 'no_match', correlation_source = 'nayax', nayax_recommendation_state = 'no_safe_match',
  nayax_recommendation_policy_version = 'synthetic.v1', nayax_recommendation_evaluated_at = statement_timestamp()
where id in (select id from family_cases where family in ('no_match','no_match_review'));
insert into family_cycles select family, (public.service_claim_refund_follow_up_cycle(
  id, 'no_safe_match', (select template_version from public.refund_customer_contact_settings where singleton), repeat('f3',32), null) #>> '{cycle,id}')::uuid
from family_cases where family in ('no_match','no_match_review');
insert into public.refund_case_messages(id, refund_case_id, message_type, status, recipient_email, subject, body,
  content_source, delivery_kind, reason_code, template_version, follow_up_cycle_id, requested_fields)
select m.id, f.refund_case_id, 'no_safe_match', 'pending', c.customer_email, 'Synthetic no-match request', 'Synthetic match-information request.',
  'deterministic_template', 'automatic', f.reason_code, f.template_version, f.id, f.requested_fields
from family_messages m cross join family_cycles k join public.refund_follow_up_cycles f on f.id = k.id
join public.refund_cases c on c.id = f.refund_case_id where (m.family = 'no_safe_match' and k.family = 'no_match')
  or (m.family = 'no_safe_match_review' and k.family = 'no_match_review');
update public.refund_case_messages set status = 'sent', sent_at = statement_timestamp()
where id in (select id from family_messages where family in ('no_safe_match','no_safe_match_review'));
update public.refund_follow_up_cycles set status = 'manual_review'
where id = (select id from family_cycles where family = 'no_match_review');

update public.refund_cases set payment_method = 'card', card_wallet_used = true,
  wallet_correction_state = 'sent', wallet_correction_version = 1
where id = (select id from family_cases where family = 'wallet');
insert into public.refund_wallet_correction_contexts(refund_case_id, token_hash, version, expires_at)
select id, repeat('f4',32), 1, statement_timestamp() + interval '24 hours' from family_cases where family = 'wallet';
insert into public.refund_case_messages(id, refund_case_id, message_type, status, recipient_email, subject, body,
  template_key, content_source, delivery_kind, template_version)
select m.id, c.id, m.family, 'pending', 'family-wallet@example.invalid', 'Synthetic secure correction', 'Synthetic secure correction link.',
  'refund_' || m.family || '_v1', 'deterministic_template', 'automatic', 'refund_' || m.family || '_v1'
from family_messages m cross join family_cases c where c.family = 'wallet' and m.family in ('wallet_correction','wallet_correction_reminder');
update public.refund_case_messages set status = 'sent', sent_at = statement_timestamp()
where id in (select id from family_messages where family in ('wallet_correction','wallet_correction_reminder'));

insert into public.refund_case_appeals(refund_case_id, source_gmail_message_id, prior_customer_safe_reason, received_at)
select c.id, g.message_id, 'Synthetic historical denial reason.', statement_timestamp()
from family_cases c join family_gmail g using(family) where c.family = 'appeal';
insert into public.refund_case_messages(id, refund_case_id, message_type, status, recipient_email, subject, body,
  template_key, content_source, delivery_kind, reason_code, template_version, appeal_id)
select m.id, a.refund_case_id, 'appeal_received', 'pending', 'family-appeal@example.invalid', 'Synthetic appeal receipt', 'Synthetic appeal received.',
  'refund_appeal_received_v1', 'deterministic_template', 'automatic', 'denial_appeal', 'refund_appeal_received_v1', a.id
from family_messages m cross join public.refund_case_appeals a where m.family = 'appeal_received'
and a.refund_case_id = (select id from family_cases where family = 'appeal');
update public.refund_case_messages set status = 'sent', sent_at = statement_timestamp()
where id = (select id from family_messages where family = 'appeal_received');
update public.refund_cases set status = 'closed', payment_method = coalesce(payment_method, 'card'),
  automation_state = 'closed_incomplete', automation_follow_up_due_at = null
where id in (select id from family_cases where family in ('follow','no_match','no_match_review','wallet','appeal'));

-- Classifying a previously contacted synthetic case must still suppress the
-- backfill and real provider RPC; never weaken Internal/test protection.
insert into auth.users(id, email) values ('da160000-0000-4000-8000-000000000001', 'family-owner@example.invalid');
update public.refund_cases set case_population = 'internal_test', internal_test_reason = 'other_internal_test',
  internal_test_classified_at = statement_timestamp(), internal_test_classified_by = 'da160000-0000-4000-8000-000000000001',
  status = 'closed', automation_state = 'closed_incomplete'
where id = (select id from family_cases where family = 'internal');
update public.refund_customer_contact_settings set automatic_customer_contact_enabled = false where singleton;

create temporary table family_message_before as select k.family, to_jsonb(m) as value
from family_messages k join public.refund_case_messages m using(id);
create temporary table family_case_before as select c.id, to_jsonb(c) - array['lifecycle_revision','updated_at'] as value
from public.refund_cases c join family_cases k using(id);
create temporary table family_cycle_before as select f.id, to_jsonb(f) as value from public.refund_follow_up_cycles f join family_cycles k using(id);
create temporary table family_appeal_before as select a.id, to_jsonb(a) as value from public.refund_case_appeals a
where a.refund_case_id in (select id from family_cases);
create temporary table family_functions_before as
select proname, prosrc, prosecdef, provolatile, proconfig, proacl
from pg_proc where pronamespace = 'public'::regnamespace and proname in (
  'is_refund_message_delivery_bookkeeping', 'is_refund_message_recorded_delivery_failure',
  'guard_nayax_attempt_completion_message', 'guard_refund_legacy_state_message',
  'guard_refund_denial_appeal_message', 'guard_refund_follow_up_message',
  'guard_refund_follow_up_cycle', 'sync_refund_follow_up_cycle_from_message',
  'service_claim_due_refund_follow_up_reminders',
  'service_mark_refund_transactional_delivery_attempt', 'service_claim_refund_gmail_outbound_v3');

/* __HISTORICAL_FAMILY_GUARDS__ */

-- Each message gets its own rollback-contained probe, exposing every guard
-- failure instead of letting the first row hide all other historical families.
create function pg_temp.probe_old_family_backfill(message_id uuid) returns text language plpgsql as $$
begin
  update public.refund_case_messages set delivery_transport = 'resend', delivery_state = 'unknown',
    delivery_state_updated_at = coalesce(sent_at, created_at) where id = message_id;
  raise exception using errcode = 'ZX001', message = 'probe_succeeded';
exception when others then
  if sqlstate = 'ZX001' then return null; end if;
  return sqlstate || ':' || sqlerrm;
end;
$$;
select is(pg_temp.probe_old_family_backfill(id), expected_old_error,
  family || ': actual historical guard backfill behavior is reproduced') from family_messages order by family;
select ok(pg_temp.capture_delivery_upgrade_error($delivery_upgrade$
/* __FAMILY_ORIGINAL_BACKFILL__ */
$delivery_upgrade$) is not null, 'The complete actual backfill fails against populated historical message families');
select lives_ok($delivery_upgrade$
/* __FAMILY_CURRENT_DELIVERY_PREFIX__ */
$delivery_upgrade$, 'The complete current 0700 prefix upgrades every populated historical family with enabled triggers');
select is((select count(*) from family_functions_before), 11::bigint,
  'Fresh replay contains all eleven bookkeeping and pre-provider boundary functions');
select ok(not exists(select 1 from family_functions_before b full join (
  select proname, prosrc, prosecdef, provolatile, proconfig, proacl from pg_proc
  where pronamespace = 'public'::regnamespace and proname in (select proname from family_functions_before)
) p using(proname) where b.proname is null or p.proname is null or b.prosrc is distinct from p.prosrc
  or b.prosecdef is distinct from p.prosecdef or b.provolatile is distinct from p.provolatile
  or b.proconfig is distinct from p.proconfig or b.proacl is distinct from p.proacl),
  'Fresh final and populated-upgrade functions have identical bodies, ownership mode, volatility, path and ACL');
select ok(not has_function_privilege(api_role, 'public.is_refund_message_delivery_bookkeeping(jsonb,jsonb)', 'execute')
  and not has_function_privilege(api_role, 'public.is_refund_message_recorded_delivery_failure(jsonb)', 'execute'),
  api_role || ': private bookkeeping helpers are not callable by API roles')
from (values ('anon'),('authenticated'),('service_role')) roles(api_role);
select is((select count(*) from public.refund_case_messages m join family_messages k using(id)
  where k.family <> 'internal' and m.delivery_transport = 'resend' and m.delivery_state = 'unknown' and m.provider_message_id is null),
  14::bigint, 'All fourteen non-internal historical message families receive unknown-only delivery metadata');
select is(to_jsonb(m) - array['delivery_transport','provider_message_id','delivery_state','delivery_state_updated_at'],
  b.value - array['delivery_transport','provider_message_id','delivery_state','delivery_state_updated_at'],
  k.family || ': backfill preserves every non-delivery field')
from family_messages k join public.refund_case_messages m using(id) join family_message_before b using(family);

set local role service_role;
select is(public.service_bind_refund_transactional_delivery(id, 'resend_family_' || family, statement_timestamp())->>'bound',
  'true', family || ': actual service provider binding succeeds after case advance')
from family_messages where family <> 'internal' order by family;
reset role;

-- For every guarded family, forged receipt/content/identity changes must fail.
select is(public.is_refund_message_delivery_bookkeeping(to_jsonb(m), to_jsonb(m) || jsonb_build_object(
  'status','failed','delivery_state','bounced','error_message','transactional_delivery_bounced',
  'delivery_state_updated_at',statement_timestamp())), false,
  k.family || ': private helper never authorizes an unrecorded terminal delivery event')
from family_messages k join public.refund_case_messages m using(id);
select ok(pg_temp.capture_delivery_upgrade_error(format('update public.refund_case_messages set status = ''failed'', delivery_state = ''bounced'', error_message = ''transactional_delivery_bounced'', delivery_state_updated_at = statement_timestamp() where id = %L', id)) is not null,
  family || ': no-event terminal failure is rejected') from family_messages where family <> 'internal' and family not like 'manual%' and family not like 'wallet%' order by family;
set local role service_role;
select is(public.service_record_refund_transactional_delivery_event(md5(family || ':bounce') || md5(family || ':bounce'),
  'resend_family_' || family, 'bounced', statement_timestamp())->>'deliveryState', 'bounced',
  family || ': actual bound bounce settles after lifecycle advance with contact disabled')
from family_messages where family <> 'internal' order by family;
select is(public.service_record_refund_transactional_delivery_event(md5(family || ':complaint') || md5(family || ':complaint'),
  'resend_family_' || family, 'complained', statement_timestamp())->>'deliveryState', 'complained',
  family || ': actual bound complaint advances prior failure')
from family_messages where family <> 'internal' order by family;
select is(public.service_record_refund_transactional_delivery_event(md5(family || ':complaint') || md5(family || ':complaint'),
  'resend_family_' || family, 'complained', statement_timestamp())->>'duplicate', 'true',
  family || ': exact provider event replay is deduplicated')
from family_messages where family <> 'internal' order by family;
select is(pg_temp.capture_delivery_upgrade_error(format('select public.service_bind_refund_transactional_delivery(%L, ''resend_family_internal'', statement_timestamp())',
  (select id from family_messages where family = 'internal'))),
  'P4640:Customer delivery evidence is suppressed for Internal/test cases',
  'Previously sent Internal/test message remains explicitly suppressed by real binding RPC');
reset role;

select is(public.is_refund_message_delivery_bookkeeping(to_jsonb(m), to_jsonb(m) || jsonb_build_object(changed.column_name, changed.value)),
  false, k.family || ': private helper rejects forged ' || changed.column_name || ' despite a genuine receipt')
from family_messages k join public.refund_case_messages m using(id)
cross join (values ('body','Forged body'), ('recipient_email','other@example.invalid'),
  ('provider_message_id','resend_forged_identity'), ('status','pending'), ('message_type','manual_note')) changed(column_name,value);
select is(public.is_refund_message_delivery_bookkeeping(to_jsonb(m), to_jsonb(m) || jsonb_build_object(
  'delivery_state_updated_at',m.delivery_state_updated_at + interval '1 day')), false,
  k.family || ': private helper rejects an invented future event timestamp')
from family_messages k join public.refund_case_messages m using(id) where k.family <> 'internal';

select is(to_jsonb(m) - array['delivery_transport','provider_message_id','delivery_state','delivery_state_updated_at','status','error_message'],
  b.value - array['delivery_transport','provider_message_id','delivery_state','delivery_state_updated_at','status','error_message'],
  k.family || ': verified events preserve every original envelope/evidence/send field')
from family_messages k join public.refund_case_messages m using(id) join family_message_before b using(family);
select is(to_jsonb(c) - array['lifecycle_revision','updated_at'], b.value, k.family || ': delivery bookkeeping preserves all current case facts')
from family_cases k join public.refund_cases c using(id) join family_case_before b using(id);
select is(to_jsonb(f), b.value, k.family || ': delivery bookkeeping does not rewrite advanced follow-up cycle')
from family_cycles k join public.refund_follow_up_cycles f using(id) join family_cycle_before b using(id);
select lives_ok(format('update public.refund_follow_up_cycles set status = status where id = %L', id),
  family || ': a later valid cycle update still recognizes actual SENT evidence after a verified failure')
from family_cycles order by family;
select is(to_jsonb(a), b.value, 'Delivery bookkeeping preserves the appeal ledger')
from public.refund_case_appeals a join family_appeal_before b using(id);
select is((select to_jsonb(m) from public.refund_case_messages m where id = (select id from family_messages where family = 'internal')),
  (select value from family_message_before where family = 'internal'), 'Internal/test historical message is completely unchanged');
select is((select count(*) from public.refund_case_nayax_refund_attempts where refund_case_id in (select id from family_cases)),
  0::bigint, 'Multi-family upgrade and real delivery events create no payment attempts');
select is((select count(*) from public.refund_case_messages where refund_case_id in (select id from family_cases)),
  15::bigint, 'Multi-family upgrade and real delivery events create no duplicate customer messages');
select ok(not exists(select 1 from pg_trigger where tgrelid in ('public.refund_case_messages'::regclass, 'public.refund_cases'::regclass,
  'public.refund_follow_up_cycles'::regclass) and not tgisinternal and tgenabled = 'D'), 'Every case, message and cycle guard stays enabled throughout family regression');

-- Keep these cases OPEN and WAITING. Closing all historical examples would
-- hide the risk of a new reminder after a terminal original-request receipt.
create temporary table active_reminder_cases(family text primary key, id uuid default gen_random_uuid(), message_id uuid default gen_random_uuid());
insert into active_reminder_cases(family) values ('bounced'),('complained'),('claimed'),('healthy');
grant select on active_reminder_cases to service_role;
insert into public.refund_cases(id, customer_email, issue_summary, status, payment_method,
  reporting_machine_id, reporting_location_id, incident_at, created_at)
select id, 'active-' || family || '@example.invalid', 'Synthetic active reminder delivery safety', 'needs_review', 'cash',
  'da130000-0000-4000-8000-000000000001', 'da120000-0000-4000-8000-000000000001',
  statement_timestamp() - interval '8 days', statement_timestamp() - interval '8 days'
from active_reminder_cases;
update public.refund_customer_contact_settings set automatic_customer_contact_enabled = true where singleton;
create temporary table active_reminder_cycles as
select family, (public.service_claim_refund_follow_up_cycle(id, 'missing_information',
  (select template_version from public.refund_customer_contact_settings where singleton),
  md5(family || ':active') || md5(family || ':active'), null) #>> '{cycle,id}')::uuid as id
from active_reminder_cases;
insert into public.refund_case_messages(id, refund_case_id, message_type, status, recipient_email, subject, body,
  content_source, delivery_kind, reason_code, template_version, follow_up_cycle_id, requested_fields, created_at)
select k.message_id, f.refund_case_id, 'more_info', 'pending', c.customer_email, 'Synthetic active request', 'Synthetic missing facts.',
  'deterministic_template', 'automatic', f.reason_code, f.template_version, f.id, f.requested_fields,
  statement_timestamp() - case when k.family = 'claimed' then interval '6 days' else interval '4 days' end
from active_reminder_cases k join active_reminder_cycles r using(family)
join public.refund_follow_up_cycles f on f.id = r.id join public.refund_cases c on c.id = f.refund_case_id;
update public.refund_case_messages m set status = 'sent', sent_at = m.created_at + interval '1 minute'
from active_reminder_cases k where m.id = k.message_id;
select is((public.service_claim_due_refund_follow_up_reminders(1)->'reminders'->0->>'refundCaseId')::uuid,
  (select id from active_reminder_cases where family = 'claimed'),
  'Before terminal delivery, the oldest healthy request obtains a real reminder claim');
insert into public.refund_case_messages(id, refund_case_id, message_type, status, recipient_email, subject, body,
  content_source, delivery_kind, reason_code, template_version, follow_up_cycle_id, requested_fields)
select 'da170000-0000-4000-8000-000000000001', f.refund_case_id, 'reminder', 'pending', c.customer_email,
  'Synthetic claimed reminder', 'Synthetic reminder claimed before bounce.',
  'deterministic_template', 'automatic', f.reason_code, f.template_version, f.id, f.requested_fields
from active_reminder_cycles k join public.refund_follow_up_cycles f using(id)
join public.refund_cases c on c.id = f.refund_case_id where k.family = 'claimed';
update public.refund_case_messages m set delivery_transport = 'resend', delivery_state = 'unknown', delivery_state_updated_at = m.sent_at
from active_reminder_cases k where m.id = k.message_id;
update public.refund_customer_contact_settings set automatic_customer_contact_enabled = false where singleton;
set local role service_role;
select is(public.service_bind_refund_transactional_delivery(message_id, 'resend_active_' || family, statement_timestamp())->>'bound',
  'true', family || ': active request binds real provider delivery while customer contact is paused') from active_reminder_cases;
select is(public.service_record_refund_transactional_delivery_event(md5(family || ':active-fail') || md5(family || ':active-fail'),
  'resend_active_' || family, case when family = 'complained' then 'complained' else 'bounced' end,
  statement_timestamp())->>'applied', 'true', family || ': verified terminal receipt applies to the still-open request')
from active_reminder_cases where family <> 'healthy';
reset role;
select is(c.status, 'waiting_on_customer', k.family || ': case remains open after historical delivery bookkeeping')
from active_reminder_cases k join public.refund_cases c using(id);
select is(f.status, 'waiting', k.family || ': existing cycle remains immutable waiting history')
from active_reminder_cycles k join public.refund_follow_up_cycles f using(id);
update public.refund_customer_contact_settings set automatic_customer_contact_enabled = true where singleton;
create temporary table active_due_result as select public.service_claim_due_refund_follow_up_reminders(100) as value;
select is(jsonb_array_length(value->'reminders'), 1,
  'Restored contact claims only the healthy request, never bounced or complained open requests') from active_due_result;
select is((value->'reminders'->0->>'refundCaseId')::uuid,
  (select id from active_reminder_cases where family = 'healthy'),
  'Still-successful original request remains eligible after restoration') from active_due_result;
select is(pg_temp.capture_delivery_upgrade_error($sql$
  update public.refund_case_messages set status = 'sent', sent_at = statement_timestamp()
  where id = 'da170000-0000-4000-8000-000000000001'
$sql$), '23514:Follow-up reminder requires a non-failed original request',
  'A pre-bounce claimed reminder cannot send after contact restoration');
select is((select status from public.refund_case_messages where id = 'da170000-0000-4000-8000-000000000001'),
  'pending', 'Rejected in-flight reminder creates no SENT communication');
select is((select count(*) from public.refund_case_messages where refund_case_id in (select id from active_reminder_cases)),
  5::bigint, 'Active-request delivery safety creates no duplicate customer messages');

create temporary table active_pending_reminder_before as select to_jsonb(m) as value
from public.refund_case_messages m where m.id = 'da170000-0000-4000-8000-000000000001';
set local role service_role;
select is(pg_temp.capture_delivery_upgrade_error($sql$
  select public.service_mark_refund_transactional_delivery_attempt('da170000-0000-4000-8000-000000000001')
$sql$), '23514:Follow-up reminder requires a non-failed original request',
  'Actual Resend pre-provider mark rejects a claimed reminder after original-request bounce');
select is(pg_temp.capture_delivery_upgrade_error(format($sql$
  select public.service_claim_refund_gmail_outbound_v3(%L, 'da170000-0000-4000-8000-000000000001',
    'refund-active-failed-request', 'fixture-mailbox@example.invalid', 'active-claimed@example.invalid',
    'Synthetic reminder claimed before bounce.', array['fixture-mailbox@example.invalid'], 'automatic', null)
$sql$, (select id from active_reminder_cases where family = 'claimed'))),
  '23514:Follow-up reminder requires a non-failed original request',
  'Actual Gmail fresh outbound claim rejects a claimed reminder before creating a transport operation');
reset role;
select is((select to_jsonb(m) from public.refund_case_messages m where m.id = 'da170000-0000-4000-8000-000000000001'),
  (select value from active_pending_reminder_before), 'Rejected pre-provider RPCs change no pending message or delivery marker');
select is((select count(*) from public.refund_gmail_messages where operation_key = 'refund-active-failed-request'),
  0::bigint, 'Rejected fresh Gmail claim creates no outbound operation');

-- A separately verified SENT Gmail operation is immutable delivery history,
-- not a new provider attempt. Reconcile it even after the request failed and
-- contact was paused, retaining the original operation and provider proof.
insert into public.refund_gmail_threads(id, refund_case_id, mailbox_hash, provider_thread_id, thread_subject,
  first_message_at, latest_message_at, retention_expires_at)
select 'da180000-0000-4000-8000-000000000001', id, repeat('f5',32), 'active-known-sent-replay',
  'Synthetic previously sent reminder', statement_timestamp(), statement_timestamp(), statement_timestamp() + interval '180 days'
from active_reminder_cases where family = 'claimed';
insert into public.refund_gmail_messages(id, gmail_thread_id, refund_case_id, refund_case_message_id,
  provider_message_id, operation_key, direction, status, sender_email, recipient_email, subject, plain_body,
  received_at, sent_at, retention_expires_at, participant_role, participant_trust, delivery_kind)
select 'da190000-0000-4000-8000-000000000001', 'da180000-0000-4000-8000-000000000001', id,
  'da170000-0000-4000-8000-000000000001', 'synthetic-known-sent-reminder', 'refund-active-failed-request',
  'outbound', 'sent', 'fixture-mailbox@example.invalid', 'active-claimed@example.invalid',
  'Synthetic previously sent reminder', 'Synthetic reminder claimed before bounce.', statement_timestamp(),
  statement_timestamp(), statement_timestamp() + interval '180 days', 'mailbox', 'verified', 'automatic'
from active_reminder_cases where family = 'claimed';
update public.refund_customer_contact_settings set automatic_customer_contact_enabled = false where singleton;
set local role service_role;
select is(public.service_claim_refund_gmail_outbound_v3((select id from active_reminder_cases where family = 'claimed'),
  'da170000-0000-4000-8000-000000000001', 'refund-active-failed-request', 'fixture-mailbox@example.invalid',
  'active-claimed@example.invalid', 'Synthetic reminder claimed before bounce.', array['fixture-mailbox@example.invalid'],
  'automatic', 'da180000-0000-4000-8000-000000000001')->>'reconciled', 'true',
  'Known-SENT Gmail replay reconciles existing truth despite failed request and paused contact');
select is(public.service_claim_refund_gmail_outbound_v3((select id from active_reminder_cases where family = 'claimed'),
  'da170000-0000-4000-8000-000000000001', 'refund-active-failed-request', 'fixture-mailbox@example.invalid',
  'active-claimed@example.invalid', 'Synthetic reminder claimed before bounce.', array['fixture-mailbox@example.invalid'],
  'automatic', 'da180000-0000-4000-8000-000000000001')->>'claimed', 'false',
  'Repeated known-SENT Gmail reconciliation never claims another external send');
reset role;
select is((select count(*) from public.refund_gmail_messages where operation_key = 'refund-active-failed-request'),
  1::bigint, 'Known-SENT reconciliation retains exactly one original Gmail operation');

-- The healthy positive control already holds a real due-reminder claim. Its
-- provider may accept the reminder before the original request's bounce arrives.
-- That ordering is reconciliation, not fresh-send authority or a failed send.
update public.refund_customer_contact_settings set automatic_customer_contact_enabled = true where singleton;
insert into public.refund_case_messages(id, refund_case_id, message_type, status, recipient_email, subject, body,
  content_source, delivery_kind, reason_code, template_version, follow_up_cycle_id, requested_fields)
select 'da200000-0000-4000-8000-000000000001', f.refund_case_id, 'reminder', 'pending', c.customer_email,
  'Synthetic provider-accepted reminder', 'Synthetic provider acceptance before original bounce.',
  'deterministic_template', 'automatic', f.reason_code, f.template_version, f.id, f.requested_fields
from active_reminder_cycles k join public.refund_follow_up_cycles f using(id)
join public.refund_cases c on c.id = f.refund_case_id where k.family = 'healthy';
create temporary table active_unbound_reminder_before as select to_jsonb(m) as value
from public.refund_case_messages m where m.id = 'da200000-0000-4000-8000-000000000001';
create function pg_temp.probe_unbound_reminder_sent(forge_new_binding boolean) returns text language plpgsql as $$
begin
  perform public.service_record_refund_transactional_delivery_event(repeat('d7',32), 'resend_active_healthy',
    'bounced', statement_timestamp());
  update public.refund_case_messages set status = 'sent', sent_at = statement_timestamp(),
    delivery_transport = case when forge_new_binding then 'resend' else delivery_transport end,
    provider_message_id = case when forge_new_binding then 'resend_unproved_new_only' else provider_message_id end,
    delivery_state = case when forge_new_binding then 'accepted' else delivery_state end,
    delivery_state_updated_at = case when forge_new_binding then statement_timestamp() else delivery_state_updated_at end
  where id = 'da200000-0000-4000-8000-000000000001';
  raise exception using errcode = 'ZX001', message = 'probe_succeeded';
exception when others then
  if sqlstate = 'ZX001' then return null; end if;
  return sqlstate || ':' || sqlerrm;
end;
$$;
select is(pg_temp.probe_unbound_reminder_sent(false),
  '23514:Follow-up reminder requires a non-failed original request',
  'No OLD provider acceptance means original bounce still blocks final SENT');
select is(pg_temp.probe_unbound_reminder_sent(true),
  '23514:Follow-up reminder requires a non-failed original request',
  'Supplying accepted binding only in NEW never fabricates reconciliation authority');
select is((select to_jsonb(m) from public.refund_case_messages m where m.id = 'da200000-0000-4000-8000-000000000001'),
  (select value from active_unbound_reminder_before), 'Rejected unproved sends leave the entire pending reminder unchanged');
select is((select m.status || ':' || m.delivery_state from public.refund_case_messages m
  join active_reminder_cases k on k.message_id = m.id where k.family = 'healthy'), 'sent:accepted',
  'Rollback-contained negative receipt probes preserve the actual healthy original request');
set local role service_role;
select is(public.service_mark_refund_transactional_delivery_attempt('da200000-0000-4000-8000-000000000001')->>'marked',
  'true', 'Healthy original permits the actual last pre-provider mark');
select is(public.service_bind_refund_transactional_delivery('da200000-0000-4000-8000-000000000001',
  'resend_accepted_reminder_before_bounce', statement_timestamp())->>'bound', 'true',
  'Actual provider binding records accepted reminder before original-request bounce');
reset role;
create temporary table active_accepted_reminder_before as select to_jsonb(m) as value
from public.refund_case_messages m where m.id = 'da200000-0000-4000-8000-000000000001';
update public.refund_customer_contact_settings set automatic_customer_contact_enabled = false where singleton;
set local role service_role;
select is(public.service_record_refund_transactional_delivery_event(repeat('d8',32), 'resend_active_healthy',
  'bounced', statement_timestamp())->>'applied', 'true',
  'Original request genuinely bounces after reminder provider acceptance with contact paused');
select lives_ok($sql$
  update public.refund_case_messages set status = 'sent', sent_at = statement_timestamp(), error_message = null
  where id = 'da200000-0000-4000-8000-000000000001'
$sql$, 'Already-accepted Resend reminder reconciles SENT without a new mark or send after original bounce');
reset role;
select is((select status || ':' || delivery_state from public.refund_case_messages where id = 'da200000-0000-4000-8000-000000000001'),
  'sent:accepted', 'Accepted reminder is not mislabeled failed by a later original-request bounce');
select is(to_jsonb(m) - array['status','sent_at','error_message'], b.value - array['status','sent_at','error_message'],
  'Accepted reminder reconciliation preserves exact provider binding and every original envelope/evidence field')
from public.refund_case_messages m cross join active_accepted_reminder_before b
where m.id = 'da200000-0000-4000-8000-000000000001';
select is((select count(*) from public.refund_case_messages m join active_reminder_cases k on k.id = m.refund_case_id
  where k.family = 'healthy' and m.message_type = 'reminder'), 1::bigint,
  'Accepted-before-bounce ordering retains exactly one original reminder');
