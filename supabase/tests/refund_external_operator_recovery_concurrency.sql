create extension if not exists pgtap with schema extensions;
create extension if not exists dblink with schema extensions;
set search_path=public,extensions;
select no_plan();

-- This test commits synthetic fixtures for independent database sessions, so
-- fail before doing that unless the disposable Supabase CLI database accepts
-- the same internal connection used by the repository's other race tests.
do $$
declare local_connection text:='host=db port='||current_setting('port')||' dbname='||current_database()
  ||' user=postgres password=postgres sslmode=disable';
begin
  perform extensions.dblink_connect('external_recovery_local_guard',local_connection);
  perform extensions.dblink_disconnect('external_recovery_local_guard');
end;
$$;

begin;
\ir fixtures/refund_external_operator_recovery.inc
drop schema if exists refund_external_recovery_race_test cascade;
create schema refund_external_recovery_race_test;
create table refund_external_recovery_race_test.inputs(case_number integer primary key,evidence jsonb not null);
insert into refund_external_recovery_race_test.inputs
select n,pg_temp.recovery_evidence(n) from generate_series(1,3) n;

create function refund_external_recovery_race_test.configure_request() returns void
language plpgsql as $$ begin
 perform set_config('request.jwt.claim.sub','bf000000-0000-4000-8000-000000000001',false);
 perform set_config('request.jwt.claim.role','authenticated',false);
 perform set_config('request.jwt.claims','{"sub":"bf000000-0000-4000-8000-000000000001","role":"authenticated","session_id":"bf010000-0000-4000-8000-000000000001","is_anonymous":false}',false);
end; $$;
create function refund_external_recovery_race_test.recover(n integer,hold_seconds numeric default 0) returns jsonb
language plpgsql as $$ declare result jsonb; begin
 perform refund_external_recovery_race_test.configure_request();
 select public.admin_reconcile_external_refund_and_notice(
   ('bf400000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid,evidence) into result
 from refund_external_recovery_race_test.inputs where case_number=n;
 if hold_seconds>0 then perform pg_sleep(hold_seconds); end if;
 return jsonb_build_object('ok',true,'result',result);
exception when others then return jsonb_build_object('ok',false,'sqlstate',sqlstate); end; $$;
create function refund_external_recovery_race_test.stale_sweep(n integer) returns jsonb
language plpgsql as $$ begin
 update public.refund_cases set correlation_status='manual_review'
 where id=('bf400000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid;
 return jsonb_build_object('ok',true);
exception when others then return jsonb_build_object('ok',false,'sqlstate',sqlstate); end; $$;
create function refund_external_recovery_race_test.wait_blocked(app text) returns boolean
language plpgsql as $$ declare deadline timestamptz:=clock_timestamp()+interval '5 seconds'; begin
 loop
   perform pg_stat_clear_snapshot();
   if exists(select 1 from pg_stat_activity where application_name=app and cardinality(pg_blocking_pids(pid))>0) then return true; end if;
   exit when clock_timestamp()>=deadline; perform pg_sleep(0.01);
 end loop; return false;
end; $$;
create function refund_external_recovery_race_test.wait_held(app text) returns boolean
language plpgsql as $$ declare deadline timestamptz:=clock_timestamp()+interval '5 seconds'; begin
 loop
   perform pg_stat_clear_snapshot();
   if exists(select 1 from pg_stat_activity where application_name=app and wait_event='PgSleep') then return true; end if;
   exit when clock_timestamp()>=deadline; perform pg_sleep(0.01);
 end loop; return false;
end; $$;
commit;

do $$ declare base text:='host=db port='||current_setting('port')||' dbname='||current_database()
 ||' user=postgres password=postgres sslmode=disable application_name='; begin
 perform extensions.dblink_connect('external_recovery_a',base||'external_recovery_a');
 perform extensions.dblink_connect('external_recovery_b',base||'external_recovery_b');
end; $$;

-- Revocation takes the same ordered machine lock first. Recovery waits, then
-- rechecks authority after the revocation commits and creates nothing.
begin;
select pg_advisory_xact_lock(hashtext('machine_manager:bf300000-0000-4000-8000-000000000001'));
select extensions.dblink_send_query('external_recovery_b',
 'select refund_external_recovery_race_test.recover(2)');
select ok(refund_external_recovery_race_test.wait_blocked('external_recovery_b'),
 'Recovery actually waits behind the manager-authority lock');
update public.reporting_machine_refund_managers set status='revoked',revoked_at=now(),
 revoke_reason='Synthetic concurrent revocation'
where reporting_machine_id='bf300000-0000-4000-8000-000000000002'
 and manager_user_id='bf000000-0000-4000-8000-000000000001';
commit;
select is((select result->>'sqlstate' from extensions.dblink_get_result('external_recovery_b') result(result jsonb)),
 '42501','A committed concurrent revocation wins and recovery fails closed');
-- libpq requires the terminating empty result before this connection can run
-- another asynchronous query.
select count(*) from extensions.dblink_get_result('external_recovery_b') result(result jsonb);
select ok(not exists(select 1 from public.refund_external_operator_recoveries
 where refund_case_id='bf400000-0000-4000-8000-000000000002'),
 'Revocation loser creates no recovery record');
update public.reporting_machine_refund_managers set status='active',revoked_at=null,revoke_reason=null
where reporting_machine_id='bf300000-0000-4000-8000-000000000002'
 and manager_user_id='bf000000-0000-4000-8000-000000000001';

-- The recovery transaction writes first and stays open briefly. A stale lookup
-- update must visibly wait for that row and then fail against the intake guard.
select extensions.dblink_send_query('external_recovery_a',
 'select refund_external_recovery_race_test.recover(3,4)');
select ok(refund_external_recovery_race_test.wait_held('external_recovery_a'),
 'The recovery has written its receipt and still holds the transaction open');
select extensions.dblink_send_query('external_recovery_b',
 'select refund_external_recovery_race_test.stale_sweep(3)');
select ok(refund_external_recovery_race_test.wait_blocked('external_recovery_b'),
 'A stale lookup actually waits behind the recovery transaction');
select ok((select (result->>'ok')::boolean from extensions.dblink_get_result('external_recovery_a') result(result jsonb)),
 'Recovery commits while the stale lookup is waiting');
select is((select result->>'sqlstate' from extensions.dblink_get_result('external_recovery_b') result(result jsonb)),
 'P4667','The stale lookup loses after rechecking the recovered case');
select count(*) from extensions.dblink_get_result('external_recovery_a') result(result jsonb);
select count(*) from extensions.dblink_get_result('external_recovery_b') result(result jsonb);
select is(public.refund_lifecycle_contract('bf400000-0000-4000-8000-000000000003')->>'stage',
 'customer_notified','The recovered receipt and notice remain visible after the stale race');

-- Two identical submissions serialize on the case. The second sees the first
-- immutable request digest and returns the idempotent already-recorded result.
select extensions.dblink_send_query('external_recovery_a',
 'select refund_external_recovery_race_test.recover(1,4)');
select ok(refund_external_recovery_race_test.wait_held('external_recovery_a'),
 'The first identical submission holds its uncommitted receipt');
select extensions.dblink_send_query('external_recovery_b',
 'select refund_external_recovery_race_test.recover(1)');
select ok(refund_external_recovery_race_test.wait_blocked('external_recovery_b'),
 'An identical replay actually waits behind the first recovery');
select ok((select (result->>'ok')::boolean from extensions.dblink_get_result('external_recovery_a') result(result jsonb)),
 'The first identical recovery commits');
select is((select result->'result'->>'status' from extensions.dblink_get_result('external_recovery_b') result(result jsonb)),
 'already_recorded','The concurrent identical replay is idempotent');
select ok(
 (select count(*)=2 from public.refund_external_operator_recoveries) and
 (select count(*)=2 from public.refund_authoritative_receipts where attempt_binding_kind='external_operator_observation') and
 (select count(*)=2 from public.refund_completion_notice_adoptions where source_kind='current_operator_mailbox') and
 (select count(*)=2 from public.refund_case_events where event_type='external_refund_and_notice_reconciled') and
 not exists(select 1 from public.refund_case_nayax_refund_attempts where refund_case_id::text like 'bf400000-0000-4000-8000-%') and
 not exists(select 1 from public.refund_case_official_action_authorizations where refund_case_id::text like 'bf400000-0000-4000-8000-%') and
 not exists(select 1 from public.refund_case_messages where refund_case_id::text like 'bf400000-0000-4000-8000-%') and
 not exists(select 1 from public.sales_adjustment_facts where refund_case_id::text like 'bf400000-0000-4000-8000-%'),
 'Both races leave exactly two truthful recoveries and no payment, mail or adjustment work');

select extensions.dblink_disconnect('external_recovery_a');
select extensions.dblink_disconnect('external_recovery_b');

-- Remove only the committed synthetic objects used by this disposable test.
begin;
set local session_replication_role=replica;
delete from public.refund_case_events where refund_case_id::text like 'bf400000-0000-4000-8000-%';
delete from public.refund_completion_notice_adoptions where refund_case_id::text like 'bf400000-0000-4000-8000-%';
delete from public.refund_external_operator_recoveries where refund_case_id::text like 'bf400000-0000-4000-8000-%';
delete from public.refund_authoritative_receipts where refund_case_id::text like 'bf400000-0000-4000-8000-%';
delete from public.refund_cases where id::text like 'bf400000-0000-4000-8000-%';
delete from public.refund_nayax_machine_inventory where id='bf600000-0000-4000-8000-000000000002';
delete from public.reporting_machine_refund_managers where manager_user_id='bf000000-0000-4000-8000-000000000001';
delete from public.reporting_machines where nayax_account_key='RECOVERY-ACCOUNT';
delete from public.reporting_locations where id='bf200000-0000-4000-8000-000000000001';
delete from public.customer_accounts where id='bf100000-0000-4000-8000-000000000001';
delete from public.admin_roles where user_id='bf000000-0000-4000-8000-000000000001';
delete from auth.sessions where user_id='bf000000-0000-4000-8000-000000000001';
delete from auth.users where id='bf000000-0000-4000-8000-000000000001';
drop schema refund_external_recovery_race_test cascade;
commit;
select * from finish();
