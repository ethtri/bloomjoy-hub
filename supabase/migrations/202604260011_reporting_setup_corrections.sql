-- Reporting setup corrections:
-- - simple machine tax change RPC for the Machines admin page
-- - production-safe backfill for initial documented tax rates

create or replace function public.admin_set_reporting_machine_tax_rate(
  p_machine_id uuid,
  p_tax_rate_percent numeric,
  p_effective_start_date date,
  p_reason text
)
returns public.reporting_machine_tax_rates
language plpgsql
security definer
set search_path = public
as $$
declare
  normalized_reason text;
  current_row public.reporting_machine_tax_rates;
  next_row public.reporting_machine_tax_rates;
  after_row public.reporting_machine_tax_rates;
  before_row public.reporting_machine_tax_rates;
  normalized_effective_end_date date;
begin
  if not public.is_super_admin(auth.uid()) then
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
      auth.uid()
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
    auth.uid(),
    case when before_row.id is null then 'reporting_machine_tax_rate.created' else 'reporting_machine_tax_rate.updated' end,
    'reporting_machine_tax_rate',
    after_row.id::text,
    coalesce(to_jsonb(before_row), '{}'::jsonb),
    to_jsonb(after_row),
    jsonb_build_object('reason', normalized_reason, 'adminFlow', 'simple_machine_tax_rate')
  );

  return after_row;
end;
$$;

grant execute on function public.admin_set_reporting_machine_tax_rate(uuid, numeric, date, text)
  to authenticated;

with earliest_active_tax_rate as (
  select distinct on (tax_rate.machine_id)
    tax_rate.id,
    tax_rate.machine_id,
    tax_rate.effective_start_date
  from public.reporting_machine_tax_rates tax_rate
  where tax_rate.status = 'active'
  order by tax_rate.machine_id, tax_rate.effective_start_date asc, tax_rate.created_at asc
),
eligible_backdate as (
  select earliest.id
  from earliest_active_tax_rate earliest
  where earliest.effective_start_date > date '2026-01-01'
    and not exists (
      select 1
      from public.reporting_machine_tax_rates prior
      where prior.machine_id = earliest.machine_id
        and prior.id <> earliest.id
        and prior.effective_start_date < earliest.effective_start_date
    )
    and not exists (
      select 1
      from public.reporting_machine_tax_rates overlap
      where overlap.machine_id = earliest.machine_id
        and overlap.id <> earliest.id
        and overlap.status = 'active'
        and public.reporting_date_windows_overlap(
          overlap.effective_start_date,
          overlap.effective_end_date,
          date '2026-01-01',
          earliest.effective_start_date - 1
        )
    )
)
update public.reporting_machine_tax_rates tax_rate
set
  effective_start_date = date '2026-01-01',
  notes = coalesce(tax_rate.notes, 'Initial documented reporting tax rate backdated to 2026-01-01 for historical report previews.')
from eligible_backdate
where tax_rate.id = eligible_backdate.id;
