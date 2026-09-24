-- Preparation is read from completed provider work. No independent ready flag
-- can outlive a changed case fact, source snapshot, or decision version.
create function public.refund_current_sunze_cash_source_key(
  p_reporting_machine_id uuid,
  p_incident_at timestamptz,
  p_now timestamptz default statement_timestamp()
)
returns text
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  source_row public.sunze_cash_source_watermarks%rowtype;
begin
  select source.* into source_row
  from public.sunze_cash_source_watermarks source
  where source.reporting_machine_id = p_reporting_machine_id
    and source.freshness_expires_at > p_now
    and source.payment_time_basis = 'validated_iana_timezone'
    and source.timestamp_proof_scope = 'account'
    and source.coverage_started_at <= p_incident_at - interval '1 hour'
    and source.covered_through >= p_incident_at + interval '1 hour'
  order by source.last_successful_import_at desc, source.import_run_id
  limit 1;
  if found then
    return 'covered:' || source_row.import_run_id::text || ':' ||
      extract(epoch from source_row.covered_through)::bigint::text;
  end if;

  select source.* into source_row
  from public.sunze_cash_source_watermarks source
  where source.reporting_machine_id = p_reporting_machine_id
  order by source.last_successful_import_at desc,
    source.covered_through desc, source.import_run_id
  limit 1;
  if not found then return 'unavailable:none'; end if;
  return 'unavailable:' || case
    when source_row.freshness_expires_at <= p_now then 'stale:'
    else 'fresh:'
  end || source_row.import_run_id::text || ':' ||
    extract(epoch from source_row.covered_through)::bigint::text;
end;
$$;
revoke all on function public.refund_current_sunze_cash_source_key(uuid,timestamptz,timestamptz)
  from public, anon, authenticated, service_role;
grant execute on function public.refund_current_sunze_cash_source_key(uuid,timestamptz,timestamptz)
  to service_role;

-- The scheduled Edge sweep invokes this bounded executor. Row locks and the
-- correlator's source/fact uniqueness make concurrent sweeps and restarts safe.
create function public.service_prepare_due_refund_cash_cases(p_limit integer default 10)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  target record;
  result jsonb;
  evaluated integer := 0;
  stale_skipped integer := 0;
begin
  if p_limit is null or p_limit not between 1 and 25 then
    raise exception 'Cash preparation limit must be between 1 and 25'
      using errcode = '22023';
  end if;
  for target in
    select c.id, c.deterministic_fact_version
    from public.refund_cases c
    where c.payment_method = 'cash'
      and c.status in ('submitted','needs_review','waiting_on_customer','correlated')
      and c.decision is null
      and c.reporting_machine_id is not null
      and c.incident_at is not null
      and c.refund_completed_at is null
      and c.reporting_adjustment_id is null
      and c.duplicate_of_refund_case_id is null
      and not exists (
        select 1 from public.refund_sunze_cash_correlation_attempts attempt
        where attempt.refund_case_id = c.id
          and attempt.case_fact_version = c.deterministic_fact_version
          and attempt.policy_version = 'sunze_cash_correlation_v1'
          and attempt.source_snapshot_key =
            public.refund_current_sunze_cash_source_key(
              c.reporting_machine_id,c.incident_at,statement_timestamp())
      )
    order by c.created_at, c.id
    limit p_limit
    for update of c skip locked
  loop
    begin
      result := public.service_correlate_sunze_cash_case(
        target.id,target.deterministic_fact_version,'backfill',null,
        statement_timestamp()
      );
      if result ->> 'replayed' = 'false' then
        evaluated := evaluated + 1;
      end if;
    exception when sqlstate '40001' then
      stale_skipped := stale_skipped + 1;
    end;
  end loop;
  return jsonb_build_object(
    'evaluated',evaluated,'staleSkipped',stale_skipped,
    'payloadRedacted',true
  );
end;
$$;
revoke all on function public.service_prepare_due_refund_cash_cases(integer)
  from public, anon, authenticated, service_role;
grant execute on function public.service_prepare_due_refund_cash_cases(integer)
  to service_role;

create function public.refund_manager_preparation_snapshot(
  p_refund_case_id uuid,
  p_expected_action_version bigint
)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  case_row public.refund_cases%rowtype;
  cash_attempt public.refund_sunze_cash_correlation_attempts%rowtype;
  card_proof record;
  evidence_basis text;
  summary text;
  proof_id uuid;
  prepared_at timestamptz;
begin
  select c.* into case_row from public.refund_cases c
  where c.id = p_refund_case_id;
  if not found or p_expected_action_version is null
    or case_row.official_action_version is distinct from p_expected_action_version
    or case_row.decision is not null
    or case_row.status not in ('submitted','needs_review','correlated')
    or case_row.refund_completed_at is not null
    or case_row.reporting_adjustment_id is not null
    or case_row.duplicate_of_refund_case_id is not null
    or public.refund_case_has_unresolved_reconciliation(case_row.id) then
    return null;
  end if;

  if case_row.payment_method = 'cash' then
    select attempt.* into cash_attempt
    from public.refund_sunze_cash_correlation_attempts attempt
    where attempt.refund_case_id = case_row.id
      and attempt.case_fact_version = case_row.deterministic_fact_version
      and attempt.policy_version = 'sunze_cash_correlation_v1'
      and attempt.source_snapshot_key =
        public.refund_current_sunze_cash_source_key(
          case_row.reporting_machine_id,case_row.incident_at,statement_timestamp())
      and attempt.invalidated_at is null
      and attempt.match_state in (
        'sale_found','multiple_possible_sales',
        'no_sale_found_with_complete_coverage','sales_history_unavailable'
      )
    order by attempt.evaluated_at desc,attempt.id desc
    limit 1;
    if not found
      or case_row.cash_match_evaluated_fact_version is distinct from
        case_row.deterministic_fact_version
      or case_row.cash_match_state is distinct from cash_attempt.match_state then
      return null;
    end if;
    proof_id := cash_attempt.id;
    prepared_at := cash_attempt.evaluated_at;
    evidence_basis := case cash_attempt.match_state
      when 'sale_found' then 'cash_sale_found'
      when 'multiple_possible_sales' then 'cash_multiple_reviewed'
      when 'no_sale_found_with_complete_coverage' then 'cash_researched_unmatched'
      else 'cash_coverage_unavailable_researched'
    end;
    summary := case cash_attempt.match_state
      when 'sale_found' then 'One plausible Sunze cash sale was found for review before the final decision.'
      when 'multiple_possible_sales' then 'Several possible cash sales were reviewed; no sale was chosen automatically.'
      when 'no_sale_found_with_complete_coverage' then 'The covered Sunze cash sales window contains no plausible sale; review the case evidence.'
      else 'Sunze cash sales coverage is unavailable for this window; the gap is recorded for review.'
    end;
  elsif case_row.payment_method = 'card' then
    if case_row.nayax_refund_execution_status <> 'not_requested'
      or (public.refund_case_nayax_manager_readiness(null,case_row.id)
        ->> 'transactionConfirmed')::boolean is not true then
      return null;
    end if;
    select event.id,event.created_at into card_proof
    from public.refund_nayax_lookup_candidates candidate
    join public.refund_case_events event
      on event.refund_case_id = candidate.refund_case_id
    where candidate.refund_case_id = case_row.id
      and candidate.lookup_generation = case_row.nayax_lookup_generation
      and candidate.provider_transaction_id = case_row.matched_nayax_transaction_id
      and candidate.expires_at > statement_timestamp()
      and event.event_type in (
        'nayax_match_preselected','nayax_match_selected',
        'nayax_match_selection_proof_recovered'
      )
      and event.metadata ->> 'candidate_token' = candidate.token::text
      and event.metadata ->> 'lookup_generation' = case_row.nayax_lookup_generation::text
      and event.metadata ->> 'deterministic_fact_version' =
        case_row.deterministic_fact_version::text
      and event.metadata ->> 'candidate_evidence_hash' =
        public.refund_nayax_candidate_evidence_hash(
          candidate.refund_case_id,candidate.actor_user_id,
          candidate.provider_transaction_id,candidate.site_id,
          candidate.machine_authorization_time,candidate.amount_cents,
          candidate.card_last4,candidate.currency_code,
          candidate.evidence_summary,candidate.expires_at,candidate.created_at)
    order by event.created_at desc,event.id desc
    limit 1;
    if not found then return null; end if;
    proof_id := card_proof.id;
    prepared_at := card_proof.created_at;
    evidence_basis := 'card_exact_selected';
    summary := 'A specific Nayax card purchase is verified for the Manager''s final decision.';
  else
    return null;
  end if;

  return jsonb_build_object(
    'schemaVersion','refund_manager_preparation_v1',
    'proofId',proof_id,'preparedAt',prepared_at,
    'evidenceBasis',evidence_basis,'summary',left(summary,160),
    'officialActionVersion',case_row.official_action_version,
    'deterministicFactVersion',case_row.deterministic_fact_version,
    'payloadRedacted',true
  );
end;
$$;
revoke all on function public.refund_manager_preparation_snapshot(uuid,bigint)
  from public, anon, authenticated, service_role;
grant execute on function public.refund_manager_preparation_snapshot(uuid,bigint)
  to service_role;

-- The alert consumer is deployed separately. When present, a completed
-- correlation can wake it immediately after commit; the scheduled sweep is
-- still the durable fallback. No customer or Manager message is sent here.
create function public.refund_wake_ready_after_cash_preparation()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.match_state <> 'checking_sales_history'
    and pg_catalog.to_regprocedure(
      'public.service_dispatch_refund_manager_ready_wakeup(uuid)') is not null then
    execute 'select public.service_dispatch_refund_manager_ready_wakeup($1)'
      using new.refund_case_id;
  end if;
  return new;
end;
$$;
revoke all on function public.refund_wake_ready_after_cash_preparation()
  from public, anon, authenticated, service_role;
create trigger refund_cash_preparation_ready_wakeup
after insert on public.refund_sunze_cash_correlation_attempts
for each row execute function public.refund_wake_ready_after_cash_preparation();

comment on function public.refund_manager_preparation_snapshot(uuid,bigint) is
  'Service-only current-version preparation evidence from completed card lookup selection or Sunze cash correlation. It grants no decision or payment authority.';
select pg_notify('pgrst','reload schema');
