-- Support pre-launch Timekeeping assignments without inventing provider IDs,
-- and keep the technician directory in a pay-authorized contact record instead
-- of a payroll spreadsheet. Sensitive taxpayer identifiers are intentionally
-- out of scope.

create table if not exists public.operator_contact_details (
  user_id uuid primary key references auth.users (id) on delete cascade,
  contact_email text,
  contact_phone text,
  mailing_address text,
  created_by uuid references auth.users (id) on delete set null,
  updated_by uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint operator_contact_details_email_length_check
    check (contact_email is null or length(contact_email) <= 320),
  constraint operator_contact_details_phone_length_check
    check (contact_phone is null or length(contact_phone) <= 64),
  constraint operator_contact_details_address_length_check
    check (mailing_address is null or length(mailing_address) <= 500)
);

drop trigger if exists operator_contact_details_set_updated_at
  on public.operator_contact_details;
create trigger operator_contact_details_set_updated_at
before update on public.operator_contact_details
for each row execute function public.set_updated_at();

alter table public.operator_contact_details enable row level security;

drop policy if exists "operator_contact_details_select_self_or_pay_manager"
  on public.operator_contact_details;
create policy "operator_contact_details_select_self_or_pay_manager"
on public.operator_contact_details
for select
using (
  user_id = (select auth.uid())
  or exists (
    select 1
    from public.operator_payout_profiles profile
    where profile.user_id = operator_contact_details.user_id
      and public.can_manage_operator_payout_account_current_user(profile.account_id)
  )
);

revoke all on public.operator_contact_details from anon;
revoke insert, update, delete on public.operator_contact_details from authenticated;
grant select on public.operator_contact_details to authenticated;

comment on table public.operator_contact_details is
  'Operational technician contact directory. Values are separate from payout profiles so machine-only managers cannot read them and profile audit serialization cannot retain them.';

alter table public.reporting_machines
  add column if not exists operational_phase text not null default 'live';

alter table public.reporting_machines
  drop constraint if exists reporting_machines_operational_phase_check;

alter table public.reporting_machines
  add constraint reporting_machines_operational_phase_check
    check (operational_phase in ('setup', 'live'));

create index if not exists reporting_machines_operational_phase_idx
  on public.reporting_machines (operational_phase, status);

comment on column public.reporting_machines.operational_phase is
  'Operational lifecycle independent of portal availability. Setup machines remain active for assignments and Timekeeping while external vending setup is incomplete.';

create or replace function public.get_operator_contact_directory(
  p_operator_profile_ids uuid[]
)
returns table (
  operator_profile_id uuid,
  contact_email text,
  contact_phone text,
  mailing_address text
)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  actor_user_id uuid := auth.uid();
begin
  if actor_user_id is null then raise exception 'Authentication required'; end if;

  return query
  select
    profile.id,
    contact.contact_email,
    contact.contact_phone,
    contact.mailing_address
  from public.operator_payout_profiles profile
  left join public.operator_contact_details contact on contact.user_id = profile.user_id
  where profile.id = any(coalesce(p_operator_profile_ids, '{}'::uuid[]))
    and coalesce(public.can_manage_operator_payout_account(actor_user_id, profile.account_id), false);
end;
$$;

comment on function public.get_operator_contact_directory(uuid[]) is
  'Returns contact details only for requested Technician profiles whose account is within the caller''s pay-management authority.';

revoke execute on function public.get_operator_contact_directory(uuid[])
  from public, anon;
grant execute on function public.get_operator_contact_directory(uuid[])
  to authenticated;

create or replace function public.admin_update_operator_contact(
  p_operator_profile_id uuid,
  p_contact_email text,
  p_contact_phone text,
  p_mailing_address text,
  p_reason text
)
returns public.operator_contact_details
language plpgsql
security definer
set search_path = ''
as $$
declare
  actor_user_id uuid := auth.uid();
  normalized_contact_email text := nullif(lower(trim(coalesce(p_contact_email, ''))), '');
  normalized_contact_phone text := nullif(trim(coalesce(p_contact_phone, '')), '');
  normalized_mailing_address text := nullif(trim(coalesce(p_mailing_address, '')), '');
  normalized_reason text := trim(coalesce(p_reason, ''));
  profile_row public.operator_payout_profiles;
  before_row public.operator_contact_details;
  after_row public.operator_contact_details;
begin
  if actor_user_id is null then raise exception 'Authentication required'; end if;

  select * into profile_row
  from public.operator_payout_profiles profile
  where profile.id = p_operator_profile_id
  limit 1;

  if profile_row.id is null then raise exception 'Technician profile not found'; end if;
  if not coalesce(public.can_manage_operator_payout_account(actor_user_id, profile_row.account_id), false) then
    raise exception 'Account pay authority required';
  end if;
  if normalized_reason not in (
    'Technician contact details updated from Admin Payouts',
    'Initial Timekeeping technician setup'
  ) then
    raise exception 'Unsupported contact update reason';
  end if;
  if normalized_contact_email is not null and normalized_contact_email !~ '^[^[:space:]@]+@[^[:space:]@]+[.][^[:space:]@]+$' then
    raise exception 'Enter a valid contact email';
  end if;
  if length(coalesce(normalized_contact_email, '')) > 320 then raise exception 'Contact email is too long'; end if;
  if length(coalesce(normalized_contact_phone, '')) > 64 then raise exception 'Contact phone is too long'; end if;
  if length(coalesce(normalized_mailing_address, '')) > 500 then raise exception 'Mailing address is too long'; end if;

  select * into before_row
  from public.operator_contact_details contact
  where contact.user_id = profile_row.user_id
  for update;

  insert into public.operator_contact_details (
    user_id, contact_email, contact_phone, mailing_address, created_by, updated_by
  ) values (
    profile_row.user_id, normalized_contact_email, normalized_contact_phone,
    normalized_mailing_address, actor_user_id, actor_user_id
  )
  on conflict (user_id) do update set
    contact_email = excluded.contact_email,
    contact_phone = excluded.contact_phone,
    mailing_address = excluded.mailing_address,
    updated_by = excluded.updated_by
  returning * into after_row;

  insert into public.admin_audit_log (
    actor_user_id, action, entity_type, entity_id, target_user_id, before, after, meta
  ) values (
    actor_user_id,
    'operator_contact_details.updated',
    'operator_contact_details',
    after_row.user_id::text,
    after_row.user_id,
    jsonb_build_object(
      'contactEmailSet', before_row.contact_email is not null,
      'contactPhoneSet', before_row.contact_phone is not null,
      'mailingAddressSet', before_row.mailing_address is not null
    ),
    jsonb_build_object(
      'contactEmailSet', after_row.contact_email is not null,
      'contactPhoneSet', after_row.contact_phone is not null,
      'mailingAddressSet', after_row.mailing_address is not null
    ),
    jsonb_build_object(
      'reason', normalized_reason,
      'contactValuesRedacted', true
    )
  );

  return after_row;
end;
$$;

comment on function public.admin_update_operator_contact(uuid, text, text, text, text) is
  'Updates the pay-authorized technician contact directory while redacting values from the admin audit log.';

revoke execute on function public.admin_update_operator_contact(uuid, text, text, text, text)
  from public, anon;
grant execute on function public.admin_update_operator_contact(uuid, text, text, text, text)
  to authenticated;

-- Keep the per-machine compensation setup repeatable inside one transaction.
-- The original routine creates one started-hour rate and one commission
-- arrangement for every selected machine.
create or replace function public.admin_setup_timekeeping_technician_arrangements(
  p_user_email text,
  p_display_name text,
  p_worker_type text,
  p_worker_identifier text,
  p_effective_start_date date,
  p_machine_compensation jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  actor_user_id uuid := auth.uid();
  normalized_email text := lower(trim(coalesce(p_user_email, '')));
  normalized_display_name text := trim(coalesce(p_display_name, ''));
  normalized_worker_identifier text := nullif(trim(coalesce(p_worker_identifier, '')), '');
  target_user_id uuid;
  profile_row public.operator_payout_profiles;
  account_row record;
  arrangement record;
  profile_results jsonb := '[]'::jsonb;
  machine_count integer;
  account_count integer;
begin
  if actor_user_id is null then raise exception 'Authentication required'; end if;
  if normalized_email = '' or normalized_display_name = '' then raise exception 'Technician email and name are required'; end if;
  if p_effective_start_date is null then raise exception 'Timekeeping start date is required'; end if;
  if jsonb_typeof(p_machine_compensation) <> 'array' or jsonb_array_length(p_machine_compensation) = 0 then
    raise exception 'Choose at least one machine';
  end if;

  drop table if exists pg_temp.selected_arrangements;
  create temporary table selected_arrangements on commit drop as
  select
    value ->> 'machineId' as machine_id_text,
    nullif(value ->> 'shiftRateCents', '')::integer as shift_rate_cents,
    nullif(value ->> 'commissionBasisPoints', '')::integer as commission_basis_points,
    nullif(value ->> 'commissionEffectiveStartDate', '')::date as commission_start_date
  from jsonb_array_elements(p_machine_compensation) selected(value);

  if exists (select 1 from selected_arrangements where machine_id_text is null or machine_id_text !~* '^[0-9a-f-]{36}$') then
    raise exception 'Every pay arrangement must identify a machine';
  end if;
  if exists (select 1 from selected_arrangements group by machine_id_text having count(*) > 1) then
    raise exception 'Each machine can have only one starting pay arrangement';
  end if;
  if exists (select 1 from selected_arrangements where shift_rate_cents is null or shift_rate_cents <= 0) then
    raise exception 'Pay per started hour must be greater than zero';
  end if;
  if exists (select 1 from selected_arrangements where commission_basis_points is null or commission_basis_points < 0 or commission_basis_points > 10000) then
    raise exception 'Commission percent must be between zero and 100';
  end if;
  if exists (select 1 from selected_arrangements where commission_start_date is null or commission_start_date < p_effective_start_date) then
    raise exception 'Commission start cannot be before Timekeeping starts';
  end if;

  select users.id into target_user_id from auth.users users
  where lower(users.email) = normalized_email limit 1;
  if target_user_id is null then
    raise exception 'Technician must accept the invitation and sign in once before Timekeeping setup';
  end if;

  perform pg_advisory_xact_lock(hashtextextended(concat_ws(':', target_user_id::text, 'timekeeping-arrangements'), 0));

  if exists (
    select 1
    from selected_arrangements selected
    left join public.reporting_machines machine on machine.id = selected.machine_id_text::uuid
    where machine.id is null or machine.status <> 'active'
      or not coalesce(public.can_manage_operator_payout_account(actor_user_id, machine.account_id), false)
      or not coalesce(public.can_manage_operator_payout_machine(actor_user_id, machine.id), false)
  ) then
    raise exception 'Every machine must be active and within your pay access';
  end if;

  select count(*)::integer, count(distinct machine.account_id)::integer
  into machine_count, account_count
  from selected_arrangements selected
  join public.reporting_machines machine on machine.id = selected.machine_id_text::uuid;

  for account_row in
    select distinct machine.account_id
    from selected_arrangements selected
    join public.reporting_machines machine on machine.id = selected.machine_id_text::uuid
  loop
    if exists (
      select 1 from public.operator_payout_profiles profile
      where profile.account_id = account_row.account_id and profile.user_id = target_user_id
    ) then
      raise exception 'Technician already has Timekeeping setup for one of these accounts';
    end if;

    select * into profile_row from public.admin_upsert_operator_payout_profile(
      normalized_email, account_row.account_id, normalized_display_name, p_worker_type,
      null, 'Initial Timekeeping pay arrangements'
    );

    update public.operator_payout_profiles set
      worker_identifier = normalized_worker_identifier,
      position_title = 'Technician',
      updated_by = actor_user_id
    where id = profile_row.id returning * into profile_row;

    for arrangement in
      select selected.*, machine.id as machine_id
      from selected_arrangements selected
      join public.reporting_machines machine on machine.id = selected.machine_id_text::uuid
      where machine.account_id = account_row.account_id
    loop
      perform public.admin_upsert_operator_machine_assignment(
        null, profile_row.id, arrangement.machine_id, p_effective_start_date, null
      );

      perform public.admin_upsert_operator_compensation_rate(
        null, account_row.account_id, profile_row.id, arrangement.machine_id,
        'shift', arrangement.shift_rate_cents, p_effective_start_date, null,
        'active', 'Initial Timekeeping pay arrangement'
      );

      if arrangement.commission_start_date > p_effective_start_date then
        perform public.admin_upsert_operator_compensation_rate(
          null, account_row.account_id, profile_row.id, arrangement.machine_id,
          'commission', 0, p_effective_start_date, arrangement.commission_start_date - 1,
          'active', 'Commission waiting period'
        );
      end if;
      perform public.admin_upsert_operator_compensation_rate(
        null, account_row.account_id, profile_row.id, arrangement.machine_id,
        'commission', arrangement.commission_basis_points, arrangement.commission_start_date,
        null, 'active', 'Initial Timekeeping pay arrangement'
      );
    end loop;

    profile_results := profile_results || jsonb_build_array(jsonb_build_object(
      'operatorProfileId', profile_row.id, 'accountId', profile_row.account_id
    ));
  end loop;

  insert into public.admin_audit_log (
    actor_user_id, action, entity_type, entity_id, target_user_id, before, after, meta
  ) values (
    actor_user_id, 'timekeeping_technician.arrangements_setup_completed', 'auth_user',
    target_user_id::text, target_user_id, '{}'::jsonb,
    jsonb_build_object('displayName', normalized_display_name, 'profiles', profile_results),
    jsonb_build_object('machineCount', machine_count, 'payerCount', account_count,
      'effectiveStartDate', p_effective_start_date, 'approvalRequired', false, 'paymentExecution', false)
  );

  return jsonb_build_object(
    'displayName', normalized_display_name, 'profiles', profile_results,
    'machineCount', machine_count, 'payerCount', account_count,
    'effectiveStartDate', p_effective_start_date
  );
end;
$$;

comment on function public.admin_setup_timekeeping_technician_arrangements(text, text, text, text, date, jsonb) is
  'Atomically creates payer-scoped Technician profiles, machine assignments, and effective-dated per-machine pay arrangements.';

create or replace function public.admin_setup_timekeeping_technician_arrangements_with_contact(
  p_user_email text,
  p_display_name text,
  p_worker_type text,
  p_worker_identifier text,
  p_contact_email text,
  p_contact_phone text,
  p_mailing_address text,
  p_effective_start_date date,
  p_machine_compensation jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  actor_user_id uuid := auth.uid();
  setup_result jsonb;
  normalized_contact_email text := nullif(lower(trim(coalesce(p_contact_email, ''))), '');
  normalized_contact_phone text := nullif(trim(coalesce(p_contact_phone, '')), '');
  normalized_mailing_address text := nullif(trim(coalesce(p_mailing_address, '')), '');
  target_profile_id uuid;
  target_user_id uuid;
  existing_contact public.operator_contact_details;
begin
  if actor_user_id is null then raise exception 'Authentication required'; end if;
  if normalized_contact_email is not null and normalized_contact_email !~ '^[^[:space:]@]+@[^[:space:]@]+[.][^[:space:]@]+$' then
    raise exception 'Enter a valid contact email';
  end if;
  if length(coalesce(normalized_contact_email, '')) > 320 then raise exception 'Contact email is too long'; end if;
  if length(coalesce(normalized_contact_phone, '')) > 64 then raise exception 'Contact phone is too long'; end if;
  if length(coalesce(normalized_mailing_address, '')) > 500 then raise exception 'Mailing address is too long'; end if;

  drop table if exists pg_temp.selected_arrangements;

  select public.admin_setup_timekeeping_technician_arrangements(
    p_user_email,
    p_display_name,
    p_worker_type,
    p_worker_identifier,
    p_effective_start_date,
    p_machine_compensation
  ) into setup_result;

  select nullif(setup_result -> 'profiles' -> 0 ->> 'operatorProfileId', '')::uuid
  into target_profile_id;

  if target_profile_id is null then
    raise exception 'Technician profile not found after setup';
  end if;

  select profile.user_id into target_user_id
  from public.operator_payout_profiles profile
  where profile.id = target_profile_id;

  select * into existing_contact
  from public.operator_contact_details contact
  where contact.user_id = target_user_id;

  perform public.admin_update_operator_contact(
    target_profile_id,
    coalesce(existing_contact.contact_email, normalized_contact_email),
    coalesce(existing_contact.contact_phone, normalized_contact_phone),
    coalesce(existing_contact.mailing_address, normalized_mailing_address),
    'Initial Timekeeping technician setup'
  );

  return setup_result;
end;
$$;

comment on function public.admin_setup_timekeeping_technician_arrangements_with_contact(text, text, text, text, text, text, text, date, jsonb) is
  'Atomically creates payer-scoped Timekeeping arrangements and protected technician contact details without writing contact values to audit payloads.';

revoke execute on function public.admin_setup_timekeeping_technician_arrangements_with_contact(text, text, text, text, text, text, text, date, jsonb)
  from public, anon;
grant execute on function public.admin_setup_timekeeping_technician_arrangements_with_contact(text, text, text, text, text, text, text, date, jsonb)
  to authenticated;

create or replace function public.admin_set_reporting_machine_operational_phase(
  p_machine_id uuid,
  p_operational_phase text,
  p_reason text
)
returns public.reporting_machines
language plpgsql
security definer
set search_path = ''
as $$
declare
  actor_user_id uuid := auth.uid();
  normalized_phase text := lower(trim(coalesce(p_operational_phase, '')));
  normalized_reason text := trim(coalesce(p_reason, ''));
  before_row public.reporting_machines;
  after_row public.reporting_machines;
begin
  if actor_user_id is null then raise exception 'Authentication required'; end if;
  if not coalesce(public.is_super_admin(actor_user_id), false) then raise exception 'Admin access required'; end if;
  if normalized_phase not in ('setup', 'live') then raise exception 'Invalid operational phase'; end if;
  if normalized_reason = '' then raise exception 'Update reason is required'; end if;

  select * into before_row
  from public.reporting_machines machine
  where machine.id = p_machine_id
  for update;
  if before_row.id is null then raise exception 'Machine not found'; end if;

  if before_row.operational_phase = normalized_phase then
    return before_row;
  end if;

  update public.reporting_machines
  set operational_phase = normalized_phase
  where id = before_row.id
  returning * into after_row;

  insert into public.admin_audit_log (
    actor_user_id, action, entity_type, entity_id, target_user_id, before, after, meta
  ) values (
    actor_user_id,
    'reporting_machine.operational_phase_updated',
    'reporting_machine',
    after_row.id::text,
    null,
    jsonb_build_object('operationalPhase', before_row.operational_phase),
    jsonb_build_object('operationalPhase', after_row.operational_phase),
    jsonb_build_object('reason', normalized_reason)
  );

  return after_row;
end;
$$;

comment on function public.admin_set_reporting_machine_operational_phase(uuid, text, text) is
  'Moves a machine between setup and live phases without changing whether it remains available for portal assignments.';

revoke execute on function public.admin_set_reporting_machine_operational_phase(uuid, text, text)
  from public, anon;
grant execute on function public.admin_set_reporting_machine_operational_phase(uuid, text, text)
  to authenticated;

create or replace function public.admin_upsert_reporting_machine_with_phase(
  p_machine_id uuid,
  p_account_name text,
  p_location_name text,
  p_machine_label text,
  p_machine_type text,
  p_sunze_machine_id text,
  p_operational_phase text,
  p_reason text,
  p_location_timezone text default null
)
returns public.reporting_machines
language plpgsql
security definer
set search_path = ''
as $$
declare
  actor_user_id uuid := auth.uid();
  machine_row public.reporting_machines;
  normalized_location_timezone text := coalesce(nullif(trim(p_location_timezone), ''), 'America/Los_Angeles');
  existing_location_id uuid;
  location_before_timezone text;
begin
  if actor_user_id is null then raise exception 'Authentication required'; end if;
  if not coalesce(public.is_super_admin(actor_user_id), false) then raise exception 'Admin access required'; end if;
  if not exists (
    select 1 from pg_catalog.pg_timezone_names zone
    where zone.name = normalized_location_timezone
  ) then
    raise exception 'Invalid location timezone';
  end if;

  if p_machine_id is null then
    select location.id, location.timezone
    into existing_location_id, location_before_timezone
    from public.reporting_locations location
    join public.customer_accounts account on account.id = location.account_id
    where lower(account.name) = lower(trim(coalesce(p_account_name, '')))
      and lower(location.name) = lower(trim(coalesce(p_location_name, '')))
    limit 1;
  end if;

  select * into machine_row
  from public.admin_upsert_reporting_machine(
    p_machine_id,
    p_account_name,
    p_location_name,
    p_machine_label,
    p_machine_type,
    p_sunze_machine_id,
    p_reason
  );

  if p_machine_id is null and existing_location_id is null then
    update public.reporting_locations
    set timezone = normalized_location_timezone
    where id = machine_row.location_id;

    insert into public.admin_audit_log (
      actor_user_id, action, entity_type, entity_id, target_user_id, before, after, meta
    ) values (
      actor_user_id,
      'reporting_location.timezone_set_for_machine_setup',
      'reporting_location',
      machine_row.location_id::text,
      null,
      jsonb_build_object('timezone', location_before_timezone),
      jsonb_build_object('timezone', normalized_location_timezone),
      jsonb_build_object('machineId', machine_row.id, 'reason', trim(coalesce(p_reason, '')))
    );
  end if;

  select * into machine_row
  from public.admin_set_reporting_machine_operational_phase(
    machine_row.id,
    p_operational_phase,
    p_reason
  );

  return machine_row;
end;
$$;

comment on function public.admin_upsert_reporting_machine_with_phase(uuid, text, text, text, text, text, text, text, text) is
  'Atomically creates or updates a reporting machine and its explicit operational lifecycle phase, recording a valid timezone for new locations.';

revoke execute on function public.admin_upsert_reporting_machine_with_phase(uuid, text, text, text, text, text, text, text, text)
  from public, anon;
grant execute on function public.admin_upsert_reporting_machine_with_phase(uuid, text, text, text, text, text, text, text, text)
  to authenticated;

create or replace function public.get_timekeeping_setup_context()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  actor_user_id uuid := auth.uid();
  result jsonb;
begin
  if actor_user_id is null then raise exception 'Authentication required'; end if;

  if not exists (
    select 1
    from public.customer_accounts account
    where account.status = 'active'
      and coalesce(public.can_manage_operator_payout_account(actor_user_id, account.id), false)
  ) then
    raise exception 'Account pay authority required';
  end if;

  select jsonb_build_object(
    'accounts', coalesce((
      select jsonb_agg(
        jsonb_build_object(
          'accountId', account.id,
          'accountName', account.name,
          'machines', coalesce((
            select jsonb_agg(
              jsonb_build_object(
                'machineId', machine.id,
                'machineLabel', machine.machine_label,
                'locationName', location.name,
                'operationalPhase', machine.operational_phase
              )
              order by location.name, machine.machine_label, machine.id
            )
            from public.reporting_machines machine
            left join public.reporting_locations location on location.id = machine.location_id
            where machine.account_id = account.id
              and machine.status = 'active'
              and machine.operational_phase in ('setup', 'live')
              and coalesce(public.can_manage_operator_payout_machine(actor_user_id, machine.id), false)
          ), '[]'::jsonb)
        )
        order by account.name, account.id
      )
      from public.customer_accounts account
      where account.status = 'active'
        and coalesce(public.can_manage_operator_payout_account(actor_user_id, account.id), false)
    ), '[]'::jsonb),
    'capabilities', jsonb_build_object(
      'accountPayAuthorityRequired', true,
      'approvalRequired', false,
      'paymentExecution', false
    )
  ) into result;

  return result;
end;
$$;

comment on function public.get_timekeeping_setup_context() is
  'Account-pay-authorized list of assignable machines, including explicit setup-phase provisional records, for Technician Timekeeping setup.';

revoke execute on function public.get_timekeeping_setup_context()
  from public, anon;
grant execute on function public.get_timekeeping_setup_context()
  to authenticated;

select pg_notify('pgrst', 'reload schema');
