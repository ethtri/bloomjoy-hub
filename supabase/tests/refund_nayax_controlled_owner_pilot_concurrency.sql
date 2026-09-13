create extension if not exists pgtap with schema extensions;
create extension if not exists dblink with schema extensions;
set search_path=public,extensions;

begin;
drop schema if exists retired_pilot_race_test cascade;
create schema retired_pilot_race_test;

create table retired_pilot_race_test.baseline (
  authorizations bigint not null,
  stages bigint not null,
  receipts bigint not null,
  attempts bigint not null,
  events bigint not null
);

insert into retired_pilot_race_test.baseline
select
  (select count(*) from public.refund_nayax_controlled_pilot_authorizations),
  (select count(*) from public.refund_nayax_controlled_pilot_stage_journal),
  (select count(*) from public.refund_case_official_action_authorizations),
  (select count(*) from public.refund_case_nayax_refund_attempts),
  (select count(*) from public.refund_case_events);

create function retired_pilot_race_test.try_authorize()
returns jsonb language plpgsql set search_path=public as $$
begin
  perform public.owner_authorize_refund_nayax_controlled_pilot(
    null,null,null,null,null,null,null,null,
    null,null,null,null,null,null,null,null);
  return jsonb_build_object('ok',true);
exception when others then
  return jsonb_build_object('ok',false,'sqlstate',sqlstate,'message',sqlerrm);
end;
$$;
commit;

select plan(3);
create temporary table retired_pilot_race_results(
  connection_name text primary key,
  result jsonb not null
);

do $$
declare local_connection text:='host=db port='||current_setting('port')
  ||' dbname='||current_database()||' user=postgres password=postgres sslmode=disable';
begin
  perform extensions.dblink_connect('retired_pilot_race_a',local_connection);
  perform extensions.dblink_connect('retired_pilot_race_b',local_connection);
  perform extensions.dblink_send_query('retired_pilot_race_a',
    'select retired_pilot_race_test.try_authorize()');
  perform extensions.dblink_send_query('retired_pilot_race_b',
    'select retired_pilot_race_test.try_authorize()');
end;
$$;

insert into retired_pilot_race_results
select 'a',result from extensions.dblink_get_result('retired_pilot_race_a')
  as response(result jsonb);
insert into retired_pilot_race_results
select 'b',result from extensions.dblink_get_result('retired_pilot_race_b')
  as response(result jsonb);

select is((select count(*)::integer from retired_pilot_race_results
    where not (result->>'ok')::boolean and result->>'sqlstate'='42501'),2,
  'Two concurrent database-owner pilot calls both fail closed');

select ok((select bool_and(result->>'message' like '%controlled Nayax pilot lane is retired%')
    from retired_pilot_race_results),
  'Both concurrent callers receive the explicit retirement result');

select ok((select
    baseline.authorizations=(select count(*) from public.refund_nayax_controlled_pilot_authorizations)
    and baseline.stages=(select count(*) from public.refund_nayax_controlled_pilot_stage_journal)
    and baseline.receipts=(select count(*) from public.refund_case_official_action_authorizations)
    and baseline.attempts=(select count(*) from public.refund_case_nayax_refund_attempts)
    and baseline.events=(select count(*) from public.refund_case_events)
  from retired_pilot_race_test.baseline baseline),
  'Concurrent retired-lane calls create no authorization, receipt, attempt, stage, or event writes');

do $$ begin
  perform extensions.dblink_disconnect('retired_pilot_race_a');
  perform extensions.dblink_disconnect('retired_pilot_race_b');
end; $$;
select * from finish();

begin;
drop schema retired_pilot_race_test cascade;
commit;
