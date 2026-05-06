-- Let Scoped Admins manage reporting tax rates for machines in their current
-- active machine grant, without exposing broader machine setup controls.

create or replace function public.admin_get_scoped_machine_tax_setup()
returns jsonb
language plpgsql
stable
security definer
set search_path = public, auth
as $$
declare
  actor_user_id uuid;
  actor_is_super_admin boolean;
  actor_machine_ids uuid[];
  result jsonb;
begin
  actor_user_id := auth.uid();
  actor_is_super_admin := public.is_super_admin(actor_user_id);
  actor_machine_ids := public.scoped_admin_machine_ids(actor_user_id);

  if actor_user_id is null then
    raise exception 'Authentication required';
  end if;

  if not actor_is_super_admin and coalesce(array_length(actor_machine_ids, 1), 0) = 0 then
    raise exception 'Admin access required';
  end if;

  with machine_rows as (
    select
      machine.id,
      machine.machine_label,
      machine.machine_type,
      machine.sunze_machine_id,
      machine.status,
      account.name as account_name,
      location.name as location_name,
      max(fact.sale_date) as latest_sale_date
    from public.reporting_machines machine
    join public.customer_accounts account on account.id = machine.account_id
    join public.reporting_locations location on location.id = machine.location_id
    left join public.machine_sales_facts fact on fact.reporting_machine_id = machine.id
    where actor_is_super_admin
      or machine.id = any(actor_machine_ids)
    group by machine.id, account.name, location.name
  ),
  assignment_rows as (
    select
      assignment.id,
      assignment.machine_id,
      partnership.id as partnership_id,
      partnership.name as partnership_name,
      assignment.effective_start_date,
      assignment.effective_end_date,
      assignment.status
    from public.reporting_machine_partnership_assignments assignment
    join public.reporting_partnerships partnership
      on partnership.id = assignment.partnership_id
    join machine_rows machine on machine.id = assignment.machine_id
    where assignment.assignment_role = 'primary_reporting'
      and assignment.status = 'active'
      and assignment.effective_start_date <= current_date
      and (assignment.effective_end_date is null or assignment.effective_end_date >= current_date)
      and partnership.status = 'active'
  ),
  tax_rows as (
    select
      tax.id,
      tax.machine_id,
      machine.machine_label,
      tax.tax_rate_percent,
      tax.effective_start_date,
      tax.effective_end_date,
      tax.status,
      tax.notes
    from public.reporting_machine_tax_rates tax
    join machine_rows machine on machine.id = tax.machine_id
  ),
  warnings as (
    select jsonb_build_object(
      'warningType', 'missing_machine_tax_rate',
      'machineId', machine.id,
      'machineLabel', machine.machine_label,
      'message', machine.machine_label || ' has active partner reporting but no current machine tax rate.'
    ) as warning
    from machine_rows machine
    where exists (
      select 1
      from assignment_rows assignment
      where assignment.machine_id = machine.id
    )
      and not exists (
        select 1
        from public.reporting_machine_tax_rates tax
        where tax.machine_id = machine.id
          and tax.status = 'active'
          and tax.effective_start_date <= current_date
          and (tax.effective_end_date is null or tax.effective_end_date >= current_date)
      )
  )
  select jsonb_build_object(
    'machines',
    coalesce((
      select jsonb_agg(
        jsonb_build_object(
          'id', machine.id,
          'machineLabel', machine.machine_label,
          'machineType', machine.machine_type,
          'sunzeMachineId', machine.sunze_machine_id,
          'status', machine.status,
          'accountName', machine.account_name,
          'locationName', machine.location_name,
          'latestSaleDate', machine.latest_sale_date,
          'activePartnerships', coalesce((
            select jsonb_agg(
              jsonb_build_object(
                'partnershipId', assignment.partnership_id,
                'partnershipName', assignment.partnership_name
              )
              order by assignment.partnership_name
            )
            from assignment_rows assignment
            where assignment.machine_id = machine.id
          ), '[]'::jsonb)
        )
        order by machine.account_name, machine.location_name, machine.machine_label
      )
      from machine_rows machine
    ), '[]'::jsonb),
    'taxRates',
    coalesce((
      select jsonb_agg(
        jsonb_build_object(
          'id', tax.id,
          'machineId', tax.machine_id,
          'machineLabel', tax.machine_label,
          'taxRatePercent', tax.tax_rate_percent,
          'effectiveStartDate', tax.effective_start_date,
          'effectiveEndDate', tax.effective_end_date,
          'status', tax.status,
          'notes', tax.notes
        )
        order by tax.effective_start_date desc
      )
      from tax_rows tax
    ), '[]'::jsonb),
    'warnings',
    coalesce((select jsonb_agg(warnings.warning) from warnings), '[]'::jsonb)
  )
  into result;

  return coalesce(
    result,
    jsonb_build_object(
      'machines', '[]'::jsonb,
      'taxRates', '[]'::jsonb,
      'warnings', '[]'::jsonb
    )
  );
end;
$$;

create or replace function public.admin_set_reporting_machine_tax_rate(
  p_machine_id uuid,
  p_tax_rate_percent numeric,
  p_effective_start_date date,
  p_reason text
)
returns public.reporting_machine_tax_rates
language plpgsql
security definer
set search_path = public, auth
as $$
declare
  actor_user_id uuid;
  actor_is_super_admin boolean;
  actor_machine_ids uuid[];
  normalized_reason text;
  current_row public.reporting_machine_tax_rates;
  next_row public.reporting_machine_tax_rates;
  after_row public.reporting_machine_tax_rates;
  before_row public.reporting_machine_tax_rates;
  normalized_effective_end_date date;
begin
  actor_user_id := auth.uid();
  actor_is_super_admin := public.is_super_admin(actor_user_id);
  actor_machine_ids := public.scoped_admin_machine_ids(actor_user_id);

  if actor_user_id is null then
    raise exception 'Authentication required';
  end if;

  if not actor_is_super_admin and coalesce(array_length(actor_machine_ids, 1), 0) = 0 then
    raise exception 'Admin access required';
  end if;

  normalized_reason := public.reporting_admin_assert_reason(p_reason);

  if p_machine_id is null or p_tax_rate_percent is null or p_effective_start_date is null then
    raise exception 'Machine, tax rate, and effective start date are required';
  end if;

  if p_tax_rate_percent < 0 or p_tax_rate_percent > 100 then
    raise exception 'Tax rate must be between 0 and 100';
  end if;

  if not exists (select 1 from public.reporting_machines machine where machine.id = p_machine_id) then
    raise exception 'Machine not found';
  end if;

  if not actor_is_super_admin and not (p_machine_id = any(actor_machine_ids)) then
    raise exception 'Scoped admin access does not include this machine';
  end if;

  perform pg_advisory_xact_lock(hashtextextended(p_machine_id::text, 0));

  select *
  into current_row
  from public.reporting_machine_tax_rates tax_rate
  where tax_rate.machine_id = p_machine_id
    and tax_rate.status = 'active'
    and tax_rate.effective_start_date <= p_effective_start_date
    and (
      tax_rate.effective_end_date is null
      or tax_rate.effective_end_date >= p_effective_start_date
    )
  order by tax_rate.effective_start_date desc, tax_rate.created_at desc
  limit 1;

  select *
  into next_row
  from public.reporting_machine_tax_rates tax_rate
  where tax_rate.machine_id = p_machine_id
    and tax_rate.status = 'active'
    and tax_rate.effective_start_date > p_effective_start_date
  order by tax_rate.effective_start_date asc, tax_rate.created_at asc
  limit 1;

  normalized_effective_end_date := case
    when next_row.id is null then null
    else next_row.effective_start_date - 1
  end;

  if normalized_effective_end_date is not null
     and normalized_effective_end_date < p_effective_start_date then
    raise exception 'Tax rate effective date overlaps an existing rate';
  end if;

  if current_row.id is not null
     and current_row.effective_start_date = p_effective_start_date then
    before_row := current_row;

    update public.reporting_machine_tax_rates
    set
      tax_rate_percent = p_tax_rate_percent,
      effective_end_date = normalized_effective_end_date,
      status = 'active',
      notes = null
    where id = current_row.id
    returning * into after_row;
  else
    if current_row.id is not null then
      update public.reporting_machine_tax_rates
      set effective_end_date = p_effective_start_date - 1
      where id = current_row.id
        and current_row.effective_start_date <= p_effective_start_date - 1;
    end if;

    insert into public.reporting_machine_tax_rates (
      machine_id,
      tax_rate_percent,
      effective_start_date,
      effective_end_date,
      status,
      notes,
      created_by
    )
    values (
      p_machine_id,
      p_tax_rate_percent,
      p_effective_start_date,
      normalized_effective_end_date,
      'active',
      null,
      actor_user_id
    )
    returning * into after_row;
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
    case when before_row.id is null then 'reporting_machine_tax_rate.created' else 'reporting_machine_tax_rate.updated' end,
    'reporting_machine_tax_rate',
    after_row.id::text,
    coalesce(to_jsonb(before_row), '{}'::jsonb),
    to_jsonb(after_row),
    jsonb_build_object(
      'reason', normalized_reason,
      'adminFlow', 'simple_machine_tax_rate',
      'actor_authority', case when actor_is_super_admin then 'super_admin' else 'scoped_admin' end
    )
  );

  return after_row;
end;
$$;

comment on function public.admin_get_scoped_machine_tax_setup() is
  'Returns machine reporting tax setup for Super Admins or the current Scoped Admin machine grant.';
comment on function public.admin_set_reporting_machine_tax_rate(uuid, numeric, date, text) is
  'Sets reporting tax rate for Super Admins globally or Scoped Admins inside their current machine grant.';

revoke execute on function public.admin_get_scoped_machine_tax_setup()
  from public, anon;
grant execute on function public.admin_get_scoped_machine_tax_setup()
  to authenticated;
revoke execute on function public.admin_set_reporting_machine_tax_rate(uuid, numeric, date, text)
  from public, anon;
grant execute on function public.admin_set_reporting_machine_tax_rate(uuid, numeric, date, text)
  to authenticated;

select pg_notify('pgrst', 'reload schema');
