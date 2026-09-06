begin;
create extension if not exists pgtap with schema extensions;
set local search_path=public,extensions;
select no_plan();

insert into auth.users(instance_id,id,aud,role,email,encrypted_password,email_confirmed_at,
  raw_app_meta_data,raw_user_meta_data,created_at,updated_at)
values('00000000-0000-0000-0000-000000000000','d9000000-0000-4000-8000-000000000001',
  'authenticated','authenticated','terminal-receipt-ops@example.invalid','',now(),'{}','{}',now(),now());
insert into public.customer_accounts(id,name,account_type)
values('d9100000-0000-4000-8000-000000000001','Terminal receipt completion','internal');
insert into public.reporting_locations(id,account_id,name,timezone)
values('d9200000-0000-4000-8000-000000000001','d9100000-0000-4000-8000-000000000001',
  'Terminal receipt completion','America/Los_Angeles');
insert into public.reporting_machines(id,account_id,location_id,machine_label,nayax_machine_id,nayax_account_key)
values('d9300000-0000-4000-8000-000000000001','d9100000-0000-4000-8000-000000000001',
  'd9200000-0000-4000-8000-000000000001','Terminal receipt completion','TR-MACHINE','TR-ACCOUNT');
insert into public.refund_cases(id,public_reference,reporting_machine_id,reporting_location_id,customer_email,issue_summary,
  incident_at,payment_method,payment_amount_cents,refund_amount_cents,card_last4,status,correlation_status,correlation_source,
  correlation_confidence,automation_state,matched_nayax_transaction_id,matched_nayax_amount_cents,matched_nayax_currency_code,
  matched_nayax_machine_auth_time,lifecycle_integrity_status,lifecycle_integrity_code,lifecycle_integrity_detected_at)
select ('d9400000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid,'RF-TR-'||n,
  'd9300000-0000-4000-8000-000000000001','d9200000-0000-4000-8000-000000000001',
  'terminal-receipt-customer@example.invalid','Synthetic service terminal receipt',now()-interval '2 days',
  'card',900,900,'4242','card_refund_pending','matched','nayax',1,'approved',(923456780+n)::text,
  900,'USD',now()-interval '2 days','hold','card_payment_state_without_attempt',now()-interval '1 day'
from generate_series(1,3) n;
insert into public.refund_authoritative_receipts(id,refund_case_id,reporting_machine_id,account_scope,
  provider_machine_id,original_transaction_id,original_amount_cents,refunded_amount_cents,currency_code,
  provider_status,evidence_reference_digest,recorded_by,attempt_binding_kind,current_provider_observation_reviewed)
select ('d9500000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid,
  ('d9400000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid,
  'd9300000-0000-4000-8000-000000000001','TR-ACCOUNT','TR-MACHINE',(923456780+n)::text,
  900,900,'USD',62,encode(extensions.digest(convert_to('terminal-receipt-'||n,'UTF8'),'sha256'),'hex'),
  'd9000000-0000-4000-8000-000000000001','no_attempt_integrity_hold',true
from generate_series(1,3) n;

create function pg_temp.capture_error(statement text) returns text language plpgsql as $$
begin execute statement; return null; exception when others then return sqlstate; end; $$;

select ok(not has_table_privilege('service_role','public.refund_terminal_receipt_sources','select'),
  'Service role cannot read private terminal source bindings');
select ok(not has_table_privilege('service_role','public.refund_terminal_receipt_sources','insert'),
  'Service role cannot forge terminal source bindings');
select ok(not has_function_privilege('service_role',
  'public.refund_register_terminal_receipt_source(uuid,text,text)','execute'),
  'Service role cannot call the private terminal-source registrar');
select ok(has_function_privilege('service_role',
  'public.service_queue_terminal_refund_receipt_completion(uuid)','execute'),
  'Service role can queue one already-bound terminal receipt');
select ok(not has_function_privilege('authenticated',
  'public.service_queue_terminal_refund_receipt_completion(uuid)','execute'),
  'A manager session cannot invoke the service terminal queue');
select ok(has_function_privilege('service_role',
  'public.service_queue_terminal_refund_receipt_completions(integer)','execute'),
  'The existing service sweep can queue bounded terminal receipts');

update public.refund_customer_contact_settings set automatic_customer_contact_enabled=true where singleton;
set local role service_role;
select is((public.service_queue_terminal_refund_receipt_completions(10)->>'queued')::integer,0,
  'Existing human receipts are not backfilled into customer contact');
reset role;
select is((select count(*)::integer from public.refund_case_messages),0,
  'An unregistered receipt creates no message');
select is(pg_temp.capture_error($$select public.refund_register_terminal_receipt_source(
  'd9500000-0000-4000-8000-000000000001','unsupported_status',repeat('1',64))$$),'P4665',
  'Unsupported terminal semantics cannot be registered');
select is(public.refund_register_terminal_receipt_source(
  'd9500000-0000-4000-8000-000000000002','nayax_api_terminal',repeat('2',64))->>'replayed','false',
  'A reviewed producer can bind one exact terminal source');
select is(public.refund_register_terminal_receipt_source(
  'd9500000-0000-4000-8000-000000000002','nayax_api_terminal',repeat('2',64))->>'replayed','true',
  'Exact terminal-source replay preserves the first binding');
select is(pg_temp.capture_error($$select public.refund_register_terminal_receipt_source(
  'd9500000-0000-4000-8000-000000000002','nayax_report_terminal',repeat('3',64))$$),'P4665',
  'Conflicting terminal-source replay fails closed');

set local role service_role;
select is((public.service_queue_terminal_refund_receipt_completions(10)->>'queued')::integer,1,
  'The service sweep puts one exact terminal receipt into the durable outbox');
select is(public.service_queue_terminal_refund_receipt_completion(
  'd9500000-0000-4000-8000-000000000002')->>'replayed','true',
  'A repeated service call resolves to the same completion intent');
select is((public.service_queue_terminal_refund_receipt_completions(10)->>'queued')::integer,0,
  'A completed terminal-source scan cannot queue a second message');
reset role;
select is((select count(*)::integer from public.refund_receipt_completion_intents
  where refund_case_id='d9400000-0000-4000-8000-000000000002'),1,
  'Exactly one completion intent exists');
select is((select authority_kind from public.refund_receipt_completion_intents
  where refund_case_id='d9400000-0000-4000-8000-000000000002'),'service_terminal',
  'The intent retains its service terminal authority');
select ok((select count(*)=1 and bool_and(status='pending') and bool_and(manual_delivery_state='queued')
    and bool_and(manual_delivery_provider_attempted_at is null) and bool_and(manual_delivery_attempt_count=0)
  from public.refund_case_messages where refund_case_id='d9400000-0000-4000-8000-000000000002'),
  'Queueing creates no delivery attempt or sent claim');
select is((select count(*)::integer from public.refund_case_events
  where refund_case_id='d9400000-0000-4000-8000-000000000002'
    and event_type='customer_message_queued'),1,
  'The durable queue transition is recorded once');
select is((select count(*)::integer from public.refund_case_nayax_refund_attempts
  where refund_case_id='d9400000-0000-4000-8000-000000000002'),0,
  'Receipt completion queueing creates no payment attempt');
select ok((select status='card_refund_pending' and refund_completed_at is null
    and reporting_adjustment_id is null and nayax_match_execution_eligible is false
  from public.refund_cases where id='d9400000-0000-4000-8000-000000000002'),
  'Queueing preserves payment and accounting storage');
select ok((select public.refund_lifecycle_contract('d9400000-0000-4000-8000-000000000002')->>'terminal'='true'
    and public.refund_lifecycle_contract('d9400000-0000-4000-8000-000000000002')->>'paymentWorkComplete'='true'
    and public.refund_lifecycle_contract('d9400000-0000-4000-8000-000000000002')#>>'{accountingState,state}'='pending'
    and public.refund_lifecycle_contract('d9400000-0000-4000-8000-000000000002')#>>'{accountingState,settlementTimePrecision}'='unknown'
    and public.refund_lifecycle_contract('d9400000-0000-4000-8000-000000000002')#>>'{accountingState,blocksCustomerNotice}'='false'),
  'Confirmed payment is terminal while unknown accounting stays separate');

select public.refund_register_terminal_receipt_source(
  'd9500000-0000-4000-8000-000000000003','nayax_report_terminal',repeat('3',64));
update public.refund_customer_contact_settings set automatic_customer_contact_enabled=false where singleton;
set local role service_role;
select is(public.service_queue_terminal_refund_receipt_completion(
  'd9500000-0000-4000-8000-000000000003')->>'reason','customer_contact_disabled',
  'The existing customer-contact setting remains the send-authority gate');
reset role;
select is((select count(*)::integer from public.refund_case_messages
  where refund_case_id='d9400000-0000-4000-8000-000000000003'),0,
  'Disabled customer contact creates no outbox message');
select is((select count(*)::integer from public.refund_gmail_messages
  where refund_case_id in ('d9400000-0000-4000-8000-000000000001',
    'd9400000-0000-4000-8000-000000000002','d9400000-0000-4000-8000-000000000003')),0,
  'The queue path sends no Gmail message');
select is((select count(*)::integer from public.sales_adjustment_facts
  where refund_case_id in ('d9400000-0000-4000-8000-000000000001',
    'd9400000-0000-4000-8000-000000000002','d9400000-0000-4000-8000-000000000003')),0,
  'Unknown accounting time creates no dated adjustment');

select * from finish();
rollback;
