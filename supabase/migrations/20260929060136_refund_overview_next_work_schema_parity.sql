-- #628: the final reconciliation projection must preserve the exact public
-- refund_next_work_v1 shape. The prior repair selected the correct Agent action,
-- but omitted nullable timing keys, so the browser correctly rejected the whole
-- lifecycle contract as unavailable.

create or replace function public.admin_get_refund_operations_overview()
returns jsonb
language plpgsql
stable
security definer
set statement_timeout='20s'
set work_mem='32MB'
set search_path=''
as $$
declare
  base jsonb:=public.admin_refund_overview_pre_reconcile_v1();
  field_name text;
  repaired jsonb;
begin
  foreach field_name in array array['cases','internalTestCases'] loop
    if jsonb_typeof(base->field_name)='array' then
      select coalesce(jsonb_agg(
        case
          when jsonb_typeof(item.case_json#>'{lifecycle,nextWork}')='object'
            and item.case_json#>>'{lifecycle,nextWork,actor}'='system'
            and item.case_json#>>'{lifecycle,nextWork,actionCode}'='run_lookup'
            and coalesce(item.case_json->>'id','') ~
              '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$'
          then case when public.refund_case_has_unresolved_reconciliation(
              (item.case_json->>'id')::uuid)
            then jsonb_set(item.case_json,'{lifecycle,nextWork}',
              jsonb_build_object(
                'schemaVersion','refund_next_work_v1',
                'isOpen',true,
                'actor','agent',
                'actionCode','research_purchase',
                'actionLabel','Research the purchase and prepare the next safe step.',
                'lastProgressAt',null,
                'dueAt',null,
                'blocker',null,
                'payloadRedacted',true),true)
            else item.case_json end
          else item.case_json
        end order by item.case_order), '[]'::jsonb)
      into repaired
      from jsonb_array_elements(base->field_name)
        with ordinality item(case_json,case_order);
      base:=jsonb_set(base,array[field_name],repaired,true);
    end if;
  end loop;
  return base;
end;
$$;

revoke all on function public.admin_get_refund_operations_overview()
  from public,anon;
grant execute on function public.admin_get_refund_operations_overview()
  to authenticated,service_role;

comment on function public.admin_get_refund_operations_overview() is
  'Final actor-scoped refund overview; duplicate reconciliation removes false System lookup work while preserving the exact public next-work contract.';

select pg_notify('pgrst','reload schema');

