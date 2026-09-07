begin;
create extension if not exists pgtap with schema extensions;
set local search_path=public,extensions;
select no_plan();
insert into auth.users(instance_id,id,aud,role,email,encrypted_password,email_confirmed_at,raw_app_meta_data,raw_user_meta_data,created_at,updated_at)
values('00000000-0000-0000-0000-000000000000','bd000000-0000-4000-8000-000000000001','authenticated','authenticated',
  'historical-owner@example.invalid','',now(),'{}','{}',now(),now()),
  ('00000000-0000-0000-0000-000000000000','bd000000-0000-4000-8000-000000000002','authenticated','authenticated',
  'historical-outsider@example.invalid','',now(),'{}','{}',now(),now());
insert into auth.sessions(id,user_id,created_at,updated_at)
values('bd010000-0000-4000-8000-000000000001','bd000000-0000-4000-8000-000000000001',now(),now()),
  ('bd010000-0000-4000-8000-000000000002','bd000000-0000-4000-8000-000000000001',now(),now()),
  ('bd010000-0000-4000-8000-000000000003','bd000000-0000-4000-8000-000000000002',now(),now());
insert into public.admin_roles(user_id,role,active) values('bd000000-0000-4000-8000-000000000001','super_admin',true);
insert into public.customer_accounts(id,name,account_type) values('bd100000-0000-4000-8000-000000000001','Historical fixture','internal');
insert into public.reporting_locations(id,account_id,name,timezone)
values('bd200000-0000-4000-8000-000000000001','bd100000-0000-4000-8000-000000000001','Historical fixture','America/Los_Angeles');
insert into public.reporting_machines(id,account_id,location_id,machine_label,nayax_machine_id,nayax_account_key)
values('bd300000-0000-4000-8000-000000000001','bd100000-0000-4000-8000-000000000001',
  'bd200000-0000-4000-8000-000000000001','Historical fixture','HISTORICAL-MACHINE','HISTORICAL-ACCOUNT');
insert into public.reporting_machine_refund_managers(reporting_machine_id,manager_user_id,manager_email,grant_reason)
values('bd300000-0000-4000-8000-000000000001','bd000000-0000-4000-8000-000000000001','historical-owner@example.invalid','Historical fixture');
insert into public.refund_cases(id,public_reference,reporting_machine_id,reporting_location_id,customer_email,issue_summary,
  incident_at,payment_method,payment_amount_cents,refund_amount_cents,card_last4,status,correlation_status,correlation_source,
  correlation_confidence,automation_state,matched_nayax_transaction_id,matched_nayax_amount_cents,matched_nayax_currency_code,
  matched_nayax_machine_auth_time,lifecycle_integrity_status,lifecycle_integrity_code,lifecycle_integrity_detected_at)
select ('bd400000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid,'RF-HISTORICAL-'||n,
  'bd300000-0000-4000-8000-000000000001','bd200000-0000-4000-8000-000000000001',
  'historical-customer@example.invalid','Synthetic historical notice',now()-interval '3 days','card',700,700,'4242',
  'card_refund_pending','matched','nayax',1,'approved',(223456780+n)::text,700,'USD',now()-interval '3 days',
  'hold','card_payment_state_without_attempt',now()-interval '1 day' from generate_series(1,4) n;

-- Original historical message is not ingested or changed by external adoption.
insert into public.refund_case_messages(id,refund_case_id,message_type,status,recipient_email,subject,body,sent_at,
  delivery_transport,delivery_state,delivery_state_updated_at)
values('bd600000-0000-4000-8000-000000000001','bd400000-0000-4000-8000-000000000001','confirmation','sent',
  'historical-customer@example.invalid','Original confirmation','Synthetic unchanged history',
  '2026-09-01T12:00:00Z','resend','unknown','2026-09-01T12:00:00Z');
with inserted as (
  insert into public.refund_case_nayax_refund_attempts(refund_case_id,actor_user_id,execution_mode,status,
    idempotency_key,amount_cents,provider_reference,provider_status,request_fingerprint,currency_code,
    provider_outcome,reconciliation_required,safe_transport_stage,safe_failure_class,created_at)
  select c.id,'bd000000-0000-4000-8000-000000000001','manual_portal','manual_review',
    'manual-nayax-portal-20260901-'||c.public_reference,700,c.matched_nayax_transaction_id,'request_accepted',
    encode(extensions.digest(convert_to(c.id::text||'|'||c.matched_nayax_transaction_id||'|700','UTF8'),'sha256'),'hex'),
    'USD','unknown',true,'confirmation_hold','provider_unknown','2026-09-01T18:00:00Z'
  from public.refund_cases c where c.id='bd400000-0000-4000-8000-000000000001'
  returning id,refund_case_id,actor_user_id,created_at
)
insert into public.refund_case_events(refund_case_id,actor_user_id,event_type,message,metadata,created_at)
select refund_case_id,actor_user_id,'manual_nayax_refund_reconciliation_created','Synthetic historical registration',
  jsonb_build_object('attempt_id',id,'provider_outcome','unknown','provider_call_made',true,
    'settlement_confirmation_required',true,'payload_redacted',true),created_at from inserted;

create function pg_temp.owner_auth() returns void language plpgsql as $$ begin
  perform set_config('request.jwt.claim.sub','bd000000-0000-4000-8000-000000000001',true);
  perform set_config('request.jwt.claim.role','authenticated',true);
  perform set_config('request.jwt.claims','{"sub":"bd000000-0000-4000-8000-000000000001","role":"authenticated","session_id":"bd010000-0000-4000-8000-000000000001","is_anonymous":false}',true);
end; $$;
select pg_temp.owner_auth();
select public.admin_record_refund_authoritative_receipt(c.id,a.id,c.official_action_version,'HISTORICAL-ACCOUNT','HISTORICAL-MACHINE',
  c.matched_nayax_transaction_id,700,700,'USD',62,'DTM:NAYAX-'||c.matched_nayax_transaction_id,true)
from public.refund_cases c left join public.refund_case_nayax_refund_attempts a on a.refund_case_id=c.id
where c.id in ('bd400000-0000-4000-8000-000000000001','bd400000-0000-4000-8000-000000000002','bd400000-0000-4000-8000-000000000003');
select set_config('test.owner_review_binding',public.admin_get_refund_authoritative_receipt_overview('bd400000-0000-4000-8000-000000000001')->>'historicalOwnerReviewBinding',true);
create function pg_temp.adopt_owner(n integer,changes jsonb default '{}'::jsonb) returns jsonb language plpgsql as $$
declare c public.refund_cases%rowtype; r uuid; x jsonb;
begin
  select * into c from public.refund_cases where id=('bd400000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid;
  select id into r from public.refund_authoritative_receipts where refund_case_id=c.id;
  x:=jsonb_build_object('receipt',r,'version',c.official_action_version,'caseReference',c.public_reference,
    'original',c.matched_nayax_transaction_id,'amount',700,'currency','USD','message','cafe000000000001','thread','cafe000000000099',
    'sentAt','2026-09-02T16:07:00Z','recipient','historical-customer@example.invalid','digest',repeat('b',64),
    'reference','GMAIL-SENT:cafe000000000001','owned',true,'recipientReviewed',true,'claimReviewed',true,
    'reviewBinding',current_setting('test.owner_review_binding'))||changes;
  return public.admin_record_refund_historical_owner_notice(c.id,(x->>'receipt')::uuid,(x->>'version')::bigint,
    x->>'caseReference',x->>'original',(x->>'amount')::integer,x->>'currency',x->>'message',x->>'thread',
    (x->>'sentAt')::timestamptz,x->>'recipient',x->>'digest',x->>'reference',(x->>'owned')::boolean,
    (x->>'recipientReviewed')::boolean,(x->>'claimReviewed')::boolean,x->>'reviewBinding');
end; $$;
create function pg_temp.change_and_adopt(setup_sql text,n integer) returns text language plpgsql as $$
declare setup_done boolean:=false;
begin execute setup_sql; setup_done:=true; perform pg_temp.adopt_owner(n); raise exception 'Unexpected adoption' using errcode='XX001';
exception when others then if not setup_done then raise; end if; return sqlstate; end; $$;

select ok(not has_table_privilege(role_name,'public.refund_external_notice_observations','select')
  and not has_table_privilege(role_name,'public.refund_external_notice_observations','insert'),role_name||' cannot directly read/write historical evidence')
from unnest(array['anon','authenticated','service_role']) role_name;
select ok(not has_function_privilege(role_name,
  'public.admin_record_refund_historical_owner_notice(uuid,uuid,bigint,text,text,integer,text,text,text,timestamptz,text,text,text,boolean,boolean,boolean,text)','execute'),
  role_name||' cannot impersonate current owner review') from unnest(array['anon','service_role']) role_name;
select ok(not has_function_privilege('authenticated','public.admin_get_refund_receipt_overview_pre_owner_notice_v1(uuid)','execute'),
  'Old reader delegate is private');
select ok(not has_function_privilege(role_name,'public.refund_owner_notice_review_binding()','execute'),
  role_name||' cannot directly call the private review-binding helper') from unnest(array['anon','authenticated','service_role']) role_name;
select ok(current_setting('test.owner_review_binding') ~ '^[a-f0-9]{64}$',
  'Authorized overview gives an opaque binding, never raw user identity or session ID');
select is(public.admin_get_refund_authoritative_receipt_overview('bd400000-0000-4000-8000-000000000001')->>'historicalOwnerNoticeAvailable','true',
  'Current verified mapped owner can review a historical notice only after a receipt');
select is(public.admin_get_refund_authoritative_receipt_overview('bd400000-0000-4000-8000-000000000004')->>'historicalOwnerNoticeAvailable','false',
  'Other pending claim without payment-confirmed receipt has no historical adoption action');
select throws_ok($$select pg_temp.adopt_owner(4)$$,'P4664',null,'No receipt means no adoption regardless of shared thread');
select throws_ok(format('select pg_temp.adopt_owner(1,%L::jsonb)',change),'P4664',null,label)
from (values
  ('{"version":0}','Stale case version is rejected'),
  ('{"receipt":null}','Missing receipt cannot be supplied by observation'),
  ('{"reviewBinding":null}','Missing current-owner review binding is rejected'),
  ('{"reviewBinding":"ffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff"}','Forged current-owner review binding is rejected'),
  ('{"caseReference":"RF-HISTORICAL-4"}','Another case reference is rejected'),
  ('{"original":"223456784"}','Another original cannot replace the selected receipt'),
  ('{"amount":1400}','Combined thread amount cannot substitute exact claim amount'),
  ('{"currency":"EUR"}','Receipt currency cannot be replaced'),
  ('{"recipient":"different@example.invalid"}','Exact customer-only recipient must match current case'),
  ('{"owned":false}','Owned mailbox SENT attestation is mandatory'),
  ('{"recipientReviewed":null}','Missing no-CC review is rejected'),
  ('{"claimReviewed":false}','Exact case and amount review is mandatory'),
  ('{"sentAt":"2026-09-02T19:51:59Z"}','After-cutoff mail is not historical evidence'),
  ('{"sentAt":"infinity"}','Infinite sent time is rejected'),
  ('{"sentAt":null}','Missing original sent time is rejected'),
  ('{"message":"CAFE000000000001"}','Uppercase provider identity cannot bypass deduplication'),
  ('{"thread":"<rfc-message-id>"}','RFC or browser IDs cannot masquerade as API thread IDs'),
  ('{"digest":"not-a-digest"}','Reviewed-message fingerprint must be exact SHA256'),
  ('{"reference":"GMAIL-SENT:another"}','Evidence reference must bind exact provider message')
) invalid(change,label);
select is(pg_temp.change_and_adopt($$update auth.users set email_confirmed_at=null where id=auth.uid()$$,1),'42501','Unverified email cannot claim mailbox ownership');
select is(pg_temp.change_and_adopt($$update auth.users set email='info@bloomjoysweets.com' where id=auth.uid()$$,1),'42501','Support mailbox cannot bypass its existing provider ingestion proof');
select is(pg_temp.change_and_adopt($$select set_config('request.jwt.claims','{"sub":"bd000000-0000-4000-8000-000000000001","role":"authenticated","session_id":"bd010000-0000-4000-8000-000000000002","is_anonymous":false}',true)$$,1),
  'P4664','New valid session cannot reuse the previous session checked review');
select is(pg_temp.change_and_adopt($setup$
  insert into public.admin_roles(user_id,role,active) values('bd000000-0000-4000-8000-000000000002','super_admin',true);
  insert into public.reporting_machine_refund_managers(reporting_machine_id,manager_user_id,manager_email,grant_reason)
    values('bd300000-0000-4000-8000-000000000001','bd000000-0000-4000-8000-000000000002','historical-outsider@example.invalid','Synthetic second authorized owner');
  select set_config('request.jwt.claim.sub','bd000000-0000-4000-8000-000000000002',true);
  select set_config('request.jwt.claims','{"sub":"bd000000-0000-4000-8000-000000000002","role":"authenticated","session_id":"bd010000-0000-4000-8000-000000000003","is_anonymous":false}',true)
$setup$,1),'P4664','Another verified fully authorized owner cannot inherit the old checked review');
select is(pg_temp.change_and_adopt($$delete from auth.sessions where user_id=auth.uid()$$,1),'42501','Revoked current session prevents observation');
select is(pg_temp.change_and_adopt($$update public.admin_roles set active=false where user_id=auth.uid()$$,1),'42501','Revoked Super Admin cannot observe');
select is(pg_temp.change_and_adopt($$update public.reporting_machine_refund_managers set status='revoked',revoked_at=now(),revoke_reason='Synthetic revoked mapping' where manager_user_id=auth.uid()$$,1),
  '42501','Revoked current machine mapping prevents observation');
select is((select count(*) from public.refund_external_notice_observations),0::bigint,'All failed reviews leave no partial external evidence');
select is((select count(*) from public.refund_completion_notice_adoptions),0::bigint,'All failed reviews leave no canonical adoption');
create temporary table owner_case_before as select id,to_jsonb(c)-array['lifecycle_revision','updated_at'] as value from public.refund_cases c where id::text like 'bd400000-%';
create temporary table owner_message_before as select to_jsonb(m) as value from public.refund_case_messages m where id='bd600000-0000-4000-8000-000000000001';
create temporary table owner_attempt_before as select to_jsonb(a) as value from public.refund_case_nayax_refund_attempts a where refund_case_id='bd400000-0000-4000-8000-000000000001';
select set_config('test.owner_receipt_id',(select id::text from public.refund_authoritative_receipts where refund_case_id='bd400000-0000-4000-8000-000000000001'),true);
select set_config('test.owner_case_version',(select official_action_version::text from public.refund_cases where id='bd400000-0000-4000-8000-000000000001'),true);
set local role authenticated;
select is(public.admin_record_refund_historical_owner_notice('bd400000-0000-4000-8000-000000000001',
  current_setting('test.owner_receipt_id')::uuid,current_setting('test.owner_case_version')::bigint,
  'RF-HISTORICAL-1','223456781',700,'USD','cafe000000000001','cafe000000000099','2026-09-02T16:07:00Z',
  'historical-customer@example.invalid',repeat('b',64),'GMAIL-SENT:cafe000000000001',true,true,true,current_setting('test.owner_review_binding'))->>'status',
  'adopted','Actual authenticated owner records one historical notice atomically');
select is(public.admin_record_refund_historical_owner_notice('bd400000-0000-4000-8000-000000000001',
  current_setting('test.owner_receipt_id')::uuid,current_setting('test.owner_case_version')::bigint,
  'RF-HISTORICAL-1','223456781',700,'USD','cafe000000000001','cafe000000000099','2026-09-02T16:07:00Z',
  'historical-customer@example.invalid',repeat('b',64),'GMAIL-SENT:cafe000000000001',true,true,true,current_setting('test.owner_review_binding'))->>'status',
  'already_adopted','Exact reviewed evidence replay has no second effect');
reset role;
select is((select count(*) from public.refund_external_notice_observations),1::bigint,'One external observation');
select is((select count(*) from public.refund_completion_notice_adoptions),1::bigint,'One canonical adoption');
select ok((select sender_email='historical-owner@example.invalid' and observed_by='bd000000-0000-4000-8000-000000000001'
  and verification='operator_observed_gmail_sent' and manager_cc_verified=false and support_thread=false and delivery_verification='unknown'
  and sent_at='2026-09-02T16:07:00Z' and observed_at>=transaction_timestamp() from public.refund_external_notice_observations),
  'Server derives owned identity; original SENT and current observation remain separate from delivery');
select is((select provider_message_digest from public.refund_completion_notice_adoptions),
  encode(extensions.digest(convert_to(encode(extensions.digest(convert_to('historical-owner@example.invalid','UTF8'),'sha256'),'hex')||'|cafe000000000001','UTF8'),'sha256'),'hex'),
  'External evidence uses the existing mailbox/provider identity namespace with no source-kind prefix');
select ok((select source_kind='historical_owner_mailbox' and external_notice_observation_id is not null and gmail_message_id is null and gmail_thread_id is null
  from public.refund_completion_notice_adoptions),'External source occupies the same canonical adoption without fabricated Gmail IDs');
select is((select to_jsonb(m) from public.refund_case_messages m where id='bd600000-0000-4000-8000-000000000001'),(select value from owner_message_before),'Entire historical message remains unchanged');
select is((select to_jsonb(a) from public.refund_case_nayax_refund_attempts a where refund_case_id='bd400000-0000-4000-8000-000000000001'),(select value from owner_attempt_before),'Entire historical attempt remains unchanged');
select ok(not exists(select 1 from owner_case_before b join public.refund_cases c using(id) where b.value is distinct from to_jsonb(c)-array['lifecycle_revision','updated_at']),
  'No case payment, completion, original, customer or accounting field changes');
select is((select count(*) from public.refund_case_messages where refund_case_id::text like 'bd400000-%'),1::bigint,'No new canonical outgoing message');
select is((select count(*) from public.refund_gmail_messages where refund_case_id::text like 'bd400000-%'),0::bigint,'No owner message is fabricated in support Gmail ingestion');
select is((select count(*) from public.refund_gmail_threads where refund_case_id::text like 'bd400000-%'),0::bigint,'No support thread is fabricated');
select is((select count(*) from public.sales_adjustment_facts where refund_case_id::text like 'bd400000-%'),0::bigint,'No accounting entry');
select is(public.refund_lifecycle_contract('bd400000-0000-4000-8000-000000000001')->>'stageRank','80','Same canonical adoption advances only this confirmed claim to rank80');
select is(public.refund_lifecycle_contract('bd400000-0000-4000-8000-000000000003')->>'stageRank','70','Another receipt in the same reviewed thread does not inherit adoption');
select is((select count(*) from public.refund_completion_notice_adoptions where refund_case_id='bd400000-0000-4000-8000-000000000004'),0::bigint,'Unconfirmed claim remains unadopted');
select ok(public.refund_lifecycle_contract('bd400000-0000-4000-8000-000000000001')::text not like '%historical-owner%'
  and public.refund_lifecycle_contract('bd400000-0000-4000-8000-000000000001')::text not like '%cafe0000%', 'Public lifecycle contains no owner identity or provider IDs');
select is(public.admin_get_refund_authoritative_receipt_overview('bd400000-0000-4000-8000-000000000001')#>>'{receipt,noticeSource}','historical_owner_mailbox','Reopen keeps honest owner-source label');
select is(public.admin_get_refund_authoritative_receipt_overview('bd400000-0000-4000-8000-000000000001')#>>'{receipt,noticeVerification}','operator_observed','Reopen does not upgrade to provider-verified');
select is(public.admin_get_refund_authoritative_receipt_overview('bd400000-0000-4000-8000-000000000001')#>>'{receipt,supportThread}','false','Reopen never invents support thread');
select throws_ok($$select pg_temp.adopt_owner(3)$$,'P4664',null,'One provider message cannot complete another exact claim');
select throws_ok($$select pg_temp.adopt_owner(1,'{"digest":"cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc"}')$$,'P4664',null,'Changed content digest is not exact replay');
select throws_ok($$select pg_temp.adopt_owner(1,'{"thread":"cafe000000000098"}')$$,'P4664',null,'Changed thread is not exact replay');
select throws_ok($$select pg_temp.adopt_owner(1,'{"sentAt":"2026-09-02T16:08:00Z"}')$$,'P4664',null,'Changed original sent time is not exact replay');
select is(pg_temp.change_and_adopt($$update auth.users set email='changed-owner@example.invalid' where id=auth.uid()$$,1),'P4664','Changed verified identity cannot replay another mailbox observation');
select is(pg_temp.change_and_adopt($$delete from auth.sessions where user_id=auth.uid()$$,1),'42501','Exact replay still checks live session');
select is(pg_temp.change_and_adopt($$update public.reporting_machine_refund_managers set status='revoked',revoked_at=now(),revoke_reason='Synthetic revoked replay' where manager_user_id=auth.uid()$$,1),
  '42501','Exact replay still checks current machine mapping');
select throws_ok($$insert into public.refund_completion_notice_adoptions(receipt_id,refund_case_id,source_kind,
  message_evidence_digest,provider_message_digest,sent_at,manager_cc_verified,reviewed_by)
select id,refund_case_id,'support_gmail',repeat('d',64),repeat('d',64),'2026-09-02T16:07:00Z',false,auth.uid()
from public.refund_authoritative_receipts where refund_case_id='bd400000-0000-4000-8000-000000000003'$$,
  '23514',null,'Support source cannot omit both real Gmail identifiers');
select throws_ok($$insert into public.refund_completion_notice_adoptions(receipt_id,refund_case_id,source_kind,
  message_evidence_digest,provider_message_digest,sent_at,manager_cc_verified,reviewed_by)
select id,refund_case_id,'historical_owner_mailbox',repeat('d',64),repeat('d',64),'2026-09-02T16:07:00Z',false,auth.uid()
from public.refund_authoritative_receipts where refund_case_id='bd400000-0000-4000-8000-000000000003'$$,
  '23514',null,'External source cannot omit its exact private evidence row');
select throws_ok($$insert into public.refund_completion_notice_adoptions(receipt_id,refund_case_id,source_kind,
  message_evidence_digest,provider_message_digest,sent_at,manager_cc_verified,reviewed_by)
select id,refund_case_id,'provider_verified',repeat('d',64),repeat('d',64),'2026-09-02T16:07:00Z',false,auth.uid()
from public.refund_authoritative_receipts where refund_case_id='bd400000-0000-4000-8000-000000000003'$$,
  '23514',null,'A caller cannot invent a more authoritative source kind');
select throws_ok($$update public.refund_external_notice_observations set manager_cc_verified=true$$,'P4660',null,'External observation is immutable');
select throws_ok($$delete from public.refund_external_notice_observations$$,'P4660',null,'External observation cannot be erased');
select throws_ok($$update public.refund_completion_notice_adoptions set source_kind='support_gmail'$$,'P4660',null,'Canonical source cannot be relabeled');
select throws_ok($$select public.admin_adopt_refund_completion_notice('bd400000-0000-4000-8000-000000000001',
  (select id from public.refund_authoritative_receipts where refund_case_id='bd400000-0000-4000-8000-000000000001'),
  'bd800000-0000-4000-8000-000000000001',(select official_action_version from public.refund_cases where id='bd400000-0000-4000-8000-000000000001'),
  'RF-HISTORICAL-1','223456781',700,true)$$,'P4662',null,'Existing support RPC cannot overwrite external canonical adoption');

-- Genuine support source still uses its original ingestion/adoption contract.
insert into public.refund_gmail_threads(id,refund_case_id,mailbox_hash,provider_thread_id,thread_subject,first_message_at,latest_message_at,retention_expires_at)
values('bd700000-0000-4000-8000-000000000002','bd400000-0000-4000-8000-000000000002',
  encode(extensions.digest(convert_to('info@bloomjoysweets.com','UTF8'),'sha256'),'hex'),'cafe000000000022','Synthetic support thread',now(),now(),now()+interval '30 days');
insert into public.refund_gmail_messages(id,gmail_thread_id,refund_case_id,provider_message_id,operation_key,direction,message_kind,status,
  sender_email,recipient_email,subject,plain_body,sent_at,retention_expires_at,received_at)
values('bd800000-0000-4000-8000-000000000002','bd700000-0000-4000-8000-000000000002','bd400000-0000-4000-8000-000000000002',
  'cafe000000000002','synthetic-support-historical-2','outbound','message','sent','info@bloomjoysweets.com','historical-customer@example.invalid',
  'Synthetic support completion','RF-HISTORICAL-2 full $7.00 refund confirmed.','2026-09-02T16:07:00Z',now()+interval '30 days',now());
select is(public.admin_adopt_refund_completion_notice('bd400000-0000-4000-8000-000000000002',
  (select id from public.refund_authoritative_receipts where refund_case_id='bd400000-0000-4000-8000-000000000002'),
  'bd800000-0000-4000-8000-000000000002',(select official_action_version from public.refund_cases where id='bd400000-0000-4000-8000-000000000002'),
  'RF-HISTORICAL-2','223456782',700,true)->>'status','adopted','Original support adoption remains unchanged');
select throws_ok($$select pg_temp.adopt_owner(2,'{"message":"cafe000000000002","reference":"GMAIL-SENT:cafe000000000002"}')$$,'P4664',null,'External observation cannot overwrite support canonical adoption');
select is((select count(*) from public.refund_external_notice_observations),1::bigint,'Conflict leaves no orphan external observation');
set constraints all immediate;
select * from finish();
rollback;
