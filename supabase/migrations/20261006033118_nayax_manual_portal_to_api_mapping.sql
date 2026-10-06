-- Explicit API identity assignment retires only the current manual configuration.
-- Existing evidence, case history and refund capabilities remain untouched.
do $migration$
declare
  definition text;
  assignment_anchor text := E'    nayax_machine_id = normalized_machine_id,\n';
  before_anchor text := '''had_nayax_machine_id'', before_row.nayax_machine_id';
  after_anchor text := '''has_nayax_machine_id'', after_row.nayax_machine_id';
begin
  definition := replace(replace(pg_get_functiondef(
    'public.admin_set_reporting_machine_nayax_config(uuid,text,text,text)'::regprocedure), E'\r\n', E'\n'), E'\r', E'\n');
  if strpos(definition, assignment_anchor) = 0
    or strpos(definition, before_anchor) = 0 or strpos(definition, after_anchor) = 0 then
    raise exception 'Canonical Nayax configuration writer anchors changed';
  end if;
  definition := replace(definition, assignment_anchor,
    E'    nayax_manual_portal_enabled = case when normalized_machine_id is not null then false else before_row.nayax_manual_portal_enabled end,\n'
    || E'    nayax_manual_account_scope = case when normalized_machine_id is not null then null else before_row.nayax_manual_account_scope end,\n'
    || E'    nayax_manual_portal_timezone = case when normalized_machine_id is not null then null else before_row.nayax_manual_portal_timezone end,\n'
    || assignment_anchor);
  definition := replace(definition, before_anchor,
    '''manual_portal_enabled'', before_row.nayax_manual_portal_enabled, ' || before_anchor);
  definition := replace(definition, after_anchor,
    '''manual_portal_enabled'', after_row.nayax_manual_portal_enabled, ' || after_anchor);
  execute definition;
end;
$migration$;
