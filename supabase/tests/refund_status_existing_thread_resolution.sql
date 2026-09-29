create extension if not exists pgtap with schema extensions;
set local search_path=public,extensions;
begin;
select plan(4);

insert into public.customer_accounts(id,name,account_type)
values('da100000-0000-4000-8000-000000000001','Status resolution fixture','internal');
insert into public.reporting_locations(id,account_id,name,timezone)
values('da200000-0000-4000-8000-000000000001',
  'da100000-0000-4000-8000-000000000001','Status resolution','America/Los_Angeles');
insert into public.reporting_machines(id,account_id,location_id,machine_label,status)
values('da300000-0000-4000-8000-000000000001',
  'da100000-0000-4000-8000-000000000001',
  'da200000-0000-4000-8000-000000000001','Status resolution','active');

set local session_replication_role=replica;
insert into public.refund_cases(
  id,public_reference,reporting_machine_id,reporting_location_id,customer_email,
  issue_summary,incident_at,payment_method,payment_amount_cents,refund_amount_cents,
  status,decision,refund_completed_at,correlation_status,correlation_source,
  correlation_confidence,automation_state,nayax_refund_execution_status)
values
('da400000-0000-4000-8000-000000000001','RF-STATUS-RESOLVED',
  'da300000-0000-4000-8000-000000000001',
  'da200000-0000-4000-8000-000000000001','resolved-status@example.invalid',
  'Synthetic governed status resolution',now()-interval '10 days','card',900,900,
  'completed','approved',now()-interval '9 days','matched','nayax',1,'completed','approved'),
('da400000-0000-4000-8000-000000000002','RF-STATUS-MALFORMED',
  'da300000-0000-4000-8000-000000000001',
  'da200000-0000-4000-8000-000000000001','malformed-status@example.invalid',
  'Synthetic malformed status resolution',now()-interval '10 days','card',1000,1000,
  'completed','approved',now()-interval '9 days','matched','nayax',1,'completed','approved');

insert into public.refund_case_messages(
  id,refund_case_id,message_type,status,recipient_email,subject,body,
  template_key,template_version,content_source,delivery_kind,reason_code,
  requested_fields,error_message,delivery_state,created_at)
values
('da500000-0000-4000-8000-000000000001',
  'da400000-0000-4000-8000-000000000001','status_update','failed',
  'resolved-status@example.invalid','A quick update','We are still working on this.',
  'refund_status_update_sla_at_risk_v1','refund_customer_status_v1',
  'deterministic_template','automatic','sla_at_risk','{}',
  'gmail_source_thread_required','unknown',now()-interval '10 days'),
('da500000-0000-4000-8000-000000000002',
  'da400000-0000-4000-8000-000000000001','completed','failed',
  'resolved-status@example.invalid','Your refund is complete','Your refund is complete.',
  'refund_nayax_completed_v2','refund_nayax_completion_v2',
  'deterministic_template','manual',null,'{}',
  'gmail_completion_retry_exhausted','unknown',now()-interval '9 days'),
('da500000-0000-4000-8000-000000000003',
  'da400000-0000-4000-8000-000000000002','status_update','failed',
  'malformed-status@example.invalid','A quick update','We are still working on this.',
  'refund_status_update_sla_at_risk_v1','refund_customer_status_v1',
  'deterministic_template','automatic','sla_at_risk','{}',
  'gmail_source_thread_required','unknown',now()-interval '10 days'),
('da500000-0000-4000-8000-000000000004',
  'da400000-0000-4000-8000-000000000002','completed','failed',
  'malformed-status@example.invalid','Your refund is complete','Your refund is complete.',
  'refund_nayax_completed_v2','refund_nayax_completion_v2',
  'deterministic_template','manual',null,'{}',
  'gmail_completion_retry_exhausted','unknown',now()-interval '9 days');

insert into public.refund_case_events(
  id,refund_case_id,event_type,message,metadata,created_at)
values
('da600000-0000-4000-8000-000000000001',
  'da400000-0000-4000-8000-000000000001',
  'refund_completion_obligation_resolved_existing_thread','Synthetic exact resolution',
  jsonb_build_object('completion_message_id','da500000-0000-4000-8000-000000000002',
    'payload_redacted',true,'result',jsonb_build_object(
      'currentObligationState','resolved_by_existing_thread_copy')),
  now()-interval '1 day');
set local session_replication_role=origin;

select is(public.service_get_refund_status_contact_obligation_health()
  ->>'unresolvedCount','1',
  'Only the status notice without exact governed terminal evidence remains unresolved');
select is(public.service_get_refund_status_contact_obligation_health()
  ->>'definiteFailureCount','1',
  'The unresolved historical status notice remains a definite failure');
select ok((select status='failed' and delivery_state='unknown'
    and sent_at is null and provider_message_id is null
  from public.refund_case_messages where id='da500000-0000-4000-8000-000000000001'),
  'The exact resolved status history remains unchanged');
select ok((select status='failed' and delivery_state='unknown'
    and sent_at is null and provider_message_id is null
  from public.refund_case_messages where id='da500000-0000-4000-8000-000000000003'),
  'The genuinely unresolved status history remains unchanged');

select * from finish();
rollback;
