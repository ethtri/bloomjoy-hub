-- #1351: server-owned Sunze cash coverage and match-state contract.
-- Existing reporting facts remain compatible. Only imports whose Payment time
-- basis is independently validated may advance a refund-verification watermark.

create table public.sunze_cash_source_watermarks (
  reporting_machine_id uuid not null
    references public.reporting_machines (id) on delete cascade,
  source_type text not null default 'sunze_orders'
    check (source_type = 'sunze_orders'),
  coverage_started_at timestamptz not null,
  covered_through timestamptz not null,
  last_successful_import_at timestamptz not null,
  freshness_expires_at timestamptz not null,
  payment_time_basis text not null
    check (payment_time_basis = 'validated_iana_timezone'),
  payment_time_timezone text not null check (length(btrim(payment_time_timezone)) > 0),
  timestamp_proof_scope text not null check (timestamp_proof_scope = 'account'),
  import_run_id uuid not null references public.sales_import_runs (id) on delete restrict,
  updated_at timestamptz not null default now(),
  constraint sunze_cash_source_watermarks_coverage_order check (
    coverage_started_at <= covered_through
  ),
  constraint sunze_cash_source_watermarks_freshness_order check (
    last_successful_import_at <= freshness_expires_at
  ),
  primary key (reporting_machine_id, import_run_id)
);

create index sunze_cash_source_watermarks_readiness_idx
  on public.sunze_cash_source_watermarks
  (reporting_machine_id, last_successful_import_at desc, covered_through desc);

alter table public.sunze_cash_source_watermarks enable row level security;
revoke all on table public.sunze_cash_source_watermarks from public, anon, authenticated;
grant select, insert, update on table public.sunze_cash_source_watermarks to service_role;

comment on table public.sunze_cash_source_watermarks is
  'Private per-machine proof that a validated Sunze Orders import completely covered a payment-time interval. Raw source identities and rows are never exposed.';

create view public.sunze_cash_source_readiness
with (security_invoker = true)
as
select
  machine.id as reporting_machine_id,
  case when nullif(btrim(coalesce(machine.sunze_machine_id, '')), '') is null
    then 'unmapped' else 'mapped' end as source_identity_state,
  'sunze_orders'::text as source_type,
  latest.covered_through as latest_covered_payment_time,
  latest.last_successful_import_at,
  coalesce(latest.payment_time_basis, 'unvalidated') as payment_time_basis,
  latest.payment_time_timezone,
  coalesce(latest.timestamp_proof_scope, 'unvalidated') as timestamp_proof_scope,
  (
    machine.status = 'active'
    and machine.refund_intake_enabled
    and machine.machine_type in ('commercial', 'mini')
    and nullif(btrim(coalesce(machine.sunze_machine_id, '')), '') is not null
    and latest.freshness_expires_at > statement_timestamp()
    and latest.payment_time_basis = 'validated_iana_timezone'
    and latest.timestamp_proof_scope = 'account'
  ) as cash_matching_supported
from public.reporting_machines machine
left join lateral (
  select source.*
  from public.sunze_cash_source_watermarks source
  where source.reporting_machine_id = machine.id
  order by source.last_successful_import_at desc, source.covered_through desc
  limit 1
) latest on true
where machine.refund_intake_enabled;

revoke all on table public.sunze_cash_source_readiness from public, anon, authenticated;
grant select on table public.sunze_cash_source_readiness to service_role;

comment on view public.sunze_cash_source_readiness is
  'Service-only deterministic readiness row for every refund-intake-enabled machine; contains no raw vendor identity.';

alter table public.refund_cases
  add column cash_match_state text;

alter table public.refund_cases
  add constraint refund_cases_cash_match_state_check check (
    cash_match_state is null or cash_match_state in (
      'checking_sales_history',
      'sale_found',
      'multiple_possible_sales',
      'no_sale_found_with_complete_coverage',
      'sales_history_unavailable'
    )
  );

comment on column public.refund_cases.cash_match_state is
  'Server-owned Sunze cash verification state. NULL for pre-contract/card cases; no historical case is rewritten.';

create index if not exists machine_sales_facts_sunze_cash_match_idx
  on public.machine_sales_facts (reporting_machine_id, payment_time)
  include (net_sales_cents, import_run_id)
  where source = 'sunze_browser' and payment_method = 'cash';

create unique index refund_cases_selected_sunze_sale_unique_idx
  on public.refund_cases (matched_sales_fact_id)
  where payment_method = 'cash'
    and matched_sales_fact_id is not null
    and duplicate_of_refund_case_id is null;

create or replace function public.service_record_sunze_cash_watermarks(
  p_import_run_id uuid,
  p_machine_codes text[],
  p_coverage_started_at timestamptz,
  p_covered_through timestamptz,
  p_last_successful_import_at timestamptz,
  p_freshness_hours numeric,
  p_payment_time_timezone text,
  p_timestamp_proof_scope text
)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  affected integer := 0;
begin
  if p_import_run_id is null
    or coalesce(array_length(p_machine_codes, 1), 0) = 0
    or p_coverage_started_at is null
    or p_covered_through is null
    or p_last_successful_import_at is null
    or p_freshness_hours is null
    or p_freshness_hours <= 0
    or nullif(btrim(coalesce(p_payment_time_timezone, '')), '') is null
    or p_timestamp_proof_scope <> 'account' then
    raise exception 'Complete validated Sunze watermark evidence is required';
  end if;

  if not exists (
    select 1
    from public.sales_import_runs run
    where run.id = p_import_run_id
      and run.source = 'sunze_browser'
      and run.status = 'completed'
      and run.meta ->> 'payment_time_semantics_status' = 'validated'
      and run.meta ->> 'payment_time_timezone' = p_payment_time_timezone
      and run.meta ->> 'timestamp_proof_scope' = 'account'
      and coalesce((run.meta ->> 'machine_coverage_verified')::boolean, false)
      and not coalesce((run.meta ->> 'visible_machine_count_mismatch')::boolean, false)
  ) then
    raise exception 'Sunze import does not prove validated complete coverage';
  end if;

  insert into public.sunze_cash_source_watermarks as target (
    reporting_machine_id, coverage_started_at, covered_through,
    last_successful_import_at, freshness_expires_at,
    payment_time_basis, payment_time_timezone, timestamp_proof_scope,
    import_run_id, updated_at
  )
  select
    machine.id,
    p_coverage_started_at,
    p_covered_through,
    p_last_successful_import_at,
    p_last_successful_import_at + make_interval(hours => p_freshness_hours::integer),
    'validated_iana_timezone',
    p_payment_time_timezone,
    p_timestamp_proof_scope,
    p_import_run_id,
    statement_timestamp()
  from public.reporting_machines machine
  where exists (
      select 1
      from unnest(p_machine_codes) source_code
      where lower(source_code) = lower(machine.sunze_machine_id)
    )
    and machine.status = 'active'
    and machine.refund_intake_enabled
    and machine.machine_type in ('commercial', 'mini')
  on conflict (reporting_machine_id, import_run_id) do update
  set coverage_started_at = excluded.coverage_started_at,
      covered_through = excluded.covered_through,
      last_successful_import_at = excluded.last_successful_import_at,
      freshness_expires_at = excluded.freshness_expires_at,
      payment_time_basis = excluded.payment_time_basis,
      payment_time_timezone = excluded.payment_time_timezone,
      timestamp_proof_scope = excluded.timestamp_proof_scope,
      import_run_id = excluded.import_run_id,
      updated_at = excluded.updated_at;

  get diagnostics affected = row_count;
  return affected;
end;
$$;

revoke all on function public.service_record_sunze_cash_watermarks(
  uuid, text[], timestamptz, timestamptz, timestamptz, numeric, text, text
) from public, anon, authenticated;
grant execute on function public.service_record_sunze_cash_watermarks(
  uuid, text[], timestamptz, timestamptz, timestamptz, numeric, text, text
) to service_role;

create or replace function public.service_match_sunze_cash_sale(
  p_reporting_machine_id uuid,
  p_purchase_time timestamptz,
  p_amount_cents integer default null,
  p_now timestamptz default statement_timestamp()
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  machine_row public.reporting_machines%rowtype;
  watermark public.sunze_cash_source_watermarks%rowtype;
  latest_watermark public.sunze_cash_source_watermarks%rowtype;
  candidate_ids uuid[];
  reason text;
begin
  select * into machine_row
  from public.reporting_machines machine
  where machine.id = p_reporting_machine_id;

  if not found or machine_row.status <> 'active' or not machine_row.refund_intake_enabled then
    reason := 'refund_machine_unavailable';
  elsif machine_row.machine_type not in ('commercial', 'mini') then
    reason := 'cash_source_unsupported';
  elsif nullif(btrim(coalesce(machine_row.sunze_machine_id, '')), '') is null then
    reason := 'cash_source_unmapped';
  else
    select * into watermark
    from public.sunze_cash_source_watermarks source
    where source.reporting_machine_id = p_reporting_machine_id
      and source.freshness_expires_at > p_now
      and source.payment_time_basis = 'validated_iana_timezone'
      and source.timestamp_proof_scope = 'account'
      and source.coverage_started_at <= p_purchase_time - interval '1 hour'
      and source.covered_through >= p_purchase_time + interval '1 hour'
    order by source.last_successful_import_at desc
    limit 1;

    if found then
      reason := null;
    else
      select * into latest_watermark
      from public.sunze_cash_source_watermarks source
      where source.reporting_machine_id = p_reporting_machine_id
      order by source.last_successful_import_at desc, source.covered_through desc
      limit 1;

      if not found then
        reason := 'validated_source_watermark_missing';
      elsif latest_watermark.payment_time_basis <> 'validated_iana_timezone'
        or latest_watermark.timestamp_proof_scope <> 'account' then
        reason := 'timestamp_semantics_unvalidated';
      elsif latest_watermark.freshness_expires_at <= p_now then
        reason := 'sales_history_stale';
      elsif p_purchase_time + interval '1 hour' > latest_watermark.covered_through then
        return jsonb_build_object(
          'state', 'checking_sales_history',
          'reason', 'awaiting_source_watermark',
          'sourceType', 'sunze_orders',
          'matchedSalesFactId', null,
          'candidateCount', 0
        );
      else
        reason := 'purchase_window_not_completely_covered';
      end if;
    end if;
  end if;

  if reason is not null then
    return jsonb_build_object(
      'state', 'sales_history_unavailable',
      'reason', reason,
      'sourceType', 'sunze_orders',
      'matchedSalesFactId', null,
      'candidateCount', 0
    );
  end if;

  select coalesce(array_agg(candidate.id order by candidate.payment_time, candidate.id), '{}'::uuid[])
  into candidate_ids
  from (
    select fact.id, fact.payment_time
    from public.machine_sales_facts fact
    join public.sales_import_runs run on run.id = fact.import_run_id
    where fact.reporting_machine_id = p_reporting_machine_id
      and fact.source = 'sunze_browser'
      and fact.payment_method = 'cash'
      and fact.payment_time between p_purchase_time - interval '1 hour'
                                and p_purchase_time + interval '1 hour'
      and run.status = 'completed'
      and run.meta ->> 'payment_time_semantics_status' = 'validated'
      and run.meta ->> 'payment_time_timezone' = watermark.payment_time_timezone
      and run.meta ->> 'timestamp_proof_scope' = 'account'
    order by fact.payment_time, fact.id
    limit 4
  ) candidate;

  if cardinality(candidate_ids) = 1 then
    return jsonb_build_object(
      'state', 'sale_found', 'reason', null, 'sourceType', 'sunze_orders',
      'matchedSalesFactId', candidate_ids[1], 'candidateCount', 1
    );
  elsif cardinality(candidate_ids) > 1 then
    return jsonb_build_object(
      'state', 'multiple_possible_sales', 'reason', null, 'sourceType', 'sunze_orders',
      'matchedSalesFactId', null, 'candidateCount', cardinality(candidate_ids)
    );
  end if;

  return jsonb_build_object(
    'state', 'no_sale_found_with_complete_coverage', 'reason', null,
    'sourceType', 'sunze_orders', 'matchedSalesFactId', null, 'candidateCount', 0
  );
end;
$$;

revoke all on function public.service_match_sunze_cash_sale(uuid, timestamptz, integer, timestamptz)
  from public, anon, authenticated;
grant execute on function public.service_match_sunze_cash_sale(uuid, timestamptz, integer, timestamptz)
  to service_role;

comment on function public.service_match_sunze_cash_sale(uuid, timestamptz, integer, timestamptz) is
  'Private deterministic Sunze cash evidence contract. Amount is advisory, and complete-no-match is impossible without mapped, fresh, validated coverage spanning the full lookup window.';
