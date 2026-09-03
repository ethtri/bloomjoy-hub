begin;
create extension if not exists pgtap with schema extensions;
set local search_path = public, extensions;
select no_plan();

insert into auth.users(instance_id,id,aud,role,email,encrypted_password,email_confirmed_at,raw_app_meta_data,raw_user_meta_data,created_at,updated_at)
values('00000000-0000-4000-8000-000000000000','b7000000-0000-4000-8000-000000000001','authenticated','authenticated',
  'verification-manager@example.invalid','',now(),'{}','{}',now(),now());
insert into auth.sessions(id,user_id,created_at,updated_at)
values('b7010000-0000-4000-8000-000000000001','b7000000-0000-4000-8000-000000000001',now(),now());
insert into public.admin_roles(user_id,role,active) values('b7000000-0000-4000-8000-000000000001','super_admin',true);
insert into public.customer_accounts(id,name,account_type) values('b7100000-0000-4000-8000-000000000001','Verification fixture','internal');
insert into public.reporting_locations(id,account_id,name,timezone)
values('b7200000-0000-4000-8000-000000000001','b7100000-0000-4000-8000-000000000001','Verification fixture','America/Chicago');
insert into public.reporting_machines(id,account_id,location_id,machine_label,nayax_machine_id,nayax_account_key,nayax_refunds_enabled)
values('b7300000-0000-4000-8000-000000000001','b7100000-0000-4000-8000-000000000001',
  'b7200000-0000-4000-8000-000000000001','Verification fixture','VERIFICATION-MACHINE','VERIFICATION-ACCOUNT',true);
insert into public.reporting_machine_refund_managers(reporting_machine_id,manager_user_id,manager_email,grant_reason)
values('b7300000-0000-4000-8000-000000000001','b7000000-0000-4000-8000-000000000001','verification-manager@example.invalid','Verification fixture');
insert into public.refund_nayax_provider_callers(caller_id,assertion_digest,status)
values('nayax-card-refund',encode(extensions.digest('verification-executor','sha256'),'hex'),'active')
on conflict(caller_id) do update set assertion_digest=excluded.assertion_digest,status='active';
insert into public.refund_cases(id,public_reference,reporting_machine_id,reporting_location_id,customer_email,issue_summary,
  incident_at,payment_method,payment_amount_cents,refund_amount_cents,card_last4,status,correlation_status,correlation_source,
  correlation_confidence,automation_state,matched_nayax_transaction_id,matched_nayax_amount_cents,matched_nayax_currency_code,
  matched_nayax_machine_auth_time,matched_nayax_site_id,nayax_recommendation_state,nayax_recommendation_policy_version,
  nayax_match_execution_eligible,nayax_refund_execution_status)
select ('b7400000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid,'RF-VERIFY-'||n,
  'b7300000-0000-4000-8000-000000000001','b7200000-0000-4000-8000-000000000001',
  'verification-customer@example.invalid','Synthetic verification fixture',now()-interval '3 days','card',800,800,'4242',
  'needs_review','matched','nayax',1,'approved',(723456780+n)::text,800,'USD','2026-08-26T18:17:09.810Z',6,
  'high_confidence','2026-07-21.v1',true,'not_requested' from generate_series(1,5) n;
insert into public.refund_case_events(refund_case_id,actor_user_id,event_type,message,metadata)
select ('b7400000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid,'b7000000-0000-4000-8000-000000000001',
  'nayax_match_selected','Synthetic exact selection','{"payload_redacted":true}' from generate_series(1,5) n;
select set_config('request.jwt.claims','{"sub":"b7000000-0000-4000-8000-000000000001","role":"authenticated","session_id":"b7010000-0000-4000-8000-000000000001","is_anonymous":false}',true);
select set_config('request.jwt.claim.sub','b7000000-0000-4000-8000-000000000001',true);
select set_config('request.jwt.claim.role','authenticated',true);

create function pg_temp.record_verification(n integer,changes jsonb default '{}') returns jsonb language plpgsql as $$
declare cid uuid:=('b7400000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid; v bigint; x jsonb;
begin
  select official_action_version into v from public.refund_cases where id=cid;
  x:=jsonb_build_object('version',v,'original',(723456780+n)::text,'scope','VERIFICATION-ACCOUNT',
    'machine','VERIFICATION-MACHINE','site',6,'time','2026-08-26T13:17:08.123','amount',800,'refunded',0,
    'remaining',800,'currency','USD','reference','DTM:NAYAX-'||(723456780+n)::text,'noPending',true,'exclusive',true)||changes;
  return public.admin_record_refund_nayax_execution_verification(cid,(x->>'version')::bigint,x->>'original',x->>'scope',
    x->>'machine',(x->>'site')::integer,x->>'time',(x->>'amount')::integer,(x->>'refunded')::integer,
    (x->>'remaining')::integer,x->>'currency',x->>'reference',(x->>'noPending')::boolean,(x->>'exclusive')::boolean);
end $$;
create function pg_temp.reserve_verified(n integer,verification_id uuid) returns jsonb language plpgsql as $$
declare cid uuid:=('b7400000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid; v bigint;
begin
  select official_action_version into v from public.refund_cases where id=cid;
  return public.service_reserve_nayax_refund_manager_action_v3('verification-executor',
    'b7000000-0000-4000-8000-000000000001',cid,v,'nayax-refund-'||repeat(n::text,64),800,null,null,'USD',
    'nayax-production-account-contract-v2','nayax-provider-journal-v3',verification_id);
end $$;

select ok(not has_table_privilege('authenticated','public.refund_nayax_execution_verifications','select'),'Private observations have no browser table access');
select ok(not has_table_privilege('service_role','public.refund_nayax_execution_verifications','insert'),'Service cannot manufacture portal observations');
select ok(not has_function_privilege('service_role','public.admin_record_refund_nayax_execution_verification(uuid,bigint,text,text,text,integer,text,integer,integer,integer,text,text,boolean,boolean)','execute'),'Service cannot impersonate observing manager');
select throws_ok($$select pg_temp.reserve_verified(1,null)$$,'P4620',null,'No reservation without fresh evidence');
set local role authenticated;
select throws_ok($$select pg_temp.record_verification(1,'{"refunded":100,"remaining":700}')$$,'P4620',null,'Partial refunds stay in reconciliation');
select throws_ok($$select pg_temp.record_verification(1,'{"noPending":false}')$$,'P4620',null,'Pending refund cannot unlock another request');
select throws_ok($$select pg_temp.record_verification(1,'{"exclusive":false}')$$,'P4620',null,'Uncoordinated portal execution cannot unlock API');
select throws_ok($$select pg_temp.record_verification(1,'{"scope":"OTHER-ACCOUNT"}')$$,'P4620',null,'Wrong account rejected');
select throws_ok($$select pg_temp.record_verification(1,'{"original":"723456782"}')$$,'P4620',null,'Another purchase cannot supply the evidence');
select throws_ok($$select pg_temp.record_verification(1,'{"version":-1}')$$,'P4620',null,'Stale case review rejected');
select throws_ok($$select pg_temp.record_verification(1,'{"time":"2026-02-30T13:17:08"}')$$,'22008',null,'Impossible machine date rejected');
select lives_ok($$select pg_temp.record_verification(1)$$,'Current manager records exact portal observation');
reset role;
select is((select machine_auth_time_raw from public.refund_nayax_execution_verifications where refund_case_id='b7400000-0000-4000-8000-000000000001'),
  '2026-08-26T13:17:08.123','Original raw machine time preserved independently of old GMT field');
select is((select count(*) from public.refund_case_nayax_refund_attempts where refund_case_id='b7400000-0000-4000-8000-000000000001'),0::bigint,'Evidence recording creates no payment attempt');
select is(public.refund_case_nayax_manager_readiness('b7000000-0000-4000-8000-000000000001','b7400000-0000-4000-8000-000000000001')->>'canIssueCardRefund','true','Fresh full balance unlocks database readiness');
select throws_ok($$select pg_temp.reserve_verified(2,(select id from public.refund_nayax_execution_verifications limit 1))$$,'P4620',null,'Verification cannot move to another case');
create temporary table verified_result as select pg_temp.reserve_verified(1,(select id from public.refund_nayax_execution_verifications where refund_case_id='b7400000-0000-4000-8000-000000000001')) as result;
select is((select result#>>'{attempt,shouldExecute}' from verified_result),'true','Existing manager confirmation reserves one attempt');
select is((select count(*) from public.refund_case_nayax_refund_attempts where execution_verification_id is not null),1::bigint,'Attempt has one immutable verification binding');
select is(pg_temp.reserve_verified(1,null)#>>'{attempt,shouldExecute}','false','Exact replay cannot send a second request');
select is(public.service_get_refund_nayax_execution_verification('verification-executor','b7000000-0000-4000-8000-000000000001','b7400000-0000-4000-8000-000000000001'),null::jsonb,'Consumed verification is not reusable');
select throws_ok($$update public.refund_nayax_execution_verifications set remaining_amount_cents=800$$,null,null,'Saved observation cannot be rewritten');

select * from finish();
rollback;
