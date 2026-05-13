-- Refund scope and readiness hardening.
--
-- Sunze-backed refund intake is currently supported only for Bloomjoy Commercial
-- and Bloomjoy Mini machines. Snapcase and other future machine types need their
-- own source-of-truth before entering this customer refund workflow.

create or replace function public.public_refund_machine_options()
returns table (
  machine_id uuid,
  machine_label text,
  location_id uuid,
  location_name text,
  location_timezone text
)
language sql
stable
security definer
set search_path = public
as $$
  select
    machine.id as machine_id,
    coalesce(nullif(trim(machine.refund_public_display_label), ''), machine.machine_label) as machine_label,
    location.id as location_id,
    location.name as location_name,
    location.timezone as location_timezone
  from public.reporting_machines machine
  join public.reporting_locations location on location.id = machine.location_id
  where machine.status = 'active'
    and machine.machine_type in ('commercial', 'mini')
    and machine.refund_intake_enabled = true
    and location.status = 'active'
  order by location.name, coalesce(nullif(trim(machine.refund_public_display_label), ''), machine.machine_label);
$$;

comment on function public.public_refund_machine_options() is
  'Public noindex refund intake selector. Exposes only active Commercial/Mini machines explicitly enabled for refund intake.';

create or replace function public.admin_get_refund_manager_setup()
returns jsonb
language plpgsql
stable
security definer
set search_path = public, auth
as $$
declare
  actor_user_id uuid;
  result jsonb;
begin
  actor_user_id := auth.uid();

  if actor_user_id is null then
    raise exception 'Authentication required';
  end if;

  if not public.is_super_admin(actor_user_id) and not public.is_scoped_admin(actor_user_id) then
    raise exception 'Machine setup access required';
  end if;

  select jsonb_build_object(
    'machines', coalesce((
      select jsonb_agg(
        jsonb_build_object(
          'id', machine.id,
          'machineLabel', machine.machine_label,
          'machineType', machine.machine_type,
          'locationName', location.name,
          'refundIntakeEnabled', coalesce(machine.refund_intake_enabled, false),
          'refundPublicDisplayLabel', machine.refund_public_display_label,
          'nayaxLookupConfigured',
            machine.nayax_machine_id is not null and btrim(machine.nayax_machine_id) <> '',
          'nayaxMachineId', machine.nayax_machine_id,
          'nayaxAccountKey', machine.nayax_account_key,
          'managerEmails', coalesce((
            select jsonb_agg(manager.manager_email order by manager.manager_email)
            from public.reporting_machine_refund_managers manager
            where manager.reporting_machine_id = machine.id
              and manager.status = 'active'
              and manager.revoked_at is null
          ), '[]'::jsonb)
        )
        order by location.name, machine.machine_label
      )
      from public.reporting_machines machine
      join public.reporting_locations location on location.id = machine.location_id
      where machine.status = 'active'
        and machine.machine_type in ('commercial', 'mini')
        and public.can_manage_refund_machine(actor_user_id, machine.id)
    ), '[]'::jsonb)
  )
  into result;

  return result;
end;
$$;

comment on function public.admin_get_refund_manager_setup() is
  'Commercial/Mini Machine Manager and refund readiness setup data without refund case/customer payloads.';

revoke execute on function public.admin_get_refund_manager_setup()
  from public, anon;
grant execute on function public.admin_get_refund_manager_setup()
  to authenticated;

create or replace function public.admin_set_reporting_machine_refund_intake_config(
  p_machine_id uuid,
  p_refund_intake_enabled boolean,
  p_refund_public_display_label text default null,
  p_reason text default 'Refund intake readiness updated from Admin Machines'
)
returns jsonb
language plpgsql
security definer
set search_path = public, auth
as $$
declare
  actor_user_id uuid;
  actor_is_super_admin boolean;
  actor_is_scoped_admin boolean;
  before_row public.reporting_machines;
  after_row public.reporting_machines;
  normalized_display_label text := nullif(trim(coalesce(p_refund_public_display_label, '')), '');
  normalized_reason text := nullif(trim(coalesce(p_reason, '')), '');
  active_manager_count integer := 0;
begin
  actor_user_id := auth.uid();
  actor_is_super_admin := public.is_super_admin(actor_user_id);
  actor_is_scoped_admin := public.is_scoped_admin(actor_user_id);

  if actor_user_id is null then
    raise exception 'Authentication required';
  end if;

  if not actor_is_super_admin and not actor_is_scoped_admin then
    raise exception 'Scoped Admin or Super Admin access required';
  end if;

  if p_machine_id is null then
    raise exception 'Machine is required';
  end if;

  if not public.can_manage_refund_machine(actor_user_id, p_machine_id) then
    raise exception 'Machine access required';
  end if;

  if normalized_reason is null then
    raise exception 'Refund intake setup changes require a reason';
  end if;

  if normalized_display_label is not null and length(normalized_display_label) > 120 then
    raise exception 'Refund display label must be 120 characters or fewer';
  end if;

  select *
  into before_row
  from public.reporting_machines machine
  where machine.id = p_machine_id
  for update;

  if before_row.id is null then
    raise exception 'Reporting machine not found';
  end if;

  if coalesce(p_refund_intake_enabled, false) then
    if before_row.machine_type not in ('commercial', 'mini') then
      raise exception 'Refund intake currently supports Bloomjoy Commercial and Mini machines only';
    end if;

    if before_row.nayax_machine_id is null or btrim(before_row.nayax_machine_id) = '' then
      raise exception 'Nayax machine ID is required before this machine can be shown on the refund request form';
    end if;

    if not exists (
      select 1
      from public.reporting_locations location
      where location.id = before_row.location_id
        and location.status = 'active'
    ) then
      raise exception 'Machine location must be active before this machine can be shown on the refund request form';
    end if;

    select count(*)::integer
    into active_manager_count
    from public.reporting_machine_refund_managers manager
    where manager.reporting_machine_id = before_row.id
      and manager.status = 'active'
      and manager.revoked_at is null;

    if active_manager_count < 1 then
      raise exception 'Assign at least one Machine Manager before showing this machine on the refund request form';
    end if;
  end if;

  update public.reporting_machines
  set
    refund_intake_enabled = coalesce(p_refund_intake_enabled, false),
    refund_public_display_label = normalized_display_label
  where id = before_row.id
  returning * into after_row;

  insert into public.admin_audit_log (
    actor_user_id,
    action,
    entity_type,
    entity_id,
    before,
    after,
    meta
  )
  values (
    actor_user_id,
    'reporting_machine.refund_intake_config.set',
    'reporting_machine',
    before_row.id::text,
    jsonb_build_object(
      'refund_intake_enabled', coalesce(before_row.refund_intake_enabled, false),
      'has_refund_public_display_label',
        before_row.refund_public_display_label is not null
        and btrim(before_row.refund_public_display_label) <> ''
    ),
    jsonb_build_object(
      'refund_intake_enabled', coalesce(after_row.refund_intake_enabled, false),
      'has_refund_public_display_label',
        after_row.refund_public_display_label is not null
        and btrim(after_row.refund_public_display_label) <> ''
    ),
    jsonb_build_object(
      'reason', normalized_reason,
      'actor_authority', case when actor_is_super_admin then 'super_admin' else 'scoped_admin' end,
      'machine_type', after_row.machine_type,
      'active_manager_count', active_manager_count
    )
  );

  return jsonb_build_object(
    'machine', jsonb_build_object(
      'id', after_row.id,
      'refundIntakeEnabled', coalesce(after_row.refund_intake_enabled, false),
      'refundPublicDisplayLabel', after_row.refund_public_display_label
    )
  );
end;
$$;

comment on function public.admin_set_reporting_machine_refund_intake_config(uuid, boolean, text, text) is
  'Admin/scoped-admin setup path for enabling a Commercial/Mini reporting machine on the public refund request selector after manager and Nayax readiness gates pass.';

revoke execute on function public.admin_set_reporting_machine_refund_intake_config(uuid, boolean, text, text)
  from public, anon;
grant execute on function public.admin_set_reporting_machine_refund_intake_config(uuid, boolean, text, text)
  to authenticated;

select pg_notify('pgrst', 'reload schema');
