begin;
create extension if not exists pgtap with schema extensions;
set local search_path=public,extensions;
select no_plan();
select ok(position('assert_no_active_refund_owner_resolution(case_id)'
    in pg_get_functiondef('public.service_mark_refund_manual_message_provider_attempt(uuid,uuid)'::regprocedure))>0,
  'Manual outbox provider mark preserves the owner-resolution stop');
select ok(position('is_refund_receipt_completion_message(to_jsonb(new))'
    in pg_get_functiondef('public.guard_refund_follow_up_message()'::regprocedure))>0,
  'The legacy automatic-message guard recognizes only the authority-bound receipt completion identity');
select ok(position('refund_receipt_completion_v1' in (select pg_get_constraintdef(oid)
    from pg_catalog.pg_constraint where conrelid='public.refund_case_messages'::regclass
      and conname='refund_case_messages_safe_evidence_shape'))>0,
  'The shared message evidence allowlist includes the exact receipt completion template');

insert into auth.users(instance_id,id,aud,role,email,encrypted_password,email_confirmed_at,
  raw_app_meta_data,raw_user_meta_data,created_at,updated_at)
values('00000000-0000-0000-0000-000000000000','ce000000-0000-4000-8000-000000000001',
  'authenticated','authenticated','receipt-auto-ops@example.invalid','',now(),'{}','{}',now(),now());
insert into auth.sessions(id,user_id,created_at,updated_at)
values('ce010000-0000-4000-8000-000000000001','ce000000-0000-4000-8000-000000000001',now(),now());
insert into auth.users(instance_id,id,aud,role,email,encrypted_password,email_confirmed_at,
  raw_app_meta_data,raw_user_meta_data,created_at,updated_at)
values('00000000-0000-0000-0000-000000000000','ce000000-0000-4000-8000-000000000002',
  'authenticated','authenticated','receipt-auto-manager@example.invalid','',now(),'{}','{}',now(),now());
insert into auth.sessions(id,user_id,created_at,updated_at)
values('ce010000-0000-4000-8000-000000000002','ce000000-0000-4000-8000-000000000002',now(),now());
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
insert into public.reporting_machine_refund_managers(reporting_machine_id,manager_user_id,manager_email,grant_reason)
values('ce300000-0000-4000-8000-000000000001','ce000000-0000-4000-8000-000000000002',
  'receipt-auto-manager@example.invalid','Synthetic scoped manager visibility');
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
    case when n%2=0 then 'nayax_report_terminal' else 'nayax_api_terminal' end,
    'verified_terminal_refund_v1',
    encode(extensions.digest(convert_to('receipt-auto-source-'||n,'UTF8'),'sha256'),'hex'));
end; $$;
create function pg_temp.ensure(n integer) returns jsonb language plpgsql
security definer set search_path='' as $$
declare case_id uuid:=('ce400000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid; receipt_id uuid; authority_id uuid;
begin
  select id into receipt_id from public.refund_authoritative_receipts where refund_case_id=case_id;
  select id into authority_id from public.refund_receipt_completion_automation_authorities where refund_case_id=case_id;
  return public.service_ensure_refund_receipt_automatic_completion(case_id,receipt_id,authority_id);
end; $$;
create function pg_temp.ensure_triplet(case_n integer,receipt_n integer,authority_n integer)
returns jsonb language plpgsql security definer set search_path='' as $$
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
  'public.refund_create_receipt_completion_automation_authority(uuid,uuid,text,text,text)','execute'),
  'The private terminal writer seam is not a service RPC');
select ok(not has_function_privilege('authenticated',
  'public.service_ensure_refund_receipt_automatic_completion(uuid,uuid,uuid)','execute'),
  'Customer completion coordination is not an authenticated-user RPC');
select ok(not has_function_privilege('authenticated',
  'public.service_ensure_refund_receipt_automatic_completions(integer)','execute'),
  'The bounded authority scheduler is not an authenticated-user RPC');
select ok(has_function_privilege('service_role',
  'public.service_ensure_refund_receipt_automatic_completion(uuid,uuid,uuid)','execute'),
  'The service worker can consume an existing exact authority');
select ok(has_function_privilege('service_role',
  'public.service_ensure_refund_receipt_automatic_completions(integer)','execute'),
  'The bounded service scheduler can consume authority rows');
select ok(not has_function_privilege('authenticated',
  'public.service_defer_refund_automatic_completion_delivery(uuid,uuid,text)','execute'),
  'Authenticated users cannot defer an automatic completion claim');
select ok(has_function_privilege('service_role',
  'public.service_defer_refund_automatic_completion_delivery(uuid,uuid,text)','execute'),
  'The service worker can safely defer its exact automatic completion claim');

select ok(pg_temp.authorize(1) is not null,'A newly recorded independently reviewed receipt gets one authority');
select ok((select source_kind='nayax_api_terminal'
    and source_policy='verified_terminal_refund_v1'
    and source_event_digest=encode(extensions.digest(
      convert_to('receipt-auto-source-1','UTF8'),'sha256'),'hex')
  from public.refund_receipt_completion_automation_authorities
  where refund_case_id='ce400000-0000-4000-8000-000000000001'),
  'Authority preserves exact terminal source kind, policy, and event digest');
select is(pg_temp.authorize(1),
  (select id from public.refund_receipt_completion_automation_authorities
    where refund_case_id='ce400000-0000-4000-8000-000000000001'),
  'Exact authority creation is idempotent');
select is(pg_temp.capture_error($$select public.refund_create_receipt_completion_automation_authority(
  'ce400000-0000-4000-8000-000000000001',(select id from public.refund_authoritative_receipts
    where refund_case_id='ce400000-0000-4000-8000-000000000001'),
    'nayax_api_terminal','verified_terminal_refund_v1',repeat('0',64))$$),
  'P4668','Conflicting authority evidence cannot replace the immutable grant');
select is(pg_temp.capture_error($$update public.refund_receipt_completion_automation_authorities
  set expected_case_version=expected_case_version+1 where refund_case_id='ce400000-0000-4000-8000-000000000001'$$),
  'P4660','Completion authority is immutable');

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
select ok((select public.refund_lifecycle_contract(id)#>>'{messageState,state}'='none'
    and public.refund_lifecycle_contract(id)->>'terminal'='false'
    and public.refund_lifecycle_contract(id)->>'refreshAfterSeconds'='5'
  from public.refund_cases where id='ce400000-0000-4000-8000-000000000003'),
  'A receipt without a completion intent keeps the missing notice observable');
set local role service_role;
create temp table receipt_auto_batch as
select public.service_ensure_refund_receipt_automatic_completions(10) payload;
select is((select payload->>'queued' from receipt_auto_batch),'1',
  'A bounded authority sweep queues the valid case');
select is((select payload->>'suppressed' from receipt_auto_batch),'0',
  'A review-required case does not consume the bounded candidate window');
reset role;

set local role service_role;
create temp table receipt_auto_first as select pg_temp.ensure(1) payload;
select is((select payload->>'status' from receipt_auto_first),'canonical_message',
  'Exact immutable authority creates the canonical completion intent');
select is((select payload->>'replayed' from receipt_auto_first),'true',
  'Exact coordination replays the scheduler-created message');
select is(pg_temp.ensure(1)->>'replayed','true','Service replay returns the same canonical message');
reset role;
select is((select count(*)::integer from public.refund_receipt_completion_intents
  where refund_case_id='ce400000-0000-4000-8000-000000000001'),1,'Replay preserves one completion intent');
select is((select count(*)::integer from public.refund_case_messages
  where refund_case_id='ce400000-0000-4000-8000-000000000001' and template_version='refund_receipt_completion_v1'),1,
  'Replay preserves one existing outbox message');
select is((select delivery_kind from public.refund_case_messages
  where refund_case_id='ce400000-0000-4000-8000-000000000001'),
  'automatic','Authority stays automatic in the shared outbox');
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
create temp table receipt_auto_lifecycle as
select public.refund_lifecycle_contract(c.id) current_contract,
  public.refund_lifecycle_contract_pre_receipt_accounting_v1(c.id) prior_contract
from public.refund_cases c where c.id='ce400000-0000-4000-8000-000000000001';
select is((select current_contract->>'paymentWorkComplete' from receipt_auto_lifecycle),'true',
  'Queued automatic completion marks payment work complete');
select is((select current_contract->'accountingState' from receipt_auto_lifecycle),jsonb_build_object(
    'state','pending','owner','Refund Operations','settlementTimePrecision','unknown','settledAt',null,
    'blocksPaymentCompletion',false,'blocksCustomerNotice',false,'payloadRedacted',true),
  'Queued automatic completion keeps unknown-date accounting separate and nonblocking');
select is((select current_contract->'terminal' from receipt_auto_lifecycle),
  (select prior_contract->'terminal' from receipt_auto_lifecycle),
  'Receipt accounting preserves the existing terminal state');
select is((select current_contract->>'terminal' from receipt_auto_lifecycle),'false',
  'Queued automatic completion remains nonterminal');
select is((select current_contract->'refreshAfterSeconds' from receipt_auto_lifecycle),
  (select prior_contract->'refreshAfterSeconds' from receipt_auto_lifecycle),
  'Receipt accounting preserves the existing refresh interval');
select is((select current_contract->>'refreshAfterSeconds' from receipt_auto_lifecycle),'5',
  'Queued automatic completion keeps polling');
select is((select current_contract->'stage' from receipt_auto_lifecycle),
  (select prior_contract->'stage' from receipt_auto_lifecycle),
  'Receipt accounting preserves the existing lifecycle stage');
select is((select prior_contract#>>'{managerQueue,bucket}' from receipt_auto_lifecycle),'provider_hold',
  'Authoritative payment leaves the provider hold queue');
select is((select current_contract->'managerQueue' from receipt_auto_lifecycle),jsonb_build_object(
    'schemaVersion','refund_manager_queue_v2','bucket','accounting_review',
    'label','Refund confirmed · accounting review','nextAction','review_accounting_date',
    'safeRetryEligible',false,'customerActionFields','[]'::jsonb,'payloadRedacted',true),
  'Unknown-date accounting enters its truthful Refund Operations queue');
select is((select current_contract->'messageState' from receipt_auto_lifecycle),
  (select prior_contract->'messageState' from receipt_auto_lifecycle),
  'Receipt accounting preserves the existing message state');
select is((select current_contract#>>'{messageState,state}' from receipt_auto_lifecycle),'pending',
  'Queued automatic completion retains its pending message state');
update public.refund_case_messages set manual_delivery_state='claimed',
  manual_delivery_claim_token='ce900000-0000-4000-8000-000000000001',
  manual_delivery_claimed_at=statement_timestamp(),manual_delivery_attempt_count=1,
  manual_delivery_provider_attempted_at=statement_timestamp()
where refund_case_id='ce400000-0000-4000-8000-000000000001';
insert into public.refund_gmail_threads(id,refund_case_id,mailbox_hash,provider_thread_id,thread_subject,
  first_message_at,latest_message_at,retention_expires_at)
values('ce700000-0000-4000-8000-000000000001','ce400000-0000-4000-8000-000000000001',repeat('1',64),
  'receipt-auto-deferred-thread','Synthetic provider-empty completion',now(),now(),now()+interval '30 days');
insert into public.refund_gmail_messages(id,gmail_thread_id,refund_case_id,refund_case_message_id,operation_key,
  direction,message_kind,status,sender_email,recipient_email,subject,plain_body,retention_expires_at,received_at)
select 'ce800000-0000-4000-8000-000000000001','ce700000-0000-4000-8000-000000000001',m.refund_case_id,m.id,
  'refund-case-message:'||m.id::text,'outbound','message','pending_send','info@bloomjoysweets.com',m.recipient_email,
  m.subject,m.body,now()+interval '30 days',now()
from public.refund_case_messages m where m.refund_case_id='ce400000-0000-4000-8000-000000000001';
set local role service_role;
select ok(public.service_finish_refund_gmail_outbound(
    'ce800000-0000-4000-8000-000000000001','failed',null,null,'automatic_contact_disabled'),
  'A provider-empty Gmail shutdown claim is settled for safe reclaim');
select is((select count(*)::integer from public.refund_gmail_messages
    where id='ce800000-0000-4000-8000-000000000001'),0,
  'Provider-empty Gmail shutdown evidence cannot strand the authorized notice');
select ok((select status='pending' and manual_delivery_state='queued'
    and manual_delivery_claim_token is null and manual_delivery_claimed_at is null
    and manual_delivery_provider_attempted_at is null
  from public.refund_case_messages
  where refund_case_id='ce400000-0000-4000-8000-000000000001'),
  'Gmail shutdown cleanup atomically requeues the exact provider-empty notice');
select ok((public.service_defer_refund_automatic_completion_delivery(
    (select id from public.refund_case_messages
      where refund_case_id='ce400000-0000-4000-8000-000000000001'),
    'ce900000-0000-4000-8000-000000000001','automatic_contact_disabled')->>'deferred')::boolean
    and (public.service_defer_refund_automatic_completion_delivery(
      (select id from public.refund_case_messages
        where refund_case_id='ce400000-0000-4000-8000-000000000001'),
      'ce900000-0000-4000-8000-000000000001','automatic_contact_disabled')->>'replayed')::boolean,
  'A lost shutdown response replays the same safe deferral without stranding the claim');
select is((select count(*)::integer from public.service_claim_refund_manual_message_deliveries(
    (select id from public.refund_case_messages
      where refund_case_id='ce400000-0000-4000-8000-000000000001'),1)),1,
  'Re-enable can reclaim the same authorized completion notice');
reset role;
select ok((select status='pending' and manual_delivery_state='claimed'
    and manual_delivery_provider_attempted_at is null
  from public.refund_case_messages
  where refund_case_id='ce400000-0000-4000-8000-000000000001'),
  'Deferral clears only the provider-empty attempt marker before reclaim');
update public.refund_case_messages set status='failed',manual_delivery_state='failed',
  manual_delivery_claim_token=null,manual_delivery_claimed_at=null
where refund_case_id='ce400000-0000-4000-8000-000000000001';
select ok((select public.refund_lifecycle_contract(id)#>>'{messageState,state}'='failed'
    and public.refund_lifecycle_contract(id)->>'terminal'='false'
    and public.refund_lifecycle_contract(id)->>'refreshAfterSeconds'='5'
  from public.refund_cases where id='ce400000-0000-4000-8000-000000000001'),
  'A failed pre-provider notice remains observable and polling');

select pg_temp.authorize(2);
create temp table receipt_auto_manual_source as
select c.id case_id,r.id receipt_id,c.official_action_version expected_case_version,
  public.admin_get_refund_authoritative_receipt_overview(c.id)#>>'{completionNotice,reviewBinding}' review_binding
from public.refund_cases c join public.refund_authoritative_receipts r on r.refund_case_id=c.id
where c.id='ce400000-0000-4000-8000-000000000002';
grant select on receipt_auto_manual_source to authenticated;
set local role authenticated;
create temp table receipt_auto_manual_winner as
select public.admin_queue_refund_receipt_completion(case_id,receipt_id,expected_case_version,
  gen_random_uuid(),true,review_binding) payload from receipt_auto_manual_source;
reset role;
set local role service_role;
select is(pg_temp.ensure(2)->>'replayed','true','A human queue winner is safely adopted as the canonical outcome');
reset role;
select ok((select i.reviewed_no_existing_notice and i.automation_authority_id is null
  from public.refund_receipt_completion_intents i
  where i.refund_case_id='ce400000-0000-4000-8000-000000000002'),
  'The existing human-reviewed intent remains truthfully distinct');
select is((select m.delivery_kind from public.refund_case_messages m
  where m.refund_case_id='ce400000-0000-4000-8000-000000000002'),
  'manual','Manager-authorized completion remains manual');
update public.refund_case_messages
  set manual_delivery_state='claimed',manual_delivery_claim_token='ce900000-0000-4000-8000-000000000002',
    manual_delivery_claimed_at=statement_timestamp(),manual_delivery_attempt_count=1
  where refund_case_id='ce400000-0000-4000-8000-000000000002';
update public.refund_case_messages
  set status='failed',manual_delivery_state='delivery_unknown',manual_delivery_claim_token=null,
    manual_delivery_claimed_at=null,manual_delivery_provider_attempted_at=statement_timestamp()
  where refund_case_id='ce400000-0000-4000-8000-000000000002';
select ok((select public.refund_lifecycle_contract(id)#>>'{messageState,state}'='delivery_unconfirmed'
    and public.refund_lifecycle_contract(id)->>'terminal'='false'
    and public.refund_lifecycle_contract(id)->>'refreshAfterSeconds'='5'
  from public.refund_cases where id='ce400000-0000-4000-8000-000000000002'),
  'An unknown delivery remains observable and polling');

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
create temp table receipt_auto_adoption_source as
select c.id case_id,r.id receipt_id,c.official_action_version expected_case_version,
  c.public_reference,c.matched_nayax_transaction_id
from public.refund_cases c join public.refund_authoritative_receipts r on r.refund_case_id=c.id
where c.id='ce400000-0000-4000-8000-000000000005';
grant select on receipt_auto_adoption_source to authenticated;
set local role authenticated;
select public.admin_adopt_refund_completion_notice(case_id,receipt_id,
  'ce800000-0000-4000-8000-000000000005',expected_case_version,
  public_reference,matched_nayax_transaction_id,900,true)
from receipt_auto_adoption_source;
reset role;
set local role service_role;
select is(pg_temp.ensure(5)->>'status','existing_notice_adopted',
  'Existing exact SENT-notice adoption wins without another message');
reset role;
select is((select count(*)::integer from public.refund_case_messages
  where refund_case_id='ce400000-0000-4000-8000-000000000005'),0,
  'Adoption outcome creates no canonical outbox duplicate');
select ok((select public.refund_lifecycle_contract(id)#>>'{messageState,state}'='sent'
    and public.refund_lifecycle_contract(id)#>>'{managerQueue,bucket}'='accounting_review'
    and public.refund_lifecycle_contract(id)->>'terminal'='true'
    and public.refund_lifecycle_contract(id)->'refreshAfterSeconds'='null'::jsonb
  from public.refund_cases where id='ce400000-0000-4000-8000-000000000005'),
  'A sent notice ends customer polling while accounting remains separately reviewable');
set local role service_role;
select public.service_issue_refund_status_capability(
  'ce400000-0000-4000-8000-000000000005',repeat('5',64),statement_timestamp()+interval '30 days');
select ok((select status.lifecycle->>'terminal'='true'
    and status.lifecycle->'refreshAfterSeconds'='null'::jsonb
    and status.lifecycle#>>'{messageState,state}'='sent'
    and status.lifecycle::text not like '%accounting%'
    and status.lifecycle::text not like '%Refund Operations%'
  from (select public.service_read_refund_status_capability(
      repeat('5',64),repeat('6',64))->'lifecycle' lifecycle) status),
  'Customer capability stops polling after sent notice without exposing accounting');
reset role;

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

-- Refund Operations visibility is decided server-side for both list/search and
-- direct/deep-link reads. The existing case-scope predicate remains authoritative.
set local role service_role;
select ok(public.service_get_refund_lifecycle('ce400000-0000-4000-8000-000000000001')
    ? 'accountingState'
    and public.service_get_refund_lifecycle('ce400000-0000-4000-8000-000000000001')
      #>>'{managerQueue,bucket}'='accounting_review',
  'Service automation retains the full canonical accounting lifecycle');
reset role;
set local role authenticated;
create temp table receipt_super_direct as
select public.get_refund_lifecycle_for_manager(
  'ce400000-0000-4000-8000-000000000001') lifecycle;
create temp table receipt_super_overview as
select public.admin_get_refund_operations_overview() payload;
select ok((select lifecycle ? 'accountingState'
    and lifecycle#>>'{managerQueue,bucket}'='accounting_review'
  from receipt_super_direct),
  'The current super admin direct read retains Refund Operations accounting review');
select ok((select item.value->'lifecycle' ? 'accountingState'
    and item.value#>>'{lifecycle,managerQueue,bucket}'='accounting_review'
  from receipt_super_overview o,
    jsonb_array_elements(o.payload->'cases') item
  where item.value->>'id'='ce400000-0000-4000-8000-000000000001'),
  'The current super admin overview/search retains Refund Operations accounting review');

select set_config('request.jwt.claim.sub','ce000000-0000-4000-8000-000000000002',true);
select set_config('request.jwt.claim.role','authenticated',true);
select set_config('request.jwt.claims',
  '{"sub":"ce000000-0000-4000-8000-000000000002","role":"authenticated","session_id":"ce010000-0000-4000-8000-000000000002","is_anonymous":false}',true);
create temp table receipt_manager_direct as
select public.get_refund_lifecycle_for_manager(
  'ce400000-0000-4000-8000-000000000001') lifecycle;
create temp table receipt_manager_sent_direct as
select public.get_refund_lifecycle_for_manager(
  'ce400000-0000-4000-8000-000000000005') lifecycle;
create temp table receipt_manager_overview as
select public.admin_get_refund_operations_overview() payload;
select ok((select lifecycle#>>'{managerQueue,bucket}'='in_progress'
    and lifecycle#>>'{messageState,state}'='failed'
    and lifecycle->>'paymentState'='confirmed'
    and lifecycle->>'terminal'='false'
    and lifecycle->>'refreshAfterSeconds'='5'
    and lifecycle->>'safeRetryEligible'='false'
  from receipt_manager_direct),
  'A scoped manager deep link preserves confirmed payment, failed notice, and polling without retry');
select ok((select not (lifecycle ? 'accountingState')
    and lifecycle::text not like '%accounting_review%'
    and lifecycle::text not like '%Refund Operations%'
    and lifecycle::text not like '%Needs Refund Operations%'
    and lifecycle::text not like '%review_accounting_date%'
    and lifecycle::text not like '%settlement_time_unknown%'
  from receipt_manager_direct),
  'A scoped manager raw lifecycle contains no internal accounting queue, ownership, or action details');
select ok((select lifecycle#>>'{managerQueue,bucket}'='completed'
    and lifecycle#>>'{messageState,state}'='sent'
    and lifecycle->>'paymentState'='confirmed'
    and lifecycle->>'terminal'='true'
    and lifecycle->'refreshAfterSeconds'='null'::jsonb
    and lifecycle->>'safeRetryEligible'='false'
  from receipt_manager_sent_direct),
  'A scoped manager sees a sent notice as non-actionable completed payment truth');
select ok((select item.value#>>'{lifecycle,managerQueue,bucket}'='in_progress'
    and item.value#>>'{lifecycle,messageState,state}'='failed'
    and not ((item.value->'lifecycle') ? 'accountingState')
    and (item.value->'lifecycle')::text not like '%accounting_review%'
    and (item.value->'lifecycle')::text not like '%Refund Operations%'
    and (item.value->'lifecycle')::text not like '%Needs Refund Operations%'
  from receipt_manager_overview o,
    jsonb_array_elements(o.payload->'cases') item
  where item.value->>'id'='ce400000-0000-4000-8000-000000000001'),
  'A scoped manager overview/search cannot recover internal accounting details');
reset role;

-- More than one bounded batch of older paused automatic work cannot starve a
-- later human-approved message in the shared delivery lane.
select set_config('request.jwt.claim.sub','ce000000-0000-4000-8000-000000000001',true);
select set_config('request.jwt.claim.role','authenticated',true);
select set_config('request.jwt.claims',
  '{"sub":"ce000000-0000-4000-8000-000000000001","role":"authenticated","session_id":"ce010000-0000-4000-8000-000000000001","is_anonymous":false}',true);
insert into public.refund_cases(id,public_reference,reporting_machine_id,reporting_location_id,customer_email,issue_summary,
  incident_at,payment_method,payment_amount_cents,refund_amount_cents,card_last4,status,correlation_status,correlation_source,
  correlation_confidence,automation_state,matched_nayax_transaction_id,matched_nayax_amount_cents,matched_nayax_currency_code,
  matched_nayax_machine_auth_time,lifecycle_integrity_status,lifecycle_integrity_code,lifecycle_integrity_detected_at)
select ('ce400000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid,'RF-RC-PRIORITY-'||n,
  'ce300000-0000-4000-8000-000000000001','ce200000-0000-4000-8000-000000000001',
  'receipt-auto-customer@example.invalid','Synthetic receipt priority isolation',now()-interval '4 days','card',900,900,
  '4242','card_refund_pending','matched','nayax',1,'approved',(923457000+n)::text,900,'USD',now()-interval '4 days',
  'hold','card_payment_state_without_attempt',now()-interval '2 days' from generate_series(100,125) n;
select public.admin_record_refund_authoritative_receipt(c.id,null,c.official_action_version,
  'RC-AUTO-ACCOUNT','RC-AUTO-MACHINE',c.matched_nayax_transaction_id,900,900,'USD',62,
  'DTM:NAYAX-'||c.matched_nayax_transaction_id,true)
from public.refund_cases c where c.public_reference like 'RF-RC-PRIORITY-%';
select pg_temp.authorize(n) from generate_series(100,124) n;
set local role service_role;
select pg_temp.ensure(n) from generate_series(100,124) n;
reset role;
create temp table receipt_auto_priority_manual_source as
select c.id case_id,r.id receipt_id,c.official_action_version expected_case_version,
  public.admin_get_refund_authoritative_receipt_overview(c.id)#>>'{completionNotice,reviewBinding}' review_binding
from public.refund_cases c join public.refund_authoritative_receipts r on r.refund_case_id=c.id
where c.id='ce400000-0000-4000-8000-000000000125';
grant select on receipt_auto_priority_manual_source to authenticated;
set local role authenticated;
select public.admin_queue_refund_receipt_completion(case_id,receipt_id,expected_case_version,
  gen_random_uuid(),true,review_binding) from receipt_auto_priority_manual_source;
reset role;
set local role service_role;
create temp table receipt_auto_priority_claims as
select * from public.service_claim_refund_manual_message_deliveries(null,25);
select ok(exists(select 1 from receipt_auto_priority_claims claimed
    join public.refund_case_messages message on message.id=claimed.refund_case_message_id
    where message.refund_case_id='ce400000-0000-4000-8000-000000000125'
      and message.delivery_kind='manual'),
  'More than one bounded batch of deferred automatic work cannot starve later manual mail');
reset role;

select * from finish();
rollback;
