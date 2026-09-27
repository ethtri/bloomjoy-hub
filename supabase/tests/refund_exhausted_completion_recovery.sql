begin;
create extension if not exists pgtap with schema extensions;
set local search_path=public,extensions;
select no_plan();

insert into public.refund_nayax_provider_callers(caller_id,assertion_digest,status)
values('nayax-card-refund',encode(extensions.digest(convert_to(
  'synthetic-exhausted-recovery-executor','UTF8'),'sha256'),'hex'),'active')
on conflict(caller_id) do update set assertion_digest=excluded.assertion_digest,status='active';

insert into public.customer_accounts(id,name,account_type)
values('e5240000-0000-4000-8000-000000000001','Exhausted completion recovery','internal');
insert into public.reporting_locations(id,account_id,name,timezone)
values('e5240000-0000-4000-8000-000000000002','e5240000-0000-4000-8000-000000000001',
  'Recovery fixture','America/Los_Angeles');
insert into public.reporting_machines(id,account_id,location_id,machine_label,status)
values('e5240000-0000-4000-8000-000000000003','e5240000-0000-4000-8000-000000000001',
  'e5240000-0000-4000-8000-000000000002','Recovery fixture','active');
insert into public.refund_cases(id,public_reference,reporting_machine_id,reporting_location_id,
  customer_email,issue_summary,incident_at,payment_method,payment_amount_cents,
  refund_amount_cents,status,decision,refund_completed_at,correlation_status,
  correlation_source,correlation_confidence,automation_state,
  nayax_refund_execution_status,nayax_match_execution_eligible,
  matched_nayax_transaction_id,matched_nayax_machine_auth_time,
  matched_nayax_amount_cents,matched_nayax_currency_code,matched_nayax_site_id)
select ('e5240000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid,
  'RF-EXHAUSTED-'||n,'e5240000-0000-4000-8000-000000000003',
  'e5240000-0000-4000-8000-000000000002',
  'recover-'||n||'@example.invalid','Synthetic recovery',
  (date '2017-02-01'+n+time '12:00')::timestamp,
  'card',500,500,'completed','approved',statement_timestamp(),
  'matched','nayax',1,'completed','approved',false,
  'EXHAUSTED-TXN-'||n,(date '2017-02-01'+n+time '12:00')::timestamp,
  500,'USD',7001 from generate_series(1,3) n;
insert into public.sales_adjustment_facts(id,reporting_machine_id,
  reporting_location_id,adjustment_date,adjustment_type,amount_cents,
  complaint_count,source,source_row_hash,source_reference,
  source_row_reference,refund_case_id,match_status,match_confidence,
  notes,raw_payload)
select ('e5250000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid,
  'e5240000-0000-4000-8000-000000000003',
  'e5240000-0000-4000-8000-000000000002',current_date,'refund',500,1,
  'refund_case','exhausted-adjustment-'||n,'refund_cases','RF-EXHAUSTED-'||n,
  ('e5240000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid,
  'applied',1,'Synthetic committed recovery',jsonb_build_object(
    'refund_case_id',('e5240000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid,
    'refund_case_reference','RF-EXHAUSTED-'||n,
    'refund_case_status','completed','refund_case_decision','approved',
    'payment_method','card','correlation_source','nayax',
    'correlation_has_card_lookup',true,'payload_redacted',true))
from generate_series(1,3) n;
update public.refund_cases c set reporting_adjustment_id=a.id
from public.sales_adjustment_facts a where a.refund_case_id=c.id
  and c.public_reference like 'RF-EXHAUSTED-%';
insert into public.refund_case_nayax_refund_attempts(id,refund_case_id,
  execution_mode,status,idempotency_key,amount_cents,provider_reference,
  provider_status,sanitized_response,provider_outcome,
  provider_outcome_recorded_at,reconciliation_required,reporting_adjustment_id,
  case_finalization_committed_at,completed_at,completion_delivery_status,
  completion_delivery_retry_count,completion_delivery_attempted_at)
select ('e5260000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid,
  ('e5240000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid,
  'request_and_approve','succeeded','exhausted-attempt-'||n,500,
  'EXHAUSTED-PROVIDER-'||n,'approved',
  jsonb_build_object('provider_outcome','success','payload_redacted',true),
  'success',statement_timestamp(),false,
  ('e5250000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid,
  statement_timestamp(),statement_timestamp(),'failed',1,
  statement_timestamp()-interval '1 day' from generate_series(1,3) n;
insert into public.refund_gmail_threads(id,refund_case_id,mailbox_hash,
  provider_thread_id,thread_subject,first_message_at,latest_message_at,
  retention_expires_at)
select ('e5270000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid,
  ('e5240000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid,
  repeat('a',64),'exhausted-thread-'||n,'Recovery fixture',
  now()-interval '2 days',now()-interval '1 day',now()+interval '30 days'
from generate_series(1,3) n;
insert into public.refund_case_messages(id,refund_case_id,nayax_refund_attempt_id,
  message_type,status,recipient_email,subject,body,template_key,
  content_source,delivery_kind,template_version,error_message,delivery_state)
select ('e5280000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid,
  ('e5240000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid,
  ('e5260000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid,
  'completed','failed','recover-'||n||'@example.invalid',
  'Your refund is on its way','Synthetic saved completion',
  'refund_nayax_completed_v2','deterministic_template','manual',
  'refund_nayax_completion_v2','gmail_completion_retry_exhausted','unknown'
from generate_series(1,3) n;
update public.refund_case_nayax_refund_attempts a
set completion_message_id=('e5280000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid,
  completion_gmail_thread_id=('e5270000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid
from generate_series(1,3) n
where a.id=('e5260000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid;
insert into public.refund_gmail_messages(gmail_thread_id,refund_case_id,
  provider_message_id,operation_key,direction,message_kind,status,
  sender_email,recipient_email,subject,plain_body,sent_at,
  retention_expires_at,recipient_cc_emails,recipient_cc_count,received_at)
select ('e5270000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid,
  ('e5240000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid,
  'prior-ack-'||n,'synthetic-prior-ack-'||n,'outbound','message','sent',
  'info@bloomjoysweets.com','recover-'||n||'@example.invalid',
  'Prior receipt','Synthetic prior receipt',now()-interval '2 days',
  now()+interval '30 days','{}',0,now()-interval '2 days'
from generate_series(1,3) n;

create function pg_temp.capture_error(statement text) returns text
language plpgsql as $$ begin execute statement; return null;
exception when others then return sqlstate; end $$;
select ok(has_function_privilege('service_role',
  'public.service_prepare_exhausted_nayax_completion_recovery(text,uuid,text)',
  'execute') and not has_function_privilege('authenticated',
  'public.service_prepare_exhausted_nayax_completion_recovery(text,uuid,text)',
  'execute'),'Only the service executor can prepare an exhausted recovery');
select is(public.service_prepare_exhausted_nayax_completion_recovery(
  'synthetic-exhausted-recovery-executor',
  'e5280000-0000-4000-8000-000000000001','673955')->>'prepared','true',
  'Exact unsent completion prepares once');
select is((select status from public.refund_case_messages where id=
  'e5280000-0000-4000-8000-000000000001'),'pending',
  'Original saved message is the only message prepared');
select is((select completion_delivery_retry_count from public.refund_case_nayax_refund_attempts
  where id='e5260000-0000-4000-8000-000000000001'),1,
  'Recovery does not reset the bounded retry count');
select is(pg_temp.capture_error($$select public.service_prepare_exhausted_nayax_completion_recovery(
  'synthetic-exhausted-recovery-executor',
  'e5280000-0000-4000-8000-000000000001','673955')$$),'P0001',
  'A second preparation fails closed');
update public.refund_case_messages set provider_message_id='possible-provider-effect'
where id='e5280000-0000-4000-8000-000000000002';
select is(pg_temp.capture_error($$select public.service_prepare_exhausted_nayax_completion_recovery(
  'synthetic-exhausted-recovery-executor',
  'e5280000-0000-4000-8000-000000000002','673955')$$),'P0001',
  'Possible provider effect cannot be retried');
select is(pg_temp.capture_error($$select public.service_prepare_exhausted_nayax_completion_recovery(
  'synthetic-exhausted-recovery-executor',
  'e5280000-0000-4000-8000-000000000003','wrong-history')$$),'P0001',
  'Unreviewed history shape is rejected');
select is((select count(*)::integer from public.refund_case_nayax_refund_attempts
  where refund_case_id::text like 'e5240000%'),3,
  'Recovery creates no payment attempt');
select is((select count(*)::integer from public.sales_adjustment_facts
  where refund_case_id::text like 'e5240000%'),3,
  'Recovery creates no accounting adjustment');
select is((select count(*)::integer from public.refund_case_messages
  where refund_case_id::text like 'e5240000%'),3,
  'Recovery creates no second customer message');
select * from finish();
rollback;
