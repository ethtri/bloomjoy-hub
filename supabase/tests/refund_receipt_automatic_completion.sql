begin;
create extension if not exists pgtap with schema extensions;
set local search_path=public,extensions;
select no_plan();

insert into auth.users(instance_id,id,aud,role,email,encrypted_password,email_confirmed_at,
  raw_app_meta_data,raw_user_meta_data,created_at,updated_at)
values('00000000-0000-0000-0000-000000000000','ce000000-0000-4000-8000-000000000001',
  'authenticated','authenticated','receipt-auto-ops@example.invalid','',now(),'{}','{}',now(),now());
insert into auth.sessions(id,user_id,created_at,updated_at)
values('ce010000-0000-4000-8000-000000000001','ce000000-0000-4000-8000-000000000001',now(),now());
insert into public.admin_roles(user_id,role,active)
values('ce000000-0000-4000-8000-000000000001','super_admin',true);
insert into public.customer_accounts(id,name,account_type)
values('ce100000-0000-4000-8000-000000000001','Receipt automatic completion','internal');
insert into public.reporting_locations(id,account_id,name,timezone)
values('ce200000-0000-4000-8000-000000000001','ce100000-0000-4000-8000-000000000001',
  'Receipt automatic completion','America/Los_Angeles');
insert into public.reporting_machines(id,account_id,location_id,machine_label,nayax_machine_id,nayax_account_key)
values('ce300000-0000-4000-8000-000000000001','ce100000-0000-4000-8000-000000000001',
  'ce200000-0000-4000-8000-000000000001','Receipt automatic completion','RC-AUTO-MACHINE','RC-AUTO-ACCOUNT');
insert into public.reporting_machine_refund_managers(reporting_machine_id,manager_user_id,manager_email,grant_reason)
values('ce300000-0000-4000-8000-000000000001','ce000000-0000-4000-8000-000000000001',
  'receipt-auto-ops@example.invalid','Synthetic receipt automatic completion');
insert into public.refund_cases(id,public_reference,reporting_machine_id,reporting_location_id,customer_email,issue_summary,
  incident_at,payment_method,payment_amount_cents,refund_amount_cents,card_last4,status,correlation_status,correlation_source,
  correlation_confidence,automation_state,matched_nayax_transaction_id,matched_nayax_amount_cents,matched_nayax_currency_code,
  matched_nayax_machine_auth_time,lifecycle_integrity_status,lifecycle_integrity_code,lifecycle_integrity_detected_at)
select ('ce400000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid,'RF-RC-AUTO-'||n,
  'ce300000-0000-4000-8000-000000000001','ce200000-0000-4000-8000-000000000001',
  'receipt-auto-customer@example.invalid','Synthetic receipt automatic completion',now()-interval '3 days','card',900,900,
  '4242','card_refund_pending','matched','nayax',1,'approved',(923456780+n)::text,900,'USD',now()-interval '3 days',
  'hold','card_payment_state_without_attempt',now()-interval '1 day' from generate_series(1,6) n;

select set_config('request.jwt.claim.sub','ce000000-0000-4000-8000-000000000001',true);
select set_config('request.jwt.claim.role','authenticated',true);
select set_config('request.jwt.claims',
  '{"sub":"ce000000-0000-4000-8000-000000000001","role":"authenticated","session_id":"ce010000-0000-4000-8000-000000000001","is_anonymous":false}',true);
select public.admin_record_refund_authoritative_receipt(c.id,null,c.official_action_version,'RC-AUTO-ACCOUNT','RC-AUTO-MACHINE',
  c.matched_nayax_transaction_id,900,900,'USD',62,'DTM:NAYAX-'||c.matched_nayax_transaction_id,true)
from public.refund_cases c where c.id in (
  'ce400000-0000-4000-8000-000000000001','ce400000-0000-4000-8000-000000000002',
  'ce400000-0000-4000-8000-000000000003','ce400000-0000-4000-8000-000000000005',
  'ce400000-0000-4000-8000-000000000006');

create function pg_temp.capture_error(statement text) returns text language plpgsql as $$
begin execute statement; return null; exception when others then return sqlstate; end; $$;
create function pg_temp.authorize(n integer) returns uuid language plpgsql as $$
declare case_id uuid:=('ce400000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid; receipt_id uuid;
begin
  select id into receipt_id from public.refund_authoritative_receipts where refund_case_id=case_id;
  return public.refund_create_receipt_completion_automation_authority(case_id,receipt_id,
    encode(extensions.digest(convert_to('receipt-auto-source-'||n,'UTF8'),'sha256'),'hex'));
end; $$;
create function pg_temp.ensure(n integer) returns jsonb language plpgsql as $$
declare case_id uuid:=('ce400000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid; receipt_id uuid; authority_id uuid;
begin
  select id into receipt_id from public.refund_authoritative_receipts where refund_case_id=case_id;
  select id into authority_id from public.refund_receipt_completion_automation_authorities where refund_case_id=case_id;
  return public.service_ensure_refund_receipt_automatic_completion(case_id,receipt_id,authority_id);
end; $$;
create function pg_temp.ensure_triplet(case_n integer,receipt_n integer,authority_n integer)
returns jsonb language plpgsql as $$
declare case_id uuid:=('ce400000-0000-4000-8000-'||lpad(case_n::text,12,'0'))::uuid;
  receipt_id uuid; authority_id uuid;
begin
  select id into receipt_id from public.refund_authoritative_receipts
    where refund_case_id=('ce400000-0000-4000-8000-'||lpad(receipt_n::text,12,'0'))::uuid;
  select id into authority_id from public.refund_receipt_completion_automation_authorities
    where refund_case_id=('ce400000-0000-4000-8000-'||lpad(authority_n::text,12,'0'))::uuid;
  return public.service_ensure_refund_receipt_automatic_completion(case_id,receipt_id,authority_id);
end; $$;

select ok(not has_table_privilege('anon','public.refund_receipt_completion_automation_authorities','select'),
  'Anonymous callers cannot read immutable completion authority');
select ok(not has_table_privilege('authenticated','public.refund_receipt_completion_automation_authorities','insert'),
  'Authenticated users cannot mint immutable completion authority');
select ok(not has_table_privilege('service_role','public.refund_receipt_completion_automation_authorities','insert'),
  'The service worker cannot mint immutable completion authority');
select ok(not has_function_privilege('service_role',
  'public.refund_create_receipt_completion_automation_authority(uuid,uuid,text)','execute'),
  'The private terminal writer seam is not a service RPC');
select ok(not has_function_privilege('authenticated',
  'public.service_ensure_refund_receipt_automatic_completion(uuid,uuid,uuid)','execute'),
  'Customer completion coordination is not an authenticated-user RPC');
select ok(has_function_privilege('service_role',
  'public.service_ensure_refund_receipt_automatic_completion(uuid,uuid,uuid)','execute'),
  'The service worker can consume an existing exact authority');

select ok(pg_temp.authorize(1) is not null,'A newly recorded independently reviewed receipt gets one authority');
select is(pg_temp.authorize(1),
  (select id from public.refund_receipt_completion_automation_authorities
    where refund_case_id='ce400000-0000-4000-8000-000000000001'),
  'Exact authority creation is idempotent');
select is(pg_temp.capture_error($$select public.refund_create_receipt_completion_automation_authority(
  'ce400000-0000-4000-8000-000000000001',(select id from public.refund_authoritative_receipts
    where refund_case_id='ce400000-0000-4000-8000-000000000001'),repeat('0',64))$$),
  'P4668','Conflicting authority evidence cannot replace the immutable grant');
select is(pg_temp.capture_error($$update public.refund_receipt_completion_automation_authorities
  set expected_case_version=expected_case_version+1 where refund_case_id='ce400000-0000-4000-8000-000000000001'$$),
  'P4660','Completion authority is immutable');

-- A directly staged old receipt proves the same-transaction boundary. No
-- production/history scan or backfill is used by the migration or coordinator.
insert into public.refund_authoritative_receipts(refund_case_id,reporting_machine_id,account_scope,provider_machine_id,
  original_transaction_id,original_amount_cents,refunded_amount_cents,currency_code,provider_status,
  evidence_reference_digest,observed_at,recorded_by,attempt_binding_kind,current_provider_observation_reviewed)
select c.id,c.reporting_machine_id,'RC-AUTO-ACCOUNT','RC-AUTO-MACHINE',c.matched_nayax_transaction_id,900,900,'USD',62,
  encode(extensions.digest(convert_to('receipt-auto-old','UTF8'),'sha256'),'hex'),transaction_timestamp()-interval '1 day',
  'ce000000-0000-4000-8000-000000000001','no_attempt_integrity_hold',true
from public.refund_cases c where c.id='ce400000-0000-4000-8000-000000000004';
select is(pg_temp.capture_error($$select public.refund_create_receipt_completion_automation_authority(
  'ce400000-0000-4000-8000-000000000004',(select id from public.refund_authoritative_receipts
    where refund_case_id='ce400000-0000-4000-8000-000000000004'),repeat('4',64))$$),
  'P4668','A later worker cannot grant authority to a historical receipt');

update public.refund_customer_contact_settings set automatic_customer_contact_enabled=false where singleton;
select pg_temp.authorize(3);
set local role service_role;
select is(pg_temp.ensure_triplet(1,3,1)->>'status','not_authorized',
  'Crossed receipt identity cannot consume exact completion authority');
select is(pg_temp.ensure_triplet(1,1,3)->>'status','not_authorized',
  'Crossed automation authority cannot enqueue for another receipt');
select is(pg_temp.ensure(3)->>'status','review_required','The database customer-contact gate stays fail closed');
select is(pg_temp.ensure(4)->>'status','not_authorized','A receipt without immutable authority is nonterminal');
reset role;
select is((select count(*)::integer from public.refund_case_messages where refund_case_id in
  ('ce400000-0000-4000-8000-000000000003','ce400000-0000-4000-8000-000000000004')),0,
  'Disabled or unsupported evidence creates no message');

update public.refund_customer_contact_settings set automatic_customer_contact_enabled=true where singleton;
update public.refund_cases set issue_summary=issue_summary||' version drift'
where id='ce400000-0000-4000-8000-000000000003';
set local role service_role;
select is(pg_temp.ensure(3)->>'status','review_required',
  'A changed case version requires review instead of automatic completion');
reset role;
select is((select count(*)::integer from public.refund_case_messages
  where refund_case_id='ce400000-0000-4000-8000-000000000003'),0,
  'Version drift creates no automatic completion message');

set local role service_role;
create temp table receipt_auto_first as select pg_temp.ensure(1) payload;
select is((select payload->>'status' from receipt_auto_first),'canonical_message',
  'Exact immutable authority creates the canonical completion intent');
select is((select payload->>'replayed' from receipt_auto_first),'false','First coordination is not a replay');
select is(pg_temp.ensure(1)->>'replayed','true','Service replay returns the same canonical message');
reset role;
select is((select count(*)::integer from public.refund_receipt_completion_intents
  where refund_case_id='ce400000-0000-4000-8000-000000000001'),1,'Replay preserves one completion intent');
select is((select count(*)::integer from public.refund_case_messages
  where refund_case_id='ce400000-0000-4000-8000-000000000001' and template_version='refund_receipt_completion_v1'),1,
  'Replay preserves one existing outbox message');
select ok((select not i.reviewed_no_existing_notice and i.automation_authority_id=a.id
  and i.actor_user_id=a.authorized_actor_user_id
  from public.refund_receipt_completion_intents i
  join public.refund_receipt_completion_automation_authorities a on a.refund_case_id=i.refund_case_id
  where i.refund_case_id='ce400000-0000-4000-8000-000000000001'),
  'Automatic intent records immutable authority without fabricating human review');
select ok((select m.subject=(public.refund_receipt_completion_copy(m.refund_case_id)->>'subject')
  and m.body=(public.refund_receipt_completion_copy(m.refund_case_id)->>'body')
  and m.recipient_email=(public.refund_receipt_completion_copy(m.refund_case_id)->>'recipientEmail')
  from public.refund_case_messages m where m.refund_case_id='ce400000-0000-4000-8000-000000000001'
    and m.template_version='refund_receipt_completion_v1'),
  'Automatic completion reuses the exact canonical copy contract');

select pg_temp.authorize(2);
set local role authenticated;
create temp table receipt_auto_manual_winner as
select public.admin_queue_refund_receipt_completion(c.id,r.id,c.official_action_version,gen_random_uuid(),true,
  public.admin_get_refund_authoritative_receipt_overview(c.id)#>>'{completionNotice,reviewBinding}') payload
from public.refund_cases c join public.refund_authoritative_receipts r on r.refund_case_id=c.id
where c.id='ce400000-0000-4000-8000-000000000002';
reset role;
set local role service_role;
select is(pg_temp.ensure(2)->>'replayed','true','A human queue winner is safely adopted as the canonical outcome');
reset role;
select ok((select i.reviewed_no_existing_notice and i.automation_authority_id is null
  from public.refund_receipt_completion_intents i
  where i.refund_case_id='ce400000-0000-4000-8000-000000000002'),
  'The existing human-reviewed intent remains truthfully distinct');

select pg_temp.authorize(5);
insert into public.refund_gmail_threads(id,refund_case_id,mailbox_hash,provider_thread_id,thread_subject,
  first_message_at,latest_message_at,retention_expires_at)
values('ce700000-0000-4000-8000-000000000005','ce400000-0000-4000-8000-000000000005',repeat('a',64),
  'receipt-auto-adopted-thread','Synthetic already-sent completion',now()-interval '1 day',now(),now()+interval '30 days');
insert into public.refund_gmail_messages(id,gmail_thread_id,refund_case_id,provider_message_id,operation_key,direction,
  message_kind,status,sender_email,recipient_email,subject,plain_body,sent_at,retention_expires_at,received_at)
values('ce800000-0000-4000-8000-000000000005','ce700000-0000-4000-8000-000000000005',
  'ce400000-0000-4000-8000-000000000005','receipt-auto-adopted-message','imported:receipt-auto-adopted-message',
  'outbound','message','sent','info@bloomjoysweets.com','receipt-auto-customer@example.invalid',
  'Your refund is confirmed','RF-RC-AUTO-5 original 923456785 is fully refunded $9.00.',
  now()-interval '1 hour',now()+interval '30 days',now()-interval '1 hour');
set local role authenticated;
select public.admin_adopt_refund_completion_notice(c.id,r.id,'ce800000-0000-4000-8000-000000000005',
  c.official_action_version,c.public_reference,c.matched_nayax_transaction_id,900,true)
from public.refund_cases c join public.refund_authoritative_receipts r on r.refund_case_id=c.id
where c.id='ce400000-0000-4000-8000-000000000005';
reset role;
set local role service_role;
select is(pg_temp.ensure(5)->>'status','existing_notice_adopted',
  'Existing exact SENT-notice adoption wins without another message');
reset role;
select is((select count(*)::integer from public.refund_case_messages
  where refund_case_id='ce400000-0000-4000-8000-000000000005'),0,
  'Adoption outcome creates no canonical outbox duplicate');

select pg_temp.authorize(6);
insert into public.refund_external_notice_observations(receipt_id,refund_case_id,sender_email,recipient_email,
  mailbox_hash,provider_message_id,provider_thread_id,provider_message_digest,reviewed_message_digest,
  evidence_reference,evidence_snapshot_digest,sent_at,observed_by,
  customer_only_no_cc_reviewed,exact_case_amount_reviewed,owned_mailbox_sent_reviewed)
select r.id,c.id,'owner@example.invalid',lower(btrim(c.customer_email)),repeat('b',64),'abcdef06','abcdef0601',
  repeat('c',64),repeat('d',64),'GMAIL-SENT:abcdef06',repeat('e',64),'2026-09-01T00:00:00Z'::timestamptz,
  'ce000000-0000-4000-8000-000000000001',true,true,true
from public.refund_cases c join public.refund_authoritative_receipts r on r.refund_case_id=c.id
where c.id='ce400000-0000-4000-8000-000000000006';
set local role service_role;
select is(pg_temp.ensure(6)->>'status','existing_notice_observed',
  'A standalone external observation wins without another message');
reset role;
select is((select count(*)::integer from public.refund_case_messages
  where refund_case_id='ce400000-0000-4000-8000-000000000006'),0,
  'External observation creates no canonical outbox duplicate');

select is((select count(*)::integer from public.refund_case_nayax_refund_attempts
  where refund_case_id in (select id from public.refund_cases where public_reference like 'RF-RC-AUTO-%')),0,
  'Receipt completion authority never creates a provider attempt');
select is((select count(*)::integer from public.sales_adjustment_facts
  where refund_case_id in (select id from public.refund_cases where public_reference like 'RF-RC-AUTO-%')),0,
  'Receipt completion authority never creates dated accounting');
select ok((select bool_and(r.settled_at is null and r.settlement_time_precision='unknown')
  from public.refund_authoritative_receipts r join public.refund_cases c on c.id=r.refund_case_id
  where c.public_reference like 'RF-RC-AUTO-%'),'Settlement evidence stays unknown');
select ok((select bool_and(c.refund_completed_at is null and c.reporting_adjustment_id is null)
  from public.refund_cases c where c.public_reference like 'RF-RC-AUTO-%'),
  'Message coordination never fabricates payment completion or accounting time');

select * from finish();
rollback;
