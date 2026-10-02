-- Gift fulfillment already owns its actor/action projection. Do not reinterpret
-- assigned codes, stock waits or repeat review as monetary purchase research.
begin;
do $migration$
declare
  definition text;
  old_fragment text := E'begin\n  result:=public.refund_next_work_for_case_pre_manager_route_v1(';
  new_fragment text := E'begin\n  if p_lifecycle->>''resolutionMethod''=''gift_card'' then\n    return p_lifecycle;\n  end if;\n  result:=public.refund_next_work_for_case_pre_manager_route_v1(';
begin
  definition:=replace(pg_get_functiondef(
    'public.refund_next_work_for_case(uuid,jsonb)'::regprocedure),E'\r\n',E'\n');
  if length(definition)-length(replace(definition,old_fragment,''))<>length(old_fragment) then
    raise exception 'Expected unique shared next-work wrapper was not found';
  end if;
  execute replace(definition,old_fragment,new_fragment);

  -- Retain the existing lifecycle action contract instead of making clients
  -- infer a missing action from the gift-specific required=false marker.
  old_fragment:='''customerAction'',jsonb_build_object(''required'',false';
  new_fragment:='''customerAction'',jsonb_build_object(''action'',''none'',''required'',false';
  definition:=pg_get_functiondef('public.refund_lifecycle_contract(uuid)'::regprocedure);
  if length(definition)-length(replace(definition,old_fragment,''))<>length(old_fragment) then
    raise exception 'Expected unique canonical gift customer action was not found';
  end if;
  execute replace(definition,old_fragment,new_fragment);
end;
$migration$;
select pg_notify('pgrst','reload schema');
commit;
