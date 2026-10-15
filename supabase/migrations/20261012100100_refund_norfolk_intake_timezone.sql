-- Intake-only correction for the reviewed Norfolk machine. Do not move the
-- machine, edit its shared reporting location, or rewrite historical facts.
create function public.refund_intake_timezone(
  p_machine_id uuid,
  p_location_timezone text,
  p_manual_enabled boolean,
  p_manual_timezone text
)
returns text
language sql
immutable
security invoker
set search_path = ''
as $$
  select case
    when p_machine_id = '0bcc055d-122f-4d30-aca4-2648a4f0516a'::uuid
      and p_location_timezone = 'America/Los_Angeles'
      and p_manual_enabled is true
      and p_manual_timezone = 'America/New_York'
    then p_manual_timezone
    else p_location_timezone
  end;
$$;

comment on function public.refund_intake_timezone(uuid,text,boolean,text) is
  'Read-only intake clock resolution. Uses the already reviewed Norfolk clock for its exact placeholder mismatch; all other inputs retain their existing location clock.';
revoke all on function public.refund_intake_timezone(uuid,text,boolean,text)
  from public, anon, authenticated;
grant execute on function public.refund_intake_timezone(uuid,text,boolean,text)
  to service_role;

-- Preserve the existing option membership, archive checks, labels, keys and
-- grouping. All public selection versions already consume this projection.
do $patch$
declare
  definition text;
  anchor text := 'location.timezone as location_timezone';
begin
  definition := pg_get_functiondef('public.public_refund_machine_options()'::regprocedure);
  if (length(definition) - length(replace(definition, anchor, ''))) / length(anchor) <> 1 then
    raise exception 'Expected one public refund option timezone projection';
  end if;
  execute replace(definition, anchor,
    'public.refund_intake_timezone(machine.id, location.timezone, machine.nayax_manual_portal_enabled, machine.nayax_manual_portal_timezone) as location_timezone');
end;
$patch$;

select pg_notify('pgrst', 'reload schema');
