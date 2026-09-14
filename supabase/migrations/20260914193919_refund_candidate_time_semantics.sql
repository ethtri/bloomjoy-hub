-- #1360: publish a bounded timestamp-semantics contract for refund comparison.
-- Raw provider wall-clock values, machine identifiers, observation metadata,
-- and payloads remain private in refund_nayax_lookup_candidates.

create function public.refund_candidate_time_evidence_v1(p_summary jsonb)
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
        and exists (
          select 1
          from pg_catalog.pg_timezone_names timezone_name
          where timezone_name.name =
            p_summary -> 'machine_clock_context' ->> 'timezone'
        )
      then p_summary -> 'machine_clock_context' ->> 'timezone'
      else null
    end,
    'machineClockSource', case
      when p_summary -> 'machine_clock_context' ->> 'source' =
        'native_machine_configuration'
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

revoke all on function public.refund_candidate_time_evidence_v1(jsonb)
  from public, anon, authenticated, service_role;

comment on function public.refund_candidate_time_evidence_v1(jsonb) is
  'Builds the allowlisted, redacted refund candidate timestamp contract without exposing raw provider clock evidence.';

create function public.refund_project_candidate_time_evidence_v1(p_cases jsonb)
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

  select pg_catalog.coalesce(
    pg_catalog.jsonb_agg(
      item.case_json || pg_catalog.jsonb_build_object(
        'incidentTimezone', pg_catalog.coalesce(
          pg_catalog.nullif(refund_case.incident_timezone, ''),
          location.timezone
        ),
        'nayaxLookupCandidates', pg_catalog.coalesce((
          select pg_catalog.jsonb_agg(
            visible_candidate.candidate_json || pg_catalog.jsonb_build_object(
              'authorizedAt', pg_catalog.coalesce(
                pg_catalog.nullif(
                  private_candidate.evidence_summary ->> 'authorized_at',
                  ''
                ),
                visible_candidate.candidate_json ->> 'authorizedAt'
              ),
              'timeEvidence', public.refund_candidate_time_evidence_v1(
                private_candidate.evidence_summary
              )
            )
            order by visible_candidate.candidate_order
          )
          from pg_catalog.jsonb_array_elements(
            pg_catalog.coalesce(
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
              'customerTimezone', pg_catalog.coalesce(
                pg_catalog.nullif(refund_case.incident_timezone, ''),
                location.timezone
              ),
              'providerProcessingAt', pg_catalog.nullif(
                selected_candidate.evidence_summary ->> 'authorized_at',
                ''
              ),
              'timeEvidence', public.refund_candidate_time_evidence_v1(
                selected_candidate.evidence_summary
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
    order by candidate.created_at desc, candidate.token desc
    limit 1
  ) selected_candidate on true;

  return projected_cases;
end;
$$;

revoke all on function public.refund_project_candidate_time_evidence_v1(jsonb)
  from public, anon, authenticated, service_role;

comment on function public.refund_project_candidate_time_evidence_v1(jsonb) is
  'Enriches only an already actor-scoped refund overview with redacted candidate timestamp semantics.';

alter function public.admin_get_refund_operations_overview()
  rename to admin_get_refund_operations_overview_pre_candidate_time_v1;

revoke all on function
  public.admin_get_refund_operations_overview_pre_candidate_time_v1()
  from public, anon, authenticated, service_role;

create function public.admin_get_refund_operations_overview()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  base jsonb :=
    public.admin_get_refund_operations_overview_pre_candidate_time_v1();
begin
  if pg_catalog.jsonb_typeof(base -> 'cases') = 'array' then
    base := pg_catalog.jsonb_set(
      base,
      '{cases}',
      public.refund_project_candidate_time_evidence_v1(base -> 'cases'),
      true
    );
  end if;
  if pg_catalog.jsonb_typeof(base -> 'internalTestCases') = 'array' then
    base := pg_catalog.jsonb_set(
      base,
      '{internalTestCases}',
      public.refund_project_candidate_time_evidence_v1(
        base -> 'internalTestCases'
      ),
      true
    );
  end if;
  return base || pg_catalog.jsonb_build_object(
    'candidateTimeContractVersion',
    'refund_candidate_time_v1'
  );
end;
$$;

revoke all on function public.admin_get_refund_operations_overview()
  from public, anon;
grant execute on function public.admin_get_refund_operations_overview()
  to authenticated, service_role;

comment on function public.admin_get_refund_operations_overview() is
  'Actor-scoped refund overview with explicit customer, venue, and redacted provider timestamp semantics.';

select pg_catalog.pg_notify('pgrst', 'reload schema');
