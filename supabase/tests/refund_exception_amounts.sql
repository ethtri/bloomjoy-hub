begin;
create extension if not exists pgtap with schema extensions;
set local search_path=public,extensions;
select no_plan();
insert into auth.users(id,email) values('fa010000-0000-4000-8000-000000000001','exception-manager@example.invalid');
insert into public.customer_accounts(id,name,account_type) values('fa020000-0000-4000-8000-000000000001','Exceptions fixture','internal');
insert into public.reporting_locations(id,account_id,name,timezone) values('fa030000-0000-4000-8000-000000000001','fa020000-0000-4000-8000-000000000001','Exceptions venue','UTC');
insert into public.reporting_machines(id,account_id,location_id,machine_label,status) values('fa040000-0000-4000-8000-000000000001','fa020000-0000-4000-8000-000000000001','fa030000-0000-4000-8000-000000000001','Exceptions machine','active');
insert into public.reporting_machine_refund_managers(reporting_machine_id,manager_user_id,manager_email,grant_reason)
  values('fa040000-0000-4000-8000-000000000001','fa010000-0000-4000-8000-000000000001','exception-manager@example.invalid','Synthetic fixture');
insert into public.refund_gift_card_pools(id,provider,provider_account_id,face_value_cents,eligible_machine_ids,eligible_locations,expires_at,enabled,redemption_instructions)
select ('fa050000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid,'kemore','exception-fixture',n,
  array['fa040000-0000-4000-8000-000000000001']::uuid[],array['Exceptions venue'],now()+interval '30 days',true,'Enter the fixture code.'
from unnest(array[1000,2500,3000,9000])n;
insert into public.refund_gift_card_codes(pool_id,provider,provider_account_id,provider_code_id,code,valid_from,expires_at)
select ('fa050000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid,'kemore','exception-fixture','exception-'||n,lpad(n::text,9,'0'),now()-interval '1 day',now()+interval '30 days'
from unnest(array[1000,2500])n;

insert into public.refund_cases(id,public_reference,reporting_machine_id,reporting_location_id,customer_email,issue_summary,incident_at,payment_method,payment_amount_cents,refund_amount_cents,
 resolution_method,gift_card_pool_id,gift_card_value_cents,gift_card_expires_at,gift_card_state,issue_category,affected_amount_cents,cash_inserted_amount_cents,expected_change_amount_cents)
values
('fa060000-0000-4000-8000-000000000001','RF-EXCEPTION-25','fa040000-0000-4000-8000-000000000001','fa030000-0000-4000-8000-000000000001','first25@example.invalid','Synthetic issue',now(),'cash',2500,2500,'gift_card','fa050000-0000-4000-8000-000000002500',2500,now()+interval '30 days','pending_inventory','other',null,null,null),
('fa060000-0000-4000-8000-000000000002','RF-EXCEPTION-PARTIAL','fa040000-0000-4000-8000-000000000001','fa030000-0000-4000-8000-000000000001','partial@example.invalid','Synthetic issue',now(),'cash',3000,3000,'gift_card','fa050000-0000-4000-8000-000000003000',3000,now()+interval '30 days','pending_inventory','partial_items',3000,null,null),
('fa060000-0000-4000-8000-000000000003','RF-EXCEPTION-CHANGE','fa040000-0000-4000-8000-000000000001','fa030000-0000-4000-8000-000000000001','change@example.invalid','Synthetic issue',now(),'cash',1000,0,'gift_card','fa050000-0000-4000-8000-000000009000',9000,now()+interval '30 days','pending_inventory','expected_cash_change',9000,10000,9000),
('fa060000-0000-4000-8000-000000000004','RF-EXCEPTION-HIGH','fa040000-0000-4000-8000-000000000001','fa030000-0000-4000-8000-000000000001','high@example.invalid','Synthetic issue',now(),'card',2501,2501,'gift_card','fa050000-0000-4000-8000-000000003000',3000,now()+interval '30 days','pending_inventory','other',null,null,null);
select is((select gift_card_state from public.refund_cases where id='fa060000-0000-4000-8000-000000000001'),'issued','Exactly $25 first gift issues automatically');
select is((select gift_card_state from public.refund_cases where id='fa060000-0000-4000-8000-000000000002'),'manager_review','Partial goes to review with no stock for provisional $30');
select is((select gift_card_state from public.refund_cases where id='fa060000-0000-4000-8000-000000000003'),'manager_review','Cash change goes to review with no stock for $90');
select is((select gift_card_state from public.refund_cases where id='fa060000-0000-4000-8000-000000000004'),'manager_review','$25.01 rounds to $30 and requires review');
select is(public.refund_gift_card_review_reasons('fa060000-0000-4000-8000-000000000002'),array['partial_items','gift_value_over_25'],'Multiple reasons share one existing decision');
select throws_ok($$select public.admin_decide_refund_gift_card('fa060000-0000-4000-8000-000000000002',true,null,1000)$$,'42501',null,'Anonymous cannot edit or approve amount');
select set_config('request.jwt.claims','{"role":"authenticated","sub":"fa010000-0000-4000-8000-000000000001"}',true);
select lives_ok($$select public.admin_decide_refund_gift_card('fa060000-0000-4000-8000-000000000002',true,null,1000)$$,'One decision changes a $30 partial case to a $10 gift');
select results_eq($$select purchase_amount_cents,affected_purchase_amount_cents,face_value_cents,goodwill_amount_cents from public.refund_gift_card_issuances where refund_case_id='fa060000-0000-4000-8000-000000000002'$$,
  $$select 3000::integer,1000::integer,1000::integer,0::integer$$,'Original, affected amount, gift face and goodwill are separate');
select is((select refund_amount_cents from public.refund_cases where id='fa060000-0000-4000-8000-000000000002'),1000,'Accounting request adjusts only the affected portion');
select is(private.refund_gift_card_resolved_purchase_cents('fa060000-0000-4000-8000-000000000002',current_date),1000::bigint,'Reporting resolves the affected amount only');
select lives_ok($$select public.admin_decide_refund_gift_card('fa060000-0000-4000-8000-000000000002',true,null,1000)$$,'Same decision replay allocates no second code');
select throws_ok($$select public.admin_decide_refund_gift_card('fa060000-0000-4000-8000-000000000002',true,null,1500)$$,'P4620',null,'Changed replay amount rejects');
select is((select count(*) from public.refund_gift_card_issuances where refund_case_id='fa060000-0000-4000-8000-000000000002'),1::bigint,'One immutable issuance');
select lives_ok($$select public.admin_decide_refund_gift_card('fa060000-0000-4000-8000-000000000003',true,null,2500)$$,'Manager may offer $25 courtesy for expected $90 change');
select is((select gift_card_state from public.refund_cases where id='fa060000-0000-4000-8000-000000000003'),'pending_inventory','Approval waits for final approved denomination stock');
select is((select payment_amount_cents from public.refund_cases where id='fa060000-0000-4000-8000-000000000003'),1000,'$100 inserted never overwrites the $10 recorded sale');
select is((select refund_amount_cents from public.refund_cases where id='fa060000-0000-4000-8000-000000000003'),0,'Change courtesy never deducts the purchase');
select ok(not has_function_privilege('anon','public.admin_approve_selected_nayax_refund_for_system_v2(uuid,bigint,integer)','EXECUTE'),'Public cannot approve card amount');
select * from finish();
rollback;
