-- Disposable database only: dblink needs committed synthetic fixtures.
create extension if not exists pgtap with schema extensions;
create extension if not exists dblink with schema extensions;
set search_path=public,extensions;
select extensions.dblink_connect('receipt_auto_race_a','host=db port='||current_setting('port')||
  ' dbname='||current_database()||' user=postgres password=postgres sslmode=disable application_name=receipt_auto_race_a');
select extensions.dblink_connect('receipt_auto_race_b','host=db port='||current_setting('port')||
  ' dbname='||current_database()||' user=postgres password=postgres sslmode=disable application_name=receipt_auto_race_b');
select extensions.dblink_connect('receipt_auto_race_worker','host=db port='||current_setting('port')||
  ' dbname='||current_database()||' user=postgres password=postgres sslmode=disable application_name=receipt_auto_race_worker');
select extensions.dblink_connect('receipt_auto_xid_producer','host=db port='||current_setting('port')||
  ' dbname='||current_database()||' user=postgres password=postgres sslmode=disable application_name=receipt_auto_xid_producer');
select extensions.dblink_connect('receipt_auto_xid_writer','host=db port='||current_setting('port')||
  ' dbname='||current_database()||' user=postgres password=postgres sslmode=disable application_name=receipt_auto_xid_writer');

begin;
create schema refund_receipt_auto_race_test;
create table refund_receipt_auto_race_test.results(lane text primary key,payload jsonb);
create table refund_receipt_auto_race_test.contact_before as select * from public.refund_customer_contact_settings;
update public.refund_customer_contact_settings set automatic_customer_contact_enabled=true where singleton;
insert into auth.users(instance_id,id,aud,role,email,encrypted_password,email_confirmed_at,
  raw_app_meta_data,raw_user_meta_data,created_at,updated_at)
values('00000000-0000-0000-0000-000000000000','cd000000-0000-4000-8000-000000000001',
  'authenticated','authenticated','receipt-auto-race@example.invalid','',now(),'{}','{}',now(),now());
insert into public.customer_accounts(id,name,account_type)
values('cd100000-0000-4000-8000-000000000001','Receipt automatic completion race','internal');
insert into public.reporting_locations(id,account_id,name,timezone)
values('cd200000-0000-4000-8000-000000000001','cd100000-0000-4000-8000-000000000001',
  'Receipt automatic completion race','America/Los_Angeles');
insert into public.reporting_machines(id,account_id,location_id,machine_label,nayax_machine_id,nayax_account_key)
values('cd300000-0000-4000-8000-000000000001','cd100000-0000-4000-8000-000000000001',
  'cd200000-0000-4000-8000-000000000001','Receipt automatic completion race','RC-AUTO-RACE-MACHINE','RC-AUTO-RACE-ACCOUNT');
insert into public.refund_cases(id,public_reference,reporting_machine_id,reporting_location_id,customer_email,issue_summary,
  incident_at,payment_method,payment_amount_cents,refund_amount_cents,card_last4,status,correlation_status,correlation_source,
  correlation_confidence,automation_state,matched_nayax_transaction_id,matched_nayax_amount_cents,matched_nayax_currency_code,
  matched_nayax_machine_auth_time,lifecycle_integrity_status,lifecycle_integrity_code,lifecycle_integrity_detected_at)
values('cd400000-0000-4000-8000-000000000001','RF-RC-AUTO-RACE-1',
  'cd300000-0000-4000-8000-000000000001','cd200000-0000-4000-8000-000000000001',
  'receipt-auto-race-customer@example.invalid','Synthetic receipt automatic completion race',now()-interval '3 days',
  'card',1100,1100,'4242','card_refund_pending','matched','nayax',1,'approved','993456781',1100,'USD',
  now()-interval '3 days','hold','card_payment_state_without_attempt',now()-interval '1 day'),
  ('cd400000-0000-4000-8000-000000000002','RF-RC-AUTO-RACE-2',
  'cd300000-0000-4000-8000-000000000001','cd200000-0000-4000-8000-000000000001',
  'receipt-auto-race-customer@example.invalid','Synthetic cross-transaction receipt authority',now()-interval '3 days',
  'card',1200,1200,'4242','card_refund_pending','matched','nayax',1,'approved','993456782',1200,'USD',
  now()-interval '3 days','hold','card_payment_state_without_attempt',now()-interval '1 day');
insert into public.refund_authoritative_receipts(refund_case_id,reporting_machine_id,account_scope,provider_machine_id,
  original_transaction_id,original_amount_cents,refunded_amount_cents,currency_code,provider_status,
  evidence_reference_digest,recorded_by,attempt_binding_kind,current_provider_observation_reviewed)
values('cd400000-0000-4000-8000-000000000001','cd300000-0000-4000-8000-000000000001',
  'RC-AUTO-RACE-ACCOUNT','RC-AUTO-RACE-MACHINE','993456781',1100,1100,'USD',62,
  encode(extensions.digest(convert_to('receipt-auto-race-receipt','UTF8'),'sha256'),'hex'),
  'cd000000-0000-4000-8000-000000000001','no_attempt_integrity_hold',true);
select public.refund_create_receipt_completion_automation_authority(
  'cd400000-0000-4000-8000-000000000001',
  (select id from public.refund_authoritative_receipts where refund_case_id='cd400000-0000-4000-8000-000000000001'),
  'nayax_api_terminal','verified_terminal_refund_v1',
  encode(extensions.digest(convert_to('receipt-auto-race-source','UTF8'),'sha256'),'hex'));
create function refund_receipt_auto_race_test.ensure() returns jsonb language sql as $$
  select public.service_ensure_refund_receipt_automatic_completion(c.id,r.id,a.id)
  from public.refund_cases c
  join public.refund_authoritative_receipts r on r.refund_case_id=c.id
  join public.refund_receipt_completion_automation_authorities a on a.receipt_id=r.id
  where c.id='cd400000-0000-4000-8000-000000000001';
$$;
create function refund_receipt_auto_race_test.wait_for_lock(p_application text) returns boolean language plpgsql as $$
begin
  for i in 1..100 loop
    perform pg_stat_clear_snapshot();
    if exists(select 1 from pg_stat_activity where application_name=p_application and wait_event_type='Lock') then
      return true;
    end if;
    perform pg_sleep(0.01);
  end loop;
  return false;
end;
$$;
create function refund_receipt_auto_race_test.capture_error(statement text) returns text language plpgsql as $$
begin execute statement; return null; exception when others then return sqlstate; end;
$$;
commit;

select no_plan();
select extensions.dblink_exec('receipt_auto_xid_producer','begin');
insert into refund_receipt_auto_race_test.results
select 'producer_xid',jsonb_build_object('xid',xid)
from extensions.dblink('receipt_auto_xid_producer','select pg_current_xact_id()::text') as x(xid text);
select extensions.dblink_exec('receipt_auto_xid_writer',$q$
  insert into public.refund_authoritative_receipts(refund_case_id,reporting_machine_id,account_scope,
    provider_machine_id,original_transaction_id,original_amount_cents,refunded_amount_cents,currency_code,
    provider_status,evidence_reference_digest,recorded_by,attempt_binding_kind,current_provider_observation_reviewed)
  select c.id,c.reporting_machine_id,'RC-AUTO-RACE-ACCOUNT','RC-AUTO-RACE-MACHINE',
    c.matched_nayax_transaction_id,1200,1200,'USD',62,
    encode(extensions.digest(convert_to('receipt-auto-cross-transaction','UTF8'),'sha256'),'hex'),
    'cd000000-0000-4000-8000-000000000001','no_attempt_integrity_hold',true
  from public.refund_cases c where c.id='cd400000-0000-4000-8000-000000000002'
$q$);
select isnt((select payload->>'xid' from refund_receipt_auto_race_test.results where lane='producer_xid'),
  (select creation_transaction_id::text from public.refund_authoritative_receipts
    where refund_case_id='cd400000-0000-4000-8000-000000000002'),
  'The separately committed receipt records the writer transaction identity');
select is((select code from extensions.dblink('receipt_auto_xid_producer',$q$
  select refund_receipt_auto_race_test.capture_error($statement$
    select public.refund_create_receipt_completion_automation_authority(
      'cd400000-0000-4000-8000-000000000002',
      (select id from public.refund_authoritative_receipts
        where refund_case_id='cd400000-0000-4000-8000-000000000002'),
      'nayax_api_terminal','verified_terminal_refund_v1',repeat('f',64))
  $statement$)
$q$) as attempted(code text)),'P4668',
  'A producer transaction cannot mint authority from a receipt committed by another transaction');
select is((select count(*)::integer from public.refund_receipt_completion_automation_authorities
  where refund_case_id='cd400000-0000-4000-8000-000000000002'),0,
  'Cross-transaction receipt interleaving creates no completion authority');
select extensions.dblink_exec('receipt_auto_xid_producer','rollback');
select extensions.dblink_disconnect('receipt_auto_xid_producer');
select extensions.dblink_disconnect('receipt_auto_xid_writer');

select extensions.dblink_exec('receipt_auto_race_a','begin');
select * from extensions.dblink('receipt_auto_race_a',$q$
  select id::text from public.refund_cases
  where id='cd400000-0000-4000-8000-000000000001' for update
$q$) as locked(id text);
select extensions.dblink_send_query('receipt_auto_race_b',
  'select refund_receipt_auto_race_test.ensure()');
select ok(refund_receipt_auto_race_test.wait_for_lock('receipt_auto_race_b'),
  'Concurrent automatic completion waits for the exact case lock');
insert into refund_receipt_auto_race_test.results
select 'winner',payload from extensions.dblink('receipt_auto_race_a',
  'select refund_receipt_auto_race_test.ensure()') as x(payload jsonb);
select is((select payload->>'replayed' from refund_receipt_auto_race_test.results where lane='winner'),'false',
  'The case-lock owner creates the first canonical completion');
select is((select n from extensions.dblink('receipt_auto_race_worker',
  'select count(*)::integer from public.service_claim_refund_manual_message_deliveries(null,25)') as x(n integer)),0,
  'The existing worker skips the uncommitted case and message');
select extensions.dblink_exec('receipt_auto_race_a','commit');
insert into refund_receipt_auto_race_test.results
select 'replay',payload from extensions.dblink_get_result('receipt_auto_race_b') as x(payload jsonb);
select * from extensions.dblink_get_result('receipt_auto_race_b') as x(payload jsonb);
select is((select payload->>'replayed' from refund_receipt_auto_race_test.results where lane='replay'),'true',
  'The waiting coordinator replays the committed canonical completion');
select is((select payload->>'messageId' from refund_receipt_auto_race_test.results where lane='winner'),
  (select payload->>'messageId' from refund_receipt_auto_race_test.results where lane='replay'),
  'Concurrent coordinators return the same message identity');
select is((select count(*)::integer from public.refund_receipt_completion_intents
  where refund_case_id='cd400000-0000-4000-8000-000000000001'),1,
  'Concurrent coordinators preserve exactly one intent');
select is((select count(*)::integer from public.refund_case_messages
  where refund_case_id='cd400000-0000-4000-8000-000000000001' and template_version='refund_receipt_completion_v1'),1,
  'Concurrent coordinators preserve exactly one outbox message');
select is((select count(*)::integer from public.refund_case_nayax_refund_attempts
  where refund_case_id='cd400000-0000-4000-8000-000000000001'),0,
  'The coordinator race never creates a provider attempt');
select is((select count(*)::integer from public.sales_adjustment_facts
  where refund_case_id='cd400000-0000-4000-8000-000000000001'),0,
  'The coordinator race never creates dated accounting');
select ok((select refund_completed_at is null from public.refund_cases
  where id='cd400000-0000-4000-8000-000000000001'),
  'The coordinator race never fabricates refund settlement time');

select extensions.dblink_disconnect('receipt_auto_race_a');
select extensions.dblink_disconnect('receipt_auto_race_b');
select extensions.dblink_disconnect('receipt_auto_race_worker');

begin;
alter table public.refund_customer_contact_settings disable trigger refund_customer_contact_settings_set_updated_at;
update public.refund_customer_contact_settings settings
set automatic_customer_contact_enabled=original.automatic_customer_contact_enabled,updated_at=original.updated_at
from refund_receipt_auto_race_test.contact_before original where settings.singleton=original.singleton;
alter table public.refund_customer_contact_settings enable trigger refund_customer_contact_settings_set_updated_at;
alter table public.refund_receipt_completion_automation_authorities
  disable trigger refund_receipt_completion_automation_authorities_immutable;
alter table public.refund_receipt_completion_intents disable trigger refund_receipt_completion_intents_immutable;
alter table public.refund_case_messages disable trigger aa_refund_receipt_completion_identity;
alter table public.refund_authoritative_receipts disable trigger refund_authoritative_receipts_immutable;
delete from public.refund_receipt_completion_intents
where refund_case_id='cd400000-0000-4000-8000-000000000001';
delete from public.refund_case_messages
where refund_case_id='cd400000-0000-4000-8000-000000000001' and template_version='refund_receipt_completion_v1';
set constraints all immediate;
delete from public.refund_receipt_completion_automation_authorities
where refund_case_id='cd400000-0000-4000-8000-000000000001';
delete from public.refund_authoritative_receipts
where refund_case_id in ('cd400000-0000-4000-8000-000000000001','cd400000-0000-4000-8000-000000000002');
alter table public.refund_receipt_completion_automation_authorities
  enable trigger refund_receipt_completion_automation_authorities_immutable;
alter table public.refund_receipt_completion_intents enable trigger refund_receipt_completion_intents_immutable;
alter table public.refund_case_messages enable trigger aa_refund_receipt_completion_identity;
alter table public.refund_authoritative_receipts enable trigger refund_authoritative_receipts_immutable;
delete from public.refund_cases
where id in ('cd400000-0000-4000-8000-000000000001','cd400000-0000-4000-8000-000000000002');
delete from public.reporting_machines where id='cd300000-0000-4000-8000-000000000001';
delete from public.reporting_locations where id='cd200000-0000-4000-8000-000000000001';
delete from public.customer_accounts where id='cd100000-0000-4000-8000-000000000001';
delete from auth.users where id='cd000000-0000-4000-8000-000000000001';
drop schema refund_receipt_auto_race_test cascade;
commit;
select * from finish();
