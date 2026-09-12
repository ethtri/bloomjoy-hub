-- Machine types keep compact canonical storage keys while the portal owns the
-- customer-facing labels. Existing rows, including unverified `unknown` rows,
-- are intentionally left unchanged.

alter table public.reporting_machines
  drop constraint if exists reporting_machines_machine_type_check;

alter table public.reporting_machines
  add constraint reporting_machines_machine_type_check
  check (machine_type in ('commercial', 'mini', 'micro', 'snapcase', 'unknown'))
  not valid;

alter table public.reporting_machines
  validate constraint reporting_machines_machine_type_check;

-- Both existing write paths enforce their own allowlist before reaching the
-- table constraint. Rebuild the same functions from their current definitions
-- with the one additional canonical value. Fail closed if an earlier migration
-- changed either validation clause unexpectedly.
do $migration$
declare
  target_function regprocedure;
  current_definition text;
  old_validation constant text :=
    'if normalized_machine_type not in (''commercial'', ''mini'', ''micro'', ''unknown'') then';
  new_validation constant text :=
    'if normalized_machine_type not in (''commercial'', ''mini'', ''micro'', ''snapcase'', ''unknown'') then';
begin
  foreach target_function in array array[
    'public.admin_upsert_reporting_machine(uuid,text,text,text,text,text,text)'::regprocedure,
    'public.admin_map_source_machine_to_partnership(text,uuid,text,text,text,numeric,date,date,date,text)'::regprocedure
  ]
  loop
    current_definition := pg_get_functiondef(target_function::oid);

    if current_definition is null
      or current_definition not like '%' || old_validation || '%'
      or replace(current_definition, old_validation, '') like '%' || old_validation || '%'
    then
      raise exception 'Unexpected machine type validation in %', target_function;
    end if;

    execute replace(current_definition, old_validation, new_validation);
  end loop;
end
$migration$;

comment on column public.reporting_machines.machine_type is
  'Canonical machine family: commercial, mini, micro, snapcase, or unknown for legacy/unverified records.';
