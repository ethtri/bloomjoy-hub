begin;
create extension if not exists pgtap with schema extensions;
set local search_path=public,extensions;
select no_plan();

select ok((select count(*)=4 from information_schema.columns where table_schema='public' and table_name='refund_cases'
  and column_name in ('card_last4_source','wallet_device_kind','incident_time_source','nearby_attempt_count')),
  'Ambiguity context is stored as four structured case facts');
select is(public.canonical_refund_follow_up_fields(array['amount','nearby_attempt_count','card_last4_source','card_last4','incident_time_source']),
  array['incident_time_source','card_last4','card_last4_source','nearby_attempt_count','amount']::text[],
  'Structured follow-up fields have one stable order and no duplicate prompts');
select ok(position('insert_card' in pg_get_constraintdef((select oid from pg_constraint where conname='refund_cases_payment_interaction_check'))) > 0
  and position('swipe_card' in pg_get_constraintdef((select oid from pg_constraint where conname='refund_cases_payment_interaction_check'))) > 0,
  'Insert and swipe remain distinct payment interactions');
select ok(not has_function_privilege('anon','public.service_submit_refund_purchase_correction(text,bigint,jsonb)','execute'),
  'Anonymous callers cannot bypass the scoped correction edge handler');
select ok(not has_function_privilege('authenticated','public.refund_purchase_correction_request_fields(uuid)','execute'),
  'Customers cannot enumerate internal candidate-derived correction scope');

select * from finish();
rollback;
