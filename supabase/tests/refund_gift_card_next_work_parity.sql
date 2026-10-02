begin;
create extension if not exists pgtap with schema extensions;
set local search_path=public,extensions;
select no_plan();
insert into auth.users(id,email) values('ad710000-0000-4000-8000-000000000001','gift-manager@example.invalid');
insert into public.customer_accounts(id,name,account_type)
 values('ad720000-0000-4000-8000-000000000001','Gift-card fixture','internal');
insert into public.reporting_locations(id,account_id,name,timezone)
 values('ad730000-0000-4000-8000-000000000001','ad720000-0000-4000-8000-000000000001','Fixture location','UTC');
insert into public.reporting_machines(id,account_id,location_id,machine_label,status)
 values('ad740000-0000-4000-8000-000000000001','ad720000-0000-4000-8000-000000000001',
 'ad730000-0000-4000-8000-000000000001','Gift fixture machine','active');
insert into public.reporting_machine_refund_managers(reporting_machine_id,manager_user_id,manager_email,grant_reason)
 values('ad740000-0000-4000-8000-000000000001','ad710000-0000-4000-8000-000000000001','gift-manager@example.invalid','Gift fixture');
insert into public.refund_gift_card_pools(id,provider,provider_account_id,face_value_cents,
 eligible_machine_ids,eligible_locations,expires_at,enabled,redemption_instructions)
 values('ad750000-0000-4000-8000-000000000001','kemore','gift-fixture',1500,
 array['ad740000-0000-4000-8000-000000000001']::uuid[],array['Fixture location'],
 now()+interval '30 days',true,'Enter your code at the fixture machine.');
insert into public.refund_gift_card_codes(pool_id,provider,provider_account_id,provider_code_id,code,valid_from,expires_at)
 select 'ad750000-0000-4000-8000-000000000001','kemore','gift-fixture','fixture-'||n,lpad(n::text,9,'0'),
 now()-interval '1 day',now()+interval '30 days' from generate_series(1,1)n;

-- Only disposable synthetic cases/codes. No worker, provider or customer transport.
insert into public.refund_cases(id,public_reference,reporting_machine_id,reporting_location_id,
 customer_email,issue_summary,incident_at,payment_method,payment_amount_cents,refund_amount_cents,
 resolution_method,gift_card_pool_id,gift_card_value_cents,gift_card_expires_at,gift_card_state)
select ('ad760000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid,'RF-GIFT-PARITY-'||n,
 'ad740000-0000-4000-8000-000000000001','ad730000-0000-4000-8000-000000000001',
 case when n<=2 then 'gift-parity@example.invalid' else 'gift-stock@example.invalid' end,
 'Synthetic gift lifecycle',now(),'cash',1100,1100,'gift_card',
 'ad750000-0000-4000-8000-000000000001',1500,now()+interval '30 days','pending_inventory'
from generate_series(1,3)n;
select set_config('request.jwt.claims','{"role":"authenticated","sub":"ad710000-0000-4000-8000-000000000001"}',true);

create function pg_temp.gift_parity(p_id uuid,p_label text)
returns setof text language plpgsql as $$
declare canonical jsonb:=public.refund_lifecycle_contract(p_id);
begin
 return next is(public.refund_next_work_for_case(p_id,canonical),canonical,
   p_label||': shared helper preserves the entire canonical gift lifecycle');
 return next is(public.get_refund_lifecycle_for_manager(p_id)->'nextWork',canonical->'nextWork',
   p_label||': Manager reader preserves canonical actor/action/progress');
 return next is(canonical#>>'{customerAction,action}','none',
   p_label||': customer action retains the common action contract');
end $$;
select is((select gift_card_state from public.refund_cases where public_reference='RF-GIFT-PARITY-1'),
 'issued','Supported allocator issued the first eligible gift');
select * from pg_temp.gift_parity('ad760000-0000-4000-8000-000000000001','Assigned delivery');
select is(public.get_refund_lifecycle_for_manager('ad760000-0000-4000-8000-000000000001')
 #>>'{nextWork,actor}','system','Assigned gift remains System-owned');
select is(public.get_refund_lifecycle_for_manager('ad760000-0000-4000-8000-000000000001')
 #>>'{nextWork,actionCode}','none','Assigned gift never requests purchase research');
select is((select gift_card_state from public.refund_cases where public_reference='RF-GIFT-PARITY-2'),
 'manager_review','Supported annual allowance requests repeat review');
select * from pg_temp.gift_parity('ad760000-0000-4000-8000-000000000002','Repeat review');
select is(public.get_refund_lifecycle_for_manager('ad760000-0000-4000-8000-000000000002')
 #>>'{nextWork,actionCode}','approve_or_deny_request','Repeat review retains the one existing Manager decision');
select is((select gift_card_state from public.refund_cases where public_reference='RF-GIFT-PARITY-3'),
 'pending_inventory','Exhausted synthetic stock retains the accepted request');
select * from pg_temp.gift_parity('ad760000-0000-4000-8000-000000000003','Stock wait');
select is(public.get_refund_lifecycle_for_manager('ad760000-0000-4000-8000-000000000003')
 #>>'{nextWork,actor}','system','Stock wait remains internal System work');
select lives_ok($$select public.admin_decide_refund_gift_card(
 'ad760000-0000-4000-8000-000000000002',false,'Synthetic reviewed denial')$$,
 'Existing supported Manager decision declines the repeat');
select * from pg_temp.gift_parity('ad760000-0000-4000-8000-000000000002','Declined');
select is(public.get_refund_lifecycle_for_manager('ad760000-0000-4000-8000-000000000002')
 #>>'{nextWork,isOpen}','false','Declined gift closes gift work');

-- Seed only the existing synthetic outbox's observed transport state. No send occurs.
update public.refund_case_messages set status='sent',delivery_state='sent',sent_at=now()
 where id=(select message_id from public.refund_gift_card_issuances
 where refund_case_id='ad760000-0000-4000-8000-000000000001')
 or gift_card_issuance_id=(select id from public.refund_gift_card_issuances
 where refund_case_id='ad760000-0000-4000-8000-000000000001');
select is(public.refund_gift_card_case_projection('ad760000-0000-4000-8000-000000000001')
 ->>'delivery_state','sent','Synthetic initial outbox reached sent');
select * from pg_temp.gift_parity('ad760000-0000-4000-8000-000000000001','Sent');
select is(public.get_refund_lifecycle_for_manager('ad760000-0000-4000-8000-000000000001')
 #>>'{nextWork,isOpen}','false','Sent gift is terminal without monetary settlement');
update public.refund_case_messages set delivery_state='delivered'
 where id=(select message_id from public.refund_gift_card_issuances
 where refund_case_id='ad760000-0000-4000-8000-000000000001')
 or gift_card_issuance_id=(select id from public.refund_gift_card_issuances
 where refund_case_id='ad760000-0000-4000-8000-000000000001');
select is(public.refund_gift_card_case_projection('ad760000-0000-4000-8000-000000000001')
 ->>'delivery_state','delivered','Synthetic initial outbox reached delivered');
select * from pg_temp.gift_parity('ad760000-0000-4000-8000-000000000001','Delivered');

select is(public.refund_next_work_for_case('ad760000-0000-4000-8000-000000000001',null),
 null::jsonb,'Null lifecycle behavior remains unchanged');
insert into public.refund_cases(id,public_reference,reporting_machine_id,reporting_location_id,
 customer_email,issue_summary,incident_at,payment_method,payment_amount_cents,refund_amount_cents)
values('ad760000-0000-4000-8000-000000000004','RF-CARD-PARITY',
 'ad740000-0000-4000-8000-000000000001','ad730000-0000-4000-8000-000000000001',
 'card-parity@example.invalid','Synthetic original card request',now(),'card',1100,1100);
select is(public.refund_next_work_for_case('ad760000-0000-4000-8000-000000000004',
 public.refund_lifecycle_contract('ad760000-0000-4000-8000-000000000004')),
 public.refund_next_work_for_case_pre_manager_route_v1('ad760000-0000-4000-8000-000000000004',
 public.refund_lifecycle_contract('ad760000-0000-4000-8000-000000000004')),
 'Ordinary card still delegates to the existing monetary/recommendation projection');
select ok(not has_function_privilege('authenticated',
 'public.refund_next_work_for_case(uuid,jsonb)','execute'),'Shared privileged helper remains private');
select * from finish();
rollback;
