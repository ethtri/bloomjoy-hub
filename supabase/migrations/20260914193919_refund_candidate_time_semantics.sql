-- #1360: publish a bounded timestamp-semantics contract for refund comparison.
-- Raw provider wall-clock values, machine identifiers, observation metadata,
-- and payloads remain private in refund_nayax_lookup_candidates.

-- The scorer moved to v12 when customer-time uncertainty stopped being a
-- manager-selection veto. Preserve the fully bounded v11 identifier contract
-- and adapt only the version field for the otherwise identical v12 shape.
alter function public.refund_nayax_identifier_evidence_state(bigint, jsonb)
  rename to refund_nayax_identifier_evidence_state_pre_candidate_time_v1;

revoke all on function
  public.refund_nayax_identifier_evidence_state_pre_candidate_time_v1(bigint, jsonb)
  from public, anon, authenticated, service_role;

create function public.refund_nayax_identifier_evidence_state(
  p_case_fact_version bigint,
  p_evidence jsonb
)
returns text
language plpgsql
immutable
set search_path = ''
as $$
begin
  if p_evidence ->> 'policy_version' = '2026-09-13.v12' then
    return public.refund_nayax_identifier_evidence_state_pre_candidate_time_v1(
      p_case_fact_version,
      pg_catalog.jsonb_set(
        p_evidence,
        '{policy_version}',
        '"2026-09-05.v11"'::jsonb,
        false
      )
    );
  end if;
  return public.refund_nayax_identifier_evidence_state_pre_candidate_time_v1(
    p_case_fact_version,
    p_evidence
  );
end;
$$;

revoke all on function public.refund_nayax_identifier_evidence_state(bigint, jsonb)
  from public, anon, authenticated, service_role;

comment on function public.refund_nayax_identifier_evidence_state(bigint, jsonb) is
  'Validates the bounded Nayax identifier evidence contract for v11 and the selection-parity v12 scorer.';

-- The request-boundary contract is unchanged in v12; only the manager-selection
-- treatment of uncertain customer time changed. Adapt v12 before every candidate
-- validation so persistence and later selection use the same evidence version.
alter function public.refund_nayax_request_boundary_evidence_state(timestamptz, text, jsonb)
  rename to refund_nayax_request_boundary_evidence_state_pre_candidate_time_v1;

revoke all on function
  public.refund_nayax_request_boundary_evidence_state_pre_candidate_time_v1(timestamptz, text, jsonb)
  from public, anon, authenticated, service_role;

create function public.refund_nayax_request_boundary_evidence_state(
  p_request_received_at timestamptz,
  p_request_received_source text,
  p_evidence jsonb
)
returns text
language plpgsql
immutable
set search_path = ''
as $$
begin
  if p_evidence ->> 'policy_version' = '2026-09-13.v12' then
    return public.refund_nayax_request_boundary_evidence_state_pre_candidate_time_v1(
      p_request_received_at,
      p_request_received_source,
      pg_catalog.jsonb_set(
        p_evidence,
        '{policy_version}',
        '"2026-09-05.v11"'::jsonb,
        false
      )
    );
  end if;
  return public.refund_nayax_request_boundary_evidence_state_pre_candidate_time_v1(
    p_request_received_at,
    p_request_received_source,
    p_evidence
  );
end;
$$;

revoke all on function public.refund_nayax_request_boundary_evidence_state(
  timestamptz, text, jsonb
) from public, anon, authenticated, service_role;

comment on function public.refund_nayax_request_boundary_evidence_state(
  timestamptz, text, jsonb
) is 'Validates unchanged request-boundary evidence for v8-v12 without making uncertain time a selection veto.';

-- Keep the database save/approval gate in lockstep with the scorer. Ambiguous,
-- nonexistent, rough, and noncomparable customer times remain manager context;
-- immutable machine, amount, provider-state, request-boundary, duplicate, and
-- currency controls remain mandatory. Exact time remains required only for the
-- narrow identifier-mismatch corroboration path.
do $migration$
declare
  source text;
  old_fragment text;
  new_fragment text;
  start_position integer;
  end_position integer;
begin
  select pg_catalog.pg_get_functiondef(
    'public.refund_nayax_candidate_identifier_evidence_state(uuid,uuid,integer,timestamptz,integer,text,text,jsonb)'::regprocedure
  ) into source;
  source := pg_catalog.replace(source, E'\r\n', E'\n');

  foreach old_fragment in array array[
    E'  base_selection_allowed boolean;\n',
    E'  conservative_competing_purchase_hold boolean := false;\n',
    E'  rough_same_card_candidate_count integer := 0;\n',
    E'  candidate_already_persisted boolean := false;\n'
  ] loop
    if (pg_catalog.length(source) - pg_catalog.length(pg_catalog.replace(source, old_fragment, '')))
      / pg_catalog.length(old_fragment) <> 1 then
      raise exception 'Refund candidate validator declaration changed';
    end if;
    source := pg_catalog.replace(source, old_fragment, '');
  end loop;

  old_fragment := E'      (\n        case_row.incident_time_resolution in (''exact'',''legacy_absolute'')\n        and case_row.incident_time_confidence is distinct from ''rough''\n      )\n      or p_evidence ->> ''card_last4_comparison'' is not distinct from ''exact_support''';
  new_fragment := E'      case_row.incident_time_resolution in (\n        ''exact'',''legacy_absolute'',''ambiguous'',''nonexistent''\n      )\n      or p_evidence ->> ''card_last4_comparison'' is not distinct from ''exact_support''';
  if (pg_catalog.length(source) - pg_catalog.length(pg_catalog.replace(source, old_fragment, '')))
    / pg_catalog.length(old_fragment) <> 1 then
    raise exception 'Refund candidate customer-time selection gate changed';
  end if;
  source := pg_catalog.replace(source, old_fragment, new_fragment);

  old_fragment := E'    and p_evidence ->> ''provider_time_resolution'' is not distinct from ''exact''\n    and p_evidence ->> ''machine_time_resolution'' is not distinct from ''exact''\n';
  if (pg_catalog.length(source) - pg_catalog.length(pg_catalog.replace(source, old_fragment, '')))
    / pg_catalog.length(old_fragment) <> 1 then
    raise exception 'Refund candidate provider-time gate changed';
  end if;
  source := pg_catalog.replace(source, old_fragment, '');

  old_fragment := E'        or (\n          case_row.incident_time_confidence in (''exact'',''within_15_minutes'')';
  new_fragment := E'        or (\n          case_row.incident_time_resolution in (''exact'',''legacy_absolute'')\n          and p_evidence ->> ''provider_time_resolution'' is not distinct from ''exact''\n          and p_evidence ->> ''machine_time_resolution'' is not distinct from ''exact''\n          and case_row.incident_time_confidence in (''exact'',''within_15_minutes'')';
  if (pg_catalog.length(source) - pg_catalog.length(pg_catalog.replace(source, old_fragment, '')))
    / pg_catalog.length(old_fragment) <> 1 then
    raise exception 'Refund candidate mismatch-time gate changed';
  end if;
  source := pg_catalog.replace(source, old_fragment, new_fragment);

  start_position := pg_catalog.strpos(
    source,
    E'  base_selection_allowed := expected_selection_allowed;\n'
  );
  end_position := pg_catalog.strpos(
    source,
    E'  if selection_allowed is distinct from expected_selection_allowed\n'
  );
  if start_position = 0 or end_position <= start_position then
    raise exception 'Refund candidate competing-purchase veto changed';
  end if;
  old_fragment := pg_catalog.substr(
    source,
    start_position,
    end_position - start_position
  );
  source := pg_catalog.replace(source, old_fragment, '');

  old_fragment := E'  if selection_allowed is distinct from expected_selection_allowed\n    and not conservative_competing_purchase_hold then return ''invalid''; end if;';
  new_fragment := E'  if selection_allowed is distinct from expected_selection_allowed then\n    return ''invalid'';\n  end if;';
  if (pg_catalog.length(source) - pg_catalog.length(pg_catalog.replace(source, old_fragment, '')))
    / pg_catalog.length(old_fragment) <> 1 then
    raise exception 'Refund candidate selection parity check changed';
  end if;
  source := pg_catalog.replace(source, old_fragment, new_fragment);

  execute source;
end;
$migration$;

revoke all on function public.refund_nayax_candidate_identifier_evidence_state(
  uuid, uuid, integer, timestamptz, integer, text, text, jsonb
) from public, anon, authenticated, service_role;

-- v12 changes only how uncertain time participates in manager selection. Extend
-- the existing, fully validated manager-confirmation promotion and selected-row
-- trigger to v12 so a successful save is genuinely ready for the one guarded
-- approval. All existing candidate, duplicate, provider-state, and payment gates
-- remain in the original functions.
do $manager_selection_v12$
declare
  body text;
  old_fragment text :=
    E'candidate.evidence_summary ->> ''policy_version'' = ''2026-09-05.v11''';
  new_fragment text :=
    E'candidate.evidence_summary ->> ''policy_version'' in (''2026-09-05.v11'',''2026-09-13.v12'')';
begin
  body := pg_catalog.replace(
    pg_catalog.pg_get_functiondef(
      'public.service_select_refund_nayax_candidate_as_actor_pre_lookup_generation_v1(uuid,uuid,bigint,uuid,text)'::regprocedure
    ),
    E'\r\n',
    E'\n'
  );
  if (pg_catalog.length(body) - pg_catalog.length(pg_catalog.replace(body, old_fragment, '')))
    / pg_catalog.length(old_fragment) <> 2 then
    raise exception 'Refund manager-selection policy promotion changed';
  end if;
  execute pg_catalog.replace(body, old_fragment, new_fragment);

  body := pg_catalog.replace(
    pg_catalog.pg_get_functiondef(
      'public.guard_refund_nayax_selected_request_boundary()'::regprocedure
    ),
    E'\r\n',
    E'\n'
  );
  old_fragment := E'evidence ->> ''policy_version'' = ''2026-09-05.v11''';
  new_fragment := E'evidence ->> ''policy_version'' in (''2026-09-05.v11'',''2026-09-13.v12'')';
  if (pg_catalog.length(body) - pg_catalog.length(pg_catalog.replace(body, old_fragment, '')))
    / pg_catalog.length(old_fragment) <> 1 then
    raise exception 'Refund selected-row request-boundary policy gate changed';
  end if;
  execute pg_catalog.replace(body, old_fragment, new_fragment);
end;
$manager_selection_v12$;

create function public.refund_safe_timezone_v1(
  p_preferred text,
  p_fallback text
)
returns text
language sql
stable
set search_path = ''
as $$
  select coalesce(
    (
      select timezone_name.name
      from pg_catalog.pg_timezone_names timezone_name
      where timezone_name.name = nullif(pg_catalog.btrim(p_preferred), '')
      limit 1
    ),
    (
      select timezone_name.name
      from pg_catalog.pg_timezone_names timezone_name
      where timezone_name.name = nullif(pg_catalog.btrim(p_fallback), '')
      limit 1
    )
  );
$$;

revoke all on function public.refund_safe_timezone_v1(text, text)
  from public, anon, authenticated, service_role;

comment on function public.refund_safe_timezone_v1(text, text) is
  'Returns only a catalog-backed IANA timezone, preferring the case value over its venue fallback.';

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
        and exists (
          select 1
          from pg_catalog.pg_timezone_names timezone_name
          where timezone_name.name =
            p_summary -> 'machine_clock_context' ->> 'timezone'
        )
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

  select coalesce(
    pg_catalog.jsonb_agg(
      item.case_json || pg_catalog.jsonb_build_object(
        'incidentTimezone', public.refund_safe_timezone_v1(
          refund_case.incident_timezone,
          location.timezone
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
              'authorizedAt', coalesce(
                nullif(
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
              'customerTimezone', public.refund_safe_timezone_v1(
                refund_case.incident_timezone,
                location.timezone
              ),
              'providerTimestampAt', nullif(
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

revoke all on function public.refund_project_candidate_time_evidence_v1(jsonb)
  from public, anon, authenticated, service_role;

comment on function public.refund_project_candidate_time_evidence_v1(jsonb) is
  'Enriches only an already actor-scoped refund overview with redacted candidate timestamp semantics.';

-- A supporting-only provider timestamp cannot become a durable manager rationale.
-- Keep the reason available only when both the customer and provider sides have
-- a bounded, comparable purchase event.
create or replace function public.admin_select_refund_nayax_candidate_current_user_v1(
  p_case_id uuid,
  p_expected_case_version bigint,
  p_candidate_token uuid,
  p_nayax_disagreement_reason text default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  actor_id uuid := auth.uid();
  candidate_source text;
  candidate_time_comparable boolean;
  normalized_disagreement_reason text :=
    pg_catalog.lower(pg_catalog.btrim(coalesce(p_nayax_disagreement_reason, '')));
begin
  if actor_id is null or coalesce((auth.jwt() ->> 'is_anonymous')::boolean, false) then
    raise exception 'Authenticated refund case access required' using errcode = '42501';
  end if;
  if not public.can_manage_refund_case_current_user(p_case_id) then
    raise exception 'Current refund case access required' using errcode = '42501';
  end if;
  if not exists (
    select 1 from public.refund_cases refund_case
    where refund_case.id = p_case_id
      and refund_case.decision is null
      and refund_case.nayax_recommendation_state in ('ambiguous', 'manual_exception')
      and refund_case.nayax_lookup_status in ('multiple_matches', 'manual_exception')
  ) then
    raise exception 'Clear System matches are read-only; choose only among ambiguous results'
      using errcode = 'P4604';
  end if;
  select
    coalesce(candidate.evidence_summary ->> 'source', ''),
    (candidate.evidence_summary ->> 'transaction_occurrence_comparable') is not distinct from 'true'
      and refund_case.incident_time_resolution in ('exact', 'legacy_absolute')
      and refund_case.incident_time_confidence is distinct from 'rough'
  into candidate_source, candidate_time_comparable
  from public.refund_nayax_lookup_candidates candidate
  join public.refund_cases refund_case on refund_case.id = candidate.refund_case_id
  where candidate.token = p_candidate_token
    and candidate.refund_case_id = p_case_id;
  if not found then
    raise exception 'Nayax lookup evidence expired or belongs to another review session'
      using errcode = 'P4602';
  end if;
  if candidate_source = 'manual_nayax_portal' then
    raise exception 'Manual Nayax candidates are historical and cannot be selected'
      using errcode = 'P4626';
  end if;
  if normalized_disagreement_reason = 'closer_time'
    and candidate_time_comparable is distinct from true then
    raise exception 'Closer transaction time requires comparable purchase-event evidence'
      using errcode = 'P4604';
  end if;
  return public.service_select_refund_nayax_candidate_as_actor(
    actor_id,
    p_case_id,
    p_expected_case_version,
    p_candidate_token,
    nullif(normalized_disagreement_reason, '')
  );
end;
$$;

revoke all on function public.admin_select_refund_nayax_candidate_current_user_v1(
  uuid, bigint, uuid, text
) from public, anon, service_role;
grant execute on function public.admin_select_refund_nayax_candidate_current_user_v1(
  uuid, bigint, uuid, text
) to authenticated;

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
