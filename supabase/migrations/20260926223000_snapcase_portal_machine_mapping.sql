-- Admin-only SnapCase source-machine mapping. Staged observations remain private
-- and are not promoted to reporting or payroll facts by this workflow.

create table private.snapcase_machine_mappings (
  provider_account_id uuid not null
    references private.snapcase_provider_accounts (id) on delete restrict,
  source_machine_id text not null,
  reporting_machine_id uuid not null
    references public.reporting_machines (id) on delete restrict,
  partnership_id uuid not null
    references public.reporting_partnerships (id) on delete restrict,
  effective_start_date date not null,
  effective_end_date date,
  mapped_by uuid references auth.users (id) on delete set null,
  mapping_reason text not null,
  mapped_at timestamptz not null default statement_timestamp(),
  updated_at timestamptz not null default statement_timestamp(),
  primary key (provider_account_id, source_machine_id),
  constraint snapcase_machine_mappings_source_fkey
    foreign key (provider_account_id, source_machine_id)
    references private.snapcase_source_machines (provider_account_id, source_machine_id)
    on delete restrict,
  constraint snapcase_machine_mappings_valid_window check (
    effective_end_date is null or effective_end_date >= effective_start_date
  ),
  constraint snapcase_machine_mappings_reason_present check (
    length(btrim(mapping_reason)) between 3 and 500
  )
);

create index snapcase_machine_mappings_reporting_machine_idx
  on private.snapcase_machine_mappings (reporting_machine_id, effective_start_date, effective_end_date);

create index snapcase_machine_mappings_partnership_idx
  on private.snapcase_machine_mappings (partnership_id, effective_start_date);

create trigger snapcase_machine_mappings_set_updated_at
before update on private.snapcase_machine_mappings
for each row execute function public.set_updated_at();

alter table private.snapcase_machine_mappings enable row level security;
revoke all on table private.snapcase_machine_mappings
  from public, anon, authenticated, service_role;

create or replace function public.admin_get_snapcase_machine_mapping_queue()
returns jsonb
language plpgsql
security definer
set search_path = public, private, auth
as $$
begin
  if not public.is_super_admin(auth.uid()) then
    raise exception 'Admin access required';
  end if;

  return coalesce((
    select jsonb_agg(
      jsonb_build_object(
        'providerAccountId', source.provider_account_id,
        'sourceAccountKey', account.source_account_key,
        'sourceMachineId', source.source_machine_id,
        'sourceInventoryId', source.source_inventory_id,
        'sourceMerchantId', source.source_merchant_id,
        'sourceMerchantName', source.source_merchant_name,
        'sourceLabel', source.source_label,
        'sourceStatus', source.source_status,
        'firstSeenAt', source.first_seen_at,
        'lastSeenAt', source.last_seen_at,
        'stagedObservationCount', (
          select count(*)
          from private.snapcase_sales_observations observation
          where observation.provider_account_id = source.provider_account_id
            and observation.source_machine_id = source.source_machine_id
        ),
        'mappingStatus', case when mapping.reporting_machine_id is null then 'pending' else 'mapped' end,
        'reportingMachineId', mapping.reporting_machine_id,
        'partnershipId', mapping.partnership_id,
        'effectiveStartDate', mapping.effective_start_date,
        'effectiveEndDate', mapping.effective_end_date
      )
      order by
        case when mapping.reporting_machine_id is null then 0 else 1 end,
        source.last_seen_at desc,
        source.source_machine_id
    )
    from private.snapcase_source_machines source
    join private.snapcase_provider_accounts account on account.id = source.provider_account_id
    left join private.snapcase_machine_mappings mapping
      on mapping.provider_account_id = source.provider_account_id
     and mapping.source_machine_id = source.source_machine_id
  ), '[]'::jsonb);
end;
$$;

create or replace function public.admin_map_snapcase_machine(
  p_provider_account_id uuid,
  p_source_machine_id text,
  p_reporting_machine_id uuid,
  p_account_id uuid,
  p_location_id uuid,
  p_location_name text,
  p_machine_label text,
  p_partnership_id uuid,
  p_effective_start_date date,
  p_effective_end_date date,
  p_reason text
)
returns jsonb
language plpgsql
security definer
set search_path = public, private, auth
as $$
declare
  normalized_source_machine_id text := btrim(coalesce(p_source_machine_id, ''));
  normalized_location_name text := btrim(coalesce(p_location_name, ''));
  normalized_machine_label text := btrim(coalesce(p_machine_label, ''));
  normalized_reason text;
  source_row private.snapcase_source_machines;
  account_row public.customer_accounts;
  location_row public.reporting_locations;
  machine_row public.reporting_machines;
  partnership_row public.reporting_partnerships;
  assignment_row public.reporting_machine_partnership_assignments;
  before_mapping private.snapcase_machine_mappings;
  after_mapping private.snapcase_machine_mappings;
  created_machine boolean := false;
begin
  if not public.is_super_admin(auth.uid()) then
    raise exception 'Admin access required';
  end if;

  normalized_reason := public.reporting_admin_assert_reason(p_reason);

  select * into source_row
  from private.snapcase_source_machines source
  where source.provider_account_id = p_provider_account_id
    and source.source_machine_id = normalized_source_machine_id
  for update;

  if source_row.id is null then
    raise exception 'SnapCase source machine not found';
  end if;

  if p_partnership_id is null or p_effective_start_date is null then
    raise exception 'Partnership and effective start date are required';
  end if;

  if p_effective_end_date is not null and p_effective_end_date < p_effective_start_date then
    raise exception 'Effective end date must be on or after the start date';
  end if;

  select * into partnership_row
  from public.reporting_partnerships partnership
  where partnership.id = p_partnership_id
    and partnership.status in ('draft', 'active');

  if partnership_row.id is null then
    raise exception 'Reporting partnership not found';
  end if;

  select * into before_mapping
  from private.snapcase_machine_mappings mapping
  where mapping.provider_account_id = p_provider_account_id
    and mapping.source_machine_id = normalized_source_machine_id;

  if p_reporting_machine_id is not null then
    select * into machine_row
    from public.reporting_machines machine
    where machine.id = p_reporting_machine_id;

    if machine_row.id is null then
      raise exception 'Reporting machine not found';
    end if;
  elsif before_mapping.reporting_machine_id is not null then
    select * into machine_row
    from public.reporting_machines machine
    where machine.id = before_mapping.reporting_machine_id;
  else
    if p_account_id is null or normalized_machine_label = '' then
      raise exception 'Account and machine label are required when creating a machine';
    end if;

    select * into account_row
    from public.customer_accounts account
    where account.id = p_account_id
      and account.status = 'active';

    if account_row.id is null then
      raise exception 'Customer account not found';
    end if;

    if p_location_id is not null then
      select * into location_row
      from public.reporting_locations location
      where location.id = p_location_id
        and location.account_id = account_row.id
        and location.status = 'active';
    elsif normalized_location_name <> '' then
      select * into location_row
      from public.reporting_locations location
      where location.account_id = account_row.id
        and lower(location.name) = lower(normalized_location_name)
      limit 1;
    end if;

    if p_location_id is not null and location_row.id is null then
      raise exception 'Location does not belong to the selected account';
    end if;

    if location_row.id is null and normalized_location_name = '' then
      raise exception 'Location is required when creating a machine';
    end if;
  end if;

  -- Validate every possible overlap before creating a location, machine, or assignment.
  if machine_row.id is not null and exists (
    select 1
    from public.reporting_machine_partnership_assignments existing
    where existing.machine_id = machine_row.id
      and existing.partnership_id <> partnership_row.id
      and existing.assignment_role = 'primary_reporting'
      and existing.status = 'active'
      and public.reporting_date_windows_overlap(
        existing.effective_start_date,
        existing.effective_end_date,
        p_effective_start_date,
        p_effective_end_date
      )
  ) then
    raise exception 'This machine already belongs to another active report for these dates';
  end if;

  if machine_row.id is not null and exists (
    select 1
    from private.snapcase_machine_mappings existing
    where existing.reporting_machine_id = machine_row.id
      and (existing.provider_account_id, existing.source_machine_id)
        is distinct from (p_provider_account_id, normalized_source_machine_id)
      and public.reporting_date_windows_overlap(
        existing.effective_start_date,
        existing.effective_end_date,
        p_effective_start_date,
        p_effective_end_date
      )
  ) then
    raise exception 'This Hub machine already has an overlapping SnapCase source mapping';
  end if;

  if before_mapping.reporting_machine_id is not null
    and before_mapping.reporting_machine_id = machine_row.id
    and before_mapping.partnership_id = partnership_row.id
    and before_mapping.effective_start_date = p_effective_start_date
    and before_mapping.effective_end_date is not distinct from p_effective_end_date then
    return jsonb_build_object(
      'machineId', before_mapping.reporting_machine_id,
      'partnershipId', before_mapping.partnership_id,
      'providerAccountId', before_mapping.provider_account_id,
      'sourceMachineId', before_mapping.source_machine_id,
      'createdMachine', false,
      'replayed', true,
      'publishedObservationCount', 0
    );
  end if;

  if machine_row.id is null then
    if location_row.id is null then
      insert into public.reporting_locations (account_id, name, timezone, status)
      values (account_row.id, normalized_location_name, partnership_row.timezone, 'active')
      returning * into location_row;
    end if;

    insert into public.reporting_machines (
      account_id,
      location_id,
      machine_label,
      machine_type,
      status,
      notes
    )
    values (
      account_row.id,
      location_row.id,
      normalized_machine_label,
      'snapcase',
      'active',
      'Created from explicit SnapCase portal mapping.'
    )
    returning * into machine_row;
    created_machine := true;

    insert into public.admin_audit_log (
      actor_user_id, action, entity_type, entity_id, before, after, meta
    ) values (
      auth.uid(), 'reporting_machine.created', 'reporting_machine', machine_row.id::text,
      '{}'::jsonb, to_jsonb(machine_row),
      jsonb_build_object('reason', normalized_reason, 'source_provider', 'snapcase')
    );
  end if;

  select * into assignment_row
  from public.reporting_machine_partnership_assignments assignment
  where assignment.machine_id = machine_row.id
    and assignment.partnership_id = partnership_row.id
    and assignment.assignment_role = 'primary_reporting'
    and public.reporting_date_windows_overlap(
      assignment.effective_start_date,
      assignment.effective_end_date,
      p_effective_start_date,
      p_effective_end_date
    )
  order by assignment.created_at desc
  limit 1;

  if assignment_row.id is null then
    insert into public.reporting_machine_partnership_assignments (
      machine_id, partnership_id, assignment_role, effective_start_date,
      effective_end_date, status, notes, created_by
    ) values (
      machine_row.id, partnership_row.id, 'primary_reporting', p_effective_start_date,
      p_effective_end_date, 'active', 'Created from explicit SnapCase portal mapping.', auth.uid()
    ) returning * into assignment_row;
  end if;

  insert into private.snapcase_machine_mappings as mapping (
    provider_account_id, source_machine_id, reporting_machine_id, partnership_id,
    effective_start_date, effective_end_date, mapped_by, mapping_reason
  ) values (
    p_provider_account_id, normalized_source_machine_id, machine_row.id, partnership_row.id,
    p_effective_start_date, p_effective_end_date, auth.uid(), normalized_reason
  )
  on conflict (provider_account_id, source_machine_id) do update set
    reporting_machine_id = excluded.reporting_machine_id,
    partnership_id = excluded.partnership_id,
    effective_start_date = excluded.effective_start_date,
    effective_end_date = excluded.effective_end_date,
    mapped_by = excluded.mapped_by,
    mapping_reason = excluded.mapping_reason,
    mapped_at = statement_timestamp()
  returning * into after_mapping;

  insert into public.admin_audit_log (
    actor_user_id, action, entity_type, entity_id, before, after, meta
  ) values (
    auth.uid(), 'snapcase_machine.mapped', 'snapcase_machine_mapping',
    after_mapping.provider_account_id::text || ':' || after_mapping.source_machine_id,
    coalesce(to_jsonb(before_mapping), '{}'::jsonb), to_jsonb(after_mapping),
    jsonb_build_object(
      'reason', normalized_reason,
      'created_machine', created_machine,
      'published_observation_count', 0
    )
  );

  return jsonb_build_object(
    'machineId', machine_row.id,
    'machineLabel', machine_row.machine_label,
    'partnershipId', partnership_row.id,
    'partnershipName', partnership_row.name,
    'providerAccountId', after_mapping.provider_account_id,
    'sourceMachineId', after_mapping.source_machine_id,
    'createdMachine', created_machine,
    'replayed', false,
    'publishedObservationCount', 0
  );
end;
$$;

revoke all on function public.admin_get_snapcase_machine_mapping_queue()
  from public, anon;
grant execute on function public.admin_get_snapcase_machine_mapping_queue()
  to authenticated;

revoke all on function public.admin_map_snapcase_machine(
  uuid, text, uuid, uuid, uuid, text, text, uuid, date, date, text
) from public, anon;
grant execute on function public.admin_map_snapcase_machine(
  uuid, text, uuid, uuid, uuid, text, text, uuid, date, date, text
) to authenticated;

comment on table private.snapcase_machine_mappings is
  'Audited effective mapping from the composite SnapCase provider identity to canonical Hub reporting scope. It does not publish staged observations.';

select pg_notify('pgrst', 'reload schema');
