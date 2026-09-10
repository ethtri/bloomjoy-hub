begin;
create extension if not exists pgtap with schema extensions;
set local search_path=public,extensions;
select plan(20);

insert into public.customer_accounts(id,name,account_type)
values('c6200000-0000-4000-8000-000000000001','Completion contact truth','internal');
insert into public.reporting_locations(id,account_id,name,timezone)
values('c6210000-0000-4000-8000-000000000001','c6200000-0000-4000-8000-000000000001','Completion contact','America/Los_Angeles');
insert into public.reporting_machines(id,account_id,location_id,machine_label,status)
values('c6220000-0000-4000-8000-000000000001','c6200000-0000-4000-8000-000000000001','c6210000-0000-4000-8000-000000000001','Completion contact','active');

insert into public.refund_cases(id,public_reference,reporting_machine_id,reporting_location_id,customer_email,
  issue_summary,incident_at,payment_method,payment_amount_cents,status,correlation_status)
select ('c6230000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid,'RF-CONTACT-'||n,
  'c6220000-0000-4000-8000-000000000001','c6210000-0000-4000-8000-000000000001',
  'contact-'||n||'@example.invalid','Synthetic completion contact',
  (date '2017-01-01' + n + time '12:00')::timestamp,
  'card',500,'needs_review','matched' from generate_series(1,1) n;

insert into public.refund_cases(
  id,public_reference,reporting_machine_id,reporting_location_id,customer_email,
  issue_summary,incident_at,payment_method,payment_amount_cents,refund_amount_cents,
  status,decision,refund_completed_at,correlation_status,correlation_source,
  correlation_confidence,automation_state,nayax_refund_execution_status,
  nayax_match_execution_eligible,matched_nayax_transaction_id,
  matched_nayax_machine_auth_time,matched_nayax_amount_cents,
  matched_nayax_currency_code,matched_nayax_site_id
)
select ('c6230000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid,'RF-CONTACT-'||n,
  'c6220000-0000-4000-8000-000000000001','c6210000-0000-4000-8000-000000000001',
  'contact-'||n||'@example.invalid','Synthetic completion contact',
  (date '2017-01-01' + n + time '12:00')::timestamp,
  'card',500,500,'completed','approved',statement_timestamp(),'matched','nayax',1,
  'completed','approved',false,'CONTACT-TXN-'||lpad(n::text,4,'0'),
  (date '2017-01-01' + n + time '12:00')::timestamp,500,'USD',7001
from generate_series(2,8) n;

-- Completion messages for card refunds are owned by committed settlements.
-- Seed that terminal truth rather than bypassing the production guard.
insert into public.sales_adjustment_facts(
  id,reporting_machine_id,reporting_location_id,adjustment_date,adjustment_type,
  amount_cents,complaint_count,source,source_row_hash,source_reference,
  source_row_reference,refund_case_id,match_status,match_confidence,notes,raw_payload
)
select ('c6250000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid,
  'c6220000-0000-4000-8000-000000000001','c6210000-0000-4000-8000-000000000001',
  current_date,'refund',500,1,'refund_case','contact-adjustment-'||n,'refund_cases',
  'RF-CONTACT-'||n,('c6230000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid,
  'applied',1,'Synthetic committed contact truth',jsonb_build_object(
    'refund_case_id',('c6230000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid,
    'refund_case_reference','RF-CONTACT-'||n,
    'refund_case_status','completed','refund_case_decision','approved',
    'payment_method','card','correlation_source','nayax',
    'correlation_has_card_lookup',true,'payload_redacted',true
  )
from generate_series(2,8) n;

select is(
  (select count(distinct refund_business_fingerprint)::integer
   from public.refund_cases
   where id::text like 'c6230000%' and id <> 'c6230000-0000-4000-8000-000000000001'),
  7,
  'Settlement fixtures have seven distinct machine/date/amount business fingerprints'
);
select ok(
  not exists(
    select 1
    from public.sales_adjustment_facts adjustment
    join public.refund_cases refund_case on refund_case.id = adjustment.refund_case_id
    where refund_case.id::text like 'c6230000%'
      and adjustment.refund_business_fingerprint is distinct from refund_case.refund_business_fingerprint
  ),
  'Each settlement adjustment retains the exact linked case business fingerprint'
);

update public.refund_cases c set reporting_adjustment_id=a.id
from public.sales_adjustment_facts a
where a.refund_case_id=c.id and c.public_reference like 'RF-CONTACT-%';

insert into public.refund_case_nayax_refund_attempts(
  id,refund_case_id,execution_mode,status,idempotency_key,amount_cents,
  provider_reference,provider_status,sanitized_response,provider_outcome,
  provider_outcome_recorded_at,reconciliation_required,reporting_adjustment_id,
  case_finalization_committed_at,completed_at
)
select ('c6260000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid,
  ('c6230000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid,
  'request_and_approve','succeeded','contact-settlement-'||n,500,
  'CONTACT-PROVIDER-'||n,'approved',jsonb_build_object('provider_outcome','success','payload_redacted',true),
  'success',statement_timestamp(),false,
  ('c6250000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid,
  statement_timestamp(),statement_timestamp()
from generate_series(2,8) n;

insert into public.refund_case_messages(id,refund_case_id,nayax_refund_attempt_id,message_type,status,recipient_email,subject,body,sent_at,
  delivery_transport,provider_message_id,delivery_state,delivery_state_updated_at)
values
('c6240000-0000-4000-8000-000000000001','c6230000-0000-4000-8000-000000000002','c6260000-0000-4000-8000-000000000002','completed','pending','contact-2@example.invalid','Queued','Synthetic',null,null,null,'unknown',null),
('c6240000-0000-4000-8000-000000000002','c6230000-0000-4000-8000-000000000003','c6260000-0000-4000-8000-000000000003','completed','sent','contact-3@example.invalid','Missing identity','Synthetic',statement_timestamp(),null,null,'unknown',statement_timestamp()),
('c6240000-0000-4000-8000-000000000003','c6230000-0000-4000-8000-000000000004','c6260000-0000-4000-8000-000000000004','completed','sent','contact-4@example.invalid','Sent','Synthetic',statement_timestamp(),'resend','contactsent4','delivered',statement_timestamp()),
('c6240000-0000-4000-8000-000000000004','c6230000-0000-4000-8000-000000000005','c6260000-0000-4000-8000-000000000005','completed','sent','contact-5@example.invalid','Delivered','Synthetic',statement_timestamp(),'resend','contactdeliver5','delivered',statement_timestamp()),
('c6240000-0000-4000-8000-000000000005','c6230000-0000-4000-8000-000000000006','c6260000-0000-4000-8000-000000000006','completed','failed','contact-6@example.invalid','Failed','Synthetic',null,null,null,'unknown',statement_timestamp()),
('c6240000-0000-4000-8000-000000000006','c6230000-0000-4000-8000-000000000007','c6260000-0000-4000-8000-000000000007','completed','failed','contact-7@example.invalid','Bounced','Synthetic',statement_timestamp(),'resend','contactbounce7','bounced',statement_timestamp()),
('c6240000-0000-4000-8000-000000000007','c6230000-0000-4000-8000-000000000008','c6260000-0000-4000-8000-000000000008','completed','failed','contact-8@example.invalid','Complained','Synthetic',statement_timestamp(),'resend','contactcomplaint8','complained',statement_timestamp());

insert into public.refund_transactional_delivery_events(event_key_digest,provider_message_id,delivery_state,event_at,
  matched_refund_case_message_id,applied_at)
values
(repeat('4',64),'contactsent4','delivered',statement_timestamp(),'c6240000-0000-4000-8000-000000000004',statement_timestamp()),
(repeat('5',64),'contactdeliver5','delivered',statement_timestamp(),'c6240000-0000-4000-8000-000000000004',statement_timestamp()),
(repeat('7',64),'contactbounce7','bounced',statement_timestamp(),'c6240000-0000-4000-8000-000000000006',statement_timestamp()),
(repeat('8',64),'contactcomplaint8','complained',statement_timestamp(),'c6240000-0000-4000-8000-000000000007',statement_timestamp());

select is(public.refund_completion_contact_contract('c6230000-0000-4000-8000-000000000001')->>'state','none','No intent stays none');
select is(public.refund_completion_contact_contract('c6230000-0000-4000-8000-000000000002')->>'state','pending','Queued intent stays pending');
select is(public.refund_completion_contact_contract('c6230000-0000-4000-8000-000000000003')->>'state','delivery_unconfirmed','Sent timestamp without provider identity is not sent proof');
select is(public.refund_completion_contact_contract('c6230000-0000-4000-8000-000000000004')->>'state','sent','An unmatched webhook cannot upgrade timestamp and provider identity to delivered');
select is(public.refund_completion_contact_contract('c6230000-0000-4000-8000-000000000005')->>'state','delivered','Delivered requires callback evidence');
select is(public.refund_completion_contact_contract('c6230000-0000-4000-8000-000000000006')->>'state','failed','Definite failure stays failed');
select is(public.refund_completion_contact_contract('c6230000-0000-4000-8000-000000000007')->>'state','bounced','Bounce callback is durable');
select is(public.refund_completion_contact_contract('c6230000-0000-4000-8000-000000000008')->>'state','complained','Complaint callback is durable');
select ok((public.refund_completion_contact_contract('c6230000-0000-4000-8000-000000000004')::text !~* 'contactsent|@example|recipient'), 'Projection contains no provider or customer identity');
select ok(not has_function_privilege('anon','public.refund_completion_contact_contract(uuid)','execute'), 'Anonymous cannot call private projector');
select ok(not has_function_privilege('authenticated','public.refund_completion_contact_contract(uuid)','execute'), 'Authenticated callers cannot bypass scoped lifecycle readers');
select ok(has_function_privilege('service_role','public.refund_completion_contact_contract(uuid)','execute'), 'Service lifecycle may consume the projector');
select is((public.refund_apply_completion_contact_to_lifecycle('{"paymentState":"confirmed"}'::jsonb,
  '{"state":"sent","messageType":"completed","lastUpdatedAt":"2026-09-10T00:00:00Z","payloadRedacted":true}'::jsonb)->>'stage'),'customer_notified','Sent advances only presentation');
select is((public.refund_apply_completion_contact_to_lifecycle('{"paymentState":"confirmed"}'::jsonb,
  '{"state":"delivery_unconfirmed","messageType":"completed","lastUpdatedAt":"2026-09-10T00:00:00Z","payloadRedacted":true}'::jsonb)#>>'{managerAction,action}'),'review_delivery_no_resend','Unknown outcome forbids blind resend');
select is((public.refund_apply_completion_contact_to_lifecycle('{"paymentState":"confirmed"}'::jsonb,
  '{"state":"bounced","messageType":"completed","lastUpdatedAt":"2026-09-10T00:00:00Z","payloadRedacted":true}'::jsonb)#>>'{managerQueue,bucket}'),'provider_hold','Bounce routes contact review without reopening payment');
select is((select count(*)::integer from public.refund_case_nayax_refund_attempts where refund_case_id::text like 'c6230000%'),7,'Projection creates no payment attempt beyond the seven fixture settlements');
select is((select count(*)::integer from public.sales_adjustment_facts where refund_case_id::text like 'c6230000%'),7,'Projection creates no accounting adjustment beyond the seven fixture settlements');
select is((select count(*)::integer from public.refund_case_messages where refund_case_id::text like 'c6230000%'),7,'Projection creates no customer message');
select * from finish();
rollback;
