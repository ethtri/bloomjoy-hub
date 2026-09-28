-- A physical SnapCase machine can predate the current machine_type taxonomy.
-- Existing Nayax binding is the narrow evidence that permits one of those
-- legacy records to receive SnapCase cash. Sunze-bound records remain excluded.
create or replace function private.snapcase_mapping_target_eligible(
  p_machine public.reporting_machines
)
returns boolean
language sql
immutable
security invoker
set search_path = ''
as $$
  select
    p_machine.sunze_machine_id is null
    and (
      p_machine.machine_type = 'snapcase'
      or nullif(btrim(p_machine.nayax_machine_id), '') is not null
    );
$$;

revoke all on function private.snapcase_mapping_target_eligible(public.reporting_machines)
  from public, anon, authenticated, service_role;

comment on function private.snapcase_mapping_target_eligible(public.reporting_machines) is
  'Shared narrow eligibility for SnapCase source mappings: non-Sunze and either current SnapCase type or an existing Nayax binding.';

-- Keep the established mapping/publication/payroll functions intact while
-- replacing their duplicated legacy type check with the shared predicate.
-- Preserve mapped_at on conflict because the publication receipt hash includes
-- mapping identity and that original timestamp; updated_at and the audit row
-- still record the repair. Every replacement asserts its exact count.
do $$
declare
  patch record;
  definition text;
  occurrence_count integer;
begin
  for patch in
    select *
    from (values
      (
        'public.admin_map_snapcase_machine(uuid,text,uuid,uuid,uuid,text,text,uuid,date,date,text)'::regprocedure,
        'if machine_row.machine_type <> ''snapcase'' or machine_row.sunze_machine_id is not null then',
        'if not private.snapcase_mapping_target_eligible(machine_row) then',
        1
      ),
      (
        'public.admin_map_snapcase_machine(uuid,text,uuid,uuid,uuid,text,text,uuid,date,date,text)'::regprocedure,
        'mapped_at = statement_timestamp()',
        'mapped_at = mapping.mapped_at',
        1
      ),
      (
        'public.service_project_snapcase_financial_window(uuid,text,timestamp with time zone,timestamp with time zone)'::regprocedure,
        'and machine.machine_type = ''snapcase''',
        'and private.snapcase_mapping_target_eligible(machine)',
        2
      ),
      (
        'private.operator_incomplete_snapcase_sales_machines(uuid,uuid,date,date)'::regprocedure,
        'and machine.machine_type = ''snapcase''',
        'and (machine.machine_type = ''snapcase'' or exists (
          select 1
          from private.snapcase_machine_mappings payroll_mapping
          where payroll_mapping.reporting_machine_id = machine.id
            and payroll_mapping.effective_start_date <= assigned_day.value::date
            and coalesce(payroll_mapping.effective_end_date, ''infinity''::date)
              >= assigned_day.value::date
        ))',
        1
      ),
      (
        'private.operator_snapcase_zero_import_covers_commission_days(uuid,uuid,uuid,date,date)'::regprocedure,
        'and machine.machine_type = ''snapcase''',
        'and (machine.machine_type = ''snapcase'' or exists (
          select 1
          from private.snapcase_machine_mappings payroll_mapping
          where payroll_mapping.reporting_machine_id = machine.id
            and payroll_mapping.effective_start_date <= assigned_day.value::date
            and coalesce(payroll_mapping.effective_end_date, ''infinity''::date)
              >= assigned_day.value::date
        ))',
        1
      ),
      (
        'private.operator_snapcase_missing_nayax_card_machines(uuid,uuid,date,date)'::regprocedure,
        'and machine.machine_type = ''snapcase''',
        'and (machine.machine_type = ''snapcase'' or mapping.id is not null)',
        1
      )
    ) as patches(target, needle, replacement, expected_count)
  loop
    definition := pg_get_functiondef(patch.target);
    occurrence_count := (
      length(definition) - length(replace(definition, patch.needle, ''))
    ) / length(patch.needle);

    if occurrence_count <> patch.expected_count then
      raise exception
        'SnapCase eligibility patch drift for %: expected % occurrence(s), found %',
        patch.target, patch.expected_count, occurrence_count;
    end if;

    execute replace(definition, patch.needle, patch.replacement);
  end loop;
end;
$$;

select pg_notify('pgrst', 'reload schema');
