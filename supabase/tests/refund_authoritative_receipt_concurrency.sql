-- Disposable database only: committed synthetic rows are required by dblink.
create extension if not exists pgtap with schema extensions;
create extension if not exists dblink with schema extensions;
set search_path=public,extensions;
select extensions.dblink_connect('receipt_race_a','host=db port='||current_setting('port')||
  ' dbname='||current_database()||' user=postgres password=postgres sslmode=disable application_name=receipt_race_a');
select extensions.dblink_connect('receipt_race_b','host=db port='||current_setting('port')||
  ' dbname='||current_database()||' user=postgres password=postgres sslmode=disable application_name=receipt_race_b');
select extensions.dblink_connect('receipt_race_c','host=db port='||current_setting('port')||
  ' dbname='||current_database()||' user=postgres password=postgres sslmode=disable application_name=receipt_race_c');

begin;
create schema refund_receipt_race_test;
create table refund_receipt_race_test.results(lane text primary key,payload jsonb);
create table refund_receipt_race_test.contact_before as
select * from public.refund_customer_contact_settings;
update public.refund_customer_contact_settings set automatic_customer_contact_enabled=true where singleton;
insert into auth.users(instance_id,id,aud,role,email,encrypted_password,email_confirmed_at,raw_app_meta_data,raw_user_meta_data,created_at,updated_at)
values('00000000-0000-0000-0000-000000000000','af000000-0000-4000-8000-000000000001','authenticated','authenticated','receipt-race@example.invalid','',now(),'{}','{}',now(),now());
insert into auth.sessions(id,user_id,created_at,updated_at)
values('af010000-0000-4000-8000-000000000001','af000000-0000-4000-8000-000000000001',now(),now());
insert into public.admin_roles(user_id,role,active) values('af000000-0000-4000-8000-000000000001','super_admin',true);
insert into public.customer_accounts(id,name,account_type) values('af100000-0000-4000-8000-000000000001','Receipt race','internal');
insert into public.reporting_locations(id,account_id,name,timezone)
values('af200000-0000-4000-8000-000000000001','af100000-0000-4000-8000-000000000001','Receipt race','America/Los_Angeles');
insert into public.reporting_machines(id,account_id,location_id,machine_label,nayax_machine_id,nayax_account_key,nayax_refunds_enabled)
values('af300000-0000-4000-8000-000000000001','af100000-0000-4000-8000-000000000001','af200000-0000-4000-8000-000000000001','Receipt race','RECEIPT-RACE-MACHINE','RECEIPT-RACE-ACCOUNT',true);
insert into public.reporting_machine_refund_managers(reporting_machine_id,manager_user_id,manager_email,grant_reason)
values('af300000-0000-4000-8000-000000000001','af000000-0000-4000-8000-000000000001','receipt-race@example.invalid','Synthetic receipt race');
insert into public.refund_cases(id,public_reference,reporting_machine_id,reporting_location_id,customer_email,issue_summary,
  incident_at,payment_method,payment_amount_cents,refund_amount_cents,card_last4,status,correlation_status,correlation_source,
  correlation_confidence,automation_state,matched_nayax_transaction_id,matched_nayax_amount_cents,matched_nayax_currency_code,
  matched_nayax_machine_auth_time,lifecycle_integrity_status,lifecycle_integrity_code,lifecycle_integrity_detected_at)
select ('af400000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid,'RF-RECEIPT-RACE-'||n,
  'af300000-0000-4000-8000-000000000001','af200000-0000-4000-8000-000000000001','receipt-race-customer@example.invalid',
  'Synthetic receipt race',now()-interval '3 days','card',700,700,'4242','card_refund_pending','matched','nayax',1,'approved',
  (223456780+n)::text,700,'USD',now()-interval '3 days',case when n=2 then 'ok' else 'hold' end,
  case when n=2 then null else 'card_payment_state_without_attempt' end,case when n=2 then null else now() end
from generate_series(1,2) n;
update public.refund_cases set status='needs_review',nayax_recommendation_state='high_confidence',
  nayax_recommendation_policy_version='2026-07-21.v1',nayax_match_execution_eligible=true,matched_nayax_site_id=97102,
  matched_nayax_card_last4='4242',nayax_refund_execution_status='not_requested'
where id='af400000-0000-4000-8000-000000000002';
insert into public.refund_case_events(refund_case_id,actor_user_id,event_type,message,metadata)
values('af400000-0000-4000-8000-000000000002','af000000-0000-4000-8000-000000000001','nayax_match_selected','Synthetic selection','{"payload_redacted":true}');
create function refund_receipt_race_test.authorize() returns void language plpgsql as $$ begin
  perform set_config('request.jwt.claim.sub','af000000-0000-4000-8000-000000000001',true);
  perform set_config('request.jwt.claim.role','authenticated',true);
  perform set_config('request.jwt.claims','{"sub":"af000000-0000-4000-8000-000000000001","role":"authenticated","session_id":"af010000-0000-4000-8000-000000000001","is_anonymous":false}',true);
end; $$;
select refund_receipt_race_test.authorize();
select public.admin_begin_refund_manual_nayax_portal('af400000-0000-4000-8000-000000000002',
  (select official_action_version from public.refund_cases where id='af400000-0000-4000-8000-000000000002'));
insert into public.refund_gmail_threads(id,refund_case_id,mailbox_hash,provider_thread_id,thread_subject,first_message_at,latest_message_at,retention_expires_at)
values('af700000-0000-4000-8000-000000000001','af400000-0000-4000-8000-000000000001',repeat('f',64),'receipt-race-thread','Synthetic already-sent notice',now()-interval '1 day',now(),now()+interval '30 days');
insert into public.refund_gmail_messages(id,gmail_thread_id,refund_case_id,provider_message_id,operation_key,direction,message_kind,status,sender_email,recipient_email,subject,plain_body,sent_at,retention_expires_at,received_at)
values('af800000-0000-4000-8000-000000000001','af700000-0000-4000-8000-000000000001','af400000-0000-4000-8000-000000000001',
  'receipt-race-sent','imported:receipt-race-sent','outbound','message','sent','info@bloomjoysweets.com','receipt-race-customer@example.invalid',
  'Synthetic refund confirmation','RF-RECEIPT-RACE-1 original223456781 is fully refunded $7.00.',now()-interval '1 hour',now()+interval '30 days',now()-interval '1 hour');
-- Seed stored historical work, not a newly authorized customer request. Only
-- fixture construction bypasses the new-cycle/source-message insertion guards;
-- restore them before every actual RPC, baseline control, and overlap test.
alter table public.refund_follow_up_cycles disable trigger refund_follow_up_cycles_guard;
insert into public.refund_follow_up_cycles(id,refund_case_id,cycle_number,trigger_fingerprint,
  reason_code,requested_fields,template_version,case_fact_version,reminder_delay_hours,
  status,request_message_id,request_created_at,request_sent_at,reminder_due_at)
values('af910000-0000-4000-8000-000000000001','af400000-0000-4000-8000-000000000001',1,repeat('a',64),
  'missing_information',array['amount'],'refund_follow_up_v1',1,72,'waiting',
  'af920000-0000-4000-8000-000000000001',now()-interval '4 days',now()-interval '4 days',now()-interval '1 day');
alter table public.refund_follow_up_cycles enable trigger refund_follow_up_cycles_guard;
alter table public.refund_case_messages disable trigger refund_case_messages_follow_up_guard;
alter table public.refund_case_messages disable trigger refund_case_messages_follow_up_sync;
alter table public.refund_case_messages disable trigger zz_refund_case_messages_waiting_truth_sync;
insert into public.refund_case_messages(id,refund_case_id,message_type,status,recipient_email,subject,body,
  delivery_kind,content_source,reason_code,template_version,follow_up_cycle_id,requested_fields,
  created_at,sent_at,delivery_transport,delivery_state,delivery_state_updated_at)
values('af920000-0000-4000-8000-000000000001','af400000-0000-4000-8000-000000000001',
  'more_info','sent','receipt-race-customer@example.invalid','Historical request','Historical request',
  'automatic','deterministic_template','missing_information','refund_follow_up_v1',
  'af910000-0000-4000-8000-000000000001',array['amount'],now()-interval '4 days',now()-interval '4 days',
  'resend','unknown',now()-interval '4 days');
alter table public.refund_case_messages enable trigger refund_case_messages_follow_up_guard;
alter table public.refund_case_messages enable trigger refund_case_messages_follow_up_sync;
alter table public.refund_case_messages enable trigger zz_refund_case_messages_waiting_truth_sync;
insert into public.refund_case_messages(id,refund_case_id,message_type,status,recipient_email,subject,body,
  created_at,sent_at,delivery_transport,delivery_state,delivery_state_updated_at)
values('af920000-0000-4000-8000-000000000002','af400000-0000-4000-8000-000000000001',
  'confirmation','sent','receipt-race-customer@example.invalid','Historical payout request','Historical payout request',
  now()-interval '4 days',now()-interval '4 days','resend','unknown',now()-interval '4 days');
insert into public.refund_payout_destination_follow_ups(id,refund_case_id,request_message_id,reminder_delay_hours,
  reminder_due_at,status,reminder_message_id,reminder_sent_at,escalation_due_at)
values('af930000-0000-4000-8000-000000000001','af400000-0000-4000-8000-000000000001',
  'af920000-0000-4000-8000-000000000002',48,now()-interval '2 days','reminder_sent',
  'af920000-0000-4000-8000-000000000002',now()-interval '2 days',now()-interval '1 day');
insert into public.refund_automation_runs(id,run_key,trigger_source,status)
values('af940000-0000-4000-8000-000000000001','receipt-race-eligibility','manual','running');
create function refund_receipt_race_test.work_snapshot() returns jsonb language sql as $$
  select jsonb_build_object(
    'cycles',(select jsonb_agg(to_jsonb(c) order by id) from public.refund_follow_up_cycles c
      where refund_case_id='af400000-0000-4000-8000-000000000001'),
    'payouts',(select jsonb_agg(to_jsonb(p) order by id) from public.refund_payout_destination_follow_ups p
      where refund_case_id='af400000-0000-4000-8000-000000000001'),
    'messages',(select jsonb_agg(to_jsonb(m) order by id) from public.refund_case_messages m
      where refund_case_id='af400000-0000-4000-8000-000000000001'),
    'actions',(select jsonb_agg(to_jsonb(a) order by id) from public.refund_automation_actions a
      where refund_case_id='af400000-0000-4000-8000-000000000001'));
$$;
create function refund_receipt_race_test.run(p_action text,n integer) returns jsonb language plpgsql as $$
declare c public.refund_cases%rowtype; a uuid; r uuid;
begin
  perform refund_receipt_race_test.authorize();
  select * into c from public.refund_cases where id=('af400000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid;
  select id into a from public.refund_case_nayax_refund_attempts where refund_case_id=c.id order by created_at desc limit 1;
  if p_action='record' then
    return public.admin_record_refund_authoritative_receipt(c.id,a,c.official_action_version,'RECEIPT-RACE-ACCOUNT','RECEIPT-RACE-MACHINE',
      c.matched_nayax_transaction_id,700,700,'USD',62,'DTM:NAYAX-'||c.matched_nayax_transaction_id,true);
  elsif p_action='adopt' then
    select id into r from public.refund_authoritative_receipts where refund_case_id=c.id;
    return public.admin_adopt_refund_completion_notice(c.id,r,'af800000-0000-4000-8000-000000000001',c.official_action_version,
      c.public_reference,c.matched_nayax_transaction_id,700,true);
  elsif p_action='queue' then
    select id into r from public.refund_authoritative_receipts where refund_case_id=c.id;
    return public.admin_queue_refund_receipt_completion(c.id,r,c.official_action_version,gen_random_uuid(),true,
      public.admin_get_refund_authoritative_receipt_overview(c.id)#>>'{completionNotice,reviewBinding}');
  elsif p_action='old_resolver' then
    return public.admin_resolve_refund_nayax_outcome_manager_session(c.id,a,'documented_manual_completion','documented_manual_refund',
      'MANUAL:RECEIPT-RACE',statement_timestamp(),'manual_nayax_completion',c.official_action_version);
  end if;
  raise exception 'Unexpected test action';
exception when others then return jsonb_build_object('error',sqlstate,'message',sqlerrm);
end; $$;
create function refund_receipt_race_test.wait_for_blocked_b(p_application text default 'receipt_race_b') returns boolean language plpgsql as $$ begin
  for i in 1..100 loop
    perform pg_stat_clear_snapshot();
    if exists(select 1 from pg_stat_activity where application_name=p_application and wait_event_type='Lock') then return true; end if;
    perform pg_sleep(0.01);
  end loop;
  return false;
end; $$;
commit;
select no_plan();
select is(public.service_authorize_refund_manager_aging_notice(
  'af400000-0000-4000-8000-000000000001',
  (select attention_version from public.refund_manager_attention_states
    where refund_case_id='af400000-0000-4000-8000-000000000001'),
  'escalation',statement_timestamp()+interval '20 days','America/Los_Angeles',2,5,
  'refund_manager_aging_v1')->>'authorized','true','Unreceipted old manager milestone is genuinely eligible');
select is((select count(*)::integer from public.service_list_due_refund_manager_aging_notices(
  statement_timestamp()+interval '20 days','America/Los_Angeles',2,5,'refund_manager_aging_v1',100)
  where refund_case_id='af400000-0000-4000-8000-000000000001'),1,
  'Manager selector actually includes the unresolved old attention state');
-- Positive controls ensure the stored rows are actually due and executable.
-- Roll back only the isolated baseline connection, not pgTAP's bookkeeping.
select extensions.dblink_exec('receipt_race_b','begin');
select is((select jsonb_array_length(payload->'reminders') from extensions.dblink('receipt_race_b',
  'select public.service_claim_due_refund_follow_up_reminders(25)') as x(payload jsonb)),1,
  'Historical due request is actually claimable before receipt or parent lock');
select extensions.dblink_exec('receipt_race_b','rollback');
select extensions.dblink_exec('receipt_race_b','begin');
select is((select payload->>'escalated' from extensions.dblink('receipt_race_b',
  'select public.service_claim_due_refund_payout_destination_follow_ups(25)') as x(payload jsonb)),'1',
  'Historical unanswered payout is actually eligible before receipt or parent lock');
select extensions.dblink_exec('receipt_race_b','rollback');
insert into refund_receipt_race_test.results values('historical_work_before',refund_receipt_race_test.work_snapshot());
select ok(public.refund_nayax_resolution_reference_is_safe('MANUAL:RECEIPT-RACE','documented_manual_refund'),
  'Resolver race uses a safe synthetic evidence reference without prohibited numeric identity');

-- B reaches the real row lock before A records; B then observes durable replay.
select extensions.dblink_exec('receipt_race_a','begin');
select * from extensions.dblink('receipt_race_a',$q$select id::text from public.refund_cases where id='af400000-0000-4000-8000-000000000001' for update$q$) as x(id text);
-- A real receipt is inserted but remains invisible to the other connection.
-- The candidate anti-join alone would miss it; the parent lock must stop work.
insert into refund_receipt_race_test.results select 'record_uncommitted',payload
from extensions.dblink('receipt_race_a',$q$select refund_receipt_race_test.run('record',1)$q$) as x(payload jsonb);
select diag(payload::text) from refund_receipt_race_test.results
where lane='record_uncommitted' and payload->>'status' is distinct from 'recorded';
select is((select payload->>'status' from refund_receipt_race_test.results where lane='record_uncommitted'),
  'recorded','Actual receipt RPC owns an uncommitted original-bound receipt');
select is((select count(*)::integer from public.refund_authoritative_receipts
  where refund_case_id='af400000-0000-4000-8000-000000000001'),0,'Receipt is genuinely uncommitted during scheduler overlap');
select extensions.dblink_exec('receipt_race_b', 'set statement_timeout=''2000ms''');
select is((select jsonb_array_length(payload->'reminders') from extensions.dblink('receipt_race_b',
  'select public.service_claim_due_refund_follow_up_reminders(25)') as x(payload jsonb)),0,
  'Due reminder skips a parent owned by uncommitted receipt without blocking or claiming');
select is((select payload->>'escalated' from extensions.dblink('receipt_race_b',
  'select public.service_claim_due_refund_payout_destination_follow_ups(25)') as x(payload jsonb)),'0',
  'Payout escalation skips uncommitted receipt without changing the cycle or case');
select is((select payload->>'reason' from extensions.dblink('receipt_race_b',$q$
  select public.service_claim_refund_follow_up_customer_reply('af400000-0000-4000-8000-000000000001',
    'af910000-0000-4000-8000-000000000001')$q$) as x(payload jsonb)),'case_busy',
  'Reply recheck preserves cycle-first order and safely skips the locked parent');
select is(refund_receipt_race_test.work_snapshot(),
  (select payload from refund_receipt_race_test.results where lane='historical_work_before'),
  'Overlapping scheduler calls preserve complete historical cycles, messages, and action ledger');
select extensions.dblink_exec('receipt_race_c', 'set statement_timeout=''5000ms''');
select extensions.dblink_send_query('receipt_race_c',$q$select public.service_claim_refund_automation_action(
  'af940000-0000-4000-8000-000000000001','af400000-0000-4000-8000-000000000001',
  'receipt-race:provider-delay','customer_status_update')$q$);
select ok(refund_receipt_race_test.wait_for_blocked_b('receipt_race_c'),
  'Already-selected central action is genuinely waiting behind receipt transaction');
select extensions.dblink_send_query('receipt_race_b',$q$select refund_receipt_race_test.run('record',1)$q$);
select ok(refund_receipt_race_test.wait_for_blocked_b(),'Concurrent recorder is verified waiting on the same case lock');
insert into refund_receipt_race_test.results select 'record_a',payload from extensions.dblink('receipt_race_a',$q$select refund_receipt_race_test.run('record',1)$q$) as x(payload jsonb);
select extensions.dblink_exec('receipt_race_a','commit');
insert into refund_receipt_race_test.results select 'obsolete_action',payload
from extensions.dblink_get_result('receipt_race_c') as x(payload jsonb);
select * from extensions.dblink_get_result('receipt_race_c') as x(payload jsonb);
select is((select payload from refund_receipt_race_test.results where lane='obsolete_action'),
  '{"actionId":null,"claimed":false,"status":"not_eligible","reasonCategory":"authoritative_refund_receipt"}'::jsonb,
  'Waiting central action rechecks committed receipt and writes no claimed or failed row');
insert into refund_receipt_race_test.results select 'record_b',payload from extensions.dblink_get_result('receipt_race_b') as x(payload jsonb);
select * from extensions.dblink_get_result('receipt_race_b') as x(payload jsonb);
select is((select payload->>'status' from refund_receipt_race_test.results where lane='record_a'),'already_recorded','First recorder sees its own single uncommitted receipt');
select is((select payload->>'status' from refund_receipt_race_test.results where lane='record_b'),'already_recorded','Concurrent recorder observes one durable receipt');
select is(jsonb_array_length(public.service_claim_due_refund_follow_up_reminders(25)->'reminders'),0,
  'Committed receipt excludes preserved historical reminder');
select is(public.service_claim_due_refund_payout_destination_follow_ups(25)->>'escalated','0',
  'Committed receipt excludes preserved historical payout escalation');
select is(public.service_claim_refund_follow_up_customer_reply('af400000-0000-4000-8000-000000000001',
  'af910000-0000-4000-8000-000000000001')->>'reason','authoritative_refund_receipt',
  'Committed receipt declines reply recheck without rewriting the historical cycle');
select is(public.service_authorize_refund_manager_aging_notice('af400000-0000-4000-8000-000000000001',
  (select attention_version from public.refund_manager_attention_states
    where refund_case_id='af400000-0000-4000-8000-000000000001'),
  'escalation',statement_timestamp()+interval '20 days','America/Los_Angeles',2,5,
  'refund_manager_aging_v1')->>'reason','authoritative_refund_receipt',
  'Committed receipt removes old manager payment-aging authority');
select is((select count(*)::integer from public.service_list_due_refund_manager_aging_notices(
  statement_timestamp()+interval '20 days','America/Los_Angeles',2,5,'refund_manager_aging_v1',100)
  where refund_case_id='af400000-0000-4000-8000-000000000001'),0,
  'Committed receipt is excluded before manager-aging candidate limit');
select is(refund_receipt_race_test.work_snapshot(),
  (select payload from refund_receipt_race_test.results where lane='historical_work_before'),
  'Post-commit scheduler calls leave historical work exactly unchanged');

-- The old dated resolver is already waiting when the new receipt commits.
-- Its post-lock capability check sees the receipt and rejects the old action
-- before the later storage-effect guard would be reached.
select extensions.dblink_exec('receipt_race_a','begin');
select * from extensions.dblink('receipt_race_a',$q$select id::text from public.refund_cases where id='af400000-0000-4000-8000-000000000002' for update$q$) as x(id text);
select extensions.dblink_send_query('receipt_race_b',$q$select refund_receipt_race_test.run('old_resolver',2)$q$);
select ok(refund_receipt_race_test.wait_for_blocked_b(),'Old resolver is verified waiting while receipt owns the case lock');
insert into refund_receipt_race_test.results select 'receipt_wins',payload from extensions.dblink('receipt_race_a',$q$select refund_receipt_race_test.run('record',2)$q$) as x(payload jsonb);
select extensions.dblink_exec('receipt_race_a','commit');
insert into refund_receipt_race_test.results select 'resolver_loses',payload from extensions.dblink_get_result('receipt_race_b') as x(payload jsonb);
select * from extensions.dblink_get_result('receipt_race_b') as x(payload jsonb);
select is((select payload->>'status' from refund_receipt_race_test.results where lane='receipt_wins'),'recorded','Receipt winner is committed');
select diag((select payload::text from refund_receipt_race_test.results where lane='resolver_loses'));
select is((select payload->>'error' from refund_receipt_race_test.results where lane='resolver_loses'),'P0001','Waiting old resolver is rejected by the post-lock official-action capability check');
select is((select payload->>'message' from refund_receipt_race_test.results where lane='resolver_loses'),
  'Active Machine Manager mapping required','Resolver denial is the exact receipt-aware capability error, not an unrelated fixture failure');
select ok(not public.can_perform_refund_official_action('af000000-0000-4000-8000-000000000001','af400000-0000-4000-8000-000000000002'),
  'Committed receipt revokes the old payment action even for the still-mapped manager');

select extensions.dblink_exec('receipt_race_a','begin');
select * from extensions.dblink('receipt_race_a',$q$select id::text from public.refund_cases where id='af400000-0000-4000-8000-000000000001' for update$q$) as x(id text);
select extensions.dblink_send_query('receipt_race_b',$q$select refund_receipt_race_test.run('adopt',1)$q$);
select ok(refund_receipt_race_test.wait_for_blocked_b(),'Concurrent adopter waits on the exact receipt case lock');
insert into refund_receipt_race_test.results select 'adopt_a',payload from extensions.dblink('receipt_race_a',$q$select refund_receipt_race_test.run('adopt',1)$q$) as x(payload jsonb);
select extensions.dblink_exec('receipt_race_a','commit');
insert into refund_receipt_race_test.results select 'adopt_b',payload from extensions.dblink_get_result('receipt_race_b') as x(payload jsonb);
select * from extensions.dblink_get_result('receipt_race_b') as x(payload jsonb);
select is((select payload->>'status' from refund_receipt_race_test.results where lane='adopt_a'),'adopted','One adopter commits');
select is((select payload->>'status' from refund_receipt_race_test.results where lane='adopt_b'),'already_adopted','Concurrent adopter is an idempotent replay');
select is((select count(*)::integer from public.refund_authoritative_receipts where reporting_machine_id='af300000-0000-4000-8000-000000000001'),2,'Exactly one receipt per case');
select is((select count(*)::integer from public.refund_completion_notice_adoptions where refund_case_id='af400000-0000-4000-8000-000000000001'),1,'Exactly one notice adoption');
select is((select count(*)::integer from public.refund_case_messages where refund_case_id in ('af400000-0000-4000-8000-000000000001','af400000-0000-4000-8000-000000000002')),2,'Races preserve two historical messages and create no customer-send intent');
select is((select count(*)::integer from public.sales_adjustment_facts where refund_case_id in ('af400000-0000-4000-8000-000000000001','af400000-0000-4000-8000-000000000002')),0,'Races create no dated accounting adjustment');
select ok((select bool_and(refund_completed_at is null) from public.refund_cases where reporting_machine_id='af300000-0000-4000-8000-000000000001'),'Races never fabricate settlement time');
select is((select count(*)::integer from public.refund_case_nayax_refund_attempts where refund_case_id='af400000-0000-4000-8000-000000000001'),0,'No-attempt race creates no attempt');
select is((select status from public.refund_case_nayax_refund_attempts where refund_case_id='af400000-0000-4000-8000-000000000002'),'manual_review','Old attempt stays historical rather than finalized');
-- Candidate-page regression: stored historical rows are intentionally staged
-- directly, but every confirmed receipt uses the real original-bound RPC.
insert into public.refund_cases(id,public_reference,reporting_machine_id,reporting_location_id,customer_email,issue_summary,
  incident_at,payment_method,payment_amount_cents,refund_amount_cents,card_last4,status,correlation_status,correlation_source,
  correlation_confidence,automation_state,matched_nayax_transaction_id,matched_nayax_amount_cents,matched_nayax_currency_code,
  matched_nayax_machine_auth_time,lifecycle_integrity_status,lifecycle_integrity_code,lifecycle_integrity_detected_at)
select ('af400000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid,'RF-RECEIPT-RACE-'||n,
  'af300000-0000-4000-8000-000000000001','af200000-0000-4000-8000-000000000001','receipt-race-customer@example.invalid',
  'Synthetic bounded-page regression',now()-interval '3 days','card',700,700,'4242','card_refund_pending','matched','nayax',1,'approved',
  (223456780+n)::text,700,'USD',now()-interval '3 days','hold','card_payment_state_without_attempt',now()
from generate_series(3,28) n;
begin;
alter table public.refund_follow_up_cycles disable trigger refund_follow_up_cycles_guard;
insert into public.refund_follow_up_cycles(id,refund_case_id,cycle_number,trigger_fingerprint,
  reason_code,requested_fields,template_version,case_fact_version,reminder_delay_hours,status,request_sent_at)
select ('af910000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid,
  ('af400000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid,1,repeat('b',64),
  'missing_information',array['amount'],'refund_follow_up_v1',1,72,'waiting',
  case when n=28 then now()-interval '1 day' else now()-interval '5 days' end
from generate_series(3,28) n;
alter table public.refund_follow_up_cycles enable trigger refund_follow_up_cycles_guard;
commit;
select is((select count(*)::integer from public.service_list_refund_follow_up_customer_reply_candidates(25)),25,
  'Full oldest page exists before receipt exclusion');
select is((select count(*)::integer from public.service_list_refund_follow_up_customer_reply_candidates(25)
  where refund_case_id='af400000-0000-4000-8000-000000000028'),0,
  'Positive-control newer unresolved reply starts behind the entire oldest page');
select is(refund_receipt_race_test.run('record',n)->>'status','recorded',
  'Old candidate '||n||' receives an actual authoritative receipt') from generate_series(3,27) n;
select is((select count(*)::integer from public.service_list_refund_follow_up_customer_reply_candidates(25)),1,
  'Twenty-five receipt-backed cycles do not consume the bounded reply page');
select is((select jsonb_agg(refund_case_id order by refund_case_id)
  from public.service_list_refund_follow_up_customer_reply_candidates(25)),
  '["af400000-0000-4000-8000-000000000028"]'::jsonb,
  'Newer unresolved reply is still discovered behind a full receipt-backed page');
-- Two independently submitted intents serialize on the same case and resolve
-- to one durable outbox row. A worker skips the uncommitted case entirely.
select extensions.dblink_exec('receipt_race_a','begin');
select * from extensions.dblink('receipt_race_a',$q$select id::text from public.refund_cases where id='af400000-0000-4000-8000-000000000002' for update$q$) as x(id text);
select extensions.dblink_send_query('receipt_race_b',$q$select refund_receipt_race_test.run('queue',2)$q$);
select ok(refund_receipt_race_test.wait_for_blocked_b(),'Second receipt intent waits for the case lock');
insert into refund_receipt_race_test.results select 'queue_winner',payload from extensions.dblink('receipt_race_a',
  $q$select refund_receipt_race_test.run('queue',2)$q$) as x(payload jsonb);
select is((select payload->>'enqueued' from refund_receipt_race_test.results where lane='queue_winner'),'true','First receipt intent queues successfully');
select is((select n from extensions.dblink('receipt_race_c',
  'select count(*)::integer from public.service_claim_refund_manual_message_deliveries(null,25)') as x(n integer)),0,
  'Worker skips a case with an uncommitted receipt intent');
select extensions.dblink_exec('receipt_race_a','commit');
insert into refund_receipt_race_test.results select 'queue_replay',payload from extensions.dblink_get_result('receipt_race_b') as x(payload jsonb);
select * from extensions.dblink_get_result('receipt_race_b') as x(payload jsonb);
select is((select payload->>'replayed' from refund_receipt_race_test.results where lane='queue_replay'),'true','Waiting second intent replays the original');
select is((select payload->>'messageId' from refund_receipt_race_test.results where lane='queue_winner'),
  (select payload->>'messageId' from refund_receipt_race_test.results where lane='queue_replay'),'Concurrent intents return the same message');
select is((select count(*)::integer from public.refund_case_messages where refund_case_id='af400000-0000-4000-8000-000000000002'
  and template_version='refund_receipt_completion_v1'),1,'Exactly one completion message survives concurrent enqueue');
create table refund_receipt_race_test.completion_claim as select * from public.service_claim_refund_manual_message_deliveries(
  (select message_id from public.refund_receipt_completion_intents where refund_case_id='af400000-0000-4000-8000-000000000002'),1);
select is((select count(*)::integer from refund_receipt_race_test.completion_claim),1,'Committed completion can be claimed once');
select public.service_mark_refund_manual_message_provider_attempt(refund_case_message_id,claim_token) from refund_receipt_race_test.completion_claim;
select public.service_mark_refund_transactional_delivery_attempt(refund_case_message_id) from refund_receipt_race_test.completion_claim;

-- Transport binding and later delivery events wait on the case before taking
-- the message lock. The competing case owner can still lock that message.
select extensions.dblink_exec('receipt_race_a','begin');
select * from extensions.dblink('receipt_race_a',$q$select id::text from public.refund_cases where id='af400000-0000-4000-8000-000000000002' for update$q$) as x(id text);
select extensions.dblink_send_query('receipt_race_b',$q$select public.service_bind_refund_transactional_delivery(
  (select refund_case_message_id from refund_receipt_race_test.completion_claim),'receipt_race_completion_2',now())$q$);
select ok(refund_receipt_race_test.wait_for_blocked_b(),'Provider binding waits on the case');
select extensions.dblink_exec('receipt_race_a','set local lock_timeout=''300ms''');
select is((select n from extensions.dblink('receipt_race_a',$q$select count(*)::integer from (select id from public.refund_case_messages
  where id=(select refund_case_message_id from refund_receipt_race_test.completion_claim) for update) locked$q$) as x(n integer)),1,
  'Waiting provider binding has not acquired the message lock first');
select extensions.dblink_exec('receipt_race_a','commit');
select * from extensions.dblink_get_result('receipt_race_b') as x(payload jsonb);
select * from extensions.dblink_get_result('receipt_race_b') as x(payload jsonb);
select extensions.dblink_exec('receipt_race_a','begin');
select * from extensions.dblink('receipt_race_a',$q$select id::text from public.refund_cases where id='af400000-0000-4000-8000-000000000002' for update$q$) as x(id text);
select extensions.dblink_send_query('receipt_race_b',$q$select public.apply_refund_transactional_delivery_events('receipt_race_completion_2')$q$);
select ok(refund_receipt_race_test.wait_for_blocked_b(),'Delivery event application waits on the case');
select extensions.dblink_exec('receipt_race_a','set local lock_timeout=''300ms''');
select is((select n from extensions.dblink('receipt_race_a',$q$select count(*)::integer from (select id from public.refund_case_messages
  where id=(select refund_case_message_id from refund_receipt_race_test.completion_claim) for update) locked$q$) as x(n integer)),1,
  'Waiting delivery event has not acquired the message lock first');
select extensions.dblink_exec('receipt_race_a','commit');
select * from extensions.dblink_get_result('receipt_race_b') as x(payload jsonb);
select * from extensions.dblink_get_result('receipt_race_b') as x(payload jsonb);
select extensions.dblink_disconnect('receipt_race_a');
select extensions.dblink_disconnect('receipt_race_b');
select extensions.dblink_disconnect('receipt_race_c');

-- Restore all guards in the same transaction while removing only named fixtures.
begin;
alter table public.refund_customer_contact_settings disable trigger refund_customer_contact_settings_set_updated_at;
update public.refund_customer_contact_settings settings
set automatic_customer_contact_enabled=original.automatic_customer_contact_enabled,updated_at=original.updated_at
from refund_receipt_race_test.contact_before original where settings.singleton=original.singleton;
alter table public.refund_customer_contact_settings enable trigger refund_customer_contact_settings_set_updated_at;
select is((select to_jsonb(settings) from public.refund_customer_contact_settings settings),
  (select to_jsonb(original) from refund_receipt_race_test.contact_before original),
  'Fixture cleanup restores the complete original contact-settings row');
alter table public.refund_completion_notice_adoptions disable trigger refund_completion_notice_adoptions_immutable;
alter table public.refund_authoritative_receipts disable trigger refund_authoritative_receipts_immutable;
alter table public.refund_receipt_completion_intents disable trigger refund_receipt_completion_intents_immutable;
alter table public.refund_case_messages disable trigger aa_refund_receipt_completion_identity;
delete from public.refund_receipt_completion_intents where refund_case_id='af400000-0000-4000-8000-000000000002';
alter table public.refund_receipt_completion_intents enable trigger refund_receipt_completion_intents_immutable;
delete from public.refund_completion_notice_adoptions where refund_case_id='af400000-0000-4000-8000-000000000001';
delete from public.refund_authoritative_receipts where reporting_machine_id='af300000-0000-4000-8000-000000000001';
delete from public.refund_case_messages where refund_case_id='af400000-0000-4000-8000-000000000002' and template_version='refund_receipt_completion_v1';
set constraints all immediate;
alter table public.refund_case_messages enable trigger aa_refund_receipt_completion_identity;
alter table public.refund_completion_notice_adoptions enable trigger refund_completion_notice_adoptions_immutable;
alter table public.refund_authoritative_receipts enable trigger refund_authoritative_receipts_immutable;
delete from public.refund_gmail_messages where gmail_thread_id='af700000-0000-4000-8000-000000000001';
delete from public.refund_gmail_threads where id='af700000-0000-4000-8000-000000000001';
delete from public.refund_payout_destination_follow_ups where id='af930000-0000-4000-8000-000000000001';
delete from public.refund_case_messages where id in ('af920000-0000-4000-8000-000000000001','af920000-0000-4000-8000-000000000002');
delete from public.refund_follow_up_cycles where refund_case_id in
  (select id from public.refund_cases where reporting_machine_id='af300000-0000-4000-8000-000000000001');
delete from public.refund_automation_runs where id='af940000-0000-4000-8000-000000000001';
delete from public.refund_case_nayax_refund_attempts where refund_case_id='af400000-0000-4000-8000-000000000002';
delete from public.refund_case_official_action_authorizations where refund_case_id='af400000-0000-4000-8000-000000000002';
delete from public.refund_cases where reporting_machine_id='af300000-0000-4000-8000-000000000001';
delete from public.reporting_machine_refund_managers where reporting_machine_id='af300000-0000-4000-8000-000000000001';
delete from public.reporting_machines where id='af300000-0000-4000-8000-000000000001';
delete from public.reporting_locations where id='af200000-0000-4000-8000-000000000001';
delete from public.customer_accounts where id='af100000-0000-4000-8000-000000000001';
delete from auth.users where id='af000000-0000-4000-8000-000000000001';
drop schema refund_receipt_race_test cascade;
commit;
select * from finish();
