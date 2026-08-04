-- Default-off SMS Google Form -> Refund Operations case bridge.
-- This migration adds service-only ingestion and aggregate/quarantine visibility.
-- It does not enable Google access, schedules, customer communication, or payment execution.

alter table public.refund_cases
  drop constraint if exists refund_cases_intake_source_check;

alter table public.refund_cases
  add constraint refund_cases_intake_source_check
  check (intake_source in ('form', 'gmail', 'sms_google_form'));

alter table public.refund_cases
  drop constraint if exists refund_cases_processing_fields_complete;

alter table public.refund_cases
  add constraint refund_cases_processing_fields_complete
  check (
    (status = 'draft' and intake_source in ('gmail', 'sms_google_form'))
    or (
      status <> 'draft'
      and reporting_machine_id is not null
      and reporting_location_id is not null
      and incident_at is not null
      and payment_method is not null
    )
  );

alter table public.refund_cases
  drop constraint if exists refund_cases_cash_zelle_contact_present;

alter table public.refund_cases
  add constraint refund_cases_cash_zelle_contact_present
  check (
    payment_method <> 'cash'
    or status = 'draft'
    or length(trim(coalesce(zelle_payment_contact, ''))) > 0
  );

create table if not exists public.refund_google_form_sync_runs (
  id uuid primary key default gen_random_uuid(),
  run_key text not null,
  trigger_source text not null,
  source_version text not null,
  status text not null default 'running',
  rows_seen integer not null default 0,
  rows_imported integer not null default 0,
  rows_updated integer not null default 0,
  rows_duplicate integer not null default 0,
  rows_quarantined integer not null default 0,
  rows_skipped integer not null default 0,
  rows_failed integer not null default 0,
  error_code text,
  meta jsonb not null default '{}'::jsonb,
  started_at timestamptz not null default now(),
  completed_at timestamptz,
  created_at timestamptz not null default now(),
  constraint refund_google_form_sync_runs_run_key_unique unique (run_key),
  constraint refund_google_form_sync_runs_run_key_present check (length(btrim(run_key)) between 1 and 240),
  constraint refund_google_form_sync_runs_trigger_check check (trigger_source in ('scheduled', 'manual', 'synthetic_test')),
  constraint refund_google_form_sync_runs_status_check check (status in ('running', 'completed', 'failed', 'disabled')),
  constraint refund_google_form_sync_runs_source_version_present check (length(btrim(source_version)) between 1 and 120),
  constraint refund_google_form_sync_runs_counts_nonnegative check (
    rows_seen >= 0
    and rows_imported >= 0
    and rows_updated >= 0
    and rows_duplicate >= 0
    and rows_quarantined >= 0
    and rows_skipped >= 0
    and rows_failed >= 0
  )
);

create index if not exists refund_google_form_sync_runs_started_idx
  on public.refund_google_form_sync_runs (started_at desc);

create table if not exists public.refund_google_form_import_rows (
  id uuid primary key default gen_random_uuid(),
  source_response_key_hash text not null,
  source_payload_fingerprint text not null,
  source_row_number integer not null,
  source_submitted_at timestamptz,
  source_version text not null,
  refund_case_id uuid references public.refund_cases (id) on delete set null,
  last_seen_run_id uuid references public.refund_google_form_sync_runs (id) on delete set null,
  import_status text not null,
  reason_code text,
  mapping_status text not null,
  missing_fields text[] not null default '{}',
  invalid_fields text[] not null default '{}',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint refund_google_form_import_rows_source_key_unique unique (source_response_key_hash),
  constraint refund_google_form_import_rows_payload_unique unique (source_payload_fingerprint),
  constraint refund_google_form_import_rows_source_key_hash_format check (source_response_key_hash ~ '^[a-f0-9]{64}$'),
  constraint refund_google_form_import_rows_payload_hash_format check (source_payload_fingerprint ~ '^[a-f0-9]{64}$'),
  constraint refund_google_form_import_rows_row_number_check check (source_row_number >= 2),
  constraint refund_google_form_import_rows_status_check check (import_status in ('imported', 'quarantined', 'rejected')),
  constraint refund_google_form_import_rows_mapping_check check (mapping_status in ('matched', 'missing', 'unmapped', 'ambiguous')),
  constraint refund_google_form_import_rows_source_version_present check (length(btrim(source_version)) between 1 and 120)
);

create index if not exists refund_google_form_import_rows_status_updated_idx
  on public.refund_google_form_import_rows (import_status, updated_at desc);

create index if not exists refund_google_form_import_rows_case_idx
  on public.refund_google_form_import_rows (refund_case_id)
  where refund_case_id is not null;

alter table public.refund_google_form_sync_runs enable row level security;
alter table public.refund_google_form_import_rows enable row level security;

revoke all on table public.refund_google_form_sync_runs from anon, authenticated;
revoke all on table public.refund_google_form_import_rows from anon, authenticated;

grant select, insert, update, delete on table public.refund_google_form_sync_runs to service_role;
grant select, insert, update, delete on table public.refund_google_form_import_rows to service_role;

create or replace function public.service_start_refund_google_form_sync(
  p_run_key text,
  p_trigger_source text,
  p_source_version text,
  p_started_at timestamptz default now()
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  normalized_run_key text := left(btrim(coalesce(p_run_key, '')), 240);
  normalized_trigger text := lower(btrim(coalesce(p_trigger_source, '')));
  normalized_version text := left(btrim(coalesce(p_source_version, '')), 120);
  run_row public.refund_google_form_sync_runs;
begin
  if auth.role() <> 'service_role' then
    raise exception 'Service role required';
  end if;
  if normalized_run_key = '' then
    raise exception 'Run key required';
  end if;
  if normalized_trigger not in ('scheduled', 'manual', 'synthetic_test') then
    raise exception 'Valid trigger source required';
  end if;
  if normalized_version = '' then
    raise exception 'Source contract version required';
  end if;

  insert into public.refund_google_form_sync_runs (
    run_key,
    trigger_source,
    source_version,
    status,
    started_at
  )
  values (
    normalized_run_key,
    normalized_trigger,
    normalized_version,
    'running',
    coalesce(p_started_at, now())
  )
  on conflict (run_key) do nothing
  returning * into run_row;

  if run_row.id is null then
    select * into run_row
    from public.refund_google_form_sync_runs
    where run_key = normalized_run_key;

    return jsonb_build_object(
      'claimed', false,
      'runId', run_row.id,
      'status', run_row.status
    );
  end if;

  return jsonb_build_object(
    'claimed', true,
    'runId', run_row.id,
    'status', run_row.status
  );
end;
$$;

create or replace function public.service_finish_refund_google_form_sync(
  p_run_id uuid,
  p_status text,
  p_counts jsonb default '{}'::jsonb,
  p_error_code text default null,
  p_meta jsonb default '{}'::jsonb
)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  normalized_status text := lower(btrim(coalesce(p_status, '')));
begin
  if auth.role() <> 'service_role' then
    raise exception 'Service role required';
  end if;
  if normalized_status not in ('completed', 'failed', 'disabled') then
    raise exception 'Valid final status required';
  end if;
  if jsonb_typeof(coalesce(p_counts, '{}'::jsonb)) <> 'object'
    or jsonb_typeof(coalesce(p_meta, '{}'::jsonb)) <> 'object' then
    raise exception 'Counts and metadata must be JSON objects';
  end if;

  update public.refund_google_form_sync_runs
  set
    status = normalized_status,
    rows_seen = greatest(coalesce((p_counts ->> 'rowsSeen')::integer, 0), 0),
    rows_imported = greatest(coalesce((p_counts ->> 'rowsImported')::integer, 0), 0),
    rows_updated = greatest(coalesce((p_counts ->> 'rowsUpdated')::integer, 0), 0),
    rows_duplicate = greatest(coalesce((p_counts ->> 'rowsDuplicate')::integer, 0), 0),
    rows_quarantined = greatest(coalesce((p_counts ->> 'rowsQuarantined')::integer, 0), 0),
    rows_skipped = greatest(coalesce((p_counts ->> 'rowsSkipped')::integer, 0), 0),
    rows_failed = greatest(coalesce((p_counts ->> 'rowsFailed')::integer, 0), 0),
    error_code = nullif(left(btrim(coalesce(p_error_code, '')), 160), ''),
    meta = coalesce(p_meta, '{}'::jsonb),
    completed_at = now()
  where id = p_run_id;

  return found;
end;
$$;

create or replace function public.service_ingest_refund_google_form_response(
  p_run_id uuid,
  p_source_response_key_hash text,
  p_source_payload_fingerprint text,
  p_source_row_number integer,
  p_source_submitted_local_datetime text,
  p_source_timezone text,
  p_source_version text,
  p_source_start_at timestamptz,
  p_customer_email text,
  p_customer_name text,
  p_source_location text,
  p_incident_local_datetime text,
  p_issue_summary text,
  p_payment_method text,
  p_payment_amount_cents integer,
  p_card_last4 text,
  p_card_wallet_used boolean,
  p_cash_payment_preference text,
  p_cash_payment_contact text,
  p_missing_fields text[] default '{}',
  p_invalid_fields text[] default '{}'
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  normalized_source_key text := lower(btrim(coalesce(p_source_response_key_hash, '')));
  normalized_payload_hash text := lower(btrim(coalesce(p_source_payload_fingerprint, '')));
  normalized_version text := left(btrim(coalesce(p_source_version, '')), 120);
  normalized_email text := lower(left(btrim(coalesce(p_customer_email, '')), 320));
  normalized_name text := nullif(left(btrim(coalesce(p_customer_name, '')), 160), '');
  normalized_location text := left(btrim(coalesce(p_source_location, '')), 240);
  normalized_issue text := left(btrim(coalesce(p_issue_summary, '')), 4000);
  normalized_payment_method text := nullif(lower(btrim(coalesce(p_payment_method, ''))), '');
  normalized_card_last4 text := nullif(regexp_replace(coalesce(p_card_last4, ''), '[^0-9]', '', 'g'), '');
  normalized_cash_preference text := nullif(lower(btrim(coalesce(p_cash_payment_preference, ''))), '');
  normalized_cash_contact text := nullif(left(btrim(coalesce(p_cash_payment_contact, '')), 320), '');
  normalized_source_timezone text := left(btrim(coalesce(p_source_timezone, 'UTC')), 120);
  normalized_missing text[] := '{}';
  normalized_invalid text[] := '{}';
  source_submitted_local timestamp;
  resolved_source_submitted_at timestamptz;
  incident_local timestamp;
  resolved_incident_at timestamptz;
  resolved_incident_resolution text;
  candidate_count integer := 0;
  matched_machine_id uuid;
  matched_location_id uuid;
  matched_timezone text;
  resolved_mapping_status text := 'missing';
  resolved_import_status text := 'rejected';
  resolved_reason_code text;
  import_row public.refund_google_form_import_rows;
  refund_case public.refund_cases;
  existing_case public.refund_cases;
  created_case boolean := false;
  updated_case boolean := false;
  payload_changed boolean := false;
begin
  if auth.role() <> 'service_role' then
    raise exception 'Service role required';
  end if;
  if normalized_source_key !~ '^[a-f0-9]{64}$'
    or normalized_payload_hash !~ '^[a-f0-9]{64}$' then
    raise exception 'Valid opaque source fingerprints required';
  end if;
  if p_source_row_number is null or p_source_row_number < 2 then
    raise exception 'Valid source row number required';
  end if;
  if normalized_version = '' then
    raise exception 'Source contract version required';
  end if;
  if p_run_id is not null and not exists (
    select 1 from public.refund_google_form_sync_runs where id = p_run_id
  ) then
    raise exception 'Valid sync run required';
  end if;
  if p_source_start_at is null then
    raise exception 'Source start boundary required';
  end if;

  if normalized_payment_method not in ('card', 'cash') then
    normalized_payment_method := null;
  end if;
  if normalized_card_last4 !~ '^[0-9]{4}$' then
    normalized_card_last4 := null;
  end if;
  if normalized_cash_preference not in ('venmo', 'zelle', 'no_refund_requested') then
    normalized_cash_preference := null;
  end if;
  if p_payment_amount_cents is not null and (p_payment_amount_cents < 0 or p_payment_amount_cents > 10000) then
    normalized_invalid := array_append(normalized_invalid, 'payment_amount');
  end if;

  select coalesce(array_agg(distinct left(btrim(value), 80)) filter (where btrim(value) <> ''), '{}')
  into normalized_missing
  from unnest(coalesce(p_missing_fields, '{}')) value;

  select coalesce(array_agg(distinct left(btrim(value), 80)) filter (where btrim(value) <> ''), '{}')
  into normalized_invalid
  from unnest(coalesce(p_invalid_fields, '{}') || normalized_invalid) value;

  if not exists (select 1 from pg_timezone_names where name = normalized_source_timezone) then
    normalized_invalid := array_append(normalized_invalid, 'source_timezone');
    normalized_source_timezone := 'UTC';
  end if;

  begin
    source_submitted_local := nullif(btrim(coalesce(p_source_submitted_local_datetime, '')), '')::timestamp;
    if source_submitted_local is not null then
      resolved_source_submitted_at := source_submitted_local at time zone normalized_source_timezone;
    end if;
  exception when others then
    normalized_invalid := array_append(normalized_invalid, 'source_timestamp');
    resolved_source_submitted_at := null;
  end;

  if p_source_start_at is not null
    and resolved_source_submitted_at is not null
    and resolved_source_submitted_at < p_source_start_at then
    return jsonb_build_object(
      'created', false,
      'updated', false,
      'duplicate', false,
      'skipped', true,
      'reason', 'before_start_boundary'
    );
  end if;

  -- Serialize the small bridge intake so concurrent manual/scheduled workers cannot
  -- race when the Sheet has been sorted and row-number keys have moved.
  perform pg_advisory_xact_lock(hashtextextended('refund_google_form_case_bridge', 0));
  perform pg_advisory_xact_lock(hashtextextended(least(normalized_source_key, normalized_payload_hash), 0));
  perform pg_advisory_xact_lock(hashtextextended(greatest(normalized_source_key, normalized_payload_hash), 0));

  select * into import_row
  from public.refund_google_form_import_rows
  where source_response_key_hash = normalized_source_key
     or source_payload_fingerprint = normalized_payload_hash
  order by
    (source_payload_fingerprint = normalized_payload_hash) desc,
    (source_response_key_hash = normalized_source_key) desc,
    created_at
  limit 1
  for update;

  if import_row.id is not null then
    payload_changed := import_row.source_payload_fingerprint <> normalized_payload_hash;

    if not payload_changed then
      update public.refund_google_form_import_rows
      set
        source_response_key_hash = case
          when not exists (
            select 1
            from public.refund_google_form_import_rows other_row
            where other_row.source_response_key_hash = normalized_source_key
              and other_row.id <> import_row.id
          ) then normalized_source_key
          else refund_google_form_import_rows.source_response_key_hash
        end,
        source_row_number = p_source_row_number,
        source_submitted_at = coalesce(resolved_source_submitted_at, refund_google_form_import_rows.source_submitted_at),
        source_version = normalized_version,
        last_seen_run_id = p_run_id,
        updated_at = now()
      where id = import_row.id
      returning * into import_row;

      if import_row.refund_case_id is not null then
        select * into refund_case from public.refund_cases where id = import_row.refund_case_id;
      end if;

      return jsonb_build_object(
        'created', false,
        'updated', false,
        'duplicate', true,
        'caseId', refund_case.id,
        'casePath', case when refund_case.id is null then null else '/refunds?case=' || refund_case.id::text end,
        'publicReference', refund_case.public_reference,
        'importStatus', import_row.import_status,
        'reason', import_row.reason_code,
        'mappingStatus', import_row.mapping_status,
        'missingFields', import_row.missing_fields,
        'invalidFields', import_row.invalid_fields
      );
    end if;

    if import_row.refund_case_id is not null then
      select * into existing_case
      from public.refund_cases
      where id = import_row.refund_case_id
      for update;

      if existing_case.status <> 'draft' then
        update public.refund_google_form_import_rows
        set
          import_status = 'quarantined',
          reason_code = 'case_locked_after_progress',
          last_seen_run_id = p_run_id,
          updated_at = now()
        where id = import_row.id
        returning * into import_row;

        return jsonb_build_object(
          'created', false,
          'updated', false,
          'duplicate', false,
          'caseId', existing_case.id,
          'casePath', '/refunds?case=' || existing_case.id::text,
          'publicReference', existing_case.public_reference,
          'importStatus', import_row.import_status,
          'reason', import_row.reason_code,
          'mappingStatus', import_row.mapping_status,
          'missingFields', import_row.missing_fields,
          'invalidFields', import_row.invalid_fields
        );
      end if;
    end if;
  end if;

  if normalized_location <> '' then
    with candidates as (
      select distinct
        machine.id as machine_id,
        machine.location_id,
        location.timezone
      from public.reporting_machines machine
      join public.reporting_locations location on location.id = machine.location_id
      left join public.reporting_machine_aliases alias
        on alias.reporting_machine_id = machine.id
       and alias.status = 'active'
      where machine.status = 'active'
        and location.status = 'active'
        and machine.machine_type in ('commercial', 'mini')
        and (
          alias.normalized_alias = public.normalize_reporting_match_text(normalized_location)
          or public.normalize_reporting_match_text(location.name) = public.normalize_reporting_match_text(normalized_location)
          or public.normalize_reporting_match_text(machine.refund_public_display_label) = public.normalize_reporting_match_text(normalized_location)
        )
    )
    select
      count(*)::integer,
      (array_agg(machine_id))[1],
      (array_agg(location_id))[1],
      (array_agg(timezone))[1]
    into candidate_count, matched_machine_id, matched_location_id, matched_timezone
    from candidates;

    resolved_mapping_status := case
      when candidate_count = 1 then 'matched'
      when candidate_count > 1 then 'ambiguous'
      else 'unmapped'
    end;
  end if;

  begin
    incident_local := nullif(btrim(coalesce(p_incident_local_datetime, '')), '')::timestamp;
    if incident_local is not null and resolved_mapping_status = 'matched' then
      resolved_incident_at := incident_local at time zone matched_timezone;
      resolved_incident_resolution := 'ambiguous';
    end if;
  exception when others then
    normalized_invalid := array_append(normalized_invalid, 'incident_datetime');
    incident_local := null;
    resolved_incident_at := null;
    resolved_incident_resolution := 'invalid_local_time';
  end;

  normalized_missing := array(select distinct value from unnest(normalized_missing) value order by value);
  normalized_invalid := array(select distinct value from unnest(normalized_invalid) value order by value);

  if resolved_source_submitted_at is null then
    resolved_reason_code := 'invalid_source_timestamp';
  elsif normalized_email = '' or normalized_email !~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$' then
    resolved_reason_code := 'invalid_customer_email';
  elsif normalized_issue = '' then
    resolved_reason_code := 'missing_issue_summary';
  elsif resolved_mapping_status = 'missing' then
    resolved_reason_code := 'missing_location';
  elsif resolved_mapping_status = 'unmapped' then
    resolved_reason_code := 'unmapped_location';
  elsif resolved_mapping_status = 'ambiguous' then
    resolved_reason_code := 'ambiguous_location';
  elsif cardinality(normalized_invalid) > 0 then
    resolved_reason_code := 'invalid_fields';
  elsif cardinality(normalized_missing) > 0 then
    resolved_reason_code := 'missing_fields';
  else
    resolved_reason_code := null;
  end if;

  if resolved_reason_code is null
    or resolved_reason_code not in ('invalid_source_timestamp', 'invalid_customer_email', 'missing_issue_summary', 'missing_location', 'unmapped_location', 'ambiguous_location') then
    if existing_case.id is null then
      insert into public.refund_cases (
        reporting_machine_id,
        reporting_location_id,
        customer_email,
        customer_name,
        zelle_payment_contact,
        issue_summary,
        incident_at,
        incident_local_datetime,
        incident_timezone,
        incident_time_resolution,
        payment_method,
        payment_amount_cents,
        card_last4,
        card_wallet_used,
        status,
        correlation_status,
        refund_amount_cents,
        intake_source,
        intake_meta
      )
      values (
        matched_machine_id,
        matched_location_id,
        normalized_email,
        normalized_name,
        case when normalized_payment_method = 'cash' and normalized_cash_preference = 'zelle' then normalized_cash_contact else null end,
        normalized_issue,
        resolved_incident_at,
        case when incident_local is not null then to_char(incident_local, 'YYYY-MM-DD"T"HH24:MI:SS') else null end,
        matched_timezone,
        resolved_incident_resolution,
        normalized_payment_method,
        case when p_payment_amount_cents between 0 and 10000 then p_payment_amount_cents else null end,
        case when normalized_payment_method = 'card' then normalized_card_last4 else null end,
        coalesce(p_card_wallet_used, false),
        'draft',
        'manual_review',
        case when p_payment_amount_cents between 0 and 10000 then p_payment_amount_cents else null end,
        'sms_google_form',
        jsonb_strip_nulls(jsonb_build_object(
          'source', 'sms_google_form',
          'contract_version', normalized_version,
          'mapping_status', resolved_mapping_status,
          'missing_fields', to_jsonb(normalized_missing),
          'invalid_fields', to_jsonb(normalized_invalid),
          'cash_payment_preference', normalized_cash_preference,
          'cash_payment_contact', normalized_cash_contact,
          'source_response_fingerprinted', true,
          'automatic_customer_contact', false,
          'official_actions_allowed', false
        ))
      )
      returning * into refund_case;
      created_case := true;
    else
      update public.refund_cases
      set
        reporting_machine_id = matched_machine_id,
        reporting_location_id = matched_location_id,
        customer_email = normalized_email,
        customer_name = normalized_name,
        zelle_payment_contact = case when normalized_payment_method = 'cash' and normalized_cash_preference = 'zelle' then normalized_cash_contact else null end,
        issue_summary = normalized_issue,
        incident_at = resolved_incident_at,
        incident_local_datetime = case when incident_local is not null then to_char(incident_local, 'YYYY-MM-DD"T"HH24:MI:SS') else null end,
        incident_timezone = matched_timezone,
        incident_time_resolution = resolved_incident_resolution,
        payment_method = normalized_payment_method,
        payment_amount_cents = case when p_payment_amount_cents between 0 and 10000 then p_payment_amount_cents else null end,
        card_last4 = case when normalized_payment_method = 'card' then normalized_card_last4 else null end,
        card_wallet_used = coalesce(p_card_wallet_used, false),
        correlation_status = 'manual_review',
        refund_amount_cents = case when p_payment_amount_cents between 0 and 10000 then p_payment_amount_cents else null end,
        intake_meta = jsonb_strip_nulls(jsonb_build_object(
          'source', 'sms_google_form',
          'contract_version', normalized_version,
          'mapping_status', resolved_mapping_status,
          'missing_fields', to_jsonb(normalized_missing),
          'invalid_fields', to_jsonb(normalized_invalid),
          'cash_payment_preference', normalized_cash_preference,
          'cash_payment_contact', normalized_cash_contact,
          'source_response_fingerprinted', true,
          'automatic_customer_contact', false,
          'official_actions_allowed', false
        )),
        updated_at = now()
      where id = existing_case.id
        and status = 'draft'
      returning * into refund_case;
      updated_case := refund_case.id is not null;
    end if;
  end if;

  if refund_case.id is not null then
    resolved_import_status := case when resolved_reason_code is null then 'imported' else 'quarantined' end;
  elsif resolved_reason_code in ('missing_location', 'unmapped_location', 'ambiguous_location') then
    resolved_import_status := 'quarantined';
  else
    resolved_import_status := 'rejected';
  end if;

  if import_row.id is null then
    insert into public.refund_google_form_import_rows (
      source_response_key_hash,
      source_payload_fingerprint,
      source_row_number,
      source_submitted_at,
      source_version,
      refund_case_id,
      last_seen_run_id,
      import_status,
      reason_code,
      mapping_status,
      missing_fields,
      invalid_fields
    )
    values (
      normalized_source_key,
      normalized_payload_hash,
      p_source_row_number,
      resolved_source_submitted_at,
      normalized_version,
      refund_case.id,
      p_run_id,
      resolved_import_status,
      resolved_reason_code,
      resolved_mapping_status,
      normalized_missing,
      normalized_invalid
    )
    returning * into import_row;
  else
    update public.refund_google_form_import_rows
    set
      source_response_key_hash = case
        when not exists (
          select 1
          from public.refund_google_form_import_rows other_row
          where other_row.source_response_key_hash = normalized_source_key
            and other_row.id <> import_row.id
        ) then normalized_source_key
        else refund_google_form_import_rows.source_response_key_hash
      end,
      source_payload_fingerprint = normalized_payload_hash,
      source_row_number = p_source_row_number,
      source_submitted_at = coalesce(resolved_source_submitted_at, refund_google_form_import_rows.source_submitted_at),
      source_version = normalized_version,
      refund_case_id = coalesce(refund_case.id, refund_google_form_import_rows.refund_case_id),
      last_seen_run_id = p_run_id,
      import_status = resolved_import_status,
      reason_code = resolved_reason_code,
      mapping_status = resolved_mapping_status,
      missing_fields = normalized_missing,
      invalid_fields = normalized_invalid,
      updated_at = now()
    where id = import_row.id
    returning * into import_row;
  end if;

  if refund_case.id is not null then
    insert into public.refund_case_events (
      refund_case_id,
      event_type,
      message,
      metadata
    )
    values (
      refund_case.id,
      case when created_case then 'google_form_response_imported' else 'google_form_response_updated' end,
      case when created_case
        then 'A legacy SMS Google Form response was added to the Hub queue.'
        else 'A legacy SMS Google Form response changed while the case was still a draft.'
      end,
      jsonb_build_object(
        'source', 'sms_google_form',
        'contract_version', normalized_version,
        'mapping_status', resolved_mapping_status,
        'import_status', resolved_import_status,
        'missing_fields', to_jsonb(normalized_missing),
        'invalid_fields', to_jsonb(normalized_invalid),
        'payload_redacted', true,
        'automatic_customer_contact', false,
        'official_action', false
      )
    );
  end if;

  return jsonb_build_object(
    'created', created_case,
    'updated', updated_case,
    'duplicate', false,
    'caseId', refund_case.id,
    'casePath', case when refund_case.id is null then null else '/refunds?case=' || refund_case.id::text end,
    'publicReference', refund_case.public_reference,
    'importStatus', import_row.import_status,
    'reason', import_row.reason_code,
    'mappingStatus', import_row.mapping_status,
    'missingFields', import_row.missing_fields,
    'invalidFields', import_row.invalid_fields
  );
end;
$$;

create or replace function public.admin_get_refund_google_form_import_health()
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
  if not (
    public.is_super_admin(actor_user_id)
    or public.is_scoped_admin(actor_user_id)
    or public.user_is_refund_manager(actor_user_id)
  ) then
    raise exception 'Refund operations access required';
  end if;

  return jsonb_build_object(
    'lastRunAt', (select max(started_at) from public.refund_google_form_sync_runs),
    'lastSuccessfulAt', (
      select max(completed_at)
      from public.refund_google_form_sync_runs
      where status = 'completed'
    ),
    'lastRunStatus', (
      select status
      from public.refund_google_form_sync_runs
      order by started_at desc, id desc
      limit 1
    ),
    'importedCount', (
      select count(*) from public.refund_google_form_import_rows where import_status = 'imported'
    ),
    'quarantinedCount', (
      select count(*) from public.refund_google_form_import_rows where import_status = 'quarantined'
    ),
    'rejectedCount', (
      select count(*) from public.refund_google_form_import_rows where import_status = 'rejected'
    ),
    'oldestQuarantinedAt', (
      select min(updated_at)
      from public.refund_google_form_import_rows
      where import_status in ('quarantined', 'rejected')
    )
  );
end;
$$;

create or replace function public.admin_get_refund_google_form_quarantine(p_limit integer default 50)
returns jsonb
language plpgsql
stable
security definer
set search_path = public, auth
as $$
declare
  actor_user_id uuid := auth.uid();
  safe_limit integer := least(greatest(coalesce(p_limit, 50), 1), 100);
begin
  if actor_user_id is null then
    raise exception 'Authentication required';
  end if;
  if not public.is_super_admin(actor_user_id) then
    raise exception 'Admin refund triage access required';
  end if;

  return coalesce((
    select jsonb_agg(jsonb_build_object(
      'importId', import_row.id,
      'caseId', import_row.refund_case_id,
      'publicReference', refund_case.public_reference,
      'importStatus', import_row.import_status,
      'reason', import_row.reason_code,
      'mappingStatus', import_row.mapping_status,
      'missingFields', to_jsonb(import_row.missing_fields),
      'invalidFields', to_jsonb(import_row.invalid_fields),
      'updatedAt', import_row.updated_at
    ) order by import_row.updated_at)
    from (
      select *
      from public.refund_google_form_import_rows
      where import_status in ('quarantined', 'rejected')
      order by updated_at
      limit safe_limit
    ) import_row
    left join public.refund_cases refund_case on refund_case.id = import_row.refund_case_id
  ), '[]'::jsonb);
end;
$$;

revoke all on function public.service_start_refund_google_form_sync(text,text,text,timestamp with time zone) from public, anon, authenticated;
revoke all on function public.service_finish_refund_google_form_sync(uuid,text,jsonb,text,jsonb) from public, anon, authenticated;
revoke all on function public.service_ingest_refund_google_form_response(uuid,text,text,integer,text,text,text,timestamp with time zone,text,text,text,text,text,text,integer,text,boolean,text,text,text[],text[]) from public, anon, authenticated;

grant execute on function public.service_start_refund_google_form_sync(text,text,text,timestamp with time zone) to service_role;
grant execute on function public.service_finish_refund_google_form_sync(uuid,text,jsonb,text,jsonb) to service_role;
grant execute on function public.service_ingest_refund_google_form_response(uuid,text,text,integer,text,text,text,timestamp with time zone,text,text,text,text,text,text,integer,text,boolean,text,text,text[],text[]) to service_role;

revoke all on function public.admin_get_refund_google_form_import_health() from public, anon;
revoke all on function public.admin_get_refund_google_form_quarantine(integer) from public, anon;
grant execute on function public.admin_get_refund_google_form_import_health() to authenticated;
grant execute on function public.admin_get_refund_google_form_quarantine(integer) to authenticated;

comment on table public.refund_google_form_sync_runs is
  'Aggregate, PII-free run ledger for the default-off SMS Google Form case bridge.';
comment on table public.refund_google_form_import_rows is
  'Opaque source fingerprints and quarantine state only; customer content remains in the governed refund case or source Sheet.';
comment on function public.service_ingest_refund_google_form_response(uuid,text,text,integer,text,text,text,timestamp with time zone,text,text,text,text,text,text,integer,text,boolean,text,text,text[],text[]) is
  'Service-only idempotent legacy Google Form response ingestion. It creates draft cases only and performs no customer send or official refund action.';

select pg_notify('pgrst', 'reload schema');
