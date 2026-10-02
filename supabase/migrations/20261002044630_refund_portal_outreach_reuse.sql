-- The canonical lifecycle already carries outreach from this statement. Reuse
-- that exact value at the Manager redaction boundary instead of repeating its
-- purchase-correction/venue research for every queue row. Keep the existing
-- receipt projection, scope checks and outer next-work projection unchanged.
begin;
do $migration$
declare
  definition text := replace(pg_catalog.pg_get_functiondef(
    'public.get_refund_lifecycle_for_manager_pre_next_work_v1(uuid)'::regprocedure
  ), E'\r\n', E'\n');
  old_fragment text := $old$  outreach jsonb := public.refund_customer_outreach_contract(p_refund_case_id);$old$;
  new_fragment text := $new$  outreach jsonb := case
    when jsonb_typeof(base -> 'customerOutreach') = 'object'
      then base -> 'customerOutreach'
    else public.refund_customer_outreach_contract(p_refund_case_id)
  end;$new$;
begin
  if length(definition) - length(replace(definition, old_fragment, ''))
    <> length(old_fragment) then
    raise exception 'Expected unique Manager outreach reader was not found';
  end if;
  execute replace(definition, old_fragment, new_fragment);
end;
$migration$;
select pg_notify('pgrst','reload schema');
commit;
