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
select ok(public.can_perform_refund_official_action('b7000000-0000-4000-8000-000000000001','b7400000-0000-4000-8000-000000000001'),
  'The reserved attempt retains manager authority for its provider stages');
select is((select count(*) from public.refund_case_nayax_refund_attempts where execution_verification_id is not null),1::bigint,'Attempt has one immutable verification binding');
select is(pg_temp.reserve_verified(1,null)#>>'{attempt,shouldExecute}','false','Exact replay cannot send a second request');
select is(public.service_get_refund_nayax_execution_verification('verification-executor','b7000000-0000-4000-8000-000000000001','b7400000-0000-4000-8000-000000000001'),null::jsonb,'Consumed verification is not reusable');
select throws_ok($$update public.refund_nayax_execution_verifications set remaining_amount_cents=800$$,null,null,'Saved observation cannot be rewritten');
select lives_ok($$select public.service_record_nayax_refund_provider_stage_v3('verification-executor',
  (select (result#>>'{attempt,attemptId}')::uuid from verified_result),(select result->>'providerClaimToken' from verified_result),
  'request','started',null,null,null,null,repeat('a',64),'nayax-production-account-contract-v2','nayax-provider-journal-v3',
  null,null,null,null,null,null,null,null,null,null,null,null)$$,'Bound fresh attempt may start one request');
select throws_ok($$select public.service_record_nayax_refund_provider_stage_v3('verification-executor',
  (select (result#>>'{attempt,attemptId}')::uuid from verified_result),(select result->>'providerClaimToken' from verified_result),
  'request','started',null,null,null,null,repeat('a',64),'nayax-production-account-contract-v2','nayax-provider-journal-v3',
  null,null,null,null,null,null,null,null,null,null,null,null)$$,'23505',null,'Repeated started marker cannot dispatch a second request');
select throws_ok($$update public.refund_case_nayax_refund_attempts set execution_verification_id=null
  where refund_case_id='b7400000-0000-4000-8000-000000000001'$$,'P4620',null,'Attempt verification cannot be detached');
select pg_temp.record_verification(2);
-- Move the observation into the past only in this isolated owner fixture. The
-- production roles cannot modify observations or their expiry.
alter table public.refund_nayax_execution_verifications disable trigger refund_nayax_execution_verification_immutable;
update public.refund_nayax_execution_verifications set observed_at=observed_at-interval '6 minutes',expires_at=expires_at-interval '6 minutes'
  where refund_case_id='b7400000-0000-4000-8000-000000000002';
alter table public.refund_nayax_execution_verifications enable trigger refund_nayax_execution_verification_immutable;
select throws_ok($$select pg_temp.reserve_verified(2,(select id from public.refund_nayax_execution_verifications
  where refund_case_id='b7400000-0000-4000-8000-000000000002'))$$,'P4620',null,'Expired verification cannot reserve money');
select pg_temp.record_verification(3);
update public.refund_cases set card_last4='1234' where id='b7400000-0000-4000-8000-000000000003';
select throws_ok($$select pg_temp.reserve_verified(3,(select id from public.refund_nayax_execution_verifications
  where refund_case_id='b7400000-0000-4000-8000-000000000003'))$$,'P4620',null,'Changed case invalidates its earlier verification');

-- One actual normal reservation/start/unknown result may be independently
-- confirmed through the existing receipt writer. No second payment or date.
select is(public.refund_receipt_verified_api_attempt('b7400000-0000-4000-8000-000000000001',
  (select (result#>>'{attempt,attemptId}')::uuid from verified_result)),false,'An active provider claim cannot receive a terminal receipt');
select public.service_record_nayax_refund_provider_stage_v3('verification-executor',
  (select (result#>>'{attempt,attemptId}')::uuid from verified_result),(select result->>'providerClaimToken' from verified_result),
  'request','result',200,'unknown',false,null,repeat('b',64),'nayax-production-account-contract-v2','nayax-provider-journal-v3',
  true,'application_json','json_object','1_256',true,true,true,true,true,'string','string',false);
select public.service_settle_nayax_refund_attempt('verification-executor',
  (select (result#>>'{attempt,attemptId}')::uuid from verified_result),
  (select (result#>>'{managerAction,authorizationId}')::uuid from verified_result),
  'b7400000-0000-4000-8000-000000000001','nayax-refund-'||repeat('1',64),800,'USD',
  (select result->>'providerClaimToken' from verified_result),'unknown',null,null,'provider_request_semantic_mismatch');
select ok(public.refund_receipt_verified_api_attempt('b7400000-0000-4000-8000-000000000001',
  (select (result#>>'{attempt,attemptId}')::uuid from verified_result)),'Settled uncertain API attempt has exact immutable purchase authority');
select is(public.admin_get_refund_authoritative_receipt_overview('b7400000-0000-4000-8000-000000000001')->>'attemptBindingKind',
  'verified_authorized_api','Existing receipt view accepts verified API outcome review');
select is(public.admin_get_refund_authoritative_receipt_overview('b7400000-0000-4000-8000-000000000001')->>'canRecord',
  'true','Existing receipt action is available after the API outcome is held');
create function pg_temp.record_api_receipt(status_id integer default 62,scope text default 'VERIFICATION-ACCOUNT',amount integer default 800)
returns jsonb language plpgsql as $$
declare c public.refund_cases%rowtype; begin
  select * into c from public.refund_cases where id='b7400000-0000-4000-8000-000000000001';
  return public.admin_record_refund_authoritative_receipt(c.id,(select (result#>>'{attempt,attemptId}')::uuid from verified_result),
    c.official_action_version,scope,'VERIFICATION-MACHINE',c.matched_nayax_transaction_id,800,amount,'USD',status_id,
    'DTM:NAYAX-'||c.matched_nayax_transaction_id,true);
end $$;
select throws_ok($$select pg_temp.record_api_receipt(63)$$,'P4661',null,'Pending provider status cannot confirm payment');
select throws_ok($$select pg_temp.record_api_receipt(62,'OTHER-ACCOUNT')$$,'P4661',null,'Another account cannot confirm this API attempt');
select throws_ok($$select pg_temp.record_api_receipt(62,'VERIFICATION-ACCOUNT',700)$$,'P4661',null,'Partial evidence cannot confirm the full refund');
select is(pg_temp.record_api_receipt()->>'status','recorded','Independent full refund saves through the existing receipt writer');
select is(pg_temp.record_api_receipt()->>'status','already_recorded','Repeated independent confirmation reuses the same receipt');
select ok((select count(*)=1 and bool_and(settled_at is null and settlement_time_precision='unknown')
  from public.refund_authoritative_receipts where refund_case_id='b7400000-0000-4000-8000-000000000001'),
  'One full-refund receipt preserves unknown settlement time');
select is((select count(*) from public.refund_case_nayax_refund_attempts where refund_case_id='b7400000-0000-4000-8000-000000000001'),
  1::bigint,'Confirmation creates no new payment attempt');
select is((select count(*) from public.sales_adjustment_facts where refund_case_id='b7400000-0000-4000-8000-000000000001'),
  0::bigint,'Unknown settlement date creates no falsely dated adjustment');
select is((select count(*) from public.refund_case_messages where refund_case_id='b7400000-0000-4000-8000-000000000001'),
  0::bigint,'Evidence import does not create a second customer message');
select throws_ok($$insert into public.refund_case_nayax_refund_attempts(refund_case_id,execution_mode,status,idempotency_key,amount_cents)
  values('b7400000-0000-4000-8000-000000000001','manual_portal','manual_review','forbidden-confirmed-retry',800)$$,
  'P4663',null,'Confirmed API refund cannot receive an invented portal retry');

select * from finish();
rollback;
