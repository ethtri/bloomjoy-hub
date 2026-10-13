begin;
set local lock_timeout='3s';

-- The existing positive-evidence reader scans and sorts completed import
-- history for every source check. Index its exact fixed predicates and order;
-- date-window validation remains in the authoritative reader unchanged.
create index sales_import_runs_verified_cash_completion_idx
 on public.sales_import_runs(completed_at desc,id desc)
 where source='sunze_browser' and status='completed' and completed_at is not null
  and meta->>'machine_coverage_verified'='true'
  and meta->>'visible_machine_count_mismatch'='false'
  and nullif(btrim(coalesce(meta->>'githubRunId',meta->>'github_run_id')),'') is not null;

-- These inputs are PL/pgSQL variables, independent of scanned history rows.
-- An InitPlan evaluates the same STABLE source check once per query instead
-- of once per attempt. Each execution still reads the current SQL snapshot;
-- nothing persists across calls, actors, source changes or observation times.
-- Preserve the complete original function bodies, attributes and privileges.
do $patch$
declare signature text;definition text;anchor text;expected integer;
begin
 if (select provolatile from pg_proc where oid=
  'public.refund_current_sunze_cash_source_key(uuid,timestamptz,timestamptz)'::regprocedure)
  is distinct from 's' then raise exception 'Source check must remain STABLE';end if;
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
  if cardinality(string_to_array(definition,anchor))<>expected+1 then
   raise exception 'Source key reader changed: %',signature;
  end if;
  execute replace(definition,anchor,'(select '||anchor||')');
 end loop;
end $patch$;

commit;
