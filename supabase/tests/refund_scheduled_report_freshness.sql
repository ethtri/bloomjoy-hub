begin;
create extension if not exists pgtap with schema extensions;
set local search_path=public,extensions;
select plan(12);
insert into auth.users(id,aud,role,email,raw_app_meta_data,raw_user_meta_data) values
 ('e2100000-0000-4000-8000-000000000001','authenticated','authenticated','report-ops@example.invalid','{}','{}'),
 ('e2100000-0000-4000-8000-000000000002','authenticated','authenticated','report-manager@example.invalid','{}','{}'),
 ('e2100000-0000-4000-8000-000000000003','authenticated','authenticated','report-outsider@example.invalid','{}','{}');
insert into public.admin_roles(user_id,role,active) values('e2100000-0000-4000-8000-000000000001','super_admin',true);
insert into public.customer_accounts(id,name,account_type) values('e2200000-0000-4000-8000-000000000001','Freshness fixture','internal');
insert into public.reporting_locations(id,account_id,name,timezone) values('e2300000-0000-4000-8000-000000000001','e2200000-0000-4000-8000-000000000001','Freshness fixture','America/Los_Angeles');
insert into public.reporting_machines(id,account_id,location_id,machine_label) values('e2400000-0000-4000-8000-000000000001','e2200000-0000-4000-8000-000000000001','e2300000-0000-4000-8000-000000000001','Freshness fixture');
insert into public.reporting_machine_refund_managers(reporting_machine_id,manager_user_id,manager_email,grant_reason)
 values('e2400000-0000-4000-8000-000000000001','e2100000-0000-4000-8000-000000000002','report-manager@example.invalid','Freshness fixture');
select set_config('request.jwt.claim.sub','e2100000-0000-4000-8000-000000000001',true);
select is(public.get_refund_gmail_health()#>>'{reportFreshness,status}','unobserved','No invented baseline before native message ingestion');
insert into public.nayax_scheduled_report_files(file_digest,received_at,byte_count,row_count,report) values(repeat('2',64),now()-interval '121 minutes',100,1,'{}');
insert into public.nayax_scheduled_report_messages(message_id,file_digest,received_at,delivery_form) values('f001',repeat('2',64),now()-interval '121 minutes','linked_download');
select is(public.get_refund_gmail_health()#>>'{reportFreshness,status}','needs_review','Two-hour local grace flags report delivery review');
select is((public.get_refund_gmail_health()#>>'{reportFreshness,reviewAfter}')::timestamptz,now()-interval '1 minute','Review time uses message receipt, not fresh ingestion time');
select is(public.get_refund_gmail_health()#>>'{reportFreshness,configuredCadenceMinutes}','60','Verified hourly setting is explicit');
select is(public.get_refund_gmail_health()#>>'{reportFreshness,schedulePhaseKnown}','false','No exact next run invented');
insert into public.nayax_scheduled_report_messages(message_id,file_digest,received_at,delivery_form) values('f001',repeat('2',64),now(),'linked_download') on conflict do nothing;
select is(public.get_refund_gmail_health()#>>'{reportFreshness,status}','needs_review','Replay of the same message does not refresh delivery age');
insert into public.nayax_scheduled_report_messages(message_id,file_digest,received_at,delivery_form) values('f002',repeat('2',64),now()-interval '122 minutes','linked_download');
select is(public.get_refund_gmail_health()#>>'{reportFreshness,status}','needs_review','Delayed older message cannot resolve a newer delivery gap');
insert into public.nayax_scheduled_report_messages(message_id,file_digest,received_at,delivery_form) values('f003',repeat('2',64),now()-interval '119 minutes','linked_download');
select is(public.get_refund_gmail_health()#>>'{reportFreshness,status}','recent','Genuinely newer delivery inside local grace clears advisory even if contents repeat');
select is((select count(*) from public.nayax_scheduled_report_messages),3::bigint,'Reading health creates no duplicate or incident records');
select set_config('request.jwt.claim.sub','e2100000-0000-4000-8000-000000000002',true);
select is(public.get_refund_gmail_health()->'reportFreshness','null'::jsonb,'Mapped manager retains Gmail health but no account-wide report evidence');
select set_config('request.jwt.claim.sub','e2100000-0000-4000-8000-000000000003',true);
select throws_ok($$select public.get_refund_gmail_health()$$,'P0001','Refund operations access required','Unprivileged authenticated user remains denied');
select ok(not has_function_privilege('anon','public.get_refund_gmail_health()','execute'),'Anonymous client has no health access');
select * from finish();
rollback;
