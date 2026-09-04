begin;
create extension if not exists pgtap with schema extensions;
set local search_path=public,extensions;
select no_plan();
insert into auth.users(instance_id,id,aud,role,email,encrypted_password,email_confirmed_at,raw_app_meta_data,raw_user_meta_data,created_at,updated_at)
values('00000000-0000-0000-0000-000000000000','ef000000-0000-4000-8000-000000000001','authenticated','authenticated',
  'nonrefund-owner@example.invalid','',now(),'{}','{}',now(),now());
insert into auth.sessions(id,user_id,created_at,updated_at)
values('ef010000-0000-4000-8000-000000000001','ef000000-0000-4000-8000-000000000001',now(),now());
insert into public.admin_roles(user_id,role,active) values('ef000000-0000-4000-8000-000000000001','super_admin',true);
insert into public.customer_accounts(id,name,account_type) values('ef100000-0000-4000-8000-000000000001','Nonrefund fixture','internal');
insert into public.reporting_locations(id,account_id,name,timezone)
values('ef200000-0000-4000-8000-000000000001','ef100000-0000-4000-8000-000000000001','Nonrefund fixture','America/Los_Angeles');
insert into public.reporting_machines(id,account_id,location_id,machine_label,nayax_machine_id,nayax_account_key)
values('ef300000-0000-4000-8000-000000000001','ef100000-0000-4000-8000-000000000001',
  'ef200000-0000-4000-8000-000000000001','Nonrefund fixture','NONREFUND-MACHINE','NONREFUND-ACCOUNT');
insert into public.reporting_machine_refund_managers(reporting_machine_id,manager_user_id,manager_email,grant_reason)
values('ef300000-0000-4000-8000-000000000001','ef000000-0000-4000-8000-000000000001','nonrefund-owner@example.invalid','Nonrefund fixture');
insert into public.refund_cases(id,public_reference,reporting_machine_id,reporting_location_id,customer_email,issue_summary,
  incident_at,payment_method,payment_amount_cents,card_last4,status,automation_state,created_at)
select ('ef400000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid,'RF-NONREFUND-'||n,
  'ef300000-0000-4000-8000-000000000001','ef200000-0000-4000-8000-000000000001',
  'nonrefund-customer@example.invalid','Synthetic nonrefund observation',now()-interval '3 days','card',900,'4242',
  'needs_review','under_review',now()-interval '2 days' from generate_series(1,4) n;
create function pg_temp.owner_auth() returns void language plpgsql as $$ begin
  perform set_config('request.jwt.claim.sub','ef000000-0000-4000-8000-000000000001',true);
  perform set_config('request.jwt.claim.role','authenticated',true);
  perform set_config('request.jwt.claims','{"sub":"ef000000-0000-4000-8000-000000000001","role":"authenticated","session_id":"ef010000-0000-4000-8000-000000000001","is_anonymous":false}',true);
end; $$;
select pg_temp.owner_auth();
create temporary table reviews as select c.id,jsonb_build_object('intent',('ef500000-0000-4000-8000-'||right(c.id::text,12))::uuid,
 'version',c.official_action_version,'facts',c.deterministic_fact_version,'reference',c.public_reference,
 'message','cafe'||right(c.id::text,12),'thread','cafe999999999999','sent',now()-interval '1 day',
 'recipient',c.customer_email,'digest',repeat('a',64),'binding',public.refund_owner_notice_review_binding(),
 'reason','not_operated_by_bloomjoy','owned',true,'exact',true) value from public.refund_cases c where c.id::text like 'ef400000-%';
create function pg_temp.adopt(n integer,changes jsonb default '{}'::jsonb) returns jsonb language plpgsql as $$
declare c uuid:=('ef400000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid; x jsonb;
begin
  select value||changes into x from reviews where id=c;
  return public.admin_adopt_refund_owner_nonrefund_resolution(c,(x->>'intent')::uuid,(x->>'version')::bigint,
    (x->>'facts')::bigint,x->>'reference',x->>'message',x->>'thread',(x->>'sent')::timestamptz,x->>'recipient',
    x->>'digest',x->>'binding',x->>'reason',(x->>'owned')::boolean,(x->>'exact')::boolean);
end; $$;
create function pg_temp.change_and_adopt(setup_sql text,n integer) returns text language plpgsql as $$
declare ready boolean:=false;
begin execute setup_sql; ready:=true; perform pg_temp.adopt(n); raise exception 'Unexpected adoption' using errcode='XX001';
exception when others then if not ready then raise; end if; return sqlstate; end; $$;

select ok(not has_function_privilege(role_name,'public.admin_adopt_refund_owner_nonrefund_resolution(uuid,uuid,bigint,bigint,text,text,text,timestamptz,text,text,text,text,boolean,boolean)','execute'),
  role_name||' cannot adopt as the owner') from unnest(array['anon','service_role']) role_name;
select throws_ok(format('select pg_temp.adopt(1,%L::jsonb)',change),'P4671',null,label)
from (values ('{"version":0}','Stale action version'),('{"facts":99}','Stale fact version'),
  ('{"reference":"RF-NONREFUND-2"}','Other case reference'),('{"recipient":"other@example.invalid"}','Wrong recipient'),
  ('{"owned":false}','Missing Sent observation'),('{"exact":false}','Missing exact disposition observation'),
  ('{"reason":"refund_paid"}','Unsupported reason'),('{"digest":"bad"}','Invalid snapshot digest'),
  ('{"sent":"infinity"}','Nonfinite source time')) invalid(change,label);
select is(pg_temp.change_and_adopt($$delete from auth.sessions where user_id=auth.uid()$$,1),'42501','Revoked session rejected');
select is(pg_temp.change_and_adopt($$update public.admin_roles set active=false where user_id=auth.uid()$$,1),'42501','Revoked owner rejected');
select is(pg_temp.change_and_adopt($$update public.reporting_machine_refund_managers set status='revoked',revoked_at=now(),revoke_reason='Synthetic' where manager_user_id=auth.uid()$$,1),'42501','Revoked mapping rejected');
select is(pg_temp.change_and_adopt($$update auth.users set email_confirmed_at=null where id=auth.uid()$$,1),'42501','Unverified mailbox rejected');
select is(pg_temp.change_and_adopt($$update public.refund_cases set decision='approved' where id='ef400000-0000-4000-8000-000000000001'$$,1),'P4671','Existing approval cannot be overwritten');
select is(pg_temp.change_and_adopt($$update public.refund_cases set case_population='internal_test' where id='ef400000-0000-4000-8000-000000000001'$$,1),'P4671','Internal test is outside adoption scope');
create temporary table before_facts as select c.id,jsonb_build_array(c.customer_email,c.payment_method,c.payment_amount_cents,
 c.card_last4,c.incident_at,c.reporting_machine_id,c.reporting_location_id,c.deterministic_fact_version,
 c.refund_amount_cents,c.matched_nayax_transaction_id,c.refund_completed_at,c.reporting_adjustment_id) value
 from public.refund_cases c where c.id::text like 'ef400000-%';
-- Existing unknown delivery remains unknown; it is not retrospectively called sent/delivered.
insert into public.refund_case_messages(id,refund_case_id,message_type,status,recipient_email,subject,body,sent_at,delivery_transport,delivery_state,delivery_state_updated_at)
values('ef600000-0000-4000-8000-000000000001','ef400000-0000-4000-8000-000000000001','confirmation','sent',
 'nonrefund-customer@example.invalid','Synthetic','Synthetic original',now()-interval '2 days','resend','unknown',now()-interval '2 days');
create temporary table prior_message as select to_jsonb(m) value from public.refund_case_messages m where id='ef600000-0000-4000-8000-000000000001';
-- Exercise the real authenticated RPC, not a service-role impersonation call.
grant select on reviews to authenticated;
set local role authenticated;
select is(pg_temp.adopt(1)->>'status','adopted','Authenticated exact owner adopts the existing resolution');
reset role;
create temporary table adopted_result as select pg_temp.adopt(1) value;
select is((select status from public.refund_cases where id='ef400000-0000-4000-8000-000000000001'),'denied','Existing nonpayment denial lifecycle used');
select is(public.refund_lifecycle_contract('ef400000-0000-4000-8000-000000000001')->>'stage','denied','Unknown old message does not mask terminal resolution');
select is(public.refund_lifecycle_contract('ef400000-0000-4000-8000-000000000001')->>'paymentState','not_issued','No refund is represented as paid');
select is((select decided_at from public.refund_cases where id='ef400000-0000-4000-8000-000000000001'),
 (select (value->>'sent')::timestamptz from reviews where id='ef400000-0000-4000-8000-000000000001'),'Original decision timestamp retained');
select is((select to_jsonb(m) from public.refund_case_messages m where id='ef600000-0000-4000-8000-000000000001'),(select value from prior_message),'Unknown delivery history is byte-for-byte unchanged');
select ok(not exists(select 1 from before_facts b join public.refund_cases c using(id) where b.value is distinct from
 jsonb_build_array(c.customer_email,c.payment_method,c.payment_amount_cents,c.card_last4,c.incident_at,c.reporting_machine_id,
 c.reporting_location_id,c.deterministic_fact_version,c.refund_amount_cents,c.matched_nayax_transaction_id,c.refund_completed_at,c.reporting_adjustment_id)),
 'Customer facts, money and mapping are preserved');
select is((select count(*) from public.refund_case_events where event_type='owner_nonrefund_resolution_adopted'),1::bigint,'Exact replay creates no second observation');
select ok((select metadata->>'notice_verification'='operator_observed_gmail_sent'
 and (metadata->>'adopted_at')::timestamptz>(metadata->>'original_sent_at')::timestamptz
 and metadata::text not like '%example.invalid%' and metadata::text not like '%cafe%'
 from public.refund_case_events where event_type='owner_nonrefund_resolution_adopted'),'Attestation and original/adoption times are distinct; raw identities are excluded');
select throws_ok($$update public.refund_case_events set message='changed' where event_type='owner_nonrefund_resolution_adopted'$$,'42501',null,'Observation cannot be changed');
select throws_ok($$delete from public.refund_case_events where event_type='owner_nonrefund_resolution_adopted'$$,'42501',null,'Observation cannot be erased');
set local role service_role;
select throws_ok($$insert into public.refund_case_events(refund_case_id,event_type) values('ef400000-0000-4000-8000-000000000002','owner_nonrefund_resolution_adopted')$$,'42501',null,'Service cannot forge a dedicated adoption event');
reset role;
select throws_ok($$select pg_temp.adopt(1,'{"digest":"bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb"}')$$,'P4671',null,'Changed evidence is not replay');
-- A later verified customer appeal reuses the existing appeal service. This
-- fixture is a verified support handoff, not invented owner-inbox automation.
insert into public.refund_gmail_threads(id,refund_case_id,mailbox_hash,provider_thread_id,thread_subject,first_message_at,latest_message_at,retention_expires_at)
values('ef700000-0000-4000-8000-000000000001','ef400000-0000-4000-8000-000000000001',repeat('e',64),'appeal-handoff','Synthetic',now(),now(),now()+interval '30 days');
insert into public.refund_gmail_messages(id,gmail_thread_id,refund_case_id,provider_message_id,operation_key,direction,message_kind,status,
 sender_email,recipient_email,subject,plain_body,received_at,retention_expires_at,participant_role,participant_trust)
values('ef800000-0000-4000-8000-000000000001','ef700000-0000-4000-8000-000000000001','ef400000-0000-4000-8000-000000000001',
 'appeal-handoff-1','synthetic-nonrefund-appeal','inbound','message','received','nonrefund-customer@example.invalid','info@bloomjoysweets.com',
 'Synthetic appeal','Please review the same request.',now(),now()+interval '30 days','customer','verified');
select is(public.service_record_refund_denial_appeal('ef400000-0000-4000-8000-000000000001','ef800000-0000-4000-8000-000000000001')->>'appealReceived','true','Verified same-case appeal is supported without a fabricated denial email');
create temporary table after_appeal as select to_jsonb(c) value from public.refund_cases c where id='ef400000-0000-4000-8000-000000000001';
select is(pg_temp.adopt(1),(select value from adopted_result),'Exact replay after appeal returns original result');
select is((select to_jsonb(c) from public.refund_cases c where id='ef400000-0000-4000-8000-000000000001'),(select value from after_appeal),'Replay cannot re-deny or otherwise mutate a reopened case');
select is(public.service_record_refund_denial_appeal('ef400000-0000-4000-8000-000000000001','ef800000-0000-4000-8000-000000000001')->>'appealReceived','false','Repeated inbound appeal remains deduplicated');
select is((select count(*) from public.refund_case_messages where refund_case_id::text like 'ef400000-%'),1::bigint,'No new customer message');
select is((select count(*) from public.refund_case_nayax_refund_attempts where refund_case_id::text like 'ef400000-%'),0::bigint,'No provider attempt');
select is((select count(*) from public.refund_authoritative_receipts where refund_case_id::text like 'ef400000-%'),0::bigint,'No receipt');
select is((select count(*) from public.sales_adjustment_facts where refund_case_id::text like 'ef400000-%'),0::bigint,'No accounting effect');
select * from finish();
rollback;
