-- The authenticated refund overview now carries the complete manager contract
-- for the production portfolio. Its current production runtime is slightly
-- above the inherited 8-second API-role statement timeout, so PostgreSQL
-- cancels otherwise successful reads immediately before they finish.
--
-- Give this one read-only admin function a bounded runtime budget and enough
-- working memory to avoid unnecessary spill while assembling its JSON result.
-- The setting is local to each function call and does not widen any role,
-- project, or mutation timeout.

do $$
declare
  overview_source text:=pg_get_functiondef(
    'public.admin_get_refund_operations_overview()'::regprocedure);
  parity_source text:=pg_get_functiondef(
    'public.admin_get_refund_operations_overview_pre_lookup_recovery_v1()'::regprocedure);
begin
  if strpos(overview_source,'refund_project_current_next_work_cases')=0
    or strpos(parity_source,'refund_customer_correction_fields_v1')=0 then
    raise exception 'Refund overview source changed before runtime budget'
      using errcode='P4652';
  end if;
end $$;

alter function public.admin_get_refund_operations_overview()
  set statement_timeout='20s';
alter function public.admin_get_refund_operations_overview()
  set work_mem='32MB';

comment on function public.admin_get_refund_operations_overview() is
  'Actor-scoped refund overview with exact current correction, outreach, recovery, next-work, and decision contract reuse; read-only execution is bounded to 20 seconds with 32 MB working memory.';

select pg_notify('pgrst','reload schema');
