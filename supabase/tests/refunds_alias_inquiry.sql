begin;
create extension if not exists pgtap with schema extensions;
set local search_path=public,extensions;
select plan(10);
create temporary table refunds_case_baseline as select count(*) as total from public.refund_cases;
create temporary table refunds_source as
select public.service_ingest_refund_gmail_contact_v1(
  repeat('c',64),'refunds-alias-fixture-thread','refunds-alias-fixture-message',
  '<refunds-alias-fixture-message@example.test>',null,'inbound',false,
  'refunds-alias-customer@example.test','Synthetic Customer','refunds@bloomjoysweets.com',
  'Refund request','I paid and the cotton candy machine did not dispense.',false,
  now()-interval '1 minute',null,'[]'::jsonb,'{}'::text[],
  array['info@bloomjoysweets.com','support@bloomjoysweets.com','refunds@bloomjoysweets.com'],
  'direct_human',false,false,'{}'::text[]) as result;
create temporary table refunds_replay as
select public.service_ingest_refund_gmail_contact_v1(
  repeat('c',64),'refunds-alias-fixture-thread','refunds-alias-fixture-message',
  '<refunds-alias-fixture-message@example.test>',null,'inbound',false,
  'refunds-alias-customer@example.test','Synthetic Customer','refunds@bloomjoysweets.com',
  'Refund request','I paid and the cotton candy machine did not dispense.',false,
  now()-interval '1 minute',null,'[]'::jsonb,'{}'::text[],
  array['info@bloomjoysweets.com','support@bloomjoysweets.com','refunds@bloomjoysweets.com'],
  'direct_human',false,false,'{}'::text[]) as result;
select is((select count(*) from public.refund_cases),(select total from refunds_case_baseline),'Refunds inquiry creates no case before form submission');
select is((select result->>'duplicate' from refunds_replay),'true','Label and recovery discovery reuse the same source message');
select is((select result->>'messageId' from refunds_source),(select result->>'messageId' from refunds_replay),'Both discoveries share one contact message');
select ok(public.service_mark_refund_info_inquiry((select (result->>'messageId')::uuid from refunds_source),'new_refund_inquiry'),'Refunds source uses the shared genuine-inquiry ledger');
select ok(public.service_mark_refund_info_inquiry((select (result->>'messageId')::uuid from refunds_replay),'new_refund_inquiry'),'Replayed classification creates no new obligation');
select ok(not public.service_mark_refund_info_inquiry((select (result->>'messageId')::uuid from refunds_source),'non_refund'),'Unrelated mail cannot acquire a response obligation');
select public.service_set_refund_info_inquiry_enabled(false);
select is(public.service_claim_refund_gmail_contact_first_response(
  (select (result->>'messageId')::uuid from refunds_source),'active',now()-interval '1 hour',
  'refund_first_contact_v1','refunds@bloomjoysweets.com','Please use https://app.bloomjoyusa.com/refunds/request',false)->>'reason',
  'info_inquiry_disabled','Disabled inquiry lane cannot fall through legacy generic reply');
select ok(public.service_set_refund_info_inquiry_enabled(true),'Existing service activation enables the shared lane');
select is(public.service_claim_refund_gmail_contact_first_response(
  (select (result->>'messageId')::uuid from refunds_source),'active',now()-interval '1 hour',
  'refund_first_contact_v1','refunds@bloomjoysweets.com','Please use https://app.bloomjoyusa.com/refunds/request',false)->>'claimed',
  'true','A verified refunds inquiry claims one original-thread response');
select is(public.service_claim_refund_gmail_contact_first_response(
  (select (result->>'messageId')::uuid from refunds_replay),'active',now()-interval '1 hour',
  'refund_first_contact_v1','refunds@bloomjoysweets.com','Please use https://app.bloomjoyusa.com/refunds/request',false)->>'reason',
  'operation_already_exists','Discovery replay cannot claim a second response');
select * from finish();
rollback;
