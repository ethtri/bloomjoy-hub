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
set search_path = public, auth
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
            else 'initial_customer_submission'
          end,
          'appliedAt', coalesce(correction.created_at, refund_case.created_at),
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
