begin;
create extension if not exists pgtap with schema extensions;
set local search_path=public,extensions;
select no_plan();

insert into auth.users(instance_id,id,aud,role,email,encrypted_password,email_confirmed_at,raw_app_meta_data,raw_user_meta_data,created_at,updated_at)
values('00000000-0000-0000-0000-000000000000','ad000000-0000-4000-8000-000000000001','authenticated','authenticated',
  'receipt-ops@example.invalid','',now(),'{}','{}',now(),now()),
  ('00000000-0000-0000-0000-000000000000','ad000000-0000-4000-8000-000000000002','authenticated','authenticated',
  'receipt-outsider@example.invalid','',now(),'{}','{}',now(),now());
insert into auth.sessions(id,user_id,created_at,updated_at)
values('ad010000-0000-4000-8000-000000000001','ad000000-0000-4000-8000-000000000001',now(),now());
insert into public.admin_roles(user_id,role,active) values('ad000000-0000-4000-8000-000000000001','super_admin',true);
insert into public.customer_accounts(id,name,account_type)
values('ad100000-0000-4000-8000-000000000001','Receipt fixture','internal');
insert into public.reporting_locations(id,account_id,name,timezone)
values('ad200000-0000-4000-8000-000000000001','ad100000-0000-4000-8000-000000000001','Receipt fixture','America/Los_Angeles');
insert into public.reporting_machines(id,account_id,location_id,machine_label,nayax_machine_id,nayax_account_key)
values('ad300000-0000-4000-8000-000000000001','ad100000-0000-4000-8000-000000000001',
  'ad200000-0000-4000-8000-000000000001','Receipt fixture','RECEIPT-MACHINE','RECEIPT-ACCOUNT');
insert into public.reporting_machine_refund_managers(reporting_machine_id,manager_user_id,manager_email,grant_reason)
values('ad300000-0000-4000-8000-000000000001','ad000000-0000-4000-8000-000000000001','receipt-ops@example.invalid','Receipt fixture');
insert into public.refund_cases(id,public_reference,reporting_machine_id,reporting_location_id,customer_email,issue_summary,
  incident_at,payment_method,payment_amount_cents,refund_amount_cents,card_last4,status,correlation_status,correlation_source,
  correlation_confidence,automation_state,matched_nayax_transaction_id,matched_nayax_amount_cents,matched_nayax_currency_code,
  matched_nayax_machine_auth_time,lifecycle_integrity_status,lifecycle_integrity_code,lifecycle_integrity_detected_at)
select ('ad400000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid,'RF-RECEIPT-'||n,
  'ad300000-0000-4000-8000-000000000001','ad200000-0000-4000-8000-000000000001',
  'receipt-customer@example.invalid','Synthetic receipt fixture',now()-interval '3 days','card',700,700,'4242',
  'card_refund_pending','matched','nayax',1,'approved',(123456780+n)::text,700,'USD',now()-interval '3 days',
  'hold','card_payment_state_without_attempt',now()-interval '1 day' from generate_series(1,4) n;
insert into public.refund_case_nayax_refund_attempts(id,refund_case_id,execution_mode,status,idempotency_key,amount_cents,currency_code,
  provider_outcome,reconciliation_required)
values('ad600000-0000-4000-8000-000000000002','ad400000-0000-4000-8000-000000000002','manual_portal','manual_review',
  'receipt-attempt-two',700,'USD','unknown',true);

create function pg_temp.set_receipt_auth(p_user_id uuid,p_session_id uuid)
returns void language plpgsql as $$ begin
  perform set_config('request.jwt.claim.sub',p_user_id::text,true);
  perform set_config('request.jwt.claim.role','authenticated',true);
  perform set_config('request.jwt.claims',jsonb_build_object('sub',p_user_id,'role','authenticated','session_id',p_session_id,'is_anonymous',false)::text,true);
end; $$;
select pg_temp.set_receipt_auth('ad000000-0000-4000-8000-000000000001','ad010000-0000-4000-8000-000000000001');

create function pg_temp.record_receipt(n integer,changes jsonb default '{}'::jsonb)
returns jsonb language plpgsql as $$ declare
  case_id uuid:=('ad400000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid;
  v bigint; a uuid; x jsonb;
begin
  select official_action_version into v from public.refund_cases where id=case_id;
  select id into a from public.refund_case_nayax_refund_attempts where refund_case_id=case_id order by created_at desc limit 1;
  x:=jsonb_build_object('attemptId',a,'version',v,'scope','RECEIPT-ACCOUNT','machine','RECEIPT-MACHINE',
    'original',(123456780+n)::text,'amount',700,'refunded',700,'currency','USD','status',62,
    'reference','DTM:NAYAX-'||(123456780+n)::text)||changes;
  return public.admin_record_refund_authoritative_receipt(case_id,(x->>'attemptId')::uuid,(x->>'version')::bigint,
    x->>'scope',x->>'machine',x->>'original',(x->>'amount')::integer,(x->>'refunded')::integer,
    x->>'currency',(x->>'status')::integer,x->>'reference');
end; $$;

select ok(not has_table_privilege('authenticated','public.refund_authoritative_receipts','select'), 'Receipt identities are not browser readable');
select ok(not has_table_privilege('service_role','public.refund_authoritative_receipts','insert'), 'Service role cannot insert receipts directly');
select ok(not has_table_privilege('authenticated','public.refund_completion_notice_adoptions','select'), 'Prior message evidence is private');
select ok(not has_function_privilege('anon','public.admin_record_refund_authoritative_receipt(uuid,uuid,bigint,text,text,text,integer,integer,text,integer,text)','execute'), 'Anonymous cannot record evidence');
select ok(not has_function_privilege('service_role','public.admin_record_refund_authoritative_receipt(uuid,uuid,bigint,text,text,text,integer,integer,text,integer,text)','execute'), 'Background service cannot impersonate operator');

select throws_ok($$select pg_temp.record_receipt(1,'{"status":61}')$$,'P4661',null,'Pending provider status cannot confirm payment');
select throws_ok($$select pg_temp.record_receipt(1,'{"refunded":699}')$$,'P4661',null,'Partial amount cannot confirm full refund');
select throws_ok($$select pg_temp.record_receipt(1,'{"refunded":701}')$$,'P4661',null,'Over-refund amount is rejected');
select throws_ok($$select pg_temp.record_receipt(1,'{"scope":"WRONG"}')$$,'P4661',null,'Wrong account fails closed');
select throws_ok($$select pg_temp.record_receipt(1,'{"machine":"WRONG"}')$$,'P4661',null,'Wrong machine fails closed');
select throws_ok($$select pg_temp.record_receipt(1,'{"currency":"EUR"}')$$,'P4661',null,'Wrong currency fails closed');
select throws_ok($$select pg_temp.record_receipt(1,'{"original":"123456782"}')$$,'P4661',null,'Wrong original fails closed');
select throws_ok($$select pg_temp.record_receipt(1,'{"version":0}')$$,'P4661',null,'Stale case version fails closed');
select throws_ok($$select pg_temp.record_receipt(2,'{"attemptId":null}')$$,'P4661',null,'Existing attempt cannot be omitted');
select pg_temp.set_receipt_auth('ad000000-0000-4000-8000-000000000002','ad010000-0000-4000-8000-000000000001');
select throws_ok($$select pg_temp.record_receipt(1)$$,'42501',null,'Unmapped caller cannot record authoritative evidence');
select pg_temp.set_receipt_auth('ad000000-0000-4000-8000-000000000001','ad010000-0000-4000-8000-000000000099');
select throws_ok($$select pg_temp.record_receipt(1)$$,'42501',null,'Revoked or nonexistent session is rejected');
select pg_temp.set_receipt_auth('ad000000-0000-4000-8000-000000000001','ad010000-0000-4000-8000-000000000001');

select is(pg_temp.record_receipt(1)->>'status','recorded','Legacy no-attempt case receives an observation receipt');
select is(pg_temp.record_receipt(1)->>'status','already_recorded','Exact replay creates no second receipt');
select is(pg_temp.record_receipt(2)->>'status','recorded','Durable held attempt accepts exact authoritative observation');
select is((select count(*)::integer from public.refund_authoritative_receipts),2,'Only two receipts were recorded');
select is((select count(*)::integer from public.refund_case_nayax_refund_attempts where refund_case_id='ad400000-0000-4000-8000-000000000001'),0,'No attempt is fabricated for historical integrity case');
select is((select status from public.refund_case_nayax_refund_attempts where id='ad600000-0000-4000-8000-000000000002'),'manual_review','Original attempt remains historical evidence');
select ok((select bool_and(settled_at is null and settlement_time_precision='unknown' and observed_at>=transaction_timestamp()) from public.refund_authoritative_receipts),'Server observation is separate from unknown settlement');
select is((select count(*)::integer from public.sales_adjustment_facts where refund_case_id in ('ad400000-0000-4000-8000-000000000001','ad400000-0000-4000-8000-000000000002')),0,'Unknown settlement creates no dated accounting adjustment');
select is((select count(*)::integer from public.refund_case_messages where refund_case_id in ('ad400000-0000-4000-8000-000000000001','ad400000-0000-4000-8000-000000000002')),0,'Receipt creates no customer message');
select ok((select bool_and(refund_completed_at is null) from public.refund_cases where id in ('ad400000-0000-4000-8000-000000000001','ad400000-0000-4000-8000-000000000002')),'Observation time is never copied into settlement time');
select is(public.refund_lifecycle_contract('ad400000-0000-4000-8000-000000000001')->>'paymentState','confirmed','No-attempt receipt projects truthful payment certainty');
select is(public.refund_lifecycle_contract('ad400000-0000-4000-8000-000000000001')->>'reasonCode','settlement_time_unknown','Projection preserves explicit unknown settlement time');
select is(public.refund_lifecycle_contract('ad400000-0000-4000-8000-000000000002')#>>'{managerQueue,nextAction}','review_accounting_date','Accounting work stays with operations');
select is(public.refund_lifecycle_contract('ad400000-0000-4000-8000-000000000002')#>>'{customerAction,required}','false','Customer is not assigned internal accounting work');
select ok(not public.can_perform_refund_official_action('ad000000-0000-4000-8000-000000000001','ad400000-0000-4000-8000-000000000001'),'Receipt does not authorize a fresh payment');
select throws_ok($$update public.refund_authoritative_receipts set settled_at=observed_at$$,'P4660',null,'Receipt cannot be rewritten to invent settlement time');
select throws_ok($$delete from public.refund_authoritative_receipts$$,'P4660',null,'Receipt evidence cannot be deleted');
select throws_ok($$update public.refund_cases set refund_completed_at=now() where id='ad400000-0000-4000-8000-000000000001'$$,'P4663',null,'Legacy completion cannot substitute current time');
select throws_ok($$insert into public.refund_case_nayax_refund_attempts(refund_case_id,execution_mode,status,idempotency_key,amount_cents) values('ad400000-0000-4000-8000-000000000001','manual_portal','manual_review','forbidden-retry',700)$$,'P4663',null,'Receipt without an attempt cannot receive an invented retry');

insert into public.refund_gmail_threads(id,refund_case_id,mailbox_hash,provider_thread_id,thread_subject,first_message_at,latest_message_at,retention_expires_at)
values('ad700000-0000-4000-8000-000000000001','ad400000-0000-4000-8000-000000000001',repeat('a',64),'receipt-thread-1','Synthetic shared claim thread',now()-interval '1 day',now(),now()+interval '30 days');
insert into public.refund_gmail_messages(id,gmail_thread_id,refund_case_id,provider_message_id,operation_key,direction,message_kind,status,
  sender_email,recipient_email,subject,plain_body,sent_at,retention_expires_at,recipient_cc_emails,recipient_cc_count)
values('ad800000-0000-4000-8000-000000000001','ad700000-0000-4000-8000-000000000001','ad400000-0000-4000-8000-000000000001',
  'receipt-sent-message-1','imported:receipt-sent-1','outbound','message','sent','info@bloomjoysweets.com','receipt-customer@example.invalid',
  'Synthetic case-specific update','This exact claim is fully refunded. The other purchase is still pending.',now()-interval '1 hour',now()+interval '30 days','{}',0);

create function pg_temp.adopt_notice(n integer,changes jsonb default '{}'::jsonb)
returns jsonb language plpgsql as $$ declare
  c public.refund_cases%rowtype; r uuid; x jsonb;
begin
  select * into c from public.refund_cases where id=('ad400000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid;
  select id into r from public.refund_authoritative_receipts where refund_case_id=c.id;
  x:=jsonb_build_object('reference',c.public_reference,'original',c.matched_nayax_transaction_id,'amount',700,'reviewed',true)||changes;
  return public.admin_adopt_refund_completion_notice(c.id,r,'ad800000-0000-4000-8000-000000000001',c.official_action_version,
    x->>'reference',x->>'original',(x->>'amount')::integer,(x->>'reviewed')::boolean);
end; $$;
select throws_ok($$select pg_temp.adopt_notice(1,'{"reviewed":false}')$$,'P4662',null,'Unreviewed notice is not completion evidence');
select throws_ok($$select pg_temp.adopt_notice(1,'{"original":"123456782"}')$$,'P4662',null,'Same-thread notice cannot apply to another original');
select throws_ok($$select pg_temp.adopt_notice(1,'{"amount":1400}')$$,'P4662',null,'Combined-thread amount cannot substitute this claim amount');
select throws_ok($$select pg_temp.adopt_notice(2)$$,'P4662',null,'A completed notice cannot complete another pending case');
select is(pg_temp.adopt_notice(1)->>'status','adopted','Prior sent notice is adopted without dispatch');
select is(pg_temp.adopt_notice(1)->>'status','already_adopted','Notice adoption replay is idempotent');
select is((select count(*)::integer from public.refund_completion_notice_adoptions),1,'One provider message is adopted exactly once');
select is((select manager_cc_verified from public.refund_completion_notice_adoptions),false,'Missing CC remains missing rather than fabricated');
select is((select recipient_cc_count from public.refund_gmail_messages where id='ad800000-0000-4000-8000-000000000001'),0,'Original CC evidence is not rewritten');
select is(public.refund_lifecycle_contract('ad400000-0000-4000-8000-000000000001')#>>'{messageState,state}','sent','Projection recognizes verified existing notice');
select is(public.refund_lifecycle_contract('ad400000-0000-4000-8000-000000000002')#>>'{messageState,state}','none','One shared notice does not notify another case');
select is((select count(*)::integer from public.refund_case_messages where refund_case_id='ad400000-0000-4000-8000-000000000001'),0,'Adoption creates no canonical message to resend');
select throws_ok($$update public.refund_completion_notice_adoptions set manager_cc_verified=true$$,'P4660',null,'Adopted missing CC cannot be falsified');
select ok(public.refund_lifecycle_contract('ad400000-0000-4000-8000-000000000001')::text not like '%receipt-sent-message-1%','Public lifecycle does not expose provider message identity');
select ok(public.refund_lifecycle_contract('ad400000-0000-4000-8000-000000000001')::text not like '%123456781%','Public lifecycle does not expose original transaction identity');
select * from finish();
rollback;
