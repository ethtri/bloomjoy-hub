begin;
create extension if not exists pgtap with schema extensions;
set local search_path=public,extensions;
set local plan_cache_mode='force_generic_plan';
select plan(12);

-- Reconstruct only the preceding query orchestration, retaining every original
-- condition. Comparison copies exist solely in this rolled-back test session.
do $before$
declare signature text;definition text;anchor text;expected integer;name text;
begin
 foreach signature in array array[
  'public.refund_manager_preparation_snapshot(uuid,bigint)',
  'public.refund_payout_destination_case_current(public.refund_cases)',
  'public.refund_decision_recommendation_for_case(uuid,timestamptz)'
 ] loop
  definition:=replace(pg_get_functiondef(signature::regprocedure),E'\r\n',E'\n');
  if signature like '%recommendation%' then
   anchor:=E'public.refund_current_sunze_cash_source_key(\n        c.reporting_machine_id,c.incident_at,p_observed_at)';expected:=2;
  elsif signature like '%payout_destination%' then
   anchor:=E'public.refund_current_sunze_cash_source_key(\n        case_row.reporting_machine_id,case_row.incident_at,statement_timestamp())';expected:=1;
  else
   anchor:=E'public.refund_current_sunze_cash_source_key(\n          case_row.reporting_machine_id,case_row.incident_at,statement_timestamp())';expected:=1;
  end if;
  if cardinality(string_to_array(definition,'(select '||anchor||')'))<>expected+1 then
   raise exception 'Preceding reader reconstruction changed: %',signature;
  end if;
  definition:=replace(definition,'(select '||anchor||')',anchor);
  select proname into name from pg_proc where oid=signature::regprocedure;
  execute replace(definition,'FUNCTION public.'||name||'(', 'FUNCTION pg_temp.before_'||name||'(');
 end loop;
end $before$;

select ok((select provolatile='s' from pg_proc where oid=
 'public.refund_current_sunze_cash_source_key(uuid,timestamptz,timestamptz)'::regprocedure),
 'source checks retain statement-snapshot stability');
select ok((select bool_and(provolatile='s' and prosecdef and not proisstrict
 and proparallel='u' and proconfig=array['search_path=""']) from pg_proc where oid in(
 'public.refund_manager_preparation_snapshot(uuid,bigint)'::regprocedure,
 'public.refund_payout_destination_case_current(public.refund_cases)'::regprocedure,
 'public.refund_decision_recommendation_for_case(uuid,timestamptz)'::regprocedure)),
 'read helper security, stability, strictness, parallelism and path remain unchanged');
select ok(has_function_privilege('service_role','public.refund_manager_preparation_snapshot(uuid,bigint)','execute')
 and not has_function_privilege('authenticated','public.refund_manager_preparation_snapshot(uuid,bigint)','execute')
 and not has_function_privilege('anon','public.refund_manager_preparation_snapshot(uuid,bigint)','execute'),
 'query reuse adds no preparation read authority');

insert into public.customer_accounts(id,name,account_type)
values('bb670000-0000-4000-8000-000000000001','Read reuse fixture','internal');
insert into public.reporting_locations(id,account_id,name,timezone)
values('bb670000-0000-4000-8000-000000000002','bb670000-0000-4000-8000-000000000001','Read reuse','America/Los_Angeles');
insert into public.reporting_machines(id,account_id,location_id,machine_label,status,sunze_machine_id)
values('bb670000-0000-4000-8000-000000000003','bb670000-0000-4000-8000-000000000001',
 'bb670000-0000-4000-8000-000000000002','Read reuse cash','active','READ-REUSE');
insert into public.refund_cases(id,public_reference,reporting_machine_id,reporting_location_id,
 customer_email,issue_summary,incident_at,incident_timezone,payment_method,payment_amount_cents,
 status,correlation_status,cash_match_state,cash_match_evaluated_fact_version)
values('bb670000-0000-4000-8000-000000000004','RF-READ-REUSE',
 'bb670000-0000-4000-8000-000000000003','bb670000-0000-4000-8000-000000000002',
 'read-reuse@example.invalid','Synthetic read history',statement_timestamp()-interval '2 hours',
 'America/Los_Angeles','cash',900,'needs_review','manual_review','sales_history_unavailable',1);
insert into public.refund_sunze_cash_correlation_attempts(id,refund_case_id,policy_version,case_fact_version,
 source_snapshot_key,trigger_reason,match_state,reason_code,candidate_count,evaluated_at)
select ('bb670000-0000-4000-8000-'||lpad((100+n)::text,12,'0'))::uuid,
 'bb670000-0000-4000-8000-000000000004','sunze_cash_correlation_v1',1,
 case when n=30 then 'unavailable:none' else 'unavailable:older-'||n end,
 'backfill','sales_history_unavailable','coverage_unavailable',0,
 statement_timestamp()-make_interval(mins=>31-n)
from generate_series(1,30) n;

create temp table read_results(old_calls bigint,new_calls bigint,old_proof jsonb,new_proof jsonb);
-- A session-local sequence records calls without superuser-only diagnostics.
-- Its spy delegates to the complete preceding getter and is rolled back; it
-- retains the getter's STABLE declaration so both query plans remain real.
create sequence pg_temp.source_check_calls;
do $spy$ declare definition text;source text;begin
 select pg_get_functiondef(oid),prosrc into definition,source from pg_proc where oid=
  'public.refund_current_sunze_cash_source_key(uuid,timestamptz,timestamptz)'::regprocedure;
 execute replace(definition,'FUNCTION public.refund_current_sunze_cash_source_key(',
  'FUNCTION pg_temp.source_uninstrumented(');
 execute replace(definition,source,$body$
begin
 perform nextval('pg_temp.source_check_calls');
 return pg_temp.source_uninstrumented(p_reporting_machine_id,p_incident_at,p_now);
end;
$body$);
end $spy$;
-- Exercise a history scan, rather than relying on the planner selecting an
-- already selective index. Every history row must use the same source snapshot.
set local enable_indexscan=off;
set local enable_bitmapscan=off;
do $measure$
declare c public.refund_cases;prior bigint;old_calls bigint;new_calls bigint;old_proof jsonb;new_proof jsonb;
begin
 select * into c from public.refund_cases where id='bb670000-0000-4000-8000-000000000004';
 select case when is_called then last_value else 0 end into prior from pg_temp.source_check_calls;
 old_proof:=pg_temp.before_refund_manager_preparation_snapshot(c.id,c.official_action_version);
 select last_value-prior into old_calls from pg_temp.source_check_calls;
 prior:=prior+old_calls;
 new_proof:=public.refund_manager_preparation_snapshot(c.id,c.official_action_version);
 select last_value-prior into new_calls from pg_temp.source_check_calls;
 insert into read_results values(old_calls,new_calls,old_proof,new_proof);
end $measure$;
select ok((select old_calls>1 and new_calls=1 from read_results),'thirty history rows perform exactly one source check per new query');
select ok((select old_proof is not null and old_proof=new_proof from read_results),'history volume preserves the exact latest Manager preparation proof');
select is((select new_proof->>'evidenceBasis' from read_results),'cash_coverage_unavailable_researched','unavailable history never becomes complete coverage');
select ok((select public.refund_payout_destination_case_current(c) is not distinct from pg_temp.before_refund_payout_destination_case_current(c)
 from public.refund_cases c where id='bb670000-0000-4000-8000-000000000004'),'payout destination result retains preceding semantics');
select ok(public.refund_decision_recommendation_for_case('bb670000-0000-4000-8000-000000000004')
 is not distinct from pg_temp.before_refund_decision_recommendation_for_case('bb670000-0000-4000-8000-000000000004'),
 'recommendation result retains preceding semantics');
update public.refund_cases set payment_amount_cents=1000 where id='bb670000-0000-4000-8000-000000000004';
select ok(public.refund_manager_preparation_snapshot('bb670000-0000-4000-8000-000000000004',
 (select official_action_version from public.refund_cases where id='bb670000-0000-4000-8000-000000000004'))
 is distinct from (select old_proof from read_results),
 'a later execution cannot reuse a proof from stale facts');
set local enable_indexscan=on;
set local enable_bitmapscan=on;

create temp table index_plan(value jsonb);
set local enable_seqscan=off;
do $explain$ declare p jsonb;begin
 execute $query$explain(format json) select coalesce(run.meta->>'githubRunId',run.meta->>'github_run_id')
 from public.sales_import_runs run where run.source='sunze_browser' and run.status='completed'
 and run.completed_at is not null and run.meta->>'machine_coverage_verified'='true'
 and run.meta->>'visible_machine_count_mismatch'='false'
 and nullif(btrim(coalesce(run.meta->>'githubRunId',run.meta->>'github_run_id')),'') is not null
 order by run.completed_at desc,run.id desc limit 1$query$ into p;
 insert into index_plan values(p);
end $explain$;
select ok((select value::text like '%sales_import_runs_verified_cash_completion_idx%' from index_plan),
 'the original fixed predicates and ordering can use the new index');
select ok((select value::text not like '%"Node Type": "Sort"%' from index_plan),'latest-run ordering does not require sorting full history');
select is(current_setting('plan_cache_mode'),'force_generic_plan','read helpers retain the caller planning setting');

select * from finish();
rollback;
