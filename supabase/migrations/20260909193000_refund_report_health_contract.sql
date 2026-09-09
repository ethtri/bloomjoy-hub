-- #973: report operations health distinguishes durable failures, provider-empty
-- runs, ordinary delivery silence, and unknown transaction coverage. None is
-- payment evidence or retry authority.

create table public.nayax_scheduled_report_provider_run_observations (
  id uuid primary key default gen_random_uuid(),
  occurred_at timestamptz not null unique,
  run_status text not null check (run_status in ('file_sent', 'empty', 'failed')),
  evidence_source text not null check (evidence_source = 'nayax_core_distribution_log'),
  evidence_digest text not null unique check (evidence_digest ~ '^[a-f0-9]{64}$'),
  observed_at timestamptz not null default clock_timestamp(),
  created_at timestamptz not null default clock_timestamp(),
  check (occurred_at <= observed_at + interval '5 minutes'),
  check (occurred_at >= observed_at - interval '14 days')
);

alter table public.nayax_scheduled_report_provider_run_observations
  enable row level security;
revoke all on public.nayax_scheduled_report_provider_run_observations
  from public, anon, authenticated, service_role;
grant select on public.nayax_scheduled_report_provider_run_observations
  to service_role;

create trigger nayax_scheduled_report_provider_run_observations_immutable
before update or delete on public.nayax_scheduled_report_provider_run_observations
for each row execute function public.refund_receipt_immutable();

create function public.service_record_nayax_scheduled_report_provider_run(
  p_occurred_at timestamptz,
  p_run_status text,
  p_evidence_source text,
  p_evidence_digest text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  normalized_status text := lower(nullif(btrim(p_run_status), ''));
  normalized_source text := lower(nullif(btrim(p_evidence_source), ''));
  normalized_digest text := lower(nullif(btrim(p_evidence_digest), ''));
  prior public.nayax_scheduled_report_provider_run_observations;
  recorded_id uuid;
begin
  if auth.role() is distinct from 'service_role' then
    raise exception 'Service role required';
  end if;
  if p_occurred_at is null
    or p_occurred_at > clock_timestamp() + interval '5 minutes'
    or p_occurred_at < clock_timestamp() - interval '14 days'
    or normalized_status not in ('file_sent', 'empty', 'failed')
    or normalized_source is distinct from 'nayax_core_distribution_log'
    or normalized_digest !~ '^[a-f0-9]{64}$' then
    raise exception 'Invalid provider report run observation';
  end if;

  insert into public.nayax_scheduled_report_provider_run_observations (
    occurred_at, run_status, evidence_source, evidence_digest
  ) values (
    p_occurred_at, normalized_status, normalized_source, normalized_digest
  )
  on conflict (occurred_at) do nothing
  returning id into recorded_id;

  if recorded_id is null then
    select * into prior
    from public.nayax_scheduled_report_provider_run_observations
    where occurred_at = p_occurred_at;
    if prior.run_status is distinct from normalized_status
      or prior.evidence_source is distinct from normalized_source
      or prior.evidence_digest is distinct from normalized_digest then
      raise exception 'Provider report run observation conflict';
    end if;
    recorded_id := prior.id;
  end if;

  return jsonb_build_object(
    'schemaVersion', 'nayax_report_provider_run_observation_v1',
    'recorded', true,
    'replayed', prior.id is not null,
    'observationId', recorded_id,
    'payloadRedacted', true
  );
end;
$$;

revoke all on function public.service_record_nayax_scheduled_report_provider_run(
  timestamptz, text, text, text
) from public, anon, authenticated, service_role;
grant execute on function public.service_record_nayax_scheduled_report_provider_run(
  timestamptz, text, text, text
) to service_role;

alter function public.get_refund_gmail_health()
  rename to get_refund_gmail_health_pre_report_health_v2;
revoke all on function public.get_refund_gmail_health_pre_report_health_v2()
  from public, anon, authenticated, service_role;

create function public.get_refund_gmail_health()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  result jsonb;
  latest_received timestamptz;
  latest_recorded timestamptz;
  latest_report jsonb;
  provider_run public.nayax_scheduled_report_provider_run_observations;
  delivery_state text;
  ingest_state text;
  coverage_state text := 'unknown';
  attention_reason text;
  affected_case_count integer := 0;
  review_after timestamptz;
begin
  result := public.get_refund_gmail_health_pre_report_health_v2();
  if public.is_super_admin(auth.uid()) is not true then
    return result || jsonb_build_object('reportFreshness', null);
  end if;

  select message.received_at, file.recorded_at, file.report
    into latest_received, latest_recorded, latest_report
  from public.nayax_scheduled_report_messages message
  join public.nayax_scheduled_report_files file
    on file.file_digest = message.file_digest
  order by message.received_at desc, message.message_id desc
  limit 1;

  select * into provider_run
  from public.nayax_scheduled_report_provider_run_observations observation
  order by observation.occurred_at desc, observation.created_at desc
  limit 1;

  review_after := latest_received + interval '120 minutes';
  ingest_state := case
    when result ->> 'lastRunStatus' = 'failed'
      and coalesce(result ->> 'errorCode', '') like 'nayax_report:%' then 'failed'
    when result ->> 'lastRunStatus' = 'succeeded' then 'healthy'
    else 'unknown'
  end;

  delivery_state := case
    when provider_run.occurred_at is not null
      and provider_run.occurred_at > coalesce(latest_received, '-infinity'::timestamptz)
      and provider_run.run_status = 'empty' then 'explicit_empty'
    when provider_run.occurred_at is not null
      and provider_run.occurred_at > coalesce(latest_received, '-infinity'::timestamptz)
      and provider_run.run_status = 'failed' then 'provider_failed'
    when provider_run.occurred_at is not null
      and provider_run.occurred_at > coalesce(latest_received, '-infinity'::timestamptz)
      and provider_run.run_status = 'file_sent' then 'file_sent_awaiting_ingest'
    when latest_received is null then 'unobserved'
    when now() < review_after then 'file_received'
    else 'ordinary_silence'
  end;

  if latest_report is not null
    and latest_report ? 'reportingPeriod'
    and latest_report -> 'reportingPeriod' <> 'null'::jsonb then
    coverage_state := 'declared_period';
  end if;

  if ingest_state = 'failed' then
    attention_reason := 'report_ingest_failed';
  elsif delivery_state = 'provider_failed' then
    attention_reason := 'provider_run_failed';
  elsif delivery_state = 'file_sent_awaiting_ingest'
    and provider_run.occurred_at <= now() - interval '30 minutes' then
    attention_reason := 'provider_file_not_ingested';
  end if;

  select count(distinct attempt.refund_case_id)::integer
    into affected_case_count
  from public.refund_case_nayax_refund_attempts attempt
  where attempt.reconciliation_required
    and attempt.case_finalization_committed_at is null
    and not exists (
      select 1 from public.refund_authoritative_receipts receipt
      where receipt.refund_case_id = attempt.refund_case_id
    );

  return result || jsonb_build_object(
    'reportFreshness', jsonb_build_object(
      'schemaVersion', 'refund_report_health_v2',
      -- Compatibility status keeps older clients quiet for ordinary silence,
      -- explicit Empty runs, and unknown coverage.
      'status', case
        when attention_reason is not null then 'needs_review'
        when latest_received is null and provider_run.occurred_at is null then 'unobserved'
        else 'recent'
      end,
      'deliveryState', delivery_state,
      'ingestState', ingest_state,
      'coverageState', coverage_state,
      'coverageReason', case when coverage_state = 'unknown'
        then 'provider_reporting_period_not_supplied' else null end,
      'attentionRequired', attention_reason is not null,
      'attentionReason', attention_reason,
      'affectedCaseCount', affected_case_count,
      'lastReceivedAt', latest_received,
      'lastRecordedAt', latest_recorded,
      'lastProviderRunAt', provider_run.occurred_at,
      'reviewAfter', review_after,
      'configuredCadenceMinutes', 60,
      'reviewGraceMinutes', 120,
      'schedulePhaseKnown', false,
      'ownerLabel', 'Refund Operations',
      'absenceIsNoRefundEvidence', false,
      'paymentRetryAuthorized', false
    )
  );
end;
$$;

revoke all on function public.get_refund_gmail_health()
  from public, anon;
grant execute on function public.get_refund_gmail_health()
  to authenticated;

comment on table public.nayax_scheduled_report_provider_run_observations is
  'Immutable service-only observations from the authenticated Nayax distribution log. Empty and failed runs are operations evidence only.';
comment on function public.service_record_nayax_scheduled_report_provider_run(
  timestamptz, text, text, text
) is 'Records one redacted authenticated provider-run observation. It cannot create refund, receipt, accounting, case, or message effects.';
comment on function public.get_refund_gmail_health() is
  'Refund Operations report health v2: actual report ingest failures, explicit provider run state, ordinary silence, and unknown coverage remain separate and never authorize payment or retry.';
