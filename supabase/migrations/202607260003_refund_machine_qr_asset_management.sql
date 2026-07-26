-- Admin-managed, print-ready refund QR assets and physical rollout evidence.
--
-- Public QR codes are intentionally opaque. Admin RPCs expose only a claim URL
-- containing that public value; internal machine IDs, QR row IDs, and provider
-- identifiers are never included in the asset payload or audit metadata.

alter table public.refund_machine_qr_codes
  add column if not exists printed_at timestamptz,
  add column if not exists printed_by uuid references auth.users (id) on delete set null,
  add column if not exists installed_at timestamptz,
  add column if not exists installed_by uuid references auth.users (id) on delete set null,
  add column if not exists label_verified_at timestamptz,
  add column if not exists label_verified_by uuid references auth.users (id) on delete set null,
  add column if not exists phone_verified_at timestamptz,
  add column if not exists phone_verified_by uuid references auth.users (id) on delete set null,
  add column if not exists replacement_owner_role text;

alter table public.refund_machine_qr_codes
  drop constraint if exists refund_machine_qr_codes_replacement_owner_role_check;

alter table public.refund_machine_qr_codes
  add constraint refund_machine_qr_codes_replacement_owner_role_check
  check (
    replacement_owner_role is null
    or replacement_owner_role in ('operations', 'machine_manager', 'site_partner')
  );

create or replace function public.disable_refund_qr_when_intake_disabled()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  disabled_qr record;
begin
  if coalesce(old.refund_intake_enabled, false)
    and not coalesce(new.refund_intake_enabled, false)
  then
    for disabled_qr in
      update public.refund_machine_qr_codes
      set
        status = 'disabled',
        deactivated_at = statement_timestamp(),
        deactivated_by = auth.uid(),
        deactivation_reason = 'Refund intake disabled'
      where reporting_machine_id = new.id
        and status = 'active'
      returning version
    loop
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
        auth.uid(),
        'refund_machine.qr.disabled_with_intake',
        'reporting_machine',
        new.id::text,
        jsonb_build_object(
          'qr_status', 'active',
          'qr_version', disabled_qr.version
        ),
        jsonb_build_object(
          'qr_status', 'disabled',
          'qr_version', disabled_qr.version
        ),
        jsonb_build_object(
          'reason_code', 'refund_intake_disabled',
          'public_code_redacted', true
        )
      );
    end loop;
  end if;

  return new;
end;
$$;

drop trigger if exists reporting_machines_disable_refund_qr_with_intake
  on public.reporting_machines;

create trigger reporting_machines_disable_refund_qr_with_intake
after update of refund_intake_enabled
on public.reporting_machines
for each row execute function public.disable_refund_qr_when_intake_disabled();

revoke execute on function public.disable_refund_qr_when_intake_disabled()
  from public, anon, authenticated, service_role;

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

  if not coalesce(public.is_super_admin(actor_user_id), false)
    and not coalesce(public.is_scoped_admin(actor_user_id), false)
  then
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
          ), '[]'::jsonb),
          'qrAsset', (
            select jsonb_build_object(
              'status', qr.status,
              'version', qr.version,
              'publicPath', case
                when qr.status = 'active'
                  then '/refunds/request?qr=' || qr.public_code
                else null
              end,
              'createdAt', qr.created_at,
              'deactivatedAt', qr.deactivated_at,
              'printedAt', qr.printed_at,
              'installedAt', qr.installed_at,
              'labelVerifiedAt', qr.label_verified_at,
              'phoneVerifiedAt', qr.phone_verified_at,
              'replacementOwnerRole', qr.replacement_owner_role,
              'rolloutReady',
                qr.status = 'active'
                and qr.printed_at is not null
                and qr.installed_at is not null
                and qr.label_verified_at is not null
                and qr.phone_verified_at is not null
                and qr.replacement_owner_role is not null
            )
            from public.refund_machine_qr_codes qr
            where qr.reporting_machine_id = machine.id
            order by
              case when qr.status = 'active' then 0 else 1 end,
              qr.version desc
            limit 1
          )
        )
        order by location.name, machine.machine_label
      )
      from public.reporting_machines machine
      join public.reporting_locations location on location.id = machine.location_id
      where machine.status = 'active'
        and machine.machine_type in ('commercial', 'mini')
        and coalesce(public.can_access_machine(actor_user_id, machine.id), false)
    ), '[]'::jsonb)
  )
  into result;

  return result;
end;
$$;

comment on function public.admin_get_refund_manager_setup() is
  'Commercial/Mini manager, refund readiness, and sanitized QR rollout data for in-scope admins. No customer payloads, provider IDs, internal QR row IDs, or retired public codes are exposed.';

revoke execute on function public.admin_get_refund_manager_setup()
  from public, anon;
grant execute on function public.admin_get_refund_manager_setup()
  to authenticated;

create or replace function public.admin_manage_refund_machine_qr(
  p_machine_id uuid,
  p_action text,
  p_reason text
)
returns jsonb
language plpgsql
security definer
set search_path = public, auth
as $$
declare
  actor_user_id uuid := auth.uid();
  actor_authority text;
  normalized_action text := lower(trim(coalesce(p_action, '')));
  normalized_reason text := nullif(trim(coalesce(p_reason, '')), '');
  machine_row public.reporting_machines;
  active_qr public.refund_machine_qr_codes;
  result_qr public.refund_machine_qr_codes;
  next_version integer;
  next_public_code text;
begin
  if actor_user_id is null then
    raise exception 'Authentication required';
  end if;

  actor_authority := case
    when public.is_super_admin(actor_user_id) then 'super_admin'
    when public.is_scoped_admin(actor_user_id) then 'scoped_admin'
    else null
  end;

  if actor_authority is null then
    raise exception 'Scoped Admin or Super Admin access required';
  end if;

  if p_machine_id is null
    or not coalesce(public.can_access_machine(actor_user_id, p_machine_id), false)
  then
    raise exception 'Machine access required';
  end if;

  if normalized_action not in ('create', 'rotate', 'disable') then
    raise exception 'QR action must be create, rotate, or disable';
  end if;

  if normalized_reason is null or length(normalized_reason) < 8 then
    raise exception 'QR changes require a reason with at least 8 characters';
  end if;

  if length(normalized_reason) > 240 then
    raise exception 'QR change reason must be 240 characters or fewer';
  end if;

  select *
  into machine_row
  from public.reporting_machines machine
  where machine.id = p_machine_id
  for update;

  if machine_row.id is null then
    raise exception 'Reporting machine not found';
  end if;

  select *
  into active_qr
  from public.refund_machine_qr_codes qr
  where qr.reporting_machine_id = machine_row.id
    and qr.status = 'active'
  for update;

  if normalized_action in ('create', 'rotate') then
    if machine_row.status <> 'active'
      or machine_row.machine_type not in ('commercial', 'mini')
      or not coalesce(machine_row.refund_intake_enabled, false)
      or not exists (
        select 1
        from public.public_refund_machine_options() option
        where option.machine_id = machine_row.id
      )
    then
      raise exception 'Only active, refund-intake-enabled Commercial or Mini machines can have an active QR code';
    end if;
  end if;

  if normalized_action = 'create' and active_qr.id is not null then
    raise exception 'This machine already has an active refund QR code';
  end if;

  if normalized_action in ('rotate', 'disable') and active_qr.id is null then
    raise exception 'This machine does not have an active refund QR code';
  end if;

  if normalized_action = 'disable' then
    update public.refund_machine_qr_codes
    set
      status = 'disabled',
      deactivated_at = statement_timestamp(),
      deactivated_by = actor_user_id,
      deactivation_reason = normalized_reason
    where id = active_qr.id
    returning * into result_qr;
  else
    if normalized_action = 'rotate' then
      update public.refund_machine_qr_codes
      set
        status = 'retired',
        deactivated_at = statement_timestamp(),
        deactivated_by = actor_user_id,
        deactivation_reason = normalized_reason
      where id = active_qr.id;
    end if;

    select coalesce(max(qr.version), 0) + 1
    into next_version
    from public.refund_machine_qr_codes qr
    where qr.reporting_machine_id = machine_row.id;

    next_public_code :=
      replace(gen_random_uuid()::text, '-', '')
      || replace(gen_random_uuid()::text, '-', '');

    insert into public.refund_machine_qr_codes (
      reporting_machine_id,
      public_code,
      version,
      status,
      created_by
    )
    values (
      machine_row.id,
      next_public_code,
      next_version,
      'active',
      actor_user_id
    )
    returning * into result_qr;
  end if;

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
    'refund_machine.qr.' || normalized_action,
    'reporting_machine',
    machine_row.id::text,
    jsonb_build_object(
      'qr_status', case when active_qr.id is null then 'missing' else active_qr.status end,
      'qr_version', active_qr.version
    ),
    jsonb_build_object(
      'qr_status', result_qr.status,
      'qr_version', result_qr.version
    ),
    jsonb_build_object(
      'reason', normalized_reason,
      'actor_authority', actor_authority,
      'public_code_redacted', true
    )
  );

  return jsonb_build_object(
    'qrAsset', jsonb_build_object(
      'status', result_qr.status,
      'version', result_qr.version,
      'publicPath', case
        when result_qr.status = 'active'
          then '/refunds/request?qr=' || result_qr.public_code
        else null
      end,
      'createdAt', result_qr.created_at,
      'deactivatedAt', result_qr.deactivated_at,
      'printedAt', result_qr.printed_at,
      'installedAt', result_qr.installed_at,
      'labelVerifiedAt', result_qr.label_verified_at,
      'phoneVerifiedAt', result_qr.phone_verified_at,
      'replacementOwnerRole', result_qr.replacement_owner_role,
      'rolloutReady', false
    )
  );
end;
$$;

comment on function public.admin_manage_refund_machine_qr(uuid, text, text) is
  'Creates, rotates, or disables an opaque machine refund QR code with machine-scope checks and redacted audit evidence.';

revoke execute on function public.admin_manage_refund_machine_qr(uuid, text, text)
  from public, anon;
grant execute on function public.admin_manage_refund_machine_qr(uuid, text, text)
  to authenticated;

create or replace function public.admin_update_refund_qr_rollout(
  p_machine_id uuid,
  p_action text,
  p_replacement_owner_role text default null,
  p_reason text default 'Refund QR rollout checklist updated'
)
returns jsonb
language plpgsql
security definer
set search_path = public, auth
as $$
declare
  actor_user_id uuid := auth.uid();
  actor_authority text;
  normalized_action text := lower(trim(coalesce(p_action, '')));
  normalized_owner_role text := nullif(lower(trim(coalesce(p_replacement_owner_role, ''))), '');
  normalized_reason text := nullif(trim(coalesce(p_reason, '')), '');
  active_qr public.refund_machine_qr_codes;
  updated_qr public.refund_machine_qr_codes;
begin
  if actor_user_id is null then
    raise exception 'Authentication required';
  end if;

  actor_authority := case
    when public.is_super_admin(actor_user_id) then 'super_admin'
    when public.is_scoped_admin(actor_user_id) then 'scoped_admin'
    else null
  end;

  if actor_authority is null then
    raise exception 'Scoped Admin or Super Admin access required';
  end if;

  if p_machine_id is null
    or not coalesce(public.can_access_machine(actor_user_id, p_machine_id), false)
  then
    raise exception 'Machine access required';
  end if;

  if normalized_action not in (
    'mark_printed',
    'mark_installed',
    'verify_label',
    'verify_phone',
    'set_owner'
  ) then
    raise exception 'Unsupported QR rollout action';
  end if;

  if normalized_reason is null or length(normalized_reason) < 8 then
    raise exception 'QR rollout changes require a reason with at least 8 characters';
  end if;

  if length(normalized_reason) > 240 then
    raise exception 'QR rollout reason must be 240 characters or fewer';
  end if;

  if normalized_action = 'set_owner'
    and normalized_owner_role not in ('operations', 'machine_manager', 'site_partner')
  then
    raise exception 'Choose Operations, Machine Manager, or Site Partner as replacement owner';
  end if;

  select qr.*
  into active_qr
  from public.refund_machine_qr_codes qr
  join public.reporting_machines machine
    on machine.id = qr.reporting_machine_id
  where qr.reporting_machine_id = p_machine_id
    and qr.status = 'active'
    and machine.status = 'active'
    and machine.machine_type in ('commercial', 'mini')
    and machine.refund_intake_enabled = true
  for update of qr;

  if active_qr.id is null then
    raise exception 'An active refund QR code is required before updating rollout checks';
  end if;

  if normalized_action = 'mark_installed' and active_qr.printed_at is null then
    raise exception 'Record the printed asset before marking it installed';
  end if;

  if normalized_action in ('verify_label', 'verify_phone') and active_qr.installed_at is null then
    raise exception 'Record the physical installation before verifying it';
  end if;

  if normalized_action = 'verify_phone' and active_qr.label_verified_at is null then
    raise exception 'Verify the printed machine label before recording the phone scan';
  end if;

  update public.refund_machine_qr_codes
  set
    printed_at = case
      when normalized_action = 'mark_printed' then statement_timestamp()
      else printed_at
    end,
    printed_by = case
      when normalized_action = 'mark_printed' then actor_user_id
      else printed_by
    end,
    installed_at = case
      when normalized_action = 'mark_installed' then statement_timestamp()
      else installed_at
    end,
    installed_by = case
      when normalized_action = 'mark_installed' then actor_user_id
      else installed_by
    end,
    label_verified_at = case
      when normalized_action = 'verify_label' then statement_timestamp()
      else label_verified_at
    end,
    label_verified_by = case
      when normalized_action = 'verify_label' then actor_user_id
      else label_verified_by
    end,
    phone_verified_at = case
      when normalized_action = 'verify_phone' then statement_timestamp()
      else phone_verified_at
    end,
    phone_verified_by = case
      when normalized_action = 'verify_phone' then actor_user_id
      else phone_verified_by
    end,
    replacement_owner_role = case
      when normalized_action = 'set_owner' then normalized_owner_role
      else replacement_owner_role
    end
  where id = active_qr.id
  returning * into updated_qr;

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
    'refund_machine.qr_rollout.' || normalized_action,
    'reporting_machine',
    p_machine_id::text,
    jsonb_build_object(
      'qr_version', active_qr.version,
      'printed', active_qr.printed_at is not null,
      'installed', active_qr.installed_at is not null,
      'label_verified', active_qr.label_verified_at is not null,
      'phone_verified', active_qr.phone_verified_at is not null,
      'replacement_owner_role', active_qr.replacement_owner_role
    ),
    jsonb_build_object(
      'qr_version', updated_qr.version,
      'printed', updated_qr.printed_at is not null,
      'installed', updated_qr.installed_at is not null,
      'label_verified', updated_qr.label_verified_at is not null,
      'phone_verified', updated_qr.phone_verified_at is not null,
      'replacement_owner_role', updated_qr.replacement_owner_role
    ),
    jsonb_build_object(
      'reason', normalized_reason,
      'actor_authority', actor_authority,
      'public_code_redacted', true
    )
  );

  return jsonb_build_object(
    'qrAsset', jsonb_build_object(
      'status', updated_qr.status,
      'version', updated_qr.version,
      'publicPath', '/refunds/request?qr=' || updated_qr.public_code,
      'createdAt', updated_qr.created_at,
      'deactivatedAt', updated_qr.deactivated_at,
      'printedAt', updated_qr.printed_at,
      'installedAt', updated_qr.installed_at,
      'labelVerifiedAt', updated_qr.label_verified_at,
      'phoneVerifiedAt', updated_qr.phone_verified_at,
      'replacementOwnerRole', updated_qr.replacement_owner_role,
      'rolloutReady',
        updated_qr.printed_at is not null
        and updated_qr.installed_at is not null
        and updated_qr.label_verified_at is not null
        and updated_qr.phone_verified_at is not null
        and updated_qr.replacement_owner_role is not null
    )
  );
end;
$$;

comment on function public.admin_update_refund_qr_rollout(uuid, text, text, text) is
  'Records the non-customer, per-version physical QR rollout checklist for an in-scope Commercial/Mini machine.';

revoke execute on function public.admin_update_refund_qr_rollout(uuid, text, text, text)
  from public, anon;
grant execute on function public.admin_update_refund_qr_rollout(uuid, text, text, text)
  to authenticated;

comment on column public.refund_machine_qr_codes.printed_at is
  'When Operations confirmed that this exact QR version was downloaded and printed.';
comment on column public.refund_machine_qr_codes.installed_at is
  'When Operations confirmed that this exact QR version was physically installed on its mapped machine.';
comment on column public.refund_machine_qr_codes.label_verified_at is
  'When the human-readable location and machine label on the installed asset was checked against the physical machine.';
comment on column public.refund_machine_qr_codes.phone_verified_at is
  'When the installed code was opened on a real phone and confirmed to resolve to the expected safe customer route.';
comment on column public.refund_machine_qr_codes.replacement_owner_role is
  'Role responsible for replacing a retired or damaged asset; no person, customer, or payment data is stored.';

select pg_notify('pgrst', 'reload schema');
