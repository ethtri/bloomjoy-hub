-- Human-reviewed GPT triage foundation for Gmail refund drafts.
-- This migration does not call a model and leaves provider processing disabled by default.

create table if not exists public.refund_gpt_triage_settings (
  singleton boolean primary key default true check (singleton),
  enabled boolean not null default false,
  human_review_required boolean not null default true check (human_review_required),
  auto_send_enabled boolean not null default false check (not auto_send_enabled),
  high_value_threshold_cents integer not null default 2500 check (high_value_threshold_cents between 1 and 100000),
  prompt_version text not null default 'refund_missing_info_v1',
  schema_version text not null default 'refund_gpt_triage_v1',
  updated_at timestamptz not null default now(),
  updated_by uuid references auth.users (id) on delete set null,
  constraint refund_gpt_triage_settings_prompt_length check (length(prompt_version) between 3 and 80),
  constraint refund_gpt_triage_settings_schema_length check (length(schema_version) between 3 and 80)
);

insert into public.refund_gpt_triage_settings (singleton)
values (true)
on conflict (singleton) do nothing;

create table if not exists public.refund_gpt_triage_runs (
  id uuid primary key default gen_random_uuid(),
  refund_case_id uuid not null references public.refund_cases (id) on delete cascade,
  source_message_id uuid not null references public.refund_gmail_messages (id) on delete cascade,
  run_key text not null unique,
  input_fingerprint text not null,
  provider_name text not null default 'openai' check (provider_name = 'openai'),
  model_name text not null,
  model_snapshot text not null,
  prompt_version text not null,
  schema_version text not null,
  status text not null check (
    status in ('ready_for_review', 'human_review', 'approved', 'rejected', 'superseded', 'failed')
  ),
  classification text not null check (classification in ('refund', 'unrelated', 'uncertain')),
  confidence_band text not null check (confidence_band in ('high', 'medium', 'low')),
  language text not null,
  route text not null check (route in ('draft_reply', 'human_review')),
  summary text,
  extracted_fields jsonb not null default '{}'::jsonb,
  missing_fields text[] not null default '{}'::text[],
  policy_flags text[] not null default '{}'::text[],
  draft_subject text,
  draft_body text,
  payload_redacted boolean not null default true check (payload_redacted),
  reviewer_outcome text check (
    reviewer_outcome is null or reviewer_outcome in (
      'approved', 'edited', 'rejected', 'wrong_classification', 'wrong_missing_fields',
      'unsafe_draft', 'wrong_policy_route', 'other'
    )
  ),
  review_reason text,
  draft_was_edited boolean,
  reviewed_by uuid references auth.users (id) on delete set null,
  reviewed_at timestamptz,
  sent_message_id uuid references public.refund_case_messages (id) on delete set null,
  retention_expires_at timestamptz not null default (now() + interval '30 days'),
  content_deleted_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint refund_gpt_triage_runs_run_key_length check (length(run_key) between 8 and 255),
  constraint refund_gpt_triage_runs_fingerprint_format check (input_fingerprint ~ '^[a-f0-9]{64}$'),
  constraint refund_gpt_triage_runs_model_name_length check (length(model_name) between 1 and 120),
  constraint refund_gpt_triage_runs_model_snapshot_length check (length(model_snapshot) between 1 and 160),
  constraint refund_gpt_triage_runs_prompt_length check (length(prompt_version) between 3 and 80),
  constraint refund_gpt_triage_runs_schema_length check (length(schema_version) between 3 and 80),
  constraint refund_gpt_triage_runs_language_format check (language ~ '^[a-z]{2,3}(-[A-Z]{2})?$'),
  constraint refund_gpt_triage_runs_summary_length check (summary is null or length(summary) between 1 and 600),
  constraint refund_gpt_triage_runs_extracted_object check (jsonb_typeof(extracted_fields) = 'object'),
  constraint refund_gpt_triage_runs_missing_fields_allowed check (
    missing_fields <@ array[
      'location_or_machine', 'incident_date', 'incident_time', 'payment_method', 'amount', 'card_last4'
    ]::text[]
  ),
  constraint refund_gpt_triage_runs_policy_flags_allowed check (
    policy_flags <@ array[
      'legal', 'safety', 'threat', 'chargeback', 'abusive_or_escalated', 'prompt_injection',
      'high_value', 'wallet_payment', 'prohibited_payment_data'
    ]::text[]
  ),
  constraint refund_gpt_triage_runs_route_shape check (
    (
      route = 'draft_reply'
      and classification = 'refund'
      and confidence_band in ('high', 'medium')
      and language = 'en'
      and status in ('ready_for_review', 'approved', 'rejected', 'superseded', 'failed')
    )
    or (
      route = 'human_review'
      and status in ('human_review', 'rejected', 'superseded', 'failed')
    )
  ),
  constraint refund_gpt_triage_runs_draft_shape check (
    content_deleted_at is not null
    or (
      route = 'draft_reply'
      and status <> 'human_review'
      and cardinality(missing_fields) > 0
      and cardinality(policy_flags) = 0
      and draft_subject is not null
      and length(draft_subject) between 1 and 180
      and draft_body is not null
      and length(draft_body) between 1 and 4000
    )
    or (
      route = 'human_review'
      and draft_subject is null
      and draft_body is null
    )
  ),
  constraint refund_gpt_triage_runs_review_shape check (
    (reviewer_outcome is null and reviewed_by is null and reviewed_at is null and draft_was_edited is null)
    or (reviewer_outcome is not null and reviewed_by is not null and reviewed_at is not null and draft_was_edited is not null)
  ),
  constraint refund_gpt_triage_runs_retention_window check (retention_expires_at <= created_at + interval '31 days'),
  constraint refund_gpt_triage_runs_source_version_unique unique (source_message_id, prompt_version, model_snapshot)
);

create index if not exists refund_gpt_triage_runs_case_created_idx
  on public.refund_gpt_triage_runs (refund_case_id, created_at desc);

create index if not exists refund_gpt_triage_runs_review_queue_idx
  on public.refund_gpt_triage_runs (status, created_at)
  where status in ('ready_for_review', 'human_review');

create index if not exists refund_gpt_triage_runs_retention_idx
  on public.refund_gpt_triage_runs (retention_expires_at)
  where content_deleted_at is null;

drop trigger if exists refund_gpt_triage_runs_set_updated_at on public.refund_gpt_triage_runs;
create trigger refund_gpt_triage_runs_set_updated_at
before update on public.refund_gpt_triage_runs
for each row execute function public.set_updated_at();

alter table public.refund_gpt_triage_settings enable row level security;
alter table public.refund_gpt_triage_runs enable row level security;

revoke all on table public.refund_gpt_triage_settings from public, anon, authenticated;
revoke all on table public.refund_gpt_triage_runs from public, anon, authenticated;
grant all on table public.refund_gpt_triage_settings to service_role;
grant all on table public.refund_gpt_triage_runs to service_role;

create or replace function public.service_record_refund_gpt_triage(
  p_refund_case_id uuid,
  p_source_message_id uuid,
  p_run_key text,
  p_input_fingerprint text,
  p_model_name text,
  p_model_snapshot text,
  p_prompt_version text,
  p_schema_version text,
  p_result jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  settings_row public.refund_gpt_triage_settings;
  source_row public.refund_gmail_messages;
  existing_row public.refund_gpt_triage_runs;
  result_keys text[];
  extracted_keys text[];
  draft_keys text[];
  missing_values text[];
  expected_missing_values text[] := '{}'::text[];
  policy_values text[];
  expected_policy_values text[] := '{}'::text[];
  route_value text;
  status_value text;
  source_text text;
  amount_cents integer;
  inserted_row public.refund_gpt_triage_runs;
begin
  select * into settings_row
  from public.refund_gpt_triage_settings
  where singleton;

  if not coalesce(settings_row.enabled, false) then
    raise exception 'Refund GPT triage is disabled';
  end if;
  if coalesce(settings_row.auto_send_enabled, false) or not coalesce(settings_row.human_review_required, true) then
    raise exception 'Refund GPT triage must remain human reviewed';
  end if;
  if p_prompt_version <> settings_row.prompt_version or p_schema_version <> settings_row.schema_version then
    raise exception 'Approved refund GPT prompt and schema versions required';
  end if;
  if coalesce(p_input_fingerprint, '') !~ '^[a-f0-9]{64}$' then
    raise exception 'Valid redacted input fingerprint required';
  end if;
  if length(btrim(coalesce(p_run_key, ''))) not between 8 and 255 then
    raise exception 'Valid GPT triage run key required';
  end if;

  select * into source_row
  from public.refund_gmail_messages
  where id = p_source_message_id
    and refund_case_id = p_refund_case_id
    and direction = 'inbound'
    and message_kind = 'message';

  if source_row.id is null then
    raise exception 'Inbound Gmail source message required';
  end if;

  select * into existing_row
  from public.refund_gpt_triage_runs
  where run_key = btrim(p_run_key)
     or (
       source_message_id = p_source_message_id
       and prompt_version = p_prompt_version
       and model_snapshot = btrim(p_model_snapshot)
     )
  order by created_at desc
  limit 1;

  if existing_row.id is not null then
    return jsonb_build_object('created', false, 'triageId', existing_row.id, 'status', existing_row.status);
  end if;

  if jsonb_typeof(coalesce(p_result, 'null'::jsonb)) <> 'object' then
    raise exception 'Structured refund GPT result required';
  end if;

  select coalesce(array_agg(key order by key), '{}'::text[]) into result_keys
  from jsonb_object_keys(p_result) key;
  if result_keys <> array[
    'classification', 'confidenceBand', 'draft', 'extracted', 'language', 'missingFields',
    'policyFlags', 'route', 'schemaVersion', 'summary'
  ]::text[] then
    raise exception 'Refund GPT result contains unapproved fields';
  end if;
  if p_result ->> 'schemaVersion' <> p_schema_version then
    raise exception 'Refund GPT result schema version mismatch';
  end if;
  if jsonb_typeof(p_result -> 'extracted') <> 'object'
    or jsonb_typeof(p_result -> 'missingFields') <> 'array'
    or jsonb_typeof(p_result -> 'policyFlags') <> 'array' then
    raise exception 'Refund GPT result shape is invalid';
  end if;

  select coalesce(array_agg(key order by key), '{}'::text[]) into extracted_keys
  from jsonb_object_keys(p_result -> 'extracted') key;
  if extracted_keys <> array[
    'amountCents', 'cardLast4', 'incidentDate', 'incidentTime', 'locationName', 'machineLabel',
    'paymentMethod', 'walletUsed'
  ]::text[] then
    raise exception 'Refund GPT extracted fields contain unapproved keys';
  end if;

  if p_result ->> 'classification' not in ('refund', 'unrelated', 'uncertain')
    or p_result ->> 'confidenceBand' not in ('high', 'medium', 'low')
    or coalesce(p_result ->> 'language', '') !~ '^[a-z]{2,3}(-[A-Z]{2})?$'
    or length(btrim(coalesce(p_result ->> 'summary', ''))) not between 1 and 600 then
    raise exception 'Refund GPT classification metadata is invalid';
  end if;

  if coalesce(p_result #>> '{extracted,locationName}', '') <> ''
    and length(btrim(p_result #>> '{extracted,locationName}')) > 160 then
    raise exception 'Refund GPT location is invalid';
  end if;
  if coalesce(p_result #>> '{extracted,machineLabel}', '') <> ''
    and length(btrim(p_result #>> '{extracted,machineLabel}')) > 160 then
    raise exception 'Refund GPT machine label is invalid';
  end if;
  if p_result #> '{extracted,incidentDate}' <> 'null'::jsonb
    and coalesce(p_result #>> '{extracted,incidentDate}', '') !~ '^\d{4}-\d{2}-\d{2}$' then
    raise exception 'Refund GPT incident date is invalid';
  end if;
  if p_result #> '{extracted,incidentTime}' <> 'null'::jsonb
    and coalesce(p_result #>> '{extracted,incidentTime}', '') !~ '^\d{2}:\d{2}$' then
    raise exception 'Refund GPT incident time is invalid';
  end if;
  if coalesce(p_result #>> '{extracted,paymentMethod}', '') not in ('card', 'cash', 'unknown') then
    raise exception 'Refund GPT payment method is invalid';
  end if;
  if p_result #> '{extracted,amountCents}' <> 'null'::jsonb then
    if jsonb_typeof(p_result #> '{extracted,amountCents}') <> 'number'
      or coalesce(p_result #>> '{extracted,amountCents}', '') !~ '^\d+$' then
      raise exception 'Refund GPT amount is invalid';
    end if;
    amount_cents := (p_result #>> '{extracted,amountCents}')::integer;
    if amount_cents not between 1 and 100000 then
      raise exception 'Refund GPT amount is invalid';
    end if;
  end if;
  if p_result #> '{extracted,cardLast4}' <> 'null'::jsonb
    and (
      jsonb_typeof(p_result #> '{extracted,cardLast4}') <> 'string'
      or coalesce(p_result #>> '{extracted,cardLast4}', '') !~ '^\d{4}$'
    ) then
    raise exception 'Refund GPT card last four is invalid';
  end if;
  if p_result #> '{extracted,walletUsed}' <> 'null'::jsonb
    and jsonb_typeof(p_result #> '{extracted,walletUsed}') <> 'boolean' then
    raise exception 'Refund GPT wallet indicator is invalid';
  end if;

  select coalesce(array_agg(value order by value), '{}'::text[]) into missing_values
  from jsonb_array_elements_text(p_result -> 'missingFields') value;
  select coalesce(array_agg(value order by value), '{}'::text[]) into policy_values
  from jsonb_array_elements_text(p_result -> 'policyFlags') value;

  if not missing_values <@ array[
    'location_or_machine', 'incident_date', 'incident_time', 'payment_method', 'amount', 'card_last4'
  ]::text[] then
    raise exception 'Refund GPT result contains an unsupported missing field';
  end if;
  if not policy_values <@ array[
    'legal', 'safety', 'threat', 'chargeback', 'abusive_or_escalated', 'prompt_injection',
    'high_value', 'wallet_payment', 'prohibited_payment_data'
  ]::text[] then
    raise exception 'Refund GPT result contains an unsupported policy flag';
  end if;

  if coalesce(p_result #>> '{extracted,locationName}', '') = ''
    and coalesce(p_result #>> '{extracted,machineLabel}', '') = '' then
    expected_missing_values := array_append(expected_missing_values, 'location_or_machine');
  end if;
  if p_result #> '{extracted,incidentDate}' = 'null'::jsonb then
    expected_missing_values := array_append(expected_missing_values, 'incident_date');
  end if;
  if p_result #> '{extracted,incidentTime}' = 'null'::jsonb then
    expected_missing_values := array_append(expected_missing_values, 'incident_time');
  end if;
  if p_result #>> '{extracted,paymentMethod}' = 'unknown' then
    expected_missing_values := array_append(expected_missing_values, 'payment_method');
  end if;
  if p_result #> '{extracted,amountCents}' = 'null'::jsonb then
    expected_missing_values := array_append(expected_missing_values, 'amount');
  end if;
  if p_result #>> '{extracted,paymentMethod}' = 'card'
    and p_result #> '{extracted,cardLast4}' = 'null'::jsonb then
    expected_missing_values := array_append(expected_missing_values, 'card_last4');
  end if;
  select coalesce(array_agg(value order by value), '{}'::text[]) into expected_missing_values
  from unnest(expected_missing_values) value;
  if missing_values <> expected_missing_values then
    raise exception 'Refund GPT missing fields do not match extracted facts';
  end if;

  source_text := coalesce(source_row.subject, '') || E'\n' || coalesce(source_row.plain_body, '');
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
  if amount_cents > settings_row.high_value_threshold_cents then
    expected_policy_values := array_append(expected_policy_values, 'high_value');
  end if;
  if p_result #>> '{extracted,walletUsed}' = 'true' then
    expected_policy_values := array_append(expected_policy_values, 'wallet_payment');
  end if;
  if source_row.sensitive_data_redacted then
    expected_policy_values := array_append(expected_policy_values, 'prohibited_payment_data');
  end if;
  select coalesce(array_agg(distinct value order by value), '{}'::text[]) into expected_policy_values
  from unnest(expected_policy_values) value;
  if not expected_policy_values <@ policy_values then
    raise exception 'Refund GPT result omitted a deterministic safety flag';
  end if;

  route_value := p_result ->> 'route';
  if route_value not in ('draft_reply', 'human_review') then
    raise exception 'Refund GPT result route is invalid';
  end if;
  if route_value = 'draft_reply' then
    if p_result ->> 'classification' <> 'refund'
      or p_result ->> 'confidenceBand' not in ('high', 'medium')
      or p_result ->> 'language' <> 'en'
      or cardinality(policy_values) > 0
      or cardinality(missing_values) = 0
      or jsonb_typeof(p_result -> 'draft') <> 'object'
      or coalesce(p_result #>> '{draft,subject}', '') = ''
      or coalesce(p_result #>> '{draft,body}', '') = '' then
      raise exception 'Refund GPT draft is not eligible for manager review';
    end if;
    select coalesce(array_agg(key order by key), '{}'::text[]) into draft_keys
    from jsonb_object_keys(p_result -> 'draft') key;
    if draft_keys <> array['body', 'subject']::text[]
      or length(btrim(p_result #>> '{draft,subject}')) not between 1 and 180
      or length(btrim(p_result #>> '{draft,body}')) not between 1 and 4000 then
      raise exception 'Refund GPT draft contains unapproved fields or length';
    end if;
    status_value := 'ready_for_review';
  else
    if p_result -> 'draft' <> 'null'::jsonb then
      raise exception 'Human-review result cannot include a customer draft';
    end if;
    status_value := 'human_review';
  end if;

  insert into public.refund_gpt_triage_runs (
    refund_case_id,
    source_message_id,
    run_key,
    input_fingerprint,
    model_name,
    model_snapshot,
    prompt_version,
    schema_version,
    status,
    classification,
    confidence_band,
    language,
    route,
    summary,
    extracted_fields,
    missing_fields,
    policy_flags,
    draft_subject,
    draft_body,
    retention_expires_at
  )
  values (
    p_refund_case_id,
    p_source_message_id,
    btrim(p_run_key),
    p_input_fingerprint,
    left(btrim(p_model_name), 120),
    left(btrim(p_model_snapshot), 160),
    p_prompt_version,
    p_schema_version,
    status_value,
    p_result ->> 'classification',
    p_result ->> 'confidenceBand',
    p_result ->> 'language',
    route_value,
    left(btrim(p_result ->> 'summary'), 600),
    p_result -> 'extracted',
    missing_values,
    policy_values,
    nullif(left(btrim(p_result #>> '{draft,subject}'), 180), ''),
    nullif(left(btrim(p_result #>> '{draft,body}'), 4000), ''),
    now() + interval '30 days'
  )
  returning * into inserted_row;

  insert into public.refund_case_events (
    refund_case_id,
    event_type,
    message,
    metadata
  )
  values (
    p_refund_case_id,
    case when status_value = 'ready_for_review' then 'gpt_triage_ready' else 'gpt_triage_human_review' end,
    case
      when status_value = 'ready_for_review' then 'A redacted GPT-assisted reply draft is ready for manager review.'
      else 'GPT-assisted triage routed the message to a person without drafting a reply.'
    end,
    jsonb_build_object(
      'triage_id', inserted_row.id,
      'classification', inserted_row.classification,
      'confidence_band', inserted_row.confidence_band,
      'route', inserted_row.route,
      'prompt_version', inserted_row.prompt_version,
      'model_snapshot', inserted_row.model_snapshot,
      'policy_flags', inserted_row.policy_flags,
      'payload_redacted', true
    )
  );

  return jsonb_build_object('created', true, 'triageId', inserted_row.id, 'status', inserted_row.status);
end;
$$;

create or replace function public.admin_get_refund_gpt_triage(p_refund_case_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = public, auth
as $$
declare
  actor_user_id uuid := auth.uid();
  triage_row public.refund_gpt_triage_runs;
begin
  if actor_user_id is null then
    raise exception 'Authentication required';
  end if;
  if not public.can_manage_refund_case(actor_user_id, p_refund_case_id) then
    raise exception 'Refund case access required';
  end if;

  select * into triage_row
  from public.refund_gpt_triage_runs
  where refund_case_id = p_refund_case_id
  order by created_at desc, id desc
  limit 1;

  if triage_row.id is null then
    return null;
  end if;

  return jsonb_build_object(
    'id', triage_row.id,
    'status', triage_row.status,
    'classification', triage_row.classification,
    'confidenceBand', triage_row.confidence_band,
    'language', triage_row.language,
    'route', triage_row.route,
    'summary', triage_row.summary,
    'extractedFields', triage_row.extracted_fields,
    'missingFields', to_jsonb(triage_row.missing_fields),
    'policyFlags', to_jsonb(triage_row.policy_flags),
    'draftSubject', triage_row.draft_subject,
    'draftBody', triage_row.draft_body,
    'promptVersion', triage_row.prompt_version,
    'modelName', triage_row.model_name,
    'modelSnapshot', triage_row.model_snapshot,
    'humanReviewRequired', true,
    'contentDeleted', triage_row.content_deleted_at is not null,
    'reviewerOutcome', triage_row.reviewer_outcome,
    'reviewReason', triage_row.review_reason,
    'draftWasEdited', triage_row.draft_was_edited,
    'reviewedAt', triage_row.reviewed_at,
    'createdAt', triage_row.created_at
  );
end;
$$;

create or replace function public.admin_reject_refund_gpt_triage(
  p_triage_id uuid,
  p_reason_code text,
  p_reason text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public, auth
as $$
declare
  actor_user_id uuid := auth.uid();
  triage_row public.refund_gpt_triage_runs;
  normalized_reason_code text := lower(btrim(coalesce(p_reason_code, '')));
begin
  if actor_user_id is null then
    raise exception 'Authentication required';
  end if;

  select * into triage_row
  from public.refund_gpt_triage_runs
  where id = p_triage_id
  for update;

  if triage_row.id is null then
    raise exception 'Refund GPT triage suggestion not found';
  end if;
  if not public.can_manage_refund_case(actor_user_id, triage_row.refund_case_id) then
    raise exception 'Refund case access required';
  end if;
  if triage_row.status not in ('ready_for_review', 'human_review') then
    raise exception 'Refund GPT triage suggestion is no longer reviewable';
  end if;
  if normalized_reason_code not in (
    'rejected', 'wrong_classification', 'wrong_missing_fields', 'unsafe_draft', 'wrong_policy_route', 'other'
  ) then
    raise exception 'Choose an approved triage rejection reason';
  end if;
  if normalized_reason_code = 'other' and length(btrim(coalesce(p_reason, ''))) < 5 then
    raise exception 'A short review reason is required';
  end if;

  update public.refund_gpt_triage_runs
  set status = 'rejected',
      reviewer_outcome = normalized_reason_code,
      review_reason = nullif(left(btrim(coalesce(p_reason, '')), 500), ''),
      draft_was_edited = false,
      reviewed_by = actor_user_id,
      reviewed_at = now()
  where id = triage_row.id
  returning * into triage_row;

  insert into public.refund_case_events (
    refund_case_id,
    actor_user_id,
    event_type,
    message,
    metadata
  )
  values (
    triage_row.refund_case_id,
    actor_user_id,
    'gpt_triage_rejected',
    'Manager rejected the GPT-assisted triage suggestion.',
    jsonb_build_object(
      'triage_id', triage_row.id,
      'reviewer_outcome', triage_row.reviewer_outcome,
      'payload_redacted', true
    )
  );

  return jsonb_build_object('ok', true, 'triageId', triage_row.id, 'status', triage_row.status);
end;
$$;

create or replace function public.service_record_refund_gpt_triage_delivery(
  p_triage_id uuid,
  p_refund_case_id uuid,
  p_reviewer_user_id uuid,
  p_sent_message_id uuid,
  p_subject text,
  p_body text
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  triage_row public.refund_gpt_triage_runs;
  was_edited boolean;
begin
  select * into triage_row
  from public.refund_gpt_triage_runs
  where id = p_triage_id
    and refund_case_id = p_refund_case_id
  for update;

  if triage_row.id is null then
    raise exception 'Refund GPT triage suggestion not found';
  end if;
  if triage_row.status <> 'ready_for_review' or triage_row.route <> 'draft_reply'
    or cardinality(triage_row.policy_flags) > 0 then
    raise exception 'Refund GPT triage suggestion is not eligible for delivery';
  end if;
  if not public.can_manage_refund_case(p_reviewer_user_id, p_refund_case_id) then
    raise exception 'Refund case access required';
  end if;
  if not exists (
    select 1
    from public.refund_case_messages message
    where message.id = p_sent_message_id
      and message.refund_case_id = p_refund_case_id
      and message.status = 'sent'
  ) then
    raise exception 'A sent customer message is required before triage approval';
  end if;

  was_edited := btrim(coalesce(p_subject, '')) <> btrim(coalesce(triage_row.draft_subject, ''))
    or btrim(coalesce(p_body, '')) <> btrim(coalesce(triage_row.draft_body, ''));

  update public.refund_gpt_triage_runs
  set status = 'approved',
      reviewer_outcome = case when was_edited then 'edited' else 'approved' end,
      draft_was_edited = was_edited,
      reviewed_by = p_reviewer_user_id,
      reviewed_at = now(),
      sent_message_id = p_sent_message_id
  where id = triage_row.id
  returning * into triage_row;

  insert into public.refund_case_events (
    refund_case_id,
    actor_user_id,
    event_type,
    message,
    metadata
  )
  values (
    p_refund_case_id,
    p_reviewer_user_id,
    'gpt_triage_approved',
    case
      when was_edited then 'Manager edited and approved the GPT-assisted reply after successful delivery.'
      else 'Manager approved the GPT-assisted reply after successful delivery.'
    end,
    jsonb_build_object(
      'triage_id', triage_row.id,
      'reviewer_outcome', triage_row.reviewer_outcome,
      'sent_message_id', p_sent_message_id,
      'payload_redacted', true
    )
  );

  return jsonb_build_object(
    'ok', true,
    'triageId', triage_row.id,
    'status', triage_row.status,
    'reviewerOutcome', triage_row.reviewer_outcome
  );
end;
$$;

create or replace function public.admin_get_refund_gpt_triage_metrics()
returns jsonb
language plpgsql
stable
security definer
set search_path = public, auth
as $$
declare
  actor_user_id uuid := auth.uid();
begin
  if actor_user_id is null then
    raise exception 'Authentication required';
  end if;
  if not (public.is_super_admin(actor_user_id) or public.is_scoped_admin(actor_user_id)) then
    raise exception 'Refund operations admin access required';
  end if;

  return (
    select jsonb_build_object(
      'totalRuns', count(*),
      'readyForReview', count(*) filter (where status = 'ready_for_review'),
      'humanReview', count(*) filter (where route = 'human_review'),
      'approved', count(*) filter (where reviewer_outcome in ('approved', 'edited')),
      'edited', count(*) filter (where reviewer_outcome = 'edited'),
      'rejected', count(*) filter (where status = 'rejected'),
      'falseRouting', count(*) filter (where reviewer_outcome in ('wrong_classification', 'wrong_policy_route')),
      'missingFieldCorrections', count(*) filter (where reviewer_outcome = 'wrong_missing_fields'),
      'unsafeDrafts', count(*) filter (where reviewer_outcome = 'unsafe_draft'),
      'draftAcceptanceRate', case
        when count(*) filter (where route = 'draft_reply' and reviewer_outcome is not null) = 0 then null
        else round(
          (count(*) filter (where reviewer_outcome in ('approved', 'edited')))::numeric
          / (count(*) filter (where route = 'draft_reply' and reviewer_outcome is not null))::numeric,
          4
        )
      end,
      'draftEditRate', case
        when count(*) filter (where reviewer_outcome in ('approved', 'edited')) = 0 then null
        else round(
          (count(*) filter (where reviewer_outcome = 'edited'))::numeric
          / (count(*) filter (where reviewer_outcome in ('approved', 'edited')))::numeric,
          4
        )
      end,
      'payloadRedacted', true
    )
    from public.refund_gpt_triage_runs
    where created_at >= now() - interval '30 days'
  );
end;
$$;

create or replace function public.service_purge_refund_gpt_triage_expired_content(p_limit integer default 200)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  purged_count integer;
begin
  with expired as (
    select id
    from public.refund_gpt_triage_runs
    where content_deleted_at is null
      and retention_expires_at <= now()
    order by retention_expires_at
    limit least(greatest(coalesce(p_limit, 200), 1), 1000)
    for update skip locked
  )
  update public.refund_gpt_triage_runs triage
  set summary = null,
      extracted_fields = '{}'::jsonb,
      missing_fields = '{}'::text[],
      draft_subject = null,
      draft_body = null,
      review_reason = null,
      content_deleted_at = now()
  from expired
  where triage.id = expired.id;

  get diagnostics purged_count = row_count;
  return purged_count;
end;
$$;

revoke execute on function public.service_record_refund_gpt_triage(uuid,uuid,text,text,text,text,text,text,jsonb) from public, anon, authenticated;
revoke execute on function public.service_record_refund_gpt_triage_delivery(uuid,uuid,uuid,uuid,text,text) from public, anon, authenticated;
revoke execute on function public.service_purge_refund_gpt_triage_expired_content(integer) from public, anon, authenticated;
grant execute on function public.service_record_refund_gpt_triage(uuid,uuid,text,text,text,text,text,text,jsonb) to service_role;
grant execute on function public.service_record_refund_gpt_triage_delivery(uuid,uuid,uuid,uuid,text,text) to service_role;
grant execute on function public.service_purge_refund_gpt_triage_expired_content(integer) to service_role;

revoke execute on function public.admin_get_refund_gpt_triage(uuid) from public, anon;
revoke execute on function public.admin_reject_refund_gpt_triage(uuid,text,text) from public, anon;
revoke execute on function public.admin_get_refund_gpt_triage_metrics() from public, anon;
grant execute on function public.admin_get_refund_gpt_triage(uuid) to authenticated;
grant execute on function public.admin_reject_refund_gpt_triage(uuid,text,text) to authenticated;
grant execute on function public.admin_get_refund_gpt_triage_metrics() to authenticated;

comment on table public.refund_gpt_triage_runs is
  'Redacted structured GPT triage outputs and human reviewer outcomes; raw model input and provider payloads are not stored.';
comment on function public.admin_get_refund_gpt_triage(uuid) is
  'Authorized manager view of the latest redacted GPT-assisted triage suggestion for a refund case.';
comment on function public.service_record_refund_gpt_triage_delivery(uuid,uuid,uuid,uuid,text,text) is
  'Records manager approval only after the corresponding customer message has been sent successfully.';

select pg_notify('pgrst', 'reload schema');
