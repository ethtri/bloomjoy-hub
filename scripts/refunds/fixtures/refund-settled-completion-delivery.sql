-- The preceding fixture is extracted from the real orchestration test through
-- successful reserve/settle/completion claim. No payment attempt is fabricated.
-- Stop before its Gmail send-proof fixture: this branch models historical
-- transactional delivery, with no Gmail record to remove or replace.
update public.refund_case_messages set status = 'sent', sent_at = statement_timestamp()
where refund_case_id = '9a600000-0000-4000-8000-000000000001' and message_type = 'completed';
update public.refund_case_messages set delivery_transport = 'resend', delivery_state = 'unknown',
  delivery_state_updated_at = sent_at
where refund_case_id = '9a600000-0000-4000-8000-000000000001' and message_type = 'completed';
create temporary table settled_delivery_before as
select to_jsonb(c) - array['lifecycle_revision','updated_at'] as case_value,
  (select to_jsonb(a) from public.refund_case_nayax_refund_attempts a where a.refund_case_id = c.id) as attempt_value,
  (select to_jsonb(f) from public.sales_adjustment_facts f where f.refund_case_id = c.id) as adjustment_value,
  (select to_jsonb(m) from public.refund_case_messages m where m.refund_case_id = c.id and m.message_type = 'completed') as message_value
from public.refund_cases c where c.id = '9a600000-0000-4000-8000-000000000001';
select ok((select attempt_value->>'status' = 'succeeded' and attempt_value->>'provider_outcome' = 'success'
  and attempt_value->>'case_finalization_committed_at' is not null and adjustment_value is not null
  and message_value->>'nayax_refund_attempt_id' = attempt_value->>'id'
  from settled_delivery_before), 'Delivery fixture has an actual settled token-bound completion and real reporting adjustment');
update public.refund_customer_contact_settings set automatic_customer_contact_enabled = false where singleton;
set local role service_role;
select matches(pg_temp.capture_error($sql$
  update public.refund_case_messages set delivery_state_updated_at = delivery_state_updated_at + interval '1 second'
  where refund_case_id = '9a600000-0000-4000-8000-000000000001' and message_type = 'completed'
$sql$), '^(42501:permission denied for table refund_case_nayax_refund_attempts|P0001:Nayax completion messages are orchestration-wrapper owned)$',
  'Direct API completion updates are rejected by private attempt ACL or wrapper ownership');
reset role;
select is(to_jsonb(m), b.message_value, 'Rejected direct API update leaves every settled message field unchanged')
from public.refund_case_messages m cross join settled_delivery_before b
where m.refund_case_id = '9a600000-0000-4000-8000-000000000001' and m.message_type = 'completed';
set local role service_role;
select is(public.service_bind_refund_transactional_delivery(
  (select (result->>'refundCaseMessageId')::uuid from pg_temp.nayax_provider_results where result_key = 'completion-claim'),
  'resend_settled_completion_fixture', statement_timestamp())->>'bound', 'true',
  'Actual security-definer binding accepts already-SENT settled token-bound completion');
select is(public.service_record_refund_transactional_delivery_event(repeat('d1',32), 'resend_settled_completion_fixture',
  'bounced', statement_timestamp())->>'deliveryState', 'bounced',
  'Actual bound bounce updates token-bound completion delivery without reopening payment');
select is(public.service_record_refund_transactional_delivery_event(repeat('d2',32), 'resend_settled_completion_fixture',
  'complained', statement_timestamp())->>'deliveryState', 'complained',
  'Actual complaint advances settled completion delivery truth');
select is(public.service_record_refund_transactional_delivery_event(repeat('d2',32), 'resend_settled_completion_fixture',
  'complained', statement_timestamp())->>'duplicate', 'true', 'Settled completion provider replay is deduplicated');
reset role;
select is(to_jsonb(c) - array['lifecycle_revision','updated_at'], b.case_value,
  'Settled completion receipt events preserve all case and payment facts')
from public.refund_cases c cross join settled_delivery_before b where c.id = '9a600000-0000-4000-8000-000000000001';
select is(to_jsonb(a), b.attempt_value, 'Settled completion receipt events preserve the entire provider attempt')
from public.refund_case_nayax_refund_attempts a cross join settled_delivery_before b where a.refund_case_id = '9a600000-0000-4000-8000-000000000001';
select is(to_jsonb(f), b.adjustment_value, 'Settled completion receipt events preserve the reporting adjustment')
from public.sales_adjustment_facts f cross join settled_delivery_before b where f.refund_case_id = '9a600000-0000-4000-8000-000000000001';
select is(to_jsonb(m) - array['provider_message_id','delivery_state','delivery_state_updated_at','status','error_message'],
  b.message_value - array['provider_message_id','delivery_state','delivery_state_updated_at','status','error_message'],
  'Settled completion receipts preserve original content, evidence, provider attempt and sent timestamp')
from public.refund_case_messages m cross join settled_delivery_before b
where m.refund_case_id = '9a600000-0000-4000-8000-000000000001' and m.message_type = 'completed';
select is((select count(*) from public.refund_case_messages where refund_case_id = '9a600000-0000-4000-8000-000000000001'
  and message_type = 'completed'), 1::bigint, 'Settled completion receipt processing never creates a second notice');
select ok(not exists(select 1 from pg_trigger where tgrelid in ('public.refund_case_messages'::regclass,
  'public.refund_cases'::regclass, 'public.refund_case_nayax_refund_attempts'::regclass) and not tgisinternal and tgenabled = 'D'),
  'All settled case, message and provider-attempt guards stay enabled');
select * from finish();
rollback;
