begin;
create extension if not exists pgtap with schema extensions;
set local search_path=public,extensions;
select no_plan();

insert into auth.users(instance_id,id,aud,role,email,encrypted_password,email_confirmed_at,raw_app_meta_data,raw_user_meta_data,created_at,updated_at)
values('00000000-0000-0000-0000-000000000000','cf000000-0000-4000-8000-000000000001','authenticated','authenticated',
  'receipt-completion-ops@example.invalid','',now(),'{}','{}',now(),now());
insert into auth.sessions(id,user_id,created_at,updated_at)
values('cf010000-0000-4000-8000-000000000001','cf000000-0000-4000-8000-000000000001',now(),now());
insert into public.admin_roles(user_id,role,active) values('cf000000-0000-4000-8000-000000000001','super_admin',true);
insert into public.customer_accounts(id,name,account_type) values('cf100000-0000-4000-8000-000000000001','Receipt completion','internal');
insert into public.reporting_locations(id,account_id,name,timezone)
values('cf200000-0000-4000-8000-000000000001','cf100000-0000-4000-8000-000000000001','Receipt completion','America/Los_Angeles');
insert into public.reporting_machines(id,account_id,location_id,machine_label,nayax_machine_id,nayax_account_key)
values('cf300000-0000-4000-8000-000000000001','cf100000-0000-4000-8000-000000000001',
  'cf200000-0000-4000-8000-000000000001','Receipt completion','RC-MACHINE','RC-ACCOUNT');
insert into public.reporting_machine_refund_managers(reporting_machine_id,manager_user_id,manager_email,grant_reason)
values('cf300000-0000-4000-8000-000000000001','cf000000-0000-4000-8000-000000000001',
  'receipt-completion-ops@example.invalid','Synthetic receipt completion');
insert into public.refund_cases(id,public_reference,reporting_machine_id,reporting_location_id,customer_email,issue_summary,
  incident_at,payment_method,payment_amount_cents,refund_amount_cents,card_last4,status,correlation_status,correlation_source,
  correlation_confidence,automation_state,matched_nayax_transaction_id,matched_nayax_amount_cents,matched_nayax_currency_code,
  matched_nayax_machine_auth_time,lifecycle_integrity_status,lifecycle_integrity_code,lifecycle_integrity_detected_at)
select ('cf400000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid,'RF-RC-'||n,
  'cf300000-0000-4000-8000-000000000001','cf200000-0000-4000-8000-000000000001',
  'receipt-customer@example.invalid','Synthetic receipt completion',now()-interval '3 days','card',700,700,'4242',
  'card_refund_pending','matched','nayax',1,'approved',(823456780+n)::text,700,'USD',now()-interval '3 days',
  'hold','card_payment_state_without_attempt',now()-interval '1 day' from generate_series(1,5) n;
select set_config('request.jwt.claim.sub','cf000000-0000-4000-8000-000000000001',true);
select set_config('request.jwt.claim.role','authenticated',true);
select set_config('request.jwt.claims','{"sub":"cf000000-0000-4000-8000-000000000001","role":"authenticated","session_id":"cf010000-0000-4000-8000-000000000001","is_anonymous":false}',true);
select public.admin_record_refund_authoritative_receipt(c.id,null,c.official_action_version,'RC-ACCOUNT','RC-MACHINE',
  c.matched_nayax_transaction_id,700,700,'USD',62,'DTM:NAYAX-'||c.matched_nayax_transaction_id,true)
  from public.refund_cases c where c.public_reference like 'RF-RC-%';

create function pg_temp.queue_completion(n integer,reviewed boolean default true,review_binding text default null)
returns jsonb language plpgsql as $$ declare v jsonb; begin
  v:=public.admin_get_refund_authoritative_receipt_overview(('cf400000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid);
  return public.admin_queue_refund_receipt_completion((v->>'caseId')::uuid,(v->'receipt'->>'id')::uuid,
    (v->>'expectedCaseVersion')::bigint,gen_random_uuid(),reviewed,coalesce(review_binding,v->'completionNotice'->>'reviewBinding'));
end; $$;
create function pg_temp.capture_error(statement text) returns text language plpgsql as $$ begin
  execute statement; return null; exception when others then return sqlstate; end; $$;

select ok(not has_table_privilege('service_role','public.refund_receipt_completion_intents','insert'),
  'A service credential cannot forge receipt completion authority');
select ok(not has_function_privilege('service_role','public.admin_queue_refund_receipt_completion(uuid,uuid,bigint,uuid,boolean,text)','execute'),
  'The service cannot impersonate the reviewing operator');
select is(pg_temp.capture_error('select pg_temp.queue_completion(1,false)'),'P4664','No send is queued without notice review');
select is(pg_temp.capture_error('select pg_temp.queue_completion(1,true,repeat(''0'',64))'),'P4664','Stale message preview is rejected');
select is((select count(*)::integer from public.refund_receipt_completion_intents),0,'Rejected reviews create no message binding');

set local role authenticated;
select is(pg_temp.queue_completion(1)->>'outboxState','queued','Mapped authenticated operator queues the reviewed completion');
select is(pg_temp.queue_completion(1)->>'replayed','true','A second click with a different intent returns the same completion');
reset role;
select is((select count(*)::integer from public.refund_case_messages where refund_case_id='cf400000-0000-4000-8000-000000000001'),1,
  'Repeated queue calls create exactly one message');
select ok((select m.body like '%$7.00 USD%' and m.body like '%RF-RC-1%' and m.body not like '%'||current_date::text||'%'
  from public.refund_receipt_completion_intents i join public.refund_case_messages m on m.id=i.message_id
  where i.refund_case_id='cf400000-0000-4000-8000-000000000001'),'Canonical copy names the exact refund without fabricating a date');
select is(pg_temp.capture_error($$update public.refund_case_messages set body='Forged completion' where
  id=(select message_id from public.refund_receipt_completion_intents where refund_case_id='cf400000-0000-4000-8000-000000000001')$$),
  'P4664','A bound completion cannot be edited');
select is(pg_temp.capture_error($$update public.refund_case_messages set manual_delivery_intent_id=gen_random_uuid() where
  id=(select message_id from public.refund_receipt_completion_intents where refund_case_id='cf400000-0000-4000-8000-000000000001')$$),
  'P4664','A bound completion cannot be rebound');
select is(pg_temp.capture_error($$insert into public.refund_case_messages(refund_case_id,message_type,status,recipient_email,subject,body)
  values('cf400000-0000-4000-8000-000000000001','completed','pending','receipt-customer@example.invalid','Forged','Forged')$$),
  'P4663','An unbound completion still cannot pass the receipt guard');

create temp table rc_claim as select * from public.service_claim_refund_manual_message_deliveries(
  (select message_id from public.refund_receipt_completion_intents where refund_case_id='cf400000-0000-4000-8000-000000000001'),1);
select is((select count(*)::integer from rc_claim),1,'The existing worker claims the bound completion');
select is((select public.service_mark_refund_manual_message_provider_attempt(refund_case_message_id,claim_token)->>'marked' from rc_claim),
  'true','Provider marking uses the existing one-message delivery identity');
select lives_ok($$select public.service_mark_refund_transactional_delivery_attempt(refund_case_message_id) from rc_claim$$,
  'The existing transactional transport accepts only the bound receipt message');
select is((select public.service_finish_refund_manual_message_delivery(refund_case_message_id,claim_token,
  'delivery_unknown',null,'synthetic_timeout',0,null)->>'outcome' from rc_claim),'delivery_unknown',
  'An interrupted delivery remains unknown');
select is(pg_temp.queue_completion(1)->>'outboxState','delivery_unknown','An unknown delivery cannot create a new completion');
select is((select count(*)::integer from public.service_claim_refund_manual_message_deliveries(
  (select message_id from public.refund_receipt_completion_intents where refund_case_id='cf400000-0000-4000-8000-000000000001'),1)),0,
  'Unknown delivery is not automatically re-claimed');
select is(public.refund_lifecycle_contract('cf400000-0000-4000-8000-000000000001')->>'paymentState','confirmed',
  'An email timeout cannot undo confirmed payment');
select is(public.refund_lifecycle_contract('cf400000-0000-4000-8000-000000000001')#>>'{messageState,state}','delivery_unconfirmed',
  'Unknown delivery uses the existing customer-status contract');
select is(public.admin_get_refund_authoritative_receipt_overview('cf400000-0000-4000-8000-000000000001')->'completionNotice'->>'state',
  'delivery_unknown','Reload shows the same unresolved delivery');

select pg_temp.queue_completion(2);
create temp table rc_sent_claim as select * from public.service_claim_refund_manual_message_deliveries(
  (select message_id from public.refund_receipt_completion_intents where refund_case_id='cf400000-0000-4000-8000-000000000002'),1);
select public.service_mark_refund_manual_message_provider_attempt(refund_case_message_id,claim_token) from rc_sent_claim;
select is((select public.service_finish_refund_manual_message_delivery(refund_case_message_id,claim_token,
  'sent','gmail_thread',null,1,'resolved')->>'outcome' from rc_sent_claim),'sent','The existing finish path records successful delivery');
select is(pg_temp.queue_completion(2)->>'outboxState','sent','Sent replay returns the same message without requeue');
select is(public.refund_lifecycle_contract('cf400000-0000-4000-8000-000000000002')->>'stage','customer_notified',
  'Customer notification advances independently of accounting date');
select is(public.refund_lifecycle_contract('cf400000-0000-4000-8000-000000000002')->>'reasonCode','settlement_time_unknown',
  'Unknown accounting date remains explicit after notification');
set local role service_role;
select is(pg_temp.capture_error($$update public.refund_case_messages set status='pending',manual_delivery_state='queued',
  manual_delivery_provider_attempted_at=null,manual_delivery_claim_token=null,manual_delivery_claimed_at=null
  where refund_case_id='cf400000-0000-4000-8000-000000000001' and template_version='refund_receipt_completion_v1'$$),
  '42501','Direct service updates cannot requeue an unknown completion or erase its send attempt');
select is(pg_temp.capture_error($$update public.refund_case_messages set status='pending',manual_delivery_state='queued'
  where refund_case_id='cf400000-0000-4000-8000-000000000002' and template_version='refund_receipt_completion_v1'$$),
  '42501','Direct service updates cannot requeue a sent completion');
select is(pg_temp.capture_error($$insert into public.refund_case_messages(refund_case_id,message_type,status,recipient_email,subject,body,
  template_key,template_version,content_source,delivery_kind,manual_delivery_intent_id,manual_delivery_state,
  manual_delivery_expected_case_version) values('cf400000-0000-4000-8000-000000000003','completed','pending',
  'receipt-customer@example.invalid','Forged','Forged','refund_receipt_completed','refund_receipt_completion_v1',
  'deterministic_template','manual',gen_random_uuid(),'queued',1)$$),'42501','Knowing a receipt template cannot forge send authority');
select lives_ok($$insert into public.refund_case_messages(refund_case_id,message_type,status,subject,body)
  values('cf400000-0000-4000-8000-000000000003','manual_note','sent','Internal note','Synthetic note')$$,
  'Unrelated supported service message writes keep their original privileges');
reset role;
select is((select count(*)::integer from public.refund_case_nayax_refund_attempts where refund_case_id::text like 'cf400000-%'),0,
  'No receipt notification manufactures a payment attempt');
select is((select count(*)::integer from public.refund_cases where id::text like 'cf400000-%'
  and (refund_completed_at is not null or reporting_adjustment_id is not null or status<>'card_refund_pending')),0,
  'No receipt notification invents a completion date or reporting adjustment');

select * from finish();
rollback;
