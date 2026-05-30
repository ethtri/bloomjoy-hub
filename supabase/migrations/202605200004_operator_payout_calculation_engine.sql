-- Operator payout calculation engine: effective-dated compensation
-- rules, payout previews, manual adjustments, and preserved inputs.

create or replace function public.operator_payout_money_from_minutes(
  p_minutes integer,
  p_hourly_rate_cents integer
)
returns integer
language sql
immutable
set search_path = public
as $$
  select case
    when p_hourly_rate_cents is null then null::integer
    else greatest(
      round(
        greatest(coalesce(p_minutes, 0), 0)::numeric
        * greatest(coalesce(p_hourly_rate_cents, 0), 0)::numeric
        / 60
      )::integer,
      0
    )
  end;
$$;

create or replace function public.operator_payout_commission_cents(
  p_eligible_revenue_cents integer,
  p_commission_basis_points integer
)
returns integer
language sql
immutable
set search_path = public
as $$
  select case
    when p_commission_basis_points is null then null::integer
    else greatest(
      round(
        greatest(coalesce(p_eligible_revenue_cents, 0), 0)::numeric
        * greatest(coalesce(p_commission_basis_points, 0), 0)::numeric
        / 10000
      )::integer,
      0
    )
  end;
$$;

create or replace function public.operator_payout_effective_rule_value(
  p_account_id uuid,
  p_operator_profile_id uuid,
  p_reporting_machine_id uuid,
  p_effective_date date,
  p_value_type text
)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  normalized_value_type text;
  selected_rule record;
begin
  normalized_value_type := lower(trim(coalesce(p_value_type, '')));

  if normalized_value_type not in ('hourly', 'commission') then
    raise exception 'Unsupported compensation rule value type';
  end if;

  select
    rule.id,
    rule.hourly_rate_cents,
    rule.commission_basis_points,
    rule.effective_start_date,
    rule.effective_end_date,
    case
      when rule.operator_profile_id = p_operator_profile_id
        and rule.reporting_machine_id = p_reporting_machine_id
        then 1
      when rule.reporting_machine_id = p_reporting_machine_id
        and rule.operator_profile_id is null
        then 2
      when rule.operator_profile_id = p_operator_profile_id
        and rule.reporting_machine_id is null
        then 3
      else 99
    end as precedence_rank,
    case
      when rule.operator_profile_id = p_operator_profile_id
        and rule.reporting_machine_id = p_reporting_machine_id
        then 'operator_machine_override'
      when rule.reporting_machine_id = p_reporting_machine_id
        and rule.operator_profile_id is null
        then 'machine_default'
      when rule.operator_profile_id = p_operator_profile_id
        and rule.reporting_machine_id is null
        then 'operator_default'
      else 'unsupported'
    end as rule_source
  into selected_rule
  from public.compensation_rules rule
  where rule.account_id = p_account_id
    and rule.status = 'active'
    and rule.effective_start_date <= p_effective_date
    and (
      rule.effective_end_date is null
      or rule.effective_end_date >= p_effective_date
    )
    and (
      (
        rule.operator_profile_id = p_operator_profile_id
        and rule.reporting_machine_id = p_reporting_machine_id
      )
      or (
        rule.operator_profile_id is null
        and rule.reporting_machine_id = p_reporting_machine_id
      )
      or (
        rule.operator_profile_id = p_operator_profile_id
        and rule.reporting_machine_id is null
      )
    )
    and (
      (
        normalized_value_type = 'hourly'
        and rule.hourly_rate_cents is not null
      )
      or (
        normalized_value_type = 'commission'
        and rule.commission_basis_points is not null
      )
    )
  order by
    precedence_rank,
    rule.effective_start_date desc,
    rule.created_at desc,
    rule.id
  limit 1;

  if not found then
    return null;
  end if;

  return jsonb_build_object(
    'ruleId', selected_rule.id,
    'source', selected_rule.rule_source,
    'precedenceRank', selected_rule.precedence_rank,
    'hourlyRateCents', selected_rule.hourly_rate_cents,
    'commissionBasisPoints', selected_rule.commission_basis_points,
    'effectiveStartDate', selected_rule.effective_start_date,
    'effectiveEndDate', selected_rule.effective_end_date
  );
end;
$$;

create or replace function public.operator_compensation_rule_payload(
  p_rule_id uuid
)
returns jsonb
language sql
stable
security definer
set search_path = public, auth
as $$
  select jsonb_build_object(
    'id', rule.id,
    'accountId', rule.account_id,
    'operatorProfileId', rule.operator_profile_id,
    'operatorDisplayName', profile.display_name,
    'machineId', rule.reporting_machine_id,
    'machineLabel', machine.machine_label,
    'locationId', machine.location_id,
    'hourlyRateCents', rule.hourly_rate_cents,
    'commissionBasisPoints', rule.commission_basis_points,
    'effectiveStartDate', rule.effective_start_date,
    'effectiveEndDate', rule.effective_end_date,
    'status', rule.status,
    'notes', rule.notes,
    'createdAt', rule.created_at,
    'updatedAt', rule.updated_at
  )
  from public.compensation_rules rule
  left join public.operator_payout_profiles profile
    on profile.id = rule.operator_profile_id
  left join public.reporting_machines machine
    on machine.id = rule.reporting_machine_id
  where rule.id = p_rule_id
    and (
      public.can_manage_operator_payout_account((select auth.uid()), rule.account_id)
      or (
        rule.reporting_machine_id is not null
        and public.can_manage_operator_payout_machine(
          (select auth.uid()),
          rule.reporting_machine_id
        )
      )
    );
$$;

create or replace function public.operator_payout_calculation_payload(
  p_payout_run_id uuid
)
returns jsonb
language plpgsql
stable
security definer
set search_path = public, auth
as $$
declare
  actor_user_id uuid;
  run_row public.payout_runs;
  result jsonb;
begin
  actor_user_id := auth.uid();

  if actor_user_id is null then
    raise exception 'Authentication required';
  end if;

  select *
  into run_row
  from public.payout_runs run
  where run.id = p_payout_run_id
  limit 1;

  if run_row.id is null then
    raise exception 'Payout run not found';
  end if;

  if not public.can_access_payout_run(actor_user_id, run_row.id) then
    raise exception 'Payout run access required';
  end if;

  select jsonb_build_object(
    'id', run_row.id,
    'accountId', run_row.account_id,
    'payoutPeriodId', run_row.payout_period_id,
    'status', run_row.status,
    'totalRawMinutes', run_row.total_raw_minutes,
    'totalRoundedPaidMinutes', run_row.total_rounded_paid_minutes,
    'totalHourlyPayCents', run_row.total_hourly_pay_cents,
    'totalCommissionPayCents', run_row.total_commission_pay_cents,
    'totalAdjustmentsCents', run_row.total_adjustments_cents,
    'totalPayoutCents', run_row.total_payout_cents,
    'warnings', run_row.warnings,
    'notes', run_row.notes,
    'createdAt', run_row.created_at,
    'updatedAt', run_row.updated_at,
    'items', coalesce((
      select jsonb_agg(
        jsonb_build_object(
          'id', item.id,
          'operatorProfileId', item.operator_profile_id,
          'operatorDisplayName', profile.display_name,
          'workerType', item.worker_type,
          'rawMinutes', item.raw_minutes,
          'roundedPaidMinutes', item.rounded_paid_minutes,
          'shiftCount', item.shift_count,
          'hourlyRateCents', item.hourly_rate_cents,
          'hourlyPayCents', item.hourly_pay_cents,
          'eligibleNetRevenueCents', item.eligible_net_revenue_cents,
          'commissionBasisPoints', item.commission_basis_points,
          'commissionPayCents', item.commission_pay_cents,
          'adjustmentsTotalCents', item.adjustments_total_cents,
          'totalPayoutCents', item.total_payout_cents,
          'status', item.status,
          'warnings', item.warnings,
          'calculationNotes', item.calculation_notes,
          'machines', coalesce((
            select jsonb_agg(
              jsonb_build_object(
                'id', item_machine.id,
                'machineId', item_machine.reporting_machine_id,
                'machineLabel', machine.machine_label,
                'locationId', item_machine.reporting_location_id,
                'locationName', location.name,
                'netRevenueCents', item_machine.net_revenue_cents,
                'eligibleNetRevenueCents', item_machine.eligible_net_revenue_cents,
                'commissionBasisPoints', item_machine.commission_basis_points,
                'commissionPayCents', item_machine.commission_pay_cents,
                'shiftCount', item_machine.shift_count,
                'rawMinutes', item_machine.raw_minutes,
                'roundedPaidMinutes', item_machine.rounded_paid_minutes,
                'includedInCommissionBasis', item_machine.included_in_commission_basis,
                'inclusionReason', item_machine.inclusion_reason
              )
              order by location.name, machine.machine_label
            )
            from public.payout_run_item_machines item_machine
            join public.reporting_machines machine
              on machine.id = item_machine.reporting_machine_id
            join public.reporting_locations location
              on location.id = item_machine.reporting_location_id
            where item_machine.payout_run_item_id = item.id
          ), '[]'::jsonb),
          'adjustments', coalesce((
            select jsonb_agg(
              jsonb_build_object(
                'id', adjustment.id,
                'amountCents', adjustment.amount_cents,
                'adjustmentType', adjustment.adjustment_type,
                'description', adjustment.description,
                'visibleToOperator', adjustment.visible_to_operator,
                'createdAt', adjustment.created_at
              )
              order by adjustment.created_at
            )
            from public.payout_adjustments adjustment
            where adjustment.payout_run_id = run_row.id
              and adjustment.operator_profile_id = item.operator_profile_id
              and (
                adjustment.visible_to_operator
                or public.can_manage_operator_payout_account(actor_user_id, adjustment.account_id)
              )
          ), '[]'::jsonb)
        )
        order by profile.display_name, item.created_at
      )
      from public.payout_run_items item
      join public.operator_payout_profiles profile
        on profile.id = item.operator_profile_id
      where item.payout_run_id = run_row.id
        and item.status <> 'voided'
        and public.can_access_payout_run_item(actor_user_id, item.id)
    ), '[]'::jsonb)
  )
  into result;

  return result;
end;
$$;

create or replace function public.get_payout_calculation_context(
  p_payout_period_id uuid
)
returns jsonb
language plpgsql
stable
security definer
set search_path = public, auth
as $$
declare
  actor_user_id uuid;
  period_row public.payout_periods;
  run_id uuid;
begin
  actor_user_id := auth.uid();

  if actor_user_id is null then
    raise exception 'Authentication required';
  end if;

  select *
  into period_row
  from public.payout_periods period
  where period.id = p_payout_period_id
  limit 1;

  if period_row.id is null then
    raise exception 'Payout period not found';
  end if;

  if not public.can_manage_operator_payout_account(actor_user_id, period_row.account_id)
    and not exists (
      select 1
      from public.payout_runs run
      where run.payout_period_id = period_row.id
        and run.status in ('issued', 'closed')
        and public.can_access_payout_run(actor_user_id, run.id)
    ) then
    raise exception 'Payout calculation access required';
  end if;

  select run.id
  into run_id
  from public.payout_runs run
  where run.payout_period_id = period_row.id
    and run.status <> 'voided'
  order by run.created_at desc
  limit 1;

  return jsonb_build_object(
    'payoutPeriodId', period_row.id,
    'periodStartDate', period_row.period_start_date,
    'periodEndDate', period_row.period_end_date,
    'periodStatus', period_row.status,
    'payoutRun', case
      when run_id is null then null::jsonb
      else public.operator_payout_calculation_payload(run_id)
    end
  );
end;
$$;

create or replace function public.admin_upsert_operator_compensation_rule(
  p_rule_id uuid,
  p_account_id uuid,
  p_operator_profile_id uuid,
  p_reporting_machine_id uuid,
  p_hourly_rate_cents integer,
  p_commission_basis_points integer,
  p_effective_start_date date,
  p_effective_end_date date,
  p_status text,
  p_notes text,
  p_reason text
)
returns jsonb
language plpgsql
security definer
set search_path = public, auth
as $$
declare
  actor_user_id uuid;
  normalized_reason text;
  normalized_status text;
  account_row public.customer_accounts;
  profile_row public.operator_payout_profiles;
  machine_row public.reporting_machines;
  before_row public.compensation_rules;
  after_row public.compensation_rules;
begin
  actor_user_id := auth.uid();
  normalized_reason := trim(coalesce(p_reason, ''));
  normalized_status := lower(coalesce(nullif(trim(p_status), ''), 'active'));

  if actor_user_id is null then
    raise exception 'Authentication required';
  end if;

  if normalized_reason = '' then
    raise exception 'Compensation rule update reason is required';
  end if;

  if p_account_id is null then
    raise exception 'Account is required';
  end if;

  if p_operator_profile_id is null and p_reporting_machine_id is null then
    raise exception 'Compensation rule requires an operator, machine, or both';
  end if;

  if p_hourly_rate_cents is null and p_commission_basis_points is null then
    raise exception 'Compensation rule requires an hourly rate or commission percentage';
  end if;

  if p_hourly_rate_cents is not null and p_hourly_rate_cents < 0 then
    raise exception 'Hourly rate cannot be negative';
  end if;

  if p_commission_basis_points is not null
    and (p_commission_basis_points < 0 or p_commission_basis_points > 10000) then
    raise exception 'Commission basis points must be between 0 and 10000';
  end if;

  if p_effective_start_date is null then
    raise exception 'Effective start date is required';
  end if;

  if p_effective_end_date is not null
    and p_effective_end_date < p_effective_start_date then
    raise exception 'Effective end date must be on or after the start date';
  end if;

  if normalized_status not in ('active', 'inactive') then
    raise exception 'Invalid compensation rule status';
  end if;

  select *
  into account_row
  from public.customer_accounts account
  where account.id = p_account_id
  limit 1;

  if account_row.id is null then
    raise exception 'Account not found';
  end if;

  if p_operator_profile_id is not null then
    select *
    into profile_row
    from public.operator_payout_profiles profile
    where profile.id = p_operator_profile_id
      and profile.account_id = account_row.id
    limit 1;

    if profile_row.id is null then
      raise exception 'Operator payout profile not found for account';
    end if;
  end if;

  if p_reporting_machine_id is not null then
    select *
    into machine_row
    from public.reporting_machines machine
    where machine.id = p_reporting_machine_id
      and machine.account_id = account_row.id
    limit 1;

    if machine_row.id is null then
      raise exception 'Reporting machine not found for account';
    end if;
  end if;

  if not (
    public.can_manage_operator_payout_account(actor_user_id, account_row.id)
    or (
      p_reporting_machine_id is not null
      and public.can_manage_operator_payout_machine(actor_user_id, p_reporting_machine_id)
    )
  ) then
    raise exception 'Operator compensation rule access required';
  end if;

  if p_rule_id is not null then
    select *
    into before_row
    from public.compensation_rules rule
    where rule.id = p_rule_id
    limit 1;

    if before_row.id is null then
      raise exception 'Compensation rule not found';
    end if;

    if before_row.account_id <> account_row.id then
      raise exception 'Compensation rule account cannot be changed';
    end if;
  end if;

  if before_row.id is null then
    insert into public.compensation_rules (
      account_id,
      operator_profile_id,
      reporting_machine_id,
      hourly_rate_cents,
      commission_basis_points,
      effective_start_date,
      effective_end_date,
      status,
      notes,
      created_by,
      updated_by
    )
    values (
      account_row.id,
      p_operator_profile_id,
      p_reporting_machine_id,
      p_hourly_rate_cents,
      p_commission_basis_points,
      p_effective_start_date,
      p_effective_end_date,
      normalized_status,
      nullif(trim(coalesce(p_notes, '')), ''),
      actor_user_id,
      actor_user_id
    )
    returning * into after_row;
  else
    update public.compensation_rules
    set
      operator_profile_id = p_operator_profile_id,
      reporting_machine_id = p_reporting_machine_id,
      hourly_rate_cents = p_hourly_rate_cents,
      commission_basis_points = p_commission_basis_points,
      effective_start_date = p_effective_start_date,
      effective_end_date = p_effective_end_date,
      status = normalized_status,
      notes = nullif(trim(coalesce(p_notes, '')), ''),
      updated_by = actor_user_id
    where id = before_row.id
    returning * into after_row;
  end if;

  insert into public.admin_audit_log (
    actor_user_id,
    action,
    entity_type,
    entity_id,
    target_user_id,
    before,
    after,
    meta
  )
  values (
    actor_user_id,
    case when before_row.id is null
      then 'operator_compensation_rule.created'
      else 'operator_compensation_rule.updated'
    end,
    'compensation_rule',
    after_row.id::text,
    profile_row.user_id,
    coalesce(to_jsonb(before_row), '{}'::jsonb),
    to_jsonb(after_row),
    jsonb_build_object(
      'reason', normalized_reason,
      'account_id', account_row.id,
      'reporting_machine_id', p_reporting_machine_id,
      'operator_profile_id', p_operator_profile_id,
      'tax_compliance_engine', false
    )
  );

  return public.operator_compensation_rule_payload(after_row.id);
end;
$$;

create or replace function public.admin_calculate_payout_run(
  p_payout_period_id uuid,
  p_regenerate boolean default false,
  p_reason text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public, auth
as $$
declare
  actor_user_id uuid;
  normalized_reason text;
  period_row public.payout_periods;
  run_row public.payout_runs;
  operator_row public.operator_payout_profiles;
  machine_row record;
  existing_item public.payout_run_items;
  after_item public.payout_run_items;
  snapshot_row public.payout_period_machine_revenue_snapshots;
  hourly_rule jsonb;
  commission_rule jsonb;
  machine_payload jsonb;
  machine_breakdown jsonb;
  item_warnings jsonb;
  run_warnings jsonb;
  time_entry_ids jsonb;
  adjustment_total integer;
  machine_hourly_rate integer;
  machine_hourly_pay integer;
  machine_commission_basis_points integer;
  machine_commission_pay integer;
  machine_net_revenue integer;
  machine_eligible_revenue integer;
  item_raw_minutes integer;
  item_rounded_minutes integer;
  item_shift_count integer;
  item_hourly_pay integer;
  item_commission_pay integer;
  item_eligible_revenue integer;
  item_total_payout integer;
  item_hourly_rate integer;
  item_commission_basis_points integer;
  mixed_hourly_rates boolean;
  mixed_commission_rates boolean;
  snapshot_has_blocker boolean;
  run_has_blocker boolean;
  run_totals record;
begin
  actor_user_id := auth.uid();
  normalized_reason := trim(coalesce(p_reason, ''));

  if actor_user_id is null then
    raise exception 'Authentication required';
  end if;

  select *
  into period_row
  from public.payout_periods period
  where period.id = p_payout_period_id
  limit 1;

  if period_row.id is null then
    raise exception 'Payout period not found';
  end if;

  if not public.can_manage_operator_payout_account(actor_user_id, period_row.account_id) then
    raise exception 'Operator payout calculation access required';
  end if;

  select *
  into run_row
  from public.payout_runs run
  where run.payout_period_id = period_row.id
    and run.status <> 'voided'
  limit 1;

  if run_row.id is not null and not coalesce(p_regenerate, false) then
    return jsonb_build_object(
      'payoutRun', public.operator_payout_calculation_payload(run_row.id),
      'idempotent', true
    );
  end if;

  if run_row.id is not null
    and run_row.status not in ('draft', 'review', 'reopened') then
    raise exception 'Finalized payout runs cannot be recalculated';
  end if;

  if run_row.id is not null and normalized_reason = '' then
    raise exception 'Payout recalculation reason is required';
  end if;

  perform public.admin_generate_payout_revenue_snapshots_for_period(
    period_row.id,
    false,
    null
  );

  if run_row.id is null then
    insert into public.payout_runs (
      account_id,
      payout_period_id,
      status,
      notes,
      warnings,
      created_by
    )
    values (
      period_row.account_id,
      period_row.id,
      'draft',
      'Generated payout preview from approved time, revenue snapshots, compensation rules, and adjustments.',
      '[]'::jsonb,
      actor_user_id
    )
    returning * into run_row;
  else
    update public.payout_runs
    set
      status = 'draft',
      notes = 'Regenerated payout preview from approved time, revenue snapshots, compensation rules, and adjustments.',
      warnings = '[]'::jsonb
    where id = run_row.id
    returning * into run_row;
  end if;

  delete from public.payout_run_item_machines item_machine
  using public.payout_run_items item
  where item_machine.payout_run_item_id = item.id
    and item.payout_run_id = run_row.id;

  for operator_row in
    select distinct profile.*
    from public.operator_payout_profiles profile
    where profile.account_id = period_row.account_id
      and profile.status = 'active'
      and (
        exists (
          select 1
          from public.time_entries entry
          where entry.operator_profile_id = profile.id
            and entry.payout_period_id = period_row.id
            and entry.status in ('submitted', 'locked', 'included_in_payout')
        )
        or exists (
          select 1
          from public.payout_adjustments adjustment
          where adjustment.payout_run_id = run_row.id
            and adjustment.operator_profile_id = profile.id
        )
      )
    order by profile.display_name, profile.id
  loop
    machine_breakdown := '[]'::jsonb;
    item_warnings := '[]'::jsonb;
    item_raw_minutes := 0;
    item_rounded_minutes := 0;
    item_shift_count := 0;
    item_hourly_pay := 0;
    item_commission_pay := 0;
    item_eligible_revenue := 0;
    item_hourly_rate := null;
    item_commission_basis_points := null;
    mixed_hourly_rates := false;
    mixed_commission_rates := false;

    select coalesce(sum(adjustment.amount_cents), 0)::integer
    into adjustment_total
    from public.payout_adjustments adjustment
    where adjustment.payout_run_id = run_row.id
      and adjustment.operator_profile_id = operator_row.id;

    for machine_row in
      select
        entry.reporting_machine_id,
        entry.reporting_location_id,
        coalesce(sum(entry.raw_duration_minutes), 0)::integer as raw_minutes,
        coalesce(sum(entry.rounded_paid_minutes), 0)::integer as rounded_paid_minutes,
        count(*)::integer as shift_count,
        jsonb_agg(entry.id order by entry.work_date, entry.start_time, entry.id) as time_entry_ids
      from public.time_entries entry
      where entry.operator_profile_id = operator_row.id
        and entry.payout_period_id = period_row.id
        and entry.status in ('submitted', 'locked', 'included_in_payout')
      group by entry.reporting_machine_id, entry.reporting_location_id
      order by entry.reporting_machine_id
    loop
      hourly_rule := public.operator_payout_effective_rule_value(
        period_row.account_id,
        operator_row.id,
        machine_row.reporting_machine_id,
        period_row.period_end_date,
        'hourly'
      );
      commission_rule := public.operator_payout_effective_rule_value(
        period_row.account_id,
        operator_row.id,
        machine_row.reporting_machine_id,
        period_row.period_end_date,
        'commission'
      );

      machine_hourly_rate := nullif(hourly_rule ->> 'hourlyRateCents', '')::integer;
      machine_commission_basis_points :=
        nullif(commission_rule ->> 'commissionBasisPoints', '')::integer;
      machine_hourly_pay := coalesce(
        public.operator_payout_money_from_minutes(
          machine_row.rounded_paid_minutes,
          machine_hourly_rate
        ),
        0
      );

      select *
      into snapshot_row
      from public.payout_period_machine_revenue_snapshots snapshot
      where snapshot.payout_period_id = period_row.id
        and snapshot.reporting_machine_id = machine_row.reporting_machine_id
        and snapshot.status <> 'voided'
      limit 1;

      machine_net_revenue := coalesce(snapshot_row.net_revenue_cents, 0);
      machine_eligible_revenue := coalesce(snapshot_row.eligible_commission_revenue_cents, 0);
      machine_commission_pay := coalesce(
        public.operator_payout_commission_cents(
          machine_eligible_revenue,
          machine_commission_basis_points
        ),
        0
      );

      if machine_hourly_rate is null and machine_row.rounded_paid_minutes > 0 then
        item_warnings := item_warnings || jsonb_build_array(jsonb_build_object(
          'code', 'missing_hourly_rule',
          'severity', 'blocker',
          'message', 'Hourly compensation rule is missing for worked time.',
          'machineId', machine_row.reporting_machine_id
        ));
      end if;

      if machine_commission_basis_points is null then
        item_warnings := item_warnings || jsonb_build_array(jsonb_build_object(
          'code', 'missing_commission_rule',
          'severity', 'blocker',
          'message', 'Commission compensation rule is missing for an operated machine.',
          'machineId', machine_row.reporting_machine_id
        ));
      end if;

      if snapshot_row.id is null then
        item_warnings := item_warnings || jsonb_build_array(jsonb_build_object(
          'code', 'missing_revenue_snapshot',
          'severity', 'blocker',
          'message', 'Revenue snapshot is missing for an operated machine.',
          'machineId', machine_row.reporting_machine_id
        ));
      else
        select exists (
          select 1
          from jsonb_array_elements(snapshot_row.warnings) warning
          where warning ->> 'severity' = 'blocker'
        )
        into snapshot_has_blocker;

        if snapshot_has_blocker then
          item_warnings := item_warnings || jsonb_build_array(jsonb_build_object(
            'code', 'revenue_snapshot_blocker',
            'severity', 'blocker',
            'message', 'Revenue snapshot has blocker warnings.',
            'machineId', machine_row.reporting_machine_id,
            'snapshotId', snapshot_row.id
          ));
        end if;
      end if;

      if item_hourly_rate is null then
        item_hourly_rate := machine_hourly_rate;
      elsif machine_hourly_rate is not null
        and item_hourly_rate is distinct from machine_hourly_rate then
        mixed_hourly_rates := true;
      end if;

      if item_commission_basis_points is null then
        item_commission_basis_points := machine_commission_basis_points;
      elsif machine_commission_basis_points is not null
        and item_commission_basis_points is distinct from machine_commission_basis_points then
        mixed_commission_rates := true;
      end if;

      item_raw_minutes := item_raw_minutes + machine_row.raw_minutes;
      item_rounded_minutes := item_rounded_minutes + machine_row.rounded_paid_minutes;
      item_shift_count := item_shift_count + machine_row.shift_count;
      item_hourly_pay := item_hourly_pay + machine_hourly_pay;
      item_commission_pay := item_commission_pay + machine_commission_pay;
      item_eligible_revenue := item_eligible_revenue + machine_eligible_revenue;

      machine_payload := jsonb_build_object(
        'machineId', machine_row.reporting_machine_id,
        'locationId', machine_row.reporting_location_id,
        'rawMinutes', machine_row.raw_minutes,
        'roundedPaidMinutes', machine_row.rounded_paid_minutes,
        'shiftCount', machine_row.shift_count,
        'timeEntryIds', machine_row.time_entry_ids,
        'hourlyRule', hourly_rule,
        'hourlyRateCents', machine_hourly_rate,
        'hourlyPayCents', machine_hourly_pay,
        'commissionRule', commission_rule,
        'commissionBasisPoints', machine_commission_basis_points,
        'commissionPayCents', machine_commission_pay,
        'revenueSnapshotId', snapshot_row.id,
        'netRevenueCents', machine_net_revenue,
        'eligibleNetRevenueCents', machine_eligible_revenue,
        'snapshotWarnings', coalesce(snapshot_row.warnings, '[]'::jsonb)
      );
      machine_breakdown := machine_breakdown || jsonb_build_array(machine_payload);
    end loop;

    if mixed_hourly_rates then
      item_hourly_rate := null;
      item_warnings := item_warnings || jsonb_build_array(jsonb_build_object(
        'code', 'mixed_hourly_rates',
        'severity', 'info',
        'message', 'Hourly pay used multiple machine-level rates.'
      ));
    end if;

    if mixed_commission_rates then
      item_commission_basis_points := null;
      item_warnings := item_warnings || jsonb_build_array(jsonb_build_object(
        'code', 'mixed_commission_rules',
        'severity', 'info',
        'message', 'Commission pay used multiple machine-level rates.'
      ));
    end if;

    item_total_payout := item_hourly_pay + item_commission_pay + adjustment_total;

    if item_total_payout < 0 then
      item_warnings := item_warnings || jsonb_build_array(jsonb_build_object(
        'code', 'negative_total_payout',
        'severity', 'blocker',
        'message', 'Adjustments exceed calculated pay and require manager override before finalization.'
      ));
    end if;

    select *
    into existing_item
    from public.payout_run_items item
    where item.payout_run_id = run_row.id
      and item.operator_profile_id = operator_row.id
    limit 1;

    if existing_item.id is null then
      insert into public.payout_run_items (
        payout_run_id,
        account_id,
        operator_profile_id,
        worker_type,
        raw_minutes,
        rounded_paid_minutes,
        shift_count,
        hourly_rate_cents,
        hourly_pay_cents,
        eligible_net_revenue_cents,
        commission_basis_points,
        commission_pay_cents,
        adjustments_total_cents,
        total_payout_cents,
        status,
        warnings,
        calculation_notes
      )
      values (
        run_row.id,
        period_row.account_id,
        operator_row.id,
        operator_row.worker_type,
        item_raw_minutes,
        item_rounded_minutes,
        item_shift_count,
        item_hourly_rate,
        item_hourly_pay,
        item_eligible_revenue,
        item_commission_basis_points,
        item_commission_pay,
        adjustment_total,
        item_total_payout,
        'draft',
        item_warnings,
        jsonb_build_object(
          'calculationVersion', 'operator_payout_v1',
          'calculatedAt', now(),
          'periodStartDate', period_row.period_start_date,
          'periodEndDate', period_row.period_end_date,
          'machineBreakdown', machine_breakdown,
          'inputsPreserved', true,
          'taxComplianceEngine', false
        )
      )
      returning * into after_item;
    else
      update public.payout_run_items
      set
        worker_type = operator_row.worker_type,
        raw_minutes = item_raw_minutes,
        rounded_paid_minutes = item_rounded_minutes,
        shift_count = item_shift_count,
        hourly_rate_cents = item_hourly_rate,
        hourly_pay_cents = item_hourly_pay,
        eligible_net_revenue_cents = item_eligible_revenue,
        commission_basis_points = item_commission_basis_points,
        commission_pay_cents = item_commission_pay,
        adjustments_total_cents = adjustment_total,
        total_payout_cents = item_total_payout,
        status = 'draft',
        warnings = item_warnings,
        calculation_notes = jsonb_build_object(
          'calculationVersion', 'operator_payout_v1',
          'calculatedAt', now(),
          'periodStartDate', period_row.period_start_date,
          'periodEndDate', period_row.period_end_date,
          'machineBreakdown', machine_breakdown,
          'inputsPreserved', true,
          'taxComplianceEngine', false
        )
      where id = existing_item.id
      returning * into after_item;
    end if;

    update public.payout_adjustments
    set payout_run_item_id = after_item.id
    where payout_run_id = run_row.id
      and operator_profile_id = operator_row.id
      and payout_run_item_id is null;

    for machine_payload in
      select value
      from jsonb_array_elements(machine_breakdown) as machine_values(value)
    loop
      insert into public.payout_run_item_machines (
        payout_run_item_id,
        reporting_machine_id,
        reporting_location_id,
        net_revenue_cents,
        eligible_net_revenue_cents,
        commission_basis_points,
        commission_pay_cents,
        shift_count,
        raw_minutes,
        rounded_paid_minutes,
        included_in_commission_basis,
        inclusion_reason
      )
      values (
        after_item.id,
        (machine_payload ->> 'machineId')::uuid,
        (machine_payload ->> 'locationId')::uuid,
        coalesce((machine_payload ->> 'netRevenueCents')::integer, 0),
        coalesce((machine_payload ->> 'eligibleNetRevenueCents')::integer, 0),
        nullif(machine_payload ->> 'commissionBasisPoints', '')::integer,
        coalesce((machine_payload ->> 'commissionPayCents')::integer, 0),
        coalesce((machine_payload ->> 'shiftCount')::integer, 0),
        coalesce((machine_payload ->> 'rawMinutes')::integer, 0),
        coalesce((machine_payload ->> 'roundedPaidMinutes')::integer, 0),
        (machine_payload ->> 'commissionBasisPoints') is not null
          and (machine_payload ->> 'revenueSnapshotId') is not null,
        concat_ws(
          '; ',
          'commission_rule=' || coalesce(machine_payload #>> '{commissionRule,ruleId}', 'missing'),
          'revenue_snapshot=' || coalesce(machine_payload ->> 'revenueSnapshotId', 'missing')
        )
      );
    end loop;
  end loop;

  select
    coalesce(sum(item.raw_minutes), 0)::integer as total_raw_minutes,
    coalesce(sum(item.rounded_paid_minutes), 0)::integer as total_rounded_paid_minutes,
    coalesce(sum(item.hourly_pay_cents), 0)::integer as total_hourly_pay_cents,
    coalesce(sum(item.commission_pay_cents), 0)::integer as total_commission_pay_cents,
    coalesce(sum(item.adjustments_total_cents), 0)::integer as total_adjustments_cents,
    coalesce(sum(item.total_payout_cents), 0)::integer as total_payout_cents
  into run_totals
  from public.payout_run_items item
  where item.payout_run_id = run_row.id
    and item.status <> 'voided';

  select coalesce(jsonb_agg(warning), '[]'::jsonb)
  into run_warnings
  from (
    select warning
    from public.payout_run_items item
    cross join lateral jsonb_array_elements(item.warnings) warning
    where item.payout_run_id = run_row.id
      and item.status <> 'voided'
  ) item_warning_rows;

  select exists (
    select 1
    from public.payout_run_items item
    cross join lateral jsonb_array_elements(item.warnings) warning
    where item.payout_run_id = run_row.id
      and item.status <> 'voided'
      and warning ->> 'severity' = 'blocker'
  )
  into run_has_blocker;

  if run_has_blocker then
    run_warnings := run_warnings || jsonb_build_array(jsonb_build_object(
      'code', 'payout_run_blocked',
      'severity', 'blocker',
      'message', 'Missing rules, missing revenue snapshots, or negative totals must be resolved or explicitly overridden before finalization.'
    ));
  end if;

  update public.payout_runs
  set
    status = case when run_has_blocker then 'draft' else 'review' end,
    total_raw_minutes = run_totals.total_raw_minutes,
    total_rounded_paid_minutes = run_totals.total_rounded_paid_minutes,
    total_hourly_pay_cents = run_totals.total_hourly_pay_cents,
    total_commission_pay_cents = run_totals.total_commission_pay_cents,
    total_adjustments_cents = run_totals.total_adjustments_cents,
    total_payout_cents = run_totals.total_payout_cents,
    warnings = run_warnings
  where id = run_row.id
  returning * into run_row;

  update public.payout_periods
  set
    status = case when run_has_blocker then 'draft_payout' else 'review' end,
    updated_by = actor_user_id
  where id = period_row.id
    and status in ('open', 'grace_period', 'locked', 'review', 'draft_payout', 'reopened');

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
    'operator_payout_run.calculated',
    'payout_run',
    run_row.id::text,
    '{}'::jsonb,
    to_jsonb(run_row),
    jsonb_build_object(
      'payout_period_id', period_row.id,
      'reason', nullif(normalized_reason, ''),
      'regenerated', coalesce(p_regenerate, false),
      'has_blockers', run_has_blocker,
      'calculation_version', 'operator_payout_v1',
      'tax_compliance_engine', false
    )
  );

  return jsonb_build_object(
    'payoutRun', public.operator_payout_calculation_payload(run_row.id),
    'idempotent', false,
    'hasBlockers', run_has_blocker
  );
end;
$$;

create or replace function public.admin_add_payout_adjustment(
  p_payout_run_id uuid,
  p_operator_profile_id uuid,
  p_amount_cents integer,
  p_adjustment_type text,
  p_description text,
  p_visible_to_operator boolean,
  p_reason text
)
returns jsonb
language plpgsql
security definer
set search_path = public, auth
as $$
declare
  actor_user_id uuid;
  normalized_adjustment_type text;
  normalized_description text;
  normalized_reason text;
  run_row public.payout_runs;
  profile_row public.operator_payout_profiles;
  item_row public.payout_run_items;
  adjustment_row public.payout_adjustments;
  recalculation jsonb;
begin
  actor_user_id := auth.uid();
  normalized_adjustment_type := lower(coalesce(nullif(trim(p_adjustment_type), ''), 'manual_adjustment'));
  normalized_description := trim(coalesce(p_description, ''));
  normalized_reason := trim(coalesce(p_reason, ''));

  if actor_user_id is null then
    raise exception 'Authentication required';
  end if;

  if p_amount_cents is null or p_amount_cents = 0 then
    raise exception 'Adjustment amount must be non-zero';
  end if;

  if normalized_description = '' then
    raise exception 'Adjustment description is required';
  end if;

  if normalized_reason = '' then
    raise exception 'Adjustment audit reason is required';
  end if;

  if normalized_adjustment_type not in (
    'manual_adjustment',
    'training_pay',
    'bonus',
    'reimbursement',
    'prior_period_correction',
    'service_visit',
    'cleaning_bonus',
    'travel_reimbursement',
    'commission_true_up',
    'deduction'
  ) then
    raise exception 'Invalid adjustment type';
  end if;

  select *
  into run_row
  from public.payout_runs run
  where run.id = p_payout_run_id
  limit 1;

  if run_row.id is null then
    raise exception 'Payout run not found';
  end if;

  if run_row.status not in ('draft', 'review', 'reopened') then
    raise exception 'Adjustments can only be added before payout finalization';
  end if;

  if not public.can_manage_operator_payout_account(actor_user_id, run_row.account_id) then
    raise exception 'Operator payout adjustment access required';
  end if;

  select *
  into profile_row
  from public.operator_payout_profiles profile
  where profile.id = p_operator_profile_id
    and profile.account_id = run_row.account_id
  limit 1;

  if profile_row.id is null then
    raise exception 'Operator payout profile not found for payout run';
  end if;

  select *
  into item_row
  from public.payout_run_items item
  where item.payout_run_id = run_row.id
    and item.operator_profile_id = profile_row.id
  limit 1;

  insert into public.payout_adjustments (
    payout_run_id,
    payout_run_item_id,
    account_id,
    operator_profile_id,
    amount_cents,
    adjustment_type,
    description,
    visible_to_operator,
    created_by,
    updated_by
  )
  values (
    run_row.id,
    item_row.id,
    run_row.account_id,
    profile_row.id,
    p_amount_cents,
    normalized_adjustment_type,
    normalized_description,
    coalesce(p_visible_to_operator, true),
    actor_user_id,
    actor_user_id
  )
  returning * into adjustment_row;

  insert into public.admin_audit_log (
    actor_user_id,
    action,
    entity_type,
    entity_id,
    target_user_id,
    before,
    after,
    meta
  )
  values (
    actor_user_id,
    'operator_payout_adjustment.created',
    'payout_adjustment',
    adjustment_row.id::text,
    profile_row.user_id,
    '{}'::jsonb,
    to_jsonb(adjustment_row),
    jsonb_build_object(
      'reason', normalized_reason,
      'payout_run_id', run_row.id,
      'operator_profile_id', profile_row.id,
      'visible_to_operator', adjustment_row.visible_to_operator
    )
  );

  recalculation := public.admin_calculate_payout_run(
    run_row.payout_period_id,
    true,
    'Adjustment applied: ' || normalized_reason
  );

  return jsonb_build_object(
    'adjustment', to_jsonb(adjustment_row),
    'payoutRun', recalculation -> 'payoutRun'
  );
end;
$$;

comment on function public.operator_payout_money_from_minutes(integer, integer) is
  'Calculates hourly payout cents from rounded minutes and cents-per-hour. It does not calculate overtime, withholding, or tax compliance.';
comment on function public.operator_payout_commission_cents(integer, integer) is
  'Calculates commission cents from sanitized eligible revenue and basis points.';
comment on function public.operator_payout_effective_rule_value(uuid, uuid, uuid, date, text) is
  'Service-only helper resolving hourly or commission rule values by deterministic precedence: operator-machine override, machine default, then operator default.';
comment on function public.operator_compensation_rule_payload(uuid) is
  'Returns a sanitized compensation rule payload for managers who can access the account or scoped machine.';
comment on function public.operator_payout_calculation_payload(uuid) is
  'Returns payout run totals, operator items, machine breakdowns, adjustments, and warnings visible to the current actor.';
comment on function public.get_payout_calculation_context(uuid) is
  'Returns the current payout calculation context for a payout period.';
comment on function public.admin_upsert_operator_compensation_rule(uuid, uuid, uuid, uuid, integer, integer, date, date, text, text, text) is
  'Audited manager/admin RPC for effective-dated operator compensation rules.';
comment on function public.admin_calculate_payout_run(uuid, boolean, text) is
  'Calculates or regenerates a payout run from submitted or locked time, sanitized revenue snapshots, effective compensation rules, and manual adjustments.';
comment on function public.admin_add_payout_adjustment(uuid, uuid, integer, text, text, boolean, text) is
  'Adds an audited manual payout adjustment with a required operator-visible description and manager audit reason, then recalculates the run.';

revoke execute on function public.operator_payout_money_from_minutes(integer, integer)
  from public, anon;
revoke execute on function public.operator_payout_commission_cents(integer, integer)
  from public, anon;
revoke execute on function public.operator_payout_effective_rule_value(uuid, uuid, uuid, date, text)
  from public, anon, authenticated;
revoke execute on function public.operator_compensation_rule_payload(uuid)
  from public, anon;
revoke execute on function public.operator_payout_calculation_payload(uuid)
  from public, anon;
revoke execute on function public.get_payout_calculation_context(uuid)
  from public, anon;
revoke execute on function public.admin_upsert_operator_compensation_rule(uuid, uuid, uuid, uuid, integer, integer, date, date, text, text, text)
  from public, anon;
revoke execute on function public.admin_calculate_payout_run(uuid, boolean, text)
  from public, anon;
revoke execute on function public.admin_add_payout_adjustment(uuid, uuid, integer, text, text, boolean, text)
  from public, anon;

grant execute on function public.operator_payout_money_from_minutes(integer, integer)
  to authenticated;
grant execute on function public.operator_payout_commission_cents(integer, integer)
  to authenticated;
grant execute on function public.operator_payout_effective_rule_value(uuid, uuid, uuid, date, text)
  to service_role;
grant execute on function public.operator_compensation_rule_payload(uuid)
  to authenticated;
grant execute on function public.operator_payout_calculation_payload(uuid)
  to authenticated;
grant execute on function public.get_payout_calculation_context(uuid)
  to authenticated;
grant execute on function public.admin_upsert_operator_compensation_rule(uuid, uuid, uuid, uuid, integer, integer, date, date, text, text, text)
  to authenticated;
grant execute on function public.admin_calculate_payout_run(uuid, boolean, text)
  to authenticated;
grant execute on function public.admin_add_payout_adjustment(uuid, uuid, integer, text, text, boolean, text)
  to authenticated;

select pg_notify('pgrst', 'reload schema');
