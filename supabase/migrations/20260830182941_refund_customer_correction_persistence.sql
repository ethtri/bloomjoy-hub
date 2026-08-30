-- Preserve customer-supplied card facts from verified Gmail replies and secure
-- wallet corrections without weakening the existing matching or payment gates.

alter table public.refund_cases
  add column if not exists card_last4_provenance text;

alter table public.refund_cases
  drop constraint if exists refund_cases_card_last4_provenance_check,
  add constraint refund_cases_card_last4_provenance_check check (
    card_last4_provenance is null
    or card_last4_provenance in ('physical_card', 'wallet_device_token')
  ),
  drop constraint if exists refund_cases_wallet_last4_provenance_check,
  add constraint refund_cases_wallet_last4_provenance_check check (
    card_last4_provenance <> 'wallet_device_token'
    or (
      payment_method = 'card'
      and card_wallet_used is true
      and payment_interaction = 'phone_watch_wallet'
      and card_last4 is not null
    )
  );

comment on column public.refund_cases.card_last4_provenance is
  'Customer-declared origin of the stored last four: physical card or wallet/device token. Null preserves legacy or unresolved provenance.';

-- Safe historical backfill. Old wallet flags alone are not enough to assert
-- that the stored digits are a device token.
update public.refund_cases refund_case
set card_last4_provenance = case
  when refund_case.card_last4 is null then null
  when refund_case.card_wallet_used is false then 'physical_card'
  when refund_case.wallet_correction_received_at is not null then 'wallet_device_token'
  when refund_case.created_at >= timestamptz '2026-08-11 00:00:00+00'
    and refund_case.payment_interaction = 'phone_watch_wallet'
    then 'wallet_device_token'
  else null
end
where refund_case.card_last4_provenance is null;

-- Keep the database canonical-field contract aligned with the versioned reply
-- template. These fields remain customer evidence only.
create or replace function public.canonical_refund_follow_up_fields(p_fields text[])
returns text[]
language sql
immutable
set search_path = public
as $$
  with allowed(value, position) as (
    values
      ('location_or_machine'::text, 1),
      ('incident_date'::text, 2),
      ('incident_time'::text, 3),
      ('payment_method'::text, 4),
      ('payment_interaction'::text, 5),
      ('wallet_provider'::text, 6),
      ('amount'::text, 7),
      ('card_last4'::text, 8),
      ('card_network'::text, 9)
  ), selected as (
    select distinct allowed.value, allowed.position
    from unnest(coalesce(p_fields, '{}'::text[])) entry
    join allowed on allowed.value = entry
  )
  select coalesce(array_agg(value order by position), '{}'::text[])
  from selected;
$$;

-- Every matching-relevant correction invalidates the prior fact snapshot once.
create or replace function public.guard_refund_deterministic_fact_version()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.reporting_machine_id is distinct from old.reporting_machine_id
    or new.reporting_location_id is distinct from old.reporting_location_id
    or new.incident_at is distinct from old.incident_at
    or new.incident_local_datetime is distinct from old.incident_local_datetime
    or new.incident_timezone is distinct from old.incident_timezone
    or new.incident_time_resolution is distinct from old.incident_time_resolution
    or new.payment_method is distinct from old.payment_method
    or new.payment_amount_cents is distinct from old.payment_amount_cents
    or new.card_last4 is distinct from old.card_last4
    or new.card_last4_provenance is distinct from old.card_last4_provenance
    or new.card_network is distinct from old.card_network
    or new.card_wallet_used is distinct from old.card_wallet_used
    or new.payment_interaction is distinct from old.payment_interaction
    or new.wallet_provider is distinct from old.wallet_provider then
    new.deterministic_fact_version := old.deterministic_fact_version + 1;
    new.deterministic_facts_updated_at := statement_timestamp();
    new.cash_match_evaluated_fact_version := null;
  else
    new.deterministic_fact_version := old.deterministic_fact_version;
    new.deterministic_facts_updated_at := old.deterministic_facts_updated_at;
  end if;

  return new;
end;
$$;

drop trigger if exists refund_cases_guard_deterministic_fact_version
  on public.refund_cases;
create trigger refund_cases_guard_deterministic_fact_version
before update of
  reporting_machine_id,
  reporting_location_id,
  incident_at,
  incident_local_datetime,
  incident_timezone,
  incident_time_resolution,
  payment_method,
  payment_amount_cents,
  card_last4,
  card_last4_provenance,
  card_network,
  card_wallet_used,
  payment_interaction,
  wallet_provider,
  deterministic_fact_version,
  deterministic_facts_updated_at
on public.refund_cases
for each row execute function public.guard_refund_deterministic_fact_version();

-- Replace the v2 wallet-correction wrapper with a single atomic fact update.
-- The previous wrapper changed wallet facts first and card network second,
-- advancing the case fact version twice for one customer submission.
create or replace function public.service_apply_refund_wallet_correction_v2(
  p_token_hash text,
  p_wallet_type text,
  p_card_network text,
  p_card_last4 text,
  p_incident_at timestamptz,
  p_incident_local_datetime text,
  p_amount_confirmed boolean
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  context_row public.refund_wallet_correction_contexts;
  case_row public.refund_cases;
  updated_case_row public.refund_cases;
  normalized_network text := public.normalize_refund_card_network(p_card_network);
  normalized_wallet_provider text;
begin
  if p_token_hash !~ '^[a-f0-9]{64}$' then
    raise exception 'Invalid wallet correction link';
  end if;

  if p_wallet_type not in ('apple_pay', 'google_pay', 'other_wallet') then
    raise exception 'Choose the mobile wallet used for this purchase';
  end if;
  normalized_wallet_provider := case p_wallet_type
    when 'apple_pay' then 'apple_pay'
    when 'google_pay' then 'google_wallet'
    else 'other'
  end;

  if normalized_network is null then
    raise exception 'Choose the card type shown inside the mobile wallet';
  end if;
  if p_card_last4 !~ '^[0-9]{4}$' then
    raise exception 'Enter the four wallet card digits';
  end if;
  if p_incident_at is null
    or p_incident_at < statement_timestamp() - interval '45 days'
    or p_incident_at > statement_timestamp() + interval '1 hour' then
    raise exception 'Enter a valid approximate purchase time';
  end if;
  if coalesce(p_amount_confirmed, false) is not true then
    raise exception 'Confirm the purchase amount';
  end if;

  select *
  into context_row
  from public.refund_wallet_correction_contexts
  where token_hash = p_token_hash
  for update;

  if context_row.id is null
    or context_row.status <> 'pending'
    or context_row.expires_at <= statement_timestamp() then
    raise exception 'This wallet correction link is invalid or has expired';
  end if;

  select *
  into case_row
  from public.refund_cases
  where id = context_row.refund_case_id
  for update;

  if case_row.id is null
    or case_row.payment_method <> 'card'
    or case_row.card_wallet_used is not true
    or case_row.status in ('approved', 'denied', 'completed', 'closed')
    or case_row.decision is not null then
    raise exception 'This refund case can no longer be corrected';
  end if;

  update public.refund_wallet_correction_contexts
  set
    status = 'submitted',
    consumed_at = statement_timestamp(),
    updated_at = statement_timestamp()
  where id = context_row.id;

  delete from public.refund_nayax_lookup_candidates
  where refund_case_id = case_row.id;

  update public.refund_cases
  set
    card_last4 = p_card_last4,
    card_last4_provenance = 'wallet_device_token',
    card_network = normalized_network,
    card_wallet_used = true,
    payment_interaction = 'phone_watch_wallet',
    wallet_provider = normalized_wallet_provider,
    incident_at = p_incident_at,
    incident_local_datetime = p_incident_local_datetime,
    incident_time_resolution = 'exact',
    status = 'needs_review',
    correlation_status = 'needs_nayax',
    correlation_source = null,
    correlation_confidence = 0,
    correlation_summary = 'Customer corrected tokenized wallet details; automatic Nayax re-match is pending.',
    matched_nayax_transaction_id = null,
    matched_nayax_site_id = null,
    matched_nayax_machine_auth_time = null,
    matched_nayax_amount_cents = null,
    matched_nayax_card_last4 = null,
    matched_nayax_currency_code = null,
    nayax_recommendation_state = null,
    nayax_recommendation_policy_version = null,
    nayax_recommendation_evaluated_at = null,
    nayax_match_execution_eligible = false,
    wallet_correction_state = 'received',
    wallet_correction_received_at = statement_timestamp(),
    automation_state = 'wallet_correction_received',
    automation_follow_up_due_at = null,
    updated_at = statement_timestamp()
  where id = case_row.id
  returning * into updated_case_row;

  insert into public.refund_case_events (
    refund_case_id,
    event_type,
    message,
    metadata
  ) values (
    case_row.id,
    'wallet_correction_received',
    'Customer submitted corrected wallet details; automatic Nayax re-match was requested.',
    jsonb_build_object(
      'version', context_row.version,
      'wallet_type', p_wallet_type,
      'changed_fields', jsonb_build_array(
        'card_last4',
        'card_last4_provenance',
        'card_network',
        'payment_interaction',
        'wallet_provider',
        'incident_at',
        'incident_local_datetime'
      ),
      'resulting_fact_version', updated_case_row.deterministic_fact_version,
      'machine_context_changed', false,
      'qr_context_changed', false,
      'payload_redacted', true
    )
  );

  return jsonb_build_object(
    'refundCaseId', updated_case_row.id,
    'publicReference', updated_case_row.public_reference,
    'state', 'submitted',
    'factVersion', updated_case_row.deterministic_fact_version
  );
end;
$$;

revoke all on function public.service_apply_refund_wallet_correction_v2(
  text, text, text, text, timestamptz, text, boolean
) from public, anon, authenticated;
grant execute on function public.service_apply_refund_wallet_correction_v2(
  text, text, text, text, timestamptz, text, boolean
) to service_role;

-- A verified Gmail reply is the idempotency key for one atomic fact
-- application. The private FK is deliberately kept out of case-event metadata.
create table public.refund_customer_fact_applications (
  gmail_message_id uuid primary key
    references public.refund_gmail_messages (id) on delete cascade,
  refund_case_id uuid not null
    references public.refund_cases (id) on delete cascade,
  event_id uuid not null unique
    references public.refund_case_events (id) on delete restrict,
  expected_fact_version bigint not null check (expected_fact_version >= 1),
  resulting_fact_version bigint not null check (
    resulting_fact_version > expected_fact_version
  ),
  applied_fields text[] not null check (
    cardinality(applied_fields) between 1 and 16
  ),
  extraction_policy text not null check (
    extraction_policy in (
      'labeled_customer_correction_v3',
      'labeled_routine_facts_v1'
    )
  ),
  created_at timestamptz not null default clock_timestamp()
);

create index refund_customer_fact_applications_case_version_idx
  on public.refund_customer_fact_applications (
    refund_case_id,
    resulting_fact_version
  );

alter table public.refund_customer_fact_applications enable row level security;
revoke all on table public.refund_customer_fact_applications
  from public, anon, authenticated, service_role;

create function public.service_apply_refund_gmail_customer_facts_v1(
  p_refund_case_id uuid,
  p_gmail_message_id uuid,
  p_expected_fact_version bigint,
  p_updates jsonb,
  p_applied_fields text[],
  p_extraction_policy text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  source_row public.refund_gmail_messages;
  case_row public.refund_cases;
  prior_application public.refund_customer_fact_applications;
  event_row public.refund_case_events;
  normalized_fields text[];
begin
  if p_refund_case_id is null
    or p_gmail_message_id is null
    or coalesce(p_expected_fact_version, 0) < 1
    or pg_catalog.jsonb_typeof(p_updates) <> 'object'
    or p_extraction_policy not in (
      'labeled_customer_correction_v3',
      'labeled_routine_facts_v1'
    ) then
    raise exception 'Valid Gmail customer-fact application required';
  end if;

  if exists (
    select 1
    from pg_catalog.jsonb_object_keys(p_updates) as supplied(key)
    where supplied.key not in (
      'reporting_machine_id',
      'reporting_location_id',
      'incident_at',
      'incident_local_datetime',
      'incident_timezone',
      'incident_time_resolution',
      'payment_method',
      'payment_amount_cents',
      'refund_amount_cents',
      'card_last4',
      'card_last4_provenance',
      'card_network',
      'card_wallet_used',
      'payment_interaction',
      'wallet_provider'
    )
  ) then
    raise exception 'Unsupported Gmail customer-fact update';
  end if;

  select coalesce(pg_catalog.array_agg(field order by field), '{}'::text[])
  into normalized_fields
  from (
    select distinct pg_catalog.btrim(value) as field
    from pg_catalog.unnest(coalesce(p_applied_fields, '{}'::text[])) value
    where pg_catalog.btrim(value) in (
      'location_or_machine',
      'incident_date',
      'incident_time',
      'payment_method',
      'amount',
      'card_last4',
      'card_last4_provenance',
      'card_network',
      'payment_interaction',
      'wallet_provider'
    )
  ) fields;
  if cardinality(normalized_fields) = 0 then
    raise exception 'At least one approved applied field is required';
  end if;

  select message.* into source_row
  from public.refund_gmail_messages message
  where message.id = p_gmail_message_id
  for update;
  if source_row.id is null
    or source_row.refund_case_id <> p_refund_case_id
    or source_row.direction <> 'inbound'
    or source_row.message_kind <> 'message'
    or source_row.status <> 'received'
    or source_row.participant_role <> 'customer'
    or source_row.participant_trust <> 'verified' then
    return pg_catalog.jsonb_build_object(
      'outcome', 'conflict',
      'reason', 'source_not_eligible'
    );
  end if;

  select application.* into prior_application
  from public.refund_customer_fact_applications application
  where application.gmail_message_id = p_gmail_message_id;
  if prior_application.gmail_message_id is not null then
    return pg_catalog.jsonb_build_object(
      'outcome', 'already_applied',
      'factVersion', prior_application.resulting_fact_version
    );
  end if;

  select refund_case.* into case_row
  from public.refund_cases refund_case
  where refund_case.id = p_refund_case_id
  for update;
  if case_row.id is null
    or case_row.deterministic_fact_version <> p_expected_fact_version then
    return pg_catalog.jsonb_build_object(
      'outcome', 'conflict',
      'reason', 'fact_version_changed',
      'factVersion', case_row.deterministic_fact_version
    );
  end if;

  update public.refund_cases refund_case
  set
    reporting_machine_id = case when p_updates ? 'reporting_machine_id'
      then nullif(p_updates ->> 'reporting_machine_id', '')::uuid
      else refund_case.reporting_machine_id end,
    reporting_location_id = case when p_updates ? 'reporting_location_id'
      then nullif(p_updates ->> 'reporting_location_id', '')::uuid
      else refund_case.reporting_location_id end,
    incident_at = case when p_updates ? 'incident_at'
      then nullif(p_updates ->> 'incident_at', '')::timestamptz
      else refund_case.incident_at end,
    incident_local_datetime = case when p_updates ? 'incident_local_datetime'
      then nullif(p_updates ->> 'incident_local_datetime', '')
      else refund_case.incident_local_datetime end,
    incident_timezone = case when p_updates ? 'incident_timezone'
      then nullif(p_updates ->> 'incident_timezone', '')
      else refund_case.incident_timezone end,
    incident_time_resolution = case when p_updates ? 'incident_time_resolution'
      then nullif(p_updates ->> 'incident_time_resolution', '')
      else refund_case.incident_time_resolution end,
    payment_method = case when p_updates ? 'payment_method'
      then nullif(p_updates ->> 'payment_method', '')
      else refund_case.payment_method end,
    payment_amount_cents = case when p_updates ? 'payment_amount_cents'
      then (p_updates ->> 'payment_amount_cents')::integer
      else refund_case.payment_amount_cents end,
    refund_amount_cents = case when p_updates ? 'refund_amount_cents'
      then (p_updates ->> 'refund_amount_cents')::integer
      else refund_case.refund_amount_cents end,
    card_last4 = case when p_updates ? 'card_last4'
      then nullif(p_updates ->> 'card_last4', '')
      else refund_case.card_last4 end,
    card_last4_provenance = case when p_updates ? 'card_last4_provenance'
      then nullif(p_updates ->> 'card_last4_provenance', '')
      else refund_case.card_last4_provenance end,
    card_network = case when p_updates ? 'card_network'
      then nullif(p_updates ->> 'card_network', '')
      else refund_case.card_network end,
    card_wallet_used = case when p_updates ? 'card_wallet_used'
      then (p_updates ->> 'card_wallet_used')::boolean
      else refund_case.card_wallet_used end,
    payment_interaction = case when p_updates ? 'payment_interaction'
      then nullif(p_updates ->> 'payment_interaction', '')
      else refund_case.payment_interaction end,
    wallet_provider = case when p_updates ? 'wallet_provider'
      then nullif(p_updates ->> 'wallet_provider', '')
      else refund_case.wallet_provider end,
    automation_state = 'customer_replied',
    automation_follow_up_due_at = null
  where refund_case.id = p_refund_case_id
  returning refund_case.* into case_row;

  if case_row.deterministic_fact_version <= p_expected_fact_version then
    raise exception 'Gmail customer-fact application made no deterministic change';
  end if;

  insert into public.refund_case_events (
    refund_case_id,
    event_type,
    message,
    metadata
  ) values (
    p_refund_case_id,
    'gmail_customer_facts_applied',
    'Unambiguous labeled facts from a verified customer reply were added to or corrected on the refund case.',
    pg_catalog.jsonb_build_object(
      'applied_fields', normalized_fields,
      'extraction_policy', p_extraction_policy,
      'resulting_fact_version', case_row.deterministic_fact_version,
      'card_last4_provenance', case_row.card_last4_provenance,
      'payload_redacted', true
    )
  ) returning * into event_row;

  insert into public.refund_customer_fact_applications (
    gmail_message_id,
    refund_case_id,
    event_id,
    expected_fact_version,
    resulting_fact_version,
    applied_fields,
    extraction_policy
  ) values (
    p_gmail_message_id,
    p_refund_case_id,
    event_row.id,
    p_expected_fact_version,
    case_row.deterministic_fact_version,
    normalized_fields,
    p_extraction_policy
  );

  return pg_catalog.jsonb_build_object(
    'outcome', 'applied',
    'factVersion', case_row.deterministic_fact_version
  );
end;
$$;

revoke all on function public.service_apply_refund_gmail_customer_facts_v1(
  uuid, uuid, bigint, jsonb, text[], text
) from public, anon, authenticated;
grant execute on function public.service_apply_refund_gmail_customer_facts_v1(
  uuid, uuid, bigint, jsonb, text[], text
) to service_role;

-- Add a small redacted provenance summary to every case already authorized by
-- the scoped manager overview. Raw message IDs and raw reply text stay private.
alter function public.admin_get_refund_operations_overview()
  rename to admin_get_refund_operations_overview_pre_customer_correction_v1;

revoke execute on function public.admin_get_refund_operations_overview_pre_customer_correction_v1()
  from public, anon, authenticated;

create function public.admin_get_refund_operations_overview()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  base_result jsonb;
  enriched_cases jsonb;
begin
  base_result := public.admin_get_refund_operations_overview_pre_customer_correction_v1();

  select coalesce(
    jsonb_agg(
      item.case_json || jsonb_build_object(
        'cardLast4Provenance', refund_case.card_last4_provenance,
        'customerFactEvidence', jsonb_build_object(
          'source', case
            when correction.event_type = 'gmail_customer_facts_applied'
              then 'verified_customer_email'
            when correction.event_type = 'wallet_correction_received'
              then 'secure_wallet_correction'
            when refund_case.deterministic_fact_version <= 1
              then 'initial_customer_submission'
            else 'current_case_record'
          end,
          'appliedAt', case
            when correction.event_type is not null then correction.created_at
            when refund_case.deterministic_fact_version <= 1
              then refund_case.created_at
            else refund_case.deterministic_facts_updated_at
          end,
          'changedFields', coalesce(
            correction.metadata -> 'applied_fields',
            correction.metadata -> 'changed_fields',
            '[]'::jsonb
          ),
          'factVersion', refund_case.deterministic_fact_version,
          'payloadRedacted', true
        )
      )
      order by item.case_order
    ),
    '[]'::jsonb
  ) into enriched_cases
  from jsonb_array_elements(coalesce(base_result -> 'cases', '[]'::jsonb))
    with ordinality as item(case_json, case_order)
  join public.refund_cases refund_case
    on refund_case.id = (item.case_json ->> 'id')::uuid
  left join lateral (
    select event.event_type, event.created_at, event.metadata
    from public.refund_case_events event
    where event.refund_case_id = refund_case.id
      and event.event_type in (
        'gmail_customer_facts_applied',
        'wallet_correction_received'
      )
      and event.metadata ->> 'resulting_fact_version' ~ '^[0-9]+$'
      and (event.metadata ->> 'resulting_fact_version')::bigint
        = refund_case.deterministic_fact_version
    order by event.created_at desc, event.id desc
    limit 1
  ) correction on true;

  return jsonb_set(base_result, '{cases}', enriched_cases, true);
end;
$$;

comment on function public.admin_get_refund_operations_overview() is
  'Scoped Refund Operations overview with redacted customer-fact source, update time, fact version, and last-four provenance.';

revoke execute on function public.admin_get_refund_operations_overview()
  from public, anon;
grant execute on function public.admin_get_refund_operations_overview()
  to authenticated, service_role;

revoke execute on function public.guard_refund_deterministic_fact_version()
  from public, anon, authenticated;
revoke execute on function public.canonical_refund_follow_up_fields(text[])
  from public, anon, authenticated;
grant execute on function public.canonical_refund_follow_up_fields(text[])
  to service_role;

select pg_notify('pgrst', 'reload schema');
