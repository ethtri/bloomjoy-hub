-- Give pay managers one atomic setup action for a newly invited Technician.
-- Access invitations remain in Admin Access; this RPC creates only the
-- Timekeeping profile, machine assignments, and starting pay rules.

create or replace function public.get_timekeeping_setup_context()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  actor_user_id uuid;
  result jsonb;
begin
  actor_user_id := auth.uid();

  if actor_user_id is null then
    raise exception 'Authentication required';
  end if;

  if not exists (
    select 1
    from public.customer_accounts account
    where account.status = 'active'
      and coalesce(
        public.can_manage_operator_payout_account(actor_user_id, account.id),
        false
      )
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
                'locationName', location.name
              )
              order by location.name, machine.machine_label, machine.id
            )
            from public.reporting_machines machine
            left join public.reporting_locations location
              on location.id = machine.location_id
            where machine.account_id = account.id
              and machine.status = 'active'
              and coalesce(
                public.can_manage_operator_payout_machine(actor_user_id, machine.id),
                false
              )
          ), '[]'::jsonb)
        )
        order by account.name, account.id
      )
      from public.customer_accounts account
      where account.status = 'active'
        and coalesce(
          public.can_manage_operator_payout_account(actor_user_id, account.id),
          false
        )
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

create or replace function public.admin_setup_timekeeping_technician(
  p_user_email text,
  p_account_id uuid,
  p_display_name text,
  p_worker_type text,
  p_worker_identifier text,
  p_machine_ids uuid[],
  p_shift_rate_cents integer,
  p_commission_basis_points integer,
  p_effective_start_date date
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  actor_user_id uuid;
  normalized_email text;
  normalized_display_name text;
  normalized_machine_ids uuid[];
  normalized_worker_identifier text;
  target_user_id uuid;
  profile_row public.operator_payout_profiles;
  machine_id uuid;
  selected_machine_count integer;
  authorized_machine_count integer;
begin
  actor_user_id := auth.uid();
  normalized_email := lower(trim(coalesce(p_user_email, '')));
  normalized_display_name := trim(coalesce(p_display_name, ''));
  normalized_worker_identifier := nullif(trim(coalesce(p_worker_identifier, '')), '');

  if actor_user_id is null then
    raise exception 'Authentication required';
  end if;

  if not coalesce(
    public.can_manage_operator_payout_account(actor_user_id, p_account_id),
    false
  ) then
    raise exception 'Account pay authority required';
  end if;

  if normalized_email = '' or normalized_display_name = '' then
    raise exception 'Technician email and name are required';
  end if;

  if p_effective_start_date is null then
    raise exception 'Timekeeping start date is required';
  end if;

  if p_shift_rate_cents is null or p_shift_rate_cents <= 0 then
    raise exception 'Pay per shift must be greater than zero';
  end if;

  if p_commission_basis_points is null
    or p_commission_basis_points < 0
    or p_commission_basis_points > 10000 then
    raise exception 'Commission percent must be between zero and 100';
  end if;

  select coalesce(array_agg(distinct selected.machine_id), '{}'::uuid[])
  into normalized_machine_ids
  from unnest(coalesce(p_machine_ids, '{}'::uuid[])) selected(machine_id)
  where selected.machine_id is not null;

  selected_machine_count := cardinality(normalized_machine_ids);

  if selected_machine_count = 0 then
    raise exception 'Choose at least one machine';
  end if;

  select count(*)::integer
  into authorized_machine_count
  from public.reporting_machines machine
  where machine.id = any(normalized_machine_ids)
    and machine.account_id = p_account_id
    and machine.status = 'active'
    and coalesce(
      public.can_manage_operator_payout_machine(actor_user_id, machine.id),
      false
    );

  if authorized_machine_count <> selected_machine_count then
    raise exception 'Every machine must be active, in the selected account, and within your access';
  end if;

  select users.id
  into target_user_id
  from auth.users users
  where lower(users.email) = normalized_email
  limit 1;

  if target_user_id is null then
    raise exception 'Technician must accept the invitation and sign in once before Timekeeping setup';
  end if;

  perform pg_advisory_xact_lock(
    hashtextextended(concat_ws(':', p_account_id::text, normalized_email, 'timekeeping-setup'), 0)
  );

  if exists (
    select 1
    from public.operator_payout_profiles profile
    where profile.account_id = p_account_id
      and profile.user_id = target_user_id
  ) then
    raise exception 'Technician already has Timekeeping setup for this account';
  end if;

  select *
  into profile_row
  from public.admin_upsert_operator_payout_profile(
    normalized_email,
    p_account_id,
    normalized_display_name,
    p_worker_type,
    null,
    'Initial Timekeeping setup'
  );

  update public.operator_payout_profiles
  set
    worker_identifier = normalized_worker_identifier,
    position_title = 'Technician',
    updated_by = actor_user_id
  where id = profile_row.id
  returning * into profile_row;

  foreach machine_id in array normalized_machine_ids
  loop
    perform public.admin_upsert_operator_machine_assignment(
      null,
      profile_row.id,
      machine_id,
      p_effective_start_date,
      null
    );
  end loop;

  perform public.admin_upsert_operator_compensation_rate(
    null,
    p_account_id,
    profile_row.id,
    null,
    'shift',
    p_shift_rate_cents,
    p_effective_start_date,
    null,
    'active',
    'Initial Timekeeping setup'
  );

  perform public.admin_upsert_operator_compensation_rate(
    null,
    p_account_id,
    profile_row.id,
    null,
    'commission',
    p_commission_basis_points,
    p_effective_start_date,
    null,
    'active',
    'Initial Timekeeping setup'
  );

  insert into public.admin_audit_log (
    actor_user_id,
    action,
    entity_type,
    entity_id,
    target_user_id,
    before,
    after,
    meta
  ) values (
    actor_user_id,
    'timekeeping_technician.setup_completed',
    'operator_payout_profile',
    profile_row.id::text,
    profile_row.user_id,
    '{}'::jsonb,
    jsonb_build_object(
      'profileId', profile_row.id,
      'accountId', profile_row.account_id,
      'displayName', profile_row.display_name,
      'workerType', profile_row.worker_type,
      'workerIdentifier', profile_row.worker_identifier,
      'status', profile_row.status
    ),
    jsonb_build_object(
      'machineIds', normalized_machine_ids,
      'shiftRateCents', p_shift_rate_cents,
      'commissionBasisPoints', p_commission_basis_points,
      'effectiveStartDate', p_effective_start_date,
      'approvalRequired', false,
      'paymentExecution', false
    )
  );

  return jsonb_build_object(
    'operatorProfileId', profile_row.id,
    'accountId', profile_row.account_id,
    'displayName', profile_row.display_name,
    'machineCount', selected_machine_count,
    'effectiveStartDate', p_effective_start_date
  );
end;
$$;

comment on function public.get_timekeeping_setup_context() is
  'Account-pay-authorized list of active accounts and machines available for initial Technician Timekeeping setup.';

comment on function public.admin_setup_timekeeping_technician(text, uuid, text, text, text, uuid[], integer, integer, date) is
  'Atomically creates a newly invited Technician Timekeeping profile, effective machine assignments, and initial shift and commission rates.';

revoke execute on function public.get_timekeeping_setup_context()
  from public, anon;
revoke execute on function public.admin_setup_timekeeping_technician(text, uuid, text, text, text, uuid[], integer, integer, date)
  from public, anon;

grant execute on function public.get_timekeeping_setup_context()
  to authenticated;
grant execute on function public.admin_setup_timekeeping_technician(text, uuid, text, text, text, uuid[], integer, integer, date)
  to authenticated;
