-- #1453: the production overview exceeded the authenticated 8s timeout because
-- pg_timezone_names was scanned for every case and candidate. Keep the exact
-- live catalog as the authority, materialized once per actor-scoped projection.
-- Existing single-item helper signatures and their behavior remain unchanged.

create function public.refund_safe_timezone_with_catalog_v1(
  p_preferred text,
  p_fallback text,
  p_names text[]
)
returns text
language sql
stable
set search_path = ''
as $$
  select coalesce(
    case when nullif(pg_catalog.btrim(p_preferred), '') = any(p_names)
      then nullif(pg_catalog.btrim(p_preferred), '') end,
    case when nullif(pg_catalog.btrim(p_fallback), '') = any(p_names)
      then nullif(pg_catalog.btrim(p_fallback), '') end
  );
$$;

create function public.refund_candidate_time_evidence_with_catalog_v1(p_summary jsonb, p_names text[])
returns jsonb
language sql
stable
set search_path = ''
as $$
  select pg_catalog.jsonb_build_object(
    'schemaVersion', 'refund_candidate_time_v1',
    'providerTimestampSource', case
      when p_summary ->> 'provider_time_source' in (
        'authorization_gmt',
        'machine_authorization_offset',
        'verified_machine_clock',
        'unverified_location_clock'
      ) then p_summary ->> 'provider_time_source'
      else 'unknown'
    end,
    'providerTimeResolution', case
      when p_summary ->> 'provider_time_resolution' in ('exact', 'ambiguous')
        then p_summary ->> 'provider_time_resolution'
      else 'unknown'
    end,
    'machineTimeResolution', case
      when p_summary ->> 'machine_time_resolution' in ('exact', 'ambiguous')
        then p_summary ->> 'machine_time_resolution'
      else 'unknown'
    end,
    'machineClockTimezone', case
      when p_summary -> 'machine_clock_context' ->> 'source' =
        'native_machine_configuration'
        and pg_catalog.length(
          p_summary -> 'machine_clock_context' ->> 'timezone'
        ) between 1 and 80
        and p_summary -> 'machine_clock_context' ->> 'timezone' = any(p_names)
      then p_summary -> 'machine_clock_context' ->> 'timezone'
      else null
    end,
    'machineClockSource', case
      when p_summary -> 'machine_clock_context' ->> 'source' =
        'native_machine_configuration'
        and p_summary -> 'machine_clock_context' ->> 'timezone' = any(p_names)
        then 'native_machine_configuration'
      else 'unknown'
    end,
    'occurrenceComparable', case
      when p_summary ->> 'transaction_occurrence_comparable' = 'true'
        and p_summary ->> 'transaction_occurrence_semantics' =
          'online_purchase_occurrence'
        and p_summary ->> 'transaction_occurrence_timezone_basis' in (
          'utc', 'embedded_offset', 'verified_machine_timezone'
        )
      then true
      else false
    end,
    'occurrenceSemantics', case
      when p_summary ->> 'transaction_occurrence_semantics' =
        'online_purchase_occurrence'
        then 'online_purchase_occurrence'
      else 'unknown'
    end,
    'occurrenceTimezoneBasis', case
      when p_summary ->> 'transaction_occurrence_timezone_basis' in (
        'utc', 'embedded_offset', 'verified_machine_timezone'
      ) then p_summary ->> 'transaction_occurrence_timezone_basis'
      else null
    end,
    'payloadRedacted', true
  );
$$;


create or replace function public.refund_project_candidate_time_evidence_v1(p_cases jsonb)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  projected_cases jsonb;
begin
  if pg_catalog.jsonb_typeof(p_cases) is distinct from 'array' then
    return '[]'::jsonb;
  end if;

  -- One live timezone-catalog scan per projection, including future tzdata changes.
  -- MATERIALIZED prevents the catalog SRF from being re-evaluated for each case.
  with timezone_catalog as materialized (
    select pg_catalog.array_agg(name) as names
    from pg_catalog.pg_timezone_names
  )
  select coalesce(
    pg_catalog.jsonb_agg(
      item.case_json || pg_catalog.jsonb_build_object(
        'incidentTimezone', public.refund_safe_timezone_with_catalog_v1(
          refund_case.incident_timezone,
          location.timezone,
          timezone_catalog.names
        ),
        'incidentLocalDateTime', case
          when pg_catalog.length(refund_case.incident_local_datetime) between 16 and 32
            and refund_case.incident_local_datetime ~
              '^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}(:[0-9]{2}(\.[0-9]{1,6})?)?$'
          then refund_case.incident_local_datetime
          else null
        end,
        'nayaxLookupCandidates', coalesce((
          select pg_catalog.jsonb_agg(
            visible_candidate.candidate_json || pg_catalog.jsonb_build_object(
              'providerTimestampAt', nullif(
                private_candidate.evidence_summary ->> 'authorized_at',
                ''
              ),
              'timeEvidence', public.refund_candidate_time_evidence_with_catalog_v1(
                private_candidate.evidence_summary, timezone_catalog.names
              )
            )
            order by visible_candidate.candidate_order
          )
          from pg_catalog.jsonb_array_elements(
            coalesce(
              item.case_json -> 'nayaxLookupCandidates',
              '[]'::jsonb
            )
          ) with ordinality
            as visible_candidate(candidate_json, candidate_order)
          left join public.refund_nayax_lookup_candidates private_candidate
            on private_candidate.refund_case_id = refund_case.id
           and private_candidate.token::text =
             visible_candidate.candidate_json ->> 'candidateToken'
        ), '[]'::jsonb),
        'selectedNayaxTransaction', case
          when pg_catalog.jsonb_typeof(
            item.case_json -> 'selectedNayaxTransaction'
          ) = 'object'
          then item.case_json -> 'selectedNayaxTransaction' ||
            pg_catalog.jsonb_build_object(
              'customerTimezone', public.refund_safe_timezone_with_catalog_v1(
                refund_case.incident_timezone,
                location.timezone,
                timezone_catalog.names
              ),
              'providerTimestampAt', nullif(
                selected_candidate.evidence_summary ->> 'authorized_at',
                ''
              ),
              'timeEvidence', public.refund_candidate_time_evidence_with_catalog_v1(
                selected_candidate.evidence_summary, timezone_catalog.names
              )
            )
          else item.case_json -> 'selectedNayaxTransaction'
        end
      )
      order by item.case_order
    ),
    '[]'::jsonb
  )
  into projected_cases
  from pg_catalog.jsonb_array_elements(p_cases) with ordinality
    as item(case_json, case_order)
  cross join timezone_catalog
  join public.refund_cases refund_case
    on refund_case.id = (item.case_json ->> 'id')::uuid
  left join public.reporting_locations location
    on location.id = refund_case.reporting_location_id
  left join lateral (
    select candidate.evidence_summary
    from public.refund_nayax_lookup_candidates candidate
    where candidate.refund_case_id = refund_case.id
      and candidate.provider_transaction_id =
        refund_case.matched_nayax_transaction_id
      and candidate.reporting_machine_id is not distinct from
        refund_case.reporting_machine_id
      and candidate.site_id is not distinct from
        refund_case.matched_nayax_site_id
      and candidate.machine_authorization_time is not distinct from
        refund_case.matched_nayax_machine_auth_time
      and candidate.amount_cents is not distinct from
        refund_case.matched_nayax_amount_cents
      and candidate.card_last4 is not distinct from
        refund_case.matched_nayax_card_last4
      and candidate.currency_code is not distinct from
        refund_case.matched_nayax_currency_code
    order by candidate.created_at desc, candidate.token desc
    limit 1
  ) selected_candidate on true;

  return projected_cases;
end;
$$;


revoke all on function public.refund_safe_timezone_with_catalog_v1(text,text,text[])
  from public, anon, authenticated, service_role;
revoke all on function public.refund_candidate_time_evidence_with_catalog_v1(jsonb,text[])
  from public, anon, authenticated, service_role;
revoke all on function public.refund_project_candidate_time_evidence_v1(jsonb)
  from public, anon, authenticated, service_role;

comment on function public.refund_project_candidate_time_evidence_v1(jsonb) is
  'Actor-scoped refund overview timestamp projection with one live timezone catalog scan per invocation.';
