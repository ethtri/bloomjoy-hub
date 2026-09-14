-- #1352: durable, replay-safe Sunze cash correlation evidence.
--
-- This contract is deliberately advisory. It records and explains plausible
-- sales, but it cannot approve, deny, pay, complete, or contact a customer.

create table public.refund_sunze_cash_correlation_attempts (
  id uuid primary key default gen_random_uuid(),
  refund_case_id uuid not null references public.refund_cases (id) on delete cascade,
  policy_version text not null check (policy_version = 'sunze_cash_correlation_v1'),
  case_fact_version bigint not null check (case_fact_version >= 1),
  source_snapshot_key text not null check (length(source_snapshot_key) between 1 and 160),
  source_import_run_id uuid references public.sales_import_runs (id) on delete set null,
  trigger_import_run_id uuid references public.sales_import_runs (id) on delete set null,
  trigger_reason text not null check (trigger_reason in (
    'intake', 'completed_import', 'corrected_case_facts', 'backfill', 'reconciliation'
  )),
  match_state text not null check (match_state in (
    'checking_sales_history', 'sale_found', 'multiple_possible_sales',
    'no_sale_found_with_complete_coverage', 'sales_history_unavailable'
  )),
  reason_code text,
  candidate_count integer not null check (candidate_count >= 0),
  coverage_started_at timestamptz,
  covered_through timestamptz,
  evaluated_at timestamptz not null default statement_timestamp(),
  invalidated_at timestamptz,
  invalidation_reason text check (invalidation_reason is null or invalidation_reason = 'selected_sale_released'),
  constraint refund_sunze_cash_attempts_invalidation_shape check (
    (invalidated_at is null and invalidation_reason is null)
    or (invalidated_at is not null and invalidation_reason is not null)
  ),
  unique (refund_case_id, case_fact_version, policy_version, source_snapshot_key)
);

create index refund_sunze_cash_attempts_case_evaluated_idx
  on public.refund_sunze_cash_correlation_attempts (refund_case_id, evaluated_at desc);

create table public.refund_sunze_cash_correlation_candidates (
  attempt_id uuid not null references public.refund_sunze_cash_correlation_attempts (id) on delete cascade,
  sales_fact_id uuid not null references public.machine_sales_facts (id) on delete restrict,
  deterministic_rank integer not null check (deterministic_rank >= 1),
  payment_time timestamptz not null,
  amount_cents integer not null check (amount_cents >= 0),
  time_delta_seconds integer not null check (time_delta_seconds >= 0),
  amount_delta_cents integer,
  evidence_codes text[] not null default '{}'::text[],
  selection_conflict boolean not null default false,
  primary key (attempt_id, sales_fact_id),
  unique (attempt_id, deterministic_rank)
);

create index refund_sunze_cash_candidates_sale_idx
  on public.refund_sunze_cash_correlation_candidates (sales_fact_id, attempt_id);

create table public.refund_sunze_cash_sale_links (
  id uuid primary key default gen_random_uuid(),
  refund_case_id uuid not null references public.refund_cases (id) on delete cascade,
  sales_fact_id uuid not null references public.machine_sales_facts (id) on delete restrict,
  correlation_attempt_id uuid not null
    references public.refund_sunze_cash_correlation_attempts (id) on delete restrict,
  case_fact_version bigint not null check (case_fact_version >= 1),
  link_version bigint not null default 1 check (link_version >= 1),
  link_origin text not null check (link_origin in ('system_single_candidate', 'reviewed')),
  linked_at timestamptz not null default statement_timestamp(),
  released_at timestamptz,
  release_reason text check (release_reason in (
    'corrected_case_facts', 'wrong_sale', 'duplicate_reconciliation', 'source_reconciliation'
  )),
  release_note text check (release_note is null or length(release_note) <= 500),
  released_by uuid references auth.users (id) on delete restrict,
  constraint refund_sunze_cash_sale_links_release_shape check (
    (released_at is null and release_reason is null and release_note is null and released_by is null)
    or (released_at is not null and release_reason is not null and released_by is not null)
  )
);

create unique index refund_sunze_cash_sale_links_active_sale_unique_idx
  on public.refund_sunze_cash_sale_links (sales_fact_id)
  where released_at is null;

create unique index refund_sunze_cash_sale_links_active_case_unique_idx
  on public.refund_sunze_cash_sale_links (refund_case_id)
  where released_at is null;

alter table public.refund_sunze_cash_correlation_attempts enable row level security;
alter table public.refund_sunze_cash_correlation_candidates enable row level security;
alter table public.refund_sunze_cash_sale_links enable row level security;

revoke all on table public.refund_sunze_cash_correlation_attempts from public, anon, authenticated;
revoke all on table public.refund_sunze_cash_correlation_candidates from public, anon, authenticated;
revoke all on table public.refund_sunze_cash_sale_links from public, anon, authenticated;
grant select on table public.refund_sunze_cash_correlation_attempts to service_role;
grant select on table public.refund_sunze_cash_correlation_candidates to service_role;
grant select on table public.refund_sunze_cash_sale_links to service_role;

comment on table public.refund_sunze_cash_correlation_candidates is
  'Service-only bounded-window Sunze cash evidence. Amount and rank are advisory and never authorize an outcome.';
comment on table public.refund_sunze_cash_sale_links is
  'Audited selected-sale substantiation. Active-sale uniqueness complements the immutable completed-case uniqueness guard.';

create or replace function public.service_correlate_sunze_cash_case(
  p_refund_case_id uuid,
  p_expected_fact_version bigint,
  p_trigger_reason text,
  p_import_run_id uuid default null,
  p_now timestamptz default statement_timestamp()
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  case_row public.refund_cases%rowtype;
  watermark public.sunze_cash_source_watermarks%rowtype;
  latest_watermark public.sunze_cash_source_watermarks%rowtype;
  attempt_row public.refund_sunze_cash_correlation_attempts%rowtype;
  source_key text;
  result_state text;
  result_reason text;
  candidate_total integer := 0;
  selected_fact_id uuid;
  active_link public.refund_sunze_cash_sale_links%rowtype;
begin
  if p_trigger_reason not in (
    'intake', 'completed_import', 'corrected_case_facts', 'backfill', 'reconciliation'
  ) then
    raise exception 'Unsupported Sunze correlation trigger';
  end if;

  select * into case_row
  from public.refund_cases c
  where c.id = p_refund_case_id
  for update;

  if not found then
    raise exception 'Refund case not found';
  end if;
  if p_expected_fact_version is null
    or case_row.deterministic_fact_version <> p_expected_fact_version then
    raise exception 'Stale Sunze correlation worker'
      using errcode = '40001';
  end if;
  if case_row.payment_method <> 'cash'
    or case_row.status not in ('submitted', 'needs_review', 'waiting_on_customer', 'correlated')
    or case_row.decision is not null
    or case_row.refund_completed_at is not null
    or case_row.reporting_adjustment_id is not null then
    return jsonb_build_object(
      'state', 'not_eligible', 'reason', 'case_not_active_cash',
      'caseFactVersion', case_row.deterministic_fact_version, 'candidateCount', 0
    );
  end if;

  if p_import_run_id is not null and not exists (
    select 1 from public.sales_import_runs run
    where run.id = p_import_run_id and run.source = 'sunze_browser' and run.status = 'completed'
  ) then
    raise exception 'Completed Sunze import required';
  end if;

  select * into watermark
  from public.sunze_cash_source_watermarks source
  where source.reporting_machine_id = case_row.reporting_machine_id
    and source.freshness_expires_at > p_now
    and source.payment_time_basis = 'validated_iana_timezone'
    and source.timestamp_proof_scope = 'account'
    and source.coverage_started_at <= case_row.incident_at - interval '1 hour'
    and source.covered_through >= case_row.incident_at + interval '1 hour'
  order by source.last_successful_import_at desc, source.import_run_id
  limit 1;

  if found then
    source_key := 'covered:' || watermark.import_run_id::text || ':' ||
      extract(epoch from watermark.covered_through)::bigint::text;
  else
    select * into latest_watermark
    from public.sunze_cash_source_watermarks source
    where source.reporting_machine_id = case_row.reporting_machine_id
    order by source.last_successful_import_at desc, source.covered_through desc, source.import_run_id
    limit 1;
    source_key := case when found
      then 'unavailable:' || case
        when latest_watermark.freshness_expires_at <= p_now then 'stale:'
        else 'fresh:'
      end || latest_watermark.import_run_id::text || ':' ||
        extract(epoch from latest_watermark.covered_through)::bigint::text
      else 'unavailable:none'
    end;
  end if;

  select * into attempt_row
  from public.refund_sunze_cash_correlation_attempts attempt
  where attempt.refund_case_id = p_refund_case_id
    and attempt.case_fact_version = p_expected_fact_version
    and attempt.policy_version = 'sunze_cash_correlation_v1'
    and attempt.source_snapshot_key = source_key;

  if found then
    if attempt_row.invalidated_at is not null then
      return jsonb_build_object(
        'attemptId', attempt_row.id,
        'state', 'checking_sales_history',
        'reason', 'selected_sale_released',
        'caseFactVersion', attempt_row.case_fact_version,
        'candidateCount', attempt_row.candidate_count,
        'replayed', true
      );
    end if;
    return jsonb_build_object(
      'attemptId', attempt_row.id,
      'state', attempt_row.match_state,
      'reason', attempt_row.reason_code,
      'caseFactVersion', attempt_row.case_fact_version,
      'candidateCount', attempt_row.candidate_count,
      'replayed', true
    );
  end if;

  if watermark.import_run_id is null then
    if latest_watermark.import_run_id is null then
      result_state := 'sales_history_unavailable';
      result_reason := 'validated_source_watermark_missing';
    elsif latest_watermark.freshness_expires_at <= p_now then
      result_state := 'sales_history_unavailable';
      result_reason := 'sales_history_stale';
    elsif case_row.incident_at + interval '1 hour' > latest_watermark.covered_through then
      result_state := 'checking_sales_history';
      result_reason := 'awaiting_source_watermark';
    else
      result_state := 'sales_history_unavailable';
      result_reason := 'purchase_window_not_completely_covered';
    end if;
  else
    select count(*)::integer into candidate_total
    from public.machine_sales_facts fact
    join public.sales_import_runs run on run.id = fact.import_run_id
    where fact.reporting_machine_id = case_row.reporting_machine_id
      and fact.source = 'sunze_browser'
      and fact.payment_method = 'cash'
      and lower(btrim(coalesce(fact.source_payment_status, ''))) = 'payment success'
      and fact.payment_time between case_row.incident_at - interval '1 hour'
                               and case_row.incident_at + interval '1 hour'
      and run.status = 'completed'
      and run.meta ->> 'payment_time_semantics_status' = 'validated'
      and run.meta ->> 'payment_time_timezone' = watermark.payment_time_timezone
      and run.meta ->> 'timestamp_proof_scope' = 'account';

    if candidate_total = 0 then
      result_state := 'no_sale_found_with_complete_coverage';
    elsif candidate_total = 1 then
      result_state := 'sale_found';
    else
      result_state := 'multiple_possible_sales';
    end if;
  end if;

  insert into public.refund_sunze_cash_correlation_attempts (
    refund_case_id, policy_version, case_fact_version, source_snapshot_key,
    source_import_run_id, trigger_import_run_id, trigger_reason, match_state, reason_code,
    candidate_count, coverage_started_at, covered_through, evaluated_at
  ) values (
    p_refund_case_id, 'sunze_cash_correlation_v1', p_expected_fact_version, source_key,
    coalesce(watermark.import_run_id, latest_watermark.import_run_id), p_import_run_id,
    p_trigger_reason, result_state, result_reason, candidate_total,
    watermark.coverage_started_at, watermark.covered_through, p_now
  ) returning * into attempt_row;

  if watermark.import_run_id is not null then
    insert into public.refund_sunze_cash_correlation_candidates (
      attempt_id, sales_fact_id, deterministic_rank, payment_time, amount_cents,
      time_delta_seconds, amount_delta_cents, evidence_codes, selection_conflict
    )
    select
      attempt_row.id,
      ranked.id,
      ranked.candidate_rank,
      ranked.payment_time,
      ranked.net_sales_cents,
      ranked.time_delta_seconds,
      ranked.amount_delta_cents,
      array_remove(array[
        'machine_exact', 'cash_payment', 'payment_success', 'validated_coverage',
        case when ranked.amount_delta_cents = 0 then 'amount_exact' end,
        case when ranked.time_delta_seconds <= 300 then 'time_within_5m' end
      ], null),
      exists (
        select 1 from public.refund_sunze_cash_sale_links link
        where link.sales_fact_id = ranked.id
          and link.released_at is null
          and link.refund_case_id <> p_refund_case_id
      )
    from (
      select
        fact.id, fact.payment_time, fact.net_sales_cents,
        abs(extract(epoch from fact.payment_time - case_row.incident_at))::integer
          as time_delta_seconds,
        case when case_row.payment_amount_cents is null then null
          else abs(fact.net_sales_cents - case_row.payment_amount_cents) end as amount_delta_cents,
        row_number() over (order by
          case when case_row.payment_amount_cents is not null
            and fact.net_sales_cents = case_row.payment_amount_cents then 0 else 1 end,
          abs(extract(epoch from fact.payment_time - case_row.incident_at)),
          case when case_row.payment_amount_cents is null then 0
            else abs(fact.net_sales_cents - case_row.payment_amount_cents) end,
          fact.payment_time,
          fact.id
        )::integer as candidate_rank
      from public.machine_sales_facts fact
      join public.sales_import_runs run on run.id = fact.import_run_id
      where fact.reporting_machine_id = case_row.reporting_machine_id
        and fact.source = 'sunze_browser'
        and fact.payment_method = 'cash'
        and lower(btrim(coalesce(fact.source_payment_status, ''))) = 'payment success'
        and fact.payment_time between case_row.incident_at - interval '1 hour'
                                 and case_row.incident_at + interval '1 hour'
        and run.status = 'completed'
        and run.meta ->> 'payment_time_semantics_status' = 'validated'
        and run.meta ->> 'payment_time_timezone' = watermark.payment_time_timezone
        and run.meta ->> 'timestamp_proof_scope' = 'account'
    ) ranked;
  end if;

  select * into active_link
  from public.refund_sunze_cash_sale_links link
  where link.refund_case_id = p_refund_case_id and link.released_at is null;

  if active_link.id is not null and (
    candidate_total <> 1
    or not exists (
      select 1 from public.refund_sunze_cash_correlation_candidates candidate
      where candidate.attempt_id = attempt_row.id
        and candidate.sales_fact_id = active_link.sales_fact_id
    )
  ) then
    result_state := 'multiple_possible_sales';
    result_reason := 'selected_sale_conflict';
    update public.refund_sunze_cash_correlation_attempts
    set match_state = result_state, reason_code = result_reason
    where id = attempt_row.id;
    update public.refund_sunze_cash_correlation_candidates
    set selection_conflict = true
    where attempt_id = attempt_row.id;
  elsif candidate_total = 1 then
    select candidate.sales_fact_id into selected_fact_id
    from public.refund_sunze_cash_correlation_candidates candidate
    where candidate.attempt_id = attempt_row.id;

    if active_link.id is null then
      if exists (
        select 1 from public.refund_sunze_cash_sale_links link
        where link.sales_fact_id = selected_fact_id and link.released_at is null
      ) then
        selected_fact_id := null;
        result_state := 'multiple_possible_sales';
        result_reason := 'selected_sale_conflict';
      else
        begin
          insert into public.refund_sunze_cash_sale_links (
            refund_case_id, sales_fact_id, correlation_attempt_id,
            case_fact_version, link_origin
          ) values (
            p_refund_case_id, selected_fact_id, attempt_row.id,
            p_expected_fact_version, 'system_single_candidate'
          );
          active_link.sales_fact_id := selected_fact_id;
        exception when unique_violation then
          selected_fact_id := null;
          result_state := 'multiple_possible_sales';
          result_reason := 'selected_sale_conflict';
        end;
      end if;
    elsif active_link.sales_fact_id is distinct from selected_fact_id then
      selected_fact_id := null;
      result_state := 'multiple_possible_sales';
      result_reason := 'selected_sale_conflict';
    end if;

    if result_reason = 'selected_sale_conflict' then
      update public.refund_sunze_cash_correlation_attempts
      set match_state = result_state, reason_code = result_reason
      where id = attempt_row.id;
      update public.refund_sunze_cash_correlation_candidates
      set selection_conflict = true
      where attempt_id = attempt_row.id and sales_fact_id = coalesce(selected_fact_id, sales_fact_id);
    end if;
  end if;

  update public.refund_cases
  set cash_match_state = result_state,
      cash_match_evaluated_fact_version = p_expected_fact_version,
      correlation_status = case result_state
        when 'sale_found' then 'matched'
        when 'multiple_possible_sales' then 'multiple_candidates'
        when 'no_sale_found_with_complete_coverage' then 'no_match'
        else 'manual_review'
      end,
      correlation_source = 'sunze',
      correlation_confidence = case
        when result_state = 'sale_found' then 0.9000
        when result_state = 'multiple_possible_sales' then 0.5000
        else 0.0000
      end,
      correlation_summary = case
        when result_state = 'sale_found' then 'One plausible Sunze cash sale; evidence requires manager review.'
        when result_state = 'multiple_possible_sales' then 'Multiple or conflicting Sunze cash candidates require review.'
        when result_state = 'no_sale_found_with_complete_coverage' then 'No plausible Sunze cash sale in the completely covered window.'
        when result_state = 'checking_sales_history' then 'Waiting for complete Sunze cash sales coverage.'
        else 'Sunze cash sales history is unavailable for this window.'
      end,
      matched_sales_fact_id = case
        when result_state = 'sale_found' then selected_fact_id
        when active_link.id is null then null
        else active_link.sales_fact_id
      end,
      status = case when status = 'submitted' then 'needs_review' else status end
  where id = p_refund_case_id;

  insert into public.refund_case_events (refund_case_id, event_type, message, metadata)
  values (
    p_refund_case_id,
    'sunze_cash_correlation_evaluated',
    'Sunze cash evidence was evaluated for manager review.',
    jsonb_build_object(
      'policyVersion', 'sunze_cash_correlation_v1',
      'caseFactVersion', p_expected_fact_version,
      'state', result_state,
      'reason', result_reason,
      'candidateCount', candidate_total,
      'trigger', p_trigger_reason
    )
  );

  return jsonb_build_object(
    'attemptId', attempt_row.id,
    'state', result_state,
    'reason', result_reason,
    'caseFactVersion', p_expected_fact_version,
    'candidateCount', candidate_total,
    'replayed', false
  );
end;
$$;

revoke all on function public.service_correlate_sunze_cash_case(uuid, bigint, text, uuid, timestamptz)
  from public, anon, authenticated;
grant execute on function public.service_correlate_sunze_cash_case(uuid, bigint, text, uuid, timestamptz)
  to service_role;

comment on function public.service_correlate_sunze_cash_case(uuid, bigint, text, uuid, timestamptz) is
  'Versioned, idempotent evidence-only Sunze correlation. Ranking and amount are advisory; no outcome authority is granted.';

create or replace function public.service_correlate_sunze_cash_import(
  p_import_run_id uuid,
  p_limit integer default 500,
  p_now timestamptz default statement_timestamp()
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  target record;
  correlation_result jsonb;
  evaluated integer := 0;
  skipped integer := 0;
begin
  if p_limit not between 1 and 500 then
    raise exception 'Sunze import correlation limit must be between 1 and 500';
  end if;
  if not exists (
    select 1 from public.sales_import_runs run
    where run.id = p_import_run_id and run.source = 'sunze_browser' and run.status = 'completed'
  ) then
    raise exception 'Completed Sunze import required';
  end if;

  for target in
    select c.id, c.deterministic_fact_version
    from public.refund_cases c
    left join lateral (
      select source.*
      from public.sunze_cash_source_watermarks source
      where source.reporting_machine_id = c.reporting_machine_id
        and source.freshness_expires_at > p_now
        and source.payment_time_basis = 'validated_iana_timezone'
        and source.timestamp_proof_scope = 'account'
        and source.coverage_started_at <= c.incident_at - interval '1 hour'
        and source.covered_through >= c.incident_at + interval '1 hour'
      order by source.last_successful_import_at desc, source.import_run_id
      limit 1
    ) covering on true
    left join lateral (
      select source.*
      from public.sunze_cash_source_watermarks source
      where source.reporting_machine_id = c.reporting_machine_id
      order by source.last_successful_import_at desc, source.covered_through desc, source.import_run_id
      limit 1
    ) latest on true
    where c.payment_method = 'cash'
      and c.status in ('submitted', 'needs_review', 'waiting_on_customer', 'correlated')
      and c.decision is null and c.refund_completed_at is null and c.reporting_adjustment_id is null
      and exists (
        select 1 from public.sunze_cash_source_watermarks source
        where source.import_run_id = p_import_run_id
          and source.reporting_machine_id = c.reporting_machine_id
      )
      and not exists (
        select 1
        from public.refund_sunze_cash_correlation_attempts attempt
        where attempt.refund_case_id = c.id
          and attempt.case_fact_version = c.deterministic_fact_version
          and attempt.policy_version = 'sunze_cash_correlation_v1'
          and attempt.source_snapshot_key = case
            when covering.import_run_id is not null then
              'covered:' || covering.import_run_id::text || ':' ||
                extract(epoch from covering.covered_through)::bigint::text
            when latest.import_run_id is not null then
              'unavailable:' || case
                when latest.freshness_expires_at <= p_now then 'stale:'
                else 'fresh:'
              end || latest.import_run_id::text || ':' ||
                extract(epoch from latest.covered_through)::bigint::text
            else 'unavailable:none'
          end
      )
    order by c.created_at, c.id
    limit p_limit
  loop
    correlation_result := public.service_correlate_sunze_cash_case(
      target.id, target.deterministic_fact_version, 'completed_import', p_import_run_id, p_now
    );
    if coalesce((correlation_result ->> 'replayed')::boolean, false) then
      skipped := skipped + 1;
    else
      evaluated := evaluated + 1;
    end if;
  end loop;

  return jsonb_build_object('evaluated', evaluated, 'skipped', skipped, 'limit', p_limit);
end;
$$;

revoke all on function public.service_correlate_sunze_cash_import(uuid, integer, timestamptz)
  from public, anon, authenticated;
grant execute on function public.service_correlate_sunze_cash_import(uuid, integer, timestamptz)
  to service_role;

create or replace function public.service_sunze_cash_correlation_backfill(
  p_dry_run boolean default true,
  p_limit integer default 100,
  p_now timestamptz default statement_timestamp()
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  target record;
  eligible integer;
  evaluated integer := 0;
begin
  if p_limit not between 1 and 500 then
    raise exception 'Sunze backfill limit must be between 1 and 500';
  end if;

  select count(*)::integer into eligible
  from (
    select c.id from public.refund_cases c
    where c.payment_method = 'cash'
      and c.status in ('submitted', 'needs_review', 'waiting_on_customer', 'correlated')
      and c.decision is null and c.refund_completed_at is null and c.reporting_adjustment_id is null
    order by c.created_at, c.id limit p_limit
  ) bounded;

  if not p_dry_run then
    for target in
      select c.id, c.deterministic_fact_version
      from public.refund_cases c
      where c.payment_method = 'cash'
        and c.status in ('submitted', 'needs_review', 'waiting_on_customer', 'correlated')
        and c.decision is null and c.refund_completed_at is null and c.reporting_adjustment_id is null
      order by c.created_at, c.id limit p_limit
    loop
      perform public.service_correlate_sunze_cash_case(
        target.id, target.deterministic_fact_version, 'backfill', null, p_now
      );
      evaluated := evaluated + 1;
    end loop;
  end if;

  return jsonb_build_object(
    'dryRun', p_dry_run, 'eligible', eligible, 'evaluated', evaluated, 'limit', p_limit
  );
end;
$$;

revoke all on function public.service_sunze_cash_correlation_backfill(boolean, integer, timestamptz)
  from public, anon, authenticated;
grant execute on function public.service_sunze_cash_correlation_backfill(boolean, integer, timestamptz)
  to service_role;

create or replace function public.service_get_sunze_cash_correlation(
  p_refund_case_id uuid,
  p_actor_user_id uuid,
  p_candidate_limit integer default 100
)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  case_row public.refund_cases%rowtype;
  attempt_row public.refund_sunze_cash_correlation_attempts%rowtype;
  link_row public.refund_sunze_cash_sale_links%rowtype;
  candidates jsonb;
begin
  if p_candidate_limit not between 1 and 100 then
    raise exception 'Sunze candidate read limit must be between 1 and 100';
  end if;
  select * into case_row from public.refund_cases c where c.id = p_refund_case_id;
  if not found then raise exception 'Refund case not found'; end if;
  if p_actor_user_id is null
    or not public.can_manage_refund_case(p_actor_user_id, p_refund_case_id) then
    raise exception 'Authorized refund manager actor required' using errcode = '42501';
  end if;

  select * into attempt_row
  from public.refund_sunze_cash_correlation_attempts attempt
  where attempt.refund_case_id = p_refund_case_id
    and attempt.case_fact_version = case_row.deterministic_fact_version
    and case_row.cash_match_evaluated_fact_version = case_row.deterministic_fact_version
    and attempt.invalidated_at is null
  order by attempt.evaluated_at desc, attempt.id desc
  limit 1;
  select * into link_row from public.refund_sunze_cash_sale_links link
  where link.refund_case_id = p_refund_case_id and link.released_at is null;

  select coalesce(jsonb_agg(jsonb_build_object(
    'salesFactId', candidate.sales_fact_id,
    'rank', candidate.deterministic_rank,
    'paymentTime', candidate.payment_time,
    'amountCents', candidate.amount_cents,
    'timeDeltaSeconds', candidate.time_delta_seconds,
    'amountDeltaCents', candidate.amount_delta_cents,
    'evidenceCodes', candidate.evidence_codes,
    'selectionConflict', candidate.selection_conflict
  ) order by candidate.deterministic_rank), '[]'::jsonb) into candidates
  from (
    select evidence.*
    from public.refund_sunze_cash_correlation_candidates evidence
    where evidence.attempt_id = attempt_row.id
    order by evidence.deterministic_rank
    limit p_candidate_limit
  ) candidate;

  return jsonb_build_object(
    'caseFactVersion', case_row.deterministic_fact_version,
    'attemptId', attempt_row.id,
    'policyVersion', attempt_row.policy_version,
    'state', coalesce(attempt_row.match_state, case_row.cash_match_state, 'checking_sales_history'),
    'reason', case when attempt_row.id is null then 'correlation_pending' else attempt_row.reason_code end,
    'candidateCount', coalesce(attempt_row.candidate_count, 0),
    'returnedCandidateCount', jsonb_array_length(candidates),
    'candidatesTruncated', coalesce(attempt_row.candidate_count, 0) > jsonb_array_length(candidates),
    'candidates', candidates,
    'selectedSalesFactId', link_row.sales_fact_id,
    'selectedLinkVersion', link_row.link_version,
    'evidenceOnly', true
  );
end;
$$;

revoke all on function public.service_get_sunze_cash_correlation(uuid, uuid, integer)
  from public, anon, authenticated;
grant execute on function public.service_get_sunze_cash_correlation(uuid, uuid, integer)
  to service_role;

create or replace function public.service_select_sunze_cash_candidate(
  p_refund_case_id uuid,
  p_attempt_id uuid,
  p_sales_fact_id uuid,
  p_expected_fact_version bigint,
  p_expected_link_version bigint,
  p_actor_user_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  case_row public.refund_cases%rowtype;
  attempt_row public.refund_sunze_cash_correlation_attempts%rowtype;
  link_row public.refund_sunze_cash_sale_links%rowtype;
  new_link public.refund_sunze_cash_sale_links%rowtype;
begin
  select * into case_row from public.refund_cases c
  where c.id = p_refund_case_id for update;
  if not found then raise exception 'Refund case not found'; end if;
  if p_actor_user_id is null
    or not public.can_manage_refund_case(p_actor_user_id, p_refund_case_id) then
    raise exception 'Authorized refund manager actor required' using errcode = '42501';
  end if;
  if case_row.deterministic_fact_version <> p_expected_fact_version then
    raise exception 'Stale Sunze candidate selection' using errcode = '40001';
  end if;
  if case_row.payment_method <> 'cash'
    or case_row.status not in ('submitted', 'needs_review', 'waiting_on_customer', 'correlated')
    or case_row.decision is not null or case_row.refund_completed_at is not null
    or case_row.reporting_adjustment_id is not null then
    raise exception 'Active nonterminal cash case required';
  end if;

  select * into attempt_row
  from public.refund_sunze_cash_correlation_attempts attempt
  where attempt.id = p_attempt_id
    and attempt.refund_case_id = p_refund_case_id
    and attempt.case_fact_version = p_expected_fact_version
    and attempt.invalidated_at is null
    and attempt.id = (
      select current_attempt.id
      from public.refund_sunze_cash_correlation_attempts current_attempt
      where current_attempt.refund_case_id = p_refund_case_id
        and current_attempt.case_fact_version = p_expected_fact_version
      order by current_attempt.evaluated_at desc, current_attempt.id desc
      limit 1
    );
  if not found or not exists (
    select 1 from public.refund_sunze_cash_correlation_candidates candidate
    where candidate.attempt_id = p_attempt_id and candidate.sales_fact_id = p_sales_fact_id
  ) then
    raise exception 'Current Sunze candidate required';
  end if;

  select * into link_row from public.refund_sunze_cash_sale_links link
  where link.refund_case_id = p_refund_case_id and link.released_at is null
  for update;
  if link_row.id is null then
    if p_expected_link_version <> 0 then
      raise exception 'Stale Sunze link version' using errcode = '40001';
    end if;
  elsif link_row.link_version <> p_expected_link_version then
    raise exception 'Stale Sunze link version' using errcode = '40001';
  elsif link_row.sales_fact_id = p_sales_fact_id then
    return jsonb_build_object(
      'selected', true, 'replayed', true,
      'salesFactId', link_row.sales_fact_id, 'linkVersion', link_row.link_version,
      'evidenceOnly', true
    );
  end if;

  if exists (
    select 1 from public.refund_sunze_cash_sale_links other
    where other.sales_fact_id = p_sales_fact_id and other.released_at is null
      and other.refund_case_id <> p_refund_case_id
  ) then
    raise exception 'Sunze sale is already selected for another case' using errcode = '23505';
  end if;

  if link_row.id is not null then
    update public.refund_sunze_cash_sale_links
    set released_at = statement_timestamp(),
        release_reason = 'source_reconciliation',
        release_note = 'Replaced by a reviewed current candidate.',
        released_by = p_actor_user_id,
        link_version = link_version + 1
    where id = link_row.id;
  end if;

  begin
    insert into public.refund_sunze_cash_sale_links (
      refund_case_id, sales_fact_id, correlation_attempt_id,
      case_fact_version, link_version, link_origin
    ) values (
      p_refund_case_id, p_sales_fact_id, p_attempt_id,
      p_expected_fact_version, coalesce(link_row.link_version + 1, 1), 'reviewed'
    ) returning * into new_link;
  exception when unique_violation then
    raise exception 'Sunze sale is already selected for another case' using errcode = '23505';
  end;

  update public.refund_cases
  set matched_sales_fact_id = p_sales_fact_id,
      correlation_status = 'matched', correlation_source = 'sunze',
      correlation_summary = 'Manager selected a reviewed Sunze cash candidate; this is evidence only.'
  where id = p_refund_case_id;

  insert into public.refund_case_events (
    refund_case_id, actor_user_id, event_type, message, metadata
  ) values (
    p_refund_case_id, p_actor_user_id, 'sunze_cash_candidate_selected',
    'Manager selected reviewed Sunze cash evidence.',
    jsonb_build_object(
      'attemptId', p_attempt_id, 'caseFactVersion', p_expected_fact_version,
      'linkVersion', new_link.link_version, 'evidenceOnly', true
    )
  );

  return jsonb_build_object(
    'selected', true, 'replayed', false,
    'salesFactId', p_sales_fact_id, 'linkVersion', new_link.link_version,
    'evidenceOnly', true
  );
end;
$$;

revoke all on function public.service_select_sunze_cash_candidate(uuid, uuid, uuid, bigint, bigint, uuid)
  from public, anon, authenticated;
grant execute on function public.service_select_sunze_cash_candidate(uuid, uuid, uuid, bigint, bigint, uuid)
  to service_role;

create or replace function public.service_release_sunze_cash_sale_link(
  p_refund_case_id uuid,
  p_expected_fact_version bigint,
  p_expected_link_version bigint,
  p_actor_user_id uuid,
  p_release_reason text,
  p_release_note text default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  case_row public.refund_cases%rowtype;
  link_row public.refund_sunze_cash_sale_links%rowtype;
begin
  if p_release_reason not in (
    'corrected_case_facts', 'wrong_sale', 'duplicate_reconciliation', 'source_reconciliation'
  ) or length(coalesce(p_release_note, '')) > 500 then
    raise exception 'Valid bounded Sunze link release evidence is required';
  end if;
  if p_actor_user_id is null
    or not public.can_manage_refund_case(p_actor_user_id, p_refund_case_id) then
    raise exception 'Authorized refund manager actor required'
      using errcode = '42501';
  end if;

  select * into case_row from public.refund_cases c
  where c.id = p_refund_case_id for update;
  if not found then raise exception 'Refund case not found'; end if;
  if case_row.deterministic_fact_version <> p_expected_fact_version then
    raise exception 'Stale Sunze reconciliation worker' using errcode = '40001';
  end if;
  if case_row.status not in ('submitted', 'needs_review', 'waiting_on_customer', 'correlated')
    or case_row.decision is not null
    or case_row.refund_completed_at is not null
    or case_row.reporting_adjustment_id is not null then
    raise exception 'Completed or official refund evidence cannot be released';
  end if;

  select * into link_row from public.refund_sunze_cash_sale_links link
  where link.refund_case_id = p_refund_case_id and link.released_at is null
  for update;
  if not found then raise exception 'Active Sunze sale link not found'; end if;
  if link_row.link_version <> p_expected_link_version then
    raise exception 'Stale Sunze link version' using errcode = '40001';
  end if;

  update public.refund_sunze_cash_sale_links
  set released_at = statement_timestamp(),
      release_reason = p_release_reason,
      release_note = nullif(btrim(coalesce(p_release_note, '')), ''),
      released_by = p_actor_user_id,
      link_version = link_version + 1
  where id = link_row.id;

  update public.refund_cases
  set matched_sales_fact_id = null,
      cash_match_evaluated_fact_version = null,
      cash_match_state = 'checking_sales_history',
      correlation_status = 'manual_review',
      correlation_confidence = 0,
      correlation_summary = 'Selected Sunze sale evidence was released for reconciliation.'
  where id = p_refund_case_id;

  update public.refund_sunze_cash_correlation_attempts
  set invalidated_at = statement_timestamp(),
      invalidation_reason = 'selected_sale_released'
  where refund_case_id = p_refund_case_id
    and case_fact_version = p_expected_fact_version
    and invalidated_at is null;

  insert into public.refund_case_events (refund_case_id, actor_user_id, event_type, message, metadata)
  values (
    p_refund_case_id, p_actor_user_id, 'sunze_cash_sale_link_released',
    'Selected Sunze sale evidence was released for reconciliation.',
    jsonb_build_object(
      'linkVersion', p_expected_link_version + 1,
      'caseFactVersion', p_expected_fact_version,
      'reason', p_release_reason
    )
  );

  return jsonb_build_object('released', true, 'linkVersion', p_expected_link_version + 1);
end;
$$;

revoke all on function public.service_release_sunze_cash_sale_link(uuid, bigint, bigint, uuid, text, text)
  from public, anon, authenticated;
grant execute on function public.service_release_sunze_cash_sale_link(uuid, bigint, bigint, uuid, text, text)
  to service_role;

create or replace function public.service_sunze_cash_correlation_metrics(
  p_since timestamptz default statement_timestamp() - interval '24 hours'
)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select jsonb_build_object(
    'since', p_since,
    'attemptCount', coalesce(sum(grouped.state_count), 0),
    'states', coalesce(jsonb_object_agg(grouped.match_state, grouped.state_count), '{}'::jsonb),
    'averageCandidateCount', coalesce(
      round(sum(grouped.candidate_sum)::numeric / nullif(sum(grouped.state_count), 0), 2),
      0
    )
  )
  from (
    select attempt.match_state, count(*)::integer as state_count,
      sum(attempt.candidate_count)::bigint as candidate_sum
    from public.refund_sunze_cash_correlation_attempts attempt
    where attempt.evaluated_at >= p_since
    group by attempt.match_state
  ) grouped;
$$;

revoke all on function public.service_sunze_cash_correlation_metrics(timestamptz)
  from public, anon, authenticated;
grant execute on function public.service_sunze_cash_correlation_metrics(timestamptz)
  to service_role;

create or replace function public.trigger_recorrelate_sunze_cash_case()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.payment_method = 'cash'
    and new.status in ('submitted', 'needs_review', 'waiting_on_customer', 'correlated')
    and new.decision is null and new.refund_completed_at is null
    and new.reporting_adjustment_id is null
    and new.deterministic_fact_version > old.deterministic_fact_version then
    begin
      perform public.service_correlate_sunze_cash_case(
        new.id, new.deterministic_fact_version, 'corrected_case_facts', null, statement_timestamp()
      );
    exception when others then
      -- Corrected facts are the durable source of truth. Evidence refresh is
      -- advisory and must never roll back a customer or manager correction.
      update public.refund_cases
      set cash_match_state = 'checking_sales_history',
          cash_match_evaluated_fact_version = null,
          correlation_status = 'manual_review',
          correlation_source = 'sunze',
          correlation_confidence = 0,
          correlation_summary = 'Sunze cash evidence refresh is pending.'
      where id = new.id;

      insert into public.refund_case_events (
        refund_case_id, event_type, message, metadata
      ) values (
        new.id,
        'sunze_cash_correlation_deferred',
        'Sunze cash evidence refresh was deferred for safe retry.',
        jsonb_build_object(
          'caseFactVersion', new.deterministic_fact_version,
          'trigger', 'corrected_case_facts'
        )
      );
    end;
  end if;
  return new;
end;
$$;

drop trigger if exists refund_cases_recorrelate_sunze_cash on public.refund_cases;
create trigger refund_cases_recorrelate_sunze_cash
after update of
  reporting_machine_id, reporting_location_id, incident_at,
  incident_local_datetime, incident_timezone, incident_time_resolution,
  payment_method, payment_amount_cents
on public.refund_cases
for each row execute function public.trigger_recorrelate_sunze_cash_case();

revoke all on function public.trigger_recorrelate_sunze_cash_case()
  from public, anon, authenticated;
