-- The durable-lifecycle overview wrapper predates lifecycle v2. Its unqualified
-- lifecycle call now resolves to the complete current projector, so the full
-- lifecycle is built once there and then replaced by the later v2 projection.
-- Restore the retained lifecycle contract that this stage originally consumed;
-- the later v2 wrapper remains the single authoritative current projection.

do $$
declare
  overview_source text := pg_get_functiondef(
    'public.admin_get_refund_operations_overview_pre_manager_lifecycle_v1()'
      ::regprocedure);
  current_call constant text :=
    'public.refund_lifecycle_contract(refund_case.id)';
  retained_call constant text :=
    'public.refund_lifecycle_contract_pre_manager_queue_truth_v1(refund_case.id)';
begin
  if pg_catalog.to_regprocedure(
      'public.refund_lifecycle_contract_pre_manager_queue_truth_v1(uuid)')
      is null then
    raise exception 'Retained durable lifecycle contract is unavailable'
      using errcode = 'P4660';
  end if;

  if (length(overview_source)-length(replace(
      overview_source,current_call,'')))/length(current_call) <> 1
    or strpos(overview_source,retained_call) > 0 then
    raise exception 'Durable overview lifecycle source changed before reuse'
      using errcode = 'P4661';
  end if;

  execute replace(overview_source,current_call,retained_call);
end
$$;

comment on function
  public.admin_get_refund_operations_overview_pre_manager_lifecycle_v1() is
  'Builds the historical durable lifecycle stage from its retained contract; the later lifecycle-v2 overview wrapper remains the single current lifecycle authority.';

select pg_notify('pgrst','reload schema');
