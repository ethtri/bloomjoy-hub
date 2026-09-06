-- Rebind the outer manager overview to the current correction-scope helper.
-- Earlier overview wrappers can retain a plan bound to the helper that existed
-- before a forward-only helper replacement. Recompute only this derived field
-- at the final response boundary and preserve every other projected value.

alter function public.admin_get_refund_operations_overview()
  rename to admin_get_refund_operations_overview_pre_correction_scope_parity_v1;

revoke all on function public.admin_get_refund_operations_overview_pre_correction_scope_parity_v1()
  from public, anon, authenticated, service_role;

create function public.admin_get_refund_operations_overview()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  base jsonb;
  projected jsonb;
begin
  -- The wrapped function remains authoritative for authentication, case
  -- visibility, ordering, lifecycle, receipt, and all non-correction fields.
  base := public.admin_get_refund_operations_overview_pre_correction_scope_parity_v1();

  if jsonb_typeof(base -> 'cases') = 'array' then
    select coalesce(jsonb_agg(
      jsonb_set(
        item.value,
        '{customerCorrectionFields}',
        to_jsonb(public.refund_purchase_correction_request_fields(
          (item.value ->> 'id')::uuid
        )),
        true
      ) order by item.ordinality
    ), '[]'::jsonb)
    into projected
    from jsonb_array_elements(base -> 'cases') with ordinality item;

    base := jsonb_set(base, '{cases}', projected, true);
  end if;

  if jsonb_typeof(base -> 'internalTestCases') = 'array' then
    select coalesce(jsonb_agg(
      jsonb_set(
        item.value,
        '{customerCorrectionFields}',
        to_jsonb(public.refund_purchase_correction_request_fields(
          (item.value ->> 'id')::uuid
        )),
        true
      ) order by item.ordinality
    ), '[]'::jsonb)
    into projected
    from jsonb_array_elements(base -> 'internalTestCases') with ordinality item;

    base := jsonb_set(base, '{internalTestCases}', projected, true);
  end if;

  return base;
end;
$$;

revoke all on function public.admin_get_refund_operations_overview()
  from public, anon;
grant execute on function public.admin_get_refund_operations_overview()
  to authenticated, service_role;

comment on function public.admin_get_refund_operations_overview() is
  'Returns the current manager refund projection. The outer response recomputes customerCorrectionFields from the current helper for each visible ordinary and Internal/test case while preserving wrapped visibility, ordering, lifecycle, receipt, selection, payment, and contact data.';

select pg_notify('pgrst', 'reload schema');
