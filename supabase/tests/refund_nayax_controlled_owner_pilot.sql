begin;
create extension if not exists pgtap with schema extensions;
set local search_path=public,extensions;
select plan(6);

create function pg_temp.capture_error(statement text)
returns text language plpgsql as $$ begin
  execute statement; return null;
exception when others then return sqlstate||':'||sqlerrm;
end; $$;

create temporary table retired_pilot_baseline as
select
  (select count(*) from public.refund_nayax_controlled_pilot_authorizations) authorizations,
  (select count(*) from public.refund_nayax_controlled_pilot_stage_journal) stages,
  (select count(*) from public.refund_case_official_action_authorizations) receipts,
  (select count(*) from public.refund_case_nayax_refund_attempts) attempts,
  (select count(*) from public.refund_case_events) events;

select ok(to_regclass('public.refund_nayax_controlled_pilot_authorizations') is not null
  and to_regclass('public.refund_nayax_controlled_pilot_stage_journal') is not null,
  'Historical controlled-pilot records remain readable for audit');

select ok(
  pg_temp.capture_error($sql$select public.owner_authorize_refund_nayax_controlled_pilot(
    null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null)$sql$)
      like '42501:%controlled Nayax pilot lane is retired%'
  and pg_temp.capture_error($sql$select public.owner_cancel_refund_nayax_controlled_pilot(null)$sql$)
      like '42501:%controlled Nayax pilot lane is retired%'
  and pg_temp.capture_error($sql$select public.owner_recover_expired_refund_nayax_controlled_pilot()$sql$)
      like '42501:%controlled Nayax pilot lane is retired%',
  'Database-owner pilot authorization, cancellation, and recovery all fail closed');

select ok(
  pg_temp.capture_error($sql$select public.service_validate_nayax_controlled_pilot_postarm(
    null,null,null,null,null,null)$sql$) like '42501:%controlled Nayax pilot lane is retired%'
  and pg_temp.capture_error($sql$select public.admin_consume_refund_nayax_controlled_pilot_intent(
    null,null,null,null,null,null,null,null,null,null,null)$sql$)
      like '42501:%controlled Nayax pilot lane is retired%'
  and pg_temp.capture_error($sql$select public.service_reserve_and_consume_nayax_controlled_pilot_attempt(
    null,null,null,null,null,null,null,null,null,null)$sql$)
      like '42501:%controlled Nayax pilot lane is retired%'
  and pg_temp.capture_error($sql$select public.service_record_nayax_controlled_pilot_stage(
    null,null,null,null,null,null,null,null,null,null,null,null)$sql$)
      like '42501:%controlled Nayax pilot lane is retired%'
  and pg_temp.capture_error($sql$select public.service_settle_nayax_controlled_pilot_attempt(
    null,null,null,null,null,null,null,null,null,null,null,null,null,null)$sql$)
      like '42501:%controlled Nayax pilot lane is retired%',
  'Database-owner pilot validation, consumption, provider, and settlement calls all fail closed');

select ok((select authorizations=(select count(*) from public.refund_nayax_controlled_pilot_authorizations)
    and stages=(select count(*) from public.refund_nayax_controlled_pilot_stage_journal)
    and receipts=(select count(*) from public.refund_case_official_action_authorizations)
    and attempts=(select count(*) from public.refund_case_nayax_refund_attempts)
    and events=(select count(*) from public.refund_case_events)
  from retired_pilot_baseline),
  'Owner calls to every retired pilot entry point create no writes');

select ok(not has_function_privilege('authenticated',
    'public.admin_consume_refund_nayax_controlled_pilot_intent(uuid,uuid,uuid,bigint,integer,text,text,text,text,text,uuid)','execute')
  and not has_function_privilege('service_role',
    'public.service_reserve_and_consume_nayax_controlled_pilot_attempt(text,uuid,text,text,uuid,uuid,text,integer,text,uuid)','execute')
  and not has_function_privilege('service_role',
    'public.service_settle_nayax_controlled_pilot_attempt(text,uuid,uuid,uuid,uuid,text,integer,text,text,text,uuid,text,text,text)','execute'),
  'Application and service identities cannot execute the retired pilot');

select ok(not has_table_privilege('authenticated',
    'public.refund_nayax_controlled_pilot_authorizations','insert')
  and not has_table_privilege('service_role',
    'public.refund_nayax_controlled_pilot_authorizations','insert'),
  'Historical pilot tables are not directly writable by application identities');

select * from finish();
rollback;
