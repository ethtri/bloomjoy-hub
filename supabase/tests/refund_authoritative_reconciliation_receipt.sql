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
  case when n=2 then 'ok' else 'hold' end,
  case when n=2 then null else 'card_payment_state_without_attempt' end,
  case when n=2 then null else now()-interval '1 day' end from generate_series(1,5) n;
-- Exercise the supported portal registration, not a hand-invented money attempt.
update public.reporting_machines set nayax_refunds_enabled=true where id='ad300000-0000-4000-8000-000000000001';
update public.refund_cases set status='needs_review',
  nayax_recommendation_state='high_confidence',nayax_recommendation_policy_version='2026-07-21.v1',
  nayax_match_execution_eligible=true,matched_nayax_site_id=97102,
  matched_nayax_card_last4='4242',nayax_refund_execution_status='not_requested'
  where id='ad400000-0000-4000-8000-000000000002';
insert into public.refund_case_events(refund_case_id,actor_user_id,event_type,message,metadata)
values('ad400000-0000-4000-8000-000000000002','ad000000-0000-4000-8000-000000000001',
  'nayax_match_selected','Synthetic exact selection','{"payload_redacted":true}');

create function pg_temp.set_receipt_auth(p_user_id uuid,p_session_id uuid)
returns void language plpgsql as $$ begin
  perform set_config('request.jwt.claim.sub',p_user_id::text,true);
  perform set_config('request.jwt.claim.role','authenticated',true);
  perform set_config('request.jwt.claims',jsonb_build_object('sub',p_user_id,'role','authenticated','session_id',p_session_id,'is_anonymous',false)::text,true);
end; $$;
select pg_temp.set_receipt_auth('ad000000-0000-4000-8000-000000000001','ad010000-0000-4000-8000-000000000001');
set local role authenticated;
select lives_ok($$select public.admin_begin_refund_manual_nayax_portal(
  'ad400000-0000-4000-8000-000000000002',
  (select official_action_version from public.refund_cases where id='ad400000-0000-4000-8000-000000000002'))$$,
  'Supported manual portal registration creates the held original-bound fixture');
reset role;

create function pg_temp.record_receipt(n integer,changes jsonb default '{}'::jsonb)
returns jsonb language plpgsql as $$ declare
  case_id uuid:=('ad400000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid;
  v bigint; a uuid; x jsonb;
begin
  select official_action_version into v from public.refund_cases where id=case_id;
  select id into a from public.refund_case_nayax_refund_attempts where refund_case_id=case_id order by created_at desc limit 1;
  x:=jsonb_build_object('attemptId',a,'version',v,'scope','RECEIPT-ACCOUNT','machine','RECEIPT-MACHINE',
    'original',(123456780+n)::text,'amount',700,'refunded',700,'currency','USD','status',62,
    'reference','DTM:NAYAX-'||(123456780+n)::text,'reviewedCurrent',true)||changes;
  return public.admin_record_refund_authoritative_receipt(case_id,(x->>'attemptId')::uuid,(x->>'version')::bigint,
    x->>'scope',x->>'machine',x->>'original',(x->>'amount')::integer,(x->>'refunded')::integer,
    x->>'currency',(x->>'status')::integer,x->>'reference',(x->>'reviewedCurrent')::boolean);
end; $$;

-- Roll corruption back inside a subtransaction before pgTAP records its result.
-- Rolling back an outer SAVEPOINT after an assertion also erases pgTAP's plan
-- bookkeeping, even though its TAP output has already been emitted.
create function pg_temp.corrupt_and_record(p_setup text,n integer) returns text language plpgsql as $$
declare setup_done boolean:=false;
begin
  execute p_setup;
  setup_done:=true;
  perform pg_temp.record_receipt(n);
  raise exception 'Corrupted fixture unexpectedly accepted' using errcode='XX001';
exception when others then
  if not setup_done then raise; end if;
  return sqlstate;
end; $$;

select ok(not has_table_privilege('authenticated','public.refund_authoritative_receipts','select'), 'Receipt identities are not browser readable');
select ok(not has_table_privilege('service_role','public.refund_authoritative_receipts','insert'), 'Service role cannot insert receipts directly');
select ok(not has_table_privilege('authenticated','public.refund_completion_notice_adoptions','select'), 'Prior message evidence is private');
select ok(not has_function_privilege('anon','public.admin_record_refund_authoritative_receipt(uuid,uuid,bigint,text,text,text,integer,integer,text,integer,text,boolean)','execute'), 'Anonymous cannot record evidence');
select ok(not has_function_privilege('service_role','public.admin_record_refund_authoritative_receipt(uuid,uuid,bigint,text,text,text,integer,integer,text,integer,text,boolean)','execute'), 'Background service cannot impersonate operator');
-- The full persona suite runs after the disposable historical-DDL regressions
-- roll back. Assert the final runtime eligibility guards survived that replay.
select ok((select prosecdef and position('refund_authoritative_receipts' in prosrc)>0
  from pg_proc where oid=signature::regprocedure),
  'Final post-replay receipt-aware security-definer source exists: '||signature)
from unnest(array[
  'public.service_list_due_refund_provider_delay_attempts(timestamptz,integer)',
  'public.service_list_refund_follow_up_customer_reply_candidates(integer)',
  'public.service_claim_refund_automation_action(uuid,uuid,text,text,text,timestamptz)',
  'public.service_claim_due_refund_follow_up_reminders(integer)',
  'public.service_claim_refund_follow_up_customer_reply(uuid,uuid)',
  'public.service_list_due_refund_manager_aging_notices(timestamptz,text,integer,integer,text,integer)',
  'public.service_authorize_refund_manager_aging_notice(uuid,bigint,text,timestamptz,text,integer,integer,text)',
  'public.service_claim_due_refund_payout_destination_follow_ups(integer,boolean)'
]) signature;
select ok(not has_function_privilege(role_name,
  'public.service_list_refund_follow_up_customer_reply_candidates(integer)','execute'),
  role_name||' cannot enumerate private reply candidate identities') from unnest(array['anon','authenticated']) role_name;
select ok(has_function_privilege('service_role',
  'public.service_list_refund_follow_up_customer_reply_candidates(integer)','execute'),
  'Background worker alone can discover the bounded receipt-filtered reply page');
select ok(not has_function_privilege(role_name,signature,'execute'),role_name||' cannot execute '||signature)
from unnest(array['anon','authenticated']) role_name
cross join unnest(array[
  'public.service_claim_refund_gmail_outbound_v3(uuid,uuid,text,text,text,text,text[],text,uuid)',
  'public.service_claim_refund_gmail_outbound_pre_receipt_v1(uuid,uuid,text,text,text,text,text[],text,uuid)',
  'public.service_mark_refund_transactional_delivery_attempt(uuid)',
  'public.service_mark_refund_delivery_pre_receipt_v1(uuid)'
]) signature;

select throws_ok($$select pg_temp.record_receipt(1,'{"status":61}')$$,'P4661',null,'Pending provider status cannot confirm payment');
select throws_ok($$select pg_temp.record_receipt(1,'{"refunded":699}')$$,'P4661',null,'Partial amount cannot confirm full refund');
select throws_ok($$select pg_temp.record_receipt(1,'{"refunded":701}')$$,'P4661',null,'Over-refund amount is rejected');
select throws_ok($$select pg_temp.record_receipt(1,'{"scope":"WRONG"}')$$,'P4661',null,'Wrong account fails closed');
select throws_ok($$select pg_temp.record_receipt(1,'{"machine":"WRONG"}')$$,'P4661',null,'Wrong machine fails closed');
select throws_ok($$select pg_temp.record_receipt(1,'{"currency":"EUR"}')$$,'P4661',null,'Wrong currency fails closed');
select throws_ok($$select pg_temp.record_receipt(1,'{"original":"123456782"}')$$,'P4661',null,'Wrong original fails closed');
select throws_ok($$select pg_temp.record_receipt(1,'{"version":0}')$$,'P4661',null,'Stale case version fails closed');
select throws_ok($$select pg_temp.record_receipt(2,'{"attemptId":null}')$$,'P4661',null,'Existing attempt cannot be omitted');
select throws_ok($$select pg_temp.record_receipt(1,'{"reviewedCurrent":false}')$$,'P4661',null,'No-attempt receipt requires fresh provider observation review');
select throws_ok($$select pg_temp.record_receipt(1,'{"reviewedCurrent":null}')$$,'P4661',null,'NULL no-attempt observation review fails closed');
select throws_ok($$select pg_temp.record_receipt(2,'{"reviewedCurrent":false}')$$,'P4661',null,'Modern attempt authorization is not current provider observation review');
select throws_ok($$select pg_temp.record_receipt(2,'{"reviewedCurrent":null}')$$,'P4661',null,'NULL modern observation review fails closed');
select is(pg_temp.corrupt_and_record($$update public.refund_cases set correlation_source=null
  where id='ad400000-0000-4000-8000-000000000001'$$,1),'P4661','NULL correlation source fails closed');
select is(pg_temp.corrupt_and_record($$update public.refund_cases set lifecycle_integrity_code=null
  where id='ad400000-0000-4000-8000-000000000001'$$,1),'P4661','NULL integrity code is not the explicit no-attempt hold');
-- Clear the authorization only in this corruption fixture so the existing bound
-- lifecycle constraint permits testing the historical nullable outcome shape.
select is(pg_temp.corrupt_and_record($$update public.refund_case_nayax_refund_attempts set official_action_authorization_id=null,provider_outcome=null
  where refund_case_id='ad400000-0000-4000-8000-000000000002'$$,2),'P4661','NULL provider outcome fails closed');
select is(pg_temp.corrupt_and_record($$update public.refund_case_nayax_refund_attempts set idempotency_key='manual-nayax-'||repeat('b',64)
  where refund_case_id='ad400000-0000-4000-8000-000000000002'$$,2),'P4661','Same amount latest attempt with wrong original or account binding is rejected');
select is(pg_temp.corrupt_and_record($$update public.refund_case_nayax_refund_attempts set request_fingerprint=repeat('c',64)
  where refund_case_id='ad400000-0000-4000-8000-000000000002'$$,2),'P4661','Manual authorization fingerprint mismatch fails closed');
select pg_temp.set_receipt_auth('ad000000-0000-4000-8000-000000000002','ad010000-0000-4000-8000-000000000001');
select throws_ok($$select pg_temp.record_receipt(1)$$,'42501',null,'Unmapped caller cannot record authoritative evidence');
select pg_temp.set_receipt_auth('ad000000-0000-4000-8000-000000000001','ad010000-0000-4000-8000-000000000099');
select throws_ok($$select pg_temp.record_receipt(1)$$,'42501',null,'Revoked or nonexistent session is rejected');
select pg_temp.set_receipt_auth('ad000000-0000-4000-8000-000000000001','ad010000-0000-4000-8000-000000000001');

select is(pg_temp.corrupt_and_record($$insert into public.refund_case_messages(refund_case_id,message_type,status,recipient_email,subject,body,delivery_transport,delivery_state)
values('ad400000-0000-4000-8000-000000000001','confirmation','sent','receipt-customer@example.invalid','Synthetic prior send','Synthetic prior send','resend','unknown')$$,1),
  'P4661','Unknown Resend without original sent time blocks receipt entry');
select is(pg_temp.corrupt_and_record(format($fixture$
insert into public.refund_case_messages(refund_case_id,message_type,status,recipient_email,subject,body,
  delivery_transport,delivery_state,sent_at,delivery_state_updated_at,provider_message_id)
values('ad400000-0000-4000-8000-000000000001','confirmation',%L,'receipt-customer@example.invalid',
  'Synthetic unresolved send','Synthetic unresolved send','resend','unknown',
  '2026-08-31 12:00:00+00',%L::timestamptz,%L)
$fixture$,message_status,state_at,provider_id),1),'P4661',label)
from (values
  ('pending','2026-08-31 12:00:00+00',null,'Pending intent remains blocked even with sent-like metadata'),
  ('failed','2026-08-31 12:00:00+00',null,'Unsent failed unknown attempt remains blocked'),
  ('sent','2026-08-31 12:00:00+00','synthetic-unknown-provider','Bound provider unknown is not a historical unbound notice'),
  ('sent','2026-08-31 12:01:00+00',null,'Later unknown timestamp is not the historical sent-time backfill'),
  ('sent',null,null,'Missing unknown-state timestamp fails closed')
) unresolved(message_status,state_at,provider_id,label);
select is(pg_temp.corrupt_and_record(format($fixture$
insert into public.refund_case_messages(refund_case_id,message_type,status,recipient_email,subject,body,
  delivery_transport,delivery_state,sent_at,delivery_state_updated_at,delivery_kind,content_source,
  manual_delivery_intent_id,manual_delivery_expected_case_version,manual_delivery_state,
  manual_delivery_claim_token,manual_delivery_claimed_at)
values('ad400000-0000-4000-8000-000000000001','confirmation','sent','receipt-customer@example.invalid',
  'Synthetic unresolved manual intent','Synthetic unresolved manual intent','resend','unknown',
  '2026-08-31 12:00:00+00','2026-08-31 12:00:00+00','manual','manager_authored',
  gen_random_uuid(),1,%L,case when %L='claimed' then gen_random_uuid() end,
  case when %L='claimed' then statement_timestamp() end)
$fixture$,state,state,state),1),'P4661','Manual '||state||' remains blocked despite historical-shaped metadata')
from (values ('queued'),('claimed'),('delivery_unknown')) manual(state);
select throws_ok($$update public.refund_cases set matched_nayax_transaction_id='123456781'
  where id='ad400000-0000-4000-8000-000000000004'$$,'23505',null,
  'Existing unique-original guard prevents constructing a competing active claim');
select is(pg_temp.corrupt_and_record($$insert into public.refund_gmail_threads(id,refund_case_id,mailbox_hash,provider_thread_id,thread_subject,first_message_at,latest_message_at,retention_expires_at)
values('ad700000-0000-4000-8000-000000000009','ad400000-0000-4000-8000-000000000001',repeat('d',64),'inflight-thread','Synthetic pending send',now(),now(),now()+interval '30 days');
insert into public.refund_gmail_messages(gmail_thread_id,refund_case_id,operation_key,direction,message_kind,status,sender_email,recipient_email,subject,plain_body,retention_expires_at,received_at)
values('ad700000-0000-4000-8000-000000000009','ad400000-0000-4000-8000-000000000001','synthetic-inflight','outbound','message','pending_send',
  'info@bloomjoysweets.com','receipt-customer@example.invalid','Synthetic pending send','Synthetic pending send',now()+interval '30 days',now())$$,1),
  'P4661','In-flight Gmail claim blocks receipt entry');

select is(pg_temp.record_receipt(1)->>'status','recorded','Legacy no-attempt case receives an observation receipt');
select is(pg_temp.record_receipt(1)->>'status','already_recorded','Exact replay creates no second receipt');
set local role service_role;
select is((select count(*)::integer from public.service_list_due_refund_provider_delay_attempts(
  statement_timestamp()+interval '7 days',100)
  where refund_case_id='ad400000-0000-4000-8000-000000000002'),1,
  'A genuinely unresolved latest hold remains eligible for provider-delay work');
reset role;
select is(pg_temp.record_receipt(2)->>'status','recorded','Durable held attempt accepts exact authoritative observation');
create temporary table receipt_attempt_before_scheduling as
select to_jsonb(attempt) as value from public.refund_case_nayax_refund_attempts attempt
where refund_case_id='ad400000-0000-4000-8000-000000000002';
set local role service_role;
select is((select count(*)::integer from public.service_list_due_refund_provider_delay_attempts(
  statement_timestamp()+interval '7 days',100)
  where refund_case_id='ad400000-0000-4000-8000-000000000002'),0,
  'Confirmed receipt excludes the preserved unknown attempt before customer-delay action claim');
reset role;
select is((select to_jsonb(attempt) from public.refund_case_nayax_refund_attempts attempt
  where refund_case_id='ad400000-0000-4000-8000-000000000002'),
  (select value from receipt_attempt_before_scheduling),
  'Receipt-aware scheduling preserves every historical attempt field');
select is((select count(*)::integer from public.refund_automation_actions
  where refund_case_id='ad400000-0000-4000-8000-000000000002'),0,
  'Receipt-aware provider-delay selection creates neither a claim nor a failed action');
insert into public.refund_automation_runs(id,run_key,trigger_source,status)
values('ad900000-0000-4000-8000-000000000001','receipt-eligibility-fixture','manual','running');
create temporary table receipt_case_before_scheduling as
select to_jsonb(c) as value from public.refund_cases c
where id='ad400000-0000-4000-8000-000000000002';
set local role service_role;
select is(public.service_claim_refund_automation_action(
  'ad900000-0000-4000-8000-000000000001','ad400000-0000-4000-8000-000000000002',
  'receipt-eligibility:'||action_type,action_type),
  '{"actionId":null,"claimed":false,"status":"not_eligible","reasonCategory":"authoritative_refund_receipt"}'::jsonb,
  'Confirmed receipt declines obsolete '||action_type||' work before writing an action')
from unnest(array['nayax_lookup','customer_reminder','customer_more_info',
  'wallet_correction_request','wallet_correction_reminder','customer_information_received',
  'customer_reply_recheck','customer_status_update','manager_reminder','manager_escalation']) action_type;
reset role;
select is((select count(*)::integer from public.refund_automation_actions
  where refund_case_id='ad400000-0000-4000-8000-000000000002'),0,
  'All receipt-backed customer and old aging claims leave no claimed or failed ledger row');
select is((select to_jsonb(c) from public.refund_cases c
  where id='ad400000-0000-4000-8000-000000000002'),
  (select value from receipt_case_before_scheduling),
  'Declining obsolete work preserves every case field including lifecycle revision');
set local role service_role;
select is(public.service_claim_refund_automation_action(
  'ad900000-0000-4000-8000-000000000001','ad400000-0000-4000-8000-000000000003',
  'receipt-eligibility:unresolved','customer_status_update')->>'claimed','true',
  'An unreceipted case can still claim ordinary status work');
select is(public.service_claim_refund_automation_action(
  'ad900000-0000-4000-8000-000000000001','ad400000-0000-4000-8000-000000000002',
  'receipt-eligibility:'||action_type,action_type)->>'claimed','true',
  'Receipt does not suppress internal '||action_type||' work')
from unnest(array['provider_exception','internal_escalation','ops_alert']) action_type;
reset role;
select is((select count(*)::integer from public.refund_authoritative_receipts),2,'Only two receipts were recorded');
select is((select count(*)::integer from public.refund_case_nayax_refund_attempts where refund_case_id='ad400000-0000-4000-8000-000000000001'),0,'No attempt is fabricated for historical integrity case');
select is((select status from public.refund_case_nayax_refund_attempts where refund_case_id='ad400000-0000-4000-8000-000000000002'),'manual_review','Original attempt remains historical evidence');
select ok((select bool_and(settled_at is null and settlement_time_precision='unknown' and observed_at>=transaction_timestamp()) from public.refund_authoritative_receipts),'Server observation is separate from unknown settlement');
select is((select count(*)::integer from public.sales_adjustment_facts where refund_case_id in ('ad400000-0000-4000-8000-000000000001','ad400000-0000-4000-8000-000000000002')),0,'Unknown settlement creates no dated accounting adjustment');
select is((select count(*)::integer from public.refund_case_messages where refund_case_id in ('ad400000-0000-4000-8000-000000000001','ad400000-0000-4000-8000-000000000002')),0,'Receipt creates no customer message');
select ok((select bool_and(refund_completed_at is null) from public.refund_cases where id in ('ad400000-0000-4000-8000-000000000001','ad400000-0000-4000-8000-000000000002')),'Observation time is never copied into settlement time');
select is(public.refund_lifecycle_contract('ad400000-0000-4000-8000-000000000001')->>'paymentState','confirmed','No-attempt receipt projects truthful payment certainty');
select is(public.refund_lifecycle_contract('ad400000-0000-4000-8000-000000000001')->>'reasonCode','settlement_time_unknown','Projection preserves explicit unknown settlement time');
select is(public.refund_lifecycle_contract('ad400000-0000-4000-8000-000000000001')->>'stageRank','70','Unadopted receipt never marks customer updated complete');
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
  sender_email,recipient_email,subject,plain_body,sent_at,retention_expires_at,recipient_cc_emails,recipient_cc_count,received_at)
values('ad800000-0000-4000-8000-000000000001','ad700000-0000-4000-8000-000000000001','ad400000-0000-4000-8000-000000000001',
  'receipt-sent-message-1','imported:receipt-sent-1','outbound','message','sent','info@bloomjoysweets.com','receipt-customer@example.invalid',
  'Synthetic case-specific update','This exact claim is fully refunded. The other purchase is still pending.',now()-interval '1 hour',now()+interval '30 days','{}',0,now()-interval '1 hour');

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
select is(public.refund_lifecycle_contract('ad400000-0000-4000-8000-000000000001')->>'stageRank','80','Only exact adopted notice reaches customer updated rank');
select is(public.refund_lifecycle_contract('ad400000-0000-4000-8000-000000000001')->>'stage','customer_notified','Stage agrees with adopted notice');
set local role authenticated;
select is(public.admin_get_refund_authoritative_receipt_overview('ad400000-0000-4000-8000-000000000001')#>>'{receipt,noticeAdopted}','true','Authorized refresh rediscovers receipt and adopted notice');
select throws_ok($$select * from public.refund_authoritative_receipts$$,'42501',null,'Actual authenticated role cannot read private receipt table');
reset role;
set local role anon;
select throws_ok($$select public.admin_get_refund_authoritative_receipt_overview('ad400000-0000-4000-8000-000000000001')$$,'42501',null,'Actual anon role cannot read receipt overview');
reset role;
select is(public.refund_lifecycle_contract('ad400000-0000-4000-8000-000000000002')#>>'{messageState,state}','none','One shared notice does not notify another case');
select is((select count(*)::integer from public.refund_case_messages where refund_case_id='ad400000-0000-4000-8000-000000000001'),0,'Adoption creates no canonical message to resend');
select throws_ok($$update public.refund_completion_notice_adoptions set manager_cc_verified=true$$,'P4660',null,'Adopted missing CC cannot be falsified');
select ok(public.refund_lifecycle_contract('ad400000-0000-4000-8000-000000000001')::text not like '%receipt-sent-message-1%','Public lifecycle does not expose provider message identity');
select ok(public.refund_lifecycle_contract('ad400000-0000-4000-8000-000000000001')::text not like '%123456781%','Public lifecycle does not expose original transaction identity');

-- Exercise real intake/link/SENT ingestion with a completed related claim and
-- still-pending primary claim. Never relink the source thread to adopt a notice.
update public.refund_cases set customer_email='receipt-shared@example.invalid'
  where id in ('ad400000-0000-4000-8000-000000000003','ad400000-0000-4000-8000-000000000004');
select set_config('request.jwt.claim.role','service_role',true);
select set_config('request.jwt.claims','{"role":"service_role"}',true);
set local role service_role;
select public.service_ingest_refund_gmail_contact_v2(
  repeat('e',64),'receipt-reviewed-shared-thread','receipt-shared-inbound','<receipt-inbound@example.invalid>',null,
  'inbound',false,'receipt-shared@example.invalid','Synthetic Customer','info@bloomjoysweets.com',
  'Two claims','Two separate purchases need review.',false,statement_timestamp(),null,
  '[]'::jsonb,'{}'::text[],array['info@bloomjoysweets.com'],'direct_human',false,false,'{}'::text[],
  '{"payloadRedacted":true}'::jsonb);
reset role;
select set_config('receipt_test.review_id',(select review.id::text from public.refund_gmail_case_link_reviews review
  join public.refund_gmail_intake_contacts contact on contact.id=review.contact_id
  where contact.provider_thread_id='receipt-reviewed-shared-thread'),true);
select pg_temp.set_receipt_auth('ad000000-0000-4000-8000-000000000001','ad010000-0000-4000-8000-000000000001');
set local role authenticated;
select lives_ok($$select public.admin_resolve_refund_gmail_case_link_review(current_setting('receipt_test.review_id')::uuid,1,
  'ad400000-0000-4000-8000-000000000004')$$,'Supported manager link review retains the pending primary and exact related claim');
reset role;
select is(pg_temp.record_receipt(3)->>'status','recorded','Related claim receives its own exact receipt');
select set_config('request.jwt.claim.role','service_role',true);
select set_config('request.jwt.claims','{"role":"service_role"}',true);
set local role service_role;
select public.service_ingest_refund_gmail_contact_v2(
  repeat('e',64),'receipt-reviewed-shared-thread','receipt-shared-completion','<receipt-completion@example.invalid>',null,
  'outbound',false,'info@bloomjoysweets.com','Bloomjoy','receipt-shared@example.invalid',
  'Two claims update','RF-RECEIPT-3 original123456783 is fully refunded $7.00. RF-RECEIPT-4 remains pending.',false,
  statement_timestamp(),null,'[]'::jsonb,'{}'::text[],array['info@bloomjoysweets.com'],'direct_human',true,false,'{}'::text[],
  '{"payloadRedacted":true}'::jsonb);
reset role;
select is((select status from public.refund_gmail_messages where provider_message_id='receipt-shared-completion'),'sent','Provider SENT ingestion supplies real sent evidence');
select pg_temp.set_receipt_auth('ad000000-0000-4000-8000-000000000001','ad010000-0000-4000-8000-000000000001');
set local role authenticated;
select is(jsonb_array_length(public.admin_get_refund_authoritative_receipt_overview('ad400000-0000-4000-8000-000000000003')->'noticeChoices'),1,
  'Authorized related claim reader discovers its reviewed shared-thread sent notice');
reset role;
select is(public.admin_adopt_refund_completion_notice('ad400000-0000-4000-8000-000000000003',
  (select id from public.refund_authoritative_receipts where refund_case_id='ad400000-0000-4000-8000-000000000003'),
  (select id from public.refund_gmail_messages where provider_message_id='receipt-shared-completion'),
  (select official_action_version from public.refund_cases where id='ad400000-0000-4000-8000-000000000003'),
  'RF-RECEIPT-3','123456783',700,true)->>'status','adopted','Reviewed related claim can adopt exact completion without completing primary');
select is((select refund_case_id::text from public.refund_gmail_threads where provider_thread_id='receipt-reviewed-shared-thread'),
  'ad400000-0000-4000-8000-000000000004','Adoption never rewrites primary thread ownership');
select is((select status from public.refund_cases where id='ad400000-0000-4000-8000-000000000004'),'card_refund_pending','Primary remains pending');
select is((select count(*)::integer from public.refund_completion_notice_adoptions where refund_case_id='ad400000-0000-4000-8000-000000000004'),0,'Pending primary receives no adoption');
select is((select count(*)::integer from public.refund_case_messages where refund_case_id in ('ad400000-0000-4000-8000-000000000003','ad400000-0000-4000-8000-000000000004')),0,'Supported ingestion and related adoption create no outgoing canonical message');

create function pg_temp.receipt_error(p_sql text) returns text language plpgsql as $$
begin execute p_sql; return 'no_error'; exception when others then return sqlstate; end; $$;
select ok(pg_temp.receipt_error($$select public.admin_resolve_refund_nayax_outcome_manager_session(
  'ad400000-0000-4000-8000-000000000002',
  (select id from public.refund_case_nayax_refund_attempts where refund_case_id='ad400000-0000-4000-8000-000000000002'),
  'documented_manual_completion','documented_manual_refund','MANUAL:123456782',statement_timestamp(),
  'manual_nayax_completion',(select official_action_version from public.refund_cases where id='ad400000-0000-4000-8000-000000000002'))$$)<>'no_error',
  'Old dated resolver cannot finalize a receipt-bearing case or create a second notice');
select set_config('request.jwt.claim.role','service_role',true);
select set_config('request.jwt.claims','{"role":"service_role"}',true);
set local role service_role;
select throws_ok($$select public.service_claim_refund_gmail_outbound_v3('ad400000-0000-4000-8000-000000000001',null,
  'forbidden-new-send','info@bloomjoysweets.com','receipt-customer@example.invalid','Do not send',array['info@bloomjoysweets.com'],'completed',null)$$,
  'P4663',null,'Old Gmail claim cannot dispatch after an authoritative receipt');
reset role;
insert into public.refund_case_messages(id,refund_case_id,message_type,status,recipient_email,subject,body)
values('ad810000-0000-4000-8000-000000000009','ad400000-0000-4000-8000-000000000001',
  'manual_note','failed','receipt-customer@example.invalid','Synthetic internal note','Not an outgoing notice');
set local role service_role;
select throws_ok($$select public.service_mark_refund_transactional_delivery_attempt('ad810000-0000-4000-8000-000000000009')$$,
  'P4663',null,'Transactional provider-attempt marking is blocked before any Resend access');
reset role;

-- Sanitized reproduction of the documented ad-hoc batch, not a modern RPC or
-- invented approval. The fingerprint deliberately contains NO account identity.
select pg_temp.set_receipt_auth('ad000000-0000-4000-8000-000000000001','ad010000-0000-4000-8000-000000000001');
-- A historical confirmation predates the held attempt. Apply the actual 0700
-- backfill fields/predicates to this isolated row while every trigger stays on.
insert into public.refund_case_messages(id,refund_case_id,message_type,status,recipient_email,subject,body,sent_at)
values('ad820000-0000-4000-8000-000000000005','ad400000-0000-4000-8000-000000000005',
  'confirmation','sent','receipt-customer@example.invalid','Synthetic original confirmation',
  'Original confirmation; no delivery result was retained.','2026-08-31 12:00:00+00');
update public.refund_case_messages message set delivery_transport='resend',delivery_state='unknown',
  delivery_state_updated_at=coalesce(message.sent_at,message.created_at)
where message.id='ad820000-0000-4000-8000-000000000005' and message.status='sent'
  and message.delivery_transport is null
  and not exists(select 1 from public.refund_cases refund_case where refund_case.id=message.refund_case_id
    and refund_case.case_population='internal_test')
  and not exists(select 1 from public.refund_gmail_messages gmail_message where gmail_message.refund_case_message_id=message.id);
create temporary table historical_receipt_message_before as select to_jsonb(message) as value
from public.refund_case_messages message where id='ad820000-0000-4000-8000-000000000005';
select ok((select status='sent' and sent_at is not null and delivery_transport='resend' and delivery_state='unknown'
  and delivery_state_updated_at=sent_at and provider_message_id is null from public.refund_case_messages
  where id='ad820000-0000-4000-8000-000000000005'),'Historical SENT notice has the exact real 0700 unknown-only backfill shape');
with inserted as (
  insert into public.refund_case_nayax_refund_attempts(refund_case_id,actor_user_id,execution_mode,status,
    idempotency_key,amount_cents,provider_reference,provider_status,request_fingerprint,currency_code,
    provider_outcome,reconciliation_required,safe_transport_stage,safe_failure_class,created_at)
  select c.id,'ad000000-0000-4000-8000-000000000001','manual_portal','manual_review',
    'manual-nayax-portal-20260901-'||c.public_reference,700,c.matched_nayax_transaction_id,'request_accepted',
    encode(extensions.digest(convert_to(c.id::text||'|'||c.matched_nayax_transaction_id||'|700','UTF8'),'sha256'),'hex'),
    'USD','unknown',true,'confirmation_hold','provider_unknown','2026-09-01 18:00:00+00'
  from public.refund_cases c where c.id='ad400000-0000-4000-8000-000000000005'
  returning id,refund_case_id,actor_user_id,created_at
)
insert into public.refund_case_events(refund_case_id,actor_user_id,event_type,message,metadata,created_at)
select refund_case_id,actor_user_id,'manual_nayax_refund_reconciliation_created','Synthetic historical registration',
  jsonb_build_object('attempt_id',id,'provider_outcome','unknown','provider_call_made',true,
    'settlement_confirmation_required',true,'payload_redacted',true),created_at from inserted;
select is(public.admin_get_refund_authoritative_receipt_overview('ad400000-0000-4000-8000-000000000005')->>'attemptBindingKind',
  'legacy_manual_portal_observation','Authorized reader identifies legacy provenance without inventing historical authorization');
select throws_ok($$select pg_temp.record_receipt(5,'{"reviewedCurrent":false}')$$,'P4661',null,'Historical fingerprint does not replace current provider account observation');
select throws_ok($$select pg_temp.record_receipt(5,'{"reviewedCurrent":null}')$$,'P4661',null,'NULL current provider review fails closed');
select throws_ok($$select pg_temp.record_receipt(5,'{"status":63}')$$,'P4661',null,'Pending status63 cannot enter legacy observation lane');
select throws_ok($$select pg_temp.record_receipt(5,'{"scope":"WRONG-CURRENT-ACCOUNT"}')$$,'P4661',null,'Legacy fingerprint does not bypass current account match');
select throws_ok($$select pg_temp.record_receipt(5,'{"machine":"WRONG-CURRENT-MACHINE"}')$$,'P4661',null,'Legacy original cannot bypass current machine mismatch');
select is(pg_temp.corrupt_and_record($$update public.refund_case_nayax_refund_attempts set request_fingerprint=repeat('f',64)
  where refund_case_id='ad400000-0000-4000-8000-000000000005'$$,5),'P4661','Legacy wrong-original fingerprint is rejected');
select is(pg_temp.corrupt_and_record($$update public.refund_case_nayax_refund_attempts set idempotency_key='manual-nayax-portal-20260902-RF-RECEIPT-5'
  where refund_case_id='ad400000-0000-4000-8000-000000000005'$$,5),'P4661','Unrecognized historical batch cannot use legacy path');
select is(pg_temp.corrupt_and_record($$update public.refund_case_nayax_refund_attempts set actor_user_id='ad000000-0000-4000-8000-000000000002'
  where refund_case_id='ad400000-0000-4000-8000-000000000005'$$,5),'P4661','Companion event actor mismatch rejects legacy provenance');
select is(pg_temp.corrupt_and_record($$update public.refund_case_nayax_refund_attempts set created_at='2026-09-01 17:00:00+00'
  where refund_case_id='ad400000-0000-4000-8000-000000000005'$$,5),'P4661','Unrelated companion event timestamp rejects legacy provenance');
select is(pg_temp.corrupt_and_record($$update public.refund_case_nayax_refund_attempts set provider_reference='123456786'
  where refund_case_id='ad400000-0000-4000-8000-000000000005'$$,5),'P4661','Legacy provider reference must identify the exact selected original');
select is(pg_temp.corrupt_and_record($$update public.refund_case_nayax_refund_attempts set id='ad600000-0000-4000-8000-000000000005'
  where refund_case_id='ad400000-0000-4000-8000-000000000005'$$,5),'P4661','Legacy companion event must bind this exact attempt ID');
select is(pg_temp.record_receipt(5)->>'status','recorded','Historical-form registration accepts separately reviewed exact current observation');
select is(pg_temp.record_receipt(5)->>'status','already_recorded','Legacy receipt replay is idempotent');
select ok((select attempt_binding_kind='legacy_manual_portal_observation' and historical_provenance_event_id is not null
    and current_provider_observation_reviewed and settled_at is null from public.refund_authoritative_receipts
    where refund_case_id='ad400000-0000-4000-8000-000000000005'),'Receipt preserves historical provenance separately from current observation and unknown settlement');
select ok((select official_action_authorization_id is null and status='manual_review' and provider_outcome='unknown'
    and reporting_adjustment_id is null from public.refund_case_nayax_refund_attempts
    where refund_case_id='ad400000-0000-4000-8000-000000000005'),'Legacy attempt remains unapproved and unresolved historical evidence');
select is((select count(*)::integer from public.sales_adjustment_facts where refund_case_id='ad400000-0000-4000-8000-000000000005'),0,'Legacy observation creates no dated adjustment');
select is((select count(*)::integer from public.refund_case_messages where refund_case_id='ad400000-0000-4000-8000-000000000005'),1,'Legacy observation retains only its original historical notice and creates no send');
select is((select to_jsonb(message) from public.refund_case_messages message where id='ad820000-0000-4000-8000-000000000005'),
  (select value from historical_receipt_message_before),'Receipt and replay preserve the complete historical SENT unknown row without inventing delivered evidence');
set constraints all immediate;
select * from finish();
rollback;
