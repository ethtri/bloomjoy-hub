-- Explicit reporting input treatment, separate from statutory tax rates.
-- No existing machine, rate, source fact, refund, or issued snapshot is changed.
create table public.reporting_machine_tax_treatments (
  id uuid primary key default gen_random_uuid(),
  machine_id uuid not null references public.reporting_machines(id) on delete cascade,
  tender text not null check (tender in ('card', 'cash')),
  amount_basis text not null default 'source_default'
    check (amount_basis in ('source_default', 'tax_inclusive', 'tax_exclusive')),
  taxable_portion_percent numeric not null default 100
    check (taxable_portion_percent >= 0 and taxable_portion_percent <= 100),
  effective_start_date date not null,
  effective_end_date date,
  created_at timestamptz not null default now(),
  created_by uuid references auth.users(id) on delete set null,
  constraint reporting_machine_tax_treatments_valid_window
    check (effective_end_date is null or effective_end_date >= effective_start_date),
  unique (machine_id, tender, effective_start_date)
);
create index reporting_machine_tax_treatments_effective_idx
  on public.reporting_machine_tax_treatments(machine_id, tender, effective_start_date desc);
alter table public.reporting_machine_tax_treatments enable row level security;
revoke all on public.reporting_machine_tax_treatments from public, anon, authenticated;
-- Reads/writes run only through the same checked authority as machine tax rates.

create function public.admin_get_reporting_machine_tax_treatments()
returns jsonb language plpgsql stable security definer set search_path = ''
as $$
declare
  actor uuid := auth.uid();
  super_admin boolean := public.is_super_admin(actor);
  machine_ids uuid[] := public.scoped_admin_machine_ids(actor);
begin
  if actor is null then
    raise exception 'Authentication required';
  end if;
  if not super_admin and coalesce(cardinality(machine_ids), 0) = 0 then
    raise exception 'Admin access required';
  end if;
  return coalesce((select jsonb_agg(to_jsonb(treatment)
    order by treatment.effective_start_date desc, treatment.tender, treatment.id)
    from public.reporting_machine_tax_treatments treatment
    where super_admin or treatment.machine_id = any(machine_ids)), '[]'::jsonb);
end;
$$;

create function public.admin_set_reporting_machine_tax_treatment(
  p_machine_id uuid, p_tender text, p_amount_basis text,
  p_taxable_portion_percent numeric, p_effective_start_date date, p_reason text
)
returns public.reporting_machine_tax_treatments
language plpgsql security definer set search_path = ''
as $$
declare
  actor uuid := auth.uid();
  super_admin boolean := public.is_super_admin(actor);
  machine_ids uuid[] := public.scoped_admin_machine_ids(actor);
  reason text;
  current_row public.reporting_machine_tax_treatments;
  next_date date;
  after_row public.reporting_machine_tax_treatments;
begin
  if actor is null then raise exception 'Authentication required'; end if;
  if not super_admin and coalesce(cardinality(machine_ids), 0) = 0 then
    raise exception 'Admin access required';
  end if;
  if not super_admin and not coalesce(p_machine_id = any(machine_ids), false) then
    raise exception 'Scoped admin access does not include this machine';
  end if;
  reason := public.reporting_admin_assert_reason(p_reason);
  if p_machine_id is null or p_effective_start_date is null
    or p_tender is null or p_tender not in ('card', 'cash')
    or p_amount_basis is null or p_amount_basis not in (
      'source_default', 'tax_inclusive', 'tax_exclusive'
    ) or p_taxable_portion_percent is null
    or not (p_taxable_portion_percent between 0 and 100) then
    raise exception 'Valid machine, tender, amount basis, taxable portion, and effective date are required'
      using errcode = '22023';
  end if;
  if not exists (select 1 from public.reporting_machines where id = p_machine_id) then
    raise exception 'Machine not found';
  end if;
  -- Use the existing rate RPC's machine lock so atomic rate/treatment saves serialize.
  perform pg_advisory_xact_lock(hashtextextended(p_machine_id::text, 0));
  select * into current_row from public.reporting_machine_tax_treatments treatment
  where treatment.machine_id = p_machine_id and treatment.tender = p_tender
    and treatment.effective_start_date <= p_effective_start_date
    and coalesce(treatment.effective_end_date, 'infinity'::date) >= p_effective_start_date
  order by treatment.effective_start_date desc limit 1;
  select min(treatment.effective_start_date) into next_date
  from public.reporting_machine_tax_treatments treatment
  where treatment.machine_id = p_machine_id and treatment.tender = p_tender
    and treatment.effective_start_date > p_effective_start_date;

  if current_row.effective_start_date = p_effective_start_date then
    update public.reporting_machine_tax_treatments set amount_basis = p_amount_basis,
      taxable_portion_percent = p_taxable_portion_percent,
      effective_end_date = next_date - 1
    where id = current_row.id returning * into after_row;
  else
    if current_row.id is not null then
      update public.reporting_machine_tax_treatments
      set effective_end_date = p_effective_start_date - 1 where id = current_row.id;
    end if;
    insert into public.reporting_machine_tax_treatments(
      machine_id, tender, amount_basis, taxable_portion_percent,
      effective_start_date, effective_end_date, created_by
    ) values (p_machine_id, p_tender, p_amount_basis, p_taxable_portion_percent,
      p_effective_start_date, next_date - 1, actor) returning * into after_row;
  end if;
  insert into public.admin_audit_log(actor_user_id, action, entity_type, entity_id,
    before, after, meta) values (actor,
    case when current_row.effective_start_date = p_effective_start_date
      then 'reporting_machine_tax_treatment.updated' else 'reporting_machine_tax_treatment.created' end,
    'reporting_machine_tax_treatment', after_row.id::text,
    coalesce(to_jsonb(current_row), '{}'::jsonb), to_jsonb(after_row),
    jsonb_build_object('reason', reason, 'actor_authority',
      case when super_admin then 'super_admin' else 'scoped_admin' end));
  return after_row;
end;
$$;

create function public.admin_set_reporting_machine_tax_configuration(
  p_machine_id uuid, p_tax_rate_percent numeric, p_effective_start_date date, p_reason text,
  p_card_amount_basis text, p_card_taxable_portion_percent numeric,
  p_cash_amount_basis text, p_cash_taxable_portion_percent numeric
)
returns jsonb language plpgsql security invoker set search_path = ''
as $$
declare
  rate_row public.reporting_machine_tax_rates;
  card_row public.reporting_machine_tax_treatments;
  cash_row public.reporting_machine_tax_treatments;
begin
  rate_row := public.admin_set_reporting_machine_tax_rate(
    p_machine_id, p_tax_rate_percent, p_effective_start_date, p_reason);
  card_row := public.admin_set_reporting_machine_tax_treatment(
    p_machine_id, 'card', p_card_amount_basis, p_card_taxable_portion_percent,
    p_effective_start_date, p_reason);
  cash_row := public.admin_set_reporting_machine_tax_treatment(
    p_machine_id, 'cash', p_cash_amount_basis, p_cash_taxable_portion_percent,
    p_effective_start_date, p_reason);
  return jsonb_build_object('taxRate', to_jsonb(rate_row),
    'treatments', jsonb_build_array(to_jsonb(card_row), to_jsonb(cash_row)));
end;
$$;

revoke all on function public.admin_get_reporting_machine_tax_treatments() from public, anon;
revoke all on function public.admin_set_reporting_machine_tax_treatment(uuid, text, text, numeric, date, text)
  from public, anon;
revoke all on function public.admin_set_reporting_machine_tax_configuration(uuid, numeric, date, text, text, numeric, text, numeric)
  from public, anon;
grant execute on function public.admin_get_reporting_machine_tax_treatments() to authenticated;
grant execute on function public.admin_set_reporting_machine_tax_treatment(uuid, text, text, numeric, date, text)
  to authenticated;
grant execute on function public.admin_set_reporting_machine_tax_configuration(uuid, numeric, date, text, text, numeric, text, numeric)
  to authenticated;

-- Taxable portion is a percentage of tax-exclusive purchase value. For a blended
-- inclusive total, effective rate = statutory rate * taxable portion / 100.
-- Refunds retain their own proved amount basis; a source report that excludes tax
-- does not mean the customer's separately recorded charge/refund excludes tax.
create function private.normalize_reporting_treated_amount_cents(
  p_machine_id uuid, p_tender text, p_purchase_date date,
  p_amount_cents bigint, p_amount_basis text, p_tax_rate_percent numeric,
  p_separate_tax_cents bigint, p_preserve_basis boolean
)
returns table(recorded_amount_cents bigint, tax_exclusive_amount_cents bigint,
  tax_cents bigint, amount_basis text, normalization_status text, normalization_reason text)
language sql stable security definer set search_path = ''
as $$
  select normalized.*
  from (select 1) singleton
  left join lateral (
    select treatment.amount_basis, treatment.taxable_portion_percent
    from public.reporting_machine_tax_treatments treatment
    where treatment.machine_id = p_machine_id and treatment.tender = p_tender
      and treatment.effective_start_date <= p_purchase_date
      and coalesce(treatment.effective_end_date, 'infinity'::date) >= p_purchase_date
    order by treatment.effective_start_date desc limit 1
  ) treatment on true
  cross join lateral private.normalize_financial_amount_cents(
    p_amount_cents,
    case when not p_preserve_basis and treatment.amount_basis <> 'source_default'
      then treatment.amount_basis else p_amount_basis end,
    case when treatment.taxable_portion_percent = 0 then 0
      else p_tax_rate_percent * coalesce(treatment.taxable_portion_percent, 100) / 100 end,
    p_separate_tax_cents
  ) normalized;
$$;
revoke all on function private.normalize_reporting_treated_amount_cents(uuid, text, date, bigint, text, numeric, bigint, boolean)
  from public, anon, authenticated;
grant execute on function private.normalize_reporting_treated_amount_cents(uuid, text, date, bigint, text, numeric, bigint, boolean)
  to service_role;


-- Patch the current composed canonical function, retaining later gift-card and
-- free/no-pay exclusions. Resolve effective sales basis BEFORE grouping so source
-- provenance never splits the existing daily rounding scope. Every replacement
-- fails closed if its boundary changed.
do $migration$
declare
  definition text;
  patch record;
begin
  definition := replace(pg_get_functiondef(
    'private.machine_sales_daily_components(uuid,date,date)'::regprocedure), E'\r\n', E'\n');
  for patch in select * from (values
    ($old$        when fact.source = 'sunze_browser' then 'tax_exclusive'$old$, $new$        when treatment.amount_basis <> 'source_default' then treatment.amount_basis
        when fact.source = 'sunze_browser' then 'tax_exclusive'$new$, 1),
    ($old$    ) tax_rate on true
    where fact.reporting_machine_id = p_reporting_machine_id$old$, $new$    ) tax_rate on true
    left join lateral (
      select configured.amount_basis
      from public.reporting_machine_tax_treatments configured
      where configured.machine_id = fact.reporting_machine_id
        and configured.tender = case fact.payment_method
          when 'credit' then 'card' when 'cash' then 'cash' else 'unknown' end
        and configured.effective_start_date <= fact.sale_date
        and coalesce(configured.effective_end_date, 'infinity'::date) >= fact.sale_date
      order by configured.effective_start_date desc limit 1
    ) treatment on true
    where fact.reporting_machine_id = p_reporting_machine_id$new$, 1),
    ($old$private.normalize_financial_amount_cents(
      grouped.recorded_cents,$old$, $new$private.normalize_reporting_treated_amount_cents(
      grouped.reporting_machine_id, grouped.tender, grouped.sale_date,
      grouped.recorded_cents,$new$, 1),
    ($old$then grouped.separate_tax_cents else null end
    ) normalized$old$, $new$then grouped.separate_tax_cents else null end,
      true
    ) normalized$new$, 1),
    ($old$private.normalize_financial_amount_cents(
      event.recognized_target_before_cents,$old$, $new$private.normalize_reporting_treated_amount_cents(
      event.reporting_machine_id, event.tender, event.purchase_attribution_date,
      event.recognized_target_before_cents,$new$, 1),
    ($old$event.tax_rate_percent,
      null
    ) before_amount$old$, $new$event.tax_rate_percent,
      null, true
    ) before_amount$new$, 1),
    ($old$private.normalize_financial_amount_cents(
      event.recognized_target_after_cents,$old$, $new$private.normalize_reporting_treated_amount_cents(
      event.reporting_machine_id, event.tender, event.purchase_attribution_date,
      event.recognized_target_after_cents,$new$, 1),
    ($old$event.tax_rate_percent,
      null
    ) after_amount$old$, $new$event.tax_rate_percent,
      null, true
    ) after_amount$new$, 1),
    ($old$private.normalize_financial_amount_cents(
      event.paid_cumulative_cents,$old$, $new$private.normalize_reporting_treated_amount_cents(
      event.reporting_machine_id, event.tender, event.purchase_attribution_date,
      event.paid_cumulative_cents,$new$, 1),
    ($old$event.tax_rate_percent,
      null
    ) paid_amount$old$, $new$event.tax_rate_percent,
      null, true
    ) paid_amount$new$, 1),
    ($old$private.normalize_financial_amount_cents(
      private.refund_gift_card_resolved_purchase_cents(event.refund_case_id, p_date_to),$old$, $new$private.normalize_reporting_treated_amount_cents(
      event.reporting_machine_id, event.tender, event.purchase_attribution_date,
      private.refund_gift_card_resolved_purchase_cents(event.refund_case_id, p_date_to),$new$, 1),
    ($old$event.tax_rate_percent,
      null
    ) gift_card_amount$old$, $new$event.tax_rate_percent,
      null, true
    ) gift_card_amount$new$, 1),
    ($old$private.normalize_financial_amount_cents(
      adjustment.amount_cents,$old$, $new$private.normalize_reporting_treated_amount_cents(
      adjustment.reporting_machine_id,
      case when adjustment.source = 'nayax_provider_refund' then 'card'
        when event.tender is not null then event.tender
        when linked_case.payment_method in ('cash', 'card') then linked_case.payment_method
        when lower(coalesce(adjustment.raw_payload ->> 'payment_method', '')) in ('card', 'credit') then 'card'
        when lower(coalesce(adjustment.raw_payload ->> 'payment_method', '')) = 'cash' then 'cash'
        else 'unknown' end,
      coalesce(event.purchase_attribution_date, matched_fact.sale_date,
        case when linked_location.timezone is not null
          then (linked_case.incident_at at time zone linked_location.timezone)::date end),
      adjustment.amount_cents,$new$, 1),
    ($old$tax_rate.tax_rate_percent,
      null
    ) normalized$old$, $new$tax_rate.tax_rate_percent,
      null, true
    ) normalized$new$, 1)
  ) patches(original, replacement, expected_count) loop
    if cardinality(string_to_array(definition, patch.original)) <> patch.expected_count + 1 then
      raise exception 'Unexpected shared tax-treatment boundary: %', patch.original;
    end if;
    definition := replace(definition, patch.original, patch.replacement);
  end loop;
  execute definition;
end;
$migration$;

select pg_notify('pgrst', 'reload schema');
