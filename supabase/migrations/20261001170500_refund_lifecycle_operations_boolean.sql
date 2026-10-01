-- Keep the existing review predicate and wrappers; serialize its non-review
-- NULL result as the boolean false required by refund_lifecycle_v2.
begin;
do $migration$
declare
  definition text := replace(pg_catalog.pg_get_functiondef(
    'public.refund_lifecycle_contract_pre_authoritative_receipt_v1(uuid)'::regprocedure
  ), E'\r\n', E'\n');
  old_fragment text := $old$      'required', operations_required,$old$;
  new_fragment text := $new$      'required', coalesce(operations_required, false),$new$;
begin
  if length(definition) - length(replace(definition, old_fragment, ''))
    <> length(old_fragment) then
    raise exception 'Expected unique lifecycle operations.required projection was not found';
  end if;
  execute replace(definition, old_fragment, new_fragment);
end;
$migration$;
select pg_notify('pgrst', 'reload schema');
commit;
