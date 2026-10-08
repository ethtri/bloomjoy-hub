-- #1824: these helpers return exactly one amount, not 1,000 rows. Four
-- default estimates multiplied into a 177-trillion-row refund plan for two
-- actual events. Keep all cents/bases/access rules and the eight-second timeout.
alter function private.normalize_financial_amount_cents(bigint,text,numeric,bigint) rows 1;
alter function private.normalize_refund_cents(bigint,bigint,text,numeric,bigint,bigint) rows 1;
alter function private.reporting_retained_original_money(public.machine_sales_facts) rows 1;
alter function private.resolve_reporting_machine_source_tax(uuid,date) rows 1;

create or replace function private.normalize_reporting_treated_amount_cents(
  p_machine_id uuid,p_tender text,p_purchase_date date,p_amount_cents bigint,
  p_amount_basis text,p_tax_rate_percent numeric,p_separate_tax_cents bigint,
  p_preserve_basis boolean
) returns table(recorded_amount_cents bigint,tax_exclusive_amount_cents bigint,
  tax_cents bigint,amount_basis text,normalization_status text,normalization_reason text)
language plpgsql stable security definer rows 1 set search_path='' as $$
declare source_rate numeric;
begin
  select source.rate_percent into source_rate
  from private.resolve_reporting_machine_source_tax(p_machine_id,p_purchase_date) source;
  return query
  select normalized.recorded_amount_cents,normalized.tax_exclusive_amount_cents,
    normalized.tax_cents,normalized.amount_basis,normalized.normalization_status,
    case when p_tender='cash' then 'cash_not_taxed' else normalized.normalization_reason end
  from private.normalize_financial_amount_cents(
    p_amount_cents,
    case when p_tender='cash' or p_amount_cents=0 then 'tax_exclusive'
      when p_tender='card' and p_amount_basis in ('tax_inclusive','unknown','separate_tax')
        and p_separate_tax_cents is not null then 'separate_tax'
      when p_amount_basis in ('tax_inclusive','legacy_percentage_of_gross_estimate')
        and source_rate is null then 'unknown' else p_amount_basis end,
    case when p_tender='cash' then 0 else source_rate end,
    case when p_tender='cash' then null else p_separate_tax_cents end
  ) normalized;
end;
$$;

-- Select the original mutually exclusive branch before normalizing it. SQL
-- UNION wrappers repeatedly planned both branches and multiplied ROWS estimates.
-- NULL source/basis/tender predicates retain the deployed three-valued logic.
create or replace function private.normalize_original_reader_amount_cents(
  p_machine_id uuid,p_tender text,p_purchase_date date,p_amount_cents bigint,
  p_amount_basis text,p_tax_rate_percent numeric,p_separate_tax_cents bigint,
  p_preserve_basis boolean,p_source text,p_reader_id text
) returns table(recorded_amount_cents bigint,tax_exclusive_amount_cents bigint,
  tax_cents bigint,amount_basis text,normalization_status text,normalization_reason text)
language plpgsql stable security definer rows 1 set search_path='' as $$
declare has_history boolean; original_rate numeric;
begin
  select exists(select 1 from private.machine_nayax_reader_associations history
    where history.reporting_machine_id=p_machine_id) into has_history;
  if p_source not in ('nayax_scheduled_report','card_authority_daily') or not has_history then
    return query select * from private.normalize_reporting_treated_amount_cents(
      p_machine_id,p_tender,p_purchase_date,p_amount_cents,p_amount_basis,
      p_tax_rate_percent,p_separate_tax_cents,p_preserve_basis);
  elsif p_source in ('nayax_scheduled_report','card_authority_daily') and has_history then
    select case when evidence.classification='verified_tax' then evidence.rate_percent end
    into original_rate from private.nayax_machine_tax_observations evidence
    where evidence.account_key='TGPACI_USA_DB'
      and evidence.nayax_machine_id=nullif(btrim(p_reader_id),'')
      and evidence.effective_start_date<=p_purchase_date
      and coalesce(evidence.effective_end_date,'infinity'::date)>=p_purchase_date
    order by (evidence.classification<>'unavailable') desc,
      evidence.effective_start_date desc,evidence.observed_at desc,evidence.id limit 1;
    return query select * from private.normalize_financial_amount_cents(p_amount_cents,
      case when p_tender='cash' or p_amount_cents=0 then 'tax_exclusive'
        when p_separate_tax_cents is not null then 'separate_tax'
        when p_amount_basis in ('tax_inclusive','legacy_percentage_of_gross_estimate')
          and original_rate is null then 'unknown' else p_amount_basis end,
      case when p_tender='cash' then 0 else original_rate end,
      case when p_tender='cash' then null else p_separate_tax_cents end);
  end if;
end;
$$;

create or replace function private.normalize_refund_original_reader_amount_cents(
  p_machine_id uuid,p_tender text,p_purchase_date date,p_amount_cents bigint,
  p_amount_basis text,p_tax_rate_percent numeric,p_separate_tax_cents bigint,
  p_preserve_basis boolean
) returns table(recorded_amount_cents bigint,tax_exclusive_amount_cents bigint,
  tax_cents bigint,amount_basis text,normalization_status text,normalization_reason text)
language plpgsql stable security definer rows 1 set search_path='' as $$
declare has_history boolean;
begin
  select exists(select 1 from private.machine_nayax_reader_associations history
    where history.reporting_machine_id=p_machine_id) into has_history;
  if p_tender='cash' or p_amount_basis='tax_exclusive' or p_separate_tax_cents is not null or not has_history then
    return query select * from private.normalize_reporting_treated_amount_cents(
      p_machine_id,p_tender,p_purchase_date,p_amount_cents,p_amount_basis,
      p_tax_rate_percent,p_separate_tax_cents,p_preserve_basis);
  elsif p_tender<>'cash' and p_amount_basis is distinct from 'tax_exclusive'
    and p_separate_tax_cents is null and has_history then
    return query select * from private.normalize_financial_amount_cents(p_amount_cents,
      case when p_amount_cents=0 then 'tax_exclusive' else 'unknown' end,null,null);
  end if;
end;
$$;

-- A scalar JSON response computes the report once and is not cut off by
-- PostgREST's set-returning max_rows. Existing readers own authorization,
-- company intersection, rollout selection and all financial calculations.
create function public.get_sales_report_complete(
  p_date_from date,p_date_to date,p_grain text default 'week',
  p_machine_ids uuid[] default null,p_location_ids uuid[] default null,
  p_payment_methods text[] default null,p_company_id uuid default null
) returns jsonb language plpgsql stable security definer set search_path='' as $$
declare result jsonb;
begin
  if auth.uid() is null then
    raise exception 'Authentication required' using errcode='42501';
  end if;
  if p_company_id is null then
    select coalesce(jsonb_agg(to_jsonb(report)),'[]'::jsonb) into result
    from public.get_sales_report(p_date_from,p_date_to,p_grain,p_machine_ids,p_location_ids,p_payment_methods) report;
  else
    select coalesce(jsonb_agg(to_jsonb(report)),'[]'::jsonb) into result
    from public.get_company_sales_report(p_company_id,p_date_from,p_date_to,p_grain,p_machine_ids,p_location_ids,p_payment_methods) report;
  end if;
  return result;
end;
$$;
revoke all on function public.get_sales_report_complete(date,date,text,uuid[],uuid[],text[],uuid)
  from public,anon;
grant execute on function public.get_sales_report_complete(date,date,text,uuid[],uuid[],text[],uuid)
  to authenticated,service_role;
create function public.sales_report_scheduler_get_sales_report_complete(
  p_actor_user_id uuid,p_date_from date,p_date_to date,p_grain text default 'week',
  p_machine_ids uuid[] default null,p_location_ids uuid[] default null,
  p_payment_methods text[] default null
) returns jsonb language sql stable security definer set search_path='' as $$
  select coalesce(jsonb_agg(to_jsonb(report)),'[]'::jsonb)
  from public.sales_report_scheduler_get_sales_report(
    p_actor_user_id,p_date_from,p_date_to,p_grain,p_machine_ids,p_location_ids,p_payment_methods
  ) report;
$$;
revoke all on function public.sales_report_scheduler_get_sales_report_complete(uuid,date,date,text,uuid[],uuid[],text[])
  from public,anon,authenticated;
grant execute on function public.sales_report_scheduler_get_sales_report_complete(uuid,date,date,text,uuid[],uuid[],text[])
  to service_role;
select pg_notify('pgrst','reload schema');
