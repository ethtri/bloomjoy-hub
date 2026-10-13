-- Add one machine to an existing payer profile. Existing writers retain their
-- authorization, overlap checks and audit history. No grants/scopes are created.
create function public.get_operator_machine_arrangement_result(p_request_id uuid)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare actor_id uuid := auth.uid(); receipt jsonb;
begin
  if actor_id is null then raise exception 'Authentication required'; end if;
  select audit.after into receipt from public.admin_audit_log audit
  where audit.actor_user_id = actor_id
    and audit.action = 'operator_machine_arrangement.added'
    and audit.entity_type = 'operator_machine_arrangement_request'
    and audit.entity_id = p_request_id::text;
  if receipt is not null and (
    not coalesce(public.can_manage_operator_payout_account(actor_id, (receipt->>'accountId')::uuid), false)
    or not coalesce(public.can_manage_operator_payout_machine(actor_id, (receipt->>'machineId')::uuid), false)
  ) then raise exception 'Technician compensation access required'; end if;
  return receipt;
end;
$$;

create function public.admin_add_operator_machine_arrangement(
  p_request_id uuid,
  p_operator_profile_id uuid,
  p_reporting_machine_id uuid,
  p_effective_start_date date,
  p_shift_rate_cents integer,
  p_commission_basis_points integer,
  p_commission_start_date date,
  p_effective_end_date date default null
)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  actor_id uuid := auth.uid();
  profile_row public.operator_payout_profiles;
  machine_row public.reporting_machines;
  request_input jsonb; previous_input jsonb; receipt jsonb;
  assignment jsonb; shift_rate jsonb; commission_rate jsonb; waiting_rate jsonb;
begin
  if actor_id is null then raise exception 'Authentication required'; end if;
  if p_request_id is null then raise exception 'Save request is required'; end if;
  request_input := jsonb_build_object(
    'operatorProfileId', p_operator_profile_id, 'machineId', p_reporting_machine_id,
    'effectiveStartDate', p_effective_start_date, 'effectiveEndDate', p_effective_end_date,
    'shiftRateCents', p_shift_rate_cents, 'commissionBasisPoints', p_commission_basis_points,
    'commissionStartDate', p_commission_start_date
  );
  -- One actor/request serializes uncertain-response retries. The receipt commits
  -- in the same transaction as all existing audited assignment/rate writes.
  perform pg_advisory_xact_lock(hashtextextended(
    'operator_machine_arrangement:' || actor_id::text || ':' || p_request_id::text, 0));
  receipt := public.get_operator_machine_arrangement_result(p_request_id);
  if receipt is not null then
    select audit.meta->'input' into previous_input from public.admin_audit_log audit
    where audit.actor_user_id = actor_id and audit.entity_id = p_request_id::text
      and audit.action = 'operator_machine_arrangement.added'
      and audit.entity_type = 'operator_machine_arrangement_request';
    if previous_input is distinct from request_input then
      raise exception 'This save request was already used with different details';
    end if;
    return receipt;
  end if;

  select * into profile_row from public.operator_payout_profiles where id = p_operator_profile_id for share;
  if profile_row.id is null or not coalesce(
    public.can_manage_operator_payout_account(actor_id, profile_row.account_id), false
  ) then raise exception 'Technician compensation access required'; end if;
  select * into machine_row from public.reporting_machines where id = p_reporting_machine_id for share;
  -- This small add-machine flow uses the existing payer's setup catalogue.
  -- It never provisions a different company's payroll compatibility or access.
  if machine_row.id is null or machine_row.account_id <> profile_row.account_id
    or machine_row.status <> 'active' or machine_row.operational_phase not in ('setup', 'live')
    or not coalesce(public.can_manage_operator_payout_machine(actor_id, machine_row.id), false)
  then raise exception 'Choose an available machine in this payroll account'; end if;
  perform private.assert_machine_management_active(machine_row.id);
  if p_effective_start_date is null or
    (p_effective_end_date is not null and p_effective_end_date < p_effective_start_date)
  then raise exception 'Machine assignment effective window is invalid'; end if;
  if p_shift_rate_cents is null or p_shift_rate_cents <= 0 then
    raise exception 'Pay per started hour must be greater than zero'; end if;
  if p_commission_basis_points is null or p_commission_basis_points < 0 or p_commission_basis_points > 10000 then
    raise exception 'Commission percent must be between zero and 100'; end if;
  if p_commission_start_date is null or p_commission_start_date < p_effective_start_date
    or (p_effective_end_date is not null and p_commission_start_date > p_effective_end_date)
  then raise exception 'Commission start must be within the assignment dates'; end if;

  assignment := public.admin_upsert_operator_machine_assignment(
    null, profile_row.id, machine_row.id, p_effective_start_date, p_effective_end_date);
  shift_rate := public.admin_upsert_operator_compensation_rate(
    null, profile_row.account_id, profile_row.id, machine_row.id, 'shift', p_shift_rate_cents,
    p_effective_start_date, p_effective_end_date, 'active', 'Added machine pay arrangement');
  if p_commission_start_date > p_effective_start_date then
    waiting_rate := public.admin_upsert_operator_compensation_rate(
      null, profile_row.account_id, profile_row.id, machine_row.id, 'commission', 0,
      p_effective_start_date, p_commission_start_date - 1, 'active', 'Commission waiting period');
  end if;
  commission_rate := public.admin_upsert_operator_compensation_rate(
    null, profile_row.account_id, profile_row.id, machine_row.id, 'commission', p_commission_basis_points,
    p_commission_start_date, p_effective_end_date, 'active', 'Added machine pay arrangement');
  receipt := jsonb_build_object(
    'requestId', p_request_id, 'operatorProfileId', profile_row.id,
    'accountId', profile_row.account_id, 'machineId', machine_row.id,
    'assignment', assignment, 'shiftRate', shift_rate, 'commissionRate', commission_rate,
    'waitingRate', waiting_rate
  );
  insert into public.admin_audit_log(
    actor_user_id, action, entity_type, entity_id, target_user_id, before, after, meta
  ) values (
    actor_id, 'operator_machine_arrangement.added', 'operator_machine_arrangement_request',
    p_request_id::text, profile_row.user_id, '{}'::jsonb, receipt,
    jsonb_build_object('input', request_input, 'payment_execution', false)
  );
  return receipt;
end;
$$;
revoke all on function public.get_operator_machine_arrangement_result(uuid),
  public.admin_add_operator_machine_arrangement(uuid,uuid,uuid,date,integer,integer,date,date)
  from public, anon;
grant execute on function public.get_operator_machine_arrangement_result(uuid),
  public.admin_add_operator_machine_arrangement(uuid,uuid,uuid,date,integer,integer,date,date)
  to authenticated;
