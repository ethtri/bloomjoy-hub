-- Run only in the disposable migration-test database. No provider or mail calls.
create extension if not exists pgtap with schema extensions;
create extension if not exists dblink with schema extensions;
set search_path=public,extensions;
select dblink_connect('gift_race_a','host=db port='||current_setting('port')||
  ' dbname='||current_database()||' user=postgres password=postgres sslmode=disable application_name=gift_race_a');
select dblink_connect('gift_race_b','host=db port='||current_setting('port')||
  ' dbname='||current_database()||' user=postgres password=postgres sslmode=disable application_name=gift_race_b');
begin;
alter table public.refund_case_messages disable trigger refund_completion_outbox_postcommit_wakeup;
create schema gift_race_test;
create table gift_race_test.results(lane text primary key,payload jsonb);
insert into public.customer_accounts(id,name,account_type)
 values('fb720000-0000-4000-8000-000000000001','Gift race fixture','internal');
insert into public.reporting_locations(id,account_id,name,timezone)
 values('fb730000-0000-4000-8000-000000000001','fb720000-0000-4000-8000-000000000001','Gift race','UTC');
insert into public.reporting_machines(id,account_id,location_id,machine_label,status)
 values('fb740000-0000-4000-8000-000000000001','fb720000-0000-4000-8000-000000000001',
 'fb730000-0000-4000-8000-000000000001','Gift race','active');
insert into public.refund_gift_card_pools(id,provider,provider_account_id,face_value_cents,
 eligible_machine_ids,eligible_locations,expires_at,enabled,redemption_instructions)
 values('fb750000-0000-4000-8000-000000000001','kemore','gift-race-fixture',1500,
 array['fb740000-0000-4000-8000-000000000001']::uuid[],array['Gift race'],
 now()+interval '30 days',false,'Enter the synthetic code.');
insert into public.refund_gift_card_codes(pool_id,provider,provider_account_id,code,valid_from,expires_at)
 select 'fb750000-0000-4000-8000-000000000001','kemore','gift-race-fixture','synthetic-race-'||n,
 now()-interval '1 day',now()+interval '30 days' from generate_series(1,2)n;
insert into public.refund_cases(id,public_reference,reporting_machine_id,reporting_location_id,
 customer_email,issue_summary,incident_at,payment_method,payment_amount_cents,refund_amount_cents,
 resolution_method,gift_card_pool_id,gift_card_value_cents,gift_card_expires_at,gift_card_state)
 select ('fb760000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid,'RF-GIFT-RACE-'||n,
 'fb740000-0000-4000-8000-000000000001','fb730000-0000-4000-8000-000000000001',
 case when n<=2 then 'gift-race-same@example.invalid' else 'gift-race-'||n||'@example.invalid' end,
 'Synthetic concurrent request',now(),'cash',1100,1100,'gift_card',
 'fb750000-0000-4000-8000-000000000001',1500,now()+interval '30 days','pending_inventory'
 from generate_series(1,4)n;
update public.refund_gift_card_pools set enabled=true where id='fb750000-0000-4000-8000-000000000001';
create function gift_race_test.wait_for_lock() returns boolean language plpgsql as $$
begin
  for i in 1..100 loop
    perform pg_stat_clear_snapshot();
    if exists(select 1 from pg_stat_activity where application_name='gift_race_b' and wait_event_type='Lock') then return true; end if;
    perform pg_sleep(0.01);
  end loop;
  return false;
end $$;
commit;
select no_plan();
select dblink_exec('gift_race_a','begin');
insert into gift_race_test.results select 'first',payload from dblink('gift_race_a',
 $$select public.service_issue_refund_gift_card('fb760000-0000-4000-8000-000000000001')$$) as r(payload jsonb);
select dblink_send_query('gift_race_b',
 $$select public.service_issue_refund_gift_card('fb760000-0000-4000-8000-000000000002')$$);
select ok(gift_race_test.wait_for_lock(),'Concurrent normalized-email requests serialize on the annual allowance');
select dblink_exec('gift_race_a','commit');
insert into gift_race_test.results select 'repeat',payload from dblink_get_result('gift_race_b') as r(payload jsonb);
select * from dblink_get_result('gift_race_b') as r(payload jsonb);
select is((select payload->>'state' from gift_race_test.results where lane='first'),'issued','First concurrent request issues');
select is((select payload->>'state' from gift_race_test.results where lane='repeat'),'manager_review','Waiting request sees committed history and requires one Manager decision');
select is((select count(*) from public.refund_gift_card_issuances where pool_id='fb750000-0000-4000-8000-000000000001'),1::bigint,'Same-email race produces exactly one issuance');
select dblink_exec('gift_race_a','begin');
insert into gift_race_test.results select 'stock_winner',payload from dblink('gift_race_a',
 $$select public.service_issue_refund_gift_card('fb760000-0000-4000-8000-000000000003')$$) as r(payload jsonb);
insert into gift_race_test.results select 'stock_wait',payload from dblink('gift_race_b',
 $$select public.service_issue_refund_gift_card('fb760000-0000-4000-8000-000000000004')$$) as r(payload jsonb);
select is((select payload->>'state' from gift_race_test.results where lane='stock_wait'),'pending_inventory','Locked final code is never assigned to two cases');
select dblink_send_query('gift_race_b',
 $$select public.service_issue_refund_gift_card('fb760000-0000-4000-8000-000000000003')$$);
select ok(gift_race_test.wait_for_lock(),'Same-case replay waits for the original allocation transaction');
select dblink_exec('gift_race_a','commit');
insert into gift_race_test.results select 'replay',payload from dblink_get_result('gift_race_b') as r(payload jsonb);
select * from dblink_get_result('gift_race_b') as r(payload jsonb);
select is((select payload->>'state' from gift_race_test.results where lane='replay'),'issued','Replay returns the committed issuance');
select is((select count(distinct code_id) from public.refund_gift_card_issuances where pool_id='fb750000-0000-4000-8000-000000000001'),2::bigint,'Two actual allocations preserve unique codes');
select is((select count(*) from public.refund_case_messages where refund_case_id in
 (select id from public.refund_cases where public_reference like 'RF-GIFT-RACE-%')),2::bigint,'Concurrent replays create one outbox intent per issuance');
update public.refund_cases set duplicate_of_refund_case_id='fb760000-0000-4000-8000-000000000003'
 where id='fb760000-0000-4000-8000-000000000004';
select lives_ok($$select public.service_resume_refund_gift_card_cases()$$,
 'An unissued duplicate cannot poison the automatic stock-resume sweep');
select dblink_disconnect('gift_race_a');
select dblink_disconnect('gift_race_b');
begin;
alter table public.refund_gift_card_issuances disable trigger refund_gift_card_issuances_immutable;
alter table public.refund_case_messages disable trigger aa_refund_gift_card_message_identity;
delete from public.refund_gift_card_issuances where pool_id='fb750000-0000-4000-8000-000000000001';
delete from public.refund_case_messages where refund_case_id in
 (select id from public.refund_cases where public_reference like 'RF-GIFT-RACE-%');
delete from public.refund_gift_card_codes where pool_id='fb750000-0000-4000-8000-000000000001';
delete from public.refund_cases where public_reference like 'RF-GIFT-RACE-%';
delete from public.refund_gift_card_pools where id='fb750000-0000-4000-8000-000000000001';
delete from public.reporting_machines where id='fb740000-0000-4000-8000-000000000001';
delete from public.reporting_locations where id='fb730000-0000-4000-8000-000000000001';
delete from public.customer_accounts where id='fb720000-0000-4000-8000-000000000001';
alter table public.refund_gift_card_issuances enable trigger refund_gift_card_issuances_immutable;
alter table public.refund_case_messages enable trigger aa_refund_gift_card_message_identity;
alter table public.refund_case_messages enable trigger refund_completion_outbox_postcommit_wakeup;
drop schema gift_race_test cascade;
commit;
select * from finish();
