-- Add customer card-network evidence without changing transaction-selection,
-- approval, duplicate, or payment-execution boundaries.

create or replace function public.normalize_refund_card_network(p_value text)
returns text
language sql
immutable
set search_path = public
as $$
  select case
    when normalized = '' then null
    when normalized like '%visa%' then 'visa'
    when normalized like '%mastercard%'
      or normalized like '%master card%'
      or normalized = 'mc' then 'mastercard'
    when normalized like '%discover%' then 'discover'
    when normalized like '%american express%'
      or normalized like '%amex%' then 'american_express'
    when normalized in ('other', 'unknown', 'not sure', 'other unknown')
      then 'other_unknown'
    else null
  end
  from (
    select btrim(regexp_replace(lower(coalesce(p_value, '')), '[^a-z0-9]+', ' ', 'g'))
      as normalized
  ) input;
$$;

alter table public.refund_cases
  add column if not exists card_network text;

alter table public.refund_cases
  drop constraint if exists refund_cases_card_network_check,
  add constraint refund_cases_card_network_check
    check (card_network is null or card_network in (
      'visa',
      'mastercard',
      'discover',
      'american_express',
      'other_unknown'
    ));

comment on column public.refund_cases.card_network is
  'Normalized customer-reported card network. Supporting evidence only; never sufficient for transaction selection, approval, or refund execution.';

create or replace function public.normalize_refund_case_card_network()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if new.payment_method <> 'card' then
    new.card_network := null;
  else
    new.card_network := public.normalize_refund_card_network(
      coalesce(
        new.card_network,
        new.intake_meta ->> 'card_network'
      )
    );
  end if;
  return new;
end;
$$;

drop trigger if exists refund_cases_00_normalize_card_network
  on public.refund_cases;
create trigger refund_cases_00_normalize_card_network
before insert or update of card_network, intake_meta, payment_method
on public.refund_cases
for each row execute function public.normalize_refund_case_card_network();

-- Card-network corrections are deterministic evidence and must invalidate stale
-- lookup work just like amount, time, and card-last-four corrections do.
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
    or new.card_network is distinct from old.card_network
    or new.card_wallet_used is distinct from old.card_wallet_used then
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
  card_network,
  card_wallet_used,
  deterministic_fact_version,
  deterministic_facts_updated_at
on public.refund_cases
for each row execute function public.guard_refund_deterministic_fact_version();

-- Keep the original single-use correction RPC intact. The v2 wrapper validates
-- and records card network in the same database transaction, so a failure rolls
-- back token consumption and all case changes.
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
  normalized_network text := public.normalize_refund_card_network(p_card_network);
  result jsonb;
  refund_case_id uuid;
  previous_network text;
begin
  if normalized_network is null then
    raise exception 'Choose the card type shown inside the mobile wallet';
  end if;

  select refund_case.card_network
  into previous_network
  from public.refund_wallet_correction_contexts context
  join public.refund_cases refund_case on refund_case.id = context.refund_case_id
  where context.token_hash = p_token_hash;

  result := public.service_apply_refund_wallet_correction(
    p_token_hash,
    p_wallet_type,
    p_card_last4,
    p_incident_at,
    p_incident_local_datetime,
    p_amount_confirmed
  );

  refund_case_id := nullif(result ->> 'refundCaseId', '')::uuid;
  if refund_case_id is null then
    raise exception 'This refund case can no longer be corrected';
  end if;

  update public.refund_cases
  set
    card_network = normalized_network,
    updated_at = statement_timestamp()
  where id = refund_case_id;

  insert into public.refund_case_events (
    refund_case_id,
    event_type,
    message,
    metadata
  ) values (
    refund_case_id,
    'wallet_card_network_corrected',
    'Customer updated the card type on the existing wallet correction case.',
    jsonb_build_object(
      'previous_card_network', previous_network,
      'card_network', normalized_network,
      'same_case', true,
      'lookup_rerun_requested', true,
      'payload_redacted', true
    )
  );

  return result;
end;
$$;

revoke all on function public.service_apply_refund_wallet_correction_v2(
  text, text, text, text, timestamptz, text, boolean
) from public, anon, authenticated;
grant execute on function public.service_apply_refund_wallet_correction_v2(
  text, text, text, text, timestamptz, text, boolean
) to service_role;

-- Preserve the complete current scoped manager overview and enrich only the
-- customer/provider card-network fields.
alter function public.admin_get_refund_operations_overview()
  rename to admin_get_refund_operations_overview_pre_card_network_v1;

revoke execute on function public.admin_get_refund_operations_overview_pre_card_network_v1()
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
  -- The upstream scoped overview remains authoritative for paymentInteraction,
  -- incidentTimeConfidence, issueCategory, productLabel, machineStatus,
  -- nearbyMachineAlerts, and the current operation states:
  -- current_lookup.status = 'claimed', lookup_failed, and
  -- Refresh transaction results. This wrapper adds card-network evidence only.
  base_result := public.admin_get_refund_operations_overview_pre_card_network_v1();

  select coalesce(
    jsonb_agg(
      item.case_json || jsonb_build_object(
        'cardNetwork', refund_case.card_network,
        'nayaxLookupCandidates', case
          when refund_case.payment_method <> 'card'
            then coalesce(item.case_json -> 'nayaxLookupCandidates', '[]'::jsonb)
          else coalesce((
            select jsonb_agg(
              visible_candidate.candidate_json || jsonb_build_object(
                'cardNetwork', private_candidate.evidence_summary ->> 'card_network'
              )
              order by visible_candidate.candidate_order
            )
            from jsonb_array_elements(
              coalesce(item.case_json -> 'nayaxLookupCandidates', '[]'::jsonb)
            ) with ordinality as visible_candidate(candidate_json, candidate_order)
            left join public.refund_nayax_lookup_candidates private_candidate
              on private_candidate.token::text = visible_candidate.candidate_json ->> 'candidateToken'
             and private_candidate.refund_case_id = refund_case.id
             and private_candidate.expires_at > now()
          ), '[]'::jsonb)
        end
      )
      order by item.case_order
    ),
    '[]'::jsonb
  ) into enriched_cases
  from jsonb_array_elements(coalesce(base_result -> 'cases', '[]'::jsonb))
    with ordinality as item(case_json, case_order)
  join public.refund_cases refund_case
    on refund_case.id = (item.case_json ->> 'id')::uuid;

  return jsonb_set(base_result, '{cases}', enriched_cases, true);
end;
$$;

comment on function public.admin_get_refund_operations_overview() is
  'Scoped Refund Operations overview with normalized customer and Nayax card-network comparison evidence. Existing manager authorization and payment boundaries remain authoritative.';

revoke execute on function public.admin_get_refund_operations_overview()
  from public, anon;
grant execute on function public.admin_get_refund_operations_overview()
  to authenticated, service_role;

revoke execute on function public.normalize_refund_card_network(text)
  from public, anon, authenticated;
grant execute on function public.normalize_refund_card_network(text)
  to service_role;
revoke execute on function public.normalize_refund_case_card_network()
  from public, anon, authenticated;
