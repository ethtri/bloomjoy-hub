begin;

create extension if not exists pgtap with schema extensions;
set local search_path = public, extensions;

select plan(16);

insert into auth.users (
  instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at
) values (
  '00000000-0000-0000-0000-000000000000',
  'e0000000-0000-4000-8000-000000000001',
  'authenticated', 'authenticated', 'lifecycle-v2@example.invalid', '', now(),
  '{}'::jsonb, '{}'::jsonb, now(), now()
);

insert into public.customer_accounts (id, name, account_type)
values ('e1000000-0000-4000-8000-000000000001', 'Lifecycle v2 test', 'customer');

insert into public.reporting_locations (id, account_id, name, timezone)
values (
  'e2000000-0000-4000-8000-000000000001',
  'e1000000-0000-4000-8000-000000000001',
  'Lifecycle v2 location', 'America/Los_Angeles'
);

insert into public.reporting_machines (id, account_id, location_id, machine_label)
values (
  'e3000000-0000-4000-8000-000000000001',
  'e1000000-0000-4000-8000-000000000001',
  'e2000000-0000-4000-8000-000000000001',
  'Lifecycle v2 machine'
);

insert into public.refund_nayax_machine_inventory (
  id, account_key, nayax_machine_id, machine_name, provider_is_active,
  refund_category, reporting_machine_id, reconciliation_state, setup_reason
) values (
  'e3500000-0000-4000-8000-000000000001', 'LIFECYCLE_TEST',
  'LIFECYCLE-MACHINE-001', 'Lifecycle v2 provider machine', true,
  'cotton_candy', 'e3000000-0000-4000-8000-000000000001',
  'published', 'reviewed_exact_mapping'
);


insert into public.reporting_machine_refund_managers(reporting_machine_id,manager_user_id,manager_email,grant_reason)
values('e3000000-0000-4000-8000-000000000001','e0000000-0000-4000-8000-000000000001','lifecycle-v2@example.invalid','Synthetic delivery projection');
select set_config('request.jwt.claim.sub','e0000000-0000-4000-8000-000000000001',true);
select set_config('request.jwt.claim.role','authenticated',true);
select set_config('request.jwt.claims','{"sub":"e0000000-0000-4000-8000-000000000001","role":"authenticated","is_anonymous":false}',true);

insert into public.refund_cases(id,public_reference,reporting_machine_id,reporting_location_id,
 customer_email,issue_summary,incident_at,incident_timezone,payment_method,payment_amount_cents,refund_amount_cents,
 card_last4,status,correlation_status,correlation_source,decision,decision_reason,automation_state,
 lifecycle_integrity_status,lifecycle_integrity_code,lifecycle_integrity_detected_at)
select ('e4000000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid,'RF-DELIVERY-PROJECTION-'||n,
 'e3000000-0000-4000-8000-000000000001','e2000000-0000-4000-8000-000000000001',
 'synthetic@example.invalid','Delivery projection fixture',now()-interval '1 hour','America/Los_Angeles','card',700,700,
 '4242',case when n=5 then 'denied' when n in(4,6) then 'card_refund_pending' else 'needs_review' end,
 'matched','nayax',case when n=5 then 'denied' else 'approved' end,'Existing synthetic decision','under_review',
 case when n=6 then 'hold' else 'ok' end,case when n=6 then 'card_payment_state_without_attempt' end,
 case when n=6 then now() end from generate_series(1,6) n;
update public.refund_cases set matched_nayax_transaction_id='synthetic-original',matched_nayax_amount_cents=700,
 matched_nayax_machine_auth_time=now()-interval '1 hour',matched_nayax_card_last4='4242'
where id='e4000000-0000-4000-8000-000000000002';
insert into public.refund_case_nayax_refund_attempts(refund_case_id,execution_mode,status,idempotency_key,amount_cents)
values('e4000000-0000-4000-8000-000000000003','request_and_approve','ambiguous','delivery-uncertain',700),
 ('e4000000-0000-4000-8000-000000000004','request_and_approve','in_progress','delivery-pending',700);
create temporary table delivery_before as
select id,public.refund_lifecycle_contract(id) as contract from public.refund_cases where public_reference like 'RF-DELIVERY-PROJECTION-%';
select is((select contract#>>'{managerQueue,bucket}' from delivery_before where id='e4000000-0000-4000-8000-000000000002'),'ready_to_pay','Fixture has authorized canonical refund readiness');

insert into public.refund_case_messages(refund_case_id,message_type,status,recipient_email,subject,body,template_key,
 delivery_transport,delivery_state,delivery_state_updated_at)
select id,'status_update','failed','synthetic@example.invalid','Synthetic message','Synthetic body','refund_status_update_v2_test',
 'resend','failed',now() from delivery_before;
-- The actual public projection runs through both unchanged receipt wrappers.
select is(jsonb_build_array(after_value->'stage',after_value->'paymentState',after_value->'managerAction',after_value->'managerQueue'),
 jsonb_build_array(contract->'stage',contract->'paymentState',contract->'managerAction',contract->'managerQueue'),
 'Failed message preserves canonical action/payment/queue for '||id)
from delivery_before cross join lateral (select public.refund_lifecycle_contract(id) after_value) a order by id;
select is(public.refund_lifecycle_contract('e4000000-0000-4000-8000-000000000002')#>>'{messageState,state}','failed','Delivery failure remains visible');
select is(public.refund_lifecycle_contract('e4000000-0000-4000-8000-000000000002')#>>'{operations,required}','true','Delivery operations work remains recorded');
select is(public.refund_lifecycle_contract('e4000000-0000-4000-8000-000000000002')#>>'{operations,failureClass}','customer_delivery_exception','Delivery has its own safe reason');
select is(public.refund_lifecycle_contract('e4000000-0000-4000-8000-000000000003')#>>'{operations,nextStep}','Confirm the authoritative Nayax result. Do not retry.','Unknown payment recovery outranks message recovery');
select is(public.refund_lifecycle_contract('e4000000-0000-4000-8000-000000000006')#>>'{operations,failureClass}','card_payment_state_without_attempt','Integrity reason is not masked by delivery failure');
select is((select decision from public.refund_cases where id='e4000000-0000-4000-8000-000000000002'),'approved','Existing manager approval is preserved');
select is((select count(*)::integer from public.refund_case_nayax_refund_attempts where refund_case_id in(select id from delivery_before)),2,'Projection creates no payment attempts');
select is((select count(*)::integer from public.refund_case_messages where refund_case_id in(select id from delivery_before)),6,'Projection creates no messages');
select ok(not has_function_privilege('authenticated','public.refund_lifecycle_contract_pre_authoritative_receipt_v1(uuid)','EXECUTE'),'Internal projection execute permission is unchanged');
select * from finish();
rollback;
