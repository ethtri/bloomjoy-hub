-- Disposable database only. All identities and evidence below are synthetic.
create extension if not exists pgtap with schema extensions;
create extension if not exists dblink with schema extensions;
set search_path=public,extensions;
-- Verify disposable connectivity before any fixture can be committed.
select extensions.dblink_connect('correction_race_a','host=db port='||current_setting('port')||
  ' dbname='||current_database()||' user=postgres password=postgres sslmode=disable application_name=correction_race_a');
select extensions.dblink_connect('correction_race_b','host=db port='||current_setting('port')||
  ' dbname='||current_database()||' user=postgres password=postgres sslmode=disable application_name=correction_race_b');
select extensions.dblink_exec('correction_race_a','set statement_timeout=''15s''');
select extensions.dblink_exec('correction_race_b','set statement_timeout=''15s''');
begin;
create schema refund_machine_correction_test;
create table refund_machine_correction_test.results(lane text primary key,payload jsonb);
insert into auth.users(instance_id,id,aud,role,email,encrypted_password,email_confirmed_at,raw_app_meta_data,raw_user_meta_data,created_at,updated_at)
values('00000000-0000-0000-0000-000000000000','be000000-0000-4000-8000-000000000001','authenticated','authenticated','correction-ops@example.invalid','',now(),'{}','{}',now(),now());
insert into auth.users(instance_id,id,aud,role,email,encrypted_password,email_confirmed_at,raw_app_meta_data,raw_user_meta_data,created_at,updated_at)
select '00000000-0000-0000-0000-000000000000',('be000000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid,
  'authenticated','authenticated','correction-manager-'||n||'@example.invalid','',now(),'{}','{}',now(),now()
from generate_series(2,3) n;
insert into auth.sessions(id,user_id,created_at,updated_at)
values('be010000-0000-4000-8000-000000000001','be000000-0000-4000-8000-000000000001',now(),now());
insert into auth.sessions(id,user_id,created_at,updated_at)
select ('be010000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid,('be000000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid,now(),now()
from generate_series(2,3) n;
insert into public.admin_roles(user_id,role,active) values('be000000-0000-4000-8000-000000000001','super_admin',true);
insert into public.customer_accounts(id,name,account_type) values('be100000-0000-4000-8000-000000000001','Correction fixture','internal');
insert into public.reporting_locations(id,account_id,name,timezone)
values('be200000-0000-4000-8000-000000000001','be100000-0000-4000-8000-000000000001','Correction fixture','America/Los_Angeles');
insert into public.reporting_machines(id,account_id,location_id,machine_label,nayax_machine_id,nayax_account_key)
select ('be300000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid,'be100000-0000-4000-8000-000000000001',
  'be200000-0000-4000-8000-000000000001','Correction machine '||n,'CORRECTION-MACHINE-'||n,'CORRECTION-ACCOUNT'
from generate_series(1,2) n;
insert into public.reporting_machine_refund_managers(reporting_machine_id,manager_user_id,manager_email,grant_reason)
select id,'be000000-0000-4000-8000-000000000001','correction-ops@example.invalid','Synthetic correction fixture'
from public.reporting_machines where id in ('be300000-0000-4000-8000-000000000001','be300000-0000-4000-8000-000000000002');
insert into public.reporting_machine_refund_managers(reporting_machine_id,manager_user_id,manager_email,grant_reason)
values('be300000-0000-4000-8000-000000000001','be000000-0000-4000-8000-000000000002','correction-manager-2@example.invalid','Synthetic old-only manager'),
  ('be300000-0000-4000-8000-000000000002','be000000-0000-4000-8000-000000000003','correction-manager-3@example.invalid','Synthetic corrected-only manager');
insert into public.refund_nayax_machine_inventory(id,account_key,nayax_machine_id,machine_number,provider_is_active,
  refund_category,reporting_machine_id,reconciliation_state)
values('be600000-0000-4000-8000-000000000002','CORRECTION-ACCOUNT','CORRECTION-MACHINE-2','555000002',true,
  'cotton_candy','be300000-0000-4000-8000-000000000002','published');
insert into public.refund_cases(id,public_reference,reporting_machine_id,reporting_location_id,customer_email,issue_summary,
  incident_at,incident_timezone,payment_method,payment_amount_cents,refund_amount_cents,card_last4,status,correlation_status,correlation_source,
  correlation_confidence,automation_state,matched_nayax_transaction_id,matched_nayax_amount_cents,matched_nayax_currency_code,
  matched_nayax_machine_auth_time,intake_meta,decision,nayax_refund_execution_status)
select ('be400000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid,'RF-CORRECTION-'||n,
  'be300000-0000-4000-8000-000000000001','be200000-0000-4000-8000-000000000001','correction-customer@example.invalid',
  'Synthetic correction fixture',now()-interval '3 days','America/Los_Angeles','card',700,700,'4242',
  'card_refund_pending','matched','nayax',1,'approved',(323456780+n)::text,700,'USD',now()-interval '3 days',
  '{"qr_claim_present":false,"source":"hosted_refund_intake","sentinel":"preserve"}'::jsonb,'approved','not_requested'
from generate_series(1,5) n;
-- A legitimate pre-existing send intent is queued before provider hold, not
-- inserted through the hold's independent new-customer-message guard.
insert into public.refund_case_messages(id,refund_case_id,message_type,status,recipient_email,subject,body)
values('be810000-0000-4000-8000-000000000001','be400000-0000-4000-8000-000000000001',
  'confirmation','pending','correction-customer@example.invalid','Synthetic pre-existing send','Synthetic pre-existing send');
update public.refund_cases set nayax_refund_execution_status='manual_review'
where reporting_machine_id='be300000-0000-4000-8000-000000000001';
with inserted as (
  insert into public.refund_case_nayax_refund_attempts(refund_case_id,actor_user_id,execution_mode,status,
    idempotency_key,amount_cents,provider_reference,provider_status,request_fingerprint,currency_code,
    provider_outcome,reconciliation_required,safe_transport_stage,safe_failure_class,created_at)
  select c.id,'be000000-0000-4000-8000-000000000001','manual_portal','manual_review',
    'manual-nayax-portal-20260901-'||c.public_reference,700,c.matched_nayax_transaction_id,'request_accepted',
    encode(extensions.digest(convert_to(c.id::text||'|'||c.matched_nayax_transaction_id||'|700','UTF8'),'sha256'),'hex'),
    'USD','unknown',true,'confirmation_hold','provider_unknown','2026-09-01 18:00:00+00'
  from public.refund_cases c where c.reporting_machine_id='be300000-0000-4000-8000-000000000001'
  returning id,refund_case_id,actor_user_id,created_at
)
insert into public.refund_case_events(refund_case_id,actor_user_id,event_type,message,metadata,created_at)
select refund_case_id,actor_user_id,'manual_nayax_refund_reconciliation_created','Synthetic historical registration',
  jsonb_build_object('attempt_id',id,'provider_outcome','unknown','provider_call_made',true,
    'settlement_confirmation_required',true,'payload_redacted',true),created_at from inserted;
insert into public.refund_gmail_threads(id,refund_case_id,mailbox_hash,provider_thread_id,thread_subject,first_message_at,latest_message_at,retention_expires_at)
values('be700000-0000-4000-8000-000000000001','be400000-0000-4000-8000-000000000001',repeat('e',64),
  'correction-fixture-thread','Synthetic sent notice',now()-interval '1 day',now(),now()+interval '30 days');
insert into public.refund_gmail_messages(id,gmail_thread_id,refund_case_id,provider_message_id,operation_key,direction,message_kind,status,
  sender_email,recipient_email,subject,plain_body,sent_at,retention_expires_at,received_at)
values('be800000-0000-4000-8000-000000000001','be700000-0000-4000-8000-000000000001','be400000-0000-4000-8000-000000000001',
  'correction-fixture-sent','imported:correction-fixture','outbound','message','sent','info@bloomjoysweets.com','correction-customer@example.invalid',
  'Synthetic prior completion notice','Synthetic immutable sent notice',now()-interval '1 hour',now()+interval '30 days',now()-interval '1 hour');
create table refund_machine_correction_test.snapshots as select c.id,to_jsonb(c) as case_before,
  to_jsonb(a) as attempt_before from public.refund_cases c join public.refund_case_nayax_refund_attempts a on a.refund_case_id=c.id
  where c.reporting_machine_id='be300000-0000-4000-8000-000000000001';
insert into public.refund_nayax_lookup_candidates(refund_case_id,actor_user_id,provider_transaction_id,
  machine_authorization_time,amount_cents,currency_code,reporting_machine_id,evidence_summary)
select c.id,'be000000-0000-4000-8000-000000000001',c.matched_nayax_transaction_id,c.matched_nayax_machine_auth_time,
  700,'USD',c.reporting_machine_id,'{"match_factors":["old_machine_matches"],"match_reason":"Historical wrong-machine candidate","source":"nayax_last_sales"}'::jsonb
from public.refund_cases c where c.id='be400000-0000-4000-8000-000000000001';
create table refund_machine_correction_test.history as select id,to_jsonb(e) as evidence
  from public.refund_case_events e where e.refund_case_id in (select id from refund_machine_correction_test.snapshots);
create table refund_machine_correction_test.mail as select id,to_jsonb(g) as evidence
  from public.refund_gmail_messages g where id='be800000-0000-4000-8000-000000000001';
create function refund_machine_correction_test.authorize() returns void language plpgsql as $$ begin
  perform set_config('request.jwt.claim.sub','be000000-0000-4000-8000-000000000001',true);
  perform set_config('request.jwt.claim.role','authenticated',true);
  perform set_config('request.jwt.claims','{"sub":"be000000-0000-4000-8000-000000000001","role":"authenticated","session_id":"be010000-0000-4000-8000-000000000001","is_anonymous":false}',true);
end; $$;
create function refund_machine_correction_test.run(n integer,changes jsonb default '{}'::jsonb) returns jsonb language plpgsql as $$
declare c public.refund_cases%rowtype; a uuid; x jsonb;
begin
  select * into c from public.refund_cases where id=('be400000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid;
  select id into a from public.refund_case_nayax_refund_attempts where refund_case_id=c.id order by created_at desc,id desc limit 1;
  x:=jsonb_build_object('attempt',a,'version',c.official_action_version,
    'old','be300000-0000-4000-8000-000000000001','target','be300000-0000-4000-8000-000000000002',
    'inventory','be600000-0000-4000-8000-000000000002',
    'digest',public.refund_machine_correction_inventory_digest('be600000-0000-4000-8000-000000000002'),
    'account','CORRECTION-ACCOUNT','machine','CORRECTION-MACHINE-2','number','555000002',
    'original',c.matched_nayax_transaction_id,'amount',700,'refunded',700,'currency','USD','status',62,
    'reference','DTM:NAYAX-'||c.matched_nayax_transaction_id,'reviewed',true)||changes;
  return public.admin_correct_legacy_refund_machine_and_record_observation(c.id,(x->>'attempt')::uuid,(x->>'version')::bigint,
    (x->>'old')::uuid,(x->>'target')::uuid,(x->>'inventory')::uuid,x->>'digest',x->>'account',x->>'machine',x->>'number',
    x->>'original',(x->>'amount')::integer,(x->>'refunded')::integer,x->>'currency',(x->>'status')::integer,
    x->>'reference',(x->>'reviewed')::boolean);
end; $$;
-- Keep pgTAP assertions outside the rolled-back corruption subtransaction.
create function refund_machine_correction_test.reject_corruption(p_setup text,p_changes jsonb default '{}'::jsonb) returns text language plpgsql as $$
declare setup_complete boolean:=false;
begin
  execute p_setup;
  setup_complete:=true;
  perform refund_machine_correction_test.run(1,p_changes);
  raise exception 'Corrupt fixture unexpectedly accepted' using errcode='XX001';
exception when others then
  if not setup_complete then raise; end if;
  return sqlstate;
end; $$;
create function refund_machine_correction_test.race(p_action text,n integer) returns jsonb language plpgsql as $$
declare c public.refund_cases%rowtype; a uuid;
begin
  perform refund_machine_correction_test.authorize();
  if p_action='correct' then return refund_machine_correction_test.run(n); end if;
  select * into c from public.refund_cases where id=('be400000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid;
  select id into a from public.refund_case_nayax_refund_attempts where refund_case_id=c.id order by created_at desc,id desc limit 1;
  return public.admin_resolve_refund_nayax_outcome_manager_session(c.id,a,'documented_manual_completion','documented_manual_refund',
    'MANUAL:CORRECTION-RACE',statement_timestamp(),'manual_nayax_completion',c.official_action_version);
exception when others then return jsonb_build_object('error',sqlstate,'message',sqlerrm);
end; $$;
create function refund_machine_correction_test.wait_for_blocked_b() returns boolean language plpgsql as $$ begin
  for i in 1..200 loop
    perform pg_stat_clear_snapshot();
    if exists(select 1 from pg_stat_activity where application_name='correction_race_b' and wait_event_type='Lock') then return true; end if;
    perform pg_sleep(0.01);
  end loop;
  return false;
end; $$;
commit;
select no_plan();
begin;
select refund_machine_correction_test.authorize();
select ok(not has_table_privilege('authenticated','public.refund_legacy_machine_corrections','select'),'Correction audit is private');
select ok(not has_table_privilege('service_role','public.refund_legacy_machine_corrections','insert'),'Service cannot forge audit');
select ok(not has_function_privilege(role_name,'public.admin_correct_legacy_refund_machine_and_record_observation(uuid,uuid,bigint,uuid,uuid,uuid,text,text,text,text,text,integer,integer,text,integer,text,boolean)','execute'),role_name||' cannot impersonate current operator')
from unnest(array['anon','service_role']) role_name;
select is(jsonb_array_length(public.admin_get_refund_legacy_machine_correction_options('be400000-0000-4000-8000-000000000001')->'targets'),1,'Current mapped exact inventory target is offered');
select throws_ok($$select refund_machine_correction_test.run(1)$$,'P4661',null,'Pre-existing in-flight customer work blocks the atomic correction');
delete from public.refund_case_messages where id='be810000-0000-4000-8000-000000000001';
select throws_ok($$select refund_machine_correction_test.run(1,'{"version":0}')$$,'P4665',null,'Stale case version fails closed');
select throws_ok($$select refund_machine_correction_test.run(1,'{"old":null}')$$,'P4665',null,'Missing old machine fails closed');
select throws_ok($$select refund_machine_correction_test.run(1,'{"target":null}')$$,'P4665',null,'Missing target fails closed');
select throws_ok($$select refund_machine_correction_test.run(1,'{"attempt":null}')$$,'P4665',null,'Missing attempt fails closed');
select throws_ok($$select refund_machine_correction_test.run(1,'{"digest":null}')$$,'P4665',null,'Missing inventory snapshot fails closed');
select throws_ok($$select refund_machine_correction_test.run(1,'{"digest":"aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"}')$$,'P4665',null,'Stale inventory snapshot fails closed');
select throws_ok($$select refund_machine_correction_test.run(1,'{"number":null}')$$,'P4665',null,'NULL numeric machine fails closed');
select throws_ok($$select refund_machine_correction_test.run(1,'{"number":"WRONG"}')$$,'P4665',null,'Wrong numeric machine fails closed');
select throws_ok($$select refund_machine_correction_test.run(1,'{"account":"WRONG"}')$$,'P4665',null,'Wrong current account fails closed');
select throws_ok($$select refund_machine_correction_test.run(1,'{"machine":"WRONG"}')$$,'P4665',null,'Wrong immutable provider machine fails closed');
select throws_ok($$select refund_machine_correction_test.run(1,'{"status":63}')$$,'P4661',null,'Non-refunded status fails closed');
select throws_ok($$select refund_machine_correction_test.run(1,'{"original":"323456789"}')$$,'P4661',null,'Changed original fails closed');
select throws_ok($$select refund_machine_correction_test.run(1,'{"amount":699,"refunded":699}')$$,'P4661',null,'Changed full amount fails closed');
select throws_ok($$select refund_machine_correction_test.run(1,'{"refunded":699}')$$,'P4661',null,'Partial refund fails closed');
select throws_ok($$select refund_machine_correction_test.run(1,'{"currency":"EUR"}')$$,'P4661',null,'Changed currency fails closed');
select throws_ok($$select refund_machine_correction_test.run(1,'{"reviewed":false}')$$,'42501',null,'Unreviewed observation fails closed');
select throws_ok($$select refund_machine_correction_test.run(1,'{"reviewed":null}')$$,'42501',null,'NULL current observation fails closed');
select is(refund_machine_correction_test.reject_corruption($setup$update public.admin_roles set active=false where user_id='be000000-0000-4000-8000-000000000001';$setup$),
  '42501','Revoked superadmin fails closed');
select is(refund_machine_correction_test.reject_corruption($setup$delete from auth.sessions where id='be010000-0000-4000-8000-000000000001';$setup$),
  '42501','Revoked session fails closed');
select is(refund_machine_correction_test.reject_corruption($setup$update public.reporting_machine_refund_managers set status='revoked',revoked_at=now(),revoke_reason='Synthetic review revocation' where reporting_machine_id='be300000-0000-4000-8000-000000000002';$setup$),
  '42501','Missing target mapping fails closed');
select is(refund_machine_correction_test.reject_corruption($setup$update public.reporting_machine_refund_managers set status='revoked',revoked_at=now(),revoke_reason='Synthetic review revocation' where reporting_machine_id='be300000-0000-4000-8000-000000000001';$setup$),
  '42501','Missing old mapping fails closed');
select is(refund_machine_correction_test.reject_corruption($setup$update public.refund_cases set intake_meta=intake_meta||'{"qr_claim_present":true}' where id='be400000-0000-4000-8000-000000000001';$setup$),
  'P4665','QR-bound intake fails closed');
select is(refund_machine_correction_test.reject_corruption($setup$update public.refund_cases set incident_timezone='America/New_York' where id='be400000-0000-4000-8000-000000000001';$setup$),
  'P4665','Changed timezone interpretation fails closed');
select is(refund_machine_correction_test.reject_corruption($setup$update public.refund_case_nayax_refund_attempts set idempotency_key='unsupported-batch' where refund_case_id='be400000-0000-4000-8000-000000000001';$setup$),
  'P4665','Unrecognized historical provenance fails closed');
select is(refund_machine_correction_test.reject_corruption($setup$update public.refund_nayax_machine_inventory set reconciliation_state='needs_setup',provider_is_active=false where id='be600000-0000-4000-8000-000000000002';$setup$),
  'P4665','Inactive inventory fails closed');
select is(refund_machine_correction_test.reject_corruption($setup$update public.refund_nayax_machine_inventory set machine_number='CORRECTION-MACHINE-2'
  where id='be600000-0000-4000-8000-000000000002';$setup$,'{"number":"CORRECTION-MACHINE-2"}'),
  'P4665','Matching malformed inventory label is not a numeric machine number');
select is((select count(*)::integer from public.refund_legacy_machine_corrections),0,'All failed corrections roll back their audit');
select is(refund_machine_correction_test.reject_corruption($setup$update public.refund_cases set intake_selection_kind='exact_machine',intake_selection_key='synthetic-original-machine',
  intake_selection_machine_ids=array['be300000-0000-4000-8000-000000000001'::uuid]
  where id='be400000-0000-4000-8000-000000000001';$setup$),
  'P4665','Existing exact intake selection is not rewritten');
select is((select count(*)::integer from public.refund_authoritative_receipts where refund_case_id in (select id from refund_machine_correction_test.snapshots)),0,'All failed corrections roll back their receipt');
select is((select reporting_machine_id from public.refund_cases where id='be400000-0000-4000-8000-000000000001'),'be300000-0000-4000-8000-000000000001'::uuid,'Receipt rejection rolls back the machine correction');
create temporary table correction_positive_input as select c.official_action_version,a.id as attempt_id,
  public.refund_machine_correction_inventory_digest('be600000-0000-4000-8000-000000000002') as inventory_digest
from public.refund_cases c join public.refund_case_nayax_refund_attempts a on a.refund_case_id=c.id
where c.id='be400000-0000-4000-8000-000000000001';
grant select on correction_positive_input to authenticated;
set local role authenticated;
select is(public.admin_correct_legacy_refund_machine_and_record_observation('be400000-0000-4000-8000-000000000001',
  (select attempt_id from correction_positive_input),(select official_action_version from correction_positive_input),
  'be300000-0000-4000-8000-000000000001','be300000-0000-4000-8000-000000000002','be600000-0000-4000-8000-000000000002',
  (select inventory_digest from correction_positive_input),'CORRECTION-ACCOUNT','CORRECTION-MACHINE-2','555000002',
  '323456781',700,700,'USD',62,'DTM:NAYAX-323456781',true)->>'machineCorrected','true',
  'Actual authenticated role atomically corrects the machine and records receipt');
reset role;
select throws_ok($$select refund_machine_correction_test.run(1)$$,'P4665',null,'Repeated correction cannot create another effect');
select is((select reporting_machine_id from public.refund_authoritative_receipts where refund_case_id='be400000-0000-4000-8000-000000000001'),'be300000-0000-4000-8000-000000000002'::uuid,'Receipt binds only the corrected machine');
commit;

-- B has captured the original reviewed version and is actually queued on A.
select extensions.dblink_exec('correction_race_a','begin');
select * from extensions.dblink('correction_race_a',$q$select id::text from public.refund_cases where id='be400000-0000-4000-8000-000000000002' for update$q$) as x(id text);
select extensions.dblink_send_query('correction_race_b',$q$select refund_machine_correction_test.race('correct',2)$q$);
select ok(refund_machine_correction_test.wait_for_blocked_b(),'Second correction actually waits on the case lock');
insert into refund_machine_correction_test.results select 'correct_a',payload from extensions.dblink('correction_race_a',$q$select refund_machine_correction_test.race('correct',2)$q$) as x(payload jsonb);
select extensions.dblink_exec('correction_race_a','commit');
insert into refund_machine_correction_test.results select 'correct_b',payload from extensions.dblink_get_result('correction_race_b') as x(payload jsonb);
select * from extensions.dblink_get_result('correction_race_b') as x(payload jsonb);
select is((select payload->>'status' from refund_machine_correction_test.results where lane='correct_a'),'recorded','One correction wins');
select is((select payload->>'error' from refund_machine_correction_test.results where lane='correct_b'),'P4665','Concurrent stale correction loses safely');

begin;
select refund_machine_correction_test.authorize();
select ok((select c.decision='approved' and c.status='card_refund_pending' and c.refund_completed_at is null
  and c.reporting_adjustment_id is null and public.refund_nayax_provider_outcome_state(c.nayax_refund_execution_status)='unconfirmed'
  and c.official_action_version=(s.case_before->>'official_action_version')::bigint
  from public.refund_cases c join refund_machine_correction_test.snapshots s on s.id=c.id
  where c.id='be400000-0000-4000-8000-000000000003'),'Before the race the old resolver has the exact current held-case state and version');
select ok(public.can_perform_refund_official_action('be000000-0000-4000-8000-000000000001','be400000-0000-4000-8000-000000000003'),
  'Before correction the mapped operator still has the old resolver capability');
commit;
select extensions.dblink_exec('correction_race_a','begin');
select * from extensions.dblink('correction_race_a',$q$select id::text from public.refund_cases where id='be400000-0000-4000-8000-000000000003' for update$q$) as x(id text);
select extensions.dblink_send_query('correction_race_b',$q$select refund_machine_correction_test.race('old_resolver',3)$q$);
select ok(refund_machine_correction_test.wait_for_blocked_b(),'Old resolver actually waits on correction case lock');
insert into refund_machine_correction_test.results select 'correct_before_resolver',payload from extensions.dblink('correction_race_a',$q$select refund_machine_correction_test.race('correct',3)$q$) as x(payload jsonb);
select extensions.dblink_exec('correction_race_a','commit');
insert into refund_machine_correction_test.results select 'resolver_loses',payload from extensions.dblink_get_result('correction_race_b') as x(payload jsonb);
select * from extensions.dblink_get_result('correction_race_b') as x(payload jsonb);
select is((select payload->>'status' from refund_machine_correction_test.results where lane='correct_before_resolver'),'recorded','Correction commits before old resolver');
select is((select payload->>'error' from refund_machine_correction_test.results where lane='resolver_loses'),'P0001','Old resolver rejects the changed case version after the correction');
select is((select payload->>'message' from refund_machine_correction_test.results where lane='resolver_loses'),'Payment result changed; reload before confirming it','Old resolver fails at the exact post-lock case-version gate');
select ok((select c.official_action_version>(s.case_before->>'official_action_version')::bigint
  from public.refund_cases c join refund_machine_correction_test.snapshots s on s.id=c.id
  where c.id='be400000-0000-4000-8000-000000000003'),'Correction actually advances the queued resolver review version');

-- A revocation already in progress must win over a queued correction.
select extensions.dblink_exec('correction_race_a','begin');
select extensions.dblink_exec('correction_race_a',$q$update public.reporting_machine_refund_managers set status='revoked',revoked_at=now(),revoke_reason='Synthetic review revocation' where reporting_machine_id='be300000-0000-4000-8000-000000000002'$q$);
select extensions.dblink_send_query('correction_race_b',$q$select refund_machine_correction_test.race('correct',4)$q$);
select ok(refund_machine_correction_test.wait_for_blocked_b(),'Correction waits for uncommitted target mapping revocation');
select extensions.dblink_exec('correction_race_a','commit');
insert into refund_machine_correction_test.results select 'mapping_loses',payload from extensions.dblink_get_result('correction_race_b') as x(payload jsonb);
select * from extensions.dblink_get_result('correction_race_b') as x(payload jsonb);
select is((select payload->>'error' from refund_machine_correction_test.results where lane='mapping_loses'),'42501','Committed mapping revocation rejects queued correction');
update public.reporting_machine_refund_managers set status='active',revoked_at=null where reporting_machine_id='be300000-0000-4000-8000-000000000002';

select extensions.dblink_exec('correction_race_a','begin');
select extensions.dblink_exec('correction_race_a',$q$update public.refund_nayax_machine_inventory set last_seen_at=last_seen_at+interval '1 minute' where id='be600000-0000-4000-8000-000000000002'$q$);
select extensions.dblink_send_query('correction_race_b',$q$select refund_machine_correction_test.race('correct',5)$q$);
select ok(refund_machine_correction_test.wait_for_blocked_b(),'Correction waits on changing inventory snapshot');
select extensions.dblink_exec('correction_race_a','commit');
insert into refund_machine_correction_test.results select 'inventory_loses',payload from extensions.dblink_get_result('correction_race_b') as x(payload jsonb);
select * from extensions.dblink_get_result('correction_race_b') as x(payload jsonb);
select is((select payload->>'error' from refund_machine_correction_test.results where lane='inventory_loses'),'P4665','Changed inventory invalidates the reviewed snapshot');
select extensions.dblink_disconnect('correction_race_a');
select extensions.dblink_disconnect('correction_race_b');

select is((select count(*)::integer from public.refund_legacy_machine_corrections),3,'Exactly three committed corrections across success and races');
select is((select count(*)::integer from public.refund_authoritative_receipts where refund_case_id in (select id from refund_machine_correction_test.snapshots)),3,'Exactly one receipt per successful correction');
select is((select count(*)::integer from public.refund_case_nayax_refund_attempts where refund_case_id in (select id from refund_machine_correction_test.snapshots)),5,'No new payment attempt is created');
select is((select count(*)::integer from public.refund_gmail_messages where refund_case_id in (select id from refund_machine_correction_test.snapshots)),1,'No new Gmail notice is created');
select ok((select bool_and(coalesce(to_jsonb(a)=s.attempt_before,false)) from refund_machine_correction_test.snapshots s
  left join public.refund_case_nayax_refund_attempts a on a.refund_case_id=s.id),'Historical attempts are byte-for-byte unchanged');
select ok((select bool_and(coalesce(to_jsonb(e)=s.evidence,false)) from refund_machine_correction_test.history s left join public.refund_case_events e on e.id=s.id),'Historical events are unchanged');
select ok((select bool_and(coalesce(to_jsonb(g)=s.evidence,false)) from refund_machine_correction_test.mail s left join public.refund_gmail_messages g on g.id=s.id),'Sent customer notice content, CC and thread ownership are unchanged');
select ok((select bool_and(c.intake_meta-array['manager_assignment_rule','manager_assignment_status','manager_assignment_active_mapping_count'] =
  (s.case_before->'intake_meta')-array['manager_assignment_rule','manager_assignment_status','manager_assignment_active_mapping_count'])
  from refund_machine_correction_test.snapshots s join public.refund_cases c on c.id=s.id),'Original intake metadata survives except existing derived assignment fields');
select ok((select bool_and(c.incident_at=(s.case_before->>'incident_at')::timestamptz and c.incident_timezone=s.case_before->>'incident_timezone'
  and c.matched_nayax_transaction_id=s.case_before->>'matched_nayax_transaction_id'
  and c.matched_nayax_machine_auth_time=(s.case_before->>'matched_nayax_machine_auth_time')::timestamptz
  and c.refund_qr_claim_context_id is null and c.refund_completed_at is null and c.reporting_adjustment_id is null)
  from refund_machine_correction_test.snapshots s join public.refund_cases c on c.id=s.id),'Original, sale time, intake timezone and unknown settlement remain unchanged');
select is((select count(*)::integer from public.sales_adjustment_facts where refund_case_id in (select id from refund_machine_correction_test.snapshots)),0,'No financial adjustment');
select is((select count(*)::integer from public.refund_case_messages where refund_case_id in (select id from refund_machine_correction_test.snapshots)),0,'No customer-send intent');
select throws_ok($$update public.refund_legacy_machine_corrections set recorded_at=now()$$,'P4660',null,'Correction audit is immutable');
begin;
select refund_machine_correction_test.authorize();
select is((select item#>>'{selectedNayaxTransaction,machineLabel}' from jsonb_array_elements(public.admin_get_refund_operations_overview()->'cases') item
  where item->>'id'='be400000-0000-4000-8000-000000000001'),'Correction machine 2','Selected evidence identifies the corrected current machine');
select is((select item#>'{selectedNayaxTransaction,matchFactors}' from jsonb_array_elements(public.admin_get_refund_operations_overview()->'cases') item
  where item->>'id'='be400000-0000-4000-8000-000000000001'),'[]'::jsonb,'Old-machine candidate factors do not corroborate current machine');
select is((select item->'nayaxLookupCandidates' from jsonb_array_elements(public.admin_get_refund_operations_overview()->'cases') item
  where item->>'id'='be400000-0000-4000-8000-000000000001'),'[]'::jsonb,'Current workbench does not reuse historical candidate comparison factors');
select is((select count(*)::integer from public.refund_nayax_lookup_candidates where refund_case_id='be400000-0000-4000-8000-000000000001'
  and reporting_machine_id='be300000-0000-4000-8000-000000000001'),1,'Historical wrong-machine candidate remains preserved in source');
select ok(not public.can_perform_refund_official_action('be000000-0000-4000-8000-000000000001','be400000-0000-4000-8000-000000000003'),'Correction does not reauthorize payment');
set local role authenticated;
select set_config('request.jwt.claim.sub','be000000-0000-4000-8000-000000000002',true);
select set_config('request.jwt.claims','{"sub":"be000000-0000-4000-8000-000000000002","role":"authenticated","session_id":"be010000-0000-4000-8000-000000000002","is_anonymous":false}',true);
select ok(not exists(select 1 from jsonb_array_elements(public.admin_get_refund_operations_overview()->'cases') item
  where item->>'id'='be400000-0000-4000-8000-000000000001'),'Old-machine-only manager loses corrected case visibility');
select set_config('request.jwt.claim.sub','be000000-0000-4000-8000-000000000003',true);
select set_config('request.jwt.claims','{"sub":"be000000-0000-4000-8000-000000000003","role":"authenticated","session_id":"be010000-0000-4000-8000-000000000003","is_anonymous":false}',true);
select ok(exists(select 1 from jsonb_array_elements(public.admin_get_refund_operations_overview()->'cases') item
  where item->>'id'='be400000-0000-4000-8000-000000000001' and item#>>'{machineCorrection,historicalEvidencePreserved}'='true'),
  'Current corrected-machine manager sees scoped correction readback');
reset role;
commit;
select * from finish();

-- Disposable fixture cleanup only; restore immutability before commit.
begin;
alter table public.refund_legacy_machine_corrections disable trigger refund_legacy_machine_corrections_immutable;
alter table public.refund_authoritative_receipts disable trigger refund_authoritative_receipts_immutable;
delete from public.refund_legacy_machine_corrections where refund_case_id in (select id from refund_machine_correction_test.snapshots);
delete from public.refund_authoritative_receipts where refund_case_id in (select id from refund_machine_correction_test.snapshots);
alter table public.refund_legacy_machine_corrections enable trigger refund_legacy_machine_corrections_immutable;
alter table public.refund_authoritative_receipts enable trigger refund_authoritative_receipts_immutable;
delete from public.refund_gmail_messages where id='be800000-0000-4000-8000-000000000001';
delete from public.refund_gmail_threads where id='be700000-0000-4000-8000-000000000001';
delete from public.refund_case_nayax_refund_attempts where refund_case_id in (select id from refund_machine_correction_test.snapshots);
delete from public.refund_cases where id in (select id from refund_machine_correction_test.snapshots);
delete from public.refund_nayax_machine_inventory where id='be600000-0000-4000-8000-000000000002';
delete from public.reporting_machine_refund_managers where reporting_machine_id in ('be300000-0000-4000-8000-000000000001','be300000-0000-4000-8000-000000000002');
delete from public.reporting_machines where id in ('be300000-0000-4000-8000-000000000001','be300000-0000-4000-8000-000000000002');
delete from public.reporting_locations where id='be200000-0000-4000-8000-000000000001';
delete from public.customer_accounts where id='be100000-0000-4000-8000-000000000001';
delete from auth.users where id in ('be000000-0000-4000-8000-000000000001','be000000-0000-4000-8000-000000000002','be000000-0000-4000-8000-000000000003');
drop schema refund_machine_correction_test cascade;
commit;
