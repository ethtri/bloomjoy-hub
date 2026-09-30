-- #1432: expose positive Sunze cash evidence without treating incomplete
-- history as proof that no sale exists.
--
-- The validated-watermark path remains authoritative for complete coverage.
-- When timestamp coverage is not validated, exact-machine successful cash
-- rows from the same provider sale date may be reviewed, but they are never
-- selected automatically and absence remains unavailable evidence.

alter table public.refund_sunze_cash_correlation_candidates
  alter column time_delta_seconds drop not null;


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
  case_timezone text;
  case_sale_date date;
  positive_run_id uuid;
  positive_run_key text;
  positive_candidate_digest text;
  validated_watermark_found boolean := false;
  latest_watermark_found boolean := false;
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
  validated_watermark_found := found;

  select location.timezone into case_timezone
  from public.reporting_locations location
  where location.id = case_row.reporting_location_id
    and location.status = 'active'
    and location.timezone = case_row.incident_timezone
    and exists (
      select 1 from pg_catalog.pg_timezone_names zone
      where zone.name = location.timezone
    );

  if case_timezone is not null
    and case_row.incident_time_resolution = 'exact' then
    case_sale_date := (case_row.incident_at at time zone case_timezone)::date;

    select run.id, coalesce(run.meta ->> 'githubRunId', run.meta ->> 'github_run_id')
    into positive_run_id, positive_run_key
    from public.sales_import_runs run
    where run.source = 'sunze_browser'
      and run.status = 'completed'
      and run.completed_at is not null
      and run.meta ->> 'machine_coverage_verified' = 'true'
      and run.meta ->> 'visible_machine_count_mismatch' = 'false'
      and nullif(btrim(coalesce(run.meta ->> 'githubRunId', run.meta ->> 'github_run_id')), '') is not null
    order by run.completed_at desc, run.id desc
    limit 1;

    if positive_run_key is not null then
      select md5(string_agg(
        concat_ws(':', fact.id::text, fact.source_order_hash, fact.import_run_id::text,
          fact.sale_date::text, fact.net_sales_cents::text, fact.payment_time::text),
        '|' order by fact.id
      ))
      into positive_candidate_digest
      from public.machine_sales_facts fact
      join public.sales_import_runs run on run.id = fact.import_run_id
      where fact.reporting_machine_id = case_row.reporting_machine_id
        and fact.source = 'sunze_browser'
        and fact.payment_method = 'cash'
        and btrim(fact.source_payment_status) = 'Payment success'
        and nullif(btrim(fact.source_order_hash), '') is not null
        and fact.sale_date = case_sale_date
        and run.source = 'sunze_browser'
        and run.status = 'completed'
        and coalesce(run.meta ->> 'githubRunId', run.meta ->> 'github_run_id') = positive_run_key
        and run.meta ->> 'machine_coverage_verified' = 'true'
        and run.meta ->> 'visible_machine_count_mismatch' = 'false';
    end if;
  end if;

  if validated_watermark_found then
    source_key := 'covered:' || watermark.import_run_id::text || ':' ||
      extract(epoch from watermark.covered_through)::bigint::text;
  else
    select * into latest_watermark
    from public.sunze_cash_source_watermarks source
    where source.reporting_machine_id = case_row.reporting_machine_id
    order by source.last_successful_import_at desc, source.covered_through desc, source.import_run_id
    limit 1;
    latest_watermark_found := found;
    source_key := case when positive_run_key is not null
      then 'positive:' || left(positive_run_key, 64) || ':' ||
        coalesce(positive_candidate_digest, 'empty')
      when latest_watermark_found
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
    if positive_candidate_digest is not null then
      select count(*)::integer into candidate_total
      from public.machine_sales_facts fact
      join public.sales_import_runs run on run.id = fact.import_run_id
      where fact.reporting_machine_id = case_row.reporting_machine_id
        and fact.source = 'sunze_browser'
        and fact.payment_method = 'cash'
        and btrim(fact.source_payment_status) = 'Payment success'
        and nullif(btrim(fact.source_order_hash), '') is not null
        and fact.sale_date = case_sale_date
        and run.source = 'sunze_browser'
        and run.status = 'completed'
        and coalesce(run.meta ->> 'githubRunId', run.meta ->> 'github_run_id') = positive_run_key
        and run.meta ->> 'machine_coverage_verified' = 'true'
        and run.meta ->> 'visible_machine_count_mismatch' = 'false';
      result_state := 'multiple_possible_sales';
      result_reason := 'positive_sales_found_without_validated_coverage';
    elsif latest_watermark.import_run_id is null then
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
    candidate_count, coverage_started_at, covered_through, freshness_expires_at, evaluated_at
  ) values (
    p_refund_case_id, 'sunze_cash_correlation_v1', p_expected_fact_version, source_key,
    coalesce(watermark.import_run_id, positive_run_id, latest_watermark.import_run_id), p_import_run_id,
    p_trigger_reason, result_state, result_reason, candidate_total,
    coalesce(watermark.coverage_started_at, latest_watermark.coverage_started_at),
    coalesce(watermark.covered_through, latest_watermark.covered_through),
    coalesce(watermark.freshness_expires_at, latest_watermark.freshness_expires_at), p_now
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
      ) or exists (
        select 1 from public.refund_cases completed_case
        where completed_case.matched_sales_fact_id = ranked.id
          and completed_case.id <> p_refund_case_id
          and completed_case.payment_method = 'cash'
          and completed_case.duplicate_of_refund_case_id is null
          and (
            completed_case.refund_completed_at is not null
            or completed_case.reporting_adjustment_id is not null
          )
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
  elsif positive_candidate_digest is not null then
    insert into public.refund_sunze_cash_correlation_candidates (
      attempt_id, sales_fact_id, deterministic_rank, payment_time, amount_cents,
      time_delta_seconds, amount_delta_cents, evidence_codes, selection_conflict
    )
    select
      attempt_row.id,
      ranked.id,
      ranked.candidate_rank,
      ranked.reported_payment_time,
      ranked.net_sales_cents,
      null,
      ranked.amount_delta_cents,
      array_remove(array[
        'machine_exact', 'cash_payment', 'payment_success', 'same_venue_date',
        'coverage_unvalidated', 'source_time_unvalidated',
        case when ranked.amount_delta_cents = 0 then 'amount_exact' end
      ], null),
      exists (
        select 1 from public.refund_sunze_cash_sale_links link
        where link.sales_fact_id = ranked.id
          and link.released_at is null
          and link.refund_case_id <> p_refund_case_id
      ) or exists (
        select 1 from public.refund_cases completed_case
        where completed_case.matched_sales_fact_id = ranked.id
          and completed_case.id <> p_refund_case_id
          and completed_case.payment_method = 'cash'
          and completed_case.duplicate_of_refund_case_id is null
          and (
            completed_case.refund_completed_at is not null
            or completed_case.reporting_adjustment_id is not null
          )
      )
    from (
      select
        fact.id,
        (fact.payment_time at time zone 'UTC') at time zone case_timezone
          as reported_payment_time,
        fact.net_sales_cents,
        case when case_row.payment_amount_cents is null then null
          else abs(fact.net_sales_cents - case_row.payment_amount_cents) end as amount_delta_cents,
        row_number() over (order by
          case when case_row.payment_amount_cents is not null
            and fact.net_sales_cents = case_row.payment_amount_cents then 0 else 1 end,
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
        and btrim(fact.source_payment_status) = 'Payment success'
        and nullif(btrim(fact.source_order_hash), '') is not null
        and fact.sale_date = case_sale_date
        and run.source = 'sunze_browser'
        and run.status = 'completed'
        and coalesce(run.meta ->> 'githubRunId', run.meta ->> 'github_run_id') = positive_run_key
        and run.meta ->> 'machine_coverage_verified' = 'true'
        and run.meta ->> 'visible_machine_count_mismatch' = 'false'
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
  elsif candidate_total = 1 and watermark.import_run_id is not null then
    select candidate.sales_fact_id into selected_fact_id
    from public.refund_sunze_cash_correlation_candidates candidate
    where candidate.attempt_id = attempt_row.id;

    if active_link.id is null then
      if exists (
        select 1 from public.refund_sunze_cash_sale_links link
        where link.sales_fact_id = selected_fact_id and link.released_at is null
      ) or exists (
        select 1 from public.refund_cases completed_case
        where completed_case.matched_sales_fact_id = selected_fact_id
          and completed_case.id <> p_refund_case_id
          and completed_case.payment_method = 'cash'
          and completed_case.duplicate_of_refund_case_id is null
          and (
            completed_case.refund_completed_at is not null
            or completed_case.reporting_adjustment_id is not null
          )
      ) then
        selected_fact_id := null;
        result_state := 'multiple_possible_sales';
        result_reason := 'selected_sale_conflict';
      else
        begin
          insert into public.refund_sunze_cash_sale_links (
            refund_case_id, sales_fact_id, correlation_attempt_id,
            case_fact_version, link_version, link_origin
          ) values (
            p_refund_case_id, selected_fact_id, attempt_row.id,
            p_expected_fact_version,
            coalesce((
              select max(link.link_version) + 1
              from public.refund_sunze_cash_sale_links link
              where link.refund_case_id = p_refund_case_id
            ), 1),
            'system_single_candidate'
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
        when result_reason = 'positive_sales_found_without_validated_coverage'
          then 'Positive Sunze cash sales are available for review; source time and complete coverage remain unvalidated.'
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
  'Versioned, idempotent evidence-only Sunze correlation. Positive rows may be reviewed without validated coverage, but only complete coverage can prove no sale.';



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
  current_link_version bigint;
  current_positive_run_key text;
  current_positive_digest text;
  case_timezone text;
  case_sale_date date;
begin
  select * into case_row from public.refund_cases c
  where c.id = p_refund_case_id for update;
  if not found then raise exception 'Refund case not found'; end if;
  if p_actor_user_id is null
    or not public.can_manage_refund_case(p_actor_user_id, p_refund_case_id) then
    raise exception 'Authorized refund manager actor required' using errcode = '42501';
  end if;
  if p_expected_fact_version is null
    or case_row.deterministic_fact_version <> p_expected_fact_version then
    raise exception 'Stale Sunze candidate selection' using errcode = '40001';
  end if;
  if p_expected_link_version is null then
    raise exception 'Stale Sunze link version' using errcode = '40001';
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

  if attempt_row.reason_code = 'positive_sales_found_without_validated_coverage' then
    select location.timezone into case_timezone
    from public.reporting_locations location
    where location.id = case_row.reporting_location_id
      and location.status = 'active'
      and location.timezone = case_row.incident_timezone
      and case_row.incident_time_resolution = 'exact'
      and exists (
        select 1 from pg_catalog.pg_timezone_names zone
        where zone.name = location.timezone
      );
    if case_timezone is null then
      raise exception 'Current Sunze candidate required';
    end if;
    case_sale_date := (case_row.incident_at at time zone case_timezone)::date;

    select coalesce(run.meta ->> 'githubRunId', run.meta ->> 'github_run_id') into current_positive_run_key
    from public.sales_import_runs run
    where run.source = 'sunze_browser'
      and run.status = 'completed'
      and run.completed_at is not null
      and run.meta ->> 'machine_coverage_verified' = 'true'
      and run.meta ->> 'visible_machine_count_mismatch' = 'false'
      and nullif(btrim(coalesce(run.meta ->> 'githubRunId', run.meta ->> 'github_run_id')), '') is not null
    order by run.completed_at desc, run.id desc
    limit 1;

    select md5(string_agg(
      concat_ws(':', fact.id::text, fact.source_order_hash, fact.import_run_id::text,
        fact.sale_date::text, fact.net_sales_cents::text, fact.payment_time::text),
      '|' order by fact.id
    )) into current_positive_digest
    from public.machine_sales_facts fact
    join public.sales_import_runs run on run.id = fact.import_run_id
    where fact.reporting_machine_id = case_row.reporting_machine_id
      and fact.source = 'sunze_browser'
      and fact.payment_method = 'cash'
      and btrim(fact.source_payment_status) = 'Payment success'
      and nullif(btrim(fact.source_order_hash), '') is not null
      and fact.sale_date = case_sale_date
      and run.source = 'sunze_browser'
      and run.status = 'completed'
      and coalesce(run.meta ->> 'githubRunId', run.meta ->> 'github_run_id') = current_positive_run_key
      and run.meta ->> 'machine_coverage_verified' = 'true'
      and run.meta ->> 'visible_machine_count_mismatch' = 'false';

    if current_positive_run_key is null
      or current_positive_digest is null
      or attempt_row.source_snapshot_key is distinct from (
        'positive:' || left(current_positive_run_key, 64) || ':' || current_positive_digest
      )
      or not exists (
        select 1
        from public.refund_sunze_cash_correlation_candidates candidate
        join public.machine_sales_facts fact on fact.id = candidate.sales_fact_id
        join public.sales_import_runs run on run.id = fact.import_run_id
        where candidate.attempt_id = attempt_row.id
          and candidate.sales_fact_id = p_sales_fact_id
          and fact.reporting_machine_id = case_row.reporting_machine_id
          and fact.source = 'sunze_browser'
          and fact.payment_method = 'cash'
          and btrim(fact.source_payment_status) = 'Payment success'
          and nullif(btrim(fact.source_order_hash), '') is not null
          and fact.sale_date = case_sale_date
          and run.source = 'sunze_browser'
          and run.status = 'completed'
          and coalesce(run.meta ->> 'githubRunId', run.meta ->> 'github_run_id') = current_positive_run_key
          and run.meta ->> 'machine_coverage_verified' = 'true'
          and run.meta ->> 'visible_machine_count_mismatch' = 'false'
      ) then
      raise exception 'Stale Sunze candidate selection' using errcode = '40001';
    end if;
  end if;

  select * into link_row from public.refund_sunze_cash_sale_links link
  where link.refund_case_id = p_refund_case_id and link.released_at is null
  for update;
  select coalesce(max(link.link_version), 0) into current_link_version
  from public.refund_sunze_cash_sale_links link
  where link.refund_case_id = p_refund_case_id;
  if link_row.id is not null
    and link_row.sales_fact_id = p_sales_fact_id
    and link_row.correlation_attempt_id = p_attempt_id
    and link_row.case_fact_version = p_expected_fact_version
    and link_row.link_origin = 'reviewed'
    and link_row.link_version in (p_expected_link_version, p_expected_link_version + 1)
    and exists (
      select 1 from public.refund_case_events event
      where event.refund_case_id = p_refund_case_id
        and event.actor_user_id = p_actor_user_id
        and event.event_type = 'sunze_cash_candidate_selected'
        and event.metadata ->> 'attemptId' = p_attempt_id::text
        and event.metadata ->> 'linkVersion' = link_row.link_version::text
    ) then
    return jsonb_build_object(
      'selected', true, 'replayed', true,
      'salesFactId', link_row.sales_fact_id, 'linkVersion', link_row.link_version,
      'evidenceOnly', true
    );
  end if;
  if link_row.id is null then
    if p_expected_link_version <> current_link_version then
      raise exception 'Stale Sunze link version' using errcode = '40001';
    end if;
  elsif link_row.link_version <> p_expected_link_version then
    raise exception 'Stale Sunze link version' using errcode = '40001';
  end if;

  if exists (
    select 1 from public.refund_sunze_cash_sale_links other
    where other.sales_fact_id = p_sales_fact_id and other.released_at is null
      and other.refund_case_id <> p_refund_case_id
  ) or exists (
    select 1 from public.refund_cases completed_case
    where completed_case.matched_sales_fact_id = p_sales_fact_id
      and completed_case.id <> p_refund_case_id
      and completed_case.payment_method = 'cash'
      and completed_case.duplicate_of_refund_case_id is null
      and (
        completed_case.refund_completed_at is not null
        or completed_case.reporting_adjustment_id is not null
      )
  ) then
    raise exception 'Sunze sale is already selected for another case' using errcode = '23505';
  end if;

  if link_row.id is not null then
    update public.refund_sunze_cash_sale_links
    set released_at = statement_timestamp(),
        release_reason = 'source_reconciliation',
        release_note = 'Replaced by a reviewed current candidate.',
        released_by = p_actor_user_id,
        released_case_fact_version = p_expected_fact_version,
        link_version = link_version + 1
    where id = link_row.id;
  end if;

  begin
    insert into public.refund_sunze_cash_sale_links (
      refund_case_id, sales_fact_id, correlation_attempt_id,
      case_fact_version, link_version, link_origin
    ) values (
      p_refund_case_id, p_sales_fact_id, p_attempt_id,
      p_expected_fact_version, current_link_version + 1, 'reviewed'
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
  expected_link_version bigint;
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
  select coalesce(max(link.link_version), 0) into expected_link_version
  from public.refund_sunze_cash_sale_links link
  where link.refund_case_id = p_refund_case_id;

  select coalesce(jsonb_agg(jsonb_build_object(
    'salesFactId', candidate.sales_fact_id,
    'rank', candidate.deterministic_rank,
    'paymentTime', candidate.payment_time,
    'amountCents', candidate.amount_cents,
    'actualAmountCents', sale.net_sales_cents,
    'timeDeltaSeconds', candidate.time_delta_seconds,
    'amountDeltaCents', candidate.amount_delta_cents,
    'evidenceCodes', candidate.evidence_codes,
    'selectionConflict', candidate.selection_conflict,
    'machineLabel', left(coalesce(
      nullif(btrim(machine.refund_public_display_label), ''),
      machine.machine_label
    ), 120),
    'locationName', left(location.name, 120),
    'tradeLabel', left(nullif(btrim(sale.source_trade_name), ''), 120)
  ) order by candidate.deterministic_rank), '[]'::jsonb) into candidates
  from (
    select evidence.*
    from public.refund_sunze_cash_correlation_candidates evidence
    where evidence.attempt_id = attempt_row.id
    order by evidence.deterministic_rank
    limit p_candidate_limit
  ) candidate
  join public.machine_sales_facts sale on sale.id = candidate.sales_fact_id
  left join public.reporting_machines machine on machine.id = sale.reporting_machine_id
  left join public.reporting_locations location on location.id = sale.reporting_location_id;

  return jsonb_build_object(
    'caseFactVersion', case_row.deterministic_fact_version,
    'attemptId', attempt_row.id,
    'policyVersion', attempt_row.policy_version,
    'state', coalesce(attempt_row.match_state, case_row.cash_match_state, 'checking_sales_history'),
    'reason', case when attempt_row.id is null then 'correlation_pending' else attempt_row.reason_code end,
    'sourceReadiness', case
      when attempt_row.id is null then 'correlation_pending'
      when attempt_row.reason_code = 'sales_history_stale' then 'stale'
      when attempt_row.source_snapshot_key like 'positive:%'
        then 'unavailable'
      when attempt_row.match_state = 'checking_sales_history' then 'awaiting_coverage'
      when attempt_row.match_state = 'sales_history_unavailable' then 'unavailable'
      else 'complete_coverage'
    end,
    'coverageStartedAt', attempt_row.coverage_started_at,
    'coveredThrough', attempt_row.covered_through,
    'freshnessExpiresAt', attempt_row.freshness_expires_at,
    'evaluatedAt', attempt_row.evaluated_at,
    'candidateCount', coalesce(attempt_row.candidate_count, 0),
    'returnedCandidateCount', jsonb_array_length(candidates),
    'candidatesTruncated', coalesce(attempt_row.candidate_count, 0) > jsonb_array_length(candidates),
    'candidates', candidates,
    'selectedSalesFactId', link_row.sales_fact_id,
    'selectedLinkVersion', coalesce(link_row.link_version, 0),
    'expectedLinkVersion', expected_link_version,
    'selectedSale', (
      select jsonb_build_object(
        'salesFactId', sale.id,
        'paymentTime', coalesce((
          select evidence.payment_time
          from public.refund_sunze_cash_correlation_candidates evidence
          where evidence.attempt_id = link_row.correlation_attempt_id
            and evidence.sales_fact_id = sale.id
        ), sale.payment_time),
        'actualAmountCents', sale.net_sales_cents,
        'sourceTimeUnvalidated', exists (
          select 1
          from public.refund_sunze_cash_correlation_candidates evidence
          where evidence.attempt_id = link_row.correlation_attempt_id
            and evidence.sales_fact_id = sale.id
            and 'source_time_unvalidated' = any(evidence.evidence_codes)
        ),
        'machineLabel', left(coalesce(
          nullif(btrim(machine.refund_public_display_label), ''),
          machine.machine_label
        ), 120),
        'locationName', left(location.name, 120),
        'tradeLabel', left(nullif(btrim(sale.source_trade_name), ''), 120)
      )
      from public.machine_sales_facts sale
      left join public.reporting_machines machine on machine.id = sale.reporting_machine_id
      left join public.reporting_locations location on location.id = sale.reporting_location_id
      where sale.id = link_row.sales_fact_id
    ),
    'evidenceOnly', true
  );
end;
$$;

revoke all on function public.service_get_sunze_cash_correlation(uuid, uuid, integer)
  from public, anon, authenticated;
grant execute on function public.service_get_sunze_cash_correlation(uuid, uuid, integer)
  to service_role;


