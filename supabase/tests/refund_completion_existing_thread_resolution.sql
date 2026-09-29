begin;
create extension if not exists pgtap with schema extensions;
set local search_path=public,extensions;
select plan(29);

create function pg_temp.set_completion_auth(p_user_id uuid,p_session_id uuid)
returns void language plpgsql as $$ begin
  perform set_config('request.jwt.claim.sub',p_user_id::text,true);
  perform set_config('request.jwt.claim.role','authenticated',true);
  perform set_config('request.jwt.claims',jsonb_build_object(
    'sub',p_user_id,'role','authenticated','session_id',p_session_id,
    'is_anonymous',false)::text,true);
end; $$;
create function pg_temp.capture_error(statement text)
returns text language plpgsql as $$ begin execute statement; return null;
exception when others then return sqlstate||':'||sqlerrm; end; $$;

insert into auth.users(instance_id,id,aud,role,email,encrypted_password,
  email_confirmed_at,raw_app_meta_data,raw_user_meta_data,created_at,updated_at)
values
('00000000-0000-0000-0000-000000000000','ce000000-0000-4000-8000-000000000001',
 'authenticated','authenticated','completion-ops@example.invalid','',now(),'{}','{}',now(),now()),
('00000000-0000-0000-0000-000000000000','ce000000-0000-4000-8000-000000000002',
 'authenticated','authenticated','completion-outsider@example.invalid','',now(),'{}','{}',now(),now());
insert into auth.sessions(id,user_id,created_at,updated_at)
values('ce010000-0000-4000-8000-000000000001',
  'ce000000-0000-4000-8000-000000000001',now(),now());
insert into public.admin_roles(user_id,role,active)
values('ce000000-0000-4000-8000-000000000001','super_admin',true);
insert into public.customer_accounts(id,name,account_type)
values('ce100000-0000-4000-8000-000000000001','Completion obligation fixture','internal');
insert into public.reporting_locations(id,account_id,name,timezone)
values('ce200000-0000-4000-8000-000000000001',
  'ce100000-0000-4000-8000-000000000001','Completion obligation','America/Los_Angeles');
insert into public.reporting_machines(id,account_id,location_id,machine_label,status,
  nayax_machine_id,nayax_account_key)
values('ce300000-0000-4000-8000-000000000001',
  'ce100000-0000-4000-8000-000000000001',
  'ce200000-0000-4000-8000-000000000001','Completion obligation','active',
  'COMPLETION-MACHINE','COMPLETION-ACCOUNT');
insert into public.reporting_machine_refund_managers(
  reporting_machine_id,manager_user_id,manager_email,grant_reason)
values('ce300000-0000-4000-8000-000000000001',
  'ce000000-0000-4000-8000-000000000001','completion-ops@example.invalid',
  'Completion obligation fixture');

insert into public.refund_cases(
  id,public_reference,reporting_machine_id,reporting_location_id,customer_email,
  issue_summary,incident_at,payment_method,payment_amount_cents,refund_amount_cents,
  status,decision,refund_completed_at,correlation_status,correlation_source,
  correlation_confidence,automation_state,nayax_refund_execution_status,
  matched_nayax_transaction_id,matched_nayax_machine_auth_time,
  matched_nayax_amount_cents,matched_nayax_currency_code,matched_nayax_site_id)
values('ce400000-0000-4000-8000-000000000001','RF-CURRENT-COPY',
  'ce300000-0000-4000-8000-000000000001',
  'ce200000-0000-4000-8000-000000000001','completion-customer@example.invalid',
  'Synthetic exact existing completion copy',now()-interval '10 days','card',2700,2700,
  'completed','approved',now()-interval '9 days','matched','nayax',1,'completed','approved',
  'COMPLETION-TXN-1',now()-interval '10 days',2700,'USD',7001);
insert into public.sales_adjustment_facts(
  id,reporting_machine_id,reporting_location_id,adjustment_date,adjustment_type,
  amount_cents,complaint_count,source,source_row_hash,source_reference,
  source_row_reference,refund_case_id,match_status,match_confidence,notes,raw_payload)
values('ce500000-0000-4000-8000-000000000001',
  'ce300000-0000-4000-8000-000000000001',
  'ce200000-0000-4000-8000-000000000001',current_date-9,'refund',2700,1,
  'refund_case','completion-current-copy-adjustment','refund_cases','RF-CURRENT-COPY',
  'ce400000-0000-4000-8000-000000000001','applied',1,
  'Synthetic settled completion obligation',jsonb_build_object(
    'refund_case_id','ce400000-0000-4000-8000-000000000001',
    'refund_case_reference','RF-CURRENT-COPY','refund_case_status','completed',
    'refund_case_decision','approved','payment_method','card',
    'correlation_source','nayax','correlation_has_card_lookup',true,
    'payload_redacted',true));
update public.refund_cases set reporting_adjustment_id=
  'ce500000-0000-4000-8000-000000000001'
where id='ce400000-0000-4000-8000-000000000001';

insert into public.refund_gmail_threads(
  id,refund_case_id,mailbox_hash,provider_thread_id,thread_subject,
  first_message_at,latest_message_at,retention_expires_at)
values('ce600000-0000-4000-8000-000000000001',
  'ce400000-0000-4000-8000-000000000001',repeat('6',64),
  'completion-thread-1','Completion request',now()-interval '10 days',
  now()-interval '10 days',now()+interval '30 days');
insert into public.refund_case_nayax_refund_attempts(
  id,refund_case_id,execution_mode,status,idempotency_key,amount_cents,
  provider_reference,provider_status,sanitized_response,provider_outcome,
  provider_outcome_recorded_at,reconciliation_required,reporting_adjustment_id,
  case_finalization_committed_at,completion_gmail_thread_id,
  completion_delivery_status,completed_at)
values('ce700000-0000-4000-8000-000000000001',
  'ce400000-0000-4000-8000-000000000001','request_and_approve','succeeded',
  'completion-current-copy-attempt',2700,'COMPLETION-PROVIDER-1','approved',
  '{"provider_outcome":"success","payload_redacted":true}','success',
  now()-interval '9 days',false,'ce500000-0000-4000-8000-000000000001',
  now()-interval '9 days','ce600000-0000-4000-8000-000000000001','failed',
  now()-interval '9 days');
insert into public.refund_case_messages(
  id,refund_case_id,nayax_refund_attempt_id,message_type,status,recipient_email,
  subject,body,template_key,template_version,content_source,error_message,
  delivery_state,manual_delivery_attempt_count,created_at)
values('ce800000-0000-4000-8000-000000000001',
  'ce400000-0000-4000-8000-000000000001',
  'ce700000-0000-4000-8000-000000000001','completed','failed',
  'completion-customer@example.invalid','Your refund is complete',
  'Your $27.00 refund was issued. Reference RF-CURRENT-COPY.',
  'refund_nayax_completed_v2','refund_nayax_completion_v2',
  'deterministic_template','gmail_completion_retry_exhausted','unknown',0,
  now()-interval '9 days');
update public.refund_case_nayax_refund_attempts
set completion_message_id='ce800000-0000-4000-8000-000000000001'
where id='ce700000-0000-4000-8000-000000000001';
insert into public.refund_authoritative_receipts(
  id,refund_case_id,nayax_refund_attempt_id,reporting_machine_id,account_scope,
  provider_machine_id,original_transaction_id,original_amount_cents,
  refunded_amount_cents,currency_code,provider_status,evidence_reference_digest,
  observed_at,recorded_by,attempt_binding_kind,current_provider_observation_reviewed)
values('ce900000-0000-4000-8000-000000000001',
  'ce400000-0000-4000-8000-000000000001',
  'ce700000-0000-4000-8000-000000000001',
  'ce300000-0000-4000-8000-000000000001','COMPLETION-ACCOUNT',
  'COMPLETION-MACHINE','COMPLETION-TXN-1',2700,2700,'USD',62,repeat('9',64),
  now()-interval '9 days','ce000000-0000-4000-8000-000000000001',
  'modern_authorized_manual',true);
insert into public.refund_case_events(
  id,refund_case_id,actor_user_id,event_type,message,metadata,created_at)
values('cea00000-0000-4000-8000-000000000001',
  'ce400000-0000-4000-8000-000000000001',null,
  'refund_customer_completion_recovery_sent','Synthetic historical copy',
  jsonb_build_object('sourceMessageId','ce800000-0000-4000-8000-000000000001',
    'deliveryTransport','resend','providerLastEvent','delivered',
    'providerMessageIdDigest',repeat('a',64),'paymentOperationPerformed',false,
    'originalGmailThreadPreserved',true),now()-interval '8 days');

select is(public.refund_completion_contact_contract(
  'ce400000-0000-4000-8000-000000000001')->>'state','failed',
  'Historical failed completion remains failed before disposition');
select is((public.service_get_refund_completion_outbox_health(
  array['info@example.invalid'],true,true,true)->>'deliveryUnknownCount')::integer,1,
  'The exact exhausted legacy completion is unhealthy before disposition');
select ok(not has_function_privilege('anon',
  'public.admin_resolve_refund_completion_existing_thread(uuid,uuid,uuid,text,bigint,text,text,integer,text,timestamptz,text,boolean,boolean,boolean,boolean)',
  'execute'),'Anonymous callers cannot record an observation');
select ok(not has_function_privilege('service_role',
  'public.admin_resolve_refund_completion_existing_thread(uuid,uuid,uuid,text,bigint,text,text,integer,text,timestamptz,text,boolean,boolean,boolean,boolean)',
  'execute'),'Background service cannot impersonate a mailbox reviewer');

select pg_temp.set_completion_auth('ce000000-0000-4000-8000-000000000001',
  'ce010000-0000-4000-8000-000000000001');
set local role authenticated;
select ok(pg_temp.capture_error(format($sql$select public.admin_resolve_refund_completion_existing_thread(
  'ce400000-0000-4000-8000-000000000001','ce800000-0000-4000-8000-000000000001',
  'cea00000-0000-4000-8000-000000000001','completion-thread-1',%s,
  'RF-CURRENT-COPY','COMPLETION-TXN-1',2700,'completion-customer@example.invalid',
  %L,repeat('b',64),true,true,true,true)$sql$,
  (select official_action_version from public.refund_cases where id='ce400000-0000-4000-8000-000000000001'),
  (select created_at from public.refund_case_events where id='cea00000-0000-4000-8000-000000000001')))
  like 'P4681:Review the exact settled case%',
  'An arbitrary message digest cannot close the current obligation');

reset role;
select ok((select case_population='customer' and payment_method='card'
    and status='completed' and decision='approved' and refund_completed_at is not null
    and reporting_adjustment_id='ce500000-0000-4000-8000-000000000001'
    and public_reference='RF-CURRENT-COPY'
    and matched_nayax_transaction_id='COMPLETION-TXN-1'
    and refund_amount_cents=2700
    and lower(customer_email)='completion-customer@example.invalid'
  from public.refund_cases where id='ce400000-0000-4000-8000-000000000001'),
  'The fixture case has the exact settled customer facts');
select ok((select message_type='completed'
    and template_version='refund_nayax_completion_v2' and status='failed'
    and lower(recipient_email)='completion-customer@example.invalid'
    and error_message='gmail_completion_retry_exhausted' and delivery_state='unknown'
    and provider_message_id is null and sent_at is null
    and manual_delivery_attempt_count=0 and manual_delivery_provider_attempted_at is null
    and manual_delivery_state is null
  from public.refund_case_messages where id='ce800000-0000-4000-8000-000000000001'),
  'The fixture message has the exact immutable failed and unknown history');
select ok((select status='succeeded' and provider_outcome='success'
    and reconciliation_required=false
    and reporting_adjustment_id='ce500000-0000-4000-8000-000000000001'
    and case_finalization_committed_at is not null
    and completion_message_id='ce800000-0000-4000-8000-000000000001'
    and completion_gmail_thread_id='ce600000-0000-4000-8000-000000000001'
    and completion_delivery_status='failed'
  from public.refund_case_nayax_refund_attempts
  where id='ce700000-0000-4000-8000-000000000001'),
  'The fixture attempt is final and bound to the failed completion message');
select ok((select event_type='refund_customer_completion_recovery_sent'
    and metadata->>'sourceMessageId'='ce800000-0000-4000-8000-000000000001'
    and metadata->>'deliveryTransport'='resend'
    and metadata->>'providerLastEvent'='delivered'
    and metadata->>'paymentOperationPerformed'='false'
    and metadata->>'originalGmailThreadPreserved'='true'
    and metadata->>'providerMessageIdDigest'=repeat('a',64)
  from public.refund_case_events where id='cea00000-0000-4000-8000-000000000001'),
  'The fixture recovery event retains exact nonreversible provider evidence');
select ok(
  exists(select 1 from public.refund_authoritative_receipts
    where refund_case_id='ce400000-0000-4000-8000-000000000001'
      and nayax_refund_attempt_id='ce700000-0000-4000-8000-000000000001'
      and original_transaction_id='COMPLETION-TXN-1'
      and refunded_amount_cents=original_amount_cents)
  and exists(select 1 from public.refund_gmail_threads
    where refund_case_id='ce400000-0000-4000-8000-000000000001'
      and id='ce600000-0000-4000-8000-000000000001'
      and provider_thread_id='completion-thread-1')
  and not exists(select 1 from public.refund_nayax_pending_approval_recoveries
    where nayax_refund_attempt_id='ce700000-0000-4000-8000-000000000001'
      and status='in_progress')
  and not exists(select 1 from public.refund_nayax_resolution_intents
    where nayax_refund_attempt_id='ce700000-0000-4000-8000-000000000001'
      and status='pending')
  and not exists(select 1 from public.refund_gmail_messages
    where refund_case_id='ce400000-0000-4000-8000-000000000001'
      and direction='inbound'
      and received_at>(select created_at from public.refund_case_messages
        where id='ce800000-0000-4000-8000-000000000001')),
  'The fixture has one exact receipt/thread and no pending financial work');
set local role authenticated;

select is((public.admin_resolve_refund_completion_existing_thread(
  'ce400000-0000-4000-8000-000000000001','ce800000-0000-4000-8000-000000000001',
  'cea00000-0000-4000-8000-000000000001','completion-thread-1',
  (select official_action_version from public.refund_cases where id='ce400000-0000-4000-8000-000000000001'),
  'RF-CURRENT-COPY','COMPLETION-TXN-1',2700,'completion-customer@example.invalid',
  (select created_at from public.refund_case_events where id='cea00000-0000-4000-8000-000000000001'),
  encode(extensions.digest(convert_to(jsonb_build_array(
    'completion-customer@example.invalid','Your refund is complete',
    'Your $27.00 refund was issued. Reference RF-CURRENT-COPY.')::text,'UTF8'),'sha256'),'hex'),
  true,true,true,true)->>'status'),'resolved',
  'The mapped operator resolves the exact current obligation from reviewed evidence');
select is((select count(*)::integer from public.refund_case_events
  where event_type='refund_completion_obligation_resolved_existing_thread'),1,
  'One immutable resolution event is recorded');
select is((public.admin_resolve_refund_completion_existing_thread(
  'ce400000-0000-4000-8000-000000000001','ce800000-0000-4000-8000-000000000001',
  'cea00000-0000-4000-8000-000000000001','completion-thread-1',
  (select official_action_version from public.refund_cases where id='ce400000-0000-4000-8000-000000000001'),
  'RF-CURRENT-COPY','COMPLETION-TXN-1',2700,'completion-customer@example.invalid',
  (select created_at from public.refund_case_events where id='cea00000-0000-4000-8000-000000000001'),
  encode(extensions.digest(convert_to(jsonb_build_array(
    'completion-customer@example.invalid','Your refund is complete',
    'Your $27.00 refund was issued. Reference RF-CURRENT-COPY.')::text,'UTF8'),'sha256'),'hex'),
  true,true,true,true)->>'status'),'resolved','Exact replay is idempotent');
reset role;

select is((select status from public.refund_case_messages
  where id='ce800000-0000-4000-8000-000000000001'),'failed',
  'Historical message status remains failed');
select is((select delivery_state from public.refund_case_messages
  where id='ce800000-0000-4000-8000-000000000001'),'unknown',
  'Historical delivery remains unknown');
select is((select provider_message_id from public.refund_case_messages
  where id='ce800000-0000-4000-8000-000000000001'),null::text,
  'No provider identity is fabricated');
select is(public.refund_completion_contact_contract(
  'ce400000-0000-4000-8000-000000000001')->>'state','failed',
  'Contact projection preserves the historical failed state');
select is(public.refund_completion_contact_contract(
  'ce400000-0000-4000-8000-000000000001')->>'currentObligationState',
  'resolved_by_existing_thread_copy','Projection distinguishes current resolution from transport truth');
select is(public.refund_lifecycle_contract(
  'ce400000-0000-4000-8000-000000000001')->>'terminal','true',
  'The resolved current obligation makes the settled case terminal');
select is(public.refund_lifecycle_contract(
  'ce400000-0000-4000-8000-000000000001')#>>'{nextWork,isOpen}','false',
  'No customer-contact or payment work remains open');
select is(public.refund_project_receipt_lifecycle_for_manager(
  public.refund_lifecycle_contract('ce400000-0000-4000-8000-000000000001'),false)
  #>>'{managerQueue,label}','Refund confirmed · no action due',
  'Restricted managers see the current obligation as closed without a delivery claim');
select is(public.refund_project_receipt_lifecycle_for_manager(
  public.refund_lifecycle_contract('ce400000-0000-4000-8000-000000000001'),false)
  #>>'{operations,safeStage}','customer_notice_obligation_resolved',
  'Restricted projection preserves a distinct truthful resolution stage');
select is((public.service_get_refund_completion_outbox_health(
  array['info@example.invalid'],true,true,true)->>'deliveryUnknownCount')::integer,0,
  'Aggregate health no longer counts the resolved current obligation');
select is((public.service_get_refund_completion_outbox_health(
  array['info@example.invalid'],true,true,true)->>'resolvedByExistingThreadCopyCount')::integer,1,
  'Aggregate health reports one resolved existing-thread obligation');
select is((select count(*)::integer from public.refund_case_messages
  where refund_case_id='ce400000-0000-4000-8000-000000000001'),1,
  'Resolution creates no customer message');
select is((select count(*)::integer from public.refund_case_nayax_refund_attempts
  where refund_case_id='ce400000-0000-4000-8000-000000000001'),1,
  'Resolution creates no payment attempt');
select throws_ok($$update public.refund_case_events set message='changed'
  where event_type='refund_completion_obligation_resolved_existing_thread'$$,
  '42501',null,'Resolution evidence cannot be rewritten');
select throws_ok($$delete from public.refund_case_events
  where event_type='refund_completion_obligation_resolved_existing_thread'$$,
  '42501',null,'Resolution evidence cannot be deleted');
select ok((select metadata::text from public.refund_case_events
  where event_type='refund_completion_obligation_resolved_existing_thread')
  !~* 'completion-customer|COMPLETION-TXN|RF-CURRENT-COPY',
  'Resolution metadata contains no raw customer or payment identity');

select * from finish();
rollback;
