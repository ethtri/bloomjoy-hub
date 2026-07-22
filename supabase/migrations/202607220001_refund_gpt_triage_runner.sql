-- Server-only, default-off OpenAI runner for human-reviewed refund inbox triage.
-- The job ledger stores no raw model input or provider response.

create table if not exists public.refund_gpt_triage_jobs (
  id uuid primary key default gen_random_uuid(),
  refund_case_id uuid not null references public.refund_cases (id) on delete cascade,
  source_message_id uuid not null references public.refund_gmail_messages (id) on delete cascade,
  run_key text not null unique,
  model_name text not null,
  model_snapshot text,
  prompt_version text not null,
  schema_version text not null,
  input_fingerprint text,
  status text not null default 'processing' check (status in ('processing', 'succeeded', 'failed')),
  failure_category text check (
    failure_category is null or failure_category in (
      'provider_configuration', 'provider_http', 'provider_timeout', 'provider_refusal',
      'provider_schema', 'database_validation', 'internal'
    )
  ),
  error_code text,
  claimed_at timestamptz not null default now(),
  finished_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint refund_gpt_triage_jobs_run_key_length check (length(run_key) between 8 and 255),
  constraint refund_gpt_triage_jobs_model_name_length check (length(model_name) between 1 and 120),
  constraint refund_gpt_triage_jobs_model_snapshot_length check (
    model_snapshot is null or length(model_snapshot) between 1 and 160
  ),
  constraint refund_gpt_triage_jobs_prompt_length check (length(prompt_version) between 3 and 80),
  constraint refund_gpt_triage_jobs_schema_length check (length(schema_version) between 3 and 80),
  constraint refund_gpt_triage_jobs_fingerprint_format check (
    input_fingerprint is null or input_fingerprint ~ '^[a-f0-9]{64}$'
  ),
  constraint refund_gpt_triage_jobs_error_code_format check (
    error_code is null or error_code ~ '^[a-z0-9_:-]{3,80}$'
  ),
  constraint refund_gpt_triage_jobs_result_shape check (
    (
      status = 'processing'
      and model_snapshot is null
      and input_fingerprint is null
      and failure_category is null
      and error_code is null
      and finished_at is null
    )
    or (
      status = 'succeeded'
      and model_snapshot is not null
      and input_fingerprint is not null
      and failure_category is null
      and error_code is null
      and finished_at is not null
    )
    or (
      status = 'failed'
      and model_snapshot is null
      and input_fingerprint is null
      and failure_category is not null
      and error_code is not null
      and finished_at is not null
    )
  ),
  constraint refund_gpt_triage_jobs_source_version_unique unique (
    source_message_id, prompt_version, model_name
  )
);

create index if not exists refund_gpt_triage_jobs_case_created_idx
  on public.refund_gpt_triage_jobs (refund_case_id, created_at desc);

create index if not exists refund_gpt_triage_jobs_source_idx
  on public.refund_gpt_triage_jobs (source_message_id);

create index if not exists refund_gpt_triage_jobs_processing_idx
  on public.refund_gpt_triage_jobs (claimed_at, id)
  where status = 'processing';

drop trigger if exists refund_gpt_triage_jobs_set_updated_at on public.refund_gpt_triage_jobs;
create trigger refund_gpt_triage_jobs_set_updated_at
before update on public.refund_gpt_triage_jobs
for each row execute function public.set_updated_at();

alter table public.refund_gpt_triage_jobs enable row level security;
revoke all on table public.refund_gpt_triage_jobs from public, anon, authenticated;
grant select, insert, update, delete on table public.refund_gpt_triage_jobs to service_role;

create or replace function public.service_claim_refund_gpt_triage_jobs(
  p_run_key text,
  p_model_name text,
  p_prompt_version text,
  p_schema_version text,
  p_limit integer default 5
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  settings_row public.refund_gpt_triage_settings;
  source_row public.refund_gmail_messages;
  job_row public.refund_gpt_triage_jobs;
  context_messages jsonb;
  jobs jsonb := '[]'::jsonb;
  normalized_limit integer := least(greatest(coalesce(p_limit, 5), 1), 10);
begin
  select * into settings_row
  from public.refund_gpt_triage_settings
  where singleton;

  if not coalesce(settings_row.enabled, false) then
    return jsonb_build_object('enabled', false, 'jobs', jobs);
  end if;
  if coalesce(settings_row.auto_send_enabled, false) or not coalesce(settings_row.human_review_required, true) then
    raise exception 'Refund GPT triage must remain human reviewed';
  end if;
  if p_prompt_version <> settings_row.prompt_version or p_schema_version <> settings_row.schema_version then
    raise exception 'Approved refund GPT prompt and schema versions required';
  end if;
  if length(btrim(coalesce(p_run_key, ''))) not between 8 and 160
    or length(btrim(coalesce(p_model_name, ''))) not between 1 and 120 then
    raise exception 'Valid refund GPT run key and model required';
  end if;

  for source_row in
    select message.*
    from public.refund_gmail_messages message
    join public.refund_cases refund_case on refund_case.id = message.refund_case_id
    where message.direction = 'inbound'
      and message.message_kind = 'message'
      and message.status = 'received'
      and message.content_deleted_at is null
      and refund_case.status not in ('denied', 'completed', 'closed')
      and not exists (
        select 1
        from public.refund_gmail_messages newer
        where newer.refund_case_id = message.refund_case_id
          and newer.direction = 'inbound'
          and newer.message_kind = 'message'
          and newer.status = 'received'
          and newer.content_deleted_at is null
          and (newer.received_at, newer.id) > (message.received_at, message.id)
      )
      and not exists (
        select 1
        from public.refund_gpt_triage_jobs existing_job
        where existing_job.source_message_id = message.id
          and existing_job.prompt_version = p_prompt_version
          and existing_job.model_name = btrim(p_model_name)
      )
    order by message.received_at, message.id
    limit normalized_limit
  loop
    insert into public.refund_gpt_triage_jobs (
      refund_case_id,
      source_message_id,
      run_key,
      model_name,
      prompt_version,
      schema_version
    )
    values (
      source_row.refund_case_id,
      source_row.id,
      left(btrim(p_run_key), 160) || ':' || source_row.id::text,
      btrim(p_model_name),
      p_prompt_version,
      p_schema_version
    )
    on conflict (source_message_id, prompt_version, model_name) do nothing
    returning * into job_row;

    if job_row.id is null then
      continue;
    end if;

    select coalesce(jsonb_agg(jsonb_build_object(
      'direction', 'inbound',
      'kind', 'message',
      'body', context_message.plain_body,
      'receivedAt', context_message.received_at,
      'sensitiveDataRedacted', context_message.sensitive_data_redacted
    ) order by context_message.received_at, context_message.id), '[]'::jsonb)
    into context_messages
    from (
      select message.id, message.plain_body, message.received_at, message.sensitive_data_redacted
      from public.refund_gmail_messages message
      where message.refund_case_id = source_row.refund_case_id
        and message.direction = 'inbound'
        and message.message_kind = 'message'
        and message.status = 'received'
        and message.content_deleted_at is null
        and (message.received_at, message.id) <= (source_row.received_at, source_row.id)
      order by message.received_at desc, message.id desc
      limit 8
    ) context_message;

    jobs := jobs || jsonb_build_array(jsonb_build_object(
      'jobId', job_row.id,
      'refundCaseId', source_row.refund_case_id,
      'sourceMessageId', source_row.id,
      'publicReference', (
        select refund_case.public_reference
        from public.refund_cases refund_case
        where refund_case.id = source_row.refund_case_id
      ),
      'subject', source_row.subject,
      'messages', context_messages
    ));
  end loop;

  return jsonb_build_object('enabled', true, 'jobs', jobs);
end;
$$;

create or replace function public.service_complete_refund_gpt_triage_job(
  p_job_id uuid,
  p_input_fingerprint text,
  p_model_snapshot text,
  p_result jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  job_row public.refund_gpt_triage_jobs;
  triage_result jsonb;
  triage_id uuid;
  source_text text;
  any_sensitive_redaction boolean := false;
  provided_policy_values text[] := '{}'::text[];
  expected_policy_values text[] := '{}'::text[];
  amount_cents integer;
begin
  select * into job_row
  from public.refund_gpt_triage_jobs
  where id = p_job_id
  for update;

  if job_row.id is null then
    raise exception 'Refund GPT triage job not found';
  end if;
  if job_row.status = 'succeeded' then
    select jsonb_build_object(
      'created', false,
      'triageId', triage.id,
      'status', triage.status
    ) into triage_result
    from public.refund_gpt_triage_runs triage
    where triage.run_key = job_row.run_key;
    return coalesce(triage_result, jsonb_build_object('created', false, 'status', 'succeeded'));
  end if;
  if job_row.status <> 'processing' then
    raise exception 'Refund GPT triage job is not processing';
  end if;
  if coalesce(p_input_fingerprint, '') !~ '^[a-f0-9]{64}$'
    or length(btrim(coalesce(p_model_snapshot, ''))) not between 1 and 160 then
    raise exception 'Valid refund GPT fingerprint and model snapshot required';
  end if;
  if exists (
    select 1
    from public.refund_gmail_messages newer
    join public.refund_gmail_messages source_message
      on source_message.id = job_row.source_message_id
    where newer.refund_case_id = job_row.refund_case_id
      and newer.direction = 'inbound'
      and newer.message_kind = 'message'
      and newer.status = 'received'
      and newer.content_deleted_at is null
      and (newer.received_at, newer.id) > (source_message.received_at, source_message.id)
  ) then
    update public.refund_gpt_triage_jobs
    set
      status = 'failed',
      failure_category = 'database_validation',
      error_code = 'stale_source_message',
      finished_at = now()
    where id = job_row.id;
    return jsonb_build_object('created', false, 'status', 'stale');
  end if;
  if jsonb_typeof(coalesce(p_result, 'null'::jsonb)) <> 'object'
    or jsonb_typeof(p_result -> 'policyFlags') <> 'array' then
    raise exception 'Structured refund GPT result required';
  end if;

  select
    string_agg(context_message.subject || E'\n' || context_message.plain_body, E'\n' order by context_message.received_at, context_message.id),
    bool_or(context_message.sensitive_data_redacted)
  into source_text, any_sensitive_redaction
  from (
    select message.id, message.subject, message.plain_body, message.received_at, message.sensitive_data_redacted
    from public.refund_gmail_messages message
    where message.refund_case_id = job_row.refund_case_id
      and message.direction = 'inbound'
      and message.message_kind = 'message'
      and message.status = 'received'
      and message.content_deleted_at is null
      and (message.received_at, message.id) <= (
        select source_message.received_at, source_message.id
        from public.refund_gmail_messages source_message
        where source_message.id = job_row.source_message_id
      )
    order by message.received_at desc, message.id desc
    limit 8
  ) context_message;

  select coalesce(array_agg(value order by value), '{}'::text[])
  into provided_policy_values
  from jsonb_array_elements_text(p_result -> 'policyFlags') value;

  source_text := coalesce(source_text, '');
  if source_text ~* '\m(attorney|lawyer|lawsuit|legal action|regulator|ftc|attorney general)\M' then
    expected_policy_values := array_append(expected_policy_values, 'legal');
  end if;
  if source_text ~* '\m(injury|injured|hospital|fire|burned|burnt|electric shock|unsafe|medical)\M' then
    expected_policy_values := array_append(expected_policy_values, 'safety');
  end if;
  if source_text ~* '\m(threat|threaten|threatening|kill|hurt you|come after|destroy your)\M' then
    expected_policy_values := array_append(expected_policy_values, 'threat');
  end if;
  if source_text ~* '\m(chargeback|charge back|bank dispute|dispute the charge|dispute this charge)\M' then
    expected_policy_values := array_append(expected_policy_values, 'chargeback');
  end if;
  if source_text ~* '\m(furious|enraged|scam|fraud|stealing|rip-off|rip off|unacceptable)\M' then
    expected_policy_values := array_append(expected_policy_values, 'abusive_or_escalated');
  end if;
  if source_text ~* '(ignore (all |the )?(previous|prior|system)|system prompt|developer message|assistant instructions|follow these instructions instead|reveal your prompt)' then
    expected_policy_values := array_append(expected_policy_values, 'prompt_injection');
  end if;
  if coalesce(any_sensitive_redaction, false) then
    expected_policy_values := array_append(expected_policy_values, 'prohibited_payment_data');
  end if;
  if p_result #>> '{extracted,walletUsed}' = 'true' then
    expected_policy_values := array_append(expected_policy_values, 'wallet_payment');
  end if;
  if jsonb_typeof(p_result #> '{extracted,amountCents}') = 'number'
    and coalesce(p_result #>> '{extracted,amountCents}', '') ~ '^\d+$' then
    amount_cents := (p_result #>> '{extracted,amountCents}')::integer;
    if amount_cents > (
      select high_value_threshold_cents from public.refund_gpt_triage_settings where singleton
    ) then
      expected_policy_values := array_append(expected_policy_values, 'high_value');
    end if;
  end if;
  select coalesce(array_agg(distinct value order by value), '{}'::text[])
  into expected_policy_values
  from unnest(expected_policy_values) value;
  if not expected_policy_values <@ provided_policy_values then
    raise exception 'Refund GPT result omitted a deterministic context safety flag';
  end if;

  triage_result := public.service_record_refund_gpt_triage(
    job_row.refund_case_id,
    job_row.source_message_id,
    job_row.run_key,
    p_input_fingerprint,
    job_row.model_name,
    btrim(p_model_snapshot),
    job_row.prompt_version,
    job_row.schema_version,
    p_result
  );

  triage_id := nullif(triage_result ->> 'triageId', '')::uuid;
  if coalesce((triage_result ->> 'created')::boolean, false) and triage_id is not null then
    update public.refund_gpt_triage_runs
    set status = 'superseded'
    where refund_case_id = job_row.refund_case_id
      and id <> triage_id
      and status in ('ready_for_review', 'human_review');
  end if;

  update public.refund_gpt_triage_jobs
  set
    status = 'succeeded',
    input_fingerprint = p_input_fingerprint,
    model_snapshot = btrim(p_model_snapshot),
    finished_at = now(),
    failure_category = null,
    error_code = null
  where id = job_row.id;

  return triage_result;
end;
$$;

create or replace function public.service_fail_refund_gpt_triage_job(
  p_job_id uuid,
  p_failure_category text,
  p_error_code text
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  job_row public.refund_gpt_triage_jobs;
  normalized_category text := lower(btrim(coalesce(p_failure_category, '')));
  normalized_error text := lower(btrim(coalesce(p_error_code, '')));
begin
  if normalized_category not in (
    'provider_configuration', 'provider_http', 'provider_timeout', 'provider_refusal',
    'provider_schema', 'database_validation', 'internal'
  ) or normalized_error !~ '^[a-z0-9_:-]{3,80}$' then
    raise exception 'Valid redacted refund GPT failure category and code required';
  end if;

  select * into job_row
  from public.refund_gpt_triage_jobs
  where id = p_job_id
  for update;

  if job_row.id is null then
    raise exception 'Refund GPT triage job not found';
  end if;
  if job_row.status <> 'processing' then
    return jsonb_build_object('updated', false, 'status', job_row.status);
  end if;

  update public.refund_gpt_triage_jobs
  set
    status = 'failed',
    failure_category = normalized_category,
    error_code = normalized_error,
    finished_at = now()
  where id = job_row.id;

  return jsonb_build_object('updated', true, 'status', 'failed');
end;
$$;

create or replace function public.service_purge_refund_gpt_triage_jobs(p_limit integer default 200)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  deleted_count integer := 0;
begin
  with expired as (
    select id
    from public.refund_gpt_triage_jobs
    where created_at < now() - interval '30 days'
      and status in ('succeeded', 'failed')
    order by created_at, id
    limit least(greatest(coalesce(p_limit, 200), 1), 1000)
    for update skip locked
  )
  delete from public.refund_gpt_triage_jobs job
  using expired
  where job.id = expired.id;

  get diagnostics deleted_count = row_count;
  return deleted_count;
end;
$$;

revoke execute on function public.service_claim_refund_gpt_triage_jobs(text,text,text,text,integer) from public, anon, authenticated;
revoke execute on function public.service_complete_refund_gpt_triage_job(uuid,text,text,jsonb) from public, anon, authenticated;
revoke execute on function public.service_fail_refund_gpt_triage_job(uuid,text,text) from public, anon, authenticated;
revoke execute on function public.service_purge_refund_gpt_triage_jobs(integer) from public, anon, authenticated;

grant execute on function public.service_claim_refund_gpt_triage_jobs(text,text,text,text,integer) to service_role;
grant execute on function public.service_complete_refund_gpt_triage_job(uuid,text,text,jsonb) to service_role;
grant execute on function public.service_fail_refund_gpt_triage_job(uuid,text,text) to service_role;
grant execute on function public.service_purge_refund_gpt_triage_jobs(integer) to service_role;

comment on table public.refund_gpt_triage_jobs is
  'Service-only idempotency and aggregate failure ledger for the default-off OpenAI refund triage runner; stores no raw input or provider output.';
comment on function public.service_claim_refund_gpt_triage_jobs(text,text,text,text,integer) is
  'Claims only the latest eligible inbound Gmail message per open refund case and returns identity-minimized recent text to the server-only runner.';
comment on function public.service_complete_refund_gpt_triage_job(uuid,text,text,jsonb) is
  'Rejects stale source context, then atomically validates and records one strict human-reviewed triage result and supersedes older unreviewed suggestions for the same case.';
