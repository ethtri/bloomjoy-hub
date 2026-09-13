-- The grouped directory query joins reporting_machines, which also has an
-- updated_at column. Qualify the summary source timestamp explicitly.
do $$
declare
  function_definition text;
begin
  function_definition := pg_get_functiondef(
    'private.admin_list_access_people(text,text,uuid,text,uuid,integer,integer)'::regprocedure
  );

  if strpos(function_definition, 'max(visible.updated_at)') > 0 then
    return;
  end if;

  if strpos(function_definition, 'max(updated_at)') = 0 then
    raise exception 'Expected people directory timestamp expression was not found';
  end if;

  execute replace(
    function_definition,
    'max(updated_at)',
    'max(visible.updated_at)'
  );
end;
$$;
